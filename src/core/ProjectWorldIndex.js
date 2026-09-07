/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import {
  DEFAULT_WORLD_MAP_REGION_TYPE,
  getWorldMapCellSceneId,
  getWorldMapCellTerrain,
  isReservedWorldMapCell,
  isWorldMapRegionType,
  isWorldMapTerrain,
  WORLD_MAP_REGION_TYPES
} from './WorldMapCell.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(errors, code, path, message) {
  errors.push({ code, path, message });
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function dimensionEntry(source, sceneId) {
  if (source instanceof Map) return source.get(sceneId) || null;
  if (!source || typeof source !== 'object') return null;
  return source[sceneId] || null;
}

function projectSceneDimensions(project) {
  const dimensions = new Map();
  for (const scene of project?.scenes || []) {
    if (!scene?.id || (!hasOwn(scene, 'width') && !hasOwn(scene, 'height'))) continue;
    dimensions.set(scene.id, { width: scene.width, height: scene.height });
  }
  return dimensions;
}

function normalizeDimensions(value) {
  if (!value || typeof value !== 'object') return null;
  const width = Number(value.width);
  const height = Number(value.height);
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}

function createBounds(cols, rows, chunkWidth, chunkHeight) {
  return freeze({
    left: 0,
    top: 0,
    right: cols * chunkWidth,
    bottom: rows * chunkHeight,
    width: cols * chunkWidth,
    height: rows * chunkHeight
  });
}

function createOffset(col, row, chunkWidth, chunkHeight) {
  return freeze({ x: col * chunkWidth, y: row * chunkHeight });
}

function isValidRawCell(raw, mapType) {
  if (raw == null) return true;
  if (typeof raw === 'string') return raw.length > 0;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const hasScene = typeof raw.sceneId === 'string' && raw.sceneId.length > 0;
  const hasTerrain = hasOwn(raw, 'terrain');
  const terrainValid = !hasTerrain || isWorldMapTerrain(raw.terrain);
  const reservedValid = !hasOwn(raw, 'reserved') || typeof raw.reserved === 'boolean';
  if (mapType === 'sceneGrid') {
    return reservedValid
      && !hasTerrain
      && hasScene
      && (!raw.reserved || hasScene);
  }
  return terrainValid
    && reservedValid
    && (hasScene || hasTerrain)
    && (!raw.reserved || hasScene)
    && (raw.reserved === true || !hasScene || hasTerrain);
}

function footprintFor({ row, col, worldWidth, worldHeight, chunkWidth, chunkHeight }) {
  const cols = worldWidth / chunkWidth;
  const rows = worldHeight / chunkHeight;
  return freeze({
    row,
    col,
    rows,
    cols,
    left: col,
    top: row,
    right: col + cols,
    bottom: row + rows,
    width: worldWidth,
    height: worldHeight,
    worldLeft: col * chunkWidth,
    worldTop: row * chunkHeight,
    worldRight: (col + cols) * chunkWidth,
    worldBottom: (row + rows) * chunkHeight
  });
}

export class ProjectWorldIndexValidationError extends TypeError {
  constructor(errors) {
    super(errors[0]?.message || 'Project world map is invalid');
    this.name = 'ProjectWorldIndexValidationError';
    this.code = 'invalidProjectWorld';
    this.errors = errors;
  }
}

/**
 * 从完整项目与 canonical 场景尺寸派生世界地图。
 * grid 只保存 scene anchor；场景的 footprint coverage 永远是只读派生值，不能写回 grid。
 */
export class ProjectWorldIndex {
  /**
   * 为低层显式 Region 适配器建立索引；空或仅 reserved 的 grid 合法但没有入口。
   * 完整 GameProject 仍必须通过 build() 的唯一入口校验。
   */
  static fromRegion(region) {
    if (!region || !Array.isArray(region.grid) || !Number.isInteger(region.rows) || !Number.isInteger(region.cols)) return null;
    const sceneIds = new Set();
    for (const row of region.grid) {
      for (const cell of row || []) {
        const sceneId = getWorldMapCellSceneId(cell, { includeReserved: true });
        if (sceneId) sceneIds.add(sceneId);
      }
    }
    const sceneDimensions = new Map([...sceneIds].map(sceneId => [sceneId, {
      width: region.chunkWidth,
      height: region.chunkHeight
    }]));
    const entrySceneId = [...sceneIds].find(sceneId => !isReservedWorldMapCell(
      region.grid.flat().find(cell => getWorldMapCellSceneId(cell, { includeReserved: true }) === sceneId)
    )) || null;
    return ProjectWorldIndex.build({
      scenes: [...sceneIds].map(id => ({ id })),
      worldMap: {
        entrySceneId,
        regions: [{ ...region, id: region.id || 'default' }]
      }
    }, {
      sceneDimensions,
      requireSceneDimensions: true,
      allowEmptyEntry: entrySceneId === null
    });
  }

  static build(project, { sceneDimensions = null, requireSceneDimensions = false, allowEmptyEntry = false } = {}) {
    const errors = [];
    const worldMap = project?.worldMap;
    const regions = worldMap?.regions;
    if (!worldMap || !Array.isArray(regions) || regions.length === 0) {
      throw new ProjectWorldIndexValidationError([
        { code: 'missingRegions', path: 'worldMap.regions', message: 'worldMap.regions 必须是非空数组' }
      ]);
    }

    const dimensions = sceneDimensions || projectSceneDimensions(project);
    const regionIds = new Set();
    const canonicalSceneIds = new Set((project?.scenes || []).map(scene => scene?.id).filter(Boolean));
    const sceneLocations = new Map();
    const regionRecords = [];

    for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
      const source = regions[regionIndex];
      const base = `worldMap.regions[${regionIndex}]`;
      const id = typeof source?.id === 'string' && source.id.length > 0 ? source.id : null;
      const requestedMapType = hasOwn(source, 'mapType')
        ? source.mapType
        : DEFAULT_WORLD_MAP_REGION_TYPE;
      const validMapType = isWorldMapRegionType(requestedMapType);
      const mapType = validMapType ? requestedMapType : DEFAULT_WORLD_MAP_REGION_TYPE;
      const rows = source?.rows;
      const cols = source?.cols;
      const chunkWidth = source?.chunkWidth;
      const chunkHeight = source?.chunkHeight;
      const validRows = Number.isInteger(rows) && rows > 0;
      const validCols = Number.isInteger(cols) && cols > 0;
      const validChunkWidth = Number.isFinite(chunkWidth) && chunkWidth > 0;
      const validChunkHeight = Number.isFinite(chunkHeight) && chunkHeight > 0;
      if (!id) issue(errors, 'invalidRegionId', `${base}.id`, 'Region id 必须是非空字符串');
      else if (regionIds.has(id)) issue(errors, 'duplicateRegionId', `${base}.id`, `Region id 重复: ${id}`);
      else regionIds.add(id);
      if (!validMapType) {
        issue(
          errors,
          'invalidMapType',
          `${base}.mapType`,
          `mapType 必须是 ${WORLD_MAP_REGION_TYPES.join('/')} 之一`
        );
      }
      if (!validRows) issue(errors, 'invalidRows', `${base}.rows`, 'rows 必须是正整数');
      if (!validCols) issue(errors, 'invalidCols', `${base}.cols`, 'cols 必须是正整数');
      if (!validChunkWidth) issue(errors, 'invalidChunkWidth', `${base}.chunkWidth`, 'chunkWidth 必须是正数');
      if (!validChunkHeight) issue(errors, 'invalidChunkHeight', `${base}.chunkHeight`, 'chunkHeight 必须是正数');
      if (!Array.isArray(source?.grid) || source.grid.length !== rows) {
        issue(errors, 'gridRowMismatch', `${base}.grid`, `grid 行数必须等于 rows (${rows})`);
      }

      const safeRows = validRows ? rows : 0;
      const safeCols = validCols ? cols : 0;
      const baseCells = Array.from({ length: safeRows }, (_, row) => Array.from({ length: safeCols }, (_, col) => ({
        row,
        col,
        terrain: null,
        raw: null
      })));
      const anchors = [];
      for (let row = 0; row < safeRows; row++) {
        const sourceRow = source?.grid?.[row];
        if (!Array.isArray(sourceRow) || sourceRow.length !== cols) {
          issue(errors, 'gridColumnMismatch', `${base}.grid[${row}]`, `grid 列数必须等于 cols (${cols})`);
        }
        for (let col = 0; col < safeCols; col++) {
          const raw = sourceRow?.[col] ?? null;
          const path = `${base}.grid[${row}][${col}]`;
          const terrain = getWorldMapCellTerrain(raw);
          baseCells[row][col] = { row, col, terrain, raw };
          if (!isValidRawCell(raw, mapType)) {
            const message = mapType === 'sceneGrid'
              ? 'sceneGrid 单元必须为 null、sceneId 字符串或不含 terrain 的 sceneId/reserved 对象'
              : 'terrainGrid 单元必须为 null、sceneId 字符串或包含合法 terrain/sceneId/reserved 的对象';
            issue(errors, 'invalidWorldCell', path, message);
            continue;
          }
          const sceneId = getWorldMapCellSceneId(raw, { includeReserved: true });
          if (!sceneId) continue;
          const reserved = isReservedWorldMapCell(raw);
          if (!canonicalSceneIds.has(sceneId)) {
            issue(errors, 'unknownSceneId', path, `sceneId 不在 canonical project.scenes 中: ${sceneId}`);
          }
          if (sceneLocations.has(sceneId)) {
            issue(errors, 'duplicateSceneLocation', path, `sceneId 只能定位一次: ${sceneId}`);
            continue;
          }
          const declaredDimensions = normalizeDimensions(dimensionEntry(dimensions, sceneId));
          const fallbackDimensions = validChunkWidth && validChunkHeight
            ? { width: chunkWidth, height: chunkHeight }
            : null;
          const resolvedDimensions = declaredDimensions || (!requireSceneDimensions ? fallbackDimensions : null);
          if (!resolvedDimensions) {
            issue(errors, 'missingSceneDimensions', path, `场景 ${sceneId} 缺少 canonical width/height，不能派生 footprint`);
            continue;
          }
          const { width, height } = resolvedDimensions;
          if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
            issue(errors, 'invalidSceneDimensions', path, `场景 ${sceneId} 的 width/height 必须是正整数`);
            continue;
          }
          if (!validChunkWidth || !validChunkHeight || width % chunkWidth !== 0 || height % chunkHeight !== 0) {
            issue(errors, 'sceneFootprintNotMultiple', path, `场景 ${sceneId} 尺寸 ${width}×${height} 必须是 chunk ${chunkWidth}×${chunkHeight} 的整数倍`);
            continue;
          }
          const offset = createOffset(col, row, chunkWidth, chunkHeight);
          const footprint = footprintFor({ row, col, worldWidth: width, worldHeight: height, chunkWidth, chunkHeight });
          if (footprint.right > safeCols || footprint.bottom > safeRows) {
            issue(errors, 'sceneFootprintOutOfBounds', path, `场景 ${sceneId} 的 footprint 超出 Region 边界`);
            continue;
          }
          const anchor = freeze({
            regionId: id,
            regionIndex,
            sceneId,
            row,
            col,
            reserved,
            loadable: !reserved,
            offset,
            worldWidth: width,
            worldHeight: height,
            footprint
          });
          sceneLocations.set(sceneId, anchor);
          anchors.push(anchor);
        }
      }

      const coverage = Array.from({ length: safeRows }, (_, row) => Array(safeCols).fill(null));
      for (const anchor of anchors) {
        for (let row = anchor.footprint.top; row < anchor.footprint.bottom; row++) {
          for (let col = anchor.footprint.left; col < anchor.footprint.right; col++) {
            const existing = coverage[row][col];
            if (existing && existing.sceneId !== anchor.sceneId) {
              issue(
                errors,
                'sceneFootprintOverlap',
                `${base}.grid[${row}][${col}]`,
                `场景 ${anchor.sceneId} 的 footprint 与 ${existing.sceneId} 重叠`
              );
              continue;
            }
            coverage[row][col] = anchor;
          }
        }
      }

      const coverageCells = [];
      for (let row = 0; row < safeRows; row++) {
        for (let col = 0; col < safeCols; col++) {
          const anchor = coverage[row][col];
          const baseCell = baseCells[row][col];
          coverageCells.push(freeze({
            regionId: id,
            regionIndex,
            row,
            col,
            terrain: baseCell.terrain,
            offset: createOffset(col, row, chunkWidth, chunkHeight),
            sceneId: anchor?.sceneId || null,
            anchorRow: anchor?.row ?? null,
            anchorCol: anchor?.col ?? null,
            reserved: anchor?.reserved === true,
            loadable: anchor?.loadable === true,
            isAnchor: anchor?.row === row && anchor?.col === col,
            sceneOffset: anchor?.offset || null,
            worldWidth: anchor?.worldWidth || null,
            worldHeight: anchor?.worldHeight || null,
            footprint: anchor?.footprint || null
          }));
        }
      }

      regionRecords.push(freeze({
        id,
        regionIndex,
        name: typeof source?.name === 'string' ? source.name : '',
        mapType,
        previewOnly: source?.previewOnly === true,
        rows,
        cols,
        chunkWidth,
        chunkHeight,
        bounds: validRows && validCols && validChunkWidth && validChunkHeight
          ? createBounds(cols, rows, chunkWidth, chunkHeight)
          : null,
        cells: freeze(anchors.slice()),
        coverage: freeze(coverageCells)
      }));
    }

    const hasLoadableScene = [...sceneLocations.values()].some(anchor => anchor.loadable);
    const entrySceneId = worldMap.entrySceneId;
    const hasEntrySceneId = typeof entrySceneId === 'string' && entrySceneId.length > 0;
    const allowsMissingEntry = allowEmptyEntry === true
      && !hasLoadableScene
      && (entrySceneId === null || entrySceneId === undefined);
    if (!hasEntrySceneId && !allowsMissingEntry) {
      issue(errors, 'missingEntrySceneId', 'worldMap.entrySceneId', '必须显式声明唯一入口 sceneId');
    }
    const entry = hasEntrySceneId ? sceneLocations.get(entrySceneId) : null;
    if (hasEntrySceneId && !entry) issue(errors, 'entrySceneNotFound', 'worldMap.entrySceneId', `入口未在世界网格中定位: ${entrySceneId}`);
    else if (entry?.reserved) issue(errors, 'reservedEntryScene', 'worldMap.entrySceneId', '入口不能是 reserved 单元');

    if (errors.length > 0) throw new ProjectWorldIndexValidationError(errors);
    return new ProjectWorldIndex(regionRecords, sceneLocations, entry);
  }

  constructor(regions, sceneLocations, entry) {
    this._regions = freeze(regions.slice());
    this._regionById = new Map(regions.map(region => [region.id, region]));
    this._anchorsByRegion = new Map(regions.map(region => [
      region.id,
      new Map(region.cells.map(cell => [`${cell.row},${cell.col}`, cell]))
    ]));
    this._coverageByRegion = new Map(regions.map(region => [
      region.id,
      new Map(region.coverage.map(cell => [`${cell.row},${cell.col}`, cell]))
    ]));
    this._sceneLocations = new Map(sceneLocations);
    this._entry = entry;
    Object.freeze(this);
  }

  get regions() { return this._regions; }

  getRegion(regionRef = 0) {
    return typeof regionRef === 'number' ? this._regions[regionRef] || null : this._regionById.get(regionRef) || null;
  }

  /** 返回任意世界格的派生 coverage；大场景覆盖格会指向同一个 anchor。 */
  getCell(regionRef, row, col) {
    const region = this.getRegion(regionRef);
    if (!region || !Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= region.rows || col >= region.cols) return null;
    return this._coverageByRegion.get(region.id)?.get(`${row},${col}`) || null;
  }

  findScene(sceneId) { return this._sceneLocations.get(sceneId) || null; }

  getFootprint(sceneId) { return this.findScene(sceneId)?.footprint || null; }

  getBounds(regionRef) { return this.getRegion(regionRef)?.bounds || null; }

  getEntry() { return this._entry; }

  getOffset(sceneOrRegion, row, col) {
    if (typeof sceneOrRegion === 'string' && row === undefined) return this.findScene(sceneOrRegion)?.offset || null;
    const region = this.getRegion(sceneOrRegion);
    return region && Number.isInteger(row) && Number.isInteger(col)
      ? createOffset(col, row, region.chunkWidth, region.chunkHeight)
      : null;
  }

  isLoadable(sceneOrRegion, row, col) {
    const cell = row === undefined ? this.findScene(sceneOrRegion) : this.getCell(sceneOrRegion, row, col);
    return cell?.loadable === true;
  }

  /** 返回唯一 logical scene anchors；绝不返回 footprint coverage 的重复实例。 */
  getCells(regionRef, { includeReserved = false } = {}) {
    const cells = this.getRegion(regionRef)?.cells || [];
    return Object.freeze(includeReserved ? cells.slice() : cells.filter(cell => cell.loadable));
  }

  getSceneAnchors(regionRef, options = {}) {
    return this.getCells(regionRef, options);
  }

  /** 只读查询派生 coverage；默认只返回可加载场景覆盖格。 */
  getCoverageCells(regionRef, { includeReserved = false, includeEmpty = false } = {}) {
    const cells = this.getRegion(regionRef)?.coverage || [];
    return Object.freeze(cells.filter(cell => (
      includeEmpty ? true : (includeReserved ? cell.sceneId !== null : cell.loadable)
    )));
  }
}

export default ProjectWorldIndex;

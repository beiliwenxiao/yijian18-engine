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

import { SceneEditorCanvas } from './SceneEditorCanvas.js';
import { loadGlobalAtlasesConfig, getGlobalAtlasImageUrl } from './SceneDataLoader.js';
import { ProjectWorldIndex } from '../src/core/ProjectWorldIndex.js';
import { AtlasRegistry } from '../src/core/scene/AtlasRegistry.js';
import { CanonicalSceneRepository } from '../src/core/scene/CanonicalSceneRepository.js';
import { FetchDiskSceneAdapter, LocalStorageSceneCacheAdapter } from '../src/core/scene/CanonicalSceneAdapters.js';
import {
  DEFAULT_WORLD_MAP_REGION_TYPE,
  getWorldMapCellSceneId,
  getWorldMapCellTerrain,
  isReservedWorldMapCell,
  isWorldMapRegionType,
  isWorldMapTerrain,
  WORLD_MAP_REGION_TYPES,
  WORLD_MAP_TERRAINS
} from '../src/core/WorldMapCell.js';

export function validateWorldMapRepositoryClosure(project, repositorySceneIds) {
  const closure = repositorySceneIds instanceof Set
    ? repositorySceneIds
    : new Set(repositorySceneIds || []);
  const errors = [];
  for (const [regionIndex, region] of (project?.worldMap?.regions || []).entries()) {
    for (const [rowIndex, row] of (region?.grid || []).entries()) {
      for (const [colIndex, cell] of (row || []).entries()) {
        const sceneId = getWorldMapCellSceneId(cell, { includeReserved: true });
        if (sceneId && !closure.has(sceneId)) {
          errors.push({
            code: 'sceneOutsideRepositoryClosure',
            path: `worldMap.regions[${regionIndex}].grid[${rowIndex}][${colIndex}]`,
            message: `场景 ID 不在磁盘 repository closure: ${sceneId}`
          });
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * WorldMapEditor - 大地图块编辑器 Tab（P6.3 全量美术与发布整理）
 *
 * 功能：
 *   - 完整 worldMap 多 Region 草稿与稳定 Region ID 切换
 *   - terrainGrid / sceneGrid 类型、尺寸和 chunk 结构编辑
 *   - 每格分配已有 scene anchor 或移除 anchor
 *   - 场景根 width/height 自动派生只读 footprint coverage
 *   - 磁盘 canonical 场景缩略图与当前 Region 交互小地图
 *   - 通过共享 CanonicalEditorSession 提交 game.project.json 的完整 worldMap 字段
 *
 * 通过共享 CanonicalEditorSession 编辑 project.worldMap；场景缩略图仍从磁盘 repository 读取。
 */
export class WorldMapEditor {
  /**
   * @param {HTMLElement} container - 编辑器挂载容器
   * @param {Object} opts - { gameId, projectPath, canonicalSession }
   */
  constructor(container, opts = {}) {
    if (!opts.canonicalSession) {
      throw new TypeError('WorldMapEditor requires a shared CanonicalEditorSession');
    }
    this.container = container;
    this.gameId = opts.gameId || 'sanguo_zhangjiao';
    this.canonicalSession = opts.canonicalSession;
    this.projectPath = this._normalizeProjectPath(
      this.canonicalSession.sourceUri || opts.projectPath || `example/${this.gameId}/game.project.json`
    );
    this.project = null;
    this.worldIndex = null;
    this.draftWorldMap = { entrySceneId: null, regions: [] };
    this.selectedRegionId = null;
    this._draftIndex = null;
    this._renderGeneration = 0;
    this._sceneDataById = new Map();
    this._repositorySceneIds = null;
    this._loadedImages = new Map();
    this._sharedAtlases = [];
    this._atlasRegistry = new AtlasRegistry();
    this._defaultDecoSprites = {};
    this._atlasLoadGeneration = 0;

    // 当前 Region 只是完整 worldMap 草稿中的选中投影，不持有第二份业务状态。
    this.region = {
      id: '',
      name: '',
      mapType: DEFAULT_WORLD_MAP_REGION_TYPE,
      chunkWidth: '',
      chunkHeight: '',
      cols: 0,
      rows: 0,
      grid: []
    };

    // 可选场景列表（从 GameProject.scenes 读取）
    this.availableScenes = [];

    this._el = null;
  }

  _normalizeProjectPath(projectPath) {
    return String(projectPath || '')
      .replace(/\\/g, '/')
      .replace(/^(?:\.\.\/)+/, '')
      .replace(/^\//, '');
  }

  /** 切换当前游戏时同步项目上下文，防止复用旧实例继续读取上一个项目。 */
  setProjectContext({ gameId, projectPath, canonicalSession } = {}) {
    const nextGameId = gameId || this.gameId;
    const nextSession = canonicalSession || this.canonicalSession;
    if (!nextSession) throw new TypeError('WorldMapEditor requires a shared CanonicalEditorSession');
    const nextProjectPath = this._normalizeProjectPath(
      nextSession.sourceUri || projectPath || `example/${nextGameId}/game.project.json`
    );
    const changed = nextGameId !== this.gameId
      || nextProjectPath !== this.projectPath
      || nextSession !== this.canonicalSession;
    this.gameId = nextGameId;
    this.projectPath = nextProjectPath;
    this.canonicalSession = nextSession;
    if (changed) {
      this._teardownMainlandNavigation();
      this._renderGeneration++;
      this.project = null;
      this.worldIndex = null;
      this.draftWorldMap = { entrySceneId: null, regions: [] };
      this.selectedRegionId = null;
      this._draftIndex = null;
      this.region = {
        id: '', name: '', mapType: DEFAULT_WORLD_MAP_REGION_TYPE,
        chunkWidth: '', chunkHeight: '', cols: 0, rows: 0, grid: []
      };
      this._sceneDataById.clear();
      this._repositorySceneIds = null;
      this._loadedImages.clear();
      this._sharedAtlases = [];
      this._atlasRegistry = new AtlasRegistry();
      this._defaultDecoSprites = {};
      this._canvasRenderer = null;
    }
    return changed;
  }

  /**
   * 初始化 UI
   */
  async init() {
    this._el = document.createElement('div');
    this._el.className = 'world-map-editor';
    this._el.style.cssText = 'width:max-content;min-width:100%;';
    this._el.innerHTML = this._buildHTML();
    this.container.innerHTML = '';
    this.container.appendChild(this._el);
    this._bindEvents();
    await this.loadFromProject();
  }

  /** 从共享 canonical candidate 与磁盘场景加载完整 worldMap 草稿。 */
  async loadFromProject() {
    const previousSelectedRegionId = this.selectedRegionId;
    try {
      this.project = structuredClone(this.canonicalSession.getValue() || {});
    } catch (error) {
      console.warn('[WorldMapEditor] 从共享 canonical candidate 加载失败', error);
      this._showToast?.(`加载失败: ${error.message}`, 'error');
      return;
    }

    this.availableScenes = Array.isArray(this.project.scenes)
      ? this.project.scenes.map(scene => scene?.id).filter(Boolean)
      : [];
    await Promise.all([
      this._loadSceneDataFromDisk(),
      this._loadSharedAtlasCatalog()
    ]);

    let draftIndex;
    let draftWorldMap;
    try {
      this.worldIndex = this._buildWorldIndex(this.project);
      draftWorldMap = structuredClone(this.project.worldMap);
      draftWorldMap.regions = draftWorldMap.regions.map(region => this._normalizeGrid(region));
      draftIndex = this._buildDraftIndex(draftWorldMap);
    } catch (error) {
      console.warn('[WorldMapEditor] 世界索引校验失败', error?.errors || error);
      this._showToast?.(error?.errors?.[0]?.message || error.message, 'error');
      return;
    }

    const regionIds = new Set(draftWorldMap.regions.map(region => region.id));
    const entryRegionId = draftIndex.getEntry()?.regionId || null;
    const selectedRegionId = regionIds.has(previousSelectedRegionId)
      ? previousSelectedRegionId
      : (regionIds.has(entryRegionId) ? entryRegionId : draftWorldMap.regions[0]?.id);
    this._commitDraftState({ draftWorldMap, worldIndex: draftIndex, selectedRegionId });
    this._populateRegionSelect();
    this._syncRegionControls();
    this._render();
  }

  _getDraftRegion(regionId = this.selectedRegionId, worldMap = this.draftWorldMap) {
    return worldMap?.regions?.find(region => region?.id === regionId) || null;
  }

  _selectRegionState(regionId) {
    const region = this._getDraftRegion(regionId);
    if (!region) throw new Error(`无法找到 Region 草稿: ${regionId}`);
    this.selectedRegionId = region.id;
    this._currentRegionIndex = this.draftWorldMap.regions.indexOf(region);
    this.region = region;
    return region;
  }

  _buildWorldIndex(project) {
    return ProjectWorldIndex.build(project, {
      requireSceneDimensions: true
    });
  }

  _buildCandidateProject(worldMap = this.draftWorldMap) {
    const currentProject = this.canonicalSession.getValue() || this.project;
    const candidate = structuredClone(currentProject || {});
    candidate.worldMap = structuredClone(worldMap);
    return candidate;
  }

  _buildDraftIndex(worldMap = this.draftWorldMap) {
    return this._buildWorldIndex(this._buildCandidateProject(worldMap));
  }

  _commitDraftState({ draftWorldMap, worldIndex, selectedRegionId = this.selectedRegionId }) {
    this.draftWorldMap = draftWorldMap;
    this._draftIndex = worldIndex;
    this.worldIndex = worldIndex;
    this._selectRegionState(selectedRegionId);
    if (this._minimapParams) this._minimapParams.draftIndex = worldIndex;
    return this.region;
  }

  _terrainCell(terrain, sceneId = null, reserved = false) {
    const cell = { terrain: isWorldMapTerrain(terrain) ? terrain : 'plain' };
    if (sceneId) cell.sceneId = sceneId;
    if (reserved) cell.reserved = true;
    return cell;
  }

  _cellTerrain(cell) {
    return getWorldMapCellTerrain(cell) || 'plain';
  }

  _collectLoadableSceneIds() {
    const index = this._draftIndex || this.worldIndex;
    return index
      ? index.regions.flatMap(region => index.getCells(region.id).map(cell => cell.sceneId))
      : [];
  }

  async _readJsonFile(filePath) {
    try {
      const response = await fetch('/api/read-file?path=' + encodeURIComponent(filePath));
      if (response.ok) {
        const payload = await response.json();
        const content = typeof payload.content === 'string' ? payload.content : payload;
        return typeof content === 'string' ? JSON.parse(content) : content;
      }
    } catch (error) { /* 回退到静态文件 */ }

    try {
      const response = await fetch('/' + filePath.replace(/^\/+/, ''));
      return response.ok ? await response.json() : null;
    } catch (error) {
      return null;
    }
  }

  /** 磁盘 repository 是缩略图事实源；缓存仅在同 ID 不可读/解析失败时受限 fallback。 */
  async _loadSceneDataFromDisk() {
    this._sceneDataById.clear();
    const basePath = this.projectPath.slice(0, this.projectPath.lastIndexOf('/') + 1);
    const repository = new CanonicalSceneRepository({
      diskAdapter: new FetchDiskSceneAdapter({
        projectUrl: `/${this.projectPath}`,
        sceneBaseUrl: `/${basePath}assets/scenes/`
      }),
      cacheAdapter: new LocalStorageSceneCacheAdapter({ gameId: this.gameId }),
      mode: 'thumbnail'
    });
    const result = await repository.refresh();
    if (!result.ok) {
      console.warn('[WorldMapEditor] canonical 场景仓库刷新失败', result.errors);
      return;
    }
    this._repositorySceneIds = new Set(result.snapshot.ids);
    const projectSceneIds = Array.isArray(this.project?.scenes)
      ? this.project.scenes.map(scene => scene?.id).filter(Boolean)
      : [];
    this.availableScenes = projectSceneIds;
    const sceneLoadResults = await Promise.allSettled(
      projectSceneIds.map(sceneId => repository.loadScene(sceneId, { snapshot: result.snapshot }))
    );
    const unavailableSceneIds = [];
    for (const [index, sceneLoad] of sceneLoadResults.entries()) {
      const sceneId = projectSceneIds[index];
      const outcome = sceneLoad.status === 'fulfilled' ? sceneLoad.value : null;
      if (outcome?.ok === true && outcome.record?.data) {
        this._sceneDataById.set(sceneId, outcome.record.data);
      } else {
        unavailableSceneIds.push(sceneId);
      }
    }
    if (unavailableSceneIds.length > 0) {
      console.warn('[WorldMapEditor] canonical 场景缩略图读取失败', {
        sceneIds: unavailableSceneIds,
        results: sceneLoadResults
      });
      this._showToast?.(`部分场景缩略图读取失败：${unavailableSceneIds.join(', ')}`, 'warn');
    }
  }

  _createAtlasSliceProjection(atlas) {
    return Object.fromEntries(
      Object.entries(atlas?.slices || {}).map(([sliceKey, slice]) => [
        sliceKey,
        { scale: 1, ...slice }
      ])
    );
  }

  async _loadSharedAtlasCatalog() {
    const projectPath = this.projectPath;
    const generation = ++this._atlasLoadGeneration;
    const isCurrent = () => (
      generation === this._atlasLoadGeneration
      && projectPath === this.projectPath
    );
    try {
      const config = await loadGlobalAtlasesConfig(projectPath);
      if (!isCurrent()) return;
      const sharedAtlases = Array.isArray(config?.atlases) ? config.atlases : [];
      const atlasRegistry = new AtlasRegistry(sharedAtlases);
      const defaultDecoSprites = this._createAtlasSliceProjection(
        atlasRegistry.getAtlas('mountain_landscape')
      );
      const loadedImages = new Map();
      const gameBasePath = `/${projectPath.slice(0, projectPath.lastIndexOf('/') + 1)}`;
      await Promise.all(sharedAtlases.map(atlas => new Promise(resolve => {
        if (!atlas?.id) {
          resolve();
          return;
        }
        const imageUrl = getGlobalAtlasImageUrl(atlas, gameBasePath, projectPath);
        if (!imageUrl) {
          resolve();
          return;
        }
        const img = new Image();
        img.onload = () => {
          if (isCurrent()) loadedImages.set(atlas.id, img);
          resolve();
        };
        img.onerror = () => {
          if (isCurrent()) {
            console.warn('[WorldMapEditor] 共享图集图片加载失败', { atlasId: atlas.id, imageUrl });
          }
          resolve();
        };
        img.src = imageUrl;
      })));
      if (!isCurrent()) return;

      this._sharedAtlases = sharedAtlases;
      this._atlasRegistry = atlasRegistry;
      this._defaultDecoSprites = defaultDecoSprites;
      this._loadedImages = loadedImages;
      const terrainAtlas = loadedImages.get('mountain_landscape');
      if (terrainAtlas) loadedImages.set('terrain_atlas', terrainAtlas);
    } catch (error) {
      if (!isCurrent()) return;
      this._sharedAtlases = [];
      this._atlasRegistry = new AtlasRegistry();
      this._defaultDecoSprites = {};
      this._loadedImages.clear();
      console.warn('[WorldMapEditor] 共享图集配置加载失败', error);
    }
  }

  /**
   * 保存到 game.project.json
   */
  async save() {
    if (!this.project || !this.draftWorldMap?.regions?.length) {
      this._showToast('无工程数据，请先加载', 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'missingProject' };
    }

    let candidate;
    let normalizedWorldMap;
    try {
      normalizedWorldMap = structuredClone(this.draftWorldMap);
      normalizedWorldMap.regions = normalizedWorldMap.regions.map(region => this._normalizeGrid(region));
      candidate = this._buildCandidateProject(normalizedWorldMap);
    } catch (error) {
      this._showToast(error.message, 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidWorldMap', error };
    }

    const closureResult = validateWorldMapRepositoryClosure(candidate, this._repositorySceneIds);
    if (!closureResult.ok) {
      this._showToast(closureResult.errors[0].message, 'error');
      return { ok: false, committed: false, status: 'rejected', errors: closureResult.errors };
    }
    try {
      this._buildWorldIndex(candidate);
    } catch (error) {
      const message = error?.errors?.[0]?.message || error.message;
      this._showToast(message, 'error');
      return { ok: false, committed: false, status: 'rejected', errors: error?.errors || [], error };
    }

    try {
      this.canonicalSession.patch('worldMap', structuredClone(normalizedWorldMap));
      const result = await this.canonicalSession.save();
      if (result?.ok !== true || result.committed !== true) {
        const firstError = result?.errors?.[0];
        const message = [firstError?.path, firstError?.message || firstError?.reason]
          .filter(Boolean)
          .join(': ') || result?.error?.message || result?.error || '磁盘未提交';
        this._showToast(`保存失败: ${message}`, 'error');
        return result;
      }

      const previousSelectedRegionId = this.selectedRegionId;
      this.project = structuredClone(this.canonicalSession.getValue() || candidate);
      const committedWorldMap = structuredClone(this.project.worldMap);
      committedWorldMap.regions = committedWorldMap.regions.map(region => this._normalizeGrid(region));
      const committedIndex = this._buildDraftIndex(committedWorldMap);
      const selectedRegionId = committedWorldMap.regions.some(region => region.id === previousSelectedRegionId)
        ? previousSelectedRegionId
        : (committedIndex.getEntry()?.regionId || committedWorldMap.regions[0].id);
      this._commitDraftState({
        draftWorldMap: committedWorldMap,
        worldIndex: committedIndex,
        selectedRegionId
      });
      this._populateRegionSelect();
      this._syncRegionControls();
      this._showToast(
        result.degraded ? '大地图已提交，但缓存/通知同步降级' : '大地图已保存 ✓',
        result.degraded ? 'warn' : 'success'
      );
      return result;
    } catch (error) {
      this._showToast('保存异常: ' + error.message, 'error');
      return error.result || { ok: false, committed: false, status: 'failed', error };
    }
  }

  // ================ 内部方法 ================

  /** 补齐任意 Region 的网格；超出声明尺寸的数据必须由显式缩容流程处理。 */
  _normalizeGrid(region = this.region) {
    if (!region || typeof region !== 'object' || Array.isArray(region)) {
      throw new TypeError('Region 必须是对象');
    }
    region.mapType ??= DEFAULT_WORLD_MAP_REGION_TYPE;
    if (!isWorldMapRegionType(region.mapType)) {
      throw new TypeError(`Region ${region.id || '(未命名)'} 的 mapType 无效: ${region.mapType}`);
    }
    this._assertGridSize(region.rows, region.cols);
    this._assertPositiveNumber(region.chunkWidth, 'Chunk 宽度');
    this._assertPositiveNumber(region.chunkHeight, 'Chunk 高度');
    if (!Array.isArray(region.grid)) {
      throw new TypeError(`Region ${region.id || '(未命名)'}.grid 必须是数组`);
    }
    if (region.grid.length > region.rows) {
      throw new RangeError(`Region ${region.id} 的 grid 行数超过 rows，必须通过尺寸编辑显式缩容`);
    }

    while (region.grid.length < region.rows) region.grid.push([]);
    for (let row = 0; row < region.rows; row++) {
      if (region.grid[row] == null) region.grid[row] = [];
      if (!Array.isArray(region.grid[row])) {
        throw new TypeError(`Region ${region.id}.grid[${row}] 必须是数组`);
      }
      if (region.grid[row].length > region.cols) {
        throw new RangeError(`Region ${region.id}.grid[${row}] 列数超过 cols，必须通过尺寸编辑显式缩容`);
      }
      while (region.grid[row].length < region.cols) {
        region.grid[row].push(this._createEmptyRegionCell(region.mapType));
      }
      for (let col = 0; col < region.cols; col++) {
        const raw = region.grid[row][col];
        if (region.mapType === 'sceneGrid') {
          if (raw == null) {
            region.grid[row][col] = null;
            continue;
          }
          if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'terrain')) {
            throw new TypeError(`sceneGrid ${region.id}.grid[${row}][${col}] 禁止 terrain 字段`);
          }
          continue;
        }
        if (raw == null) {
          region.grid[row][col] = this._terrainCell('plain');
        } else if (typeof raw === 'string') {
          region.grid[row][col] = this._terrainCell('plain', raw);
        } else if (typeof raw === 'object' && !Array.isArray(raw) && !Object.hasOwn(raw, 'terrain')) {
          region.grid[row][col] = { ...raw, terrain: 'plain' };
        }
      }
    }
    return region;
  }

  _createEmptyRegionCell(mapType) {
    return mapType === 'sceneGrid' ? null : this._terrainCell('plain');
  }

  _assertGridSize(rows, cols) {
    if (!Number.isInteger(rows) || rows < 1 || rows > 100) {
      throw new RangeError('行数必须是 1..100 的整数');
    }
    if (!Number.isInteger(cols) || cols < 1 || cols > 100) {
      throw new RangeError('列数必须是 1..100 的整数');
    }
  }

  _assertPositiveNumber(value, label) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
      throw new RangeError(`${label}必须是严格正数`);
    }
    return Number(value);
  }

  _buildHTML() {
    const mapTypeOptions = WORLD_MAP_REGION_TYPES.map(type => (
      `<option value="${type}">${type === 'terrainGrid' ? '地形网格' : '场景网格'}</option>`
    )).join('');
    return `
      <div class="wme-toolbar" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0;">
        <strong style="color:#d9c28d;">世界地图</strong>
        <label>地图:
          <select class="wme-region-select" style="min-width:150px;"></select>
        </label>
        <button type="button" class="wme-add-region">新建地图</button>
        <span style="margin:0 4px;color:#555;">|</span>
        <label>ID: <input type="text" class="wme-region-id" readonly style="width:110px;" title="Region ID 创建后只读，避免产生跨文件悬空引用" /></label>
        <label>名称: <input type="text" class="wme-region-name" style="width:120px;" /></label>
        <label>类型:
          <select class="wme-map-type">${mapTypeOptions}</select>
        </label>
        <label>Chunk:
          <input type="number" class="wme-chunk-w" min="0.000001" step="any" style="width:74px;" /> ×
          <input type="number" class="wme-chunk-h" min="0.000001" step="any" style="width:74px;" />
        </label>
        <label>尺寸:
          <input type="number" class="wme-cols" min="1" max="100" step="1" style="width:55px;" /> ×
          <input type="number" class="wme-rows" min="1" max="100" step="1" style="width:55px;" />
        </label>
        <button type="button" class="wme-apply-size">应用结构</button>
        <button type="button" class="wme-focus-used">定位场景</button>
        <button type="button" class="wme-save">保存</button>
      </div>
      <form class="wme-new-region-form" hidden
            style="margin:0 0 8px;padding:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid #66583f;background:#18150f;">
        <strong style="color:#d9c28d;">新建地图</strong>
        <label>ID: <input name="regionId" required pattern="[A-Za-z][A-Za-z0-9._-]*" style="width:120px;" /></label>
        <label>名称: <input name="regionName" required style="width:120px;" /></label>
        <label>类型: <select name="mapType">${mapTypeOptions}</select></label>
        <label>Chunk:
          <input name="chunkWidth" type="number" min="0.000001" step="any" required value="1280" style="width:74px;" /> ×
          <input name="chunkHeight" type="number" min="0.000001" step="any" required value="720" style="width:74px;" />
        </label>
        <label>尺寸:
          <input name="cols" type="number" min="1" max="100" step="1" required value="20" style="width:55px;" /> ×
          <input name="rows" type="number" min="1" max="100" step="1" required value="20" style="width:55px;" />
        </label>
        <button type="submit">创建</button>
        <button type="button" class="wme-cancel-new-region">取消</button>
      </form>
      <div class="wme-grid-container" style="position:relative;"></div>
      <div class="wme-toast" style="display:none;"></div>
    `;
  }

  _bindEvents() {
    this._el.querySelector('.wme-save').onclick = async () => {
      await this.save();
    };
    this._el.querySelector('.wme-focus-used').onclick = () => this._focusUsedArea({ smooth: true });
    this._el.querySelector('.wme-apply-size').onclick = () => this._applySize();
    this._el.querySelector('.wme-region-select').onchange = event => this._switchRegion(event.target.value);
    this._el.querySelector('.wme-add-region').onclick = () => this._addNewRegion();
    this._el.querySelector('.wme-cancel-new-region').onclick = () => this._cancelNewRegion();
    this._el.querySelector('.wme-new-region-form').onsubmit = event => this._submitNewRegion(event);
    this._el.querySelector('.wme-region-name').oninput = event => {
      const region = this._getDraftRegion();
      if (!region) return;
      region.name = event.target.value;
      const selectedOption = this._el.querySelector('.wme-region-select')?.selectedOptions?.[0];
      if (selectedOption) selectedOption.textContent = this._regionOptionLabel(region);
    };
    this._el.querySelector('.wme-map-type').onchange = event => this._applyMapType(event.target.value);
  }

  _syncRegionControls() {
    const region = this._getDraftRegion();
    if (!this._el || !region) return false;
    const values = {
      '.wme-region-select': region.id,
      '.wme-region-id': region.id,
      '.wme-region-name': region.name || '',
      '.wme-map-type': region.mapType || DEFAULT_WORLD_MAP_REGION_TYPE,
      '.wme-chunk-w': region.chunkWidth,
      '.wme-chunk-h': region.chunkHeight,
      '.wme-cols': region.cols,
      '.wme-rows': region.rows
    };
    for (const [selector, value] of Object.entries(values)) {
      const control = this._el.querySelector(selector);
      if (control) control.value = String(value ?? '');
    }
    return true;
  }

  _readStructureControls() {
    const cols = Number(this._el.querySelector('.wme-cols')?.value);
    const rows = Number(this._el.querySelector('.wme-rows')?.value);
    const chunkWidth = this._assertPositiveNumber(
      Number(this._el.querySelector('.wme-chunk-w')?.value),
      'Chunk 宽度'
    );
    const chunkHeight = this._assertPositiveNumber(
      Number(this._el.querySelector('.wme-chunk-h')?.value),
      'Chunk 高度'
    );
    this._assertGridSize(rows, cols);
    return { cols, rows, chunkWidth, chunkHeight };
  }

  _replaceDraftRegion(worldMap, region) {
    const index = worldMap.regions.findIndex(candidate => candidate?.id === region.id);
    if (index < 0) throw new Error(`无法找到 Region 草稿: ${region.id}`);
    worldMap.regions[index] = region;
    return worldMap;
  }

  _commitRegionStructure(worldMap, selectedRegionId, successMessage) {
    let worldIndex;
    try {
      worldIndex = this._buildDraftIndex(worldMap);
    } catch (error) {
      this._syncRegionControls();
      this._showToast(error?.errors?.[0]?.message || error.message, 'error');
      return { ok: false, committed: false, status: 'rejected', error };
    }
    this._commitDraftState({ draftWorldMap: worldMap, worldIndex, selectedRegionId });
    this._populateRegionSelect();
    this._syncRegionControls();
    this._render();
    if (successMessage) this._showToast(successMessage);
    return { ok: true, committed: false, status: 'draft' };
  }

  _applySize() {
    let structure;
    try {
      structure = this._readStructureControls();
    } catch (error) {
      this._syncRegionControls();
      this._showToast(error.message, 'error');
      return { ok: false, committed: false, status: 'rejected', error };
    }

    const candidateRegion = structuredClone(this.region);
    try {
      candidateRegion.grid = this._resizeRegionGrid(candidateRegion, structure.rows, structure.cols);
      Object.assign(candidateRegion, structure);
      this._normalizeGrid(candidateRegion);
    } catch (error) {
      this._syncRegionControls();
      this._showToast(error.message, 'error');
      return { ok: false, committed: false, status: 'rejected', error };
    }
    const candidateWorldMap = this._replaceDraftRegion(
      structuredClone(this.draftWorldMap),
      candidateRegion
    );
    return this._commitRegionStructure(
      candidateWorldMap,
      candidateRegion.id,
      `地图结构已更新：${candidateRegion.cols}×${candidateRegion.rows}`
    );
  }

  _resizeRegionGrid(region, nextRows, nextCols) {
    this._assertGridSize(nextRows, nextCols);
    this._assertSafeRegionShrink(region, nextRows, nextCols);
    return Array.from({ length: nextRows }, (_unused, row) => (
      Array.from({ length: nextCols }, (_empty, col) => (
        row < region.rows && col < region.cols
          ? structuredClone(region.grid[row]?.[col] ?? this._createEmptyRegionCell(region.mapType))
          : this._createEmptyRegionCell(region.mapType)
      ))
    ));
  }

  _assertSafeRegionShrink(region, nextRows, nextCols) {
    for (let row = 0; row < region.rows; row++) {
      for (let col = 0; col < region.cols; col++) {
        if (row < nextRows && col < nextCols) continue;
        const cell = region.grid[row]?.[col] ?? null;
        const sceneId = getWorldMapCellSceneId(cell, { includeReserved: true });
        const terrain = getWorldMapCellTerrain(cell);
        if (sceneId || isReservedWorldMapCell(cell) || (terrain && terrain !== 'plain')) {
          throw new RangeError(`缩容会删除有效单元 (${row}, ${col})，请先清空场景、预留标记或非 plain 地形`);
        }
      }
    }
  }

  _applyMapType(mapType) {
    if (!isWorldMapRegionType(mapType)) {
      this._syncRegionControls();
      this._showToast(`不支持的地图类型: ${mapType}`, 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidMapType' };
    }
    if (mapType === this.region.mapType) {
      return { ok: true, committed: false, status: 'noop' };
    }

    let candidateRegion;
    try {
      candidateRegion = this._convertRegionMapType(structuredClone(this.region), mapType);
    } catch (error) {
      this._syncRegionControls();
      this._showToast(error.message, 'error');
      return { ok: false, committed: false, status: 'rejected', error };
    }
    const candidateWorldMap = this._replaceDraftRegion(
      structuredClone(this.draftWorldMap),
      candidateRegion
    );
    return this._commitRegionStructure(
      candidateWorldMap,
      candidateRegion.id,
      `地图类型已切换为 ${mapType}`
    );
  }

  _convertRegionMapType(region, mapType) {
    if (mapType === 'terrainGrid') {
      region.grid = region.grid.map(row => row.map(cell => {
        if (cell == null) return this._terrainCell('plain');
        if (typeof cell === 'string') return this._terrainCell('plain', cell);
        if (typeof cell !== 'object' || Array.isArray(cell)) {
          throw new TypeError(`无法把非法单元转换为 terrainGrid: ${String(cell)}`);
        }
        return { ...cell, terrain: 'plain' };
      }));
    } else {
      region.grid = region.grid.map((row, rowIndex) => row.map((cell, colIndex) => {
        const terrain = getWorldMapCellTerrain(cell);
        if (terrain && terrain !== 'plain') {
          throw new RangeError(`单元 (${rowIndex}, ${colIndex}) 的地形为 ${terrain}，必须先改为 plain`);
        }
        const sceneId = getWorldMapCellSceneId(cell, { includeReserved: true });
        if (!sceneId) return null;
        if (typeof cell === 'string') return cell;
        const converted = { ...cell };
        delete converted.terrain;
        return converted;
      }));
    }
    region.mapType = mapType;
    return this._normalizeGrid(region);
  }

  _switchRegion(regionId) {
    if (!this._getDraftRegion(regionId)) {
      this._syncRegionControls();
      this._showToast(`找不到地图: ${regionId}`, 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'missingRegion' };
    }
    if (regionId === this.selectedRegionId) {
      this._syncRegionControls();
      return { ok: true, committed: false, status: 'noop' };
    }
    this._selectRegionState(regionId);
    this._populateRegionSelect();
    this._syncRegionControls();
    this._render();
    return { ok: true, committed: false, status: 'selected' };
  }

  _addNewRegion() {
    const form = this._el.querySelector('.wme-new-region-form');
    if (!form) return false;
    form.hidden = false;
    const current = this.region;
    form.elements.mapType.value = current?.mapType || DEFAULT_WORLD_MAP_REGION_TYPE;
    form.elements.chunkWidth.value = current?.chunkWidth || 1280;
    form.elements.chunkHeight.value = current?.chunkHeight || 720;
    form.elements.cols.value = current?.cols || 20;
    form.elements.rows.value = current?.rows || 20;
    form.elements.regionId.focus();
    return true;
  }

  _cancelNewRegion() {
    const form = this._el.querySelector('.wme-new-region-form');
    if (!form) return false;
    form.hidden = true;
    form.elements.regionId.value = '';
    form.elements.regionName.value = '';
    return true;
  }

  _submitNewRegion(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const regionId = form.elements.regionId.value.trim();
    const name = form.elements.regionName.value.trim();
    const mapType = form.elements.mapType.value;
    const cols = Number(form.elements.cols.value);
    const rows = Number(form.elements.rows.value);
    const chunkWidth = Number(form.elements.chunkWidth.value);
    const chunkHeight = Number(form.elements.chunkHeight.value);

    try {
      if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(regionId)) {
        throw new TypeError('Region ID 必须以字母开头，且只能包含字母、数字、点、下划线和短横线');
      }
      if (this.draftWorldMap.regions.some(region => region.id === regionId)) {
        throw new TypeError(`Region ID 已存在: ${regionId}`);
      }
      if (!name) throw new TypeError('地图名称不能为空');
      if (!isWorldMapRegionType(mapType)) throw new TypeError(`不支持的地图类型: ${mapType}`);
      this._assertGridSize(rows, cols);
      this._assertPositiveNumber(chunkWidth, 'Chunk 宽度');
      this._assertPositiveNumber(chunkHeight, 'Chunk 高度');
    } catch (error) {
      this._showToast(error.message, 'error');
      return { ok: false, committed: false, status: 'rejected', error };
    }

    const newRegion = {
      id: regionId,
      name,
      mapType,
      chunkWidth,
      chunkHeight,
      cols,
      rows,
      grid: Array.from({ length: rows }, () => (
        Array.from({ length: cols }, () => this._createEmptyRegionCell(mapType))
      ))
    };
    const candidateWorldMap = structuredClone(this.draftWorldMap);
    candidateWorldMap.regions.push(newRegion);
    const result = this._commitRegionStructure(candidateWorldMap, regionId, `已创建地图: ${name}`);
    if (result.ok) this._cancelNewRegion();
    return result;
  }

  _regionOptionLabel(region) {
    return `${region.name || region.id} (${region.id})`;
  }

  _populateRegionSelect() {
    const select = this._el?.querySelector('.wme-region-select');
    if (!select) return false;
    select.innerHTML = this.draftWorldMap.regions.map(region => (
      `<option value="${this._escapeHtml(region.id)}">${this._escapeHtml(this._regionOptionLabel(region))}</option>`
    )).join('');
    select.value = this.selectedRegionId || '';
    return true;
  }

  _escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 渲染当前选中 Region；两种 mapType 共用 canonical footprint 路径。 */
  _render() {
    return this._renderMainland();
  }

  _renderMainland() {
    const gc = this._el.querySelector('.wme-grid-container');
    const region = this._getDraftRegion();
    if (!gc || !region) return;

    let draftIndex;
    try {
      draftIndex = this._buildDraftIndex(this.draftWorldMap);
    } catch (error) {
      this._showToast(error?.errors?.[0]?.message || error.message, 'error');
      return;
    }

    const generation = ++this._renderGeneration;
    const selectedRegionId = region.id;
    const thumbW = 256;
    const thumbH = Math.max(1, Math.round(thumbW * (region.chunkHeight / region.chunkWidth)));
    const metrics = { thumbW, thumbH, labelH: 20, cellH: thumbH + 20 };
    const terrainOptions = WORLD_MAP_TERRAINS.map(terrain => (
      `<option value="${this._escapeHtml(terrain)}">${this._escapeHtml(terrain)}</option>`
    )).join('');
    const sceneOptions = ['<option value="">（无场景 anchor）</option>']
      .concat(this.availableScenes.map(sceneId => (
        `<option value="${this._escapeHtml(sceneId)}">${this._escapeHtml(sceneId)}</option>`
      )))
      .join('');
    const minimapSize = this._calculateMinimapSize(region);

    let html = '<style>.wme-grid>.wme-cell:hover>.wme-cell-overlay{display:flex!important}</style>';
    html += `<div class="wme-grid" style="display:grid;grid-template-columns:repeat(${region.cols},${thumbW}px);gap:2px;width:max-content;">`;
    for (let row = 0; row < region.rows; row++) {
      for (let col = 0; col < region.cols; col++) {
        html += this._buildMainlandCellHtml({
          row,
          col,
          worldIndex: draftIndex,
          region,
          metrics,
          terrainOptions,
          sceneOptions
        });
      }
    }
    html += '</div>';
    html += `<div style="margin-top:8px;color:#aaa;font-size:12px;">${this._escapeHtml(region.name || region.id)} · ${this._escapeHtml(region.mapType)} · ${region.cols}×${region.rows} 格 · 基准块 ${region.chunkWidth}×${region.chunkHeight}px · 大场景 footprint 由 canonical width/height 自动计算</div>`;
    html += `
      <div class="wme-minimap" title="点击定位，拖动选框移动主地图"
           style="position:fixed;top:60px;right:24px;width:${minimapSize.width}px;height:${minimapSize.height}px;background:rgba(20,15,10,.94);border:2px solid #8b7355;border-radius:4px;overflow:hidden;pointer-events:auto;touch-action:none;user-select:none;cursor:crosshair;z-index:10;">
        <canvas class="wme-minimap-canvas" width="${minimapSize.width}" height="${minimapSize.height}" style="width:100%;height:100%;pointer-events:none;"></canvas>
        <div class="wme-minimap-viewport" style="display:none;position:absolute;box-sizing:border-box;border:2px solid #f6e7a8;background:rgba(246,231,168,.10);box-shadow:0 0 0 1px rgba(0,0,0,.85),0 0 8px rgba(246,231,168,.75);pointer-events:none;z-index:1;"></div>
      </div>`;

    this._teardownMainlandNavigation();
    gc.innerHTML = html;
    this._draftIndex = draftIndex;
    this.worldIndex = draftIndex;
    this._mainlandMetrics = metrics;
    this._mainlandTerrainOptions = terrainOptions;
    this._mainlandSceneOptions = sceneOptions;
    this._minimapParams = { gc, thumbW, thumbH, draftIndex, generation, selectedRegionId };

    const grid = gc.querySelector('.wme-grid');
    if (grid) grid.onchange = event => this._handleMainlandCellChange(event);
    gc.querySelectorAll('.wme-cell').forEach(cell => {
      const row = Number(cell.dataset.r);
      const col = Number(cell.dataset.c);
      this._renderFootprintThumbnail(cell, row, col, thumbW, thumbH, draftIndex, {
        generation,
        selectedRegionId
      });
    });

    this._bindMainlandMinimapNavigation(gc);
    requestAnimationFrame(() => {
      if (!this._isActiveMapRender({ generation, selectedRegionId, worldIndex: draftIndex, gc })) return;
      this._renderMainlandMinimap(gc, draftIndex);
      this._focusUsedArea();
      this._requestMainlandViewportSync();
    });
  }

  _calculateMinimapSize(region, maxEdge = 220) {
    const worldWidth = region.cols * region.chunkWidth;
    const worldHeight = region.rows * region.chunkHeight;
    if (worldWidth >= worldHeight) {
      return { width: maxEdge, height: Math.max(1, Math.round(maxEdge * worldHeight / worldWidth)) };
    }
    return { width: Math.max(1, Math.round(maxEdge * worldWidth / worldHeight)), height: maxEdge };
  }

  _isActiveMapRender({ generation, selectedRegionId, worldIndex, gc = null }) {
    return generation === this._renderGeneration
      && selectedRegionId === this.selectedRegionId
      && worldIndex === this._draftIndex
      && (!gc || gc === this._minimapParams?.gc);
  }

  _buildMainlandCellHtml({ row, col, worldIndex, region, metrics, terrainOptions, sceneOptions }) {
    const { thumbW, thumbH, labelH, cellH } = metrics;
    const raw = region.grid[row]?.[col] ?? null;
    const coverage = worldIndex.getCell(region.id, row, col);
    const sceneId = coverage?.sceneId || getWorldMapCellSceneId(raw, { includeReserved: true });
    const anchor = sceneId ? worldIndex.findScene(sceneId) : null;
    const isCoverage = Boolean(sceneId && coverage && !coverage.isAnchor);
    const isAnchor = Boolean(sceneId && coverage?.isAnchor);
    const terrain = this._cellTerrain(raw);
    const reserved = isReservedWorldMapCell(raw);
    const emptyLabel = region.mapType === 'sceneGrid' ? '(空)' : terrain;
    const label = isCoverage && anchor
      ? `${sceneId} · 覆盖 ← (${anchor.row},${anchor.col})`
      : (sceneId ? `${sceneId}${reserved ? ' · 预留' : (isAnchor ? ' · anchor' : '')}` : emptyLabel);

    let cellSceneOptions = sceneOptions;
    if (sceneId && !this.availableScenes.includes(sceneId)) {
      const escapedId = this._escapeHtml(sceneId);
      cellSceneOptions += `<option value="${escapedId}">${escapedId}（预留/未登记）</option>`;
    }
    const selectedSceneOptions = cellSceneOptions.replace(
      `value="${this._escapeHtml(sceneId || '')}"`,
      `value="${this._escapeHtml(sceneId || '')}" selected`
    );
    const terrainControl = region.mapType === 'terrainGrid'
      ? `<label style="font-size:10px;color:#ddd;display:grid;gap:2px;width:94%;">地形
          <select class="wme-terrain-select" data-r="${row}" data-c="${col}" style="font-size:10px;background:#222;color:#eee;">${terrainOptions.replace(`value="${this._escapeHtml(terrain)}"`, `value="${this._escapeHtml(terrain)}" selected`)}</select>
        </label>`
      : '';
    const control = isCoverage
      ? '<div style="font-size:10px;color:#b7a778;text-align:center;line-height:1.4;">footprint 覆盖格<br>由 anchor 管理</div>'
      : `${terrainControl}
        <label style="font-size:10px;color:#ddd;display:grid;gap:2px;width:94%;">场景 anchor
          <select class="wme-scene-select" data-r="${row}" data-c="${col}" style="font-size:10px;background:#222;color:#eee;">${selectedSceneOptions}</select>
        </label>`;

    return `
      <div class="wme-cell${isCoverage ? ' wme-footprint-coverage' : ''}" data-r="${row}" data-c="${col}"
           style="width:${thumbW}px;height:${cellH}px;border:1px solid ${isCoverage ? '#c4a64e' : '#444'};position:relative;overflow:hidden;background:#111;">
        <canvas class="wme-cell-canvas" width="${thumbW}" height="${thumbH}" style="position:absolute;top:0;left:0;width:${thumbW}px;height:${thumbH}px;"></canvas>
        <span class="wme-cell-label" title="${this._escapeHtml(label)}" style="position:absolute;top:${thumbH}px;left:0;right:0;height:${labelH}px;box-sizing:border-box;border-top:1px solid rgba(255,255,255,.16);font-size:10px;line-height:${labelH - 1}px;color:#ddd;background:rgba(0,0,0,.82);text-align:center;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this._escapeHtml(label)}</span>
        <div class="wme-cell-overlay" style="display:none;position:absolute;top:0;left:0;right:0;height:${thumbH}px;box-sizing:border-box;background:rgba(0,0,0,.78);flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:4px;">
          <div style="font-size:10px;color:#8cf;font-weight:bold;">(${row}, ${col})</div>
          ${control}
        </div>
      </div>`;
  }

  _handleMainlandCellChange(event) {
    const target = event.target.closest?.('.wme-terrain-select, .wme-scene-select');
    if (!target || !this._draftIndex) return;
    const row = Number(target.dataset.r);
    const col = Number(target.dataset.c);
    const previousIndex = this._draftIndex;
    const previousCoverage = previousIndex.getCell(this.region.id, row, col);
    if (previousCoverage?.sceneId && !previousCoverage.isAnchor) return;

    const previous = this.region.grid[row]?.[col] ?? null;
    const previousSceneId = getWorldMapCellSceneId(previous, { includeReserved: true });
    const terrain = target.classList.contains('wme-terrain-select')
      ? target.value
      : this._cellTerrain(previous);
    const selectedSceneId = target.classList.contains('wme-scene-select')
      ? (target.value || null)
      : previousSceneId;
    const candidateRegion = structuredClone(this.region);

    try {
      candidateRegion.grid[row][col] = this._buildEditedRegionCell(
        previous,
        candidateRegion.mapType,
        terrain,
        selectedSceneId
      );
    } catch (error) {
      this._restoreCellControl(target, previous, previousSceneId);
      this._showToast(error.message, 'error');
      return;
    }

    const candidateWorldMap = this._replaceDraftRegion(
      structuredClone(this.draftWorldMap),
      candidateRegion
    );
    let nextIndex;
    try {
      nextIndex = this._buildDraftIndex(candidateWorldMap);
    } catch (error) {
      this._restoreCellControl(target, previous, previousSceneId);
      this._showToast(error?.errors?.[0]?.message || error.message, 'error');
      return;
    }

    const affected = new Set([`${row},${col}`]);
    if (previousSceneId !== selectedSceneId) {
      this._collectMainlandFootprintKeys(previousIndex, previousSceneId, affected);
      this._collectMainlandFootprintKeys(nextIndex, selectedSceneId, affected);
    }

    let replacements;
    try {
      replacements = this._prepareMainlandCellReplacements(affected, nextIndex, candidateRegion);
    } catch (error) {
      this._restoreCellControl(target, previous, previousSceneId);
      this._showToast(`局部更新准备失败: ${error.message}`, 'error');
      return;
    }

    this._commitDraftState({
      draftWorldMap: candidateWorldMap,
      worldIndex: nextIndex,
      selectedRegionId: candidateRegion.id
    });
    this._commitMainlandCellReplacements(replacements, nextIndex);
    this._paintMainlandMinimapCells(affected, nextIndex);
    this._requestMainlandViewportSync();
  }

  _buildEditedRegionCell(previous, mapType, terrain, sceneId) {
    if (mapType === 'sceneGrid') {
      if (!sceneId) return null;
      if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return sceneId;
      const next = { ...previous, sceneId };
      delete next.terrain;
      const metadataKeys = Object.keys(next).filter(key => key !== 'sceneId');
      return metadataKeys.length > 0 ? next : sceneId;
    }
    if (!isWorldMapTerrain(terrain)) throw new TypeError(`无效地形: ${terrain}`);
    const next = previous && typeof previous === 'object' && !Array.isArray(previous)
      ? { ...previous }
      : {};
    next.terrain = terrain;
    if (sceneId) {
      next.sceneId = sceneId;
    } else {
      delete next.sceneId;
      delete next.reserved;
    }
    return next;
  }

  _restoreCellControl(target, previous, previousSceneId) {
    target.value = target.classList.contains('wme-terrain-select')
      ? this._cellTerrain(previous)
      : (previousSceneId || '');
  }

  _collectMainlandFootprintKeys(worldIndex, sceneId, target) {
    const footprint = sceneId ? worldIndex?.getFootprint(sceneId) : null;
    if (!footprint) return target;
    for (let row = footprint.top; row < footprint.bottom; row++) {
      for (let col = footprint.left; col < footprint.right; col++) {
        target.add(`${row},${col}`);
      }
    }
    return target;
  }

  _prepareMainlandCellReplacements(affected, worldIndex, region) {
    const grid = this._el.querySelector('.wme-grid');
    if (!grid || !this._mainlandMetrics) throw new Error('mainland 网格尚未初始化');
    return [...affected]
      .map(key => key.split(',').map(Number))
      .sort(([rowA, colA], [rowB, colB]) => rowA - rowB || colA - colB)
      .map(([row, col]) => {
        const oldCell = grid.querySelector(`.wme-cell[data-r="${row}"][data-c="${col}"]`);
        if (!oldCell) throw new Error(`找不到待更新单元 (${row}, ${col})`);
        const template = document.createElement('template');
        template.innerHTML = this._buildMainlandCellHtml({
          row,
          col,
          worldIndex,
          region,
          metrics: this._mainlandMetrics,
          terrainOptions: this._mainlandTerrainOptions,
          sceneOptions: this._mainlandSceneOptions
        }).trim();
        const newCell = template.content.firstElementChild;
        if (!newCell) throw new Error(`无法创建单元 (${row}, ${col})`);
        return { row, col, oldCell, newCell };
      });
  }

  _commitMainlandCellReplacements(replacements, worldIndex) {
    const { thumbW, thumbH } = this._mainlandMetrics;
    for (const replacement of replacements) replacement.oldCell.replaceWith(replacement.newCell);
    for (const { row, col, newCell } of replacements) {
      this._renderFootprintThumbnail(newCell, row, col, thumbW, thumbH, worldIndex);
    }
  }

  _paintMainlandMinimapCells(affected, worldIndex) {
    const params = this._minimapParams;
    const gc = params?.gc;
    const canvas = gc?.querySelector('.wme-minimap-canvas');
    if (!canvas || !this._isActiveMapRender({
      generation: params.generation,
      selectedRegionId: params.selectedRegionId,
      worldIndex,
      gc
    })) return;
    const ctx = canvas.getContext('2d');
    const cellW = canvas.width / this.region.cols;
    const cellH = canvas.height / this.region.rows;
    for (const key of affected) {
      const [row, col] = key.split(',').map(Number);
      const x = col * cellW;
      const y = row * cellH;
      ctx.fillStyle = this._cellBaseColor(this.region, this.region.grid[row]?.[col]);
      ctx.fillRect(x, y, cellW, cellH);
      const coverage = worldIndex.getCell(this.region.id, row, col);
      const cell = gc.querySelector(`.wme-cell[data-r="${row}"][data-c="${col}"]`);
      const thumbnail = cell?.querySelector('.wme-cell-canvas');
      if (coverage?.sceneId && thumbnail) {
        try { ctx.drawImage(thumbnail, x, y, cellW, cellH); } catch (_error) { /* 保留类型底色 */ }
      }
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = .5;
      ctx.strokeRect(x, y, cellW, cellH);
    }
  }

  _cellBaseColor(region, cell) {
    return region.mapType === 'sceneGrid'
      ? '#20252b'
      : this._terrainColor(this._cellTerrain(cell));
  }

  _mainlandScrollContainer() {
    return this.container.closest('#world-map-editor-page, .editor-main');
  }

  _teardownMainlandNavigation() {
    if (typeof this._mainlandNavigationCleanup === 'function') {
      this._mainlandNavigationCleanup();
    }
    this._mainlandNavigationCleanup = null;
    this._minimapParams = null;
    if (this._mainlandViewportFrameId != null) {
      cancelAnimationFrame(this._mainlandViewportFrameId);
      this._mainlandViewportFrameId = null;
    }
  }

  _bindMainlandMinimapNavigation(gc) {
    const minimap = gc.querySelector('.wme-minimap');
    const canvas = minimap?.querySelector('.wme-minimap-canvas');
    const viewport = minimap?.querySelector('.wme-minimap-viewport');
    const grid = gc.querySelector('.wme-grid');
    const scrollContainer = this._mainlandScrollContainer();
    if (!minimap || !canvas || !viewport || !grid || !scrollContainer) return false;

    let drag = null;
    const requestSync = () => this._requestMainlandViewportSync();
    const onPointerDown = event => {
      if (event.button !== 0) return;
      this._updateMainlandMinimapViewport();
      const frameRect = viewport.getBoundingClientRect();
      const inFrame = viewport.style.display !== 'none'
        && event.clientX >= frameRect.left
        && event.clientX <= frameRect.right
        && event.clientY >= frameRect.top
        && event.clientY <= frameRect.bottom;
      drag = {
        pointerId: event.pointerId,
        grabX: inFrame ? event.clientX - frameRect.left : frameRect.width / 2,
        grabY: inFrame ? event.clientY - frameRect.top : frameRect.height / 2
      };
      event.preventDefault();
      event.stopPropagation();
      minimap.style.cursor = 'grabbing';
      try { minimap.setPointerCapture?.(event.pointerId); } catch (_error) { /* pointer 已失效 */ }
      this._scrollMainlandFromMinimapPointer(event, drag);
    };
    const onPointerMove = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      this._scrollMainlandFromMinimapPointer(event, drag);
    };
    const finishDrag = event => {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const pointerId = drag.pointerId;
      drag = null;
      minimap.style.cursor = 'crosshair';
      try {
        if (minimap.hasPointerCapture?.(pointerId)) minimap.releasePointerCapture(pointerId);
      } catch (_error) { /* pointer 已自动释放 */ }
      requestSync();
    };

    scrollContainer.addEventListener('scroll', requestSync, { passive: true });
    minimap.addEventListener('pointerdown', onPointerDown);
    minimap.addEventListener('pointermove', onPointerMove);
    minimap.addEventListener('pointerup', finishDrag);
    minimap.addEventListener('pointercancel', finishDrag);
    minimap.addEventListener('lostpointercapture', finishDrag);
    window.addEventListener('resize', requestSync, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(requestSync)
      : null;
    resizeObserver?.observe(scrollContainer);
    resizeObserver?.observe(grid);
    resizeObserver?.observe(minimap);

    this._mainlandNavigationCleanup = () => {
      scrollContainer.removeEventListener('scroll', requestSync);
      minimap.removeEventListener('pointerdown', onPointerDown);
      minimap.removeEventListener('pointermove', onPointerMove);
      minimap.removeEventListener('pointerup', finishDrag);
      minimap.removeEventListener('pointercancel', finishDrag);
      minimap.removeEventListener('lostpointercapture', finishDrag);
      window.removeEventListener('resize', requestSync);
      resizeObserver?.disconnect();
      if (drag) {
        try {
          if (minimap.hasPointerCapture?.(drag.pointerId)) minimap.releasePointerCapture(drag.pointerId);
        } catch (_error) { /* pointer 已自动释放 */ }
        drag = null;
      }
    };
    this._updateMainlandMinimapViewport();
    return true;
  }

  _requestMainlandViewportSync() {
    if (this._mainlandViewportFrameId != null) return;
    this._mainlandViewportFrameId = requestAnimationFrame(() => {
      this._mainlandViewportFrameId = null;
      this._updateMainlandMinimapViewport();
    });
  }

  _updateMainlandMinimapViewport() {
    const gc = this._minimapParams?.gc;
    const minimap = gc?.querySelector('.wme-minimap');
    const canvas = minimap?.querySelector('.wme-minimap-canvas');
    const viewport = minimap?.querySelector('.wme-minimap-viewport');
    const grid = gc?.querySelector('.wme-grid');
    const scrollContainer = this._mainlandScrollContainer();
    if (!canvas || !viewport || !grid || !scrollContainer) return false;

    const gridRect = grid.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();
    if (gridRect.width <= 0 || gridRect.height <= 0 || canvasRect.width <= 0 || canvasRect.height <= 0) {
      viewport.style.display = 'none';
      return false;
    }
    const viewLeft = scrollRect.left + scrollContainer.clientLeft;
    const viewTop = scrollRect.top + scrollContainer.clientTop;
    const viewRight = viewLeft + scrollContainer.clientWidth;
    const viewBottom = viewTop + scrollContainer.clientHeight;
    const visibleLeft = Math.max(gridRect.left, viewLeft);
    const visibleTop = Math.max(gridRect.top, viewTop);
    const visibleRight = Math.min(gridRect.right, viewRight);
    const visibleBottom = Math.min(gridRect.bottom, viewBottom);
    if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
      viewport.style.display = 'none';
      return false;
    }

    viewport.style.display = 'block';
    viewport.style.left = `${((visibleLeft - gridRect.left) / gridRect.width) * canvasRect.width}px`;
    viewport.style.top = `${((visibleTop - gridRect.top) / gridRect.height) * canvasRect.height}px`;
    viewport.style.width = `${((visibleRight - visibleLeft) / gridRect.width) * canvasRect.width}px`;
    viewport.style.height = `${((visibleBottom - visibleTop) / gridRect.height) * canvasRect.height}px`;
    return true;
  }

  _scrollMainlandFromMinimapPointer(event, drag) {
    const gc = this._minimapParams?.gc;
    const canvas = gc?.querySelector('.wme-minimap-canvas');
    const viewport = gc?.querySelector('.wme-minimap-viewport');
    const grid = gc?.querySelector('.wme-grid');
    const scrollContainer = this._mainlandScrollContainer();
    if (!canvas || !viewport || !grid || !scrollContainer) return false;

    const canvasRect = canvas.getBoundingClientRect();
    const frameRect = viewport.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0 || gridRect.width <= 0 || gridRect.height <= 0) return false;

    const frameWidth = Math.min(canvasRect.width, Math.max(1, frameRect.width));
    const frameHeight = Math.min(canvasRect.height, Math.max(1, frameRect.height));
    const frameLeft = Math.max(0, Math.min(canvasRect.width - frameWidth, event.clientX - canvasRect.left - drag.grabX));
    const frameTop = Math.max(0, Math.min(canvasRect.height - frameHeight, event.clientY - canvasRect.top - drag.grabY));
    const normalizedLeft = frameLeft / canvasRect.width;
    const normalizedTop = frameTop / canvasRect.height;
    const viewLeft = scrollRect.left + scrollContainer.clientLeft;
    const viewTop = scrollRect.top + scrollContainer.clientTop;
    const gridContentLeft = scrollContainer.scrollLeft + gridRect.left - viewLeft;
    const gridContentTop = scrollContainer.scrollTop + gridRect.top - viewTop;
    const targetLeft = gridContentLeft + normalizedLeft * gridRect.width;
    const targetTop = gridContentTop + normalizedTop * gridRect.height;
    const maxLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
    const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    scrollContainer.scrollTo({
      left: Math.max(0, Math.min(maxLeft, targetLeft)),
      top: Math.max(0, Math.min(maxTop, targetTop)),
      behavior: 'auto'
    });
    this._requestMainlandViewportSync();
    return true;
  }

  /** 将滚动视口定位到所有 scene anchor/footprint coverage 的包围盒中心。 */
  _focusUsedArea({ smooth = false } = {}) {
    const scrollContainer = this.container.closest('#world-map-editor-page, .editor-main');
    if (!scrollContainer || typeof scrollContainer.scrollTo !== 'function') return false;
    const cells = [...this._el.querySelectorAll('.wme-cell')].filter(cell => {
      const row = Number(cell.dataset.r);
      const col = Number(cell.dataset.c);
      return Boolean(this._draftIndex?.getCell(this.region.id, row, col)?.sceneId);
    });
    if (cells.length === 0) return false;

    const containerRect = scrollContainer.getBoundingClientRect();
    const rects = cells.map(cell => cell.getBoundingClientRect());
    const left = Math.min(...rects.map(rect => rect.left));
    const right = Math.max(...rects.map(rect => rect.right));
    const top = Math.min(...rects.map(rect => rect.top));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    scrollContainer.scrollTo({
      left: Math.max(0, scrollContainer.scrollLeft + (left + right) / 2 - containerRect.left - scrollContainer.clientWidth / 2),
      top: Math.max(0, scrollContainer.scrollTop + (top + bottom) / 2 - containerRect.top - scrollContainer.clientHeight / 2),
      behavior: smooth ? 'smooth' : 'auto'
    });
    return true;
  }

  _terrainColor(terrain) {
    return ({
      mountain: '#554b42',
      yellowRiver: '#8c7650',
      forest: '#31523a',
      plain: '#6c6546'
    })[terrain] || '#2b2b2b';
  }

  _renderFootprintThumbnail(cell, row, col, thumbW, thumbH, worldIndex, renderContext = null) {
    const context = renderContext || {
      generation: this._renderGeneration,
      selectedRegionId: this.selectedRegionId
    };
    if (!cell?.isConnected || !this._isActiveMapRender({
      generation: context.generation,
      selectedRegionId: context.selectedRegionId,
      worldIndex
    })) return;
    const canvas = cell.querySelector('.wme-cell-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const raw = this.region.grid[row]?.[col] ?? null;
    ctx.clearRect(0, 0, thumbW, thumbH);
    ctx.fillStyle = this._cellBaseColor(this.region, raw);
    ctx.fillRect(0, 0, thumbW, thumbH);
    const coverage = worldIndex.getCell(this.region.id, row, col);
    if (!coverage?.sceneId) {
      if (this.region.mapType === 'sceneGrid') {
        ctx.strokeStyle = 'rgba(255,255,255,.15)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(thumbW, thumbH);
        ctx.moveTo(thumbW, 0);
        ctx.lineTo(0, thumbH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    const anchor = worldIndex.findScene(coverage.sceneId);
    if (!anchor || (coverage.reserved && !coverage.isAnchor)) return;
    if (coverage.reserved) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, thumbW, thumbH);
      ctx.strokeStyle = '#c9ad7a';
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(3, 3, thumbW - 6, thumbH - 6);
      ctx.setLineDash([]);
      return;
    }
    const scene = this._getSceneData(anchor.sceneId);
    if (!scene) return;
    const footprint = anchor.footprint;
    const totalW = thumbW * footprint.cols;
    const totalH = thumbH * footprint.rows;
    const offsetX = (col - anchor.col) * thumbW;
    const offsetY = (row - anchor.row) * thumbH;
    this._ensureImagesLoaded(scene, () => {
      if (!cell.isConnected || !this._isActiveMapRender({
        generation: context.generation,
        selectedRegionId: context.selectedRegionId,
        worldIndex
      })) return;
      this._renderFootprintThumbnail(cell, row, col, thumbW, thumbH, worldIndex, context);
      this._refreshMainlandMinimap(context);
    });
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, thumbW, thumbH);
    ctx.clip();
    ctx.translate(-offsetX, -offsetY);
    this._drawSceneToCanvas(ctx, scene, totalW, totalH);
    ctx.restore();
    if (!coverage.isAnchor) {
      ctx.fillStyle = 'rgba(196,166,78,.12)';
      ctx.fillRect(0, 0, thumbW, thumbH);
    }
  }

  _renderMainlandMinimap(gc, worldIndex) {
    const params = this._minimapParams;
    if (!params || !this._isActiveMapRender({
      generation: params.generation,
      selectedRegionId: params.selectedRegionId,
      worldIndex,
      gc
    })) return;
    const canvas = gc.querySelector('.wme-minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cellW = canvas.width / this.region.cols;
    const cellH = canvas.height / this.region.rows;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < this.region.rows; row++) {
      for (let col = 0; col < this.region.cols; col++) {
        const x = col * cellW;
        const y = row * cellH;
        ctx.fillStyle = this._cellBaseColor(this.region, this.region.grid[row]?.[col]);
        ctx.fillRect(x, y, cellW, cellH);
        const coverage = worldIndex.getCell(this.region.id, row, col);
        const cell = gc.querySelector(`.wme-cell[data-r="${row}"][data-c="${col}"]`);
        const thumbnail = cell?.querySelector('.wme-cell-canvas');
        if (coverage?.sceneId && thumbnail) {
          try { ctx.drawImage(thumbnail, x, y, cellW, cellH); } catch (_error) { /* 保留类型底色 */ }
        }
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.lineWidth = .5;
        ctx.strokeRect(x, y, cellW, cellH);
      }
    }
  }

  _refreshMainlandMinimap(renderContext = null) {
    const params = this._minimapParams;
    const context = renderContext || params;
    if (!params?.gc || !params?.draftIndex || !context) return;
    requestAnimationFrame(() => {
      if (!this._isActiveMapRender({
        generation: context.generation,
        selectedRegionId: context.selectedRegionId,
        worldIndex: params.draftIndex,
        gc: params.gc
      })) return;
      this._renderMainlandMinimap(params.gc, params.draftIndex);
    });
  }

  /**
   * 把场景数据绘制到 canvas（与场景编辑器完全一致的渲染）
   * @private
   */
  _drawSceneToCanvas(ctx, scene, thumbW, thumbH) {
    const sceneW = scene.width || this.region.chunkWidth;
    const sceneH = scene.height || this.region.chunkHeight;
    const scale = Math.min(thumbW / sceneW, thumbH / sceneH);

    ctx.clearRect(0, 0, thumbW, thumbH);

    // 背景色
    ctx.fillStyle = scene.backgroundColor || '#1a2a1a';
    ctx.fillRect(0, 0, thumbW, thumbH);

    const atlasRegistry = new AtlasRegistry(
      this._sharedAtlases,
      Array.isArray(scene.atlases) ? scene.atlases : []
    );
    const sharedDecoSprites = this._createAtlasSliceProjection(
      atlasRegistry.getAtlas('mountain_landscape')
    );

    // 缩略图与主场景编辑器共用 AtlasRegistry；完整定义不写入场景。
    const fakeEditor = {
      sceneData: {
        ...scene,
        decoSprites: {
          ...(scene.decoSprites || {}),
          ...sharedDecoSprites
        }
      },
      viewport: { scale: 1, offsetX: 0, offsetY: 0 },
      options: { showGrid: false, showBackground: true },
      loadedImages: this._loadedImages,
      selectedObjects: [],
      activeLayerIndex: 0,
      getAvailableAtlases: () => atlasRegistry.getAll(),
      getAtlasDefinition: atlasId => atlasRegistry.getAtlas(atlasId),
      getAtlasSlice: (atlasId, sliceKey) => atlasRegistry.getSlice(atlasId, sliceKey)
    };

    if (!this._canvasRenderer) {
      this._canvasRenderer = new SceneEditorCanvas(fakeEditor);
    } else {
      this._canvasRenderer.editor = fakeEditor;
      // 清除缓存的 resolver，让它用新 editor 的 loadedImages
      this._canvasRenderer._shapeResolverObj = null;
    }
    const renderer = this._canvasRenderer;

    // 缩放到场景坐标系
    ctx.save();
    const sceneX = 0;
    const sceneY = 0;
    ctx.scale(scale, scale);
    ctx.translate(-sceneX, -sceneY);

    // 按图层顺序渲染
    if (Array.isArray(scene.layers)) {
      for (const layer of scene.layers) {
        if (layer.visible === false) continue;
        if (!Array.isArray(layer.objects)) continue;
        const lid = (layer.id || '').toLowerCase();
        if (/logic|placement/.test(lid)) continue;

        for (const obj of layer.objects) {
          if (obj.type === 'region' || obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc' || obj.type === 'ref') continue;
          try {
            renderer._renderObject(ctx, obj);
          } catch (e) { /* 静默 */ }
        }
      }
    }

    ctx.restore();
  }

  /**
   * 确保场景所需的图集/图片已加载到 _loadedImages 缓存
   * @private
   */
  _ensureImagesLoaded(scene, onComplete) {
    if (!this._loadedImages) this._loadedImages = new Map();
    const toLoad = [];

    // 地形图集（terrain_atlas）
    const terrainImg = scene.terrain && scene.terrain.image;
    if (terrainImg && !this._loadedImages.has('terrain_atlas')) {
      toLoad.push({ id: 'terrain_atlas', src: terrainImg });
    }

    // 场景图集列表
    if (Array.isArray(scene.atlases)) {
      for (const atlas of scene.atlases) {
        if (atlas.id && atlas.path && !this._loadedImages.has(atlas.id)) {
          toLoad.push({ id: atlas.id, src: atlas.path });
        }
      }
    }

    // 场景内嵌图片（imageAssets）
    if (scene.imageAssets) {
      for (const [id, asset] of Object.entries(scene.imageAssets)) {
        if (!this._loadedImages.has(id)) {
          const src = typeof asset === 'string' ? asset : (asset && asset.src);
          if (src) toLoad.push({ id, src: this._resolveImagePath(src) });
        }
      }
    }

    if (toLoad.length === 0) return;

    let loaded = 0;
    for (const item of toLoad) {
      const img = new Image();
      img.onload = () => {
        this._loadedImages.set(item.id, img);
        loaded++;
        if (loaded >= toLoad.length && onComplete) onComplete();
      };
      img.onerror = () => {
        loaded++;
        if (loaded >= toLoad.length && onComplete) onComplete();
      };
      img.src = this._resolveImagePath(item.src);
    }
  }

  /**
   * 解析当前游戏 assets/ 相对路径；绝对 URL 与编辑器相对路径保持原样。
   * @private
   */
  _resolveImagePath(src) {
    const path = String(src || '').replace(/\\/g, '/');
    if (!path || /^(?:https?:|data:|blob:|\/|\.\.?\/)/.test(path)) return path;
    const basePath = this.projectPath.slice(0, this.projectPath.lastIndexOf('/') + 1);
    return path.startsWith('assets/') ? `/${basePath}${path}` : path;
  }

  _showToast(msg, type = 'success') {
    const t = this._el.querySelector('.wme-toast');
    if (!t) return;
    const backgrounds = {
      success: '#2e7d32',
      warn: '#9a6700',
      error: '#b3261e'
    };
    t.textContent = msg;
    t.dataset.type = type;
    t.style.cssText = `display:block;position:fixed;bottom:20px;right:20px;background:${backgrounds[type] || backgrounds.success};color:#fff;padding:10px 20px;border-radius:6px;z-index:99999;`;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      t.style.display = 'none';
      this._toastTimer = null;
    }, 2500);
  }

  _isCompleteSceneData(scene, sceneId) {
    return scene?.id === sceneId
      && Array.isArray(scene.layers)
      && scene.imageAssets !== null
      && typeof scene.imageAssets === 'object'
      && !Array.isArray(scene.imageAssets);
  }

  /**
   * 磁盘场景优先；仅在磁盘读取失败时使用完整的 localStorage 场景缓存。
   * @private
   */
  _getSceneData(sceneId) {
    const diskScene = this._sceneDataById.get(sceneId);
    if (this._isCompleteSceneData(diskScene, sceneId)) return diskScene;
    try {
      const raw = localStorage.getItem('yijian18-engine_editor_data_scenes_' + this.gameId);
      if (!raw) return null;
      const scenes = JSON.parse(raw);
      if (!Array.isArray(scenes)) return null;
      const cachedScene = scenes.find(scene => scene?.id === sceneId);
      return this._isCompleteSceneData(cachedScene, sceneId) ? cachedScene : null;
    } catch (error) {
      return null;
    }
  }
}


export default WorldMapEditor;

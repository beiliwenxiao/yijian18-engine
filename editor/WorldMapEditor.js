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
  getWorldMapCellSceneId,
  getWorldMapCellTerrain,
  isReservedWorldMapCell,
  isWorldMapTerrain,
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
 * WorldMapEditor - 大地图块编辑器 Tab（P5-5）
 *
 * 功能：
 *   - 唯一 mainland 20×20 terrain 网格编辑
 *   - 每格分配已有 scene anchor 或移除 anchor
 *   - 场景根 width/height 自动派生只读 footprint coverage
 *   - 磁盘 canonical 场景缩略图与全局缩略预览
 *   - 通过共享 CanonicalEditorSession 提交 game.project.json 的 worldMap 字段
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
    this._sceneDataById = new Map();
    this._repositorySceneIds = null;
    this._loadedImages = new Map();
    this._sharedAtlases = [];
    this._atlasRegistry = new AtlasRegistry();
    this._defaultDecoSprites = {};
    this._atlasLoadGeneration = 0;

    // 项目加载前不生成 Demo 尺寸或入口；加载成功后只从 ProjectWorldIndex 投影可编辑草稿。
    this.region = { id: '', name: '', chunkWidth: '', chunkHeight: '', cols: 0, rows: 0, grid: [] };

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
      this.project = null;
      this.worldIndex = null;
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

  /** 从 game.project.json 与磁盘 canonical 场景加载唯一 mainland 地图。 */
  async loadFromProject() {
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
    try {
      this.worldIndex = this._buildWorldIndex(this.project);
    } catch (error) {
      console.warn('[WorldMapEditor] 世界索引校验失败', error?.errors || error);
      this._showToast?.(error?.errors?.[0]?.message || error.message, 'error');
      return;
    }

    const mainland = this.worldIndex.getRegion(0);
    if (this.worldIndex.regions.length !== 1 || !this._isMainlandLayout(mainland)) {
      this._showToast?.('《三国张角传》世界地图必须且只能包含一个 20×20 mainland Region', 'error');
      return;
    }
    this._currentRegionIndex = 0;
    this.region = this._createRegionDraft(mainland);
    try {
      this._normalizeGrid();
      this.worldIndex = this._buildDraftIndex();
    } catch (error) {
      this._showToast?.(error?.errors?.[0]?.message || error.message, 'error');
      return;
    }
    this._populateRegionSelect();
    this._el.querySelector('.wme-region-name').value = this.region.name || '';
    this._render();
  }

  _createRegionDraft(indexedRegion) {
    const source = this.project?.worldMap?.regions?.[indexedRegion.regionIndex];
    if (!source) throw new Error(`无法找到 Region 草稿: ${indexedRegion.id}`);
    return structuredClone(source);
  }

  _isMainlandLayout(region) {
    return region?.id === 'mainland'
      && region.rows === 20
      && region.cols === 20;
  }

  _buildWorldIndex(project) {
    return ProjectWorldIndex.build(project, {
      requireSceneDimensions: true
    });
  }

  _buildDraftIndex() {
    const candidate = structuredClone(this.project);
    candidate.worldMap.regions = [structuredClone(this.region)];
    return this._buildWorldIndex(candidate);
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
    return this.worldIndex
      ? this.worldIndex.regions.flatMap(region => this.worldIndex.getCells(region.id).map(cell => cell.sceneId))
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
    if (!this.project) {
      this._showToast('无工程数据，请先加载', 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'missingProject' };
    }

    const candidate = structuredClone(this.project);
    if (!candidate.worldMap || !Array.isArray(candidate.worldMap.regions)) {
      this._showToast('项目缺少 canonical worldMap.regions', 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'missingWorldMap' };
    }
    if (candidate.worldMap.regions.length !== 1 || !this._isMainlandLayout(this.region)) {
      this._showToast('《三国张角传》只允许一个 20×20 mainland 世界地图', 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidMainlandLayout' };
    }
    let normalizedRegion;
    try {
      normalizedRegion = this._normalizeGrid(structuredClone(this.region));
    } catch (error) {
      this._showToast(error.message, 'error');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidMainlandLayout', error };
    }
    candidate.worldMap.regions = [normalizedRegion];
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
      this.canonicalSession.patch('worldMap', structuredClone(candidate.worldMap));
      const result = await this.canonicalSession.save();
      if (result?.ok !== true || result.committed !== true) {
        const firstError = result?.errors?.[0];
        const message = [firstError?.path, firstError?.message || firstError?.reason]
          .filter(Boolean)
          .join(': ') || result?.error?.message || result?.error || '磁盘未提交';
        this._showToast(`保存失败: ${message}`, 'error');
        return result;
      }
      this.project = structuredClone(this.canonicalSession.getValue() || candidate);
      this.region = structuredClone(this.project.worldMap.regions[0]);
      this.worldIndex = this._buildWorldIndex(this.project);
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

  /** 将唯一 mainland 草稿补齐为显式 terrain 单元，不推断或裁剪非法布局。 */
  _normalizeGrid(region = this.region) {
    if (!this._isMainlandLayout(region)) {
      throw new TypeError('《三国张角传》只允许编辑一个 20×20 mainland 世界地图');
    }
    if (!Array.isArray(region.grid)) {
      throw new TypeError('mainland.grid 必须是数组');
    }
    if (region.grid.length > region.rows) return region;

    while (region.grid.length < region.rows) region.grid.push([]);
    for (let row = 0; row < region.rows; row++) {
      const sourceRow = region.grid[row];
      if (sourceRow == null) {
        region.grid[row] = [];
      } else if (!Array.isArray(sourceRow)) {
        throw new TypeError(`mainland.grid[${row}] 必须是数组`);
      }
      const cells = region.grid[row];
      if (cells.length > region.cols) continue;
      while (cells.length < region.cols) cells.push(this._terrainCell('plain'));
      for (let col = 0; col < region.cols; col++) {
        const raw = cells[col];
        if (raw == null) {
          cells[col] = this._terrainCell('plain');
          continue;
        }
        if (typeof raw === 'string') {
          cells[col] = this._terrainCell('plain', raw);
          continue;
        }
        if (typeof raw === 'object' && !Array.isArray(raw)
          && !Object.hasOwn(raw, 'terrain')
          && getWorldMapCellSceneId(raw, { includeReserved: true })) {
          cells[col] = { ...raw, terrain: 'plain' };
        }
      }
    }
    return region;
  }

  _buildHTML() {
    return `
      <div class="wme-toolbar" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0;">
        <strong style="color:#d9c28d;">世界地图：mainland（20×20）</strong>
        <span style="color:#777;">场景 anchor 由左上角定位，尺寸自动派生 footprint</span>
        <span style="margin:0 8px;color:#555;">|</span>
        <label>名称: <input type="text" class="wme-region-name" value="${this.region.name || ''}" /></label>
        <label>Chunk: <input type="number" class="wme-chunk-w" value="${this.region.chunkWidth}" readonly style="width:74px;" /> × <input type="number" class="wme-chunk-h" value="${this.region.chunkHeight}" readonly style="width:64px;" /></label>
        <button class="wme-focus-used">◎ 定位场景</button>
        <button class="wme-save">💾 保存</button>
      </div>
      <div class="wme-grid-container" style="position:relative;"></div>
      <div class="wme-toast" style="display:none;"></div>
    `;
  }

  _bindEvents() {
    this._el.querySelector('.wme-save').onclick = async () => {
      await this.save();
    };
    this._el.querySelector('.wme-focus-used').onclick = () => this._focusUsedArea({ smooth: true });
    this._el.querySelector('.wme-region-name').oninput = event => {
      this.region.name = event.target.value;
    };
  }

  /** mainland 尺寸固定为 20×20，旧尺寸编辑入口不再改变草稿。 */
  _applySize() {
    return this._rejectMainlandMutation('mainland 尺寸固定为 20×20，不能修改', 'fixedMainlandSize');
  }

  /** mainland 是唯一 Region；仅允许保留当前选择的 no-op。 */
  _switchRegion(index) {
    if (index === 0 && this._isMainlandLayout(this.region)) {
      this._currentRegionIndex = 0;
      return { ok: true, status: 'noop', code: 'mainlandAlreadySelected' };
    }
    return this._rejectMainlandMutation('《三国张角传》只允许 mainland Region，不能切换其他 Region', 'singleMainlandOnly');
  }

  /** mainland-only 编辑器禁止创建第二个 Region。 */
  _addNewRegion() {
    return this._rejectMainlandMutation('《三国张角传》只允许一个 mainland Region，不能新增 Region', 'singleMainlandOnly');
  }

  /** 已移除 Region 下拉；保留私有兼容入口以避免旧宿主调用时报错。 */
  _populateRegionSelect() {
    return { ok: true, status: 'noop', code: 'mainlandSelectorRemoved' };
  }

  _rejectMainlandMutation(message, code) {
    this._showToast(message, 'warn');
    return { ok: false, committed: false, status: 'rejected', code };
  }

  /** 渲染唯一 mainland 的 terrain 格、scene anchor 与只读 footprint coverage。 */
  _render() {
    return this._renderMainland();
  }

  _renderMainland() {
    const gc = this._el.querySelector('.wme-grid-container');
    if (!gc) return;
    let draftIndex;
    try {
      draftIndex = this._buildDraftIndex();
    } catch (error) {
      this._showToast(error?.errors?.[0]?.message || error.message, 'error');
      return;
    }

    const thumbW = 256;
    const thumbH = Math.round(thumbW * (this.region.chunkHeight / this.region.chunkWidth));
    const metrics = { thumbW, thumbH, labelH: 20, cellH: thumbH + 20 };
    const terrainOptions = WORLD_MAP_TERRAINS.map(terrain => (
      `<option value="${terrain}">${terrain}</option>`
    )).join('');
    const sceneOptions = ['<option value="">（无场景 anchor）</option>']
      .concat(this.availableScenes.map(sceneId => `<option value="${sceneId}">${sceneId}</option>`))
      .join('');

    let html = '<style>.wme-grid>.wme-cell:hover>.wme-cell-overlay{display:flex!important}</style>';
    html += `<div class="wme-grid" style="display:grid;grid-template-columns:repeat(${this.region.cols},${thumbW}px);gap:2px;width:max-content;">`;
    for (let row = 0; row < this.region.rows; row++) {
      for (let col = 0; col < this.region.cols; col++) {
        html += this._buildMainlandCellHtml({
          row,
          col,
          worldIndex: draftIndex,
          region: this.region,
          metrics,
          terrainOptions,
          sceneOptions
        });
      }
    }
    html += '</div>';
    html += `<div style="margin-top:8px;color:#aaa;font-size:12px;">mainland · 20×20 格 · 基准块 ${this.region.chunkWidth}×${this.region.chunkHeight}px · 大场景 footprint 由 canonical width/height 自动计算</div>`;
    html += `
      <div class="wme-minimap" title="点击定位，拖动选框移动主地图"
           style="position:fixed;top:60px;right:24px;width:220px;height:220px;background:rgba(20,15,10,.94);border:2px solid #8b7355;border-radius:4px;overflow:hidden;pointer-events:auto;touch-action:none;user-select:none;cursor:crosshair;z-index:10;">
        <canvas class="wme-minimap-canvas" width="220" height="220" style="width:100%;height:100%;pointer-events:none;"></canvas>
        <div class="wme-minimap-viewport" style="display:none;position:absolute;box-sizing:border-box;border:2px solid #f6e7a8;background:rgba(246,231,168,.10);box-shadow:0 0 0 1px rgba(0,0,0,.85),0 0 8px rgba(246,231,168,.75);pointer-events:none;z-index:1;"></div>
      </div>`;

    this._teardownMainlandNavigation();
    gc.innerHTML = html;
    this._draftIndex = draftIndex;
    this._mainlandMetrics = metrics;
    this._mainlandTerrainOptions = terrainOptions;
    this._mainlandSceneOptions = sceneOptions;

    const grid = gc.querySelector('.wme-grid');
    if (grid) grid.onchange = event => this._handleMainlandCellChange(event);
    gc.querySelectorAll('.wme-cell').forEach(cell => {
      const row = Number(cell.dataset.r);
      const col = Number(cell.dataset.c);
      this._renderFootprintThumbnail(cell, row, col, thumbW, thumbH, draftIndex);
    });

    this._minimapParams = { gc, thumbW, thumbH, draftIndex };
    this._bindMainlandMinimapNavigation(gc);
    requestAnimationFrame(() => {
      if (this._minimapParams?.gc !== gc) return;
      this._renderMainlandMinimap(gc, draftIndex);
      this._focusUsedArea();
      this._requestMainlandViewportSync();
    });
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
    const label = isCoverage && anchor
      ? `${sceneId} · 覆盖 ← (${anchor.row},${anchor.col})`
      : (isAnchor ? `${sceneId}${reserved ? ' · 预留' : ' · anchor'}` : terrain);
    const control = isCoverage
      ? '<div style="font-size:10px;color:#b7a778;text-align:center;line-height:1.4;">footprint 覆盖格<br>由 anchor 管理</div>'
      : `<label style="font-size:10px;color:#ddd;display:grid;gap:2px;width:94%;">地形
          <select class="wme-terrain-select" data-r="${row}" data-c="${col}" style="font-size:10px;background:#222;color:#eee;">${terrainOptions.replace(`value="${terrain}"`, `value="${terrain}" selected`)}</select>
        </label>
        <label style="font-size:10px;color:#ddd;display:grid;gap:2px;width:94%;">场景 anchor
          <select class="wme-scene-select" data-r="${row}" data-c="${col}" style="font-size:10px;background:#222;color:#eee;">${sceneOptions.replace(`value="${sceneId || ''}"`, `value="${sceneId || ''}" selected`)}</select>
        </label>`;

    return `
      <div class="wme-cell${isCoverage ? ' wme-footprint-coverage' : ''}" data-r="${row}" data-c="${col}"
           style="width:${thumbW}px;height:${cellH}px;border:1px solid ${isCoverage ? '#c4a64e' : '#444'};position:relative;overflow:hidden;background:#111;">
        <canvas class="wme-cell-canvas" width="${thumbW}" height="${thumbH}" style="position:absolute;top:0;left:0;width:${thumbW}px;height:${thumbH}px;"></canvas>
        <span class="wme-cell-label" title="${label}" style="position:absolute;top:${thumbH}px;left:0;right:0;height:${labelH}px;box-sizing:border-box;border-top:1px solid rgba(255,255,255,.16);font-size:10px;line-height:${labelH - 1}px;color:#ddd;background:rgba(0,0,0,.82);text-align:center;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
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
    const previousCoverage = this._draftIndex.getCell(this.region.id, row, col);
    if (previousCoverage?.sceneId && !previousCoverage.isAnchor) return;

    const previous = this.region.grid[row]?.[col] ?? null;
    const previousSceneId = getWorldMapCellSceneId(previous, { includeReserved: true });
    const terrain = target.classList.contains('wme-terrain-select')
      ? target.value
      : this._cellTerrain(previous);
    const selectedSceneId = target.classList.contains('wme-scene-select')
      ? (target.value || null)
      : previousSceneId;
    const reserved = isReservedWorldMapCell(previous) && Boolean(selectedSceneId);
    const candidateRegion = structuredClone(this.region);
    candidateRegion.grid[row][col] = this._terrainCell(terrain, selectedSceneId, reserved);
    const candidateProject = structuredClone(this.project);
    candidateProject.worldMap.regions = [structuredClone(candidateRegion)];

    let nextIndex;
    try {
      nextIndex = this._buildWorldIndex(candidateProject);
    } catch (error) {
      target.value = target.classList.contains('wme-terrain-select')
        ? this._cellTerrain(previous)
        : (previousSceneId || '');
      this._showToast(error?.errors?.[0]?.message || error.message, 'error');
      return;
    }

    const affected = new Set([`${row},${col}`]);
    if (previousSceneId !== selectedSceneId) {
      this._collectMainlandFootprintKeys(this._draftIndex, previousSceneId, affected);
      this._collectMainlandFootprintKeys(nextIndex, selectedSceneId, affected);
    }

    let replacements;
    try {
      replacements = this._prepareMainlandCellReplacements(affected, nextIndex, candidateRegion);
    } catch (error) {
      target.value = target.classList.contains('wme-terrain-select')
        ? this._cellTerrain(previous)
        : (previousSceneId || '');
      this._showToast(`局部更新准备失败: ${error.message}`, 'error');
      return;
    }

    this.region = candidateRegion;
    this._draftIndex = nextIndex;
    if (this._minimapParams) this._minimapParams.draftIndex = nextIndex;
    this._commitMainlandCellReplacements(replacements, nextIndex);
    this._paintMainlandMinimapCells(affected, nextIndex);
    this._requestMainlandViewportSync();
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
    const gc = this._minimapParams?.gc;
    const canvas = gc?.querySelector('.wme-minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cellW = canvas.width / this.region.cols;
    const cellH = canvas.height / this.region.rows;
    for (const key of affected) {
      const [row, col] = key.split(',').map(Number);
      const x = col * cellW;
      const y = row * cellH;
      ctx.fillStyle = this._terrainColor(this._cellTerrain(this.region.grid[row]?.[col]));
      ctx.fillRect(x, y, cellW, cellH);
      const coverage = worldIndex.getCell(this.region.id, row, col);
      const cell = gc.querySelector(`.wme-cell[data-r="${row}"][data-c="${col}"]`);
      const thumbnail = cell?.querySelector('.wme-cell-canvas');
      if (coverage?.sceneId && thumbnail) {
        try { ctx.drawImage(thumbnail, x, y, cellW, cellH); } catch (_error) { /* 保留地形底色 */ }
      }
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = .5;
      ctx.strokeRect(x, y, cellW, cellH);
    }
  }

  _mainlandScrollContainer() {
    return this.container.closest('#world-map-editor-page, .editor-main');
  }

  _teardownMainlandNavigation() {
    if (typeof this._mainlandNavigationCleanup === 'function') {
      this._mainlandNavigationCleanup();
    }
    this._mainlandNavigationCleanup = null;
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

  _renderLegacy() {
    const gc = this._el.querySelector('.wme-grid-container');
    if (!gc) return;

    // 缩略图宽度固定 256，高度按 chunk 宽高比
    const thumbW = 256;
    const thumbH = Math.round(thumbW * (this.region.chunkHeight / this.region.chunkWidth));

    const sceneOpts = ['<option value="">(空)</option>']
      .concat(this.availableScenes.map(id => `<option value="${id}">${id}</option>`))
      .join('');

    let html = `<div class="wme-grid" style="display:grid;grid-template-columns:repeat(${this.region.cols},${thumbW}px);gap:4px;width:max-content;">`;
    for (let r = 0; r < this.region.rows; r++) {
      for (let c = 0; c < this.region.cols; c++) {
        const cellValue = (this.region.grid[r] && this.region.grid[r][c]) || null;
        const sceneId = getWorldMapCellSceneId(cellValue, { includeReserved: true });
        const reserved = isReservedWorldMapCell(cellValue);
        const cellLabel = sceneId ? `${sceneId}${reserved ? '（预留）' : ''}` : '(空)';
        const cellSceneOpts = reserved && sceneId && !this.availableScenes.includes(sceneId)
          ? `${sceneOpts}<option value="${sceneId}">${sceneId}（预留，未加载）</option>`
          : sceneOpts;
        html += `
          <div class="wme-cell" data-r="${r}" data-c="${c}"
               style="width:${thumbW}px;height:${thumbH}px;
                      border:1px solid #444;border-radius:4px;position:relative;
                      cursor:pointer;overflow:hidden;background:#111;">
            <canvas class="wme-cell-canvas" width="${thumbW}" height="${thumbH}"
                    style="position:absolute;inset:0;width:100%;height:100%;"></canvas>
            <span class="wme-cell-label" style="position:absolute;bottom:0;left:0;right:0;
                  font-size:10px;color:#ccc;background:rgba(0,0,0,0.6);
                  text-align:center;padding:2px 0;pointer-events:none;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${cellLabel}
            </span>
            <div class="wme-cell-overlay" style="display:none;position:absolute;inset:0;
                 background:rgba(0,0,0,0.7);flex-direction:column;align-items:center;
                 justify-content:center;gap:6px;padding:8px;border-radius:4px;">
              <div style="font-size:11px;color:#8cf;font-weight:bold;">(${r}, ${c})</div>
              <select class="wme-cell-select" data-r="${r}" data-c="${c}"
                      style="width:92%;font-size:11px;background:#222;color:#eee;border:1px solid #666;
                             border-radius:3px;padding:3px;">
                ${cellSceneOpts.replace(`value="${sceneId}"`, `value="${sceneId}" selected`)}
              </select>
            </div>
          </div>`;
      }
    }
    html += '</div>';
    html += `<div style="margin-top:8px;color:#aaa;font-size:12px;">${this.region.cols}×${this.region.rows} 格，chunk ${this.region.chunkWidth}×${this.region.chunkHeight}px</div>`;
    // 计算小地图外框比例与地图有效区域一致
    const mmMaxDim = 180;
    let mmUsedCols = this.region.cols, mmUsedRows = this.region.rows;
    // 找有效范围
    let _maxC = 0, _maxR = 0;
    for (let r = 0; r < this.region.rows; r++) {
      if (!this.region.grid[r]) continue;
      for (let c = 0; c < this.region.cols; c++) {
        if (this.region.grid[r][c]) { if (c + 1 > _maxC) _maxC = c + 1; if (r + 1 > _maxR) _maxR = r + 1; }
      }
    }
    if (_maxC > 0) { mmUsedCols = _maxC; mmUsedRows = _maxR; }
    const mmWorldW = mmUsedCols * this.region.chunkWidth;
    const mmWorldH = mmUsedRows * this.region.chunkHeight;
    const mmAspect = mmWorldW / mmWorldH;
    let mmW, mmH;
    if (mmAspect >= 1) { mmW = mmMaxDim; mmH = Math.round(mmMaxDim / mmAspect); }
    else { mmH = mmMaxDim; mmW = Math.round(mmMaxDim * mmAspect); }

    // 右上角小地图容器（fixed 定位，比例与地图一致）
    html += `<div class="wme-minimap" style="position:fixed;top:60px;right:24px;
              width:${mmW}px;height:${mmH}px;background:rgba(20,15,10,0.9);
              border:2px solid #8B7355;border-radius:4px;overflow:hidden;pointer-events:none;z-index:10;">
              <canvas class="wme-minimap-canvas" width="${mmW}" height="${mmH}" style="width:100%;height:100%;"></canvas>
            </div>`;

    gc.innerHTML = html;

    // 绑定 hover
    gc.querySelectorAll('.wme-cell').forEach(cell => {
      const overlay = cell.querySelector('.wme-cell-overlay');
      cell.addEventListener('mouseenter', () => { overlay.style.display = 'flex'; });
      cell.addEventListener('mouseleave', () => { overlay.style.display = 'none'; });
    });

    // 绑定 select 变化
    gc.querySelectorAll('.wme-cell-select').forEach(sel => {
      sel.onchange = (e) => {
        const r = parseInt(e.target.dataset.r);
        const c = parseInt(e.target.dataset.c);
        const val = e.target.value || null;
        this.region.grid[r][c] = val;
        const cell = e.target.closest('.wme-cell');
        cell.querySelector('.wme-cell-label').textContent = val || '(空)';
        this._renderCellThumbnail(cell, val, thumbW, thumbH);
        // 格子内容变化后刷新小地图
        this._refreshMinimap(gc, thumbW, thumbH);
      };
    });

    // 绘制所有格子的缩略图
    gc.querySelectorAll('.wme-cell').forEach(cell => {
      const r = parseInt(cell.dataset.r);
      const c = parseInt(cell.dataset.c);
      const cellValue = (this.region.grid[r] && this.region.grid[r][c]) || null;
      this._renderCellThumbnail(cell, cellValue, thumbW, thumbH);
    });

    // 保存小地图刷新参数，供后续实时更新
    this._minimapParams = { gc, thumbW, thumbH };
    // 绘制右上角小地图（延迟，等缩略图绘制完成）
    setTimeout(() => this._renderMinimap(gc, thumbW, thumbH), 300);
    requestAnimationFrame(() => this._focusUsedArea());
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

  /**
   * 刷新小地图（使用保存的参数或传入新参数）
   * @param {HTMLElement} [gc] - 网格容器（可选，默认用保存的）
   * @param {number} [thumbW] - 格子缩略图宽度
   * @param {number} [thumbH] - 格子缩略图高度
   */
  _refreshMinimap(gc = null, thumbW = null, thumbH = null) {
    const params = this._minimapParams;
    const container = gc || params?.gc;
    const w = thumbW || params?.thumbW;
    const h = thumbH || params?.thumbH;
    if (container && w && h) {
      // 延迟执行，等当前帧格子缩略图绘制完成
      requestAnimationFrame(() => this._renderMinimap(container, w, h));
    }
  }

  /**
   * 绘制右上角小地图预览（缩小的全局视图，与游戏中小地图一致的布局）
   * @private
   */
  _renderMinimap(gc, thumbW, thumbH) {
    const minimapCanvas = gc.querySelector('.wme-minimap-canvas');
    if (!minimapCanvas) return;
    const ctx = minimapCanvas.getContext('2d');
    const mw = minimapCanvas.width;
    const mh = minimapCanvas.height;
    ctx.clearRect(0, 0, mw, mh);

    // 背景
    ctx.fillStyle = 'rgba(20, 15, 10, 1)';
    ctx.fillRect(0, 0, mw, mh);

    const { cols, rows, chunkWidth, chunkHeight, grid } = this.region;

    // 找到有场景的格子范围
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
    for (let r = 0; r < rows; r++) {
      if (!grid[r]) continue;
      for (let c = 0; c < cols; c++) {
        if (grid[r][c]) {
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
          if (r < minRow) minRow = r;
          if (r > maxRow) maxRow = r;
        }
      }
    }
    if (minCol === Infinity) return; // 全空

    const usedCols = maxCol - minCol + 1;
    const usedRows = maxRow - minRow + 1;
    const worldW = usedCols * chunkWidth;
    const worldH = usedRows * chunkHeight;

    // 计算缩放让内容 fit 到小地图（带边距）
    const pad = 8;
    const scaleX = (mw - pad * 2) / worldW;
    const scaleY = (mh - pad * 2) / worldH;
    const scale = Math.min(scaleX, scaleY);
    const drawW = worldW * scale;
    const drawH = worldH * scale;
    const offsetX = pad + (mw - pad * 2 - drawW) / 2;
    const offsetY = pad + (mh - pad * 2 - drawH) / 2;

    // 绘制每个有场景的格子
    for (let r = minRow; r <= maxRow; r++) {
      if (!grid[r]) continue;
      for (let c = minCol; c <= maxCol; c++) {
        const sceneId = grid[r][c];
        if (!sceneId) continue;

        const x = offsetX + (c - minCol) * chunkWidth * scale;
        const y = offsetY + (r - minRow) * chunkHeight * scale;
        const w = chunkWidth * scale;
        const h = chunkHeight * scale;

        // 尝试从格子缩略图 canvas 中获取图像
        const cell = gc.querySelector(`.wme-cell[data-r="${r}"][data-c="${c}"]`);
        const cellCanvas = cell && cell.querySelector('.wme-cell-canvas');
        if (cellCanvas && cellCanvas.width > 0) {
          try {
            ctx.drawImage(cellCanvas, x, y, w, h);
          } catch (e) {
            ctx.fillStyle = '#1b450c';
            ctx.fillRect(x, y, w, h);
          }
        } else {
          ctx.fillStyle = '#1b450c';
          ctx.fillRect(x, y, w, h);
        }

        // 格子边框
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, w, h);
      }
    }
  }

  _terrainColor(terrain) {
    return ({
      mountain: '#554b42',
      yellowRiver: '#8c7650',
      forest: '#31523a',
      plain: '#6c6546'
    })[terrain] || '#2b2b2b';
  }

  _renderFootprintThumbnail(cell, row, col, thumbW, thumbH, worldIndex) {
    const canvas = cell.querySelector('.wme-cell-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const raw = this.region.grid[row]?.[col] ?? null;
    const terrain = this._cellTerrain(raw);
    ctx.clearRect(0, 0, thumbW, thumbH);
    ctx.fillStyle = this._terrainColor(terrain);
    ctx.fillRect(0, 0, thumbW, thumbH);
    const coverage = worldIndex.getCell(this.region.id, row, col);
    if (!coverage?.sceneId) return;
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
      this._renderFootprintThumbnail(cell, row, col, thumbW, thumbH, worldIndex);
      this._refreshMainlandMinimap();
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
        const terrain = this._cellTerrain(this.region.grid[row]?.[col]);
        ctx.fillStyle = this._terrainColor(terrain);
        ctx.fillRect(x, y, cellW, cellH);
        const coverage = worldIndex.getCell(this.region.id, row, col);
        const cell = gc.querySelector(`.wme-cell[data-r="${row}"][data-c="${col}"]`);
        const thumbnail = cell?.querySelector('.wme-cell-canvas');
        if (coverage?.sceneId && thumbnail) {
          try { ctx.drawImage(thumbnail, x, y, cellW, cellH); } catch (_error) { /* 保留地形底色 */ }
        }
        ctx.strokeStyle = 'rgba(255,255,255,.16)';
        ctx.lineWidth = .5;
        ctx.strokeRect(x, y, cellW, cellH);
      }
    }
  }

  _refreshMainlandMinimap() {
    const params = this._minimapParams;
    if (params?.gc && params?.draftIndex) {
      requestAnimationFrame(() => this._renderMainlandMinimap(params.gc, params.draftIndex));
    }
  }

  /**
   * 绘制单格缩略图：直接当真实游戏场景来画（缩小 20%），复用场景编辑器渲染
   * @private
   */
  _renderCellThumbnail(cell, cellValue, thumbW, thumbH) {
    const canvas = cell.querySelector('.wme-cell-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, thumbW, thumbH);

    const sceneId = getWorldMapCellSceneId(cellValue, { includeReserved: true });
    if (!sceneId) {
      ctx.strokeStyle = '#333';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(thumbW, thumbH);
      ctx.moveTo(thumbW, 0); ctx.lineTo(0, thumbH);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    if (isReservedWorldMapCell(cellValue)) {
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, 0, thumbW, thumbH);
      ctx.strokeStyle = '#8B7355';
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(4, 4, thumbW - 8, thumbH - 8);
      ctx.setLineDash([]);
      ctx.fillStyle = '#c9ad7a';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${sceneId} · 规划位置`, thumbW / 2, thumbH / 2);
      return;
    }

    const scene = this._getSceneData(sceneId);
    if (!scene) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, thumbW, thumbH);
      ctx.fillStyle = '#555';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('无场景数据', thumbW / 2, thumbH / 2);
      return;
    }

    // 确保图片已加载（首次会触发异步加载，加载完后重绘）
    this._ensureImagesLoaded(scene, () => {
      this._drawSceneToCanvas(ctx, scene, thumbW, thumbH);
      // 图片加载完成后刷新小地图
      this._refreshMinimap();
    });

    // 同步先画一次（图片可能已缓存）
    this._drawSceneToCanvas(ctx, scene, thumbW, thumbH);
    // 同步绘制后也刷新小地图（延迟到下一帧，等 canvas 内容更新）
    requestAnimationFrame(() => this._refreshMinimap());
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

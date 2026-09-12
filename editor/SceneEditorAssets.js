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
  getGlobalAtlasImageUrl,
  updateAtlasesCache,
  updateImagesCache,
  addGlobalImage
} from './SceneDataLoader.js';
import { mergeOverrides } from '../src/core/scene/PlacementSpawner.js';
import {
  buildManifestImageOptions,
  indexManifestEntries,
  resolveManifestImageUrl
} from './ManifestImageCatalog.js';

const ATLAS_SLICE_MIME = 'application/x-yijian18-atlas-slice+json';
const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const ITEM_TYPE_LABELS = Object.freeze({
  material: '材料',
  consumable: '消耗品',
  equipment: '装备',
  tool: '工具',
  quest: '任务物品',
  resource: '资源',
  currency: '货币',
  key: '钥匙',
  miscellaneous: '杂项'
});

function itemTypeLabel(type) {
  return ITEM_TYPE_LABELS[type] || `自定义类型（${type}）`;
}

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * SceneEditorAssets - 场景编辑器资源管理模块
 * 负责图集、切片、精灵拖放等资源相关功能
 */
export class SceneEditorAssets {
  /**
   * @param {import('./SceneEditor.js').SceneEditor} editor - 主编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this._atlasSavePromises = new Map();
    this._atlasImageLoadGeneration = 0;
    this._sceneImageLoadGeneration = 0;
    this._placementVisualGeneration = 0;
    this._placementProjectEpoch = 0;
    this._placementProjectPath = '';
    this._contentLibraryPromise = null;
    this._contentLibraryPromiseEpoch = -1;
    this._manifestPromise = null;
    this._manifestPromiseEpoch = -1;
    this._manifestEntriesById = new Map();
    this._contentDraftSequence = 0;
  }

  _currentProjectPath() {
    return String(this.editor.options?.getProjectPath?.() || this.editor.projectPath || '');
  }

  _normalizeProjectPath(value = this._currentProjectPath()) {
    return String(value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^(?:\.\.\/)+/, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }

  _activatePlacementProject() {
    const projectPath = this._normalizeProjectPath();
    if (projectPath !== this._placementProjectPath) {
      this._placementProjectPath = projectPath;
      this._placementProjectEpoch += 1;
      this._placementVisualGeneration += 1;
      this._contentLib = null;
      this._contentLibraryPromise = null;
      this._contentLibraryPromiseEpoch = -1;
      this._manifestPromise = null;
      this._manifestPromiseEpoch = -1;
      this._manifestEntriesById = new Map();
    }
    return { projectPath, epoch: this._placementProjectEpoch };
  }

  _isPlacementProjectCurrent(projectPath, epoch) {
    const current = this._activatePlacementProject();
    return current.projectPath === projectPath && current.epoch === epoch;
  }

  _projectRoot(projectPath = this._placementProjectPath) {
    const normalized = this._normalizeProjectPath(projectPath);
    return normalized.endsWith('/game.project.json')
      ? normalized.slice(0, -'/game.project.json'.length)
      : normalized.replace(/\/$/, '');
  }

  async _ensureContentLibrary() {
    const { projectPath, epoch } = this._activatePlacementProject();
    if (this._contentLib) return this._contentLib;
    if (this._contentLibraryPromise && this._contentLibraryPromiseEpoch === epoch) {
      return this._contentLibraryPromise;
    }

    const loadLibrary = this.editor.options?.getContentLibrary;
    if (typeof loadLibrary !== 'function') {
      throw new Error('未注入共享 canonical 内容库读取器');
    }

    const promise = Promise.resolve(loadLibrary()).then(library => {
      if (!library || typeof library !== 'object' || Array.isArray(library)) {
        throw new TypeError('canonical project.library 必须是对象');
      }
      const candidate = structuredClone(library);
      for (const category of this._contentCategories()) {
        if (!Array.isArray(candidate[category.key])) candidate[category.key] = [];
      }
      if (this._isPlacementProjectCurrent(projectPath, epoch)) this._contentLib = candidate;
      return candidate;
    });

    this._contentLibraryPromise = promise;
    this._contentLibraryPromiseEpoch = epoch;
    try {
      return await promise;
    } finally {
      if (this._contentLibraryPromise === promise) {
        this._contentLibraryPromise = null;
        this._contentLibraryPromiseEpoch = -1;
      }
    }
  }

  _indexManifest(manifest) {
    return indexManifestEntries(manifest);
  }

  async _ensureAssetManifest() {
    const { projectPath, epoch } = this._activatePlacementProject();
    if (this._manifestEntriesById.size > 0) return this._manifestEntriesById;
    if (this._manifestPromise && this._manifestPromiseEpoch === epoch) return this._manifestPromise;

    const projectRoot = this._projectRoot(projectPath);
    if (!projectRoot) throw new Error('当前游戏工程路径为空');
    const promise = this._fetchJson(`/${projectRoot}/assets/manifests/assets.json`).then(manifest => {
      const index = this._indexManifest(manifest);
      if (this._isPlacementProjectCurrent(projectPath, epoch)) this._manifestEntriesById = index;
      return index;
    });

    this._manifestPromise = promise;
    this._manifestPromiseEpoch = epoch;
    try {
      return await promise;
    } finally {
      if (this._manifestPromise === promise) {
        this._manifestPromise = null;
        this._manifestPromiseEpoch = -1;
      }
    }
  }

  /** 返回当前物品库已经使用的类型；新建物品只可选择既有契约值。 */
  getItemTypeOptions() {
    const types = new Set(['material']);
    for (const definition of this._contentLib?.items || []) {
      const type = typeof definition?.type === 'string' ? definition.type.trim() : '';
      if (type) types.add(type);
    }
    return [...types].sort((left, right) => left.localeCompare(right, 'en'));
  }

  /** 将当前项目 Manifest 投影为内容编辑器的稳定图片资源选项。 */
  async getManifestImageOptions() {
    return buildManifestImageOptions(await this._ensureAssetManifest(), this._placementProjectPath);
  }

  _createContentDraftId(category) {
    const definitions = this._contentLib?.[category] || [];
    let id;
    do {
      this._contentDraftSequence += 1;
      id = `draft.${category}.${this._contentDraftSequence}`;
    } while (definitions.some(definition => definition?.id === id));
    return id;
  }

  isContentDefinitionIdAvailable(category, id, currentDefinition = null) {
    const normalizedId = String(id || '').trim();
    return !this._contentLib?.[category]?.some(definition => (
      definition !== currentDefinition && definition?.id === normalizedId
    ));
  }

  discardContentDefinition(category, definition) {
    const definitions = this._contentLib?.[category];
    if (!Array.isArray(definitions)) return false;
    const index = definitions.indexOf(definition);
    if (index < 0) return false;
    definitions.splice(index, 1);
    this.updateContentList();
    return true;
  }

  _findPlacementDefinition(placement) {
    if (!placement || placement.type !== 'ref' || !this._contentLib) return null;
    const categoryByKind = {
      item: 'items',
      equipment: 'equipment',
      npc: 'npcs',
      enemy: 'enemies',
      resourceNode: 'resourceNodes',
      shop: 'shops',
      vehicle: 'vehicles',
      building: 'buildings'
    };
    const keys = [categoryByKind[placement.kind]];
    if (placement.kind === 'equipment') keys.push('items');
    for (const key of keys) {
      if (!key) continue;
      const definition = (this._contentLib[key] || []).find(entry => entry?.id === placement.ref);
      if (definition) return definition;
    }
    return null;
  }

  _resolveManifestImageUrl(entry, projectPath = this._placementProjectPath) {
    return resolveManifestImageUrl(entry, projectPath);
  }

  _positiveNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
  }

  /**
   * 同步解析 ref 放置物的内容定义、Manifest 映射、图片及画布视觉边界。
   * 场景正文继续只保存 kind/ref/overrides，表现字段不复制进 placement。
   */
  resolvePlacementVisual(placement) {
    if (!placement || placement.type !== 'ref') return null;
    const definition = this._findPlacementDefinition(placement);
    if (!definition) return { status: 'missingDefinition', definition: null, image: null, bounds: null };

    const merged = mergeOverrides(definition, placement.overrides);
    const imageId = [merged.imageId, merged.assetId]
      .find(value => typeof value === 'string' && value.trim())?.trim() || '';
    if (!imageId) {
      return { status: 'missingAssetId', definition: merged, imageId: '', image: null, bounds: null };
    }

    const manifestEntry = this._manifestEntriesById.get(imageId) || null;
    const image = this.editor.loadedImages.get(imageId)
      || (manifestEntry?.imageId ? this.editor.loadedImages.get(manifestEntry.imageId) : null)
      || (manifestEntry?.assetId ? this.editor.loadedImages.get(manifestEntry.assetId) : null)
      || null;
    const width = this._positiveNumber(
      merged.sprite?.width,
      merged.width,
      manifestEntry?.bounds?.width,
      image?.naturalWidth,
      image?.width
    );
    const height = this._positiveNumber(
      merged.sprite?.height,
      merged.height,
      manifestEntry?.bounds?.height,
      image?.naturalHeight,
      image?.height
    );
    const pivotSource = merged.pivot || merged.sprite?.pivot || manifestEntry?.pivot || {};
    const pivotX = Number.isFinite(Number(pivotSource.x)) ? Number(pivotSource.x) : 0.5;
    const pivotY = Number.isFinite(Number(pivotSource.y)) ? Number(pivotSource.y) : 1;
    const anchorX = Number.isFinite(Number(placement.x)) ? Number(placement.x) : 0;
    const anchorY = Number.isFinite(Number(placement.y)) ? Number(placement.y) : 0;
    const bounds = width > 0 && height > 0 ? {
      x: anchorX - width * pivotX,
      y: anchorY - height * pivotY,
      width,
      height,
      right: anchorX + width * (1 - pivotX),
      bottom: anchorY + height * (1 - pivotY)
    } : null;
    const url = manifestEntry ? this._resolveManifestImageUrl(manifestEntry) : '';
    const status = !manifestEntry
      ? 'missingManifestEntry'
      : !url
        ? 'missingRuntimePath'
        : image && bounds
          ? 'ready'
          : 'loading';
    return { status, definition: merged, imageId, manifestEntry, image, width, height, pivot: { x: pivotX, y: pivotY }, bounds, url };
  }

  /** 异步加载显式场景集合中全部 ref 放置物使用的 Manifest 图片。 */
  async loadPlacementVisualImages(sceneDatas = [this.editor.sceneData]) {
    const editor = this.editor;
    const scenes = (Array.isArray(sceneDatas) ? sceneDatas : [sceneDatas]).filter(Boolean);
    const { projectPath, epoch } = this._activatePlacementProject();
    const generation = ++this._placementVisualGeneration;

    try {
      await Promise.all([this._ensureContentLibrary(), this._ensureAssetManifest()]);
    } catch (error) {
      if (this._isPlacementProjectCurrent(projectPath, epoch) && generation === this._placementVisualGeneration) {
        console.warn('[SceneEditorAssets] ref 图片资源准备失败:', error);
        editor.render();
      }
      return;
    }
    if (!this._isPlacementProjectCurrent(projectPath, epoch) || generation !== this._placementVisualGeneration) return;
    this.updateContentList();

    const placements = scenes
      .flatMap(scene => Array.isArray(scene?.layers) ? scene.layers : [])
      .flatMap(layer => Array.isArray(layer?.objects) ? layer.objects : [])
      .filter(object => object?.type === 'ref');
    const requests = new Map();
    for (const placement of placements) {
      const visual = this.resolvePlacementVisual(placement);
      if (!visual?.url || !visual.imageId || visual.image) continue;
      if (!requests.has(visual.imageId)) requests.set(visual.imageId, visual);
    }

    for (const [imageId, visual] of requests) {
      const image = new Image();
      image.onload = () => {
        if (!this._isPlacementProjectCurrent(projectPath, epoch) || generation !== this._placementVisualGeneration) return;
        const currentEntry = this._manifestEntriesById.get(imageId);
        if (!currentEntry || this._resolveManifestImageUrl(currentEntry, projectPath) !== visual.url) return;
        for (const alias of [imageId, currentEntry.imageId, currentEntry.assetId]) {
          if (typeof alias === 'string' && alias.trim()) editor.loadedImages.set(alias.trim(), image);
        }
        editor.render();
        this.updateContentList();
      };
      image.onerror = () => {
        if (this._isPlacementProjectCurrent(projectPath, epoch) && generation === this._placementVisualGeneration) {
          console.warn(`[SceneEditorAssets] ref 图片加载失败: ${imageId} (${visual.url})`);
        }
      };
      image.src = visual.url;
    }
    editor.render();
  }

  refreshPlacementVisuals() {
    return this.loadPlacementVisualImages();
  }

  _activateSharedAtlasProject() {
    return this.editor.activateSharedAtlasProject(this._currentProjectPath());
  }

  _ensureSharedAtlasDraft() {
    const editor = this.editor;
    const { projectPath } = this._activateSharedAtlasProject();
    const existing = editor.getSharedAtlasDraft(projectPath);
    if (existing) return existing;

    const source = editor.getCommittedSharedAtlasCatalog?.(projectPath);
    if (!source || typeof source !== 'object' || typeof source.then === 'function' || !Array.isArray(source.atlases)) {
      throw new Error('共享图集 catalog 尚未就绪');
    }
    const baseConfig = structuredClone(source);
    return editor.setSharedAtlasDraft({
      projectPath,
      baseConfig,
      config: structuredClone(baseConfig),
      previewImages: new Map(),
      pendingEditCount: 0,
      dirty: false
    });
  }

  _getSharedAtlasDraft(projectPath) {
    return this.editor.getSharedAtlasDraft(projectPath);
  }

  _clearSharedAtlasDraft(draft) {
    if (!draft) return false;
    return this.editor.clearSharedAtlasDraft(draft.projectPath, draft);
  }

  _isSharedAtlasEditCurrent(draft, expectedEpoch = null) {
    if (!draft) return false;
    const state = this._activateSharedAtlasProject();
    return state.projectPath === draft.projectPath
      && state.draft === draft
      && this.editor.sharedAtlasDrafts.get(draft.projectPath) === draft
      && (expectedEpoch === null || state.epoch === expectedEpoch);
  }

  _markSharedAtlasDraftDirty(draft = this._ensureSharedAtlasDraft(), expectedEpoch = null) {
    if (!this._isSharedAtlasEditCurrent(draft, expectedEpoch)) {
      throw new Error('共享图集编辑上下文已失效，请在当前项目重新操作');
    }
    draft.dirty = true;
    return draft;
  }

  /**
   * 为异步图片加载或弹窗编辑持有草稿租约，防止保存回包清空仍会被回调写入的对象。
   * @param {object} [draft]
   * @returns {() => void}
   */
  _beginSharedAtlasDraftEdit(draft = this._ensureSharedAtlasDraft()) {
    draft.pendingEditCount = Math.max(0, Number(draft.pendingEditCount) || 0) + 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      draft.pendingEditCount = Math.max(0, (Number(draft.pendingEditCount) || 0) - 1);
      if (
        draft.pendingEditCount === 0
        && !draft.dirty
        && JSON.stringify(draft.config) === JSON.stringify(draft.baseConfig)
      ) {
        this._clearSharedAtlasDraft(draft);
      }
    };
  }

  _getAtlasImage(atlasId) {
    return this.editor.getAtlasImage?.(atlasId)
      || this.editor.loadedImages.get(atlasId)
      || null;
  }

  _resolveAtlasImageUrl(atlas, projectPath = this._currentProjectPath()) {
    const normalizedProjectPath = String(projectPath || '')
      .replace(/\\/g, '/')
      .replace(/^(?:\.\.\/)+/, '')
      .replace(/^\/+/, '');
    const gameRoot = normalizedProjectPath.slice(0, normalizedProjectPath.lastIndexOf('/') + 1);
    const gamePath = gameRoot ? `../${gameRoot}` : '';
    return getGlobalAtlasImageUrl(atlas, gamePath, normalizedProjectPath);
  }

  _loadAtlasPreview(atlas, projectPath = this._currentProjectPath()) {
    const imageUrl = this._resolveAtlasImageUrl(atlas, projectPath);
    return new Promise((resolve, reject) => {
      if (!imageUrl) {
        reject(new Error('图集图片路径不能为空'));
        return;
      }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`图片加载失败: ${atlas.path}`));
      image.src = imageUrl;
    });
  }

  _normalizeAtlasPath(value) {
    let normalized = String(value || '').trim().replace(/\\/g, '/');
    const gamePath = String(window._editorCurrentGame?.path || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');
    if (gamePath && normalized.startsWith(`${gamePath}/`)) {
      normalized = normalized.slice(gamePath.length + 1);
    }
    normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '');
    if (!normalized.startsWith('assets/images/') && !normalized.startsWith('assets/atlases/')) {
      normalized = `assets/images/${normalized}`;
    }
    const segments = normalized.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
      throw new Error('图集路径不能包含空目录、. 或 ..');
    }
    return segments.join('/');
  }

  _deriveAtlasId(pathValue, atlases) {
    const samePath = atlases.find(atlas => atlas?.path === pathValue);
    if (samePath?.id) return samePath.id;
    const semantic = pathValue
      .replace(/^assets\/(?:images|atlases)\//, '')
      .replace(/\.[^.\/]+$/, '')
      .split('/')
      .map(segment => segment.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
      .filter(Boolean)
      .join('.') || 'resource';
    const baseId = `atlas.${semantic}`;
    const ids = new Set(atlases.map(atlas => atlas?.id).filter(Boolean));
    if (!ids.has(baseId)) return baseId;
    let suffix = 2;
    while (ids.has(`${baseId}.${suffix}`)) suffix += 1;
    return `${baseId}.${suffix}`;
  }

  _nextSliceKey(atlas) {
    const slices = atlas?.slices || {};
    let index = 1;
    while (Object.prototype.hasOwnProperty.call(slices, `slice_${index}`)) index += 1;
    return `slice_${index}`;
  }

  /**
   * 在修改共享草稿前验证切片候选，避免局部输入把 catalog 留在不可提交状态。
   * @param {object} candidate
   * @param {object} atlas
   * @param {HTMLImageElement|null} image
   * @returns {string}
   */
  _validateSliceCandidate(candidate, atlas, image = null) {
    if (!candidate || typeof candidate !== 'object') return '切片数据无效';
    if (!String(candidate.name || '').trim()) return '切片名称不能为空';

    const coordinateFields = ['sx', 'sy', 'sw', 'sh'];
    if (coordinateFields.some(field => !Number.isInteger(candidate[field]))) {
      return '切片坐标和尺寸必须是整数';
    }
    if (candidate.sx < 0 || candidate.sy < 0 || candidate.sw <= 0 || candidate.sh <= 0) {
      return '切片坐标必须非负，宽高必须大于 0';
    }

    const imageWidth = Number(image?.naturalWidth || atlas?.width || 0);
    const imageHeight = Number(image?.naturalHeight || atlas?.height || 0);
    if (
      (imageWidth > 0 && candidate.sx + candidate.sw > imageWidth)
      || (imageHeight > 0 && candidate.sy + candidate.sh > imageHeight)
    ) {
      return '切片范围必须完整位于图集图片内';
    }
    if (candidate.colliderRadius !== undefined) {
      if (typeof candidate.colliderRadius !== 'number' || !Number.isFinite(candidate.colliderRadius)) {
        return '碰撞半径必须是有限数字';
      }
      if (candidate.colliderRadius <= 0) return '碰撞半径必须大于 0';
    }
    return '';
  }

  _findCurrentSceneAtlasReferences(atlasId, sliceKey = null) {
    const references = [];
    const visit = (value, currentPath = '') => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (
        value.atlasId === atlasId
        && (sliceKey === null || value.sliceKey === sliceKey)
      ) {
        references.push(currentPath || '<scene>');
      }
      for (const [key, child] of Object.entries(value)) {
        visit(child, currentPath ? `${currentPath}.${key}` : key);
      }
    };
    visit(this.editor.sceneData);
    return references;
  }

  _changedAtlasIds(baseConfig, nextConfig) {
    const base = new Map((baseConfig?.atlases || []).map(atlas => [atlas.id, atlas]));
    const next = new Map((nextConfig?.atlases || []).map(atlas => [atlas.id, atlas]));
    const ids = new Set([...base.keys(), ...next.keys()]);
    return [...ids].filter(id => JSON.stringify(base.get(id) || null) !== JSON.stringify(next.get(id) || null));
  }

  _availableAtlases() {
    return this.editor.getAvailableAtlases?.()
      || (Array.isArray(this.editor.sceneData?.atlases) ? this.editor.sceneData.atlases : []);
  }

  _getAtlas(atlasId) {
    return this.editor.getAtlasDefinition?.(atlasId)
      || this._availableAtlases().find(atlas => atlas?.id === atlasId)
      || null;
  }

  _isSharedAtlas(atlasId) {
    return this.editor.isSharedAtlas?.(atlasId) === true;
  }

  /**
   * 设置资源拖放
   */
  setupAssetDragDrop() {
    const editor = this.editor;
    const assetList = document.getElementById('editor-asset-list');
    const container = document.getElementById('editor-canvas-container');

    if (assetList) {
      assetList.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.asset-item');
        if (item) {
          e.dataTransfer.setData('text/plain', item.dataset.id || item.dataset.type);
          item.classList.add('dragging');
        }
      });

      assetList.addEventListener('dragend', (e) => {
        const item = e.target.closest('.asset-item');
        if (item) item.classList.remove('dragging');
      });
    }

    if (!container) return;

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const rect = container.getBoundingClientRect();
      const pos = editor.interactionModule.screenToScene(
        e.clientX - rect.left,
        e.clientY - rect.top
      );

      let slicePayload = editor.draggingSlice;
      if (!slicePayload) {
        const encoded = e.dataTransfer.getData(ATLAS_SLICE_MIME);
        if (encoded) {
          try { slicePayload = JSON.parse(encoded); }
          catch (_error) { /* 继续尝试 text/plain 兼容格式 */ }
        }
      }
      if (!slicePayload && id?.startsWith('slice:')) {
        const separator = id.indexOf(':', 'slice:'.length);
        if (separator > 0) {
          slicePayload = {
            atlasId: id.slice('slice:'.length, separator),
            sliceKey: id.slice(separator + 1)
          };
        }
      }
      editor.draggingSlice = null;
      if (slicePayload?.atlasId && slicePayload?.sliceKey) {
        this._addSliceToScene(slicePayload.atlasId, slicePayload.sliceKey, pos.x, pos.y);
        return;
      }

      // 内容库定义拖入 → 放置引用实例
      if (id && id.startsWith('content:')) {
        const parts = id.split(':');
        this._addContentPlacement(parts[1], parts[2], pos.x, pos.y);
        return;
      }

      if (id === 'rect') {
        editor.ui.addObject({ type: 'rect', x: pos.x - 32, y: pos.y - 32, width: 64, height: 64, fill: '#4a5a8e' });
      } else if (id === 'circle') {
        editor.ui.addObject({ type: 'circle', x: pos.x, y: pos.y, radius: 32, fill: '#4a8e5a' });
      } else if (id === 'ellipse') {
        // 拖入地形椭圆：放入背景填充层并解锁
        const fillLayer = editor.sceneData.layers.find(l => l.id === 'layer_fill');
        const rx = 200, ry = 130;
        const ellipseObj = {
          id: 'ellipse_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          type: 'ellipse',
          name: '地形椭圆',
          x: Math.round(pos.x - rx),
          y: Math.round(pos.y - ry),
          width: rx * 2,
          height: ry * 2,
          fillMode: 'color',
          fill: '#3a5a2a',
          opacity: 1,
          stroke: '',
          strokeWidth: 0,
          edgeFade: 0
        };
        if (fillLayer) {
          fillLayer.locked = false;
          fillLayer.objects.push(ellipseObj);
          editor.activeLayerIndex = editor.sceneData.layers.indexOf(fillLayer);
        } else {
          editor.ui.addObject(ellipseObj);
        }
        editor.selectedObjects = [ellipseObj];
        editor.history.saveHistory();
        editor.ui.updateObjectCount();
        editor.ui.updateObjectProperties();
        editor.render();
      } else if (id === 'polygon') {
        // 拖入多边形 shape（默认正五边形，以落点为中心；顶点可拖拽编辑）
        const r = 120;
        const cx = pos.x, cy = pos.y;
        const pts = [];
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
          pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]);
        }
        const obj = editor.ui.addObject({
          type: 'shape',
          shapeType: 'polygon',
          name: '多边形',
          points: pts,
          fillMode: 'color',
          fill: '#3a5a2a',
          opacity: 1,
          edgeFade: 0,
          stroke: '#5a8a4a',
          strokeWidth: 2,
          collide: false
        });
        if (obj) {
          editor.selectedObjects = [obj];
          editor.ui.updateObjectProperties();
        }
      } else if (id === 'effectZone') {
        // 特效区域多边形：粒子特效展示区（火焰/流水/湖面/冰面等）
        const r = 100;
        const cx = pos.x, cy = pos.y;
        const pts = [];
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
          pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]);
        }
        const minX = Math.min(...pts.map(p => p[0]));
        const minY = Math.min(...pts.map(p => p[1]));
        const maxX = Math.max(...pts.map(p => p[0]));
        const maxY = Math.max(...pts.map(p => p[1]));
        const obj = editor.ui.addObject({
          type: 'effectZone',
          name: '特效区域',
          effectType: 'fire',       // fire / water / lake / ice / smoke / sparkle
          points: pts,
          x: minX, y: minY, width: maxX - minX, height: maxY - minY,
          // 粒子参数（默认火焰）
          particleRate: 12,         // 每秒生成粒子数
          particleLife: 1.2,        // 粒子生命（秒）
          particleSize: 6,          // 粒子初始大小
          particleSpeed: 40,        // 粒子初始速度
          particleColor: '#ff6622', // 粒子主色
          particleAlpha: 0.8,       // 粒子初始透明度
          fillColor: 'rgba(255,120,30,0.15)', // 编辑器预览填充
          borderColor: 'rgba(255,140,40,0.7)'  // 编辑器预览边框
        });
        if (obj) {
          editor.selectedObjects = [obj];
          editor.ui.updateObjectProperties();
        }
      } else if (id === 'region' || id === 'spawn' || id === 'portal' || id === 'npc' || id === 'trigger' || id === 'buffZone' || id === 'buffRect' || id === 'buffEllipse' || id === 'playerSpawn') {
        // 逻辑对象：放入逻辑层。火堆属于内容库 worldProp，不在此创建第二份 spawn。
        this._addLogicObject(id, pos.x, pos.y);
      } else if (id === 'terrain-rect') {
        // 地形四边形：放入背景填充层（矩形，非椭圆）
        const fillLayer = editor.sceneData.layers.find(l => l.id === 'layer_fill');
        const w = 300, h = 300;
        const obj = {
          id: 'fill_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          type: 'fill',
          name: '地形四边形',
          x: Math.round(pos.x - w / 2),
          y: Math.round(pos.y - h / 2),
          width: w,
          height: h,
          fillMode: 'color',
          fillColor: '#3a5a2a',
          opacity: 1,
          edgeFade: 0
        };
        if (fillLayer) {
          fillLayer.locked = false;
          fillLayer.objects.push(obj);
          editor.activeLayerIndex = editor.sceneData.layers.indexOf(fillLayer);
        } else {
          editor.ui.addObject(obj);
        }
        editor.selectedObjects = [obj];
        editor.history.saveHistory();
        editor.ui.updateObjectCount();
        editor.ui.updateObjectProperties();
        editor.render();
      } else if (id === 'terrain-polygon') {
        // 地形多边形：放入背景填充层（正五边形，顶点可拖拽）
        const fillLayer = editor.sceneData.layers.find(l => l.id === 'layer_fill');
        const r = 180;
        const cx = pos.x, cy = pos.y;
        const pts = [];
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
          pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]);
        }
        const obj = {
          id: 'shape_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          type: 'shape',
          shapeType: 'polygon',
          name: '地形多边形',
          points: pts,
          fillMode: 'color',
          fill: '#3a5a2a',
          opacity: 1,
          edgeFade: 0,
          stroke: '#5a8a4a',
          strokeWidth: 0,
          collide: false
        };
        if (fillLayer) {
          fillLayer.locked = false;
          fillLayer.objects.push(obj);
          editor.activeLayerIndex = editor.sceneData.layers.indexOf(fillLayer);
        } else {
          editor.ui.addObject(obj);
        }
        editor.selectedObjects = [obj];
        editor.history.saveHistory();
        editor.ui.updateObjectCount();
        editor.ui.updateObjectProperties();
        editor.render();
      } else if (id === 'fill') {
        const fillLayer = editor.sceneData.layers.find(l => l.id === 'layer_fill');
        const fillObj = {
          id: 'obj_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          type: 'fill',
          x: 0, y: 0,
          width: editor.sceneData.width,
          height: editor.sceneData.height,
          fillMode: 'color',
          fillColor: '#333333',
          opacity: 1,
          name: '背景填充'
        };
        if (fillLayer) {
          fillLayer.objects.push(fillObj);
          editor.activeLayerIndex = editor.sceneData.layers.indexOf(fillLayer);
        } else {
          editor.ui.addObject(fillObj);
        }
        editor.selectedObjects = [fillObj];
        editor.history.saveHistory();
        editor.ui.updateObjectCount();
        editor.ui.updateObjectProperties();
        editor.render();
      } else if (editor.loadedImages.has(id)) {
        const img = editor.loadedImages.get(id);
        const assetName = editor.sceneData.imageAssets?.[id]?.name;
        editor.ui.addObject({
          type: 'image', imageId: id,
          name: assetName || id,
          semanticRole: 'sceneImage',
          visualDescription: assetName ? `${assetName}；请按场景用途补充地貌、建筑或道具说明。` : '请补充该图片在场景中的具体用途。',
          x: pos.x - img.width / 2, y: pos.y - img.height / 2,
          width: img.width, height: img.height, rotation: 0
        });
      }
    });
  }

  /**
   * 添加逻辑对象（region/spawn/portal/npc）到逻辑层（P2-1）
   * 数据结构对应 §1 scenes[].objects.{regions,npcs,spawns,portals}，
   * 编辑器中统一以 type 存于图层对象，导出时可归类。
   * @param {string} kind - region|spawn|portal|npc
   * @param {number} x
   * @param {number} y
   * @private
   */
  _addLogicObject(kind, x, y) {
    const editor = this.editor;
    const rnd = Date.now() + '_' + Math.floor(Math.random() * 1000);
    let obj;
    if (kind === 'region') {
      const w = 200, h = 140;
      obj = {
        id: 'region_' + rnd, type: 'region', name: '区域',
        regionId: 'region_' + Math.floor(Math.random() * 10000),
        x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h
      };
    } else if (kind === 'spawn') {
      obj = {
        id: 'spawn_' + rnd, type: 'spawn', name: '刷怪点',
        spawnId: 'spawn_' + Math.floor(Math.random() * 10000),
        x: Math.round(x), y: Math.round(y),
        enemyRef: '', count: 1, wave: 0, radius: 0
      };
    } else if (kind === 'portal') {
      obj = {
        id: 'portal_' + rnd, type: 'portal', name: '传送门',
        portalId: 'portal_' + Math.floor(Math.random() * 10000),
        x: Math.round(x), y: Math.round(y),
        targetScene: '', targetSpawn: ''
      };
    } else if (kind === 'npc') {
      obj = {
        id: 'npc_' + rnd, type: 'npc', name: 'NPC',
        npcRef: '', x: Math.round(x), y: Math.round(y)
      };
    } else if (kind === 'trigger') {
      const w = 36, h = 36;
      const definition = (editor.getProjectTriggers?.() || [])
        .find(trigger => ['approach', 'interact', 'enter', 'leave'].includes(trigger?.when?.type)) || null;
      obj = {
        id: 'trigger_' + rnd, type: 'trigger', name: definition?.id || '触发器',
        triggerId: definition?.id || '',
        x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h,
        event: definition?.when?.type || 'interact',
        targetMode: 'id',
        target: '',
        radius: 60,
        prompt: ''
      };
    } else if (kind === 'playerSpawn') {
      obj = {
        id: 'spawn_' + rnd, type: 'spawn', name: '玩家出生点',
        spawnId: 'spawn_player_' + Math.floor(Math.random() * 10000),
        ref: 'player',
        x: Math.round(x), y: Math.round(y),
        enemyRef: '', count: 1, wave: 0, radius: 0
      };
    } else if (kind === 'buffZone') {
      // Buff 多边形：默认 5 顶点正五边形
      const r = 100; // 半径
      const cx = Math.round(x), cy = Math.round(y);
      const pts = [];
      for (let i = 0; i < 5; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / 5;
        pts.push([Math.round(cx + r * Math.cos(angle)), Math.round(cy + r * Math.sin(angle))]);
      }
      // 计算包围盒
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
      obj = {
        id: 'buffZone_' + rnd, type: 'buffZone', name: 'Buff区域',
        shapeType: 'polygon',
        points: pts,
        x: minX, y: minY, width: maxX - minX, height: maxY - minY,
        fillColor: 'rgba(100, 0, 200, 0.2)',
        borderColor: 'rgba(100, 0, 200, 0.5)',
        visible: true,
        effect: {
          effectType: 'periodic',
          stat: 'hp',
          value: -5,
          interval: 2,
          onLeave: 'remove',
          leaveDuration: 5,
          target: 'player'
        }
      };
    } else if (kind === 'buffRect') {
      // Buff 四边形
      const w = 200, h = 140;
      obj = {
        id: 'buffZone_' + rnd, type: 'buffZone', name: 'Buff四边形',
        shapeType: 'rect',
        x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h,
        fillColor: 'rgba(100, 0, 200, 0.2)',
        borderColor: 'rgba(100, 0, 200, 0.5)',
        visible: true,
        effect: {
          effectType: 'periodic',
          stat: 'hp',
          value: -5,
          interval: 2,
          onLeave: 'remove',
          leaveDuration: 5,
          target: 'player'
        }
      };
    } else if (kind === 'buffEllipse') {
      // Buff 椭圆形
      const rx = 120, ry = 80;
      obj = {
        id: 'buffZone_' + rnd, type: 'buffZone', name: 'Buff椭圆形',
        shapeType: 'ellipse',
        x: Math.round(x - rx), y: Math.round(y - ry), width: rx * 2, height: ry * 2,
        fillColor: 'rgba(100, 0, 200, 0.2)',
        borderColor: 'rgba(100, 0, 200, 0.5)',
        visible: true,
        effect: {
          effectType: 'periodic',
          stat: 'hp',
          value: -5,
          interval: 2,
          onLeave: 'remove',
          leaveDuration: 5,
          target: 'player'
        }
      };
    }
    if (!obj) return;

    // 确保存在逻辑层
    let logicLayer = editor.sceneData.layers.find(l => l.id === 'layer_logic');
    if (!logicLayer) {
      logicLayer = { id: 'layer_logic', name: '逻辑对象', visible: true, locked: false, objects: [] };
      editor.sceneData.layers.push(logicLayer);
    }
    logicLayer.visible = true;
    logicLayer.locked = false;
    if (!Array.isArray(logicLayer.objects)) logicLayer.objects = [];
    logicLayer.objects.push(obj);
    editor.activeLayerIndex = editor.sceneData.layers.indexOf(logicLayer);

    editor.selectedObjects = [obj];
    editor.history.saveHistory();
    editor.ui.updateObjectCount();
    editor.ui.updateObjectProperties();
    editor.render();
  }

  /**
   * 放置一个内容库引用实例（type:'ref'）到放置层。
   * 只存 { kind, ref:库id, x, y, group }，明细在内容库定义里（库与实例分离）。
   * @param {string} kind - item|equipment|npc|enemy|shop|vehicle|building
   * @param {string} ref - 内容库定义 id
   */
  _addContentPlacement(kind, ref, x, y) {
    const editor = this.editor;
    // 查定义名字（用于显示）
    let name = ref;
    if (this._contentLib) {
      for (const c of this._contentCategories()) {
        const def = (this._contentLib[c.key] || []).find(d => d.id === ref);
        if (def) { name = def.name || ref; break; }
      }
    }
    const obj = {
      id: 'ref_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      type: 'ref',
      kind,
      ref,
      name,
      x: Math.round(x),
      y: Math.round(y),
      group: ''
    };
    let layer = editor.sceneData.layers.find(l => l.id === 'layer_placement');
    if (!layer) {
      layer = { id: 'layer_placement', name: '放置层', visible: true, locked: false, objects: [] };
      editor.sceneData.layers.push(layer);
    }
    layer.visible = true;
    layer.locked = false;
    if (!Array.isArray(layer.objects)) layer.objects = [];
    layer.objects.push(obj);
    editor.activeLayerIndex = editor.sceneData.layers.indexOf(layer);
    editor.selectedObjects = [obj];
    editor.history.saveHistory();
    editor.ui.updateObjectCount();
    editor.ui.updateObjectProperties();
    editor.render();
    void this.loadPlacementVisualImages();
  }

  /**
   * 将切片添加到场景
   * @private
   */
  _addSliceToScene(atlasId, sliceKey, x, y) {
    const editor = this.editor;
    const atlas = this._getAtlas(atlasId);
    if (!atlas) {
      editor.ui.showToast?.(`图集不存在: ${atlasId}`, 'error');
      return { ok: false, code: 'missingAtlas' };
    }

    const slice = atlas.slices?.[sliceKey];
    if (!slice) {
      editor.ui.showToast?.(`图集 ${atlasId} 中不存在切片 ${sliceKey}`, 'error');
      return { ok: false, code: 'missingSlice' };
    }

    let decoLayer;
    try {
      decoLayer = editor.layers.ensureLayer('layer_deco', '装饰层');
    } catch (error) {
      editor.ui.showToast?.(`无法创建装饰层: ${error.message}`, 'error');
      return { ok: false, code: 'invalidDecorationLayer', error };
    }

    const obj = {
      id: 'obj_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      type: 'slice',
      atlasId,
      sliceKey,
      x: Math.round(x - slice.sw / 2),
      y: Math.round(y - slice.sh / 2),
      width: slice.sw,
      height: slice.sh,
      name: slice.name || sliceKey
    };

    decoLayer.objects.push(obj);
    editor.activeLayerIndex = editor.sceneData.layers.indexOf(decoLayer);
    editor.selectedObjects = [obj];
    editor.layers.updateLayerList();
    editor.history.saveHistory();
    editor.ui.updateObjectCount();
    editor.ui.updateObjectProperties();
    editor.render();
    return { ok: true, object: obj, layer: decoLayer };
  }

  /**
   * 添加图片资源
   */
  addImageAsset(file) {
    const editor = this.editor;
    return new Promise((resolve, reject) => {
      // 用户需先将图片放到项目 assets/images/ 目录下（含子文件夹）
      // 让用户输入图片在 assets/images/ 下的相对路径
      const defaultPath = file.webkitRelativePath || file.name;
      const subPath = prompt(
        `请输入图片在 assets/images/ 下的路径：\n（如 scene1/bg.png 或直接 bg.png）`,
        defaultPath
      );
      if (!subPath || !subPath.trim()) { reject(new Error('取消')); return; }
      
      const game = window._editorCurrentGame;
      const gamePath = (game && game.path) ? game.path : '../example/sanguo_zhangjiao/';
      const relativeSrc = gamePath + 'assets/images/' + subPath.trim();
      const semanticPart = subPath.trim()
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'asset';
      const requestedId = prompt(
        '请输入稳定 imageId（后续替换图片文件时保持不变）：',
        `img.${semanticPart}`
      );
      if (!requestedId || !requestedId.trim()) { reject(new Error('取消')); return; }
      const id = requestedId.trim();
      if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(id)) {
        editor.ui.showToast?.('imageId 只能包含字母、数字、点、下划线和短横线，且必须以字母开头', 'error');
        reject(new Error('imageId 格式无效'));
        return;
      }
      if (editor.sceneData.imageAssets?.[id]) {
        editor.ui.showToast?.(`imageId 已存在: ${id}`, 'error');
        reject(new Error('imageId 重复'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        editor.loadedImages.set(id, img);
        
        if (!editor.sceneData.imageAssets) editor.sceneData.imageAssets = {};
        editor.sceneData.imageAssets[id] = { src: relativeSrc, name: file.name };
        // 登记到全局图片库缓存，使其成为库资源（切换场景/保存清理时不丢失）
        addGlobalImage(id, { src: relativeSrc, name: file.name });

        const assetList = document.getElementById('editor-asset-list');
        const item = document.createElement('div');
        item.className = 'asset-item';
        item.draggable = true;
        item.dataset.id = id;
        item.innerHTML = `
          <div class="asset-preview"><img src="${relativeSrc}" alt="${file.name}"></div>
          <span>${file.name.substring(0, 8)}</span>
        `;
        assetList.appendChild(item);
        this._bindImageItemClick(item, id);
        resolve(id);
      };
      img.onerror = () => {
        alert(`图片加载失败！请确保文件已放入：\n${relativeSrc}\n\n支持子文件夹，如 assets/images/scene1/bg.png`);
        reject(new Error('图片不在项目目录中'));
      };
      img.src = relativeSrc;
    });
  }

  /**
   * 更新资源库显示
   */
  updateAssetLibrary() {
    this._updateSpriteList();
    this._updateAtlasList();
  }

  /**
   * 审计当前游戏的 Manifest、磁盘图片、canonical 场景引用、音频文件和 3D fallback。
   * 只生成报告，不自动登记或修改资源状态。
   */
  async runAssetAudit() {
    const gameId = this._contentGameId();
    const gameRoot = `example/${gameId}`;
    const button = document.getElementById('editor-audit-assets');
    if (button) button.disabled = true;
    this.editor.ui.showToast?.('正在扫描磁盘资产与 canonical 场景引用…');

    try {
      const canonicalSceneFile = file => /\/S\d{2}(?:-C\d{2})?\.json$/i.test(file.replace(/\\/g, '/'));
      const [manifest, imageFiles, sceneFiles, audioConfig, audioFiles] = await Promise.all([
        this._fetchJson(`/${gameRoot}/assets/manifests/assets.json`),
        this._listFilesRecursive(`${gameRoot}/assets/images`, file => /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file)),
        this._listFilesRecursive(`${gameRoot}/assets/scenes`, canonicalSceneFile),
        this._fetchJson(`/${gameRoot}/data/AudioConfig.json`),
        this._listFilesRecursive(`${gameRoot}/assets/audio`, file => /\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i.test(file))
      ]);
      const scenes = await Promise.all(sceneFiles.map(file => this._fetchJson(`/${file}`)));
      const report = this._buildAssetAuditReport({
        gameRoot,
        manifest,
        imageFiles,
        scenes,
        audioConfig,
        audioFiles
      });
      this._showAssetAuditModal(report);
      this.editor.ui.showToast?.(report.blockingCount
        ? `资产审计完成：${report.blockingCount} 个阻断项`
        : '资产审计完成：未发现阻断项', report.blockingCount ? 'error' : 'success');
    } catch (error) {
      console.error('[AssetAudit] 审计失败:', error);
      this.editor.ui.showToast?.(`资产审计失败：${error.message}`, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async _fetchJson(url) {
    const safeUrl = url.split('/').map((part, index) => index === 0 ? part : encodeURIComponent(part)).join('/');
    const response = await fetch(safeUrl);
    if (!response.ok) throw new Error(`加载 ${url} 失败: HTTP ${response.status}`);
    return response.json();
  }

  async _listFilesRecursive(root, accept) {
    const result = [];
    const visit = async dir => {
      const response = await fetch(`/api/list-files?path=${encodeURIComponent(dir)}`);
      if (!response.ok) throw new Error(`列出 ${dir} 失败: HTTP ${response.status}`);
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.files)) throw new Error(data.error || `列出 ${dir} 失败`);
      await Promise.all(data.files.map(async entry => {
        const path = `${dir}/${entry.name}`.replace(/\\/g, '/');
        if (entry.isDir) await visit(path);
        else if (!accept || accept(path)) result.push(path);
      }));
    };
    await visit(root);
    return result.sort();
  }

  _buildAssetAuditReport({ gameRoot, manifest, imageFiles, scenes, audioConfig = {}, audioFiles = [] }) {
    const entries = Array.isArray(manifest?.assets) ? manifest.assets : [];
    const diskPaths = new Set(imageFiles.map(path => path.slice(gameRoot.length + 1)));
    const diskAudioPaths = new Set(audioFiles.map(path => path.slice(gameRoot.length + 1)));
    const manifestPaths = new Set();
    const assetIds = new Set();
    const imageIds = new Set();
    const duplicateIds = [];
    const invalidEntries = [];
    const placeholders = [];
    const { projectPath, draft } = this._activateSharedAtlasProject();
    const sharedCatalog = draft?.config || this.editor.getCommittedSharedAtlasCatalog(projectPath);
    const sharedAtlases = new Map(
      (sharedCatalog?.atlases || [])
        .filter(atlas => atlas?.id)
        .map(atlas => [atlas.id, atlas])
    );

    for (const entry of entries) {
      if (!entry?.assetId) invalidEntries.push('Manifest 条目缺少 assetId');
      else if (assetIds.has(entry.assetId)) duplicateIds.push(`assetId: ${entry.assetId}`);
      else assetIds.add(entry.assetId);
      if (entry?.imageId) {
        if (imageIds.has(entry.imageId)) duplicateIds.push(`imageId: ${entry.imageId}`);
        imageIds.add(entry.imageId);
        if (entry.assetId && entry.imageId !== entry.assetId) {
          invalidEntries.push(`${entry.assetId}: assetId 与 imageId 必须使用同一稳定 ID`);
        }
      } else if (['image', 'atlas', 'texture'].includes(entry?.runtime2D?.mode)) {
        invalidEntries.push(`${entry?.assetId || '<unknown>'}: 图片或图集源缺少稳定 imageId`);
      }
      const sourcePaths = [entry?.sourceFile, entry?.runtime2D?.path]
        .map(path => this._normalizeGameAssetPath(path))
        .filter(Boolean);
      if (sourcePaths.length > 0) {
        for (const path of sourcePaths) manifestPaths.add(path);
      } else {
        invalidEntries.push(`${entry?.assetId || '<unknown>'}: 缺少 sourceFile/runtime2D.path`);
      }
      if (!(Number(entry?.bounds?.width) > 0) || !(Number(entry?.bounds?.height) > 0)) {
        invalidEntries.push(`${entry?.assetId || '<unknown>'}: bounds.width/height 必须大于 0`);
      }
      if (![entry?.pivot?.x, entry?.pivot?.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
        invalidEntries.push(`${entry?.assetId || '<unknown>'}: pivot.x/y 必须位于 [0,1]`);
      }
      if (entry?.runtime3D?.mode === 'model' && !entry?.runtime3D?.path) {
        invalidEntries.push(`${entry?.assetId || '<unknown>'}: model 模式缺少 path`);
      } else if (entry?.runtime3D?.mode !== 'model' && entry?.runtime3D?.sourceAssetId !== entry?.assetId) {
        invalidEntries.push(`${entry?.assetId || '<unknown>'}: 3D fallback 未引用自身稳定 assetId`);
      }
      if (entry?.status === 'placeholder') placeholders.push(entry?.assetId || '<unknown>');
    }

    const missingFiles = [...manifestPaths].filter(path => !diskPaths.has(path));
    const unregisteredFiles = [...diskPaths].filter(path => !manifestPaths.has(path));
    const missingReferences = [];
    const invalidSlices = [];
    const unusedSceneImages = [];
    for (const atlas of sharedAtlases.values()) {
      const assetId = atlas.assetId || atlas.id;
      const imageId = atlas.imageId || null;
      if (!atlas.assetId || !imageId || atlas.assetId !== imageId) {
        invalidEntries.push(`共享图集 ${atlas.id}: assetId 与 imageId 必须存在且使用同一稳定 ID`);
      }
      if (!assetIds.has(assetId)) {
        missingReferences.push(`共享图集 ${atlas.id}: assetId ${assetId} 未登记 Manifest`);
      }
      if (imageId && !imageIds.has(imageId)) {
        missingReferences.push(`共享图集 ${atlas.id}: imageId ${imageId} 未登记 Manifest`);
      }
      const path = this._normalizeGameAssetPath(atlas.path);
      if (path && !diskPaths.has(path)) {
        missingReferences.push(`共享图集 ${atlas.id}: 指向缺失文件 ${path}`);
      }
      for (const [sliceKey, slice] of Object.entries(atlas.slices || {})) {
        const values = [slice?.sx, slice?.sy, slice?.sw, slice?.sh];
        const withinBounds = values.every(Number.isFinite)
          && slice.sx >= 0 && slice.sy >= 0 && slice.sw > 0 && slice.sh > 0
          && slice.sx + slice.sw <= atlas.width
          && slice.sy + slice.sh <= atlas.height;
        if (!withinBounds) invalidSlices.push(`共享图集 ${atlas.id}/${sliceKey}: 裁剪区域越界或尺寸无效`);
      }
    }
    for (const scene of scenes.filter(Boolean)) {
      const sceneId = scene.id || scene.name || '<unknown-scene>';
      const sceneImages = scene.imageAssets || {};
      const atlases = new Map((scene.atlases || []).filter(atlas => atlas?.id).map(atlas => [atlas.id, atlas]));
      for (const [atlasId, atlas] of sharedAtlases) atlases.set(atlasId, atlas);
      const usedImageIds = new Set();
      for (const layer of scene.layers || []) {
        for (const object of layer?.objects || []) {
          if (object?.type === 'image') {
            if (!object.imageId || !sceneImages[object.imageId]) {
              missingReferences.push(`${sceneId}/${object?.id || '<object>'}: 图片对象缺少有效 imageId`);
            } else {
              usedImageIds.add(object.imageId);
            }
          }
          if (object?.sliceKey) {
            const atlas = atlases.get(object.atlasId);
            if (!atlas || !atlas.slices?.[object.sliceKey]) {
              invalidSlices.push(`${sceneId}/${object?.id || '<object>'}: ${object.atlasId || '<atlas>'}/${object.sliceKey}`);
            }
          }
        }
      }
      for (const [imageId, image] of Object.entries(sceneImages)) {
        if (!usedImageIds.has(imageId)) {
          unusedSceneImages.push(`${sceneId}: imageAssets.${imageId}`);
          continue;
        }
        if (!imageIds.has(imageId) && !assetIds.has(imageId)) missingReferences.push(`${sceneId}: imageId ${imageId} 未登记 Manifest`);
        const path = this._normalizeGameAssetPath(image?.src);
        if (path && !diskPaths.has(path)) missingReferences.push(`${sceneId}: ${imageId} 指向缺失文件 ${path}`);
      }
      for (const atlas of (scene.atlases || []).filter(atlas => atlas?.id && !sharedAtlases.has(atlas.id))) {
        if (!assetIds.has(atlas.assetId || atlas.id)) missingReferences.push(`${sceneId}: atlasId ${atlas.id} 未登记 Manifest`);
        const path = this._normalizeGameAssetPath(atlas.path);
        if (path && !diskPaths.has(path)) missingReferences.push(`${sceneId}: atlasId ${atlas.id} 指向缺失文件 ${path}`);
      }
    }

    const audioCues = [];
    const missingAudioFiles = [];
    for (const group of ['music', 'sfx']) {
      const cues = audioConfig?.[group];
      if (!cues || typeof cues !== 'object' || Array.isArray(cues)) continue;
      for (const [cueId, cue] of Object.entries(cues)) {
        audioCues.push(`${group}.${cueId}`);
        const path = this._normalizeGameAssetPath(cue?.file);
        if (!path) missingAudioFiles.push(`${group}.${cueId}: 缺少文件路径`);
        else if (!diskAudioPaths.has(path)) missingAudioFiles.push(`${group}.${cueId}: 指向缺失文件 ${path}`);
      }
    }
    const missingAudioCoverage = audioCues.length === 0
      ? ['未登记任何正式 music/sfx cue；Release Candidate 音频内容尚未接入']
      : [];

    const blockingCount = duplicateIds.length + invalidEntries.length + missingFiles.length
      + missingReferences.length + invalidSlices.length + placeholders.length
      + missingAudioFiles.length + missingAudioCoverage.length;
    return {
      summary: {
        diskImages: diskPaths.size,
        diskAudio: diskAudioPaths.size,
        manifestEntries: entries.length,
        scenes: scenes.length,
        audioCues: audioCues.length,
        unregisteredFiles: unregisteredFiles.length,
        unusedSceneImages: unusedSceneImages.length,
        placeholders: placeholders.length
      },
      blockingCount,
      duplicateIds,
      invalidEntries,
      missingFiles,
      missingReferences,
      invalidSlices,
      missingAudioFiles,
      missingAudioCoverage,
      unregisteredFiles,
      unusedSceneImages,
      placeholders
    };
  }

  _normalizeGameAssetPath(path) {
    const value = String(path || '').replace(/\\/g, '/');
    const assetsIndex = value.indexOf('assets/');
    return assetsIndex >= 0 ? value.slice(assetsIndex) : value.replace(/^\.\//, '');
  }

  _showAssetAuditModal(report) {
    const escape = value => String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const section = (title, items, blocking = false) => {
      const values = items || [];
      return `<details ${blocking && values.length ? 'open' : ''} style="margin:8px 0;">
        <summary style="cursor:pointer;color:${blocking && values.length ? '#ff8a80' : '#d7c59a'};">${escape(title)} (${values.length})</summary>
        <div style="max-height:180px;overflow:auto;margin:6px 0 0 14px;font:12px/1.5 monospace;white-space:pre-wrap;">${values.length ? values.map(escape).join('\n') : '无'}</div>
      </details>`;
    };
    document.getElementById('asset-audit-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'asset-audit-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;';
    const summary = report.summary;
    modal.innerHTML = `<div style="width:min(820px,92vw);max-height:88vh;overflow:auto;background:#20242b;color:#eee;border:1px solid #596273;border-radius:8px;padding:18px;box-shadow:0 12px 40px #000;">
      <h3 style="margin:0 0 8px;">资产审计报告</h3>
      <div style="font-size:13px;color:#b9c2d0;">磁盘图片 ${summary.diskImages} · Manifest ${summary.manifestEntries} · canonical 场景 ${summary.scenes} · 音频 ${summary.audioCues}/${summary.diskAudio} · 阻断项 ${report.blockingCount}</div>
      ${section('重复稳定 ID', report.duplicateIds, true)}
      ${section('Manifest 结构 / 3D fallback', report.invalidEntries, true)}
      ${section('Manifest 指向缺失文件', report.missingFiles, true)}
      ${section('场景缺失引用', report.missingReferences, true)}
      ${section('无效 slice 引用', report.invalidSlices, true)}
      ${section('音频 cue 指向缺失文件', report.missingAudioFiles, true)}
      ${section('音频覆盖（Release Candidate 阻断）', report.missingAudioCoverage, true)}
      ${section('未登记图片（不得直接作为正式资产）', report.unregisteredFiles)}
      ${section('场景未使用 imageAssets（可保存清理）', report.unusedSceneImages)}
      ${section('占位资产（Release Candidate 阻断）', report.placeholders, true)}
      <div style="display:flex;justify-content:flex-end;margin-top:14px;"><button id="asset-audit-close" style="padding:7px 18px;">关闭</button></div>
    </div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.id === 'asset-audit-close') modal.remove();
    });
    document.body.appendChild(modal);
  }

  /**
   * 更新精灵列表
   * @private
   */
  _updateSpriteList() {
    const list = document.getElementById('editor-asset-list');
    if (!list) return;

    list.innerHTML = `
      <div class="asset-item placeholder" draggable="true" data-type="rect">
        <div class="asset-preview rect"></div>
        <span>矩形</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="circle">
        <div class="asset-preview circle"></div>
        <span>圆形</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="ellipse">
        <div class="asset-preview" style="width:40px;height:26px;border-radius:50%;background:#3a5a2a;border:1px solid #5a8a4a;"></div>
        <span>地形椭圆</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="terrain-rect">
        <div class="asset-preview" style="width:36px;height:36px;background:#3a5a2a;border:1px solid #5a8a4a;border-radius:0;"></div>
        <span>地形四边形</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="terrain-polygon">
        <div class="asset-preview" style="width:34px;height:30px;background:#3a5a2a;border:1px solid #5a8a4a;clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%);"></div>
        <span>地形多边形</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="polygon">
        <div class="asset-preview" style="width:34px;height:30px;background:#3a5a2a;border:1px solid #5a8a4a;clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%);"></div>
        <span>多边形</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="effectZone">
        <div class="asset-preview" style="width:34px;height:30px;background:rgba(255,120,30,0.35);border:2px dashed #ff8833;clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%);"></div>
        <span>特效区域</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="fill">
        <div class="asset-preview fill" style="background:linear-gradient(135deg,#333,#666);border:1px dashed #888;"></div>
        <span>背景填充</span>
      </div>
    `;

    // 渲染已有的图片资源（来自 imageAssets）
    const editor = this.editor;
    const assets = editor.sceneData.imageAssets;
    if (assets) {
      for (const [id, data] of Object.entries(assets)) {
        const item = document.createElement('div');
        item.className = 'asset-item';
        item.draggable = true;
        item.dataset.id = id;
        const displayName = (data.name || id).substring(0, 10);
        item.innerHTML = `
          <div class="asset-preview"><img src="${data.src}" alt="${displayName}" style="width:100%;height:100%;object-fit:contain;"></div>
          <span>${displayName}</span>
        `;
        list.appendChild(item);
        this._bindImageItemClick(item, id);
      }
    }
  }

  /**
   * 绑定图片资源项的点击事件 → 选中时下方面板显示图片属性
   * @private
   */
  _bindImageItemClick(item, imageId) {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      // 高亮选中
      const list = document.getElementById('editor-asset-list');
      if (list) list.querySelectorAll('.asset-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      this.editor.selectedSlice = null;
      this.editor.selectedAtlasId = null;
      this._showImageAssetProperties(imageId);
    });
  }

  /**
   * 在下方面板显示选中图片资源的属性 + 编辑/删除按钮
   * @private
   */
  _showImageAssetProperties(imageId) {
    const editor = this.editor;
    const asset = editor.sceneData.imageAssets?.[imageId];
    if (!asset) return;

    const title = document.getElementById('slice-panel-title');
    const propsPanel = document.getElementById('slice-properties');
    if (title) title.textContent = '选中图片';
    if (!propsPanel) return;

    const img = editor.loadedImages.get(imageId);
    const dim = img ? `${img.naturalWidth}×${img.naturalHeight}` : '未加载';

    propsPanel.innerHTML = `
      <div class="slice-prop-row"><label>ID:</label><input value="${imageId}" disabled style="color:#FFD700;" title="稳定 imageId，替换文件时保持不变"></div>
      <div class="slice-prop-row"><label>名称:</label><input type="text" id="img-asset-name" value="${asset.name || ''}"></div>
      <div class="slice-prop-row"><label>替换文件:</label><input type="text" id="img-asset-path" value="${asset.src || ''}" title="修改文件路径但保留当前 imageId 和全部场景引用"></div>
      <div class="slice-prop-row"><label>尺寸:</label><input value="${dim}" disabled style="color:#88ccff;"></div>
      <div class="slice-prop-row" style="margin-top:8px;">
        <button id="img-asset-edit-btn" style="flex:1;padding:5px;cursor:pointer;">编辑</button>
        <button id="img-asset-delete-btn" style="flex:1;padding:5px;cursor:pointer;color:#f88;">删除</button>
      </div>
    `;

    // 名称修改
    document.getElementById('img-asset-name').addEventListener('change', (e) => {
      asset.name = e.target.value;
      addGlobalImage(imageId, { ...asset });
    });
    // 替换文件：稳定 imageId 与所有对象引用保持不变。
    document.getElementById('img-asset-path').addEventListener('change', (e) => {
      asset.src = e.target.value.trim();
      addGlobalImage(imageId, { ...asset });
      editor.loadedImages.delete(imageId);
      this.loadImageAssets();
      this._updateSpriteList();
    });
    // 编辑按钮：弹窗
    document.getElementById('img-asset-edit-btn').addEventListener('click', () => {
      this._openImageAssetEditorModal(imageId);
    });
    // 删除按钮
    document.getElementById('img-asset-delete-btn').addEventListener('click', () => {
      if (!confirm(`确定删除图片资源「${asset.name || imageId}」吗？`)) return;
      delete editor.sceneData.imageAssets[imageId];
      editor.loadedImages.delete(imageId);
      // 同时删除场景中引用该图片的对象
      for (const layer of editor.sceneData.layers) {
        layer.objects = layer.objects.filter(obj => !(obj.type === 'image' && obj.imageId === imageId));
      }
      this._updateSpriteList();
      editor.render();
      editor.ui.updateObjectCount();
      // 重置面板
      if (title) title.textContent = '说明';
      propsPanel.innerHTML = '<div class="no-selection">用于基础的几何图形、背景图填充、碰撞多边形等。</div>';
      editor.ui.showToast?.('图片资源已删除');
    });
  }

  /**
   * 打开图片资源编辑弹窗（在资源库中选中时）
   * @private
   */
  _openImageAssetEditorModal(imageId) {
    const editor = this.editor;
    const asset = editor.sceneData.imageAssets?.[imageId];
    if (!asset) return;
    const img = editor.loadedImages.get(imageId);

    const overlay = document.createElement('div');
    overlay.id = 'slice-editor-overlay';
    overlay.innerHTML = `
      <div id="slice-editor-modal">
        <div class="slice-modal-header">
          <span>图片编辑 - ${asset.name || imageId}</span>
          <button id="slice-modal-close" title="关闭">✕</button>
        </div>
        <div class="slice-modal-body">
          <div class="slice-modal-canvas-wrap">
            <canvas id="img-asset-modal-canvas"></canvas>
            ${!img ? '<div style="padding:20px;color:#f88;font-size:12px;">图片未加载，请设置正确路径</div>' : ''}
          </div>
          <div class="slice-modal-params">
            <div class="smp-row"><label>名称:</label><input type="text" id="iam-name" value="${asset.name || ''}"></div>
            <div class="smp-row"><label>路径:</label><input type="text" id="iam-path" value="${asset.src || ''}" style="min-width:180px;"></div>
            <div class="smp-row"><label>宽度:</label><input type="number" id="iam-width" value="${img ? img.naturalWidth : 0}" disabled style="color:#88ccff;"></div>
            <div class="smp-row"><label>高度:</label><input type="number" id="iam-height" value="${img ? img.naturalHeight : 0}" disabled style="color:#88ccff;"></div>
            <div class="smp-row" style="margin-top:6px;">
              <button id="iam-reload" style="flex:1;">刷新图片</button>
            </div>
            <div class="smp-row" style="margin-top:12px;">
              <button id="iam-confirm" style="flex:1;">确定</button>
              <button id="iam-cancel" style="flex:1;">取消</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = document.getElementById('img-asset-modal-canvas');
    const drawImg = () => {
      const curImg = editor.loadedImages.get(imageId);
      if (!curImg || !canvas) return;
      const maxCW = Math.min(600, window.innerWidth - 320);
      const maxCH = Math.min(450, window.innerHeight - 160);
      const scale = Math.min(maxCW / curImg.naturalWidth, maxCH / curImg.naturalHeight, 2);
      canvas.width = Math.round(curImg.naturalWidth * scale);
      canvas.height = Math.round(curImg.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(curImg, 0, 0, canvas.width, canvas.height);
    };
    drawImg();

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('slice-modal-close').addEventListener('click', close);
    document.getElementById('iam-cancel').addEventListener('click', close);

    // 刷新图片
    document.getElementById('iam-reload').addEventListener('click', () => {
      const newPath = document.getElementById('iam-path').value.trim();
      if (!newPath) return;
      const newImg = new Image();
      newImg.onload = () => {
        editor.loadedImages.set(imageId, newImg);
        document.getElementById('iam-width').value = newImg.naturalWidth;
        document.getElementById('iam-height').value = newImg.naturalHeight;
        drawImg();
      };
      newImg.onerror = () => editor.ui.showToast?.('图片加载失败: ' + newPath, 'error');
      newImg.src = newPath;
    });

    // 确定
    document.getElementById('iam-confirm').addEventListener('click', () => {
      asset.name = document.getElementById('iam-name').value.trim() || asset.name;
      const newPath = document.getElementById('iam-path').value.trim();
      if (newPath && newPath !== asset.src) {
        asset.src = newPath;
        editor.loadedImages.delete(imageId);
        this.loadImageAssets();
      }
      addGlobalImage(imageId, { ...asset });
      this._updateSpriteList();
      this._showImageAssetProperties(imageId);
      editor.render();
      close();
    });
  }

  /**
   * 更新「逻辑」列表（区域/刷怪点/传送门），从「图形」拆出单列
   */
  updateLogicList() {
    const list = document.getElementById('editor-logic-list');
    if (!list) return;
    list.innerHTML = `
      <div class="asset-item placeholder" draggable="true" data-type="region">
        <div class="asset-preview" style="width:38px;height:26px;background:rgba(80,140,255,0.18);border:1px dashed #5a8adf;"></div>
        <span>区域</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="spawn">
        <div class="asset-preview" style="width:30px;height:30px;border-radius:50%;background:rgba(220,80,80,0.25);border:2px dashed #d05050;"></div>
        <span>刷怪点</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="portal">
        <div class="asset-preview" style="width:28px;height:30px;border-radius:50%;background:rgba(180,80,220,0.25);border:2px solid #b450dc;"></div>
        <span>传送门</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="trigger">
        <div class="asset-preview" style="width:38px;height:26px;background:rgba(255,200,50,0.15);border:2px dashed #e0a020;"></div>
        <span>触发器</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="playerSpawn">
        <div class="asset-preview" style="width:30px;height:30px;border-radius:50%;background:rgba(80,180,255,0.3);border:2px solid #50b4ff;display:flex;align-items:center;justify-content:center;font-size:14px;">🧑</div>
        <span>玩家出生点</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="buffZone">
        <div class="asset-preview" style="width:30px;height:30px;background:rgba(100,0,200,0.2);border:2px dashed #8040c0;clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);"></div>
        <span>Buff多边形</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="buffRect">
        <div class="asset-preview" style="width:38px;height:26px;background:rgba(100,0,200,0.2);border:2px dashed #8040c0;"></div>
        <span>Buff四边形</span>
      </div>
      <div class="asset-item placeholder" draggable="true" data-type="buffEllipse">
        <div class="asset-preview" style="width:38px;height:26px;border-radius:50%;background:rgba(100,0,200,0.2);border:2px dashed #8040c0;"></div>
        <span>Buff椭圆形</span>
      </div>
    `;
    this._bindAssetDrag(list);
  }

  /** 给一个资源列表绑定拖拽（dragstart 写入 data-id，供 drop 解析） */
  _bindAssetDrag(list) {
    if (!list || list._dragBound) return;
    list._dragBound = true;
    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.asset-item');
      if (item) {
        e.dataTransfer.setData('text/plain', item.dataset.id || item.dataset.type);
        item.classList.add('dragging');
      }
    });
    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.asset-item');
      if (item) item.classList.remove('dragging');
    });
  }

  // ==================== 内容库（资源库·定义 + 放置） ====================

  /** 当前游戏 id */
  _contentGameId() {
    const e = this.editor;
    return e.currentGameId || e.gameId || (e.options && e.options.gameId) || 'sanguo_zhangjiao';
  }

  /** 可放置内容分类（对应 GameProject.library 键；职业/技能/天赋等在内容库导航里，不在此） */
  _contentCategories() {
    return [
      { key: 'items', label: '物品', kind: 'item' },
      { key: 'equipment', label: '装备', kind: 'equipment' },
      { key: 'npcs', label: 'NPC', kind: 'npc' },
      { key: 'enemies', label: '敌人', kind: 'enemy' },
      { key: 'resourceNodes', label: '资源节点', kind: 'resourceNode' },
      { key: 'shops', label: '商店', kind: 'shop' },
      { key: 'vehicles', label: '载具', kind: 'vehicle' },
      { key: 'buildings', label: '建筑', kind: 'building' }
    ];
  }

  /** 加载内容库定义（来自页面共享的 canonical project candidate），填充分类下拉并渲染列表。 */
  async updateContentLibrary() {
    try {
      await Promise.all([this._ensureContentLibrary(), this._ensureAssetManifest()]);
    } catch (error) {
      console.warn('内容库加载失败', error);
      this.editor.ui.showToast?.('内容库加载失败: ' + error.message, 'error');
      return;
    }

    const filter = document.getElementById('editor-content-filter');
    if (filter && !filter.dataset.filled) {
      filter.innerHTML = this._contentCategories()
        .map(category => `<option value="${category.key}">${category.label}</option>`).join('');
      filter.dataset.filled = '1';
    }
    this.updateContentList();
  }

  /** 渲染当前分类的内容列表（可拖入场景放置） */
  updateContentList() {
    const list = document.getElementById('editor-content-list');
    if (!list || !this._contentLib) return;
    const filter = document.getElementById('editor-content-filter');
    const catKey = (filter && filter.value) || 'items';
    const cat = this._contentCategories().find(category => category.key === catKey);
    if (!cat) return;
    const entries = this._contentLib[catKey] || [];
    if (entries.length === 0) {
      list.innerHTML = '<div style="padding:10px;color:#666;text-align:center;font-size:11px;">该分类暂无定义<br>点「+ 新增定义」</div>';
      return;
    }
    list.innerHTML = entries.map(definition => {
      const visual = this.resolvePlacementVisual({ type: 'ref', kind: cat.kind, ref: definition.id, x: 0, y: 0 });
      const preview = visual?.url
        ? `<img src="${escapeHtml(visual.url)}" alt="${escapeHtml(definition.name || definition.id)}" style="width:100%;height:100%;object-fit:contain;">`
        : `<span title="${escapeHtml(visual?.status || 'missingImageId')}" style="color:#ff9a9a;font-size:10px;">缺图</span>`;
      const itemMetadata = catKey === 'items'
        ? `<small style="display:block;width:100%;color:#b9c7e6;font-size:9px;line-height:1.3;word-break:break-all;">类型: ${escapeHtml(definition.type ? itemTypeLabel(definition.type) : '未设置')}</small>`
        : '';
      return `
      <div class="asset-item content-item" draggable="true"
           data-id="content:${cat.kind}:${escapeHtml(definition.id)}" data-cat="${catKey}" data-ref="${escapeHtml(definition.id)}"
           title="拖入场景放置；点击编辑定义">
        <div class="asset-preview" style="width:30px;height:30px;background:${visual?.url ? 'rgba(80,200,140,0.2)' : 'transparent'};border:1px solid ${visual?.url ? '#50c88c' : '#d86b6b'};border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#8fe;overflow:hidden;">${preview}</div>
        <span style="width:100%;word-break:break-all;">${escapeHtml(definition.name || definition.id)}</span>
        ${itemMetadata}
      </div>`;
    }).join('');
    this._bindAssetDrag(list);
    // 点击条目 → 在右侧属性面板编辑该定义
    list.querySelectorAll('.content-item').forEach(element => {
      element.addEventListener('click', () => {
        const ref = element.dataset.ref;
        const definition = (this._contentLib[catKey] || []).find(entry => entry.id === ref);
        if (definition) this.editor.ui.showContentDefinitionEditor?.(catKey, definition);
      });
    });
  }

  /** 在当前分类新增一条定义（默认模板） */
  addContentDefinition() {
    if (!this._contentLib) return;
    const filter = document.getElementById('editor-content-filter');
    const catKey = (filter && filter.value) || 'items';
    const category = this._contentCategories().find(entry => entry.key === catKey);
    const tpl = {
      id: this._createContentDraftId(catKey),
      name: '新' + (category?.label || '定义')
    };
    if (catKey === 'items') {
      tpl.type = 'material';
      tpl.imageId = '';
    }
    this._contentLib[catKey].push(tpl);
    this.updateContentList();
    this.editor.ui.showContentDefinitionEditor?.(catKey, tpl, { isNew: true });
  }

  _persistenceError(result, fallback = '未知错误') {
    const firstError = result?.errors?.[0];
    const validationMessage = [firstError?.path, firstError?.message || firstError?.reason]
      .filter(Boolean)
      .join(': ');
    if (validationMessage) return validationMessage;
    if (typeof result?.error?.message === 'string') return result.error.message;
    if (typeof result?.error === 'string') return result.error;
    return fallback;
  }

  /** 通过页面共享 CanonicalEditorSession 保存 project.library。 */
  async saveContentLibrary() {
    if (!this._contentLib) {
      const result = { ok: false, committed: false, code: 'contentLibraryNotLoaded' };
      this.editor.ui.showToast?.('保存失败: 内容库尚未加载', 'error');
      return result;
    }
    const saveLibrary = this.editor.options?.saveContentLibrary;
    if (typeof saveLibrary !== 'function') {
      const result = { ok: false, committed: false, code: 'missingCanonicalContentLibraryWriter' };
      this.editor.ui.showToast?.('保存失败: 未配置 canonical 内容库写入器', 'error');
      return result;
    }
    try {
      const result = await saveLibrary(structuredClone(this._contentLib));
      if (result?.ok !== true || result.committed !== true) {
        this.editor.ui.showToast?.('保存失败: ' + this._persistenceError(result, '磁盘未提交'), 'error');
        return result;
      }
      if (result.degraded) {
        this.editor.ui.showToast?.('内容库已写入磁盘，但缓存/通知同步降级', 'warn');
      } else {
        this.editor.ui.showToast?.('内容库已保存', 'success');
      }
      void this.refreshPlacementVisuals();
      return result;
    } catch (error) {
      this.editor.ui.showToast?.('保存失败: ' + error.message, 'error');
      return { ok: false, committed: false, code: 'contentLibrarySaveFailed', error };
    }
  }

  /**
   * 更新图集列表
   * @private
   */
  _updateAtlasList() {
    const editor = this.editor;
    const list = document.getElementById('editor-atlas-list');
    if (!list) return;

    list.innerHTML = '';

    const atlases = this._availableAtlases();
    if (atlases.length === 0) {
      list.innerHTML = '<div style="padding:10px;color:#666;text-align:center;font-size:11px;">暂无图集</div>';
      return;
    }

    for (const atlas of atlases) {
      const item = document.createElement('div');
      item.className = 'atlas-item';
      if (editor.selectedAtlasId === atlas.id) item.classList.add('selected');

      let slicesHtml = '';
      const sliceCount = atlas.slices ? Object.keys(atlas.slices).length : 0;
      if (atlas.slices) {
        for (const [sliceKey, slice] of Object.entries(atlas.slices)) {
          slicesHtml += `
            <div class="slice-item" draggable="true" data-atlas="${atlas.id}" data-slice="${sliceKey}">
              <div class="slice-preview" style="background:${sliceKey.includes('tree') ? '#2a5a2a' : '#4a6a3a'}"></div>
              <span>${slice.name || sliceKey}</span>
            </div>
          `;
        }
      }

      item.innerHTML = `
        <div class="atlas-header" data-atlas="${atlas.id}">
          <span>${atlas.name}${this._isSharedAtlas(atlas.id) ? ' <small style="color:#7ec8ff;">共享</small>' : ''}</span>
          <span style="font-size:10px;color:#666;">${atlas.width}×${atlas.height} · ${sliceCount}片</span>
        </div>
        <div class="slice-grid">${slicesHtml}</div>
      `;

      list.appendChild(item);
    }

    // 绑定图集头部点击 → 选中图集
    list.querySelectorAll('.atlas-header').forEach(header => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectAtlas(header.dataset.atlas);
      });
    });

    // 绑定切片事件
    list.querySelectorAll('.slice-item').forEach(sliceItem => {
      sliceItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectSlice(sliceItem.dataset.atlas, sliceItem.dataset.slice);
      });

      sliceItem.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        const atlasId = sliceItem.dataset.atlas;
        const sliceKey = sliceItem.dataset.slice;
        const payload = { atlasId, sliceKey };
        editor.draggingSlice = payload;
        e.dataTransfer.setData(ATLAS_SLICE_MIME, JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', `slice:${atlasId}:${sliceKey}`);
        e.dataTransfer.effectAllowed = 'copy';
        sliceItem.classList.add('dragging');
      });

      sliceItem.addEventListener('dragend', () => {
        sliceItem.classList.remove('dragging');
        editor.draggingSlice = null;
      });
    });
  }

  /**
   * 选中图集（展开属性编辑区）
   * @private
   */
  _selectAtlas(atlasId) {
    const editor = this.editor;
    if (this._isSharedAtlas(atlasId)) {
      try { this._ensureSharedAtlasDraft(); }
      catch (error) {
        editor.ui.showToast?.(`共享图集不可编辑: ${error.message}`, 'error');
        return;
      }
    }
    // 再次点击已选中的图集则取消选中
    editor.selectedAtlasId = (editor.selectedAtlasId === atlasId) ? null : atlasId;
    editor.selectedSlice = null;
    this._updateAtlasList();
    this._updateSlicePreviews();
    this._showAtlasProperties();
  }

  /**
   * 在左侧"选中切片/图集"面板中展示选中图集的属性
   * @private
   */
  _showAtlasProperties() {
    const editor = this.editor;
    const propsPanel = document.getElementById('slice-properties');
    const title = document.getElementById('slice-panel-title');
    if (!propsPanel) return;

    if (!editor.selectedAtlasId) {
      if (title) title.textContent = '选中切片';
      propsPanel.innerHTML = '<div class="no-selection">未选中切片</div>';
      return;
    }

    const selectedAtlasId = editor.selectedAtlasId;
    const shared = this._isSharedAtlas(selectedAtlasId);
    const propertyDraft = shared ? this._ensureSharedAtlasDraft() : null;
    const propertyEpoch = shared ? editor.sharedAtlasProjectEpoch : null;
    const atlas = this._getAtlas(selectedAtlasId);
    if (!atlas) return;

    if (title) title.textContent = '选中图集';
    const sliceCount = atlas.slices ? Object.keys(atlas.slices).length : 0;
    propsPanel.innerHTML = `
      <div class="slice-prop-row"><label>ID:</label><input value="${escapeHtml(atlas.id)}" disabled style="color:#FFD700;"></div>
      <div class="slice-prop-row"><label>资源ID:</label><input value="${escapeHtml(atlas.assetId || atlas.id)}" disabled style="color:#88ccff;"></div>
      <div class="slice-prop-row"><label>名称:</label><input type="text" id="atlas-prop-name" value="${escapeHtml(atlas.name || '')}"></div>
      <div class="slice-prop-row"><label>图片路径:</label><input type="text" id="atlas-prop-path" value="${escapeHtml(atlas.path || '')}" title="当前游戏 assets/images/ 或 assets/atlases/ 下的路径"></div>
      <div class="slice-prop-row"><label>宽度:</label><input id="atlas-prop-width" value="${atlas.width || 0}" disabled></div>
      <div class="slice-prop-row"><label>高度:</label><input id="atlas-prop-height" value="${atlas.height || 0}" disabled></div>
      <div class="slice-prop-row"><label>切片数:</label><input value="${sliceCount}" disabled style="color:#88ccff;"></div>
      <div class="slice-prop-row" style="margin-top:8px;">
        <button id="atlas-edit-btn" style="flex:1;padding:5px;cursor:pointer;">编辑</button>
        <button id="atlas-new-slice-btn" style="flex:1;padding:5px;cursor:pointer;">+ 新建切片</button>
      </div>
      <div class="slice-prop-row">
        <button id="atlas-save-btn" style="width:100%;padding:5px;cursor:pointer;">💾 保存共享图集</button>
      </div>
      <div style="padding:8px 2px;color:${shared ? '#7ec8ff' : '#e5b567'};font-size:11px;line-height:1.5;">
        ${shared
          ? '游戏级共享草稿：保存时自动同步稳定 ID 与 Asset Manifest，完整定义不会写入场景 JSON。'
          : '场景局部 legacy 图集仅作兼容；请新建游戏级共享图集替代。'}
      </div>
    `;

    const nameInput = document.getElementById('atlas-prop-name');
    const pathInput = document.getElementById('atlas-prop-path');
    const widthInput = document.getElementById('atlas-prop-width');
    const heightInput = document.getElementById('atlas-prop-height');
    nameInput.addEventListener('change', () => {
      if (shared && !this._isSharedAtlasEditCurrent(propertyDraft, propertyEpoch)) {
        nameInput.value = atlas.name || '';
        editor.ui.showToast?.('项目已切换，请重新选择图集后编辑', 'error');
        return;
      }
      atlas.name = nameInput.value.trim() || atlas.name;
      if (shared) this._markSharedAtlasDraftDirty(propertyDraft, propertyEpoch);
      this._updateAtlasList();
    });
    pathInput.addEventListener('change', async () => {
      if (!shared) {
        pathInput.value = atlas.path || '';
        editor.ui.showToast?.('场景局部 legacy 图集不能写回共享 catalog', 'warn');
        return;
      }
      if (!this._isSharedAtlasEditCurrent(propertyDraft, propertyEpoch)) {
        pathInput.value = atlas.path || '';
        editor.ui.showToast?.('项目已切换，请重新选择图集后编辑', 'error');
        return;
      }
      const previousPath = atlas.path;
      const endEdit = this._beginSharedAtlasDraftEdit(propertyDraft);
      try {
        const nextPath = this._normalizeAtlasPath(pathInput.value);
        const image = await this._loadAtlasPreview(
          { ...atlas, path: nextPath },
          propertyDraft.projectPath
        );
        if (!this._isSharedAtlasEditCurrent(propertyDraft, propertyEpoch)) {
          throw new Error('图片加载期间项目已切换，请重新选择图集图片');
        }
        atlas.path = nextPath;
        atlas.width = image.naturalWidth;
        atlas.height = image.naturalHeight;
        const draft = this._markSharedAtlasDraftDirty(propertyDraft, propertyEpoch);
        draft.previewImages.set(atlas.id, image);
        if (pathInput.isConnected) pathInput.value = nextPath;
        if (widthInput?.isConnected) widthInput.value = atlas.width;
        if (heightInput?.isConnected) heightInput.value = atlas.height;
        this._updateSlicePreviews();
        editor.render();
      } catch (error) {
        if (pathInput.isConnected) pathInput.value = previousPath;
        editor.ui.showToast?.(error.message, 'error');
      } finally {
        endEdit();
      }
    });

    document.getElementById('atlas-edit-btn').addEventListener('click', () => {
      if (!shared) {
        editor.ui.showToast?.('请先迁移为游戏级共享图集', 'warn');
        return;
      }
      this._openAtlasEditorModal(atlas);
    });
    document.getElementById('atlas-new-slice-btn').addEventListener('click', () => {
      if (!shared) {
        editor.ui.showToast?.('请先迁移为游戏级共享图集', 'warn');
        return;
      }
      this._openNewSliceModal(atlas);
    });
    document.getElementById('atlas-save-btn').addEventListener('click', () => this.saveAtlases());
  }

  /**
   * 打开图集编辑弹窗：展示图集图片预览，可更换图片路径
   * @private
   */
  _openAtlasEditorModal(atlas) {
    const editor = this.editor;
    let previewImage = this._getAtlasImage(atlas.id);
    let previewPath = atlas.path;

    const overlay = document.createElement('div');
    overlay.id = 'slice-editor-overlay';
    overlay.innerHTML = `
      <div id="slice-editor-modal">
        <div class="slice-modal-header">
          <span>图集编辑 - ${escapeHtml(atlas.name || atlas.id)}</span>
          <button id="slice-modal-close" title="关闭">✕</button>
        </div>
        <div class="slice-modal-body">
          <div class="slice-modal-canvas-wrap">
            <canvas id="atlas-modal-canvas"></canvas>
            ${!previewImage ? '<div id="atlas-modal-load-error" style="padding:20px;color:#f88;font-size:12px;">图片未加载，请设置正确路径后刷新</div>' : ''}
          </div>
          <div class="slice-modal-params">
            <div class="smp-row"><label>名称:</label><input type="text" id="amp-name" value="${escapeHtml(atlas.name || '')}"></div>
            <div class="smp-row"><label>图片路径:</label><input type="text" id="amp-path" value="${escapeHtml(atlas.path || '')}" style="min-width:180px;"></div>
            <div class="smp-row"><label>宽度:</label><input id="amp-width" value="${atlas.width || 0}" disabled></div>
            <div class="smp-row"><label>高度:</label><input id="amp-height" value="${atlas.height || 0}" disabled></div>
            <div class="smp-info">切片数: ${atlas.slices ? Object.keys(atlas.slices).length : 0}</div>
            <div class="smp-row" style="margin-top:6px;">
              <button id="amp-reload" style="flex:1;">刷新图片</button>
            </div>
            <div class="smp-row" style="margin-top:12px;">
              <button id="amp-confirm" style="flex:1;">确定</button>
              <button id="amp-cancel" style="flex:1;">取消</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const editDraft = this._isSharedAtlas(atlas.id)
      ? this._ensureSharedAtlasDraft()
      : null;
    const editEpoch = editDraft ? editor.sharedAtlasProjectEpoch : null;
    const endModalEdit = editDraft ? this._beginSharedAtlasDraftEdit(editDraft) : null;

    const canvas = overlay.querySelector('#atlas-modal-canvas');
    const nameInput = overlay.querySelector('#amp-name');
    const pathInput = overlay.querySelector('#amp-path');
    const widthInput = overlay.querySelector('#amp-width');
    const heightInput = overlay.querySelector('#amp-height');
    const reloadButton = overlay.querySelector('#amp-reload');
    const confirmButton = overlay.querySelector('#amp-confirm');
    let closed = false;

    const drawAtlas = () => {
      if (!previewImage || !canvas?.isConnected) return;
      const maxCW = Math.min(700, window.innerWidth - 320);
      const maxCH = Math.min(500, window.innerHeight - 160);
      const scale = Math.min(maxCW / previewImage.naturalWidth, maxCH / previewImage.naturalHeight, 2);
      canvas.width = Math.round(previewImage.naturalWidth * scale);
      canvas.height = Math.round(previewImage.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(previewImage, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(76,175,80,0.7)';
      ctx.lineWidth = 1;
      for (const slice of Object.values(atlas.slices || {})) {
        ctx.strokeRect(slice.sx * scale, slice.sy * scale, slice.sw * scale, slice.sh * scale);
      }
    };
    drawAtlas();

    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      endModalEdit?.();
    };

    const loadInputPreview = async (nextPath) => {
      const image = await this._loadAtlasPreview(
        { ...atlas, path: nextPath },
        editDraft?.projectPath || this._currentProjectPath()
      );
      if (
        closed
        || (editDraft && !this._isSharedAtlasEditCurrent(editDraft, editEpoch))
      ) {
        throw new Error('图片加载期间项目或弹窗已切换，请重新打开图集');
      }
      previewImage = image;
      previewPath = nextPath;
      pathInput.value = nextPath;
      widthInput.value = image.naturalWidth;
      heightInput.value = image.naturalHeight;
      overlay.querySelector('#atlas-modal-load-error')?.remove();
      drawAtlas();
      return image;
    };

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#slice-modal-close').addEventListener('click', close);
    overlay.querySelector('#amp-cancel').addEventListener('click', close);
    reloadButton.addEventListener('click', async () => {
      if (editDraft && !this._isSharedAtlasEditCurrent(editDraft, editEpoch)) {
        editor.ui.showToast?.('项目已切换，请重新打开图集', 'error');
        close();
        return;
      }
      const endAsyncEdit = editDraft ? this._beginSharedAtlasDraftEdit(editDraft) : null;
      reloadButton.disabled = true;
      try {
        const requestedPath = this._normalizeAtlasPath(pathInput.value);
        await loadInputPreview(requestedPath);
      } catch (error) {
        if (!closed) editor.ui.showToast?.(error.message, 'error');
      } finally {
        endAsyncEdit?.();
        if (!closed) reloadButton.disabled = false;
      }
    });

    confirmButton.addEventListener('click', async () => {
      if (editDraft && !this._isSharedAtlasEditCurrent(editDraft, editEpoch)) {
        editor.ui.showToast?.('项目已切换，请重新打开图集', 'error');
        close();
        return;
      }
      const endAsyncEdit = editDraft ? this._beginSharedAtlasDraftEdit(editDraft) : null;
      confirmButton.disabled = true;
      try {
        const requestedPath = this._normalizeAtlasPath(pathInput.value);
        const requestedName = nameInput.value.trim();
        if (!previewImage || requestedPath !== previewPath) await loadInputPreview(requestedPath);
        if (editDraft && !this._isSharedAtlasEditCurrent(editDraft, editEpoch)) {
          throw new Error('编辑期间项目已切换，请在当前项目重新打开图集');
        }
        atlas.name = requestedName || atlas.name;
        atlas.path = previewPath;
        atlas.width = previewImage.naturalWidth;
        atlas.height = previewImage.naturalHeight;
        const draft = this._markSharedAtlasDraftDirty(editDraft, editEpoch);
        draft.previewImages.set(atlas.id, previewImage);
        this._updateAtlasList();
        this._updateSlicePreviews();
        this._showAtlasProperties();
        editor.render();
        close();
      } catch (error) {
        if (!closed) editor.ui.showToast?.(error.message, 'error');
      } finally {
        endAsyncEdit?.();
        if (!closed) confirmButton.disabled = false;
      }
    });
  }

  /**
   * 打开新建切片弹窗（与编辑切片弹窗类似，但初始选框为默认位置）
   * @private
   */
  _openNewSliceModal(atlas) {
    const editor = this.editor;
    const img = this._getAtlasImage(atlas.id);
    if (!img) {
      editor.ui.showToast?.('图集图片未加载，请先设置路径', 'error');
      return;
    }
    const editDraft = this._isSharedAtlas(atlas.id)
      ? this._ensureSharedAtlasDraft()
      : null;
    const editEpoch = editDraft ? editor.sharedAtlasProjectEpoch : null;
    const endEdit = editDraft ? this._beginSharedAtlasDraftEdit(editDraft) : null;

    // 默认切片参数
    const state = {
      sx: 0,
      sy: 0,
      sw: Math.min(64, img.naturalWidth),
      sh: Math.min(64, img.naturalHeight)
    };
    const sliceName = '新切片';
    const sliceKey = this._nextSliceKey(atlas);

    const overlay = document.createElement('div');
    overlay.id = 'slice-editor-overlay';
    overlay.innerHTML = `
      <div id="slice-editor-modal">
        <div class="slice-modal-header">
          <span>新建切片 - 图集: ${atlas.name}</span>
          <button id="slice-modal-close" title="关闭">✕</button>
        </div>
        <div class="slice-modal-body">
          <div class="slice-modal-canvas-wrap">
            <canvas id="slice-modal-canvas"></canvas>
          </div>
          <div class="slice-modal-params">
            <div class="smp-row"><label>Key:</label><input type="text" id="smp-key" value="${sliceKey}"></div>
            <div class="smp-row"><label>名称:</label><input type="text" id="smp-name" value="${sliceName}"></div>
            <div class="smp-row"><label>X:</label><input type="number" id="smp-sx" value="${state.sx}"></div>
            <div class="smp-row"><label>Y:</label><input type="number" id="smp-sy" value="${state.sy}"></div>
            <div class="smp-row"><label>宽:</label><input type="number" id="smp-sw" value="${state.sw}"></div>
            <div class="smp-row"><label>高:</label><input type="number" id="smp-sh" value="${state.sh}"></div>
            <div class="smp-row"><label>碰撞:</label><input type="checkbox" id="smp-collide"></div>
            <div class="smp-row"><label>碰撞半径:</label><input type="number" id="smp-radius" value="16"></div>
            <div class="smp-info">拖动选框选择切片区域</div>
            <div class="smp-row" style="margin-top:12px;">
              <button id="smp-confirm" style="flex:1;">创建</button>
              <button id="smp-cancel" style="flex:1;">取消</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = document.getElementById('slice-modal-canvas');
    const ctx = canvas.getContext('2d');

    const maxCW = Math.min(800, window.innerWidth - 320);
    const maxCH = Math.min(600, window.innerHeight - 160);
    const scale = Math.min(maxCW / img.naturalWidth, maxCH / img.naturalHeight, 2);
    const cw = Math.round(img.naturalWidth * scale);
    const ch = Math.round(img.naturalHeight * scale);
    canvas.width = cw;
    canvas.height = ch;

    let dragging = null;
    let dragStart = {};

    const draw = () => {
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, cw, ch);
      const rx = state.sx * scale, ry = state.sy * scale;
      const rw = state.sw * scale, rh = state.sh * scale;
      ctx.drawImage(img, state.sx, state.sy, state.sw, state.sh, rx, ry, rw, rh);
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(rx + rw - 6, ry + rh - 6, 8, 8);
    };
    draw();

    const syncInputs = () => {
      document.getElementById('smp-sx').value = Math.round(state.sx);
      document.getElementById('smp-sy').value = Math.round(state.sy);
      document.getElementById('smp-sw').value = Math.round(state.sw);
      document.getElementById('smp-sh').value = Math.round(state.sh);
    };

    const getCanvasPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    canvas.addEventListener('mousedown', (e) => {
      const pos = getCanvasPos(e);
      const rx = state.sx * scale, ry = state.sy * scale;
      const rw = state.sw * scale, rh = state.sh * scale;
      if (Math.abs(pos.x - (rx + rw)) < 10 && Math.abs(pos.y - (ry + rh)) < 10) {
        dragging = 'resize-br';
      } else if (pos.x >= rx && pos.x <= rx + rw && pos.y >= ry && pos.y <= ry + rh) {
        dragging = 'move';
      } else {
        return;
      }
      dragStart = { mx: pos.x, my: pos.y, sx: state.sx, sy: state.sy, sw: state.sw, sh: state.sh };
      e.preventDefault();
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!dragging) {
        const pos = getCanvasPos(e);
        const rx = state.sx * scale, ry = state.sy * scale;
        const rw = state.sw * scale, rh = state.sh * scale;
        if (Math.abs(pos.x - (rx + rw)) < 10 && Math.abs(pos.y - (ry + rh)) < 10) {
          canvas.style.cursor = 'nwse-resize';
        } else if (pos.x >= rx && pos.x <= rx + rw && pos.y >= ry && pos.y <= ry + rh) {
          canvas.style.cursor = 'move';
        } else {
          canvas.style.cursor = 'crosshair';
        }
        return;
      }
      const pos = getCanvasPos(e);
      const dx = (pos.x - dragStart.mx) / scale;
      const dy = (pos.y - dragStart.my) / scale;
      if (dragging === 'move') {
        state.sx = Math.max(0, Math.min(img.naturalWidth - state.sw, Math.round(dragStart.sx + dx)));
        state.sy = Math.max(0, Math.min(img.naturalHeight - state.sh, Math.round(dragStart.sy + dy)));
      } else if (dragging === 'resize-br') {
        state.sw = Math.max(4, Math.min(img.naturalWidth - state.sx, Math.round(dragStart.sw + dx)));
        state.sh = Math.max(4, Math.min(img.naturalHeight - state.sy, Math.round(dragStart.sh + dy)));
      }
      syncInputs();
      draw();
    });

    const stopDrag = () => { dragging = null; };
    canvas.addEventListener('mouseup', stopDrag);
    canvas.addEventListener('mouseleave', stopDrag);

    ['smp-sx', 'smp-sy', 'smp-sw', 'smp-sh'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        const v = parseInt(el.value) || 0;
        if (id === 'smp-sx') state.sx = Math.max(0, v);
        else if (id === 'smp-sy') state.sy = Math.max(0, v);
        else if (id === 'smp-sw') state.sw = Math.max(1, v);
        else if (id === 'smp-sh') state.sh = Math.max(1, v);
        draw();
      });
    });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      endEdit?.();
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('slice-modal-close').addEventListener('click', close);
    document.getElementById('smp-cancel').addEventListener('click', close);

    document.getElementById('smp-confirm').addEventListener('click', () => {
      const key = document.getElementById('smp-key').value.trim() || sliceKey;
      const name = document.getElementById('smp-name').value.trim() || '新切片';
      const sx = Math.round(state.sx);
      const sy = Math.round(state.sy);
      const sw = Math.round(state.sw);
      const sh = Math.round(state.sh);
      if (!STABLE_ID_PATTERN.test(key)) {
        editor.ui.showToast?.('切片 Key 必须以字母开头，且只能包含字母、数字、点、下划线和短横线', 'error');
        return;
      }
      if (atlas.slices[key]) {
        editor.ui.showToast?.(`切片 Key "${key}" 已存在，请换一个`, 'error');
        return;
      }
      if (sx < 0 || sy < 0 || sw <= 0 || sh <= 0 || sx + sw > img.naturalWidth || sy + sh > img.naturalHeight) {
        editor.ui.showToast?.('切片范围必须完整位于图集图片内', 'error');
        return;
      }
      if (editDraft && !this._isSharedAtlasEditCurrent(editDraft, editEpoch)) {
        editor.ui.showToast?.('编辑期间项目已切换，请在当前项目重新新建切片', 'error');
        close();
        return;
      }
      atlas.slices[key] = {
        name,
        sx,
        sy,
        sw,
        sh,
        collide: document.getElementById('smp-collide').checked,
        colliderRadius: parseInt(document.getElementById('smp-radius').value) || 16
      };
      this._markSharedAtlasDraftDirty(editDraft, editEpoch);
      this._updateAtlasList();
      this._updateSlicePreviews();
      this._showAtlasProperties();
      editor.render();
      editor.ui.showToast?.('切片已创建: ' + name);
      close();
    });
  }

  /**
   * 新建游戏级共享图集草稿。稳定 ID 从项目内图片路径确定生成，无需用户另行登记。
   */
  async addAtlas() {
    const editor = this.editor;
    const requestedPath = prompt(
      '请输入图集图片在当前游戏中的路径：\n（如 assets/images/environment/forest.png）',
      'assets/images/'
    );
    if (requestedPath === null) return { ok: false, committed: false, code: 'cancelled' };

    let endEdit = null;
    try {
      const pathValue = this._normalizeAtlasPath(requestedPath);
      const draft = this._ensureSharedAtlasDraft();
      const editEpoch = editor.sharedAtlasProjectEpoch;
      const existing = draft.config.atlases.find(atlas => atlas?.path === pathValue);
      if (existing) {
        editor.selectedAtlasId = existing.id;
        editor.selectedSlice = null;
        this._updateAtlasList();
        this._showAtlasProperties();
        editor.ui.showToast?.(`该图片已登记为共享图集: ${existing.name || existing.id}`, 'warn');
        return { ok: true, committed: false, status: 'existing', atlasId: existing.id };
      }

      const defaultName = pathValue.split('/').pop()?.replace(/\.[^.]+$/, '') || '新图集';
      const requestedName = prompt('请输入图集名称：', defaultName);
      if (requestedName === null) return { ok: false, committed: false, code: 'cancelled' };
      endEdit = this._beginSharedAtlasDraftEdit(draft);
      const image = await this._loadAtlasPreview({ path: pathValue }, draft.projectPath);
      if (!this._isSharedAtlasEditCurrent(draft, editEpoch)) {
        throw new Error('图片加载期间项目已切换，请在当前项目重新添加图集');
      }
      const id = this._deriveAtlasId(pathValue, draft.config.atlases);
      const atlas = {
        id,
        assetId: id,
        imageId: id,
        name: requestedName.trim() || defaultName,
        path: pathValue,
        width: image.naturalWidth,
        height: image.naturalHeight,
        slices: {}
      };
      draft.config.atlases.push(atlas);
      draft.previewImages.set(id, image);
      this._markSharedAtlasDraftDirty(draft, editEpoch);

      editor.selectedAtlasId = id;
      editor.selectedSlice = null;
      this._updateAtlasList();
      this._updateSlicePreviews();
      this._showAtlasProperties();
      editor.render();
      editor.ui.showToast?.(`已创建共享图集草稿 ${id}；保存时会自动同步 Manifest`);
      return { ok: true, committed: false, status: 'draft', atlasId: id, atlas };
    } catch (error) {
      editor.ui.showToast?.(`新建图集失败: ${error.message}`, 'error');
      return { ok: false, committed: false, code: 'atlasDraftCreateFailed', error };
    } finally {
      endEdit?.();
    }
  }

  deleteAtlas() {
    const editor = this.editor;
    const atlasId = editor.selectedAtlasId;
    if (!atlasId) {
      editor.ui.showToast?.('请先选择要删除的图集', 'warn');
      return { ok: false, committed: false, code: 'missingSelection' };
    }

    try {
      const draft = this._ensureSharedAtlasDraft();
      const editEpoch = editor.sharedAtlasProjectEpoch;
      const atlas = draft.config.atlases.find(candidate => candidate?.id === atlasId);
      if (!atlas) {
        editor.ui.showToast?.('场景局部 legacy 图集不能从共享 catalog 删除', 'warn');
        return { ok: false, committed: false, code: 'legacyAtlasReadOnly' };
      }
      const references = this._findCurrentSceneAtlasReferences(atlasId);
      if (references.length > 0) {
        editor.ui.showToast?.(`当前场景仍引用该图集: ${references.slice(0, 3).join(', ')}`, 'error');
        return { ok: false, committed: false, code: 'atlasStillReferenced', references };
      }
      if (!confirm(`确定删除共享图集「${atlas.name || atlasId}」吗？保存时会同时更新 Manifest。`)) {
        return { ok: false, committed: false, code: 'cancelled' };
      }

      draft.config.atlases = draft.config.atlases.filter(candidate => candidate?.id !== atlasId);
      draft.previewImages.delete(atlasId);
      this._markSharedAtlasDraftDirty(draft, editEpoch);
      editor.selectedAtlasId = null;
      if (editor.selectedSlice?.atlasId === atlasId) editor.selectedSlice = null;
      this._updateAtlasList();
      this._showAtlasProperties();
      editor.render();
      editor.ui.showToast?.('图集已从草稿删除；保存前不会修改磁盘', 'warn');
      return { ok: true, committed: false, status: 'draft', atlasId };
    } catch (error) {
      editor.ui.showToast?.(`删除图集失败: ${error.message}`, 'error');
      return { ok: false, committed: false, code: 'atlasDraftDeleteFailed', error };
    }
  }

  async saveAtlases() {
    const requestedProjectPath = this._currentProjectPath();
    const inFlight = this._atlasSavePromises.get(requestedProjectPath);
    if (inFlight) return inFlight;
    const save = async () => {
      const editor = this.editor;
      let draft;
      try { draft = this._ensureSharedAtlasDraft(); }
      catch (error) {
        editor.ui.showToast?.(`共享图集保存失败: ${error.message}`, 'error');
        return { ok: false, committed: false, code: 'sharedAtlasCatalogUnavailable', error };
      }
      if (!draft.dirty) {
        editor.ui.showToast?.('共享图集没有待保存修改');
        return { ok: true, committed: false, status: 'noChanges', code: 'noChanges' };
      }

      const saveSharedAtlasCatalog = editor.options?.saveSharedAtlasCatalog;
      if (typeof saveSharedAtlasCatalog !== 'function') {
        const result = {
          ok: false,
          committed: false,
          status: 'rejected',
          code: 'missingSharedAtlasPersistence',
          error: '宿主未配置共享图集提交服务'
        };
        editor.ui.showToast?.(result.error, 'error');
        return result;
      }

      // 保存候选与在途草稿分离；请求期间产生的新编辑必须继续保留为 dirty 草稿。
      const candidate = structuredClone(draft.config);
      const candidateFingerprint = JSON.stringify(candidate);
      const baseConfigAtSave = structuredClone(draft.baseConfig);
      const previewImagesAtSave = new Map(draft.previewImages);
      const projectPathAtSave = draft.projectPath;
      const projectEpochAtSave = editor.sharedAtlasProjectEpoch;
      let result;
      try { result = await saveSharedAtlasCatalog(projectPathAtSave, candidate); }
      catch (error) {
        result = { ok: false, committed: false, status: 'failed', code: 'sharedAtlasCommitFailed', error };
      }
      if (result?.ok !== true || result.committed !== true) {
        editor.ui.showToast?.(`共享图集保存失败: ${this._persistenceError(result, '磁盘未提交')}`, 'error');
        return result;
      }

      // 先把提交事实归档到请求所属项目；切换项目只影响当前 UI，不得丢弃迟到成功。
      const committedCatalog = editor.setCommittedSharedAtlasCatalog(
        projectPathAtSave,
        result.catalog || candidate
      );
      // 无论当前 UI 是否已切走，都先把提交事实写回请求所属项目的权威缓存分区。
      updateAtlasesCache(projectPathAtSave, structuredClone(committedCatalog));
      const changedIds = this._changedAtlasIds(baseConfigAtSave, committedCatalog);
      const projectDraft = this._getSharedAtlasDraft(projectPathAtSave);
      let hasPendingDraftChanges = false;
      if (projectDraft) {
        const configChangedSinceSave = projectDraft !== draft
          || JSON.stringify(projectDraft.config) !== candidateFingerprint;
        const hasPendingEdits = (Number(projectDraft.pendingEditCount) || 0) > 0;
        projectDraft.baseConfig = structuredClone(committedCatalog);
        if (!configChangedSinceSave && !hasPendingEdits) {
          projectDraft.dirty = false;
          this._clearSharedAtlasDraft(projectDraft);
        } else {
          projectDraft.dirty = JSON.stringify(projectDraft.config) !== JSON.stringify(committedCatalog);
          hasPendingDraftChanges = projectDraft.dirty || hasPendingEdits;
          if (!hasPendingDraftChanges) this._clearSharedAtlasDraft(projectDraft);
        }
      }

      const activeState = this._activateSharedAtlasProject();
      if (
        activeState.projectPath !== projectPathAtSave
        || activeState.epoch !== projectEpochAtSave
      ) {
        const warning = {
          category: 'postCommitProjectChanged',
          message: hasPendingDraftChanges
            ? '共享图集已写入磁盘，原项目的在途修改仍保留；编辑器已切换项目，当前界面未刷新'
            : '共享图集已写入磁盘，但编辑器已切换项目，当前界面未刷新'
        };
        editor.ui.showToast?.(warning.message, 'warn');
        return {
          ...result,
          degraded: true,
          status: 'committed-with-degradation',
          pendingDraftChanges: hasPendingDraftChanges || undefined,
          warnings: [...(Array.isArray(result.warnings) ? result.warnings : []), warning]
        };
      }

      try {
        for (const atlasId of changedIds) editor.loadedImages.delete(atlasId);
        const committedIds = new Set(committedCatalog.atlases.map(atlas => atlas.id));
        for (const [atlasId, image] of previewImagesAtSave.entries()) {
          if (committedIds.has(atlasId)) editor.loadedImages.set(atlasId, image);
        }

        const selectedSliceRef = editor.selectedSlice
          ? { atlasId: editor.selectedSlice.atlasId, sliceKey: editor.selectedSlice.sliceKey }
          : null;
        const visibleDraft = this._getSharedAtlasDraft(projectPathAtSave);
        const visibleCatalog = visibleDraft?.config || committedCatalog;
        const visibleIds = new Set(visibleCatalog.atlases.map(atlas => atlas.id));
        if (editor.selectedAtlasId && !visibleIds.has(editor.selectedAtlasId)) editor.selectedAtlasId = null;
        const selectedSliceExists = Boolean(
          selectedSliceRef
          && visibleCatalog.atlases.some(atlas => (
            atlas.id === selectedSliceRef.atlasId
            && Object.prototype.hasOwnProperty.call(atlas.slices || {}, selectedSliceRef.sliceKey)
          ))
        );
        if (selectedSliceRef && !selectedSliceExists) editor.selectedSlice = null;
        this.loadAtlasImages();
        this._updateAtlasList();
        this._updateSlicePreviews();
        if (selectedSliceExists) {
          this._selectSlice(selectedSliceRef.atlasId, selectedSliceRef.sliceKey);
        } else {
          this._showAtlasProperties();
        }
        editor.render();
      } catch (error) {
        editor.ui.showToast?.(`共享图集已写入磁盘，但编辑器缓存刷新失败: ${error.message}`, 'warn');
        return {
          ...result,
          degraded: true,
          status: 'committed-with-degradation',
          pendingDraftChanges: hasPendingDraftChanges || undefined,
          warnings: [
            ...(Array.isArray(result.warnings) ? result.warnings : []),
            { category: 'postCommitAtlasCacheRefreshFailed', message: error.message }
          ]
        };
      }

      editor.ui.showToast?.(
        hasPendingDraftChanges
          ? '共享图集已提交发送前修改；保存期间的新修改仍待保存'
          : (result.degraded ? '共享图集已提交，但磁盘后置同步降级' : '共享图集与 Asset Manifest 已原子保存'),
        hasPendingDraftChanges || result.degraded ? 'warn' : 'success'
      );
      return hasPendingDraftChanges ? { ...result, pendingDraftChanges: true } : result;
    };

    const savePromise = save();
    this._atlasSavePromises.set(requestedProjectPath, savePromise);
    try { return await savePromise; }
    finally {
      if (this._atlasSavePromises.get(requestedProjectPath) === savePromise) {
        this._atlasSavePromises.delete(requestedProjectPath);
      }
    }
  }

  /**
   * 保存所有图片资源到全局配置 config/images.json，并等待当前场景/模板的持久化事务。
   */
  async saveImages() {
    const editor = this.editor;
    const images = editor.sceneData.imageAssets || {};
    const configObj = { images };
    const content = JSON.stringify(configObj, null, 2);
    let configCommitted = false;
    try {
      const res = await fetch('/api/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'editor/config/images.json', content })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        throw new Error(data.error || `图片配置保存失败（HTTP ${res.status}）`);
      }

      configCommitted = true;
      updateImagesCache(configObj);
      const sceneResult = await editor.history.save();
      if (sceneResult?.ok !== true || sceneResult.committed !== true) {
        const message = this._persistenceError(sceneResult, '当前场景磁盘未提交');
        editor.ui.showToast?.(`图片配置已保存，但当前场景保存失败: ${message}`, 'warn');
        return {
          ok: false,
          committed: false,
          status: 'partial',
          code: 'sceneSaveFailedAfterImageConfigCommit',
          configCommitted: true,
          sceneResult
        };
      }

      if (sceneResult.degraded) {
        editor.ui.showToast?.('图片配置与当前场景已写入磁盘，但缓存/通知同步降级', 'warn');
      } else {
        editor.ui.showToast?.('图片配置与当前场景已保存');
      }
      return { ok: true, committed: true, configCommitted: true, sceneResult, degraded: Boolean(sceneResult.degraded) };
    } catch (error) {
      const prefix = configCommitted ? '图片配置已保存，但后续处理失败: ' : '图片保存失败: ';
      editor.ui.showToast?.(prefix + error.message, configCommitted ? 'warn' : 'error');
      return {
        ok: false,
        committed: false,
        status: configCommitted ? 'partial' : 'failed',
        code: configCommitted ? 'imagePostCommitFailed' : 'imageConfigSaveFailed',
        configCommitted,
        error
      };
    }
  }

  /**
   * 选中切片
   * @private
   */
  _selectSlice(atlasId, sliceKey) {
    const editor = this.editor;
    let shared = this._isSharedAtlas(atlasId);
    let sharedDraft = null;
    let sharedEpoch = null;
    if (shared) {
      try {
        sharedDraft = this._ensureSharedAtlasDraft();
        sharedEpoch = editor.sharedAtlasProjectEpoch;
      }
      catch (error) {
        editor.ui.showToast?.(`共享切片不可编辑: ${error.message}`, 'error');
        return;
      }
    }

    const atlas = this._getAtlas(atlasId);
    if (!atlas) return;
    shared = this._isSharedAtlas(atlasId);

    const slice = atlas.slices?.[sliceKey];
    if (!slice) return;

    // 切片选中时取消图集选中（避免面板冲突）
    editor.selectedAtlasId = null;

    // 更新选中状态
    editor.container.querySelectorAll('.slice-item').forEach(item => {
      item.classList.remove('selected');
    });

    const selectedEl = editor.container.querySelector(`.slice-item[data-atlas="${atlasId}"][data-slice="${sliceKey}"]`);
    if (selectedEl) selectedEl.classList.add('selected');

    const propsPanel = document.getElementById('slice-properties');
    const title = document.getElementById('slice-panel-title');
    if (title) title.textContent = '选中切片';
    if (propsPanel) {
      propsPanel.innerHTML = `
        <div class="slice-prop-row">
          <label>图集:</label>
          <input value="${escapeHtml(atlas.name || atlas.id)}" disabled style="color:#FFD700;">
        </div>
        <div class="slice-prop-row">
          <label>Key:</label>
          <input value="${escapeHtml(sliceKey)}" disabled style="color:#88ccff;">
        </div>
        <div class="slice-prop-row">
          <label>名称:</label>
          <input type="text" id="slice-name" value="${escapeHtml(slice.name || sliceKey)}">
        </div>
        <div class="slice-prop-row">
          <label>X:</label>
          <input type="number" id="slice-sx" value="${slice.sx}">
        </div>
        <div class="slice-prop-row">
          <label>Y:</label>
          <input type="number" id="slice-sy" value="${slice.sy}">
        </div>
        <div class="slice-prop-row">
          <label>宽度:</label>
          <input type="number" id="slice-sw" value="${slice.sw}">
        </div>
        <div class="slice-prop-row">
          <label>高度:</label>
          <input type="number" id="slice-sh" value="${slice.sh}">
        </div>
        <div class="slice-prop-row">
          <label>碰撞:</label>
          <input type="checkbox" id="slice-collide" ${slice.collide ? 'checked' : ''}>
        </div>
        <div class="slice-prop-row">
          <label>碰撞半径:</label>
          <input type="number" id="slice-radius" value="${slice.colliderRadius ?? 16}">
        </div>
        <div class="slice-prop-row" style="margin-top:8px;">
          <button id="slice-edit-btn" style="flex:1;padding:5px;cursor:pointer;">编辑</button>
          <button id="slice-delete-btn" style="flex:1;padding:5px;cursor:pointer;color:#f88;">删除</button>
        </div>
        ${shared ? `
          <div class="slice-prop-row">
            <button id="slice-save-btn" style="width:100%;padding:5px;cursor:pointer;">💾 保存共享图集</button>
          </div>
          <div style="padding:8px 2px;color:#7ec8ff;font-size:11px;line-height:1.5;">
            游戏级共享草稿：保存时与 Asset Manifest 原子提交；场景对象只引用 atlasId 与 sliceKey。
          </div>
        ` : ''}
      `;

      const geometryProps = new Set(['sx', 'sy', 'sw', 'sh']);
      ['name', 'sx', 'sy', 'sw', 'sh', 'collide', 'radius'].forEach(prop => {
        const el = document.getElementById(`slice-${prop}`);
        if (!el) return;
        el.addEventListener('change', () => {
          const actualProp = prop === 'radius' ? 'colliderRadius' : prop;
          let value;
          if (el.type === 'checkbox') {
            value = el.checked;
          } else if (el.type === 'number') {
            value = el.value.trim() === '' ? Number.NaN : Number(el.value);
            if (geometryProps.has(actualProp) && Number.isFinite(value)) value = Math.round(value);
          } else {
            value = el.value.trim();
          }

          const candidate = { ...slice, [actualProp]: value };
          const validationError = this._validateSliceCandidate(
            candidate,
            atlas,
            this._getAtlasImage(atlas.id)
          );
          if (validationError) {
            if (el.type === 'checkbox') el.checked = Boolean(slice[actualProp]);
            else el.value = slice[actualProp] ?? '';
            editor.ui.showToast?.(validationError, 'error');
            return;
          }

          if (shared && !this._isSharedAtlasEditCurrent(sharedDraft, sharedEpoch)) {
            if (el.type === 'checkbox') el.checked = Boolean(slice[actualProp]);
            else el.value = slice[actualProp] ?? '';
            editor.ui.showToast?.('项目已切换，请重新选择切片后编辑', 'error');
            return;
          }

          Object.assign(slice, candidate);
          if (shared) {
            this._markSharedAtlasDraftDirty(sharedDraft, sharedEpoch);
          } else if (editor.sceneData.decoSprites?.[sliceKey]) {
            editor.sceneData.decoSprites[sliceKey][actualProp] = value;
          }

          if (actualProp === 'name') this._updateAtlasList();
          this._updateSlicePreviews();
          editor.render();
        });
      });

      document.getElementById('slice-edit-btn')?.addEventListener('click', () => {
        this._openSliceEditorModal(atlas, sliceKey, slice);
      });

      document.getElementById('slice-delete-btn')?.addEventListener('click', () => {
        if (shared) {
          const references = this._findCurrentSceneAtlasReferences(atlasId, sliceKey);
          if (references.length > 0) {
            editor.ui.showToast?.(
              `当前场景仍引用该切片: ${references.slice(0, 3).join(', ')}`,
              'error'
            );
            return;
          }
        }
        if (!confirm(`确定删除切片「${slice.name || sliceKey}」吗？`)) return;
        if (shared && !this._isSharedAtlasEditCurrent(sharedDraft, sharedEpoch)) {
          editor.ui.showToast?.('项目已切换，请重新选择切片后删除', 'error');
          return;
        }

        delete atlas.slices[sliceKey];
        if (shared) {
          this._markSharedAtlasDraftDirty(sharedDraft, sharedEpoch);
        } else if (editor.sceneData.decoSprites?.[sliceKey]) {
          delete editor.sceneData.decoSprites[sliceKey];
        }
        editor.selectedSlice = null;
        if (propsPanel) propsPanel.innerHTML = '<div class="no-selection">未选中切片</div>';
        this._updateAtlasList();
        this._updateSlicePreviews();
        editor.render();
        editor.ui.showToast?.(
          shared ? '切片已从共享草稿删除；保存前不会修改磁盘' : '切片已删除',
          shared ? 'warn' : 'success'
        );
      });

      document.getElementById('slice-save-btn')?.addEventListener('click', () => this.saveAtlases());
    }

    editor.selectedSlice = { atlasId, sliceKey, slice };
  }

  /**
   * 打开切片编辑弹窗：显示图集原图，可拖动/调整切片选框，实时参数反馈
   * @private
   */
  _openSliceEditorModal(atlas, sliceKey, slice) {
    const editor = this.editor;
    const shared = this._isSharedAtlas(atlas.id);
    if (shared) {
      try {
        this._ensureSharedAtlasDraft();
        atlas = this._getAtlas(atlas.id);
        slice = atlas?.slices?.[sliceKey];
      } catch (error) {
        editor.ui.showToast?.(`共享切片不可编辑: ${error.message}`, 'error');
        return;
      }
    }
    if (!atlas || !slice) return;

    const img = this._getAtlasImage(atlas.id);
    if (!img) {
      editor.ui.showToast?.('图集图片未加载，请先设置路径并保存', 'error');
      return;
    }
    const editDraft = shared ? this._ensureSharedAtlasDraft() : null;
    const editEpoch = editDraft ? editor.sharedAtlasProjectEpoch : null;
    const endEdit = editDraft ? this._beginSharedAtlasDraftEdit(editDraft) : null;

    // 创建遮罩 + 弹窗
    const overlay = document.createElement('div');
    overlay.id = 'slice-editor-overlay';
    overlay.innerHTML = `
      <div id="slice-editor-modal">
        <div class="slice-modal-header">
          <span>切片编辑 - ${slice.name || sliceKey}（图集: ${atlas.name}）</span>
          <button id="slice-modal-close" title="关闭">✕</button>
        </div>
        <div class="slice-modal-body">
          <div class="slice-modal-canvas-wrap">
            <canvas id="slice-modal-canvas"></canvas>
          </div>
          <div class="slice-modal-params">
            <div class="smp-row"><label>X:</label><input type="number" id="smp-sx" value="${slice.sx}"></div>
            <div class="smp-row"><label>Y:</label><input type="number" id="smp-sy" value="${slice.sy}"></div>
            <div class="smp-row"><label>宽:</label><input type="number" id="smp-sw" value="${slice.sw}"></div>
            <div class="smp-row"><label>高:</label><input type="number" id="smp-sh" value="${slice.sh}"></div>
            <div class="smp-row"><label>碰撞:</label><input type="checkbox" id="smp-collide" ${slice.collide ? 'checked' : ''}></div>
            <div class="smp-row"><label>碰撞半径:</label><input type="number" id="smp-radius" value="${slice.colliderRadius ?? 16}"></div>
            <div class="smp-info" id="smp-info">图集: ${img.naturalWidth}×${img.naturalHeight}</div>
            <div class="smp-row" style="margin-top:12px;">
              <button id="smp-confirm" style="flex:1;">确定</button>
              <button id="smp-cancel" style="flex:1;">取消</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 状态
    const orig = { sx: slice.sx, sy: slice.sy, sw: slice.sw, sh: slice.sh };
    const state = { sx: slice.sx, sy: slice.sy, sw: slice.sw, sh: slice.sh };
    let dragging = null; // null | 'move' | 'resize-br'
    let dragStart = { mx: 0, my: 0, sx: 0, sy: 0, sw: 0, sh: 0 };

    const canvas = document.getElementById('slice-modal-canvas');
    const ctx = canvas.getContext('2d');

    // 缩放：让图集图片适应弹窗画布区域（限800×600）
    const maxCW = Math.min(800, window.innerWidth - 320);
    const maxCH = Math.min(600, window.innerHeight - 160);
    const scale = Math.min(maxCW / img.naturalWidth, maxCH / img.naturalHeight, 2);
    const cw = Math.round(img.naturalWidth * scale);
    const ch = Math.round(img.naturalHeight * scale);
    canvas.width = cw;
    canvas.height = ch;

    const draw = () => {
      ctx.clearRect(0, 0, cw, ch);
      // 图集原图
      ctx.drawImage(img, 0, 0, cw, ch);
      // 半透明遮罩
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, cw, ch);
      // 高亮选区
      const rx = state.sx * scale, ry = state.sy * scale;
      const rw = state.sw * scale, rh = state.sh * scale;
      ctx.drawImage(img, state.sx, state.sy, state.sw, state.sh, rx, ry, rw, rh);
      // 边框
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
      // 右下角手柄
      ctx.fillStyle = '#4CAF50';
      ctx.fillRect(rx + rw - 6, ry + rh - 6, 8, 8);
    };
    draw();

    // 实时更新参数输入框
    const syncInputs = () => {
      document.getElementById('smp-sx').value = Math.round(state.sx);
      document.getElementById('smp-sy').value = Math.round(state.sy);
      document.getElementById('smp-sw').value = Math.round(state.sw);
      document.getElementById('smp-sh').value = Math.round(state.sh);
    };

    // Canvas 鼠标事件：拖动移动选框 / 右下角缩放
    const getCanvasPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    canvas.addEventListener('mousedown', (e) => {
      const pos = getCanvasPos(e);
      const rx = state.sx * scale, ry = state.sy * scale;
      const rw = state.sw * scale, rh = state.sh * scale;
      // 右下角手柄（10px范围）
      if (Math.abs(pos.x - (rx + rw)) < 10 && Math.abs(pos.y - (ry + rh)) < 10) {
        dragging = 'resize-br';
      } else if (pos.x >= rx && pos.x <= rx + rw && pos.y >= ry && pos.y <= ry + rh) {
        dragging = 'move';
      } else {
        return;
      }
      dragStart = { mx: pos.x, my: pos.y, sx: state.sx, sy: state.sy, sw: state.sw, sh: state.sh };
      e.preventDefault();
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!dragging) {
        // 光标样式
        const pos = getCanvasPos(e);
        const rx = state.sx * scale, ry = state.sy * scale;
        const rw = state.sw * scale, rh = state.sh * scale;
        if (Math.abs(pos.x - (rx + rw)) < 10 && Math.abs(pos.y - (ry + rh)) < 10) {
          canvas.style.cursor = 'nwse-resize';
        } else if (pos.x >= rx && pos.x <= rx + rw && pos.y >= ry && pos.y <= ry + rh) {
          canvas.style.cursor = 'move';
        } else {
          canvas.style.cursor = 'crosshair';
        }
        return;
      }
      const pos = getCanvasPos(e);
      const dx = (pos.x - dragStart.mx) / scale;
      const dy = (pos.y - dragStart.my) / scale;
      if (dragging === 'move') {
        state.sx = Math.max(0, Math.min(img.naturalWidth - state.sw, Math.round(dragStart.sx + dx)));
        state.sy = Math.max(0, Math.min(img.naturalHeight - state.sh, Math.round(dragStart.sy + dy)));
      } else if (dragging === 'resize-br') {
        state.sw = Math.max(4, Math.min(img.naturalWidth - state.sx, Math.round(dragStart.sw + dx)));
        state.sh = Math.max(4, Math.min(img.naturalHeight - state.sy, Math.round(dragStart.sh + dy)));
      }
      syncInputs();
      draw();
    });

    const stopDrag = () => { dragging = null; };
    canvas.addEventListener('mouseup', stopDrag);
    canvas.addEventListener('mouseleave', stopDrag);

    // 参数输入框变化 → 刷新画布
    ['smp-sx', 'smp-sy', 'smp-sw', 'smp-sh'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        const v = parseInt(el.value) || 0;
        if (id === 'smp-sx') state.sx = Math.max(0, v);
        else if (id === 'smp-sy') state.sy = Math.max(0, v);
        else if (id === 'smp-sw') state.sw = Math.max(1, v);
        else if (id === 'smp-sh') state.sh = Math.max(1, v);
        draw();
      });
    });

    // 关闭/确定/取消
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      endEdit?.();
    };
    document.getElementById('slice-modal-close').addEventListener('click', close);
    document.getElementById('smp-cancel').addEventListener('click', () => {
      // 恢复原始值
      state.sx = orig.sx; state.sy = orig.sy; state.sw = orig.sw; state.sh = orig.sh;
      close();
    });
    document.getElementById('smp-confirm').addEventListener('click', () => {
      const radiusValue = document.getElementById('smp-radius').value.trim();
      const candidate = {
        ...slice,
        sx: Math.round(state.sx),
        sy: Math.round(state.sy),
        sw: Math.round(state.sw),
        sh: Math.round(state.sh),
        collide: document.getElementById('smp-collide').checked,
        colliderRadius: radiusValue === '' ? Number.NaN : Number(radiusValue)
      };
      const validationError = this._validateSliceCandidate(candidate, atlas, img);
      if (validationError) {
        editor.ui.showToast?.(validationError, 'error');
        return;
      }
      if (editDraft && !this._isSharedAtlasEditCurrent(editDraft, editEpoch)) {
        editor.ui.showToast?.('编辑期间项目已切换，请在当前项目重新编辑切片', 'error');
        close();
        return;
      }

      Object.assign(slice, candidate);
      if (shared) {
        this._markSharedAtlasDraftDirty(editDraft, editEpoch);
      } else if (editor.sceneData.decoSprites?.[sliceKey]) {
        Object.assign(editor.sceneData.decoSprites[sliceKey], {
          sx: slice.sx,
          sy: slice.sy,
          sw: slice.sw,
          sh: slice.sh,
          collide: slice.collide,
          colliderRadius: slice.colliderRadius
        });
      }
      this._selectSlice(atlas.id, sliceKey);
      this._updateSlicePreviews();
      editor.render();
      editor.ui.showToast?.(shared ? '共享切片已更新，请保存共享图集' : '切片已更新');
      close();
    });
    // 点遮罩空白区也关闭
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  /**
   * 恢复保存的图片资源
   */
  /**
   * 预载场景普通图片。场景自己的 imageAssets 保持兼容；未在场景内重复路径的
   * type:'image' 对象则从项目 Manifest 解析稳定 imageId，避免编辑器预览与运行时脱节。
   */
  async loadImageAssets(sceneDatas = [this.editor.sceneData]) {
    const editor = this.editor;
    const scenes = (Array.isArray(sceneDatas) ? sceneDatas : [sceneDatas]).filter(Boolean);
    const generation = ++this._sceneImageLoadGeneration;
    const activeScene = editor.sceneData;
    const { projectPath, epoch } = this._activatePlacementProject();
    const sources = new Map();

    // 九宫格会为同一场景连续准备空邻居和完整邻居。只要 imageId 的源路径未变，
    // 前一批已开始的图片请求仍应可提交缓存；切换场景时必须丢弃其请求记录。
    if (this._sceneImageRequestScene !== activeScene) {
      this._sceneImageRequestScene = activeScene;
      this._sceneImageRequestSources = new Map();
    }
    const requestedSources = this._sceneImageRequestSources;

    for (const sceneData of scenes) {
      for (const [id, data] of Object.entries(sceneData.imageAssets || {})) {
        const src = typeof data?.src === 'string' ? data.src.trim() : '';
        if (!src) throw new TypeError(`场景 ${sceneData.id || sceneData.name || '<unknown>'} 的 imageAssets.${id}.src 无效`);
        const previous = sources.get(id);
        if (previous && previous.src !== src) {
          throw new Error(
            `稳定 imageId ${id} 在九宫格中映射到不同文件: ${previous.sceneId} -> ${previous.src}, ` +
            `${sceneData.id || sceneData.name || '<unknown>'} -> ${src}`
          );
        }
        sources.set(id, {
          aliases: [id],
          sceneId: sceneData.id || sceneData.name || '<unknown>',
          src
        });
      }
    }

    try {
      const manifestEntries = await this._ensureAssetManifest();
      if (!this._isPlacementProjectCurrent(projectPath, epoch) || generation !== this._sceneImageLoadGeneration || editor.sceneData !== activeScene) return;

      for (const sceneData of scenes) {
        for (const layer of sceneData.layers || []) {
          for (const object of layer?.objects || []) {
            if (object?.type !== 'image' || typeof object.imageId !== 'string') continue;
            const imageId = object.imageId.trim();
            if (!imageId || sources.has(imageId)) continue;
            const entry = manifestEntries.get(imageId);
            const src = entry ? this._resolveManifestImageUrl(entry, projectPath) : '';
            if (!src) {
              console.warn(`[SceneEditorAssets] 场景图片缺少可加载 Manifest 资源: ${imageId}`);
              continue;
            }
            sources.set(imageId, {
              aliases: [imageId, entry.imageId, entry.assetId].filter(Boolean),
              sceneId: sceneData.id || sceneData.name || '<unknown>',
              src
            });
          }
        }
      }
    } catch (error) {
      if (this._isPlacementProjectCurrent(projectPath, epoch) && generation === this._sceneImageLoadGeneration && editor.sceneData === activeScene) {
        console.warn('[SceneEditorAssets] Manifest 场景图片资源准备失败:', error);
      }
    }

    for (const [id, { aliases, src }] of sources) {
      const stableAliases = [...new Set(aliases
        .filter(alias => typeof alias === 'string' && alias.trim())
        .map(alias => alias.trim()))];
      for (const alias of stableAliases) requestedSources.set(alias, src);

      const loadedImage = stableAliases.map(alias => editor.loadedImages.get(alias)).find(Boolean);
      if (loadedImage) {
        for (const alias of stableAliases) editor.loadedImages.set(alias, loadedImage);
        continue;
      }
      const isCurrentSource = () => (
        editor.sceneData === activeScene
        && this._isPlacementProjectCurrent(projectPath, epoch)
        && stableAliases.every(alias => requestedSources.get(alias) === src)
      );
      const img = new Image();
      img.onload = () => {
        if (!isCurrentSource()) return;
        for (const alias of stableAliases) editor.loadedImages.set(alias, img);
        editor.render();
        if (editor.selectedObjects?.some(object => (
          object?.type === 'image' && stableAliases.includes(object.imageId)
        ))) {
          editor.ui?.updateObjectProperties?.();
        }
      };
      img.onerror = () => {
        if (isCurrentSource()) {
          console.error(`[SceneEditorAssets] 场景图片加载失败: ${id} (${src})`);
        }
      };
      img.src = src;
    }
  }

  /**
   * 加载图集图片。共享草稿图片只进入 draft.previewImages，提交前不污染已提交缓存。
   */
  loadAtlasImages() {
    const editor = this.editor;
    const generation = ++this._atlasImageLoadGeneration;
    const { projectPath, epoch: projectEpoch } = this._activateSharedAtlasProject();

    // 1. 加载地形底图
    const terrainImage = editor.sceneData.terrain?.image;
    if (terrainImage && !editor.loadedImages.has('terrain_atlas')) {
      const timg = new Image();
      timg.onload = () => {
        if (
          generation !== this._atlasImageLoadGeneration
          || projectPath !== this._currentProjectPath()
          || projectEpoch !== editor.sharedAtlasProjectEpoch
        ) return;
        editor.loadedImages.set('terrain_atlas', timg);
        editor.render();
      };
      timg.onerror = () => console.error('Failed to load terrain image:', terrainImage);
      timg.src = terrainImage;
    }

    // 2. 加载场景局部与游戏级共享图集；共享定义不写入 sceneData。
    const atlases = this._availableAtlases();
    for (const atlas of atlases) {
      const shared = this._isSharedAtlas(atlas.id);
      const draftAtRequest = shared ? this._getSharedAtlasDraft(projectPath) : null;
      const targetMap = draftAtRequest?.previewImages || editor.loadedImages;
      if (targetMap.has(atlas.id)) continue;

      const imageUrl = shared
        ? this._resolveAtlasImageUrl(atlas, projectPath)
        : (editor.getAtlasImageUrl?.(atlas.id) || atlas.path);
      if (!imageUrl) continue;

      const requestedPath = String(atlas.path || '');
      const img = new Image();
      img.onload = () => {
        if (
          generation !== this._atlasImageLoadGeneration
          || projectPath !== this._currentProjectPath()
          || projectEpoch !== editor.sharedAtlasProjectEpoch
        ) return;

        if (shared) {
          const currentDraft = this._getSharedAtlasDraft(projectPath);
          if (draftAtRequest && currentDraft !== draftAtRequest) return;
          if (currentDraft) {
            const currentAtlas = currentDraft.config.atlases.find(candidate => candidate?.id === atlas.id);
            if (!currentAtlas || this._resolveAtlasImageUrl(currentAtlas, projectPath) !== imageUrl) return;
            currentDraft.previewImages.set(atlas.id, img);
          } else {
            const currentAtlas = this._getAtlas(atlas.id);
            if (!currentAtlas || !this._isSharedAtlas(atlas.id) || this._resolveAtlasImageUrl(currentAtlas, projectPath) !== imageUrl) {
              return;
            }
            editor.loadedImages.set(atlas.id, img);
          }
        } else {
          const currentAtlas = this._getAtlas(atlas.id);
          if (!currentAtlas || String(currentAtlas.path || '') !== requestedPath) return;
          editor.loadedImages.set(atlas.id, img);
        }

        editor.render();
        this._updateSlicePreviews();
      };
      img.onerror = () => {
        if (
          generation === this._atlasImageLoadGeneration
          && projectPath === this._currentProjectPath()
          && projectEpoch === editor.sharedAtlasProjectEpoch
        ) {
          console.error('Failed to load atlas:', atlas.id, 'path:', imageUrl);
        }
      };
      img.src = imageUrl;
    }
  }

  /**
   * 更新切片预览图
   * @private
   */
  _updateSlicePreviews() {
    const editor = this.editor;
    const atlases = this._availableAtlases();
    for (const atlas of atlases) {
      const img = this._getAtlasImage(atlas.id);
      if (!img) continue;

      for (const [sliceKey, slice] of Object.entries(atlas.slices || {})) {
        const previewEl = editor.container.querySelector(
          `.slice-item[data-atlas="${atlas.id}"][data-slice="${sliceKey}"] .slice-preview`
        );

        if (previewEl) {
          const canvas = document.createElement('canvas');
          canvas.width = slice.sw;
          canvas.height = slice.sh;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, slice.sx, slice.sy, slice.sw, slice.sh, 0, 0, slice.sw, slice.sh);
          previewEl.innerHTML = `<img src="${canvas.toDataURL()}" alt="${escapeHtml(slice.name || sliceKey)}">`;
        }
      }
    }
  }
}

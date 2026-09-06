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

/**
 * SceneEditor - 场景编辑器主入口
 * 
 * 功能模块：
 * - SceneEditorUI       — UI 面板初始化与属性面板更新
 * - SceneEditorCanvas   — Canvas 渲染
 * - SceneEditorInteraction — 鼠标/键盘事件处理
 * - SceneEditorLayers   — 图层管理
 * - SceneEditorAssets   — 资源管理（图集、切片、拖放）
 * - SceneEditorHistory  — 撤销/重做/导入导出
 * 
 * 所有默认值从 config/editor-defaults.json 加载
 */

import { SceneEditorUI } from './SceneEditorUI.js';
import { SceneEditorCanvas } from './SceneEditorCanvas.js';
import { SceneEditorInteraction } from './SceneEditorInteraction.js';
import { SceneEditorLayers } from './SceneEditorLayers.js';
import { SceneEditorAssets } from './SceneEditorAssets.js';
import { SceneEditorHistory } from './SceneEditorHistory.js';
import { SceneEditorEventFilter } from './SceneEditorEventFilter.js';
import {
  activateGlobalAtlasesProject,
  getGlobalAtlasImageUrl,
  getGlobalAtlasesConfig,
  getGlobalImages,
  normalizeAtlasProjectPath
} from './SceneDataLoader.js';
import { AtlasRegistry } from '../src/core/scene/AtlasRegistry.js';
import { summarizeTrigger } from '../src/systems/TriggerCatalog.js';
import {
  SCENE_BATTLE_FLOW_STRING_FIELDS,
  SceneBattleFlowRegistry
} from '../src/core/scene/SceneBattleFlowRegistry.js';
import { normalizePresentationProfile } from '../src/core/PresentationProfile.js';

// 编辑器默认配置（运行时从 JSON 加载覆盖）
let _editorDefaults = null;

/**
 * 加载编辑器默认配置
 * @returns {Promise<Object>}
 */
async function loadEditorDefaults() {
  if (_editorDefaults) return _editorDefaults;
  try {
    const resp = await fetch('./config/editor-defaults.json');
    _editorDefaults = await resp.json();
  } catch (e) {
    console.warn('加载编辑器默认配置失败，使用内置默认值:', e);
    _editorDefaults = {
      editor: { width: 1280, height: 720, gridSize: 32, showGrid: true, showBackground: true },
      scene: {
        defaultName: '新场景',
        width: 1280,
        height: 720,
        backgroundColor: '#2a3a1a',
        layers: [
          { id: 'layer_bg', name: '背景层', visible: true, locked: false },
          { id: 'layer_fill', name: '背景填充层', visible: true, locked: false },
          { id: 'layer_deco', name: '装饰层', visible: true, locked: false },
          { id: 'layer_entity', name: '实体层', visible: true, locked: false }
        ]
      },
      viewport: { scale: 1, offsetX: 0, offsetY: 0 },
      history: { maxSize: 50 }
    };
  }
  return _editorDefaults;
}

export { loadEditorDefaults };

export class SceneEditor {
  constructor(container, options = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    // 默认配置从 JSON 加载（同步回退）
    const defaults = _editorDefaults || {};
    const editorCfg = defaults.editor || {};
    const sceneCfg = defaults.scene || {};
    const viewportCfg = defaults.viewport || {};
    const historyCfg = defaults.history || {};
    this.presentationProfile = normalizePresentationProfile(options.presentationProfile || {});
    const logicalResolution = this.presentationProfile.logicalResolution;

    this.options = {
      width: options.width || logicalResolution.width || editorCfg.width || 1280,
      height: options.height || logicalResolution.height || editorCfg.height || 720,
      gridSize: options.gridSize || this.presentationProfile.world.gridSize || editorCfg.gridSize || 32,
      showGrid: options.showGrid !== undefined ? options.showGrid : (editorCfg.showGrid !== false),
      showBackground: options.showBackground !== undefined ? options.showBackground : (editorCfg.showBackground !== false),
      ...options
    };

    // 场景数据
    const defaultLayers = (sceneCfg.layers || [
      { id: 'layer_bg', name: '背景层', visible: true, locked: false },
      { id: 'layer_fill', name: '背景填充层', visible: true, locked: false },
      { id: 'layer_deco', name: '装饰层', visible: true, locked: false },
      { id: 'layer_entity', name: '实体层', visible: true, locked: false }
    ]).map(l => ({ ...l, objects: [] }));

    this.sceneData = {
      id: null,
      name: sceneCfg.defaultName || '新场景',
      width: this.options.width,
      height: this.options.height,
      backgroundColor: sceneCfg.backgroundColor || '#2a3a1a',
      layers: defaultLayers,
      decorations: [],
      colliders: []
    };

    // 状态
    this.activeLayerIndex = 0;
    this.selectedObjects = [];
    this.loadedImages = new Map();
    this.selectedSlice = null;
    this.draggingSlice = null;
    this.selectedAtlasId = null;
    // 共享图集编辑始终基于独立草稿；磁盘提交成功前不替换 SceneDataLoader 权威缓存。
    // 两个 Map 是按项目状态权威，sharedAtlasDraft 仅是当前活动项目的兼容投影。
    this.sharedAtlasDraft = null;
    this.sharedAtlasDrafts = new Map();
    this.sharedAtlasCommittedCatalogs = new Map();
    this.sharedAtlasActiveProjectPath = null;
    this.sharedAtlasProjectEpoch = 0;

    // 相邻场景参考（大地图多场景编辑模式）
    // 格式: [{ sceneData, offsetX, offsetY }]
    this.neighborScenes = [];
    this.showNeighbors = false;

    // 视口控制
    this.viewport = {
      scale: viewportCfg.scale || 1,
      offsetX: viewportCfg.offsetX || 0,
      offsetY: viewportCfg.offsetY || 0
    };

    // 交互状态
    this.interaction = {
      mode: 'select',
      isDragging: false,
      isResizing: false,
      isRotating: false,
      dragStart: { x: 0, y: 0 },
      objectStart: { x: 0, y: 0 }
    };

    // 回调
    this.onSceneChange = typeof options.onSceneChange === 'function' ? options.onSceneChange : null;
    this.onSceneMetaChange = typeof options.onSceneMetaChange === 'function' ? options.onSceneMetaChange : null;
    this.onObjectSelect = typeof options.onObjectSelect === 'function' ? options.onObjectSelect : null;
    this.onOpenSlicer = typeof options.onOpenSlicer === 'function' ? options.onOpenSlicer : null;

    // 初始化标志
    this.initialized = false;

    // === 初始化子模块 ===
    this.layers = new SceneEditorLayers(this);
    this.history = new SceneEditorHistory(this);
    this.history.setMaxSize(historyCfg.maxSize || 50);
    this.eventFilter = new SceneEditorEventFilter(this);
    this.ui = new SceneEditorUI(this);
    this.canvas = new SceneEditorCanvas(this);
    this.interactionModule = new SceneEditorInteraction(this);
    this.assets = new SceneEditorAssets(this);

    // 初始化 UI 和事件
    this.ui.initUI();
    this._bindEvents();

    // 监听 resize
    window.addEventListener('resize', () => {
      if (this.initialized) {
        this.ui.fitToContainer();
        this.render();
      }
    });
  }

  getProjectDefinitions() {
    try {
      const definitions = this.options.getProjectDefinitions?.();
      if (definitions && typeof definitions === 'object') return definitions;
      return { triggers: this.options.getProjectTriggers?.() || [], tutorials: [] };
    } catch (error) {
      console.warn('SceneEditor: 获取项目事件定义失败', error);
      return { triggers: [], tutorials: [] };
    }
  }

  getProjectTriggers() {
    const values = this.getProjectDefinitions().triggers;
    return Array.isArray(values) ? values : [];
  }

  getProjectTutorials() {
    const values = this.getProjectDefinitions().tutorials;
    return Array.isArray(values) ? values : [];
  }

  getProjectTrigger(id) {
    return this.getProjectTriggers().find(trigger => trigger?.id === id) || null;
  }

  getTriggerSummary(id) {
    return summarizeTrigger(this.getProjectTrigger(id), this.getProjectDefinitions());
  }

  refreshTriggerReferences() {
    this.eventFilter.rebuild({ preserveSelection: true });
    this.ui.updateObjectProperties();
    this.render();
  }

  getBattleDefinitions() {
    if (typeof this.options.getBattleDefinitions !== 'function') return null;
    try {
      const definitions = this.options.getBattleDefinitions();
      return Array.isArray(definitions) ? definitions : [];
    } catch (error) {
      console.warn('SceneEditor: 获取项目战役定义失败', error);
      return [];
    }
  }

  _applyBattleFlowFields() {
    const battleIdInput = document.getElementById('editor-battle-id');
    if (!battleIdInput) return false;
    const battleId = battleIdInput.value.trim();
    const currentGameplay = this.sceneData.gameplay || {};

    if (!battleId) {
      if (!currentGameplay.battleId && !currentGameplay.battleFlow) return true;
      const nextGameplay = { ...currentGameplay };
      delete nextGameplay.battleId;
      delete nextGameplay.battleFlow;
      this.history.saveHistory();
      if (Object.keys(nextGameplay).length) this.sceneData.gameplay = nextGameplay;
      else delete this.sceneData.gameplay;
      this.ui.refreshBattleFlowFields();
      this.ui.showToast('已移除当前场景的战役流程参数');
      return true;
    }

    try {
      const battleFlow = {};
      for (const field of SCENE_BATTLE_FLOW_STRING_FIELDS) {
        const input = document.querySelector(`[data-battle-flow-field="${field}"]`);
        battleFlow[field] = String(input?.value || '').trim();
      }
      const worldChangesInput = document.getElementById('editor-battle-world-changes');
      const worldChanges = JSON.parse(worldChangesInput?.value || '{}');
      if (worldChanges === null || typeof worldChanges !== 'object' || Array.isArray(worldChanges)) {
        throw new Error('worldChanges 必须是 JSON 普通对象');
      }
      battleFlow.worldChanges = worldChanges;

      const candidate = JSON.parse(JSON.stringify(this.sceneData));
      candidate.gameplay = { ...(candidate.gameplay || {}), battleId, battleFlow };
      const registry = new SceneBattleFlowRegistry();
      registry.validate(candidate, this.getBattleDefinitions());

      const previous = JSON.stringify({
        battleId: currentGameplay.battleId || '',
        battleFlow: currentGameplay.battleFlow || null
      });
      const next = JSON.stringify({ battleId, battleFlow });
      if (previous === next) return true;

      this.history.saveHistory();
      this.sceneData.gameplay = { ...currentGameplay, battleId, battleFlow };
      this.ui.refreshBattleFlowFields();
      this.ui.showToast('战役流程参数已应用');
      return true;
    } catch (error) {
      this.ui.refreshBattleFlowFields();
      this.ui.showToast(`战役流程参数无效：${error?.message || error}`, 'error');
      return false;
    }
  }

  /**
   * 渲染（委托给 canvas 模块）
   */
  render() {
    this.canvas.render();
  }

  /**
   * 绑定事件
   * @private
   */
  _bindEvents() {
    const container = document.getElementById('editor-canvas-container');

    // 工具按钮
    document.getElementById('editor-undo').addEventListener('click', () => this.history.undo());
    document.getElementById('editor-redo').addEventListener('click', () => this.history.redo());
    document.getElementById('editor-select').addEventListener('click', () => this.ui.setMode('select'));
    document.getElementById('editor-pan').addEventListener('click', () => this.ui.setMode('pan'));
    document.getElementById('editor-place').addEventListener('click', () => this.ui.setMode('place'));

    // 场景设置
    const sceneNameInput = document.getElementById('editor-scene-name');
    const commitSceneMetaChange = async (meta, label) => {
      if (!this.onSceneMetaChange) return null;
      const saveButton = document.getElementById('editor-save');
      const wasDisabled = saveButton?.disabled === true;
      if (saveButton) saveButton.disabled = true;
      try {
        return await this.onSceneMetaChange(meta);
      } catch (error) {
        this.ui?.showToast?.(`${label}失败：${error?.message || String(error)}`, 'error');
        return { ok: false, committed: false, status: 'failed', error };
      } finally {
        if (saveButton) saveButton.disabled = wasDisabled;
      }
    };
    sceneNameInput.addEventListener('input', (e) => {
      this.sceneData.name = e.target.value;
    });
    // 持久化元数据只在编辑完成（change/blur）时触发；提交期间禁用保存，避免正文保存与名称事务并发。
    sceneNameInput.addEventListener('change', async (e) => {
      await commitSceneMetaChange({ name: e.target.value }, '名称保存');
    });
    const sceneIdInput = document.getElementById('editor-scene-id');
    if (sceneIdInput) {
      sceneIdInput.addEventListener('change', async (e) => {
        const newId = e.target.value.trim();
        if (!newId) return;
        const oldId = this.sceneData.id;
        this.sceneData.id = newId;
        await commitSceneMetaChange({ id: newId, oldId }, '重命名');
      });
    }
    const battleIdInput = document.getElementById('editor-battle-id');
    const battleFlowFields = document.getElementById('editor-battle-flow-fields');
    battleIdInput?.addEventListener('input', () => {
      const hasEditableFlow = battleIdInput.value.trim() || this.sceneData.gameplay?.battleId;
      if (battleFlowFields) battleFlowFields.style.display = hasEditableFlow ? '' : 'none';
    });
    document.getElementById('editor-apply-battle-flow')?.addEventListener('click', () => {
      this._applyBattleFlowFields();
    });
    document.getElementById('editor-bg-color').addEventListener('input', (e) => {
      this.sceneData.backgroundColor = e.target.value;
      this.render();
    });
    document.getElementById('editor-show-grid').addEventListener('change', (e) => {
      this.options.showGrid = e.target.checked;
      this.render();
    });
    document.getElementById('editor-show-background').addEventListener('change', (e) => {
      this.options.showBackground = e.target.checked;
      this.render();
    });
    document.getElementById('editor-scene-width').addEventListener('change', (e) => {
      this.sceneData.width = parseInt(e.target.value) || 1280;
      this.ui._initCanvas();
    });
    document.getElementById('editor-scene-height').addEventListener('change', (e) => {
      this.sceneData.height = parseInt(e.target.value) || 720;
      this.ui._initCanvas();
    });

    // 保存和导入导出
    document.getElementById('editor-save').addEventListener('click', () => this.history.save());
    const clearCacheBtn = document.getElementById('editor-clear-cache');
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', () => { if (this.onClearCache) this.onClearCache(); });
    // 全选/复制/粘贴按钮
    const selAllBtn = document.getElementById('editor-select-all');
    if (selAllBtn) selAllBtn.addEventListener('click', () => this.interactionModule._selectAll());
    const copyBtn = document.getElementById('editor-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => this.interactionModule._copySelection());
    const pasteBtn = document.getElementById('editor-paste');
    if (pasteBtn) pasteBtn.addEventListener('click', () => this.interactionModule._pasteSelection());
    document.getElementById('editor-export').addEventListener('click', () => this.history.exportJSON());
    document.getElementById('editor-import').addEventListener('click', () => {
      document.getElementById('editor-json-input').click();
    });
    document.getElementById('editor-json-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.history.importJSON(file);
    });

    // 图片资源
    document.getElementById('editor-add-image').addEventListener('click', () => {
      document.getElementById('editor-image-input').click();
    });
    document.getElementById('editor-image-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.assets.addImageAsset(file);
    });
    document.getElementById('editor-audit-assets')?.addEventListener('click', () => {
      this.assets.runAssetAudit();
    });
    document.getElementById('editor-save-scene-btn').addEventListener('click', () => {
      this.assets.saveImages();
    });

    // 图层
    document.getElementById('editor-add-layer').addEventListener('click', () => this.layers.addLayer());
    document.getElementById('editor-delete-layer').addEventListener('click', () => this.layers.deleteLayer());
    document.getElementById('editor-layer-up').addEventListener('click', () => this.layers.moveLayerUp());
    document.getElementById('editor-layer-down').addEventListener('click', () => this.layers.moveLayerDown());
    document.getElementById('editor-move-obj-layer').addEventListener('click', () => this.layers.moveSelectedObjectToActiveLayer());
    document.getElementById('editor-batch-depth').addEventListener('click', () => this.layers.batchSetDepth());
    document.getElementById('editor-dedup-objects').addEventListener('click', () => this.layers.deduplicateObjects());
    document.getElementById('editor-batch-offset').addEventListener('click', () => this.layers.batchOffset());

    // 缩放
    document.getElementById('editor-zoom-in').addEventListener('click', () => this.ui.zoom(1.2));
    document.getElementById('editor-zoom-out').addEventListener('click', () => this.ui.zoom(0.8));
    document.getElementById('editor-zoom-fit').addEventListener('click', () => {
      this.ui.fitToContainer();
      this.render();
    });
    document.getElementById('editor-toggle-neighbors').addEventListener('click', () => {
      this.showNeighbors = !this.showNeighbors;
      const btn = document.getElementById('editor-toggle-neighbors');
      btn.style.background = this.showNeighbors ? '#4CAF50' : '';
      this.render();
    });

    // Canvas 交互
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.ui.zoom(delta, e.offsetX, e.offsetY);
    });
    container.addEventListener('mousedown', (e) => this.interactionModule.handleMouseDown(e));
    container.addEventListener('mousemove', (e) => this.interactionModule.handleMouseMove(e));
    container.addEventListener('mouseup', (e) => this.interactionModule.handleMouseUp(e));
    container.addEventListener('contextmenu', (e) => this.interactionModule.handleContextMenu(e));

    // 键盘快捷键
    document.addEventListener('keydown', (e) => this.interactionModule.handleKeyDown(e));
    document.addEventListener('keyup', (e) => this.interactionModule.handleKeyUp(e));

    // 资源拖放
    this.assets.setupAssetDragDrop();
  }

  /** 应用当前游戏的表现规格；只改变编辑器 fallback，不重写已存在场景尺寸。 */
  setPresentationProfile(profile = {}) {
    this.presentationProfile = normalizePresentationProfile(profile);
    this.options.width = this.presentationProfile.logicalResolution.width;
    this.options.height = this.presentationProfile.logicalResolution.height;
    this.options.gridSize = this.presentationProfile.world.gridSize;
    return this.presentationProfile;
  }

  /**
   * 加载场景数据
   */
  loadScene(sceneData) {
    // 宿主可复用同一编辑器实例切换游戏；场景加载是项目激活代际的明确边界。
    this.activateSharedAtlasProject();

    const defaults = _editorDefaults || {};
    const sceneCfg = defaults.scene || {};
    const defaultLayers = (sceneCfg.layers || [
      { id: 'layer_bg', name: '背景层', visible: true, locked: false },
      { id: 'layer_fill', name: '背景填充层', visible: true, locked: false },
      { id: 'layer_deco', name: '装饰层', visible: true, locked: false },
      { id: 'layer_entity', name: '实体层', visible: true, locked: false }
    ]).map(l => ({ ...l, objects: [] }));

    const base = {
      id: null,
      name: sceneCfg.defaultName || '新场景',
      width: this.options.width,
      height: this.options.height,
      backgroundColor: sceneCfg.backgroundColor || '#2a3a1a',
      layers: defaultLayers,
      decorations: [],
      colliders: []
    };

    const incoming = sceneData ? structuredClone(sceneData) : null;
    // Canonical load/import is lossless: defaults and migrations are only for a brand-new blank draft.
    this.sceneData = incoming ?? base;

    if (!incoming) {
      this.sceneData.layers = this.layers.normalizeLayers(this.sceneData.layers);
    }

    // 清空缓存
    this.loadedImages = new Map();
    this.selectedObjects = [];
    this.selectedSlice = null;
    this.selectedAtlasId = null;
    this.activeLayerIndex = 0;
    this.history.reset();
    // 场景切换恢复“全部显示 + 不包含关联对象”，筛选状态不进入场景数据或历史。
    this.eventFilter.reset(this.sceneData);

    // 更新 UI
    const nameInput = document.getElementById('editor-scene-name');
    const idInput = document.getElementById('editor-scene-id');
    const bgInput = document.getElementById('editor-bg-color');
    const widthInput = document.getElementById('editor-scene-width');
    const heightInput = document.getElementById('editor-scene-height');

    if (nameInput) nameInput.value = this.sceneData.name;
    if (idInput) idInput.value = this.sceneData.id || '';
    if (bgInput) bgInput.value = this.sceneData.backgroundColor;
    if (widthInput) widthInput.value = this.sceneData.width;
    if (heightInput) heightInput.value = this.sceneData.height;
    this.ui.refreshBattleFlowFields();

    // 更新画布尺寸
    const canvas = document.getElementById('editor-canvas');
    const overlay = document.getElementById('editor-overlay');
    const containerEl = document.getElementById('editor-canvas-container');

    if (canvas && overlay && containerEl) {
      const cw = containerEl.clientWidth || 800;
      const ch = containerEl.clientHeight || 600;
      canvas.width = cw;
      canvas.height = ch;
      overlay.width = cw;
      overlay.height = ch;
    }

    // 共享图集通过 registry 投影；可编辑草稿优先，但完整定义始终不注入场景正文。
    // 全局图片仍只用于新建空白草稿的既有兼容流程。
    if (!incoming) {
      this._mergeGlobalImages();
    }

    // 加载图集、场景图片与内容库 ref 的 Manifest 稳定图片。
    this.assets.loadAtlasImages();
    this.assets.loadImageAssets();
    void this.assets.loadPlacementVisualImages();

    this.ui.fitToContainer();
    this.layers.updateLayerList();
    this.ui.updateObjectCount();
    this.assets.updateAssetLibrary();
    this.render();
  }

  /**
   * 激活当前共享图集项目，并把单一兼容指针投影到对应的按项目草稿。
   * 每次真实项目切换都会递增 epoch，供异步编辑拒绝 A→B→A 的迟到回调。
   */
  activateSharedAtlasProject(projectPath = this.options.getProjectPath?.() || this.projectPath || '') {
    const { projectPath: normalizedProjectPath } = activateGlobalAtlasesProject(projectPath);
    if (this.sharedAtlasActiveProjectPath !== normalizedProjectPath) {
      const previousDraft = this.sharedAtlasDraft;
      if (previousDraft?.projectPath) {
        this.sharedAtlasDrafts.set(previousDraft.projectPath, previousDraft);
      }
      this.sharedAtlasActiveProjectPath = normalizedProjectPath;
      this.sharedAtlasProjectEpoch += 1;
      this.sharedAtlasDraft = this.sharedAtlasDrafts.get(normalizedProjectPath) || null;
      // 图片缓存没有项目命名空间；真实项目切换时必须失效，禁止复用同 ID 的旧项目图片。
      this.loadedImages?.clear();
      this.selectedAtlasId = null;
      this.selectedSlice = null;
    } else {
      this.sharedAtlasDraft = this.sharedAtlasDrafts.get(normalizedProjectPath) || null;
    }
    return {
      projectPath: normalizedProjectPath,
      epoch: this.sharedAtlasProjectEpoch,
      draft: this.sharedAtlasDraft
    };
  }

  setSharedAtlasDraft(draft) {
    if (!draft || typeof draft !== 'object') throw new TypeError('共享图集草稿无效');
    const projectPath = normalizeAtlasProjectPath(draft.projectPath)
      || this.sharedAtlasActiveProjectPath
      || activateGlobalAtlasesProject('').projectPath;
    draft.projectPath = projectPath;
    this.sharedAtlasDrafts.set(projectPath, draft);
    if (this.sharedAtlasActiveProjectPath === projectPath) this.sharedAtlasDraft = draft;
    return draft;
  }

  getSharedAtlasDraft(projectPath = this.options.getProjectPath?.() || this.projectPath || '') {
    const normalizedProjectPath = normalizeAtlasProjectPath(projectPath)
      || this.sharedAtlasActiveProjectPath
      || activateGlobalAtlasesProject('').projectPath;
    const currentProjectPath = normalizeAtlasProjectPath(
      this.options.getProjectPath?.() || this.projectPath || ''
    ) || this.sharedAtlasActiveProjectPath;
    if (normalizedProjectPath === currentProjectPath) {
      return this.activateSharedAtlasProject(normalizedProjectPath).draft;
    }
    return this.sharedAtlasDrafts.get(normalizedProjectPath) || null;
  }

  clearSharedAtlasDraft(projectPath, expectedDraft) {
    const normalizedProjectPath = normalizeAtlasProjectPath(projectPath)
      || this.sharedAtlasActiveProjectPath
      || activateGlobalAtlasesProject('').projectPath;
    const currentDraft = this.sharedAtlasDrafts.get(normalizedProjectPath);
    if (expectedDraft && currentDraft !== expectedDraft) return false;
    if (!currentDraft) return false;
    this.sharedAtlasDrafts.delete(normalizedProjectPath);
    if (this.sharedAtlasDraft === currentDraft) this.sharedAtlasDraft = null;
    return true;
  }

  setCommittedSharedAtlasCatalog(projectPath, catalog) {
    if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.atlases)) {
      throw new TypeError('共享图集 catalog 无效');
    }
    const normalizedProjectPath = normalizeAtlasProjectPath(projectPath)
      || this.sharedAtlasActiveProjectPath
      || activateGlobalAtlasesProject('').projectPath;
    const snapshot = structuredClone(catalog);
    this.sharedAtlasCommittedCatalogs.set(normalizedProjectPath, snapshot);
    return snapshot;
  }

  /**
   * 创建当前场景的图集投影：共享编辑草稿优先，场景局部定义仅作 legacy fallback。
   * 草稿与 SceneDataLoader 权威缓存相互隔离，完整 atlas 定义不会进入 sceneData。
   */
  getAtlasRegistry() {
    const { projectPath, draft } = this.activateSharedAtlasProject();
    const committedCatalog = this.getCommittedSharedAtlasCatalog(projectPath);
    const sharedAtlases = Array.isArray(draft?.config?.atlases)
      ? draft.config.atlases
      : (Array.isArray(committedCatalog?.atlases) ? committedCatalog.atlases : []);
    const removedSharedIds = new Set();
    if (draft) {
      const nextIds = new Set(sharedAtlases.map(atlas => atlas?.id).filter(Boolean));
      for (const atlas of draft.baseConfig?.atlases || []) {
        if (atlas?.id && !nextIds.has(atlas.id)) removedSharedIds.add(atlas.id);
      }
    }
    const localAtlases = (Array.isArray(this.sceneData?.atlases) ? this.sceneData.atlases : [])
      .filter(atlas => !removedSharedIds.has(atlas?.id));
    return new AtlasRegistry(sharedAtlases, localAtlases);
  }

  getAvailableAtlases() {
    return this.getAtlasRegistry().getAll();
  }

  getAtlasDefinition(atlasId) {
    return this.getAtlasRegistry().getAtlas(atlasId);
  }

  getAtlasSlice(atlasId, sliceKey) {
    return this.getAtlasRegistry().getSlice(atlasId, sliceKey);
  }

  isSharedAtlas(atlasId) {
    return this.getAtlasRegistry().isShared(atlasId);
  }

  getAtlasImage(atlasId) {
    const { draft } = this.activateSharedAtlasProject();
    return draft?.previewImages?.get(atlasId)
      || this.loadedImages.get(atlasId)
      || null;
  }

  getAtlasImageUrl(atlasId) {
    const { projectPath } = this.activateSharedAtlasProject();
    const atlas = this.getAtlasDefinition(atlasId);
    if (!atlas) return '';
    return this.isSharedAtlas(atlasId)
      ? getGlobalAtlasImageUrl(atlas, '', projectPath)
      : String(atlas.path || '');
  }

  getCommittedSharedAtlasCatalog(projectPath = this.options.getProjectPath?.() || this.projectPath || '') {
    const normalizedProjectPath = normalizeAtlasProjectPath(projectPath)
      || this.sharedAtlasActiveProjectPath
      || activateGlobalAtlasesProject('').projectPath;
    const cached = this.sharedAtlasCommittedCatalogs.get(normalizedProjectPath);
    if (cached) return cached;

    const configured = this.options.getSharedAtlasCatalog?.(normalizedProjectPath);
    const source = configured && typeof configured.then !== 'function'
      ? configured
      : getGlobalAtlasesConfig(normalizedProjectPath);
    if (source && typeof source === 'object' && Array.isArray(source.atlases)) {
      return this.setCommittedSharedAtlasCatalog(normalizedProjectPath, source);
    }
    return null;
  }

  /**
   * 合并全局图片资源到当前场景。
   * 以全局配置 config/images.json 为准覆盖，保证保存后刷新能拿到最新图片路径。
   * @private
   */
  _mergeGlobalImages() {
    const globalImages = getGlobalImages();
    if (!globalImages || Object.keys(globalImages).length === 0) return;
    if (!this.sceneData.imageAssets) this.sceneData.imageAssets = {};
    for (const [id, data] of Object.entries(globalImages)) {
      // 全局配置为准覆盖
      this.sceneData.imageAssets[id] = JSON.parse(JSON.stringify(data));
    }
  }

  /**
   * 把旧对象类型迁移为统一 shape：
   *   rect   → shape(rect)
   *   circle → shape(circle)（x,y 中心 → 包围盒）
   *   fill   → shape(rect)（fillColor 归一到 fill）
   *   ellipse→ shape(ellipse)
   * 已是 shape 的保持不变。
   * @private
   */
  _migrateShapes() {
    for (const layer of this.sceneData.layers) {
      if (!Array.isArray(layer.objects)) continue;
      for (const obj of layer.objects) {
        if (!obj || obj.type === 'shape') continue;
        if (obj.type === 'rect') {
          obj.type = 'shape'; obj.shapeType = 'rect';
        } else if (obj.type === 'ellipse') {
          obj.type = 'shape'; obj.shapeType = 'ellipse';
        } else if (obj.type === 'fill') {
          obj.type = 'shape'; obj.shapeType = 'rect';
          if (obj.fillColor && !obj.fill) obj.fill = obj.fillColor;
          // fill 默认铺满场景
          if (obj.width === undefined) obj.width = this.sceneData.width;
          if (obj.height === undefined) obj.height = this.sceneData.height;
        } else if (obj.type === 'circle') {
          obj.type = 'shape'; obj.shapeType = 'circle';
          const r = obj.radius || 32;
          obj.x = (obj.x || 0) - r; obj.y = (obj.y || 0) - r;
          obj.width = r * 2; obj.height = r * 2;
        }
      }
    }
  }

  /**
   * 保存场景（兼容旧 API）
   */
  save() {
    return this.history.save();
  }

  /**
   * 导出 JSON（兼容旧 API）
   */
  exportJSON() {
    return this.history.exportJSON();
  }

  /**
   * 导入 JSON（兼容旧 API）
   */
  importJSON(source) {
    return this.history.importJSON(source);
  }

  /**
   * 获取场景数据（兼容旧 API）
   */
  getSceneData() {
    return this.sceneData;
  }

  /**
   * 更新资源库（兼容旧 API）
   */
  updateAssetLibrary() {
    this.assets.updateAssetLibrary();
  }
}

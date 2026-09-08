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
  SCENE_BATTLE_FLOW_STRING_FIELDS
} from '../src/core/scene/SceneBattleFlowRegistry.js';
import {
  SCENE_OBJECT_SELECTOR_MODES,
  sceneObjectSelectorValues
} from '../src/core/scene/SceneObjectSelector.js';
import { isSpatialTriggerEvent } from '../src/systems/TriggerCatalog.js';

const BATTLE_FLOW_FIELD_LABELS = Object.freeze({
  locationName: '地点名称',
  unavailableMessage: '不可用提示',
  conflictMessage: '冲突提示',
  activeMessage: '进行中提示',
  appliedTitle: '已结算标题',
  resultTitle: '战果标题',
  resultMessage: '战果说明',
  settlementMessage: '结算提示',
  interventionMessage: '介入提示',
  resolvedKey: '完成状态键',
  winnerKey: '胜方状态键',
  checkpointId: '检查点 ID'
});

const STABLE_CONTENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * SceneEditorUI - 场景编辑器 UI 模块
 * 负责 UI 面板初始化、属性面板更新、基础工具操作
 */
export class SceneEditorUI {
  /**
   * @param {import('./SceneEditor.js').SceneEditor} editor - 主编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this._canvasResizeObserver = null;
    this._canvasResizeFrame = 0;
    this._canvasContainer = null;
    this._canvasSize = { width: 0, height: 0 };
    this._contentDefinitionModalGeneration = 0;
  }

  /**
   * 初始化 UI（生成 HTML 结构）
   */
  initUI() {
    const editor = this.editor;
    const battleFlowFieldsHtml = SCENE_BATTLE_FLOW_STRING_FIELDS.map(field => `
      <div class="info-row" style="align-items:flex-start;">
        <label title="gameplay.battleFlow.${field}">${BATTLE_FLOW_FIELD_LABELS[field]}:</label>
        <textarea data-battle-flow-field="${field}" rows="2" style="flex:1;min-width:0;resize:vertical;"></textarea>
      </div>
    `).join('');
    editor.container.innerHTML = `
      <div class="scene-editor">
        <div class="editor-toolbar">
          <div class="toolbar-group">
            <button id="editor-save" class="primary" title="保存场景到工程（localStorage + assets/scenes JSON 文件）">💾 保存到工程</button>
            <button id="editor-clear-cache" title="清理本地 localStorage 缓存（下次从工程 JSON 文件重新加载）">🧹 清理缓存</button>
            <button id="editor-select-all" title="全选当前图层所有对象">☐ 全选</button>
            <button id="editor-copy" title="复制选中对象">📋 复制</button>
            <button id="editor-paste" title="粘贴已复制的对象">📌 粘贴</button>
          </div>
          <div class="toolbar-group">
            <button id="editor-undo" title="撤销 (Ctrl+Z)">↶</button>
            <button id="editor-redo" title="重做 (Ctrl+Y)">↷</button>
          </div>
          <div class="toolbar-group">
            <button id="editor-select" class="active" title="选择工具 (V)">↖</button>
            <button id="editor-pan" title="平移工具 (H)">🖐️</button>
            <button id="editor-place" title="放置工具 (P)">+</button>
          </div>
          <div class="toolbar-group">
            <label>场景名称:</label>
            <input type="text" id="editor-scene-name" value="${editor.sceneData.name}">
          </div>
          <div class="toolbar-group">
            <label>背景色:</label>
            <input type="color" id="editor-bg-color" value="${editor.sceneData.backgroundColor}">
          </div>
          <div class="toolbar-group">
            <label>网格:</label>
            <input type="checkbox" id="editor-show-grid" ${editor.options.showGrid ? 'checked' : ''}>
          </div>
          <div class="toolbar-group">
            <label>辅助方框:</label>
            <input type="checkbox" id="editor-show-background" ${editor.options.showBackground ? 'checked' : ''}>
          </div>
          <div class="toolbar-group">
            <button id="editor-export">导出JSON</button>
            <button id="editor-import">导入JSON</button>
          </div>
        </div>
        
        <div class="editor-main">
          <div class="editor-sidebar left" id="editor-sidebar-left">
            <div class="sidebar-section">
              <h3>资源库</h3>
              <div class="asset-library">
                <div class="asset-tabs">
                  <button class="asset-tab active" data-tab="shapes">图形</button>
                  <button class="asset-tab" data-tab="atlases">图集</button>
                  <button class="asset-tab" data-tab="logic">逻辑</button>
                  <button class="asset-tab" data-tab="content">内容</button>
                </div>
                <div class="asset-actions" id="editor-image-actions" style="display:none;">
                  <button id="editor-add-image">添加图片</button>
                  <button id="editor-audit-assets" title="核对 Manifest、磁盘文件、场景引用、授权与 3D fallback">🔎 资产审计</button>
                  <button id="editor-save-scene-btn">💾 保存</button>
                </div>
                <div id="asset-shapes" class="asset-panel">
                  <div class="asset-list" id="editor-asset-list"></div>
                </div>
                <div id="asset-atlases" class="asset-panel" style="display:none;">
                  <div class="asset-actions" style="margin-bottom:6px;">
                    <button id="editor-atlas-add" title="新增一个图集">+ 新增图集</button>
                    <button id="editor-atlas-delete" title="删除选中的图集">🗑 删除</button>
                    <button id="editor-atlas-save" title="保存所有图集到 config/atlases.json">💾 保存图集</button>
                  </div>
                  <div class="atlas-list" id="editor-atlas-list"></div>
                </div>
                <div id="asset-logic" class="asset-panel" style="display:none;">
                  <div class="asset-list" id="editor-logic-list"></div>
                </div>
                <div id="asset-content" class="asset-panel" style="display:none;">
                  <div class="content-filter" style="margin-bottom:6px;">
                    <select id="editor-content-filter" style="width:100%;padding:4px;background:#0a1020;color:#fff;border:1px solid #2a3a5e;border-radius:3px;font-size:11px;"></select>
                  </div>
                  <div class="asset-actions" style="margin-bottom:6px;">
                    <button id="editor-content-add" title="在内容库(定义)中新增一条">+ 新增定义</button>
                    <button id="editor-content-save" title="保存内容库定义到工程">💾 保存库</button>
                  </div>
                  <div class="asset-list" id="editor-content-list"></div>
                </div>
              </div>
            </div>
            <div class="sidebar-section">
              <h3 id="slice-panel-title">选中切片</h3>
              <div id="slice-properties">
                <div class="no-selection">未选中切片</div>
              </div>
            </div>
          </div>
          
          <div class="editor-resizer" id="editor-resizer-left"></div>
          
          <div class="editor-canvas-area">
            <div id="editor-scene-event-filter" class="scene-event-filter-bar" aria-label="当前场景事件视图筛选"></div>
            <div class="canvas-container" id="editor-canvas-container">
              <canvas id="editor-canvas"></canvas>
              <canvas id="editor-overlay"></canvas>
            </div>
            <div class="zoom-controls">
              <button id="editor-zoom-out">-</button>
              <span id="editor-zoom-level">100%</span>
              <button id="editor-zoom-in">+</button>
              <button id="editor-zoom-fit">适应</button>
              <button id="editor-toggle-neighbors" title="显示/隐藏相邻场景参考">🗺️</button>
            </div>
          </div>
          
          <div class="editor-resizer" id="editor-resizer-right"></div>
          
          <div class="editor-sidebar right" id="editor-sidebar-right">
            <div class="sidebar-section">
              <h3>图层</h3>
              <div class="layer-list" id="editor-layer-list"></div>
              <div class="layer-actions">
                <button id="editor-add-layer" title="新增图层">+ 新增</button>
                <button id="editor-delete-layer" title="删除选中图层">🗑 删除</button>
                <button id="editor-layer-up" title="图层上移（提高遮挡优先级）">⬆</button>
                <button id="editor-layer-down" title="图层下移（降低遮挡优先级）">⬇</button>
              </div>
              <div class="layer-actions" style="margin-top:4px;">
                <button id="editor-move-obj-layer" title="将选中对象移动到当前激活图层">📦 移入当前层</button>
                <button id="editor-batch-depth" title="按名称筛选对象并批量设置深度">🔧 批量设深度</button>
                <button id="editor-dedup-objects" title="去掉同一位置的重复对象">🧹 去重</button>
                <button id="editor-batch-offset" title="批量偏移当前图层所有对象">↕ 批量偏移</button>
              </div>
            </div>
            
            <div class="sidebar-section">
              <h3>选中对象</h3>
              <div id="editor-object-properties">
                <div class="no-selection">未选中任何对象</div>
              </div>
            </div>
            
            <div class="sidebar-section">
              <h3>场景信息</h3>
              <div class="scene-info">
                <div class="info-row">
                  <label title="场景唯一标识。触发器里的 sceneId 要填这个值，不是场景名称">场景ID:</label>
                  <input type="text" id="editor-scene-id" value="${editor.sceneData.id || ''}" placeholder="如 scene_Prologue" style="flex:1;">
                </div>
                <div class="info-row">
                  <label>尺寸:</label>
                  <input type="number" id="editor-scene-width" value="${editor.sceneData.width}" min="100">
                  <span>×</span>
                  <input type="number" id="editor-scene-height" value="${editor.sceneData.height}" min="100">
                </div>
                <div class="info-row">
                  <label>对象数:</label>
                  <span id="editor-object-count">0</span>
                </div>
                <div class="info-row">
                  <label title="来自 game.project.json worldMap 的 canonical Region">Region:</label>
                  <input type="text" id="editor-world-region" value="未定位" readonly style="flex:1;min-width:0;" title="只读，不写入场景 JSON">
                </div>
                <div class="info-row">
                  <label title="全局 20×20 大地图中的 0-based (row,col)">坐标:</label>
                  <input type="text" id="editor-world-coordinate" value="未定位" readonly style="flex:1;min-width:0;" title="0-based (row,col)，只读">
                </div>
                <details id="editor-battle-flow-panel" style="margin-top:8px;">
                  <summary style="cursor:pointer;color:#e8c46a;">战役流程参数</summary>
                  <div style="margin-top:8px;">
                    <div class="info-row">
                      <label title="对应 game.project.json 已登记的 battleId">战役 ID:</label>
                      <input type="text" id="editor-battle-id" placeholder="如 battle.s03.yingchuan" style="flex:1;min-width:0;">
                    </div>
                    <div id="editor-battle-flow-fields" style="display:none;">
                      ${battleFlowFieldsHtml}
                      <div class="info-row" style="align-items:flex-start;">
                        <label title="仅用于战果展示摘要，不会作为任意 Blackboard patch">世界变化:</label>
                        <textarea id="editor-battle-world-changes" rows="4" style="flex:1;min-width:0;resize:vertical;" placeholder='{"month": 5}'></textarea>
                      </div>
                      <button id="editor-apply-battle-flow" type="button" style="width:100%;margin-top:4px;">应用战役流程参数</button>
                      <small style="display:block;margin-top:5px;color:#9aa7bd;">提示文案可保留 {interact} 等 InputHints token；保存时写入当前磁盘场景 JSON。</small>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
        
        <input type="file" id="editor-image-input" accept="image/*" style="display:none">
        <input type="file" id="editor-json-input" accept=".json" style="display:none">
      </div>
    `;

    this._addStyles();
    editor.layers.updateLayerList();
    this._initAssetTabs();
    this._initResizers();
    // 事件条会占用画布区域高度，必须先完成其 DOM 投影，再读取 Canvas 容器尺寸。
    editor.eventFilter?.bindUI();
    this._initCanvas();
    this.refreshWorldMapLocation();
    this.refreshBattleFlowFields();
  }

  /** 将 canonical 世界位置瞬态投影到只读场景信息字段。 */
  refreshWorldMapLocation() {
    const regionInput = document.getElementById('editor-world-region');
    const coordinateInput = document.getElementById('editor-world-coordinate');
    if (!regionInput || !coordinateInput) return;

    const location = this.editor.worldMapLocation;
    if (!location) {
      regionInput.value = '未定位';
      coordinateInput.value = '未定位';
      return;
    }

    regionInput.value = location.regionName && location.regionName !== location.regionId
      ? `${location.regionName} (${location.regionId})`
      : location.regionId;
    coordinateInput.value = `(${location.row},${location.col})`;
  }

  /** 将 canonical gameplay.battleId/battleFlow 投影到场景信息面板。 */
  refreshBattleFlowFields() {
    const gameplay = this.editor.sceneData?.gameplay || {};
    const flow = gameplay.battleFlow || {};
    const battleIdInput = document.getElementById('editor-battle-id');
    const fieldsContainer = document.getElementById('editor-battle-flow-fields');
    if (!battleIdInput || !fieldsContainer) return;

    battleIdInput.value = gameplay.battleId || '';
    fieldsContainer.style.display = gameplay.battleId ? '' : 'none';
    for (const input of fieldsContainer.querySelectorAll('[data-battle-flow-field]')) {
      input.value = flow[input.dataset.battleFlowField] || '';
    }
    const worldChangesInput = document.getElementById('editor-battle-world-changes');
    if (worldChangesInput) {
      worldChangesInput.value = JSON.stringify(flow.worldChanges || {}, null, 2);
    }
    const panel = document.getElementById('editor-battle-flow-panel');
    if (panel && gameplay.battleId) panel.open = true;
  }

  /**
   * 添加样式（引用外部 CSS）
   * @private
   */
  _addStyles() {
    if (document.getElementById('scene-editor-styles')) return;
    const link = document.createElement('link');
    link.id = 'scene-editor-styles';
    link.rel = 'stylesheet';
    link.href = './styles/scene-editor.css';
    document.head.appendChild(link);
  }

  /**
   * 初始化资源标签页
   * @private
   */
  _initAssetTabs() {
    const editor = this.editor;
    const tabs = editor.container.querySelectorAll('.asset-tab');
    const panels = {
      shapes: '#asset-shapes',
      atlases: '#asset-atlases',
      logic: '#asset-logic',
      content: '#asset-content'
    };
    // Tab 默认描述
    const tabDescriptions = {
      shapes: '用于基础的几何图形、背景图填充、碰撞多边形等。',
      atlases: '图片，以及图片的切片。用于构造装饰层，以及大部分地图上的视觉效果。',
      logic: '用于事件触发，以及刷怪、传送、Buff区域等等。',
      content: '物品、道具、玩家、NPC、商店、建筑、载具等等。'
    };
    const showTabDefault = (tabName) => {
      const title = document.getElementById('slice-panel-title');
      const propsPanel = document.getElementById('slice-properties');
      if (title) title.textContent = '说明';
      if (propsPanel) propsPanel.innerHTML = `<div class="no-selection" style="white-space:normal;">${tabDescriptions[tabName] || ''}</div>`;
      editor.selectedSlice = null;
      editor.selectedAtlasId = null;
    };
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        for (const [name, sel] of Object.entries(panels)) {
          const el = editor.container.querySelector(sel);
          if (el) el.style.display = (name === tabName) ? 'block' : 'none';
        }
        // 「添加图片」按钮仅在图形 Tab 显示
        const imgActions = editor.container.querySelector('#editor-image-actions');
        if (imgActions) imgActions.style.display = (tabName === 'shapes') ? 'flex' : 'none';
        // 切换 Tab 时重置下方面板为默认描述
        showTabDefault(tabName);
        // 内容 Tab 首次打开时加载内容库定义
        if (tabName === 'logic') editor.assets.updateLogicList?.();
        if (tabName === 'content') editor.assets.updateContentLibrary?.();
      });
    });
    // 初始显示默认描述（图形 Tab）
    showTabDefault('shapes');
    // 图形 Tab 默认激活，显示添加图片按钮
    const imgActionsInit = editor.container.querySelector('#editor-image-actions');
    if (imgActionsInit) imgActionsInit.style.display = 'flex';
    // 内容 Tab 的按钮
    const addBtn = editor.container.querySelector('#editor-content-add');
    if (addBtn) addBtn.addEventListener('click', () => editor.assets.addContentDefinition?.());
    const saveBtn = editor.container.querySelector('#editor-content-save');
    if (saveBtn) saveBtn.addEventListener('click', () => editor.assets.saveContentLibrary?.());
    const filter = editor.container.querySelector('#editor-content-filter');
    if (filter) filter.addEventListener('change', () => editor.assets.updateContentList?.());
    // 图集 Tab 的按钮
    const atlasAddBtn = editor.container.querySelector('#editor-atlas-add');
    if (atlasAddBtn) atlasAddBtn.addEventListener('click', () => editor.assets.addAtlas?.());
    const atlasDelBtn = editor.container.querySelector('#editor-atlas-delete');
    if (atlasDelBtn) atlasDelBtn.addEventListener('click', () => editor.assets.deleteAtlas?.());
    const atlasSaveBtn = editor.container.querySelector('#editor-atlas-save');
    if (atlasSaveBtn) atlasSaveBtn.addEventListener('click', () => editor.assets.saveAtlases?.());
  }

  /**
   * 初始化拖拽分隔条
   * @private
   */
  _initResizers() {
    const editor = this.editor;
    const leftSidebar = document.getElementById('editor-sidebar-left');
    const rightSidebar = document.getElementById('editor-sidebar-right');
    const resizerLeft = document.getElementById('editor-resizer-left');
    const resizerRight = document.getElementById('editor-resizer-right');

    if (!resizerLeft || !resizerRight) return;

    this._setupResizer(resizerLeft, leftSidebar, 'left');
    this._setupResizer(resizerRight, rightSidebar, 'right');
  }

  /**
   * 设置单个分隔条的拖拽逻辑
   * @private
   */
  _setupResizer(resizer, sidebar, side) {
    const editor = this.editor;
    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizer.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      const dx = e.clientX - startX;
      let newWidth;
      if (side === 'left') {
        newWidth = startWidth + dx;
      } else {
        newWidth = startWidth - dx;
      }
      // 限制最小/最大宽度
      newWidth = Math.max(120, Math.min(500, newWidth));
      sidebar.style.width = newWidth + 'px';
      sidebar.style.minWidth = newWidth + 'px';

      // 触发画布重绘以适应新尺寸
      if (editor.initialized) {
        this.fitToContainer();
        editor.render();
      }
    };

    const onMouseUp = () => {
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    resizer.addEventListener('mousedown', onMouseDown);
  }

  /**
   * 初始化画布
   * @private
   */
  _initCanvas() {
    const editor = this.editor;
    const canvas = document.getElementById('editor-canvas');
    const overlay = document.getElementById('editor-overlay');
    const container = document.getElementById('editor-canvas-container');

    if (!canvas || !overlay || !container) {
      throw new Error('SceneEditorUI: Canvas 容器尚未创建');
    }

    this._observeCanvasContainer(container);
    if (!this._syncCanvasViewport(container, { force: true })) return;

    editor.render();
    editor.initialized = true;
  }

  /**
   * 监听 Canvas 容器自身的最终布局尺寸。
   * 外部样式、事件筛选条和 flex 布局都可能在首页首帧后改变该元素尺寸，
   * 仅监听 window.resize 无法覆盖这些变化。
   * @private
   */
  _observeCanvasContainer(container) {
    if (this._canvasContainer === container && this._canvasResizeObserver) return;

    this._canvasResizeObserver?.disconnect();
    if (this._canvasResizeFrame) {
      cancelAnimationFrame(this._canvasResizeFrame);
      this._canvasResizeFrame = 0;
    }
    this._canvasContainer = container;

    if (typeof ResizeObserver !== 'function') return;
    this._canvasResizeObserver = new ResizeObserver(() => {
      if (this._canvasResizeFrame) return;
      this._canvasResizeFrame = requestAnimationFrame(() => {
        this._canvasResizeFrame = 0;
        if (!this._canvasContainer?.isConnected) return;
        if (!this._syncCanvasViewport(this._canvasContainer)) return;
        this.editor.initialized = true;
        this.editor.render();
      });
    });
    this._canvasResizeObserver.observe(container);
  }

  _getCanvasViewportSize(container) {
    const containerRect = container.getBoundingClientRect();
    const hostRect = this.editor.container.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const visibleRight = Math.min(containerRect.right, hostRect.right, viewportWidth);
    const visibleBottom = Math.min(containerRect.bottom, hostRect.bottom, viewportHeight);
    return {
      width: Math.round(Math.max(0, visibleRight - containerRect.left)),
      height: Math.round(Math.max(0, visibleBottom - containerRect.top))
    };
  }

  /**
   * 返回当前画布应完整容纳的世界矩形；邻居开启时使用中心场景与全部邻居的联合范围。
   * @private
   */
  _getViewportContentBounds() {
    const editor = this.editor;
    const readRect = (sceneData, offsetX, offsetY, label) => {
      const width = Number(sceneData?.width);
      const height = Number(sceneData?.height);
      const x = Number(offsetX);
      const y = Number(offsetY);
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error(`SceneEditorUI: ${label}尺寸必须是正数`);
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`SceneEditorUI: ${label}偏移必须是有限数值`);
      }
      return { left: x, top: y, right: x + width, bottom: y + height };
    };

    const center = readRect(editor.sceneData, 0, 0, '当前场景');
    let left = center.left;
    let top = center.top;
    let right = center.right;
    let bottom = center.bottom;
    if (editor.showNeighbors) {
      for (const neighbor of editor.neighborScenes || []) {
        const id = neighbor?.sceneData?.id || neighbor?.sceneData?.name || '未命名邻居场景';
        const rect = readRect(neighbor?.sceneData, neighbor?.offsetX, neighbor?.offsetY, `邻居场景 ${id} `);
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  /**
   * 将 Canvas backing 与工作台实际可见尺寸同步，并按当前显示内容的联合矩形重建视口。
   * @private
   */
  _syncCanvasViewport(container, { force = false } = {}) {
    const editor = this.editor;
    const canvas = document.getElementById('editor-canvas');
    const overlay = document.getElementById('editor-overlay');
    if (!canvas || !overlay || !container) return false;

    // flex 子项在外部样式首次应用前可能高于宿主并被 overflow 裁剪；
    // 居中必须以用户实际可见的工作台交集为准，不能把裁剪区计入中心。
    const { width, height } = this._getCanvasViewportSize(container);
    if (width <= 0 || height <= 0) return false;

    const sizeChanged = width !== this._canvasSize.width || height !== this._canvasSize.height;
    if (!force && !sizeChanged) return false;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (overlay.width !== width) overlay.width = width;
    if (overlay.height !== height) overlay.height = height;
    this._canvasSize = { width, height };

    const bounds = this._getViewportContentBounds();
    const scaleX = width / bounds.width;
    const scaleY = height / bounds.height;
    editor.viewport.scale = Math.min(scaleX, scaleY, 2) * 0.9;
    editor.viewport.offsetX = (width - bounds.width * editor.viewport.scale) / 2
      - bounds.left * editor.viewport.scale;
    editor.viewport.offsetY = (height - bounds.height * editor.viewport.scale) / 2
      - bounds.top * editor.viewport.scale;
    this._updateZoomDisplay();
    return true;
  }

  /**
   * 适应容器
   */
  fitToContainer() {
    const container = document.getElementById('editor-canvas-container');
    if (!container) throw new Error('SceneEditorUI: Canvas 容器尚未创建');
    return this._syncCanvasViewport(container, { force: true });
  }

  /**
   * 设置交互模式
   */
  setMode(mode) {
    const editor = this.editor;
    editor.interaction.mode = mode;
    document.querySelectorAll('.toolbar-group button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`editor-${mode}`).classList.add('active');
    document.getElementById('editor-canvas-container').style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
  }

  /**
   * 缩放视图
   */
  zoom(factor, pivotX, pivotY) {
    const editor = this.editor;
    const oldScale = editor.viewport.scale;
    editor.viewport.scale = Math.max(0.1, Math.min(5, editor.viewport.scale * factor));

    if (pivotX !== undefined && pivotY !== undefined) {
      const ratio = editor.viewport.scale / oldScale;
      editor.viewport.offsetX = pivotX - (pivotX - editor.viewport.offsetX) * ratio;
      editor.viewport.offsetY = pivotY - (pivotY - editor.viewport.offsetY) * ratio;
    }

    this._updateZoomDisplay();
    editor.render();
  }

  /**
   * 更新缩放显示
   * @private
   */
  _updateZoomDisplay() {
    const el = document.getElementById('editor-zoom-level');
    if (el) el.textContent = Math.round(this.editor.viewport.scale * 100) + '%';
  }

  /**
   * 添加对象到当前图层
   */
  addObject(objData) {
    const editor = this.editor;
    const layer = editor.sceneData.layers[editor.activeLayerIndex];
    if (!layer || layer.locked) return null;

    const obj = { id: 'obj_' + Date.now(), ...objData };
    layer.objects.push(obj);
    this.updateObjectCount();
    editor.eventFilter?.rebuild({ preserveSelection: true });
    editor.history.saveHistory();
    editor.render();
    return obj;
  }

  /**
   * 删除选中对象
   */
  deleteSelectedObjects() {
    const editor = this.editor;
    for (const obj of editor.selectedObjects) {
      if (obj.type === 'decoration' && obj._decoRef) {
        const index = editor.sceneData.decorations.indexOf(obj._decoRef);
        if (index !== -1) editor.sceneData.decorations.splice(index, 1);
      } else {
        for (const layer of editor.sceneData.layers) {
          const index = layer.objects.indexOf(obj);
          if (index !== -1) { layer.objects.splice(index, 1); break; }
        }
      }
    }

    editor.selectedObjects = [];
    editor.eventFilter?.rebuild({ preserveSelection: true });
    this.updateObjectProperties();
    this.updateObjectCount();
    editor.history.saveHistory();
    editor.render();
  }

  /**
   * 更新对象数量显示
   */
  updateObjectCount() {
    const editor = this.editor;
    let count = 0;
    for (const layer of editor.sceneData.layers) {
      count += layer.objects.length;
    }
    const el = document.getElementById('editor-object-count');
    if (el) el.textContent = count;
  }

  /**
   * 更新选中对象属性面板
   */
  updateObjectProperties() {
    const editor = this.editor;
    const panel = document.getElementById('editor-object-properties');
    if (!panel) return;

    if (editor.selectedObjects.length === 0) {
      panel.innerHTML = '<div class="no-selection">未选中任何对象</div>';
      return;
    }

    if (editor.selectedObjects.length > 1) {
      panel.innerHTML = `<div>已选中 ${editor.selectedObjects.length} 个对象</div>`;
      return;
    }

    const obj = editor.selectedObjects[0];
    let html = '';

    if (obj.type === 'decoration') {
      html = `<div class="property-row"><label>类型:</label><input value="装饰物" disabled></div>`;
      html += `<div class="property-row"><label>名称:</label><input value="${obj.key || '未知'}" disabled></div>`;
      html += `<div class="property-row"><label>X:</label><input type="number" value="${Math.round(obj.x)}" data-prop="x"></div>`;
      html += `<div class="property-row"><label>Y:</label><input type="number" value="${Math.round(obj.y)}" data-prop="y"></div>`;
      html += `<div class="property-row"><label>缩放:</label><input type="number" value="${obj.scale || 1}" step="0.1" data-prop="scale"></div>`;
    } else {
      let objLayerName = '未知';
      for (const layer of editor.sceneData.layers) {
        if (layer.objects.includes(obj)) { objLayerName = layer.name; break; }
      }
      html = `<div class="property-row"><label>ID:</label><input value="${obj.id || ''}" data-prop="id" style="font-size:11px;"></div>`;
      html += `<div class="property-row"><label>所在图层:</label><input value="${objLayerName}" disabled style="color:#FFD700;"></div>`;

      let depth = -1;
      for (const layer of editor.sceneData.layers) {
        const idx = layer.objects.indexOf(obj);
        if (idx !== -1) { depth = idx; break; }
      }
      html += `<div class="property-row"><label>深度:</label><input value="${depth}" disabled style="color:#88ccff;"></div>`;

      // 顶点型 shape（多边形/路径）无 X/Y/宽高，用顶点拖拽编辑
      const isVertexShape = obj.type === 'shape' && (obj.shapeType === 'polygon' || obj.shapeType === 'path');
      if (isVertexShape) {
        html += `<div class="property-row"><label>形状:</label><input value="${obj.shapeType}" disabled></div>`;
        html += `<div class="property-row"><label>顶点数:</label><input type="number" value="${(obj.points || []).length}" min="3" max="100" data-prop="_vertexCount" title="3~100，修改后按正多边形重新生成顶点"></div>`;
      } else {
        html += `<div class="property-row"><label>X:</label><input type="number" value="${Math.round(obj.x)}" data-prop="x"></div>`;
        html += `<div class="property-row"><label>Y:</label><input type="number" value="${Math.round(obj.y)}" data-prop="y"></div>`;
        if (obj.type === 'rect' || obj.type === 'image' || obj.type === 'slice' || obj.type === 'fill' || obj.type === 'deco' || obj.type === 'ellipse' || obj.type === 'shape' || obj.type === 'region') {
          html += `<div class="property-row"><label>宽度:</label><input type="number" value="${Math.round(obj.width)}" data-prop="width"></div>`;
          html += `<div class="property-row"><label>高度:</label><input type="number" value="${Math.round(obj.height)}" data-prop="height"></div>`;
        } else if (obj.type === 'circle') {
          html += `<div class="property-row"><label>半径:</label><input type="number" value="${Math.round(obj.radius)}" data-prop="radius"></div>`;
        }
      }

      if (obj.type === 'image' && obj.rotation !== undefined) {
        html += `<div class="property-row"><label>旋转:</label><input type="number" value="${Math.round(obj.rotation)}" data-prop="rotation"></div>`;
      }

      if (obj.type === 'image') {
        html += this._buildImageProperties(obj);
      } else if (obj.type === 'fill') {
        html += this._buildFillProperties(obj);
      } else if (obj.type === 'ellipse') {
        html += this._buildEllipseProperties(obj);
      } else if (obj.type === 'shape') {
        html += this._buildShapeProperties(obj);
      } else if (obj.type === 'region' || obj.type === 'spawn' || obj.type === 'portal' || obj.type === 'npc' || obj.type === 'trigger') {
        html += this._buildLogicProperties(obj);
      } else if (obj.type === 'buffZone') {
        html += this._buildBuffZoneProperties(obj);
      } else if (obj.type === 'effectZone') {
        html += this._buildEffectZoneProperties(obj);
      } else if (obj.type === 'ref') {
        html += this._buildRefProperties(obj);
      } else if (obj.fill) {
        html += `<div class="property-row"><label>颜色:</label><input type="color" value="${obj.fill}" data-prop="fill"></div>`;
      }
    }

    html += `<div class="property-row"><button id="editor-delete-obj">删除对象</button></div>`;
    panel.innerHTML = html;

    // 绑定属性修改事件
    panel.querySelectorAll('input[data-prop], select[data-prop], textarea[data-prop]').forEach(input => {
      input.addEventListener('change', (e) => {
        const prop = e.target.dataset.prop;
        let value;
        if (e.target.type === 'checkbox') value = e.target.checked;
        else if (e.target.type === 'number') value = parseFloat(e.target.value);
        else value = e.target.value;

        if (prop === 'activeWhen' && obj.type === 'trigger') {
          const text = String(value || '').trim();
          let nextValue;
          if (text) {
            try {
              nextValue = JSON.parse(text);
            } catch (error) {
              e.target.value = obj.activeWhen ? JSON.stringify(obj.activeWhen, null, 2) : '';
              this.showToast(`activeWhen JSON 格式错误：${error.message}`, 'error');
              return;
            }
            if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
              e.target.value = obj.activeWhen ? JSON.stringify(obj.activeWhen, null, 2) : '';
              this.showToast('activeWhen 必须是 JSON 对象，不能是数组或 null', 'error');
              return;
            }
          }
          editor.history?.saveHistory?.();
          if (text) obj.activeWhen = nextValue;
          else delete obj.activeWhen;
          e.target.value = text ? JSON.stringify(nextValue, null, 2) : '';
          editor.eventFilter?.rebuild({ preserveSelection: true, notify: true });
          editor.render();
          return;
        }

        // triggerId 是场景空间 binding 到项目行为定义的唯一连接。
        if (prop === 'triggerId' && obj.type === 'trigger') {
          this._commitTriggerId(obj, value);
          return;
        }

        // 碰撞/可落脚互斥：勾选一个自动取消另一个
        if (prop === 'collide' && value) {
          obj.collide = true;
          obj.walkable = false;
          this.updateObjectProperties();
          editor.render();
          return;
        } else if (prop === 'walkable' && value) {
          obj.walkable = true;
          obj.collide = false;
          this.updateObjectProperties();
          editor.render();
          return;
        } else if (prop === 'collide' && !value) {
          obj.collide = false;
          editor.render();
          return;
        } else if (prop === 'walkable' && !value) {
          obj.walkable = false;
          editor.render();
          return;
        }

        if (prop === 'gradientColor0' || prop === 'gradientColor1') {
          if (!obj.gradientStops) {
            obj.gradientStops = [{ offset: 0, color: '#000000' }, { offset: 1, color: '#333333' }];
          }
          obj.gradientStops[prop === 'gradientColor0' ? 0 : 1].color = value;
        } else if (prop === 'fillMode') {
          obj.fillMode = value;
          this.updateObjectProperties();
        } else if (prop === 'targetMode' && obj.type === 'trigger') {
          obj.targetMode = SCENE_OBJECT_SELECTOR_MODES.includes(value) ? value : 'id';
          // 保留原 target；切换模式后立即刷新候选并显式提示失配，禁止静默改绑。
          this.updateObjectProperties();
        } else if (prop === 'tags') {
          const tags = [...new Set(String(value || '').split(',').map(tag => tag.trim()).filter(Boolean))];
          if (tags.length) obj.tags = tags;
          else delete obj.tags;
        } else if (prop === '_vertexCount') {
          // 修改顶点数：加点=在随机边中点插入；减点=随机删除一个顶点（保持形状不变形）
          const n = Math.max(3, Math.min(100, Math.round(value)));
          if (!Array.isArray(obj.points) || obj.points.length < 3) return;
          const cur = obj.points.length;
          if (n === cur) { /* 不变 */ }
          else if (n > cur) {
            // 加点：每次在随机边的中点处插入新顶点
            while (obj.points.length < n) {
              const idx = Math.floor(Math.random() * obj.points.length);
              const next = (idx + 1) % obj.points.length;
              const mx = Math.round((obj.points[idx][0] + obj.points[next][0]) / 2);
              const my = Math.round((obj.points[idx][1] + obj.points[next][1]) / 2);
              obj.points.splice(next, 0, [mx, my]);
            }
          } else {
            // 减点：随机删除顶点直到目标数（最少保留3个）
            while (obj.points.length > n && obj.points.length > 3) {
              const idx = Math.floor(Math.random() * obj.points.length);
              obj.points.splice(idx, 1);
            }
          }
          // buffZone/effectZone：同步包围盒
          if (obj.type === 'buffZone' || obj.type === 'effectZone') {
            let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
            for (const p of obj.points) { if (p[0] < bMinX) bMinX = p[0]; if (p[0] > bMaxX) bMaxX = p[0]; if (p[1] < bMinY) bMinY = p[1]; if (p[1] > bMaxY) bMaxY = p[1]; }
            obj.x = bMinX; obj.y = bMinY; obj.width = bMaxX - bMinX; obj.height = bMaxY - bMinY;
          }
          this.updateObjectProperties();
        } else if (prop === 'id') {
          // ID 修改查重：遍历所有图层对象确保唯一
          const newId = (value || '').trim();
          if (!newId) {
            this.showToast('ID 不能为空', true);
            e.target.value = obj.id || '';
            return;
          }
          if (newId !== obj.id) {
            const layers = editor.sceneData.layers || [];
            let duplicate = false;
            for (const layer of layers) {
              for (const o of (layer.objects || [])) {
                if (o !== obj && o.id === newId) { duplicate = true; break; }
              }
              if (duplicate) break;
            }
            if (duplicate) {
              this.showToast(`ID "${newId}" 已存在，不允许重复`, true);
              e.target.value = obj.id || '';
              return;
            }
            obj.id = newId;
          }
        } else if (prop.startsWith('effect.')) {
          // Buff 多边形嵌套属性：effect.stat, effect.value, effect.interval, etc.
          if (!obj.effect) obj.effect = {};
          const subKey = prop.slice(7); // 去掉 'effect.'
          // 数值类型转换
          if (['value', 'interval', 'delay', 'leaveDuration'].includes(subKey)) {
            obj.effect[subKey] = parseFloat(value) || 0;
          } else {
            obj.effect[subKey] = value;
          }
        } else if (prop.startsWith('overrides.')) {
          // 放置点级覆盖（type:'ref'）：同一库定义在不同场景呈现不同交互
          // 运行时 spawnGroup 会做 { ...libraryDef, ...placement.overrides }
          // 留空表示不覆盖，需从 overrides 中删除，避免写入空字符串盖掉库定义
          const path = prop.slice(10).split('.'); // 去掉 'overrides.'
          if (!obj.overrides) obj.overrides = {};
          let holder = obj.overrides;
          for (let i = 0; i < path.length - 1; i++) {
            if (!holder[path[i]] || typeof holder[path[i]] !== 'object') holder[path[i]] = {};
            holder = holder[path[i]];
          }
          const leaf = path[path.length - 1];
          const isEmpty = value === '' || value === null || (typeof value === 'number' && isNaN(value));
          if (isEmpty) delete holder[leaf];
          else holder[leaf] = value;
          // 清理空对象，保持场景 JSON 干净
          this._pruneEmptyObjects(obj.overrides);
          if (Object.keys(obj.overrides).length === 0) delete obj.overrides;
        } else {
          // 直接编辑 Y 属于整体位移；显式排序基线跟随同一差值。
          // width/height 调整只改变外框，显式 sortY 保持用户指定的世界脚底线。
          if (prop === 'y' && Number.isFinite(obj.y) && Number.isFinite(obj.sortY) && Number.isFinite(value)) {
            obj.sortY += value - obj.y;
          }
          obj[prop] = value;
          // 触发 binding 的交互范围：运行时优先用 pointerRadius，修改时同步二者，确保实际生效。
          if (prop === 'radius' && obj.type === 'trigger') {
            obj.pointerRadius = value;
          }
        }

        if (obj.type === 'decoration' && obj._decoRef) {
          obj._decoRef[prop] = value;
        }

        if (obj.type === 'trigger' && ['id', 'name', 'triggerId', 'targetMode', 'target', 'enabled'].includes(prop)) {
          editor.eventFilter?.rebuild({ preserveSelection: true });
          // enabled=false 时保留右侧属性入口，避免隐藏后无法重新启用；画布投影仍立即移除。
          if (prop !== 'enabled') editor.eventFilter?.sanitizeInteractionState();
          editor.layers.updateLayerList();
        }
        editor.render();
      });
    });

    const triggerPicker = document.getElementById('editor-trigger-picker');
    if (triggerPicker && obj.type === 'trigger') {
      triggerPicker.addEventListener('change', () => {
        this._commitTriggerId(obj, triggerPicker.value);
      });
    }

    // 图片对象：切换稳定 imageId，或替换当前 ID 对应的文件。
    const imageSrcInput = document.getElementById('editor-image-src');
    const imageIdSelect = document.getElementById('editor-image-id');
    if (imageSrcInput && editor.selectedObjects.length === 1 && editor.selectedObjects[0].type === 'image') {
      const imgObj = editor.selectedObjects[0];
      if (imageIdSelect) {
        imageIdSelect.addEventListener('change', () => {
          const nextId = imageIdSelect.value;
          if (!nextId || nextId === imgObj.imageId) return;
          editor.history?.saveHistory?.();
          imgObj.imageId = nextId;
          editor.render();
          this.updateObjectProperties();
          this.showToast(`已切换图片资源：${nextId}`);
        });
      }
      // 初次显示时异步查询文件大小
      this._fetchImageFileSize(imageSrcInput.value);
      imageSrcInput.addEventListener('change', () => {
        const newSrc = imageSrcInput.value.trim();
        if (!editor.sceneData.imageAssets) editor.sceneData.imageAssets = {};
        if (!editor.sceneData.imageAssets[imgObj.imageId]) {
          editor.sceneData.imageAssets[imgObj.imageId] = { src: newSrc };
        } else {
          editor.sceneData.imageAssets[imgObj.imageId].src = newSrc;
        }
        // 重新加载图片刷新画布与尺寸显示
        const newImg = new Image();
        newImg.onload = () => {
          editor.loadedImages.set(imgObj.imageId, newImg);
          const dimEl = document.getElementById('editor-image-dim');
          if (dimEl) dimEl.value = `${newImg.naturalWidth}×${newImg.naturalHeight}`;
          editor.render();
        };
        newImg.onerror = () => this.showToast('图片加载失败: ' + newSrc, 'error');
        newImg.src = newSrc;
        this._fetchImageFileSize(newSrc);
      });

      // 编辑按钮：弹窗编辑图片属性
      const imgEditBtn = document.getElementById('editor-image-edit-btn');
      if (imgEditBtn) {
        imgEditBtn.addEventListener('click', () => this._openImageEditorModal(imgObj));
      }

      // 删除按钮：删除图片对象及其资源引用
      const imgDelBtn = document.getElementById('editor-image-delete-btn');
      if (imgDelBtn) {
        imgDelBtn.addEventListener('click', () => {
          if (!confirm('确定删除该图片对象吗？')) return;
          this.deleteSelectedObjects();
        });
      }
    }

    // 加载图片按钮
    const loadImgBtn = document.getElementById('editor-load-fill-image');
    if (loadImgBtn) {
      loadImgBtn.addEventListener('click', () => {
        const src = obj.imageSrc;
        if (!src) return;
        const img = new Image();
        img.onload = () => { editor.loadedImages.set(src, img); editor.render(); };
        img.onerror = () => this.showToast('图片加载失败: ' + src, 'error');
        img.src = src;
      });
    }

    // 椭圆：用选中切片填充
    const applySliceBtn = document.getElementById('editor-ellipse-apply-slice');
    if (applySliceBtn) {
      applySliceBtn.addEventListener('click', () => {
        if (!editor.selectedSlice) {
          this.showToast('请先在左侧资源库选中一个切片', 'error');
          return;
        }
        obj.atlasId = editor.selectedSlice.atlasId;
        obj.sliceKey = editor.selectedSlice.sliceKey;
        obj.decoKey = null;
        editor.render();
        this.updateObjectProperties();
        this.showToast('已应用切片: ' + obj.sliceKey);
      });
    }

    document.getElementById('editor-delete-obj').addEventListener('click', () => this.deleteSelectedObjects());

    // 🎯 拾取目标按钮（触发器关联）
    const pickBtn = document.getElementById('editor-pick-target');
    if (pickBtn && editor.selectedObjects.length === 1 && editor.selectedObjects[0].type === 'trigger') {
      pickBtn.addEventListener('click', () => {
        editor.interactionModule.startPickTarget(editor.selectedObjects[0]);
      });
    }
    const editTriggerBtn = document.getElementById('editor-edit-trigger');
    if (editTriggerBtn) editTriggerBtn.addEventListener('click', () => editor.options.openTriggerEditor?.(obj.triggerId));
    const previewTriggerBtn = document.getElementById('editor-preview-trigger');
    if (previewTriggerBtn) previewTriggerBtn.addEventListener('click', () => {
      editor.options.previewTrigger?.(obj, editor.getProjectTrigger?.(obj.triggerId));
    });
  }

  /**
   * 构建内容库放置引用（type:'ref'）的属性 HTML。
   * 明细在内容库定义里；这里只编辑放置相关：组名 group（供 spawnGroup 触发器整批激活）。
  /**
   * Buff 多边形属性面板
   * @private
   */
  _buildBuffZoneProperties(obj) {
    const eff = obj.effect || {};
    let html = '<div class="property-row" style="border-top:1px solid #333;margin-top:6px;padding-top:6px;"><label style="color:#c080ff;font-weight:bold;">Buff 多边形</label></div>';
    html += `<div class="property-row"><label>名称:</label><input type="text" value="${obj.name || ''}" data-prop="name"></div>`;
    html += `<div class="property-row"><label>顶点数:</label><input type="number" value="${(obj.points || []).length}" min="3" max="100" data-prop="_vertexCount" title="修改后重新生成正多边形"></div>`;
    html += `<div class="property-row"><label>填充色:</label><input type="text" value="${obj.fillColor || 'rgba(100,0,200,0.2)'}" data-prop="fillColor" style="font-size:10px;"></div>`;
    html += `<div class="property-row"><label>边框色:</label><input type="text" value="${obj.borderColor || 'rgba(100,0,200,0.5)'}" data-prop="borderColor" style="font-size:10px;"></div>`;
    html += `<div class="property-row"><label>游戏中可见:</label><input type="checkbox" ${obj.visible !== false ? 'checked' : ''} data-prop="visible"></div>`;
    html += '<div class="property-row" style="border-top:1px solid #444;margin-top:4px;padding-top:4px;"><label style="color:#a060d0;">效果设置</label></div>';
    html += `<div class="property-row"><label>效果类型:</label><select data-prop="effect.effectType">
      <option value="instant" ${eff.effectType === 'instant' ? 'selected' : ''}>即时</option>
      <option value="periodic" ${eff.effectType === 'periodic' ? 'selected' : ''}>周期</option>
      <option value="delayed" ${eff.effectType === 'delayed' ? 'selected' : ''}>延迟</option>
    </select></div>`;
    html += `<div class="property-row"><label>目标属性:</label><select data-prop="effect.stat">
      <option value="hp" ${eff.stat === 'hp' ? 'selected' : ''}>生命 hp</option>
      <option value="mp" ${eff.stat === 'mp' ? 'selected' : ''}>法力 mp</option>
      <option value="attack" ${eff.stat === 'attack' ? 'selected' : ''}>攻击</option>
      <option value="defense" ${eff.stat === 'defense' ? 'selected' : ''}>防御</option>
      <option value="speed" ${eff.stat === 'speed' ? 'selected' : ''}>速度</option>
    </select></div>`;
    html += `<div class="property-row"><label>数值:</label><input type="number" value="${eff.value || 0}" data-prop="effect.value"></div>`;
    html += `<div class="property-row"><label>周期(秒):</label><input type="number" value="${eff.interval || 2}" step="0.5" min="0.1" data-prop="effect.interval"></div>`;
    html += `<div class="property-row"><label>延迟(秒):</label><input type="number" value="${eff.delay || 10}" step="1" min="1" data-prop="effect.delay"></div>`;
    html += `<div class="property-row"><label>离开行为:</label><select data-prop="effect.onLeave">
      <option value="remove" ${eff.onLeave === 'remove' ? 'selected' : ''}>立即消失</option>
      <option value="countdown" ${eff.onLeave === 'countdown' ? 'selected' : ''}>倒计时消失</option>
      <option value="continue" ${eff.onLeave === 'continue' ? 'selected' : ''}>永久保留</option>
    </select></div>`;
    html += `<div class="property-row"><label>离开倒计时:</label><input type="number" value="${eff.leaveDuration || 5}" step="1" min="0" data-prop="effect.leaveDuration"> 秒</div>`;
    html += `<div class="property-row"><label>作用目标:</label><select data-prop="effect.target">
      <option value="player" ${eff.target === 'player' ? 'selected' : ''}>玩家</option>
      <option value="enemy" ${eff.target === 'enemy' ? 'selected' : ''}>敌人</option>
      <option value="all" ${eff.target === 'all' ? 'selected' : ''}>所有</option>
    </select></div>`;
    return html;
  }

  /**
   * 特效区域多边形属性面板
   * @private
   */
  _buildEffectZoneProperties(obj) {
    let html = '<div class="property-row" style="border-top:1px solid #333;margin-top:6px;padding-top:6px;"><label style="color:#ff9944;font-weight:bold;">特效区域</label></div>';
    html += `<div class="property-row"><label>名称:</label><input type="text" value="${obj.name || ''}" data-prop="name"></div>`;
    html += `<div class="property-row"><label>语义角色:</label><input type="text" value="${obj.semanticRole || ''}" data-prop="semanticRole" placeholder="如 battlefieldFire / poisonSmoke"></div>`;
    html += `<div class="property-row"><label>视觉说明:</label><textarea data-prop="visualDescription" rows="3" placeholder="说明特效在场景中代表什么">${obj.visualDescription || ''}</textarea></div>`;
    html += `<div class="property-row"><label>顶点数:</label><input type="number" value="${(obj.points || []).length}" min="3" max="100" data-prop="_vertexCount" title="修改后重新生成正多边形"></div>`;
    html += `<div class="property-row"><label>特效类型:</label><select data-prop="effectType">
      <option value="fire" ${obj.effectType === 'fire' ? 'selected' : ''}>🔥 火焰</option>
      <option value="water" ${obj.effectType === 'water' ? 'selected' : ''}>💧 流水</option>
      <option value="lake" ${obj.effectType === 'lake' ? 'selected' : ''}>🌊 湖面</option>
      <option value="ice" ${obj.effectType === 'ice' ? 'selected' : ''}>❄ 冰面</option>
      <option value="smoke" ${obj.effectType === 'smoke' ? 'selected' : ''}>💨 烟雾</option>
      <option value="sparkle" ${obj.effectType === 'sparkle' ? 'selected' : ''}>✨ 光粒</option>
    </select></div>`;
    html += '<div class="property-row" style="border-top:1px solid #444;margin-top:4px;padding-top:4px;"><label style="color:#ffbb66;">粒子参数</label></div>';
    html += `<div class="property-row"><label>生成速率:</label><input type="number" value="${obj.particleRate || 12}" min="1" max="200" data-prop="particleRate" title="每秒生成粒子数"></div>`;
    html += `<div class="property-row"><label>生命(秒):</label><input type="number" value="${obj.particleLife || 1.2}" step="0.1" min="0.1" max="10" data-prop="particleLife"></div>`;
    html += `<div class="property-row"><label>大小:</label><input type="number" value="${obj.particleSize || 6}" min="1" max="50" data-prop="particleSize"></div>`;
    html += `<div class="property-row"><label>速度:</label><input type="number" value="${obj.particleSpeed || 40}" min="0" max="500" data-prop="particleSpeed"></div>`;
    html += `<div class="property-row"><label>主色:</label><input type="color" value="${obj.particleColor || '#ff6622'}" data-prop="particleColor"></div>`;
    html += `<div class="property-row"><label>透明度:</label><input type="number" value="${obj.particleAlpha || 0.8}" step="0.05" min="0" max="1" data-prop="particleAlpha"></div>`;
    html += `<div class="property-row"><label title="与实体按脚底基线共同排序，而不是固定覆盖所有角色">世界深度:</label><input type="checkbox" ${obj.depthSort === true ? 'checked' : ''} data-prop="depthSort"></div>`;
    html += `<div class="property-row"><label title="特效区域的脚底排序 Y；默认使用区域底边">排序基线Y:</label><input type="number" value="${Number.isFinite(obj.sortY) ? obj.sortY : (obj.y || 0) + (obj.height || 0)}" data-prop="sortY"></div>`;
    html += '<div class="property-row" style="border-top:1px solid #444;margin-top:4px;padding-top:4px;"><label style="color:#ffbb66;">编辑器预览</label></div>';
    html += `<div class="property-row"><label>填充色:</label><input type="text" value="${obj.fillColor || 'rgba(255,120,30,0.15)'}" data-prop="fillColor" style="font-size:10px;"></div>`;
    html += `<div class="property-row"><label>边框色:</label><input type="text" value="${obj.borderColor || 'rgba(255,140,40,0.7)'}" data-prop="borderColor" style="font-size:10px;"></div>`;
    return html;
  }

  /**
   * 放置引用对象属性面板
   * @private
   */
  _buildRefProperties(obj) {
    const tags = Array.isArray(obj.tags) ? obj.tags.join(', ') : String(obj.tags || '');
    let html = '<div class="property-row" style="border-top:1px solid #333;margin-top:6px;padding-top:6px;"></div>';
    html += `<div class="property-row"><label>类型:</label><input value="${obj.kind || ''}" disabled></div>`;
    html += `<div class="property-row"><label>引用定义ID:</label><input value="${obj.ref || ''}" disabled title="明细在内容库中编辑"></div>`;
    if (obj.kind === 'item') {
      html += '<div class="property-row"><label>物品属性:</label><span style="color:#9ab;font-size:11px;">在左侧「物品」列表点击此定义，可编辑图片、尺寸和世界物件表现</span></div>';
    }
    html += `<div class="property-row"><label>名称:</label><input value="${obj.name || ''}" disabled></div>`;
    html += `<div class="property-row"><label title="触发器可按组名批量放置同组物品">组名:</label><input type="text" value="${obj.group || ''}" data-prop="group" placeholder="如 act1_pickups"></div>`;
    html += `<div class="property-row"><label title="多个标签用英文逗号分隔；触发器可按标签批量放置物品">标签:</label><input type="text" value="${tags}" data-prop="tags" placeholder="如 教程, 食物"></div>`;

    // 放置点级覆盖：同一库定义在不同场景可挂不同交互（如张角在第二幕给符水、第三幕给铜钱剑）
    // 留空 = 沿用内容库定义
    if (obj.kind === 'npc') {
      const ov = obj.overrides || {};
      const ovIt = ov.interaction || {};
      html += '<div class="property-row" style="border-top:1px solid #333;margin-top:6px;padding-top:6px;">' +
        '<label style="color:#7cf;font-weight:bold;" title="仅覆盖本放置点，不改内容库定义。留空则沿用库定义">本处覆盖</label></div>';
      html += `<div class="property-row"><label>对话ID:</label><input type="text" value="${ov.dialogueId || ''}" data-prop="overrides.dialogueId" placeholder="留空=用库定义"></div>`;
      html += `<div class="property-row"><label>商店ID:</label><input type="text" value="${ov.shopId || ''}" data-prop="overrides.shopId" placeholder="留空=用库定义"></div>`;
      html += `<div class="property-row"><label>交互半径:</label><input type="number" value="${ovIt.radius != null ? ovIt.radius : ''}" min="0" data-prop="overrides.interaction.radius" placeholder="留空=用库定义"></div>`;
      html += `<div class="property-row"><label>交互方式:</label><select data-prop="overrides.interaction.trigger">
        <option value="" ${!ovIt.trigger ? 'selected' : ''}>（用库定义）</option>
        <option value="interact" ${ovIt.trigger === 'interact' ? 'selected' : ''}>按键 E</option>
        <option value="approach" ${ovIt.trigger === 'approach' ? 'selected' : ''}>靠近自动</option>
      </select></div>`;
    }
    if (obj.kind === 'resourceNode') {
      const ov = obj.overrides || {};
      html += '<div class="property-row" style="border-top:1px solid #333;margin-top:6px;padding-top:6px;">' +
        '<label style="color:#7cf;font-weight:bold;" title="仅覆盖本处资源节点；动态耗尽和刷新进度不会写入场景 JSON">本处资源规则</label></div>';
      html += `<div class="property-row"><label>当前数量:</label><input type="number" value="${ov.remaining != null ? ov.remaining : ''}" min="0" data-prop="overrides.remaining" placeholder="留空=用库定义"></div>`;
      html += `<div class="property-row"><label>最大数量:</label><input type="number" value="${ov.maxRemaining != null ? ov.maxRemaining : ''}" min="0" data-prop="overrides.maxRemaining" placeholder="留空=用库定义"></div>`;
      html += `<div class="property-row"><label>单次产量:</label><input type="number" value="${ov.yieldPerGather != null ? ov.yieldPerGather : ''}" min="1" data-prop="overrides.yieldPerGather" placeholder="留空=用库定义"></div>`;
      html += `<div class="property-row"><label>刷新规则:</label><select data-prop="overrides.refreshMode">
        <option value="" ${!ov.refreshMode ? 'selected' : ''}>（用库定义）</option>
        <option value="none" ${ov.refreshMode === 'none' ? 'selected' : ''}>不可刷新</option>
        <option value="timed" ${ov.refreshMode === 'timed' ? 'selected' : ''}>定时刷新</option>
      </select></div>`;
      html += `<div class="property-row"><label>刷新间隔(秒):</label><input type="number" value="${ov.refreshIntervalSeconds != null ? ov.refreshIntervalSeconds : ''}" min="0.1" step="0.1" data-prop="overrides.refreshIntervalSeconds" placeholder="留空=用库定义"></div>`;
    }
    return html;
  }

  /**
   * 递归删除对象中的空子对象（供 overrides 清理，保持场景 JSON 干净）
   * @private
   */
  _pruneEmptyObjects(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        this._pruneEmptyObjects(v);
        if (Object.keys(v).length === 0) delete node[key];
      }
    }
  }

  /**
   * 内容库定义编辑器：物品使用字段化类型和 Manifest 图片选择，其余扩展属性仍以 JSON 编辑。
   * 应用只修改内存草稿，用户再点「💾 保存库」经共享 CanonicalEditorSession 持久化。
   */
  showContentDefinitionEditor(catKey, def, { isNew = false } = {}) {
    let modal = document.getElementById('content-def-editor');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'content-def-editor';
      modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'width:460px;max-height:70vh;overflow:auto;background:#0d1326;border:1px solid #2a3a5e;' +
        'border-radius:8px;padding:16px;z-index:100001;box-shadow:0 8px 32px rgba(0,0,0,0.6);color:#fff;';
      document.body.appendChild(modal);
    }

    const isItem = catKey === 'items';
    const managedKeys = new Set(isItem
      ? ['id', 'name', 'type', 'imageId', 'assetId']
      : ['id', 'name']);
    const rest = {};
    for (const key of Object.keys(def)) {
      if (!managedKeys.has(key)) rest[key] = def[key];
    }
    const modalGeneration = String(++this._contentDefinitionModalGeneration);
    modal.dataset.contentDefinitionGeneration = modalGeneration;
    const idControl = isNew
      ? `<div style="margin-bottom:8px;"><label style="font-size:12px;color:#9ab;">稳定 ID</label>
          <input id="cde-id" type="text" value="${escapeHtml(def.id || '')}" placeholder="如 resource.wood" style="width:100%;box-sizing:border-box;background:#0a1020;color:#fff;border:1px solid #2a3a5e;border-radius:3px;padding:6px;"></div>`
      : `<div style="margin-bottom:8px;color:#9ab;font-size:12px;">稳定 ID：<code>${escapeHtml(def.id)}</code></div>`;
    const itemControls = isItem ? `
      <div style="margin-bottom:8px;"><label style="font-size:12px;color:#9ab;">物品类型</label>
        <select id="cde-item-type" style="width:100%;box-sizing:border-box;background:#0a1020;color:#fff;border:1px solid #2a3a5e;border-radius:3px;padding:6px;"></select></div>
      <div style="margin-bottom:8px;"><label style="font-size:12px;color:#9ab;">图片资源 ID</label>
        <select id="cde-image-id" disabled style="width:100%;box-sizing:border-box;background:#0a1020;color:#fff;border:1px solid #2a3a5e;border-radius:3px;padding:6px;"><option>正在读取 Manifest…</option></select></div>
      <div style="margin-bottom:8px;"><label style="font-size:12px;color:#9ab;">图片路径（Manifest，读取专用）</label>
        <input id="cde-image-path" type="text" readonly value="正在读取 Manifest…" style="width:100%;box-sizing:border-box;background:#11182d;color:#b9c7e6;border:1px solid #2a3a5e;border-radius:3px;padding:6px;"></div>
      <div style="margin-bottom:10px;display:flex;gap:10px;align-items:center;">
        <div style="width:72px;height:72px;border:1px solid #2a3a5e;border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#080d1a;flex:none;"><img id="cde-image-preview" alt="物品图片预览" style="display:none;width:100%;height:100%;object-fit:contain;"><span id="cde-image-empty" style="padding:6px;text-align:center;color:#ff9a9a;font-size:11px;">未选择图片资源</span></div>
        <small id="cde-image-status" style="color:#9ab;font-size:11px;line-height:1.45;">物品只保存稳定 imageId/assetId；路径由 Manifest 派生。</small>
      </div>` : '';
    modal.innerHTML = `
      <div style="font-weight:bold;margin-bottom:10px;color:#7cf;">编辑定义（${escapeHtml(catKey)}）</div>
      ${idControl}
      <div style="margin-bottom:8px;"><label style="font-size:12px;color:#9ab;">名称</label>
        <input id="cde-name" type="text" value="${escapeHtml(def.name || '')}" style="width:100%;box-sizing:border-box;background:#0a1020;color:#fff;border:1px solid #2a3a5e;border-radius:3px;padding:6px;"></div>
      ${itemControls}
      <div style="margin-bottom:8px;"><label style="font-size:12px;color:#9ab;">专属属性(JSON)</label>
        <textarea id="cde-props" style="width:100%;box-sizing:border-box;min-height:180px;background:#0a1020;color:#fff;border:1px solid #2a3a5e;border-radius:3px;padding:6px;font-family:monospace;font-size:12px;">${escapeHtml(JSON.stringify(rest, null, 2))}</textarea></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="cde-cancel" style="padding:6px 14px;background:#3a4a7e;border:none;border-radius:4px;color:#fff;cursor:pointer;">取消</button>
        <button id="cde-apply" style="padding:6px 14px;background:#4CAF50;border:none;border-radius:4px;color:#000;font-weight:bold;cursor:pointer;">应用</button>
      </div>
      <div style="margin-top:6px;color:#89a;font-size:11px;">应用后点资源库「💾 保存库」持久化到工程</div>
    `;
    modal.style.display = 'block';

    const idInput = modal.querySelector('#cde-id');
    const nameInput = modal.querySelector('#cde-name');
    const propsInput = modal.querySelector('#cde-props');
    const typeSelect = modal.querySelector('#cde-item-type');
    const imageSelect = modal.querySelector('#cde-image-id');
    const imagePathInput = modal.querySelector('#cde-image-path');
    const imagePreview = modal.querySelector('#cde-image-preview');
    const imageEmpty = modal.querySelector('#cde-image-empty');
    const imageStatus = modal.querySelector('#cde-image-status');
    let imageOptions = [];

    if (isItem && typeSelect) {
      const itemTypes = this.editor.assets.getItemTypeOptions?.() || ['material'];
      const selectedType = String(def.type || 'material').trim() || 'material';
      if (!itemTypes.includes(selectedType)) itemTypes.push(selectedType);
      typeSelect.innerHTML = itemTypes
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map(type => `<option value="${escapeHtml(type)}" ${type === selectedType ? 'selected' : ''}>${escapeHtml(type)}</option>`)
        .join('');
    }

    const updateImagePreview = () => {
      if (!isItem || !imageSelect || !imagePathInput || !imagePreview || !imageEmpty || !imageStatus) return;
      const selected = imageOptions.find(option => option.imageId === imageSelect.value) || null;
      imagePathInput.value = selected?.path || (imageOptions.length ? '请选择图片资源' : '没有可用的 Manifest 图片资源');
      if (selected?.url) {
        imagePreview.src = selected.url;
        imagePreview.style.display = 'block';
        imageEmpty.style.display = 'none';
        imageStatus.textContent = `稳定 ID：${selected.imageId}${selected.status ? ` · ${selected.status}` : ''}`;
      } else {
        imagePreview.removeAttribute('src');
        imagePreview.style.display = 'none';
        imageEmpty.style.display = '';
        imageStatus.textContent = selected
          ? '该 Manifest 条目缺少可预览的运行时 PNG 路径。'
          : '物品只保存稳定 imageId/assetId；路径由 Manifest 派生。';
      }
    };

    if (isItem && imageSelect) {
      const requestedImageId = String(def.imageId || def.assetId || '').trim();
      imageSelect.addEventListener('change', updateImagePreview);
      void this.editor.assets.getManifestImageOptions()
        .then(options => {
          if (modal.dataset.contentDefinitionGeneration !== modalGeneration) return;
          imageOptions = options.filter(option => option.path && option.url);
          imageSelect.innerHTML = `<option value="">选择 Manifest 图片资源</option>${imageOptions
            .map(option => `<option value="${escapeHtml(option.imageId)}">${escapeHtml(option.imageId)} · ${escapeHtml(option.path)}</option>`)
            .join('')}`;
          imageSelect.disabled = imageOptions.length === 0;
          if (imageOptions.some(option => option.imageId === requestedImageId)) imageSelect.value = requestedImageId;
          updateImagePreview();
        })
        .catch(error => {
          if (modal.dataset.contentDefinitionGeneration !== modalGeneration) return;
          imageSelect.innerHTML = '<option value="">Manifest 读取失败</option>';
          imageSelect.disabled = true;
          imagePathInput.value = '无法读取 Manifest';
          imageStatus.textContent = `图片资源读取失败：${error.message}`;
          updateImagePreview();
        });
    }

    modal.querySelector('#cde-cancel').onclick = () => {
      if (isNew) this.editor.assets.discardContentDefinition?.(catKey, def);
      modal.style.display = 'none';
    };
    modal.querySelector('#cde-apply').onclick = () => {
      const nextId = isNew ? String(idInput?.value || '').trim() : def.id;
      if (isNew && !STABLE_CONTENT_ID_PATTERN.test(nextId)) {
        this.showToast('稳定 ID 必须以字母开头，且只能使用字母、数字、点、下划线或短横线', 'error');
        return;
      }
      if (isNew && !this.editor.assets.isContentDefinitionIdAvailable?.(catKey, nextId, def)) {
        this.showToast(`稳定 ID 已存在：${nextId}`, 'error');
        return;
      }
      const nextName = String(nameInput?.value || '').trim();
      if (!nextName) {
        this.showToast('名称不能为空', 'error');
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(propsInput?.value || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new TypeError('专属属性必须是 JSON 对象');
        }
      } catch (error) {
        this.showToast('JSON 格式错误: ' + error.message, 'error');
        return;
      }
      for (const key of managedKeys) delete parsed[key];

      let nextType = '';
      let nextImage = '';
      if (isItem) {
        nextType = String(typeSelect?.value || '').trim();
        nextImage = String(imageSelect?.value || '').trim();
        if (!nextType) {
          this.showToast('请选择物品类型', 'error');
          return;
        }
        if (!imageOptions.some(option => option.imageId === nextImage)) {
          this.showToast('请选择有效的 Manifest 图片资源', 'error');
          return;
        }
      }

      for (const key of Object.keys(def)) {
        if (!managedKeys.has(key)) delete def[key];
      }
      Object.assign(def, parsed);
      def.id = nextId;
      def.name = nextName;
      if (isItem) {
        def.type = nextType;
        def.imageId = nextImage;
        def.assetId = nextImage;
      }
      modal.style.display = 'none';
      this.editor.assets.updateContentList?.();
      void this.editor.assets.refreshPlacementVisuals?.();
      this.showToast('已应用（记得点"保存库"）', 'success');
    };
  }

  _commitTriggerId(obj, value) {
    const editor = this.editor;
    const nextTriggerId = String(value || '').trim();
    if (nextTriggerId === String(obj.triggerId || '').trim()) return false;

    editor.history?.saveHistory?.();
    obj.triggerId = nextTriggerId;
    const definition = editor.getProjectTrigger?.(nextTriggerId);
    if (definition) {
      obj.event = definition.when?.type || obj.event || 'interact';
      obj.name = obj.name || definition.id;
    }
    // 全 Trigger 化：不再写 flowGroupId / sceneEventId 死字段。
    delete obj.flowGroupId;
    delete obj.sceneEventId;
    this.updateObjectProperties();
    editor.eventFilter?.rebuild({ preserveSelection: true, notify: true });
    return true;
  }

  _getSceneObjectDisplayName(object) {
    if (!object) return '未命名对象';
    const definitionName = object.type === 'ref'
      ? this.editor.assets?.resolvePlacementVisual?.(object)?.definition?.name
      : '';
    const explicitName = String(object.name || '').trim();
    const preferredName = String(definitionName || '').trim() || explicitName;
    if (preferredName) return preferredName;

    if (object.type === 'spawn' && object.ref === 'player') return '玩家出生点';
    const kindLabels = {
      item: '物品',
      equipment: '装备',
      npc: 'NPC',
      enemy: '敌人',
      resourceNode: '资源节点',
      shop: '商店',
      vehicle: '载具',
      building: '建筑'
    };
    const typeLabels = {
      region: '区域',
      spawn: '刷怪点',
      portal: '传送门',
      npc: 'NPC',
      trigger: '触发器',
      buffZone: '效果区域',
      effectZone: '特效区域',
      image: '图片',
      slice: '切片',
      shape: '形状',
      ellipse: '椭圆'
    };
    return kindLabels[object.kind] || typeLabels[object.type] || '未命名对象';
  }

  _buildUnifiedTriggerProperties(obj) {
    const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const project = this.editor.getProjectDefinitions?.() || null;
    const triggers = (this.editor.getProjectTriggers?.() || [])
      .filter(trigger => isSpatialTriggerEvent(trigger?.when?.type, project) || trigger?.id === obj.triggerId);
    const definition = this.editor.getProjectTrigger?.(obj.triggerId);
    const triggerLabel = definition
      ? (definition.name || definition.id)
      : (obj.triggerId ? '未找到定义' : '未绑定 Trigger');
    const dangling = !!obj.triggerId && !definition;
    const invalidSpatialEvent = !!definition && !isSpatialTriggerEvent(definition.when?.type, project);
    let triggerOptions = `<option value="" ${obj.triggerId ? '' : 'selected'}>-- 未绑定项目行为 --</option>`;
    for (const trigger of triggers) {
      const summary = this.editor.getTriggerSummary?.(trigger.id) || '';
      const selected = trigger.id === obj.triggerId ? 'selected' : '';
      const displayName = trigger.name || trigger.id;
      triggerOptions += `<option value="${escapeHtml(trigger.id)}" ${selected} title="${escapeHtml(summary)}">${escapeHtml(displayName)} · ${escapeHtml(trigger.id)}</option>`;
    }
    if (dangling) {
      triggerOptions += `<option value="${escapeHtml(obj.triggerId)}" selected>${escapeHtml(obj.triggerId)}（悬空引用）</option>`;
    }

    const selectorModeLabels = {
      id: '对象 ID',
      group: '对象组',
      tag: '标签组',
      name: '对象名称',
      type: '对象类型',
      ref: '内容/语义引用'
    };
    const targetMode = SCENE_OBJECT_SELECTOR_MODES.includes(obj.targetMode) ? obj.targetMode : 'auto';
    let targetModeOptions = SCENE_OBJECT_SELECTOR_MODES.map(mode =>
      `<option value="${mode}" ${targetMode === mode ? 'selected' : ''}>${selectorModeLabels[mode]}</option>`
    ).join('');
    if (targetMode === 'auto') {
      targetModeOptions = '<option value="auto" selected>旧数据自动匹配（请迁移）</option>' + targetModeOptions;
    }

    const candidates = new Map();
    for (const layer of this.editor.sceneData.layers || []) {
      for (const candidate of layer.objects || []) {
        if (!candidate || candidate === obj) continue;
        for (const value of sceneObjectSelectorValues(candidate, targetMode)) {
          const existing = candidates.get(value);
          if (existing) {
            existing.count++;
            existing.objects.push(candidate);
          } else {
            candidates.set(value, { object: candidate, objects: [candidate], count: 1 });
          }
        }
      }
    }
    const currentTarget = String(obj.target || '');
    let targetOptions = '<option value="">-- 不关联场景对象 --</option>';
    const sortedCandidates = [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
    for (const [value, entry] of sortedCandidates) {
      const candidate = entry.object;
      const displayNames = [...new Set(entry.objects
        .map(item => this._getSceneObjectDisplayName(item))
        .map(item => String(item || '').trim())
        .filter(Boolean))];
      const displayName = displayNames.slice(0, 3).join(' / ') || '未命名对象';
      const remainingNames = displayNames.length > 3 ? ` 等${displayNames.length}种` : '';
      const count = entry.count > 1 ? ` · ${entry.count}个对象` : '';
      const stableValue = displayName === value ? '' : ` · ${value}`;
      const label = `${displayName}${remainingNames}${stableValue} [${candidate.type || 'unknown'}]${count}`;
      targetOptions += `<option value="${escapeHtml(value)}" ${value === currentTarget ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }
    const targetMissing = !!currentTarget && !candidates.has(currentTarget);
    if (targetMissing) {
      targetOptions += `<option value="${escapeHtml(currentTarget)}" selected>${escapeHtml(currentTarget)}（当前场景未找到）</option>`;
    }

    const eventType = definition?.when?.type || obj.event || '';
    const summary = definition ? this.editor.getTriggerSummary?.(definition.id) : '未找到项目行为定义';
    const legacyFields = ['actionType', 'actionParams', 'conditions', 'once', 'cooldown'].filter(key => obj[key] !== undefined);
    return `
      <div class="property-row"><label>名称:</label><input type="text" value="${escapeHtml(obj.name || '')}" data-prop="name"></div>
      <div class="property-row"><label>是否显示:</label><input type="checkbox" data-prop="enabled" ${obj.enabled !== false ? 'checked' : ''} title="关闭后运行时不显示提示，也不执行该事件"></div>
      <div class="property-row"><label>项目行为:</label><select id="editor-trigger-picker" style="min-width:0;flex:1;" title="界面显示中文名称，保存和运行时使用稳定英文 Trigger ID">${triggerOptions}</select></div>
      <div class="property-row"><label>英文 Trigger ID:</label><input type="text" value="${escapeHtml(obj.triggerId || '')}" data-prop="triggerId" autocomplete="off" placeholder="可直接输入或清空稳定英文 ID" title="canonical binding.triggerId 与运行时执行使用此稳定英文 ID"></div>
      <div class="property-row"><label>绑定 Trigger:</label><input type="text" value="${escapeHtml(triggerLabel)}" disabled title="项目 Trigger 的中文名称；英文 ID 见上一项"></div>
      <div class="property-row"><label>行为摘要:</label><textarea rows="2" disabled style="width:100%;color:${dangling ? '#ef5350' : '#c9d4ef'}">${escapeHtml(summary)}</textarea></div>
      ${dangling ? '<div class="property-row"><small style="color:#ef5350;">⚠ triggerId 在 game.project.json 中不存在，运行时不会执行。</small></div>' : ''}
      ${invalidSpatialEvent ? `<div class="property-row"><small style="color:#ef5350;">⚠ ${escapeHtml(eventType)} 不是空间事件，请在 TriggerEditor 中改为 interact/approach/enter/leave，或删除此场景 binding。</small></div>` : ''}
      ${targetMode === 'auto' ? '<div class="property-row"><small style="color:#e8a24a;">旧 binding 正在跨字段自动匹配；请选择一种明确的目标方式。</small></div>' : ''}
      ${targetMissing ? `<div class="property-row"><small style="color:#ef5350;">⚠ 当前 ${escapeHtml(selectorModeLabels[targetMode] || '自动')} 值“${escapeHtml(currentTarget)}”在场景中不存在，运行时会拒绝执行。</small></div>` : ''}
      <div class="property-row"><label>空间事件:</label><input type="text" value="${escapeHtml(eventType)}" disabled title="由项目行为 when.type 决定"></div>
      <div class="property-row"><label>目标方式:</label><select data-prop="targetMode">${targetModeOptions}</select></div>
      <div class="property-row"><label>目标对象:</label><select data-prop="target" style="min-width:0;flex:1;" title="界面优先显示中文名称，保存和运行时使用目标方式对应的稳定值">${targetOptions}</select><button id="editor-pick-target" title="按当前目标方式点击场景对象拾取">🎯</button></div>
      <div class="property-row"><label>交互范围:</label><input type="number" value="${obj.pointerRadius != null ? obj.pointerRadius : (obj.radius != null ? obj.radius : 60)}" min="0" data-prop="radius" title="运行时交互检测范围；修改会同步写入 pointerRadius，确保实际生效"></div>
      ${obj.pointerRadius != null && obj.pointerRadius !== obj.radius ? '<div class="property-row"><small style="color:#e8a24a;">该对象存在独立的 pointerRadius 值，已显示为当前实际范围；修改将同步两者。</small></div>' : ''}
      <div class="property-row"><label>操作提示:</label><input type="text" value="${escapeHtml(obj.prompt || '')}" data-prop="prompt" placeholder="如 {interact}点燃"></div>
      <div class="property-row"><label>生效条件 activeWhen:</label><textarea rows="5" data-prop="activeWhen" placeholder='如 {"blackboardKey":"storyState","path":"s01Survival.berriesGathered","equals":true}' style="width:100%;font-family:monospace;">${obj.activeWhen ? escapeHtml(JSON.stringify(obj.activeWhen, null, 2)) : ''}</textarea></div>
      <div class="property-row"><small style="color:#8ea4c9;">留空表示始终生效；仅接受 JSON 对象，支持 all/any/not 与 blackboardKey/path/exists/equals/gte/lte/in。</small></div>
      <div class="property-row"><button id="editor-edit-trigger" ${obj.triggerId ? '' : 'disabled'}>编辑行为</button><button id="editor-preview-trigger" ${definition ? '' : 'disabled'}>预演摘要</button></div>
      ${legacyFields.length ? `<div class="property-row"><small style="color:#e8a24a;">旧场景内行为字段已降级为只读兼容数据：${legacyFields.join(', ')}；保存新行为请使用“编辑行为”。</small></div>` : ''}`;
  }

  /**
   * 构建逻辑对象（region/spawn/portal/npc）的属性 HTML（P2-1）
   * 这些字段直接作为 obj 的属性，走通用 data-prop 绑定（obj[prop]=value）。
   * @private
   */
  _buildLogicProperties(obj) {
    const editor = this.editor;
    let html = '<div class="property-row" style="border-top:1px solid #333;margin-top:6px;padding-top:6px;"></div>';
    // 场景 trigger 始终只编辑空间 binding；项目中暂时没有行为时也不得回退为第二套动作入口。
    if (obj.type === 'trigger') {
      return html + this._buildUnifiedTriggerProperties(obj);
    }
    html += `<div class="property-row"><label>名称:</label><input type="text" value="${obj.name || ''}" data-prop="name"></div>`;
    if (obj.type === 'region') {
      html += `<div class="property-row"><label>区域ID:</label><input type="text" value="${obj.regionId || ''}" data-prop="regionId" placeholder="供触发器 enterRegion 引用"></div>`;
    } else if (obj.type === 'spawn') {
      html += `<div class="property-row"><label>刷怪ID:</label><input type="text" value="${obj.spawnId || ''}" data-prop="spawnId"></div>`;
      html += `<div class="property-row"><label>敌人库ID:</label><input type="text" value="${obj.enemyRef || ''}" data-prop="enemyRef" placeholder="library.enemies 的 id"></div>`;
      html += `<div class="property-row"><label>数量:</label><input type="number" value="${obj.count != null ? obj.count : 1}" min="1" data-prop="count"></div>`;
      html += `<div class="property-row"><label>波次:</label><input type="number" value="${obj.wave != null ? obj.wave : 0}" min="0" data-prop="wave"></div>`;
      html += `<div class="property-row"><label>半径:</label><input type="number" value="${obj.radius != null ? obj.radius : 0}" min="0" data-prop="radius" title="0=单点，>0 在半径内随机散布"></div>`;
    } else if (obj.type === 'portal') {
      html += `<div class="property-row"><label>传送门ID:</label><input type="text" value="${obj.portalId || ''}" data-prop="portalId"></div>`;
      html += `<div class="property-row"><label>目标场景:</label><input type="text" value="${obj.targetScene || ''}" data-prop="targetScene" placeholder="目标 scene id"></div>`;
      html += `<div class="property-row"><label>目标出生点:</label><input type="text" value="${obj.targetSpawn || ''}" data-prop="targetSpawn" placeholder="目标 spawn id"></div>`;
    } else if (obj.type === 'npc') {
      html += `<div class="property-row"><label>NPC库ID:</label><input type="text" value="${obj.npcRef || ''}" data-prop="npcRef" placeholder="library.npcs 的 id"></div>`;
    }
    return html;
  }

  /**
   * 构建椭圆对象的属性 HTML
   * @private
   */
  _buildEllipseProperties(obj) {
    const mode = obj.fillMode || 'color';
    let html = '';
    html += `<div class="property-row"><label>名称:</label><input type="text" value="${obj.name || ''}" data-prop="name" placeholder="椭圆名称"></div>`;
    html += `<div class="property-row"><label>填充模式:</label><select data-prop="fillMode">
      <option value="color" ${mode === 'color' ? 'selected' : ''}>纯色</option>
      <option value="image" ${mode === 'image' ? 'selected' : ''}>图片</option>
      <option value="slice" ${mode === 'slice' ? 'selected' : ''}>切片</option>
    </select></div>`;

    if (mode === 'color') {
      html += `<div class="property-row"><label>填充色:</label><input type="color" value="${obj.fill || '#3a5a2a'}" data-prop="fill"></div>`;
    } else if (mode === 'image') {
      html += `<div class="property-row"><label>图片路径:</label><input type="text" value="${obj.imageSrc || ''}" data-prop="imageSrc" placeholder="输入图片URL"></div>`;
      html += `<div class="property-row"><label>显示模式:</label><select data-prop="imageMode">
        <option value="cover" ${obj.imageMode === 'cover' || !obj.imageMode ? 'selected' : ''}>覆盖</option>
        <option value="stretch" ${obj.imageMode === 'stretch' ? 'selected' : ''}>拉伸</option>
        <option value="contain" ${obj.imageMode === 'contain' ? 'selected' : ''}>包含</option>
        <option value="tile" ${obj.imageMode === 'tile' ? 'selected' : ''}>平铺</option>
      </select></div>`;
      html += `<div class="property-row"><button id="editor-load-fill-image">加载图片</button></div>`;
    } else if (mode === 'slice') {
      const label = obj.decoKey ? obj.decoKey : (obj.sliceKey ? `${obj.atlasId || ''} / ${obj.sliceKey}` : '未设置');
      html += `<div class="property-row"><label>当前切片:</label><input value="${label}" disabled style="color:#FFD700;"></div>`;
      html += `<div class="property-row"><label>平铺模式:</label><select data-prop="sliceMode">
        <option value="tile" ${obj.sliceMode === 'tile' || !obj.sliceMode ? 'selected' : ''}>平铺</option>
        <option value="stretch" ${obj.sliceMode === 'stretch' ? 'selected' : ''}>拉伸</option>
      </select></div>`;
      html += `<div class="property-row"><button id="editor-ellipse-apply-slice" title="先在左侧资源库选中一个切片，再点此填充">用选中切片填充</button></div>`;
    }

    html += `<div class="property-row"><label>透明度:</label><input type="number" value="${obj.opacity !== undefined ? obj.opacity : 1}" step="0.1" min="0" max="1" data-prop="opacity"></div>`;
    // 边缘淡化特效
    html += `<div class="property-row"><label>边缘淡化:</label><input type="number" value="${obj.edgeFade || 0}" step="0.05" min="0" max="1" data-prop="edgeFade" title="0=无，1=从中心开始淡化"></div>`;
    html += `<div class="property-row"><label>边框色:</label><input type="color" value="${obj.stroke || '#5a8a4a'}" data-prop="stroke"></div>`;
    html += `<div class="property-row"><label>边框宽:</label><input type="number" value="${obj.strokeWidth || 0}" min="0" step="1" data-prop="strokeWidth"></div>`;
    html += `<div class="property-row"><label>半径X:</label><input value="${Math.round(obj.width / 2)}" disabled title="宽度/2"></div>`;
    html += `<div class="property-row"><label>半径Y:</label><input value="${Math.round(obj.height / 2)}" disabled title="高度/2"></div>`;
    return html;
  }

  /**
   * 构建统一 shape 对象的属性 HTML（含填充模式/边缘淡化/碰撞）
   * @private
   */
  _buildShapeProperties(obj) {
    const mode = obj.fillMode || 'color';
    let html = '';
    html += `<div class="property-row"><label>名称:</label><input type="text" value="${obj.name || ''}" data-prop="name" placeholder="形状名称"></div>`;
    html += `<div class="property-row"><label>语义角色:</label><input type="text" value="${obj.semanticRole || ''}" data-prop="semanticRole" placeholder="如 travelRoute / collisionBoundary"></div>`;
    html += `<div class="property-row"><label>视觉说明:</label><textarea data-prop="visualDescription" rows="3" placeholder="说明此图形代表的地貌、建筑或玩法区域">${obj.visualDescription || ''}</textarea></div>`;
    html += `<div class="property-row"><label>填充模式:</label><select data-prop="fillMode">
      <option value="color" ${mode === 'color' ? 'selected' : ''}>纯色</option>
      <option value="gradient" ${mode === 'gradient' ? 'selected' : ''}>渐变</option>
      <option value="image" ${mode === 'image' ? 'selected' : ''}>图片</option>
      <option value="slice" ${mode === 'slice' ? 'selected' : ''}>切片</option>
      <option value="pattern" ${mode === 'pattern' ? 'selected' : ''}>图案</option>
    </select></div>`;

    if (mode === 'color') {
      html += `<div class="property-row"><label>填充色:</label><input type="color" value="${obj.fill || '#3a5a2a'}" data-prop="fill"></div>`;
    } else if (mode === 'gradient') {
      html += `<div class="property-row"><label>渐变类型:</label><select data-prop="gradientType">
        <option value="linear" ${obj.gradientType !== 'radial' ? 'selected' : ''}>线性</option>
        <option value="radial" ${obj.gradientType === 'radial' ? 'selected' : ''}>径向</option>
      </select></div>`;
      html += `<div class="property-row"><label>角度:</label><input type="number" value="${obj.gradientAngle || 0}" data-prop="gradientAngle"></div>`;
      html += `<div class="property-row"><label>起始色:</label><input type="color" value="${(obj.gradientStops && obj.gradientStops[0]?.color) || '#000000'}" data-prop="gradientColor0"></div>`;
      html += `<div class="property-row"><label>结束色:</label><input type="color" value="${(obj.gradientStops && obj.gradientStops[1]?.color) || '#333333'}" data-prop="gradientColor1"></div>`;
    } else if (mode === 'image') {
      html += `<div class="property-row"><label>图片路径:</label><input type="text" value="${obj.imageSrc || ''}" data-prop="imageSrc" placeholder="输入图片URL"></div>`;
      html += `<div class="property-row"><label>显示模式:</label><select data-prop="imageMode">
        <option value="cover" ${obj.imageMode === 'cover' || !obj.imageMode ? 'selected' : ''}>覆盖</option>
        <option value="stretch" ${obj.imageMode === 'stretch' ? 'selected' : ''}>拉伸</option>
        <option value="contain" ${obj.imageMode === 'contain' ? 'selected' : ''}>包含</option>
        <option value="tile" ${obj.imageMode === 'tile' ? 'selected' : ''}>平铺</option>
      </select></div>`;
      html += `<div class="property-row"><button id="editor-load-fill-image">加载图片</button></div>`;
    } else if (mode === 'slice') {
      const label = obj.decoKey ? obj.decoKey : (obj.sliceKey ? `${obj.atlasId || ''} / ${obj.sliceKey}` : '未设置');
      html += `<div class="property-row"><label>当前切片:</label><input value="${label}" disabled style="color:#FFD700;"></div>`;
      html += `<div class="property-row"><label>平铺模式:</label><select data-prop="sliceMode">
        <option value="tile" ${obj.sliceMode === 'tile' || !obj.sliceMode ? 'selected' : ''}>平铺</option>
        <option value="stretch" ${obj.sliceMode === 'stretch' ? 'selected' : ''}>拉伸</option>
      </select></div>`;
      html += `<div class="property-row"><button id="editor-ellipse-apply-slice" title="先在左侧资源库选中切片，再点此填充">用选中切片填充</button></div>`;
    } else if (mode === 'pattern') {
      html += `<div class="property-row"><label>图案类型:</label><select data-prop="patternType">
        <option value="grid" ${obj.patternType === 'grid' || !obj.patternType ? 'selected' : ''}>网格</option>
        <option value="dots" ${obj.patternType === 'dots' ? 'selected' : ''}>圆点</option>
        <option value="diagonal" ${obj.patternType === 'diagonal' ? 'selected' : ''}>斜线</option>
        <option value="crosshatch" ${obj.patternType === 'crosshatch' ? 'selected' : ''}>交叉线</option>
      </select></div>`;
      html += `<div class="property-row"><label>图案色:</label><input type="color" value="${obj.patternColor || '#444444'}" data-prop="patternColor"></div>`;
      html += `<div class="property-row"><label>底色:</label><input type="color" value="${obj.patternBg || '#222222'}" data-prop="patternBg"></div>`;
      html += `<div class="property-row"><label>图案大小:</label><input type="number" value="${obj.patternSize || 32}" data-prop="patternSize"></div>`;
    }

    html += `<div class="property-row"><label>透明度:</label><input type="number" value="${obj.opacity !== undefined ? obj.opacity : 1}" step="0.1" min="0" max="1" data-prop="opacity"></div>`;
    html += `<div class="property-row"><label>边缘淡化:</label><input type="number" value="${obj.edgeFade || 0}" step="0.05" min="0" max="1" data-prop="edgeFade"></div>`;
    html += `<div class="property-row"><label>边框色:</label><input type="color" value="${obj.stroke || '#5a8a4a'}" data-prop="stroke"></div>`;
    html += `<div class="property-row"><label>边框宽:</label><input type="number" value="${obj.strokeWidth || 0}" min="0" step="1" data-prop="strokeWidth"></div>`;
    html += `<div class="property-row"><label>可碰撞:</label><input type="checkbox" ${obj.collide ? 'checked' : ''} data-prop="collide" title="不可通行区域（与'可落脚'互斥）"></div>`;
    html += `<div class="property-row"><label>可落脚:</label><input type="checkbox" ${obj.walkable ? 'checked' : ''} data-prop="walkable" title="可行走区域（与'可碰撞'互斥）"></div>`;
    return html;
  }

  /**
   * 构建图片对象（type:'image'）的属性 HTML：路径/URL、图片尺寸、文件大小
   * 图片路径存于 sceneData.imageAssets[imageId].src，不是 obj 上，故用独立 id 绑定。
   * @private
   */
  _buildImageProperties(obj) {
    const editor = this.editor;
    const assets = editor.sceneData.imageAssets || {};
    const asset = assets[obj.imageId];
    const src = asset?.src || '';
    const img = editor.loadedImages.get(obj.imageId);
    const dim = img ? `${img.naturalWidth || img.width}×${img.naturalHeight || img.height}` : '未加载';
    const escapeHtml = value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const ids = Object.keys(assets).sort();
    if (obj.imageId && !ids.includes(obj.imageId)) ids.unshift(obj.imageId);
    const imageOptions = ids.map(id => {
      const label = assets[id]?.name ? `${id} · ${assets[id].name}` : id;
      return `<option value="${escapeHtml(id)}"${id === obj.imageId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');

    let html = '';
    html += `<div class="property-row"><label>对象名称:</label><input type="text" value="${escapeHtml(obj.name || asset?.name || obj.imageId || '')}" data-prop="name" placeholder="画布与图层中显示的名称"></div>`;
    html += `<div class="property-row"><label>语义角色:</label><input type="text" value="${escapeHtml(obj.semanticRole || '')}" data-prop="semanticRole" placeholder="如 sceneBackground / cityGate"></div>`;
    html += `<div class="property-row"><label>表现状态:</label><input type="text" value="${escapeHtml(obj.state || '')}" data-prop="state" placeholder="如 intact / damaged / burning"></div>`;
    html += `<div class="property-row"><label>视觉说明:</label><textarea data-prop="visualDescription" rows="3" placeholder="说明地貌、建筑、朝向和替换时必须保留的构图">${escapeHtml(obj.visualDescription || '')}</textarea></div>`;
    html += `<div class="property-row"><label title="切换到另一个已登记的稳定图片资源">图片ID:</label><select id="editor-image-id" style="flex:1;">${imageOptions}</select></div>`;
    html += `<div class="property-row"><label title="替换当前 ID 对应的图片文件，所有引用保持不变">替换文件:</label><input type="text" id="editor-image-src" value="${escapeHtml(src)}" style="flex:1;"></div>`;
    html += `<div class="property-row"><label>图片尺寸:</label><input id="editor-image-dim" value="${dim}" disabled style="color:#88ccff;"></div>`;
    html += `<div class="property-row"><label>文件大小:</label><input id="editor-image-filesize" value="计算中…" disabled style="color:#88ccff;"></div>`;
    html += `<div class="property-row"><label title="与实体按脚底 Y 共同排序；关闭时图片固定在地面层">实体遮挡:</label><input type="checkbox" ${obj.depthSort === true ? 'checked' : ''} data-prop="depthSort"></div>`;
    html += `<div class="property-row"><label title="图片脚底排序 Y；默认使用图片底边">排序基线Y:</label><input type="number" value="${Number.isFinite(obj.sortY) ? obj.sortY : (obj.y || 0) + (obj.height || 0)}" data-prop="sortY"></div>`;
    html += `<div class="property-row" style="margin-top:8px;"><button id="editor-image-edit-btn" style="flex:1;padding:5px;cursor:pointer;">编辑</button><button id="editor-image-delete-btn" style="flex:1;padding:5px;cursor:pointer;color:#f88;">删除</button></div>`;
    return html;
  }

  /**
   * 通过 dev server /api/file-size 查询图片文件大小并显示（人类可读）
   * @private
   */
  async _fetchImageFileSize(src) {
    const el = document.getElementById('editor-image-filesize');
    if (!el) return;
    if (!src) { el.value = '无路径'; return; }
    // 只有相对路径（本地文件）才能查；http(s)/data URL 直接标注
    if (/^(https?:|data:)/i.test(src)) { el.value = '外部资源'; return; }
    // 编辑器路径（如 ../example/xxx）转为相对仓库根路径
    const relPath = src.replace(/^(\.\.\/)+/, '');
    try {
      const res = await fetch('/api/file-size?path=' + encodeURIComponent(relPath));
      const data = await res.json();
      if (data && data.ok) {
        const bytes = data.size;
        el.value = bytes < 1024 ? `${bytes} B`
          : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
          : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
      } else {
        el.value = '未找到文件';
      }
    } catch (e) {
      el.value = '查询失败';
    }
  }

  /**
   * 打开图片编辑弹窗：展示图片预览，可更换路径、调整尺寸
   * @private
   */
  _openImageEditorModal(imgObj) {
    const editor = this.editor;
    const asset = editor.sceneData.imageAssets?.[imgObj.imageId];
    const src = asset?.src || '';
    const img = editor.loadedImages.get(imgObj.imageId);

    const overlay = document.createElement('div');
    overlay.id = 'slice-editor-overlay';
    overlay.innerHTML = `
      <div id="slice-editor-modal">
        <div class="slice-modal-header">
          <span>图片编辑 - ${imgObj.id || imgObj.imageId}</span>
          <button id="slice-modal-close" title="关闭">✕</button>
        </div>
        <div class="slice-modal-body">
          <div class="slice-modal-canvas-wrap">
            <canvas id="img-modal-canvas"></canvas>
            ${!img ? '<div style="padding:20px;color:#f88;font-size:12px;">图片未加载，请设置正确路径</div>' : ''}
          </div>
          <div class="slice-modal-params">
            <div class="smp-row"><label>图片路径:</label><input type="text" id="imp-path" value="${src}" style="min-width:180px;"></div>
            <div class="smp-row"><label>图片宽:</label><input type="number" id="imp-nat-w" value="${img ? img.naturalWidth : 0}" disabled style="color:#88ccff;"></div>
            <div class="smp-row"><label>图片高:</label><input type="number" id="imp-nat-h" value="${img ? img.naturalHeight : 0}" disabled style="color:#88ccff;"></div>
            <div class="smp-row"><label>对象宽:</label><input type="number" id="imp-width" value="${Math.round(imgObj.width)}"></div>
            <div class="smp-row"><label>对象高:</label><input type="number" id="imp-height" value="${Math.round(imgObj.height)}"></div>
            <div class="smp-row"><label>旋转:</label><input type="number" id="imp-rotation" value="${imgObj.rotation || 0}"></div>
            <div class="smp-row" style="margin-top:6px;">
              <button id="imp-reload" style="flex:1;">刷新图片</button>
              <button id="imp-fit" style="flex:1;">适应原始尺寸</button>
            </div>
            <div class="smp-row" style="margin-top:12px;">
              <button id="imp-confirm" style="flex:1;">确定</button>
              <button id="imp-cancel" style="flex:1;">取消</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 绘制图片预览
    const canvas = document.getElementById('img-modal-canvas');
    const drawImg = () => {
      const curImg = editor.loadedImages.get(imgObj.imageId);
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
    document.getElementById('imp-cancel').addEventListener('click', close);

    // 刷新图片
    document.getElementById('imp-reload').addEventListener('click', () => {
      const newPath = document.getElementById('imp-path').value.trim();
      if (!newPath) return;
      const newImg = new Image();
      newImg.onload = () => {
        editor.loadedImages.set(imgObj.imageId, newImg);
        document.getElementById('imp-nat-w').value = newImg.naturalWidth;
        document.getElementById('imp-nat-h').value = newImg.naturalHeight;
        drawImg();
      };
      newImg.onerror = () => this.showToast('图片加载失败: ' + newPath, 'error');
      newImg.src = newPath;
    });

    // 适应原始尺寸
    document.getElementById('imp-fit').addEventListener('click', () => {
      const curImg = editor.loadedImages.get(imgObj.imageId);
      if (curImg) {
        document.getElementById('imp-width').value = curImg.naturalWidth;
        document.getElementById('imp-height').value = curImg.naturalHeight;
      }
    });

    // 确定
    document.getElementById('imp-confirm').addEventListener('click', () => {
      const newPath = document.getElementById('imp-path').value.trim();
      if (newPath && newPath !== src) {
        if (!editor.sceneData.imageAssets) editor.sceneData.imageAssets = {};
        if (!editor.sceneData.imageAssets[imgObj.imageId]) {
          editor.sceneData.imageAssets[imgObj.imageId] = { src: newPath };
        } else {
          editor.sceneData.imageAssets[imgObj.imageId].src = newPath;
        }
        // 重新加载
        const reImg = new Image();
        reImg.onload = () => { editor.loadedImages.set(imgObj.imageId, reImg); editor.render(); };
        reImg.src = newPath;
      }
      imgObj.width = parseInt(document.getElementById('imp-width').value) || imgObj.width;
      imgObj.height = parseInt(document.getElementById('imp-height').value) || imgObj.height;
      imgObj.rotation = parseInt(document.getElementById('imp-rotation').value) || 0;
      this.updateObjectProperties();
      editor.render();
      close();
    });
  }

  /**
   * 构建背景填充对象的属性 HTML
   * @private
   */
  _buildFillProperties(obj) {
    let html = '';
    html += `<div class="property-row"><label>透明度:</label><input type="number" value="${obj.opacity !== undefined ? obj.opacity : 1}" step="0.1" min="0" max="1" data-prop="opacity"></div>`;
    html += `<div class="property-row"><label>填充模式:</label><select id="fill-mode-select" data-prop="fillMode">
      <option value="color" ${obj.fillMode === 'color' || !obj.fillMode ? 'selected' : ''}>纯色</option>
      <option value="gradient" ${obj.fillMode === 'gradient' ? 'selected' : ''}>渐变</option>
      <option value="image" ${obj.fillMode === 'image' ? 'selected' : ''}>图片</option>
      <option value="pattern" ${obj.fillMode === 'pattern' ? 'selected' : ''}>图案材质</option>
    </select></div>`;

    if (obj.fillMode === 'color' || !obj.fillMode) {
      html += `<div class="property-row"><label>颜色:</label><input type="color" value="${obj.fillColor || '#333333'}" data-prop="fillColor"></div>`;
    } else if (obj.fillMode === 'gradient') {
      html += `<div class="property-row"><label>渐变类型:</label><select data-prop="gradientType">
        <option value="linear" ${obj.gradientType !== 'radial' ? 'selected' : ''}>线性</option>
        <option value="radial" ${obj.gradientType === 'radial' ? 'selected' : ''}>径向</option>
      </select></div>`;
      html += `<div class="property-row"><label>角度:</label><input type="number" value="${obj.gradientAngle || 0}" data-prop="gradientAngle"></div>`;
      html += `<div class="property-row"><label>起始色:</label><input type="color" value="${(obj.gradientStops && obj.gradientStops[0]?.color) || '#000000'}" data-prop="gradientColor0"></div>`;
      html += `<div class="property-row"><label>结束色:</label><input type="color" value="${(obj.gradientStops && obj.gradientStops[1]?.color) || '#333333'}" data-prop="gradientColor1"></div>`;
    } else if (obj.fillMode === 'image') {
      html += `<div class="property-row"><label>图片路径:</label><input type="text" value="${obj.imageSrc || ''}" data-prop="imageSrc" placeholder="输入图片URL"></div>`;
      html += `<div class="property-row"><label>显示模式:</label><select data-prop="imageMode">
        <option value="stretch" ${obj.imageMode === 'stretch' || !obj.imageMode ? 'selected' : ''}>拉伸</option>
        <option value="cover" ${obj.imageMode === 'cover' ? 'selected' : ''}>覆盖</option>
        <option value="contain" ${obj.imageMode === 'contain' ? 'selected' : ''}>包含</option>
        <option value="tile" ${obj.imageMode === 'tile' ? 'selected' : ''}>平铺</option>
      </select></div>`;
      html += `<div class="property-row"><button id="editor-load-fill-image">加载图片</button></div>`;
    } else if (obj.fillMode === 'pattern') {
      html += `<div class="property-row"><label>图案类型:</label><select data-prop="patternType">
        <option value="grid" ${obj.patternType === 'grid' || !obj.patternType ? 'selected' : ''}>网格</option>
        <option value="dots" ${obj.patternType === 'dots' ? 'selected' : ''}>圆点</option>
        <option value="diagonal" ${obj.patternType === 'diagonal' ? 'selected' : ''}>斜线</option>
        <option value="crosshatch" ${obj.patternType === 'crosshatch' ? 'selected' : ''}>交叉线</option>
      </select></div>`;
      html += `<div class="property-row"><label>图案颜色:</label><input type="color" value="${obj.patternColor || '#444444'}" data-prop="patternColor"></div>`;
      html += `<div class="property-row"><label>底色:</label><input type="color" value="${obj.patternBg || '#222222'}" data-prop="patternBg"></div>`;
      html += `<div class="property-row"><label>图案大小:</label><input type="number" value="${obj.patternSize || 32}" data-prop="patternSize"></div>`;
    }

    return html;
  }

  /**
   * 显示提示消息
   */
  showToast(message, type = 'success') {
    let toast = document.getElementById('editor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'editor-toast';
      toast.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);padding:10px 24px;border-radius:6px;color:#fff;font-size:14px;z-index:99999;transition:opacity 0.3s;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      document.body.appendChild(toast);
    }
    toast.style.background = type === 'success' ? '#4CAF50' : '#e53935';
    toast.textContent = message;
    toast.style.opacity = '1';

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1800);
  }
}

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
 * DebugPanel - 游戏调试面板（左上角浮层）
 *
 * 显示：帧率、玩家属性、敌人波次、敌人情况、当前事件、地图位置
 * 操作：下一任务、执行任务、跳转到指定场景
 *
 * 通过触发器动作 `toggleDebug` 启用/停用。
 * DOM 渲染，不走 Canvas，始终覆盖在游戏上层。
 */

import { InputHints } from '../core/input/InputHints.js';
import { getWorldMapCellSceneId } from '../core/WorldMapCell.js';

const DEBUG_PANEL_DEFAULT_LAYOUT = Object.freeze({
  left: 0,
  top: 0,
  width: 218,
  height: 888
});
const DEBUG_PANEL_MIN_WIDTH = 240;
const DEBUG_PANEL_MIN_HEIGHT = 160;
const DEBUG_PANEL_VIEWPORT_MARGIN = 0;

export class DebugPanel {
  /**
   * @param {Object} opts
   * @param {Function} [opts.getScene] - 返回当前活动场景
   * @param {Function} [opts.getSceneManager] - 返回 sceneManager
   */
  constructor(opts = {}) {
    this.getScene = opts.getScene || (() => null);
    this.getSceneManager = opts.getSceneManager || (() => null);
    this.isDebugEnabled = opts.isDebugEnabled || (() => false);
    this.diagnosticRecords = [];
    this.visible = false;
    this._el = null;
    this._rafId = null;
    this._fps = 0;
    this._frames = 0;
    this._lastFpsTime = performance.now();
    this._lastInfoUpdateAt = -Infinity;
    this._infoRefreshInterval = 250;
    this._lastSaveInfoUpdateAt = -Infinity;
    this._saveInfoRefreshInterval = 1000;
    this._layout = { ...DEBUG_PANEL_DEFAULT_LAYOUT };
    this._pointerOperation = null;
    this._layoutEventsBound = false;
    this._onHeaderPointerDown = event => this._beginPanelPointerOperation(event, 'drag');
    this._onResizeHandlePointerDown = event => this._beginPanelPointerOperation(event, 'resize');
    this._onPointerMove = event => this._handlePanelPointerMove(event);
    this._onPointerEnd = event => this._endPanelPointerOperation(event);
    this._onViewportResize = () => this._applyPanelLayout();
  }

  /**
   * 让调试显示严格跟随 DebugPanel 的可见状态，不作为场景默认表现：
   * 面板打开=显示（含攀爬区域，打开时默认勾选），面板关闭=隐藏。
   */
  _syncCollisionDebugVisibility(visible = this.visible) {
    const scene = this._getActiveScene();
    if (!scene) return false;
    const enabled = visible === true;
    scene.debugShowActorCollisionEdge = enabled;
    scene.debugShowCollisionPolygons = enabled;
    scene.debugShowClimbableZones = enabled;
    return enabled;
  }

  /** 切换显示/隐藏；暂停时保留面板作为唯一恢复入口。 */
  toggle() {
    if (this.visible && this._getActiveScene()?.isPaused === true) {
      this._syncPauseButton();
      console.warn('[DebugPanel] 游戏逻辑已暂停，请先恢复后再关闭调试面板');
      return true;
    }
    if (!this.visible && !this.isDebugEnabled()) return false;
    const before = {
      visible: this.visible,
      hasElement: !!this._el,
      isConnected: this._el?.isConnected || false,
      domCount: typeof document !== 'undefined' ? document.querySelectorAll('#debug-panel').length : 0
    };
    console.log('[DebugPanel] toggle 开始', before);

    this.visible = !this.visible;
    this._syncCollisionDebugVisibility(this.visible);
    if (this.visible) {
      this._create();
      this._startLoop();
    } else {
      this._destroy();
    }

    const domElement = typeof document !== 'undefined' ? document.getElementById('debug-panel') : null;
    let computedStyle = null;
    let bounds = null;
    if (domElement && typeof window !== 'undefined') {
      const style = window.getComputedStyle(domElement);
      computedStyle = {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        position: style.position,
        zIndex: style.zIndex
      };
      const rect = domElement.getBoundingClientRect();
      bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    console.log('[DebugPanel] toggle 完成', {
      visible: this.visible,
      hasElement: !!this._el,
      isConnected: this._el?.isConnected || false,
      bodyExists: typeof document !== 'undefined' && !!document.body,
      domCount: typeof document !== 'undefined' ? document.querySelectorAll('#debug-panel').length : 0,
      computedStyle,
      bounds,
      rafActive: this._rafId !== null
    });
    return this.visible;
  }

  /** 显示 */
  show() {
    if (!this.isDebugEnabled()) return false;
    if (!this.visible) this.toggle();
    return this.visible;
  }

  /** 隐藏 */
  hide() {
    if (this.visible) this.toggle();
    return !this.visible;
  }

  /** 场景退出或关闭调试模式时强制释放 DOM、RAF 与 Pointer 监听。 */
  dispose() {
    this.visible = false;
    this._syncCollisionDebugVisibility(false);
    this._destroy();
  }

  _getActiveScene() {
    return this.getSceneManager?.()?.getCurrentScene?.() || this.getScene?.() || null;
  }

  _toggleGameLoops() {
    const scene = this._getActiveScene();
    if (!scene) return false;
    if (scene.isPaused) scene.resume?.();
    else scene.pause?.();
    this._syncPauseButton();
    return scene.isPaused === true;
  }

  _syncPauseButton() {
    if (!this._el) return;
    const paused = this._getActiveScene()?.isPaused === true;
    const state = this._el.querySelector('#dp-loop-state');
    const button = this._el.querySelector('#dp-toggle-loops');
    const close = this._el.querySelector('.dp-close');
    if (state) state.textContent = paused ? '已暂停' : '运行中';
    if (button) {
      button.textContent = paused ? '▶ 恢复所有游戏逻辑' : '⏸ 暂停所有游戏逻辑';
      button.setAttribute('aria-pressed', String(paused));
      button.classList.toggle('is-paused', paused);
    }
    if (close) {
      close.disabled = paused;
      close.title = paused ? '请先恢复游戏逻辑' : '关闭';
    }
  }

  /** 接收 SceneDiagnostics 的持久记录投影，不拥有或清空记录。 */
  setDiagnosticRecords(records = []) {
    this.diagnosticRecords = records;
    this._renderDiagnosticRecords();
  }

  recordFailure(_envelope) {
    this._renderDiagnosticRecords();
  }

  _diagnosticJson(value) {
    const seen = new WeakSet();
    const replacer = (_key, entry) => {
      if (typeof entry === 'function') return `[Function ${entry.name || 'anonymous'}]`;
      if (entry instanceof Error) return {
        name: entry.name,
        message: entry.message,
        ...(entry.code ? { code: entry.code } : {})
      };
      if (entry && typeof entry === 'object') {
        if (seen.has(entry)) return '[Circular]';
        seen.add(entry);
      }
      return entry;
    };
    try {
      return JSON.stringify(value, replacer, 2);
    } catch (error) {
      return JSON.stringify({ serializationError: error?.message || String(error) });
    }
  }

  _diagnosticLine(value) {
    if (typeof value === 'string') return value.replace(/[\r\n]+/g, ' ↵ ').trim();
    if (value === undefined || value === null) return '';
    return this._diagnosticJson(value).replace(/[\r\n]+/g, ' ↵ ').trim();
  }

  _diagnosticDetails(record) {
    const result = record?.error?.result;
    const candidates = [
      ...(Array.isArray(result?.error?.details) ? result.error.details : []),
      ...(Array.isArray(result?.errors) ? result.errors : []),
      ...(Array.isArray(record?.error?.details) ? record.error.details : []),
      ...(Array.isArray(record?.error?.errors) ? record.error.errors : [])
    ];
    const seen = new Set();
    return candidates.flatMap(detail => {
      const code = this._diagnosticLine(detail?.code || 'unknown');
      const path = this._diagnosticLine(detail?.path || '');
      const message = this._diagnosticLine(detail?.message || detail);
      const extra = detail?.details === undefined ? '' : ` · 详情: ${this._diagnosticLine(detail.details)}`;
      const line = `  └ [${code}]${path ? ` ${path}` : ''}: ${message || '-'}${extra}`;
      if (seen.has(line)) return [];
      seen.add(line);
      return [line];
    });
  }

  _formatDiagnosticRecord(record) {
    if (record.type === 'triggerFailure') {
      const reason = record.reason || record.code || 'unknown';
      const result = record.error?.result;
      const rawMessage = result?.error?.message || record.error?.message || '';
      const message = rawMessage === '[object Object]'
        ? (result?.error?.details || result?.errors || record.error?.details || record.error?.errors || rawMessage)
        : rawMessage;
      const lines = [
        `[触发失败] ${record.triggerId} #${record.action?.index ?? '-'} ${reason}`,
        `  动作: ${record.action?.id || '-'} · 操作: ${record.actionOperationId || record.operationId || '-'}`
      ];
      if (message) lines.push(`  原因: ${this._diagnosticLine(message)}`);
      const reasonData = rawMessage === '[object Object]'
        ? {
          ...(result?.error || record.error || {}),
          message
        }
        : (result?.error || record.error || { reason, code: record.code || null });
      lines.push(`  原因JSON:\n${this._diagnosticJson(reasonData)}`);
      if (result?.code && result.code !== reason) lines.push(`  命令结果: ${this._diagnosticLine(result.code)}`);
      return [...lines, ...this._diagnosticDetails(record)];
    }
    if (record.type === 'eventConflict') {
      const winners = record.winnerTriggerIds?.join(',') || '-';
      const failed = record.failedTriggerIds?.join(',') || '-';
      return [`[事件仲裁] ${record.eventType || '?'} ${record.status || '?'} 胜出:${winners} 失败:${failed}`];
    }
    const retry = record.consumer === 'content'
      ? ` ${record.exhausted ? '重试耗尽' : `重试 ${record.attempt}/${record.maxRetries}`}`
      : '';
    const lines = [`[事件消费] ${record.eventType || '?'} ${record.consumer || '?'} ${record.code || 'failed'}${retry}`];
    if (record.message) lines.push(`  原因: ${this._diagnosticLine(record.message)}`);
    return [...lines, ...this._diagnosticDetails(record)];
  }

  _renderDiagnosticRecords() {
    const target = this._el?.querySelector?.('#dp-trigger-failures');
    if (!target) return;
    const records = this.diagnosticRecords.filter(record => [
      'triggerFailure', 'eventConflict', 'applicationEventConsumerFailure'
    ].includes(record?.type));
    const lines = records.flatMap(record => this._formatDiagnosticRecord(record));
    target.textContent = lines.length ? lines.slice(-100).join('\n') : '--';
  }

  /** 创建 DOM */
  _create() {
    if (!this.isDebugEnabled()) return false;
    if (this._el) return true;
    const el = document.createElement('div');
    el.id = 'debug-panel';
    el.innerHTML = `
      <div class="dp-header">
        <span>🐞 调试面板</span>
        <button class="dp-close" title="关闭">✕</button>
      </div>
      <div class="dp-body">
        <div class="dp-section">
          <div class="dp-row"><span>FPS:</span><span id="dp-fps">--</span></div>
          <div class="dp-row"><span>位置:</span><span id="dp-pos">--</span></div>
          <div class="dp-row"><span>Draw/帧:</span><span id="dp-drawcalls">--</span></div>
          <div class="dp-row"><span>纹理内存:</span><span id="dp-texmem">--</span></div>
          <div class="dp-row"><span>当前幕:</span><span id="dp-act">--</span></div>
          <div class="dp-row"><span>教程阶段:</span><span id="dp-phase">--</span></div>
        </div>
        <div class="dp-section dp-actions">
          <div class="dp-title">游戏循环</div>
          <div class="dp-row"><span>状态:</span><span id="dp-loop-state">运行中</span></div>
          <div class="dp-btn-row">
            <button id="dp-toggle-loops" type="button" aria-pressed="false">⏸ 暂停所有游戏逻辑</button>
          </div>
        </div>
        <div class="dp-section">
          <div class="dp-title">玩家属性</div>
          <div id="dp-player">--</div>
        </div>
        <div class="dp-section">
          <div class="dp-title">敌人情况</div>
          <div id="dp-enemies">--</div>
        </div>
        <div class="dp-section">
          <div class="dp-title">触发器事件</div>
          <div id="dp-triggers">--</div>
        </div>
        <div class="dp-section">
          <div class="dp-title">事件冲突与失败诊断</div>
          <pre id="dp-trigger-failures">--</pre>
        </div>
        <div class="dp-section">
          <div class="dp-title">事件/任务存档</div>
          <pre id="dp-event-task-save">--</pre>
        </div>
        <div class="dp-section">
          <div class="dp-title">天气</div>
          <div id="dp-weather">--</div>
        </div>
        <div class="dp-section">
          <div class="dp-title">时间</div>
          <div id="dp-time">--</div>
        </div>
        <div class="dp-section dp-actions">
          <div class="dp-title">调试显示</div>
          <label class="dp-check-row">
            <input type="checkbox" id="dp-show-actor-collision-edge" ${this.getScene()?.debugShowActorCollisionEdge ? 'checked' : ''}>
            显示角色碰撞边缘
          </label>
          <label class="dp-check-row">
            <input type="checkbox" id="dp-show-collision" ${this.getScene()?.debugShowCollisionPolygons ? 'checked' : ''}>
            显示地形碰撞多边形（70%）
          </label>
          <label class="dp-check-row">
            <input type="checkbox" id="dp-show-buffzones" ${this.getScene()?.debugShowBuffZones ? 'checked' : ''}>
            显示 Buff 多边形
          </label>
          <label class="dp-check-row">
            <input type="checkbox" id="dp-show-trigger-hotspots" ${this.getScene()?.debugShowTriggerHotspots ? 'checked' : ''}>
            显示交互热点范围
          </label>
          <label class="dp-check-row">
            <input type="checkbox" id="dp-show-climbable-zones" ${this.getScene()?.debugShowClimbableZones !== false ? 'checked' : ''}>
            显示攀爬区域
          </label>
        </div>
        <div class="dp-section dp-actions">
          <div class="dp-title">手柄</div>
          <div class="dp-btn-row">
            <button id="dp-gamepad-panel">🎮 Xbox 360 按键图</button>
          </div>
          <div class="dp-row"><span>状态:</span><span id="dp-gamepad-state">--</span></div>
          <div class="dp-row"><span>提示方案:</span><span id="dp-input-scheme">--</span></div>
        </div>
        <div class="dp-section dp-actions">
          <div class="dp-title">天气控制</div>
          <div class="dp-btn-row">
            <select id="dp-weather-select">
              <option value="clear">晴天</option>
              <option value="breeze">微风</option>
              <option value="wind">大风</option>
              <option value="lightRain">小雨</option>
              <option value="heavyRain">大雨</option>
              <option value="lightFog">小雾</option>
              <option value="heavyFog">大雾</option>
              <option value="storm">雷暴</option>
            </select>
            <button id="dp-weather-apply">应用</button>
            <button id="dp-weather-restore">恢复剧情天气</button>
          </div>
        </div>
        <div class="dp-section dp-actions">
          <div class="dp-title">时间控制</div>
          <div class="dp-btn-row">
            <select id="dp-time-select">
              <option value="dawn">凌晨</option>
              <option value="earlyMorning">清晨</option>
              <option value="morning">上午</option>
              <option value="noon">中午</option>
              <option value="afternoon">下午</option>
              <option value="dusk">黄昏</option>
              <option value="night">夜晚</option>
              <option value="lateNight">深夜</option>
            </select>
            <button id="dp-time-apply">跳转</button>
            <button id="dp-time-pause">暂停</button>
          </div>
          <div class="dp-btn-row">
            <button id="dp-time-advance-day">推进一天</button>
            <button id="dp-time-restore">恢复时间流动</button>
          </div>
        </div>
        <div class="dp-section dp-actions">
          <div class="dp-title">操作</div>
          <div class="dp-btn-row">
            <select id="dp-goto-act">
              <option value="">跳转到...</option>
            </select>
            <button id="dp-goto-btn">跳转</button>
          </div>
          <div class="dp-btn-row">
            <button id="dp-next-task" title="完成当前任务的活动目标：状态事实目标提交真实事务，事件目标发布同源事件；任务完成时奖励自动发放">下一任务 ▶</button>
            <button id="dp-fire-task">⚡ 执行选中</button>
          </div>
          <div class="dp-btn-row">
            <select id="dp-debug-target">
              <option value="">执行目标（任务/触发器/教程/对话）...</option>
            </select>
          </div>
          <div class="dp-btn-row">
            <button id="dp-delete-all-saves" title="清空全部手动存档与自动存档（IndexedDB），不可恢复">🗑 删除所有存档</button>
          </div>
        </div>
      </div>
      <div class="dp-resize-handle" title="拖动以调整调试面板大小" aria-hidden="true"></div>
    `;
    this._injectStyles();
    document.body.appendChild(el);
    this._el = el;
    this._applyPanelLayout();
    this._bindPanelLayoutEvents();
    this._bindEvents();
    this._syncPauseButton();
    this._renderDiagnosticRecords();
  }

  /** 注入样式 */
  _injectStyles() {
    if (document.getElementById('dp-styles')) return;
    const s = document.createElement('style');
    s.id = 'dp-styles';
    s.textContent = `
      #debug-panel { position:fixed; top:0; left:0; width:358px; height:888px; max-width:100vw;
        max-height:100vh; overflow-x:hidden; overflow-y:auto; box-sizing:border-box;
        display:block; pointer-events:auto; background:rgba(0,0,0,0.88); color:#ddd; font:12px/1.5 monospace; border:1px solid #4CAF50;
        border-radius:6px; z-index:99999; user-select:text; }
      #debug-panel .dp-header { display:flex; justify-content:space-between; align-items:center;
        padding:6px 10px; background:#1a3a1a; border-bottom:1px solid #4CAF50; font-weight:bold; color:#4CAF50;
        cursor:move; touch-action:none; user-select:none; }
      #debug-panel .dp-close { background:none; border:none; color:#f88; cursor:pointer; font-size:14px; }
      #debug-panel .dp-body { padding:8px 10px; }
      #debug-panel .dp-section { margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #333; }
      #debug-panel .dp-section pre { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; color:#ddd; }
      #debug-panel .dp-title { color:#8cf; font-weight:bold; margin-bottom:4px; }
      #debug-panel .dp-row { display:flex; justify-content:space-between; margin-bottom:2px; }
      #debug-panel .dp-row span:first-child { color:#999; }
      #debug-panel .dp-row span:last-child { color:#fff; }
      #debug-panel .dp-actions button, #debug-panel .dp-actions select {
        padding:4px 8px; background:#2a3a2a; border:1px solid #4CAF50; color:#fff;
        border-radius:3px; cursor:pointer; font-size:11px; }
      #debug-panel .dp-actions button:hover { background:#3a5a3a; }
      #debug-panel .dp-actions button.is-paused { background:#5a351f; border-color:#ff9800; }
      #debug-panel .dp-close:disabled { color:#777; cursor:not-allowed; }
      #debug-panel .dp-btn-row { display:flex; gap:4px; margin-bottom:4px; flex-wrap:wrap; }
      #debug-panel .dp-actions select { flex:1; min-width:0; }
      #debug-panel .dp-check-row { display:flex; align-items:center; gap:7px; color:#fff; cursor:pointer; }
      #debug-panel .dp-check-row input { margin:0; accent-color:#ff9800; cursor:pointer; }
      #debug-panel .dp-resize-handle { position:absolute; right:1px; bottom:1px; width:16px; height:16px;
        cursor:nwse-resize; touch-action:none; z-index:2; }
      #debug-panel .dp-resize-handle::before { content:''; position:absolute; right:3px; bottom:3px; width:8px; height:8px;
        border-right:2px solid #4CAF50; border-bottom:2px solid #4CAF50; opacity:0.9; }
      #debug-panel.is-manipulating { user-select:none; }
    `;
    document.head.appendChild(s);
  }

  _getViewportSize() {
    const documentElement = typeof document !== 'undefined' ? document.documentElement : null;
    const width = typeof window !== 'undefined' ? Number(window.innerWidth) : Number(documentElement?.clientWidth);
    const height = typeof window !== 'undefined' ? Number(window.innerHeight) : Number(documentElement?.clientHeight);
    return {
      width: Math.max(1, Number.isFinite(width) ? width : 1),
      height: Math.max(1, Number.isFinite(height) ? height : 1)
    };
  }

  _clampPanelValue(value, min, max, fallback) {
    const resolved = Number(value);
    const next = Number.isFinite(resolved) ? resolved : fallback;
    return Math.max(min, Math.min(max, next));
  }

  _applyPanelLayout() {
    const el = this._el;
    if (!el) return false;
    const viewport = this._getViewportSize();
    const maxWidth = Math.max(1, viewport.width - DEBUG_PANEL_VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(1, viewport.height - DEBUG_PANEL_VIEWPORT_MARGIN * 2);
    const minWidth = Math.min(DEBUG_PANEL_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(DEBUG_PANEL_MIN_HEIGHT, maxHeight);
    const width = this._clampPanelValue(
      this._layout.width,
      minWidth,
      maxWidth,
      DEBUG_PANEL_DEFAULT_LAYOUT.width
    );
    this._layout.width = width;
    el.style.width = `${width}px`;

    const requestedHeight = Number(this._layout.height);
    if (Number.isFinite(requestedHeight)) {
      const height = this._clampPanelValue(requestedHeight, minHeight, maxHeight, minHeight);
      this._layout.height = height;
      el.style.height = `${height}px`;
    } else {
      this._layout.height = null;
      el.style.removeProperty('height');
    }

    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(DEBUG_PANEL_VIEWPORT_MARGIN, viewport.width - rect.width - DEBUG_PANEL_VIEWPORT_MARGIN);
    const maxTop = Math.max(DEBUG_PANEL_VIEWPORT_MARGIN, viewport.height - rect.height - DEBUG_PANEL_VIEWPORT_MARGIN);
    this._layout.left = this._clampPanelValue(
      this._layout.left,
      DEBUG_PANEL_VIEWPORT_MARGIN,
      maxLeft,
      DEBUG_PANEL_DEFAULT_LAYOUT.left
    );
    this._layout.top = this._clampPanelValue(
      this._layout.top,
      DEBUG_PANEL_VIEWPORT_MARGIN,
      maxTop,
      DEBUG_PANEL_DEFAULT_LAYOUT.top
    );
    el.style.left = `${this._layout.left}px`;
    el.style.top = `${this._layout.top}px`;
    return true;
  }

  _bindPanelLayoutEvents() {
    if (!this._el || this._layoutEventsBound) return;
    this._el.querySelector('.dp-header')?.addEventListener('pointerdown', this._onHeaderPointerDown);
    this._el.querySelector('.dp-resize-handle')?.addEventListener('pointerdown', this._onResizeHandlePointerDown);
    if (typeof window !== 'undefined') window.addEventListener('resize', this._onViewportResize);
    this._layoutEventsBound = true;
  }

  _unbindPanelLayoutEvents() {
    this._endPanelPointerOperation();
    if (!this._el || !this._layoutEventsBound) return;
    this._el.querySelector('.dp-header')?.removeEventListener('pointerdown', this._onHeaderPointerDown);
    this._el.querySelector('.dp-resize-handle')?.removeEventListener('pointerdown', this._onResizeHandlePointerDown);
    if (typeof window !== 'undefined') window.removeEventListener('resize', this._onViewportResize);
    this._layoutEventsBound = false;
  }

  _beginPanelPointerOperation(event, mode) {
    if (!this._el || !event || event.isPrimary === false) return false;
    if (event.pointerType === 'mouse' && event.button !== 0) return false;
    if (mode === 'drag' && event.target?.closest?.('button, input, select, textarea, a, label')) return false;
    const target = event.currentTarget;
    if (!target) return false;

    event.preventDefault();
    event.stopPropagation();
    this._endPanelPointerOperation();
    const rect = this._el.getBoundingClientRect();
    this._pointerOperation = {
      mode,
      pointerId: event.pointerId,
      target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: rect.height
    };
    target.setPointerCapture?.(event.pointerId);
    target.addEventListener('pointermove', this._onPointerMove);
    target.addEventListener('pointerup', this._onPointerEnd);
    target.addEventListener('pointercancel', this._onPointerEnd);
    this._el.classList.add('is-manipulating');
    return true;
  }

  _handlePanelPointerMove(event) {
    const operation = this._pointerOperation;
    if (!operation || event.pointerId !== operation.pointerId) return false;
    event.preventDefault();
    const deltaX = event.clientX - operation.startClientX;
    const deltaY = event.clientY - operation.startClientY;
    if (operation.mode === 'drag') {
      this._layout.left = operation.startLeft + deltaX;
      this._layout.top = operation.startTop + deltaY;
    } else {
      this._layout.width = operation.startWidth + deltaX;
      this._layout.height = operation.startHeight + deltaY;
    }
    this._applyPanelLayout();
    return true;
  }

  _endPanelPointerOperation(event = null) {
    const operation = this._pointerOperation;
    if (!operation) return false;
    if (event && event.pointerId !== operation.pointerId) return false;
    const { target, pointerId } = operation;
    target.removeEventListener('pointermove', this._onPointerMove);
    target.removeEventListener('pointerup', this._onPointerEnd);
    target.removeEventListener('pointercancel', this._onPointerEnd);
    try {
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    } catch (_) { /* 目标已卸载时无需额外处理 */ }
    this._pointerOperation = null;
    this._el?.classList.remove('is-manipulating');
    return true;
  }

  /** 绑定按钮事件 */
  _bindEvents() {
    const el = this._el;
    el.querySelector('.dp-close').addEventListener('click', () => this.toggle());
    el.querySelector('#dp-toggle-loops').addEventListener('click', () => this._toggleGameLoops());
    el.querySelector('#dp-next-task').addEventListener('click', () => this._nextTask());
    el.querySelector('#dp-fire-task').addEventListener('click', () => this._fireTask());
    el.querySelector('#dp-goto-btn').addEventListener('click', () => this._gotoAct());
    el.querySelector('#dp-delete-all-saves').addEventListener('click', () => this._deleteAllSaves());
    el.querySelector('#dp-show-actor-collision-edge').addEventListener('change', (event) => {
      const scene = this.getScene();
      if (!scene) return;
      scene.debugShowActorCollisionEdge = event.target.checked;
      console.log('[DebugPanel] 角色碰撞边缘显示:', event.target.checked ? '开启' : '关闭');
    });
    el.querySelector('#dp-show-collision').addEventListener('change', (event) => {
      const scene = this.getScene();
      if (!scene) return;
      scene.debugShowCollisionPolygons = event.target.checked;
      console.log('[DebugPanel] 地形碰撞多边形显示:', event.target.checked ? '开启' : '关闭');
    });
    el.querySelector('#dp-show-buffzones').addEventListener('change', (event) => {
      const scene = this.getScene();
      if (!scene) return;
      scene.debugShowBuffZones = event.target.checked;
      console.log('[DebugPanel] Buff 多边形显示:', event.target.checked ? '开启' : '关闭');
    });
    el.querySelector('#dp-show-trigger-hotspots').addEventListener('change', (event) => {
      const scene = this.getScene();
      if (!scene) return;
      scene.debugShowTriggerHotspots = event.target.checked;
      console.log('[DebugPanel] 交互热点范围显示:', event.target.checked ? '开启' : '关闭');
    });
    el.querySelector('#dp-show-climbable-zones').addEventListener('change', (event) => {
      const scene = this.getScene();
      if (!scene) return;
      scene.debugShowClimbableZones = event.target.checked;
      console.log('[DebugPanel] 攀爬区域显示:', event.target.checked ? '开启' : '关闭');
    });
    el.querySelector('#dp-gamepad-panel').addEventListener('click', () => {
      const scene = this.getScene();
      if (!scene || !scene.gamepadPanel) {
        console.warn('[DebugPanel] 当前场景没有手柄面板');
        return;
      }
      scene.gamepadPanel.toggle();
      console.log('[DebugPanel] 手柄按键图:', scene.gamepadPanel.visible ? '显示' : '隐藏');
    });
    const applyDebugWeather = () => {
      const scene = this._getActiveScene();
      if (!scene?.weatherSystem) return false;
      const type = el.querySelector('#dp-weather-select').value;
      const applied = scene.weatherSystem.setDebugWeatherOverride?.(type)
        ?? scene.weatherSystem.setWeather?.(type);
      if (applied === false) return false;
      console.log('[DebugPanel] 调试天气覆盖:', type);
      return true;
    };
    // 选择即应用，避免信息面板刷新先把未提交的下拉选择回写为剧情天气。
    el.querySelector('#dp-weather-select').addEventListener('change', applyDebugWeather);
    el.querySelector('#dp-weather-apply').addEventListener('click', applyDebugWeather);

    el.querySelector('#dp-weather-restore').addEventListener('click', () => {
      const scene = this._getActiveScene();
      if (!scene?.weatherSystem) return;
      scene.weatherSystem.clearDebugWeatherOverride?.();
      console.log('[DebugPanel] 恢复剧情天气');
    });

    // ── 时间控制 ──
    const applyDebugTimePeriod = () => {
      const scene = this._getActiveScene();
      if (!scene?.timeSystem) return false;
      const period = el.querySelector('#dp-time-select').value;
      const applied = scene.timeSystem.setTimePeriod?.(period);
      if (applied === false) return false;
      console.log('[DebugPanel] 跳转时间段:', period);
      return true;
    };
    // 选择即应用，避免信息面板刷新先把未提交的下拉选择回写为当前时段。
    el.querySelector('#dp-time-select').addEventListener('change', applyDebugTimePeriod);
    el.querySelector('#dp-time-apply').addEventListener('click', applyDebugTimePeriod);
    el.querySelector('#dp-time-pause').addEventListener('click', () => {
      const scene = this._getActiveScene();
      if (!scene?.timeSystem) return;
      scene.timeSystem.setPaused?.(true);
      console.log('[DebugPanel] 时间已暂停');
    });
    el.querySelector('#dp-time-restore').addEventListener('click', () => {
      const scene = this._getActiveScene();
      if (!scene?.timeSystem) return;
      scene.timeSystem.setPaused?.(false);
      console.log('[DebugPanel] 时间恢复流动');
    });
    el.querySelector('#dp-time-advance-day').addEventListener('click', () => {
      const scene = this._getActiveScene();
      if (!scene?.timeSystem) return;
      scene.timeSystem.advanceDays?.(1);
      console.log('[DebugPanel] 推进一天');
    });

    // 动态加载场景列表到跳转下拉
    this._loadSceneList();
  }

  /** 从 _scene_order.json 动态加载场景列表 */
  async _loadSceneList() {
    const select = this._el && this._el.querySelector('#dp-goto-act');
    if (!select) return;
    try {
      // 尝试 fetch 场景列表文件
      const res = await fetch('assets/scenes/_scene_order.json');
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      if (data && data.order && data.scenes) {
        for (const id of data.order) {
          const info = data.scenes[id];
          if (!info) continue;
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = info.name || id;
          select.appendChild(opt);
        }
        return;
      }
    } catch (e) { /* fallback */ }

    // 回退：从 game.project.json 的 worldMap grid 中提取
    try {
      const res = await fetch('game.project.json');
      if (!res.ok) return;
      const project = await res.json();
      if (project && project.worldMap && project.worldMap.regions) {
        const seen = new Set();
        for (const region of project.worldMap.regions) {
          if (!region.grid) continue;
          for (const row of region.grid) {
            if (!row) continue;
            for (const cell of row) {
              const sceneId = getWorldMapCellSceneId(cell);
              if (sceneId && !seen.has(sceneId)) {
                seen.add(sceneId);
                const opt = document.createElement('option');
                opt.value = sceneId;
                opt.textContent = sceneId;
                select.appendChild(opt);
              }
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  /** 销毁 DOM */
  _destroy() {
    this._unbindPanelLayoutEvents();
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }

  /** 启动刷新循环 */
  _startLoop() {
    const tick = now => {
      if (!this.visible) return;
      // 场景切换/退出后停止刷新：面板持有的是创建者场景的闭包引用，
      // 活动场景失效（isActive=false）或已无活动场景时继续跑只会展示过期快照。
      const activeScene = this._getActiveScene();
      if (!activeScene || (activeScene.isActive === false && activeScene.isPaused !== true)) {
        this._destroy();
        this.visible = false;
        return;
      }
      this._updateFps();
      if (now - this._lastInfoUpdateAt >= this._infoRefreshInterval) {
        this._lastInfoUpdateAt = now;
        this._updateInfo(now);
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._lastInfoUpdateAt = -Infinity;
    this._lastSaveInfoUpdateAt = -Infinity;
    this._rafId = requestAnimationFrame(tick);
  }

  _updateFps() {
    this._frames++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._fps = this._frames;
      this._frames = 0;
      this._lastFpsTime = now;
    }
  }

  /** 刷新信息显示 */
  _updateInfo(now = performance.now()) {
    if (!this._el) return;
    this._syncPauseButton();
    const scene = this._getActiveScene();
    if (!scene) return;

    // 使用主游戏循环桥接的真实 FPS；桥接尚未就绪时回退到面板刷新率
    const gameLoopFps = Number.isFinite(scene.gameLoopFps) ? scene.gameLoopFps : this._fps;
    this._el.querySelector('#dp-fps').textContent = gameLoopFps;

    // Draw call / 纹理内存
    const pm = scene.performanceMonitor;
    if (pm && pm.metrics) {
      this._el.querySelector('#dp-drawcalls').textContent = pm.metrics.drawCallsPerFrame || 0;
      this._el.querySelector('#dp-texmem').textContent = pm._formatBytes
        ? pm._formatBytes(pm.metrics.textureMemory)
        : (pm.metrics.textureMemory ? (pm.metrics.textureMemory / 1048576).toFixed(1) + ' MB' : '0 B');
    }

    // 位置
    const player = scene.playerEntity;
    const transform = player?.getComponent('transform');
    this._el.querySelector('#dp-pos').textContent = transform
      ? `${Math.floor(transform.position.x)}, ${Math.floor(transform.position.y)}`
      : '--';

    // 当前操作提示所用的输入方案（键鼠 / 触屏 / 手柄）
    const schemeEl = this._el.querySelector('#dp-input-scheme');
    if (schemeEl) schemeEl.textContent = `${InputHints.schemeLabel}（${InputHints.scheme}）`;

    // 手柄连接状态
    const gamepadStateEl = this._el.querySelector('#dp-gamepad-state');
    if (gamepadStateEl) {
      const gamepad = scene.inputManager?.gamepad;
      const connected = gamepad?.isConnected ? gamepad.isConnected() : false;
      const info = gamepad?.info;
      gamepadStateEl.textContent = connected
        ? (info?.isXbox ? 'Xbox 手柄已连接' : (info?.id || '手柄已连接'))
        : '未连接';
    }

    // 当前幕与旧面板的教程阶段
    const actNum = scene.actNumber || '?';
    const title = scene.sceneData?.title || scene.title || '';
    this._el.querySelector('#dp-act').textContent = `${actNum} ${title}`;
    this._el.querySelector('#dp-phase').textContent = scene.tutorialPhase || '-';

    // 玩家属性
    const stats = player?.getComponent('stats');
    if (stats) {
      this._el.querySelector('#dp-player').innerHTML =
        `HP: ${Math.floor(stats.hp)}/${stats.maxHp}<br>` +
        `MP: ${Math.floor(stats.mp)}/${stats.maxMp}<br>` +
        `攻: ${stats.attack} 防: ${stats.defense} 速: ${stats.speed}<br>` +
        `等级: ${stats.level}`;
    } else {
      this._el.querySelector('#dp-player').textContent = '--';
    }

    // 与旧面板一致：仅统计 enemyEntities 中 HP 大于 0 的敌人
    const enemyEntities = Array.isArray(scene.enemyEntities) ? scene.enemyEntities : [];
    const aliveEnemies = enemyEntities.filter(enemy => {
      const enemyStats = enemy?.getComponent?.('stats');
      return enemyStats && enemyStats.hp > 0;
    });
    this._el.querySelector('#dp-enemies').textContent =
      `存活: ${aliveEnemies.length} / 总数: ${enemyEntities.length}`;

    // 场景状态可能由外部代码改变，保持复选框显示同步
    const actorCollisionEdgeToggle = this._el.querySelector('#dp-show-actor-collision-edge');
    if (actorCollisionEdgeToggle) actorCollisionEdgeToggle.checked = scene.debugShowActorCollisionEdge === true;
    const collisionToggle = this._el.querySelector('#dp-show-collision');
    if (collisionToggle) collisionToggle.checked = scene.debugShowCollisionPolygons === true;
    const buffZoneToggle = this._el.querySelector('#dp-show-buffzones');
    if (buffZoneToggle) buffZoneToggle.checked = scene.debugShowBuffZones === true;
    const triggerHotspotToggle = this._el.querySelector('#dp-show-trigger-hotspots');
    if (triggerHotspotToggle) triggerHotspotToggle.checked = scene.debugShowTriggerHotspots === true;
    const climbableZoneToggle = this._el.querySelector('#dp-show-climbable-zones');
    if (climbableZoneToggle) climbableZoneToggle.checked = scene.debugShowClimbableZones !== false;

    // 触发器事件
    const gl = scene.gameLoader;
    if (gl && gl.triggerSystem) {
      const triggers = gl.triggerSystem.triggers || [];
      const firedOnce = gl.triggerSystem._firedOnce;
      const pending = triggers.filter(t => t.enabled !== false && !(t.once && firedOnce.has(t.id)));
      const lastFired = gl.triggerSystem._lastFiredId || '--';
      this._el.querySelector('#dp-triggers').innerHTML =
        `总计: ${triggers.length} | 待触发: ${pending.length}<br>` +
        `最近触发: ${lastFired}`;
    }

    // 天气系统
    const ws = scene.weatherSystem;
    if (ws) {
      const debugWeather = ws.debugOverrideWeather || null;
      const storyWeather = `剧情: ${ws.currentWeather}`
        + (ws.currentWeather !== ws.targetWeather ? ` → ${ws.targetWeather}` : '');
      this._el.querySelector('#dp-weather').innerHTML =
        debugWeather ? `调试覆盖: ${debugWeather}<br>${storyWeather}` : storyWeather;
      // 有调试覆盖时保持其选择；未覆盖时跟随剧情目标天气。
      const sel = this._el.querySelector('#dp-weather-select');
      const selectedWeather = debugWeather || ws.targetWeather;
      if (sel && sel.value !== selectedWeather) sel.value = selectedWeather;
    } else {
      this._el.querySelector('#dp-weather').textContent = '未加载';
    }

    // 时间系统
    const ts = scene.timeSystem;
    if (ts && ts.enabled) {
      const period = ts.getCurrentPeriod();
      const progress = (ts.getProgress() * 100).toFixed(0);
      const darknessOpacity = ts.getDarknessOpacity().toFixed(2);
      const paused = ts.paused === true ? '（已暂停）' : '';
      this._el.querySelector('#dp-time').innerHTML =
        `${period}${paused} (${progress}%)<br>` +
        `黑暗蒙版: ${darknessOpacity}`;
      // 时间控制下拉跟随当前时间段
      const timeSel = this._el.querySelector('#dp-time-select');
      if (timeSel && timeSel.value !== period) timeSel.value = period;
    } else {
      this._el.querySelector('#dp-time').textContent = ts ? '已禁用' : '未加载';
    }

    this._updateEventTaskSaveInfo(scene, now);
  }

  /** 节流读取 AuthoritySnapshot 内同源 EventJournal/TaskGraph，只投影调试文本。 */
  _updateEventTaskSaveInfo(scene, now) {
    if (now - this._lastSaveInfoUpdateAt < this._saveInfoRefreshInterval) return;
    this._lastSaveInfoUpdateAt = now;
    this._refreshDebugTargets();
    const target = this._el?.querySelector?.('#dp-event-task-save');
    if (!target) return;

    const services = scene?.context?.services || {};
    const eventSnapshot = services.eventJournal?.snapshot?.() || null;
    const taskSnapshot = services.taskGraph?.snapshot?.() || null;
    const lines = [];

    if (eventSnapshot) {
      const events = Array.isArray(eventSnapshot.events) ? eventSnapshot.events : [];
      const keyEvents = events.filter(event => (
        event?.persistent !== false || ['pending', 'running', 'failed', 'blocked'].includes(event?.status)
      )).slice(-8);
      lines.push(`EventJournal runId=${eventSnapshot.runId || '--'} nextSequence=${eventSnapshot.nextSequence ?? '--'}`);
      lines.push(`events=${events.length} recentKey=${keyEvents.length}`);
      for (const event of keyEvents) {
        const executions = Object.values(event?.executions || {});
        const executionSummary = executions.length > 0
          ? executions.map(entry => `${entry.triggerId}/${entry.stepId}:${entry.status}`).join(', ')
          : 'none';
        lines.push(`- ${event.eventId} | ${event.type} | ${event.status} | executions=${executionSummary}`);
      }
    } else {
      lines.push('EventJournal --');
    }

    if (taskSnapshot) {
      const instances = Array.isArray(taskSnapshot.instances) ? taskSnapshot.instances : [];
      lines.push(`TaskGraph nextInstanceSequence=${taskSnapshot.nextInstanceSequence ?? '--'} instances=${instances.length}`);
      for (const instance of instances) {
        const nodeSummary = Object.entries(instance?.nodeStates || {})
          .map(([nodeId, state]) => `${nodeId}:${state?.status || '--'}`)
          .join(', ') || 'none';
        lines.push(`- ${instance.instanceId} | ${instance.definitionId} | ${instance.status} | nodeStates=${nodeSummary}`);
      }
    } else {
      lines.push('TaskGraph --');
    }

    if (this._taskStatus) lines.push(`▶ ${this._taskStatus}`);

    // 世界地形诊断：跳转/传送后背景缺失时，可立即看出当前 chunk 地形是否就绪
    const terrains = Array.isArray(scene?.context?.world?.terrains)
      ? scene.context.world.terrains.filter(Boolean) : [];
    const currentTerrain = scene?.context?.world?.terrain || null;
    const terrainSummary = terrains.map(terrain => {
      const sceneId = terrain?._editorSceneId || '?';
      const prepared = terrain?._staticCachePrepared === true;
      const bgCount = (terrain?._editorBackgroundImages || []).length;
      const hasCache = terrain?._bgImageCache ? '+cache' : '';
      const combined = terrain?._combinedGroundCache ? '+combined' : '';
      return `${sceneId}:${prepared ? 'ok' : 'pending'}(bg=${bgCount}${hasCache}${combined})`;
    }).join(', ');
    lines.push(`世界地形: terrains=${terrains.length} 当前=${currentTerrain?._editorSceneId || '--'} | ${terrainSummary || '--'}`);
    target.textContent = lines.join('\n');
  }

  // ─── 操作 ─────────────────────────────

  _getTriggersInfo() {
    const scene = this.getScene();
    if (!scene || !scene.gameLoader || !scene.gameLoader.triggerSystem) return null;
    return scene.gameLoader.triggerSystem;
  }

  _getTaskGraph() {
    const scene = this.getScene();
    return scene?.context?.services?.taskGraph || scene?.sceneRuntime?.taskGraphSystem || null;
  }

  _getQuestSystem() {
    return this.getScene()?.questSystem || null;
  }

  _setTaskStatus(message) {
    this._taskStatus = message;
    const scene = this.getScene();
    // now=Infinity 绕过节流，立即刷新 EventJournal/TaskGraph 投影（含任务状态行）
    if (scene) this._updateEventTaskSaveInfo(scene, Infinity);
  }

  /** 活动任务实例：优先当前场景相关（quest.scenes 声明），其余活动实例排后。 */
  _getActiveTaskInstances() {
    const snapshot = this._getTaskGraph()?.snapshot?.() || null;
    const instances = (Array.isArray(snapshot?.instances) ? snapshot.instances : [])
      .filter(instance => instance?.status === 'active');
    const sceneId = this._getActiveScene()?.currentSceneId || null;
    if (!sceneId) return instances;
    const questScenes = new Map();
    const quests = this.getScene()?.gameLoader?.project?.quests;
    if (Array.isArray(quests)) {
      for (const quest of quests) {
        if (Array.isArray(quest?.scenes)) questScenes.set(quest.id, quest.scenes);
      }
    }
    const sceneRank = instance => {
      const scenes = questScenes.get(instance.definitionId);
      return Array.isArray(scenes) ? (scenes.includes(sceneId) ? 0 : 1) : 0;
    };
    return [...instances].sort((a, b) => sceneRank(a) - sceneRank(b));
  }

  /** 任务实例的目标进度摘要（objective 节点 succeeded/required）。 */
  _taskProgressSummary(instance) {
    const definition = this._getTaskGraph()?.getDefinition?.(instance.definitionId);
    const objectives = (definition?.nodes || []).filter(node => node?.type === 'objective');
    if (!objectives.length) return '';
    const done = objectives.filter(node => instance.nodeStates?.[node.id]?.status === 'succeeded').length;
    return ` ${done}/${objectives.length}`;
  }

  /**
   * 完成任务实例的当前活动目标（任务中心制）：
   *   - 状态事实目标（eventMatcher.type === 'state.transaction'）：提交真实事务——
   *     剧情事实落账 → 事务事件回流 → 任务图与目标后触发器同自然流程消费；
   *     事务被拒（前置不满足）时报告原因，避免跳过事实留下后续剧情死锁。
   *   - 事件目标：发布同源 application event（触发器 + 任务图双路消费，与自然玩法一致）。
   *   - 任务完成时 task.completed 自动广播 → completion 触发器发放奖励/物品。
   */
  async _completeTaskObjective(instance) {
    const graph = this._getTaskGraph();
    const definition = graph?.getDefinition?.(instance.definitionId);
    if (!definition) return this._setTaskStatus(`任务定义缺失：${instance.definitionId}`);
    const nodeId = Object.keys(instance.nodeStates || {}).find(id => (
      instance.nodeStates[id]?.status === 'active'
      && definition.nodes?.find(node => node.id === id)?.type === 'objective'
    ));
    if (!nodeId) {
      const nodeSummary = Object.entries(instance.nodeStates || {})
        .map(([id, state]) => `${id}:${state?.status || '--'}`).join(', ') || 'none';
      return this._setTaskStatus(`任务 ${instance.definitionId} 当前无可完成的目标（${nodeSummary}）`);
    }
    const node = (definition.nodes || []).find(entry => entry.id === nodeId);
    const matcher = node?.eventMatcher || {};
    const scene = this.getScene();
    try {
      if (matcher.type === 'state.transaction' && matcher.payload?.definitionId) {
        const gateway = scene?.sceneRuntime?.commandGateway;
        const actorRef = scene?.playerEntity?.id;
        if (!gateway || !actorRef) return this._setTaskStatus('命令网关不可用，无法提交状态事实');
        const result = await gateway.execute({
          intentType: 'state.transaction',
          actorRef,
          operationId: `debug-fact:${matcher.payload.definitionId}:${Date.now()}`,
          payload: { definitionId: matcher.payload.definitionId }
        });
        if (result?.ok === true) {
          this._setTaskStatus(`✅ 已提交事实 ${matcher.payload.definitionId} → 目标 ${nodeId}（${instance.definitionId}）`);
        } else {
          console.warn('[DebugPanel] 状态事实被拒', result);
          this._setTaskStatus(`❌ 事实 ${matcher.payload.definitionId} 被拒：${result?.error?.message || result?.code || 'preconditionFailed'}`);
        }
        return;
      }
      if (matcher.type) {
        const result = await scene?.publishApplicationEvent?.(
          matcher.type,
          JSON.parse(JSON.stringify(matcher.payload || {})),
          { reason: 'debugPanel' }
        );
        if (result?.ok === true || result?.ok === undefined) {
          this._setTaskStatus(`✅ 已发布事件 ${matcher.type} → 目标 ${nodeId}（${instance.definitionId}）`);
        } else {
          this._setTaskStatus(`❌ 事件 ${matcher.type} 发布失败：${result?.code || 'unknown'}`);
        }
        return;
      }
      this._setTaskStatus(`目标 ${nodeId} 缺少 eventMatcher，无法直接完成`);
    } catch (error) {
      console.warn('[DebugPanel] 完成任务目标异常', error);
      this._setTaskStatus(`完成目标异常：${error?.message || error}`);
    }
  }

  /** 下一任务：完成当前（优先当前场景）任务实例的活动目标，奖励随任务完成自动发放。 */
  _nextTask() {
    const instances = this._getActiveTaskInstances();
    if (!instances.length) {
      return this._setTaskStatus('当前没有进行中的任务（TaskGraph 无活动实例；可用「执行选中」启动指定任务）');
    }
    const instance = instances[0];
    this._setTaskStatus(`⏳ 正在完成：${instance.definitionId}${this._taskProgressSummary(instance)} …`);
    void this._completeTaskObjective(instance);
  }

  // ─── 执行目标清单（任务/触发器/教程/对话） ─────────────

  _collectDebugTargets() {
    const targets = [];
    const graph = this._getTaskGraph();
    const snapshot = graph?.snapshot?.() || null;
    const instances = Array.isArray(snapshot?.instances) ? snapshot.instances : [];
    const activeByDefinition = new Map();
    for (const instance of instances) {
      if (instance?.status === 'active') activeByDefinition.set(instance.definitionId, instance);
    }
    for (const definition of graph?.getDefinitions?.() || []) {
      const instance = activeByDefinition.get(definition.id);
      const label = instance
        ? `▶ ${definition.title || definition.id}${this._taskProgressSummary(instance)}`
        : `▷ ${definition.title || definition.id}（未开始）`;
      targets.push({
        group: '任务',
        value: instance ? `task-instance:${instance.instanceId}` : `task-def:${definition.id}`,
        label
      });
    }
    const triggers = this._getTriggersInfo()?.triggers || [];
    for (const trigger of triggers) {
      if (trigger?.enabled === false) continue;
      targets.push({
        group: '触发器',
        value: `trigger:${trigger.id}`,
        label: `${trigger.name || trigger.id}｜${trigger.when?.type || '无 when'}`
      });
    }
    const tutorials = this.getScene()?.tutorialSystem?.getAllTutorials?.() || [];
    for (const tutorial of tutorials) {
      if (!tutorial?.id) continue;
      targets.push({ group: '教程', value: `tutorial:${tutorial.id}`, label: `${tutorial.title || tutorial.id}` });
    }
    const dialogues = this.getScene()?.dialogueSystem?.dialogues;
    if (dialogues && typeof dialogues.keys === 'function') {
      for (const dialogueId of dialogues.keys()) {
        targets.push({ group: '对话', value: `dialogue:${dialogueId}`, label: `${dialogueId}` });
      }
    }
    return targets;
  }

  /** 刷新执行目标下拉；内容未变化时跳过重建（避免打断展开中的下拉）。 */
  _refreshDebugTargets() {
    const select = this._el?.querySelector?.('#dp-debug-target');
    if (!select) return;
    const targets = this._collectDebugTargets();
    const signature = targets.map(target => target.value).join('|');
    if (signature === this._debugTargetsSignature) return;
    this._debugTargetsSignature = signature;
    const previous = select.value;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '执行目标（任务/触发器/教程/对话）...';
    select.appendChild(placeholder);
    let currentGroup = null;
    let groupElement = null;
    for (const target of targets) {
      if (target.group !== currentGroup) {
        currentGroup = target.group;
        groupElement = document.createElement('optgroup');
        groupElement.label = currentGroup;
        select.appendChild(groupElement);
      }
      const option = document.createElement('option');
      option.value = target.value;
      option.textContent = target.label;
      groupElement.appendChild(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  /** 执行选中的目标：任务（推进/启动）/ 触发器（fireById）/ 教程（show）/ 对话（start）。 */
  _fireTask() {
    const select = this._el?.querySelector?.('#dp-debug-target');
    const value = String(select?.value || '');
    if (!value) {
      return this._setTaskStatus('请先在「执行目标」列表中选择：任务 / 触发器 / 教程 / 对话');
    }
    const separator = value.indexOf(':');
    const kind = separator >= 0 ? value.slice(0, separator) : value;
    const id = separator >= 0 ? value.slice(separator + 1) : '';
    try {
      if (kind === 'task-instance') {
        const instance = this._getTaskGraph()?.getInstance?.(id);
        if (!instance || instance.status !== 'active') {
          return this._setTaskStatus(`任务实例不可用：${id}`);
        }
        this._setTaskStatus(`⏳ 正在完成：${instance.definitionId}${this._taskProgressSummary(instance)} …`);
        return void this._completeTaskObjective(instance);
      }
      if (kind === 'task-def') {
        const questSystem = this._getQuestSystem();
        if (!questSystem?.startTaskGraph) return this._setTaskStatus('任务系统不可用，无法启动任务');
        const result = questSystem.startTaskGraph(id);
        Promise.resolve(result).then(outcome => {
          this._setTaskStatus(outcome?.ok === true || outcome?.committed === true
            ? `✅ 已启动任务：${id}`
            : `❌ 启动任务被拒：${id} → ${outcome?.code || 'unknown'}`);
        }).catch(error => this._setTaskStatus(`启动任务异常：${error?.message || error}`));
        return;
      }
      if (kind === 'trigger') {
        const trigger = this._getTriggersInfo()?.getById?.(id);
        if (!trigger?.when) return this._setTaskStatus(`触发器 ${id} 缺少 when，无法执行`);
        const accepted = this._getTriggersInfo().fireById(id, trigger.when.type, trigger.when.params || {});
        return this._setTaskStatus(accepted
          ? `⚡ 已执行触发器：${id}`
          : `⚠️ 触发器 ${id} 未被接受（once 已触发 / 事件竞争失败）`);
      }
      if (kind === 'tutorial') {
        const system = this.getScene()?.tutorialSystem;
        if (!system?.showTutorial) return this._setTaskStatus('教程系统不可用');
        const started = system.showTutorial(id, {});
        return this._setTaskStatus(started === false ? `⚠️ 教程 ${id} 未启动（未解锁/进行中）` : `✅ 已显示教程：${id}`);
      }
      if (kind === 'dialogue') {
        const system = this.getScene()?.dialogueSystem;
        if (!system?.startDialogue) return this._setTaskStatus('对话系统不可用');
        const started = system.startDialogue(id, {});
        return this._setTaskStatus(started === false ? `⚠️ 对话 ${id} 未启动（不存在/进行中）` : `✅ 已开始对话：${id}`);
      }
      this._setTaskStatus(`未知执行目标类型：${kind}`);
    } catch (error) {
      this._setTaskStatus(`执行失败：${value} → ${error?.message || error}`);
    }
  }

  _gotoAct() {
    const select = this._el.querySelector('#dp-goto-act');
    const sceneId = select.value;
    if (!sceneId) return;

    // 调试特权：先写入剧情状态（当前场景 + 解锁列表 + 此前剧情进度标记），
    // 绕过剧情门禁，否则 world.teleport 会因场景未解锁被拒（SanguoSceneStateFlow 门禁）。
    // storyState 可能被快照系统冻结（只读），必须经 blackboard.set 写入新对象。
    // s01Completed=true：跳转即视为"此前剧情已完成"——目标场景的剧情触发器
    // （如 S02 山道抉择 if flag story.s01Completed）可正常播出。
    const loader = this.getScene()?.gameLoader;
    const story = loader?.blackboard?.get?.('storyState') || null;
    if (story && typeof story === 'object') {
      const unlocked = Array.isArray(story.unlockedScenes) ? [...story.unlockedScenes] : [];
      if (!unlocked.includes(sceneId)) unlocked.push(sceneId);
      try {
        loader.blackboard.set('storyState', {
          ...story,
          currentSceneId: sceneId,
          s01Completed: true,
          unlockedScenes: unlocked
        });
      } catch (error) {
        console.warn('[DebugPanel] storyState 跳转预写失败（继续尝试传送）', error?.message || error);
      }
    }

    // 优先大地图内传送（当前场景支持 teleportToChunk 时）
    const scene = this.getScene();
    if (scene && scene.teleportToChunk) {
      scene.teleportToChunk({ scene: sceneId, transition: 'fadeBlack' })
        .then(result => {
          // 传送被门禁/导航拒绝时必须可见，否则调试者无从判断「跳转无反应」的原因
          if (result?.ok === false) {
            console.warn('[DebugPanel] 跳转被拒', {
              operationId: result.operationId || null,
              code: result.code || null,
              errors: JSON.stringify(result.errors || [])
            });
            this._setTaskStatus(`❌ 跳转 ${sceneId} 被拒：${result?.errors?.[0]?.message || result?.code || 'worldTeleportRejected'}`);
          }
        })
        .catch(error => {
          console.warn('[DebugPanel] teleportToChunk 失败', error?.message || error);
          this._setTaskStatus(`❌ 跳转 ${sceneId} 异常：${error?.message || error}`);
        });
      select.value = '';
      return;
    }

    // 回退：SceneManager 切换
    const sm = this.getSceneManager();
    if (sm) {
      sm.switchTo(sceneId);
    }
    select.value = '';
  }

  /** 删除全部存档：委托当前场景注入的存档服务，需二次确认。 */
  async _deleteAllSaves() {
    const scene = this._getActiveScene();
    if (typeof scene?.deleteAllSaves !== 'function') {
      console.warn('[DebugPanel] 当前场景不支持删除存档');
      return;
    }
    const button = this._el.querySelector('#dp-delete-all-saves');
    if (button.disabled) return;
    const confirmed = globalThis.confirm?.('确定删除全部手动存档与自动存档？此操作不可恢复。');
    if (!confirmed) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '删除中...';
    try {
      const result = await scene.deleteAllSaves();
      if (result?.ok === false) {
        console.warn('[DebugPanel] 删除存档失败', result);
        button.textContent = '删除失败';
      } else {
        console.log('[DebugPanel] 已删除全部存档', result);
        button.textContent = '已删除';
      }
    } catch (error) {
      console.error('[DebugPanel] 删除存档异常', error);
      button.textContent = '删除失败';
    } finally {
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1600);
    }
  }
}

export default DebugPanel;

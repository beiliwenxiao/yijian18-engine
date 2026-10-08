/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * TriggerTracePanel - Trigger 执行轨迹面板。
 *
 * 全 Trigger 化后取代 FlowGroup 状态机调试：实时展示运行时每个 Trigger 的
 * 触发/执行/跳过/失败轨迹与事件仲裁结果，并标注幂等护栏
 * `preconditionFailed → alreadyCommitted` 为"✅ 良性跳过（已提交）"，不再刷红。
 *
 * 数据来源：编辑器外部把运行时轨迹推入 `pushTrace(entry)`（运行时 SceneDiagnostics
 * 经既有桥接通道转发）；面板另提供轻量「事件探针」：按 when.type 静态列出会命中的
 * Trigger，供策划离线预览触发链。面板只读展示，不写回任何工程文件。
 */

const asList = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();

const RESULT_META = {
  succeeded: { label: '✅ 成功', short: '✅', color: '#4CAF50', bg: '#1a3320' },
  skipped: { label: '⏭ 跳过', short: '⏭', color: '#8a93a8', bg: '#262b33' },
  benign: { label: '✅ 良性跳过（已提交）', short: '✅', color: '#4a9bd8', bg: '#1a2a3a' },
  failed: { label: '❌ 失败', short: '❌', color: '#ef5350', bg: '#3a1a1a' }
};

export { RESULT_META };

const RESULT_FILTERS = [
  ['', '全部结果'],
  ['succeeded', '✅ 成功'],
  ['skipped', '⏭ 跳过'],
  ['benign', '✅ 良性跳过'],
  ['failed', '❌ 失败']
];

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class TriggerTracePanel {
  /** @param {TriggerEditor} editor */
  constructor(editor) {
    this.editor = editor;
    this.overlay = null;
    this._logEntries = [];
    this._visible = false;
    this._filterResult = '';
    this._filterTrigger = '';
    this._probeResult = []; // 事件探针：匹配 trigger 列表
  }

  /** 外部把一条运行时轨迹推入（时间正序，展示时倒序最新在上）。 */
  pushTrace(entry) {
    if (!entry || typeof entry !== 'object') return this;
    const normalized = {
      time: entry.time || new Date().toLocaleTimeString(),
      eventType: text(entry.eventType) || '?',
      triggerId: text(entry.triggerId),
      name: text(entry.name),
      result: RESULT_META[entry.result] ? entry.result : 'succeeded',
      phase: text(entry.phase),
      code: text(entry.code),
      message: text(entry.message),
      arbitration: entry.arbitration // 可选：{ winners: [], losers: [], policy }
    };
    this._logEntries.unshift(normalized);
    if (this._logEntries.length > 200) this._logEntries.length = 200;
    if (this._visible) this._renderLog();
    return this;
  }

  /** 批量推送（用于桥接通道同步历史记录）。 */
  pushTraces(entries = []) {
    for (const entry of asList(entries)) this.pushTrace(entry);
    return this;
  }

  clear() {
    this._logEntries = [];
    this._probeResult = [];
    if (this._visible) {
      this._renderLog();
      this._renderProbe();
    }
    return this;
  }

  /**
   * 每个 Trigger 的最近一次运行态（总览徽章用）。
   * _logEntries 时间倒序（最新在前），首个即最新；返回 Map<triggerId, {result, time, code, message}>。
   */
  latestResultByTrigger() {
    const map = new Map();
    for (const entry of this._logEntries) {
      const id = text(entry.triggerId);
      if (!id || map.has(id)) continue;
      map.set(id, { result: entry.result, time: entry.time, code: entry.code, message: entry.message });
    }
    return map;
  }

  /** 显示/隐藏面板。 */
  toggle() {
    if (this._visible) this.hide();
    else this.show();
    return this._visible;
  }

  show() {
    if (!this.overlay) this._buildOverlay();
    this._visible = true;
    this.overlay.style.display = 'flex';
    this._renderLog();
    this._renderProbe();
    return true;
  }

  hide() {
    this._visible = false;
    if (this.overlay) this.overlay.style.display = 'none';
    return false;
  }

  _buildOverlay() {
    this._injectStyles();
    this.overlay = document.createElement('div');
    this.overlay.className = 'tr-trace-overlay';
    this.overlay.innerHTML = `
      <div class="tr-trace-modal">
        <div class="tr-trace-header">
          <strong>⚙ Trigger 执行轨迹</strong>
          <span class="tr-trace-sub">运行时实时轨迹 + 事件探针（只读，不写回工程）</span>
          <button class="tr-trace-close" title="关闭">✕</button>
        </div>
        <div class="tr-trace-controls">
          <label>结果</label>
          <select class="tr-trace-filter-result">${RESULT_FILTERS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
          <label>Trigger ID 包含</label>
          <input type="text" class="tr-trace-filter-trigger" placeholder="如 trg_s01" spellcheck="false">
          <button class="tr-trace-clear">🧹 清空轨迹</button>
          <button class="tr-trace-close-panel" style="display:none"></button>
        </div>
        <div class="tr-trace-log-title">触发轨迹（最新在上）</div>
        <div class="tr-trace-log"></div>
        <div class="tr-trace-probe-title">🔍 事件探针（离线：按 when.type 静态匹配，不做运行条件评估）</div>
        <div class="tr-trace-probe">
          <div class="tr-trace-probe-row">
            <select class="tr-trace-probe-event"></select>
            <button class="tr-trace-probe-run">匹配 Trigger</button>
          </div>
          <div class="tr-trace-probe-result"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);
    this.overlay.querySelector('.tr-trace-close').addEventListener('click', () => this.hide());
    this.overlay.querySelector('.tr-trace-clear').addEventListener('click', () => this.clear());
    this.overlay.querySelector('.tr-trace-filter-result').addEventListener('change', event => {
      this._filterResult = event.target.value;
      this._renderLog();
    });
    this.overlay.querySelector('.tr-trace-filter-trigger').addEventListener('input', event => {
      this._filterTrigger = text(event.target.value);
      this._renderLog();
    });
    this._renderProbeEventOptions();
    this.overlay.querySelector('.tr-trace-probe-run').addEventListener('click', () => this._runProbe());
  }

  _renderProbeEventOptions() {
    const select = this.overlay?.querySelector('.tr-trace-probe-event');
    if (!select) return;
    const events = this.editor?.project?.triggerCatalog?.events || [];
    select.innerHTML = '<option value="">全部事件类型</option>' + events.map(event => (
      `<option value="${escapeHtml(typeof event === 'string' ? event : (event?.value || event?.v || ''))}">${escapeHtml(typeof event === 'string' ? event : (event?.label || event?.value || event?.v || ''))}</option>`
    )).join('');
  }

  /** 事件探针：按 when.type 静态列出会命中的 Trigger。 */
  _runProbe() {
    const select = this.overlay?.querySelector('.tr-trace-probe-event');
    const eventType = text(select?.value);
    const triggers = asList(this.editor?.project?.triggers);
    this._probeResult = triggers.filter(trigger =>
      !eventType || text(trigger?.when?.type) === eventType
    );
    this._renderProbe();
  }

  _renderLog() {
    const log = this.overlay?.querySelector('.tr-trace-log');
    if (!log) return;
    const resultFilter = this._filterResult;
    const triggerFilter = this._filterTrigger.toLowerCase();
    const entries = this._logEntries.filter(entry =>
      (!resultFilter || entry.result === resultFilter)
      && (!triggerFilter || entry.triggerId.toLowerCase().includes(triggerFilter) || entry.name.toLowerCase().includes(triggerFilter))
    );
    if (!entries.length) {
      log.innerHTML = '<div class="tr-trace-empty">暂无轨迹。运行 demo 后触发事件，或点击下方「事件探针」离线预览。</div>';
      return;
    }
    log.innerHTML = entries.map(entry => {
      const meta = RESULT_META[entry.result];
      const arbitration = entry.arbitration ? `
        <div class="tr-trace-arbitration">
          事件仲裁：胜出 ${escapeHtml((entry.arbitration.winners || []).join('、') || '—')} · 失败 ${escapeHtml((entry.arbitration.losers || []).join('、') || '—')} · 策略 ${escapeHtml(entry.arbitration.policy || '')}
        </div>` : '';
      return `
        <div class="tr-trace-entry" data-result="${entry.result}"${entry.triggerId ? ` data-trigger="${escapeHtml(entry.triggerId)}" title="点击在剧情线总览中定位该 Trigger"` : ''}>
          <span class="tr-trace-time">${escapeHtml(entry.time)}</span>
          <span class="tr-trace-badge" style="color:${meta.color};background:${meta.bg};">${meta.label}</span>
          <span class="tr-trace-trigger">${escapeHtml(entry.triggerId || entry.name || '?')}</span>
          <span class="tr-trace-event">${escapeHtml(entry.eventType)}</span>
          ${entry.phase ? `<span class="tr-trace-phase">阶段: ${escapeHtml(entry.phase)}</span>` : ''}
          ${entry.code ? `<span class="tr-trace-code" title="${escapeHtml(entry.message)}">${escapeHtml(entry.code)}</span>` : ''}
          ${arbitration}
        </div>`;
    }).join('');
    // 轨迹条目点击反查：切到剧情线总览并高亮对应节点（有 triggerId 才可点）
    for (const element of log.querySelectorAll('.tr-trace-entry[data-trigger]')) {
      element.addEventListener('click', () => {
        const triggerId = element.dataset.trigger;
        const revealed = this.editor?.revealTriggerInStoryline?.(triggerId) === true;
        if (revealed) this.hide(); // 让出画面，总览已高亮定位；点「执行轨迹」可随时回来
      });
    }
  }

  _renderProbe() {
    const result = this.overlay?.querySelector('.tr-trace-probe-result');
    if (!result) return;
    const triggers = this._probeResult;
    if (!triggers.length) {
      result.innerHTML = '<div class="tr-trace-empty">（无匹配）</div>';
      return;
    }
    result.innerHTML = triggers.map(trigger => `
      <div class="tr-trace-probe-item">
        <span>⚡ ${escapeHtml(trigger.id)}</span>
        <span class="tr-trace-event">${escapeHtml(trigger.when?.type || '?')}</span>
        ${trigger.once ? '<span class="tr-trace-code">once</span>' : ''}
        <button class="tr-trace-jump" data-jump-id="${escapeHtml(trigger.id)}">编辑 →</button>
      </div>`).join('');
    for (const button of result.querySelectorAll('.tr-trace-jump')) {
      button.addEventListener('click', () => this.editor.selectById(button.dataset.jumpId, 'triggers'));
    }
  }

  _injectStyles() {
    if (document.getElementById('tr-trace-styles')) return;
    const style = document.createElement('style');
    style.id = 'tr-trace-styles';
    style.textContent = `
      .tr-trace-overlay{position:fixed;inset:0;background:rgba(5,10,25,.72);z-index:10000;display:none;align-items:center;justify-content:center;}
      .tr-trace-modal{width:min(960px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#0d1326;color:#e6ecf7;border:1px solid #2a3a5e;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.55);overflow:hidden;font-size:13px;}
      .tr-trace-header{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#101a30;border-bottom:1px solid #2a3a5e;}
      .tr-trace-sub{color:#8aa;font-size:11px;}
      .tr-trace-close{margin-left:auto;background:#3a4a7e;border:none;color:#fff;border-radius:4px;padding:4px 10px;cursor:pointer;}
      .tr-trace-controls{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#16213e;border-bottom:1px solid #2a3a5e;flex-wrap:wrap;}
      .tr-trace-controls label{color:#93a8cc;font-size:11px;}
      .tr-trace-controls select,.tr-trace-controls input{background:#26304e;color:#e6ecf7;border:1px solid #3a4a7e;border-radius:4px;padding:5px 8px;font-size:12px;}
      .tr-trace-controls input{min-width:200px;}
      .tr-trace-controls button{background:#3a4a7e;border:none;color:#fff;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;}
      .tr-trace-controls button:hover{background:#4a5d9e;}
      .tr-trace-log-title,.tr-trace-probe-title{padding:6px 16px 2px;color:#93a8cc;font-size:11px;border-top:1px solid #2a3a5e;background:#101a30;}
      .tr-trace-log{flex:1;overflow:auto;min-height:140px;padding:4px 16px 10px;font-size:11px;background:#0a1020;}
      .tr-trace-empty{color:#5a6a8a;font-size:12px;padding:8px 0;}
      .tr-trace-entry{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dotted #1a2440;flex-wrap:wrap;}
      .tr-trace-entry[data-trigger]{cursor:pointer;}
      .tr-trace-entry[data-trigger]:hover{background:#16213e;}
      .tr-trace-time{color:#5a6a8a;}
      .tr-trace-badge{display:inline-block;padding:1px 8px;border-radius:8px;font-size:10px;font-weight:bold;white-space:nowrap;}
      .tr-trace-trigger{color:#e6ecf7;font-weight:600;}
      .tr-trace-event{color:#8a93a8;}
      .tr-trace-phase{color:#93a8cc;}
      .tr-trace-code{color:#c07a9a;font-size:10px;border:1px solid #5a3050;border-radius:3px;padding:0 4px;}
      .tr-trace-arbitration{flex-basis:100%;color:#7a8aab;font-size:10px;padding-left:16px;}
      .tr-trace-probe{padding:8px 16px 12px;font-size:12px;background:#0a1020;}
      .tr-trace-probe-row{display:flex;gap:8px;align-items:center;margin-bottom:6px;}
      .tr-trace-probe-row select{background:#26304e;color:#e6ecf7;border:1px solid #3a4a7e;border-radius:4px;padding:5px 8px;font-size:12px;min-width:220px;}
      .tr-trace-probe-row button{background:#3a4a7e;border:none;color:#fff;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;}
      .tr-trace-probe-item{display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px dotted #1a2440;}
      .tr-trace-jump{background:#26304e;border:1px solid #3a4a7e;color:#bcd;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;margin-left:auto;}
      .tr-trace-jump:hover{background:#34406a;color:#fff;}
    `;
    document.head.appendChild(style);
  }
}

export default TriggerTracePanel;

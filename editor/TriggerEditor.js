/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * TriggerEditor - 事件（触发器）编辑器
 *
 * 读写 GameProject（example/<game>/game.project.json）的 triggers[]。
 * 触发器数据见 editor-architecture.md §4.2：{ id, when, if, do, once, cooldown }
 *
 * 通过 Vite dev server 的 /api/read-file、/api/canonical-transaction 读写工程文件（保留其它字段）。
 */

import {
  getTriggerEvents,
  getTriggerEventDescriptor,
  getTriggerActions,
  getTriggerActionDescriptor,
  getTriggerActionOperations,
  getTriggerActionOperation,
  validateTriggerDefinition
} from '../src/systems/TriggerCatalog.js';
import { analyzeTriggerFlow } from './TriggerFlowAnalyzer.js';
import { TriggerProjectIndex } from './TriggerProjectIndex.js';
import { TutorialEditorPanel } from './TutorialEditorPanel.js';
import { TriggerTracePanel } from './TriggerTracePanel.js';
import { TriggerStorylinePanel } from './TriggerStorylinePanel.js';

const text = v => String(v ?? '').trim();

let WHEN_TYPES = getTriggerEvents();
let ACTION_TYPES = getTriggerActions();

export class TriggerEditor {
  /**
   * @param {HTMLElement} container
   * @param {Object} options - { gameId }
   */
  constructor(container, options = {}) {
    this.container = container;
    this.gameId = options.gameId || 'sanguo_zhangjiao';
    this.canonicalSession = options.canonicalSession || null;
    this.schemaFields = this.canonicalSession?.fields || null;
    // 场景列表由编辑器入口按当前游戏动态提供，禁止由触发器引用反推。
    this.getSceneList = typeof options.getSceneList === 'function' ? options.getSceneList : () => [];
    // canonical 场景文档由编辑器入口注入；当前未保存场景可覆盖同 ID 的 committed 快照。
    this.getSceneDocuments = typeof options.getSceneDocuments === 'function' ? options.getSceneDocuments : () => [];
    // 当前场景的完整放置点由场景编辑器显式注入，供物品生成动作可视化选择。
    this.getPlacementOptions = typeof options.getPlacementOptions === 'function' ? options.getPlacementOptions : () => [];
    this.onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;
    this.projectPath = `example/${this.gameId}/game.project.json`;
    this.project = null;
    this.triggers = [];
    this.selectedIndex = -1;
    // 全 Trigger 化：可编辑目标收敛为 storyline / triggers / tutorials（flowGroups 已删除）
    this.target = ['storyline', 'triggers', 'tutorials'].includes(options.target)
      ? options.target
      : 'triggers';
    this.tutorialPanel = new TutorialEditorPanel(this);
    // Trigger 执行轨迹面板（运行时轨迹 + 事件探针，只读调试）
    this.triggerTracePanel = new TriggerTracePanel(this);
    // 剧情线总览视图（Trigger 链视角）
    this.triggerStorylinePanel = new TriggerStorylinePanel(this);
    this._initialized = false;
  }

  async init() {
    if (!this._initialized) {
      this._initialized = true;
      this._buildUI();
      this._injectStyles();
    }
    await this._load();
    this._renderList();
    this._renderDetail();
  }

  /** 加载共享 canonical candidate。 */
  async _load() {
    if (!this.canonicalSession) {
      throw new TypeError('TriggerEditor requires a shared CanonicalEditorSession');
    }
    this.project = this.canonicalSession.getValue();
    if (!this.project || typeof this.project !== 'object') {
      throw new Error('TriggerEditor: canonical project candidate 不可用');
    }
    if (!Array.isArray(this.project.triggers)) this.project.triggers = [];
    if (!Array.isArray(this.project.tutorials)) this.project.tutorials = [];
    if (!['storyline', 'triggers', 'tutorials'].includes(this.target)) this.target = 'triggers';
    this.triggers = this.project[this.target] || [];
    this.projectIndex = new TriggerProjectIndex(this.project, { sceneDocuments: this._getSceneDocuments() });
    WHEN_TYPES = getTriggerEvents(this.project);
    ACTION_TYPES = getTriggerActions(this.project);
    this._refreshCatalogControls();
    this._updateToolbarForTarget();
  }

  _refreshCatalogControls() {
    const when = this.container.querySelector('#trg-filter-when');
    const action = this.container.querySelector('#trg-filter-do');
    if (when) when.innerHTML = '<option value="">全部时机</option>' + WHEN_TYPES.map(item => `<option value="${item.v}">${item.label}</option>`).join('');
    if (action) action.innerHTML = '<option value="">全部动作</option>' + ACTION_TYPES.map(item => `<option value="${item.v}">${item.label}</option>`).join('');
    this._updateTriggerFilter();
  }

  _getScenes() {
    try {
      const scenes = this.getSceneList();
      return Array.isArray(scenes) ? scenes : [];
    } catch (error) {
      console.warn('TriggerEditor: 获取场景列表失败', error);
      return [];
    }
  }

  _getSceneDocuments() {
    try {
      const source = this.getSceneDocuments();
      return Array.isArray(source) ? source : Object.values(source || {});
    } catch (error) {
      console.warn('TriggerEditor: 获取 canonical 场景文档失败', error);
      return [];
    }
  }

  _nextStableId(prefix, definitions = []) {
    const ids = new Set((definitions || []).map(definition => definition?.id).filter(Boolean));
    let sequence = 1;
    let candidate = '';
    do candidate = `${prefix}-${String(sequence++).padStart(3, '0')}`;
    while (ids.has(candidate));
    return candidate;
  }

  _updateToolbarForTarget() {
    if (!this._initialized) return;
    const storyline = this.target === 'storyline';
    // 剧情线总览：列表区与新增/删除隐藏，总览占满详情区
    for (const id of ['trg-add', 'trg-del']) {
      const element = this.container.querySelector(`#${id}`);
      if (element) element.hidden = storyline;
    }
    for (const id of ['trg-list', 'trg-list-resizer']) {
      const element = this.container.querySelector(`#${id}`);
      if (element) element.style.display = storyline ? 'none' : '';
    }
    const detail = this.container.querySelector('#trg-detail');
    if (detail && storyline) detail.style.flex = '1';
    else if (detail) detail.style.flex = '';
    const triggerOnly = this.target === 'triggers';
    for (const id of ['trg-filter-enabled', 'trg-filter-when', 'trg-filter-do']) {
      const element = this.container.querySelector(`#${id}`);
      if (element) element.hidden = !triggerOnly;
    }
    const sceneFilter = this.container.querySelector('#trg-filter-scene');
    if (sceneFilter) sceneFilter.hidden = storyline;
    const eventFilter = this.container.querySelector('#trg-filter-event');
    // FlowGroup 筛选已无意义（数据已清空、入口已收敛），始终隐藏
    if (eventFilter) eventFilter.hidden = true;
    if (!storyline) this._updateTriggerFilter();
  }

  _updateTriggerFilter() {
    const select = this.container.querySelector('#trg-filter-event');
    if (!select || !this.project) return;
    const currentValue = text(select.value);
    const definitions = this.project.triggers || [];
    select.innerHTML = '<option value="">全部 Trigger</option>' + definitions.map(definition => (
      `<option value="${this._escapeHtml(definition.id)}"${definition.id === currentValue ? ' selected' : ''}>${this._escapeHtml(definition.name || definition.id)}</option>`
    )).join('');
  }

  /** 切换编辑目标（storyline 总览 ↔ triggers ↔ tutorials） */
  _switchTarget(target) {
    const normalized = ['storyline', 'triggers', 'tutorials'].includes(target) ? target : 'triggers';
    if (normalized === this.target) return;
    this._commitDetail();
    if (this.target !== 'storyline') this.project[this.target] = this.triggers; // 回写当前（storyline 无独立数据）
    this.target = normalized;
    this.triggers = this.target === 'storyline' ? [] : this.project[this.target];
    this.projectIndex = new TriggerProjectIndex(this.project, { sceneDocuments: this._getSceneDocuments() });
    this.selectedIndex = -1;
    this._renderTargetTabs();
    this._updateToolbarForTarget();
    this._renderList();
    this._renderDetail();
  }

  _renderTargetTabs() {
    const wrap = this.container.querySelector('#trg-target-tabs');
    if (!wrap) return;
    wrap.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.target === this.target);
    });
  }

  /** 保存回工程文件（保留其它字段） */
  async save() {
    // 保存前校验当前详情面板的所有 JSON 框
    const bad = this._validateAllJson();
    if (bad) {
      this._toast('JSON 格式错误，请修正后再保存（红框处）', 'error');
      this._status('❌ JSON 格式错误，未保存', 'err');
      return { ok: false, committed: false, status: 'rejected', code: 'invalidJson' };
    }
    this._commitDetail(); // 先把当前编辑写回数据
    if (this.target !== 'storyline') this.project[this.target] = this.triggers;
    // 剧情线总览里指派的对话归属也要写回（storyline 修改的是 dialogues[].flowGroupId）
    if (this.target === 'storyline') this.project.dialogues = this.project.dialogues || [];
    // 全 Trigger 化：保存不再写入 flowGroupId / sceneEventId 死字段（旧数据读取兼容，新数据不产生）
    for (const list of [this.project.triggers, this.project.tutorials, this.project.dialogues]) {
      for (const definition of Array.isArray(list) ? list : []) {
        delete definition.flowGroupId;
        delete definition.sceneEventId;
      }
    }
    const definitionError = this._validateDefinitions();
    if (definitionError) {
      this._status('❌ ' + definitionError, 'err');
      this._toast(definitionError, 'error');
      return {
        ok: false,
        committed: false,
        status: 'rejected',
        code: 'invalidTriggerDefinitions',
        errors: [{ path: this.target, message: definitionError }]
      };
    }
    const targetLabel = {
      storyline: '剧情线总览',
      triggers: 'Trigger',
      tutorials: 'Tutorial'
    }[this.target] || '定义';
    console.log('[TriggerEditor] 准备保存:', this.projectPath, this.target, '数量:', this.triggers.length, JSON.parse(JSON.stringify(this.triggers)));
    try {
      this.canonicalSession.patchMany([
        { path: 'triggers', value: this.project.triggers },
        { path: 'tutorials', value: this.project.tutorials },
        { path: 'dialogues', value: this.project.dialogues }
      ]);
      const data = await this.canonicalSession.save();
      console.log('[TriggerEditor] 保存返回:', data);
      if (data?.ok === true && data.committed === true) {
        let refreshError = null;
        try {
          await this.onSaved?.(this.project);
        } catch (error) {
          refreshError = error;
          console.warn('[TriggerEditor] 磁盘已提交，但提交后刷新失败:', error);
        }
        const finalResult = refreshError
          ? {
              ...data,
              degraded: true,
              status: 'committed-with-degradation',
              warnings: [...(data.warnings || []), { category: 'postCommitRefreshFailed', message: refreshError.message }]
            }
          : data;
        if (finalResult.degraded) {
          const warning = `磁盘已提交，但缓存/通知同步降级（${targetLabel} ${this.triggers.length} 条）`;
          this._status('⚠️ ' + warning, 'warn');
          this._toast(warning, 'warn');
        } else {
          this._status(`✅ 已保存到 ${this.projectPath}（${targetLabel} ${this.triggers.length} 条）`, 'ok');
          this._toast(`保存成功（${targetLabel} ${this.triggers.length} 条）`, 'success');
        }
        return finalResult;
      }
      const firstError = data?.errors?.[0];
      const message = [firstError?.path, firstError?.message || firstError?.reason]
        .filter(Boolean)
        .join(': ') || data?.error?.message || data?.error || '未知';
      this._status('❌ 保存失败: ' + message, 'err');
      this._toast('保存失败: ' + message, 'error');
      return data;
    } catch (error) {
      console.error('[TriggerEditor] 保存异常:', error);
      const result = error.result || { ok: false, committed: false, status: 'failed', error };
      this._status('❌ 保存失败: ' + error.message, 'err');
      this._toast('保存失败: ' + error.message, 'error');
      return result;
    }
  }

  _validateDefinitions() {
    const triggerIds = new Set();
    for (const trigger of this.project.triggers || []) {
      const errors = validateTriggerDefinition(trigger, this.project);
      if (errors.length) return `${trigger?.id || '(未命名)'}: ${errors[0]}`;
      if (triggerIds.has(trigger.id)) return `重复 Trigger ID "${trigger.id}"`;
      triggerIds.add(trigger.id);
    }

    const tutorialErrors = this.tutorialPanel.validate(this.project.tutorials || [], triggerIds);
    if (tutorialErrors.length) return tutorialErrors[0];
    return '';
  }

  getTriggers() { return this.project?.triggers || []; }
  getTriggerById(id) { return this.getTriggers().find(trigger => trigger.id === id) || null; }

  selectById(id, target = 'triggers') {
    const normalized = ['storyline', 'triggers', 'tutorials'].includes(target) ? target : 'triggers';
    if (!id || !this.project) return false;
    if (this.target !== normalized) this._switchTarget(normalized);
    const index = this.triggers.findIndex(definition => definition.id === id);
    if (index < 0) return false;
    this.selectedIndex = index;
    this._renderList();
    this._renderDetail();
    return true;
  }

  async refresh() {
    await this._load();
    this._renderList();
    this._renderDetail();
    return this;
  }

  /**
   * 校验详情面板所有 JSON 框，返回是否存在非法项（true=有错）
   * @private
   */
  _validateAllJson() {
    const panel = this.container.querySelector('#trg-detail');
    if (!panel) return false;
    const els = this.target === 'tutorials'
      ? [panel.querySelector('#d-tutorial-signals'), panel.querySelector('#d-tutorial-movement')]
      : [
          panel.querySelector('#d-when-params'),
          panel.querySelector('#d-if'),
          ...panel.querySelectorAll('.do-params, .do-param-json, .do-step-if-input, .do-branch-when')
        ];
    let hasError = false;
    for (const el of els) {
      if (!el) continue;
      const v = el.value.trim();
      if (!v) continue; // 空视为合法（可选字段）
      try {
        JSON.parse(v);
      } catch (e) {
        el.style.borderColor = '#e05252';
        el.title = 'JSON 格式错误: ' + e.message;
        hasError = true;
      }
    }
    return hasError;
  }

  /** 弹出式提示（醒目，2秒后淡出） */
  _toast(msg, type = 'success') {
    let t = document.getElementById('trg-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'trg-toast';
      t.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
        'padding:12px 28px;border-radius:8px;color:#fff;font-size:15px;font-weight:bold;' +
        'z-index:100000;pointer-events:none;transition:opacity 0.3s;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
      document.body.appendChild(t);
    }
    const tone = type === true ? 'success' : type === false ? 'error' : type;
    const presentations = {
      success: { icon: '✅ ', background: '#2e7d32' },
      warn: { icon: '⚠️ ', background: '#9a6700' },
      error: { icon: '❌ ', background: '#c62828' }
    };
    const presentation = presentations[tone] || presentations.success;
    t.textContent = presentation.icon + msg;
    t.dataset.type = tone;
    t.style.background = presentation.background;
    t.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  /** 打开全局「按钮写法」弹层（复用剧情线总览的 InputHints 清单）。 */
  _showButtonHelp() {
    this.triggerStorylinePanel.openButtonHelp();
  }

  _buildUI() {
    // 构建 when.type 筛选选项
    const whenOpts = WHEN_TYPES.map(w => `<option value="${w.v}">${w.label}</option>`).join('');
    // 构建 do 动作筛选选项
    const doOpts = ACTION_TYPES.map(a => `<option value="${a.v}">${a.label}</option>`).join('');

    this.container.innerHTML = `
      <div class="trg-root">
        <div class="trg-target-tabs" id="trg-target-tabs">
          <button data-target="storyline">📖 剧情线总览</button>
          <button data-target="triggers">Trigger 业务规则</button>
          <button data-target="tutorials">Tutorial 教学步骤</button>
        </div>
        <div class="trg-toolbar">
          <select id="trg-filter-enabled" title="筛选启用/停用" style="padding:4px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px;font-size:12px;">
            <option value="">全部状态</option>
            <option value="enabled">启用</option>
            <option value="disabled">停用</option>
          </select>
          <select id="trg-filter-scene" title="按空间 binding、when.params.sceneId 与 editorScope.sceneIds 的并集筛选" style="padding:4px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px;font-size:12px;">
            <option value="">全部场景关联</option>
          </select>
          <select id="trg-filter-event" title="筛选单个 Trigger" style="padding:4px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px;font-size:12px;">
            <option value="">全部 Trigger</option>
          </select>
          <select id="trg-filter-when" title="筛选触发时机" style="padding:4px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px;font-size:12px;">
            <option value="">全部时机</option>
            ${whenOpts}
          </select>
          <select id="trg-filter-do" title="筛选动作" style="padding:4px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px;font-size:12px;">
            <option value="">全部动作</option>
            ${doOpts}
          </select>
          <button id="trg-add">+ 新增</button>
          <button id="trg-del">🗑 删除</button>
          <button id="trg-fg-debug" title="实时展示运行时 Trigger 的触发/执行/跳过/失败轨迹与事件仲裁结果">⚙ 执行轨迹</button>
          <button id="trg-save" class="primary">💾 保存到工程</button>
          <span class="trg-hint">数据 → ${this.projectPath}</span>
        </div>
        <div class="trg-association-summary" id="trg-association-summary"></div>
        <div class="trg-main">
          <div class="trg-list" id="trg-list"></div>
          <div class="trg-resizer" id="trg-list-resizer" role="separator" aria-orientation="vertical" aria-label="调整触发器列表宽度" title="左右拖动调整列表宽度；双击恢复默认宽度"></div>
          <div class="trg-detail" id="trg-detail"></div>
        </div>
        <div class="trg-status" id="trg-status"></div>
      </div>
    `;
    this.container.querySelector('#trg-add').addEventListener('click', () => this._addTrigger());
    this.container.querySelector('#trg-del').addEventListener('click', () => this._deleteTrigger());
    this.container.querySelector('#trg-fg-debug').addEventListener('click', () => this.triggerTracePanel.toggle());
    this.container.querySelector('#trg-save').addEventListener('click', async () => {
      await this.save();
    });
    this.container.querySelectorAll('#trg-target-tabs button').forEach(btn => {
      if (btn.dataset.target) btn.addEventListener('click', () => this._switchTarget(btn.dataset.target));
    });
    // 筛选器事件
    this.container.querySelector('#trg-filter-enabled').addEventListener('change', () => this._renderList());
    this.container.querySelector('#trg-filter-scene').addEventListener('change', () => this._renderList());
    this.container.querySelector('#trg-filter-event').addEventListener('change', () => this._renderList());
    this.container.querySelector('#trg-filter-when').addEventListener('change', () => this._renderList());
    this.container.querySelector('#trg-filter-do').addEventListener('change', () => this._renderList());
    this._bindListResizer();
    this._renderTargetTabs();
    this._updateToolbarForTarget();
  }

  _bindListResizer() {
    const main = this.container.querySelector('.trg-main');
    const list = this.container.querySelector('#trg-list');
    const resizer = this.container.querySelector('#trg-list-resizer');
    if (!main || !list || !resizer) return;

    const storageKey = 'yijian18:trigger-editor:list-width';
    const clampWidth = width => {
      const mainWidth = main.getBoundingClientRect().width || this.container.getBoundingClientRect().width || 900;
      const maximum = Math.max(220, Math.min(720, mainWidth - 360));
      return Math.round(Math.max(220, Math.min(maximum, Number(width) || 320)));
    };
    const applyWidth = width => {
      const next = clampWidth(width);
      list.style.width = `${next}px`;
      resizer.setAttribute('aria-valuemin', '220');
      resizer.setAttribute('aria-valuemax', String(clampWidth(720)));
      resizer.setAttribute('aria-valuenow', String(next));
      return next;
    };
    const saveWidth = width => {
      try { localStorage.setItem(storageKey, String(width)); } catch (_error) { /* 持久化失败不影响拖动 */ }
    };

    let storedWidth = 320;
    try { storedWidth = Number(localStorage.getItem(storageKey)) || storedWidth; } catch (_error) { /* 使用默认宽度 */ }
    requestAnimationFrame(() => applyWidth(storedWidth));

    let pointerId = null;
    let startX = 0;
    let startWidth = 0;
    resizer.tabIndex = 0;
    resizer.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = list.getBoundingClientRect().width;
      resizer.setPointerCapture(pointerId);
      resizer.classList.add('dragging');
    });
    resizer.addEventListener('pointermove', event => {
      if (event.pointerId !== pointerId) return;
      applyWidth(startWidth + event.clientX - startX);
    });
    const finishResize = event => {
      if (event.pointerId !== pointerId) return;
      const completedPointerId = pointerId;
      pointerId = null;
      resizer.classList.remove('dragging');
      if (resizer.hasPointerCapture(completedPointerId)) resizer.releasePointerCapture(completedPointerId);
      saveWidth(applyWidth(list.getBoundingClientRect().width));
    };
    resizer.addEventListener('pointerup', finishResize);
    resizer.addEventListener('pointercancel', finishResize);
    resizer.addEventListener('dblclick', () => saveWidth(applyWidth(320)));
    resizer.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -20 : 20;
      saveWidth(applyWidth(list.getBoundingClientRect().width + delta));
    });
  }

  _injectStyles() {
    if (document.getElementById('trg-styles')) return;
    const s = document.createElement('style');
    s.id = 'trg-styles';
    s.textContent = `
      .trg-root{display:flex;flex-direction:column;height:100%;background:#0d1326;color:#fff;}
      .trg-target-tabs{display:flex;gap:4px;padding:8px 16px 0;background:#101a30;}
      .trg-target-tabs button{padding:6px 16px;background:#26304e;border:none;border-radius:14px;color:#bcd;cursor:pointer;font-size:12px;}
      .trg-target-tabs button.active{background:#4a6ad0;color:#fff;font-weight:bold;}
      .trg-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#16213e;border-bottom:1px solid #2a3a5e;}
      .trg-toolbar button{padding:7px 12px;background:#3a4a7e;border:none;border-radius:4px;color:#fff;cursor:pointer;}
      .trg-toolbar button.primary{background:#4CAF50;color:#000;font-weight:bold;}
      .trg-hint{margin-left:auto;color:#8aa;font-size:12px;}
      .trg-association-summary{min-height:20px;padding:4px 16px;background:#111a30;border-bottom:1px solid #253451;color:#93a8cc;font-size:11px;box-sizing:border-box;}
      .trg-main{flex:1;display:flex;overflow:hidden;min-width:0;}
      .trg-list{width:320px;min-width:220px;max-width:70%;flex:0 0 auto;background:#111a30;border-right:0;overflow-y:auto;overflow-x:hidden;}
      .trg-resizer{width:6px;flex:0 0 6px;cursor:col-resize;background:#2a3a5e;position:relative;touch-action:none;transition:background .15s;}
      .trg-resizer::after{content:'';position:absolute;left:2px;top:calc(50% - 24px);width:2px;height:48px;border-left:1px solid rgba(255,255,255,.35);border-right:1px solid rgba(255,255,255,.2);}
      .trg-resizer:hover,.trg-resizer.dragging{background:#4CAF50;}
      .trg-item{padding:10px 12px;border-bottom:1px solid #1e2b47;cursor:grab;display:flex;align-items:flex-start;gap:7px;user-select:none;}
      .trg-item:hover{background:#1a2540;}
      .trg-item:active{cursor:grabbing;}
      .trg-item.dragging{opacity:.4;}
      .trg-item.drop-before{box-shadow:inset 0 3px 0 #6ea8ff;}
      .trg-item.drop-after{box-shadow:inset 0 -3px 0 #6ea8ff;}
      .trg-item.active{background:#2a3a6e;}
      .trg-item.disabled{opacity:0.45;}
      .trg-item .trg-status{font-size:10px;flex-shrink:0;margin-top:2px;}
      .trg-item-copy{flex:1;min-width:0;}
      .trg-item .tname{font-weight:bold;font-size:13px;line-height:1.35;color:#fff;white-space:normal;overflow-wrap:anywhere;word-break:break-word;}
      .trg-item .tid{margin-top:2px;font-size:11px;line-height:1.3;color:#9ab;white-space:normal;overflow-wrap:anywhere;word-break:break-word;}
      .trg-item .twhen{margin-top:3px;font-size:11px;line-height:1.3;color:#9ab;white-space:normal;overflow-wrap:anywhere;}
      .trg-item .tbinding-name{margin-top:4px;font-size:12px;line-height:1.4;color:#e8c46a;white-space:normal;overflow-wrap:anywhere;word-break:break-word;}
      .trg-origin{margin-left:0;flex-shrink:0;padding:2px 5px;border:1px solid #53678f;border-radius:8px;color:#b9c8e6;font-size:9px;white-space:nowrap;}
      .trg-detail{flex:1;padding:16px;overflow-y:auto;}
      .trg-detail .row{margin-bottom:10px;}
      .trg-detail label{display:block;font-size:12px;color:#9ab;margin-bottom:3px;}
      .trg-detail input[type=text],.trg-detail input[type=number],.trg-detail select,.trg-detail textarea{width:100%;box-sizing:border-box;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:6px;border-radius:3px;font-family:monospace;font-size:12px;}
      .trg-detail textarea{min-height:48px;resize:vertical;}
      .trg-do-item{border:1px solid #2a3a5e;border-radius:4px;padding:8px;margin-bottom:8px;background:#0f1830;}
      .trg-do-item.dragging{opacity:.45;}
      .trg-do-item.drop-before{box-shadow:inset 0 3px 0 #6ea8ff;}
      .trg-do-item.drop-after{box-shadow:inset 0 -3px 0 #6ea8ff;}
      .trg-do-item .do-head{display:flex;gap:6px;align-items:center;margin-bottom:6px;}
      .do-drag-handle{flex:0 0 auto;padding:4px 6px;border:0;border-radius:3px;background:#263657;color:#b9c8e6;cursor:grab;font-size:14px;line-height:1;}
      .do-drag-handle:active{cursor:grabbing;}
      .trg-do-item select{flex:1;}
      .do-sequence{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:11px;background:#29466f;color:#d8e8ff;font-size:10px;font-weight:bold;}
      .do-identity-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-bottom:8px;}
      .do-identity-grid label{margin:0;}
      .do-result-semantics{margin:5px 0 8px;padding:6px 8px;border-left:3px solid #5f9ad6;background:#101f39;color:#9fc3e8;font-size:11px;line-height:1.45;}
      .do-structured-params{margin:8px 0;padding:8px;border:1px solid #263c61;border-radius:4px;background:#0c162b;}
      .do-section-title{margin-bottom:7px;color:#80b9ed;font-size:11px;font-weight:bold;}
      .do-param-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;}
      .do-param-grid label{display:flex;flex-direction:column;gap:3px;margin:0;min-width:0;}
      .do-param-grid label span{color:#9ab;font-size:10px;overflow-wrap:anywhere;}
      .do-advanced{margin-top:7px;color:#91a8cc;font-size:11px;}
      .do-advanced summary{cursor:pointer;user-select:none;}
      .do-advanced .do-params{margin-top:6px;}
      .spawn-placement-controls{display:grid;grid-template-columns:110px minmax(0,1fr);gap:6px;align-items:center;}
      .spawn-placement-controls label{grid-column:1 / -1;margin:0;color:#7cf;}
      .spawn-placement-hint{grid-column:1 / -1;color:#89a;font-size:11px;line-height:1.4;}
      .trg-definition-heading{display:flex;flex-direction:column;gap:4px;padding:10px 12px;margin-bottom:14px;border:1px solid #355285;border-radius:5px;background:#13213b;}
      .trg-definition-heading strong{color:#d9e7ff;font-size:14px;}
      .trg-definition-heading span{color:#91a8cc;font-size:11px;line-height:1.45;}
      .trg-flow-card{margin:12px 0;padding:12px;border:1px solid #355285;border-radius:6px;background:#101b31;}
      .trg-flow-start{border-left:4px solid #62a8e5;}
      .trg-flow-end{border-left:4px solid #78c58c;}
      .trg-flow-card-title{display:flex;align-items:center;gap:9px;margin-bottom:10px;}
      .trg-flow-card-title>span{display:inline-flex;align-items:center;justify-content:center;width:25px;height:25px;border-radius:50%;background:#31598f;color:#fff;font-weight:bold;flex:0 0 auto;}
      .trg-flow-card-title>div{display:flex;flex-direction:column;gap:2px;flex:1;}
      .trg-flow-card-title strong{color:#e0edff;font-size:13px;}
      .trg-flow-card-title small{color:#8298ba;font-size:10px;}
      .trg-flow-event-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:9px;}
      .trg-flow-readonly{display:flex;flex-direction:column;gap:5px;padding:6px 8px;border:1px solid #263c61;border-radius:3px;background:#0a1020;box-sizing:border-box;}
      .trg-flow-readonly span,.trg-flow-meta>span{color:#8298ba;font-size:10px;}
      .trg-flow-readonly strong{font-size:12px;color:#d9e7ff;overflow-wrap:anywhere;}
      .trg-flow-meta{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;align-items:start;margin:7px 0;color:#c6d4ed;font-size:11px;line-height:1.45;}
      .trg-flow-identities{display:flex;gap:6px;flex-wrap:wrap;}
      .trg-flow-id{display:inline-flex;gap:5px;align-items:center;padding:3px 6px;border:1px solid #3c5d86;border-radius:3px;background:#111f38;}
      .trg-flow-id b{color:#89bcea;font-weight:normal;}
      .trg-flow-id code{color:#f0d38a;overflow-wrap:anywhere;}
      .trg-flow-id.missing{border-color:#8a4d4d;background:#2a1820;}
      .trg-flow-id.missing code,.trg-flow-warning,.trg-flow-unconnected{color:#ef9d8f;}
      .trg-flow-empty-id{color:#7f91ad;font-style:italic;}
      .trg-flow-connected{color:#7fd29a;font-size:10px;}
      .trg-flow-warning{font-size:10px;}
      .trg-flow-advanced{margin-top:7px;color:#91a8cc;font-size:11px;}
      .trg-flow-advanced summary{cursor:pointer;user-select:none;}
      .trg-flow-advanced textarea{margin-top:6px;}
      .trg-flow-contract{display:grid;gap:6px;padding:8px;border:1px solid #284262;border-radius:4px;background:#0c1628;}
      .trg-flow-contract>div{display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;font-size:11px;line-height:1.45;}
      .trg-flow-contract b{color:#88b9dd;}
      .trg-flow-contract span{color:#c6d4ed;}
      .trg-flow-output-list{display:grid;gap:8px;margin-top:10px;}
      .trg-flow-output{padding:9px;border:1px solid #2d4a68;border-radius:4px;background:#0d172a;}
      .trg-flow-output-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px;}
      .trg-flow-output-head strong{color:#d7e7ff;font-size:12px;}
      .trg-flow-output-head code{color:#86bce8;font-size:10px;}
      .trg-flow-targets{display:flex;gap:6px;flex-wrap:wrap;}
      .trg-flow-target{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;padding:4px 7px;border:1px solid #496f9c;border-radius:3px;background:#18304d;color:#d8e8ff;cursor:pointer;font-size:11px;}
      .trg-flow-target:hover{border-color:#76b8ef;background:#214568;}
      .trg-flow-target code{color:#8fb4d7;font-size:9px;overflow-wrap:anywhere;}
      .trg-order{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:12px;background:#31598f;color:#fff;font-weight:bold;font-size:11px;flex:0 0 auto;}
      .tsteps{margin-top:4px;color:#7fc6a4;font-size:10px;line-height:1.45;overflow-wrap:anywhere;}
      .trg-inline-options{display:flex;gap:14px;flex-wrap:wrap;align-items:center;}
      .trg-inline-options label{display:flex;align-items:center;gap:4px;margin:0;}
      .trg-coordination-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;}
      .trg-tutorial-step{border:1px solid #2a3a5e;border-radius:4px;padding:9px;margin-bottom:8px;background:#0f1830;}
      .trg-tutorial-step .do-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
      .trg-tutorial-step .do-head strong{flex:1;color:#c9dcff;font-size:12px;}
      .trg-tutorial-step.dragging{opacity:.45;}
      .trg-tutorial-step.drop-before{box-shadow:inset 0 3px 0 #6ea8ff;}
      .trg-tutorial-step.drop-after{box-shadow:inset 0 -3px 0 #6ea8ff;}
      .tutorial-step-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;}
      .tutorial-step-grid label{display:flex;flex-direction:column;gap:3px;margin:0;}
      .tutorial-step-grid label.wide{grid-column:1 / -1;}
      .tutorial-step-grid label.check{display:flex;flex-direction:row;align-items:center;}
      .trg-empty.compact{padding:12px;}
      .trg-empty{color:#778;padding:40px;text-align:center;}
      .trg-status{padding:6px 16px;font-size:12px;min-height:22px;background:#0a1020;}
      .trg-status.ok{color:#6c6;} .trg-status.err{color:#e66;}
      .trg-mini{padding:4px 8px;background:#3a4a7e;border:none;border-radius:3px;color:#fff;cursor:pointer;font-size:12px;}
      .trg-do-item.trg-do-branch{border-color:#4a5d9e;background:#121c38;}
      .trg-do-branch > .do-head{background:#182648;border-radius:3px;padding:6px;}
      .do-branch-label{color:#c6d4f0;font-weight:bold;font-size:12px;flex:0 0 auto;}
      .do-branch{margin:6px 0;display:flex;flex-direction:column;gap:6px;}
      .do-branch-item{border:1px dashed #3a4a7e;border-radius:4px;padding:8px;background:#0c162b;}
      .do-branch-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;}
      .do-branch-title{color:#80b9ed;font-size:11px;font-weight:bold;}
      .do-branch-otherwise{display:flex;align-items:center;gap:4px;margin:0 0 0 auto;color:#e8c46a;font-size:11px;}
      .do-branch-otherwise input{width:auto;}
      .do-branch-when{width:100%;box-sizing:border-box;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:6px;border-radius:3px;font-family:monospace;font-size:12px;min-height:44px;margin-bottom:6px;resize:vertical;}
      .do-branch-empty{color:#5a6a8a;font-size:11px;padding:2px 0 6px;}
      .do-branch-do{margin-top:4px;}
      .do-branch-add-step{margin:4px 0 0 16px;}
      .do-add-branch{margin-top:6px;}
      .do-step-if{margin-top:7px;color:#91a8cc;font-size:11px;}
      .do-step-if summary{cursor:pointer;user-select:none;}
      .do-step-if-input{width:100%;box-sizing:border-box;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:6px;border-radius:3px;font-family:monospace;font-size:12px;min-height:44px;margin-top:6px;resize:vertical;}
      .do-if-summary{color:#9ab6e0;font-size:11px;}
      .do-step-if-form{background:#101a30;border:1px solid #24345c;border-radius:4px;padding:8px;margin-top:6px;}
      .do-step-if-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;}
      .do-step-if-row label{display:flex;flex-direction:column;gap:3px;color:#93a8cc;font-size:11px;min-width:120px;}
      .do-step-if-row input,.do-step-if-row select{background:#1a2440;color:#dbe6ff;border:1px solid #2f4168;border-radius:3px;padding:5px 8px;font-size:12px;}
      .do-step-if-raw{margin-top:6px;}
      .hidden{display:none !important;}
      .do-cond-nested{background:#16213e;border:1px solid #3a4a7e;border-radius:4px;padding:8px;margin-top:6px;}
      .do-cond-nested-note{color:#e8a24a;font-size:11px;margin-bottom:6px;}
      .do-cond-nested textarea{width:100%;box-sizing:border-box;background:#0a1020;border:1px solid #2a3a5e;color:#fff;padding:6px;border-radius:3px;font-family:monospace;font-size:12px;min-height:64px;resize:vertical;}
      .do-await{display:flex;align-items:center;gap:5px;margin:7px 0 0;color:#7fc6a4;font-size:11px;}
      .do-await input{width:auto;}
    `;
    document.head.appendChild(s);
  }

  _status(msg, kind) {
    const el = this.container.querySelector('#trg-status');
    if (el) { el.textContent = msg; el.className = 'trg-status ' + (kind || ''); }
  }

  // ---- 列表 ----

  _buildSceneAssociationIndex() {
    const byScene = new Map();
    let documents = [];
    try {
      const source = this.getSceneDocuments();
      documents = Array.isArray(source) ? source : Object.values(source || {});
    } catch (error) {
      console.warn('TriggerEditor: 获取 canonical 场景文档失败', error);
    }
    for (const scene of documents) {
      const sceneId = String(scene?.id || '').trim();
      if (!sceneId) continue;
      const bindingsByTrigger = new Map();
      for (const layer of scene.layers || []) {
        for (const binding of layer?.objects || []) {
          const triggerId = binding?.type === 'trigger' ? String(binding.triggerId || '').trim() : '';
          if (!triggerId) continue;
          let names = bindingsByTrigger.get(triggerId);
          if (!names) {
            names = new Set();
            bindingsByTrigger.set(triggerId, names);
          }
          const bindingName = String(binding.name || binding.id || '').trim();
          if (bindingName) names.add(bindingName);
        }
      }
      byScene.set(sceneId, bindingsByTrigger);
    }
    return byScene;
  }

  _getTriggerAssociation(trigger, sceneId, associationIndex) {
    const spatial = associationIndex.get(sceneId)?.has(trigger?.id) === true;
    const condition = trigger?.when?.params?.sceneId === sceneId;
    const editorScope = Array.isArray(trigger?.editorScope?.sceneIds)
      && trigger.editorScope.sceneIds.includes(sceneId);
    return {
      spatial,
      condition,
      editorScope,
      associated: spatial || condition || editorScope
    };
  }

  _getSpatialBindingNames(triggerId, sceneId, associationIndex) {
    if (sceneId) return [...(associationIndex.get(sceneId)?.get(triggerId) || [])];
    const names = [];
    for (const [boundSceneId, bindingsByTrigger] of associationIndex) {
      for (const name of bindingsByTrigger.get(triggerId) || []) names.push(`${boundSceneId} · ${name}`);
    }
    return names;
  }

  _renderAssociationSummary(sceneId, associationIndex) {
    const summary = this.container.querySelector('#trg-association-summary');
    if (!summary) return;
    if (this.target === 'tutorials') {
      const visible = sceneId
        ? this.triggers.filter(definition => definition.scope?.sceneIds?.includes(sceneId)).length
        : this.triggers.length;
      summary.textContent = `${sceneId || '全部场景'}：${visible} 个 Tutorial；展示顺序由 Trigger 事件链显式编排，只在详情中调整 steps[]。`;
      return;
    }
    if (!sceneId) {
      summary.textContent = `全部 Trigger ${this.triggers.length} 个；场景关联按空间 binding、场景条件和编辑器归属合并。`;
      return;
    }
    const stats = { spatial: 0, condition: 0, editorScope: 0, total: 0 };
    for (const trigger of this.triggers) {
      const association = this._getTriggerAssociation(trigger, sceneId, associationIndex);
      if (association.spatial) stats.spatial++;
      if (association.condition) stats.condition++;
      if (association.editorScope) stats.editorScope++;
      if (association.associated) stats.total++;
    }
    summary.textContent = `${sceneId}：空间绑定 ${stats.spatial}，场景条件 ${stats.condition}，编辑归属 ${stats.editorScope}，合并后 ${stats.total} 个关联 Trigger。`;
  }

  _moveTrigger(source, target, placeAfter) {
    if (!source || !target || source === target) return false;
    const selected = this.triggers[this.selectedIndex] || null;
    const sourceIndex = this.triggers.indexOf(source);
    if (sourceIndex < 0 || !this.triggers.includes(target)) return false;

    // 搬运完整定义对象，保留 action 稳定 ID、policy 和 unknown-but-allowed 字段。
    this.triggers.splice(sourceIndex, 1);
    const targetIndex = this.triggers.indexOf(target);
    this.triggers.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
    this.project[this.target] = this.triggers;
    this.projectIndex = new TriggerProjectIndex(this.project, { sceneDocuments: this._getSceneDocuments() });
    this.selectedIndex = selected ? this.triggers.indexOf(selected) : -1;
    this._status(`已调整 ${source.name || source.id || '定义'} 的顺序，请保存到工程`, 'ok');
    this._renderList();
    this._renderDetail();
    return true;
  }

  _renderTutorialList(list, filterScene) {
    const definitions = this.triggers
      .filter(tutorial => !filterScene || tutorial.scope?.sceneIds?.includes(filterScene))
      .slice();
    if (!definitions.length) {
      list.innerHTML = '<div class="trg-empty">无匹配的 Tutorial</div>';
      return;
    }
    list.innerHTML = '';
    definitions.forEach(tutorial => {
      const definitionIndex = this.triggers.indexOf(tutorial);
      const item = document.createElement('div');
      item.className = `trg-item tutorial${definitionIndex === this.selectedIndex ? ' active' : ''}`;
      item.title = 'Tutorial 展示顺序由 Trigger 事件链显式编排；请在右侧拖动内部 steps[]';
      const stepSummary = (tutorial.steps || []).map((step, stepIndex) => `${stepIndex + 1}.${step.text || step.id || '?'}`).join(' → ');
      item.innerHTML = `<div class="trg-item-copy"><div class="tname">${this._escapeHtml(tutorial.title || tutorial.id)}</div><div class="tid">${this._escapeHtml(tutorial.id || '(未命名)')}</div><div class="twhen">priority ${Number(tutorial.priority || 0)}</div><div class="tsteps">${this._escapeHtml(stepSummary || '无 steps[]')}</div></div>`;
      item.addEventListener('click', () => {
        this._commitDetail();
        this.selectedIndex = definitionIndex;
        this._renderList();
        this._renderDetail();
      });
      list.appendChild(item);
    });
  }

  _renderList() {
    const list = this.container.querySelector('#trg-list');
    if (!list) return;

    const filterEnabled = this.container.querySelector('#trg-filter-enabled')?.value || '';
    const filterScene = this.container.querySelector('#trg-filter-scene')?.value || '';
    const filterTriggerId = text(this.container.querySelector('#trg-filter-event')?.value || '');
    const filterWhen = this.container.querySelector('#trg-filter-when')?.value || '';
    const filterDo = this.container.querySelector('#trg-filter-do')?.value || '';
    const associationIndex = this._buildSceneAssociationIndex();

    this._updateSceneFilter();
    this._updateTriggerFilter();
    this._renderAssociationSummary(filterScene, associationIndex);
    if (this.target === 'tutorials') {
      this._renderTutorialList(list, filterScene);
      return;
    }

    const filtered = this.triggers.filter((trigger) => {
      if (filterTriggerId && trigger.id !== filterTriggerId) return false;
      if (filterEnabled === 'enabled' && trigger.enabled === false) return false;
      if (filterEnabled === 'disabled' && trigger.enabled !== false) return false;
      if (filterScene && !this._getTriggerAssociation(trigger, filterScene, associationIndex).associated) return false;
      if (filterWhen && trigger.when?.type !== filterWhen) return false;
      if (filterDo) {
        const doList = Array.isArray(trigger.do) ? trigger.do : [];
        if (!doList.some(action => (action.action || action.type || action) === filterDo)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="trg-empty">无匹配的触发器</div>';
      return;
    }
    list.innerHTML = '';
    let draggedTrigger = null;
    const clearDropIndicators = () => {
      list.querySelectorAll('.trg-item').forEach(element => {
        element.classList.remove('drop-before', 'drop-after');
        delete element.dataset.dropPosition;
      });
    };
    filtered.forEach((trigger) => {
      const index = this.triggers.indexOf(trigger);
      const item = document.createElement('div');
      const disabled = trigger.enabled === false;
      item.className = 'trg-item' + (index === this.selectedIndex ? ' active' : '') + (disabled ? ' disabled' : '');
      item.draggable = true;
      item.title = '拖动调整触发器定义顺序；同协调组同优先级时按此顺序稳定执行';
      const whenLabel = (WHEN_TYPES.find(event => event.v === trigger.when?.type) || {}).label || trigger.when?.type || '?';
      const priority = Number.isInteger(trigger.coordination?.priority) ? trigger.coordination.priority : 0;
      const coordinationLabel = trigger.coordination?.group
        ? `${trigger.coordination.group} · ${trigger.coordination.policy || 'broadcast'} · priority ${priority}`
        : `独立 · priority ${priority}`;
      const definitionOrder = this.project.triggers.indexOf(trigger) + 1;
      const statusIcon = disabled ? '⏸' : '▶';
      const association = filterScene ? this._getTriggerAssociation(trigger, filterScene, associationIndex) : null;
      const origins = association ? [
        association.spatial ? '空间' : '',
        association.condition ? '条件' : '',
        association.editorScope ? '归属' : ''
      ].filter(Boolean) : [];
      const originHtml = origins.length
        ? `<span class="trg-origin" title="场景关联来源：${origins.join('、')}">${origins.join('+')}</span>`
        : '';
      const bindingNames = this._getSpatialBindingNames(trigger.id, filterScene, associationIndex);
      const bindingNamesHtml = bindingNames.length
        ? `<div class="tbinding-name" title="场景事件名称">${bindingNames.map(name => this._escapeHtml(name)).join(' / ')}</div>`
        : '';
      const triggerName = String(trigger.name || '').trim();
      const nameHtml = triggerName
        ? `<div class="tname">${this._escapeHtml(triggerName)}</div>`
        : '';
      item.innerHTML = `<span class="trg-status" data-toggle="${index}">${statusIcon}</span><div class="trg-item-copy">${nameHtml}<div class="tid">${this._escapeHtml(trigger.id || '(未命名)')}</div>${bindingNamesHtml}<div class="twhen">when: ${this._escapeHtml(whenLabel)} · ${this._escapeHtml(coordinationLabel)} · 定义序 ${definitionOrder}</div></div>${originHtml}`;
      item.addEventListener('dragstart', (event) => {
        this._commitDetail();
        draggedTrigger = trigger;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', trigger.id || String(index));
        requestAnimationFrame(() => item.classList.add('dragging'));
      });
      item.addEventListener('dragover', (event) => {
        if (!draggedTrigger || draggedTrigger === trigger) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const placeAfter = event.clientY >= item.getBoundingClientRect().top + item.offsetHeight / 2;
        clearDropIndicators();
        item.dataset.dropPosition = placeAfter ? 'after' : 'before';
        item.classList.add(placeAfter ? 'drop-after' : 'drop-before');
      });
      item.addEventListener('dragleave', (event) => {
        if (!item.contains(event.relatedTarget)) {
          item.classList.remove('drop-before', 'drop-after');
          delete item.dataset.dropPosition;
        }
      });
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        const placeAfter = item.dataset.dropPosition === 'after';
        const source = draggedTrigger;
        draggedTrigger = null;
        clearDropIndicators();
        this._moveTrigger(source, trigger, placeAfter);
      });
      item.addEventListener('dragend', () => {
        draggedTrigger = null;
        item.classList.remove('dragging');
        clearDropIndicators();
      });
      item.querySelector('.trg-status').addEventListener('click', (event) => {
        event.stopPropagation();
        this._commitDetail();
        trigger.enabled = trigger.enabled === false ? undefined : false;
        if (trigger.enabled === undefined) delete trigger.enabled;
        this._renderList();
        this._renderDetail();
      });
      item.addEventListener('click', () => {
        this._commitDetail();
        this.selectedIndex = index;
        this._renderList();
        this._renderDetail();
      });
      list.appendChild(item);
    });
  }

  /** 动态更新场景筛选下拉选项。 */
  _updateSceneFilter() {
    const select = this.container.querySelector('#trg-filter-scene');
    if (!select) return;
    const currentValue = select.value;
    const scenes = new Map();
    try {
      for (const scene of this.getSceneList()) {
        if (scene?.id) scenes.set(scene.id, scene.name || scene.id);
      }
    } catch (e) {
      console.warn('TriggerEditor: 获取场景列表失败', e);
    }

    // 保留三层定义中的旧场景引用，避免切换编辑目标或保存时静默抹掉历史 scope。
    for (const definition of this.triggers) {
      const referencedSceneIds = this.target === 'tutorials'
        ? [...(Array.isArray(definition.scope?.sceneIds) ? definition.scope.sceneIds : [])]
        : [
            definition.when?.params?.sceneId,
            ...(Array.isArray(definition.editorScope?.sceneIds) ? definition.editorScope.sceneIds : [])
          ];
      for (const sceneId of referencedSceneIds) {
        if (sceneId && !scenes.has(sceneId)) scenes.set(sceneId, `${sceneId}（旧引用）`);
      }
    }

    let options = '<option value="">全部场景关联</option>';
    for (const [sceneId, sceneName] of scenes) {
      const selected = sceneId === currentValue ? 'selected' : '';
      options += `<option value="${this._escapeHtml(sceneId)}" ${selected}>${this._escapeHtml(sceneName)}</option>`;
    }
    select.innerHTML = options;
  }

  /** 场景编辑器增删改场景后调用，保持当前筛选值并重绘触发器列表。 */
  refreshSceneList() {
    if (this._initialized) this._renderList();
  }

  _getItemPlacementOptions() {
    try {
      return (this.getPlacementOptions() || []).filter(placement =>
        placement?.type === 'ref' && placement.kind === 'item' && placement.id
      );
    } catch (error) {
      console.warn('TriggerEditor: 获取场景放置物品失败', error);
      return [];
    }
  }

  _normalizeSpawnPlacementParams(params = {}) {
    const selector = params.selector || params;
    const placementId = Array.isArray(selector.placementIds)
      ? selector.placementIds[0] || ''
      : selector.placementId || '';
    const group = String(selector.group || '').trim();
    const tag = Array.isArray(selector.tags)
      ? selector.tags[0] || ''
      : selector.tag || '';
    const mode = placementId ? 'placement' : group ? 'group' : 'tag';
    return {
      mode,
      placementId,
      group,
      tag: String(tag || '').trim(),
      sceneId: String(selector.sceneId || '').trim()
    };
  }

  _readSpawnPlacementParams(item) {
    const rawParams = this._parseJson(item.querySelector('.do-params')?.value || '{}', {});
    const params = rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
      ? rawParams
      : {};
    const hasNestedSelector = params.selector
      && typeof params.selector === 'object'
      && !Array.isArray(params.selector);
    const previousSelector = hasNestedSelector ? params.selector : params;
    const previousSelection = this._normalizeSpawnPlacementParams(params);
    const previousTarget = previousSelection.mode === 'placement'
      ? previousSelection.placementId
      : previousSelection.mode === 'group'
        ? previousSelection.group
        : previousSelection.tag;

    const mode = item.querySelector('.spawn-placement-mode')?.value || 'placement';
    const targetElement = item.querySelector('.spawn-placement-target');
    const target = targetElement?.value || '';

    // 仅打开并保存时返回完整原参数，禁止补写 sceneId/kinds 或丢失扩展字段。
    if (mode === previousSelection.mode && target === previousTarget) return params;

    const selector = { ...previousSelector };
    const hadSelectorContent = Object.keys(previousSelector).length > 0;
    delete selector.placementId;
    delete selector.placementIds;
    delete selector.group;
    delete selector.tag;
    delete selector.tags;
    if (mode === 'placement') selector.placementIds = target ? [target] : [];
    else if (mode === 'group') selector.group = target;
    else selector.tag = target;
    if (!hadSelectorContent && !Object.prototype.hasOwnProperty.call(selector, 'kinds')) {
      selector.kinds = ['item'];
    }

    return hasNestedSelector ? { ...params, selector } : selector;
  }

  _renderSpawnPlacementControls(params = {}) {
    const selection = this._normalizeSpawnPlacementParams(params);
    const items = this._getItemPlacementOptions();
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const sceneId = selection.sceneId || items[0]?.sceneId || '';
    const buildOptions = (entries, selected, emptyText) => {
      const options = entries.map(({ value, label, optionSceneId = sceneId }) =>
        `<option value="${escape(value)}" data-scene-id="${escape(optionSceneId)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`
      );
      if (selected && !entries.some(entry => entry.value === selected)) {
        options.unshift(`<option value="${escape(selected)}" data-scene-id="${escape(sceneId)}" selected>${escape(selected)}（当前场景未找到）</option>`);
      }
      return options.length ? options.join('') : `<option value="">${emptyText}</option>`;
    };
    const placementEntries = items.map(item => ({
      value: item.id,
      label: `${item.name || item.ref || item.id} · ${item.id}`,
      optionSceneId: item.sceneId || sceneId
    }));
    const groupEntries = [...new Map(items.filter(item => item.group).map(item => [item.group, {
      value: item.group,
      label: `${item.group}（${item.name || item.ref || item.id}）`,
      optionSceneId: item.sceneId || sceneId
    }])).values()];
    const tagEntries = [...new Map(items.flatMap(item => {
      const tags = Array.isArray(item.tags) ? item.tags : String(item.tags || '').split(',');
      return tags.map(tag => tag.trim()).filter(Boolean).map(tag => [tag, {
        value: tag,
        label: `${tag}（${item.name || item.ref || item.id}）`,
        optionSceneId: item.sceneId || sceneId
      }]);
    })).values()];
    const targetEntries = selection.mode === 'group' ? groupEntries : selection.mode === 'tag' ? tagEntries : placementEntries;
    const selectedTarget = selection.mode === 'group' ? selection.group : selection.mode === 'tag' ? selection.tag : selection.placementId;
    return `
      <div class="spawn-placement-controls">
        <label>放置目标</label>
        <select class="spawn-placement-mode">
          <option value="placement" ${selection.mode === 'placement' ? 'selected' : ''}>指定物品</option>
          <option value="group" ${selection.mode === 'group' ? 'selected' : ''}>按组名</option>
          <option value="tag" ${selection.mode === 'tag' ? 'selected' : ''}>按标签</option>
        </select>
        <select class="spawn-placement-target">${buildOptions(targetEntries, selectedTarget, '请先在场景编辑器打开含物品的场景')}</select>
        <div class="spawn-placement-hint">仅列出当前打开场景中的放置物品；组名或标签会批量放置所有匹配物品。</div>
      </div>`;
  }

  _nextActionStepId(trigger) {
    const ids = new Set();
    const walk = steps => (steps || []).forEach(action => {
      const stepId = String(action?.stepId || '').trim();
      if (stepId) ids.add(stepId);
      if (Array.isArray(action?.branch)) action.branch.forEach(branch => walk(branch?.do));
    });
    walk(Array.isArray(trigger?.do) ? trigger.do : []);
    const prefix = `${String(trigger?.id || 'trigger').trim() || 'trigger'}.step`;
    let sequence = 1;
    let candidate;
    do candidate = `${prefix}.${String(sequence++).padStart(3, '0')}`;
    while (ids.has(candidate));
    return candidate;
  }

  _formatResultSemantics(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    const labels = { success: '成功', blocked: '已处理/阻断', failure: '失败', retry: '重试', sequence: '序列' };
    return Object.entries(value)
      .map(([key, description]) => `${labels[key] || key}：${String(description)}`)
      .join('；');
  }

  _renderStructuredParams(schema, params = {}, { excludeOperation = false, excludeNames = [] } = {}) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return '';
    const excluded = new Set(excludeNames);
    const properties = Object.entries(schema.properties || {})
      .filter(([name]) => (!excludeOperation || name !== 'operation') && !excluded.has(name));
    if (!properties.length) return '';
    const required = new Set(schema.required || []);
    const rows = properties.map(([name, property = {}]) => {
      const value = params?.[name];
      const type = property.type || (Array.isArray(value) ? 'array' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value === 'object' && value !== null ? 'object' : 'string');
      const label = property.title || property.label || name;
      const description = property.description ? ` title="${this._escapeHtml(property.description)}"` : '';
      const requiredMark = required.has(name) ? ' *' : '';
      let control;
      if (Array.isArray(property.enum)) {
        const options = [!required.has(name) ? '<option value="">-- 未设置 --</option>' : '', ...property.enum.map(option => (
          `<option value="${this._escapeHtml(option)}"${option === value ? ' selected' : ''}>${this._escapeHtml(option)}</option>`
        ))].join('');
        control = `<select class="do-param-field" data-param-name="${this._escapeHtml(name)}" data-schema-type="${this._escapeHtml(type)}">${options}</select>`;
      } else if (type === 'boolean') {
        control = `<select class="do-param-field" data-param-name="${this._escapeHtml(name)}" data-schema-type="boolean"><option value=""${value === undefined ? ' selected' : ''}>-- 未设置 --</option><option value="true"${value === true ? ' selected' : ''}>true</option><option value="false"${value === false ? ' selected' : ''}>false</option></select>`;
      } else if (type === 'object' || type === 'array') {
        control = `<textarea class="do-param-field do-param-json" data-param-name="${this._escapeHtml(name)}" data-schema-type="${type}">${value === undefined ? '' : this._escapeHtml(JSON.stringify(value))}</textarea>`;
      } else {
        const inputType = type === 'number' || type === 'integer' ? 'number' : 'text';
        const step = type === 'integer' ? ' step="1"' : type === 'number' ? ' step="any"' : '';
        control = `<input type="${inputType}"${step} class="do-param-field" data-param-name="${this._escapeHtml(name)}" data-schema-type="${this._escapeHtml(type)}" value="${this._escapeHtml(value ?? '')}">`;
      }
      return `<label${description}><span>${this._escapeHtml(label)}${requiredMark}</span>${control}</label>`;
    }).join('');
    return `<div class="do-structured-params"><div class="do-section-title">结构化参数</div><div class="do-param-grid">${rows}</div></div>`;
  }

  _readStructuredParams(item, params = {}) {
    const next = { ...(params || {}) };
    item.querySelectorAll('.do-param-field').forEach(element => {
      const name = element.dataset.paramName;
      const type = element.dataset.schemaType || 'string';
      const raw = element.value.trim();
      if (!name) return;
      if (!raw) {
        delete next[name];
        return;
      }
      if (type === 'boolean') next[name] = raw === 'true';
      else if (type === 'integer') next[name] = Number.parseInt(raw, 10);
      else if (type === 'number') next[name] = Number(raw);
      else if (type === 'object' || type === 'array') next[name] = this._parseJson(raw, next[name]);
      else next[name] = raw;
    });
    return next;
  }

  _doActionOptions(act) {
    let actOpts = ACTION_TYPES.map(actionType => (
      `<option value="${this._escapeHtml(actionType.v)}" ${act.action === actionType.v ? 'selected' : ''}>${this._escapeHtml(actionType.label)} (${this._escapeHtml(actionType.v)})</option>`
    )).join('');
    // 保留下拉里没有的自定义 action，避免 unknown-but-allowed 字段在 round-trip 时丢失。
    if (act.action && !ACTION_TYPES.some(actionType => actionType.v === act.action)) {
      actOpts = `<option value="${this._escapeHtml(act.action)}" selected>自定义: ${this._escapeHtml(act.action)}</option>` + actOpts;
    }
    return actOpts;
  }

  /**
   * 递归渲染一个步骤：普通动作 或 分支容器。
   * path 形如 "2" 或 "1.0.3"（父路径.branchIndex.子下标），与 TriggerStorylinePanel 同约定。
   */
  _renderDoItem(act, path, depth) {
    const trigger = this.triggers[this.selectedIndex] || null;
    const indent = depth > 0 ? `style="margin-left:${Math.min(depth, 6) * 16}px"` : '';
    const isBranch = Array.isArray(act?.branch);
    const head = `
      <div class="do-head">
        <button type="button" class="do-drag-handle" draggable="true" title="拖动调整同层步骤顺序" aria-label="拖动步骤 ${this._escapeHtml(path)}">↕</button>
        ${isBranch
          ? `<strong class="do-branch-label">🔀 分支容器</strong><input type="text" class="do-step-id" value="${this._escapeHtml(act.stepId || '')}" placeholder="stepId（可空）">`
          : `<select class="do-action">${this._doActionOptions(act)}</select>`}
        <button type="button" class="trg-mini do-del" title="删除此步骤">删</button>
      </div>`;
    if (isBranch) {
      const branches = Array.isArray(act.branch) ? act.branch : [];
      return `
        <div class="trg-do-item trg-do-branch" data-path="${this._escapeHtml(path)}" ${indent}>
          ${head}
          <div class="do-branch">
            ${branches.map((branch, bIndex) => {
              const branchPath = `${path}.${bIndex}`;
              const children = Array.isArray(branch?.do) ? branch.do : [];
              return `
                <div class="do-branch-item" data-branch-index="${bIndex}">
                  <div class="do-branch-head">
                    <span class="do-branch-title">分支 ${bIndex + 1}</span>
                    <label class="do-branch-otherwise"><input type="checkbox" class="do-branch-otherwise-cb"${branch.otherwise ? ' checked' : ''}> otherwise 兜底</label>
                    <button type="button" class="trg-mini do-branch-del" title="删除此分支">✕</button>
                  </div>
                  ${branch.otherwise ? '' : `<div class="do-branch-when-wrap"><div class="do-branch-when-title">🛡 分支条件 when（满足才进入此分支）</div>${this._renderConditionForm(branch.when, { textareaClass: 'do-branch-when', emptyLabel: '（无条件）' })}</div>`}
                  <div class="do-branch-do">
                    ${children.length
                      ? children.map((child, cIndex) => this._renderDoItem(child, `${branchPath}.${cIndex}`, depth + 1)).join('')
                      : '<div class="do-branch-empty">（空分支，可在此追加子步骤）</div>'}
                    <button type="button" class="trg-mini do-branch-add-step" data-branch-do="${this._escapeHtml(branchPath)}">+ 子步骤</button>
                  </div>
                </div>`;
            }).join('')}
          </div>
          <button type="button" class="trg-mini do-add-branch" data-path="${this._escapeHtml(path)}">+ 添加分支</button>
        </div>`;
    }
    const descriptor = getTriggerActionDescriptor(act.action, this.project);
    const operations = getTriggerActionOperations(act.action, this.project);
    const operationId = String(act.params?.operation || '').trim();
    const operation = getTriggerActionOperation(act.action, operationId, this.project);
    let operationOptions = operations.map(candidate => (
      `<option value="${this._escapeHtml(candidate.value)}"${candidate.value === operationId ? ' selected' : ''}>${this._escapeHtml(candidate.label)} (${this._escapeHtml(candidate.value)})</option>`
    )).join('');
    if (operationId && !operations.some(candidate => candidate.value === operationId)) {
      operationOptions = `<option value="${this._escapeHtml(operationId)}" selected>未登记: ${this._escapeHtml(operationId)}</option>` + operationOptions;
    }
    const operationEditor = operations.length || operationId
      ? `<label>Operation<select class="do-operation"><option value="">-- 选择 operation --</option>${operationOptions}</select></label>`
      : '';
    const paramsSchema = operation?.paramsSchema || descriptor?.paramsSchema;
    const structuredParams = this._renderStructuredParams(
      paramsSchema,
      act.params || {},
      {
        excludeOperation: operations.length > 0,
        excludeNames: act.action === 'tutorial.command' ? ['await'] : []
      }
    );
    const rawParamsEditor = act.action === 'spawnPlacements'
      ? `${this._renderSpawnPlacementControls(act.params)}<textarea class="do-params" style="display:none">${this._escapeHtml(this._json(act.params))}</textarea>`
      : `${structuredParams}<details class="do-advanced"${structuredParams ? '' : ' open'}><summary>高级 JSON／未登记参数</summary><textarea class="do-params" placeholder='params JSON，如 {"id":"dlg1"}'>${this._escapeHtml(this._json(act.params))}</textarea></details>`;
    const semantics = this._formatResultSemantics(operation?.resultSemantics || descriptor?.resultSemantics);
    const ifEditor = this._renderStepIfEditor(act, path);
    const awaitEditor = act.action === 'tutorial.command' && operationId === 'show'
      ? `<label class="do-await"><input type="checkbox" class="do-await-cb"${act.params?.await ? ' checked' : ''}> ⏳ 串行等待（教程结束后再执行下一步）</label>`
      : '';
    return `
      <div class="trg-do-item" data-path="${this._escapeHtml(path)}" ${indent}>
        ${head}
        <div class="do-identity-grid">
          <label>稳定 stepId<input type="text" class="do-step-id" value="${this._escapeHtml(act.stepId || '')}" placeholder="${this._escapeHtml(this._nextActionStepId(trigger))}"></label>
          ${operationEditor}
        </div>
        ${semantics ? `<div class="do-result-semantics">结果语义：${this._escapeHtml(semantics)}</div>` : ''}
        ${rawParamsEditor}
        ${ifEditor}
        ${awaitEditor}
      </div>`;
  }

  /** 判断是否嵌套/复合条件（and/or/not 含子条件，或非表单可承载的结构）。 */
  _isNestedCondition(condition) {
    if (!condition || typeof condition !== 'object') return false;
    const op = condition.op;
    if (op === 'and' || op === 'or' || op === 'not') return true; // 需 args[]/arg
    if (condition.args || condition.arg) return true; // 显式嵌套
    return false;
  }

  /** 通用条件可视化编辑器：扁平条件用表单；嵌套/复合条件降级为只读 JSON（避免静默破坏结构）。 */
  _renderConditionForm(condition, opts = {}) {
    const escape = value => this._escapeHtml(value);
    const textareaClass = opts.textareaClass || 'do-step-if-input';
    if (this._isNestedCondition(condition)) {
      return `
        <div class="do-cond-form do-cond-nested">
          <div class="do-cond-nested-note">🧩 嵌套条件（and/or/not 组合），请在下方 JSON 中编辑以避免破坏结构</div>
          <textarea class="${textareaClass}" placeholder='条件 (JSON)'>${this._escapeHtml(this._json(condition))}</textarea>
        </div>`;
    }
    const ops = [
      { value: '==', label: '等于' },
      { value: '!=', label: '不等于' },
      { value: '>', label: '大于' },
      { value: '>=', label: '大于等于' },
      { value: '<', label: '小于' },
      { value: '<=', label: '小于等于' },
      { value: 'hasItem', label: '持有物品' }
    ];
    const currentOp = condition?.op || '';
    const currentVar = text(condition?.var ?? condition?.flag ?? condition?.left?.var ?? '');
    const rawValue = condition?.value !== undefined
      ? condition.value
      : (condition?.right !== undefined ? condition.right : '');
    const currentValue = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
    const currentItem = condition?.item || '';
    const currentCount = condition?.count ?? 1;
    const hasItem = currentOp === 'hasItem';
    const emptyLabel = opts.emptyLabel || '（无条件，总是执行）';
    const opOptions = `<option value="">${escape(emptyLabel)}</option>`
      + ops.map(o => `<option value="${o.value}"${currentOp === o.value ? ' selected' : ''}>${o.label} (${o.value})</option>`).join('');
    const summary = !condition
      ? emptyLabel
      : hasItem
        ? `持有 ${escape(currentItem || '?')} ×${escape(currentCount)}`
        : `${escape(currentOp)} ${escape(currentVar)} ${escape(currentValue)}`;
    return `
      <div class="do-cond-form">
        <div class="do-step-if-row">
          <label>操作 <select class="do-if-op">${opOptions}</select></label>
          <label class="do-if-var-wrap${hasItem ? ' hidden' : ''}">变量 <input type="text" class="do-if-var" value="${escape(currentVar)}" placeholder="如 story.xxx 或 hp"></label>
          <label class="do-if-value-wrap${hasItem ? ' hidden' : ''}">值 <input type="text" class="do-if-value" value="${escape(currentValue)}" placeholder="如 true / 0 / &quot;text&quot;"></label>
          <label class="do-if-item-wrap${hasItem ? '' : ' hidden'}">物品 <input type="text" class="do-if-item" value="${escape(currentItem)}" placeholder="如 resource.wild_berry"></label>
          <label class="do-if-count-wrap${hasItem ? '' : ' hidden'}">数量 <input type="number" min="1" step="1" class="do-if-count" value="${escape(currentCount)}"></label>
        </div>
        <details class="do-step-if-raw">
          <summary>高级 JSON</summary>
          <textarea class="${textareaClass}" placeholder='条件 (JSON)'>${this._escapeHtml(this._json(condition))}</textarea>
        </details>
      </div>`;
  }

  /** 步骤级 if 编辑器（复用通用条件表单）。 */
  _renderStepIfEditor(act, path) {
    const escape = value => this._escapeHtml(value);
    const summary = !act.if
      ? '（无条件，总是执行）'
      : this._isNestedCondition(act.if)
        ? `🧩 嵌套条件（${escape(act.if?.op || '复合')}）`
        : act.if?.op === 'hasItem'
          ? `持有 ${escape(act.if.item || '?')} ×${escape(act.if.count ?? 1)}`
          : `${escape(act.if?.op || '')} ${escape(text(act.if?.var ?? act.if?.flag ?? act.if?.left?.var ?? ''))} ${escape(act.if?.value !== undefined ? (typeof act.if.value === 'string' ? act.if.value : JSON.stringify(act.if.value)) : '')}`;
    return `
      <details class="do-step-if"${act.if ? ' open' : ''}>
        <summary>🛡 前置条件 <span class="do-if-summary">${summary}</span></summary>
        ${this._renderConditionForm(act.if, { textareaClass: 'do-step-if-input' })}
      </details>`;
  }

  _renderEventIdentities(event) {
    const identities = Array.isArray(event?.identities) ? event.identities : [];
    if (!identities.length) {
      return '<span class="trg-flow-empty-id">无身份参数（仅按事件类型监听）</span>';
    }
    return identities.map(identity => `
      <span class="trg-flow-id${identity.missing ? ' missing' : ''}">
        <b>${this._escapeHtml(identity.field)}</b>
        <code>${this._escapeHtml(identity.displayValue)}</code>
      </span>`).join('');
  }

  _renderCompletionFlow(flow) {
    if (!flow) return '';
    const outputs = flow.outputs.map((output, index) => {
      const source = output.source?.kind === 'automatic'
        ? 'TriggerSystem 自动发布'
        : [output.source?.stepId || output.source?.path, output.source?.actionName, output.source?.operationName]
          .filter(Boolean).join(' · ');
      const condition = output.condition === 'triggerSucceeded'
        ? '所有实际执行步骤成功后'
        : output.condition === 'committed'
          ? '动作实际提交（committed=true）后'
          : `动作结果为 ${output.condition} 后`;
      const targets = output.targets.length
        ? output.targets.map(target => `<button type="button" class="trg-flow-target" data-next-trigger="${this._escapeHtml(target.id)}">${this._escapeHtml(target.name)}<code>${this._escapeHtml(target.id)}</code></button>`).join('')
        : '<span class="trg-flow-unconnected">未连接下游 Trigger</span>';
      const connectionLabel = output.connectionStatus === 'ambiguous'
        ? `<span class="trg-flow-warning">多重连接：${output.targets.length} 个 Trigger 都会匹配</span>`
        : output.connectionStatus === 'connected'
          ? '<span class="trg-flow-connected">已连接</span>'
          : '<span class="trg-flow-warning">未连接</span>';
      return `
        <div class="trg-flow-output" data-output-index="${index}">
          <div class="trg-flow-output-head"><strong>${this._escapeHtml(output.name)}</strong><code>${this._escapeHtml(output.type)}</code>${connectionLabel}</div>
          <div class="trg-flow-meta"><span>事件 ID</span><div class="trg-flow-identities">${this._renderEventIdentities(output)}</div></div>
          <div class="trg-flow-meta"><span>发布条件</span><div>${this._escapeHtml(condition)}</div></div>
          <div class="trg-flow-meta"><span>来源</span><div>${this._escapeHtml(source || '未知')}</div></div>
          <div class="trg-flow-meta"><span>下游 Trigger</span><div class="trg-flow-targets">${targets}</div></div>
        </div>`;
    }).join('');
    return `
      <section class="trg-flow-card trg-flow-end">
        <div class="trg-flow-card-title"><span>②</span><div><strong>结束与后继</strong><small>只读派生，不保存 next/stage</small></div></div>
        <div class="trg-flow-contract">
          <div><b>准入条件</b><span>${this._escapeHtml(flow.completion.admission)}</span></div>
          <div><b>成功条件</b><span>${this._escapeHtml(flow.completion.success)}</span></div>
          <div><b>条件步骤</b><span>step.if ${flow.completion.stepIfCount} 个；branch ${flow.completion.branchCount} 个</span></div>
        </div>
        <div class="trg-flow-output-list">${outputs || '<div class="trg-flow-unconnected">没有可识别的输出事件</div>'}</div>
      </section>`;
  }

  // ---- 详情表单 ----

  _renderDetail() {
    const panel = this.container.querySelector('#trg-detail');
    if (!panel) return;
    if (this.target === 'storyline') {
      this.triggerStorylinePanel.injectStyles();
      this.triggerStorylinePanel.render(panel);
      return;
    }
    const t = this.triggers[this.selectedIndex];
    if (!t) {
      const labels = {
        triggers: 'Trigger',
        tutorials: 'Tutorial'
      };
      panel.innerHTML = `<div class="trg-empty">选择或新增一个 ${labels[this.target] || '定义'}</div>`;
      return;
    }
    if (this.target === 'tutorials') {
      this.tutorialPanel.render(panel, t);
      return;
    }

    const coordination = t.coordination && typeof t.coordination === 'object' ? t.coordination : {};
    let whenOpts = WHEN_TYPES.map(w =>
      `<option value="${w.v}" ${t.when?.type === w.v ? 'selected' : ''}>${w.label} (${w.v})</option>`).join('');
    // 保留下拉里没有的自定义 when.type（避免编辑保存时被重置丢失）
    if (t.when?.type && !WHEN_TYPES.some(w => w.v === t.when.type)) {
      whenOpts = `<option value="${this._escapeHtml(t.when.type)}" selected>自定义: ${this._escapeHtml(t.when.type)}</option>` + whenOpts;
    }
    const startDescriptor = getTriggerEventDescriptor(t.when?.type, this.project);
    const flow = analyzeTriggerFlow(t, this.project?.triggers || [], this.project);
    const structuredWhenParams = this._renderStructuredParams(startDescriptor?.paramsSchema, t.when?.params || {});
    const startRegistration = flow?.start?.registered
      ? '<span class="trg-flow-connected">已登记事件契约</span>'
      : '<span class="trg-flow-warning">自定义事件未登记：保留原值，但无法校验名称和身份字段</span>';

    // timer 专用间隔输入框（每隔多少秒触发一次）
    const isTimer = t.when?.type === 'timer';
    const timerSec = (t.when?.params && t.when.params.seconds != null) ? t.when.params.seconds : '';
    const timerRow = isTimer
      ? `<div class="row" style="background:#132038;padding:8px;border-radius:4px;border:1px solid #2a4a7e;">
           <label style="color:#7cf;">⏱ 间隔（秒）— 每隔多少秒触发一次</label>
           <input type="text" id="d-timer-seconds" value="${timerSec}" placeholder="如 5 表示每 5 秒触发">
           <div style="color:#89a;font-size:11px;margin-top:4px;">注意：这是循环间隔，不是冷却(cooldown)。会写入 when.params.seconds。</div>
         </div>`
      : '';

    let doHtml = '';
    (t.do || []).forEach((act, di) => {
      doHtml += this._renderDoItem(act, String(di), 0);
    });

    const scopeSceneIds = Array.isArray(t.editorScope?.sceneIds) ? t.editorScope.sceneIds : [];
    const scopeScenes = new Map();
    try {
      for (const scene of this.getSceneList()) {
        if (scene?.id) scopeScenes.set(scene.id, scene.name || scene.id);
      }
    } catch (error) {
      console.warn('TriggerEditor: 获取编辑器归属场景失败', error);
    }
    for (const sceneId of scopeSceneIds) {
      if (!scopeScenes.has(sceneId)) scopeScenes.set(sceneId, `${sceneId}（旧引用）`);
    }
    const scopeOptions = [...scopeScenes].map(([sceneId, sceneName]) => (
      `<option value="${this._escapeHtml(sceneId)}"${scopeSceneIds.includes(sceneId) ? ' selected' : ''}>${this._escapeHtml(sceneName)}</option>`
    )).join('');

    panel.innerHTML = `
      <div class="trg-definition-heading">
        <strong>Trigger 业务规则</strong>
        <span>按 when、coordination.priority、定义顺序执行；do[] 严格串行</span>
      </div>
      <div class="row"><label>ID</label><input type="text" id="d-id" value="${this._escapeHtml(t.id || '')}"></div>
      <div class="row"><label>名称</label><input type="text" id="d-name" value="${this._escapeHtml(t.name || '')}" placeholder="如：第三次添柴后出现首狼"></div>
      <div class="row"><label>协调组 coordination.group（空值表示独立执行）</label><input type="text" id="d-coordination-group" value="${this._escapeHtml(coordination.group || '')}" placeholder="如 s01-survival"></div>
      <div class="row trg-coordination-grid">
        <label>组策略<select id="d-coordination-policy">
          <option value="broadcast"${coordination.policy !== 'firstSuccess' ? ' selected' : ''}>全部执行 (broadcast)</option>
          <option value="firstSuccess"${coordination.policy === 'firstSuccess' ? ' selected' : ''}>首个成功 (firstSuccess)</option>
        </select></label>
        <label>优先级（高值先执行）<input type="number" step="1" id="d-coordination-priority" value="${Number.isInteger(coordination.priority) ? coordination.priority : 0}"></label>
      </div>
      <div class="row"><label>编辑器归属场景（可多选，不改变运行条件）</label><select id="d-editor-scope-scenes" multiple size="${Math.min(6, Math.max(3, scopeScenes.size))}">${scopeOptions}</select></div>
      <div class="row"><label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" id="d-enabled" ${t.enabled !== false ? 'checked' : ''}> 启用</label></div>
      <section class="trg-flow-card trg-flow-start">
        <div class="trg-flow-card-title"><span>①</span><div><strong>开始事件</strong><small>直接编辑运行时 when.type / when.params</small></div>${startRegistration}</div>
        <div class="trg-flow-event-grid">
          <label>事件类型<select id="d-when-type">${whenOpts}</select></label>
          <div class="trg-flow-readonly"><span>事件名称</span><strong>${this._escapeHtml(flow?.start?.name || t.when?.type || '未设置')}</strong></div>
        </div>
        <div class="trg-flow-meta"><span>事件 ID</span><div class="trg-flow-identities">${this._renderEventIdentities(flow?.start)}</div></div>
        <div id="d-when-structured" class="trg-start-params">${structuredWhenParams}</div>
        ${timerRow}
        <details class="trg-flow-advanced"${structuredWhenParams ? '' : ' open'}>
          <summary>高级 JSON／未登记参数</summary>
          <textarea id="d-when-params" placeholder='如 {"sceneId":"S01"}'>${this._escapeHtml(this._json(t.when?.params))}</textarea>
        </details>
      </section>
      <div class="row"><label>执行准入条件 if (JSON，可空)</label><textarea id="d-if" placeholder='如 {"op":"==","left":{"var":"act"},"right":0}'>${t.if ? this._escapeHtml(this._json(t.if)) : ''}</textarea></div>
      <div class="row"><label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" id="d-once" ${t.once ? 'checked' : ''}> 只触发一次(once)</label></div>
      <div class="row"><label>冷却 cooldown (秒，可空)</label><input type="text" id="d-cooldown" value="${t.cooldown != null ? t.cooldown : ''}"></div>
      <div class="row">
        <label>动作序列 do</label>
        <div id="d-do-list">${doHtml || '<div style="color:#778;font-size:12px;">暂无动作</div>'}</div>
        <button class="trg-mini" id="d-add-do" style="margin-top:6px;">+ 添加动作</button>
      </div>
      ${this._renderCompletionFlow(flow)}
    `;

    let draggedActionPath = null;
    const clearActionDropIndicators = () => {
      panel.querySelectorAll('.trg-do-item').forEach(element => {
        element.classList.remove('drop-before', 'drop-after');
        delete element.dataset.dropPosition;
      });
    };
    const parentPathOf = pathStr => {
      const parts = String(pathStr || '').split('.');
      parts.pop();
      return parts.join('.');
    };
    panel.querySelectorAll('.trg-do-item').forEach(item => {
      const handle = item.querySelector('.do-drag-handle');
      handle?.addEventListener('dragstart', event => {
        this._commitDetail();
        draggedActionPath = item.dataset.path;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedActionPath);
        requestAnimationFrame(() => item.classList.add('dragging'));
      });
      item.addEventListener('dragover', event => {
        const sourcePath = draggedActionPath;
        const targetPath = item.dataset.path;
        // 只允许同父级重排（跨分支/跨层级拖动提示不合法）
        if (!sourcePath || sourcePath === targetPath || parentPathOf(sourcePath) !== parentPathOf(targetPath)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const placeAfter = event.clientY >= item.getBoundingClientRect().top + item.offsetHeight / 2;
        clearActionDropIndicators();
        item.dataset.dropPosition = placeAfter ? 'after' : 'before';
        item.classList.add(placeAfter ? 'drop-after' : 'drop-before');
      });
      item.addEventListener('dragleave', event => {
        if (!item.contains(event.relatedTarget)) {
          item.classList.remove('drop-before', 'drop-after');
          delete item.dataset.dropPosition;
        }
      });
      item.addEventListener('drop', event => {
        event.preventDefault();
        const sourcePath = draggedActionPath;
        const targetPath = item.dataset.path;
        const placeAfter = item.dataset.dropPosition === 'after';
        draggedActionPath = null;
        clearActionDropIndicators();
        this._moveActionPath(sourcePath, targetPath, placeAfter);
      });
      handle?.addEventListener('dragend', () => {
        draggedActionPath = null;
        item.classList.remove('dragging');
        clearActionDropIndicators();
      });
    });

    panel.querySelector('#d-add-do').addEventListener('click', () => {
      this._commitDetail();
      if (!t.do) t.do = [];
      t.do.push({
        stepId: this._nextActionStepId(t),
        action: 'setVar',
        params: {}
      });
      this._renderDetail();
    });
    panel.querySelectorAll('.do-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const path = e.target.closest('.trg-do-item').dataset.path;
        this._commitDetail();
        const located = this._resolveStepPath(t, path);
        if (!located) return;
        located.array.splice(located.index, 1);
        this._renderDetail();
      });
    });
    // 分支容器：添加分支 / 分支内添加子步骤 / 删除分支 / 分支条件变化
    panel.querySelectorAll('.do-add-branch').forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.path;
        this._commitDetail();
        const located = this._resolveStepPath(t, path);
        if (!located) return;
        const container = located.array[located.index];
        if (!Array.isArray(container.branch)) container.branch = [];
        container.branch.push({ when: null, do: [] });
        this._renderDetail();
      });
    });
    panel.querySelectorAll('.do-branch-add-step').forEach(btn => {
      btn.addEventListener('click', () => {
        this._commitDetail();
        const branchDo = this._resolveBranchDo(t, btn.dataset.branchDo);
        if (!branchDo) return;
        branchDo.push({
          stepId: this._nextActionStepId(t),
          action: 'setVar',
          params: {}
        });
        this._renderDetail();
      });
    });
    panel.querySelectorAll('.do-branch-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const bIndex = Number(e.target.closest('.do-branch-item').dataset.branchIndex);
        const containerPath = e.target.closest('.trg-do-branch').dataset.path;
        this._commitDetail();
        const located = this._resolveStepPath(t, containerPath);
        if (!located) return;
        const container = located.array[located.index];
        if (Array.isArray(container.branch)) container.branch.splice(bIndex, 1);
        this._renderDetail();
      });
    });
    panel.querySelectorAll('.do-branch-otherwise-cb, .do-branch-when').forEach(el => {
      el.addEventListener('change', () => {
        this._commitDetail();
        this._renderDetail();
      });
    });
    panel.querySelectorAll('.do-action, .do-operation').forEach(select => {
      select.addEventListener('change', () => {
        this._commitDetail();
        this._renderDetail();
      });
    });
    // 可视化条件编辑器（步骤 if + 分支 when 通用）：表单→隐藏 JSON textarea 即时同步 + hasItem 字段切换
    panel.querySelectorAll('.do-cond-form').forEach(form => {
      const textarea = form.querySelector('.do-step-if-input, .do-branch-when');
      const itemWrap = form.querySelector('.do-if-item-wrap');
      const countWrap = form.querySelector('.do-if-count-wrap');
      const varWrap = form.querySelector('.do-if-var-wrap');
      const valueWrap = form.querySelector('.do-if-value-wrap');
      const sync = () => {
        const op = form.querySelector('.do-if-op')?.value || '';
        const variable = text(form.querySelector('.do-if-var')?.value || '');
        const raw = form.querySelector('.do-if-value')?.value || '';
        const item = text(form.querySelector('.do-if-item')?.value || '');
        const count = Math.max(1, Number(form.querySelector('.do-if-count')?.value) || 1);
        let next = null;
        if (op === 'hasItem') {
          next = item ? { op, item, count } : null;
        } else if (op && variable) {
          let parsed;
          try { parsed = raw === '' ? undefined : JSON.parse(raw); } catch { parsed = raw; }
          next = { op, var: variable, value: parsed };
        }
        if (textarea) textarea.value = next ? JSON.stringify(next) : '';
        this._commitDetail();
      };
      const applyVisibility = op => {
        const hasItem = op === 'hasItem';
        if (itemWrap) itemWrap.classList.toggle('hidden', !hasItem);
        if (countWrap) countWrap.classList.toggle('hidden', !hasItem);
        if (varWrap) varWrap.classList.toggle('hidden', hasItem);
        if (valueWrap) valueWrap.classList.toggle('hidden', hasItem);
      };
      form.querySelector('.do-if-op')?.addEventListener('change', event => {
        applyVisibility(event.target.value);
        sync();
      });
      form.querySelectorAll('.do-if-var, .do-if-value, .do-if-item, .do-if-count').forEach(input => {
        input.addEventListener('change', sync);
        input.addEventListener('blur', sync);
      });
    });
    panel.querySelectorAll('.spawn-placement-mode').forEach(select => {
      select.addEventListener('change', () => {
        this._commitDetail();
        this._renderDetail();
      });
    });
    for (const selector of ['#d-coordination-group', '#d-coordination-policy', '#d-coordination-priority']) {
      panel.querySelector(selector)?.addEventListener('change', () => {
        this._commitDetail();
        this._renderList();
      });
    }
    panel.querySelector('#d-editor-scope-scenes')?.addEventListener('change', () => {
      this._commitDetail();
      this._renderList();
    });
    // 启用/停用变化时即时刷新列表图标
    panel.querySelector('#d-enabled').addEventListener('change', () => {
      this._commitDetail();
      this._renderList();
    });
    // when 类型变化即时刷新列表标签 + 重渲染详情（显示/隐藏 timer 专用字段）
    panel.querySelector('#d-when-type').addEventListener('change', (e) => {
      this._commitDetail();
      // timer 类型时给个默认 seconds，避免用户忘填导致不触发
      if (e.target.value === 'timer') {
        const tt = this.triggers[this.selectedIndex];
        if (tt) {
          tt.when = tt.when || {};
          tt.when.params = tt.when.params || {};
          if (tt.when.params.seconds == null) tt.when.params.seconds = 5;
        }
      }
      this._renderList();
      this._renderDetail();
    });

    panel.querySelectorAll('#d-when-structured .do-param-field').forEach(field => {
      field.addEventListener('change', () => {
        this._commitDetail();
        this._renderList();
        this._renderDetail();
      });
    });
    for (const selector of ['#d-when-params', '#d-if']) {
      panel.querySelector(selector)?.addEventListener('change', event => {
        const raw = event.target.value.trim();
        if (raw) {
          try { JSON.parse(raw); } catch { return; }
        }
        this._commitDetail();
        this._renderList();
        this._renderDetail();
      });
    }
    panel.querySelectorAll('.trg-flow-target[data-next-trigger]').forEach(button => {
      button.addEventListener('click', () => this.selectById(button.dataset.nextTrigger, 'triggers'));
    });

    // timer 专用「间隔(秒)」输入框（若存在），双向同步 when.params.seconds
    const secInput = panel.querySelector('#d-timer-seconds');
    if (secInput) {
      secInput.addEventListener('input', () => {
        const wp = panel.querySelector('#d-when-params');
        let obj = {};
        try { obj = JSON.parse(wp.value || '{}'); } catch (err) { obj = {}; }
        const sec = parseFloat(secInput.value);
        if (!isNaN(sec) && sec > 0) obj.seconds = sec; else delete obj.seconds;
        wp.value = JSON.stringify(obj);
        // 触发 when.params 的校验高亮
        wp.dispatchEvent(new Event('input'));
      });
    }

    // JSON 输入框实时校验（合法绿框 / 非法红框 + 悬停提示）
    this._bindJsonValidation(panel.querySelector('#d-when-params'), true);
    this._bindJsonValidation(panel.querySelector('#d-if'), true);
    panel.querySelectorAll('.do-params, .do-param-json, .do-step-if-input, .do-branch-when').forEach(el => this._bindJsonValidation(el, true));
  }

  /**
   * 给 JSON textarea 绑定实时校验
   * @param {HTMLTextAreaElement} el
   * @param {boolean} allowEmpty - 是否允许空值
   * @private
   */
  _bindJsonValidation(el, allowEmpty) {
    if (!el) return;
    const check = () => {
      const v = el.value.trim();
      if (!v) {
        el.style.borderColor = allowEmpty ? '#2a3a5e' : '#c62828';
        el.title = allowEmpty ? '' : '不能为空';
        return true;
      }
      try {
        JSON.parse(v);
        el.style.borderColor = '#4a8a4a';
        el.title = 'JSON 格式正确';
        return true;
      } catch (e) {
        el.style.borderColor = '#e05252';
        el.title = 'JSON 格式错误: ' + e.message + '\n（注意用半角引号 " 和大括号 {}）';
        return false;
      }
    };
    el.addEventListener('input', check);
    check(); // 初始校验
  }

  /** 按 path 定位 do[] 树中的数组与下标（支持嵌套 branch；约定同 TriggerStorylinePanel）。 */
  _resolveStepPath(trigger, pathStr) {
    if (!trigger || !pathStr) return null;
    const parts = String(pathStr).split('.').map(Number);
    let array = Array.isArray(trigger.do) ? trigger.do : [];
    for (let i = 0; i < parts.length - 1; i += 2) {
      const step = array[parts[i]];
      if (!step || !Array.isArray(step.branch)) return null;
      const branch = step.branch[parts[i + 1]];
      if (!branch || !Array.isArray(branch.do)) return null;
      array = branch.do;
    }
    const index = parts[parts.length - 1];
    if (!Number.isInteger(index) || index < 0 || index >= array.length) return null;
    return { array, index };
  }

  /** 定位分支的 do[] 数组。pathStr 格式 "<step>.<branch>[.<step>.<branch>...]"（偶数段）。 */
  _resolveBranchDo(trigger, pathStr) {
    if (!trigger || !pathStr) return null;
    const parts = String(pathStr).split('.').map(Number);
    if (!parts.length || parts.length % 2 !== 0) return null;
    let array = Array.isArray(trigger.do) ? trigger.do : [];
    for (let i = 0; i < parts.length; i += 2) {
      const step = array[parts[i]];
      if (!step || !Array.isArray(step.branch)) return null;
      const branch = step.branch[parts[i + 1]];
      if (!branch) return null;
      array = Array.isArray(branch.do) ? branch.do : [];
    }
    return array;
  }

  _moveActionPath(sourcePath, targetPath, placeAfter = false) {
    const trigger = this.triggers[this.selectedIndex];
    if (!trigger || !sourcePath || sourcePath === targetPath) return false;
    const source = this._resolveStepPath(trigger, sourcePath);
    const target = this._resolveStepPath(trigger, targetPath);
    if (!source || !target || source.array !== target.array) return false;
    if (source.index === target.index) return false;

    // 拖动完整 action 对象，保留稳定 ID、policy、operationId 和 unknown-but-allowed 字段。
    const [action] = source.array.splice(source.index, 1);
    let insertionIndex = target.index + (placeAfter ? 1 : 0);
    if (source.index < insertionIndex) insertionIndex -= 1;
    target.array.splice(insertionIndex, 0, action);
    this._status(`已调整 ${trigger.name || trigger.id || '触发器'} 的步骤顺序，请保存到工程`, 'ok');
    this._renderDetail();
    return true;
  }

  /** 把详情表单的编辑写回当前触发器数据 */
  _commitDetail() {
    const t = this.triggers[this.selectedIndex];
    const panel = this.container.querySelector('#trg-detail');
    if (!t || !panel) return;
    if (this.target === 'tutorials') {
      if (this.tutorialPanel.commit(t, panel)) {
        this.projectIndex = new TriggerProjectIndex(this.project, { sceneDocuments: this._getSceneDocuments() });
      }
      return;
    }
    if (!panel.querySelector('#d-id')) return;

    t.id = panel.querySelector('#d-id').value.trim() || t.id;
    const name = panel.querySelector('#d-name')?.value.trim() || '';
    if (name) t.name = name;
    else delete t.name;
    const coordinationGroup = panel.querySelector('#d-coordination-group')?.value.trim() || '';
    if (coordinationGroup) {
      const priority = Number(panel.querySelector('#d-coordination-priority')?.value);
      t.coordination = {
        ...(t.coordination || {}),
        group: coordinationGroup,
        policy: panel.querySelector('#d-coordination-policy')?.value || 'broadcast',
        priority: Number.isInteger(priority) ? priority : 0
      };
    } else {
      delete t.coordination;
    }
    const scopeSceneSelect = panel.querySelector('#d-editor-scope-scenes');
    const scopeSceneIds = scopeSceneSelect
      ? [...scopeSceneSelect.selectedOptions].map(option => option.value.trim()).filter(Boolean)
      : [];
    if (scopeSceneIds.length) {
      t.editorScope = { ...(t.editorScope || {}), sceneIds: [...new Set(scopeSceneIds)] };
    } else if (t.editorScope) {
      delete t.editorScope.sceneIds;
      if (Object.keys(t.editorScope).length === 0) delete t.editorScope;
    }
    // enabled：未勾选 = false（停用），勾选 = 删除字段（默认启用）
    const enabledEl = panel.querySelector('#d-enabled');
    if (enabledEl && !enabledEl.checked) {
      t.enabled = false;
    } else {
      delete t.enabled; // 默认启用不写字段，保持 JSON 简洁
    }
    t.when = t.when || {};
    t.when.type = panel.querySelector('#d-when-type').value;
    const whenParamsText = panel.querySelector('#d-when-params').value.trim();
    let whenParams = whenParamsText
      ? this._parseJson(whenParamsText, t.when.params || {})
      : {};
    const structuredWhen = panel.querySelector('#d-when-structured');
    if (structuredWhen) whenParams = this._readStructuredParams(structuredWhen, whenParams);
    t.when.params = whenParams;
    const ifVal = panel.querySelector('#d-if').value.trim();
    if (ifVal) t.if = this._parseJson(ifVal, null); else delete t.if;
    const onceChecked = panel.querySelector('#d-once').checked;
    if (onceChecked) t.once = true;
    else if (Object.prototype.hasOwnProperty.call(t, 'once')) t.once = false;
    const cd = panel.querySelector('#d-cooldown').value.trim();
    if (cd) t.cooldown = parseFloat(cd); else delete t.cooldown;

    // 动作：严格按 DOM 顺序递归提交完整步骤（支持 branch[]）；stepId 独立于数组下标，拖动不改变幂等身份。
    const previousSteps = Array.isArray(t.do) ? t.do : [];
    const collectStepIds = steps => {
      const ids = [];
      for (const step of steps || []) {
        const stepId = String(step?.stepId || '').trim();
        if (stepId) ids.push(stepId);
        if (Array.isArray(step?.branch)) {
          for (const branch of step.branch) ids.push(...collectStepIds(branch?.do));
        }
      }
      return ids;
    };
    const prevByPath = new Map();
    const walkPath = (steps, base) => {
      (steps || []).forEach((step, index) => {
        const path = base === '' ? String(index) : `${base}.${index}`;
        prevByPath.set(path, step);
        if (Array.isArray(step?.branch)) {
          step.branch.forEach((branch, bIndex) => walkPath(branch?.do, `${path}.${bIndex}`));
        }
      });
    };
    walkPath(previousSteps, '');
    const allocatedStepIds = new Set(collectStepIds(previousSteps));
    let generatedSequence = 1;
    const allocateStepId = () => {
      const prefix = `${String(t.id || 'trigger').trim() || 'trigger'}.step`;
      let candidate;
      do candidate = `${prefix}.${String(generatedSequence++).padStart(3, '0')}`;
      while (allocatedStepIds.has(candidate));
      allocatedStepIds.add(candidate);
      return candidate;
    };
    const commitStep = el => {
      const path = text(el.dataset.path);
      const prev = path ? prevByPath.get(path) : null;
      const stepId = text(el.querySelector('.do-step-id')?.value) || allocateStepId();
      if (el.classList.contains('trg-do-branch')) {
        const branches = [];
        for (const branchEl of el.querySelectorAll(':scope > .do-branch > .do-branch-item')) {
          const branch = { ...(prev?.branch?.[Number(branchEl.dataset.branchIndex)] || {}) };
          branch.otherwise = branchEl.querySelector('.do-branch-otherwise-cb').checked;
          const whenRaw = text(branchEl.querySelector('.do-branch-when')?.value);
          if (branch.otherwise) delete branch.when;
          else if (whenRaw) branch.when = this._parseJson(whenRaw, null);
          else delete branch.when;
          const childSteps = [];
          for (const childEl of branchEl.querySelectorAll(':scope > .do-branch-do > .trg-do-item')) {
            childSteps.push(commitStep(childEl));
          }
          branch.do = childSteps;
          branches.push(branch);
        }
        const next = { ...(prev || {}), stepId, branch: branches };
        delete next.action;
        delete next.params;
        delete next.if;
        delete next.await;
        return next;
      }
      const action = el.querySelector('.do-action').value;
      let params;
      if (action === 'spawnPlacements') {
        params = this._readSpawnPlacementParams(el);
      } else {
        const rawParams = this._parseJson(el.querySelector('.do-params')?.value || '{}', {});
        params = this._readStructuredParams(el, rawParams);
        const operationSelect = el.querySelector('.do-operation');
        if (operationSelect) {
          const operation = operationSelect.value.trim();
          if (operation) params.operation = operation;
          else delete params.operation;
        }
      }
      const ifRaw = text(el.querySelector('.do-step-if-input')?.value);
      const next = { ...(prev || {}), stepId, action, params };
      if (ifRaw) next.if = this._parseJson(ifRaw, null);
      else delete next.if;
      if (action === 'tutorial.command' && String(next.params.operation || '').trim() === 'show') {
        const awaitCb = el.querySelector('.do-await-cb');
        if (awaitCb?.checked) next.params.await = true;
        else delete next.params.await;
      } else {
        delete next.params.await;
      }
      delete next.branch;
      delete next.await;
      return next;
    };
    const doListEl = panel.querySelector('#d-do-list');
    const nextActions = [];
    if (doListEl) {
      for (const itemEl of doListEl.querySelectorAll(':scope > .trg-do-item')) {
        nextActions.push(commitStep(itemEl));
      }
    }
    t.do = nextActions;
  }

  _addTrigger() {
    this._commitDetail();
    const selectedSceneId = this.container.querySelector('#trg-filter-scene')?.value || '';
    let definition;
    if (this.target === 'tutorials') {
      definition = this.tutorialPanel.create(selectedSceneId);
    } else {
      const id = this._nextStableId('trigger', this.project.triggers || []);
      definition = {
        id,
        when: { type: 'sceneEnter', params: {} },
        do: [],
        once: true
      };
      if (selectedSceneId) definition.editorScope = { sceneIds: [selectedSceneId] };
    }
    this.triggers.push(definition);
    this.project[this.target] = this.triggers;
    this.projectIndex = new TriggerProjectIndex(this.project, { sceneDocuments: this._getSceneDocuments() });
    this.selectedIndex = this.triggers.length - 1;
    this._updateTriggerFilter();
    this._renderList();
    this._renderDetail();
  }

  _deleteTrigger() {
    if (this.selectedIndex < 0) return;
    const definition = this.triggers[this.selectedIndex];
    this.triggers.splice(this.selectedIndex, 1);
    this.project[this.target] = this.triggers;
    this.projectIndex = new TriggerProjectIndex(this.project, { sceneDocuments: this._getSceneDocuments() });
    this.selectedIndex = Math.min(this.selectedIndex, this.triggers.length - 1);
    this._updateTriggerFilter();
    this._renderList();
    this._renderDetail();
  }

  _escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  _json(v) {
    if (v == null) return '';
    try { return JSON.stringify(v); } catch (e) { return ''; }
  }

  _parseJson(str, fallback) {
    if (!str || !str.trim()) return fallback;
    try { return JSON.parse(str); }
    catch (e) { this._status('JSON 解析错误: ' + e.message, 'err'); return fallback; }
  }
}

export default TriggerEditor;

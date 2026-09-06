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

import { getTriggerActions } from '../src/systems/TriggerCatalog.js';

const text = value => String(value ?? '').trim();
const clone = value => structuredClone(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const DEFAULT_PARAMS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: true,
  properties: {}
});

/**
 * 项目行为目录编辑器。
 *
 * 行为目录只描述 Trigger 可使用的 action/operation 契约，不包含可执行代码。
 * 运行时执行器仍需由 TriggerSystem/项目适配器注册；编辑器只负责 canonical 元数据。
 */
export class BehaviorEditor {
  constructor(container, options = {}) {
    this.container = container;
    this.canonicalSession = options.canonicalSession || null;
    this.getSceneList = typeof options.getSceneList === 'function' ? options.getSceneList : () => [];
    this.getSceneDocuments = typeof options.getSceneDocuments === 'function' ? options.getSceneDocuments : () => [];
    this.onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;
    this.projectPath = options.projectPath || 'game.project.json';
    this.project = null;
    this.selectedId = '';
    // 由 canonical 场景 binding、Trigger 条件和 editorScope 派生；切换选中项只读索引，禁止重复扫描全部场景对象。
    this._usageIndex = null;
    this._initialized = false;
  }

  async init() {
    if (!this._initialized) {
      this._initialized = true;
      this._buildUI();
      this._injectStyles();
    }
    await this.refresh();
    return this;
  }

  async refresh() {
    if (!this.canonicalSession) throw new TypeError('BehaviorEditor requires a shared CanonicalEditorSession');
    this.project = this.canonicalSession.getValue();
    if (!this.project || typeof this.project !== 'object') {
      throw new Error('BehaviorEditor: canonical project candidate 不可用');
    }
    if (!isObject(this.project.triggerCatalog)) this.project.triggerCatalog = {};
    if (!Array.isArray(this.project.triggerCatalog.actions)) this.project.triggerCatalog.actions = [];
    this.invalidateUsageIndex();
    const actions = this._getEffectiveActions();
    if (!actions.some(item => item.id === this.selectedId)) this.selectedId = actions[0]?.id || '';
    this._renderSceneFilter();
    this._renderList();
    this._renderDetail();
    return this;
  }

  invalidateUsageIndex() {
    this._usageIndex = null;
  }

  _getUsageIndex() {
    if (this._usageIndex) return this._usageIndex;

    const bindingScenesByTriggerId = new Map();
    for (const scene of this._getSceneDocuments()) {
      const sceneId = text(scene?.id);
      if (!sceneId) continue;
      for (const layer of scene.layers || []) {
        for (const binding of layer?.objects || []) {
          const triggerId = binding?.type === 'trigger' ? text(binding.triggerId) : '';
          if (!triggerId) continue;
          let sceneIds = bindingScenesByTriggerId.get(triggerId);
          if (!sceneIds) {
            sceneIds = new Set();
            bindingScenesByTriggerId.set(triggerId, sceneIds);
          }
          sceneIds.add(sceneId);
        }
      }
    }

    const sceneIdsByTriggerId = new Map();
    const sceneIdsByActionId = new Map();
    const triggersByActionId = new Map();
    const collectActionIds = (steps, actionIds) => {
      for (const step of steps || []) {
        const actionId = this._actionId(step?.action);
        if (actionId) actionIds.add(actionId);
        for (const branch of step?.branch || []) collectActionIds(branch?.do, actionIds);
      }
    };
    for (const trigger of this.project?.triggers || []) {
      const triggerId = text(trigger?.id);
      if (!triggerId) continue;
      const sceneIds = new Set(bindingScenesByTriggerId.get(triggerId) || []);
      for (const sceneId of trigger.editorScope?.sceneIds || []) {
        if (text(sceneId)) sceneIds.add(text(sceneId));
      }
      const conditionSceneId = text(trigger.when?.params?.sceneId);
      if (conditionSceneId) sceneIds.add(conditionSceneId);
      sceneIdsByTriggerId.set(triggerId, sceneIds);

      const actionIds = new Set();
      collectActionIds(trigger.do, actionIds);
      for (const actionId of actionIds) {
        let actionScenes = sceneIdsByActionId.get(actionId);
        if (!actionScenes) {
          actionScenes = new Set();
          sceneIdsByActionId.set(actionId, actionScenes);
        }
        for (const sceneId of sceneIds) actionScenes.add(sceneId);
        let actionTriggers = triggersByActionId.get(actionId);
        if (!actionTriggers) {
          actionTriggers = [];
          triggersByActionId.set(actionId, actionTriggers);
        }
        actionTriggers.push(trigger);
      }
    }

    this._usageIndex = {
      bindingScenesByTriggerId,
      sceneIdsByTriggerId,
      sceneIdsByActionId,
      triggersByActionId
    };
    return this._usageIndex;
  }

  _getEffectiveActions() {
    const projectActions = this.project?.triggerCatalog?.actions || [];
    const projectById = new Map(projectActions.map((action, index) => [this._actionId(action), { action, index }]));
    return getTriggerActions(this.project).map(action => {
      const id = this._actionId(action);
      const projectEntry = projectById.get(id);
      return {
        id,
        action,
        projectEntry: projectEntry?.action || null,
        projectIndex: projectEntry?.index ?? -1,
        builtIn: !projectEntry,
        scenes: this._getActionScenes(id)
      };
    }).filter(item => item.id);
  }

  _getBaseActionIds() {
    return new Set(getTriggerActions(null).map(action => this._actionId(action)).filter(Boolean));
  }

  _actionId(action) {
    if (typeof action === 'string') return text(action);
    return text(action?.value || action?.id);
  }

  _getSceneDocuments() {
    try {
      const documents = this.getSceneDocuments();
      return Array.isArray(documents) ? documents : Object.values(documents || {});
    } catch (error) {
      console.warn('BehaviorEditor: 获取场景文档失败', error);
      return [];
    }
  }

  _getSceneIds() {
    const sceneIds = new Set();
    try {
      for (const scene of this.getSceneList() || []) {
        const id = text(scene?.id);
        if (id) sceneIds.add(id);
      }
    } catch (error) {
      console.warn('BehaviorEditor: 获取场景列表失败', error);
    }
    for (const triggerScenes of this._getUsageIndex().sceneIdsByTriggerId.values()) {
      for (const sceneId of triggerScenes) sceneIds.add(sceneId);
    }
    return [...sceneIds];
  }

  _getTriggerSceneIds(trigger) {
    const triggerId = text(trigger?.id);
    return new Set(this._getUsageIndex().sceneIdsByTriggerId.get(triggerId) || []);
  }

  _getActionScenes(actionId) {
    return new Set(this._getUsageIndex().sceneIdsByActionId.get(actionId) || []);
  }

  _buildUI() {
    this.container.innerHTML = `
      <div class="behavior-root">
        <div class="behavior-toolbar">
          <select id="behavior-filter-scene" title="按使用该行为的 Trigger 场景关联筛选"></select>
          <input id="behavior-filter-text" type="search" placeholder="搜索行为 ID 或名称">
          <button id="behavior-add">＋ 新增行为</button>
          <button id="behavior-delete">🗑 删除项目行为</button>
          <button id="behavior-save" class="primary">💾 保存到工程</button>
          <span class="behavior-hint">目录 → ${this._escapeHtml(this.projectPath)}</span>
        </div>
        <div class="behavior-warning">行为目录只登记 action/operation 契约；新增行为仍需运行时注册对应执行器，不能在 JSON 中写入脚本或函数。</div>
        <div class="behavior-main">
          <div class="behavior-list" id="behavior-list"></div>
          <div class="behavior-resizer" id="behavior-list-resizer" role="separator" aria-label="调整行为列表宽度"></div>
          <div class="behavior-detail" id="behavior-detail"></div>
        </div>
        <div class="behavior-status" id="behavior-status"></div>
      </div>`;
    this.container.querySelector('#behavior-filter-scene').addEventListener('change', () => this._renderList());
    this.container.querySelector('#behavior-filter-text').addEventListener('input', () => this._renderList());
    this.container.querySelector('#behavior-add').addEventListener('click', () => this._addBehavior());
    this.container.querySelector('#behavior-delete').addEventListener('click', () => this._deleteBehavior());
    this.container.querySelector('#behavior-save').addEventListener('click', () => { void this.save(); });
    this._bindListResizer();
  }

  _renderSceneFilter() {
    const select = this.container.querySelector('#behavior-filter-scene');
    if (!select) return;
    const current = select.value;
    const names = new Map();
    try {
      for (const scene of this.getSceneList() || []) {
        const id = text(scene?.id);
        if (id) names.set(id, text(scene.name) || id);
      }
    } catch (_error) { /* _getSceneIds 已提供稳定 ID */ }
    for (const sceneId of this._getSceneIds()) if (!names.has(sceneId)) names.set(sceneId, `${sceneId}（旧引用）`);
    select.innerHTML = '<option value="">全部场景关联</option>' + [...names.entries()]
      .map(([id, name]) => `<option value="${this._escapeHtml(id)}"${id === current ? ' selected' : ''}>${this._escapeHtml(name)}</option>`)
      .join('');
  }

  _renderList() {
    const list = this.container.querySelector('#behavior-list');
    if (!list) return;
    const sceneId = text(this.container.querySelector('#behavior-filter-scene')?.value);
    const query = text(this.container.querySelector('#behavior-filter-text')?.value).toLowerCase();
    const visible = this._getEffectiveActions().filter(item => {
      if (sceneId && !item.scenes.has(sceneId)) return false;
      return !query || item.id.toLowerCase().includes(query)
        || text(item.action.label).toLowerCase().includes(query);
    });
    if (!visible.length) {
      list.innerHTML = '<div class="behavior-empty">无匹配行为</div>';
      return;
    }
    list.innerHTML = visible.map(item => {
      const source = item.builtIn ? '内置' : '项目';
      const scenes = [...item.scenes].join('、');
      return `<button type="button" class="behavior-item${item.id === this.selectedId ? ' active' : ''}" data-behavior-id="${this._escapeHtml(item.id)}">
        <span class="behavior-item-copy"><strong>${this._escapeHtml(item.action.label || item.id)}</strong><code>${this._escapeHtml(item.id)}</code><small>${scenes ? `场景：${this._escapeHtml(scenes)}` : '未关联场景'}</small></span>
        <span class="behavior-source">${source}</span>
      </button>`;
    }).join('');
    list.querySelectorAll('[data-behavior-id]').forEach(button => {
      button.addEventListener('click', () => {
        this._commitDetail({ silent: true });
        this.selectedId = button.dataset.behaviorId;
        this._renderList();
        this._renderDetail();
      });
    });
  }

  _getSelectedItem() {
    return this._getEffectiveActions().find(item => item.id === this.selectedId) || null;
  }

  _getEditableSource(item) {
    if (item?.projectEntry) return clone(item.projectEntry);
    const source = { value: item?.id || '', label: item?.action?.label || item?.id || '' };
    if (item?.action?.paramsSchema) source.paramsSchema = clone(item.action.paramsSchema);
    if (Array.isArray(item?.action?.operations)) source.operations = clone(item.action.operations);
    return source;
  }

  _renderDetail() {
    const panel = this.container.querySelector('#behavior-detail');
    const item = this._getSelectedItem();
    if (!panel || !item) {
      if (panel) panel.innerHTML = '<div class="behavior-empty">选择或新增一个行为</div>';
      return;
    }
    const source = this._getEditableSource(item);
    const paramsSchema = source.paramsSchema || DEFAULT_PARAMS_SCHEMA;
    const operations = Array.isArray(source.operations) ? source.operations : [];
    const usedBy = this._getUsageIndex().triggersByActionId.get(item.id) || [];
    const operationSummary = operations.length ? `已登记 ${operations.length} 个 operation` : '暂无 operation';
    panel.innerHTML = `
      <div class="behavior-heading"><strong>行为定义</strong><span>${item.builtIn ? '内置行为：修改后将创建项目覆盖' : '项目行为：可直接修改并保存'}</span></div>
      <div class="behavior-row"><label>行为 ID <input id="behavior-id" type="text" value="${this._escapeHtml(item.id)}"${item.builtIn ? ' disabled' : ''}></label></div>
      <div class="behavior-row"><label>显示名称 <input id="behavior-label" type="text" value="${this._escapeHtml(source.label || item.action.label || item.id)}"></label></div>
      <div class="behavior-row"><label>使用场景</label><div class="behavior-chip-list">${[...item.scenes].map(scene => `<span>${this._escapeHtml(scene)}</span>`).join('') || '<em>未被任何场景关联</em>'}</div></div>
      <div class="behavior-row"><label>使用该行为的 Trigger</label><div class="behavior-usage-list">${usedBy.map(trigger => `<button type="button" data-trigger-id="${this._escapeHtml(trigger.id)}">${this._escapeHtml(trigger.name || trigger.id)}</button>`).join('') || '<em>暂无 Trigger 使用</em>'}</div></div>
      <div class="behavior-row"><label>参数 Schema（JSON）<textarea id="behavior-params-schema" spellcheck="false">${this._escapeHtml(this._json(paramsSchema))}</textarea></label></div>
      <div class="behavior-row"><label>operations（JSON 数组）<textarea id="behavior-operations" spellcheck="false" placeholder='如 [{"id":"run","label":"执行","paramsSchema":{"type":"object"},"resultSemantics":"执行完成"}]'>${this._escapeHtml(this._json(operations))}</textarea></label><small>${this._escapeHtml(operationSummary)}</small></div>
      <details class="behavior-advanced"><summary>高级：完整行为 JSON</summary><textarea id="behavior-json" spellcheck="false">${this._escapeHtml(this._json(source))}</textarea><small>提交时以此对象为基底，只覆盖上方 ID、名称、paramsSchema 和 operations；其他未知字段会保留。</small></details>
      <div class="behavior-row behavior-detail-actions"><button id="behavior-add-operation" type="button">＋ 添加 operation 模板</button><span>${item.builtIn ? '内置行为不可删除；删除项目覆盖会恢复内置定义。' : '删除前会检查是否仍被 Trigger 使用。'}</span></div>`;
    panel.querySelector('#behavior-add-operation').addEventListener('click', () => this._addOperationTemplate());
    panel.querySelectorAll('[data-trigger-id]').forEach(button => button.addEventListener('click', () => {
      this._toast(`请在“事件/触发器”中编辑 Trigger：${button.dataset.triggerId}`, 'warn');
    }));
    this._updateDeleteButton(item);
  }

  _updateDeleteButton(item = this._getSelectedItem()) {
    const button = this.container.querySelector('#behavior-delete');
    if (!button) return;
    button.disabled = !item?.projectEntry;
    button.textContent = item?.projectEntry
      ? (item.builtIn ? '🗑 删除项目覆盖' : '🗑 删除项目行为')
      : '🗑 内置行为不可删除';
  }

  _triggerUsesAction(trigger, actionId) {
    const walk = steps => (steps || []).some(step => {
      if (this._actionId(step?.action) === actionId) return true;
      return (step?.branch || []).some(branch => walk(branch?.do));
    });
    return walk(trigger?.do);
  }

  _addBehavior() {
    const actions = this.project.triggerCatalog.actions;
    const ids = new Set(this._getEffectiveActions().map(item => item.id));
    let index = 1;
    let id;
    do id = `behavior-${String(index++).padStart(3, '0')}`; while (ids.has(id));
    actions.push({
      value: id,
      label: '新行为',
      paramsSchema: clone(DEFAULT_PARAMS_SCHEMA),
      operations: []
    });
    this.selectedId = id;
    this._status(`已新增 ${id}，请编辑后保存到工程`, 'ok');
    this._renderList();
    this._renderDetail();
  }

  _deleteBehavior() {
    const item = this._getSelectedItem();
    if (!item?.projectEntry) return;
    const usages = (this.project?.triggers || []).filter(trigger => this._triggerUsesAction(trigger, item.id));
    const canFallbackToBuiltIn = this._getBaseActionIds().has(item.id);
    if (usages.length > 0 && !canFallbackToBuiltIn) {
      this._toast(`行为 ${item.id} 仍被 ${usages.length} 个 Trigger 使用，不能删除。`, 'error');
      return;
    }
    const index = item.projectIndex;
    this.project.triggerCatalog.actions.splice(index, 1);
    this.selectedId = this._getEffectiveActions()[0]?.id || '';
    this._status(`已移除项目行为/覆盖 ${item.id}，请保存到工程`, 'ok');
    this._renderSceneFilter();
    this._renderList();
    this._renderDetail();
  }

  _addOperationTemplate() {
    const operationsInput = this.container.querySelector('#behavior-operations');
    if (!operationsInput) return;
    let operations;
    try {
      operations = operationsInput.value.trim() ? JSON.parse(operationsInput.value) : [];
    } catch (error) {
      this._toast(`operations JSON 格式错误：${error.message}`, 'error');
      return;
    }
    if (!Array.isArray(operations)) {
      this._toast('operations 必须是 JSON 数组', 'error');
      return;
    }
    const ids = new Set(operations.map(operation => this._actionId(operation)).filter(Boolean));
    let index = 1;
    let id;
    do id = `operation-${String(index++).padStart(3, '0')}`; while (ids.has(id));
    operations.push({
      id,
      value: id,
      label: '新操作',
      paramsSchema: clone(DEFAULT_PARAMS_SCHEMA),
      resultSemantics: '请填写该 operation 的成功、失败和幂等语义'
    });
    operationsInput.value = JSON.stringify(operations, null, 2);
  }

  _readDraft() {
    const item = this._getSelectedItem();
    if (!item) return { error: '未选择行为' };
    const id = item.builtIn ? item.id : text(this.container.querySelector('#behavior-id')?.value);
    if (!id) return { error: '行为 ID 不能为空' };
    if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(id)) return { error: '行为 ID 必须以字母开头，只能包含字母、数字、点、下划线或短横线' };
    const existing = this._getEffectiveActions().find(candidate => candidate.id === id && candidate.id !== item.id);
    if (existing) return { error: `行为 ID 已存在：${id}` };
    const label = text(this.container.querySelector('#behavior-label')?.value);
    if (!label) return { error: '行为显示名称不能为空' };
    let paramsSchema;
    let operations;
    let advanced;
    try {
      paramsSchema = JSON.parse(this.container.querySelector('#behavior-params-schema')?.value || '{}');
      operations = JSON.parse(this.container.querySelector('#behavior-operations')?.value || '[]');
      advanced = JSON.parse(this.container.querySelector('#behavior-json')?.value || '{}');
    } catch (error) {
      return { error: `行为 JSON 格式错误：${error.message}` };
    }
    if (!isObject(paramsSchema)) return { error: 'paramsSchema 必须是 JSON 对象' };
    if (!Array.isArray(operations)) return { error: 'operations 必须是 JSON 数组' };
    if (!isObject(advanced)) return { error: '完整行为 JSON 必须是对象' };
    const operationError = this._validateOperations(operations);
    if (operationError) return { error: operationError };
    const next = clone(advanced);
    next.value = id;
    next.v = id;
    if (Object.prototype.hasOwnProperty.call(next, 'id') || Object.prototype.hasOwnProperty.call(item.projectEntry || {}, 'id')) next.id = id;
    next.label = label;
    next.paramsSchema = paramsSchema;
    if (operations.length) next.operations = operations;
    else delete next.operations;
    return { item, oldId: item.id, next, renamed: item.id !== id };
  }

  _validateOperations(operations) {
    const ids = new Set();
    for (const [index, operation] of operations.entries()) {
      if (!isObject(operation)) return `operations[${index}] 必须是对象`;
      const id = text(operation.value || operation.id);
      if (!id) return `operations[${index}] 缺少稳定 id/value`;
      if (ids.has(id)) return `operations[${index}] 存在重复 operation：${id}`;
      ids.add(id);
      if (operation.id !== undefined && text(operation.id) !== id) return `operations[${index}].id 必须与 value 一致`;
      if (operation.value !== undefined && text(operation.value) !== id) return `operations[${index}].value 不能为空且必须稳定`;
      if (!text(operation.label)) return `operations[${index}].label 不能为空`;
      if (!Object.prototype.hasOwnProperty.call(operation, 'paramsSchema')) return `operations[${index}] 必须声明 paramsSchema`;
      if (!isObject(operation.paramsSchema) && typeof operation.paramsSchema !== 'string') return `operations[${index}].paramsSchema 必须是对象或 schema ID`;
      if (!Object.prototype.hasOwnProperty.call(operation, 'resultSemantics')) return `operations[${index}] 必须声明 resultSemantics`;
      if (typeof operation.resultSemantics !== 'string' && !isObject(operation.resultSemantics)) return `operations[${index}].resultSemantics 类型无效`;
    }
    return '';
  }

  _rewriteActionReferences(oldId, newId) {
    if (oldId === newId) return;
    const walk = steps => {
      for (const step of steps || []) {
        if (this._actionId(step?.action) === oldId) step.action = newId;
        for (const branch of step?.branch || []) walk(branch?.do);
      }
    };
    for (const trigger of this.project?.triggers || []) walk(trigger?.do);
    this.invalidateUsageIndex();
  }

  _commitDetail({ silent = false } = {}) {
    const panel = this.container.querySelector('#behavior-detail');
    if (!panel || !this._getSelectedItem() || !panel.querySelector('#behavior-json')) return { ok: true };
    const draft = this._readDraft();
    if (draft.error) {
      if (!silent) this._toast(draft.error, 'error');
      return { ok: false, error: draft.error };
    }
    const item = draft.item;
    if (item.projectIndex >= 0) this.project.triggerCatalog.actions[item.projectIndex] = draft.next;
    else this.project.triggerCatalog.actions.push(draft.next);
    if (draft.renamed) this._rewriteActionReferences(draft.oldId, draft.next.value);
    this.selectedId = draft.next.value;
    return { ok: true, draft };
  }

  async save() {
    const committed = this._commitDetail();
    if (!committed.ok) return { ok: false, committed: false, status: 'rejected', code: 'invalidBehavior', errors: [{ path: 'triggerCatalog.actions', message: committed.error }] };
    const catalog = clone(this.project.triggerCatalog);
    try {
      this.canonicalSession.patchMany([
        { path: 'triggerCatalog', value: catalog },
        ...(committed.draft?.renamed ? [{ path: 'triggers', value: clone(this.project.triggers || []) }] : [])
      ]);
      const result = await this.canonicalSession.save();
      if (result?.ok === true && result.committed === true) {
        await this.onSaved?.(this.project);
        this._status(result.degraded ? '⚠️ 行为已提交，但同步出现降级' : '✅ 行为目录已保存到工程', result.degraded ? 'warn' : 'ok');
        return result;
      }
      const firstError = result?.errors?.[0];
      const message = [firstError?.path, firstError?.message || firstError?.reason].filter(Boolean).join(': ')
        || result?.error?.message || result?.error || '磁盘未提交';
      this._status(`❌ 保存失败：${message}`, 'err');
      return result;
    } catch (error) {
      this._status(`❌ 保存异常：${error.message}`, 'err');
      return { ok: false, committed: false, status: 'failed', code: 'behaviorSaveFailed', error };
    }
  }

  _bindListResizer() {
    const list = this.container.querySelector('#behavior-list');
    const resizer = this.container.querySelector('#behavior-list-resizer');
    if (!list || !resizer) return;
    const apply = width => { list.style.width = `${Math.max(220, Math.min(520, Number(width) || 300))}px`; };
    let startX = 0;
    let startWidth = 0;
    let pointerId = null;
    resizer.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startWidth = list.getBoundingClientRect().width || 300;
      resizer.setPointerCapture(pointerId);
      resizer.classList.add('dragging');
    });
    resizer.addEventListener('pointermove', event => {
      if (event.pointerId === pointerId) apply(startWidth + event.clientX - startX);
    });
    const end = event => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      resizer.classList.remove('dragging');
      resizer.releasePointerCapture?.(event.pointerId);
    };
    resizer.addEventListener('pointerup', end);
    resizer.addEventListener('pointercancel', end);
    resizer.addEventListener('dblclick', () => apply(300));
    apply(300);
  }

  _injectStyles() {
    if (this.container.ownerDocument?.getElementById('behavior-editor-styles')) return;
    const style = this.container.ownerDocument.createElement('style');
    style.id = 'behavior-editor-styles';
    style.textContent = `
      .behavior-root{height:100%;display:flex;flex-direction:column;background:#0d1428;color:#e8eefc;font-size:13px}.behavior-toolbar{display:flex;align-items:center;gap:7px;padding:8px;border-bottom:1px solid #2a3a5e;background:#16213e}.behavior-toolbar select,.behavior-toolbar input,.behavior-toolbar button{padding:5px 8px;background:#26304e;color:#fff;border:1px solid #3a4a7e;border-radius:3px}.behavior-toolbar input{width:180px}.behavior-toolbar button{cursor:pointer}.behavior-toolbar button:hover{background:#4a5a9e}.behavior-toolbar button.primary{background:#4CAF50;color:#071006;border-color:#4CAF50}.behavior-toolbar button:disabled{opacity:.5;cursor:not-allowed}.behavior-hint{color:#8ea4c9;font-size:11px;margin-left:auto}.behavior-warning{padding:6px 10px;color:#e8a24a;background:#211d16;border-bottom:1px solid #5b4929;font-size:11px}.behavior-main{display:flex;flex:1;min-height:0;overflow:hidden}.behavior-list{width:300px;flex:0 0 auto;overflow:auto;padding:8px;background:#111a31}.behavior-resizer{width:6px;flex:0 0 6px;cursor:col-resize;background:#1d2c4d}.behavior-resizer.dragging,.behavior-resizer:hover{background:#4CAF50}.behavior-detail{flex:1;overflow:auto;padding:16px;min-width:0}.behavior-item{width:100%;display:flex;align-items:flex-start;justify-content:space-between;text-align:left;margin-bottom:6px;padding:8px;background:#1a2a4e;border:1px solid transparent;border-radius:4px;color:#fff;cursor:pointer}.behavior-item:hover{background:#263a67}.behavior-item.active{border-color:#4CAF50;background:#294d3c}.behavior-item-copy{display:flex;flex-direction:column;gap:3px;min-width:0}.behavior-item-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.behavior-item-copy code,.behavior-usage-list button{color:#9ec7ff}.behavior-item-copy small{color:#9aaacc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.behavior-source{font-size:10px;color:#8ea4c9;margin-left:5px}.behavior-empty{padding:28px;text-align:center;color:#7e8aa5}.behavior-heading{display:flex;align-items:baseline;gap:12px;padding-bottom:12px;border-bottom:1px solid #2a3a5e}.behavior-heading strong{font-size:16px;color:#7cf}.behavior-heading span,.behavior-detail-actions span,.behavior-row small{color:#8ea4c9;font-size:11px}.behavior-row{margin-top:12px}.behavior-row>label{display:block;color:#b8c7e6}.behavior-row input,.behavior-row textarea{display:block;width:100%;margin-top:5px;padding:7px;background:#0a1020;color:#fff;border:1px solid #3a4a5e;border-radius:3px;box-sizing:border-box}.behavior-row input:disabled{color:#8995ae;background:#18223a}.behavior-row textarea{min-height:110px;resize:vertical;font-family:monospace;font-size:12px}.behavior-chip-list,.behavior-usage-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}.behavior-chip-list span,.behavior-usage-list button{padding:3px 7px;border-radius:3px;background:#26304e;border:1px solid #3a4a7e}.behavior-usage-list button{cursor:pointer}.behavior-chip-list em,.behavior-usage-list em{color:#687692}.behavior-advanced{margin-top:14px;border:1px solid #2a3a5e;padding:8px}.behavior-advanced summary{cursor:pointer;color:#9ec7ff}.behavior-advanced textarea{width:100%;min-height:180px;margin-top:8px;background:#0a1020;color:#fff;border:1px solid #3a4a5e;font-family:monospace;font-size:12px}.behavior-detail-actions{display:flex;align-items:center;gap:10px}.behavior-detail-actions button{padding:6px 10px;background:#3a4a7e;color:#fff;border:0;border-radius:3px;cursor:pointer}.behavior-status{min-height:26px;padding:5px 10px;color:#a8b6d2;border-top:1px solid #2a3a5e}.behavior-status.ok{color:#7ee787}.behavior-status.warn{color:#e8a24a}.behavior-status.err{color:#ff8585}`;
    this.container.ownerDocument.head.appendChild(style);
  }

  _status(message, type = '') {
    const status = this.container.querySelector('#behavior-status');
    if (!status) return;
    status.textContent = message;
    status.className = `behavior-status ${type}`.trim();
  }

  _toast(message, type = 'error') {
    this._status(message, type === 'error' ? 'err' : type);
    const sceneToast = this.container.ownerDocument?.querySelector('#scene-editor-toast');
    if (sceneToast) {
      sceneToast.textContent = message;
      sceneToast.className = `scene-editor-toast ${type}`;
    }
  }

  _escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  _json(value) {
    try { return JSON.stringify(value, null, 2); } catch (_error) { return '{}'; }
  }
}

export default BehaviorEditor;

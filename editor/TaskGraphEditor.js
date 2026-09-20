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

import { validateTaskGraphDefinitions } from '../src/systems/TaskGraphSystem.js';
import { getTriggerEventDescriptor, getTriggerEvents } from '../src/systems/TriggerCatalog.js';
import {
  getObjectiveTypeDescriptor,
  objectiveTypeOptions,
  buildEventMatcher,
  matchObjectiveType
} from '../src/systems/quest/ObjectiveTypeRegistry.js';

const clone = value => structuredClone(value);
const list = value => Array.isArray(value) ? value : [];
const stableId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]*$/.test(value);

/**
 * TaskGraphSystem 定义的薄 UI 适配器。
 * 只拥有 project.taskGraphs 根字段的编辑草稿，提交统一委托共享 CanonicalEditorSession。
 */
export class TaskGraphEditor {
  constructor(container, { canonicalSession, projectPath = '', getSceneList = () => [], getSceneDocuments = () => [] } = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError('TaskGraphEditor requires a container element');
    if (!canonicalSession) throw new TypeError('TaskGraphEditor requires a shared CanonicalEditorSession');
    this.container = container;
    this.canonicalSession = canonicalSession;
    this.projectPath = projectPath || canonicalSession.sourceUri;
    this.getSceneList = typeof getSceneList === 'function' ? getSceneList : () => [];
    this.getSceneDocuments = typeof getSceneDocuments === 'function' ? getSceneDocuments : () => [];
    this.project = null;
    this.taskGraphs = [];
    this.selectedIndex = -1;
    this._initialized = false;
  }

  async init() {
    if (!this._initialized) {
      this._initialized = true;
      this._injectStyles();
      this._buildUI();
    }
    this._load();
    this._render();
    return this;
  }

  _load() {
    const project = this.canonicalSession.getValue();
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new Error('TaskGraphEditor: canonical project candidate 不可用');
    }
    this.project = project;
    this.taskGraphs = list(project.taskGraphs).map(clone);
    if (this.selectedIndex >= this.taskGraphs.length) this.selectedIndex = this.taskGraphs.length - 1;
  }

  async save() {
    const validation = this._validateDefinitions();
    if (!validation.ok) {
      this._status(`❌ ${validation.message}`, 'error');
      this._toast(validation.message, 'error');
      return { ok: false, committed: false, status: 'rejected', code: validation.code };
    }
    try {
      this.canonicalSession.patch('taskGraphs', clone(this.taskGraphs));
      const result = await this.canonicalSession.save();
      if (result?.ok === true && result.committed === true) {
        const message = result.degraded
          ? '磁盘已提交，但缓存或通知同步降级'
          : `已保存 ${this.taskGraphs.length} 个任务图`;
        this._status(`${result.degraded ? '⚠️' : '✅'} ${message}`, result.degraded ? 'warn' : 'ok');
        this._toast(message, result.degraded ? 'warn' : 'success');
        return result;
      }
      const message = this._saveError(result);
      this._status(`❌ 保存失败：${message}`, 'error');
      this._toast(`保存失败：${message}`, 'error');
      return result;
    } catch (error) {
      const result = error?.result || { ok: false, committed: false, status: 'failed', error };
      this._status(`❌ 保存失败：${error.message}`, 'error');
      this._toast(`保存失败：${error.message}`, 'error');
      return result;
    }
  }

  _buildUI() {
    this.container.innerHTML = `
      <div class="tge-root">
        <div class="tge-toolbar">
          <button type="button" data-action="add-task">+ 新建任务</button>
          <button type="button" data-action="delete-task" class="danger">删除任务</button>
          <button type="button" data-action="save" class="primary">保存到工程</button>
          <span class="tge-hint">单线填写 · 自动生成任务流程</span>
        </div>
        <div class="tge-main">
          <aside class="tge-list" data-role="task-list"></aside>
          <section class="tge-detail" data-role="task-detail"></section>
        </div>
        <div class="tge-status" data-role="status"></div>
      </div>`;
    this.container.querySelector('[data-action="add-task"]').addEventListener('click', () => this._addTask());
    this.container.querySelector('[data-action="delete-task"]').addEventListener('click', () => this._deleteTask());
    this.container.querySelector('[data-action="save"]').addEventListener('click', async () => { await this.save(); });
  }

  _render() {
    this._renderList();
    this._renderDetail();
  }

  _renderList() {
    const target = this.container.querySelector('[data-role="task-list"]');
    if (!target) return;
    if (this.taskGraphs.length === 0) {
      target.innerHTML = '<div class="tge-empty">暂无任务图<br>点击“+ 新建任务”开始</div>';
      return;
    }
    target.innerHTML = this.taskGraphs.map((task, index) => `
      <button type="button" class="tge-task ${index === this.selectedIndex ? 'active' : ''}" data-task-index="${index}">
        <strong>${this._escape(task.title || task.id || '未命名任务')}</strong>
        <small>${this._escape(task.id || '缺少 id')} · ${list(task.nodes).filter(node => node?.type === 'objective').length} 个目标</small>
      </button>`).join('');
    target.querySelectorAll('[data-task-index]').forEach(button => button.addEventListener('click', () => {
      this.selectedIndex = Number(button.dataset.taskIndex);
      this._render();
    }));
  }

  _renderDetail() {
    const target = this.container.querySelector('[data-role="task-detail"]');
    const task = this._task();
    if (!target) return;
    if (!task) {
      target.innerHTML = '<div class="tge-empty">选择或新建一个任务</div>';
      return;
    }
    if (this._requiresLinearConversion(task)) {
      target.innerHTML = `
        <div class="tge-authoring-note">这个旧任务包含手工分支。为避免在复杂连线中调试，请先明确转换为按顺序完成的单线步骤；原目标名称和完成事件会保留。</div>
        <div class="tge-graph">${this._graphSvg(task)}</div>
        <button type="button" data-action="convert-linear">转换为单线任务</button>`;
      target.querySelector('[data-action="convert-linear"]')?.addEventListener('click', () => {
        if (!confirm('转换后会由目标顺序重新生成连线，确定继续吗？')) return;
        this._generateLinearGraph(task, this._authoringSteps(task).map(clone), 'sequence');
        this._renderDetail();
      });
      return;
    }
    const steps = this._authoringSteps(task);
    const mode = this._authoringMode(task);
    const categories = [
      ['main', '主线任务'], ['side', '支线任务'], ['event', '事件任务'], ['tutorial', '教学任务']
    ];
    target.innerHTML = `
      <div class="tge-authoring-note">按玩家实际经历从上到下填写步骤；节点、连线、入口、汇合和完成节点由编辑器自动生成。</div>
      <div class="tge-graph" data-role="task-graph">${this._graphSvg(task)}</div>
      <div class="tge-header-grid">
        <div class="tge-field"><label>任务 ID</label><input data-task-field="id" value="${this._escape(task.id || '')}" placeholder="task.main.example"></div>
        <div class="tge-field"><label>任务名称</label><input data-task-field="title" value="${this._escape(task.title || '')}" placeholder="任务名称"></div>
        <div class="tge-field full"><label>任务描述</label><textarea data-task-field="description" rows="2" placeholder="玩家为什么要完成这个任务">${this._escape(task.description || '')}</textarea></div>
        <div class="tge-field"><label>任务分类</label><select data-task-field="category">${categories.map(([value, label]) => `<option value="${value}" ${task.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="tge-field"><label>生成方式</label><select data-linear-mode>
          <option value="sequence" ${mode === 'sequence' ? 'selected' : ''}>按顺序逐项完成</option>
          <option value="parallel-all" ${mode === 'parallel-all' ? 'selected' : ''}>多项目标全部完成</option>
          <option value="parallel-any" ${mode === 'parallel-any' ? 'selected' : ''}>多项目标任意完成一项</option>
        </select></div>
      </div>
      <div class="tge-node-toolbar">
        <h3>玩家任务步骤（${steps.length}）</h3>
        <button type="button" data-action="add-node">+ 添加下一步</button>
      </div>
      <div class="tge-nodes">
        ${steps.map((step, index) => this._linearStepCard(step, index, steps.length)).join('') || '<div class="tge-empty compact">暂无步骤，请添加玩家要完成的第一件事</div>'}
      </div>`;
    target.querySelectorAll('[data-task-field]').forEach(input => input.addEventListener('change', () => {
      this._updateTaskField(input.dataset.taskField, input.value);
      if (input.dataset.taskField === 'id') this._renderDetail();
    }));
    target.querySelector('[data-linear-mode]')?.addEventListener('change', event => {
      this._generateLinearGraph(task, steps, event.target.value);
      this._renderDetail();
    });
    target.querySelector('[data-action="add-node"]')?.addEventListener('click', () => this._addNode());
    target.querySelectorAll('[data-linear-step]').forEach(card => this._bindLinearStep(card));
    target.querySelectorAll('[data-graph-node-index]').forEach(node => node.addEventListener('click', () => {
      const nodeId = list(task.nodes)[Number(node.dataset.graphNodeIndex)]?.id;
      target.querySelector(`[data-linear-node-id="${CSS.escape(nodeId || '')}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }));
  }

  _requiresLinearConversion(task) {
    const nodes = list(task?.nodes);
    return nodes.some(node => node?.type === 'branch' || node?.type === 'fail')
      || nodes.filter(node => node?.type === 'parallel').length > 1;
  }

  _authoringMode(task) {
    const parallel = list(task?.nodes).find(node => node?.type === 'parallel');
    if (!parallel) return 'sequence';
    return parallel.joinPolicy === 'any' ? 'parallel-any' : 'parallel-all';
  }

  _authoringSteps(task) {
    return list(task?.nodes).filter(node => node?.type === 'objective');
  }

  _linearStepCard(step, index, total) {
    const resolved = this._resolveStepObjectiveType(step);
    const descriptor = resolved.descriptor;
    const isCustom = descriptor?.type === 'custom.event';
    let eventSelectHtml = '';
    let identityControls = '';
    if (isCustom) {
      // 自定义事件：从事件目录自由选择完成事件 + 事件级身份字段
      const eventType = step.eventMatcher?.type || '';
      const events = getTriggerEvents(this.project);
      const eventDescriptor = getTriggerEventDescriptor(eventType, this.project);
      const fields = Array.isArray(eventDescriptor?.identityFields) ? eventDescriptor.identityFields : [];
      let eventOptions = events.map(event => `<option value="${this._escape(event.value)}" ${event.value === eventType ? 'selected' : ''}>${this._escape(event.label)}</option>`).join('');
      if (eventType && !events.some(event => event.value === eventType)) {
        eventOptions = `<option value="${this._escape(eventType)}" selected>当前事件（目录未登记）</option>${eventOptions}`;
      }
      eventSelectHtml = `<div class="tge-field"><label>完成事件</label><select data-linear-field="eventType"><option value="">-- 请选择事件 --</option>${eventOptions}</select></div>`;
      identityControls = fields.map(field => this._identitySelect(field, step.eventMatcher?.payload?.[field], eventDescriptor)).join('');
    } else if (descriptor) {
      // 目录类型：eventMatcher 由目录模板生成，身份字段按目录配置渲染
      identityControls = descriptor.identityFields
        .map(field => this._identityFieldSelect(field, resolved.identityValues[field.name] ?? '')).join('');
    }
    const requiredCount = Math.max(1, Math.floor(Number(step.requiredCount) || 1));
    const progressBy = descriptor?.progressBy || step.progressBy || null;
    const progressLabel = progressBy ? `按「${this._escape(progressBy)}」份数累计` : '按事件次数累计';
    const typeOptions = objectiveTypeOptions(this.project);
    const typeValue = descriptor?.type || '';
    const typeOptionsHtml = typeOptions
      .map(option => `<option value="${this._escape(option.value)}" ${option.value === typeValue ? 'selected' : ''}>${this._escape(option.label)}</option>`)
      .join('');
    const typeFallback = typeValue && !typeOptions.some(option => option.value === typeValue)
      ? `<option value="${this._escape(typeValue)}" selected>当前类型（目录未登记）</option>` : '';
    return `
      <article class="tge-node tge-linear-step" data-linear-step="${index}" data-linear-node-id="${this._escape(step.id || '')}">
        <div class="tge-node-head">
          <strong>第 ${index + 1} 步</strong>
          <div class="tge-step-actions">
            <button type="button" data-step-move="up" ${index === 0 ? 'disabled' : ''}>上移</button>
            <button type="button" data-step-move="down" ${index === total - 1 ? 'disabled' : ''}>下移</button>
            <button type="button" class="danger" data-action="delete-node">删除</button>
          </div>
        </div>
        <div class="tge-node-grid">
          <div class="tge-field full"><label>步骤名称</label><input data-linear-field="title" value="${this._escape(step.title || '')}" placeholder="玩家看到的目标文字"></div>
          <div class="tge-field"><label>目标类型</label><select data-linear-field="objectiveType">${typeFallback}${typeOptionsHtml}</select></div>
          <div class="tge-field"><label>目标数量</label><select data-linear-field="requiredCount">${this._countOptions(requiredCount)}</select></div>
          ${eventSelectHtml}
          ${identityControls}
          <div class="tge-field full"><small>数量累计：${progressLabel}${descriptor?.description ? ` · ${this._escape(descriptor.description)}` : ''}</small></div>
        </div>
      </article>`;
  }

  /** 解析步骤的目标类型：节点显式 objectiveType 优先，旧数据按 eventMatcher 反推（custom.event 兜底）。 */
  _resolveStepObjectiveType(step) {
    const explicit = step?.objectiveType ? getObjectiveTypeDescriptor(step.objectiveType, this.project) : null;
    if (explicit) {
      const payload = step?.eventMatcher?.payload || {};
      const identityValues = {};
      for (const field of explicit.identityFields) {
        const value = payload[field.name];
        identityValues[field.name] = value === undefined || value === null ? '' : String(value);
      }
      const identityNames = new Set(explicit.identityFields.map(field => field.name));
      const extraPayload = {};
      for (const [key, value] of Object.entries(payload)) {
        if (!identityNames.has(key)) extraPayload[key] = value;
      }
      return { descriptor: explicit, identityValues, extraPayload };
    }
    return matchObjectiveType(step?.eventMatcher, this.project);
  }

  _bindLinearStep(card) {
    const index = Number(card.dataset.linearStep);
    card.querySelector('[data-action="delete-node"]')?.addEventListener('click', () => this._deleteNode(index));
    card.querySelectorAll('[data-step-move]').forEach(button => button.addEventListener('click', () => {
      this._moveLinearStep(index, button.dataset.stepMove === 'up' ? -1 : 1);
    }));
    card.querySelectorAll('[data-linear-field]').forEach(control => control.addEventListener('change', () => {
      this._updateLinearStep(index, control.dataset.linearField, control.value);
    }));
    card.querySelectorAll('[data-identity-field]').forEach(control => control.addEventListener('change', () => {
      this._updateLinearStep(index, `identity:${control.dataset.identityField}`, control.value);
    }));
  }

  _identitySelect(field, currentValue, descriptor = null) {
    const title = descriptor?.paramsSchema?.properties?.[field]?.title || field;
    const options = this._selectionValues('', field, currentValue);
    return `<div class="tge-field"><label>${this._escape(title)}</label><select data-identity-field="${this._escape(field)}"><option value="">-- 不限定 --</option>${options}</select></div>`;
  }

  /** 目录目标类型的身份字段下拉：label 取自目录，候选按 source 标识分派。 */
  _identityFieldSelect(field, currentValue) {
    const options = this._selectionValues(field.source || '', field.name, currentValue);
    return `<div class="tge-field"><label>${this._escape(field.label)}</label><select data-identity-field="${this._escape(field.name)}"><option value="">-- 不限定 --</option>${options}</select></div>`;
  }

  _selectionValues(source, field, currentValue) {
    const values = [];
    const add = (value, label = value) => {
      const id = String(value || '').trim();
      if (id && !values.some(item => item.value === id)) values.push({ value: id, label: String(label || id) });
    };
    if (source === 'libraryItems') {
      for (const item of [...list(this.project?.library?.items), ...list(this.project?.library?.equipment)]) add(item?.id, item?.name);
    }
    else if (source === 'commands') list(this.project?.commands).forEach(command => add(command?.id, command?.name || command?.id));
    else if (source === 'enemyRoles') {
      [['firstWolf', '教学狼'], ['chaseWolf', '追逐狼']].forEach(([value, label]) => add(value, label));
    }
    else if (field === 'sceneId') {
      let scenes = list(this.project?.scenes);
      try { scenes = list(this.getSceneList()) || scenes; } catch { /* 保留项目场景目录 */ }
      scenes.forEach(scene => add(scene?.id, scene?.name));
    }
    else if (field === 'bindingId') {
      let documents = [];
      try {
        const source = this.getSceneDocuments();
        documents = Array.isArray(source) ? source : Object.values(source || {});
      } catch { documents = []; }
      for (const document of documents) {
        for (const layer of list(document?.layers)) {
          for (const object of list(layer?.objects)) {
            if (object?.type === 'trigger') add(object.id, object.name || object.id);
          }
        }
      }
    }
    else if (field === 'definitionId') list(this.project?.commands).forEach(command => add(command?.id, command?.name || command?.id));
    else if (field === 'triggerId') list(this.project?.triggers).forEach(trigger => add(trigger?.id, trigger?.name));
    else if (field === 'questId') list(this.project?.quests).forEach(quest => add(quest?.id, quest?.title || quest?.name));
    else if (field === 'dialogueId' || field === 'id') list(this.project?.dialogues).forEach(dialogue => add(dialogue?.id, dialogue?.title || dialogue?.name));
    else if (field === 'itemId' || field === 'item') {
      for (const item of [...list(this.project?.library?.items), ...list(this.project?.library?.equipment)]) add(item?.id, item?.name);
    } else if (field === 'enemyRole') {
      [['firstWolf', '教学狼'], ['chaseWolf', '追逐狼']].forEach(([value, label]) => add(value, label));
    } else if (field === 'resourceType') {
      [['wood', '木材'], ['iron', '铁料'], ['food', '粮食'], ['herb', '草药'], ['stone', '石料']].forEach(([value, label]) => add(value, label));
    } else if (field === 'classId') {
      [['warrior', '战士'], ['archer', '弓手'], ['strategist', '军师']].forEach(([value, label]) => add(value, label));
    }
    add(currentValue, currentValue ? `${currentValue}（当前值）` : '');
    return values.map(item => `<option value="${this._escape(item.value)}" ${item.value === currentValue ? 'selected' : ''}>${this._escape(item.label)}</option>`).join('');
  }

  _countOptions(selected = 1) {
    const values = [1, 2, 3, 4, 5, 10, 20, 50, 100];
    if (!values.includes(selected)) values.push(selected);
    return values.sort((a, b) => a - b).map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`).join('');
  }

  _updateLinearStep(index, field, value) {
    const task = this._task();
    const steps = this._authoringSteps(task).map(clone);
    const step = steps[index];
    if (!step) return;
    if (field === 'title') step.title = value;
    else if (field === 'objectiveType') {
      const descriptor = getObjectiveTypeDescriptor(value, this.project);
      if (!descriptor) return;
      const previous = this._resolveStepObjectiveType(step);
      // matcherType 不变时保留非身份字段（如 gathering.completed 的 resourceType 限定）
      const keepExtra = previous.descriptor && previous.descriptor.matcherType === descriptor.matcherType
        ? (previous.extraPayload || {})
        : {};
      step.objectiveType = descriptor.type;
      step.eventMatcher = clone(buildEventMatcher(descriptor, previous.identityValues || {}, keepExtra));
      if (descriptor.progressBy) step.progressBy = descriptor.progressBy;
      else delete step.progressBy;
    }
    else if (field === 'eventType') {
      step.objectiveType = 'custom.event';
      delete step.progressBy;
      step.eventMatcher = { type: value, payload: {} };
    }
    else if (field === 'requiredCount') step.requiredCount = Math.max(1, Number(value) || 1);
    else if (field.startsWith('identity:')) {
      const identity = field.slice('identity:'.length);
      step.eventMatcher ||= { type: '', payload: {} };
      step.eventMatcher.payload ||= {};
      if (value) step.eventMatcher.payload[identity] = value;
      else delete step.eventMatcher.payload[identity];
    }
    this._generateLinearGraph(task, steps, this._authoringMode(task));
    this._renderDetail();
  }

  _moveLinearStep(index, offset) {
    const task = this._task();
    const steps = this._authoringSteps(task).map(clone);
    const target = index + offset;
    if (!steps[index] || target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    this._generateLinearGraph(task, steps, this._authoringMode(task));
    this._renderDetail();
  }

  _generateLinearGraph(task, inputSteps, mode = 'sequence') {
    const existingStart = list(task.nodes).find(node => node?.type === 'start');
    const existingComplete = list(task.nodes).find(node => node?.type === 'complete');
    const existingParallel = list(task.nodes).find(node => node?.type === 'parallel');
    const startId = existingStart?.id || `${task.id}.start`;
    const completeId = existingComplete?.id || `${task.id}.complete`;
    const steps = inputSteps.map((step, index) => ({
      ...clone(step),
      id: step.id || `${task.id}.step.${String(index + 1).padStart(2, '0')}`,
      type: 'objective',
      title: step.title || `任务步骤 ${index + 1}`,
      eventMatcher: clone(step.eventMatcher || { type: '', payload: {} })
    }));
    if (mode === 'parallel-all' || mode === 'parallel-any') {
      const parallelId = existingParallel?.id || `${task.id}.parallel`;
      task.entryNodeId = startId;
      task.nodes = [
        { ...(existingStart || {}), id: startId, type: 'start', next: [parallelId] },
        { ...(existingParallel || {}), id: parallelId, type: 'parallel', children: steps.map(step => step.id), joinPolicy: mode === 'parallel-any' ? 'any' : 'all', next: [completeId] },
        ...steps.map(step => ({ ...step, next: [] })),
        { ...(existingComplete || {}), id: completeId, type: 'complete' }
      ];
      return;
    }
    task.entryNodeId = startId;
    task.nodes = [
      { ...(existingStart || {}), id: startId, type: 'start', next: steps.length ? [steps[0].id] : [completeId] },
      ...steps.map((step, index) => ({ ...step, next: [steps[index + 1]?.id || completeId] })),
      { ...(existingComplete || {}), id: completeId, type: 'complete' }
    ];
  }

  _graphSvg(task) {
    const nodes = list(task.nodes);
    if (nodes.length === 0) return '<div class="tge-empty compact">暂无任务节点图</div>';
    const columns = Math.min(4, Math.max(1, nodes.length));
    const cellWidth = 190;
    const cellHeight = 92;
    const width = columns * cellWidth + 40;
    const height = Math.ceil(nodes.length / columns) * cellHeight + 40;
    const positions = new Map(nodes.map((node, index) => [node.id, {
      index,
      x: 20 + (index % columns) * cellWidth,
      y: 20 + Math.floor(index / columns) * cellHeight
    }]));
    const targets = node => [
      ...list(node.next),
      ...(node.type === 'parallel' ? list(node.children) : []),
      ...(node.type === 'branch' ? list(node.branches).map(branch => branch?.targetNodeId).filter(Boolean) : [])
    ];
    const edges = nodes.flatMap(node => {
      const from = positions.get(node.id);
      return targets(node).flatMap(targetId => {
        const to = positions.get(targetId);
        if (!from || !to) return [];
        return [`<path d="M ${from.x + 150} ${from.y + 25} C ${from.x + 170} ${from.y + 25}, ${to.x - 20} ${to.y + 25}, ${to.x} ${to.y + 25}"/>`];
      });
    }).join('');
    const nodeSvg = nodes.map((node, index) => {
      const position = positions.get(node.id);
      return `<g class="tge-graph-node" data-graph-node-index="${index}" transform="translate(${position.x},${position.y})">
        <rect width="150" height="50" rx="6"/>
        <text x="10" y="20">${this._escape(node.title || node.id)}</text>
        <text class="type" x="10" y="39">${this._escape(node.type)}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="任务节点图">
      <g class="tge-graph-edges">${edges}</g>${nodeSvg}
    </svg>`;
  }

  _addTask() {
    const id = prompt('任务 ID（英文稳定标识）：', this._nextId('task'))?.trim();
    if (!id) return;
    if (!stableId(id)) return this._toast('任务 ID 只能使用字母开头的字母、数字、点、下划线和短横线', 'error');
    if (this.taskGraphs.some(task => task?.id === id)) return this._toast(`任务 ID 已存在：${id}`, 'error');
    const title = prompt('任务标题：', id)?.trim() || id;
    const startId = `${id}.start`;
    const firstStepId = `${id}.step.01`;
    const completeId = `${id}.complete`;
    this.taskGraphs.push({
      id,
      title,
      description: '',
      category: 'main',
      entryNodeId: startId,
      nodes: [
        { id: startId, type: 'start', next: [firstStepId] },
        { id: firstStepId, type: 'objective', title: '第一个任务目标', next: [completeId], eventMatcher: { type: 'sceneEnter', payload: {} } },
        { id: completeId, type: 'complete' }
      ]
    });
    this.selectedIndex = this.taskGraphs.length - 1;
    this._render();
  }

  _deleteTask() {
    const task = this._task();
    if (!task) return;
    if (!confirm(`确定删除任务图“${task.title || task.id}”吗？`)) return;
    this.taskGraphs.splice(this.selectedIndex, 1);
    this.selectedIndex = Math.min(this.selectedIndex, this.taskGraphs.length - 1);
    this._render();
  }

  _addNode() {
    const task = this._task();
    if (!task) return;
    const steps = this._authoringSteps(task).map(clone);
    const ids = new Set(list(task.nodes).map(node => node?.id));
    let sequence = steps.length + 1;
    let id;
    do id = `${task.id || 'task'}.step.${String(sequence++).padStart(2, '0')}`;
    while (ids.has(id));
    steps.push({
      id,
      type: 'objective',
      title: `任务步骤 ${steps.length + 1}`,
      eventMatcher: { type: 'sceneEnter', payload: {} },
      requiredCount: 1
    });
    this._generateLinearGraph(task, steps, this._authoringMode(task));
    this._renderDetail();
  }

  _deleteNode(index) {
    const task = this._task();
    const steps = this._authoringSteps(task).map(clone);
    const step = steps[index];
    if (!step) return;
    if (!confirm(`确定删除步骤“${step.title || index + 1}”吗？`)) return;
    steps.splice(index, 1);
    this._generateLinearGraph(task, steps, this._authoringMode(task));
    this._renderDetail();
  }

  _updateTaskField(field, value) {
    const task = this._task();
    if (!task) return;
    if (field === 'id' && value !== task.id) {
      if (!stableId(value)) return this._toast('任务 ID 格式无效', 'error');
      if (this.taskGraphs.some(item => item !== task && item?.id === value)) return this._toast(`任务 ID 已存在：${value}`, 'error');
    }
    task[field] = value;
    this._renderList();
  }

  _validateDefinitions() {
    const validation = validateTaskGraphDefinitions(this.taskGraphs);
    if (validation.ok) return { ok: true };
    const first = validation.errors[0];
    return {
      ok: false,
      code: first?.code || 'invalidTaskGraph',
      message: [first?.path, first?.message].filter(Boolean).join(': ') || '任务图校验失败'
    };
  }

  _task() { return this.taskGraphs[this.selectedIndex] || null; }
  _nextId(prefix) {
    let index = 1;
    while (this.taskGraphs.some(task => task?.id === `${prefix}.${index}`)) index += 1;
    return `${prefix}.${index}`;
  }
  _escape(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
  _saveError(result) {
    const first = result?.errors?.[0];
    return [first?.path, first?.message || first?.reason].filter(Boolean).join(': ')
      || result?.error?.message || result?.error || '磁盘未提交';
  }
  _status(message, kind = '') {
    const target = this.container.querySelector('[data-role="status"]');
    if (target) { target.textContent = message; target.className = `tge-status ${kind}`; }
  }
  _toast(message, type = 'success') {
    let target = document.getElementById('tge-toast');
    if (!target) {
      target = document.createElement('div');
      target.id = 'tge-toast';
      target.className = 'tge-toast';
      document.body.appendChild(target);
    }
    target.textContent = message;
    target.dataset.type = type;
    target.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => target.classList.remove('visible'), 2600);
  }

  _injectStyles() {
    if (document.getElementById('tge-styles')) return;
    const style = document.createElement('style');
    style.id = 'tge-styles';
    style.textContent = `
      .tge-root{height:100%;display:flex;flex-direction:column;background:#0d1326;color:#fff;font-size:13px}.tge-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#16213e;border-bottom:1px solid #2a3a5e}.tge-toolbar button,.tge-node-toolbar button{padding:7px 12px;border:0;border-radius:4px;background:#3a4a7e;color:#fff;cursor:pointer}.tge-toolbar .primary{background:#4caf50;color:#102010;font-weight:bold}.tge-toolbar .danger,.tge-node .danger{background:#7e3a3a}.tge-hint{margin-left:auto;color:#8aa;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tge-main{min-height:0;flex:1;display:flex;overflow:hidden}.tge-list{width:240px;flex:none;overflow:auto;background:#111a30;border-right:1px solid #2a3a5e}.tge-task{display:flex;width:100%;flex-direction:column;gap:3px;padding:10px 13px;text-align:left;color:#fff;background:transparent;border:0;border-bottom:1px solid #1e2b47;cursor:pointer}.tge-task:hover{background:#1a2540}.tge-task.active{background:#2a3a6e}.tge-task small{color:#9ab}.tge-detail{min-width:0;flex:1;overflow:auto;padding:16px}.tge-graph{margin-bottom:16px;overflow:auto;border:1px solid #2a3a5e;border-radius:6px;background:#091020}.tge-graph svg{display:block;min-width:100%;height:auto;max-height:330px}.tge-graph-edges path{fill:none;stroke:#6d84c7;stroke-width:2}.tge-graph-node{cursor:pointer}.tge-graph-node rect{fill:#17264a;stroke:#7d98db;stroke-width:1.5}.tge-graph-node:hover rect{fill:#294078;stroke:#b9ceff}.tge-graph-node text{fill:#fff;font-size:11px;pointer-events:none}.tge-graph-node text.type{fill:#8fa7d8;font-size:10px}.tge-header-grid,.tge-node-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.tge-field{min-width:0}.tge-field.full{grid-column:1/-1}.tge-field label,.tge-json-field label{display:block;margin-bottom:4px;color:#9ab;font-size:12px}.tge-field input,.tge-field select,.tge-field textarea,.tge-json-field textarea{width:100%;padding:7px;border:1px solid #2a3a5e;border-radius:3px;background:#0a1020;color:#fff;font:inherit}.tge-field textarea{resize:vertical}.tge-field small,.tge-json-field small{display:block;margin-top:4px;color:#789;font-size:11px}.tge-authoring-note{margin-bottom:12px;padding:10px 12px;border:1px solid #3b6b54;border-radius:5px;background:#10251e;color:#a9d8bc}.tge-step-actions{display:flex;gap:6px}.tge-step-actions button{padding:4px 8px;border:0;border-radius:3px;background:#3a4a7e;color:#fff;cursor:pointer}.tge-step-actions button:disabled{opacity:.35;cursor:default}.tge-node-toolbar{display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px}.tge-node-toolbar h3{font-size:14px}.tge-node{margin-bottom:12px;padding:12px;border:1px solid #2a3a5e;border-radius:6px;background:#0f1830}.tge-node-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.tge-node-head button{padding:4px 8px;border:0;border-radius:3px;color:#fff;cursor:pointer}.tge-json-field{margin-top:10px}.tge-json-field textarea{resize:vertical;font-family:Consolas,monospace;font-size:12px}.tge-json-field textarea.invalid{border-color:#e66;box-shadow:0 0 0 1px #e66}.tge-status{min-height:30px;padding:7px 16px;background:#0a1020;color:#9ab}.tge-status.ok{color:#6c6}.tge-status.warn{color:#e6bd5d}.tge-status.error{color:#e66}.tge-empty{padding:38px 16px;color:#789;text-align:center;line-height:1.7}.tge-empty.compact{padding:18px}.tge-toast{position:fixed;top:58px;left:50%;z-index:100000;max-width:min(600px,90vw);padding:10px 18px;border-radius:6px;background:#2e7d32;color:#fff;box-shadow:0 4px 16px #0008;opacity:0;pointer-events:none;transform:translate(-50%,-8px);transition:opacity .2s,transform .2s}.tge-toast[data-type="error"]{background:#c62828}.tge-toast[data-type="warn"]{background:#9a6700}.tge-toast.visible{opacity:1;transform:translate(-50%,0)}@media (max-width:800px){.tge-list{width:180px}.tge-header-grid,.tge-node-grid{grid-template-columns:1fr}.tge-field.full{grid-column:auto}.tge-hint{display:none}}
    `;
    document.head.appendChild(style);
  }
}

export default TaskGraphEditor;

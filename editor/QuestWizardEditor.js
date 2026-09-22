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
  getObjectiveTypeDescriptor,
  objectiveTypeOptions
} from '../src/systems/quest/ObjectiveTypeRegistry.js';
import { getFactOptions } from '../src/systems/quest/FactCatalog.js';
import {
  compileQuest,
  validateQuestCompilation,
  validateQuestDefinition
} from '../src/systems/quest/QuestRuntime.js';
import { getTriggerEventDescriptor, getTriggerEvents, validateTriggerActionParams } from '../src/systems/TriggerCatalog.js';

const clone = value => structuredClone(value);
const list = value => Array.isArray(value) ? value : [];
const stableId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]*$/.test(value);
const text = value => typeof value === 'string' ? value.trim() : '';

const STEP_TYPES = Object.freeze([
  ['dialogue', '对话'],
  ['tutorial', '教程'],
  ['objective', '目标'],
  ['action', '动作']
]);
const CATEGORIES = Object.freeze([
  ['main', '主线任务'], ['side', '支线任务'], ['event', '事件任务'], ['tutorial', '教学任务']
]);
const ACCEPT_SOURCES = Object.freeze([
  ['fact', '事实提交（状态事务）'], ['questCompleted', '前置任务完成'], ['event', '原始事件']
]);

/**
 * QuestWizardEditor - 任务中心制任务向导（编辑 project.quests[]，Quest v2 Schema）
 *
 * 五区块表单：元信息 / 接取 / 步骤（对话·教程·目标·动作可插组合）/ 奖励 / 后续任务。
 * 下拉候选由目录驱动：目标类型目录（ObjectiveTypeRegistry）、事实目录（FactCatalog）、
 * 事件目录（TriggerCatalog）。底部「编译预览」实时展示保存后运行时将生成的
 * taskGraph 定义与触发器产物（QuestRuntime 编译），校验错误就地提示。
 *
 * 保存契约：validateQuestDefinition 全部通过后才允许提交（产物由运行时编译器二次校验）。
 */
export class QuestWizardEditor {
  constructor(container, { canonicalSession, projectPath = '', getSceneList = () => [], getSceneDocuments = () => [] } = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError('QuestWizardEditor requires a container element');
    if (!canonicalSession) throw new TypeError('QuestWizardEditor requires a shared CanonicalEditorSession');
    this.container = container;
    this.canonicalSession = canonicalSession;
    this.projectPath = projectPath || canonicalSession.sourceUri;
    this.getSceneList = typeof getSceneList === 'function' ? getSceneList : () => [];
    this.getSceneDocuments = typeof getSceneDocuments === 'function' ? getSceneDocuments : () => [];
    this.project = null;
    this.quests = [];
    this.tutorials = [];
    this._tutorialsDirty = false;
    this._expandedTutSteps = new Set(); // 展开就地编辑的教程 ID（tutorial 步骤卡）
    this.dialogues = [];
    this._dialoguesDirty = false;
    this._expandedDlgSteps = new Set(); // 展开就地编辑的对话 ID（dialogue 步骤卡）
    this.selectedId = null;
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
      throw new Error('QuestWizardEditor: canonical project candidate 不可用');
    }
    this.project = project;
    this.quests = list(project.quests).map(clone);
    this.tutorials = list(project.tutorials).map(clone);
    this._tutorialsDirty = false;
    this._expandedTutSteps = new Set();
    this.dialogues = list(project.dialogues).map(clone);
    this._dialoguesDirty = false;
    this._expandedDlgSteps = new Set();
    if (this.selectedId && !this.quests.some(quest => quest?.id === this.selectedId)) this.selectedId = null;
  }

  async save() {
    const errors = [];
    for (const quest of this.quests) {
      for (const message of validateQuestDefinition(quest)) errors.push(`${quest?.id || '(未命名)'}: ${message}`);
    }
    const compilationErrors = validateQuestCompilation({
      taskGraphs: this.quests.map(quest => compileQuest(quest, this.project).taskGraph),
      triggers: this.quests.flatMap(quest => compileQuest(quest, this.project).triggers)
    });
    errors.push(...compilationErrors);
    if (errors.length) {
      const message = `任务定义校验失败：${errors[0]}`;
      this._status(`❌ ${message}`, 'error');
      this._toast(message, 'error');
      return { ok: false, committed: false, status: 'rejected', errors };
    }
    try {
      this.canonicalSession.patch('quests', clone(this.quests));
      if (this._tutorialsDirty) this.canonicalSession.patch('tutorials', clone(this.tutorials));
      if (this._dialoguesDirty) this.canonicalSession.patch('dialogues', clone(this.dialogues));
      const result = await this.canonicalSession.save();
      if (result?.ok === true && result.committed === true) {
        const extras = [this._tutorialsDirty && '内嵌教程修改', this._dialoguesDirty && '内嵌对话修改'].filter(Boolean).join('与');
        const message = result.degraded
          ? '磁盘已提交，但缓存或通知同步降级'
          : `已保存 ${this.quests.length} 个任务${extras ? `与${extras}` : ''}`;
        this._tutorialsDirty = false;
        this._dialoguesDirty = false;
        this._status(`${result.degraded ? '⚠️' : '✅'} ${message}`, result.degraded ? 'warn' : 'ok');
        this._toast(message, result.degraded ? 'warn' : 'success');
        return result;
      }
      const failMessage = this._saveError(result);
      this._status(`❌ 保存失败：${failMessage}`, 'error');
      this._toast(`保存失败：${failMessage}`, 'error');
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
      <div class="qwe-root">
        <div class="qwe-toolbar">
          <button type="button" data-action="add-quest">+ 新建任务</button>
          <button type="button" data-action="delete-quest" class="danger">删除任务</button>
          <button type="button" data-action="save" class="primary">保存到工程</button>
          <span class="qwe-hint">任务中心 · 触发器/教程/对话都是任务的步骤</span>
        </div>
        <div class="qwe-main">
          <aside class="qwe-list" data-role="quest-list"></aside>
          <section class="qwe-detail" data-role="quest-detail"></section>
        </div>
        <div class="qwe-status" data-role="status"></div>
      </div>`;
    this.container.querySelector('[data-action="add-quest"]').addEventListener('click', () => this._addQuest());
    this.container.querySelector('[data-action="delete-quest"]').addEventListener('click', () => this._deleteQuest());
    this.container.querySelector('[data-action="save"]').addEventListener('click', async () => { await this.save(); });
  }

  _render() {
    this._renderList();
    this._renderDetail();
  }

  _renderList() {
    const target = this.container.querySelector('[data-role="quest-list"]');
    if (!target) return;
    if (this.quests.length === 0) {
      target.innerHTML = '<div class="qwe-empty">暂无任务<br>点击“+ 新建任务”开始</div>';
      return;
    }
    target.innerHTML = this.quests.map(quest => `
      <button type="button" class="qwe-quest ${quest?.id === this.selectedId ? 'active' : ''}" data-quest-id="${this._escape(quest?.id || '')}">
        <strong>${this._escape(quest?.title || quest?.id || '未命名任务')}</strong>
        <small>${this._escape(quest?.id || '缺少 id')} · ${list(quest?.steps).filter(step => step?.type === 'objective').length} 目标 / ${list(quest?.steps).length} 步骤</small>
      </button>`).join('');
    target.querySelectorAll('[data-quest-id]').forEach(button => button.addEventListener('click', () => {
      this.selectedId = button.dataset.questId;
      this._render();
    }));
  }

  _renderDetail() {
    const target = this.container.querySelector('[data-role="quest-detail"]');
    const quest = this._quest();
    if (!target) return;
    if (!quest) {
      target.innerHTML = '<div class="qwe-empty">选择或新建一个任务</div>';
      return;
    }
    const scenes = this._sceneOptions();
    const accept = quest.accept || {};
    // 三态：external（accept 缺省，由现有触发器接取）/ auto（运行时自动）/ manual（NPC 触发器接取）
    const acceptMode = quest.accept ? (text(accept.mode) || 'auto') : 'external';
    const acceptWhen = accept.when || {};
    target.innerHTML = `
      <div class="qwe-note">从上到下填写玩家的经历；保存后运行时自动编译为任务图与编排触发器，触发器/教程/对话都是这里的步骤。</div>
      <div class="qwe-graph" data-role="quest-graph">${this._graphSvg(quest)}</div>
      <fieldset class="qwe-block"><legend>① 元信息</legend>
        <div class="qwe-grid">
          <div class="qwe-field"><label>任务 ID</label><input data-quest-field="id" value="${this._escape(quest.id || '')}" placeholder="quest.s01.survival"></div>
          <div class="qwe-field"><label>任务名称</label><input data-quest-field="title" value="${this._escape(quest.title || '')}" placeholder="任务名称"></div>
          <div class="qwe-field full"><label>任务描述</label><textarea data-quest-field="description" rows="2" placeholder="玩家为什么要完成这个任务">${this._escape(quest.description || '')}</textarea></div>
          <div class="qwe-field"><label>任务分类</label><select data-quest-field="category">${CATEGORIES.map(([value, label]) => `<option value="${value}" ${quest.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
          <div class="qwe-field"><label>所属场景（留空=全局）</label><div class="qwe-checks">${scenes.map(([value, label]) => `
            <label class="qwe-check"><input type="checkbox" data-scene-option="${this._escape(value)}" ${list(quest.scenes).includes(value) ? 'checked' : ''}>${this._escape(label)}</label>`).join('')}</div></div>
        </div>
      </fieldset>
      <fieldset class="qwe-block"><legend>② 接取</legend>
        <div class="qwe-grid">
          <div class="qwe-field"><label>接取方式</label><select data-accept-field="mode">
            <option value="external" ${acceptMode === 'external' ? 'selected' : ''}>由现有触发器接取（未定义接取条件）</option>
            <option value="auto" ${acceptMode === 'auto' ? 'selected' : ''}>自动（满足条件即接取）</option>
            <option value="manual" ${acceptMode === 'manual' ? 'selected' : ''}>手动（由 NPC 触发器接取）</option>
          </select></div>
          ${acceptMode === 'auto' ? this._acceptWhenFields(acceptWhen) : acceptMode === 'manual' ? `
          <div class="qwe-field"><label>发布 NPC（giver）</label><input data-giver-field="npcId" value="${this._escape(quest.giver?.npcId || '')}" placeholder="NPC 稳定 ID，如 S01-npc-elder"></div>
          <div class="qwe-field"><label>接取对话（可选）</label><select data-giver-field="dialogueId">${this._optionList(this._dialogueOptions(), quest.giver?.dialogueId, '-- 不绑定 --')}</select></div>
          <div class="qwe-field full"><small>手动接取指引：为该 NPC 的交互触发器编排「对话 → task.command（task.start，definitionId=${this._escape(quest.id || '')}）」；运行时不会自动接取。</small></div>` : `
          <div class="qwe-field full"><small>接取由 triggers[] 中的现有触发器承担（如场景进入触发 task.start）。切换为「自动」可在下方定义接取条件。</small></div>`}
        </div>
      </fieldset>
      <div class="qwe-node-toolbar">
        <h3>任务步骤（${list(quest.steps).length}）</h3>
        <button type="button" data-action="add-step">+ 添加步骤</button>
      </div>
      <div class="qwe-steps">${list(quest.steps).map((step, index, all) => this._stepCard(step, index, all.length)).join('') || '<div class="qwe-empty compact">暂无步骤，请添加玩家的第一件事</div>'}</div>
      <fieldset class="qwe-block"><legend>③ 奖励</legend>
        <div class="qwe-rewards">${list(quest.rewards).map((reward, index) => this._rewardCard(reward, index)).join('') || '<small class="qwe-muted">无奖励（可留空）</small>'}</div>
        <button type="button" data-action="add-reward">+ 添加奖励</button>
      </fieldset>
      <fieldset class="qwe-block"><legend>④ 后续任务</legend>
        <div class="qwe-checks">${this._questOptions(quest.id).map(option => `
          <label class="qwe-check"><input type="checkbox" data-next-option="${this._escape(option.value)}" ${list(quest.next).includes(option.value) ? 'checked' : ''}>${this._escape(option.label)}</label>`).join('') || '<small class="qwe-muted">暂无其他任务可选</small>'}</div>
      </fieldset>
      <fieldset class="qwe-block"><legend>⚙ 编译预览（保存后运行时生成）</legend>${this._compilePreview(quest)}</fieldset>`;
    this._bindDetail(quest);
  }

  /** 任务节点示意图（编译产物 taskGraph 的 start → 目标链 → complete 可视化；点击目标节点定位步骤卡）。 */
  _graphSvg(quest) {
    const { taskGraph } = compileQuest(quest, this.project);
    const nodes = list(taskGraph.nodes);
    if (nodes.length === 0) return '<div class="qwe-empty compact">暂无任务节点图</div>';
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
    const edges = nodes.flatMap(node => {
      const from = positions.get(node.id);
      return list(node.next).flatMap(targetId => {
        const to = positions.get(targetId);
        if (!from || !to) return [];
        return [`<path d="M ${from.x + 150} ${from.y + 25} C ${from.x + 170} ${from.y + 25}, ${to.x - 20} ${to.y + 25}, ${to.x} ${to.y + 25}"/>`];
      });
    }).join('');
    const typeLabel = { start: '开始', complete: '完成', objective: '目标' };
    const nodeSvg = nodes.map(node => {
      const position = positions.get(node.id);
      return `<g class="qwe-graph-node ${node.type}" data-graph-node-id="${this._escape(node.id)}" transform="translate(${position.x},${position.y})">
        <rect width="150" height="50" rx="6"/>
        <text x="10" y="20">${this._escape(node.title || node.id)}</text>
        <text class="type" x="10" y="39">${this._escape(typeLabel[node.type] || node.type)}${node.requiredCount && node.requiredCount > 1 ? ` ×${node.requiredCount}` : ''}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="任务节点示意图">
      <g class="qwe-graph-edges">${edges}</g>${nodeSvg}
    </svg>`;
  }

  _acceptWhenFields(when) {
    const source = text(when.type) || 'fact';
    let valueField = '';
    if (source === 'fact') {
      valueField = `<div class="qwe-field"><label>事实（状态事务）</label><select data-when-field="fact">${this._optionList(getFactOptions(this.project), when.fact, '选择事实')}</select></div>`;
    } else if (source === 'questCompleted') {
      valueField = `<div class="qwe-field"><label>前置任务</label><select data-when-field="questId">${this._optionList(this._questOptions(null), when.questId, '选择前置任务')}</select></div>`;
    } else {
      const events = getTriggerEvents(this.project);
      valueField = `<div class="qwe-field"><label>事件</label><select data-when-field="event">${this._optionList(events.map(item => ({ value: item.value, label: item.label })), when.event, '选择事件')}</select></div>`;
    }
    return `
      <div class="qwe-field"><label>条件来源</label><select data-when-field="type">${ACCEPT_SOURCES.map(([value, label]) => `<option value="${value}" ${value === source ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      ${valueField}`;
  }

  _stepCard(step, index, total) {
    const type = text(step.type) || 'objective';
    let typeFields = '';
    if (type === 'dialogue') {
      const expanded = this._expandedDlgSteps.has(text(step.dialogueId));
      const dialogue = this._getDialogue(step.dialogueId);
      typeFields = `
        <div class="qwe-field"><label>对话</label><select data-step-field="dialogueId">${this._optionList(this._dialogueOptions(), step.dialogueId, '选择对话')}</select></div>
        <div class="qwe-field full">
          <button type="button" data-action="toggle-dlg-edit" data-dlg-id="${this._escape(step.dialogueId || '')}">${expanded ? '▲ 收起对话编辑' : '▼ 就地编辑对话内容'}</button>
          ${expanded ? this._dialogueEditHtml(dialogue) : ''}
        </div>`;
    } else if (type === 'tutorial') {
      const expanded = this._expandedTutSteps.has(text(step.tutorialId));
      const tutorial = this._getTutorial(step.tutorialId);
      typeFields = `
        <div class="qwe-field"><label>教程</label><select data-step-field="tutorialId">${this._optionList(this._tutorialOptions(), step.tutorialId, '选择教程')}</select></div>
        <div class="qwe-field qwe-check-row"><label class="qwe-check"><input type="checkbox" data-step-field="await" ${step.await === true ? 'checked' : ''}>等待教程完成再继续</label></div>
        <div class="qwe-field full">
          <button type="button" data-action="toggle-tut-edit" data-tut-id="${this._escape(step.tutorialId || '')}">${expanded ? '▲ 收起教程编辑' : '▼ 就地编辑教程内容'}</button>
          ${expanded ? this._tutorialEditHtml(tutorial) : ''}
        </div>`;
    } else if (type === 'objective') {
      const descriptor = getObjectiveTypeDescriptor(step.objectiveType, this.project);
      const typeOptions = objectiveTypeOptions(this.project).map(option => `<option value="${this._escape(option.value)}" ${option.value === step.objectiveType ? 'selected' : ''}>${this._escape(option.label)}</option>`).join('');
      const identityField = descriptor?.identityFields?.[0];
      typeFields = `
        <div class="qwe-field"><label>目标类型</label><select data-step-field="objectiveType">${typeOptions}</select></div>
        <div class="qwe-field"><label>${this._escape(identityField?.label || '目标 ID')}</label><select data-step-field="target">${this._targetOptions(descriptor, step.target)}</select></div>
        <div class="qwe-field"><label>目标数量</label><select data-step-field="requiredCount">${this._countOptions(Math.max(1, Math.floor(Number(step.requiredCount) || 1)))}</select></div>
        <div class="qwe-field full"><small>数量累计：${descriptor?.progressBy ? `按「${this._escape(descriptor.progressBy)}」份数累计${step.progressBy === null ? '（本目标已显式关闭）' : ''}` : '按事件次数累计'}${descriptor?.description ? ` · ${this._escape(descriptor.description)}` : ''}</small></div>`;
    } else {
      const paramsText = this._escape(JSON.stringify(step.params || {}, null, 2));
      const paramsErrors = validateTriggerActionParams({ action: step.action, params: step.params || {} }, this.project, 'params');
      typeFields = `
        <div class="qwe-field"><label>动作</label><select data-step-field="action">${this._optionList(this._actionOptions(), step.action, '选择动作')}</select></div>
        <div class="qwe-field full"><label>参数（JSON）</label><textarea data-step-field="params" rows="3" class="${paramsErrors.length ? 'invalid' : ''}">${paramsText}</textarea>
          ${paramsErrors.length ? `<small class="qwe-error">${this._escape(paramsErrors[0])}</small>` : ''}</div>`;
    }
    return `
      <article class="qwe-step" data-step-index="${index}" data-step-id="${this._escape(step.id || '')}">
        <div class="qwe-step-head">
          <strong>第 ${index + 1} 步 · ${this._escape((STEP_TYPES.find(([value]) => value === type) || [type, type])[1])}</strong>
          <div class="qwe-step-actions">
            <button type="button" data-step-move="up" ${index === 0 ? 'disabled' : ''}>上移</button>
            <button type="button" data-step-move="down" ${index === total - 1 ? 'disabled' : ''}>下移</button>
            <button type="button" class="danger" data-action="delete-step">删除</button>
          </div>
        </div>
        <div class="qwe-grid">
          <div class="qwe-field full"><label>步骤名称（玩家看到的目标文字）</label><input data-step-field="title" value="${this._escape(step.title || '')}" placeholder="仅目标步骤会显示在任务追踪"></div>
          <div class="qwe-field"><label>步骤类型</label><select data-step-field="type">${STEP_TYPES.map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
          <div class="qwe-field"><label>步骤 ID</label><input data-step-field="id" value="${this._escape(step.id || '')}" placeholder="英文稳定标识"></div>
          ${typeFields}
        </div>
      </article>`;
  }

  _rewardCard(reward, index) {
    const type = reward?.type === 'items' ? 'items' : 'state';
    return `
      <div class="qwe-reward" data-reward-index="${index}">
        <div class="qwe-grid">
          <div class="qwe-field"><label>奖励类型</label><select data-reward-field="type">
            <option value="state" ${type === 'state' ? 'selected' : ''}>状态事实</option>
            <option value="items" ${type === 'items' ? 'selected' : ''}>物品</option>
          </select></div>
          ${type === 'state'
            ? `<div class="qwe-field"><label>事实（状态事务）</label><select data-reward-field="definitionId">${this._optionList(getFactOptions(this.project), reward.definitionId, '选择事实')}</select></div>`
            : `<div class="qwe-field"><label>物品</label><select data-reward-field="itemId">${this._optionList(this._itemOptions(), reward.items?.[0]?.itemId, '选择物品')}</select></div>
               <div class="qwe-field"><label>数量</label><input type="number" min="1" data-reward-field="count" value="${Math.max(1, Math.floor(Number(reward.items?.[0]?.count) || 1))}"></div>`}
          <div class="qwe-field qwe-check-row"><button type="button" class="danger" data-action="delete-reward">删除奖励</button></div>
        </div>
      </div>`;
  }

  _compilePreview(quest) {
    const { taskGraph, triggers } = compileQuest(quest, this.project);
    const errors = validateQuestCompilation({ taskGraphs: [taskGraph], triggers });
    const objectives = taskGraph.nodes.filter(node => node.type === 'objective');
    const chain = objectives.map(node => this._escape(node.title || node.id)).join(' → ') || '（无目标）';
    const triggerRows = triggers.map(trigger => `<li>${this._escape(trigger.id)}：${this._escape(trigger.when.type)} → ${trigger.do.length} 个动作</li>`).join('');
    return `
      <div class="qwe-preview">
        <p><strong>任务图</strong>：开始 → ${chain} → 完成</p>
        <p><strong>触发器产物</strong>：${triggers.length ? `<ul>${triggerRows}</ul>` : '无（接取/奖励由现有触发器或空奖励承担）'}</p>
        ${errors.length ? `<p class="qwe-error">编译校验：${this._escape(errors[0])}</p>` : '<p class="qwe-ok">编译校验通过</p>'}
      </div>`;
  }

  _bindDetail(quest) {
    const target = this.container.querySelector('[data-role="quest-detail"]');
    target.querySelectorAll('[data-quest-field]').forEach(input => input.addEventListener('change', () => {
      this._updateQuestField(quest, input.dataset.questField, input.value);
    }));
    target.querySelectorAll('[data-scene-option]').forEach(input => input.addEventListener('change', () => {
      const scenes = new Set(list(quest.scenes));
      if (input.checked) scenes.add(input.dataset.sceneOption);
      else scenes.delete(input.dataset.sceneOption);
      quest.scenes = [...scenes];
      this._renderDetail();
    }));
    target.querySelectorAll('[data-accept-field]').forEach(input => input.addEventListener('change', () => {
      this._updateAcceptField(quest, input.dataset.acceptField, input.value);
    }));
    target.querySelectorAll('[data-giver-field]').forEach(input => input.addEventListener('change', () => {
      quest.giver = { ...(quest.giver || {}), [input.dataset.giverField]: input.value };
    }));
    target.querySelectorAll('[data-next-option]').forEach(input => input.addEventListener('change', () => {
      const next = new Set(list(quest.next));
      if (input.checked) next.add(input.dataset.nextOption);
      else next.delete(input.dataset.nextOption);
      quest.next = [...next];
    }));
    target.querySelectorAll('[data-step-index]').forEach(card => this._bindStep(quest, card));
    // 示意图节点点击 → 滚动定位到对应步骤卡
    target.querySelectorAll('[data-graph-node-id]').forEach(node => node.addEventListener('click', () => {
      const stepId = node.dataset.graphNodeId;
      target.querySelector(`[data-step-id="${window.CSS?.escape?.(stepId) ?? stepId}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }));
    target.querySelectorAll('[data-reward-index]').forEach(card => this._bindReward(quest, card));
    target.querySelector('[data-action="add-step"]')?.addEventListener('click', () => this._addStep(quest));
    target.querySelector('[data-action="add-reward"]')?.addEventListener('click', () => this._addReward(quest));
  }

  _bindStep(quest, card) {
    const index = Number(card.dataset.stepIndex);
    const step = list(quest.steps)[index];
    if (!step) return;
    card.querySelector('[data-action="delete-step"]')?.addEventListener('click', () => {
      if (!confirm(`确定删除步骤“${step.title || step.id || index + 1}”吗？`)) return;
      quest.steps.splice(index, 1);
      this._renderDetail();
    });
    card.querySelectorAll('[data-step-move]').forEach(button => button.addEventListener('click', () => {
      const offset = button.dataset.stepMove === 'up' ? -1 : 1;
      const target = index + offset;
      if (target < 0 || target >= quest.steps.length) return;
      [quest.steps[index], quest.steps[target]] = [quest.steps[target], quest.steps[index]];
      this._renderDetail();
    }));
    card.querySelectorAll('[data-step-field]').forEach(control => control.addEventListener('change', () => {
      this._updateStepField(quest, index, control.dataset.stepField, control);
    }));
    // 教程内嵌编辑：展开/收起 + 步骤文案就地写回 tutorials[]（保存时随任务一并提交）
    card.querySelector('[data-action="toggle-tut-edit"]')?.addEventListener('click', event => {
      const tutId = event.currentTarget.dataset.tutId;
      if (!tutId) return this._toast('请先选择教程', 'error');
      if (this._expandedTutSteps.has(tutId)) this._expandedTutSteps.delete(tutId);
      else this._expandedTutSteps.add(tutId);
      this._renderDetail();
    });
    const tutorial = this._getTutorial(step.tutorialId);
    if (tutorial) this._bindTutorialEdit(card, tutorial);
    // 对话内嵌编辑：展开/收起 + 节点台词就地写回 dialogues[]（保存时随任务一并提交）
    card.querySelector('[data-action="toggle-dlg-edit"]')?.addEventListener('click', event => {
      const dlgId = event.currentTarget.dataset.dlgId;
      if (!dlgId) return this._toast('请先选择对话', 'error');
      if (this._expandedDlgSteps.has(dlgId)) this._expandedDlgSteps.delete(dlgId);
      else this._expandedDlgSteps.add(dlgId);
      this._renderDetail();
    });
    const dialogue = this._getDialogue(step.dialogueId);
    if (dialogue) this._bindDialogueEdit(card, dialogue);
  }

  _getTutorial(tutorialId) {
    const key = text(tutorialId);
    return this.tutorials.find(tutorial => tutorial?.id === key) || null;
  }

  /** 教程内嵌编辑区：steps 文案/增删就地编辑（写回 tutorials 草稿）；signalRules 等完整编辑在「📖 教程」页。 */
  _tutorialEditHtml(tutorial) {
    if (!tutorial) return '<small class="qwe-error">教程定义不存在（可能已被删除）</small>';
    const steps = list(tutorial.steps).map((step, stepIndex) => `
      <div class="qwe-tut-step" data-tut-step-index="${stepIndex}">
        <div class="qwe-tut-step-head">
          <span>${this._escape(step.id || `step.${stepIndex + 1}`)}</span>
          <button type="button" class="danger" data-action="tut-del-step">删除</button>
        </div>
        <textarea data-tut-field="text" rows="2" placeholder="教程步骤文案（玩家看到的提示文字）">${this._escape(step.text || '')}</textarea>
      </div>`).join('');
    return `
      <div class="qwe-tut-edit" data-tut-id="${this._escape(tutorial.id)}">
        <small>教程「${this._escape(tutorial.title || tutorial.id)}」· ${list(tutorial.steps).length} 步 · 完成策略：${this._escape(tutorial.completionPolicy || 'signal')}（完整编辑见「📖 教程」页）</small>
        ${steps || '<small class="qwe-muted">该教程暂无步骤</small>'}
        <button type="button" data-action="tut-add-step">+ 添加步骤</button>
      </div>`;
  }

  _bindTutorialEdit(card, tutorial) {
    card.querySelectorAll('[data-tut-step-index]').forEach(stepBlock => {
      const stepIndex = Number(stepBlock.dataset.tutStepIndex);
      const step = list(tutorial.steps)[stepIndex];
      if (!step) return;
      stepBlock.querySelector('[data-action="tut-del-step"]')?.addEventListener('click', () => {
        if (!confirm(`确定删除教程步骤“${step.id}”吗？`)) return;
        tutorial.steps.splice(stepIndex, 1);
        this._tutorialsDirty = true;
        this._renderDetail();
      });
      stepBlock.querySelector('[data-tut-field="text"]')?.addEventListener('change', event => {
        step.text = event.target.value;
        this._tutorialsDirty = true;
      });
    });
    card.querySelector('[data-action="tut-add-step"]')?.addEventListener('click', () => {
      const ids = new Set(list(tutorial.steps).map(step => step?.id));
      let sequence = tutorial.steps.length + 1;
      let id;
      do id = `${tutorial.id}-step-${String(sequence++).padStart(2, '0')}`;
      while (ids.has(id));
      tutorial.steps ||= [];
      tutorial.steps.push({ id, text: '' });
      this._tutorialsDirty = true;
      this._renderDetail();
    });
  }

  _getDialogue(dialogueId) {
    const key = text(dialogueId);
    return this.dialogues.find(dialogue => dialogue?.id === key) || null;
  }

  /** 从 startNode 沿 nextNode 走出线性主链（防环）；不在链上的节点（分支目标/孤立）排在链尾并标注。 */
  _dialogueChain(dialogue) {
    const nodes = dialogue?.nodes && typeof dialogue.nodes === 'object' ? dialogue.nodes : {};
    const chain = [];
    const visited = new Set();
    let cursor = text(dialogue?.startNode) || Object.keys(nodes)[0] || '';
    while (cursor && nodes[cursor] && !visited.has(cursor)) {
      visited.add(cursor);
      chain.push({ id: cursor, node: nodes[cursor] });
      cursor = text(nodes[cursor].nextNode);
    }
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!visited.has(nodeId)) chain.push({ id: nodeId, node, orphan: true });
    }
    return chain;
  }

  /** 对话内嵌编辑区：节点 speaker/text 就地编辑（写回 dialogues 草稿）；分支/条件等完整编辑在「💬 对话」页。 */
  _dialogueEditHtml(dialogue) {
    if (!dialogue) return '<small class="qwe-error">对话定义不存在（可能已被删除）</small>';
    const chain = this._dialogueChain(dialogue);
    const rows = chain.map(entry => `
      <div class="qwe-dlg-node" data-dlg-node-id="${this._escape(entry.id)}">
        <div class="qwe-tut-step-head">
          <span>${entry.orphan ? '⚠ ' : ''}${this._escape(entry.id)}${entry.orphan ? '（分支/未接线）' : ''}</span>
          <button type="button" class="danger" data-action="dlg-del-node">删除</button>
        </div>
        <input data-dlg-field="speaker" value="${this._escape(entry.node?.speaker || '')}" placeholder="说话人（如：旁白）">
        <textarea data-dlg-field="text" rows="2" placeholder="台词内容">${this._escape(entry.node?.text || '')}</textarea>
      </div>`).join('');
    return `
      <div class="qwe-dlg-edit" data-dlg-id="${this._escape(dialogue.id)}">
        <small>对话「${this._escape(dialogue.title || dialogue.id)}」· ${chain.length} 节点 · 从「${this._escape(dialogue.startNode || '')}」按序推进（分支/条件见「💬 对话」页）</small>
        ${rows || '<small class="qwe-muted">该对话暂无节点</small>'}
        <button type="button" data-action="dlg-add-node">+ 添加节点</button>
      </div>`;
  }

  _bindDialogueEdit(card, dialogue) {
    const nodes = dialogue.nodes && typeof dialogue.nodes === 'object' ? dialogue.nodes : (dialogue.nodes = {});
    card.querySelectorAll('[data-dlg-node-id]').forEach(nodeBlock => {
      const nodeId = nodeBlock.dataset.dlgNodeId;
      const node = nodes[nodeId];
      if (!node) return;
      nodeBlock.querySelector('[data-dlg-field="speaker"]')?.addEventListener('change', event => {
        node.speaker = event.target.value;
        this._dialoguesDirty = true;
      });
      nodeBlock.querySelector('[data-dlg-field="text"]')?.addEventListener('change', event => {
        node.text = event.target.value;
        this._dialoguesDirty = true;
      });
      // 删除节点：接线补偿——前驱 nextNode 越过被删节点直连其后继；startNode 被删则后移
      nodeBlock.querySelector('[data-action="dlg-del-node"]')?.addEventListener('click', () => {
        if (!confirm(`确定删除对话节点“${nodeId}”吗？`)) return;
        const nextOfDeleted = text(node.nextNode);
        delete nodes[nodeId];
        for (const other of Object.values(nodes)) {
          if (text(other?.nextNode) === nodeId) {
            if (nextOfDeleted) other.nextNode = nextOfDeleted;
            else delete other.nextNode;
          }
        }
        if (text(dialogue.startNode) === nodeId) {
          if (nextOfDeleted) dialogue.startNode = nextOfDeleted;
          else dialogue.startNode = Object.keys(nodes)[0] || '';
        }
        this._dialoguesDirty = true;
        this._renderDetail();
      });
    });
    // 添加节点：接在主链末尾（前驱 nextNode 指向新节点）；无主链则作为 startNode
    card.querySelector('[data-action="dlg-add-node"]')?.addEventListener('click', () => {
      const ids = new Set(Object.keys(nodes));
      let sequence = Object.keys(nodes).length + 1;
      let id;
      do id = `node-${String(sequence++).padStart(2, '0')}`;
      while (ids.has(id));
      nodes[id] = { speaker: '', text: '' };
      const chain = this._dialogueChain(dialogue).filter(entry => !entry.orphan);
      const tail = chain[chain.length - 1];
      if (tail) nodes[tail.id].nextNode = id;
      if (!text(dialogue.startNode) || !nodes[dialogue.startNode]) dialogue.startNode = id;
      this._dialoguesDirty = true;
      this._renderDetail();
    });
  }

  _bindReward(quest, card) {
    const index = Number(card.dataset.rewardIndex);
    const reward = list(quest.rewards)[index];
    if (!reward) return;
    card.querySelector('[data-action="delete-reward"]')?.addEventListener('click', () => {
      quest.rewards.splice(index, 1);
      this._renderDetail();
    });
    card.querySelectorAll('[data-reward-field]').forEach(control => control.addEventListener('change', () => {
      this._updateRewardField(quest, index, control.dataset.rewardField, control);
    }));
  }

  _updateQuestField(quest, field, value) {
    if (field === 'id') {
      const nextId = value.trim();
      if (!stableId(nextId)) return this._toast('任务 ID 只能使用字母开头的字母、数字、点、下划线和短横线', 'error');
      if (this.quests.some(item => item !== quest && item?.id === nextId)) return this._toast(`任务 ID 已存在：${nextId}`, 'error');
      quest.id = nextId;
      this._render();
      return;
    }
    quest[field] = value;
    this._renderList();
  }

  _updateAcceptField(quest, field, value) {
    if (field === 'mode') {
      if (value === 'external') delete quest.accept;
      else {
        const previous = quest.accept || {};
        quest.accept = { ...previous, mode: value };
        if (value === 'auto' && !quest.accept.when) quest.accept.when = { type: 'fact' };
      }
      this._renderDetail();
      return;
    }
    quest.accept ||= { mode: 'auto', when: { type: 'fact' } };
    quest.accept.when ||= { type: 'fact' };
    const when = quest.accept.when;
    if (field === 'type') {
      quest.accept.when = { type: value };
      this._renderDetail();
      return;
    }
    when[field === 'questId' ? 'questId' : field] = value;
    if (field === 'questId') when.type = 'questCompleted';
    if (field === 'event') when.type = 'event';
  }

  _updateStepField(quest, index, field, control) {
    const step = quest.steps[index];
    if (!step) return;
    if (field === 'type') {
      const nextType = control.value;
      const preserved = { id: step.id, title: step.title };
      quest.steps[index] = { ...preserved, type: nextType };
      this._renderDetail();
      return;
    }
    if (field === 'params') {
      try {
        step.params = JSON.parse(control.value || '{}');
        control.classList.remove('invalid');
      } catch {
        control.classList.add('invalid');
        return;
      }
      this._renderDetail();
      return;
    }
    if (field === 'await') {
      if (control.checked) step.await = true;
      else delete step.await;
      return;
    }
    if (field === 'requiredCount') {
      step.requiredCount = Math.max(1, Number(control.value) || 1);
      return;
    }
    step[field] = control.value;
    // objectiveType 联动身份字段；tutorialId/dialogueId 联动内嵌编辑入口（toggle 按钮携带的 ID 需同步）
    if (field === 'objectiveType' || field === 'tutorialId' || field === 'dialogueId') this._renderDetail();
  }

  _updateRewardField(quest, index, field, control) {
    const reward = quest.rewards[index];
    if (!reward) return;
    if (field === 'type') {
      quest.rewards[index] = { type: control.value };
      this._renderDetail();
      return;
    }
    if (field === 'definitionId') reward.definitionId = control.value;
    else if (field === 'itemId') reward.items = [{ itemId: control.value, count: Number(reward.items?.[0]?.count) || 1 }];
    else if (field === 'count') reward.items = [{ itemId: reward.items?.[0]?.itemId || '', count: Math.max(1, Number(control.value) || 1) }];
  }

  _addQuest() {
    const id = prompt('任务 ID（英文稳定标识）：', this._nextId('quest'))?.trim();
    if (!id) return;
    if (!stableId(id)) return this._toast('任务 ID 只能使用字母开头的字母、数字、点、下划线和短横线', 'error');
    if (this.quests.some(quest => quest?.id === id)) return this._toast(`任务 ID 已存在：${id}`, 'error');
    const title = prompt('任务标题：', id)?.trim() || id;
    this.quests.push({ id, title, description: '', category: 'main', scenes: [], steps: [], rewards: [] });
    this.selectedId = id;
    this._render();
  }

  _deleteQuest() {
    const quest = this._quest();
    if (!quest) return;
    if (!confirm(`确定删除任务“${quest.title || quest.id}”吗？`)) return;
    this.quests = this.quests.filter(item => item?.id !== quest.id);
    this.selectedId = null;
    this._render();
  }

  _addStep(quest) {
    quest.steps ||= [];
    const ids = new Set(quest.steps.map(step => step?.id));
    let sequence = quest.steps.length + 1;
    let id;
    do id = `step.${String(sequence++).padStart(2, '0')}`;
    while (ids.has(id));
    quest.steps.push({ id, type: 'objective', objectiveType: 'commit.fact', target: '', title: `任务步骤 ${quest.steps.length + 1}` });
    this._renderDetail();
  }

  _addReward(quest) {
    quest.rewards ||= [];
    quest.rewards.push({ type: 'state', definitionId: '' });
    this._renderDetail();
  }

  _quest() { return this.quests.find(quest => quest?.id === this.selectedId) || null; }

  _sceneOptions() {
    let scenes = list(this.project?.scenes);
    try { scenes = list(this.getSceneList()) || scenes; } catch { /* 保留项目场景目录 */ }
    return scenes.map(scene => [scene?.id, scene?.name || scene?.id]).filter(([id]) => id);
  }

  _dialogueOptions() {
    // 返回选项数组（对齐 _tutorialOptions），由调用方经 _optionList 渲染；读草稿与内嵌编辑同源
    return list(this.dialogues)
      .map(dialogue => ({ value: dialogue?.id, label: dialogue?.title || dialogue?.name || dialogue?.id }))
      .filter(option => option.value);
  }

  _tutorialOptions() {
    return list(this.tutorials).map(tutorial => ({ value: tutorial?.id, label: tutorial?.title || tutorial?.id })).filter(option => option.value);
  }

  _itemOptions() {
    const options = [];
    for (const item of [...list(this.project?.library?.items), ...list(this.project?.library?.equipment)]) {
      if (item?.id) options.push({ value: item.id, label: item.name || item.id });
    }
    return options;
  }

  _actionOptions() {
    const seen = new Set();
    const options = [];
    for (const action of [...list(this.project?.triggerCatalog?.actions)]) {
      const value = text(action?.value || action?.v || action?.id);
      if (value && !seen.has(value)) { seen.add(value); options.push({ value, label: action?.label || value }); }
    }
    return options;
  }

  _questOptions(excludeId) {
    const options = this.quests
      .filter(quest => quest?.id && quest.id !== excludeId)
      .map(quest => ({ value: quest.id, label: quest.title || quest.id }));
    for (const quest of list(this.project?.quests)) {
      if (quest?.id && quest.id !== excludeId && !options.some(option => option.value === quest.id)) {
        options.push({ value: quest.id, label: quest.title || quest.name || quest.id });
      }
    }
    return options;
  }

  _targetOptions(descriptor, current) {
    const values = [];
    const add = (value, label = value) => {
      const id = String(value || '').trim();
      if (id && !values.some(item => item.value === id)) values.push({ value: id, label: String(label || id) });
    };
    const source = descriptor?.identityFields?.[0]?.source || '';
    if (source === 'libraryItems') this._itemOptions().forEach(option => add(option.value, option.label));
    else if (source === 'commands') list(this.project?.commands).forEach(command => add(command?.id, command?.name || command?.id));
    else if (source === 'enemyRoles') [['firstWolf', '教学狼'], ['chaseWolf', '追逐狼']].forEach(([value, label]) => add(value, label));
    add(current, current ? `${current}（当前值）` : '');
    return this._optionList(values, current, '-- 不限定 --');
  }

  _countOptions(selected = 1) {
    const values = [1, 2, 3, 4, 5, 10, 20, 50, 100];
    if (!values.includes(selected)) values.push(selected);
    return values.sort((a, b) => a - b).map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`).join('');
  }

  _optionList(options, current, placeholder = null) {
    const html = options.map(option => `<option value="${this._escape(option.value)}" ${option.value === current ? 'selected' : ''}>${this._escape(option.label)}</option>`).join('');
    const fallback = current && !options.some(option => option.value === current)
      ? `<option value="${this._escape(current)}" selected>${this._escape(current)}（当前值，目录未登记）</option>` : '';
    const lead = placeholder ? `<option value="" ${!current ? 'selected' : ''}>${placeholder}</option>` : '';
    return `${fallback}${lead}${html}`;
  }

  _nextId(prefix) {
    let index = 1;
    while (this.quests.some(quest => quest?.id === `${prefix}.${index}`)) index += 1;
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
    if (target) { target.textContent = message; target.className = `qwe-status ${kind}`; }
  }
  _toast(message, type = 'success') {
    let target = document.getElementById('qwe-toast');
    if (!target) {
      target = document.createElement('div');
      target.id = 'qwe-toast';
      target.className = 'qwe-toast';
      document.body.appendChild(target);
    }
    target.textContent = message;
    target.dataset.type = type;
    target.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => target.classList.remove('visible'), 2600);
  }

  _injectStyles() {
    if (document.getElementById('qwe-styles')) return;
    const style = document.createElement('style');
    style.id = 'qwe-styles';
    style.textContent = `
      .qwe-root{height:100%;display:flex;flex-direction:column;background:#0d1326;color:#fff;font-size:13px}.qwe-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#16213e;border-bottom:1px solid #2a3a5e}.qwe-toolbar button,.qwe-node-toolbar button{padding:7px 12px;border:0;border-radius:4px;background:#3a4a7e;color:#fff;cursor:pointer}.qwe-toolbar .primary{background:#4caf50;color:#102010;font-weight:bold}.qwe-toolbar .danger,.qwe-step .danger{background:#7e3a3a}.qwe-hint{margin-left:auto;color:#8aa;font-size:12px}.qwe-main{min-height:0;flex:1;display:flex;overflow:hidden}.qwe-list{width:240px;flex:none;overflow:auto;background:#111a30;border-right:1px solid #2a3a5e}.qwe-quest{display:flex;width:100%;flex-direction:column;gap:3px;padding:10px 13px;text-align:left;color:#fff;background:transparent;border:0;border-bottom:1px solid #1e2b47;cursor:pointer}.qwe-quest:hover{background:#1a2540}.qwe-quest.active{background:#2a3a6e}.qwe-quest small{color:#9ab}.qwe-detail{min-width:0;flex:1;overflow:auto;padding:16px}.qwe-note{margin-bottom:12px;padding:10px 12px;border:1px solid #3b6b54;border-radius:5px;background:#10251e;color:#a9d8bc}.qwe-graph{margin-bottom:14px;overflow:auto;border:1px solid #2a3a5e;border-radius:6px;background:#091020;max-height:380px}.qwe-graph svg{display:block}.qwe-graph-edges path{fill:none;stroke:#6d84c7;stroke-width:2}.qwe-graph-node{cursor:pointer}.qwe-graph-node rect{fill:#17264a;stroke:#7d98db;stroke-width:1.5}.qwe-graph-node:hover rect{fill:#294078;stroke:#b9ceff}.qwe-graph-node text{fill:#fff;font-size:11px;pointer-events:none}.qwe-graph-node text.type{fill:#8fa7d8;font-size:10px}.qwe-graph-node.start rect{stroke:#4caf50}.qwe-graph-node.complete rect{stroke:#c9a227}.qwe-graph-node.objective rect{fill:#1a2f55}.qwe-block{margin-bottom:14px;padding:10px 14px;border:1px solid #2a3a5e;border-radius:6px;background:#0f1830}.qwe-block legend{padding:0 8px;color:#8fa7d8;font-weight:bold}.qwe-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.qwe-field{min-width:0}.qwe-field.full{grid-column:1/-1}.qwe-field label{display:block;margin-bottom:4px;color:#9ab;font-size:12px}.qwe-field input,.qwe-field select,.qwe-field textarea{width:100%;padding:7px;border:1px solid #2a3a5e;border-radius:3px;background:#0a1020;color:#fff;font:inherit}.qwe-field textarea{resize:vertical;font-family:Consolas,monospace;font-size:12px}.qwe-field textarea.invalid{border-color:#e66;box-shadow:0 0 0 1px #e66}.qwe-field small{display:block;margin-top:4px;color:#789;font-size:11px}.qwe-checks{display:flex;flex-wrap:wrap;gap:10px}.qwe-check{display:inline-flex;align-items:center;gap:5px;color:#cdd;font-size:12px}.qwe-check input{width:auto}.qwe-check-row{display:flex;align-items:center}.qwe-node-toolbar{display:flex;align-items:center;justify-content:space-between;margin:16px 0 10px}.qwe-node-toolbar h3{font-size:14px}.qwe-step{margin-bottom:12px;padding:12px;border:1px solid #2a3a5e;border-radius:6px;background:#0f1830}.qwe-step-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.qwe-step-actions{display:flex;gap:6px}.qwe-step-actions button{padding:4px 8px;border:0;border-radius:3px;background:#3a4a7e;color:#fff;cursor:pointer}.qwe-step-actions button:disabled{opacity:.35;cursor:default}.qwe-rewards{margin-bottom:8px}.qwe-reward{margin-bottom:8px;padding:8px;border:1px dashed #2a3a5e;border-radius:4px}.qwe-tut-edit{margin-top:8px;padding:10px;border:1px solid #3a4a7e;border-radius:5px;background:#0a1020;display:flex;flex-direction:column;gap:8px}.qwe-tut-step{padding:8px;border:1px solid #223055;border-radius:4px}.qwe-tut-step-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;color:#8fa7d8;font-size:11px}.qwe-tut-step textarea{width:100%;padding:6px;border:1px solid #2a3a5e;border-radius:3px;background:#0a1020;color:#fff;font:inherit;resize:vertical}.qwe-dlg-edit{margin-top:8px;padding:10px;border:1px solid #3a4a7e;border-radius:5px;background:#0a1020;display:flex;flex-direction:column;gap:8px}.qwe-dlg-node{padding:8px;border:1px solid #223055;border-radius:4px;display:flex;flex-direction:column;gap:6px}.qwe-dlg-node input,.qwe-dlg-node textarea{width:100%;padding:6px;border:1px solid #2a3a5e;border-radius:3px;background:#0a1020;color:#fff;font:inherit;resize:vertical}.qwe-dlg-node textarea{font-family:Consolas,monospace;font-size:12px}.qwe-muted{color:#789}.qwe-error{color:#e66}.qwe-ok{color:#6c6}.qwe-preview{font-size:12px;color:#9ab}.qwe-preview ul{margin:6px 0 0 18px}.qwe-empty{padding:38px 16px;color:#789;text-align:center;line-height:1.7}.qwe-empty.compact{padding:18px}.qwe-status{min-height:30px;padding:7px 16px;background:#0a1020;color:#9ab}.qwe-status.ok{color:#6c6}.qwe-status.warn{color:#e6bd5d}.qwe-status.error{color:#e66}.qwe-toast{position:fixed;top:58px;left:50%;z-index:100000;max-width:min(600px,90vw);padding:10px 18px;border-radius:6px;background:#2e7d32;color:#fff;box-shadow:0 4px 16px #0008;opacity:0;pointer-events:none;transform:translate(-50%,-8px);transition:opacity .2s,transform .2s}.qwe-toast[data-type="error"]{background:#c62828}.qwe-toast[data-type="warn"]{background:#9a6700}.qwe-toast.visible{opacity:1;transform:translate(-50%,0)}@media (max-width:800px){.qwe-list{width:180px}.qwe-grid{grid-template-columns:1fr}.qwe-field.full{grid-column:auto}.qwe-hint{display:none}}
    `;
    document.head.appendChild(style);
  }
}

export default QuestWizardEditor;

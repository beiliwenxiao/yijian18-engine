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
  normalizeSceneObjectSelector,
  resolveSceneObjects
} from '../src/core/scene/SceneObjectSelector.js';
import { TriggerProjectIndex } from './TriggerProjectIndex.js';

const SELECTOR_MODES = ['id', 'group', 'tag', 'name', 'type', 'ref'];

function asList(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function text(value) {
  return String(value ?? '').trim();
}

function conditionAnchor(condition) {
  if (!condition || typeof condition !== 'object') return '';
  const children = [...asList(condition.all), ...asList(condition.any)];
  for (const child of children) {
    const anchor = conditionAnchor(child);
    if (anchor) return anchor;
  }
  const positive = condition.completed === true || condition.equals === true ||
    (Number.isFinite(condition.gte) && condition.gte > 0);
  if (!positive) return '';
  if (condition.tutorialId) return `教学 · ${condition.tutorialId}`;
  if (condition.path) return `状态 · ${condition.path}`;
  if (condition.blackboardKey) return `状态 · ${condition.blackboardKey}`;
  return '';
}

function eventLabel(record) {
  const binding = record.binding;
  return binding.name || binding.triggerId || record.id;
}

function isPersistentVisualLayer(layer) {
  const id = text(layer?.id).toLowerCase();
  const name = text(layer?.name).toLowerCase();
  if (['layer_bg', 'layer_background', 'layer_fill', 'layer_deco', 'layer_decoration'].includes(id)) return true;
  if (/(^|[_-])(bg|background|fill|deco|decoration|decorations)($|[_-])/.test(id)) return true;
  return name.includes('背景') || name.includes('装饰') ||
    name.includes('background') || name.includes('decoration');
}

/** 纯背景层（地面/底图）：聚焦压暗与隔离模式下保持原样，提供空间定位锚点。 */
function isBackgroundLayer(layer) {
  const id = text(layer?.id).toLowerCase();
  const name = text(layer?.name).toLowerCase();
  if (['layer_bg', 'layer_background'].includes(id)) return true;
  if (/(^|[_-])(bg|background)($|[_-])/.test(id)) return true;
  return name.includes('背景') || name.includes('background');
}

/** 提取 Trigger do[] 中提交的事实 definitionId（state.transaction），用于任务步骤映射。 */
function triggerCommittedFacts(trigger) {
  const facts = new Set();
  for (const action of asList(trigger?.do)) {
    if (action?.action !== 'state.transaction') continue;
    const fact = text(action?.params?.definitionId);
    if (fact) facts.add(fact);
  }
  return [...facts];
}

export class SceneEditorEventFilter {
  constructor(editor) {
    this.editor = editor;
    this.state = {
      mode: 'all',
      selectedTriggerId: '',
      selectedBindingId: '',
      focusLevel: 'dim' // 聚焦视图档位：dim=压暗无关对象 | isolate=隔离（隐藏无关对象）
    };
    // 聚焦并集：勾选/点选的 Trigger 集合（空集=不聚焦，画布显示完整场景）
    this.state.focusedTriggerIds = new Set();
    this.events = [];
    // 全 Trigger 化：扁平展示场景内绑定与 Trigger（不再有 FlowGroup/phase 容器）
    this.bindings = [];
    this.triggers = [];
    this.tutorials = [];
    // 任务分组投影：questGroups=[{id,title,steps:[{id,title,fact,triggerIds}]}]；questByTriggerId 反查
    this.questGroups = [];
    this.questByTriggerId = new Map();
    // 反向查询索引：场景对象 → 引用它的流程事件（rebuild 时构建，选中对象时 O(1) 查询）
    this.flowIndex = new Map();
    this.projectIndex = new TriggerProjectIndex();
    this.hiddenBindingIds = new Set();
    this.visibleObjects = null;
    this.highlightObjects = null; // 聚焦模式下参与当前流程的关联闭包（含空间 binding）
    this.dimmedObjects = null; // 聚焦压暗模式下闭包外对象（画布低透明度渲染）
    this.dynamicTargets = [];
    this._scrollLeft = 0;
    this._bound = false;
  }
  reset(sceneData = this.editor.sceneData) {
    this.sceneData = sceneData;
    this._scrollLeft = 0;
    this.hiddenBindingIds.clear();
    this.state = {
      mode: 'all',
      selectedTriggerId: '',
      selectedBindingId: '',
      focusLevel: 'dim'
    };
    this.state.focusedTriggerIds = new Set();
    this.rebuild({ preserveSelection: false });
  }

  rebuild({ preserveSelection = true, notify = false } = {}) {
    this.sceneData = this.editor.sceneData;
    const previousTriggerId = preserveSelection ? this.state.selectedTriggerId : '';
    const previousBindingId = preserveSelection ? this.state.selectedBindingId : '';
    const project = this.editor.getProjectDefinitions?.() || {};
    this.projectIndex = new TriggerProjectIndex(project, {
      sceneDocuments: this.sceneData ? [this.sceneData] : []
    });
    const records = [];
    for (let layerIndex = 0; layerIndex < (this.sceneData?.layers || []).length; layerIndex++) {
      const layer = this.sceneData.layers[layerIndex];
      for (let objectIndex = 0; objectIndex < (layer.objects || []).length; objectIndex++) {
        const binding = layer.objects[objectIndex];
        if (binding?.type !== 'trigger') continue;
        const id = text(binding.id) || `binding-${layerIndex}-${objectIndex}`;
        records.push({
          id,
          binding,
          definition: this.projectIndex.getTrigger(binding.triggerId),
          layerIndex,
          objectIndex
        });
      }
    }

    const projection = this.projectIndex.getSceneProjection(this.sceneData?.id, records);
    // 全 Trigger 化：扁平展示场景内绑定、Trigger 与 Tutorial；Trigger 只取绑定实际引用的定义。
    this.bindings.splice(0, this.bindings.length, ...projection.bindings);
    this.triggers.splice(0, this.triggers.length, ...projection.triggers);
    this.tutorials.splice(0, this.tutorials.length, ...projection.tutorials);
    this.events = [...this.bindings];

    const currentIds = new Set(this.events.map(record => record.id));
    for (const id of this.hiddenBindingIds) {
      if (!currentIds.has(id)) this.hiddenBindingIds.delete(id);
    }
    for (const id of this.state.focusedTriggerIds) {
      if (!this.triggers.some(trigger => trigger.id === id)) this.state.focusedTriggerIds.delete(id);
    }
    this.state.selectedTriggerId = this.projectIndex.getTrigger(previousTriggerId)
      ? previousTriggerId : '';
    this.state.selectedBindingId = currentIds.has(previousBindingId) ? previousBindingId : '';
    if (this.state.mode === 'trigger' && !this.state.selectedTriggerId) this.state.mode = 'all';
    if (this.state.mode === 'binding' && !this.state.selectedBindingId) this.state.mode = 'all';
    this._rebuildQuestGroups();
    this._rebuildFlowIndex();
    this._recomputeProjection();
    this.renderBar();
    if (notify) this._notifyViewChanged();
  }

  getState() {
    return {
      ...this.state,
      focusedTriggerIds: [...this.state.focusedTriggerIds],
      showAllEvents: this.hiddenBindingIds.size === 0,
      hiddenBindingIds: [...this.hiddenBindingIds]
    };
  }
  getEvents() { return [...this.events]; }
  isFiltering() {
    return this.state.mode !== 'all' || this.state.focusedTriggerIds.size > 0 || this.hiddenBindingIds.size > 0;
  }
  isObjectVisible(object) { return !this.visibleObjects || this.visibleObjects.has(object); }
  filterObjects(objects = []) { return this.visibleObjects ? objects.filter(object => this.visibleObjects.has(object)) : [...objects]; }
  /** 聚焦压暗模式下：闭包外对象返回 true（画布低透明度渲染）。 */
  isObjectDimmed(object) {
    if (!this.dimmedObjects || !this.dimmedObjects.has(object)) return false;
    return !(this.editor.selectedObjects || []).includes(object); // 选中对象永不压暗
  }

  setAllEventsVisible(value) {
    this.hiddenBindingIds.clear();
    if (!value) {
      for (const event of this.events) this.hiddenBindingIds.add(event.id);
    }
    this._applySelection();
  }

  setEventVisible(bindingId, value) {
    if (!this.events.some(event => event.id === bindingId)) return;
    if (value) this.hiddenBindingIds.delete(bindingId);
    else this.hiddenBindingIds.add(bindingId);
    this._applySelection();
  }

  selectAll() {
    this.state.mode = 'all';
    this.state.selectedTriggerId = '';
    this.state.selectedBindingId = '';
    this.state.focusedTriggerIds.clear();
    this._applySelection();
  }

  /** 单独聚焦某个 Trigger（清空并集，仅留它）。 */
  selectTrigger(triggerId) {
    const definition = this.projectIndex.getTrigger(triggerId);
    if (!definition) return;
    this.state.mode = 'trigger';
    this.state.selectedTriggerId = triggerId;
    this.state.selectedBindingId = '';
    this.state.focusedTriggerIds = new Set([triggerId]);
    this._applySelection();
  }

  /** Trigger 聚焦勾选：勾=纳入并集（保留其他勾选），取消=移出。 */
  toggleTriggerFocus(triggerId, checked) {
    if (!this.projectIndex.getTrigger(triggerId)) return;
    if (checked) {
      this.state.focusedTriggerIds.add(triggerId);
      this.state.selectedTriggerId = triggerId;
    } else {
      this.state.focusedTriggerIds.delete(triggerId);
      if (this.state.selectedTriggerId === triggerId) {
        this.state.selectedTriggerId = [...this.state.focusedTriggerIds][0] || '';
      }
    }
    if (this.state.mode === 'trigger') this.state.mode = 'all'; // 多选并集脱离单选高亮
    this._applySelection();
  }

  /** 聚焦整个任务：并集纳入该任务全部步骤 Trigger。 */
  selectQuest(questId) {
    const group = this.questGroups.find(quest => quest.id === questId);
    if (!group) return;
    const triggerIds = group.steps.flatMap(step => step.triggerIds);
    if (!triggerIds.length) return;
    this.state.mode = 'all';
    this.state.selectedTriggerId = triggerIds[triggerIds.length - 1];
    this.state.selectedBindingId = '';
    this.state.focusedTriggerIds = new Set(triggerIds);
    this._applySelection();
  }

  toggleQuestFocus(questId, checked) {
    const group = this.questGroups.find(quest => quest.id === questId);
    if (!group) return;
    const triggerIds = group.steps.flatMap(step => step.triggerIds);
    if (checked) {
      for (const id of triggerIds) this.state.focusedTriggerIds.add(id);
      if (triggerIds.length) this.state.selectedTriggerId = triggerIds[triggerIds.length - 1];
    } else {
      for (const id of triggerIds) this.state.focusedTriggerIds.delete(id);
    }
    if (this.state.mode === 'trigger') this.state.mode = 'all';
    this._applySelection();
  }

  setFocusLevel(level) {
    if (!['dim', 'isolate'].includes(level)) return;
    this.state.focusLevel = level;
    this._applySelection();
  }

  selectEvent(bindingId) {
    const record = this.events.find(event => event.id === bindingId);
    if (!record) return;
    this.state.mode = 'binding';
    this.state.selectedBindingId = bindingId;
    this.state.selectedTriggerId = record.definition?.id || '';
    this.state.focusedTriggerIds = new Set(
      record.definition?.id ? [record.definition.id] : []
    );
    this._applySelection();
    // 即使 canonical enabled=false 导致画布不绘制，也允许从事件条重新选中并在右侧恢复。
    this.editor.selectedObjects = [record.binding];
    this.editor.ui?.updateObjectProperties();
    this.editor.render();
  }

  /** 反向查询：该场景对象被哪些流程事件引用（binding 目标 + 动作 selector 全闭包）。 */
  getFlowsForObject(object) {
    if (!object) return [];
    const records = this.flowIndex.get(object);
    if (!records) return [];
    return records.map(event => ({
      bindingId: event.id,
      triggerId: event.definition?.id || event.binding?.triggerId || '',
      name: eventLabel(event),
      definitionName: event.definition?.name || '',
      enabled: event.binding.enabled !== false,
      quest: this.questByTriggerId.get(event.definition?.id) || null
    }));
  }

  _applySelection() {
    this._recomputeProjection();
    this.sanitizeInteractionState();
    this.renderBar();
    this._notifyViewChanged();
  }
  _selectedEvents() {
    if (this.state.mode === 'binding') {
      return this.events.filter(event => event.id === this.state.selectedBindingId);
    }
    if (this.state.focusedTriggerIds.size > 0) {
      return this.events.filter(event =>
        this.state.focusedTriggerIds.has(event.definition?.id)
        || this.state.focusedTriggerIds.has(event.binding?.triggerId));
    }
    if (this.state.mode === 'trigger') {
      return this.events.filter(event => event.definition?.id === this.state.selectedTriggerId
        || event.binding?.triggerId === this.state.selectedTriggerId);
    }
    return this.events;
  }

  _allObjects() {
    return (this.sceneData?.layers || []).flatMap(layer => layer.objects || []);
  }

  _recomputeProjection() {
    this.dynamicTargets = [];
    this.highlightObjects = null;
    this.dimmedObjects = null;
    const hasDisabledBindings = this.events.some(event => event.binding.enabled === false);
    const focusActive = this.state.focusedTriggerIds.size > 0;
    if (this.state.mode === 'all' && !focusActive
        && this.hiddenBindingIds.size === 0 && !hasDisabledBindings) {
      this.visibleObjects = null;
      return;
    }
    const matchedEvents = this._selectedEvents();
    // 标记显隐 seed：临时隐藏与禁用的 binding 不显示；
    // 闭包 seed：流程参与对象由 Trigger 定义（do[]）决定，binding 禁用不影响动作 selector 闭包。
    const visibleEvents = matchedEvents
      .filter(event => !this.hiddenBindingIds.has(event.id) && event.binding.enabled !== false);
    if (!focusActive) {
      // 标记显隐模式（无聚焦）：仅控制空间 Trigger 标记，场景对象保持完整。
      const visible = new Set(this._allObjects().filter(object => object?.type !== 'trigger'));
      for (const event of visibleEvents) visible.add(event.binding);
      // 临时隐藏与 canonical enabled=false 都拥有最终优先级。
      for (const event of this.events) {
        if (this.hiddenBindingIds.has(event.id) || event.binding.enabled === false) visible.delete(event.binding);
      }
      this.visibleObjects = visible;
      return;
    }

    // 聚焦模式：解析关联闭包（binding 目标 + 动作 selector 递归）。
    const visible = new Set();
    for (const event of visibleEvents) visible.add(event.binding);
    this._resolveRelatedObjects(matchedEvents, visible);
    this.highlightObjects = new Set(visible);

    if (this.state.focusLevel === 'isolate') {
      // 隔离：只显示关联闭包 + 背景层（地面提供空间定位锚点），其余全部隐藏。
      for (const layer of this.sceneData?.layers || []) {
        if (!isBackgroundLayer(layer)) continue;
        for (const object of layer.objects || []) visible.add(object);
      }
      this.dimmedObjects = null;
    } else {
      // 聚焦压暗：全部对象保持可见（交互不受限），闭包外低透明度渲染。
      for (const object of this._allObjects()) visible.add(object);
      const dimmed = new Set();
      for (const layer of this.sceneData?.layers || []) {
        const background = isBackgroundLayer(layer);
        for (const object of layer.objects || []) {
          if (!background && !this.highlightObjects.has(object)) dimmed.add(object);
        }
      }
      this.dimmedObjects = dimmed;
    }
    // 临时隐藏与 canonical enabled=false 都拥有最终优先级，关联闭包或视觉层不得重新加入。
    for (const event of this.events) {
      if (this.hiddenBindingIds.has(event.id) || event.binding.enabled === false) visible.delete(event.binding);
    }
    this.visibleObjects = visible;
  }

  /**
   * 任务分组投影：quest step 的 target 事实 == Trigger do[] state.transaction 的 definitionId
   * 时，该 Trigger 归属此任务步骤（多对多：一个 Trigger 可被多个任务声明，取首个归属）。
   * 只收录当前场景有空间绑定的 Trigger；纯对话/教学步骤与跨场景任务自然不出现。
   */
  _rebuildQuestGroups() {
    this.questGroups = [];
    this.questByTriggerId = new Map();
    const quests = this.editor.getProjectDefinitions?.()?.quests;
    if (!Array.isArray(quests) || !quests.length) return;
    const groups = [];
    for (const quest of quests) {
      const steps = [];
      for (const step of Array.isArray(quest?.steps) ? quest.steps : []) {
        const fact = text(step?.target);
        if (!fact) continue;
        const triggerIds = [];
        for (const trigger of this.triggers) {
          if (!triggerCommittedFacts(trigger).includes(fact)) continue;
          triggerIds.push(trigger.id);
          if (!this.questByTriggerId.has(trigger.id)) {
            this.questByTriggerId.set(trigger.id, {
              questId: text(quest?.id), questTitle: text(quest?.title) || text(quest?.id),
              stepId: text(step?.id), stepTitle: text(step?.title) || fact
            });
          }
        }
        if (triggerIds.length) steps.push({
          id: text(step?.id), title: text(step?.title) || fact, fact, triggerIds
        });
      }
      if (!steps.length) continue;
      groups.push({
        id: text(quest?.id), title: text(quest?.title) || text(quest?.id),
        category: text(quest?.category), steps
      });
    }
    this.questGroups = groups;
  }

  /** 反向查询索引：场景对象 → 引用它的流程事件（构建期一次解析全部 selector）。 */
  _rebuildFlowIndex() {
    this.flowIndex = new Map();
    const allObjects = this._allObjects();
    for (const event of this.events) {
      for (const selector of this._selectorsForEvent(event)) {
        for (const object of resolveSceneObjects(allObjects, selector)) {
          const records = this.flowIndex.get(object) || [];
          if (!records.includes(event)) records.push(event);
          this.flowIndex.set(object, records);
        }
      }
    }
  }

  _resolveRelatedObjects(seedEvents, visible) {
    const allObjects = this._allObjects();
    const eventByBinding = new Map(this.events.map(event => [event.binding, event]));
    const queue = [...seedEvents];
    const visitedEvents = new Set();
    const missing = new Set();
    while (queue.length && visible.size <= allObjects.length) {
      const event = queue.shift();
      if (!event || visitedEvents.has(event.id)) continue;
      visitedEvents.add(event.id);
      for (const selector of this._selectorsForEvent(event)) {
        const matches = resolveSceneObjects(allObjects, selector);
        if (!matches.length) missing.add(`${selector.mode}:${selector.value}`);
        for (const object of matches) {
          visible.add(object);
          const relatedEvent = eventByBinding.get(object);
          if (relatedEvent && !visitedEvents.has(relatedEvent.id)) queue.push(relatedEvent);
        }
      }
    }
    this.dynamicTargets = [...missing];
  }

  _selectorsForEvent(event) {
    const selectors = [];
    const seen = new Set();
    const add = (mode, value) => {
      const normalized = normalizeSceneObjectSelector({ mode, value });
      if (!normalized.value) return;
      const key = `${normalized.mode}:${normalized.value}`;
      if (seen.has(key)) return;
      seen.add(key);
      selectors.push(normalized);
    };
    const addSelectorObject = raw => {
      if (!raw || typeof raw !== 'object') return;
      if (raw.mode || raw.targetMode || raw.value || raw.target) {
        const normalized = normalizeSceneObjectSelector(raw);
        add(normalized.mode, normalized.value);
      }
      for (const mode of SELECTOR_MODES) {
        for (const value of asList(raw[mode])) add(mode, value);
      }
    };

    add(event.binding.targetMode || 'auto', event.binding.target);
    for (const action of event.definition?.do || []) {
      const params = action?.params || {};
      addSelectorObject(params.targetSelector);
      addSelectorObject(params.selector);
      if (params.targetMode || params.target) add(params.targetMode || 'auto', params.target);
      for (const value of [...asList(params.targetId), ...asList(params.objectId), ...asList(params.targetIds)]) add('id', value);
      for (const value of [...asList(params.ref), ...asList(params.npcRef), ...asList(params.enemyRef)]) add('ref', value);
      for (const value of [...asList(params.entityId), ...asList(params.actorId), ...asList(params.vehicleId)]) add('auto', value);
      if (action.action === 'spawnGroup' || action.action === 'spawnWave') add('group', params.group);
    }
    return selectors;
  }

  sanitizeInteractionState() {
    const editor = this.editor;
    editor.selectedObjects = (editor.selectedObjects || []).filter(object => this.isObjectVisible(object));
    const interaction = editor.interaction || {};
    Object.assign(interaction, {
      isDragging: false, isResizing: false, isRotating: false,
      isLinking: false, isPickingTarget: false, isBoxSelecting: false,
      draggingVertex: null, resizeTarget: null, resizeStart: null,
      linkSource: null, linkEnd: null, pickSource: null,
      boxSelectStart: null, boxSelectEnd: null, allObjectStarts: null
    });
    editor.interactionModule?._clearArrowKeyState?.();
  }

  _notifyViewChanged() {
    this.editor.layers?.updateLayerList();
    this.editor.ui?.updateObjectProperties();
    this.editor.render();
  }
  bindUI() {
    const bar = document.getElementById('editor-scene-event-filter');
    if (!bar || this._bound) return;
    this._bound = true;
    bar.addEventListener('click', event => {
      const editButton = event.target.closest('button[data-editor-target]');
      if (editButton) {
        this.editor.options.openTriggerEditor?.(editButton.dataset.definitionId, editButton.dataset.editorTarget);
        return;
      }
      const levelButton = event.target.closest('button[data-focus-level]');
      if (levelButton) {
        this.setFocusLevel(levelButton.dataset.focusLevel);
        return;
      }
      const button = event.target.closest('button[data-filter-mode]');
      if (!button) return;
      if (button.dataset.filterMode === 'all') this.selectAll();
      else if (button.dataset.filterMode === 'quest') this.selectQuest(button.dataset.questId);
      else if (button.dataset.filterMode === 'trigger') this.selectTrigger(button.dataset.triggerId);
      else if (button.dataset.filterMode === 'binding') this.selectEvent(button.dataset.bindingId);
    });
    bar.addEventListener('dblclick', event => {
      const button = event.target.closest('button[data-filter-mode="trigger"]');
      if (!button) return;
      const id = button.dataset.triggerId;
      this.editor.options.openTriggerEditor?.(id, 'triggers');
    });
    bar.addEventListener('change', event => {
      if (event.target.id === 'editor-event-filter-all-visible') {
        this.setAllEventsVisible(event.target.checked);
      } else if (event.target.matches('input[data-event-visibility]')) {
        this.setEventVisible(event.target.dataset.eventVisibility, event.target.checked);
      } else if (event.target.matches('input[data-trigger-focus]')) {
        this.toggleTriggerFocus(event.target.dataset.triggerFocus, event.target.checked);
      } else if (event.target.matches('input[data-quest-focus]')) {
        this.toggleQuestFocus(event.target.dataset.questFocus, event.target.checked);
      }
    });
    this.renderBar();
  }

  renderBar() {
    if (typeof document === 'undefined') return; // 单测/非 DOM 环境：状态计算已在上游完成
    const bar = document.getElementById('editor-scene-event-filter');
    if (!bar) return;
    const previousScroll = bar.querySelector('.scene-event-filter-scroll');
    if (previousScroll) this._scrollLeft = previousScroll.scrollLeft;
    bar.replaceChildren();

    const title = document.createElement('span');
    title.className = 'scene-event-filter-title';
    title.textContent = 'Trigger 流程';
    title.title = '按场景 Trigger 绑定展示；Trigger 使用定义顺序与协调优先级；Tutorial 保留 steps[]';
    bar.appendChild(title);

    const showAll = document.createElement('label');
    showAll.className = 'scene-event-filter-all-visible';
    const showAllInput = document.createElement('input');
    showAllInput.id = 'editor-event-filter-all-visible';
    showAllInput.type = 'checkbox';
    const effectivelyVisibleCount = this.events.filter(event =>
      !this.hiddenBindingIds.has(event.id) && event.binding.enabled !== false).length;
    showAllInput.checked = this.events.length === 0 || effectivelyVisibleCount === this.events.length;
    showAllInput.indeterminate = effectivelyVisibleCount > 0 && effectivelyVisibleCount < this.events.length;
    showAll.append(showAllInput, document.createTextNode(' 显示全部'));
    showAll.title = '仅控制编辑器中的事件标记显隐，不写入场景 JSON';
    bar.appendChild(showAll);

    const scroll = document.createElement('div');
    scroll.className = 'scene-event-filter-scroll';
    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.dataset.filterMode = 'all';
    allButton.className = `scene-event-filter-item${this.state.mode === 'all' ? ' active' : ''}`;
    allButton.textContent = `全部 (${this.events.length})`;
    allButton.title = '显示完整场景，关闭事件视图过滤';
    scroll.appendChild(allButton);

    const appendTriggerEntry = (trigger, flowIndex) => {
      const entry = document.createElement('div');
      entry.className = 'scene-event-filter-trigger-entry';
      const focusCheck = document.createElement('input');
      focusCheck.type = 'checkbox';
      focusCheck.dataset.triggerFocus = trigger.id;
      focusCheck.checked = this.state.focusedTriggerIds.has(trigger.id);
      focusCheck.setAttribute('aria-label', `聚焦 ${trigger.name || trigger.id}`);
      focusCheck.title = '勾选=纳入聚焦并集（画布压暗/隔离无关对象）；点击名称=单独聚焦';
      const triggerButton = document.createElement('button');
      triggerButton.type = 'button';
      triggerButton.dataset.filterMode = 'trigger';
      triggerButton.dataset.triggerId = trigger.id;
      triggerButton.className = `scene-event-filter-item trigger${this.state.focusedTriggerIds.has(trigger.id) ? ' active' : ''}`;
      const priority = Number(trigger.coordination?.priority) || 0;
      const questInfo = this.questByTriggerId.get(trigger.id);
      triggerButton.textContent = `T${flowIndex + 1} · ${trigger.name || trigger.id} · do[${(trigger.do || []).length}]`;
      triggerButton.title = `Trigger ${trigger.id}\nwhen: ${trigger.when?.type || '?'}\n协调组: ${trigger.coordination?.group || '独立'}\npriority: ${priority}\n定义顺序: ${this.projectIndex.triggers.indexOf(trigger) + 1}`
        + (questInfo ? `\n任务步骤: ${questInfo.stepTitle}（${questInfo.questTitle}）` : '\n未归属任务（场景级/跨步骤流程）')
        + '\n双击打开定义';
      entry.append(focusCheck, triggerButton);
      scroll.appendChild(entry);
      for (const record of this.bindings.filter(item => item.definition?.id === trigger.id)) {
        appendBindingEntry(record);
      }
    };
    const appendBindingEntry = record => {
      const eventEntry = document.createElement('div');
      eventEntry.className = 'scene-event-filter-event-entry';
      const visibility = document.createElement('input');
      visibility.type = 'checkbox';
      visibility.dataset.eventVisibility = record.id;
      visibility.checked = !this.hiddenBindingIds.has(record.id) && record.binding.enabled !== false;
      visibility.disabled = record.binding.enabled === false;
      visibility.setAttribute('aria-label', `显示空间 binding ${eventLabel(record)}`);
      visibility.title = record.binding.enabled === false
        ? '右侧“是否显示”已关闭；点击 binding 名称后可在属性栏重新启用'
        : '仅控制此空间 binding 在编辑器中的显示，不写入场景 JSON';
      const bindingButton = document.createElement('button');
      bindingButton.type = 'button';
      bindingButton.dataset.filterMode = 'binding';
      bindingButton.dataset.bindingId = record.id;
      bindingButton.className = `scene-event-filter-item binding${this.state.mode === 'binding' && this.state.selectedBindingId === record.id ? ' active' : ''}`;
      bindingButton.textContent = `空间 · ${eventLabel(record)}`;
      bindingButton.title = `${record.binding.triggerId || '未绑定'} · ${record.definition?.when?.type || record.binding.event || '?'}`;
      eventEntry.append(visibility, bindingButton);
      scroll.appendChild(eventEntry);
    };

    if (this.questGroups.length) {
      // 任务分组皮：按 quests.json 的步骤事实归属把 Trigger 分组展示。
      const assigned = new Set(this.questGroups.flatMap(group => group.steps.flatMap(step => step.triggerIds)));
      for (const group of this.questGroups) {
        const questTriggerIds = [...new Set(group.steps.flatMap(step => step.triggerIds))];
        const header = document.createElement('div');
        header.className = 'scene-event-filter-quest-header';
        const questCheck = document.createElement('input');
        questCheck.type = 'checkbox';
        questCheck.dataset.questFocus = group.id;
        questCheck.checked = questTriggerIds.length > 0
          && questTriggerIds.every(id => this.state.focusedTriggerIds.has(id));
        questCheck.title = '勾选=聚焦该任务全部步骤的参与对象（并集）';
        const questButton = document.createElement('button');
        questButton.type = 'button';
        questButton.dataset.filterMode = 'quest';
        questButton.dataset.questId = group.id;
        const questActive = questTriggerIds.length > 0
          && questTriggerIds.every(id => this.state.focusedTriggerIds.has(id));
        questButton.className = `scene-event-filter-item quest${questActive ? ' active' : ''}`;
        questButton.textContent = `任务 · ${group.title} · ${questTriggerIds.length}流程`;
        questButton.title = `任务 ${group.id}\n分类: ${group.category || 'main'}\n点击=聚焦全部参与对象\n${group.steps.map(step => `· ${step.title} ← ${step.triggerIds.join(', ')}`).join('\n')}`;
        header.append(questCheck, questButton);
        scroll.appendChild(header);
        for (const triggerId of questTriggerIds) {
          const flowIndex = this.triggers.findIndex(trigger => trigger.id === triggerId);
          if (flowIndex >= 0) appendTriggerEntry(this.triggers[flowIndex], flowIndex);
        }
      }
      const unassigned = this.triggers
        .map((trigger, flowIndex) => ({ trigger, flowIndex }))
        .filter(({ trigger }) => !assigned.has(trigger.id));
      if (unassigned.length) {
        const header = document.createElement('div');
        header.className = 'scene-event-filter-quest-header';
        const questButton = document.createElement('button');
        questButton.type = 'button';
        questButton.disabled = true;
        questButton.className = 'scene-event-filter-item quest';
        questButton.textContent = `场景级 / 未归属任务 · ${unassigned.length}流程`;
        questButton.title = '未被任何任务步骤事实声明的 Trigger（场景入场、氛围、跨步骤链等）';
        header.appendChild(questButton);
        scroll.appendChild(header);
        for (const { trigger, flowIndex } of unassigned) appendTriggerEntry(trigger, flowIndex);
      }
    } else {
      for (let flowIndex = 0; flowIndex < this.triggers.length; flowIndex++) {
        appendTriggerEntry(this.triggers[flowIndex], flowIndex);
      }
    }

    const unboundBindings = this.bindings.filter(record => !record.definition?.id
      || (!record.definition.id || !this.triggers.some(trigger => trigger.id === record.definition.id)));
    for (const record of unboundBindings) {
      const eventEntry = document.createElement('div');
      eventEntry.className = 'scene-event-filter-event-entry';
      const bindingButton = document.createElement('button');
      bindingButton.type = 'button';
      bindingButton.dataset.filterMode = 'binding';
      bindingButton.dataset.bindingId = record.id;
      bindingButton.className = `scene-event-filter-item binding${this.state.mode === 'binding' && this.state.selectedBindingId === record.id ? ' active' : ''}`;
      bindingButton.textContent = `空间 · ${eventLabel(record)}`;
      bindingButton.title = `${record.binding.triggerId || '未绑定'}（未解析到 Trigger 定义）`;
      eventEntry.appendChild(bindingButton);
      scroll.appendChild(eventEntry);
    }

    this.tutorials.forEach((tutorial, tutorialIndex) => {
      const tutorialButton = document.createElement('button');
      tutorialButton.type = 'button';
      tutorialButton.dataset.editorTarget = 'tutorials';
      tutorialButton.dataset.definitionId = tutorial.id;
      tutorialButton.className = 'scene-event-filter-item tutorial';
      const stepTexts = (tutorial.steps || []).map((step, index) => `${index + 1}. ${step.text || step.id || '未命名步骤'}`);
      tutorialButton.textContent = `教学${tutorialIndex + 1} · ${tutorial.title || tutorial.id} · ${stepTexts.length}步`;
      tutorialButton.title = `Tutorial ${tutorial.id}\n${stepTexts.join('\n') || '无步骤'}\n点击打开教学定义`;
      scroll.appendChild(tutorialButton);
    });
    bar.appendChild(scroll);

    // 聚焦视图档位：压暗（保留空间上下文）/ 隔离（只看参与对象）
    const focusLevelBox = document.createElement('div');
    focusLevelBox.className = 'scene-event-filter-focus-level';
    for (const [level, label] of [['dim', '压暗'], ['isolate', '隔离']]) {
      const levelButton = document.createElement('button');
      levelButton.type = 'button';
      levelButton.dataset.focusLevel = level;
      levelButton.className = `scene-event-filter-focus-level-button${this.state.focusLevel === level ? ' active' : ''}`;
      levelButton.textContent = label;
      levelButton.title = level === 'dim'
        ? '聚焦模式：参与对象原色，无关对象低透明度压暗（保留空间上下文）'
        : '隔离模式：只显示参与对象与背景层，其余全部隐藏';
      focusLevelBox.appendChild(levelButton);
    }
    focusLevelBox.title = '勾选 Trigger/任务后生效：控制聚焦视图中无关对象的呈现方式';
    bar.appendChild(focusLevelBox);

    const total = this._allObjects().length;
    const visible = this.visibleObjects ? this.visibleObjects.size : total;
    const status = document.createElement('span');
    status.className = 'scene-event-filter-status';
    status.textContent = `${visible}/${total}`;
    status.title = '当前可见对象数 / 场景对象总数';
    if (this.state.focusedTriggerIds.size > 0) {
      const highlightCount = this.highlightObjects ? this.highlightObjects.size : 0;
      const dimmedCount = this.dimmedObjects ? this.dimmedObjects.size : 0;
      status.textContent += ` · 聚焦${this.state.focusedTriggerIds.size}流程 参与对象${highlightCount}`
        + (this.state.focusLevel === 'dim' ? ` 压暗${dimmedCount}` : '');
      status.title += `\n聚焦模式：${[...this.state.focusedTriggerIds].join(', ')}\n参与对象=${highlightCount}（含空间 binding）`;
    }
    if (this.dynamicTargets.length) {
      status.textContent += ` · 动态目标 ${this.dynamicTargets.length}`;
      status.title += `\n运行时动态目标或当前场景未找到：${this.dynamicTargets.join(', ')}`;
    }
    bar.appendChild(status);

    const dragTrack = document.createElement('div');
    dragTrack.className = 'scene-event-filter-drag-track';
    dragTrack.title = '拖动以横向浏览事件视图';
    const dragThumb = document.createElement('div');
    dragThumb.className = 'scene-event-filter-drag-thumb';
    dragTrack.appendChild(dragThumb);
    bar.appendChild(dragTrack);
    this._bindHorizontalDrag(scroll, dragTrack, dragThumb);
  }

  _bindHorizontalDrag(scroll, track, thumb) {
    const metrics = () => {
      const trackWidth = track.clientWidth;
      const maxScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const ratio = scroll.scrollWidth > 0 ? scroll.clientWidth / scroll.scrollWidth : 1;
      const thumbWidth = Math.min(trackWidth, Math.max(32, trackWidth * ratio));
      const travel = Math.max(0, trackWidth - thumbWidth);
      return { trackWidth, maxScroll, thumbWidth, travel };
    };
    const updateThumb = () => {
      const { maxScroll, thumbWidth, travel } = metrics();
      const offset = maxScroll > 0 ? (scroll.scrollLeft / maxScroll) * travel : 0;
      thumb.style.width = `${thumbWidth}px`;
      thumb.style.transform = `translateX(${offset}px)`;
      track.classList.toggle('disabled', maxScroll <= 0);
    };
    const scrollToPointer = clientX => {
      const rect = track.getBoundingClientRect();
      const { maxScroll, thumbWidth, travel } = metrics();
      if (maxScroll <= 0 || travel <= 0) return;
      const offset = Math.max(0, Math.min(travel, clientX - rect.left - thumbWidth / 2));
      scroll.scrollLeft = (offset / travel) * maxScroll;
    };

    const onScroll = () => {
      this._scrollLeft = scroll.scrollLeft;
      updateThumb();
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('pointerdown', event => {
      if (event.target === thumb || track.classList.contains('disabled')) return;
      event.preventDefault();
      scrollToPointer(event.clientX);
    });
    thumb.addEventListener('pointerdown', event => {
      if (track.classList.contains('disabled')) return;
      event.preventDefault();
      const startX = event.clientX;
      const startScroll = scroll.scrollLeft;
      const pointerId = event.pointerId;
      thumb.classList.add('dragging');
      thumb.setPointerCapture(pointerId);
      const onMove = moveEvent => {
        const { maxScroll, travel } = metrics();
        if (maxScroll > 0 && travel > 0) {
          scroll.scrollLeft = startScroll + ((moveEvent.clientX - startX) / travel) * maxScroll;
        }
      };
      const onEnd = () => {
        thumb.classList.remove('dragging');
        thumb.removeEventListener('pointermove', onMove);
        thumb.removeEventListener('pointerup', onEnd);
        thumb.removeEventListener('pointercancel', onEnd);
      };
      thumb.addEventListener('pointermove', onMove);
      thumb.addEventListener('pointerup', onEnd);
      thumb.addEventListener('pointercancel', onEnd);
    });
    const restoreScroll = () => {
      const { maxScroll } = metrics();
      scroll.scrollLeft = Math.max(0, Math.min(maxScroll, this._scrollLeft));
      this._scrollLeft = scroll.scrollLeft;
      updateThumb();
    };
    restoreScroll();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreScroll);
  }
}

export default SceneEditorEventFilter;

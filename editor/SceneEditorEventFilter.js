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

export class SceneEditorEventFilter {
  constructor(editor) {
    this.editor = editor;
    this.state = {
      mode: 'all',
      selectedTriggerId: '',
      selectedBindingId: '',
      includeRelated: false
    };
    this.events = [];
    // 全 Trigger 化：扁平展示场景内绑定与 Trigger（不再有 FlowGroup/phase 容器）
    this.bindings = [];
    this.triggers = [];
    this.tutorials = [];
    this.projectIndex = new TriggerProjectIndex();
    this.hiddenBindingIds = new Set();
    this.visibleObjects = null;
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
      includeRelated: false
    };
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
    this.state.selectedTriggerId = this.projectIndex.getTrigger(previousTriggerId)
      ? previousTriggerId : '';
    this.state.selectedBindingId = currentIds.has(previousBindingId) ? previousBindingId : '';
    if (this.state.mode === 'trigger' && !this.state.selectedTriggerId) this.state.mode = 'all';
    if (this.state.mode === 'binding' && !this.state.selectedBindingId) this.state.mode = 'all';
    this._recomputeProjection();
    this.renderBar();
    if (notify) this._notifyViewChanged();
  }

  getState() {
    return {
      ...this.state,
      showAllEvents: this.hiddenBindingIds.size === 0,
      hiddenBindingIds: [...this.hiddenBindingIds]
    };
  }
  getEvents() { return [...this.events]; }
  isFiltering() { return this.state.mode !== 'all' || this.hiddenBindingIds.size > 0; }
  isObjectVisible(object) { return !this.visibleObjects || this.visibleObjects.has(object); }
  filterObjects(objects = []) { return this.visibleObjects ? objects.filter(object => this.visibleObjects.has(object)) : [...objects]; }

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
    this._applySelection();
  }

  selectTrigger(triggerId) {
    const definition = this.projectIndex.getTrigger(triggerId);
    if (!definition) return;
    this.state.mode = 'trigger';
    this.state.selectedTriggerId = triggerId;
    this.state.selectedBindingId = '';
    this._applySelection();
  }

  selectEvent(bindingId) {
    const record = this.events.find(event => event.id === bindingId);
    if (!record) return;
    this.state.mode = 'binding';
    this.state.selectedBindingId = bindingId;
    this.state.selectedTriggerId = record.definition?.id || '';
    this._applySelection();
    // 即使 canonical enabled=false 导致画布不绘制，也允许从事件条重新选中并在右侧恢复。
    this.editor.selectedObjects = [record.binding];
    this.editor.ui?.updateObjectProperties();
    this.editor.render();
  }

  setIncludeRelated(value) {
    this.state.includeRelated = !!value;
    this._applySelection();
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
    const hasDisabledBindings = this.events.some(event => event.binding.enabled === false);
    if (this.state.mode === 'all' && this.hiddenBindingIds.size === 0 && !hasDisabledBindings) {
      this.visibleObjects = null;
      return;
    }
    const selectedEvents = this._selectedEvents()
      .filter(event => !this.hiddenBindingIds.has(event.id) && event.binding.enabled !== false);
    const visible = this.state.mode === 'all'
      ? new Set(this._allObjects().filter(object => object?.type !== 'trigger'))
      : new Set();
    for (const event of selectedEvents) visible.add(event.binding);
    // 聚焦流程时仍保留完整场景对象上下文；筛选只作用于空间 Trigger 标记。
    // 这样玩家出生点、火堆等 ref 放置物及其余逻辑对象可与当前流程一起编辑和校验。
    if (this.state.mode !== 'all') {
      for (const layer of this.sceneData?.layers || []) {
        const persistentVisualLayer = isPersistentVisualLayer(layer);
        for (const object of layer.objects || []) {
          if (persistentVisualLayer || object?.type !== 'trigger') visible.add(object);
        }
      }
    }
    if (this.state.includeRelated) this._resolveRelatedObjects(selectedEvents, visible);
    // 临时隐藏与 canonical enabled=false 都拥有最终优先级，关联闭包或视觉层不得重新加入。
    for (const event of this.events) {
      if (this.hiddenBindingIds.has(event.id) || event.binding.enabled === false) visible.delete(event.binding);
    }
    this.visibleObjects = visible;
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
      const button = event.target.closest('button[data-filter-mode]');
      if (!button) return;
      if (button.dataset.filterMode === 'all') this.selectAll();
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
      } else if (event.target.id === 'editor-event-filter-related') {
        this.setIncludeRelated(event.target.checked);
      }
    });
    this.renderBar();
  }

  renderBar() {
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

    for (let flowIndex = 0; flowIndex < this.triggers.length; flowIndex++) {
      const trigger = this.triggers[flowIndex];
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

      const triggerButton = document.createElement('button');
      triggerButton.type = 'button';
      triggerButton.dataset.filterMode = 'trigger';
      triggerButton.dataset.triggerId = trigger.id;
      triggerButton.className = `scene-event-filter-item trigger${this.state.mode === 'trigger' && this.state.selectedTriggerId === trigger.id ? ' active' : ''}`;
      const priority = Number(trigger.coordination?.priority) || 0;
      const triggerBindings = this.bindings.filter(item => item.definition?.id === trigger.id);
      triggerButton.textContent = `T${flowIndex + 1} · ${trigger.name || trigger.id} · do[${(trigger.do || []).length}]`;
      triggerButton.title = `Trigger ${trigger.id}\nwhen: ${trigger.when?.type || '?'}\n协调组: ${trigger.coordination?.group || '独立'}\npriority: ${priority}\n定义顺序: ${this.projectIndex.triggers.indexOf(trigger) + 1}\n双击打开定义`;
      scroll.appendChild(triggerButton);
      for (const record of triggerBindings) appendBindingEntry(record);
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

    const related = document.createElement('label');
    related.className = 'scene-event-filter-related';
    related.innerHTML = `<input id="editor-event-filter-related" type="checkbox"${this.state.includeRelated ? ' checked' : ''}> 显示关联对象`;
    related.title = '显示 binding/action 明确引用的目标、组、NPC、敌人和刷怪对象；不会按对象自身 group 自动扩大';
    bar.appendChild(related);

    const total = this._allObjects().length;
    const visible = this.visibleObjects ? this.visibleObjects.size : total;
    const status = document.createElement('span');
    status.className = 'scene-event-filter-status';
    status.textContent = `${visible}/${total}`;
    status.title = '当前可见对象数 / 场景对象总数';
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

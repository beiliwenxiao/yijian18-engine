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

import { InputEventType, PointerButton } from '../input/InputEvent.js';
import { normalizeSceneObjectSelector, resolveSceneObjects } from './SceneObjectSelector.js';
import { createSpatialTriggerBinding } from './SpatialTriggerBinding.js';
import { resolveSceneSpatialGeometry } from './SceneSpatialGeometry.js';

const EMPTY_TARGETS = Object.freeze([]);

/**
 * 场景空间触发器绑定：只处理已投影到世界坐标的 binding，行为始终由 TriggerSystem 执行。
 */
export class SceneTriggerBindingSystem {
  constructor({
    triggerSystem = null,
    getPlayer = null,
    getConditionRoot = null,
    isTutorialCompleted = null,
    resolveDynamicTarget = null,
    eventJournal = null,
    getLogicalTime = () => 0,
    logger = null,
    onPromptChange = null,
    onInteractChoices = null
  } = {}) {
    this.triggerSystem = triggerSystem;
    this.getPlayer = typeof getPlayer === 'function' ? getPlayer : () => null;
    this.getConditionRoot = typeof getConditionRoot === 'function' ? getConditionRoot : () => undefined;
    this.isTutorialCompleted = typeof isTutorialCompleted === 'function'
      ? isTutorialCompleted
      : () => false;
    this.resolveDynamicTarget = typeof resolveDynamicTarget === 'function' ? resolveDynamicTarget : null;
    this.eventJournal = eventJournal || null;
    this.getLogicalTime = typeof getLogicalTime === 'function' ? getLogicalTime : () => 0;
    this.logger = typeof logger === 'function' ? logger : null;
    this.onPromptChange = typeof onPromptChange === 'function' ? onPromptChange : null;
    this.onInteractChoices = typeof onInteractChoices === 'function' ? onInteractChoices : null;
    this.bindings = [];
    this.sceneObjects = [];
    this._inside = new Map();
    this._completedBindings = new Set();
    this._selectors = new Map();
    this._staticSpatialContexts = new Map();
    this._spatialContexts = new Map();
    this._activePromptBindingId = null;
    this._disposed = false;
  }

  setTriggerSystem(triggerSystem) {
    this.triggerSystem = triggerSystem || null;
    return this;
  }

  setEventJournal(eventJournal, getLogicalTime = this.getLogicalTime) {
    this.eventJournal = eventJournal || null;
    this.getLogicalTime = typeof getLogicalTime === 'function' ? getLogicalTime : () => 0;
    return this;
  }

  setBindings(bindings = [], sceneObjects = []) {
    if (this._disposed) return this;
    const ids = new Set();
    this.sceneObjects = Array.isArray(sceneObjects) ? sceneObjects : [];
    this.bindings = (bindings || []).flatMap(rawBinding => {
      if (!rawBinding || rawBinding.type !== 'trigger' || rawBinding.enabled === false) return [];
      let binding;
      try {
        binding = createSpatialTriggerBinding(rawBinding);
      } catch (error) {
        console.warn('SceneTriggerBindingSystem: binding 无效', rawBinding?.id, error);
        return [];
      }
      if (!binding.id || !binding.triggerId || ids.has(binding.id)) {
        console.warn('SceneTriggerBindingSystem: binding.id/triggerId 缺失或 id 重复', binding.id);
        return [];
      }
      const definition = this.triggerSystem?.getById?.(binding.triggerId);
      if (definition && !this._matchesSceneEventReference(binding, definition)) {
        const expected = this._resolveFlowGroupId(definition);
        const actual = this._resolveFlowGroupId(binding);
        this.logger?.('sceneEventMismatch', binding, {
          expectedFlowGroupId: expected,
          expectedSceneEventId: expected,
          actualFlowGroupId: actual,
          actualSceneEventId: actual
        });
      }
      ids.add(binding.id);
      return [binding];
    });
    this._setActivePrompt(null);
    this._inside.clear();
    this._completedBindings.clear();
    this._selectors.clear();
    this._staticSpatialContexts.clear();
    this._spatialContexts.clear();
    for (const binding of this.bindings) {
      this._inside.set(binding.id, false);
      const selector = binding.selector || normalizeSceneObjectSelector({ sceneId: binding.sceneId });
      this._selectors.set(binding.id, selector);
      this._staticSpatialContexts.set(binding.id, this._createStaticSpatialContext(binding, selector));
    }
    return this;
  }

  update() {
    if (this._disposed || !this.triggerSystem) return 0;
    const position = this._playerPosition();
    if (!position) return 0;
    this._spatialContexts.clear();
    let fired = 0;
    for (const binding of this.bindings) {
      const eventType = this._eventType(binding);
      if (eventType !== 'approach' && eventType !== 'enter' && eventType !== 'leave') continue;
      if (!this._isBindingActive(binding)) {
        this._inside.set(binding.id, false);
        continue;
      }
      const spatial = this._resolveSpatialCached(binding);
      const inside = this._contains(binding, position.x, position.y, false, spatial);
      const wasInside = this._inside.get(binding.id) === true;
      this._inside.set(binding.id, inside);
      if (inside && !wasInside && (eventType === 'approach' || eventType === 'enter')) {
        if (this._fire(binding, eventType, spatial)) fired++;
      } else if (!inside && wasInside && eventType === 'leave') {
        if (this._fire(binding, eventType, spatial)) fired++;
      }
    }
    this._updatePrompt(position);
    return fired;
  }

  _resolveSpatialCached(binding) {
    if (!this._spatialContexts.has(binding.id)) {
      this._spatialContexts.set(binding.id, this._resolveSpatialContext(binding));
    }
    return this._spatialContexts.get(binding.id);
  }

  _updatePrompt(position) {
    let bestBinding = null;
    let bestDistance = Infinity;
    for (const binding of this.bindings) {
      if (this._eventType(binding) !== 'interact' || !binding.prompt
        || this._completedBindings.has(binding.id) || !this._isBindingActive(binding)) continue;
      const definition = this.triggerSystem?.getById?.(binding.triggerId);
      if (definition?.once && this.triggerSystem.hasFiredOnce?.(binding.triggerId)) continue;
      const spatial = this._resolveSpatialCached(binding);
      if (!this._contains(binding, position.x, position.y, false, spatial)) continue;
      const distance = this._distanceSq(binding, position, spatial);
      if (distance >= bestDistance) continue;
      bestBinding = binding;
      bestDistance = distance;
    }
    this._setActivePrompt(bestBinding);
  }

  _setActivePrompt(binding) {
    const id = binding?.id || null;
    if (id === this._activePromptBindingId) return;
    this._activePromptBindingId = id;
    this.onPromptChange?.(binding?.prompt || '', binding || null);
  }

  _collectInteractCandidates(event = null) {
    if (this._disposed || !this.triggerSystem) return [];
    const player = this._playerPosition();
    if (!player) return [];
    const isPointer = event?.type === InputEventType.POINTER_DOWN
      && event.button === PointerButton.LEFT;
    this._spatialContexts.clear();
    return this.bindings
      .filter(binding => this._eventType(binding) === 'interact')
      .map(binding => ({ binding, spatial: this._resolveSpatialCached(binding) }))
      .filter(candidate => this._contains(candidate.binding, player.x, player.y, false, candidate.spatial))
      .filter(candidate => this._isBindingActive(candidate.binding))
      .filter(candidate => !this._completedBindings.has(candidate.binding.id))
      .filter(candidate => {
        const definition = this.triggerSystem?.getById?.(candidate.binding.triggerId);
        return !definition?.once || !this.triggerSystem.hasFiredOnce?.(candidate.binding.triggerId);
      })
      .filter(candidate => !isPointer || !event.world
        || this._contains(candidate.binding, event.world.x, event.world.y, true, candidate.spatial))
      .map(candidate => ({
        ...candidate,
        distanceSq: this._distanceSq(candidate.binding, player, candidate.spatial)
      }))
      .sort((left, right) => {
        const priority = (Number(right.binding.interactionPriority) || 0)
          - (Number(left.binding.interactionPriority) || 0);
        if (priority !== 0) return priority;
        const activePrompt = Number(right.binding.id === this._activePromptBindingId)
          - Number(left.binding.id === this._activePromptBindingId);
        if (activePrompt !== 0) return activePrompt;
        if (left.distanceSq !== right.distanceSq) return left.distanceSq - right.distanceSq;
        return left.binding.id.localeCompare(right.binding.id);
      });
  }

  _projectInteractCandidates(candidates) {
    return Object.freeze(candidates.map(({ binding, distanceSq }) => Object.freeze({
      bindingId: binding.id,
      triggerId: binding.triggerId,
      choiceLabel: binding.choiceLabel || '',
      interactionPriority: Number(binding.interactionPriority) || 0,
      prompt: binding.prompt || '',
      distanceSq,
      isActivePrompt: binding.id === this._activePromptBindingId
    })));
  }

  /** 返回当前玩家可执行的只读空间交互候选，并使用稳定的产品优先级排序。 */
  listInteractCandidates(event = null) {
    return this._projectInteractCandidates(this._collectInteractCandidates(event));
  }

  /** 按稳定 binding ID 重新校验空间和条件后执行，业务拒绝也保持本次交互已处理。 */
  executeInteractBinding(bindingId, event = null) {
    const id = String(bindingId || '').trim();
    const candidate = this._collectInteractCandidates(event)
      .find(item => item.binding.id === id);
    if (!candidate) {
      return Object.freeze({ handled: false, accepted: false, bindingId: id, triggerId: '' });
    }
    const accepted = this._fire(candidate.binding, 'interact', candidate.spatial) === true;
    return Object.freeze({
      handled: true,
      accepted,
      bindingId: candidate.binding.id,
      triggerId: candidate.binding.triggerId
    });
  }

  /** 处理统一交互事件；存在有效候选时返回 true 并消费输入，不代表后续业务动作已提交成功。 */
  handleInteract(event) {
    if (this._disposed || !this.triggerSystem) return false;
    const isKey = event?.type === InputEventType.KEY_PRESS && event.key === 'e';
    const isPointer = event?.type === InputEventType.POINTER_DOWN && event.button === PointerButton.LEFT;
    if (!isKey && !isPointer) return false;

    const candidates = this._collectInteractCandidates(event);
    if (candidates.length === 0) return false;
    if (candidates.length > 1 && this.onInteractChoices) {
      try {
        const handled = this.onInteractChoices(this._projectInteractCandidates(candidates), event) === true;
        if (handled) return true;
      } catch (error) {
        this.logger?.('interactionChoiceError', null, error);
        console.error('SceneTriggerBindingSystem: 打开交互选择失败', error);
        return true;
      }
    }

    this._fire(candidates[0].binding, 'interact', candidates[0].spatial);
    return true;
  }

  /** 当前是否有空间 trigger 占用交互提示。 */
  hasActivePrompt() {
    return this._activePromptBindingId !== null;
  }

  /** 返回只读调试快照；仅解析空间事实，不执行 trigger 或修改业务状态。 */
  getDebugHotspotSnapshot() {
    if (this._disposed) return Object.freeze([]);
    const snapshots = this.bindings.map(binding => {
      const spatial = this._resolveSpatialContext(binding);
      const definition = this.triggerSystem?.getById?.(binding.triggerId);
      const onceCompleted = definition?.once === true
        && this.triggerSystem?.hasFiredOnce?.(binding.triggerId) === true;
      const geometry = spatial.geometry;
      const active = Boolean(definition) && this._isBindingActive(binding)
        && !this._completedBindings.has(binding.id) && !onceCompleted;
      return Object.freeze({
        bindingId: binding.id,
        triggerId: binding.triggerId,
        flowGroupId: this._resolveFlowGroupId(binding),
        sceneEventId: this._resolveFlowGroupId(binding),
        sceneId: binding.sceneId,
        eventType: this._eventType(binding),
        prompt: binding.prompt || '',
        active,
        inside: this._inside.get(binding.id) === true,
        radius: Math.max(0, Number(binding.radius) || 0),
        pointerRadius: Math.max(0, Number(binding.pointerRadius ?? binding.radius) || 0),
        anchor: Object.freeze({ ...geometry.anchor }),
        bounds: Object.freeze({
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height
        })
      });
    });
    return Object.freeze(snapshots);
  }

  clear() {
    this._setActivePrompt(null);
    this.bindings = [];
    this.sceneObjects = [];
    this._inside.clear();
    this._completedBindings.clear();
    this._selectors.clear();
    this._staticSpatialContexts.clear();
    this._spatialContexts.clear();
  }

  dispose() {
    if (this._disposed) return false;
    this.clear();
    this.triggerSystem = null;
    this._disposed = true;
    return true;
  }

  resetBinding(id) {
    if (!id) return false;
    const existed = this._completedBindings.delete(id);
    this._inside.set(id, false);
    if (this._activePromptBindingId === id) this._setActivePrompt(null);
    return existed;
  }

  _resolveFlowGroupId(obj) {
    if (!obj) return '';
    const fromFg = typeof obj.flowGroupId === 'string' ? obj.flowGroupId.trim() : '';
    if (fromFg) return fromFg;
    return typeof obj.sceneEventId === 'string' ? obj.sceneEventId.trim() : '';
  }

  _matchesSceneEventReference(binding, definition = this.triggerSystem?.getById?.(binding?.triggerId)) {
    if (!definition) return false;
    // 空值视为不参与外键校验（等价于无归属的 Trigger，允许在任何场景下 binding）
    const expected = this._resolveFlowGroupId(definition);
    if (!expected) return true;
    const actual = this._resolveFlowGroupId(binding);
    return expected === actual;
  }

  _isBindingActive(binding) {
    if (binding?.enabled === false || !this._matchesSceneEventReference(binding)) return false;
    if (!binding?.activeWhen) return true;
    try {
      return this._evaluateCondition(binding.activeWhen);
    } catch (error) {
      this.logger?.('activeConditionError', binding, error);
      return false;
    }
  }

  /** activeWhen 与 placement spawnWhen 共享基础比较语义，并支持组合及教学完成状态。 */
  _evaluateCondition(condition) {
    if (!condition || typeof condition !== 'object') return true;
    if (Array.isArray(condition.all)) return condition.all.every(item => this._evaluateCondition(item));
    if (Array.isArray(condition.any)) return condition.any.some(item => this._evaluateCondition(item));
    if (condition.not) return !this._evaluateCondition(condition.not);
    if (condition.tutorialId) {
      const completed = this.isTutorialCompleted(String(condition.tutorialId));
      return completed === (condition.completed !== false);
    }

    let value = this.getConditionRoot(condition.blackboardKey || 'storyState');
    for (const segment of String(condition.path || '').split('.').filter(Boolean)) {
      value = value && typeof value === 'object' ? value[segment] : undefined;
    }
    if (condition.exists === true && value === undefined) return false;
    if (condition.exists === false && value !== undefined) return false;
    if (Object.prototype.hasOwnProperty.call(condition, 'equals') && value !== condition.equals) return false;
    if (Object.prototype.hasOwnProperty.call(condition, 'gte') && !(Number(value) >= Number(condition.gte))) return false;
    if (Object.prototype.hasOwnProperty.call(condition, 'lte') && !(Number(value) <= Number(condition.lte))) return false;
    if (Array.isArray(condition.in) && !condition.in.includes(value)) return false;
    return true;
  }

  _eventType(binding) {
    return this.triggerSystem?.getById?.(binding.triggerId)?.when?.type || '';
  }

  _fire(binding, eventType = this._eventType(binding), spatial = this._resolveSpatialContext(binding)) {
    const definition = this.triggerSystem?.getById?.(binding.triggerId);
    if (!this._matchesSceneEventReference(binding, definition)) {
      const expected = this._resolveFlowGroupId(definition);
      const actual = this._resolveFlowGroupId(binding);
      this.logger?.('sceneEventMismatch', binding, {
        expectedFlowGroupId: expected,
        expectedSceneEventId: expected,
        actualFlowGroupId: actual,
        actualSceneEventId: actual
      });
      return false;
    }
    if (!this._isBindingActive(binding)) return false;
    if (!binding.triggerId) {
      this.logger?.('missingTriggerId', binding);
      return false;
    }
    const { selector, targets, geometry } = spatial;
    if (selector.value && targets.length === 0) {
      this.logger?.('missingTarget', binding);
      return false;
    }

    const params = {
      target: targets[0]?.id ?? '',
      targetSelector: selector,
      targetObject: targets[0] || null,
      targetObjects: targets,
      targetIds: targets.map(object => object.id).filter(Boolean),
      targetAnchor: { ...geometry.anchor },
      targetGeometry: {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        center: { ...geometry.center }
      },
      triggerId: binding.triggerId,
      flowGroupId: this._resolveFlowGroupId(binding),
      sceneEventId: this._resolveFlowGroupId(binding),
      bindingId: binding.id,
      sceneId: binding.sceneId
    };
    const eventPayload = { ...params };
    delete eventPayload.targetObject;
    delete eventPayload.targetObjects;
    const eventJournal = this.eventJournal
      || this.triggerSystem?.eventJournal
      || this.triggerSystem?.ctx?.scene?.sceneRuntime?.eventJournal
      || null;
    const journalEvent = eventJournal?.create?.({
      eventDefinitionId: binding.sceneEventId || binding.flowGroupId || binding.triggerId,
      type: eventType,
      source: {
        kind: 'spatialTriggerBinding',
        bindingId: binding.id,
        triggerId: binding.triggerId,
        sceneId: binding.sceneId || null
      },
      sceneId: binding.sceneId || null,
      payload: eventPayload,
      logicalTime: this.getLogicalTime(),
      persistent: true
    }) || null;
    if (journalEvent?.eventId) {
      params.eventId = journalEvent.eventId;
      params.eventDefinitionId = journalEvent.eventDefinitionId;
      params.eventSource = journalEvent.source;
      params.eventActorRef = journalEvent.actorRef;
      params.eventSceneId = journalEvent.sceneId;
      params.eventPayloadFingerprint = journalEvent.payloadFingerprint;
      params.sourceEventType = journalEvent.type;
      params.sourceEventDefinitionId = journalEvent.eventDefinitionId;
      params.sourceEventSource = journalEvent.source;
      params.sourceEventActorRef = journalEvent.actorRef;
      params.sourceEventSceneId = journalEvent.sceneId;
      params.sourceEventPayload = journalEvent.payload;
    }
    const fired = this.triggerSystem.fireById(binding.triggerId, eventType, params);
    if (!fired && !definition) this.logger?.('missingTrigger', binding);
    return fired;
  }

  _selector(binding) {
    return this._selectors.get(binding.id)
      || binding.selector
      || normalizeSceneObjectSelector({ sceneId: binding.sceneId });
  }

  _resolveDynamicTargets(binding, selector = this._selector(binding)) {
    if (!this.resolveDynamicTarget || selector.mode !== 'id' || !selector.value) return EMPTY_TARGETS;
    try {
      const resolved = this.resolveDynamicTarget(selector.value, binding, selector);
      if (!resolved) return EMPTY_TARGETS;
      const targets = Array.isArray(resolved) ? resolved : [resolved];
      return targets.filter(target => target?.id === selector.value
        && (!selector.sceneId || !target.sceneId || target.sceneId === selector.sceneId));
    } catch (error) {
      this.logger?.('dynamicTargetError', binding, error);
      return EMPTY_TARGETS;
    }
  }

  _createStaticSpatialContext(binding, selector = this._selector(binding)) {
    const targets = selector.value ? resolveSceneObjects(this.sceneObjects, selector) : EMPTY_TARGETS;
    const geometry = resolveSceneSpatialGeometry(targets[0] || binding, {
      fallback: binding,
      offsetX: binding.anchorOffsetX,
      offsetY: binding.anchorOffsetY
    });
    return { selector, targets, geometry };
  }

  /** 每帧只探测 O(1) 动态 ID；不存在动态实体时直接复用 setBindings 阶段的静态空间快照。 */
  _resolveSpatialContext(binding) {
    const selector = this._selector(binding);
    const dynamicTargets = this._resolveDynamicTargets(binding, selector);
    if (dynamicTargets.length === 0) {
      return this._staticSpatialContexts.get(binding.id)
        || this._createStaticSpatialContext(binding, selector);
    }
    const geometry = resolveSceneSpatialGeometry(dynamicTargets[0], {
      fallback: binding,
      offsetX: binding.anchorOffsetX,
      offsetY: binding.anchorOffsetY
    });
    return { selector, targets: dynamicTargets, geometry };
  }

  _playerPosition() {
    const player = this.getPlayer();
    const transform = player?.getComponent?.('transform');
    return transform?.position || player?.position || null;
  }

  _geometry(binding, spatial = null) {
    return (spatial || this._resolveSpatialContext(binding)).geometry;
  }

  _center(binding, spatial = null) {
    return this._geometry(binding, spatial).center;
  }

  _contains(binding, x, y, pointer = false, spatial = null) {
    const geometry = this._geometry(binding, spatial);
    const radius = Math.max(0, Number(pointer ? (binding.pointerRadius ?? binding.radius) : binding.radius) || 0);
    if (radius > 0) {
      const deltaX = x - geometry.anchor.x;
      const deltaY = y - geometry.anchor.y;
      return deltaX * deltaX + deltaY * deltaY <= radius * radius;
    }
    return x >= geometry.x && x <= geometry.x + geometry.width
      && y >= geometry.y && y <= geometry.y + geometry.height;
  }

  _distanceSq(binding, point, spatial = null) {
    const anchor = this._geometry(binding, spatial).anchor;
    return (anchor.x - point.x) ** 2 + (anchor.y - point.y) ** 2;
  }
}

export default SceneTriggerBindingSystem;
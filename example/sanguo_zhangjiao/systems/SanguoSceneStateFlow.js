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

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { getPlacementSignature } from '../../../src/core/scene/ScenePlacementRuntime.js';
import { S09_REFUGEE_DIALOGUE_ID } from './S09RefugeeFlow.js';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * Demo-owned S01–S14 scene state composition. The coordinator deliberately owns
 * no gameplay rules: it invokes the scene's existing, explicitly injected systems.
 */
export class SanguoSceneStateFlow extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, {
      captureSceneSaveState,
      restoreSceneSaveState,
      handleApplicationEvent,
      handleWorldItemPicked,
      handleEquipmentChanged
    }, {
      name: 'SanguoSceneStateFlow'
    });
  }
}

function captureSceneSaveState() {
  const pendingPlacementState = this.context.services.placements?.getPendingStateSnapshot?.()
    || { resourceNodes: [], placementStates: [] };
  const resourceNodeStates = new Map(pendingPlacementState.resourceNodes);
  for (const entity of this.entities || []) {
    const node = entity?.getComponent?.('resourceNode');
    if (node) resourceNodeStates.set(entity.id, node.serialize());
  }
  const deathDrops = this._deathDrops.capture();
  const placements = this.context.services.placements;
  const placementById = new Map((placements?.getPlacements?.() || [])
    .filter(placement => typeof placement?.id === 'string')
    .map(placement => [placement.id, placement]));
  const withPlacementSignature = (placementId, state) => {
    const placement = placementById.get(placementId);
    return placement ? { ...state, placementSignature: getPlacementSignature(placement) } : state;
  };
  const placementStates = new Map([...pendingPlacementState.placementStates]
    .map(([placementId, state]) => [placementId, withPlacementSignature(placementId, state)]));
  for (const item of this.pickupItems || []) {
    const placementId = item?.placementId;
    if (!placementId) continue;
    placementStates.set(placementId, withPlacementSignature(placementId, {
      kind: 'item', removed: item.picked === true,
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0))
    }));
  }
  const seenEnemies = new Set();
  for (const list of Object.values(this._groupEnemies || {})) {
    for (const enemy of list || []) {
      if (!enemy?.id || seenEnemies.has(enemy.id)) continue;
      seenEnemies.add(enemy.id);
      const stats = enemy.getComponent?.('stats');
      const transform = enemy.getComponent?.('transform');
      const corpseState = this.context.services.corpses?.capture?.(enemy);
      placementStates.set(enemy.id, withPlacementSignature(enemy.id, corpseState || {
        kind: 'enemy', removed: this._isEntityDead(enemy),
        hp: Math.max(0, Number(stats?.hp) || 0),
        position: transform ? { x: transform.position.x, y: transform.position.y } : null,
        ai: this.aiSystem?.getRuntimeState?.(enemy) || null
      }));
    }
  }
  const hasWorldStreaming = !!this.worldStreamingManager;
  const s11s14State = this.s11s14SceneCoordinator._captureS11S14SceneState();
  if (hasWorldStreaming) s11s14State.vehicleStates = [];
  return {
    worldStreamingState: this.worldStreamingManager?.serialize?.() || null,
    regionStates: [...(this._regionDynamicStates || new Map()).entries()].map(([regionId, state]) => ({
      regionId, state: cloneData(state)
    })),
    campfireLit: this._campfireService.snapshot().lit,
    campfireState: this._campfireService.snapshot(),
    containerInventories: this.context.services.containerInventories?.serialize?.() || null,
    firedPickups: [...(this._firedPickups || [])],
    clearedGroups: [...(this._clearedGroups || [])],
    ...(hasWorldStreaming ? {} : {
      resourceNodes: [...resourceNodeStates.entries()].map(([id, state]) => ({ id, state })),
      placementStates: [...placementStates.entries()].map(([id, state]) => ({ id, state })),
      deathDrops,
      s10StructureStates: this.s10ConstructionCoordinator._captureS10StructureStates()
    }),
    ...this._gameplaySnapshots.capture(),
    ...this.s03s14BattleCoordinator.capture(),
    rescueState: this.rescueSystem?.serialize?.() || null,
    ...s11s14State,
    gatheringPolicyOperations: this.s09RefugeeCoordinator.captureUnauthorizedHarvestOperations(),
    timeState: this.timeSystem?.serialize?.() || null,
    weatherState: this.weatherSystem?.serialize?.() || null
  };
}

function restoreSceneSaveState(data = {}) {
  const validation = validateSceneSaveState.call(this, data);
  if (!validation.ok) return validation;

  let rollbackState;
  try {
    rollbackState = captureSceneSaveState.call(this);
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: 'sceneStateRollbackCaptureFailed', path: '',
        message: error?.message || '场景状态回滚快照采集失败'
      }]
    };
  }

  const result = applySceneSaveState.call(this, data);
  if (result.ok) return result;

  const rollback = applySceneSaveState.call(this, rollbackState);
  if (rollback.ok) return result;
  return {
    ok: false,
    errors: [
      ...(result.errors || []),
      ...(rollback.errors || []).map(error => ({
        ...error,
        code: error.code || 'sceneStateRollbackFailed',
        path: error.path ? `rollback.${error.path}` : 'rollback'
      }))
    ]
  };
}

async function handleApplicationEvent(event = {}) {
  if (event.type === 'world.teleport') {
    const outcome = event.payload?.value || {};
    const sceneId = outcome.sceneId || outcome.request?.sceneId || null;
    const forwarded = await this._forwardCommittedSceneEnter?.(sceneId);
    if (forwarded !== true) {
      return {
        ok: false,
        code: 'committedSceneEnterForwardFailed',
        message: `已提交导航的 sceneEnter 接续失败: ${sceneId || 'unknown'}`
      };
    }
    // 场景切换存档统一挂在 ChunkNavigator.onSceneEnter（DataDrivenPrologueScene），此处不重复触发
  }
  if (event.type === 'item.repaired') {
    const payload = event.payload || {};
    this.notificationSystem?.addNotification?.(
      `已锻造修复 ${payload.name || payload.itemId || '工具'}（${payload.durability}/${payload.maxDurability}）`,
      'success'
    );
    return { ok: true, itemId: payload.itemId || null, repaired: true };
  }
  if (!this.gameLoader) {
    return { ok: true, ignored: true, code: 'gameLoaderUnavailable' };
  }
  if (event.type !== 'item.picked') {
    const dispatch = await this.gameLoader.triggerSystem.fireCoordinated(event.type, {
      ...(event.payload || {}),
      sourceEventType: event.type,
      sourceEventDefinitionId: event.eventDefinitionId || event.type,
      sourceEventSource: event.source || { kind: 'postCommitNotification', operationId: event.operationId || null },
      sourceEventActorRef: event.actorRef || event.payload?.actorRef || null,
      sourceEventSceneId: event.sceneId || event.payload?.sceneId || null,
      sourceEventPayload: event.payload || {},
      eventId: event.eventId || null,
      operationId: event.operationId || event.eventId || null,
      committed: true
    });
    if (dispatch.ok !== true) {
      return {
        ok: false,
        code: 'applicationEventTriggerFailed',
        message: `${event.type || 'unknown'} Trigger 执行失败`,
        dispatch
      };
    }
    return { ok: true, eventType: event.type, dispatch };
  }
  const payload = event.payload || {};
  const itemId = payload.itemId || payload.item?.id || payload.definitionId;
  if (!itemId) return { ok: true, ignored: true, code: 'itemIdMissing' };
  if (!this._firedPickups) this._firedPickups = new Set();
  const uid = [event.operationId || event.eventId, payload.definitionId || itemId,
    payload.instanceId || payload.groundId || 'stack'].join(':');

  if (payload.placementId && payload.complete === true) {
    this.context.services.placements?.addPendingPlacementState?.(
      payload.placementId,
      { kind: 'item', removed: true, quantity: 0 }
    );
  }
  if (this._firedPickups.has(uid)) {
    return { ok: true, idempotent: true, code: 'itemPickupAlreadyConsumed' };
  }

  const dispatch = await this.gameLoader.triggerSystem.fireCoordinated('itemPickup', {
    ...payload,
    itemId,
    item: payload.item || itemId,
    id: itemId,
    sourceEventType: event.type,
    sourceEventDefinitionId: event.eventDefinitionId || event.type,
    sourceEventSource: event.source || { kind: 'postCommitNotification', operationId: event.operationId || null },
    sourceEventActorRef: event.actorRef || event.payload?.actorRef || null,
    sourceEventSceneId: event.sceneId || event.payload?.sceneId || null,
    sourceEventPayload: event.payload || {},
    operationId: event.operationId || null,
    eventId: event.eventId,
    groundId: payload.groundId || null,
    placementId: payload.placementId || null,
    complete: payload.complete === true,
    quantity: Math.max(0, Number(payload.quantity) || 0),
    committed: true
  });
  if (dispatch.ok !== true) {
    return {
      ok: false,
      code: 'itemPickupTriggerFailed',
      message: `itemPickup Trigger 执行失败: ${itemId}`,
      dispatch
    };
  }

  this._firedPickups.add(uid);
  console.log('[DDScene] itemPickup committed:', itemId);
  return { ok: true, itemId, dispatch };
}

/** 仅供尚未迁移调用方使用；正式路径由 PostCommitNotificationBus 的 item.picked 事件进入。 */
function handleWorldItemPicked(item) {
  if (!item || (item.pickupCommitted !== true && item.picked !== true)) return false;
  return handleApplicationEvent.call(this, {
    eventId: item.pickupEventId || item.operationId || item.entityId || item.id,
    operationId: item.operationId || item.pickupEventId || item.id,
    type: 'item.picked',
    payload: {
      groundId: item.groundId || null,
      placementId: item.placementId || null,
      entityId: item.entityId || null,
      complete: item.picked === true,
      definitionId: item.definitionId || item.id,
      itemId: item.itemId || item.id,
      instanceId: item.instanceId || null,
      quantity: item.quantity || 1,
      item
    }
  });
}

/** 已提交的装备变更只投影为内容 trigger，不持有装备事实。 */
function handleEquipmentChanged(info = null) {
  if (!this.gameLoader) return false;
  const equipment = this.playerEntity?.getComponent?.('equipment');
  const slots = equipment?.slots || {};
  const rawSlot = info?.slot || (slots.mainhand ? 'mainhand' : 'weapon');
  const slot = rawSlot === 'mainhand' ? 'weapon' : rawSlot;
  const isUnequip = info?.action === 'unequip';
  const changed = isUnequip
    ? (info?.oldItem || null)
    : (info?.item || slots[rawSlot] || slots.mainhand || slots.weapon || null);
  this.gameLoader.triggerSystem.fire(isUnequip ? 'unequipItem' : 'equipItem', {
    slot,
    rawSlot,
    item: changed ? (changed.id || changed.name || '') : ''
  });
  return true;
}

function validateSceneSaveState(data) {
  if (data?.timeState != null) {
    if (typeof this.timeSystem?.validateSerialized !== 'function') {
      return failure('timeState', '昼夜运行时尚未就绪', 'timeRuntimeUnavailable');
    }
    const timeCheck = this.timeSystem.validateSerialized(data.timeState);
    if (!timeCheck.ok) {
      const error = timeCheck.errors?.[0] || {};
      return failure(
        error.path ? `timeState.${error.path}` : 'timeState',
        error.message || '昼夜状态校验失败',
        error.code || 'invalidTimeState'
      );
    }
  }
  const battleValidation = this.s03s14BattleCoordinator.validateSnapshot(data);
  if (!battleValidation.ok) {
    const detail = battleValidation.code === 'unknownBattleId'
      ? `：${battleValidation.battleId || '缺少 battleId'}（定义=${battleValidation.hasDefinition === true ? '已注册' : '未注册'}，流程=${battleValidation.hasFlow === true ? '已注册' : '未注册'}）`
      : '';
    return failure('battleState', `战役运行状态校验失败: ${battleValidation.code}${detail}`, battleValidation.code, battleValidation.path);
  }
  if (data.rescueState) {
    if (!this.rescueSystem) return failure('rescueState', '救援运行时尚未就绪', 'rescueRuntimeUnavailable');
    const check = this.rescueSystem.validateSerialized(data.rescueState);
    if (!check.ok) return failure('rescueState', `救援状态校验失败: ${check.code}`, check.code);
    const rescueId = data.rescueState.definition?.id || null;
    if (rescueId && !this.s03s14BattleCoordinator.hasRescueDefinition(rescueId)) {
      return failure('rescueState.definition.id', `未知救援配置: ${rescueId}`, 'unknownRescueId');
    }
  }
  const containerCheck = this.context.services.containerInventories?.validateSerialized?.(data.containerInventories);
  if (containerCheck && !containerCheck.ok) return { ok: false, errors: containerCheck.errors.map(error => ({
    ...error, path: error.path ? `containerInventories.${error.path}` : 'containerInventories'
  })) };
  if (data.worldStreamingState) {
    if (!this.worldStreamingManager) return failure('worldStreamingState', '世界流式运行时尚未就绪', 'worldStreamingUnavailable');
    const check = this.worldStreamingManager.validateSerialized(data.worldStreamingState);
    if (!check.ok) return { ok: false, errors: check.errors.map(error => ({
      ...error, path: error.path ? `worldStreamingState.${error.path}` : 'worldStreamingState'
    })) };
  }
  const deathDropValidation = this._deathDrops.validate(data.deathDrops);
  if (!deathDropValidation.ok) return deathDropValidation;
  const s11s14Check = this.s11s14SceneCoordinator._validateS11S14SceneState(data);
  if (!s11s14Check.ok) return s11s14Check;
  const gameplayValidation = this._gameplaySnapshots.validate(data);
  if (!gameplayValidation.ok) return gameplayValidation;
  const s10StructureCheck = this.s10ConstructionCoordinator._validateS10StructureStates(data.s10StructureStates);
  if (!s10StructureCheck.ok) {
    return failure(
      Number.isInteger(s10StructureCheck.index) ? `s10StructureStates[${s10StructureCheck.index}]` : 's10StructureStates',
      'S10 工事动态状态校验失败', s10StructureCheck.code
    );
  }
  return { ok: true, errors: [] };
}

function applySceneSaveState(data) {
  try {
    if (data.worldStreamingState) {
      const worldRestore = this.worldStreamingManager.deserialize(data.worldStreamingState);
      if (!worldRestore.ok) return {
        ok: false,
        errors: worldRestore.errors.map(error => ({
          ...error,
          path: error.path ? `worldStreamingState.${error.path}` : 'worldStreamingState'
        }))
      };
    }
    this._regionDynamicStates = new Map((data.regionStates || [])
      .filter(entry => typeof entry?.regionId === 'string' && entry.state && typeof entry.state === 'object')
      .map(entry => [entry.regionId, cloneData(entry.state)]));
    const containerRestore = this.context.services.containerInventories?.restore?.(data.containerInventories);
    if (containerRestore && !containerRestore.ok) return { ok: false, errors: containerRestore.errors };
    this._firedPickups = new Set(data.firedPickups || []);
    this._clearedGroups = new Set(data.clearedGroups || []);
    this.s09RefugeeCoordinator.restoreUnauthorizedHarvestOperations(data.gatheringPolicyOperations);
    const restoredStoryDay = Math.max(1, Math.floor(Number(
      this.gameLoader?.blackboard?.get?.('storyState')?.currentDay
    ) || 1));
    if (data.timeState != null && this.timeSystem?.deserialize?.(data.timeState) !== true) {
      return failure('timeState', '昼夜状态恢复失败', 'timeStateRestoreFailed');
    }
    if (data.weatherState && this.weatherSystem?.deserialize?.(data.weatherState) !== true) {
      return failure('weatherState', '天气状态恢复失败', 'weatherStateRestoreFailed');
    }
    this.timeSystem?.setCurrentDay?.(restoredStoryDay);
    if (!data.worldStreamingState) {
      this.context.services.placements?.setPendingStates?.({
        resourceNodes: data.resourceNodes || [],
        placementStates: data.placementStates || []
      });
    }

    const placementRuntime = this.context.services.placements;
    const rebuild = placementRuntime?.rebuild?.(this.currentSceneId)
      || failure('placementStates', '场景放置运行时尚未就绪', 'placementRuntimeUnavailable');
    if (!rebuild.ok) return rebuild;
    placementRuntime.applyPendingToExisting([
      ...(this.entities || []),
      ...(this.pickupItems || []),
      ...(this.equipmentItems || [])
    ]);
    this.cityWarStateBridge.syncResourceNodes(
      this.gameLoader?.blackboard?.get?.('warResourceNodeStates') || []
    );

    const gameplayFoundations = this._gameplaySnapshots.restoreFoundations(data);
    if (!gameplayFoundations.ok) return gameplayFoundations;
    if (!data.worldStreamingState) {
      const s10StructureRestore = this.s10ConstructionCoordinator._restoreS10StructureStates(
        data.s10StructureStates || []
      );
      if (!s10StructureRestore.ok) {
        return failure(
          's10StructureStates',
          `S10 工事动态状态恢复失败: ${s10StructureRestore.siteId || s10StructureRestore.riderId || 'unknown'}`,
          s10StructureRestore.code
        );
      }
    }
    if (data.battleState || data.battlefieldRuntimeState || data.cityWarState) {
      const restored = this.s03s14BattleCoordinator.restore(data);
      if (!restored.ok) {
        return failure(restored.path || 'battleState', `战役运行状态恢复失败: ${restored.code}`, restored.code);
      }
    }
    if (data.rescueState) {
      const restored = this.rescueSystem.deserialize(data.rescueState);
      if (!restored.ok) return failure('rescueState', '救援状态恢复失败', restored.code);
      if (restored.state?.definitionId) this.s03s14BattleCoordinator.setRescueObjectiveTitle(restored.state.definitionId);
      this.rescueObjectiveView?.setSnapshot?.(restored.state);
    }
    const s11s14Restore = this.s11s14SceneCoordinator._restoreS11S14SceneState(data);
    if (!s11s14Restore.ok) return s11s14Restore;
    if (data.worldStreamingState) {
      const domainRestore = this.sanguoWorldRuntimeCoordinator.restoreStreamedDomainState(this.currentSceneId);
      if (domainRestore?.ok === false) {
        return failure(
          'worldStreamingState',
          `当前地图块领域状态恢复失败: ${domainRestore.definitionId || domainRestore.siteId || 'unknown'}`,
          domainRestore.code || 'streamedDomainRestoreFailed'
        );
      }
    } else {
      const dropRestore = this._deathDrops.restore(data.deathDrops || []);
      if (!dropRestore.ok) return dropRestore;
    }

    const restoredClass = this.playerEntity?.getComponent?.('stats')?.class;
    const restoredStory = this.gameLoader?.blackboard?.get?.('storyState') || {};
    const supportedClasses = ['warrior', 'archer', 'strategist'];
    if (restoredStory.classSelectionCommitted === true
      && (!supportedClasses.includes(restoredClass) || restoredStory.selectedClass !== restoredClass)) {
      return failure('selectedClass', '职业存档事实与玩家属性不一致', 'classStateMismatch');
    }
    if (supportedClasses.includes(restoredClass)) {
      const classSystem = this._ensureClassSystem();
      if (!classSystem?.restoreClass?.(this.playerEntity.id, restoredClass)) {
        return failure('selectedClass', `职业运行状态恢复失败: ${restoredClass}`, 'classRestoreFailed');
      }
      this._classSelected = true;
      this.selectedClass = restoredClass;
      this.playerEntity.class = restoredClass;
    } else {
      const classSystem = this._ensureClassSystem();
      classSystem?.clearClass?.(this.playerEntity?.id);
      if (this.playerEntity) delete this.playerEntity.class;
      const stats = this.playerEntity?.getComponent?.('stats');
      if (stats) delete stats.class;
      this._classSelected = false;
      this.selectedClass = null;
    }
    this._syncPlayerClassAppearance(this.selectedClass);
    this._syncUnlockedClassSkills();
    const gameplayActors = this._gameplaySnapshots.restoreActors(data);
    if (!gameplayActors.ok) return gameplayActors;
    const refugeeConflict = restoredStory.s09RefugeeConflict;
    if (refugeeConflict && this.dialogueSystem?.getCurrentDialogue?.()?.id === S09_REFUGEE_DIALOGUE_ID) {
      if (refugeeConflict.branch) {
        this.s09RefugeeCoordinator._setRefugeeDialogueNode(
          this.s09RefugeeCoordinator._refugeeBranchResultNode(refugeeConflict)
        );
      } else if (refugeeConflict.donationCommitted) {
        this.s09RefugeeCoordinator._setRefugeeDialogueNode('branchChoice');
      } else if (refugeeConflict.status === 'started') {
        this.s09RefugeeCoordinator._setRefugeeDialogueNode('donationOffer');
      }
    }
    this._classConfirm = null;
    this._classSelectionBusy = false;
    this._campfireService.restore(
      data.campfireState || { lit: data.campfireLit === true },
      { particleSystem: this.particleSystem }
    );
    this._s01s02Coordinator?.projectRestoredAtmosphere?.({
      hasTimeState: Boolean(data.timeState),
      hasWeatherState: Boolean(data.weatherState)
    });
    this._s09AudioDirector?.syncScene?.(this.currentSceneId);
    void this.sanguoSceneNavigationCoordinator.projectEntryRuntime(this.currentSceneId);
    return { ok: true, errors: [] };
  } catch (error) {
    return failure('', error?.message || String(error), 'sceneStateRestoreFailed');
  }
}

function failure(path, message, code) {
  return { ok: false, errors: [{ code, path, message }] };
}

export default SanguoSceneStateFlow;

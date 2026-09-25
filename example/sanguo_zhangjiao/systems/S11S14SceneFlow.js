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

 ************************************************************
 * 三国张角传 - S11-S14 场景流程适配
 * 历史人物和固定剧情留在 Demo；领域状态继续委托通用系统。
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { EndingSystem } from '../../../src/systems/EndingSystem.js';
import { VehicleWeaponSystem } from '../../../src/systems/VehicleWeaponSystem.js';
import { RescueStatus } from '../../../src/systems/RescueSystem.js';
import { Entity } from '../../../src/ecs/Entity.js';
import { TransformComponent } from '../../../src/ecs/components/TransformComponent.js';
import { BuildingComponent, BuildingType } from '../../../src/ecs/components/BuildingComponent.js';
import { PadButton } from '../../../src/core/input/Xbox360Profile.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const S11_BATTLE_ID = 'battle.s11.guangzong';
const S12_BATTLE_ID = 'battle.s12.xiaquyang';
const S13_BATTLE_ID = 'battle.s13.jingshan';
const S11_RESCUE_ID = 'rescue.s11.zhangLiang';
const S12_RESCUE_ID = 'rescue.s12.zhangBao';
const S12_GATE_ID = 'S12-yamen-gate';
const S11_HORSE_ID = 'vehicle.s11.breakoutHorse';
const S12_LADDER_ID = 'vehicle.s12.siegeLadder';
const S11_HORSE_TRAVEL_BATCH = 120;
const RESOURCE_IDS = Object.freeze({ food: 'resource.food', herb: 'resource.herb', wood: 'resource.wood', iron: 'resource.iron' });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function getPath(source, path) {
  return String(path || '').split('.').reduce((value, key) => value == null ? undefined : value[key], source);
}

function inventoryQuantity(inventory, itemId) {
  return (inventory?.slots || []).reduce((total, stack) => (
    stack?.item?.id === itemId ? total + Math.max(0, Math.floor(Number(stack.quantity) || 0)) : total
  ), 0);
}

function entityAlive(scene, entityId) {
  const entity = (scene.entities || []).find(candidate => candidate?.id === entityId);
  return !!entity && !scene._isEntityDead(entity);
}

function formatFailure(result, fallback) {
  const messages = {
    modeNotAllowed: '只有介入战役后才能启动救援。',
    battleNotIntervened: '当前战役未处于可救援的介入状态。',
    guardsMissing: `集合区内存活卫兵不足：${result?.actual || 0}/${result?.required}。`,
    stageNotActive: '当前救援阶段尚未开放。',
    secretPassageLocked: '府衙门防守时限尚未满足，密道还未开放。',
    escortLocked: '先开启密道，再护送目标撤离。',
    rescueResourceMissing: `救援物资不足：${result?.itemId || '资源'} 缺少 ${result?.missing || 0}。`,
    coordinatorBusy: '救援结果正在保存，请稍候。'
  };
  return messages[result?.code] || result?.message || fallback;
}

async function activateGroup(scene, group, aiType = null) {
  await scene.context?.services?.placements?.spawn({ group, sceneId: scene.currentSceneId });
  const entities = scene._groupEnemies?.[group] || [];
  let active = 0;
  for (const entity of entities) {
    if (scene._isEntityDead(entity)) continue;
    if (scene.aiSystem?.activateAI?.(entity, aiType || entity.aiType || 'aggressive')) active += 1;
  }
  return { ok: entities.length > 0, count: entities.length, active };
}

async function travel(scene, sceneId, title) {
  const regionIndex = scene._findRegionIndexForScene?.(sceneId);
  if (regionIndex < 0) {
    scene._showScreenTip?.(`世界地图未登记 ${sceneId}。`, { title: '目标场景不可用' });
    return false;
  }
  let result;
  if (regionIndex !== scene._currentRegionIndex) {
    result = await scene.travelToRegion?.({ regionIndex, sceneId, spawnRef: 'player' });
    if (result?.ok === false) return false;
  } else {
    result = await scene.teleportToChunk?.({ scene: sceneId, spawnRef: 'player', transition: 'fadeBlack' });
    if (result === false || result?.cancelled) return false;
  }
  scene._showScreenTip?.(`已抵达 ${sceneId}。`, { title });
  return true;
}

function buildLowMoraleResult(scene, context = {}) {
  const definition = scene.s03s14BattleCoordinator?.getDefinition?.(S12_BATTLE_ID);
  const create = definition?.createParams || {};
  const policy = definition?.realtimeResult?.byWinner?.han_government || {};
  const resources = clone(policy.capturedResources || {});
  return {
    schemaVersion: 2,
    resultId: `result-${S12_BATTLE_ID}-friendly-morale-zero`,
    responseId: `response-realtime-${S12_BATTLE_ID}-friendly-morale-zero`,
    battleId: context.battleId || S12_BATTLE_ID,
    winnerFactionId: context.winnerFactionId || 'han_government',
    casualties: {
      [create.attackerArmy?.id || 'army.s12.han']: 0,
      [create.defenderArmy?.id || 'army.s12.yellow_turban']: 0
    },
    capturedResources: resources,
    resourceTransfer: {
      fromCityId: create.resourceSourceCityId,
      toCityId: create.resourceDestinationCityId,
      resources: clone(resources)
    },
    affectedCityId: create.affectedCityId,
    cityDamage: clamp(policy.cityDamage, 0, 1),
    damagedResourceNodeIds: clone(policy.damagedResourceNodeIds || []),
    completedAt: Math.max(0, Math.floor(Number(create.logicalTime) || 0)),
    failureReason: context.failureReason || 'friendlyMoraleZero'
  };
}

const s11s12Methods = {
  async executeRescueCommand(command = {}) {
    const rescueId = command.rescueId;
    const definition = this.s03s14BattleCoordinator?.getRescueDefinition?.(rescueId);
    if (!definition || definition.id !== rescueId) return false;
    const operation = command.operation;
    if (operation === 'start') {
      if (!entityAlive(this, definition.targetEntityId)) {
        this._showScreenTip('救援目标尚未生成或已经阵亡。', { title: '救援不可用' });
        return false;
      }
      this.s03s14BattleCoordinator?.setRescueObjectiveTitle?.(rescueId);
    }
    if (operation === 'completeStage' && command.stageId === 'rally-guards') {
      command = {
        ...command,
        guardCount: (this._groupEnemies?.[command.placementGroup || this._rescueSpawnGroup(definition, command.stageId)] || [])
          .filter(entity => !this._isEntityDead(entity)).length
      };
    }
    const finalStageId = definition.stages?.[definition.stages.length - 1]?.id;
    if (operation === 'completeStage' && command.stageId === finalStageId && definition.evacuationRef) {
      const target = (this.entities || []).find(entity => entity?.id === definition.targetEntityId);
      const targetPosition = target?.getComponent?.('transform')?.position;
      const exit = this._worldLoadSession?.findSpawn?.(this.currentSceneId, definition.evacuationRef);
      if (!targetPosition || !exit || Math.hypot(targetPosition.x - exit.x, targetPosition.y - exit.y) > Number(definition.evacuationRadius)) {
        this._showScreenTip('救援目标尚未到达撤离点，请继续护送。', { title: '撤离未完成' });
        return false;
      }
    }
    const result = await this.s11s12Coordinator?.executeCommand?.({
      ...command,
      mode: command.mode || this.s03s14BattleCoordinator?.getSessionState?.().mode,
      startedAt: command.startedAt ?? this.rescueSystem?.now?.()
    });
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '救援命令未能提交。'), { title: '救援不可用' });
      return false;
    }
    const stageEffect = definition.stageEffects?.[command.stageId];
    if (operation === 'completeStage' && stageEffect?.spawnGroup) {
      await activateGroup(this, stageEffect.spawnGroup, stageEffect.aiType || null);
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    return true;
  },

  _rescueSpawnGroup(definition, stageId) {
    return definition?.spawnGroups?.[stageId] || null;
  },

  _createS12LowMoraleResult(context = {}) {
    return buildLowMoraleResult(this, context);
  },

  async interactS11Horse() {
    if (this.currentSceneId !== 'S11') return false;
    this._ensureSceneVehicleEntities?.('S11');
    const horse = this._sceneVehicleEntities?.get?.(S11_HORSE_ID);
    if (!horse || horse._horseTravelCommitBusy || horse._horseInteractionCommitBusy) {
      this._showScreenTip('战马状态正在保存，请稍候。', { title: '战马忙碌' });
      return false;
    }
    const rider = this.playerEntity?.getComponent?.('rider');
    if (rider) {
      if (rider.vehicleId !== horse.id || rider.role !== 'driver') {
        this._showScreenTip('你已占用其他载具席位，请先离席。', { title: '无法操作战马' });
        return false;
      }
      const vehicle = horse.getComponent?.('vehicle');
      if (vehicle?.logistics?.starved) {
        return this._resumeS11Horse(horse, this.playerEntity?.getComponent?.('inventory'));
      }
      return this.leaveS11Horse();
    }
    return this.mountS11Horse();
  },

  async mountS11Horse() {
    if (this.currentSceneId !== 'S11') return false;
    this._ensureSceneVehicleEntities?.('S11');
    const horse = this._sceneVehicleEntities?.get?.(S11_HORSE_ID);
    const vehicle = horse?.getComponent?.('vehicle');
    const movement = horse?.getComponent?.('movement');
    const inventory = this.playerEntity?.getComponent?.('inventory');
    if (!horse || !vehicle || !movement || !inventory || vehicle.destroyed) {
      this._showScreenTip('突围战马当前不可使用。', { title: '战马不可用' });
      return false;
    }
    if (horse._horseTravelCommitBusy || horse._horseInteractionCommitBusy) {
      this._showScreenTip('战马状态正在保存，请稍候。', { title: '战马忙碌' });
      return false;
    }
    const rider = this.playerEntity?.getComponent?.('rider');
    if (rider) {
      if (rider.vehicleId === horse.id && rider.role === 'driver') {
        this._showScreenTip('你已经骑在这匹战马上。', { title: '已在驾驶席' });
        return true;
      }
      this._showScreenTip('你已占用其他载具席位，请先离席。', { title: '无法上马' });
      return false;
    }
    if (vehicle.logistics.starved && !await this._resumeS11Horse(horse, inventory)) return false;
    if (!this.vehicleSystem?.mount?.(this.playerEntity, horse, 'driver')) {
      movement.stop?.();
      this._showScreenTip('驾驶席已被占用。', { title: '无法上马' });
      return false;
    }
    movement.enabled = true;
    const position = horse.getComponent?.('transform')?.position;
    horse._horseTravelObservedPosition = position ? { x: position.x, y: position.y } : null;
    this._showScreenTip('已骑上战马。使用 {move} 驾驶；每行进一段距离会自动消耗粮食。', { title: '战马突围' });
    return true;
  },

  async _resumeS11Horse(horse, inventory) {
    const vehicle = horse?.getComponent?.('vehicle');
    const movement = horse?.getComponent?.('movement');
    const definition = this._getSceneVehicleDefinitions?.('S11')
      ?.find?.(entry => entry?.id === S11_HORSE_ID);
    if (!vehicle || !movement || !inventory || !definition || !this.vehicleLogisticsSystem?.refeedHorse) {
      this._showScreenTip('战马补粮服务当前不可用。', { title: '无法补粮' });
      return false;
    }
    const incident = Math.floor(vehicle.logistics.odometer / S11_HORSE_TRAVEL_BATCH);
    const operationId = `horse-refeed:${horse.id}:${incident}`;
    horse._horseInteractionCommitBusy = true;
    try {
      const result = await this.vehicleLogisticsSystem.refeedHorse({
        vehicle: horse,
        inventory,
        config: definition.consumption || {},
        inventoryOwnerId: `${this.playerEntity?.id || 'player'}:inventory`,
        operationId,
        checkpointId: 'checkpoint.s11.horse-refeed',
        context: { sceneId: 'S11', vehicleId: horse.id, incident }
      });
      if (!result?.ok) {
        const missing = Math.max(1, Number(result?.required) || 1);
        const message = result?.code === 'horseFoodMissing'
          ? `战马缺粮停步。背包中还需要 ${missing} 份粮食。`
          : '战马补粮检查点未提交，库存与载具状态保持不变。';
        this._showScreenTip(message, { title: result?.code === 'horseFoodMissing' ? '战马缺粮' : '补粮失败' });
        return false;
      }
      movement.enabled = true;
      this._showScreenTip('补粮已保存，战马可以继续移动。使用 {move} 驾驶。', { title: '继续突围' });
      return true;
    } catch (error) {
      this._showScreenTip('战马补粮异常，库存与载具状态保持未提交。', { title: '补粮失败' });
      return false;
    } finally {
      horse._horseInteractionCommitBusy = false;
    }
  },

  leaveS11Horse() {
    const rider = this.playerEntity?.getComponent?.('rider');
    if (this.currentSceneId !== 'S11' || rider?.vehicleId !== S11_HORSE_ID || rider?.role !== 'driver') {
      this._showScreenTip('你当前不在突围战马上。', { title: '无需下马' });
      return false;
    }
    const horse = this._sceneVehicleEntities?.get?.(S11_HORSE_ID);
    if (horse?._horseTravelCommitBusy || horse?._horseInteractionCommitBusy) {
      this._showScreenTip('战马状态正在保存，请稍候再下马。', { title: '战马忙碌' });
      return false;
    }
    horse?.getComponent?.('movement')?.stop?.();
    const left = this.vehicleSystem?.dismount?.(this.playerEntity) === true;
    if (left) {
      horse._horseTravelObservedPosition = null;
      this._showScreenTip('已安全下马。', { title: '离开战马' });
    }
    return left;
  },

  _updateS11HorseTravel() {
    const horse = this._sceneVehicleEntities?.get?.(S11_HORSE_ID);
    if (this.currentSceneId !== 'S11' || !horse || horse._horseTravelCommitBusy) return;
    const rider = this.playerEntity?.getComponent?.('rider');
    const transform = horse.getComponent?.('transform');
    const vehicle = horse.getComponent?.('vehicle');
    if (!transform || !vehicle || rider?.vehicleId !== horse.id || rider?.role !== 'driver') {
      horse._horseTravelObservedPosition = transform
        ? { x: transform.position.x, y: transform.position.y }
        : null;
      return;
    }
    const previous = horse._horseTravelObservedPosition;
    horse._horseTravelObservedPosition = { x: transform.position.x, y: transform.position.y };
    if (!previous) return;
    const travelled = Math.hypot(transform.position.x - previous.x, transform.position.y - previous.y);
    if (!Number.isFinite(travelled) || travelled <= 0 || travelled > 80) return;
    vehicle.logistics.travelBatchProgress += travelled;
    if (vehicle.logistics.travelBatchProgress < S11_HORSE_TRAVEL_BATCH) return;

    const inventory = this.playerEntity?.getComponent?.('inventory');
    const definition = this._getSceneVehicleDefinitions?.('S11')
      ?.find?.(entry => entry?.id === S11_HORSE_ID);
    if (!inventory || !definition) return;
    vehicle.logistics.travelBatchProgress -= S11_HORSE_TRAVEL_BATCH;
    const batchNumber = Math.floor(vehicle.logistics.odometer / S11_HORSE_TRAVEL_BATCH) + 1;
    const operationId = `horse-travel:${horse.id}:${batchNumber}`;
    horse._horseTravelCommitBusy = true;
    const settlement = this.vehicleLogisticsSystem?.recordHorseTravel?.({
      vehicle: horse,
      inventory,
      distance: S11_HORSE_TRAVEL_BATCH,
      config: definition.consumption || {},
      inventoryOwnerId: `${this.playerEntity?.id || 'player'}:inventory`,
      operationId,
      checkpointId: 'checkpoint.s11.horse-travel',
      context: { sceneId: 'S11', vehicleId: horse.id, batchNumber }
    });
    if (!settlement || typeof settlement.then !== 'function') {
      vehicle.logistics.travelBatchProgress += S11_HORSE_TRAVEL_BATCH;
      horse._horseTravelCommitBusy = false;
      this._showScreenTip('战马里程服务不可用，本段状态保持未提交。', { title: '里程未提交' });
      return;
    }
    void settlement.then(result => {
      if (result?.code === 'horseFoodMissing') {
        const movement = horse.getComponent?.('movement');
        if (movement) {
          movement.stop();
          movement.enabled = false;
        }
        this._showScreenTip('粮食不足，战马已经停步；粮食库存没有被扣成负数。', { title: '战马缺粮' });
      } else if (!result?.ok) {
        vehicle.logistics.travelBatchProgress += S11_HORSE_TRAVEL_BATCH;
        this._showScreenTip('战马里程检查点保存失败，本段耗粮与里程已回滚。', { title: '里程未提交' });
      }
    }).catch(() => {
      vehicle.logistics.travelBatchProgress += S11_HORSE_TRAVEL_BATCH;
      this._showScreenTip('战马里程结算异常，本段状态保持未提交。', { title: '里程未提交' });
    }).finally(() => { horse._horseTravelCommitBusy = false; });
  },

  async useS12LadderEntry() {
    if (this.currentSceneId !== 'S12') return false;
    this._ensureSceneVehicleEntities?.('S12');
    const ladder = this._sceneVehicleEntities?.get?.(S12_LADDER_ID);
    const vehicle = ladder?.getComponent?.('vehicle');
    if (!ladder || !vehicle || vehicle.destroyed || vehicle.logistics.ladderEntryDisabled) {
      this._showScreenTip('云梯已经烧毁，攻城入口不可用。', { title: '入口已禁用' });
      return false;
    }
    const result = await this.teleportToChunk?.({
      scene: 'S12', spawnRef: 'siege-ladder-top', transition: 'fadeBlack'
    });
    if (result === false || result?.cancelled) return false;
    this._showScreenTip('已从云梯登上城内侧。此入口不改变张宝密道救援阶段。', { title: '登城成功' });
    return true;
  },

  async burnS12Ladder(params = {}) {
    if (this.currentSceneId !== 'S12') return false;
    if (params.damageType !== 'fire') {
      this._showScreenTip('只有火焰伤害能够烧毁云梯。', { title: '伤害类型无效' });
      return false;
    }
    this._ensureSceneVehicleEntities?.('S12');
    const ladder = this._sceneVehicleEntities?.get?.(S12_LADDER_ID);
    if (!ladder) return false;
    const result = await this.vehicleLogisticsSystem?.burnLadder?.({
      vehicle: ladder,
      operationId: `ladder-burn:${ladder.id}`,
      checkpointId: 'checkpoint.s12.ladder-burned',
      context: { sceneId: 'S12', vehicleId: ladder.id, damageType: 'fire' }
    });
    if (!result?.ok) {
      this._showScreenTip(
        result?.code === 'vehicleCheckpointRejected'
          ? '检查点保存失败，云梯与攻城入口均已恢复。'
          : '云梯当前不能再次烧毁。',
        { title: '烧毁失败' }
      );
      return false;
    }
    ladder.getComponent?.('movement')?.stop?.();
    this._showScreenTip('云梯已被火焰烧毁，对应攻城入口立即禁用。', { title: '云梯烧毁' });
    return true;
  },

  async startS11Rescue() {
    if (this.currentSceneId !== 'S11' || !this.s11s12Coordinator) return false;
    const battleCoordinator = this.s03s14BattleCoordinator;
    const rescueDefinition = battleCoordinator?.getRescueDefinition?.(S11_RESCUE_ID);
    const battleSession = battleCoordinator?.getSessionState?.() || {};
    battleCoordinator?.setRescueObjectiveTitle?.(S11_RESCUE_ID);
    const targetId = rescueDefinition?.targetEntityId;
    if (!entityAlive(this, targetId)) {
      this._showScreenTip('张梁尚未生成或已经阵亡。', { title: '救援不可用' });
      return false;
    }
    const result = await this.s11s12Coordinator.startS11Rescue({
      mode: battleSession.mode,
      operationId: `start:${S11_RESCUE_ID}`
    });
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '张梁救援未能启动。'), { title: '救援不可用' });
      return false;
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    this._showScreenTip(`${rescueDefinition.duration} 秒计时开始。先点燃烽火召集${rescueDefinition.requiredGuardCount}名卫兵。`, { title: '张梁突围' });
    return true;
  },

  async advanceRescueBeacon() {
    if (this.currentSceneId !== 'S11') return false;
    const result = await this.s11s12Coordinator?.advanceBeaconStage?.();
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '烽火阶段尚未开放。'), { title: '无法点燃烽火' });
      return false;
    }
    await activateGroup(this, 'S11-rescue-guards', 'support');
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    this._showScreenTip('烽火已点燃。六名卫兵已经回应，在集合区与他们会合。', { title: '烽火传令' });
    return true;
  },

  async completeS11GuardRally() {
    if (this.currentSceneId !== 'S11') return false;
    const guards = (this._groupEnemies?.['S11-rescue-guards'] || [])
      .filter(entity => !this._isEntityDead(entity));
    const result = await this.s11s12Coordinator?.completeS11GuardRally?.({ guardCount: guards.length });
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '卫兵尚未集结。'), { title: '集合未完成' });
      return false;
    }
    this._s11PendingWaveActivation = 1;
    const activated = await this._retryS11WaveActivation();
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    this._showScreenTip(
      activated ? '卫兵已集结。第一波刺客从东侧逼近。' : '卫兵已集结，刺客波次正在重新集结。',
      { title: '刺客来袭' }
    );
    return true;
  },

  async reportS11AssassinWaveDefeated(waveNumber) {
    if (this.currentSceneId !== 'S11') return false;
    const wave = Math.floor(Number(waveNumber));
    const result = await this.s11s12Coordinator?.reportS11AssassinWaveDefeated?.(wave);
    if (!result?.ok) {
      this._clearedGroups?.delete?.(`S11-assassin-wave-${wave}`);
      return false;
    }
    const waveCount = Number(this.s03s14BattleCoordinator?.getRescueDefinition?.(S11_RESCUE_ID)?.assassinWaveCount);
    if (wave < waveCount) {
      const nextWave = wave + 1;
      this._s11PendingWaveActivation = nextWave;
      const activated = await this._retryS11WaveActivation();
      this._showScreenTip(
        activated
          ? `第 ${wave} 波刺客已击退，第 ${nextWave} 波正在逼近。`
          : `第 ${wave} 波刺客已击退，第 ${nextWave} 波正在重新集结。`,
        { title: '继续迎敌' }
      );
    } else {
      this._showScreenTip(`${waveCount} 波刺客全部击退。护送张梁前往西门突围点。`, { title: '西门已开放' });
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    return true;
  },

  async completeS11WestGateBreakout() {
    if (this.currentSceneId !== 'S11') return false;
    const definition = this.s03s14BattleCoordinator?.getRescueDefinition?.(S11_RESCUE_ID);
    const target = (this.entities || []).find(entity => entity?.id === definition?.targetEntityId);
    const targetTransform = target?.getComponent?.('transform');
    const exit = this._worldLoadSession?.findSpawn?.('S11', definition?.evacuationRef);
    if (!targetTransform || !exit || Math.hypot(
      targetTransform.position.x - exit.x,
      targetTransform.position.y - exit.y
    ) > Number(definition?.evacuationRadius)) {
      this._showScreenTip('张梁尚未到达西门，请继续护送。', { title: '突围未完成' });
      return false;
    }
    const result = await this.s11s12Coordinator?.completeS11WestGateBreakout?.();
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '西门突围阶段尚未开放。'), { title: '突围失败' });
      return false;
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    return true;
  },

  async checkS11Exit() {
    if (this.currentSceneId !== 'S11') return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s11BattleResolved !== true) {
      this._showScreenTip('先完成广宗战役结算。', { title: '尚不能前往下曲阳' });
      return false;
    }
    if (!story.rescueResults?.[S11_RESCUE_ID]) {
      this._showScreenTip('张梁救援尚未形成最终结果。介入时必须完成或失败，观战结果会在战役结算后冻结。', { title: '救援尚未结算' });
      return false;
    }
    return travel(this, 'S12', 'S12·下曲阳');
  },

  async startS12Rescue() {
    if (this.currentSceneId !== 'S12' || !this.s11s12Coordinator) return false;
    const battleCoordinator = this.s03s14BattleCoordinator;
    const rescueDefinition = battleCoordinator?.getRescueDefinition?.(S12_RESCUE_ID);
    const battleSession = battleCoordinator?.getSessionState?.() || {};
    battleCoordinator?.setRescueObjectiveTitle?.(S12_RESCUE_ID);
    if (!entityAlive(this, rescueDefinition?.targetEntityId)) {
      this._showScreenTip('张宝尚未生成或已经阵亡。', { title: '救援不可用' });
      return false;
    }
    this._ensureS12GateEntity();
    const result = await this.s11s12Coordinator.startS12Rescue({
      mode: battleSession.mode,
      startedAt: this.rescueSystem?.now?.(),
      operationId: `start:${S12_RESCUE_ID}`,
      costOperationId: `cost:${S12_RESCUE_ID}`
    });
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '张宝救援路线未能确认。'), { title: '救援不可用' });
      return false;
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    this._showScreenTip(`粮食与草药已提交。守住府衙门 ${rescueDefinition.duration} 秒，提前破门则救援失败。`, { title: '张宝救援' });
    return true;
  },

  async completeS12SecretPassage() {
    if (this.currentSceneId !== 'S12') return false;
    const result = await this.s11s12Coordinator?.completeS12SecretPassage?.({
      completedAt: this.rescueSystem?.now?.()
    });
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '密道尚不能开启。'), { title: '密道未开放' });
      return false;
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    this._showScreenTip('密道已经开启。张宝会跟随你，带他前往东南撤离点。', { title: '护送开始' });
    return true;
  },

  async completeS12Evacuation() {
    if (this.currentSceneId !== 'S12') return false;
    const definition = this.s03s14BattleCoordinator?.getRescueDefinition?.(S12_RESCUE_ID);
    const target = (this.entities || []).find(entity => entity?.id === definition?.targetEntityId);
    const targetTransform = target?.getComponent?.('transform');
    const exit = this._worldLoadSession?.findSpawn?.('S12', definition?.evacuationRef);
    if (!targetTransform || !exit || Math.hypot(
      targetTransform.position.x - exit.x,
      targetTransform.position.y - exit.y
    ) > Number(definition?.evacuationRadius)) {
      this._showScreenTip('张宝尚未进入撤离点，请继续护送。', { title: '撤离未完成' });
      return false;
    }
    const result = await this.s11s12Coordinator?.completeS12Evacuation?.({
      completedAt: this.rescueSystem?.now?.()
    });
    if (!result?.ok) {
      this._showScreenTip(formatFailure(result, '张宝撤离阶段尚未开放。'), { title: '撤离失败' });
      return false;
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    return true;
  },

  async advancePostRescueRoute() {
    if (this.currentSceneId !== 'S12') return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s12BattleResolved !== true || story.s12Resolved !== true) {
      this._showScreenTip('必须先完成下曲阳战役，并冻结张宝救援结果。', { title: '终局路线尚未开放' });
      return false;
    }
    const route = this.s13s14Coordinator?.resolvePostS12Target?.();
    if (!route?.ok) {
      this._showScreenTip(`终局路线不可用：${route?.code || 'unknown'}`, { title: '无法离开下曲阳' });
      return false;
    }
    return travel(this, route.sceneId, route.s13Eligible ? 'S13·精山战场' : 'S14·结局之地');
  },

  async _retryS11WaveActivation() {
    if (this.currentSceneId !== 'S11') return false;
    if (this._s11WaveActivationPromise) return this._s11WaveActivationPromise;
    const rescue = this.rescueSystem?.getState?.();
    if (rescue?.status !== RescueStatus.ACTIVE || rescue.stageId !== 'repel-assassins') return false;
    const waveCount = Number(this.s03s14BattleCoordinator?.getRescueDefinition?.(S11_RESCUE_ID)?.assassinWaveCount);
    if (!Number.isInteger(waveCount) || waveCount <= 0) return false;
    const defeated = Math.max(0, Math.floor(Number(this.s11s12Coordinator?.state?.s11?.assassinWavesDefeated) || 0));
    const wave = this._s11PendingWaveActivation || Math.min(waveCount, defeated + 1);
    const group = `S11-assassin-wave-${wave}`;
    if ((this._groupEnemies?.[group] || []).length > 0) {
      this._s11PendingWaveActivation = null;
      return true;
    }
    this._s11PendingWaveActivation = wave;
    this._s11WaveActivationPromise = activateGroup(this, group)
      .then(result => {
        if (result.ok) this._s11PendingWaveActivation = null;
        return result.ok;
      })
      .finally(() => { this._s11WaveActivationPromise = null; });
    return this._s11WaveActivationPromise;
  },

  _updateS11S12Runtime() {
    if (!['S11', 'S12'].includes(this.currentSceneId) || !this.s11s12Coordinator || !this.rescueSystem) return;
    const rescue = this.rescueSystem.getState?.();
    if (rescue?.status !== RescueStatus.ACTIVE) return;
    if (this.currentSceneId === 'S11' && rescue.stageId === 'repel-assassins') {
      void this._retryS11WaveActivation();
    }
    const rescueDefinition = this.s03s14BattleCoordinator
      ?.getRescueDefinition?.(this.currentSceneId === 'S11' ? S11_RESCUE_ID : S12_RESCUE_ID);
    const targetId = rescueDefinition?.targetEntityId;
    const target = (this.entities || []).find(entity => entity?.id === targetId);
    const targetTransform = target?.getComponent?.('transform');
    const playerTransform = this.playerEntity?.getComponent?.('transform');
    const followStage = rescue.stageId === 'breakout-west-gate' || rescue.stageId === 'escort-zhang-bao';
    if (followStage && targetTransform && playerTransform) {
      const distance = Math.hypot(
        playerTransform.position.x - targetTransform.position.x,
        playerTransform.position.y - targetTransform.position.y
      );
      const movement = target.getComponent?.('movement');
      const followDistance = Number(rescueDefinition.followDistance);
      const followMaxDistance = Number(rescueDefinition.followMaxDistance);
      const followOffset = rescueDefinition.followOffset;
      if (movement && distance > followDistance && distance < followMaxDistance) {
        movement.setPath([{
          x: playerTransform.position.x + Number(followOffset.x),
          y: playerTransform.position.y + Number(followOffset.y)
        }]);
      } else if (movement && distance <= followDistance) movement.stop();
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem.getState());
    if (this._s11s12RuntimePromise) return;
    const timestamp = this.rescueSystem.now();
    const update = this.currentSceneId === 'S11'
      ? this.s11s12Coordinator.updateS11({ timestamp, targetAlive: entityAlive(this, targetId) })
      : this.s11s12Coordinator.updateS12({
          timestamp,
          gateIntegrity: this._ensureS12GateEntity()?.getComponent?.('building')?.hp ?? 0,
          targetAlive: entityAlive(this, targetId)
        });
    this._s11s12RuntimePromise = Promise.resolve(update)
      .then(result => {
        this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
        if (result?.ok === false && result.code !== 'coordinatorBusy') {
          this._showScreenTip(formatFailure(result, '救援状态更新失败。'), { title: '救援异常' });
        }
      })
      .finally(() => { this._s11s12RuntimePromise = null; });
  },

  _handleS11S12CoordinatorEvent(event, data = {}) {
    const messages = {
      s11RescueResolved: data.result?.survived ? '张梁成功从西门突围。' : `张梁救援失败：${data.result?.failureReason || '未能突围'}。`,
      s12SecretPassageOpened: '府衙门已守满 60 秒，密道入口开放。',
      s12EscortOpened: '张宝已经进入密道，开始护送撤离。',
      s12RescueResolved: data.result?.survived ? '张宝已经安全撤离。' : `张宝救援失败：${data.result?.failureReason || '未能撤离'}。`,
      s12LowMoraleDefeat: '下曲阳守军士气归零，战役直接判定失败。'
    };
    if (messages[event]) {
      this._showScreenTip(messages[event], {
        title: event.endsWith('Resolved') ? '救援结果已冻结' : '目标更新'
      });
    }
    this.rescueObjectiveView?.setSnapshot?.(this.rescueSystem?.getState?.());
    return true;
  },

  _ensureS12GateEntity() {
    if (this.currentSceneId !== 'S12') return null;
    if (this._s12GateEntity?.active !== false) return this._s12GateEntity;
    const source = (this._worldLoadResult?.sceneObjects || []).find(object => object?.id === S12_GATE_ID);
    if (!source) return null;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    const multiplier = Math.max(1, Number(story.s12DefenseBoost?.gateMaxHpMultiplier) || 1);
    const maxHp = Math.max(1, Math.floor((Number(source.maxHp) || 1000) * multiplier));
    const x = Number(source.x) + (Number(source.width) || 0) / 2;
    const y = Number(source.y) + (Number(source.height) || 0);
    const entity = new Entity(S12_GATE_ID, 'building');
    entity.tags = ['battleParticipant', 'yellow_turban', 'destructibleGate'];
    entity.addComponent(new TransformComponent(x, y));
    entity.addComponent(new BuildingComponent({
      buildingType: BuildingType.GATE,
      maxHp,
      hp: maxHp,
      team: 'yellow_turban',
      footprint: { w: Number(source.width) || 180, h: Math.max(40, Number(source.height) || 110) }
    }));
    this.entityStore?.add?.(entity);
    this._s12GateEntity = entity;
    return entity;
  },

  _removeS12GateEntity() {
    const gate = this._s12GateEntity;
    if (!gate) return false;
    this.entityStore?.remove?.(gate);
    gate.destroy?.();
    this._s12GateEntity = null;
    return true;
  }
};

const s13s14Methods = {
  async executeVehicleCommand({ vehicleId, operation, divergenceKind, ...payload } = {}) {
    const definition = this._getSceneVehicleDefinitions?.(this.currentSceneId)
      ?.find?.(entry => entry?.id === vehicleId);
    if (!definition) return false;
    if (operation === 'interact') return this.interactS11Horse();
    if (operation === 'useEntrance') return this.useS12LadderEntry();
    if (operation === 'destroy') return this.burnS12Ladder(payload);
    if (operation === 'openCargo') return this.openS14CargoTransfer();
    if (operation === 'resolveDivergence') {
      return divergenceKind === 'cart' ? this.resolveS14LastCart() : this.resolveS14Catapult();
    }
    if (operation === 'operateWeapon') return this.operateS14Catapult();
    if (operation === 'leaveSeat') return this.leaveS14Catapult();
    return false;
  },

  async executeEndingCommand({ endingId, operation, endingKey, ...payload } = {}) {
    // commit：绕过 S14 终局门禁，按结局库元数据直接提交单个结局演出
    // （S02 乱世草芥等剧情裁决结局走此通道，M4）。
    // endingId 校验契约=结局库 id（$ref 存根）；endingKey=库内具体结局元数据 id。
    if (operation === 'commit') return this.commitEndingById(endingKey || endingId, payload);
    if (operation !== 'resolve' || endingId !== this._endingConfig?.id) return false;
    return this.resolveEnding(payload);
  },

  /**
   * 按结局库元数据直接提交结局：打开结局演出视图并写入剧情检查点。
   * @param {string} endingId - endings 库中的结局元数据 id
   * @param {{checkpointId?: string, reviewLines?: Array<string>}} [options]
   */
  async commitEndingById(endingId, { checkpointId = null, reviewLines = null } = {}) {
    if (!this.endingPresentationView) return false;
    const metadata = this._endingConfig?.endings?.find(ending => ending?.id === endingId);
    if (!metadata) {
      this._showScreenTip?.(`结局元数据缺失：${endingId}`, { title: '演出不可用' });
      return false;
    }
    this.endingPresentationView.open({
      snapshot: { endingId, endingSnapshotId: `endingSnapshot.direct.${endingId}` },
      ending: metadata,
      reviewLines: Array.isArray(reviewLines) ? reviewLines : []
    });
    if (checkpointId) {
      try {
        await this.requestAutoSave({
          reason: 'checkpoint', checkpointId, sceneId: this.currentSceneId
        });
      } catch (error) {
        console.warn('[S11S14SceneFlow] 结局检查点写入失败', error?.message || error);
      }
    }
    return true;
  },

  _prepareS13Settlement(mode) {
    if (!['observe', 'intervene'].includes(mode)) return { ok: false, code: 'invalidBattleMode' };
    if (this._s13PendingSettlement) {
      return this._s13PendingSettlement.mode === mode
        ? { ok: true, idempotent: true, pending: clone(this._s13PendingSettlement) }
        : { ok: false, code: 's13ChoiceLocked' };
    }
    const choice = this._worldLoadSession?.getSceneData?.('S13')?.gameplay?.choices
      ?.find(entry => entry?.id === mode);
    if (!choice) return { ok: false, code: 's13ChoiceMissing', mode };
    const inventory = this.playerEntity?.getComponent?.('inventory');
    if (!inventory || !this.inventoryTransactions) return { ok: false, code: 'inventoryUnavailable' };
    const entries = Object.entries(choice.resourceCost || {}).map(([key, quantity]) => ({
      itemId: RESOURCE_IDS[key] || key,
      quantity: Math.max(0, Math.floor(Number(quantity) || 0))
    })).filter(entry => entry.quantity > 0);
    for (const entry of entries) {
      const preview = this.inventoryTransactions.previewRemove(inventory, entry.itemId, entry.quantity);
      if (preview.remainder > 0) {
        return { ok: false, code: 'resourceMissing', message: `${entry.itemId} 缺少 ${preview.remainder}` };
      }
    }
    const operationId = `cost:${S13_BATTLE_ID}:${mode}`;
    this._s13PendingSettlement = {
      schemaVersion: 2,
      mode,
      choice: clone(choice),
      entries,
      operationId
    };
    return { ok: true, pending: clone(this._s13PendingSettlement) };
  },

  async _applyS13Settlement({ choice, operationId } = {}) {
    const pending = this._s13PendingSettlement;
    const battleResult = choice?.battleResult;
    if (!pending || pending.mode !== choice?.id) return { ok: false, code: 's13SettlementNotPrepared' };
    if (!battleResult?.resultId || battleResult.battleId !== S13_BATTLE_ID) {
      return { ok: false, code: 's13BattleResultMissing' };
    }
    const inventory = this.playerEntity?.getComponent?.('inventory');
    const battleCoordinator = this.s03s14BattleCoordinator;
    if (!inventory || !this.inventoryTransactions || !battleCoordinator?.captureCityWarState?.()) {
      return { ok: false, code: 's13SettlementRuntimeUnavailable' };
    }
    for (const entry of pending.entries) {
      const preview = this.inventoryTransactions.previewRemove(inventory, entry.itemId, entry.quantity);
      if (preview.remainder > 0) {
        return { ok: false, code: 'resourceMissing', itemId: entry.itemId, missing: preview.remainder };
      }
    }

    const inventoryBefore = clone(inventory.exportItems?.() || []);
    const cityWarBefore = clone(this.cityWarStateBridge.read());
    const cityWarLedgerBefore = battleCoordinator.captureCityWarState();
    const rollback = async () => {
      inventory.loadItems?.(clone(inventoryBefore));
      this.inventoryTransactions.forgetOperation?.(pending.operationId);
      this.cityWarStateBridge.restore(clone(cityWarBefore));
      battleCoordinator.restoreCityWarState(cityWarLedgerBefore);
      return true;
    };
    if (pending.entries.length > 0) {
      const removed = this.inventoryTransactions.commit({
        type: 'batchRemove', inventory, entries: pending.entries, operationId: pending.operationId
      });
      if (!removed.ok) return removed;
    }
    const settled = await battleCoordinator.applyBattleResult({
      result: battleResult,
      operationId: `settle:${battleResult.resultId}`,
      context: { mode: pending.mode, deferCheckpoint: true, outerOperationId: operationId }
    });
    if (!settled?.ok) {
      await rollback();
      return { ok: false, code: settled?.code || 's13CityWarSettlementRejected', message: settled?.message };
    }
    return { ok: true, settled, rollback };
  },

  _rollbackS13PendingSettlement() {
    this._s13PendingSettlement = null;
    return true;
  },

  _buildS13Choice(mode, battleResult) {
    const pending = this._s13PendingSettlement;
    const configured = pending?.choice || this._worldLoadSession?.getSceneData?.('S13')?.gameplay?.choices
      ?.find(entry => entry?.id === mode) || {};
    return {
      id: mode,
      resourceCost: clone(configured.resourceCost || {}),
      battleResult: clone(battleResult),
      result: {
        battleMode: mode,
        battleResultId: battleResult?.resultId || null,
        winnerFactionId: battleResult?.winnerFactionId || null
      }
    };
  },

  async checkS13Exit() {
    if (this.currentSceneId !== 'S13') return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s13Resolved !== true) {
      this._showScreenTip('先完成精山战役并冻结最终资源选择。', { title: '尚不能进入结局之地' });
      return false;
    }
    return travel(this, 'S14', 'S14·结局之地');
  },

  async _applyS14ResourceDivergence({ kind, result, operationId } = {}) {
    this._ensureS14VehicleEntities?.();
    const inventory = this.playerEntity?.getComponent?.('inventory');
    const cart = this._s14VehicleEntities?.get?.('vehicle.s14.lastCart');
    const catapult = this._s14VehicleEntities?.get?.('vehicle.s14.catapult');
    const target = kind === 'cart' ? cart : catapult;
    if (!inventory || !target || !this.vehicleLogisticsSystem) {
      return { ok: false, code: 's14VehicleRuntimeUnavailable' };
    }
    const gameplay = this._worldLoadSession?.getChunk?.('S14')?.sceneData?.gameplay || {};
    const definition = (gameplay.vehicles || []).find(entry => entry?.id === target.id) || {};
    const vehicle = target.getComponent?.('vehicle');
    const cargo = target.getComponent?.('cargo');
    const inventoryBefore = clone(inventory.exportItems?.() || []);
    const vehicleBefore = clone(vehicle?.serialize?.() || null);
    const cargoBefore = clone(cargo?.serialize?.() || null);
    const logisticsBefore = clone(this.vehicleLogisticsSystem.serialize());
    const vehicleWasRegistered = this.vehicleSystem?.vehicles?.has?.(target) === true;
    let createdDrop = null;

    const rollbackDomain = async () => {
      if (createdDrop) {
        this.entityStore?.removeMany?.([createdDrop]);
        try { createdDrop.destroy?.(); } catch (error) { /* best-effort rollback cleanup */ }
        createdDrop = null;
      }
      inventory.loadItems?.(clone(inventoryBefore));
      const vehicleRestored = vehicle?.deserialize?.(clone(vehicleBefore));
      const cargoRestored = cargoBefore && cargo ? cargo.deserialize(clone(cargoBefore)) : { ok: true };
      const logisticsRestored = this.vehicleLogisticsSystem.deserialize(clone(logisticsBefore));
      if (vehicleWasRegistered) this.vehicleSystem?.registerVehicle?.(target);
      else this.vehicleSystem?.unregisterVehicle?.(target);
      for (let index = 0; index < (gameplay.cartLoad || []).length; index += 1) {
        this.inventoryTransactions?.forgetOperation?.(`${operationId}:inventory:${index}`);
      }
      this.inventoryTransactions?.forgetOperation?.(`${operationId}:resources`);
      return vehicleRestored?.ok !== false && cargoRestored?.ok !== false && logisticsRestored?.ok !== false;
    };

    if (!vehicle || (kind === 'cart' && !cargo)) {
      return { ok: false, code: 's14VehicleComponentMissing' };
    }
    if (kind === 'cart' && result?.resultId === 'cart-lost'
      && Object.values(vehicleBefore?.seats || {}).some(seat => seat?.riderId)) {
      return { ok: false, code: 's14CartOccupied' };
    }

    let committed;
    if (kind === 'cart' && result?.resultId === 'cart-breakout') {
      committed = await this.vehicleLogisticsSystem.transferBatch({
        source: inventory,
        target: cargo,
        entries: gameplay.cartLoad || [],
        sourceOwnerId: `${this.playerEntity?.id || 'player'}:inventory`,
        targetOwnerId: `${target.id}:cargo`,
        operationId,
        context: { sceneId: 'S14', resultId: result.resultId },
        deferCheckpoint: true
      });
    } else if (kind === 'cart' && result?.resultId === 'cart-lost') {
      committed = await this.vehicleLogisticsSystem.destroyCargoVehicle({
        vehicle: target,
        operationId,
        context: { sceneId: 'S14', resultId: result.resultId },
        deferCheckpoint: true,
        deferEvent: true
      });
    } else if (kind === 'catapult' && result?.resultId === 'catapult-ready') {
      committed = await this.vehicleLogisticsSystem.assembleCatapult({
        vehicle: target,
        inventory,
        requirements: definition.assemblyRequirements || {},
        inventoryOwnerId: `${this.playerEntity?.id || 'player'}:inventory`,
        operationId,
        context: { sceneId: 'S14', resultId: result.resultId },
        deferCheckpoint: true
      });
    } else {
      committed = { ok: true, operationId, unchanged: true };
    }
    if (!committed?.ok) return committed;

    const isCartDestroyed = kind === 'cart' && result?.resultId === 'cart-lost';
    if (isCartDestroyed) {
      this.vehicleSystem?.unregisterVehicle?.(target);
      const dropId = `death-drop-${operationId}`;
      const existing = (this.entityStore?.all || []).find(entity => entity?.id === dropId)
        || (this.equipmentItems || []).find(entity => entity?.id === dropId);
      if (existing && !existing.getComponent?.('deathDrop')) {
        await rollbackDomain();
        return { ok: false, code: 's14CargoDropIdConflict', dropId };
      }
      if (!existing) {
        const transform = target.getComponent?.('transform');
        const presentation = this.getDeathDropPresentation?.({ source: 'cargoVehicle', vehicle: target }) || {};
        try {
          const drop = this.entityFactory?.createDeathDrop?.({
            ...presentation,
            id: dropId,
            deathId: operationId,
            stacks: clone(committed.drop || []),
            position: {
              x: Number(transform?.position?.x) || 0,
              y: Number(transform?.position?.y) || 0
            }
          });
          if (!drop) throw new Error('deathDropFactoryRejected');
          this.entityStore?.add?.(drop);
          this.entityStore?.addEquipmentItem?.(drop);
          if (!(this.entityStore?.all || []).includes(drop)) throw new Error('deathDropStoreRejected');
          createdDrop = drop;
        } catch (error) {
          await rollbackDomain();
          return { ok: false, code: 's14CargoDropCreationFailed', message: String(error?.message || error) };
        }
      }
    }

    return {
      ok: true,
      result: clone(committed),
      finalize: async () => {
        if (!isCartDestroyed || committed.idempotent) return true;
        this.vehicleLogisticsSystem.emitCargoVehicleDestroyed?.(committed);
        try { this.vehicleSystem?.onVehicleDestroyed?.(target); }
        catch (error) { console.warn('[S11S14SceneFlow] vehicle destruction presentation failed', error); }
        return true;
      },
      rollback: rollbackDomain
    };
  },

  _readS13S14State() {
    const blackboard = this.gameLoader?.blackboard;
    const storyState = clone(blackboard?.get?.('storyState') || {});
    const cityStates = clone(blackboard?.get?.('cityStates') || []);
    const warState = clone(blackboard?.get?.('warState') || { battles: {}, casualties: {} });
    const coreCityState = cityStates.find(city => city?.id === 'city.s09_guangzong_camp') || cityStates[0] || {
      id: 'city.s09_guangzong_camp', damageRatio: 0, resources: {}
    };
    const inventory = this.playerEntity?.getComponent?.('inventory');
    const cumulativeGathering = clone(storyState.endingInputs?.cumulativeGathering || {
      wood: 0, iron: 0, food: 0, herb: 0
    });
    const completedStructures = Object.keys(storyState.s10Construction?.completedSites || {})
      .filter(key => storyState.s10Construction.completedSites[key] === true).length;
    const battleModes = storyState.battleModes || {};
    const eligibleBattleIds = clone(storyState.endingInputs?.eligibleBattleIds || Object.keys(battleModes));
    const modeValues = eligibleBattleIds.map(id => battleModes[id]).filter(mode => ['observe', 'intervene'].includes(mode));
    const s08Cart = storyState.s08RouteResult
      ? { available: storyState.s08RetreatDecision?.choiceId === 'preserve', destroyed: false }
      : null;
    const cartEntity = this._s14VehicleEntities?.get?.('vehicle.s14.lastCart');
    const cartVehicle = cartEntity?.getComponent?.('vehicle');
    const cartCargo = cartEntity?.getComponent?.('cargo');
    const persistedCart = storyState.retreatCart || s08Cart || { available: true, destroyed: false };
    const retreatCart = cartVehicle
      ? {
        available: true,
        destroyed: cartVehicle.destroyed === true,
        cargoLoaded: Math.max(0, Number(cartCargo?.getItemCountTotal?.()) || 0) > 0,
        dropGenerated: cartCargo?.dropGenerated === true
      }
      : clone(persistedCart);
    const cargoFood = inventoryQuantity(cartCargo, RESOURCE_IDS.food);
    const cargoHerb = inventoryQuantity(cartCargo, RESOURCE_IDS.herb);
    const resourceState = {
      wood: inventoryQuantity(inventory, RESOURCE_IDS.wood),
      iron: inventoryQuantity(inventory, RESOURCE_IDS.iron),
      food: inventoryQuantity(inventory, RESOURCE_IDS.food) + cargoFood,
      herb: inventoryQuantity(inventory, RESOURCE_IDS.herb) + cargoHerb,
      cart: retreatCart
    };
    const ready = storyState.retreatReadiness?.ready
      ?? (resourceState.food >= 20 && resourceState.herb >= 8 && retreatCart.available && !retreatCart.destroyed);
    return {
      storyState,
      cityStates,
      coreCityState,
      cityState: coreCityState,
      warState,
      battleModeStats: {
        eligibleBattleIds,
        observeCount: modeValues.filter(mode => mode === 'observe').length,
        interventionCount: modeValues.filter(mode => mode === 'intervene').length,
        allOptionalBattlesObserved: modeValues.length > 0 && modeValues.every(mode => mode === 'observe')
      },
      retreatReadiness: { ready: !!ready },
      hiddenInputs: {
        cumulativeGathering,
        cityMaintenanceLevel: Math.max(0, Number(storyState.endingInputs?.cityMaintenanceLevel) || completedStructures),
        allowedCityDestruction: storyState.endingInputs?.allowedCityDestruction === true,
        resourceConstructionScore: Math.max(0, Math.floor(Number(
          storyState.endingInputs?.resourceConstructionScore ?? completedStructures
        ) || 0))
      },
      retreatCart,
      resourceState
    };
  },

  _readEndingRuntimeState() {
    return this._readS13S14State();
  },

  _writeEndingRuntimeState(state = {}) {
    const blackboard = this.gameLoader?.blackboard;
    if (!blackboard || !state.storyState) return false;
    const story = clone(state.storyState);
    if (story.endingId) story.unlockedEndings = [...new Set([...(story.unlockedEndings || []), story.endingId])];
    blackboard.set('storyState', story);
    return true;
  },

  _projectEndingInput(state = {}) {
    const normalized = this.s13s14Coordinator?.normalizeEndingSnapshot?.() || {};
    const story = state.storyState || normalized.storyState || {};
    const modes = story.battleModes || {};
    const eligibleIds = state.battleModeStats?.eligibleBattleIds || normalized.battleModeStats?.eligibleBattleIds
      || Object.keys(modes);
    const selectedModes = eligibleIds.map(id => modes[id]).filter(mode => ['observe', 'intervene'].includes(mode));
    const observed = selectedModes.filter(mode => mode === 'observe').length;
    const intervened = selectedModes.filter(mode => mode === 'intervene').length;
    const cumulative = state.hiddenInputs?.cumulativeGathering || normalized.hiddenInputs?.cumulativeGathering || {};
    const totalGathered = Object.values(cumulative).reduce((total, value) => total + Math.max(0, Math.floor(Number(value) || 0)), 0);
    const damage = clamp(state.coreCityState?.damageRatio ?? state.cityState?.damageRatio
      ?? normalized.cityState?.coreDamageRatio, 0, 1);
    const constructionScore = Math.max(0, Math.floor(Number(
      state.hiddenInputs?.resourceConstructionScore ?? normalized.hiddenInputs?.resourceConstructionScore
    ) || 0));
    return {
      storyState: clone(story),
      cityState: { coreCityId: state.coreCityState?.id || normalized.cityState?.coreCityId || null, coreDamageRatio: damage },
      warState: clone(state.warState || normalized.warState || {}),
      heroStates: {
        primary: [
          { id: 'hero.zhang_liang', alive: story.zhangLiangSurvived === true },
          { id: 'hero.zhang_bao', alive: story.zhangBaoSurvived === true }
        ],
        support: [
          { id: 'hero.bocai', alive: story.bocaiSurvived === true },
          { id: 'hero.zhang_mancheng', alive: story.zhangManchengSurvived === true }
        ]
      },
      battleModeStats: { optionalBattles: selectedModes.length, observed, intervened },
      retreatReadiness: !!(state.retreatReadiness?.ready ?? normalized.retreatReadiness?.ready),
      hiddenInputs: {
        totalGathered,
        cityMaintenanceLevel: Math.max(0, Number(
          state.hiddenInputs?.cityMaintenanceLevel ?? normalized.hiddenInputs?.cityMaintenanceLevel
        ) || 0),
        resourceConstructionScore: constructionScore,
        allOptionalBattlesObserved: selectedModes.length > 0 && observed === selectedModes.length,
        cityDamageNeglected: state.hiddenInputs?.allowedCityDestruction === true || damage >= 0.6,
        scorchedEarthChosen: story.scorchedEarthChoice === true
      }
    };
  },

  _buildS14CargoTransferSnapshot({ direction = null, statusMessage = '', statusType = 'info' } = {}) {
    const cart = this._s14VehicleEntities?.get?.('vehicle.s14.lastCart');
    const inventory = this.playerEntity?.getComponent?.('inventory');
    const cargo = cart?.getComponent?.('cargo');
    const summarize = component => (component?.exportItems?.() || [])
      .map(stack => ({
        itemId: stack?.item?.id || '',
        name: stack?.item?.name || stack?.item?.id || '未知物品',
        quantity: Math.max(0, Math.floor(Number(stack?.quantity) || 0))
      }))
      .filter(entry => entry.itemId && entry.quantity > 0);
    return {
      vehicleId: cart?.id || null,
      title: cart?.name ? `${cart.name} · 货舱` : '最后的马车 · 货舱',
      direction: direction || this.cargoTransferView?.direction || 'toCargo',
      inventory: {
        items: summarize(inventory),
        usedSlots: inventory?.getUsedSlotCount?.() || 0,
        maxSlots: Math.max(0, Number(inventory?.maxSlots) || 0)
      },
      cargo: {
        items: summarize(cargo),
        total: cargo?.getItemCountTotal?.() || 0,
        capacity: Math.max(0, Number(cargo?.capacity) || 0)
      },
      statusMessage,
      statusType
    };
  },

  openS14CargoTransfer() {
    if (this.currentSceneId !== 'S14' || !this.cargoTransferView) return false;
    this._ensureS14VehicleEntities?.();
    const cart = this._s14VehicleEntities?.get?.('vehicle.s14.lastCart');
    const vehicle = cart?.getComponent?.('vehicle');
    const cargo = cart?.getComponent?.('cargo');
    const inventory = this.playerEntity?.getComponent?.('inventory');
    if (!cart || !vehicle || !cargo || !inventory || vehicle.destroyed || cargo.dropGenerated) {
      this._showScreenTip('马车货舱当前无法使用。', { title: '货舱不可用' });
      return false;
    }
    this._cargoTransferPendingOperation = null;
    this.cargoTransferView.open(this._buildS14CargoTransferSnapshot());
    return true;
  },

  _nextCargoTransferOperationId(vehicleId) {
    const operations = this.vehicleLogisticsSystem?.operations || new Map();
    let candidate;
    do {
      this._cargoTransferSequence = Math.max(0, Number(this._cargoTransferSequence) || 0) + 1;
      candidate = `cargo-transfer:${vehicleId}:${this._cargoTransferSequence}`;
    } while (operations.has(candidate));
    return candidate;
  },

  _formatCargoTransferFailure(result = {}) {
    const messages = {
      invalidTransfer: '转移请求无效，请重新选择物品和数量。',
      transferRejected: '当前物品无法转移。',
      inventoryFull: '目标背包没有可用槽位。',
      cargoCapacityFull: '马车货舱容量不足。',
      insufficientItems: '来源物品数量不足。',
      operationIdConflict: '操作内容已变化，请重新确认。',
      operationConflict: '操作内容已变化，请重新确认。',
      vehicleCheckpointRejected: '保存检查点失败，本次转移已回滚。'
    };
    return messages[result.code] || result.message || result.code || '转移失败，状态未改变。';
  },

  async _handleCargoTransferCommand(command = {}) {
    if (!this.cargoTransferView?.visible) return false;
    if (command.type === 'close') {
      if (this._cargoTransferBusy) return true;
      this.cargoTransferView.close();
      this._cargoTransferPendingOperation = null;
      return true;
    }
    if (command.type !== 'transfer' || this._cargoTransferBusy || this.currentSceneId !== 'S14') return true;

    const cart = this._s14VehicleEntities?.get?.('vehicle.s14.lastCart');
    const inventory = this.playerEntity?.getComponent?.('inventory');
    const cargo = cart?.getComponent?.('cargo');
    const vehicle = cart?.getComponent?.('vehicle');
    const quantity = Math.max(1, Math.floor(Number(command.quantity) || 1));
    const direction = command.direction === 'toInventory' ? 'toInventory' : 'toCargo';
    if (!cart || !inventory || !cargo || !vehicle || vehicle.destroyed || cargo.dropGenerated) {
      this.cargoTransferView.setSnapshot(this._buildS14CargoTransferSnapshot({
        direction, statusMessage: '马车货舱当前无法使用。', statusType: 'error'
      }));
      return true;
    }

    const sourceId = direction === 'toCargo'
      ? `${this.playerEntity?.id || 'player'}:inventory`
      : `${cart.id}:cargo`;
    const targetId = direction === 'toCargo'
      ? `${cart.id}:cargo`
      : `${this.playerEntity?.id || 'player'}:inventory`;
    const payloadKey = JSON.stringify([cart.id, direction, command.itemId, quantity]);
    if (this._cargoTransferPendingOperation?.payloadKey !== payloadKey) {
      this._cargoTransferPendingOperation = {
        payloadKey,
        operationId: this._nextCargoTransferOperationId(cart.id)
      };
    }

    this._cargoTransferBusy = true;
    this.cargoTransferView.setBusy(true);
    let result;
    try {
      result = await this.submitItemIntent('item.transfer', {
        sourceId,
        targetId,
        itemId: command.itemId,
        quantity,
        checkpointId: 'checkpoint.s14.cargo-transfer',
        context: { sceneId: 'S14', vehicleId: cart.id, direction }
      }, { operationId: this._cargoTransferPendingOperation.operationId });
    } catch (error) {
      result = { ok: false, code: 'cargoTransferFailed', message: String(error?.message || error) };
    } finally {
      this._cargoTransferBusy = false;
      this.cargoTransferView.setBusy(false);
    }

    if (result?.ok) {
      this._cargoTransferPendingOperation = null;
      this.cargoTransferView.setSnapshot(this._buildS14CargoTransferSnapshot({
        direction,
        statusMessage: `已转移 ${result.value?.accepted || 0} 件物品。`,
        statusType: 'success'
      }));
      return true;
    }
    if (result?.code === 'operationIdConflict' || result?.code === 'operationConflict') {
      this._cargoTransferPendingOperation = null;
    }
    this.cargoTransferView.setSnapshot(this._buildS14CargoTransferSnapshot({
      direction,
      statusMessage: this._formatCargoTransferFailure(result),
      statusType: 'error'
    }));
    return true;
  },

  async resolveS14LastCart() {
    if (this.currentSceneId !== 'S14') return false;
    this._ensureS14VehicleEntities?.();
    const result = await this.s13s14Coordinator?.commitResourceDivergence?.('cart', this._endingConfig);
    if (!result?.ok) {
      this._showScreenTip(`马车结果无法冻结：${result?.missingPaths?.join('、') || result?.code || 'unknown'}`, { title: '资源状态不完整' });
      return false;
    }
    this._showScreenTip(result.result.subtitle, { title: result.result.resultId === 'cart-breakout' ? '最后的马车可以突围' : '马车无法突围' });
    return true;
  },

  async resolveS14Catapult() {
    if (this.currentSceneId !== 'S14') return false;
    this._ensureS14VehicleEntities?.();
    const result = await this.s13s14Coordinator?.commitResourceDivergence?.('catapult', this._endingConfig);
    if (!result?.ok) {
      this._showScreenTip(`投石车结果无法冻结：${result?.missingPaths?.join('、') || result?.code || 'unknown'}`, { title: '资源状态不完整' });
      return false;
    }
    this._showScreenTip(result.result.subtitle, { title: result.result.resultId === 'catapult-ready' ? '投石车组装完成' : '投石车无法组装' });
    return true;
  },

  _getS14CatapultDefinition() {
    return this._getS14VehicleDefinitions?.()
      ?.find?.(entry => entry?.id === 'vehicle.s14.catapult') || null;
  },

  _isS14CatapultGunner() {
    const rider = this.playerEntity?.getComponent?.('rider');
    return this.currentSceneId === 'S14'
      && rider?.vehicleId === 'vehicle.s14.catapult'
      && rider?.role === 'gunner';
  },

  handleBasicAttackIntent(intent = {}) {
    if (!this._isS14CatapultGunner()) return false;
    void this.fireS14Catapult(intent);
    return true;
  },

  handlePointerBasicAttack() {
    if (!this._isS14CatapultGunner()) return false;
    if (this.inputManager?.isMouseButtonDown?.(0)
      && !this.inputManager?.isMouseClickHandled?.()) {
      const position = this.playerEntity?.getComponent?.('transform')?.position;
      const mouse = this.inputManager?.mouse;
      const dx = Number(mouse?.worldX) - Number(position?.x);
      const dy = Number(mouse?.worldY) - Number(position?.y);
      const magnitude = Math.hypot(dx, dy);
      const direction = magnitude > 0
        ? { x: dx / magnitude, y: dy / magnitude }
        : this.getPlayerFacingVector();
      this.handleBasicAttackIntent({ type: 'attack', direction, source: 'pointer' });
    }
    return true;
  },

  async operateS14Catapult() {
    if (this.currentSceneId !== 'S14') return false;
    this._ensureS14VehicleEntities?.();
    const catapult = this._s14VehicleEntities?.get?.('vehicle.s14.catapult');
    const component = catapult?.getComponent?.('vehicle');
    if (!catapult || !component || component.destroyed) {
      this._showScreenTip('投石车当前不可操作。', { title: '载具不可用' });
      return false;
    }
    if (!component.logistics.catapultAssembled) {
      const assembled = await this.resolveS14Catapult();
      if (!assembled || !component.logistics.catapultAssembled) return false;
    }
    if (this._isS14CatapultGunner()) {
      this._showScreenTip('你已在武器席。使用 {attack} 向官军封锁目标开火，或在离席点按 {interact} 下车。', { title: '投石车武器席' });
      return true;
    }
    if (this.playerEntity?.getComponent?.('rider')) {
      this._showScreenTip('你已占用其他载具席位，请先离席。', { title: '无法登车' });
      return false;
    }
    if (!this.vehicleSystem?.mount?.(this.playerEntity, catapult, 'gunner')) {
      this._showScreenTip('投石车武器席已被占用。', { title: '无法登车' });
      return false;
    }
    this._showScreenTip('已进入投石车武器席。使用 {attack} 开火；每发消耗 2 石料与 1 人力。', { title: '准备开火' });
    return true;
  },

  leaveS14Catapult() {
    if (!this._isS14CatapultGunner()) {
      this._showScreenTip('你当前不在投石车武器席。', { title: '无需离席' });
      return false;
    }
    const left = this.vehicleSystem?.dismount?.(this.playerEntity) === true;
    if (left) this._showScreenTip('已离开投石车武器席。', { title: '安全离席' });
    return left;
  },

  _findS14CatapultTarget(intent = {}, weapon = {}) {
    const catapult = this._s14VehicleEntities?.get?.('vehicle.s14.catapult');
    const origin = catapult?.getComponent?.('transform')?.position;
    if (!origin) return null;
    const direction = intent.direction || this.getPlayerFacingVector?.() || { x: 1, y: 0 };
    const magnitude = Math.hypot(direction.x || 0, direction.y || 0) || 1;
    const range = Math.max(1, Number(weapon.range) || 1);
    return (this.entities || [])
      .filter(entity => entity?.tags?.includes?.('catapultTarget') && !this._isEntityDead(entity))
      .map(entity => {
        const position = entity.getComponent?.('transform')?.position;
        if (!position) return null;
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        const distance = Math.hypot(dx, dy);
        const dot = distance > 0
          ? (dx * direction.x + dy * direction.y) / (distance * magnitude)
          : 1;
        return { entity, distance, dot };
      })
      .filter(candidate => candidate && candidate.distance <= range && candidate.dot >= 0.15)
      .sort((left, right) => right.dot - left.dot || left.distance - right.distance)[0]?.entity || null;
  },

  async fireS14Catapult(intent = {}) {
    if (!this._isS14CatapultGunner() || this._s14CatapultFireBusy) return false;
    const definition = this._getS14CatapultDefinition();
    const weapon = definition?.weapon || {};
    const catapult = this._s14VehicleEntities?.get?.('vehicle.s14.catapult');
    const inventory = this.playerEntity?.getComponent?.('inventory');
    const target = this._findS14CatapultTarget(intent, weapon);
    if (!target) {
      this._showScreenTip('射程和瞄准方向内没有可轰击的官军封锁目标。', { title: '无有效目标' });
      return false;
    }
    if (!this.vehicleWeaponSystem) {
      this.vehicleWeaponSystem = new VehicleWeaponSystem({
        vehicleSystem: this.vehicleSystem,
        vehicleLogisticsSystem: this.vehicleLogisticsSystem,
        now: () => this.$scene?.simulationClock?.now?.() ?? performance.now()
      });
    }
    const component = catapult?.getComponent?.('vehicle');
    const operationId = `catapult-fire:${catapult.id}:${(component?.logistics?.catapultShots || 0) + 1}`;
    this._s14CatapultFireBusy = true;
    let result;
    try {
      result = await this.vehicleWeaponSystem.handleIntent({
        rider: this.playerEntity,
        intent: { ...intent, type: 'attack', targetEntity: target },
        inventory,
        weapon,
        costs: definition.fireCosts || {},
        operationId,
        checkpointId: 'checkpoint.S14.catapult-fire',
        inventoryOwnerId: `${this.playerEntity?.id || 'player'}:inventory`,
        context: { sceneId: 'S14', vehicleId: catapult.id, targetId: target.id },
        execute: ({ vehicle, target: hitTarget, weapon: weaponConfig }) => {
          const damage = this.combatSystem?.applyDamage?.(
            hitTarget,
            Math.max(1, Number(weaponConfig.damage) || 1),
            null,
            '投石车',
            {
              sourceEntity: vehicle,
              attackKind: 'vehicle-catapult',
              deferPresentationEffects: true
            }
          );
          if (!damage || damage.appliedDamage <= 0) return { ok: false, code: 'vehicleWeaponDamageRejected' };
          const origin = clone(vehicle.getComponent?.('transform')?.position || { x: 0, y: 0 });
          const targetPosition = clone(hitTarget.getComponent?.('transform')?.position || origin);
          return {
            ok: true,
            result: { targetId: hitTarget.id, damage: damage.appliedDamage, killed: damage.isDead },
            rollback: () => damage.rollback?.() === true,
            finalize: () => {
              const presented = this.skillEffects?.createCatapultProjectile?.(origin, targetPosition, {
                speed: weaponConfig.projectileSpeed,
                arcHeight: weaponConfig.arcHeight,
                onHit: () => damage.finalize?.()
              });
              if (!presented) damage.finalize?.();
              return true;
            }
          };
        }
      });
    } catch (error) {
      result = { ok: false, code: 'catapultFireFailed', message: String(error?.message || error) };
    } finally {
      this._s14CatapultFireBusy = false;
    }
    if (!result?.ok) {
      const messages = {
        insufficientItems: '石料或人力不足，本次开火未扣除任何资源。',
        vehicleResourcesMissing: '石料或人力不足，本次开火未扣除任何资源。',
        vehicleWeaponCooldown: '投石车正在重新装填。',
        vehicleCheckpointRejected: '检查点保存失败，弹药、伤害和开火次数均已回滚。',
        operationIdConflict: '本次开火目标与幂等记录冲突，状态未改变。'
      };
      this._showScreenTip(messages[result.code] || result.message || result.code || '投石车开火失败。', { title: '无法开火' });
      return false;
    }
    this._showScreenTip(`投石车已开火，命中造成 ${result.execution?.damage || 0} 点伤害。`, { title: '石弹离弦' });
    return true;
  },

  openS14FinalDoctrine() {
    if (this.currentSceneId !== 'S14' || !this.irreversibleChoiceView) return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s14FinalDoctrine?.committed === true) {
      const label = story.s14FinalDoctrine.choiceId === 'scorched' ? '焦土断后' : '保全残部';
      this._showScreenTip(`终局方略已锁定为“${label}”。`, { title: '方略已冻结' });
      return true;
    }
    this.irreversibleChoiceView.open({
      title: '结局之地·最后方略',
      description: '这项选择会进入结局快照。焦土断后只在城市已重损且营建投入足够时触发隐藏结局。',
      allowCancel: true,
      selectedId: 'preserve',
      choices: [
        { id: 'preserve', label: '保全残部', consequences: ['不再扩大城市损毁', '带现有资源与幸存者撤离'] },
        { id: 'scorched', label: '焦土断后', consequences: ['焚毁无法带走的粮仓', '记录焦土选择', '不可撤回'] }
      ]
    });
    return true;
  },

  async _handleS14FinalDoctrineCommand(command = {}) {
    if (command.type === 'cancel') {
      this.irreversibleChoiceView?.close?.();
      return true;
    }
    if (command.type !== 'selectChoice' || !['preserve', 'scorched'].includes(command.choiceId)) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = clone(blackboard?.get?.('storyState') || {});
    if (!blackboard) return false;
    if (beforeStory.s14FinalDoctrine?.committed === true) return this.openS14FinalDoctrine();
    const choiceId = command.choiceId;
    const endingInputs = clone(beforeStory.endingInputs || {});
    if (choiceId === 'scorched') endingInputs.allowedCityDestruction = true;
    const draft = {
      ...beforeStory,
      endingInputs,
      scorchedEarthChoice: choiceId === 'scorched',
      s14FinalDoctrine: {
        committed: true,
        choiceId,
        operationId: `story:S14:finalDoctrine:${choiceId}`
      },
      lastCheckpointId: 'checkpoint.S14.finalDoctrine'
    };
    this.irreversibleChoiceView?.setBusy?.(true);
    blackboard.set('storyState', draft);
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: draft.lastCheckpointId, sceneId: 'S14'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointRejected');
      this.irreversibleChoiceView?.close?.();
      this._showScreenTip(
        choiceId === 'scorched' ? '无法带走的粮仓已经点燃，焦土方略进入结局快照。' : '你下令停止焚毁，优先保全残部。',
        { title: choiceId === 'scorched' ? '焦土断后' : '保全残部' }
      );
      return true;
    } catch (error) {
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`终局方略保存失败：${error?.message || error}，选择已回滚。`, { title: '提交失败' });
      return false;
    } finally {
      this.irreversibleChoiceView?.setBusy?.(false);
    }
  },

  async resolveEnding(options = {}) {
    if (this.currentSceneId !== 'S14' || !this.endingSystem || !this.endingPresentationView) return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    if (story.s14FinalDoctrine?.committed !== true) {
      this.openS14FinalDoctrine();
      return false;
    }
    if (story.s14ResourceDivergence?.completed !== true) {
      this._showScreenTip('先分别检查最后的马车和投石车，冻结两项资源分歧。', { title: '终局状态尚未完整' });
      return false;
    }
    this.endingPresentationView.setBusy?.(true);
    const result = await this.endingSystem.resolveEnding({
      checkpointId: options.checkpointId || 'checkpoint.S14.preEnding'
    });
    this.endingPresentationView.setBusy?.(false);
    if (!result?.ok) {
      this._showScreenTip(`结局冻结失败：${result?.path ? `${result.path} ` : ''}${result?.code || 'unknown'}`, { title: '结局输入不完整' });
      return false;
    }
    const metadata = this._endingConfig?.endings?.find(ending => ending.id === result.endingId);
    if (!metadata) {
      this._showScreenTip(`结局元数据缺失：${result.endingId}`, { title: '演出不可用' });
      return false;
    }
    const input = result.snapshot?.input || {};
    const reviewLines = [
      `职业：${input.storyState?.classId || '未记录'}`,
      `豫州路线：${input.storyState?.yuzhouRoute?.routeId || input.storyState?.routeId || '未记录'}`,
      `张梁：${input.heroStates?.primary?.[0]?.alive ? '存活' : '死亡'}；张宝：${input.heroStates?.primary?.[1]?.alive ? '存活' : '死亡'}`,
      `波才：${input.heroStates?.support?.[0]?.alive ? '存活' : '死亡'}；张曼成：${input.heroStates?.support?.[1]?.alive ? '存活' : '死亡'}`,
      `观战 ${input.battleModeStats?.observed || 0} 场，介入 ${input.battleModeStats?.intervened || 0} 场`,
      `城市最终损毁：${Math.round((input.cityState?.coreDamageRatio || 0) * 100)}%`,
      `累计采集：${input.hiddenInputs?.totalGathered || 0}`
    ];
    this.endingPresentationView.open({ snapshot: result.snapshot, ending: metadata, reviewLines });
    return true;
  },

  async _handleEndingPresentationCommand(command = {}) {
    if (!this.endingPresentationView?.visible) return false;
    if (command.type === 'close') {
      this.endingPresentationView.close();
      return true;
    }
    if (command.type === 'returnTitle') {
      const manager = this.sceneManager || globalThis.window?.gameEngine?.sceneManager;
      if (!manager?.scenes?.has?.('Login')) {
        this._showScreenTip('标题场景尚未注册，当前结局演出保持打开。', { title: '无法返回标题' });
        return false;
      }
      this.endingPresentationView.close();
      manager.switchTo('Login');
      return true;
    }
    if (command.type === 'loadPreEndingSave') {
      this.endingPresentationView.setBusy?.(true);
      const loaded = await this.requestCheckpointLoad?.('checkpoint.S14.preEnding');
      this.endingPresentationView.setBusy?.(false);
      if (!loaded?.ok) {
        const message = loaded?.code === 'checkpointNotFound'
          ? '三个自动存档中已找不到结局前检查点。'
          : (loaded?.message || loaded?.errors?.[0]?.message || '宿主无法读取结局前检查点。');
        this._showScreenTip(message, { title: '读取失败' });
        return false;
      }
      this.endingPresentationView.close();
      this._showScreenTip('已恢复到结局演出开始前。', { title: '读取成功' });
      return true;
    }
    if (command.type === 'viewUnlockedEndings') {
      const unlocked = this.gameLoader?.blackboard?.get?.('storyState')?.unlockedEndings || [];
      this._showScreenTip(unlocked.length ? `已解锁：${unlocked.join('、')}` : '尚无已解锁结局。', { title: '结局图鉴' });
      return true;
    }
    return false;
  },

  _createEndingInputContext({ inputManager, gamepad } = {}) {
    const key = name => inputManager?.isKeyPressed?.(name) === true;
    const button = index => gamepad?.isButtonPressed?.(index) === true;
    return {
      inputManager,
      gamepad,
      viewWidth: this.logicalWidth,
      viewHeight: this.logicalHeight,
      isActionPressed: action => {
        const actions = {
          confirm: () => key('e') || key('enter') || button(PadButton.A) || button(PadButton.X),
          dialogueContinue: () => key('e') || key('enter') || button(PadButton.A) || button(PadButton.X),
          modalCancel: () => key('escape') || button(PadButton.B) || button(PadButton.RS),
          skip: () => key('space') || key('tab') || button(PadButton.Y),
          left: () => key('left') || button(PadButton.DPAD_LEFT),
          previous: () => key('left') || button(PadButton.DPAD_LEFT),
          right: () => key('right') || button(PadButton.DPAD_RIGHT),
          next: () => key('right') || button(PadButton.DPAD_RIGHT)
        };
        return actions[action]?.() === true;
      }
    };
  },

  _captureS11S14SceneState() {
    return {
      s11s12CoordinatorState: this.s11s12Coordinator?.serialize?.() || null,
      s12GateState: this._s12GateEntity?.getComponent?.('building')?.serialize?.() || null,
      endingSystemState: this.endingSystem?.serialize?.() || null,
      vehicleLogisticsState: this.vehicleLogisticsSystem?.serialize?.() || null,
      vehicleStates: this._captureSceneVehicleStates?.(this.currentSceneId) || [],
      s13PendingSettlement: clone(this._s13PendingSettlement)
    };
  },

  _validateS11S14SceneState(data = {}) {
    const requiresVehicleState = ['S11', 'S12', 'S13', 'S14'].includes(this.currentSceneId);
    if (requiresVehicleState && (Object.prototype.hasOwnProperty.call(data, 's14VehicleStates') || !Array.isArray(data.vehicleStates))) {
      return { ok: false, errors: [{ code: 'legacyVehicleSnapshotRejected', path: 'vehicleStates' }] };
    }
    if (data.s11s12CoordinatorState) {
      const checked = this.s11s12Coordinator?.validateSerialized?.(data.s11s12CoordinatorState);
      if (!checked?.ok) return { ok: false, errors: [{ code: checked?.code || 'invalidSnapshot', path: 's11s12CoordinatorState' }] };
    }
    if (data.endingSystemState) {
      const probe = new EndingSystem();
      const checked = probe.deserialize(data.endingSystemState);
      if (!checked.ok) return { ok: false, errors: [{ code: checked.code, path: `endingSystemState.${checked.path || ''}`.replace(/\.$/, '') }] };
    }
    if (data.s12GateState) {
      const gate = data.s12GateState;
      if (!Number.isFinite(Number(gate.hp)) || !Number.isFinite(Number(gate.maxHp))
        || Number(gate.hp) < 0 || Number(gate.maxHp) <= 0 || Number(gate.hp) > Number(gate.maxHp)) {
        return { ok: false, errors: [{ code: 'invalidGateState', path: 's12GateState' }] };
      }
    }
    const vehicleCheck = requiresVehicleState
      ? this._validateSceneVehicleStates?.(this.currentSceneId, data.vehicleStates, data.vehicleLogisticsState || null)
      : { ok: true };
    if (vehicleCheck?.ok === false) {
      return { ok: false, errors: [{ code: vehicleCheck.code, path: 'vehicleStates' }] };
    }
    if (data.s13PendingSettlement && (data.s13PendingSettlement.schemaVersion !== 2
      || !['observe', 'intervene'].includes(data.s13PendingSettlement.mode)
      || !Array.isArray(data.s13PendingSettlement.entries)
      || typeof data.s13PendingSettlement.operationId !== 'string')) {
      return { ok: false, errors: [{ code: 'invalidS13PendingSettlement', path: 's13PendingSettlement' }] };
    }
    return { ok: true, errors: [] };
  },

  _restoreS11S14SceneState(data = {}) {
    const checked = this._validateS11S14SceneState(data);
    if (!checked.ok) return checked;
    if (data.s11s12CoordinatorState) {
      const restored = this.s11s12Coordinator.deserialize(data.s11s12CoordinatorState);
      if (!restored.ok) return { ok: false, errors: [{ code: restored.code, path: 's11s12CoordinatorState' }] };
    }
    if (data.endingSystemState) {
      const restored = this.endingSystem.deserialize(data.endingSystemState);
      if (!restored.ok) return { ok: false, errors: [{ code: restored.code, path: 'endingSystemState' }] };
    }
    this._s13PendingSettlement = clone(data.s13PendingSettlement);
    const vehicleRestore = this._restoreSceneVehicleStates?.(
      this.currentSceneId, data.vehicleStates, data.vehicleLogisticsState || null
    );
    if (vehicleRestore?.ok === false) {
      return { ok: false, errors: [{ code: vehicleRestore.code, path: 'vehicleStates' }] };
    }
    if (data.s12GateState && this.currentSceneId === 'S12') {
      const gate = this._ensureS12GateEntity();
      if (!gate) return { ok: false, errors: [{ code: 'gateEntityUnavailable', path: 's12GateState' }] };
      gate.getComponent('building').deserialize(data.s12GateState);
    }
    return { ok: true, errors: [] };
  }
};

const duplicateMethodNames = Object.keys(s11s12Methods)
  .filter(methodName => Object.prototype.hasOwnProperty.call(s13s14Methods, methodName));
if (duplicateMethodNames.length > 0) {
  throw new Error(`S11S14SceneCoordinator duplicate methods: ${duplicateMethodNames.join(', ')}`);
}
const s11s14Methods = Object.freeze({ ...s11s12Methods, ...s13s14Methods });

/**
 * S11–S14 历史场景编排器。通过 SceneFlowCoordinator 投影 Scene 状态，
 * 不修改 Scene prototype；Scene 只显式装配并调用本 coordinator。
 */
export class S11S14SceneCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, s11s14Methods, { name: 'S11S14SceneCoordinator' });
  }

  prepareS13Settlement(mode) { return this._prepareS13Settlement(mode); }
  rollbackS13Settlement() { return this._rollbackS13PendingSettlement(); }
  buildS13Choice(mode, result) { return this._buildS13Choice(mode, result); }
  applyS13Settlement(context) { return this._applyS13Settlement(context); }
  createS12LowMoraleResult(context) { return this._createS12LowMoraleResult(context); }
  handleS11S12Event(event, data) { return this._handleS11S12CoordinatorEvent(event, data); }
}

export default S11S14SceneCoordinator;
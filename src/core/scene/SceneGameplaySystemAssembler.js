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

/**
 * SceneGameplaySystemAssembler - 通用游戏场景系统装配器。
 *
 * 只负责创建、接线和释放框架系统；场景内容通过宿主回调注入。
 * Context 是帧/渲染管线的正式读取边界；scene 同名字段只保留迁移期兼容投影。
 */
import { CombatSystem } from '../../systems/CombatSystem.js';
import { MovementSystem } from '../../systems/MovementSystem.js';
import { PathfindingSystem } from '../../systems/PathfindingSystem.js';
import { EquipmentSystem } from '../../systems/EquipmentSystem.js';
import { AmmoService } from '../../systems/AmmoService.js';
import { AISystem } from '../../systems/AISystem.js';
import { CollisionSystem } from '../../systems/CollisionSystem.js';
import { PickupSystem } from '../../systems/PickupSystem.js';
import { InventoryTransactionService } from '../../systems/InventoryTransactionService.js';
import { SceneArmyCommandFlow } from './SceneArmyCommandFlow.js';
import { GatheringSystem } from '../../systems/GatheringSystem.js';
import { GatheringPuppetSystem } from '../../systems/GatheringPuppetSystem.js';
import { AbilitySystem } from '../../systems/ability/AbilitySystem.js';
import { PlayerDefeatService } from '../../systems/PlayerDefeatService.js';
import { PlayerDeathCountdown } from './PlayerDeathCountdown.js';
import { PlayerSoulRespawn } from './PlayerSoulRespawn.js';
import { FramePhase } from './GameSceneRuntime.js';
import { SceneCorpseRuntime } from './SceneCorpseRuntime.js';
import { ItemLifecycleService, ITEM_LIFECYCLE_COMMANDS } from '../../systems/ItemLifecycleService.js';
import { ToolRepairService } from '../../systems/ToolRepairService.js';
import { EquipmentRepairService } from '../../systems/EquipmentRepairService.js';
import { MeditationSystem } from '../../systems/MeditationSystem.js';
import { MeleeAttackSystem } from '../../systems/MeleeAttackSystem.js';
import { ZoneEffectSystem } from '../../systems/ZoneEffectSystem.js';
import { FlightSystem } from '../../systems/FlightSystem.js';
import { JumpSystem } from '../../systems/JumpSystem.js';
import { DodgeSystem } from '../../systems/DodgeSystem.js';
import { AirAimController } from './AirAimController.js';
import { LocomotionSystem } from '../../systems/LocomotionSystem.js';
import { ClassSystem } from '../../systems/ClassSystem.js';
import { ConstructionSystem } from '../../systems/ConstructionSystem.js';
import { ProductionSystem } from '../../systems/ProductionSystem.js';
import { SupplySystem } from '../../systems/SupplySystem.js';
import { ConvoySystem } from '../../systems/ConvoySystem.js';
import { CompanionSquadSystem } from '../../systems/CompanionSquadSystem.js';
import { SceneCompanionSquadFlow } from './SceneCompanionSquadFlow.js';
import { ArmyOrderSystem } from '../../systems/ArmyOrderSystem.js';
import { SceneArmyOrderFlow } from './SceneArmyOrderFlow.js';
import { WorldRouteLayer } from '../world/WorldRouteLayer.js';
import { WorldMarchExecutor } from '../world/WorldMarchExecutor.js';
import { EncounterResolver } from '../../systems/world/EncounterResolver.js';
import { PassTariffSystem } from '../../systems/world/PassTariffSystem.js';
import { DownedDropService } from '../../systems/DownedDropService.js';
import { LootPickupBehavior } from '../../systems/ai/LootPickupBehavior.js';
import { FoodLedgerSystem } from '../../systems/FoodLedgerSystem.js';
import { CityAdministrationService } from '../../systems/CityAdministrationService.js';
import { BattleSettlementService } from '../../systems/BattleSettlementService.js';
import { BattleEntryService } from '../../systems/BattleEntryService.js';
import { ReputationSystem } from '../../systems/ReputationSystem.js';
import {
  createArmyLogisticsAdapter,
  createAutoResupplyAdapter,
  createCityWarAdapters
} from './WarLogisticsAdapters.js';
import {
  createWarLogisticsSnapshot,
  applyWarLogisticsSnapshot,
  readWarLogistics,
  writeWarLogistics
} from './WarLogisticsSnapshot.js';
import { CampStockContainerAdapter } from './CampStockContainerAdapter.js';
import { isHostileTarget } from '../FactionRules.js';
import { SquadMemberComponent } from '../../ecs/components/SquadMemberComponent.js';
import { CommandStateComponent } from '../../ecs/components/CommandStateComponent.js';
import { VehicleSystem } from '../../systems/VehicleSystem.js';
import { VehicleLogisticsSystem } from '../../systems/VehicleLogisticsSystem.js';
import { MannedStructureAdapter } from '../../systems/MannedStructureAdapter.js';
import { ProficiencySystem } from '../../systems/progression/ProficiencySystem.js';
import { CombatEffects } from '../../rendering/CombatEffects.js';
import { SkillEffects } from '../../rendering/SkillEffects.js';
import { WeaponRenderer } from '../../rendering/WeaponRenderer.js';
import { EnemyWeaponRenderer } from '../../rendering/EnemyWeaponRenderer.js';
import { GatheringProgressPresenter } from '../../ui/GatheringProgressPresenter.js';
import { WorldActionPresentation } from './WorldActionPresentation.js';

/**
 * 生产系统场景快照 provider（`gameplay.production`）。
 *
 * - `required:false`：旧档没有这一段时 SnapshotManager 直接放行，不拒档。
 * - 读档语义：`deserialize` 只重建 pending/operations（工单进度、预扣材料凭证、工位占用），
 *   **不重放扣料事务**；成品入库仍由场景在 `productionReady` 后经 `craft.production.*`
 *   提交，`commitOutput` 会删掉 pending，因此同一工单不会被重复结算。
 * - 段存在但内容不可用时告警并跳过，避免一条脏数据把整档拒掉。
 */
export function createProductionSnapshotProvider(productionSystem, { resolveInventory = null } = {}) {
  if (!productionSystem?.serialize || !productionSystem?.deserialize) return null;
  return {
    required: false,
    snapshot: () => productionSystem.serialize(),
    validate: data => {
      if (data == null || typeof data !== 'object') return { ok: true };
      const check = productionSystem.validateSerialized(data, { resolveInventory });
      // 段不可用按「降级跳过」处理：宁可丢掉一条工单，也不让整档读不进来。
      return check?.ok === true ? check : { ok: true, degraded: true };
    },
    restore: data => {
      if (data == null) return { ok: true, skipped: true };
      const result = productionSystem.deserialize(data, { resolveInventory });
      if (result?.ok === true) return result;
      console.warn('[SceneGameplaySystemAssembler] 生产快照恢复失败，已跳过该段', result?.errors);
      return { ok: true, skipped: true, errors: result?.errors || [] };
    }
  };
}

export class SceneGameplaySystemAssembler {
  constructor(scene, config = {}) {
    this.scene = scene;
    // 灵魂状态的表现层钩子（body class 切换等）由表现层注入，装配器自身不触 DOM。
    this.onSoulStateVisual = typeof config.onSoulStateVisual === 'function' ? config.onSoulStateVisual : null;
    this._lootSequence = 0;
    this._downedTick = 0;
    this._downedDropDay = null;
    // scene 维度命令登记表：重复装配时先撤旧句柄再注册，避免命令指向重建前的旧系统。
    this._sceneCommandOffs = new Map();
  }

  initialize({ zoneCallbacks = {} } = {}) {
    const scene = this.scene;
    const now = () => scene.simulationClock?.now?.() ?? performance.now();

    scene.combatEffects = new CombatEffects(scene.particleSystem);
    scene.skillEffects = new SkillEffects(scene.particleSystem);
    scene.weaponRenderer = new WeaponRenderer({ now });
    scene.enemyWeaponRenderer = new EnemyWeaponRenderer();
    scene.flightSystem = new FlightSystem({
      particleSystem: scene.particleSystem,
      floatingTextManager: scene.floatingTextManager,
      camera: scene.camera,
      now
    });
    scene.jumpSystem = new JumpSystem({ particleSystem: scene.particleSystem });
    // 闪避：向输入方向快速滑出 3 个身位（身位由碰撞体推导；冷却与格挡一致，头顶「闪避」飘字）
    scene.dodgeSystem = new DodgeSystem({
      particleSystem: scene.particleSystem,
      floatingTextManager: scene.floatingTextManager,
      now
    });
    scene.locomotionSystem = new LocomotionSystem({
      jumpSystem: scene.jumpSystem,
      flightSystem: scene.flightSystem,
      dodgeSystem: scene.dodgeSystem,
      resolveClimbTarget: request => scene.resolveClimbTarget?.(request) || null,
      // 攀爬开始 → 教程信号（攀藤等教程的完成依据，与 jumpPerformed 同模式）
      onClimbStarted: (entity, info) => {
        const tutorialFlow = scene.context?.services?.tutorialFlow;
        if (tutorialFlow) tutorialFlow.notify('climbPerformed', info || {});
        else scene.onPlayerTutorialAction?.('climb');
      }
    });
    // 按下即跳（v2：大跳/二段跳/空中改落点，悬停子弹时间已废弃）。
    // 参数可由 scene.airAimConfig 覆盖（设计见 .trae/rules/air-aim-jump-design.md）。
    scene.jumpSystem.setLandCallback?.((entity, info) => {
      scene.gameLoader?.triggerSystem?.fire?.('jump.landed', { entity, ...info });
      if (info?.relocate === true) {
        scene.gameLoader?.triggerSystem?.fire?.('jump.relocate.landed', {
          entity, from: info.from, to: info.to
        });
      }
    });
    scene.airAimController = new AirAimController({ now, ...(scene.airAimConfig || {}) });
    scene.airAimController.setPressJumpCallback(({ actor, moveDirection, distance, duration }) => {
      const started = scene.jumpByDirection?.(
        moveDirection?.x || 0,
        moveDirection?.y || 0,
        distance,
        Number(duration) > 0 ? { duration } : null
      ) === true;
      return { started };
    });
    // 空中跳出（v3.1 T2）：原地小跳后滞空中首次输入方向 → launchJump 向该方向拉出剩余距离
    scene.airAimController.setLaunchCallback(({ actor, direction, distance }) => ({
      launched: scene.jumpSystem?.launchJump?.(actor, direction, distance) === true
    }));
    scene.airAimController.setBigJumpCallback(({ actor, distance, duration, peakHeight }) => {
      const options = {};
      if (Number(duration) > 0) options.duration = Number(duration);
      if (Number(peakHeight) > 0) options.peakHeight = Number(peakHeight);
      const upgraded = scene.jumpSystem?.extendJumpTo?.(actor, distance, options) === true;
      if (upgraded) {
        scene.gameLoader?.triggerSystem?.fire?.('jump.big', { entity: actor, distance });
      }
      return { upgraded };
    });
    // 空中换向跳（v3 T3）：滞空中方向明显改变 → 从空中位置向新方向再跳一段（小跳参数）
    scene.airAimController.setAirRedirectCallback(({ actor, moveDirection, distance, duration }) => {
      const started = scene.jumpSystem?.relocateJump?.(
        actor,
        { x: moveDirection?.x || 0, y: moveDirection?.y || 0 },
        Number(duration) > 0 ? { distance, duration } : { distance }
      ) === true;
      if (started) {
        scene.gameLoader?.triggerSystem?.fire?.('jump.double', { entity: actor });
      }
      return { started };
    });
    // 空中轻推（v2.2 T4/T5）：矢量混合渐进转向——键盘/摇杆按 strength×dt 连续推，
    // 右键/触点按 pointerBlend 单次推；剩余距离守恒，起跳方向保留惯性。
    scene.airAimController.setSteerCallback(({ actor, direction, blend }) => ({
      steered: scene.jumpSystem?.steerJump?.(actor, { direction, blend }) === true
    }));

    scene.combatSystem = new CombatSystem({
      inputManager: scene.inputManager,
      camera: scene.camera,
      skillEffects: scene.skillEffects,
      weaponRenderer: scene.weaponRenderer,
      enemyWeaponRenderer: scene.enemyWeaponRenderer,
      floatingTextManager: scene.floatingTextManager,
      // 受击反馈判定「闪避中不打断」
      dodgeSystem: scene.dodgeSystem,
      now
    });
    scene.combatSystem.onMeditationSkill = skill => scene.onSkillClicked(skill);
    scene.combatSystem.onSkillAimRequest = index => scene.enterPCAimMode('skill', index);
    scene.combatSystem.setOnEnterCombat(() => {
      if (scene.meditationSystem?.isActive()) scene.meditationSystem.stop();
    });
    scene.combatSystem.onPotionUse = (potionType, modifiers) => scene.usePotionFromHotbar(potionType, modifiers);
    scene.combatSystem.setLootDropCallback((position, lootItems) => {
      for (const item of lootItems || []) {
        const definitionId = item.itemId || item.definitionId || item.id || item.type;
        try {
          const entity = scene.itemRuntimeFactory?.createGroundDropProjection?.({
            entityId: `combat-drop-${definitionId}-${++this._lootSequence}`,
            runtimeState: { definitionId, quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)) },
            transform: { x: position.x, y: position.y }
          });
          if (!entity) continue;
          scene.entityStore.add(entity);
          scene.entityStore.addEquipmentItem(entity);
          void scene.publishApplicationEvent?.('item.dropped', {
            entityId: entity.id,
            groundId: entity.id,
            definitionId,
            name: item.name || definitionId,
            quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
            position: { x: position.x, y: position.y },
            reason: 'enemyLoot'
          }, { operationId: `combat-drop-revealed:${entity.id}` });
        } catch (error) {
          console.warn('SceneGameplaySystemAssembler: loot projection failed', error);
        }
      }
    });

    scene.pathfindingSystem = new PathfindingSystem({
      cellSize: 32,
      maxVisited: 2048,
      goalSearchRadius: 4
    });
    scene.movementSystem = new MovementSystem({
      inputManager: scene.inputManager,
      camera: scene.camera,
      jumpSystem: scene.jumpSystem,
      pathfindingSystem: scene.pathfindingSystem,
      pathfindingCellSize: 32,
      isMovementLocked: entity => scene.locomotionSystem?.isBusy?.(entity) === true,
      // 剧情倒地状态（S02 军团救援，scene.isPlayerDowned）下移动输入被抑制；
      // 跳跃中不抑制（移动输入=空中操舵，见 AirAimController T4）。
      isMoveInputSuppressed: entity => entity === scene.playerEntity
        && scene.isPlayerDowned?.() === true,
      // 战斗状态不进行移动碰撞停顿/阻挡自动停止，保证战斗手感；战斗结束后恢复。
      combatLock: () => scene.combatSystem?.isInCombat?.() === true
    });
    // 军团指挥（M1）：编组选择 + 点地移动 + 命令达成倒计时；设计见 .trae/rules/army-command-design.md
    scene.armyCommandFlow = new SceneArmyCommandFlow(scene);
    scene.armyCommandFlow.attach();
    scene.equipmentSystem = new EquipmentSystem();
    // P17：战斗结算需要按出手/受击扣减装备耐久
    if (scene.combatSystem) scene.combatSystem.equipmentSystem = scene.equipmentSystem;
    // P16：远程攻击前扣箭矢（武器声明 ammo 才生效；旧武器/旧怪零变化）
    scene.ammoService = new AmmoService({ inventoryTransactions: scene.inventoryTransactions });
    if (scene.combatSystem) scene.combatSystem.ammoService = scene.ammoService;
    scene.aiSystem = new AISystem();
    scene.collisionSystem = new CollisionSystem();
    scene.corpseRuntime = new SceneCorpseRuntime({
      entityStore: scene.entityStore,
      aiSystem: scene.aiSystem,
      retirePlacement: (entity, state) => scene.context?.services?.placements
        ?.tombstonePlacement?.(entity?.placementId, state) || { ok: false, code: 'placementsUnavailable' }
    });
    scene.combatSystem.setOnCorpseCreateCallback(entity => scene.corpseRuntime.retain(entity));
    scene.sceneRuntime?.onFramePhase?.(
      FramePhase.AFTER_SCENE,
      deltaTime => scene.corpseRuntime?.update?.(deltaTime),
      'corpseRuntime'
    );

    const inventoryTransactionsOwned = !scene.inventoryTransactions;
    scene.inventoryTransactions = scene.inventoryTransactions || new InventoryTransactionService();
    scene.pickupSystem = new PickupSystem({
      commandGateway: scene.sceneRuntime?.commandGateway,
      resolveActorId: entity => entity?.id || null,
      now,
      onResult: result => {
        if (result?.ok) return;
        const capacityMessages = {
          inventoryFull: '背包已满，无法拾取',
          resourceCapacityFull: '资源容量已满，无法拾取',
          insufficientCapacity: '背包容量不足，无法拾取'
        };
        scene.notificationSystem?.addWarning?.(
          capacityMessages[result?.code] || `无法拾取（${result?.error?.message || result?.code || '未知原因'}）`
        );
      }
    });
    scene.pickupSystem.init({
      inputManager: scene.inputManager,
      weaponRenderer: scene.weaponRenderer,
      commandGateway: scene.sceneRuntime?.commandGateway
    });
    scene.gatheringProgressPresenter = new GatheringProgressPresenter();
    scene.worldActionPresenter = new WorldActionPresentation({ assetManager: scene.assetManager || null });
    scene.gatheringSystem = new GatheringSystem({
      inventoryTransactions: scene.inventoryTransactions,
      itemResolver: (itemId, resourceType) => scene.gameLoader?.registries?.items?.get?.(itemId) || {
        id: itemId, name: itemId, type: 'material', subType: resourceType, maxStack: 99
      },
      // 状态准入：requiredState: "climbing" 的资源节点（苹果丛）必须攀爬中才能采摘
      stateCheckers: {
        climbing: entity => scene.locomotionSystem?.climbSystem?.isClimbing?.(entity) === true
      },
      settlementPolicy: context => scene.prepareGatheringSettlement?.(context) || null,
      onEvent: (event, data) => scene.onGatheringEvent?.(event, data)
    });
    scene.gatheringPuppetSystem = new GatheringPuppetSystem({
      gatheringSystem: scene.gatheringSystem,
      createPuppet: ({ id, position }) => {
        const puppet = scene.entityFactory?.createNPC?.({
          id,
          name: '采集傀儡',
          faction: 'ally',
          imageId: 's09.summon.gatheringPuppet',
          sprite: { width: 58, height: 72, isStatic: true },
          renderStyle: 'gathering_puppet',
          position,
          stats: { maxHp: 30, hp: 30, attack: 0, defense: 0, speed: 0 },
          interaction: { radius: 0 }
        });
        if (puppet) {
          puppet.type = 'summon';
          puppet.faction = 'ally';
          puppet.tags = ['summon', 'gatheringPuppet'];
          puppet.lootTable = [];
        }
        return puppet;
      },
      addEntity: entity => scene.entityStore?.add?.(entity),
      removeEntity: entity => scene.entityStore?.remove?.(entity),
      damageOwner: damage => {
        if (scene.playerEntity) scene.combatSystem?.applyDamage?.(scene.playerEntity, damage, null, '傀儡反噬');
      },
      onEvent: (event, data) => scene.onGatheringPuppetEvent?.(event, data)
    });
    scene.abilitySystem = null;
    scene.combatSystem.setPlayerInputLock?.(() => scene.isPlayerActionLocked?.() === true);
    scene.combatSystem.setOnDamageCallback?.(({ target, appliedDamage, isDead }) => {
      if (appliedDamage <= 0) return;
      if (scene.gatheringPuppetSystem?.handleDamage?.(target, { isDead })) return;
      if (target === scene.playerEntity) {
        if (scene.gatheringSystem.isActiveFor(target)) scene.gatheringSystem.interruptByDamage();
        scene._s01s02Coordinator?.interruptRecipeAction?.('damaged');
      }
    });
    scene.playerDefeatService = new PlayerDefeatService({
      inventoryTransactions: scene.inventoryTransactions,
      entityFactory: scene.entityFactory,
      entityStore: scene.entityStore,
      revivePlayer: (player, reviveOptions) => scene.combatSystem.revivePlayer(player, reviveOptions),
      reviveOptions: { hpRatio: 0.15, mpRatio: 0.15 },
      respawnResolver: ({ player, resolution } = {}) => {
        if (resolution?.type !== 'specialFaint') {
          const position = player?.getComponent?.('transform')?.position;
          return Number.isFinite(position?.x) && Number.isFinite(position?.y)
            ? { x: position.x, y: position.y, label: '倒下的位置' }
            : null;
        }
        return scene.resolvePlayerRespawnPosition?.({ player, resolution }) || null;
      },
      getDeathDropPresentation: context => scene.getDeathDropPresentation?.(context) || {},
      onResolved: result => {
        // 延迟复活（灵魂状态）：结算消息由 PlayerSoulRespawn 呈现，这里只补充掉落信息。
        if (result?.deferredRespawn === true) {
          const lost = (result.stacks || []).reduce((sum, stack) => sum + stack.quantity, 0);
          if (lost > 0) scene._showScreenTip?.(`死亡后遗失 ${lost} 份资源，掉落在你倒下的位置`, { title: '死亡' });
          return;
        }
        const policy = scene.context?.services?.defeatPolicy;
        if (policy?.handleResolved?.(result) === true) return;
        scene.onPlayerDefeatResolved?.(result);
      }
    });

    const executePlayerDeath = ({ player, deathId, resolution, deferRespawn = false }) => scene.sceneRuntime?.commandGateway?.execute?.({
      intentType: ITEM_LIFECYCLE_COMMANDS.DEATH_DROP,
      actorRef: player.id,
      operationId: `death:${player.id}:${deathId}`,
      payload: { deathId, resolution, checkpointId: `checkpoint.${deathId}`, deferRespawn }
    }) || { ok: false, code: 'deathCommandUnavailable' };
    scene.playerDeathCountdown = new PlayerDeathCountdown({
      durationSeconds: 5,
      show: text => scene._showScreenTip?.(text, { title: '死亡', owner: 'playerDeath', persist: true }),
      hide: () => scene._hintPresenter?.hideScreen?.('playerDeath'),
      onAwaitConfirmation: () => {
        const view = scene.irreversibleChoiceView;
        if (!view) return false;
        view.open({
          title: '确认复活',
          description: '等待结束。确认后将在倒下的位置恢复生命与法力。',
          warning: '确认前角色保持死亡状态，世界操作已锁定',
          allowCancel: false,
          selectedId: 'revive',
          choices: [{
            id: 'revive',
            label: '原地复活',
            consequences: ['恢复全部生命与法力', '背包物品全部保留']
          }]
        });
        return true;
      },
      onComplete: executePlayerDeath
    });
    scene.sceneRuntime?.onFramePhase?.(
      FramePhase.AFTER_SCENE,
      deltaTime => scene.playerDeathCountdown?.update(deltaTime),
      'playerDeathCountdown'
    );
    scene.sceneRuntime?.addDisposer?.(
      () => {
        const reviveChoiceOpen = scene.irreversibleChoiceView?.snapshot?.choices
          ?.some?.(choice => choice?.id === 'revive') === true;
        scene.playerDeathCountdown?.dispose?.();
        if (reviveChoiceOpen) scene.irreversibleChoiceView?.close?.();
      },
      'player-death-countdown'
    );

    // 普通死亡在权威掉落结算成功后，传送到最近已点燃火堆并开始 10 秒复活倒计时。
    scene.playerSoulRespawn = new PlayerSoulRespawn({
      durationSeconds: 10,
      reviveOffsetY: 46,
      getCampfirePosition: () => {
        const campfire = scene.context?.services?.campfire;
        if (campfire?.isConfigured?.() !== true || campfire?.isLit?.() !== true) return null;
        const position = campfire.getPosition?.();
        return Number.isFinite(position?.x) && Number.isFinite(position?.y)
          ? { ...position, label: '已点燃的火堆旁' }
          : null;
      },
      getSpawnPosition: () => scene.resolvePlayerRespawnPosition?.({}) || null,
      showTip: (text, options) => scene._showScreenTip?.(text, options),
      hideTip: () => scene._hintPresenter?.hideScreen?.('playerSoul'),
      onCountdown: (seconds, presentation) => scene.context?.services?.campfire
        ?.setRespawnCountdown?.(seconds, presentation),
      onAwaitConfirmation: pending => {
        const view = scene.irreversibleChoiceView;
        if (!view) return false;
        const location = pending.respawnPosition?.label || '安全地点';
        view.open({
          title: '确认复活',
          description: `倒计时结束。是否在${location}复活？`,
          warning: '取消会保持死亡状态，并重新开始 10 秒倒计时。',
          presentation: { variant: 'compact', allowMovement: true },
          allowCancel: true,
          selectedId: 'revive',
          choices: [
            { id: 'cancel', label: '取消', immediate: true, consequences: ['保持死亡状态', '重新开始复活倒计时'] },
            { id: 'revive', label: '复活', immediate: true, consequences: ['在火堆旁复活', '恢复 15% 生命与法力'] }
          ]
        });
        return true;
      },
      onSoulStateChange: active => {
        scene.playerSoulActive = active === true;
        if (active === true && scene.combatSystem?.isInCombat?.() === true) {
          scene.combatSystem.exitCombat();
        }
        this.onSoulStateVisual?.(active === true);
      },
      onComplete: ({ player, deathId, position }) => scene.playerDefeatService?.completeDeferredRespawn?.(player, deathId, position)
        || { ok: false, code: 'defeatServiceMissing' }
    });
    scene.sceneRuntime?.onFramePhase?.(
      FramePhase.AFTER_SCENE,
      deltaTime => scene.playerSoulRespawn?.update(deltaTime),
      'playerSoulRespawn'
    );
    scene.sceneRuntime?.addDisposer?.(() => scene.playerSoulRespawn?.dispose?.(), 'player-soul-respawn');

    const resolveEntity = id => scene.entityStore?.all?.find?.(entity => entity?.id === id)
      || (scene.playerEntity?.id === id ? scene.playerEntity : null);
    const resolveInventory = id => {
      if (!id) return null;
      const containerInventory = scene.context?.services?.containerInventories?.resolve?.(id);
      if (containerInventory) return containerInventory;
      if (id === `${scene.playerEntity?.id}:inventory` || id === scene.playerEntity?.id) {
        return scene.playerEntity?.getComponent?.('inventory') || null;
      }
      const suffix = id.endsWith(':cargo') ? 'cargo' : (id.endsWith(':inventory') ? 'inventory' : null);
      const entityId = suffix ? id.slice(0, -(suffix.length + 1)) : id;
      return resolveEntity(entityId)?.getComponent?.(suffix || 'inventory') || null;
    };
    scene.itemLifecycleService = new ItemLifecycleService({
      inventoryTransactions: scene.inventoryTransactions,
      equipmentSystem: scene.equipmentSystem,
      resolveActor: id => resolveEntity(id),
      resolveInventory,
      resolveWorldItem: id => [...(scene.entityStore?.equipmentItems || []), ...(scene.entityStore?.pickups || [])]
        .find(item => item?.id === id || item?.entityId === id || item?.placementId === id) || null,
      resolveDefinition: id => scene.itemRuntimeFactory?.resolveDefinition?.(id)
        || scene.gameLoader?.definitionRepository?.get?.('items', id)
        || scene.gameLoader?.definitionRepository?.get?.('equipment', id)
        || scene.gameLoader?.registries?.items?.get?.(id)
        || null,
      createGroundDrop: draft => scene.itemRuntimeFactory?.createGroundDropProjection?.(draft),
      addWorldEntity: entity => {
        scene.entityStore?.add?.(entity);
        scene.entityStore?.addEquipmentItem?.(entity);
        return true;
      },
      removeWorldEntity: entity => scene.entityStore?.remove?.(entity),
      createCheckpoint: checkpoint => scene.requestAutoSave?.({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: scene.currentSceneId
      }),
      playerDefeatService: scene.playerDefeatService,
      canUseItem: actor => {
        if (actor !== scene.playerEntity) {
          return actor?.isDead !== true && actor?.isSoulState !== true;
        }
        const allowed = scene.canPerformPlayerAction?.('item.use', actor)
          ?? (actor?.isDead !== true && actor?.isSoulState !== true);
        if (allowed) return true;
        const soulState = actor?.isSoulState === true || Boolean(scene.playerSoulRespawn?.pending);
        return {
          ok: false,
          code: soulState ? 'soulState' : 'playerActionLocked',
          message: soulState ? '灵魂状态无法使用物品' : '当前状态无法使用物品'
        };
      },
      onEquipmentChanged: (messages, info) => scene.onEquipmentChanged?.(messages, info),
      onItemUsed: ({ item, heal, mana }) => scene.onItemUsed?.(item, heal, mana),
      onItemGained: (item, player) => scene.onItemGained?.(item, player)
    });
    const resolveItemDefinition = id => scene.itemRuntimeFactory?.resolveDefinition?.(id)
      || scene.gameLoader?.definitionRepository?.get?.('items', id)
      || scene.gameLoader?.definitionRepository?.get?.('equipment', id)
      || scene.gameLoader?.registries?.items?.get?.(id)
      || null;
    scene.toolRepairService = new ToolRepairService({
      inventoryTransactions: scene.inventoryTransactions,
      resolveActor: id => resolveEntity(id),
      resolveDefinition: resolveItemDefinition,
      createCheckpoint: checkpoint => scene.requestAutoSave?.({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: scene.currentSceneId
      })
    });
    scene.equipmentRepairService = new EquipmentRepairService({
      inventoryTransactions: scene.inventoryTransactions,
      resolveActor: id => resolveEntity(id),
      resolveDefinition: resolveItemDefinition,
      resolveStation: (stationId, options) => this._resolveConstructionStation(scene.constructionSystem, stationId),
      createCheckpoint: checkpoint => scene.requestAutoSave?.({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: scene.currentSceneId
      })
    });
    // P17：item.repair 外层按 payload.kind 分流——装备修复走新服务，工具修复链零改动。
    this._registerSceneCommand('item.repair', {
      execute: (command, context) => {
        const kind = command?.payload?.kind;
        return kind === 'equipment'
          ? scene.equipmentRepairService.execute(command, context)
          : scene.toolRepairService.execute(command, context);
      }
    });
    for (const commandType of Object.values(ITEM_LIFECYCLE_COMMANDS)) {
      this._registerSceneCommand(commandType, scene.itemLifecycleService);
    }
    const offItemProjection = scene.sceneRuntime?.projectionStore?.registerReducer?.(
      scene.itemLifecycleService.stateType,
      (_current, event) => event.payload?.projection || null
    );
    if (offItemProjection) scene.sceneRuntime.addDisposer(offItemProjection, 'projection:itemLifecycle');
    const offToolRepairProjection = scene.sceneRuntime?.projectionStore?.registerReducer?.(
      scene.toolRepairService.stateType,
      (_current, event) => event.payload?.projection || null
    );
    if (offToolRepairProjection) scene.sceneRuntime.addDisposer(offToolRepairProjection, 'projection:toolRepair');

    scene.combatSystem.setOnKillCallback?.(entity => scene.onEnemyKilled?.(entity));
    scene.combatSystem.setOnPlayerDeathCallback?.(({ player, deathEvent }) => {
      const policy = scene.context?.services?.defeatPolicy;
      const resolution = policy?.resolve?.({ player })
        || scene.resolvePlayerDefeatResolution?.({ player })
        || { type: 'normalDeath' };
      const deathId = `player-death-${scene.playerDefeatService.nextDeathSequence}`;
      if (resolution.type === 'specialFaint') {
        // 数据侧钩子：剧情昏迷（如 S01 狼群/商队、S02 乞讨被打晕）广播为触发器事件，
        // 让内容以 trigger(playerSpecialFaint) 承接后续编排（旁白/军队路过等），引擎不写死剧情。
        try {
          scene.gameLoader?.triggerSystem?.fire?.('playerSpecialFaint', {
            rescueType: resolution.rescueType || 'passerby',
            sceneId: scene.currentSceneId
          });
        } catch (error) { /* 事件广播失败不阻断昏迷结算 */ }
        void Promise.resolve(executePlayerDeath({ player, deathId, resolution })).catch(error => {
          console.warn('SceneGameplaySystemAssembler: 特殊昏迷结算失败', error);
        });
        return { ok: true, pending: true };
      }
      if (scene.playerSoulRespawn?.pending || scene.playerDeathCountdown?.pending) {
        return { ok: true, pending: true, idempotent: true };
      }

      // 掉落和资源损失必须在真实死亡位置先提交；成功后才允许移动到火堆开始复活。
      void Promise.resolve(executePlayerDeath({ player, deathId, resolution, deferRespawn: true }))
        .then(result => {
          if (result?.ok) {
            const started = scene.playerSoulRespawn?.start({ player, deathId, resolution, deathEvent }) === true;
            if (started) return result;
            scene._showScreenTip?.('死亡结算已完成，但复活流程无法启动。', {
              title: '死亡',
              owner: 'playerSoul',
              persist: true
            });
            return { ok: false, code: 'soulRespawnUnavailable' };
          }
          scene._showScreenTip?.('死亡结算失败，无法开始复活。', {
            title: '死亡',
            owner: 'playerSoul',
            persist: true
          });
          return result || { ok: false, code: 'deathSettlementFailed' };
        })
        .catch(error => {
          console.warn('SceneGameplaySystemAssembler: 延期死亡结算失败', error);
          scene._showScreenTip?.('死亡结算失败，无法开始复活。', {
            title: '死亡',
            owner: 'playerSoul',
            persist: true
          });
        });
      return { ok: true, pending: true };
    });

    scene.meditationSystem = new MeditationSystem({ now });

    scene.meditationSystem.init({
      inputManager: scene.inputManager,
      floatingTextManager: scene.floatingTextManager,
      skillEffects: scene.skillEffects,
      combatSystem: scene.combatSystem
    });

    scene.zoneEffectSystem = new ZoneEffectSystem();
    scene.zoneEffectSystem.setCallbacks(zoneCallbacks);

    scene.meleeAttackSystem = new MeleeAttackSystem({
      disableAutoAttack: scene.isMobileLayout,
      hideSectorWhenIdle: scene.isMobileLayout
    });
    scene.meleeAttackSystem.init({
      inputManager: scene.inputManager,
      combatSystem: scene.combatSystem,
      floatingTextManager: scene.floatingTextManager,
      canAttack: () => scene.canPerformBasicAttack?.() ?? scene.combatSystem?.isInCombat?.() === true,
      onAttackPerformed: () => {
        const tutorialFlow = scene.context?.services?.tutorialFlow;
        if (tutorialFlow) tutorialFlow.notify('attackPerformed');
        else scene.onPlayerTutorialAction?.('attack');
      }
    });

    return this._createCoreRegistrationPlan({ inventoryTransactionsOwned });
  }

  _createCoreRegistrationPlan({ inventoryTransactionsOwned }) {
    const scene = this.scene;
    const registrations = [
      ['gameplay.combatEffects', scene.combatEffects],
      ['gameplay.skillEffects', scene.skillEffects],
      ['gameplay.weaponRenderer', scene.weaponRenderer],
      ['gameplay.enemyWeaponRenderer', scene.enemyWeaponRenderer, 'cleanup'],
      ['gameplay.flight', scene.flightSystem, 'cleanup'],
      ['gameplay.jump', scene.jumpSystem, 'cleanup'],
      ['gameplay.dodge', scene.dodgeSystem, 'cleanup'],
      ['gameplay.locomotion', scene.locomotionSystem, 'cleanup'],
      ['gameplay.combat', scene.combatSystem],
      ['gameplay.pathfinding', scene.pathfindingSystem],
      ['gameplay.movement', scene.movementSystem],
      ['gameplay.equipment', scene.equipmentSystem],
      ['gameplay.ai', scene.aiSystem],
      ['gameplay.collision', scene.collisionSystem],
      ['gameplay.corpses', scene.corpseRuntime, 'dispose'],
      ['gameplay.inventoryTransactions', scene.inventoryTransactions],
      ['gameplay.pickup', scene.pickupSystem],
      ['gameplay.gatheringProgress', scene.gatheringProgressPresenter, 'dispose'],
      ['presentation.worldAction', scene.worldActionPresenter, 'dispose', 'update'],
      ['gameplay.airAim', scene.airAimController, 'dispose'],
      ['gameplay.gathering', scene.gatheringSystem],
      ['gameplay.gatheringPuppet', scene.gatheringPuppetSystem, 'dispose'],
      ['gameplay.playerDefeat', scene.playerDefeatService],
      ['gameplay.itemLifecycle', scene.itemLifecycleService],
      ['gameplay.toolRepair', scene.toolRepairService],
      ['gameplay.meditation', scene.meditationSystem],
      ['gameplay.zoneEffect', scene.zoneEffectSystem],
      ['gameplay.meleeAttack', scene.meleeAttackSystem, 'cleanup']
    ].map(([name, instance, disposeHook, updateHook], order) => ({
      name,
      instance,
      options: {
        order: 100 + order,
        updateHook: updateHook || false,
        disposeHook: disposeHook || false,
        ownership: name === 'gameplay.inventoryTransactions' && !inventoryTransactionsOwned
          ? 'BORROWED'
          : 'OWNED'
      }
    }));
    const systemFields = {
      ability: 'abilitySystem', combat: 'combatSystem', pathfinding: 'pathfindingSystem',
      movement: 'movementSystem', equipment: 'equipmentSystem', ai: 'aiSystem', collision: 'collisionSystem',
      corpses: 'corpseRuntime',
      pickup: 'pickupSystem', gathering: 'gatheringSystem', gatheringPuppet: 'gatheringPuppetSystem',
      meditation: 'meditationSystem', zoneEffect: 'zoneEffectSystem', meleeAttack: 'meleeAttackSystem',
      flight: 'flightSystem', jump: 'jumpSystem', dodge: 'dodgeSystem', locomotion: 'locomotionSystem',
      playerDefeat: 'playerDefeatService', itemLifecycle: 'itemLifecycleService',
      toolRepair: 'toolRepairService',
      inventoryTransactions: 'inventoryTransactions'
    };
    const presentationFields = {
      combatEffects: 'combatEffects', skillEffects: 'skillEffects', weaponRenderer: 'weaponRenderer',
      enemyWeaponRenderer: 'enemyWeaponRenderer', particleSystem: 'particleSystem',
      floatingTextManager: 'floatingTextManager', effectZoneRenderer: 'effectZoneRenderer',
      taskMarkerBeacon: 'taskMarkerBeacon',
      gatheringProgress: 'gatheringProgressPresenter', worldAction: 'worldActionPresenter'
    };
    const projections = [];
    for (const [key, field] of Object.entries(systemFields)) {
      projections.push({ target: scene.context?.systems, key, instance: scene[field] });
      projections.push({ target: scene, key: field, instance: scene[field] });
    }
    for (const [key, field] of Object.entries(presentationFields)) {
      projections.push({ target: scene.context?.presentation, key, instance: scene[field] });
      projections.push({ target: scene, key: field, instance: scene[field] });
    }
    projections.push({ target: scene.context?.services, key: 'corpses', instance: scene.corpseRuntime });
    return Object.freeze({
      id: 'gameplay-core',
      registrations: Object.freeze(registrations),
      projections: Object.freeze(projections.filter(item => item.target))
    });
  }

  /** GameLoader 就绪后创建技能系统并返回登记计划。 */
  configureAbilities({ skillRegistry = null, effectResolver = null } = {}) {
    const scene = this.scene;
    if (!skillRegistry) return null;
    const abilitySystem = new AbilitySystem({
      skillRegistry,
      effectResolver,
      now: () => scene.simulationClock?.now?.() ?? performance.now(),
      executor: context => {
        const locomotionHandled = scene.locomotionSystem?.execute?.(context);
        if (locomotionHandled !== undefined && locomotionHandled !== null) return locomotionHandled;
        const handled = scene.executeAbility?.(context);
        if (handled !== undefined && handled !== null) return handled;
        return scene.combatSystem?.executeSkill?.(context) === true;
      },
      onEvent: (event, data) => scene.onAbilityEvent?.(event, data)
    });
    scene.abilitySystem = abilitySystem;
    // 敌人攻击编排：注入技能定义注册表，EnemySkillDirector 复用 skills.json 结算
    scene.aiSystem?.skillDirector?.setSkillRegistry?.(skillRegistry);
    scene.gatheringPuppetSystem?.configure?.({ effectResolver, owner: scene.playerEntity });
    return {
      id: 'gameplay-ability',
      registrations: [{
        name: 'gameplay.ability',
        instance: abilitySystem,
        options: { order: 120, updateHook: false, disposeHook: false, ownership: 'OWNED' }
      }],
      projections: [
        { target: scene.context?.systems, key: 'ability', instance: abilitySystem },
        { target: scene, key: 'abilitySystem', instance: abilitySystem }
      ].filter(item => item.target)
    };
  }

  /**
   * GameLoader 就绪后统一创建职业、熟练度、营建与载具领域系统。
   * 历史条件、checkpoint 和事件命名全部由调用方以回调注入。
   */
  configureSharedSystems(config = {}) {
    const scene = this.scene;
    const effectResolver = config.effectResolver || null;
    if (!effectResolver) return null;

    const proficiencyConfig = config.proficiency || {};
    const proficiencySystem = new ProficiencySystem({
      ...(proficiencyConfig.config || {}),
      onEvent: proficiencyConfig.onEvent
    });
    const classSystem = new ClassSystem({ effectResolver });

    scene.gatheringSystem?.setEffectResolver?.(effectResolver);
    scene.gatheringSystem?.setSettlementPolicy?.(config.gathering?.settlementPolicy || null);
    scene.inventoryTransactions?.configureEffects?.({
      effectResolver,
      getEntityId: config.inventoryEffects?.getEntityId,
      baseResourceCapacity: config.inventoryEffects?.baseResourceCapacity
    });
    if (scene.itemLifecycleService) scene.itemLifecycleService.effectResolver = effectResolver;

    const constructionConfig = config.construction || {};
    const constructionSystem = new ConstructionSystem({
      inventoryTransactions: scene.inventoryTransactions,
      proficiencySystem,
      maxOperations: constructionConfig.maxOperations,
      itemResolver: constructionConfig.itemResolver,
      createCheckpoint: constructionConfig.createCheckpoint,
      createEventId: constructionConfig.createEventId,
      validateSite: constructionConfig.validateSite,
      onEvent: constructionConfig.onEvent
    });
    const registered = constructionSystem.registerDefinitions(constructionConfig.definitions || []);
    const requiredProficiency = constructionConfig.requiredProficiencyType || null;
    if (!registered.ok || (requiredProficiency && !proficiencySystem.getDefinition?.(requiredProficiency))) {
      throw new Error(`Shared gameplay construction config invalid: ${registered.code || `missingProficiency:${requiredProficiency}`}`);
    }

    const productionConfig = config.production || {};
    const productionSystem = new ProductionSystem({
      inventoryTransactions: scene.inventoryTransactions,
      proficiencySystem,
      itemResolver: productionConfig.itemResolver,
      resolveStation: typeof productionConfig.resolveStation === 'function'
        ? productionConfig.resolveStation
        : stationId => this._resolveConstructionStation(constructionSystem, stationId),
      createCheckpoint: productionConfig.createCheckpoint,
      createEventId: productionConfig.createEventId,
      onEvent: productionConfig.onEvent,
      rng: productionConfig.rng,
      maxOperations: productionConfig.maxOperations
    });
    if (Array.isArray(productionConfig.recipes) && productionConfig.recipes.length > 0) {
      const recipesRegistered = productionSystem.registerRecipes(productionConfig.recipes);
      if (!recipesRegistered.ok) {
        throw new Error(`Shared gameplay production config invalid: ${recipesRegistered.code}`);
      }
    }

    const supplyConfig = config.supply || null;
    const convoyConfig = config.convoy || null;
    let supplySystem = null;
    let convoySystem = null;
    if (supplyConfig) {
      supplySystem = new SupplySystem({
        readCities: supplyConfig.readCities,
        commitCities: supplyConfig.commitCities,
        inventoryTransactions: scene.inventoryTransactions,
        itemResolver: supplyConfig.itemResolver,
        getDay: supplyConfig.getDay,
        config: supplyConfig.config || {},
        createEventId: supplyConfig.createEventId,
        onEvent: supplyConfig.onEvent,
        maxOperations: supplyConfig.maxOperations,
        maxOrders: supplyConfig.maxOrders
      });
    }
    if (convoyConfig) {
      convoySystem = new ConvoySystem({
        inventoryTransactions: scene.inventoryTransactions,
        itemResolver: convoyConfig.itemResolver,
        resolveTemplate: convoyConfig.resolveTemplate,
        resolveOrder: typeof convoyConfig.resolveOrder === 'function'
          ? convoyConfig.resolveOrder
          : (orderId => supplySystem ? supplySystem.getOrder(orderId) : null),
        notifyOrder: typeof convoyConfig.notifyOrder === 'function'
          ? convoyConfig.notifyOrder
          : (supplySystem
            ? (orderId, status, details) => supplySystem.transitionOrder(orderId, status, details)
            : null),
        resolveStash: convoyConfig.resolveStash,
        resolveCargo: typeof convoyConfig.resolveCargo === 'function'
          ? convoyConfig.resolveCargo
          : id => this._resolveInventory(id),
        // 载具物理生成薄适配（M3 3A）：落点校验走场景可通行判定，生成走 EntityFactory
        resolveSpawnPosition: typeof convoyConfig.resolveSpawnPosition === 'function'
          ? convoyConfig.resolveSpawnPosition
          : (candidate, radius) => this._resolveVehicleSpawnPosition(candidate, radius),
        spawnVehicleEntity: typeof convoyConfig.spawnVehicleEntity === 'function'
          ? convoyConfig.spawnVehicleEntity
          : request => this._spawnConvoyVehicle(request),
        onLootDrop: convoyConfig.onLootDrop,
        onEvent: convoyConfig.onEvent,
        createEventId: convoyConfig.createEventId,
        rng: convoyConfig.rng,
        getDay: convoyConfig.getDay || supplyConfig?.getDay,
        ambushConfig: convoyConfig.ambushConfig || {},
        maxOperations: convoyConfig.maxOperations,
        maxConvoys: convoyConfig.maxConvoys
      });
    }

    // 随行小队（M3 3A）：容量/士气/五档/补位领域系统 + 场景装配流（HUD、1-5 键、姿态转发、入档）
    const companionConfig = config.companion || null;
    let companionSystem = null;
    let companionFlow = null;
    if (companionConfig) {
      companionSystem = new CompanionSquadSystem({
        rule: companionConfig.rule || {},
        now: companionConfig.now,
        getCommand: companionConfig.getCommand,
        getRankValue: companionConfig.getRankValue,
        onEvent: companionConfig.onEvent
      });
      companionFlow = new SceneCompanionSquadFlow(scene, { system: companionSystem });
      companionFlow.attach();
      scene.companionSquadSystem = companionSystem;
      scene.companionSquadFlow = companionFlow;
      // 3A 补位实体重生成：同名实体已被清理时按蓝图重建（EntityFactory 友军管线）
      scene.spawnCompanionMember = request => this._spawnCompanionMember(request);
    }

    // 武装单位战略指令（M3 3B）：armyStates + 五指令 + 500ms 战略刻 + 部署锁 + 将令
    const armyOrderConfig = config.armyOrder || null;
    let armyOrderSystem = null;
    let armyOrderFlow = null;
    let encounterResolver = null;
    if (armyOrderConfig) {
      // 4A：独立世界逻辑路径层（唯一通行判定 + 派生投影 + Dijkstra）
      const worldLogic = armyOrderConfig.worldLogic
        || config.worldLogic
        || scene.gameLoader?.project?.worldLogic
        || null;
      const worldRouteLayer = worldLogic
        ? new WorldRouteLayer({
          logic: worldLogic,
          getDay: armyOrderConfig.getDay,
          getOwnership: armyOrderConfig.getOwnership
            || (nodeId => this._worldNodeFaction(scene, nodeId)),
          moverFactionId: armyOrderConfig.factionId || null
        })
        : null;
      const worldMarchExecutor = worldRouteLayer
        ? new WorldMarchExecutor({
          layer: worldRouteLayer,
          marchSpeed: armyOrderConfig.worldMarchSpeed
        })
        : null;
      const routePlanner = worldRouteLayer
        ? ({ state, target, point }) => this._planWorldRoute(worldRouteLayer, { state, target, point })
        : null;
      // 4C：遭遇四选（探测/公式）+ 关隘关税（经过计税 / 日结入城）
      const unitTypeRegistry = scene.gameLoader?.registries?.unitTypes;
      const heroRegistry = scene.gameLoader?.registries?.heroes;
      const formationRegistry = scene.gameLoader?.registries?.formations;
      encounterResolver = worldRouteLayer
        ? new EncounterResolver({
          combat: worldLogic?.combat || null,
          rng: armyOrderConfig.rng,
          resolveUnitType: unitTypeId => unitTypeRegistry?.get?.(unitTypeId) || null,
          resolveHero: heroId => heroRegistry?.get?.(heroId) || null,
          resolveFormation: formationId => formationRegistry?.get?.(formationId) || null,
          getCityState: cityId => (scene.gameLoader?.blackboard?.get?.('cityStates') || [])
            .find(city => city && String(city.id) === String(cityId)) || null,
          now: armyOrderConfig.now
        })
        : null;
      const passTariffSystem = new PassTariffSystem({
        tariff: worldLogic?.tariff || null,
        listPasses: () => armyOrderSystem.listUnits().filter(unit => unit.kind === 'pass'),
        getPass: passId => armyOrderSystem.getUnit(passId),
        updatePassToll: (passId, total) => {
          const pass = armyOrderSystem.getUnit(passId);
          if (!pass) return;
          pass.supply = { ...(pass.supply || {}), toll: Math.max(0, Math.floor(Number(total) || 0)) };
        },
        // 归属方最近城池：同阵营逻辑城池节点绑定的 cityStates id
        resolveCityForPass: (passId, ownerFactionId) => {
          if (!worldRouteLayer || ownerFactionId == null) return null;
          const passNode = worldRouteLayer.getNode(passId);
          if (!passNode) return null;
          let best = null;
          for (const node of worldRouteLayer.nodes.values()) {
            if (!node || node.kind !== 'city') continue;
            if (String(worldRouteLayer.getOwner(node.id) ?? '') !== String(ownerFactionId)) continue;
            const distance = Math.hypot(
              Number(node.position?.x) - Number(passNode.position?.x),
              Number(node.position?.y) - Number(passNode.position?.y)
            );
            if (!best || distance < best.distance) best = { cityId: node.ref?.id || node.id, distance };
          }
          return best ? best.cityId : null;
        },
        onEvent: (event, payload) => armyOrderSystem._emit?.(event, payload)
      });
      armyOrderSystem = new ArmyOrderSystem({
        armyOrders: armyOrderConfig.armyOrders || armyOrderConfig.config || {},
        now: armyOrderConfig.now,
        getDay: armyOrderConfig.getDay,
        battleAgent: armyOrderConfig.battleAgent,
        formationExists: armyOrderConfig.formationExists,
        resolveTargetPoint: armyOrderConfig.resolveTargetPoint,
        executors: armyOrderConfig.executors,
        encounterDetector: armyOrderConfig.encounterDetector,
        onEvent: armyOrderConfig.onEvent,
        routePlanner
      });
      armyOrderFlow = new SceneArmyOrderFlow(scene, {
        system: armyOrderSystem,
        marchExecutor: worldMarchExecutor,
        encounterResolver,
        passTariffSystem,
        applyBattleResult: result => {
          const cityWar = scene.cityWarSystem
            || scene.battleSession?.runtime?.cityWarSystem
            || scene.sceneBattleRuntime?.cityWarSystem
            || null;
          if (cityWar?.applyBattleResult) {
            return cityWar.applyBattleResult({ result, operationId: result?.resultId });
          }
          return scene.publishApplicationEvent?.('city.battleResult', result) || null;
        },
        now: armyOrderConfig.now
      });
      armyOrderFlow.attach();
      // WorldMarchExecutor 进入节点回调 → 关隘计税（经过即计，日结入城）
      if (worldMarchExecutor) {
        worldMarchExecutor.onEnterNode = payload => armyOrderFlow.handleEnterNode?.(payload);
      }
      scene.armyOrderSystem = armyOrderSystem;
      scene.armyOrderFlow = armyOrderFlow;
      // 4C：遭遇解析器唯一实例，挂到场景与 context.services（含无 worldLogic 时的 null），
      // 供任务/面板/外部系统读取，不另造第二个实例。
      scene.encounterResolver = encounterResolver;
      if (scene.context?.services) scene.context.services.encounterResolver = encounterResolver;
      if (worldRouteLayer) {
        scene.worldRouteLayer = worldRouteLayer;
        scene.worldMarchExecutor = worldMarchExecutor;
        this._registerWorldRouteCommands(worldRouteLayer);
      }
    }

    // ─── 军需体系接线（M6/M7/M9）───────────────────────────────────────────
    // 粮草账本 / 城镇内政 / 战果结算 / 声望 / 入场身份：领域服务保持纯领域，
    // 这里只负责生命周期、读档适配与命令注册（order 513~517）。
    const defaultGetDay = () => Number(scene.gameLoader?.blackboard?.get?.('storyState')?.day) || 1;
    const clockNow = () => scene.simulationClock?.now?.() ?? performance.now();
    const warAdapters = createCityWarAdapters({
      readCities: config.cityAdmin?.readCities,
      commitCities: config.cityAdmin?.commitCities,
      readArmy: config.battleSettlement?.readArmy,
      writeArmy: config.battleSettlement?.writeArmy,
      readWarState: config.warState?.read,
      writeWarState: config.warState?.write
    });
    const armyLogisticsAdapter = createArmyLogisticsAdapter({
      listUnits: () => (armyOrderSystem ? armyOrderSystem.listUnits() : []),
      getUnit: armyId => armyOrderSystem?.getUnit?.(armyId) || null,
      writeUnit: (armyId, patch) => {
        const unit = armyOrderSystem?.getUnit?.(armyId);
        if (unit) Object.assign(unit, patch);
      }
    });
    this._armyLogisticsAdapter = armyLogisticsAdapter;

    const logisticsConfig = config.logistics || null;
    let foodLedgerSystem = null;
    if (logisticsConfig) {
      let autoResupply = typeof logisticsConfig.autoResupply === 'function'
        ? logisticsConfig.autoResupply
        : null;
      if (!autoResupply && logisticsConfig.autoResupply !== false) {
        autoResupply = createAutoResupplyAdapter({
          resolveArmy: armyId => foodLedgerSystem?.getArmy?.(armyId) || null,
          isAiArmy: logisticsConfig.isAiArmy,
          aiSupplyEfficiency: logisticsConfig.aiSupplyEfficiency
        });
      }
      foodLedgerSystem = new FoodLedgerSystem({
        config: logisticsConfig.config || logisticsConfig,
        armies: armyLogisticsAdapter.listArmies(),
        now: logisticsConfig.now || clockNow,
        getDay: logisticsConfig.getDay || defaultGetDay,
        rng: logisticsConfig.rng,
        autoResupply,
        onEvent: logisticsConfig.onEvent
      });
      // 结算/存取后把 supply/morale/manpower 回写到行军单位（单一事实源仍是账本）。
      scene.syncFoodLedgerArmies = () => {
        for (const army of foodLedgerSystem.armies.values()) {
          armyLogisticsAdapter.writeArmy(army.id, army);
        }
      };
      // 军营粮草容器：配置声明的军营先入库，再同步进容器注册表（易失，不参与旧档校验）。
      // 军营种子既可写在装配段（logistics.camps），也可写在项目军需配置里（logistics.config.camps）。
      const campSeeds = Array.isArray(logisticsConfig.camps)
        ? logisticsConfig.camps
        : (Array.isArray(logisticsConfig.config?.camps) ? logisticsConfig.config.camps : []);
      for (const camp of campSeeds) {
        if (camp?.campId != null && !foodLedgerSystem.camps.has(String(camp.campId))) {
          foodLedgerSystem.registerCamp(camp);
        }
      }
      this._campContainers = new Map();
      this._campNonce = `camp${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      scene.syncCampContainers = () => this._syncCampContainers(foodLedgerSystem);
      scene.resolveCampContainer = campId => (
        this._campContainers?.get(`camp:${String(campId ?? '')}`) || null
      );
      scene.syncCampContainers();
    }

    const cityAdminConfig = config.cityAdmin || null;
    let cityAdministrationService = null;
    if (cityAdminConfig) {
      const cityOptions = cityAdminConfig.config || cityAdminConfig;
      cityAdministrationService = new CityAdministrationService({
        config: cityOptions,
        cities: typeof cityOptions.readCities === 'function' ? cityOptions.readCities() : warAdapters.readCities(),
        constructionDefinitions: cityOptions.constructionDefinitions || constructionConfig.definitions || [],
        camps: cityOptions.camps || [],
        playerResources: cityOptions.playerResources || null,
        now: cityAdminConfig.now || clockNow,
        getDay: cityAdminConfig.getDay || defaultGetDay,
        onEvent: cityAdminConfig.onEvent
      });
    }

    const reputationConfig = config.reputation || null;
    const reputationSystem = reputationConfig
      ? new ReputationSystem({
        config: reputationConfig.config || reputationConfig,
        onEvent: reputationConfig.onEvent,
        state: reputationConfig.state || null
      })
      : null;

    const battleSettlementConfig = config.battleSettlement || null;
    let battleSettlementService = null;
    if (battleSettlementConfig) {
      battleSettlementService = new BattleSettlementService({
        config: battleSettlementConfig.config || battleSettlementConfig,
        now: battleSettlementConfig.now || clockNow,
        getDay: battleSettlementConfig.getDay || defaultGetDay,
        rng: battleSettlementConfig.rng,
        readArmy: battleSettlementConfig.readArmy
          || (armyId => foodLedgerSystem?.getArmy?.(armyId) || armyLogisticsAdapter.readArmy(armyId)),
        writeArmy: battleSettlementConfig.writeArmy || ((armyId, army) => {
          if (foodLedgerSystem) foodLedgerSystem.registerArmy(army);
          return armyLogisticsAdapter.writeArmy(armyId, army);
        }),
        readLedger: battleSettlementConfig.readLedger || warAdapters.readLedger,
        writeLedger: battleSettlementConfig.writeLedger || warAdapters.writeLedger,
        addScattered: battleSettlementConfig.addScattered || (entry => {
          if (!foodLedgerSystem) return false;
          const day = Number(entry?.day) || defaultGetDay();
          foodLedgerSystem.scatteredPool.push({
            armyId: String(entry?.armyId || ''),
            count: Math.max(0, Math.floor(Number(entry?.count) || 0)),
            day,
            expiresDay: day + Math.max(1, Number(foodLedgerSystem.config.regroupWindowDays) || 30)
          });
          return true;
        }),
        addSupplyCache: battleSettlementConfig.addSupplyCache || null,
        adjustReputation: battleSettlementConfig.adjustReputation
          || (payload => reputationSystem?.adjust?.(payload) || null),
        onEvent: battleSettlementConfig.onEvent
      });
    }

    const battleEntryConfig = config.battleEntry || null;
    const battleEntryService = battleEntryConfig
      ? new BattleEntryService({
        config: battleEntryConfig.config || battleEntryConfig,
        now: battleEntryConfig.now || clockNow,
        onEvent: battleEntryConfig.onEvent
      })
      : null;

    if (foodLedgerSystem) scene.foodLedgerSystem = foodLedgerSystem;
    if (cityAdministrationService) scene.cityAdministrationService = cityAdministrationService;
    if (reputationSystem) scene.reputationSystem = reputationSystem;
    if (battleSettlementService) scene.battleSettlementService = battleSettlementService;
    if (battleEntryService) scene.battleEntryService = battleEntryService;

    this._registerWarLogisticsCommands({
      foodLedgerSystem,
      cityAdministrationService,
      battleSettlementService,
      battleEntryService,
      reputationSystem
    });
    if (foodLedgerSystem && typeof scene.sceneRuntime?.registerSnapshotProvider === 'function') {
      this._registerWarLogisticsSnapshot(foodLedgerSystem, {
        cityAdministrationService,
        battleSettlementService,
        reputationSystem
      });
    }

    // 倒地掉落 + 敌对 NPC 拾取（M3 3D）：CombatSystem 单点钩子触发，掉落/夺回/到期为纯领域服务。
    const downedDropConfig = config.downedDrop || null;
    let downedDropService = null;
    let lootPickupBehavior = null;
    if (downedDropConfig) {
      const pickupConfig = downedDropConfig.config || downedDropConfig;
      downedDropService = new DownedDropService({
        config: pickupConfig,
        rng: downedDropConfig.rng,
        getDay: downedDropConfig.getDay || (() => Number(scene.gameLoader?.blackboard?.get?.('storyState')?.day) || 1),
        resolveItem: downedDropConfig.itemResolver || downedDropConfig.resolveItem,
        createGroundDrop: request => this._createDownedGroundDrop(request),
        removeGroundDrop: entity => scene.entityStore?.remove?.(entity),
        publishEvent: (event, payload, options) => scene.publishApplicationEvent?.(event, payload, options)
      });
      lootPickupBehavior = new LootPickupBehavior({
        radius: Number(pickupConfig.npcPickupRadius) || undefined,
        maxCarried: Number(pickupConfig.npcMaxCarried) || undefined,
        isHostile: npc => isHostileTarget(scene.playerEntity, npc),
        publishEvent: (event, payload, operationId) => scene.publishApplicationEvent?.(event, payload, operationId ? { operationId } : undefined)
      });
      scene.downedDropService = downedDropService;
      scene.lootPickupBehavior = lootPickupBehavior;
      this._downedDropService = downedDropService;
      this._lootPickupBehavior = lootPickupBehavior;
      scene.combatSystem.setDownedDropCallback(({ player, deathEvent }) => {
        const cause = player?.plotCause === 'story'
          || deathEvent?.cause === 'story'
          || scene.isPlayerDowned?.() === true
          ? 'story'
          : 'combat';
        return downedDropService.dropAll({ player, cause });
      });
      this._registerDownedDropCommands(downedDropService);
    }

    const vehicleConfig = config.vehicles || {};
    const vehicleSystem = new VehicleSystem({
      resolveEntity: vehicleConfig.resolveEntity,
      findSafeDismountPosition: vehicleConfig.findSafeDismountPosition
        || (request => this._findSafeDismountPosition(request)),
      onEvent: vehicleConfig.onVehicleEvent
    });
    const moveIntentRouter = (rider, intent) => (
      vehicleSystem.routeIntent(rider, intent) || { target: 'self', role: null, intent }
    );
    scene.movementSystem?.setMoveIntentRouter?.(moveIntentRouter);

    const vehicleLogisticsSystem = new VehicleLogisticsSystem({
      inventoryTransactions: scene.inventoryTransactions,
      getInventoryOwnerId: vehicleConfig.getInventoryOwnerId,
      createCheckpoint: vehicleConfig.createCheckpoint,
      onEvent: vehicleConfig.onLogisticsEvent,
      maxOperations: vehicleConfig.maxOperations
    });
    const mannedStructureAdapter = new MannedStructureAdapter({
      vehicleSystem,
      onEvent: vehicleConfig.onMannedStructureEvent
    });

    scene.classSystem = classSystem;
    scene.proficiencySystem = proficiencySystem;
    scene.constructionSystem = constructionSystem;
    scene.productionSystem = productionSystem;
    scene.vehicleSystem = vehicleSystem;
    scene.vehicleLogisticsSystem = vehicleLogisticsSystem;
    scene.mannedStructureAdapter = mannedStructureAdapter;
    if (supplySystem) scene.supplySystem = supplySystem;
    if (convoySystem) scene.convoySystem = convoySystem;
    if (companionSystem) scene.companionSquadSystem = companionSystem;
    if (armyOrderSystem) scene.armyOrderSystem = armyOrderSystem;

    const sharedSystems = Object.freeze({
      classSystem,
      proficiencySystem,
      constructionSystem,
      productionSystem,
      supplySystem,
      convoySystem,
      companionSquadSystem: companionSystem,
      armyOrderSystem,
      vehicleSystem,
      vehicleLogisticsSystem,
      mannedStructureAdapter
    });
    const facade = Object.freeze({ getSystems: () => sharedSystems });
    if (supplySystem) this._registerSupplyCommands(supplySystem);
    if (convoySystem) this._registerConvoyCommands(convoySystem);
    if (companionSystem) this._registerCompanionCommands(companionSystem);
    if (armyOrderSystem) this._registerArmyOrderCommands(armyOrderSystem);
    const abilityPlan = this.configureAbilities({
      skillRegistry: config.skillRegistry,
      effectResolver
    });
    const registrations = [
      { name: 'gameplay.classes', instance: classSystem, options: { order: 500, updateHook: false, disposeHook: false, ownership: 'OWNED' } },
      { name: 'gameplay.proficiency', instance: proficiencySystem, options: { order: 501, updateHook: false, disposeHook: false, ownership: 'OWNED' } },
      { name: 'gameplay.construction', instance: constructionSystem, options: { order: 502, updateHook: false, disposeHook: false, ownership: 'OWNED' } },
      {
        name: 'gameplay.production',
        instance: productionSystem,
        options: {
          order: 506,
          updateHook: deltaTime => productionSystem.update(deltaTime),
          disposeHook: () => {
            productionSystem.pending?.clear?.();
            productionSystem.onEvent = () => {};
          },
          ownership: 'OWNED'
        }
      },
      {
        name: 'gameplay.mannedStructure',
        instance: mannedStructureAdapter,
        options: {
          order: 503,
          phase: 'postScene',
          updateHook: () => mannedStructureAdapter.syncAll(),
          disposeHook: () => mannedStructureAdapter.structures?.clear?.(),
          ownership: 'OWNED'
        }
      },
      {
        name: 'gameplay.vehicle',
        instance: vehicleSystem,
        options: {
          order: 504,
          phase: 'postScene',
          updateHook: deltaTime => vehicleSystem.update(deltaTime),
          disposeHook: () => {
            vehicleSystem.vehicles?.clear?.();
            vehicleSystem.resolveEntity = () => null;
            vehicleSystem.onEvent = () => {};
          },
          ownership: 'OWNED'
        }
      },
      {
        name: 'gameplay.vehicleLogistics',
        instance: vehicleLogisticsSystem,
        options: {
          order: 505,
          updateHook: false,
          disposeHook: () => {
            vehicleLogisticsSystem.onEvent = () => {};
            vehicleLogisticsSystem.getInventoryOwnerId = null;
            vehicleLogisticsSystem.createCheckpoint = async () => false;
          },
          ownership: 'OWNED'
        }
      },
      ...(supplySystem
        ? [{
          name: 'gameplay.supply',
          instance: supplySystem,
          options: {
            order: 507,
            updateHook: false,
            disposeHook: () => {
              supplySystem.onEvent = () => {};
              supplySystem.orders?.clear?.();
              supplySystem.operations?.clear?.();
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(convoySystem
        ? [{
          name: 'gameplay.convoy',
          instance: convoySystem,
          options: {
            order: 508,
            updateHook: false,
            disposeHook: () => {
              convoySystem.onEvent = () => {};
              convoySystem.convoys?.clear?.();
              convoySystem.operations?.clear?.();
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(companionSystem
        ? [{
          name: 'gameplay.companion',
          instance: companionSystem,
          options: {
            order: 509,
            updateHook: false,
            disposeHook: () => {
              companionSystem.onEvent = () => {};
              companionSystem.spawnMember = null;
              companionSystem.reinforcements = [];
              if (companionFlow) {
                companionFlow.hud.visible = false;
                companionFlow.system = null;
              }
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(armyOrderSystem
        ? [{
          name: 'gameplay.armyOrder',
          instance: armyOrderSystem,
          options: {
            order: 510,
            updateHook: false,
            disposeHook: () => {
              armyOrderSystem.onEvent = () => {};
              armyOrderSystem.states?.clear?.();
              armyOrderSystem.deployLocks?.clear?.();
              if (armyOrderFlow) {
                armyOrderFlow.system = null;
                armyOrderFlow.marchExecutor = null;
              }
              // 4C：场景释放时同步摘掉遭遇解析器，避免任务/面板持有悬空实例
              if (scene.encounterResolver === encounterResolver) scene.encounterResolver = null;
              if (scene.context?.services?.encounterResolver === encounterResolver) {
                delete scene.context.services.encounterResolver;
              }
              // 4A：逻辑路径层与执行器随场景释放（快照/预览缓存一并失效）
              scene.worldRouteLayer = null;
              scene.worldMarchExecutor = null;
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(downedDropService
        ? [{
          name: 'gameplay.downedDrop',
          instance: downedDropService,
          options: {
            order: 511,
            updateHook: deltaTime => this._updateDownedDrop(deltaTime),
            disposeHook: () => {
              downedDropService.createGroundDrop = null;
              downedDropService.removeGroundDrop = null;
              downedDropService.publishEvent = null;
              scene.combatSystem?.setDownedDropCallback?.(null);
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(lootPickupBehavior
        ? [{
          name: 'gameplay.lootPickup',
          instance: lootPickupBehavior,
          options: {
            order: 512,
            updateHook: false,
            disposeHook: () => {
              lootPickupBehavior.publishEvent = null;
              lootPickupBehavior.isHostile = () => false;
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(foodLedgerSystem
        ? [{
          name: 'gameplay.logistics',
          instance: foodLedgerSystem,
          options: {
            order: 513,
            updateHook: false,
            disposeHook: () => {
              foodLedgerSystem.onEvent = () => {};
              foodLedgerSystem.autoResupply = null;
              foodLedgerSystem.armies?.clear?.();
              foodLedgerSystem.camps?.clear?.();
              foodLedgerSystem.scatteredPool = [];
              foodLedgerSystem.appliedOperations?.clear?.();
              scene.syncFoodLedgerArmies = null;
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(cityAdministrationService
        ? [{
          name: 'gameplay.cityAdmin',
          instance: cityAdministrationService,
          options: {
            order: 514,
            updateHook: false,
            disposeHook: () => {
              cityAdministrationService.onEvent = () => {};
              cityAdministrationService.cities?.clear?.();
              cityAdministrationService.camps?.clear?.();
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(battleSettlementService
        ? [{
          name: 'gameplay.battleSettlement',
          instance: battleSettlementService,
          options: {
            order: 515,
            updateHook: false,
            disposeHook: () => {
              battleSettlementService.onEvent = () => {};
              battleSettlementService.readArmy = null;
              battleSettlementService.writeArmy = null;
              battleSettlementService.readLedger = null;
              battleSettlementService.writeLedger = null;
              battleSettlementService.addScattered = null;
              battleSettlementService.addSupplyCache = null;
              battleSettlementService.adjustReputation = null;
              battleSettlementService.ledgers?.clear?.();
              battleSettlementService.supplyCaches?.clear?.();
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(reputationSystem
        ? [{
          name: 'gameplay.reputation',
          instance: reputationSystem,
          options: {
            order: 516,
            updateHook: false,
            disposeHook: () => {
              reputationSystem.onEvent = () => {};
              reputationSystem.byFaction?.clear?.();
              reputationSystem.byCity?.clear?.();
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(battleEntryService
        ? [{
          name: 'gameplay.battleEntry',
          instance: battleEntryService,
          options: {
            order: 517,
            updateHook: false,
            disposeHook: () => {
              battleEntryService.onEvent = () => {};
              battleEntryService.sessions?.clear?.();
            },
            ownership: 'OWNED'
          }
        }]
        : []),
      ...(abilityPlan?.registrations || [])
    ];
    const fields = {
      classes: 'classSystem', proficiency: 'proficiencySystem', construction: 'constructionSystem',
      production: 'productionSystem',
      supply: 'supplySystem', convoy: 'convoySystem', companionSquad: 'companionSquadSystem',
      armyOrder: 'armyOrderSystem',
      downedDrop: 'downedDropService', lootPickup: 'lootPickupBehavior',
      logistics: 'foodLedgerSystem', cityAdmin: 'cityAdministrationService',
      battleSettlement: 'battleSettlementService', reputation: 'reputationSystem',
      battleEntry: 'battleEntryService',
      vehicle: 'vehicleSystem', vehicleLogistics: 'vehicleLogisticsSystem',
      mannedStructure: 'mannedStructureAdapter'
    };
    const projections = [];
    for (const [contextKey, sceneKey] of Object.entries(fields)) {
      const instance = scene[sceneKey];
      if (!instance) continue;
      projections.push({ target: scene.context?.systems, key: contextKey, instance });
      projections.push({ target: scene, key: sceneKey, instance });
    }
    projections.push(...(abilityPlan?.projections || []));
    projections.push({ target: scene.context?.services, key: 'sharedGameplay', instance: facade });

    // 3D 可选快照：旧档缺该 provider 时 required:false 放行；恢复只补偿黑板空态，避免双写。
    if (armyOrderSystem && typeof scene.sceneRuntime?.registerSnapshotProvider === 'function') {
      scene.sceneRuntime.registerSnapshotProvider('gameplay.armyStrategic', {
        required: false,
        snapshot: () => ({ schemaVersion: 1, armyStates: armyOrderSystem.serialize() }),
        validate: data => (data === undefined || data === null || typeof data === 'object'
          ? { ok: true }
          : { ok: false, code: 'invalidArmyStrategic' }),
        restore: data => {
          const board = scene.gameLoader?.blackboard;
          if (board?.get?.('armyStates')) return { ok: true, skipped: true };
          const snapshot = data?.armyStates;
          return snapshot ? armyOrderSystem.restore(snapshot) : { ok: true };
        }
      });
    }

    // 生产快照：可选 provider——旧档缺 `gameplay.production` 段不拒档；
    // 有该段时恢复工单/预扣凭证/工位占用，成品入库仍由场景事务完成（不重复扣料、不重复产出）。
    if (typeof scene.sceneRuntime?.registerSnapshotProvider === 'function') {
      const productionProvider = createProductionSnapshotProvider(productionSystem, {
        resolveInventory: id => this._resolveInventory(id)
      });
      if (productionProvider) {
        scene.sceneRuntime.registerSnapshotProvider('gameplay.production', productionProvider);
      }
    }

    return Object.freeze({
      id: 'gameplay-shared',
      systems: sharedSystems,
      registrations: Object.freeze(registrations),
      projections: Object.freeze(projections.filter(item => item.target)),
      disposers: Object.freeze([{
        label: 'injected-links',
        dispose: () => {
          if (scene.movementSystem?.moveIntentRouter === moveIntentRouter) {
            scene.movementSystem.setMoveIntentRouter(null);
          }
          scene.gatheringSystem?.setEffectResolver?.(null);
          scene.gatheringSystem?.setSettlementPolicy?.(null);
          scene.inventoryTransactions?.configureEffects?.({ effectResolver: null, getEntityId: null });
        }
      }])
    });
  }

  /**
   * 倒地掉落命令（M3 3D）：`inventory.dropAll`。剧情脚本人为触发时传 `cause:'story'` 走豁免。
   * @private
   */
  _registerDownedDropCommands(downedDropService) {
    const scene = this.scene;
    this._registerSceneCommand('inventory.dropAll', {
      execute: command => {
        const payload = command?.payload || {};
        return downedDropService.dropAll({
          player: scene.playerEntity || null,
          cause: payload.cause === 'story' ? 'story' : 'combat',
          position: payload.position || null
        });
      }
    });
  }

  /**
   * 3D 帧驱动（250ms 节流）：日界变化清理过期掉落 + 敌对 NPC 拾取玩家掉落。
   * 未接线时不产生任何副作用。
   * @private
   */
  _updateDownedDrop(deltaTime) {
    const service = this._downedDropService;
    const behavior = this._lootPickupBehavior;
    if (!service || !behavior) return;
    this._downedTick += Math.max(0, Number(deltaTime) || 0);
    if (this._downedTick < 0.25) return;
    this._downedTick = 0;
    const scene = this.scene;
    const groundItems = scene.entityStore?.equipmentItems || [];
    const day = Number(service.getDay()) || 0;
    if (day !== this._downedDropDay) {
      this._downedDropDay = day;
      service.expire({ day, drops: groundItems.filter(entity => entity?.downedDrop === true) });
    }
    behavior.update({
      npcs: scene.entityStore?.enemies || [],
      groundItems,
      removeGroundItem: entity => scene.entityStore?.remove?.(entity)
    });
  }

  /**
   * 倒地掉落地面投影：复用物品运行时投影链（与战斗战利品同管线），额外发布 item.dropped 供任务/表现消费。
   * @private
   */
  _createDownedGroundDrop({ entityId, runtimeState, transform }) {
    const scene = this.scene;
    let entity = null;
    try {
      entity = scene.itemRuntimeFactory?.createGroundDropProjection?.({ entityId, runtimeState, transform });
    } catch (error) {
      console.warn('SceneGameplaySystemAssembler: 倒地掉落投影失败', error);
      return null;
    }
    if (!entity) return null;
    scene.entityStore?.add?.(entity);
    scene.entityStore?.addEquipmentItem?.(entity);
    void scene.publishApplicationEvent?.('item.dropped', {
      entityId: entity.id,
      groundId: entity.id,
      definitionId: runtimeState?.definitionId || null,
      quantity: Math.max(1, Math.floor(Number(runtimeState?.quantity) || 1)),
      position: { x: transform?.x || 0, y: transform?.y || 0 },
      reason: 'downedDrop'
    }, { operationId: `downed-drop-revealed:${entity.id}` });
    return entity;
  }

  /** 默认在载具四周寻找首个可通行下车点；具体导航策略仍可由调用方覆盖。 @private */
  _findSafeDismountPosition({ rider, vehicle, fallback } = {}) {
    const transform = vehicle?.getComponent?.('transform');
    const movementSystem = this.scene.context?.systems?.movement || this.scene.movementSystem;
    if (!transform || typeof movementSystem?.canMoveTo !== 'function') return fallback;
    const candidates = [
      [40, 0], [-40, 0], [0, 40], [0, -40],
      [56, 56], [-56, 56], [56, -56], [-56, -56]
    ];
    for (const [dx, dy] of candidates) {
      const x = transform.position.x + dx;
      const y = transform.position.y + dy;
      if (movementSystem.canMoveTo(x, y, rider)) return { x, y };
    }
    return fallback;
  }

  /**
   * 默认工位解析：只在「已建成且耐久 > 0」的营建结构上找 station。
   * 未接线时生产系统按 stationUnavailable 返回（零回归）。
   * @private
   */
  _resolveConstructionStation(constructionSystem, stationId) {
    const stationKey = typeof stationId === 'string' ? stationId.trim() : '';
    if (!stationKey || !constructionSystem) return { ok: false, code: 'stationUnavailable' };
    for (const structure of constructionSystem.structures.values()) {
      if (!structure || structure.status !== 'completed' || Number(structure.durability) <= 0) continue;
      const definition = constructionSystem.definitions.get(structure.definitionId);
      const station = (definition?.stations || []).find(entry => entry.id === stationKey);
      if (station) {
        return {
          ok: true,
          station,
          definitionId: definition.id,
          entityId: structure.siteId,
          durability: structure.durability
        };
      }
    }
    return { ok: false, code: 'stationUnavailable' };
  }

  /**
   * 配给命令：UI 与触发器共用同一入口，handler 只做参数取用与背包解析。
   * @private
   */
  _registerSupplyCommands(supplySystem) {
    const scene = this.scene;
    const register = (type, handler) => this._registerSceneCommand(type, {
      execute: command => handler(command?.payload || {})
    });
    register('supply.open', payload => supplySystem.open({
      cityId: payload.cityId,
      characterId: payload.characterId || scene.playerEntity?.id,
      rank: payload.rank
    }));
    register('supply.requisition', payload => {
      const characterId = payload.characterId || scene.playerEntity?.id;
      return supplySystem.requisition({
        cityId: payload.cityId,
        characterId,
        rank: payload.rank,
        items: payload.items,
        destination: payload.destination || 'personal',
        inventory: this._resolveInventory(payload.inventoryId || `${characterId}:inventory`),
        operationId: payload.operationId
      });
    });
    register('supply.cancel', payload => supplySystem.cancel({
      orderId: payload.orderId,
      operationId: payload.operationId
    }));
  }

  /**
   * 押运命令：装配/装车/出发/指令/卸货/伏击结算/追回。
   * @private
   */
  _registerConvoyCommands(convoySystem) {
    const scene = this.scene;
    const register = (type, handler) => this._registerSceneCommand(type, {
      execute: command => handler(command?.payload || {})
    });
    register('convoy.assemble', payload => convoySystem.assemble({
      templateId: payload.templateId,
      convoyId: payload.convoyId,
      vehicleEntityId: payload.vehicleEntityId,
      cargoId: payload.cargoId || (payload.vehicleEntityId ? `${payload.vehicleEntityId}:cargo` : null),
      escortIds: payload.escortIds,
      vehicleDefinitionId: payload.vehicleDefinitionId,
      position: payload.position,
      spawnPosition: payload.spawnPosition,
      vehicleRadius: payload.vehicleRadius,
      operationId: payload.operationId
    }));
    register('convoy.load', payload => convoySystem.load(payload));
    register('convoy.dispatch', payload => convoySystem.dispatch(payload));
    register('convoy.order', payload => convoySystem.setOrder(payload));
    register('convoy.resolveAmbush', payload => convoySystem.resolveAmbush(payload));
    register('convoy.recover', payload => convoySystem.recover(payload));
    register('convoy.unload', payload => {
      const characterId = payload.characterId || scene.playerEntity?.id;
      const inventory = payload.target === 'stash'
        ? null
        : this._resolveInventory(payload.inventoryId || `${characterId}:inventory`);
      return convoySystem.unload({ ...payload, inventory });
    });
  }

  /**
   * 随行小队命令（模块 3 3A）：编入/遣返/五档/休整/驻扎/阵亡上报。
   * 士气与档位的最终裁决在 CompanionSquadSystem；本层只做命令转译与入档触发。
   * @private
   */
  _registerCompanionCommands(companionSystem) {
    const scene = this.scene;
    const register = (type, handler) => this._registerSceneCommand(type, {
      execute: command => handler(command?.payload || {})
    });
    const persist = () => scene.companionSquadFlow?.requestPersist?.();
    register('companion.assign', payload => {
      const result = companionSystem.assign(payload.unitIds || [], { morale: payload.morale });
      if (result.ok) persist();
      return result;
    });
    register('companion.dismiss', payload => {
      const result = companionSystem.dismiss(payload.unitIds || []);
      if (result.ok) persist();
      return result;
    });
    register('companion.stance', payload => {
      const result = companionSystem.setStance(payload.stance);
      if (result.ok) persist();
      return result;
    });
    register('companion.rest', payload => {
      const result = companionSystem.rest(payload.day);
      if (result.ok) persist();
      return result;
    });
    register('companion.camp', payload => {
      const result = companionSystem.camp(payload.day);
      if (result.ok) persist();
      return result;
    });
    register('companion.reportDowned', payload => {
      const result = companionSystem.reportMemberDowned(payload.unitId, {
        battleId: payload.battleId,
        hpRatio: payload.hpRatio
      });
      if (result.ok) persist();
      return result;
    });
    register('companion.battleResult', payload => companionSystem.reportBattleResult({
      battleId: payload.battleId,
      victory: payload.victory
    }));
  }

  /**
   * 世界逻辑路径规划（4A）：起点=军团当前位置最近节点，终点=指令目标吸附节点。
   * 只读 `WorldRouteLayer` 快照，任何不可达以 `{ok:false, code}` 拒绝下令（不扣士气）。
   * @private
   */
  _planWorldRoute(layer, { state, target, point }) {
    const origin = layer.findNearestNode(state?.position, { maxDistance: 320 });
    if (!origin) return { ok: false, code: 'unknownNode' };
    const destinationId = layer.resolveTarget(target ?? point ?? null, { maxSnapDistance: 320 });
    if (!destinationId) return { ok: false, code: 'unknownNode' };
    const path = layer.shortestPath(origin.nodeId, destinationId);
    if (!path?.ok) return { ok: false, code: path?.code || 'noPath' };
    const points = path.nodeIds
      .map(nodeId => layer.getNode(nodeId)?.position)
      .filter(Boolean)
      .map(position => ({ x: Number(position.x), y: Number(position.y) }));
    let totalDistance = 0;
    for (let index = 1; index < points.length; index++) {
      totalDistance += Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y
      );
    }
    return {
      ok: true,
      nodeIds: path.nodeIds,
      edgeIds: path.edgeIds,
      points,
      totalDistance,
      revision: layer.revision
    };
  }

  /** 节点控制方：cityStates（ref.id 绑定）→ armyStates kind='pass' → 定义归属。 */
  _worldNodeFaction(scene, nodeId) {
    const logic = scene.worldRouteLayer?.logic;
    const nodes = Array.isArray(logic?.nodes) ? logic.nodes : [];
    const node = nodes.find(entry => String(entry?.id) === String(nodeId)) || null;
    if (!node) return null;
    const refId = node.ref?.id != null
      ? String(node.ref.id)
      : (node.kind === 'city' ? String(nodeId) : null);
    const cityStates = scene.gameLoader?.blackboard?.get?.('cityStates');
    const city = refId && Array.isArray(cityStates)
      ? cityStates.find(entry => String(entry?.id) === refId)
      : null;
    if (city?.factionId != null) return String(city.factionId);
    if (node.kind === 'pass') {
      const passState = scene.armyOrderSystem?.getUnit?.(String(nodeId));
      if (passState?.factionId != null) return String(passState.factionId);
    }
    return node.ownerFactionId != null ? String(node.ownerFactionId) : null;
  }

  /**
   * scene 维度幂等命令注册（先撤后注册，不跳过）。
   * 重复装配时撤销本装配器上次登记的句柄，保证命令指向本次重建的系统实例；
   * 其他 owner 占名时仍由 registerCommandHandler 抛 duplicate，不静默抢占。
   * @private
   */
  _registerSceneCommand(commandType, handler) {
    const runtime = this.scene?.sceneRuntime;
    if (typeof runtime?.registerCommandHandler !== 'function') return null;
    const previous = this._sceneCommandOffs.get(commandType);
    if (previous) {
      try {
        previous();
      } catch (error) {
        console.warn(`[SceneGameplaySystemAssembler] 撤销旧命令句柄失败: ${commandType}`, error);
      }
      this._sceneCommandOffs.delete(commandType);
    }
    const off = runtime.registerCommandHandler(commandType, handler);
    this._sceneCommandOffs.set(commandType, off);
    return off;
  }

  /**
   * 世界逻辑层命令桥（4A）：world.route.preview / world.route.invalidate / world.unit.teleport。
   * 预览与失效都只落到 `WorldRouteLayer`，UI 端不持有第二份通行判定。
   * @private
   */
  _registerWorldRouteCommands(layer) {
    const scene = this.scene;
    const register = (type, handler) => this._registerSceneCommand(type, {
      execute: command => handler(command?.payload || {})
    });
    register('world.route.preview', payload => ({
      ok: true,
      preview: layer.buildPreview(payload.region || {}),
      revision: layer.revision
    }));
    register('world.route.invalidate', payload => {
      const revision = layer.invalidate(payload.reason || 'command');
      scene.armyOrderFlow?.requestPersist?.();
      return { ok: true, revision };
    });
    register('world.unit.teleport', payload => {
      const nodeId = layer.resolveTarget(payload.nodeId ?? payload.target ?? null, {
        maxSnapDistance: payload.maxSnapDistance
      });
      if (!nodeId) return { ok: false, code: 'unknownNode' };
      const position = layer.getNode(nodeId)?.position || null;
      const state = payload.unitId ? scene.armyOrderSystem?.getUnit?.(payload.unitId) : null;
      if (state && position) {
        state.position = { x: Number(position.x), y: Number(position.y) };
        scene.armyOrderFlow?.requestPersist?.();
      }
      return { ok: true, nodeId, position };
    });
    // 4C：四选确认（撞见后由玩家/UI 明确选择才结算）
    register('world.encounter.decide', payload => scene.armyOrderFlow?.decideEncounter?.({
      unitId: payload.unitId,
      encounterId: payload.encounterId ?? null,
      choice: payload.choice,
      reason: payload.reason || 'command'
    }) || { ok: false, code: 'encounterUnavailable' });
  }

  /**
   * 武装单位战略指令命令桥（M3 3B）：unit.order / unit.order.cancel / unit.setFormation /
   * army.deploy.commit / army.deploy.temp / battle.deploy.lock / unit.battleOrder /
   * army.form / army.disband。全部透传 operationId（幂等由领域层记账）。
   * @private
   */
  _registerArmyOrderCommands(armyOrderSystem) {
    const scene = this.scene;
    const register = (type, handler) => this._registerSceneCommand(type, {
      execute: command => handler(command?.payload || {})
    });
    const persist = result => {
      if (result?.ok) scene.armyOrderFlow?.requestPersist?.();
      return result;
    };
    register('unit.order', payload => persist(armyOrderSystem.issueOrder({
      unitId: payload.unitId || payload.armyId,
      order: payload.order,
      target: payload.target ?? null,
      issuedDay: payload.issuedDay ?? null,
      operationId: payload.operationId ?? null
    })));
    register('unit.order.cancel', payload => persist(armyOrderSystem.cancelOrder({
      unitId: payload.unitId || payload.armyId,
      operationId: payload.operationId ?? null
    })));
    register('unit.setFormation', payload => persist(armyOrderSystem.setFormation({
      unitId: payload.unitId || payload.armyId,
      formationId: payload.formationId,
      battleId: payload.battleId ?? null,
      operationId: payload.operationId ?? null
    })));
    register('army.deploy.commit', payload => persist(armyOrderSystem.commitDeployment({
      unitId: payload.unitId || payload.armyId,
      roster: payload.roster ?? null,
      formationId: payload.formationId,
      commanderSlot: payload.commanderSlot,
      deputySlots: payload.deputySlots,
      battleId: payload.battleId ?? null,
      operationId: payload.operationId ?? null
    })));
    register('army.deploy.temp', payload => persist(armyOrderSystem.applyTempDeployment({
      battleId: payload.battleId ?? null,
      unitId: payload.unitId || payload.armyId,
      roster: payload.roster ?? null,
      formationId: payload.formationId,
      commanderSlot: payload.commanderSlot,
      deputySlots: payload.deputySlots,
      setAsDefault: payload.setAsDefault === true,
      operationId: payload.operationId ?? null
    })));
    register('battle.deploy.lock', payload => persist(armyOrderSystem.lockDeployment({
      battleId: payload.battleId ?? null,
      unitIds: payload.unitIds ?? null,
      operationId: payload.operationId ?? null
    })));
    register('unit.battleOrder', payload => persist(armyOrderSystem.issueBattleOrder({
      unitId: payload.unitId || payload.armyId,
      battleId: payload.battleId ?? null,
      kind: payload.kind || 'stance',
      stance: payload.stance ?? null,
      targetId: payload.targetId ?? null,
      operationId: payload.operationId ?? null
    })));
    register('army.form', payload => persist(armyOrderSystem.registerUnit(payload)));
    register('army.disband', payload => persist(armyOrderSystem.disbandUnit(
      payload.unitId || payload.armyId
    )));
  }

  /**
   * 军需体系命令注册（M6/M7/M9）。
   * 领域服务自身保持纯领域；这里只做「命令 → 服务调用 → 黑板镜像 → 展示回写」。
   * @private
   */
  _registerWarLogisticsCommands({
    foodLedgerSystem = null,
    cityAdministrationService = null,
    battleSettlementService = null,
    battleEntryService = null,
    reputationSystem = null
  } = {}) {
    const scene = this.scene;
    const services = {
      foodLedger: foodLedgerSystem,
      cityAdmin: cityAdministrationService,
      battleSettlement: battleSettlementService,
      reputation: reputationSystem
    };
    const register = (type, handler) => this._registerSceneCommand(type, {
      execute: command => handler(command?.payload || {})
    });
    const sync = () => {
      if (foodLedgerSystem) scene.syncFoodLedgerArmies?.();
      return this._syncWarLogisticsState(services);
    };
    const ensureArmy = armyId => {
      if (!foodLedgerSystem || !armyId) return false;
      if (foodLedgerSystem.getArmy(armyId)) return true;
      const army = this._armyLogisticsAdapter?.readArmy?.(armyId);
      if (!army) return false;
      foodLedgerSystem.registerArmy(army);
      return true;
    };
    const guard = (service, code) => (service ? null : { ok: false, code });

    // 9B：军营存取（幂等 operationId 由调用方透传）
    register('army.supply.deposit', payload => {
      const missing = guard(foodLedgerSystem, 'logisticsUnavailable');
      if (missing) return missing;
      ensureArmy(payload.armyId);
      const result = foodLedgerSystem.deposit({
        armyId: payload.armyId,
        campId: payload.campId,
        entries: payload.entries ?? null,
        operationId: payload.operationId ?? null
      });
      if (result?.ok) sync();
      return result;
    });
    register('army.supply.withdraw', payload => {
      const missing = guard(foodLedgerSystem, 'logisticsUnavailable');
      if (missing) return missing;
      ensureArmy(payload.armyId);
      const result = foodLedgerSystem.withdraw({
        armyId: payload.armyId,
        campId: payload.campId,
        entries: payload.entries ?? null,
        operationId: payload.operationId ?? null
      });
      if (result?.ok) sync();
      return result;
    });
    // 9C：烧掠与抢掠
    register('army.raze', payload => {
      const missing = guard(foodLedgerSystem, 'logisticsUnavailable');
      if (missing) return missing;
      const target = payload.target
        || (payload.targetId != null ? foodLedgerSystem.camps.get(String(payload.targetId)) : null);
      const result = foodLedgerSystem.raze({
        target,
        night: payload.night === true,
        defended: payload.defended === true,
        defenderWins: payload.defenderWins === true,
        hasFireSource: payload.hasFireSource === true,
        operationId: payload.operationId ?? null
      });
      if (result?.ok) sync();
      return result;
    });
    register('army.forage', payload => {
      const missing = guard(foodLedgerSystem, 'logisticsUnavailable');
      if (missing) return missing;
      const result = foodLedgerSystem.forage({
        armyId: payload.armyId,
        operationId: payload.operationId ?? null
      });
      if (result?.ok) {
        const cost = Number(result.renownCost ?? 0);
        if (cost > 0) reputationSystem?.adjust?.({ delta: -cost, reason: 'forage' });
        sync();
      }
      return result;
    });
    register('army.regroup', payload => {
      const missing = guard(foodLedgerSystem, 'logisticsUnavailable');
      if (missing) return missing;
      const result = foodLedgerSystem.regroup({
        armyId: payload.armyId,
        day: payload.day ?? null
      });
      if (result?.ok) sync();
      return result;
    });

    // 7：城镇内政
    register('city.recruit', payload => {
      const missing = guard(cityAdministrationService, 'cityAdminUnavailable');
      if (missing) return missing;
      return cityAdministrationService.recruit({
        cityId: payload.cityId,
        fromCampId: payload.fromCampId ?? null,
        unitType: payload.unitType ?? null,
        count: payload.count ?? 0,
        partySpace: payload.partySpace ?? null
      });
    });
    register('city.attack', payload => {
      const missing = guard(cityAdministrationService, 'cityAdminUnavailable');
      if (missing) return missing;
      return cityAdministrationService.orderAttack({
        cityId: payload.cityId,
        target: payload.target ?? null,
        hasArmy: payload.hasArmy !== false
      });
    });
    register('city.transport', payload => {
      const missing = guard(cityAdministrationService, 'cityAdminUnavailable');
      if (missing) return missing;
      return cityAdministrationService.orderTransport({
        cityId: payload.cityId,
        target: payload.target ?? null,
        items: payload.items ?? null
      });
    });
    register('city.siege.begin', payload => {
      const missing = guard(cityAdministrationService, 'cityAdminUnavailable');
      if (missing) return missing;
      return cityAdministrationService.beginSiege({
        cityId: payload.cityId,
        byFactionId: payload.byFactionId ?? null,
        day: payload.day ?? null
      });
    });
    register('city.capture', payload => {
      const missing = guard(cityAdministrationService, 'cityAdminUnavailable');
      if (missing) return missing;
      const result = cityAdministrationService.captureCity({
        cityId: payload.cityId,
        factionId: payload.factionId ?? null,
        winnerCityId: payload.winnerCityId ?? null
      });
      if (result?.ok) sync();
      return result;
    });

    // 6：入场身份 / 战果（结算入口由场景战果卡调用）
    register('battle.entry.join', payload => {
      const missing = guard(battleEntryService, 'battleEntryUnavailable');
      if (missing) return missing;
      return battleEntryService.joinBattle({
        battleId: payload.battleId,
        armyId: payload.armyId ?? null,
        identity: payload.identity ?? null,
        mode: payload.mode ?? null,
        entry: payload.entry ?? 'ui',
        playerOnsite: payload.playerOnsite === true
      });
    });
    register('battle.entry.leave', payload => {
      const missing = guard(battleEntryService, 'battleEntryUnavailable');
      if (missing) return missing;
      return battleEntryService.leaveBattle({
        battleId: payload.battleId ?? null,
        reason: payload.reason ?? 'battleEnded',
        confirmed: payload.confirmed === true,
        playerOnsite: payload.playerOnsite === true
      });
    });
    register('battle.settle', payload => {
      const missing = guard(battleSettlementService, 'battleSettlementUnavailable');
      if (missing) return missing;
      const result = battleSettlementService.settleBattle(payload || {});
      if (result?.ok) sync();
      return result;
    });
    register('battle.supply.recover', payload => {
      const missing = guard(battleSettlementService, 'battleSettlementUnavailable');
      if (missing) return missing;
      const result = battleSettlementService.recoverSupply({
        cacheId: payload.cacheId ?? null,
        army: payload.army ?? null,
        armyId: payload.armyId ?? null
      });
      if (result?.ok) sync();
      return result;
    });
    register('battle.redeem', payload => {
      const missing = guard(battleSettlementService, 'battleSettlementUnavailable');
      if (missing) return missing;
      const result = battleSettlementService.redeem({
        army: payload.army ?? null,
        armyId: payload.armyId ?? null,
        heroId: payload.heroId ?? null,
        day: payload.day ?? null,
        force: payload.force === true
      });
      if (result?.ok) sync();
      return result;
    });

    // 7：军营粮草容器（容器注册表只在运行时可见，不写旧档 containerInventories 段）
    register('camp.register', payload => {
      const missing = guard(foodLedgerSystem, 'logisticsUnavailable');
      if (missing) return missing;
      if (payload?.campId == null) return { ok: false, code: 'campIdRequired' };
      const result = foodLedgerSystem.registerCamp({
        campId: payload.campId,
        level: payload.level ?? 1,
        stock: payload.stock ?? null
      });
      if (result?.ok !== false) {
        this.scene.syncCampContainers?.();
        sync();
      }
      return result;
    });
    register('camp.transfer', payload => {
      const missing = guard(foodLedgerSystem, 'logisticsUnavailable');
      if (missing) return missing;
      const adapter = this.scene.resolveCampContainer?.(payload?.campId);
      if (!adapter) return { ok: false, code: 'unknownCamp', campId: payload?.campId ?? null };
      const result = adapter.transfer({
        armyId: payload.armyId ?? null,
        direction: payload.direction === 'toInventory' ? 'toInventory' : 'toCargo',
        itemId: payload.itemId || 'resource.food',
        quantity: payload.quantity ?? 0,
        operationId: payload.operationId ?? null
      });
      if (result?.ok) sync();
      return result;
    });
  }

  /**
   * 军营粮草容器同步：账本里的每个军营一个易失容器适配器。
   * 幂等复用已建适配器；容器注册表可能晚于装配创建，因此每次同步都尝试登记。
   * @private
   */
  _syncCampContainers(foodLedgerSystem) {
    if (!foodLedgerSystem || !this._campContainers) return this._campContainers || new Map();
    const registry = this.scene.context?.services?.containerInventories;
    for (const camp of foodLedgerSystem.camps.values()) {
      const id = `camp:${camp.campId}`;
      let adapter = this._campContainers.get(id);
      if (!adapter) {
        adapter = new CampStockContainerAdapter({
          foodLedger: foodLedgerSystem,
          campId: camp.campId,
          nonce: this._campNonce
        });
        this._campContainers.set(id, adapter);
      }
      registry?.registerVolatile?.(id, adapter);
    }
    return this._campContainers;
  }

  /** 军需四本账 → 黑板 warState.logistics（checkpoint.warState 的正式落点）。 */
  _syncWarLogisticsState(services = {}) {
    const blackboard = this.scene.gameLoader?.blackboard;
    if (!blackboard) return false;
    return writeWarLogistics(blackboard, createWarLogisticsSnapshot({
      foodLedger: services.foodLedger || null,
      cityAdmin: services.cityAdmin || null,
      battleSettlement: services.battleSettlement || null,
      reputation: services.reputation || null
    }));
  }

  /**
   * 军需快照 provider：快照时镜像到 `warState.logistics`（随 checkpoint.warState 落盘），
   * 恢复时优先读黑板；旧档缺该段 → 空态放行，不拒档。
   * @private
   */
  _registerWarLogisticsSnapshot(foodLedgerSystem, services = {}) {
    const scene = this.scene;
    const all = {
      foodLedger: foodLedgerSystem,
      cityAdmin: services.cityAdministrationService || null,
      battleSettlement: services.battleSettlementService || null,
      reputation: services.reputationSystem || null
    };
    // 装配完成即回灌：覆盖「读档后场景重建、服务是新建实例」的路径。
    const existing = readWarLogistics(scene.gameLoader?.blackboard);
    if (existing) applyWarLogisticsSnapshot(existing, all);
    scene.syncCampContainers?.();

    scene.syncWarLogisticsState = () => this._syncWarLogisticsState(all);
    scene.sceneRuntime.registerSnapshotProvider('gameplay.warLogistics', {
      required: false,
      snapshot: () => {
        const snapshot = createWarLogisticsSnapshot(all);
        // 与 game 快照同点采集：先镜像，保证 checkpoint.warState 始终是最新值。
        writeWarLogistics(scene.gameLoader?.blackboard, snapshot);
        return snapshot;
      },
      validate: data => ({ ok: true, data }),
      restore: data => {
        const fromWarState = readWarLogistics(scene.gameLoader?.blackboard);
        const payload = fromWarState || (data && typeof data === 'object' ? data : null);
        const result = applyWarLogisticsSnapshot(payload, all);
        if (payload) writeWarLogistics(scene.gameLoader?.blackboard, payload);
        scene.syncCampContainers?.();
        return { ok: true, ...result };
      }
    });
  }

  /**
   * 3A 补位实体重生成适配器：随行成员实体被清理后，按首次登记时缓存的蓝图
   * （enemies 定义 id + 阵营 + 编组）经 EntityFactory 重建友军实体。
   * 定义/工厂缺失时返回 null（领域层保留待补位并记账，不抛错）。
   * @private
   */
  _spawnCompanionMember({ unitId, blueprint, position } = {}) {
    const scene = this.scene;
    if (!unitId) return null;
    const definition = blueprint?.definitionId
      ? scene.gameLoader?.getRegistry?.('enemies')?.get?.(blueprint.definitionId)
      : null;
    const factory = scene.entityFactory;
    if (!definition || typeof factory?.createEnemy !== 'function') return null;
    const entity = factory.createEnemy({
      ...JSON.parse(JSON.stringify(definition)),
      id: unitId,
      contentId: definition.id,
      templateId: definition.templateId || definition.id,
      position: position ? { x: position.x, y: position.y } : { x: 0, y: 0 },
      faction: blueprint.faction || 'ally'
    });
    if (!entity) return null;
    entity.faction = blueprint.faction || 'ally';
    entity.addComponent?.(new SquadMemberComponent({
      armyId: blueprint.squadMember?.armyId || 'companion',
      squadId: blueprint.squadMember?.squadId || 'companion',
      formationIndex: blueprint.squadMember?.formationIndex ?? 0
    }));
    entity.addComponent?.(new CommandStateComponent());
    if (typeof scene.entityStore?.addEnemy === 'function') scene.entityStore.addEnemy(entity);
    else scene.entityStore?.add?.(entity);
    return entity;
  }

  /**
   * 载具落点校验适配器（模块 3 §6.1）：复用移动系统的地形可通行判定
   * （map bounds / 楼层碰撞 / walkable shape，与跳跃落点修复同源）。
   * 无移动系统（纯测试/无地形场景）时原样放行。
   * @private
   */
  _resolveVehicleSpawnPosition(candidate, radius) {
    if (!candidate) return null;
    const movementSystem = this.scene.context?.systems?.movement || this.scene.movementSystem;
    if (typeof movementSystem?.canMoveTo !== 'function') return { x: candidate.x, y: candidate.y };
    return movementSystem.canMoveTo(candidate.x, candidate.y, null)
      ? { x: candidate.x, y: candidate.y }
      : null;
  }

  /**
   * 载具实体生成适配器（模块 3 3A 薄适配）：按 vehicles 定义经 EntityFactory 生成，
   * 挂入实体仓库与 VehicleSystem（货舱由定义 cargo 字段生成 CargoComponent）。
   * @private
   */
  _spawnConvoyVehicle({ definitionId, position, convoyId } = {}) {
    const scene = this.scene;
    const definition = scene.gameLoader?.getRegistry?.('vehicles')?.get?.(definitionId);
    if (!definition) return { ok: false, code: 'unknownVehicle' };
    const factory = scene.entityFactory;
    if (typeof factory?.createVehicle !== 'function') return { ok: false, code: 'vehicleSpawnUnavailable' };
    const entityId = `${convoyId}:vehicle`;
    const entity = factory.createVehicle({
      ...JSON.parse(JSON.stringify(definition)),
      id: entityId,
      position: { x: position.x, y: position.y },
      team: 'friendly'
    });
    if (!entity) return { ok: false, code: 'vehicleSpawnUnavailable' };
    entity.vehicleDefinitionId = definitionId;
    entity.sceneId = scene.currentSceneId || scene.sceneId || null;
    scene.entityStore?.add?.(entity);
    scene.context?.systems?.vehicle?.registerVehicle?.(entity);
    return {
      ok: true,
      vehicleEntityId: entity.id,
      cargoId: `${entity.id}:cargo`,
      position: { x: position.x, y: position.y }
    };
  }

  /**
   * 背包容器解析（供配给/押运命令使用，与 initialize 内的同款解析保持一致）。
   * @private
   */
  _resolveInventory(id) {
    const scene = this.scene;
    if (!id) return null;
    const containerInventory = scene.context?.services?.containerInventories?.resolve?.(id);
    if (containerInventory) return containerInventory;
    if (id === `${scene.playerEntity?.id}:inventory` || id === scene.playerEntity?.id) {
      return scene.playerEntity?.getComponent?.('inventory') || null;
    }
    const suffix = id.endsWith(':cargo') ? 'cargo' : (id.endsWith(':inventory') ? 'inventory' : null);
    const entityId = suffix ? id.slice(0, -(suffix.length + 1)) : id;
    const entity = scene.entityStore?.all?.find?.(item => item?.id === entityId)
      || (scene.playerEntity?.id === entityId ? scene.playerEntity : null);
    return entity?.getComponent?.(suffix || 'inventory') || null;
  }
}

export default SceneGameplaySystemAssembler;
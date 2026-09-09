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
import { AISystem } from '../../systems/AISystem.js';
import { CollisionSystem } from '../../systems/CollisionSystem.js';
import { PickupSystem } from '../../systems/PickupSystem.js';
import { InventoryTransactionService } from '../../systems/InventoryTransactionService.js';
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
import { MeditationSystem } from '../../systems/MeditationSystem.js';
import { MeleeAttackSystem } from '../../systems/MeleeAttackSystem.js';
import { ZoneEffectSystem } from '../../systems/ZoneEffectSystem.js';
import { FlightSystem } from '../../systems/FlightSystem.js';
import { JumpSystem } from '../../systems/JumpSystem.js';
import { JumpChargeController } from './JumpChargeController.js';
import { LocomotionSystem } from '../../systems/LocomotionSystem.js';
import { ClassSystem } from '../../systems/ClassSystem.js';
import { ConstructionSystem } from '../../systems/ConstructionSystem.js';
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

export class SceneGameplaySystemAssembler {
  constructor(scene) {
    this.scene = scene;
    this._lootSequence = 0;
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
    scene.locomotionSystem = new LocomotionSystem({
      jumpSystem: scene.jumpSystem,
      flightSystem: scene.flightSystem,
      resolveClimbTarget: request => scene.resolveClimbTarget?.(request) || null
    });
    // 蓄力跳跃：松手时按蓄力时间决定落点距离并起跳（30~120px）。
    scene.jumpChargeController = new JumpChargeController({ now });
    scene.jumpChargeController.setJumpCallback(({ distance, holdMs }) => {
      const axis = scene.inputManager?.getMoveAxis?.() || { x: 0, y: 0, magnitude: 0 };
      const started = scene.jumpByDirection?.(axis.x || 0, axis.y || 0, distance) === true;
      return { started, distance, holdMs };
    });

    scene.combatSystem = new CombatSystem({
      inputManager: scene.inputManager,
      camera: scene.camera,
      skillEffects: scene.skillEffects,
      weaponRenderer: scene.weaponRenderer,
      enemyWeaponRenderer: scene.enemyWeaponRenderer,
      floatingTextManager: scene.floatingTextManager,
      now
    });
    scene.combatSystem.onMeditationSkill = skill => scene.onSkillClicked(skill);
    scene.combatSystem.onSkillAimRequest = index => scene.enterPCAimMode('skill', index);
    scene.combatSystem.setOnEnterCombat(() => {
      if (scene.meditationSystem?.isActive()) scene.meditationSystem.stop();
    });
    scene.combatSystem.onPotionUse = potionType => scene.usePotionFromHotbar(potionType);
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
      // 战斗状态不进行移动碰撞停顿/阻挡自动停止，保证战斗手感；战斗结束后恢复。
      combatLock: () => scene.combatSystem?.isInCombat?.() === true
    });
    scene.equipmentSystem = new EquipmentSystem();
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
      deltaTime => scene.corpseRuntime?.update?.(deltaTime)
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
          capacityMessages[result?.code] || result?.error?.message || result?.code || '拾取失败'
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
      revivePlayer: player => scene.combatSystem.revivePlayer(player),
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
            consequences: ['恢复全部生命与法力', '结算死亡资源损失', '死亡掉落留在原地']
          }]
        });
        return true;
      },
      onComplete: executePlayerDeath
    });
    scene.sceneRuntime?.onFramePhase?.(
      FramePhase.AFTER_SCENE,
      deltaTime => scene.playerDeathCountdown?.update(deltaTime)
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

    // 灵魂状态复活流程：普通死亡后保持可移动的灵魂状态，走到篝火复活圈内等待 20 秒。
    scene.playerSoulRespawn = new PlayerSoulRespawn({
      durationSeconds: 20,
      approachRadius: 150,
      reviveOffsetY: 46,
      getCampfirePosition: () => {
        const campfire = scene.context?.services?.campfire;
        return campfire?.isConfigured?.() === true ? campfire.getPosition() : null;
      },
      getSpawnPosition: () => scene.resolvePlayerRespawnPosition?.({}) || null,
      showTip: (text, options) => scene._showScreenTip?.(text, options),
      hideTip: () => scene._hintPresenter?.hideScreen?.('playerSoul'),
      onCountdown: (seconds, presentation) => scene.context?.services?.campfire
        ?.setRespawnCountdown?.(seconds, presentation),
      onSoulStateChange: active => {
        scene.playerSoulActive = active === true;
        if (active === true && scene.combatSystem?.isInCombat?.() === true) {
          scene.combatSystem.exitCombat();
        }
        if (typeof document !== 'undefined') {
          document.body.classList.toggle('soul-state', active === true);
        }
      },
      onComplete: ({ player, deathId, position }) => scene.playerDefeatService?.completeDeferredRespawn?.(player, deathId, position)
        || { ok: false, code: 'defeatServiceMissing' }
    });
    scene.sceneRuntime?.onFramePhase?.(
      FramePhase.AFTER_SCENE,
      deltaTime => scene.playerSoulRespawn?.update(deltaTime)
    );
    scene.sceneRuntime?.addDisposer?.(() => scene.playerSoulRespawn?.dispose?.(), 'player-soul-respawn');

    const resolveEntity = id => scene.entityStore?.all?.find?.(entity => entity?.id === id)
      || (scene.playerEntity?.id === id ? scene.playerEntity : null);
    const resolveInventory = id => {
      if (!id) return null;
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
    scene.toolRepairService = new ToolRepairService({
      inventoryTransactions: scene.inventoryTransactions,
      resolveActor: id => resolveEntity(id),
      resolveDefinition: id => scene.itemRuntimeFactory?.resolveDefinition?.(id)
        || scene.gameLoader?.definitionRepository?.get?.('items', id)
        || scene.gameLoader?.definitionRepository?.get?.('equipment', id)
        || scene.gameLoader?.registries?.items?.get?.(id)
        || null,
      createCheckpoint: checkpoint => scene.requestAutoSave?.({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: scene.currentSceneId
      })
    });
    scene.sceneRuntime?.registerCommandHandler?.('item.repair', scene.toolRepairService);
    for (const commandType of Object.values(ITEM_LIFECYCLE_COMMANDS)) {
      scene.sceneRuntime?.registerCommandHandler?.(commandType, scene.itemLifecycleService);
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
        void Promise.resolve(executePlayerDeath({ player, deathId, resolution })).catch(error => {
          console.warn('SceneGameplaySystemAssembler: 特殊昏迷结算失败', error);
        });
        return { ok: true, pending: true };
      }
      if (scene.playerSoulRespawn?.pending || scene.playerDeathCountdown?.pending) {
        return { ok: true, pending: true, idempotent: true };
      }
      // 普通死亡优先进入灵魂状态流程：立即结算掉落（deferRespawn），玩家走到篝火倒计时复活。
      const soulStarted = scene.playerSoulRespawn?.start({ player, deathId, resolution, deathEvent });
      if (soulStarted) {
        void Promise.resolve(executePlayerDeath({ player, deathId, resolution, deferRespawn: true })).catch(error => {
          console.warn('SceneGameplaySystemAssembler: 灵魂状态死亡结算失败', error);
        });
        return { ok: true, pending: true };
      }
      // 兜底：灵魂流程不可用时沿用原「倒计时 + 确认复活」
      const countdownStarted = scene.playerDeathCountdown?.start({
        player, deathId, resolution, deathEvent
      });
      if (countdownStarted) return { ok: true, pending: true };
      void Promise.resolve(executePlayerDeath({ player, deathId, resolution })).catch(error => {
        console.warn('SceneGameplaySystemAssembler: 普通死亡直接结算失败', error);
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
      ['gameplay.jumpCharge', scene.jumpChargeController, 'dispose'],
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
      flight: 'flightSystem', jump: 'jumpSystem', locomotion: 'locomotionSystem',
      playerDefeat: 'playerDefeatService', itemLifecycle: 'itemLifecycleService',
      toolRepair: 'toolRepairService',
      inventoryTransactions: 'inventoryTransactions'
    };
    const presentationFields = {
      combatEffects: 'combatEffects', skillEffects: 'skillEffects', weaponRenderer: 'weaponRenderer',
      enemyWeaponRenderer: 'enemyWeaponRenderer', particleSystem: 'particleSystem',
      floatingTextManager: 'floatingTextManager', effectZoneRenderer: 'effectZoneRenderer',
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
      validateSite: constructionConfig.validateSite,
      onEvent: constructionConfig.onEvent
    });
    const registered = constructionSystem.registerDefinitions(constructionConfig.definitions || []);
    const requiredProficiency = constructionConfig.requiredProficiencyType || null;
    if (!registered.ok || (requiredProficiency && !proficiencySystem.getDefinition?.(requiredProficiency))) {
      throw new Error(`Shared gameplay construction config invalid: ${registered.code || `missingProficiency:${requiredProficiency}`}`);
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
    scene.vehicleSystem = vehicleSystem;
    scene.vehicleLogisticsSystem = vehicleLogisticsSystem;
    scene.mannedStructureAdapter = mannedStructureAdapter;

    const sharedSystems = Object.freeze({
      classSystem,
      proficiencySystem,
      constructionSystem,
      vehicleSystem,
      vehicleLogisticsSystem,
      mannedStructureAdapter
    });
    const facade = Object.freeze({ getSystems: () => sharedSystems });
    const abilityPlan = this.configureAbilities({
      skillRegistry: config.skillRegistry,
      effectResolver
    });
    const registrations = [
      { name: 'gameplay.classes', instance: classSystem, options: { order: 500, updateHook: false, disposeHook: false, ownership: 'OWNED' } },
      { name: 'gameplay.proficiency', instance: proficiencySystem, options: { order: 501, updateHook: false, disposeHook: false, ownership: 'OWNED' } },
      { name: 'gameplay.construction', instance: constructionSystem, options: { order: 502, updateHook: false, disposeHook: false, ownership: 'OWNED' } },
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
      ...(abilityPlan?.registrations || [])
    ];
    const fields = {
      classes: 'classSystem', proficiency: 'proficiencySystem', construction: 'constructionSystem',
      vehicle: 'vehicleSystem', vehicleLogistics: 'vehicleLogisticsSystem',
      mannedStructure: 'mannedStructureAdapter'
    };
    const projections = [];
    for (const [contextKey, sceneKey] of Object.entries(fields)) {
      projections.push({ target: scene.context?.systems, key: contextKey, instance: scene[sceneKey] });
      projections.push({ target: scene, key: sceneKey, instance: scene[sceneKey] });
    }
    projections.push(...(abilityPlan?.projections || []));
    projections.push({ target: scene.context?.services, key: 'sharedGameplay', instance: facade });

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
}

export default SceneGameplaySystemAssembler;
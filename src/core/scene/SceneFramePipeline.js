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

import { FramePhase } from './GameSceneRuntime.js';

const COLLISION_POSITION_EPSILON_SQUARED = 0.0001;

function capturePosition(entity) {
  const position = entity?.getComponent?.('transform')?.position;
  return position ? { x: position.x, y: position.y } : null;
}

function positionChanged(before, entity) {
  if (!before) return false;
  const position = entity?.getComponent?.('transform')?.position;
  if (!position) return false;
  const dx = position.x - before.x;
  const dy = position.y - before.y;
  return dx * dx + dy * dy > COLLISION_POSITION_EPSILON_SQUARED;
}

/**
 * SceneFramePipeline - 游戏场景帧更新编排（框架级）
 *
 * 完整保留 BaseGameScene.update 的既有执行顺序、输入消费时机及转场提前返回。
 * 同时在准确的旧调用位置调度 GameSceneRuntime 阶段；运行时未注册系统前
 * 不会改变原有系统链或输入清帧时机。
 */
export class SceneFramePipeline {
  /** @param {{scene:Object, context?:Object, hooks?:Object}|Object} config */
  constructor(config) {
    this.scene = config?.scene || config;
    this.context = config?.context || this.scene?.context || null;
    this.hooks = config?.hooks || {};
    this._onThrownWeaponHit = (enemy, isFinalTarget) => this._handleThrownWeaponHit(enemy, isFinalTarget);
  }

  /**
   * 执行一个场景更新帧。
   * @param {number} deltaTime
   */
  run(deltaTime) {
    const scene = this.scene;
    const context = this.context || scene.context || null;
    const services = context?.services || {};
    const systems = context?.systems || {};
    const presentation = context?.presentation || {};
    const entities = context?.entities?.all || [];
    const player = context?.player?.entity || null;
    const inputManager = context?.input?.manager || null;
    const camera = context?.camera?.instance || null;
    const abilitySystem = systems.ability;
    const combatSystem = systems.combat;
    const movementSystem = systems.movement;
    const equipmentSystem = systems.equipment;
    const aiSystem = systems.ai;
    const collisionSystem = systems.collision;
    const pickupSystem = systems.pickup;
    const gatheringSystem = systems.gathering;
    const gatheringPuppetSystem = systems.gatheringPuppet;
    const meditationSystem = systems.meditation;
    const zoneEffectSystem = systems.zoneEffect;
    const meleeAttackSystem = systems.meleeAttack;
    const flightSystem = systems.flight;
    const jumpSystem = systems.jump;
    const locomotionSystem = systems.locomotion;
    const combatEffects = presentation.combatEffects;
    const skillEffects = presentation.skillEffects;
    const weaponRenderer = presentation.weaponRenderer;
    const enemyWeaponRenderer = presentation.enemyWeaponRenderer;
    const particleSystem = presentation.particleSystem;
    const floatingTextManager = presentation.floatingTextManager;
    const effectZoneRenderer = presentation.effectZoneRenderer;
    const inputFlow = services.input;
    const hudUpdater = services.hud;
    const runtime = context?.runtime?.sceneRuntime || null;
    if (!scene.isActive) return;
    if (scene.isPaused) {
      scene.discardPausedInput?.();
      return;
    }
    const frameProfile = scene.debugMode === true && scene._framePerformanceProfile?.current
      ? scene._framePerformanceProfile.current
      : null;
    let phaseStartedAt = frameProfile ? performance.now() : 0;
    const frameToken = runtime?.beginFrame?.() || null;

    // 帧管线只调用 Runtime 阶段入口；兼容 Scene 字段不再参与生命周期调度。
    runtime?.runFramePhase?.(FramePhase.BEFORE_INPUT, deltaTime, { scene, frameToken });

    // 顶层输入流程保证手柄帧首 poll、弹窗优先于战斗，并统一路由输入。
    // DataDriven 子场景若已在 super.update 前开始本帧，内部守卫会跳过重复编排。
    inputFlow?.beforeFrame(deltaTime);
    const worldInputBlocked = inputFlow?.isWorldInputBlocked?.() === true;
    // isPlayerActionLocked 含战斗状态（用于禁用采集等动作），但战斗只锁定动作、不能冻结移动，
    // 否则怪物一出现进入战斗后玩家会被排除在移动更新外而直接卡住。打坐/采集中仍冻结移动。
    const inCombat = scene.combatSystem?.isInCombat?.() === true;
    const playerActionLocked = scene.isPlayerActionLocked?.() === true && !inCombat;

    // 技能轮盘只冻结世界模拟，不能使用 isPaused，否则下一帧无法读取 LB 松开沿。
    if (scene.isSkillWheelWorldPaused) {
      if (inputFlow) inputFlow.flush();
      else if (runtime) runtime.flushInput({ frameToken });
      else inputManager?.update?.();
      return;
    }

    // jump/攀爬由 SceneInputFlow → InputActionRouter 的 SKILL 优先级统一消费。

    // 运行时优先输入阶段保留旧扩展 hook 的准确位置。
    runtime?.runFramePhase?.(FramePhase.PRIORITY_INPUT, deltaTime, { scene, frameToken });
    if (frameProfile) {
      const now = performance.now();
      frameProfile.updateFrameInput = now - phaseStartedAt;
      phaseStartedAt = now;
    }

    // 性能 HUD 或显式 P6.2 采样激活时才读取高精度时钟。
    const monitorEnabled = scene.performanceMonitor?.enabled === true
      || scene.performanceMonitor?.measurement?.status === 'running';
    const updateStartTime = monitorEnabled ? performance.now() : 0;

    // 调试：输出update调用
    if (scene._debugNextUpdate) {
      console.log('【更新】update方法被调用, deltaTime=', deltaTime);
      scene._debugNextUpdate = false;
    }

    // 更新场景过渡
    if (scene.isTransitioning) {
      scene.updateTransition(deltaTime);
      // 过渡期间不更新其他逻辑
      if (scene.transitionPhase === 'show_text' || scene.transitionPhase === 'switch_scene') {
        inputFlow?.releaseFrame?.();
        return;
      }
    }

    // 更新性能优化器
    scene.performanceOptimizer.update();

    // 更新空间分区网格
    scene.performanceOptimizer.updateSpatialGrid(entities);

    // 更新武器渲染器的鼠标角度（保留用于攻击范围计算）
    if (weaponRenderer && player && inputManager) {
      const mouseWorldPos = inputManager.getMouseWorldPosition(camera);
      const transform = player.getComponent('transform');
      if (transform) {
        const currentTime = performance.now() / 1000;
        const sprite = player.getComponent('sprite');
        const spriteHeight = sprite?.height || 64;
        const playerCenter = {
          x: transform.position.x,
          y: transform.position.y - spriteHeight / 2
        };
        weaponRenderer.updateMouseAngle(mouseWorldPos, playerCenter, currentTime);

        // PC：按下 Ctrl 进入轻功瞄准、Shift 进入投掷瞄准（随后左键确认）
        if (!playerActionLocked && !worldInputBlocked && !scene.isMobileLayout) {
          if (inputManager.isKeyPressed('ctrl')) {
            scene.enterPCAimMode('flight');
          } else if (inputManager.isKeyPressed('shift')) {
            scene.enterPCAimMode('throw');
          }
        }

        // PC 瞄准模式：领域硬锁或模态 UI 接管时取消，避免按住输入在弹窗后继续释放。
        if (playerActionLocked || worldInputBlocked) {
          scene.cancelPCAimMode?.();
        } else {
          if (services.skills) services.skills.updatePCAimMode();
          else scene.updatePCAimMode();

          // 拾取已由 SceneInputFlow/InputActionRouter 在攻击优先级之前统一分发。
          meleeAttackSystem?.setPlayerEntity?.(player);
          meleeAttackSystem?.setEntities?.(entities);
          meleeAttackSystem?.update?.(mouseWorldPos, playerCenter, currentTime);
        }
      }
    }

    if (frameProfile) {
      const now = performance.now();
      frameProfile.updateFramePreparation = now - phaseStartedAt;
      phaseStartedAt = now;
    }

    // 更新所有实体
    // 运行时系统阶段按 frame token 去重；旧 ECS 更新顺序保持在下方。
    runtime?.runFramePhase?.(FramePhase.SYSTEMS, deltaTime, {
      scene,
      frameToken,
      updateSystems: true
    });
    abilitySystem?.update?.(deltaTime, entities);
    gatheringSystem?.update?.(deltaTime);
    gatheringPuppetSystem?.update?.(deltaTime);
    for (const entity of entities) {
      entity.update(deltaTime);
      const resourceNode = entity.getComponent?.('resourceNode');
      if (resourceNode?.updateRefresh?.(deltaTime) === true) {
        services.placements?.addPendingResourceNodeState?.(entity.id, resourceNode.serialize());
      }
    }
    if (frameProfile) {
      const now = performance.now();
      frameProfile.updateFrameEntities = now - phaseStartedAt;
      phaseStartedAt = now;
    }

    // UI 点击处理
    if (services.worldInteraction) services.worldInteraction.handleUIClick();
    else scene.handleUIClick();

    // 右键移动的正式落点反馈（绿色光圈）
    if (inputManager.isMouseClicked() &&
        inputManager.getMouseButton() === 2 &&
        !inputManager.isMouseClickHandled()) {
      if (services.worldInteraction) services.worldInteraction.showRightClickFeedback();
      else scene._showRightClickFeedback();
    }

    // 旧的 Ctrl+左键瞬移已改为：按 Ctrl 进入轻功瞄准、左键确认（见 updatePCAimMode）
    // scene.handleTeleport();

    // HUD 冷却集中由 SceneHudUpdater 读取显式 UI/System 依赖。
    hudUpdater?.updateCooldowns();

    // 更新攀爬等统一位移执行器；Jump/Flight 保持各自既有更新顺序。
    locomotionSystem?.update?.(deltaTime);

    // 蓄力跳跃：空格/Y 保持时由对应设备连续更新目标；虚拟跳跃按钮进入点选模式。
    // 手柄用左摇杆更新相对落点，PC 用鼠标位置更新落点；触屏点选由 AIMING 优先级确认。
    const keyboardJumpHeld = scene.inputManager?.isKeyDown?.('space') === true;
    const gamepadJumpHeld = scene.inputManager?.isKeyDown?.('jump') === true;
    const touchJumpHeld = scene._jumpHeld === true;
    const jumpHeld = !worldInputBlocked && (keyboardJumpHeld || touchJumpHeld || gamepadJumpHeld);
    const jumpAxis = worldInputBlocked || !gamepadJumpHeld
      ? null
      : (scene.inputManager?.getMoveAxis?.() || null);
    const jumpTargetPosition = worldInputBlocked || gamepadJumpHeld || (!keyboardJumpHeld && !touchJumpHeld)
      ? null
      : scene.inputManager?.getMouseWorldPosition?.(camera) || null;
    scene.jumpChargeController?.update?.({
      held: jumpHeld,
      actor: player,
      direction: jumpAxis,
      targetPosition: jumpTargetPosition,
      blocked: worldInputBlocked
        || scene.playerEntity?.isDead === true
        || scene.dialogueSystem?.isDialogueActive?.() === true
        || scene.meditationSystem?.isActive?.() === true
    });

    // 更新跳跃系统（先于普通移动；MovementSystem 会跳过正在跳跃的实体）
    if (jumpSystem && player) {
      jumpSystem.update(deltaTime);
    }

    // 更新轻功飞行系统
    if (flightSystem && player) {
      flightSystem.update(deltaTime, player);
    }

    // 更新移动系统：模态 UI、打坐或采集只锁玩家，AI/其他实体继续移动。
    // 灵魂状态只绕过领域硬锁；模态 UI 仍必须阻止方向键/摇杆穿透。
    const soulMovementAllowed = player?.isSoulState === true;
    let movementResult;
    if ((worldInputBlocked || meditationSystem.isActive()
      || (playerActionLocked && !soulMovementAllowed)) && player) {
      // 锁定期间复用非玩家实体列表；实体数组或玩家变化时才重建，避免每帧 filter 分配。
      if (scene._meditationEntitySource !== entities ||
          scene._meditationEntityCount !== entities.length ||
          scene._meditationPlayer !== player) {
        scene._meditationEntitySource = entities;
        scene._meditationEntityCount = entities.length;
        scene._meditationPlayer = player;
        scene._meditationMovableEntities = entities.filter(entity => entity !== player);
      }
      movementResult = movementSystem.update(deltaTime, scene._meditationMovableEntities);

      // 移动中断检测由 meditationSystem.update 处理
    } else {
      // 正常更新所有实体
      movementResult = movementSystem.update(deltaTime, entities);
    }

    const contactWasLocked = movementSystem.isContactMovementLocked?.(player) === true;
    const beforeEntityCollision = capturePosition(player);
    // 检查实体之间的碰撞
    collisionSystem.update(entities);
    const pushedByEntity = positionChanged(beforeEntityCollision, player);

    const beforeTerrainCollision = capturePosition(player);
    // 检查地形碰撞（编辑器场景有 terrain 时生效）
    scene.checkTerrainCollision();
    const pushedByTerrain = positionChanged(beforeTerrainCollision, player);

    // 已处于碰撞停顿且本帧再次被推出时固定玩家和镜头锚点；碰撞器仍可把其他实体推出。
    if (contactWasLocked && (pushedByEntity || pushedByTerrain)) {
      movementSystem.restoreContactLockAnchor?.(player);
    }
    const movementContact = movementResult?.playerBlocked === true || pushedByEntity || pushedByTerrain;
    if (movementContact && player) {
      // 只有地形/静态障碍/重规划失败才累计“被障碍持续阻挡”的自动停止时长；
      // 实体（怪物/敌人）顶撞属于动态碰撞，不算障碍，避免怪物一出现就把玩家“卡住”。
      // 同时战斗状态不累计，防止战前/战中的单帧时序滞后触发自动停止。
      const obstacleBlocked = movementResult?.playerBlocked === true || pushedByTerrain;
      if (obstacleBlocked && combatSystem?.isInCombat?.() !== true) {
        movementSystem._accumulateBlockedTime?.(player, deltaTime);
      }
    } else if (player && combatSystem?.isInCombat?.() !== true) {
      // 本帧未被静态障碍阻挡（或仅被怪物顶撞），清除残留的自动停止累计，
      // 避免障碍消失（怪物移开等）后玩家仍被“卡住”直到松开方向键。
      movementSystem._clearBlockedAccumulator?.(player);
    }
    // 非战斗碰撞只走既有的接触停顿和自动停止，不再执行自动 A* 重规划。
    // 战斗状态不启动碰撞停顿，移动保持即时响应，战斗结束后恢复。
    // 仅地形/静态障碍顶撞才触发碰撞停顿；实体（怪物/NPC）顶撞不算，避免怪物一出现就卡住玩家。
    const obstacleContact = movementResult?.playerBlocked === true || pushedByTerrain;
    movementSystem.setMovementContact?.(
      player,
      obstacleContact && combatSystem?.isInCombat?.() !== true
    );

    // 玩家与实体位置已完成本帧移动和碰撞修正后再更新相机，
    // 避免相机长期落后一帧并放大不均匀 deltaTime 造成的画面跳动。
    camera.update(deltaTime);

    // 相机后处理钩子（子类可覆盖，如限制相机在大地图边缘）
    scene.postCameraUpdate();
    if (frameProfile) {
      const now = performance.now();
      frameProfile.updateFrameMovementCollision = now - phaseStartedAt;
      phaseStartedAt = now;
    }

    // 处理敌人选中
    scene.handleEnemySelection();

    // 更新AI系统（使用节流）
    if (scene.performanceOptimizer.shouldUpdate('ai')) {
      aiSystem.update(deltaTime, entities, combatSystem);
    }

    // 更新战斗系统
    combatSystem.update(deltaTime, entities);

    // 更新战斗状态（通过 CombatSystem）
    combatSystem.updateCombatState(deltaTime, entities);

    // 更新打坐状态（通过冥想系统）
    meditationSystem.update(deltaTime, player);

    // 更新区域效果（Buff 多边形）
    if (zoneEffectSystem) {
      // 延迟收集 buffZone（terrain 异步加载完成后）
      if (!scene._buffZonesCollected) {
        scene._collectBuffZones();
      }
      zoneEffectSystem.update(deltaTime, entities);
    }

    // 更新装备系统
    equipmentSystem.update(deltaTime, entities);
    if (frameProfile) {
      const now = performance.now();
      frameProfile.updateFrameAiCombat = now - phaseStartedAt;
      phaseStartedAt = now;
    }

    // 更新序章系统
    scene.tutorialSystem.update(deltaTime, scene.getGameState());
    scene.dialogueSystem.update(deltaTime);
    // 任务状态只能由 Authority command 驱动；过期检查同样通过 quest.expire command 提交。
    // 数据驱动触发器（timer 类）——仅当场景调用过 initGameLoader 才存在
    if (scene.gameLoader) scene.gameLoader.update(deltaTime);
    if (frameProfile) {
      const now = performance.now();
      frameProfile.updateFrameGameplay = now - phaseStartedAt;
      phaseStartedAt = now;
    }

    // 更新特效（使用节流）
    if (scene.performanceOptimizer.shouldUpdate('effects')) {
      combatEffects.update(deltaTime);
      skillEffects.update(deltaTime);
    }
    floatingTextManager.update(deltaTime);
    if (scene.notificationSystem) scene.notificationSystem.update(deltaTime * 1000);
    const particleProfile = scene.debugMode === true && scene._framePerformanceProfile?.current
      ? scene._framePerformanceProfile.current
      : null;
    const particleUpdateStartedAt = particleProfile ? performance.now() : 0;
    particleSystem.update(deltaTime);
    if (particleProfile) {
      particleProfile.particleUpdate = performance.now() - particleUpdateStartedAt;
      particleProfile.activeParticles = particleSystem.getActiveCount?.() || 0;
    }
    // 特效区域粒子生成
    if (effectZoneRenderer) {
      const effectZoneStartedAt = particleProfile ? performance.now() : 0;
      effectZoneRenderer.update(deltaTime);
      if (particleProfile) {
        particleProfile.effectZoneEmit = performance.now() - effectZoneStartedAt;
        particleProfile.effectZones = effectZoneRenderer.getZoneCount?.() || 0;
      }
    }

    // 更新武器渲染器
    if (weaponRenderer) {
      const currentTime = performance.now() / 1000; // 转换为秒
      weaponRenderer.update(deltaTime, currentTime);
    }

    // 更新敌人武器渲染器
    if (enemyWeaponRenderer) {
      enemyWeaponRenderer.update(deltaTime);

      // 检查武器飞行路径上的碰撞
      if (weaponRenderer?.thrownWeapon.flying) {
        weaponRenderer.checkThrowPathCollision(entities, this._onThrownWeaponHit);
      }

      // 检查武器拾取
      if (weaponRenderer?.isWeaponThrown() && !weaponRenderer.thrownWeapon.flying) {
        pickupSystem.checkWeaponPickup(player);
      }
    }
    if (frameProfile) {
      const now = performance.now();
      frameProfile.updateFrameEffects = now - phaseStartedAt;
      phaseStartedAt = now;
    }

    // 对话输入在系统更新后消费，保持打字机和选项节点原有顺序。
    if (inputFlow) inputFlow.afterSystems();
    else if (services.dialogue) services.dialogue.checkContinue();
    else scene.checkDialogueContinue();

    // HUD 面板和对话框状态集中更新；小地图仍在实体清理后刷新。
    hudUpdater?.updatePanels(deltaTime);
    hudUpdater?.updateDialogue(deltaTime);

    // 普通拾取已由 SceneInputFlow 的 PICKUP 处理者完成；这里不再轮询 E，
    // 避免同一输入在路由和旧系统路径中重复结算。

    // 移除死亡实体
    scene.removeDeadEntities();

    // 更新小地图数据（玩家、敌人、相机和多 terrain 缓存）。
    hudUpdater?.updateMinimap(deltaTime);

    // 输入清帧必须保持在原有的正常帧末尾；转场提前返回路径只 releaseFrame。
    runtime?.runFramePhase?.(FramePhase.AFTER_SCENE, deltaTime, { scene, frameToken });
    if (inputFlow) inputFlow.flush();
    else if (runtime) runtime.flushInput({ frameToken });
    else inputManager.update();

    // 性能监控关闭时不做计时、可见实体裁剪、纹理遍历和对象池快照。
    if (monitorEnabled) {
      const updateTime = performance.now() - updateStartTime;
      scene.performanceMonitor.update(deltaTime, {
        entityCount: entities.length,
        visibleEntityCount: scene.isometricRenderer ? scene.isometricRenderer.cullEntities(entities).length : 0,
        particleCount: particleSystem.getActiveCount(),
        poolStats: scene.performanceOptimizer.getPoolStats(),
        updateTime,
        drawCallsPerFrame: scene._drawCallCount || 0,
        textureMemory: scene._estimateTextureMemory()
      });
    }
    if (frameProfile) {
      frameProfile.updateFrameUiCleanup = performance.now() - phaseStartedAt;
    }
  }

  /** 稳定的投掷命中回调，避免飞行期间每帧创建闭包。 @private */
  _handleThrownWeaponHit(enemy, isFinalTarget) {
    const scene = this.scene;
    const context = this.context || scene.context || null;
    const player = context?.player?.entity || null;
    const combatSystem = context?.systems?.combat || null;
    const floatingTextManager = context?.presentation?.floatingTextManager || null;
    const stats = player?.getComponent('stats');
    const playerTransform = player?.getComponent('transform');
    const enemyTransform = enemy?.getComponent('transform');
    if (!stats || !playerTransform || !enemyTransform) return;

    const multiplier = isFinalTarget ? 3 : 0.3;
    const finalDamage = Math.floor((stats.attack || 15) * multiplier);
    const dx = enemyTransform.position.x - playerTransform.position.x;
    const dy = enemyTransform.position.y - playerTransform.position.y;
    const distance = Math.hypot(dx, dy);
    // CombatSystem 可能保留该对象用于本次结算，不能跨命中复用可变对象。
    const knockbackDirection = distance > 0
      ? { x: dx / distance, y: dy / distance }
      : { x: 1, y: 0 };

    combatSystem.applyDamage(enemy, finalDamage, knockbackDirection, '投掷武器', {
      sourceEntity: player,
      attackKind: 'throw'
    });
    floatingTextManager.addText(
      enemyTransform.position.x,
      enemyTransform.position.y - 60,
      isFinalTarget ? '投掷伤害 300%' : '投掷伤害 30%',
      isFinalTarget ? '#ff0000' : '#ffaa00'
    );
  }
}

export default SceneFramePipeline;

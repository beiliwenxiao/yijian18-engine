/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * MovementSystem.js
 * 移动系统 - 处理实体的移动逻辑
 */

import { PathfindingSystem } from './PathfindingSystem.js';

/**
 * 移动系统
 * 处理键盘移动、点击移动、碰撞检测和相机跟随
 */
export class MovementSystem {
  /**
   * @param {Object} config - 配置
   * @param {InputManager} config.inputManager - 输入管理器
   * @param {Camera} config.camera - 相机
   * @param {Object} config.mapBounds - 地图边界 {minX, minY, maxX, maxY}
   * @param {StatusEffectSystem} config.statusEffectSystem - 状态效果系统（可选）
   */
  constructor(config = {}) {
    this.inputManager = config.inputManager;
    this.camera = config.camera;
    this.statusEffectSystem = config.statusEffectSystem;
    this.jumpSystem = config.jumpSystem || null;
    this.isMovementLocked = typeof config.isMovementLocked === 'function'
      ? config.isMovementLocked
      : entity => this.jumpSystem?.isJumping?.(entity) === true;
    this.isMoveInputSuppressed = typeof config.isMoveInputSuppressed === 'function'
      ? config.isMoveInputSuppressed
      : () => false;
    this.moveIntentRouter = typeof config.moveIntentRouter === 'function'
      ? config.moveIntentRouter
      : null;
    const contactLockDuration = Number(config.contactLockDuration);
    this.contactLockDuration = Number.isFinite(contactLockDuration)
      ? Math.max(0.01, contactLockDuration)
      : 0.5;
    // 被障碍持续阻挡达到该时长（秒）后自动停止运动，需松开方向键才恢复。
    const blockedAutoStopDuration = Number(config.blockedAutoStopDuration);
    this.blockedAutoStopDuration = Number.isFinite(blockedAutoStopDuration)
      ? Math.max(0.2, blockedAutoStopDuration)
      : 1;
    // 战斗锁：战斗状态时不累计阻挡、不触发碰撞停顿，避免影响战斗手感。
    this.combatLock = typeof config.combatLock === 'function' ? config.combatLock : () => false;
    this._contactLocks = new WeakMap();
    this._blockedTotals = new WeakMap();
    this.pathfindingSystem = config.pathfindingSystem || new PathfindingSystem();
    this.pathfindingCellSize = Math.max(8, Number(config.pathfindingCellSize) || 32);
    this.pathfindingMaxVisited = Math.max(64, Number(config.pathfindingMaxVisited) || 2048);
    this.axisLookAheadDistance = Math.max(
      this.pathfindingCellSize * 4,
      Number(config.axisLookAheadDistance) || this.pathfindingCellSize * 6
    );
    this.rerouteCooldownDuration = Math.max(0.05, Number(config.rerouteCooldownDuration) || 0.2);
    this.axisDirectionDotThreshold = Math.max(-1, Math.min(1,
      Number(config.axisDirectionDotThreshold) || 0.8
    ));
    this._navigationStates = new WeakMap();
    
    // 地图边界（默认无限大）
    this.mapBounds = config.mapBounds || {
      minX: -Infinity,
      minY: -Infinity,
      maxX: Infinity,
      maxY: Infinity
    };
    
    // 碰撞层数据（2D数组，true表示有障碍物）
    this.collisionMap = config.collisionMap || null;
    this.tileSize = config.tileSize || 32;

    // 多楼层支持
    /** @type {Map<string, any>} */
    this.floors = new Map();
    this.defaultFloorId = 'ground';
    this.interactKey = config.interactKey || 'e';
    
    // 玩家实体引用（用于相机跟随）
    this.playerEntity = null;
    
    console.log('MovementSystem: Initialized');
  }

  /**
   * 设置玩家实体
   * @param {Entity} entity - 玩家实体
   */
  setPlayerEntity(entity) {
    this.playerEntity = entity;
    
    // 设置相机跟随目标
    if (this.camera && entity) {
      const transform = entity.getComponent('transform');
      if (transform) {
        this.camera.setTarget(transform);
      }
    }
  }

  /**
   * 注入设备无关的移动 intent 路由。驾驶席可将同一输入转发到载具。
   * @param {Function|null} router
   */
  setMoveIntentRouter(router) {
    this.moveIntentRouter = typeof router === 'function' ? router : null;
  }

  _getNavigationState(entity, create = false) {
    let state = entity ? this._navigationStates.get(entity) : null;
    if (!state && create && entity) {
      state = {
        source: null,
        goal: null,
        direction: null,
        magnitude: 0,
        autoPathActive: false,
        rerouteCooldown: 0,
        generation: 0
      };
      this._navigationStates.set(entity, state);
    }
    return state || null;
  }

  _advanceNavigationState(entity, deltaTime) {
    const state = this._getNavigationState(entity);
    if (!state || state.rerouteCooldown <= 0) return;
    state.rerouteCooldown = Math.max(0,
      state.rerouteCooldown - Math.max(0, Number(deltaTime) || 0)
    );
  }

  _setAxisNavigationIntent(entity, movement, x, y, magnitude) {
    const length = Math.hypot(x, y);
    if (!entity || !movement || length <= 0 || magnitude <= 0) return { sameDirection: false, state: null };
    const direction = { x: x / length, y: y / length };
    const state = this._getNavigationState(entity, true);
    const sameDirection = state.source === 'axis' && state.direction
      && state.direction.x * direction.x + state.direction.y * direction.y >= this.axisDirectionDotThreshold;
    if (!sameDirection) {
      state.generation++;
      state.autoPathActive = false;
      state.rerouteCooldown = 0;
    }
    state.source = 'axis';
    state.goal = null;
    state.direction = direction;
    state.magnitude = magnitude;
    return { sameDirection, state };
  }

  _setPointerNavigationIntent(entity, goal) {
    if (!entity || !goal) return null;
    const state = this._getNavigationState(entity, true);
    state.source = 'pointer';
    state.goal = { x: goal.x, y: goal.y };
    state.direction = null;
    state.magnitude = 1;
    state.autoPathActive = false;
    state.rerouteCooldown = 0;
    state.generation++;
    return state;
  }

  _cancelNavigationIntent(entity, source = null) {
    const state = this._getNavigationState(entity);
    if (!state || (source && state.source !== source)) return false;
    this._navigationStates.delete(entity);
    return true;
  }

  /**
   * 玩家在非战斗接触障碍后，按最近一次统一移动 intent 进行一次有界 A* 重规划。
   * @returns {boolean} 是否已提交自动绕行路径
   */
  tryRerouteAfterContact(entity, { inCombat = false, isBlocked = null } = {}) {
    if (!entity || inCombat || typeof isBlocked !== 'function'
      || this.isContactMovementLocked(entity) || !this.pathfindingSystem) return false;
    const transform = entity.getComponent?.('transform');
    const movement = entity.getComponent?.('movement');
    const state = this._getNavigationState(entity);
    if (!transform || !movement || !state?.source || state.rerouteCooldown > 0) return false;

    const start = { x: transform.position.x, y: transform.position.y };
    let goal = state.goal;
    if (state.source === 'axis' && state.direction) {
      goal = {
        x: start.x + state.direction.x * this.axisLookAheadDistance,
        y: start.y + state.direction.y * this.axisLookAheadDistance
      };
    }
    if (!goal) return false;

    const distance = Math.hypot(goal.x - start.x, goal.y - start.y);
    const margin = Math.max(this.pathfindingCellSize * 4,
      Math.min(384, distance * 0.35 + this.pathfindingCellSize * 2));
    const bounds = {
      minX: Number.isFinite(this.mapBounds.minX)
        ? Math.max(this.mapBounds.minX, Math.min(start.x, goal.x) - margin)
        : Math.min(start.x, goal.x) - margin,
      minY: Number.isFinite(this.mapBounds.minY)
        ? Math.max(this.mapBounds.minY, Math.min(start.y, goal.y) - margin)
        : Math.min(start.y, goal.y) - margin,
      maxX: Number.isFinite(this.mapBounds.maxX)
        ? Math.min(this.mapBounds.maxX, Math.max(start.x, goal.x) + margin)
        : Math.max(start.x, goal.x) + margin,
      maxY: Number.isFinite(this.mapBounds.maxY)
        ? Math.min(this.mapBounds.maxY, Math.max(start.y, goal.y) + margin)
        : Math.max(start.y, goal.y) + margin
    };
    const path = this.pathfindingSystem.findPath({
      start,
      goal,
      bounds,
      isBlocked,
      cellSize: this.pathfindingCellSize,
      maxVisited: this.pathfindingMaxVisited,
      allowDiagonal: true
    });
    state.rerouteCooldown = this.rerouteCooldownDuration;
    if (!Array.isArray(path) || path.length === 0) return false;

    movement.setPath(path);
    const sprite = entity.getComponent?.('sprite');
    if (sprite && sprite.currentAnimation !== 'walk') sprite.playAnimation?.('walk');
    state.autoPathActive = true;
    return true;
  }

  /** 仅锁定实体移动，不影响攻击、交互或 UI。战斗状态视为未锁定，防止战前/战中卡住。 */
  isContactMovementLocked(entity) {
    if (this.combatLock()) return false;
    return Boolean(entity) && Number(this._contactLocks.get(entity)?.remaining) > 0;
  }

  _isEntityMovementLocked(entity) {
    return this.isContactMovementLocked(entity) || this.isMovementLocked(entity);
  }

  _stopEntityMovement(entity) {
    const movement = entity?.getComponent?.('movement');
    const sprite = entity?.getComponent?.('sprite');
    movement?.clearPath?.();
    movement?.stop?.(); // 清掉残余速度，彻底停止
    if (sprite?.useAnimatedSprite) sprite.setWalking(false);
    if (sprite && sprite.currentAnimation !== 'idle') sprite.playAnimation?.('idle');
  }

  _advanceContactLock(entity, deltaTime) {
    if (!entity) return;
    const state = this._contactLocks.get(entity);
    if (!state || state.remaining <= 0) return;
    state.remaining = Math.max(0, state.remaining - Math.max(0, Number(deltaTime) || 0));
    if (state.remaining === 0) {
      state.contactActive = false;
      state.anchor = null;
    }
  }

  /** 累计被障碍持续阻挡的时长（自动停止判定依据）。战斗状态不累计。 */
  _accumulateBlockedTime(entity, deltaTime) {
    if (!entity || this.combatLock()) return;
    const current = Number(this._blockedTotals.get(entity)) || 0;
    this._blockedTotals.set(entity, Math.min(current + Math.max(0, Number(deltaTime) || 0), 60));
  }

  /** 被障碍持续阻挡达到阈值后，是否需松开方向键才恢复移动。战斗状态视为未达标。 */
  _releaseRequiredToMove(entity) {
    if (entity && !this.combatLock()
      && (Number(this._blockedTotals.get(entity)) || 0) >= this.blockedAutoStopDuration) return true;
    return false;
  }

  _clearBlockedAccumulator(entity) {
    if (entity) this._blockedTotals.delete(entity);
  }

  /** 是否有任意方向输入（键盘/摇杆/触屏摇杆统一）。 */
  _isAnyDirectionInput() {
    if (!this.inputManager) return false;
    if (typeof this.inputManager.getMoveAxis === 'function') {
      const axis = this.inputManager.getMoveAxis();
      return Math.abs(Number(axis?.x) || 0) > 0.01 || Math.abs(Number(axis?.y) || 0) > 0.01;
    }
    return this.inputManager.isKeyDown?.('up')
      || this.inputManager.isKeyDown?.('down')
      || this.inputManager.isKeyDown?.('left')
      || this.inputManager.isKeyDown?.('right');
  }

  /**
   * 报告本帧玩家是否被阻挡或推出。接触从无到有时启动一次短时移动锁。
   * @returns {boolean} 本次是否新启动锁
   */
  /**
   * 本帧是否应向此实体施加碰撞锁。战斗状态跳过；被障碍阻挡达到自动停止阈值也跳过，
   * 避免重规划循环反复给玩家套上接触锁（导致原地踏步+动画不停）。
   */
  _shouldApplyContactLock(entity) {
    if (!entity) return false;
    if (this.combatLock()) return false;
    return !this._releaseRequiredToMove(entity);
  }

  setMovementContact(entity, active, duration = this.contactLockDuration) {
    if (!entity) return false;
    // 战斗状态完全跳过碰撞锁，避免战斗中被障碍卡住（包含已有的残锁）。
    // 阻挡时长超过阈值（1秒自动停止）时也不再启动新锁。
    if (this.combatLock() || this._releaseRequiredToMove(entity)) return false;
    let state = this._contactLocks.get(entity);
    if (!state) {
      if (!active) return false;
      state = { remaining: 0, contactActive: false, anchor: null };
      this._contactLocks.set(entity, state);
    }
    if (!active) {
      state.contactActive = false;
      if (state.remaining <= 0) this._contactLocks.delete(entity);
      return false;
    }
    if (state.contactActive || state.remaining > 0) {
      state.contactActive = true;
      return false;
    }

    const position = entity.getComponent?.('transform')?.position;
    state.remaining = Math.max(0.01, Number(duration) || this.contactLockDuration);
    state.contactActive = true;
    state.anchor = position ? { x: position.x, y: position.y } : null;
    this._stopEntityMovement(entity);
    return true;
  }

  /** 锁定期间抵消后续碰撞修正，使镜头与玩家保持在首次合法落点。 */
  restoreContactLockAnchor(entity) {
    const state = entity ? this._contactLocks.get(entity) : null;
    const position = entity?.getComponent?.('transform')?.position;
    if (!state?.anchor || state.remaining <= 0 || !position) return false;
    const changed = position.x !== state.anchor.x || position.y !== state.anchor.y;
    position.x = state.anchor.x;
    position.y = state.anchor.y;
    return changed;
  }

  _resolveMoveTarget(playerEntity, intent) {
    let route = null;
    try { route = this.moveIntentRouter?.(playerEntity, intent) || null; }
    catch (error) { console.warn('MovementSystem: move intent router failed', error); }
    const entity = route?.target === 'vehicle' && route.vehicle ? route.vehicle : playerEntity;
    return {
      entity,
      movement: entity?.getComponent?.('movement') || null,
      sprite: entity?.getComponent?.('sprite') || null,
      routedToVehicle: entity !== playerEntity
    };
  }

  /**
   * 设置碰撞地图
   * @param {Array<Array<boolean>>} collisionMap - 碰撞地图
   * @param {number} tileSize - 瓦片大小
   */
  setCollisionMap(collisionMap, tileSize = 32) {
    this.collisionMap = collisionMap;
    this.tileSize = tileSize;
  }

  /**
   * 导入地图数据（包含楼层信息）
   * @param {Object} mapData - 由 MockDataService 返回的地图，带 floors
   */
  setMapData(mapData) {
    this.floors.clear();
    if (!mapData || !Array.isArray(mapData.floors)) return;
    for (const f of mapData.floors) {
      this.floors.set(f.id, f);
    }
    this.defaultFloorId = mapData.defaultFloor || 'ground';
    this.tileSize = mapData.tileSize ?? this.tileSize;
    // 默认楼层的 collision 作为兜底
    const ground = this.floors.get(this.defaultFloorId);
    if (ground && ground.collision) {
      this.collisionMap = ground.collision;
      this.tileSize = ground.tileSize ?? this.tileSize;
    }
  }

  /**
   * 传送实体到指定楼层
   * @param {Entity} entity
   * @param {string} toFloor
   * @param {number} toX
   * @param {number} toZ
   */
  teleport(entity, toFloor, toX, toZ) {
    const transform = entity?.getComponent?.('transform');
    const floor = this.floors.get(toFloor);
    if (!transform || !floor) return false;
    transform.floorId = toFloor;
    transform.setPosition(toX, toZ, floor.elevation ?? 0);
    const layer = entity.getComponent?.('layer');
    if (layer) layer.floorId = toFloor;
    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('floorChanged', {
          detail: { entityId: entity.id, floorId: toFloor }
        }));
      }
    } catch (_) { /* noop */ }
    return true;
  }

  /**
   * portal 命中检查（仅对玩家运行）
   * @private
   */
  _checkPortals(entity) {
    if (!entity) return;
    const transform = entity.getComponent?.('transform');
    if (!transform) return;
    const floor = this.floors.get(transform.floorId) || this.floors.get(this.defaultFloorId);
    if (!floor || !Array.isArray(floor.portals) || floor.portals.length === 0) return;

    const px = transform.position.x;
    const pz = transform.position.z ?? transform.position.y;

    for (const portal of floor.portals) {
      const dx = (portal.x ?? 0) - px;
      const dz = (portal.z ?? 0) - pz;
      const r = portal.radius ?? 32;
      if (dx * dx + dz * dz > r * r) continue;

      if (portal.trigger === 'interact') {
        if (this.inputManager && typeof this.inputManager.isKeyPressed === 'function' &&
            this.inputManager.isKeyPressed(this.interactKey)) {
          this.teleport(entity, portal.toFloor, portal.toX, portal.toZ);
          return;
        }
      } else {
        // 默认 touch
        this.teleport(entity, portal.toFloor, portal.toX, portal.toZ);
        return;
      }
    }
  }

  /**
   * 更新系统
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {Array<Entity>} entities - 实体列表
   */
  update(deltaTime, entities) {
    const player = this.playerEntity || entities.find(e => e.type === 'player');
    this._advanceContactLock(player, deltaTime);
    this._advanceNavigationState(player, deltaTime);
    for (const entity of entities) {
      if (entity !== player) {
        this._advanceContactLock(entity, deltaTime);
        this._advanceNavigationState(entity, deltaTime);
      }
    }

    // 更新输入管理器的相机位置（用于坐标转换）
    // 注意：camera.update() 由外部（BaseGameScene）调用并做后处理（如 clamp），
    // 这里只负责同步相机位置到 InputManager
    if (this.camera && this.inputManager) {
      const viewBounds = this.camera.getViewBounds();
      this.inputManager.setCameraPosition(viewBounds.left, viewBounds.top);
    }
    
    // 处理键盘移动输入
    this.handleKeyboardInput(entities, deltaTime);
    
    // 处理点击移动
    this.handleClickMovement(entities);
    
    // 更新所有实体的移动
    let playerBlocked = false;
    for (const entity of entities) {
      const blocked = this.updateEntityMovement(entity, deltaTime);
      if (entity === player && blocked === true) playerBlocked = true;
    }

    // 楼层 portal 检测（只对玩家生效）
    if (player) this._checkPortals(player);
    return { playerBlocked };
  }

  /**
   * 处理键盘输入
   * @param {Array<Entity>} entities - 实体列表
   */
  handleKeyboardInput(entities, deltaTime = 0.016) {
    if (!this.inputManager) return;

    const playerEntity = this.playerEntity || entities.find(e => e.type === 'player');
    if (!playerEntity) return;
    if (this.isMoveInputSuppressed(playerEntity)) {
      this._cancelNavigationIntent(playerEntity);
      this._stopEntityMovement(playerEntity);
      return;
    }
    if (this.isContactMovementLocked(playerEntity)) {
      this._stopEntityMovement(playerEntity);
      this._accumulateBlockedTime(playerEntity, deltaTime);
      return;
    }
    // 被物品/障碍阻挡达到阈值后，需松开方向键才恢复移动（避免"一直按着却原地踏步"）。
    if (this._releaseRequiredToMove(playerEntity)) {
      if (this._isAnyDirectionInput()) {
        this._stopEntityMovement(playerEntity);
        return;
      }
      this._clearBlockedAccumulator(playerEntity);
    }

    // 方向输入统一来自 InputManager；触屏虚拟摇杆和手柄均在采集层映射到这里。
    let vx = 0;
    let vy = 0;
    let magnitude = 0;
    if (typeof this.inputManager.getMoveAxis === 'function') {
      const axis = this.inputManager.getMoveAxis();
      vx = Number(axis?.x) || 0;
      vy = Number(axis?.y) || 0;
      magnitude = Math.max(0, Number(axis?.magnitude) || 0);
    } else {
      if (this.inputManager.isKeyDown('up')) vy -= 1;
      if (this.inputManager.isKeyDown('down')) vy += 1;
      if (this.inputManager.isKeyDown('left')) vx -= 1;
      if (this.inputManager.isKeyDown('right')) vx += 1;
      if (vx !== 0 || vy !== 0) {
        const len = Math.hypot(vx, vy);
        vx /= len;
        vy /= len;
        magnitude = 1;
      }
    }

    const target = this._resolveMoveTarget(playerEntity, {
      type: 'move', source: 'axis', direction: { x: vx, y: vy }, magnitude
    });
    const { entity, movement, sprite, routedToVehicle } = target;
    if (!movement || movement.enabled === false
      || (!routedToVehicle && this.isMovementLocked(playerEntity))) return;

    if (routedToVehicle) this._cancelNavigationIntent(playerEntity);
    if (magnitude > 0) {
      let navigation = null;
      if (!routedToVehicle) {
        navigation = this._setAxisNavigationIntent(entity, movement, vx, vy, magnitude);
        // 同方向持续轴输入不得覆盖正在执行的自动绕行路径。
        if (navigation.sameDirection && navigation.state?.autoPathActive
          && movement.movementType === 'path' && movement.targetPosition) {
          if (sprite && sprite.currentAnimation !== 'walk') sprite.playAnimation('walk');
          return;
        }
      }
      let speed = movement.speed;
      if (!routedToVehicle) {
        const statsSpeed = Number(playerEntity.getComponent?.('stats')?.speed);
        if (Number.isFinite(statsSpeed)) speed = statsSpeed;
        if (this.statusEffectSystem) {
          const modifiedSpeed = Number(this.statusEffectSystem.getModifiedStats(playerEntity)?.speed);
          if (Number.isFinite(modifiedSpeed)) speed = modifiedSpeed;
        }
      }
      speed = Math.max(0, Number(speed) || 0);
      movement.startKeyboardMovement(vx * speed * magnitude, vy * speed * magnitude);
      if (sprite && sprite.currentAnimation !== 'walk') sprite.playAnimation('walk');
      return;
    }

    if (!routedToVehicle) {
      const state = this._getNavigationState(entity);
      if (state?.source === 'axis') {
        if (state.autoPathActive && movement.movementType === 'path') movement.clearPath();
        this._cancelNavigationIntent(entity, 'axis');
      }
    }
    if (movement.movementType === 'keyboard') {
      movement.stop();
      if (sprite?.useAnimatedSprite) sprite.setWalking(false);
      if (sprite && sprite.currentAnimation !== 'idle') sprite.playAnimation('idle');
    }
  }

  /**
   * 处理点击移动
   * @param {Array<Entity>} entities - 实体列表
   */
  handleClickMovement(entities) {
    if (!this.inputManager) return;
    if (!this.inputManager.isMouseClicked()
      || this.inputManager.getMouseButton() !== 2
      || this.inputManager.isMouseClickHandled()) return;

    const playerEntity = this.playerEntity || entities.find(e => e.type === 'player');
    if (!playerEntity) return;
    if (this.isMoveInputSuppressed(playerEntity)) {
      this._cancelNavigationIntent(playerEntity);
      this._stopEntityMovement(playerEntity);
      this.inputManager.markMouseClickHandled();
      return;
    }
    if (this.isContactMovementLocked(playerEntity)) {
      this._stopEntityMovement(playerEntity);
      this.inputManager.markMouseClickHandled();
      return;
    }
    const target = this._resolveMoveTarget(playerEntity, { type: 'move', source: 'pointer' });
    const { entity, movement, sprite, routedToVehicle } = target;
    if (!movement || movement.enabled === false
      || (!routedToVehicle && this.isMovementLocked(playerEntity))) return;
    if (movement.movementType === 'keyboard') return;

    const mouseScreen = this.inputManager.getMousePosition();
    const clickPos = this.camera
      ? this.camera.screenToWorld(mouseScreen.x, mouseScreen.y)
      : this.inputManager.getMouseWorldPosition();
    if (this.findEnemyAtPosition(clickPos, entities)) return;

    if (routedToVehicle) this._cancelNavigationIntent(playerEntity);
    else this._setPointerNavigationIntent(entity, clickPos);
    movement.setPath([clickPos]);
    if (sprite && sprite.currentAnimation !== 'walk') sprite.playAnimation('walk');
    this.inputManager.markMouseClickHandled();
  }
  
  /**
   * 查找指定位置的敌人
   * @param {Object} position - 位置 {x, y}
   * @param {Array<Entity>} entities - 实体列表
   * @returns {Entity|null}
   */
  findEnemyAtPosition(position, entities) {
    const clickRadius = 30;
    const clickRadiusSquared = clickRadius * clickRadius;
    for (let index = 0, length = entities?.length || 0; index < length; index++) {
      const enemy = entities[index];
      if (enemy?.type !== 'enemy' || enemy.isDead) continue;
      const transform = enemy.getComponent('transform');
      if (!transform) continue;

      const dx = transform.position.x - position.x;
      const dy = transform.position.y - position.y;
      if (dx * dx + dy * dy <= clickRadiusSquared) return enemy;
    }
    return null;
  }

  /**
   * 更新实体移动
   * @param {Entity} entity - 实体
   * @param {number} deltaTime - 帧间隔时间（秒）
   */
  updateEntityMovement(entity, deltaTime) {
    const transform = entity.getComponent('transform');
    const movement = entity.getComponent('movement');
    const sprite = entity.getComponent('sprite');
    
    if (!transform || !movement) return;
    
    // 远程玩家的移动由网络同步控制，不走本地 MovementSystem
    if (entity.isRemote) return;

    // 位移能力或碰撞停顿期间坐标由对应执行器/锁定锚点拥有，避免普通移动重复叠加。
    if (this._isEntityMovementLocked(entity)) {
      this._stopEntityMovement(entity);
      return false;
    }
    
    // 如果实体被武器钉住，不能移动
    if (entity.pinnedByWeapon) {
      movement.velocity.x = 0;
      movement.velocity.y = 0;
      movement.clearPath();
      if (sprite && sprite.useAnimatedSprite) {
        sprite.setWalking(false);
      }
      if (sprite && sprite.currentAnimation !== 'idle') {
        sprite.playAnimation('idle');
      }
      return;
    }
    
    // 如果实体正在移动
    if (movement.isCurrentlyMoving()) {
      // 非载具实体以 live StatsComponent 为速度事实；状态系统只叠加临时修正。
      let currentSpeed = movement.speed;
      if (!entity.getComponent?.('vehicle')) {
        const statsSpeed = Number(entity.getComponent?.('stats')?.speed);
        if (Number.isFinite(statsSpeed)) currentSpeed = statsSpeed;
        if (this.statusEffectSystem) {
          const modifiedSpeed = Number(this.statusEffectSystem.getModifiedStats(entity)?.speed);
          if (Number.isFinite(modifiedSpeed)) currentSpeed = modifiedSpeed;
        }
      }
      currentSpeed = Math.max(0, Number(currentSpeed) || 0);

      // 路径移动模式
      if (movement.movementType === 'path' && movement.targetPosition) {
        // 检查是否到达目标点
        if (movement.hasReachedTarget(transform.position)) {
          // 移动到下一个路径点
          const hasMore = movement.moveToNextPathPoint();
          if (!hasMore) {
            this._cancelNavigationIntent(entity);
            // 路径结束，切换到待机动画
            if (sprite && sprite.useAnimatedSprite) {
              sprite.setWalking(false);
            }
            if (sprite && sprite.currentAnimation !== 'idle') {
              sprite.playAnimation('idle');
            }
            return;
          }
        }
        
        // 计算朝向目标的速度（使用修改后的速度）
        movement.calculateVelocityToTarget(transform.position, currentSpeed);
      }
      
      // 计算新位置
      const newX = transform.position.x + movement.velocity.x * deltaTime;
      const newY = transform.position.y + movement.velocity.y * deltaTime;
      
      // 更新精灵方向（如果使用方向精灵或动画精灵）
      if (sprite && (sprite.useDirectionalSprite || sprite.useAnimatedSprite)) {
        sprite.setDirectionFromVelocity(movement.velocity.x, movement.velocity.y);
      }
      
      // 碰撞检测
      const canMove = this.canMoveTo(newX, newY, entity);
      
      if (canMove) {
        transform.setPosition(newX, newY);
      } else {
        // 玩家首次撞到地图/瓦片障碍时立即停住并累计阻挡时长。
        if (entity === this.playerEntity || entity.type === 'player') {
          this._stopEntityMovement(entity);
          this._accumulateBlockedTime(entity, deltaTime);
          return true;
        }
        // 非玩家保持旧行为：路径移动撞墙后停止。
        if (movement.movementType === 'path') {
          movement.clearPath();
          if (sprite && sprite.useAnimatedSprite) {
            sprite.setWalking(false);
          }
          if (sprite && sprite.currentAnimation !== 'idle') {
            sprite.playAnimation('idle');
          }
        }
      }
    }
    return false;
  }

  /**
   * 检查是否可以移动到指定位置
   * @param {number} x - 目标X坐标
   * @param {number} y - 目标Y坐标
   * @param {Entity} entity - 实体
   * @returns {boolean}
   */
  canMoveTo(x, y, entity) {
    // 检查地图边界
    if (!this.isWithinMapBounds(x, y)) {
      return false;
    }
    
    // 楼层碰撞地图优先（若有）
    const floorId = entity?.getComponent?.('transform')?.floorId;
    const floor = this.floors.get(floorId);
    if (floor && floor.collision) {
      if (this._checkCollisionArray(floor.collision, floor.tileSize ?? this.tileSize, x, y)) {
        return false;
      }
      return true;
    }

    // 兼容：旧的单层 collisionMap
    if (this.collisionMap && this.checkCollisionMap(x, y)) {
      return false;
    }
    
    return true;
  }

  /**
   * 通用的 collision 数组查询
   * @private
   */
  _checkCollisionArray(collision, tileSize, x, y) {
    if (!collision) return false;
    const tileX = Math.floor(x / tileSize);
    const tileY = Math.floor(y / tileSize);
    if (tileY < 0 || tileY >= collision.length) return true;
    if (tileX < 0 || tileX >= collision[0].length) return true;
    return collision[tileY][tileX] === true;
  }

  /**
   * 检查是否在地图边界内
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {boolean}
   */
  isWithinMapBounds(x, y) {
    return (
      x >= this.mapBounds.minX &&
      x <= this.mapBounds.maxX &&
      y >= this.mapBounds.minY &&
      y <= this.mapBounds.maxY
    );
  }

  /**
   * 检查碰撞地图
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {boolean} true表示有碰撞
   */
  checkCollisionMap(x, y) {
    if (!this.collisionMap) return false;
    
    // 转换为瓦片坐标
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    
    // 检查是否越界
    if (tileY < 0 || tileY >= this.collisionMap.length) return true;
    if (tileX < 0 || tileX >= this.collisionMap[0].length) return true;
    
    // 检查碰撞
    return this.collisionMap[tileY][tileX] === true;
  }

  /**
   * AABB碰撞检测
   * @param {Object} rect1 - 矩形1 {x, y, width, height}
   * @param {Object} rect2 - 矩形2 {x, y, width, height}
   * @returns {boolean}
   */
  checkAABBCollision(rect1, rect2) {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  }

  /**
   * 设置地图边界
   * @param {number} minX - 最小X坐标
   * @param {number} minY - 最小Y坐标
   * @param {number} maxX - 最大X坐标
   * @param {number} maxY - 最大Y坐标
   */
  setMapBounds(minX, minY, maxX, maxY) {
    this.mapBounds = { minX, minY, maxX, maxY };
    
    // 同时更新相机边界
    if (this.camera) {
      this.camera.setBounds(minX, minY, maxX, maxY);
    }
  }
}

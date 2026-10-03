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
 * AISystem.js
 * AI系统 - 管理敌人的AI行为
 * 
 * 复用现有系统：
 * - MovementSystem: 移动和路径寻找
 * - CombatSystem: 攻击判定和伤害计算
 */

const hasTag = (entity, tag) => Array.isArray(entity?.tags) && entity.tags.includes(tag);

/** 跨客户端以稳定实体 ID 推导游荡相位，避免 Math.random 破坏回放与服务端权威。 */
function stableEntityHash(entityId) {
  let hash = 2166136261;
  for (const character of String(entityId || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** canonical 战役单位只攻击其他参战阵营；普通敌人继续使用 legacy faction/type 规则。 */
function isHostileTarget(entity, candidate) {
  if (candidate === entity || candidate?.isDead || candidate?.isDying || candidate?.isSoulState) return false;
  // 剧情倒地（如 S02 救援昏倒）：敌人不再索敌，避免剧情演出被击杀流程打断。
  if (candidate?.plotDowned) return false;
  if (hasTag(entity, 'battleParticipant')) {
    const candidateParticipates = hasTag(candidate, 'battleParticipant')
      || hasTag(candidate, 'battleIntervenor');
    return candidateParticipates
      && !!entity.factionId
      && !!candidate.factionId
      && entity.factionId !== candidate.factionId;
  }
  if (candidate?.faction === entity.faction) return false;
  if (entity.faction === 'enemy' && candidate?.type !== 'player' && candidate?.faction !== 'ally') return false;
  if (entity.faction === 'ally' && candidate?.type !== 'enemy') return false;
  return true;
}

/**
 * AI控制器基类
 */
class AIController {
  constructor() {
    this.updateInterval = 0.5; // AI更新间隔（秒）
    this.timeSinceLastUpdate = 0;
    this.idleWander = null;
  }

  /**
   * 更新AI
   * @param {Entity} entity - 实体
   * @param {Array<Entity>} allEntities - 所有实体列表
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {CombatSystem} combatSystem - 战斗系统
   * @param {Array<Entity>} [hostileCache] - 预计算的敌对实体列表（可选，消除重复 filter）
   */
  update(entity, allEntities, deltaTime, combatSystem, hostileCache = null) {
    this.timeSinceLastUpdate += deltaTime;

    if (this.timeSinceLastUpdate >= this.updateInterval) {
      // 玩家状态正常（战斗外）时，追击中的怪物/NPC 放弃追击，
      // 由 wanderNear 以出生点为锚游荡走回出生点附近。
      if (combatSystem && combatSystem.isInCombat?.() !== true) {
        const combat = entity.getComponent?.('combat');
        if (combat?.hasTarget?.()) {
          combat.clearTarget?.();
          this.clearIdleWander();
        }
      }
      this.makeDecision(entity, allEntities, combatSystem, hostileCache);
      this.timeSinceLastUpdate = 0;
    }
  }

  /**
   * 做出决策（子类实现）
   * @param {Entity} entity - 实体
   * @param {Array<Entity>} allEntities - 所有实体列表
   * @param {CombatSystem} combatSystem - 战斗系统
   * @param {Array<Entity>} [hostileCache] - 预计算的敌对实体列表（可选）
   */
  makeDecision(entity, allEntities, combatSystem, hostileCache = null) {
    // 子类实现
  }

  /**
   * 查找最近的敌人
   * @param {Entity} entity - 实体
   * @param {Array<Entity>} allEntities - 所有实体列表
   * @param {number} detectionRange - 检测范围
   * @param {Array<Entity>} [hostileCache] - 预计算的敌对实体列表（可选，消除重复 filter）
   * @returns {Entity|null}
   */
  findNearestEnemy(entity, allEntities, detectionRange = 300, hostileCache = null) {
    const transform = entity.getComponent('transform');
    if (!transform) return null;

    const enemies = hostileCache || allEntities.filter(candidate => isHostileTarget(entity, candidate));

    let nearestEnemy = null;
    let nearestDistance = detectionRange;

    for (const enemy of enemies) {
      const enemyTransform = enemy.getComponent('transform');
      if (!enemyTransform) continue;

      const dx = enemyTransform.position.x - transform.position.x;
      const dy = enemyTransform.position.y - transform.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = enemy;
      }
    }

    return nearestEnemy;
  }

  /**
   * 移动到目标
   * @param {Entity} entity - 实体
   * @param {Entity} target - 目标
   */
  moveTowardsTarget(entity, target) {
    const targetPosition = target?.getComponent?.('transform')?.position;
    if (targetPosition) this.moveTowardsPosition(entity, targetPosition);
  }

  /** 将实体移动到明确坐标，供追击与确定性待机徘徊复用。 */
  moveTowardsPosition(entity, position) {
    const transform = entity.getComponent('transform');
    const movement = entity.getComponent('movement');
    if (!transform || !movement || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return;

    const dx = position.x - transform.position.x;
    const dy = position.y - transform.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) return;

    movement.velocity.x = (dx / distance) * movement.speed;
    movement.velocity.y = (dy / distance) * movement.speed;
    const sprite = entity.getComponent('sprite');
    if (sprite && sprite.currentAnimation !== 'walk') sprite.playAnimation('walk');
  }

  /** 获得攻击目标时丢弃纯运行态的待机徘徊草稿。 */
  clearIdleWander() {
    this.idleWander = null;
  }

  /** 目标（或坐标）距实体出生锚点的距离；无锚点时退化为 0（= 不限制追击）。 */
  distanceFromSpawnAnchor(entity, target) {
    const anchor = entity.spawnAnchor || entity.getComponent?.('transform')?.position;
    const targetPosition = target?.getComponent?.('transform')?.position;
    if (!anchor || !targetPosition) return 0;
    return Math.hypot(targetPosition.x - anchor.x, targetPosition.y - anchor.y);
  }

  /**
   * AI 状态机·回家步（aiProfile.leashRange）：无目标且离出生锚点超过 leashRange 时
   * 先走回出生点再继续巡逻/徘徊。返回 true = 本帧移动已被接管。
   * returning 粘滞防边界抖动：一旦进入回家态就走到家为止。
   */
  stepReturnHome(entity) {
    const profile = entity.aiProfile && typeof entity.aiProfile === 'object' ? entity.aiProfile : null;
    const leashRange = Number(profile?.leashRange) > 0 ? Number(profile.leashRange) : 0;
    const transform = entity.getComponent('transform');
    if (!transform?.position) return false;
    const anchor = entity.spawnAnchor || transform.position;
    const distance = Math.hypot(transform.position.x - anchor.x, transform.position.y - anchor.y);
    if (!this._returningHome) {
      if (leashRange <= 0 || distance <= leashRange) return false;
      this._returningHome = true;
      this.clearPatrolState();
    }
    if (distance <= 12) {
      this._returningHome = false;
      this.stopMovement(entity);
      return true;
    }
    this.moveTowardsPosition(entity, anchor);
    return true;
  }

  /**
   * AI 状态机·巡逻步（aiProfile.patrol）：enabled 且 points 非空时沿路径点移动，
   * mode=loop 循环 / pingpong 往返，到点停留 1 秒。points 为相对出生锚点的偏移
   * （与碰撞多边形同约定，编辑器拖动物体时路线自动跟随）。返回 true = 本帧移动已被接管。
   */
  stepPatrol(entity) {
    const profile = entity.aiProfile && typeof entity.aiProfile === 'object' ? entity.aiProfile : null;
    const patrol = profile?.patrol;
    // points 与碰撞多边形同格式：[[x, y], ...]（相对出生锚点的偏移）
    const points = Array.isArray(patrol?.points)
      ? patrol.points.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      : [];
    if (patrol?.enabled !== true || points.length === 0) {
      this.clearPatrolState();
      return false;
    }
    const transform = entity.getComponent('transform');
    if (!transform?.position) return false;
    if (!this._patrolState) this._patrolState = { index: 0, dir: 1, waitRemaining: 0 };
    const state = this._patrolState;
    const anchor = entity.spawnAnchor || transform.position;

    if (state.waitRemaining > 0) {
      state.waitRemaining -= this.updateInterval;
      if (state.waitRemaining > 0) {
        this.stopMovement(entity);
        return true;
      }
      state.index = patrol.mode === 'pingpong' && points.length > 1
        ? this._nextPatrolIndex(state, points.length)
        : (state.index + 1) % points.length;
    }

    const target = { x: anchor.x + points[state.index][0], y: anchor.y + points[state.index][1] };
    const reached = Math.hypot(target.x - transform.position.x, target.y - transform.position.y) <= 8;
    if (reached) {
      state.waitRemaining = 1.0;
      this.stopMovement(entity);
      return true;
    }
    this.moveTowardsPosition(entity, target);
    return true;
  }

  /** pingpong 巡逻的下一步索引（端点反向）。 */
  _nextPatrolIndex(state, length) {
    let next = state.index + state.dir;
    if (next >= length || next < 0) {
      state.dir = -state.dir;
      next = state.index + state.dir;
    }
    return Math.max(0, Math.min(length - 1, next));
  }

  clearPatrolState() {
    this._patrolState = null;
  }

  /**
   * 无目标时在出生点附近确定性徘徊（远离出生点时会先走回去）。
   * 状态仅保存在 AI controller 内存中；稳定实体 ID 与步进共同决定路线，便于回放复现。
   */
  wanderNear(entity) {
    const transform = entity.getComponent('transform');
    if (!transform?.position) return;
    if (!this.idleWander) {
      // 游荡锚点优先取出生点；无出生锚点的实体（测试桩/旧存档）退化为当前位置。
      const anchor = entity.spawnAnchor || transform.position;
      this.idleWander = {
        anchor: { x: anchor.x, y: anchor.y },
        hash: stableEntityHash(entity.id),
        step: 0,
        target: null,
        remaining: 0
      };
    }

    const state = this.idleWander;
    const reachedTarget = state.target
      && Math.hypot(state.target.x - transform.position.x, state.target.y - transform.position.y) <= 8;
    state.remaining -= this.updateInterval;
    if (!state.target || state.remaining <= 0 || reachedTarget) {
      const direction = (state.hash + state.step) % 8;
      const angle = direction * (Math.PI / 4);
      const radius = 24 + ((state.hash >>> 3) % 25);
      state.target = {
        x: state.anchor.x + Math.cos(angle) * radius,
        y: state.anchor.y + Math.sin(angle) * radius
      };
      state.step += 1;
      state.remaining = 1.8;
    }
    this.moveTowardsPosition(entity, state.target);
  }

  /**
   * 停止移动
   * @param {Entity} entity - 实体
   */
  stopMovement(entity) {
    const movement = entity.getComponent('movement');
    if (movement) {
      movement.velocity.x = 0;
      movement.velocity.y = 0;
      
      // 播放待机动画
      const sprite = entity.getComponent('sprite');
      if (sprite && sprite.currentAnimation !== 'idle') {
        sprite.playAnimation('idle');
      }
    }
  }

  /**
   * 检查是否在攻击范围内
   * @param {Entity} entity - 实体
   * @param {Entity} target - 目标
   * @param {number} range - 攻击范围
   * @returns {boolean}
   */
  isInRange(entity, target, range) {
    const transform = entity.getComponent('transform');
    const targetTransform = target.getComponent('transform');

    if (!transform || !targetTransform) return false;

    const dx = targetTransform.position.x - transform.position.x;
    const dy = targetTransform.position.y - transform.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance <= range;
  }
}

/**
 * 激进型AI - 主动攻击最近的敌人
 */
class AggressiveAI extends AIController {
  constructor() {
    super();
    this.updateInterval = 0.3; // 更频繁的更新
    this.lastAttackTime = 0;   // 上次攻击时间
  }

  makeDecision(entity, allEntities, combatSystem, hostileCache = null) {
    const combat = entity.getComponent('combat');
    if (!combat) return;
    const profile = entity.aiProfile && typeof entity.aiProfile === 'object' ? entity.aiProfile : null;

    // 如果没有目标或目标已死亡，寻找新目标
    if (!combat.hasTarget() || this.isTargetDead(combat.target)) {
      // 清除死亡目标
      if (combat.hasTarget() && this.isTargetDead(combat.target)) {
        combat.clearTarget();
      }

      // 警戒范围（aiProfile.detectionRange）：进入则索敌；未配置维持 400 现状
      const detectionRange = Number(profile?.detectionRange) > 0 ? Number(profile.detectionRange) : 400;
      const newTarget = this.findNearestEnemy(entity, allEntities, detectionRange, hostileCache);
      if (newTarget) {
        combat.setTarget(newTarget);
        console.log(`${entity.name} 找到目标: ${newTarget.name} (type: ${newTarget.type}, faction: ${newTarget.faction})`);
      }
    }

    // 追击范围（aiProfile.pursuitRange）：目标距出生锚点超出即放弃追击（回家）
    if (combat.hasTarget()) {
      const pursuitRange = Number(profile?.pursuitRange) > 0 ? Number(profile.pursuitRange) : Infinity;
      if (this.distanceFromSpawnAnchor(entity, combat.target) > pursuitRange) {
        combat.clearTarget();
      }
    }

    // 如果有目标，尝试攻击或移动
    if (combat.hasTarget()) {
      this.clearIdleWander();
      this.clearPatrolState();
      const target = combat.target;

      // 检查是否在攻击范围内
      if (this.isInRange(entity, target, combat.attackRange)) {
        // 在范围内，停止移动并攻击
        this.stopMovement(entity);

        // 执行攻击
        const currentTime = performance.now();
        if (combat.canAttack(currentTime) && combatSystem) {
          combatSystem.performAttack(entity, target, currentTime);
        }
      } else {
        // 不在范围内，移动到目标
        this.moveTowardsTarget(entity, target);
      }
      return;
    }

    // 没有目标：回家（leashRange）→ 巡逻（patrol）→ 确定性徘徊（现状默认）
    if (this.stepReturnHome(entity)) return;
    if (this.stepPatrol(entity)) return;
    this.wanderNear(entity);
  }

  /**
   * 检查目标是否死亡
   * @param {Entity} target - 目标
   * @returns {boolean}
   */
  isTargetDead(target) {
    if (!target) return true;
    const stats = target.getComponent('stats');
    return !stats || stats.hp <= 0 || target.isDead || target.isDying || target.isSoulState
      // 剧情倒地目标失效，防止 AI 在索敌前已锁定、随后持续攻击倒地者。
      || target.plotDowned === true;
  }
}

/**
 * 防御型AI - 保持距离，优先攻击靠近的敌人
 */
class DefensiveAI extends AIController {
  constructor() {
    super();
    this.updateInterval = 0.4;
    this.safeDistance = 150; // 安全距离
  }

  makeDecision(entity, allEntities, combatSystem, hostileCache = null) {
    const combat = entity.getComponent('combat');
    const transform = entity.getComponent('transform');
    if (!combat || !transform) return;

    // 查找最近的敌人（使用预计算的敌对列表消除重复 filter）
    const nearestEnemy = this.findNearestEnemy(entity, allEntities, 300, hostileCache);

    if (nearestEnemy) {
      this.clearIdleWander();
      const enemyTransform = nearestEnemy.getComponent('transform');
      if (!enemyTransform) return;

      const dx = enemyTransform.position.x - transform.position.x;
      const dy = enemyTransform.position.y - transform.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // 如果敌人太近，后退
      if (distance < this.safeDistance) {
        this.retreatFrom(entity, nearestEnemy);
      } else if (distance <= combat.attackRange) {
        // 在攻击范围内，停止移动并攻击
        this.stopMovement(entity);
        combat.setTarget(nearestEnemy);
        
        // 执行攻击
        const currentTime = performance.now();
        if (combat.canAttack(currentTime) && combatSystem) {
          combatSystem.performAttack(entity, nearestEnemy, currentTime);
        }
      } else {
        // 保持距离
        this.stopMovement(entity);
        combat.setTarget(nearestEnemy);
      }
    } else {
      // 没有敌人时清除旧目标并在附近徘徊。
      combat.clearTarget();
      this.wanderNear(entity);
    }
  }

  /**
   * 从目标后退
   * @param {Entity} entity - 实体
   * @param {Entity} target - 目标
   */
  retreatFrom(entity, target) {
    const transform = entity.getComponent('transform');
    const targetTransform = target.getComponent('transform');
    const movement = entity.getComponent('movement');

    if (!transform || !targetTransform || !movement) return;

    // 计算反方向
    const dx = transform.position.x - targetTransform.position.x;
    const dy = transform.position.y - targetTransform.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      // 归一化方向（反向）
      const dirX = dx / distance;
      const dirY = dy / distance;

      // 设置移动速度（后退）
      movement.velocity.x = dirX * movement.speed;
      movement.velocity.y = dirY * movement.speed;
      
      // 播放移动动画
      const sprite = entity.getComponent('sprite');
      if (sprite && sprite.currentAnimation !== 'walk') {
        sprite.playAnimation('walk');
      }
    }
  }
}

/**
 * 支援型AI - 优先攻击低血量敌人，保护友军
 */
class SupportAI extends AIController {
  constructor() {
    super();
    this.updateInterval = 0.5;
  }

  makeDecision(entity, allEntities, combatSystem, hostileCache = null) {
    const combat = entity.getComponent('combat');
    if (!combat) return;

    // 查找低血量的敌人
    const weakEnemy = this.findWeakestEnemy(entity, allEntities, 350, hostileCache);

    if (weakEnemy) {
      this.clearIdleWander();
      combat.setTarget(weakEnemy);

      // 检查是否在攻击范围内
      if (this.isInRange(entity, weakEnemy, combat.attackRange)) {
        // 在范围内，停止移动并攻击
        this.stopMovement(entity);

        // 执行攻击
        const currentTime = performance.now();
        if (combat.canAttack(currentTime) && combatSystem) {
          combatSystem.performAttack(entity, weakEnemy, currentTime);
        }
      } else {
        // 不在范围内，移动到目标
        this.moveTowardsTarget(entity, weakEnemy);
      }
    } else {
      // 没有低血量敌人，查找最近的敌人
      const nearestEnemy = this.findNearestEnemy(entity, allEntities, 300, hostileCache);
      
      if (nearestEnemy) {
        this.clearIdleWander();
        combat.setTarget(nearestEnemy);
        
        if (this.isInRange(entity, nearestEnemy, combat.attackRange)) {
          this.stopMovement(entity);
          
          // 执行攻击
          const currentTime = performance.now();
          if (combat.canAttack(currentTime) && combatSystem) {
            combatSystem.performAttack(entity, nearestEnemy, currentTime);
          }
        } else {
          this.moveTowardsTarget(entity, nearestEnemy);
        }
      } else {
        // 没有敌人时清除旧目标并在附近徘徊。
        combat.clearTarget();
        this.wanderNear(entity);
      }
    }
  }

  /**
   * 查找最弱的敌人（血量最低）
   * @param {Entity} entity - 实体
   * @param {Array<Entity>} allEntities - 所有实体列表
   * @param {number} detectionRange - 检测范围
   * @param {Array<Entity>} [hostileCache] - 预计算的敌对实体列表（可选，消除重复 filter）
   * @returns {Entity|null}
   */
  findWeakestEnemy(entity, allEntities, detectionRange, hostileCache = null) {
    const transform = entity.getComponent('transform');
    if (!transform) return null;

    const enemies = hostileCache || allEntities.filter(candidate => isHostileTarget(entity, candidate));

    let weakestEnemy = null;
    let lowestHpPercent = 1.0;

    for (const enemy of enemies) {
      const enemyTransform = enemy.getComponent('transform');
      const enemyStats = enemy.getComponent('stats');
      
      if (!enemyTransform || !enemyStats) continue;

      // 检查距离
      const dx = enemyTransform.position.x - transform.position.x;
      const dy = enemyTransform.position.y - transform.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > detectionRange) continue;

      // 计算血量百分比
      const hpPercent = enemyStats.hp / enemyStats.maxHp;

      // 优先攻击血量低于50%的敌人
      if (hpPercent < 0.5 && hpPercent < lowestHpPercent) {
        lowestHpPercent = hpPercent;
        weakestEnemy = enemy;
      }
    }

    return weakestEnemy;
  }
}

/**
 * AI系统
 * 管理所有AI控制的实体
 */
export class AISystem {
  constructor() {
    this.aiControllers = new Map();
    this.inactiveAI = new Map();
    this.lureTargets = new Map();
    console.log('AISystem: Initialized');
  }

  registerAI(entity, aiType = 'aggressive') {
    if (!entity?.id) return false;
    const resolvedType = aiType || this.inactiveAI.get(entity.id) || entity.aiType || 'aggressive';
    this.aiControllers.set(entity.id, this.createAIController(resolvedType));
    this.inactiveAI.delete(entity.id);
    entity.isAI = true;
    entity.aiActive = true;
    entity.aiType = resolvedType;
    console.log(`AISystem: Registered ${resolvedType} AI for entity ${entity.id}`);
    return true;
  }

  createAIController(aiType) {
    switch (aiType) {
      case 'battleFormation':
      case 'aggressive': return new AggressiveAI();
      case 'defensive': return new DefensiveAI();
      case 'support': return new SupportAI();
      default:
        console.warn(`AISystem: Unknown AI type: ${aiType}, using aggressive`);
        return new AggressiveAI();
    }
  }

  /** 暂停 AI 但保留期望类型，供可见休眠守卫稍后激活。 */
  deactivateAI(entity, aiType = entity?.aiType || 'aggressive') {
    if (!entity?.id) return false;
    this.aiControllers.delete(entity.id);
    this.lureTargets.delete(entity.id);
    this.inactiveAI.set(entity.id, aiType || 'aggressive');
    entity.getComponent?.('movement')?.stop?.();
    entity.isAI = false;
    entity.aiActive = false;
    entity.aiType = aiType || 'aggressive';
    return true;
  }

  /** 幂等激活已存在的实体，不重新创建或改变实体 ID。 */
  activateAI(entity, aiType = null) {
    if (!entity?.id || entity.isDead || entity.isDying) return false;
    const resolvedType = aiType || this.inactiveAI.get(entity.id) || entity.aiType || 'aggressive';
    if (this.aiControllers.has(entity.id) && entity.aiType === resolvedType) return true;
    return this.registerAI(entity, resolvedType);
  }

  /** 完全移除 AI 运行态，用于实体销毁/场景卸载。 */
  unregisterAI(entity) {
    if (!entity?.id) return false;
    const hadActive = this.aiControllers.delete(entity.id);
    const hadInactive = this.inactiveAI.delete(entity.id);
    const existed = hadActive || hadInactive;
    this.lureTargets.delete(entity.id);
    entity.getComponent?.('movement')?.stop?.();
    entity.isAI = false;
    entity.aiActive = false;
    entity.aiType = null;
    if (existed) console.log(`AISystem: Unregistered AI for entity ${entity.id}`);
    return existed;
  }

  /** 让 AI 在有限时间内优先调查指定位置，结束后恢复原控制器。 */
  lureToPosition(entity, position, { duration = 6, aiType = null } = {}) {
    if (!entity?.id || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return false;
    if (!this.activateAI(entity, aiType)) return false;
    const target = {
      position: { x: position.x, y: position.y },
      remaining: Math.max(0.1, Number(duration) || 6)
    };
    this.lureTargets.set(entity.id, target);
    entity.getComponent?.('movement')?.setPath?.([target.position]);
    return true;
  }

  getRuntimeState(entity) {
    if (!entity?.id) return null;
    const lure = this.lureTargets.get(entity.id);
    return {
      active: this.aiControllers.has(entity.id),
      aiType: this.inactiveAI.get(entity.id) || entity.aiType || 'aggressive',
      lure: lure ? { position: { ...lure.position }, remaining: lure.remaining } : null
    };
  }

  restoreRuntimeState(entity, state = {}) {
    if (!entity?.id) return false;
    const aiType = state.aiType || entity.aiType || 'aggressive';
    if (state.active === false) return this.deactivateAI(entity, aiType);
    if (!this.activateAI(entity, aiType)) return false;
    if (state.lure?.position) {
      return this.lureToPosition(entity, state.lure.position, {
        duration: state.lure.remaining,
        aiType
      });
    }
    return true;
  }

  update(deltaTime, entities, combatSystem) {
    // 建立实体索引避免每只 AI 全量线性查找（多狼追逐时显著降耗）
    const byId = new Map();
    for (const entity of entities || []) byId.set(entity.id, entity);

    // 预计算：按阵营分组，避免每只 AI 重复 filter 全量实体
    const hostileCache = this._buildHostileCache(entities);

    for (const [entityId, controller] of this.aiControllers) {
      const entity = byId.get(entityId);
      if (!entity) {
        this.aiControllers.delete(entityId);
        this.lureTargets.delete(entityId);
        continue;
      }
      if (entity.isDead || entity.isDying) continue;
      if (this._updateLure(entity, deltaTime)) continue;
      // 传入预计算的敌对列表，消除每只 AI 的 O(N) filter
      controller.update(entity, entities, deltaTime, combatSystem, hostileCache.get(entity));
    }
  }

  /**
   * 按实体预计算敌对目标列表，避免每只 AI 重复遍历全量实体
   * @param {Array<Entity>} entities
   * @returns {WeakMap<Entity, Array<Entity>>} entity -> hostile entities
   */
  _buildHostileCache(entities) {
    const cache = new WeakMap();
    if (!entities || entities.length === 0) return cache;

    // 按阵营粗分组；canonical 战斗单位使用 factionId，普通单位使用 faction
    const byFaction = new Map();
    for (const entity of entities) {
      if (!entity || entity.isDead || entity.isDying || entity.isSoulState) continue;
      const key = entity.factionId || entity.faction || 'neutral';
      if (!byFaction.has(key)) byFaction.set(key, []);
      byFaction.get(key).push(entity);
    }

    // 为每个实体计算敌对列表（利用阵营索引，避免全量 filter）
    for (const entity of entities) {
      if (!entity || entity.isDead || entity.isDying || entity.isSoulState) continue;
      const entityKey = entity.factionId || entity.faction;
      const hostiles = [];
      for (const [key, members] of byFaction) {
        if (key === entityKey) continue;
        for (const candidate of members) {
          if (isHostileTarget(entity, candidate)) hostiles.push(candidate);
        }
      }
      cache.set(entity, hostiles);
    }
    return cache;
  }

  _updateLure(entity, deltaTime) {
    const lure = this.lureTargets.get(entity.id);
    if (!lure) return false;
    lure.remaining -= Math.max(0, Number(deltaTime) || 0);
    const transform = entity.getComponent?.('transform');
    const distance = transform
      ? Math.hypot(lure.position.x - transform.position.x, lure.position.y - transform.position.y)
      : 0;
    if (lure.remaining <= 0 || distance <= 8) {
      this.lureTargets.delete(entity.id);
      entity.getComponent?.('movement')?.stop?.();
      return false;
    }
    return true;
  }

  registerBatch(entities, aiType = 'aggressive') {
    for (const entity of entities) this.registerAI(entity, aiType);
  }

  clear() {
    this.aiControllers.clear();
    this.inactiveAI.clear();
    this.lureTargets.clear();
    console.log('AISystem: Cleared all AI controllers');
  }

  getAICount() { return this.aiControllers.size; }
  isAIControlled(entity) { return !!entity?.id && this.aiControllers.has(entity.id); }
  getAIType(entity) { return entity?.aiType || this.inactiveAI.get(entity?.id) || null; }

  changeAIType(entity, newAIType) {
    if (!entity?.id) return false;
    if (!this.aiControllers.has(entity.id)) {
      this.inactiveAI.set(entity.id, newAIType);
      entity.aiType = newAIType;
      return true;
    }
    this.aiControllers.set(entity.id, this.createAIController(newAIType));
    entity.aiType = newAIType;
    console.log(`AISystem: Changed AI type for entity ${entity.id} to ${newAIType}`);
    return true;
  }
}

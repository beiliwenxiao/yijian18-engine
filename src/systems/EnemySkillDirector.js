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
 * EnemySkillDirector.js
 * 敌人攻击编排调度器 - 按 aiProfile.attackActions 逐帧调度普攻与技能。
 *
 * 由 AISystem.update 在控制器 makeDecision 前调用；有编排的敌人
 * 普攻/技能触发让位本调度器，AI 控制器只负责索敌与走位。
 *
 * attackActions 条目 schema（库定义 ai.attackActions，placement overrides 可覆盖）：
 *   { id, type: 'skill'|'basic', skillId, intervalSeconds,
 *     afterSkillId?, delayAfterSkillSeconds?, paramsOverride? }
 *
 * 执行语义（时间基准 performance.now()）：
 * - intervalSeconds 兼作开场延迟（0=接敌立即）；
 * - 实际触发 = 间隔到期 && 技能冷却（params.cooldown 硬闸）&& 目标在 range 内；
 * - 链式：afterSkillId 指向的动作触发后按 delayAfterSkillSeconds 计时，
 *   与自身间隔取先到；源动作未触发过前不触发；
 * - 多动作就绪按数组顺序取第一个；每帧至多触发一个；
 * - type 'basic' 走 CombatSystem.performAttack（复用其 telegraph/扑击管线）；
 * - type 'skill' 走 CombatSystem.executeSkill（复用玩家技能结算，敌我判定按施法者相对计算）；
 *   castTime > 0 时先进 telegraph 圈（windupMs=castTime），到点在锁定落点结算（可跑位躲避）；
 * - 死亡/剧情倒地清 casting 与计时；脱战（无有效目标）重置 lastFiredAt。
 */

import { isHostileTarget } from '../core/FactionRules.js';
import { resolveSkillArea } from './SkillArea.js';

/** paramsOverride.radius 与技能定义均未配置 radius 时的 AOE 兜底半径（与 applyAOEDamage 一致）。 */
const DEFAULT_SKILL_RADIUS = 150;

export class EnemySkillDirector {
  /**
   * @param {Object} [config]
   * @param {SkillRegistry} [config.skillRegistry] - 技能定义注册表（SceneGameplaySystemAssembler 注入）
   * @param {Function} [config.now] - () => number 单调毫秒时钟
   */
  constructor(config = {}) {
    /** @type {Map<string, {lastFiredAt:Map, chainAnchor:Map, combatAt:number|null, pendingCast:Object|null}>} */
    this.states = new Map();
    this.skillRegistry = config.skillRegistry || null;
    this.now = typeof config.now === 'function' ? config.now : () => performance.now();
    this._warnedSkills = new Set();
  }

  /** 注入技能定义注册表（技能结算需要 definition/params）。 */
  setSkillRegistry(registry) {
    this.skillRegistry = registry || null;
  }

  /** 实体是否配置了攻击编排（普攻或技能任一）。 */
  hasAttackActions(entity) {
    const actions = entity?.aiProfile?.attackActions;
    return Array.isArray(actions)
      && actions.some(action => action && (action.type === 'skill' || action.type === 'basic'));
  }

  /**
   * 逐帧调度（AISystem.update 每实体调用，控制器 makeDecision 之前）。
   * @param {Entity} entity
   * @param {Array<Entity>} entities - 全量实体列表（作技能结算上下文）
   * @param {CombatSystem} combatSystem
   */
  update(entity, entities, combatSystem) {
    const combat = entity?.getComponent?.('combat');
    if (!combat) return;

    const actions = Array.isArray(entity.aiProfile?.attackActions)
      ? entity.aiProfile.attackActions
      : null;
    if (!actions || !actions.some(action => action && (action.type === 'skill' || action.type === 'basic'))) {
      this.states.delete(entity.id);
      return;
    }

    // 死亡/濒死/剧情倒地：清施法与计时（剧情倒地保留条目，复活后重新按开场延迟计）
    if (entity.isDead || entity.isDying || entity.isSoulState || entity.plotDowned === true) {
      this._resetCombatTimers(entity, combatSystem, this._ensureState(entity.id));
      if (entity.isDead || entity.isDying || entity.isSoulState) this.states.delete(entity.id);
      return;
    }

    const state = this._ensureState(entity.id);
    state.actions = actions;
    const now = this.now();
    const target = this._validTarget(entity, combat.target);

    // 脱战（无有效目标）：重置计时与施法，下次接敌重新按开场延迟计
    if (!target) {
      this._resetCombatTimers(entity, combatSystem, state);
      return;
    }
    if (state.combatAt === null) state.combatAt = now;

    // 施法前摇推进：到点在锁定落点结算；期间站定且不启动新动作
    if (state.pendingCast) {
      this._advancePendingCast(entity, entities, combatSystem, state, now);
      return;
    }

    for (const action of actions) {
      if (!action || (action.type !== 'skill' && action.type !== 'basic')) continue;
      if (!this._isActionReady(entity, combat, action, state, now, target)) continue;
      const fired = action.type === 'basic'
        ? this._fireBasic(entity, combat, combatSystem, action, target, now, state)
        : this._fireSkill(entity, combat, combatSystem, action, target, entities, now, state);
      if (fired) return; // 每帧至多触发一个动作，数组顺序即优先级
    }
  }

  /** 释放实体全部编排状态（死亡/注销/场景清理）。 */
  resetEntity(entityId) {
    this.states.delete(entityId);
  }

  clear() {
    this.states.clear();
  }

  /** 实体运行态（惰性创建）。 */
  _ensureState(entityId) {
    let state = this.states.get(entityId);
    if (!state) {
      state = { lastFiredAt: new Map(), chainAnchor: new Map(), combatAt: null, pendingCast: null };
      this.states.set(entityId, state);
    }
    return state;
  }

  /** 目标有效性：存活、非剧情倒地、且按施法者相对规则为敌对。 */
  _validTarget(entity, candidate) {
    if (!candidate || candidate.isDead || candidate.isDying || candidate.isSoulState) return null;
    if (candidate.plotDowned === true) return null;
    return isHostileTarget(entity, candidate) ? candidate : null;
  }

  /** 脱战/死亡清理：清计时链与进行中的技能前摇（telegraph + casting 状态）。 */
  _resetCombatTimers(entity, combatSystem, state) {
    state.lastFiredAt.clear();
    state.chainAnchor.clear();
    state.combatAt = null;
    if (state.pendingCast) {
      combatSystem?.attackTelegraphs?.delete?.(entity.id);
      entity.getComponent?.('combat')?.interruptCast?.();
      state.pendingCast = null;
    }
  }

  /** 动作 X 触发成功后，为同一编排里引用它的链式动作记锚点。 */
  _anchorChainedActions(actions, action, state, now) {
    if (!action?.id || !Array.isArray(actions)) return;
    for (const candidate of actions) {
      if (candidate && candidate.afterSkillId && candidate.afterSkillId === action.id) {
        state.chainAnchor.set(candidate.id, now);
      }
    }
  }

  /** 合成动作生效参数：技能定义 params 为基线，paramsOverride 覆盖（编辑器拖五边形写 radius）。 */
  _resolveParams(definition, action) {
    const overrides = action?.paramsOverride && typeof action.paramsOverride === 'object'
      ? action.paramsOverride : {};
    return { ...(definition.params || {}), ...overrides };
  }

  /**
   * 动作就绪判定：间隔/链式/冷却/range 四闸。
   * @private
   */
  _isActionReady(entity, combat, action, state, now, target) {
    const intervalMs = Math.max(0, Number(action.intervalSeconds) || 0) * 1000;
    const reference = state.lastFiredAt.get(action.id) ?? state.combatAt;
    const intervalReady = reference === null || now - reference >= intervalMs;

    if (action.afterSkillId) {
      // 链式：源动作触发过才有资格；到点条件 = 延迟到期 或 自身间隔到期（取先到）
      const anchor = state.chainAnchor.get(action.id);
      if (anchor === undefined || anchor === null) return false;
      const delayMs = Math.max(0, Number(action.delayAfterSkillSeconds) || 0) * 1000;
      if (!intervalReady && now - anchor < delayMs) return false;
    } else if (!intervalReady) {
      return false;
    }

    const casterTransform = entity.getComponent('transform');
    const targetTransform = target?.getComponent?.('transform');
    if (!casterTransform?.position || !targetTransform?.position) return false;
    const distance = Math.hypot(
      targetTransform.position.x - casterTransform.position.x,
      targetTransform.position.y - casterTransform.position.y
    );

    if (action.type === 'basic') {
      return distance <= (combat.attackRange || 40) && combat.canAttack?.(now) === true;
    }

    // skill 动作：施法中不重复启动；params.cooldown 为硬闸；range 为施法距离
    if (combat.isCasting) return false;
    const definition = this.skillRegistry?.get?.(action.skillId) || null;
    if (!definition) {
      if (action.skillId && !this._warnedSkills.has(action.skillId)) {
        this._warnedSkills.add(action.skillId);
        console.warn(`EnemySkillDirector: 技能定义不存在，动作跳过: ${action.skillId}`);
      }
      return false;
    }
    const params = this._resolveParams(definition, action);
    const cooldownSeconds = Number(params.cooldown) || 0;
    if (cooldownSeconds > 0) {
      const lastUse = combat.skillCooldowns?.get?.(action.skillId) || 0;
      if (lastUse > 0 && now - lastUse < cooldownSeconds * 1000) return false;
    }
    const range = Number(params.range) > 0 ? Number(params.range) : (combat.attackRange || 40);
    return distance <= range;
  }

  /** 普攻动作：走 CombatSystem.performAttack（含 Boss telegraph/扑击管线）。 */
  _fireBasic(entity, combat, combatSystem, action, target, now, state) {
    if (!combat.canAttack?.(now)) return false;
    combatSystem?.performAttack?.(entity, target, now);
    this._commitAction(action, state, now);
    return true;
  }

  /** 技能动作：castTime>0 先进 telegraph 前摇，否则立即结算。 */
  _fireSkill(entity, combat, combatSystem, action, target, entities, now, state) {
    const definition = this.skillRegistry?.get?.(action.skillId) || null;
    if (!definition) return false;
    const params = this._resolveParams(definition, action);
    const castTimeMs = Math.max(0, Number(params.castTime) || 0);

    // 提交点：冷却/间隔在开始施法时记账（与 AbilitySystem.use 同语义）
    combat.skillCooldowns?.set?.(action.skillId, now);
    this._commitAction(action, state, now);

    const targetTransform = target?.getComponent?.('transform');
    const targetPos = targetTransform ? { x: targetTransform.position.x, y: targetTransform.position.y } : null;

    if (castTimeMs > 0) {
      const state = this._ensureState(entity.id);
      state.pendingCast = {
        actionId: action.id || action.skillId,
        skillId: action.skillId,
        definition,
        params,
        targetRef: target,
        targetPos,
        startedAt: now,
        windupMs: castTimeMs
      };
      combat.isCasting = true;
      combat.castingSkill = { id: action.skillId, name: definition.name || action.skillId, castTime: castTimeMs };
      combat.castStartTime = now;
      // 技能前摇走形状化 telegraph（circle/rect/polygon，由技能形状编辑决定），不与 attackDash 叠加
      const skillArea = resolveSkillArea(params, DEFAULT_SKILL_RADIUS);
      combatSystem?.attackTelegraphs?.set?.(entity.id, {
        startedAt: now,
        windupMs: castTimeMs,
        radius: skillArea.radius,
        shape: skillArea.shape,
        shapeData: skillArea.shape === 'rect'
          ? { width: skillArea.width, height: skillArea.height }
          : (skillArea.shape === 'polygon' ? { points: skillArea.points } : undefined),
        pathLength: 0,
        pathWidth: 0,
        knockbackMin: 0,
        knockbackMax: 0,
        attackerRef: entity,
        targetRef: target,
        name: definition.name || action.skillId
      });
      entity.getComponent?.('movement')?.stop?.();
      return true;
    }

    this._executeSkillCast(entity, definition, params, target, targetPos, entities, combatSystem, now);
    return true;
  }

  /** 前摇推进：到点删除 telegraph 并在锁定落点结算；目标死亡也照常结算（落点固定可躲避）。 */
  _advancePendingCast(entity, entities, combatSystem, state, now) {
    const pending = state.pendingCast;
    if (!pending) return;
    if (now - pending.startedAt < pending.windupMs) {
      entity.getComponent?.('movement')?.stop?.();
      return;
    }
    state.pendingCast = null;
    combatSystem?.attackTelegraphs?.delete?.(entity.id);
    entity.getComponent?.('combat')?.completeCast?.();
    const target = this._validTarget(entity, pending.targetRef);
    this._executeSkillCast(entity, pending.definition, pending.params, target, pending.targetPos, entities, combatSystem, now);
  }

  /** 复用 CombatSystem.executeSkill 完成表现与结算（敌我判定按施法者相对计算）。 */
  _executeSkillCast(entity, definition, params, target, targetPos, entities, combatSystem, now) {
    if (!combatSystem?.executeSkill) return;
    const targeting = definition.targeting;
    const selfTargeted = targeting === 'self';
    combatSystem.executeSkill({
      caster: entity,
      definition,
      view: definition,
      params,
      // entity 瞄准的技能也传 targetPosition：executeSkill 走 AOE 结算路径，
      // 以参数（含 paramsOverride.radius）为准，避免单体路径忽略 radius。
      target: selfTargeted ? null : (target || null),
      targetPosition: selfTargeted ? null : (targetPos || null),
      entities: Array.isArray(entities) ? entities : [],
      currentTime: now
    });
  }

  /** 动作触发记账：lastFiredAt + 为链式动作记锚点。 */
  _commitAction(action, state, now) {
    if (!action) return;
    if (action.id) state.lastFiredAt.set(action.id, now);
    this._anchorChainedActions(state.actions, action, state, now);
  }
}

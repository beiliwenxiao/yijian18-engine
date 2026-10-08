/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const countOf = value => Math.max(0, Math.floor(Number(value) || 0));
const durationOf = definition => {
  const value = definition?.time?.duration ?? definition?.timeLimit ?? null;
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
};

function objectivesOf(definition) {
  return Array.isArray(definition?.objectives) ? definition.objectives : [];
}

function objectiveProgress(definition, runtime) {
  return Object.fromEntries(objectivesOf(definition).map(objective => [
    objective.id, countOf(runtime?.objectiveProgress?.[objective.id])
  ]));
}

/**
 * 唯一任务纯解析器：仅将不可变定义、运行态快照与显式逻辑时间转换为下一份运行态草稿。
 * 不读取全局时钟/RNG，也不产生 UI、ECS、Trigger、存储副作用。
 */
export const QuestResolver = {
  initialRuntime(definition, { questRuntimeId, logicalTime = 0, repeat = null } = {}) {
    const duration = durationOf(definition);
    return {
      questRuntimeId,
      definitionId: definition?.id,
      state: 'active',
      objectiveProgress: Object.fromEntries(objectivesOf(definition).map(objective => [objective.id, 0])),
      acceptedLogicalTime: Math.max(0, Math.floor(Number(logicalTime) || 0)),
      remaining: duration,
      repeat: clone(repeat || { count: 0, lastTurnedInLogicalTime: null }),
      rewardSettlementLedger: [],
      tracking: false,
      stateRevision: 0
    };
  },

  isComplete(definition, runtime) {
    const objectives = objectivesOf(definition);
    if (!objectives.length) return false;
    return objectives.filter(objective => objective.optional !== true).every(objective => (
      countOf(runtime?.objectiveProgress?.[objective.id]) >= Math.max(1, countOf(objective.requiredCount) || 1)
    ));
  },

  progressPercent(definition, runtime) {
    const required = objectivesOf(definition).filter(objective => objective.optional !== true);
    if (!required.length) return 100;
    return required.reduce((sum, objective) => {
      const requiredCount = Math.max(1, countOf(objective.requiredCount) || 1);
      return sum + Math.min(100, countOf(runtime?.objectiveProgress?.[objective.id]) * 100 / requiredCount);
    }, 0) / required.length;
  },

  advance(definition, runtime, signal = {}, logicalTime = 0) {
    const base = clone(runtime);
    const now = Math.max(0, Math.floor(Number(logicalTime) || 0));
    if (!base || base.state !== 'active') return { runtime: base, changed: false, events: [] };
    const duration = durationOf(definition);
    const elapsed = Math.max(0, now - base.acceptedLogicalTime);
    if (duration !== null && elapsed >= duration) {
      return { runtime: { ...base, state: 'failed', remaining: 0, tracking: false }, changed: true, events: [{ type: 'questExpired' }] };
    }
    const remaining = duration === null ? null : Math.max(0, duration - elapsed);
    const progress = objectiveProgress(definition, base);
    const amount = Math.max(0, countOf(signal.amount) || 1);
    const events = [];
    let changed = remaining !== base.remaining;
    for (const objective of objectivesOf(definition)) {
      const matched = objective.type === signal.type && (objective.targetId == null || objective.targetId === signal.targetId);
      if (!matched) continue;
      const requiredCount = Math.max(1, countOf(objective.requiredCount) || 1);
      const current = progress[objective.id];
      const next = Math.min(requiredCount, current + amount);
      if (next === current) continue;
      progress[objective.id] = next;
      changed = true;
      events.push({ type: 'objectiveProgress', objectiveId: objective.id, current: next, required: requiredCount, done: next >= requiredCount });
    }
    if (!changed) return { runtime: base, changed: false, events: [] };
    const next = { ...base, objectiveProgress: progress, remaining };
    if (this.isComplete(definition, next)) {
      next.state = 'completed';
      events.push({ type: 'questCompleted' });
    }
    return { runtime: next, changed: true, events };
  },

  abandon(runtime) {
    if (!runtime || runtime.state !== 'active') return { runtime: clone(runtime), changed: false, events: [] };
    return { runtime: null, changed: true, events: [{ type: 'questAbandoned' }] };
  },

  setTracking(runtime, tracking) {
    if (!runtime || runtime.state !== 'active' || typeof tracking !== 'boolean' || runtime.tracking === tracking) {
      return { runtime: clone(runtime), changed: false, events: [] };
    }
    return { runtime: { ...clone(runtime), tracking }, changed: true, events: [{ type: 'questTrackingChanged', tracking }] };
  },

  turnIn(runtime, operationId, logicalTime = 0) {
    if (!runtime || runtime.state !== 'completed') return { runtime: clone(runtime), changed: false, events: [] };
    if (runtime.rewardSettlementLedger.includes(operationId)) return { runtime: clone(runtime), changed: false, events: [] };
    return {
      runtime: {
        ...clone(runtime),
        state: 'turned_in',
        tracking: false,
        repeat: { ...runtime.repeat, count: runtime.repeat.count + 1, lastTurnedInLogicalTime: Math.max(0, Math.floor(Number(logicalTime) || 0)) },
        rewardSettlementLedger: [...runtime.rewardSettlementLedger, operationId]
      },
      changed: true,
      events: [{ type: 'questTurnedIn' }]
    };
  },

  canRepeat(definition, runtime, logicalTime = 0) {
    const policy = definition?.repeatPolicy || (definition?.repeatable ? { cooldown: definition.repeatCooldown } : null);
    if (!policy || runtime?.state !== 'turned_in') return false;
    const max = policy.maxCompletions;
    if (Number.isInteger(max) && runtime.repeat.count >= max) return false;
    const cooldown = Math.max(0, Number(policy.cooldown ?? policy.cooldownDuration ?? 0) || 0);
    return Math.max(0, Number(logicalTime) || 0) - (runtime.repeat.lastTurnedInLogicalTime || 0) >= cooldown;
  },

  // 兼容旧调用方的纯 objective 快照接口。
  applyEvent(objectives, event) {
    const definition = { objectives: (objectives || []).map(objective => ({ ...objective })) };
    const runtime = { state: 'active', objectiveProgress: Object.fromEntries((objectives || []).map(objective => [objective.id, countOf(objective.currentCount)])), acceptedLogicalTime: 0, remaining: null };
    const result = this.advance(definition, runtime, event, 0);
    return {
      objectives: definition.objectives.map(objective => ({ ...objective, currentCount: result.runtime?.objectiveProgress?.[objective.id] || 0 })),
      changed: result.changed,
      completed: this.isComplete(definition, result.runtime),
      events: result.events
    };
  }
};

export default QuestResolver;

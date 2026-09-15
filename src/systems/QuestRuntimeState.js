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

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

export const QUEST_RUNTIME_SCHEMA_VERSION = 2;

const STATE_VALUES = new Set(['available', 'active', 'completed', 'turned_in', 'failed', 'locked']);
const RUNTIME_FIELDS = new Set([
  'questRuntimeId', 'definitionId', 'state', 'objectiveProgress', 'acceptedLogicalTime',
  'remaining', 'repeat', 'rewardSettlementLedger', 'tracking', 'stateRevision'
]);

function error(code, path, message) {
  return { code, path, message };
}

/**
 * 任务定义之外唯一可持久化的运行态值对象。
 * 它不保存任务文本、奖励或目标定义；所有写入由 QuestTransactionService 完成。
 */
export class QuestRuntimeState {
  constructor(value = {}) {
    const validation = QuestRuntimeState.validate(value);
    if (!validation.ok) throw new TypeError(validation.errors.map(item => `${item.path}: ${item.message}`).join('; '));
    Object.assign(this, clone(value));
    Object.freeze(this.objectiveProgress);
    Object.freeze(this.repeat);
    Object.freeze(this.rewardSettlementLedger);
    Object.freeze(this);
  }

  toJSON() {
    return clone({
      questRuntimeId: this.questRuntimeId,
      definitionId: this.definitionId,
      state: this.state,
      objectiveProgress: this.objectiveProgress,
      acceptedLogicalTime: this.acceptedLogicalTime,
      remaining: this.remaining,
      repeat: this.repeat,
      rewardSettlementLedger: this.rewardSettlementLedger,
      tracking: this.tracking,
      stateRevision: this.stateRevision
    });
  }

  static create({ questRuntimeId, definitionId, logicalTime = 0, remaining = null, repeat = null } = {}) {
    return new QuestRuntimeState({
      questRuntimeId,
      definitionId,
      state: 'active',
      objectiveProgress: {},
      acceptedLogicalTime: logicalTime,
      remaining,
      repeat: repeat || { count: 0, lastTurnedInLogicalTime: null },
      rewardSettlementLedger: [],
      tracking: false,
      stateRevision: 0
    });
  }

  static validate(value) {
    const errors = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: [error('typeMismatch', '', 'QuestRuntimeState 必须为对象')] };
    }
    for (const field of Object.keys(value)) {
      if (!RUNTIME_FIELDS.has(field)) errors.push(error('unknownField', field, 'QuestRuntimeState 不得包含定义或表现字段'));
    }
    for (const field of ['questRuntimeId', 'definitionId']) {
      if (typeof value[field] !== 'string' || !value[field].trim()) errors.push(error('missingField', field, '必须为非空稳定 ID'));
    }
    if (!STATE_VALUES.has(value.state)) errors.push(error('invalidState', 'state', '任务运行态 state 非法'));
    if (!value.objectiveProgress || typeof value.objectiveProgress !== 'object' || Array.isArray(value.objectiveProgress)) {
      errors.push(error('typeMismatch', 'objectiveProgress', '必须为目标进度对象'));
    } else {
      Object.entries(value.objectiveProgress).forEach(([id, count]) => {
        if (!id || !Number.isInteger(count) || count < 0) errors.push(error('invalidProgress', `objectiveProgress.${id}`, '目标进度必须为非负整数'));
      });
    }
    if (!Number.isInteger(value.acceptedLogicalTime) || value.acceptedLogicalTime < 0) errors.push(error('invalidClock', 'acceptedLogicalTime', '必须为非负逻辑时间'));
    if (value.remaining !== null && (!Number.isFinite(value.remaining) || value.remaining < 0)) errors.push(error('invalidRemaining', 'remaining', '必须为 null 或非负数'));
    if (!value.repeat || typeof value.repeat !== 'object' || Array.isArray(value.repeat)
      || !Number.isInteger(value.repeat.count) || value.repeat.count < 0
      || (value.repeat.lastTurnedInLogicalTime !== null && (!Number.isInteger(value.repeat.lastTurnedInLogicalTime) || value.repeat.lastTurnedInLogicalTime < 0))) {
      errors.push(error('invalidRepeat', 'repeat', '重复任务状态非法'));
    }
    if (!Array.isArray(value.rewardSettlementLedger) || value.rewardSettlementLedger.some(entry => typeof entry !== 'string' || !entry)) {
      errors.push(error('invalidLedger', 'rewardSettlementLedger', '奖励结算账本必须为稳定 operationId 数组'));
    }
    if (typeof value.tracking !== 'boolean') errors.push(error('typeMismatch', 'tracking', '必须为布尔值'));
    if (!Number.isInteger(value.stateRevision) || value.stateRevision < 0) errors.push(error('invalidRevision', 'stateRevision', '必须为非负整数'));
    return { ok: errors.length === 0, errors };
  }
}

export default QuestRuntimeState;

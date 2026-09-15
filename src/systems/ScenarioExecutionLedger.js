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

const STATUSES = new Set(['idle', 'running', 'succeeded', 'failed']);
const TERMINAL = new Set(['succeeded', 'failed']);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function freezeRecord(record) {
  return Object.freeze(clone(record));
}

/**
 * Trigger 编排技术账本。result 只允许保存 CommandResult 的技术摘要，
 * 不保存 Story/Quest/Dialogue 等服务事实或 action value/payload。
 */
export class ScenarioExecutionLedger {
  constructor() {
    this._records = new Map();
    this._stateRevisions = new Map();
  }

  registerIdle(triggerId, definitionRevision) {
    if (this._records.has(triggerId)) return this.get(triggerId);
    return this._replace(triggerId, {
      triggerId, definitionRevision, eventId: null, operationId: null, fingerprint: null,
      status: 'idle', actionIndex: -1, result: null,
      startedAt: null, finishedAt: null
    });
  }

  begin({ triggerId, definitionRevision, eventId = null, operationId, fingerprint, startedAt }) {
    if (!hasText(operationId) || !hasText(fingerprint)) throw new TypeError('Scenario execution requires operationId/fingerprint');
    if (eventId !== null && !hasText(eventId)) throw new TypeError('Scenario execution eventId must be a non-empty string or null');
    return this._replace(triggerId, {
      triggerId, definitionRevision, eventId, operationId, fingerprint,
      status: 'running', actionIndex: 0, result: null,
      startedAt, finishedAt: null
    });
  }

  advance(triggerId, operationId, actionIndex, result) {
    const current = this._records.get(triggerId);
    if (!current || current.status !== 'running' || current.operationId !== operationId) {
      throw new Error('Scenario execution is not the active owner');
    }
    return this._replace(triggerId, { ...current, actionIndex, result: technicalResult(result) });
  }

  finish(triggerId, operationId, status, result, finishedAt) {
    if (!TERMINAL.has(status)) throw new TypeError('Scenario execution terminal status is invalid');
    const current = this._records.get(triggerId);
    if (!current || current.operationId !== operationId) throw new Error('Scenario execution owner mismatch');
    return this._replace(triggerId, {
      ...current, status, result: technicalResult(result), finishedAt
    });
  }

  get(triggerId) {
    const record = this._records.get(triggerId);
    return record ? freezeRecord(record) : null;
  }

  all() {
    return Object.freeze([...this._records.values()].map(freezeRecord));
  }

  snapshot() {
    return { version: 1, records: this.all().map(clone) };
  }

  validateSnapshot(snapshot) {
    const errors = [];
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.records)) {
      return { ok: false, errors: [{ code: 'invalidScenarioLedger', path: 'ledger', message: 'ScenarioExecutionLedger snapshot 非法' }] };
    }
    const ids = new Set();
    snapshot.records.forEach((record, index) => {
      const path = `ledger.records[${index}]`;
      if (!hasText(record?.triggerId)) errors.push({ code: 'invalidReference', path: `${path}.triggerId`, message: 'triggerId 必须为非空字符串' });
      else if (ids.has(record.triggerId)) errors.push({ code: 'duplicateId', path: `${path}.triggerId`, message: 'triggerId 重复' });
      else ids.add(record.triggerId);
      if (!STATUSES.has(record?.status)) errors.push({ code: 'invalidState', path: `${path}.status`, message: 'ledger status 非法' });
      if (!Number.isInteger(record?.actionIndex) || record.actionIndex < -1) errors.push({ code: 'invalidState', path: `${path}.actionIndex`, message: 'actionIndex 非法' });
      if (record?.eventId !== null && record?.eventId !== undefined && !hasText(record.eventId)) {
        errors.push({ code: 'invalidEventId', path: `${path}.eventId`, message: 'eventId 必须是非空字符串或 null' });
      }
      if (record?.status !== 'idle' && (!hasText(record.operationId) || !hasText(record.fingerprint))) {
        errors.push({ code: 'invalidFingerprint', path, message: '非 idle ledger 必须包含 operationId/fingerprint' });
      }
      if (record?.result != null && !isTechnicalResult(record.result)) {
        errors.push({ code: 'businessFactLeak', path: `${path}.result`, message: 'ledger result 只能保存 CommandResult 技术摘要' });
      }
    });
    return { ok: errors.length === 0, errors };
  }

  restore(snapshot) {
    const validation = this.validateSnapshot(snapshot);
    if (!validation.ok) throw new TypeError(validation.errors[0].message);
    const next = new Map();
    const revisions = new Map();
    for (const saved of snapshot.records) {
      const record = clone(saved);
      if (record.status === 'running') {
        record.status = 'failed';
        record.finishedAt = record.finishedAt ?? record.startedAt;
        record.result = technicalResult({
          ok: false, operationId: record.operationId, status: 'failed', committed: false,
          code: 'triggerInterrupted', stateId: `trigger:${record.triggerId}`, stateRevision: null
        });
      }
      next.set(record.triggerId, record);
      revisions.set(record.triggerId, Number.isInteger(record.ledgerRevision) ? record.ledgerRevision : 0);
    }
    this._records = next;
    this._stateRevisions = revisions;
    return this;
  }

  _replace(triggerId, record) {
    const ledgerRevision = (this._stateRevisions.get(triggerId) || 0) + 1;
    const next = { ...clone(record), ledgerRevision };
    this._stateRevisions.set(triggerId, ledgerRevision);
    this._records.set(triggerId, next);
    return freezeRecord(next);
  }
}

export function technicalResult(result) {
  if (result == null) return null;
  return {
    ok: result.ok === true,
    operationId: typeof result.operationId === 'string' ? result.operationId : null,
    status: typeof result.status === 'string' ? result.status : (result.ok === true ? 'succeeded' : 'failed'),
    committed: result.committed === true,
    code: typeof result.code === 'string' ? result.code : null,
    stateId: typeof result.stateId === 'string' ? result.stateId : null,
    stateRevision: Number.isInteger(result.stateRevision) ? result.stateRevision : null
  };
}

function isTechnicalResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set(['ok', 'operationId', 'status', 'committed', 'code', 'stateId', 'stateRevision']);
  return Object.keys(value).every(key => allowed.has(key))
    && typeof value.ok === 'boolean'
    && typeof value.status === 'string'
    && typeof value.committed === 'boolean';
}

export default ScenarioExecutionLedger;
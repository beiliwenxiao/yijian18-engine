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

export const EVENT_JOURNAL_SCHEMA_VERSION = 1;

const EVENT_STATUS = new Set(['pending', 'running', 'succeeded', 'blocked', 'failed', 'cancelled']);
const TERMINAL_STATUS = new Set(['succeeded', 'blocked', 'failed', 'cancelled']);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const hasText = value => typeof value === 'string' && value.trim().length > 0;

function error(code, path, message) {
  return { code, path, message };
}

function executionKey(triggerId, stepId) {
  return `${triggerId}:${stepId}`;
}

/**
 * 全局事件账本：事件实例是业务事实，Trigger 只是事件消费者。
 * 账本只保存可序列化身份、载荷指纹与执行结果，不保存 Scene、UI 或渲染对象。
 */
export class EventJournal {
  constructor({ runId = 'run-unknown', maxEvents = 2048 } = {}) {
    if (!hasText(runId)) throw new TypeError('EventJournal requires runId');
    this.runId = runId;
    this.maxEvents = Math.max(64, Math.floor(Number(maxEvents) || 2048));
    this.nextSequence = 0;
    this.events = new Map();
    this.order = [];
  }

  create({ eventId = null, eventDefinitionId = null, type, source = null, actorRef = null, sceneId = null, payload = {}, logicalTime = 0, persistent = true } = {}) {
    const resolvedEventId = hasText(eventId)
      ? eventId.trim()
      : `evt:${this.runId}:${String(++this.nextSequence).padStart(10, '0')}`;
    if (this.events.has(resolvedEventId)) return clone(this.events.get(resolvedEventId));
    if (!hasText(type)) throw new TypeError('EventJournal event type is required');
    const record = {
      eventId: resolvedEventId,
      eventDefinitionId: hasText(eventDefinitionId) ? eventDefinitionId.trim() : null,
      type: type.trim(),
      source: source == null ? null : clone(source),
      actorRef: hasText(actorRef) ? actorRef.trim() : null,
      sceneId: hasText(sceneId) ? sceneId.trim() : null,
      payload: clone(payload || {}),
      logicalTime: Math.max(0, Math.floor(Number(logicalTime) || 0)),
      persistent: persistent !== false,
      status: 'pending',
      executions: {},
      result: null
    };
    this.events.set(resolvedEventId, record);
    this.order.push(resolvedEventId);
    this._trim();
    return clone(record);
  }

  get(eventId) {
    return this.events.has(eventId) ? clone(this.events.get(eventId)) : null;
  }

  beginExecution({ eventId, triggerId, stepId, operationId, payloadFingerprint, logicalTime = 0 } = {}) {
    const record = this.events.get(eventId);
    if (!record) return { ok: false, code: 'unknownEventId' };
    if (!hasText(triggerId) || !hasText(stepId) || !hasText(operationId) || !hasText(payloadFingerprint)) {
      return { ok: false, code: 'invalidEventExecution' };
    }
    const key = executionKey(triggerId, stepId);
    const existing = record.executions[key];
    if (existing) {
      if (existing.operationId !== operationId || existing.payloadFingerprint !== payloadFingerprint) {
        return { ok: false, code: 'eventExecutionConflict', execution: clone(existing) };
      }
      return { ok: true, idempotent: true, execution: clone(existing) };
    }
    const execution = {
      triggerId, stepId, operationId, payloadFingerprint,
      status: 'running',
      startedLogicalTime: Math.max(0, Math.floor(Number(logicalTime) || 0)),
      finishedLogicalTime: null,
      result: null
    };
    record.executions[key] = execution;
    record.status = 'running';
    return { ok: true, execution: clone(execution) };
  }

  completeExecution({ eventId, triggerId, stepId, status, result = null, logicalTime = 0 } = {}) {
    const record = this.events.get(eventId);
    const execution = record?.executions?.[executionKey(triggerId, stepId)];
    if (!record || !execution) return { ok: false, code: 'unknownEventExecution' };
    if (!EVENT_STATUS.has(status)) return { ok: false, code: 'invalidEventStatus' };
    execution.status = status;
    execution.result = result == null ? null : clone(result);
    execution.finishedLogicalTime = Math.max(0, Math.floor(Number(logicalTime) || 0));
    const executions = Object.values(record.executions);
    record.status = executions.some(entry => entry.status === 'running') ? 'running'
      : executions.some(entry => entry.status === 'failed') ? 'failed'
        : executions.some(entry => entry.status === 'blocked') ? 'blocked'
          : executions.length > 0 && executions.every(entry => TERMINAL_STATUS.has(entry.status)) ? 'succeeded'
            : 'pending';
    record.result = record.status === 'succeeded' ? clone(result) : null;
    return { ok: true, event: clone(record) };
  }

  recordCommitted({ eventId = null, type, operationId, logicalTime, payload = {}, stateId = null, stateType = null, stateRevision = null, eventSequence = null } = {}) {
    const record = this.create({
      eventId,
      eventDefinitionId: type,
      type,
      source: { kind: 'postCommitNotification', operationId },
      payload: { ...clone(payload || {}), stateId, stateType, stateRevision, eventSequence },
      logicalTime,
      persistent: true
    });
    const key = 'postCommit:published';
    if (!this.events.get(record.eventId).executions[key]) {
      this.beginExecution({
        eventId: record.eventId,
        triggerId: 'postCommit',
        stepId: 'published',
        operationId: operationId || `op:${record.eventId}:postCommit:published`,
        payloadFingerprint: JSON.stringify({ type, operationId, eventSequence }),
        logicalTime
      });
      this.completeExecution({
        eventId: record.eventId,
        triggerId: 'postCommit',
        stepId: 'published',
        status: 'succeeded',
        logicalTime
      });
    }
    return this.get(record.eventId);
  }

  snapshot() {
    return {
      schemaVersion: EVENT_JOURNAL_SCHEMA_VERSION,
      runId: this.runId,
      nextSequence: this.nextSequence,
      events: this.order.map(eventId => this.events.get(eventId)).filter(Boolean).map(clone)
    };
  }

  validate(snapshot) {
    const errors = [];
    if (!snapshot || snapshot.schemaVersion !== EVENT_JOURNAL_SCHEMA_VERSION) {
      return { ok: false, errors: [error('invalidEventJournalSchema', 'schemaVersion', '事件账本版本不兼容')] };
    }
    if (!hasText(snapshot.runId)) errors.push(error('invalidEventRunId', 'runId', 'runId 必须是稳定非空字符串'));
    if (!Number.isInteger(snapshot.nextSequence) || snapshot.nextSequence < 0) errors.push(error('invalidEventSequence', 'nextSequence', 'nextSequence 必须是非负整数'));
    if (!Array.isArray(snapshot.events)) errors.push(error('invalidEventList', 'events', 'events 必须是数组'));
    const ids = new Set();
    for (const [index, record] of (snapshot.events || []).entries()) {
      const path = `events[${index}]`;
      if (!hasText(record?.eventId) || ids.has(record.eventId)) errors.push(error('invalidEventId', `${path}.eventId`, 'eventId 缺失或重复'));
      ids.add(record?.eventId);
      if (!hasText(record?.type)) errors.push(error('invalidEventType', `${path}.type`, '事件 type 缺失'));
      if (!EVENT_STATUS.has(record?.status)) errors.push(error('invalidEventStatus', `${path}.status`, '事件状态非法'));
      if (!record?.executions || typeof record.executions !== 'object' || Array.isArray(record.executions)) {
        errors.push(error('invalidEventExecutions', `${path}.executions`, 'executions 必须是对象'));
      }
    }
    return { ok: errors.length === 0, errors };
  }

  restore(snapshot) {
    const validation = this.validate(snapshot);
    if (!validation.ok) return validation;
    const events = new Map(snapshot.events.map(record => [record.eventId, clone(record)]));
    this.runId = snapshot.runId;
    this.nextSequence = snapshot.nextSequence;
    this.events = events;
    this.order = snapshot.events.map(record => record.eventId);
    return { ok: true, errors: [] };
  }

  asSnapshotProvider() {
    return {
      snapshot: () => this.snapshot(),
      validate: snapshot => this.validate(snapshot),
      restore: snapshot => this.restore(snapshot),
      required: true
    };
  }

  _trim() {
    while (this.order.length > this.maxEvents) {
      const eventId = this.order.shift();
      const record = this.events.get(eventId);
      if (record?.persistent !== false) {
        this.order.push(eventId);
        break;
      }
      this.events.delete(eventId);
    }
  }
}

export default EventJournal;

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
const EXECUTION_STATUS = new Set(['running', 'succeeded', 'blocked', 'failed', 'cancelled', 'skipped']);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const hasText = value => typeof value === 'string' && value.trim().length > 0;

let fallbackRunSequence = 0;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function fingerprint(value) {
  return JSON.stringify(stableValue(value));
}

function createRunId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `run-${uuid}`;
  fallbackRunSequence += 1;
  return `run-${Date.now().toString(36)}-${fallbackRunSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function error(code, path, message, details = null) {
  return { code, path, message, ...(details ? { details } : {}) };
}

function executionKey(triggerId, stepId) {
  return `${triggerId}:${stepId}`;
}

function eventPayloadFingerprint(value = {}) {
  return fingerprint({
    eventDefinitionId: value.eventDefinitionId || null,
    type: value.type,
    source: value.source ?? null,
    actorRef: value.actorRef || null,
    sceneId: value.sceneId || null,
    payload: value.payload || {}
  });
}

/** 全局事件账本：只保存可序列化事件事实和步骤执行证据。 */
export class EventJournal {
  constructor({ runId = null, maxEvents = 2048 } = {}) {
    this.runId = hasText(runId) ? runId.trim() : createRunId();
    this.maxEvents = Math.max(64, Math.floor(Number(maxEvents) || 2048));
    this.nextSequence = 0;
    this.events = new Map();
    this.order = [];
  }

  create({ eventId = null, eventDefinitionId = null, type, source = null, actorRef = null, sceneId = null, payload = {}, logicalTime = 0, persistent = true } = {}) {
    if (!hasText(type)) throw new TypeError('EventJournal event type is required');
    const candidate = {
      eventDefinitionId: hasText(eventDefinitionId) ? eventDefinitionId.trim() : null,
      type: type.trim(),
      source: source == null ? null : clone(source),
      actorRef: hasText(actorRef) ? actorRef.trim() : null,
      sceneId: hasText(sceneId) ? sceneId.trim() : null,
      payload: clone(payload || {})
    };
    const resolvedEventId = hasText(eventId)
      ? eventId.trim()
      : `evt:${this.runId}:${String(++this.nextSequence).padStart(10, '0')}`;
    const payloadFingerprint = eventPayloadFingerprint(candidate);
    const existing = this.events.get(resolvedEventId);
    if (existing) {
      if (existing.payloadFingerprint !== payloadFingerprint) {
        const conflict = new Error('eventId already belongs to a different canonical event payload');
        conflict.code = 'eventPayloadConflict';
        conflict.details = {
          eventId: resolvedEventId,
          currentPayloadFingerprint: payloadFingerprint,
          existingPayloadFingerprint: existing.payloadFingerprint
        };
        throw conflict;
      }
      return clone(existing);
    }
    const sequenceMatch = resolvedEventId.match(new RegExp(`^evt:${this.runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)$`));
    if (sequenceMatch) this.nextSequence = Math.max(this.nextSequence, Number(sequenceMatch[1]) || 0);
    const record = {
      eventId: resolvedEventId,
      ...candidate,
      payloadFingerprint,
      logicalTime: Math.max(0, Math.floor(Number(logicalTime) || 0)),
      persistent: persistent !== false,
      status: 'pending',
      executions: {},
      result: null
    };
    this.events.set(resolvedEventId, record);
    this.order.push(resolvedEventId);
    this._trimTransientEvents();
    return clone(record);
  }

  get(eventId) {
    return this.events.has(eventId) ? clone(this.events.get(eventId)) : null;
  }

  getExecution(eventId, triggerId, stepId) {
    const execution = this.events.get(eventId)?.executions?.[executionKey(triggerId, stepId)];
    return execution ? clone(execution) : null;
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
      return {
        ok: true,
        idempotent: true,
        replay: existing.status !== 'running',
        execution: clone(existing)
      };
    }
    const execution = {
      triggerId: triggerId.trim(),
      stepId: stepId.trim(),
      operationId: operationId.trim(),
      payloadFingerprint,
      status: 'running',
      startedLogicalTime: Math.max(0, Math.floor(Number(logicalTime) || 0)),
      finishedLogicalTime: null,
      result: null
    };
    record.executions[key] = execution;
    record.status = 'running';
    return { ok: true, idempotent: false, replay: false, execution: clone(execution) };
  }

  completeExecution({ eventId, triggerId, stepId, status, result = null, logicalTime = 0 } = {}) {
    const record = this.events.get(eventId);
    const execution = record?.executions?.[executionKey(triggerId, stepId)];
    if (!record || !execution) return { ok: false, code: 'unknownEventExecution' };
    if (!EXECUTION_STATUS.has(status) || status === 'running') return { ok: false, code: 'invalidEventStatus' };
    if (execution.status !== 'running') {
      const sameResult = fingerprint(execution.result) === fingerprint(result == null ? null : result);
      return sameResult
        ? { ok: true, idempotent: true, event: clone(record) }
        : { ok: false, code: 'eventExecutionResultConflict', execution: clone(execution) };
    }
    execution.status = status;
    execution.result = result == null ? null : clone(result);
    execution.finishedLogicalTime = Math.max(0, Math.floor(Number(logicalTime) || 0));
    this._refreshEventStatus(record);
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
    if (!this.getExecution(record.eventId, 'postCommit', 'published')) {
      this.beginExecution({
        eventId: record.eventId,
        triggerId: 'postCommit',
        stepId: 'published',
        operationId: operationId || `op:${record.eventId}:postCommit:published`,
        payloadFingerprint: fingerprint({ type, operationId, eventSequence }),
        logicalTime
      });
      this.completeExecution({
        eventId: record.eventId,
        triggerId: 'postCommit',
        stepId: 'published',
        status: 'succeeded',
        result: { eventSequence },
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
    if (!Array.isArray(snapshot.events)) return { ok: false, errors: [...errors, error('invalidEventList', 'events', 'events 必须是数组')] };
    const ids = new Set();
    for (const [index, record] of snapshot.events.entries()) {
      const path = `events[${index}]`;
      if (!hasText(record?.eventId) || ids.has(record.eventId)) errors.push(error('invalidEventId', `${path}.eventId`, 'eventId 缺失或重复'));
      ids.add(record?.eventId);
      if (!hasText(record?.type)) errors.push(error('invalidEventType', `${path}.type`, '事件 type 缺失'));
      if (!hasText(record?.payloadFingerprint) || record.payloadFingerprint !== eventPayloadFingerprint(record)) {
        errors.push(error('invalidEventPayloadFingerprint', `${path}.payloadFingerprint`, '事件载荷指纹不匹配'));
      }
      if (!EVENT_STATUS.has(record?.status)) errors.push(error('invalidEventStatus', `${path}.status`, '事件状态非法'));
      if (!Number.isInteger(record?.logicalTime) || record.logicalTime < 0) errors.push(error('invalidEventLogicalTime', `${path}.logicalTime`, '事件逻辑时间非法'));
      if (typeof record?.persistent !== 'boolean') errors.push(error('invalidEventPersistence', `${path}.persistent`, 'persistent 必须是布尔值'));
      if (!record?.executions || typeof record.executions !== 'object' || Array.isArray(record.executions)) {
        errors.push(error('invalidEventExecutions', `${path}.executions`, 'executions 必须是对象'));
        continue;
      }
      for (const [key, execution] of Object.entries(record.executions)) {
        const executionPath = `${path}.executions.${key}`;
        if (!hasText(execution?.triggerId) || !hasText(execution?.stepId)
          || key !== executionKey(execution.triggerId, execution.stepId)) {
          errors.push(error('invalidEventExecutionKey', executionPath, '执行节点身份与索引不一致'));
        }
        if (!hasText(execution?.operationId) || !hasText(execution?.payloadFingerprint)) {
          errors.push(error('invalidEventExecutionIdentity', executionPath, '执行节点缺少 operationId 或 payloadFingerprint'));
        }
        if (!EXECUTION_STATUS.has(execution?.status)) errors.push(error('invalidEventExecutionStatus', `${executionPath}.status`, '执行节点状态非法'));
        if (!Number.isInteger(execution?.startedLogicalTime) || execution.startedLogicalTime < 0) {
          errors.push(error('invalidEventExecutionTime', `${executionPath}.startedLogicalTime`, '执行开始时间非法'));
        }
        if (execution.finishedLogicalTime !== null
          && (!Number.isInteger(execution.finishedLogicalTime) || execution.finishedLogicalTime < execution.startedLogicalTime)) {
          errors.push(error('invalidEventExecutionTime', `${executionPath}.finishedLogicalTime`, '执行完成时间非法'));
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  restore(snapshot) {
    const validation = this.validate(snapshot);
    if (!validation.ok) return validation;
    const restoredEvents = snapshot.events.map(raw => {
      const record = clone(raw);
      for (const execution of Object.values(record.executions)) {
        if (execution.status !== 'running') continue;
        execution.status = 'failed';
        execution.finishedLogicalTime = Math.max(record.logicalTime, execution.startedLogicalTime);
        execution.result = { ok: false, code: 'eventExecutionInterrupted' };
      }
      this._refreshEventStatus(record);
      return record;
    });
    this.runId = snapshot.runId;
    this.nextSequence = snapshot.nextSequence;
    this.events = new Map(restoredEvents.map(record => [record.eventId, record]));
    this.order = restoredEvents.map(record => record.eventId);
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

  _refreshEventStatus(record) {
    const executions = Object.values(record.executions);
    if (executions.some(entry => entry.status === 'running')) record.status = 'running';
    else if (executions.some(entry => entry.status === 'failed')) record.status = 'failed';
    else if (executions.some(entry => entry.status === 'blocked')) record.status = 'blocked';
    else if (executions.some(entry => entry.status === 'cancelled')) record.status = 'cancelled';
    else if (executions.length > 0 && executions.every(entry => ['succeeded', 'skipped'].includes(entry.status))) record.status = 'succeeded';
    else record.status = 'pending';
    record.result = record.status === 'succeeded'
      ? clone(executions.at(-1)?.result || null)
      : null;
  }

  _trimTransientEvents() {
    if (this.order.length <= this.maxEvents) return;
    for (let index = 0; index < this.order.length && this.order.length > this.maxEvents;) {
      const eventId = this.order[index];
      const record = this.events.get(eventId);
      if (record?.persistent !== false || record.status === 'running' || record.status === 'pending') {
        index += 1;
        continue;
      }
      this.order.splice(index, 1);
      this.events.delete(eventId);
    }
  }
}

export default EventJournal;

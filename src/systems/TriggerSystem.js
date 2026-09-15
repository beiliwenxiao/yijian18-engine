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

import { ExpressionEngine } from './ExpressionEngine.js';
import { MonotonicClock } from '../core/command/AuthorityClocks.js';
import { EventJournal } from '../core/events/EventJournal.js';
import { normalizeRuntimeDebugMode } from '../core/CanonicalSnapshot.js';
import { stableDigest } from '../core/StableDigest.js';
import { assertCommandContract, CommandContractKind } from '../core/command/CommandContracts.js';
import { ScenarioExecutionLedger, technicalResult } from './ScenarioExecutionLedger.js';
import { createTriggerFailureEnvelope, TriggerExecutionError } from './TriggerFailureEnvelope.js';

const REENTRY_POLICIES = new Set(['reject', 'queue', 'restart']);
const CATCH_UP_POLICIES = new Set(['resume', 'skip', 'single', 'all']);
const COORDINATION_POLICIES = new Set(['broadcast', 'firstSuccess']);
const TRIGGER_SNAPSHOT_SCHEMA_VERSION = 3;
// 幂等护栏：这些 code 表示「条件未就绪/已被他路完成」，语义等同步骤级 if 跳过，
// 不应中断整链、刷红 DebugPanel 或触发事件重试。可通过 config.benignResultCodes 覆盖。
const DEFAULT_BENIGN_RESULT_CODES = new Set([
  'preconditionFailed', 'notReady', 'alreadyCommitted', 'alreadyDone',
  'alreadyProcessed', 'idempotent', 'notApplicable', 'skippedByPolicy'
]);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function getRestoredOperationSequence(ledger = null) {
  let sequence = 0;
  for (const record of ledger?.records || []) {
    const match = String(record?.operationId || '').match(/^trigger:[^:]+:[^:]+:(?:(\d+):)?(\d+)(?::|$)/);
    if (match) sequence = Math.max(sequence, Number(match[2] || match[1]) || 0);
  }
  return sequence;
}

const coordinationOf = trigger => {
  const value = trigger?.coordination || {};
  return {
    group: hasText(value.group) ? value.group.trim() : null,
    priority: Number.isInteger(value.priority) ? value.priority : 0,
    policy: hasText(value.policy) ? value.policy : 'broadcast'
  };
};

function errorResult(operationId, triggerId, error, code = null) {
  const details = Array.isArray(error?.details)
    ? clone(error.details)
    : (Array.isArray(error?.errors) ? clone(error.errors) : []);
  return {
    ok: false, operationId, status: 'failed', committed: false,
    code: code || error?.code || 'triggerActionFailed',
    stateId: `trigger:${triggerId}`, stateRevision: null,
    eventFrom: null, eventTo: null, value: null,
    error: {
      message: error?.message || String(error || 'trigger action failed'),
      ...(details.length > 0 ? { details } : {})
    }
  };
}

/**
 * Legacy action 可以编排已提交命令后的表现，但本身不是 authority handler。
 * 只有回传真实稳定 stateId 和已提交 stateRevision 的 CommandResult 才可记录为 committed。
 */
function normalizeLegacyResult(value, operationId, triggerId) {
  if (value === false || value?.ok === false) {
    const rejection = value === false
      ? { code: 'actionRejected', message: 'legacy action returned false' }
      : value;
    return {
      ...errorResult(operationId, triggerId, rejection.error || rejection, rejection.code || 'actionRejected'),
      status: rejection.status || 'failed'
    };
  }
  const hasCommittedRevision = value?.committed === true
    && hasText(value?.stateId)
    && Number.isInteger(value.stateRevision);
  return {
    ok: true,
    operationId,
    status: value?.status || (hasCommittedRevision ? 'committed' : 'succeeded'),
    committed: hasCommittedRevision,
    code: null,
    stateId: hasCommittedRevision ? value.stateId : `trigger:${triggerId}`,
    stateRevision: hasCommittedRevision ? value.stateRevision : null,
    eventFrom: null,
    eventTo: null,
    value: null,
    error: null
  };
}

/** Trigger 唯一编排内核：只保存技术状态，业务事实由各自 service/provider 拥有。 */
export class TriggerSystem {
  constructor(config = {}) {
    this.triggers = [];
    this._triggersById = new Map();
    this.actions = Object.create(null);
    this.actionDescriptorRegistry = config.actionDescriptorRegistry || null;
    this.commandAdapter = config.commandAdapter || null;
    this.monotonicClock = config.monotonicClock || new MonotonicClock();
    this.logicalClock = config.logicalClock || null;
    this._advanceClockOnUpdate = config.advanceClockOnUpdate ?? !config.monotonicClock;
    this.operationIdFactory = config.operationIdFactory || (({
      triggerId, definitionRevision, sequence, monotonicTime = 0
    }) => (
      `trigger:${definitionRevision}:${triggerId}:${Math.max(0, Math.floor(monotonicTime * 1000))}:${sequence}`
    ));
    this.eventJournal = config.eventJournal || null;
    this.applicationEventPublisher = config.applicationEventPublisher || null;
    this.definitionRevision = config.definitionRevision ?? 0;
    this.serviceReferenceResolver = config.serviceReferenceResolver || null;
    this.bindingReferenceResolver = config.bindingReferenceResolver || null;
    this.operationFingerprintValidator = config.operationFingerprintValidator || null;
    this.runtimeConfig = config.runtimeConfig || null;
    this.debugMode = normalizeRuntimeDebugMode(this.runtimeConfig?.debug);
    this.sceneDiagnostics = config.sceneDiagnostics || null;
    this.benignResultCodes = new Set(config.benignResultCodes
      ? (Array.isArray(config.benignResultCodes) ? config.benignResultCodes : Object.keys(config.benignResultCodes))
      : DEFAULT_BENIGN_RESULT_CODES);
    this.ctx = {};
    this.expr = new ExpressionEngine({});
    this.ledger = new ScenarioExecutionLedger();
    this._firedOnce = new Set();
    this._cooldowns = Object.create(null);
    this._timers = [];
    this._listeners = [];
    this._active = new Map();
    this._queues = new Map();
    this._coordinationTails = new Map();
    this._coordinationGeneration = 0;
    this._operationSequence = 0;
    this._eventSequence = 0;
  }

  init(ctx = {}) {
    this.ctx = { ...ctx, triggerSystem: this };
    this.runtimeConfig = ctx.runtimeConfig || this.runtimeConfig;
    this.debugMode = normalizeRuntimeDebugMode(this.runtimeConfig?.debug);
    this.sceneDiagnostics = ctx.sceneDiagnostics || ctx.services?.diagnostics || this.sceneDiagnostics;
    this.eventJournal = ctx.eventJournal
      || ctx.services?.eventJournal
      || ctx.scene?.sceneRuntime?.eventJournal
      || this.eventJournal;
    this.definitionRevision = ctx.runtimeConfig?.definitionRevision
      ?? ctx.definitionRepository?.definitionRevision
      ?? this.definitionRevision;
    this.expr.setContext(this.ctx);
  }

  updateContext(patch = {}) {
    this.ctx = { ...this.ctx, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'runtimeConfig')) {
      this.runtimeConfig = patch.runtimeConfig;
      this.debugMode = normalizeRuntimeDebugMode(this.runtimeConfig?.debug);
    }
    this.sceneDiagnostics = patch.sceneDiagnostics || patch.services?.diagnostics || this.sceneDiagnostics;
    this.expr.setContext(this.ctx);
  }

  isDebugEnabled() {
    return this.debugMode === true;
  }

  configureActionExecution({ actionDescriptorRegistry = null, commandAdapter = null } = {}) {
    this.actionDescriptorRegistry = actionDescriptorRegistry;
    this.commandAdapter = commandAdapter;
    return this;
  }

  /** 迁移期兼容 action；返回值会被等待并归一化为完整 CommandResult。 */
  registerAction(name, fn) {
    if (!hasText(name) || typeof fn !== 'function') throw new TypeError('Trigger action requires name/function');
    this.actions[name] = fn;
  }

  registerActions(map = {}) {
    for (const [name, fn] of Object.entries(map)) this.registerAction(name, fn);
  }

  _validateSceneEventReference(trigger) {
    // 全 Trigger 化后 flowGroupId/sceneEventId 仅为兼容标签：只要求非空字符串，
    // 不再要求所属 FlowGroup 已登记（flowGroups/sceneEvents 目录已清空为 []）。
    const hasFg = Object.prototype.hasOwnProperty.call(trigger, 'flowGroupId');
    const hasSe = Object.prototype.hasOwnProperty.call(trigger, 'sceneEventId');
    if (!hasFg && !hasSe) return true;
    const fgId = typeof trigger?.flowGroupId === 'string' ? trigger.flowGroupId.trim() : '';
    const seId = typeof trigger?.sceneEventId === 'string' ? trigger.sceneEventId.trim() : '';
    const resolved = fgId || seId;
    const label = hasFg ? 'flowGroupId' : 'sceneEventId';
    if (!resolved) {
      throw new Error(`TriggerSystem.register: ${trigger?.id || '<unknown>'}.${label} 必须是非空字符串（兼容 sceneEventId）`);
    }
    return true;
  }

  register(trigger) {
    if (!trigger || !hasText(trigger.id)) throw new Error('TriggerSystem.register: trigger.id 必须是非空字符串');
    if (!trigger.when?.type) throw new Error(`TriggerSystem.register: ${trigger.id}.when.type 不能为空`);
    this._validateSceneEventReference(trigger);
    this._validateActionStepDefinitions(trigger);
    if (this._triggersById.has(trigger.id)) throw new Error(`TriggerSystem.register: 重复 trigger.id "${trigger.id}"（triggers/tutorials 共用命名空间）`);
    const policy = this._reentryPolicy(trigger);
    if (!REENTRY_POLICIES.has(policy)) throw new Error(`TriggerSystem.register: ${trigger.id}.reentryPolicy 非法`);
    this._validateCoordinationDefinition(trigger);
    this.triggers.push(trigger);
    this._triggersById.set(trigger.id, trigger);
    this.ledger.registerIdle(trigger.id, this.definitionRevision);
    if (trigger.when.type === 'timer') this._timers.push(this._createTimer(trigger));
    return trigger;
  }

  registerAll(list = []) {
    const seen = new Set(this._triggersById.keys());
    const coordinationPolicies = this._coordinationPolicyIndex(this.triggers);
    for (const trigger of list) {
      if (!trigger || !hasText(trigger.id)) throw new Error('TriggerSystem.registerAll: trigger.id 必须是非空字符串');
      if (!trigger.when?.type) throw new Error(`TriggerSystem.registerAll: ${trigger.id}.when.type 不能为空`);
      this._validateSceneEventReference(trigger);
      this._validateActionStepDefinitions(trigger);
      if (seen.has(trigger.id)) throw new Error(`TriggerSystem.registerAll: 重复 trigger.id "${trigger.id}"（triggers/tutorials 共用命名空间）`);
      const policy = this._reentryPolicy(trigger);
      if (!REENTRY_POLICIES.has(policy)) throw new Error(`TriggerSystem.registerAll: ${trigger.id}.reentryPolicy 非法`);
      this._validateCoordinationDefinition(trigger, coordinationPolicies);
      seen.add(trigger.id);
    }
    for (const trigger of list) this.register(trigger);
  }
  reset() {
    for (const active of this._active.values()) active.cancelled = true;
    this.triggers = [];
    this._triggersById.clear();
    this._active.clear();
    this._queues.clear();
    this._coordinationGeneration += 1;
    this._coordinationTails.clear();
    this._firedOnce.clear();
    this._cooldowns = Object.create(null);
    this._timers = [];
    this.ledger = new ScenarioExecutionLedger();
  }

  async fireAndWait(whenType, params = {}) {
    const requests = [];
    for (const trigger of this.triggers) {
      if (trigger.when?.type !== whenType) continue;
      if (!this._matchParams(trigger.when.params, params)) continue;
      const request = this._enqueueRun(trigger, { type: whenType, params });
      if (request) requests.push(request);
    }
    if (requests.length === 0) return { ok: true, accepted: 0, records: [] };
    const settled = await Promise.all(requests.map(request => request.completion));
    const records = settled.map(entry => entry.record);
    return {
      ok: records.every(record => record?.status === 'succeeded'),
      accepted: requests.length,
      records
    };
  }

  /**
   * 对同一内容事件执行确定性仲裁；旧 fire/fireById 保持原有 accepted 语义。
   * 未配置 coordination 的 trigger 各自作为 broadcast 候选，行为保持兼容。
   */
  async fireCoordinated(whenType, params = {}) {
    const matched = this.triggers
      .map((trigger, index) => ({ trigger, index, coordination: coordinationOf(trigger) }))
      .filter(candidate => candidate.trigger.when?.type === whenType
        && this._matchParams(candidate.trigger.when.params, params));
    if (matched.length === 0) {
      return {
        ok: true, accepted: 0, succeeded: 0, failed: 0, skipped: 0,
        winners: [], records: [], matchedTriggerIds: []
      };
    }

    const groups = new Map();
    for (const candidate of matched) {
      const key = candidate.coordination.group
        ? `${whenType}:group:${candidate.coordination.group}`
        : `${whenType}:trigger:${candidate.trigger.id}`;
      const group = groups.get(key) || {
        key,
        group: candidate.coordination.group,
        policy: candidate.coordination.policy,
        candidates: []
      };
      group.candidates.push(candidate);
      groups.set(key, group);
    }

    const generation = this._coordinationGeneration;
    const groupResults = await Promise.all([...groups.values()].map(group => (
      this._enqueueCoordinationGroup(group.key, async () => {
        if (generation !== this._coordinationGeneration) {
          return {
            ok: true,
            entries: group.candidates.map(candidate => ({
              triggerId: candidate.trigger.id,
              operationId: null,
              status: 'skipped',
              code: 'coordinationReset'
            }))
          };
        }
        return this._runCoordinatedGroup(group, whenType, params);
      })
    )));
    const records = groupResults.flatMap(result => result.entries || []);
    const succeededRecords = records.filter(record => record.status === 'succeeded');
    const failedRecords = records.filter(record => record.status === 'failed');
    const skippedRecords = records.filter(record => record.status === 'skipped');
    const result = {
      ok: groupResults.every(group => group.ok !== false),
      accepted: succeededRecords.length + failedRecords.length,
      succeeded: succeededRecords.length,
      failed: failedRecords.length,
      skipped: skippedRecords.length,
      winners: groupResults.flatMap(group => group.winners || []),
      records,
      matchedTriggerIds: matched.map(candidate => candidate.trigger.id)
    };
    if (matched.length > 1 || failedRecords.length > 0
      || skippedRecords.some(record => record.code === 'skippedByConflictPolicy')) {
      this.sceneDiagnostics?.recordEventConflict?.({
        type: 'eventConflict',
        eventType: whenType,
        eventId: params.eventId || null,
        operationId: params.operationId || null,
        matchedTriggerIds: result.matchedTriggerIds,
        winnerTriggerIds: result.winners,
        skippedTriggerIds: skippedRecords.map(record => record.triggerId),
        failedTriggerIds: failedRecords.map(record => record.triggerId),
        status: result.ok ? 'resolved' : 'failed',
        code: result.ok ? null : 'allCandidatesFailed'
      }, { openPanel: false });
    }
    return result;
  }

  fire(whenType, params = {}) {
    let accepted = 0;
    for (const trigger of this.triggers) {
      if (trigger.when?.type !== whenType) continue;
      if (!this._matchParams(trigger.when.params, params)) continue;
      if (this._tryRun(trigger, { type: whenType, params })) accepted++;
    }
    return accepted;
  }

  fireById(id, eventType, params = {}) {
    const trigger = this.getById(id);
    if (!trigger?.when || trigger.when.type !== eventType) return false;
    if (!this._matchParams(trigger.when.params, params)) return false;
    return this._tryRun(trigger, { type: eventType, params });
  }

  getById(id) { return this._triggersById.get(id) || null; }
  getExecution(id) { return this.ledger.get(id); }
  hasFiredOnce(id) { return this._firedOnce.has(id); }

  clearFiredOnce(id) {
    if (hasText(id)) return this._firedOnce.delete(id);
    this._firedOnce.clear();
    return true;
  }

  async waitForIdle(triggerId = null) {
    while (true) {
      const active = triggerId ? [this._active.get(triggerId)].filter(Boolean) : [...this._active.values()];
      if (!active.length) return;
      await Promise.all(active.map(entry => entry.promise));
    }
  }

  update(dt = 0) {
    if (this._advanceClockOnUpdate && typeof this.monotonicClock.advance === 'function') {
      this.monotonicClock.advance(Math.max(0, Number(dt) || 0) * 1000);
    }
    const now = this.monotonicClock.now();
    for (const timer of this._timers) {
      timer.remaining = Math.max(0, timer.nextDue - now);
      if (timer.interval <= 0 || now < timer.nextDue) continue;
      const dueCount = Math.floor((now - timer.nextDue) / timer.interval) + 1;
      const count = timer.catchUpPolicy === 'all'
        ? Math.min(dueCount, timer.maxCatchUp)
        : 1;
      for (let index = 0; index < count; index++) {
        this._tryRun(timer.trigger, { type: 'timer', params: { seconds: timer.interval / 1000 } });
      }
      timer.nextDue = timer.catchUpPolicy === 'skip'
        ? now + timer.interval
        : timer.nextDue + dueCount * timer.interval;
      timer.remaining = Math.max(0, timer.nextDue - now);
    }
  }

  _matchParams(want = {}, got = {}) {
    if (!want) return true;
    for (const [key, value] of Object.entries(want)) {
      if (['seconds', 'catchUpPolicy', 'maxCatchUp'].includes(key)) continue;
      if (value === undefined || value === null || value === '') continue;
      if (got[key] !== value) return false;
    }
    return true;
  }

  async _enqueueCoordinationGroup(key, run) {
    const previous = this._coordinationTails.get(key) || Promise.resolve();
    const current = previous.catch(() => null).then(run);
    this._coordinationTails.set(key, current);
    try {
      return await current;
    } finally {
      if (this._coordinationTails.get(key) === current) this._coordinationTails.delete(key);
    }
  }

  async _runCoordinatedGroup(group, whenType, params) {
    const candidates = [...group.candidates].sort((left, right) => (
      right.coordination.priority - left.coordination.priority || left.index - right.index
    ));
    const entries = [];
    const winners = [];
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const sourceOperationId = hasText(params.operationId)
        ? params.operationId
        : (hasText(params.eventId) ? params.eventId : null);
      const eventParams = sourceOperationId
        ? { ...params, operationId: `${sourceOperationId}:trigger:${candidate.trigger.id}` }
        : params;
      const request = this._enqueueRun(candidate.trigger, { type: whenType, params: eventParams });
      if (!request) {
        entries.push({
          triggerId: candidate.trigger.id,
          operationId: null,
          status: 'skipped',
          code: 'notEligible'
        });
        continue;
      }
      const settled = await request.completion;
      if (settled?.skipped) {
        entries.push({
          triggerId: candidate.trigger.id,
          operationId: request.operationId,
          status: 'skipped',
          code: settled.code || 'notEligible'
        });
        continue;
      }
      const record = settled?.record || this.ledger.get(candidate.trigger.id);
      const succeeded = settled?.value?.ok === true && record?.status === 'succeeded';
      entries.push({
        triggerId: candidate.trigger.id,
        operationId: request.operationId,
        status: succeeded ? 'succeeded' : 'failed',
        code: succeeded ? null : (record?.result?.code || settled?.error?.code || 'triggerFailed'),
        record
      });
      if (!succeeded) continue;
      winners.push(candidate.trigger.id);
      if (group.policy !== 'firstSuccess') continue;
      for (const skipped of candidates.slice(index + 1)) {
        entries.push({
          triggerId: skipped.trigger.id,
          operationId: null,
          status: 'skipped',
          code: 'skippedByConflictPolicy'
        });
      }
      break;
    }
    const attempted = entries.filter(entry => entry.status !== 'skipped');
    const succeeded = entries.filter(entry => entry.status === 'succeeded');
    return {
      ok: group.policy === 'firstSuccess'
        ? (succeeded.length > 0 || attempted.length === 0)
        : entries.every(entry => entry.status !== 'failed'),
      winners,
      entries
    };
  }

  _tryRun(trigger, event) {
    return Boolean(this._enqueueRun(trigger, event));
  }

  _enqueueRun(trigger, event) {
    if (!this._eligible(trigger)) return null;
    const request = this._createRequest(trigger, event);
    const active = this._active.get(trigger.id);
    if (active) {
      const policy = this._reentryPolicy(trigger);
      if (policy === 'reject') return null;
      if (policy === 'queue') {
        const queue = this._queues.get(trigger.id) || [];
        queue.push(request);
        this._queues.set(trigger.id, queue);
        return request;
      }
      active.cancelled = true;
      this._queues.set(trigger.id, [request]);
      return request;
    }
    this._startExecution(trigger, request);
    return request;
  }

  _eligible(trigger) {
    if (trigger.enabled === false) return false;
    if (trigger.once && this._firedOnce.has(trigger.id)) return false;
    const cooldown = this._cooldowns[trigger.id];
    if (cooldown && this.monotonicClock.now() < cooldown.nextDue) return false;
    if (trigger.if && !this.expr.eval(trigger.if)) return false;
    return true;
  }

  _ensureEventJournal() {
    const runtime = this.ctx?.scene?.sceneRuntime || null;
    let journal = this.eventJournal || this.ctx?.eventJournal || this.ctx?.services?.eventJournal || runtime?.eventJournal || null;
    if (!journal && runtime) {
      journal = new EventJournal();
      runtime.eventJournal = journal;
      runtime.authoritySnapshotService?.registerService?.('eventJournal', journal.asSnapshotProvider());
      if (this.ctx?.services) this.ctx.services.eventJournal = journal;
    }
    if (journal) this.eventJournal = journal;
    return journal;
  }

  _createRequest(trigger, event) {
    const params = event?.params || {};
    const sequence = ++this._operationSequence;
    const inheritedEventId = hasText(params.eventId) ? params.eventId.trim() : null;
    const eventJournal = this._ensureEventJournal();
    const existingEvent = inheritedEventId ? eventJournal?.get?.(inheritedEventId) : null;
    const journalEvent = existingEvent || eventJournal?.create?.({
      eventId: inheritedEventId,
      eventDefinitionId: event?.definitionId || null,
      type: event?.type || 'trigger',
      source: params.source || null,
      actorRef: params.actorRef || params.actorId || this.ctx.player?.id || null,
      sceneId: params.sceneId || null,
      payload: params,
      logicalTime: this.logicalClock?.now?.() || 0,
      persistent: event?.type !== 'pointerMove'
    }) || null;
    const eventId = journalEvent?.eventId
      || inheritedEventId
      || `event:trigger:${this.definitionRevision}:${Math.max(0, Math.floor(this.monotonicClock.now() * 1000))}:${++this._eventSequence}`;
    const operationId = eventId;
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    return {
      event,
      eventId,
      operationId,
      fingerprint: this._operationFingerprint(trigger, operationId),
      completion,
      resolveCompletion
    };
  }

  _startExecution(trigger, request) {
    const token = { cancelled: false, promise: null };
    this._active.set(trigger.id, token);
    const executionPromise = this._execute(trigger, request, token);
    token.promise = executionPromise.then(
      value => {
        request.resolveCompletion({ value, record: clone(this.ledger.get(trigger.id)) });
        return value;
      },
      error => {
        request.resolveCompletion({ error, record: clone(this.ledger.get(trigger.id)) });
        throw error;
      }
    ).finally(() => {
      if (this._active.get(trigger.id) !== token) return;
      this._active.delete(trigger.id);
      const queue = this._queues.get(trigger.id) || [];
      const next = queue.shift();
      if (trigger.once && this._firedOnce.has(trigger.id)) {
        this._queues.delete(trigger.id);
        const record = clone(this.ledger.get(trigger.id));
        for (const skipped of [next, ...queue].filter(Boolean)) {
          skipped.resolveCompletion({
            value: null,
            record,
            skipped: true,
            code: 'onceAlreadyFired'
          });
        }
        return;
      }
      if (queue.length) this._queues.set(trigger.id, queue);
      else this._queues.delete(trigger.id);
      if (next) this._startExecution(trigger, next);
    });
    // debug 模式会保留 TriggerExecutionError；显式观察避免无人等待时产生未处理拒绝。
    token.promise.catch(() => {});
  }

  async _execute(trigger, request, token) {
    const startedAt = this.monotonicClock.now();
    this.ledger.begin({
      triggerId: trigger.id,
      definitionRevision: this.definitionRevision,
      eventId: request.eventId,
      operationId: request.operationId,
      fingerprint: request.fingerprint,
      startedAt
    });
    this._lastFiredId = trigger.id;
    this._emit('triggerStart', trigger, { operationId: request.operationId, status: 'running' });
    let lastResult = normalizeLegacyResult(undefined, request.operationId, trigger.id);
    let actionIndex = -1;
    try {
      const actions = trigger.do || [];
      const executed = await this._runSteps(trigger, request, token, actions, { n: 0 });
      lastResult = executed.lastResult;
      actionIndex = executed.actionIndex;
      const record = this.ledger.finish(trigger.id, request.operationId, 'succeeded', lastResult, this.monotonicClock.now());
      if (trigger.once) this._firedOnce.add(trigger.id);
      if (Number(trigger.cooldown) > 0) {
        const duration = Number(trigger.cooldown) * 1000;
        this._cooldowns[trigger.id] = { nextDue: this.monotonicClock.now() + duration, duration };
      }
      // 全 Trigger 化后不再有 FlowGroup 进度通知；顺序完全由 when/if + 事务前置条件驱动。
      await this._publishFinal('triggerSucceeded', trigger, record);
      this._emit('triggerEnd', trigger, { operationId: request.operationId, status: 'succeeded', result: technicalResult(lastResult) });
      return lastResult;
    } catch (error) {
      const failedIndex = Number.isInteger(error.triggerActionIndex)
        ? error.triggerActionIndex
        : Math.max(0, actionIndex);
      const failedAction = error.triggerAction || (trigger.do || [])[failedIndex] || null;
      const result = errorResult(request.operationId, trigger.id, error, error.code || error.result?.code);
      this.ledger.advance(trigger.id, request.operationId, failedIndex, result);
      const failedAt = this.monotonicClock.now();
      const record = this.ledger.finish(trigger.id, request.operationId, 'failed', result, failedAt);
      const descriptor = this.actionDescriptorRegistry?.get?.(failedAction?.action) || null;
      const envelope = createTriggerFailureEnvelope({
        trigger, action: failedAction, actionIndex: failedIndex, actionDescriptor: descriptor,
        operationId: request.operationId,
        actionOperationId: error.actionOperationId || this._actionOperationId(trigger, failedAction, failedIndex, request),
        definitionRevision: this.definitionRevision, fingerprint: request.fingerprint,
        phase: error.triggerPhase, error, event: request.event, context: this.ctx,
        startedAt, failedAt,
        seed: this.ctx.authorityRng?.snapshot?.() || this.ctx.rng?.snapshot?.() || this.ctx.seed || null
      });
      if (this.isDebugEnabled()) {
        // debug 模式下失败诊断必须进入 DebugPanel 并展开面板（debug failure exposure contract）；
        // 非 debug 由 SceneDiagnostics.recordTriggerFailure 直接拒绝，不打断玩家流程。
        this.sceneDiagnostics?.recordTriggerFailure?.(envelope, { openPanel: true });
      }
      this._emit('actionFailed', trigger, this.isDebugEnabled()
        ? envelope
        : { triggerId: trigger.id, actionIndex: failedIndex, operationId: request.operationId, code: result.code });
      await this._publishFinal('triggerFailed', trigger, record, this.isDebugEnabled() ? envelope : null);
      this._emit('triggerEnd', trigger, {
        operationId: request.operationId, status: 'failed', actionIndex: failedIndex,
        result: technicalResult(result)
      });
      if (this.isDebugEnabled()) throw new TriggerExecutionError(envelope, error);
      return result;
    }
  }
  /**
   * action 级 operationId：
   * - 显式 action.operationId 优先；
   * - 有 stepId（归属 FlowGroup 的稳定步骤）→ `${request.operationId}:trigger:${id}:step:${stepId}` 稳定身份；
   * - 无 stepId → 单动作链直接复用 request.operationId，多动作链用 `:action:${index}`
   *   （可预测格式，命令侧与 property 模型依赖此约定）。
   */
  _actionOperationId(trigger, action, index, request) {
    if (hasText(action?.operationId)) return action.operationId.trim();
    if (hasText(action?.stepId)) {
      return `${request.operationId}:trigger:${trigger.id}:step:${action.stepId.trim()}`;
    }
    return (trigger.do || []).length === 1
      ? request.operationId
      : `${request.operationId}:action:${index}`;
  }

  async _executeAction(trigger, action, index, request) {
    const actionId = action?.action;
    const descriptor = this.actionDescriptorRegistry?.get?.(actionId);
    const legacy = this.actions[actionId];
    const operationId = this._actionOperationId(trigger, action, index, request);
    if (!descriptor && !legacy) {
      throw Object.assign(new Error(`TriggerSystem: 未登记动作 ${String(actionId)}`), {
        code: 'unknownAction', triggerPhase: 'resolveAction', actionOperationId: operationId
      });
    }
    let pending;
    if (descriptor) {
      if (!this.commandAdapter?.execute) {
        throw Object.assign(new Error(`TriggerSystem: action ${actionId} requires CommandAdapter`), {
          code: 'commandAdapterMissing', triggerPhase: 'resolveAdapter', actionOperationId: operationId
        });
      }
      try {
        pending = this.commandAdapter.execute(action, {
          actorRef: request.event?.params?.actorRef || request.event?.params?.actorId || this.ctx.player?.id,
          operationId,
          definitionRepository: this.ctx.definitionRepository,
          eventParams: request.event?.params || null,
          definitionRevision: this.definitionRevision
        });
      } catch (error) {
        error.triggerPhase = error.code === 'invalidActionParams' ? 'schemaValidation' : 'executeSync';
        error.actionOperationId = operationId;
        throw error;
      }
      let result;
      try {
        result = await Promise.resolve(pending);
      } catch (error) {
        error.triggerPhase = error.code === 'invalidActionParams' ? 'schemaValidation' : 'executeAsync';
        error.actionOperationId = operationId;
        throw error;
      }
      try {
        assertCommandContract(CommandContractKind.COMMAND_RESULT, result);
      } catch (error) {
        error.triggerPhase = 'resultSchemaValidation';
        error.actionOperationId = operationId;
        throw error;
      }
      if (result.operationId !== operationId) {
        throw Object.assign(new Error(`CommandResult.operationId mismatch for ${actionId}`), {
          code: 'operationIdMismatch', triggerPhase: 'resultValidation', actionOperationId: operationId
        });
      }
      return result;
    }
    const legacyEvent = {
      ...request.event,
      params: {
        ...(request.event?.params || {}),
        eventId: request.eventId
      }
    };
    try {
      pending = legacy(action.params || {}, this.ctx, legacyEvent);
    } catch (error) {
      error.triggerPhase = 'executeSync';
      error.actionOperationId = operationId;
      throw error;
    }
    let result;
    try {
      result = await Promise.resolve(pending);
    } catch (error) {
      error.triggerPhase = 'executeAsync';
      error.actionOperationId = operationId;
      throw error;
    }
    const normalized = normalizeLegacyResult(result, operationId, trigger.id);
    try {
      assertCommandContract(CommandContractKind.COMMAND_RESULT, normalized);
    } catch (error) {
      error.triggerPhase = 'resultSchemaValidation';
      error.actionOperationId = operationId;
      throw error;
    }
    return normalized;
  }

  _eventStepId(step, index) {
    return hasText(step?.stepId) ? step.stepId.trim() : `action:${index}`;
  }

  _beginEventStep(trigger, step, index, request) {
    const journal = this._ensureEventJournal();
    if (!journal || !request.eventId) return { ok: true, tracked: false, replay: false };
    const stepId = this._eventStepId(step, index);
    const operationId = this._actionOperationId(trigger, step, index, request);
    const payloadFingerprint = stableDigest({
      eventId: request.eventId,
      triggerId: trigger.id,
      stepId,
      action: step
    });
    const started = journal.beginExecution({
      eventId: request.eventId,
      triggerId: trigger.id,
      stepId,
      operationId,
      payloadFingerprint,
      logicalTime: this.logicalClock?.now?.() || 0
    });
    if (started?.ok !== true) {
      throw Object.assign(new Error(started?.code || 'Event execution begin failed'), {
        code: started?.code || 'eventExecutionBeginFailed',
        triggerPhase: 'eventJournal',
        actionOperationId: operationId,
        details: started
      });
    }
    return { ...started, tracked: true, stepId, operationId };
  }

  _completeEventStep(trigger, request, tracking, status, result) {
    if (!tracking?.tracked) return { ok: true };
    const completed = this.eventJournal?.completeExecution?.({
      eventId: request.eventId,
      triggerId: trigger.id,
      stepId: tracking.stepId,
      status,
      result,
      logicalTime: this.logicalClock?.now?.() || 0
    });
    if (completed?.ok !== true) {
      throw Object.assign(new Error(completed?.code || 'Event execution completion failed'), {
        code: completed?.code || 'eventExecutionCompleteFailed',
        triggerPhase: 'eventJournal',
        actionOperationId: tracking.operationId,
        details: completed
      });
    }
    return completed;
  }

  _eventResultStatus(result) {
    if (result?.ok === true) return result?.status === 'skipped' ? 'skipped' : 'succeeded';
    return this._isBenignResult(result) ? 'blocked' : 'failed';
  }

  /**
   * 多路径步骤执行内核（递归）。do[] 内每一步可以是：
   *   - 带 if 前置守卫的动作：条件不满足则跳过该步（幂等护栏，不中断流程）
   *   - branch[] 分支容器：when/otherwise 命中后递归执行对应子路径（单 Trigger 多教程）
   *   - 普通动作：严格串行等待（params.await 支持教程生命周期等待）
   * cursor 为扁平序号计数器（跨分支唯一），保证 ledger.advance 的 actionIndex 与
   * operationId 的 :action:{index} 后缀全局唯一。
   */
  async _runSteps(trigger, request, token, steps, cursor) {
    let lastResult = normalizeLegacyResult(undefined, request.operationId, trigger.id);
    let actionIndex = -1;
    for (const step of steps || []) {
      const index = cursor.n++;
      actionIndex = index;
      if (token.cancelled) {
        throw Object.assign(new Error('trigger coordination restarted'), {
          code: 'reentryRestarted', triggerPhase: 'reentry', triggerActionIndex: index,
          triggerAction: step, actionOperationId: this._actionOperationId(trigger, step, index, request)
        });
      }
      const eventTracking = this._beginEventStep(trigger, step, index, request);
      let replayed = eventTracking.replay === true;
      if (replayed) {
        lastResult = eventTracking.execution?.result;
        if (!lastResult || typeof lastResult.ok !== 'boolean') {
          throw Object.assign(new Error('EventJournal replay result is unavailable'), {
            code: 'eventExecutionReplayUnavailable',
            triggerPhase: 'eventJournal',
            triggerActionIndex: index,
            triggerAction: step,
            actionOperationId: eventTracking.operationId
          });
        }
      }
      // 步骤级前置守卫：条件不满足则跳过（结果标记 skipped，仍推进账本）
      if (!replayed && step?.if && !this.expr.eval(step.if)) {
        lastResult = this._skippedResult(request, trigger);
        this._completeEventStep(trigger, request, eventTracking, 'skipped', lastResult);
        this.ledger.advance(trigger.id, request.operationId, index, lastResult);
        continue;
      }
      if (!replayed && Array.isArray(step?.branch)) {
        const branch = this._selectBranch(step.branch);
        if (branch) {
          try {
            lastResult = (await this._runSteps(trigger, request, token, branch.do || [], cursor)).lastResult;
          } catch (error) {
            this._completeEventStep(trigger, request, eventTracking, 'failed', {
              ok: false,
              code: error?.code || 'branchExecutionFailed',
              message: error?.message || String(error)
            });
            error.triggerActionIndex = index;
            error.triggerAction = step;
            error.actionOperationId ||= this._actionOperationId(trigger, step, index, request);
            throw error;
          }
        } else {
          lastResult = this._skippedResult(request, trigger);
        }
      } else if (!replayed) {
        try {
          lastResult = await this._executeAction(trigger, step, index, request);
        } catch (error) {
          this._completeEventStep(trigger, request, eventTracking, 'failed', {
            ok: false,
            code: error?.code || 'actionExecutionFailed',
            message: error?.message || String(error)
          });
          error.triggerActionIndex = index;
          error.triggerAction = step;
          error.actionOperationId ||= this._actionOperationId(trigger, step, index, request);
          throw error;
        }
      }
      // 幂等护栏：良性结果码（条件未就绪/已被他路完成）等同步骤级 if 跳过，
      // 不中断整链、不刷红 DebugPanel、不触发事件重试。
      let eventCompletionStatus = null;
      if (lastResult.ok !== true && this._isBenignResult(lastResult)) {
        eventCompletionStatus = 'blocked';
        lastResult = this._benignSkipResult(request, trigger, lastResult);
      }
      // 单 Trigger 多教程串行：tutorial.command show 成功后，若 params.await=true，
      // 在此等待该教程离槽（命令已提交完成，等待不占用 state revision）。
      if (lastResult.ok === true
        && step?.action === 'tutorial.command'
        && step?.params?.operation === 'show'
        && step?.params?.await === true) {
        await this._awaitTutorialHide(step.params.tutorialId);
      }
      if (!replayed) {
        this._completeEventStep(
          trigger,
          request,
          eventTracking,
          eventCompletionStatus || this._eventResultStatus(lastResult),
          lastResult
        );
      }
      this.ledger.advance(trigger.id, request.operationId, index, lastResult);
      if (lastResult.ok !== true) {
        const failure = new Error(lastResult.error?.message || `action ${step?.action || 'branch'} returned ok:false`);
        failure.code = lastResult.code || 'actionRejected';
        failure.result = lastResult;
        failure.triggerPhase = 'commandResult';
        failure.triggerActionIndex = index;
        failure.triggerAction = step;
        failure.actionOperationId = this._actionOperationId(trigger, step, index, request);
        throw failure;
      }
      if (token.cancelled) {
        throw Object.assign(new Error('trigger coordination restarted'), {
          code: 'reentryRestarted', triggerPhase: 'reentry', triggerActionIndex: index,
          triggerAction: step, actionOperationId: this._actionOperationId(trigger, step, index, request)
        });
      }
    }
    return { lastResult, actionIndex };
  }

  /** 步骤级 if / branch 守卫未命中时的跳过结果（技术上成功，不视为失败）。 */
  _skippedResult(request, trigger) {
    return {
      ok: true, status: 'skipped', committed: false,
      operationId: request.operationId,
      stateId: `trigger:${trigger.id}`, stateRevision: null
    };
  }

  /**
   * 等待指定教程离槽（show 已成功提交后的串行编排等待）。
   * 纯等待不占用 state revision；完成/从未进入/已隐藏 均视为就绪。
   * 优先用真实 TutorialSystem（ctx.tutorialSystem），回退场景注入的 tutorial facade。
   */
  async _awaitTutorialHide(tutorialId) {
    const tutorial = this.ctx.tutorialSystem
      || (this.ctx.tutorial && typeof this.ctx.tutorial.onHide === 'function' ? this.ctx.tutorial : null);
    if (!tutorial || !tutorialId) return;
    if (typeof tutorial.onHide !== 'function') return;
    const resolve = () => (
      tutorial.completedTutorials?.has?.(tutorialId)
      || tutorial.currentTutorial?.id !== tutorialId
      || !(tutorial.pendingTutorials || []).some(entry => entry?.tutorialId === tutorialId)
    );
    if (resolve()) return;
    await new Promise(done => {
      const off = tutorial.onHide(() => { if (resolve()) { off?.(); done(); } });
    });
  }

  /** 良性结果码判定：ok:false 且 code 属于幂等护栏集，视为可跳过的良性结果。 */
  _isBenignResult(result) {
    return result?.ok === false && this.benignResultCodes.has(result.code);
  }

  /** 良性结果转跳过结果，保留原 code 供诊断，技术上成功、不中断整链。 */
  _benignSkipResult(request, trigger, source) {
    return {
      ok: true, status: 'skipped', committed: false, code: source?.code || null,
      operationId: request.operationId,
      stateId: `trigger:${trigger.id}`, stateRevision: null
    };
  }

  /** 分支选择：优先 when 命中的分支（无 when 视为恒真）；全部未命中回退 otherwise 兜底。 */
  _selectBranch(branches) {
    let fallback = null;
    for (const branch of branches || []) {
      if (branch?.otherwise === true) { fallback = branch; continue; }
      if (branch?.when == null) return branch;
      if (this.expr.eval(branch.when)) return branch;
    }
    return fallback;
  }

  async _publishFinal(type, trigger, record, failureEnvelope = null) {
    const logicalTime = this.logicalClock?.tick
      ? this.logicalClock.tick()
      : Math.max(0, Math.floor(this.monotonicClock.now()));
    const payload = {
      triggerId: trigger.id,
      definitionRevision: record.definitionRevision,
      status: record.status,
      actionIndex: record.actionIndex,
      code: record.result?.code || null
    };
    if (failureEnvelope) payload.failure = failureEnvelope;
    const event = Object.freeze({
      eventId: `trigger-event:${++this._eventSequence}`,
      eventSequence: this._eventSequence,
      stateId: `trigger:${trigger.id}`,
      stateType: 'triggerExecution',
      stateRevision: record.ledgerRevision,
      operationId: record.operationId,
      logicalTime,
      type,
      payload: Object.freeze(payload)
    });
    assertCommandContract(CommandContractKind.APPLICATION_EVENT, event);
    const publisher = this.applicationEventPublisher;
    if (typeof publisher === 'function') await publisher(event);
    else if (publisher?.publishApplicationEvent) await publisher.publishApplicationEvent(event);
    else if (publisher?.publish) await publisher.publish(event);
    this._emit(type, trigger, event);
  }

  on(callback) {
    this._listeners.push(callback);
    return () => {
      const index = this._listeners.indexOf(callback);
      if (index !== -1) this._listeners.splice(index, 1);
    };
  }

  _emit(type, trigger, details = null) {
    for (const callback of [...this._listeners]) {
      try { callback(type, trigger, details); } catch { /* presentation listener cannot change execution */ }
    }
  }

  serialize() {
    const now = this.monotonicClock.now();
    const cooldowns = Object.fromEntries(Object.entries(this._cooldowns).map(([triggerId, cooldown]) => [triggerId, {
      definitionRevision: this.definitionRevision,
      remaining: Math.max(0, cooldown.nextDue - now),
      nextDue: cooldown.nextDue,
      duration: cooldown.duration
    }]));
    const timers = this._timers.map(timer => ({
      triggerId: timer.trigger.id,
      definitionRevision: this.definitionRevision,
      remaining: Math.max(0, timer.nextDue - now),
      nextDue: timer.nextDue,
      interval: timer.interval,
      catchUpPolicy: timer.catchUpPolicy,
      maxCatchUp: timer.maxCatchUp
    }));
    return {
      snapshotSchemaVersion: TRIGGER_SNAPSHOT_SCHEMA_VERSION,
      definitionRevision: this.definitionRevision,
      definitionDigest: this.getDefinitionDigest(),
      operationSequence: this._operationSequence,
      eventSequence: this._eventSequence,
      firedOnce: [...this._firedOnce], cooldowns, timers,
      ledger: this.ledger.snapshot()
    };
  }

  validateSnapshot(data) {
    const errors = [];
    if (!data || data.snapshotSchemaVersion !== TRIGGER_SNAPSHOT_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [{
          code: 'invalidSnapshotSchema',
          path: 'triggers.snapshotSchemaVersion',
          message: `Trigger snapshot schema 必须为 ${TRIGGER_SNAPSHOT_SCHEMA_VERSION}`
        }]
      };
    }
    if (!hasText(data.definitionDigest) || data.definitionDigest !== this.getDefinitionDigest()) {
      errors.push({
        code: 'definitionDigestMismatch',
        path: 'triggers.definitionDigest',
        message: 'Trigger 执行定义与存档不兼容'
      });
    }
    if (!Array.isArray(data.firedOnce) || !data.cooldowns || typeof data.cooldowns !== 'object' || !Array.isArray(data.timers)) {
      errors.push({ code: 'invalidTriggerSnapshot', path: 'triggers', message: 'once/cooldown/timer snapshot 非法' });
    }
    if (data.operationSequence !== undefined
      && (!Number.isInteger(data.operationSequence) || data.operationSequence < 0)) {
      errors.push({ code: 'invalidTriggerOperationSequence', path: 'triggers.operationSequence', message: 'operationSequence 必须是非负整数' });
    }
    if (data.eventSequence !== undefined
      && (!Number.isInteger(data.eventSequence) || data.eventSequence < 0)) {
      errors.push({ code: 'invalidTriggerEventSequence', path: 'triggers.eventSequence', message: 'eventSequence 必须是非负整数' });
    }
    const ledgerValidation = this.ledger.validateSnapshot(data.ledger);
    errors.push(...ledgerValidation.errors.map(error => ({ ...error, path: `triggers.${error.path}` })));

    for (const trigger of this.triggers) this._validateDefinitionReferences(trigger, errors);
    for (const id of data.firedOnce || []) {
      if (!this._triggersById.has(id)) errors.push({ code: 'invalidReference', path: `triggers.firedOnce.${id}`, message: `未知 trigger ${id}` });
    }
    for (const [id, value] of Object.entries(data.cooldowns || {})) {
      if (!this._triggersById.has(id)) errors.push({ code: 'invalidReference', path: `triggers.cooldowns.${id}`, message: `未知 trigger ${id}` });
      if (value?.definitionRevision !== data.definitionRevision || !this._validTiming(value)) {
        errors.push({ code: 'invalidTiming', path: `triggers.cooldowns.${id}`, message: 'cooldown revision/timing 非法' });
      }
    }
    const timerIds = new Set();
    for (const [index, timer] of (data.timers || []).entries()) {
      const trigger = this._triggersById.get(timer?.triggerId);
      const currentTimer = this._timers.find(entry => entry.trigger.id === timer?.triggerId);
      if (!trigger || trigger.when?.type !== 'timer' || !currentTimer) errors.push({ code: 'invalidReference', path: `triggers.timers[${index}].triggerId`, message: 'timer trigger 引用无效' });
      if (timerIds.has(timer?.triggerId)) errors.push({ code: 'duplicateId', path: `triggers.timers[${index}].triggerId`, message: 'timer trigger 重复' });
      timerIds.add(timer?.triggerId);
      if (timer?.definitionRevision !== data.definitionRevision || !this._validTiming(timer)
        || !CATCH_UP_POLICIES.has(timer?.catchUpPolicy) || !Number.isInteger(timer?.maxCatchUp) || timer.maxCatchUp < 1
        || (currentTimer && (timer.interval !== currentTimer.interval
          || timer.catchUpPolicy !== currentTimer.catchUpPolicy
          || timer.maxCatchUp !== currentTimer.maxCatchUp))) {
        errors.push({ code: 'invalidTiming', path: `triggers.timers[${index}]`, message: 'timer 必须匹配当前 definition 的 catch-up/timing' });
      }
    }
    for (const currentTimer of this._timers) {
      if (!timerIds.has(currentTimer.trigger.id)) {
        errors.push({ code: 'missingField', path: `triggers.timers.${currentTimer.trigger.id}`, message: 'timer snapshot 缺少当前 definition' });
      }
    }
    for (const record of data.ledger?.records || []) {
      const trigger = this._triggersById.get(record.triggerId);
      if (!trigger) errors.push({ code: 'invalidReference', path: `triggers.ledger.${record.triggerId}`, message: 'ledger trigger 引用无效' });
      if (record.definitionRevision !== data.definitionRevision) {
        errors.push({ code: 'definitionRevisionMismatch', path: `triggers.ledger.${record.triggerId}.definitionRevision`, message: 'ledger definition revision 与快照不一致' });
      }
      if (record.operationId && record.fingerprint !== this._operationFingerprint(trigger, record.operationId)) {
        errors.push({ code: 'invalidFingerprint', path: `triggers.ledger.${record.triggerId}.fingerprint`, message: 'operation fingerprint 不匹配' });
      }
      if (this.operationFingerprintValidator && record.operationId
        && this.operationFingerprintValidator(record, trigger) !== true) {
        errors.push({ code: 'invalidFingerprint', path: `triggers.ledger.${record.triggerId}.fingerprint`, message: 'operation fingerprint validator 拒绝' });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  deserialize(data) {
    const validation = this.validateSnapshot(data);
    if (!validation.ok) return validation;
    const now = this.monotonicClock.now();
    const normalizedLedger = {
      ...data.ledger,
      records: data.ledger.records.map(record => ({
        ...record,
        definitionRevision: this.definitionRevision
      }))
    };
    const nextLedger = new ScenarioExecutionLedger().restore(normalizedLedger);
    const restoredOperationSequence = Number.isInteger(data.operationSequence) && data.operationSequence >= 0
      ? data.operationSequence
      : getRestoredOperationSequence(data.ledger);
    const nextOnce = new Set(data.firedOnce);
    const nextCooldowns = Object.create(null);
    for (const [id, saved] of Object.entries(data.cooldowns)) {
      nextCooldowns[id] = {
        duration: saved.duration,
        nextDue: this._restoreDue(saved, now, this._triggersById.get(id)?.catchUpPolicy || 'resume')
      };
    }
    const nextTimers = data.timers.map(saved => {
      const trigger = this._triggersById.get(saved.triggerId);
      const definitionTimer = this._timers.find(entry => entry.trigger.id === saved.triggerId);
      return {
        trigger,
        interval: definitionTimer.interval,
        catchUpPolicy: definitionTimer.catchUpPolicy,
        maxCatchUp: definitionTimer.maxCatchUp,
        nextDue: this._restoreDue(saved, now, definitionTimer.catchUpPolicy),
        remaining: saved.remaining
      };
    });
    for (const active of this._active.values()) active.cancelled = true;
    this._active.clear();
    this._queues.clear();
    this._coordinationGeneration += 1;
    this._coordinationTails.clear();
    this.ledger = nextLedger;
    this._operationSequence = Math.max(this._operationSequence, restoredOperationSequence);
    this._eventSequence = Math.max(this._eventSequence, Number.isInteger(data.eventSequence) ? data.eventSequence : 0);
    this._firedOnce = nextOnce;
    this._cooldowns = nextCooldowns;
    this._timers = nextTimers;
    return { ok: true, errors: [] };
  }

  _validTiming(value) {
    return Number.isFinite(value?.remaining) && value.remaining >= 0
      && Number.isFinite(value?.nextDue) && value.nextDue >= 0
      && (value.duration === undefined || (Number.isFinite(value.duration) && value.duration >= 0))
      && (value.interval === undefined || (Number.isFinite(value.interval) && value.interval > 0));
  }

  _restoreDue(saved, now, policy) {
    if (policy === 'all') return saved.nextDue;
    if (policy === 'single' && saved.nextDue <= now) return now;
    if (policy === 'skip' && saved.nextDue <= now) return now + (saved.interval || saved.duration || saved.remaining);
    return now + saved.remaining;
  }

  _createTimer(trigger) {
    const interval = Number(trigger.when.params?.seconds || 0) * 1000;
    const catchUpPolicy = trigger.catchUpPolicy || trigger.when.params?.catchUpPolicy || 'resume';
    if (!Number.isFinite(interval) || interval <= 0) throw new Error(`TriggerSystem.register: ${trigger.id} timer seconds 必须大于 0`);
    if (!CATCH_UP_POLICIES.has(catchUpPolicy)) throw new Error(`TriggerSystem.register: ${trigger.id} catchUpPolicy 非法`);
    return {
      trigger, interval, catchUpPolicy,
      maxCatchUp: Math.max(1, Math.floor(Number(trigger.maxCatchUp || trigger.when.params?.maxCatchUp || 100))),
      nextDue: this.monotonicClock.now() + interval,
      remaining: interval
    };
  }

  _coordinationPolicyIndex(triggers = []) {
    const index = new Map();
    for (const trigger of triggers) {
      if (trigger?.coordination === undefined) continue;
      const coordination = coordinationOf(trigger);
      if (!coordination.group || !trigger.when?.type) continue;
      index.set(`${trigger.when.type}:${coordination.group}`, coordination.policy);
    }
    return index;
  }

  _validateCoordinationDefinition(trigger, policyIndex = null) {
    const raw = trigger?.coordination;
    if (raw === undefined) return true;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`TriggerSystem.register: ${trigger.id}.coordination 必须是对象`);
    }
    if (!hasText(raw.group)) {
      throw new Error(`TriggerSystem.register: ${trigger.id}.coordination.group 必须是非空字符串`);
    }
    if (raw.priority !== undefined && !Number.isInteger(raw.priority)) {
      throw new Error(`TriggerSystem.register: ${trigger.id}.coordination.priority 必须是整数`);
    }
    const policy = raw.policy === undefined ? 'broadcast' : raw.policy;
    if (!COORDINATION_POLICIES.has(policy)) {
      throw new Error(`TriggerSystem.register: ${trigger.id}.coordination.policy 非法`);
    }
    if (policy === 'firstSuccess' && !hasText(raw.group)) {
      throw new Error(`TriggerSystem.register: ${trigger.id} 的 firstSuccess 必须声明 coordination.group`);
    }
    const group = raw.group.trim();
    const key = `${trigger.when.type}:${group}`;
    const policies = policyIndex || this._coordinationPolicyIndex(this.triggers);
    const existing = policies.get(key);
    if (existing && existing !== policy) {
      throw new Error(`TriggerSystem.register: ${trigger.id} 与 ${key} 组内 coordination.policy 不一致`);
    }
    policies.set(key, policy);
    return true;
  }

  _validateActionStepDefinitions(trigger) {
    const identities = new Set();
    const requiresStableSteps = hasText(trigger?.flowGroupId) || hasText(trigger?.sceneEventId);
    this._validateStepList(trigger, trigger?.do || [], requiresStableSteps, identities, []);
    return true;
  }

  /** 递归校验 do[]/branch[] 步骤：稳定 stepId、身份唯一、禁止 action 级 await（用 params.await）。 */
  _validateStepList(trigger, steps, requiresStableSteps, identities, path) {
    for (const [index, step] of (steps || []).entries()) {
      const nodePath = [...path, `do[${index}]`];
      if (Array.isArray(step?.branch)) {
        this._requireStableIdentity(trigger, step, requiresStableSteps, identities, nodePath, '分支');
        for (const [bIndex, branch] of step.branch.entries()) {
          this._validateStepList(trigger, branch?.do || [], requiresStableSteps, identities, [...nodePath, `branch[${bIndex}]`]);
        }
        continue;
      }
      this._requireStableIdentity(trigger, step, requiresStableSteps, identities, nodePath);
    }
    return true;
  }

  _requireStableIdentity(trigger, step, requiresStableSteps, identities, path, label = '') {
    const stepId = hasText(step?.stepId) ? step.stepId.trim() : '';
    const suffix = label ? `（${label}步骤）` : '';
    if (requiresStableSteps && !stepId) {
      throw new Error(`TriggerSystem.register: ${trigger.id}.${path.join('.')}.stepId 必须是非空稳定 ID${suffix}`);
    }
    if (requiresStableSteps && Object.prototype.hasOwnProperty.call(step || {}, 'await')) {
      throw new Error(`TriggerSystem.register: ${trigger.id}.${path.join('.')}.await 已废弃；请用 params.await 使教程串行等待`);
    }
    const identity = stepId || `legacy-${stableDigest(step || {})}`;
    if (identities.has(identity)) {
      throw new Error(`TriggerSystem.register: ${trigger.id}.${path.join('.')} 动作步骤身份重复: ${identity}`);
    }
    identities.add(identity);
    return identity;
  }

  _reentryPolicy(trigger) { return trigger.reentryPolicy || trigger.reentry || 'reject'; }

  /** 当前全部 Trigger 的跨会话稳定执行定义摘要；不包含装配 generation。 */
  getDefinitionDigest() {
    return stableDigest(this.triggers.map(trigger => this._semanticTriggerDefinition(trigger)));
  }

  _triggerDefinitionDigest(trigger) {
    return trigger ? stableDigest(this._semanticTriggerDefinition(trigger)) : '';
  }

  _semanticTriggerDefinition(trigger) {
    const whenParams = Object.fromEntries(Object.entries(trigger.when?.params || {}).filter(([key, value]) => (
      !['seconds', 'catchUpPolicy', 'maxCatchUp'].includes(key)
      && value !== undefined && value !== null && value !== ''
    )));
    const coordination = coordinationOf(trigger);
    const cooldown = Number(trigger.cooldown);
    const references = values => (values || []).map(value => (
      typeof value === 'string' ? value.trim() : String(value?.id || '').trim()
    )).filter(Boolean).sort();
    let timer = null;
    if (trigger.when?.type === 'timer') {
      const seconds = Number(trigger.when.params?.seconds || 0);
      timer = {
        interval: Number.isFinite(seconds) ? seconds * 1000 : null,
        catchUpPolicy: trigger.catchUpPolicy || trigger.when.params?.catchUpPolicy || 'resume',
        maxCatchUp: Math.max(1, Math.floor(Number(
          trigger.maxCatchUp || trigger.when.params?.maxCatchUp || 100
        )))
      };
    }
    return {
      id: trigger.id,
      enabled: trigger.enabled !== false,
      when: { type: trigger.when?.type, params: whenParams },
      condition: trigger.if ?? null,
      once: Boolean(trigger.once),
      cooldown: Number.isFinite(cooldown) && cooldown > 0 ? cooldown : 0,
      reentryPolicy: this._reentryPolicy(trigger),
      coordination: coordination.group ? coordination : null,
      timer,
      serviceRefs: references(trigger.serviceRefs),
      bindingRefs: references(trigger.bindingRefs),
      actions: trigger.do || []
    };
  }

  _operationFingerprint(trigger, operationId) {
    if (!trigger) return '';
    return stableDigest({
      triggerId: trigger.id,
      definitionDigest: this._triggerDefinitionDigest(trigger),
      operationId
    });
  }

  _validateDefinitionReferences(trigger, errors) {
    const policy = this._reentryPolicy(trigger);
    const validateStepList = (steps, basePath) => {
      for (const [index, step] of (steps || []).entries()) {
        const nodePath = `${basePath}.do[${index}]`;
        if (Array.isArray(step?.branch)) {
          for (const [bIndex, branch] of step.branch.entries()) {
            validateStepList(branch?.do || [], `${nodePath}.branch[${bIndex}]`);
          }
          continue;
        }
        const descriptor = this.actionDescriptorRegistry?.get?.(step?.action);
        if (!descriptor && typeof this.actions[step?.action] !== 'function') {
          errors.push({ code: 'invalidReference', path: `${nodePath}.action`, message: `未知 action ${String(step?.action)}` });
        }
        if (descriptor && !descriptor.allowedReentryPolicies.includes(policy)) {
          errors.push({ code: 'invalidReentry', path: `triggers.definitions.${trigger.id}.reentryPolicy`, message: `action ${step.action} 不允许 ${policy}` });
        }
        for (const ref of step?.serviceRefs || []) this._validateServiceRef(ref, nodePath, errors);
      }
    };
    validateStepList(trigger.do || [], `triggers.definitions.${trigger.id}`);
    for (const ref of trigger.serviceRefs || []) this._validateServiceRef(ref, trigger.id, errors);
    for (const raw of trigger.bindingRefs || []) {
      const id = typeof raw === 'string' ? raw : raw?.id;
      const resolver = this.bindingReferenceResolver || this.ctx.triggerBindings;
      const exists = typeof resolver === 'function' ? resolver(id) : (resolver?.has?.(id) || resolver?.get?.(id));
      if (!hasText(id) || !exists) errors.push({ code: 'invalidReference', path: `triggers.definitions.${trigger.id}.bindingRefs`, message: `未知 binding ${String(id)}` });
    }
  }

  _validateServiceRef(raw, owner, errors) {
    const id = typeof raw === 'string' ? raw : raw?.id;
    const resolver = this.serviceReferenceResolver || this.ctx.services;
    const exists = typeof resolver === 'function' ? resolver(id) : (resolver?.has?.(id) || resolver?.get?.(id) || resolver?.[id]);
    if (!hasText(id) || !exists) errors.push({ code: 'invalidReference', path: `triggers.definitions.${owner}.serviceRefs`, message: `未知 service ${String(id)}` });
  }
}

export default TriggerSystem;

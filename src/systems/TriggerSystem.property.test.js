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

import { describe, expect, it } from 'vitest';
import { normalizeRuntimeDebugMode } from '../core/CanonicalSnapshot.js';
import { MonotonicClock } from '../core/command/AuthorityClocks.js';
import { ScenarioDefinitionIndex } from '../core/scenario/ScenarioDefinitionIndex.js';
import { TriggerGraph } from '../core/scenario/TriggerGraph.js';
import { SeedGenerator } from '../../test/support/ModelTesting.js';
import { TriggerSystem } from './TriggerSystem.js';

const DEBUG_VALUES = Object.freeze([true, 1, '1', false, 0, '0', null, undefined, '', 'true', 2]);
const PROPERTY_SEEDS = Object.freeze([
  0x9a240001, 0x9a240002, 0x9a240003, 0x9a240004,
  0x9a240005, 0x9a240006, 0x9a240007, 0x9a240008
]);
const FAULT_KINDS = Object.freeze(['unknown', 'schema', 'okFalse', 'syncThrow', 'asyncReject']);
const REENTRY_POLICIES = Object.freeze(['reject', 'queue', 'restart']);
const TIMER_POLICIES = Object.freeze(['resume', 'skip', 'single', 'all']);
const DEFINITION_REVISION = 24;

function commandResult(operationId, overrides = {}) {
  return {
    ok: true, operationId, status: 'committed', committed: true, code: null,
    stateId: 'service:scenario', stateRevision: 1, eventFrom: 1, eventTo: 1,
    value: { accepted: true }, error: null, ...overrides
  };
}

function descriptorRegistry(ids) {
  const known = new Set(ids);
  return {
    get(id) {
      return known.has(id) ? { id, allowedReentryPolicies: [...REENTRY_POLICIES] } : null;
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function generatedChainScenario(seed, faultKind = 'none', faultIndex = -1) {
  const random = new SeedGenerator(`${seed}:${faultKind}:${faultIndex}`);
  const triggerCount = random.int(2, 5);
  const triggerIds = Array.from({ length: triggerCount }, (_, index) => `trigger.${random.string(5)}.${index}`);
  const actionCount = faultKind === 'none'
    ? random.int(2, 6)
    : Math.max(2, faultIndex + 2, random.int(2, 6));
  const actions = Array.from({ length: actionCount }, (_, index) => ({
    action: index === faultIndex && faultKind === 'unknown' ? 'action.missing' : `action.${index}`,
    params: {
      fault: index === faultIndex ? faultKind : 'none',
      amount: random.int(0, 20),
      enabled: random.bool(),
      nested: { tag: random.string(6), values: [random.int(0, 9), random.int(0, 9)] }
    }
  }));
  const triggers = triggerIds.map((id, index) => ({
    id,
    when: { type: 'signal', params: index === 0 ? { channel: `channel.${random.string(4)}` } : {} },
    triggerRefs: index + 1 < triggerIds.length ? [triggerIds[index + 1]] : [],
    do: index === 0 ? actions : []
  }));
  if (random.bool()) triggers.at(-1).triggerRefs = [triggerIds[0]];
  const signal = {
    channel: triggers[0].when.params.channel,
    operationId: `operation.${random.string(10)}`,
    actorRef: `actor.${random.string(5)}`,
    payload: { count: random.int(0, 12), flags: [random.bool(), random.bool()] }
  };
  return {
    seed, faultKind, faultIndex, triggerIds, triggers, actions, signal,
    debugValue: random.pick(DEBUG_VALUES),
    once: random.bool(), cooldown: random.int(1, 8),
    scenario: {
      id: `scenario.${random.string(6)}`, scope: { sceneId: `S${random.int(1, 14).toString().padStart(2, '0')}` },
      triggerRefs: triggerIds, entryTriggerRefs: [triggerIds[0]], exitTriggerRefs: [triggerIds.at(-1)]
    }
  };
}

function expectedChain(scenario) {
  const succeeded = scenario.faultKind === 'none';
  const stoppedAt = succeeded ? scenario.actions.length - 1 : scenario.faultIndex;
  return {
    status: succeeded ? 'succeeded' : 'failed',
    actionIndex: stoppedAt,
    executedIndexes: Array.from({ length: stoppedAt + 1 }, (_, index) => index),
    committedIndexes: Array.from({ length: succeeded ? scenario.actions.length : stoppedAt }, (_, index) => index),
    finalType: succeeded ? 'triggerSucceeded' : 'triggerFailed',
    onceCommitted: succeeded && scenario.once,
    cooldownCommitted: succeeded
  };
}

function graphOracle(scenario) {
  const successors = Object.fromEntries(scenario.triggers.map(trigger => [trigger.id, [...trigger.triggerRefs]]));
  const reachable = [];
  const pending = [scenario.triggerIds[0]];
  while (pending.length) {
    const id = pending.shift();
    if (reachable.includes(id)) continue;
    reachable.push(id);
    pending.push(...successors[id]);
  }
  return { successors, reachable };
}

async function withScenario(scenario, assertion) {
  try {
    await assertion();
  } catch (error) {
    error.message = `Property 9 minimal counterexample seed=${scenario.seed} scenario=${JSON.stringify(scenario)}\n${error.message}`;
    throw error;
  }
}

async function executeChainScenario(scenario) {
  const trace = [];
  const events = [];
  const diagnosticRecords = [];
  const actionFailures = [];
  const knownActionIds = scenario.actions
    .map(action => action.action)
    .filter(id => id !== 'action.missing');
  let triggerSystem;
  const commandAdapter = {
    execute(action, context) {
      const index = Number(action.action.split('.').at(-1));
      trace.push({ type: 'actionStart', index, operationId: context.operationId, params: action.params });
      if (action.params.fault === 'schema') {
        throw Object.assign(new Error('generated schema fault'), { code: 'invalidActionParams' });
      }
      if (action.params.fault === 'syncThrow') throw new Error('generated sync fault');
      if (action.params.fault === 'asyncReject') return Promise.reject(new Error('generated async fault'));
      if (action.params.fault === 'okFalse') {
        return commandResult(context.operationId, {
          ok: false, status: 'failed', committed: false, code: 'generatedReject', error: { message: 'rejected' }
        });
      }
      trace.push({ type: 'actionCommit', index, operationId: context.operationId });
      return commandResult(context.operationId, { stateRevision: index + 1 });
    }
  };
  const sceneDiagnostics = {
    recordTriggerFailure(envelope) {
      diagnosticRecords.push(envelope);
      trace.push({ type: 'diagnostic', envelope });
      return true;
    }
  };
  triggerSystem = new TriggerSystem({
    runtimeConfig: { debug: scenario.debugValue },
    monotonicClock: new MonotonicClock(100),
    definitionRevision: DEFINITION_REVISION,
    actionDescriptorRegistry: descriptorRegistry(knownActionIds),
    commandAdapter,
    sceneDiagnostics,
    applicationEventPublisher(event) {
      const record = triggerSystem.getExecution(scenario.triggerIds[0]);
      trace.push({ type: 'notification', eventType: event.type, ledgerStatus: record.status });
      events.push(event);
    }
  });
  triggerSystem.on((type, _trigger, details) => {
    if (type !== 'actionFailed') return;
    actionFailures.push(details);
    trace.push({ type: 'actionFailure', details });
  });
  triggerSystem.register({
    ...scenario.triggers[0], once: scenario.once, cooldown: scenario.cooldown, do: scenario.actions
  });
  expect(triggerSystem.fire('signal', scenario.signal)).toBe(1);
  let exposedError = null;
  try {
    await triggerSystem.waitForIdle();
  } catch (error) {
    exposedError = error;
    trace.push({ type: 'callerReject', error });
  }
  return { triggerSystem, trace, events, diagnosticRecords, actionFailures, exposedError };
}
async function runReentryScenario(seed, policy) {
  const random = new SeedGenerator(`${seed}:${policy}`);
  const gate = deferred();
  const calls = [];
  const events = [];
  let first = true;
  const system = new TriggerSystem({
    definitionRevision: DEFINITION_REVISION,
    actionDescriptorRegistry: descriptorRegistry(['action.work']),
    commandAdapter: {
      async execute(action, context) {
        calls.push({ operationId: context.operationId, payload: action.params });
        if (first) { first = false; await gate.promise; }
        return commandResult(context.operationId, { value: { token: action.params.token } });
      }
    },
    applicationEventPublisher: event => events.push(event)
  });
  system.register({
    id: `trigger.${policy}`, reentryPolicy: policy, when: { type: 'signal' },
    do: [{ action: 'action.work', params: { token: random.string(8), amount: random.int(0, 20) } }]
  });
  const firstAccepted = system.fire('signal', { operationId: `${policy}.first` });
  const secondAccepted = system.fire('signal', { operationId: `${policy}.second` });
  gate.resolve();
  await system.waitForIdle();
  return { system, calls, events, firstAccepted, secondAccepted };
}

function expectedReentry(policy) {
  // operationId 身份契约：引擎派生（revision=24、默认 clock=0）。两次 fire 消耗 seq 1/2
  // （即使被 reject 也会先创建 request），客户端传入的 `${policy}.first/second` 不被信任。
  const firstDerived = `event:trigger:${DEFINITION_REVISION}:0:1`;
  const secondDerived = `event:trigger:${DEFINITION_REVISION}:0:2`;
  if (policy === 'reject') {
    return {
      accepted: [1, 0], calls: [firstDerived],
      events: [['triggerSucceeded', firstDerived]], finalOperationId: firstDerived
    };
  }
  if (policy === 'queue') {
    return {
      accepted: [1, 1], calls: [firstDerived, secondDerived],
      events: [['triggerSucceeded', firstDerived], ['triggerSucceeded', secondDerived]],
      finalOperationId: secondDerived
    };
  }
  return {
    accepted: [1, 1], calls: [firstDerived, secondDerived],
    events: [['triggerFailed', firstDerived], ['triggerSucceeded', secondDerived]],
    finalOperationId: secondDerived
  };
}

function expectedTimer(snapshotTimer, restoredNow, policy) {
  const overdue = snapshotTimer.nextDue <= restoredNow;
  if (policy === 'resume') {
    return { executions: 0, nextDue: restoredNow + snapshotTimer.remaining };
  }
  if (policy === 'skip') {
    return {
      executions: 0,
      nextDue: overdue ? restoredNow + snapshotTimer.interval : restoredNow + snapshotTimer.remaining
    };
  }
  if (policy === 'single') {
    return {
      executions: overdue ? 1 : 0,
      nextDue: overdue ? restoredNow + snapshotTimer.interval : restoredNow + snapshotTimer.remaining
    };
  }
  const dueCount = overdue ? Math.floor((restoredNow - snapshotTimer.nextDue) / snapshotTimer.interval) + 1 : 0;
  return {
    executions: Math.min(dueCount, snapshotTimer.maxCatchUp),
    nextDue: overdue ? snapshotTimer.nextDue + dueCount * snapshotTimer.interval : snapshotTimer.nextDue
  };
}

// Property 9: Fix Checking — Trigger Failure Stop, Success-Only Ledger Commit,
// and Recoverable Timing.
// **Validates: Requirements 2.12, 3.4, 3.7, 3.10**
describe('Property 9: Trigger/scenario operation model', () => {
  it('生成 scenario/trigger graph 时只读派生引用闭包、可达性和 entry/exit', () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = generatedChainScenario(seed);
      const snapshot = Object.freeze({
        definitionRevision: DEFINITION_REVISION,
        project: Object.freeze({ triggers: scenario.triggers, tutorials: [], scenarios: [scenario.scenario] })
      });
      const graph = TriggerGraph.fromSnapshot(snapshot);
      const index = ScenarioDefinitionIndex.fromSnapshot(snapshot, { triggerGraph: graph });
      const model = graphOracle(scenario);

      expect(graph.definitionRevision, `seed=${seed}`).toBe(DEFINITION_REVISION);
      for (const triggerId of scenario.triggerIds) {
        expect(graph.successors(triggerId), `seed=${seed} trigger=${triggerId}`)
          .toEqual(model.successors[triggerId]);
      }
      expect(index.getReferenceClosure(scenario.scenario.id)).toEqual({
        scenarios: [scenario.scenario.id], triggers: scenario.triggerIds,
        quests: [], dialogues: [], scenes: [], commands: []
      });
      expect(index.getEntry(scenario.scenario.id)).toEqual([scenario.triggerIds[0]]);
      expect(index.getExit(scenario.scenario.id)).toEqual([scenario.triggerIds.at(-1)]);
      expect(index.getReachable(scenario.scenario.id)).toEqual(model.reachable);
      expect(Object.isFrozen(index.toEditorView(scenario.scenario.id))).toBe(true);
    }
  });

  it('生成任意失败位置、debug 配置与同步/异步 fault 时按 operation model 停链并仅成功提交 once/cooldown', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenarios = [generatedChainScenario(seed)];
      for (const faultKind of FAULT_KINDS) {
        const maxFailureIndex = new SeedGenerator(`${seed}:${faultKind}:failure-position`).int(1, 4);
        for (let faultIndex = 0; faultIndex <= maxFailureIndex; faultIndex++) {
          scenarios.push(generatedChainScenario(seed, faultKind, faultIndex));
        }
      }
      for (const scenario of scenarios) {
        await withScenario(scenario, async () => {
          const model = expectedChain(scenario);
          const actual = await executeChainScenario(scenario);
          const { triggerSystem, trace, events, diagnosticRecords, actionFailures, exposedError } = actual;
          const record = triggerSystem.getExecution(scenario.triggerIds[0]);
          const started = trace.filter(entry => entry.type === 'actionStart').map(entry => entry.index);
          const committed = trace.filter(entry => entry.type === 'actionCommit').map(entry => entry.index);
          const expectedStarted = scenario.faultKind === 'unknown'
            ? model.executedIndexes.filter(index => index !== scenario.faultIndex)
            : model.executedIndexes;
          const debugEnabled = normalizeRuntimeDebugMode(scenario.debugValue);

          expect(triggerSystem.isDebugEnabled()).toBe(debugEnabled);
          expect(started).toEqual(expectedStarted);
          expect(committed).toEqual(model.committedIndexes);
          // operationId 身份契约：引擎派生 `event:trigger:{revision}:{ms}:{seq}`，
          // 客户端 signal.operationId 不被信任。revision=24、clock=100→100000ms、每实例首次触发 seq=1。
          const derivedOperationId = `event:trigger:${DEFINITION_REVISION}:100000:1`;
          expect(record).toMatchObject({
            status: model.status, actionIndex: model.actionIndex,
            operationId: derivedOperationId, definitionRevision: DEFINITION_REVISION
          });
          expect(triggerSystem.hasFiredOnce(scenario.triggerIds[0])).toBe(model.onceCommitted);
          expect(Boolean(triggerSystem.serialize().cooldowns[scenario.triggerIds[0]]))
            .toBe(model.cooldownCommitted);
          expect(events.map(event => event.type)).toEqual([model.finalType]);
          expect(events[0]).toMatchObject({
            operationId: derivedOperationId,
            payload: {
              triggerId: scenario.triggerIds[0], status: model.status,
              actionIndex: model.actionIndex
            }
          });
          const notification = trace.find(entry => entry.type === 'notification');
          expect(notification).toMatchObject({
            eventType: model.finalType, ledgerStatus: model.status
          });
          expect(JSON.stringify(record)).not.toMatch(/payload|nested|businessFact|accepted/);

          if (model.status === 'failed') {
            expect(scenario.actions.length).toBeGreaterThan(scenario.faultIndex + 1);
            expect(started.every(index => index <= scenario.faultIndex)).toBe(true);
            expect(committed.every(index => index < scenario.faultIndex)).toBe(true);
            expect(actionFailures).toHaveLength(1);
            expect(events[0].payload).toMatchObject({
              triggerId: scenario.triggerIds[0], actionIndex: scenario.faultIndex
            });
            if (debugEnabled) {
              expect(exposedError).toMatchObject({
                name: 'TriggerExecutionError', actionIndex: scenario.faultIndex,
                operationId: derivedOperationId
              });
              expect(diagnosticRecords).toHaveLength(1);
              const envelope = diagnosticRecords[0];
              expect(envelope).toMatchObject({
                triggerId: scenario.triggerIds[0], operationId: derivedOperationId,
                action: { index: scenario.faultIndex },
                replay: { fingerprint: expect.any(String) }
              });
              expect(actionFailures[0]).toBe(envelope);
              expect(events[0].payload.failure).toBe(envelope);
              const order = trace.map(entry => entry.type);
              expect(order.indexOf('diagnostic')).toBeLessThan(order.indexOf('actionFailure'));
              expect(order.indexOf('actionFailure')).toBeLessThan(order.indexOf('notification'));
              expect(order.indexOf('notification')).toBeLessThan(order.indexOf('callerReject'));
            } else {
              expect(exposedError).toBeNull();
              expect(diagnosticRecords).toEqual([]);
              expect(actionFailures[0]).toEqual({
                triggerId: scenario.triggerIds[0], actionIndex: scenario.faultIndex,
                operationId: derivedOperationId,
                code: expect.any(String)
              });
              expect(JSON.stringify(events[0].payload))
                .not.toMatch(/executionContext|fingerprint|stack|cause|seed|payload|nested/);
            }
          } else {
            expect(exposedError).toBeNull();
            expect(diagnosticRecords).toEqual([]);
            expect(actionFailures).toEqual([]);
            // once 或 cooldown 都必须让整链成功后的立即重试无法二次提交。
            expect(triggerSystem.fire('signal', scenario.signal)).toBe(0);
            expect(events).toHaveLength(1);
          }
        });
      }
    }
  });

  it('生成 reject/queue/restart 重入时与 operation model 的接受、执行及最终通知顺序一致', async () => {
    for (const seed of PROPERTY_SEEDS) {
      for (const policy of REENTRY_POLICIES) {
        const scenario = { seed, policy };
        await withScenario(scenario, async () => {
          const actual = await runReentryScenario(seed, policy);
          const model = expectedReentry(policy);
          expect([actual.firstAccepted, actual.secondAccepted]).toEqual(model.accepted);
          expect(actual.calls.map(call => call.operationId)).toEqual(model.calls);
          expect(actual.events.map(event => [event.type, event.operationId])).toEqual(model.events);
          expect(actual.system.getExecution(`trigger.${policy}`)).toMatchObject({
            status: 'succeeded', operationId: model.finalOperationId
          });
          if (policy === 'restart') {
            // 两次触发生成不同派生 id（seq 1 / 2）；旧链以派生 id 失败，不再沿用客户端传入值。
            expect(actual.calls[0].operationId).toBe(`event:trigger:${DEFINITION_REVISION}:0:1`);
            expect(actual.events[0]).toMatchObject({
              type: 'triggerFailed', operationId: `event:trigger:${DEFINITION_REVISION}:0:1`,
              payload: { code: 'reentryRestarted' }
            });
          }
        });
      }
    }
  });

  it('生成 timer snapshot 与恢复时按 definition catch-up policy 得到相同次数、nextDue 和 ledger', async () => {
    for (const seed of PROPERTY_SEEDS) {
      for (const policy of TIMER_POLICIES) {
        const random = new SeedGenerator(`${seed}:timer:${policy}`);
        const sourceNow = random.int(0, 500);
        const intervalSeconds = random.int(1, 4);
        const maxCatchUp = random.int(1, 5);
        const sourceClock = new MonotonicClock(sourceNow);
        const source = new TriggerSystem({ monotonicClock: sourceClock, definitionRevision: DEFINITION_REVISION });
        source.registerAction('timer.tick', () => commandResult('ignored'));
        source.register({
          id: 'trigger.timer', reentryPolicy: 'queue', catchUpPolicy: policy, maxCatchUp,
          when: { type: 'timer', params: { seconds: intervalSeconds } },
          do: [{ action: 'timer.tick', params: { token: random.string(7) } }]
        });
        sourceClock.advance(random.int(0, intervalSeconds * 500));
        const snapshot = source.serialize();
        const savedTimer = snapshot.timers[0];
        const restoredNow = savedTimer.nextDue + random.int(0, intervalSeconds * 4) * 1000 + random.int(0, 999);
        const restoredClock = new MonotonicClock(restoredNow);
        let executions = 0;
        const restored = new TriggerSystem({ monotonicClock: restoredClock, definitionRevision: DEFINITION_REVISION });
        restored.registerAction('timer.tick', () => { executions++; return commandResult('ignored'); });
        restored.register({
          id: 'trigger.timer', reentryPolicy: 'queue', catchUpPolicy: policy, maxCatchUp,
          when: { type: 'timer', params: { seconds: intervalSeconds } },
          do: [{ action: 'timer.tick', params: { token: snapshot.ledger.records[0]?.triggerId || 'timer' } }]
        });

        const scenario = { seed, policy, intervalSeconds, maxCatchUp, sourceNow, restoredNow, savedTimer };
        await withScenario(scenario, async () => {
          expect(restored.deserialize(snapshot)).toEqual({ ok: true, errors: [] });
          const model = expectedTimer(savedTimer, restoredNow, policy);
          restored.update(0);
          await restored.waitForIdle();
          const timer = restored.serialize().timers[0];
          expect(executions).toBe(model.executions);
          expect(timer.nextDue).toBe(model.nextDue);
          expect(timer.remaining).toBe(Math.max(0, model.nextDue - restoredNow));
          const record = restored.getExecution('trigger.timer');
          expect(record.status).toBe(model.executions > 0 ? 'succeeded' : 'idle');
        });
      }
    }
  });

  it('生成损坏 timer/ledger snapshot 时验证失败且当前 ledger、once、cooldown、timer 原子不变', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const random = new SeedGenerator(`${seed}:snapshot-corruption`);
      const clock = new MonotonicClock(random.int(0, 1000));
      const system = new TriggerSystem({ monotonicClock: clock, definitionRevision: DEFINITION_REVISION });
      system.registerAction('action.ok', () => commandResult('ignored'));
      system.register({
        id: 'trigger.stateful', once: true, cooldown: random.int(1, 8),
        when: { type: 'signal' }, do: [{ action: 'action.ok', params: { value: random.int(0, 20) } }]
      });
      system.register({
        id: 'trigger.timer', catchUpPolicy: 'resume',
        when: { type: 'timer', params: { seconds: random.int(1, 4) } },
        do: [{ action: 'action.ok' }]
      });
      system.fire('signal', { operationId: `operation.${random.string(8)}` });
      await system.waitForIdle();
      const before = system.serialize();
      const candidate = structuredClone(before);
      const corruption = random.pick(['remaining', 'revision', 'fingerprint']);
      if (corruption === 'remaining') candidate.timers[0].remaining = -1;
      if (corruption === 'revision') candidate.timers[0].definitionRevision++;
      if (corruption === 'fingerprint') {
        candidate.ledger.records.find(record => record.triggerId === 'trigger.stateful').fingerprint = 'tampered';
      }
      const scenario = { seed, corruption, candidate };
      await withScenario(scenario, async () => {
        const result = system.deserialize(candidate);
        if (corruption === 'fingerprint') {
          // fingerprint 契约：逐记录 fingerprint 不匹配 → 软重置（接受快照、
          // 重置该 Trigger 的 ledger/firedOnce/cooldown），未受影响的 timer 原样保留。
          expect(result.ok).toBe(true);
          const after = system.serialize();
          expect(after.firedOnce).toEqual([]);
          expect(after.cooldowns).toEqual({});
          expect(after.ledger.records.find(record => record.triggerId === 'trigger.stateful'))
            .toMatchObject({ status: 'idle', operationId: null, fingerprint: null });
          expect(after.ledger.records.find(record => record.triggerId === 'trigger.timer'))
            .toEqual(before.ledger.records.find(record => record.triggerId === 'trigger.timer'));
          expect(after.timers).toEqual(before.timers);
        } else {
          expect(result.ok).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(system.serialize()).toEqual(before);
        }
      });
    }
  });
});

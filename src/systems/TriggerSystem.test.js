// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonotonicClock } from '../core/command/AuthorityClocks.js';
import { Blackboard } from '../core/Blackboard.js';
import { SceneDiagnostics } from '../core/scene/SceneDiagnostics.js';
import { canonicalDigestInput, sha256Text, stableDigest } from '../core/StableDigest.js';
import { TriggerSystem } from './TriggerSystem.js';

function commandResult(operationId, overrides = {}) {
  return {
    ok: true, operationId, status: 'committed', committed: true, code: null,
    stateId: 'service:one', stateRevision: 1, eventFrom: 1, eventTo: 1,
    value: { businessFact: 'must-not-enter-trigger-ledger' }, error: null,
    ...overrides
  };
}

function descriptorRegistry(ids = []) {
  const descriptors = new Map(ids.map(id => [id, {
    id, allowedReentryPolicies: ['reject', 'queue', 'restart']
  }]));
  return { get: id => descriptors.get(id) || null };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function diagnosticScene(runtimeConfig = { debug: true }) {
  const scene = {
    name: 'trigger-debug-scene', isActive: true, isPaused: false,
    sceneManager: null, debugMode: runtimeConfig.debug === true
  };
  const diagnostics = new SceneDiagnostics(scene, { runtimeConfig });
  return { scene, diagnostics };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('stable synchronous digest', () => {
  it('使用标准 SHA-256 并对 canonical key 顺序产生相同且不含原文的摘要', () => {
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(canonicalDigestInput({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe('{"nested":{"a":1,"b":2},"z":1}');
    const first = stableDigest({ z: 1, token: 'raw-secret', nested: { b: 2, a: 1 } });
    const reordered = stableDigest({ nested: { a: 1, b: 2 }, token: 'raw-secret', z: 1 });
    const changed = stableDigest({ nested: { a: 1, b: 3 }, token: 'raw-secret', z: 1 });
    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(first).not.toContain('raw-secret');
  });
});

describe('TriggerSystem 定义变化的存档兼容策略', () => {
  function buildSystem(amount) {
    const system = new TriggerSystem({ definitionRevision: 18 });
    system.registerAction('save', () => undefined);
    system.register({
      id: 'tuned-trigger', when: { type: 'signal' }, once: false,
      do: [{ action: 'save', params: { amount } }]
    });
    system.register({
      id: 'once-trigger', when: { type: 'signal', params: { topic: 'tutorial' } }, once: true,
      do: [{ action: 'save', params: { amount: 0 } }]
    });
    return system;
  }

  it('仅调整已执行 Trigger 的参数值：读档成功，该 Trigger 执行痕迹重置且未变更历史保留', async () => {
    const saved = buildSystem(1);
    saved.fire('signal', { operationId: 'op-tuned' });
    saved.fire('signal', { topic: 'tutorial', operationId: 'op-once' });
    await saved.waitForIdle();
    const snapshot = saved.serialize();
    expect(saved.hasFiredOnce('once-trigger')).toBe(true);

    // 参数 1 → 2：定义变化。读档必须成功（旧策略直接拒绝），变更 Trigger 痕迹重置。
    const restored = buildSystem(2);
    const validation = restored.validateSnapshot(snapshot);
    expect(validation.ok).toBe(true);
    expect(validation.changedTriggerIds.has('tuned-trigger')).toBe(true);
    expect(restored.deserialize(snapshot).ok).toBe(true);
    expect(restored.getExecution('tuned-trigger').status).toBe('idle');
    // 未变更 Trigger 的 once 历史完整保留
    expect(restored.hasFiredOnce('once-trigger')).toBe(true);
  });

  it('变更后的 once Trigger 可以在新定义下重新触发', async () => {
    const buildOnce = amount => {
      const system = new TriggerSystem({ definitionRevision: 18 });
      system.registerAction('save', () => undefined);
      system.register({
        id: 'once-tuned', when: { type: 'signal' }, once: true,
        do: [{ action: 'save', params: { amount } }]
      });
      return system;
    };
    const saved = buildOnce(1);
    saved.fire('signal', { operationId: 'op-1' });
    await saved.waitForIdle();
    const snapshot = saved.serialize();

    const restored = buildOnce(2);
    expect(restored.deserialize(snapshot).ok).toBe(true);
    expect(restored.hasFiredOnce('once-tuned')).toBe(false);
    expect(restored.fire('signal', { operationId: 'op-2' })).toBe(1);
    await restored.waitForIdle();
    expect(restored.hasFiredOnce('once-tuned')).toBe(true);
  });

  it('快照缺少 definitionDigest 仍拒绝（结构性损坏不放行）', () => {
    const saved = buildSystem(1);
    const snapshot = saved.serialize();
    delete snapshot.definitionDigest;
    const restored = buildSystem(1);
    expect(restored.validateSnapshot(snapshot).ok).toBe(false);
  });
});

describe('TriggerSystem action-chain state machine', () => {
  it('成功链 ledger、snapshot 与恢复校验只保存稳定摘要，不保存 action 参数明文', async () => {
    const createCompleted = async amount => {
      const system = new TriggerSystem({ definitionRevision: 18 });
      system.registerAction('save', () => undefined);
      system.register({
        id: 'digest-success', when: { type: 'signal' },
        do: [{ action: 'save', params: {
          amount, nested: { payload: 'visible-private-payload' },
          savePrivate: 'save-private-value', token: 'credential-token'
        } }]
      });
      system.fire('signal', { operationId: 'stable-digest-operation' });
      await system.waitForIdle();
      return system;
    };

    const first = await createCompleted(1);
    const same = await createCompleted(1);
    const changed = await createCompleted(2);
    const record = first.getExecution('digest-success');
    const snapshot = first.serialize();
    expect(record.fingerprint).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(record.fingerprint).toBe(same.getExecution('digest-success').fingerprint);
    expect(record.fingerprint).not.toBe(changed.getExecution('digest-success').fingerprint);
    expect(JSON.stringify({ record, snapshot })).not.toMatch(
      /visible-private-payload|save-private-value|credential-token/
    );

    const restored = new TriggerSystem({ definitionRevision: 18 });
    restored.registerAction('save', () => undefined);
    restored.register({
      id: 'digest-success', when: { type: 'signal' },
      do: [{ action: 'save', params: {
        amount: 1, nested: { payload: 'visible-private-payload' },
        savePrivate: 'save-private-value', token: 'credential-token'
      } }]
    });
    expect(restored.deserialize(snapshot)).toEqual({ ok: true, errors: [] });
    expect(restored.getExecution('digest-success').fingerprint).toBe(record.fingerprint);
  });
  it.each([
    ['unknown action', null, null, 'unknownAction'],
    ['schema error', ['command'], () => { throw Object.assign(new Error('bad schema'), { code: 'invalidActionParams' }); }, 'invalidActionParams'],
    ['ok:false', ['command'], operationId => commandResult(operationId, { ok: false, committed: false, status: 'failed', code: 'rejected', error: { message: 'no' } }), 'rejected'],
    ['sync throw', null, () => { throw new Error('sync fault'); }, 'triggerActionFailed'],
    ['async reject', null, async () => { throw new Error('async fault'); }, 'triggerActionFailed']
  ])('%s 立即停链并只发布 triggerFailed ApplicationEvent', async (_name, descriptorIds, behavior, expectedCode) => {
    const events = [];
    const publisher = vi.fn(event => events.push(event));
    const registry = descriptorIds ? descriptorRegistry(descriptorIds) : null;
    const commandAdapter = descriptorIds ? {
      execute: vi.fn((_action, context) => behavior(context.operationId))
    } : null;
    const trigger = new TriggerSystem({
      actionDescriptorRegistry: registry,
      commandAdapter,
      definitionRevision: 7,
      applicationEventPublisher: publisher
    });
    if (!descriptorIds && behavior) trigger.registerAction('command', behavior);
    trigger.registerAction('must-not-run', vi.fn());
    const second = trigger.actions['must-not-run'];
    trigger.register({
      id: 'chain', when: { type: 'signal' }, once: true, cooldown: 30,
      do: [{ action: descriptorIds || behavior ? 'command' : 'missing' }, { action: 'must-not-run' }]
    });

    expect(trigger.fire('signal', { operationId: 'trigger-op' })).toBe(1);
    await trigger.waitForIdle();

    expect(second).not.toHaveBeenCalled();
    expect(trigger.hasFiredOnce('chain')).toBe(false);
    expect(trigger.serialize().cooldowns).toEqual({});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'triggerFailed', operationId: 'trigger-op',
      stateType: 'triggerExecution', payload: { status: 'failed', code: expectedCode }
    });
    expect(JSON.stringify(events[0].payload)).not.toMatch(/fingerprint|executionContext|stack|cause|seed/);
    expect(trigger.getExecution('chain')).toMatchObject({ status: 'failed', actionIndex: 0 });
  });

  it('Property 9 最小反例：action 0 成功、未知 action 1 失败、action 2 永不执行且所有索引一致', async () => {
    const diagnostics = { recordTriggerFailure: vi.fn() };
    const events = [];
    const actionFailures = [];
    const third = vi.fn();
    const trigger = new TriggerSystem({
      runtimeConfig: { debug: true },
      sceneDiagnostics: diagnostics,
      definitionRevision: 12,
      applicationEventPublisher: event => events.push(event)
    });
    trigger.init({
      runtimeConfig: { debug: true, definitionRevision: 12 },
      sceneDiagnostics: diagnostics,
      credentials: { token: 'secret-token' }
    });
    trigger.on((type, _definition, details) => {
      if (type === 'actionFailed') actionFailures.push(details);
    });
    trigger.registerAction('first', () => undefined);
    trigger.registerAction('third', third);
    trigger.register({
      id: 'actual-failure-index', when: { type: 'signal' }, once: true, cooldown: 5,
      do: [{ action: 'first' }, { action: 'missing', params: { savePrivate: 'private-value' } }, { action: 'third' }]
    });

    trigger.fire('signal', { operationId: 'failure-index-op', token: 'signal-secret' });
    await expect(trigger.waitForIdle()).rejects.toMatchObject({
      name: 'TriggerExecutionError', code: 'unknownAction', actionIndex: 1,
      operationId: 'failure-index-op', cause: { code: 'unknownAction' }
    });

    const record = trigger.getExecution('actual-failure-index');
    const envelope = diagnostics.recordTriggerFailure.mock.calls[0][0];
    expect(third).not.toHaveBeenCalled();
    expect(record).toMatchObject({ status: 'failed', actionIndex: 1, operationId: 'failure-index-op' });
    expect(record.fingerprint).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(JSON.stringify(trigger.serialize())).not.toMatch(/private-value|signal-secret|secret-token/);
    expect(envelope).toMatchObject({
      triggerId: 'actual-failure-index', operationId: 'failure-index-op',
      definitionRevision: 12, phase: 'resolveAction', reason: 'unknownAction',
      action: { id: 'missing', index: 1 },
      replay: { fingerprint: expect.any(String), token: '12:actual-failure-index:failure-index-op:1' }
    });
    expect(actionFailures).toEqual([envelope]);
    expect(JSON.stringify(envelope)).not.toContain('secret-token');
    expect(JSON.stringify(envelope)).not.toContain('signal-secret');
    expect(JSON.stringify(envelope)).not.toContain('private-value');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'triggerFailed', operationId: 'failure-index-op',
      payload: {
        triggerId: 'actual-failure-index', actionIndex: 1, failure: envelope
      }
    });
    expect(trigger.hasFiredOnce('actual-failure-index')).toBe(false);
    expect(trigger.serialize().cooldowns).toEqual({});
  });

  it('debug reject 保留原始 Error/cause 身份，同时 envelope 提供安全递归 cause', async () => {
    const rootCause = new Error('database token=raw-secret');
    const original = new Error('async action failed', { cause: rootCause });
    const diagnostics = { recordTriggerFailure: vi.fn() };
    const trigger = new TriggerSystem({
      runtimeConfig: { debug: true }, sceneDiagnostics: diagnostics, definitionRevision: 13
    });
    trigger.registerAction('explode', async () => { throw original; });
    trigger.register({ id: 'cause-chain', when: { type: 'signal' }, do: [{ action: 'explode' }] });

    trigger.fire('signal', { operationId: 'cause-op' });
    let exposed;
    try {
      await trigger.waitForIdle();
    } catch (error) {
      exposed = error;
    }

    expect(exposed.cause).toBe(original);
    expect(exposed.cause.cause).toBe(rootCause);
    expect(exposed.envelope).toMatchObject({
      action: { index: 0, id: 'explode' }, phase: 'executeAsync', reason: 'triggerActionFailed',
      error: { message: 'async action failed', cause: { name: 'Error' } }
    });
    expect(JSON.stringify(exposed.envelope)).not.toContain('raw-secret');
    expect(diagnostics.recordTriggerFailure).toHaveBeenCalledWith(exposed.envelope, { openPanel: true });
  });

  it('同步和异步 action 都等待 CommandResult，全链成功后才提交 once/cooldown 与成功通知', async () => {
    const clock = new MonotonicClock(100);
    const calls = [];
    const events = [];
    const trigger = new TriggerSystem({
      monotonicClock: clock,
      definitionRevision: 'revision-4',
      operationIdFactory: () => 'stable-trigger-operation',
      actionDescriptorRegistry: descriptorRegistry(['first', 'second']),
      commandAdapter: {
        execute: async (action, context) => {
          calls.push({ action: action.action, operationId: context.operationId });
          return commandResult(context.operationId);
        }
      },
      applicationEventPublisher: event => events.push(event)
    });
    trigger.register({
      id: 'successful', when: { type: 'signal' }, once: true, cooldown: 2,
      do: [{ action: 'first' }, { action: 'second' }]
    });

    expect(trigger.fire('signal')).toBe(1);
    expect(trigger.hasFiredOnce('successful')).toBe(false);
    await trigger.waitForIdle();

    expect(calls).toEqual([
      { action: 'first', operationId: 'stable-trigger-operation:action:0' },
      { action: 'second', operationId: 'stable-trigger-operation:action:1' }
    ]);
    expect(trigger.hasFiredOnce('successful')).toBe(true);
    expect(trigger.serialize().cooldowns.successful).toMatchObject({ remaining: 2000, nextDue: 2100 });
    expect(events.map(event => event.type)).toEqual(['triggerSucceeded']);
    expect(trigger.getExecution('successful')).toMatchObject({
      status: 'succeeded', actionIndex: 1, operationId: 'stable-trigger-operation'
    });
    expect(trigger.getExecution('successful').result).not.toHaveProperty('value');
    expect(JSON.stringify(trigger.serialize())).not.toMatch(/businessFact|Story|Quest|Dialogue|Tutorial|Rescue|Battle/);
  });
});

describe('TriggerSystem reentry policy', () => {
  it('reject 拒绝并发，queue 顺序执行所有已接受链', async () => {
    for (const policy of ['reject', 'queue']) {
      const gate = deferred();
      const operations = [];
      let first = true;
      const trigger = new TriggerSystem({ definitionRevision: 1 });
      trigger.registerAction('work', async (_params, _ctx, event) => {
        operations.push(event.params.operationId);
        if (first) { first = false; await gate.promise; }
        return commandResult(event.params.operationId);
      });
      trigger.register({ id: policy, reentryPolicy: policy, when: { type: 'signal' }, do: [{ action: 'work' }] });

      expect(trigger.fire('signal', { operationId: `${policy}-1` })).toBe(1);
      expect(trigger.fire('signal', { operationId: `${policy}-2` })).toBe(policy === 'queue' ? 1 : 0);
      gate.resolve();
      await trigger.waitForIdle();
      expect(operations).toEqual(policy === 'queue' ? [`${policy}-1`, `${policy}-2`] : [`${policy}-1`]);
    }
  });

  it('restart 只停止旧协调链后续 action，不撤销已完成的业务 CommandResult', async () => {
    const gate = deferred();
    const calls = [];
    let firstCall = true;
    const events = [];
    const trigger = new TriggerSystem({
      definitionRevision: 2,
      actionDescriptorRegistry: descriptorRegistry(['commit-one', 'commit-two']),
      commandAdapter: {
        execute: async (action, context) => {
          calls.push(`${context.operationId}:${action.action}`);
          if (firstCall) { firstCall = false; await gate.promise; }
          return commandResult(context.operationId);
        }
      },
      applicationEventPublisher: event => events.push(event)
    });
    trigger.register({
      id: 'restartable', reentryPolicy: 'restart', once: true,
      when: { type: 'signal' }, do: [{ action: 'commit-one' }, { action: 'commit-two' }]
    });

    trigger.fire('signal', { operationId: 'old' });
    trigger.fire('signal', { operationId: 'replacement' });
    gate.resolve();
    await trigger.waitForIdle();

    expect(calls).toEqual([
      'old:action:0:commit-one',
      'replacement:action:0:commit-one',
      'replacement:action:1:commit-two'
    ]);
    expect(events.map(event => [event.type, event.operationId])).toEqual([
      ['triggerFailed', 'old'], ['triggerSucceeded', 'replacement']
    ]);
    expect(trigger.hasFiredOnce('restartable')).toBe(true);
  });
});

describe('TriggerSystem timer and atomic snapshot', () => {
  it('保存 remaining/nextDue，并按 definition all catch-up policy 恢复', async () => {
    const sourceClock = new MonotonicClock(0);
    const source = new TriggerSystem({ monotonicClock: sourceClock, definitionRevision: 9 });
    source.registerAction('tick', () => commandResult('ignored'));
    source.register({
      id: 'timer', reentryPolicy: 'queue', catchUpPolicy: 'all', maxCatchUp: 10,
      when: { type: 'timer', params: { seconds: 1 } }, do: [{ action: 'tick' }]
    });
    const snapshot = source.serialize();
    expect(snapshot.timers[0]).toMatchObject({ remaining: 1000, nextDue: 1000, catchUpPolicy: 'all' });

    const restoredClock = new MonotonicClock(3500);
    let ticks = 0;
    const restored = new TriggerSystem({ monotonicClock: restoredClock, definitionRevision: 9 });
    restored.registerAction('tick', () => { ticks++; });
    restored.register({
      id: 'timer', reentryPolicy: 'queue', catchUpPolicy: 'all', maxCatchUp: 10,
      when: { type: 'timer', params: { seconds: 1 } }, do: [{ action: 'tick' }]
    });

    expect(restored.deserialize(snapshot)).toEqual({ ok: true, errors: [] });
    restored.update(0);
    await restored.waitForIdle();
    expect(ticks).toBe(3);
    expect(restored.serialize().timers[0]).toMatchObject({ nextDue: 4000, remaining: 500 });
  });

  it('definition/revision/action/service/binding/fingerprint 任一验证失败时保持当前 ledger/timer/once/cooldown', async () => {
    const clock = new MonotonicClock(50);
    const trigger = new TriggerSystem({ monotonicClock: clock, definitionRevision: 3 });
    const okAction = () => undefined;
    trigger.registerAction('ok', okAction);
    trigger.init({ services: { questService: {} }, triggerBindings: new Map([['binding-1', {}]]) });
    trigger.register({
      id: 'stateful', once: true, cooldown: 4,
      serviceRefs: ['questService'], bindingRefs: ['binding-1'],
      when: { type: 'signal' }, do: [{ action: 'ok' }]
    });
    trigger.register({
      id: 'timer', catchUpPolicy: 'resume',
      when: { type: 'timer', params: { seconds: 2 } }, do: [{ action: 'ok' }]
    });
    trigger.fire('signal', { operationId: 'state-op' });
    await trigger.waitForIdle();
    const before = trigger.serialize();

    const cases = [
      {
        code: 'definitionRevisionMismatch',
        mutate: snapshot => { snapshot.definitionRevision = 4; }
      },
      {
        code: 'invalidReference',
        mutate: snapshot => { snapshot.firedOnce.push('missing-trigger'); }
      },
      {
        code: 'invalidFingerprint',
        mutate: snapshot => { snapshot.ledger.records.find(record => record.triggerId === 'stateful').fingerprint = 'tampered'; }
      },
      {
        code: 'invalidReference',
        setup: () => { delete trigger.actions.ok; },
        cleanup: () => trigger.registerAction('ok', okAction)
      },
      {
        code: 'invalidReference',
        setup: () => trigger.updateContext({ services: {} }),
        cleanup: () => trigger.updateContext({ services: { questService: {} } })
      },
      {
        code: 'invalidReference',
        setup: () => trigger.updateContext({ triggerBindings: new Map() }),
        cleanup: () => trigger.updateContext({ triggerBindings: new Map([['binding-1', {}]]) })
      }
    ];

    for (const testCase of cases) {
      const candidate = structuredClone(before);
      testCase.mutate?.(candidate);
      testCase.setup?.();
      const result = trigger.deserialize(candidate);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: testCase.code })
      ]));
      expect(trigger.serialize()).toEqual(before);
      testCase.cleanup?.();
    }
  });
});


describe('TriggerSystem debug failure exposure contract', () => {
  it.each([
    ['unknown action', 'missing', null, null, 'resolveAction', 'unknownAction'],
    ['schema error', 'command', ['command'], () => {
      throw Object.assign(new Error('bad schema credential=schema-secret'), { code: 'invalidActionParams' });
    }, 'schemaValidation', 'invalidActionParams'],
    ['ok:false', 'command', ['command'], operationId => commandResult(operationId, {
      ok: false, committed: false, status: 'failed', code: 'rejected',
      error: { message: 'password=result-secret' }
    }), 'commandResult', 'rejected'],
    ['sync throw', 'command', null, () => {
      throw new Error('sync token=sync-secret', { cause: new Error('credential=root-secret') });
    }, 'executeSync', 'triggerActionFailed'],
    ['async reject', 'command', null, async () => {
      throw new Error('async password=async-secret', { cause: new Error('token=root-secret') });
    }, 'executeAsync', 'triggerActionFailed']
  ])('%s 在真实 SceneDiagnostics/DebugPanel 记录后发布 triggerFailed，最后明确 reject', async (
    _name, actionId, descriptorIds, behavior, expectedPhase, expectedCode
  ) => {
    const runtimeConfig = { debug: true, definitionRevision: 24 };
    const { scene, diagnostics } = diagnosticScene(runtimeConfig);
    const trace = [];
    const events = [];
    const originalRecord = diagnostics.recordTriggerFailure.bind(diagnostics);
    vi.spyOn(diagnostics, 'recordTriggerFailure').mockImplementation((envelope, options) => {
      trace.push(['diagnostics', envelope]);
      return originalRecord(envelope, options);
    });
    const registry = descriptorIds ? descriptorRegistry(descriptorIds) : null;
    const commandAdapter = descriptorIds ? {
      execute: vi.fn((_action, context) => behavior(context.operationId))
    } : null;
    const trigger = new TriggerSystem({
      runtimeConfig,
      sceneDiagnostics: diagnostics,
      definitionRevision: 24,
      actionDescriptorRegistry: registry,
      commandAdapter,
      applicationEventPublisher(event) {
        trace.push(['triggerFailed', event]);
        events.push(event);
      }
    });
    if (!descriptorIds && behavior) trigger.registerAction(actionId, behavior);
    const cyclic = { label: 'cycle-visible' };
    cyclic.self = cyclic;
    trigger.init({
      runtimeConfig,
      sceneDiagnostics: diagnostics,
      marker: 'replay-visible',
      credentials: { token: 'context-secret' },
      savePrivate: { playerName: 'private-player' },
      cyclic
    });
    trigger.on((type, _definition, details) => {
      if (type === 'actionFailed') trace.push(['actionFailed', details]);
    });
    trigger.register({
      id: `debug-${expectedPhase}`, when: { type: 'signal' },
      do: [{ action: actionId, params: { visible: 'action-visible', token: 'action-secret' } }]
    });

    trigger.fire('signal', {
      operationId: `operation-${expectedPhase}`,
      signalPayload: { visible: 'signal-visible', credential: 'signal-secret' }
    });
    let exposed;
    try {
      await trigger.waitForIdle();
    } catch (error) {
      exposed = error;
      trace.push(['callerReject', error]);
    }

    expect(exposed).toMatchObject({
      name: 'TriggerExecutionError', code: expectedCode, actionIndex: 0,
      operationId: `operation-${expectedPhase}`
    });
    expect(exposed.cause).toBeInstanceOf(Error);
    const envelope = diagnostics.getRecords()[0];
    expect(envelope).toMatchObject({
      type: 'triggerFailure', triggerId: `debug-${expectedPhase}`,
      operationId: `operation-${expectedPhase}`, definitionRevision: 24,
      phase: expectedPhase, reason: expectedCode,
      action: { id: actionId, index: 0, input: { action: actionId, params: { visible: 'action-visible', token: '[REDACTED]' } } },
      executionContext: {
        context: {
          marker: 'replay-visible', credentials: '[REDACTED]', savePrivate: '[REDACTED]',
          cyclic: { label: 'cycle-visible', self: '[Circular:$.context.cyclic]' }
        },
        event: { type: 'signal', params: { operationId: `operation-${expectedPhase}` } }
      },
      replay: {
        fingerprint: expect.any(String), seed: null,
        token: `24:debug-${expectedPhase}:operation-${expectedPhase}:0`
      },
      error: { name: 'Error', message: expect.any(String), stack: expect.any(String) }
    });
    expect(exposed.envelope).toBe(envelope);
    expect(scene.debugPanel.visible).toBe(true);
    expect(scene.debugPanel.diagnosticRecords[0]).toBe(envelope);
    expect(document.querySelector('#dp-trigger-failures').textContent)
      .toContain(`debug-${expectedPhase} #0 ${expectedCode}`);
    expect(events[0]).toMatchObject({
      type: 'triggerFailed', operationId: `operation-${expectedPhase}`,
      payload: { triggerId: `debug-${expectedPhase}`, actionIndex: 0, failure: envelope }
    });
    expect(trace.map(entry => entry[0])).toEqual([
      'diagnostics', 'actionFailed', 'triggerFailed', 'callerReject'
    ]);
    expect(trace[1][1]).toBe(envelope);
    const serialized = JSON.stringify(envelope);
    expect(serialized).toContain('action-visible');
    expect(serialized).toContain('signal-visible');
    expect(serialized).toContain('replay-visible');
    expect(serialized).not.toMatch(/context-secret|private-player|action-secret|signal-secret|schema-secret|result-secret|sync-secret|async-secret|root-secret/);
    diagnostics.dispose();
    expect(diagnostics.getRecords()).toEqual([envelope]);
  });

  it('非 debug 失败停链但不打开面板，玩家可见通知不泄露内部上下文或敏感信息', async () => {
    const runtimeConfig = { debug: false, definitionRevision: 25 };
    const { scene, diagnostics } = diagnosticScene(runtimeConfig);
    const events = [];
    const listenerDetails = [];
    const trigger = new TriggerSystem({
      runtimeConfig, sceneDiagnostics: diagnostics, definitionRevision: 25,
      applicationEventPublisher: event => events.push(event)
    });
    const cyclic = { visible: 'internal-reference' };
    cyclic.self = cyclic;
    trigger.init({
      runtimeConfig, sceneDiagnostics: diagnostics, cyclic,
      credentials: { password: 'player-password' }, seed: 'private-seed'
    });
    trigger.registerAction('explode', () => {
      throw new Error('token=service-token', { cause: new Error('savePrivate=save-secret') });
    });
    trigger.registerAction('must-not-run', vi.fn());
    const second = trigger.actions['must-not-run'];
    trigger.on((type, _definition, details) => listenerDetails.push({ type, details }));
    trigger.register({
      id: 'non-debug-safe', once: true, cooldown: 10, when: { type: 'signal' },
      do: [{ action: 'explode' }, { action: 'must-not-run' }]
    });

    trigger.fire('signal', { operationId: 'non-debug-operation', token: 'signal-token' });
    await expect(trigger.waitForIdle()).resolves.toBeUndefined();

    expect(second).not.toHaveBeenCalled();
    expect(scene.debugPanel).toBeNull();
    expect(diagnostics.getRecords()).toEqual([]);
    expect(trigger.getExecution('non-debug-safe')).toMatchObject({
      status: 'failed', actionIndex: 0, operationId: 'non-debug-operation'
    });
    expect(trigger.hasFiredOnce('non-debug-safe')).toBe(false);
    expect(trigger.serialize().cooldowns).toEqual({});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'triggerFailed', operationId: 'non-debug-operation',
      payload: { triggerId: 'non-debug-safe', actionIndex: 0, code: 'triggerActionFailed' }
    });
    const playerVisible = JSON.stringify({ events, listenerDetails });
    expect(playerVisible).not.toMatch(/executionContext|fingerprint|stack|cause|private-seed|internal-reference|player-password|service-token|save-secret|signal-token/);
  });
});

describe('全 Trigger 化：flowGroupId 仅为兼容标签，不再门控', () => {
  function buildTriggerSystem(triggerOverrides = {}) {
    const calls = [];
    const system = new TriggerSystem({
      monotonicClock: new MonotonicClock(100),
      actionDescriptorRegistry: descriptorRegistry(['action.work']),
      commandAdapter: {
        async execute(action, context) {
          calls.push({ operationId: context.operationId, params: action.params });
          return commandResult(context.operationId);
        }
      }
    });
    system.register({
      id: 'trg.labeled',
      flowGroupId: 'fg-nonexistent-catalog', // 目录已清空，仅为标签
      once: true,
      when: { type: 'state.transaction', params: { definitionId: 'story.done' } },
      do: [{ action: 'action.work', stepId: 'after-done-work', params: { token: 'after-done' } }],
      ...triggerOverrides
    });
    return { system, calls };
  }

  it('登记时不再校验 flowGroupId 是否在目录中存在', () => {
    const { system } = buildTriggerSystem();
    expect(system._triggersById.has('trg.labeled')).toBe(true);
  });

  it('无 FlowGroup 门控：once state.transaction 在事务提交后正常触发', async () => {
    const { system, calls } = buildTriggerSystem();
    expect(system.fire('state.transaction', { definitionId: 'story.done', operationId: 'op-done-1' })).toBe(1);
    await system.waitForIdle();
    expect(calls).toHaveLength(1);
    expect(system.hasFiredOnce('trg.labeled')).toBe(true);
  });
});

describe('多路径进程：步骤级 if + branch[] 分支 + 多教程串行', () => {
  function buildSystem(triggerOverrides = {}, initialBlackboard = {}) {
    const calls = [];
    const system = new TriggerSystem({
      monotonicClock: new MonotonicClock(100),
      actionDescriptorRegistry: descriptorRegistry(['action.work', 'tutorial.command']),
      commandAdapter: {
        async execute(action, context) {
          calls.push({ action: action.action, params: action.params, operationId: context.operationId });
          return commandResult(context.operationId);
        }
      }
    });
    system.init({ blackboard: Object.assign(new Blackboard(), { get: key => initialBlackboard[key] }) });
    system.register({
      id: 'trg.multi',
      flowGroupId: 'fg-label',
      when: { type: 'signal', params: { channel: 'go' } },
      ...triggerOverrides
    });
    return { system, calls };
  }

  it('步骤级 if 命中时执行、未命中时跳过（其余步骤照常）', async () => {
    const { system, calls } = buildSystem({
      do: [
        { stepId: 's1', action: 'action.work', params: { token: 'a' }, if: { op: '==', var: 'hasAxe', value: true } },
        { stepId: 's2', action: 'action.work', params: { token: 'b' } }
      ]
    }, { hasAxe: false });
    expect(system.fire('signal', { channel: 'go', operationId: 'op-go-1' })).toBe(1);
    await system.waitForIdle();
    expect(calls.map(c => c.params.token)).toEqual(['b']);
    expect(system.ledger.get('trg.multi').status).toBe('succeeded');
  });

  it('步骤级 if 支持 story.* 点路径紧凑比较：命中 storyState 嵌套值', async () => {
    const build = storyState => buildSystem({
      do: [
        { stepId: 's1', action: 'action.work', params: { token: 'skin' },
          if: { op: 'and', args: [
            { op: '==', var: 'story.s01Survival.firstWolfKilled', value: true },
            { op: '==', var: 'story.s01Survival.wolfSkinned', value: false }
          ] } },
        { stepId: 's2', action: 'action.work', params: { token: 'next' } }
      ]
    }, { storyState });
    // 首狼已击杀且未剥皮 → 步骤执行
    const { system: run, calls: runCalls } = build({
      s01Survival: { firstWolfKilled: true, wolfSkinned: false }
    });
    expect(run.fire('signal', { channel: 'go', operationId: 'op-run' })).toBe(1);
    await run.waitForIdle();
    expect(runCalls.map(c => c.params.token)).toEqual(['skin', 'next']);
    expect(run.ledger.get('trg.multi').status).toBe('succeeded');
    // 已剥皮 → 步骤跳过，不重复提交
    const { system: skip, calls: skipCalls } = build({
      s01Survival: { firstWolfKilled: true, wolfSkinned: true }
    });
    expect(skip.fire('signal', { channel: 'go', operationId: 'op-skip' })).toBe(1);
    await skip.waitForIdle();
    expect(skipCalls.map(c => c.params.token)).toEqual(['next']);
    expect(skip.ledger.get('trg.multi').status).toBe('succeeded');
  });

  it('branch[] 按 when 命中执行对应路径；未命中回退 otherwise', async () => {
    const { system: axe, calls: axeCalls } = buildSystem({
      do: [{
        stepId: 'br', branch: [
          { when: { op: '==', var: 'hasAxe', value: true }, do: [{ stepId: 'br.axe', action: 'action.work', params: { token: 'axe' } }] },
          { otherwise: true, do: [{ stepId: 'br.none', action: 'action.work', params: { token: 'none' } }] }
        ]
      }]
    }, { hasAxe: true });
    expect(axe.fire('signal', { channel: 'go', operationId: 'op-axe' })).toBe(1);
    await axe.waitForIdle();
    expect(axeCalls.map(c => c.params.token)).toEqual(['axe']);

    const { system: none, calls: noneCalls } = buildSystem({
      do: [{
        stepId: 'br', branch: [
          { when: { op: '==', var: 'hasAxe', value: true }, do: [{ stepId: 'br.axe', action: 'action.work', params: { token: 'axe' } }] },
          { otherwise: true, do: [{ stepId: 'br.none', action: 'action.work', params: { token: 'none' } }] }
        ]
      }]
    }, { hasAxe: false });
    expect(none.fire('signal', { channel: 'go', operationId: 'op-none' })).toBe(1);
    await none.waitForIdle();
    expect(noneCalls.map(c => c.params.token)).toEqual(['none']);
  });

  it('单 Trigger 多教程：do[] 顺序执行多个 tutorial.command 步骤', async () => {
    const { system, calls } = buildSystem({
      do: [
        { stepId: 'tut-1', action: 'tutorial.command', params: { operation: 'show', tutorialId: 'tutorial-001', await: true } },
        { stepId: 'tut-2', action: 'tutorial.command', params: { operation: 'show', tutorialId: 'tutorial-002' } }
      ]
    });
    expect(system.fire('signal', { channel: 'go', operationId: 'op-tut' })).toBe(1);
    await system.waitForIdle();
    expect(calls.map(c => c.action)).toEqual(['tutorial.command', 'tutorial.command']);
    expect(calls.map(c => c.params.tutorialId)).toEqual(['tutorial-001', 'tutorial-002']);
  });

  it('注册时拒绝 action 级 await（应使用 params.await）', () => {
    const { system } = buildSystem({});
    expect(() => system.register({
      id: 'trg.bad',
      flowGroupId: 'fg-label',
      when: { type: 'signal', params: { channel: 'x' } },
      do: [{ stepId: 's1', await: true, action: 'action.work', params: {} }]
    })).toThrow(/params\.await/);
  });

  it('良性结果码（preconditionFailed）等同跳过：不中断整链、不刷红、后续步骤照常', async () => {
    const calls = [];
    const events = [];
    const diagnostics = { recordTriggerFailure: vi.fn() };
    const system = new TriggerSystem({
      monotonicClock: new MonotonicClock(100),
      actionDescriptorRegistry: descriptorRegistry(['action.work']),
      sceneDiagnostics: diagnostics,
      applicationEventPublisher: event => events.push(event),
      commandAdapter: {
        async execute(action, context) {
          calls.push(action.params.token);
          if (action.params.token === 'commit-wolf-skinned') {
            return {
              ok: false, operationId: context.operationId, status: 'rejected', committed: false,
              code: 'preconditionFailed', stateId: null, stateRevision: null,
              eventFrom: null, eventTo: null, value: null,
              error: { message: 'canonical transaction precondition failed' }
            };
          }
          return commandResult(context.operationId);
        }
      }
    });
    system.register({
      id: 'trg.skin', flowGroupId: 'fg-label', when: { type: 'signal' },
      do: [
        { stepId: 'commit-wolf-skinned', action: 'action.work', params: { token: 'commit-wolf-skinned' } },
        { stepId: 'after-wolf-skinned', action: 'action.work', params: { token: 'after' } }
      ]
    });
    expect(system.fire('signal', { operationId: 'op-skin' })).toBe(1);
    await system.waitForIdle();
    // 后续步骤照常执行，整链成功，不产生 triggerFailed 事件、不刷红
    expect(calls).toEqual(['commit-wolf-skinned', 'after']);
    expect(system.ledger.get('trg.skin').status).toBe('succeeded');
    expect(events.some(event => event.type === 'triggerFailed')).toBe(false);
    expect(diagnostics.recordTriggerFailure).not.toHaveBeenCalled();
  });

  it('非良性结果码（rejected）仍为硬失败并中断整链', async () => {
    const calls = [];
    const events = [];
    const system = new TriggerSystem({
      monotonicClock: new MonotonicClock(100),
      actionDescriptorRegistry: descriptorRegistry(['action.work']),
      applicationEventPublisher: event => events.push(event),
      commandAdapter: {
        async execute(action, context) {
          calls.push(action.params.token);
          if (action.params.token === 'bad') {
            return commandResult(context.operationId, {
              ok: false, committed: false, status: 'failed', code: 'rejected',
              error: { message: 'no' }
            });
          }
          return commandResult(context.operationId);
        }
      }
    });
    system.register({
      id: 'trg.reject', flowGroupId: 'fg-label', when: { type: 'signal' },
      do: [
        { stepId: 'bad', action: 'action.work', params: { token: 'bad' } },
        { stepId: 'must-not-run', action: 'action.work', params: { token: 'must-not-run' } }
      ]
    });
    expect(system.fire('signal', { operationId: 'op-reject' })).toBe(1);
    await system.waitForIdle();
    expect(calls).toEqual(['bad']);
    expect(system.ledger.get('trg.reject').status).toBe('failed');
    expect(events.some(event => event.type === 'triggerFailed')).toBe(true);
  });

  it('tutorial.command show + params.await 在步骤层等待教程离槽后才推进下一步', async () => {
    const calls = [];
    const hideListeners = [];
    const tutorial = {
      currentTutorial: { id: 'tutorial-a' },
      pendingTutorials: [],
      completedTutorials: new Set(),
      onHide: listener => { hideListeners.push(listener); return () => {}; }
    };
    const system = new TriggerSystem({
      monotonicClock: new MonotonicClock(100),
      actionDescriptorRegistry: descriptorRegistry(['action.work', 'tutorial.command']),
      commandAdapter: {
        async execute(action, context) {
          calls.push(action.params.token || action.action);
          return commandResult(context.operationId);
        }
      }
    });
    system.init({ blackboard: new Blackboard(), tutorial });
    system.register({
      id: 'trg.multi',
      flowGroupId: 'fg-label',
      when: { type: 'signal', params: { channel: 'go' } },
      do: [
        { stepId: 'tut-1', action: 'tutorial.command', params: { operation: 'show', tutorialId: 'tutorial-a', await: true } },
        { stepId: 'after', action: 'action.work', params: { token: 'after' } }
      ]
    });
    expect(system.fire('signal', { channel: 'go', operationId: 'op-await' })).toBe(1);
    await Promise.resolve();
    // show 已执行；教程仍在槽内 → 下一步未推进
    expect(calls).toContain('tutorial.command');
    expect(calls).not.toContain('after');
    // 教程离槽并触发 onHide → 等待解除，下一步推进
    tutorial.currentTutorial = null;
    hideListeners.forEach(listener => listener());
    await system.waitForIdle();
    expect(calls).toEqual(['tutorial.command', 'after']);
    expect(system.ledger.get('trg.multi').status).toBe('succeeded');
  });
});
import { describe, expect, it, vi } from 'vitest';
import { OperationLedger, fingerprintOperation } from './OperationLedger.js';
import { AuthorityClocks } from './AuthorityClocks.js';
import { AuthorityRng } from './AuthorityRng.js';
import { StateRevisionStore } from './StateRevisionStore.js';
import { ProjectionStore } from './ProjectionStore.js';
import { PostCommitNotificationBus } from './PostCommitNotificationBus.js';
import { AuthoritySnapshotService } from './AuthoritySnapshotService.js';
import { GameSceneRuntime } from '../scene/GameSceneRuntime.js';

const result = (operationId, overrides = {}) => ({
  ok: true, operationId, status: 'committed', committed: true, code: null,
  stateId: 'inventory:player', stateRevision: 1, eventFrom: 1, eventTo: 1,
  value: { accepted: 1 }, error: null, ...overrides
});

const draft = (operationId, overrides = {}) => ({
  stateId: 'inventory:player', stateType: 'inventory', stateRevision: 1,
  operationId, type: 'inventory.changed', payload: { accepted: 1 }, ...overrides
});

describe('OperationLedger', () => {
  it('原子 claim，同 fingerprint 等待/重放，不同 fingerprint 冲突并校验 owner token', async () => {
    const ledger = new OperationLedger();
    const owner = ledger.claim('op-1', 'payload-a');
    const waiting = ledger.claim('op-1', 'payload-a');
    expect(owner.status).toBe('claim');
    expect(waiting.status).toBe('in-flight');
    expect(ledger.commit('op-1', 'wrong-token', result('op-1')).ok).toBe(false);
    ledger.commit('op-1', owner.ownerToken, result('op-1'));
    await expect(waiting.wait).resolves.toEqual(result('op-1'));
    expect(ledger.claim('op-1', 'payload-a')).toMatchObject({ status: 'committed', replay: true });
    expect(ledger.claim('op-1', 'payload-b')).toMatchObject({ status: 'conflict' });
    expect(fingerprintOperation({ commandType: 'x', operationId: 'op-1', clientSequence: 1, payload: { b: 2, a: 1 } }))
      .toBe(fingerprintOperation({ commandType: 'x', operationId: 'op-1', clientSequence: 9, payload: { a: 1, b: 2 } }));
  });

  it('按 TTL/容量淘汰终态，并把恢复时未决操作确定化为 failed', () => {
    let now = 0;
    const ledger = new OperationLedger({ capacity: 1, ttlMs: 10, now: () => now });
    const first = ledger.claim('op-1', 'a');
    ledger.commit('op-1', first.ownerToken, result('op-1'));
    now = 20;
    ledger.prune();
    expect(ledger.get('op-1')).toBeNull();

    const pending = ledger.claim('op-2', 'b');
    expect(pending.status).toBe('claim');
    const restored = new OperationLedger();
    restored.restore(ledger.snapshot());
    expect(restored.claim('op-2', 'b')).toMatchObject({ status: 'failed', replay: true });
  });
});

describe('deterministic authority clocks/RNG/revisions', () => {
  it('失败事务不推进 RNG counter，提交后可按 snapshot 重放', () => {
    const rng = new AuthorityRng({ seed: 42 });
    const failed = rng.begin('loot', 'drop');
    const failedValue = failed.next();
    failed.rollback();
    const committed = rng.begin('loot', 'drop');
    expect(committed.next()).toBe(failedValue);
    committed.commit();
    const snapshot = rng.snapshot();
    const next = rng.begin('loot', 'drop');
    const expected = next.int(1, 20);
    next.commit();
    rng.restore(snapshot);
    const replay = rng.begin('loot', 'drop');
    expect(replay.int(1, 20)).toBe(expected);
  });

  it('logical/monotonic/wall 独立，state revision 在 commit 时才递增', () => {
    const clocks = new AuthorityClocks({ logicalTime: 3, monotonicTime: 10, wallTime: 1000 });
    expect(clocks.logical.tick()).toBe(4);
    expect(clocks.monotonic.advance(5)).toBe(15);
    expect(clocks.wall.advance(20)).toBe(1020);
    const revisions = new StateRevisionStore();
    const prepared = revisions.prepare('inventory:player', 0);
    expect(revisions.current('inventory:player')).toBe(0);
    expect(revisions.commit(prepared)).toEqual({ ok: true, stateRevision: 1 });
    expect(revisions.commit(prepared)).toMatchObject({ ok: false, code: 'stateRevisionReservationLost' });
  });
});

describe('post-commit notifications and ProjectionStore', () => {
  it('仅为 committed result 有序发布，并让投影幂等忽略重复通知', async () => {
    const clocks = new AuthorityClocks();
    const store = new ProjectionStore();
    store.registerReducer('inventory', (_value, event) => ({ accepted: event.payload.accepted }));
    const bus = new PostCommitNotificationBus({ logicalClock: clocks.logical, projectionStore: store });
    const published = await bus.publishAfterCommit({ result: result('op-1'), committedEvents: [draft('op-1')] });
    expect(published.events[0]).toMatchObject({ eventId: 'event:1', eventSequence: 1, logicalTime: 1 });
    expect(store.get('inventory', 'inventory:player')).toMatchObject({ stateRevision: 1, projectionRevision: 1, value: { accepted: 1 } });
    expect(store.apply(published.events[0])).toMatchObject({ ok: true, duplicate: true });
    await expect(bus.publishAfterCommit({
      result: result('op-2', { ok: false, status: 'failed', committed: false }),
      committedEvents: [draft('op-2')]
    })).rejects.toThrow('committed');
  });

  it('遇 sequence gap 或 state revision 跳跃即停止增量并请求恢复', () => {
    const recovery = vi.fn();
    const store = new ProjectionStore({ requestRecovery: recovery });
    store.registerReducer('inventory', () => ({}));
    const gap = store.apply({ ...draft('op-2', { stateRevision: 2 }), eventId: 'event:2', eventSequence: 2, logicalTime: 2 });
    expect(gap).toMatchObject({ ok: false, code: 'eventGap' });
    expect(recovery).toHaveBeenCalledWith(expect.objectContaining({ reason: 'eventGap', expected: 1 }));
    expect(store.apply({ ...draft('op-1'), eventId: 'event:1', eventSequence: 1, logicalTime: 1 })).toMatchObject({ code: 'projectionStale' });
  });
});

describe('AuthoritySnapshotService', () => {
  it('保存完整 authority 边界，并以 serviceStates 为事实源原子恢复', () => {
    const clocks = new AuthorityClocks();
    const rng = new AuthorityRng({ seed: 7 });
    const ledger = new OperationLedger();
    const revisions = new StateRevisionStore();
    const bus = new PostCommitNotificationBus({ logicalClock: clocks.logical });
    let firstState = { value: 1 };
    let secondState = { value: 2 };
    const snapshots = new AuthoritySnapshotService({
      definitionRevision: 4,
      stateRevisions: revisions,
      logicalClock: clocks.logical,
      rng,
      operationLedger: ledger,
      notificationBus: bus
    });
    snapshots.registerService('first', {
      snapshot: () => firstState,
      validate: value => ({ ok: Number.isInteger(value?.value), errors: [] }),
      restore: value => { firstState = value; }
    });
    snapshots.registerService('second', {
      snapshot: () => secondState,
      validate: value => ({ ok: Number.isInteger(value?.value), errors: [] }),
      restore: value => { secondState = value; }
    });
    clocks.logical.tick();
    const random = rng.begin(); random.next(); random.commit();
    const owner = ledger.claim('op-1', 'payload'); ledger.commit('op-1', owner.ownerToken, result('op-1'));
    const snapshot = snapshots.capture({ first: { providerVersion: 1 } });
    expect(snapshot).toMatchObject({
      snapshotSchemaVersion: 1,
      definitionRevision: 4,
      lastEventSequence: 0,
      logicalClock: 1,
      serviceStates: { first: { value: 1 }, second: { value: 2 } }
    });

    firstState = { value: 9 };
    secondState = { value: 9 };
    clocks.logical.tick();
    expect(snapshots.restore(snapshot)).toMatchObject({ ok: true });
    expect(firstState).toEqual({ value: 1 });
    expect(secondState).toEqual({ value: 2 });
    expect(clocks.logical.now()).toBe(1);
  });

  it('provider 在失败前部分写入时也包含当前项并严格逆序回滚', () => {
    const trace = [];
    let first = 10;
    let second = 20;
    const clocks = new AuthorityClocks();
    const snapshots = new AuthoritySnapshotService({
      definitionRevision: 1,
      stateRevisions: new StateRevisionStore(),
      logicalClock: clocks.logical,
      rng: new AuthorityRng({ seed: 1 }),
      operationLedger: new OperationLedger(),
      notificationBus: new PostCommitNotificationBus({ logicalClock: clocks.logical })
    });
    snapshots.registerService('first', {
      snapshot: () => first, validate: () => ({ ok: true }),
      restore: value => { first = value; trace.push(`first:${value}`); }
    });
    snapshots.registerService('second', {
      snapshot: () => second, validate: () => ({ ok: true }),
      restore: value => { second = value; trace.push(`second:${value}`); return value === 2 ? { ok: false, errors: [{ code: 'fault', path: '', message: 'fault' }] } : { ok: true }; }
    });
    const target = snapshots.capture();
    target.serviceStates = { first: 1, second: 2 };
    const restored = snapshots.restore(target);
    expect(restored).toMatchObject({
      ok: false,
      rolledBack: [
        'serviceStates.second', 'serviceStates.first', 'lastEventSequence',
        'operationLedger', 'rngState', 'logicalClock', 'stateRevisions'
      ]
    });
    expect({ first, second }).toEqual({ first: 10, second: 20 });
    expect(trace).toEqual(['first:1', 'second:2', 'second:20', 'first:10']);
  });
});

describe('GameSceneRuntime authority dependency injection', () => {
  it('创建唯一 authority 基础设施并注册完整快照 provider', () => {
    const runtime = new GameSceneRuntime({ authoritySeed: 99 });
    expect(runtime.get('$operationLedger')).toBe(runtime.operationLedger);
    expect(runtime.get('$authorityRng')).toBe(runtime.authorityRng);
    expect(runtime.get('$projectionStore')).toBe(runtime.projectionStore);
    expect(runtime.get('$notificationBus')).toBe(runtime.notificationBus);
    expect(runtime.snapshotManager.getKeys()).toContain('authority');
    expect(runtime.captureCheckpoint().snapshot.data.authority).toMatchObject({
      snapshotSchemaVersion: 1,
      definitionRevision: 0,
      logicalClock: 0,
      serviceStates: {}
    });
    runtime.dispose();
  });

  it('借用注入依赖时保持 identity 且不释放调用方投影', () => {
    const projectionStore = new ProjectionStore();
    const runtime = new GameSceneRuntime({ projectionStore });
    expect(runtime.get('$projectionStore')).toBe(projectionStore);
    runtime.dispose();
    expect(projectionStore.stale).toBe(false);
  });
});

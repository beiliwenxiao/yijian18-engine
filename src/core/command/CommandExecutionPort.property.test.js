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
import { RemoteAuthorityAdapter } from './AuthorityPort.js';
import { AuthorityClocks } from './AuthorityClocks.js';
import { AuthorityRng } from './AuthorityRng.js';
import { AuthoritySnapshotService } from './AuthoritySnapshotService.js';
import { CommandContractKind, assertCommandContract, cloneCommandValue } from './CommandContracts.js';
import { CommandGateway } from './CommandGateway.js';
import { LocalAuthorityAdapter } from './LocalAuthorityAdapter.js';
import { OperationLedger } from './OperationLedger.js';
import { PostCommitNotificationBus } from './PostCommitNotificationBus.js';
import { ProjectionStore } from './ProjectionStore.js';
import { StateRevisionStore } from './StateRevisionStore.js';
import { LoopbackFakeTransport, SeedGenerator } from '../../../test/support/ModelTesting.js';

const PROPERTY_SEEDS = Object.freeze([
  0x7c0a1101, 0x7c0a1102, 0x7c0a1103, 0x7c0a1104,
  0x7c0a1105, 0x7c0a1106, 0x7c0a1107, 0x7c0a1108
]);
const DEFINITION_REVISION = 4;
const STATE_ID = 'counter:player-1';

function resultFor(command, stateRevision, value) {
  return {
    ok: true,
    operationId: command.operationId,
    status: 'committed',
    committed: true,
    code: null,
    stateId: STATE_ID,
    stateRevision,
    eventFrom: null,
    eventTo: null,
    value,
    error: null
  };
}

function replaceObject(target, value) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cloneCommandValue(value));
}

function createCounterAuthority({ seed, beforeCommit = null } = {}) {
  const clocks = new AuthorityClocks({ logicalTime: 0, monotonicTime: 10, wallTime: 1000 });
  const ledger = new OperationLedger({ now: () => clocks.monotonic.now() });
  const rng = new AuthorityRng({ seed });
  const revisions = new StateRevisionStore();
  const projection = new ProjectionStore({ definitionRevision: DEFINITION_REVISION });
  projection.registerReducer('counter', (_current, event) => cloneCommandValue(event.payload));
  const bus = new PostCommitNotificationBus({ logicalClock: clocks.logical, projectionStore: projection });
  const notifications = [];
  bus.subscribe(entry => notifications.push(cloneCommandValue(entry)));
  const state = { value: 0, commits: 0 };
  let executions = 0;

  const snapshots = new AuthoritySnapshotService({
    definitionRevision: DEFINITION_REVISION,
    stateRevisions: revisions,
    logicalClock: clocks.logical,
    rng,
    operationLedger: ledger,
    notificationBus: bus
  });
  snapshots.registerService('counter', {
    snapshot: () => state,
    validate: value => ({
      ok: Number.isInteger(value?.value) && Number.isInteger(value?.commits),
      errors: []
    }),
    restore: value => replaceObject(state, value)
  });

  const handler = {
    stateId: STATE_ID,
    async execute(command, context) {
      executions++;
      await beforeCommit?.(command);
      const randomBonus = context.rng.int(0, 7);
      const nextValue = state.value + command.payload.amount + randomBonus;
      const revision = context.commitStateRevision(context.preparedStateRevision);
      if (!revision.ok) throw new Error(revision.code);
      state.value = nextValue;
      state.commits++;
      return {
        result: resultFor(command, revision.stateRevision, { value: nextValue, randomBonus }),
        committedEvents: [{
          stateId: STATE_ID,
          stateType: 'counter',
          stateRevision: revision.stateRevision,
          operationId: command.operationId,
          type: 'counter.changed',
          payload: { value: nextValue, commits: state.commits }
        }],
        applicationEvents: [{
          stateId: STATE_ID,
          stateType: 'counter',
          stateRevision: revision.stateRevision,
          operationId: command.operationId,
          type: 'counter.feedback',
          payload: { randomBonus }
        }]
      };
    }
  };
  const adapter = new LocalAuthorityAdapter({
    handlers: { 'counter.add': handler },
    authorityClocks: clocks,
    operationLedger: ledger,
    authorityRng: rng,
    stateRevisions: revisions,
    projectionStore: projection,
    notificationBus: bus,
    authoritySnapshotService: snapshots
  });
  const repository = { definitionRevision: DEFINITION_REVISION };
  const gateway = new CommandGateway({ authorityPort: adapter, definitionRepository: repository });
  return {
    adapter, gateway, clocks, ledger, rng, revisions, projection, bus,
    notifications, snapshots, state, get executions() { return executions; }
  };
}
class LoopbackRemoteAuthority extends RemoteAuthorityAdapter {
  constructor({ server, requestIds }) {
    super();
    this.server = server;
    this.requestIds = requestIds;
    this.usedRequestIds = [];
    this.notifications = [];
    this.projection = new ProjectionStore({ definitionRevision: DEFINITION_REVISION });
    this.projection.registerReducer('counter', (_current, event) => cloneCommandValue(event.payload));
    this.transportNotifications = [];
    server.bus.subscribe(entry => this.transportNotifications.push(cloneCommandValue(entry)));
    this.transport = new LoopbackFakeTransport(async request => {
      const start = this.transportNotifications.length;
      const commandResult = await server.adapter.execute(request.command);
      return {
        requestId: request.requestId,
        commandResult,
        notifications: this.transportNotifications.slice(start)
      };
    });
  }

  async execute(command) {
    const requestId = this.requestIds[this.usedRequestIds.length];
    this.usedRequestIds.push(requestId);
    const envelope = await this.transport.request({ requestId, command });
    expect(envelope.requestId).toBe(requestId);
    assertCommandContract(CommandContractKind.COMMAND_RESULT, envelope.commandResult);
    for (const entry of envelope.notifications) {
      assertCommandContract(entry.kind, entry.value);
      if (entry.kind === CommandContractKind.COMMITTED_EVENT) this.projection.apply(entry.value);
      else this.projection.observeApplication(entry.value);
      this.notifications.push(cloneCommandValue(entry));
    }
    return Object.freeze(cloneCommandValue(envelope.commandResult));
  }
}

function generatedScenario(seed) {
  const random = new SeedGenerator(seed);
  const authoritySeed = random.nextUint32();
  const count = random.int(3, 7);
  const operations = Array.from({ length: count }, (_, index) => ({
    intentType: 'counter.add',
    actorRef: 'player-1',
    operationId: `operation-${random.string(8)}-${index}`,
    expectedStateRevision: index,
    payload: {
      amount: random.int(1, 12),
      fingerprintTag: random.string(5),
      nested: { enabled: random.bool(), rank: random.int(0, 4) }
    }
  }));
  const requestIds = Array.from({ length: count + 8 }, (_, index) =>
    `request-${random.string(10)}-${index}`);
  return {
    seed,
    authoritySeed,
    operations,
    requestIds,
    cutPoint: random.int(1, count - 1)
  };
}

async function executeAll(gateway, operations) {
  const results = [];
  for (const operation of operations) results.push(await gateway.execute(operation));
  return results;
}

async function withSeed(scenario, assertion) {
  try {
    await assertion();
  } catch (error) {
    error.message = `Property 7 counterexample seed=${scenario.seed} scenario=${JSON.stringify(scenario)}\n${error.message}`;
    throw error;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Property 7: Fix Checking — Operation Replay, State Revision,
// Post-Commit Notification, Projection, and Adapter Parity.
// **Validates: Requirements 2.12, 3.4, 3.7, 3.9, 3.10**
describe('Property 7: Unified command execution port', () => {
  it('生成命令序列在 Local 与 loopback fake Remote 间保持 result/event/projection parity', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = generatedScenario(seed);
      await withSeed(scenario, async () => {
        const local = createCounterAuthority({ seed: scenario.authoritySeed });
        const remoteServer = createCounterAuthority({ seed: scenario.authoritySeed });
        const remote = new LoopbackRemoteAuthority({ server: remoteServer, requestIds: scenario.requestIds });
        const remoteGateway = new CommandGateway({
          authorityPort: remote,
          definitionRepository: { definitionRevision: DEFINITION_REVISION }
        });

        const localResults = await executeAll(local.gateway, scenario.operations);
        const remoteResults = await executeAll(remoteGateway, scenario.operations);
        expect(remoteResults).toEqual(localResults);
        expect(remote.notifications).toEqual(local.notifications);
        expect(remote.projection.snapshot()).toEqual(local.projection.snapshot());
        expect(remoteServer.projection.snapshot()).toEqual(local.projection.snapshot());
        expect(remoteServer.state).toEqual(local.state);
        expect(remoteServer.rng.snapshot()).toEqual(local.rng.snapshot());
        expect(remoteServer.clocks.logical.snapshot()).toBe(local.clocks.logical.snapshot());

        const beforeReplay = {
          state: cloneCommandValue(local.state),
          events: local.notifications.length,
          revision: local.revisions.current(STATE_ID),
          rng: local.rng.snapshot()
        };
        const replayIntent = scenario.operations[0];
        const localReplay = await local.gateway.execute(replayIntent, { clientSequence: 9001 });
        const remoteReplay = await remoteGateway.execute(replayIntent, { clientSequence: 7001 });
        expect(remoteReplay).toEqual(localReplay);
        expect(localReplay).toEqual(localResults[0]);
        expect(local.state).toEqual(beforeReplay.state);
        expect(local.notifications).toHaveLength(beforeReplay.events);
        expect(local.revisions.current(STATE_ID)).toBe(beforeReplay.revision);
        expect(local.rng.snapshot()).toEqual(beforeReplay.rng);

        const conflictIntent = {
          ...replayIntent,
          payload: { ...replayIntent.payload, amount: replayIntent.payload.amount + 1 }
        };
        const localConflict = await local.gateway.execute(conflictIntent);
        const remoteConflict = await remoteGateway.execute(conflictIntent);
        expect(remoteConflict).toEqual(localConflict);
        expect(localConflict).toMatchObject({ ok: false, committed: false, code: 'operationConflict' });
        expect(local.state).toEqual(beforeReplay.state);
        expect(local.notifications).toHaveLength(beforeReplay.events);
        expect(new Set(remote.usedRequestIds).size).toBe(remote.usedRequestIds.length);
        expect(remote.usedRequestIds.every(id => id.startsWith('request-'))).toBe(true);
      });
    }
  });

  it('生成 operationId/fingerprint 的并发 claim 仅执行一次并让等待者重放同一结果', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = generatedScenario(seed);
      await withSeed(scenario, async () => {
        const entered = deferred();
        const release = deferred();
        const authority = createCounterAuthority({
          seed: scenario.authoritySeed,
          beforeCommit: async () => { entered.resolve(); await release.promise; }
        });
        const operation = scenario.operations[0];
        const first = authority.gateway.execute(operation, { clientSequence: 1 });
        await entered.promise;
        const waiting = authority.gateway.execute(operation, { clientSequence: 2 });
        release.resolve();
        const [ownerResult, waitingResult] = await Promise.all([first, waiting]);

        expect(waitingResult).toEqual(ownerResult);
        expect(authority.executions).toBe(1);
        expect(authority.state.commits).toBe(1);
        expect(authority.revisions.current(STATE_ID)).toBe(1);
        expect(authority.notifications).toHaveLength(2);
        expect(authority.ledger.get(operation.operationId)).toMatchObject({ status: 'committed' });
      });
    }
  });

  it('生成 expected state/definition revision 冲突时保持 service state、通知与 RNG 零修改', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = generatedScenario(seed);
      await withSeed(scenario, async () => {
        const authority = createCounterAuthority({ seed: scenario.authoritySeed });
        const operation = scenario.operations[0];
        await expect(authority.gateway.execute(operation, {
          definitionRevision: DEFINITION_REVISION + 1
        })).rejects.toMatchObject({ name: 'CommandContractError' });
        expect(authority.executions).toBe(0);
        expect(authority.ledger.get(operation.operationId)).toBeNull();

        const beforeMismatch = {
          state: cloneCommandValue(authority.state),
          rng: authority.rng.snapshot(),
          revision: authority.revisions.snapshot(),
          notifications: authority.notifications.length
        };
        const mismatch = await authority.gateway.execute({
          ...operation,
          operationId: `${operation.operationId}-state-mismatch`,
          expectedStateRevision: scenario.operations.length + 10
        });
        expect(mismatch).toMatchObject({ ok: false, committed: false, code: 'stateRevisionConflict' });
        expect(authority.executions).toBe(0);
        expect(authority.state).toEqual(beforeMismatch.state);
        expect(authority.rng.snapshot()).toEqual(beforeMismatch.rng);
        expect(authority.revisions.snapshot()).toEqual(beforeMismatch.revision);
        expect(authority.notifications).toHaveLength(beforeMismatch.notifications);

        const committed = await authority.gateway.execute(operation);
        expect(committed).toMatchObject({ ok: true, stateRevision: 1 });
        const afterCommit = {
          state: cloneCommandValue(authority.state),
          rng: authority.rng.snapshot(),
          notifications: authority.notifications.length
        };
        const stale = await authority.gateway.execute({
          ...scenario.operations[1],
          expectedStateRevision: 0
        });
        expect(stale).toMatchObject({ ok: false, committed: false, code: 'stateRevisionConflict' });
        expect(authority.state).toEqual(afterCommit.state);
        expect(authority.rng.snapshot()).toEqual(afterCommit.rng);
        expect(authority.notifications).toHaveLength(afterCommit.notifications);
      });
    }
  });

  it('生成 notification duplicate/gap/out-of-order 时幂等或停止增量并可从 cut point 恢复', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = generatedScenario(seed);
      await withSeed(scenario, async () => {
        const authority = createCounterAuthority({ seed: scenario.authoritySeed });
        await executeAll(authority.gateway, scenario.operations.slice(0, 2));
        const entries = authority.notifications;
        expect(entries).toHaveLength(4);

        const ordered = new ProjectionStore({ definitionRevision: DEFINITION_REVISION });
        ordered.registerReducer('counter', (_current, event) => cloneCommandValue(event.payload));
        for (const entry of entries) {
          const applied = entry.kind === CommandContractKind.COMMITTED_EVENT
            ? ordered.apply(entry.value)
            : ordered.observeApplication(entry.value);
          expect(applied.ok).toBe(true);
          const duplicate = entry.kind === CommandContractKind.COMMITTED_EVENT
            ? ordered.apply(entry.value)
            : ordered.observeApplication(entry.value);
          expect(duplicate).toMatchObject({ ok: true, applied: false, duplicate: true });
        }
        expect(ordered.snapshot()).toEqual(authority.projection.snapshot());

        const gapIndex = 1 + new SeedGenerator(seed).int(0, entries.length - 2);
        const outOfOrder = new ProjectionStore({ definitionRevision: DEFINITION_REVISION });
        outOfOrder.registerReducer('counter', (_current, event) => cloneCommandValue(event.payload));
        const gapEntry = entries[gapIndex];
        const gap = gapEntry.kind === CommandContractKind.COMMITTED_EVENT
          ? outOfOrder.apply(gapEntry.value)
          : outOfOrder.observeApplication(gapEntry.value);
        expect(gap).toMatchObject({ ok: false, applied: false, code: 'eventGap' });
        expect(outOfOrder.stale).toBe(true);
        const firstEntry = entries[0];
        const late = firstEntry.kind === CommandContractKind.COMMITTED_EVENT
          ? outOfOrder.apply(firstEntry.value)
          : outOfOrder.observeApplication(firstEntry.value);
        expect(late).toMatchObject({ ok: false, code: 'projectionStale' });

        outOfOrder.recover(ordered.snapshot());
        expect(outOfOrder.stale).toBe(false);
        expect(outOfOrder.snapshot()).toEqual(ordered.snapshot());
      });
    }
  });

  it('生成 snapshot cut point 后以 service state/clock/RNG/ledger 续跑得到同一结果与投影', async () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = generatedScenario(seed);
      await withSeed(scenario, async () => {
        const original = createCounterAuthority({ seed: scenario.authoritySeed });
        const prefix = scenario.operations.slice(0, scenario.cutPoint);
        const suffix = scenario.operations.slice(scenario.cutPoint);
        const prefixResults = await executeAll(original.gateway, prefix);
        const authoritySnapshot = original.snapshots.capture({ cutPoint: scenario.cutPoint });
        const projectionSnapshot = original.projection.snapshot();
        const prefixNotificationCount = original.notifications.length;
        expect(authoritySnapshot).not.toHaveProperty('notifications');
        expect(authoritySnapshot.serviceStates.counter).toEqual(original.state);

        const restored = createCounterAuthority({ seed: scenario.authoritySeed });
        expect(restored.snapshots.restore(authoritySnapshot)).toMatchObject({ ok: true });
        restored.projection.recover(projectionSnapshot);
        expect(restored.state).toEqual(original.state);
        expect(restored.revisions.snapshot()).toEqual(original.revisions.snapshot());
        expect(restored.clocks.logical.snapshot()).toBe(original.clocks.logical.snapshot());
        expect(restored.rng.snapshot()).toEqual(original.rng.snapshot());

        const replayBeforeContinue = await restored.gateway.execute(prefix[0], { clientSequence: 999 });
        expect(replayBeforeContinue).toEqual(prefixResults[0]);
        expect(restored.notifications).toHaveLength(0);
        const originalContinuation = await executeAll(original.gateway, suffix);
        const restoredContinuation = await executeAll(restored.gateway, suffix);
        expect(restoredContinuation).toEqual(originalContinuation);
        expect(restored.notifications).toEqual(original.notifications.slice(prefixNotificationCount));
        expect(restored.state).toEqual(original.state);
        expect(restored.projection.snapshot()).toEqual(original.projection.snapshot());
        expect(restored.revisions.snapshot()).toEqual(original.revisions.snapshot());
        expect(restored.clocks.logical.snapshot()).toBe(original.clocks.logical.snapshot());
        expect(restored.rng.snapshot()).toEqual(original.rng.snapshot());
        expect(restored.ledger.snapshot()).toEqual(original.ledger.snapshot());
      });
    }
  });
});

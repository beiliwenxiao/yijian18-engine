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
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteAuthorityAdapter } from './AuthorityPort.js';
import { LocalAuthorityAdapter } from './LocalAuthorityAdapter.js';
import { CommandGateway } from './CommandGateway.js';
import { CommandContractKind, assertCommandContract, cloneCommandValue } from './CommandContracts.js';
import { OperationLedger } from './OperationLedger.js';
import { AuthorityClocks } from './AuthorityClocks.js';
import { AuthorityRng } from './AuthorityRng.js';
import { StateRevisionStore } from './StateRevisionStore.js';
import { ProjectionStore } from './ProjectionStore.js';
import { PostCommitNotificationBus } from './PostCommitNotificationBus.js';
import {
  createJsonRpcError,
  createJsonRpcRequest,
  createJsonRpcSuccess,
  JsonRpcErrorCode,
  unwrapJsonRpcResponse,
  validateJsonRpcRequest
} from '../../integration/JsonRpcProtocol.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function commandResult(command, stateRevision, value) {
  return {
    ok: true,
    operationId: command.operationId,
    status: 'committed',
    committed: true,
    code: null,
    stateId: `counter:${command.actorId}`,
    stateRevision,
    eventFrom: null,
    eventTo: null,
    value,
    error: null
  };
}

function createCounterAuthority(seed = 91) {
  const clocks = new AuthorityClocks();
  const ledger = new OperationLedger({ now: () => clocks.monotonic.now() });
  const rng = new AuthorityRng({ seed });
  const revisions = new StateRevisionStore();
  const projection = new ProjectionStore({ definitionRevision: 4 });
  projection.registerReducer('counter', (_current, event) => event.payload.value);
  const bus = new PostCommitNotificationBus({ logicalClock: clocks.logical, projectionStore: projection });
  const notifications = [];
  bus.subscribe(event => notifications.push(cloneCommandValue(event)));
  const states = new Map();
  const handler = {
    stateId: command => `counter:${command.actorId}`,
    execute(command, context) {
      const prepared = context.preparedStateRevision;
      const current = states.get(command.actorId) || 0;
      const randomBonus = context.rng.int(0, 3);
      const next = current + command.payload.amount + randomBonus;
      states.set(command.actorId, next);
      const revisionCommit = context.commitStateRevision(prepared);
      if (!revisionCommit.ok) throw new Error(revisionCommit.code);
      return {
        result: commandResult(command, prepared.next, { value: next, randomBonus }),
        committedEvents: [{
          stateId: prepared.stateId,
          stateType: 'counter',
          stateRevision: prepared.next,
          operationId: command.operationId,
          type: 'counter.changed',
          payload: { value: next }
        }],
        applicationEvents: [{
          stateId: prepared.stateId,
          stateType: 'counter',
          stateRevision: prepared.next,
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
    notificationBus: bus
  });
  const gateway = new CommandGateway({ authorityPort: adapter, operationIdFactory: intent => intent.operationId });
  return { adapter, gateway, clocks, ledger, rng, revisions, projection, bus, notifications, states };
}

class LoopbackJsonRpcTransport {
  constructor(authority) {
    this.authority = authority;
    this.notifications = [];
    this.requestIds = [];
    this.timeoutAfterDispatch = false;
    this.authority.bus.subscribe(event => this.notifications.push(cloneCommandValue(event)));
  }

  async request(request) {
    this.requestIds.push(request.id);
    const malformed = validateJsonRpcRequest(request);
    if (malformed) return malformed;
    if (request.method !== 'authority.execute') {
      return createJsonRpcError(request.id, JsonRpcErrorCode.METHOD_NOT_FOUND, 'unknown method');
    }
    const start = this.notifications.length;
    const result = await this.authority.adapter.execute(request.params.command);
    const envelope = {
      commandResult: result,
      notifications: this.notifications.slice(start)
    };
    if (this.timeoutAfterDispatch) {
      this.timeoutAfterDispatch = false;
      throw new Error('transport timeout; attempt outcome is unknown');
    }
    return createJsonRpcSuccess(request.id, envelope);
  }
}

class LoopbackRemoteAuthorityAdapter extends RemoteAuthorityAdapter {
  constructor({ transport, projectionStore }) {
    super();
    this.transport = transport;
    this.projectionStore = projectionStore;
    this.notifications = [];
    this.sequence = 0;
  }

  async execute(command) {
    const requestId = `authority-attempt:${++this.sequence}`;
    const response = await this.transport.request(createJsonRpcRequest(requestId, 'authority.execute', {
      command: cloneCommandValue(command)
    }));
    const envelope = unwrapJsonRpcResponse(response, requestId);
    assertCommandContract(CommandContractKind.COMMAND_RESULT, envelope.commandResult);
    for (const entry of envelope.notifications) {
      const kind = entry.kind;
      assertCommandContract(kind, entry.value);
      if (kind === CommandContractKind.COMMITTED_EVENT) this.projectionStore.apply(entry.value);
      else this.projectionStore.observeApplication(entry.value);
      this.notifications.push(cloneCommandValue(entry));
    }
    return Object.freeze(cloneCommandValue(envelope.commandResult));
  }
}

function intent(operationId, amount, expectedStateRevision) {
  return {
    intentType: 'counter.add',
    actorRef: 'player-1',
    operationId,
    expectedStateRevision,
    payload: { amount }
  };
}

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(path));
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(path);
  }
  return files;
}

describe('LocalAuthorityAdapter parity and request/operation identity', () => {
  it('Local 与 loopback fake Remote 对相同命令序列产生 canonical parity', async () => {
    const local = createCounterAuthority();
    const remoteServer = createCounterAuthority();
    const remoteProjection = new ProjectionStore({ definitionRevision: 4 });
    remoteProjection.registerReducer('counter', (_current, event) => event.payload.value);
    const transport = new LoopbackJsonRpcTransport(remoteServer);
    const remoteAdapter = new LoopbackRemoteAuthorityAdapter({ transport, projectionStore: remoteProjection });
    const remoteGateway = new CommandGateway({ authorityPort: remoteAdapter });

    const sequence = [intent('operation-1', 2, 0), intent('operation-2', 5, 1)];
    const localResults = [];
    const remoteResults = [];
    for (const entry of sequence) {
      localResults.push(await local.gateway.execute(entry));
      remoteResults.push(await remoteGateway.execute(entry));
    }

    expect(remoteResults).toEqual(localResults);
    expect(remoteAdapter.notifications).toEqual(local.notifications);
    expect(remoteProjection.snapshot()).toEqual(local.projection.snapshot());
    expect(remoteServer.projection.snapshot()).toEqual(local.projection.snapshot());
    expect(remoteServer.states).toEqual(local.states);
    expect(remoteServer.revisions.snapshot()).toEqual(local.revisions.snapshot());
    expect(remoteServer.rng.snapshot()).toEqual(local.rng.snapshot());
  });

  it('新 requestId + 同 operationId 重试只提交一次，clientSequence 不进入业务 fingerprint', async () => {
    const server = createCounterAuthority();
    const transport = new LoopbackJsonRpcTransport(server);
    const clientProjection = new ProjectionStore({ definitionRevision: 4 });
    clientProjection.registerReducer('counter', (_current, event) => event.payload.value);
    const remote = new LoopbackRemoteAuthorityAdapter({ transport, projectionStore: clientProjection });
    const command = {
      commandType: 'counter.add', operationId: 'stable-operation', actorId: 'player-1',
      clientSequence: 1, expectedStateRevision: 0, definitionRevision: 4, payload: { amount: 3 }
    };

    transport.timeoutAfterDispatch = true;
    await expect(remote.execute(command)).rejects.toThrow('outcome is unknown');
    const replay = await remote.execute({ ...command, clientSequence: 2 });

    expect(replay).toMatchObject({ ok: true, operationId: 'stable-operation', stateRevision: 1 });
    expect(transport.requestIds).toEqual(['authority-attempt:1', 'authority-attempt:2']);
    expect(server.revisions.current('counter:player-1')).toBe(1);
    expect(server.notifications).toHaveLength(2);
    expect(server.ledger.get('stable-operation')).toMatchObject({ status: 'committed' });

    const conflict = await remote.execute({ ...command, clientSequence: 3, payload: { amount: 99 } });
    expect(conflict).toMatchObject({ ok: false, code: 'operationConflict', committed: false });
    expect(server.revisions.current('counter:player-1')).toBe(1);
  });
});

describe('legacy NetworkManager static isolation gate', () => {
  it('command/service-state/snapshot 模块不 import 或调用 PLAYER_SYNC/预测 reconcile', () => {
    const protectedRoots = ['src/core/command', 'src/core/snapshot', 'src/systems'];
    const violations = [];
    for (const root of protectedRoots) {
      for (const file of listJavaScriptFiles(join(ROOT, root))) {
        const source = readFileSync(file, 'utf8');
        if (/from\s+['"][^'"]*(?:\/network\/|NetworkManager)/.test(source)
          || /import\s*\([^)]*(?:\/network\/|NetworkManager)/.test(source)
          || /\bPLAYER_SYNC\b|\.reconcileState\s*\(/.test(source)) {
          violations.push(relative(ROOT, file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('legacy NetworkManager/WebSocketClient 不 import command、service state 或 snapshot', () => {
    const legacyFiles = ['src/network/NetworkManager.js', 'src/network/WebSocketClient.js'];
    const violations = legacyFiles.filter(file => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      return /from\s+['"][^'"]*(?:core\/command|core\/snapshot|systems\/)/.test(source)
        || /import\s*\([^)]*(?:core\/command|core\/snapshot|systems\/)/.test(source);
    });
    expect(violations).toEqual([]);
  });
});
import { describe, expect, it, vi } from 'vitest';
import { GameSceneRuntime } from '../scene/GameSceneRuntime.js';
import { DefinitionRepository } from '../DefinitionRepository.js';
import { AuthorityPort, RemoteAuthorityAdapter } from './AuthorityPort.js';
import { CommandGateway } from './CommandGateway.js';
import {
  CommandContractError,
  CommandContractKind,
  validateCommandContract
} from './CommandContracts.js';
import { LocalAuthorityAdapter, fingerprintCommand } from './LocalAuthorityAdapter.js';
import { WebSocketJsonRpcTransport } from '../../integration/WebSocketJsonRpcTransport.js';

function result(operationId, overrides = {}) {
  return {
    ok: true,
    operationId,
    status: 'committed',
    committed: true,
    code: null,
    stateId: 'inventory:player-1',
    stateRevision: 2,
    eventFrom: 4,
    eventTo: 4,
    value: { accepted: 1 },
    error: null,
    ...overrides
  };
}

function event(operationId, overrides = {}) {
  return {
    eventId: 'event-4',
    eventSequence: 4,
    stateId: 'inventory:player-1',
    stateType: 'inventory',
    stateRevision: 2,
    operationId,
    logicalTime: 8,
    type: 'inventory.changed',
    payload: { accepted: 1 },
    ...overrides
  };
}

function intent(overrides = {}) {
  return {
    intentType: 'inventory.pickup',
    actorRef: 'player-1',
    operationId: 'operation-1',
    payload: { quantity: 1 },
    ...overrides
  };
}

describe('Unified Local-First Command Execution Port contracts', () => {
  it('严格区分 definition/state/event/projection/snapshot revision', () => {
    const invalidIntent = validateCommandContract(CommandContractKind.CLIENT_INTENT, {
      ...intent(),
      definitionRevision: 3
    });
    expect(invalidIntent.ok).toBe(false);
    expect(invalidIntent.errors).toContainEqual(expect.objectContaining({ code: 'revisionBoundary' }));

    const projection = validateCommandContract(CommandContractKind.PROJECTION, {
      projectionType: 'inventory',
      projectionId: 'player-1',
      definitionRevision: 3,
      stateRevision: 2,
      projectionRevision: 4,
      lastEventSequence: 4,
      value: { items: [] }
    });
    expect(projection.ok).toBe(true);
  });

  it('CommandGateway 锁定当前定义 revision 并构造标准命令', async () => {
    const execute = vi.fn(command => result(command.operationId));
    const repository = DefinitionRepository.empty(7);
    const gateway = new CommandGateway({ authorityPort: { execute }, definitionRepository: repository });

    const commandResult = await gateway.execute(intent({ expectedStateRevision: 1 }), { sessionId: 'session-1' });

    expect(commandResult.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'inventory.pickup',
      actorId: 'player-1',
      sessionId: 'session-1',
      operationId: 'operation-1',
      definitionRevision: 7,
      expectedStateRevision: 1
    }));
  });

  it('CommandGateway 在 authority 执行前拒绝悬空 definition reference', async () => {
    const execute = vi.fn();
    const gateway = new CommandGateway({
      authorityPort: { execute },
      definitionRepository: DefinitionRepository.empty(2)
    });

    await expect(gateway.execute(intent({
      payload: { definitionRefs: [{ kind: 'items', id: 'missing' }] }
    }))).rejects.toBeInstanceOf(CommandContractError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('LocalAuthorityAdapter 经序列化、fingerprint、handler 与通知校验执行', async () => {
    const published = [];
    const original = intent({ payload: { nested: { quantity: 1 } } });
    let handlerFingerprint = null;
    const adapter = new LocalAuthorityAdapter({
      notificationSink: committed => published.push(committed),
      handlers: {
        'inventory.pickup': {
          stateId: 'inventory:player-1',
          execute(command, context) {
            handlerFingerprint = context.fingerprint;
            command.payload.nested.quantity = 9;
            context.commitStateRevision(context.preparedStateRevision);
            return {
              result: result(command.operationId, { stateRevision: 1 }),
              committedEvents: [event(command.operationId, { stateRevision: 1 })]
            };
          }
        }
      }
    });
    const gateway = new CommandGateway({ authorityPort: adapter, definitionRepository: DefinitionRepository.empty(5) });

    const commandResult = await gateway.execute(original);

    expect(commandResult).toEqual(result('operation-1', { stateRevision: 1, eventFrom: 1, eventTo: 1 }));
    expect(handlerFingerprint).toContain('inventory.pickup');
    expect(published).toEqual([{
      ...event('operation-1', { stateRevision: 1 }),
      eventSequence: 1,
      logicalTime: 1,
      // post-commit 通知契约新增：来源标识与事件定义 ID、actor/scene 归因
      actorRef: null,
      sceneId: null,
      eventDefinitionId: 'inventory.changed',
      source: { kind: 'postCommitNotification', operationId: 'operation-1' }
    }]);
    expect(original.payload.nested.quantity).toBe(1);
  });

  it('相同标准命令不受对象键顺序影响而产生相同 fingerprint', () => {
    const first = { operationId: 'op', payload: { a: 1, b: 2 } };
    const second = { payload: { b: 2, a: 1 }, operationId: 'op' };
    expect(fingerprintCommand(first)).toBe(fingerprintCommand(second));
  });

  it('未知 command 返回标准拒绝结果而不绕过端口', async () => {
    const adapter = new LocalAuthorityAdapter();
    const gateway = new CommandGateway({ authorityPort: adapter });
    const rejected = await gateway.execute(intent({ intentType: 'unknown.command' }));

    expect(rejected).toEqual(expect.objectContaining({
      ok: false,
      committed: false,
      operationId: 'operation-1',
      code: 'unknownCommand'
    }));
  });

  it('无效 handler result 或未提交结果携带 committed event 时拒绝越过边界', async () => {
    const invalidResultAdapter = new LocalAuthorityAdapter({
      handlers: { 'inventory.pickup': () => ({ ok: true }) }
    });
    const gateway = new CommandGateway({ authorityPort: invalidResultAdapter });
    await expect(gateway.execute(intent())).rejects.toBeInstanceOf(CommandContractError);

    const invalidEventAdapter = new LocalAuthorityAdapter({
      handlers: {
        'inventory.pickup': command => ({
          result: result(command.operationId, { ok: false, status: 'rejected', committed: false }),
          committedEvents: [event(command.operationId)]
        })
      }
    });
    const secondGateway = new CommandGateway({ authorityPort: invalidEventAdapter });
    await expect(secondGateway.execute(intent())).rejects.toThrow('post-commit notifications');
  });
});

describe('Authority lifecycle and future-only interfaces', () => {
  it('GameSceneRuntime 使用注入的同一 gateway/authority identity 且 borrowed 不由场景释放', () => {
    const authorityPort = { execute: vi.fn(), dispose: vi.fn() };
    const commandGateway = new CommandGateway({ authorityPort });
    const gatewayDispose = vi.spyOn(commandGateway, 'dispose');
    const runtime = new GameSceneRuntime({ authorityPort, commandGateway });

    expect(runtime.get('$authorityPort')).toBe(authorityPort);
    expect(runtime.get('$commandGateway')).toBe(commandGateway);
    runtime.dispose();

    expect(authorityPort.dispose).not.toHaveBeenCalled();
    expect(gatewayDispose).not.toHaveBeenCalled();
  });

  it('GameSceneRuntime 默认创建并按生命周期释放 LocalAuthorityAdapter 与 CommandGateway', () => {
    const runtime = new GameSceneRuntime();
    const authority = runtime.authorityPort;
    const gateway = runtime.commandGateway;

    expect(authority).toBeInstanceOf(LocalAuthorityAdapter);
    expect(gateway).toBeInstanceOf(CommandGateway);
    runtime.dispose();
    expect(authority.disposed).toBe(true);
    expect(gateway.disposed).toBe(true);
  });

  it('远端 authority 与 WebSocket JSON-RPC 仅保留未接生产连接的接口', async () => {
    await expect(new AuthorityPort().execute({})).rejects.toThrow('must be implemented');
    await expect(new RemoteAuthorityAdapter().execute({})).rejects.toThrow('interface');
    await expect(new WebSocketJsonRpcTransport().request({})).rejects.toThrow('interface');
  });
});

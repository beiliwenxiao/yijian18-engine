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

import { AuthorityPort } from './AuthorityPort.js';
import {
  CommandContractKind,
  assertCommandContract,
  cloneCommandValue
} from './CommandContracts.js';
import { OperationLedger, OperationLedgerState, fingerprintOperation } from './OperationLedger.js';
import { AuthorityClocks } from './AuthorityClocks.js';
import { AuthorityRng } from './AuthorityRng.js';
import { StateRevisionStore } from './StateRevisionStore.js';
import { PostCommitNotificationBus } from './PostCommitNotificationBus.js';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  for (const key of Object.keys(value).sort()) copy[key] = stableValue(value[key]);
  return copy;
}

export function fingerprintCommand(command) {
  return JSON.stringify(stableValue(command));
}

function rejectedResult(operationId, code, error) {
  return {
    ok: false,
    operationId,
    status: 'rejected',
    committed: false,
    code,
    stateId: null,
    stateRevision: null,
    eventFrom: null,
    eventTo: null,
    value: null,
    error
  };
}

function normalizeHandlerOutput(output) {
  if (output && typeof output === 'object' && Object.prototype.hasOwnProperty.call(output, 'result')) {
    return {
      result: output.result,
      committedEvents: output.committedEvents || output.events || [],
      applicationEvents: output.applicationEvents || []
    };
  }
  return { result: output, committedEvents: [], applicationEvents: [] };
}

function publishFunction(sink) {
  if (typeof sink === 'function') return sink;
  if (typeof sink?.publish === 'function') return sink.publish;
  throw new TypeError('notificationSink must be a function or implement publish(event)');
}

/**
 * 单机权威执行端口。所有命令均经过 operation ledger、确定性 authority 上下文、
 * handler contract、提交后通知和结果校验；requestId/clientSequence 不参与业务幂等。
 */
export class LocalAuthorityAdapter extends AuthorityPort {
  constructor(config = {}) {
    super();
    this._handlers = new Map();
    this.authorityClocks = config.authorityClocks || new AuthorityClocks();
    this.operationLedger = config.operationLedger || new OperationLedger({
      now: () => this.authorityClocks.monotonic.now()
    });
    this.authorityRng = config.authorityRng || new AuthorityRng({ seed: config.authoritySeed ?? 0 });
    this.stateRevisions = config.stateRevisions || new StateRevisionStore();
    this.notificationBus = config.notificationBus || new PostCommitNotificationBus({
      logicalClock: this.authorityClocks.logical,
      projectionStore: config.projectionStore
    });
    if (this.notificationBus.logicalClock !== this.authorityClocks.logical) {
      throw new Error('LocalAuthorityAdapter notificationBus must use the injected logical clock');
    }
    this.authoritySnapshotService = config.authoritySnapshotService || null;
    this._ownsOperationLedger = !config.operationLedger;
    this._ownsNotificationBus = !config.notificationBus;
    this._unsubscribeSink = null;
    // 每个 authority state 的 prepare → commit → revision 校验必须串行；
    // handler 内的 await 不能让后续命令在前一命令校验前推进相同 revision。
    this._stateExecutionTails = new Map();
    this.disposed = false;

    if (config.notificationSink) {
      const publish = publishFunction(config.notificationSink);
      this._unsubscribeSink = this.notificationBus.subscribe(event => (
        publish.call(config.notificationSink, event.value)
      ));
    }

    const handlers = config.handlers instanceof Map
      ? config.handlers.entries()
      : Object.entries(config.handlers || {});
    for (const [commandType, handler] of handlers) this.registerHandler(commandType, handler);
  }

  registerHandler(commandType, handler) {
    if (this.disposed) throw new Error('LocalAuthorityAdapter is disposed');
    if (typeof commandType !== 'string' || !commandType.trim()) throw new TypeError('commandType must be a non-empty string');
    const execute = typeof handler === 'function' ? handler : handler?.execute;
    if (typeof execute !== 'function') throw new TypeError(`handler for ${commandType} must implement execute(command, context)`);
    if (this._handlers.has(commandType)) throw new Error(`duplicate command handler: ${commandType}`);
    this._handlers.set(commandType, {
      receiver: handler,
      execute,
      stateId: typeof handler === 'function' ? null : handler.stateId || handler.resolveStateId || null
    });
    return () => this._handlers.delete(commandType);
  }

  _resolveStateId(registration, command) {
    if (typeof registration.stateId === 'function') return registration.stateId.call(registration.receiver, command);
    return registration.stateId || null;
  }

  /**
   * 串行化同一状态的临界提交区，而不包裹提交后事件消费。
   * 后者允许内容桥再提交命令，若持续持锁会造成同 stateId 的异步重入死锁。
   */
  async _acquireStateExecution(stateId) {
    if (!stateId) return () => false;
    const previous = this._stateExecutionTails.get(stateId) || Promise.resolve();
    let releaseCurrent;
    const current = new Promise(resolve => { releaseCurrent = resolve; });
    this._stateExecutionTails.set(stateId, current);
    await previous.catch(() => {});

    let released = false;
    return () => {
      if (released) return false;
      released = true;
      releaseCurrent();
      if (this._stateExecutionTails.get(stateId) === current) {
        this._stateExecutionTails.delete(stateId);
      }
      return true;
    };
  }

  _createContext(command, operationFingerprint, stateId, rngTransaction) {
    const preparedStateRevision = stateId
      ? this.stateRevisions.prepare(stateId, command.expectedStateRevision)
      : null;
    return Object.freeze({
      fingerprint: operationFingerprint,
      operationFingerprint,
      commandFingerprint: fingerprintCommand(command),
      clocks: this.authorityClocks,
      rng: rngTransaction,
      operationLedger: this.operationLedger,
      stateRevisions: this.stateRevisions,
      preparedStateRevision,
      authoritySnapshotService: this.authoritySnapshotService,
      commitStateRevision: prepared => this.stateRevisions.commit(prepared)
    });
  }

  _validateCommittedRevision(result, context, command) {
    const prepared = context.preparedStateRevision;
    const diagnostic = JSON.stringify({
      commandType: command.commandType,
      operationId: command.operationId,
      resultStateId: result.stateId,
      resultStateRevision: result.stateRevision,
      preparedStateId: prepared?.stateId ?? null,
      preparedNextRevision: prepared?.next ?? null,
      actualStateRevision: prepared ? this.stateRevisions.current(prepared.stateId) : null
    });
    if (result.committed && result.stateId && !prepared) {
      throw new Error(`Committed state-changing handler must declare a stable stateId: ${diagnostic}`);
    }
    if (!prepared || !result.committed) return;
    if (result.stateId !== prepared.stateId || result.stateRevision !== prepared.next) {
      throw new Error(`Committed handler result must match the prepared state revision: ${diagnostic}`);
    }
    if (this.stateRevisions.current(prepared.stateId) !== prepared.next) {
      throw new Error(`Committed handler must commit the prepared state revision: ${diagnostic}`);
    }
  }

  _finalizeLedger(claim, result) {
    const terminal = result.committed ? OperationLedgerState.COMMITTED : OperationLedgerState.FAILED;
    const finalized = this.operationLedger.finalize(result.operationId, claim.ownerToken, terminal, result);
    if (!finalized.ok) throw new Error(`Operation ledger finalize failed: ${finalized.code}`);
  }

  async execute(command) {
    if (this.disposed) throw new Error('LocalAuthorityAdapter is disposed');
    const serializedCommand = cloneCommandValue(command);
    assertCommandContract(CommandContractKind.AUTHORITATIVE_COMMAND, serializedCommand);
    const operationFingerprint = fingerprintOperation(serializedCommand);
    const claim = this.operationLedger.claim(serializedCommand.operationId, operationFingerprint);

    if (claim.status === 'conflict') {
      return Object.freeze(rejectedResult(serializedCommand.operationId, claim.code, {
        message: 'operationId already belongs to a different command payload'
      }));
    }
    if (claim.status === OperationLedgerState.IN_FLIGHT) {
      return Object.freeze(cloneCommandValue(await claim.wait));
    }
    if (claim.replay) return Object.freeze(cloneCommandValue(claim.result));

    const registered = this._handlers.get(serializedCommand.commandType);
    if (!registered) {
      const result = rejectedResult(serializedCommand.operationId, 'unknownCommand', {
        message: `No command handler registered for ${serializedCommand.commandType}`
      });
      this._finalizeLedger(claim, result);
      return Object.freeze(result);
    }

    const stateId = this._resolveStateId(registered, serializedCommand);
    if (serializedCommand.expectedStateRevision !== undefined && !stateId) {
      const result = rejectedResult(serializedCommand.operationId, 'stateIdentityRequired', {
        message: `handler for ${serializedCommand.commandType} must declare stateId to enforce expectedStateRevision`
      });
      this._finalizeLedger(claim, result);
      return Object.freeze(result);
    }

    const releaseStateExecution = await this._acquireStateExecution(stateId);
    let stateExecutionReleased = false;
    const rngTransaction = this.authorityRng.begin(serializedCommand.commandType, serializedCommand.operationId);
    const context = this._createContext(serializedCommand, operationFingerprint, stateId, rngTransaction);
    if (context.preparedStateRevision?.ok === false) {
      rngTransaction.rollback();
      const revisionError = {
        stateId,
        current: context.preparedStateRevision.current,
        ...(context.preparedStateRevision.expected === undefined
          ? {}
          : { expected: context.preparedStateRevision.expected })
      };
      const result = rejectedResult(
        serializedCommand.operationId,
        context.preparedStateRevision.code,
        revisionError
      );
      this._finalizeLedger(claim, result);
      releaseStateExecution();
      stateExecutionReleased = true;
      return Object.freeze(result);
    }

    let rawOutput;
    try {
      rawOutput = await registered.execute.call(registered.receiver, serializedCommand, context);
    } catch (error) {
      rawOutput = rejectedResult(serializedCommand.operationId, 'handlerFailed', {
        message: error?.message || String(error)
      });
    }

    try {
      const normalized = normalizeHandlerOutput(rawOutput);
      const postCommit = typeof rawOutput?.postCommit === 'function' ? rawOutput.postCommit : null;
      const result = cloneCommandValue(normalized.result);
      const committedEvents = cloneCommandValue(normalized.committedEvents);
      const applicationEvents = cloneCommandValue(normalized.applicationEvents);
      assertCommandContract(CommandContractKind.COMMAND_RESULT, result);
      if (result.operationId !== serializedCommand.operationId) {
        throw new Error('CommandResult.operationId must match AuthoritativeCommand.operationId');
      }
      if (!result.committed && (committedEvents.length > 0 || applicationEvents.length > 0)) {
        throw new Error('Uncommitted command result cannot publish post-commit notifications');
      }
      this._validateCommittedRevision(result, context, serializedCommand);

      if (result.committed) rngTransaction.commit();
      else rngTransaction.rollback();

      // revision 已完成严格校验；随后事件消费可重入 authority，不能继续占用同一 state 的提交锁。
      releaseStateExecution();
      stateExecutionReleased = true;

      const published = await this.notificationBus.publishAfterCommit({
        result,
        committedEvents,
        applicationEvents
      });
      const finalResult = {
        ...result,
        eventFrom: published.events.length ? published.events[0].eventSequence : null,
        eventTo: published.events.length ? published.events[published.events.length - 1].eventSequence : null
      };
      assertCommandContract(CommandContractKind.COMMAND_RESULT, finalResult);
      this._finalizeLedger(claim, finalResult);

      // 领域事务、authority revision 与幂等账本完成后，才允许 UI/内容侧的可重入收尾。
      try {
        await postCommit?.(finalResult);
      } catch (error) {
        console.warn('LocalAuthorityAdapter post-commit handler failed', error);
      }
      return Object.freeze(cloneCommandValue(finalResult));
    } catch (error) {
      rngTransaction.rollback();
      const failure = rejectedResult(serializedCommand.operationId, 'handlerContractFailed', {
        message: error?.message || String(error)
      });
      this.operationLedger.fail(serializedCommand.operationId, claim.ownerToken, failure);
      throw error;
    } finally {
      this.stateRevisions.release(context.preparedStateRevision);
      if (!stateExecutionReleased) releaseStateExecution();
    }
  }

  captureSnapshot(providerMetadata = {}) {
    if (!this.authoritySnapshotService) throw new Error('AuthoritySnapshotService is not configured');
    return this.authoritySnapshotService.capture(providerMetadata);
  }

  restoreSnapshot(snapshot) {
    if (!this.authoritySnapshotService) throw new Error('AuthoritySnapshotService is not configured');
    return this.authoritySnapshotService.restore(snapshot);
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this._unsubscribeSink?.();
    this._unsubscribeSink = null;
    this._handlers.clear();
    this._stateExecutionTails.clear();
    if (this._ownsOperationLedger) this.operationLedger.clear();
    if (this._ownsNotificationBus) this.notificationBus.dispose();
    return true;
  }
}

export default LocalAuthorityAdapter;

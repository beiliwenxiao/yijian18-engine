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

import {
  CommandContractKind,
  assertCommandContract,
  cloneCommandValue
} from './CommandContracts.js';

const freezeClone = value => Object.freeze(cloneCommandValue(value));

/** 仅接受已提交结果；先准备全局事件序号，Authority 封账后再分派监听器。 */
export class PostCommitNotificationBus {
  constructor(config = {}) {
    if (!config.logicalClock || typeof config.logicalClock.tick !== 'function') throw new TypeError('logicalClock is required');
    this.logicalClock = config.logicalClock;
    this.eventJournal = config.eventJournal || null;
    this.lastEventSequence = Number.isInteger(config.lastEventSequence) ? config.lastEventSequence : 0;
    this.listeners = new Set();
    this._dispatchQueue = [];
    this._dispatching = false;
    this._dispatchScheduled = false;
    this._idleWaiters = new Set();
    this.disposed = false;
    if (config.projectionStore) this.subscribe(event => {
      if (event.kind === CommandContractKind.COMMITTED_EVENT) config.projectionStore.apply(event.value);
      else if (event.kind === CommandContractKind.APPLICATION_EVENT) config.projectionStore.observeApplication(event.value);
    });
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('notification listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _prepare(kind, draft, operationId, logicalTime, eventSequence) {
    const eventDefinitionId = draft.eventDefinitionId || draft.type;
    const source = draft.source || { kind: 'postCommitNotification', operationId };
    const actorRef = draft.actorRef || draft.payload?.actorRef || null;
    const sceneId = draft.sceneId || draft.payload?.sceneId || null;
    const journalEvent = this.eventJournal?.recordCommitted?.({
      eventId: draft.eventId || null,
      eventDefinitionId,
      kind,
      type: draft.type,
      source,
      actorRef,
      sceneId,
      operationId,
      logicalTime,
      payload: draft.payload,
      stateId: draft.stateId,
      stateType: draft.stateType,
      stateRevision: draft.stateRevision,
      eventSequence
    }) || null;
    const value = {
      ...cloneCommandValue(draft),
      eventDefinitionId,
      source: cloneCommandValue(source),
      actorRef,
      sceneId,
      eventId: journalEvent?.eventId || draft.eventId || `event:${eventSequence}`,
      eventSequence,
      operationId,
      logicalTime
    };
    assertCommandContract(kind, value);
    return Object.freeze({ kind, value: freezeClone(value) });
  }

  prepareAfterCommit({ result, committedEvents = [], applicationEvents = [] }) {
    assertCommandContract(CommandContractKind.COMMAND_RESULT, result);
    if (!result.committed) {
      if (committedEvents.length || applicationEvents.length) throw new Error('notifications require a committed CommandResult');
      return Object.freeze({ entries: Object.freeze([]), events: Object.freeze([]) });
    }
    const logicalTime = this.logicalClock.now() + 1;
    let nextSequence = this.lastEventSequence;
    const entries = [];
    for (const draft of committedEvents) {
      entries.push(this._prepare(CommandContractKind.COMMITTED_EVENT, draft, result.operationId, logicalTime, ++nextSequence));
    }
    for (const draft of applicationEvents) {
      entries.push(this._prepare(CommandContractKind.APPLICATION_EVENT, draft, result.operationId, logicalTime, ++nextSequence));
    }
    this.logicalClock.tick();
    this.lastEventSequence = nextSequence;
    return Object.freeze({
      entries: Object.freeze(entries),
      events: Object.freeze(entries.map(entry => entry.value))
    });
  }

  dispatchPrepared(publication) {
    const entries = Array.isArray(publication?.entries) ? [...publication.entries] : [];
    if (entries.length === 0) {
      return Promise.resolve(Object.freeze({ events: Object.freeze([]), degradation: Object.freeze([]) }));
    }
    if (this.disposed) {
      return Promise.resolve(Object.freeze({
        events: Object.freeze(entries.map(entry => entry.value)),
        degradation: Object.freeze(entries.map(entry => Object.freeze({
          eventId: entry.value.eventId,
          code: 'notificationBusDisposed',
          message: 'PostCommitNotificationBus is disposed'
        })))
      }));
    }
    let resolveBatch;
    const promise = new Promise(resolve => { resolveBatch = resolve; });
    this._dispatchQueue.push({ entries, resolve: resolveBatch });
    this._scheduleDrain();
    return promise;
  }

  _scheduleDrain() {
    if (this._dispatchScheduled || this._dispatching || this.disposed) return;
    this._dispatchScheduled = true;
    queueMicrotask(() => {
      this._dispatchScheduled = false;
      void this._drain();
    });
  }

  async _drain() {
    if (this._dispatching || this.disposed) return;
    this._dispatching = true;
    try {
      while (this._dispatchQueue.length > 0 && !this.disposed) {
        const batch = this._dispatchQueue.shift();
        const degradation = [];
        for (const event of batch.entries) {
          for (const listener of [...this.listeners]) {
            try { await listener(event); }
            catch (error) {
              degradation.push(Object.freeze({
                eventId: event.value.eventId,
                code: error?.code || 'notificationConsumerFailed',
                message: error?.message || String(error)
              }));
            }
          }
        }
        batch.resolve(Object.freeze({
          events: Object.freeze(batch.entries.map(entry => entry.value)),
          degradation: Object.freeze(degradation)
        }));
      }
    } finally {
      this._dispatching = false;
      if (this._dispatchQueue.length > 0 && !this.disposed) this._scheduleDrain();
      else this._resolveIdleWaiters();
    }
  }

  isDispatching() {
    return this._dispatching;
  }

  isIdle() {
    return !this._dispatching && !this._dispatchScheduled && this._dispatchQueue.length === 0;
  }

  waitForIdle() {
    if (this.isIdle()) return Promise.resolve(true);
    return new Promise(resolve => this._idleWaiters.add(resolve));
  }

  _resolveIdleWaiters() {
    if (!this.isIdle()) return;
    for (const resolve of this._idleWaiters) resolve(true);
    this._idleWaiters.clear();
  }

  async publishAfterCommit(input) {
    return this.dispatchPrepared(this.prepareAfterCommit(input));
  }

  validateSequence(value) {
    return Number.isInteger(value) && value >= 0;
  }

  restoreSequence(value) {
    if (!this.validateSequence(value)) throw new TypeError('invalid event sequence');
    this.lastEventSequence = value;
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this.listeners.clear();
    const pending = this._dispatchQueue.splice(0);
    for (const batch of pending) {
      batch.resolve(Object.freeze({
        events: Object.freeze(batch.entries.map(entry => entry.value)),
        degradation: Object.freeze(batch.entries.map(entry => Object.freeze({
          eventId: entry.value.eventId,
          code: 'notificationBusDisposed',
          message: 'PostCommitNotificationBus disposed before dispatch'
        })))
      }));
    }
    this._dispatchScheduled = false;
    for (const resolve of this._idleWaiters) resolve(false);
    this._idleWaiters.clear();
    return true;
  }
}

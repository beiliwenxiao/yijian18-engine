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

/** 仅接受已提交结果，并为通知分配唯一全局 sequence。 */
export class PostCommitNotificationBus {
  constructor(config = {}) {
    if (!config.logicalClock || typeof config.logicalClock.tick !== 'function') throw new TypeError('logicalClock is required');
    this.logicalClock = config.logicalClock;
    this.eventJournal = config.eventJournal || null;
    this.lastEventSequence = Number.isInteger(config.lastEventSequence) ? config.lastEventSequence : 0;
    this.listeners = new Set();
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
    const journalEvent = this.eventJournal?.recordCommitted?.({
      eventId: draft.eventId || null,
      type: draft.type,
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
      eventId: journalEvent?.eventId || draft.eventId || `event:${eventSequence}`,
      eventSequence,
      operationId,
      logicalTime
    };
    assertCommandContract(kind, value);
    return freezeClone(value);
  }

  async publishAfterCommit({ result, committedEvents = [], applicationEvents = [] }) {
    assertCommandContract(CommandContractKind.COMMAND_RESULT, result);
    if (!result.committed) {
      if (committedEvents.length || applicationEvents.length) throw new Error('notifications require a committed CommandResult');
      return Object.freeze({ events: Object.freeze([]), degradation: Object.freeze([]) });
    }
    const logicalTime = this.logicalClock.now() + 1;
    let nextSequence = this.lastEventSequence;
    const prepared = [];
    for (const draft of committedEvents) {
      prepared.push({ kind: CommandContractKind.COMMITTED_EVENT, value: this._prepare(CommandContractKind.COMMITTED_EVENT, draft, result.operationId, logicalTime, ++nextSequence) });
    }
    for (const draft of applicationEvents) {
      prepared.push({ kind: CommandContractKind.APPLICATION_EVENT, value: this._prepare(CommandContractKind.APPLICATION_EVENT, draft, result.operationId, logicalTime, ++nextSequence) });
    }
    this.logicalClock.tick();
    this.lastEventSequence = nextSequence;
    const degradation = [];
    for (const event of prepared) {
      for (const listener of [...this.listeners]) {
        try { await listener(Object.freeze(event)); }
        catch (error) {
          degradation.push(Object.freeze({ eventId: event.value.eventId, message: error?.message || String(error) }));
        }
      }
    }
    return Object.freeze({
      events: Object.freeze(prepared.map(entry => entry.value)),
      degradation: Object.freeze(degradation)
    });
  }

  validateSequence(value) {
    return Number.isInteger(value) && value >= 0;
  }

  restoreSequence(value) {
    if (!this.validateSequence(value)) throw new TypeError('invalid event sequence');
    this.lastEventSequence = value;
  }

  dispose() { this.listeners.clear(); }
}

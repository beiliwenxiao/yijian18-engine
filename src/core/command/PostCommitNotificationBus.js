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

  async dispatchPrepared(publication) {
    const entries = Array.isArray(publication?.entries) ? publication.entries : [];
    const degradation = [];
    for (const event of entries) {
      for (const listener of [...this.listeners]) {
        try { await listener(event); }
        catch (error) {
          degradation.push(Object.freeze({ eventId: event.value.eventId, message: error?.message || String(error) }));
        }
      }
    }
    return Object.freeze({
      events: Object.freeze(entries.map(entry => entry.value)),
      degradation: Object.freeze(degradation)
    });
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

  dispose() { this.listeners.clear(); }
}

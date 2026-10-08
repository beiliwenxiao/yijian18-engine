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

import { CommandContractKind, assertCommandContract, cloneCommandValue } from './CommandContracts.js';

const keyOf = (type, id) => `${type}:${id}`;
const freezeClone = value => Object.freeze(cloneCommandValue(value));

/** 提交后通知驱动的只读查询投影；绝不反向写 service state。 */
export class ProjectionStore {
  constructor(config = {}) {
    this.definitionRevision = config.definitionRevision ?? 0;
    this.lastEventSequence = Number.isInteger(config.lastEventSequence) ? config.lastEventSequence : 0;
    this.projections = new Map();
    this.reducers = new Map();
    this.seenEvents = new Map();
    this.stale = false;
    this.recoveryRequest = null;
    this.requestRecovery = typeof config.requestRecovery === 'function' ? config.requestRecovery : null;
  }

  registerReducer(stateType, reducer, config = {}) {
    if (typeof stateType !== 'string' || !stateType || typeof reducer !== 'function') throw new TypeError('stateType and reducer are required');
    this.reducers.set(stateType, { reducer, projectionType: config.projectionType || stateType });
    return () => this.reducers.delete(stateType);
  }

  seed(projection) {
    const value = cloneCommandValue(projection);
    assertCommandContract(CommandContractKind.PROJECTION, value);
    this.projections.set(keyOf(value.projectionType, value.projectionId), freezeClone(value));
    this.lastEventSequence = Math.max(this.lastEventSequence, value.lastEventSequence);
    return this.get(value.projectionType, value.projectionId);
  }

  get(projectionType, projectionId) {
    return this.projections.get(keyOf(projectionType, projectionId)) || null;
  }

  list(projectionType = null) {
    return Object.freeze([...this.projections.values()].filter(item => !projectionType || item.projectionType === projectionType));
  }

  _stop(reason, event, details = {}) {
    this.stale = true;
    this.recoveryRequest = freezeClone({ reason, eventId: event.eventId, eventSequence: event.eventSequence, ...details });
    this.requestRecovery?.(this.recoveryRequest);
    return Object.freeze({ ok: false, applied: false, code: reason, recovery: this.recoveryRequest });
  }

  apply(event) {
    const candidate = cloneCommandValue(event);
    assertCommandContract(CommandContractKind.COMMITTED_EVENT, candidate);
    if (!Number.isInteger(candidate.eventSequence) || candidate.eventSequence <= 0) {
      return this._stop('invalidEventSequence', candidate);
    }
    if (this.stale) return Object.freeze({ ok: false, applied: false, code: 'projectionStale', recovery: this.recoveryRequest });

    const seenId = this.seenEvents.get(candidate.eventSequence);
    if (candidate.eventSequence <= this.lastEventSequence) {
      if (seenId === candidate.eventId) return Object.freeze({ ok: true, applied: false, duplicate: true });
      return this._stop('eventSequenceConflict', candidate, { expectedAfter: this.lastEventSequence });
    }
    if (candidate.eventSequence !== this.lastEventSequence + 1) {
      return this._stop('eventGap', candidate, { expected: this.lastEventSequence + 1 });
    }

    const registration = this.reducers.get(candidate.stateType);
    if (!registration) return this._stop('missingProjectionReducer', candidate, { stateType: candidate.stateType });
    const projectionKey = keyOf(registration.projectionType, candidate.stateId);
    const current = this.projections.get(projectionKey) || {
      projectionType: registration.projectionType,
      projectionId: candidate.stateId,
      definitionRevision: this.definitionRevision,
      stateRevision: 0,
      projectionRevision: 0,
      lastEventSequence: this.lastEventSequence,
      value: null
    };
    if (candidate.stateRevision < current.stateRevision || candidate.stateRevision > current.stateRevision + 1) {
      return this._stop('stateRevisionGap', candidate, { current: current.stateRevision });
    }

    const nextValue = registration.reducer(current.value, freezeClone(candidate), freezeClone(current));
    const next = {
      ...current,
      stateRevision: Math.max(current.stateRevision, candidate.stateRevision),
      projectionRevision: current.projectionRevision + 1,
      lastEventSequence: candidate.eventSequence,
      value: cloneCommandValue(nextValue)
    };
    assertCommandContract(CommandContractKind.PROJECTION, next);
    this.projections.set(projectionKey, freezeClone(next));
    this.lastEventSequence = candidate.eventSequence;
    this.seenEvents.set(candidate.eventSequence, candidate.eventId);
    return Object.freeze({ ok: true, applied: true, projection: this.projections.get(projectionKey) });
  }

  observeApplication(event) {
    const candidate = cloneCommandValue(event);
    assertCommandContract(CommandContractKind.APPLICATION_EVENT, candidate);
    if (!Number.isInteger(candidate.eventSequence) || candidate.eventSequence <= 0) {
      return this._stop('invalidEventSequence', candidate);
    }
    if (this.stale) return Object.freeze({ ok: false, applied: false, code: 'projectionStale', recovery: this.recoveryRequest });

    const seenId = this.seenEvents.get(candidate.eventSequence);
    if (candidate.eventSequence <= this.lastEventSequence) {
      if (seenId === candidate.eventId) return Object.freeze({ ok: true, applied: false, duplicate: true });
      return this._stop('eventSequenceConflict', candidate, { expectedAfter: this.lastEventSequence });
    }
    if (candidate.eventSequence !== this.lastEventSequence + 1) {
      return this._stop('eventGap', candidate, { expected: this.lastEventSequence + 1 });
    }
    this.lastEventSequence = candidate.eventSequence;
    this.seenEvents.set(candidate.eventSequence, candidate.eventId);
    return Object.freeze({ ok: true, applied: false, observed: true });
  }

  snapshot() {
    return Object.freeze({
      definitionRevision: this.definitionRevision,
      lastEventSequence: this.lastEventSequence,
      projections: Object.freeze([...this.projections.values()].map(cloneCommandValue))
    });
  }

  recover(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.projections) || !Number.isInteger(snapshot.lastEventSequence)) {
      throw new TypeError('invalid projection snapshot');
    }
    const next = new Map();
    for (const projection of snapshot.projections) {
      const candidate = cloneCommandValue(projection);
      assertCommandContract(CommandContractKind.PROJECTION, candidate);
      if (candidate.lastEventSequence > snapshot.lastEventSequence) throw new Error('projection sequence exceeds snapshot sequence');
      next.set(keyOf(candidate.projectionType, candidate.projectionId), freezeClone(candidate));
    }
    this.definitionRevision = snapshot.definitionRevision;
    this.lastEventSequence = snapshot.lastEventSequence;
    this.projections = next;
    this.seenEvents.clear();
    this.stale = false;
    this.recoveryRequest = null;
    return this.snapshot();
  }

  clear() {
    this.projections.clear();
    this.seenEvents.clear();
    this.stale = false;
    this.recoveryRequest = null;
    this.lastEventSequence = 0;
  }
}

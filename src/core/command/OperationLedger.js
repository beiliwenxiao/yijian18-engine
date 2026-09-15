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

const TERMINAL_STATES = new Set(['committed', 'failed']);

export const OperationLedgerState = Object.freeze({
  CLAIM: 'claim',
  IN_FLIGHT: 'in-flight',
  COMMITTED: 'committed',
  FAILED: 'failed'
});

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const hasText = value => typeof value === 'string' && value.trim().length > 0;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

/** requestId/clientSequence/expectedStateRevision 不属于业务 operation fingerprint。 */
export function fingerprintOperation(command) {
  const {
    operationId: _operationId,
    clientSequence: _clientSequence,
    requestId: _requestId,
    expectedStateRevision: _expectedStateRevision,
    ...semantic
  } = command || {};
  return JSON.stringify(stableValue(semantic));
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function replay(entry) {
  return Object.freeze({
    status: entry.status,
    replay: true,
    result: clone(entry.result)
  });
}

/** Authority 侧 operationId 幂等状态机；不处理 JSON-RPC requestId。 */
export class OperationLedger {
  constructor(config = {}) {
    this.capacity = Number.isInteger(config.capacity) && config.capacity > 0 ? config.capacity : 2048;
    this.ttlMs = Number.isFinite(config.ttlMs) && config.ttlMs >= 0 ? config.ttlMs : 24 * 60 * 60 * 1000;
    this.now = typeof config.now === 'function' ? config.now : (() => 0);
    this.entries = new Map();
    this._tokenSequence = 0;
  }

  claim(operationId, fingerprint) {
    if (!hasText(operationId) || !hasText(fingerprint)) throw new TypeError('operationId and fingerprint are required');
    this.prune();
    const existing = this.entries.get(operationId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Object.freeze({ status: 'conflict', replay: false, code: 'operationConflict' });
      }
      if (existing.status === OperationLedgerState.IN_FLIGHT) {
        return Object.freeze({ status: OperationLedgerState.IN_FLIGHT, replay: true, wait: existing.deferred.promise });
      }
      return replay(existing);
    }

    const pending = deferred();
    const ownerToken = `operation-owner:${++this._tokenSequence}`;
    const createdAt = this.now();
    this.entries.set(operationId, {
      operationId,
      fingerprint,
      status: OperationLedgerState.IN_FLIGHT,
      ownerToken,
      createdAt,
      updatedAt: createdAt,
      deferred: pending,
      result: undefined
    });
    this._enforceCapacity();
    return Object.freeze({ status: OperationLedgerState.CLAIM, replay: false, ownerToken });
  }

  finalize(operationId, ownerToken, status, result) {
    if (!TERMINAL_STATES.has(status)) throw new TypeError('final status must be committed or failed');
    const entry = this.entries.get(operationId);
    if (!entry || entry.status !== OperationLedgerState.IN_FLIGHT || entry.ownerToken !== ownerToken) {
      return Object.freeze({ ok: false, code: 'operationOwnerMismatch' });
    }
    entry.status = status;
    entry.result = clone(result);
    entry.updatedAt = this.now();
    entry.ownerToken = null;
    entry.deferred.resolve(clone(entry.result));
    entry.deferred = null;
    this._enforceCapacity();
    return Object.freeze({ ok: true, status, result: clone(entry.result) });
  }

  commit(operationId, ownerToken, result) {
    return this.finalize(operationId, ownerToken, OperationLedgerState.COMMITTED, result);
  }

  fail(operationId, ownerToken, result) {
    return this.finalize(operationId, ownerToken, OperationLedgerState.FAILED, result);
  }

  get(operationId) {
    const entry = this.entries.get(operationId);
    return entry ? Object.freeze({ operationId, fingerprint: entry.fingerprint, status: entry.status, result: clone(entry.result) }) : null;
  }

  prune(now = this.now()) {
    if (this.ttlMs === 0) return 0;
    let removed = 0;
    for (const [operationId, entry] of this.entries) {
      if (TERMINAL_STATES.has(entry.status) && now - entry.updatedAt >= this.ttlMs) {
        this.entries.delete(operationId);
        removed++;
      }
    }
    return removed;
  }

  _enforceCapacity() {
    if (this.entries.size <= this.capacity) return;
    const terminal = [...this.entries.values()]
      .filter(entry => TERMINAL_STATES.has(entry.status))
      .sort((left, right) => left.updatedAt - right.updatedAt || left.createdAt - right.createdAt);
    while (this.entries.size > this.capacity && terminal.length) this.entries.delete(terminal.shift().operationId);
  }

  snapshot() {
    return {
      version: 1,
      entries: [...this.entries.values()].map(entry => ({
        operationId: entry.operationId,
        fingerprint: entry.fingerprint,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...(TERMINAL_STATES.has(entry.status) ? { result: clone(entry.result) } : {})
      }))
    };
  }

  validateSnapshot(snapshot) {
    const valid = snapshot?.version === 1 && Array.isArray(snapshot.entries)
      && snapshot.entries.every(entry => hasText(entry.operationId) && hasText(entry.fingerprint)
        && [OperationLedgerState.IN_FLIGHT, OperationLedgerState.COMMITTED, OperationLedgerState.FAILED].includes(entry.status)
        && Number.isFinite(entry.createdAt) && Number.isFinite(entry.updatedAt));
    return { ok: valid, errors: valid ? [] : [{ code: 'invalidOperationLedger', path: '', message: 'operation ledger snapshot 非法' }] };
  }

  restore(snapshot) {
    const validation = this.validateSnapshot(snapshot);
    if (!validation.ok) throw new TypeError(validation.errors[0].message);
    const entries = new Map();
    for (const saved of snapshot.entries) {
      const interrupted = saved.status === OperationLedgerState.IN_FLIGHT;
      entries.set(saved.operationId, {
        ...clone(saved),
        status: interrupted ? OperationLedgerState.FAILED : saved.status,
        result: interrupted ? {
          ok: false,
          operationId: saved.operationId,
          status: 'failed',
          committed: false,
          code: 'operationInterrupted',
          stateId: null,
          stateRevision: null,
          eventFrom: null,
          eventTo: null,
          value: null,
          error: { message: 'operation was in-flight when the authority snapshot was captured' }
        } : clone(saved.result),
        ownerToken: null,
        deferred: null
      });
    }
    this.entries = entries;
    this._enforceCapacity();
    return this;
  }

  clear() { this.entries.clear(); }
}

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

import { cloneCommandValue } from './CommandContracts.js';

export const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 1;
const hasObject = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => cloneCommandValue(value);

function normalizeErrors(result, path) {
  if (!result || result.ok !== false) return [];
  const errors = Array.isArray(result.errors) && result.errors.length
    ? result.errors
    : [{ code: 'invalidSection', path: '', message: '快照段校验失败' }];
  return errors.map(error => ({ ...error, path: `${path}.${error.path || ''}`.replace(/\.$/, '') }));
}

/** AuthoritySnapshot 聚合器；通知日志不参与业务状态恢复。 */
export class AuthoritySnapshotService {
  constructor(config = {}) {
    this.getDefinitionRevision = typeof config.getDefinitionRevision === 'function'
      ? config.getDefinitionRevision
      : () => config.definitionRevision ?? 0;
    this.stateRevisions = config.stateRevisions;
    this.logicalClock = config.logicalClock;
    this.rng = config.rng;
    this.operationLedger = config.operationLedger;
    this.notificationBus = config.notificationBus;
    this.eventJournal = config.eventJournal || null;
    this.providers = new Map();
  }

  registerService(key, provider) {
    if (!key || !provider || typeof provider.snapshot !== 'function' || typeof provider.restore !== 'function') {
      throw new TypeError('authority service provider requires key/snapshot/restore');
    }
    this.providers.set(key, { ...provider, required: provider.required !== false });
    return () => this.providers.delete(key);
  }

  capture(providerMetadata = {}) {
    const liveRunningEvents = this.eventJournal?.snapshot?.().events?.filter(event => event?.status === 'running') || [];
    if (liveRunningEvents.length > 0) {
      const error = new Error('AuthoritySnapshot 拒绝捕获仍在执行的 EventJournal 事件');
      error.code = 'authorityEventJournalBusy';
      error.eventIds = liveRunningEvents.map(event => event.eventId);
      throw error;
    }
    if (this.notificationBus?.isIdle?.() === false) {
      const error = new Error('AuthoritySnapshot 拒绝捕获尚未完成分派的 committed event');
      error.code = 'authorityNotificationDispatchBusy';
      throw error;
    }
    const unrelatedInFlight = this.operationLedger.getInFlightIds?.() || [];
    if (unrelatedInFlight.length > 0) {
      const error = new Error('AuthoritySnapshot 拒绝捕获其他仍在执行的 operation');
      error.code = 'authoritySnapshotBusy';
      error.operationIds = unrelatedInFlight;
      throw error;
    }
    const operationLedger = this.operationLedger.snapshot(providerMetadata);
    const committedOperations = Object.fromEntries((operationLedger.entries || [])
      .filter(entry => entry.status === 'committed' && entry.result)
      .map(entry => [entry.operationId, entry.result]));
    const snapshotMetadata = { ...providerMetadata, committedOperations };
    const serviceStates = {};
    for (const [key, provider] of this.providers) serviceStates[key] = clone(provider.snapshot(snapshotMetadata));
    return {
      snapshotSchemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      definitionRevision: this.getDefinitionRevision(),
      stateRevisions: clone(this.stateRevisions.snapshot()),
      lastEventSequence: this.notificationBus.lastEventSequence,
      logicalClock: this.logicalClock.snapshot(),
      rngState: clone(this.rng.snapshot()),
      operationLedger: clone(operationLedger),
      serviceStates,
      providerMetadata: clone(providerMetadata)
    };
  }

  validate(snapshot) {
    const errors = [];
    if (!hasObject(snapshot)) return { ok: false, errors: [{ code: 'missingAuthoritySnapshot', path: '', message: 'AuthoritySnapshot 为空' }] };
    if (snapshot.snapshotSchemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION) errors.push({ code: 'snapshotVersionMismatch', path: 'snapshotSchemaVersion', message: 'AuthoritySnapshot 版本不兼容' });
    if (snapshot.definitionRevision !== this.getDefinitionRevision()) errors.push({ code: 'definitionRevisionConflict', path: 'definitionRevision', message: 'definition revision 不匹配' });
    errors.push(...normalizeErrors(this.stateRevisions.validate(snapshot.stateRevisions), 'stateRevisions'));
    if (!this.notificationBus.validateSequence(snapshot.lastEventSequence)) errors.push({ code: 'invalidEventSequence', path: 'lastEventSequence', message: 'event sequence 非法' });
    if (!this.logicalClock.validate(snapshot.logicalClock)) errors.push({ code: 'invalidLogicalClock', path: 'logicalClock', message: 'logical clock 非法' });
    errors.push(...normalizeErrors(this.rng.validateSnapshot(snapshot.rngState), 'rngState'));
    errors.push(...normalizeErrors(this.operationLedger.validateSnapshot(snapshot.operationLedger), 'operationLedger'));
    if (!hasObject(snapshot.serviceStates)) errors.push({ code: 'missingServiceStates', path: 'serviceStates', message: '缺少 service states' });
    if (!hasObject(snapshot.providerMetadata)) errors.push({ code: 'invalidProviderMetadata', path: 'providerMetadata', message: 'provider metadata 必须为对象' });
    for (const [key, provider] of this.providers) {
      const value = snapshot.serviceStates?.[key];
      if (value === undefined && provider.required) errors.push({ code: 'missingField', path: `serviceStates.${key}`, message: '缺少必填 service state' });
      else if (value !== undefined && typeof provider.validate === 'function') {
        try { errors.push(...normalizeErrors(provider.validate(value), `serviceStates.${key}`)); }
        catch (error) { errors.push({ code: 'validateFailed', path: `serviceStates.${key}`, message: error?.message || String(error) }); }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  restore(snapshot) {
    const validation = this.validate(snapshot);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    const before = this.capture();
    const restored = [];
    const participants = [
      ['stateRevisions', value => this.stateRevisions.restore(value)],
      ['logicalClock', value => this.logicalClock.restore(value)],
      ['rngState', value => this.rng.restore(value)],
      ['operationLedger', value => this.operationLedger.restore(value)],
      ['lastEventSequence', value => this.notificationBus.restoreSequence(value)],
      ...[...this.providers].map(([key, provider]) => [`serviceStates.${key}`, value => provider.restore(value)])
    ];
    const valueAt = (source, path) => path.split('.').reduce((value, key) => value?.[key], source);

    for (const [path, apply] of participants) {
      const value = valueAt(snapshot, path);
      if (value === undefined) continue;
      let failure = null;
      try {
        const result = apply(clone(value));
        if (result?.ok === false) failure = normalizeErrors(result, path);
      } catch (error) {
        failure = [{ code: 'restoreFailed', path, message: error?.message || String(error) }];
      }
      if (failure) {
        const rollbackPaths = [...restored, path].reverse();
        for (const rollbackPath of rollbackPaths) {
          const participant = participants.find(([candidate]) => candidate === rollbackPath);
          try { participant?.[1](clone(valueAt(before, rollbackPath))); } catch { /* 保留原始恢复错误 */ }
        }
        return { ok: false, errors: failure, rolledBack: rollbackPaths };
      }
      restored.push(path);
    }
    return { ok: true, errors: [], restored };
  }

  asSnapshotProvider() {
    return {
      snapshot: () => this.capture(),
      validate: snapshot => this.validate(snapshot),
      restore: snapshot => this.restore(snapshot),
      required: true
    };
  }
}

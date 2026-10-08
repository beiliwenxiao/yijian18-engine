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

import { ContentErrorCategory, ContentPhase, normalizeContentError } from '../validation/ContentOperationResult.js';
import { CanonicalSceneValidator } from './CanonicalSceneValidation.js';

const FALLBACK_MODES = new Set(['runtime', 'thumbnail']);
const FALLBACK_CATEGORIES = new Set([
  ContentErrorCategory.UNREADABLE,
  ContentErrorCategory.PARSE_FAILED
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function diskFailure(read, fallbackSource) {
  const source = read?.source || fallbackSource;
  const category = read?.category || ContentErrorCategory.UNREADABLE;
  const phase = category === ContentErrorCategory.PARSE_FAILED ? ContentPhase.PARSE : ContentPhase.READ;
  return normalizeContentError({
    code: category,
    path: '',
    message: read?.error?.message || `${source} ${category}`
  }, { phase, source, category });
}

function normalizeRead(read, source) {
  if (read && typeof read === 'object' && Object.prototype.hasOwnProperty.call(read, 'ok')) return read;
  return { ok: true, source, content: read, revision: null };
}

export class CanonicalSceneRepositorySnapshot {
  #ids;
  #records;

  constructor({ revision, diskRevision, refreshedAt, project, sceneOrder, ids, listProvenance, generation, allowFallback }) {
    this.revision = revision;
    this.diskRevision = diskRevision;
    this.refreshedAt = refreshedAt;
    this.project = deepFreeze(clone(project));
    this.sceneOrder = deepFreeze(clone(sceneOrder));
    this.ids = Object.freeze(ids.slice());
    this.listProvenance = deepFreeze(clone(listProvenance));
    this.generation = generation;
    this.allowFallback = allowFallback;
    this.#ids = new Set(this.ids);
    this.#records = new Map();
    Object.freeze(this);
  }

  /** has 表示 ID 属于当前磁盘 closure，不代表正文已经读取。 */
  has(sceneId) { return this.#ids.has(sceneId); }
  hasRecord(sceneId) { return this.#records.has(sceneId); }
  getScene(sceneId) { return this.#records.get(sceneId)?.data || null; }
  getRecord(sceneId) { return this.#records.get(sceneId) || null; }
  /** 丢弃单个场景的已读记录；下次 loadScene 将重新读盘（编辑器热同步用）。 */
  forget(sceneId) {
    if (this.#records.has(sceneId)) {
      this.#records.delete(sceneId);
      return true;
    }
    return false;
  }
  getProvenance(sceneId) {
    const record = this.#records.get(sceneId);
    if (!record) return null;
    const { data, ...provenance } = record;
    return provenance;
  }

  _storeRecord(record) {
    if (!record?.sceneId || !this.#ids.has(record.sceneId)) return false;
    this.#records.set(record.sceneId, deepFreeze(record));
    return true;
  }
}

/** 磁盘列表决定 ID closure；场景正文只在九宫格请求对应 sceneId 时读取。 */
export class CanonicalSceneRepository {
  constructor({ diskAdapter, cacheAdapter = null, validator = null, mode = 'runtime', now = () => Date.now() } = {}) {
    if (!diskAdapter) throw new TypeError('CanonicalSceneRepository requires diskAdapter');
    this.diskAdapter = diskAdapter;
    this.cacheAdapter = cacheAdapter;
    this.validator = validator || new CanonicalSceneValidator();
    this.mode = mode;
    this.now = now;
    this._snapshot = null;
    this._revision = 0;
    this._generation = 0;
    this._sceneLoads = new WeakMap();
    this._sceneGenerations = new WeakMap();
  }

  get snapshot() { return this._snapshot; }

  /** 丢弃单个场景的缓存记录，并使同 snapshot 下的在途读取失效。 */
  forgetScene(sceneId) {
    if (!sceneId) return false;
    const snapshot = this._snapshot;
    const dropped = snapshot?.forget?.(sceneId) === true;
    const loads = snapshot ? this._sceneLoads.get(snapshot) : null;
    const hadPendingLoad = loads?.delete?.(sceneId) === true;
    if (snapshot) {
      let generations = this._sceneGenerations.get(snapshot);
      if (!generations) {
        generations = new Map();
        this._sceneGenerations.set(snapshot, generations);
      }
      generations.set(sceneId, (generations.get(sceneId) || 0) + 1);
    }
    return dropped || hadPendingLoad;
  }

  async refresh({ mode = this.mode } = {}) {
    const generation = ++this._generation;
    const refreshedAt = this.now();
    const allowFallback = FALLBACK_MODES.has(mode);
    const projectRead = normalizeRead(await this.diskAdapter.readProject(), '<project>');
    const projectResult = this._validateRead(projectRead, 'validateProject');
    if (!projectResult.ok) return this._failed(projectResult.errors);
    const project = projectResult.value;

    const orderRead = normalizeRead(await this.diskAdapter.readSceneOrder(), '<scene-order>');
    const orderResult = this._validateRead(orderRead, 'validateSceneOrder', { project });
    let sceneOrder;
    let ids;
    let listProvenance;
    if (orderResult.ok) {
      sceneOrder = orderResult.value;
      ids = this._orderedIds(sceneOrder);
      listProvenance = {
        source: orderRead.source, fallback: false, reason: null, diskRevision: orderRead.revision || null
      };
    } else if (allowFallback && this._snapshot && this._canFallback(orderResult.category)) {
      sceneOrder = this._snapshot.sceneOrder;
      ids = this._snapshot.ids.slice();
      listProvenance = {
        source: this._snapshot.listProvenance.source,
        fallback: true,
        reason: orderResult.category,
        diskRevision: this._snapshot.listProvenance.diskRevision
      };
    } else {
      return this._failed(orderResult.errors);
    }
    const closureErrors = this._validateClosure(project, ids, orderRead.source || '<scene-order>');
    if (closureErrors.length > 0) return this._failed(closureErrors);
    if (generation !== this._generation) {
      return this._failed([normalizeContentError({
        code: 'refreshSuperseded', path: '', message: '场景仓库 refresh 已被更新 generation 取代'
      }, { phase: ContentPhase.READ, source: '<repository>', category: 'superseded' })]);
    }

    const diskRevision = [
      projectRead.revision || 'project-unversioned',
      listProvenance.diskRevision || 'list-unversioned'
    ].join('|');
    const snapshot = new CanonicalSceneRepositorySnapshot({
      revision: ++this._revision,
      diskRevision,
      refreshedAt,
      project,
      sceneOrder,
      ids,
      listProvenance,
      generation,
      allowFallback
    });
    this._snapshot = snapshot;
    this._sceneLoads.set(snapshot, new Map());
    this._sceneGenerations.set(snapshot, new Map());
    const cacheErrors = this._synchronizeCache(ids, new Map());
    return {
      ok: true,
      snapshot,
      errors: [],
      warnings: [],
      cacheErrors,
      degraded: cacheErrors.length > 0
    };
  }

  async loadScene(sceneId, { snapshot = this._snapshot, signal = null } = {}) {
    this._throwIfAborted(signal, sceneId);
    if (!snapshot || !snapshot.has(sceneId)) {
      return this._sceneFailure('sceneOutsideSnapshotClosure', `场景不在当前 repository snapshot: ${sceneId}`, sceneId);
    }
    if (snapshot !== this._snapshot) {
      return this._sceneFailure('sceneSnapshotSuperseded', `场景仓库 snapshot 已被更新 generation 取代: ${sceneId}`, sceneId, 'superseded');
    }
    const existing = snapshot.getRecord(sceneId);
    if (existing) return { ok: true, record: existing, warnings: [], cacheErrors: [] };

    const loads = this._sceneLoads.get(snapshot) || new Map();
    if (!this._sceneLoads.has(snapshot)) this._sceneLoads.set(snapshot, loads);
    let generations = this._sceneGenerations.get(snapshot);
    if (!generations) {
      generations = new Map();
      this._sceneGenerations.set(snapshot, generations);
    }
    if (!loads.has(sceneId)) {
      const sceneGeneration = generations.get(sceneId) || 0;
      const promise = (async () => {
        const stagedCache = new Map();
        const outcome = await this._loadScene({
          sceneId,
          project: snapshot.project,
          refreshedAt: snapshot.refreshedAt,
          allowFallback: snapshot.allowFallback,
          stagedCache,
          signal
        });
        this._throwIfAborted(signal, sceneId);
        if (!outcome.ok) return { ...outcome, cacheErrors: [] };
        if (snapshot !== this._snapshot) {
          return this._sceneFailure('sceneSnapshotSuperseded', `场景 ${sceneId} 完成读取前 snapshot 已被替换`, sceneId, 'superseded');
        }
        if ((generations.get(sceneId) || 0) !== sceneGeneration) {
          return this._sceneFailure('sceneLoadSuperseded', `场景 ${sceneId} 完成读取前缓存 generation 已失效`, sceneId, 'superseded');
        }
        snapshot._storeRecord(outcome.record);
        const cacheErrors = this._synchronizeCache(snapshot.ids, stagedCache);
        return { ...outcome, cacheErrors };
      })();
      loads.set(sceneId, promise);
      promise.then(
        result => { if (!result?.ok && loads.get(sceneId) === promise) loads.delete(sceneId); },
        () => { if (loads.get(sceneId) === promise) loads.delete(sceneId); }
      );
    }
    return loads.get(sceneId);
  }

  _validateRead(read, method, context = {}) {
    if (!read.ok) {
      const error = diskFailure(read, read.source);
      return { ok: false, value: null, errors: [error], category: error.category };
    }
    const result = this.validator[method](read.content, { source: read.source, ...context });
    return { ...result, category: result.category || result.errors?.[0]?.category || null };
  }

  _orderedIds(sceneOrder) {
    const listed = Object.keys(sceneOrder.scenes || {});
    const listedSet = new Set(listed);
    return [
      ...(sceneOrder.order || []).filter(sceneId => listedSet.has(sceneId)),
      ...listed.filter(sceneId => !(sceneOrder.order || []).includes(sceneId))
    ];
  }

  _validateClosure(project, ids, source) {
    const projectIds = new Set((project.scenes || []).map(scene => scene?.id).filter(Boolean));
    return ids.filter(sceneId => !projectIds.has(sceneId)).map(sceneId => normalizeContentError({
      code: 'sceneOutsideProjectClosure',
      path: `scenes.${sceneId}`,
      message: `磁盘场景列表 ID 未在项目元数据登记: ${sceneId}`
    }, { phase: ContentPhase.REFERENCE, source, category: ContentErrorCategory.REFERENCE_FAILED }));
  }

  async _loadScene({ sceneId, project, refreshedAt, allowFallback, stagedCache, signal = null }) {
    const read = normalizeRead(
      await this.diskAdapter.readScene(sceneId, { signal }),
      `<scene:${sceneId}>`
    );
    this._throwIfAborted(signal, sceneId);
    const result = this._validateRead(read, 'validateScene', { sceneId, project });
    if (result.ok) {
      const data = deepFreeze(clone(result.value));
      const schemaVersion = data.schemaVersion ?? project.schemaVersion;
      const entry = {
        sceneId,
        source: read.source,
        canonicalData: data,
        diskRevision: read.revision || null,
        schemaVersion,
        validatorFingerprint: this.validator.fingerprint,
        refreshedAt,
        eligible: true
      };
      stagedCache.set(sceneId, entry);
      return {
        ok: true,
        record: deepFreeze({
          sceneId, data, source: read.source, canonicalSource: read.source,
          fallback: false, reason: null, diskRevision: read.revision || null,
          schemaVersion, validatorFingerprint: this.validator.fingerprint, refreshedAt
        }),
        warnings: []
      };
    }
    if (!allowFallback || !this._canFallback(result.category) || !this.cacheAdapter) {
      return { ok: false, errors: result.errors, warnings: [] };
    }
    const cacheEntry = this.cacheAdapter.get(sceneId);
    const expectedSchemaVersion = project.schemaVersion;
    const sameSource = cacheEntry?.sceneId === sceneId && cacheEntry?.source === read.source;
    const eligible = cacheEntry?.eligible === true
      && cacheEntry?.validatorFingerprint === this.validator.fingerprint
      && cacheEntry?.schemaVersion === expectedSchemaVersion;
    if (!sameSource || !eligible) return { ok: false, errors: result.errors, warnings: [] };

    const cachedResult = this.validator.validateScene(cacheEntry.canonicalData, {
      source: cacheEntry.source,
      sceneId,
      project
    });
    if (!cachedResult.ok) return { ok: false, errors: result.errors, warnings: [] };
    const data = deepFreeze(clone(cachedResult.value));
    const warning = normalizeContentError({
      code: 'canonicalSceneCacheFallback',
      path: '',
      message: `场景 ${sceneId} 因 ${result.category} 使用最近成功磁盘缓存`
    }, {
      phase: result.phase,
      source: cacheEntry.source,
      category: result.category,
      fallback: true
    });
    return {
      ok: true,
      record: deepFreeze({
        sceneId,
        data,
        source: 'cache',
        canonicalSource: cacheEntry.source,
        fallback: true,
        reason: result.category,
        diskRevision: cacheEntry.diskRevision,
        schemaVersion: cacheEntry.schemaVersion,
        validatorFingerprint: cacheEntry.validatorFingerprint,
        refreshedAt: cacheEntry.refreshedAt
      }),
      warnings: [warning]
    };
  }

  _throwIfAborted(signal, sceneId) {
    if (!signal?.aborted) return;
    const error = new Error(`场景 ${sceneId} 加载已取消`);
    error.name = 'AbortError';
    throw error;
  }

  _sceneFailure(code, message, sceneId, category = ContentErrorCategory.REFERENCE_FAILED) {
    const error = normalizeContentError({ code, path: `scenes.${sceneId}`, message }, {
      phase: ContentPhase.READ,
      source: '<repository>',
      category
    });
    return { ok: false, errors: [error], warnings: [], cacheErrors: [] };
  }

  _canFallback(category) { return FALLBACK_CATEGORIES.has(category); }

  _synchronizeCache(ids, stagedCache) {
    if (!this.cacheAdapter) return [];
    const errors = [];
    const closure = new Set(ids);
    try {
      for (const cachedId of this.cacheAdapter.keys()) {
        if (!closure.has(cachedId)) this.cacheAdapter.delete(cachedId);
      }
    } catch (error) {
      errors.push({ code: 'cachePruneFailed', message: error.message });
    }
    for (const [sceneId, entry] of stagedCache) {
      try {
        this.cacheAdapter.set(sceneId, entry);
      } catch (error) {
        try { this.cacheAdapter.markIneligible?.(sceneId, 'refresh-write-failed'); } catch (ignored) { /* best effort */ }
        errors.push({ code: 'cacheWriteFailed', sceneId, message: error.message });
      }
    }
    return errors;
  }

  _failed(errors) {
    const normalized = (errors || []).map(error => error?.phase
      ? error
      : normalizeContentError(error, {
        phase: ContentPhase.READ,
        source: '<repository>',
        category: ContentErrorCategory.UNREADABLE
      }));
    return {
      ok: false,
      snapshot: this._snapshot,
      errors: normalized,
      warnings: [],
      cacheErrors: [],
      degraded: false,
      category: normalized[0]?.category || null
    };
  }
}

export default CanonicalSceneRepository;

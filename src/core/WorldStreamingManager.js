/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { ProjectWorldIndex } from './ProjectWorldIndex.js';
import { LoadedChunk } from './LoadedChunk.js';

const STREAMING_SCHEMA_VERSION = 1;
const CANONICAL_CHUNK_ID = /^S\d{2}(?:-C\d{2})?$/;

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function streamingError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isPromise(value) {
  return !!value && typeof value.then === 'function';
}

function createExplicitRegionIndex(options) {
  if (!Array.isArray(options.grid)) return null;
  return ProjectWorldIndex.fromRegion({
    id: options.regionId || 'default',
    chunkWidth: options.chunkWidth,
    chunkHeight: options.chunkHeight,
    cols: options.cols,
    rows: options.rows,
    grid: options.grid
  });
}

/**
 * Region 内唯一九宫格流式状态权威。
 * 所有世界参数只通过 ProjectWorldIndex API 读取。
 */
export class WorldStreamingManager {
  constructor(options = {}) {
    this.worldIndex = options.worldIndex || createExplicitRegionIndex(options);
    this.region = this.worldIndex?.getRegion(options.regionRef ?? options.regionId ?? 0) || null;
    this.regionId = this.region?.id || options.regionId || 'unconfigured';
    this.chunkWidth = this.region?.chunkWidth;
    this.chunkHeight = this.region?.chunkHeight;
    this.cols = this.region?.cols;
    this.rows = this.region?.rows;

    this.loaded = new Map();
    this.savedStates = new Map();
    this.onChunkLoad = options.onChunkLoad || null;
    this.onChunkUnload = options.onChunkUnload || null;
    this.sceneResolver = options.sceneResolver || null;
    this.placementAdapter = options.placementAdapter || null;
    this._stateProviders = new Map();
    this._currentCol = -1;
    this._currentRow = -1;
    this._generation = 0;
    this._pendingUpdate = null;
    this._pendingTarget = null;
    this._abortController = null;
    this._needsRefresh = true;
  }

  configureRegion(worldIndex, options = {}) {
    const regionRef = options.regionRef ?? worldIndex?.getEntry?.()?.regionId ?? 0;
    const region = worldIndex?.getRegion?.(regionRef) || null;
    if (!region || typeof worldIndex?.getCell !== 'function' || typeof worldIndex?.getOffset !== 'function' ||
        typeof worldIndex?.isLoadable !== 'function') {
      return { ok: false, errors: [{ code: 'invalidWorldIndex', path: 'worldIndex', message: '需要有效的 ProjectWorldIndex 与 Region' }] };
    }
    this._cancelPending();
    this.unloadAll({ preserveState: false });
    this.worldIndex = worldIndex;
    this.region = region;
    this.regionId = region.id;
    this.chunkWidth = region.chunkWidth;
    this.chunkHeight = region.chunkHeight;
    this.cols = region.cols;
    this.rows = region.rows;
    if (Object.prototype.hasOwnProperty.call(options, 'onChunkLoad')) this.onChunkLoad = options.onChunkLoad;
    if (Object.prototype.hasOwnProperty.call(options, 'onChunkUnload')) this.onChunkUnload = options.onChunkUnload;
    if (Object.prototype.hasOwnProperty.call(options, 'sceneResolver')) this.sceneResolver = options.sceneResolver;
    if (Object.prototype.hasOwnProperty.call(options, 'placementAdapter')) this.placementAdapter = options.placementAdapter;
    this.savedStates.clear();
    this._needsRefresh = true;
    return { ok: true, errors: [] };
  }

  initFromRegion(worldIndex, options = {}) {
    return this.configureRegion(worldIndex, options);
  }

  registerStateProvider(id, provider) {
    if (!id || !provider || typeof provider.capture !== 'function') {
      throw new TypeError('WorldStreamingManager state provider requires id and capture');
    }
    if (provider.commitRestore && typeof provider.rollbackRestore !== 'function') {
      throw new TypeError(`WorldStreamingManager provider ${id} requires rollbackRestore`);
    }
    this._stateProviders.set(id, provider);
    return () => {
      if (this._stateProviders.get(id) !== provider) return false;
      return this._stateProviders.delete(id);
    };
  }

  worldToChunk(worldX, worldY) {
    if (!Number.isFinite(this.chunkWidth) || !Number.isFinite(this.chunkHeight)) {
      throw streamingError('worldIndexNotConfigured', 'WorldStreamingManager 尚未配置 ProjectWorldIndex');
    }
    return {
      col: Math.floor(Number(worldX) / this.chunkWidth),
      row: Math.floor(Number(worldY) / this.chunkHeight)
    };
  }

  chunkOrigin(col, row) {
    const offset = this.worldIndex?.getOffset?.(this.regionId, row, col);
    if (!offset) throw streamingError('invalidChunkCoordinate', `Chunk 坐标无效: ${col},${row}`);
    return offset;
  }

  getSceneId(col, row) {
    const cell = this.worldIndex?.getCell?.(this.regionId, row, col);
    return cell?.loadable === true ? cell.sceneId : null;
  }

  getSceneNamespace(sceneId) {
    if (!CANONICAL_CHUNK_ID.test(sceneId || '')) return null;
    return sceneId.replace(/-C\d{2}$/, '');
  }

  _getNeededChunks(centerCol, centerRow) {
    const needed = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const col = centerCol + dc;
        const row = centerRow + dr;
        const sceneId = this.getSceneId(col, row);
        if (sceneId) needed.push({ col, row, sceneId });
      }
    }
    return needed;
  }

  /**
   * 返回当前中心九宫格中已实际提交的 physical chunk coverage。
   * 这是从 current center 的 loadable specs 与 loaded 交集派生的只读表现快照；
   * 不暴露 loaded Map，也不写入流式状态、业务状态或存档。
   */
  getActiveNineGridCoverage() {
    const empty = Object.freeze({
      regionId: this.regionId || null,
      rects: Object.freeze([]),
      envelope: null
    });
    if (!Number.isInteger(this._currentCol) || !Number.isInteger(this._currentRow)
      || this._currentCol < 0 || this._currentRow < 0
      || !Number.isFinite(this.chunkWidth) || this.chunkWidth <= 0
      || !Number.isFinite(this.chunkHeight) || this.chunkHeight <= 0) return empty;

    const rects = [];
    let envelope = null;
    for (const spec of this._getNeededChunks(this._currentCol, this._currentRow)) {
      const key = this._chunkKey(spec.col, spec.row);
      const chunk = this.loaded.get(key);
      if (!chunk
        || chunk.key !== key
        || chunk.regionId !== this.regionId
        || Number(chunk.col) !== spec.col
        || Number(chunk.row) !== spec.row
        || chunk.sceneId !== spec.sceneId) continue;
      const left = Number(chunk.origin?.x);
      const top = Number(chunk.origin?.y);
      if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
      const right = left + this.chunkWidth;
      const bottom = top + this.chunkHeight;
      const rect = Object.freeze({
        key,
        sceneId: spec.sceneId,
        sceneNamespace: chunk.sceneNamespace || this.getSceneNamespace(spec.sceneId),
        col: spec.col,
        row: spec.row,
        left,
        top,
        right,
        bottom
      });
      rects.push(rect);
      if (!envelope) {
        envelope = { left, top, right, bottom };
      } else {
        envelope.left = Math.min(envelope.left, left);
        envelope.top = Math.min(envelope.top, top);
        envelope.right = Math.max(envelope.right, right);
        envelope.bottom = Math.max(envelope.bottom, bottom);
      }
    }
    return Object.freeze({
      regionId: this.regionId,
      rects: Object.freeze(rects),
      envelope: envelope ? Object.freeze(envelope) : null
    });
  }

  _manhattan(col, row, centerCol, centerRow) {
    return Math.abs(col - centerCol) + Math.abs(row - centerRow);
  }

  _chunkKey(col, row) {
    return `${this.regionId}:${col},${row}`;
  }

  async update(playerWorldX, playerWorldY, options = {}) {
    const { col, row } = this.worldToChunk(playerWorldX, playerWorldY);
    if (!this._needsRefresh && col === this._currentCol && row === this._currentRow) {
      return { ok: true, unchanged: true, loaded: [], unloaded: [] };
    }
    if (this._pendingUpdate && this._pendingTarget?.col === col && this._pendingTarget?.row === row) {
      return this._pendingUpdate;
    }

    this._cancelPending();
    const generation = ++this._generation;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    this._abortController = controller;
    this._pendingTarget = { col, row };
    const externalSignal = options.signal || null;
    const promise = this._runTransition({ col, row, generation, signal: controller?.signal, externalSignal })
      .finally(() => {
        if (this._generation === generation) {
          this._pendingUpdate = null;
          this._pendingTarget = null;
          this._abortController = null;
        }
      });
    this._pendingUpdate = promise;
    return promise;
  }

  async _runTransition(request) {
    try {
      const prepared = await this.prepareTransition(request);
      const validation = this.validatePrepared(prepared);
      if (!validation.ok) {
        await this._releasePrepared(prepared);
        return validation;
      }
      if (request.generation !== this._generation || request.signal?.aborted || request.externalSignal?.aborted) {
        await this._releasePrepared(prepared);
        return { ok: false, superseded: true, errors: [] };
      }
      return await this.commitPrepared(prepared);
    } catch (error) {
      if (request.generation !== this._generation || request.signal?.aborted || request.externalSignal?.aborted) {
        return { ok: false, superseded: true, errors: [] };
      }
      return {
        ok: false,
        errors: [{ code: error.code || 'streamingPrepareFailed', path: '', message: error.message || String(error) }]
      };
    }
  }

  async prepareTransition({ col, row, generation = this._generation, signal = null, externalSignal = null } = {}) {
    if (!Number.isInteger(col) || !Number.isInteger(row)) throw streamingError('invalidCenter', '流式中心坐标无效');
    if (signal?.aborted || externalSignal?.aborted) throw streamingError('aborted', '流式加载已取消');
    const needed = this._getNeededChunks(col, row);
    const loadSpecs = needed.filter(spec => !this.loaded.has(this._chunkKey(spec.col, spec.row)));
    const outcomes = await Promise.allSettled(loadSpecs.map(spec => this._prepareChunk(spec, { signal, generation })));
    const loads = outcomes.filter(outcome => outcome.status === 'fulfilled').map(outcome => outcome.value);
    const failed = outcomes.find(outcome => outcome.status === 'rejected');
    if (failed) {
      await this._releasePrepared({ loads });
      throw failed.reason;
    }
    const unloads = [];
    try {
      for (const [key, chunk] of this.loaded) {
        const chunkCol = Number(chunk?.col);
        const chunkRow = Number(chunk?.row);
        if (this._manhattan(chunkCol, chunkRow, col, row) <= 2) continue;
        unloads.push({ key, chunk, state: await this._captureChunkState(chunk, { async: true }) });
      }
    } catch (error) {
      await this._releasePrepared({ loads });
      throw error;
    }
    return {
      schemaVersion: STREAMING_SCHEMA_VERSION,
      regionId: this.regionId,
      generation,
      center: { col, row },
      loads,
      unloads
    };
  }

  async _prepareChunk(spec, { signal, generation } = {}) {
    if (signal?.aborted || generation !== this._generation) throw streamingError('aborted', '流式加载已取消');
    const key = this._chunkKey(spec.col, spec.row);
    const sceneNamespace = this.getSceneNamespace(spec.sceneId);
    if (!sceneNamespace) throw streamingError('invalidChunkId', `非法 chunk ID: ${spec.sceneId}`);
    const savedState = this.savedStates.get(key) || null;
    const origin = this.chunkOrigin(spec.col, spec.row);
    const sceneData = typeof this.sceneResolver === 'function'
      ? await this.sceneResolver(spec.sceneId, { ...spec, key, origin, signal })
      : null;
    if (signal?.aborted || generation !== this._generation) throw streamingError('aborted', '流式加载已取消');

    let chunk = null;
    if (typeof this.onChunkLoad === 'function') {
      chunk = await this.onChunkLoad(
        spec.col,
        spec.row,
        spec.sceneId,
        origin,
        cloneValue(savedState?.chunkState ?? null),
        { key, regionId: this.regionId, sceneNamespace, sceneData, savedState, signal }
      );
    }
    if (!chunk) {
      chunk = new LoadedChunk({
        key,
        regionId: this.regionId,
        chunkId: spec.sceneId,
        sceneId: spec.sceneId,
        sceneNamespace,
        col: spec.col,
        row: spec.row,
        origin,
        sceneData,
        savedState: savedState?.chunkState || null,
        placementAdapter: this.placementAdapter
      });
    }
    if (chunk.col == null) chunk.col = spec.col;
    if (chunk.row == null) chunk.row = spec.row;
    if (!chunk.sceneId) chunk.sceneId = spec.sceneId;
    if (!chunk.chunkId) chunk.chunkId = spec.sceneId;
    if (!chunk.sceneNamespace) chunk.sceneNamespace = sceneNamespace;
    if (!chunk.regionId) chunk.regionId = this.regionId;
    if (!chunk.key) chunk.key = key;
    if (!chunk.origin) chunk.origin = origin;

    const chunkDraft = typeof chunk.prepare === 'function'
      ? await chunk.prepare({ signal, savedState: savedState?.chunkState || null })
      : null;
    const chunkCheck = typeof chunk.validatePrepared === 'function'
      ? chunk.validatePrepared(chunkDraft)
      : { ok: true, errors: [] };
    if (chunkCheck?.ok === false) {
      throw streamingError('chunkValidationFailed', `Chunk ${spec.sceneId} 准备结果无效`, { errors: chunkCheck.errors || [] });
    }

    const providerRestores = [];
    for (const [id, provider] of this._stateProviders) {
      if (!savedState?.providers || !Object.prototype.hasOwnProperty.call(savedState.providers, id)) continue;
      const data = cloneValue(savedState.providers[id]);
      const context = this._providerContext(chunk, key);
      if (typeof provider.validate === 'function') {
        const check = await provider.validate(data, context);
        if (check?.ok === false) {
          throw streamingError('providerValidationFailed', `动态状态 ${id} 校验失败`, { errors: check.errors || [] });
        }
      }
      const prepared = typeof provider.prepareRestore === 'function'
        ? await provider.prepareRestore(data, context)
        : { draft: data, rollback: null };
      if (prepared?.ok === false) {
        throw streamingError('providerPrepareFailed', `动态状态 ${id} 准备失败`, { errors: prepared.errors || [] });
      }
      providerRestores.push({
        id,
        provider,
        context,
        draft: prepared?.draft ?? prepared,
        rollback: prepared?.rollback ?? null
      });
    }
    return { key, spec, chunk, chunkDraft, providerRestores };
  }

  validatePrepared(prepared) {
    const errors = [];
    if (!prepared || prepared.schemaVersion !== STREAMING_SCHEMA_VERSION) {
      errors.push({ code: 'invalidPreparedTransition', path: '', message: '流式切换草稿版本无效' });
      return { ok: false, errors };
    }
    if (prepared.regionId !== this.regionId) {
      errors.push({ code: 'regionMismatch', path: 'regionId', message: '流式切换草稿不属于当前 Region' });
    }
    const keys = new Set();
    for (const entry of prepared.loads || []) {
      const expectedKey = this._chunkKey(entry.spec?.col, entry.spec?.row);
      if (!entry.chunk || entry.key !== expectedKey || keys.has(entry.key)) {
        errors.push({ code: 'invalidPreparedChunk', path: `loads.${entry?.key || '?'}`, message: '待加载 chunk 身份无效或重复' });
        continue;
      }
      keys.add(entry.key);
      if (entry.chunk.sceneId !== entry.spec.sceneId || entry.chunk.sceneNamespace !== this.getSceneNamespace(entry.spec.sceneId)) {
        errors.push({ code: 'chunkIdentityMismatch', path: `loads.${entry.key}`, message: '待加载 chunk 的 scene namespace 不一致' });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  async commitPrepared(prepared) {
    if (prepared.generation !== this._generation) {
      await this._releasePrepared(prepared);
      return { ok: false, superseded: true, errors: [] };
    }
    const committedChunks = [];
    const committedProviders = [];
    try {
      for (const entry of prepared.loads) {
        const result = typeof entry.chunk.commit === 'function'
          ? await entry.chunk.commit(entry.chunkDraft)
          : { ok: true };
        committedChunks.push({ entry, result });
        if (result?.ok === false) throw streamingError('chunkCommitFailed', `Chunk ${entry.spec.sceneId} 提交失败`);
      }
      for (const entry of prepared.loads) {
        for (const restore of entry.providerRestores) {
          if (typeof restore.provider.commitRestore !== 'function') continue;
          const result = await restore.provider.commitRestore(restore.draft, restore.context);
          committedProviders.push({ restore, result });
          if (result?.ok === false) throw streamingError('providerCommitFailed', `动态状态 ${restore.id} 提交失败`);
        }
      }
      if (prepared.generation !== this._generation) throw streamingError('superseded', '流式切换已被更新请求替代');
    } catch (error) {
      const committedChunkKeys = new Set(committedChunks.map(item => item.entry.key));
      for (const item of committedProviders.reverse()) {
        try {
          await item.restore.provider.rollbackRestore(
            item.restore.rollback ?? item.result?.rollback ?? null,
            item.restore.context
          );
        } catch (rollbackError) {
          console.warn('WorldStreamingManager: provider 回滚失败', item.restore.id, rollbackError);
        }
      }
      for (const item of committedChunks.reverse()) {
        try {
          if (typeof item.entry.chunk.rollbackPrepared === 'function') {
            await item.entry.chunk.rollbackPrepared(item.result, item.entry.chunkDraft);
          } else {
            await item.entry.chunk.release?.();
          }
        } catch (rollbackError) {
          console.warn('WorldStreamingManager: chunk 回滚失败', item.entry.key, rollbackError);
        }
      }
      await this._releasePrepared({
        loads: prepared.loads.filter(entry => !committedChunkKeys.has(entry.key))
      });
      return {
        ok: false,
        superseded: error.code === 'superseded',
        errors: error.code === 'superseded' ? [] : [{ code: error.code || 'streamingCommitFailed', path: '', message: error.message }]
      };
    }

    const nextLoaded = new Map(this.loaded);
    const nextSavedStates = new Map(this.savedStates);
    for (const entry of prepared.unloads) {
      nextLoaded.delete(entry.key);
      nextSavedStates.set(entry.key, entry.state);
    }
    for (const entry of prepared.loads) {
      nextLoaded.set(entry.key, entry.chunk);
      nextSavedStates.delete(entry.key);
    }
    this.loaded = nextLoaded;
    this.savedStates = nextSavedStates;
    this._currentCol = prepared.center.col;
    this._currentRow = prepared.center.row;
    this._needsRefresh = false;

    for (const entry of prepared.unloads) {
      try {
        await this.onChunkUnload?.(entry.chunk.col, entry.chunk.row, entry.chunk);
        if (typeof entry.chunk.release === 'function') await entry.chunk.release();
        else entry.chunk.destroy?.();
      } catch (error) {
        console.warn('WorldStreamingManager: chunk 提交后释放失败', entry.key, error);
      }
    }
    return {
      ok: true,
      errors: [],
      loaded: prepared.loads.map(entry => entry.key),
      unloaded: prepared.unloads.map(entry => entry.key),
      transactionId: prepared.generation
    };
  }

  async _releasePrepared(prepared) {
    for (const entry of prepared?.loads || []) {
      for (const restore of entry.providerRestores || []) {
        try {
          await restore.provider.discardRestore?.(restore.draft, restore.context);
        } catch (error) {
          console.warn('WorldStreamingManager: 丢弃 provider 草稿失败', restore.id, error);
        }
      }
      try {
        if (typeof entry.chunk.discardPrepared === 'function') await entry.chunk.discardPrepared(entry.chunkDraft);
      } catch (error) {
        console.warn('WorldStreamingManager: 丢弃过期 chunk 草稿失败', entry.key, error);
      }
    }
  }

  _providerContext(chunk, key = chunk?.key) {
    return {
      manager: this,
      chunk,
      key,
      regionId: this.regionId,
      chunkId: chunk?.chunkId || chunk?.sceneId,
      sceneId: chunk?.sceneId,
      sceneNamespace: chunk?.sceneNamespace || this.getSceneNamespace(chunk?.sceneId),
      col: chunk?.col,
      row: chunk?.row
    };
  }

  async _captureChunkState(chunk, { async = false } = {}) {
    const key = chunk.key || this._chunkKey(chunk.col, chunk.row);
    let chunkState = typeof chunk.serialize === 'function' ? chunk.serialize() : chunk.state ?? null;
    if (isPromise(chunkState)) {
      if (!async) throw streamingError('asyncSnapshotUnsupported', `Chunk ${key} 不能在同步快照中异步序列化`);
      chunkState = await chunkState;
    }
    const providers = {};
    for (const [id, provider] of this._stateProviders) {
      let value = provider.capture(this._providerContext(chunk, key));
      if (isPromise(value)) {
        if (!async) throw streamingError('asyncSnapshotUnsupported', `Provider ${id} 不能在同步快照中异步采集`);
        value = await value;
      }
      if (value !== undefined) providers[id] = cloneValue(value);
    }
    return {
      schemaVersion: STREAMING_SCHEMA_VERSION,
      regionId: this.regionId,
      chunkId: chunk.chunkId || chunk.sceneId,
      sceneId: chunk.sceneId,
      sceneNamespace: chunk.sceneNamespace || this.getSceneNamespace(chunk.sceneId),
      col: chunk.col,
      row: chunk.row,
      chunkState: cloneValue(chunkState),
      providers
    };
  }

  getLoadedChunks() {
    return this.loaded;
  }

  getVisibleEntities(bounds = null) {
    const entities = [];
    for (const chunk of this.loaded.values()) {
      if (bounds && !this._chunkIntersects(chunk, bounds)) continue;
      for (const entity of chunk.entities || []) entities.push(entity);
    }
    return entities;
  }

  getChunkAt(worldX, worldY) {
    const { col, row } = this.worldToChunk(worldX, worldY);
    return this.loaded.get(this._chunkKey(col, row)) || null;
  }

  _chunkIntersects(chunk, bounds) {
    const left = Number(chunk.origin?.x) || 0;
    const top = Number(chunk.origin?.y) || 0;
    return !(left + this.chunkWidth < bounds.left || left > bounds.right ||
      top + this.chunkHeight < bounds.top || top > bounds.bottom);
  }

  unloadAll({ preserveState = true } = {}) {
    this._cancelPending();
    this._generation++;
    const captured = new Map();
    if (preserveState) {
      for (const [key, chunk] of this.loaded) captured.set(key, this._captureChunkStateSync(chunk));
    }
    for (const [key, chunk] of this.loaded) {
      if (preserveState) this.savedStates.set(key, captured.get(key));
      try { this.onChunkUnload?.(chunk.col, chunk.row, chunk); } catch (error) {
        console.warn('WorldStreamingManager: unload callback 失败', key, error);
      }
      try {
        const result = typeof chunk.release === 'function' ? chunk.release() : chunk.destroy?.();
        if (isPromise(result)) result.catch(error => console.warn('WorldStreamingManager: 异步释放失败', key, error));
      } catch (error) {
        console.warn('WorldStreamingManager: chunk 释放失败', key, error);
      }
    }
    this.loaded.clear();
    this._currentCol = -1;
    this._currentRow = -1;
    this._needsRefresh = true;
  }

  _captureChunkStateSync(chunk) {
    let result;
    let failure;
    try {
      const key = chunk.key || this._chunkKey(chunk.col, chunk.row);
      const chunkState = typeof chunk.serialize === 'function' ? chunk.serialize() : chunk.state ?? null;
      if (isPromise(chunkState)) throw streamingError('asyncSnapshotUnsupported', `Chunk ${key} 不能异步序列化`);
      const providers = {};
      for (const [id, provider] of this._stateProviders) {
        const value = provider.capture(this._providerContext(chunk, key));
        if (isPromise(value)) throw streamingError('asyncSnapshotUnsupported', `Provider ${id} 不能异步采集`);
        if (value !== undefined) providers[id] = cloneValue(value);
      }
      result = {
        schemaVersion: STREAMING_SCHEMA_VERSION,
        regionId: this.regionId,
        chunkId: chunk.chunkId || chunk.sceneId,
        sceneId: chunk.sceneId,
        sceneNamespace: chunk.sceneNamespace || this.getSceneNamespace(chunk.sceneId),
        col: chunk.col,
        row: chunk.row,
        chunkState: cloneValue(chunkState),
        providers
      };
    } catch (error) {
      failure = error;
    }
    if (failure) throw failure;
    return result;
  }

  serialize() {
    const chunks = new Map(this.savedStates);
    for (const [key, chunk] of this.loaded) chunks.set(key, this._captureChunkStateSync(chunk));
    return {
      schemaVersion: STREAMING_SCHEMA_VERSION,
      regionId: this.regionId,
      current: { col: this._currentCol, row: this._currentRow },
      chunks: [...chunks.values()].map(cloneValue)
    };
  }

  validateSerialized(data) {
    const errors = [];
    if (!data || data.schemaVersion !== STREAMING_SCHEMA_VERSION) {
      return { ok: false, errors: [{ code: 'streamingVersionMismatch', path: 'schemaVersion', message: '流式存档版本不兼容' }] };
    }
    if (data.regionId !== this.regionId) {
      errors.push({ code: 'regionMismatch', path: 'regionId', message: '流式存档不属于当前 Region' });
    }
    if (!data.current || !Number.isInteger(data.current.col) || !Number.isInteger(data.current.row)) {
      errors.push({ code: 'invalidCurrentChunk', path: 'current', message: '当前 chunk 坐标无效' });
    } else if (!this.getSceneId(data.current.col, data.current.row)) {
      errors.push({ code: 'missingCurrentChunk', path: 'current', message: '当前 chunk 在目标 Region 中不存在' });
    }
    if (!Array.isArray(data.chunks)) {
      errors.push({ code: 'invalidChunks', path: 'chunks', message: '缺少 chunk 状态数组' });
      return { ok: false, errors };
    }
    const keys = new Set();
    for (let index = 0; index < data.chunks.length; index++) {
      const entry = data.chunks[index];
      const path = `chunks[${index}]`;
      if (!entry || entry.schemaVersion !== STREAMING_SCHEMA_VERSION || entry.regionId !== this.regionId) {
        errors.push({ code: 'invalidChunkState', path, message: 'chunk 状态身份或版本无效' });
        continue;
      }
      const expectedSceneId = this.getSceneId(entry.col, entry.row);
      const key = this._chunkKey(entry.col, entry.row);
      if (!Number.isInteger(entry.col) || !Number.isInteger(entry.row) || !expectedSceneId ||
          entry.sceneId !== expectedSceneId || entry.chunkId !== expectedSceneId ||
          entry.sceneNamespace !== this.getSceneNamespace(expectedSceneId) || keys.has(key)) {
        errors.push({ code: 'chunkIdentityMismatch', path, message: 'chunk 坐标、ID 或命名空间不一致' });
        continue;
      }
      if (!entry.chunkState || entry.chunkState.schemaVersion !== 1) {
        errors.push({ code: 'chunkStateVersionMismatch', path: `${path}.chunkState`, message: 'chunk 动态状态版本不兼容' });
        continue;
      }
      const validationChunk = this.loaded.get(key) || new LoadedChunk({
        key,
        regionId: this.regionId,
        chunkId: entry.chunkId,
        sceneId: entry.sceneId,
        sceneNamespace: entry.sceneNamespace,
        col: entry.col,
        row: entry.row,
        origin: this.chunkOrigin(entry.col, entry.row),
        placementAdapter: this.placementAdapter
      });
      if (typeof validationChunk.validateState === 'function') {
        const chunkCheck = validationChunk.validateState(entry.chunkState);
        if (isPromise(chunkCheck)) {
          errors.push({ code: 'asyncValidationUnsupported', path: `${path}.chunkState`, message: '同步快照不支持异步 chunk 校验' });
        } else if (chunkCheck?.ok === false) {
          errors.push(...(chunkCheck.errors || [{ code: 'invalidChunkState', path: '', message: 'chunk 动态状态无效' }])
            .map(error => ({ ...error, path: `${path}.chunkState${error.path ? `.${error.path}` : ''}` })));
        }
      }
      if (!entry.providers || typeof entry.providers !== 'object' || Array.isArray(entry.providers)) {
        errors.push({ code: 'invalidStateProviders', path: `${path}.providers`, message: 'chunk provider 状态集合无效' });
        continue;
      }
      keys.add(key);
      for (const [id, value] of Object.entries(entry.providers)) {
        const provider = this._stateProviders.get(id);
        if (!provider) {
          errors.push({ code: 'unknownStateProvider', path: `${path}.providers.${id}`, message: '动态状态 provider 不存在' });
          continue;
        }
        if (typeof provider.validate === 'function') {
          const result = provider.validate(value, {
            manager: this,
            chunk: validationChunk,
            key,
            regionId: this.regionId,
            chunkId: entry.chunkId,
            sceneId: entry.sceneId,
            sceneNamespace: entry.sceneNamespace,
            col: entry.col,
            row: entry.row
          });
          if (isPromise(result)) {
            errors.push({ code: 'asyncValidationUnsupported', path: `${path}.providers.${id}`, message: '同步快照不支持异步 provider 校验' });
          } else if (result?.ok === false) {
            errors.push(...(result.errors || [{ code: 'providerValidationFailed', path: '', message: '动态状态校验失败' }])
              .map(error => ({ ...error, path: `${path}.providers.${id}${error.path ? `.${error.path}` : ''}` })));
          }
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  deserialize(data) {
    const check = this.validateSerialized(data);
    if (!check.ok) return check;

    const nextStates = new Map();
    for (const entry of data.chunks) {
      nextStates.set(this._chunkKey(entry.col, entry.row), cloneValue(entry));
    }

    const restores = [];
    try {
      for (const [key, chunk] of this.loaded) {
        const entry = nextStates.get(key);
        if (!entry) continue;

        const context = this._providerContext(chunk, key);
        const chunkCheck = typeof chunk.validateState === 'function'
          ? chunk.validateState(entry.chunkState)
          : { ok: true, errors: [] };
        if (isPromise(chunkCheck)) {
          const error = streamingError('asyncValidationUnsupported', `Chunk ${key} 不能异步校验同步快照`);
          error.path = `chunks.${key}.chunkState`;
          throw error;
        }
        if (chunkCheck?.ok === false) {
          const error = streamingError('chunkStateValidationFailed', `Chunk ${key} 动态状态校验失败`);
          error.path = `chunks.${key}.chunkState`;
          error.errors = chunkCheck.errors || [];
          throw error;
        }

        const chunkRollback = typeof chunk.serialize === 'function'
          ? chunk.serialize()
          : cloneValue(chunk.state ?? null);
        if (isPromise(chunkRollback)) {
          const error = streamingError('asyncSnapshotUnsupported', `Chunk ${key} 不能异步采集回滚状态`);
          error.path = `chunks.${key}.chunkState`;
          throw error;
        }

        const providers = [];
        for (const [id, value] of Object.entries(entry.providers || {})) {
          const provider = this._stateProviders.get(id);
          if (!provider) continue;
          const providerPath = `chunks.${key}.providers.${id}`;
          const prepared = typeof provider.prepareRestore === 'function'
            ? provider.prepareRestore(cloneValue(value), context)
            : { ok: true, draft: cloneValue(value), rollback: null };
          if (isPromise(prepared)) {
            const error = streamingError('asyncRestoreUnsupported', `Provider ${id} 不能异步准备同步快照`);
            error.path = providerPath;
            throw error;
          }
          if (prepared?.ok === false) {
            const error = streamingError('providerPrepareFailed', `动态状态 ${id} 准备失败`);
            error.path = providerPath;
            error.errors = prepared.errors || [];
            throw error;
          }
          providers.push({
            id,
            provider,
            context,
            path: providerPath,
            draft: prepared?.draft ?? prepared,
            rollback: prepared?.rollback ?? null
          });
        }
        restores.push({ key, chunk, entry, chunkRollback: cloneValue(chunkRollback), providers });
      }
    } catch (error) {
      const nested = Array.isArray(error.errors) && error.errors.length
        ? error.errors.map(item => ({
          ...item,
          path: `${error.path || ''}${item.path ? `.${item.path}` : ''}`
        }))
        : [{ code: error.code || 'streamingRestorePrepareFailed', path: error.path || '', message: error.message }];
      return { ok: false, errors: nested };
    }

    const committedChunks = [];
    const committedProviders = [];
    let failure = null;
    try {
      for (const restore of restores) {
        const result = typeof restore.chunk.restoreState === 'function'
          ? restore.chunk.restoreState(cloneValue(restore.entry.chunkState))
          : { ok: true };
        committedChunks.push(restore);
        if (isPromise(result)) {
          const error = streamingError('asyncRestoreUnsupported', `Chunk ${restore.key} 不能异步恢复同步快照`);
          error.path = `chunks.${restore.key}.chunkState`;
          throw error;
        }
        if (result?.ok === false) {
          const error = streamingError('chunkRestoreFailed', `Chunk ${restore.key} 动态状态恢复失败`);
          error.path = `chunks.${restore.key}.chunkState`;
          throw error;
        }
      }

      for (const restore of restores) {
        for (const prepared of restore.providers) {
          if (typeof prepared.provider.commitRestore !== 'function') continue;
          const result = prepared.provider.commitRestore(prepared.draft, prepared.context);
          committedProviders.push(prepared);
          if (isPromise(result)) {
            const error = streamingError('asyncRestoreUnsupported', `Provider ${prepared.id} 不能异步提交同步快照`);
            error.path = prepared.path;
            throw error;
          }
          if (result?.ok === false) {
            const error = streamingError('providerCommitFailed', `动态状态 ${prepared.id} 提交失败`);
            error.path = prepared.path;
            throw error;
          }
        }
      }
    } catch (error) {
      failure = error;
    }

    if (failure) {
      const rollbackErrors = [];
      for (const prepared of committedProviders.reverse()) {
        try {
          const result = prepared.provider.rollbackRestore(prepared.rollback, prepared.context);
          if (isPromise(result)) {
            rollbackErrors.push({
              code: 'asyncRollbackUnsupported',
              path: prepared.path,
              message: `Provider ${prepared.id} 不能异步回滚同步快照`
            });
          } else if (result?.ok === false) {
            rollbackErrors.push(...(result.errors || [{
              code: 'providerRollbackFailed', path: prepared.path, message: `动态状态 ${prepared.id} 回滚失败`
            }]));
          }
        } catch (error) {
          rollbackErrors.push({
            code: 'providerRollbackFailed', path: prepared.path, message: error?.message || String(error)
          });
        }
      }
      for (const restore of committedChunks.reverse()) {
        try {
          const result = restore.chunk.restoreState(cloneValue(restore.chunkRollback));
          if (isPromise(result) || result?.ok === false) {
            rollbackErrors.push({
              code: 'chunkRollbackFailed',
              path: `chunks.${restore.key}.chunkState`,
              message: `Chunk ${restore.key} 回滚失败`
            });
          }
        } catch (error) {
          rollbackErrors.push({
            code: 'chunkRollbackFailed',
            path: `chunks.${restore.key}.chunkState`,
            message: error?.message || String(error)
          });
        }
      }
      return {
        ok: false,
        errors: [{
          code: failure.code || 'streamingRestoreFailed',
          path: failure.path || '',
          message: failure.message || String(failure)
        }, ...rollbackErrors]
      };
    }

    this._cancelPending();
    this._generation++;
    for (const { key } of restores) nextStates.delete(key);
    this.savedStates = nextStates;
    this._currentCol = data.current.col;
    this._currentRow = data.current.row;
    this._needsRefresh = true;
    return { ok: true, errors: [] };
  }

  init(worldIndex, project = null, deps = {}) {
    const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
    return this.configureRegion(worldIndex, {
      regionRef: deps.regionRef,
      sceneResolver: deps.sceneResolver || (sceneId => scenes.find(scene => scene?.id === sceneId) || null),
      placementAdapter: deps.placementAdapter || null,
      onChunkLoad: deps.onChunkLoad || null,
      onChunkUnload: deps.onChunkUnload || null
    });
  }

  _cancelPending() {
    this._abortController?.abort?.();
    this._pendingUpdate = null;
    this._pendingTarget = null;
    this._abortController = null;
  }
}

export { STREAMING_SCHEMA_VERSION };
export default WorldStreamingManager;

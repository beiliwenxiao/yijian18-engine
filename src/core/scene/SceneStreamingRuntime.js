/**
 * SceneStreamingRuntime owns the generic lifecycle around one WorldStreamingManager.
 * Host scenes inject terrain construction and projection hooks; content state remains outside core.
 */
import { WorldStreamingManager } from '../WorldStreamingManager.js';

const cloneSceneData = sceneData => (
  sceneData && Array.isArray(sceneData.layers)
    ? JSON.parse(JSON.stringify(sceneData))
    : null
);

export class SceneStreamingRuntime {
  constructor({
    WorldStreamingManagerClass = WorldStreamingManager,
    createTerrain = null,
    getPosition = null,
    getCurrentSceneId = null,
    getRuntime = null,
    onProjection = null,
    onChunkUnload = null,
    prepareChunkAssets = null,
    onTransition = null,
    onError = null
  } = {}) {
    this.WorldStreamingManagerClass = WorldStreamingManagerClass;
    this.createTerrain = createTerrain;
    this.getPosition = getPosition;
    this.getCurrentSceneId = getCurrentSceneId;
    this.getRuntime = getRuntime;
    this.onProjection = onProjection;
    this.onChunkUnload = onChunkUnload;
    this.prepareChunkAssets = typeof prepareChunkAssets === 'function' ? prepareChunkAssets : null;
    this.onTransition = onTransition;
    this.onError = onError;
    this.manager = null;
    this.terrainsByChunk = new Map();
    this._preparedTerrains = new WeakMap();
    this._terrainPreparationPromises = new WeakMap();
    this.detach = null;
  }

  async prepare({ worldResult, targetSceneId = null, session = null, stateProviders = [] } = {}) {
    const worldIndex = worldResult?.worldIndex;
    const region = worldResult?.region;
    if (!worldIndex || !region) {
      throw new Error('无法初始化流式加载：ProjectWorldIndex 或 Region 不存在');
    }

    const manager = new this.WorldStreamingManagerClass();
    const configured = manager.configureRegion(worldIndex, {
      regionRef: region.id,
      sceneResolver: (sceneId, context = {}) => session?.loadSceneData?.(sceneId, {
        signal: context.signal || null
      }) || null,
      onChunkLoad: this.prepareChunkAssets
        ? async (col, row, sceneId, origin, _savedState, context) => {
          await this.prepareChunkAssets({ col, row, sceneId, origin, ...context });
          return null;
        }
        : null,
      onChunkUnload: null
    });
    if (!configured.ok) {
      throw new Error(configured.errors?.[0]?.message || '流式 Region 配置失败');
    }

    for (const { id, provider } of stateProviders) {
      manager.registerStateProvider(id, provider);
    }

    const initialChunk = worldResult.chunks?.find(chunk => chunk.sceneId === targetSceneId);
    if (!initialChunk) throw new Error('流式 Region 中没有可加载 chunk');
    const centerX = initialChunk.offset.x + region.chunkWidth / 2;
    const centerY = initialChunk.offset.y + region.chunkHeight / 2;
    const loaded = await manager.update(centerX, centerY);
    if (!loaded.ok) {
      manager.unloadAll({ preserveState: false });
      throw new Error(loaded.errors?.[0]?.message || '初始九宫格加载失败');
    }
    try {
      await this._prepareLoadedTerrains(manager);
    } catch (error) {
      this._releaseTerrainMap(this._preparedTerrains.get(manager));
      this._preparedTerrains.delete(manager);
      manager.unloadAll({ preserveState: false });
      throw error;
    }
    return manager;
  }

  _createTerrain(chunk, manager) {
    return this.createTerrain?.({
      chunk,
      manager,
      chunkWidth: manager.chunkWidth,
      chunkHeight: manager.chunkHeight,
      sceneData: cloneSceneData(chunk.sceneData)
    }) || null;
  }

  async _prepareLoadedTerrains(manager) {
    const pending = this._terrainPreparationPromises.get(manager);
    if (pending) return pending;
    const operation = this._prepareLoadedTerrainsNow(manager).finally(() => {
      if (this._terrainPreparationPromises.get(manager) === operation) {
        this._terrainPreparationPromises.delete(manager);
      }
    });
    this._terrainPreparationPromises.set(manager, operation);
    return operation;
  }

  async _prepareLoadedTerrainsNow(manager) {
    if (!manager) return new Map();
    let terrainMap = this._preparedTerrains.get(manager);
    if (!terrainMap) {
      terrainMap = new Map();
      this._preparedTerrains.set(manager, terrainMap);
    }

    const chunks = [...manager.getLoadedChunks().values()];
    const activeKeys = new Set(chunks.map(chunk => chunk.key));
    for (const [key, terrain] of terrainMap) {
      if (activeKeys.has(key)) continue;
      terrain?.releaseStaticCaches?.();
      terrainMap.delete(key);
    }

    const created = [];
    try {
      for (const chunk of chunks) {
        if (terrainMap.has(chunk.key)) continue;
        const terrain = this._createTerrain(chunk, manager);
        if (!terrain) continue;
        terrainMap.set(chunk.key, terrain);
        created.push({ key: chunk.key, terrain });
      }
      await Promise.all(created.map(({ terrain }) => terrain.prepareStaticCaches?.()));
      return terrainMap;
    } catch (error) {
      for (const { key, terrain } of created) {
        terrain?.releaseStaticCaches?.();
        terrainMap.delete(key);
      }
      throw error;
    }
  }

  _createStreamingAdapter(manager) {
    return {
      serialize: (...args) => manager.serialize(...args),
      validateSerialized: (...args) => manager.validateSerialized(...args),
      deserialize: (...args) => manager.deserialize(...args),
      update: async (...args) => {
        const result = await manager.update(...args);
        if (result?.ok) await this._prepareLoadedTerrains(manager);
        return result;
      }
    };
  }

  _releaseTerrainMap(terrainMap) {
    if (!terrainMap) return;
    for (const terrain of terrainMap.values()) terrain?.releaseStaticCaches?.();
    terrainMap.clear();
  }

  async initialize({ worldResult, targetSceneId = null, session = null, preparedManager = null, stateProviders = [] } = {}) {
    const manager = preparedManager || await this.prepare({
      worldResult, targetSceneId, session, stateProviders
    });
    const preparedTerrains = this._preparedTerrains.get(manager)
      || await this._prepareLoadedTerrains(manager);
    this.dispose();
    manager.onChunkUnload = (col, row, chunk) => {
      const terrain = preparedTerrains.get(chunk?.key);
      terrain?.releaseStaticCaches?.();
      preparedTerrains.delete(chunk?.key);
      this.onChunkUnload?.({ col, row, chunk, manager });
    };
    this.manager = manager;
    this.terrainsByChunk = preparedTerrains;
    this.syncProjection();

    const runtime = this.getRuntime?.();
    const streamingAdapter = this._createStreamingAdapter(manager);
    this.detach = runtime?.attachWorldStreaming?.(streamingAdapter, {
      getPosition: () => this.getPosition?.() || null,
      onTransition: async transition => {
        if (transition?.unchanged) return;
        this.terrainsByChunk = this._preparedTerrains.get(manager) || preparedTerrains;
        this.syncProjection();
        await this.onTransition?.({ transition, manager });
      },
      onError: failure => this.onError?.(failure)
    }) || null;
    return manager;
  }

  getLoadedChunk(sceneId) {
    if (!sceneId || !this.manager) return null;
    return [...this.manager.getLoadedChunks().values()]
      .find(chunk => chunk?.sceneId === sceneId) || null;
  }

  /**
   * 从磁盘 canonical 局部数据准备 detached chunk/terrain 草稿。
   * 异步资源与静态缓存准备期间不修改当前 chunk、terrain 或 session；调用方在同一同步段执行 commit。
   */
  async prepareLoadedSceneData(sceneId, sceneData, { signal = null } = {}) {
    const manager = this.manager;
    const terrainMap = this.terrainsByChunk;
    const chunk = this.getLoadedChunk(sceneId);
    if (!manager || !chunk) return { ok: true, loaded: false, errors: [] };
    if (typeof chunk.prepareSceneData !== 'function' || typeof chunk.commitSceneData !== 'function') {
      return {
        ok: false,
        loaded: true,
        errors: [{ code: 'chunkSceneReplacementUnsupported', path: sceneId, message: `Chunk ${sceneId} 不支持场景热替换` }]
      };
    }

    const previousSceneData = chunk.sceneData;
    const previousValidation = chunk.prepareSceneData(previousSceneData);
    const prepared = chunk.prepareSceneData(sceneData);
    if (!previousValidation?.ok || !prepared?.ok) {
      const failure = prepared?.ok === false ? prepared : previousValidation;
      return { ...failure, loaded: true };
    }
    const previous = {
      sceneData: previousSceneData,
      decorations: chunk.decorations,
      sceneObjects: chunk.sceneObjects,
      placements: chunk.placements,
      triggerBindings: chunk.triggerBindings,
      effectZones: chunk.effectZones
    };
    const previousTerrain = terrainMap.get(chunk.key) || null;
    let detachedTerrain = null;
    let detachedReleased = false;
    let state = 'preparing';

    const releaseDetached = () => {
      if (detachedReleased || !detachedTerrain) return;
      detachedReleased = true;
      try {
        detachedTerrain.releaseStaticCaches?.();
      } catch (_error) { /* best-effort detached terrain release */ }
    };
    const isOriginalCurrent = () => (
      !signal?.aborted &&
      this.manager === manager &&
      this.terrainsByChunk === terrainMap &&
      manager.getLoadedChunks().get(chunk.key) === chunk &&
      chunk.sceneData === previousSceneData &&
      (terrainMap.get(chunk.key) || null) === previousTerrain
    );
    const isCommittedCurrent = () => (
      this.manager === manager &&
      this.terrainsByChunk === terrainMap &&
      manager.getLoadedChunks().get(chunk.key) === chunk &&
      chunk.sceneData === prepared.sceneData &&
      (terrainMap.get(chunk.key) || null) === detachedTerrain
    );
    const superseded = () => ({ ok: false, loaded: true, superseded: true, errors: [] });

    try {
      if (!isOriginalCurrent()) return superseded();
      await this.prepareChunkAssets?.({
        col: chunk.col,
        row: chunk.row,
        sceneId: chunk.sceneId,
        sceneNamespace: chunk.sceneNamespace,
        sceneData: cloneSceneData(prepared.sceneData),
        signal,
        origin: { ...chunk.origin },
        chunk
      });
      if (!isOriginalCurrent()) return superseded();
      detachedTerrain = this.createTerrain?.({
        chunk,
        manager,
        chunkWidth: manager.chunkWidth,
        chunkHeight: manager.chunkHeight,
        sceneData: cloneSceneData(prepared.sceneData)
      }) || null;
      await detachedTerrain?.prepareStaticCaches?.({ signal });
      if (!isOriginalCurrent()) {
        releaseDetached();
        return superseded();
      }
    } catch (error) {
      releaseDetached();
      if (signal?.aborted || !isOriginalCurrent()) return superseded();
      return {
        ok: false,
        loaded: true,
        errors: [{ code: 'loadedScenePreparationFailed', path: sceneId, message: error?.message || String(error) }]
      };
    }

    state = 'prepared';
    const discard = () => {
      if (state !== 'prepared') return { ok: true, skipped: true, errors: [] };
      releaseDetached();
      state = 'discarded';
      return { ok: true, errors: [] };
    };
    const commit = () => {
      if (state !== 'prepared') {
        return {
          ok: false,
          loaded: true,
          errors: [{ code: 'sceneReplacementDraftSettled', path: sceneId, message: `场景 ${sceneId} 热替换草稿已结束` }]
        };
      }
      if (!isOriginalCurrent()) {
        discard();
        return superseded();
      }

      const committed = chunk.commitSceneData(prepared);
      if (!committed?.ok) {
        discard();
        return { ...committed, loaded: true };
      }
      if (detachedTerrain) terrainMap.set(chunk.key, detachedTerrain);
      else terrainMap.delete(chunk.key);

      try {
        const projection = this.syncProjection();
        state = 'committed';
        const rollback = () => {
          if (state !== 'committed') return { ok: true, skipped: true, errors: [] };
          if (!isCommittedCurrent()) {
            state = 'superseded';
            return superseded();
          }
          const restored = chunk.commitSceneData(previous);
          if (!restored?.ok) return restored;
          if (previousTerrain) terrainMap.set(chunk.key, previousTerrain);
          else terrainMap.delete(chunk.key);
          const errors = [];
          try {
            this.syncProjection();
          } catch (error) {
            errors.push({
              code: 'sceneProjectionRollbackFailed',
              path: sceneId,
              message: error?.message || String(error)
            });
          }
          releaseDetached();
          state = 'rolledBack';
          return { ok: errors.length === 0, errors };
        };
        const finalize = () => {
          if (state !== 'committed') return { ok: true, skipped: true, errors: [] };
          if (!isCommittedCurrent()) {
            state = 'superseded';
            return { ok: true, superseded: true, errors: [] };
          }
          const errors = [];
          if (previousTerrain && previousTerrain !== detachedTerrain) {
            try {
              previousTerrain.releaseStaticCaches?.();
            } catch (error) {
              errors.push({
                code: 'previousTerrainReleaseFailed',
                path: sceneId,
                message: error?.message || String(error)
              });
            }
          }
          state = 'finalized';
          return { ok: errors.length === 0, errors };
        };
        return {
          ok: true,
          loaded: true,
          errors: [],
          chunk,
          terrain: detachedTerrain,
          previousTerrain,
          projection,
          ...committed,
          rollback,
          finalize
        };
      } catch (error) {
        const restored = chunk.commitSceneData(previous);
        if (previousTerrain) terrainMap.set(chunk.key, previousTerrain);
        else terrainMap.delete(chunk.key);
        const errors = [{
          code: 'loadedSceneReplacementFailed',
          path: sceneId,
          message: error?.message || String(error)
        }];
        if (restored?.ok === false) errors.push(...(restored.errors || []));
        try {
          this.syncProjection();
        } catch (rollbackError) {
          errors.push({
            code: 'sceneProjectionRollbackFailed',
            path: sceneId,
            message: rollbackError?.message || String(rollbackError)
          });
        }
        releaseDetached();
        state = 'rolledBack';
        return { ok: false, loaded: true, errors };
      }
    };

    return {
      ok: true,
      loaded: true,
      errors: [],
      chunk,
      terrain: detachedTerrain,
      previousTerrain,
      commit,
      discard
    };
  }

  syncProjection(currentSceneId = this.getCurrentSceneId?.()) {
    const manager = this.manager;
    if (!manager) return null;
    const chunks = [...manager.getLoadedChunks().values()];
    const activeKeys = new Set(chunks.map(chunk => chunk.key));
    for (const [key, terrain] of this.terrainsByChunk) {
      if (activeKeys.has(key)) continue;
      terrain?.releaseStaticCaches?.();
      this.terrainsByChunk.delete(key);
    }

    const terrains = chunks.map(chunk => this.terrainsByChunk.get(chunk.key)).filter(Boolean);
    const currentChunk = chunks.find(chunk => chunk.sceneId === currentSceneId);
    const terrain = currentChunk
      ? this.terrainsByChunk.get(currentChunk.key)
      : (terrains[0] || null);
    const loadedCoverage = manager.getActiveNineGridCoverage?.() || null;
    this.onProjection?.({ manager, chunks, terrains, terrain, currentSceneId, loadedCoverage });
    return { manager, chunks, terrains, terrain, loadedCoverage };
  }

  dispose() {
    this.detach?.();
    this.detach = null;
    const manager = this.manager;
    this._releaseTerrainMap(this.terrainsByChunk);
    if (manager) {
      this._preparedTerrains.delete(manager);
      this._terrainPreparationPromises.delete(manager);
    }
    manager?.unloadAll?.({ preserveState: false });
    this.manager = null;
    this.terrainsByChunk = new Map();
  }
}

export default SceneStreamingRuntime;

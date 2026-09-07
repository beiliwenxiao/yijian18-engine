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

import { ProjectWorldIndex } from '../ProjectWorldIndex.js';
import { SceneObjectProjector } from './SceneObjectProjector.js';
import { createSpatialTriggerBinding } from './SpatialTriggerBinding.js';

function abortError() {
  const error = new Error('World map load session is no longer active');
  error.name = 'AbortError';
  return error;
}

function awaitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener?.('abort', onAbort);
    signal.addEventListener?.('abort', onAbort, { once: true });
    promise.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

function formatErrorMessage(error) {
  if (error instanceof Error) return error.message;
  const nestedMessage = error?.message || error?.errors?.[0]?.message || error?.error?.message;
  return typeof nestedMessage === 'string' && nestedMessage.length > 0 ? nestedMessage : String(error);
}

function errorRecord(stage, error, extra = {}) {
  return {
    stage,
    ...extra,
    error,
    message: formatErrorMessage(error)
  };
}

function projectSceneDimensions(project) {
  return new Map((project?.scenes || []).map(scene => [scene?.id, {
    width: scene?.width,
    height: scene?.height
  }]).filter(([sceneId]) => typeof sceneId === 'string' && sceneId.length > 0));
}

function assertSceneDataDimensions(sceneId, sceneData, worldIndex) {
  const anchor = worldIndex?.findScene?.(sceneId);
  if (!anchor) return;
  const width = Number(sceneData?.width);
  const height = Number(sceneData?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    const error = new TypeError(`场景 ${sceneId} 缺少 canonical width/height`);
    error.code = 'missingSceneDimensions';
    throw error;
  }
  if (width !== anchor.worldWidth || height !== anchor.worldHeight) {
    const error = new RangeError(`场景 ${sceneId} 尺寸 ${width}×${height} 与世界索引 ${anchor.worldWidth}×${anchor.worldHeight} 不一致`);
    error.code = 'sceneDimensionsMismatch';
    throw error;
  }
}

/** 加载项目世界地图，并缓存项目及每个场景的唯一加载 Promise。 */
export class WorldMapLoadSession {
  constructor({ repository = null, loadProject = null, loadScene = null, loadSceneFallback = null, scope = null, projector = null } = {}) {
    if (!repository && typeof loadProject !== 'function') throw new TypeError('loadProject must be a function');
    if (!repository && typeof loadScene !== 'function') throw new TypeError('loadScene must be a function');
    this.repository = repository;
    this.loadProject = loadProject;
    this.loadScene = loadScene;
    this.loadSceneFallback = loadSceneFallback;
    this.scope = scope;
    this.projector = projector || new SceneObjectProjector();
    this._projectPromises = new Map();
    this._scenePromises = new Map();
    this._sceneData = new Map();
    this._generationSnapshot = null;
    this._lastResult = null;
    this._version = 0;
    this._disposed = false;
    this._detachScope = typeof scope?.add === 'function' ? scope.add(() => this.dispose()) : null;
  }

  async load({ projectUrl = 'game.project.json', regionIndex = null, sceneIds = null } = {}) {
    if (this._disposed) throw abortError();
    const version = ++this._version;
    const errors = [];
    const warnings = [];
    this._projectPromises = new Map();
    this._scenePromises = new Map();
    this._generationSnapshot = null;
    let project = null;
    let worldIndex = null;

    try {
      if (this.repository) {
        const repositoryResult = await this.repository.refresh();
        this._generationSnapshot = repositoryResult.snapshot;
        warnings.push(...(repositoryResult.warnings || []));
        if (!repositoryResult.ok) {
          errors.push(...repositoryResult.errors.map(error => errorRecord('canonicalSceneRepository', error, {
            projectUrl,
            category: error.category,
            source: error.source
          })));
        }
        project = this._generationSnapshot?.project || null;
      } else {
        project = await this._getProjectPromise(projectUrl);
      }
      worldIndex = ProjectWorldIndex.build(project, {
        sceneDimensions: projectSceneDimensions(project),
        requireSceneDimensions: true
      });
    } catch (error) {
      errors.push(errorRecord('projectWorldIndex', error, {
        projectUrl,
        errors: error?.errors || []
      }));
    }
    this._assertActive(version);

    const resolvedRegionRef = regionIndex ?? (sceneIds === 'entry'
      ? worldIndex?.getEntry?.()?.regionId
      : 0);
    const region = worldIndex?.getRegion(resolvedRegionRef) || null;
    if (!region) {
      errors.push(errorRecord('region', new Error(`Region ${resolvedRegionRef} was not found`), {
        regionIndex: resolvedRegionRef
      }));
      return this._commit(version, {
        project, worldIndex, repositorySnapshot: this._generationSnapshot,
        region: null, chunks: [], sceneObjects: [], placements: [], triggerBindings: [], effectZones: [],
        sceneProvenance: {}, warnings, errors
      });
    }

    const chunkSpecs = this._chunkSpecs(worldIndex, region);
    const regionSceneIds = [...new Set(chunkSpecs.map(chunk => chunk.sceneId).filter(Boolean))];
    const requestedValues = sceneIds === 'entry'
      ? [worldIndex.getEntry()?.sceneId]
      : sceneIds;
    const requestedSceneIds = Array.isArray(requestedValues)
      ? [...new Set(requestedValues.filter(sceneId => regionSceneIds.includes(sceneId)))]
      : regionSceneIds;
    const loaded = await Promise.all(requestedSceneIds.map(async sceneId => {
      const outcome = await this._getScenePromise(sceneId, project);
      return [sceneId, outcome];
    }));
    this._assertActive(version);

    const sceneOutcomes = new Map(loaded);
    for (const [sceneId, outcome] of loaded) {
      errors.push(...outcome.errors.map(entry => ({ ...entry, sceneId })));
      warnings.push(...(outcome.warnings || []));
      if (!outcome.data) continue;
      try {
        assertSceneDataDimensions(sceneId, outcome.data, worldIndex);
        this._sceneData.set(sceneId, outcome.data);
      } catch (error) {
        errors.push(errorRecord('sceneDimensions', error, { sceneId }));
        outcome.data = null;
      }
    }

    const chunks = chunkSpecs.map(spec => ({
      ...spec,
      sceneData: sceneOutcomes.get(spec.sceneId)?.data || null
    }));
    const sceneObjects = [];
    const placements = [];
    const triggerBindings = [];
    const effectZones = [];
    for (const chunk of chunks) this._collectChunkObjects(chunk, sceneObjects, placements, effectZones, triggerBindings);

    const sceneProvenance = Object.fromEntries(requestedSceneIds.map(sceneId => [
      sceneId,
      this._generationSnapshot?.getProvenance?.(sceneId) || null
    ]));
    return this._commit(version, {
      project, worldIndex, repositorySnapshot: this._generationSnapshot,
      region, chunks, sceneObjects, placements, triggerBindings, effectZones,
      sceneProvenance, warnings, errors
    });
  }

  getSceneData(sceneId) {
    return this._sceneData.get(sceneId) || null;
  }

  /**
   * 丢弃单个场景的会话内缓存（数据/加载 Promise/已收集对象）。
   * 用于编辑器保存后的热同步：之后该场景被再次请求时将重新读盘。
   */
  forgetScene(sceneId) {
    if (this._disposed || !sceneId) return false;
    this.repository?.forgetScene?.(sceneId);
    this._scenePromises.delete(sceneId);
    this._sceneData.delete(sceneId);
    const chunk = this._lastResult?.chunks?.find(entry => entry.sceneId === sceneId);
    if (chunk && chunk.sceneData) {
      chunk.sceneData = null;
      const dropByScene = item => item?.sceneId === sceneId;
      this._lastResult.sceneObjects = this._lastResult.sceneObjects.filter(item => !dropByScene(item));
      this._lastResult.placements = this._lastResult.placements.filter(item => !dropByScene(item));
      this._lastResult.effectZones = this._lastResult.effectZones.filter(item => !dropByScene(item));
      this._lastResult.triggerBindings = this._lastResult.triggerBindings.filter(item => !dropByScene(item));
    }
    return true;
  }

  /**
   * 用新的场景数据替换会话缓存中的该场景，并重新收集其对象（编辑器保存后热同步）。
   * @returns {{ok: boolean, placements?: Array<object>, errors?: Array<Error>}}
   */
  replaceSceneData(sceneId, data) {
    if (this._disposed) return { ok: false, errors: [abortError()] };
    if (!sceneId || !data || !Array.isArray(data.layers)) return { ok: false, errors: [new TypeError('replaceSceneData requires valid scene data')] };
    try {
      assertSceneDataDimensions(sceneId, data, this._lastResult?.worldIndex);
    } catch (error) {
      return { ok: false, errors: [error] };
    }
    const chunk = this._lastResult?.chunks?.find(entry => entry.sceneId === sceneId);
    if (!chunk) return { ok: false, errors: [new Error(`场景 ${sceneId} 不在当前世界加载结果中`)] };
    this.repository?.forgetScene?.(sceneId);
    this._scenePromises.delete(sceneId);
    this._sceneData.set(sceneId, data);
    const dropByScene = item => item?.sceneId === sceneId;
    this._lastResult.sceneObjects = this._lastResult.sceneObjects.filter(item => !dropByScene(item));
    this._lastResult.placements = this._lastResult.placements.filter(item => !dropByScene(item));
    this._lastResult.effectZones = this._lastResult.effectZones.filter(item => !dropByScene(item));
    this._lastResult.triggerBindings = this._lastResult.triggerBindings.filter(item => !dropByScene(item));
    chunk.sceneData = data;
    this._collectChunkObjects(
      chunk,
      this._lastResult.sceneObjects,
      this._lastResult.placements,
      this._lastResult.effectZones,
      this._lastResult.triggerBindings
    );
    return {
      ok: true,
      placements: this._lastResult.placements.filter(item => item?.sceneId === sceneId),
      sceneObjects: this._lastResult.sceneObjects.filter(item => item?.sceneId === sceneId)
    };
  }

  async loadSceneData(sceneId, projectOrOptions = this._lastResult?.project || null, maybeOptions = {}) {
    if (this._disposed) throw abortError();
    const options = projectOrOptions && typeof projectOrOptions === 'object'
      && Object.prototype.hasOwnProperty.call(projectOrOptions, 'signal')
      ? projectOrOptions
      : maybeOptions;
    const project = options === projectOrOptions
      ? this._lastResult?.project || null
      : projectOrOptions;
    if (options.signal?.aborted) throw abortError();
    const outcome = await this._getScenePromise(sceneId, project, options);
    if (options.signal?.aborted) throw abortError();
    if (!outcome?.data) {
      const error = new Error(outcome?.errors?.[0]?.message || `场景 ${sceneId} 加载失败`);
      error.errors = outcome?.errors || [];
      throw error;
    }
    assertSceneDataDimensions(sceneId, outcome.data, this._lastResult?.worldIndex);
    this._sceneData.set(sceneId, outcome.data);
    if (this._lastResult) {
      this._lastResult.sceneProvenance[sceneId] = this._generationSnapshot?.getProvenance?.(sceneId) || null;
      this._lastResult.warnings.push(...(outcome.warnings || []));
    }
    const chunk = this._lastResult?.chunks?.find(entry => entry.sceneId === sceneId);
    if (chunk && !chunk.sceneData) {
      chunk.sceneData = outcome.data;
      this._collectChunkObjects(
        chunk,
        this._lastResult.sceneObjects,
        this._lastResult.placements,
        this._lastResult.effectZones,
        this._lastResult.triggerBindings
      );
    }
    return outcome.data;
  }

  getChunk(sceneOrQuery, occurrence = 0) {
    const chunks = this._lastResult?.chunks || [];
    if (sceneOrQuery && typeof sceneOrQuery === 'object') {
      return chunks.find(chunk =>
        (sceneOrQuery.sceneId == null || chunk.sceneId === sceneOrQuery.sceneId) &&
        (sceneOrQuery.row == null || chunk.row === sceneOrQuery.row) &&
        (sceneOrQuery.col == null || chunk.col === sceneOrQuery.col)
      ) || null;
    }
    return chunks.filter(chunk => chunk.sceneId === sceneOrQuery)[occurrence] || null;
  }

  findSceneObject(sceneId, objectId) {
    if (!sceneId || !objectId) return null;
    return this._lastResult?.sceneObjects?.find(object => (
      object?.sceneId === sceneId && object?.id === objectId
    )) || null;
  }

  findSpawn(sceneId, spawnRef = null) {
    const placements = this._lastResult?.placements || [];
    return placements.find(placement => {
      if (placement.type !== 'spawn' || placement.sceneId !== sceneId) return false;
      if (spawnRef == null) return true;
      return placement.ref === spawnRef || placement.id === spawnRef || placement.name === spawnRef;
    }) || null;
  }

  dispose() {
    if (this._disposed) return false;
    this._disposed = true;
    this._version++;
    this._sceneData.clear();
    this._generationSnapshot = null;
    this._lastResult = null;
    this._projectPromises.clear();
    this._scenePromises.clear();
    const detach = this._detachScope;
    this._detachScope = null;
    if (detach) detach();
    return true;
  }

  _getProjectPromise(projectUrl) {
    if (!this._projectPromises.has(projectUrl)) {
      this._projectPromises.set(projectUrl, Promise.resolve().then(() => this.loadProject(projectUrl)));
    }
    return this._projectPromises.get(projectUrl);
  }

  _getScenePromise(sceneId, project, { signal = null } = {}) {
    if (!this._scenePromises.has(sceneId)) {
      let promise;
      if (this._generationSnapshot) {
        promise = Promise.resolve()
          .then(() => this.repository.loadScene(sceneId, {
            snapshot: this._generationSnapshot,
            signal
          }))
          .then(result => {
            if (!result?.ok) {
              return {
                data: null,
                errors: (result?.errors || []).map(error => errorRecord('scene', error, {
                  loader: 'repository', sceneId, category: error.category, source: error.source
                })),
                warnings: result?.warnings || []
              };
            }
            return { data: result.record.data, errors: [], warnings: result.warnings || [] };
          })
          .catch(error => {
            if (error?.name === 'AbortError') throw error;
            return {
              data: null,
              errors: [errorRecord('scene', error, { loader: 'repository', sceneId })],
              warnings: []
            };
          });
      } else {
        promise = Promise.resolve()
          .then(() => this.loadScene(sceneId, project))
          .then(data => ({ data, errors: [], warnings: [] }))
          .catch(async primaryError => {
            if (primaryError?.name === 'AbortError') throw primaryError;
            const errors = [errorRecord('scene', primaryError, { loader: 'primary' })];
            if (typeof this.loadSceneFallback !== 'function') return { data: null, errors, warnings: [] };
            try {
              const data = await this.loadSceneFallback(sceneId, project, primaryError);
              return { data, errors, warnings: [] };
            } catch (fallbackError) {
              errors.push(errorRecord('scene', fallbackError, { loader: 'fallback' }));
              return { data: null, errors, warnings: [] };
            }
          });
      }
      this._scenePromises.set(sceneId, promise);
      promise.catch(() => {
        if (this._scenePromises.get(sceneId) === promise) this._scenePromises.delete(sceneId);
      });
    }
    return awaitWithSignal(this._scenePromises.get(sceneId), signal);
  }

  _chunkSpecs(worldIndex, region) {
    return worldIndex.getCells(region.id).map(cell => ({
      sceneId: cell.sceneId,
      row: cell.row,
      col: cell.col,
      offset: { ...cell.offset },
      origin: { ...cell.offset },
      worldWidth: cell.worldWidth,
      worldHeight: cell.worldHeight,
      footprint: cell.footprint
    }));
  }

  _collectChunkObjects(chunk, sceneObjects, placements, effectZones, triggerBindings) {
    if (!Array.isArray(chunk.sceneData?.layers)) return;
    const candidates = [];
    for (const layer of chunk.sceneData.layers) candidates.push(...(layer?.objects || []));
    for (const object of candidates) {
      if (!object || typeof object !== 'object') continue;
      const projected = this.projector.project(object, chunk.offset, {
        sceneId: chunk.sceneId,
        row: chunk.row,
        col: chunk.col
      });
      if (object.type === 'trigger') {
        if (object.enabled === false) continue;
        triggerBindings.push(createSpatialTriggerBinding(projected));
        continue;
      }
      sceneObjects.push(projected);
      if (object.type === 'ref' || object.type === 'spawn') {
        placements.push(projected);
      } else if (object.type === 'effectZone') {
        effectZones.push(projected);
      }
    }
  }

  _assertActive(version) {
    if (this._disposed || version !== this._version || this.scope?.disposed) throw abortError();
  }

  _commit(version, result) {
    this._assertActive(version);
    this._lastResult = result;
    return result;
  }
}

export default WorldMapLoadSession;
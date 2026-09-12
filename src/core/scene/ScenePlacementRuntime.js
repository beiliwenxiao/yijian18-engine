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

import { PlacementSpawner } from './PlacementSpawner.js';

function copyEntries(entries = []) {
  return entries.map(([id, state]) => [id, state == null ? state : JSON.parse(JSON.stringify(state))]);
}

function normalizeStateEntries(entries = []) {
  return (entries || [])
    .filter(entry => typeof entry?.id === 'string' && entry.state && typeof entry.state === 'object')
    .map(entry => [entry.id, JSON.parse(JSON.stringify(entry.state))]);
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function signaturesDifferOnlyByCoordinates(previousSignature, currentSignature) {
  if (typeof previousSignature !== 'string' || typeof currentSignature !== 'string') return false;
  try {
    const previous = JSON.parse(previousSignature);
    const current = JSON.parse(currentSignature);
    delete previous.x;
    delete previous.y;
    delete current.x;
    delete current.y;
    return stableSerialize(previous) === stableSerialize(current);
  } catch (error) {
    return false;
  }
}

function getRuntimePosition(value) {
  const transform = value?.getComponent?.('transform');
  const x = Number.isFinite(transform?.position?.x) ? transform.position.x : value?.x;
  const y = Number.isFinite(transform?.position?.y) ? transform.position.y : value?.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function positionsMatch(actual, expected, epsilon = 0.001) {
  return !!actual && !!expected
    && Math.abs(actual.x - expected.x) <= epsilon
    && Math.abs(actual.y - expected.y) <= epsilon;
}

/**
 * 生成与 canonical 放置定义绑定的稳定签名。
 * 投影后的 placement 必须优先使用 _localX/_localY，避免 worldOffset 参与存档兼容判断。
 */
export function getPlacementSignature(placement = {}) {
  const localX = Number.isFinite(placement._localX) ? placement._localX : placement.x;
  const localY = Number.isFinite(placement._localY) ? placement._localY : placement.y;
  return stableSerialize({
    version: 1,
    id: placement.id || null,
    sceneId: placement.sceneId || null,
    type: placement.type || null,
    kind: placement.kind || null,
    ref: placement.ref || null,
    group: placement.group || null,
    overrides: placement.overrides || null,
    collision: placement.collision || null,
    spawnWhen: placement.spawnWhen || null,
    x: Number.isFinite(localX) ? localX : null,
    y: Number.isFinite(localY) ? localY : null
  });
}

/**
 * 场景放置点的唯一运行时：拥有投影、生成幂等、pending 状态、出生点消费与原子重建。
 * 具体游戏只注入条件数据源和生成后的剧情索引副作用。
 */
export class ScenePlacementRuntime {
  constructor(config = {}) {
    if (!config.entityStore) throw new TypeError('ScenePlacementRuntime requires entityStore');
    this.scope = config.scope || null;
    this.entityStore = config.entityStore;
    this.aiSystem = config.aiSystem || null;
    this.corpseRuntime = config.corpseRuntime || null;
    this.getWorldPromise = config.getWorldPromise || (() => null);
    this.getLoadedChunks = config.getLoadedChunks || (() => new Map());
    this.getRegistries = config.getRegistries || (() => ({}));
    this.validatePlacementReferences = config.validatePlacementReferences || (() => ({ ok: true, errors: [] }));
    this.setValidationErrors = config.setValidationErrors || (() => {});
    this.getConditionRoot = config.getConditionRoot || (() => undefined);
    this.getCurrentSceneId = config.getCurrentSceneId || (() => null);
    this.getPlayer = config.getPlayer || (() => null);
    this.getCamera = config.getCamera || (() => null);
    this.consumeInitialPlayerSpawn = config.consumeInitialPlayerSpawn || (() => {});
    this.getPlayerStartMode = config.getPlayerStartMode || (() => 'restore');
    this.onWorldPropSpawn = config.onWorldPropSpawn || null;
    this.syncProjection = config.syncProjection || (() => false);
    this.clearProjectionBindings = config.clearProjectionBindings || (() => {});
    this.getReadyGate = config.getReadyGate || (() => null);
    this.onProjectionReady = config.onProjectionReady || (() => {});
    this.onSpawn = config.onSpawn || null;
    this.onRemove = config.onRemove || null;
    this.setDynamicCollider = config.setDynamicCollider || null;
    this.activeDynamicColliders = new Map();
    this.logger = config.logger || console;


    this.placements = [];
    this.pendingPlacementStates = new Map();
    this.pendingResourceNodeStates = new Map();
    this.disposed = false;
    this.spawner = new PlacementSpawner({
      entityFactory: config.entityFactory,
      entityStore: this.entityStore,
      aiSystem: this.aiSystem,
      assetManager: config.assetManager,
      onEntityImageError: config.onEntityImageError,
      onNpcImageError: config.onNpcImageError,
      shouldSpawn: ({ placement }) => this.shouldSpawn(placement),
      onSpawn: detail => this._handleSpawn(detail)
    });
  }

  setProjection(placements = []) {
    this.placements = Array.isArray(placements) ? placements : [];
    return this.placements;
  }

  getPlacements() {
    return this.placements;
  }

  /** 按 canonical placementId 查找当前 live 对象，覆盖 ECS、普通拾取物与装备掉落。 */
  findLivePlacementValue(placementId) {
    if (!placementId) return null;
    const id = String(placementId);
    for (const list of [this.entityStore.all, this.entityStore.pickups, this.entityStore.equipmentItems]) {
      const value = list.findLast(candidate => String(candidate?.placementId || candidate?.id || '') === id);
      if (value) return value;
    }
    return null;
  }

  /** 返回 live 世界坐标与当前只投影一次后的 placement 世界坐标是否一致。 */
  inspectPlacement(placementId, { epsilon = 0.001 } = {}) {
    const placement = this._findPlacement(placementId);
    const value = this.findLivePlacementValue(placementId);
    const actual = getRuntimePosition(value);
    const expected = placement && Number.isFinite(placement.x) && Number.isFinite(placement.y)
      ? { x: placement.x, y: placement.y }
      : null;
    const pendingState = this.pendingPlacementStates.get(placementId);
    const currentSignature = placement ? getPlacementSignature(placement) : null;
    return {
      placementId,
      placement,
      value,
      actual,
      expected,
      live: !!value,
      matchesProjection: positionsMatch(actual, expected, epsilon),
      spawned: this.spawner?.spawnedPlacementIds?.has?.(placementId) === true,
      tombstoned: pendingState?.removed === true
        && pendingState.placementSignature === currentSignature
    };
  }

  getPendingStateSnapshot() {
    return {
      resourceNodes: copyEntries([...this.pendingResourceNodeStates.entries()]),
      placementStates: copyEntries([...this.pendingPlacementStates.entries()])
    };
  }

  restorePendingStateSnapshot(snapshot = {}) {
    this.pendingResourceNodeStates = new Map(copyEntries(snapshot.resourceNodes || []));
    this.pendingPlacementStates = new Map(copyEntries(snapshot.placementStates || []));
    return { ok: true };
  }

  setPendingStates({ resourceNodes = [], placementStates = [] } = {}) {
    this.pendingResourceNodeStates = new Map(normalizeStateEntries(resourceNodes));
    this.pendingPlacementStates = new Map(normalizeStateEntries(placementStates));
    return this.getPendingStateSnapshot();
  }

  addPendingResourceNodeState(id, state) {
    if (!id || !state || typeof state !== 'object') return false;
    this.pendingResourceNodeStates.set(id, JSON.parse(JSON.stringify(state)));
    return true;
  }

  addPendingPlacementState(id, state) {
    if (!id || !state || typeof state !== 'object') return false;
    const nextState = JSON.parse(JSON.stringify(state));
    const placement = this._findPlacement(id);
    if (!nextState.placementSignature && placement) {
      nextState.placementSignature = getPlacementSignature(placement);
    }
    this.pendingPlacementStates.set(id, nextState);
    return true;
  }

  updatePendingResourceNodeStates(updater) {
    if (typeof updater !== 'function') return 0;
    let updated = 0;
    for (const [id, state] of this.pendingResourceNodeStates) {
      if (updater(state, id) === true) updated++;
    }
    return updated;
  }

  /**
   * 永久移除动态 placement，并保留与 canonical 定义绑定的 tombstone。
   * 该状态会参与流式快照；因此尸体等动态对象不会在重载后复活。
   */
  tombstonePlacement(placementId, state = {}) {
    if (this.disposed || !placementId) {
      return { ok: false, code: 'placementRuntimeUnavailable' };
    }
    const placement = this._findPlacement(placementId);
    if (!placement) return { ok: false, code: 'placementNotFound' };
    const previous = this.pendingPlacementStates.get(placementId);
    const tombstone = {
      ...state,
      kind: state.kind || 'placement',
      removed: true,
      placementSignature: getPlacementSignature(placement)
    };
    try {
      this.pendingPlacementStates.set(placementId, JSON.parse(JSON.stringify(tombstone)));
      const live = this.findLivePlacementValue(placementId);
      if (live) this._destroyValues([live]);
      return { ok: true, placementId, removed: !!live };
    } catch (error) {
      if (previous) this.pendingPlacementStates.set(placementId, previous);
      else this.pendingPlacementStates.delete(placementId);
      return { ok: false, code: 'placementTombstoneFailed', error };
    }
  }

  shouldSpawn(placement = {}) {
    if (this._isPlacementTombstoned(placement) || this._playerHoldsPlacementInstance(placement)) return false;
    const condition = placement.spawnWhen;
    if (!condition || typeof condition !== 'object') return true;
    let value = this.getConditionRoot(condition.blackboardKey || 'storyState');
    for (const segment of String(condition.path || '').split('.').filter(Boolean)) {
      value = value && typeof value === 'object' ? value[segment] : undefined;
    }
    if (condition.exists === true && value === undefined) return false;
    if (condition.exists === false && value !== undefined) return false;
    if (Object.prototype.hasOwnProperty.call(condition, 'equals') && value !== condition.equals) return false;
    if (Object.prototype.hasOwnProperty.call(condition, 'gte') && !(Number(value) >= Number(condition.gte))) return false;
    if (Object.prototype.hasOwnProperty.call(condition, 'lte') && !(Number(value) <= Number(condition.lte))) return false;
    if (Array.isArray(condition.in) && !condition.in.includes(value)) return false;
    return true;
  }

  /** @private 已拾取或已销毁的 placement 不得被流式恢复再次实例化。 */
  _isPlacementTombstoned(placement = {}) {
    if (!placement?.id) return false;
    const state = this.pendingPlacementStates.get(placement.id);
    if (state?.removed !== true || typeof state.placementSignature !== 'string') return false;
    const currentSignature = getPlacementSignature(placement);
    return state.placementSignature === currentSignature
      || signaturesDifferOnlyByCoordinates(state.placementSignature, currentSignature);
  }

  /** @private 稳定实例已进入玩家背包或装备栏时，拒绝重建其原始世界 placement。 */
  _playerHoldsPlacementInstance(placement = {}) {
    const instanceId = placement?.overrides?.instanceId;
    if (typeof instanceId !== 'string' || !instanceId.trim()) return false;
    const player = this.getPlayer();
    const inventory = player?.getComponent?.('inventory');
    if ((inventory?.slots || []).some(stack => stack?.item?.instanceId === instanceId)) return true;
    const equipment = player?.getComponent?.('equipment');
    const equipped = equipment?.getAllEquipment?.() || equipment?.slots || {};
    return Object.values(equipped).some(item => item?.instanceId === instanceId);
  }

  validateProjection() {
    const result = this.validatePlacementReferences(this.placements) || { ok: true, errors: [] };
    if (!result.ok) this.setValidationErrors(result.errors || []);
    return result;
  }

  async spawn(selector = {}) {
    if (!this._isActive()) return { ok: false, errors: [{ code: 'placementRuntimeDisposed', path: 'placements', message: '场景放置运行时已释放' }] };
    const scope = this.scope;
    try {
      await this.getWorldPromise();
    } catch (error) {
      if (this._isActive(scope)) this.logger.warn('[ScenePlacementRuntime] 世界尚未就绪，无法生成放置点', error);
      return { ok: false, errors: [{ code: 'placementWorldLoadFailed', path: 'placements', message: error?.message || String(error) }] };
    }
    if (!this._isActive(scope)) return { ok: false, errors: [{ code: 'placementRuntimeDisposed', path: 'placements', message: '场景放置运行时已释放' }] };

    const validation = this.validateProjection();
    if (!validation.ok) {
      this.logger.error('[ScenePlacementRuntime] 放置点引用校验失败', validation.errors);
      return { ok: false, errors: validation.errors || [] };
    }
    const result = this.spawner.spawnMatching({
      selector,
      placements: this.placements,
      registries: this.getRegistries()
    });
    for (const entry of result.errors) {
      if (entry.reason === 'definitionNotFound') {
        this.logger.warn('[ScenePlacementRuntime] 未找到放置定义', entry.kind, entry.ref);
      }
    }
    const colliderSync = this._syncDynamicColliders(result.entities);
    if (!colliderSync.ok) {
      this._destroyValues(result.entities, { removeDynamicColliders: false });
      this.spawner.forgetPlacements(result.entities.map(entity => entity?.placementId || entity?.id).filter(Boolean));
      return { ok: false, ...result, errors: [...result.errors, ...colliderSync.errors] };
    }
    this.logger.log('[ScenePlacementRuntime] spawn', {
      selector: result.selector,
      matched: result.matchedPlacements.map(placement => placement.id),
      counts: result.counts,
      outcomes: result.outcomes,
      skipped: result.skipped,
      errors: result.errors.length
    });
    return { ok: true, ...result };
  }

  spawnGroup(group) {
    const value = typeof group === 'object' ? group?.group : group;
    return this.spawn({ group: value });
  }

  /**
   * 让 spawner 忘记指定放置点已生成（不销毁实体）。
   * 用于补偿链路：实体已不在场景（被拾取后的重建/清理）而 spawner 仍拒绝重生成时，
   * 调用方 forget 后重新 spawn 即可恢复。
   */
  forgetSpawnedPlacements(ids = []) {
    if (!this.spawner || typeof this.spawner.forgetPlacements !== 'function') return 0;
    return this.spawner.forgetPlacements(Array.isArray(ids) ? ids : [ids]);
  }

  async spawnLoadedChunks() {
    const source = this.getLoadedChunks();
    const chunks = [...(source?.values?.() || source || [])]
      .filter(chunk => chunk?.sceneId && (chunk.placements || []).length > 0)
      .sort((a, b) => (a.row - b.row) || (a.col - b.col) || a.sceneId.localeCompare(b.sceneId));
    for (const chunk of chunks) {
      const result = await this.spawn({ sceneId: chunk.sceneId });
      if (result?.ok === false) return result;
    }
    return { ok: true, errors: [] };
  }


  loadProjection({ sceneId = null, consumePlayerSpawn = false } = {}) {
    const promise = this.getWorldPromise();
    if (!promise || typeof promise.then !== 'function') return Promise.resolve({ ok: false, errors: [] });
    const scope = this.scope;
    return promise.then(result => {
      if (!this._isActive(scope)) return { ok: false, errors: [] };
      if (!result?.region) this.logger.warn('[ScenePlacementRuntime] game.project.json 无 worldMap 配置');
      const targetSceneId = sceneId ?? result?.worldIndex?.getEntry?.()?.sceneId ?? this.getCurrentSceneId();
      this.syncProjection();
      this.applySpawnPoints({ sceneId: targetSceneId, applyPlayer: consumePlayerSpawn });
      this.getReadyGate()?.resolve?.('placements', this.placements);
      this.onProjectionReady();
      return { ok: true, placements: this.placements };
    }).catch(error => {
      if (!this._isActive(scope)) return { ok: false, errors: [] };
      this.logger.warn('[ScenePlacementRuntime] 加载 game.project.json 失败:', error);
      this.setProjection([]);
      this.clearProjectionBindings();
      this.applySpawnPoints({ sceneId: sceneId ?? this.getCurrentSceneId(), applyPlayer: consumePlayerSpawn });
      this.getReadyGate()?.resolve?.('placements', this.placements);
      this.onProjectionReady();
      return { ok: false, errors: [{ code: 'placementProjectionFailed', path: 'placements', message: error?.message || String(error) }] };
    });
  }

  applySpawnPoints({ sceneId = this.getCurrentSceneId(), applyPlayer = false } = {}) {
    const scenePlacements = this.placements.filter(placement => placement.sceneId === sceneId);

    let playerMoved = false;
    if (applyPlayer) {
      const playerSpawn = scenePlacements.find(placement => placement.type === 'spawn'
        && (placement.ref === 'player' || placement.kind === 'player'));
      const transform = this.getPlayer()?.getComponent?.('transform');
      if (playerSpawn && transform) {
        transform.position.x = playerSpawn.x;
        transform.position.y = playerSpawn.y;
        this.getCamera()?.setPosition?.(playerSpawn.x, playerSpawn.y);
        this.consumeInitialPlayerSpawn(playerSpawn);
        playerMoved = true;
      } else {
        this.logger.error(`[ScenePlacementRuntime] 新游戏缺少 canonical 玩家出生点: ${sceneId}`);
      }
    }
    this.logger.log('[ScenePlacementRuntime] 场景放置点', {
      total: this.placements.length,
      sceneId,
      playerStartMode: this.getPlayerStartMode(),
      playerMoved,
      player: this.getPlayer()?.getComponent?.('transform')?.position
    });
    return { playerMoved };
  }

  getSpawnPoint(sceneId, ref = 'player') {
    return this.placements.find(placement => placement.sceneId === sceneId
      && placement.type === 'spawn'
      && (placement.ref === ref || (ref === 'player' && placement.kind === 'player'))) || null;
  }

  /**
   * 原子重建指定场景的放置实体（保留旧实体 → 生成并验证完整草稿 → 提交销毁旧实体）。
   * @param {string} sceneId 目标场景
   * @param {Object} [options]
   * @param {string[]|null} [options.placementIds=null] 只重建这些放置点（编辑器热同步用）；
   *   为 null 时重建该场景全部 type==='ref' 放置点。
   * @param {string[]} [options.retiredPlacementIds=[]] 已从 canonical 数据删除、只需销毁的旧放置点。
   * @param {boolean} [options.deferFinalize=false] 保留旧对象到外层事务 finalize，并返回 rollback/finalize 句柄。
   */
  rebuild(sceneId = this.getCurrentSceneId(), {
    placementIds: placementIdSelection = null,
    retiredPlacementIds = [],
    deferFinalize = false
  } = {}) {
    if (this.disposed || !this.spawner || !this.entityStore) {
      return { ok: false, errors: [{ code: 'placementRuntimeUnavailable', path: 'placementStates', message: '场景放置运行时尚未就绪' }] };
    }
    const selection = Array.isArray(placementIdSelection) ? new Set(placementIdSelection.filter(Boolean)) : null;
    const retiredIds = new Set((retiredPlacementIds || []).filter(Boolean));
    const activePlacements = this.placements.filter(placement => (
      placement?.type === 'ref'
      && placement.sceneId === sceneId
      && placement.id
      && (!selection || selection.has(placement.id))
    ));
    const activeIds = new Set(activePlacements.map(placement => placement.id));
    const projectedSceneIds = new Set(this.placements
      .filter(placement => placement?.sceneId === sceneId && placement.id)
      .map(placement => placement.id));
    const missingIds = selection
      ? [...selection].filter(id => !projectedSceneIds.has(id) && !retiredIds.has(id))
      : [];
    if (missingIds.length > 0) {
      return {
        ok: false,
        errors: missingIds.map(id => ({
          code: 'placementNotFound',
          path: `placementStates.${id}`,
          message: `当前投影中不存在放置点: ${id}`
        }))
      };
    }

    const placementIds = new Set([...retiredIds, ...activeIds]);
    if (placementIds.size === 0) {
      return {
        ok: true,
        errors: [],
        counts: { item: 0, equipment: 0, enemy: 0, npc: 0, building: 0, vehicle: 0, resourceNode: 0, total: 0 },
        outcomes: [],
        skipped: []
      };
    }

    const oldValues = new Set([
      ...this.entityStore.all,
      ...this.entityStore.pickups,
      ...this.entityStore.equipmentItems
    ].filter(value => placementIds.has(value?.placementId || value?.id)));
    const previouslySpawnedIds = [...placementIds]
      .filter(id => this.spawner.spawnedPlacementIds.has(id));
    const oldAiStates = [];
    const aiCaptureErrors = [];
    for (const value of oldValues) {
      if (!(value?.type === 'enemy' || value?.isAI || value?.aiType)) continue;
      try {
        const state = this.aiSystem?.getRuntimeState?.(value) || null;
        if (this.aiSystem && !state) {
          throw new Error(`AI 运行态不可用: ${value?.id || 'unknown'}`);
        }
        oldAiStates.push({ value, state });
      } catch (error) {
        aiCaptureErrors.push({
          code: 'placementRebuildAiCaptureFailed',
          path: `placementStates.${value?.placementId || value?.id || sceneId}`,
          message: error?.message || '捕获 AI 重建快照失败'
        });
      }
    }
    if (aiCaptureErrors.length > 0) return { ok: false, errors: aiCaptureErrors };

    const pendingBefore = this.getPendingStateSnapshot();
    const pendingStateBefore = new Map(pendingBefore.placementStates);
    const terminalCaptureErrors = [];
    for (const value of oldValues) {
      const placementId = value?.placementId || value?.id;
      if (!placementId || !activeIds.has(placementId)
        || pendingStateBefore.has(placementId) || value?.isCorpse !== true) continue;
      try {
        const captured = this.corpseRuntime?.capture?.(value);
        const placement = activePlacements.find(entry => entry.id === placementId)
          || this._findPlacement(placementId);
        if (!captured || !placement) {
          throw new Error(`尸体放置状态不可用: ${placementId}`);
        }
        const state = {
          ...captured,
          placementSignature: getPlacementSignature(placement)
        };
        pendingStateBefore.set(placementId, state);
        this.pendingPlacementStates.set(placementId, JSON.parse(JSON.stringify(state)));
      } catch (error) {
        terminalCaptureErrors.push({
          code: 'placementRebuildTerminalCaptureFailed',
          path: `placementStates.${placementId}`,
          message: error?.message || '捕获 terminal placement 状态失败'
        });
      }
    }
    if (terminalCaptureErrors.length > 0) {
      this.restorePendingStateSnapshot(pendingBefore);
      return { ok: false, errors: terminalCaptureErrors };
    }

    const acceptedStateById = new Map();
    const restoreOldState = (newEntities = []) => {
      this._destroyValues(newEntities, { removeDynamicColliders: false });
      const aiRestore = this._restoreAIStates(oldAiStates);
      this.restorePendingStateSnapshot(pendingBefore);
      this.spawner.forgetPlacements(placementIds);
      this.spawner.rememberPlacements(previouslySpawnedIds);
      return aiRestore;
    };
    const withRollbackErrors = (errors, rollback) => {
      if (rollback?.ok !== false) return errors;
      return [
        ...errors,
        ...(rollback.errors || []).map((entry, index) => ({
          code: entry.code || 'placementRebuildRollbackFailed',
          path: entry.path || `placementStates.${sceneId}.rollback.${index}`,
          message: entry.message || '放置对象重建回滚失败'
        }))
      ];
    };

    let result;
    try {
      for (const entry of oldAiStates) this.aiSystem?.unregisterAI?.(entry.value);
      this.spawner.forgetPlacements(placementIds);
      result = this.spawner.spawnMatching({
        selector: { placementIds: [...placementIds] },
        placements: this.placements,
        registries: this.getRegistries()
      });
    } catch (error) {
      const rollback = restoreOldState(result?.entities || []);
      return {
        ok: false,
        errors: withRollbackErrors([{
          code: 'placementRebuildFailed',
          path: `placementStates.${sceneId}`,
          message: error?.message || '放置对象重建异常'
        }], rollback)
      };
    }
    if (result.errors.length > 0) {
      const rollback = restoreOldState(result.entities);
      const errors = result.errors.map((entry, index) => ({
        code: entry.reason || 'placementRestoreFailed',
        path: `placementStates.${entry.placement?.id || index}`,
        message: `放置对象重建失败: ${entry.ref || entry.placement?.id || index}`
      }));
      return {
        ok: false,
        outcomes: result.outcomes || [],
        errors: withRollbackErrors(errors, rollback)
      };
    }

    const outcomesById = new Map();
    for (const outcome of result.outcomes || []) {
      if (!outcomesById.has(outcome.placementId)) outcomesById.set(outcome.placementId, []);
      outcomesById.get(outcome.placementId).push(outcome);
    }
    const outcomeErrors = [];
    for (const placement of activePlacements) {
      const outcomes = outcomesById.get(placement.id) || [];
      const spawnedOutcome = outcomes.find(outcome => outcome.status === 'spawned');
      const conditionOutcome = outcomes.find(outcome => outcome.status === 'conditionFalse');
      if (!spawnedOutcome && conditionOutcome) {
        acceptedStateById.set(placement.id, { conditionFalse: true });
        continue;
      }
      if (!spawnedOutcome) {
        const status = outcomes.map(outcome => outcome.status).join(',') || 'missingOutcome';
        outcomeErrors.push({
          code: 'placementRebuildNotSpawned',
          path: `placementStates.${placement.id}`,
          message: `放置对象应重建但未生成: ${placement.id} (${status})`
        });
        continue;
      }

      const spawnedEntity = result.entities.findLast(value => (
        (value?.placementId || value?.id) === placement.id
      ));
      if (!spawnedEntity) {
        outcomeErrors.push({
          code: 'placementRebuildEntityMissing',
          path: `placementStates.${placement.id}`,
          message: `放置对象生成结果缺少实体: ${placement.id}`
        });
        continue;
      }

      const currentSignature = getPlacementSignature(placement);
      const stateBefore = pendingStateBefore.get(placement.id);
      const retainedAcrossCoordinateChange = !!stateBefore
        && (stateBefore.removed === true || stateBefore.kind === 'corpse')
        && signaturesDifferOnlyByCoordinates(stateBefore.placementSignature, currentSignature);
      const retainedCurrentState = stateBefore?.placementSignature === currentSignature
        || retainedAcrossCoordinateChange;
      const currentPending = this.pendingPlacementStates.get(placement.id);
      const tombstoned = !this._containsValue(spawnedEntity)
        && currentPending?.removed === true
        && currentPending.placementSignature === currentSignature;
      const restoredDynamicState = retainedCurrentState
        && Number.isFinite(stateBefore?.position?.x)
        && Number.isFinite(stateBefore?.position?.y);

      if (!this._containsValue(spawnedEntity) && !tombstoned) {
        outcomeErrors.push({
          code: 'placementRebuildEntityDetached',
          path: `placementStates.${placement.id}`,
          message: `放置对象生成后未注册到场景: ${placement.id}`
        });
        continue;
      }
      if (this._containsValue(spawnedEntity)
        && !restoredDynamicState
        && !positionsMatch(getRuntimePosition(spawnedEntity), { x: placement.x, y: placement.y })) {
        const actual = getRuntimePosition(spawnedEntity);
        outcomeErrors.push({
          code: 'placementRebuildCoordinateMismatch',
          path: `placementStates.${placement.id}`,
          message: `放置对象未使用最新投影坐标: ${placement.id} actual=(${actual?.x},${actual?.y}) expected=(${placement.x},${placement.y})`
        });
        continue;
      }
      acceptedStateById.set(placement.id, { tombstoned, restoredDynamicState });
    }
    if (outcomeErrors.length > 0) {
      const rollback = restoreOldState(result.entities);
      return {
        ok: false,
        outcomes: result.outcomes || [],
        errors: withRollbackErrors(outcomeErrors, rollback)
      };
    }

    const dynamicColliderPreparation = this._prepareDynamicColliderOperations(result.entities);
    if (!dynamicColliderPreparation.ok) {
      const rollback = restoreOldState(result.entities);
      return {
        ok: false,
        outcomes: result.outcomes || [],
        errors: withRollbackErrors(dynamicColliderPreparation.errors, rollback)
      };
    }

    const buildOutcomes = () => {
      const outcomes = (result.outcomes || []).map(outcome => {
        const inspection = this.inspectPlacement(outcome.placementId);
        const acceptedState = acceptedStateById.get(outcome.placementId) || {};
        const conditionFalse = outcome.status === 'conditionFalse';
        return {
          ...outcome,
          live: conditionFalse ? false : inspection.live,
          actual: conditionFalse ? null : inspection.actual,
          expected: inspection.expected,
          matchesProjection: conditionFalse ? false : inspection.matchesProjection,
          tombstoned: acceptedState.tombstoned === true || inspection.tombstoned,
          restoredDynamicState: acceptedState.restoredDynamicState === true
        };
      });
      for (const id of retiredIds) {
        outcomes.push({
          placementId: id,
          kind: null,
          ref: null,
          status: 'retired',
          live: false,
          actual: null,
          expected: null,
          matchesProjection: false,
          tombstoned: false,
          restoredDynamicState: false
        });
      }
      return outcomes;
    };
    const outcomes = buildOutcomes();
    const skipped = outcomes.filter(outcome => (
      outcome.status === 'alreadySpawned' || outcome.status === 'conditionFalse'
    ));
    let settlement = 'pending';
    const rollback = () => {
      if (settlement === 'rolledBack') return { ok: true, idempotent: true };
      if (settlement !== 'pending') {
        return {
          ok: false,
          superseded: true,
          errors: [{
            code: 'placementRebuildAlreadyFinalized',
            path: `placementStates.${sceneId}`,
            message: '放置对象重建已经完成，不能再回滚'
          }]
        };
      }
      const restored = restoreOldState(result.entities);
      settlement = restored?.ok === false ? 'rollbackFailed' : 'rolledBack';
      return restored?.ok === false ? restored : { ok: true, errors: [] };
    };
    const finalize = () => {
      if (settlement === 'finalized') return { ok: true, idempotent: true };
      if (settlement !== 'pending') {
        return {
          ok: false,
          superseded: true,
          errors: [{
            code: 'placementRebuildAlreadyRolledBack',
            path: `placementStates.${sceneId}`,
            message: '放置对象重建已经回滚，不能再提交'
          }]
        };
      }
      try {
        // 新旧实体使用同一稳定 ID；旧 AI 已在 prepare 时注销，不能在此误删新 AI controller。
        this._destroyValues(oldValues, { unregisterAI: false });
        const colliderCommit = this._commitDynamicColliderOperations(dynamicColliderPreparation.operations);
        if (!colliderCommit.ok) {
          throw new Error(colliderCommit.errors.map(entry => entry.message).join('; ') || '动态碰撞体提交失败');
        }
        for (const id of retiredIds) {
          this.pendingPlacementStates.delete(id);
          this.pendingResourceNodeStates.delete(id);
        }
        settlement = 'finalized';
        return { ok: true, errors: [] };
      } catch (error) {
        return {
          ok: false,
          errors: [{
            code: 'placementRebuildCommitFailed',
            path: `placementStates.${sceneId}`,
            message: error?.message || '放置对象重建提交失败'
          }]
        };
      }
    };
    const prepared = {
      ok: true,
      errors: [],
      counts: result.counts,
      outcomes,
      skipped
    };
    if (deferFinalize === true) {
      return { ...prepared, deferred: true, rollback, finalize };
    }
    const finalized = finalize();
    if (finalized.ok === true) return prepared;
    const restored = rollback();
    return {
      ok: false,
      outcomes,
      errors: withRollbackErrors(finalized.errors || [], restored)
    };
  }

  applyPendingToExisting(values = []) {
    for (const value of values) {
      const placementId = value?.placementId || value?.id;
      this.applyPendingPlacementState(value, this._findPlacement(placementId) || { id: placementId });
      this.applyPendingResourceNodeState(value);
    }
  }

  applyPendingPlacementState(value, placement = {}) {
    const placementId = placement?.id || value?.placementId || value?.id;
    let state = this.pendingPlacementStates.get(placementId);
    if (!placementId || !state) return false;
    const currentPlacement = placement?.id === placementId && placement?.type
      ? placement
      : this._findPlacement(placementId);
    if (!currentPlacement) return false;
    const currentSignature = getPlacementSignature(currentPlacement);
    if (state.placementSignature !== currentSignature) {
      const terminalState = state.removed === true || state.kind === 'corpse';
      const retainTerminalState = terminalState
        && typeof state.placementSignature === 'string'
        && signaturesDifferOnlyByCoordinates(state.placementSignature, currentSignature);
      if (!retainTerminalState) {
        this.pendingPlacementStates.delete(placementId);
        return false;
      }
      state = { ...state, placementSignature: currentSignature };
      this.pendingPlacementStates.set(placementId, state);
    }
    const shouldRestoreCorpse = (state.kind === 'corpse' && state.removed !== true)
      || (state.kind === 'enemy' && state.removed === true);
    if (shouldRestoreCorpse && this.corpseRuntime?.retain?.(value, state) === true) {
      this.pendingPlacementStates.delete(placementId);
      return false;
    }
    if (state.removed === true) {
      value.picked = state.kind === 'item' || value.picked === true;
      value.isDead = state.kind === 'enemy' || value.isDead === true;
      value.isDying = state.kind === 'enemy' || value.isDying === true;
      this._destroyValues([value]);
      return true;
    }
    if (state.kind === 'item' && Number.isFinite(state.quantity)) {
      value.quantity = Math.max(0, Math.floor(state.quantity));
    }
    const stats = value?.getComponent?.('stats');
    const transform = value?.getComponent?.('transform');
    if (stats && Number.isFinite(state.hp)) {
      const maxHp = Number.isFinite(Number(stats.maxHp)) ? Number(stats.maxHp) : Number(state.hp);
      stats.hp = Math.min(maxHp, Math.max(0, Number(state.hp)));
    }
    if (transform && Number.isFinite(state.position?.x) && Number.isFinite(state.position?.y)) {
      transform.position.x = state.position.x;
      transform.position.y = state.position.y;
    }
    if (state.kind === 'enemy' && state.ai) this.aiSystem?.restoreRuntimeState?.(value, state.ai);
    this.pendingPlacementStates.delete(placementId);
    return false;
  }

  applyPendingResourceNodeState(entity) {
    const node = entity?.getComponent?.('resourceNode');
    const state = this.pendingResourceNodeStates.get(entity?.id);
    if (!node || !state) return false;
    node.deserialize(state);
    this.pendingResourceNodeStates.delete(entity.id);
    return true;
  }

  _findPlacement(placementId) {
    if (!placementId) return null;
    return this.placements.find(placement => placement?.id === placementId) || null;
  }

  _containsValue(value) {
    return !!value && (
      this.entityStore.all.includes(value)
      || this.entityStore.pickups.includes(value)
      || this.entityStore.equipmentItems.includes(value)
    );
  }


  forgetPlacements(ids = []) {
    return this.spawner.forgetPlacements(ids);
  }

  reset({ clearProjection = true, clearPending = true, clearSpawned = false } = {}) {
    if (clearProjection) this.placements = [];
    if (clearPending) {
      this.pendingPlacementStates.clear();
      this.pendingResourceNodeStates.clear();
    }
    if (clearSpawned) this.spawner.spawnedPlacementIds.clear();
  }

  dispose() {
    if (this.disposed) return false;
    this._clearDynamicColliders();
    this.disposed = true;
    this.reset({ clearProjection: true, clearPending: true, clearSpawned: true });
    return true;
  }

  _prepareDynamicColliderOperations(entities = []) {
    const operations = [];
    const errors = [];
    for (const entity of entities) {
      if (!this._containsValue(entity)) continue;
      const placementId = entity?.placementId || entity?.id;
      const placement = this._findPlacement(placementId);
      const collision = placement?.collision;
      if (!collision) continue;
      if (collision.mode !== 'block' && collision.mode !== 'walkable') {
        errors.push({
          code: 'placementColliderModeInvalid',
          path: `placements.${placementId}.collision.mode`,
          message: `放置碰撞模式必须为 block 或 walkable: ${placementId}`
        });
        continue;
      }
      if (collision.shapeType !== 'polygon' || !Array.isArray(collision.points) || collision.points.length < 3) {
        errors.push({
          code: 'placementColliderShapeInvalid',
          path: `placements.${placementId}.collision`,
          message: `放置碰撞必须是至少三个顶点的 polygon: ${placementId}`
        });
        continue;
      }
      const localX = Number.isFinite(placement._localX) ? placement._localX : placement.x;
      const localY = Number.isFinite(placement._localY) ? placement._localY : placement.y;
      if (!Number.isFinite(localX) || !Number.isFinite(localY)
        || collision.points.some(point => !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
        errors.push({
          code: 'placementColliderCoordinatesInvalid',
          path: `placements.${placementId}.collision.points`,
          message: `放置碰撞顶点和锚点必须是有限数值: ${placementId}`
        });
        continue;
      }
      operations.push({
        id: placementId,
        sceneId: placement.sceneId,
        mode: collision.mode,
        shape: {
          id: placementId,
          type: 'shape',
          shapeType: 'polygon',
          points: collision.points.map(point => [localX + point[0], localY + point[1]])
        }
      });
    }
    return { ok: errors.length === 0, operations, errors };
  }

  _syncDynamicColliders(entities = []) {
    const prepared = this._prepareDynamicColliderOperations(entities);
    if (!prepared.ok) return prepared;
    return this._commitDynamicColliderOperations(prepared.operations);
  }

  _commitDynamicColliderOperations(operations = []) {
    if (operations.length === 0) return { ok: true, errors: [] };
    if (typeof this.setDynamicCollider !== 'function') {
      return {
        ok: false,
        errors: [{
          code: 'placementColliderBindingUnavailable',
          path: 'placements',
          message: '放置碰撞已配置，但 TerrainBinding 未提供动态碰撞注册器'
        }]
      };
    }
    const committed = [];
    for (const operation of operations) {
      try {
        if (this.setDynamicCollider({ ...operation, enabled: true }) !== true) {
          throw new Error(`未找到已加载 terrain: ${operation.sceneId || operation.id}`);
        }
        this.activeDynamicColliders.set(operation.id, { sceneId: operation.sceneId });
        committed.push(operation);
      } catch (error) {
        for (const rollback of committed.reverse()) {
          try {
            this.setDynamicCollider({ sceneId: rollback.sceneId, id: rollback.id, enabled: false });
          } catch (rollbackError) {
            this.logger.warn('[ScenePlacementRuntime] 回滚动态碰撞体失败', rollbackError);
          }
          this.activeDynamicColliders.delete(rollback.id);
        }
        return {
          ok: false,
          errors: [{
            code: 'placementColliderCommitFailed',
            path: `placements.${operation.id}.collision`,
            message: error?.message || `注册放置碰撞失败: ${operation.id}`
          }]
        };
      }
    }
    return { ok: true, errors: [] };
  }

  _removeDynamicCollider(placementId) {
    const active = this.activeDynamicColliders.get(placementId);
    if (!active) return true;
    try {
      if (this.setDynamicCollider?.({ sceneId: active.sceneId, id: placementId, enabled: false }) !== true) return false;
      this.activeDynamicColliders.delete(placementId);
      return true;
    } catch (error) {
      this.logger.warn('[ScenePlacementRuntime] 移除动态碰撞体失败', error);
      return false;
    }
  }

  _clearDynamicColliders() {
    for (const placementId of [...this.activeDynamicColliders.keys()]) {
      this._removeDynamicCollider(placementId);
    }
  }

  _handleSpawn(detail) {
    if (this.applyPendingPlacementState(detail.entity, detail.placement)) return;
    this.applyPendingResourceNodeState(detail.entity);
    if (detail.kind === 'item' && detail.definition?.worldProp === true) this.onWorldPropSpawn?.(detail);
    this.onSpawn?.(detail);
  }

  _destroyValues(values = [], { unregisterAI = true, removeDynamicColliders = true } = {}) {
    const unique = new Set(values || []);
    if (unique.size === 0) return [];
    if (removeDynamicColliders) {
      for (const value of unique) {
        const placementId = value?.placementId || value?.id;
        if (placementId) this._removeDynamicCollider(placementId);
      }
    }
    if (unregisterAI) {
      for (const value of unique) {
        try { this.aiSystem?.unregisterAI?.(value); } catch (error) {
          this.logger.warn('[ScenePlacementRuntime] 注销重建实体 AI 失败', error);
        }
      }
    }
    const removed = this.entityStore.removeMany(unique);
    try { this.onRemove?.(unique); } catch (error) {
      this.logger.warn('[ScenePlacementRuntime] 重建实体移除回调失败', error);
    }
    for (const value of unique) {
      try { value?.destroy?.(); } catch (error) { /* best-effort runtime cleanup */ }
    }
    return removed;
  }

  _restoreAIStates(entries = []) {
    const errors = [];
    for (const { value, state } of entries) {
      if (!state || !this.aiSystem) continue;
      try {
        const restored = this.aiSystem.restoreRuntimeState?.(value, state);
        if (restored === false) {
          errors.push({
            code: 'placementRebuildAiRollbackFailed',
            path: `placementStates.${value?.placementId || value?.id || 'unknown'}`,
            message: `恢复 AI 重建快照失败: ${value?.id || 'unknown'}`
          });
        }
      } catch (error) {
        errors.push({
          code: 'placementRebuildAiRollbackFailed',
          path: `placementStates.${value?.placementId || value?.id || 'unknown'}`,
          message: error?.message || `恢复 AI 重建快照失败: ${value?.id || 'unknown'}`
        });
      }
    }
    if (errors.length > 0) {
      this.logger.warn('[ScenePlacementRuntime] 恢复 AI 重建快照失败', errors);
    }
    return { ok: errors.length === 0, errors };
  }

  _isActive(scope = this.scope) {
    return !this.disposed && (!scope || (!scope.disposed && scope === this.scope));
  }
}

export default ScenePlacementRuntime;
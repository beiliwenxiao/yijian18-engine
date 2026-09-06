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

 ************************************************************

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { CanonicalSceneRepository } from '../../../src/core/scene/CanonicalSceneRepository.js';
import { FetchDiskSceneAdapter } from '../../../src/core/scene/CanonicalSceneAdapters.js';
import { WorldMapLoadSession } from '../../../src/core/scene/WorldMapLoadSession.js';
import { SceneCampfireService } from '../../../src/core/scene/SceneCampfireService.js';
import { getPlacementSignature } from '../../../src/core/scene/ScenePlacementRuntime.js';
import { WeatherSystem } from '../../../src/systems/WeatherSystem.js';
import { TimeSystem } from '../../../src/systems/TimeSystem.js';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * 《三国张角传》的流式动态状态与跨 Region 编排。
 * core 只拥有 WorldStreamingManager/RegionCoordinator 的通用事务；此类持有 S01–S14
 * 的 DeathDrop、S10 工事、载具和运行时投影适配，不创建第二份 streaming 状态。
 */
export class SanguoWorldRuntimeCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, {
      findRegionIndexForScene,
      prepareRestoreRegion,
      validateWorldLoadResult,
      createWorldLoadSession,
      createStreamingStateProvider,
      captureStreamedChunkState,
      releaseStreamedChunkRuntime,
      restoreStreamedDomainState,
      prepareWorldStreamingManager,
      initializeWorldStreaming,
      syncWorldStreamingProjection,
      enterStreamedScene,
      validateRegionTarget,
      extractRegionDynamicState,
      clearRegionRuntime,
      commitRegionTarget,
      restoreRegionDraft,
      getSceneVehicleDefinitions,
      ensureSceneVehicleEntities,
      disposeSceneVehicles,
      disposeAllSceneVehicles,
      resolveVehicleInventoryOwnerId,
      captureSceneVehicleStates,
      validateSceneVehicleStates,
      restoreSceneVehicleStates,
      configureWorldRuntimeFromLoad,
      getDeathDropPresentation,
      forwardCommittedSceneEnter
    }, { name: 'SanguoWorldRuntimeCoordinator' });
  }
}

/** 由已验证的 ProjectWorldIndex 解析场景所属 Region；无有效映射返回 -1。 */
function findRegionIndexForScene(sceneId) {
  return this._worldLoadResult?.worldIndex?.findScene?.(sceneId)?.regionIndex ?? -1;
}

/** 跨 Region 存档恢复的预准备；真正同步 restore 仍由 BaseGameScene 原子阶段执行。 */
async function prepareRestoreRegion(saveState = {}) {
  const sceneId = saveState?.currentSceneId;
  const regionIndex = this.findRegionIndexForScene(sceneId);
  if (regionIndex < 0) {
    return { ok: false, errors: [{ code: 'missingTargetScene', path: 'currentSceneId', message: `存档场景 ${sceneId} 不在世界地图中` }] };
  }
  if (regionIndex === this._currentRegionIndex) return { ok: true, errors: [] };
  return this._regionCoordinator.switchTo({
    projectUrl: 'game.project.json', regionIndex, sceneId, spawnRef: 'player'
  });
}

/** 项目世界加载的启动闸门；仅校验 canonical 入口及预加载场景，不参与 Scene 转场时机。 */
function validateWorldLoadResult(result) {
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const worldIndex = result?.worldIndex;
  const entry = worldIndex?.getEntry?.();
  const chunk = entry ? result?.chunks?.find(item => item.sceneId === entry.sceneId) : null;
  const valid = errors.length === 0
    && result?.region
    && entry?.loadable === true
    && worldIndex?.isLoadable?.(entry.sceneId) === true
    && chunk?.row === entry.row
    && chunk?.col === entry.col
    && chunk?.offset === entry.offset
    && Array.isArray(chunk?.sceneData?.layers);
  if (!valid) {
    const detail = errors[0]?.message || '显式入口必须是唯一、非 reserved 且具有有效场景 layers';
    throw new Error(`世界内容校验失败: ${detail}`);
  }
  return result;
}

/** 张角 Demo 只读取磁盘 canonical 场景；读取或解析失败直接拒绝。 */
function createWorldLoadSession(scope = this.resourceScope) {
  const repository = new CanonicalSceneRepository({
    diskAdapter: new FetchDiskSceneAdapter({
      projectUrl: 'game.project.json',
      sceneBaseUrl: 'assets/scenes/'
    }),
    mode: 'runtime'
  });
  return new WorldMapLoadSession({ scope, repository });
}

/** 载具定义与运行态以当前 SceneVehicleRuntime 为唯一 store；此处只负责 Demo 世界编排。 */
function getSceneVehicleDefinitions(sceneId = this.currentSceneId) {
  return this._sceneVehicleRuntime.getDefinitions(sceneId);
}

function ensureSceneVehicleEntities(sceneId = this.currentSceneId) {
  return this._sceneVehicleRuntime.ensure(sceneId);
}

function disposeSceneVehicles(sceneId, definitionId = null) {
  return this._sceneVehicleRuntime.disposeScene(sceneId, definitionId);
}

function disposeAllSceneVehicles() {
  return this._sceneVehicleRuntime.disposeAll();
}

function resolveVehicleInventoryOwnerId(inventory) {
  return this._sceneVehicleRuntime.resolveInventoryOwnerId(inventory);
}

function captureSceneVehicleStates(sceneId = this.currentSceneId) {
  return this._sceneVehicleRuntime.capture(sceneId);
}

function validateSceneVehicleStates(sceneId, states, logisticsState = null) {
  return this._sceneVehicleRuntime.validate(sceneId, states, logisticsState);
}

function restoreSceneVehicleStates(sceneId, states = [], logisticsState = null) {
  return this._sceneVehicleRuntime.restore(sceneId, states, logisticsState);
}

function findSceneCampfireDefinition(sceneData = {}, registries = {}) {
  const itemRegistry = registries?.items;
  const getItem = id => typeof itemRegistry?.get === 'function' ? itemRegistry.get(id) : itemRegistry?.[id];
  for (const layer of sceneData.layers || []) {
    for (const placement of layer.objects || []) {
      if (placement?.type !== 'ref' || placement.kind !== 'item' || !placement.ref) continue;
      const definition = getItem(placement.ref);
      if (definition?.worldProp === true && definition.semanticRole === 'campfire') return definition;
    }
  }
  return null;
}

/** 世界投影完成后的历史配置消费者；仅替换已完整解析并验证的运行时实例。 */
async function configureWorldRuntimeFromLoad() {
  // 必须等待 GameLoader 完全就绪后才能访问配置消费者
  if (this._gameLoaderReady) {
    await this._gameLoaderReady;
  }
  const weatherView = this.gameLoader?.getConfigConsumer?.('runtime.weather');
  const weatherConfig = weatherView?.get('system.weather');
  if (!weatherConfig) throw new Error('runtime weather consumer missing');
  const nextWeatherSystem = new WeatherSystem(weatherConfig);
  const fogImageIds = nextWeatherSystem.getFogImageIds();
  const fogImages = await Promise.all(fogImageIds.map(imageId =>
    this.assetManager.loadAsset(imageId, { mode: '2d', required: true })
  ));
  nextWeatherSystem.setFogImages(fogImages);
  const nextTimeSystem = new TimeSystem(this.gameLoader?.runtimeConfigSnapshot?.system?.time || {});
  const sceneData = this._worldLoadSession?.getSceneData?.(this.currentSceneId);
  const campfireDefinition = findSceneCampfireDefinition(sceneData, this.gameLoader?.registries);
  const campfireConfig = campfireDefinition?.campfirePresentation || null;
  if (campfireConfig) {
    const validationService = new SceneCampfireService({ configView: campfireConfig });
    validationService.dispose();
  }
  this.weatherSystem = nextWeatherSystem;
  this.timeSystem = nextTimeSystem;
  this._sceneConsumptionSnapshot = null;
  if (campfireConfig) {
    this._campfireService.configure(campfireConfig);
    const imageIds = this._campfireService.getPresentationImageIds();
    const layerImages = Object.fromEntries(await Promise.all(Object.entries(imageIds).map(async ([layer, imageId]) => [
      layer,
      await this.assetManager.loadAsset(imageId, { required: true })
    ])));
    this._campfireService.setPresentationImages(layerImages);
  } else {
    this._campfireService.dispose();
  }
}

async function forwardCommittedSceneEnter(sceneId) {
  const triggerSystem = this.gameLoader?.triggerSystem;
  if (!sceneId || typeof triggerSystem?.fireAndWait !== 'function') return false;
  const result = await triggerSystem.fireAndWait('sceneEnter', { sceneId });
  if (!result.ok) {
    console.warn(`[SanguoWorldRuntimeCoordinator] sceneEnter 触发器执行失败: ${sceneId}`, result.records);
  }
  return result.ok;
}

function getDeathDropPresentation() {
  return {
    imageId: 'world.loot.deathDrop',
    assetId: 'world.loot.deathDrop',
    width: 48,
    height: 40,
    name: '遗失物资'
  };
}

function createStreamingStateProvider() {
  return {
    capture: context => this.captureStreamedChunkState(context.chunk),
    validate: (data, context = {}) => {
      const errors = [];
      if (!data || data.schemaVersion !== 2) {
        errors.push({ code: 'invalidDemoChunkState', path: 'schemaVersion', message: 'Demo chunk 动态状态版本无效' });
        return { ok: false, errors };
      }
      if (data.sceneNamespace !== context.sceneNamespace) {
        errors.push({ code: 'demoChunkNamespaceMismatch', path: 'sceneNamespace', message: 'Demo chunk 业务命名空间不一致' });
      }
      for (const field of ['resourceNodes', 'placementStates', 'deathDrops', 's10StructureStates', 'vehicleStates']) {
        if (!Array.isArray(data[field])) {
          errors.push({ code: 'invalidDemoChunkField', path: field, message: `${field} 必须是数组` });
        }
      }
      for (const [index, entry] of (data.resourceNodes || []).entries()) {
        if (!entry?.id || !entry.state || typeof entry.state !== 'object') {
          errors.push({ code: 'invalidResourceNodeState', path: `resourceNodes[${index}]`, message: '资源节点状态无效' });
        }
      }
      for (const [index, entry] of (data.placementStates || []).entries()) {
        if (!entry?.id || !entry.state || typeof entry.state !== 'object') {
          errors.push({ code: 'invalidPlacementState', path: `placementStates[${index}]`, message: '放置点状态无效' });
          continue;
        }
        if (typeof entry.state.placementSignature !== 'string' || entry.state.placementSignature.length === 0) {
          errors.push({
            code: 'missingPlacementSignature',
            path: `placementStates[${index}].state.placementSignature`,
            message: '放置点状态缺少当前 canonical 签名'
          });
        }
      }
      const deathDropCheck = this._deathDrops.validate(data.deathDrops || []);
      if (!deathDropCheck.ok) errors.push(...deathDropCheck.errors);
      if (context.sceneNamespace !== 'S10' && (data.s10StructureStates || []).length > 0) {
        errors.push({ code: 's10StructureNamespaceMismatch', path: 's10StructureStates', message: 'S10 工事状态不能属于其他场景' });
      } else {
        const s10Check = this.s10ConstructionCoordinator._validateS10StructureStates(data.s10StructureStates || []);
        if (!s10Check.ok) errors.push({
          code: s10Check.code,
          path: Number.isInteger(s10Check.index) ? `s10StructureStates[${s10Check.index}]` : 's10StructureStates',
          message: 'S10 工事状态无效'
        });
      }
      const vehicleCheck = this._validateSceneVehicleStates(context.sceneNamespace, data.vehicleStates || []);
      if (!vehicleCheck.ok) errors.push({
        code: vehicleCheck.code,
        path: 'vehicleStates',
        message: `${context.sceneNamespace} 载具状态无效`
      });
      return { ok: errors.length === 0, errors };
    },
    prepareRestore: data => {
      const pending = this.context.services.placements?.getPendingStateSnapshot?.()
        || { resourceNodes: [], placementStates: [] };
      return {
        ok: true,
        draft: cloneData(data),
        rollback: { ...pending, domainStates: [...this._pendingChunkDomainStates.entries()] }
      };
    },
    commitRestore: (draft, context = {}) => {
      const placements = this.context.services.placements;
      for (const entry of draft.resourceNodes || []) placements?.addPendingResourceNodeState?.(entry.id, entry.state);
      for (const entry of draft.placementStates || []) placements?.addPendingPlacementState?.(entry.id, entry.state);
      const domainKey = context.key || `${draft.sceneNamespace}:domain`;
      this._pendingChunkDomainStates.set(domainKey, {
        sceneNamespace: draft.sceneNamespace,
        deathDrops: draft.deathDrops || [],
        s10StructureStates: draft.s10StructureStates || [],
        vehicleStates: draft.vehicleStates || []
      });
      return { ok: true };
    },
    rollbackRestore: rollback => {
      if (!rollback) return { ok: true };
      this.context.services.placements?.restorePendingStateSnapshot?.(rollback);
      this._pendingChunkDomainStates = new Map(rollback.domainStates || []);
      return { ok: true };
    }
  };
}

function captureStreamedChunkState(chunk) {
  const placementById = new Map((chunk?.placements || [])
    .filter(placement => placement?.id)
    .map(placement => [placement.id, placement]));
  const resourceNodes = [];
  const placementStates = [];
  const values = new Set([
    ...(this.entities || []),
    ...(this.pickupItems || []),
    ...(this.equipmentItems || [])
  ]);
  for (const value of values) {
    if (value === this.playerEntity) continue;
    const id = value?.placementId || value?.id;
    const placement = placementById.get(id);
    if (!placement) continue;
    const node = value?.getComponent?.('resourceNode');
    if (node?.serialize) resourceNodes.push({ id, state: node.serialize() });
    const transform = value?.getComponent?.('transform');
    const stats = value?.getComponent?.('stats');
    const position = transform?.position || (Number.isFinite(value?.x) ? { x: value.x, y: value.y } : null);
    const corpseState = this.context.services.corpses?.capture?.(value);
    placementStates.push({
      id,
      state: {
        ...(corpseState || {
          kind: placement.kind || 'entity',
          removed: value.picked === true || this._isEntityDead(value),
          ...(Number.isFinite(value?.quantity) ? { quantity: Math.max(0, Math.floor(value.quantity)) } : {}),
          ...(Number.isFinite(stats?.hp) ? { hp: Math.max(0, Number(stats.hp)) } : {}),
          ...(position ? { position: { x: Number(position.x) || 0, y: Number(position.y) || 0 } } : {}),
          ...(placement.kind === 'enemy' ? { ai: this.aiSystem?.getRuntimeState?.(value) || null } : {})
        }),
        placementSignature: getPlacementSignature(placement)
      }
    });
  }
  const pendingPlacementState = this.context.services.placements?.getPendingStateSnapshot?.()
    || { resourceNodes: [], placementStates: [] };
  for (const [id, state] of pendingPlacementState.resourceNodes) {
    if (placementById.has(id) && !resourceNodes.some(entry => entry.id === id)) resourceNodes.push({ id, state });
  }
  for (const [id, state] of pendingPlacementState.placementStates) {
    if (placementById.has(id) && !placementStates.some(entry => entry.id === id)) placementStates.push({ id, state });
  }
  const pendingDomain = this._pendingChunkDomainStates?.get(chunk.key)
    || this._pendingChunkDomainStates?.get(chunk.sceneNamespace)
    || null;
  const left = chunk.origin.x;
  const top = chunk.origin.y;
  const right = left + this.worldStreamingManager.chunkWidth;
  const bottom = top + this.worldStreamingManager.chunkHeight;
  const deathDropById = new Map((pendingDomain?.deathDrops || [])
    .filter(entry => entry?.id)
    .map(entry => [entry.id, cloneData(entry)]));
  for (const entry of this._deathDrops.capture(entity => {
    const position = entity.getComponent?.('transform')?.position;
    return !!position && position.x >= left && position.x <= right
      && position.y >= top && position.y <= bottom;
  })) {
    deathDropById.set(entry.id, entry);
  }
  const capturedS10Structures = chunk.sceneNamespace === 'S10'
    ? this.s10ConstructionCoordinator._captureS10StructureStates()
    : [];
  const capturedVehicles = this._captureSceneVehicleStates(chunk.sceneNamespace);
  return {
    schemaVersion: 2,
    sceneNamespace: chunk.sceneNamespace,
    resourceNodes,
    placementStates,
    deathDrops: [...deathDropById.values()],
    s10StructureStates: capturedS10Structures.length > 0
      ? capturedS10Structures
      : cloneData(pendingDomain?.s10StructureStates || []),
    vehicleStates: capturedVehicles.length > 0
      ? capturedVehicles
      : cloneData(pendingDomain?.vehicleStates || [])
  };
}

function releaseStreamedChunkRuntime(chunk) {
  const placementIds = new Set((chunk?.placements || []).map(placement => placement?.id).filter(Boolean));
  const left = chunk?.origin?.x || 0;
  const top = chunk?.origin?.y || 0;
  const right = left + this.worldStreamingManager.chunkWidth;
  const bottom = top + this.worldStreamingManager.chunkHeight;
  const values = new Set([
    ...(this.entities || []),
    ...(this.pickupItems || []),
    ...(this.equipmentItems || [])
  ]);
  const removed = [...values].filter(value => {
    if (!value || value === this.playerEntity) return false;
    const id = value.placementId || value.id;
    if (placementIds.has(id)) return true;
    const position = value.getComponent?.('deathDrop') && value.getComponent?.('transform')?.position;
    return !!position && position.x >= left && position.x <= right && position.y >= top && position.y <= bottom;
  });
  for (const value of removed) this.aiSystem?.unregisterAI?.(value);
  this.entityStore?.removeMany?.(removed);
  for (const value of removed) {
    try { value?.destroy?.(); } catch (error) { /* best-effort chunk release */ }
  }
  this.context.services.placements?.forgetPlacements?.(placementIds);
  this._placementCoordinator.removeValues(removed);
  const namespaceStillLoaded = [...(this.worldStreamingManager?.getLoadedChunks?.().values?.() || [])]
    .some(loadedChunk => loadedChunk !== chunk && loadedChunk?.sceneNamespace === chunk?.sceneNamespace);
  if (!namespaceStillLoaded && chunk?.sceneNamespace === 'S10') {
    this.s10ConstructionCoordinator._disposeS10Structures();
  }
  if (!namespaceStillLoaded) this._disposeSceneVehicles(chunk?.sceneNamespace);
}

function restoreStreamedDomainState(sceneId) {
  const pendingEntries = [...this._pendingChunkDomainStates.entries()]
    .filter(([key, value]) => value?.sceneNamespace === sceneId || key === sceneId);
  if (pendingEntries.length === 0) return { ok: true };
  const mergeBy = (field, idField) => {
    const merged = new Map();
    for (const [, value] of pendingEntries) {
      for (const entry of value?.[field] || []) {
        const id = entry?.[idField];
        if (id) merged.set(id, entry);
      }
    }
    return [...merged.values()];
  };
  const state = {
    deathDrops: mergeBy('deathDrops', 'id'),
    s10StructureStates: mergeBy('s10StructureStates', 'siteId'),
    vehicleStates: mergeBy('vehicleStates', 'definitionId')
  };
  if (sceneId === 'S10' && state.s10StructureStates.length) {
    const result = this.s10ConstructionCoordinator._restoreS10StructureStates(state.s10StructureStates);
    if (result?.ok === false) return result;
  }
  if (state.vehicleStates.length) {
    const result = this._restoreSceneVehicleStates(sceneId, state.vehicleStates);
    if (result?.ok === false) return result;
  }
  const chunks = [...(this.worldStreamingManager?.getLoadedChunks?.().values?.() || [])]
    .filter(chunk => chunk?.sceneNamespace === sceneId);
  const currentDrops = new Set((this.equipmentItems || [])
    .filter(entity => entity?.getComponent?.('deathDrop'))
    .filter(entity => {
      const position = entity.getComponent?.('transform')?.position;
      return position && chunks.some(chunk => {
        const left = Number(chunk.origin?.x) || 0;
        const top = Number(chunk.origin?.y) || 0;
        const width = this.worldStreamingManager.chunkWidth;
        const height = this.worldStreamingManager.chunkHeight;
        return position.x >= left && position.x <= left + width
          && position.y >= top && position.y <= top + height;
      });
    }));
  const dropRestore = this._deathDrops.restore(state.deathDrops, {
    selectCurrent: entity => currentDrops.has(entity)
  });
  if (!dropRestore.ok) {
    const error = dropRestore.errors?.[0] || {};
    return { ok: false, code: error.code || 'deathDropRestoreFailed', path: error.path };
  }
  for (const [key] of pendingEntries) this._pendingChunkDomainStates.delete(key);
  return { ok: true };
}

async function prepareWorldStreamingManager(result, targetSceneId = this.currentSceneId, session = this._worldLoadSession) {
  return this._worldStreamingRuntime.prepare({
    worldResult: result,
    targetSceneId,
    session,
    stateProviders: [{ id: 'demoDynamic', provider: this.createStreamingStateProvider() }]
  });
}

async function initializeWorldStreaming(result, targetSceneId = this.currentSceneId, options = {}) {
  const manager = await this._worldStreamingRuntime.initialize({
    worldResult: result,
    targetSceneId,
    session: options.session || this._worldLoadSession,
    preparedManager: options.preparedManager || null,
    stateProviders: options.preparedManager
      ? []
      : [{ id: 'demoDynamic', provider: this.createStreamingStateProvider() }]
  });
  this.worldStreamingManager = manager;
  this._detachWorldStreaming = this._worldStreamingRuntime.detach;
  return manager;
}

function syncWorldStreamingProjection() {
  return !!this._worldStreamingRuntime.syncProjection(this.currentSceneId);
}

async function enterStreamedScene(sceneId) {
  if (!sceneId || sceneId === this.currentSceneId) return true;
  const navigationSnapshot = this._navigationProjection?.capture?.();
  this._navigationProjection?.apply({ sceneId, projectStory: false });
  const placementResult = await this.context.services.placements?.spawnLoadedChunks();
  if (placementResult?.ok === false) {
    this._navigationProjection?.restore?.(navigationSnapshot);
    this._showScreenTip(placementResult.errors?.[0]?.message || '地图块放置点生成失败', { title: '地图加载失败' });
    return false;
  }
  const runtimeProjection = await this.sanguoSceneNavigationCoordinator.projectEntryRuntime(sceneId);
  if (runtimeProjection?.ok === false) {
    this._navigationProjection?.restore?.(navigationSnapshot);
    this._showScreenTip('地图块运行时投影失败', { title: '地图加载失败' });
    return false;
  }
  const restored = this.restoreStreamedDomainState(sceneId);
  if (restored?.ok === false) {
    this._navigationProjection?.restore?.(navigationSnapshot);
    this._showScreenTip(`地图块动态状态恢复失败：${restored.code || 'unknown'}`, { title: '恢复失败' });
    return false;
  }
  this._navigationProjection?.apply({ sceneId });
  await this._forwardCommittedSceneEnter(sceneId);
  return true;
}

async function validateRegionTarget({ request, result, shadowSession }) {
  const errors = [...(result?.errors || []).map((entry, index) => ({
    code: 'regionLoadFailed', path: `region.errors[${index}]`, message: entry.message || String(entry.error || entry)
  }))];
  const region = result?.region;
  if (!region) errors.push({ code: 'missingRegion', path: 'region', message: `未找到大区索引 ${request.regionIndex}` });
  if (region?.previewOnly === true) errors.push({ code: 'previewRegion', path: 'region.previewOnly', message: '预览大区不能进入主流程' });
  const chunk = result?.chunks?.find(entry => entry.sceneId === request.sceneId);
  if (!chunk) errors.push({ code: 'missingTargetScene', path: 'region.chunks', message: `目标大区不包含 ${request.sceneId}` });
  if (chunk?.sceneData?.previewOnly === true || chunk?.sceneData?.productionState === 'greybox') {
    errors.push({ code: 'previewScene', path: `scenes.${request.sceneId}`, message: `${request.sceneId} 尚未达到可玩状态` });
  }
  if (!shadowSession?.findSpawn?.(request.sceneId, request.spawnRef || 'player')) {
    errors.push({ code: 'missingSpawn', path: `scenes.${request.sceneId}.spawn`, message: `${request.sceneId} 缺少出生点 ${request.spawnRef || 'player'}` });
  }
  if (errors.length > 0) return { ok: false, errors };

  try {
    const preparedStreamingManager = await this.prepareWorldStreamingManager(result, request.sceneId, shadowSession);
    return { ok: true, errors: [], preparedStreamingManager };
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: 'regionStreamingPrepareFailed',
        path: `scenes.${request.sceneId}`,
        message: error?.message || String(error)
      }]
    };
  }
}

function extractRegionDynamicState(sceneState = {}) {
  const keys = [
    'worldStreamingState',
    'campfireLit', 'campfireState', 'firedPickups', 'clearedGroups',
    'gatheringState', 'puppetState', 'gatheringPolicyOperations'
  ];
  const state = {};
  for (const key of keys) {
    if (sceneState[key] !== undefined) state[key] = cloneData(sceneState[key]);
  }
  return state;
}

function clearRegionRuntime(result = this._worldLoadResult) {
  this.gatheringPuppetSystem?.cancelActive?.('regionUnload', { silent: true });
  this.s10ConstructionCoordinator._disposeS10Structures();
  this._disposeAllSceneVehicles();
  const placementIds = new Set((result?.placements || [])
    .filter(placement => placement?.type === 'ref' && placement.id)
    .map(placement => placement.id));
  const values = new Set([
    ...(this.entities || []).filter(entity => entity !== this.playerEntity),
    ...(this.pickupItems || []),
    ...(this.equipmentItems || [])
  ]);
  for (const value of values) this.aiSystem?.unregisterAI?.(value);
  this.entityStore?.removeMany?.(values);
  for (const value of values) {
    try { value?.destroy?.(); } catch (error) { /* best-effort region unload */ }
  }
  this.context.services.placements?.forgetPlacements?.(placementIds);
  this._placementCoordinator.removeValues(values);
  this._groupEnemies = {};
  this._npcEntities = [];
}

async function commitRegionTarget({ request, result, shadowSession, draft, validation }) {
  const preparedStreamingManager = validation?.preparedStreamingManager;
  if (!preparedStreamingManager) {
    return { ok: false, errors: [{
      code: 'missingPreparedStreamingManager',
      path: 'region.streaming',
      message: '目标大区缺少已校验的流式加载草稿'
    }] };
  }
  const oldRegionId = this._worldLoadResult?.region?.id;
  const oldSceneState = draft?.saveState?.scene;
  if (oldRegionId && oldSceneState) {
    this._regionDynamicStates.set(oldRegionId, this.extractRegionDynamicState(oldSceneState));
  }
  this.clearRegionRuntime(this._worldLoadResult);
  this.context.services.placements?.setPendingStates?.();
  this._campfireService.restore({ lit: false }, { particleSystem: this.particleSystem });
  this._worldLoadSession = shadowSession;
  this._worldLoadResult = result;
  this._worldIndex = result.worldIndex;
  this._currentRegionIndex = request.regionIndex;
  await this.initializeWorldStreaming(result, request.sceneId, {
    preparedManager: preparedStreamingManager,
    session: shadowSession
  });
  this._worldLoadPromise = Promise.resolve(result);
  this._loadWorldTerrains();
  const projection = await this.context.services.placements?.loadProjection({
    sceneId: request.sceneId,
    consumePlayerSpawn: false
  });
  if (projection?.ok === false) return projection;
  const worldRuntimeReady = this._worldRuntimeReadyPromise;
  if (worldRuntimeReady) await worldRuntimeReady;
  else await this._worldLoadPromise;

  const targetChunkLoaded = [...(this.worldStreamingManager?.getLoadedChunks?.().values?.() || [])]
    .some(chunk => chunk?.sceneId === request.sceneId);
  if (this._worldRegion !== result.region || !targetChunkLoaded) {
    return { ok: false, errors: [{ code: 'regionProjectionFailed', path: 'region', message: '目标大区九宫格投影未完成' }] };
  }
  this._navigationProjection.apply({ sceneId: request.sceneId, projectStory: false });
  if (!this.getBattleFlowByScene(request.sceneId)) {
    this.s03s14BattleCoordinator.leaveBattleScene({ preserveSnapshot: true });
  }
  const spawn = shadowSession.findSpawn(request.sceneId, request.spawnRef || 'player');
  const transform = this.playerEntity?.getComponent?.('transform');
  if (!spawn || !transform) {
    return { ok: false, errors: [{ code: 'missingSpawn', path: `scenes.${request.sceneId}.spawn`, message: '目标出生点不可用' }] };
  }
  transform.position.x = spawn.x;
  transform.position.y = spawn.y;
  this.camera?.setPosition?.(spawn.x, spawn.y);

  const placementResult = await this.context.services.placements?.spawnLoadedChunks();
  if (placementResult?.ok === false) return placementResult;
  const runtimeProjection = await this.sanguoSceneNavigationCoordinator.projectEntryRuntime(request.sceneId);
  if (runtimeProjection?.ok === false) return runtimeProjection;

  const targetRegionId = result.region?.id;
  const targetState = targetRegionId ? this._regionDynamicStates.get(targetRegionId) : null;
  if (targetState) {
    this._regionDynamicStates.delete(targetRegionId);
    const restored = this.restoreSceneSaveState({
      ...targetState,
      regionStates: [...this._regionDynamicStates.entries()].map(([regionId, state]) => ({ regionId, state })),
      defeatState: this.playerDefeatService?.serialize?.() || null,
      gatheringState: targetState.gatheringState || this.gatheringSystem?.serialize?.() || null
    });
    if (restored?.ok === false) return restored;
  }
  this._navigationProjection.apply({ sceneId: request.sceneId, unlock: true });
  return { ok: true, errors: [] };
}

async function restoreRegionDraft({ draft, oldSession }) {
  if (!draft?.worldResult) {
    return { ok: false, errors: [{ code: 'missingRegionDraft', path: 'region', message: '缺少旧大区回滚草稿' }] };
  }
  this.clearRegionRuntime(this._worldLoadResult);
  this._worldLoadSession = oldSession || this._worldLoadSession;
  this._worldLoadResult = draft.worldResult;
  this._currentRegionIndex = draft.regionIndex;
  await this.initializeWorldStreaming(draft.worldResult, draft.saveState?.currentSceneId);
  this._worldLoadPromise = Promise.resolve(draft.worldResult);
  this._loadWorldTerrains();
  const projection = await this.context.services.placements?.loadProjection({
    sceneId: draft.saveState?.currentSceneId,
    consumePlayerSpawn: false
  });
  if (projection?.ok === false) return projection;
  const worldRuntimeReady = this._worldRuntimeReadyPromise;
  if (worldRuntimeReady) await worldRuntimeReady;
  else await this._worldLoadPromise;
  return this.restoreSaveState(draft.saveState);
}

export default SanguoWorldRuntimeCoordinator;

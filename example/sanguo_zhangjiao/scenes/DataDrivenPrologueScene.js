/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * DataDrivenPrologueScene - 数据驱动 S01–S14 世界场景
 *
 * 继承 BaseGameScene（通用可玩管线），通过 SceneTerrainBinding、
 * SceneCampfireService 与 GameProject 的 canonical 场景数据装配地形、碰撞、火堆与表现。
 * 流程由 GameProject（game.project.json）的 triggers、领域 command 与区块传送驱动。
 *
 * 当前作为 Demo 唯一运行时大地图场景；编辑器与运行时共享磁盘 canonical S01–S14。
 * 各场景流程由 GameProject triggers 与区块传送驱动。
 */

import { BaseGameScene } from './BaseGameScene.js';
import { Scene1Terrain } from './Scene1Terrain.js';
import { AtlasRegistry } from '../../../src/core/scene/AtlasRegistry.js';
import sharedAtlasConfig from '../config/atlases.json';
import { SceneStreamingRuntime } from '../../../src/core/scene/SceneStreamingRuntime.js';
import {
  collectManifestUsageAssetIds,
  collectSceneAssetIds
} from '../../../src/core/scene/SceneAssetCollector.js';
import { RegionCoordinator } from '../../../src/core/scene/RegionCoordinator.js';
import { WorldReadyGate } from '../../../src/core/scene/WorldReadyGate.js';
import { ChunkNavigator } from '../../../src/core/scene/ChunkNavigator.js';
import { SceneNavigationProjection } from '../../../src/core/scene/SceneNavigationProjection.js';
import { SceneWorldQuery } from '../../../src/core/scene/SceneWorldQuery.js';
import { ScenePlacementRuntime, getPlacementSignature } from '../../../src/core/scene/ScenePlacementRuntime.js';
import { SceneVehicleRuntime } from '../../../src/core/scene/SceneVehicleRuntime.js';
import { SceneCityWarStateBridge } from '../../../src/core/scene/SceneCityWarStateBridge.js';
import { ScenarioCommandService, SCENARIO_COMMANDS } from '../../../src/systems/ScenarioCommandService.js';
import { DomainCommandService } from '../../../src/systems/DomainCommandService.js';
import { CanonicalStateTransactionService } from '../../../src/systems/CanonicalStateTransactionService.js';
import { SanguoDomainCommandFacade } from '../systems/SanguoDomainCommandFacade.js';
import { WeatherSystem } from '../../../src/systems/WeatherSystem.js';
import { TimeSystem } from '../../../src/systems/TimeSystem.js';
import { CargoTransferView } from '../../../src/ui/CargoTransferView.js';
import { RecipeSelectionView } from '../../../src/ui/RecipeSelectionView.js';
import { SanguoProgressionPresentationCoordinator } from '../systems/SanguoProgressionPresentationCoordinator.js';
import { SanguoSceneLifecycleCoordinator } from '../systems/SanguoSceneLifecycleCoordinator.js';
import { SanguoPlacementCoordinator } from '../systems/SanguoPlacementCoordinator.js';
import { S01S02Coordinator } from '../systems/S01S02SceneFlow.js';
import { SceneTutorialFlow } from '../../../src/core/scene/SceneTutorialFlow.js';
import { SceneCampfireService } from '../../../src/core/scene/SceneCampfireService.js';
import { SceneNpcInteractionFlow } from '../../../src/core/scene/SceneNpcInteractionFlow.js';
import {
  S03S08Coordinator, S03_BATTLE_ID
} from '../systems/S03S08SceneFlow.js';
import {
  S05SceneCoordinator, S05_ZHANG_MANCHENG_RESCUE_ID
} from '../systems/S05SceneFlow.js';
import { S06SceneCoordinator } from '../systems/S06SceneFlow.js';
import {
  S07S08Coordinator, S07_BATTLE_ID
} from '../systems/S07S08SceneFlow.js';
import { S09RefugeeCoordinator } from '../systems/S09RefugeeFlow.js';
import { S09ClassSelectionCoordinator } from '../systems/S09ClassSelectionFlow.js';
import { S10ConstructionCoordinator } from '../systems/S10ConstructionFlow.js';
import { S10StoryCoordinator } from '../systems/S10StoryFlow.js';
import { S11S14SceneCoordinator } from '../systems/S11S14SceneFlow.js';
import { SanguoSceneNavigationCoordinator } from '../systems/SanguoSceneNavigationFlow.js';
import { SanguoSceneCommandCoordinator } from '../systems/SanguoSceneCommandFlow.js';
import { S03S14BattleCoordinator } from '../systems/S03S14BattleCoordinator.js';
import { SanguoSceneStateFlow } from '../systems/SanguoSceneStateFlow.js';
import { SanguoWorldRuntimeCoordinator } from '../systems/SanguoWorldRuntimeCoordinator.js';
import { SanguoGameLoaderCoordinator } from '../systems/SanguoGameLoaderCoordinator.js';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

function awaitWithAbort(promise, signal, message) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error(message));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error(message));
    };
    const cleanup = () => signal.removeEventListener?.('abort', onAbort);
    signal.addEventListener?.('abort', onAbort, { once: true });
    promise.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

export class DataDrivenPrologueScene extends BaseGameScene {
  // 显式空钩子：terrain 只能由 SceneStreamingRuntime 使用 canonical chunk 数据创建。
  _initEditorTerrain() { /* 由世界流式管线代替 */ }

  constructor() {
    super({
      name: 'DataDrivenPrologueScene',
      title: '三国张角传',
      description: 'S01 干旱平原'
    });
    // 启动场景只在 ProjectWorldIndex 构建成功后由显式 entrySceneId 决定。
    this.currentSceneId = null;
    this._worldQuery = new SceneWorldQuery({
      getSession: () => this._worldLoadSession,
      getCurrentSceneId: () => this.currentSceneId,
      getProjectedObjects: () => this._worldLoadResult?.sceneObjects || []
    });
    this.context.services.worldQuery = this._worldQuery;

    this._tutorialFlow = new SceneTutorialFlow({
      tutorialSystem: this.tutorialSystem,
      getScope: () => ({ sceneId: this.currentSceneId }),
      presenter: {
        show: data => {
          this._showScreenTip(data?.step?.text || '', {
            title: data?.beginText || data?.tutorialTitle || '教学', persist: true, owner: 'tutorial'
          });
          // 教程步骤指定高亮目标时，若 target 可解析为世界实体，在其周围冒星星闪光引导视线。
          if (data?.step?.highlightTarget && data?.step?.target) {
            const entity = (this.entities || []).find(e => e?.id === data.step.target);
            const pos = entity?.getComponent?.('transform')?.position;
            if (pos) {
              this.eventTargetFlash.spawn({ worldX: pos.x, worldY: pos.y });
            }
          }
        },
        hide: () => this._hideScreenTip('tutorial'),
        complete: (_tutorialId, tutorial) => {
          if (tutorial?.endText) this._showScreenTip(tutorial.endText, { title: '✓ 完成', owner: 'tutorial' });
        }
      },
      scheduler: callback => this.resourceScope?.setTimeout(callback, 0)
    });
    this.context.services.tutorialFlow = this._tutorialFlow;
    this._s01s02Coordinator = new S01S02Coordinator(this);
    Object.assign(this.context.services, {
      s01s02: this._s01s02Coordinator,
      defeatPolicy: this._s01s02Coordinator
    });

    // 火堆服务只保存运行态；表现参数由当前 canonical scene gameplay consumer 发布后配置。
    this._campfireService = new SceneCampfireService({
      now: () => this.simulationClock?.now?.() ?? performance.now(),
      onIgnited: () => this.gameLoader?.triggerSystem?.fire?.('campfireLit', { sceneId: this.currentSceneId }),
      onExtinguished: () => this.gameLoader?.triggerSystem?.fire?.('campfireExtinguished', { sceneId: this.currentSceneId }),
      logger: console
    });
    this.context.services.campfire = this._campfireService;

    this._placementCoordinator = new SanguoPlacementCoordinator({
      getNpcEntities: () => (this._npcEntities = this._npcEntities || []),
      getGroupEnemies: () => (this._groupEnemies = this._groupEnemies || {})
    });
    this._npcInteractionFlow = new SceneNpcInteractionFlow({
      getNpcs: () => this._npcEntities || [],
      getPlayer: () => this.playerEntity,
      getDialogueSystem: () => this.dialogueSystem,
      getShopSystem: () => this.shopSystem,
      onInteract: target => this.gameLoader?.triggerSystem?.fire?.('interact', { target }),
      showIdleText: ({ npc, text }) => this._presentNpcIdleText(npc, text)
    });
    this.context.services.npcInteraction = this._npcInteractionFlow;

    this.terrain = null;
    this.worldStreamingManager = null;
    // 每次 Region 激活只允许显式建立一次小地图静态缩略图。
    this._minimapBackgroundActivation = null;
    this._detachWorldStreaming = null;
    this._assetManifestReady = new Promise((resolve, reject) => {
      this._resolveAssetManifestReady = resolve;
      this._rejectAssetManifestReady = reject;
    });
    // Promise 仍由 chunk prepare 正式 await；此分支只避免初始化提前失败产生未处理拒绝。
    this._assetManifestReady.catch(() => {});
    const sharedAtlases = Array.isArray(sharedAtlasConfig.atlases) ? sharedAtlasConfig.atlases : [];
    const sharedAtlasRegistry = new AtlasRegistry(sharedAtlases);
    this._worldStreamingRuntime = new SceneStreamingRuntime({
      createTerrain: ({ chunk, chunkWidth, chunkHeight, sceneData }) => new Scene1Terrain({
        centerX: chunkWidth / 2,
        centerY: chunkHeight / 2,
        width: chunkWidth,
        height: chunkHeight,
        editorSceneId: chunk.sceneId,
        worldOffset: chunk.origin,
        sceneData,
        sharedAtlases,
        resolveImageAsset: imageId => this.assetManager?.resolveManifestAsset?.(imageId, '2d') || null,
        getLoadedImage: imageId => {
          const key = this.assetManager?.resolveManifestAsset?.(imageId, '2d')?.key || imageId;
          return this.assetManager?.getAsset?.(key, '2d') || null;
        }
      }),
      prepareChunkAssets: async ({ sceneId, sceneNamespace, sceneData, signal }) => {
        await awaitWithAbort(
          this._assetManifestReady,
          signal,
          `Chunk ${sceneId} 等待 Manifest 时加载已取消`
        );
        if (signal?.aborted) throw new Error(`Chunk ${sceneId} 资源加载已取消`);
        const assetIds = collectSceneAssetIds({
          sceneData,
          registries: this.gameLoader?.registries || {}
        });
        // legacy decoKey 没有 atlasId；按共享切片表补出稳定图集 ID，仍由 AssetManager 懒加载。
        for (const layer of sceneData?.layers || []) {
          if (layer?.visible === false) continue;
          for (const object of layer?.objects || []) {
            const sliceKey = object?.decoKey || object?.sliceKey;
            const atlas = object?.atlasId
              ? sharedAtlasRegistry.getAtlas(object.atlasId)
              : sharedAtlasRegistry.findAtlasBySliceKey(sliceKey);
            if (atlas) assetIds.add(atlas.assetId || atlas.id);
          }
        }
        for (const id of collectManifestUsageAssetIds(
          this.assetManager?.manifestEntries,
          [sceneId, sceneNamespace]
        )) assetIds.add(id);
        await this.assetManager?.loadAssets?.(assetIds, { mode: '2d', signal, required: true });
      },
      getPosition: () => this.playerEntity?.getComponent?.('transform')?.position || null,
      getCurrentSceneId: () => this.currentSceneId,
      getRuntime: () => this.sceneRuntime,
      onChunkUnload: ({ chunk }) => this.sanguoWorldRuntimeCoordinator.releaseStreamedChunkRuntime(chunk),
      onProjection: ({ manager, chunks, terrains, terrain }) => {
        this.worldStreamingManager = manager;
        this._terrains = terrains;
        this.terrain = terrain;
        this.context.world.terrain = terrain;
        this.context.world.terrains = terrains;
        if (this.minimap) {
          if (this._worldIndex &&
              (this.minimap._worldIndex !== this._worldIndex || this.minimap._regionRef !== manager.regionId)) {
            this.minimap.setWorldIndex(this._worldIndex, manager.regionId);
          }
          const playerPosition = this.playerEntity?.getComponent?.('transform')?.position;
          if (playerPosition) this.minimap.setPlayerPosition(playerPosition);
          if (typeof this.camera?.getViewBounds === 'function') {
            this.minimap.setViewBounds(this.camera.getViewBounds());
          }
          this._terrainBinding.updateMinimap(this.minimap);
          // projection commit 是唯一静态缩略图入口：同一 manager/Region 后续刷新只同步引用。
          const activation = this._minimapBackgroundActivation;
          if (activation?.manager !== manager || activation.regionId !== manager.regionId) {
            this._minimapBackgroundActivation = { manager, regionId: manager.regionId };
            this.minimap.prepareBackgroundCache();
          }
        }
        this.context.services.placements?.setProjection(chunks.flatMap(chunk => chunk.placements || []));
        const sceneObjects = chunks.flatMap(chunk => chunk.sceneObjects || []);
        const triggerBindings = chunks.flatMap(chunk => chunk.triggerBindings || []);
        const effectZones = chunks.flatMap(chunk => chunk.effectZones || []);
        this._sceneTriggerBindings?.setBindings(triggerBindings, sceneObjects);
        const effectZoneRenderer = this._terrainBinding.setEffectZones(effectZones);
        if (effectZoneRenderer?.zones.length > 0) {
          console.log(`[DDScene] 加载了 ${effectZoneRenderer.zones.length} 个特效区域`);
        }
      },
      onTransition: async ({ manager }) => {
        const placementResult = await this.context.services.placements?.spawnLoadedChunks();
        if (placementResult?.ok === false) {
          this._showScreenTip(placementResult.errors?.[0]?.message || '地图块放置点生成失败', { title: '地图加载失败' });
          return;
        }
        const position = this.playerEntity?.getComponent?.('transform')?.position;
        const center = position ? manager.worldToChunk(position.x, position.y) : null;
        const chunkId = center ? manager.getSceneId(center.col, center.row) : null;
        const sceneId = chunkId ? manager.getSceneNamespace(chunkId) : null;
        if (sceneId && sceneId !== this.currentSceneId) {
          await this.sanguoWorldRuntimeCoordinator.enterStreamedScene(sceneId);
        } else if (sceneId) {
          const restored = this.sanguoWorldRuntimeCoordinator.restoreStreamedDomainState(sceneId);
          if (restored?.ok === false) {
            this._showScreenTip(`地图块动态状态恢复失败：${restored.code || 'unknown'}`, { title: '恢复失败' });
          }
        }
      },
      onError: failure => {
        const message = failure?.errors?.[0]?.message || '相邻地图块加载失败';
        this._showScreenTip(message, { title: '地图加载失败' });
      }
    });
    this._pendingChunkDomainStates = new Map();
    this.sanguoWorldRuntimeCoordinator = new SanguoWorldRuntimeCoordinator(this);
    this.context.services.sanguoWorldRuntime = this.sanguoWorldRuntimeCoordinator;
    this.gameLoader = null;
    this.progressionViewModel = null;
    this.progressionPanel = null;
    this.proficiencySystem = null;
    this.cityStateSummaryPanel = null;
    this._progressionBootstrap = { isNewGame: false, playerStartMode: 'restore' };
    this._playerStartMode = 'restore';
    this._initialPlayerSpawnPending = false;
    this.classSystem = null;
    this._classSelected = false;
    this.selectedClass = null;
    this._classConfirm = null;
    this._classSelectionBusy = false;
    this._s09AudioDirector = null;
    this.rescueSystem = null;
    this.constructionSystem = null;
    this.vehicleSystem = null;
    this.vehicleLogisticsSystem = null;
    this.mannedStructureAdapter = null;
    this._s10StructureEntities = new Map();
    this._sceneVehicleEntities = new Map();
    this._sceneVehicleRuntime = new SceneVehicleRuntime({
      entityFactory: this.entityFactory,
      entityStore: this.entityStore,
      entities: this._sceneVehicleEntities,
      getCurrentSceneId: () => this.currentSceneId,
      getChunk: sceneId => this._worldLoadSession?.getChunk?.(sceneId) || null,
      findMarker: (sceneId, objectId) => this._worldLoadSession?.findSceneObject?.(sceneId, objectId) || null,
      getVehicleSystem: () => this.context?.systems?.vehicle || this.vehicleSystem,
      getLogisticsSystem: () => this.context?.systems?.vehicleLogistics || this.vehicleLogisticsSystem,
      getPlayer: () => this.context?.player?.entity || this.playerEntity,
      team: 'yellow_turban',
      createTags: (sceneId, definition) => [
        `${sceneId.toLowerCase()}Vehicle`, definition.vehicleType, 'yellow_turban'
      ],
      onAfterDisposeScene: sceneId => {
        if (sceneId !== 'S14') return;
        this.vehicleWeaponSystem?.dispose?.();
        this.vehicleWeaponSystem = null;
        this._s14CatapultFireBusy = false;
      }
    });
    this.context.services.vehicles = this._sceneVehicleRuntime;
    // Demo 历史编排兼容别名；与通用 map 是同一引用，不形成第二份状态。
    this._s14VehicleEntities = this._sceneVehicleEntities;
    this._s10StructureInteractionBusy = false;
    this.rescueObjectiveView = null;
    this.irreversibleChoiceView = null;
    this.cargoTransferView = new CargoTransferView({
      width: 680,
      onCommand: command => { void this.s11s14SceneCoordinator?._handleCargoTransferCommand(command); }
    });
    this.recipeSelectionView = new RecipeSelectionView({
      width: 700,
      onCommand: command => { void this._s01s02Coordinator?.handleRecipeCommand(command); }
    });
    this._cargoTransferBusy = false;
    this._cargoTransferPendingOperation = null;
    this._cargoTransferSequence = 0;
    this.endingPresentationView = null;
    this.endingSystem = null;
    this.s04RouteCoordinator = null;
    this.s11s12Coordinator = null;
    this.s13s14Coordinator = null;
    this._s12GateEntity = null;
    this._s13PendingSettlement = null;
    this._endingConfig = null;
    this._s04RescueBusy = false;
    this._s05RescueBusy = false;
    this._s04RouteBusy = false;
    this._s07PointBusy = false;
    this._s07ExitBusy = false;
    this._s08DecisionBusy = false;
    this._s08RecallBusy = false;
    this._s10StoryBusy = false;
    this._constructionCheckpointBusy = false;
    this._s05MinePendingSettlements = new Map();
    this._s05MineBusy = false;
    this._s06DecisionBusy = false;
    this._s06RecallBusy = false;
    this._s09RefugeeChoiceBusy = false;
    this._processingDelayedStoryEvents = false;

    // 历史场景编排使用显式 coordinator；Scene 只保留装配和入口调用。
    this.s03s08Coordinator = new S03S08Coordinator(this);
    this.s05SceneCoordinator = new S05SceneCoordinator(this);
    this.s06SceneCoordinator = new S06SceneCoordinator(this);
    this.s07s08Coordinator = new S07S08Coordinator(this);
    this.s09RefugeeCoordinator = new S09RefugeeCoordinator(this);
    this.s09ClassSelectionCoordinator = new S09ClassSelectionCoordinator(this);
    this.context.services.s09ClassSelection = this.s09ClassSelectionCoordinator;
    this.s10StoryCoordinator = new S10StoryCoordinator(this);
    this.s10ConstructionCoordinator = new S10ConstructionCoordinator(this);
    this.s11s14SceneCoordinator = new S11S14SceneCoordinator(this);
    this.sanguoSceneNavigationCoordinator = new SanguoSceneNavigationCoordinator(this);
    this.sanguoSceneCommandCoordinator = new SanguoSceneCommandCoordinator(this);
    this.s03s14BattleCoordinator = new S03S14BattleCoordinator(this);
    this.sanguoSceneStateFlow = new SanguoSceneStateFlow(this);
    this.sanguoSceneLifecycleCoordinator = new SanguoSceneLifecycleCoordinator(this);
    this.sanguoProgressionPresentationCoordinator = new SanguoProgressionPresentationCoordinator(this);
    this.sanguoGameLoaderCoordinator = new SanguoGameLoaderCoordinator(this);
    Object.assign(this.context.services, {
      sanguoSceneState: this.sanguoSceneStateFlow,
      sanguoSceneLifecycle: this.sanguoSceneLifecycleCoordinator,
      sanguoProgressionPresentation: this.sanguoProgressionPresentationCoordinator,
      sanguoGameLoader: this.sanguoGameLoaderCoordinator
    });
    this.cityWarStateBridge = new SceneCityWarStateBridge({
      getBlackboard: () => this.gameLoader?.blackboard || null,
      getConfiguredResourceNodes: () => this.gameLoader?.project?.library?.resourceNodes || [],
      getEntities: () => this.entityStore.all,
      updatePendingResourceNodes: updater => (
        this.context.services.placements?.updatePendingResourceNodeStates?.(updater) || 0
      ),
      getActiveBattle: () => {
        const session = this.context.services.battleRuntime?.getSessionState?.() || {};
        return { battleId: session.battleId || null, mode: session.mode || null };
      },
      getBattleFlowById: battleId => this.getBattleFlowById(battleId),
      getBattleFlows: () => this.getBattleFlows()
    });
    this.context.services.cityWarState = this.cityWarStateBridge;

    // 天气/时间只在 canonical runtime config 发布成功后创建。
    this.weatherSystem = new WeatherSystem(null);
    this.timeSystem = new TimeSystem({ enabled: false, currentDay: 1 });
  }

  /** 由宿主在 enter() 前标记本次启动意图；读档与继承玩家不得消费场景出生点。 */
  setProgressionBootstrap({ isNewGame = false, playerStartMode = null } = {}) {
    const newGame = isNewGame === true;
    const allowedModes = new Set(['newGame', 'restore', 'inherit', 'preserve']);
    const resolvedMode = allowedModes.has(playerStartMode)
      ? playerStartMode
      : (newGame ? 'newGame' : 'restore');
    this._progressionBootstrap = { isNewGame: newGame, playerStartMode: resolvedMode };
  }

  /** 世界入口校验由 Demo 世界协调器拥有；WorldReadyGate 时机仍由 Scene 管理。 */
  _validateWorldLoadResult(result) {
    return this.sanguoWorldRuntimeCoordinator.validateWorldLoadResult(result);
  }

  /** canonical 磁盘会话由 Demo 世界协调器创建；保留 Scene 兼容入口。 */
  _createWorldLoadSession(scope = this.resourceScope) {
    return this.sanguoWorldRuntimeCoordinator.createWorldLoadSession(scope);
  }

  /** 流式动态状态由 Demo 世界协调器拥有；保留稳定兼容入口。 */
  _createStreamingStateProvider() {
    return this.sanguoWorldRuntimeCoordinator.createStreamingStateProvider();
  }

  _captureStreamedChunkState(chunk) {
    return this.sanguoWorldRuntimeCoordinator.captureStreamedChunkState(chunk);
  }

  _releaseStreamedChunkRuntime(chunk) {
    return this.sanguoWorldRuntimeCoordinator.releaseStreamedChunkRuntime(chunk);
  }

  _restoreStreamedDomainState(sceneId) {
    return this.sanguoWorldRuntimeCoordinator.restoreStreamedDomainState(sceneId);
  }

  _debugCanonicalHotSync(stage, detail = {}) {
    if (!this.debugMode) return;
    console.log(`[DDScene][CanonicalHotSync] ${stage}`, detail);
  }

  _refreshCanonicalHotSyncMinimap(sceneId, phase) {
    if (typeof this.minimap?.prepareBackgroundCache !== 'function') return;
    try {
      this.minimap.prepareBackgroundCache();
      this._debugCanonicalHotSync('minimap-cache', { sceneId, phase });
    } catch (error) {
      console.warn('[DDScene][CanonicalHotSync] 小地图静态缓存重建失败', { sceneId, phase, error });
    }
  }

  /** 仅监听带 provenance 与 revision 的 Vite custom HMR canonical 场景提交。 */
  _watchEditorSceneCommits() {
    const HMR_EVENT = 'yijian18:canonical-scene-commit';
    const GAME_ID = 'sanguo_zhangjiao';
    const PROJECT_PATH = 'example/sanguo_zhangjiao/game.project.json';
    const CANONICAL_SCENE_ID = /^S(?:0[1-9]|1[0-4])(?:-C\d{2})?$/;
    const generations = new Map();
    const controllers = new Map();
    const seenRevisions = new Map();
    let disposed = false;
    this._editorSceneCommitGenerations = generations;
    this._editorSceneCommitControllers = controllers;

    const accept = payload => {
      const projectPath = typeof payload?.projectPath === 'string'
        ? payload.projectPath.replace(/\\/g, '/')
        : null;
      const revision = typeof payload?.revision === 'string' && payload.revision.length > 0
        ? payload.revision
        : null;
      if (disposed
        || payload?.gameId !== GAME_ID
        || projectPath !== PROJECT_PATH
        || !CANONICAL_SCENE_ID.test(payload?.sceneId || '')
        || !revision) return false;

      let revisions = seenRevisions.get(payload.sceneId);
      if (!revisions) {
        revisions = new Set();
        seenRevisions.set(payload.sceneId, revisions);
      }
      if (revisions.has(revision)) {
        this._debugCanonicalHotSync('notification-duplicate', {
          source: 'hmr', sceneId: payload.sceneId, revision
        });
        return false;
      }
      revisions.add(revision);
      while (revisions.size > 8) revisions.delete(revisions.values().next().value);

      this._debugCanonicalHotSync('notification', {
        source: 'hmr', sceneId: payload.sceneId, revision, ts: null
      });
      void this._handleEditorSceneCommit({
        sceneId: payload.sceneId,
        revision,
        ts: null,
        source: 'hmr'
      });
      return true;
    };
    const hmrHandler = payload => { accept(payload); };
    const hot = import.meta.hot || null;
    hot?.on?.(HMR_EVENT, hmrHandler);

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      hot?.off?.(HMR_EVENT, hmrHandler);
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      generations.clear();
      seenRevisions.clear();
      if (this._editorSceneCommitControllers === controllers) this._editorSceneCommitControllers = null;
      if (this._editorSceneCommitGenerations === generations) this._editorSceneCommitGenerations = null;
      if (this._editorSceneSyncUnwatch === dispose) this._editorSceneSyncUnwatch = null;
    };
    return dispose;
  }

  /**
   * 应用编辑器的场景提交：从磁盘读取 canonical 局部数据，先 detached 准备 terrain，
   * 再在同一同步段提交 session/chunk/terrain/placement；任一步失败按逆序回滚。
   */
  async _handleEditorSceneCommit({ sceneId, revision = null, ts = null, source = 'unknown' } = {}) {
    if (!sceneId) return;
    const generations = this._editorSceneCommitGenerations || new Map();
    const controllers = this._editorSceneCommitControllers || new Map();
    this._editorSceneCommitGenerations = generations;
    this._editorSceneCommitControllers = controllers;
    const generation = (generations.get(sceneId) || 0) + 1;
    generations.set(sceneId, generation);
    controllers.get(sceneId)?.abort();
    this._debugCanonicalHotSync('accepted', { source, sceneId, revision, ts, generation });

    const session = this._worldLoadSession;
    const streamingRuntime = this._worldStreamingRuntime;
    const manager = streamingRuntime?.manager || null;
    const loadedChunk = streamingRuntime?.getLoadedChunk?.(sceneId) || null;
    if (!session || !streamingRuntime) {
      this._debugCanonicalHotSync('runtime-unavailable', { source, sceneId, revision, generation });
      return;
    }
    this._debugCanonicalHotSync('loaded-check', {
      source,
      sceneId,
      revision,
      generation,
      loaded: !!loadedChunk,
      chunkKey: loadedChunk?.key || null,
      regionId: loadedChunk?.regionId || null,
      row: loadedChunk?.row ?? null,
      col: loadedChunk?.col ?? null,
      origin: loadedChunk?.origin ? { ...loadedChunk.origin } : null
    });
    if (!loadedChunk) {
      session.forgetScene?.(sceneId);
      this._debugCanonicalHotSync('unloaded-cache-forgotten', { sceneId, revision, generation });
      return;
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) controllers.set(sceneId, controller);
    const isCurrent = () => (
      generations.get(sceneId) === generation &&
      this._editorSceneCommitGenerations === generations &&
      (!controller || (!controller.signal.aborted && controllers.get(sceneId) === controller)) &&
      this._worldLoadSession === session &&
      streamingRuntime.manager === manager &&
      streamingRuntime.getLoadedChunk?.(sceneId) === loadedChunk
    );

    let previousSceneData = null;
    let sessionCommitted = false;
    let runtimeDraft = null;
    let runtimeOutcome = null;
    let placementRebuildOutcome = null;
    let runtimeCommitAttempted = false;
    let transactionFinalized = false;
    try {
      const response = await fetch(`assets/scenes/${encodeURIComponent(sceneId)}.json`, {
        cache: 'no-store',
        signal: controller?.signal
      });
      if (!response.ok) throw new Error(`读取场景 ${sceneId} 失败: HTTP ${response.status}`);
      const sceneData = await response.json();
      if (sceneData?.id !== sceneId || !Array.isArray(sceneData?.layers)) {
        throw new Error(`场景 ${sceneId} 的磁盘 canonical 数据无效`);
      }
      if (!isCurrent()) {
        this._debugCanonicalHotSync('superseded-after-fetch', { sceneId, revision, generation });
        return;
      }

      const diskLocalCoordinates = new Map();
      const rememberLocal = object => {
        if (!object?.id || (object.type !== 'ref' && object.type !== 'spawn')) return;
        diskLocalCoordinates.set(object.id, {
          x: Number.isFinite(object.x) ? object.x : null,
          y: Number.isFinite(object.y) ? object.y : null
        });
      };
      for (const layer of sceneData.layers) {
        for (const object of layer?.objects || []) rememberLocal(object);
      }

      const placements = this.context.services.placements;
      if (!placements) throw new Error('场景放置运行时尚未就绪');
      const previous = placements.getPlacements?.() || [];
      const previousById = new Map(
        previous.filter(entry => entry?.sceneId === sceneId).map(entry => [entry.id, entry])
      );
      previousSceneData = cloneData(session.getSceneData?.(sceneId));
      if (!previousSceneData) throw new Error(`场景 ${sceneId} 缺少可回滚的会话数据`);

      this._debugCanonicalHotSync('terrain-prepare-start', {
        sceneId,
        revision,
        generation,
        chunkKey: loadedChunk.key,
        regionId: loadedChunk.regionId,
        diskPlacementCount: diskLocalCoordinates.size
      });
      runtimeDraft = await streamingRuntime.prepareLoadedSceneData(sceneId, sceneData, {
        signal: controller?.signal || null
      });
      if (!isCurrent()) {
        runtimeDraft?.discard?.();
        this._debugCanonicalHotSync('terrain-prepare-superseded', { sceneId, revision, generation });
        return;
      }
      if (!runtimeDraft?.loaded) throw new Error(`场景 ${sceneId} 已不在当前加载范围`);
      if (!runtimeDraft.ok) {
        throw new Error(runtimeDraft.errors?.[0]?.message || `场景 ${sceneId} terrain 草稿准备失败`);
      }
      this._debugCanonicalHotSync('terrain-prepare-complete', {
        sceneId,
        revision,
        generation,
        chunkKey: loadedChunk.key,
        staticCacheRevision: runtimeDraft.terrain?.staticCacheRevision ?? null
      });

      const sessionOutcome = session.replaceSceneData?.(sceneId, sceneData);
      if (!sessionOutcome?.ok) {
        throw new Error(sessionOutcome?.errors?.[0]?.message || `场景 ${sceneId} 会话缓存替换失败`);
      }
      sessionCommitted = true;
      runtimeCommitAttempted = true;
      runtimeOutcome = runtimeDraft.commit?.();
      if (!runtimeOutcome?.loaded) throw new Error(`场景 ${sceneId} 已不在当前加载范围`);
      if (!runtimeOutcome.ok) {
        throw new Error(runtimeOutcome.errors?.[0]?.message || `场景 ${sceneId} 流式 terrain/投影替换失败`);
      }
      this._debugCanonicalHotSync('terrain-commit', {
        sceneId,
        revision,
        generation,
        chunkKey: loadedChunk.key,
        regionId: loadedChunk.regionId,
        terrainReplaced: runtimeOutcome.previousTerrain !== runtimeOutcome.terrain
      });

      const fresh = (placements.getPlacements?.() || [])
        .filter(entry => entry?.sceneId === sceneId);
      const freshById = new Map(fresh.map(entry => [entry.id, entry]));
      const freshIds = new Set(fresh.map(entry => entry?.id).filter(Boolean));
      const localPosition = entry => entry ? {
        x: Number.isFinite(entry._localX) ? entry._localX : null,
        y: Number.isFinite(entry._localY) ? entry._localY : null
      } : null;
      const origin = {
        x: Number.isFinite(loadedChunk.origin?.x) ? loadedChunk.origin.x : null,
        y: Number.isFinite(loadedChunk.origin?.y) ? loadedChunk.origin.y : null
      };
      const coordinateEpsilon = 0.001;
      const projectionChecks = fresh
        .filter(entry => entry?.id && diskLocalCoordinates.has(entry.id))
        .map(entry => {
          const disk = diskLocalCoordinates.get(entry.id);
          const local = localPosition(entry);
          const world = {
            x: Number.isFinite(entry.x) ? entry.x : null,
            y: Number.isFinite(entry.y) ? entry.y : null
          };
          const expectedWorld = Number.isFinite(disk?.x) && Number.isFinite(disk?.y)
            && origin.x !== null && origin.y !== null
            ? { x: disk.x + origin.x, y: disk.y + origin.y }
            : null;
          const localMatches = Number.isFinite(disk?.x) && Number.isFinite(disk?.y)
            && local?.x !== null && local?.y !== null
            && Math.abs(disk.x - local.x) <= coordinateEpsilon
            && Math.abs(disk.y - local.y) <= coordinateEpsilon;
          const worldMatches = expectedWorld && world.x !== null && world.y !== null
            && Math.abs(expectedWorld.x - world.x) <= coordinateEpsilon
            && Math.abs(expectedWorld.y - world.y) <= coordinateEpsilon;
          return {
            id: entry.id,
            disk,
            local,
            world,
            expectedWorld,
            localMatches,
            worldMatches
          };
        });
      const projectionMismatches = projectionChecks.filter(check => (
        !check.localMatches || !check.worldMatches
      ));
      if (projectionMismatches.length > 0) {
        this._debugCanonicalHotSync('placement-projection-invalid', {
          sceneId,
          revision,
          generation,
          origin,
          mismatches: projectionMismatches
        });
        throw new Error(`场景 ${sceneId} 的 canonical 坐标未按单次 worldOffset 投影: ${projectionMismatches.map(check => check.id).join(', ')}`);
      }
      this._debugCanonicalHotSync('placement-projection-verified', {
        sceneId,
        revision,
        generation,
        origin,
        checked: projectionChecks.length
      });

      const changedIds = fresh
        .filter(entry => {
          const old = previousById.get(entry.id);
          return !old || getPlacementSignature(old) !== getPlacementSignature(entry);
        })
        .map(entry => entry.id)
        .filter(Boolean);
      const changedPlacementIds = changedIds.filter(id => freshById.get(id)?.type === 'ref');
      const retiredIds = [...previousById.entries()]
        .filter(([id, entry]) => entry?.type === 'ref' && !freshIds.has(id))
        .map(([id]) => id);
      const coordinateChanges = [...new Set([...changedIds, ...retiredIds])].map(id => ({
        id,
        disk: diskLocalCoordinates.get(id) || null,
        previous: localPosition(previousById.get(id)),
        next: localPosition(freshById.get(id))
      }));
      this._debugCanonicalHotSync('placement-diff', {
        sceneId,
        revision,
        generation,
        changedIds,
        changedPlacementIds,
        retiredIds,
        coordinates: coordinateChanges
      });

      if (changedPlacementIds.length > 0 || retiredIds.length > 0) {
        this._debugCanonicalHotSync('placement-rebuild-start', {
          sceneId, revision, generation, changedIds, changedPlacementIds, retiredIds
        });
        placementRebuildOutcome = placements.rebuild(sceneId, {
          placementIds: changedPlacementIds,
          retiredPlacementIds: retiredIds,
          deferFinalize: true
        });
        const rebuildResult = placementRebuildOutcome;
        if (rebuildResult?.ok === false) {
          this._debugCanonicalHotSync('placement-rebuild-failed', {
            sceneId,
            revision,
            generation,
            changedIds,
            changedPlacementIds,
            retiredIds,
            outcomes: rebuildResult.outcomes || [],
            errors: rebuildResult.errors || []
          });
          throw new Error(rebuildResult.errors?.[0]?.message || `场景 ${sceneId} 放置对象重建失败`);
        }

        const changedOutcomes = new Map();
        for (const outcome of rebuildResult.outcomes || []) {
          if (!changedOutcomes.has(outcome.placementId)) changedOutcomes.set(outcome.placementId, []);
          changedOutcomes.get(outcome.placementId).push(outcome);
        }
        const liveCoordinateFailures = [];
        for (const id of changedPlacementIds) {
          const outcomes = changedOutcomes.get(id) || [];
          const accepted = outcomes.find(outcome => outcome.status === 'spawned')
            || outcomes.find(outcome => outcome.status === 'conditionFalse');
          if (!accepted) {
            liveCoordinateFailures.push({ id, reason: 'missingAcceptedOutcome', outcomes });
            continue;
          }
          if (accepted.status === 'conditionFalse'
            || accepted.tombstoned === true
            || accepted.restoredDynamicState === true) continue;
          const inspection = placements.inspectPlacement?.(id);
          if (!inspection?.live || inspection.matchesProjection !== true) {
            liveCoordinateFailures.push({
              id,
              reason: inspection?.live ? 'coordinateMismatch' : 'liveObjectMissing',
              actual: inspection?.actual || null,
              expected: inspection?.expected || null,
              outcomes
            });
          }
        }
        if (liveCoordinateFailures.length > 0) {
          this._debugCanonicalHotSync('placement-live-invalid', {
            sceneId,
            revision,
            generation,
            failures: liveCoordinateFailures
          });
          throw new Error(`场景 ${sceneId} 放置对象未落在最新 canonical 坐标: ${liveCoordinateFailures.map(entry => entry.id).join(', ')}`);
        }
        this._debugCanonicalHotSync('placement-rebuild-complete', {
          sceneId,
          revision,
          generation,
          changedIds,
          changedPlacementIds,
          retiredIds,
          counts: rebuildResult.counts || null,
          outcomes: rebuildResult.outcomes || [],
          skipped: rebuildResult.skipped || []
        });
      }

      const placementFinalizeResult = placementRebuildOutcome?.finalize?.() || { ok: true, errors: [] };
      if (placementFinalizeResult.ok === false) {
        throw new Error(placementFinalizeResult.errors?.[0]?.message || `场景 ${sceneId} 放置对象提交失败`);
      }
      // placement 提交后已没有可失败的业务步骤；旧 terrain 释放只做提交后清理，不能再反向破坏新投影。
      transactionFinalized = true;
      let terrainFinalizeResult = { ok: true, errors: [] };
      try {
        terrainFinalizeResult = runtimeOutcome.finalize?.() || terrainFinalizeResult;
        if (terrainFinalizeResult.ok === false) {
          console.warn('[DDScene][CanonicalHotSync] 旧 terrain 释放失败', {
            sceneId,
            errors: terrainFinalizeResult.errors || []
          });
        }
      } catch (finalizeError) {
        terrainFinalizeResult = {
          ok: false,
          errors: [{ message: finalizeError?.message || String(finalizeError) }]
        };
        console.warn('[DDScene][CanonicalHotSync] 旧 terrain 释放异常', {
          sceneId,
          error: finalizeError
        });
      }
      this._debugCanonicalHotSync('finalized', {
        sceneId,
        revision,
        generation,
        terrainFinalizeOk: terrainFinalizeResult.ok !== false,
        terrainSuperseded: terrainFinalizeResult.superseded === true,
        placementFinalizeOk: placementFinalizeResult.ok !== false
      });
      this._refreshCanonicalHotSyncMinimap(sceneId, 'commit');
      this._showScreenTip?.('编辑器场景改动已同步', { title: '场景同步' });
    } catch (error) {
      if (error?.name === 'AbortError' || !isCurrent()) {
        runtimeDraft?.discard?.();
        this._debugCanonicalHotSync(error?.name === 'AbortError' ? 'aborted' : 'superseded', {
          sceneId,
          revision,
          generation,
          reason: error?.message || null
        });
        return;
      }
      if (transactionFinalized) {
        console.warn('[DDScene] 编辑器场景已同步，但成功提示失败', error);
        return;
      }

      const rollbackErrors = [];
      let runtimeRestored = false;
      if (placementRebuildOutcome?.ok && typeof placementRebuildOutcome.rollback === 'function') {
        const restored = placementRebuildOutcome.rollback();
        if (restored?.ok === false && !restored.superseded) {
          rollbackErrors.push(restored.errors?.[0]?.message || '放置对象重建回滚失败');
        }
        this._debugCanonicalHotSync('placement-rollback', {
          sceneId,
          revision,
          generation,
          ok: restored?.ok === true,
          superseded: restored?.superseded === true
        });
      }
      if (runtimeOutcome?.ok && typeof runtimeOutcome.rollback === 'function') {
        const restored = runtimeOutcome.rollback();
        runtimeRestored = restored?.ok === true;
        if (restored?.ok === false && !restored.superseded) {
          rollbackErrors.push(restored.errors?.[0]?.message || '流式 terrain/投影回滚失败');
        }
        this._debugCanonicalHotSync('terrain-rollback', {
          sceneId,
          revision,
          generation,
          ok: restored?.ok === true,
          superseded: restored?.superseded === true
        });
      }
      if (sessionCommitted && previousSceneData) {
        const restored = session.replaceSceneData?.(sceneId, previousSceneData);
        if (restored?.ok === false) rollbackErrors.push(restored.errors?.[0]?.message || '会话缓存回滚失败');
      }
      if (runtimeRestored || (runtimeCommitAttempted && !runtimeOutcome?.superseded)) {
        this._refreshCanonicalHotSyncMinimap(sceneId, 'rollback');
      }

      const rollbackSuffix = rollbackErrors.length > 0 ? `；${rollbackErrors.join('；')}` : '';
      const message = `${error?.message || '编辑器场景改动同步失败'}${rollbackSuffix}`;
      console.warn('[DDScene] 应用编辑器场景改动失败', error, rollbackErrors);
      this._showScreenTip?.(message, { title: '场景同步失败' });
    } finally {
      runtimeDraft?.discard?.();
      if (controller && controllers.get(sceneId) === controller) controllers.delete(sceneId);
    }
  }

  async _prepareWorldStreamingManager(result, targetSceneId = this.currentSceneId, session = this._worldLoadSession) {
    return this.sanguoWorldRuntimeCoordinator.prepareWorldStreamingManager(result, targetSceneId, session);
  }

  async _initializeWorldStreaming(result, targetSceneId = this.currentSceneId, options = {}) {
    return this.sanguoWorldRuntimeCoordinator.initializeWorldStreaming(result, targetSceneId, options);
  }

  _syncWorldStreamingProjection() {
    return this.sanguoWorldRuntimeCoordinator.syncWorldStreamingProjection();
  }

  async _enterStreamedScene(sceneId) {
    return this.sanguoWorldRuntimeCoordinator.enterStreamedScene(sceneId);
  }

  enter(data = null) {
    // 父类仍负责 canvas/相机/输入与通用系统；Demo 初始化由协调器接手。
    super.enter(data);
    this.sanguoSceneLifecycleCoordinator.initializeEnteredRuntime();

    this.resourceScope?.track(() => this.sanguoSceneLifecycleCoordinator.disposeEnteredRuntime());

    // 世界 offset 在 ProjectWorldIndex 构建成功后派生；这里不预写 Demo 尺寸或入口。

    // 地形实例在 _loadWorldTerrains 中动态创建
    this.terrain = null;
    this._terrains = [];
    this._worldRegion = null;
    this._minimapBackgroundActivation = null;

    // 每次 enter 都创建独立 session；地形与放置点只共享这一份世界加载 Promise。
    const scope = this.resourceScope;
    this._worldLoadSession = this._createWorldLoadSession(scope);
    // 编辑器热同步只接受带 provenance/revision 的 canonical Vite HMR 提交。
    const editorSceneSyncUnwatch = this._watchEditorSceneCommits();
    this._editorSceneSyncUnwatch = editorSceneSyncUnwatch;
    scope?.track?.(editorSceneSyncUnwatch);
    this._worldReadyGate = new WorldReadyGate({
      required: ['terrains', 'placements'],
      timeout: 3000,
      scope,
      onReady: () => this._syncWorldReadyProjection(),
      onTimeout: () => this._syncWorldReadyProjection()
    });
    this.context.services.worldReadyGate = this._worldReadyGate;
    // wait() 在 timeout/dispose 时会 reject；显式消费，避免未处理 rejection。
    this._worldReadyGate.wait().catch(() => {});
    this._sceneReady = false;
    this._terrainsLoaded = false;
    this._spawnApplied = false;
    this._pendingChunkDomainStates = new Map();
    this._regionDynamicStates = new Map();
    this._currentRegionIndex = -1;
    this._worldLoadResult = null;
    this._navigationProjection = new SceneNavigationProjection({
      getCurrentSceneId: () => this.currentSceneId,
      setCurrentSceneId: sceneId => { this.currentSceneId = sceneId; },
      getStoryState: () => this.gameLoader?.blackboard?.get?.('storyState') || null,
      setStoryState: storyState => this.gameLoader?.blackboard?.set?.('storyState', storyState),
      onSceneChanged: sceneId => this._s09AudioDirector?.syncScene?.(sceneId)
    });
    this.context.services.navigationProjection = this._navigationProjection;
    this._regionCoordinator = new RegionCoordinator({
      createSession: () => this._createWorldLoadSession(this.resourceScope),
      getCurrentSession: () => this._worldLoadSession,
      captureDraft: () => ({
        saveState: this.captureSaveState(),
        worldResult: this._worldLoadResult,
        regionIndex: this._currentRegionIndex
      }),
      validateTarget: context => this.sanguoWorldRuntimeCoordinator.validateRegionTarget(context),
      commitTarget: context => this.sanguoWorldRuntimeCoordinator.commitRegionTarget(context),
      restoreDraft: context => this.sanguoWorldRuntimeCoordinator.restoreRegionDraft(context)
    });

    const placements = new ScenePlacementRuntime({
      scope,
      entityFactory: this.entityFactory,
      entityStore: this.entityStore,
      aiSystem: this.aiSystem,
      corpseRuntime: this.context.services.corpses || this.corpseRuntime,
      assetManager: this.assetManager,
      getWorldPromise: () => this._worldLoadPromise,
      getLoadedChunks: () => this.worldStreamingManager?.getLoadedChunks?.() || new Map(),
      getRegistries: () => this.gameLoader?.registries || {},
      validatePlacementReferences: values => this.gameLoader?.validatePlacementReferences?.(values)
        || { ok: true, errors: [] },
      setValidationErrors: errors => {
        if (this.gameLoader) this.gameLoader.lastValidationErrors = errors;
      },
      getConditionRoot: key => this.gameLoader?.blackboard?.get?.(key),
      getCurrentSceneId: () => this.currentSceneId,
      getPlayer: () => this.playerEntity,
      getCamera: () => this.camera,
      consumeInitialPlayerSpawn: () => { this._initialPlayerSpawnPending = false; },
      getPlayerStartMode: () => this._playerStartMode,
      onWorldPropSpawn: detail => {
        if (detail.definition?.semanticRole !== 'campfire') return;
        this._campfireService.setPosition(detail.definition.position);
      },
      syncProjection: () => this._syncWorldStreamingProjection(),
      clearProjectionBindings: () => this._sceneTriggerBindings?.setBindings?.([]),
      getReadyGate: () => this._worldReadyGate,
      onProjectionReady: () => this._syncWorldReadyProjection(),
      onNpcImageError: scope?.guard(({ url }) => {
        console.warn('[DDScene] NPC 图集加载失败（将用占位）:', url);
      }),
      onSpawn: detail => this._placementCoordinator.handleSpawn(detail),
      onRemove: values => this._placementCoordinator.removeValues(values),
      logger: console
    });
    this.context.services.placements = placements;
    scope?.track(() => placements.dispose());
    this._chunkNavigator = new ChunkNavigator({
      getWorldIndex: () => this._worldLoadResult?.worldIndex || this._worldLoadSession?._lastResult?.worldIndex || null,
      getChunk: sceneId => this._worldLoadSession?.getChunk(sceneId),
      findSpawn: (sceneId, spawnRef) => this._worldLoadSession?.findSpawn(sceneId, spawnRef),
      getPlayer: () => this.playerEntity,
      getCamera: () => this.camera,
      prepareTarget: async ({ x, y }) => {
        if (!this.worldStreamingManager) {
          return { ok: false, errors: [{ code: 'streamingUnavailable', path: 'world', message: '世界流式加载尚未就绪' }] };
        }
        const result = await this.worldStreamingManager.update(x, y);
        if (result?.ok === false) return result;
        this._syncWorldStreamingProjection();
        const placementResult = await this.context.services.placements?.spawnLoadedChunks();
        if (placementResult?.ok === false) return placementResult;
        return { ok: true };
      },
      captureState: () => ({
        ...this._navigationProjection.capture(),
        worldStreamingState: cloneData(this.worldStreamingManager?.serialize?.())
      }),
      restoreState: snapshot => {
        if (!snapshot) return;
        if (snapshot.worldStreamingState && this.worldStreamingManager?.deserialize) {
          const restored = this.worldStreamingManager.deserialize(snapshot.worldStreamingState);
          if (restored?.ok === false) {
            throw new Error(restored.errors?.[0]?.message || '世界流式状态回滚失败');
          }
          this._syncWorldStreamingProjection();
        }
        this._navigationProjection.restore(snapshot);
      },
      onSceneEnter: async ({ sceneId, x, y }) => {
        this._navigationProjection.apply({ sceneId, projectStory: false });
        const placementResult = await this.context.services.placements?.spawnLoadedChunks();
        if (placementResult?.ok === false) {
          throw new Error(placementResult.errors?.[0]?.message || '地图块放置点生成失败');
        }
        const runtimeProjection = await this.sanguoSceneNavigationCoordinator.projectEntryRuntime(sceneId);
        if (runtimeProjection?.ok === false) {
          throw new Error(runtimeProjection.code || '地图块运行时投影失败');
        }
        const domainRestore = await this._restoreStreamedDomainState(sceneId);
        if (domainRestore?.ok === false) {
          throw new Error(domainRestore.errors?.[0]?.message || domainRestore.code || '区块领域状态恢复失败');
        }
        this._navigationProjection.apply({ sceneId });
        console.log(`[DDScene] teleportToChunk → ${sceneId} (${x}, ${y})`);
      },
      onFallback: ({ reason, sceneId }) => {
        if (reason === 'missingSceneId') {
          console.warn('[DDScene] teleportToChunk: 缺少 scene 参数');
          return null;
        }
        // Act 推进必须走已配置的 chunk；不能将未知 ID 误当作旧独立场景切换。
        console.warn('[DDScene] teleportToChunk: 在 grid 中未找到', sceneId);
        return null;
      },
      transition: (type, commit) => type === 'fadeBlack' ? this._fadeTransition(commit) : commit()
    });
    this._scenarioCommandService = new ScenarioCommandService({
      dialogueSystem: this.dialogueSystem,
      tutorialSystem: this.tutorialSystem,
      getChunkNavigator: () => this._chunkNavigator,
      getRegionCoordinator: () => this._regionCoordinator,
      getWorldIndex: () => this._worldLoadResult?.worldIndex || null,
      getCurrentRegionIndex: () => this._currentRegionIndex,
      getSaveGameService: () => this._saveGameService,
      getSnapshotManager: () => this.sceneRuntime?.snapshotManager || null
    });
    this.context.services.scenarioCommands = this._scenarioCommandService;
    const unsubscribeNavigationEvents = this.sceneRuntime?.notificationBus?.subscribe(async event => {
      if (event?.value?.type !== SCENARIO_COMMANDS.WORLD_TELEPORT) return;
      const outcome = event.value.payload?.value || {};
      const sceneId = outcome.sceneId || outcome.request?.sceneId || null;
      await this._forwardCommittedSceneEnter(sceneId);
    });
    if (unsubscribeNavigationEvents) this.resourceScope?.track(unsubscribeNavigationEvents);
    for (const commandType of Object.values(SCENARIO_COMMANDS)) {
      this.sceneRuntime.registerCommandHandler(commandType, this._scenarioCommandService);
    }
    this._canonicalStateTransactions = new CanonicalStateTransactionService({
      definitionRepository: {
        get: (kind, id) => this.gameLoader?.definitionRepository?.get?.(kind, id) || null
      },
      getBlackboard: () => this.gameLoader?.blackboard || null,
      getInventory: () => this.playerEntity?.getComponent?.('inventory') || null,
      inventoryTransactions: this.inventoryTransactions,
      getItem: itemId => this.gameLoader?.getRegistry?.('items')?.get?.(itemId) || null,
      tutorialComplete: id => this._tutorialFlow?.isCompleted?.(id) === true,
      executeScenarioCommand: (intentType, payload, command) => this._executeScenarioCommand(
        intentType,
        payload,
        `${command.operationId}:${intentType}`
      )
    });
    this.sceneRuntime.registerCommandHandler('state.transaction', this._canonicalStateTransactions);
    this.context.services.canonicalStateTransactions = this._canonicalStateTransactions;
    this._sanguoDomainFacade = new SanguoDomainCommandFacade(this);
    this._domainCommandService = new DomainCommandService({
      statePrefix: 'sanguo:command',
      ports: Object.fromEntries([
        'scenario.command', 'battle.command', 'rescue.command', 'construction.command',
        'vehicle.command', 'ending.command'
      ].map(commandType => [commandType, this._sanguoDomainFacade]))
    });
    this.context.services.domainCommands = this._domainCommandService;
    for (const commandType of ['scenario.command', 'battle.command', 'rescue.command', 'construction.command', 'vehicle.command', 'ending.command']) {
      this.sceneRuntime.registerCommandHandler(commandType, this._domainCommandService);
    }
    this._worldLoadPromise = this._worldLoadSession
      .load({ projectUrl: 'game.project.json', sceneIds: 'entry' })
      .then(async result => {
        const validated = this._validateWorldLoadResult(result);
        this._worldLoadResult = validated;
        this._worldIndex = validated.worldIndex;
        const entry = validated.worldIndex.getEntry();
        this.currentSceneId = entry.sceneId;
        this._currentRegionIndex = entry.regionIndex;
        this._prologueOffset = entry.offset;
        await this._initializeWorldStreaming(validated);
        return validated;
      });
    this._loadWorldTerrains();

    // 火焰帧图在 Manifest 注册完成后按稳定资源 ID 注入框架火堆服务。
    // 火堆初始熄灭：由数据驱动的 interact 触发器点燃（靠近按 E），或 timer 自燃兜底

    // 由框架 placement runtime 等待世界加载、投影出生点并解析 ready gate。
    void this.context.services.placements?.loadProjection({
      consumePlayerSpawn: this._initialPlayerSpawnPending === true
    });

    // 数据驱动：装配 GameProject 触发器/黑板/对话，fire(sceneEnter)
    this._initGameLoader();

    console.log('DataDrivenPrologueScene: 进入（数据驱动序章）');
  }

  update(deltaTime) {
    if (!this.isActive) return;
    if (this.isPaused) {
      this.discardPausedInput?.();
      return;
    }

    // 顶层输入流程必须在本场景读取 E/N/反引号之前启动；同帧 super.update 会被守卫跳过。
    this._beginInputFrame(deltaTime);

    // 必须在任何提前返回或 inputManager.update() 之前读取，否则本帧按下状态会被清空。
    const debugPanelKeyPressed = !!this.inputManager?.isKeyPressed?.('`');
    if (debugPanelKeyPressed) {
      console.log('[DDScene][DebugPanel] update 捕获反引号，准备切换面板', {
        scene: this.name,
        isActive: this.isActive,
        isPaused: this.isPaused,
        isTransitioning: this.isTransitioning,
        transitionPhase: this.transitionPhase,
        panelExists: !!this.debugPanel,
        visibleBefore: this.debugPanel?.visible ?? false
      });
      this._toggleDebugPanel();
    }

    // 轮盘已在帧首处理 LB 输入；冻结剧情与环境更新，但保留调试面板和后续帧的手柄轮询。
    if (this.isSkillWheelWorldPaused) {
      this._inputFlow?.flush?.();
      return;
    }

    // 传送淡黑效果更新
    this._updateTeleportFade(deltaTime);

    if (this.isTransitioning &&
        (this.transitionPhase === 'show_text' || this.transitionPhase === 'switch_scene')) {
      // 转场提前返回只结束本次输入编排，绝不调用 inputManager.update() 清帧。
      this._inputFlow?.releaseFrame?.();
      return;
    }

    // 玩家实体就绪后同步到触发器上下文（保证 giveReward/heal 等动作能拿到 ctx.player）
    if (this.gameLoader && this.playerEntity && !this._playerCtxSynced) {
      this.gameLoader.updateContext({ player: this.playerEntity });
      this._playerCtxSynced = true;
    }

    const frameProfile = this.debugMode === true && this._framePerformanceProfile?.current
      ? this._framePerformanceProfile.current
      : null;

    // Demo 环境、时间、职业 UI 与领域入口通知由协调器处理；输入和转场控制仍留在 Scene 顶层。
    let phaseStartedAt = frameProfile ? performance.now() : 0;
    this.sanguoSceneLifecycleCoordinator.updateBeforeBase(deltaTime);
    if (frameProfile) frameProfile.updateDemoBeforeBase = performance.now() - phaseStartedAt;

    // 通用可玩管线（移动/战斗/相机含 postCameraUpdate/渲染系统/粒子等）
    // 注：基类 super.update 内部已驱动 this.gameLoader.update（timer 触发器），此处无需重复调
    phaseStartedAt = frameProfile ? performance.now() : 0;
    super.update(deltaTime);
    if (frameProfile) frameProfile.updateBaseFrame = performance.now() - phaseStartedAt;

    // 基类完成通用帧后，再由 Demo coordinator 驱动营建、载具、救援、结局和领域观察。
    phaseStartedAt = frameProfile ? performance.now() : 0;
    this.sanguoSceneLifecycleCoordinator.updateAfterBase(deltaTime);
    if (frameProfile) frameProfile.updateDemoAfterBase = performance.now() - phaseStartedAt;
  }

  /** 波次事件由放置点 coordinator 扫描分组，Scene 仅注入 trigger 与死亡谓词。 */
  _checkWaveEvents() {
    return this.sanguoSceneLifecycleCoordinator.observeWaveEvents();
  }

  /** S14 武器席优先消费手柄/触屏方向攻击，避免再触发乘员个人武器。 */
  handleBasicAttackIntent(intent = {}) {
    return this.sanguoSceneCommandCoordinator.handleBasicAttackIntent(intent);
  }

  /** S14 gunner 指针意图和 S01 教学许可均由 Demo coordinator 投影。 */
  canPerformBasicAttack() {
    return this.sanguoSceneCommandCoordinator.canPerformBasicAttack();
  }

  /** 采集的场景政策与结局隐藏输入均由 Demo 命令协调器组合。 */
  prepareGatheringSettlement(context = {}) {
    return this.sanguoSceneCommandCoordinator.prepareGatheringSettlement(context);
  }

  /** 当前 canonical 区块的采集政策由 Demo 命令协调器路由；保留兼容入口。 */
  _prepareSceneGatheringSettlement(context = {}) {
    return this.sanguoSceneCommandCoordinator.prepareSceneGatheringSettlement(context);
  }

  _grantGatheringProficiency(data = {}) {
    return this.sanguoSceneCommandCoordinator.grantGatheringProficiency(data);
  }

  /** 框架采集回调入口；S01–S14 领域反馈由命令 coordinator 路由。 */
  onGatheringEvent(event, data = {}) {
    if (!this.sanguoSceneCommandCoordinator.shouldForwardGatheringEvent(event, data)) return;
    super.onGatheringEvent(event, data);
    void this.sanguoSceneCommandCoordinator.handleGatheringEvent(event, data).catch(error => {
      console.error('[DataDrivenPrologueScene] 采集提交后流程异常:', error);
      this.notificationSystem?.addError?.('采集已结算，但后续剧情处理失败；系统会保留已提交资源并允许后续补偿。');
    });
  }

  /**
   * ① 渐进提示事件源：
   *   - playerMoved：玩家离开出生点一定距离 → fire('playerMoved')（一次）
   *   - panelOpen：背包/属性面板打开 → fire('panelOpen', {panel:'inventory'|'stats'})
   * @private
   */
  _checkTutorialEventSources() {
    return this.sanguoSceneLifecycleCoordinator.observeTutorialEventSources();
  }

  /** 已提交导航后的内容通知由 Demo 世界协调器拥有。 */
  async _forwardCommittedSceneEnter(sceneId) {
    return this.sanguoWorldRuntimeCoordinator.forwardCommittedSceneEnter(sceneId);
  }

  async _executeScenarioCommand(intentType, payload = {}, operationId = null) {
    const gateway = this.sceneRuntime?.commandGateway;
    const actorRef = this.playerEntity;
    if (!gateway || !actorRef?.id) {
      return { ok: false, code: 'scenarioCommandUnavailable', error: { message: '场景命令端口不可用' } };
    }
    const normalizedPayload = intentType === SCENARIO_COMMANDS.WORLD_TELEPORT
      ? { ...payload, sceneId: payload.sceneId || payload.scene }
      : { ...payload };
    const generatedOperationId = operationId || `scene:${intentType}:${actorRef.id}:${++this._scenarioCommandSequence}`;
    return gateway.execute({
      intentType,
      actorRef,
      operationId: generatedOperationId,
      payload: normalizedPayload
    });
  }

  /**
   * 大地图内传送兼容入口：仍由 ChunkNavigator/RegionCoordinator 完成，
   * 但所有调用统一经 world.teleport CommandGateway。
   * @param {Object} p - { scene, spawnRef, x, y, transition, region }
   * @returns {Promise<Object>}
   */
  async teleportToChunk(p = {}) {
    const result = await this._executeScenarioCommand(
      SCENARIO_COMMANDS.WORLD_TELEPORT,
      p,
      p.operationId || null
    );
    if (!result?.ok) {
      return {
        ok: false,
        cancelled: true,
        code: result?.code || 'worldTeleportRejected',
        errors: result?.error ? [{ code: result.code || 'worldTeleportRejected', message: result.error.message }] : []
      };
    }
    return result.value || { ok: true };
  }

  /** 跨 Region 存档预准备由世界协调器拥有；保留 BaseGameScene 调用的兼容入口。 */
  _findRegionIndexForScene(sceneId) {
    return this.sanguoWorldRuntimeCoordinator.findRegionIndexForScene(sceneId);
  }

  async prepareRestoreRegion(saveState = {}) {
    return this.sanguoWorldRuntimeCoordinator.prepareRestoreRegion(saveState);
  }

  async travelToRegion({ sceneId, spawnRef = 'player' } = {}) {
    const result = await this.teleportToChunk({ scene: sceneId, spawnRef });
    if (!result?.ok) {
      const message = result?.errors?.[0]?.message || `无法进入 ${sceneId || '目标区域'}`;
      this._showScreenTip(message, { title: '大区切换失败' });
      return result || { ok: false, errors: [{ code: 'regionCoordinatorUnavailable', path: 'region', message }] };
    }
    return result;
  }

  /** 跨 Region 的 Demo 状态校验、提交与回滚由世界协调器拥有；保留兼容入口。 */
  async _validateRegionTarget(context) {
    return this.sanguoWorldRuntimeCoordinator.validateRegionTarget(context);
  }

  _extractRegionDynamicState(sceneState = {}) {
    return this.sanguoWorldRuntimeCoordinator.extractRegionDynamicState(sceneState);
  }

  _clearRegionRuntime(result = this._worldLoadResult) {
    return this.sanguoWorldRuntimeCoordinator.clearRegionRuntime(result);
  }

  async _commitRegionTarget(context) {
    return this.sanguoWorldRuntimeCoordinator.commitRegionTarget(context);
  }

  async _restoreRegionDraft(context) {
    return this.sanguoWorldRuntimeCoordinator.restoreRegionDraft(context);
  }

  getDeathDropPresentation() {
    return this.sanguoWorldRuntimeCoordinator.getDeathDropPresentation();
  }

  resolvePlayerRespawnPosition() {
    return this._s01s02Coordinator.resolveRespawnPosition()
      || super.resolvePlayerRespawnPosition();
  }

  /** Demo 专属运行状态由显式 coordinator 组合；玩家/任务/黑板仍由 BaseGameScene 统一保存。 */
  captureSceneSaveState() {
    return this.sanguoSceneStateFlow.captureSceneSaveState();
  }

  restoreSceneSaveState(data = {}) {
    return this.sanguoSceneStateFlow.restoreSceneSaveState(data);
  }

  /** 唯一提交后 application event 入口；历史剧情派生由 Demo coordinator 处理。 */
  onApplicationEvent(event) {
    return this.sanguoSceneStateFlow.handleApplicationEvent(event);
  }

  /** 迁移兼容入口；正式拾取事实来自 PostCommitNotificationBus 的 item.picked。 */
  onWorldItemPicked(item) {
    return this.sanguoSceneStateFlow.handleWorldItemPicked(item);
  }

  /** 已提交的物品使用先保留框架表现，再交给 S01 历史流程协调器。 */
  onItemUsed(item, healAmount, manaAmount) {
    const result = super.onItemUsed(item, healAmount, manaAmount);
    void this._s01s02Coordinator.handleItemUsed(item);
    return result;
  }

  /** CombatSystem 的统一击杀出口；首狼尸体与剥皮任务由 Demo coordinator 编排。 */
  onEnemyKilled(entity) {
    void this._s01s02Coordinator.handleEnemyKilled(entity);
  }

  /**
   * NPC 忙碌台词的纯表现 adapter；节流和可交互判定由 SceneNpcInteractionFlow 统一拥有。
   * @private
   */
  _presentNpcIdleText(npc, text) {
    return this.sanguoSceneLifecycleCoordinator.presentNpcIdleText(npc, text);
  }

  /** 框架装备回调入口；已提交的内容 trigger 映射由 Demo 状态协调器拥有。 */
  onEquipmentChanged(messages, info = null) {
    super.onEquipmentChanged(messages, info);
    return this.sanguoSceneStateFlow.handleEquipmentChanged(info);
  }

  /** GameProject 装配由 Demo coordinator 拥有；保留场景兼容入口。 */
  _initGameLoader() {
    return this.sanguoGameLoaderCoordinator.initializeGameLoader();
  }

  /** Demo 共享玩法注入由 GameLoader coordinator 拥有；保留兼容入口。 */
  _configureSharedClassEffects(gameLoader) {
    return this.sanguoGameLoaderCoordinator.configureSharedClassEffects(gameLoader);
  }

  /** 由显式 Demo coordinator 装配战役定义、通用运行时与历史策略。 */
  async _installBattleFlow(gameLoader) {
    return this.s03s14BattleCoordinator.initialize(gameLoader);
  }

  /** 从当前磁盘场景投影中解析最近的可攀爬面；目标坐标只应用一次 chunk offset。 */
  /**
   * 在没有更高优先级空间 trigger 提示时显示攀爬操作；文案保留 InputHints token，
   * 由 SceneHintPresenter 按当前输入设备格式化。
   * @private
   */
  _updateClimbPrompt() {
    return this.sanguoSceneLifecycleCoordinator.updateClimbPrompt();
  }

  resolveClimbTarget({ entity } = {}) {
    return this._worldQuery.resolveClimbTarget({ entity });
  }

  /** SceneVehicleRuntime 的 Demo 世界编排归属 SanguoWorldRuntimeCoordinator；保留兼容入口。 */
  _getSceneVehicleDefinitions(sceneId = this.currentSceneId) {
    return this.sanguoWorldRuntimeCoordinator.getSceneVehicleDefinitions(sceneId);
  }

  _ensureSceneVehicleEntities(sceneId = this.currentSceneId) {
    return this.sanguoWorldRuntimeCoordinator.ensureSceneVehicleEntities(sceneId);
  }

  _disposeSceneVehicles(sceneId, definitionId = null) {
    return this.sanguoWorldRuntimeCoordinator.disposeSceneVehicles(sceneId, definitionId);
  }

  _disposeAllSceneVehicles() {
    return this.sanguoWorldRuntimeCoordinator.disposeAllSceneVehicles();
  }

  _resolveVehicleInventoryOwnerId(inventory) {
    return this.sanguoWorldRuntimeCoordinator.resolveVehicleInventoryOwnerId(inventory);
  }

  _captureSceneVehicleStates(sceneId = this.currentSceneId) {
    return this.sanguoWorldRuntimeCoordinator.captureSceneVehicleStates(sceneId);
  }

  _validateSceneVehicleStates(sceneId, states, logisticsState = null) {
    return this.sanguoWorldRuntimeCoordinator.validateSceneVehicleStates(sceneId, states, logisticsState);
  }

  _restoreSceneVehicleStates(sceneId, states = [], logisticsState = null) {
    return this.sanguoWorldRuntimeCoordinator.restoreSceneVehicleStates(sceneId, states, logisticsState);
  }

  // S14 编排兼容入口；状态所有权已经统一到 scene vehicle store。
  _getS14VehicleDefinitions() { return this._getSceneVehicleDefinitions('S14'); }
  _ensureS14VehicleEntities() { return this._ensureSceneVehicleEntities('S14'); }
  _disposeS14Vehicles() { return this._disposeSceneVehicles('S14'); }
  _captureS14VehicleStates() { return this._captureSceneVehicleStates('S14'); }
  _validateS14VehicleStates(states, logisticsState = null) {
    return this._validateSceneVehicleStates('S14', states, logisticsState);
  }
  _restoreS14VehicleStates(states = [], logisticsState = null) {
    return this._restoreSceneVehicleStates('S14', states, logisticsState);
  }

  async _handleIrreversibleChoiceCommand(command = {}) {
    return this.sanguoSceneCommandCoordinator.handleIrreversibleChoice(command);
  }


  _ensureClassSystem() {
    return this.s09ClassSelectionCoordinator.ensureClassSystem();
  }

  /** 职业技能投影由 S09 coordinator 拥有；保留其他 Demo 调用方的兼容入口。 */
  _syncUnlockedClassSkills() {
    return this.s09ClassSelectionCoordinator.syncUnlockedClassSkills();
  }

  /** AbilitySystem 的 Demo 出口；职业专属行为由 S09 coordinator 处理。 */
  executeAbility(context = {}) {
    return this.s09ClassSelectionCoordinator.executeAbility(context);
  }

  _findResourceNodeNear(position, radius = 72) {
    return this.s09ClassSelectionCoordinator.findResourceNodeNear(position, radius);
  }

  _findGuardNear(position, radius = 180) {
    return this.s09ClassSelectionCoordinator.findGuardNear(position, radius);
  }

  onGatheringPuppetEvent(event, data = {}) {
    return this.s09ClassSelectionCoordinator.handleGatheringPuppetEvent(event, data);
  }

  onAbilityEvent(_event, _data = {}) {}

  /** 安装统一成长面板；UI 只经 ViewModel 调用成长领域命令。 */
  _installProgressionUI(gameLoader) {
    return this.sanguoProgressionPresentationCoordinator.installProgressionUI(gameLoader);
  }

  /** S09 城市摘要属于饥民/CityState 表现投影；保留 Scene 兼容入口。 */
  _installCityStateSummaryUI(gameLoader) {
    return this.s09RefugeeCoordinator.installCitySummaryUI(gameLoader);
  }

  _updateCityStateSummary() {
    return this.s09RefugeeCoordinator.updateCitySummary();
  }

  /** 新档只在成长账本首次建立前发放四类独立起始点；读档永不发放。 */
  _grantStarterProgressionPoints(progressionSystem, characterId) {
    return this.sanguoProgressionPresentationCoordinator.grantStarterProgressionPoints(
      progressionSystem,
      characterId
    );
  }

  /** 通用空间 action 注册由 GameLoader coordinator 拥有；保留兼容入口。 */
  _registerGameLoaderActions(triggerSystem) {
    return this.sanguoGameLoaderCoordinator.registerGameLoaderActions(triggerSystem);
  }

  /** 职业事实到玩家基础动画外观挂点的唯一投影入口。 */
  _syncPlayerClassAppearance(classId = null) {
    return this.s09ClassSelectionCoordinator.syncPlayerClassAppearance(classId);
  }

  /** S09 职业确认表现由专属 coordinator 拥有；保留触发器兼容入口。 */
  _showClassConfirmation(payload = {}) {
    return this.s09ClassSelectionCoordinator.showConfirmation(payload);
  }

  _classModalLayout() {
    return this.s09ClassSelectionCoordinator.getConfirmationLayout();
  }

  _updateClassConfirmationHover() {
    return this.s09ClassSelectionCoordinator.updateConfirmationHover();
  }

  /** 框架 MODAL_UI 钩子；Demo UI 的优先级分发由生命周期协调器拥有并吞掉世界输入。 */
  handleModalInput(context = {}) {
    return this.sanguoSceneLifecycleCoordinator.handleModalInput(context);
  }

  _updateClassConfirmation() {
    return this.s09ClassSelectionCoordinator.updateConfirmation();
  }

  async _confirmClassSelection(classId) {
    return this.s09ClassSelectionCoordinator.confirmSelection(classId);
  }

  _presentClassSelectionCommitted(classType) {
    return this.s09ClassSelectionCoordinator.presentSelectionCommitted(classType);
  }

  _renderClassConfirmation(ctx) {
    return this.s09ClassSelectionCoordinator.renderConfirmation(ctx);
  }

  /** 父类世界加载稳定钩子；三国配置消费者由 Demo 世界协调器拥有。 */
  configureWorldRuntimeFromLoad(_result) {
    return this.sanguoWorldRuntimeCoordinator.configureWorldRuntimeFromLoad();
  }

  /** 框架渲染稳定钩子；三国 UI 层的排序由 Demo 生命周期协调器拥有。 */
  renderPostPipeline(ctx) {
    return this.sanguoSceneLifecycleCoordinator.renderPostPipeline(ctx);
  }

}

export default DataDrivenPrologueScene;

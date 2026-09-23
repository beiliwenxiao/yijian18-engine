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

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { SceneGameLoaderBridge } from '../../../src/core/scene/SceneGameLoaderBridge.js';
import { registerSceneTriggerActions } from '../../../src/core/scene/SceneTriggerActionProvider.js';
import { SCENARIO_COMMANDS } from '../../../src/systems/ScenarioCommandService.js';
import { SANGUO_ZHANGJIAO_CONTENT_POLICY } from '../config/SanguoZhangjiaoContentPolicy.js';
import { S05_ZHANG_MANCHENG_RESCUE_ID } from './S05SceneFlow.js';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * 《三国张角传》的 GameProject 装配协调器。
 * Bridge、共享玩法配置和通用空间 action 的生命周期由此统一管理；历史条件仅通过
 * 已注入的 Demo coordinator 回调参与，框架不依赖任何 S01–S14 内容。
 */
export class SanguoGameLoaderCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, {
      initializeGameLoader,
      configureSharedClassEffects,
      registerGameLoaderActions,
      fireSceneEnterTriggers
    }, { name: 'SanguoGameLoaderCoordinator' });
  }
}

/**
 * 隐藏加载屏后由 initGame 调用（fire-and-forget）：sceneEnter 触发器
 * （任务启动/初始生成/intro 编排）在玩家可见画面上运行。
 * 编排触发器含「等待对话/教程完成」步骤，必须等玩家看到画面并交互后才继续。
 */
async function fireSceneEnterTriggers() {
  const gameLoader = this.gameLoader;
  if (!gameLoader?.triggerSystem) return { ok: false, code: 'gameLoaderUnavailable' };
  const sceneId = this.currentSceneId;
  if (!sceneId) return { ok: false, code: 'sceneIdUnavailable' };
  const sceneEnterResult = await gameLoader.triggerSystem.fireAndWait('sceneEnter', { sceneId });
  if (!sceneEnterResult.ok) {
    console.error('[DDScene][GameLoader] sceneEnter 触发器执行失败:', sceneId, sceneEnterResult.records);
    return { ok: false, code: 'sceneEnterTriggerFailed', records: sceneEnterResult.records };
  }
  console.log('%c[DDScene][GameLoader] sceneEnter 触发器已执行:', 'color:#4CAF50', sceneId);
  return { ok: true, ...sceneEnterResult };
}

function initializeGameLoader() {
  try {
    const engine = window.gameEngine;
    const bridge = new SceneGameLoaderBridge({
      scope: this.resourceScope,
      loaderConfig: { contentPolicy: SANGUO_ZHANGJIAO_CONTENT_POLICY },
      dialogueSystem: this.dialogueSystem,
      deps: {
        dialogueSystem: this.dialogueSystem,
        tutorialSystem: this.tutorialSystem,
        questSystem: this.questSystem,
        commandGateway: this.sceneRuntime?.commandGateway || null,
        eventJournal: this.sceneRuntime?.eventJournal || null,
        combatSystem: this.combatSystem,
        sceneManager: engine ? engine.sceneManager : (this.sceneManager || null),
        audioManager: this.audioManager || (engine && engine.audioManager) || null,
        floatingText: this.floatingTextManager,
        scene: this.$scene,
        sceneDiagnostics: this._diagnostics
      },
      onShowTip: text => this._showScreenTip(text || ''),
      onItemGained: (item, player) => this.onItemGained(item, player || this.playerEntity),
      getPlayer: () => this.playerEntity || null
    });
    this._gameLoaderBridge = bridge;
    this.resourceScope?.track(() => bridge.dispose());

    const ready = bridge.initialize({
      projectUrl: 'game.project.json',
      sceneFlag: 'ddScene',
      registerActions: triggerSystem => this.registerGameLoaderActions(triggerSystem),
      onReady: async (gameLoader, triggerSystem) => {
        this.gameLoader = gameLoader;
        this.sceneRuntime.commandGateway.definitionRepository = gameLoader.definitionRepository;
        this.sceneRuntime.authoritySnapshotService.getDefinitionRevision = () => (
          gameLoader.definitionRepository?.definitionRevision ?? 0
        );
        const taskDefinitions = [
          ...(gameLoader.project?.taskGraphs || []),
          ...(gameLoader.questTaskDefinitions || [])
        ];
        const preparedTaskGraphs = this.sceneRuntime?.taskGraphSystem?.prepareDefinitions?.(taskDefinitions);
        if (preparedTaskGraphs?.ok === false) {
          throw gameLoader.createValidationError(preparedTaskGraphs.errors || []);
        }
        preparedTaskGraphs?.commit?.();
        this.context.services.taskGraph = this.sceneRuntime?.taskGraphSystem || null;
        this._campaignContentAuthorityOff?.();
        const campaignContentAuthorityOff = this.sceneRuntime.authoritySnapshotService.registerService('campaignContent', {
          snapshot: metadata => {
            const running = gameLoader.triggerSystem?.ledger?.all?.()
              ?.filter(record => record?.status === 'running') || [];
            if (running.length > 0) {
              const error = new Error('AuthoritySnapshot 拒绝捕获运行中的 ScenarioExecutionLedger');
              error.code = 'scenarioExecutionBusy';
              error.triggerIds = running.map(record => record.triggerId);
              throw error;
            }
            return gameLoader.serialize(this.playerEntity?.id || null, metadata);
          },
          validate: snapshot => gameLoader.validateSerialized(snapshot, this.playerEntity?.id || null),
          restore: snapshot => gameLoader.deserialize(snapshot, this.playerEntity?.id || null, { restoreTriggers: true }),
          required: true
        });
        this._campaignContentAuthorityOff = campaignContentAuthorityOff;
        this.resourceScope?.track(() => {
          if (this._campaignContentAuthorityOff !== campaignContentAuthorityOff) return;
          campaignContentAuthorityOff();
          this._campaignContentAuthorityOff = null;
        });
        this.applyRuntimeConfig(gameLoader.runtimeConfigSnapshot);
        const offTriggerLog = triggerSystem.on((event, trigger) => {
          if (event === 'triggerStart') console.log('[DDScene][Trigger] 执行:', trigger.id, trigger.do);
        });
        this.resourceScope?.track(offTriggerLog);
        if (!this.assetManager?.registerManifest) {
          throw new Error('场景 AssetManager 不支持稳定资源 Manifest');
        }
        const manifestResult = this.assetManager.registerManifest(gameLoader.project.assetManifest);
        this._resolveAssetManifestReady?.(manifestResult);
        this._resolveAssetManifestReady = null;
        this._rejectAssetManifestReady = null;
        console.log('[DDScene][Assets] Manifest 索引完成，等待九宫格按需加载', manifestResult);
        this.entityRenderer2D?.clearCaches?.();
        const currentClass = this.playerEntity?.getComponent?.('stats')?.class || this.playerEntity?.class;
        this.s09ClassSelectionCoordinator.syncPlayerClassAppearance(currentClass);
        this.configureSharedClassEffects(gameLoader);
        await this.s03s14BattleCoordinator.initialize(gameLoader);
        this.sanguoProgressionPresentationCoordinator.installProgressionUI(gameLoader);
      }
    });
    this.gameLoader = bridge.loader;
    this._gameLoaderReady = ready.then(this.resourceScope.guard(async gameLoader => {
      if (this._gameLoaderBridge !== bridge || bridge.loader !== gameLoader) return gameLoader;
      await this._worldLoadPromise;
      if (!this.currentSceneId) throw new Error('ProjectWorldIndex 未提供有效启动入口');
      const placementRuntime = this.context.services.placements;
      const placementValidation = placementRuntime?.validateProjection?.()
        || { ok: false, errors: [{ code: 'placementRuntimeUnavailable', path: 'placements', message: '场景放置运行时尚未就绪' }] };
      if (!placementValidation.ok) throw gameLoader.createValidationError(placementValidation.errors);
      this.gameLoader = gameLoader;
      const placementResult = await placementRuntime.spawnLoadedChunks();
      if (placementResult?.ok === false) throw gameLoader.createValidationError(placementResult.errors || []);
      const storyDay = gameLoader.blackboard?.get?.('storyState')?.currentDay;
      this.timeSystem?.setCurrentDay?.(storyDay);
      this._sceneTriggerBindings?.setTriggerSystem(gameLoader.triggerSystem);
      this._sceneTriggerBindings?.setEventJournal(
        this.sceneRuntime?.eventJournal || null,
        () => this.sceneRuntime?.authorityClocks?.logical?.now?.() || 0
      );
      // sceneEnter 触发器不再在装配 ready 阶段等待（修复加载死锁）：intro 等编排触发器
      // 含「等待对话/教程完成」步骤，会等玩家交互——而加载页此时还盖着画面，玩家无法
      // 交互 → 双向死锁。改由 initGame 在隐藏加载屏后调用 fireSceneEnterTriggers()。
      console.log('%c[DDScene][GameLoader] 装配完成（sceneEnter 延后触发），触发器数量:', 'color:#4CAF50', gameLoader.triggerSystem.triggers.length);
      return gameLoader;
    })).catch(this.resourceScope.guard(error => {
      this._rejectAssetManifestReady?.(error);
      this._resolveAssetManifestReady = null;
      this._rejectAssetManifestReady = null;
      console.error('[DDScene][GameLoader] 加载失败:', error);
      throw error;
    }));
  } catch (error) {
    this._rejectAssetManifestReady?.(error);
    this._resolveAssetManifestReady = null;
    this._rejectAssetManifestReady = null;
    console.warn('[DDScene][GameLoader] 初始化失败:', error);
    this._gameLoaderReady = Promise.reject(error);
    this._gameLoaderReady.catch(() => {});
  }
}

function configureSharedClassEffects(gameLoader) {
  const effectResolver = gameLoader?.progressionSystem?.effectResolver;
  if (!effectResolver) return false;
  const proficiencyConfig = gameLoader?.project?.progression?.proficiency || {};
  const constructionConfig = gameLoader?.project?.construction || {};
  const constructionSites = new Map((constructionConfig.sites || []).map(site => [site.id, site]));
  const itemRegistry = gameLoader?.getRegistry?.('items');
  const trigger = (name, event, data) => {
    const triggerSystem = this.gameLoader?.triggerSystem;
    const eventType = `${name}.${event}`;
    const payload = cloneData(data) || {};
    const journal = triggerSystem?.eventJournal || triggerSystem?._ensureEventJournal?.();
    if (payload.eventId && journal?.get) {
      const existing = journal.get(payload.eventId);
      if (existing && !payload.sourceEventPayload) {
        payload.sourceEventType = existing.type;
        payload.sourceEventSource = cloneData(existing.source);
        payload.sourceEventActorRef = existing.actorRef || null;
        payload.sourceEventSceneId = existing.sceneId || null;
        payload.sourceEventPayload = cloneData(existing.payload);
      }
    }
    return triggerSystem?.fire?.(eventType, payload) || 0;
  };
  const createConstructionEventId = ({ eventType, payload }) => {
    const triggerSystem = this.gameLoader?.triggerSystem;
    const eventJournal = triggerSystem?.eventJournal || triggerSystem?._ensureEventJournal?.();
    if (!eventJournal?.create) return null;
    return eventJournal.create({
      type: eventType,
      source: { kind: 'construction', operationId: payload?.operationId || null },
      actorRef: this.playerEntity?.id || null,
      sceneId: this.currentSceneId || null,
      payload: cloneData(payload)
    }).eventId;
  };
  const sharedPlan = this._gameplaySystemAssembler.configureSharedSystems({
    effectResolver,
    skillRegistry: gameLoader.skillRegistry,
    proficiency: {
      config: proficiencyConfig,
      onEvent: (event, data) => {
        if (event !== 'levelUp') return;
        const definition = this.proficiencySystem?.getDefinition?.(data.type);
        this.notificationSystem?.addNotification?.(
          `${definition?.name || data.type}熟练度提升至 ${data.level} 级`,
          'success'
        );
      }
    },
    inventoryEffects: {
      getEntityId: () => this.playerEntity?.id || null,
      baseResourceCapacity: 120
    },
    gathering: {
      settlementPolicy: context => this.prepareGatheringSettlement(context)
    },
    construction: {
      definitions: constructionConfig.definitions || [],
      maxOperations: constructionConfig.maxOperations,
      requiredProficiencyType: 'construction',
      itemResolver: itemId => cloneData(itemRegistry?.get?.(itemId) || null),
      createCheckpoint: checkpoint => this.s10ConstructionCoordinator._checkpointConstructionRepair(checkpoint),
      createEventId: createConstructionEventId,
      onEvent: (event, data) => trigger('construction', event, {
        ...data,
        siteId: data?.structure?.siteId || data?.siteId || null
      }),
      validateSite: ({ siteId, definition }) => {
        const site = constructionSites.get(siteId);
        if (!site || site.sceneId !== this.currentSceneId || site.definitionId !== definition.id) {
          return { ok: false, code: 'invalidSite' };
        }
        const story = gameLoader.blackboard?.get?.('storyState') || {};
        if (site.sceneId === 'S01') {
          return story.s01Survival?.meatCooked === true
            ? { ok: true }
            : { ok: false, code: 'constructionSiteLocked' };
        }
        if (site.sceneId === 'S06') {
          const rescueSucceeded = story.zhangManchengSurvived === true
            && story.rescueResults?.[S05_ZHANG_MANCHENG_RESCUE_ID]?.survived === true;
          return rescueSucceeded && story.s06Decision?.committed !== true
            ? { ok: true }
            : { ok: false, code: 'constructionSiteLocked' };
        }
        if (story.constructionSiteUnlocked !== true || story.s10CampRelocation?.completed !== true) {
          return { ok: false, code: 'constructionSiteLocked' };
        }
        return { ok: true };
      }
    },
    vehicles: {
      resolveEntity: id => this.entityStore?.all?.find?.(entity => entity?.id === id) || null,
      getInventoryOwnerId: inventory => this.sanguoWorldRuntimeCoordinator.resolveVehicleInventoryOwnerId(inventory),
      createCheckpoint: checkpoint => this._executeScenarioCommand(
        SCENARIO_COMMANDS.CHECKPOINT_REQUEST,
        {
          reason: 'checkpoint',
          checkpointId: checkpoint.checkpointId,
          sceneId: this.currentSceneId
        },
        checkpoint.operationId || null
      ),
      onVehicleEvent: (event, data) => trigger('vehicle', event, data),
      onLogisticsEvent: (event, data) => trigger('vehicleLogistics', event, data),
      onMannedStructureEvent: (event, data) => trigger('mannedStructure', event, data)
    }
  });
  if (!sharedPlan) return false;
  this.sceneRuntime.applyRegistrationPlan(sharedPlan);
  this.s10ConstructionCoordinator._ensureS10StructureEntities();
  this.sanguoWorldRuntimeCoordinator.ensureSceneVehicleEntities(this.currentSceneId);
  this.s09ClassSelectionCoordinator.syncUnlockedClassSkills();
  return true;
}

function registerGameLoaderActions(triggerSystem) {
  const registered = registerSceneTriggerActions(triggerSystem, {
    spawnPlacements: selector => this.context.services.placements?.spawn(selector),
    getWeatherSystem: () => this.weatherSystem,
    getTimeSystem: () => this.timeSystem,
    logger: console
  });
  triggerSystem.registerAction('s01Survival', async (params = {}, _context = {}, event = {}) => {
    const handled = await this._s01s02Coordinator.handleAction(params, event.params || {});
    if (handled && typeof handled === 'object' && typeof handled.ok === 'boolean') return handled;
    if (handled === true) return { ok: true };
    return {
      ok: false,
      code: 's01SurvivalRejected',
      error: {
        message: 'S01 survival action returned false',
        details: [{ operation: params.operation || params.type || null }]
      }
    };
  });
  registered.push('s01Survival');
  return registered;
}

export default SanguoGameLoaderCoordinator;
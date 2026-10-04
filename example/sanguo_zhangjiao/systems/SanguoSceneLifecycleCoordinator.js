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
import { EventJournal } from '../../../src/core/events/EventJournal.js';
import { S09AudioDirector } from './S09AudioDirector.js';

/**
 * 《三国张角传》的场景生命周期领域编排。
 * 不拥有输入帧、WorldReadyGate 的创建/等待或通用渲染管线；只协调 Demo 系统的
 * 初始化、释放、帧通知和 UI 层调度。
 */
export class SanguoSceneLifecycleCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, {
      initializeEnteredRuntime,
      updateBeforeBase,
      updateAfterBase,
      observeWaveEvents,
      presentNpcIdleText,
      updateClimbPrompt,
      observeTutorialEventSources,
      handleModalInput,
      renderPostPipeline,
      disposeEnteredRuntime
    }, { name: 'SanguoSceneLifecycleCoordinator' });
  }
}

function initializeEnteredRuntime() {
  this._s05MinePendingSettlements.clear();
  this._s05MineBusy = false;
  this._s06DecisionBusy = false;
  const inheritedPlayer = this.context?.player?.inherited === true;
  this._playerStartMode = inheritedPlayer
    ? 'inherit'
    : (this._progressionBootstrap?.playerStartMode || 'restore');
  this._initialPlayerSpawnPending = this._playerStartMode === 'newGame';
  this._tutorialFlow.bindPresentation();
  this.resourceScope?.track(() => this._tutorialFlow.dispose());
  const refreshOnboardingUi = this.resourceScope?.guard?.(() => this._onboardingUi?.refresh(true))
    || (() => this._onboardingUi?.refresh(true));
  // 教程完成状态跨会话恢复：教程系统只存内存；剧情事实已推进的存档不会重放
  // 教程启动事件，不恢复会让依赖 tutorialCompleted 的渐进 UI（红瓶/蓝瓶按钮）
  // 永远不 reveal。优先读持久化的 tutorialsCompleted；旧存档无此字段时按 S01
  // 剧情事实兜底推断（firstWolfSpotted ⇒ 前置教程已完成，firstWolfKilled ⇒ attack 完成）。
  const restoredStoryState = this.gameLoader?.blackboard?.get?.('storyState') || {};
  const restoredCompletions = restoredStoryState.tutorialsCompleted
    && typeof restoredStoryState.tutorialsCompleted === 'object'
    ? restoredStoryState.tutorialsCompleted
    : null;
  const completedTutorialIds = new Set();
  if (restoredCompletions) {
    for (const [tutorialId, done] of Object.entries(restoredCompletions)) {
      if (done === true) completedTutorialIds.add(tutorialId);
    }
  } else {
    const s01Survival = restoredStoryState.s01Survival || {};
    if (s01Survival.firstWolfSpotted === true) {
      ['s01.move', 's01.pickup', 's01.gather', 's01.chopWood', 's01.attack'].forEach(id => completedTutorialIds.add(id));
    }
  }
  for (const tutorialId of completedTutorialIds) {
    this._tutorialFlow?.complete?.(tutorialId);
  }
  void Promise.resolve(this._onboardingUiReadyPromise).then(refreshOnboardingUi);

  this._s09AudioDirector?.dispose?.();
  const audioDirector = new S09AudioDirector({ audioManager: this.audioManager });
  this._s09AudioDirector = audioDirector;
  audioDirector.syncScene(this.currentSceneId);
  this.resourceScope?.track(() => {
    audioDirector.dispose();
    if (this._s09AudioDirector === audioDirector) this._s09AudioDirector = null;
  });
}

function updateBeforeBase(deltaTime) {
  const frameProfile = this.debugMode === true && this._framePerformanceProfile?.current
    ? this._framePerformanceProfile.current
    : null;
  let phaseStartedAt = frameProfile ? performance.now() : 0;

  this._campfireService.update(deltaTime, {
    particleSystem: this.particleSystem,
    timeSystem: this.timeSystem,
    weatherSystem: this.weatherSystem,
    playerEntity: this.playerEntity,
    camera: this.camera,
    flightSystem: this.flightSystem,
    width: this.logicalWidth,
    height: this.logicalHeight
  });
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateDemoCampfire = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  if (this.timeSystem) {
    const previousDay = this.timeSystem.getCurrentDay();
    this.timeSystem.update(deltaTime);
    const currentDay = this.timeSystem.getCurrentDay();
    if (currentDay !== previousDay) this.s09RefugeeCoordinator._onGameDayChanged(currentDay);
  }
  this.s09RefugeeCoordinator._processDueStoryEvents();
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateDemoTimeStory = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  this._updateCityStateSummary();
  this._updateClassConfirmation();
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateDemoSceneUi = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  this.context.services.npcInteraction?.updatePresence?.();
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateDemoNpcPresence = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  const runtime = this.sceneRuntime;
  let bindingJournal = runtime?.eventJournal || null;
  if (!bindingJournal && runtime) {
    bindingJournal = new EventJournal();
    runtime.eventJournal = bindingJournal;
    runtime.authoritySnapshotService?.registerService?.('eventJournal', bindingJournal.asSnapshotProvider());
    this.context.services.eventJournal = bindingJournal;
  }
  if (bindingJournal && this._sceneTriggerBindings?.eventJournal !== bindingJournal) {
    this._sceneTriggerBindings.setEventJournal(
      bindingJournal,
      () => runtime?.authorityClocks?.logical?.now?.() || 0
    );
  }
  this._sceneTriggerBindings?.update();
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateDemoTriggerBindings = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  this.updateClimbPrompt();
  if (frameProfile) frameProfile.updateDemoClimbPrompt = performance.now() - phaseStartedAt;
}

function updateAfterBase(deltaTime) {
  // 与 updateBeforeBase 相同的子步骤探针：debugMode 下长帧日志会输出每步耗时，
  // 用于把 updateDemoAfterBase 这个聚合热点拆到具体子系统。
  const frameProfile = this.debugMode === true && this._framePerformanceProfile?.current
    ? this._framePerformanceProfile.current
    : null;
  let phaseStartedAt = frameProfile ? performance.now() : 0;

  // 施工进度只会在 S06/S10 推进；S10 工事实体也仅属于 S10。
  // 避免其他场景每帧序列化营建状态、遍历工事并扫描 EntityStore。
  // S01-C01（庇护所室内）也要推进：入睡演出（overnightSleepProgress）在室内进行，
  // coordinator.update 内部对非 S01 主场景有各自的早退保护。
  if (this.currentSceneId === 'S01' || this.currentSceneId === 'S01-C01') {
    this._s01s02Coordinator.update(deltaTime);
  } else if (this.currentSceneId === 'S06' || this.currentSceneId === 'S10') {
    this.s10ConstructionCoordinator._updateConstructionRuntime(deltaTime);
  }
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateAfterSceneRuntime = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  // WeatherSystem 只消费相机最终世界视野和 core 已提交九宫格 coverage；粒子不读取玩家，也不累加相机位移。
  const weatherCamera = this.context?.camera?.instance || this.camera;
  this.weatherSystem?.update?.(deltaTime, {
    viewBounds: weatherCamera?.getViewBounds?.() || null,
    loadedCoverage: this.context?.world?.loadedCoverage || null
  });
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateAfterWeather = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  if (this.currentSceneId === 'S10') {
    this.s10ConstructionCoordinator._ensureS10StructureEntities();
  }
  this.sceneRuntime?.runFramePhase?.('postScene', deltaTime, {
    scene: this.$scene,
    frameToken: this.sceneRuntime.currentFrameToken,
    updateSystems: true
  });
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateAfterPostScene = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  this.s11s14SceneCoordinator._updateS11HorseTravel();
  this.s03s08Coordinator._updateS04BocaiRescue(deltaTime);
  this.s05SceneCoordinator._updateS05ZhangManchengRescue(deltaTime);
  this.s11s14SceneCoordinator._updateS11S12Runtime();
  this.endingPresentationView?.update?.(deltaTime * 1000);
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateAfterScenarioRuntimes = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  this.observeWaveEvents();
  this.observeTutorialEventSources();
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateAfterWaveTutorial = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  this._onboardingUi?.refresh();
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateAfterOnboarding = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  // 攀爬区域调试显示开关（调试面板「显示攀爬区域」，默认开）同步到当前 chunk 地形
  const showClimbableZones = this.debugShowClimbableZones !== false;
  const terrainList = Array.isArray(this._terrains)
    ? this._terrains
    : (this._terrains instanceof Map ? [...this._terrains.values()] : []);
  if (this.terrain && !terrainList.includes(this.terrain)) terrainList.push(this.terrain);
  for (const terrain of terrainList) {
    if (terrain) terrain.debugShowClimbableZones = showClimbableZones;
  }

  this._campfireService.resolvePlayerCollision({
    playerEntity: this.playerEntity,
    flightSystem: this.flightSystem,
    jumpSystem: this.jumpSystem
  });
  if (frameProfile) {
    const now = performance.now();
    frameProfile.updateAfterCampfireCollision = now - phaseStartedAt;
    phaseStartedAt = now;
  }

  this.context.services.diagnostics?.observeTerrainCollision({
    terrains: this._terrains || [],
    terrain: this.terrain,
    playerEntity: this.playerEntity,
    label: 'DDScene'
  });
  if (frameProfile) {
    frameProfile.updateAfterCollisionDebug = performance.now() - phaseStartedAt;
  }
}

function observeWaveEvents() {
  if (!this.gameLoader) return 0;
  this._clearedGroups ||= new Set();
  return this._placementCoordinator.checkWaveEvents({
    clearedGroups: this._clearedGroups,
    isEntityDead: entity => this._isEntityDead(entity),
    triggerSystem: this.gameLoader.triggerSystem
  });
}

function presentNpcIdleText(npc, text) {
  const transform = npc?.getComponent?.('transform');
  if (transform && this.floatingTextManager) {
    const sprite = npc.getComponent?.('sprite');
    const height = (sprite?.height || 48) * (sprite?.scale || 1);
    this.floatingTextManager.addText(
      transform.position.x,
      transform.position.y - height - 20,
      text,
      '#cccccc'
    );
  }
  this.notificationSystem?.addNotification?.(text, 'info');
}

function updateClimbPrompt() {
  if (this._sceneTriggerBindings?.hasActivePrompt?.()) return false;
  const player = this.playerEntity;
  const target = player ? this.resolveClimbTarget({ entity: player }) : null;
  const canClimb = !!target && (
    target.requiresClimbAbility === false
    || this.abilitySystem?.isUnlocked?.(player, 'climb') === true
  );
  if (canClimb && target?.promptTemplate) this.showHint(target.promptTemplate, '攀爬');
  else this.hideHint();
  return canClimb;
}

function observeTutorialEventSources() {
  if (!this.gameLoader) return false;
  const triggerSystem = this.gameLoader.triggerSystem;
  this._tutorialFlow.observeEventSources({
    position: this.playerEntity?.getComponent?.('transform')?.position || null,
    panels: {
      inventory: this.inventoryPanel,
      stats: this.playerInfoPanel
    },
    onMovementComplete: () => triggerSystem.fire('playerMoved', {}),
    onPanelVisible: ({ id }) => {
      triggerSystem.fire('panelOpen', { panel: id });
      if (id === 'inventory') {
        void this._s01s02Coordinator?.markBackpackOpened?.().catch(error => {
          console.error('[SanguoSceneLifecycleCoordinator] 背包首次打开状态提交失败:', error);
        });
      }
    }
  });
  return true;
}

function handleModalInput({ inputManager, gamepad } = {}) {
  if (this.endingPresentationView?.visible) {
    return this.endingPresentationView.handleInput(
      this.s11s14SceneCoordinator._createEndingInputContext({ inputManager, gamepad })
    );
  }
  if (this.recipeSelectionView?.visible) {
    return this.recipeSelectionView.handleInput({
      inputManager,
      gamepad,
      viewWidth: this.logicalWidth,
      viewHeight: this.logicalHeight
    });
  }
  if (this.cargoTransferView?.visible) {
    return this.cargoTransferView.handleInput({
      inputManager,
      gamepad,
      viewWidth: this.logicalWidth,
      viewHeight: this.logicalHeight
    });
  }
  if (this.s03s14BattleCoordinator.isInputLayerVisible('result')) {
    return this.s03s14BattleCoordinator.handleInputLayer('result', {
      inputManager,
      gamepad,
      viewWidth: this.logicalWidth,
      viewHeight: this.logicalHeight
    });
  }
  if (this.irreversibleChoiceView?.visible) {
    const handled = this.irreversibleChoiceView.handleInput({
      inputManager,
      gamepad,
      viewWidth: this.logicalWidth,
      viewHeight: this.logicalHeight
    });
    return this.irreversibleChoiceView.allowsWorldMovement
      ? { handled, allowMovement: true }
      : handled;
  }
  if (this.s03s14BattleCoordinator.isInputLayerVisible('mode')) {
    return this.s03s14BattleCoordinator.handleInputLayer('mode', {
      inputManager,
      gamepad,
      viewWidth: this.logicalWidth,
      viewHeight: this.logicalHeight
    });
  }
  if (this.backpackPanel?.visible) {
    return this.backpackPanel.handleInput({ inputManager, gamepad }) === true;
  }
  return this.s09ClassSelectionCoordinator.handleConfirmationInput({ inputManager, gamepad });
}

function disposeEnteredRuntime() {
  this._campfireService.dispose();
  if (this.context.services.worldReadyGate === this._worldReadyGate) {
    this.context.services.worldReadyGate = null;
  }
  this._worldReadyGate = null;
  this.effectZoneRenderer?.clear?.();
  // 任务点信标随世界区域释放：清空标记点，已发射粒子随生命自然消亡
  this.taskMarkerBeacon?.clear?.();
  this._terrains.length = 0;
  this.terrain = null;
  this._worldRegion = null;
  this._worldIndex = null;
  this.context.world.terrain = null;
  this.context.world.terrains = null;
  this.context.world.loadedCoverage = null;
  this.context.world.region = null;
  this.context.world.worldIndex = null;
  this.context.services.placements?.reset?.({ clearProjection: true, clearPending: true, clearSpawned: true });
  this._regionDynamicStates?.clear?.();
  this._pendingChunkDomainStates?.clear?.();
  this._worldStreamingRuntime?.dispose?.();
  this._detachWorldStreaming = null;
  this.worldStreamingManager = null;
  this.gameLoader = null;
  this.cityStateSummaryPanel = null;
  this._classConfirm = null;
  this._classSelectionBusy = false;
  this.rescueObjectiveView?.clear?.();
  this.irreversibleChoiceView?.close?.();
  this.recipeSelectionView?.close?.();
  this.cargoTransferView?.close?.();
  this._cargoTransferBusy = false;
  this._cargoTransferPendingOperation = null;
  this.rescueSystem = null;
  this.s10ConstructionCoordinator._disposeS10Structures();
  this._disposeAllSceneVehicles();
  this._constructionCheckpointBusy = false;
  this._s10StructureInteractionBusy = false;
  this.rescueObjectiveView = null;
  this.irreversibleChoiceView = null;
  this.s04RouteCoordinator = null;
  this._s04RescueBusy = false;
  this._s05RescueBusy = false;
  this._s04RouteBusy = false;
}

/**
 * 庇护所室内（S01-C01）：篝火点燃后火光透窗而入。
 * 屏幕空间后期绘制（renderPostPipeline 在 ctx.restore 之后调用），
 * 世界坐标经 camera viewBounds 换算；窗户矩形直接取当前地形里的
 * S01-C01-window 背景图条目，不硬编码坐标。
 */
function renderShelterWindowFirelight(ctx) {
  if (this.currentSceneId !== 'S01-C01') return false;
  const storyState = this.gameLoader?.blackboard?.get?.('storyState');
  if (storyState?.s01Survival?.campfireLit !== true) return false;
  const camera = this.camera;
  if (!camera || !Array.isArray(this._terrains)) return false;
  let windowRect = null;
  for (const terrain of this._terrains) {
    for (const image of terrain?._editorBackgroundImages || []) {
      if (image?.id === 'S01-C01-window' && image.hidden !== true && image._img) {
        windowRect = image;
        break;
      }
    }
    if (windowRect) break;
  }
  if (!windowRect) return false;
  const viewBounds = camera.getViewBounds();
  const time = performance.now() / 1000;
  // 火焰闪烁：双正弦叠加出 irregular 明暗（与篝火辉光同风格的暖色系）
  const flicker = 0.72 + 0.18 * Math.sin(time * 7.3) + 0.10 * Math.sin(time * 13.7 + 1.7);
  const left = windowRect.x - viewBounds.left;
  const top = windowRect.y - viewBounds.top;
  const width = windowRect.width;
  const height = windowRect.height;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  // 1) 窗玻璃暖光：裁剪在窗框内，火光在玻璃后摇曳
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  const glass = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * 0.95);
  glass.addColorStop(0, `rgba(255, 190, 80, ${(0.30 * flicker).toFixed(3)})`);
  glass.addColorStop(0.55, `rgba(255, 120, 30, ${(0.16 * flicker).toFixed(3)})`);
  glass.addColorStop(1, 'rgba(255, 60, 0, 0)');
  ctx.fillStyle = glass;
  ctx.fillRect(left, top, width, height);
  ctx.restore();
  // 2) 透入室内的地面光斑：窗下暖色椭圆软光，落在门口与床之间的地板上
  const floorCenterY = windowRect.y + windowRect.height + 125 - viewBounds.top;
  const spillRadius = width * 1.5;
  ctx.save();
  ctx.translate(centerX, floorCenterY);
  ctx.scale(1, 0.42);
  const spill = ctx.createRadialGradient(0, 0, 0, 0, 0, spillRadius);
  spill.addColorStop(0, `rgba(255, 170, 60, ${(0.15 * flicker).toFixed(3)})`);
  spill.addColorStop(0.6, `rgba(255, 110, 30, ${(0.08 * flicker).toFixed(3)})`);
  spill.addColorStop(1, 'rgba(255, 60, 0, 0)');
  ctx.fillStyle = spill;
  ctx.beginPath();
  ctx.arc(0, 0, spillRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
}

function renderPostPipeline(ctx) {
  this.context.services.diagnostics?.renderCollisionShapes(ctx, {
    enabled: this.debugShowCollisionPolygons,
    camera: this.camera,
    terrains: this._terrains,
    campfire: this.context.services.campfire,
    label: 'DDScene'
  });
  // 攀爬区域调试显示（调试面板「显示攀爬区域」，面板打开时默认勾选）：顶层绘制避免被贴图遮挡
  this.context.services.diagnostics?.renderClimbZones(ctx, {
    enabled: this.debugShowClimbableZones === true,
    camera: this.camera,
    terrains: this._terrains
  });
  this.context.services.diagnostics?.renderActorCollisionEdge(ctx, {
    enabled: this.debugShowActorCollisionEdge,
    camera: this.camera,
    actor: this.playerEntity,
    terrainCollision: this._terrainCollision
  });
  const triggerBindings = this.context.services.triggerBindings;
  this.context.services.diagnostics?.renderTriggerHotspots(ctx, {
    enabled: this.debugShowTriggerHotspots === true,
    camera: this.camera,
    hotspots: this.debugShowTriggerHotspots === true
      ? triggerBindings?.getDebugHotspotSnapshot?.() || []
      : []
  });
  // 庇护所室内：篝火点燃后火光透窗而入（世界后期效果，先于过场淡入与 HUD）
  renderShelterWindowFirelight(ctx);
  this._renderTeleportFade(ctx);
  this.s03s14BattleCoordinator.renderLayer('hud', ctx, this.logicalWidth, this.logicalHeight);
  this.rescueObjectiveView?.render?.(ctx, this.logicalWidth, this.logicalHeight);
  this.s09ClassSelectionCoordinator.renderConfirmation(ctx);
  this.s03s14BattleCoordinator.renderLayer('mode', ctx, this.logicalWidth, this.logicalHeight);
  this.irreversibleChoiceView?.render?.(ctx, this.logicalWidth, this.logicalHeight);
  this.s03s14BattleCoordinator.renderLayer('result', ctx, this.logicalWidth, this.logicalHeight);
  this.recipeSelectionView?.render?.(ctx, this.logicalWidth, this.logicalHeight);
  this.cargoTransferView?.render?.(ctx, this.logicalWidth, this.logicalHeight);
  this.endingPresentationView?.render?.(ctx, this.logicalWidth, this.logicalHeight);
}

export default SanguoSceneLifecycleCoordinator;

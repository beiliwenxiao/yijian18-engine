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

import { applySceneRuntimeConfig, toggleSceneDebugPanel } from '../../../src/core/scene/RuntimeDebugWiring.js';
import { EntityRenderer2D } from '../../../src/rendering/EntityRenderer2D.js';
import { getNpcRenderStyle } from '../../../src/rendering/NpcRenderStyles.js';
import { SceneCameraBounds } from '../../../src/core/scene/SceneCameraBounds.js';
import { SceneEntityState } from '../../../src/core/scene/SceneEntityState.js';
import { FadeOverlayTransition } from '../../../src/core/scene/FadeOverlayTransition.js';
import { BaseGameSceneGameplayHooks } from './BaseGameSceneGameplayHooks.js';

/** 场景表现与兼容转发层；不拥有领域状态或生命周期 owner。 */
export class BaseGameScenePresentation extends BaseGameSceneGameplayHooks {
  startTransition(mainText = '场景切换中...', subText = '') {
    console.log('BaseGameScene: 开始场景过渡');
    this._transition.start(mainText, subText);
  }

  get isTransitioning() {
    return this._transition.active;
  }

  get transitionPhase() {
    return this._transition.active ? this._transition.phase : 'none';
  }

  resetTransition() {
    this._transition.reset();
  }

  updateTransition(deltaTime) {
    this._transition.update(deltaTime);
  }

  renderTransition(ctx) {
    this._transition.render(ctx, this.logicalWidth, this.logicalHeight);
  }

  handleUIClick() {
    return this._ensureWorldInteraction().handleUIClick();
  }

  handleTeleport() {
    return this._ensureWorldInteraction().handleTeleport();
  }

  _showRightClickFeedback() {
    return this._ensureWorldInteraction().showRightClickFeedback();
  }

  _renderClickRings(ctx) {
    return this._ensureWorldInteraction().renderClickRings(ctx);
  }

  handleWeaponThrow() {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().handleWeaponThrow();
  }

  handleEnemySelection() {
    return this._ensureWorldInteraction().handleEnemySelection();
  }

  handleAutoAttack(currentTime) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().handleAutoAttack(currentTime);
  }

  checkDialogueContinue() {
    return this._ensureDialogueFlow().checkContinue();
  }

  _syncTouchControlsForBackpack() {
    return this._ensurePanelLayout().syncTouchControlsForBackpack();
  }

  updatePanelHover() {
    return this._ensurePanelLayout().updatePanelHover();
  }

  applyRuntimeConfig(runtimeConfig = null) {
    return applySceneRuntimeConfig(this, runtimeConfig);
  }

  _toggleDebugPanel() {
    return toggleSceneDebugPanel(this);
  }

  _showScreenTip(text, opts = {}) {
    return this._hintPresenter?.showScreen(text, opts);
  }

  _hideScreenTip(owner = null) {
    return this._hintPresenter?.hideScreen(owner);
  }

  getGameState() {
    const state = this._gameStateView || (this._gameStateView = {});
    state.tutorialPhase = this.tutorialPhase;
    state.pickupItems = this.pickupItems;
    return state;
  }

  /**
   * 通用世界加载模板：投影 ProjectWorldIndex/Region、同步流式表现并由宿主配置领域运行时。
   * 具体游戏只能在 configureWorldRuntimeFromLoad 中安装自己的配置消费者，不能重写提交顺序。
   */
  _loadWorldTerrains() {
    const loadPromise = this._worldLoadPromise;
    if (!loadPromise) return null;
    const guard = this.resourceScope?.guard?.bind(this.resourceScope) || (callback => callback);
    const worldRuntimeReady = Promise.resolve(loadPromise)
      .then(guard(async result => {
        const world = this.context?.world;
        if (world) {
          world.region = result?.region || null;
          world.worldIndex = result?.worldIndex || null;
        }
        this._worldRegion = result?.region || null;
        this._worldIndex = result?.worldIndex || null;
        this.minimap?.setWorldIndex?.(result?.worldIndex, result?.region?.id);
        this._syncWorldStreamingProjection?.();
        await this.configureWorldRuntimeFromLoad(result);

        const terrains = this._terrains?.length
          ? this._terrains
          : (this.terrain ? [this.terrain] : []);
        const gate = this.context?.services?.worldReadyGate || this._worldReadyGate;
        gate?.resolve?.('terrains', terrains);
        this._syncWorldReadyProjection();
        return result;
      }));
    // WorldReadyGate 可以降级显示稳定背景，但存档恢复必须等待真实运行时配置成功。
    this._worldRuntimeReadyPromise = worldRuntimeReady;
    return worldRuntimeReady.catch(guard(error => {
      console.warn('[SceneWorldLoad] 加载 worldMap 地形失败:', error);
      const gate = this.context?.services?.worldReadyGate || this._worldReadyGate;
      gate?.resolve?.('terrains', []);
      this._syncWorldReadyProjection();
      return null;
    }));
  }

  /** 子游戏在世界数据已经校验和投影后安装自己的运行时配置消费者。 */
  configureWorldRuntimeFromLoad(_result) {}

  /** 将 WorldReadyGate 投影到迁移期兼容字段；正式渲染只读取 gate。 */
  _syncWorldReadyProjection() {
    const gate = this.context?.services?.worldReadyGate || this._worldReadyGate;
    const status = gate?.status;
    if (!status) return;
    const timedOut = status.state === 'timedOut';
    this._terrainsLoaded = timedOut || status.entries.terrains?.state === 'resolved';
    this._spawnApplied = timedOut || status.entries.placements?.state === 'resolved';
    this._sceneReady = status.state === 'ready' || timedOut;
  }

  /** 兼容入口；真实状态由 WorldReadyGate 持有。 */
  _checkSceneReady() {
    this._syncWorldReadyProjection();
  }

  /** 世界资源未就绪时的统一稳定背景，避免默认位置和程序化地形闪现。 */
  renderLoadingBackground(ctx) {
    const background = this.terrain?.sceneBackgroundColor || '#1f1a14';
    ctx.fillStyle = background;
    ctx.fillRect(
      0,
      0,
      this.logicalWidth || ctx.canvas?.width || 0,
      this.logicalHeight || ctx.canvas?.height || 0
    );
  }

  /** 通用 world/screen/modal 管线结束后的游戏专属最高层表现钩子。 */
  renderPostPipeline(_ctx) {}

  /** 为场景创建可由 update/render 驱动的淡黑覆盖层；资源作用域变更后自动替换旧实例。 */
  _ensureFadeOverlayTransition() {
    const current = this._fadeOverlayTransition;
    if (current && current.scope === this.resourceScope && !current.scope?.disposed) return current;
    if (!this.resourceScope || this.resourceScope.disposed) return null;
    const transition = new FadeOverlayTransition({ duration: 0.3, scope: this.resourceScope });
    this._fadeOverlayTransition = transition;
    return transition;
  }

  /** 淡黑→执行→淡出的通用异步转场；取消、替换或退出时返回 false。 */
  _fadeTransition(callback) {
    const transition = this._ensureFadeOverlayTransition();
    if (!transition) return Promise.resolve(false);
    return transition.start(callback).then(result => !result?.cancelled);
  }

  /** 每帧推进当前淡黑覆盖层。 */
  _updateTeleportFade(deltaTime) {
    return this._fadeOverlayTransition?.update(deltaTime) || false;
  }

  /** 渲染当前淡黑覆盖层；命名保留以兼容既有传送调用方。 */
  _renderTeleportFade(ctx) {
    return this._fadeOverlayTransition?.render(ctx, {
      width: this.logicalWidth,
      height: this.logicalHeight
    }) || false;
  }

  /** 判断实体是否已死亡、正在死亡或已从当前实体投影中移除。 */
  _isEntityDead(entity) {
    return SceneEntityState.isDead(entity, this.context?.entities?.all || this.entities);
  }

  /** 限制相机不超出当前 ProjectWorldIndex 中活动 Region 的派生边界。 */
  clampCameraToWorldBounds() {
    const world = this.context?.world || {};
    return SceneCameraBounds.clampToWorldIndex(
      this.context?.camera?.instance || this.camera,
      world.worldIndex || this._worldIndex,
      world.region?.id || this._worldRegion?.id
    );
  }

  renderWorldObjects(ctx) {
    return this._ensureRenderPipeline().renderWorldObjects(ctx);
  }

  renderCombatStateUI(ctx) {
    return this._ensureRenderPipeline().renderCombatStateUI(ctx);
  }

  renderSpeechBubbles(_ctx) {}

  renderBackground(ctx) {
    return this._ensureWorldPresentation().renderBackground(ctx);
  }

  _collectBuffZones() {
    return this._terrainBinding.collectBuffZones();
  }

  _renderBuffZones(ctx) {
    return this._terrainBinding.renderBuffZones(ctx);
  }

  /**
   * 标准地形碰撞模板：由基类统一提供 terrain/player/diagnostics 上下文。
   * 子场景只有数据来源确实不同才覆写此方法，常规场景不应重复组装同一参数对象。
   */
  checkTerrainCollision() {
    const terrainBinding = this._terrainBinding;
    if (!terrainBinding) return false;
    const diagnostics = this.context?.services?.diagnostics;
    if (!diagnostics?.checkTerrainCollision) return terrainBinding.checkTerrainCollision();
    const terrains = this._terrains?.length
      ? this._terrains
      : (this.terrain ? [this.terrain] : []);
    return diagnostics.checkTerrainCollision({
      terrainBinding,
      terrains,
      terrain: this.terrain || terrains[0] || null,
      playerEntity: this.playerEntity,
      label: this.name || this.constructor?.name || 'Scene'
    }) === true;
  }

  renderPickupItems(ctx) {
    return this._ensureWorldPresentation().renderPickupItems(ctx);
  }

  /** 构建仅用于等距背景的视觉地图投影。 */
  generateIsometricMap() {
    this.mapData = [];
    for (let y = 0; y < this.mapHeight; y++) {
      const row = [];
      for (let x = 0; x < this.mapWidth; x++) {
        let tileType = 1;
        if (x === 0 || y === 0 || x === this.mapWidth - 1 || y === this.mapHeight - 1) {
          tileType = 3;
        } else if (Math.random() < 0.1) {
          tileType = 2;
        } else if (Math.random() < 0.05) {
          tileType = 5;
        }
        row.push(tileType);
      }
      this.mapData.push(row);
    }
    this.isometricRenderer?.setMapData(this.mapData, null);
    console.log('BaseGameScene: 生成等距地图', this.mapWidth, 'x', this.mapHeight);
  }

  _ensureEntityRenderer() {
    if (!this.entityRenderer2D) {
      this.entityRenderer2D = new EntityRenderer2D(this.assetManager, getNpcRenderStyle, {
        getRenderOffset: entity => this.context?.presentation?.worldItemEvents?.getRenderOffset?.(entity)
          || { x: 0, y: 0 }
      });
    }
    return this.entityRenderer2D;
  }

  renderEntity(ctx, entity) {
    this._ensureEntityRenderer().render(ctx, entity);
  }

  setHintCallbacks(showCallback, hideCallback) {
    return this._hintPresenter?.setCallbacks(showCallback, hideCallback);
  }

  showHint(text, title = '提示') {
    return this._hintPresenter?.showHint(text, title);
  }

  hideHint() {
    return this._hintPresenter?.hideHint();
  }

  _setupDrawCallCounter(ctx) {
    return this._diagnostics.setupDrawCallCounter(ctx);
  }

  _teardownDrawCallCounter() {
    return this._diagnostics.teardownDrawCallCounter();
  }

  _estimateTextureMemory() {
    return this._diagnostics.estimateTextureMemory();
  }

  /** 唯一同步场景资源释放事务；重复调用 no-op。 */
  _disposeSceneResources() {
    if (this._sceneResourcesDisposed) return false;
    this._sceneResourcesDisposed = true;
    const runtime = this.sceneRuntime;
    runtime?.invalidate();
    this.context.lifecycle.state = 'exiting';

    this._panelLayout?.clearTouchControlsForBackpack?.();
    this._touchControlsDimmed = false;
    this._itemGainedFlow?.dispose?.();
    this._diagnostics.dispose();

    this._inputFlow?.dispose();
    this._inputFlow = null;
    this._sceneTriggerBindings?.dispose();
    this._sceneTriggerBindings = null;

    this.playerLifecycle?.dispose();
    runtime?.dispose();
    this.sceneRuntime = null;

    this.tutorialSystem.cleanup();
    this.dialogueSystem?.reset?.();
    this.questSystem?.cleanup?.();
    this._terrainBinding.clearEffectZoneRenderer();
    this.particleSystem.clear?.();
    this.minimap?.dispose?.();

    this._skillActions?.reset();
    this._worldInteraction?.reset();
    this.entityStore.destroyAll();
    this.context.resetTransient();
    // P6.2 释放审计必须在 Runtime、ResourceScope、粒子和实体全部清理后取样；
    // 它只记录可追踪残留，不能替代浏览器/设备的真实内存 profile。
    this._diagnostics.finalizeReleaseAudit();
    this.playerLifecycle = null;
    this._lifecycleCoordinator = null;
    this._inputBindings = null;
    this._inventoryFlow = null;
    this._hudUpdater = null;
    this._equipmentFlow = null;
    this._itemGainedFlow = null;
    this._aimPresentation = null;
    this._combatActions = null;
    this._dialogueFlow = null;
    this._worldInteraction = null;
    this._skillActions = null;
    this._worldPresentation = null;
    this._panelLayout = null;
    this._hintPresenter = null;
    this.resourceScope = null;
    this.inputManager = null;
    this.playerEntity = null;

    console.log(`BaseGameScene: 退出场景 ${this.name}`);
    return true;
  }
}

export default BaseGameScenePresentation;

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

const WORLD_PHASE_NAMES = Object.freeze([
  'renderBackground', 'renderPickups', 'renderWorldObjects', 'renderWorldEffects'
]);

/** 天气 id → 中文显示名（时间/气候小窗用）。 */
const TIME_WEATHER_LABELS = Object.freeze({
  clear: '晴朗', breeze: '微风', wind: '大风', lightRain: '小雨',
  heavyRain: '大雨', lightFog: '薄雾', heavyFog: '浓雾', storm: '风暴'
});

/**
 * SceneRenderPipeline - Canvas 2D 场景渲染编排（框架级）
 *
 * 场景持有内容与 UI 实例，本类固定世界、屏幕 UI 与最高层弹窗的绘制顺序。
 * atmosphere 统一由 context.services.campfire.renderAtmosphere 提供。
 */
export class SceneRenderPipeline {
  /** @param {{scene:Object, context?:Object, worldLayers?:Function[], screenLayers?:Function[], modalLayers?:Function[]}|Object} config */
  constructor(config) {
    this.scene = config?.scene || config;
    this.context = config?.context || this.scene?.context || null;
    this.worldLayers = config?.worldLayers || [
      (scene, ctx) => scene.renderBackground(ctx),
      (scene, ctx) => scene.renderPickupItems(ctx),
      (scene, ctx) => scene.renderWorldObjects(ctx),
      (_scene, ctx) => this._renderWorldEffects(ctx)
    ];
    this.screenLayers = config?.screenLayers || [
      (scene, ctx) => {
        const atmosphere = this.context?.services?.campfire;
        if (typeof atmosphere?.renderAtmosphere !== 'function') {
          throw new Error('SceneRenderPipeline requires context.services.campfire.renderAtmosphere');
        }
        const runtime = this._atmosphereRuntime;
        runtime.timeSystem = scene.timeSystem;
        runtime.weatherSystem = scene.weatherSystem;
        runtime.playerEntity = this.context?.player?.entity || null;
        runtime.camera = this.context?.camera?.instance || null;
        runtime.viewBounds = this._viewBounds || null;
        runtime.loadedCoverage = this.context?.world?.loadedCoverage || null;
        runtime.width = scene.logicalWidth;
        runtime.height = scene.logicalHeight;
        return atmosphere.renderAtmosphere(ctx, runtime);
      },
      (scene, ctx) => this.context?.presentation?.skillEffects
        ?.render?.(ctx, this.context?.camera?.instance || null),
      (_scene) => this.context?.presentation?.combatEffects?.render?.(),
      (_scene, ctx) => this.context?.presentation?.floatingTextManager
        ?.render?.(ctx, this.context?.camera?.instance || null),
      (scene, ctx) => scene.tutorialSystem?.render(ctx),
      (_scene, ctx) => this.context?.ui?.dialogueBox?.render?.(ctx),
      (_scene, ctx) => this.context?.systems?.combat?.render?.(ctx),
      (_scene, ctx) => this.context?.ui?.bottomControlBar?.render?.(ctx),
      (scene, ctx) => scene.blockButton?.render(ctx),
      (scene, ctx) => scene.jumpButton?.render(ctx),
      (scene, ctx) => scene.flightButton?.render(ctx),
      (scene, ctx) => scene.throwButton?.render(ctx),
      (scene, ctx) => scene.bagButton?.render(ctx),
      (scene, ctx) => scene.settingsButton?.render(ctx),
      (_scene, ctx) => this.context?.ui?.playerStatusHUD?.render?.(ctx),
      (scene, ctx) => scene.minimap?.render(ctx),
      (_scene, ctx) => this.renderTimeWeatherBadge(ctx),
      (scene, ctx) => scene.renderCombatStateUI(ctx),
      (scene, ctx) => { if (scene.isTransitioning) scene.renderTransition(ctx); },
      (scene, ctx) => { if (scene.performanceMonitor?.enabled) scene.performanceMonitor.render(ctx); }
    ];
    this.screenLayerNames = config?.screenLayerNames || Object.freeze([
      'renderAtmosphere',
      'renderSkillEffects',
      'renderCombatEffects',
      'renderFloatingText',
      'renderTutorial',
      'renderDialogue',
      'renderCombatUi',
      'renderBottomControlBar',
      'renderBlockButton',
      'renderJumpButton',
      'renderFlightButton',
      'renderThrowButton',
      'renderBagButton',
      'renderSettingsButton',
      'renderPlayerHud',
      'renderMinimap',
      'renderTimeWeatherBadge',
      'renderCombatState',
      'renderTransition',
      'renderPerformanceMonitor'
    ]);
    this.modalLayers = config?.modalLayers || [
      (_scene, ctx) => this.context?.ui?.backpack?.render?.(ctx),
      // 统一成长面板属于模态 UI，只从显式 SceneContext 读取。
      (_scene, ctx) => this.context?.ui?.progression?.render?.(ctx),
      (scene, ctx) => scene.notificationSystem?.render(ctx),
      (scene, ctx) => scene.itemGainedPopup?.render(ctx),
      (scene, ctx) => scene.interactionChoiceView?.render(ctx),
      (scene, ctx) => scene.gamepadPanel?.render(ctx),
      (scene, ctx) => scene.skillWheelOverlay?.render(ctx)
    ];
    /** 每帧复用的世界 Y-sort 队列与实体包装项，容量只增不减。 */
    this._worldQueue = [];
    this._entityQueueItems = [];
    this._entitySortBuffer = [];
    this._terrainBuffer = [];
    this._atmosphereRuntime = {
      timeSystem: null, weatherSystem: null, playerEntity: null,
      camera: null, viewBounds: null, loadedCoverage: null, width: 0, height: 0
    };
    this._campfireRenderRuntime = { particleSystem: null, width: 0, height: 0 };
  }

  render(ctx) {
    const scene = this.scene;
    const context = this.context || scene.context || null;
    const worldReadyGate = context?.services?.worldReadyGate || scene._worldReadyGate || null;
    const worldGateState = worldReadyGate?.status?.state;
    // 世界资源尚未收敛时不得进入相机投影，避免默认坐标与程序化地形闪现。
    if (worldGateState && worldGateState !== 'ready' && worldGateState !== 'timedOut') {
      if (typeof scene.renderLoadingBackground === 'function') scene.renderLoadingBackground(ctx);
      else {
        ctx.fillStyle = '#1f1a14';
        ctx.fillRect(0, 0, scene.logicalWidth || ctx.canvas?.width || 0, scene.logicalHeight || ctx.canvas?.height || 0);
      }
      return;
    }

    const camera = context?.camera?.instance || null;
    const frameProfile = scene.debugMode === true && scene._framePerformanceProfile?.current
      ? scene._framePerformanceProfile.current
      : null;
    const trackDrawCalls = scene.performanceMonitor?.shouldTrackDrawCalls?.() === true;
    if (trackDrawCalls) {
      scene._drawCallCount = 0;
      if (scene._drawCallProxied && scene._drawCallProxyContext !== ctx) {
        scene._teardownDrawCallCounter?.();
      }
      if (!scene._drawCallProxied) scene._setupDrawCallCounter(ctx);
    } else if (scene._drawCallProxied) {
      scene._teardownDrawCallCounter?.();
      scene._drawCallCount = 0;
    }

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, scene.logicalWidth, scene.logicalHeight);
    ctx.save();
    const viewBounds = camera.getViewBounds();
    this._viewBounds = viewBounds;
    ctx.translate(-viewBounds.left, -viewBounds.top);

    for (let index = 0; index < this.worldLayers.length; index++) {
      const startedAt = frameProfile ? performance.now() : 0;
      this.worldLayers[index](scene, ctx);
      if (frameProfile) {
        const name = WORLD_PHASE_NAMES[index] || `renderWorldLayer${index}`;
        frameProfile[name] = performance.now() - startedAt;
      }
    }
    ctx.restore();

    if (this.screenLayers.length > 0) {
      const atmosphereStartedAt = frameProfile ? performance.now() : 0;
      this.screenLayers[0](scene, ctx);
      if (frameProfile) {
        const name = this.screenLayerNames[0] || 'renderScreenLayer0';
        frameProfile[name] = performance.now() - atmosphereStartedAt;
      }
    }
    const screenUiStartedAt = frameProfile ? performance.now() : 0;
    for (let index = 1; index < this.screenLayers.length; index++) {
      const layerStartedAt = frameProfile ? performance.now() : 0;
      this.screenLayers[index](scene, ctx);
      if (frameProfile) {
        const name = this.screenLayerNames[index] || `renderScreenLayer${index}`;
        frameProfile[name] = performance.now() - layerStartedAt;
      }
    }
    if (frameProfile) frameProfile.renderScreenUi = performance.now() - screenUiStartedAt;

    // 模态层固定高于常规 HUD，防止背包与获得物品弹窗被覆盖。
    const modalStartedAt = frameProfile ? performance.now() : 0;
    for (const layer of this.modalLayers) layer(scene, ctx);
    if (frameProfile) frameProfile.renderModalUi = performance.now() - modalStartedAt;

    const postStartedAt = frameProfile ? performance.now() : 0;
    scene.renderPostPipeline?.(ctx);
    if (frameProfile) frameProfile.renderPostPipeline = performance.now() - postStartedAt;
  }

  renderWorldObjects(ctx) {
    const scene = this.scene;
    const context = this.context || scene.context || null;
    const entities = context?.entities?.all || [];
    const terrains = this._terrainBuffer;
    terrains.length = 0;
    const worldTerrains = context?.world?.terrains;
    if (Array.isArray(worldTerrains)) {
      for (let index = 0; index < worldTerrains.length; index++) {
        if (worldTerrains[index]) terrains.push(worldTerrains[index]);
      }
    }
    if (terrains.length === 0 && context?.world?.terrain) terrains.push(context.world.terrain);
    const camera = context?.camera?.instance || null;
    const particleSystem = context?.presentation?.particleSystem || null;
    const frameProfile = scene.debugMode === true && scene._framePerformanceProfile?.current
      ? scene._framePerformanceProfile.current
      : null;
    const queueBuildStartedAt = frameProfile ? performance.now() : 0;
    const queue = this._worldQueue;
    queue.length = 0;

    for (const terrain of terrains) terrain.renderBelowDecorations?.(ctx);
    const campfire = context?.services?.campfire || null;
    const campfireRuntime = this._campfireRenderRuntime;
    campfireRuntime.particleSystem = particleSystem;
    campfireRuntime.playerEntity = context?.player?.entity || null;
    campfireRuntime.width = scene.logicalWidth;
    campfireRuntime.height = scene.logicalHeight;
    campfire?.appendRenderItems?.(queue, ctx, campfireRuntime);
    for (const terrain of terrains) terrain.collectDecorations?.(queue, ctx, this._viewBounds);
    particleSystem?.collectDepthSorted?.(queue, ctx, camera, this._viewBounds);

    let entityItemCount = 0;
    for (let i = 0, len = entities.length; i < len; i++) {
      const entity = entities[i];
      if (!this._isEntityVisible(entity)) continue;
      const position = entity.getComponent('transform')?.position;
      if (!position) continue;
      let item = this._entityQueueItems[entityItemCount];
      if (!item) {
        item = { type: 'entity', y: 0, sortPriority: 2, entity: null };
        this._entityQueueItems[entityItemCount] = item;
      }
      entityItemCount++;
      const corpseSortOffset = entity.isCorpse === true
        ? Number(entity.corpseDefinition?.presentation?.sortYOffset) || 0
        : 0;
      item.y = (terrains.length > 0 ? position.y : position.y - (position.z || 0) * 0.01)
        + corpseSortOffset;
      item.sortPriority = 2;
      item.entity = entity;
      queue.push(item);
    }

    if (frameProfile) {
      let depthParticleCount = 0;
      for (let index = 0; index < queue.length; index++) {
        if (queue[index]?.type === 'particle') depthParticleCount++;
      }
      frameProfile.worldQueueBuild = performance.now() - queueBuildStartedAt;
      frameProfile.worldQueueLength = queue.length;
      frameProfile.visibleEntityCount = entityItemCount;
      frameProfile.worldDepthParticleCount = depthParticleCount;
    }
    const queueSortStartedAt = frameProfile ? performance.now() : 0;
    queue.sort((a, b) => (a.y - b.y) || ((a.sortPriority || 0) - (b.sortPriority || 0)));
    if (frameProfile) frameProfile.worldQueueSort = performance.now() - queueSortStartedAt;
    const queueDrawStartedAt = frameProfile ? performance.now() : 0;
    for (let i = 0, len = queue.length; i < len; i++) {
      const item = queue[i];
      if (item.type === 'entity') scene.renderEntity(ctx, item.entity);
      else item.render?.();
    }
    if (frameProfile) frameProfile.worldQueueDraw = performance.now() - queueDrawStartedAt;

    if (terrains.length === 0) return;
    for (const terrain of terrains) terrain.renderCliffs?.(ctx);
    scene._renderBuffZones?.(ctx);
    scene.renderSpeechBubbles?.(ctx);
  }

  /** 入队前的无分配视野检测；边距覆盖名称、血条和高精灵。 @private */
  _isEntityVisible(entity) {
    const bounds = this._viewBounds;
    if (!bounds) return true;
    const position = entity?.getComponent?.('transform')?.position;
    if (!position) return true;
    const sprite = entity.getComponent?.('sprite');
    const width = (sprite?.width || 32) * (sprite?.scale || 1);
    const height = (sprite?.height || 32) * (sprite?.scale || 1);
    const elevation = position.elevation || 0;
    const padding = 64;
    return position.x + width / 2 + padding >= bounds.left &&
      position.x - width / 2 - padding <= bounds.right &&
      position.y - elevation + padding >= bounds.top &&
      position.y - elevation - height - padding <= bounds.bottom;
  }

  /** 常驻时间/气候小窗；位置和尺寸优先消费 UIEditor 的稳定布局矩形。 */
  renderTimeWeatherBadge(ctx) {
    const scene = this.scene;
    const minimap = scene?.minimap;
    const layoutRect = this.context?.ui?.layout?.getScreenHudRect?.('timeWeatherBadge') || null;
    if (!layoutRect && !minimap) return;
    const timeSystem = scene.timeSystem || this.context?.systems?.time || null;
    const weatherSystem = scene.weatherSystem || this.context?.systems?.weather || null;
    if (!timeSystem && !weatherSystem) return;

    const fallbackX = Number.isFinite(minimap?.x) ? minimap.x - 160 : Math.max(4, scene.logicalWidth - 320);
    const fallbackY = Number.isFinite(minimap?.y) ? minimap.y : 10;
    const x = Number.isFinite(layoutRect?.x) ? layoutRect.x : fallbackX;
    const y = Number.isFinite(layoutRect?.y) ? layoutRect.y : fallbackY;
    const width = Number.isFinite(layoutRect?.width) && layoutRect.width > 0 ? layoutRect.width : 150;
    const height = Number.isFinite(layoutRect?.height) && layoutRect.height > 0 ? layoutRect.height : 54;
    const textOffsetX = Number.isFinite(layoutRect?.textOffsetX) ? layoutRect.textOffsetX : 0;
    const textOffsetY = Number.isFinite(layoutRect?.textOffsetY) ? layoutRect.textOffsetY : 0;
    const configuredFontSize = Number.isFinite(layoutRect?.fontSize) && layoutRect.fontSize > 0
      ? Math.max(6, Math.min(96, layoutRect.fontSize))
      : null;

    const periodNames = timeSystem?.PERIOD_NAMES || timeSystem?.constructor?.PERIOD_NAMES || null;
    const period = timeSystem?.getCurrentPeriod?.() || '';
    const periodLabel = periodNames?.[period] || period || '—';
    const day = timeSystem?.getCurrentDay?.();
    const weatherLabel = TIME_WEATHER_LABELS[weatherSystem?.getVisualWeather?.()] || weatherSystem?.getVisualWeather?.() || null;
    const scale = Math.max(0.55, Math.min(1.6, width / 150, height / 54));
    const padding = Math.max(3, Math.min(10, width * 0.067));
    const maxTextWidth = Math.max(1, width - padding * 2 - Math.abs(textOffsetX));
    const primaryFontSize = configuredFontSize || Math.max(7, Math.round(12 * scale));
    const secondaryFontSize = configuredFontSize || Math.max(7, Math.round(11 * scale));
    const textX = x + padding + textOffsetX;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.fillStyle = 'rgba(10, 14, 30, 0.72)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(122, 155, 216, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe4a3';
    ctx.font = `bold ${primaryFontSize}px Arial`;
    ctx.fillText(`第 ${Number.isFinite(day) ? day : 1} 天`, textX, y + height * 0.28 + textOffsetY, maxTextWidth);
    ctx.fillStyle = '#bfe0ff';
    ctx.font = `${secondaryFontSize}px Arial`;
    ctx.fillText(`时间：${periodLabel}`, textX, y + height * 0.61 + textOffsetY, maxTextWidth);
    if (weatherLabel) {
      ctx.fillStyle = '#cfe8cf';
      ctx.fillText(`气候：${weatherLabel}`, textX, y + height * 0.86 + textOffsetY, maxTextWidth);
    }
    ctx.restore();
  }

  renderCombatStateUI(ctx) {
    const scene = this.scene;
    const combatSystem = this.context?.systems?.combat || null;
    const player = this.context?.player?.entity || null;
    const soulState = player?.isSoulState === true;
    if (!soulState && !combatSystem?.isInCombat()) return;

    const minimap = scene?.minimap;
    const layoutRect = this.context?.ui?.layout?.getScreenHudRect?.('combatStateBadge') || null;
    const fallbackX = minimap
      ? Math.max(4, Number(minimap.x) - 90)
      : scene.logicalWidth - 90 - (scene.uiStrategy?.platform === 'mobile' ? 100 : 0);
    const fallbackY = minimap ? (Number(minimap.y) || 10) + 62 : 10;
    const x = Number.isFinite(layoutRect?.x) ? layoutRect.x : fallbackX;
    const y = Number.isFinite(layoutRect?.y) ? layoutRect.y : fallbackY;
    const width = Number.isFinite(layoutRect?.width) && layoutRect.width > 0 ? layoutRect.width : 80;
    const height = Number.isFinite(layoutRect?.height) && layoutRect.height > 0 ? layoutRect.height : 30;
    const textOffsetX = Number.isFinite(layoutRect?.textOffsetX) ? layoutRect.textOffsetX : 0;
    const textOffsetY = Number.isFinite(layoutRect?.textOffsetY) ? layoutRect.textOffsetY : 0;
    const configuredFontSize = Number.isFinite(layoutRect?.fontSize) && layoutRect.fontSize > 0
      ? Math.max(6, Math.min(96, layoutRect.fontSize))
      : null;
    const scale = Math.max(0.55, Math.min(1.6, width / 80, height / 30));
    const primaryFontSize = configuredFontSize || Math.max(7, Math.round(12 * scale));
    const secondaryFontSize = configuredFontSize || Math.max(7, Math.round(10 * scale));
    const textX = x + width / 2 + textOffsetX;
    const maxTextWidth = Math.max(1, width - 4 - Math.abs(textOffsetX) * 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.fillStyle = soulState ? 'rgba(36, 47, 96, 0.82)' : 'rgba(139, 0, 0, 0.7)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = soulState ? '#8fc7ff' : '#ff0000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (soulState) {
      ctx.font = `bold ${primaryFontSize}px Arial`;
      ctx.fillText('灵魂状态', textX, y + height / 2 + textOffsetY, maxTextWidth);
    } else {
      ctx.font = `bold ${primaryFontSize}px Arial`;
      ctx.fillText('战斗中', textX, y + height * 0.35 + textOffsetY, maxTextWidth);
      const timer = Math.ceil(combatSystem.getCombatExitTimer());
      ctx.fillStyle = timer > 0 ? '#ffff00' : '#ff6666';
      const timerFontSize = configuredFontSize || (timer > 0
        ? secondaryFontSize
        : Math.max(7, Math.round(9 * scale)));
      ctx.font = `${timerFontSize}px Arial`;
      ctx.fillText(timer > 0 ? `${timer}秒` : '敌人附近', textX, y + height * 0.76 + textOffsetY, maxTextWidth);
    }
    ctx.restore();
  }

  _renderWorldEffects(ctx) {
    const scene = this.scene;
    const context = this.context || scene.context || null;
    const services = context?.services || {};
    const systems = context?.systems || {};
    const presentation = context?.presentation || {};
    const camera = context?.camera?.instance || null;
    const player = context?.player?.entity || null;
    const combatSystem = systems.combat;
    const meleeAttackSystem = systems.meleeAttack;
    const weaponRenderer = presentation.weaponRenderer;
    const particleSystem = presentation.particleSystem;

    if (weaponRenderer?.thrownWeapon.active) weaponRenderer.renderThrownWeapon(ctx, camera);
    if (combatSystem?.isInCombat() && player) {
      meleeAttackSystem?.renderCombatAlertCircle?.(ctx, camera);
    }
    if (meleeAttackSystem?.sliceTrail?.length > 1) meleeAttackSystem.renderSliceTrail(ctx);
    meleeAttackSystem?.renderSectorSlashEffects?.(ctx);
    const worldPresentation = services.worldPresentation;
    if (worldPresentation) {
      worldPresentation.renderFlightShadow(ctx);
      worldPresentation.renderBlockShield(ctx);
    }
    particleSystem.render(ctx, camera);
    presentation.gatheringProgress?.render?.(ctx);
    presentation.worldAction?.render?.(ctx);
    // 蓄力跳跃的头顶蓄力条（世界空间）。
    scene.jumpChargeController?.render?.(ctx);
    if (scene.eventTargetFlash) {
      scene.eventTargetFlash.prune();
      scene.eventTargetFlash.render(ctx);
    }
    if (scene._debugParticleFrames > 0) {
      console.log('【渲染】粒子系统活跃粒子数:', particleSystem.getActiveCount());
      scene._debugParticleFrames--;
    }
    combatSystem?.renderSkillRangeIndicators(ctx);
    if (services.worldInteraction) services.worldInteraction.renderClickRings(ctx);
    else scene._renderClickRings(ctx);
    if (services.skills) services.skills.renderAimPreview(ctx);
    else scene.renderSkillAimPreview(ctx);
  }
}

export default SceneRenderPipeline;

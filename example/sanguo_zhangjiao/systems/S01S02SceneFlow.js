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

const SPECIAL_FAINT_LABELS = Object.freeze({
  passerby: '路人救援', patrol: '小股官兵救援', temporaryCamp: '临时扎营'
});

const REFUEL_PROGRESS_OWNER = 'campfireRefuel';
const REFUEL_DURATION_SECONDS = 1;
const SHELTER_CONSTRUCTION_PROGRESS_OWNER = 's01ShelterConstruction';
const RECIPE_ACTION_PROGRESS_OWNER = 's01RecipeAction';
const RECIPE_ACTION_RANGE = 96;
const RECIPE_ACTIONS = Object.freeze({
  's01.roastedWolfMeat': Object.freeze({
    workstationId: 's01.cookingRack', placementId: 'S01-prop-cooking-rack', duration: 2,
    kind: 'cooking', inputImageId: 's01.item.rawWolfMeat', outputImageId: 's01.food.roastedWolfMeat',
    inputSize: Object.freeze({ width: 42, height: 34 }), outputSize: Object.freeze({ width: 44, height: 36 })
  }),
  's01.wolfHideVest': Object.freeze({
    workstationId: 's01.tanningRack', placementId: 'S01-prop-tanning-rack', duration: 3,
    kind: 'tanning', inputImageId: 's01.item.wolfHide', outputImageId: 's01.equipment.wolfHideVest',
    inputSize: Object.freeze({ width: 48, height: 38 }), outputSize: Object.freeze({ width: 46, height: 52 })
  }),
  's01.wolfHideBracers': Object.freeze({
    workstationId: 's01.tanningRack', placementId: 'S01-prop-tanning-rack', duration: 2,
    kind: 'tanning', inputImageId: 's01.item.wolfHide', outputImageId: 's01.equipment.wolfHideBracers',
    inputSize: Object.freeze({ width: 48, height: 38 }), outputSize: Object.freeze({ width: 48, height: 40 })
  })
});
const CHASE_WOLF_PREFIX = 'S01-chase-wolf-';
const MAX_CHASE_WOLVES = 20;
const PURSUIT_RECONCILE_INTERVAL_SECONDS = 0.75;
const FIRST_WOLF_CORPSE_RETRY_INTERVAL_SECONDS = 0.1;
const FIRST_WOLF_CORPSE_MAX_ATTEMPTS = 30;

/** P1.1/P1.3 S01 生存流程协调器；领域写入统一提交 canonical command。 */
export class S01S02Coordinator {
  constructor(scene) {
    if (!scene) throw new TypeError('S01S02Coordinator requires scene');
    this.scene = scene;
    this.sequence = 0;
    this.refuelCampfireInFlight = null;
    this.refuelCampfireProgress = null;
    this.shelterConstructionProgressActive = false;
    this.recipeActionInFlight = null;
    this.recipeActionProgress = null;
    this.pursuitReconcileElapsed = 0;
    this.pursuitReconcileInFlight = false;
    this.pendingAxeDiscovery = false;
    this.initialToolRevealPending = false;
    this.initialToolRevealRetryElapsed = 0;
    this.pendingWolfDiscovery = false;
    this.pendingClimb = false;
    this.climbCompletionInFlight = false;
    this.pendingPlacementReveals = new Map();
    // 当前 S01 会话中已确认的放置后续，避免健康对象被每帧重新加入补偿队列。
    this.resolvedPlacementContinuations = new Set();
    this.pendingRevealRetryElapsed = 0;
    this.pendingRevealRetryInFlight = false;
    this.s01TimePhaseInitialized = false;
    this.s01WeatherPhaseInitialized = false;
    this.s01TimePauseOwned = false;
    this.firstWolfCorpsePending = null;
    this.firstWolfCorpseRetryElapsed = 0;
    this.firstWolfCorpseRetryInFlight = false;
    this.backpackOpenedInFlight = null;
  }

  _story() {
    return this.scene.gameLoader?.blackboard?.get?.('storyState') || {};
  }

  _submit(definitionId, payload = {}, operationId = null) {
    const gateway = this.scene.sceneRuntime?.commandGateway;
    const actorRef = this.scene.playerEntity?.id;
    if (!gateway || !actorRef) return Promise.resolve({ ok: false, code: 'commandGatewayUnavailable' });
    return gateway.execute({
      intentType: 'state.transaction', actorRef,
      operationId: operationId || `story:${definitionId}:${++this.sequence}`,
      payload: { definitionId, ...payload }
    });
  }

  markBackpackOpened() {
    if (this.scene.currentSceneId !== 'S01') return Promise.resolve({ ok: true, status: 'notApplicable' });
    if (this._story().s01Survival?.backpackOpened === true) {
      return Promise.resolve({ ok: true, status: 'alreadyCommitted' });
    }
    if (this.backpackOpenedInFlight) return this.backpackOpenedInFlight;

    const operationId = `story:s01:backpack-opened:${++this.sequence}`;
    const request = this._submit('story.s01.backpackOpened', {}, operationId)
      .then(result => {
        if (result?.ok === false && result.code === 'preconditionFailed'
          && this._story().s01Survival?.backpackOpened === true) {
          return { ok: true, status: 'alreadyCommitted' };
        }
        return result;
      })
      .finally(() => {
        if (this.backpackOpenedInFlight === request) this.backpackOpenedInFlight = null;
      });
    this.backpackOpenedInFlight = request;
    return request;
  }

  _spawnGroup(group) {
    return this.scene.context.services.placements?.spawn?.({ group });
  }

  /** 玩家背包/装备中是否已持有指定 instanceId 的物品（用于防止世界放置在持有后重复生成）。 */
  _heldInstance(instanceId) {
    if (!instanceId) return false;
    const player = this.scene.playerEntity;
    if (!player) return false;
    const inventory = player.getComponent?.('inventory');
    if (inventory && (inventory.slots || []).some(stack => stack?.item?.instanceId === instanceId)) return true;
    const equipment = player.getComponent?.('equipment');
    if (equipment) {
      const equipped = equipment.getAllEquipment?.() || equipment.slots || {};
      for (const value of Object.values(equipped)) {
        if (value && value.instanceId === instanceId) return true;
      }
    }
    return false;
  }

  async _revealInitialToolKit() {
    const survival = this._story().s01Survival || {};
    const axe = survival.axeFound === true || this._heldInstance('S01-tool-axe-1')
      ? { ok: true, created: false }
      : await this._ensureSpawnedPlacement('S01-worn-axe', 'S01-pickup-worn-axe');
    if (!axe.ok) return false;
    const knife = survival.skinningKnifeFound === true || this._heldInstance('S01-tool-skinning-knife-1')
      ? { ok: true, created: false }
      : await this._ensureSpawnedPlacement('S01-skinning-knife', 'S01-pickup-skinning-knife');
    if (!knife.ok) return false;
    this.initialToolRevealPending = false;
    this.initialToolRevealRetryElapsed = 0;
    return true;
  }

  _releaseS01TimePause() {
    if (!this.s01TimePauseOwned) return false;
    if (this.scene.timeSystem?.paused === true) this.scene.timeSystem.setPaused(false);
    this.s01TimePauseOwned = false;
    return true;
  }

  _resetS01AtmosphereProjection() {
    this._releaseS01TimePause();
    this.s01TimePhaseInitialized = false;
    this.s01WeatherPhaseInitialized = false;
  }

  _applyS01WeatherPhase(survival = this._story().s01Survival || {}, { force = false } = {}) {
    if (this.scene.currentSceneId !== 'S01') return false;
    const applyTime = force || !this.s01TimePhaseInitialized;
    const applyWeather = force || !this.s01WeatherPhaseInitialized;
    if (!applyTime && !applyWeather) return false;

    const overnightCompleted = survival.overnightCompleted === true;
    let applied = false;
    if (applyTime && this.scene.timeSystem?.setTimePeriod) {
      const periodApplied = this.scene.timeSystem.setTimePeriod(overnightCompleted ? 'morning' : 'lateNight');
      if (periodApplied !== false) {
        // S01 拥有这次暂停：默认深夜（过夜后为上午）不会自然漂移，
        // setTimePeriod 仍可由代码或 Trigger 显式改期；离开 S01 时释放暂停。
        this.scene.timeSystem.setPaused?.(true);
        this.s01TimePauseOwned = true;
        this.s01TimePhaseInitialized = true;
        applied = true;
      }
    }
    if (applyWeather && this.scene.weatherSystem?.setWeather) {
      const weatherApplied = this.scene.weatherSystem.setWeather(
        overnightCompleted ? 'clear' : 'heavyFog',
        { immediate: true }
      );
      if (weatherApplied !== false) {
        this.s01WeatherPhaseInitialized = true;
        applied = true;
      }
    }
    return applied;
  }

  /** 读档后接管 S01 氛围；有合法快照时保留其时刻与天气，只重建暂停所有权。 */
  projectRestoredAtmosphere({ hasTimeState = false, hasWeatherState = false } = {}) {
    // 旧所有权属于被替换状态，不能在反序列化之后再 release，否则会篡改存档 paused。
    this.s01TimePauseOwned = false;
    this.s01TimePhaseInitialized = false;
    this.s01WeatherPhaseInitialized = false;
    if (this.scene.currentSceneId !== 'S01') return false;

    if (hasTimeState && this.scene.timeSystem) {
      this.scene.timeSystem.setPaused?.(true);
      this.s01TimePauseOwned = true;
      this.s01TimePhaseInitialized = true;
    }
    if (hasWeatherState && this.scene.weatherSystem) {
      this.s01WeatherPhaseInitialized = true;
    }
    this._applyS01WeatherPhase(this._story().s01Survival || {});
    return true;
  }

  _deriveRestoredTutorialId(survival = this._story().s01Survival || {}) {
    if (survival.pursuit?.active === true) {
      return survival.riverCrossed === true ? 's01.capacity' : 's01.jump';
    }
    if (survival.firstWolfKilled === true && survival.wolfSkinned !== true) return 's01.durability';
    if (survival.firstWolfSpotted === true && survival.firstWolfKilled !== true) return 's01.attack';
    if (survival.berriesGathered === true && survival.woodGathered !== true) return 's01.chopWood';
    if (survival.initialToolsPicked === true && survival.berriesGathered !== true) return 's01.gather';
    if (survival.campfireLit === true && survival.initialToolsPicked !== true) return 's01.pickup';
    if (survival.campfireLit !== true) return 's01.move';
    return null;
  }

  /** 存档没有可恢复的活动教程时，仅按已提交 StoryState 投影当前目标，不重放 Trigger。 */
  projectRestoredProgress() {
    if (this.scene.currentSceneId !== 'S01' || this.scene.tutorialSystem?.getCurrentTutorial?.()) return false;
    const tutorialId = this._deriveRestoredTutorialId();
    if (!tutorialId || this.scene._tutorialFlow?.isCompleted?.(tutorialId) === true) return false;
    const shown = this.scene._tutorialFlow?.show?.(tutorialId, {
      restored: true,
      derivedFromStory: true
    }) === true;
    if (shown) console.log('[S01S02Coordinator] 已按存档 StoryState 重投影当前目标', tutorialId);
    return shown;
  }

  _activateWolf(wolf) {
    const player = this.scene.playerEntity;
    if (!wolf || !player || wolf.isDead || wolf.isDying) return false;
    const combat = wolf.getComponent?.('combat');
    if (!combat || this.scene.aiSystem?.activateAI?.(wolf, 'aggressive') !== true) return false;
    if (!combat.hasTarget?.() || combat.target !== player) combat.setTarget?.(player);
    return true;
  }

  _activateFirstWolf(wolf = this.scene.entityStore?.getById?.('S01-first-wolf-1')) {
    return this._activateWolf(wolf);
  }

  _createFirstWolfContinuation() {
    return {
      mode: 'spawnContinuation',
      group: 'S01-first-wolf',
      placementId: 'S01-first-wolf-1',
      attempts: 0,
      onRecovered: wolf => this._activateFirstWolf(wolf)
    };
  }

  async _ensureFirstWolfFromCommittedState() {
    if (this.pendingWolfDiscovery) return true;
    this.pendingWolfDiscovery = true;
    try {
      const survival = this._story().s01Survival || {};
      if (survival.firstWolfSpotted !== true) return false;

      const continuation = this._createFirstWolfContinuation();
      const placement = await this._ensureSpawnedPlacement(continuation.group, continuation.placementId);
      if (!placement.ok) {
        this._rememberPendingReveal(continuation);
        console.warn('[S01S02Coordinator] 首狼事实已提交，放置进入退避补偿', placement);
        return true;
      }
      if (!this._activateFirstWolf(placement.target)) {
        this._rememberPendingReveal(continuation);
        console.warn('[S01S02Coordinator] 首狼已生成但主动攻击未能激活，进入退避补偿');
        return true;
      }
      this.pendingPlacementReveals.delete(continuation.placementId);
      return true;
    } finally {
      this.pendingWolfDiscovery = false;
    }
  }

  async _ensureSpawnedPlacement(group, placementId) {
    const placements = this.scene.context.services.placements;
    if (!placements) {
      return { ok: false, code: 'placementRuntimeUnavailable', result: null, target: null };
    }

    // 已登记但实体异常丢失时，才释放幂等登记后重建；正常 live 对象不会重生。
    const beforeSpawn = placements.inspectPlacement?.(placementId) || null;
    if (beforeSpawn?.placement
      && beforeSpawn.spawned === true
      && beforeSpawn.live !== true
      && beforeSpawn.tombstoned !== true) {
      placements.forgetSpawnedPlacements?.([placementId]);
    }

    let result;
    try {
      result = await this._spawnGroup(group);
    } catch (error) {
      return { ok: false, code: 'placementSpawnFailed', error, result: null, target: null };
    }

    const outcome = (result?.outcomes || []).find(
      entry => entry?.placementId === placementId
    ) || null;
    if (result?.ok !== true || (result.errors || []).length > 0 || !outcome) {
      return { ok: false, code: 'placementSpawnFailed', result, target: null };
    }
    if (outcome.status !== 'spawned' && outcome.status !== 'alreadySpawned') {
      return {
        ok: false,
        code: outcome.status === 'conditionFalse'
          ? 'placementConditionFalse'
          : 'placementSpawnRejected',
        result,
        target: null
      };
    }

    const inspection = placements.inspectPlacement?.(placementId) || null;
    if (!inspection?.placement) {
      return { ok: false, code: 'placementNotFound', result, target: null };
    }
    if (!inspection.live) {
      return {
        ok: false,
        code: inspection.tombstoned ? 'placementAlreadyRemoved' : 'placementLiveObjectMissing',
        result,
        target: null
      };
    }
    if (inspection.matchesProjection !== true) {
      return {
        ok: false,
        code: 'placementCoordinateMismatch',
        result,
        target: null,
        actual: inspection.actual || null,
        expected: inspection.expected || null
      };
    }

    this.resolvedPlacementContinuations.add(placementId);
    return {
      ok: true,
      created: outcome.status === 'spawned',
      result,
      target: inspection.value
    };
  }

  async _reconcileWolfPursuit() {
    const pursuit = this._story().s01Survival?.pursuit;
    if (this.scene.currentSceneId !== 'S01' || pursuit?.active !== true) return true;
    if (this.pursuitReconcileInFlight) return true;

    this.pursuitReconcileInFlight = true;
    try {
      const spawned = Math.min(MAX_CHASE_WOLVES, Math.max(0, Math.floor(Number(pursuit.spawned) || 0)));
      const result = await this._spawnGroup('S01-chase-wolves');
      if (result?.ok !== true || (result.errors || []).length > 0) {
        console.warn('[S01S02Coordinator] 追逐狼放置未完整成立，等待补偿', result);
        return false;
      }

      const missing = [];
      for (let index = 1; index <= spawned; index += 1) {
        const entityId = `${CHASE_WOLF_PREFIX}${index}`;
        const wolf = this.scene.entityStore?.getById?.(entityId);
        if (!wolf) {
          missing.push(entityId);
          continue;
        }
        if (wolf.isDead || wolf.isDying || !wolf.getComponent?.('combat')) continue;
        this._activateWolf(wolf);
      }
      if (missing.length > 0) {
        console.warn('[S01S02Coordinator] 追逐狼仍有缺失，等待补偿', missing);
        return false;
      }
      return true;
    } catch (error) {
      console.warn('[S01S02Coordinator] 追逐狼补偿异常', error);
      return false;
    } finally {
      this.pursuitReconcileInFlight = false;
    }
  }

  _createWoodGatherContinuation() {
    return {
      mode: 'spawnContinuation',
      group: 'S01-wood',
      placementId: 'S01-node-wood-1',
      attempts: 0
    };
  }

  _createCampfireContinuation() {
    return {
      mode: 'spawnContinuation',
      group: 'S01-berries',
      placementId: 'S01-node-berry-1',
      attempts: 0
    };
  }

  _rememberPendingReveal(request) {
    this.resolvedPlacementContinuations.delete(request.placementId);
    const previous = this.pendingPlacementReveals.get(request.placementId);
    this.pendingPlacementReveals.set(request.placementId, {
      ...request,
      attempts: previous?.attempts || request.attempts || 0
    });
  }

  async _revealPlacement(group, placementId, payload = {}, operationId = null, options = {}) {
    const pending = this.pendingPlacementReveals.get(placementId);
    const request = {
      group,
      placementId,
      payload,
      operationId: operationId || `world-item:revealed:${placementId}`,
      target: pending?.target || null,
      onRecovered: pending?.onRecovered || options.onRecovered || null,
      revealed: pending?.revealed === true,
      attempts: pending?.attempts || 0
    };
    if (request.revealed) {
      this.pendingPlacementReveals.delete(placementId);
      return true;
    }
    let target = request.target;
    if (!target) {
      let result;
      try {
        result = await this._spawnGroup(group);
      } catch (error) {
        this._rememberPendingReveal(request);
        console.warn('[S01S02Coordinator] 物品放置执行失败', { group, placementId, error });
        return false;
      }
      target = result?.entities?.find?.(
        entity => entity?.placementId === placementId || entity?.id === placementId
      ) || null;
      if (result?.ok !== true || (result.errors || []).length > 0
        || Number(result?.counts?.total) <= 0 || !target) {
        this._rememberPendingReveal(request);
        console.warn('[S01S02Coordinator] 物品放置未完整成立', { group, placementId, result });
        return false;
      }
      request.target = target;
    }

    const position = target.getComponent?.('transform')?.position || target;
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
      this._rememberPendingReveal(request);
      console.warn('[S01S02Coordinator] 物品放置缺少世界坐标', { group, placementId });
      return false;
    }

    let published;
    try {
      published = await this.scene.publishApplicationEvent?.('worldItem.revealed', {
        placementId,
        entityId: target.entityId || target.id || null,
        groundId: target.entityId || target.id || placementId,
        definitionId: target.definitionId || target.itemId || target.id || null,
        name: target.name || payload.name || '物品',
        position: { x: position.x, y: position.y },
        reason: payload.reason || 'discovery',
        ...payload
      }, {
        operationId: request.operationId,
        sceneId: this.scene.currentSceneId
      });
    } catch (error) {
      this._rememberPendingReveal(request);
      console.warn('[S01S02Coordinator] 物品发现事件发布异常', placementId, error);
      return false;
    }
    if (published?.ok !== true) {
      this._rememberPendingReveal(request);
      console.warn('[S01S02Coordinator] 物品发现事件发布失败', placementId, published?.code);
      return false;
    }
    this.pendingPlacementReveals.delete(placementId);
    return true;
  }

  async _retryPendingPlacementReveal() {
    if (this.pendingRevealRetryInFlight || this.pendingPlacementReveals.size === 0) return false;
    const request = this.pendingPlacementReveals.values().next().value;
    request.attempts += 1;
    this.pendingPlacementReveals.set(request.placementId, request);
    this.pendingRevealRetryInFlight = true;
    try {
      if (request.mode === 'spawnContinuation') {
        const placement = await this._ensureSpawnedPlacement(request.group, request.placementId);
        if (!placement.ok) {
          this._rememberPendingReveal(request);
          return false;
        }
        if (request.onRecovered) {
          try {
            const recovered = await request.onRecovered(placement.target);
            if (recovered === false) {
              this._rememberPendingReveal(request);
              return false;
            }
          } catch (error) {
            this._rememberPendingReveal(request);
            console.warn('[S01S02Coordinator] 放置后续补偿异常', request.placementId, error);
            return false;
          }
        }
        this.pendingPlacementReveals.delete(request.placementId);
        return true;
      }
      if (request.revealed !== true) {
        const revealed = await this._revealPlacement(
          request.group,
          request.placementId,
          request.payload,
          request.operationId,
          { onRecovered: request.onRecovered }
        );
        if (!revealed) return false;
        request.revealed = true;
      }
      if (request.onRecovered) {
        try {
          const recovered = await request.onRecovered();
          if (recovered === false) {
            this._rememberPendingReveal(request);
            return false;
          }
        } catch (error) {
          this._rememberPendingReveal(request);
          console.warn('[S01S02Coordinator] 物品发现后续补偿异常', request.placementId, error);
          return false;
        }
      }
      this.pendingPlacementReveals.delete(request.placementId);
      return true;
    } finally {
      this.pendingRevealRetryInFlight = false;
    }
  }

  resolve() {
    const story = this._story();
    return story.pendingDefeatResolution === 'specialFaint'
      ? { type: 'specialFaint', rescueType: story.specialFaintRescueType || 'passerby' }
      : { type: 'normalDeath' };
  }

  handleResolved(result = {}) {
    if (result.type !== 'specialFaint') return false;
    const label = SPECIAL_FAINT_LABELS[result.rescueType] || SPECIAL_FAINT_LABELS.passerby;
    const location = result.respawnPosition?.label || '安全处';
    this.scene._showScreenTip(`${label}：你在${location}醒来，未扣除资源，也未生成遗失物资`);
    return true;
  }

  _readStoryPath(path) {
    return String(path || '').split('.').filter(Boolean)
      .reduce((value, key) => value?.[key], this._story());
  }

  async _commitStoryWhenReady(params = {}, eventData = {}) {
    if (this.scene.currentSceneId !== 'S01') return { ok: true, status: 'notApplicable' };
    const definitionId = String(params.definitionId || '').trim();
    if (!definitionId) return { ok: false, code: 'definitionIdMissing' };
    if (params.completedPath && this._readStoryPath(params.completedPath) === true) {
      return { ok: true, status: 'alreadyCommitted' };
    }
    if (params.storyPath) {
      const value = this._readStoryPath(params.storyPath);
      if (params.gte !== undefined && Number(value) < Number(params.gte)) {
        return { ok: true, status: 'notReady' };
      }
      if (params.equals !== undefined && value !== params.equals) {
        return { ok: true, status: 'notReady' };
      }
    }
    if (params.inventoryItemId) {
      const inventory = this.scene.playerEntity?.getComponent?.('inventory');
      if (!inventory?.getItemCount) return { ok: false, code: 'inventoryUnavailable' };
      const quantity = Math.max(0, Number(inventory.getItemCount(params.inventoryItemId)) || 0);
      if (quantity < Math.max(0, Number(params.minimumQuantity) || 0)) {
        return { ok: true, status: 'notReady' };
      }
    }
    const sourceOperationId = eventData.operationId || eventData.eventId;
    if (!sourceOperationId) return { ok: false, code: 'sourceOperationIdMissing' };
    const result = await this._submit(
      definitionId,
      {},
      `${sourceOperationId}:state:${definitionId}`
    );
    // 幂等护栏：commitStoryWhenReady 的契约是「条件就绪才提交、未就绪则跳过」。
    // 提交瞬间事务前置条件不满足（preconditionFailed）只有两种良性含义：
    //   - 其它路径已抢先提交该事实（completedPath 已为 true）→ alreadyCommitted；
    //   - 事实前置条件尚未达成（如前置步骤未完成）→ notReady。
    // 两者都不应视为硬失败（否则会刷红 DebugPanel 并触发事件重试）。
    if (result.ok === false && result.code === 'preconditionFailed') {
      const achieved = params.completedPath
        && this._readStoryPath(params.completedPath) === true;
      return { ok: true, status: achieved ? 'alreadyCommitted' : 'notReady' };
    }
    if (result.ok === true && params.successTip) {
      const accepted = Math.max(0, Number(eventData.accepted) || 0);
      this.scene._showScreenTip(String(params.successTip).replaceAll('{accepted}', String(accepted)), {
        title: params.successTitle || '目标更新'
      });
    }
    return result;
  }

  _presentWoodGatheredCommitted() {
    if (this._story().s01Survival?.woodGathered !== true) return false;
    this.scene._showScreenTip('木材已经够三根了。靠近火堆，{interact}可以添柴。', {
      title: '返回火堆'
    });
    return true;
  }

  _presentWolfSkinnedCommitted() {
    if (this._story().s01Survival?.wolfSkinned !== true) return false;
    void this._spawnWorkstation('S01-cooking-rack');
    this.scene._showScreenTip('狼皮已经剥下。去烤肉架烤制狼肉。', {
      title: '获得狼皮'
    });
    return true;
  }

  _requestFirstWolfRecovery(sourceOperationId) {
    if (!sourceOperationId) return Promise.resolve({ ok: false, code: 'sourceOperationIdMissing' });
    return this.scene.publishApplicationEvent('s01.firstWolfRecoveryRequested', {
      reason: 'refuelRecovery'
    }, {
      operationId: `${sourceOperationId}:first-wolf-recovery`,
      sceneId: 'S01'
    });
  }

  async onInitialToolsPickedCommitted() {
    if (this.scene.currentSceneId !== 'S01'
      || this._story().s01Survival?.initialToolsPicked !== true) return false;
    this.scene._tutorialFlow?.complete?.('s01.pickup');
    const fuelStarted = this.scene._campfireService?.startFuelCountdown?.() === true;
    const continuation = this._createCampfireContinuation();
    const placement = await this._ensureSpawnedPlacement(continuation.group, continuation.placementId);
    if (!placement.ok) {
      this._rememberPendingReveal(continuation);
      console.warn('[S01S02Coordinator] 双工具拾取后野果放置进入退避补偿', placement);
      return fuelStarted;
    }
    this.pendingPlacementReveals.delete(continuation.placementId);
    return true;
  }

  async onBerriesGatheredCommitted() {
    if (this.scene.currentSceneId !== 'S01'
      || this._story().s01Survival?.berriesGathered !== true) return false;
    const fuelStarted = this.scene._campfireService?.startFuelCountdown?.() === true;
    const continuation = this._createWoodGatherContinuation();
    const placement = await this._ensureSpawnedPlacement(continuation.group, continuation.placementId);
    if (!placement.ok) {
      this._rememberPendingReveal(continuation);
      console.warn('[S01S02Coordinator] 野果采集完成后木材放置进入退避补偿', placement);
      return fuelStarted;
    }
    this.pendingPlacementReveals.delete(continuation.placementId);
    return true;
  }

  async handleItemUsed(item = {}) {
    if (this.scene.currentSceneId !== 'S01') return false;
    if (item.id === 'resource.wild_berry') {
      const result = await this._submit('story.s01.berryEaten', {}, 'story:s01:berry-eaten');
      return result.ok === true;
    }
    if (item.id === 'food.roasted_wolf_meat') {
      this.scene._showScreenTip('烤狼肉恢复了生命。', {
        title: '恢复生命'
      });
      return true;
    }
    return false;
  }

  _captureFirstWolfCorpse(entity) {
    const corpses = this.scene.context.services.corpses || this.scene.corpseRuntime;
    const corpse = corpses?.capture?.(entity);
    const position = corpse?.position;
    const resourceNode = entity?.getComponent?.('resourceNode');
    if (corpse?.kind !== 'corpse'
      || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)
      || !corpse.resourceNode || !resourceNode) return null;
    return corpse;
  }

  _publishEnemyKilled(entity, enemyRole, corpseReady) {
    return this.scene.publishApplicationEvent('enemy.killed', {
      entityId: entity.id,
      enemyRole,
      corpseReady: corpseReady === true
    }, {
      operationId: `application:enemy.killed:${entity.id}`,
      sceneId: 'S01'
    });
  }

  _queueFirstWolfCorpseCommit(entity) {
    if (!entity?.id) return false;
    if (!this.firstWolfCorpsePending) {
      this.firstWolfCorpsePending = { entity, entityId: entity.id, attempts: 0 };
      this.firstWolfCorpseRetryElapsed = 0;
      console.warn('[S01S02Coordinator] 首狼尸体或采集节点尚未完整成立，等待有界补偿', {
        entityId: entity.id,
        maxAttempts: FIRST_WOLF_CORPSE_MAX_ATTEMPTS
      });
    } else {
      this.firstWolfCorpsePending.entity = entity;
    }
    return true;
  }

  async _publishFirstWolfKillWhenReady(entity) {
    if (this._story().s01Survival?.firstWolfKilled === true) {
      this.firstWolfCorpsePending = null;
      return true;
    }
    const corpse = this._captureFirstWolfCorpse(entity);
    if (!corpse) return false;
    const published = await this._publishEnemyKilled(entity, 'firstWolf', true);
    if (published?.ok === true) this.firstWolfCorpsePending = null;
    return published?.ok === true;
  }

  _updateFirstWolfCorpseCommit(deltaTime) {
    const pending = this.firstWolfCorpsePending;
    if (!pending || pending.exhausted === true || this.firstWolfCorpseRetryInFlight) return;
    if (this._story().s01Survival?.firstWolfKilled === true) {
      this.firstWolfCorpsePending = null;
      return;
    }
    this.firstWolfCorpseRetryElapsed += Math.max(0, Number(deltaTime) || 0);
    if (this.firstWolfCorpseRetryElapsed < FIRST_WOLF_CORPSE_RETRY_INTERVAL_SECONDS) return;
    this.firstWolfCorpseRetryElapsed = 0;
    if (pending.attempts >= FIRST_WOLF_CORPSE_MAX_ATTEMPTS) {
      console.error('[S01S02Coordinator] 首狼可采集尸体补偿已达上限，拒绝提交击杀剧情', {
        entityId: pending.entityId,
        attempts: pending.attempts
      });
      pending.exhausted = true;
      return;
    }

    pending.attempts += 1;
    const entity = this.scene.entityStore?.getById?.(pending.entityId) || pending.entity;
    this.firstWolfCorpseRetryInFlight = true;
    void this._publishFirstWolfKillWhenReady(entity).then(committed => {
      if (committed || this.firstWolfCorpsePending !== pending) return;
      if (pending.attempts >= FIRST_WOLF_CORPSE_MAX_ATTEMPTS) {
        console.error('[S01S02Coordinator] 首狼尸体始终未形成有效采集节点，剧情保持未提交', {
          entityId: pending.entityId,
          attempts: pending.attempts
        });
        pending.exhausted = true;
      }
    }).catch(error => {
      console.warn('[S01S02Coordinator] 首狼尸体击杀事实补偿失败', {
        entityId: pending.entityId,
        attempt: pending.attempts,
        error
      });
    }).finally(() => {
      this.firstWolfCorpseRetryInFlight = false;
    });
  }

  async handleEnemyKilled(entity) {
    if (this.scene.currentSceneId !== 'S01' || !entity?.id) return false;
    const isChaseWolf = entity.id.startsWith(CHASE_WOLF_PREFIX);
    const isFirstWolf = entity.id === 'S01-first-wolf-1';
    if (!isChaseWolf && !isFirstWolf) return false;
    if (isChaseWolf) {
      const published = await this._publishEnemyKilled(entity, 'chaseWolf', false);
      return published?.ok === true;
    }

    if (this.firstWolfCorpseRetryInFlight) {
      this._queueFirstWolfCorpseCommit(entity);
      return true;
    }
    this.firstWolfCorpseRetryInFlight = true;
    try {
      if (await this._publishFirstWolfKillWhenReady(entity)) return true;
      this._queueFirstWolfCorpseCommit(entity);
      return true;
    } finally {
      this.firstWolfCorpseRetryInFlight = false;
    }
  }

  async handleConstructionEvent(event, data = {}) {
    const siteId = data?.siteId || data?.structure?.siteId;
    if (this.scene.currentSceneId !== 'S01' || event !== 'constructionCompleted'
      || siteId !== 'site.s01.small_shelter') return false;
    const rollback = this.pendingConstructionRollback;
    const result = await this._submit('story.s01.shelterCompleted', {}, 'story:s01:shelter-completed');
    this.pendingConstructionRollback = null;
    if (!result.ok) {
      this.scene.s10ConstructionCoordinator?._restoreConstructionRollback?.(rollback);
      this.scene._showScreenTip('庇护所结算失败，材料和施工状态已经回滚。', { title: '施工回滚' });
      return false;
    }
    await this._spawnGroup('S01-small-shelter');
    this.scene._showScreenTip('小庇护所搭好了。烤肉、木墙和余火让你终于可以熬过这一夜。', {
      title: '庇护所完成'
    });
    return true;
  }

  async startShelterConstruction() {
    if (this.scene.currentSceneId !== 'S01') {
      return { ok: false, code: 'shelterSceneMismatch' };
    }
    if (!this.scene.constructionSystem) {
      return { ok: false, code: 'constructionUnavailable' };
    }
    const survival = this._story().s01Survival || {};
    if (!survival.meatCooked || !survival.wolfGearCrafted) {
      this.scene._showScreenTip('先烤制狼肉，再制作狼皮背心和狼皮护腕，之后才能搭建庇护所。', { title: '准备不足' });
      return { ok: true, status: 'blocked', code: 'shelterPrerequisitesMissing' };
    }
    const siteId = 'site.s01.small_shelter';
    if (this.scene.constructionSystem.getStructure(siteId)) {
      this.scene._showScreenTip('小庇护所已经搭好，可以在这里过夜。');
      return { ok: true, status: 'blocked', code: 'shelterAlreadyCompleted', siteId };
    }
    const pending = this.scene.constructionSystem.getPending(siteId);
    if (pending) {
      this.scene._showScreenTip(`庇护所施工进度 ${Math.floor(pending.progress * 100)}%。`, { title: '正在施工' });
      return {
        ok: true,
        status: 'blocked',
        code: 'shelterConstructionActive',
        siteId,
        progress: pending.progress
      };
    }
    const inventory = this.scene.playerEntity?.getComponent?.('inventory');
    const operationId = 'construction:S01:smallShelter';
    const rollback = this.scene.s10ConstructionCoordinator?._captureConstructionRollback?.();
    const result = this.scene.constructionSystem.start({
      characterId: this.scene.playerEntity?.id,
      inventory,
      definitionId: 'construction.s01.small_shelter',
      siteId,
      operationId,
      context: { sceneId: 'S01' }
    });
    if (!result.ok) {
      const ownedMaterial = result.itemId && inventory?.getItemCount
        ? inventory.getItemCount(result.itemId)
        : 0;
      const missingMaterial = Math.max(1, (Number(result.quantity) || 0) - ownedMaterial);
      const messages = {
        materialsRequired: `木材不足：还需要 ${missingMaterial} 份。`,
        proficiencyRequired: `营建熟练度不足：需要 ${result.required || 0} 级。`,
        toolRequired: '缺少搭建庇护所所需的有效工具。',
        toolReserved: '所需工具正在用于其他施工。',
        siteBusy: '小庇护所正在施工。',
        siteOccupied: '小庇护所已经搭好。',
        invalidSite: '只能在篝火旁的平地搭建小庇护所。',
        constructionSiteLocked: '小庇护所施工点尚未开放。'
      };
      this.scene._showScreenTip(messages[result.code] || `无法施工：${result.code || 'unknown'}`, { title: '施工未开始' });
      const playerCorrectableCodes = new Set([
        'materialsRequired', 'proficiencyRequired', 'toolRequired', 'toolReserved',
        'siteBusy', 'siteOccupied', 'invalidSite', 'constructionSiteLocked'
      ]);
      return playerCorrectableCodes.has(result.code)
        ? { ...result, ok: true, status: 'blocked', blocked: true }
        : result;
    }
    const checkpointId = 'checkpoint.S01.shelterStarted';
    const saved = await this.scene.requestAutoSave?.({
      reason: 'checkpoint', checkpointId, sceneId: 'S01'
    });
    if (saved?.ok === false) {
      this.scene.s10ConstructionCoordinator?._restoreConstructionRollback?.(
        rollback, [`${operationId}:materials`]
      );
      this.scene._showScreenTip('施工检查点保存失败，材料和施工状态已经回滚。', { title: '施工回滚' });
      return {
        ok: false,
        code: saved.code || 'shelterCheckpointFailed',
        checkpointId,
        message: saved.message || 'shelter checkpoint failed'
      };
    }
    this.scene._showScreenTip(`开始搭建小庇护所，预计 ${Math.ceil(result.duration)} 秒完成。`, {
      title: '搭建庇护所'
    });
    const startedPending = this.scene.constructionSystem.getPending(siteId);
    this.shelterConstructionProgressActive = true;
    this._showShelterConstructionProgress('started', startedPending);
    return result;
  }

  /** 只读投影 ConstructionSystem 的实际施工进度，不拥有施工计时或结算。 */
  _showShelterConstructionProgress(event, pending = null) {
    const progress = event === 'completed' ? 1 : Number(pending?.progress) || 0;
    return this.scene.context?.presentation?.gatheringProgress?.handleEvent?.(
      event,
      { progress },
      this.scene.playerEntity,
      SHELTER_CONSTRUCTION_PROGRESS_OWNER
    ) === true;
  }

  _canShowRefuelProgress() {
    if (this.scene.currentSceneId !== 'S01' || !this.scene.playerEntity) return false;
    const fuel = this.scene._campfireService;
    const currentFuel = fuel?.getFuelSnapshot?.();
    if (fuel?.isLit?.() !== true && Number(currentFuel?.units) > 0) return false;
    const survival = this._story().s01Survival || {};
    if (survival.firstWolfSpotted === true && survival.firstWolfKilled !== true) return false;
    if (survival.firstWolfKilled !== true && Number(survival.campfireRefuelCount) >= 3) return false;
    if (fuel?.canAddFuelUnits?.(1) !== true) return false;
    const inventory = this.scene.playerEntity.getComponent?.('inventory');
    return inventory?.getItemCount?.('resource.wood') >= 1
      && Boolean(this.scene.context?.presentation?.gatheringProgress);
  }

  _showRefuelProgress(event, progress = 0, actor = this.scene.playerEntity) {
    return this.scene.context?.presentation?.gatheringProgress?.handleEvent?.(
      event,
      { progress },
      actor,
      REFUEL_PROGRESS_OWNER
    ) === true;
  }

  refuelCampfire(eventData = {}) {
    if (this.refuelCampfireInFlight) return this.refuelCampfireInFlight;
    const operationId = eventData.operationId || eventData.eventId || null;
    if (!this._canShowRefuelProgress()) {
      const pending = this._refuelCampfireOnce(operationId).finally(() => {
        if (this.refuelCampfireInFlight === pending) this.refuelCampfireInFlight = null;
      });
      this.refuelCampfireInFlight = pending;
      return pending;
    }

    let resolveAction;
    let rejectAction;
    const action = new Promise((resolve, reject) => {
      resolveAction = resolve;
      rejectAction = reject;
    });
    const session = {
      actor: this.scene.playerEntity,
      operationId,
      elapsed: 0,
      duration: REFUEL_DURATION_SECONDS,
      committing: false,
      resolve: resolveAction,
      reject: rejectAction
    };
    this.refuelCampfireProgress = session;
    this._showRefuelProgress('started', 0, session.actor);

    const pending = action.finally(() => {
      if (this.refuelCampfireProgress === session) {
        this._showRefuelProgress('completed', 1, session.actor);
        this.refuelCampfireProgress = null;
      }
      if (this.refuelCampfireInFlight === pending) this.refuelCampfireInFlight = null;
    });
    this.refuelCampfireInFlight = pending;
    return pending;
  }

  _updateRefuelProgress(deltaTime) {
    const session = this.refuelCampfireProgress;
    if (!session || session.committing) return;
    if (!session.actor || this.scene.currentSceneId !== 'S01') {
      this._showRefuelProgress('interrupted', 0, session.actor);
      this.refuelCampfireProgress = null;
      session.resolve({ ok: false, code: 'refuelInterrupted' });
      return;
    }
    session.elapsed = Math.min(session.duration, session.elapsed + Math.max(0, Number(deltaTime) || 0));
    const progress = session.duration > 0 ? session.elapsed / session.duration : 1;
    this._showRefuelProgress('progress', progress, session.actor);
    if (progress < 1) return;

    session.committing = true;
    void this._refuelCampfireOnce(session.operationId).then(session.resolve, session.reject);
  }

  async _refuelCampfireOnce(sourceOperationId = null) {
    if (this.scene.currentSceneId !== 'S01') return false;
    const fuel = this.scene._campfireService;
    const currentFuel = fuel?.getFuelSnapshot?.();
    if (fuel?.isLit?.() !== true && Number(currentFuel?.units) > 0) {
      const ignited = fuel.ignite({ runtime: { particleSystem: this.scene.particleSystem } });
      if (ignited) {
        this.scene._showScreenTip('余烬重新燃起，火焰再次照亮了周围。', { title: '篝火重燃' });
        const reignitedSurvival = this._story().s01Survival || {};
        if (Number(reignitedSurvival.campfireRefuelCount) >= 3
          && reignitedSurvival.firstWolfSpotted !== true) {
          const recovery = await this._requestFirstWolfRecovery(sourceOperationId);
          if (recovery?.ok !== true) return recovery;
        }
        return { ok: true, status: 'reignited' };
      }
      this.scene._showScreenTip('篝火暂时无法点燃，请稍后再试。', { title: '点燃失败' });
      return { ok: false, code: 'campfireIgniteFailed' };
    }
    const survival = this._story().s01Survival || {};
    // 首狼出现期间（尚未击杀）锁定添柴；击杀后恢复自由添柴/重燃。
    if (survival.firstWolfSpotted === true && survival.firstWolfKilled !== true) {
      this.scene._showScreenTip('野狼正在逼近，无暇添柴！先解决眼前的野狼。', { title: '无法添柴' });
      return { ok: true, status: 'blocked' };
    }
    if (survival.firstWolfKilled !== true && Number(survival.campfireRefuelCount) >= 3) {
      const recovery = await this._requestFirstWolfRecovery(sourceOperationId);
      if (recovery?.ok === true) return { ok: true, recovered: true };
      this.scene._showScreenTip('篝火已经添足木材，野狼出现事件暂未提交，请再次交互。', {
        title: '事件提交失败'
      });
      return recovery;
    }
    if (fuel?.canAddFuelUnits?.(1) !== true) {
      this.scene._showScreenTip('篝火燃料已满，暂时不需要再添木材。', { title: '无需添柴' });
      return { ok: true, status: 'blocked' };
    }
    const inventory = this.scene.playerEntity?.getComponent?.('inventory');
    if (!inventory?.getItemCount || inventory.getItemCount('resource.wood') < 1) {
      this.scene._showScreenTip('背包里没有可用木材，先用破旧斧头砍些枯木。', { title: '木材不足' });
      return { ok: true, status: 'blocked' };
    }
    let result = await this._submit(
      'story.s01.refuelCampfire',
      {},
      sourceOperationId ? `${sourceOperationId}:state:story.s01.refuelCampfire` : `story:s01:refuel:${++this.sequence}`
    );
    // 首狼阶段的事务（refuelCount≤2、狼未出现）在前置校验失败时，
    // 击杀首狼后改走自由添柴事务，保证篝火熄灭后可以继续添柴和点燃。
    if (result.ok !== true && survival.firstWolfKilled === true) {
      result = await this._submit(
        'story.s01.refuelCampfireAfterWolf',
        {},
        sourceOperationId
          ? `${sourceOperationId}:state:story.s01.refuelCampfireAfterWolf`
          : `story:s01:refuel-after-wolf:${++this.sequence}`
      );
    }
    if (result.ok !== true) {
      this.scene._showScreenTip(`添柴结算失败：${result.code || 'unknown'}。木材没有被消耗。`, { title: '添柴失败' });
      return result;
    }
    // 容量已在提交前预检；失败不回滚已提交木材，而是保留明确诊断。
    if (fuel.addFuelUnits(1) !== true) {
      console.error('[S01S02Coordinator] 添柴事务已提交但燃料投影未写入');
      return { ok: true, warning: 'fuelProjectionFailed' };
    }
    // 火焰熄灭时投入木柴后立即重新点燃（不再要求再交互一次）。
    let reignitedByFuel = false;
    if (fuel.isLit() !== true && fuel.canIgnite?.()) {
      reignitedByFuel = fuel.ignite({ runtime: { particleSystem: this.scene.particleSystem } });
    }
    this.scene._showScreenTip(reignitedByFuel || fuel.isLit()
      ? reignitedByFuel
        ? '你把木柴投入余烬，火焰腾地重新燃起。'
        : '你把一份枯木投入火堆，火焰又旺了一些。'
      : '你把一份枯木放进余烬中。再次靠近火堆，{interact}即可重新点燃。', {
      title: reignitedByFuel ? '篝火重燃' : (fuel.isLit() ? '添柴成功' : '木柴已放入')
    });
    return { ok: true, status: reignitedByFuel ? 'reignited' : 'refueled' };
  }

  _createRecipeSnapshot(workstationId, { statusMessage = '', statusType = 'info' } = {}) {
    const survival = this._story().s01Survival || {};
    const inventory = this.scene.playerEntity?.getComponent?.('inventory');
    const count = itemId => Math.max(0, Number(inventory?.getItemCount?.(itemId)) || 0);
    const recipes = workstationId === 's01.cookingRack'
      ? [{
        id: 's01.roastedWolfMeat',
        name: '烤狼肉',
        description: '恢复生命 50 点。',
        summary: '狼肉 ×1，木柴 ×1',
        enabled: count('resource.raw_wolf_meat') >= 1 && count('resource.wood') >= 1,
        disabledReason: '需要生狼肉 1 块与木柴 1 根。',
        materials: [
          { name: '生狼肉', available: count('resource.raw_wolf_meat'), quantity: 1 },
          { name: '木柴', available: count('resource.wood'), quantity: 1 }
        ]
      }]
      : [
        {
          id: 's01.wolfHideVest',
          name: '狼皮背心',
          description: '防御 +10，生命 +5。',
          summary: '狼皮 ×2',
          enabled: count('resource.wolf_hide') >= 2,
          disabledReason: '需要狼皮 2 张。',
          materials: [{ name: '狼皮', available: count('resource.wolf_hide'), quantity: 2 }]
        },
        {
          id: 's01.wolfHideBracers',
          name: '狼皮护腕',
          description: '防御 +3，攻击 +1。',
          summary: '狼皮 ×1',
          enabled: count('resource.wolf_hide') >= 1,
          disabledReason: '需要狼皮 1 张。',
          materials: [{ name: '狼皮', available: count('resource.wolf_hide'), quantity: 1 }]
        }
      ];
    return Object.freeze({
      title: workstationId === 's01.cookingRack' ? '烤肉架' : '制皮木支架',
      workstationId,
      actionLabel: workstationId === 's01.cookingRack' ? '烤制' : '制作',
      statusMessage,
      statusType,
      recipes: Object.freeze(recipes.map(recipe => Object.freeze({
        ...recipe,
        materials: Object.freeze(recipe.materials.map(material => Object.freeze({ ...material })))
      })))
    });
  }

  openRecipeSelection(workstationId) {
    if (this.recipeActionInFlight) return { ok: true, status: 'blocked', code: 'recipeActionActive' };
    const view = this.scene.recipeSelectionView;
    if (!view) return { ok: false, code: 'recipeViewUnavailable' };
    view.open(this._createRecipeSnapshot(workstationId));
    return { ok: true };
  }

  async _spawnWorkstation(group) {
    try {
      const result = await this._spawnGroup(group);
      if (result?.ok === false) console.warn('[S01S02Coordinator] 工作站放置失败，将由状态重建恢复', result);
      return result || { ok: true };
    } catch (error) {
      console.warn('[S01S02Coordinator] 工作站放置异常，将由状态重建恢复', error);
      return { ok: false, code: 'workstationSpawnFailed' };
    }
  }

  _refreshRecipeView(workstationId, options = {}) {
    const view = this.scene.recipeSelectionView;
    if (view?.visible) view.setSnapshot(this._createRecipeSnapshot(workstationId, options));
  }

  isRecipeActionActiveFor(actor = null) {
    const session = this.recipeActionProgress;
    return Boolean(session && (!actor || session.actor === actor));
  }

  _resolveRecipeWorkstation(placementId) {
    return this.scene.context?.services?.placements?.inspectPlacement?.(placementId)?.value || null;
  }

  _validateRecipeAction(session) {
    if (this.scene.currentSceneId !== 'S01') return 'sceneChanged';
    if (!session.actor || session.actor.isDead === true || session.actor.isSoulState === true) return 'actorUnavailable';
    if (this._resolveRecipeWorkstation(session.action.placementId) !== session.workstation) return 'workstationUnavailable';
    const actorPosition = session.actor.getComponent?.('transform')?.position;
    const workstationPosition = session.workstation.getComponent?.('transform')?.position;
    if (!actorPosition || !workstationPosition) return 'workstationUnavailable';
    return Math.hypot(actorPosition.x - workstationPosition.x, actorPosition.y - workstationPosition.y) > RECIPE_ACTION_RANGE
      ? 'outOfRange'
      : null;
  }

  _showRecipeActionProgress(event, session, progress = 0) {
    return this.scene.context?.presentation?.gatheringProgress?.handleEvent?.(
      event,
      { progress },
      session?.actor || null,
      RECIPE_ACTION_PROGRESS_OWNER
    ) === true;
  }

  _showRecipeActionVisual(event, session, progress = 0) {
    const action = session?.action;
    return this.scene.context?.presentation?.worldAction?.handleEvent?.(
      event,
      event === 'started'
        ? {
          progress,
          anchorEntity: session.workstation,
          kind: action.kind,
          inputImageId: action.inputImageId,
          outputImageId: action.outputImageId,
          inputSize: action.inputSize,
          outputSize: action.outputSize
        }
        : { progress },
      RECIPE_ACTION_PROGRESS_OWNER
    ) === true;
  }

  interruptRecipeAction(reason = 'interrupted') {
    const session = this.recipeActionProgress;
    if (!session || session.committing) return false;
    this.recipeActionProgress = null;
    this._showRecipeActionProgress('interrupted', session);
    this._showRecipeActionVisual('interrupted', session);
    session.resolve({ ok: false, code: 'recipeActionInterrupted', reason });
    if (reason === 'damaged') {
      this.scene._showScreenTip('受到攻击，制作已中断，材料没有被消耗。', { title: '制作中断' });
    }
    return true;
  }

  _startRecipeAction(workstationId, recipeId) {
    if (this.recipeActionInFlight) return this.recipeActionInFlight;
    const action = RECIPE_ACTIONS[recipeId];
    const actor = this.scene.playerEntity;
    const workstation = action && this._resolveRecipeWorkstation(action.placementId);
    if (!action || action.workstationId !== workstationId) return Promise.resolve({ ok: false, code: 'recipeUnknown' });
    if (!actor || !workstation) return Promise.resolve({ ok: false, code: 'workstationUnavailable' });
    if (this.scene.gatheringSystem?.isActiveFor?.(actor)) return Promise.resolve({ ok: false, code: 'playerBusy' });

    let resolveAction;
    const completion = new Promise(resolve => { resolveAction = resolve; });
    const session = {
      actor,
      workstation,
      workstationId,
      recipeId,
      action,
      operationId: `s01:recipe:${recipeId}:${++this.sequence}`,
      elapsed: 0,
      duration: action.duration,
      committing: false,
      resolve: resolveAction
    };
    const validationError = this._validateRecipeAction(session);
    if (validationError) return Promise.resolve({ ok: false, code: validationError });

    this.recipeActionProgress = session;
    this._showRecipeActionProgress('started', session, 0);
    this._showRecipeActionVisual('started', session, 0);
    this.scene.recipeSelectionView?.close?.();
    const pending = completion.finally(() => {
      if (this.recipeActionProgress === session) this.recipeActionProgress = null;
      if (this.recipeActionInFlight === pending) this.recipeActionInFlight = null;
    });
    this.recipeActionInFlight = pending;
    return pending;
  }

  async _commitRecipeAction(session) {
    if (this.scene.currentSceneId !== 'S01') return { ok: false, code: 'sceneChanged' };
    const beforeCraft = this._story().s01Survival || {};
    if (session.recipeId === 's01.roastedWolfMeat') {
      const firstCook = beforeCraft.meatCooked !== true;
      const result = await this._submit(
        firstCook ? 'story.s01.cookMeat' : 'craft.s01.roastedWolfMeat',
        {},
        `${session.operationId}:cook`
      );
      if (result.ok !== true) return result;
      const campfire = this.scene._campfireService;
      if (campfire?.canAddFuelUnits?.(1) === true) campfire.addFuelUnits(1);
      campfire?.ignite?.({ runtime: { particleSystem: this.scene.particleSystem } });
      if (firstCook) await this._spawnWorkstation('S01-tanning-rack');
      this.scene._showScreenTip('烤狼肉完成，已放入背包。', { title: '烤制完成' });
      return { ...result, crafted: true };
    }

    const craftingVest = session.recipeId === 's01.wolfHideVest';
    const firstStoryCraft = craftingVest
      ? beforeCraft.wolfVestCrafted !== true
      : beforeCraft.wolfBracersCrafted !== true;
    const definitionId = craftingVest
      ? (firstStoryCraft ? 'story.s01.craftWolfVest' : 'craft.s01.wolfHideVest')
      : session.recipeId === 's01.wolfHideBracers'
        ? (firstStoryCraft ? 'story.s01.craftWolfBracers' : 'craft.s01.wolfHideBracers')
        : null;
    const result = definitionId
      ? await this._submit(definitionId, {}, `${session.operationId}:craft`)
      : { ok: false, code: 'recipeUnknown' };
    if (result.ok !== true) return result;

    const survival = this._story().s01Survival || {};
    let shelterConstructionUnlocked = false;
    if (firstStoryCraft
      && survival.wolfVestCrafted === true
      && survival.wolfBracersCrafted === true
      && survival.wolfGearCrafted !== true) {
      const aggregate = await this._submit(
        'story.s01.wolfGearCrafted',
        {},
        `${session.operationId}:story-wolf-gear-crafted`
      );
      if (aggregate.ok !== true) return { ...aggregate, crafted: true };
      shelterConstructionUnlocked = true;
    }
    this.scene._showScreenTip(shelterConstructionUnlocked
      ? `${craftingVest ? '狼皮背心' : '狼皮护腕'}制作完成，已放入背包。天气寒冷，需要建立一个庇护所，才能度过寒冷的夜晚。`
      : craftingVest
        ? '狼皮背心制作完成，已放入背包。'
        : '狼皮护腕制作完成，已放入背包。', {
      title: shelterConstructionUnlocked ? '寒夜将至' : '制作完成'
    });
    return { ...result, crafted: true };
  }

  _updateRecipeActionProgress(deltaTime) {
    const session = this.recipeActionProgress;
    if (!session || session.committing) return;
    const validationError = this._validateRecipeAction(session);
    if (validationError) {
      this.interruptRecipeAction(validationError);
      return;
    }
    session.elapsed = Math.min(session.duration, session.elapsed + Math.max(0, Number(deltaTime) || 0));
    const progress = session.duration > 0 ? session.elapsed / session.duration : 1;
    this._showRecipeActionProgress('progress', session, progress);
    this._showRecipeActionVisual('progress', session, progress);
    if (progress < 1) return;

    session.committing = true;
    void this._commitRecipeAction(session).then(result => {
      const crafted = result?.ok === true || result?.crafted === true;
      if (crafted) {
        this._showRecipeActionProgress('completed', session, 1);
        this._showRecipeActionVisual('completed', session, 1);
      } else {
        this._showRecipeActionProgress('interrupted', session);
        this._showRecipeActionVisual('interrupted', session);
        this.scene._showScreenTip(`制作结算失败：${result?.code || 'unknown'}。材料和剧情状态未改变。`, { title: '制作失败' });
      }
      if (this.recipeActionProgress === session) this.recipeActionProgress = null;
      session.resolve(result);
    }).catch(error => {
      this._showRecipeActionProgress('interrupted', session);
      this._showRecipeActionVisual('interrupted', session);
      if (this.recipeActionProgress === session) this.recipeActionProgress = null;
      session.resolve({ ok: false, code: 'recipeCommitFailed', error });
    });
  }

  async handleRecipeCommand(command = {}) {
    const view = this.scene.recipeSelectionView;
    if (!view?.visible) return { ok: false, code: 'recipeViewClosed' };
    if (command.type === 'close') {
      view.close();
      return { ok: true };
    }
    const workstationId = command.workstationId;
    const recipeId = command.recipeId;
    if (command.type !== 'selectRecipe' || !workstationId || !recipeId) {
      return { ok: false, code: 'recipeCommandInvalid' };
    }
    const recipe = this._createRecipeSnapshot(workstationId).recipes.find(entry => entry.id === recipeId);
    if (!recipe?.enabled) {
      this._refreshRecipeView(workstationId, { statusMessage: recipe?.disabledReason || '当前不能制作该物品。', statusType: 'error' });
      return { ok: true, status: 'blocked' };
    }
    const pending = this._startRecipeAction(workstationId, recipeId);
    const actionStarted = this.recipeActionInFlight === pending;
    const result = await pending;
    if (!actionStarted && result?.ok === false) {
      this.scene._showScreenTip(`无法开始制作：${result.code || 'unknown'}。`, { title: '制作未开始' });
    }
    return result;
  }

  async handleAction(params = {}, eventData = {}) {
    const operation = params.operation || params.type;
    if (operation === 'openCookingRecipes' || operation === 'cookMeat') {
      return this.openRecipeSelection('s01.cookingRack');
    }
    if (operation === 'openTanningRecipes' || operation === 'craftWolfGear') {
      return this.openRecipeSelection('s01.tanningRack');
    }
    if (operation === 'commitStoryWhenReady') {
      return this._commitStoryWhenReady(params, eventData);
    }
    if (operation === 'afterBerriesGathered') {
      await this.onBerriesGatheredCommitted();
      return { ok: true };
    }
    if (operation === 'afterInitialToolsPicked') {
      await this.onInitialToolsPickedCommitted();
      return { ok: true };
    }
    if (operation === 'afterWoodGathered') {
      this._presentWoodGatheredCommitted();
      return { ok: true };
    }
    if (operation === 'afterWolfSkinned') {
      this._presentWolfSkinnedCommitted();
      return { ok: true };
    }
    if (operation === 'ensureFirstWolf') {
      await this._ensureFirstWolfFromCommittedState();
      return { ok: true };
    }
    if (operation === 'recordChaseWolfKilled') {
      const entityId = String(eventData.entityId || '').trim();
      const sourceOperationId = eventData.operationId || eventData.eventId;
      if (!entityId.startsWith(CHASE_WOLF_PREFIX) || !sourceOperationId) {
        return { ok: false, code: 'chaseWolfEventInvalid' };
      }
      const result = await this._submit(
        'story.s01.chase.kill',
        {},
        `${sourceOperationId}:state:story.s01.chase.kill`
      );
      if (result.ok !== true) return result;
      await this._reconcileWolfPursuit();
      return { ok: true };
    }
    if (operation === 'reconcilePursuit') {
      await this._reconcileWolfPursuit();
      return true;
    }
    if (operation === 'presentEntry') {
      const survival = this._story().s01Survival || {};
      this._applyS01WeatherPhase(survival);
      if (survival.campfireLit === true) return true;
      const moved = this.scene._tutorialFlow?.isCompleted?.('s01.move') === true;
      const wakeDialogueId = 'dialogue.s01.wake';
      if (!moved && !this.scene.dialogueSystem?.hasCompleted?.(wakeDialogueId)) {
        if (this.scene.dialogueSystem?.isDialogueActive?.()) return true;
        if (this.scene.dialogueSystem?.startDialogue?.(wakeDialogueId, { sceneId: 'S01' })) return true;
      }
      this.scene._showScreenTip(moved
        ? '身体已经活动开了。四下看看，寻找能取暖的东西。'
        : '寒风吹过荒原，你被冻醒了。使用 {move} 起身活动。', {
        title: moved ? '寻找取暖处' : '寒风中醒来'
      });
      return true;
    }
    if (operation === 'ensureMovedAfterWake') {
      if (this.scene._tutorialFlow?.isCompleted?.('s01.move') === true) return true;
      this.scene._showScreenTip('寒风让四肢僵硬。先使用 {move} 活动身体。', {
        title: '先活动身体'
      });
      return false;
    }
    if (operation === 'campfireLit') {
      const result = await this._submit('story.s01.campfireLit', {}, 'story:s01:campfire-lit');
      if (result.ok !== true) return false;
      try {
        this.scene._campfireService?.ignite?.({ runtime: { particleSystem: this.scene.particleSystem } });
      } catch (error) {
        console.warn('[S01S02Coordinator] 篝火表现启动失败，业务状态已提交', error);
      }

      const toolState = await this._submit('story.s01.findAxe', {}, 'story:s01:find-axe');
      if (toolState.ok !== true) return false;
      this.initialToolRevealPending = true;
      try {
        await this._revealInitialToolKit();
      } catch (error) {
        console.warn('[S01S02Coordinator] 篝火工具包放置进入退避补偿', error);
      }
      return true;
    }
    if (operation === 'refuelCampfire') return this.refuelCampfire(eventData);
    if (operation === 'craftWolfGear') {
      const survival = this._story().s01Survival || {};
      if (survival.wolfGearCrafted === true) {
        this.scene._showScreenTip('狼皮背心和狼皮护腕已经制作完成。', { title: '制作已完成' });
        return { ok: true, status: 'blocked' };
      }
      if (survival.meatCooked !== true) {
        this.scene._showScreenTip('先回到篝火旁烤制狼肉，再处理剩余狼皮。', { title: '先烤狼肉' });
        return { ok: true, status: 'blocked' };
      }
      const inventory = this.scene.playerEntity?.getComponent?.('inventory');
      if (!inventory?.getItemCount) {
        this.scene._showScreenTip('背包系统尚未就绪，制作没有开始。', { title: '制作失败' });
        return { ok: false, code: 'inventoryUnavailable' };
      }
      const hideCount = inventory.getItemCount('resource.wolf_hide');
      if (hideCount < 2) {
        this.scene._showScreenTip(`制作狼皮背心和狼皮护腕需要狼皮 2 份，现有 ${hideCount}/2。`, { title: '材料不足' });
        return { ok: true, status: 'blocked' };
      }
      const result = await this._submit('story.s01.craftWolfGear', {}, 'story:s01:craft-wolf-gear');
      if (!result.ok) {
        this.scene._showScreenTip(`制作结算失败：${result.code || 'unknown'}。狼皮和剧情状态未改变，请重试。`, { title: '制作失败' });
        return result;
      }
      this.scene._showScreenTip('你将狼皮裁成背心和护腕。两件装备已经放入背包，可以在装备栏中穿戴；接下来搭建小庇护所。', {
        title: '狼皮装备完成'
      });
      return { ok: true };
    }
    if (operation === 'cookMeat') {
      const survival = this._story().s01Survival || {};
      if (survival.meatCooked === true) {
        this.scene._showScreenTip('狼肉已经烤熟，不需要重复消耗木材和生肉。', { title: '烹饪已完成' });
        return { ok: true, status: 'blocked' };
      }
      if (survival.wolfSkinned !== true) {
        this.scene._showScreenTip('先靠近第一只野狼的尸体，用剥皮刀取下狼皮。', { title: '先处理狼尸' });
        return { ok: true, status: 'blocked' };
      }
      const inventory = this.scene.playerEntity?.getComponent?.('inventory');
      if (!inventory?.getItemCount) {
        this.scene._showScreenTip('背包系统尚未就绪，烹饪没有开始。', { title: '烹饪失败' });
        return { ok: false, code: 'inventoryUnavailable' };
      }
      const meatCount = inventory.getItemCount('resource.raw_wolf_meat');
      const woodCount = inventory.getItemCount('resource.wood');
      const missing = [];
      if (meatCount < 1) missing.push(`生狼肉还缺 ${1 - meatCount} 份（现有 ${meatCount}/1）`);
      if (woodCount < 1) missing.push(`木材还缺 ${1 - woodCount} 份（现有 ${woodCount}/1）`);
      if (missing.length > 0) {
        this.scene._showScreenTip(`烤制狼肉需要生狼肉 1 份、木材 1 份；${missing.join('，')}。`, { title: '材料不足' });
        return { ok: true, status: 'blocked' };
      }
      const result = await this._submit('story.s01.cookMeat', {}, 'story:s01:cook-meat');
      if (!result.ok) {
        this.scene._showScreenTip(`烹饪结算失败：${result.code || 'unknown'}。材料和剧情状态未改变，请重试。`, { title: '烹饪失败' });
        return result;
      }
      const campfire = this.scene._campfireService;
      if (campfire?.canAddFuelUnits?.(1) === true) campfire.addFuelUnits(1);
      const ignited = campfire?.ignite?.({ runtime: { particleSystem: this.scene.particleSystem } });
      if (ignited !== true) {
        console.warn('[S01S02Coordinator] 烹饪事务已提交，但篝火重燃表现失败');
      }
      this.scene._showScreenTip('你添柴重新点旺篝火，狼肉已经烤熟。接下来到制作点把两份狼皮做成背心和护腕。', { title: '烤狼肉' });
      return { ok: true };
    }
    if (operation === 'buildShelter') return this.startShelterConstruction(params);
    if (operation === 'shelterCompleted') return this.handleConstructionEvent('constructionCompleted', eventData);
    if (operation === 'overnight') {
      const result = await this._submit('story.s01.overnight', {}, 'story:s01:overnight');
      if (!result.ok) return false;
      this.scene.timeSystem?.setCurrentDay?.(2);
      this._applyS01WeatherPhase(this._story().s01Survival || {}, { force: true });
      const reconciled = await this._reconcileWolfPursuit();
      if (!reconciled) {
        console.warn('[S01S02Coordinator] 过夜追杀事实已提交，追逐狼将在后续帧补偿');
      }
      return true;
    }
    if (operation === 'riverCrossed') {
      const result = await this._submit('story.s01.riverCrossed', {}, 'story:s01:river-crossed');
      if (result.ok) this.scene._showScreenTip('你踩着河中石块跳到对岸。顺着上坡道路跑向山崖。', { title: '越过河道' });
      return result.ok === true;
    }
    if (operation === 'cliffReached') {
      const result = await this._submit('story.s01.cliffReached', {}, 'story:s01:cliff-reached');
      return result.ok === true;
    }
    return false;
  }

  /** S01 藤蔓只有抵达山崖后才作为 baseline jump 攀爬面开放。 */
  filterClimbTarget(target) {
    if (target?.id !== 'S01-cliff-vine') return target;
    return this.scene.currentSceneId === 'S01' && this._story().s01Survival?.cliffReached === true
      ? target
      : null;
  }

  update(deltaTime) {
    if (this.scene.currentSceneId !== 'S01') {
      this.resolvedPlacementContinuations.clear();
      if (this.s01TimePhaseInitialized || this.s01WeatherPhaseInitialized || this.s01TimePauseOwned) {
        this._resetS01AtmosphereProjection();
      }
      const session = this.refuelCampfireProgress;
      if (session && !session.committing) {
        this._showRefuelProgress('interrupted', 0, session.actor);
        this.refuelCampfireProgress = null;
        session.resolve({ ok: false, code: 'refuelInterrupted' });
      }
      this.interruptRecipeAction('sceneChanged');
      if (this.shelterConstructionProgressActive) {
        this._showShelterConstructionProgress('interrupted');
        this.shelterConstructionProgressActive = false;
      }
      return;
    }
    const dt = Math.max(0, Number(deltaTime) || 0);
    this._updateRefuelProgress(dt);
    this._updateRecipeActionProgress(dt);
    const survival = this._story().s01Survival || {};
    this._applyS01WeatherPhase(survival);
    this._updateFirstWolfCorpseCommit(dt);
    if (survival.pursuit?.active === true) {
      this.pursuitReconcileElapsed += dt;
      if (this.pursuitReconcileElapsed >= PURSUIT_RECONCILE_INTERVAL_SECONDS
        && !this.pursuitReconcileInFlight) {
        this.pursuitReconcileElapsed = 0;
        void this._reconcileWolfPursuit();
      }
    } else {
      this.pursuitReconcileElapsed = 0;
    }
    const pickupNeedsRecovery = survival.campfireLit === true
      && survival.axeDropped === true
      && survival.initialToolsPicked !== true;
    if (pickupNeedsRecovery) this.initialToolRevealPending = true;
    if (this.initialToolRevealPending) {
      this.initialToolRevealRetryElapsed += dt;
      if (this.initialToolRevealRetryElapsed >= 0.75) {
        this.initialToolRevealRetryElapsed = 0;
        void this._revealInitialToolKit().catch(error => {
          console.warn('[S01S02Coordinator] 篝火工具包补偿失败', error);
        });
      }
    } else {
      this.initialToolRevealRetryElapsed = 0;
    }
    if (survival.firstWolfSpotted === true && survival.firstWolfKilled !== true) {
      const firstWolf = this.scene.entityStore?.getById?.('S01-first-wolf-1');
      if (firstWolf?.isCorpse === true) this._queueFirstWolfCorpseCommit(firstWolf);
      else if (firstWolf) this._activateFirstWolf(firstWolf);
      else if (!this.pendingWolfDiscovery && !this.pendingPlacementReveals.has('S01-first-wolf-1')) {
        void this._ensureFirstWolfFromCommittedState().catch(error => {
          console.warn('[S01S02Coordinator] 已提交首狼事实的表现恢复失败', error);
        });
      }
    }
    const gatherPlacementNeedsRecovery = survival.initialToolsPicked === true
      && survival.berriesGathered !== true;
    if (gatherPlacementNeedsRecovery) {
      if (!this.resolvedPlacementContinuations.has('S01-node-berry-1')
        && !this.pendingPlacementReveals.has('S01-node-berry-1')) {
        this._rememberPendingReveal(this._createCampfireContinuation());
      }
    } else {
      this.resolvedPlacementContinuations.delete('S01-node-berry-1');
    }
    const woodPlacementNeedsRecovery = survival.berriesGathered === true
      && survival.woodGathered !== true;
    if (woodPlacementNeedsRecovery) {
      if (!this.resolvedPlacementContinuations.has('S01-node-wood-1')
        && !this.pendingPlacementReveals.has('S01-node-wood-1')) {
        this._rememberPendingReveal(this._createWoodGatherContinuation());
      }
    } else {
      this.resolvedPlacementContinuations.delete('S01-node-wood-1');
    }
    if (this.pendingPlacementReveals.size > 0 && !this.pendingRevealRetryInFlight) {
      const pending = this.pendingPlacementReveals.values().next().value;
      const retryInterval = Math.min(5, 0.75 * (2 ** Math.min(3, pending?.attempts || 0)));
      this.pendingRevealRetryElapsed += dt;
      if (this.pendingRevealRetryElapsed >= retryInterval) {
        this.pendingRevealRetryElapsed = 0;
        void this._retryPendingPlacementReveal().catch(error => {
          console.warn('[S01S02Coordinator] 待发布物品发现补偿失败', error);
        });
      }
    } else if (this.pendingPlacementReveals.size === 0) {
      this.pendingRevealRetryElapsed = 0;
    }
    if (this.scene.constructionSystem && !this.scene._constructionCheckpointBusy) {
      const pending = this.scene.constructionSystem.getPending('site.s01.small_shelter');
      if (pending?.status === 'active') {
        if (!this.shelterConstructionProgressActive) {
          this.shelterConstructionProgressActive = true;
          this._showShelterConstructionProgress('started', pending);
        }
        this._showShelterConstructionProgress('progress', pending);
      } else if (this.shelterConstructionProgressActive) {
        this._showShelterConstructionProgress('interrupted');
        this.shelterConstructionProgressActive = false;
      }
      const willComplete = pending?.status === 'active'
        && pending.elapsed + dt >= pending.duration;
      if (willComplete) {
        this.pendingConstructionRollback = this.scene.s10ConstructionCoordinator?._captureConstructionRollback?.();
      }
      const terminal = this.scene.constructionSystem.update(dt);
      const shelterTerminal = terminal.find(result => (
        (result?.siteId || result?.structure?.siteId) === 'site.s01.small_shelter'
      ));
      if (shelterTerminal && this.shelterConstructionProgressActive) {
        this._showShelterConstructionProgress(shelterTerminal.ok === true ? 'completed' : 'interrupted');
        this.shelterConstructionProgressActive = false;
      }
    }
    this._updateControlledVineClimb();
  }

  _updateControlledVineClimb() {
    const player = this.scene.playerEntity;
    const locomotion = this.scene.locomotionSystem;
    const presentation = locomotion?.getClimbPresentation?.(player);
    if (presentation?.surfaceId !== 'S01-cliff-vine') {
      this.pendingClimb = false;
      this.climbCompletionInFlight = false;
      return;
    }
    this.pendingClimb = true;
    if (!presentation.isAtExit || this.climbCompletionInFlight) return;

    this.climbCompletionInFlight = true;
    void this.completeS01AndTravel().then(completed => {
      if (completed === true) locomotion?.finishControlledClimb?.(player);
      else this.scene._showScreenTip('离开荒原的旅行事务未完成，藤蔓状态保持不变，请稍后重试。', { title: '暂时无法离开' });
    }).catch(error => {
      console.warn('[S01S02Coordinator] 藤蔓出口旅行异常', error);
      this.scene._showScreenTip('离开荒原时发生异常，当前进度未推进。', { title: '暂时无法离开' });
    }).finally(() => {
      this.climbCompletionInFlight = false;
    });
  }

  async prepareSpecialFaint(params = {}) {
    return (await this._submit('story.s01.specialFaint.prepare', params)).ok === true;
  }

  async clearSpecialFaint() {
    return (await this._submit('story.s01.specialFaint.clear', {}, 'story:s01:special-faint-clear')).ok === true;
  }

  async completeS01AndTravel() {
    return (await this._submit('story.s01.complete', {}, 'story:s01:complete')).ok === true;
  }

  async acceptS02Summons() {
    return (await this._submit('story.s02.summons.accept')).ok === true;
  }

  async travelToS09() {
    return this._submit('story.s02.travel');
  }

  resolveRespawnPosition() {
    if (this.scene.currentSceneId !== 'S01' || !this.scene._campfireService?.isLit?.()) return null;
    const campfire = this.scene._campfireService.getPosition();
    return { x: campfire.x + 48, y: campfire.y + 64, label: '已点燃的火堆旁' };
  }

  allowsTutorialBasicAttack() {
    if (this.scene.currentSceneId !== 'S01') return false;
    const survival = this._story().s01Survival || {};
    return this.scene._tutorialFlow?.isCurrent?.('s01.attack') === true
      || (survival.firstWolfSpotted === true && survival.firstWolfKilled !== true)
      || survival.pursuit?.active === true;
  }
}

export default S01S02Coordinator;
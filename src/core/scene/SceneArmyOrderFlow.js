/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * SceneArmyOrderFlow - 武装单位战略指令场景装配流（模块 3 · 3B）
 *
 * 职责：
 * - 把场景里的军团实体（SquadMemberComponent）聚合成 ArmyOrderSystem 的 armyStates；
 * - 每帧把 deltaTime 交给 500ms 战略刻（system.tick），让指令自动执行；
 * - 注入场景执行器：march → ArmyCommandSystem.startMarch（复用既有行军循环）；
 *   transport → ConvoySystem.load + dispatch；camp → ArmyCommandSystem.startConstruction；
 *   defend → 把整军切到 garrison 姿态（复用姿态机接敌规则）；
 * - 入档：blackboard.armyStates（schema 见 ARMY_STATE_SCHEMA），读档时还原。
 *
 * 与 3A 的分工：随行小队（companion）有独立 HUD/领域系统，本流不接管；
 * companion 的实体农册仍由 SceneCompanionSquadFlow 维护。
 */
import { FramePhase } from './GameSceneRuntime.js';
import { COMPANION_ARMY_ID } from '../../systems/CompanionSquadSystem.js';

export class SceneArmyOrderFlow {
  /**
   * @param {Object} scene - 游戏场景
   * @param {Object} options
   * @param {Object} options.system - ArmyOrderSystem
   * @param {Object|null} [options.marchExecutor] - WorldMarchExecutor（无实体/有 route 的逻辑行军）
   * @param {Object|null} [options.encounterResolver] - EncounterResolver（4C）
   * @param {Object|null} [options.passTariffSystem] - PassTariffSystem（4C）
   * @param {Function|null} [options.applyBattleResult] - BattleResult → CityWarSystem 适配器
   * @param {Function} [options.now] - 挂钟（重入补算与入档时间戳）
   */
  constructor(scene, {
    system = null,
    marchExecutor = null,
    encounterResolver = null,
    passTariffSystem = null,
    applyBattleResult = null,
    now = null
  } = {}) {
    this.scene = scene;
    this.system = system;
    this.marchExecutor = marchExecutor || null;
    this.encounterResolver = encounterResolver || null;
    this.passTariffSystem = passTariffSystem || null;
    this.applyBattleResult = typeof applyBattleResult === 'function' ? applyBattleResult : null;
    this.now = typeof now === 'function' ? now : (() => Date.now());
    /** @type {Map<string, {armyId:string, point:{x:number,y:number}, done:boolean}>} 指令键 → 行军态 */
    this._marches = new Map();
    /** @type {Set<string>} 已下发姿态的指令键（防每帧重复 applyStanceToArmy） */
    this._appliedOrders = new Set();
    this._dirty = true;
    this._attached = false;
    this._restored = false;
    this._lastTickAt = null;
    this._tariffDay = null;
  }

  /** 系统就绪后调用一次：注入执行器、接管行军抵达回调、恢复入档、注册帧更新。 */
  attach() {
    if (this._attached) return this;
    this._attached = true;
    this._installExecutors();
    this._wireMarchComplete();
    this._installEncounterDetector();
    this._restoreFromBlackboard();
    this.scene.sceneRuntime?.onFramePhase?.(
      FramePhase.AFTER_SCENE,
      deltaTime => this.update(deltaTime),
      'armyOrder'
    );
    this.syncArmies();
    return this;
  }

  /** @param {number} deltaTime - 毫秒 */
  update(deltaTime = 0) {
    if (!this.system) return;
    this.syncArmies();
    this.system.tick(deltaTime);
    this._lastTickAt = this.now();
    this._applyOrderStances();
    this._processEncounters();
    this._settleTariffsIfNeeded();
    if (this._dirty) this._persist();
  }

  /**
   * 场景实体 → armyStates 聚合：按 squadMember.armyId 分组，
   * 位置取质心、roster 记录存活/阵亡实体 id（不覆盖既有指令与部署）。
   */
  syncArmies() {
    const scene = this.scene;
    const entities = scene.entityStore?.all || [];
    const groups = new Map();
    for (const entity of entities) {
      const member = entity?.getComponent?.('squadMember');
      if (!member?.armyId || member.armyId === COMPANION_ARMY_ID) continue;
      let group = groups.get(member.armyId);
      if (!group) {
        group = { x: 0, y: 0, samples: 0, alive: [], dead: [], factionId: null, sceneId: null };
        groups.set(member.armyId, group);
      }
      const position = entity.getComponent?.('transform')?.position;
      const x = Number(position?.x);
      const y = Number(position?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        group.x += x;
        group.y += y;
        group.samples += 1;
      }
      if (entity.isDead === true || entity.isDying === true) group.dead.push(entity.id);
      else group.alive.push(entity.id);
      if (group.factionId == null && entity.faction != null) group.factionId = String(entity.faction);
      if (group.sceneId == null && entity.sceneId != null) group.sceneId = String(entity.sceneId);
    }

    let changed = false;
    for (const [armyId, group] of groups) {
      const position = group.samples > 0
        ? { x: group.x / group.samples, y: group.y / group.samples }
        : null;
      const state = this.system.getUnit(armyId);
      if (!state) {
        const definition = scene.gameLoader?.getRegistry?.('armies')?.get?.(armyId) || null;
        const registered = this.system.registerUnit({
          id: armyId,
          kind: 'army',
          factionId: group.factionId,
          sceneId: group.sceneId || scene.currentSceneId || scene.sceneId || null,
          position: position || { x: 0, y: 0 },
          roster: { unitIds: group.alive, dead: group.dead },
          commanderHeroId: definition?.commander?.heroId || null,
          formationId: definition?.defaultFormationId || null
        });
        if (registered.ok) changed = true;
        continue;
      }
      // 位置权威（spec §4.4）：行军执行中且 route 有效 → 逻辑层/执行器独占写 position；
      // 实体质心只更新 roster。samples===0 时保留原值，不再写 {0,0}（防行军被拉回原点）。
      if (!this._isRouteAuthoritative(state) && position) state.position = position;
      state.roster = { ...(state.roster || {}), unitIds: group.alive, dead: group.dead };
    }
    if (changed) this._dirty = true;
  }

  /** 行军执行中 + route 有效 → 位置与进度由执行器权威（表现层不得覆盖）。 */
  _isRouteAuthoritative(state) {
    return state?.order?.state === 'executing'
      && Array.isArray(state.route?.nodeIds)
      && state.route.nodeIds.length >= 2;
  }

  /** 标记待入档（命令层改动后调用；下一帧写 blackboard.armyStates）。 */
  requestPersist() {
    this._dirty = true;
  }

  // ─── 执行器 ──────────────────────────────────────────────

  _installExecutors() {
    if (!this.system) return;
    this.system.executors = {
      ...this.system.executors,
      march: context => this._executeMarch(context),
      defend: () => ({ status: 'executing', progress: 1 }),
      transport: context => this._executeTransport(context),
      camp: context => this._executeCamp(context)
    };
  }

  /**
   * 行军执行器：有实体 → 委托 ArmyCommandSystem.startMarch（既有行军循环，
   * 抵达经 onMarchComplete 回填）；无实体（大地图/离场军团）→ 领域纯数据位移。
   */
  _executeMarch({ state, order, stepMs }) {
    const hasRoute = this._isRouteAuthoritative(state);
    const point = this.system.resolveOrderPoint(order.target);
    // 有逻辑路线时目标点可缺省（终点由 route 末端节点给出）；无路线才要求可解析坐标。
    if (!point && !hasRoute) return { status: 'failed', code: 'targetUnresolved' };
    const armySystem = this._armySystem();
    const units = this._armyEntities(state.id);

    // 表现层：在场实体照旧走 ArmyCommandSystem 行军（仅启动一次；抵达回调只清视觉态）。
    // 有 route 时即使启动失败也不终止指令——逻辑行军的权威在 WorldMarchExecutor。
    if (point && units.length > 0 && armySystem?.startMarch) {
      const key = `${state.id}:${order.issuedAt}`;
      if (!this._marches.has(key)) {
        const started = armySystem.startMarch({ armyId: state.id, waypoints: [point] });
        if (started?.ok === true) this._marches.set(key, { armyId: state.id, point, done: false });
        else if (!hasRoute) return { status: 'failed', code: started?.code || 'marchUnavailable' };
      }
    }

    // 逻辑层：有 route → 执行器权威推进（syncArmies 不再用实体质心覆盖 position）。
    if (hasRoute && this.marchExecutor) {
      return this.marchExecutor.execute({ state, order, stepMs });
    }

    if (units.length === 0 || !armySystem?.startMarch) {
      return this.system.advanceMarch({ state, order, stepMs });
    }

    const key = `${state.id}:${order.issuedAt}`;
    const march = this._marches.get(key);
    if (march?.done) {
      this._marches.delete(key);
      return { status: 'completed', position: point, progress: 1 };
    }
    return { status: 'executing', progress: 0 };
  }

  /** 运输执行器：押运队装车 → 出发（载具生成/落点校验已在 ConvoySystem 内闭合）。 */
  _executeTransport({ state, order }) {
    const convoySystem = this.scene.convoySystem;
    if (!convoySystem) return { status: 'failed', code: 'transportUnavailable' };
    const target = order.target && typeof order.target === 'object' ? order.target : {};
    const convoyId = target.convoyId || target.id || null;
    if (!convoyId) return { status: 'failed', code: 'transportTargetRequired' };
    const operationBase = `${state.id}:${order.issuedAt}`;
    const loaded = convoySystem.load({
      convoyId,
      orderId: target.orderId || null,
      operationId: `${operationBase}:load`
    });
    if (loaded?.ok !== true) return { status: 'failed', code: loaded?.code || 'loadFailed' };
    const dispatched = convoySystem.dispatch({
      convoyId,
      operationId: `${operationBase}:dispatch`
    });
    if (dispatched?.ok !== true) return { status: 'failed', code: dispatched?.code || 'dispatchFailed' };
    return { status: 'completed', progress: 1 };
  }

  /** 扎营执行器：委托既有建造命令（建造完成/扎营 buff 由 construction 链另行结算）。 */
  _executeCamp({ state, order }) {
    const armySystem = this._armySystem();
    if (!armySystem?.startConstruction) return { status: 'failed', code: 'campUnavailable' };
    const point = this.system.resolveOrderPoint(order.target) || { ...state.position };
    const started = armySystem.startConstruction('camp', point, this._armyEntities(state.id));
    if (started?.ok !== true) return { status: 'failed', code: started?.code || 'campUnavailable' };
    return { status: 'completed', progress: 1 };
  }

  /** 指令首次推进时下发对应姿态：defend→garrison、camp→hold、transport→escort。 */
  _applyOrderStances() {
    const armySystem = this._armySystem();
    if (!armySystem?.applyStanceToArmy) return;
    for (const state of this.system.listUnits()) {
      const order = state.order;
      if (!order) continue;
      const key = `${state.id}:${order.issuedAt}:${order.type}`;
      if (this._appliedOrders.has(key)) continue;
      this._appliedOrders.add(key);
      if (order.type === 'defend') armySystem.applyStanceToArmy(state.id, 'garrison');
      else if (order.type === 'camp') armySystem.applyStanceToArmy(state.id, 'hold');
      else if (order.type === 'transport') armySystem.applyStanceToArmy(state.id, 'escort');
      this._dirty = true;
    }
  }

  // ─── 接线与入档 ───────────────────────────────────────────

  _wireMarchComplete() {
    const armySystem = this._armySystem();
    if (!armySystem) return;
    const previous = armySystem.onMarchComplete;
    armySystem.onMarchComplete = payload => {
      const armyId = payload?.armyId;
      for (const march of this._marches.values()) {
        if (armyId && march.armyId !== armyId) continue;
        march.done = true;
      }
      if (typeof previous === 'function') previous(payload);
    };
  }

  _armySystem() {
    return this.scene.armyCommandFlow?.system || null;
  }

  _armyEntities(armyId) {
    const entities = this.scene.entityStore?.all || [];
    return entities.filter(entity => {
      const member = entity?.getComponent?.('squadMember');
      if (!member || member.armyId !== armyId) return false;
      return entity.isDead !== true && entity.isDying !== true;
    });
  }

  // ─── 遭遇四选（4C）───────────────────────────────────────

  _installEncounterDetector() {
    if (!this.system || !this.encounterResolver) return;
    this.system.encounterDetector = (state, order) => this._detectEncounter(state, order);
  }

  _detectEncounter(state, order) {
    const layer = this._routeLayer();
    if (!layer) return null;
    return this.encounterResolver.detect({
      state,
      order,
      layer,
      units: this.system.listUnits(),
      day: this._day()
    });
  }

  /** 当前待决遭遇（最早创建的一条；供大地图确认框读取）。 */
  getPendingEncounter() {
    const pending = this._pendingEncounters();
    if (pending.length === 0) return null;
    const state = pending[0].state;
    const encounter = pending[0].encounter;
    const expiresAt = Number(encounter.expiresAt) || 0;
    return {
      ...encounter,
      unitId: state.id,
      expiresAt,
      remainingMs: expiresAt > 0 ? Math.max(0, expiresAt - this.now()) : 0,
      available: encounter.available || { ambush: false, detour: false, fight: true, retreat: true }
    };
  }

  /**
   * 四选确认（幂等）：选完才结算；写 armyStates 的唯一入口。
   * @param {Object} input - { unitId, encounterId?, choice, reason? }
   */
  decideEncounter({ unitId = null, encounterId = null, choice = 'fight', reason = 'player' } = {}) {
    if (!this.encounterResolver) return { ok: false, code: 'encounterUnavailable' };
    const state = this.system?.getUnit?.(unitId);
    if (!state?.order?.pendingEncounter) return { ok: false, code: 'noPendingEncounter' };
    const encounter = state.order.pendingEncounter;
    if (encounterId && String(encounterId) !== String(encounter.id)) {
      return { ok: false, code: 'staleEncounter' };
    }
    const outcome = this.encounterResolver.resolve({
      encounter,
      choice,
      layer: this._routeLayer(),
      state,
      units: this.system.listUnits(),
      day: this._day()
    });
    if (!outcome.ok) return outcome;
    this._applyEncounterOutcome(state, encounter, { ...outcome, reason });
    return { ok: true, choice, outcome };
  }

  _applyEncounterOutcome(state, encounter, outcome) {
    const order = state?.order;
    if (!order) return;
    order.pendingEncounter = null;
    order.encounterResolvedAt = this.now();

    if (Number.isFinite(Number(outcome.moraleDelta)) && Number(outcome.moraleDelta) !== 0) {
      state.morale = Math.min(100, Math.max(0, Number(state.morale ?? 0) + Number(outcome.moraleDelta)));
    }
    // 冷却：撤退/战败按配置；其余选择给 2 刻防重复弹窗（同一节点/边结算后不立刻再触发）
    const cooldown = outcome.cooldown || (outcome.choice === 'detour'
      ? null
      : { edgeId: encounter.edgeId, nodeId: encounter.nodeId, remainingTicks: 2 });
    if (cooldown && (cooldown.edgeId || cooldown.nodeId)) {
      state.encounterCooldown = {
        edgeId: cooldown.edgeId ? String(cooldown.edgeId) : null,
        nodeId: cooldown.nodeId ? String(cooldown.nodeId) : null,
        remainingTicks: Math.max(1, Math.floor(Number(cooldown.remainingTicks) || 1))
      };
    }
    if (outcome.battle) {
      this._applyCasualties(state, outcome.battle.casualties?.attacker);
      if (encounter.defenderUnitId) {
        const defender = this.system.getUnit(encounter.defenderUnitId);
        if (defender) this._applyCasualties(defender, outcome.battle.casualties?.defender);
      }
    }
    if (outcome.routeRequest) {
      this._applyRouteRequest(state, outcome.routeRequest);
    }
    if (outcome.captured) {
      this._applyCapture(state, encounter, outcome.captured);
    }
    if (outcome.battleResult && this.applyBattleResult) {
      try {
        this.applyBattleResult(outcome.battleResult);
      } catch (error) {
        this._emit('unit.battleResultFailed', {
          unitId: state.id,
          message: error?.message || String(error)
        });
      }
    }
    this._emit('unit.encounterResolved', {
      unitId: state.id,
      encounter: {
        id: encounter.id,
        kind: encounter.kind,
        nodeId: encounter.nodeId,
        edgeId: encounter.edgeId,
        defenderUnitId: encounter.defenderUnitId
      },
      choice: outcome.choice,
      reason: outcome.reason || 'player',
      battle: outcome.battle ? { ...outcome.battle } : null,
      strategicTicksSpent: outcome.strategicTicksSpent
    });
    this.requestPersist();
  }

  _applyCasualties(state, rawCount) {
    const count = Math.max(0, Math.floor(Number(rawCount) || 0));
    if (count === 0) return;
    const roster = state.roster && typeof state.roster === 'object' ? state.roster : {};
    if (Array.isArray(roster.unitIds)) {
      const removed = roster.unitIds.slice(Math.max(0, roster.unitIds.length - count));
      state.roster = {
        ...roster,
        unitIds: roster.unitIds.slice(0, Math.max(0, roster.unitIds.length - count)),
        dead: [...(Array.isArray(roster.dead) ? roster.dead : []), ...removed]
      };
      return;
    }
    if (Number(roster.count) > 0) {
      state.roster = { ...roster, count: Math.max(0, Number(roster.count) - count) };
    }
  }

  /** 路线请求落地：绕道 → 换 route 继续；撤退/战败 → 清 route 改令回退节点。 */
  _applyRouteRequest(state, request) {
    if (!request || typeof request !== 'object') return;
    const nodeIds = Array.isArray(request.nodeIds) ? request.nodeIds : [];
    if (nodeIds.length >= 2) {
      const route = this._buildRoute(request);
      state.route = route;
      state.order = {
        ...state.order,
        type: request.retreatTo ? 'move' : state.order.type,
        target: request.retreatTo ? { nodeId: request.retreatTo } : state.order.target,
        state: 'executing',
        progress: 0,
        totalDistance: route.totalDistance,
        issuedAt: this.now()
      };
      return;
    }
    if (request.retreatTo) {
      state.route = null;
      state.order = {
        ...state.order,
        type: 'move',
        target: { nodeId: request.retreatTo },
        state: 'executing',
        progress: 0,
        totalDistance: null,
        issuedAt: this.now()
      };
    }
  }

  _buildRoute(planned) {
    const layer = this._routeLayer();
    const nodeIds = (planned.nodeIds || []).map(String);
    const edgeIds = (planned.edgeIds || []).map(String);
    let totalDistance = 0;
    for (let index = 1; index < nodeIds.length; index += 1) {
      const from = layer?.getNode?.(nodeIds[index - 1])?.position;
      const to = layer?.getNode?.(nodeIds[index])?.position;
      if (!from || !to) continue;
      totalDistance += Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y));
    }
    return {
      nodeIds,
      edgeIds,
      points: [],
      index: 1,
      totalDistance: totalDistance > 0 ? totalDistance : null,
      travelled: 0,
      progress: 0,
      revision: layer?.getSnapshot?.().revision ?? null,
      status: 'marching',
      blockedReason: null
    };
  }

  _applyCapture(state, encounter, captured) {
    const layer = this._routeLayer();
    const nodeId = captured.nodeId || encounter.nodeId;
    if (!nodeId) return;
    if (captured.kind === 'pass') {
      const pass = this.system.getUnit(nodeId);
      if (pass) pass.factionId = state.factionId;
      else {
        this.system.registerUnit({
          id: nodeId,
          kind: 'pass',
          factionId: state.factionId,
          position: layer?.getNode?.(nodeId)?.position || { x: 0, y: 0 }
        });
      }
      layer?.invalidate?.('passCaptured');
      this._emit('pass.captured', {
        passId: nodeId,
        nodeId,
        factionId: state.factionId,
        byUnitId: state.id
      });
      return;
    }
    this._emit('city.captured', {
      cityId: captured.cityId,
      nodeId,
      factionId: state.factionId,
      byUnitId: state.id
    });
  }

  _pendingEncounters() {
    const pending = [];
    for (const state of this.system?.listUnits?.() || []) {
      const encounter = state?.order?.pendingEncounter;
      if (!encounter) continue;
      pending.push({ state, encounter });
    }
    pending.sort((left, right) => (
      Number(left.encounter.createdAt || 0) - Number(right.encounter.createdAt || 0)
    ));
    return pending;
  }

  /** 每帧：超时转撤退；玩家不可见按 autoPolicy 抽象结算；可见则交给大地图确认框。 */
  _processEncounters() {
    if (!this.encounterResolver) return;
    const now = this.now();
    for (const entry of this._pendingEncounters()) {
      const expiresAt = Number(entry.encounter.expiresAt) || 0;
      if (expiresAt > 0 && now >= expiresAt) {
        this.decideEncounter({
          unitId: entry.state.id,
          encounterId: entry.encounter.id,
          choice: 'retreat',
          reason: 'timeout'
        });
      }
    }
    const remaining = this._pendingEncounters();
    if (remaining.length === 0) return;
    const head = remaining[0];
    if (!this._isEncounterVisible(head.state)) {
      const policy = this._autoPolicy();
      for (const entry of remaining) {
        this.decideEncounter({
          unitId: entry.state.id,
          encounterId: entry.encounter.id,
          choice: this._autoChoice(entry.encounter, policy),
          reason: 'autoPolicy'
        });
      }
      return;
    }
    const panel = this.scene.worldMapPanel;
    if (panel?.open && panel.visible !== true) panel.open();
  }

  _autoPolicy() {
    const policy = this.encounterResolver?.combat?.autoPolicy;
    return ['ambush', 'detour', 'fight', 'retreat'].includes(policy) ? policy : 'fight';
  }

  /** autoPolicy 命中不可用选项时退回「战斗」（fight 恒可用）。 */
  _autoChoice(encounter, policy) {
    if (policy && encounter?.available?.[policy] !== false) return policy;
    return 'fight';
  }

  _isEncounterVisible(state) {
    const panel = this.scene.worldMapPanel;
    if (panel?.visible === true) return true;
    const currentSceneId = this.scene.currentSceneId || this.scene.sceneId || null;
    if (!currentSceneId) return false;
    return state?.sceneId != null && String(state.sceneId) === String(currentSceneId);
  }

  // ─── 关隘关税（4C）───────────────────────────────────────

  /** WorldMarchExecutor 进入节点回调：关隘经过即计税（当日累计）。 */
  handleEnterNode({ state = null, nodeId = null, node = null } = {}) {
    if (!this.passTariffSystem || !state || !node) return null;
    if (node.kind !== 'pass') return null;
    const owner = this._routeLayer()?.getOwner?.(nodeId) ?? node.ownerFactionId ?? null;
    const result = this.passTariffSystem.collect({
      passId: nodeId,
      moverFactionId: state.factionId,
      ownerFactionId: owner,
      cargoValue: state.supply?.cargoValue,
      rate: node.tollRate,
      day: this._day()
    });
    if (result.ok && !result.exempt && result.tax > 0) this.requestPersist();
    return result;
  }

  /** 跨日：关隘累计税 → 归属方最近城池（唯一写城点，与城池常规税收分离）。 */
  _settleTariffsIfNeeded() {
    if (!this.passTariffSystem) return;
    const day = this._day();
    if (this._tariffDay == null) {
      this._tariffDay = day;
      return;
    }
    if (day <= this._tariffDay) return;
    this._tariffDay = day;
    const result = this.passTariffSystem.settle({ day });
    if (!result.ok || result.transfers.length === 0) return;
    this._applyTariffTransfers(result.transfers);
  }

  _applyTariffTransfers(transfers) {
    const board = this._blackboard();
    const cities = board?.get?.('cityStates');
    if (!Array.isArray(cities)) return;
    const draft = cities.map(city => ({
      ...city,
      resources: { ...(city?.resources || {}) }
    }));
    let changed = false;
    for (const transfer of transfers) {
      const city = draft.find(entry => entry && String(entry.id) === String(transfer.cityId));
      if (!city) continue;
      const current = Number(city.resources[transfer.resource]) || 0;
      city.resources[transfer.resource] = current + Math.max(0, Number(transfer.amount) || 0);
      changed = true;
    }
    if (changed) board.set('cityStates', draft);
  }

  _day() {
    if (typeof this.system?.getDay === 'function') return Number(this.system.getDay()) || 1;
    return 1;
  }

  _routeLayer() {
    return this.scene.worldRouteLayer || null;
  }

  _emit(event, payload) {
    if (typeof this.system?._emit === 'function') this.system._emit(event, payload);
  }

  _blackboard() {
    return this.scene.gameLoader?.blackboard || null;
  }

  _restoreFromBlackboard() {
    if (this._restored) return;
    this._restored = true;
    const board = this._blackboard();
    const armyStates = board?.get?.('armyStates');
    if (!armyStates || typeof armyStates !== 'object') return;
    const units = Object.entries(armyStates)
      .filter(([, state]) => state && typeof state === 'object')
      .map(([id, state]) => ({ id, ...state }));
    if (units.length === 0) return;
    const restored = this.system.restore({ schemaVersion: 1, units, deployLocks: [] });
    if (!restored.ok) return;
    this._dirty = false;
    // 重入补算（D1）：按上次入档时间补战略刻，单次 ≤20 刻（tick 内建上限），
    // 切场景回来行军继续推进而不是静止；旧档无 meta 则跳过。
    const meta = board?.get?.('armyStatesMeta');
    const lastTickAt = Number(meta?.lastTickAt);
    const now = this.now();
    if (Number.isFinite(lastTickAt) && lastTickAt > 0 && now > lastTickAt) {
      const elapsed = Math.min(now - lastTickAt, this.system.config.tickMs * 20);
      if (elapsed > 0) {
        this._catchUpSteps = this.system.tick(elapsed).steps;
      }
    }
    this._lastTickAt = now;
  }

  _persist() {
    this._dirty = false;
    const board = this._blackboard();
    if (!board?.get || !board?.set) return;
    const snapshot = this.system.serialize();
    const armyStates = {};
    for (const unit of snapshot.units) armyStates[unit.id] = unit;
    board.set('armyStates', armyStates);
    board.set('armyStatesMeta', {
      lastTickAt: Number.isFinite(this._lastTickAt) ? this._lastTickAt : this.now(),
      schemaVersion: snapshot.schemaVersion
    });
  }
}

export default SceneArmyOrderFlow;

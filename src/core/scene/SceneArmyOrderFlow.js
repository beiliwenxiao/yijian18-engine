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
   */
  constructor(scene, { system = null } = {}) {
    this.scene = scene;
    this.system = system;
    /** @type {Map<string, {armyId:string, point:{x:number,y:number}, done:boolean}>} 指令键 → 行军态 */
    this._marches = new Map();
    /** @type {Set<string>} 已下发姿态的指令键（防每帧重复 applyStanceToArmy） */
    this._appliedOrders = new Set();
    this._dirty = true;
    this._attached = false;
    this._restored = false;
  }

  /** 系统就绪后调用一次：注入执行器、接管行军抵达回调、恢复入档、注册帧更新。 */
  attach() {
    if (this._attached) return this;
    this._attached = true;
    this._installExecutors();
    this._wireMarchComplete();
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
    this._applyOrderStances();
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
        : { x: 0, y: 0 };
      const state = this.system.getUnit(armyId);
      if (!state) {
        const definition = scene.gameLoader?.getRegistry?.('armies')?.get?.(armyId) || null;
        const registered = this.system.registerUnit({
          id: armyId,
          kind: 'army',
          factionId: group.factionId,
          sceneId: group.sceneId || scene.currentSceneId || scene.sceneId || null,
          position,
          roster: { unitIds: group.alive, dead: group.dead },
          commanderHeroId: definition?.commander?.heroId || null,
          formationId: definition?.defaultFormationId || null
        });
        if (registered.ok) changed = true;
        continue;
      }
      state.position = position;
      state.roster = { ...(state.roster || {}), unitIds: group.alive, dead: group.dead };
    }
    if (changed) this._dirty = true;
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
    const point = this.system.resolveOrderPoint(order.target);
    if (!point) return { status: 'failed', code: 'targetUnresolved' };
    const armySystem = this._armySystem();
    const units = this._armyEntities(state.id);
    if (!armySystem?.startMarch || units.length === 0) {
      return this.system.advanceMarch({ state, order, stepMs });
    }
    const key = `${state.id}:${order.issuedAt}`;
    let march = this._marches.get(key);
    if (!march) {
      const started = armySystem.startMarch({ armyId: state.id, waypoints: [point] });
      if (started?.ok !== true) {
        return { status: 'failed', code: started?.code || 'marchUnavailable' };
      }
      march = { armyId: state.id, point, done: false };
      this._marches.set(key, march);
      return { status: 'executing', progress: 0 };
    }
    if (march.done) {
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
    if (restored.ok) this._dirty = false;
  }

  _persist() {
    this._dirty = false;
    const board = this._blackboard();
    if (!board?.get || !board?.set) return;
    const snapshot = this.system.serialize();
    const armyStates = {};
    for (const unit of snapshot.units) armyStates[unit.id] = unit;
    board.set('armyStates', armyStates);
  }
}

export default SceneArmyOrderFlow;

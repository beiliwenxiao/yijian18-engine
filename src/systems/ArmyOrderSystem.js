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
 * ArmyOrderSystem - 武装单位战略指令系统（模块 3 · 3B）
 *
 * 设计依据：.trae/specs/military-supply-strategy/m3-implementation/spec.md §3/§5/§10
 *
 * 领域边界（不依赖 Blackboard / 场景实体，全部经注入适配器）：
 * 1. armyStates：四 kind（army 军团 / city 城池 / pass 关隘 / camp 营寨）的纯数据运行态，
 *    字段对齐 spec §3 表（roster / deployment / order / morale / supply）。
 * 2. 五指令：attack（进攻）/ defend（防守）/ transport（运输）/ move（移动）/ camp（扎营），
 *    指令定义查 game.project.json 的 armyOrders.orders 表；另有战术撤军 retreat（士气代价）。
 * 3. 战略刻：500ms（config.tickMs）按 deltaMs 累积推进，不复用帧循环语义；
 *    每刻交给执行器（executors）推进，执行器返回 executing / completed / failed。
 * 4. 战前部署：army.deploy.commit 提交默认值（非战斗可改）、army.deploy.temp 本场临时覆盖、
 *    battle.deploy.lock 接战锁——锁后部署类改动一律 DEPLOYMENT_LOCKED。
 * 5. 将令（battleOrder）：只写 battleOrder，不写 order（战略指令跨场持续）；身份门控见
 *    `_resolveBattleIdentity`（当前按 BattleMode 推断，M6 支持 support 身份）。
 */

import { BattleMode } from './BattleSystem.js';

/** armyStates 的单位类别（spec §3）。 */
export const ARMY_UNIT_KINDS = Object.freeze(['army', 'city', 'pass', 'camp']);

/** 五条战略指令（顺序即 UI 指令环顺序）。 */
export const ARMY_ORDER_TYPES = Object.freeze(['attack', 'defend', 'transport', 'move', 'camp']);

/** 军团级战术撤军（非五指令；下达即扣 config.tacticalRetreatMorale 士气）。 */
export const ARMY_TACTICAL_RETREAT = 'retreat';

/** 将令种类。 */
export const ARMY_BATTLE_ORDER_KINDS = Object.freeze(['stance', 'focus', 'retreat']);

/** 将令可切换的姿态集合（军团姿态表子集）。 */
export const ARMY_BATTLE_ORDER_STANCES = Object.freeze([
  'escort', 'assault', 'hold', 'advance', 'charge', 'retreat', 'garrison'
]);

/**
 * 可将令的战斗身份集合。
 * TODO(M6)：落地 support（支援）身份时，把 `'support'` 追加进本集合，
 * 并在 `_resolveBattleIdentity` 增加 `BattleMode.SUPPORT → 'support'` 映射。
 */
export const ARMY_BATTLE_ORDERS = Object.freeze(['takeover']);

/** 部署锁定拒绝码（跨命令统一）。 */
export const DEPLOYMENT_LOCKED = 'DEPLOYMENT_LOCKED';

/** 部署三件套的主将/副将可选槽位。 */
export const DEPLOYMENT_SLOTS = Object.freeze(['front', 'mid', 'rear']);

/** armyOrders 缺省表（game.project.json 未配置时兜底，与内容表同构）。 */
export const DEFAULT_ARMY_ORDER_CONFIG = Object.freeze({
  tickMs: 500,
  tacticalRetreatMorale: 3,
  marchSpeed: 120,
  arrivalRadius: 24,
  orders: Object.freeze([
    Object.freeze({ key: 'attack', label: '进攻', executor: 'march', requiresTarget: true, persistent: false }),
    Object.freeze({ key: 'defend', label: '防守', executor: 'defend', requiresTarget: false, persistent: true }),
    Object.freeze({ key: 'transport', label: '运输', executor: 'transport', requiresTarget: true, persistent: false }),
    Object.freeze({ key: 'move', label: '移动', executor: 'march', requiresTarget: true, persistent: false }),
    Object.freeze({ key: 'camp', label: '扎营', executor: 'camp', requiresTarget: false, persistent: false })
  ])
});

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function normalizePoint(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function clampMorale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function normalizeRoster(roster) {
  if (!roster || typeof roster !== 'object' || Array.isArray(roster)) return {};
  const next = {};
  for (const [key, value] of Object.entries(roster)) {
    if (Array.isArray(value)) next[key] = value.map(entry => String(entry));
    else next[key] = Number.isFinite(Number(value)) ? Number(value) : value;
  }
  return next;
}

/**
 * 战略指令系统。
 */
export class ArmyOrderSystem {
  /**
   * @param {Object} [config]
   * @param {Object} [config.armyOrders] - game.project.json 的 armyOrders 表
   * @param {Function} [config.now] - 挂钟（毫秒）
   * @param {Function} [config.getDay] - 当前游戏日（缺省 1）
   * @param {Object|null} [config.battleAgent] - { getActiveBattleId(), getBattleState(battleId) }
   * @param {Function|null} [config.formationExists] - formationId => boolean（阵法校验）
   * @param {Function|null} [config.resolveTargetPoint] - target => {x,y}|null（目标引用解析）
   * @param {Object} [config.executors] - { march, defend, transport, camp } 执行器覆盖
   * @param {Function|null} [config.encounterDetector] - (state, order) => encounter|null
   * @param {Function|null} [config.onEvent] - (event, payload) => void
   */
  constructor({
    armyOrders = null,
    now = null,
    getDay = null,
    battleAgent = null,
    formationExists = null,
    resolveTargetPoint = null,
    executors = null,
    encounterDetector = null,
    onEvent = null
  } = {}) {
    this.config = this._mergeConfig(armyOrders || {});
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this.getDay = typeof getDay === 'function' ? getDay : (() => 1);
    this.battleAgent = battleAgent || null;
    this.formationExists = typeof formationExists === 'function' ? formationExists : null;
    this.resolveTargetPoint = typeof resolveTargetPoint === 'function' ? resolveTargetPoint : null;
    this.encounterDetector = typeof encounterDetector === 'function' ? encounterDetector : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;

    /** @type {Map<string, Object>} armyId → 运行态（spec §3 表） */
    this.states = new Map();
    /** @type {Map<string, {unitIds:Set<string>, lockedAt:number}>} battleId → 部署锁 */
    this.deployLocks = new Map();
    /** @type {Map<string, {fingerprint:string, result:Object}>} operationId 幂等账 */
    this._operations = new Map();
    /** @type {Map<string, Object>} 指令定义键 → 定义 */
    this._orderDefs = new Map(this.config.orders.map(definition => [definition.key, definition]));
    /** 执行器（缺省 march/defend；transport/camp 由场景装配注入） */
    this.executors = {
      march: context => this._defaultMarch(context),
      defend: () => ({ status: 'executing', progress: 1 }),
      ...(executors && typeof executors === 'object' ? executors : {})
    };
    this._accumulator = 0;
  }

  // ─── 配置 ────────────────────────────────────────────────

  _mergeConfig(raw) {
    const orders = Array.isArray(raw.orders) && raw.orders.length > 0
      ? raw.orders
        .filter(entry => entry && entry.key)
        .map(entry => ({
          key: String(entry.key),
          label: entry.label ? String(entry.label) : String(entry.key),
          executor: entry.executor ? String(entry.executor) : 'march',
          requiresTarget: entry.requiresTarget !== false,
          persistent: entry.persistent === true
        }))
      : DEFAULT_ARMY_ORDER_CONFIG.orders.map(entry => ({ ...entry }));
    return {
      tickMs: Math.max(100, Math.floor(Number(raw.tickMs) || DEFAULT_ARMY_ORDER_CONFIG.tickMs)),
      tacticalRetreatMorale: Math.max(0, raw.tacticalRetreatMorale != null
        ? Number(raw.tacticalRetreatMorale)
        : DEFAULT_ARMY_ORDER_CONFIG.tacticalRetreatMorale),
      marchSpeed: Math.max(1, Number(raw.marchSpeed) || DEFAULT_ARMY_ORDER_CONFIG.marchSpeed),
      arrivalRadius: Math.max(1, Number(raw.arrivalRadius) || DEFAULT_ARMY_ORDER_CONFIG.arrivalRadius),
      orders
    };
  }

  getOrderDefinitions() {
    return this.config.orders.map(entry => ({ ...entry }));
  }

  // ─── armyStates 生命周期（army.form / army.disband）────────

  /**
   * 注册/覆盖一个武装单位（army.form）。已是存量时只补齐缺省字段，不清运行态。
   * @param {Object} input - { id|armyId, kind, factionId, sceneId, position, roster, ... }
   * @returns {{ok:boolean, code?:string, state?:Object}}
   */
  registerUnit(input = {}) {
    const id = String(input.id || input.armyId || input.unitId || '');
    if (!id) return { ok: false, code: 'unitIdRequired' };
    const existing = this.states.get(id);
    if (existing) {
      this._mergeUnitInput(existing, input);
      return { ok: true, state: existing, created: false };
    }
    const state = this._createState(id, input);
    this.states.set(id, state);
    this._emit('army.formed', { unitId: id, kind: state.kind });
    return { ok: true, state, created: true };
  }

  /** 解散军团（army.disband）：移出 armyStates 与部署锁。 */
  disbandUnit(unitId) {
    const id = String(unitId || '');
    const state = this.states.get(id);
    if (!state) return { ok: false, code: 'unknownUnit', unitId: id };
    this.states.delete(id);
    for (const [battleId, lock] of this.deployLocks) {
      lock.unitIds.delete(id);
      if (lock.unitIds.size === 0) this.deployLocks.delete(battleId);
    }
    this._emit('army.disbanded', { unitId: id, kind: state.kind });
    return { ok: true, unitId: id };
  }

  getUnit(unitId) {
    return this.states.get(String(unitId || '')) || null;
  }

  listUnits() {
    return [...this.states.values()];
  }

  _createState(id, input = {}) {
    const kind = ARMY_UNIT_KINDS.includes(input.kind) ? input.kind : 'army';
    const deployment = input.deployment && typeof input.deployment === 'object' ? input.deployment : {};
    return {
      id,
      kind,
      factionId: input.factionId != null ? String(input.factionId) : null,
      sceneId: input.sceneId != null ? String(input.sceneId) : null,
      position: normalizePoint(input.position) || { x: 0, y: 0 },
      roster: normalizeRoster(input.roster),
      commanderHeroId: input.commanderHeroId != null ? String(input.commanderHeroId) : null,
      formationId: input.formationId != null ? String(input.formationId) : null,
      deployment: {
        committed: deployment.committed === true,
        committedAt: Number.isFinite(Number(deployment.committedAt)) ? Number(deployment.committedAt) : null,
        roster: normalizeRoster(deployment.roster),
        formationId: deployment.formationId != null ? String(deployment.formationId) : null,
        commanderSlot: DEPLOYMENT_SLOTS.includes(deployment.commanderSlot) ? deployment.commanderSlot : 'mid',
        deputySlots: Array.isArray(deployment.deputySlots)
          ? deployment.deputySlots.filter(slot => DEPLOYMENT_SLOTS.includes(slot))
          : [],
        lockedBattleId: deployment.lockedBattleId != null ? String(deployment.lockedBattleId) : null
      },
      order: this._normalizeOrder(input.order),
      morale: input.morale != null ? clampMorale(input.morale) : 80,
      supply: input.supply && typeof input.supply === 'object' ? clone(input.supply) : {},
      battleDeployment: input.battleDeployment && typeof input.battleDeployment === 'object'
        ? clone(input.battleDeployment)
        : {},
      battleOrder: input.battleOrder && typeof input.battleOrder === 'object' ? clone(input.battleOrder) : null
    };
  }

  _normalizeOrder(order) {
    if (!order || typeof order !== 'object' || !order.type) return null;
    return {
      type: String(order.type),
      target: order.target && typeof order.target === 'object' ? clone(order.target) : null,
      issuedDay: Number.isFinite(Number(order.issuedDay)) ? Number(order.issuedDay) : this.getDay(),
      state: ['executing', 'completed', 'failed'].includes(order.state) ? order.state : 'executing',
      progress: clamp01(order.progress),
      totalDistance: Number.isFinite(Number(order.totalDistance)) ? Number(order.totalDistance) : null,
      issuedAt: Number.isFinite(Number(order.issuedAt)) ? Number(order.issuedAt) : this.now()
    };
  }

  _mergeUnitInput(state, input = {}) {
    if (input.position) {
      const point = normalizePoint(input.position);
      if (point) state.position = point;
    }
    if (input.roster && typeof input.roster === 'object') state.roster = normalizeRoster(input.roster);
    if (input.factionId != null) state.factionId = String(input.factionId);
    if (input.sceneId != null) state.sceneId = String(input.sceneId);
    if (input.commanderHeroId != null) state.commanderHeroId = String(input.commanderHeroId);
    if (input.formationId != null) state.formationId = String(input.formationId);
    if (input.morale != null) state.morale = clampMorale(input.morale);
    if (input.supply && typeof input.supply === 'object') state.supply = clone(input.supply);
  }

  // ─── 战略指令（unit.order / unit.order.cancel）─────────────

  /**
   * 下达战略指令（每单位同时只持 1 条；新指令覆盖旧指令）。
   * @param {Object} payload - { unitId, order, target, issuedDay, operationId }
   */
  issueOrder({ unitId = null, armyId = null, order, target = null, issuedDay = null, operationId = null } = {}) {
    const id = unitId || armyId;
    return this._runOperation(operationId, { id, order, target, issuedDay }, () => {
      const state = this.states.get(String(id || ''));
      if (!state) return { ok: false, code: 'unknownUnit', unitId: id };
      const type = String(order || '');
      const definition = this._orderDefs.get(type);
      const isRetreat = type === ARMY_TACTICAL_RETREAT;
      if (!definition && !isRetreat) return { ok: false, code: 'unknownOrder', order: type };
      const lockBattleId = this._lockedBattleFor(state.id);
      if (lockBattleId) {
        return { ok: false, code: 'BATTLE_ACTIVE', battleId: lockBattleId, message: '已接战不可改战略指令' };
      }
      const requiresTarget = definition ? definition.requiresTarget : true;
      if (requiresTarget && !target) return { ok: false, code: 'targetRequired', order: type };
      if (isRetreat && this.config.tacticalRetreatMorale > 0) {
        state.morale = clampMorale(state.morale - this.config.tacticalRetreatMorale);
      }
      const point = this._resolvePoint(target);
      const distance = point
        ? Math.hypot(point.x - state.position.x, point.y - state.position.y)
        : null;
      const replaced = state.order != null;
      state.order = {
        type,
        target: target && typeof target === 'object' ? clone(target) : null,
        issuedDay: Number.isFinite(Number(issuedDay)) ? Number(issuedDay) : this.getDay(),
        state: 'executing',
        progress: 0,
        totalDistance: distance,
        issuedAt: this.now()
      };
      const payloadOrder = clone(state.order);
      this._emit('unit.orderIssued', { unitId: state.id, order: payloadOrder, morale: state.morale });
      return { ok: true, unitId: state.id, order: payloadOrder, replaced };
    });
  }

  /** 撤销战略指令，回到 IDLE。 */
  cancelOrder({ unitId = null, armyId = null, operationId = null } = {}) {
    const id = unitId || armyId;
    return this._runOperation(operationId, { id }, () => {
      const state = this.states.get(String(id || ''));
      if (!state) return { ok: false, code: 'unknownUnit', unitId: id };
      if (!state.order) return { ok: false, code: 'noOrder', unitId: state.id };
      const cancelled = clone(state.order);
      state.order = null;
      return { ok: true, unitId: state.id, cancelled };
    });
  }

  // ─── 战前部署（army.deploy.commit / army.deploy.temp / battle.deploy.lock）──

  /** 提交战前部署默认值（非战斗可改；接战锁后拒绝）。 */
  commitDeployment({
    unitId = null,
    armyId = null,
    roster = null,
    formationId = undefined,
    commanderSlot = undefined,
    deputySlots = undefined,
    battleId = null,
    operationId = null
  } = {}) {
    const id = unitId || armyId;
    return this._runOperation(operationId, { id, roster, formationId, commanderSlot, deputySlots, battleId }, () => {
      const state = this.states.get(String(id || ''));
      if (!state) return { ok: false, code: 'unknownUnit', unitId: id };
      const lockBattleId = this._lockedBattleFor(state.id, battleId);
      if (lockBattleId) return { ok: false, code: DEPLOYMENT_LOCKED, battleId: lockBattleId };
      const formationError = this._validateFormation(formationId);
      if (formationError) return formationError;
      const deployment = state.deployment;
      if (roster && typeof roster === 'object') deployment.roster = normalizeRoster(roster);
      if (formationId !== undefined && formationId !== null) {
        deployment.formationId = String(formationId);
        state.formationId = String(formationId);
      }
      if (commanderSlot !== undefined) {
        if (!DEPLOYMENT_SLOTS.includes(commanderSlot)) return { ok: false, code: 'unknownSlot', slot: commanderSlot };
        deployment.commanderSlot = commanderSlot;
      }
      if (Array.isArray(deputySlots)) {
        const invalid = deputySlots.find(slot => !DEPLOYMENT_SLOTS.includes(slot));
        if (invalid) return { ok: false, code: 'unknownSlot', slot: invalid };
        deployment.deputySlots = [...new Set(deputySlots)];
      }
      deployment.committed = true;
      deployment.committedAt = this.now();
      return { ok: true, unitId: state.id, deployment: clone(deployment) };
    });
  }

  /** 本场临时部署（只写 battleDeployment[battleId]；setAsDefault 时回写默认值）。 */
  applyTempDeployment({
    battleId = null,
    unitId = null,
    armyId = null,
    roster = null,
    formationId = undefined,
    commanderSlot = undefined,
    deputySlots = undefined,
    setAsDefault = false,
    operationId = null
  } = {}) {
    const id = unitId || armyId;
    return this._runOperation(
      operationId,
      { battleId, id, roster, formationId, commanderSlot, deputySlots, setAsDefault },
      () => {
        if (!battleId) return { ok: false, code: 'battleIdRequired' };
        const state = this.states.get(String(id || ''));
        if (!state) return { ok: false, code: 'unknownUnit', unitId: id };
        const lockBattleId = this._lockedBattleFor(state.id, battleId);
        if (lockBattleId) return { ok: false, code: DEPLOYMENT_LOCKED, battleId: lockBattleId };
        const formationError = this._validateFormation(formationId);
        if (formationError) return formationError;
        const override = state.battleDeployment[String(battleId)] || {};
        if (roster && typeof roster === 'object') override.roster = normalizeRoster(roster);
        if (formationId !== undefined && formationId !== null) override.formationId = String(formationId);
        if (commanderSlot !== undefined) {
          if (!DEPLOYMENT_SLOTS.includes(commanderSlot)) return { ok: false, code: 'unknownSlot', slot: commanderSlot };
          override.commanderSlot = commanderSlot;
        }
        if (Array.isArray(deputySlots)) {
          const invalid = deputySlots.find(slot => !DEPLOYMENT_SLOTS.includes(slot));
          if (invalid) return { ok: false, code: 'unknownSlot', slot: invalid };
          override.deputySlots = [...new Set(deputySlots)];
        }
        override.updatedAt = this.now();
        state.battleDeployment[String(battleId)] = override;
        let defaultApplied = null;
        if (setAsDefault) {
          // 回写默认值（入口 ② 勾选"设为默认"）：复用 commit 语义但不走 operationId 幂等
          const committed = this.commitDeployment({
            unitId: state.id, roster, formationId, commanderSlot, deputySlots, battleId
          });
          defaultApplied = committed.ok ? committed.deployment : null;
        }
        return {
          ok: true,
          unitId: state.id,
          battleId: String(battleId),
          override: clone(override),
          defaultApplied
        };
      }
    );
  }

  /** 接战锁：冻结指定（缺省全部）单位的兵种/阵法/主将位置。 */
  lockDeployment({ battleId = null, unitIds = null, operationId = null } = {}) {
    return this._runOperation(operationId, { battleId, unitIds }, () => {
      if (!battleId) return { ok: false, code: 'battleIdRequired' };
      const battleKey = String(battleId);
      const targets = Array.isArray(unitIds) && unitIds.length > 0
        ? unitIds.map(id => String(id)).filter(id => this.states.has(id))
        : [...this.states.keys()];
      if (targets.length === 0) return { ok: false, code: 'noUnits', battleId: battleKey };
      let lock = this.deployLocks.get(battleKey);
      if (!lock) {
        lock = { unitIds: new Set(), lockedAt: this.now() };
        this.deployLocks.set(battleKey, lock);
      }
      for (const id of targets) {
        lock.unitIds.add(id);
        const state = this.states.get(id);
        if (state) state.deployment.lockedBattleId = battleKey;
      }
      const lockedUnits = [...lock.unitIds];
      this._emit('army.deployLocked', { battleId: battleKey, unitIds: lockedUnits });
      return { ok: true, battleId: battleKey, unitIds: lockedUnits };
    });
  }

  /** 战斗结束解除锁。 */
  releaseDeployment(battleId = null) {
    const battleKey = String(battleId || '');
    const lock = this.deployLocks.get(battleKey);
    if (!lock) return { ok: false, code: 'noLock', battleId: battleKey };
    for (const id of lock.unitIds) {
      const state = this.states.get(id);
      if (state && state.deployment.lockedBattleId === battleKey) state.deployment.lockedBattleId = null;
    }
    this.deployLocks.delete(battleKey);
    return { ok: true, battleId: battleKey, released: [...lock.unitIds] };
  }

  isDeployLocked(unitId, battleId = null) {
    return Boolean(this._lockedBattleFor(String(unitId || ''), battleId));
  }

  _lockedBattleFor(unitId, battleId = null) {
    if (battleId != null) {
      const lock = this.deployLocks.get(String(battleId));
      return lock && lock.unitIds.has(unitId) ? String(battleId) : null;
    }
    for (const [battleKey, lock] of this.deployLocks) {
      if (lock.unitIds.has(unitId)) return battleKey;
    }
    return null;
  }

  /** 设置阵法（部署类；战斗中拒绝）。 */
  setFormation({ unitId = null, armyId = null, formationId, battleId = null, operationId = null } = {}) {
    const id = unitId || armyId;
    return this._runOperation(operationId, { id, formationId, battleId }, () => {
      const state = this.states.get(String(id || ''));
      if (!state) return { ok: false, code: 'unknownUnit', unitId: id };
      const lockBattleId = this._lockedBattleFor(state.id, battleId);
      if (lockBattleId) return { ok: false, code: DEPLOYMENT_LOCKED, battleId: lockBattleId };
      const formationError = this._validateFormation(formationId, { required: true });
      if (formationError) return formationError;
      const key = String(formationId);
      state.formationId = key;
      state.deployment.formationId = key;
      return { ok: true, unitId: state.id, formationId: key };
    });
  }

  _validateFormation(formationId, { required = false } = {}) {
    if (formationId === undefined || formationId === null || formationId === '') {
      return required ? { ok: false, code: 'formationRequired' } : null;
    }
    if (this.formationExists && this.formationExists(String(formationId)) !== true) {
      return { ok: false, code: 'unknownFormation', formationId: String(formationId) };
    }
    return null;
  }

  // ─── 将令（unit.battleOrder）───────────────────────────────

  /**
   * 将令：姿态 / 集火 / 撤退——只影响本次战斗，不写 state.order。
   */
  issueBattleOrder({
    unitId = null,
    armyId = null,
    battleId = null,
    kind = 'stance',
    stance = null,
    targetId = null,
    operationId = null
  } = {}) {
    const id = unitId || armyId;
    return this._runOperation(operationId, { id, battleId, kind, stance, targetId }, () => {
      const state = this.states.get(String(id || ''));
      if (!state) return { ok: false, code: 'unknownUnit', unitId: id };
      const identity = this._resolveBattleIdentity(battleId);
      if (!ARMY_BATTLE_ORDERS.includes(identity)) {
        return { ok: false, code: 'commandNotAllowed', identity };
      }
      if (!ARMY_BATTLE_ORDER_KINDS.includes(kind)) {
        return { ok: false, code: 'unknownBattleOrder', kind };
      }
      if (kind === 'stance' && !ARMY_BATTLE_ORDER_STANCES.includes(stance)) {
        return { ok: false, code: 'unknownStance', stance };
      }
      if (kind === 'focus' && !targetId) return { ok: false, code: 'targetRequired', kind };
      const resolvedBattleId = battleId ? String(battleId) : (this.battleAgent?.getActiveBattleId?.() || null);
      state.battleOrder = {
        battleId: resolvedBattleId,
        kind,
        stance: kind === 'stance' ? stance : null,
        targetId: targetId != null ? String(targetId) : null,
        identity,
        issuedAt: this.now()
      };
      const payload = clone(state.battleOrder);
      this._emit('army.battleOrderIssued', { unitId: state.id, ...payload });
      return { ok: true, unitId: state.id, battleOrder: payload };
    });
  }

  /**
   * 将令身份单点解析（唯一判定点）。
   *
   * 当前行为（M3，临时耦合）：按 BattleSystem 的 BattleMode 推断——
   * - INTERVENE（接管）→ 'takeover'（可将令）
   * - OBSERVE（观战）  → 'observe'（不可将令）
   * - 其他/无战斗      → 'unknown'（不可将令）
   *
   * TODO(M6 · support 身份)：M6 引入支援战（强度折半、不可完全接管）后，
   *  1. 在本函数加 `if (mode === BattleMode.SUPPORT) return 'support';`
   *  2. 把 `ARMY_BATTLE_ORDERS`（本文件顶部常量）放开为 `['takeover', 'support']`
   *  3. 预期行为：support 身份也将令受理，但折半系数由 M6 的 battleOrders.supportScale
   *     提供（M3 不写死折半数值），其余判定点不变。
   * @param {string|null} battleId
   * @returns {'takeover'|'observe'|'unknown'}
   */
  _resolveBattleIdentity(battleId = null) {
    const id = battleId || this.battleAgent?.getActiveBattleId?.() || null;
    const battleState = id ? this.battleAgent?.getBattleState?.(id) : null;
    const mode = battleState?.mode ?? null;
    if (mode === BattleMode.INTERVENE) return 'takeover';
    if (mode === BattleMode.OBSERVE) return 'observe';
    return 'unknown';
  }

  getBattleIdentity(battleId = null) {
    return this._resolveBattleIdentity(battleId);
  }

  // ─── 战略刻 ──────────────────────────────────────────────

  /**
   * 按 500ms 战略刻推进（与帧循环解耦；挂起后不刷爆，单次最多补 20 刻）。
   * @param {number} deltaMs
   * @returns {{steps:number}}
   */
  tick(deltaMs = 0) {
    const dt = Number(deltaMs);
    if (!Number.isFinite(dt) || dt <= 0) return { steps: 0 };
    this._accumulator += dt;
    let steps = 0;
    while (this._accumulator >= this.config.tickMs && steps < 20) {
      this._accumulator -= this.config.tickMs;
      this._strategicStep(this.config.tickMs);
      steps += 1;
    }
    return { steps };
  }

  _strategicStep(stepMs) {
    for (const state of this.states.values()) {
      const order = state.order;
      if (!order || order.state !== 'executing') continue;
      if (this.encounterDetector) {
        const encounter = this.encounterDetector(state, order);
        if (encounter && order.encounterResolvedAt == null) {
          order.encounterResolvedAt = this.now();
          this._emit('unit.encounterResolved', {
            unitId: state.id, encounter: clone(encounter), order: clone(order)
          });
        }
      }
      const definition = this._orderDefs.get(order.type);
      const executorKey = definition ? definition.executor : 'march';
      const executor = this.executors[executorKey];
      if (!executor) {
        this._failOrder(state, 'executorUnavailable', { executor: executorKey });
        continue;
      }
      let result;
      try {
        result = executor({ state, order, stepMs, system: this, now: this.now });
      } catch (error) {
        this._failOrder(state, 'executorError', { message: error?.message || String(error) });
        continue;
      }
      this._applyExecutorResult(state, order, result);
    }
  }

  _applyExecutorResult(state, order, result) {
    if (!result || typeof result !== 'object') return;
    if (result.position) {
      const point = normalizePoint(result.position);
      if (point) state.position = point;
    }
    if (result.progress !== undefined) order.progress = clamp01(result.progress);
    if (result.encounter && order.encounterResolvedAt == null) {
      order.encounterResolvedAt = this.now();
      this._emit('unit.encounterResolved', {
        unitId: state.id, encounter: clone(result.encounter), order: clone(order)
      });
    }
    if (result.status === 'completed') {
      this._completeOrder(state, result);
    } else if (result.status === 'failed') {
      this._failOrder(state, result.code || 'orderFailed', result);
    }
  }

  _completeOrder(state, extra = {}) {
    const order = state.order;
    if (!order) return;
    order.state = 'completed';
    order.progress = 1;
    const payload = clone(order);
    state.order = null;
    this._emit('unit.orderCompleted', { unitId: state.id, order: payload, code: extra.code || null });
  }

  _failOrder(state, code, detail = {}) {
    const order = state.order;
    if (!order) return;
    order.state = 'failed';
    const payload = clone(order);
    state.order = null;
    this._emit('unit.orderFailed', { unitId: state.id, order: payload, code, detail: clone(detail) });
  }

  /** 缺省行军执行器：按 marchSpeed 向目标点直线推进，到达即完成。 */
  _defaultMarch({ state, order, stepMs }) {
    const point = this._resolvePoint(order.target);
    if (!point) return { status: 'failed', code: 'targetUnresolved' };
    const dx = point.x - state.position.x;
    const dy = point.y - state.position.y;
    const distance = Math.hypot(dx, dy);
    const travel = (this.config.marchSpeed * stepMs) / 1000;
    if (distance <= this.config.arrivalRadius || distance <= travel) {
      return { status: 'completed', position: point, progress: 1 };
    }
    const ratio = travel / distance;
    const total = order.totalDistance && order.totalDistance > 0 ? order.totalDistance : distance;
    return {
      status: 'executing',
      progress: clamp01(1 - (distance - travel) / total),
      position: { x: state.position.x + dx * ratio, y: state.position.y + dy * ratio }
    };
  }

  _resolvePoint(target) {
    if (!target) return null;
    const direct = normalizePoint(target);
    if (direct) return direct;
    if (this.resolveTargetPoint) {
      try {
        return normalizePoint(this.resolveTargetPoint(target));
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  /** 供场景层复用：指令目标 → 世界坐标（含目标引用解析）。 */
  resolveOrderPoint(target) {
    return this._resolvePoint(target);
  }

  /** 供场景层复用：无场景实体军团走纯数据行军位移。 */
  advanceMarch(context) {
    return this._defaultMarch(context);
  }

  // ─── 快照（gameplay.armyStrategic）─────────────────────────

  serialize() {
    return {
      schemaVersion: 1,
      tickAccumulator: this._accumulator,
      units: [...this.states.values()].map(state => clone({
        id: state.id,
        kind: state.kind,
        factionId: state.factionId,
        sceneId: state.sceneId,
        position: state.position,
        roster: state.roster,
        commanderHeroId: state.commanderHeroId,
        formationId: state.formationId,
        deployment: state.deployment,
        order: state.order,
        morale: state.morale,
        supply: state.supply,
        battleDeployment: state.battleDeployment,
        battleOrder: state.battleOrder
      })),
      deployLocks: [...this.deployLocks.entries()].map(([battleId, lock]) => ({
        battleId,
        unitIds: [...lock.unitIds],
        lockedAt: lock.lockedAt
      }))
    };
  }

  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, code: 'invalidSnapshot' };
    if (snapshot.schemaVersion !== 1) return { ok: false, code: 'unsupportedVersion' };
    this.states.clear();
    this.deployLocks.clear();
    this._operations.clear();
    this._accumulator = Number(snapshot.tickAccumulator) || 0;
    for (const unit of Array.isArray(snapshot.units) ? snapshot.units : []) {
      if (!unit?.id) continue;
      this.states.set(String(unit.id), this._createState(String(unit.id), unit));
    }
    for (const entry of Array.isArray(snapshot.deployLocks) ? snapshot.deployLocks : []) {
      if (!entry?.battleId) continue;
      this.deployLocks.set(String(entry.battleId), {
        unitIds: new Set((entry.unitIds || []).map(id => String(id))),
        lockedAt: Number(entry.lockedAt) || this.now()
      });
    }
    return { ok: true, units: this.states.size };
  }

  // ─── 内部工具 ────────────────────────────────────────────

  _runOperation(operationId, payload, run) {
    const id = String(operationId || '');
    if (!id) return run();
    const fingerprint = JSON.stringify(payload);
    const known = this._operations.get(id);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: id };
    }
    const result = run();
    if (result?.ok) this._operations.set(id, { fingerprint, result: clone(result) });
    return result;
  }

  _emit(event, payload) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event, payload);
    } catch (error) {
      // 事件消费方异常不影响战略刻/指令状态机
    }
  }
}

export default ArmyOrderSystem;

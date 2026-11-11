/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * FoodLedgerSystem - 粮草与后勤经济（模块 9 · M9）
 *
 * 设计依据：.trae/specs/military-supply-strategy/09-food-logistics-economy.md §3 / §5。
 *
 * 覆盖：
 *   - 9A 日耗与断粮：`personDayFactor`（0.8 / 0.8 / 2.4）、四档状态机
 *     normal / tight / empty / collapse、士气衰减、逃散、`starved` 禁出兵、
 *     散兵池 `scatteredPool` + `army.regroup`（P15，30 日窗口）。
 *   - 9B 运输与军营（最小集）：`deposit` / `withdraw`（幂等 operationId），军营容量梯度。
 *   - 9C 抢夺与烧毁：`army.raze`（`razeRatio` + 火种要求 + 20% 可抢回）、
 *     `army.forage`（P14：断粮可就地抢掠，得日耗 ×0.6，扣民心/声望，25% 引追兵）。
 *
 * 设计选择：
 * 1. **单一事实源**：军营库存 = `army.supply.food`（扩展现有 ArmyState.supply），不新增第二套库存。
 * 2. **幂等**：`supply.settledDay` 防重复日结；`operationId` 防重复存取/烧掠。
 * 3. **纯领域**：士气/民心/声望的**写入**由调用方按返回值落地（本服务只算并返回），
 *    避免与模块 6/7 双写；事件仍从本服务发出供触发器消费。
 * 4. **读档兼容**：`maxCatchUpDays` 限制一次补算天数；缺字段一律按默认值。
 */

export const SUPPLY_STATES = Object.freeze({
  NORMAL: 'normal',
  TIGHT: 'tight',
  EMPTY: 'empty',
  COLLAPSE: 'collapse'
});

export const DEFAULT_LOGISTICS_CONFIG = Object.freeze({
  personDayFactor: Object.freeze({ melee: 0.8, archer: 0.8, cavalry: 2.4 }),
  armyBaseUpkeep: 0,
  storageSpoilPerDay: 0.003,
  moraleDrain: Object.freeze({ tight: 3, empty: 8, collapse: 15 }),
  desertion: Object.freeze({ startDay: 3, baseRate: 0.02, rateStep: 0.015, maxRate: 0.08, floorRatio: 0.30 }),
  moraleRecoverPerDay: 5,
  moraleBase: 80,
  regroupWindowDays: 30,
  maxCatchUpDays: 7,
  campStorage: Object.freeze({ base: 500, perLevel: 250, max: 2000 }),
  raze: Object.freeze({ base: 0.6, night: 0.9, defended: 0.3, defenderWins: 0, recoverRatio: 0.2, requiresFireSource: true }),
  forage: Object.freeze({ yieldRatio: 0.6, moraleCost: 6, renownCost: 3, alertChance: 0.25 }),
  unitTypeCategory: Object.freeze({})
});

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function num(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function mergeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    ...DEFAULT_LOGISTICS_CONFIG,
    ...source,
    personDayFactor: { ...DEFAULT_LOGISTICS_CONFIG.personDayFactor, ...(source.personDayFactor || {}) },
    moraleDrain: { ...DEFAULT_LOGISTICS_CONFIG.moraleDrain, ...(source.moraleDrain || {}) },
    desertion: { ...DEFAULT_LOGISTICS_CONFIG.desertion, ...(source.desertion || {}) },
    campStorage: { ...DEFAULT_LOGISTICS_CONFIG.campStorage, ...(source.campStorage || {}) },
    raze: { ...DEFAULT_LOGISTICS_CONFIG.raze, ...(source.raze || {}) },
    forage: { ...DEFAULT_LOGISTICS_CONFIG.forage, ...(source.forage || {}) },
    unitTypeCategory: { ...(source.unitTypeCategory || {}) }
  };
}

/** 兵种 → 日耗类别（配置优先，其次按命名启发：骑 / 弓，其余近战）。 */
export function resolveUnitCategory(unitType, config = DEFAULT_LOGISTICS_CONFIG) {
  const key = unitType == null ? '' : String(unitType);
  const explicit = config?.unitTypeCategory?.[key];
  if (explicit === 'melee' || explicit === 'archer' || explicit === 'cavalry') return explicit;
  if (/cavalry|horse|骑/i.test(key)) return 'cavalry';
  if (/archer|bow|弓/i.test(key)) return 'archer';
  return 'melee';
}

/** 把 roster（对象 map 或数组）统一成 [{unitType, count}]。 */
export function normalizeRoster(roster) {
  if (!roster) return [];
  if (Array.isArray(roster)) {
    return roster
      .filter(entry => entry && entry.unitType != null)
      .map(entry => ({ unitType: String(entry.unitType), count: Math.max(0, Math.floor(num(entry.count, 0))) }));
  }
  if (typeof roster === 'object') {
    return Object.entries(roster).map(([unitType, count]) => ({
      unitType: String(unitType),
      count: Math.max(0, Math.floor(num(count, 0)))
    }));
  }
  return [];
}

/**
 * 军团日耗 = Σ(人数 × personDayFactor[类别]) + armyBaseUpkeep。
 */
export function computeDailyUpkeep(roster, config = DEFAULT_LOGISTICS_CONFIG) {
  let total = Math.max(0, num(config?.armyBaseUpkeep, 0));
  for (const entry of normalizeRoster(roster)) {
    const category = resolveUnitCategory(entry.unitType, config);
    total += entry.count * num(config?.personDayFactor?.[category], 0.8);
  }
  return Math.round(total * 1000) / 1000;
}

function sumRoster(roster) {
  return normalizeRoster(roster).reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * 粮草账本（每军团一条）。
 */
export class FoodLedgerSystem {
  /**
   * @param {Object} [options]
   * @param {Object} [options.config] - game.project.json.logistics
   * @param {Array} [options.armies] - ArmyState[]
   * @param {Function} [options.now]
   * @param {Function} [options.getDay]
   * @param {Function} [options.rng] - () => [0,1)
   * @param {Function} [options.autoResupply] - (armyId, need) => delivered|Promise
   * @param {Function} [options.onEvent]
   */
  constructor({ config = null, armies = [], now = null, getDay = null, rng = null, autoResupply = null, onEvent = null } = {}) {
    this.config = mergeConfig(config);
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this.getDay = typeof getDay === 'function' ? getDay : (() => 1);
    this.rng = typeof rng === 'function' ? rng : (() => Math.random());
    this.autoResupply = typeof autoResupply === 'function' ? autoResupply : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    /** @type {Map<string, Object>} armyId → ArmyState（只读写 supply/morale/manpower） */
    this.armies = new Map();
    /** @type {Map<string, Object>} campId → { campId, level, stock:{food,...} } */
    this.camps = new Map();
    /** @type {Array<Object>} 散兵池 */
    this.scatteredPool = [];
    /** @type {Set<string>} 幂等 operationId */
    this.appliedOperations = new Set();
    for (const army of Array.isArray(armies) ? armies : []) this.registerArmy(army);
  }

  // ─── 军团注册 / 查询 ────────────────────────────────────

  registerArmy(army) {
    if (!army || army.id == null) return { ok: false, code: 'armyIdRequired' };
    const id = String(army.id);
    const existing = this.armies.get(id) || {};
    const supply = army.supply && typeof army.supply === 'object' ? army.supply : {};
    const roster = army.roster || existing.roster || {};
    const manpower = Math.max(0, Math.floor(num(army.manpower, existing.manpower ?? sumRoster(roster))));
    const initialManpower = Math.max(
      manpower,
      Math.floor(num(army.initialManpower, existing.initialManpower ?? manpower))
    );
    const merged = {
      ...existing,
      ...clone(army),
      id,
      roster,
      manpower,
      initialManpower,
      morale: clamp(num(army.morale, existing.morale ?? this.config.moraleBase), 0, 100),
      supply: {
        food: Math.max(0, num(supply.food, existing.supply?.food ?? 0)),
        cap: Math.max(0, num(supply.cap, existing.supply?.cap ?? this.config.campStorage.base)),
        state: supply.state || existing.supply?.state || SUPPLY_STATES.NORMAL,
        emptyDays: Math.max(0, Math.floor(num(supply.emptyDays, existing.supply?.emptyDays ?? 0))),
        settledDay: supply.settledDay ?? existing.supply?.settledDay ?? null,
        autoResupply: supply.autoResupply !== false && (supply.autoResupply === true || existing.supply?.autoResupply === true),
        noDesertion: supply.noDesertion === true || existing.supply?.noDesertion === true,
        starved: supply.starved === true || existing.supply?.starved === true
      }
    };
    this.armies.set(id, merged);
    return { ok: true, army: clone(merged) };
  }

  getArmy(armyId) {
    return clone(this.armies.get(String(armyId || '')) || null);
  }

  /** 可支撑天数（UI 粮条用）。 */
  queryDays(armyId) {
    const army = this.armies.get(String(armyId || ''));
    if (!army) return { ok: false, code: 'unknownArmy', armyId };
    const upkeep = computeDailyUpkeep(army.roster, this.config);
    const days = upkeep > 0 ? num(army.supply.food, 0) / upkeep : Infinity;
    return { ok: true, armyId: String(armyId), upkeep, food: num(army.supply.food, 0), days, state: army.supply.state };
  }

  /** 断粮锁：empty/collapse 时拒绝 attack/move。 */
  canIssueStrategicOrder(armyId) {
    const army = this.armies.get(String(armyId || ''));
    if (!army) return { ok: false, code: 'unknownArmy', armyId };
    const starved = army.supply.state === SUPPLY_STATES.EMPTY || army.supply.state === SUPPLY_STATES.COLLAPSE;
    return { ok: !starved, starved, code: starved ? 'armyStarved' : null, state: army.supply.state };
  }

  // ─── 9A：日结 ──────────────────────────────────────────

  /**
   * 军团日结（幂等）。顺序：自动输送 → 日耗 → 状态 → 士气 → 逃散 → 散兵池。
   * @param {Object} [input]
   * @param {string|null} [input.armyId] - 省略则结算全部军团
   * @param {number|null} [input.day]
   * @returns {{ok:boolean, day:number, armies:Object[], events:Object[]}}
   */
  settleDay({ armyId = null, day = null } = {}) {
    const currentDay = Math.max(1, Math.floor(day != null ? num(day, this.getDay()) : this.getDay()));
    const targets = armyId != null
      ? [this.armies.get(String(armyId))].filter(Boolean)
      : [...this.armies.values()];
    const results = [];
    const events = [];
    for (const army of targets) {
      const supply = army.supply;
      if (supply.settledDay != null && Math.floor(num(supply.settledDay, 0)) >= currentDay) {
        results.push({ armyId: army.id, skipped: true, code: 'alreadySettled', day: currentDay });
        continue;
      }
      const before = { food: supply.food, morale: army.morale, manpower: army.manpower, state: supply.state };
      const upkeep = computeDailyUpkeep(army.roster, this.config);
      // 自动输送（有通路才生效；失败视为未输送）
      let delivered = 0;
      if (supply.autoResupply && this.autoResupply) {
        try {
          delivered = Math.max(0, Math.round(num(this.autoResupply(army.id, upkeep), 0)));
        } catch (error) {
          delivered = 0;
        }
        supply.food = Math.min(supply.cap, supply.food + delivered);
      }
      // 仓储自然损耗
      const spoil = Math.floor(num(supply.food, 0) * Math.max(0, num(this.config.storageSpoilPerDay, 0)));
      if (spoil > 0) supply.food = Math.max(0, supply.food - spoil);

      // 日耗 + 状态
      const food = num(supply.food, 0);
      let state = SUPPLY_STATES.NORMAL;
      let moraleDelta = 0;
      let combatPowerMultiplier = 1;
      let desertionRate = 0;
      let lost = 0;
      if (food >= upkeep && upkeep > 0) {
        supply.food = food - upkeep;
        supply.emptyDays = 0;
        state = SUPPLY_STATES.NORMAL;
      } else if (food > 0 && food < upkeep) {
        supply.food = 0;
        supply.emptyDays = 0;
        state = SUPPLY_STATES.TIGHT;
        moraleDelta -= num(this.config.moraleDrain.tight, 3);
        events.push({ event: 'army.supplyLow', armyId: army.id, days: 0, day: currentDay });
      } else {
        supply.food = 0;
        supply.emptyDays = Math.max(0, Math.floor(num(supply.emptyDays, 0))) + 1;
        const startDay = Math.max(0, num(this.config.desertion.startDay, 3));
        if (supply.emptyDays > startDay) {
          state = SUPPLY_STATES.COLLAPSE;
          moraleDelta -= num(this.config.moraleDrain.collapse, 15);
          combatPowerMultiplier = 0.7;
          // 饥溃档逃散率从 baseRate 起逐日 +rateStep，封顶 maxRate（护栏②：前 startDay 日不减员）
          const base = Math.max(0, num(this.config.desertion.baseRate, 0.02));
          const step = Math.max(0, num(this.config.desertion.rateStep, 0.015));
          const maxRate = clamp(num(this.config.desertion.maxRate, 0.08), 0, 1);
          desertionRate = clamp(base + step * (supply.emptyDays - startDay), Math.min(base, maxRate), maxRate);
          events.push({ event: 'army.supplyEmpty', armyId: army.id, emptyDays: supply.emptyDays, day: currentDay });
        } else {
          state = SUPPLY_STATES.EMPTY;
          moraleDelta -= num(this.config.moraleDrain.empty, 8);
          // 护栏②：断粮前 startDay 日只掉士气，不减员（逃散率 0）
          desertionRate = 0;
          events.push({ event: 'army.supplyEmpty', armyId: army.id, emptyDays: supply.emptyDays, day: currentDay });
        }
        if (desertionRate > 0 && supply.noDesertion !== true) {
          const floorRatio = clamp(num(this.config.desertion.floorRatio, 0.3), 0, 1);
          const floor = Math.floor(Math.max(0, num(army.initialManpower, army.manpower)) * floorRatio);
          const available = Math.max(0, army.manpower - floor);
          lost = Math.min(available, Math.floor(army.manpower * desertionRate));
          if (lost > 0) {
            army.manpower -= lost;
            this.scatteredPool.push({
              armyId: army.id,
              count: lost,
              day: currentDay,
              expiresDay: currentDay + Math.max(1, num(this.config.regroupWindowDays, 30))
            });
          }
        }
      }
      if (state === SUPPLY_STATES.NORMAL) {
        const base = num(this.config.moraleBase, 80);
        const recover = Math.max(0, num(this.config.moraleRecoverPerDay, 5));
        if (army.morale < base) moraleDelta += Math.min(recover, base - army.morale);
      }
      army.morale = clamp(army.morale + moraleDelta, 0, 100);
      supply.state = state;
      supply.starved = state === SUPPLY_STATES.EMPTY || state === SUPPLY_STATES.COLLAPSE;
      supply.days = upkeep > 0 ? Math.round((num(supply.food, 0) / upkeep) * 10) / 10 : null;
      supply.settledDay = currentDay;

      if (lost > 0) {
        events.push({ event: 'army.desertion', armyId: army.id, lost, remain: army.manpower, morale: army.morale, day: currentDay });
      }
      results.push({
        armyId: army.id,
        day: currentDay,
        upkeep,
        delivered,
        spoil,
        before,
        food: supply.food,
        state,
        morale: army.morale,
        moraleDelta,
        lost,
        combatPowerMultiplier
      });
    }
    for (const entry of events) this._emit(entry.event, entry);
    return { ok: true, day: currentDay, armies: results, events };
  }

  /** 一次补算多天（读档兜底，最多 maxCatchUpDays 天）。 */
  catchUp({ armyId = null, fromDay = null, toDay = null } = {}) {
    const from = Math.max(1, Math.floor(num(fromDay, this.getDay())));
    const to = Math.max(from, Math.floor(num(toDay, this.getDay())));
    const cap = Math.max(0, num(this.config.maxCatchUpDays, 7));
    const days = Math.min(cap, to - from);
    const settled = [];
    for (let offset = 0; offset < days; offset += 1) {
      settled.push(this.settleDay({ armyId, day: from + offset }));
    }
    return { ok: true, days, settled };
  }

  // ─── P15：散兵池与招回 ──────────────────────────────────

  listScattered({ armyId = null, day = null } = {}) {
    const currentDay = day != null ? Math.floor(num(day, this.getDay())) : Math.floor(num(this.getDay(), 1));
    return this.scatteredPool
      .filter(entry => entry && entry.count > 0)
      .filter(entry => armyId == null || String(entry.armyId) === String(armyId))
      .filter(entry => num(entry.expiresDay, Infinity) >= currentDay)
      .map(entry => clone(entry));
  }

  /** army.regroup：招回 30 日窗口内散兵（全部）。 */
  regroup({ armyId = null, day = null } = {}) {
    const army = this.armies.get(String(armyId || ''));
    if (!army) return { ok: false, code: 'unknownArmy', armyId };
    const currentDay = day != null ? Math.floor(num(day, this.getDay())) : Math.floor(num(this.getDay(), 1));
    let returned = 0;
    const remain = [];
    for (const entry of this.scatteredPool) {
      if (String(entry.armyId) !== String(army.id)) {
        remain.push(entry);
        continue;
      }
      if (entry.count <= 0 || num(entry.expiresDay, Infinity) < currentDay) continue;
      returned += entry.count;
    }
    if (returned > 0) {
      army.manpower += returned;
      this.scatteredPool = remain;
      const payload = { armyId: army.id, returned, remain: army.manpower };
      this._emit('army.regrouped', payload);
      return { ok: true, ...payload };
    }
    this.scatteredPool = remain;
    return { ok: true, returned: 0, remain: army.manpower };
  }

  // ─── 9C：烧毁 / 抢掠 ───────────────────────────────────

  /**
   * army.raze：烧毁敌军营/粮车存量。
   * @param {Object} input
   * @param {Object} input.target - { kind, id, stock:{food,...} }（target.stock 会被就地扣减）
   * @param {boolean} [input.night]
   * @param {boolean} [input.defended] - 守军在场且守方战败
   * @param {boolean} [input.defenderWins]
   * @param {boolean} [input.hasFireSource]
   * @param {string} [input.operationId]
   */
  raze({ target = null, night = false, defended = false, defenderWins = false, hasFireSource = false, operationId = null } = {}) {
    if (!target || typeof target !== 'object' || !target.stock || typeof target.stock !== 'object') {
      return { ok: false, code: 'targetRequired' };
    }
    if (this.config.raze.requiresFireSource === true && hasFireSource !== true) {
      return { ok: false, code: 'fireSourceRequired' };
    }
    const operationKey = operationId != null ? String(operationId) : null;
    if (operationKey && this.appliedOperations.has(operationKey)) {
      return { ok: true, idempotent: true, operationId: operationKey, razed: {}, recovered: {} };
    }
    let ratio = num(this.config.raze.base, 0.6);
    if (defenderWins === true) ratio = num(this.config.raze.defenderWins, 0);
    else if (defended === true) ratio = num(this.config.raze.defended, 0.3);
    else if (night === true) ratio = num(this.config.raze.night, 0.9);
    ratio = clamp(ratio, 0, 1);
    const recoverRatio = clamp(num(this.config.raze.recoverRatio, 0.2), 0, 1);
    const razed = {};
    const recovered = {};
    for (const [resource, amount] of Object.entries(target.stock)) {
      const value = Math.max(0, Math.floor(num(amount, 0)));
      if (value <= 0) continue;
      const destroyed = Math.floor(value * ratio);
      if (destroyed <= 0) continue;
      target.stock[resource] = value - destroyed;
      razed[resource] = destroyed;
      const back = Math.floor(destroyed * recoverRatio);
      if (back > 0) recovered[resource] = back;
    }
    if (operationKey) this.appliedOperations.add(operationKey);
    const payload = { targetKind: target.kind || null, targetId: target.id != null ? String(target.id) : null, razed, recovered, night, defended };
    this._emit('army.supplyRazed', payload);
    return { ok: true, ...payload };
  }

  /**
   * army.forage（P14）：断粮档就地抢掠，得日耗 ×0.6 直接入军营库存。
   */
  forage({ armyId = null, operationId = null } = {}) {
    const army = this.armies.get(String(armyId || ''));
    if (!army) return { ok: false, code: 'unknownArmy', armyId };
    if (army.supply.state !== SUPPLY_STATES.EMPTY && army.supply.state !== SUPPLY_STATES.COLLAPSE) {
      return { ok: false, code: 'notStarved', state: army.supply.state };
    }
    const operationKey = operationId != null ? String(operationId) : null;
    if (operationKey && this.appliedOperations.has(operationKey)) {
      return { ok: true, idempotent: true, operationId: operationKey, gained: 0 };
    }
    const upkeep = computeDailyUpkeep(army.roster, this.config);
    const gained = Math.round(upkeep * clamp(num(this.config.forage.yieldRatio, 0.6), 0, 1));
    army.supply.food = Math.min(army.supply.cap, num(army.supply.food, 0) + gained);
    if (operationKey) this.appliedOperations.add(operationKey);
    const alerted = clamp(num(this.rng(), 0, 1), 0, 1) < num(this.config.forage.alertChance, 0.25);
    const payload = {
      armyId: army.id,
      gained,
      moraleCost: Math.max(0, num(this.config.forage.moraleCost, 6)),
      renownCost: Math.max(0, num(this.config.forage.renownCost, 3)),
      alerted,
      state: army.supply.state
    };
    this._emit('army.foraged', payload);
    return { ok: true, ...payload };
  }

  // ─── 9B：军营容器（最小集） ─────────────────────────────

  registerCamp({ campId = null, level = 1, stock = null, ownerArmyId = null, ownerFactionId = null } = {}) {
    const id = campId != null ? String(campId) : null;
    if (!id) return { ok: false, code: 'campIdRequired' };
    const existing = this.camps.get(id) || {};
    const capacity = Math.min(
      num(this.config.campStorage.max, 2000),
      num(this.config.campStorage.base, 500) + (Math.max(1, Math.floor(num(level, 1))) - 1) * num(this.config.campStorage.perLevel, 250)
    );
    const mergedStock = { ...(existing.stock || {}) };
    for (const [resource, amount] of Object.entries(stock && typeof stock === 'object' ? stock : {})) {
      mergedStock[resource] = Math.max(0, Math.floor(num(amount, 0)));
    }
    this.camps.set(id, {
      campId: id,
      level: Math.max(1, Math.floor(num(level, 1))),
      capacity,
      stock: mergedStock,
      ownerArmyId: ownerArmyId != null ? String(ownerArmyId) : (existing.ownerArmyId || null),
      ownerFactionId: ownerFactionId != null ? String(ownerFactionId) : (existing.ownerFactionId || null)
    });
    return { ok: true, camp: clone(this.camps.get(id)) };
  }

  getCamp(campId) {
    return clone(this.camps.get(String(campId || '')) || null);
  }

  /** 背包/货舱 → 军营（幂等 operationId）。 */
  deposit({ armyId = null, campId = null, entries = null, operationId = null } = {}) {
    const army = this.armies.get(String(armyId || ''));
    const camp = this.camps.get(String(campId || ''));
    if (!army) return { ok: false, code: 'unknownArmy', armyId };
    if (!camp) return { ok: false, code: 'unknownCamp', campId };
    const items = this._normalizeEntries(entries);
    if (!items) return { ok: false, code: 'entriesRequired' };
    const operationKey = operationId != null ? String(operationId) : null;
    if (operationKey && this.appliedOperations.has(operationKey)) {
      return { ok: true, idempotent: true, operationId: operationKey };
    }
    for (const [resource, value] of Object.entries(items)) {
      if (resource === 'food' && num(army.supply.food, 0) < value) {
        return { ok: false, code: 'insufficientSupply', resource, required: value, available: num(army.supply.food, 0) };
      }
    }
    let total = Object.values(camp.stock).reduce((sum, value) => sum + num(value, 0), 0);
    for (const [resource, value] of Object.entries(items)) {
      if (total + value > camp.capacity) return { ok: false, code: 'campCapacityExceeded', capacity: camp.capacity };
      total += value;
    }
    if (items.food) army.supply.food = num(army.supply.food, 0) - items.food;
    for (const [resource, value] of Object.entries(items)) {
      camp.stock[resource] = num(camp.stock[resource], 0) + value;
    }
    if (operationKey) this.appliedOperations.add(operationKey);
    return { ok: true, armyId: army.id, campId: camp.campId, entries: items };
  }

  /** 军营 → 背包/货舱（幂等 operationId；军营食物优先补 surveyed 需求）。 */
  withdraw({ armyId = null, campId = null, entries = null, operationId = null } = {}) {
    const army = this.armies.get(String(armyId || ''));
    const camp = this.camps.get(String(campId || ''));
    if (!army) return { ok: false, code: 'unknownArmy', armyId };
    if (!camp) return { ok: false, code: 'unknownCamp', campId };
    const items = this._normalizeEntries(entries);
    if (!items) return { ok: false, code: 'entriesRequired' };
    const operationKey = operationId != null ? String(operationId) : null;
    if (operationKey && this.appliedOperations.has(operationKey)) {
      return { ok: true, idempotent: true, operationId: operationKey };
    }
    for (const [resource, value] of Object.entries(items)) {
      if (num(camp.stock[resource], 0) < value) {
        return { ok: false, code: 'insufficientCampStock', resource, required: value, available: num(camp.stock[resource], 0) };
      }
    }
    for (const [resource, value] of Object.entries(items)) {
      camp.stock[resource] = num(camp.stock[resource], 0) - value;
    }
    if (items.food) army.supply.food = Math.min(army.supply.cap, num(army.supply.food, 0) + items.food);
    if (operationKey) this.appliedOperations.add(operationKey);
    return { ok: true, armyId: army.id, campId: camp.campId, entries: items };
  }

  // ─── 序列化 ────────────────────────────────────────────

  serialize() {
    return {
      schemaVersion: 1,
      armies: [...this.armies.values()].map(army => clone(army)),
      camps: [...this.camps.values()].map(camp => clone(camp)),
      scatteredPool: clone(this.scatteredPool),
      appliedOperations: [...this.appliedOperations].slice(-500)
    };
  }

  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, code: 'invalidSnapshot' };
    this.armies.clear();
    this.camps.clear();
    this.scatteredPool = [];
    this.appliedOperations.clear();
    for (const army of Array.isArray(snapshot.armies) ? snapshot.armies : []) {
      if (army?.id != null) this.registerArmy(army);
    }
    for (const camp of Array.isArray(snapshot.camps) ? snapshot.camps : []) {
      if (camp?.campId != null) {
        this.camps.set(String(camp.campId), {
          campId: String(camp.campId),
          level: Math.max(1, Math.floor(num(camp.level, 1))),
          capacity: Math.max(0, num(camp.capacity, this.config.campStorage.base)),
          stock: { ...(camp.stock || {}) },
          ownerArmyId: camp.ownerArmyId != null ? String(camp.ownerArmyId) : null,
          ownerFactionId: camp.ownerFactionId != null ? String(camp.ownerFactionId) : null
        });
      }
    }
    this.scatteredPool = Array.isArray(snapshot.scatteredPool) ? clone(snapshot.scatteredPool) : [];
    for (const key of Array.isArray(snapshot.appliedOperations) ? snapshot.appliedOperations : []) {
      this.appliedOperations.add(String(key));
    }
    return { ok: true, armies: this.armies.size, camps: this.camps.size };
  }

  _normalizeEntries(entries) {
    if (!entries || typeof entries !== 'object') return null;
    const next = {};
    for (const [resource, value] of Object.entries(entries)) {
      const parsed = Math.floor(num(value, 0));
      if (parsed <= 0) continue;
      next[resource] = parsed;
    }
    return Object.keys(next).length > 0 ? next : null;
  }

  _emit(event, payload) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event, payload);
    } catch (error) {
      // 事件消费方异常不影响粮草结算
    }
  }
}

export default FoodLedgerSystem;

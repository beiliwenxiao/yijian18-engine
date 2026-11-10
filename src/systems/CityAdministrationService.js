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
 * CityAdministrationService - 城镇与内政（模块 7 · M7）
 *
 * 设计依据：.trae/specs/military-supply-strategy/07-town-administration.md
 *
 * 覆盖：§3.1 城池状态扩展（population / production / settledDay 为可选块，旧数据零改动）、
 *      §3.2 产出公式（唯一实现处）、§3.3 民心五源、§4 日推进流水线（幂等 settledDay）、
 *      §6 招募三路径（城内 / 营地 / 流浪）、§7 攻击与输送两个入口、§8 围城与易主状态机。
 *
 * 设计选择：
 * 1. **状态自带**：service 持有 cityStates / camps / playerResources，`serialize/restore` 可进档；
 *    与 M3/M4 一致，不在服务内直接改黑板（由调用方在结算后 state.transaction 写回）。
 * 2. **纯计算 + 显式提交**：日结 `settleDay` 返回变更清单；招募/输送先全量校验再一次性扣减，
 *    失败不改任何数据（原子）。
 * 3. **可选块缺省**：population / production 缺失时按 buildingLevel + morale 默认公式推导，
 *    既有城池数据零改动。
 * 4. **不做的**：税率滑块、民心事件概率表、饥荒事件链（P13 只读粮仓给民心衰减项）。
 */

export const CITY_STATUS = Object.freeze({
  NORMAL: 'NORMAL',
  UNDER_SIEGE: 'UNDER_SIEGE',
  OCCUPIED: 'OCCUPIED'
});

export const RECRUIT_PATHS = Object.freeze(['city', 'camp', 'wandering']);

export const DEFAULT_CITY_ADMIN_CONFIG = Object.freeze({
  morale: Object.freeze({
    base: 60,
    min: 0,
    max: 100,
    multiplierMin: 0.5,
    multiplierMax: 1.5,
    defeatPenalty: -12,
    siegeDaily: -3,
    defenseWin: 8,
    relief: 5,
    reliefFoodCost: 20,
    famine: Object.freeze({ thresholdDays: 3, minPenalty: 1, maxPenalty: 4 })
  }),
  production: Object.freeze({
    levelBonus: 0.2,
    coinPerPopulation: 0.02
  }),
  population: Object.freeze({
    defaultBasePerLevel: 1000,
    recruitDivisor: 100,
    perDayDivisor: 10,
    recoverPerDay: 8,
    /** 名额上限 = floor(total / recruitDivisor × multiplierMax) */
    capMultiplier: 1.5
  }),
  recruitCost: Object.freeze({
    perSoldier: Object.freeze({ coin: 8, food: 2, recruitable: 1 }),
    byUnitType: Object.freeze({}),
    batchMax: 20,
    requiresFormedArmy: false,
    campRecruitableBase: 20,
    campRecruitablePerDay: 10
  }),
  siege: Object.freeze({ moraleDaily: -3 }),
  capture: Object.freeze({ moralePenalty: -12, damageRatioAdd: 0.15, transferRatio: 0.5 })
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
    morale: {
      ...DEFAULT_CITY_ADMIN_CONFIG.morale,
      ...(source.morale || {}),
      famine: { ...DEFAULT_CITY_ADMIN_CONFIG.morale.famine, ...(source.morale?.famine || {}) }
    },
    production: { ...DEFAULT_CITY_ADMIN_CONFIG.production, ...(source.production || {}) },
    population: { ...DEFAULT_CITY_ADMIN_CONFIG.population, ...(source.population || {}) },
    recruitCost: {
      ...DEFAULT_CITY_ADMIN_CONFIG.recruitCost,
      ...(source.recruitCost || {}),
      perSoldier: { ...DEFAULT_CITY_ADMIN_CONFIG.recruitCost.perSoldier, ...(source.recruitCost?.perSoldier || {}) },
      byUnitType: { ...(source.recruitCost?.byUnitType || {}) }
    },
    siege: { ...DEFAULT_CITY_ADMIN_CONFIG.siege, ...(source.siege || {}) },
    capture: { ...DEFAULT_CITY_ADMIN_CONFIG.capture, ...(source.capture || {}) }
  };
}

function normalizeResourceMap(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const next = {};
  for (const [key, value] of Object.entries(source)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) next[key] = Math.floor(parsed);
  }
  return next;
}

/** 民心乘数：clamp(0.5 + morale/100, 0.5, 1.5)。 */
export function resolveMoraleMultiplier(morale, config = DEFAULT_CITY_ADMIN_CONFIG.morale) {
  const min = num(config?.multiplierMin, 0.5);
  const max = num(config?.multiplierMax, 1.5);
  return clamp(0.5 + num(morale, 60) / 100, min, max);
}

/** 等级乘数：1 + (level-1) × 0.2。 */
export function resolveLevelMultiplier(buildingLevel, config = DEFAULT_CITY_ADMIN_CONFIG.production) {
  const level = Math.max(1, Math.floor(num(buildingLevel, 1)));
  return 1 + (level - 1) * num(config?.levelBonus, 0.2);
}

/**
 * 产出公式（§3.2，唯一实现处）。
 * @param {Object} city
 * @param {Object} [options]
 * @param {Array} [options.constructionDefinitions] - construction.definitions[]
 */
export function computeCityProduction(city, { constructionDefinitions = [], config = DEFAULT_CITY_ADMIN_CONFIG.production } = {}) {
  const morale = clamp(num(city?.morale, 60), 0, 100);
  const moraleMultiplier = resolveMoraleMultiplier(morale);
  const levelMultiplier = resolveLevelMultiplier(city?.buildingLevel, config);
  const buildingDamage = city?.buildingDamage && typeof city.buildingDamage === 'object' ? city.buildingDamage : {};
  const definitionById = new Map(
    (Array.isArray(constructionDefinitions) ? constructionDefinitions : [])
      .filter(entry => entry && entry.id != null)
      .map(entry => [String(entry.id), entry])
  );
  const curated = city?.buildings && typeof city.buildings === 'object'
    ? Object.keys(city.buildings)
    : [...definitionById.keys()];
  const buildingIds = curated.length > 0 ? curated : [...definitionById.keys()];
  const production = {};
  for (const buildingId of buildingIds) {
    const definition = definitionById.get(String(buildingId));
    const base = definition?.production;
    if (!base || typeof base !== 'object') continue;
    const damaged = clamp(num(buildingDamage[buildingId], 0), 0, 1);
    for (const [resource, amount] of Object.entries(base)) {
      const value = num(amount, 0) * (1 - damaged);
      if (value <= 0) continue;
      production[resource] = (production[resource] || 0) + value;
    }
  }
  for (const resource of Object.keys(production)) {
    production[resource] = Math.round(production[resource] * moraleMultiplier * levelMultiplier);
  }
  const populationTotal = Math.max(0, num(city?.population?.total, 0));
  const coin = Math.round(populationTotal * num(config?.coinPerPopulation, 0.02) * moraleMultiplier);
  if (coin > 0) production.coin = (production.coin || 0) + coin;
  return production;
}

/** 可招募名额（§3.2 公式）。 */
export function computeRecruitableGain(populationTotal, morale, config = DEFAULT_CITY_ADMIN_CONFIG.population) {
  const multiplier = resolveMoraleMultiplier(morale);
  const divisor = Math.max(1, num(config?.recruitDivisor, 100));
  const perDayDivisor = Math.max(1, num(config?.perDayDivisor, 10));
  return Math.floor((Math.max(0, num(populationTotal, 0)) / divisor * multiplier) / perDayDivisor)
    + Math.max(0, num(config?.recoverPerDay, 8));
}

function normalizePopulation(city, config = DEFAULT_CITY_ADMIN_CONFIG.population) {
  const level = Math.max(1, Math.floor(num(city?.buildingLevel, 1)));
  const source = city?.population && typeof city.population === 'object' ? city.population : {};
  const total = Math.max(0, num(source.total, level * num(config?.defaultBasePerLevel, 1000)));
  const recoverPerDay = Math.max(0, num(source.recoverPerDay, num(config?.recoverPerDay, 8)));
  // 名额上限至少容得下一天的自然恢复，避免小城人口把池子压到 0/1
  const cap = Math.max(
    Math.floor(total / Math.max(1, num(config?.recruitDivisor, 100)) * num(config?.capMultiplier, 1.5)),
    recoverPerDay
  );
  return {
    total,
    recruitable: clamp(num(source.recruitable, 0), 0, Math.max(0, cap)),
    recoverPerDay,
    cap: Math.max(0, cap)
  };
}

function resolveFaminePenalty(city, day, moraleConfig) {
  const food = num(city?.resources?.food, 0);
  const population = Math.max(0, num(city?.population?.total, 0));
  const thresholdDays = Math.max(0, num(moraleConfig?.famine?.thresholdDays, 3));
  if (thresholdDays <= 0 || population <= 0) return 0;
  const demand = population * thresholdDays;
  if (food >= demand) return 0;
  const shortage = (demand - food) / Math.max(1, demand);
  const minPenalty = Math.max(0, num(moraleConfig?.famine?.minPenalty, 1));
  const maxPenalty = Math.max(minPenalty, num(moraleConfig?.famine?.maxPenalty, 4));
  return Math.ceil(minPenalty + (maxPenalty - minPenalty) * clamp(shortage, 0, 1));
}

/** 招募成本（perSoldier + byUnitType 覆盖）。 */
export function resolveRecruitCost(unitType, count, config = DEFAULT_CITY_ADMIN_CONFIG.recruitCost) {
  const perSoldier = { ...(config?.perSoldier || {}) };
  const override = unitType != null ? config?.byUnitType?.[unitType] : null;
  const unitCost = override && typeof override === 'object' ? { ...perSoldier, ...override } : perSoldier;
  const total = {};
  for (const [resource, amount] of Object.entries(unitCost)) {
    const value = Math.max(0, num(amount, 0)) * Math.max(0, count);
    if (value > 0) total[resource] = Math.floor(value);
  }
  return total;
}

/**
 * 城镇内政服务。
 */
export class CityAdministrationService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.config] - game.project.json.cityAdmin（可选覆盖）
   * @param {Array} [options.cities] - cityStates[]
   * @param {Array} [options.constructionDefinitions] - construction.definitions[]
   * @param {Array} [options.camps] - blackboard.camps 映射数组
   * @param {Object} [options.playerResources] - 流浪招募扣费容器
   * @param {Function} [options.now]
   * @param {Function} [options.getDay]
   * @param {Function} [options.onEvent]
   */
  constructor({
    config = null,
    cities = [],
    constructionDefinitions = [],
    camps = [],
    playerResources = null,
    now = null,
    getDay = null,
    onEvent = null
  } = {}) {
    this.config = mergeConfig(config);
    this.constructionDefinitions = Array.isArray(constructionDefinitions) ? constructionDefinitions : [];
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this.getDay = typeof getDay === 'function' ? getDay : (() => 1);
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    /** @type {Map<string, Object>} cityId → cityState */
    this.cities = new Map();
    /** @type {Map<string, Object>} campId → { campId, sceneId, storageContainerId, resources, recruitable, laidAt } */
    this.camps = new Map();
    this.playerResources = normalizeResourceMap(playerResources);
    for (const city of Array.isArray(cities) ? cities : []) this.setCity(city);
    for (const camp of Array.isArray(camps) ? camps : []) this.registerCamp(camp);
  }

  // ─── 城池读写 ────────────────────────────────────────────

  setCity(city) {
    if (!city || city.id == null) return { ok: false, code: 'cityIdRequired' };
    const id = String(city.id);
    const existing = this.cities.get(id) || {};
    const merged = {
      ...existing,
      ...clone(city),
      id,
      status: city.status || existing.status || CITY_STATUS.NORMAL
    };
    merged.resources = normalizeResourceMap({ ...(existing.resources || {}), ...(city.resources || {}) });
    if (merged.morale == null) merged.morale = num(this.config.morale.base, 60);
    merged.population = normalizePopulation(merged);
    merged.production = merged.production && typeof merged.production === 'object' ? merged.production : {};
    this.cities.set(id, merged);
    return { ok: true, city: clone(merged) };
  }

  getCity(cityId) {
    return clone(this.cities.get(String(cityId || '')) || null);
  }

  listCities({ factionId = null } = {}) {
    const list = [...this.cities.values()];
    return list
      .filter(city => factionId == null || String(city.factionId) === String(factionId))
      .map(city => clone(city));
  }

  /** 注册营地（fromCampId 的权威来源，§6.1）。 */
  registerCamp(camp) {
    if (!camp) return { ok: false, code: 'campRequired' };
    const campId = camp.campId != null ? String(camp.campId) : (camp.id != null ? String(camp.id) : null);
    if (!campId) return { ok: false, code: 'campIdRequired' };
    this.camps.set(campId, {
      campId,
      sceneId: camp.sceneId != null ? String(camp.sceneId) : null,
      storageContainerId: camp.storageContainerId != null ? String(camp.storageContainerId) : null,
      resources: normalizeResourceMap(camp.resources),
      recruitable: Math.max(0, num(camp.recruitable, this.config.recruitCost.campRecruitableBase)),
      laidAt: num(camp.laidAt, this.now())
    });
    return { ok: true, campId };
  }

  removeCamp(campId) {
    return { ok: this.camps.delete(String(campId || '')) };
  }

  // ─── 日结（§4） ──────────────────────────────────────────

  /**
   * 日推进流水线 ①产出 ②民心 ③兵源；④⑤由调用方（军团补给 / 建造押运）执行。
   * @param {Object} [input]
   * @param {number} [input.day]
   * @param {Array<{cityId?:string, foodCost?:number}>} [input.garrisonSupplies] - ④ 军团补给（可选）
   * @returns {{ok:boolean, day:number, cities:Object[], events:Object[]}}
   */
  settleDay({ day = null, garrisonSupplies = null } = {}) {
    const currentDay = Math.max(1, Math.floor(day != null ? num(day, this.getDay()) : this.getDay()));
    const changes = [];
    const events = [];
    for (const city of this.cities.values()) {
      if (city.settledDay != null && Math.floor(num(city.settledDay, 0)) >= currentDay) {
        changes.push({ cityId: city.id, skipped: true, code: 'alreadySettled', day: currentDay });
        continue;
      }
      const before = {
        resources: { ...city.resources },
        morale: city.morale,
        recruitable: city.population.recruitable
      };
      // ① 产出
      const production = computeCityProduction(city, {
        constructionDefinitions: this.constructionDefinitions,
        config: this.config.production
      });
      city.production = { ...production };
      for (const [resource, amount] of Object.entries(production)) {
        city.resources[resource] = Math.max(0, num(city.resources[resource], 0) + amount);
      }
      // ② 民心：围城 + 饥荒
      let moraleDelta = 0;
      if (city.status === CITY_STATUS.UNDER_SIEGE || num(city.damagePausedUntilDay, 0) > currentDay) {
        moraleDelta += num(this.config.siege.moraleDaily, -3);
      }
      const famine = resolveFaminePenalty(city, currentDay, this.config.morale);
      if (famine > 0) {
        moraleDelta -= famine;
        events.push({ event: 'city.famine', cityId: city.id, penalty: famine, day: currentDay });
      }
      city.morale = clamp(num(city.morale, 60) + moraleDelta, this.config.morale.min, this.config.morale.max);
      // ③ 兵源恢复
      const population = normalizePopulation(city);
      const gain = computeRecruitableGain(population.total, city.morale, this.config.population);
      const nextRecruitable = Math.min(population.cap, population.recruitable + gain);
      city.population = { ...population, recruitable: nextRecruitable };
      city.settledDay = currentDay;
      // ④ 军团补给（可选，扣城内 food，不足扣士气由军团侧处理）
      let supplyFood = 0;
      if (Array.isArray(garrisonSupplies)) {
        for (const entry of garrisonSupplies) {
          if (String(entry?.cityId) !== String(city.id)) continue;
          const need = Math.max(0, num(entry.foodCost, 0));
          const available = num(city.resources.food, 0);
          const consumed = Math.min(available, need);
          city.resources.food = available - consumed;
          supplyFood += consumed;
        }
      }
      changes.push({
        cityId: city.id,
        day: currentDay,
        production,
        moraleBefore: before.morale,
        moraleAfter: city.morale,
        moraleDelta,
        recruitableBefore: before.recruitable,
        recruitableAfter: nextRecruitable,
        supplyFood
      });
      events.push({ event: 'city.productionSettled', cityId: city.id, day: currentDay, production });
      if (city.morale !== before.morale) {
        events.push({ event: 'city.moraleChanged', cityId: city.id, day: currentDay, from: before.morale, to: city.morale });
      }
      events.push({ event: 'city.recruitPoolUpdated', cityId: city.id, day: currentDay, recruitable: nextRecruitable });
    }
    for (const entry of events) this._emit(entry.event, entry);
    return { ok: true, day: currentDay, cities: changes, events };
  }

  // ─── 民心显式来源（§3.3 战败 / 守城胜） ─────────────────

  applyMoraleChange({ cityId = null, delta = 0, reason = null } = {}) {
    const city = this.cities.get(String(cityId || ''));
    if (!city) return { ok: false, code: 'unknownCity', cityId };
    const before = num(city.morale, 60);
    city.morale = clamp(before + num(delta, 0), this.config.morale.min, this.config.morale.max);
    if (city.morale !== before) {
      this._emit('city.moraleChanged', { cityId: city.id, from: before, to: city.morale, reason });
    }
    return { ok: true, cityId: city.id, before, morale: city.morale };
  }

  /** 赈济：消耗 food，+5 民心，每日 1 次。 */
  relief({ cityId = null, day = null } = {}) {
    const city = this.cities.get(String(cityId || ''));
    if (!city) return { ok: false, code: 'unknownCity', cityId };
    const currentDay = Math.max(1, Math.floor(day != null ? num(day, this.getDay()) : this.getDay()));
    if (city.lastReliefDay != null && Math.floor(num(city.lastReliefDay, 0)) >= currentDay) {
      return { ok: false, code: 'reliefAlreadyUsedToday', day: currentDay };
    }
    const cost = Math.max(0, num(this.config.morale.reliefFoodCost, 20));
    if (num(city.resources.food, 0) < cost) return { ok: false, code: 'insufficientFood', required: cost };
    city.resources.food = num(city.resources.food, 0) - cost;
    const before = num(city.morale, 60);
    city.morale = clamp(before + num(this.config.morale.relief, 5), this.config.morale.min, this.config.morale.max);
    city.lastReliefDay = currentDay;
    const payload = { cityId: city.id, day: currentDay, foodCost: cost, from: before, to: city.morale };
    this._emit('city.moraleChanged', { ...payload, reason: 'relief' });
    return { ok: true, ...payload };
  }

  // ─── 招募三路径（§6） ────────────────────────────────────

  /**
   * @param {Object} input
   * @param {string|null} [input.cityId]
   * @param {string|null} [input.fromCampId]
   * @param {string} [input.unitType]
   * @param {number} [input.count]
   * @param {number|null} [input.partySpace] - 流浪招募的兵员空位
   */
  recruit({ cityId = null, fromCampId = null, unitType = null, count = 0, partySpace = null } = {}) {
    const amount = Math.floor(num(count, 0));
    if (amount <= 0) return { ok: false, code: 'invalidCount', count };
    const batchMax = Math.max(1, num(this.config.recruitCost.batchMax, 20));
    if (amount > batchMax) return { ok: false, code: 'batchExceeded', batchMax, count: amount };
    const cost = resolveRecruitCost(unitType, amount, this.config.recruitCost);

    let path = null;
    let container = null;
    let pool = null;
    if (cityId != null) {
      const city = this.cities.get(String(cityId));
      if (!city) return { ok: false, code: 'unknownCity', cityId };
      path = 'city';
      container = city.resources;
      pool = city.population;
    } else if (fromCampId != null) {
      const camp = this.camps.get(String(fromCampId));
      if (!camp) return { ok: false, code: 'unknownCamp', fromCampId };
      path = 'camp';
      container = camp.resources;
      pool = { recruitable: camp.recruitable, cap: Math.max(camp.recruitable, num(this.config.recruitCost.campRecruitableBase, 20)) };
    } else {
      path = 'wandering';
      container = this.playerResources;
      pool = { recruitable: null, cap: partySpace != null ? Math.max(0, Math.floor(num(partySpace, 0))) : null };
    }

    if (path !== 'wandering') {
      const needed = Math.max(0, num(cost.recruitable, amount));
      if (pool.recruitable < needed) {
        return { ok: false, code: 'insufficientRecruitable', required: needed, available: pool.recruitable, path };
      }
    } else if (pool.cap != null && amount > pool.cap) {
      return { ok: false, code: 'insufficientSpace', required: amount, available: pool.cap, path };
    }
    for (const [resource, value] of Object.entries(cost)) {
      if (resource === 'recruitable') continue;
      if (num(container[resource], 0) < value) {
        return { ok: false, code: 'insufficientResource', resource, required: value, available: num(container[resource], 0), path };
      }
    }

    // 全量校验通过 → 一次性扣减（原子）
    const paid = {};
    for (const [resource, value] of Object.entries(cost)) {
      if (resource === 'recruitable') {
        if (path !== 'wandering') {
          if (path === 'city') pool.recruitable -= value;
          else pool.recruitable -= value;
        }
        continue;
      }
      container[resource] = num(container[resource], 0) - value;
      paid[resource] = value;
    }
    if (path === 'city') {
      const city = this.cities.get(String(cityId));
      city.population.recruitable = Math.max(0, pool.recruitable);
    } else if (path === 'camp') {
      const camp = this.camps.get(String(fromCampId));
      camp.recruitable = Math.max(0, pool.recruitable);
    }
    const payload = { cityId, fromCampId, unitType, count: amount, path, cost: paid, countRecruitable: num(cost.recruitable, path === 'wandering' ? 0 : amount) };
    this._emit('city.recruited', payload);
    return { ok: true, ...payload };
  }

  // ─── 攻击 / 输送 / 调拨（§7） ────────────────────────────

  orderAttack({ cityId = null, target = null, hasArmy = true } = {}) {
    const city = this.cities.get(String(cityId || ''));
    if (!city) return { ok: false, code: 'unknownCity', cityId };
    if (!target) return { ok: false, code: 'targetRequired' };
    if (!hasArmy) {
      return { ok: true, plan: { kind: 'army.form', cityId: city.id, target }, requiresConfirm: true };
    }
    return { ok: true, plan: { kind: 'army.order', order: 'attack', cityId: city.id, target } };
  }

  /** 输送：校验城池库存 → 生成押运计划并扣减城池侧（原子）。 */
  orderTransport({ cityId = null, target = null, items = null } = {}) {
    const city = this.cities.get(String(cityId || ''));
    if (!city) return { ok: false, code: 'unknownCity', cityId };
    if (city.status === CITY_STATUS.UNDER_SIEGE) return { ok: false, code: 'siegeNoTransportOut', cityId: city.id };
    if (!target) return { ok: false, code: 'targetRequired' };
    const resources = normalizeResourceMap(items);
    if (Object.keys(resources).length === 0) return { ok: false, code: 'itemsRequired' };
    for (const [resource, value] of Object.entries(resources)) {
      if (num(city.resources[resource], 0) < value) {
        return { ok: false, code: 'insufficientResource', resource, required: value, available: num(city.resources[resource], 0) };
      }
    }
    for (const [resource, value] of Object.entries(resources)) {
      city.resources[resource] = num(city.resources[resource], 0) - value;
    }
    const payload = { cityId: city.id, target, items: resources };
    this._emit('city.transportDispatched', payload);
    return { ok: true, plan: { kind: 'convoy.assemble', ...payload }, ...payload };
  }

  /** 城池间直接调拨（无押运，剧情用）。 */
  transfer({ fromCityId = null, toCityId = null, resources = null } = {}) {
    if (String(fromCityId) === String(toCityId)) return { ok: false, code: 'sameCity' };
    const from = this.cities.get(String(fromCityId || ''));
    const to = this.cities.get(String(toCityId || ''));
    if (!from) return { ok: false, code: 'unknownCity', cityId: fromCityId };
    if (!to) return { ok: false, code: 'unknownCity', cityId: toCityId };
    const items = normalizeResourceMap(resources);
    if (Object.keys(items).length === 0) return { ok: false, code: 'resourcesRequired' };
    for (const [resource, value] of Object.entries(items)) {
      if (num(from.resources[resource], 0) < value) {
        return { ok: false, code: 'insufficientResource', resource, required: value, available: num(from.resources[resource], 0) };
      }
    }
    for (const [resource, value] of Object.entries(items)) {
      from.resources[resource] = num(from.resources[resource], 0) - value;
      to.resources[resource] = num(to.resources[resource], 0) + value;
    }
    return { ok: true, fromCityId: from.id, toCityId: to.id, resources: items };
  }

  // ─── 围城与易主（§8.1） ──────────────────────────────────

  beginSiege({ cityId = null, byFactionId = null, day = null } = {}) {
    const city = this.cities.get(String(cityId || ''));
    if (!city) return { ok: false, code: 'unknownCity', cityId };
    if (city.status === CITY_STATUS.UNDER_SIEGE) return { ok: true, idempotent: true, cityId: city.id };
    city.status = CITY_STATUS.UNDER_SIEGE;
    city.siegeBy = byFactionId != null ? String(byFactionId) : null;
    city.siegeStartedDay = day != null ? Math.floor(num(day, this.getDay())) : Math.floor(num(this.getDay(), 1));
    this._emit('city.siegeStarted', { cityId: city.id, byFactionId: city.siegeBy, day: city.siegeStartedDay });
    return { ok: true, cityId: city.id, day: city.siegeStartedDay };
  }

  liftSiege({ cityId = null, victory = true } = {}) {
    const city = this.cities.get(String(cityId || ''));
    if (!city) return { ok: false, code: 'unknownCity', cityId };
    if (city.status !== CITY_STATUS.UNDER_SIEGE) return { ok: true, idempotent: true, cityId: city.id };
    city.status = CITY_STATUS.NORMAL;
    city.siegeBy = null;
    city.siegeStartedDay = null;
    if (victory) {
      const before = num(city.morale, 60);
      city.morale = clamp(before + num(this.config.morale.defenseWin, 8), this.config.morale.min, this.config.morale.max);
      this._emit('city.moraleChanged', { cityId: city.id, from: before, to: city.morale, reason: 'defenseWin' });
    }
    this._emit('city.siegeLifted', { cityId: city.id, victory: victory === true });
    return { ok: true, cityId: city.id, victory: victory === true, morale: city.morale };
  }

  /**
   * 易主：换 faction、扣民心、加损毁、按战果转移资源给胜方城池（可选）。
   */
  captureCity({ cityId = null, factionId = null, winnerCityId = null } = {}) {
    const city = this.cities.get(String(cityId || ''));
    if (!city) return { ok: false, code: 'unknownCity', cityId };
    if (factionId == null) return { ok: false, code: 'factionIdRequired' };
    const previousFactionId = city.factionId != null ? String(city.factionId) : null;
    city.factionId = String(factionId);
    city.status = CITY_STATUS.NORMAL;
    city.siegeBy = null;
    city.siegeStartedDay = null;
    city.morale = clamp(num(city.morale, 60) + num(this.config.capture.moralePenalty, -12), this.config.morale.min, this.config.morale.max);
    city.damageRatio = clamp(num(city.damageRatio, 0) + num(this.config.capture.damageRatioAdd, 0.15), 0, 1);
    let transferred = {};
    if (winnerCityId != null) {
      const winner = this.cities.get(String(winnerCityId));
      if (winner) {
        const ratio = clamp(num(this.config.capture.transferRatio, 0.5), 0, 1);
        for (const [resource, amount] of Object.entries(city.resources)) {
          const move = Math.floor(num(amount, 0) * ratio);
          if (move <= 0) continue;
          city.resources[resource] = num(amount, 0) - move;
          winner.resources[resource] = num(winner.resources[resource], 0) + move;
          transferred[resource] = move;
        }
      }
    }
    const payload = { cityId: city.id, fromFactionId: previousFactionId, toFactionId: city.factionId, transferred, morale: city.morale };
    this._emit('city.captured', payload);
    return { ok: true, ...payload };
  }

  // ─── 序列化 ──────────────────────────────────────────────

  serialize() {
    return {
      schemaVersion: 1,
      cities: [...this.cities.values()].map(city => clone(city)),
      camps: [...this.camps.values()].map(camp => clone(camp)),
      playerResources: clone(this.playerResources)
    };
  }

  /** 旧档兼容：缺 cities/camps 视为空；未知字段原样保留在 city 上。 */
  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, code: 'invalidSnapshot' };
    this.cities.clear();
    this.camps.clear();
    for (const city of Array.isArray(snapshot.cities) ? snapshot.cities : []) {
      if (city?.id != null) this.setCity(city);
    }
    for (const camp of Array.isArray(snapshot.camps) ? snapshot.camps : []) {
      if (camp) this.registerCamp(camp);
    }
    this.playerResources = normalizeResourceMap(snapshot.playerResources);
    return { ok: true, cities: this.cities.size, camps: this.camps.size };
  }

  _emit(event, payload) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event, payload);
    } catch (error) {
      // 事件消费方异常不影响内政结算
    }
  }
}

export default CityAdministrationService;

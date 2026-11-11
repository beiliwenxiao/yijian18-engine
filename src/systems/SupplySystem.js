/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 ************************************************************/

/************************************************************
 * 通用军需配给领域系统：按等级/城池刷新额度、城池共享库存扣减、
 * 领用单状态机（随身直达 / 押运待装）、取消双退与幂等。
 *
 * 与 ProductionSystem 同构：
 *  - 城库存唯一事实源仍是注入的 readCities / commitCities 适配器
 *    （引擎不依赖 Blackboard），物品入包只走 InventoryTransactionService；
 *  - 城库存扣减与订单创建同一次提交：commitCities 成功后才落订单，
 *    避免「领空」；
 *  - 所有写操作 operationId 幂等，重复提交返回首次结果。
 ************************************************************/

const SNAPSHOT_VERSION = 1;
const RESOURCE_KEYS = ['food', 'wood', 'iron', 'herb'];
const ORDER_STATUSES = ['APPROVED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'LOST', 'CANCELLED'];
const TERMINAL_ORDER_STATUSES = new Set(['DELIVERED', 'LOST', 'CANCELLED']);
const DEFAULT_RESOURCE_ITEMS = {
  food: 'resource.food',
  wood: 'resource.wood',
  iron: 'resource.iron',
  herb: 'resource.herb'
};
const DEFAULT_RESOURCE_WEIGHTS = { food: 1, wood: 2, iron: 3, herb: 1 };
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const normalizeId = value => typeof value === 'string' ? value.trim() : '';
const positiveInt = value => {
  const number = Math.floor(Number(value) || 0);
  return number > 0 ? number : 0;
};

export class SupplySystem {
  constructor({ readCities, commitCities, inventoryTransactions, itemResolver = null,
    getDay = () => 1, config = {}, onEvent = null, createEventId = null,
    maxOperations = 256, maxOrders = 64 } = {}) {
    if (typeof readCities !== 'function') throw new TypeError('SupplySystem requires readCities');
    if (typeof commitCities !== 'function') throw new TypeError('SupplySystem requires commitCities');
    if (!inventoryTransactions) throw new TypeError('SupplySystem requires inventoryTransactions');
    this.readCities = readCities;
    this.commitCities = commitCities;
    this.inventoryTransactions = inventoryTransactions;
    this.itemResolver = typeof itemResolver === 'function' ? itemResolver : () => null;
    this.getDay = typeof getDay === 'function' ? getDay : () => 1;
    this.createEventId = typeof createEventId === 'function' ? createEventId : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.config = this._normalizeConfig(config);
    this.maxOperations = Math.max(16, Math.floor(Number(maxOperations) || 256));
    this.maxOrders = Math.max(8, Math.floor(Number(maxOrders) || 64));
    this.quotas = new Map();
    this.orders = new Map();
    this.operations = new Map();
    this.sequence = 0;
  }

  /**
   * 配给所只读快照：城池库存、当日额度、今日已领与剩余。
   */
  open({ cityId, characterId, rank } = {}) {
    const city = this._findCity(cityId);
    const character = normalizeId(characterId);
    if (!city) return { ok: false, code: 'cityMissing', cityId: normalizeId(cityId) };
    if (!character) return { ok: false, code: 'invalidCharacter' };
    const day = this._day();
    const quota = this._quotaFor(city, rank);
    const used = this._usageOf(character, city.id, day);
    const remaining = {};
    for (const key of RESOURCE_KEYS) {
      remaining[key] = Math.max(0, (Number(quota.daily[key]) || 0) - (Number(used[key]) || 0));
    }
    return {
      ok: true,
      day,
      cityId: city.id,
      cityName: city.name || city.id,
      factionId: city.factionId || null,
      owned: this._ownsCity(city),
      resources: clone(city.resources || {}),
      quota: {
        rank: quota.rank,
        multiplier: quota.multiplier,
        daily: clone(quota.daily),
        used: clone(used),
        remaining
      },
      limits: clone(this.config.carryLimits),
      resourceItems: clone(this.config.resourceItems),
      resourceWeights: clone(this.config.resourceWeights),
      destination: 'personal'
    };
  }

  /**
   * 领用：额度内扣城池共享库存；destination=personal 直达背包，
   * destination=convoy 只落 APPROVED 领用单等押运装车。
   */
  requisition({ cityId, characterId, rank, items, destination = 'personal', inventory = null,
    operationId } = {}) {
    const character = normalizeId(characterId);
    const cityKey = normalizeId(cityId);
    const opId = normalizeId(operationId);
    if (!character || !cityKey || !opId) return { ok: false, code: 'invalidInput' };
    if (destination !== 'personal' && destination !== 'convoy') {
      return { ok: false, code: 'invalidDestination' };
    }
    const requested = this._normalizeRequest(items);
    if (!requested) return { ok: false, code: 'invalidItems' };

    const day = this._day();
    const fingerprint = JSON.stringify([character, cityKey, rank ?? null, day, destination, requested]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }

    const cities = clone(this.readCities() || []);
    const city = Array.isArray(cities) ? cities.find(entry => normalizeId(entry?.id) === cityKey) : null;
    if (!city) return { ok: false, code: 'cityMissing', cityId: cityKey };
    if (!this._ownsCity(city)) return { ok: false, code: 'cityNotOwned', cityId: cityKey };

    const quota = this._quotaFor(city, rank);
    const used = this._usageOf(character, cityKey, day);
    const granted = {};
    const shortages = [];
    let clamped = false;
    let quotaBlocked = true;
    for (const key of RESOURCE_KEYS) {
      const want = Number(requested[key]) || 0;
      if (want <= 0) continue;
      const remaining = Math.max(0, (Number(quota.daily[key]) || 0) - (Number(used[key]) || 0));
      const stock = positiveInt(city.resources?.[key]);
      if (remaining > 0) quotaBlocked = false;
      else shortages.push({ resource: key, reason: 'quotaExceeded', requested: want });
      const value = Math.min(want, remaining, stock);
      if (value < want) {
        clamped = true;
        if (remaining < want && remaining < stock) {
          shortages.push({ resource: key, reason: 'quotaExceeded', requested: want, granted: value });
        } else if (stock < want) {
          shortages.push({ resource: key, reason: 'insufficientCityStock', requested: want, granted: value });
        }
      }
      if (value > 0) granted[key] = value;
    }
    if (Object.keys(granted).length === 0) {
      return {
        ok: false,
        code: quotaBlocked ? 'quotaExceeded' : 'insufficientCityStock',
        cityId: cityKey,
        day,
        shortages
      };
    }

    if (destination === 'personal') {
      if (!inventory) return { ok: false, code: 'inventoryUnavailable' };
      const weight = this._weightOf(granted);
      const maxWeight = Number(this.config.carryLimits.personalMaxWeight) || 0;
      if (weight > maxWeight) {
        return {
          ok: false,
          code: 'convoyRequired',
          cityId: cityKey,
          weight,
          maxWeight,
          items: granted
        };
      }
    }

    const resolved = [];
    if (destination === 'personal') {
      for (const [resource, quantity] of Object.entries(granted)) {
        const item = this.itemResolver(this.config.resourceItems[resource]);
        if (!item?.id) return { ok: false, code: 'unknownItem', resource, itemId: this.config.resourceItems[resource] };
        resolved.push({ item: clone(item), quantity });
      }
    }

    const before = clone(cities);
    city.resources = city.resources || {};
    for (const [resource, quantity] of Object.entries(granted)) {
      city.resources[resource] = (Number(city.resources[resource]) || 0) - quantity;
    }
    const committed = this.commitCities(cities);
    if (committed === false || committed?.ok === false) {
      return { ok: false, code: 'cityCommitFailed', cityId: cityKey };
    }

    const orderId = `order:${day}:${cityKey}:${++this.sequence}`;
    if (destination === 'personal') {
      const delivered = this.inventoryTransactions.commit({
        type: 'batchAdd',
        inventory,
        entries: resolved,
        allowPartial: false,
        operationId: `${opId}:deliver`
      });
      if (!delivered.ok) {
        this.inventoryTransactions.forgetOperation?.(`${opId}:deliver`);
        this.commitCities(before);
        return { ok: false, code: 'inventoryCommitFailed', reason: delivered.code || null };
      }
    }

    const order = {
      orderId,
      cityId: cityKey,
      characterId: character,
      rank: Math.max(1, Math.floor(Number(rank) || 1)),
      day,
      items: clone(granted),
      destination,
      status: destination === 'personal' ? 'DELIVERED' : 'APPROVED',
      operationId: opId,
      convoyId: null
    };
    this.orders.set(orderId, order);
    this._trimOrders();
    this._addUsage(character, cityKey, day, granted);

    const quantity = Object.values(granted).reduce((sum, value) => sum + value, 0);
    const result = {
      ok: true,
      orderId,
      status: order.status,
      cityId: cityKey,
      characterId: character,
      day,
      items: clone(granted),
      requested: clone(requested),
      destination,
      partial: clamped,
      shortages
    };
    if (destination === 'convoy') {
      // 押运订单先只落单（城已扣），装车由 ConvoySystem.load 承接。
    } else {
      this._emit('supply.delivered', { orderId, items: clone(granted), target: 'personal' });
    }
    this._emit('supply.requisitioned', {
      cityId: cityKey,
      characterId: character,
      day,
      orderId,
      items: clone(granted),
      quantity,
      destination,
      partial: clamped
    });
    this._remember(opId, fingerprint, result);
    return clone(result);
  }

  /**
   * 取消 APPROVED 领用单：城库存与额度双退（已装车不可取消）。
   */
  cancel({ orderId, operationId } = {}) {
    const id = normalizeId(orderId);
    const opId = normalizeId(operationId);
    if (!id || !opId) return { ok: false, code: 'invalidInput' };
    const fingerprint = JSON.stringify(['cancel', id]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    const order = this.orders.get(id);
    if (!order) return { ok: false, code: 'unknownOrder', orderId: id };
    if (order.status !== 'APPROVED') {
      return { ok: false, code: 'orderNotCancellable', orderId: id, status: order.status };
    }

    const cities = clone(this.readCities() || []);
    const city = Array.isArray(cities) ? cities.find(entry => normalizeId(entry?.id) === order.cityId) : null;
    if (!city) return { ok: false, code: 'cityMissing', cityId: order.cityId };
    city.resources = city.resources || {};
    for (const [resource, quantity] of Object.entries(order.items)) {
      city.resources[resource] = (Number(city.resources[resource]) || 0) + quantity;
    }
    const committed = this.commitCities(cities);
    if (committed === false || committed?.ok === false) {
      return { ok: false, code: 'cityCommitFailed', cityId: order.cityId };
    }

    order.status = 'CANCELLED';
    const usage = this.quotas.get(this._usageKey(order.characterId, order.cityId));
    if (usage && usage.day === order.day) {
      for (const [resource, quantity] of Object.entries(order.items)) {
        usage.used[resource] = Math.max(0, (Number(usage.used[resource]) || 0) - quantity);
      }
    }
    this._trimOrders();
    const result = { ok: true, orderId: id, status: 'CANCELLED', refunded: clone(order.items) };
    this._remember(opId, fingerprint, result);
    return clone(result);
  }

  /**
   * 押运系统回写订单状态（单一事实源：订单只由本系统持有）。
   */
  transitionOrder(orderId, status, details = {}) {
    const id = normalizeId(orderId);
    const order = this.orders.get(id);
    if (!order) return { ok: false, code: 'unknownOrder', orderId: id };
    if (!ORDER_STATUSES.includes(status)) return { ok: false, code: 'invalidOrderStatus', status };
    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      return { ok: false, code: 'orderNotTransitionable', orderId: id, status: order.status };
    }
    order.status = status;
    if (details.convoyId) order.convoyId = normalizeId(details.convoyId) || null;
    this._trimOrders();
    return { ok: true, order: clone(order) };
  }

  getOrder(orderId) {
    return clone(this.orders.get(normalizeId(orderId)) || null);
  }

  listOrders({ characterId = null, status = null } = {}) {
    const character = normalizeId(characterId);
    return [...this.orders.values()]
      .filter(order => (!character || order.characterId === character)
        && (!status || order.status === status))
      .map(order => clone(order));
  }

  captureRuntime() {
    return {
      sequence: this.sequence,
      quotas: new Map([...this.quotas].map(([key, value]) => [key, clone(value)])),
      orders: new Map([...this.orders].map(([key, value]) => [key, clone(value)])),
      operations: new Map([...this.operations].map(([key, value]) => [key, clone(value)]))
    };
  }

  restoreRuntime(snapshot) {
    if (!(snapshot?.quotas instanceof Map) || !(snapshot?.orders instanceof Map)
      || !(snapshot?.operations instanceof Map)) return false;
    this.sequence = Math.max(0, Math.floor(Number(snapshot.sequence) || 0));
    this.quotas = new Map([...snapshot.quotas].map(([key, value]) => [key, clone(value)]));
    this.orders = new Map([...snapshot.orders].map(([key, value]) => [key, clone(value)]));
    this.operations = new Map([...snapshot.operations].map(([key, value]) => [key, clone(value)]));
    return true;
  }

  serialize() {
    return {
      schemaVersion: SNAPSHOT_VERSION,
      sequence: this.sequence,
      quotas: [...this.quotas.entries()].map(([key, value]) => ({ key, day: value.day, used: clone(value.used) })),
      orders: [...this.orders.values()].map(order => clone(order)),
      operations: [...this.operations.entries()].map(([operationId, entry]) => ({
        operationId,
        fingerprint: entry.fingerprint,
        result: clone(entry.result)
      }))
    };
  }

  validateSerialized(data = {}) {
    const prepared = this._prepareSerialized(data);
    return prepared.ok ? { ok: true, errors: [] } : { ok: false, errors: prepared.errors };
  }

  deserialize(data = {}) {
    const prepared = this._prepareSerialized(data);
    if (!prepared.ok) return { ok: false, errors: prepared.errors };
    this.sequence = prepared.sequence;
    this.quotas = prepared.quotas;
    this.orders = prepared.orders;
    this.operations = prepared.operations;
    return { ok: true, errors: [] };
  }

  // ===== internals =====

  _normalizeConfig(config = {}) {
    const quotas = (Array.isArray(config.quotas) ? config.quotas : [])
      .map(entry => {
        const daily = {};
        for (const key of RESOURCE_KEYS) {
          const value = Math.floor(Number(entry?.daily?.[key]) || 0);
          if (value > 0) daily[key] = value;
        }
        return { rank: Math.max(1, Math.floor(Number(entry?.rank) || 1)), daily };
      })
      .filter(entry => Object.keys(entry.daily).length > 0)
      .sort((a, b) => a.rank - b.rank);
    const resourceItems = { ...DEFAULT_RESOURCE_ITEMS };
    for (const key of RESOURCE_KEYS) {
      const value = normalizeId(config.resourceItems?.[key]);
      if (value) resourceItems[key] = value;
    }
    const resourceWeights = { ...DEFAULT_RESOURCE_WEIGHTS };
    for (const key of RESOURCE_KEYS) {
      const value = Number(config.resourceWeights?.[key]);
      if (Number.isFinite(value) && value >= 0) resourceWeights[key] = value;
    }
    const modifiers = config.cityModifiers || {};
    const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return {
      playerFactionId: normalizeId(config.playerFactionId) || 'yellow_turban',
      alliedFactionIds: (Array.isArray(config.alliedFactionIds) ? config.alliedFactionIds : [])
        .map(normalizeId)
        .filter(Boolean),
      quotaMode: normalizeId(config.quotaMode) || 'rank',
      quotaRefresh: normalizeId(config.quotaRefresh) || 'daily',
      carryLimits: {
        personalMaxWeight: Math.max(0, numberOr(config.carryLimits?.personalMaxWeight, 10))
      },
      resourceItems,
      resourceWeights,
      cityModifiers: {
        buildingLevelBonus: Math.max(0, numberOr(modifiers.buildingLevelBonus, 0.1)),
        buildingLevelBonusCap: Math.max(0, numberOr(modifiers.buildingLevelBonusCap, 0.5)),
        lowMoraleThreshold: numberOr(modifiers.lowMoraleThreshold, 30),
        lowMoraleMultiplier: Math.max(0, numberOr(modifiers.lowMoraleMultiplier, 0.7))
      },
      quotas
    };
  }

  _findCity(cityId) {
    const key = normalizeId(cityId);
    if (!key) return null;
    const cities = this.readCities() || [];
    return Array.isArray(cities) ? cities.find(city => normalizeId(city?.id) === key) || null : null;
  }

  _ownsCity(city) {
    const factionId = normalizeId(city?.factionId);
    return factionId === this.config.playerFactionId || this.config.alliedFactionIds.includes(factionId);
  }

  /**
   * 营地归属（V3）：显式 ownerFactionId / ownerArmyId 优先，不靠旧 faction 过滤。
   * @param {{ownerFactionId?: string, ownerArmyId?: string}} camp
   */
  _ownsCamp(camp) {
    const ownerFactionId = normalizeId(camp?.ownerFactionId);
    if (ownerFactionId) {
      return ownerFactionId === this.config.playerFactionId || this.config.alliedFactionIds.includes(ownerFactionId);
    }
    return Boolean(normalizeId(camp?.ownerArmyId));
  }

  /**
   * 势力成立（P2）：己方城 ≥1 或己方军营 ≥1。
   * @param {Array} [camps] - FoodLedgerSystem.camps 的数组形态
   */
  hasPlayerStronghold(camps = []) {
    const cities = this.readCities();
    if (Array.isArray(cities) && cities.some(city => this._ownsCity(city))) return true;
    return Array.isArray(camps) && camps.some(camp => this._ownsCamp(camp));
  }

  _quotaFor(city, rank) {
    const quotas = this.config.quotas;
    if (quotas.length === 0) return { rank: 0, daily: {}, multiplier: 1 };
    const level = Math.max(1, Math.floor(Number(rank) || 1));
    let chosen = quotas[0];
    for (const entry of quotas) {
      if (entry.rank <= level) chosen = entry;
    }
    const modifiers = this.config.cityModifiers;
    const buildingLevel = Math.max(0, Number(city?.buildingLevel) || 0);
    const bonus = Math.min(modifiers.buildingLevelBonusCap, buildingLevel * modifiers.buildingLevelBonus);
    const morale = Number(city?.morale);
    const lowMorale = Number.isFinite(morale) && morale < modifiers.lowMoraleThreshold;
    const multiplier = (1 + bonus) * (lowMorale ? modifiers.lowMoraleMultiplier : 1);
    const daily = {};
    for (const key of RESOURCE_KEYS) {
      const base = Number(chosen.daily[key]) || 0;
      const value = Math.floor(base * multiplier);
      if (value > 0) daily[key] = value;
    }
    return { rank: chosen.rank, daily, multiplier };
  }

  _usageKey(characterId, cityId) {
    return `${characterId}:${cityId}`;
  }

  _usageOf(characterId, cityId, day) {
    const entry = this.quotas.get(this._usageKey(characterId, cityId));
    const used = {};
    for (const key of RESOURCE_KEYS) {
      used[key] = entry && entry.day === day ? Math.max(0, Number(entry.used?.[key]) || 0) : 0;
    }
    return used;
  }

  _addUsage(characterId, cityId, day, items) {
    const key = this._usageKey(characterId, cityId);
    const entry = this.quotas.get(key);
    const used = entry && entry.day === day ? clone(entry.used) : {};
    for (const [resource, quantity] of Object.entries(items)) {
      used[resource] = Math.max(0, Number(used[resource]) || 0) + quantity;
    }
    this.quotas.set(key, { day, used });
  }

  _normalizeRequest(items) {
    if (!items || typeof items !== 'object') return null;
    const requested = {};
    let hasPositive = false;
    for (const key of RESOURCE_KEYS) {
      const value = Math.floor(Number(items[key]) || 0);
      if (value > 0) {
        requested[key] = value;
        hasPositive = true;
      }
    }
    return hasPositive ? requested : null;
  }

  _weightOf(items) {
    return Object.entries(items)
      .reduce((sum, [resource, quantity]) => sum + (Number(this.config.resourceWeights[resource]) || 0) * quantity, 0);
  }

  _day() {
    return Math.max(1, Math.floor(Number(this.getDay()) || 1));
  }

  _trimOrders() {
    const finished = [...this.orders.values()].filter(order => TERMINAL_ORDER_STATUSES.has(order.status));
    if (finished.length <= this.maxOrders) return;
    for (const order of finished.slice(0, finished.length - this.maxOrders)) {
      this.orders.delete(order.orderId);
    }
  }

  _remember(operationId, fingerprint, result) {
    if (!operationId) return;
    this.operations.set(operationId, { fingerprint, result: clone(result) });
    while (this.operations.size > this.maxOperations) this.operations.delete(this.operations.keys().next().value);
  }

  _createEventId(eventType, payload) {
    if (!this.createEventId) return null;
    try {
      return this.createEventId({ eventType, payload: clone(payload) }) || null;
    } catch (error) {
      console.warn('[SupplySystem] 创建事件 ID 失败', { eventType, error });
      return null;
    }
  }

  _emit(event, payload) {
    const data = clone(payload) || {};
    const eventId = this._createEventId(event, data);
    if (eventId) data.eventId = eventId;
    try {
      this.onEvent(event, data);
    } catch (error) {
      console.warn(`[SupplySystem] ${event} listener failed`, error);
    }
  }

  _prepareSerialized(data) {
    const errors = [];
    if (!data || Number(data.schemaVersion) !== SNAPSHOT_VERSION) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: 'schemaVersion' }] };
    }
    if (!Array.isArray(data.quotas) || !Array.isArray(data.orders) || !Array.isArray(data.operations)) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: '', message: '配给存档集合必须为数组' }] };
    }
    const quotas = new Map();
    data.quotas.forEach((entry, index) => {
      const key = normalizeId(entry?.key);
      const day = Math.floor(Number(entry?.day) || 0);
      if (!key || day <= 0) {
        errors.push({ code: 'invalidQuotaUsage', path: `quotas[${index}]` });
        return;
      }
      quotas.set(key, { day, used: clone(entry.used || {}) });
    });
    const orders = new Map();
    data.orders.forEach((source, index) => {
      const orderId = normalizeId(source?.orderId);
      const cityId = normalizeId(source?.cityId);
      const characterId = normalizeId(source?.characterId);
      const status = normalizeId(source?.status);
      if (!orderId || !cityId || !characterId || !ORDER_STATUSES.includes(status)) {
        errors.push({ code: 'invalidOrder', path: `orders[${index}]` });
        return;
      }
      orders.set(orderId, {
        ...clone(source),
        orderId,
        cityId,
        characterId,
        status,
        destination: source.destination === 'convoy' ? 'convoy' : 'personal',
        items: clone(source.items || {}),
        convoyId: normalizeId(source.convoyId) || null
      });
    });
    if (errors.length) return { ok: false, errors };
    const operations = new Map();
    data.operations.forEach(source => {
      const operationId = normalizeId(source?.operationId);
      if (operationId) operations.set(operationId, { fingerprint: source.fingerprint, result: clone(source.result) });
    });
    return {
      ok: true,
      sequence: Math.max(0, Math.floor(Number(data.sequence) || 0)),
      quotas,
      orders,
      operations,
      errors: []
    };
  }
}

export default SupplySystem;

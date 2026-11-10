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
 * ReputationSystem - 声望与城池态度（模块 6 · 6G，定稿 P25 做到 R3）
 *
 * 设计依据：06-battle-plan-intervene.md §11（声望方案）：
 *   - 单一事实源：玩家声望存于 player.reputation，城池可 override（byCity）。
 *   - 态度档位（五档）：敬仰 / 友善 / 中立 / 冷淡 / 敌对；数值区间见 REPUTATION_TIERS。
 *   - R3 消费点：城池内商店买卖、修理、锻造、招募单价，统一态度系数（quote）。
 *   - 卖价上限 ×3（07 §13 #10：声望再高也不能超过 3 倍）。
 *   - `enabled:false` 时全部系数 1.0（零回归开关）。
 */

/** 五档态度（按 value 从高到低匹配；敌对在最末）。 */
export const REPUTATION_TIERS = Object.freeze([
  { key: 'admired', label: '敬仰', min: 60, priceMultiplier: 0.90, recruitMultiplier: 1.5, refuseTrade: false },
  { key: 'friendly', label: '友善', min: 20, priceMultiplier: 0.95, recruitMultiplier: 1.2, refuseTrade: false },
  { key: 'neutral', label: '中立', min: -19, priceMultiplier: 1.00, recruitMultiplier: 1.0, refuseTrade: false },
  { key: 'cold', label: '冷淡', min: -59, priceMultiplier: 1.10, recruitMultiplier: 0.5, refuseTrade: false },
  { key: 'hostile', label: '敌对', min: -100, priceMultiplier: 1.30, recruitMultiplier: 0, refuseTrade: true }
]);

export const REPUTATION_VALUE_RANGE = Object.freeze({ min: -100, max: 100 });

/** 卖价硬上限倍数（07 §13 #10）。 */
export const SELL_PRICE_CAP = 3;

export const DEFAULT_REPUTATION_CONFIG = Object.freeze({
  enabled: true,
  tiers: REPUTATION_TIERS,
  min: REPUTATION_VALUE_RANGE.min,
  max: REPUTATION_VALUE_RANGE.max,
  sellPriceCap: SELL_PRICE_CAP,
  /** 城池 override 的过期策略：不自动过期，由内容显式调整。 */
  cityOverride: true
});

/** 价格类别（R3 只覆盖这四类）。 */
export const REPUTATION_PRICE_KINDS = Object.freeze(['buy', 'sell', 'repair', 'craft', 'recruit']);

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

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function resolveAttitude(value, tiers = REPUTATION_TIERS) {
  const parsed = num(value, 0);
  const list = Array.isArray(tiers) && tiers.length > 0 ? tiers : REPUTATION_TIERS;
  for (const tier of list) {
    if (parsed >= tier.min) return tier;
  }
  return list[list.length - 1];
}

/** 声望 → 买价/修理/锻造单价系数（卖价方向相反，见 quote）。 */
export function resolvePriceMultiplier(value, tiers = REPUTATION_TIERS, enabled = true) {
  if (!enabled) return 1;
  return clamp(num(resolveAttitude(value, tiers).priceMultiplier, 1), 0.01, 10);
}

/**
 * 声望账本 + 价格报价。
 */
export class ReputationSystem {
  /**
   * @param {Object} [options]
   * @param {Object} [options.config] - game.project.json.reputation
   * @param {Function} [options.onEvent] - (event, payload) => void
   * @param {Object} [options.state] - { global?:number, byFaction?:{}, byCity?:{} }
   */
  constructor({ config = null, onEvent = null, state = null } = {}) {
    this.config = { ...DEFAULT_REPUTATION_CONFIG, ...(config || {}) };
    if (!Array.isArray(this.config.tiers) || this.config.tiers.length === 0) {
      this.config.tiers = REPUTATION_TIERS;
    }
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.global = 0;
    /** @type {Map<string, {value:number, updatedAt:number|null}>} */
    this.byFaction = new Map();
    /** @type {Map<string, {value:number, factionId:string|null, updatedAt:number|null}>} */
    this.byCity = new Map();
    if (state) this.restore(state);
  }

  get enabled() {
    return this.config.enabled !== false;
  }

  /** 调整声望：cityId 优先写城池账；否则写势力账；再否则写全局账。 */
  adjust({ factionId = null, cityId = null, delta = 0, reason = null, at = null } = {}) {
    const amount = num(delta, 0);
    if (!Number.isFinite(amount) || amount === 0) {
      return { ok: true, changed: 0, value: this.getValue({ factionId, cityId }) };
    }
    const min = num(this.config.min, -100);
    const max = num(this.config.max, 100);
    const scope = cityId != null ? 'city' : (factionId != null ? 'faction' : 'global');
    const key = cityId != null ? String(cityId) : (factionId != null ? String(factionId) : null);
    let before;
    let after;
    if (scope === 'city') {
      const entry = this.byCity.get(key) || { value: 0, factionId: null, updatedAt: null };
      before = entry.value;
      after = clamp(entry.value + amount, min, max);
      this.byCity.set(key, { value: after, factionId: factionId != null ? String(factionId) : entry.factionId || null, updatedAt: at });
    } else if (scope === 'faction') {
      const entry = this.byFaction.get(key) || { value: 0, updatedAt: null };
      before = entry.value;
      after = clamp(entry.value + amount, min, max);
      this.byFaction.set(key, { value: after, updatedAt: at });
    } else {
      before = this.global;
      after = clamp(this.global + amount, min, max);
      this.global = after;
    }
    const changed = after - before;
    if (changed !== 0) {
      this._emit('reputation.changed', { scope, factionId, cityId, delta: amount, changed, value: after, reason });
    }
    return { ok: true, scope, before, value: after, changed };
  }

  /** 读取声望值：城池 override > 势力 > 全局。 */
  getValue({ factionId = null, cityId = null } = {}) {
    if (cityId != null) {
      const city = this.byCity.get(String(cityId));
      if (city) return city.value;
      const faction = factionId != null ? this.byFaction.get(String(factionId)) : null;
      if (faction) return faction.value;
      return this.global;
    }
    if (factionId != null) {
      const faction = this.byFaction.get(String(factionId));
      if (faction) return faction.value;
      return this.global;
    }
    return this.global;
  }

  getAttitude({ factionId = null, cityId = null } = {}) {
    const value = this.getValue({ factionId, cityId });
    return { ...resolveAttitude(value, this.config.tiers), value };
  }

  /**
   * 报价（R3 城池内四类单价）。
   * - buy/repair/craft/recruit：basePrice × 态度系数，最低 1。
   * - sell：basePrice ÷ 态度系数（高态度卖得更贵），上限 basePrice × sellPriceCap。
   * - 敌对档 refuseTrade=true 时 sell 仍可（回收），buy/repair/craft/recruit 拒绝。
   */
  quote({ kind = 'buy', basePrice = 0, factionId = null, cityId = null } = {}) {
    const base = Math.max(0, num(basePrice, 0));
    const priceKind = REPUTATION_PRICE_KINDS.includes(kind) ? kind : 'buy';
    const attitude = this.getAttitude({ factionId, cityId });
    if (!this.enabled) {
      return { ok: true, kind: priceKind, basePrice: base, price: Math.round(base), multiplier: 1, attitude: { ...attitude, priceMultiplier: 1 }, refused: false };
    }
    if (attitude.refuseTrade === true && priceKind !== 'sell') {
      return { ok: false, code: 'tradeRefused', kind: priceKind, basePrice: base, price: null, multiplier: null, attitude, refused: true };
    }
    const multiplier = clamp(num(attitude.priceMultiplier, 1), 0.01, 10);
    let price;
    if (priceKind === 'sell') {
      const cap = Math.max(1, num(this.config.sellPriceCap, SELL_PRICE_CAP));
      price = Math.min(base * cap, base / multiplier);
    } else if (priceKind === 'recruit') {
      const recruitMultiplier = clamp(num(attitude.recruitMultiplier, 1), 0, 10);
      price = base * (recruitMultiplier > 0 ? (1 / recruitMultiplier) : 1);
    } else {
      price = base * multiplier;
    }
    price = Math.max(1, Math.round(price));
    return {
      ok: true,
      kind: priceKind,
      basePrice: base,
      price,
      multiplier: Number((price / Math.max(1, base)).toFixed(3)),
      attitude,
      refused: false
    };
  }

  /** 招募名额系数（0 = 敌对不可招）。 */
  getRecruitMultiplier({ factionId = null, cityId = null } = {}) {
    if (!this.enabled) return 1;
    const attitude = this.getAttitude({ factionId, cityId });
    return clamp(num(attitude.recruitMultiplier, 1), 0, 10);
  }

  serialize() {
    return {
      schemaVersion: 1,
      global: this.global,
      byFaction: [...this.byFaction.entries()].map(([factionId, entry]) => ({ factionId, ...entry })),
      byCity: [...this.byCity.entries()].map(([cityId, entry]) => ({ cityId, ...entry }))
    };
  }

  /** 旧档兼容：缺字段一律视为 0/空，不报错。 */
  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return { ok: false, code: 'invalidSnapshot' };
    this.global = clamp(num(snapshot.global, 0), num(this.config.min, -100), num(this.config.max, 100));
    this.byFaction.clear();
    this.byCity.clear();
    for (const entry of Array.isArray(snapshot.byFaction) ? snapshot.byFaction : []) {
      if (entry?.factionId == null) continue;
      this.byFaction.set(String(entry.factionId), {
        value: clamp(num(entry.value, 0), num(this.config.min, -100), num(this.config.max, 100)),
        updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : null
      });
    }
    for (const entry of Array.isArray(snapshot.byCity) ? snapshot.byCity : []) {
      if (entry?.cityId == null) continue;
      this.byCity.set(String(entry.cityId), {
        value: clamp(num(entry.value, 0), num(this.config.min, -100), num(this.config.max, 100)),
        factionId: entry.factionId != null ? String(entry.factionId) : null,
        updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : null
      });
    }
    return { ok: true, global: this.global, factions: this.byFaction.size, cities: this.byCity.size };
  }

  toJSON() {
    return clone(this.serialize());
  }

  _emit(event, payload) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event, payload);
    } catch (error) {
      // 事件消费方异常不影响账本
    }
  }
}

export default ReputationSystem;

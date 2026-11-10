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
 * PassTariffSystem - 关隘关税（模块 4 · 4C）
 *
 * 设计依据：.trae/specs/military-supply-strategy/m4-implementation/spec.md §8.3
 *
 * 口径（与城池常规税收严格分离）：
 * 1. 单位进入 `pass` 节点 → `collect`：同阵营免税；中立/他控按 `rate` 计 = cargoValue × rate；
 *    当日累计只写 `armyStates[passId].supply.toll`，不建第二本账。
 * 2. 跨日 → `settle`：把各关隘当日累计税转成 `transfers`（归属方最近城池），并清零累计。
 *    **不直接写 cityStates**——写城由调用方单点执行（防双算），且不并入城池常规税收。
 * 3. 纯数据，不依赖 Blackboard / 场景实体；读态/写态经注入适配器。
 */

export const DEFAULT_TARIFF = Object.freeze({
  rate: 0.05,
  defaultRate: 0.05,
  resource: 'food',
  defaultCargoValue: 100,
  sweepToCity: true
});

function num(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeTariff(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return { ...DEFAULT_TARIFF, ...source };
}

/**
 * 关隘关税系统。
 */
export class PassTariffSystem {
  /**
   * @param {Object} [options]
   * @param {Object|null} [options.tariff] - worldLogic.tariff
   * @param {Function|null} [options.listPasses] - () => armyStates（kind==='pass'）
   * @param {Function|null} [options.getPass] - passId => armyState
   * @param {Function|null} [options.updatePassToll] - (passId, total) => void
   * @param {Function|null} [options.resolveCityForPass] - (passId, ownerFactionId) => cityId|null
   * @param {Function|null} [options.getDay] - () => 游戏日
   * @param {Function|null} [options.onEvent] - (event, payload) => void
   */
  constructor({
    tariff = null,
    listPasses = null,
    getPass = null,
    updatePassToll = null,
    resolveCityForPass = null,
    getDay = null,
    onEvent = null
  } = {}) {
    this.config = mergeTariff(tariff);
    this.listPasses = typeof listPasses === 'function' ? listPasses : (() => []);
    this.getPass = typeof getPass === 'function' ? getPass : null;
    this.updatePassToll = typeof updatePassToll === 'function' ? updatePassToll : null;
    this.resolveCityForPass = typeof resolveCityForPass === 'function' ? resolveCityForPass : null;
    this.getDay = typeof getDay === 'function' ? getDay : (() => 1);
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    /** @type {number} 已完成日结的最大游戏日 */
    this.lastSettledDay = 0;
  }

  /**
   * 进入关隘计税。累计写 `supply.toll`（唯一累计点）。
   * @param {Object} input - { passId, moverFactionId, ownerFactionId, cargoValue, rate, day }
   * @returns {{ok:boolean, code?:string, exempt?:boolean, rate?:number, tax?:number, toll?:number}}
   */
  collect({
    passId = null,
    moverFactionId = null,
    ownerFactionId = null,
    cargoValue = null,
    rate = null,
    day = null
  } = {}) {
    if (passId == null) return { ok: false, code: 'passRequired' };
    const id = String(passId);
    const mover = moverFactionId != null ? String(moverFactionId) : '';
    const owner = ownerFactionId != null ? String(ownerFactionId) : '';

    if (mover && owner && mover === owner) {
      const toll = this._readToll(id);
      return { ok: true, exempt: true, rate: 0, tax: 0, toll };
    }

    const resolvedRate = Math.max(
      0,
      num(rate, num(this.config.defaultRate, num(this.config.rate, 0.05)))
    );
    const value = Math.max(0, num(cargoValue, num(this.config.defaultCargoValue, 100)));
    const tax = Math.floor(value * resolvedRate);
    const nextToll = this._readToll(id) + tax;
    if (tax > 0) this._writeToll(id, nextToll);
    this._emit('pass.tariffCollected', {
      passId: id,
      moverFactionId: moverFactionId ?? null,
      ownerFactionId: ownerFactionId ?? null,
      rate: resolvedRate,
      cargoValue: value,
      tax,
      toll: nextToll,
      day: day != null ? num(day, 1) : this.getDay()
    });
    return { ok: true, exempt: false, rate: resolvedRate, tax, toll: nextToll };
  }

  /**
   * 日结：累计税 → 归属方最近城池。返回 `transfers` 供调用方单点写城。
   * 找不到归属城池的关隘保留累计（不清零），下次日结继续尝试。
   * @param {Object} [input] - { day }
   * @returns {{ok:boolean, day:number, transfers:Array, pending:Array, total:number, skipped?:string}}
   */
  settle({ day = null } = {}) {
    const currentDay = Math.max(1, Math.floor(num(day, this.getDay())));
    if (this.lastSettledDay >= currentDay) {
      return { ok: true, day: currentDay, transfers: [], pending: [], total: 0, skipped: 'alreadySettled' };
    }
    const resource = String(this.config.resource || 'food');
    const transfers = [];
    const pending = [];
    let total = 0;

    const listed = this.listPasses();
    const passes = Array.isArray(listed) ? listed : [];
    for (const pass of passes) {
      if (!pass || pass.kind !== 'pass') continue;
      const passId = String(pass.id ?? '');
      if (!passId) continue;
      const toll = this._readToll(passId);
      if (toll <= 0) continue;
      const cityId = this.resolveCityForPass
        ? this.resolveCityForPass(passId, pass.factionId ?? null)
        : null;
      if (!cityId) {
        pending.push({ passId, ownerFactionId: pass.factionId ?? null, amount: toll });
        continue;
      }
      transfers.push({
        passId,
        cityId: String(cityId),
        ownerFactionId: pass.factionId ?? null,
        resource,
        amount: toll
      });
      total += toll;
      this._writeToll(passId, 0);
    }

    this.lastSettledDay = currentDay;
    if (transfers.length > 0) {
      this._emit('pass.tariffSettled', { day: currentDay, transfers, total });
    }
    return { ok: true, day: currentDay, transfers, pending, total };
  }

  serialize() {
    return { lastSettledDay: this.lastSettledDay };
  }

  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const day = Math.max(0, Math.floor(num(snapshot.lastSettledDay, 0)));
    this.lastSettledDay = day;
  }

  _readToll(passId) {
    const pass = this.getPass ? this.getPass(passId) : null;
    return Math.max(0, Math.floor(num(pass?.supply?.toll, 0)));
  }

  _writeToll(passId, total) {
    if (this.updatePassToll) this.updatePassToll(passId, Math.max(0, Math.floor(total)));
  }

  _emit(event, payload) {
    if (typeof this.onEvent === 'function') this.onEvent(event, payload);
  }
}

export default PassTariffSystem;

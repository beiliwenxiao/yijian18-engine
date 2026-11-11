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
 * WarLogisticsAdapters - 军需体系（M6/M7/M9）的纯适配器工厂。
 *
 * 设计依据：.trae/documents/军需接线与UI批次-实施计划.md 批次 1。
 * 目标：把 ArmyOrderSystem / 黑板 / FoodLedgerSystem 之间的形状转换收敛成纯函数，
 * 场景装配器只做接线，适配逻辑可单测。
 */

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function toNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

/** ArmyOrderSystem 单位 → FoodLedgerSystem 军团账本形状。 */
export function toLogisticsArmy(unit) {
  if (!unit || unit.id == null) return null;
  return {
    id: String(unit.id),
    roster: clone(unit.roster) || {},
    morale: toNumber(unit.morale, undefined),
    manpower: toNumber(unit.manpower, undefined),
    initialManpower: toNumber(unit.initialManpower, undefined),
    factionId: unit.factionId ?? unit.faction ?? null,
    control: unit.control ?? (unit.ai === true ? 'ai' : null),
    ai: unit.ai === true,
    supply: clone(unit.supply) || {}
  };
}

/**
 * 军团账本适配器：从 ArmyOrderSystem 读初始编制，结算后把 supply/morale/manpower 回写。
 *
 * @param {Object} options
 * @param {Function} [options.listUnits] - () => 单位数组
 * @param {Function} [options.getUnit] - (id) => 单位
 * @param {Function} [options.writeUnit] - (id, patch) => void
 */
export function createArmyLogisticsAdapter({ listUnits = null, getUnit = null, writeUnit = null } = {}) {
  const readUnits = () => (typeof listUnits === 'function' ? listUnits() || [] : []);
  const findUnit = id => {
    if (typeof getUnit === 'function') return getUnit(id) || null;
    const key = String(id);
    return readUnits().find(unit => unit && String(unit.id) === key) || null;
  };

  return {
    /** 只取行军/军团单位（kind === 'army'）。 */
    listArmies() {
      return readUnits()
        .filter(unit => unit && unit.kind === 'army')
        .map(toLogisticsArmy)
        .filter(Boolean);
    },
    readArmy(armyId) {
      const unit = findUnit(armyId);
      return unit ? toLogisticsArmy(unit) : null;
    },
    /** 把账本状态回写到行军单位（只同步展示/结算字段，不复制库存）。 */
    writeArmy(armyId, army) {
      const unit = findUnit(armyId);
      if (!unit || !army) return false;
      const patch = {
        supply: clone(army.supply) || {},
        morale: clamp(toNumber(army.morale, unit.morale ?? 0), 0, 100),
        manpower: Math.max(
          0,
          Math.floor(toNumber(army.manpower, unit.manpower ?? 0))
        )
      };
      const initial = toNumber(army.initialManpower, unit.initialManpower);
      if (initial !== undefined) patch.initialManpower = Math.max(patch.manpower, Math.floor(initial));
      if (typeof writeUnit === 'function') writeUnit(armyId, patch);
      else Object.assign(unit, patch);
      return true;
    }
  };
}

/**
 * 自动输送适配器（M9 遗留的 AI aiSupplyEfficiency 落点）。
 *
 * 规则：玩家军团 1:1 送达；AI 军团按 `aiSupplyEfficiency` 乘算后向下取整。
 * 判定顺序：显式 `isAiArmy(army)` → `army.control === 'ai'` → `army.ai === true`。
 *
 * @param {Object} options
 * @param {Function} [options.resolveArmy] - (armyId) => army
 * @param {Function} [options.isAiArmy] - (army) => boolean
 * @param {number} [options.aiSupplyEfficiency] - 0..1
 */
export function createAutoResupplyAdapter({
  resolveArmy = null,
  isAiArmy = null,
  aiSupplyEfficiency = 1
} = {}) {
  const efficiency = clamp(toNumber(aiSupplyEfficiency, 1), 0, 1);
  return (armyId, need) => {
    const required = Math.max(0, toNumber(need, 0));
    if (required <= 0) return 0;
    const army = typeof resolveArmy === 'function' ? resolveArmy(armyId) : null;
    if (!army) return 0;
    const ai = typeof isAiArmy === 'function'
      ? isAiArmy(army) === true
      : army.control === 'ai' || army.ai === true;
    return Math.floor(ai ? required * efficiency : required);
  };
}

/**
 * 城池/战果适配器合集：把「配置里可选的读写函数」与「装配器默认实现」合并。
 * 任何一项缺省都返回安全空实现，避免调用方判空。
 */
export function createCityWarAdapters({
  readCities = null,
  commitCities = null,
  readArmy = null,
  writeArmy = null,
  readWarState = null,
  writeWarState = null
} = {}) {
  return {
    readCities: () => clone(typeof readCities === 'function' ? readCities() : []) || [],
    commitCities: cities => (typeof commitCities === 'function' ? commitCities(clone(cities)) : false),
    readArmy: armyId => (typeof readArmy === 'function' ? readArmy(armyId) : null),
    writeArmy: (armyId, army) => (typeof writeArmy === 'function' ? writeArmy(armyId, clone(army)) : false),
    readLedger: battleId => {
      if (typeof readWarState !== 'function') return null;
      const warState = readWarState() || {};
      const ledgers = warState.battleLedgers || {};
      return clone(ledgers[battleId]) || null;
    },
    writeLedger: (battleId, ledger) => {
      if (typeof readWarState !== 'function' || typeof writeWarState !== 'function') return false;
      const warState = clone(readWarState()) || {};
      warState.battleLedgers = { ...(warState.battleLedgers || {}), [battleId]: clone(ledger) };
      writeWarState(warState);
      return true;
    }
  };
}

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
 * BattleSettlementService - 战败 / 逃亡两本账（模块 6 · 6D）
 *
 * 设计依据：.trae/specs/military-supply-strategy/06-battle-plan-intervene.md §5.4 / §5.5 / §6 / §12
 *
 * 只做领域结算，不依赖 Blackboard：army 记录与 battleLedger 通过注入适配器读写
 * （readArmy/writeArmy/readLedger/writeLedger/addScattered），不传适配器时直接作用于传入的
 * army 对象——便于单测与后续场景接线。
 *
 * 约束（与设计文档逐条对应）：
 * 1. 战败与逃亡是**两个独立事件**：各记各账，不互相折算；同一 battleId 的同一事件只记一次。
 * 2. 士气阶梯线性 + 硬封顶：战败 -min(moraleCap, step×n)，逃亡 -min(moraleCap, step×n)。
 * 3. 减兵/丢辎重为事件型一次性：随机比例取 battleId 哈希种子，读档重放结果一致。
 * 4. 兵力地板 manpowerFloorRatio（默认 0.30）：触地板只丢辎重、不再减兵。
 * 5. 洗刷（redemption）定稿 hybrid：白名单主将走 army.redeem，其余可同军团胜利自动洗刷一次。
 */

/** 两类事件（顺序即结算优先级）。 */
export const BATTLE_LEDGER_EVENTS = Object.freeze(['defeat', 'fled']);

/** 缺省参数（06 §6；game.project.json.battleIntervene 可覆盖）。 */
export const DEFAULT_BATTLE_INTERVENE = Object.freeze({
  commanderKilled: Object.freeze({ moralePenalty: 10 }),
  commanderFled: Object.freeze({
    moraleLadder: Object.freeze([5, 10, 15]),
    moraleCap: 30,
    reputationPenalty: -6,
    fledWindowDays: 30,
    resetOnCommanderChange: true
  }),
  battleLedger: Object.freeze({
    defeat: Object.freeze({
      moraleStep: 10,
      moraleCap: 60,
      resetOnVictory: true,
      decayDays: 30,
      troopLossRatio: Object.freeze({ min: 0.08, max: 0.18, default: 0.12 }),
      scatterPoolRatio: 0.6,
      supplyLossRatio: Object.freeze({ min: 0.20, max: 0.40, default: 0.30 })
    }),
    fled: Object.freeze({
      troopLossRatio: Object.freeze({ min: 0.05, max: 0.12, default: 0.08 }),
      scatterPoolRatio: 0.8,
      supplyLossRatio: Object.freeze({ min: 0.15, max: 0.30, default: 0.20 })
    }),
    manpowerFloorRatio: 0.30,
    recoverWindowSec: 600,
    recoverRatio: 0.5,
    recoverChance: 0.6
  }),
  redemption: Object.freeze({
    mode: 'hybrid',
    moraleGain: 8,
    reputationGain: 3,
    fledWindowDays: 30,
    storyHeroes: Object.freeze(['hero.zhangjiao']),
    autoOnVictory: true
  })
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
  const ledger = source.battleLedger || {};
  const defeat = ledger.defeat || {};
  const fled = ledger.fled || {};
  return {
    commanderKilled: { ...DEFAULT_BATTLE_INTERVENE.commanderKilled, ...(source.commanderKilled || {}) },
    commanderFled: {
      ...DEFAULT_BATTLE_INTERVENE.commanderFled,
      ...(source.commanderFled || {}),
      moraleLadder: Array.isArray(source.commanderFled?.moraleLadder)
        ? source.commanderFled.moraleLadder.map(entry => Math.max(0, num(entry, 0)))
        : [...DEFAULT_BATTLE_INTERVENE.commanderFled.moraleLadder]
    },
    battleLedger: {
      defeat: {
        ...DEFAULT_BATTLE_INTERVENE.battleLedger.defeat,
        ...defeat,
        troopLossRatio: { ...DEFAULT_BATTLE_INTERVENE.battleLedger.defeat.troopLossRatio, ...(defeat.troopLossRatio || {}) },
        supplyLossRatio: { ...DEFAULT_BATTLE_INTERVENE.battleLedger.defeat.supplyLossRatio, ...(defeat.supplyLossRatio || {}) }
      },
      fled: {
        ...DEFAULT_BATTLE_INTERVENE.battleLedger.fled,
        ...fled,
        troopLossRatio: { ...DEFAULT_BATTLE_INTERVENE.battleLedger.fled.troopLossRatio, ...(fled.troopLossRatio || {}) },
        supplyLossRatio: { ...DEFAULT_BATTLE_INTERVENE.battleLedger.fled.supplyLossRatio, ...(fled.supplyLossRatio || {}) }
      },
      manpowerFloorRatio: num(ledger.manpowerFloorRatio, DEFAULT_BATTLE_INTERVENE.battleLedger.manpowerFloorRatio),
      recoverWindowSec: num(ledger.recoverWindowSec, DEFAULT_BATTLE_INTERVENE.battleLedger.recoverWindowSec),
      recoverRatio: num(ledger.recoverRatio, DEFAULT_BATTLE_INTERVENE.battleLedger.recoverRatio),
      recoverChance: num(ledger.recoverChance, DEFAULT_BATTLE_INTERVENE.battleLedger.recoverChance)
    },
    redemption: {
      ...DEFAULT_BATTLE_INTERVENE.redemption,
      ...(source.redemption || {}),
      storyHeroes: Array.isArray(source.redemption?.storyHeroes)
        ? source.redemption.storyHeroes.map(String)
        : [...DEFAULT_BATTLE_INTERVENE.redemption.storyHeroes]
    }
  };
}

/** 以 battleId + 用途为种子的确定性随机 [0,1)（读档重放一致）。 */
export function seededRand(seedText, salt = '') {
  const seed = `${seedText}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 区间比例：min~max 之间按 rng 线性取值。 */
function ratioInRange(range, rng = Math.random) {
  const min = num(range?.min, 0);
  const max = num(range?.max, min);
  const fallback = num(range?.default, (min + max) / 2);
  if (max <= min) return clamp(fallback, 0, 1);
  return clamp(min + (max - min) * clamp(rng(), 0, 1), 0, 1);
}

/** 战败士气阶梯：-min(cap, step×连续次数)。 */
export function resolveDefeatMoralePenalty(streakCount, config = DEFAULT_BATTLE_INTERVENE.battleLedger.defeat) {
  const step = Math.max(0, num(config?.moraleStep, 10));
  const cap = Math.max(0, num(config?.moraleCap, 60));
  return Math.min(cap, step * Math.max(0, Math.floor(num(streakCount, 0))));
}

/** 逃亡士气阶梯：ladder[n-1]，超出取 cap（默认 -5/-10/-15，封顶 -30）。 */
export function resolveFledMoralePenalty(streakCount, config = DEFAULT_BATTLE_INTERVENE.commanderFled) {
  const ladder = Array.isArray(config?.moraleLadder) ? config.moraleLadder : [5, 10, 15];
  const cap = Math.max(0, num(config?.moraleCap, 30));
  const index = Math.max(0, Math.floor(num(streakCount, 0)) - 1);
  const value = index < ladder.length
    ? num(ladder[index], ladder[ladder.length - 1])
    : cap;
  return Math.min(cap, Math.max(0, value));
}

function sumRoster(roster) {
  if (!roster || typeof roster !== 'object') return 0;
  if (Array.isArray(roster.unitIds)) return roster.unitIds.length;
  let total = 0;
  for (const value of Object.values(roster)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) total += parsed;
  }
  return Math.floor(total);
}

function normalizeSupply(supply) {
  if (!supply || typeof supply !== 'object' || Array.isArray(supply)) return {};
  const next = {};
  for (const [key, value] of Object.entries(supply)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) next[key] = parsed;
  }
  return next;
}

function daysBetween(fromAt, toAt) {
  const from = Number(fromAt);
  const to = Number(toAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / 86400000);
}

/**
 * 战败 / 逃亡事件结算 + 洗刷 + 辎重追回。
 */
export class BattleSettlementService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.config] - game.project.json.battleIntervene
   * @param {Function} [options.now] - () => 毫秒
   * @param {Function} [options.getDay] - () => 游戏日
   * @param {Function} [options.rng] - () => [0,1)（缺省走 battleId 种子）
   * @param {Object|null} [options.readArmy] - armyId => ArmyState
   * @param {Function|null} [options.writeArmy] - (armyId, army) => void
   * @param {Function|null} [options.readLedger] - battleId => ledger|null
   * @param {Function|null} [options.writeLedger] - (battleId, ledger) => void
   * @param {Function|null} [options.addScattered] - ({ armyId, battleId, count, day }) => void
   * @param {Function|null} [options.addSupplyCache] - ({ armyId, battleId, resources, expiresAt })
   * @param {Function|null} [options.adjustReputation] - ({ factionId, cityId, delta, reason }) => void
   * @param {Function|null} [options.onEvent] - (event, payload) => void
   */
  constructor({
    config = null,
    now = null,
    getDay = null,
    rng = null,
    readArmy = null,
    writeArmy = null,
    readLedger = null,
    writeLedger = null,
    addScattered = null,
    addSupplyCache = null,
    adjustReputation = null,
    onEvent = null
  } = {}) {
    this.config = mergeConfig(config);
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this.getDay = typeof getDay === 'function' ? getDay : (() => 1);
    this.rng = typeof rng === 'function' ? rng : null;
    this.readArmy = typeof readArmy === 'function' ? readArmy : null;
    this.writeArmy = typeof writeArmy === 'function' ? writeArmy : null;
    this.readLedger = typeof readLedger === 'function' ? readLedger : null;
    this.writeLedger = typeof writeLedger === 'function' ? writeLedger : null;
    this.addScattered = typeof addScattered === 'function' ? addScattered : null;
    this.addSupplyCache = typeof addSupplyCache === 'function' ? addSupplyCache : null;
    this.adjustReputation = typeof adjustReputation === 'function' ? adjustReputation : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    /** @type {Map<string, Object>} battleId → ledger（无外部适配器时本地持有） */
    this.ledgers = new Map();
    /** @type {Map<string, Object>} cacheId → supplyCache（无外部适配器时本地持有） */
    this.supplyCaches = new Map();
  }

  // ─── 主入口：settleBattle ────────────────────────────────

  /**
   * 结算一个战斗事件（战败 / 逃亡）。
   * @param {Object} input
   * @param {string} input.battleId
   * @param {'defeat'|'fled'} input.event
   * @param {Object} [input.army] - 直接传入 ArmyState（无 readArmy 适配器时使用）
   * @param {string} [input.armyId]
   * @param {number} [input.initialManpower] - 初始编制（兵力地板基准），缺省取 army.manpower
   * @param {number} [input.day]
   * @returns {Object} { ok, idempotent, ledger, morale, lostTroops, lostSupply, scattered, cache }
   */
  settleBattle({
    battleId = null,
    event = null,
    army = null,
    armyId = null,
    initialManpower = null,
    day = null
  } = {}) {
    const battleKey = battleId != null ? String(battleId) : '';
    if (!battleKey) return { ok: false, code: 'battleIdRequired' };
    if (!BATTLE_LEDGER_EVENTS.includes(event)) return { ok: false, code: 'unknownEvent', event };

    const target = army || (armyId != null && this.readArmy ? this.readArmy(String(armyId)) : null);
    const resolvedArmyId = target?.id != null ? String(target.id) : (armyId != null ? String(armyId) : null);
    if (!target || !resolvedArmyId) return { ok: false, code: 'unknownArmy', armyId };

    const ledger = clone(this._loadLedger(battleKey)) || { battleId: battleKey, events: {} };
    ledger.events = ledger.events && typeof ledger.events === 'object' ? ledger.events : {};
    if (ledger.events[event]?.applied) {
      return { ok: true, idempotent: true, battleId: battleKey, armyId: resolvedArmyId, ledger: clone(ledger) };
    }

    const currentDay = day != null ? num(day, this.getDay()) : this.getDay();
    const at = this.now();
    const streak = this._normalizeStreak(target.streak);
    this._decayStreak(streak, event, at);
    const previousValue = event === 'defeat' ? streak.defeat : streak.fled;
    const count = previousValue + 1;
    if (event === 'defeat') {
      streak.defeat = count;
      streak.defeatLastAt = at;
    } else {
      streak.fled = count;
      streak.fledLastAt = at;
    }

    const moraleBefore = clamp(num(target.morale, 80), 0, 100);
    const moralePenalty = event === 'defeat'
      ? resolveDefeatMoralePenalty(count, this.config.battleLedger.defeat)
      : resolveFledMoralePenalty(count, this.config.commanderFled);
    const morale = clamp(moraleBefore - moralePenalty, 0, 100);
    target.morale = morale;
    target.streak = streak;

    const manpower = Math.max(0, Math.floor(num(target.manpower, sumRoster(target.roster))));
    const floorBase = Math.max(manpower, Math.floor(num(initialManpower, manpower)));
    const floor = Math.floor(floorBase * clamp(num(this.config.battleLedger.manpowerFloorRatio, 0.3), 0, 1));
    const eventConfig = this.config.battleLedger[event] || {};
    const troopRatio = ratioInRange(eventConfig.troopLossRatio, () => this._rand(battleKey, 'troopLoss'));
    let lostTroops = Math.round(manpower * troopRatio);
    let floorReached = false;
    if (manpower - lostTroops < floor) {
      lostTroops = Math.max(0, manpower - floor);
      floorReached = manpower <= floor;
    }
    if (manpower - lostTroops <= 0 && floor > 0) lostTroops = Math.max(0, manpower - floor);
    const remainingManpower = Math.max(floor, manpower - lostTroops);
    target.manpower = remainingManpower;
    if (target.roster && typeof target.roster === 'object' && !Array.isArray(target.roster.unitIds)) {
      const rosterTotal = sumRoster(target.roster);
      if (rosterTotal > 0 && remainingManpower < rosterTotal) {
        const ratio = remainingManpower / rosterTotal;
        const nextRoster = {};
        for (const [key, value] of Object.entries(target.roster)) {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) {
            nextRoster[key] = value;
            continue;
          }
          nextRoster[key] = Math.max(0, Math.floor(parsed * ratio));
        }
        target.roster = nextRoster;
      }
    } else if (target.roster && Array.isArray(target.roster.unitIds) && remainingManpower < target.roster.unitIds.length) {
      target.roster = {
        ...target.roster,
        unitIds: target.roster.unitIds.slice(0, remainingManpower)
      };
    }

    const scatteredCount = Math.floor(lostTroops * clamp(num(eventConfig.scatterPoolRatio, 0), 0, 1));
    if (scatteredCount > 0 && this.addScattered) {
      this.addScattered({
        armyId: resolvedArmyId,
        battleId: battleKey,
        count: scatteredCount,
        day: currentDay,
        event
      });
    }

    const supplyRatio = ratioInRange(eventConfig.supplyLossRatio, () => this._rand(battleKey, 'supplyLoss'));
    const supplyBefore = normalizeSupply(target.supply);
    const lostSupply = {};
    const remainingSupply = {};
    for (const [resource, amount] of Object.entries(supplyBefore)) {
      const lost = Math.min(amount, Math.round(amount * supplyRatio));
      if (lost > 0) lostSupply[resource] = lost;
      const left = amount - lost;
      if (left > 0) remainingSupply[resource] = left;
    }
    target.supply = remainingSupply;
    let cache = null;
    if (Object.keys(lostSupply).length > 0) {
      const cacheId = `supplyCache.${battleKey}.${event}`;
      cache = {
        cacheId,
        armyId: resolvedArmyId,
        battleId: battleKey,
        event,
        resources: { ...lostSupply },
        createdAt: at,
        expiresAt: at + Math.max(0, num(this.config.battleLedger.recoverWindowSec, 600)) * 1000,
        recovered: false
      };
      // 本地副本始终保留（recoverSupply/listSupplyCaches 用）；外部适配器同步一份
      this.supplyCaches.set(cacheId, cache);
      if (this.addSupplyCache) {
        try {
          this.addSupplyCache(clone(cache));
        } catch (error) {
          // 缓存写入失败不影响账本结算
        }
      }
    }

    const previousMorale = moraleBefore;
    if (event === 'fled') {
      const record = {
        armyId: resolvedArmyId,
        battleId: battleKey,
        at,
        count,
        moraleBefore: previousMorale,
        redeemed: false,
        commanderHeroId: target.commanderHeroId != null ? String(target.commanderHeroId) : null
      };
      target.fledRecord = Array.isArray(target.fledRecord) ? [...target.fledRecord, record].slice(-50) : [record];
    }

    ledger.events[event] = {
      applied: true,
      at,
      day: currentDay,
      count,
      moraleApplied: moralePenalty,
      moraleBefore: previousMorale,
      lostTroops,
      lostSupply: { ...lostSupply },
      scattered: scatteredCount,
      cacheId: cache?.cacheId || null,
      floorReached
    };
    ledger.troopsApplied = (num(ledger.troopsApplied, 0) || 0) + lostTroops;
    ledger.supplyApplied = Object.keys(lostSupply).length > 0;
    ledger.at = at;
    this._saveLedger(battleKey, ledger);
    if (this.writeArmy && !army) this.writeArmy(resolvedArmyId, target);

    const payload = {
      armyId: resolvedArmyId,
      battleId: battleKey,
      event,
      morale,
      moralePenalty,
      lostTroops,
      lostSupply: { ...lostSupply },
      scattered: scatteredCount,
      floorReached,
      count
    };
    this._emit(event === 'defeat' ? 'army.defeated' : 'army.commanderFled', payload);
    return {
      ok: true,
      idempotent: false,
      battleId: battleKey,
      armyId: resolvedArmyId,
      ledger: clone(ledger),
      morale,
      moralePenalty,
      lostTroops,
      remainingManpower,
      lostSupply,
      scattered: scatteredCount,
      cache: clone(cache),
      floorReached
    };
  }

  /**
   * 主将阵亡：一次性士气惩罚（与战败/逃亡两条阶梯互不折算）。
   * 同一 battleId 只记一次（写在 ledger.events.commanderKilled）。
   */
  applyCommanderKilled({ battleId = null, army = null, armyId = null } = {}) {
    const battleKey = battleId != null ? String(battleId) : '';
    if (!battleKey) return { ok: false, code: 'battleIdRequired' };
    const target = army || (armyId != null && this.readArmy ? this.readArmy(String(armyId)) : null);
    const resolvedArmyId = target?.id != null ? String(target.id) : (armyId != null ? String(armyId) : null);
    if (!target || !resolvedArmyId) return { ok: false, code: 'unknownArmy', armyId };
    const ledger = clone(this._loadLedger(battleKey)) || { battleId: battleKey, events: {} };
    ledger.events = ledger.events && typeof ledger.events === 'object' ? ledger.events : {};
    if (ledger.events.commanderKilled?.applied) {
      return { ok: true, idempotent: true, morale: clamp(num(target.morale, 80), 0, 100) };
    }
    const penalty = Math.max(0, num(this.config.commanderKilled.moralePenalty, 10));
    const morale = clamp(num(target.morale, 80) - penalty, 0, 100);
    target.morale = morale;
    ledger.events.commanderKilled = { applied: true, at: this.now(), moraleApplied: penalty };
    this._saveLedger(battleKey, ledger);
    if (this.writeArmy && !army) this.writeArmy(resolvedArmyId, target);
    this._emit('army.commanderKilled', { armyId: resolvedArmyId, battleId: battleKey, morale, moralePenalty: penalty });
    return { ok: true, idempotent: false, morale, moralePenalty: penalty };
  }

  /** 打胜：清零连续战败（resetOnVictory），军团层账本单点。 */
  applyVictory({ army = null, armyId = null, battleId = null } = {}) {
    const target = army || (armyId != null && this.readArmy ? this.readArmy(String(armyId)) : null);
    if (!target) return { ok: false, code: 'unknownArmy', armyId };
    if (this.config.battleLedger.defeat.resetOnVictory !== true) return { ok: true, skipped: true };
    const streak = this._normalizeStreak(target.streak);
    const cleared = streak.defeat;
    streak.defeat = 0;
    streak.defeatLastAt = null;
    target.streak = streak;
    if (this.writeArmy && !army) this.writeArmy(String(target.id), target);
    const redemption = this.autoRedeemOnVictory({ army: target, battleId });
    return { ok: true, cleared, redemption };
  }

  /**
   * 洗刷污点（§12.3 hybrid）。
   * - mode:'story' → 全部走剧情；'auto' → 全部自动；'hybrid' → 白名单走剧情、其余自动。
   * - `force:true` 表示剧情命令 army.redeem 调用，白名单外也受理。
   * - 每份污点只回补一次；只把连续逃亡计数 -1；士气/声望回补不超过逃亡前值。
   */
  redeem({ army = null, armyId = null, heroId = null, day = null, force = false } = {}) {
    const target = army || (armyId != null && this.readArmy ? this.readArmy(String(armyId)) : null);
    if (!target) return { ok: false, code: 'unknownArmy', armyId };
    const commanderHeroId = heroId != null
      ? String(heroId)
      : (target.commanderHeroId != null ? String(target.commanderHeroId) : null);
    const mode = String(this.config.redemption.mode || 'hybrid');
    const whitelisted = commanderHeroId != null
      && this.config.redemption.storyHeroes.includes(commanderHeroId);
    const requiresStory = mode === 'story' || (mode === 'hybrid' && whitelisted);
    if (requiresStory && !force) {
      return { ok: false, code: 'storyRedeemRequired', heroId: commanderHeroId, mode };
    }
    const records = Array.isArray(target.fledRecord) ? target.fledRecord : [];
    const index = records.findIndex(record => record && record.redeemed !== true);
    if (index < 0) return { ok: false, code: 'noStigma' };
    const currentDay = day != null ? num(day, this.getDay()) : this.getDay();
    const record = { ...records[index] };
    const windowDays = Math.max(0, num(this.config.redemption.fledWindowDays, 30));
    const ageDays = daysBetween(record.at, this.now());
    if (windowDays > 0 && ageDays > windowDays) {
      return { ok: false, code: 'stigmaExpired', ageDays, windowDays };
    }
    const moraleGain = Math.max(0, num(this.config.redemption.moraleGain, 8));
    const before = clamp(num(record.moraleBefore, num(target.morale, 80)), 0, 100);
    const currentMorale = clamp(num(target.morale, 80), 0, 100);
    const restored = Math.min(moraleGain, Math.max(0, before - currentMorale));
    target.morale = clamp(currentMorale + restored, 0, 100);
    record.redeemed = true;
    record.redeemedAt = this.now();
    record.redeemedDay = currentDay;
    records[index] = record;
    target.fledRecord = records;
    const streak = this._normalizeStreak(target.streak);
    streak.fled = Math.max(0, streak.fled - 1);
    target.streak = streak;
    const reputationGain = Math.max(0, num(this.config.redemption.reputationGain, 3));
    if (reputationGain > 0 && this.adjustReputation) {
      try {
        this.adjustReputation({
          factionId: target.factionId != null ? String(target.factionId) : null,
          delta: reputationGain,
          reason: 'army.redeem'
        });
      } catch (error) {
        // 声望写入失败不影响洗刷主体
      }
    }
    if (this.writeArmy && !army) this.writeArmy(String(target.id), target);
    const payload = {
      armyId: target.id != null ? String(target.id) : (armyId != null ? String(armyId) : null),
      heroId: commanderHeroId,
      moraleRestored: restored,
      morale: target.morale,
      reputationGain,
      fled: streak.fled
    };
    this._emit('army.redeemed', payload);
    return { ok: true, ...payload };
  }

  /** hybrid/auto 下同军团下一场胜利自动洗刷一次（白名单仍走剧情）。 */
  autoRedeemOnVictory({ army = null, armyId = null, battleId = null } = {}) {
    const redemption = this.config.redemption;
    const mode = String(redemption.mode || 'hybrid');
    if (mode === 'story' || redemption.autoOnVictory === false) return { ok: true, skipped: true };
    const target = army || (armyId != null && this.readArmy ? this.readArmy(String(armyId)) : null);
    if (!target) return { ok: false, code: 'unknownArmy', armyId };
    if (mode === 'hybrid') {
      const commanderHeroId = target.commanderHeroId != null ? String(target.commanderHeroId) : null;
      if (commanderHeroId && redemption.storyHeroes.includes(commanderHeroId)) {
        return { ok: true, skipped: true, code: 'storyRedeemRequired', heroId: commanderHeroId };
      }
    }
    return this.redeem({ army: target, battleId });
  }

  /** 追回丢失辎重（§5.5：窗口内 + 概率 + 比例）。 */
  recoverSupply({ cacheId = null, army = null, armyId = null } = {}) {
    const cache = cacheId != null ? this.supplyCaches.get(String(cacheId)) : null;
    if (!cache) return { ok: false, code: 'cacheMissing', cacheId };
    if (cache.recovered) return { ok: false, code: 'alreadyRecovered', cacheId };
    if (this.now() > num(cache.expiresAt, Infinity)) {
      this.supplyCaches.delete(String(cacheId));
      return { ok: false, code: 'cacheExpired', cacheId };
    }
    const chance = clamp(num(this.config.battleLedger.recoverChance, 0.6), 0, 1);
    const roll = this._rand(String(cache.battleId), 'supplyRecover');
    if (roll > chance) return { ok: false, code: 'recoverFailed', cacheId, roll };
    const target = army || (armyId != null && this.readArmy ? this.readArmy(String(armyId)) : null);
    if (!target) return { ok: false, code: 'unknownArmy', armyId };
    const ratio = clamp(num(this.config.battleLedger.recoverRatio, 0.5), 0, 1);
    const recovered = {};
    const nextSupply = { ...normalizeSupply(target.supply) };
    for (const [resource, amount] of Object.entries(cache.resources || {})) {
      const value = Math.max(0, Math.round(num(amount, 0) * ratio));
      if (value <= 0) continue;
      recovered[resource] = value;
      nextSupply[resource] = (nextSupply[resource] || 0) + value;
    }
    target.supply = nextSupply;
    cache.recovered = true;
    cache.recoveredAt = this.now();
    if (this.writeArmy && !army) this.writeArmy(String(target.id), target);
    this._emit('army.supplyRecovered', { armyId: target.id, cacheId: String(cacheId), recovered });
    return { ok: true, cacheId: String(cacheId), recovered };
  }

  /** 列出未回收的辎重缓存（UI/追回入口用）。 */
  listSupplyCaches({ armyId = null } = {}) {
    return [...this.supplyCaches.values()]
      .filter(cache => cache && cache.recovered !== true)
      .filter(cache => armyId == null || String(cache.armyId) === String(armyId))
      .map(cache => clone(cache));
  }

  getLedger(battleId) {
    return clone(this._loadLedger(String(battleId || '')));
  }

  serialize() {
    return {
      schemaVersion: 1,
      ledgers: [...this.ledgers.entries()].map(([battleId, ledger]) => ({ battleId, ledger: clone(ledger) })),
      supplyCaches: [...this.supplyCaches.values()].map(cache => clone(cache))
    };
  }

  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || snapshot.schemaVersion !== 1) {
      return { ok: false, code: 'invalidSnapshot' };
    }
    this.ledgers.clear();
    this.supplyCaches.clear();
    for (const entry of Array.isArray(snapshot.ledgers) ? snapshot.ledgers : []) {
      if (entry?.battleId) this.ledgers.set(String(entry.battleId), clone(entry.ledger) || {});
    }
    for (const cache of Array.isArray(snapshot.supplyCaches) ? snapshot.supplyCaches : []) {
      if (cache?.cacheId) this.supplyCaches.set(String(cache.cacheId), clone(cache));
    }
    return { ok: true, ledgers: this.ledgers.size, caches: this.supplyCaches.size };
  }

  // ─── 内部工具 ────────────────────────────────────────────

  _rand(battleId, salt) {
    return this.rng ? clamp(this.rng(), 0, 1) : seededRand(battleId, salt);
  }

  _loadLedger(battleId) {
    if (this.readLedger) {
      try {
        return this.readLedger(battleId) || null;
      } catch (error) {
        return null;
      }
    }
    return this.ledgers.get(battleId) || null;
  }

  _saveLedger(battleId, ledger) {
    if (this.writeLedger) {
      try {
        this.writeLedger(battleId, ledger);
      } catch (error) {
        // 外部账本写入失败时仍保留本地副本，避免幂等失效
      }
    }
    this.ledgers.set(battleId, clone(ledger));
  }

  _normalizeStreak(streak) {
    const source = streak && typeof streak === 'object' ? streak : {};
    return {
      defeat: Math.max(0, Math.floor(num(source.defeat, 0))),
      defeatLastAt: Number.isFinite(Number(source.defeatLastAt)) ? Number(source.defeatLastAt) : null,
      fled: Math.max(0, Math.floor(num(source.fled, 0))),
      fledLastAt: Number.isFinite(Number(source.fledLastAt)) ? Number(source.fledLastAt) : null
    };
  }

  /** 连续计数衰减：战败每 decayDays 天 -1；逃亡超 fledWindowDays 清零。 */
  _decayStreak(streak, event, at) {
    if (event === 'defeat') {
      const decayDays = Math.max(0, num(this.config.battleLedger.defeat.decayDays, 30));
      if (decayDays > 0 && streak.defeat > 0 && streak.defeatLastAt != null) {
        const elapsed = daysBetween(streak.defeatLastAt, at);
        const decay = Math.floor(elapsed / decayDays);
        if (decay > 0) streak.defeat = Math.max(0, streak.defeat - decay);
      }
      return;
    }
    const windowDays = Math.max(0, num(this.config.commanderFled.fledWindowDays, 30));
    if (windowDays > 0 && streak.fled > 0 && streak.fledLastAt != null) {
      if (daysBetween(streak.fledLastAt, at) > windowDays) streak.fled = 0;
    }
  }

  _emit(event, payload) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event, payload);
    } catch (error) {
      // 事件消费方异常不影响结算
    }
  }
}

export default BattleSettlementService;

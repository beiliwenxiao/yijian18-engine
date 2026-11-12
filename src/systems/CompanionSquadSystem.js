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
 * CompanionSquadSystem - 随行小队（模块 3 层级二，3A）
 *
 * 设计依据：.trae/specs/military-supply-strategy/03-army-squads.md §4.1 / §4.2 / §5.2
 *
 * 职责（纯领域，不依赖 Blackboard/场景实体）：
 * - 随行上限：floor((统率 command + 官职 rankValue) / 2)，封顶 100（10×10 网格）
 * - 五档指令：跟随 escort / 进攻 assault / 防守 hold / 冲锋 charge / 撤退 retreat
 *   —— 姿态本体仍由 ArmyCommandSystem 姿态机执行，本系统只持有"玩家档位"并做冲锋倒计时
 * - 小队层士气：初值（从军镜像 / 征召 60）、阵亡 -2/人（单场封顶 -10）、胜利 +5、
 *   逃亡 -5、休整 +3/日、驻扎 +2/日（同日取高）、连续 3 日未休整 -3/日、clamp [5, 100]
 * - 低士气惩罚：< 10 锁定防守档、拒绝冲锋档
 * - 阵亡补位：扣统兵池 1 兵，约 8 秒后从入场点跑入补位（兵源枯竭则中断）
 * - 玩家倒地：自动转防守护主，起立后恢复原档
 *
 * 场景侧（SceneCompanionSquadFlow）负责：实体注册、姿态转发、补位生成、storyState 读写。
 */

/** 随行小队五档（玩家唯一操作；模块 3 §4.2）。 */
export const COMPANION_STANCES = Object.freeze([
  { key: 'escort', label: '跟随' },
  { key: 'assault', label: '进攻' },
  { key: 'hold', label: '防守' },
  { key: 'charge', label: '冲锋' },
  { key: 'retreat', label: '撤退' }
]);

/** 随行小队在 ArmyCommandSystem 中的 armyId（整体一队，无分队）。 */
export const COMPANION_ARMY_ID = 'companion';

/**
 * B5 亲卫上限唯一口径：floor((统率 + 官职值) / 2)，封顶 100。
 * 旧写法 `10 + floor(command/10)`（封顶 80）作废；需要兼容读的场景直接调本函数。
 * @param {{command?:number, rankValue?:number, capacityMax?:number}} values
 * @returns {number}
 */
export function resolveCompanionCapacity({ command = 0, rankValue = 0, capacityMax = 100 } = {}) {
  const cap = Number.isFinite(Number(capacityMax))
    ? Math.max(1, Math.min(100, Math.floor(Number(capacityMax))))
    : 100;
  const commandValue = Math.max(0, Math.floor(Number(command) || 0));
  const rankValueNumber = Math.max(0, Math.floor(Number(rankValue) || 0));
  return Math.max(0, Math.min(Math.floor((commandValue + rankValueNumber) / 2), cap));
}

const STANCE_KEYS = new Set(COMPANION_STANCES.map(stance => stance.key));

const DEFAULT_MORALE_RULE = Object.freeze({
  initial: 60,
  deathPenalty: 2,
  deathCapPerBattle: 10,
  victoryBonus: 5,
  fleePenalty: 5,
  restBonus: 3,
  campBonus: 2,
  idleDaysBeforeDecay: 3,
  decayPerDay: 3,
  floor: 5,
  ceiling: 100,
  lowThreshold: 10
});

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/** 成员姓氏首字（HUD 方格用）：取 id 最后一段的首字符。 */
function initialOf(unitId) {
  const segments = String(unitId || '').split(/[.:_\-/]/).filter(Boolean);
  const tail = segments[segments.length - 1] || String(unitId || '');
  return tail.slice(0, 1) || '兵';
}

export class CompanionSquadSystem {
  /**
   * @param {Object} [options]
   * @param {Object} [options.rule] - game.project.json.companionRule（缺省取内置默认）
   * @param {Function} [options.now] - 挂钟注入（ms），测试可注入
   * @param {Function} [options.getCommand] - 统率值提供器（heroes[].stats.command）
   * @param {Function} [options.getRankValue] - 官职值提供器（ranks[].value / storyState.playerRank.value）
   * @param {Function} [options.spawnMember] - 补位生成回调 (unitId, entry) => boolean
   * @param {Function} [options.onEvent] - 事件回调 (event, payload) => void
   */
  constructor({
    rule = {},
    now = () => Date.now(),
    getCommand = () => 0,
    getRankValue = () => 0,
    spawnMember = null,
    onEvent = null
  } = {}) {
    this.rule = {
      reinforceDelayMs: Math.max(0, Math.floor(Number(rule.reinforceDelayMs) || 8000)),
      chargeDurationMs: Math.max(0, Math.floor(Number(rule.chargeDurationMs) || 4000)),
      capacityMax: clampNumber(Math.floor(Number(rule.capacityMax) || 100), 1, 100),
      morale: { ...DEFAULT_MORALE_RULE, ...(rule.morale || {}) }
    };
    this.now = now;
    this.getCommand = typeof getCommand === 'function' ? getCommand : () => 0;
    this.getRankValue = typeof getRankValue === 'function' ? getRankValue : () => 0;
    this.spawnMember = typeof spawnMember === 'function' ? spawnMember : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};

    /** @type {string[]} 成员 unitId（整体一队，无分队） */
    this.unitIds = [];
    /** @type {Map<string, {state:'active'|'downed'|'dead', hpRatio:number, downedAt:number|null}>} */
    this.members = new Map();
    this.stance = 'escort';
    this.morale = this.rule.morale.initial;
    this.moraleLedger = {
      lastRestDay: null,
      lossThisFight: 0,
      lastBattleId: null,
      lastVictoryBattleId: null,
      lastDecayDay: null,
      dayBonus: {}
    };
    /** @type {{troops:number, cap:number, replenishFrom:string[]}} */
    this.armyPool = { troops: 0, cap: 0, replenishFrom: [] };
    /** @type {Array<{unitId:string, readyAt:number}>} */
    this.reinforcements = [];
    this.chargeRemainingMs = 0;
    this._stanceBeforeDowned = null;
    this._downed = false;
    this._startDay = null;
  }

  // ─── 容量 ────────────────────────────────────────────────

  /** 随行上限 = floor((统率 + 官职) / 2)，封顶 100（模块 3 §4.1；唯一口径）。 */
  getCapacity() {
    return resolveCompanionCapacity({
      command: this.getCommand(),
      rankValue: this.getRankValue(),
      capacityMax: this.rule.capacityMax
    });
  }

  /** 当前成员数（含倒地未补位；阵亡待补位仍占位）。 */
  getMemberCount() {
    return this.unitIds.length;
  }

  // ─── 名册 ────────────────────────────────────────────────

  /**
   * 设置名册（招募/读档恢复共用）。超出上限时拒绝（不静默截断）。
   * @param {Object} options
   * @param {string[]} [options.unitIds]
   * @param {number} [options.morale] - 初始士气（从军=来源军团士气；征召=60）
   * @param {Object} [options.armyPool]
   * @param {number} [options.day]
   * @returns {{ok:boolean, code?:string, capacity?:number, count?:number}}
   */
  setRoster({ unitIds = [], morale = null, armyPool = null, day = null } = {}) {
    const ids = [...new Set((Array.isArray(unitIds) ? unitIds : []).map(id => String(id || '')).filter(Boolean))];
    const capacity = this.getCapacity();
    if (ids.length > capacity) {
      return { ok: false, code: 'capacityExceeded', capacity, count: ids.length };
    }
    this.unitIds = ids;
    this.members = new Map(ids.map(id => [id, { state: 'active', hpRatio: 1, downedAt: null }]));
    if (morale != null) this.morale = this._clampMorale(morale);
    if (armyPool) {
      this.armyPool = {
        troops: Math.max(0, Math.floor(Number(armyPool.troops) || 0)),
        cap: Math.max(0, Math.floor(Number(armyPool.cap) || 0)),
        replenishFrom: Array.isArray(armyPool.replenishFrom) ? [...armyPool.replenishFrom] : []
      };
    }
    if (day != null && this._startDay == null) this._startDay = Math.floor(Number(day) || 0);
    this._applyMoraleLock();
    return { ok: true, capacity, count: this.unitIds.length };
  }

  /** 追加成员（招募/从军团抽人入随行）；超上限拒绝。 */
  assign(unitIds = [], { morale = null } = {}) {
    const incoming = (Array.isArray(unitIds) ? unitIds : [unitIds])
      .map(id => String(id || ''))
      .filter(id => id && !this.members.has(id));
    const capacity = this.getCapacity();
    if (this.unitIds.length + incoming.length > capacity) {
      return { ok: false, code: 'capacityExceeded', capacity, count: this.unitIds.length + incoming.length };
    }
    for (const id of incoming) {
      this.unitIds.push(id);
      this.members.set(id, { state: 'active', hpRatio: 1, downedAt: null });
    }
    if (morale != null && this.unitIds.length === incoming.length) this.morale = this._clampMorale(morale);
    this._applyMoraleLock();
    return { ok: true, capacity, count: this.unitIds.length };
  }

  /** 遣返成员（移出名册）。 */
  dismiss(unitIds = []) {
    const removing = new Set((Array.isArray(unitIds) ? unitIds : [unitIds]).map(id => String(id || '')));
    const before = this.unitIds.length;
    this.unitIds = this.unitIds.filter(id => !removing.has(id));
    for (const id of removing) this.members.delete(id);
    this.reinforcements = this.reinforcements.filter(entry => !removing.has(entry.unitId));
    return { ok: true, removed: before - this.unitIds.length, count: this.unitIds.length };
  }

  getMembers() {
    return this.unitIds.map(id => ({ unitId: id, ...(this.members.get(id) || { state: 'active', hpRatio: 1, downedAt: null }) }));
  }

  // ─── 五档 ────────────────────────────────────────────────

  /** 士气 < 阈值时锁定非防守档（模块 3 §4.1 低士气惩罚）。 */
  isStanceLocked(stanceKey) {
    return this.morale < this.rule.morale.lowThreshold && stanceKey !== 'hold';
  }

  /**
   * 切档（玩家唯一操作）。冲锋档进入 4s 倒计时，结束后自动转进攻。
   * @returns {{ok:boolean, code?:string, stance?:string}}
   */
  setStance(stanceKey) {
    const key = String(stanceKey || '');
    if (!STANCE_KEYS.has(key)) return { ok: false, code: 'unknownStance' };
    if (this.isStanceLocked(key)) return { ok: false, code: 'moraleLocked', stance: this.stance };
    return this._setStanceInternal(key);
  }

  _setStanceInternal(stanceKey) {
    const before = this.stance;
    this.stance = stanceKey;
    this.chargeRemainingMs = stanceKey === 'charge' ? this.rule.chargeDurationMs : 0;
    if (before !== stanceKey) {
      this._emit('companion.stanceChanged', { from: before, to: stanceKey, morale: this.morale });
    }
    return { ok: true, stance: stanceKey };
  }

  getStance() { return this.stance; }

  // ─── 士气 ────────────────────────────────────────────────

  _clampMorale(value) {
    return clampNumber(Number(value) || 0, this.rule.morale.floor, this.rule.morale.ceiling);
  }

  _applyMoraleLock() {
    if (this.morale < this.rule.morale.lowThreshold && this.stance !== 'hold') {
      this._setStanceInternal('hold');
      return true;
    }
    return false;
  }

  _changeMorale(delta, reason) {
    const before = this.morale;
    this.morale = this._clampMorale(this.morale + delta);
    const changed = this.morale !== before;
    if (changed) this._emit('companion.moraleChanged', { before, after: this.morale, delta: this.morale - before, reason });
    this._applyMoraleLock();
    return this.morale;
  }

  /**
   * 亲卫阵亡：-2/人（单场封顶 -10），并登记补位（扣统兵池 1 兵，8s 后入场）。
   * @param {string} unitId
   * @param {{battleId?:string, hpRatio?:number}} [options]
   */
  reportMemberDowned(unitId, { battleId = null, hpRatio = 0 } = {}) {
    const id = String(unitId || '');
    if (!id) return { ok: false, code: 'unknownUnit' };
    const member = this.members.get(id) || { state: 'active', hpRatio: 1, downedAt: null };
    member.state = 'downed';
    member.hpRatio = clampNumber(Number(hpRatio) || 0, 0, 1);
    member.downedAt = this.now();
    this.members.set(id, member);

    const ledger = this.moraleLedger;
    if (battleId && ledger.lastBattleId !== battleId) {
      ledger.lastBattleId = battleId;
      ledger.lossThisFight = 0;
    }
    const applied = this._applyDeathPenalty();
    if (applied > 0) this._changeMorale(-applied, 'memberDowned');

    if (this.armyPool.troops > 0) {
      this.armyPool.troops -= 1;
      this.reinforcements.push({ unitId: id, readyAt: this.now() + this.rule.reinforceDelayMs });
    } else {
      this._emit('companion.replenishBlocked', { unitId: id, reason: 'troopPoolEmpty' });
    }
    this._emit('companion.memberDowned', { unitId: id, morale: this.morale, battleId });
    return { ok: true, morale: this.morale, locked: this.morale < this.rule.morale.lowThreshold };
  }

  /** 阵亡（永久退场，不补位）。 */
  reportMemberKilled(unitId, { battleId = null } = {}) {
    const id = String(unitId || '');
    if (!id) return { ok: false, code: 'unknownUnit' };
    const member = this.members.get(id) || { state: 'active', hpRatio: 1, downedAt: null };
    member.state = 'dead';
    member.hpRatio = 0;
    this.members.set(id, member);
    this.reinforcements = this.reinforcements.filter(entry => entry.unitId !== id);
    const ledger = this.moraleLedger;
    if (battleId && ledger.lastBattleId !== battleId) {
      ledger.lastBattleId = battleId;
      ledger.lossThisFight = 0;
    }
    const applied = this._applyDeathPenalty();
    if (applied > 0) this._changeMorale(-applied, 'memberKilled');
    return { ok: true, morale: this.morale };
  }

  /**
   * 单场阵亡扣士气：-deathPenalty/人，累计逼近 deathCapPerBattle 时截断。
   * @returns {number} 本次实际扣除值（0 = 本场已封顶）
   * @private
   */
  _applyDeathPenalty() {
    const ledger = this.moraleLedger;
    const remaining = this.rule.morale.deathCapPerBattle - ledger.lossThisFight;
    if (remaining <= 0) return 0;
    const applied = Math.min(this.rule.morale.deathPenalty, remaining);
    ledger.lossThisFight += applied;
    return applied;
  }

  /** 战斗胜利 +5（同一 battleId 幂等）。 */
  reportBattleResult({ battleId = null, victory = false } = {}) {
    if (!victory) return { ok: true, morale: this.morale, applied: false };
    if (battleId && this.moraleLedger.lastVictoryBattleId === battleId) {
      return { ok: true, morale: this.morale, applied: false, idempotent: true };
    }
    if (battleId) this.moraleLedger.lastVictoryBattleId = battleId;
    this._changeMorale(this.rule.morale.victoryBonus, 'victory');
    return { ok: true, morale: this.morale, applied: true };
  }

  /** 玩家亲自逃亡 -5。 */
  reportPlayerFlee() {
    this._changeMorale(-this.rule.morale.fleePenalty, 'playerFlee');
    return { ok: true, morale: this.morale };
  }

  /** 休整 +3/日（同日不重复）。 */
  rest(day = null) {
    const targetDay = this._resolveDay(day);
    return this._applyDailyBonus(targetDay, this.rule.morale.restBonus, 'rest', true);
  }

  /** 军营驻扎 +2/日（与休整同日取高，不叠乘）。 */
  camp(day = null) {
    const targetDay = this._resolveDay(day);
    return this._applyDailyBonus(targetDay, this.rule.morale.campBonus, 'camp', false);
  }

  _resolveDay(day) {
    return day == null ? Math.floor(this.now() / 86400000) : Math.floor(Number(day) || 0);
  }

  _applyDailyBonus(day, amount, reason, resetsIdle) {
    const ledger = this.moraleLedger;
    const bonus = ledger.dayBonus || (ledger.dayBonus = {});
    const current = Number(bonus[day]) || 0;
    if (amount <= current) return { ok: true, morale: this.morale, applied: false, idempotent: true };
    bonus[day] = amount;
    this._changeMorale(amount - current, reason);
    if (resetsIdle) ledger.lastRestDay = day;
    return { ok: true, morale: this.morale, applied: true };
  }

  /**
   * 日切：连续 idleDaysBeforeDecay 日未休整，-decayPerDay/日（同日幂等）。
   * @param {number} day
   */
  onDayChanged(day) {
    const targetDay = Math.floor(Number(day) || 0);
    if (this._startDay == null) this._startDay = targetDay;
    const ledger = this.moraleLedger;
    const lastRest = ledger.lastRestDay == null ? this._startDay : ledger.lastRestDay;
    const idleDays = targetDay - lastRest;
    if (idleDays < this.rule.morale.idleDaysBeforeDecay) return { ok: true, morale: this.morale, decayed: false };
    if (ledger.lastDecayDay === targetDay) return { ok: true, morale: this.morale, decayed: false, idempotent: true };
    ledger.lastDecayDay = targetDay;
    this._changeMorale(-this.rule.morale.decayPerDay, 'idleDecay');
    return { ok: true, morale: this.morale, decayed: true };
  }

  // ─── 玩家倒地护主 ────────────────────────────────────────

  /** 玩家倒地 → 自动防守护主；起立 → 恢复原档（低士气/非法档回退跟随）。 */
  setPlayerDowned(downed) {
    const next = downed === true;
    if (next === this._downed) return { ok: true, changed: false, stance: this.stance };
    this._downed = next;
    if (next) {
      this._stanceBeforeDowned = this.stance;
      this._setStanceInternal('hold');
    } else {
      const restore = this._stanceBeforeDowned && STANCE_KEYS.has(this._stanceBeforeDowned)
        && !this.isStanceLocked(this._stanceBeforeDowned)
        ? this._stanceBeforeDowned
        : 'escort';
      this._stanceBeforeDowned = null;
      this._setStanceInternal(restore);
    }
    return { ok: true, changed: true, stance: this.stance };
  }

  // ─── 帧推进 ──────────────────────────────────────────────

  /**
   * 帧更新：冲锋 4s → 进攻；补位计时到期触发 spawnMember。
   * @param {number} deltaTime - 毫秒
   * @returns {{chargeConverted:boolean, reinforced:string[]}}
   */
  tick(deltaTime = 0) {
    const dt = Math.max(0, Number(deltaTime) || 0);
    let chargeConverted = false;
    if (this.stance === 'charge' && this.chargeRemainingMs > 0) {
      this.chargeRemainingMs = Math.max(0, this.chargeRemainingMs - dt);
      if (this.chargeRemainingMs === 0) {
        this._setStanceInternal('assault');
        chargeConverted = true;
      }
    }
    const reinforced = [];
    if (this.reinforcements.length > 0) {
      const now = this.now();
      const pending = [];
      for (const entry of this.reinforcements) {
        if (entry.readyAt > now) { pending.push(entry); continue; }
        const member = this.members.get(entry.unitId);
        if (!member || member.state === 'dead') continue;
        const spawned = this.spawnMember ? this.spawnMember(entry.unitId, entry) !== false : true;
        if (!spawned) { pending.push(entry); continue; }
        member.state = 'active';
        member.hpRatio = 1;
        member.downedAt = null;
        this.members.set(entry.unitId, member);
        reinforced.push(entry.unitId);
        this._emit('companion.memberReinforced', { unitId: entry.unitId });
      }
      this.reinforcements = pending;
    }
    return { chargeConverted, reinforced };
  }

  // ─── 快照 ────────────────────────────────────────────────

  /** HUD 消费的快照。 */
  getSnapshot() {
    const members = this.unitIds.map(id => {
      const member = this.members.get(id) || { state: 'active', hpRatio: 1, downedAt: null };
      return {
        unitId: id,
        initial: initialOf(id),
        state: member.state,
        hpRatio: member.hpRatio
      };
    });
    return {
      capacity: this.getCapacity(),
      memberCount: members.length,
      stance: this.stance,
      morale: this.morale,
      moraleLocked: this.morale < this.rule.morale.lowThreshold,
      members
    };
  }

  /** 入档快照（storyState.companionSquad）。 */
  serialize() {
    return {
      unitIds: [...this.unitIds],
      stance: this.stance,
      morale: this.morale,
      moraleLedger: clone(this.moraleLedger),
      armyPool: clone(this.armyPool),
      members: this.unitIds.map(id => ({ unitId: id, ...(this.members.get(id) || { state: 'active', hpRatio: 1 }) })),
      startDay: this._startDay
    };
  }

  /** 读档恢复（幂等；非法输入返回失败，不改现有状态）。 */
  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.unitIds)) return { ok: false, code: 'invalidSnapshot' };
    this.unitIds = [...new Set(snapshot.unitIds.map(id => String(id || '')).filter(Boolean))];
    this.members = new Map(this.unitIds.map(id => [id, { state: 'active', hpRatio: 1, downedAt: null }]));
    for (const entry of Array.isArray(snapshot.members) ? snapshot.members : []) {
      const member = this.members.get(String(entry?.unitId || ''));
      if (!member) continue;
      member.state = ['active', 'downed', 'dead'].includes(entry.state) ? entry.state : 'active';
      member.hpRatio = clampNumber(Number(entry.hpRatio) || 0, 0, 1);
    }
    this.stance = STANCE_KEYS.has(snapshot.stance) ? snapshot.stance : 'escort';
    this.morale = this._clampMorale(snapshot.morale);
    this.moraleLedger = {
      lastRestDay: null,
      lossThisFight: 0,
      lastBattleId: null,
      lastVictoryBattleId: null,
      lastDecayDay: null,
      dayBonus: {},
      ...(clone(snapshot.moraleLedger) || {})
    };
    if (snapshot.armyPool) {
      this.armyPool = {
        troops: Math.max(0, Math.floor(Number(snapshot.armyPool.troops) || 0)),
        cap: Math.max(0, Math.floor(Number(snapshot.armyPool.cap) || 0)),
        replenishFrom: Array.isArray(snapshot.armyPool.replenishFrom) ? [...snapshot.armyPool.replenishFrom] : []
      };
    }
    this.reinforcements = [];
    this.chargeRemainingMs = 0;
    this._startDay = Number.isFinite(Number(snapshot.startDay)) ? Number(snapshot.startDay) : null;
    this._downed = false;
    this._stanceBeforeDowned = null;
    this._applyMoraleLock();
    return { ok: true };
  }

  _emit(event, payload) {
    try {
      this.onEvent(event, payload);
    } catch (error) {
      /* 事件订阅方异常不影响领域状态 */
    }
  }
}

export default CompanionSquadSystem;

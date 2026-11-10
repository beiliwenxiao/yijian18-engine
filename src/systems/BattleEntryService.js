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
 * BattleEntryService - 三种入场身份与进退战斗（模块 6 · 6C）
 *
 * 设计依据：06-battle-plan-intervene.md §3（三种入场身份）与 §5.3（边界确认）。
 *
 * 职责边界：只做**身份判定 + 进出计划 + 边界判据 + 会话账**，不直接改场景：
 *   - joinBattle 返回 `plan`（possess / enterBattle / spawnSupportSquad / attachAura），由场景执行器落地；
 *   - leaveBattle 返回 `effects`（是否需要逃亡结算 / 声望扣减 / 释放主控），由调用方转交
 *     BattleSettlementService / ReputationSystem；
 *   - 同一 battleId 的身份、支援次数、逃亡后不可再接管都记在会话账里，可序列化进 checkpoint。
 *
 * 关键规则（逐条对应文档）：
 *   1. 身份只有三种：takeover（接管，兼容旧值 'command'）/ support（支援）/ observe（旁观）。
 *   2. 「接管」每场 1 次；逃亡/阵亡后不可再次接管，但可「支援」（若还未用完）。
 *   3. 「支援」必须本人抵达（在场/相邻 1 格），每场限 1 次；离开/倒地即用完；不算逃亡。
 *   4. 现场接管时越过战场边界 = 逃亡，必须先确认；未确认则位置被夹在边界内。
 *   5. 部署调整权限不看身份，只看 `battle.status === 'PRE_BATTLE'`；
 *      将令（stance/focus/retreat）仅 takeover 受理。
 */

export const BATTLE_IDENTITIES = Object.freeze(['takeover', 'support', 'observe']);

export const BATTLE_LEAVE_REASONS = Object.freeze([
  'commanderFled',
  'commanderKilled',
  'supportLeft',
  'leftScene',
  'battleEnded'
]);

/** 允许调整部署的战斗状态（未接战）。 */
export const DEPLOYMENT_OPEN_STATUS = 'PRE_BATTLE';

/** 旧值 'command' 兼容别名（第七次拍板）。 */
export function normalizeIdentity(identity) {
  const value = identity == null ? '' : String(identity);
  if (value === 'command') return 'takeover';
  if (BATTLE_IDENTITIES.includes(value)) return value;
  return null;
}

/** 是否允许发布将令（姿态/集火/撤退）：仅接管身份。 */
export function canIssueBattleOrder(identity) {
  return normalizeIdentity(identity) === 'takeover';
}

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

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const left = num(bounds.left ?? bounds.x, null);
  const top = num(bounds.top ?? bounds.y, null);
  const right = num(bounds.right, null);
  const bottom = num(bounds.bottom, null);
  const width = num(bounds.width, right != null && left != null ? right - left : null);
  const height = num(bounds.height, bottom != null && top != null ? bottom - top : null);
  if (left == null || top == null || width == null || height == null) return null;
  return { left, top, right: left + width, bottom: top + height };
}

/**
 * 会话账 + 身份判定。
 */
export class BattleEntryService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.config] - game.project.json.battleIntervene（support/边界参数）
   * @param {Function} [options.now] - () => 毫秒
   * @param {Function} [options.onEvent] - (event, payload) => void
   */
  constructor({ config = null, now = null, onEvent = null } = {}) {
    const source = config && typeof config === 'object' ? config : {};
    this.config = {
      boundaryConfirm: source.boundaryConfirm !== false,
      boundaryPadding: num(source.boundaryPadding, 0),
      supportRangeCells: num(source.supportRangeCells, 1)
    };
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    /** @type {Map<string, Object>} battleId → session */
    this.sessions = new Map();
  }

  /**
   * 进入战斗。
   * @param {Object} input
   * @param {string} input.battleId
   * @param {string} [input.armyId]
   * @param {'takeover'|'support'|'observe'|'command'} [input.identity]
   * @param {'onsite'|'remote'} [input.mode] - takeover 可用；support 只能 onsite
   * @param {'ui'|'story'} [input.entry]
   * @param {boolean} [input.playerOnsite] - 玩家本体是否在战场
   * @param {boolean} [input.arrived] - 支援是否已抵达（同场景/相邻 1 格）
   * @param {string} [input.commanderHeroId]
   * @param {string|null} [input.battleStatus] - PRE_BATTLE / DEPLOYED / ASSAIGNED
   * @param {boolean} [input.previewDefeated] - 预演已判负只能收容残部
   * @returns {Object} { ok, code?, identity, plan?, session }
   */
  joinBattle({
    battleId = null,
    armyId = null,
    identity = 'observe',
    mode = null,
    entry = 'ui',
    playerOnsite = false,
    arrived = false,
    commanderHeroId = null,
    battleStatus = null,
    previewDefeated = false
  } = {}) {
    const battleKey = battleId != null ? String(battleId) : '';
    if (!battleKey) return { ok: false, code: 'battleIdRequired' };
    const normalized = normalizeIdentity(identity);
    if (!normalized) return { ok: false, code: 'unknownIdentity', identity };

    const existing = this.sessions.get(battleKey) || null;
    if (existing && existing.rejoinForbidden === true && normalized === 'takeover') {
      return { ok: false, code: 'rejoinForbidden', identity: normalized, session: clone(existing) };
    }
    if (existing && existing.identity === normalized && existing.status === 'joined') {
      return { ok: true, code: 'alreadyJoined', idempotent: true, identity: normalized, session: clone(existing) };
    }
    if (normalized === 'support' && existing?.supportUsed === true) {
      return { ok: false, code: 'supportUsed', identity: normalized, session: clone(existing) };
    }
    if (previewDefeated === true && normalized !== 'observe') {
      return { ok: false, code: 'previewDefeated', identity: normalized };
    }

    const resolvedMode = normalized === 'support'
      ? 'onsite'
      : (normalized === 'takeover' && mode === 'onsite' && playerOnsite ? 'onsite' : 'remote');
    if (normalized === 'support' && !(playerOnsite && arrived)) {
      return { ok: false, code: 'supportMustArriveInPerson', identity: normalized };
    }
    if (normalized === 'takeover' && resolvedMode === 'onsite' && !playerOnsite) {
      return { ok: false, code: 'onsiteRequiresPlayer', identity: normalized };
    }

    const session = existing && existing.identity === normalized
      ? { ...existing }
      : {
          battleId: battleKey,
          armyId: armyId != null ? String(armyId) : null,
          identity: normalized,
          mode: resolvedMode,
          entry: String(entry || 'ui'),
          commanderHeroId: commanderHeroId != null ? String(commanderHeroId) : null,
          joinedAt: this.now(),
          status: 'joined',
          supportUsed: existing?.supportUsed === true,
          rejoinForbidden: existing?.rejoinForbidden === true,
          takeovers: Math.max(0, Math.floor(num(existing?.takeovers, 0)))
        };
    if (normalized === 'takeover') {
      session.mode = resolvedMode;
      session.takeovers += 1;
    }
    if (normalized === 'support') session.supportUsed = true;
    this.sessions.set(battleKey, session);

    const plan = this._buildPlan(session);
    this._emit('battle.join', { battleId: battleKey, identity: normalized, mode: session.mode, entry: session.entry, plan });
    return { ok: true, identity: normalized, mode: session.mode, plan, session: clone(session) };
  }

  /**
   * 离开战斗（UI 撤离 / 主将阵亡 / 支援离场 / 离开场景 / 战斗结束）。
   * @returns {Object} { ok, code?, effects }
   */
  leaveBattle({ battleId = null, reason = 'battleEnded', confirmed = false, playerOnsite = false } = {}) {
    const battleKey = battleId != null ? String(battleId) : '';
    if (!battleKey) return { ok: false, code: 'battleIdRequired' };
    if (!BATTLE_LEAVE_REASONS.includes(reason)) return { ok: false, code: 'unknownReason', reason };
    const session = this.sessions.get(battleKey);
    if (!session) return { ok: false, code: 'notInBattle', battleId: battleKey };

    // 现场接管越过边界 = 逃亡：必须先确认（§5.3）
    if (reason === 'leftScene' && session.identity === 'takeover' && session.mode === 'onsite'
      && this.config.boundaryConfirm && confirmed !== true) {
      return { ok: false, code: 'boundaryConfirmRequired', battleId: battleKey, session: clone(session) };
    }

    const next = { ...session };
    const effects = {
      settlementEvent: null,
      reputationPenalty: 0,
      releasePossess: false,
      transferToPreview: false,
      canRejoin: true,
      supportEnded: false
    };
    switch (reason) {
      case 'commanderFled':
        next.status = 'fled';
        next.rejoinForbidden = true;
        effects.settlementEvent = 'fled';
        effects.reputationPenalty = -6;
        effects.releasePossess = session.mode === 'remote';
        effects.transferToPreview = true;
        effects.canRejoin = false;
        break;
      case 'leftScene':
        // 现场接管离开场景 = 逃亡
        if (session.identity === 'takeover' && session.mode === 'onsite') {
          next.status = 'fled';
          next.rejoinForbidden = true;
          effects.settlementEvent = 'fled';
          effects.reputationPenalty = -6;
          effects.transferToPreview = true;
          effects.canRejoin = false;
        } else {
          next.status = 'left';
        }
        break;
      case 'commanderKilled':
        next.status = 'killed';
        next.rejoinForbidden = true;
        effects.moraleEvent = 'commanderKilled';
        effects.transferToPreview = true;
        effects.canRejoin = false;
        break;
      case 'supportLeft':
        next.status = 'left';
        effects.supportEnded = true;
        effects.canRejoin = session.identity !== 'support';
        break;
      case 'battleEnded':
      default:
        next.status = 'ended';
        break;
    }
    if (session.identity === 'support' && reason !== 'supportLeft' && reason !== 'battleEnded') {
      effects.supportEnded = true;
    }
    this.sessions.set(battleKey, next);
    this._emit('battle.leave', { battleId: battleKey, reason, identity: session.identity, effects });
    return { ok: true, reason, identity: session.identity, effects, session: clone(next) };
  }

  /**
   * 边界判定（现场接管）：未确认则夹回边界内。
   * @returns {Object} { inside, confirmRequired, allowLeave, position, code? }
   */
  boundaryCheck({ battleId = null, position = null, bounds = null, padding = null } = {}) {
    const session = battleId != null ? this.sessions.get(String(battleId)) : null;
    if (session && session.identity !== 'takeover') {
      return { inside: true, confirmRequired: false, allowLeave: true, position: clone(position), code: 'notTakeover' };
    }
    if (session && session.mode !== 'onsite') {
      return { inside: true, confirmRequired: false, allowLeave: true, position: clone(position), code: 'remote' };
    }
    const rect = normalizeBounds(bounds);
    if (!rect || !position || typeof position !== 'object') {
      return { inside: true, confirmRequired: false, allowLeave: true, position: clone(position) };
    }
    const pad = Math.max(0, num(padding, this.config.boundaryPadding));
    const left = rect.left - pad;
    const top = rect.top - pad;
    const right = rect.right + pad;
    const bottom = rect.bottom + pad;
    const x = num(position.x, left);
    const y = num(position.y, top);
    const inside = x >= left && x <= right && y >= top && y <= bottom;
    if (inside) {
      return { inside: true, confirmRequired: false, allowLeave: false, position: { ...position, x, y } };
    }
    if (this.config.boundaryConfirm === false) {
      return { inside: false, confirmRequired: false, allowLeave: true, position: { ...position, x, y } };
    }
    const clampedX = clamp(x, left, right);
    const clampedY = clamp(y, top, bottom);
    return {
      inside: false,
      confirmRequired: true,
      allowLeave: false,
      position: { ...position, x: clampedX, y: clampedY },
      code: 'boundaryConfirmRequired'
    };
  }

  getSession(battleId) {
    const session = this.sessions.get(String(battleId || ''));
    return session ? clone(session) : null;
  }

  getIdentity(battleId) {
    return this.sessions.get(String(battleId || ''))?.identity || null;
  }

  /** 当前是否可发将令（仅 takeover 且会话仍在战斗中）。 */
  canIssueBattleOrder(battleId) {
    const session = this.sessions.get(String(battleId || ''));
    return Boolean(session && session.status === 'joined' && canIssueBattleOrder(session.identity));
  }

  /** 部署调整判据：只看战斗状态，不看身份（v4.4 定稿）。 */
  canAdjustDeployment({ battleStatus = null } = {}) {
    const status = battleStatus == null ? '' : String(battleStatus);
    return status === '' || status === DEPLOYMENT_OPEN_STATUS;
  }

  serialize() {
    return {
      schemaVersion: 1,
      sessions: [...this.sessions.values()].map(session => clone(session))
    };
  }

  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || snapshot.schemaVersion !== 1) {
      return { ok: false, code: 'invalidSnapshot' };
    }
    this.sessions.clear();
    for (const session of Array.isArray(snapshot.sessions) ? snapshot.sessions : []) {
      if (session?.battleId) this.sessions.set(String(session.battleId), clone(session));
    }
    return { ok: true, sessions: this.sessions.size };
  }

  _buildPlan(session) {
    switch (session.identity) {
      case 'takeover':
        return {
          possess: session.mode === 'remote' ? { armyId: session.armyId, heroId: session.commanderHeroId } : null,
          enterBattle: { mode: 'INTERVENE', source: session.mode },
          commander: { heroId: session.commanderHeroId, controlled: true },
          attachAura: true,
          deployment: { editable: true, lockAt: 'DEPLOYED' }
        };
      case 'support':
        return {
          possess: null,
          enterBattle: { mode: 'INTERVENE', source: 'onsite' },
          spawnSupportSquad: { armyId: session.armyId, independent: true },
          commander: { heroId: session.commanderHeroId, controlled: false, aiTakeover: true },
          attachAura: true,
          battleOrders: false
        };
      default:
        return {
          possess: null,
          enterBattle: { mode: 'OBSERVE' },
          commander: { heroId: session.commanderHeroId, controlled: false, aiTakeover: true },
          attachAura: true,
          battleOrders: false
        };
    }
  }

  _emit(event, payload) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event, payload);
    } catch (error) {
      // 事件消费方异常不影响会话账
    }
  }
}

export default BattleEntryService;

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
 * EncounterResolver - 大地图遭遇探测与公式结算（模块 4 · 4C）
 *
 * 设计依据：.trae/specs/military-supply-strategy/m4-implementation/spec.md §6 / §7
 *
 * 职责边界：
 * 1. detect 只做「逻辑判定」——返回遭遇描述，绝不结算、绝不改 armyStates；
 *    暂停/弹窗/自动策略由 SceneArmyOrderFlow 负责。
 * 2. resolve 只做「选完之后的结算」——返回后果描述（战斗结果、耗刻、士气、路线请求、
 *    易主候选），写 armyStates 仍由 SceneArmyOrderFlow 单点执行。
 * 3. 公式全部吃 worldLogic.combat（§7.2），所有数值来源经注入适配器读取既有注册表；
 *    rng 注入以便测试复现。
 * 4. 纯数据 + 纯函数，不依赖 DOM / Blackboard / 场景实体，可直接单测。
 */

/** 四选后果（顺序即确认框按钮顺序）。 */
export const ENCOUNTER_CHOICES = Object.freeze(['ambush', 'detour', 'fight', 'retreat']);

/** 遭遇目标类别。 */
export const ENCOUNTER_KINDS = Object.freeze(['field', 'city', 'pass']);

/** combat 缺省值（spec §7.2 全量；内容可覆盖，缺键回退这里）。 */
export const DEFAULT_COMBAT = Object.freeze({
  baseStrength: 100,
  unitStrengthScale: 10,
  attackerBonus: 0.1,
  attackerModifier: 0.1,
  commanderWeight: 0.25,
  armyCountWeight: 0.15,
  militiaWeight: 0.2,
  winThreshold: 1,
  lossRatio: 0.35,
  retreatLossRatio: 0.1,
  defeatLossRatio: 0.3,
  victorLossRatio: 0.12,
  spoilsRatio: 0.15,
  heroScale: 100,
  moraleBase: 0.8,
  moraleScale: 0.4,
  routMorale: 20,
  routMoraleFloor: 15,
  cityDefensePerLevel: 0.35,
  passDefensePerLevel: 0.15,
  garrisonPerLevel: 1,
  defenderInFort: 1.25,
  defenderField: 1,
  stackBonus: 0.15,
  stackLimit: 3,
  stackPenalty: 0.9,
  ambushBonus: 0.25,
  engageRadius: 120,
  autoPolicy: 'fight',
  decisionTimeoutMs: 8000,
  decisionHoldTicks: 1,
  strategyMatrix: null,
  terrainModifiers: Object.freeze({
    bridge: Object.freeze({ attacker: 0.85 }),
    ferry: Object.freeze({ attacker: 0.85 }),
    mountainPath: Object.freeze({ defender: 1.15 }),
    fortified: Object.freeze({ defender: 1.1 })
  }),
  terrainDefense: Object.freeze({ plain: 1, forest: 1.05, mountain: 1.2, yellowRiver: 1.1 }),
  retreat: Object.freeze({ moraleCost: 10, cooldownTicks: 4 })
});

const AMBUSH_EDGE_MODES = new Set(['road', 'bridge', 'mountainPath']);

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

function clamp01(value) {
  return clamp(value, 0, 1);
}

function pointOf(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function distanceOf(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mergeCombat(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_COMBAT, ...source };
  merged.terrainModifiers = {
    ...DEFAULT_COMBAT.terrainModifiers,
    ...(source.terrainModifiers && typeof source.terrainModifiers === 'object' ? source.terrainModifiers : {})
  };
  merged.terrainDefense = {
    ...DEFAULT_COMBAT.terrainDefense,
    ...(source.terrainDefense && typeof source.terrainDefense === 'object' ? source.terrainDefense : {})
  };
  merged.retreat = {
    ...DEFAULT_COMBAT.retreat,
    ...(source.retreat && typeof source.retreat === 'object' ? source.retreat : {})
  };
  merged.strategyMatrix = source.strategyMatrix && typeof source.strategyMatrix === 'object'
    ? source.strategyMatrix
    : null;
  return merged;
}

/**
 * 遭遇探测 + 公式结算。
 */
export class EncounterResolver {
  /**
   * @param {Object} [options]
   * @param {Object|null} [options.combat] - worldLogic.combat
   * @param {Function|null} [options.rng] - () => [0,1)
   * @param {Function|null} [options.resolveUnitType] - unitTypeId => library.unitTypes 定义
   * @param {Function|null} [options.resolveHero] - heroId => heroes 定义
   * @param {Function|null} [options.resolveFormation] - formationId => formations 定义
   * @param {Function|null} [options.getCityState] - cityId => cityStates 条目
   * @param {Function|null} [options.now] - () => 毫秒
   */
  constructor({
    combat = null,
    rng = null,
    resolveUnitType = null,
    resolveHero = null,
    resolveFormation = null,
    getCityState = null,
    now = null
  } = {}) {
    this.combat = mergeCombat(combat);
    this.rng = typeof rng === 'function' ? rng : Math.random;
    this.resolveUnitType = typeof resolveUnitType === 'function' ? resolveUnitType : null;
    this.resolveHero = typeof resolveHero === 'function' ? resolveHero : null;
    this.resolveFormation = typeof resolveFormation === 'function' ? resolveFormation : null;
    this.getCityState = typeof getCityState === 'function' ? getCityState : null;
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this._sequence = 0;
  }

  // ─── 探测（只判定，不结算）────────────────────────────────

  /**
   * 逻辑判定（spec §6.1）。返回遭遇描述或 null。
   * @param {Object} input - { state, order, layer, units, day }
   * @returns {Object|null}
   */
  detect({ state = null, order = null, layer = null, units = [], day = 1 } = {}) {
    if (!state || !order || order.state !== 'executing') return null;
    if (order.pendingEncounter) return null;
    const factionId = state.factionId != null ? String(state.factionId) : '';
    if (!factionId) return null;

    const route = state.route && typeof state.route === 'object' ? state.route : {};
    const nodeIds = Array.isArray(route.nodeIds) ? route.nodeIds : [];
    const edgeIds = Array.isArray(route.edgeIds) ? route.edgeIds : [];
    const index = Number.isInteger(route.index) ? route.index : 0;
    const nextNodeId = nodeIds[index] != null ? String(nodeIds[index]) : null;
    const currentEdgeId = edgeIds[Math.max(0, index - 1)] != null
      ? String(edgeIds[Math.max(0, index - 1)])
      : null;

    if (this._inCooldown(state, currentEdgeId, nextNodeId)) return null;

    // ① 下一个节点是敌对城池/关隘（须已推进到 engageRadius 内才触发：
    //    否则「从城中下令去远处的敌关」会在出发刻就被关隘遭遇打断，
    //    行军路径上的野战遭遇（②）永远轮不到——S09 伊阙道游骑即此情形）
    if (nextNodeId && layer) {
      const node = layer.getNode(nextNodeId);
      const owner = layer.getOwner(nextNodeId);
      if (node && (node.kind === 'city' || node.kind === 'pass') && owner && String(owner) !== factionId) {
        const nodeRadius = Math.max(1, num(this.combat.engageRadius, 120));
        const nodeDistance = distanceOf(pointOf(state.position), pointOf(node.position));
        if (!Number.isFinite(nodeDistance) || nodeDistance <= nodeRadius) {
          return this._buildEncounter({
            state, order, layer, units, day,
            kind: node.kind,
            nodeId: nextNodeId,
            edgeId: currentEdgeId
          });
        }
      }
    }

    // ② engageRadius 内敌对单位（野遭遇 / 关隘驻军）
    const radius = Math.max(1, num(this.combat.engageRadius, 120));
    const origin = pointOf(state.position);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const other of Array.isArray(units) ? units : []) {
      if (!other || other.id === state.id) continue;
      if (other.kind === 'city') continue;
      if (this._isDefeated(other)) continue;
      if (other.factionId == null || String(other.factionId) === factionId) continue;
      if (other.id === nextNodeId) continue; // 关隘驻军已在节点分支处理
      const distance = distanceOf(origin, pointOf(other.position));
      if (!Number.isFinite(distance) || distance > radius) continue;
      if (distance < nearestDistance) {
        nearest = other;
        nearestDistance = distance;
      }
    }
    if (nearest) {
      return this._buildEncounter({
        state, order, layer, units, day,
        kind: 'field',
        nodeId: nextNodeId,
        defender: nearest,
        edgeId: currentEdgeId
      });
    }

    // ③ 当前边被敌情挡（关隘/过河点他控）
    if (layer && currentEdgeId) {
      const snapshot = layer.getSnapshot ? layer.getSnapshot() : null;
      const entry = snapshot?.edges?.[currentEdgeId];
      if (entry && entry.status === 'hostile') {
        const edge = layer.getEdge ? layer.getEdge(currentEdgeId) : null;
        const conditions = edge?.conditions && typeof edge.conditions === 'object' ? edge.conditions : {};
        const crossingId = conditions.crossingNodeId != null ? String(conditions.crossingNodeId) : null;
        const targetNodeId = crossingId || nextNodeId;
        return this._buildEncounter({
          state, order, layer, units, day,
          kind: targetNodeId && layer.getNode(targetNodeId)?.kind === 'city' ? 'city' : 'pass',
          nodeId: targetNodeId,
          edgeId: currentEdgeId
        });
      }
    }

    return null;
  }

  _inCooldown(state, edgeId, nodeId = null) {
    const cooldown = state.encounterCooldown;
    if (!cooldown || typeof cooldown !== 'object') return false;
    if (num(cooldown.remainingTicks, 0) <= 0) return false;
    if (edgeId && cooldown.edgeId != null && String(cooldown.edgeId) === edgeId) return true;
    if (nodeId && cooldown.nodeId != null && String(cooldown.nodeId) === nodeId) return true;
    return false;
  }

  /** 已被歼灭的敌对单位不再触发遭遇。 */
  _isDefeated(unit) {
    const roster = unit?.roster;
    if (!roster || typeof roster !== 'object') return false;
    if (roster.count !== undefined && Number(roster.count) === 0) return true;
    return Array.isArray(roster.unitIds)
      && roster.unitIds.length === 0
      && Array.isArray(roster.dead);
  }

  _buildEncounter({ state, order, layer, units, day, kind, nodeId = null, defender = null, edgeId = null }) {
    const defenderFactionId = defender?.factionId
      ?? (nodeId && layer?.getOwner ? layer.getOwner(nodeId) : null)
      ?? null;
    const available = {
      ambush: kind === 'field' && this._canAmbush({ state, defender, layer, edgeId }),
      detour: this._detourRoute({ state, order, layer, edgeId }) != null,
      fight: true,
      retreat: true
    };
    return {
      id: `encounter.${state.id}.${edgeId || nodeId || defender?.id || 'field'}.${++this._sequence}`,
      unitId: String(state.id),
      kind,
      edgeId,
      nodeId,
      defenderUnitId: defender?.id != null ? String(defender.id) : null,
      defenderFactionId: defenderFactionId != null ? String(defenderFactionId) : null,
      attackerFactionId: state.factionId != null ? String(state.factionId) : null,
      day: num(day, 1),
      createdAt: this.now(),
      expiresAt: this.now() + Math.max(1000, num(this.combat.decisionTimeoutMs, 8000)),
      available
    };
  }

  _canAmbush({ state, defender, layer, edgeId }) {
    if (!defender) return false;
    const mode = edgeId && layer?.getEdge ? layer.getEdge(edgeId)?.mode : null;
    if (mode && !AMBUSH_EDGE_MODES.has(mode)) return false;
    const defenderOrder = defender.order;
    if (!defenderOrder || typeof defenderOrder !== 'object') return true;
    if (defenderOrder.type !== 'attack') return true;
    const targetId = defenderOrder.target?.unitId
      ?? defenderOrder.target?.id
      ?? defenderOrder.target?.nodeId
      ?? null;
    return targetId != null && String(targetId) !== String(state.id);
  }

  /**
   * 绕道路线（避开当前边）。不可绕 → null。
   * @returns {{nodeIds:string[], edgeIds:string[]}|null}
   */
  _detourRoute({ state, order, layer, edgeId }) {
    if (!layer) return null;
    const targetNodeId = layer.resolveTarget
      ? layer.resolveTarget(order?.target ?? state.order?.target ?? null)
      : null;
    if (!targetNodeId) return null;
    const fromNodeId = this._currentNodeId(state, layer);
    if (!fromNodeId) return null;
    if (edgeId) {
      const planned = layer.shortestPath(fromNodeId, targetNodeId, { avoidEdgeIds: [edgeId] });
      return planned.ok ? { nodeIds: planned.nodeIds, edgeIds: planned.edgeIds } : null;
    }
    const planned = layer.shortestPath(fromNodeId, targetNodeId);
    return planned.ok ? { nodeIds: planned.nodeIds, edgeIds: planned.edgeIds } : null;
  }

  _currentNodeId(state, layer) {
    const route = state?.route;
    if (route && Array.isArray(route.nodeIds) && route.nodeIds.length > 0) {
      const index = Number.isInteger(route.index) ? route.index : 0;
      const prev = route.nodeIds[Math.max(0, index - 1)];
      if (prev != null && layer?.getNode?.(String(prev))) return String(prev);
    }
    return layer?.findNearestNode ? layer.findNearestNode(state?.position)?.nodeId ?? null : null;
  }

  // ─── 结算（选完之后）────────────────────────────────────

  /**
   * 结算四选。只返回后果，不写 armyStates。
   * @param {Object} input - { encounter, choice, layer, state, units, day }
   * @returns {Object} outcome
   */
  resolve({ encounter = null, choice = null, layer = null, state = null, units = [], day = 1 } = {}) {
    if (!encounter) return { ok: false, code: 'encounterRequired' };
    if (!ENCOUNTER_CHOICES.includes(choice)) return { ok: false, code: 'unknownChoice', choice };
    if (state && encounter.unitId && String(state.id) !== String(encounter.unitId)) {
      return { ok: false, code: 'unitMismatch', unitId: state.id };
    }
    if (encounter.available && encounter.available[choice] === false) {
      return { ok: false, code: 'choiceUnavailable', choice };
    }

    const holdTicks = Math.max(1, Math.floor(num(this.combat.decisionHoldTicks, 1)));

    if (choice === 'detour') {
      const route = this._detourRoute({
        state,
        order: state?.order ?? null,
        layer,
        edgeId: encounter.edgeId
      });
      if (!route) return { ok: false, code: 'noDetour' };
      return {
        ok: true,
        encounterId: encounter.id,
        choice,
        strategicTicksSpent: 0,
        battle: null,
        moraleDelta: 0,
        routeRequest: { avoidEdgeIds: encounter.edgeId ? [encounter.edgeId] : [], ...route },
        cooldown: null,
        captured: null,
        retreatTo: null
      };
    }

    const previousNodeId = this._previousNodeId(state);
    const retreatTo = this._retreatNodeId(state, layer, previousNodeId);

    if (choice === 'retreat') {
      const retreatRoute = this._routeTo(state, layer, retreatTo);
      return {
        ok: true,
        encounterId: encounter.id,
        choice,
        strategicTicksSpent: holdTicks,
        battle: null,
        moraleDelta: -Math.max(0, num(this.combat.retreat?.moraleCost, 10)),
        routeRequest: retreatTo ? { retreatTo, ...(retreatRoute || {}) } : null,
        cooldown: encounter.edgeId
          ? { edgeId: encounter.edgeId, remainingTicks: Math.max(1, Math.floor(num(this.combat.retreat?.cooldownTicks, 4))) }
          : null,
        captured: null,
        retreatTo
      };
    }

    const ambush = choice === 'ambush';
    const battle = this._battle({
      attacker: state,
      defenderUnit: encounter.defenderUnitId
        ? (Array.isArray(units) ? units.find(unit => String(unit.id) === String(encounter.defenderUnitId)) : null)
        : null,
      defenderNodeId: encounter.kind === 'field' ? null : encounter.nodeId,
      layer,
      units,
      context: {
        kind: encounter.kind,
        edgeId: encounter.edgeId,
        edgeMode: encounter.edgeId && layer?.getEdge ? layer.getEdge(encounter.edgeId)?.mode ?? null : null,
        ambush
      }
    });

    const won = battle.winner === 'attacker';
    let routeRequest = null;
    let captured = null;
    let battleResult = null;

    if (!won) {
      const retreatRoute = this._routeTo(state, layer, retreatTo);
      routeRequest = retreatTo ? { retreatTo, ...(retreatRoute || {}) } : null;
    } else if (encounter.kind !== 'field') {
      const node = encounter.nodeId && layer?.getNode ? layer.getNode(encounter.nodeId) : null;
      const cityId = node?.ref?.id != null ? String(node.ref.id) : null;
      captured = { nodeId: encounter.nodeId, kind: encounter.kind, cityId };
      battleResult = this.toBattleResult(encounter, battle, { day, cityId });
    }

    return {
      ok: true,
      encounterId: encounter.id,
      choice,
      strategicTicksSpent: holdTicks,
      battle,
      moraleDelta: 0,
      routeRequest,
      cooldown: !won && encounter.edgeId
        ? { edgeId: encounter.edgeId, remainingTicks: Math.max(1, Math.floor(num(this.combat.retreat?.cooldownTicks, 4))) }
        : null,
      captured,
      battleResult,
      retreatTo: won ? null : retreatTo
    };
  }

  _previousNodeId(state) {
    const route = state?.route;
    if (!route || !Array.isArray(route.nodeIds) || route.nodeIds.length === 0) return null;
    const index = Number.isInteger(route.index) ? route.index : 0;
    const previous = route.nodeIds[Math.max(0, index - 1)];
    return previous != null ? String(previous) : null;
  }

  _retreatNodeId(state, layer, previousNodeId) {
    if (previousNodeId && layer?.getNode?.(previousNodeId)) return previousNodeId;
    if (!layer) return previousNodeId;
    const factionId = state?.factionId != null ? String(state.factionId) : '';
    let best = null;
    const nodes = layer.nodes instanceof Map ? layer.nodes.values() : [];
    for (const node of nodes) {
      if (!node || String(node.id) === String(state?.id)) continue;
      const owner = layer.getOwner ? layer.getOwner(node.id) : null;
      if (!owner || String(owner) !== factionId) continue;
      const distance = distanceOf(pointOf(state?.position), pointOf(node.position));
      if (!best || distance < best.distance) best = { nodeId: String(node.id), distance };
    }
    return best ? best.nodeId : previousNodeId;
  }

  _routeTo(state, layer, nodeId) {
    if (!layer || !nodeId) return null;
    const fromNodeId = this._currentNodeId(state, layer);
    if (!fromNodeId || fromNodeId === nodeId) return { nodeIds: [fromNodeId], edgeIds: [] };
    const planned = layer.shortestPath(fromNodeId, nodeId);
    return planned.ok ? { nodeIds: planned.nodeIds, edgeIds: planned.edgeIds } : null;
  }

  // ─── 公式 ────────────────────────────────────────────────

  _battle({ attacker, defenderUnit = null, defenderNodeId = null, layer = null, units = [], context = {} }) {
    const attackerSide = this._unitSide(attacker, units);
    const defenderSide = defenderUnit
      ? this._unitSide(defenderUnit, units)
      : this._nodeSide(defenderNodeId, layer, units);
    const defenderTypes = defenderSide.counts.map(entry => entry.typeId).filter(Boolean);

    const attackValue = attackerSide.counts.reduce((sum, entry) => (
      sum + entry.count * this._statOf(entry.typeId, 'attack')
    ), 0) * this._dealMultiplier(attackerSide.counts, defenderTypes);
    const defenseValue = defenderSide.counts.reduce((sum, entry) => (
      sum + entry.count * (entry.typeId
        ? this._statOf(entry.typeId, 'defense')
        : num(this.combat.unitStrengthScale, 10) * (1 + num(this.combat.militiaWeight, 0.2)))
    ), 0);

    const attackerCommand = this._commandFactor(attackerSide.unit);
    const defenderCommand = this._commandFactor(defenderSide.unit);
    const attackerFormation = this._formationFactor(attackerSide.unit, 'attack');
    const defenderFormation = this._formationFactor(defenderSide.unit, 'defense');
    const strategyFactor = this._strategyFactor(attackerSide.unit, defenderSide.unit);
    const attackerMorale = this._moraleFactor(attackerSide.unit?.morale ?? 70);
    const defenderMorale = this._moraleFactor(
      defenderSide.unit?.morale ?? defenderSide.cityState?.morale ?? 60
    );
    const terrainAttack = this._terrainFactor(context.edgeMode, 'attacker', attackerSide.node, defenderSide.node);
    const terrainDefend = this._terrainFactor(context.edgeMode, 'defender', attackerSide.node, defenderSide.node);
    const fortification = this._fortificationFactor(defenderSide);
    const stack = this._stackFactor(attacker, units);
    const ambush = context.ambush ? 1 + num(this.combat.ambushBonus, 0.25) : 1;
    const identity = 1 + num(this.combat.attackerModifier, num(this.combat.attackerBonus, 0.1));
    const defenderIdentity = defenderSide.node
      ? num(this.combat.defenderInFort, 1.25)
      : num(this.combat.defenderField, 1);

    const attackerForce = attackValue
      * attackerCommand
      * attackerFormation
      * strategyFactor
      * attackerMorale
      * ambush
      * stack
      * terrainAttack
      * identity;
    const defenderForce = defenseValue
      * defenderCommand
      * defenderFormation
      * defenderMorale
      * (1 + fortification)
      * terrainDefend
      * defenderIdentity;

    const roll = 0.9 + 0.2 * clamp01(this.rng());
    const score = defenderForce > 0 ? (attackerForce / defenderForce) * roll : Number.POSITIVE_INFINITY;
    const attackerWins = score >= num(this.combat.winThreshold, 1);
    const rout = attackerWins
      && num(defenderSide.unit?.morale ?? defenderSide.cityState?.morale ?? 60, 60) < num(this.combat.routMorale, 20);

    const attackerTotal = attackerSide.total;
    const defenderTotal = defenderSide.total;
    const advantage = Number.isFinite(score) ? clamp(1 / Math.max(score, 0.0001), 0.6, 2) : 0.6;
    const disadvantage = Number.isFinite(score) ? clamp(score, 0.6, 2) : 2;
    const attackerLossRatio = attackerWins
      ? num(this.combat.victorLossRatio, 0.12) * advantage
      : num(this.combat.defeatLossRatio, 0.3) * disadvantage;
    const defenderLossRatio = attackerWins
      ? num(this.combat.defeatLossRatio, 0.3) * (rout ? 1.5 : 1)
      : num(this.combat.victorLossRatio, 0.12) * disadvantage;

    const attackerLosses = this._lossCount(attackerTotal, attackerLossRatio, attackerTotal > 0);
    const defenderLosses = this._lossCount(defenderTotal, defenderLossRatio, defenderTotal > 0);

    let spoils = null;
    let spoilsFromCityId = null;
    if (attackerWins && defenderSide.cityState) {
      spoils = {};
      for (const [resource, value] of Object.entries(defenderSide.cityState.resources || {})) {
        const amount = Math.floor(Math.max(0, num(value, 0)) * clamp01(num(this.combat.spoilsRatio, 0.15)));
        if (amount > 0) spoils[resource] = amount;
      }
      spoilsFromCityId = defenderSide.cityState.id ?? null;
    }

    return {
      winner: attackerWins ? 'attacker' : 'defender',
      score: Number.isFinite(score) ? Number(score.toFixed(3)) : 999,
      roll: Number(roll.toFixed(3)),
      attackerForce: Math.round(attackerForce),
      defenderForce: Math.round(defenderForce),
      attackerTotal,
      defenderTotal,
      casualties: { attacker: attackerLosses, defender: defenderLosses },
      rout,
      spoils,
      spoilsFromCityId,
      defenderMorale: rout ? num(this.combat.routMoraleFloor, 15) : null,
      degraded: attackerSide.degraded || defenderSide.degraded
    };
  }

  _lossCount(total, ratio, hasTroops) {
    if (!hasTroops) return 0;
    const count = Math.round(Math.max(0, total) * clamp(ratio, 0, 1));
    return total > 0 ? Math.max(1, count) : 0;
  }

  _unitSide(unit, units = []) {
    const composition = this._composition(unit);
    return {
      unit,
      node: null,
      cityState: null,
      counts: composition.counts,
      total: composition.total,
      degraded: composition.degraded
    };
  }

  _nodeSide(nodeId, layer, units = []) {
    const node = nodeId && layer?.getNode ? layer.getNode(nodeId) : null;
    const garrison = Array.isArray(units)
      ? units.find(entry => entry && nodeId != null && String(entry.id) === String(nodeId))
      : null;
    const cityState = node?.ref?.id && this.getCityState ? this.getCityState(String(node.ref.id)) : null;
    if (garrison) {
      const composition = this._composition(garrison);
      return {
        unit: garrison,
        node,
        cityState,
        counts: composition.counts,
        total: composition.total,
        degraded: composition.degraded
      };
    }
    const level = Math.max(1, num(node?.level, 1));
    const count = Math.max(1, Math.round(level * Math.max(0.5, num(this.combat.garrisonPerLevel, 1))));
    return {
      unit: null,
      node,
      cityState,
      counts: [{ typeId: null, count }],
      total: count,
      degraded: true
    };
  }

  _composition(unit) {
    if (!unit || typeof unit !== 'object') {
      return { counts: [{ typeId: null, count: 1 }], total: 1, degraded: true };
    }
    const roster = unit.roster && typeof unit.roster === 'object' ? unit.roster : {};
    const deployment = unit.deployment?.roster && typeof unit.deployment.roster === 'object'
      ? unit.deployment.roster
      : null;
    const counts = [];
    if (deployment) {
      for (const [typeId, value] of Object.entries(deployment)) {
        const count = Math.floor(Math.max(0, num(value, 0)));
        if (count > 0) counts.push({ typeId: String(typeId), count });
      }
    }
    if (counts.length === 0 && Array.isArray(roster.unitIds) && roster.unitIds.length > 0) {
      counts.push({ typeId: null, count: roster.unitIds.length });
    }
    if (counts.length === 0 && num(roster.count, 0) > 0) {
      counts.push({ typeId: null, count: Math.floor(num(roster.count, 0)) });
    }
    if (counts.length === 0) counts.push({ typeId: null, count: 1 });
    const total = counts.reduce((sum, entry) => sum + entry.count, 0);
    return { counts, total, degraded: counts.every(entry => entry.typeId == null) };
  }

  _statOf(typeId, key) {
    if (typeId && this.resolveUnitType) {
      const definition = this.resolveUnitType(String(typeId));
      const value = Number(definition?.stats?.[key]);
      if (Number.isFinite(value)) return value;
    }
    return num(this.combat.unitStrengthScale, 10);
  }

  _dealMultiplier(attackerCounts, defenderTypes) {
    if (!defenderTypes.length || !this.resolveUnitType) return 1;
    let weighted = 0;
    let total = 0;
    for (const entry of attackerCounts) {
      if (!entry.typeId) continue;
      const definition = this.resolveUnitType(String(entry.typeId));
      const multipliers = definition?.dealMultiplier && typeof definition.dealMultiplier === 'object'
        ? definition.dealMultiplier
        : null;
      let average = 1;
      if (multipliers) {
        const values = defenderTypes
          .map(typeId => Number(multipliers[typeId]))
          .filter(value => Number.isFinite(value));
        if (values.length > 0) average = values.reduce((sum, value) => sum + value, 0) / values.length;
      }
      weighted += average * entry.count;
      total += entry.count;
    }
    return total > 0 ? weighted / total : 1;
  }

  _commandFactor(unit) {
    const heroId = unit?.commanderHeroId ?? unit?.deployment?.commanderHeroId ?? null;
    const command = heroId && this.resolveHero
      ? num(this.resolveHero(String(heroId))?.stats?.command, 50)
      : 50;
    return 1 + command / Math.max(1, num(this.combat.heroScale, 100));
  }

  _formationFactor(unit, key) {
    const formationId = unit?.formationId ?? unit?.deployment?.formationId ?? null;
    if (!formationId || !this.resolveFormation) return 1;
    const formation = this.resolveFormation(String(formationId));
    const value = Number(formation?.modifiers?.[key]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  _strategyFactor(attackerUnit, defenderUnit) {
    const matrix = this.combat.strategyMatrix;
    if (!matrix) return 1;
    const attackerStrategy = this._strategyOf(attackerUnit);
    const defenderStrategy = this._strategyOf(defenderUnit);
    if (!attackerStrategy || !defenderStrategy) return 1;
    const value = Number(matrix[attackerStrategy]?.[defenderStrategy]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  _strategyOf(unit) {
    const formationId = unit?.formationId ?? unit?.deployment?.formationId ?? null;
    if (!formationId || !this.resolveFormation) return null;
    const strategy = this.resolveFormation(String(formationId))?.strategy;
    return strategy != null ? String(strategy) : null;
  }

  _moraleFactor(morale) {
    const value = clamp(num(morale, 80), 0, 100) / 100;
    return num(this.combat.moraleBase, 0.8) + num(this.combat.moraleScale, 0.4) * value;
  }

  _terrainFactor(edgeMode, role, attackerNode, defenderNode) {
    const modifiers = this.combat.terrainModifiers || {};
    let factor = 1;
    const entry = edgeMode && modifiers[edgeMode] ? modifiers[edgeMode] : null;
    if (entry && Number.isFinite(Number(entry[role]))) factor *= Number(entry[role]);
    if (role === 'defender' && Array.isArray(defenderNode?.tags) && defenderNode.tags.includes('fortified')) {
      const fortified = Number(modifiers.fortified?.defender);
      if (Number.isFinite(fortified)) factor *= fortified;
    }
    return factor;
  }

  _fortificationFactor(side) {
    if (!side.node) return 0;
    if (side.node.kind === 'city') {
      const city = side.cityState;
      const level = num(city?.buildingLevel ?? side.node.level, 1);
      const damageRatio = clamp01(num(city?.damageRatio, 0));
      const buildings = Array.isArray(city?.buildingDamage) ? city.buildingDamage : [];
      const averageBuildingDamage = buildings.length > 0
        ? buildings.reduce((sum, value) => sum + clamp01(num(value, 0)), 0) / buildings.length
        : 0;
      return level
        * num(this.combat.cityDefensePerLevel, 0.35)
        * (1 - damageRatio)
        * (1 - averageBuildingDamage);
    }
    return Math.max(1, num(side.node.level, 1)) * num(this.combat.passDefensePerLevel, 0.15);
  }

  _stackFactor(attacker, units = []) {
    if (!Array.isArray(units) || units.length === 0) return 1;
    const factionId = attacker?.factionId != null ? String(attacker.factionId) : '';
    if (!factionId) return 1;
    const radius = Math.max(1, num(this.combat.engageRadius, 120));
    const origin = pointOf(attacker?.position);
    let count = 1;
    for (const unit of units) {
      if (!unit || String(unit.id) === String(attacker.id)) continue;
      if (unit.kind === 'city') continue;
      if (unit.factionId == null || String(unit.factionId) !== factionId) continue;
      if (distanceOf(origin, pointOf(unit.position)) > radius) continue;
      count += 1;
    }
    const limit = Math.max(1, Math.floor(num(this.combat.stackLimit, 3)));
    let factor = 1 + num(this.combat.stackBonus, 0.15) * (Math.min(count, limit) - 1);
    if (count > limit) factor *= Math.pow(num(this.combat.stackPenalty, 0.9), count - limit);
    return factor;
  }

  // ─── 战果形状（复用 CityWarSystem）────────────────────────

  /**
   * 转 BattleResult 形状（spec §7.4）。非城池目标返回 null。
   * @param {Object} encounter
   * @param {Object} battle
   * @param {Object} [options] - { day, cityId, attackerCityId }
   */
  toBattleResult(encounter, battle, { day = 1, cityId = null, attackerCityId = null } = {}) {
    if (!encounter || !battle) return null;
    if (encounter.kind !== 'city' && encounter.kind !== 'pass') return null;
    const attackerWon = battle.winner === 'attacker';
    return {
      resultId: `battle.${encounter.id}`,
      battleId: encounter.id,
      winnerFactionId: attackerWon ? encounter.attackerFactionId : encounter.defenderFactionId,
      affectedCityId: cityId,
      resourceTransfer: attackerWon && battle.spoils && Object.keys(battle.spoils).length > 0
        ? {
          fromCityId: battle.spoilsFromCityId ?? cityId,
          toCityId: attackerCityId,
          resources: { ...battle.spoils }
        }
        : null,
      cityDamage: attackerWon ? { ratio: 0.1 } : null,
      damagedResourceNodeIds: [],
      casualties: { ...battle.casualties },
      completedAt: day,
      encounter: { id: encounter.id, kind: encounter.kind, nodeId: encounter.nodeId }
    };
  }
}

export default EncounterResolver;

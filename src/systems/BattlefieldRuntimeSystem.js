/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * YiJian18-Engine - live battlefield orchestration
 ************************************************************/

import { BattleMode, BattleState } from './BattleSystem.js';
import { CANONICAL_SCHEMA_VERSION } from '../data/schema/CanonicalSchemas.js';
import {
  DEPLOY_ROLES,
  resolveFormation,
  buildDeploySlots,
  assignDeploySlots,
  resolveStanceForRole
} from './FormationResolver.js';
import { aggregateHeroAuras, buildCommanderEntry } from './HeroAuraResolver.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isAlive = entity => {
  const stats = entity?.getComponent?.('stats');
  return !!stats && Number(stats.hp) > 0 && !entity.isDead && !entity.isDying;
};
const hasTag = (entity, tag) => Array.isArray(entity?.tags) && entity.tags.includes(tag);

/**
 * Coordinates a live battle without owning CombatSystem, AISystem or entity state.
 * BattleSystem remains the authority for mode and the single frozen result.
 */
export class BattlefieldRuntimeSystem {
  constructor(config = {}) {
    this.battleSystem = config.battleSystem || null;
    this.aiSystem = config.aiSystem || null;
    this.onEvent = config.onEvent || (() => {});
    this.reset();
  }

  reset() {
    this.active = false;
    this.elapsed = 0;
    this.participants = [];
    this.initialFactions = {};
    this.playerEntity = null;
    this.playerRestore = null;
    this.lastSnapshot = null;
    /** 各阵营本场部署（formationId / strategy / commanderSlot / slots），无军阵时为空对象 */
    this.deployments = {};
    this.deploymentWarnings = [];
    /** 各阵营本场主将（6C：主将一律下场，光环常驻）；无主将时为空对象 */
    this.commanders = {};
    /** 各阵营光环聚合（CombatModifierPipeline.auras 输入），无主将时为空对象 */
    this.auras = {};
  }

  start({
    entities = [],
    playerEntity = null,
    playerFactionId = null,
    formations = null,
    deployments = null,
    commanders = null
  } = {}) {
    if (this.active) return { ok: true, idempotent: true, snapshot: this.getSnapshot() };
    if (this.battleSystem?.state !== BattleState.ACTIVE || !this.battleSystem?.mode) {
      return { ok: false, code: 'battleNotActive' };
    }
    const definition = this.battleSystem.definition || {};
    const factionIds = definition.participantFactionIds || [];
    const candidates = entities.filter(entity => hasTag(entity, 'battleParticipant')
      && factionIds.includes(entity.factionId));
    const missingFaction = factionIds.find(factionId => !candidates.some(entity => entity.factionId === factionId));
    if (missingFaction) return { ok: false, code: 'battleFactionMissing', factionId: missingFaction };

    this.elapsed = 0;
    this.participants = candidates.map(entity => {
      const stats = entity.getComponent('stats');
      return { id: entity.id, factionId: entity.factionId, maxHp: Math.max(1, Number(stats?.maxHp) || 1) };
    });
    this._applyDeployments(definition, candidates, formations, deployments);
    this._applyCommanders(commanders);
    this.initialFactions = this._createInitialFactions(definition, candidates);
    this.playerEntity = playerEntity;
    if (this.battleSystem.mode === BattleMode.INTERVENE) this._attachPlayer(playerEntity, playerFactionId);
    for (const entity of candidates) this.aiSystem?.activateAI?.(entity, entity.aiType || 'battleFormation');
    this.active = true;
    this.lastSnapshot = this._buildSnapshot(entities);
    this.onEvent('battlefieldStarted', clone(this.lastSnapshot));
    return { ok: true, snapshot: this.getSnapshot() };
  }

  update(deltaTime, entities = []) {
    if (!this.active) return { ok: true, active: false, snapshot: this.getSnapshot() };
    this.elapsed += Math.max(0, Number(deltaTime) || 0);
    this.lastSnapshot = this._buildSnapshot(entities);
    const signals = this._buildSignals(this.lastSnapshot);
    const outcome = this.battleSystem.evaluateOutcome(signals, match => this._createResult(match, this.lastSnapshot));
    if (!outcome.ok && outcome.code === 'battleOngoing') {
      return { ok: true, active: true, snapshot: this.getSnapshot() };
    }
    if (!outcome.ok) return outcome;

    const snapshot = this.getSnapshot();
    this.stop({ entities, preserveSnapshot: true });
    this.onEvent('battlefieldResolved', { result: clone(outcome.result), snapshot });
    return { ok: true, active: false, resolved: true, result: clone(outcome.result), snapshot };
  }

  stop({ entities = [], preserveSnapshot = false } = {}) {
    const byId = new Map(entities.map(entity => [entity.id, entity]));
    for (const participant of this.participants) {
      const entity = byId.get(participant.id);
      if (entity && isAlive(entity)) this.aiSystem?.deactivateAI?.(entity, entity.aiType || 'battleFormation');
    }
    this._restorePlayer();
    this.active = false;
    if (!preserveSnapshot) this.lastSnapshot = null;
  }

  getSnapshot() {
    return clone(this.lastSnapshot);
  }

  serialize() {
    return {
      schemaVersion: 1,
      active: this.active,
      elapsed: this.elapsed,
      participants: clone(this.participants),
      initialFactions: clone(this.initialFactions),
      playerRestore: clone(this.playerRestore),
      deployments: clone(this.deployments),
      commanders: clone(this.commanders),
      auras: clone(this.auras),
      lastSnapshot: clone(this.lastSnapshot)
    };
  }

  validateSerialized(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || typeof snapshot.active !== 'boolean'
      || !Array.isArray(snapshot.participants) || !snapshot.initialFactions) {
      return { ok: false, code: 'invalidSnapshot' };
    }
    const invalid = snapshot.participants.find(entry => typeof entry?.id !== 'string' || !entry.id
      || typeof entry?.factionId !== 'string' || !entry.factionId);
    return invalid ? { ok: false, code: 'invalidParticipant' } : { ok: true };
  }

  deserialize(snapshot, { entities = [], playerEntity = null, playerFactionId = null } = {}) {
    const validation = this.validateSerialized(snapshot);
    if (!validation.ok) return validation;
    const participantIds = new Set(snapshot.participants.map(entry => entry.id));
    if (participantIds.size !== snapshot.participants.length) {
      return { ok: false, code: 'duplicateParticipant' };
    }
    if (snapshot.active && this.battleSystem?.state !== BattleState.ACTIVE) {
      return { ok: false, code: 'battleStateMismatch' };
    }
    this.active = snapshot.active;
    this.elapsed = Math.max(0, Number(snapshot.elapsed) || 0);
    this.participants = clone(snapshot.participants);
    this.initialFactions = clone(snapshot.initialFactions);
    this.playerRestore = clone(snapshot.playerRestore);
    this.deployments = clone(snapshot.deployments) || {};
    this.commanders = clone(snapshot.commanders) || {};
    this.auras = clone(snapshot.auras) || {};
    this.lastSnapshot = clone(snapshot.lastSnapshot);
    this.playerEntity = playerEntity;
    if (this.active) {
      const byId = new Map(entities.map(entity => [entity.id, entity]));
      for (const participant of this.participants) {
        const entity = byId.get(participant.id);
        if (entity && isAlive(entity)) this.aiSystem?.activateAI?.(entity, entity.aiType || 'battleFormation');
      }
      if (this.battleSystem.mode === BattleMode.INTERVENE) this._attachPlayer(playerEntity, playerFactionId);
      this.lastSnapshot = this._buildSnapshot(entities);
    }
    return { ok: true };
  }

  dispose(entities = []) {
    this.stop({ entities });
    this.reset();
  }

  /**
   * 战前部署（5B）：按军阵定义给参战实体打槽位 + 记录本场部署。
   * 没有 formations 时直接返回（既有战斗行为零变化）。
   */
  _applyDeployments(definition, entities, formations, deployments) {
    this.deployments = {};
    this.deploymentWarnings = [];
    const lookup = new Map();
    if (Array.isArray(formations)) {
      for (const formation of formations) if (formation?.id) lookup.set(String(formation.id), formation);
    } else if (formations instanceof Map) {
      for (const [id, formation] of formations) lookup.set(String(id), formation);
    } else if (formations && typeof formations === 'object') {
      for (const [id, formation] of Object.entries(formations)) lookup.set(String(id), formation);
    }
    if (lookup.size === 0) return;

    const create = definition.createParams || {};
    const armies = [create.attackerArmy, create.defenderArmy].filter(Boolean);
    const overrides = deployments && typeof deployments === 'object' ? deployments : {};
    for (const factionId of definition.participantFactionIds || []) {
      const members = entities.filter(entity => entity.factionId === factionId);
      const army = armies.find(entry => entry?.factionId === factionId) || null;
      const override = overrides[factionId] && typeof overrides[factionId] === 'object' ? overrides[factionId] : {};
      const formationId = override.formationId
        || (Array.isArray(army?.formationIds) ? army.formationIds[0] : null);
      if (!formationId) continue;
      const formation = lookup.get(String(formationId));
      if (!formation) {
        this.deploymentWarnings.push({ code: 'formationMissing', factionId, formationId: String(formationId) });
        continue;
      }
      const roster = Array.isArray(override.roster?.unitIds) && override.roster.unitIds.length > 0
        ? override.roster.unitIds
        : null;
      const resolved = resolveFormation(formation, roster ? { unitIds: roster } : { unitCount: Math.max(1, members.length) });
      const slots = buildDeploySlots(resolved);
      for (const item of assignDeploySlots(slots, members)) {
        item.entity.deploySlot = item.slot ? { ...item.slot } : null;
        item.entity.formationStance = item.slot ? resolveStanceForRole(resolved, item.slot.role) : null;
      }
      this.deployments[factionId] = {
        armyId: army?.id || factionId,
        formationId: resolved.id || String(formationId),
        strategy: resolved.strategy,
        rows: resolved.rows.length,
        columns: resolved.columns,
        commanderSlot: DEPLOY_ROLES.includes(override.commanderSlot) ? override.commanderSlot : 'mid',
        deputySlots: Array.isArray(override.deputySlots)
          ? override.deputySlots.filter(slot => DEPLOY_ROLES.includes(slot))
          : [],
        combat: { ...resolved.combat },
        slots: slots.length,
        warnings: resolved.warnings
      };
    }
  }

  /**
   * 主将入场（6C/6D）：`commanders` 可为数组或 { factionId: entry } 映射。
   * 未传时零变化（老战斗无主将实体）。
   */
  _applyCommanders(commanders) {
    this.commanders = {};
    this.auras = {};
    if (!commanders) return;
    const entries = [];
    if (Array.isArray(commanders)) {
      for (const entry of commanders) if (entry) entries.push(entry);
    } else if (typeof commanders === 'object') {
      for (const [factionId, value] of Object.entries(commanders)) {
        if (Array.isArray(value)) {
          for (const entry of value) if (entry) entries.push({ ...entry, factionId: entry.factionId ?? factionId });
        } else if (value && typeof value === 'object') {
          entries.push({ ...value, factionId: value.factionId ?? factionId });
        }
      }
    }
    const auraEntriesByFaction = new Map();
    for (const raw of entries) {
      const factionId = raw.factionId != null ? String(raw.factionId) : null;
      if (!factionId) continue;
      const normalized = raw.hero && !raw.heroId
        ? buildCommanderEntry({
            hero: raw.hero,
            deployment: raw.deployment || null,
            factionId,
            onField: raw.onField !== false
          })
        : {
            factionId,
            heroId: raw.heroId != null ? String(raw.heroId) : null,
            name: raw.name != null ? String(raw.name) : null,
            slot: DEPLOY_ROLES.includes(raw.slot) ? raw.slot : (DEPLOY_ROLES.includes(raw.deploySlot) ? raw.deploySlot : 'mid'),
            deploySlot: DEPLOY_ROLES.includes(raw.deploySlot) ? raw.deploySlot : (DEPLOY_ROLES.includes(raw.slot) ? raw.slot : 'mid'),
            aura: raw.aura && typeof raw.aura === 'object' ? { ...raw.aura } : null,
            onField: raw.onField !== false
          };
      const commander = {
        ...normalized,
        controlled: raw.controlled === true,
        aiTakeover: raw.controlled === true ? false : raw.aiTakeover !== false
      };
      this.commanders[factionId] = commander;
      if (commander.onField !== false) {
        const list = auraEntriesByFaction.get(factionId) || [];
        list.push({ hero: { id: commander.heroId, aura: commander.aura }, onField: true });
        auraEntriesByFaction.set(factionId, list);
      }
      if (this.deployments[factionId]) {
        this.deployments[factionId].commander = {
          heroId: commander.heroId,
          slot: commander.slot,
          controlled: commander.controlled
        };
      }
    }
    for (const [factionId, list] of auraEntriesByFaction.entries()) {
      const aggregated = aggregateHeroAuras(list);
      if (aggregated.activeHeroes.length > 0) {
        this.auras[factionId] = {
          attack: aggregated.attack,
          defense: aggregated.defense,
          radius: aggregated.radius,
          heroes: aggregated.activeHeroes
        };
      }
    }
  }

  _createInitialFactions(definition, entities) {
    const create = definition.createParams || {};
    const armies = [create.attackerArmy, create.defenderArmy].filter(Boolean);
    const moraleByFaction = new Map([
      [create.attackerArmy?.factionId, Number(
        definition.realtimeMorale?.[create.attackerArmy?.factionId]
          ?? create.attackerMorale ?? create.attackerArmy?.morale
      )],
      [create.defenderArmy?.factionId, Number(
        definition.realtimeMorale?.[create.defenderArmy?.factionId]
          ?? create.defenderMorale ?? create.defenderArmy?.morale
      )]
    ]);
    const factions = {};
    for (const factionId of definition.participantFactionIds || []) {
      const members = entities.filter(entity => entity.factionId === factionId);
      const army = armies.find(entry => entry.factionId === factionId);
      factions[factionId] = {
        factionId,
        armyId: army?.id || factionId,
        name: army?.name || factionId,
        count: members.length,
        totalHp: members.reduce((sum, entity) => sum + Math.max(1, Number(entity.getComponent('stats')?.maxHp) || 1), 0),
        morale: Math.max(0, Math.min(100, moraleByFaction.get(factionId) || 50))
      };
    }
    return factions;
  }

  _buildSnapshot(entities) {
    const byId = new Map(entities.map(entity => [entity.id, entity]));
    const factions = {};
    for (const [factionId, initial] of Object.entries(this.initialFactions)) {
      const members = this.participants.filter(entry => entry.factionId === factionId);
      let alive = 0;
      let hp = 0;
      for (const member of members) {
        const entity = byId.get(member.id);
        if (!isAlive(entity)) continue;
        alive++;
        hp += Math.max(0, Number(entity.getComponent('stats')?.hp) || 0);
      }
      const casualtyRatio = initial.count > 0 ? (initial.count - alive) / initial.count : 1;
      const hpLossRatio = initial.totalHp > 0 ? 1 - Math.min(1, hp / initial.totalHp) : 1;
      const morale = Math.max(0, Math.round(initial.morale - casualtyRatio * 75 - hpLossRatio * 35));
      factions[factionId] = {
        factionId,
        armyId: initial.armyId,
        name: initial.name,
        initial: initial.count,
        alive,
        casualties: Math.max(0, initial.count - alive),
        hpRatio: initial.totalHp > 0 ? Math.max(0, Math.min(1, hp / initial.totalHp)) : 0,
        morale
      };
      // 5B：有部署才补字段，无军阵战斗的 snapshot 结构保持原样
      const deployment = this.deployments?.[factionId];
      if (deployment) {
        factions[factionId].formation = {
          id: deployment.formationId,
          strategy: deployment.strategy,
          commanderSlot: deployment.commanderSlot
        };
      }
      // 6C/6D：有主将才补字段（光环常驻，阵亡/离场由 onField 表达）
      const commander = this.commanders?.[factionId];
      if (commander) {
        factions[factionId].commander = {
          heroId: commander.heroId,
          slot: commander.slot,
          controlled: commander.controlled,
          onField: commander.onField !== false
        };
      }
      const aura = this.auras?.[factionId];
      if (aura) factions[factionId].aura = { ...aura };
    }
    return {
      battleId: this.battleSystem?.definition?.battleId || null,
      mode: this.battleSystem?.mode || null,
      objective: this.battleSystem?.definition?.objective || '击溃敌军或使其士气崩溃',
      elapsed: this.elapsed,
      factions
    };
  }

  _buildSignals(snapshot) {
    const definitions = this.battleSystem?.definition?.outcomeSignals || {};
    const signals = {};
    for (const [signal, rule] of Object.entries(definitions)) {
      const faction = snapshot.factions?.[rule.factionId];
      if (rule.type === 'factionDefeated') signals[signal] = !!faction && faction.alive <= 0;
      else if (rule.type === 'factionMoraleBroken') signals[signal] = !!faction && faction.morale <= 0;
      else signals[signal] = false;
    }
    return signals;
  }

  _createResult(match, snapshot) {
    const definition = this.battleSystem.definition;
    const create = definition.createParams || {};
    const basePolicy = definition.realtimeResult || {};
    const policy = basePolicy.byWinner?.[match.winnerFactionId] || basePolicy;
    const resources = clone(policy.capturedResources || {});
    const casualties = {};
    for (const faction of Object.values(snapshot.factions || {})) {
      casualties[faction.armyId] = Math.max(0, Math.floor(faction.casualties));
    }
    return {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      resultId: policy.resultId || basePolicy.resultId || `result-${definition.battleId}-${create.seed || 0}`,
      responseId: policy.responseId || basePolicy.responseId || `response-realtime-${definition.battleId}-${create.seed || 0}`,
      battleId: match.battleId,
      winnerFactionId: match.winnerFactionId,
      casualties,
      capturedResources: resources,
      resourceTransfer: {
        fromCityId: create.resourceSourceCityId,
        toCityId: create.resourceDestinationCityId,
        resources: clone(resources)
      },
      affectedCityId: create.affectedCityId,
      cityDamage: Math.max(0, Math.min(1, Number(policy.cityDamage) || 0)),
      damagedResourceNodeIds: clone(policy.damagedResourceNodeIds || []),
      completedAt: Math.max(0, Math.floor((Number(create.logicalTime) || 0) + this.elapsed))
    };
  }

  _attachPlayer(player, factionId) {
    if (!player || !factionId) return;
    if (!this.playerRestore) {
      this.playerRestore = { factionId: player.factionId, tags: [...(player.tags || [])] };
    }
    player.factionId = factionId;
    player.tags = [...new Set([...(player.tags || []), 'battleIntervenor'])];
  }

  _restorePlayer() {
    if (!this.playerEntity || !this.playerRestore) return;
    if (this.playerRestore.factionId === undefined) delete this.playerEntity.factionId;
    else this.playerEntity.factionId = this.playerRestore.factionId;
    this.playerEntity.tags = [...this.playerRestore.tags];
    this.playerRestore = null;
  }
}

export default BattlefieldRuntimeSystem;

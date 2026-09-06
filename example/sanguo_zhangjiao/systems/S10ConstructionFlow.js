/************************************************************

 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)

 * 

 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎

 * @author    刘枭 (beiliwenxiao)

 * @email     beiliwenxiao@qq.com

 * @date      2026-01-14

 * @blog      https://blog.csdn.net/beiliwenxiao

 * @repo      https://github.com/beiliwenxiao/yijian18-engine

 *            https://gitee.com/coderaaa/yijian18-engine

 ************************************************************
 * 三国张角传 - P4.2 S10 营建和工事场景编排
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { BuildingType } from '../../../src/ecs/components/BuildingComponent.js';
import { S06_FIELD_CONSTRUCTION_SITE_ID } from './S06SceneFlow.js';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

const S10_CONSTRUCTION_SITE_KEYS = Object.freeze({
  'site.s10.campfire': 'campfire',
  'site.s10.barricade': 'barricade',
  'site.s10.simple_wall': 'simpleWall',
  'site.s10.arrow_tower': 'arrowTower'
});
const S10_STRUCTURE_CONFIG = Object.freeze({
  campfire: Object.freeze({
    siteId: 'site.s10.campfire', markerId: 'S10-site-campfire', entityId: 'S10-structure-campfire',
    buildingType: BuildingType.GENERIC, name: '营地火堆', width: 96, height: 80,
    footprint: Object.freeze({ w: 80, h: 48 }), controllable: false
  }),
  barricade: Object.freeze({
    siteId: 'site.s10.barricade', markerId: 'S10-site-barricade', entityId: 'S10-structure-barricade',
    buildingType: BuildingType.GENERIC, name: '拒马', width: 128, height: 72,
    footprint: Object.freeze({ w: 112, h: 42 }), controllable: false
  }),
  simpleWall: Object.freeze({
    siteId: 'site.s10.simple_wall', markerId: 'S10-site-simple-wall', entityId: 'S10-structure-simple-wall',
    buildingType: BuildingType.WALL, name: '简易壁垒', width: 152, height: 92,
    footprint: Object.freeze({ w: 136, h: 54 }), controllable: false
  }),
  arrowTower: Object.freeze({
    siteId: 'site.s10.arrow_tower', markerId: 'S10-site-arrow-tower', entityId: 'S10-structure-arrow-tower',
    buildingType: BuildingType.TOWER, name: '箭楼', width: 112, height: 156,
    footprint: Object.freeze({ w: 88, h: 70 }), controllable: true
  })
});
const S10_STRUCTURE_BY_SITE = Object.freeze(Object.fromEntries(
  Object.values(S10_STRUCTURE_CONFIG).map(config => [config.siteId, config])
));

const s10ConstructionMethods = {
  _projectS10ConstructionEffects(definition, sceneId) {
    if (!definition || !['S11', 'S12'].includes(sceneId)) return definition;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    const runtimeStructures = this.constructionSystem?.getStructures?.() || [];
    const effects = cloneData(runtimeStructures.some(structure => S10_STRUCTURE_BY_SITE[structure.siteId])
      ? this._deriveS10ConstructionEffects()
      : (story.s10Construction?.effects || this._deriveS10ConstructionEffects()));
    definition.s10ConstructionEffects = effects;
    const moraleKey = 'yellow_turban';
    const morale = Math.max(0, Math.min(100,
      Math.floor(Number(definition.realtimeMorale?.[moraleKey]) || 0) + Math.floor(Number(effects.moraleBonus) || 0)
    ));
    definition.realtimeMorale = { ...(definition.realtimeMorale || {}), [moraleKey]: morale };
    const armyKey = sceneId === 'S11' ? 'attackerArmy' : 'defenderArmy';
    const moraleField = sceneId === 'S11' ? 'attackerMorale' : 'defenderMorale';
    definition.createParams = {
      ...(definition.createParams || {}),
      [moraleField]: morale,
      [armyKey]: { ...(definition.createParams?.[armyKey] || {}), morale }
    };
    return definition;
  },

  _applyS10ConstructionBattleEffects(config, sceneId) {
    if (!['S11', 'S12'].includes(sceneId)) return;
    const effects = config?.s10ConstructionEffects || {};
    const casualtyMultiplier = Math.max(0.1, Number(effects.friendlyCasualtyMultiplier) || 1);
    const defenseMultiplier = Math.max(0.1, Number(effects.friendlyDefenseMultiplier) || 1);
    const enemySpeedMultiplier = Math.max(0.1, Number(effects.enemyAdvanceSpeedMultiplier) || 1);
    const effectId = `s10Construction:${config.battleId}`;
    for (const entity of this.entities || []) {
      if (entity?._s10ConstructionBattleEffectId === effectId) continue;
      const factionId = entity?.factionId || entity?.faction;
      const stats = entity?.getComponent?.('stats');
      const movement = entity?.getComponent?.('movement');
      if (factionId === 'yellow_turban' && stats) {
        if (casualtyMultiplier < 1 && Number.isFinite(Number(stats.maxHp))) {
          const ratio = stats.maxHp > 0 ? Math.max(0, Number(stats.hp) || 0) / stats.maxHp : 1;
          stats.maxHp = Math.max(1, Math.round(stats.maxHp / casualtyMultiplier));
          stats.hp = Math.max(1, Math.round(stats.maxHp * ratio));
        }
        if (Number.isFinite(Number(stats.defense))) stats.defense *= defenseMultiplier;
      }
      if (factionId === 'han_government') {
        if (movement && Number.isFinite(Number(movement.speed))) movement.speed *= enemySpeedMultiplier;
        if (stats && Number.isFinite(Number(stats.speed))) stats.speed *= enemySpeedMultiplier;
      }
      entity._s10ConstructionBattleEffectId = effectId;
    }
  },

  _captureConstructionRollback() {
    const inventory = this.playerEntity?.getComponent?.('inventory');
    return {
      inventory,
      inventoryState: cloneData(inventory?.exportItems?.() || []),
      constructionRuntime: this.constructionSystem?.captureRuntime?.() || null,
      proficiencyState: cloneData(this.proficiencySystem?.serialize?.() || null),
      storyState: cloneData(this.gameLoader?.blackboard?.get?.('storyState') || {})
    };
  },

  _restoreConstructionRollback(snapshot, operationIds = []) {
    if (!snapshot) return false;
    snapshot.inventory?.loadItems?.(snapshot.inventoryState || []);
    this.constructionSystem?.restoreRuntime?.(snapshot.constructionRuntime);
    if (snapshot.proficiencyState) this.proficiencySystem?.deserialize?.(snapshot.proficiencyState);
    this.gameLoader?.blackboard?.set?.('storyState', snapshot.storyState || {});
    for (const operationId of operationIds.filter(Boolean)) {
      this.inventoryTransactions?.forgetOperation?.(operationId);
    }
    return true;
  },

  _updateConstructionRuntime(deltaTime) {
    if (!this.constructionSystem || this._constructionCheckpointBusy) return;
    const pending = this.constructionSystem.serialize().pending;
    const willReachTerminal = pending.some(entry => (
      entry.status === 'active' && entry.elapsed + Math.max(0, Number(deltaTime) || 0) >= entry.duration
    ));
    const rollback = willReachTerminal ? this._captureConstructionRollback() : null;
    const terminal = this.constructionSystem.update(deltaTime);
    if (terminal.length === 0) return;
    if (terminal.some(result => result?.status === 'refundPending')) {
      this._showScreenTip('施工已取消，但背包暂时无法容纳退回材料。清理空间后再次与施工点交互。', {
        title: '材料等待退回'
      });
      return;
    }
    this._constructionCheckpointBusy = true;
    void this._checkpointS10ConstructionTerminal(terminal, rollback).finally(() => {
      this._constructionCheckpointBusy = false;
    });
  },
  async startS10Construction(params = {}) {
    if (this.currentSceneId !== 'S10' || !this.constructionSystem || this._constructionCheckpointBusy) return false;
    const siteId = String(params.siteId || '');
    const definitionId = String(params.definitionId || '');
    const siteKey = S10_CONSTRUCTION_SITE_KEYS[siteId];
    const blackboard = this.gameLoader?.blackboard;
    const story = cloneData(blackboard?.get?.('storyState') || {});
    if (!blackboard || !siteKey || !definitionId) {
      this._showScreenTip('施工点或工事定义无效。', { title: '营建配置错误' });
      return false;
    }
    if (story.constructionSiteUnlocked !== true || story.s10CampRelocation?.completed !== true) {
      this._showScreenTip('先评估临时营地并沿溪迁至新址，才能开始施工。', { title: '施工点未开放' });
      return false;
    }
    const completed = this.constructionSystem.getStructure(siteId);
    if (completed) return this.interactS10Structure(params);
    const existing = this.constructionSystem.getPending(siteId);
    if (existing?.status === 'refundPending') return this.cancelS10Construction({ siteId });
    if (existing) {
      this._showScreenTip(`施工进度 ${Math.floor(existing.progress * 100)}%，材料已托管，不会重复扣除。`, {
        title: '正在施工'
      });
      return true;
    }

    const inventory = this.playerEntity?.getComponent?.('inventory');
    if (!inventory || !this.playerEntity?.id) return false;
    const rollback = this._captureConstructionRollback();
    const attempt = Math.max(0, Math.floor(Number(story.s10Construction?.attempts?.[siteKey]) || 0)) + 1;
    const operationId = `construction:S10:${siteKey}:${attempt}`;
    const cityStates = blackboard.get('cityStates') || [];
    const cityDamageRatio = Number(cityStates.find(city => city?.id === 'city.s09_guangzong_camp')?.damageRatio) || 0;
    const result = this.constructionSystem.start({
      characterId: this.playerEntity.id,
      inventory,
      definitionId,
      siteId,
      operationId,
      cityDamageRatio,
      context: { sceneId: 'S10' }
    });
    if (!result.ok) {
      const messages = {
        proficiencyRequired: `营建熟练度不足：需要 ${result.required} 级，当前 ${result.actual} 级。材料未扣除。`,
        materialsRequired: `材料不足：缺少 ${result.itemId} × ${result.quantity}。材料未扣除。`,
        toolRequired: '缺少可用铲子。材料未扣除。',
        toolInstanceRequired: '铲子缺少稳定实例 ID，无法安全预留。材料未扣除。',
        toolReserved: '这把铲子正在另一处施工中。材料未扣除。',
        constructionSiteLocked: '沿溪施工地尚未开放。材料未扣除。',
        invalidSite: '此处不允许修筑该工事。材料未扣除。'
      };
      this._showScreenTip(messages[result.code] || `施工未开始：${result.code || 'unknown'}。材料未扣除。`, {
        title: '前置不足'
      });
      return false;
    }

    const beforeConstruction = story.s10Construction || {};
    blackboard.set('storyState', {
      ...story,
      s10Construction: {
        ...beforeConstruction,
        attempts: { ...(beforeConstruction.attempts || {}), [siteKey]: attempt },
        pendingSites: {
          ...(beforeConstruction.pendingSites || {}),
          [siteKey]: { siteId, definitionId, operationId, status: 'active' }
        }
      },
      lastCheckpointId: `checkpoint.S10.constructionStart.${siteKey}`
    });
    this._constructionCheckpointBusy = true;
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: `checkpoint.S10.constructionStart.${siteKey}`, sceneId: 'S10'
      });
      if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
      const definition = this.constructionSystem.getDefinition(definitionId);
      this._showScreenTip(`${definition?.name || '工事'}开始施工，预计 ${Math.ceil(result.duration)} 秒。`, {
        title: result.emergency ? '抢修开始（完成时仅 50% 耐久）' : '施工开始'
      });
      return true;
    } catch (error) {
      this._restoreConstructionRollback(rollback, [`${operationId}:materials`]);
      this._showScreenTip(`施工检查点失败：${error?.message || error}，材料与施工状态已回滚。`, { title: '保存失败' });
      return false;
    } finally {
      this._constructionCheckpointBusy = false;
    }
  },

  async cancelS10Construction({ siteId } = {}) {
    if (this.currentSceneId !== 'S10' || !this.constructionSystem || this._constructionCheckpointBusy) return false;
    const siteKey = S10_CONSTRUCTION_SITE_KEYS[siteId];
    const pending = this.constructionSystem.getPending(siteId);
    if (!siteKey || !pending) {
      this._showScreenTip('此施工点没有可取消的在建工事。', { title: '无在建工事' });
      return false;
    }
    const rollback = this._captureConstructionRollback();
    const result = this.constructionSystem.cancel(siteId, 'cancelledByPlayer');
    if (result.status === 'refundPending') {
      this._showScreenTip('背包空间不足，材料尚未退回；清理空间后再次交互重试。', { title: '退款等待中' });
      return false;
    }
    const blackboard = this.gameLoader.blackboard;
    const story = cloneData(blackboard.get('storyState') || {});
    const pendingSites = { ...(story.s10Construction?.pendingSites || {}) };
    delete pendingSites[siteKey];
    blackboard.set('storyState', {
      ...story,
      s10Construction: { ...(story.s10Construction || {}), pendingSites },
      lastCheckpointId: `checkpoint.S10.constructionCancelled.${siteKey}`
    });
    this._constructionCheckpointBusy = true;
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: `checkpoint.S10.constructionCancelled.${siteKey}`, sceneId: 'S10'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      this._showScreenTip('施工已取消，托管材料已全部退回。', { title: '施工取消' });
      return true;
    } catch (error) {
      this._restoreConstructionRollback(rollback, [`${pending.operationId}:refund`]);
      this._showScreenTip(`取消施工保存失败：${error?.message || error}，状态已回滚。`, { title: '保存失败' });
      return false;
    } finally {
      this._constructionCheckpointBusy = false;
    }
  },
  async _checkpointS10ConstructionTerminal(results, rollback) {
    if (results.some(result => (result?.structure?.siteId || result?.siteId) === S06_FIELD_CONSTRUCTION_SITE_ID)) {
      return this.s06SceneCoordinator?._checkpointS06ConstructionTerminal(results, rollback) ?? false;
    }
    const blackboard = this.gameLoader?.blackboard;
    if (!blackboard || !rollback) return false;
    const beforeStory = cloneData(blackboard.get('storyState') || {});
    const construction = cloneData(beforeStory.s10Construction || {});
    construction.pendingSites = { ...(construction.pendingSites || {}) };
    construction.completedSites = { ...(construction.completedSites || {}) };
    construction.cancelledSites = { ...(construction.cancelledSites || {}) };
    const rollbackOperationIds = [];

    for (const result of results) {
      const siteId = result?.structure?.siteId || result?.siteId;
      const siteKey = S10_CONSTRUCTION_SITE_KEYS[siteId];
      if (!siteKey) continue;
      delete construction.pendingSites[siteKey];
      if (result.status === 'completed') {
        construction.completedSites[siteKey] = true;
      } else {
        construction.cancelledSites[siteKey] = result.code || 'cancelled';
        if (result.code === 'toolBroken') {
          construction.toolBreakExperienced = true;
          construction.toolBreakSiteKey = siteKey;
        }
        rollbackOperationIds.push(`${result.operationId}:refund`);
      }
    }

    const allCompleted = ['campfire', 'barricade', 'simpleWall', 'arrowTower']
      .every(key => construction.completedSites[key] === true);
    construction.completed = allCompleted;
    construction.lastTerminalAtScene = 'S10';
    construction.effects = this._deriveS10ConstructionEffects();
    const completedCount = Object.values(construction.completedSites).filter(Boolean).length;
    const endingInputs = cloneData(beforeStory.endingInputs || {});
    endingInputs.resourceConstructionScore = Math.max(
      Math.floor(Number(endingInputs.resourceConstructionScore) || 0), completedCount
    );
    endingInputs.cityMaintenanceLevel = Math.max(
      Math.floor(Number(endingInputs.cityMaintenanceLevel) || 0), completedCount
    );
    const nextStory = {
      ...beforeStory,
      endingInputs,
      s10Construction: construction,
      month: allCompleted ? Math.max(10, Math.floor(Number(beforeStory.month) || 0)) : beforeStory.month,
      unlockedScenes: allCompleted
        ? [...new Set([...(beforeStory.unlockedScenes || []), 'S11'])]
        : beforeStory.unlockedScenes,
      pendingSceneId: allCompleted ? 'S11' : beforeStory.pendingSceneId,
      lastCheckpointId: allCompleted
        ? 'checkpoint.S10.constructionComplete'
        : 'checkpoint.S10.constructionTerminal'
    };
    blackboard.set('storyState', nextStory);

    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: nextStory.lastCheckpointId, sceneId: 'S10'
      });
      if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
      this._ensureS10StructureEntities();
      if (allCompleted) {
        this._showScreenTip('四类工事已全部完成，时间推进至十月，S11 广宗战场已经开放。', { title: '溪畔营地建成' });
      } else if (results.some(result => result.code === 'toolBroken')) {
        this._showScreenTip('旧铲在施工完成前折断，本次工事作废，全部材料已恢复。请换用完好的营建铁铲。', {
          title: '铲子损毁'
        });
      } else {
        const names = results.filter(result => result.status === 'completed')
          .map(result => this.constructionSystem.getDefinition(result.structure.definitionId)?.name)
          .filter(Boolean);
        this._showScreenTip(`${names.join('、') || '工事'}已完成并写入检查点。`, { title: '施工完成' });
      }
      return true;
    } catch (error) {
      this._restoreConstructionRollback(rollback, rollbackOperationIds);
      this._showScreenTip(`施工终态保存失败：${error?.message || error}，工具、熟练度、工事与材料已回滚。`, {
        title: '保存失败'
      });
      return false;
    }
  },
  _findS10ProjectedObject(objectId) {
    const projected = (this._worldLoadResult?.sceneObjects || []).find(object => object?.id === objectId);
    if (projected) return projected;
    const chunk = this._worldLoadSession?.getChunk?.('S10');
    for (const layer of chunk?.sceneData?.layers || []) {
      const source = (layer.objects || []).find(object => object?.id === objectId);
      if (!source) continue;
      return {
        ...source,
        x: Number(source.x) + (Number(chunk.offset?.x) || 0),
        y: Number(source.y) + (Number(chunk.offset?.y) || 0)
      };
    }
    return null;
  },

  _ensureS10StructureEntities() {
    if (!this.constructionSystem || !this.entityFactory || !this.entityStore || !this.mannedStructureAdapter) return [];
    const created = [];
    for (const structure of this.constructionSystem.getStructures()) {
      const config = S10_STRUCTURE_BY_SITE[structure.siteId];
      if (!config) continue;
      const cached = this._s10StructureEntities.get(structure.siteId);
      if (cached && this.entityStore.all.includes(cached)) continue;
      if (cached) this._s10StructureEntities.delete(structure.siteId);
      const source = this._findS10ProjectedObject(config.markerId);
      const definition = this.constructionSystem.getDefinition(structure.definitionId);
      if (!source || !definition) continue;
      const entity = this.entityFactory.createBuilding({
        id: config.entityId,
        name: config.name,
        buildingType: config.buildingType,
        position: {
          x: Number(source.x) + (Number(source.width) || 0) / 2,
          y: Number(source.y) + (Number(source.height) || 0)
        },
        maxHp: structure.maxDurability,
        hp: structure.durability,
        team: 'yellow_turban',
        footprint: cloneData(config.footprint),
        controllable: config.controllable,
        imageId: definition.imageId,
        width: config.width,
        height: config.height
      });
      entity.tags = ['s10Construction', 'yellow_turban', config.buildingType];
      entity.constructionSiteId = structure.siteId;
      this.entityStore.add(entity);
      this._s10StructureEntities.set(structure.siteId, entity);
      if (config.controllable) {
        this.mannedStructureAdapter.registerStructure(entity, {
          vehicleType: 'mannedStructure:arrowTower',
          seats: [{ id: 'operator', role: 'gunner', offset: [0, -32] }]
        });
      }
      created.push(entity);
    }
    return created;
  },

  _disposeS10Structures() {
    for (const entity of this._s10StructureEntities?.values?.() || []) {
      const vehicle = entity?.getComponent?.('vehicle');
      for (const riderId of vehicle?.getRiders?.() || []) {
        const rider = this.entityStore?.all?.find?.(candidate => candidate?.id === riderId);
        if (rider) this.vehicleSystem?.dismount?.(rider);
      }
      if (this.mannedStructureAdapter?.isMannedStructure?.(entity)) {
        this.mannedStructureAdapter.unregisterStructure(entity);
      }
      this.entityStore?.remove?.(entity);
      try { entity?.destroy?.(); } catch (error) { /* best-effort lifecycle cleanup */ }
    }
    this._s10StructureEntities?.clear?.();
  },

  _syncS10StructureDomain(siteId = null) {
    const entries = siteId
      ? [[siteId, this._s10StructureEntities.get(siteId)]]
      : [...this._s10StructureEntities.entries()];
    for (const [id, entity] of entries) {
      const building = entity?.getComponent?.('building');
      if (!building) continue;
      this.constructionSystem?.synchronizeStructure?.({
        siteId: id,
        durability: Math.max(0, Math.floor(Number(building.hp) || 0)),
        destroyed: building.destroyed === true
      });
    }
  },

  _captureS10StructureStates() {
    // S10 作为邻格加载时只保存已有运行时或 provider 中的状态，不能为快照采集创建实体。
    if (this.currentSceneId === 'S10') this._ensureS10StructureEntities();
    this._syncS10StructureDomain();
    return [...this._s10StructureEntities.entries()].map(([siteId, entity]) => ({
      schemaVersion: 1,
      siteId,
      entityId: entity.id,
      building: cloneData(entity.getComponent?.('building')?.serialize?.() || null),
      manned: cloneData(this.mannedStructureAdapter?.captureState?.(entity) || null)
    }));
  },

  _validateS10StructureStates(states) {
    if (states == null) return { ok: true };
    if (!Array.isArray(states)) return { ok: false, code: 'invalidS10StructureStates' };
    const seen = new Set();
    for (let index = 0; index < states.length; index++) {
      const entry = states[index];
      const config = S10_STRUCTURE_BY_SITE[entry?.siteId];
      const hp = Number(entry?.building?.hp);
      const maxHp = Number(entry?.building?.maxHp);
      if (!config || seen.has(entry.siteId) || entry.entityId !== config.entityId
        || !Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0 || hp < 0 || hp > maxHp
        || (entry.manned && (entry.manned.schemaVersion !== 1 || !entry.manned.vehicle?.seats))) {
        return { ok: false, code: 'invalidS10StructureState', index };
      }
      seen.add(entry.siteId);
    }
    return { ok: true };
  },

  _restoreS10StructureStates(states = []) {
    this._disposeS10Structures();
    this._ensureS10StructureEntities();
    for (const entry of states || []) {
      const entity = this._s10StructureEntities.get(entry.siteId);
      const building = entity?.getComponent?.('building');
      if (!entity || !building) return { ok: false, code: 's10StructureRebuildFailed', siteId: entry.siteId };
      building.deserialize(cloneData(entry.building));
      this.mannedStructureAdapter?.syncStructure?.(entity);
    }
    for (const entry of states || []) {
      const entity = this._s10StructureEntities.get(entry.siteId);
      for (const [seatId, seat] of Object.entries(entry.manned?.vehicle?.seats || {})) {
        if (!seat?.riderId) continue;
        const rider = this.entityStore?.all?.find?.(candidate => candidate?.id === seat.riderId);
        if (!rider) return { ok: false, code: 's10StructureRiderMissing', riderId: seat.riderId };
        if (rider.hasComponent?.('rider')) this.vehicleSystem?.dismount?.(rider);
        if (!this.mannedStructureAdapter?.mount?.(rider, entity, seatId)) {
          return { ok: false, code: 's10StructureRiderRestoreFailed', riderId: seat.riderId };
        }
      }
    }
    return { ok: true };
  },
  _deriveS10ConstructionEffects() {
    const effects = {
      moraleBonus: 0,
      hungerDrainMultiplier: 1,
      enemyAdvanceSpeedMultiplier: 1,
      friendlyCasualtyMultiplier: 1,
      friendlyDefenseMultiplier: 1
    };
    for (const structure of this.constructionSystem?.getStructures?.() || []) {
      const definition = this.constructionSystem.getDefinition(structure.definitionId);
      const configured = definition?.warEffects || {};
      const alive = Number(structure.durability) > 0;
      if (alive) {
        effects.moraleBonus += Number(configured.moraleBonus) || 0;
        if (Number.isFinite(Number(configured.hungerDrainMultiplier))) {
          effects.hungerDrainMultiplier *= Number(configured.hungerDrainMultiplier);
        }
        if (Number.isFinite(Number(configured.enemyAdvanceSpeedMultiplier))) {
          effects.enemyAdvanceSpeedMultiplier *= Number(configured.enemyAdvanceSpeedMultiplier);
        }
        if (Number.isFinite(Number(configured.friendlyCasualtyMultiplier))) {
          effects.friendlyCasualtyMultiplier *= Number(configured.friendlyCasualtyMultiplier);
        }
        if (Number.isFinite(Number(configured.friendlyDefenseMultiplier))) {
          effects.friendlyDefenseMultiplier *= Number(configured.friendlyDefenseMultiplier);
        }
      } else if (Number.isFinite(Number(configured.destroyedDefenseMultiplier))) {
        effects.friendlyDefenseMultiplier *= Number(configured.destroyedDefenseMultiplier);
      }
    }
    return effects;
  },

  async _checkpointConstructionRepair(checkpoint = {}) {
    const structure = checkpoint.structure;
    const config = S10_STRUCTURE_BY_SITE[structure?.siteId];
    if (!config) {
      return this.requestAutoSave({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId,
        sceneId: checkpoint.context?.sceneId || this.currentSceneId
      });
    }
    this._ensureS10StructureEntities();
    const entity = this._s10StructureEntities.get(structure.siteId);
    const building = entity?.getComponent?.('building');
    const blackboard = this.gameLoader?.blackboard;
    if (!building || !blackboard) return { ok: false, code: 'repairProjectionUnavailable' };
    const beforeBuilding = cloneData(building.serialize());
    const beforeStory = cloneData(blackboard.get('storyState') || {});
    building.hp = Math.min(building.maxHp, Math.max(0, Number(structure.durability) || 0));
    building.destroyed = building.hp <= 0;
    this.mannedStructureAdapter?.syncStructure?.(entity);
    const siteKey = S10_CONSTRUCTION_SITE_KEYS[structure.siteId];
    const construction = cloneData(beforeStory.s10Construction || {});
    construction.repairAttempts = { ...(construction.repairAttempts || {}) };
    construction.repairAttempts[siteKey] = Math.max(
      Number(construction.repairAttempts[siteKey]) || 0,
      Number(checkpoint.context?.attempt) || 0
    );
    construction.effects = this._deriveS10ConstructionEffects();
    construction.lastRepair = {
      siteId: structure.siteId,
      operationId: checkpoint.operationId,
      durability: structure.durability
    };
    construction.repairedSites = { ...(construction.repairedSites || {}), [siteKey]: true };
    const endingInputs = cloneData(beforeStory.endingInputs || {});
    const completedCount = Object.values(construction.completedSites || {}).filter(Boolean).length;
    const repairedCount = Object.values(construction.repairedSites).filter(Boolean).length;
    endingInputs.resourceConstructionScore = Math.max(
      Math.floor(Number(endingInputs.resourceConstructionScore) || 0), completedCount
    );
    endingInputs.cityMaintenanceLevel = Math.max(
      Math.floor(Number(endingInputs.cityMaintenanceLevel) || 0), completedCount + repairedCount
    );
    blackboard.set('storyState', {
      ...beforeStory,
      endingInputs,
      s10Construction: construction,
      lastCheckpointId: checkpoint.checkpointId
    });
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: 'S10'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointRejected');
      return saved;
    } catch (error) {
      building.deserialize(beforeBuilding);
      this.mannedStructureAdapter?.syncStructure?.(entity);
      blackboard.set('storyState', beforeStory);
      return { ok: false, code: 'repairCheckpointRejected', message: String(error?.message || error) };
    }
  },

  async repairS10Structure({ siteId, amount = 50 } = {}) {
    if (this.currentSceneId !== 'S10' || this._s10StructureInteractionBusy) return false;
    this._ensureS10StructureEntities();
    const config = S10_STRUCTURE_BY_SITE[siteId];
    const entity = this._s10StructureEntities.get(siteId);
    const building = entity?.getComponent?.('building');
    if (!config || !building) {
      this._showScreenTip('此处还没有可维修的工事。', { title: '维修不可用' });
      return false;
    }
    this._syncS10StructureDomain(siteId);
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    const attempt = Math.max(0, Number(story.s10Construction?.repairAttempts?.[S10_CONSTRUCTION_SITE_KEYS[siteId]]) || 0) + 1;
    this._s10StructureInteractionBusy = true;
    try {
      const result = await this.constructionSystem.repair({
        siteId,
        amount: Math.max(1, Math.floor(Number(amount) || 50)),
        operationId: `repair:S10:${S10_CONSTRUCTION_SITE_KEYS[siteId]}:${attempt}`,
        checkpointId: `checkpoint.S10.repair.${S10_CONSTRUCTION_SITE_KEYS[siteId]}`,
        context: { sceneId: 'S10', attempt }
      });
      if (!result.ok) {
        const messages = {
          repairNotNeeded: '工事耐久已满，无需维修。',
          structureBusy: '该工事正在结算维修，请稍候。',
          repairRolledBack: '维修检查点失败，耐久已恢复到维修前。'
        };
        this._showScreenTip(messages[result.code] || `维修失败：${result.code || 'unknown'}`, { title: '维修未完成' });
        return false;
      }
      this._showScreenTip(`${config.name}恢复 ${result.appliedAmount} 点耐久，当前 ${result.structure.durability}/${result.structure.maxDurability}。`, {
        title: '维修完成'
      });
      return true;
    } finally {
      this._s10StructureInteractionBusy = false;
    }
  },

  mountS10ArrowTower() {
    if (this.currentSceneId !== 'S10') return false;
    this._ensureS10StructureEntities();
    const tower = this._s10StructureEntities.get(S10_STRUCTURE_CONFIG.arrowTower.siteId);
    const mounted = this.mannedStructureAdapter?.mount?.(this.playerEntity, tower, 'operator') === true;
    this._showScreenTip(mounted ? '已进入箭楼武器席，攻击意图将路由到箭楼。' : '箭楼席位不可用或已被占用。', {
      title: mounted ? '进入箭楼' : '无法进入箭楼'
    });
    return mounted;
  },

  leaveS10ArrowTower() {
    const left = this.mannedStructureAdapter?.dismount?.(this.playerEntity) === true;
    if (left) this._showScreenTip('已离开箭楼，席位已释放。', { title: '离开箭楼' });
    return left;
  },
  async interactS10Structure(params = {}) {
    const siteId = String(params.siteId || '');
    if (this.playerEntity?.hasComponent?.('rider')) return this.leaveS10ArrowTower();
    const structure = this.constructionSystem?.getStructure?.(siteId);
    if (!structure) return this.startS10Construction(params);
    this._ensureS10StructureEntities();
    const building = this._s10StructureEntities.get(siteId)?.getComponent?.('building');
    if (building && building.hp < building.maxHp) return this.repairS10Structure({ siteId, amount: params.repairAmount });
    if (siteId === S10_STRUCTURE_CONFIG.arrowTower.siteId) return this.mountS10ArrowTower();
    const config = S10_STRUCTURE_BY_SITE[siteId];
    this._showScreenTip(`${config?.name || '工事'}耐久 ${building?.hp || structure.durability}/${building?.maxHp || structure.maxDurability}。`, {
      title: '工事状态'
    });
    return true;
  },

  async checkS10Exit() {
    if (this.currentSceneId !== 'S10') return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    const pending = this.constructionSystem?.serialize?.().pending || [];
    this._ensureS10StructureEntities();
    const allRebuilt = Object.values(S10_STRUCTURE_CONFIG)
      .every(config => this._s10StructureEntities.has(config.siteId));
    if (story.s10Construction?.completed !== true || pending.length > 0 || !allRebuilt) {
      this._showScreenTip('完成四类工事并等待所有施工结算后，才能前往广宗。', { title: '尚未完成迁营' });
      return false;
    }
    const regionIndex = this._findRegionIndexForScene('S11');
    if (regionIndex < 0) return false;
    if (regionIndex !== this._currentRegionIndex) {
      const result = await this.travelToRegion({ regionIndex, sceneId: 'S11', spawnRef: 'player' });
      return result?.ok === true;
    }
    const result = await this.teleportToChunk({ scene: 'S11', spawnRef: 'player', transition: 'fadeBlack' });
    return result !== false && !result?.cancelled;
  }
};

export class S10ConstructionCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, s10ConstructionMethods, { name: 'S10ConstructionCoordinator' });
  }

  projectBattleDefinition(definition, sceneId) {
    return this._projectS10ConstructionEffects(definition, sceneId);
  }

  applyBattleEffects(definition, sceneId) {
    return this._applyS10ConstructionBattleEffects(definition, sceneId);
  }
}

export default S10ConstructionCoordinator;
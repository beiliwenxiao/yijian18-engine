/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/** Canonical scene battle-flow metadata registry. */
export const SCENE_BATTLE_FLOW_STRING_FIELDS = Object.freeze([
  'locationName', 'unavailableMessage', 'conflictMessage', 'activeMessage',
  'appliedTitle', 'resultTitle', 'resultMessage', 'settlementMessage',
  'interventionMessage', 'resolvedKey', 'winnerKey', 'checkpointId'
]);

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function collectBattleIds(definitions) {
  if (definitions == null) return null;
  if (!Array.isArray(definitions)) throw new TypeError('battleDefinitions must be an array');
  return new Set(definitions.map(entry => entry?.battleId).filter(Boolean));
}

export class SceneBattleFlowRegistry {
  constructor() {
    this._bySceneId = new Map();
    this._byBattleId = new Map();
  }

  _validate(sceneData, battleDefinitions = null) {
    const sceneId = String(sceneData?.id || '').trim();
    const battleId = String(sceneData?.gameplay?.battleId || '').trim();
    const source = sceneData?.gameplay?.battleFlow;
    if (!sceneId) throw new Error('sceneBattleFlowMissingSceneId');
    if (!battleId) throw new Error(`sceneBattleFlowMissingBattleId:${sceneId}`);
    if (!isRecord(source)) throw new Error(`sceneBattleFlowMissingConfig:${sceneId}`);
    for (const field of SCENE_BATTLE_FLOW_STRING_FIELDS) {
      if (typeof source[field] !== 'string' || !source[field].trim()) {
        throw new Error(`sceneBattleFlowInvalidField:${sceneId}.gameplay.battleFlow.${field}`);
      }
    }
    if (!isRecord(source.worldChanges)) {
      throw new Error(`sceneBattleFlowInvalidField:${sceneId}.gameplay.battleFlow.worldChanges`);
    }
    const knownBattleIds = collectBattleIds(battleDefinitions);
    if (knownBattleIds && !knownBattleIds.has(battleId)) {
      throw new Error(`sceneBattleFlowUnknownBattleId:${sceneId}:${battleId}`);
    }
    return deepFreeze({ ...cloneValue(source), sceneId, battleId, worldChanges: cloneValue(source.worldChanges) });
  }

  validate(sceneData, battleDefinitions = null) {
    return this._validate(sceneData, battleDefinitions);
  }

  register(sceneData, battleDefinitions = null) {
    const flow = this.validate(sceneData, battleDefinitions);
    if (this._bySceneId.has(flow.sceneId)) throw new Error(`duplicateSceneBattleFlow:${flow.sceneId}`);
    if (this._byBattleId.has(flow.battleId)) throw new Error(`duplicateBattleFlowId:${flow.battleId}`);
    this._bySceneId.set(flow.sceneId, flow);
    this._byBattleId.set(flow.battleId, flow);
    return flow;
  }

  registerMany(sceneDataList, battleDefinitions = null) {
    if (!Array.isArray(sceneDataList)) throw new TypeError('sceneDataList must be an array');
    const bySceneId = new Map();
    const byBattleId = new Map();
    for (const sceneData of sceneDataList) {
      const flow = this._validate(sceneData, battleDefinitions);
      if (bySceneId.has(flow.sceneId)) throw new Error(`duplicateSceneBattleFlow:${flow.sceneId}`);
      if (byBattleId.has(flow.battleId)) throw new Error(`duplicateBattleFlowId:${flow.battleId}`);
      bySceneId.set(flow.sceneId, flow);
      byBattleId.set(flow.battleId, flow);
    }
    this._bySceneId = bySceneId;
    this._byBattleId = byBattleId;
    return this.list();
  }

  getBySceneId(sceneId) { return this._bySceneId.get(sceneId) || null; }
  getByBattleId(battleId) { return this._byBattleId.get(battleId) || null; }
  list() { return [...this._bySceneId.values()]; }

  clear() {
    this._bySceneId.clear();
    this._byBattleId.clear();
  }
}

export default SceneBattleFlowRegistry;
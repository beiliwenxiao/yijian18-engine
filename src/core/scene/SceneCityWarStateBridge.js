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

/**
 * Bridges CityWarSystem drafts to a scene Blackboard and live resource-node projections.
 * Domain settlement remains owned by CityWarSystem; this class only owns projection,
 * exact rollback, and synchronization of the committed state to loaded scene entities.
 */
const cloneValue = value => value == null ? value : JSON.parse(JSON.stringify(value));
const clampRatio = value => Math.min(1, Math.max(0, Number(value) || 0));

export class SceneCityWarStateBridge {
  constructor(config = {}) {
    this.getBlackboard = config.getBlackboard || (() => null);
    this.getConfiguredResourceNodes = config.getConfiguredResourceNodes || (() => []);
    this.getEntities = config.getEntities || (() => []);
    this.updatePendingResourceNodes = config.updatePendingResourceNodes || (() => 0);
    this.getActiveBattle = config.getActiveBattle || (() => null);
    this.getBattleFlowById = config.getBattleFlowById || (() => null);
    this.getBattleFlows = config.getBattleFlows || (() => []);
  }

  read() {
    const blackboard = this.getBlackboard();
    const configuredNodes = (this.getConfiguredResourceNodes() || []).map(node => ({
      id: node.id,
      damageRatio: clampRatio(node.damageRatio)
    }));
    const savedNodes = blackboard?.get?.('warResourceNodeStates');
    return cloneValue({
      storyState: blackboard?.get?.('storyState') || {},
      cityStates: blackboard?.get?.('cityStates') || [],
      warState: blackboard?.get?.('warState') || { battles: {}, casualties: {} },
      appliedBattleResultIds: blackboard?.get?.('appliedBattleResultIds') || [],
      resourceNodes: Array.isArray(savedNodes) && savedNodes.length ? savedNodes : configuredNodes
    });
  }

  project(state) {
    const projected = cloneValue(state || {});
    const active = this.getActiveBattle() || {};
    if (active.battleId && !this.getBattleFlowById(active.battleId)) {
      throw new Error(`unknownBattleId:${active.battleId}`);
    }
    const battleModes = { ...(projected.storyState?.battleModes || {}) };
    if (active.battleId && active.mode) battleModes[active.battleId] = active.mode;
    projected.storyState = { ...(projected.storyState || {}), battleModes };

    for (const flow of this.getBattleFlows() || []) {
      const result = projected.warState?.battles?.[flow.battleId];
      if (!result) continue;
      projected.storyState = {
        ...projected.storyState,
        [flow.resolvedKey]: true,
        [flow.winnerKey]: result.winnerFactionId,
        lastCheckpointId: flow.checkpointId
      };
      const minimumMonth = Number(flow.worldChanges?.month);
      if (Number.isFinite(minimumMonth)) {
        projected.storyState.month = Math.max(
          minimumMonth,
          Math.floor(Number(projected.storyState.month) || 0)
        );
      }
    }
    return projected;
  }

  commit(draft) {
    const blackboard = this.getBlackboard();
    if (!blackboard) return false;
    const beforeBlackboard = cloneValue(blackboard.serialize?.() || null);
    const beforeNodes = this.read().resourceNodes;
    try {
      this._write(this.project(draft));
      return true;
    } catch (_error) {
      if (beforeBlackboard && blackboard.deserialize) blackboard.deserialize(beforeBlackboard);
      this.syncResourceNodes(beforeNodes);
      return false;
    }
  }

  /** Restore an already captured domain state exactly; never re-project active battle facts. */
  restore(before) {
    const blackboard = this.getBlackboard();
    if (!blackboard || !before) return false;
    const rollbackBlackboard = cloneValue(blackboard.serialize?.() || null);
    const rollbackNodes = this.read().resourceNodes;
    try {
      this._write(cloneValue(before));
      return true;
    } catch (_error) {
      if (rollbackBlackboard && blackboard.deserialize) blackboard.deserialize(rollbackBlackboard);
      this.syncResourceNodes(rollbackNodes);
      return false;
    }
  }

  syncResourceNodes(states = []) {
    const byId = new Map((states || []).map(state => [state?.id, state]));
    for (const entity of this.getEntities() || []) {
      const node = entity?.getComponent?.('resourceNode');
      const state = byId.get(entity?.id);
      if (node && state) node.damageRatio = clampRatio(state.damageRatio);
    }
    this.updatePendingResourceNodes((pending, id) => {
      const state = byId.get(id);
      if (!state) return false;
      pending.damageRatio = clampRatio(state.damageRatio);
      return true;
    });
    return true;
  }

  _write(state) {
    const blackboard = this.getBlackboard();
    if (!blackboard) throw new Error('cityWarBlackboardUnavailable');
    const resourceNodes = cloneValue(state.resourceNodes || []);
    blackboard.set('storyState', cloneValue(state.storyState || {}));
    blackboard.set('cityStates', cloneValue(state.cityStates || []));
    blackboard.set('warState', cloneValue(state.warState || { battles: {}, casualties: {} }));
    blackboard.set('appliedBattleResultIds', cloneValue(state.appliedBattleResultIds || []));
    blackboard.set('warResourceNodeStates', resourceNodes);
    this.syncResourceNodes(resourceNodes);
  }
}

export default SceneCityWarStateBridge;
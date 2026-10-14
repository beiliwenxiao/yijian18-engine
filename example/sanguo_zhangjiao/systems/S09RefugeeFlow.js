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
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { CityStateSummaryPanel } from '../../../src/ui/CityStateSummaryPanel.js';

export const CITY_SCENE_ID = 'S09';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * S09 城市流程协调器。采粮政策仅在
 * GatheringSystem 的既有 prepare/commit/rollback 事务中投影 Story/City 结果，
 * coordinator 自身只持有可快照恢复的操作幂等记录。
 * （饥民争斗事件已于 S01/S02 剧情修订中整体移除，相关处理随之清退。）
 */
const methods = {
  _submit(definitionId, payload = {}) {
    const gateway = this.sceneRuntime?.commandGateway;
    const actorRef = this.playerEntity?.id;
    if (!gateway || !actorRef) return Promise.resolve({ ok: false, code: 'commandGatewayUnavailable' });
    this._s09CommandSequence = (this._s09CommandSequence || 0) + 1;
    return gateway.execute({
      intentType: 'state.transaction', actorRef,
      operationId: `story:${definitionId}:${this._s09CommandSequence}`,
      payload: { definitionId, ...payload }
    });
  },

  async acceptEnlistment() {
    const result = await methods._submit.call(this, 'story.s09.enlist');
    if (result.ok) this._showScreenTip('你已加入黄巾。前往战士、弓手或军师旗帜确认职业。');
    return result.ok === true;
  },

  advanceGameDay(days = 1) {
    const currentDay = this.timeSystem?.advanceDays?.(Math.max(1, Math.floor(Number(days) || 1)));
    if (!currentDay) return false;
    void this._onGameDayChanged(currentDay);
    return currentDay;
  }
};

export class S09RefugeeCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, methods, { name: 'S09RefugeeCoordinator' });
    this._unauthorizedHarvestOperations = new Set();
  }

  _onGameDayChanged(currentDay) {
    const day = Math.max(1, Math.floor(Number(currentDay) || 0));
    if (!day) return Promise.resolve(false);
    return Promise.resolve(this._submit('story.s09.day.advance', { day }))
      .then(result => result?.ok === true);
  }

  _getS09CityContext() {
    const blackboard = this.scene.gameLoader?.blackboard;
    const storyState = blackboard?.get?.('storyState') || null;
    const cityStates = blackboard?.get?.('cityStates');
    const city = Array.isArray(cityStates)
      ? cityStates.find(entry => entry?.id === 'city.s09_guangzong_camp') || null
      : null;
    return blackboard && storyState && city ? { blackboard, storyState, city } : null;
  }

  /** S09 只读城市摘要只投影已提交的 Blackboard 状态，不参与领域写入。 */
  installCitySummaryUI(gameLoader) {
    const scene = this.scene;
    if (!gameLoader?.blackboard || !scene.uiSystem) return false;
    const compact = scene.isMobileLayout === true;
    const width = compact ? Math.min(224, scene.logicalWidth - 24) : 270;
    const height = compact ? 112 : 126;
    const panel = new CityStateSummaryPanel({
      x: compact ? 12 : scene.logicalWidth - width - 16,
      y: 12,
      width,
      height,
      compact,
      visible: false,
      zIndex: 45,
      resolveImage: imageId => scene.assetManager?.getAsset?.(imageId) || null
    });
    scene.uiSystem.registerPanel('cityStateSummary', panel);
    Object.assign(scene.context.ui, { cityStateSummary: panel });
    scene.cityStateSummaryPanel = panel;
    this.updateCitySummary();
    scene.resourceScope?.track(() => {
      scene.uiSystem?.unregisterPanel?.('cityStateSummary');
      if (scene.context.ui.cityStateSummary === panel) scene.context.ui.cityStateSummary = null;
      if (scene.cityStateSummaryPanel === panel) scene.cityStateSummaryPanel = null;
    });
    return true;
  }

  updateCitySummary() {
    const scene = this.scene;
    const panel = scene.cityStateSummaryPanel;
    if (!panel) return false;
    if (scene.currentSceneId !== CITY_SCENE_ID) {
      panel.hide();
      return false;
    }
    const context = this._getS09CityContext();
    if (!context) {
      panel.hide();
      return false;
    }
    panel.setSnapshot({
      cityName: context.city.name,
      resources: context.city.resources,
      damageRatio: context.city.damageRatio,
      morale: context.city.morale,
      reputation: context.blackboard.get('reputation'),
      currentDay: scene.timeSystem?.getCurrentDay?.() || context.storyState.currentDay || 1,
      refugeeStatus: '饥民事已在山道了结',
      icons: {
        morale: 's09.ui.morale',
        reputation: 's09.ui.reputation',
        story: 's09.ui.storyChoice'
      }
    });
    panel.show();
    return true;
  }

  /** S09 历史采粮政策参与通用 GatheringSystem 的 prepare/commit/rollback 链。 */
  prepareUnauthorizedHarvestSettlement(context = {}) {
    const { operationId, node, owner } = context;
    const scene = this.scene;
    if (scene.currentSceneId !== CITY_SCENE_ID || node?.resourceType !== 'food') return null;
    if (!operationId) return { ok: false, code: 'missingGatheringOperationId' };
    if (this._unauthorizedHarvestOperations.has(operationId)) return { ok: true, idempotent: true };

    const blackboard = scene.gameLoader?.blackboard;
    const permissions = blackboard?.get?.('resourcePermissions') || {};
    if (permissions.S09?.food === true) return null;
    const cityStates = blackboard?.get?.('cityStates');
    const cityIndex = Array.isArray(cityStates)
      ? cityStates.findIndex(city => city?.id === 'city.s09_guangzong_camp')
      : -1;
    if (cityIndex < 0 || !owner?.id) return { ok: false, code: 'missingS09CityState' };
    const cityValidation = scene.gameLoader?.contentValidator?.validate?.(
      cityStates[cityIndex], 'city', `variables.cityStates[${cityIndex}]`
    );
    if (cityValidation && !cityValidation.ok) return { ok: false, code: 'invalidS09CityState' };
    const reputationBefore = Number(blackboard.get('reputation'));
    if (!Number.isFinite(reputationBefore)) return { ok: false, code: 'invalidReputation' };

    const storyBefore = cloneData(blackboard.get('storyState') || {});
    const guardIds = Array.isArray(node.guardUnitIds) ? node.guardUnitIds : [];
    const guards = guardIds
      .map(id => (scene.enemies || []).find(enemy => enemy?.id === id))
      .filter(Boolean);
    if (guards.length !== guardIds.length) return { ok: false, code: 'missingS09GranaryGuards' };
    const guardStates = guards.map(guard => ({
      guard,
      state: scene.aiSystem?.getRuntimeState?.(guard)
    }));

    return {
      ok: true,
      commit: () => {
        blackboard.set('reputation', Math.max(0, reputationBefore - 5));
        blackboard.set('storyState', {
          ...storyBefore,
          s09UnauthorizedHarvests: Math.max(0, Number(storyBefore.s09UnauthorizedHarvests) || 0) + 1
        });
        for (const guard of guards) {
          if (scene._isEntityDead(guard)) continue;
          if (!scene.aiSystem?.activateAI?.(guard, guard.aiType || 'aggressive')) {
            throw new Error(`无法激活粮仓哨兵: ${guard.id}`);
          }
        }
        this._unauthorizedHarvestOperations.add(operationId);
        return { ok: true };
      },
      rollback: () => {
        blackboard.set('reputation', reputationBefore);
        blackboard.set('storyState', storyBefore);
        for (const entry of guardStates) {
          if (entry.state) scene.aiSystem?.restoreRuntimeState?.(entry.guard, entry.state);
        }
        this._unauthorizedHarvestOperations.delete(operationId);
      }
    };
  }

  hasUnauthorizedHarvest(operationId) {
    return this._unauthorizedHarvestOperations.has(operationId);
  }

  captureUnauthorizedHarvestOperations() {
    return [...this._unauthorizedHarvestOperations];
  }

  restoreUnauthorizedHarvestOperations(operationIds = []) {
    this._unauthorizedHarvestOperations = new Set(
      (Array.isArray(operationIds) ? operationIds : [])
        .filter(operationId => typeof operationId === 'string' && operationId.length > 0)
        .slice(-256)
    );
  }
}

export default S09RefugeeCoordinator;
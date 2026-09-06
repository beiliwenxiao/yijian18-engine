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
 * 三国张角传 - P3.2 批次 E/F：S07 西华战场与 S08 西华余部场景编排
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { BattleMode, BattleState } from '../../../src/systems/BattleSystem.js';

export const S07_BATTLE_ID = 'battle.s07_xihua_delay';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

const s07s08Methods = {
  _getS07BattleDefinition() {
    return this.s03s14BattleCoordinator?.getDefinition?.(S07_BATTLE_ID) || null;
  },

  _getS07DelayPointDefinition(pointId) {
    return (this._getS07BattleDefinition()?.delayPoints || []).find(point => point?.id === pointId) || null;
  },

  _syncS07DelayWorldState() {
    const committed = this.gameLoader?.blackboard?.get?.('storyState')?.s07DelayPoints || {};
    for (const point of this._getS07BattleDefinition()?.delayPoints || []) {
      if (!point?.id || !point.collider) continue;
      this._terrainBinding?.setDynamicCollider?.({
        sceneId: 'S07',
        id: `S07-delay-${point.id}`,
        enabled: committed[point.id]?.committed === true,
        shape: cloneData(point.collider)
      });
    }
    return committed;
  },

  async commitS07DelayPoint({ pointId } = {}) {
    const point = this._getS07DelayPointDefinition(pointId);
    if (this.currentSceneId !== 'S07' || !point || this._s07PointBusy) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    const beforeCities = cloneData(blackboard?.get?.('cityStates') || []);
    if (!blackboard || beforeStory.yuzhouRoute?.routeId !== 'xihua') {
      this._showScreenTip('只有已锁定西华路线的队伍才能提交阻滞点。', { title: '路线状态不符' });
      return false;
    }
    if (beforeStory.s07DelayPoints?.[pointId]?.committed === true) {
      this._showScreenTip(`${point.label}已经完成，资源不会重复扣除。`, { title: '阻滞点已提交' });
      return true;
    }
    const battleSession = this.s03s14BattleCoordinator?.getSessionState?.() || {};
    if (battleSession.battleId !== S07_BATTLE_ID
      || battleSession.mode !== BattleMode.INTERVENE
      || ![BattleState.ACTIVE, BattleState.RESOLVED].includes(battleSession.state)) {
      this._showScreenTip('先在军令旗选择介入并启动西华战役；观战不能亲自布置阻滞。', { title: '无法提交阻滞点' });
      return false;
    }
    if (battleSession.state === BattleState.RESOLVED) {
      const frozen = battleSession.result;
      const applied = frozen?.resultId
        && (blackboard.get('appliedBattleResultIds') || []).includes(frozen.resultId);
      if (!applied) {
        this._showScreenTip('西华战果仍未写入检查点，请先在军令旗重试结算。', { title: '战果未保存' });
        return false;
      }
    }

    const cityIndex = beforeCities.findIndex(city => city?.id === 'city.s07_xihua');
    if (cityIndex < 0) {
      this._showScreenTip('西华 CityState 缺失，不能结算阻滞资源。', { title: '城市状态错误' });
      return false;
    }
    const city = cloneData(beforeCities[cityIndex]);
    const resources = { ...(city.resources || {}) };
    const cost = cloneData(point.cost || {});
    const missing = Object.entries(cost).find(([resource, amount]) => (
      !Number.isInteger(amount) || amount < 0 || Number(resources[resource] || 0) < amount
    ));
    if (missing) {
      this._showScreenTip(`${point.label}需要 ${missing[0]} ${missing[1]}，西华战略资源不足。`, { title: '阻滞资源不足' });
      return false;
    }
    for (const [resource, amount] of Object.entries(cost)) resources[resource] -= amount;
    city.resources = resources;
    const cityCheck = this.gameLoader?.contentValidator?.validate?.(
      city, 'city', `variables.cityStates[${cityIndex}]`
    );
    if (cityCheck && !cityCheck.ok) {
      this._showScreenTip(`${point.label}会产生非法 CityState，提交已拒绝。`, { title: '状态校验失败' });
      return false;
    }

    const draftCities = cloneData(beforeCities);
    draftCities[cityIndex] = city;
    const operationId = `story:S07:delay:${pointId}`;
    const draftStory = {
      ...beforeStory,
      visitedScenes: [...new Set([...(beforeStory.visitedScenes || []), 'S07'])],
      s07DelayPoints: {
        ...(beforeStory.s07DelayPoints || {}),
        [pointId]: { committed: true, pointId, cost, operationId }
      },
      lastCheckpointId: `checkpoint.S07.delay.${pointId}`
    };

    this._s07PointBusy = true;
    blackboard.set('cityStates', draftCities);
    blackboard.set('storyState', draftStory);
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: draftStory.lastCheckpointId, sceneId: 'S07'
      });
      if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
      this._syncS07DelayWorldState();
      const committedCount = Object.values(draftStory.s07DelayPoints)
        .filter(entry => entry?.committed === true).length;
      this._showScreenTip(
        `${point.label}已锁定，消耗 ${Object.entries(cost).map(([key, value]) => `${key} ${value}`).join('、')}。当前 ${committedCount}/3。`,
        { title: '阻滞点完成' }
      );
      return true;
    } catch (error) {
      blackboard.set('cityStates', beforeCities);
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`阻滞点保存失败：${error?.message || error}，资源与剧情状态已回滚。`, { title: '提交失败' });
      return false;
    } finally {
      this._s07PointBusy = false;
    }
  },

  _getAppliedS07BattleResult() {
    const blackboard = this.gameLoader?.blackboard;
    const result = blackboard?.get?.('warState')?.battles?.[S07_BATTLE_ID] || null;
    return result?.resultId && (blackboard?.get?.('appliedBattleResultIds') || []).includes(result.resultId)
      ? result
      : null;
  },

  _buildS07RouteResult({ story, city, battleResult, battleMode }) {
    const delayPointCount = (this._getS07BattleDefinition()?.delayPoints || [])
      .filter(point => story.s07DelayPoints?.[point.id]?.committed === true).length;
    const yellowTurbanWon = battleResult.winnerFactionId === 'yellow_turban';
    const survivorCount = Math.min(60, Math.max(0,
      (battleMode === BattleMode.INTERVENE ? 28 : 18)
      + delayPointCount * 6
      + (yellowTurbanWon ? 8 : 0)
    ));
    const resources = city?.resources || {};
    const carriedResources = {
      food: Math.min(18, Math.floor(Math.max(0, Number(resources.food) || 0) * 0.4)),
      wood: Math.min(12, Math.floor(Math.max(0, Number(resources.wood) || 0) * 0.5)),
      iron: Math.min(8, Math.floor(Math.max(0, Number(resources.iron) || 0) * 0.5)),
      herb: Math.min(6, Math.floor(Math.max(0, Number(resources.herb) || 0) * 0.5))
    };
    const pursuitIntensity = Math.min(5, Math.max(1,
      4 - delayPointCount + (yellowTurbanWon ? 0 : 1) + (battleMode === BattleMode.OBSERVE ? 1 : 0)
    ));
    return {
      schemaVersion: 1,
      battleResultId: battleResult.resultId,
      battleMode,
      winnerFactionId: battleResult.winnerFactionId,
      delayPointCount,
      survivorCount,
      carriedResources,
      pursuitIntensity,
      frozenAtCheckpointId: 'checkpoint.S07.routeResult'
    };
  },

  async checkS07Exit({ sceneId = 'S08', spawnRef = 'player', transition = 'fadeBlack' } = {}) {
    if (this.currentSceneId !== 'S07' || this._s07ExitBusy) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    if (!blackboard || beforeStory.yuzhouRoute?.routeId !== 'xihua') return false;
    const battleResult = this._getAppliedS07BattleResult();
    if (!battleResult) {
      this._showScreenTip('先完成西华战役并让战果成功写入检查点。', { title: '尚不能撤离' });
      return false;
    }
    const currentBattle = this.s03s14BattleCoordinator?.getSessionState?.() || {};
    const battleMode = beforeStory.battleModes?.[S07_BATTLE_ID]
      || (currentBattle.battleId === S07_BATTLE_ID ? currentBattle.mode : null);
    const pointDefinitions = this._getS07BattleDefinition()?.delayPoints || [];
    const committedCount = pointDefinitions
      .filter(point => beforeStory.s07DelayPoints?.[point.id]?.committed === true).length;
    if (battleMode === BattleMode.INTERVENE && committedCount !== pointDefinitions.length) {
      this._showScreenTip(`介入路线还需完成 ${pointDefinitions.length - committedCount} 处阻滞点。`, { title: '三线尚未完成' });
      return false;
    }
    if (![BattleMode.OBSERVE, BattleMode.INTERVENE].includes(battleMode)) {
      this._showScreenTip('西华参战方式缺失，不能冻结残部结果。', { title: '战役状态错误' });
      return false;
    }
    if (!this._worldLoadSession?.getChunk?.(sceneId)
      || !this._worldLoadSession?.findSpawn?.(sceneId, spawnRef)) {
      this._showScreenTip(`${sceneId} 区块或玩家出生点缺失。`, { title: '西华余部路线不可用' });
      return false;
    }

    if (beforeStory.s07RouteResult?.battleResultId === battleResult.resultId) {
      const traveled = await this.teleportToChunk({ scene: sceneId, spawnRef, transition });
      return traveled !== false && !traveled?.cancelled;
    }
    const city = (blackboard.get('cityStates') || []).find(entry => entry?.id === 'city.s07_xihua');
    if (!city) return false;
    const routeResult = this._buildS07RouteResult({ story: beforeStory, city, battleResult, battleMode });
    const draftStory = {
      ...beforeStory,
      visitedScenes: [...new Set([...(beforeStory.visitedScenes || []), 'S07'])],
      unlockedScenes: [...new Set([...(beforeStory.unlockedScenes || []), sceneId])],
      s07RouteResult: routeResult,
      s07Resolved: true,
      lastCheckpointId: 'checkpoint.S07.routeResult'
    };

    this._s07ExitBusy = true;
    blackboard.set('storyState', draftStory);
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S07.routeResult', sceneId: 'S07'
      });
      if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
    } catch (error) {
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`残部结果保存失败：${error?.message || error}，可在出口重试。`, { title: '撤离失败' });
      this._s07ExitBusy = false;
      return false;
    }
    try {
      const traveled = await this.teleportToChunk({ scene: sceneId, spawnRef, transition });
      if (traveled === false || traveled?.cancelled) throw new Error('sceneTransitionCancelled');
      this.s03s14BattleCoordinator.closeUi();
      this._showScreenTip(
        `西华残部 ${routeResult.survivorCount} 人、追兵强度 ${routeResult.pursuitIntensity} 已冻结。`,
        { title: 'S08·西华余部' }
      );
      return true;
    } catch (error) {
      this._showScreenTip(`残部结果已保存，但前往 S08 失败：${error?.message || error}。可在出口重试。`, { title: '场景切换失败' });
      return false;
    } finally {
      this._s07ExitBusy = false;
    }
  },

  openS08RetreatChoice() {
    if (this.currentSceneId !== 'S08' || !this.irreversibleChoiceView) return false;
    const story = this.gameLoader?.blackboard?.get?.('storyState') || {};
    const routeResult = story.s07RouteResult;
    if (!routeResult) {
      this._showScreenTip('缺少 S07 残部结果，不能决定马车撤退方式。', { title: '前置状态缺失' });
      return false;
    }
    if (story.s08RetreatDecision?.committed === true) {
      const label = story.s08RetreatDecision.choiceId === 'discard' ? '丢弃物资' : '保留物资';
      this._showScreenTip(`西华撤退决策已锁定为“${label}”，不能重复改变残部。`, { title: '决策已完成' });
      return true;
    }
    const resourceText = Object.entries(routeResult.carriedResources || {})
      .map(([key, value]) => `${key} ${value}`).join('、');
    this.irreversibleChoiceView.open({
      title: '西华余部·泥泞马车',
      description: `现有残部 ${routeResult.survivorCount} 人，追兵强度 ${routeResult.pursuitIntensity}；马车装有 ${resourceText || '无物资'}。`,
      allowCancel: true,
      selectedId: 'discard',
      choices: [
        { id: 'discard', label: '丢弃物资', consequences: ['放弃全部木铁与一半粮药', '残部 +8', '追兵强度 -2'] },
        { id: 'preserve', label: '保留物资', consequences: ['保留全部战略物资', '残部 -4', '追兵强度 +1'] }
      ]
    });
    return true;
  },

  async _handleS08RetreatChoiceCommand(command = {}) {
    if (command.type === 'cancel') {
      if (!this._s08DecisionBusy) this.irreversibleChoiceView?.close?.();
      return true;
    }
    if (command.type !== 'selectChoice') return false;
    return this._commitS08RetreatChoice(command.choiceId);
  },

  async _commitS08RetreatChoice(choiceId) {
    if (this.currentSceneId !== 'S08' || this._s08DecisionBusy
      || !['discard', 'preserve'].includes(choiceId)) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    if (!blackboard || !beforeStory.s07RouteResult) return false;
    if (beforeStory.s08RetreatDecision?.committed === true) return this.openS08RetreatChoice();

    const routeResult = beforeStory.s07RouteResult;
    const originalResources = cloneData(routeResult.carriedResources || {});
    const finalResources = choiceId === 'discard'
      ? {
          food: Math.floor(Number(originalResources.food) / 2),
          wood: 0,
          iron: 0,
          herb: Math.floor(Number(originalResources.herb) / 2)
        }
      : originalResources;
    const finalResult = {
      ...cloneData(routeResult),
      survivorCount: Math.max(0, Number(routeResult.survivorCount) + (choiceId === 'discard' ? 8 : -4)),
      carriedResources: finalResources,
      pursuitIntensity: Math.min(5, Math.max(0,
        Number(routeResult.pursuitIntensity) + (choiceId === 'discard' ? -2 : 1)
      )),
      retreatChoiceId: choiceId,
      frozenAtCheckpointId: 'checkpoint.S08.retreatDecision'
    };
    const operationId = `story:S08:retreat:${choiceId}`;
    const draftStory = {
      ...beforeStory,
      visitedScenes: [...new Set([...(beforeStory.visitedScenes || []), 'S08'])],
      s08RetreatDecision: { committed: true, choiceId, operationId },
      s08RouteResult: finalResult,
      s08Resolved: true,
      lastCheckpointId: 'checkpoint.S08.retreatDecision'
    };

    this._s08DecisionBusy = true;
    this.irreversibleChoiceView?.setBusy?.(true);
    blackboard.set('storyState', draftStory);
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S08.retreatDecision', sceneId: 'S08'
      });
      if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
      this.irreversibleChoiceView?.close?.();
      this._showScreenTip(
        choiceId === 'discard'
          ? '绳索被割断，木铁陷在泥里；更多人甩开了追兵。'
          : '众人推着马车继续前进，物资保住了，但队伍付出了伤亡。',
        { title: choiceId === 'discard' ? '丢车保人' : '保留物资' }
      );
      return true;
    } catch (error) {
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`撤退决策保存失败：${error?.message || error}，残部状态已回滚。`, { title: '提交失败' });
      return false;
    } finally {
      this._s08DecisionBusy = false;
      this.irreversibleChoiceView?.setBusy?.(false);
    }
  },

  async completeS08Recall() {
    if (this.currentSceneId !== 'S08' || this._s08RecallBusy) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    if (!blackboard || beforeStory.s08RetreatDecision?.committed !== true || !beforeStory.s08RouteResult) {
      this._showScreenTip('先在泥泞马车旁完成残部撤退决策。', { title: '尚不能响应召回' });
      return false;
    }

    if (beforeStory.messengerRecallReceived !== true) {
      const draftStory = {
        ...beforeStory,
        visitedScenes: [...new Set([...(beforeStory.visitedScenes || []), 'S08'])],
        messengerRecallReceived: true,
        s08Resolved: true,
        month: Math.max(8, Math.floor(Number(beforeStory.month) || 0)),
        pendingSceneId: 'S10',
        s08RecallOperationId: 'story:S08:messengerRecall',
        lastCheckpointId: 'checkpoint.S08.messengerRecall'
      };
      this._s08RecallBusy = true;
      blackboard.set('storyState', draftStory);
      try {
        const saved = await this.requestAutoSave({
          reason: 'checkpoint', checkpointId: 'checkpoint.S08.messengerRecall', sceneId: 'S08'
        });
        if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
      } catch (error) {
        blackboard.set('storyState', beforeStory);
        this._showScreenTip(`信使召回保存失败：${error?.message || error}，召回状态已回滚。`, { title: '提交失败' });
        this._s08RecallBusy = false;
        return false;
      }
      this._s08RecallBusy = false;
    }

    const regionIndex = this._findRegionIndexForScene('S10');
    if (regionIndex < 0) {
      this._showScreenTip('大贤良师病重，召回检查点已保存；S10 广城外围尚未登记，完成内容后可从此处继续。', {
        title: '冀州急召'
      });
      return true;
    }
    this._s08RecallBusy = true;
    try {
      const traveled = await this.travelToRegion({ regionIndex, sceneId: 'S10', spawnRef: 'player' });
      return traveled?.ok === true;
    } finally {
      this._s08RecallBusy = false;
    }
  }
};

export class S07S08Coordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, s07s08Methods, { name: 'S07S08Coordinator' });
  }
}

export default S07S08Coordinator;
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
 * 三国张角传 - P3.2 批次 D：S06 宛城围攻场景编排
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { BattleMode } from '../../../src/systems/BattleSystem.js';
import { S05_BATTLE_ID, S05_ZHANG_MANCHENG_RESCUE_ID } from './S05SceneFlow.js';

export const S06_FIELD_CONSTRUCTION_SITE_ID = 'site.s06.field_barricade';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

const s06Methods = {
  async startS06FieldConstruction() {
    if (this.currentSceneId !== 'S06' || !this.constructionSystem || this._constructionCheckpointBusy) return false;
    const blackboard = this.gameLoader?.blackboard;
    const story = cloneData(blackboard?.get?.('storyState') || {});
    if (!blackboard || story.s06Decision?.committed === true) {
      this._showScreenTip('守撤决策已经锁定，不能再开始临时工事。', { title: '施工已关闭' });
      return false;
    }
    if (story.s06Construction?.toolBreakExperienced === true) {
      this._showScreenTip('旧铲损毁和材料退回已经结算，请到军令旗决定守撤。', { title: '临时工事已作废' });
      return true;
    }
    const pending = this.constructionSystem.getPending(S06_FIELD_CONSTRUCTION_SITE_ID);
    if (pending?.status === 'refundPending') {
      const refundRollback = this.s10ConstructionCoordinator._captureConstructionRollback();
      const retried = this.constructionSystem.retryRefund(S06_FIELD_CONSTRUCTION_SITE_ID);
      if (retried.status !== 'cancelled') {
        this._showScreenTip('清理背包空间后才能退回工事材料。', { title: '退款等待中' });
        return false;
      }
      this._constructionCheckpointBusy = true;
      try {
        return await this._checkpointS06ConstructionTerminal([retried], refundRollback);
      } finally {
        this._constructionCheckpointBusy = false;
      }
    } else if (pending) {
      this._showScreenTip(`拒马施工进度 ${Math.floor(pending.progress * 100)}%。旧铲只剩最后一点耐久。`, {
        title: '临时工事施工中'
      });
      return true;
    }
    const inventory = this.playerEntity?.getComponent?.('inventory');
    if (!inventory || !this.playerEntity?.id) return false;
    const attempt = Math.max(0, Math.floor(Number(story.s06Construction?.attempt) || 0)) + 1;
    const operationId = `construction:S06:fieldBarricade:${attempt}`;
    const rollback = this.s10ConstructionCoordinator._captureConstructionRollback();
    const cityDamageRatio = Number((blackboard.get('cityStates') || [])
      .find(city => city?.id === 'city.s05_wancheng')?.damageRatio) || 0;
    const started = this.constructionSystem.start({
      characterId: this.playerEntity.id,
      inventory,
      definitionId: 'construction.barricade',
      siteId: S06_FIELD_CONSTRUCTION_SITE_ID,
      operationId,
      cityDamageRatio,
      context: { sceneId: 'S06' }
    });
    if (!started.ok) {
      const message = started.code === 'materialsRequired'
        ? `缺少 ${started.itemId} × ${started.quantity}，材料未扣除。先拾取缺口旁的木铁。`
        : started.code === 'toolRequired'
          ? '缺少可用铲子，材料未扣除。先拾取缺口旁开裂的旧铲。'
          : `临时工事未开始：${started.code || 'unknown'}。材料未扣除。`;
      this._showScreenTip(message, { title: '施工前置不足' });
      return false;
    }
    blackboard.set('storyState', {
      ...story,
      s06Construction: {
        ...(story.s06Construction || {}),
        pending: true,
        attempt,
        siteId: S06_FIELD_CONSTRUCTION_SITE_ID,
        operationId
      },
      lastCheckpointId: 'checkpoint.S06.fieldConstructionStart'
    });
    this._constructionCheckpointBusy = true;
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S06.fieldConstructionStart', sceneId: 'S06'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      this._showScreenTip(`拒马开始施工，预计 ${Math.ceil(started.duration)} 秒；这把旧铲只剩 1 点耐久。`, {
        title: '宛城缺口抢修'
      });
      return true;
    } catch (error) {
      this.s10ConstructionCoordinator._restoreConstructionRollback(rollback, [`${operationId}:materials`]);
      this._showScreenTip(`临时工事保存失败：${error?.message || error}，材料和施工状态已回滚。`, { title: '保存失败' });
      return false;
    } finally {
      this._constructionCheckpointBusy = false;
    }
  },

  openS06DefenseChoice() {
    if (this.currentSceneId !== 'S06' || !this.irreversibleChoiceView) return false;
    const blackboard = this.gameLoader?.blackboard;
    const story = blackboard?.get?.('storyState') || {};
    if (story.zhangManchengSurvived !== true
      || story.rescueResults?.[S05_ZHANG_MANCHENG_RESCUE_ID]?.survived !== true) {
      this._showScreenTip('张曼成未能从 S05 存活，宛城延长战线无效。', { title: 'S06 不可用' });
      return false;
    }
    if (story.s06Construction?.toolBreakExperienced !== true) {
      this._showScreenTip('先到城墙缺口尝试修筑拒马，经历旧铲损毁与材料退回后再决定守撤。', {
        title: '先处理临时工事'
      });
      return false;
    }
    if (story.s06Decision?.committed === true) {
      const label = story.s06Decision.choiceId === 'hold' ? '继续坚守' : '主动撤离';
      this._showScreenTip(`宛城决策已锁定为“${label}”，不能重复扣除资源或改变城损。`, { title: '决策已完成' });
      return true;
    }
    const city = (blackboard?.get?.('cityStates') || []).find(entry => entry?.id === 'city.s05_wancheng');
    if (!city) {
      this._showScreenTip('宛城 CityState 缺失，不能评估防线。', { title: '城市状态错误' });
      return false;
    }
    this.irreversibleChoiceView.open({
      title: '宛城围攻·延长战线',
      description: `当前城损 ${Math.round(Number(city.damageRatio) * 100)}%，木材 ${city.resources?.wood || 0}，铁料 ${city.resources?.iron || 0}。`,
      allowCancel: true,
      selectedId: 'hold',
      choices: [
        {
          id: 'hold', label: '继续坚守',
          consequences: ['消耗城市木材 12', '消耗城市铁料 8', '城损 -5%', '士气 +8']
        },
        {
          id: 'withdraw', label: '主动撤离',
          consequences: ['不消耗修补资源', '城损 +12%', '士气 -10', '保存南阳战果后撤出']
        }
      ]
    });
    return true;
  },

  async _handleS06DefenseChoiceCommand(command = {}) {
    if (command.type === 'cancel') {
      if (!this._s06DecisionBusy) this.irreversibleChoiceView?.close?.();
      return true;
    }
    if (command.type !== 'selectChoice') return false;
    return this._commitS06DefenseChoice(command.choiceId);
  },

  async _commitS06DefenseChoice(choiceId) {
    if (this.currentSceneId !== 'S06' || this._s06DecisionBusy
      || !['hold', 'withdraw'].includes(choiceId)) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    const beforeCities = cloneData(blackboard?.get?.('cityStates') || []);
    if (beforeStory.s06Decision?.committed === true) return this.openS06DefenseChoice();
    const cityIndex = beforeCities.findIndex(entry => entry?.id === 'city.s05_wancheng');
    if (!blackboard || cityIndex < 0) return false;
    const city = cloneData(beforeCities[cityIndex]);
    const resources = { ...(city.resources || {}) };
    if (choiceId === 'hold' && (Number(resources.wood) < 12 || Number(resources.iron) < 8)) {
      this._showScreenTip('继续坚守至少需要城市木材 12、铁料 8；资源不足时只能撤离。', { title: '修补资源不足' });
      return false;
    }
    if (choiceId === 'hold') {
      resources.wood -= 12;
      resources.iron -= 8;
      city.damageRatio = Math.max(0, Number(city.damageRatio) - 0.05);
      city.morale = Math.min(100, Math.max(0, Number(city.morale) + 8));
    } else {
      city.damageRatio = Math.min(1, Number(city.damageRatio) + 0.12);
      city.morale = Math.min(100, Math.max(0, Number(city.morale) - 10));
    }
    city.resources = resources;
    const cityCheck = this.gameLoader?.contentValidator?.validate?.(city, 'city', `variables.cityStates[${cityIndex}]`);
    if (cityCheck && !cityCheck.ok) {
      this._showScreenTip('宛城决策会产生非法 CityState，提交已拒绝。', { title: '状态校验失败' });
      return false;
    }
    const draftCities = cloneData(beforeCities);
    draftCities[cityIndex] = city;
    const battleSession = this.s03s14BattleCoordinator?.getSessionState?.() || {};
    const nanyangIntervened = beforeStory.nanyangIntervened === true
      || (battleSession.battleId === S05_BATTLE_ID
        && battleSession.mode === BattleMode.INTERVENE);
    const endingInputs = cloneData(beforeStory.endingInputs || {});
    if (choiceId === 'withdraw') endingInputs.allowedCityDestruction = true;
    const draftStory = {
      ...beforeStory,
      endingInputs,
      visitedScenes: [...new Set([...(beforeStory.visitedScenes || []), 'S06'])],
      nanyangIntervened,
      s06Resolved: true,
      s06Decision: {
        committed: true,
        choiceId,
        cityId: city.id,
        resourceCost: choiceId === 'hold' ? { wood: 12, iron: 8 } : { wood: 0, iron: 0 },
        damageRatioAfter: city.damageRatio,
        moraleAfter: city.morale,
        operationId: `story:S06:defense:${choiceId}`
      },
      lastCheckpointId: 'checkpoint.S06.defenseDecision'
    };

    this._s06DecisionBusy = true;
    this.irreversibleChoiceView?.setBusy?.(true);
    blackboard.set('cityStates', draftCities);
    blackboard.set('storyState', draftStory);
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S06.defenseDecision', sceneId: 'S06'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      this.irreversibleChoiceView?.close?.();
      this._showScreenTip(
        choiceId === 'hold'
          ? '木铁被投入缺口，张曼成争来的一个月得以延续；南阳介入标志与城市状态已经保存。'
          : '你下令保存余部主动撤离，宛城损毁继续扩大；南阳战果已经保存。',
        { title: choiceId === 'hold' ? '宛城继续坚守' : '宛城主动撤离' }
      );
      return true;
    } catch (error) {
      blackboard.set('cityStates', beforeCities);
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`宛城决策保存失败：${error?.message || error}，城市与剧情状态已回滚。`, { title: '提交失败' });
      return false;
    } finally {
      this._s06DecisionBusy = false;
      this.irreversibleChoiceView?.setBusy?.(false);
    }
  },

  async completeS06Recall() {
    if (this.currentSceneId !== 'S06' || this._s06RecallBusy) return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    if (!blackboard || beforeStory.s06Decision?.committed !== true) {
      this._showScreenTip('先在宛城军令旗完成继续坚守或主动撤离决策。', { title: '尚不能响应召回' });
      return false;
    }
    if (beforeStory.yuzhouRoute?.routeId !== 'nanyang') return false;

    if (beforeStory.messengerRecallReceived !== true) {
      const draftStory = {
        ...beforeStory,
        messengerRecallReceived: true,
        s06Resolved: true,
        month: Math.max(8, Math.floor(Number(beforeStory.month) || 0)),
        pendingSceneId: 'S10',
        s06RecallOperationId: 'story:S06:messengerRecall',
        lastCheckpointId: 'checkpoint.S06.messengerRecall'
      };
      this._s06RecallBusy = true;
      blackboard.set('storyState', draftStory);
      try {
        const saved = await this.requestAutoSave({
          reason: 'checkpoint', checkpointId: 'checkpoint.S06.messengerRecall', sceneId: 'S06'
        });
        if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
      } catch (error) {
        blackboard.set('storyState', beforeStory);
        this._showScreenTip(`南阳召回保存失败：${error?.message || error}，状态已回滚。`, { title: '提交失败' });
        this._s06RecallBusy = false;
        return false;
      }
      this._s06RecallBusy = false;
    }

    const regionIndex = this._findRegionIndexForScene('S10');
    if (regionIndex < 0) {
      this._showScreenTip('南阳战果与召回检查点已保存，但 S10 尚未登记。', { title: '冀州急召' });
      return true;
    }
    this._s06RecallBusy = true;
    try {
      const traveled = await this.travelToRegion({ regionIndex, sceneId: 'S10', spawnRef: 'player' });
      return traveled?.ok === true;
    } finally {
      this._s06RecallBusy = false;
    }
  },

  async _checkpointS06ConstructionTerminal(results, rollback) {
    const blackboard = this.gameLoader?.blackboard;
    if (!blackboard || !rollback) return false;
    const result = results.find(entry => (
      entry?.structure?.siteId || entry?.siteId
    ) === S06_FIELD_CONSTRUCTION_SITE_ID);
    const beforeStory = cloneData(blackboard.get('storyState') || {});
    const completed = result?.status === 'completed';
    blackboard.set('storyState', {
      ...beforeStory,
      s06Construction: {
        ...(beforeStory.s06Construction || {}),
        pending: false,
        completed,
        toolBreakExperienced: result?.code === 'toolBroken'
          || beforeStory.s06Construction?.toolBreakExperienced === true,
        materialsRefunded: result?.refunded === true,
        terminalCode: result?.code || result?.status || 'unknown',
        operationId: result?.operationId || null
      },
      lastCheckpointId: 'checkpoint.S06.fieldConstruction'
    });
    try {
      const saved = await this.requestAutoSave({
        reason: 'checkpoint', checkpointId: 'checkpoint.S06.fieldConstruction', sceneId: 'S06'
      });
      if (!saved?.ok) throw new Error(saved?.message || 'checkpointFailed');
      if (completed) {
        await this.context.services.placements?.spawn({ group: 'S06-built-barricade' });
        this._showScreenTip('拒马已经完成，可回军令旗决定继续坚守或撤离。', { title: '临时工事完成' });
      } else {
        this._showScreenTip('旧铲在夯土时折断，拒马作废；木铁已全部退回。你只能带着这次损失重新评估守撤。', {
          title: '第一次失去铲子'
        });
      }
      return true;
    } catch (error) {
      this.s10ConstructionCoordinator._restoreConstructionRollback(rollback, [`${result?.operationId}:refund`]);
      this._showScreenTip(`S06 工事检查点失败：${error?.message || error}，材料和工具状态已回滚。`, { title: '保存失败' });
      return false;
    }
  }
};

export class S06SceneCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, s06Methods, { name: 'S06SceneCoordinator' });
  }
}

export default S06SceneCoordinator;
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

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

const commandMethods = {
  prepareSceneGatheringSettlement(context = {}) {
    const { node } = context;
    if (this.currentSceneId === 'S05' && node?.resourceType === 'iron') {
      return this.s05SceneCoordinator._prepareS05MineGatheringSettlement(context);
    }
    if (this.currentSceneId === 'S09' && node?.resourceType === 'food') {
      return this.s09RefugeeCoordinator.prepareUnauthorizedHarvestSettlement(context);
    }
    return null;
  },

  /** 将已通过场景政策的采集原子投影为结局隐藏输入，失败可完整回滚 StoryState。 */
  prepareGatheringSettlement(context = {}) {
    const scenePolicy = this.prepareSceneGatheringSettlement(context);
    if (scenePolicy?.ok === false || scenePolicy?.idempotent === true) return scenePolicy;
    const { operationId, node } = context;
    if (this.currentSceneId === 'S01'
      && ['resource.wild_berry', 'resource.wolf_hide'].includes(node?.itemId)) return scenePolicy;
    const resourceType = node?.resourceType;
    if (!operationId || !['wood', 'iron', 'food', 'herb'].includes(resourceType)) return scenePolicy;
    const blackboard = this.gameLoader?.blackboard;
    if (!blackboard) return { ok: false, code: 'storyStateUnavailable' };
    const storyBefore = cloneData(blackboard.get('storyState') || {});
    const applied = storyBefore.endingInputs?.gatheringOperations || [];
    if (applied.includes(operationId)) return { ok: true, idempotent: true };
    return {
      ok: true,
      commit: details => {
        const sceneResult = scenePolicy?.commit?.(details);
        if (sceneResult === false || sceneResult?.ok === false) {
          throw new Error(sceneResult?.code || 'sceneGatheringPolicyRejected');
        }
        const current = cloneData(blackboard.get('storyState') || storyBefore);
        const endingInputs = cloneData(current.endingInputs || {});
        const cumulative = cloneData(endingInputs.cumulativeGathering || { wood: 0, iron: 0, food: 0, herb: 0 });
        cumulative[resourceType] = Math.max(0, Math.floor(Number(cumulative[resourceType]) || 0))
          + Math.max(0, Math.floor(Number(details?.accepted) || 0));
        endingInputs.cumulativeGathering = cumulative;
        endingInputs.gatheringOperations = [...new Set([...(endingInputs.gatheringOperations || []), operationId])].slice(-512);
        blackboard.set('storyState', { ...current, endingInputs });
        return { ok: true };
      },
      rollback: () => {
        try { scenePolicy?.rollback?.(); } finally { blackboard.set('storyState', storyBefore); }
      }
    };
  },

  shouldForwardGatheringEvent(event, data = {}) {
    if (event !== 'completed' || data.idempotent !== true) return true;
    this._showScreenTip('该次采集已经结算，不会重复获得资源或扣除声望。');
    return false;
  },

  grantGatheringProficiency(data = {}) {
    if (Number(data.accepted) <= 0 || !data.operationId) return false;
    const definition = this.proficiencySystem?.getDefinition?.('gathering');
    const amount = Math.max(1, Math.floor(Number(data.accepted) * (definition?.experiencePerUnit || 1)));
    const result = this.proficiencySystem?.gainExperience?.({
      characterId: this.playerEntity?.id,
      type: 'gathering',
      amount,
      operationId: `gathering:${data.operationId}`
    });
    if (result?.ok === false) console.warn('[SanguoSceneCommandCoordinator] 采集熟练度提交失败:', result.code);
    return result?.ok !== false;
  },

  async handleGatheringEvent(event, data = {}) {
    if (event === 'completed' && (data.ok !== true || data.committed !== true)) return false;
    if (event === 'completed') {
      const depletedCorpse = Number(data.nodeRemaining) <= 0
        ? this.entityStore?.getById?.(data.nodeId)
        : null;
      if (this.currentSceneId === 'S01'
        && data.itemId === 'resource.wolf_hide'
        && depletedCorpse?.isCorpse === true) {
        const corpses = this.context?.services?.corpses || this.corpseRuntime;
        const decay = corpses?.startDecay?.(depletedCorpse, {
          durationSeconds: 20,
          operationId: data.operationId || data.gatheringOperationId || null
        });
        if (decay?.ok !== true) {
          console.warn('[SanguoSceneCommandCoordinator] 狼尸体衰减未启动，已提交剥皮不受影响', {
            result: decay || null,
            nodeId: data.nodeId || null,
            nodeRemaining: data.nodeRemaining,
            placementId: depletedCorpse.placementId || null,
            hasCorpseRuntime: !!corpses
          });
        }
      }
      const sourceOperationId = data.operationId || data.gatheringOperationId;
      if (!sourceOperationId) {
        console.warn('[SanguoSceneCommandCoordinator] 已提交采集缺少稳定 operationId，未发布 gathering.completed');
      } else {
        try {
          const published = await this.publishApplicationEvent('gathering.completed', cloneData(data), {
            operationId: `application:gathering.completed:${sourceOperationId}`,
            sceneId: this.currentSceneId
          });
          if (published?.ok !== true) {
            console.warn('[SanguoSceneCommandCoordinator] gathering.completed 发布失败，采集事实保持已提交', published);
          }
        } catch (error) {
          console.warn('[SanguoSceneCommandCoordinator] gathering.completed 发布异常，采集事实保持已提交', error);
        }
      }
    }
    if ((event === 'completed' || event === 'interrupted')
      && data.toolBroken === true
      && this._s05MinePendingSettlements.has(data.operationId)) {
      await this.s05SceneCoordinator._finalizeS05MineCollapse(data);
    }
    if (event === 'completed' && this.s09RefugeeCoordinator.hasUnauthorizedHarvest(data.operationId)) {
      this._showScreenTip('未获许可取走粮食：声望 -5，粮仓哨兵已被惊动。');
    }
    if (event === 'completed') this.grantGatheringProficiency(data);
    if (event === 'riskTriggered') {
      this.gameLoader?.triggerSystem?.fire?.('gatheringRisk', {
        riskId: data.id,
        riskType: data.type,
        nodeId: data.nodeId
      });
      return true;
    }
    // S01 剧情事务、placement 和 reveal event 全部成立后，教程辅助分支才消费完成信号。
    if (event === 'completed') this._tutorialFlow.notify('gatheringCompleted', data);
    return true;
  },

  /** reveal 补偿成功后恢复被延后的纯辅助分支，不重复提交采集业务事实。 */
  resumeGatheringAfterReveal(data = {}) {
    if (this.currentSceneId !== 'S01') return false;
    this.grantGatheringProficiency(data);
    this._tutorialFlow.notify('gatheringCompleted', data);
    return true;
  },

  /** 手柄/触屏方向攻击先交给 S14 武器席；消费后禁止乘员个人武器重复攻击。 */
  handleBasicAttackIntent(intent = {}) {
    return this.s11s14SceneCoordinator.handleBasicAttackIntent(intent) === true;
  },

  canPerformBasicAttack() {
    if (this.s11s14SceneCoordinator.handlePointerBasicAttack()) return false;
    return this.canPerformDefaultBasicAttack() || this._s01s02Coordinator.allowsTutorialBasicAttack();
  },

  handleIrreversibleChoice(command = {}) {
    const deathCountdown = this.playerDeathCountdown;
    if (deathCountdown?.awaitingConfirmation === true) {
      if (command.type !== 'selectChoice' || command.choiceId !== 'revive') return true;
      const view = this.irreversibleChoiceView;
      view?.setBusy?.(true);
      return deathCountdown.confirm().then(result => {
        if (result?.ok) view?.close?.();
        else {
          view?.setBusy?.(false);
          this._showScreenTip('复活结算失败，资源和死亡状态未改变，请再次确认。', { title: '复活失败' });
        }
        return result?.ok === true;
      });
    }
    if (this.currentSceneId === 'S06') return this.s06SceneCoordinator._handleS06DefenseChoiceCommand(command);
    if (this.currentSceneId === 'S08') return this.s07s08Coordinator._handleS08RetreatChoiceCommand(command);
    if (this.currentSceneId === 'S14') return this.s11s14SceneCoordinator._handleS14FinalDoctrineCommand(command);
    return this.s03s08Coordinator._handleS04RouteChoiceCommand(command);
  }
};

/** Routes historical scene commands without giving the Scene ownership of their rules. */
export class SanguoSceneCommandCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, commandMethods, { name: 'SanguoSceneCommandCoordinator' });
  }
}

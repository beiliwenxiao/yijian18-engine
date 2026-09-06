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
 * 三国张角传 - P4.1 S10 广城外围剧情检查点编排
 ************************************************************/

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';

const cloneData = value => value == null ? value : JSON.parse(JSON.stringify(value));

const s10StoryMethods = {
  async _commitS10StoryCheckpoint({ checkpointId, prepare, successTitle, successMessage }) {
    if (this.currentSceneId !== 'S10' || this._s10StoryBusy || typeof prepare !== 'function') return false;
    const blackboard = this.gameLoader?.blackboard;
    const beforeStory = cloneData(blackboard?.get?.('storyState') || {});
    if (!blackboard) return false;
    const prepared = prepare(beforeStory);
    if (prepared?.idempotent) {
      this._showScreenTip(prepared.message || successMessage, { title: successTitle });
      return true;
    }
    if (!prepared?.ok || !prepared.storyState) {
      this._showScreenTip(prepared?.message || '当前剧情条件不足。', { title: prepared?.title || '尚不能继续' });
      return false;
    }

    this._s10StoryBusy = true;
    blackboard.set('storyState', prepared.storyState);
    try {
      const saved = await this.requestAutoSave({ reason: 'checkpoint', checkpointId, sceneId: 'S10' });
      if (!saved?.ok) throw new Error(saved?.message || saved?.errors?.[0]?.message || 'checkpointFailed');
      this._showScreenTip(successMessage, { title: successTitle });
      return true;
    } catch (error) {
      blackboard.set('storyState', beforeStory);
      this._showScreenTip(`剧情检查点保存失败：${error?.message || error}，状态已回滚。`, { title: '提交失败' });
      return false;
    } finally {
      this._s10StoryBusy = false;
    }
  },

  async commitS10ZhangJiaoDeath() {
    return this._commitS10StoryCheckpoint({
      checkpointId: 'checkpoint.S10.zhangJiaoDeath',
      successTitle: '八月·张角病逝',
      successMessage: '帐中没有军令，只有药味。张角已经病逝；这是不可救援、不可逆转的历史事件。',
      prepare: before => {
        const existing = before.historicalEvents?.['history.zhangjiao.death'];
        if (existing?.committed === true) {
          return { idempotent: true, message: '张角病逝已经写入历史，不存在救援倒计时，也不能重复改写。' };
        }
        if (before.messengerRecallReceived !== true) {
          return { ok: false, message: '尚未收到冀州急召，不能提前进入张角病逝事件。' };
        }
        const event = {
          id: 'history.zhangjiao.death',
          committed: true,
          sceneId: 'S10',
          month: 8,
          rescuable: false,
          operationId: 'story:S10:zhangJiaoDeath'
        };
        return {
          ok: true,
          storyState: {
            ...before,
            month: Math.max(8, Math.floor(Number(before.month) || 0)),
            visitedScenes: [...new Set([...(before.visitedScenes || []), 'S10'])],
            historicalEvents: { ...(before.historicalEvents || {}), [event.id]: event },
            zhangJiaoDied: true,
            zhangJiaoRescueAvailable: false,
            pendingSceneId: null,
            lastCheckpointId: 'checkpoint.S10.zhangJiaoDeath'
          }
        };
      }
    });
  },

  async acknowledgeS10TemporaryCamp() {
    return this._commitS10StoryCheckpoint({
      checkpointId: 'checkpoint.S10.temporaryCamp',
      successTitle: '临时营地评估',
      successMessage: '这里能挡住小股官兵，但离水源远、只能住几天，也不适合筑城。必须拔营沿溪寻找新址。',
      prepare: before => {
        if (before.s10TemporaryCamp?.evaluated === true) {
          return { idempotent: true, message: '临时营地已经评估：可短住、可挡小股官兵，但缺水且不可筑城。' };
        }
        if (before.historicalEvents?.['history.zhangjiao.death']?.committed !== true) {
          return { ok: false, message: '先进入病帐，完成张角病逝事件。' };
        }
        return {
          ok: true,
          storyState: {
            ...before,
            s10TemporaryCamp: {
              evaluated: true,
              active: true,
              canResistSmallRaid: true,
              nearWater: false,
              suitableForConstruction: false,
              maxStayDays: 3,
              continuedFromSpecialFaint: !!before.lastSpecialFaintRescueType,
              rescueType: before.lastSpecialFaintRescueType || null,
              operationId: 'story:S10:temporaryCamp'
            },
            lastCheckpointId: 'checkpoint.S10.temporaryCamp'
          }
        };
      }
    });
  },

  async completeS10CampRelocation() {
    return this._commitS10StoryCheckpoint({
      checkpointId: 'checkpoint.S10.campRelocation',
      successTitle: '沿溪新址',
      successMessage: '临时营地已经拔除。队伍沿溪找到可长期取水的新址，营建阶段现已开放。',
      prepare: before => {
        if (before.s10CampRelocation?.completed === true) {
          return { idempotent: true, message: '队伍已经沿溪迁至新址，重复交互不会再次推进月份或改变状态。' };
        }
        if (before.s10TemporaryCamp?.evaluated !== true) {
          return { ok: false, message: '先检查临时营地，确认缺水与不可筑城的限制。' };
        }
        return {
          ok: true,
          storyState: {
            ...before,
            s10TemporaryCamp: { ...before.s10TemporaryCamp, active: false },
            s10CampRelocation: {
              completed: true,
              fromSiteId: 'site.s10.temporaryCamp',
              toSiteId: 'site.s10.creekConstruction',
              waterAccess: true,
              suitableForConstruction: true,
              operationId: 'story:S10:campRelocation'
            },
            constructionSiteUnlocked: true,
            constructionSiteId: 'site.s10.creekConstruction',
            lastCheckpointId: 'checkpoint.S10.campRelocation'
          }
        };
      }
    });
  }
};

export class S10StoryCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, s10StoryMethods, { name: 'S10StoryCoordinator' });
  }
}

export default S10StoryCoordinator;
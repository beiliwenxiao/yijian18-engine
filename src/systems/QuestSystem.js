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

import { QuestTransactionService } from './QuestTransactionService.js';

/** 任务定义分类；运行态由 QuestRuntimeState / QuestTransactionService 独占。 */
export const QuestType = Object.freeze({
  MAIN: 'main', SIDE: 'side', DAILY: 'daily', WEEKLY: 'weekly', REPEATABLE: 'repeatable', EVENT: 'event'
});

export const QuestState = Object.freeze({
  AVAILABLE: 'available', ACTIVE: 'active', COMPLETED: 'completed',
  TURNED_IN: 'turned_in', FAILED: 'failed', LOCKED: 'locked'
});

export const ObjectiveType = Object.freeze({
  KILL: 'kill', COLLECT: 'collect', TALK: 'talk', EXPLORE: 'explore', ESCORT: 'escort',
  DELIVER: 'deliver', USE_ITEM: 'use_item', REACH_LEVEL: 'reach_level', CRAFT: 'craft'
});

/** 只读定义兼容值；不含 currentCount 或其他运行态字段。 */
export class QuestObjective {
  constructor(config = {}) {
    if (typeof config.id !== 'string' || !config.id) throw new TypeError('QuestObjective requires stable id');
    Object.assign(this, {
      id: config.id, type: config.type || ObjectiveType.KILL, description: config.description || '',
      targetId: config.targetId ?? null, targetName: config.targetName || '',
      requiredCount: Math.max(1, Math.floor(Number(config.requiredCount) || 1)), optional: config.optional === true,
      hidden: config.hidden === true
    });
    Object.freeze(this);
  }
}

/** 只读奖励定义兼容值。 */
export class QuestReward {
  constructor(config = {}) { Object.assign(this, JSON.parse(JSON.stringify(config || {}))); Object.freeze(this); }
}

/** 只读 QuestDefinition 兼容值；正式定义必须来自 DefinitionRepository。 */
export class Quest {
  constructor(config = {}) {
    if (typeof config.id !== 'string' || !config.id) throw new TypeError('Quest requires stable id');
    Object.assign(this, JSON.parse(JSON.stringify(config)));
    this.objectives = Object.freeze((config.objectives || []).map(objective => new QuestObjective(objective)));
    this.reward = new QuestReward(config.reward || {});
    Object.freeze(this);
  }
}

/**
 * 迁移名保留：它现在直接继承唯一 QuestTransactionService，未注入 Repository 时是合法空任务集。
 * 不再注入默认任务，也不提供可写 Quest/QuestObjective 路径。
 */
export class QuestSystem extends QuestTransactionService {
  constructor(config = {}) { super(config); }

  registerQuest() {
    throw new Error('QuestDefinition must be supplied by DefinitionRepository; QuestSystem.registerQuest is no longer supported');
  }

  getAvailableQuests(actorId = this.getDefaultActorId()) {
    return this.getAllQuests(actorId).filter(quest => quest.state === QuestState.AVAILABLE);
  }

  getQuestsForNPC(npcId, actorId = this.getDefaultActorId()) {
    return this.getAvailableQuests(actorId).filter(quest => quest.giverNPCId === npcId);
  }

  getCompletableQuestsForNPC(npcId, actorId = this.getDefaultActorId()) {
    return this.getActiveQuests(actorId).filter(quest => quest.turnInNPCId === npcId && quest.state === QuestState.COMPLETED);
  }

  getStats(actorId = this.getDefaultActorId()) {
    return {
      totalQuests: this.getAllQuests(actorId).length,
      activeQuests: this.getActiveQuests(actorId).length,
      completedQuests: this.getCompletedQuestIds(actorId).length,
      trackedQuests: this.getTrackedQuests(actorId).length
    };
  }

  update() { return false; }
}

export default QuestSystem;

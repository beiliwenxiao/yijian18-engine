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

import { QuestIntentClient, QuestProjectionView } from './QuestProjectionView.js';

const QUEST_STATE = Object.freeze({ AVAILABLE: 'available', ACTIVE: 'active', COMPLETED: 'completed', TURNED_IN: 'turned_in' });
const TYPE_LABELS = Object.freeze({ main: '主线', side: '支线', daily: '日常', weekly: '周常', repeatable: '重复', event: '活动' });
const TYPE_COLORS = Object.freeze({ main: '#ffd700', side: '#87ceeb', daily: '#98fb98', weekly: '#dda0dd', repeatable: '#f0e68c', event: '#ff6b6b' });
const progressOf = quest => Number.isFinite(quest?.progressPercent) ? quest.progressPercent : (() => {
  const objectives = Array.isArray(quest?.objectives) ? quest.objectives : [];
  if (objectives.length === 0) return 0;
  return objectives.reduce((total, item) => total + Math.min(1, (item.currentCount || 0) / Math.max(1, item.requiredCount || 1)), 0) / objectives.length * 100;
})();

/** 只读任务面板：从 ProjectionStore 读取不可变值，只向 CommandGateway 发送任务 intent。 */
export class QuestPanel {
  constructor({ projectionView, intentClient, projectionStore, projectionId, commandGateway, actorRef } = {}) {
    this.view = projectionView || new QuestProjectionView({ projectionStore, projectionId });
    this.intents = intentClient || new QuestIntentClient({ commandGateway, actorRef });
    this.container = null;
    this.tabBar = null;
    this.content = null;
    this.isVisible = false;
    this.currentTab = 'active';
  }

  init() { if (!this.container) this.createContainer(); return this; }
  createContainer() {
    this.container = document.createElement('section');
    this.container.id = 'quest-panel';
    this.container.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:700px;max-width:90vw;max-height:80vh;background:rgba(0,0,0,.95);border:2px solid #8b7355;border-radius:10px;color:white;z-index:1000;display:none;flex-direction:column;';
    const header = document.createElement('header');
    header.style.cssText = 'padding:15px 20px;background:#4a3728;border-bottom:1px solid #8b7355;display:flex;justify-content:space-between;';
    header.innerHTML = '<strong>📜 任务日志</strong><button type="button" aria-label="关闭">×</button>';
    header.querySelector('button').addEventListener('click', () => this.hide());
    this.tabBar = document.createElement('nav');
    this.content = document.createElement('div');
    this.content.style.cssText = 'flex:1;overflow-y:auto;padding:15px;min-height:300px;';
    this.container.append(header, this.tabBar, this.content);
    document.body.append(this.container);
  }

  show() { this.init(); this.container.style.display = 'flex'; this.isVisible = true; this.refresh(); }
  hide() { if (this.container) this.container.style.display = 'none'; this.isVisible = false; }
  toggle() { return this.isVisible ? this.hide() : this.show(); }
  refresh() { if (!this.container) return; this.renderTabs(); this.renderContent(); }

  renderTabs() {
    const all = this.view.all();
    const tabs = [
      ['active', '进行中', this.view.active().length], ['completed', '已完成', this.view.completed().length], ['all', '全部任务', all.length]
    ];
    this.tabBar.innerHTML = tabs.map(([id, label, count]) => `<button type="button" data-tab="${id}">${label} (${count})</button>`).join('');
    this.tabBar.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { this.currentTab = button.dataset.tab; this.refresh(); }));
  }

  renderContent() {
    const quests = this.currentTab === 'active' ? this.view.active() : this.currentTab === 'completed' ? this.view.completed() : this.view.all();
    this.content.innerHTML = quests.length ? quests.map(quest => this.renderQuestItem(quest)).join('') : '<div style="text-align:center;color:#7f8c8d;padding:40px;">暂无任务</div>';
    this.content.querySelectorAll('[data-quest-id]').forEach(item => item.addEventListener('click', () => this.showQuestDetail(item.dataset.questId)));
  }

  renderQuestItem(quest) {
    const color = TYPE_COLORS[quest.type] || '#fff';
    const progress = Math.floor(progressOf(quest));
    const level = Math.max(1, Math.floor(Number(quest.minLevel) || 1));
    return `<article data-quest-id="${quest.id || quest.definitionId}" style="border-left:3px solid ${color};padding:12px;margin-bottom:10px;cursor:pointer;"><strong>${TYPE_LABELS[quest.type] || '任务'} ${quest.name || quest.id || quest.definitionId} Lv.${level}</strong> <p>${quest.shortDescription || ''}</p> <small>${progress}%</small></article>`;
  }

  showQuestDetail(questId) {
    const quest = this.view.get(questId);
    if (!quest) return;
    const objectives = (quest.objectives || []).map(item => `<li>${item.description || item.targetName || item.id}: ${item.currentCount || 0}/${item.requiredCount || 1}</li>`).join('');
    const actions = [];
    if (quest.state === QUEST_STATE.AVAILABLE) actions.push(['accept', '接取']);
    if (quest.state === QUEST_STATE.ACTIVE) actions.push(['abandon', '放弃'], ['track', quest.tracked ? '取消追踪' : '追踪']);
    if (quest.state === QUEST_STATE.COMPLETED) actions.push(['turnIn', '提交']);
    this.content.innerHTML = `<button type="button" data-back>← 返回列表</button><h3>${quest.name || questId}</h3><p>${quest.description || ''}</p><ul>${objectives}</ul>${actions.map(([action, label]) => `<button type="button" data-action="${action}" data-quest-id="${questId}">${label}</button>`).join('')}`;
    this.content.querySelector('[data-back]').addEventListener('click', () => this.refresh());
    this.content.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => this._action(button.dataset.action, quest)));
  }

  async _action(action, quest) {
    const id = quest.id || quest.definitionId;
    const result = action === 'accept' ? await this.accept(id) : action === 'abandon' ? await this.abandon(id)
      : action === 'turnIn' ? await this.turnIn(id) : await this.track(id, !quest.tracked);
    if (result?.ok) this.refresh();
    return result;
  }
  accept(questId, options) { return this.intents.accept(questId, options); }
  advance(questId, signal, options) { return this.intents.advance(questId, signal, options); }
  abandon(questId, options) { return this.intents.abandon(questId, options); }
  turnIn(questId, options) { return this.intents.turnIn(questId, options); }
  track(questId, tracking, options) { return this.intents.track(questId, tracking, options); }
  destroy() { this.container?.remove(); this.container = this.tabBar = this.content = null; }
}

export default QuestPanel;

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * NPCPanel.js
 * NPC交互面板UI组件
 */

import { Logger } from '../core/Logger.js';
import { NPCType, NPCState } from '../systems/NPCSystem.js';

/**
 * NPC面板类
 */
export class NPCPanel {
  constructor(npcSystem) {
    this.npcSystem = npcSystem;
    this.container = null;
    this.dialogBox = null;
    this.optionsContainer = null;
    this.isVisible = false;
    
    // NPC类型图标
    this.npcIcons = {
      [NPCType.QUEST_GIVER]: '❗',
      [NPCType.MERCHANT]: '🛒',
      [NPCType.TRAINER]: '⚔️',
      [NPCType.GUARD]: '🛡️',
      [NPCType.VILLAGER]: '👤',
      [NPCType.BLACKSMITH]: '🔨',
      [NPCType.INNKEEPER]: '🏨',
      [NPCType.BANKER]: '💰'
    };

    this.init();
  }

  /**
   * 初始化面板
   */
  init() {
    this.createContainer();
    this.bindEvents();
  }

  /**
   * 创建容器
   */
  createContainer() {
    // 主容器
    this.container = document.createElement('div');
    this.container.id = 'npc-panel';
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: 600px;
      max-width: 90vw;
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid #8b7355;
      border-radius: 10px;
      color: white;
      font-family: 'Microsoft YaHei', Arial, sans-serif;
      z-index: 1000;
      display: none;
    `;

    // NPC信息区
    this.npcInfo = document.createElement('div');
    this.npcInfo.style.cssText = `
      padding: 15px;
      border-bottom: 1px solid #4a4a4a;
      display: flex;
      align-items: center;
      gap: 15px;
    `;
    this.container.appendChild(this.npcInfo);

    // 对话框
    this.dialogBox = document.createElement('div');
    this.dialogBox.style.cssText = `
      padding: 20px;
      min-height: 80px;
      font-size: 16px;
      line-height: 1.6;
      border-bottom: 1px solid #4a4a4a;
    `;
    this.container.appendChild(this.dialogBox);

    // 选项容器
    this.optionsContainer = document.createElement('div');
    this.optionsContainer.style.cssText = `
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
    this.container.appendChild(this.optionsContainer);

    document.body.appendChild(this.container);
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    if (this.npcSystem) {
      this.npcSystem.on('dialogStart', (data) => this.onDialogStart(data));
      this.npcSystem.on('dialogProgress', (data) => this.onDialogProgress(data));
      this.npcSystem.on('dialogEnd', () => this.onDialogEnd());
      this.npcSystem.on('dialogAction', (data) => this.onDialogAction(data));
    }
  }

  /**
   * 显示面板
   */
  show() {
    this.container.style.display = 'block';
    this.isVisible = true;
  }

  /**
   * 隐藏面板
   */
  hide() {
    this.container.style.display = 'none';
    this.isVisible = false;
  }

  /**
   * 更新NPC信息显示
   * @param {NPC} npc
   */
  updateNPCInfo(npc) {
    const icon = this.npcIcons[npc.type] || '👤';
    this.npcInfo.innerHTML = `
      <div style="
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #4a4a4a, #2a2a2a);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 30px;
        border: 2px solid #8b7355;
      ">${icon}</div>
      <div>
        <div style="font-size: 18px; font-weight: bold; color: #ffd700;">${npc.name}</div>
        <div style="font-size: 12px; color: #95a5a6;">${npc.title || this.getTypeLabel(npc.type)}</div>
      </div>
    `;
  }

  /**
   * 获取类型标签
   * @param {string} type
   * @returns {string}
   */
  getTypeLabel(type) {
    const labels = {
      [NPCType.QUEST_GIVER]: '任务NPC',
      [NPCType.MERCHANT]: '商人',
      [NPCType.TRAINER]: '训练师',
      [NPCType.GUARD]: '守卫',
      [NPCType.VILLAGER]: '村民',
      [NPCType.BLACKSMITH]: '铁匠',
      [NPCType.INNKEEPER]: '旅店老板',
      [NPCType.BANKER]: '银行家'
    };
    return labels[type] || '未知';
  }

  /**
   * 更新对话内容
   * @param {DialogNode} node
   * @param {Object} context
   */
  updateDialog(node, context) {
    if (!node) return;

    // 显示对话文本
    this.dialogBox.innerHTML = `
      <div style="color: #ffd700; margin-bottom: 8px; font-weight: bold;">
        ${node.speaker}:
      </div>
      <div>${node.text}</div>
    `;

    // 显示选项
    this.optionsContainer.innerHTML = '';
    const availableOptions = node.getAvailableOptions(context);
    
    availableOptions.forEach((option, index) => {
      const optionBtn = document.createElement('button');
      optionBtn.style.cssText = `
        padding: 12px 20px;
        background: linear-gradient(135deg, #3a3a3a, #2a2a2a);
        border: 1px solid #5a5a5a;
        border-radius: 5px;
        color: white;
        font-size: 14px;
        cursor: pointer;
        text-align: left;
        transition: all 0.2s;
      `;
      optionBtn.textContent = `${index + 1}. ${option.text}`;
      
      optionBtn.addEventListener('mouseenter', () => {
        optionBtn.style.background = 'linear-gradient(135deg, #4a4a4a, #3a3a3a)';
        optionBtn.style.borderColor = '#8b7355';
      });
      
      optionBtn.addEventListener('mouseleave', () => {
        optionBtn.style.background = 'linear-gradient(135deg, #3a3a3a, #2a2a2a)';
        optionBtn.style.borderColor = '#5a5a5a';
      });
      
      optionBtn.addEventListener('click', () => {
        this.selectOption(option.id);
      });
      
      this.optionsContainer.appendChild(optionBtn);
    });
  }

  /**
   * 选择选项
   * @param {string} optionId
   */
  selectOption(optionId) {
    if (this.npcSystem) {
      const result = this.npcSystem.selectOption(optionId, this.currentContext || {});
      if (result.node) {
        this.updateDialog(result.node, this.currentContext || {});
      }
    }
  }

  /**
   * 对话开始回调
   * @param {Object} data
   */
  onDialogStart(data) {
    this.currentContext = data.context;
    this.updateNPCInfo(data.npc);
    this.updateDialog(data.node, data.context);
    this.show();
  }

  /**
   * 对话进度回调
   * @param {Object} data
   */
  onDialogProgress(data) {
    this.updateDialog(data.node, data.context);
  }

  /**
   * 对话结束回调
   */
  onDialogEnd() {
    this.hide();
    this.currentContext = null;
  }

  /**
   * 对话动作回调
   * @param {Object} data
   */
  onDialogAction(data) {
    Logger.log('Dialog action:', data.action);
    // 这里可以处理各种动作，如打开商店、接受任务等
  }

  /**
   * 键盘快捷键处理
   * @param {KeyboardEvent} event
   */
  handleKeyPress(event) {
    if (!this.isVisible) return;

    const key = event.key;
    if (key >= '1' && key <= '9') {
      const index = parseInt(key) - 1;
      const options = this.optionsContainer.querySelectorAll('button');
      if (options[index]) {
        options[index].click();
      }
    } else if (key === 'Escape') {
      if (this.npcSystem) {
        this.npcSystem.endDialog();
      }
    }
  }

  /**
   * 销毁面板
   */
  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

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
 * TalentPanel.js
 * 天赋面板UI组件 - 显示天赋树界面，支持天赋学习和重置
 */

import { Logger } from '../core/Logger.js';
import { UIElement } from './UIElement.js';
import { TalentType } from '../systems/TalentSystem.js';

/**
 * 天赋面板类
 */
export class TalentPanel extends UIElement {
  /**
   * @param {Object} config - 配置对象
   * @param {number} config.x - X坐标
   * @param {number} config.y - Y坐标
   * @param {number} config.width - 宽度
   * @param {number} config.height - 高度
   * @param {TalentSystem} config.talentSystem - 天赋系统
   * @param {Object} config.character - 角色数据
   */
  constructor(config) {
    super(config);
    
    this.talentSystem = config.talentSystem;
    this.character = config.character;
    this.talentTree = null;
    
    // UI配置
    this.nodeSize = 50;
    this.nodeSpacing = 90;
    this.offsetX = 80;
    this.offsetY = 100;
    
    // 选中和悬停状态
    this.selectedNode = null;
    this.hoveredNode = null;
    
    // 面板状态
    this.isVisible = false;
    
    // 颜色配置
    this.colors = {
      background: 'rgba(20, 20, 30, 0.95)',
      border: '#5a4a3a',
      nodeAvailable: '#4CAF50',
      nodeUnavailable: '#555555',
      nodeLearned: '#FFD700',
      nodeMaxed: '#FF6B00',
      nodeSelected: '#00BFFF',
      nodeHovered: '#87CEEB',
      connection: '#666666',
      connectionActive: '#FFD700',
      text: '#FFFFFF',
      textDisabled: '#888888',
      typeColors: {
        combat: '#FF4444',
        survival: '#44FF44',
        utility: '#4444FF',
        element: '#FF44FF'
      }
    };
    
    // 回调函数
    this.onTalentLearned = null;
    this.onTalentReset = null;
    
    // 初始化天赋树
    this.updateTalentTree();
  }

  /**
   * 更新天赋树数据
   */
  updateTalentTree() {
    if (this.character && this.talentSystem) {
      this.talentTree = this.talentSystem.getTalentTree(this.character.class);
    }
  }

  /**
   * 设置角色
   * @param {Object} character - 角色数据
   */
  setCharacter(character) {
    this.character = character;
    this.updateTalentTree();
  }

  /**
   * 显示面板
   */
  show() {
    this.isVisible = true;
    this.updateTalentTree();
  }

  /**
   * 隐藏面板
   */
  hide() {
    this.isVisible = false;
    this.selectedNode = null;
    this.hoveredNode = null;
  }

  /**
   * 切换显示状态
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 处理鼠标点击
   * @param {number} mouseX - 鼠标X坐标
   * @param {number} mouseY - 鼠标Y坐标
   * @returns {boolean} 是否处理了点击事件
   */
  handleClick(mouseX, mouseY) {
    if (!this.isVisible || !this.talentTree) {
      return false;
    }

    // 检查是否点击在面板内
    if (!this.containsPoint(mouseX, mouseY)) {
      return false;
    }

    // 检查是否点击了天赋节点
    const clickedNode = this.getNodeAtPosition(mouseX, mouseY);
    if (clickedNode) {
      this.handleNodeClick(clickedNode);
      return true;
    }

    // 检查是否点击了重置按钮
    if (this.isPointInResetButton(mouseX, mouseY)) {
      this.handleResetClick();
      return true;
    }

    // 检查是否点击了关闭按钮
    if (this.isPointInCloseButton(mouseX, mouseY)) {
      this.hide();
      return true;
    }

    return true;
  }

  /**
   * 处理鼠标移动
   * @param {number} mouseX - 鼠标X坐标
   * @param {number} mouseY - 鼠标Y坐标
   */
  handleMouseMove(mouseX, mouseY) {
    if (!this.isVisible || !this.talentTree) {
      return;
    }

    this.hoveredNode = this.getNodeAtPosition(mouseX, mouseY);
  }

  /**
   * 获取指定位置的天赋节点
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {TalentNode|null}
   */
  getNodeAtPosition(x, y) {
    if (!this.talentTree) return null;

    const nodes = this.talentTree.getAllNodes();
    for (const node of nodes) {
      const nodeX = this.x + this.offsetX + node.position.x * this.nodeSpacing;
      const nodeY = this.y + this.offsetY + node.position.y * this.nodeSpacing;
      
      const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
      if (distance <= this.nodeSize / 2) {
        return node;
      }
    }
    
    return null;
  }

  /**
   * 处理天赋节点点击
   * @param {TalentNode} node - 天赋节点
   */
  handleNodeClick(node) {
    if (this.selectedNode === node) {
      // 双击尝试学习天赋
      const result = this.talentSystem.canLearnTalent(this.character, node.id);
      if (result.canLearn) {
        const learnResult = this.talentSystem.learnTalent(this.character, node.id);
        if (learnResult.success) {
          Logger.log(learnResult.message);
          this.onTalentLearned && this.onTalentLearned(node);
        }
      }
    } else {
      this.selectedNode = node;
    }
  }

  /**
   * 处理重置按钮点击
   */
  handleResetClick() {
    if (confirm('确定要重置所有天赋吗？这将返还所有天赋点。')) {
      const returnedPoints = this.talentSystem.resetTalentTree(this.character);
      Logger.log(`天赋重置完成，返还 ${returnedPoints} 天赋点`);
      this.selectedNode = null;
      this.onTalentReset && this.onTalentReset(returnedPoints);
    }
  }

  /**
   * 检查点是否在重置按钮内
   */
  isPointInResetButton(x, y) {
    const buttonX = this.x + this.width - 120;
    const buttonY = this.y + this.height - 45;
    const buttonWidth = 80;
    const buttonHeight = 30;
    
    return x >= buttonX && x <= buttonX + buttonWidth &&
           y >= buttonY && y <= buttonY + buttonHeight;
  }

  /**
   * 检查点是否在关闭按钮内
   */
  isPointInCloseButton(x, y) {
    const buttonX = this.x + this.width - 35;
    const buttonY = this.y + 10;
    const buttonSize = 25;
    
    return x >= buttonX && x <= buttonX + buttonSize &&
           y >= buttonY && y <= buttonY + buttonSize;
  }

  /**
   * 渲染天赋面板
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.isVisible || !this.talentTree) {
      return;
    }

    this.renderBackground(ctx);
    this.renderConnections(ctx);
    this.renderNodes(ctx);
    this.renderTalentInfo(ctx);
    this.renderButtons(ctx);
    this.renderTitle(ctx);
  }


  /**
   * 渲染背景
   * @param {CanvasRenderingContext2D} ctx
   */
  renderBackground(ctx) {
    // 绘制半透明背景
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    
    // 绘制边框
    ctx.strokeStyle = this.colors.border;
    ctx.lineWidth = 3;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
    
    // 绘制内边框装饰
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x + 5, this.y + 5, this.width - 10, this.height - 10);
  }

  /**
   * 渲染天赋连接线
   * @param {CanvasRenderingContext2D} ctx
   */
  renderConnections(ctx) {
    const nodes = this.talentTree.getAllNodes();
    
    for (const node of nodes) {
      for (const prereqId of node.prerequisites) {
        const prereqNode = this.talentTree.getNode(prereqId);
        if (prereqNode) {
          const startX = this.x + this.offsetX + prereqNode.position.x * this.nodeSpacing;
          const startY = this.y + this.offsetY + prereqNode.position.y * this.nodeSpacing;
          const endX = this.x + this.offsetX + node.position.x * this.nodeSpacing;
          const endY = this.y + this.offsetY + node.position.y * this.nodeSpacing;
          
          // 根据前置天赋是否已学习决定连接线颜色
          ctx.strokeStyle = prereqNode.isLearned ? this.colors.connectionActive : this.colors.connection;
          ctx.lineWidth = prereqNode.isLearned ? 3 : 2;
          
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        }
      }
    }
  }

  /**
   * 渲染天赋节点
   * @param {CanvasRenderingContext2D} ctx
   */
  renderNodes(ctx) {
    const nodes = this.talentTree.getAllNodes();
    
    for (const node of nodes) {
      const nodeX = this.x + this.offsetX + node.position.x * this.nodeSpacing;
      const nodeY = this.y + this.offsetY + node.position.y * this.nodeSpacing;
      
      // 确定节点颜色
      let nodeColor;
      let borderColor = '#000';
      
      if (node === this.selectedNode) {
        nodeColor = this.colors.nodeSelected;
        borderColor = '#00FFFF';
      } else if (node === this.hoveredNode) {
        nodeColor = this.colors.nodeHovered;
      } else if (node.currentLevel >= node.maxLevel) {
        nodeColor = this.colors.nodeMaxed;
      } else if (node.isLearned) {
        nodeColor = this.colors.nodeLearned;
      } else if (this.talentSystem.canLearnTalent(this.character, node.id).canLearn) {
        nodeColor = this.colors.nodeAvailable;
      } else {
        nodeColor = this.colors.nodeUnavailable;
      }
      
      // 绘制节点外圈（类型颜色）
      const typeColor = this.colors.typeColors[node.type] || '#888';
      ctx.fillStyle = typeColor;
      ctx.beginPath();
      ctx.arc(nodeX, nodeY, this.nodeSize / 2 + 4, 0, Math.PI * 2);
      ctx.fill();
      
      // 绘制节点主体
      ctx.fillStyle = nodeColor;
      ctx.beginPath();
      ctx.arc(nodeX, nodeY, this.nodeSize / 2, 0, Math.PI * 2);
      ctx.fill();
      
      // 绘制节点边框
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 绘制天赋等级
      if (node.maxLevel > 1) {
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${node.currentLevel}/${node.maxLevel}`, nodeX, nodeY);
      } else if (node.isLearned) {
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✓', nodeX, nodeY);
      }
      
      // 绘制天赋名称
      ctx.fillStyle = node.isUnlocked ? this.colors.text : this.colors.textDisabled;
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      
      const lines = this.wrapText(node.name, 8);
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], nodeX, nodeY + this.nodeSize / 2 + 8 + i * 12);
      }
    }
  }

  /**
   * 渲染天赋信息
   * @param {CanvasRenderingContext2D} ctx
   */
  renderTalentInfo(ctx) {
    const displayNode = this.hoveredNode || this.selectedNode;
    if (!displayNode) {
      return;
    }

    const infoX = this.x + 20;
    const infoY = this.y + this.height - 220;
    const infoWidth = 320;
    const infoHeight = 170;
    
    // 绘制信息背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(infoX, infoY, infoWidth, infoHeight);
    
    ctx.strokeStyle = this.colors.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(infoX, infoY, infoWidth, infoHeight);
    
    let textY = infoY + 20;
    
    // 天赋名称
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(displayNode.name, infoX + 10, textY);
    textY += 22;
    
    // 天赋类型
    const typeNames = {
      combat: '战斗',
      survival: '生存',
      utility: '实用',
      element: '元素'
    };
    ctx.fillStyle = this.colors.typeColors[displayNode.type] || '#888';
    ctx.font = '12px Arial';
    ctx.fillText(`类型: ${typeNames[displayNode.type] || displayNode.type}`, infoX + 10, textY);
    textY += 18;
    
    // 当前等级
    ctx.fillStyle = this.colors.text;
    ctx.fillText(`等级: ${displayNode.currentLevel}/${displayNode.maxLevel}`, infoX + 10, textY);
    textY += 18;
    
    // 学习条件
    if (displayNode.currentLevel < displayNode.maxLevel) {
      ctx.fillStyle = this.colors.textDisabled;
      ctx.fillText(`需要角色等级: ${displayNode.requiredCharacterLevel}`, infoX + 10, textY);
      textY += 15;
      ctx.fillText(`需要天赋点: ${displayNode.requiredTalentPoints}`, infoX + 10, textY);
      textY += 15;
      
      // 前置天赋
      if (displayNode.prerequisites.length > 0) {
        const prereqNames = displayNode.prerequisites.map(id => {
          const prereq = this.talentTree.getNode(id);
          return prereq ? prereq.name : id;
        }).join(', ');
        ctx.fillText(`前置: ${prereqNames}`, infoX + 10, textY);
        textY += 15;
      }
    }
    
    // 天赋描述
    ctx.fillStyle = '#AAAAAA';
    ctx.font = '11px Arial';
    const descLines = this.wrapText(displayNode.description, 40);
    for (const line of descLines) {
      if (textY < infoY + infoHeight - 10) {
        ctx.fillText(line, infoX + 10, textY);
        textY += 14;
      }
    }
    
    // 效果预览
    const effects = displayNode.currentLevel > 0 
      ? displayNode.getCurrentEffects() 
      : displayNode.getNextLevelEffects();
    
    if (effects && Object.keys(effects).length > 0) {
      ctx.fillStyle = '#88FF88';
      ctx.font = '10px Arial';
      const effectText = this.formatEffects(effects);
      if (textY < infoY + infoHeight - 10) {
        ctx.fillText(`效果: ${effectText}`, infoX + 10, textY);
      }
    }
  }

  /**
   * 格式化效果显示
   * @param {Object} effects - 效果对象
   * @returns {string}
   */
  formatEffects(effects) {
    const effectNames = {
      maxHpBonus: '生命值',
      maxManaBonus: '法力值',
      attackBonus: '攻击力',
      defenseBonus: '防御力',
      speedBonus: '速度',
      hpRegenBonus: '生命回复',
      manaRegenBonus: '法力回复',
      criticalChance: '暴击率',
      criticalDamage: '暴击伤害',
      dodgeChance: '闪避率',
      attackSpeedBonus: '攻击速度',
      spellDamageBonus: '法术伤害',
      spellPenetration: '法术穿透',
      armorPenetration: '护甲穿透',
      fireElementBonus: '火系伤害',
      iceElementBonus: '冰系伤害',
      blockChance: '格挡率',
      blockReduction: '格挡减伤',
      damageReduction: '伤害减免',
      rangeBonus: '攻击范围'
    };
    
    const parts = [];
    for (const [key, value] of Object.entries(effects)) {
      const name = effectNames[key] || key;
      if (typeof value === 'number') {
        if (value < 1 && value > 0) {
          parts.push(`${name}+${(value * 100).toFixed(0)}%`);
        } else {
          parts.push(`${name}+${value}`);
        }
      } else if (typeof value === 'boolean' && value) {
        parts.push(name);
      }
    }
    
    return parts.slice(0, 3).join(', ') + (parts.length > 3 ? '...' : '');
  }

  /**
   * 渲染按钮
   * @param {CanvasRenderingContext2D} ctx
   */
  renderButtons(ctx) {
    // 重置按钮
    const resetX = this.x + this.width - 120;
    const resetY = this.y + this.height - 45;
    const resetWidth = 80;
    const resetHeight = 30;
    
    ctx.fillStyle = '#8B0000';
    ctx.fillRect(resetX, resetY, resetWidth, resetHeight);
    
    ctx.strokeStyle = '#FF4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(resetX, resetY, resetWidth, resetHeight);
    
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('重置天赋', resetX + resetWidth / 2, resetY + resetHeight / 2);
    
    // 关闭按钮
    const closeX = this.x + this.width - 35;
    const closeY = this.y + 10;
    const closeSize = 25;
    
    ctx.fillStyle = '#8B0000';
    ctx.fillRect(closeX, closeY, closeSize, closeSize);
    
    ctx.strokeStyle = '#FF4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(closeX, closeY, closeSize, closeSize);
    
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×', closeX + closeSize / 2, closeY + closeSize / 2);
  }

  /**
   * 渲染标题
   * @param {CanvasRenderingContext2D} ctx
   */
  renderTitle(ctx) {
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    const classNames = {
      'warrior': '战士',
      'strategist': '军师',
      'archer': '弓箭手'
    };
    const className = classNames[this.character?.class] || this.character?.class || '';
    
    ctx.fillText(`${className}天赋树`, this.x + 20, this.y + 15);
    
    // 显示可用天赋点
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '14px Arial';
    const talentPoints = this.character?.talentPoints || 0;
    ctx.fillText(`可用天赋点: ${talentPoints}`, this.x + 20, this.y + 45);
    
    // 显示已学习天赋数
    const learnedCount = this.talentTree?.getLearnedCount() || 0;
    ctx.fillText(`已学习: ${learnedCount}`, this.x + 20, this.y + 65);
    
    // 图例
    this.renderLegend(ctx);
  }

  /**
   * 渲染图例
   * @param {CanvasRenderingContext2D} ctx
   */
  renderLegend(ctx) {
    const legendX = this.x + this.width - 150;
    const legendY = this.y + 50;
    
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    
    const legends = [
      { color: this.colors.typeColors.combat, text: '战斗' },
      { color: this.colors.typeColors.survival, text: '生存' },
      { color: this.colors.typeColors.utility, text: '实用' },
      { color: this.colors.typeColors.element, text: '元素' }
    ];
    
    legends.forEach((legend, index) => {
      const y = legendY + index * 15;
      ctx.fillStyle = legend.color;
      ctx.fillRect(legendX, y - 5, 10, 10);
      ctx.fillStyle = '#AAA';
      ctx.fillText(legend.text, legendX + 15, y + 3);
    });
  }

  /**
   * 文本换行
   * @param {string} text - 文本
   * @param {number} maxLength - 最大长度
   * @returns {Array<string>}
   */
  wrapText(text, maxLength) {
    if (text.length <= maxLength) {
      return [text];
    }
    
    const lines = [];
    let currentLine = '';
    
    for (let i = 0; i < text.length; i++) {
      currentLine += text[i];
      if (currentLine.length >= maxLength || i === text.length - 1) {
        lines.push(currentLine);
        currentLine = '';
      }
    }
    
    return lines;
  }

  /**
   * 设置天赋学习回调
   * @param {Function} callback
   */
  setOnTalentLearned(callback) {
    this.onTalentLearned = callback;
  }

  /**
   * 设置天赋重置回调
   * @param {Function} callback
   */
  setOnTalentReset(callback) {
    this.onTalentReset = callback;
  }
}

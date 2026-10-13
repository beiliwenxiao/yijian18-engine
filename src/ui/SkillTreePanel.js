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

import { Logger } from '../core/Logger.js';
import { UIElement } from './UIElement.js';

/**
 * 技能树面板
 * 显示技能树的可视化界面，支持技能学习和重置
 */
export class SkillTreePanel extends UIElement {
  /**
   * @param {Object} config - 配置对象
   * @param {number} config.x - X坐标
   * @param {number} config.y - Y坐标
   * @param {number} config.width - 宽度
   * @param {number} config.height - 高度
   * @param {SkillTreeSystem} config.skillTreeSystem - 技能树系统
   * @param {Object} config.character - 角色数据
   */
  constructor(config) {
    super(config);
    
    this.skillTreeSystem = config.skillTreeSystem;
    this.character = config.character;
    this.skillTree = null;
    
    // UI配置
    this.nodeSize = 60;
    this.nodeSpacing = 100;
    this.offsetX = 50;
    this.offsetY = 80;
    
    // 选中的技能节点
    this.selectedNode = null;
    this.hoveredNode = null;
    
    // 面板状态
    this.isVisible = false;
    
    // 颜色配置
    this.colors = {
      background: 'rgba(0, 0, 0, 0.9)',
      border: '#444',
      nodeAvailable: '#4CAF50',
      nodeUnavailable: '#757575',
      nodeLearned: '#2196F3',
      nodeSelected: '#FF9800',
      nodeHovered: '#FFC107',
      connection: '#666',
      text: '#FFF',
      textDisabled: '#999'
    };
    
    // 初始化技能树
    this.updateSkillTree();
  }

  /**
   * 更新技能树数据
   */
  updateSkillTree() {
    if (this.character && this.skillTreeSystem) {
      this.skillTree = this.skillTreeSystem.getSkillTree(this.character.class);
    }
  }

  /**
   * 显示面板
   */
  show() {
    this.isVisible = true;
    this.updateSkillTree();
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
    if (!this.isVisible || !this.skillTree) {
      return false;
    }

    // 检查是否点击在面板内
    if (!this.containsPoint(mouseX, mouseY)) {
      return false;
    }

    // 检查是否点击了技能节点
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

    return true; // 阻止事件传播
  }

  /**
   * 处理鼠标移动
   * @param {number} mouseX - 鼠标X坐标
   * @param {number} mouseY - 鼠标Y坐标
   */
  handleMouseMove(mouseX, mouseY) {
    if (!this.isVisible || !this.skillTree) {
      return;
    }

    // 更新悬停状态
    this.hoveredNode = this.getNodeAtPosition(mouseX, mouseY);
  }

  /**
   * 获取指定位置的技能节点
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {SkillTreeNode|null}
   */
  getNodeAtPosition(x, y) {
    if (!this.skillTree) return null;

    const nodes = this.skillTree.getAllNodes();
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
   * 处理技能节点点击
   * @param {SkillTreeNode} node - 技能节点
   */
  handleNodeClick(node) {
    if (this.selectedNode === node) {
      // 尝试学习技能
      if (this.skillTreeSystem.canLearnSkill(this.character, node.id)) {
        const success = this.skillTreeSystem.learnSkill(this.character, node.id);
        if (success) {
          Logger.log(`成功学习技能: ${node.name}`);
          // 触发技能学习事件
          this.onSkillLearned && this.onSkillLearned(node);
        }
      }
    } else {
      // 选中技能节点
      this.selectedNode = node;
    }
  }

  /**
   * 处理重置按钮点击
   */
  handleResetClick() {
    if (confirm('确定要重置技能树吗？这将返还所有技能点。')) {
      const returnedPoints = this.skillTreeSystem.resetSkillTree(this.character);
      Logger.log(`技能树重置完成，返还 ${returnedPoints} 技能点`);
      this.selectedNode = null;
      // 触发技能重置事件
      this.onSkillReset && this.onSkillReset(returnedPoints);
    }
  }

  /**
   * 检查点是否在重置按钮内
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {boolean}
   */
  isPointInResetButton(x, y) {
    const buttonX = this.x + this.width - 120;
    const buttonY = this.y + this.height - 40;
    const buttonWidth = 80;
    const buttonHeight = 30;
    
    return x >= buttonX && x <= buttonX + buttonWidth &&
           y >= buttonY && y <= buttonY + buttonHeight;
  }

  /**
   * 检查点是否在关闭按钮内
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {boolean}
   */
  isPointInCloseButton(x, y) {
    const buttonX = this.x + this.width - 30;
    const buttonY = this.y + 10;
    const buttonSize = 20;
    
    return x >= buttonX && x <= buttonX + buttonSize &&
           y >= buttonY && y <= buttonY + buttonSize;
  }

  /**
   * 渲染技能树面板
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.isVisible || !this.skillTree) {
      return;
    }

    // 绘制面板背景
    this.renderBackground(ctx);
    
    // 绘制技能连接线
    this.renderConnections(ctx);
    
    // 绘制技能节点
    this.renderNodes(ctx);
    
    // 绘制技能信息
    this.renderSkillInfo(ctx);
    
    // 绘制按钮
    this.renderButtons(ctx);
    
    // 绘制标题
    this.renderTitle(ctx);
  }

  /**
   * 渲染背景
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderBackground(ctx) {
    // 绘制半透明背景
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    
    // 绘制边框
    ctx.strokeStyle = this.colors.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
  }

  /**
   * 渲染技能连接线
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderConnections(ctx) {
    const nodes = this.skillTree.getAllNodes();
    
    ctx.strokeStyle = this.colors.connection;
    ctx.lineWidth = 2;
    
    for (const node of nodes) {
      for (const prereqId of node.prerequisites) {
        const prereqNode = this.skillTree.getNode(prereqId);
        if (prereqNode) {
          const startX = this.x + this.offsetX + prereqNode.position.x * this.nodeSpacing;
          const startY = this.y + this.offsetY + prereqNode.position.y * this.nodeSpacing;
          const endX = this.x + this.offsetX + node.position.x * this.nodeSpacing;
          const endY = this.y + this.offsetY + node.position.y * this.nodeSpacing;
          
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        }
      }
    }
  }

  /**
   * 渲染技能节点
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderNodes(ctx) {
    const nodes = this.skillTree.getAllNodes();
    
    for (const node of nodes) {
      const nodeX = this.x + this.offsetX + node.position.x * this.nodeSpacing;
      const nodeY = this.y + this.offsetY + node.position.y * this.nodeSpacing;
      
      // 确定节点颜色
      let nodeColor;
      if (node === this.selectedNode) {
        nodeColor = this.colors.nodeSelected;
      } else if (node === this.hoveredNode) {
        nodeColor = this.colors.nodeHovered;
      } else if (node.isLearned) {
        nodeColor = this.colors.nodeLearned;
      } else if (this.skillTreeSystem.canLearnSkill(this.character, node.id)) {
        nodeColor = this.colors.nodeAvailable;
      } else {
        nodeColor = this.colors.nodeUnavailable;
      }
      
      // 绘制节点圆形
      ctx.fillStyle = nodeColor;
      ctx.beginPath();
      ctx.arc(nodeX, nodeY, this.nodeSize / 2, 0, Math.PI * 2);
      ctx.fill();
      
      // 绘制节点边框
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 绘制技能等级
      if (node.isLearned && node.maxLevel > 1) {
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${node.currentLevel}/${node.maxLevel}`, nodeX, nodeY + 25);
      }
      
      // 绘制技能名称
      ctx.fillStyle = node.isUnlocked ? this.colors.text : this.colors.textDisabled;
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      
      // 分行显示技能名称
      const lines = this.wrapText(node.name, 8);
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], nodeX, nodeY - 35 + i * 12);
      }
    }
  }

  /**
   * 渲染技能信息
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderSkillInfo(ctx) {
    if (!this.selectedNode) {
      return;
    }

    const infoX = this.x + 20;
    const infoY = this.y + this.height - 200;
    const infoWidth = 300;
    const infoHeight = 150;
    
    // 绘制信息背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(infoX, infoY, infoWidth, infoHeight);
    
    ctx.strokeStyle = this.colors.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(infoX, infoY, infoWidth, infoHeight);
    
    // 绘制技能信息
    ctx.fillStyle = this.colors.text;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    
    let textY = infoY + 20;
    
    // 技能名称
    ctx.fillText(this.selectedNode.name, infoX + 10, textY);
    textY += 20;
    
    // 技能类型
    ctx.font = '12px Arial';
    ctx.fillStyle = this.selectedNode.type === 'active' ? '#4CAF50' : '#2196F3';
    ctx.fillText(`类型: ${this.selectedNode.type === 'active' ? '主动技能' : '被动技能'}`, infoX + 10, textY);
    textY += 15;
    
    // 当前等级
    ctx.fillStyle = this.colors.text;
    ctx.fillText(`等级: ${this.selectedNode.currentLevel}/${this.selectedNode.maxLevel}`, infoX + 10, textY);
    textY += 15;
    
    // 学习条件
    if (!this.selectedNode.isLearned) {
      ctx.fillStyle = this.colors.textDisabled;
      ctx.fillText(`需要角色等级: ${this.selectedNode.requiredLevel}`, infoX + 10, textY);
      textY += 15;
      ctx.fillText(`需要技能点: ${this.selectedNode.requiredPoints}`, infoX + 10, textY);
      textY += 15;
    }
    
    // 技能描述
    ctx.fillStyle = this.colors.text;
    ctx.font = '10px Arial';
    const descLines = this.wrapText(this.selectedNode.description, 35);
    for (const line of descLines) {
      if (textY < infoY + infoHeight - 10) {
        ctx.fillText(line, infoX + 10, textY);
        textY += 12;
      }
    }
  }

  /**
   * 渲染按钮
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderButtons(ctx) {
    // 重置按钮
    const resetX = this.x + this.width - 120;
    const resetY = this.y + this.height - 40;
    const resetWidth = 80;
    const resetHeight = 30;
    
    ctx.fillStyle = '#F44336';
    ctx.fillRect(resetX, resetY, resetWidth, resetHeight);
    
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(resetX, resetY, resetWidth, resetHeight);
    
    ctx.fillStyle = '#FFF';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('重置技能', resetX + resetWidth / 2, resetY + resetHeight / 2 + 4);
    
    // 关闭按钮
    const closeX = this.x + this.width - 30;
    const closeY = this.y + 10;
    const closeSize = 20;
    
    ctx.fillStyle = '#F44336';
    ctx.fillRect(closeX, closeY, closeSize, closeSize);
    
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(closeX, closeY, closeSize, closeSize);
    
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('×', closeX + closeSize / 2, closeY + closeSize / 2 + 4);
  }

  /**
   * 渲染标题
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderTitle(ctx) {
    ctx.fillStyle = this.colors.text;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    
    const className = this.character ? this.character.class : '';
    const classNameCN = {
      'warrior': '战士',
      'strategist': '军师',
      'archer': '弓箭手'
    }[className] || className;
    
    ctx.fillText(`${classNameCN}技能树`, this.x + 20, this.y + 30);
    
    // 显示可用技能点
    if (this.character && this.character.skillPoints !== undefined) {
      ctx.font = '14px Arial';
      ctx.fillText(`可用技能点: ${this.character.skillPoints}`, this.x + 20, this.y + 50);
    }
  }

  /**
   * 文本换行
   * @param {string} text - 文本
   * @param {number} maxLength - 最大长度
   * @returns {Array<string>} 分行后的文本数组
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
   * 设置技能学习回调
   * @param {Function} callback - 回调函数
   */
  setOnSkillLearned(callback) {
    this.onSkillLearned = callback;
  }

  /**
   * 设置技能重置回调
   * @param {Function} callback - 回调函数
   */
  setOnSkillReset(callback) {
    this.onSkillReset = callback;
  }
}
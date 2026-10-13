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
 * 教程提示组件 (TutorialTooltip)
 * 需求: 2, 3, 4, 5, 37
 * 
 * 功能：
 * - 目标元素高亮
 * - 提示文本和箭头显示
 * - 多步骤教程导航
 */

import { Logger } from '../core/Logger.js';
import { UIElement } from './UIElement.js';

export class TutorialTooltip extends UIElement {
  /**
   * @param {Object} options - 配置选项
   * @param {Object} options.tutorialSystem - 教程系统引用
   * @param {Object} options.audioManager - 音频管理器
   */
  constructor(options = {}) {
    super({
      x: options.x || 0,
      y: options.y || 0,
      width: options.width || 400,
      height: options.height || 150,
      visible: options.visible !== undefined ? options.visible : false,
      zIndex: options.zIndex || 300  // 高于对话框
    });
    
    this.tutorialSystem = options.tutorialSystem;
    this.audioManager = options.audioManager;
    
    // 当前教程数据
    this.currentTutorial = null;
    this.currentStepIndex = 0;
    
    // 目标元素信息
    this.targetElement = null;  // { x, y, width, height }
    this.highlightPadding = 10;
    
    // 样式配置
    this.padding = 15;
    this.backgroundColor = 'rgba(255, 215, 0, 0.95)';  // 金黄色背景
    this.borderColor = '#FF8C00';  // 深橙色边框
    this.textColor = '#000000';
    this.titleColor = '#8B4513';  // 棕色标题
    this.highlightColor = 'rgba(255, 255, 0, 0.3)';  // 半透明黄色高亮
    this.overlayColor = 'rgba(0, 0, 0, 0.7)';  // 遮罩层
    
    // 字体配置
    this.titleFont = 'bold 18px Arial, sans-serif';
    this.textFont = '16px Arial, sans-serif';
    this.stepFont = '14px Arial, sans-serif';
    
    // 箭头配置
    this.arrowSize = 15;
    this.arrowDirection = 'down';  // up, down, left, right
    
    // 动画效果
    this.pulseAlpha = 1.0;
    this.pulseDirection = -1;
    this.pulseSpeed = 0.002;
    
    // 按钮配置
    this.buttonWidth = 80;
    this.buttonHeight = 35;
    this.buttonSpacing = 10;
    this.hoveredButton = null;  // 'prev', 'next', 'skip', 'close'
    
    // 回调函数
    this.onComplete = options.onComplete || null;
    this.onSkip = options.onSkip || null;
    this.onStepChange = options.onStepChange || null;
    
    // 音效键
    this.showSoundKey = 'tutorial_show';
    this.stepSoundKey = 'tutorial_step';
    this.completeSoundKey = 'tutorial_complete';
    
    Logger.log('TutorialTooltip: 初始化完成');
  }

  /**
   * 显示教程
   * @param {Object} tutorial - 教程数据
   * @param {string} tutorial.id - 教程ID
   * @param {string} tutorial.title - 教程标题
   * @param {Array} tutorial.steps - 教程步骤数组
   * @param {boolean} tutorial.pauseGame - 是否暂停游戏
   */
  showTutorial(tutorial) {
    if (!tutorial || !tutorial.steps || tutorial.steps.length === 0) {
      console.warn('TutorialTooltip: 无效的教程数据');
      return;
    }
    
    this.currentTutorial = tutorial;
    this.currentStepIndex = 0;
    this.show();
    this.updateCurrentStep();
    this.playShowSound();
    
    Logger.log(`TutorialTooltip: 显示教程 "${tutorial.title}"`);
  }

  /**
   * 更新当前步骤
   */
  updateCurrentStep() {
    if (!this.currentTutorial || !this.currentTutorial.steps) return;
    
    const step = this.currentTutorial.steps[this.currentStepIndex];
    if (!step) return;
    
    // 更新目标元素
    this.targetElement = step.targetElement || null;
    
    // 更新箭头方向
    this.arrowDirection = step.arrowDirection || 'down';
    
    // 计算提示框位置
    this.calculatePosition();
    
    // 触发步骤变化回调
    if (this.onStepChange) {
      this.onStepChange(this.currentStepIndex, step);
    }
  }

  /**
   * 计算提示框位置（基于目标元素）
   */
  calculatePosition() {
    if (!this.targetElement) {
      // 无目标元素时，居中显示
      this.x = (800 - this.width) / 2;  // 假设画布宽度800
      this.y = 100;
      return;
    }
    
    const target = this.targetElement;
    const spacing = 20;
    
    // 根据箭头方向计算位置
    switch (this.arrowDirection) {
      case 'up':
        this.x = target.x + target.width / 2 - this.width / 2;
        this.y = target.y - this.height - spacing - this.arrowSize;
        break;
      case 'down':
        this.x = target.x + target.width / 2 - this.width / 2;
        this.y = target.y + target.height + spacing + this.arrowSize;
        break;
      case 'left':
        this.x = target.x - this.width - spacing - this.arrowSize;
        this.y = target.y + target.height / 2 - this.height / 2;
        break;
      case 'right':
        this.x = target.x + target.width + spacing + this.arrowSize;
        this.y = target.y + target.height / 2 - this.height / 2;
        break;
      default:
        this.x = target.x + target.width / 2 - this.width / 2;
        this.y = target.y + target.height + spacing + this.arrowSize;
    }
    
    // 确保提示框在画布内
    this.x = Math.max(10, Math.min(this.x, 800 - this.width - 10));
    this.y = Math.max(10, Math.min(this.y, 600 - this.height - 10));
  }

  /**
   * 下一步
   */
  nextStep() {
    if (!this.currentTutorial) return;
    
    if (this.currentStepIndex < this.currentTutorial.steps.length - 1) {
      this.currentStepIndex++;
      this.updateCurrentStep();
      this.playStepSound();
    } else {
      this.completeTutorial();
    }
  }

  /**
   * 上一步
   */
  prevStep() {
    if (!this.currentTutorial) return;
    
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.updateCurrentStep();
      this.playStepSound();
    }
  }

  /**
   * 跳过教程
   */
  skipTutorial() {
    Logger.log('TutorialTooltip: 跳过教程');
    this.hide();
    this.currentTutorial = null;
    this.currentStepIndex = 0;
    
    if (this.onSkip) {
      this.onSkip();
    }
  }

  /**
   * 完成教程
   */
  completeTutorial() {
    Logger.log('TutorialTooltip: 完成教程');
    this.playCompleteSound();
    this.hide();
    
    const completedTutorial = this.currentTutorial;
    this.currentTutorial = null;
    this.currentStepIndex = 0;
    
    if (this.onComplete) {
      this.onComplete(completedTutorial);
    }
  }

  update(deltaTime) {
    if (!this.visible) return;
    
    // 更新脉冲动画
    this.pulseAlpha += this.pulseDirection * this.pulseSpeed * deltaTime;
    if (this.pulseAlpha >= 1.0) {
      this.pulseAlpha = 1.0;
      this.pulseDirection = -1;
    } else if (this.pulseAlpha <= 0.5) {
      this.pulseAlpha = 0.5;
      this.pulseDirection = 1;
    }
  }

  render(ctx) {
    if (!this.visible || !this.currentTutorial) return;
    
    const step = this.currentTutorial.steps[this.currentStepIndex];
    if (!step) return;
    
    ctx.save();
    
    // 渲染遮罩层（如果需要暂停游戏）
    if (this.currentTutorial.pauseGame) {
      this.renderOverlay(ctx);
    }
    
    // 渲染目标元素高亮
    if (this.targetElement) {
      this.renderHighlight(ctx);
    }
    
    // 渲染箭头
    this.renderArrow(ctx);
    
    // 渲染提示框
    this.renderTooltip(ctx, step);
    
    ctx.restore();
  }

  /**
   * 渲染遮罩层
   */
  renderOverlay(ctx) {
    ctx.fillStyle = this.overlayColor;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  /**
   * 渲染目标元素高亮
   */
  renderHighlight(ctx) {
    if (!this.targetElement) return;
    
    const target = this.targetElement;
    const padding = this.highlightPadding;
    
    ctx.save();
    ctx.globalAlpha = this.pulseAlpha;
    
    // 绘制高亮边框
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      target.x - padding,
      target.y - padding,
      target.width + padding * 2,
      target.height + padding * 2
    );
    
    // 绘制高亮填充
    ctx.fillStyle = this.highlightColor;
    ctx.fillRect(
      target.x - padding,
      target.y - padding,
      target.width + padding * 2,
      target.height + padding * 2
    );
    
    ctx.restore();
  }

  /**
   * 渲染箭头
   */
  renderArrow(ctx) {
    if (!this.targetElement) return;
    
    ctx.fillStyle = this.backgroundColor;
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    
    switch (this.arrowDirection) {
      case 'up':
        // 箭头指向上方
        ctx.moveTo(this.x + this.width / 2, this.y + this.height);
        ctx.lineTo(this.x + this.width / 2 - this.arrowSize, this.y + this.height + this.arrowSize);
        ctx.lineTo(this.x + this.width / 2 + this.arrowSize, this.y + this.height + this.arrowSize);
        break;
      case 'down':
        // 箭头指向下方
        ctx.moveTo(this.x + this.width / 2, this.y);
        ctx.lineTo(this.x + this.width / 2 - this.arrowSize, this.y - this.arrowSize);
        ctx.lineTo(this.x + this.width / 2 + this.arrowSize, this.y - this.arrowSize);
        break;
      case 'left':
        // 箭头指向左方
        ctx.moveTo(this.x + this.width, this.y + this.height / 2);
        ctx.lineTo(this.x + this.width + this.arrowSize, this.y + this.height / 2 - this.arrowSize);
        ctx.lineTo(this.x + this.width + this.arrowSize, this.y + this.height / 2 + this.arrowSize);
        break;
      case 'right':
        // 箭头指向右方
        ctx.moveTo(this.x, this.y + this.height / 2);
        ctx.lineTo(this.x - this.arrowSize, this.y + this.height / 2 - this.arrowSize);
        ctx.lineTo(this.x - this.arrowSize, this.y + this.height / 2 + this.arrowSize);
        break;
    }
    
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /**
   * 渲染提示框
   */
  renderTooltip(ctx, step) {
    // 绘制背景
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    
    // 绘制边框
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
    
    // 绘制标题
    ctx.fillStyle = this.titleColor;
    ctx.font = this.titleFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      this.currentTutorial.title,
      this.x + this.padding,
      this.y + this.padding
    );
    
    // 绘制步骤文本
    ctx.fillStyle = this.textColor;
    ctx.font = this.textFont;
    const textY = this.y + this.padding + 30;
    const textWidth = this.width - this.padding * 2;
    const lines = this.wrapText(ctx, step.text, textWidth);
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        this.x + this.padding,
        textY + index * 22
      );
    });
    
    // 绘制步骤指示器
    ctx.fillStyle = this.textColor;
    ctx.font = this.stepFont;
    ctx.textAlign = 'center';
    const stepText = `${this.currentStepIndex + 1} / ${this.currentTutorial.steps.length}`;
    ctx.fillText(
      stepText,
      this.x + this.width / 2,
      this.y + this.height - this.padding - 40
    );
    
    // 绘制按钮
    this.renderButtons(ctx);
  }

  /**
   * 渲染按钮
   */
  renderButtons(ctx) {
    const buttonY = this.y + this.height - this.padding - 30;
    const buttons = [];
    
    // 上一步按钮
    if (this.currentStepIndex > 0) {
      buttons.push({
        id: 'prev',
        text: '上一步',
        x: this.x + this.padding
      });
    }
    
    // 下一步/完成按钮
    const isLastStep = this.currentStepIndex === this.currentTutorial.steps.length - 1;
    buttons.push({
      id: 'next',
      text: isLastStep ? '完成' : '下一步',
      x: this.x + this.width - this.padding - this.buttonWidth
    });
    
    // 跳过按钮
    if (!isLastStep) {
      buttons.push({
        id: 'skip',
        text: '跳过',
        x: this.x + this.width / 2 - this.buttonWidth / 2
      });
    }
    
    // 绘制按钮
    buttons.forEach(button => {
      const isHovered = this.hoveredButton === button.id;
      
      // 按钮背景
      ctx.fillStyle = isHovered ? '#FF8C00' : '#FFA500';
      ctx.fillRect(button.x, buttonY, this.buttonWidth, this.buttonHeight);
      
      // 按钮边框
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(button.x, buttonY, this.buttonWidth, this.buttonHeight);
      
      // 按钮文字
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '14px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        button.text,
        button.x + this.buttonWidth / 2,
        buttonY + this.buttonHeight / 2
      );
    });
  }

  /**
   * 文本换行
   */
  wrapText(ctx, text, maxWidth) {
    const lines = [];
    const paragraphs = text.split('\n');
    
    paragraphs.forEach(paragraph => {
      let line = '';
      const chars = paragraph.split('');
      
      for (let i = 0; i < chars.length; i++) {
        const testLine = line + chars[i];
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && line.length > 0) {
          lines.push(line);
          line = chars[i];
        } else {
          line = testLine;
        }
      }
      
      if (line.length > 0) {
        lines.push(line);
      }
    });
    
    return lines;
  }

  /**
   * 处理鼠标移动
   */
  handleMouseMove(mouseX, mouseY) {
    if (!this.visible) return;
    
    const buttonY = this.y + this.height - this.padding - 30;
    let newHoveredButton = null;
    
    // 检查上一步按钮
    if (this.currentStepIndex > 0) {
      const prevX = this.x + this.padding;
      if (this.isPointInButton(mouseX, mouseY, prevX, buttonY)) {
        newHoveredButton = 'prev';
      }
    }
    
    // 检查下一步/完成按钮
    const nextX = this.x + this.width - this.padding - this.buttonWidth;
    if (this.isPointInButton(mouseX, mouseY, nextX, buttonY)) {
      newHoveredButton = 'next';
    }
    
    // 检查跳过按钮
    const isLastStep = this.currentStepIndex === this.currentTutorial.steps.length - 1;
    if (!isLastStep) {
      const skipX = this.x + this.width / 2 - this.buttonWidth / 2;
      if (this.isPointInButton(mouseX, mouseY, skipX, buttonY)) {
        newHoveredButton = 'skip';
      }
    }
    
    this.hoveredButton = newHoveredButton;
  }

  /**
   * 检查点是否在按钮内
   */
  isPointInButton(x, y, buttonX, buttonY) {
    return x >= buttonX && x <= buttonX + this.buttonWidth &&
           y >= buttonY && y <= buttonY + this.buttonHeight;
  }

  /**
   * 处理鼠标点击
   */
  handleMouseClick(mouseX, mouseY) {
    if (!this.visible) return false;
    
    const buttonY = this.y + this.height - this.padding - 30;
    
    // 检查上一步按钮
    if (this.currentStepIndex > 0) {
      const prevX = this.x + this.padding;
      if (this.isPointInButton(mouseX, mouseY, prevX, buttonY)) {
        this.prevStep();
        return true;
      }
    }
    
    // 检查下一步/完成按钮
    const nextX = this.x + this.width - this.padding - this.buttonWidth;
    if (this.isPointInButton(mouseX, mouseY, nextX, buttonY)) {
      this.nextStep();
      return true;
    }
    
    // 检查跳过按钮
    const isLastStep = this.currentStepIndex === this.currentTutorial.steps.length - 1;
    if (!isLastStep) {
      const skipX = this.x + this.width / 2 - this.buttonWidth / 2;
      if (this.isPointInButton(mouseX, mouseY, skipX, buttonY)) {
        this.skipTutorial();
        return true;
      }
    }
    
    return false;
  }

  /**
   * 播放显示音效
   */
  playShowSound() {
    if (this.audioManager && this.audioManager.hasSound(this.showSoundKey)) {
      this.audioManager.playSound(this.showSoundKey, { volume: 0.5 });
    }
  }

  /**
   * 播放步骤切换音效
   */
  playStepSound() {
    if (this.audioManager && this.audioManager.hasSound(this.stepSoundKey)) {
      this.audioManager.playSound(this.stepSoundKey, { volume: 0.5 });
    }
  }

  /**
   * 播放完成音效
   */
  playCompleteSound() {
    if (this.audioManager && this.audioManager.hasSound(this.completeSoundKey)) {
      this.audioManager.playSound(this.completeSoundKey, { volume: 0.7 });
    }
  }

  /**
   * 设置教程系统
   */
  setTutorialSystem(tutorialSystem) {
    this.tutorialSystem = tutorialSystem;
  }

  /**
   * 设置音频管理器
   */
  setAudioManager(audioManager) {
    this.audioManager = audioManager;
  }

  /**
   * 获取当前教程
   */
  getCurrentTutorial() {
    return this.currentTutorial;
  }

  /**
   * 获取当前步骤索引
   */
  getCurrentStepIndex() {
    return this.currentStepIndex;
  }

  /**
   * 是否是最后一步
   */
  isLastStep() {
    if (!this.currentTutorial) return false;
    return this.currentStepIndex === this.currentTutorial.steps.length - 1;
  }

  /**
   * 隐藏提示框
   */
  hide() {
    super.hide();
    this.hoveredButton = null;
  }
}

export default TutorialTooltip;

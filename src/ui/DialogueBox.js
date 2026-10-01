/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * 对话框组件 (DialogueBox)
 * 需求: 6, 9, 35
 */

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';

export class DialogueBox extends UIElement {
  constructor(options = {}) {
    super({
      x: options.x || 0,
      y: options.y || 0,
      width: options.width || 1100,
      height: options.height || 230,
      visible: options.visible !== undefined ? options.visible : false,
      zIndex: options.zIndex || 200
    });
    
    this.dialogueSystem = options.dialogueSystem;
    this.audioManager = options.audioManager;
    this.onChoiceSelect = options.onChoiceSelect || null;
    this.onDialogueEnd = options.onDialogueEnd || null;
    this.onContinue = options.onContinue || null;
    
    this.padding = 20;
    this.portraitSize = 100;
    this.portraitPadding = 15;
    this.textPadding = 15;
    this.choiceSpacing = 10;
    this.choiceHeight = 40;
    this.minHeight = 230;
    this.baseHeight = 230;
    this.baseY = options.y || 0;
    this.choiceOffsetY = 200;
    
    this.hoveredChoiceIndex = -1;
    this.canInteract = true;
    
    this.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    this.borderColor = '#8B7355';
    this.textColor = '#FFFFFF';
    this.speakerColor = '#FFD700';
    this.choiceColor = '#4A90E2';
    this.choiceHoverColor = '#5BA3F5';
    this.choiceTextColor = '#FFFFFF';
    
    this.speakerFont = 'bold 20px Arial, sans-serif';
    this.textFont = '18px Arial, sans-serif';
    this.choiceFont = '16px Arial, sans-serif';
    
    this.typewriterSoundKey = 'dialogue_type';
    this.typewriterSoundInterval = 3;
    this.lastTypewriterSoundIndex = 0;
    this.choiceHoverSoundKey = 'dialogue_hover';
    this.choiceSelectSoundKey = 'dialogue_select';
    
    this.showContinuePrompt = false;
    this.continuePromptAlpha = 0;
    this.continuePromptDirection = 1;
    
    // 通用头像映射表：portraitKey → HTMLImageElement
    // 支持两种传入方式：
    //   1. options.portraits = { zhangjiao: 'assets/images/zhangjiao.png', ... }
    //   2. 兼容旧参数 options.zhangjiaoImagePath / options.playerImagePath
    this.portraitImages = {};
    const portraitSources = options.portraits || {};
    // 兼容旧参数
    if (options.zhangjiaoImagePath) portraitSources.zhangjiao = options.zhangjiaoImagePath;
    if (options.playerImagePath)    portraitSources.player    = options.playerImagePath;
    
    for (const [key, src] of Object.entries(portraitSources)) {
      const img = new Image();
      img.src = src;
      this.portraitImages[key] = img;
    }

    // UI 编辑器保存的四种对话框布局矩形 { narration, portrait, halfBody, fullBody }
    this.layoutRects = options.layoutRects || null;
    // presentation 图片懒加载缓存（src 路径 → HTMLImageElement）
    this._dynamicImages = {};

    console.log('DialogueBox: 初始化完成');
  }

  /** 应用 UI 编辑器保存的四种对话框布局矩形（未配置的类型回退构造尺寸）。 */
  setLayoutRects(rects) {
    this.layoutRects = rects && typeof rects === 'object' ? rects : null;
    return this;
  }

  /** 当前对话的演出档案：boxType + 对话级 presentation 配置。 @private */
  _currentPresentation() {
    const presentation = this.dialogueSystem?.currentDialogue?.presentation || null;
    let boxType = presentation?.boxType || 'portrait';
    if (!['narration', 'portrait', 'halfBody', 'fullBody'].includes(boxType)) boxType = 'portrait';
    return { boxType, presentation };
  }

  /** 懒加载图片（路径 → HTMLImageElement）。 @private */
  _getImage(src) {
    const key = String(src || '').trim();
    if (!key) return null;
    if (!this._dynamicImages[key]) {
      const img = new Image();
      img.src = key;
      this._dynamicImages[key] = img;
    }
    return this._dynamicImages[key];
  }

  /**
   * 头像来源解析：节点 portrait（路径或 PortraitsConfig key）优先，
   * 其次对话级 presentation.portraitImage。
   * @returns {{img: HTMLImageElement|null, fallbackKey: string|null}}
   * @private
   */
  _resolvePortraitSource(currentNode, presentation) {
    const nodePortrait = String(currentNode?.portrait || '').trim();
    if (nodePortrait) {
      if (/[./]/.test(nodePortrait)) return { img: this._getImage(nodePortrait), fallbackKey: null };
      return { img: this.portraitImages[nodePortrait] || null, fallbackKey: nodePortrait };
    }
    const presentationImage = String(presentation?.portraitImage || '').trim();
    if (presentationImage) return { img: this._getImage(presentationImage), fallbackKey: null };
    return { img: null, fallbackKey: null };
  }

  /**
   * 当前演出类型的布局度量（纯读取，不修改几何）。
   * narration 无立绘区；portrait 保持方形头像；halfBody 左侧立绘区随框高自适应
   * （扣除选项区高度，避免选项与立绘重叠）。
   * @private
   */
  _layoutMetrics(currentNode = null) {
    const { boxType, presentation } = this._currentPresentation();
    const choicesAreaHeight = currentNode?.choices?.length > 0
      ? this.textPadding
        + (currentNode.choices.length * this.choiceHeight)
        + ((currentNode.choices.length - 1) * this.choiceSpacing)
        + this.padding
      : 0;
    const contentHeight = Math.max(0, this.height - this.padding * 2 - 40 - choicesAreaHeight);
    let portraitAreaHeight = 0;
    let halfBodyWidth = 0;
    if (boxType === 'portrait') {
      portraitAreaHeight = this.portraitSize;
    } else if (boxType === 'halfBody') {
      halfBodyWidth = Math.max(120, Math.min(240, Math.round(contentHeight * 0.75)));
      portraitAreaHeight = contentHeight;
    }
    const speakerColor = boxType === 'narration' ? '#9fb3c8' : this.speakerColor;
    return { boxType, presentation, portraitAreaHeight, halfBodyWidth, speakerColor };
  }

  /** 左侧立绘/头像区域矩形（narration/fullBody 返回零宽区域）。 @private */
  _portraitRegion(metrics) {
    const width = metrics.boxType === 'halfBody' ? metrics.halfBodyWidth : this.portraitSize;
    const height = metrics.boxType === 'halfBody' ? metrics.portraitAreaHeight : this.portraitSize;
    return { x: this.x + this.padding, y: this.y + this.padding + 40, width, height };
  }

  /** 内容需要的最小高度（标题行 + 最小立绘区 + 可选项）；halfBody 立绘区用固定下限防循环增长。 @private */
  _requiredHeight(currentNode, metrics) {
    const choicesAreaHeight = currentNode?.choices?.length > 0
      ? this.textPadding
        + (currentNode.choices.length * this.choiceHeight)
        + ((currentNode.choices.length - 1) * this.choiceSpacing)
        + this.padding
      : 0;
    const minPortraitArea = metrics.boxType === 'halfBody' ? 120 : (metrics.portraitAreaHeight || 70);
    return this.padding + 30 + minPortraitArea + this.padding + choicesAreaHeight;
  }

  /**
   * 按当前演出类型应用几何：有编辑器矩形时以矩形为锚向下增长，
   * 否则保持现有居中行为。返回布局度量供本轮渲染复用。
   * @private
   */
  _applyLayoutGeometry(currentNode, canvasHeight) {
    const metrics = this._layoutMetrics(currentNode);
    const rect = this.layoutRects?.[metrics.boxType] || null;
    const requiredHeight = this._requiredHeight(currentNode, metrics);
    if (rect) {
      this.x = rect.x;
      this.y = rect.y;
      this.width = rect.width;
      this.height = Math.max(rect.height, requiredHeight);
    } else {
      this.height = Math.max(this.minHeight, requiredHeight);
      this.y = (canvasHeight - this.height) / 2;
    }
    if (this.y < 0) this.y = 0;
    if (this.y + this.height > canvasHeight) this.y = canvasHeight - this.height;
    return metrics;
  }

  /** 区域内 contain 绘制图片（可底对齐，用于半身/全身立绘）。 @private */
  _drawImageContain(ctx, img, region, bottomAlign = false) {
    if (!img?.naturalWidth || !img?.naturalHeight) return;
    const scale = Math.min(region.width / img.naturalWidth, region.height / img.naturalHeight);
    const drawWidth = img.naturalWidth * scale;
    const drawHeight = img.naturalHeight * scale;
    const dx = region.x + (region.width - drawWidth) / 2;
    const dy = bottomAlign
      ? region.y + (region.height - drawHeight)
      : region.y + (region.height - drawHeight) / 2;
    ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
  }

  update(deltaTime) {
    if (!this.visible || !this.dialogueSystem) return;
    
    const wasTyping = this.dialogueSystem.isTyping();
    this.dialogueSystem.update(deltaTime);
    const isTyping = this.dialogueSystem.isTyping();
    
    if (isTyping && this.audioManager) {
      const currentIndex = this.dialogueSystem.typewriterState.currentIndex;
      if (currentIndex > this.lastTypewriterSoundIndex + this.typewriterSoundInterval) {
        this.playTypewriterSound();
        this.lastTypewriterSoundIndex = currentIndex;
      }
    }
    
    if (!isTyping && wasTyping) {
      this.lastTypewriterSoundIndex = 0;
    }
    
    const currentNode = this.dialogueSystem.getCurrentNode();
    if (currentNode && !isTyping) {
      this.showContinuePrompt = !currentNode.choices || currentNode.choices.length === 0;
      
      if (this.showContinuePrompt) {
        this.continuePromptAlpha += this.continuePromptDirection * deltaTime * 0.002;
        if (this.continuePromptAlpha >= 1) {
          this.continuePromptAlpha = 1;
          this.continuePromptDirection = -1;
        } else if (this.continuePromptAlpha <= 0.3) {
          this.continuePromptAlpha = 0.3;
          this.continuePromptDirection = 1;
        }
      }
    } else {
      this.showContinuePrompt = false;
    }
  }

  render(ctx) {
    if (!this.visible || !this.dialogueSystem || !this.dialogueSystem.isDialogueActive()) return;

    const currentNode = this.dialogueSystem.getCurrentNode();
    if (!currentNode) return;

    const metrics = this._applyLayoutGeometry(currentNode, ctx.canvas.height);

    ctx.save();
    this.renderBackground(ctx);
    if (metrics.boxType === 'fullBody') this.renderFullBodyArt(ctx, metrics);
    if (metrics.portraitAreaHeight > 0) this.renderPortraitArea(ctx, metrics, currentNode);
    this.renderSpeaker(ctx, currentNode.speaker, metrics);
    this.renderText(ctx, this.dialogueSystem.getDisplayedText(), metrics);
    if (currentNode.choices && currentNode.choices.length > 0 && !this.dialogueSystem.isTyping()) {
      this.renderChoices(ctx, currentNode.choices, metrics);
    }
    if (this.showContinuePrompt) this.renderContinuePrompt(ctx);
    ctx.restore();
  }

  /** 左侧立绘区：portrait 保持方形头像，halfBody 绘制底对齐半身立绘。 @private */
  renderPortraitArea(ctx, metrics, currentNode) {
    const region = this._portraitRegion(metrics);
    if (region.width <= 0 || region.height <= 0) return;
    const source = this._resolvePortraitSource(currentNode, metrics.presentation);
    const img = source.img;
    const hasImage = img && img.complete && img.naturalWidth > 0;

    // 立绘底框
    ctx.fillStyle = 'rgba(30, 30, 30, 0.9)';
    ctx.fillRect(region.x, region.y, region.width, region.height);
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(region.x, region.y, region.width, region.height);

    ctx.save();
    if (metrics.boxType === 'halfBody') {
      // 半身立绘：区域内 contain + 底对齐（无边距裁剪，保留立绘完整轮廓）
      if (hasImage) {
        this._drawImageContain(ctx, img, {
          x: region.x + 4, y: region.y + 4,
          width: region.width - 8, height: region.height - 8
        }, true);
      } else {
        ctx.fillStyle = '#666';
        ctx.font = '14px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('半身像', region.x + region.width / 2, region.y + region.height / 2);
      }
      ctx.restore();
      return;
    }

    // 方形头像：居中裁剪（沿用原有视觉）
    ctx.translate(region.x + region.width / 2, region.y + region.height / 2);
    if (hasImage) {
      this.drawPortraitImage(ctx, img);
    } else if (source.fallbackKey === 'zhangjiao') {
      this.drawZhangjiaoPortrait(ctx);
    } else if (source.fallbackKey === 'player') {
      this.drawPlayerPortrait(ctx);
    } else {
      ctx.fillStyle = '#666';
      ctx.font = '14px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('头像', 0, 0);
    }
    ctx.restore();
  }

  /** 全身立绘：画在文本框右侧、底对齐（需要对话配置 fullBodyImage）。 @private */
  renderFullBodyArt(ctx, metrics) {
    const src = String(metrics.presentation?.fullBodyImage || '').trim();
    if (!src) return;
    const img = this._getImage(src);
    if (!img || !img.complete || img.naturalWidth <= 0) return;
    const artHeight = Math.max(160, Math.min(460, Math.round(this.height * 1.6)));
    const artWidth = Math.max(120, Math.min(320, Math.round(artHeight * 0.6)));
    this._drawImageContain(ctx, img, {
      x: this.x + this.width + 20,
      y: this.y + this.height - artHeight,
      width: artWidth,
      height: artHeight
    }, true);
  }

  renderBackground(ctx) {
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x + this.padding, this.y + this.padding + 30);
    ctx.lineTo(this.x + this.width - this.padding, this.y + this.padding + 30);
    ctx.stroke();
  }

  /**
   * 通用图片头像绘制（圆角矩形裁剪）
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLImageElement} img
   */
  drawPortraitImage(ctx, img) {
    const size = this.portraitSize - 10;
    const halfSize = size / 2;
    const radius = 8;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-halfSize + radius, -halfSize);
    ctx.lineTo(halfSize - radius, -halfSize);
    ctx.quadraticCurveTo(halfSize, -halfSize, halfSize, -halfSize + radius);
    ctx.lineTo(halfSize, halfSize - radius);
    ctx.quadraticCurveTo(halfSize, halfSize, halfSize - radius, halfSize);
    ctx.lineTo(-halfSize + radius, halfSize);
    ctx.quadraticCurveTo(-halfSize, halfSize, -halfSize, halfSize - radius);
    ctx.lineTo(-halfSize, -halfSize + radius);
    ctx.quadraticCurveTo(-halfSize, -halfSize, -halfSize + radius, -halfSize);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, -halfSize, -halfSize, size, size);
    ctx.restore();
  }

  /**
   * 绘制张角头像（canvas 回退，无图片时使用）
   */
  drawZhangjiaoPortrait(ctx) {
    ctx.fillStyle = '#f4d4a8';
    ctx.beginPath();
    ctx.arc(0, 0, 35, 0, Math.PI * 2);
    ctx.fill();
    
    // 道士帽（黄色）
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(-40, -10);
    ctx.lineTo(40, -10);
    ctx.lineTo(35, -35);
    ctx.lineTo(-35, -35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 帽子装饰（红色符文）
    ctx.fillStyle = '#ff0000';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('太', 0, -22);
    
    // 眼睛
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(-12, -5, 3, 0, Math.PI * 2);
    ctx.arc(12, -5, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // 眉毛
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, -12);
    ctx.lineTo(-8, -10);
    ctx.moveTo(8, -10);
    ctx.lineTo(18, -12);
    ctx.stroke();
    
    // 胡须
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // 左胡须
    ctx.moveTo(-15, 15);
    ctx.lineTo(-25, 25);
    ctx.moveTo(-12, 18);
    ctx.lineTo(-22, 30);
    ctx.moveTo(-10, 20);
    ctx.lineTo(-18, 32);
    // 右胡须
    ctx.moveTo(15, 15);
    ctx.lineTo(25, 25);
    ctx.moveTo(12, 18);
    ctx.lineTo(22, 30);
    ctx.moveTo(10, 20);
    ctx.lineTo(18, 32);
    ctx.stroke();
    
    // 嘴巴（微笑）
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 5, 8, 0.2, Math.PI - 0.2);
    ctx.stroke();
    
    // 道袍领口
    ctx.fillStyle = '#8b7355';
    ctx.beginPath();
    ctx.moveTo(-30, 35);
    ctx.lineTo(-15, 45);
    ctx.lineTo(15, 45);
    ctx.lineTo(30, 35);
    ctx.lineTo(0, 35);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 绘制玩家头像（canvas 回退，无图片时使用）
   */
  drawPlayerPortrait(ctx) {
    ctx.fillStyle = '#e8c4a0';
    ctx.beginPath();
    ctx.arc(0, 0, 35, 0, Math.PI * 2);
    ctx.fill();
    
    // 头发（凌乱的黑发）
    ctx.fillStyle = '#2c2c2c';
    ctx.beginPath();
    ctx.arc(-20, -20, 15, 0, Math.PI * 2);
    ctx.arc(0, -25, 18, 0, Math.PI * 2);
    ctx.arc(20, -20, 15, 0, Math.PI * 2);
    ctx.fill();
    
    // 眼睛（疲惫的眼神）
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(-12, -3, 2, 0, Math.PI * 2);
    ctx.arc(12, -3, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // 眼袋
    ctx.strokeStyle = '#c4a080';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-12, 0, 5, 0, Math.PI);
    ctx.arc(12, 0, 5, 0, Math.PI);
    ctx.stroke();
    
    // 眉毛（皱眉）
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, -10);
    ctx.lineTo(-8, -8);
    ctx.moveTo(8, -8);
    ctx.lineTo(18, -10);
    ctx.stroke();
    
    // 嘴巴（紧闭）
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 12);
    ctx.lineTo(8, 12);
    ctx.stroke();
    
    // 破旧衣服
    ctx.fillStyle = '#6b5d4f';
    ctx.beginPath();
    ctx.moveTo(-30, 35);
    ctx.lineTo(-20, 45);
    ctx.lineTo(20, 45);
    ctx.lineTo(30, 35);
    ctx.lineTo(0, 35);
    ctx.closePath();
    ctx.fill();
    
    // 衣服补丁
    ctx.strokeStyle = '#4a3f35';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-15, 38);
    ctx.lineTo(-10, 38);
    ctx.lineTo(-10, 42);
    ctx.lineTo(-15, 42);
    ctx.closePath();
    ctx.stroke();
  }

  renderSpeaker(ctx, speaker, metrics = this._layoutMetrics()) {
    if (!speaker) return;
    ctx.fillStyle = metrics.speakerColor;
    ctx.font = this.speakerFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(speaker, this.x + this.padding, this.y + this.padding);
  }

  renderText(ctx, text, metrics = this._layoutMetrics()) {
    if (!text) return;
    const region = this._portraitRegion(metrics);
    const textX = region.x + region.width + (metrics.portraitAreaHeight > 0 ? this.portraitPadding : 0);
    const textY = this.y + this.padding + 40;
    const textWidth = Math.max(60, this.x + this.width - this.padding - textX);
    const textHeight = Math.max(60, metrics.portraitAreaHeight);
    ctx.fillStyle = this.textColor;
    ctx.font = this.textFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lines = this.wrapText(ctx, text, textWidth);
    const lineHeight = 24;
    lines.forEach((line, index) => {
      if (index * lineHeight < textHeight) {
        ctx.fillText(line, textX, textY + index * lineHeight);
      }
    });
  }

  renderChoices(ctx, choices, metrics = this._layoutMetrics()) {
    if (!choices || choices.length === 0) return;
    const choicesStartY = this.y + this.padding + 40 + metrics.portraitAreaHeight + this.textPadding;
    const choiceWidth = this.width - this.padding * 2;
    choices.forEach((choice, index) => {
      const choiceY = choicesStartY + index * (this.choiceHeight + this.choiceSpacing);
      const isHovered = this.hoveredChoiceIndex === index;
      ctx.fillStyle = isHovered ? this.choiceHoverColor : this.choiceColor;
      ctx.fillRect(this.x + this.padding, choiceY, choiceWidth, this.choiceHeight);
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x + this.padding, choiceY, choiceWidth, this.choiceHeight);
      ctx.fillStyle = this.choiceTextColor;
      ctx.font = this.choiceFont;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const choiceText = String(index + 1) + '. ' + choice.text;
      ctx.fillText(choiceText, this.x + this.padding + 15, choiceY + this.choiceHeight / 2);
    });
  }

  renderContinuePrompt(ctx) {
    // 按当前输入方案显示匹配的操作提示
    const promptText = `▼ ${InputHints.phrase('dialogueContinue')} ▼`;
    const promptX = this.x + this.width - this.padding - 10;
    const promptY = this.y + this.height - this.padding - 10;
    ctx.save();
    ctx.globalAlpha = this.continuePromptAlpha;
    ctx.fillStyle = this.speakerColor;
    ctx.font = '14px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(promptText, promptX, promptY);
    ctx.restore();
  }

  wrapText(ctx, text, maxWidth) {
    const lines = [];
    const paragraphs = text.split('\n');
    paragraphs.forEach(paragraph => {
      let line = '';
      const words = paragraph.split('');
      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && line.length > 0) {
          lines.push(line);
          line = words[i];
        } else {
          line = testLine;
        }
      }
      if (line.length > 0) lines.push(line);
    });
    return lines;
  }

  handleMouseMove(mouseX, mouseY) {
    if (!this.visible || !this.canInteract) return;
    const currentNode = this.dialogueSystem.getCurrentNode();
    if (!currentNode || !currentNode.choices || currentNode.choices.length === 0) {
      this.hoveredChoiceIndex = -1;
      return;
    }
    const metrics = this._layoutMetrics(currentNode);
    const choicesStartY = this.y + this.padding + 40 + metrics.portraitAreaHeight + this.textPadding;
    const choiceWidth = this.width - this.padding * 2;
    let newHoveredIndex = -1;
    for (let i = 0; i < currentNode.choices.length; i++) {
      const choiceY = choicesStartY + i * (this.choiceHeight + this.choiceSpacing);
      if (mouseX >= this.x + this.padding && mouseX <= this.x + this.padding + choiceWidth &&
          mouseY >= choiceY && mouseY <= choiceY + this.choiceHeight) {
        newHoveredIndex = i;
        break;
      }
    }
    if (newHoveredIndex !== this.hoveredChoiceIndex && newHoveredIndex !== -1) {
      this.playChoiceHoverSound();
    }
    this.hoveredChoiceIndex = newHoveredIndex;
  }

  handleMouseClick(mouseX, mouseY) {
    if (!this.visible || !this.canInteract) return false;
    if (!this.containsPoint(mouseX, mouseY)) return false;
    const currentNode = this.dialogueSystem.getCurrentNode();
    if (!currentNode) return false;
    if (this.dialogueSystem.isTyping()) {
      this.dialogueSystem.skipTypewriter();
      return true;
    }
    if (currentNode.choices && currentNode.choices.length > 0) {
      const metrics = this._layoutMetrics(currentNode);
      const choicesStartY = this.y + this.padding + 40 + metrics.portraitAreaHeight + this.textPadding;
      const choiceWidth = this.width - this.padding * 2;
      for (let i = 0; i < currentNode.choices.length; i++) {
        const choiceY = choicesStartY + i * (this.choiceHeight + this.choiceSpacing);
        if (mouseX >= this.x + this.padding && mouseX <= this.x + this.padding + choiceWidth &&
            mouseY >= choiceY && mouseY <= choiceY + this.choiceHeight) {
          this.selectChoice(i);
          return true;
        }
      }
      return false;
    }
    this.continueDialogue();
    return true;
  }

  selectChoice(choiceIndex) {
    const currentNode = this.dialogueSystem.getCurrentNode();
    if (!currentNode || !currentNode.choices || choiceIndex >= currentNode.choices.length) return;
    this.playChoiceSelectSound();
    const selected = currentNode.choices[choiceIndex];
    const pending = this.dialogueSystem.selectChoice(choiceIndex);
    const finalize = result => {
      if (result === false) return false;
      if (this.onChoiceSelect) this.onChoiceSelect(choiceIndex, selected);
      if (!this.dialogueSystem.isDialogueActive()) this.handleDialogueEnd();
      return true;
    };
    return pending && typeof pending.then === 'function'
      ? pending.then(finalize)
      : finalize(pending);
  }

  continueDialogue() {
    this.dialogueSystem.continue();
    if (this.onContinue) this.onContinue();
    if (!this.dialogueSystem.isDialogueActive()) {
      this.handleDialogueEnd();
    }
  }

  handleDialogueEnd() {
    this.hide();
    if (this.onDialogueEnd) this.onDialogueEnd();
  }

  playTypewriterSound() {
    if (this.audioManager && this.audioManager.hasSound(this.typewriterSoundKey)) {
      this.audioManager.playSound(this.typewriterSoundKey, { volume: 0.3 });
    }
  }

  playChoiceHoverSound() {
    if (this.audioManager && this.audioManager.hasSound(this.choiceHoverSoundKey)) {
      this.audioManager.playSound(this.choiceHoverSoundKey, { volume: 0.5 });
    }
  }

  playChoiceSelectSound() {
    if (this.audioManager && this.audioManager.hasSound(this.choiceSelectSoundKey)) {
      this.audioManager.playSound(this.choiceSelectSoundKey, { volume: 0.7 });
    }
  }

  show() {
    super.show();
    this.canInteract = true;
    this.hoveredChoiceIndex = -1;
    this.lastTypewriterSoundIndex = 0;
  }

  hide() {
    super.hide();
    this.canInteract = false;
    this.hoveredChoiceIndex = -1;
  }

  setDialogueSystem(dialogueSystem) {
    this.dialogueSystem = dialogueSystem;
  }

  setAudioManager(audioManager) {
    this.audioManager = audioManager;
  }

  setTypewriterSoundKey(soundKey) {
    this.typewriterSoundKey = soundKey;
  }

  setChoiceHoverSoundKey(soundKey) {
    this.choiceHoverSoundKey = soundKey;
  }

  setChoiceSelectSoundKey(soundKey) {
    this.choiceSelectSoundKey = soundKey;
  }
}

export default DialogueBox;

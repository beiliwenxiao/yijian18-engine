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
    this.onDialogueEnd = options.onDialogueEnd || null;
    this.onContinue = options.onContinue || null;
    // 独立选项弹窗（DialogueChoiceBox），由 setChoiceBox 挂接
    this.choiceBox = null;

    this.padding = 20;
    this.portraitSize = 100;
    this.portraitPadding = 15;
    this.textPadding = 15;
    this.minHeight = 230;
    this.baseHeight = 230;
    this.baseY = options.y || 0;

    this.canInteract = true;

    this.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    this.borderColor = '#8B7355';
    this.textColor = '#FFFFFF';
    this.speakerColor = '#FFD700';

    this.speakerFont = 'bold 20px Arial, sans-serif';
    this.textFont = '18px Arial, sans-serif';

    this.typewriterSoundKey = 'dialogue_type';
    this.typewriterSoundInterval = 3;
    this.lastTypewriterSoundIndex = 0;
    
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
    // 面板编辑器保存的四种对话框内部布局（PanelLayout dialogue-* 面板，同键结构）
    this.dialoguePanelDefs = null;
    // presentation 图片懒加载缓存（src 路径 → HTMLImageElement）
    this._dynamicImages = {};

    console.log('DialogueBox: 初始化完成');
  }

  /** 应用 UI 编辑器保存的四种对话框布局矩形（未配置的类型回退构造尺寸）。 */
  setLayoutRects(rects) {
    this.layoutRects = rects && typeof rects === 'object' ? rects : null;
    return this;
  }

  /**
   * 应用面板编辑器保存的四种对话框内部布局（PanelLayout dialogue-* 面板定义）。
   * 形态无对应面板时该形态回退内置布局；part 坐标按外框实际尺寸相对面板基准缩放。
   */
  applyDialoguePanelLayouts(panelDefs) {
    this.dialoguePanelDefs = panelDefs && typeof panelDefs === 'object' ? panelDefs : null;
    return this;
  }

  /** 当前形态的面板定义（PanelLayout dialogue-*；未配置返回 null）。 @private */
  _currentPanelDef() {
    const boxType = this._currentPresentation().boxType;
    return this.dialoguePanelDefs?.[boxType] || null;
  }

  /** 面板 part 矩形换算到当前外框屏幕坐标；part 缺失或尺寸非法返回 null。 @private */
  _panelPartRect(panelDef, partId) {
    const part = panelDef?.parts?.find(candidate => candidate?.id === partId);
    const width = Number(part?.width);
    const height = Number(part?.height);
    if (!part || !(width > 0) || !(height > 0)) return null;
    const baseWidth = Number(panelDef.width) || this.width;
    const baseHeight = Number(panelDef.height) || this.height;
    return {
      x: this.x + (Number(part.x) || 0) * (this.width / baseWidth),
      y: this.y + (Number(part.y) || 0) * (this.height / baseHeight),
      width: width * (this.width / baseWidth),
      height: height * (this.height / baseHeight),
      fontSize: Number(part.fontSize) || null,
      color: typeof part.color === 'string' && part.color ? part.color : null,
      align: part.align || null
    };
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
   * narration 无立绘区；portrait 保持方形头像；halfBody 左侧立绘区随框高自适应。
   * 选项在独立弹窗（DialogueChoiceBox）中，不再占用文本框高度。
   * @private
   */
  _layoutMetrics() {
    const { boxType, presentation } = this._currentPresentation();
    const contentHeight = Math.max(0, this.height - this.padding * 2 - 40);
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
    const panelDef = this._currentPanelDef();
    // 面板布局：portrait 形态用 portrait part，halfBody 用 artwork part
    if (panelDef && metrics.boxType === 'portrait') {
      const rect = this._panelPartRect(panelDef, 'portrait');
      if (rect) return rect;
    }
    if (panelDef && metrics.boxType === 'halfBody') {
      const rect = this._panelPartRect(panelDef, 'artwork');
      if (rect) return rect;
    }
    const width = metrics.boxType === 'halfBody' ? metrics.halfBodyWidth : this.portraitSize;
    const height = metrics.boxType === 'halfBody' ? metrics.portraitAreaHeight : this.portraitSize;
    return { x: this.x + this.padding, y: this.y + this.padding + 40, width, height };
  }

  /** 内容需要的最小高度（标题行 + 最小立绘区）；选项在独立弹窗中不计入。 @private */
  _requiredHeight(_currentNode, metrics) {
    const minPortraitArea = metrics.boxType === 'halfBody' ? 120 : (metrics.portraitAreaHeight || 70);
    return this.padding + 30 + minPortraitArea + this.padding;
  }

  /**
   * 按当前演出类型应用几何：有编辑器矩形时以矩形为锚向下增长，
   * 否则保持现有居中行为。返回布局度量供本轮渲染复用。
   * @private
   */
  _applyLayoutGeometry(currentNode, canvasHeight) {
    const metrics = this._layoutMetrics();
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

    // 选项弹窗与文本框拆分：跟随同一对话状态独立显隐
    this.choiceBox?.update?.(deltaTime);
  }

  /** 挂接独立选项弹窗；文本框只负责文本，选项显隐/命中/渲染由 choiceBox 承担。 */
  setChoiceBox(choiceBox) {
    this.choiceBox = choiceBox || null;
    return this;
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
    if (this.showContinuePrompt) this.renderContinuePrompt(ctx);
    ctx.restore();

    // 独立选项弹窗（位置大小由 UI 编辑器 dialogue-choices 配置）
    this.choiceBox?.render?.(ctx);
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

  /** 全身立绘：面板布局用 fullBodyArt part 区域，否则画在文本框右侧、底对齐。 @private */
  renderFullBodyArt(ctx, metrics) {
    const src = String(metrics.presentation?.fullBodyImage || '').trim();
    if (!src) return;
    const img = this._getImage(src);
    if (!img || !img.complete || img.naturalWidth <= 0) return;
    const panelRect = this._panelPartRect(this._currentPanelDef(), 'fullBodyArt');
    if (panelRect) {
      this._drawImageContain(ctx, img, panelRect, true);
      return;
    }
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
    const panelRect = this._panelPartRect(this._currentPanelDef(), 'speaker');
    ctx.fillStyle = panelRect?.color || metrics.speakerColor;
    ctx.font = panelRect?.fontSize
      ? `bold ${Math.round(panelRect.fontSize)}px Arial, sans-serif`
      : this.speakerFont;
    ctx.textAlign = panelRect?.align === 'center' ? 'center' : panelRect?.align === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'top';
    if (panelRect) {
      const anchorX = panelRect.align === 'center' ? panelRect.x + panelRect.width / 2
        : panelRect.align === 'right' ? panelRect.x + panelRect.width
        : panelRect.x;
      ctx.fillText(speaker, anchorX, panelRect.y);
      return;
    }
    ctx.fillText(speaker, this.x + this.padding, this.y + this.padding);
  }

  renderText(ctx, text, metrics = this._layoutMetrics()) {
    if (!text) return;
    const panelRect = this._panelPartRect(this._currentPanelDef(), 'text');
    let textX;
    let textY;
    let textWidth;
    let textHeight;
    if (panelRect) {
      textX = panelRect.x;
      textY = panelRect.y;
      textWidth = panelRect.width;
      textHeight = panelRect.height;
    } else {
      const region = this._portraitRegion(metrics);
      textX = region.x + region.width + (metrics.portraitAreaHeight > 0 ? this.portraitPadding : 0);
      textY = this.y + this.padding + 40;
      textWidth = Math.max(60, this.x + this.width - this.padding - textX);
      textHeight = Math.max(60, metrics.portraitAreaHeight);
    }
    ctx.fillStyle = panelRect?.color || this.textColor;
    ctx.font = panelRect?.fontSize
      ? `${Math.round(panelRect.fontSize)}px Arial, sans-serif`
      : this.textFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lines = this.wrapText(ctx, text, textWidth);
    const lineHeight = panelRect?.fontSize ? Math.round(panelRect.fontSize * 1.35) : 24;
    lines.forEach((line, index) => {
      if (index * lineHeight < textHeight) {
        ctx.fillText(line, textX, textY + index * lineHeight);
      }
    });
  }

  renderContinuePrompt(ctx) {
    // 按当前输入方案显示匹配的操作提示
    const promptText = `▼ ${InputHints.phrase('dialogueContinue')} ▼`;
    const panelRect = this._panelPartRect(this._currentPanelDef(), 'continue');
    ctx.save();
    ctx.globalAlpha = this.continuePromptAlpha;
    ctx.fillStyle = panelRect?.color || this.speakerColor;
    ctx.font = panelRect?.fontSize
      ? `${Math.round(panelRect.fontSize)}px Arial, sans-serif`
      : '14px Arial, sans-serif';
    if (panelRect) {
      ctx.textAlign = panelRect.align === 'left' ? 'left' : panelRect.align === 'center' ? 'center' : 'right';
      ctx.textBaseline = 'bottom';
      const anchorX = panelRect.align === 'left' ? panelRect.x
        : panelRect.align === 'center' ? panelRect.x + panelRect.width / 2
        : panelRect.x + panelRect.width;
      ctx.fillText(promptText, anchorX, panelRect.y + panelRect.height);
      ctx.restore();
      return;
    }
    const promptX = this.x + this.width - this.padding - 10;
    const promptY = this.y + this.height - this.padding - 10;
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

  /** 兼容旧调用（index.html 等遗留路径）；悬停命中已由独立选项弹窗承担。 */
  handleMouseMove(mouseX, mouseY) {
    this.choiceBox?.handleMouseMove?.(mouseX, mouseY);
  }

  /**
   * 文本框点击：跳过打字机 / 推进对话。
   * 选项命中由独立选项弹窗（choiceBox）承担；点击文本框在有选项时只消费不推进
   * （DialogueSystem.continue 对选项节点返回 false）。
   */
  handleMouseClick(mouseX, mouseY) {
    if (!this.visible || !this.canInteract) return false;
    if (!this.containsPoint(mouseX, mouseY)) return false;
    const currentNode = this.dialogueSystem.getCurrentNode();
    if (!currentNode) return false;
    if (this.dialogueSystem.isTyping()) {
      this.dialogueSystem.skipTypewriter();
      return true;
    }
    this.continueDialogue();
    return true;
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
    this.choiceBox?.hide?.();
    if (this.onDialogueEnd) this.onDialogueEnd();
  }

  playTypewriterSound() {
    if (this.audioManager && this.audioManager.hasSound(this.typewriterSoundKey)) {
      this.audioManager.playSound(this.typewriterSoundKey, { volume: 0.3 });
    }
  }

  show() {
    super.show();
    this.canInteract = true;
    this.lastTypewriterSoundIndex = 0;
    this.choiceBox?.show?.();
  }

  hide() {
    super.hide();
    this.canInteract = false;
    this.choiceBox?.hide?.();
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
}

export default DialogueBox;

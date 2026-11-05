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

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';
import { HudIconPainter } from './HudIconPainter.js';

/**
 * IconButton - 通用图标按钮（Canvas 渲染，可点击）
 *
 * 用于 PC 端等需要在画布上放置可点击功能按钮的场景（如属性、背包按钮）。
 * 支持 UI 编辑器布局：位置/大小由 x/y/width/height 决定，可被 UILayout 覆盖。
 */
export class IconButton extends UIElement {
  /**
   * @param {Object} options
   * @param {string} [options.icon] - 图标（emoji 或短文本）
   * @param {string} [options.label] - 底部标签文字
   * @param {Function} [options.onClick] - 点击回调
   * @param {string} [options.bgColor] - 背景色
   * @param {string} [options.borderColor] - 边框色
   */
  constructor(options = {}) {
    super({
      x: options.x || 0,
      y: options.y || 0,
      width: options.width || 50,
      height: options.height || 50,
      visible: options.visible !== false,
      zIndex: options.zIndex || 210
    });
    this.icon = options.icon || '';
    this.label = options.label || '';
    this.hotkey = options.hotkey || '';   // 静态快捷键提示（兜底，优先用 hintAction）
    this.hintAction = options.hintAction || ''; // InputHints 动作名：每帧取当前方案的按键名
    this.onClick = options.onClick || null;
    this.bgColor = options.bgColor || 'rgba(40, 40, 40, 0.85)';
    this.borderColor = options.borderColor || '#888';
    this.hovered = false;
    this.onboardingEnabled = true;
    this.onboardingHighlighted = false;
    this.onboardingHintAction = null;
    // 教学高亮一次性熄灭：由 ScenePanelLayout 注入，高亮按钮首次被点击时回调
    this.onboardingComponentId = null;
    this.onOnboardingComponentActivated = null;
    // 冷却显示（毫秒）
    this.cdRemaining = 0;
    this.cdTotal = 0;
  }

  /**
   * 设置冷却（用于在按钮上显示遮罩+倒计时）
   * @param {number} remainingMs - 剩余冷却（毫秒）
   * @param {number} totalMs - 总冷却（毫秒）
   */
  setCooldown(remainingMs, totalMs) {
    this.cdRemaining = Math.max(0, remainingMs || 0);
    this.cdTotal = totalMs || 0;
  }

  /**
   * 渲染按钮
   * 静态外观（底/框/矢量图标/标签/快捷键）走签名离屏缓存——多按钮常驻时
   * HudIconPainter 矢量重绘 + 多次 fillText 是稳定每帧开销；位置无关，贴图时应用坐标。
   * 冷却扇形/倒计时逐帧变化，不进缓存、直接画主画布。
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible) return;
    const { x, y, width: w, height: h } = this;
    const hotkeyText = this.onboardingHintAction || this.hintAction
      ? InputHints.key(this.onboardingHintAction || this.hintAction)
      : this.hotkey;

    const signature = [this.icon, this.label, hotkeyText, w, h,
      this.hovered, this.onboardingHighlighted, this.onboardingHintAction,
      this.bgColor, this.borderColor].join('|');
    const cache = this._getRenderCache(ctx, signature, w, h);
    if (cache) {
      ctx.drawImage(cache.canvas, x, y, w, h);
    } else {
      // 无 DOM 环境（Node 测试）回退：直接画主画布
      this._renderStaticChrome(ctx, w, h);
    }

    // 冷却：扇形遮罩 + 倒计时文字（与技能栏 SkillBar 一致的样式）
    if (this.cdRemaining > 0 && this.cdTotal > 0) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const pct = Math.min(1, this.cdRemaining / this.cdTotal);
      const radius = Math.max(w, h); // 足够大以覆盖整个方块
      ctx.save();
      // 裁剪到按钮矩形内，避免扇形溢出
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 倒计时秒数（带阴影）
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.floor(h * 0.36)}px Arial`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 3;
      ctx.fillText(Math.ceil(this.cdRemaining / 1000).toString(), cx, cy);
      ctx.shadowBlur = 0;
    }
  }

  /**
   * 取（懒建）静态外观离屏缓存；无 DOM 环境返回 null。
   * 背板按主画布 dpr 缩放保持清晰；签名涵盖 hovered/教学高亮/图标/标签/快捷键/配色。
   * @private
   */
  _getRenderCache(ctx, signature, w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const mainTransform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    const dpr = Math.max(1, Math.min(4, mainTransform ? (mainTransform.a || 1) : 1));
    const cacheW = Math.max(1, Math.ceil(w * dpr));
    const cacheH = Math.max(1, Math.ceil(h * dpr));
    if (!this._cacheCanvas || this._cacheW !== cacheW || this._cacheH !== cacheH
      || this._cacheDpr !== dpr || this._cacheSignature !== signature) {
      this._cacheCanvas = this._cacheCanvas || document.createElement('canvas');
      this._cacheCanvas.width = cacheW;
      this._cacheCanvas.height = cacheH;
      this._cacheW = cacheW;
      this._cacheH = cacheH;
      this._cacheDpr = dpr;
      this._cacheSignature = signature;
      const off = this._cacheCanvas.getContext('2d');
      off.setTransform(1, 0, 0, 1, 0, 0);
      off.clearRect(0, 0, cacheW, cacheH);
      off.scale(dpr, dpr);
      this._renderStaticChrome(off, w, h);
    }
    return { canvas: this._cacheCanvas };
  }

  /** 静态外观绘制（本地坐标 0,0..w,h；目标为主画布回退或离屏缓存）。 @private */
  _renderStaticChrome(off, w, h) {
    const x = 0;
    const y = 0;
    const hotkeyText = this.onboardingHintAction || this.hintAction
      ? InputHints.key(this.onboardingHintAction || this.hintAction)
      : this.hotkey;
    off.save();
    // 背景
    off.fillStyle = this.hovered ? 'rgba(90, 90, 90, 0.9)' : this.bgColor;
    off.fillRect(x, y, w, h);
    // 边框（教学高亮的 shadowBlur 只在重绘时付费）
    off.strokeStyle = this.onboardingHighlighted ? '#ffd479' : (this.hovered ? '#ffffff' : this.borderColor);
    off.lineWidth = this.onboardingHighlighted ? 3 : 2;
    if (this.onboardingHighlighted) {
      off.shadowColor = 'rgba(255, 212, 121, 0.9)';
      off.shadowBlur = 10;
    }
    off.strokeRect(x, y, w, h);
    off.shadowBlur = 0;

    const cx = x + w / 2;
    const cy = y + h / 2;

    // 图标：矢量图标名（HudIconPainter）优先，未知名回退 emoji/短文本
    if (this.icon) {
      const iconCy = cy - (this.label ? h * 0.12 : 0);
      const iconSize = Math.floor(h * 0.62);
      const painted = HudIconPainter.draw(
        off, this.icon, cx, iconCy, iconSize,
        { brighten: this.hovered ? 0.35 : 0 }
      );
      if (!painted) {
        off.fillStyle = '#ffffff';
        off.textAlign = 'center';
        off.textBaseline = 'middle';
        off.font = `${Math.floor(h * 0.42)}px Arial`;
        off.fillText(this.icon, cx, iconCy);
      }
    }
    // 标签
    if (this.label) {
      off.fillStyle = '#dddddd';
      off.textAlign = 'center';
      off.textBaseline = 'middle';
      off.font = `${Math.floor(h * 0.22)}px Arial`;
      off.fillText(this.label, cx, cy + h * 0.3);
    }
    // 快捷键（右上角）
    if (hotkeyText) {
      off.fillStyle = '#ffd479';
      off.textAlign = 'right';
      off.textBaseline = 'top';
      off.font = `bold ${Math.floor(h * 0.26)}px Arial`;
      off.fillText(hotkeyText, x + w - 3, y + 2);
    }
    off.restore();
  }

  /**
   * 更新鼠标悬停状态
   * @param {number} x
   * @param {number} y
   */
  handleMouseMove(x, y) {
    if (!this.visible) { this.hovered = false; return; }
    this.hovered = this.containsPoint(x, y);
  }

  /**
   * 处理点击
   * @param {number} x
   * @param {number} y
   * @param {string} button
   * @returns {boolean} 是否处理了点击
   */
  handleMouseClick(x, y, button = 'left') {
    if (!this.visible || this.onboardingEnabled === false || button !== 'left' || !this.containsPoint(x, y)) return false;
    // 教学高亮一次性熄灭：高亮按钮首次被点击即回调熄灭
    if (this.onboardingHighlighted && this.onboardingComponentId) {
      this.onOnboardingComponentActivated?.(this.onboardingComponentId);
    }
    if (this.onClick) this.onClick();
    return true;
  }
}

export default IconButton;

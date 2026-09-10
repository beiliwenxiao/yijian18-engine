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
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible) return;
    const { x, y, width: w, height: h } = this;

    ctx.save();
    // 背景
    ctx.fillStyle = this.hovered ? 'rgba(90, 90, 90, 0.9)' : this.bgColor;
    ctx.fillRect(x, y, w, h);
    // 边框
    ctx.strokeStyle = this.onboardingHighlighted ? '#ffd479' : (this.hovered ? '#ffffff' : this.borderColor);
    ctx.lineWidth = this.onboardingHighlighted ? 3 : 2;
    if (this.onboardingHighlighted) {
      ctx.shadowColor = 'rgba(255, 212, 121, 0.9)';
      ctx.shadowBlur = 10;
    }
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    const cx = x + w / 2;
    const cy = y + h / 2;

    // 图标
    if (this.icon) {
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.floor(h * 0.42)}px Arial`;
      ctx.fillText(this.icon, cx, cy - (this.label ? h * 0.12 : 0));
    }
    // 标签
    if (this.label) {
      ctx.fillStyle = '#dddddd';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.floor(h * 0.22)}px Arial`;
      ctx.fillText(this.label, cx, cy + h * 0.3);
    }
    // 快捷键（右上角）—— 手柄插上时自动显示手柄按钮名
    const hotkeyText = this.onboardingHintAction || this.hintAction
      ? InputHints.key(this.onboardingHintAction || this.hintAction)
      : this.hotkey;
    if (hotkeyText) {
      ctx.fillStyle = '#ffd479';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.font = `bold ${Math.floor(h * 0.26)}px Arial`;
      ctx.fillText(hotkeyText, x + w - 3, y + 2);
    }
    // 冷却：扇形遮罩 + 倒计时文字（与技能栏 SkillBar 一致的样式）
    if (this.cdRemaining > 0 && this.cdTotal > 0) {
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
    ctx.restore();
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
    if (this.onClick) this.onClick();
    return true;
  }
}

export default IconButton;

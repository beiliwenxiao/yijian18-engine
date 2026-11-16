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

import { UIElement } from './UIElement.js';
import { HudCanvasCache } from './HudCanvasCache.js';

/**
 * 魔法值条组件
 * 显示角色的魔法值，支持平滑过渡动画
 */
export class ManaBar extends UIElement {
  /**
   * @param {Object} options - 配置选项
   * @param {number} options.currentValue - 当前魔法值
   * @param {number} options.maxValue - 最大魔法值
   * @param {string} [options.barColor='#0088ff'] - 魔法值条颜色
   * @param {string} [options.backgroundColor='#333333'] - 背景颜色
   * @param {string} [options.borderColor='#ffffff'] - 边框颜色
   * @param {boolean} [options.showText=true] - 是否显示文字
   * @param {boolean} [options.showPercentage=true] - 是否显示百分比
   * @param {number} [options.animationSpeed=0.1] - 动画速度（0-1）
   */
  constructor(options = {}) {
    super(options);
    
    this.currentValue = options.currentValue || 100;
    this.maxValue = options.maxValue || 100;
    this.displayValue = this.currentValue; // 用于平滑动画的显示值
    
    this.barColor = options.barColor || '#0088ff';
    this.backgroundColor = options.backgroundColor || '#333333';
    this.borderColor = options.borderColor || '#ffffff';
    
    this.showText = options.showText !== undefined ? options.showText : true;
    this.showPercentage = options.showPercentage !== undefined ? options.showPercentage : true;
    this.animationSpeed = options.animationSpeed || 0.1;
    
    // 边框和内边距
    this.borderWidth = 2;
    this.padding = 2;
    // 条内容静态缓存：显示值/尺寸/配色不变时每帧只 blit（平滑动画期间等于逐帧重建，不劣化）
    this._cache = new HudCanvasCache();
  }

  /**
   * 设置当前值
   * @param {number} value - 新的魔法值
   */
  setValue(value) {
    this.currentValue = Math.max(0, Math.min(value, this.maxValue));
  }

  /**
   * 设置最大值
   * @param {number} value - 新的最大魔法值
   */
  setMaxValue(value) {
    this.maxValue = Math.max(1, value);
    this.currentValue = Math.min(this.currentValue, this.maxValue);
  }

  /**
   * 消耗魔法值
   * @param {number} amount - 消耗量
   * @returns {boolean} 是否成功消耗
   */
  consume(amount) {
    if (this.currentValue >= amount) {
      this.currentValue -= amount;
      return true;
    }
    return false;
  }

  /**
   * 恢复魔法值
   * @param {number} amount - 恢复量
   */
  restore(amount) {
    this.currentValue = Math.min(this.currentValue + amount, this.maxValue);
  }

  /**
   * 更新魔法值条（平滑过渡动画）
   * @param {number} deltaTime - 帧间隔时间（毫秒）
   */
  update(deltaTime) {
    // 平滑过渡到目标值
    const diff = this.currentValue - this.displayValue;
    if (Math.abs(diff) > 0.1) {
      this.displayValue += diff * this.animationSpeed;
    } else {
      this.displayValue = this.currentValue;
    }
  }

  /**
   * 渲染魔法值条（离屏缓存：内容键不变时每帧只 blit 一次）
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   */
  render(ctx) {
    if (!this.visible) return;

    const key = `mp|${this.displayValue}|${this.maxValue}|${Math.round(this.width)}x${Math.round(this.height)}` +
      `|${this.showText ? 1 : 0}${this.showPercentage ? 1 : 0}|${this.barColor}|${this.backgroundColor}|${this.borderColor}`;
    const cached = this._cache.get(key, this.width, this.height, c => this._drawInto(c, 0, 0));
    if (cached) {
      ctx.drawImage(cached, this.x, this.y, this.width, this.height);
      return;
    }
    this._drawInto(ctx, this.x, this.y);
  }

  /**
   * 绘制条内容（origin 模式：ox/oy 为盒子左上角，离屏缓存与直接绘制共用同一实现）
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {number} ox - 盒子左上角 x
   * @param {number} oy - 盒子左上角 y
   */
  _drawInto(ctx, ox, oy) {
    const percentage = this.displayValue / this.maxValue;
    const innerWidth = this.width - (this.borderWidth + this.padding) * 2;
    const innerHeight = this.height - (this.borderWidth + this.padding) * 2;
    const innerX = ox + this.borderWidth + this.padding;
    const innerY = oy + this.borderWidth + this.padding;

    // 绘制边框
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.strokeRect(ox, oy, this.width, this.height);

    // 绘制背景
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(innerX, innerY, innerWidth, innerHeight);

    // 绘制魔法值条
    const barWidth = innerWidth * percentage;
    ctx.fillStyle = this.barColor;
    ctx.fillRect(innerX, innerY, barWidth, innerHeight);

    // 绘制文字
    if (this.showText) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let text = '';
      if (this.showPercentage) {
        text = `${Math.round(percentage * 100)}%`;
      } else {
        text = `${Math.round(this.displayValue)}/${this.maxValue}`;
      }

      // 添加文字阴影以提高可读性
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 3;
      ctx.fillText(text, ox + this.width / 2, oy + this.height / 2);
      ctx.shadowBlur = 0;
    }
  }

  /**
   * 获取当前百分比
   * @returns {number} 百分比（0-1）
   */
  getPercentage() {
    return this.currentValue / this.maxValue;
  }

  /**
   * 检查是否有足够的魔法值
   * @param {number} amount - 需要的魔法值
   * @returns {boolean}
   */
  hasEnough(amount) {
    return this.currentValue >= amount;
  }
}

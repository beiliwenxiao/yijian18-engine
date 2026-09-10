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
import { HealthBar } from './HealthBar.js';
import { ManaBar } from './ManaBar.js';

/**
 * PlayerStatusHUD - 玩家状态 HUD（左上角）
 *
 * 显示玩家头像、昵称、血条、蓝条。
 * 复用框架已有的 HealthBar / ManaBar 组件。
 * 适用于移动端，替代屏幕下方的血球/蓝球。
 */
export class PlayerStatusHUD extends UIElement {
  /**
   * @param {Object} options
   * @param {number} [options.x=10]
   * @param {number} [options.y=10]
   * @param {number} [options.width=230]
   * @param {number} [options.height=78]
   * @param {string} [options.avatarSrc] - 头像图片地址（相对/绝对 URL）
   * @param {Entity} [options.player] - 玩家实体
   */
  constructor(options = {}) {
    super({
      x: options.x !== undefined ? options.x : 10,
      y: options.y !== undefined ? options.y : 10,
      width: options.width || 230,
      height: options.height || 78,
      visible: options.visible !== false,
      zIndex: options.zIndex || 210
    });

    this.player = options.player || null;
    this.padding = 8;
    this.avatarSize = 56;
    this._hasSubLayout = false;
    this._avatarRect = null;
    this._nameRect = null;
    this._onboardingBaseVisible = this.visible;
    this._onboardingComponentVisibility = {
      'hud-avatar': true,
      'hud-name': true,
      'hud-hp': true,
      'hud-mp': true
    };

    // 头像图片（自加载，加载完成前画占位圆）
    this.avatarImage = null;
    this.avatarLoaded = false;
    if (options.avatarSrc) {
      this.setAvatar(options.avatarSrc);
    }

    // 血条/蓝条尺寸
    const barX = this.x + this.padding + this.avatarSize + 8;
    const barWidth = this.width - this.padding * 2 - this.avatarSize - 8;
    const barHeight = 14;

    this.healthBar = new HealthBar({
      x: barX,
      y: this.y + 30,
      width: barWidth,
      height: barHeight,
      currentValue: 100,
      maxValue: 100,
      showText: true,
      showPercentage: false,
      borderColor: '#000000',
      backgroundColor: '#3a0000'
    });

    this.manaBar = new ManaBar({
      x: barX,
      y: this.y + 30 + barHeight + 6,
      width: barWidth,
      height: barHeight,
      currentValue: 100,
      maxValue: 100,
      showText: true,
      showPercentage: false,
      barColor: '#2288ff',
      borderColor: '#000000',
      backgroundColor: '#00163a'
    });
  }

  /**
   * 设置头像图片
   * @param {string} src
   */
  setAvatar(src) {
    this.avatarLoaded = false;
    const img = new Image();
    img.onload = () => {
      this.avatarImage = img;
      this.avatarLoaded = true;
    };
    img.onerror = () => {
      this.avatarImage = null;
      this.avatarLoaded = false;
    };
    img.src = src;
  }

  /**
   * 设置玩家实体
   * @param {Entity} entity
   */
  setPlayer(entity) {
    this.player = entity;
  }

  /**
   * 应用渐进 UI 投影的 HUD 子组件可见性。
   * 组件状态只影响 Canvas 表现；玩家数值仍由 ECS 状态更新。
   */
  setOnboardingComponentState(componentId, state = {}) {
    if (!Object.prototype.hasOwnProperty.call(this._onboardingComponentVisibility, componentId)) {
      return false;
    }
    this._onboardingComponentVisibility[componentId] = state.visible !== false;
    this.visible = this._onboardingBaseVisible
      && Object.values(this._onboardingComponentVisibility).some(Boolean);
    return true;
  }

  /**
   * 重新计算子元素位置（窗口尺寸变化时调用）
   */
  layout() {
    if (this._hasSubLayout) return; // 使用独立子布局时跳过默认计算
    const barX = this.x + this.padding + this.avatarSize + 8;
    const barWidth = this.width - this.padding * 2 - this.avatarSize - 8;
    this.healthBar.x = barX;
    this.healthBar.y = this.y + 30;
    this.healthBar.width = barWidth;
    this.manaBar.x = barX;
    this.manaBar.y = this.y + 30 + this.healthBar.height + 6;
    this.manaBar.width = barWidth;
  }

  /**
   * 应用 UI 编辑器的子组件独立布局
   * @param {Object} rects - { avatarRect, nameRect, hpRect, mpRect }
   *   每项格式: { x, y, width, height } | null
   */
  applySubLayout(rects) {
    this._hasSubLayout = true;
    if (rects.avatarRect) {
      this._avatarRect = rects.avatarRect;
      this.avatarSize = Math.min(rects.avatarRect.width, rects.avatarRect.height);
    }
    if (rects.nameRect) {
      this._nameRect = rects.nameRect;
    }
    if (rects.hpRect) {
      this.healthBar.x = rects.hpRect.x;
      this.healthBar.y = rects.hpRect.y;
      this.healthBar.width = rects.hpRect.width;
      this.healthBar.height = rects.hpRect.height;
    }
    if (rects.mpRect) {
      this.manaBar.x = rects.mpRect.x;
      this.manaBar.y = rects.mpRect.y;
      this.manaBar.width = rects.mpRect.width;
      this.manaBar.height = rects.mpRect.height;
    }
    // 更新整体包围盒（用于可见性判断等）
    const allRects = [rects.avatarRect, rects.nameRect, rects.hpRect, rects.mpRect].filter(Boolean);
    if (allRects.length) {
      const minX = Math.min(...allRects.map(r => r.x));
      const minY = Math.min(...allRects.map(r => r.y));
      const maxX = Math.max(...allRects.map(r => r.x + r.width));
      const maxY = Math.max(...allRects.map(r => r.y + r.height));
      this.x = minX;
      this.y = minY;
      this.width = maxX - minX;
      this.height = maxY - minY;
    }
  }

  /**
   * 更新（同步玩家数值 + 平滑动画）
   * @param {number} deltaTime
   */
  update(deltaTime) {
    if (!this.visible || !this.player) return;
    const stats = this.player.getComponent('stats');
    if (stats) {
      this.healthBar.setMaxValue(stats.maxHp);
      this.healthBar.setValue(stats.hp);
      this.manaBar.setMaxValue(stats.maxMp);
      this.manaBar.setValue(stats.mp);
    }
    this.healthBar.update(deltaTime);
    this.manaBar.update(deltaTime);
  }

  /**
   * 渲染
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible || !this.player) return;

    ctx.save();

    if (this._hasSubLayout) {
      // 独立子布局模式：不画背景面板，各子元素自由定位
      if (this._onboardingComponentVisibility['hud-avatar']) this._renderAvatar(ctx);
      if (this._onboardingComponentVisibility['hud-name']) this._renderName(ctx);
      if (this._onboardingComponentVisibility['hud-hp']) this.healthBar.render(ctx);
      if (this._onboardingComponentVisibility['hud-mp']) this.manaBar.render(ctx);
    } else {
      // 经典模式：整体面板
      // 背景面板（半透明圆角）
      this._roundRect(ctx, this.x, this.y, this.width, this.height, 8);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (this._onboardingComponentVisibility['hud-avatar']) this._renderAvatar(ctx);
      if (this._onboardingComponentVisibility['hud-name']) this._renderName(ctx);
      if (this._onboardingComponentVisibility['hud-hp']) this.healthBar.render(ctx);
      if (this._onboardingComponentVisibility['hud-mp']) this.manaBar.render(ctx);
    }

    ctx.restore();
  }

  /**
   * 渲染头像
   */
  _renderAvatar(ctx) {
    let ax, ay;
    if (this._hasSubLayout && this._avatarRect) {
      ax = this._avatarRect.x;
      ay = this._avatarRect.y;
    } else {
      ax = this.x + this.padding;
      ay = this.y + (this.height - this.avatarSize) / 2;
    }
    const r = this.avatarSize / 2;
    const cx = ax + r;
    const cy = ay + r;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (this.avatarLoaded && this.avatarImage) {
      ctx.drawImage(this.avatarImage, ax, ay, this.avatarSize, this.avatarSize);
    } else {
      ctx.fillStyle = '#444';
      ctx.fillRect(ax, ay, this.avatarSize, this.avatarSize);
    }
    ctx.restore();

    // 头像边框
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * 渲染昵称
   */
  _renderName(ctx) {
    const name = this.player.name || '玩家';
    let nx, ny;
    if (this._hasSubLayout && this._nameRect) {
      nx = this._nameRect.x;
      ny = this._nameRect.y + this._nameRect.height / 2;
    } else {
      nx = this.x + this.padding + this.avatarSize + 8;
      ny = this.y + 16;
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(name, nx, ny);
    ctx.shadowBlur = 0;
  }

  /**
   * 圆角矩形路径
   */
  _roundRect(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }
}

export default PlayerStatusHUD;

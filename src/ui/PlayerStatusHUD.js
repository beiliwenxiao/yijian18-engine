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
import { HudCanvasCache } from './HudCanvasCache.js';

/** 内置默认面板矩形：与 UI 布局缺省一致（230×78，头像 56 + 双条 14）。 */
const DEFAULT_PANEL_RECT = Object.freeze({ x: 10, y: 10, width: 230, height: 78 });

/**
 * PlayerStatusHUD - 玩家状态 HUD（独立面板）
 *
 * 内置效果：半透明圆角底板 + 圆形金边头像 + 昵称 + 血条/蓝条，
 * 内部布局由本组件按面板尺寸推导（一个条目控制位置大小，改观感只改本文件）。
 * UI 布局里的 `hud-panel` 条目提供面板矩形；缺省用内置位置。
 * 头像圆形裁剪 + 金边走离屏缓存，昵称/数值变化才重绘对应部分。
 */
export class PlayerStatusHUD extends UIElement {
  /**
   * @param {Object} options
   * @param {string} [options.avatarSrc] - 头像图片地址（相对/绝对 URL）
   * @param {Entity} [options.player] - 玩家实体
   */
  constructor(options = {}) {
    super({
      x: DEFAULT_PANEL_RECT.x,
      y: DEFAULT_PANEL_RECT.y,
      width: DEFAULT_PANEL_RECT.width,
      height: DEFAULT_PANEL_RECT.height,
      visible: options.visible !== false,
      zIndex: options.zIndex || 210
    });

    this.player = options.player || null;
    this.avatarSize = 56;
    // UI 布局的 hud-panel 矩形；null = 使用内置默认位置（与旧版整体 HUD 一致）
    this._panelRect = null;
    // 面板编辑器的观感定义（PanelLayout.hudPanel）；null = 全部沿用内置默认
    this._panelDefinition = null;
    // UI 编辑器布局里 hud-panel 条目被删除时置 true：整个 HUD 不显示（与编辑器所见一致）
    this.hiddenByLayout = false;
    // 渐进 UI（引导）显隐：键为面板级稳定 id
    this._onboardingBaseVisible = this.visible;
    this._onboardingPanelVisible = true;

    // 头像静态缓存：圆裁剪+图片+金边不逐帧重绘（图片/尺寸变化才重建）
    this._avatarCache = new HudCanvasCache();

    // 头像图片（自加载，加载完成前画占位圆）
    this.avatarImage = null;
    this.avatarLoaded = false;
    if (options.avatarSrc) {
      this.setAvatar(options.avatarSrc);
    }

    // 血条/蓝条（几何由 _applyPanelMetrics 按面板尺寸推导）
    this.healthBar = new HealthBar({
      currentValue: 100,
      maxValue: 100,
      showText: true,
      showPercentage: false,
      borderColor: '#000000',
      backgroundColor: '#3a0000'
    });
    this.manaBar = new ManaBar({
      currentValue: 100,
      maxValue: 100,
      showText: true,
      showPercentage: false,
      barColor: '#2288ff',
      borderColor: '#000000',
      backgroundColor: '#00163a'
    });
    this._applyPanelMetrics();
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
   * 应用面板编辑器的 HUD 定义（PanelLayout.hudPanel）。
   * 部件按 type 消费（hud-avatar/hud-name/hud-hp/hud-mp）：缺失的类型 = 游戏内隐藏该元素；
   * 无定义时全部走内置推导布局。血条填充色留空 = 按血量自动红黄绿。
   * @param {Object|null} def - { backgroundColor, borderColor, borderWidth, cornerRadius, parts[] }
   */
  applyPanelDefinition(def) {
    this._panelDefinition = def && typeof def === 'object' ? def : null;
    const parts = Array.isArray(this._panelDefinition?.parts) ? this._panelDefinition.parts : [];
    const partOf = type => parts.find(part => part.type === type) || null;
    const hpPart = partOf('hud-hp');
    this.healthBar.fixedBarColor = String(hpPart?.fillColor || '').trim() || null;
    this.healthBar.backgroundColor = hpPart?.backgroundColor || '#3a0000';
    this.healthBar.borderColor = hpPart?.borderColor || '#000000';
    const mpPart = partOf('hud-mp');
    this.manaBar.barColor = mpPart?.fillColor || '#2288ff';
    this.manaBar.backgroundColor = mpPart?.backgroundColor || '#00163a';
    this.manaBar.borderColor = mpPart?.borderColor || '#000000';
    // 条配色进缓存键，重配后立即按新颜色重建缓存
    this.healthBar._cache.reset();
    this.manaBar._cache.reset();
    this._applyPanelMetrics();
  }

  /**
   * 应用 UI 布局的 hud-panel 面板矩形（位置大小随编辑器，内部布局由组件推导）
   * @param {{x:number,y:number,width:number,height:number}|null} rect - null 恢复内置默认
   */
  setPanelRect(rect) {
    this._panelRect = rect && Number.isFinite(rect.x) && Number.isFinite(rect.width)
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null;
    this._applyPanelMetrics();
  }

  /**
   * 应用渐进 UI（引导）投影：隐藏/恢复整个 HUD 面板。
   * @param {string} componentId - 稳定 id（hud-panel）
   * @param {Object} state - { visible }
   */
  setOnboardingComponentState(componentId, state = {}) {
    if (componentId !== 'hud-panel') return false;
    this._onboardingPanelVisible = state.visible !== false;
    this.visible = this._onboardingBaseVisible && this._onboardingPanelVisible;
    return true;
  }

  /**
   * 按面板矩形推导内部布局：
   * 有面板定义（含 parts）→ 部件矩形从 PanelLayout 设计尺寸等比映射到实际面板，
   * 缺失的部件类型 = 该元素隐藏；无定义 → 内置推导（默认 230×78 与旧版整体 HUD 逐像素一致）。
   */
  _applyPanelMetrics() {
    const rect = this._panelRect || DEFAULT_PANEL_RECT;
    this.x = rect.x;
    this.y = rect.y;
    this.width = rect.width;
    this.height = rect.height;

    const def = this._panelDefinition;
    const parts = Array.isArray(def?.parts) ? def.parts : [];
    this._partStyle = { avatar: null, name: null };

    if (parts.length > 0 && Number(def.width) > 0 && Number(def.height) > 0) {
      // 部件模式：PanelLayout 设计坐标 → 实际面板矩形（等比映射，适配任意面板尺寸）
      const scaleX = rect.width / Number(def.width);
      const scaleY = rect.height / Number(def.height);
      const mapPart = type => {
        const part = parts.find(candidate => candidate.type === type);
        if (!part) return null;
        return {
          x: rect.x + (Number(part.x) || 0) * scaleX,
          y: rect.y + (Number(part.y) || 0) * scaleY,
          width: Math.max(0, (Number(part.width) || 0) * scaleX),
          height: Math.max(0, (Number(part.height) || 0) * scaleY),
          data: part
        };
      };
      const avatar = mapPart('hud-avatar');
      const name = mapPart('hud-name');
      const hp = mapPart('hud-hp');
      const mp = mapPart('hud-mp');
      // 头像圆取部件矩形内切圆
      this.avatarSize = avatar ? Math.max(8, Math.min(avatar.width, avatar.height)) : 0;
      this._avatarRect = avatar ? { x: avatar.x, y: avatar.y, width: avatar.width, height: avatar.height } : null;
      this._nameRect = name ? { x: name.x, y: name.y, width: name.width, height: name.height } : null;
      this._partStyle = {
        avatar: avatar?.data || null,
        name: name?.data || null
      };
      if (hp) {
        this.healthBar.x = hp.x;
        this.healthBar.y = hp.y;
        this.healthBar.width = hp.width;
        this.healthBar.height = hp.height;
      }
      if (mp) {
        this.manaBar.x = mp.x;
        this.manaBar.y = mp.y;
        this.manaBar.width = mp.width;
        this.manaBar.height = mp.height;
      }
      this._hpVisible = hp != null;
      this._mpVisible = mp != null;
      return;
    }

    // 内置推导：底板内边距 + 头像占高（限幅），昵称与双条纵排在头像右侧
    const padding = Math.max(4, Math.min(12, Math.round(rect.height * 0.1)));
    const avatarSize = Math.max(36, Math.min(64, rect.height - padding * 2 - 6));
    const nameHeight = 16;
    const barHeight = Math.max(10, Math.min(14, Math.round((rect.height - padding * 2 - nameHeight - 10) / 2)));
    const barX = rect.x + padding + avatarSize + 8;
    const barWidth = Math.max(40, rect.width - padding * 2 - avatarSize - 8);
    const barsTop = rect.y + padding + nameHeight + 6;
    this.avatarSize = avatarSize;
    this._avatarRect = { x: rect.x + padding, y: rect.y + (rect.height - avatarSize) / 2, width: avatarSize, height: avatarSize };
    this._nameRect = { x: barX, y: rect.y + padding, width: barWidth, height: nameHeight };
    this._partStyle = { avatar: null, name: null };
    this.healthBar.x = barX;
    this.healthBar.y = barsTop;
    this.healthBar.width = barWidth;
    this.healthBar.height = barHeight;
    this.manaBar.x = barX;
    this.manaBar.y = barsTop + barHeight + 6;
    this.manaBar.width = barWidth;
    this.manaBar.height = barHeight;
    this._hpVisible = true;
    this._mpVisible = true;
  }

  /**
   * 重新计算内部布局（窗口尺寸变化等场景调用；矩形事实以 hud-panel 布局为准）
   */
  layout() {
    this._applyPanelMetrics();
  }

  /**
   * 更新（同步玩家数值 + 平滑动画）
   * @param {number} deltaTime
   */
  update(deltaTime) {
    if (!this.visible || this.hiddenByLayout === true || !this.player) return;
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
    if (!this.visible || this.hiddenByLayout === true || !this.player) return;
    this._applyPanelMetrics();

    const style = this._panelDefinition || {};
    const radius = Math.max(0, Number(style.cornerRadius) || 0) || 8;
    const borderWidth = Math.max(0, Number.isFinite(style.borderWidth) ? style.borderWidth : 1);

    ctx.save();

    // 背景面板（半透明圆角；配色可由面板编辑器覆盖）
    this._roundRect(ctx, this.x, this.y, this.width, this.height, radius);
    ctx.fillStyle = style.backgroundColor || 'rgba(0, 0, 0, 0.45)';
    ctx.fill();
    ctx.strokeStyle = style.borderColor || 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = borderWidth;
    ctx.stroke();

    this._renderAvatar(ctx);
    this._renderName(ctx);
    if (this._hpVisible !== false) this.healthBar.render(ctx);
    if (this._mpVisible !== false) this.manaBar.render(ctx);

    ctx.restore();
  }

  /**
   * 渲染头像（离屏缓存：圆裁剪 + 图片 + 金边，仅图片/尺寸/金边样式变化时重建）。
   * 部件被删除（_avatarRect 为空）时不渲染。
   */
  _renderAvatar(ctx) {
    const rect = this._avatarRect;
    if (!rect) return;
    const style = this._partStyle?.avatar || {};
    const ringColor = style.ringColor || '#d4af37';
    const ringWidth = Math.max(0, Number.isFinite(style.ringWidth) ? style.ringWidth : 2);
    const size = this.avatarSize;
    // 圆心取部件矩形中心；描边外扩余量避免金边外半被缓存画布边界裁掉
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const ringPad = ringWidth > 0 ? Math.ceil(ringWidth / 2) + 1 : 1;
    const cacheSize = size + ringPad * 2;
    const drawAvatar = (c, ox, oy) => {
      const r = size / 2;
      const ccx = ox + r;
      const ccy = oy + r;
      c.save();
      c.beginPath();
      c.arc(ccx, ccy, r, 0, Math.PI * 2);
      c.closePath();
      c.clip();
      if (this.avatarLoaded && this.avatarImage) {
        c.drawImage(this.avatarImage, ox, oy, size, size);
      } else {
        c.fillStyle = '#444';
        c.fillRect(ox, oy, size, size);
      }
      c.restore();
      // 头像边框
      if (ringWidth > 0) {
        c.beginPath();
        c.arc(ccx, ccy, r, 0, Math.PI * 2);
        c.strokeStyle = ringColor;
        c.lineWidth = ringWidth;
        c.stroke();
      }
    };
    const key = `av|${size}|${this.avatarLoaded ? 1 : 0}|${this.avatarImage?.src || ''}|${ringColor}|${ringWidth}`;
    const cached = this._avatarCache.get(key, cacheSize, cacheSize, c => drawAvatar(c, ringPad, ringPad));
    if (cached) {
      ctx.drawImage(cached, cx - cacheSize / 2, cy - cacheSize / 2, cacheSize, cacheSize);
      return;
    }
    drawAvatar(ctx, cx - size / 2, cy - size / 2);
  }

  /**
   * 渲染昵称（颜色/字号/字重来自昵称部件；部件被删除时不渲染）
   */
  _renderName(ctx) {
    const rect = this._nameRect;
    if (!rect) return;
    const style = this._partStyle?.name || {};
    const name = this.player.name || '玩家';
    ctx.fillStyle = style.color || '#ffffff';
    ctx.font = `${style.fontWeight === 'normal' ? 'normal' : (style.fontWeight || 'bold')} ${Math.max(8, Number(style.fontSize) || 14)}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.fillText(name, rect.x, rect.y + rect.height / 2);
    ctx.shadowBlur = 0;
  }

  /**
   * 圆角矩形路径
   */
  _roundRect(ctx, x, y, w, h, radius) {
    const r = radius;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

export default PlayerStatusHUD;

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

/**
 * BottomControlBar.js
 * 底部控制栏 - 显示血量、蓝量和技能槽
 */

import { UIElement } from './UIElement.js';
import { ItemIconRenderer } from './ItemIconRenderer.js';
import { InputHints } from '../core/input/InputHints.js';
import { drawSkillIcon } from './SkillIconResolver.js';

const EMPTY_POTION_ITEMS = Object.freeze([
  Object.freeze({ id: 'health_potion', type: 'consumable', effect: Object.freeze({ type: 'heal' }) }),
  Object.freeze({ id: 'mana_potion', type: 'consumable', effect: Object.freeze({ type: 'restore_mana' }) })
]);

/** effectType → emoji 兜底映射（无 icon 图片且无矢量图标时）。 */
const SKILL_EMOJI_MAP = Object.freeze({
  flame_palm: '🔥', fireball: '🔥', ice_finger: '❄', ice_lance: '❄',
  inferno_palm: '💥', flame_burst: '💥', heal: '💚', meditation: '🧘'
});

/**
 * 底部控制栏
 */
export class BottomControlBar extends UIElement {
  /**
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    super({
      x: options.x || 0,
      y: options.y || 0,
      width: options.width || 800,
      height: options.height || 100,
      visible: options.visible !== false,
      zIndex: options.zIndex || 200
    });

    this.entity = null;
    this.now = typeof options.now === 'function' ? options.now : () => performance.now();
    // 技能 icon 图片解析（manifest 稳定 ID → AssetManager）
    this.getAssetManager = typeof options.getAssetManager === 'function' ? options.getAssetManager : null;

    // 显示配置（移动端可隐藏血球/蓝球和数字快捷键）
    this.showOrbs = options.showOrbs !== false;
    this.showHotkeyNumbers = options.showHotkeyNumbers !== false;
    
    // 技能槽配置（5个技能 + 2个药水快捷槽）
    const slotSize = 40;
    const slotGap = 6;
    const totalSlots = 7;
    const totalWidth = totalSlots * slotSize + (totalSlots - 1) * slotGap;
    const startX = this.width / 2 - totalWidth / 2 + slotSize / 2;
    
    // 血球配置（紧贴技能槽左侧）
    const orbRadius = 35;
    const orbGap = 10; // 球与技能槽的间距
    const slotsLeftEdge = this.width / 2 - totalWidth / 2;
    const slotsRightEdge = this.width / 2 + totalWidth / 2;
    
    this.hpOrb = {
      x: slotsLeftEdge - orbGap - orbRadius,
      y: 50,
      radius: orbRadius,
      color: '#ff0000',
      glowColor: '#ff6666',
      visible: true
    };
    
    // 蓝球配置（紧贴技能槽右侧）
    this.mpOrb = {
      x: slotsRightEdge + orbGap + orbRadius,
      y: 50,
      radius: orbRadius,
      color: '#0066ff',
      glowColor: '#6699ff',
      visible: true
    };
    
    this.skillSlots = [];
    // hintAction 映射：让每个槽位按当前输入方案取快捷键名。
    // visible/enabled 由渐进 UI 投影按稳定 componentId 控制。
    const slotHintActions = ['potionHp', 'potionMp', 'skill1', 'skill2', 'skill3', 'heal', 'meditation'];
    for (let i = 0; i < totalSlots; i++) {
      this.skillSlots.push({
        x: startX + i * (slotSize + slotGap),
        y: 50,
        size: slotSize,
        hotkey: `${i + 1}`,
        hintAction: slotHintActions[i] || '',
        skillIndex: i < 2 ? -1 : i - 2, // 前2个是药水，后5个是技能(0-4)
        isPotion: i < 2, // 1、2号槽是药水槽
        visible: true,
        enabled: true,
        onboardingHighlighted: false,
        onboardingHintAction: null
      });
    }
    
    // 悬停状态
    this.hoveredSlot = -1;
    this.mouseX = 0;
    this.mouseY = 0;

    // 离屏缓存：底栏每帧全量重绘是长帧常量热点（~9ms）——状态签名未变化时直接贴图
    this._offscreenCanvas = null;
    this._renderSignature = null;
    this._offscreenReady = false;
    
    // 事件回调
    this.onSkillClick = options.onSkillClick || null;
    this.onPotionUse = options.onPotionUse || null;
    // 教学高亮一次性熄灭：高亮槽位首次被点击时回调其稳定组件 ID
    this.onOnboardingComponentActivated = options.onOnboardingComponentActivated || null;

    // 是否使用 UI 编辑器的子控件独立布局（true 时不画整体背景条）
    this._hasSubLayout = false;
    this._frameNow = 0;
    this._hotkeyScheme = null;
    this._hotkeyLabels = [];
    this._potionSummaries = [{ count: 0, item: null }, { count: 0, item: null }];
    this._orbGradientCache = null;
  }

  /**
   * 应用 UI 编辑器的子控件独立布局
   * 各控件坐标改为绝对坐标（面板自身 x/y 归零），支持独立拖放/缩放
   * @param {Object} rects - 各子控件矩形 { hpOrb, mpOrb, potion1, potion2, skill1..skill5 }
   *   每项格式 { x, y, width, height }（左上角锚点）| null
   */
  applySubLayout(rects) {
    this._hasSubLayout = true;

    // 计算所有子控件的整体包围盒（用于 containsPoint 命中判断）
    const all = [
      rects.hpOrb, rects.mpOrb,
      rects.potion1, rects.potion2,
      rects.skill1, rects.skill2, rects.skill3, rects.skill4, rects.skill5
    ].filter(Boolean);
    if (all.length === 0) return;

    const minX = Math.min(...all.map(r => r.x));
    const minY = Math.min(...all.map(r => r.y));
    const maxX = Math.max(...all.map(r => r.x + r.width));
    const maxY = Math.max(...all.map(r => r.y + r.height));
    // 面板包围盒设为覆盖所有子控件；子控件坐标相对包围盒左上角
    this.x = minX;
    this.y = minY;
    this.width = maxX - minX;
    this.height = maxY - minY;

    const setOrb = (orb, r) => {
      if (!orb || !r) return;
      orb.x = (r.x + r.width / 2) - minX;   // 相对包围盒（渲染时 this.x+orb.x 还原为绝对）
      orb.y = (r.y + r.height / 2) - minY;
      orb.radius = Math.min(r.width, r.height) / 2;
    };
    setOrb(this.hpOrb, rects.hpOrb);
    setOrb(this.mpOrb, rects.mpOrb);

    const setSlot = (slot, r) => {
      if (!slot || !r) return;
      slot.x = (r.x + r.width / 2) - minX;
      slot.y = (r.y + r.height / 2) - minY;
      slot.size = Math.min(r.width, r.height);
    };
    // skillSlots: [0,1]=药水，[2..6]=技能1..5
    setSlot(this.skillSlots[0], rects.potion1);
    setSlot(this.skillSlots[1], rects.potion2);
    setSlot(this.skillSlots[2], rects.skill1);
    setSlot(this.skillSlots[3], rects.skill2);
    setSlot(this.skillSlots[4], rects.skill3);
    setSlot(this.skillSlots[5], rects.skill4);
    setSlot(this.skillSlots[6], rects.skill5);
  }

  /**
   * 设置实体
   * @param {Entity} entity - 实体对象
   */
  setEntity(entity) {
    this.entity = entity;
    this._renderSignature = null;
  }

  /**
   * 由 OnboardingUiProjection 对底栏原子组件应用表现与点击状态。
   * 键盘/手柄能力准入仍由既有输入和领域系统负责，避免 UI 投影变成业务事实源。
   */
  setOnboardingComponentState(componentId, state = {}) {
    const slots = {
      'pc-potion1': this.skillSlots[0],
      'pc-potion2': this.skillSlots[1],
      'pc-skill1': this.skillSlots[2],
      'pc-skill2': this.skillSlots[3],
      'pc-skill3': this.skillSlots[4],
      'pc-skill4': this.skillSlots[5],
      'pc-skill5': this.skillSlots[6]
    };
    const target = componentId === 'pc-hp-orb' ? this.hpOrb
      : componentId === 'pc-mp-orb' ? this.mpOrb
        : slots[componentId];
    if (!target) return false;
    target.visible = state.visible !== false;
    target.enabled = state.enabled !== false;
    target.onboardingHighlighted = state.highlighted === true;
    target.onboardingHintAction = state.hintAction || null;
    target.onboardingComponentId = componentId;
    this._hotkeyScheme = null;
    this._renderSignature = null;
    return true;
  }

  /**
   * 更新控制栏
   * @param {number} deltaTime - 帧间隔时间
   */
  update(deltaTime) {
    if (!this.visible || !this.entity) return;
  }

  /**
   * 渲染控制栏
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.visible) return;

    if (!this.entity) return;

    this._frameNow = this.now();
    this._preparePotionSummaries(this.entity.getComponent('inventory'));
    this._prepareHotkeyLabels();

    // 离屏缓存：状态签名未变化时整帧贴图，跳过血蓝球/技能槽的全量重绘。
    const canvas = ctx.canvas;
    if (!this._offscreenCanvas || this._offscreenCanvas.width !== canvas.width
      || this._offscreenCanvas.height !== canvas.height) {
      this._offscreenCanvas = document.createElement('canvas');
      this._offscreenCanvas.width = canvas.width;
      this._offscreenCanvas.height = canvas.height;
      this._renderSignature = null;
    }
    const signature = this._buildRenderSignature();
    if (signature !== this._renderSignature || this._offscreenReady !== true) {
      this._renderSignature = signature;
      const offCtx = this._offscreenCanvas.getContext('2d');
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.clearRect(0, 0, this._offscreenCanvas.width, this._offscreenCanvas.height);
      // 与主画布保持同一变换（含 dpr 缩放），离屏像素与主画布逐像素对齐
      if (typeof ctx.getTransform === 'function') {
        const m = ctx.getTransform();
        offCtx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      }
      this._renderAll(offCtx);
      this._offscreenReady = true;
    }

    // 贴回主画布：恒等变换按物理像素 1:1，避免二次缩放模糊
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this._offscreenCanvas, 0, 0);
    ctx.restore();
  }

  /** 原有全量绘制路径（绘制目标为主画布或离屏缓存）。 */
  _renderAll(ctx) {
    ctx.save();

    // 渲染背景（使用子控件独立布局时不画整体背景条）
    if (!this._hasSubLayout) {
      this.renderBackground(ctx);
    }

    // 渲染血球与蓝球，同帧只解析一次 StatsComponent
    if (this.showOrbs) {
      const stats = this.entity.getComponent('stats');
      if (this.hpOrb.visible !== false) this.renderHpOrb(ctx, stats);
      if (this.mpOrb.visible !== false) this.renderMpOrb(ctx, stats);
    }

    // 渲染技能槽
    this.renderSkillSlots(ctx);

    ctx.restore();
  }

  /**
   * 底栏重绘签名：覆盖全部绘制输入（布局/血蓝/槽位/冷却/药水/引导态）。
   * 冷却剩余按 0.1s 量化，冷却动画期间以 ~10fps 刷新遮罩。
   */
  _buildRenderSignature() {
    const parts = [
      this.hoveredSlot, this.showOrbs, this.showHotkeyNumbers, this._hasSubLayout,
      this.x, this.y, this.width, this.height,
      this.hpOrb.x, this.hpOrb.y, this.hpOrb.radius, this.hpOrb.visible,
      this.mpOrb.x, this.mpOrb.y, this.mpOrb.radius, this.mpOrb.visible,
      this._hotkeyScheme
    ];
    const stats = this.entity.getComponent('stats');
    if (stats) parts.push(stats.hp, stats.maxHp, stats.mp, stats.maxMp);
    const combat = this.entity.getComponent('combat');
    if (combat) {
      // heal 槽进食冷却：必须用「剩余时间」量化（绝对截止时间戳是常数，会让签名
      // 在冷却期间不变、离屏不重绘，倒计时卡死不走）
      const healRemaining = Math.max(0, (Number(combat.healCooldownUntil) || 0) - (this._frameNow || 0));
      parts.push(Math.ceil(healRemaining / 100));
    }
    const skills = combat && Array.isArray(combat.skills) ? combat.skills : null;
    if (skills) parts.push('skills', skills.length);
    for (let i = 0; i < this.skillSlots.length; i++) {
      const slot = this.skillSlots[i];
      parts.push(slot.x, slot.y, slot.size, slot.visible, slot.enabled,
        slot.onboardingHighlighted, slot.onboardingHintAction, slot.hintAction);
      if (slot.isPotion) {
        const summary = this._potionSummaries[i];
        parts.push(summary.count, summary.item ? (summary.item.id || summary.item.name || '?') : null);
      } else if (skills) {
        const skill = skills[slot.skillIndex];
        if (!skill) { parts.push('empty'); continue; }
        parts.push(skill.id);
        const remaining = typeof combat.getSkillCooldownRemaining === 'function'
          ? combat.getSkillCooldownRemaining(skill.id, this._frameNow) : 0;
        parts.push(Math.ceil(remaining / 100));
      }
    }
    return parts.join('|');
  }

  _preparePotionSummaries(inventory) {
    const health = this._potionSummaries[0];
    const mana = this._potionSummaries[1];
    health.count = 0;
    health.item = null;
    mana.count = 0;
    mana.item = null;
    if (!inventory) return;

    const slots = Array.isArray(inventory.slots) ? inventory.slots : null;
    if (slots) {
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index];
        const item = slot?.item;
        if (!item || item.type !== 'consumable' || !item.usable || !item.effect) continue;
        const summary = item.effect.type === 'heal'
          ? health
          : item.effect.type === 'restore_mana' ? mana : null;
        if (!summary) continue;
        if (!summary.item) summary.item = item;
        summary.count += slot.quantity;
      }
      return;
    }

    // 兼容只暴露旧 getAllItems() 的库存实现。
    const items = inventory.getAllItems?.() || [];
    for (let index = 0; index < items.length; index++) {
      const slot = items[index]?.slot;
      const item = slot?.item;
      if (!item || item.type !== 'consumable' || !item.usable || !item.effect) continue;
      const summary = item.effect.type === 'heal'
        ? health
        : item.effect.type === 'restore_mana' ? mana : null;
      if (!summary) continue;
      if (!summary.item) summary.item = item;
      summary.count += slot.quantity;
    }
  }

  _prepareHotkeyLabels() {
    const scheme = InputHints.scheme;
    if (this._hotkeyScheme === scheme && this._hotkeyLabels.length === this.skillSlots.length) return;
    this._hotkeyScheme = scheme;
    this._hotkeyLabels.length = this.skillSlots.length;
    for (let index = 0; index < this.skillSlots.length; index++) {
      const slot = this.skillSlots[index];
      this._hotkeyLabels[index] = slot.hintAction ? InputHints.key(slot.hintAction) : slot.hotkey;
    }
  }

  _getOrbGradients(ctx) {
    const hpX = this.x + this.hpOrb.x;
    const hpY = this.y + this.hpOrb.y;
    const mpX = this.x + this.mpOrb.x;
    const mpY = this.y + this.mpOrb.y;
    const signature = `${hpX}:${hpY}:${this.hpOrb.radius}:${mpX}:${mpY}:${this.mpOrb.radius}`;
    if (this._orbGradientCache?.ctx === ctx && this._orbGradientCache.signature === signature) {
      return this._orbGradientCache;
    }
    const hpGlow = ctx.createRadialGradient(hpX, hpY, 0, hpX, hpY, this.hpOrb.radius + 10);
    hpGlow.addColorStop(0, this.hpOrb.glowColor);
    hpGlow.addColorStop(0.7, this.hpOrb.color);
    hpGlow.addColorStop(1, 'rgba(255, 0, 0, 0)');
    const mpGlow = ctx.createRadialGradient(mpX, mpY, 0, mpX, mpY, this.mpOrb.radius + 10);
    mpGlow.addColorStop(0, this.mpOrb.glowColor);
    mpGlow.addColorStop(0.7, this.mpOrb.color);
    mpGlow.addColorStop(1, 'rgba(0, 102, 255, 0)');
    const hpFill = ctx.createLinearGradient(hpX, hpY - this.hpOrb.radius, hpX, hpY + this.hpOrb.radius);
    hpFill.addColorStop(0, '#ff6666');
    hpFill.addColorStop(1, '#cc0000');
    const mpFill = ctx.createLinearGradient(mpX, mpY - this.mpOrb.radius, mpX, mpY + this.mpOrb.radius);
    mpFill.addColorStop(0, '#6699ff');
    mpFill.addColorStop(1, '#0044cc');
    this._orbGradientCache = { ctx, signature, hpGlow, mpGlow, hpFill, mpFill };
    return this._orbGradientCache;
  }

  /**
   * 渲染背景
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderBackground(ctx) {
    // 半透明黑色背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(this.x, this.y, this.width, this.height);
    
    // 顶部边框
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + this.width, this.y);
    ctx.stroke();
  }

  /**
   * 渲染血球
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderHpOrb(ctx, stats = this.entity?.getComponent?.('stats')) {
    if (!this.entity || !stats) return;

    const hpRatio = stats.maxHp > 0 ? stats.hp / stats.maxHp : 0;
    const orbX = this.x + this.hpOrb.x;
    const orbY = this.y + this.hpOrb.y;
    const radius = this.hpOrb.radius;
    
    // 外发光效果（位置和半径不变时复用 CanvasGradient）
    const gradient = this._getOrbGradients(ctx).hpGlow;
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius + 10, 0, Math.PI * 2);
    ctx.fill();
    
    // 球体背景（暗色）
    ctx.fillStyle = '#330000';
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // 血量填充（从下往上）
    if (hpRatio > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
      ctx.clip();
      
      const fillHeight = radius * 2 * hpRatio;
      const fillY = orbY + radius - fillHeight;
      
      ctx.fillStyle = this._getOrbGradients(ctx).hpFill;
      ctx.fillRect(orbX - radius, fillY, radius * 2, fillHeight);
      
      ctx.restore();
    }
    
    // 球体边框
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // 高光效果
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(orbX - 10, orbY - 10, 12, 0, Math.PI * 2);
    ctx.fill();
    
    // 血量文字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.floor(stats.hp)}/${stats.maxHp}`, orbX, orbY);
  }

  /**
   * 渲染蓝球
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderMpOrb(ctx, stats = this.entity?.getComponent?.('stats')) {
    if (!this.entity || !stats) return;

    const mpRatio = stats.maxMp > 0 ? stats.mp / stats.maxMp : 0;
    const orbX = this.x + this.mpOrb.x;
    const orbY = this.y + this.mpOrb.y;
    const radius = this.mpOrb.radius;
    
    // 外发光效果（位置和半径不变时复用 CanvasGradient）
    const gradient = this._getOrbGradients(ctx).mpGlow;
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius + 10, 0, Math.PI * 2);
    ctx.fill();
    
    // 球体背景（暗色）
    ctx.fillStyle = '#000033';
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // 蓝量填充（从下往上）
    if (mpRatio > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
      ctx.clip();
      
      const fillHeight = radius * 2 * mpRatio;
      const fillY = orbY + radius - fillHeight;
      
      ctx.fillStyle = this._getOrbGradients(ctx).mpFill;
      ctx.fillRect(orbX - radius, fillY, radius * 2, fillHeight);
      
      ctx.restore();
    }
    
    // 球体边框
    ctx.strokeStyle = '#0066ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // 高光效果
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(orbX - 10, orbY - 10, 12, 0, Math.PI * 2);
    ctx.fill();
    
    // 蓝量文字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.floor(stats.mp)}/${stats.maxMp}`, orbX, orbY);
  }

  /**
   * 渲染技能槽
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderSkillSlots(ctx) {
    if (!this.entity) return;
    
    const combat = this.entity.getComponent('combat');
    
    for (let i = 0; i < this.skillSlots.length; i++) {
      const slot = this.skillSlots[i];
      if (slot.visible === false) continue;
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;
      const halfSize = slot.size / 2;
      
      const isHovered = this.hoveredSlot === i;
      
      // 槽位背景
      ctx.fillStyle = isHovered ? 'rgba(100, 100, 100, 0.8)' : 'rgba(50, 50, 50, 0.8)';
      ctx.fillRect(slotX - halfSize, slotY - halfSize, slot.size, slot.size);
      
      // 槽位边框（药水槽用不同颜色）
      if (slot.isPotion) {
        const potionColor = i === 0 ? '#cc3333' : '#3366cc';
        ctx.strokeStyle = isHovered ? '#ffffff' : potionColor;
      } else {
        ctx.strokeStyle = isHovered ? '#ffffff' : '#666';
      }
      ctx.lineWidth = 1.5;
      ctx.strokeRect(slotX - halfSize, slotY - halfSize, slot.size, slot.size);
      if (slot.onboardingHighlighted) {
        ctx.save();
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255, 212, 121, 0.9)';
        ctx.shadowBlur = 10;
        ctx.strokeRect(slotX - halfSize - 2, slotY - halfSize - 2, slot.size + 4, slot.size + 4);
        ctx.restore();
      }
      
      // 渲染内容
      if (slot.isPotion) {
        this.renderPotionSlot(ctx, slotX, slotY, slot.size, i, this._potionSummaries[i]);
        // heal 槽战斗进食冷却遮罩（15 秒共享冷却，与技能冷却同款扫过样式）
        if (i === 0 && combat) {
          const healCooldownUntil = Number(combat.healCooldownUntil) || 0;
          const remainingMs = healCooldownUntil - (this._frameNow || 0);
          if (remainingMs > 0) {
            const remainingSec = remainingMs / 1000;
            const ratio = Math.min(1, remainingSec / 15);
            ctx.save();
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.rect(slotX - halfSize, slotY - halfSize, slot.size, slot.size);
            ctx.clip();
            ctx.beginPath();
            ctx.moveTo(slotX, slotY);
            ctx.arc(slotX, slotY, slot.size, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#ffcc66';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(Math.ceil(remainingSec), slotX, slotY);
          }
        }
      } else if (combat && combat.skills) {
        const skill = combat.skills[slot.skillIndex];
        if (skill) {
          this.renderSkill(ctx, skill, slotX, slotY, slot.size, combat, this._frameNow);
        }
      }
      
      // 快捷键提示（槽下方）—— 当前输入方案变化时才重新解析
      if (this.showHotkeyNumbers) {
        const hotkeyText = slot.onboardingHintAction || slot.hintAction
          ? InputHints.key(slot.onboardingHintAction || slot.hintAction)
          : slot.hotkey;
        ctx.fillStyle = '#ffd479';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(hotkeyText, slotX, slotY + halfSize + 13);
      }

      // 名称显示（槽上方）
      let slotName = '';
      if (slot.isPotion) {
        // heal 槽显示当前选中的恢复类消耗品名（Shift+1 切换 / 右键打开选择列表）
        const summary = this._potionSummaries[i];
        slotName = i === 0
          ? (summary?.item?.name || '红瓶')
          : '蓝瓶';
      } else if (combat && combat.skills) {
        const skill = combat.skills[slot.skillIndex];
        if (skill) slotName = skill.name || '';
      }
      if (slotName) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(slotName, slotX, slotY - halfSize - 3);
      }
    }
  }

  /**
   * 渲染药水快捷槽
   */
  renderPotionSlot(ctx, x, y, size, slotIndex, summary) {
    const potionCount = summary?.count || 0;
    const potionItem = summary?.item || null;
    
    ctx.save();
    
    if (potionCount > 0 && potionItem) {
      // 使用 ItemIconRenderer 绘制实际物品图标
      ItemIconRenderer.drawIcon(ctx, potionItem, x, y, size * 0.8);
      
      // 数量
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      const countText = `${potionCount}`;
      const countX = x + size / 2 - 3;
      const countY = y + size / 2 - 4;
      ctx.strokeText(countText, countX, countY);
      ctx.fillText(countText, countX, countY);
    } else {
      // 空槽 - 半透明占位图标
      ctx.globalAlpha = 0.3;
      const placeholderItem = EMPTY_POTION_ITEMS[slotIndex];
      ItemIconRenderer.drawIcon(ctx, placeholderItem, x, y, size * 0.8);
      ctx.globalAlpha = 1.0;
    }
    
    ctx.restore();
  }

  /**
   * 渲染技能
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} skill - 技能对象
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} size - 尺寸
   * @param {Object} combatComponent - 战斗组件
   */
  renderSkill(ctx, skill, x, y, size, combatComponent, currentTime = this._frameNow || this.now()) {
    const halfSize = size / 2;
    
    // 技能图标（简化为图形）
    this.renderSkillIcon(ctx, skill, x, y, size);
    
    // 冷却遮罩
    const cooldownMs = combatComponent.getSkillCooldownRemaining(skill.id, currentTime);
    const cooldown = cooldownMs / 1000; // 转换为秒
    
    if (cooldown > 0) {
      const cooldownRatio = cooldown / skill.cooldown;
      
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#000000';
      
      // 方形遮罩 + 旋转扫描：裁剪到方形槽位，再用大半径扇形扫过，填满方形四角
      ctx.beginPath();
      ctx.rect(x - halfSize, y - halfSize, size, size);
      ctx.clip();
      // 半径取 size（> 方形对角线一半 halfSize*√2），保证扫描覆盖四角
      const sweepRadius = size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, sweepRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldownRatio);
      ctx.closePath();
      ctx.fill();
      
      ctx.restore();
      
      // 冷却时间文字
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cooldown.toFixed(1), x, y);
    }
    
    // 魔法消耗
    if (skill.manaCost > 0) {
      ctx.fillStyle = '#00ccff';
      ctx.font = '10px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(skill.manaCost, x + halfSize - 3, y - halfSize + 12);
    }
  }

  /**
   * 渲染技能图标
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} skill - 技能对象
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} size - 尺寸
   */
  renderSkillIcon(ctx, skill, x, y, size) {
    const halfSize = size / 2;

    ctx.save();
    ctx.translate(x, y);

    // 技能图标：manifest 图片（skill.icon）→ HudIconPainter 矢量 → emoji/短文本兜底
    const iconDrawn = drawSkillIcon(ctx, skill, 0, 0, size * 0.72, this.getAssetManager);
    if (!iconDrawn) {
      // skill.icon 若是短 emoji/文本沿用；否则按 effectType 映射
      const customIcon = typeof skill.icon === 'string' && skill.icon.length <= 4 && !/^[A-Za-z]/.test(skill.icon)
        ? skill.icon
        : (SKILL_EMOJI_MAP[skill.effectType] || '⚡');
      ctx.font = `${size * 0.55}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(customIcon, 0, 0);
    }

    // 技能名称（小字）：仅在 icon 为短文本（旧配置）时绘制，图片/矢量图标不再叠加
    if (!iconDrawn && typeof skill.icon === 'string' && skill.icon.length <= 4 && skill.name) {
      ctx.font = `${Math.max(10, size * 0.18)}px Arial`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(skill.name, 0, halfSize - 6);
    }

    ctx.restore();
  }

  /**
   * 处理鼠标移动
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   */
  handleMouseMove(x, y) {
    if (!this.visible) return;

    this.mouseX = x;
    this.mouseY = y;
    this.hoveredSlot = -1;

    for (let i = 0; i < this.skillSlots.length; i++) {
      const slot = this.skillSlots[i];
      if (slot.visible === false || slot.enabled === false) continue;
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;
      const halfSize = slot.size / 2;

      if (x >= slotX - halfSize && x <= slotX + halfSize &&
          y >= slotY - halfSize && y <= slotY + halfSize) {
        this.hoveredSlot = i;
        break;
      }
    }
  }

  /**
   * 处理鼠标点击
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   * @returns {boolean} 是否处理了点击
   */
  handleMouseClick(x, y, button = 'left') {
    if (!this.visible || !this.containsPoint(x, y)) return false;

    // 检查技能槽点击
    for (let i = 0; i < this.skillSlots.length; i++) {
      const slot = this.skillSlots[i];
      if (slot.visible === false || slot.enabled === false) continue;
      const slotX = this.x + slot.x;
      const slotY = this.y + slot.y;
      const halfSize = slot.size / 2;

      if (x >= slotX - halfSize && x <= slotX + halfSize &&
          y >= slotY - halfSize && y <= slotY + halfSize) {

        // 教学高亮一次性熄灭：高亮槽位被首次点击即回调熄灭
        if (slot.onboardingHighlighted && slot.onboardingComponentId) {
          this.onOnboardingComponentActivated?.(slot.onboardingComponentId);
        }

        // 药水槽
        if (slot.isPotion) {
          // heal 槽右键 = 打开恢复类消耗品选择列表（Shift+1 为快速循环切换）
          if (i === 0 && button === 'right' && this.onHealSlotRightClick) {
            this.onHealSlotRightClick();
            return true;
          }
          if (this.onPotionUse) {
            const potionType = i === 0 ? 'health' : 'mana';
            this.onPotionUse(potionType);
          }
          return true;
        }
        
        // 技能槽
        if (this.onSkillClick && this.entity) {
          const combat = this.entity.getComponent('combat');
          if (combat && combat.skills) {
            const skill = combat.skills[slot.skillIndex];
            if (skill) {
              this.onSkillClick(skill);
            }
          }
        }
        
        return true;
      }
    }

    return true; // 阻止事件传播
  }

  /**
   * 切换显示状态
   */
  toggle() {
    this.visible = !this.visible;
  }

  /**
   * 显示控制栏
   */
  show() {
    this.visible = true;
  }

  /**
   * 隐藏控制栏
   */
  hide() {
    this.visible = false;
  }
}

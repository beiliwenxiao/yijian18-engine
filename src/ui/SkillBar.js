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
import { drawSkillIcon } from './SkillIconResolver.js';

/**
 * 技能栏组件
 * 显示角色的技能图标、冷却状态和快捷键
 */
export class SkillBar extends UIElement {
  /**
   * @param {Object} options - 配置选项
   * @param {Array} options.skills - 技能列表
   * @param {number} [options.slotSize=50] - 技能槽大小
   * @param {number} [options.slotSpacing=10] - 技能槽间距
   * @param {string} [options.backgroundColor='rgba(0, 0, 0, 0.7)'] - 背景颜色
   * @param {string} [options.borderColor='#ffffff'] - 边框颜色
   * @param {string} [options.cooldownColor='rgba(0, 0, 0, 0.6)'] - 冷却遮罩颜色
   */
  constructor(options = {}) {
    super(options);
    
    this.skills = options.skills || [];
    this.slotSize = options.slotSize || 50;
    this.slotSpacing = options.slotSpacing || 10;
    this.backgroundColor = options.backgroundColor || 'rgba(0, 0, 0, 0.7)';
    this.borderColor = options.borderColor || '#ffffff';
    this.cooldownColor = options.cooldownColor || 'rgba(0, 0, 0, 0.6)';
    this.insufficientManaColor = options.insufficientManaColor || '#ff0000';
    this.getAssetManager = typeof options.getAssetManager === 'function' ? options.getAssetManager : null;
    
    this.borderWidth = 2;
    this.padding = 5;
    
    // 计算总宽度和高度
    this.updateSize();
  }

  /**
   * 更新尺寸
   */
  updateSize() {
    const slotCount = Math.min(this.skills.length, 6);
    this.width = slotCount * this.slotSize + (slotCount - 1) * this.slotSpacing + this.padding * 2;
    this.height = this.slotSize + this.padding * 2;
  }

  /**
   * 设置技能列表
   * @param {Array} skills - 技能列表
   */
  setSkills(skills) {
    this.skills = skills || [];
    this.updateSize();
  }

  /**
   * 更新技能栏
   * @param {number} deltaTime - 帧间隔时间（毫秒）
   */
  update(deltaTime) {
    // 技能冷却在技能对象本身更新
  }

  /**
   * 渲染技能栏
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   */
  render(ctx) {
    if (!this.visible) return;

    // 绘制背景
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);

    // 绘制边框
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.strokeRect(this.x, this.y, this.width, this.height);

    // 绘制技能槽
    const maxSlots = Math.min(this.skills.length, 6);
    for (let i = 0; i < maxSlots; i++) {
      const skill = this.skills[i];
      const slotX = this.x + this.padding + i * (this.slotSize + this.slotSpacing);
      const slotY = this.y + this.padding;
      
      this.renderSkillSlot(ctx, skill, slotX, slotY, i + 1);
    }
  }

  /**
   * 渲染单个技能槽
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Object} skill - 技能对象
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} hotkey - 快捷键数字
   */
  renderSkillSlot(ctx, skill, x, y, hotkey) {
    // 绘制槽位背景
    ctx.fillStyle = '#222222';
    ctx.fillRect(x, y, this.slotSize, this.slotSize);

    // 绘制槽位边框
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, this.slotSize, this.slotSize);

    if (!skill) {
      // 空槽位，显示快捷键
      this.renderHotkey(ctx, hotkey, x, y);
      return;
    }

    // 绘制技能图标（使用颜色代替图片）
    this.renderSkillIcon(ctx, skill, x, y);

    // 检查魔法值是否足够
    const hasEnoughMana = !skill.manaCost || (skill.currentMana !== undefined && skill.currentMana >= skill.manaCost);
    
    // 绘制魔法值不足的红色边框
    if (!hasEnoughMana) {
      ctx.strokeStyle = this.insufficientManaColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, this.slotSize, this.slotSize);
    }

    // 绘制冷却遮罩
    if (skill.remainingCooldown && skill.remainingCooldown > 0) {
      this.renderCooldownMask(ctx, skill, x, y);
    }

    // 绘制快捷键
    this.renderHotkey(ctx, hotkey, x, y);

    // 绘制冷却时间文字
    if (skill.remainingCooldown && skill.remainingCooldown > 0) {
      this.renderCooldownText(ctx, skill.remainingCooldown, x, y);
    }
  }

  /**
   * 渲染技能图标
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Object} skill - 技能对象
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  renderSkillIcon(ctx, skill, x, y) {
    const centerX = x + this.slotSize / 2;
    const centerY = y + this.slotSize / 2;
    const iconSize = this.slotSize - 10;

    ctx.save();

    // manifest 图片（skill.icon）→ HudIconPainter 矢量 → 代码图标兜底
    if (drawSkillIcon(ctx, skill, centerX, centerY, iconSize, this.getAssetManager)) {
      ctx.restore();
      return;
    }

    // 根据技能ID绘制不同的图标
    switch(skill.id) {
      case 'basic_attack':
        this.drawSwordIcon(ctx, centerX, centerY, iconSize);
        break;
      case 'fireball':
        this.drawFireballIcon(ctx, centerX, centerY, iconSize);
        break;
      case 'iceLance':
      case 'ice_lance':
        this.drawIceLanceIcon(ctx, centerX, centerY, iconSize);
        break;
      case 'flameBurst':
      case 'flame_burst':
        this.drawFlameBurstIcon(ctx, centerX, centerY, iconSize);
        break;
      case 'heal':
        this.drawHealIcon(ctx, centerX, centerY, iconSize);
        break;
      default:
        this.drawDefaultIcon(ctx, centerX, centerY, iconSize, skill);
        break;
    }
    
    ctx.restore();
  }

  /**
   * 绘制剑图标（普通攻击）
   */
  drawSwordIcon(ctx, x, y, size) {
    const gradient = ctx.createLinearGradient(x - size/4, y - size/3, x + size/4, y + size/3);
    gradient.addColorStop(0, '#c0c0c0');
    gradient.addColorStop(0.5, '#ffffff');
    gradient.addColorStop(1, '#808080');
    
    ctx.fillStyle = gradient;
    ctx.strokeStyle = '#404040';
    ctx.lineWidth = 2;
    
    // 剑身
    ctx.beginPath();
    ctx.moveTo(x, y - size/3);
    ctx.lineTo(x + size/8, y + size/4);
    ctx.lineTo(x - size/8, y + size/4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // 护手
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x - size/4, y + size/5, size/2, size/10);
    
    // 剑柄
    ctx.fillStyle = '#654321';
    ctx.fillRect(x - size/12, y + size/4, size/6, size/6);
  }

  /**
   * 绘制火球图标
   */
  drawFireballIcon(ctx, x, y, size) {
    // 外层火焰
    const outerGradient = ctx.createRadialGradient(x, y, 0, x, y, size/2);
    outerGradient.addColorStop(0, '#ffff00');
    outerGradient.addColorStop(0.4, '#ff6600');
    outerGradient.addColorStop(0.7, '#ff0000');
    outerGradient.addColorStop(1, '#8B0000');
    
    ctx.fillStyle = outerGradient;
    ctx.beginPath();
    ctx.arc(x, y, size/2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // 内层亮光
    const innerGradient = ctx.createRadialGradient(x - size/8, y - size/8, 0, x, y, size/4);
    innerGradient.addColorStop(0, '#ffffff');
    innerGradient.addColorStop(0.5, '#ffff00');
    innerGradient.addColorStop(1, 'rgba(255, 100, 0, 0)');
    
    ctx.fillStyle = innerGradient;
    ctx.beginPath();
    ctx.arc(x - size/10, y - size/10, size/4, 0, Math.PI * 2);
    ctx.fill();
    
    // 火焰纹理
    ctx.strokeStyle = '#ff4400';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * size/3, y + Math.sin(angle) * size/3);
      ctx.stroke();
    }
  }

  /**
   * 绘制寒冰箭图标
   */
  drawIceLanceIcon(ctx, x, y, size) {
    // 冰晶背景
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size/2);
    gradient.addColorStop(0, '#e0ffff');
    gradient.addColorStop(0.5, '#87ceeb');
    gradient.addColorStop(1, '#4682b4');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, size/2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // 冰箭
    ctx.fillStyle = '#b0e0e6';
    ctx.strokeStyle = '#4169e1';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(x - size/3, y);
    ctx.lineTo(x + size/3, y - size/10);
    ctx.lineTo(x + size/3, y + size/10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // 箭头
    ctx.beginPath();
    ctx.moveTo(x + size/3, y);
    ctx.lineTo(x + size/2.5, y - size/8);
    ctx.lineTo(x + size/2.5, y + size/8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // 冰晶效果
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const r = size/4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
      ctx.stroke();
    }
  }

  /**
   * 绘制烈焰爆发图标
   */
  drawFlameBurstIcon(ctx, x, y, size) {
    // 爆炸核心
    const coreGradient = ctx.createRadialGradient(x, y, 0, x, y, size/3);
    coreGradient.addColorStop(0, '#ffffff');
    coreGradient.addColorStop(0.3, '#ffff00');
    coreGradient.addColorStop(0.6, '#ff4400');
    coreGradient.addColorStop(1, '#ff0000');
    
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(x, y, size/3, 0, Math.PI * 2);
    ctx.fill();
    
    // 爆炸火焰
    ctx.strokeStyle = '#ff2200';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const startR = size/3;
      const endR = size/2;
      
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * startR, y + Math.sin(angle) * startR);
      ctx.lineTo(x + Math.cos(angle) * endR, y + Math.sin(angle) * endR);
      ctx.stroke();
    }
    
    // 外层火环
    const ringGradient = ctx.createRadialGradient(x, y, size/3, x, y, size/2);
    ringGradient.addColorStop(0, 'rgba(255, 100, 0, 0)');
    ringGradient.addColorStop(0.5, 'rgba(255, 68, 0, 0.6)');
    ringGradient.addColorStop(1, 'rgba(139, 0, 0, 0.3)');
    
    ctx.fillStyle = ringGradient;
    ctx.beginPath();
    ctx.arc(x, y, size/2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 绘制治疗图标
   */
  drawHealIcon(ctx, x, y, size) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size/2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.4, '#00ff88');
    gradient.addColorStop(1, '#00cc66');
    
    ctx.fillStyle = gradient;
    ctx.strokeStyle = '#008844';
    ctx.lineWidth = 2;
    
    // 十字
    const crossSize = size/2.5;
    const crossWidth = size/8;
    
    // 竖线
    ctx.fillRect(x - crossWidth/2, y - crossSize/2, crossWidth, crossSize);
    ctx.strokeRect(x - crossWidth/2, y - crossSize/2, crossWidth, crossSize);
    
    // 横线
    ctx.fillRect(x - crossSize/2, y - crossWidth/2, crossSize, crossWidth);
    ctx.strokeRect(x - crossSize/2, y - crossWidth/2, crossSize, crossWidth);
    
    // 光晕效果
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, size/2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * 绘制默认图标
   */
  drawDefaultIcon(ctx, x, y, size, skill) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size/2);
    const color = this.getSkillColor(skill);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, size/2.5, 0, Math.PI * 2);
    ctx.fill();

    // 绘制技能名称首字母
    if (skill.name) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 3;
      ctx.fillText(skill.name.charAt(0), x, y);
      ctx.shadowBlur = 0;
    }
  }

  /**
   * 获取技能颜色
   * @param {Object} skill - 技能对象
   * @returns {string} 颜色值
   */
  getSkillColor(skill) {
    if (skill.type === 'physical') return '#ff4444';
    if (skill.type === 'heal') return '#44ff44';
    if (skill.type === 'buff') return '#4444ff';
    if (skill.type === 'magic') return '#ff00ff';
    return '#ffaa00';
  }

  /**
   * 渲染冷却遮罩（扇形）
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {Object} skill - 技能对象
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  renderCooldownMask(ctx, skill, x, y) {
    const cooldownPercentage = skill.remainingCooldown / skill.cooldown;
    const centerX = x + this.slotSize / 2;
    const centerY = y + this.slotSize / 2;
    const radius = this.slotSize / 2;

    ctx.save();
    ctx.fillStyle = this.cooldownColor;
    
    // 绘制扇形遮罩
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(
      centerX, centerY, radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * cooldownPercentage
    );
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
  }

  /**
   * 渲染快捷键
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {number} hotkey - 快捷键数字
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  renderHotkey(ctx, hotkey, x, y) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    // 添加文字阴影
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 2;
    ctx.fillText(hotkey.toString(), x + 3, y + 3);
    ctx.shadowBlur = 0;
  }

  /**
   * 渲染冷却时间文字
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   * @param {number} cooldown - 剩余冷却时间（秒）
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  renderCooldownText(ctx, cooldown, x, y) {
    const seconds = Math.ceil(cooldown / 1000);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 添加文字阴影
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 3;
    ctx.fillText(seconds.toString(), x + this.slotSize / 2, y + this.slotSize / 2);
    ctx.shadowBlur = 0;
  }

  /**
   * 获取指定位置的技能索引
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {number} 技能索引，-1表示未找到
   */
  getSkillIndexAt(x, y) {
    if (!this.containsPoint(x, y)) return -1;

    const relativeX = x - this.x - this.padding;
    const slotIndex = Math.floor(relativeX / (this.slotSize + this.slotSpacing));
    
    if (slotIndex >= 0 && slotIndex < this.skills.length) {
      return slotIndex;
    }
    
    return -1;
  }
}

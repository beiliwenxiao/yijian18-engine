/**
 * SkillWheelOverlay - 手柄技能环形轮盘 UI
 *
 * LB 按住时弹出，以画面中心为圆心，显示所有可切换技能的图标。
 * 右摇杆推向目标方向高亮对应技能，松开 LB 确认选择。
 * 纯 Canvas 渲染，无 DOM 依赖。
 */

import { UIElement } from './UIElement.js';
import { HudIconPainter } from './HudIconPainter.js';

export class SkillWheelOverlay extends UIElement {
  constructor(options = {}) {
    super({
      x: 0, y: 0,
      width: options.canvasWidth || 1280,
      height: options.canvasHeight || 720,
      visible: false,
      zIndex: 800
    });
    this.radius = options.radius || 120;        // 轮盘半径
    this.iconSize = options.iconSize || 48;     // 图标大小
    this.skills = [];                           // [{ name, icon, effectType }]
    this.selectedIndex = -1;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
  }

  /**
   * 设置可选技能列表
   * @param {Array} skills - [{ name, icon, effectType, id }]
   */
  setSkills(skills) {
    this.skills = skills || [];
  }

  /**
   * 打开轮盘
   * @param {number} currentIndex - 当前选中索引
   */
  open(currentIndex = 0) {
    this.selectedIndex = currentIndex;
    this.visible = true;
  }

  /**
   * 关闭轮盘
   * @returns {number} 最终选中的索引
   */
  close() {
    this.visible = false;
    return this.selectedIndex;
  }

  /**
   * 更新选中（由控制器每帧调用）
   * @param {number} index
   */
  setSelectedIndex(index) {
    this.selectedIndex = index;
  }

  /**
   * 渲染轮盘
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible || this.skills.length === 0) return;

    const count = this.skills.length;
    const cx = this.centerX;
    const cy = this.centerY;
    const r = this.radius;

    ctx.save();

    // 半透明背景遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, this.width, this.height);

    // 轮盘底圈
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // 中心点
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();

    // 绘制每个技能图标
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2; // 从顶部开始
      const ix = cx + Math.cos(angle) * r;
      const iy = cy + Math.sin(angle) * r;
      const isSelected = i === this.selectedIndex;
      const skill = this.skills[i];

      // 扇形高亮背景
      if (isSelected) {
        const startAngle = angle - Math.PI / count;
        const endAngle = angle + Math.PI / count;
        ctx.fillStyle = 'rgba(76, 175, 80, 0.4)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r + 30, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();
      }

      // 图标背景圆
      const bgSize = this.iconSize;
      ctx.fillStyle = isSelected ? 'rgba(76, 175, 80, 0.9)' : 'rgba(40, 40, 40, 0.85)';
      ctx.beginPath();
      ctx.arc(ix, iy, bgSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : '#666';
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.stroke();

      // 图标：矢量图标（HudIconPainter）优先，emoji 回退
      const iconKey = this._getSkillIconKey(skill);
      if (!HudIconPainter.draw(ctx, iconKey, ix, iy, bgSize * 0.52)) {
        const iconEmoji = this._getSkillEmoji(skill);
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.floor(bgSize * 0.5)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(iconEmoji, ix, iy);
      }

      // 技能名（选中时显示在图标下方）
      if (isSelected) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(skill.name || '', ix, iy + bgSize / 2 + 16);
      }
    }

    // 中心提示文字
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('推动右摇杆选择', cx, cy);

    ctx.restore();
  }

  /** 技能 → 矢量图标键（HudIconPainter）；未映射的 id 回退 effectType，再回退 emoji。 */
  _getSkillIconKey(skill) {
    if (!skill) return '';
    if (HudIconPainter.has(skill.icon)) return skill.icon;
    const map = {
      flame_palm: 'flame',
      inferno_palm: 'flame',
      fireball: 'flame',
      ice_finger: 'frost',
      ice_lance: 'frost',
      heal: 'heal',
      talisman_water: 'heal',
      meditation: 'meditation',
      cleave: 'attack',
      arrow_shot: 'arrow',
      power_jump: 'jump',
      jump: 'jump',
      flight: 'flight',
      gathering_puppet: 'gather'
    };
    return map[skill.id] || map[skill.effectType] || '';
  }

  _getSkillEmoji(skill) {
    if (!skill) return '?';
    if (skill.icon) return skill.icon;
    const map = {
      flame_palm: '🔥',
      ice_finger: '❄',
      inferno_palm: '💥',
      heal: '💚',
      meditation: '🧘',
      fireball: '🔥',
      ice_lance: '❄'
    };
    return map[skill.effectType] || '⚡';
  }

  /**
   * 点击命中（轮盘打开时消费所有点击，防止穿透）
   */
  handleMouseClick(x, y, button) {
    return this.visible;
  }
}

export default SkillWheelOverlay;

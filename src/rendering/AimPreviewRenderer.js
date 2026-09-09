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
 * AimPreviewRenderer - 技能/动作瞄准预览虚线框（框架级，纯绘制）
 *
 * 三端共用：PC 鼠标瞄准、触屏拖拽瞄准、手柄摇杆瞄准都渲染同一套预览，
 * 保证玩家在不同设备上看到一致的落点指示。
 *
 * 形状按技能 id 分派：
 *   ice_finger     路径矩形 + 终点椭圆（线性穿刺类）
 *   ranged_attack  小椭圆（精确落点类）
 *   其余            AOE 椭圆（范围伤害类）
 *
 * 2.5D 约定：所有椭圆纵向压扁 0.5，与俯视视角一致。
 */

/** 虚线线宽：细线在复杂地形上看不清，固定用粗线 */
const DASH_LINE_WIDTH = 5;
const DASH_PATTERN = [8, 5];

export class AimPreviewRenderer {
  /**
   * 渲染瞄准预览。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} preview - { skill, color }
   * @param {{x:number,y:number}} startPos - 施法起点（玩家世界坐标）
   * @param {number} dirX - 归一化方向 X
   * @param {number} dirY - 归一化方向 Y
   * @param {number} distRatio - 距离比例（0~1.5，>1 表示超出射程）
   * @returns {{x:number,y:number}|null} 预览落点世界坐标（供释放时复用）
   */
  static render(ctx, preview, startPos, dirX, dirY, distRatio) {
    if (!preview || !preview.skill || !startPos) return null;
    const { skill, color } = preview;
    const range = skill.range || 300;
    const actualDist = distRatio * range;
    const startX = startPos.x;
    const startY = startPos.y;
    const dispX = startX + dirX * actualDist;
    const dispY = startY + dirY * actualDist;

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = DASH_LINE_WIDTH;
    ctx.setLineDash(DASH_PATTERN);

    if (skill.id === 'ice_finger') {
      this._renderPath(ctx, startX, startY, dispX, dispY);
    } else if (skill.id === 'ranged_attack') {
      this._renderEllipse(ctx, dispX, dispY, skill.aoeRadius || 20);
    } else {
      this._renderEllipse(ctx, dispX, dispY, skill.aoeRadius || 150);
    }

    this._renderCrosshair(ctx, dispX, dispY);
    ctx.restore();
    return { x: dispX, y: dispY };
  }

  /**
   * 渲染以指定世界坐标为中心的可达范围虚线椭圆。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - 范围中心世界坐标 X
   * @param {number} y - 范围中心世界坐标 Y
   * @param {number} radius - 世界半径
   * @param {string} [color] - 线条颜色
   */
  static renderRange(ctx, x, y, radius, color = '#ffc46b') {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(radius > 0)) return false;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = DASH_LINE_WIDTH;
    ctx.setLineDash(DASH_PATTERN);
    this._renderEllipse(ctx, x, y, radius);
    ctx.restore();
    return true;
  }

  /**
   * 在指定世界坐标渲染落点目标椭圆（虚线 + 十字准心）。
   * 供非瞄准模式的落点预览复用（如蓄力跳跃的预计落点圈）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - 落点世界坐标 X
   * @param {number} y - 落点世界坐标 Y
   * @param {number} radius - 椭圆半径（纵向自动压扁 0.5）
   * @param {string} [color] - 线条颜色
   * @returns {{x:number,y:number}} 落点坐标
   */
  static renderTarget(ctx, x, y, radius, color = '#00ff00') {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = DASH_LINE_WIDTH;
    ctx.setLineDash(DASH_PATTERN);
    this._renderEllipse(ctx, x, y, radius);
    this._renderCrosshair(ctx, x, y);
    ctx.restore();
    return { x, y };
  }

  /** @private 线性穿刺：路径矩形 + 终点椭圆 */
  static _renderPath(ctx, startX, startY, endX, endY) {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const nx = -dy / dist * 15;
      const ny = dx / dist * 15;
      ctx.beginPath();
      ctx.moveTo(startX + nx, startY + ny * 0.5);
      ctx.lineTo(endX + nx, endY + ny * 0.5);
      ctx.lineTo(endX - nx, endY - ny * 0.5);
      ctx.lineTo(startX - nx, startY - ny * 0.5);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(endX, endY, 50, 25, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** @private AOE 椭圆（2.5D 压扁） */
  static _renderEllipse(ctx, x, y, radius) {
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** @private 落点十字准心（实线，不受虚线影响） */
  static _renderCrosshair(ctx, x, y) {
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
  }
}

export default AimPreviewRenderer;

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-09-27
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 ************************************************************/

/**
 * GroundMarkerRenderer - 地面发光标记（框架级）
 *
 * 传送点与任务目标点的地面提示：2.5D 压扁的柔光椭圆 + 呼吸脉冲。
 * 在世界层背景之后、实体之前绘制，保证光圈贴地且被角色遮挡关系正确。
 * 纯表现组件：无生命周期数据，调用方每帧传入世界坐标与时间即可。
 *
 * 性能：径向渐变按颜色烘焙成离屏精灵（Map 缓存），每帧只做一次
 * drawImage 缩放——原实现每标记每帧 createRadialGradient，多个标记
 * 常驻时是稳定的每帧开销；缩放后的渐变衰减曲线与原渐变完全一致。
 */
export class GroundMarkerRenderer {
  /** 颜色 → 预烘焙柔光渐变精灵（256×256，中心亮边缘透明）。 */
  static _glowSpriteCache = new Map();

  /**
   * 绘制一个发光地面椭圆。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} params
   * @param {number} params.x - 世界坐标 X
   * @param {number} params.y - 世界坐标 Y
   * @param {number} [params.radius=32] - 光圈基础半径（世界像素）
   * @param {string} [params.color='126, 199, 255'] - RGB 通道串（如 '255, 213, 79'）
   * @param {number} [params.time=0] - 秒；驱动呼吸脉冲
   * @param {number} [params.squash=0.45] - 2.5D 纵向压扁比
   */
  static renderGlowEllipse(ctx, { x, y, radius = 32, color = '126, 199, 255', time = 0, squash = 0.45 }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const pulse = 0.82 + 0.18 * Math.sin(time * 2.4);
    const rx = Math.max(2, radius * pulse);
    const ry = rx * squash;
    const alpha = 0.42 + 0.18 * Math.sin(time * 2.4);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 外圈柔光：预烘焙渐变精灵按半径缩放（压扁比折进目标高度）
    const sprite = this._getGlowSprite(color);
    if (sprite) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2);
    } else {
      // 无 DOM（Node 测试环境）时回退逐帧渐变
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, squash);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      glow.addColorStop(0, `rgba(${color}, ${alpha})`);
      glow.addColorStop(0.65, `rgba(${color}, ${alpha * 0.4})`);
      glow.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 边界椭圆环（不参与压扁变换，避免线宽失真）
    ctx.strokeStyle = `rgba(${color}, ${Math.min(1, alpha + 0.3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 取（并懒烘焙）指定颜色的柔光渐变精灵；无 DOM 环境返回 null。
   * @private
   */
  static _getGlowSprite(color) {
    const cached = this._glowSpriteCache.get(color);
    if (cached !== undefined) return cached || null;
    if (typeof document === 'undefined' || !document.createElement) {
      this._glowSpriteCache.set(color, false);
      return null;
    }
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const gctx = canvas.getContext('2d');
    const half = size / 2;
    const gradient = gctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, `rgba(${color}, 1)`);
    gradient.addColorStop(0.65, `rgba(${color}, 0.4)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    gctx.fillStyle = gradient;
    gctx.fillRect(0, 0, size, size);
    this._glowSpriteCache.set(color, canvas);
    return canvas;
  }
}

export default GroundMarkerRenderer;

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-28
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * LightGlowRenderer - 物品点光晕渲染器（框架级，纯绘制无状态）
 *
 * 消费物品定义的 glow 块（library.items[].glow / placement overrides.glow）：
 *   { color, radius, intensity, flicker, yOffset }
 * 在世界层阴影之后、Y-sort 实体队列之前绘制（贴地层光晕，实体从光前走过关系正确）。
 * 同一批光源已由 SceneRenderPipeline 注入阴影点光源（半径内实体影子背光拉长影）。
 *
 * 全部为静态方法：调用方每帧传入世界坐标与时间，本类不持有任何游戏状态。
 */
export class LightGlowRenderer {
  /**
   * 归一化 glow 定义：非法/未配置（radius<=0）返回 null。
   * @param {Object} [glow] { color, radius, intensity, flicker, yOffset }
   * @returns {{color:string, radius:number, intensity:number, flicker:string, yOffset:number}|null}
   */
  static normalize(glow) {
    if (!glow || typeof glow !== 'object') return null;
    const radius = Number(glow.radius);
    if (!Number.isFinite(radius) || radius <= 0) return null;
    return {
      color: LightGlowRenderer.normalizeColor(glow.color, '255, 176, 87'),
      radius,
      intensity: Math.min(1, Math.max(0.05, Number.isFinite(glow.intensity) ? glow.intensity : 0.55)),
      flicker: glow.flicker === 'fire' || glow.flicker === 'breathe' ? glow.flicker : '',
      yOffset: Number.isFinite(glow.yOffset) ? glow.yOffset : 0
    };
  }

  /**
   * 颜色归一化为 'r, g, b' 通道串（供 rgba() 模板拼接）。
   * 支持 '#rgb' / '#rrggbb' / 'r,g,b'；非法回退 fallback。
   */
  static normalizeColor(color, fallback = '255, 176, 87') {
    if (typeof color !== 'string') return fallback;
    const value = color.trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (hex) {
      const digits = hex[1];
      const full = digits.length === 3
        ? digits.split('').map(ch => ch + ch).join('')
        : digits;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    const channels = value.replace(/\s+/g, '').split(',');
    if (channels.length === 3) {
      const [r, g, b] = channels.map(Number);
      if ([r, g, b].every(ch => Number.isFinite(ch) && ch >= 0 && ch <= 255)) {
        return `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
      }
    }
    return fallback;
  }

  /**
   * 闪烁因子（0..1，乘在强度上）：
   * - 'fire'：双正弦高频抖动（火苗摇曳，伪随机不重复感）
   * - 'breathe'：≈2.6s 慢正弦呼吸（萤火虫明灭）
   * - 其他：恒定 1
   * @param {string} flicker 'fire' | 'breathe' | ''
   * @param {number} timeMs performance.now() 毫秒
   * @returns {number}
   */
  static flickerFactor(flicker, timeMs) {
    const t = Number.isFinite(timeMs) ? timeMs : 0;
    if (flicker === 'fire') {
      return 0.84 + 0.1 * Math.sin(t / 47) + 0.06 * Math.sin(t / 113 + 1.7);
    }
    if (flicker === 'breathe') {
      return 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t / 2600 * Math.PI * 2));
    }
    return 1;
  }

  /**
   * 绘制一个点光源光晕：'lighter' 合成的径向渐变圆 + 小面积炽芯。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} params
   * @param {number} params.x - 光心世界 X
   * @param {number} params.y - 光心世界 Y（落点；配合 yOffset 抬升）
   * @param {number} params.radius - 光晕半径（世界 px）
   * @param {string} [params.color] - '#rrggbb' 或 'r,g,b'（缺省暖橙）
   * @param {number} [params.intensity=0.55] - 峰值强度 0..1
   * @param {string} [params.flicker] - 'fire' | 'breathe' | ''（稳定）
   * @param {number} [params.yOffset=0] - 光心垂直偏移 px（负=上移）
   * @param {number} [params.time=0] - performance.now() 毫秒（驱动闪烁）
   */
  static draw(ctx, params) {
    const { x, y, radius, color, intensity = 0.55, flicker = '', yOffset = 0, time = 0 } = params || {};
    if (!ctx || !Number.isFinite(x) || !Number.isFinite(y) || !(radius > 0)) return;
    const rgb = LightGlowRenderer.normalizeColor(color);
    const factor = LightGlowRenderer.flickerFactor(flicker, time);
    const alpha = Math.min(1, intensity * factor);
    if (alpha <= 0.01) return;
    const cy = y + (Number.isFinite(yOffset) ? yOffset : 0);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 主光晕：径向渐变（中心浓、半径 55% 后快速衰减到透明）
    const glow = ctx.createRadialGradient(x, cy, 0, x, cy, radius);
    glow.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    glow.addColorStop(0.55, `rgba(${rgb}, ${alpha * 0.32})`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    // 炽芯：小半径高浓度白化核心（火光/烛焰中心的过曝感，强度低时不画）
    if (alpha > 0.3) {
      const coreRadius = Math.max(2, radius * 0.14);
      const core = ctx.createRadialGradient(x, cy, 0, x, cy, coreRadius);
      core.addColorStop(0, `rgba(255, 250, 235, ${alpha * 0.75})`);
      core.addColorStop(0.7, `rgba(${rgb}, ${alpha * 0.5})`);
      core.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, cy, coreRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export default LightGlowRenderer;

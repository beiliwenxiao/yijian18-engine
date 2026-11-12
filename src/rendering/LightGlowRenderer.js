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
 * 由 SceneRenderPipeline 在**时间蒙版（atmosphere）之后**的屏幕层调用（夜里光要
 * 打穿夜色黑幕才看得见地面被照亮）；同一批光源也已注入阴影点光源（半径内实体
 * 影子背光拉长影）。
 *
 * 全部为静态方法：调用方每帧传入世界坐标与时间，本类不持有任何游戏状态。
 */
/** normalizeCached 的按 glow 对象缓存（glow 定义跨帧稳定，热路径免每帧对象+颜色串分配）。 */
const NORMALIZED_CACHE = new WeakMap();

/**
 * 光晕贴图烘焙参数：径向渐变 + 炽芯一次性画进 192×192 小图，之后每帧只 drawImage。
 * 半径按 4px 量化做缓存 key（视觉无差），条目上限 48（颜色×半径组合天然很少）。
 */
const SPRITE_SIZE = 192;
const SPRITE_CACHE_LIMIT = 48;
const glowSpriteCache = new Map();

/** 创建离屏画布；环境不支持（无 document / 无 OffscreenCanvas）返回 null。 */
function createGlowSpriteCanvas(size) {
  if (typeof OffscreenCanvas === 'function') {
    try { return new OffscreenCanvas(size, size); } catch (_error) { /* 退到 document 分支 */ }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }
  return null;
}

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
   * normalize 的热路径版本：按 glow 对象引用缓存归一化结果（WeakMap，随 glow 定义回收）。
   * glow 块来自物品定义/场景覆盖，跨帧稳定且不被原地修改——每帧重复归一化
   * （对象 + 颜色字符串分配）在发光物较多的场景会持续喂 GC。
   * 非法 glow 返回 null 但不缓存（与 normalize 语义一致，null 是合法瞬时结果）。
   */
  static normalizeCached(glow) {
    if (!glow || typeof glow !== 'object') return null;
    if (NORMALIZED_CACHE.has(glow)) return NORMALIZED_CACHE.get(glow);
    const normalized = LightGlowRenderer.normalize(glow);
    if (normalized) NORMALIZED_CACHE.set(glow, normalized);
    return normalized;
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
   * 绘制一个点光源光晕：优先用预烘焙贴图 drawImage（快），无 Canvas 环境回退渐变。
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

    // 首选：烘焙光晕贴图 + drawImage（每帧零渐变对象、零路径填充）
    const sprite = LightGlowRenderer.getGlowSprite(rgb, radius);
    if (sprite) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - radius, cy - radius, radius * 2, radius * 2);
      ctx.restore();
      return;
    }

    // 回退（无 Canvas 环境 / 烘焙失败）：即时径向渐变，行为与旧版一致
    LightGlowRenderer.paintGradientGlow(ctx, { x, cy, radius, rgb, alpha });
  }

  /**
   * 绘制即时渐变光晕（回退路径；视觉与烘焙贴图一致）。
   * @private
   */
  static paintGradientGlow(ctx, { x, cy, radius, rgb, alpha }) {
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

  /**
   * 取（或烘焙）光晕贴图：192×192 小图内画好「主光晕 + 炽芯」（alpha=1 基准），
   * 绘制时用 globalAlpha 调节强度/闪烁。半径按 4px 量化做 key，避免浮点半径打爆缓存。
   * @private
   */
  static getGlowSprite(rgb, radius) {
    const quantized = Math.max(8, Math.round(radius / 4) * 4);
    const key = `${rgb}|${quantized}`;
    if (glowSpriteCache.has(key)) return glowSpriteCache.get(key);
    if (glowSpriteCache.size >= SPRITE_CACHE_LIMIT) glowSpriteCache.clear();
    const canvas = createGlowSpriteCanvas(SPRITE_SIZE);
    const spriteCtx = canvas?.getContext?.('2d');
    if (!spriteCtx || typeof spriteCtx.createRadialGradient !== 'function') {
      glowSpriteCache.set(key, null);
      return null;
    }
    const center = SPRITE_SIZE / 2;
    const gradient = spriteCtx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, `rgba(${rgb}, 1)`);
    gradient.addColorStop(0.55, `rgba(${rgb}, 0.32)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    spriteCtx.fillStyle = gradient;
    spriteCtx.beginPath();
    spriteCtx.arc(center, center, center, 0, Math.PI * 2);
    spriteCtx.fill();
    // 炽芯：烘焙进贴图，绘制时随 globalAlpha 一起衰减
    const coreRadius = Math.max(2, center * 0.14);
    const core = spriteCtx.createRadialGradient(center, center, 0, center, center, coreRadius);
    core.addColorStop(0, 'rgba(255, 250, 235, 0.75)');
    core.addColorStop(0.7, `rgba(${rgb}, 0.5)`);
    core.addColorStop(1, `rgba(${rgb}, 0)`);
    spriteCtx.fillStyle = core;
    spriteCtx.beginPath();
    spriteCtx.arc(center, center, coreRadius, 0, Math.PI * 2);
    spriteCtx.fill();
    glowSpriteCache.set(key, canvas);
    return canvas;
  }
}

export default LightGlowRenderer;

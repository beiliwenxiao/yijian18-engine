/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-17
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * HudCanvasCache - 常驻 HUD 静态内容离屏缓存（框架级）
 *
 * 目标：游戏 HUD（时间/天气、战斗状态、任务框、头像等）的静态部分不逐帧重绘——
 * 内容键不变时每帧只做一次 drawImage blit；内容键、尺寸或屏幕密度变化时才重建。
 *
 * 用法（调用方持有 cache 实例，draw 闭包以 origin 参数书写绘制坐标）：
 *   const draw = (c, ox, oy) => { ...以 (ox, oy) 为盒子左上角绘制... };
 *   const cached = this._cache.get(key, width, height, c => draw(c, 0, 0));
 *   if (cached) ctx.drawImage(cached, x, y, width, height);  // 命中：一次 blit
 *   else draw(ctx, x, y);                                    // 未命中：直接绘制
 *
 * 降级：无 DOM / canvas 无 2D 上下文（如 jsdom 测试环境）时 get 返回 null，
 * 调用方走直接绘制路径，行为与未缓存一致。
 *
 * 清晰度：缓存画布按 devicePixelRatio（上限 2）超采样，blit 时显式给目标逻辑尺寸，
 * 高 DPI 屏幕上文字与主画布原生渲染同等清晰。
 */
export class HudCanvasCache {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.key = null;
    this.scale = 0;
  }

  /**
   * 取缓存画布。
   * @param {string} key - 内容键：所有影响绘制的输入（文本/状态/颜色/字体/尺寸）都应参与
   * @param {number} width - 逻辑宽度
   * @param {number} height - 逻辑高度
   * @param {(ctx: CanvasRenderingContext2D) => void} draw - 以 (0,0) 为盒子左上角的绘制闭包
   * @returns {HTMLCanvasElement|null} 命中或重建后的缓存画布；无 2D 上下文时返回 null
   */
  get(key, width, height, draw) {
    if (typeof document === 'undefined') return null;
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) {
        // jsdom 等无 canvas 实现的环境：放弃缓存，调用方走直接绘制
        this.canvas = null;
        return null;
      }
    }
    const scale = Math.max(1, Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    const backingWidth = Math.round(w * scale);
    const backingHeight = Math.round(h * scale);
    if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight || this.scale !== scale) {
      // 调整画布尺寸会清空内容：置空键强制重绘
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
      this.scale = scale;
      this.key = null;
    }
    if (this.key !== key) {
      const ctx = this.ctx;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w, h);
      draw(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.key = key;
    }
    return this.canvas;
  }

  /** 释放缓存（场景销毁/重建时调用可选）。 */
  reset() {
    this.canvas = null;
    this.ctx = null;
    this.key = null;
    this.scale = 0;
  }
}

export default HudCanvasCache;

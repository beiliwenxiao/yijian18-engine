/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * OcclusionFadeController - 大物件遮挡玩家时的渐隐渲染控制器（ARPG 通用体验）。
 *
 * 判定（扫描节流）：遮挡候选的屏幕世界 AABB 完全覆盖玩家「头部+躯干」两个采样点，
 * 且其 Y-sort 基线在玩家之后（视觉在玩家前方）→ 本扫描周期标记为遮挡。
 * 渲染：被遮挡物 alpha 向 targetAlpha 渐变，离开遮挡向 1 渐变（防闪烁）；
 * alpha 回到 ~1 且未遮挡的条目自动从跟踪表移除（无泄漏）。
 * 条目 key 用稳定的队列项对象 / ECS 实体（调用方保证稳定即可），控制器不做清理。
 */

const DEFAULTS = Object.freeze({
  targetAlpha: 0.5,     // 遮挡时的目标透明度
  fadeRate: 0.5,        // alpha 每秒变化速率（1→0.5 / 0.5→1 各约 1 秒完成）
  minArea: 96 * 96,     // 候选最小包围盒面积（px²）
  minHeight: 64,        // 候选最小高度（地面贴片不参与）
  scanIntervalMs: 100   // 遮挡重判节流
});

export class OcclusionFadeController {
  constructor(options = {}) {
    const config = { ...DEFAULTS, ...options };
    this.targetAlpha = config.targetAlpha;
    this.fadeRate = config.fadeRate;
    this.minArea = config.minArea;
    this.minHeight = config.minHeight;
    this.scanIntervalMs = config.scanIntervalMs;
    /** @type {Map<Object, {alpha:number}>} 稳定 key → 当前 alpha */
    this._tracked = new Map();
    /** @type {Set<Object>} 当前扫描周期被判定为遮挡的 key */
    this._occludedNow = new Set();
    this._lastScanAt = 0;
    this._lastUpdateAt = 0;
  }

  /**
   * 每帧调用：先按节流重判遮挡，再对所有跟踪条目做 alpha 渐变。
   * @param {Object|null} player { x, yFeet, height, sortY }（无玩家则全部回 1）
   * @param {Array<{key:Object, left:number, right:number, top:number, bottom:number, sortY:number}>} occluders
   */
  update(player, occluders, nowMs = performance.now()) {
    const dtSec = this._lastUpdateAt ? Math.min(0.1, (nowMs - this._lastUpdateAt) / 1000) : 0;
    this._lastUpdateAt = nowMs;
    if (nowMs - this._lastScanAt >= this.scanIntervalMs || !player) {
      this._lastScanAt = nowMs;
      this._rescan(player, occluders);
      for (const key of this._occludedNow) {
        if (!this._tracked.has(key)) this._tracked.set(key, { alpha: 1 });
      }
    }
    for (const [key, state] of this._tracked) {
      const target = this._occludedNow.has(key) ? this.targetAlpha : 1;
      if (state.alpha !== target) {
        const step = this.fadeRate * dtSec;
        state.alpha += Math.max(-step, Math.min(step, target - state.alpha));
      }
      if (!this._occludedNow.has(key) && state.alpha > 0.99) {
        this._tracked.delete(key); // 回到不透明即解除跟踪
      }
    }
  }

  /** @private 重判遮挡集合。 */
  _rescan(player, occluders) {
    this._occludedNow.clear();
    if (!player || !Array.isArray(occluders)) return;
    const headY = player.yFeet - player.height * 0.8;
    const torsoY = player.yFeet - player.height * 0.45;
    for (const item of occluders) {
      if (item.sortY <= player.sortY) continue; // 在玩家后方绘制（视觉在后），不构成遮挡
      if (player.x < item.left || player.x > item.right) continue;
      if (headY < item.top || headY > item.bottom) continue;
      if (torsoY < item.top || torsoY > item.bottom) continue;
      this._occludedNow.add(item.key);
    }
  }

  /** 取条目当前渲染 alpha（未跟踪 = 1）。 */
  alphaFor(key) {
    return this._tracked.get(key)?.alpha ?? 1;
  }
}

export default OcclusionFadeController;

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

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { HudCanvasCache } from './HudCanvasCache.js';

/** 伪造带 2D 上下文的 canvas：记录重绘/清屏次数，验证命中与重建逻辑。 */
function installFakeCanvasDocument() {
  const stats = { draw: 0, clearRect: 0, canvasCount: 0 };
  const contexts = [];
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    if (tag !== 'canvas') return originalCreateElement(tag);
    stats.canvasCount += 1;
    const ctx = {
      setTransform: () => {},
      clearRect: () => { stats.clearRect += 1; }
    };
    contexts.push(ctx);
    return {
      width: 0,
      height: 0,
      getContext: () => ctx
    };
  };
  return {
    stats,
    contexts,
    restore: () => { document.createElement = originalCreateElement; }
  };
}

describe('HudCanvasCache HUD 离屏缓存', () => {
  const restoreFakes = [];

  afterEach(() => {
    while (restoreFakes.length) restoreFakes.pop()();
  });

  it('jsdom 无 2D 上下文时返回 null，调用方走直接绘制回退', () => {
    const cache = new HudCanvasCache();
    let drawCalls = 0;
    const result = cache.get('key', 120, 40, () => { drawCalls += 1; });
    expect(result).toBeNull();
    expect(drawCalls).toBe(0);
  });

  it('同键重复 get 命中缓存：draw 只执行一次，返回同一画布', () => {
    const fake = installFakeCanvasDocument();
    restoreFakes.push(fake.restore);
    const cache = new HudCanvasCache();
    let drawCalls = 0;
    const draw = () => { drawCalls += 1; };
    const first = cache.get('k1', 100, 30, draw);
    const second = cache.get('k1', 100, 30, draw);
    const third = cache.get('k1', 100, 30, draw);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(drawCalls).toBe(1);
    expect(fake.stats.canvasCount).toBe(1);
  });

  it('内容键变化时重建：draw 再次执行', () => {
    const fake = installFakeCanvasDocument();
    restoreFakes.push(fake.restore);
    const cache = new HudCanvasCache();
    let drawCalls = 0;
    const draw = () => { drawCalls += 1; };
    cache.get('state-a', 100, 30, draw);
    cache.get('state-b', 100, 30, draw);
    expect(drawCalls).toBe(2);
  });

  it('尺寸变化时重建并调整画布 backing 尺寸（DPR 超采样）', () => {
    const fake = installFakeCanvasDocument();
    restoreFakes.push(fake.restore);
    const cache = new HudCanvasCache();
    let drawCalls = 0;
    const draw = () => { drawCalls += 1; };
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    cache.get('k', 100, 30, draw);
    expect(cache.canvas.width).toBe(Math.round(100 * dpr));
    expect(cache.canvas.height).toBe(Math.round(30 * dpr));
    cache.get('k', 200, 30, draw);
    expect(cache.canvas.width).toBe(Math.round(200 * dpr));
    expect(drawCalls).toBe(2);
  });

  it('reset 释放画布，下一次 get 走重建', () => {
    const fake = installFakeCanvasDocument();
    restoreFakes.push(fake.restore);
    const cache = new HudCanvasCache();
    let drawCalls = 0;
    const draw = () => { drawCalls += 1; };
    cache.get('k', 100, 30, draw);
    cache.reset();
    expect(cache.canvas).toBeNull();
    cache.get('k', 100, 30, draw);
    expect(drawCalls).toBe(2);
    expect(fake.stats.canvasCount).toBe(2);
  });
});

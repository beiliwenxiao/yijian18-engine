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

import { describe, expect, it, vi } from 'vitest';
import { LightGlowRenderer } from './LightGlowRenderer.js';

/** 绘制命令记录用假 ctx：径向渐变记录 stop，圆/填充只计数。 */
function createFakeCtx() {
  const gradients = [];
  return {
    gradients,
    globalCompositeOperation: 'source-over',
    fillStyle: null,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    createRadialGradient: vi.fn((x0, y0, r0, x1, y1, r1) => {
      const stops = [];
      gradients.push({ x0, y0, r0, x1, y1, r1, stops });
      return { addColorStop: (offset, color) => stops.push({ offset, color }) };
    })
  };
}

describe('LightGlowRenderer.normalize', () => {
  it('合法定义归一化：颜色转通道串、缺省强度/闪烁/偏移补齐', () => {
    const normalized = LightGlowRenderer.normalize({
      color: '#ff9a3e', radius: 160, intensity: 0.6, flicker: 'fire', yOffset: -26
    });
    expect(normalized).toEqual({
      color: '255, 154, 62', radius: 160, intensity: 0.6, flicker: 'fire', yOffset: -26
    });
  });

  it('radius<=0 或非对象视为不发光（返回 null）', () => {
    expect(LightGlowRenderer.normalize(null)).toBeNull();
    expect(LightGlowRenderer.normalize('glow')).toBeNull();
    expect(LightGlowRenderer.normalize({ radius: 0 })).toBeNull();
    expect(LightGlowRenderer.normalize({ radius: -5 })).toBeNull();
    expect(LightGlowRenderer.normalize({ radius: Number.NaN })).toBeNull();
  });

  it('缺省值与钳制：强度默认 0.55、越界钳到 [0.05,1]，非法 flicker 归稳定', () => {
    expect(LightGlowRenderer.normalize({ radius: 80 })).toMatchObject({
      color: '255, 176, 87', intensity: 0.55, flicker: '', yOffset: 0
    });
    expect(LightGlowRenderer.normalize({ radius: 80, intensity: 3 }).intensity).toBe(1);
    expect(LightGlowRenderer.normalize({ radius: 80, intensity: 0 }).intensity).toBe(0.05);
    expect(LightGlowRenderer.normalize({ radius: 80, flicker: 'sparkle' }).flicker).toBe('');
  });

  it('颜色格式：#rgb 短写展开、#rrggbb、r,g,b 通道串均接受，非法回退暖橙', () => {
    expect(LightGlowRenderer.normalizeColor('#a8f')).toBe('170, 136, 255');
    expect(LightGlowRenderer.normalizeColor('#A8FF9E')).toBe('168, 255, 158');
    expect(LightGlowRenderer.normalizeColor('200, 80, 40')).toBe('200, 80, 40');
    expect(LightGlowRenderer.normalizeColor('not-a-color')).toBe('255, 176, 87');
    expect(LightGlowRenderer.normalizeColor(undefined)).toBe('255, 176, 87');
  });
});

describe('LightGlowRenderer.flickerFactor', () => {
  it('fire：双正弦抖动，因子恒在 (0.6, 1] 内且随时间变化', () => {
    let sawDifferent = false;
    let previous = null;
    for (let t = 0; t < 10_000; t += 97) {
      const factor = LightGlowRenderer.flickerFactor('fire', t);
      expect(factor).toBeGreaterThan(0.6);
      expect(factor).toBeLessThanOrEqual(1);
      if (previous !== null && Math.abs(factor - previous) > 1e-4) sawDifferent = true;
      previous = factor;
    }
    expect(sawDifferent).toBe(true);
  });

  it('breathe：≈2.6s 呼吸，谷底≈0.62、峰顶≈1.0', () => {
    let min = 2;
    let max = -2;
    for (let t = 0; t < 2600; t += 13) {
      const factor = LightGlowRenderer.flickerFactor('breathe', t);
      min = Math.min(min, factor);
      max = Math.max(max, factor);
    }
    expect(min).toBeLessThan(0.66);
    expect(max).toBeGreaterThan(0.96);
  });

  it('未配置闪烁：恒定 1（稳定光）', () => {
    expect(LightGlowRenderer.flickerFactor('', 1234)).toBe(1);
    expect(LightGlowRenderer.flickerFactor(undefined, 0)).toBe(1);
  });
});

describe('LightGlowRenderer.draw', () => {
  it('绘制主光晕与炽芯：lighter 合成、渐变 stop 浓度递减、半径参数透传', () => {
    const ctx = createFakeCtx();
    LightGlowRenderer.draw(ctx, {
      x: 400, y: 500, radius: 160, color: '#ff9a3e', intensity: 0.6, flicker: 'fire', yOffset: -26, time: 500
    });
    expect(ctx.globalCompositeOperation).toBe('lighter');
    expect(ctx.gradients).toHaveLength(2); // 主光晕 + 炽芯
    const [halo] = ctx.gradients;
    expect(halo.x1).toBe(400);
    expect(halo.y1).toBe(500 - 26); // yOffset 抬升光心
    expect(halo.r1).toBe(160);
    expect(halo.stops[0].color).toContain('255, 154, 62');
    const coreAlpha = parseFloat(ctx.gradients[1].stops[0].color.match(/([\d.]+)\)$/)[1]);
    expect(coreAlpha).toBeGreaterThan(0.2); // 强度>0.3 才画炽芯
  });

  it('强度<=0.3 不画炽芯；非法参数（radius<=0/NaN 坐标）静默跳过', () => {
    const dim = createFakeCtx();
    LightGlowRenderer.draw(dim, { x: 0, y: 0, radius: 60, intensity: 0.14, time: 0 });
    expect(dim.gradients).toHaveLength(1);

    const invalid = createFakeCtx();
    LightGlowRenderer.draw(invalid, { x: 0, y: 0, radius: 0, time: 0 });
    LightGlowRenderer.draw(invalid, { x: Number.NaN, y: 0, radius: 60, time: 0 });
    LightGlowRenderer.draw(invalid, null);
    expect(invalid.gradients).toHaveLength(0);
    expect(invalid.beginPath).not.toHaveBeenCalled();
  });
});

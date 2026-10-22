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

import { describe, expect, it } from 'vitest';
import {
  sampleNumericCurve,
  sampleDiscreteCurve,
  sampleBooleanCurve,
  applyEase,
  lerp
} from './SkeletonCurve.js';

describe('applyEase 命名缓动', () => {
  it('linear 恒等', () => {
    expect(applyEase('linear', 0)).toBe(0);
    expect(applyEase('linear', 0.37)).toBeCloseTo(0.37);
    expect(applyEase('linear', 1)).toBe(1);
  });

  it('easeInOut 中点对称加速', () => {
    expect(applyEase('easeInOut', 0.5)).toBeCloseTo(0.5);
    expect(applyEase('easeInOut', 0.25)).toBeLessThan(0.25);
    expect(applyEase('easeInOut', 0.75)).toBeGreaterThan(0.75);
  });

  it('未知缓动名退化为线性', () => {
    expect(applyEase('unknown', 0.4)).toBeCloseTo(0.4);
  });
});

describe('sampleNumericCurve 基础插值', () => {
  const linear = [{ t: 0, v: 0 }, { t: 1000, v: 100 }];

  it('段内线性插值', () => {
    expect(sampleNumericCurve(linear, 0)).toBe(0);
    expect(sampleNumericCurve(linear, 500)).toBeCloseTo(50);
    expect(sampleNumericCurve(linear, 1000)).toBeCloseTo(100);
  });

  it('首键之前保持首值', () => {
    const keys = [{ t: 200, v: 7 }, { t: 400, v: 9 }];
    expect(sampleNumericCurve(keys, 0)).toBe(7);
    expect(sampleNumericCurve(keys, 200)).toBe(7);
  });

  it('末键之后保持末值（非循环）', () => {
    const keys = [{ t: 0, v: 1 }, { t: 100, v: 2 }];
    expect(sampleNumericCurve(keys, 500)).toBe(2);
  });

  it('空曲线返回 0', () => {
    expect(sampleNumericCurve([], 100)).toBe(0);
    expect(sampleNumericCurve(null, 100)).toBe(0);
  });

  it('单键曲线恒为该值', () => {
    const keys = [{ t: 500, v: 42 }];
    expect(sampleNumericCurve(keys, 0)).toBe(42);
    expect(sampleNumericCurve(keys, 500)).toBe(42);
    expect(sampleNumericCurve(keys, 900)).toBe(42);
  });

  it('easeInOut 作用于「结束于本键」的段', () => {
    const keys = [{ t: 0, v: 0 }, { t: 1000, v: 100, ease: 'easeInOut' }];
    // 25% 处：smoothstep(0.25) ≈ 0.15625 → 值 ≈ 15.6
    expect(sampleNumericCurve(keys, 250)).toBeCloseTo(15.625);
    // 首键无 ease 时取结束键的 ease
    const inherited = [{ t: 0, v: 0, ease: 'easeInOut' }, { t: 1000, v: 100 }];
    expect(sampleNumericCurve(inherited, 250)).toBeCloseTo(15.625);
  });

  it('hold 为真时该段为阶跃（保持起始键值）', () => {
    const keys = [{ t: 0, v: 10, hold: true }, { t: 1000, v: 100 }];
    expect(sampleNumericCurve(keys, 0)).toBe(10);
    expect(sampleNumericCurve(keys, 500)).toBe(10);
    expect(sampleNumericCurve(keys, 999)).toBe(10);
    expect(sampleNumericCurve(keys, 1000)).toBe(100);
  });
});

describe('sampleNumericCurve 贝塞尔控制点', () => {
  it('缺省控制点等价于线性', () => {
    const keys = [{ t: 0, v: 0 }, { t: 1000, v: 100 }];
    // 无 in/out → 走线性分支
    expect(sampleNumericCurve(keys, 333)).toBeCloseTo(33.3, 1);
  });

  it('对称缓入缓出控制点：中间段加速、两端减速', () => {
    // ≡ CSS cubic-bezier(0.42, 0, 0.58, 1)（Unity 约定：out={x:0.42,y:0}, in={x:0.42,y:0}）
    const keys = [
      { t: 0, v: 0, out: { x: 0.42, y: 0 } },
      { t: 1000, v: 100, in: { x: 0.42, y: 0 } }
    ];
    const early = sampleNumericCurve(keys, 100);
    const middle = sampleNumericCurve(keys, 500);
    const late = sampleNumericCurve(keys, 900);
    // 前 10% 时间的推进量 < 10%（缓入）
    expect(early).toBeLessThan(10);
    // 中点约 50%
    expect(middle).toBeCloseTo(50, 0);
    // 后 10% 时间的推进量 < 10%（缓出）
    expect(100 - late).toBeLessThan(10);
  });

  it('线性控制点（y 与 x 同比例）结果与线性一致', () => {
    const keys = [
      { t: 0, v: 0, out: { x: 1 / 3, y: 1 / 3 } },
      { t: 1000, v: 100, in: { x: 1 / 3, y: 1 / 3 } }
    ];
    expect(sampleNumericCurve(keys, 250)).toBeCloseTo(25, 1);
    expect(sampleNumericCurve(keys, 750)).toBeCloseTo(75, 1);
  });

  it('仅起始键有 out 控制点也生效', () => {
    const keys = [{ t: 0, v: 0, out: { x: 0.5, y: 0 } }, { t: 1000, v: 100 }];
    const early = sampleNumericCurve(keys, 100);
    expect(early).toBeLessThan(10);
  });

  it('仅结束键有 in 控制点也生效（末端减速）', () => {
    // in 控制点位于 (1-dx, 1-dy)：dx=0.42,y=0 → 控制点 (0.58,1) → 末端切线水平
    const keys = [{ t: 0, v: 0 }, { t: 1000, v: 100, in: { x: 0.42, y: 0 } }];
    const late = sampleNumericCurve(keys, 900);
    expect(100 - late).toBeLessThan(10);
  });

  it('控制点端点取值正确（u=0 与 u=1）', () => {
    const keys = [
      { t: 0, v: 0, out: { x: 0.42, y: 0 } },
      { t: 1000, v: 100, in: { x: 0.58, y: 1 } }
    ];
    expect(sampleNumericCurve(keys, 0)).toBeCloseTo(0);
    expect(sampleNumericCurve(keys, 1000)).toBeCloseTo(100);
  });
});

describe('sampleNumericCurve 循环回绕', () => {
  it('循环剪辑尾段向首帧插值（首尾姿态一致处无跳变）', () => {
    const keys = [{ t: 0, v: 0 }, { t: 500, v: 50 }];
    // t=1000 恰好等于 durationMs → 与首帧姿态相同
    expect(sampleNumericCurve(keys, 1000, true, 1000)).toBeCloseTo(0);
    // 尾段中点（750ms）：50 → 0 的中点 = 25
    expect(sampleNumericCurve(keys, 750, true, 1000)).toBeCloseTo(25);
  });

  it('非循环剪辑尾段保持末帧', () => {
    const keys = [{ t: 0, v: 0 }, { t: 500, v: 50 }];
    expect(sampleNumericCurve(keys, 1000, false, 1000)).toBeCloseTo(50);
  });

  it('末帧已贴剪辑结尾时不做回绕插值', () => {
    const keys = [{ t: 0, v: 0 }, { t: 1000, v: 100 }];
    expect(sampleNumericCurve(keys, 1000, true, 1000)).toBeCloseTo(100);
  });
});

describe('sampleDiscreteCurve 离散曲线', () => {
  const keys = [{ t: 0, v: 'a' }, { t: 500, v: 'b' }];

  it('段内保持上一键的值（阶跃）', () => {
    expect(sampleDiscreteCurve(keys, 0)).toBe('a');
    expect(sampleDiscreteCurve(keys, 250)).toBe('a');
    expect(sampleDiscreteCurve(keys, 500)).toBe('b');
    expect(sampleDiscreteCurve(keys, 900)).toBe('b');
  });

  it('空曲线返回 null', () => {
    expect(sampleDiscreteCurve([], 100)).toBeNull();
  });

  it('布尔曲线把离散值转 0/1', () => {
    const boolKeys = [{ t: 0, v: 1 }, { t: 500, v: 0 }];
    expect(sampleBooleanCurve(boolKeys, 100)).toBe(1);
    expect(sampleBooleanCurve(boolKeys, 600)).toBe(0);
    expect(sampleBooleanCurve([], 100)).toBe(0);
  });
});

describe('lerp', () => {
  it('线性插值', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});

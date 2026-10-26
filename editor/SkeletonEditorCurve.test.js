/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-26
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, it, expect } from 'vitest';
import {
  CURVE_PROPERTIES,
  HANDLE_PRESETS,
  HANDLE_Y_LIMIT,
  listPropertyKeys,
  computeValueRange,
  segmentControlPoints,
  keyHandlePoints,
  applyHandleDrag,
  applyOutPreset,
  sampleCurvePolyline
} from './SkeletonEditorCurve.js';
import { sampleNumericCurve } from '../src/animation/SkeletonCurve.js';

/** 三键轨道：x 全程有值、scaleX 只在中间键有值（半字段键）。 */
function buildTrack() {
  return {
    bone: 'child',
    keys: [
      { t: 0, x: 0, scaleX: null },
      { t: 500, x: 40, scaleX: 2 },
      { t: 1000, x: 100, scaleX: null }
    ]
  };
}

describe('listPropertyKeys（按属性分轨）', () => {
  it('过滤 null 字段、按 t 升序、保留 track.keys 原始下标', () => {
    const entries = listPropertyKeys(buildTrack(), 'x');
    expect(entries.map(entry => entry.v)).toEqual([0, 40, 100]);
    expect(entries.map(entry => entry.index)).toEqual([0, 1, 2]);
  });

  it('半字段键：scaleX 分轨只有中间键', () => {
    const entries = listPropertyKeys(buildTrack(), 'scaleX');
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({ index: 1, t: 500, v: 2 });
  });

  it('无轨道/空字段返回空数组', () => {
    expect(listPropertyKeys(null, 'x')).toEqual([]);
    expect(listPropertyKeys({ bone: 'a', keys: [] }, 'x')).toEqual([]);
  });
});

describe('computeValueRange', () => {
  it('min/max 各向外扩 15%', () => {
    const range = computeValueRange([{ v: 0 }, { v: 100 }]);
    expect(range.min).toBeCloseTo(-15);
    expect(range.max).toBeCloseTo(115);
  });

  it('等值退化时给 ±1 假跨度（单键/平直曲线也有可读网格）', () => {
    const range = computeValueRange([{ v: 90 }, { v: 90 }]);
    expect(range.min).toBeCloseTo(89);
    expect(range.max).toBeCloseTo(91);
  });

  it('空序列返回 {0,1}', () => {
    expect(computeValueRange([])).toEqual({ min: 0, max: 1 });
  });
});

describe('segmentControlPoints（控制点几何）', () => {
  it('out/in 控制点 = 键坐标 + 切线×(span,delta)', () => {
    const a = { t: 0, v: 0, key: { out: { x: 0.5, y: 0.5 } } };
    const b = { t: 100, v: 40, key: { in: { x: 0.25, y: 0.25 } } };
    const { p1, p2 } = segmentControlPoints(a, b);
    expect(p1).toEqual({ t: 50, v: 20 });
    expect(p2).toEqual({ t: 75, v: 30 }); // b.t − 0.25·100, b.v − 0.25·40
  });

  it('缺手柄侧返回 null；span<=0 两侧都无定义', () => {
    const a = { t: 0, v: 0, key: {} };
    const b = { t: 100, v: 40, key: {} };
    expect(segmentControlPoints(a, b).p1).toBeNull();
    expect(segmentControlPoints(a, b).p2).toBeNull();
    const same = { t: 50, v: 1, key: { out: { x: 0.5, y: 0 } } };
    const same2 = { t: 50, v: 2, key: {} };
    expect(segmentControlPoints(same, same2)).toEqual({ p1: null, p2: null });
  });
});

describe('keyHandlePoints（手柄命中坐标）', () => {
  const entries = listPropertyKeys(buildTrack(), 'x');

  it('无手柄的键两侧都为 null；首键无上一段、末键无下一段', () => {
    expect(keyHandlePoints(entries, 0).in).toBeNull();
    expect(keyHandlePoints(entries, 0).out).toBeNull();
    expect(keyHandlePoints(entries, 1).in).toBeNull();
    expect(keyHandlePoints(entries, 1).out).toBeNull();
    expect(keyHandlePoints(entries, 2).in).toBeNull();
    expect(keyHandlePoints(entries, 2).out).toBeNull();
  });

  it('有手柄时：中间键 out 取下一段 p1、in 取上一段 p2', () => {
    const scoped = listPropertyKeys(buildTrack(), 'x');
    scoped[1].key.out = { x: 0.5, y: 0.5 };
    scoped[1].key.in = { x: 0.25, y: 0.25 };
    const handles = keyHandlePoints(scoped, 1);
    // out 段：entry1→entry2 span=500 delta=60 → p1 = (500+250, 40+30)
    expect(handles.out).toEqual({ t: 750, v: 70 });
    // in 段：entry0→entry1 span=500 delta=40 → p2 = (500−125, 40−10)
    expect(handles.in).toEqual({ t: 375, v: 30 });
  });
});

describe('applyHandleDrag（拖拽写回）', () => {
  const a = { t: 0, v: 0, key: {} };
  const b = { t: 100, v: 40, key: {} };

  it('out 手柄：x 钳 [0,1]、y 钳 ±HANDLE_Y_LIMIT', () => {
    const handle = applyHandleDrag(a, b, 'out', 250, 200); // x=2.5 → 1；y=5 → 2
    expect(handle).toEqual({ x: 1, y: HANDLE_Y_LIMIT });
    expect(a.key.out).toEqual({ x: 1, y: HANDLE_Y_LIMIT });
  });

  it('in 手柄：x=(b.t−pointT)/span，写入 b.key.in', () => {
    const handle = applyHandleDrag(a, b, 'in', 75, 10); // x=(100−75)/100=0.25；y=(40−10)/40=0.75
    expect(handle).toEqual({ x: 0.25, y: 0.75 });
    expect(b.key.in).toEqual({ x: 0.25, y: 0.75 });
  });

  it('overshoot 允许 y 超出 [0,1]（预备/跟随动作），但不超过 ±2', () => {
    const handle = applyHandleDrag(a, b, 'out', 50, -40); // y=−1（向下预备）
    expect(handle.y).toBe(-1);
  });

  it('delta≈0（水平段）时 y 保留原值不被拖拽破坏', () => {
    const flat = { t: 0, v: 5, key: { out: { x: 0.3, y: 0.7 } } };
    const flatEnd = { t: 100, v: 5, key: {} };
    const handle = applyHandleDrag(flat, flatEnd, 'out', 50, 999);
    expect(handle).toEqual({ x: 0.5, y: 0.7 });
  });

  it('span<=0 返回 null 且不写入', () => {
    const s1 = { t: 50, v: 0, key: {} };
    const s2 = { t: 50, v: 10, key: {} };
    expect(applyHandleDrag(s1, s2, 'out', 60, 5)).toBeNull();
    expect(s1.key.out).toBeUndefined();
  });

  it('round-trip：拖拽写入的控制点经 segmentControlPoints 还原为鼠标点（两侧各自成立）', () => {
    const a = { t: 0, v: 0, key: {} };
    const b = { t: 100, v: 40, key: {} };
    applyHandleDrag(a, b, 'out', 60, 10);
    expect(segmentControlPoints(a, b).p1).toEqual({ t: 60, v: 10 });
    applyHandleDrag(a, b, 'in', 30, 50);
    expect(segmentControlPoints(a, b).p2).toEqual({ t: 30, v: 50 });
  });
});

describe('applyOutPreset（缓动预设）', () => {
  it('linear：删除段两端手柄与 hold', () => {
    const a = { key: { out: { x: 0.5, y: 0 }, hold: true } };
    const b = { key: { in: { x: 0.5, y: 0 } } };
    expect(applyOutPreset(a, b, 'linear')).toBe(true);
    expect(a.key.out).toBeUndefined();
    expect(a.key.hold).toBeUndefined();
    expect(b.key.in).toBeUndefined();
  });

  it('easeInOut：两端各写 {0.42,0}（CSS cubic-bezier(0.42,0,0.58,1)）', () => {
    const a = { key: {} };
    const b = { key: {} };
    applyOutPreset(a, b, 'easeInOut');
    expect(a.key.out).toEqual({ x: 0.42, y: 0 });
    expect(b.key.in).toEqual({ x: 0.42, y: 0 });
  });

  it('easeIn：慢起（out={0.42,0} + 末端 in={0,0}）；easeOut：快起慢收（out={0,0}）', () => {
    const a1 = { key: {} };
    const b1 = { key: {} };
    applyOutPreset(a1, b1, 'easeIn');
    expect(a1.key.out).toEqual({ x: 0.42, y: 0 });
    expect(b1.key.in).toEqual({ x: 0, y: 0 });
    const a2 = { key: {} };
    const b2 = { key: {} };
    applyOutPreset(a2, b2, 'easeOut');
    expect(a2.key.out).toEqual({ x: 0, y: 0 });
    expect(b2.key.in).toEqual({ x: 0.42, y: 0 });
  });

  it('hold：写 a.hold=true（段内恒为 a 值）', () => {
    const a = { key: {} };
    applyOutPreset(a, null, 'hold');
    expect(a.key.hold).toBe(true);
  });

  it('clear：只删本键 out 与 hold，不动下一键 in', () => {
    const a = { key: { out: { x: 0.5, y: 0 }, hold: true } };
    const b = { key: { in: { x: 0.5, y: 0 } } };
    applyOutPreset(a, b, 'clear');
    expect(a.key.out).toBeUndefined();
    expect(a.key.hold).toBeUndefined();
    expect(b.key.in).toEqual({ x: 0.5, y: 0 });
  });

  it('缓动预设无下一键时返回 false（不写入）', () => {
    const a = { key: {} };
    expect(applyOutPreset(a, null, 'easeInOut')).toBe(false);
    expect(a.key.out).toBeUndefined();
  });

  it('预设清单包含 6 项操作', () => {
    expect(HANDLE_PRESETS.map(preset => preset.id))
      .toEqual(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold', 'clear']);
  });
});

describe('sampleCurvePolyline（曲线采样——与引擎同语义）', () => {
  it('端点值正确：起点=首键值，终点=末键值（非循环 hold 末值）', () => {
    const entries = listPropertyKeys(buildTrack(), 'x');
    const polyline = sampleCurvePolyline(entries, 1000, false, 100);
    expect(polyline[0]).toEqual({ t: 0, v: 0 });
    expect(polyline[polyline.length - 1].v).toBe(100);
  });

  it('hold 段恒为起始键值（阶跃可视化）', () => {
    const entries = listPropertyKeys({
      bone: 'a',
      keys: [{ t: 0, x: 5, hold: true }, { t: 1000, x: 50 }]
    }, 'x');
    const polyline = sampleCurvePolyline(entries, 1000, false, 50);
    const mid = polyline.find(point => point.t >= 490 && point.t <= 510);
    expect(mid.v).toBe(5);
  });

  it('easeInOut 手柄段：中点=值域中点且与直接调用 sampleNumericCurve 一致', () => {
    const entries = listPropertyKeys({
      bone: 'a',
      keys: [{ t: 0, x: 0, out: { x: 0.42, y: 0 } }, { t: 1000, x: 100, in: { x: 0.42, y: 0 } }]
    }, 'x');
    const polyline = sampleCurvePolyline(entries, 1000, false, 100);
    const mid = polyline.find(point => point.t >= 495 && point.t <= 505);
    expect(mid.v).toBeCloseTo(50, 2);
    // 与引擎采样器逐点一致（编辑器预览=运行时）
    for (const point of polyline) {
      expect(point.v).toBeCloseTo(sampleNumericCurve(
        [{ t: 0, v: 0, out: { x: 0.42, y: 0 } }, { t: 1000, v: 100, in: { x: 0.42, y: 0 } }],
        point.t, false, 1000
      ), 5);
    }
  });

  it('循环剪辑：末段回插首键值（回绕点两侧平滑）', () => {
    const entries = listPropertyKeys({
      bone: 'a',
      keys: [{ t: 0, x: 0 }, { t: 500, x: 100 }]
    }, 'x');
    const polyline = sampleCurvePolyline(entries, 1000, true, 100);
    expect(polyline[polyline.length - 1].v).toBeCloseTo(0); // t=1000 回到首帧姿态
  });

  it('空序列返回空数组', () => {
    expect(sampleCurvePolyline([], 1000, false)).toEqual([]);
  });
});

describe('CURVE_PROPERTIES（属性分轨清单）', () => {
  it('覆盖全部 5 个姿态字段', () => {
    expect(CURVE_PROPERTIES.map(prop => prop.field))
      .toEqual(['x', 'y', 'rot', 'scaleX', 'scaleY']);
  });
});

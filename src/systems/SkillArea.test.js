/**
 * SkillArea.test.js
 * 技能影响区域（circle/rect/polygon）归一化与命中判定单元测试。
 */

import { describe, it, expect } from 'vitest';
import { resolveSkillArea, isPointInSkillArea } from './SkillArea.js';

describe('resolveSkillArea', () => {
  it('缺省/非法形状回退圆形，radius 兜底 150', () => {
    expect(resolveSkillArea({})).toEqual({ shape: 'circle', radius: 150 });
    expect(resolveSkillArea({ shape: 'hexagon' })).toEqual({ shape: 'circle', radius: 150 });
    expect(resolveSkillArea({ radius: 90 })).toEqual({ shape: 'circle', radius: 90 });
  });

  it('circle 从 shapeData.radius 读取', () => {
    expect(resolveSkillArea({ shape: 'circle', shapeData: { radius: 171 } }))
      .toEqual({ shape: 'circle', radius: 171 });
  });

  it('rect 归一化宽高并派生外接半径', () => {
    const area = resolveSkillArea({ shape: 'rect', shapeData: { width: 160, height: 120 } });
    expect(area.shape).toBe('rect');
    expect(area.width).toBe(160);
    expect(area.height).toBe(120);
    expect(area.radius).toBe(100); // hypot(160,120)/2 = 100
  });

  it('rect 尺寸过小回退圆形', () => {
    expect(resolveSkillArea({ shape: 'rect', shapeData: { width: 4, height: 4 } }).shape).toBe('circle');
  });

  it('polygon 保留顶点并派生外接半径', () => {
    const area = resolveSkillArea({ shape: 'polygon', shapeData: { points: [[0, -100], [100, 0], [0, 100], [-100, 0], [0, -100]] } });
    expect(area.shape).toBe('polygon');
    expect(area.points).toHaveLength(5);
    expect(area.radius).toBe(100);
  });

  it('polygon 顶点不足回退圆形', () => {
    expect(resolveSkillArea({ shape: 'polygon', shapeData: { points: [[0, 0], [10, 0]] } }).shape).toBe('circle');
  });
});

describe('isPointInSkillArea', () => {
  const circle = resolveSkillArea({ shape: 'circle', shapeData: { radius: 90 } });
  it('圆形：圆周内命中、外偏离', () => {
    expect(isPointInSkillArea(circle, 80, 0)).toBe(true);
    expect(isPointInSkillArea(circle, 90, 0)).toBe(true);
    expect(isPointInSkillArea(circle, 91, 0)).toBe(false);
    expect(isPointInSkillArea(circle, 0, 90)).toBe(true);
  });

  const rect = resolveSkillArea({ shape: 'rect', shapeData: { width: 160, height: 90 } });
  it('矩形：轴对齐判定（含边界），圆形半径外但矩形内的点也命中', () => {
    expect(isPointInSkillArea(rect, 80, 45)).toBe(true);
    expect(isPointInSkillArea(rect, 81, 0)).toBe(false);
    expect(isPointInSkillArea(rect, 0, 46)).toBe(false);
    // 关键差异点：距离 94 > 外接半径 100 内，但 (94, 0) 超出半宽 80 → 不命中
    expect(isPointInSkillArea(rect, 94, 0)).toBe(false);
    expect(isPointInSkillArea(rect, 60, 40)).toBe(true);
  });

  const polygon = resolveSkillArea({
    shape: 'polygon',
    shapeData: { points: [[0, -100], [100, 0], [0, 100], [-100, 0]] } // 菱形
  });
  it('多边形：射线法判定，菱形对角外的点不命中而边内命中', () => {
    expect(isPointInSkillArea(polygon, 0, 0)).toBe(true);
    expect(isPointInSkillArea(polygon, 50, 0)).toBe(true);
    expect(isPointInSkillArea(polygon, 90, 0)).toBe(true);
    // 菱形边界 |x|+|y| = 100：(60,60) 合计 120 > 100 → 对角方向在菱形外
    expect(isPointInSkillArea(polygon, 60, 60)).toBe(false);
    expect(isPointInSkillArea(polygon, 30, 30)).toBe(true);
  });
});

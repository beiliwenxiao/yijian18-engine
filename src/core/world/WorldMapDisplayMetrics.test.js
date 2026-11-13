import { describe, expect, it } from 'vitest';
import {
  WORLD_MAP_DISPLAY_CELL_WIDTH,
  WORLD_MAP_DISPLAY_SCALE,
  computeWorldMapDisplayMetrics
} from './WorldMapDisplayMetrics.js';

describe('WorldMapDisplayMetrics 编辑器 / 游戏内大地图共用尺寸来源', () => {
  const mainland = { cols: 20, rows: 20, chunkWidth: 1280, chunkHeight: 720 };

  it('按 region 格数与 chunk 尺寸换算格子尺度与整图边界', () => {
    const metrics = computeWorldMapDisplayMetrics(mainland);
    expect(WORLD_MAP_DISPLAY_SCALE).toBe(0.2);
    expect(WORLD_MAP_DISPLAY_CELL_WIDTH).toBe(256);
    expect(metrics.cellWidth).toBe(256);
    expect(metrics.cellHeight).toBe(144);
    expect(metrics.mapWidth).toBe(5120);
    expect(metrics.mapHeight).toBe(2880);
    expect(metrics.aspect).toBeCloseTo(25600 / 14400);
  });

  it('非 16:9 的 chunk 也按同一比例换算，长宽比与格子尺寸一致', () => {
    const metrics = computeWorldMapDisplayMetrics({ cols: 3, rows: 2, chunkWidth: 1000, chunkHeight: 1000 });
    expect(metrics.cellWidth).toBe(200);
    expect(metrics.cellHeight).toBe(200);
    expect(metrics.mapWidth).toBe(600);
    expect(metrics.mapHeight).toBe(400);
  });

  it('缺字段时回退到默认 chunk 尺寸且不抛错', () => {
    const metrics = computeWorldMapDisplayMetrics({});
    expect(metrics.cols).toBe(0);
    expect(metrics.rows).toBe(0);
    expect(metrics.cellWidth).toBe(256);
    expect(metrics.cellHeight).toBe(144);
    expect(metrics.mapWidth).toBe(0);
    expect(metrics.mapHeight).toBe(0);
  });
});

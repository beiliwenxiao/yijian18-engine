import { describe, it, expect } from 'vitest';
import {
  getWorldMapCellPoi,
  isWorldMapPoi,
  isWorldMapRoadCell,
  normalizeWorldMapRoadEdges,
  WORLD_MAP_POI_TYPES
} from './WorldMapCell.js';

describe('WorldMapCell 道路/落点声明（4E 数据层）', () => {
  it('POI 只接受 canonical 落点类型', () => {
    expect(WORLD_MAP_POI_TYPES).toEqual(['pass', 'ferry']);
    expect(isWorldMapPoi('pass')).toBe(true);
    expect(isWorldMapPoi('ferry')).toBe(true);
    expect(isWorldMapPoi('bridge')).toBe(false);
    expect(isWorldMapPoi('')).toBe(false);
    expect(isWorldMapPoi(null)).toBe(false);
    expect(isWorldMapPoi(1)).toBe(false);
  });

  it('getWorldMapCellPoi 未声明或非法值返回 null', () => {
    expect(getWorldMapCellPoi({ terrain: 'plain', poi: 'pass' })).toBe('pass');
    expect(getWorldMapCellPoi({ terrain: 'plain', poi: 'ferry' })).toBe('ferry');
    expect(getWorldMapCellPoi({ terrain: 'plain', poi: 'bridge' })).toBeNull();
    expect(getWorldMapCellPoi({ terrain: 'plain' })).toBeNull();
    expect(getWorldMapCellPoi(null)).toBeNull();
    expect(getWorldMapCellPoi('S09')).toBeNull();
    expect(getWorldMapCellPoi(['pass'])).toBeNull();
  });

  it('isWorldMapRoadCell 缺省即非道路格（旧地图不受影响）', () => {
    expect(isWorldMapRoadCell({ terrain: 'plain', road: true })).toBe(true);
    expect(isWorldMapRoadCell({ terrain: 'plain' })).toBe(false);
    expect(isWorldMapRoadCell({ terrain: 'plain', road: 'yes' })).toBe(false);
    expect(isWorldMapRoadCell(null)).toBe(false);
    expect(isWorldMapRoadCell(undefined)).toBe(false);
  });

  it('normalizeWorldMapRoadEdges 归一化合法格对', () => {
    expect(normalizeWorldMapRoadEdges([
      [[6, 12], [6, 13]],
      [[0, 0], [19, 19]]
    ])).toEqual([
      [[6, 12], [6, 13]],
      [[0, 0], [19, 19]]
    ]);
  });

  it('normalizeWorldMapRoadEdges 丢弃非法项与重复边（含反向）', () => {
    expect(normalizeWorldMapRoadEdges([
      [[6, 12], [6, 13]],
      [[6, 13], [6, 12]],
      [[6, 12], [6, 12]],
      [[6, 12], [6]],
      [[6, 12], [-1, 3]],
      [[6, 12], ['6', 3]],
      'not-an-edge',
      null,
      [[1, 1], [2, 2]]
    ])).toEqual([
      [[6, 12], [6, 13]],
      [[1, 1], [2, 2]]
    ]);
  });

  it('normalizeWorldMapRoadEdges 对旧地图缺字段返回空数组', () => {
    expect(normalizeWorldMapRoadEdges(undefined)).toEqual([]);
    expect(normalizeWorldMapRoadEdges(null)).toEqual([]);
    expect(normalizeWorldMapRoadEdges({})).toEqual([]);
  });

  it('旧地图格（只有 terrain/sceneId）按无道路、无 POI 读取', () => {
    const legacy = { terrain: 'plain', sceneId: 'S09' };
    expect(isWorldMapRoadCell(legacy)).toBe(false);
    expect(getWorldMapCellPoi(legacy)).toBeNull();
  });
});

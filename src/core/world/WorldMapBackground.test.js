import { describe, expect, it } from 'vitest';
import {
  WORLD_MAP_BACKGROUND_TILE_PATTERN,
  isWorldMapBackgroundFile,
  normalizeWorldMapBackgroundPath,
  resolveWorldMapBackgroundPaths,
  resolveWorldMapBackgroundTilePath
} from './WorldMapBackground.js';

describe('WorldMapBackground 底图命名与切分', () => {
  it('按 1-based 两位补零命名，行列顺序固定', () => {
    expect(WORLD_MAP_BACKGROUND_TILE_PATTERN).toBe('tile_r{row:02}_c{col:02}.jpg');
    const dir = 'fixtures/tiles_20x20';
    expect(resolveWorldMapBackgroundTilePath(dir, 0, 0))
      .toBe('fixtures/tiles_20x20/tile_r01_c01.jpg');
    expect(resolveWorldMapBackgroundTilePath(dir, 19, 19))
      .toBe('fixtures/tiles_20x20/tile_r20_c20.jpg');
  });

  it('目录归一化去空白/反斜杠/尾斜杠；未配置或坐标非法返回空串', () => {
    expect(normalizeWorldMapBackgroundPath(' fixtures\\tiles_20x20/ '))
      .toBe('fixtures/tiles_20x20');
    expect(resolveWorldMapBackgroundTilePath('', 0, 0)).toBe('');
    expect(resolveWorldMapBackgroundTilePath('fixtures/tiles_20x20', -1, 0)).toBe('');
  });

  it('按文件/目录区分整图与切图两种模式', () => {
    expect(isWorldMapBackgroundFile('assets/images/big_map_3.png')).toBe(true);
    expect(isWorldMapBackgroundFile('assets/images/big_map_3.JPG')).toBe(true);
    expect(isWorldMapBackgroundFile('fixtures/tiles_20x20')).toBe(false);
    expect(resolveWorldMapBackgroundPaths('assets/images/big_map_3.png', 20, 20))
      .toEqual(['assets/images/big_map_3.png']);
    const paths = resolveWorldMapBackgroundPaths('fixtures/tiles_20x20', 2, 2);
    expect(paths).toHaveLength(4);
    expect(paths[0]).toBe('fixtures/tiles_20x20/tile_r01_c01.jpg');
    expect(paths[3]).toBe('fixtures/tiles_20x20/tile_r02_c02.jpg');
  });
});

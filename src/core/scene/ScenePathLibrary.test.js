/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { ScenePathLibrary } from './ScenePathLibrary.js';

/** 构造带 _sceneDataRaw + worldOffset 的假 terrain（照 collectBuffZones 消费约定） */
function makeTerrain(paths, offset = { x: 0, y: 0 }) {
  const terrain = { worldOffset: offset };
  if (paths !== undefined) terrain._sceneDataRaw = { id: 'S01', paths };
  return terrain;
}

describe('ScenePathLibrary.collectPaths', () => {
  it('投影 points 到世界坐标（加 worldOffset），点序保持不变', () => {
    const terrain = makeTerrain(
      [{ id: 'p1', name: '入场', points: [[10, 20], [30, 40]] }],
      { x: 1000, y: 2000 }
    );
    const { paths } = ScenePathLibrary.collectPaths([terrain]);
    expect(paths).toHaveLength(1);
    expect(paths[0].id).toBe('p1');
    expect(paths[0].name).toBe('入场');
    expect(paths[0].points).toEqual([
      { x: 1010, y: 2020 },
      { x: 1030, y: 2040 }
    ]);
  });

  it('缺省颜色补 #b48cff；显式 color 透传', () => {
    const terrain = makeTerrain([
      { id: 'a', points: [[0, 0], [1, 1]] },
      { id: 'b', color: '#ff0000', points: [[0, 0], [1, 1]] }
    ]);
    const { paths } = ScenePathLibrary.collectPaths([terrain]);
    expect(paths[0].color).toBe('#b48cff');
    expect(paths[1].color).toBe('#ff0000');
  });

  it('同 id 跨 chunk 以先载入为准（流式加载重复注入去重）', () => {
    const first = makeTerrain([{ id: 'same', points: [[0, 0], [1, 1]] }]);
    const second = makeTerrain([{ id: 'same', points: [[9, 9], [9, 9]] }]);
    const { paths } = ScenePathLibrary.collectPaths([first, second]);
    expect(paths).toHaveLength(1);
    expect(paths[0].points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('缺 id / 点数 <2 / 非法坐标的条目跳过，无 paths 的场景跳过', () => {
    const terrain = makeTerrain([
      { points: [[0, 0], [1, 1]] },                    // 缺 id
      { id: 'ok', points: [[0, 0], [1, 1]] },          // 合法
      { id: 'bad', points: [[0, 0]] },                 // 点数 <2
      { id: 'nan', points: [[0, 0], ['x', 1]] },       // 非法坐标
      { id: 'empty' }                                  // 无 points
    ]);
    const noPaths = makeTerrain({ id: 'S02' }); // paths 非数组 → 场景无 paths 字段等价
    const { paths, loadedCount, total } = ScenePathLibrary.collectPaths([terrain, noPaths]);
    expect(paths).toHaveLength(1);
    expect(paths[0].id).toBe('ok');
    expect(loadedCount).toBe(2);
    expect(total).toBe(2);
  });

  it('无 _sceneDataRaw 的 terrain 不计入 loadedCount；非数组入参容错', () => {
    const bare = {};
    const { paths, loadedCount, total } = ScenePathLibrary.collectPaths([bare]);
    expect(paths).toHaveLength(0);
    expect(loadedCount).toBe(0);
    expect(total).toBe(1);
    expect(ScenePathLibrary.collectPaths(null)).toEqual({ paths: [], loadedCount: 0, total: 0 });
  });
});

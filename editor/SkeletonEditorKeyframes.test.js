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
import { upsertKey, appendLoopTieKey, KEY_TIME_EPSILON } from './SkeletonEditorKeyframes.js';

const makeTrack = (keys = []) => ({ bone: 'root', keys: keys.map(key => ({ ...key })) });

describe('upsertKey 缓动语义', () => {
  it('已有帧在调用方未指定 ease 时保留原缓动（不抹成 linear）', () => {
    const track = makeTrack([{ t: 0, x: 0, y: 0, rot: 0, ease: 'easeInOut' }]);
    upsertKey(track, { t: 0, x: 10 }, {});
    expect(track.keys[0].ease).toBe('easeInOut');
    expect(track.keys[0].x).toBe(10);
  });

  it('调用方显式指定 ease 时覆盖原值', () => {
    const track = makeTrack([{ t: 0, x: 0, y: 0, rot: 0, ease: 'easeInOut' }]);
    upsertKey(track, { t: 0, x: 10, ease: 'linear' }, {});
    expect(track.keys[0].ease).toBe('linear');
  });

  it('新帧继承同轨道前一帧的缓动', () => {
    const track = makeTrack([
      { t: 0, x: 0, y: 0, rot: 0, ease: 'easeInOut' },
      { t: 100, x: 5, y: 0, rot: 0, ease: 'easeInOut' }
    ]);
    upsertKey(track, { t: 200, x: 9 }, {});
    expect(track.keys.find(key => key.t === 200).ease).toBe('easeInOut');
  });

  it('轨道首帧无缓动时新帧用 linear 兜底', () => {
    const track = makeTrack([]);
    upsertKey(track, { t: 0, x: 1 }, {});
    expect(track.keys[0].ease).toBe('linear');
  });

  it('新帧补全为完整姿态快照（缺省字段取采样值）', () => {
    const track = makeTrack([]);
    upsertKey(track, { t: 0, rot: 30 }, { x: 7, y: 8, rot: 0, sx: 2, sy: 3 });
    const key = track.keys[0];
    expect(key.x).toBe(7);
    expect(key.y).toBe(8);
    expect(key.rot).toBe(30);
    expect(key.scaleX).toBe(2);
    expect(key.scaleY).toBe(3);
  });

  it('时间容差内的帧视为同一帧（更新而非新增）', () => {
    const track = makeTrack([{ t: 100, x: 0, y: 0, rot: 0, ease: 'easeInOut' }]);
    upsertKey(track, { t: 100 + KEY_TIME_EPSILON, x: 42 }, {});
    expect(track.keys.length).toBe(1);
    expect(track.keys[0].x).toBe(42);
    expect(track.keys[0].ease).toBe('easeInOut');
  });

  it('新帧按时间插入并保持有序', () => {
    const track = makeTrack([
      { t: 0, x: 0, y: 0, rot: 0 },
      { t: 200, x: 2, y: 0, rot: 0 }
    ]);
    upsertKey(track, { t: 100, x: 1 }, {});
    expect(track.keys.map(key => key.t)).toEqual([0, 100, 200]);
  });
});

describe('appendLoopTieKey 循环闭合帧', () => {
  it('补尾帧：姿态=首帧，缓动沿用首帧', () => {
    const track = makeTrack([
      { t: 0, x: 3, y: 4, rot: 5, scaleX: 1, scaleY: 1, ease: 'easeInOut' },
      { t: 400, x: 9, y: 9, rot: 0, scaleX: 1, scaleY: 1, ease: 'easeInOut' }
    ]);
    expect(appendLoopTieKey(track, 800)).toBe(true);
    const tail = track.keys.find(key => key.t === 800);
    expect(tail.x).toBe(3);
    expect(tail.y).toBe(4);
    expect(tail.rot).toBe(5);
    expect(tail.ease).toBe('easeInOut');
  });

  it('已有结尾帧则跳过（不覆盖美术已调姿态）', () => {
    const track = makeTrack([
      { t: 0, x: 0, y: 0, rot: 0 },
      { t: 800, x: 7, y: 7, rot: 7 }
    ]);
    expect(appendLoopTieKey(track, 800)).toBe(false);
    expect(track.keys.length).toBe(2);
    expect(track.keys[1].x).toBe(7);
  });

  it('空轨道不补', () => {
    expect(appendLoopTieKey(makeTrack([]), 800)).toBe(false);
  });
});

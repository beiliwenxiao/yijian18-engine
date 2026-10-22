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
import { buildIkChain, defaultIkTarget, collectIkRotations } from './SkeletonEditorIk.js';

const BONES = [
  { id: 'root', parent: null },
  { id: 'hip', parent: 'root' },
  { id: 'thigh', parent: 'hip' },
  { id: 'calf', parent: 'thigh' },
  { id: 'foot', parent: 'calf' }
];

describe('buildIkChain', () => {
  it('链长=总根数：从末骨向上取，返回根→末顺序', () => {
    expect(buildIkChain(BONES, 'calf', 1)).toEqual(['calf']);
    expect(buildIkChain(BONES, 'calf', 2)).toEqual(['thigh', 'calf']);
    expect(buildIkChain(BONES, 'calf', 3)).toEqual(['hip', 'thigh', 'calf']);
  });

  it('链长上限 4 根', () => {
    expect(buildIkChain(BONES, 'foot', 10)).toEqual(['hip', 'thigh', 'calf', 'foot']);
  });

  it('祖先不足时链到根为止', () => {
    expect(buildIkChain(BONES, 'hip', 3)).toEqual(['root', 'hip']);
  });

  it('未知骨骼返回空链', () => {
    expect(buildIkChain(BONES, 'ghost', 2)).toEqual([]);
    expect(buildIkChain([], 'root', 1)).toEqual([]);
  });
});

describe('defaultIkTarget', () => {
  it('沿骨骼自身朝向前伸', () => {
    expect(defaultIkTarget({ x: 10, y: 20, rad: 0 }, 30)).toEqual({ x: 40, y: 20 });
  });

  it('朝向 90° 时前伸到 +y', () => {
    const target = defaultIkTarget({ x: 0, y: 0, rad: Math.PI / 2 }, 30);
    expect(target.x).toBeCloseTo(0);
    expect(target.y).toBeCloseTo(30);
  });

  it('缺骨骼世界变换时回退原点', () => {
    expect(defaultIkTarget(null)).toEqual({ x: 0, y: 0 });
  });
});

describe('collectIkRotations', () => {
  const solved = new Map([
    ['a', { rot: 45.123 }],
    ['b', { rot: 10 }]
  ]);

  it('挑出变化超过阈值的骨并保留一位小数', () => {
    const result = collectIkRotations(solved, ['a', 'b'], () => 0);
    expect(result.get('a')).toBe(45.1);
    expect(result.get('b')).toBe(10);
  });

  it('变化小于阈值的骨被忽略（不刷关键帧）', () => {
    const result = collectIkRotations(solved, ['a'], () => 45.1);
    expect(result.size).toBe(0);
  });

  it('解算结果里没有的骨被忽略', () => {
    const result = collectIkRotations(solved, ['ghost'], () => 0);
    expect(result.size).toBe(0);
  });

  it('阈值为 0 时任何变化都写入', () => {
    const result = collectIkRotations(solved, ['a'], () => 45.1, 0);
    expect(result.get('a')).toBe(45.1);
  });
});

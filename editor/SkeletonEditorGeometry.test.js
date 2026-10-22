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
import { followScale, boneLengthTipWorld, anchorWorldForOffset } from './SkeletonEditorGeometry.js';

const BONE_WORLD = { x: 10, y: 20, rot: 0, rad: 0, sx: 2, sy: 3 };

describe('followScale 挂图跟随模式', () => {
  it('noScale（缺省）不跟随骨骼缩放', () => {
    expect(followScale('noScale', BONE_WORLD)).toEqual({ sx: 1, sy: 1 });
    expect(followScale(undefined, BONE_WORLD)).toEqual({ sx: 1, sy: 1 });
  });

  it('bone 完全跟随骨骼缩放', () => {
    expect(followScale('bone', BONE_WORLD)).toEqual({ sx: 2, sy: 3 });
  });

  it('缺骨骼变换时退化为 1', () => {
    expect(followScale('bone', null)).toEqual({ sx: 1, sy: 1 });
  });
});

describe('boneLengthTipWorld 骨骼长度末端', () => {
  it('沿骨骼自身方向（rad=0 → +x）按 length 延伸', () => {
    const tip = boneLengthTipWorld({ length: 30 }, { x: 0, y: 0, rad: 0, sx: 1, sy: 1 });
    expect(tip.x).toBeCloseTo(30);
    expect(tip.y).toBeCloseTo(0);
  });

  it('世界缩放会放大长度端的实际距离（骨架比例）', () => {
    const tip = boneLengthTipWorld({ length: 30 }, { x: 0, y: 0, rad: 0, sx: 2, sy: 2 });
    expect(tip.x).toBeCloseTo(60);
  });

  it('length 缺省或过小时按 2 兜底（不塌缩为 0）', () => {
    const tip = boneLengthTipWorld({}, { x: 0, y: 0, rad: 0, sx: 1, sy: 1 });
    expect(tip.x).toBeCloseTo(2);
    const tiny = boneLengthTipWorld({ length: 0.5 }, { x: 0, y: 0, rad: 0, sx: 1, sy: 1 });
    expect(tiny.x).toBeCloseTo(2);
  });

  it('旋转 90° 时长度端指向 +y', () => {
    const tip = boneLengthTipWorld({ length: 10 }, { x: 0, y: 0, rad: Math.PI / 2, sx: 1, sy: 1 });
    expect(tip.x).toBeCloseTo(0);
    expect(tip.y).toBeCloseTo(10);
  });
});

describe('anchorWorldForOffset 挂点锚点', () => {
  it('noScale 时偏移不被骨骼缩放放大', () => {
    const anchor = anchorWorldForOffset({ x: 0, y: 0, rad: 0, sx: 2, sy: 2 }, { x: 10, y: 0 }, 'noScale');
    expect(anchor.x).toBeCloseTo(10);
    expect(anchor.y).toBeCloseTo(0);
  });

  it('bone 时偏移随骨骼缩放放大', () => {
    const anchor = anchorWorldForOffset({ x: 0, y: 0, rad: 0, sx: 2, sy: 2 }, { x: 10, y: 0 }, 'bone');
    expect(anchor.x).toBeCloseTo(20);
  });

  it('偏移经骨骼旋转（+x 偏移在 90° 旋转后指向 +y）', () => {
    const anchor = anchorWorldForOffset({ x: 0, y: 0, rad: Math.PI / 2, sx: 1, sy: 1 }, { x: 10, y: 0 }, 'noScale');
    expect(anchor.x).toBeCloseTo(0);
    expect(anchor.y).toBeCloseTo(10);
  });
});

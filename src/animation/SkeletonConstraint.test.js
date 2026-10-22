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
import { parseSkeletonAsset } from './SkeletonAsset.js';
import { applyTransformConstraints } from './SkeletonConstraint.js';

function makeAnchor(id, x, y, angle = 0) {
  return { slot: { id }, x, y, angle };
}

describe('applyTransformConstraints 挂件跟随挂件', () => {
  it('跟随者锚点移到目标锚点', () => {
    const anchors = [makeAnchor('target', 100, 50), makeAnchor('follower', 0, 0)];
    applyTransformConstraints(anchors, [
      { type: 'transform', slot: 'follower', target: 'target', mix: 1 }
    ]);
    expect(anchors[1].x).toBeCloseTo(100);
    expect(anchors[1].y).toBeCloseTo(50);
  });

  it('mix=0.5 只靠拢一半', () => {
    const anchors = [makeAnchor('target', 100, 0), makeAnchor('follower', 0, 0)];
    applyTransformConstraints(anchors, [
      { type: 'transform', slot: 'follower', target: 'target', mix: 0.5 }
    ]);
    expect(anchors[1].x).toBeCloseTo(50);
  });

  it('mix=0 不动', () => {
    const anchors = [makeAnchor('target', 100, 0), makeAnchor('follower', 10, 0)];
    applyTransformConstraints(anchors, [
      { type: 'transform', slot: 'follower', target: 'target', mix: 0 }
    ]);
    expect(anchors[1].x).toBeCloseTo(10);
  });

  it('偏移按目标朝向旋转', () => {
    // 目标朝向 90°（+y）→ 偏移 (10,0) 转到 (0,10)
    const anchors = [makeAnchor('target', 0, 0, Math.PI / 2), makeAnchor('follower', 0, 0)];
    applyTransformConstraints(anchors, [
      { type: 'transform', slot: 'follower', target: 'target', offsetX: 10, offsetY: 0, mix: 1 }
    ]);
    expect(anchors[1].x).toBeCloseTo(0);
    expect(anchors[1].y).toBeCloseTo(10);
  });

  it('followRotation=true 时朝向跟随目标（带偏移角）', () => {
    const anchors = [makeAnchor('target', 0, 0, Math.PI / 2), makeAnchor('follower', 0, 0, 0)];
    applyTransformConstraints(anchors, [
      { type: 'transform', slot: 'follower', target: 'target', followRotation: true, mix: 1 }
    ]);
    expect(anchors[1].angle).toBeCloseTo(Math.PI / 2);
  });

  it('followRotation=false 时朝向不变', () => {
    const anchors = [makeAnchor('target', 0, 0, Math.PI / 2), makeAnchor('follower', 0, 0, 0.3)];
    applyTransformConstraints(anchors, [
      { type: 'transform', slot: 'follower', target: 'target', followRotation: false, mix: 1 }
    ]);
    expect(anchors[1].angle).toBeCloseTo(0.3);
  });

  it('引用不存在的槽位时安全忽略', () => {
    const anchors = [makeAnchor('follower', 10, 10)];
    applyTransformConstraints(anchors, [
      { type: 'transform', slot: 'follower', target: 'ghost', mix: 1 }
    ]);
    expect(anchors[0].x).toBeCloseTo(10);
  });

  it('parseSkeletonAsset 解析约束（缺省 mix=1）', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.constraint',
      bones: [{ id: 'root', parent: null }],
      slots: [
        { id: 'a', bone: 'root', attachment: { type: 'empty' } },
        { id: 'b', bone: 'root', attachment: { type: 'empty' } }
      ],
      clips: [],
      constraints: [{ type: 'transform', slot: 'b', target: 'a', offsetX: 5 }]
    });
    expect(skeleton.constraints.length).toBe(1);
    expect(skeleton.constraints[0].slot).toBe('b');
    expect(skeleton.constraints[0].target).toBe('a');
    expect(skeleton.constraints[0].mix).toBe(1);
    expect(skeleton.constraints[0].offsetX).toBe(5);
    expect(skeleton.constraints[0].followRotation).toBe(true);
  });

  it('解析时丢弃缺 slot/target 的非法约束', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.constraint2',
      bones: [{ id: 'root', parent: null }],
      slots: [{ id: 'a', bone: 'root', attachment: { type: 'empty' } }],
      clips: [],
      constraints: [{ type: 'transform', slot: 'a' }, { type: 'transform', target: 'a' }]
    });
    expect(skeleton.constraints.length).toBe(0);
  });
});

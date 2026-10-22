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
import { createRestLocalPose, composeWorldTransforms } from './SkeletonPose.js';
import {
  normalizeDeg,
  shortestDeltaDeg,
  lerpDeg,
  createIkConstraint,
  resolveIkChain,
  applyIkConstraints,
  evaluatePoseWithIk
} from './SkeletonIk.js';

/**
 * 三骨链：root(0,0) → upper(0,-50) → fore(0,-40)。
 * 子骨偏移刻意用垂直方向（不沿父骨 x 轴），验证 CCD 对任意偏移都收敛。
 */
function buildChain() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.ik',
    meta: { width: 100, height: 160 },
    bones: [
      { id: 'root', parent: null, x: 0, y: 0, rot: 0, length: 20 },
      { id: 'upper', parent: 'root', x: 0, y: -50, rot: 0, length: 20 },
      { id: 'fore', parent: 'upper', x: 0, y: -40, rot: 0, length: 20 }
    ],
    slots: [],
    clips: []
  });
}

function evaluate(skeleton) {
  const local = createRestLocalPose(skeleton);
  const world = composeWorldTransforms(skeleton, local);
  return { local, world };
}

describe('角度工具', () => {
  it('normalizeDeg 归一到 (-180,180]', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(360)).toBe(0);
  });

  it('shortestDeltaDeg 取最短角差', () => {
    expect(shortestDeltaDeg(170, -170)).toBeCloseTo(20);
    expect(shortestDeltaDeg(0, 90)).toBeCloseTo(90);
    expect(shortestDeltaDeg(0, -90)).toBeCloseTo(-90);
  });

  it('lerpDeg 走最短弧插值', () => {
    expect(lerpDeg(0, 90, 0.5)).toBeCloseTo(45);
    // 170 → -170 走 +20 的短弧 → 中点 180（与 -180 同角，规范化落在 (-180,180]）
    expect(Math.abs(lerpDeg(170, -170, 0.5))).toBeCloseTo(180);
    expect(lerpDeg(10, 20, 0)).toBeCloseTo(10);
    expect(lerpDeg(10, 20, 1)).toBeCloseTo(20);
  });
});

describe('createIkConstraint', () => {
  it('补齐缺省并裁剪 mix', () => {
    const constraint = createIkConstraint({ bones: ['upper'], target: { x: 1, y: 2 } });
    expect(constraint.type).toBe('aim');
    expect(constraint.mix).toBe(1);
    expect(constraint.iterations).toBe(4);
    expect(constraint.target).toEqual({ x: 1, y: 2 });
  });

  it('mix 超界收敛到 [0,1]；非法类型回落 aim', () => {
    expect(createIkConstraint({ bones: ['a'], target: { x: 0, y: 0 }, mix: 5 }).mix).toBe(1);
    expect(createIkConstraint({ bones: ['a'], target: { x: 0, y: 0 }, mix: -2 }).mix).toBe(0);
    expect(createIkConstraint({ bones: ['a'], target: { x: 0, y: 0 }, type: 'weird' }).type).toBe('aim');
  });

  it('缺骨骼链或缺目标返回 null', () => {
    expect(createIkConstraint({ target: { x: 0, y: 0 } })).toBeNull();
    expect(createIkConstraint({ bones: ['a'] })).toBeNull();
    expect(createIkConstraint(null)).toBeNull();
  });
});

describe('resolveIkChain', () => {
  it('连续父子链通过', () => {
    const skeleton = buildChain();
    expect(resolveIkChain(['root', 'upper', 'fore'], skeleton)).toEqual(['root', 'upper', 'fore']);
  });

  it('非连续链（跳骨）判非法', () => {
    const skeleton = buildChain();
    expect(resolveIkChain(['root', 'fore'], skeleton)).toEqual([]);
  });

  it('未知骨骼判非法', () => {
    const skeleton = buildChain();
    expect(resolveIkChain(['upper', 'ghost'], skeleton)).toEqual([]);
  });
});

describe('applyIkConstraints · 朝向 IK（aim）', () => {
  it('单骨链：骨骼朝向对齐目标方向', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    // upper 原点 (0,-50)，目标在右下方 (50,0) → 期望世界朝向 45°（y 向下）
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'aim', bones: ['upper'], target: { x: 50, y: 0 } }
    ]);
    expect(solved.get('upper').rot).toBeCloseTo(45);
  });

  it('offsetAngle 偏移目标方向', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'aim', bones: ['upper'], target: { x: 50, y: 0 }, offsetAngle: 90 }
    ]);
    expect(solved.get('upper').rot).toBeCloseTo(135);
  });

  it('多骨链：根骨对齐目标，链内相对偏角保持不变', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.ik2',
      bones: [
        { id: 'root', parent: null, x: 0, y: 0 },
        { id: 'a', parent: 'root', x: 0, y: -50, rot: 0 },
        { id: 'b', parent: 'a', x: 0, y: -40, rot: 30 }
      ],
      slots: [],
      clips: []
    });
    const { local, world } = evaluate(skeleton);
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'aim', bones: ['a', 'b'], target: { x: 100, y: -50 } }
    ]);
    // 根骨 a 对齐目标方向（0°）；b 相对 a 的 30° 偏角保持 → b 局部 rot 仍为 30
    expect(solved.get('a').rot).toBeCloseTo(0);
    expect(solved.get('b').rot).toBeCloseTo(30);
  });

  it('mix=0 保持纯 FK 姿势', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'aim', bones: ['upper'], target: { x: 50, y: 0 }, mix: 0 }
    ]);
    expect(solved.get('upper').rot).toBeCloseTo(local.get('upper').rot);
  });

  it('mix=0.5 走最短弧半混合', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'aim', bones: ['upper'], target: { x: 50, y: 0 }, mix: 0.5 }
    ]);
    expect(solved.get('upper').rot).toBeCloseTo(22.5);
  });

  it('入参姿势不被修改（返回新 Map）', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const before = local.get('upper').rot;
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'aim', bones: ['upper'], target: { x: 50, y: 0 } }
    ]);
    expect(local.get('upper').rot).toBe(before);
    expect(solved).not.toBe(local);
  });

  it('非法骨链不产生任何改动（root 不是 upper 的子骨）', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'aim', bones: ['upper', 'root'], target: { x: 10, y: 10 } }
    ]);
    expect(solved.get('upper').rot).toBeCloseTo(local.get('upper').rot);
  });
});

describe('applyIkConstraints · 位置 IK（twoBone / CCD）', () => {
  it('链末端命中可达目标点', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    // upper 原点 (0,-50)，fore 距 upper 40 → 可达目标 (40,-50)
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'twoBone', bones: ['upper', 'fore'], target: { x: 40, y: -50 }, iterations: 8 }
    ]);
    const solvedWorld = composeWorldTransforms(skeleton, solved);
    expect(solvedWorld.get('fore').x).toBeCloseTo(40);
    expect(solvedWorld.get('fore').y).toBeCloseTo(-50);
  });

  it('超出可达范围时链伸直指向目标方向', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'twoBone', bones: ['upper', 'fore'], target: { x: 200, y: -50 }, iterations: 8 }
    ]);
    const solvedWorld = composeWorldTransforms(skeleton, solved);
    // 链伸直：fore 位于 upper→target 的连线上，距离 = 链长 40
    expect(solvedWorld.get('fore').x).toBeCloseTo(40);
    expect(solvedWorld.get('fore').y).toBeCloseTo(-50);
  });

  it('mix=0 时链保持 FK 姿势', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const solved = applyIkConstraints(skeleton, local, world, [
      { type: 'twoBone', bones: ['upper', 'fore'], target: { x: 40, y: -50 }, mix: 0, iterations: 8 }
    ]);
    const solvedWorld = composeWorldTransforms(skeleton, solved);
    expect(solvedWorld.get('fore').x).toBeCloseTo(0);
    expect(solvedWorld.get('fore').y).toBeCloseTo(-90);
  });
});

describe('evaluatePoseWithIk', () => {
  it('返回应用 IK 后的局部姿势与世界变换', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const result = evaluatePoseWithIk(skeleton, local, world, [
      { type: 'aim', bones: ['upper'], target: { x: 50, y: 0 } }
    ]);
    expect(result.local.get('upper').rot).toBeCloseTo(45);
    expect(result.world.get('upper').rot).toBeCloseTo(45);
  });

  it('无约束时原样返回（同一引用）', () => {
    const skeleton = buildChain();
    const { local, world } = evaluate(skeleton);
    const result = evaluatePoseWithIk(skeleton, local, world, []);
    expect(result.local).toBe(local);
    expect(result.world).toBe(world);
  });
});

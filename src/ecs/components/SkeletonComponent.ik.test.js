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
import { parseSkeletonAsset } from '../../animation/SkeletonAsset.js';
import { SkeletonComponent } from './SkeletonComponent.js';

/** root(0,0) → upper(0,-50) → fore(0,-40) */
function buildSkeleton() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.ik',
    meta: { width: 100, height: 160 },
    bones: [
      { id: 'root', parent: null, x: 0, y: 0, length: 20 },
      { id: 'upper', parent: 'root', x: 0, y: -50, length: 20 },
      { id: 'fore', parent: 'upper', x: 0, y: -40, length: 20 }
    ],
    slots: [],
    clips: [{ name: 'idle', durationMs: 1000, loop: true, tracks: [] }]
  });
}

function buildComponent() {
  const component = new SkeletonComponent({ skeletonId: 'skeleton.ik' });
  component.setSkeletonAsset(buildSkeleton());
  return component;
}

describe('SkeletonComponent IK 约束', () => {
  it('无 IK 约束时世界姿态等于纯 FK', () => {
    const component = buildComponent();
    const pose = component.getWorldPose();
    expect(pose.get('upper').rot).toBeCloseTo(0);
    expect(pose.get('fore').y).toBeCloseTo(-90);
  });

  it('写入 aim 约束后骨骼朝向对齐目标', () => {
    const component = buildComponent();
    component.setIkConstraints([
      { id: 'aim-upper', type: 'aim', bones: ['upper'], target: { x: 50, y: 0 } }
    ]);
    const pose = component.getWorldPose();
    expect(pose.get('upper').rot).toBeCloseTo(45);
  });

  it('setIkTarget 更新目标并刷新姿态缓存', () => {
    const component = buildComponent();
    component.setIkConstraints([
      { id: 'aim-upper', type: 'aim', bones: ['upper'], target: { x: 50, y: 0 } }
    ]);
    expect(component.getWorldPose().get('upper').rot).toBeCloseTo(45);
    expect(component.setIkTarget('aim-upper', 0, -100)).toBe(true);
    expect(component.getWorldPose().get('upper').rot).toBeCloseTo(-90);
  });

  it('setIkTarget 命中不到约束时返回 false', () => {
    const component = buildComponent();
    component.setIkConstraints([
      { id: 'aim-upper', type: 'aim', bones: ['upper'], target: { x: 50, y: 0 } }
    ]);
    expect(component.setIkTarget('ghost', 0, 0)).toBe(false);
  });

  it('twoBone 约束让链末端命中目标', () => {
    const component = buildComponent();
    component.setIkConstraints([
      { id: 'ik-hand', type: 'twoBone', bones: ['upper', 'fore'], target: { x: 40, y: -50 }, iterations: 8 }
    ]);
    const pose = component.getWorldPose();
    expect(pose.get('fore').x).toBeCloseTo(40);
    expect(pose.get('fore').y).toBeCloseTo(-50);
  });

  it('清空约束后回到纯 FK', () => {
    const component = buildComponent();
    component.setIkConstraints([
      { id: 'aim-upper', type: 'aim', bones: ['upper'], target: { x: 50, y: 0 } }
    ]);
    expect(component.getWorldPose().get('upper').rot).toBeCloseTo(45);
    component.setIkConstraints([]);
    expect(component.getWorldPose().get('upper').rot).toBeCloseTo(0);
  });

  it('非法骨链的约束被安全忽略', () => {
    const component = buildComponent();
    component.setIkConstraints([
      { id: 'bad', type: 'aim', bones: ['upper', 'root'], target: { x: 50, y: 0 } }
    ]);
    expect(component.getWorldPose().get('upper').rot).toBeCloseTo(0);
  });
});

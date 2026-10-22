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

function buildSkeleton() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.bake',
    meta: { width: 100, height: 160 },
    bones: [
      { id: 'root', parent: null, x: 0, y: 0, length: 20 },
      { id: 'bone', parent: 'root', x: 0, y: -50, length: 20 }
    ],
    slots: [],
    clips: [{
      name: 'walk',
      durationMs: 1000,
      loop: false,
      tracks: [{
        bone: 'bone',
        keys: [
          { t: 0, x: 0, y: -50, rot: 0, scaleX: 1, scaleY: 1, ease: 'linear' },
          { t: 500, x: 20, y: -30, rot: 45, scaleX: 1.2, scaleY: 1, ease: 'linear' },
          { t: 1000, x: 0, y: -50, rot: 0, scaleX: 1, scaleY: 1, ease: 'linear' }
        ]
      }]
    }]
  });
}

function buildComponent() {
  const component = new SkeletonComponent({ skeletonId: 'skeleton.bake' });
  component.setSkeletonAsset(buildSkeleton());
  component.playClip('walk');
  return component;
}

describe('SkeletonComponent 曲线烘焙路径', () => {
  it('烘焙采样与关键帧采样的世界姿态一致（误差 < 0.01）', () => {
    const baked = buildComponent();
    const direct = buildComponent();
    direct.useBakedClips = false;
    for (const time of [0, 137, 500, 733, 1000]) {
      baked.clipTime = time;
      direct.clipTime = time;
      baked.markPoseDirty();
      direct.markPoseDirty();
      const a = baked.getWorldPose().get('bone');
      const b = direct.getWorldPose().get('bone');
      expect(Math.abs(a.x - b.x)).toBeLessThan(0.01);
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.01);
      expect(Math.abs(a.rot - b.rot)).toBeLessThan(0.01);
    }
  });

  it('无轨道骨骼仍以静止姿态参与世界组合', () => {
    const component = buildComponent();
    component.clipTime = 400;
    component.markPoseDirty();
    const pose = component.getWorldPose();
    expect(pose.has('root')).toBe(true);
    expect(pose.get('root').x).toBeCloseTo(0);
    expect(pose.get('root').y).toBeCloseTo(0);
  });

  it('烘焙表懒构建且按剪辑缓存', () => {
    const component = buildComponent();
    component.clipTime = 100;
    component.markPoseDirty();
    component.getWorldPose();
    expect(component._bakedClips.size).toBe(1);
    component.getWorldPose();
    expect(component._bakedClips.size).toBe(1);
  });

  it('换资产时烘焙表清空', () => {
    const component = buildComponent();
    component.clipTime = 100;
    component.markPoseDirty();
    component.getWorldPose();
    expect(component._bakedClips.size).toBe(1);
    component.setSkeletonAsset(buildSkeleton());
    expect(component._bakedClips.size).toBe(0);
  });
});

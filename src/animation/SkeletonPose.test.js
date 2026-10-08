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

import { describe, it, expect } from 'vitest';
import { parseSkeletonAsset } from './SkeletonAsset.js';
import { createRestLocalPose, sampleClip, composeWorldTransforms, evaluateSkeletonPose, applyEase } from './SkeletonPose.js';

/** 两骨骨架：root(0,0) → child(0,-50)，child 带 90° 旋转关键帧。 */
function buildSkeleton() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.test',
    meta: { width: 100, height: 160 },
    bones: [
      { id: 'root', parent: null, x: 0, y: 0 },
      { id: 'child', parent: 'root', x: 0, y: -50, length: 20 }
    ],
    slots: [],
    clips: [
      {
        name: 'turn',
        durationMs: 1000,
        loop: false,
        tracks: [
          {
            bone: 'child',
            keys: [
              { t: 0, rot: 0 },
              { t: 1000, rot: 90 }
            ]
          }
        ]
      }
    ]
  });
}

describe('parseSkeletonAsset', () => {
  it('归一化骨骼索引与拓扑顺序（父在子前）', () => {
    const skeleton = buildSkeleton();
    expect(skeleton.boneOrder).toEqual(['root', 'child']);
    expect(skeleton.bones.get('child').parent).toBe('root');
  });

  it('未知父引用回退为根；槽位按 z 排序', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.test',
      bones: [
        { id: 'a', parent: 'ghost' },
        { id: 'b', parent: 'a' }
      ],
      slots: [
        { id: 'far', bone: 'a', z: 5, attachment: { type: 'empty' } },
        { id: 'near', bone: 'a', z: -1, attachment: { type: 'empty' } }
      ],
      clips: []
    });
    expect(skeleton.bones.get('a').parent).toBeNull();
    expect(skeleton.slots.map(slot => slot.id)).toEqual(['near', 'far']);
  });

  it('无骨骼文档返回 null', () => {
    expect(parseSkeletonAsset({ bones: [] })).toBeNull();
    expect(parseSkeletonAsset(null)).toBeNull();
  });
});

describe('sampleClip', () => {
  it('关键帧线性插值 + 时间钳制', () => {
    const skeleton = buildSkeleton();
    const rest = createRestLocalPose(skeleton);
    const clip = skeleton.clips.get('turn');
    expect(sampleClip(clip, 500, rest).get('child').rot).toBeCloseTo(45);
    expect(sampleClip(clip, -50, rest).get('child').rot).toBe(0);
    expect(sampleClip(clip, 99999, rest).get('child').rot).toBe(90);
  });

  it('无轨道骨骼回退静止姿态', () => {
    const skeleton = buildSkeleton();
    const rest = createRestLocalPose(skeleton);
    const pose = sampleClip(skeleton.clips.get('turn'), 500, rest);
    expect(pose.get('root')).toEqual(rest.get('root'));
  });

  it('缺省字段回退静止值（关键帧只写 rot）', () => {
    const skeleton = buildSkeleton();
    const rest = createRestLocalPose(skeleton);
    const pose = sampleClip(skeleton.clips.get('turn'), 500, rest);
    expect(pose.get('child').x).toBe(0);
    expect(pose.get('child').y).toBe(-50);
  });
});

describe('composeWorldTransforms', () => {
  it('父旋转 90° 时子局部 (0,-50) 映射为世界 (50,0)（y 向下坐标系）', () => {
    const skeleton = buildSkeleton();
    const local = createRestLocalPose(skeleton);
    local.get('root').rot = 90;
    const world = composeWorldTransforms(skeleton, local);
    const child = world.get('child');
    expect(child.x).toBeCloseTo(50);
    expect(child.y).toBeCloseTo(0);
    expect(child.rot).toBe(90);
  });

  it('父缩放传播到子', () => {
    const skeleton = buildSkeleton();
    const local = createRestLocalPose(skeleton);
    local.get('root').sx = 2;
    local.get('root').sy = 2;
    local.get('child').x = 10;
    const world = composeWorldTransforms(skeleton, local);
    expect(world.get('child').x).toBeCloseTo(20);
    expect(world.get('child').sx).toBeCloseTo(2);
  });

  it('evaluateSkeletonPose 端到端：clip 采样结果进入世界变换', () => {
    const skeleton = buildSkeleton();
    const clip = skeleton.clips.get('turn');
    const { world } = evaluateSkeletonPose(skeleton, clip, 1000);
    const child = world.get('child');
    // child 自身 rot=90：不影响自身位置（仍在父空间 (0,-50)），只改变自身朝向
    expect(child.x).toBeCloseTo(0);
    expect(child.y).toBeCloseTo(-50);
    expect(child.rad).toBeCloseTo(Math.PI / 2);
  });
});

describe('applyEase', () => {
  it('linear 恒等；easeInOut 中点加速对称', () => {
    expect(applyEase('linear', 0.5)).toBe(0.5);
    expect(applyEase('easeInOut', 0.5)).toBeCloseTo(0.5);
    expect(applyEase('easeInOut', 0.25)).toBeLessThan(0.25);
    expect(applyEase('easeInOut', 0.75)).toBeGreaterThan(0.75);
  });
});

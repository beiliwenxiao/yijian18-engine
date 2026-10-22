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
import { createRestLocalPose, sampleClip } from './SkeletonPose.js';
import { bakeClip, sampleBakedClip } from './SkeletonBake.js';

function buildClip() {
  return parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.bake',
    meta: { width: 100, height: 160 },
    bones: [
      { id: 'root', parent: null, x: 0, y: 0 },
      { id: 'bone', parent: 'root', x: 0, y: -50 }
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

describe('bakeClip 曲线预烘焙', () => {
  it('产出结构：每根有轨道的骨骼一条 Float32Array 列组', () => {
    const skeleton = buildClip();
    const rest = createRestLocalPose(skeleton);
    const baked = bakeClip(skeleton.clips.get('walk'), rest, { stepMs: 20 });
    expect(baked.name).toBe('walk');
    expect(baked.durationMs).toBe(1000);
    expect(baked.stepMs).toBe(20);
    expect(baked.bones.length).toBe(1);
    const bone = baked.bones[0];
    expect(bone.id).toBe('bone');
    expect(bone.count).toBe(51);
    expect(bone.x.length).toBe(51);
  });

  it('烘焙值与引擎采样一致（误差 < 1）', () => {
    const skeleton = buildClip();
    const rest = createRestLocalPose(skeleton);
    const clip = skeleton.clips.get('walk');
    const baked = bakeClip(clip, rest, { stepMs: 20 });
    let worstScale = 0;
    for (let time = 0; time <= 1000; time += 10) {
      const expected = sampleClip(clip, time, rest).get('bone');
      const actual = sampleBakedClip(baked, time, new Map()).get('bone');
      expect(Math.abs(actual.x - expected.x)).toBeLessThan(1);
      expect(Math.abs(actual.y - expected.y)).toBeLessThan(1);
      expect(Math.abs(actual.rot - expected.rot)).toBeLessThan(1);
      const scaleError = Math.abs(actual.sx - expected.sx);
      if (scaleError > worstScale) worstScale = scaleError;
    }
    // 误差只应来自 Float32 存储精度（~1e-7），插值本身与引擎采样一致
    expect(worstScale).toBeLessThan(0.001);
  });

  it('循环剪辑按周期回绕采样', () => {
    const skeleton = buildClip();
    const rest = createRestLocalPose(skeleton);
    const clip = { ...skeleton.clips.get('walk'), loop: true };
    const baked = bakeClip(clip, rest, { stepMs: 20 });
    const at1200 = sampleBakedClip(baked, 1200, new Map()).get('bone');
    const at200 = sampleBakedClip(baked, 200, new Map()).get('bone');
    expect(Math.abs(at1200.x - at200.x)).toBeLessThan(1);
  });

  it('复用输出 Map：重复采样写回同一对象', () => {
    const skeleton = buildClip();
    const rest = createRestLocalPose(skeleton);
    const baked = bakeClip(skeleton.clips.get('walk'), rest, { stepMs: 20 });
    const out = new Map();
    const first = sampleBakedClip(baked, 0, out);
    const pose = first.get('bone');
    sampleBakedClip(baked, 500, out);
    expect(out.get('bone')).toBe(pose);
    expect(pose.x).toBeCloseTo(20, 0);
  });

  it('无轨道剪辑产出空骨骼列表', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.empty',
      bones: [{ id: 'root', parent: null }],
      slots: [],
      clips: [{ name: 'idle', durationMs: 500, loop: true, tracks: [] }]
    });
    const rest = createRestLocalPose(skeleton);
    const baked = bakeClip(skeleton.clips.get('idle'), rest, { stepMs: 20 });
    expect(baked.bones.length).toBe(0);
    expect(sampleBakedClip(baked, 100, new Map()).size).toBe(0);
  });
});

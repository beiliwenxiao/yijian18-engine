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

  it('缺省继承模式=normal、缺省挂件跟随=noScale（拖骨骼缩放不拉伸图片）', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.defaults',
      bones: [{ id: 'a', parent: null }],
      slots: [{ id: 's', bone: 'a', attachment: { type: 'empty' } }],
      clips: []
    });
    expect(skeleton.bones.get('a').inherit).toBe('normal');
    expect(skeleton.slots[0].follow).toBe('noScale');
  });

  it('显式声明的继承模式与跟随模式被解析保留', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.explicit',
      bones: [{ id: 'a', parent: null, inherit: 'translationOnly' }],
      slots: [{ id: 's', bone: 'a', follow: 'bone', attachment: { type: 'empty' } }],
      clips: []
    });
    expect(skeleton.bones.get('a').inherit).toBe('translationOnly');
    expect(skeleton.slots[0].follow).toBe('bone');
  });

  it('方向形态换图字段被保留（assetId/width/height）', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.forms',
      bones: [{ id: 'a', parent: null }],
      slots: [{
        id: 's',
        bone: 'a',
        attachment: {
          type: 'image',
          assetId: 'img.base',
          x: 0,
          y: 0,
          rot: 0,
          width: 32,
          height: 32,
          directionOffsets: {
            SE: { x: 1, y: 2, rot: 3, assetId: 'img.se', width: 40, height: 44 },
            NW: { x: 0, y: 0, rot: 0, assetId: 'img.nw' }
          }
        }
      }],
      clips: []
    });
    const offsets = skeleton.slots[0].attachment.directionOffsets;
    expect(offsets.SE.assetId).toBe('img.se');
    expect(offsets.SE.width).toBe(40);
    expect(offsets.SE.height).toBe(44);
    expect(offsets.NW.assetId).toBe('img.nw');
    // 未声明尺寸/图的方向：只保留偏移字段
    expect(offsets.NW.width).toBeUndefined();
  });

  it('方向形态覆盖缺省字段时回退顶层值', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.forms2',
      bones: [{ id: 'a', parent: null }],
      slots: [{
        id: 's',
        bone: 'a',
        attachment: {
          type: 'image',
          assetId: 'img.base',
          x: 5,
          y: 6,
          rot: 7,
          width: 32,
          height: 32,
          directionOffsets: { side: { x: 1, y: 2, rot: 3 } }
        }
      }],
      clips: []
    });
    const side = skeleton.slots[0].attachment.directionOffsets.side;
    expect(side.x).toBe(1);
    expect(side.assetId).toBeUndefined();
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

  it('循环剪辑尾段自动环绕：最后关键帧之后与首帧插值，t=durationMs 恰好回到首帧姿态', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.loop',
      bones: [
        { id: 'root', parent: null, x: 0, y: 0 },
        { id: 'child', parent: 'root', x: 0, y: -50, length: 20 }
      ],
      slots: [],
      clips: [
        {
          name: 'bob',
          durationMs: 1000,
          loop: true,
          tracks: [
            {
              bone: 'child',
              keys: [
                { t: 0, y: -50 },
                { t: 400, y: -30 }
              ]
            }
          ]
        }
      ]
    });
    const rest = createRestLocalPose(skeleton);
    const clip = skeleton.clips.get('bob');
    // 尾段中点（700ms）：-30 与 -50 的中点
    expect(sampleClip(clip, 700, rest).get('child').y).toBeCloseTo(-40);
    // t=durationMs 恰好等于首帧姿态 → 循环回绕点无跳变
    expect(sampleClip(clip, 1000, rest).get('child').y).toBeCloseTo(-50);
    expect(sampleClip(clip, 0, rest).get('child').y).toBeCloseTo(-50);
    // 中段插值不受影响
    expect(sampleClip(clip, 200, rest).get('child').y).toBeCloseTo(-40);
  });

  it('非循环剪辑尾段保持 hold 最后一帧（一次性动作语义不变）', () => {
    const skeleton = buildSkeleton();
    const rest = createRestLocalPose(skeleton);
    const clip = skeleton.clips.get('turn');
    expect(clip.loop).toBe(false);
    expect(sampleClip(clip, 1000, rest).get('child').rot).toBe(90);
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

describe('骨骼继承模式（bone.inherit）', () => {
  /** 父骨 scale=2 rot=0，子骨局部 (10,0)，用于对比四种继承模式。 */
  function buildInheritSkeleton(inherit) {
    return parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.inherit',
      bones: [
        { id: 'root', parent: null, x: 0, y: 0, scaleX: 2, scaleY: 2 },
        { id: 'child', parent: 'root', x: 10, y: 0, inherit }
      ],
      slots: [],
      clips: []
    });
  }

  it('缺省 normal：继承父级位移+旋转+缩放（历史行为不变）', () => {
    const skeleton = buildInheritSkeleton(undefined);
    expect(skeleton.bones.get('child').inherit).toBe('normal');
    const local = createRestLocalPose(skeleton);
    const world = composeWorldTransforms(skeleton, local);
    const child = world.get('child');
    expect(child.x).toBeCloseTo(20);   // 10 × 父缩放 2
    expect(child.sx).toBeCloseTo(2);
  });

  it('noScale：继承父级位移+旋转，不继承父级缩放', () => {
    const skeleton = buildInheritSkeleton('noScale');
    const local = createRestLocalPose(skeleton);
    const world = composeWorldTransforms(skeleton, local);
    const child = world.get('child');
    expect(child.x).toBeCloseTo(10);   // 局部偏移不被父缩放放大
    expect(child.sx).toBeCloseTo(1);   // 世界缩放只保留自身
  });

  it('noRotation：继承父级位移+缩放，不继承父级旋转', () => {
    const skeleton = buildInheritSkeleton('noRotation');
    const local = createRestLocalPose(skeleton);
    local.get('root').rot = 90;
    local.get('root').sx = 2;
    local.get('root').sy = 2;
    const world = composeWorldTransforms(skeleton, local);
    const child = world.get('child');
    // 局部 (10,0) 不随父旋转转到 +y，但父缩放仍生效
    expect(child.x).toBeCloseTo(20);
    expect(child.y).toBeCloseTo(0);
    expect(child.rot).toBeCloseTo(0);
    expect(child.sx).toBeCloseTo(2);
  });

  it('translationOnly：只继承父级位移，旋转与缩放都不传递', () => {
    const skeleton = buildInheritSkeleton('translationOnly');
    const local = createRestLocalPose(skeleton);
    local.get('root').rot = 90;
    local.get('root').sx = 2;
    local.get('root').sy = 2;
    const world = composeWorldTransforms(skeleton, local);
    const child = world.get('child');
    expect(child.x).toBeCloseTo(10);
    expect(child.y).toBeCloseTo(0);
    expect(child.rot).toBeCloseTo(0);
    expect(child.sx).toBeCloseTo(1);
  });

  it('根骨骼的继承模式不影响自身变换', () => {
    const skeleton = buildInheritSkeleton('translationOnly');
    const local = createRestLocalPose(skeleton);
    const world = composeWorldTransforms(skeleton, local);
    expect(world.get('root').x).toBeCloseTo(0);
    expect(world.get('root').sx).toBeCloseTo(2);
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

describe('sampleClip 贝塞尔手柄与 hold（schema v2 段插值）', () => {
  /** 单轨单字段骨架：child.rot 从 0 → 90。 */
  function buildHandleSkeleton(keys) {
    return parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.curve',
      bones: [{ id: 'child', parent: null }],
      slots: [],
      clips: [{ name: 'turn', durationMs: 1000, loop: false, tracks: [{ bone: 'child', keys }] }]
    });
  }

  it('parse 保留合法的 in/out 控制点与 hold；非法控制点剥离', () => {
    const skeleton = buildHandleSkeleton([
      { t: 0, rot: 0, out: { x: 0.42, y: 0 }, hold: true },
      { t: 1000, rot: 90, in: { x: 1.5, y: 0.3 } } // x 越界 → 剥离
    ]);
    const keys = skeleton.clips.get('turn').tracks.get('child');
    expect(keys[0].out).toEqual({ x: 0.42, y: 0 });
    expect(keys[0].hold).toBe(true);
    expect(keys[1].in).toBeUndefined(); // 非法控制点不进运行时
  });

  it('easeInOut 手柄：中点值=线性中点，四分点滞后于线性（慢起）', () => {
    const skeleton = buildHandleSkeleton([
      { t: 0, rot: 0, out: { x: 0.42, y: 0 } },
      { t: 1000, rot: 90, in: { x: 0.42, y: 0 } }
    ]);
    const clip = skeleton.clips.get('turn');
    const restPose = createRestLocalPose(skeleton);
    const middle = sampleClip(clip, 500, restPose).get('child').rot;
    const quarter = sampleClip(clip, 250, restPose).get('child').rot;
    expect(middle).toBeCloseTo(45, 3); // 对称曲线：中点=值域中点
    expect(quarter).toBeLessThan(22.5); // 慢起：进度落后于时间
  });

  it('hold 阶跃：段内恒为起始键值，到终点键才跳变', () => {
    const skeleton = buildHandleSkeleton([
      { t: 0, rot: 0, hold: true },
      { t: 1000, rot: 90 }
    ]);
    const clip = skeleton.clips.get('turn');
    const restPose = createRestLocalPose(skeleton);
    expect(sampleClip(clip, 500, restPose).get('child').rot).toBe(0);
    expect(sampleClip(clip, 999, restPose).get('child').rot).toBe(0);
    expect(sampleClip(clip, 1000, restPose).get('child').rot).toBe(90);
  });

  it('无手柄的存量数据行为不变（命名缓动/线性零回归）', () => {
    const skeleton = buildHandleSkeleton([{ t: 0, rot: 0 }, { t: 1000, rot: 90, ease: 'easeInOut' }]);
    const clip = skeleton.clips.get('turn');
    const restPose = createRestLocalPose(skeleton);
    expect(sampleClip(clip, 500, restPose).get('child').rot).toBeCloseTo(45);
    expect(sampleClip(clip, 250, restPose).get('child').rot).toBeLessThan(22.5);
  });
});

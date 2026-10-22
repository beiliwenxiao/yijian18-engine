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
import { parseSkeletonAsset } from '../animation/SkeletonAsset.js';
import { createRestLocalPose, sampleClip } from '../animation/SkeletonPose.js';
import { exportSkeletonToSpine, buildSpineAtlasText } from './SkeletonSpineExporter.js';

/** 最小骨骼文档：root → bone，bone 上挂一个图片槽位。 */
function buildDoc(overrides = {}) {
  return {
    schemaVersion: 1,
    skeletonId: 'skeleton.export',
    meta: { width: 100, height: 160 },
    bones: [
      { id: 'root', parent: null, x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, length: 20 },
      { id: 'bone', parent: 'root', x: 10, y: -30, rot: 15, scaleX: 1, scaleY: 1, length: 24 }
    ],
    slots: [
      {
        id: 'body',
        bone: 'bone',
        z: 0,
        attachment: { type: 'image', assetId: 'img.body', x: 1, y: 2, rot: 3, width: 32, height: 40 }
      }
    ],
    clips: [],
    ...overrides
  };
}

/** Spine 语义采样（线性插值；timeline 为 [t, v] 或 [t, x, y]）。 */
function sampleSpine(timeline, time, index = 1) {
  if (!timeline || !timeline.length) return 0;
  if (time <= timeline[0][0]) return timeline[0][index];
  const last = timeline[timeline.length - 1];
  if (time >= last[0]) return last[index];
  let i = 1;
  while (i < timeline.length && timeline[i][0] < time) i += 1;
  const a = timeline[i - 1];
  const b = timeline[i];
  const span = b[0] - a[0];
  const u = span > 0 ? (time - a[0]) / span : 0;
  return a[index] + (b[index] - a[index]) * u;
}

describe('exportSkeletonToSpine · 骨骼映射', () => {
  it('骨骼字段映射为 Spine bone（含 parent/transform）', () => {
    const { json } = exportSkeletonToSpine(buildDoc());
    const bone = json.bones.find(entry => entry.name === 'bone');
    expect(bone.parent).toBe('root');
    expect(bone.x).toBe(10);
    expect(bone.y).toBe(-30);
    expect(bone.rotation).toBe(15);
    expect(bone.length).toBe(24);
    expect(bone.transform).toBe('normal');
  });

  it('继承模式映射：noScale→onlyRotation、translationOnly→onlyTranslation', () => {
    const doc = buildDoc();
    doc.bones[1].inherit = 'noScale';
    doc.bones[0].inherit = 'translationOnly';
    const { json, report } = exportSkeletonToSpine(doc);
    expect(json.bones.find(entry => entry.name === 'bone').transform).toBe('onlyRotation');
    expect(json.bones.find(entry => entry.name === 'root').transform).toBe('onlyTranslation');
    expect(report.lossy.some(item => item.feature === 'bone.inherit=noRotation')).toBe(false);
  });

  it('noRotation 无等价：退化为 normal 并记为有损', () => {
    const doc = buildDoc();
    doc.bones[1].inherit = 'noRotation';
    const { json, report } = exportSkeletonToSpine(doc);
    expect(json.bones.find(entry => entry.name === 'bone').transform).toBe('normal');
    expect(report.lossy.some(item => item.feature === 'bone.inherit=noRotation' && item.bone === 'bone')).toBe(true);
  });
});

describe('exportSkeletonToSpine · 方向形态皮肤', () => {
  it('导出 7 个形态 skin + default（正面基准）', () => {
    const { json } = exportSkeletonToSpine(buildDoc());
    for (const key of ['down', 'side', 'up', 'SE', 'SW', 'NE', 'NW']) {
      expect(json.skins[key]).toBeTruthy();
    }
    expect(json.skins.default).toBeTruthy();
  });

  it('形态换图：SE 形态使用专属部件图与尺寸', () => {
    const doc = buildDoc();
    doc.slots[0].attachment.directionOffsets = {
      SE: { x: 5, y: -3, rot: 8, assetId: 'img.body_se', width: 36, height: 44 }
    };
    const { json } = exportSkeletonToSpine(doc);
    const entry = json.skins.SE.body.body;
    expect(entry.region).toBe('img.body_se');
    expect(entry.width).toBe(36);
    expect(entry.height).toBe(44);
    expect(entry.x).toBe(5);
    expect(entry.rotation).toBe(8);
    // 正面基准不受影响
    expect(json.skins.down.body.body.region).toBe('img.body');
  });

  it('形态未配置换图时沿用正面基准图', () => {
    const doc = buildDoc();
    doc.slots[0].attachment.directionOffsets = { side: { x: -15, y: -6, rot: -72 } };
    const { json } = exportSkeletonToSpine(doc);
    expect(json.skins.side.body.body.region).toBe('img.body');
    expect(json.skins.side.body.body.x).toBe(-15);
    expect(json.skins.SE.body.body.region).toBe('img.body');
  });
});

describe('exportSkeletonToSpine · 动画时间轴（与本引擎采样等价）', () => {
  /** 构造一条线性轨道（无缺省帧），用于严格对拍。 */
  function buildClipDoc(keys) {
    return buildDoc({
      clips: [{
        name: 'walk',
        durationMs: 1000,
        loop: false,
        tracks: [{ bone: 'bone', keys }]
      }]
    });
  }

  it('translate/rotate/scale 都转成相对 setup 的增量与比例', () => {
    const keys = [
      { t: 0, x: 10, y: -30, rot: 15, scaleX: 1, scaleY: 1, ease: 'linear' },
      { t: 500, x: 20, y: -40, rot: 45, scaleX: 2, scaleY: 0.5, ease: 'linear' }
    ];
    const { json } = exportSkeletonToSpine(buildClipDoc(keys));
    const timeline = json.animations.walk.bones.bone;
    expect(timeline.translate[0]).toEqual([0, 0, 0]);           // setup 差值
    expect(timeline.translate[1]).toEqual([500, 10, -10]);
    expect(timeline.rotate[0]).toEqual([0, 0]);                // setup 差值
    expect(timeline.rotate[1]).toEqual([500, 30]);
    expect(timeline.scale[0]).toEqual([0, 1, 1]);              // setup 比例
    expect(timeline.scale[1]).toEqual([500, 2, 0.5]);
  });

  it('线性轨道：本引擎采样值 == Spine 重建采样值（10ms 步长逐点对拍）', () => {
    const keys = [
      { t: 0, x: 10, y: -30, rot: 15, scaleX: 1, scaleY: 1, ease: 'linear' },
      { t: 250, x: 30, y: -50, rot: 45, scaleX: 1.5, scaleY: 1, ease: 'linear' },
      { t: 600, x: 5, y: -20, rot: -10, scaleX: 0.8, scaleY: 1.2, ease: 'linear' },
      { t: 1000, x: 10, y: -30, rot: 15, scaleX: 1, scaleY: 1, ease: 'linear' }
    ];
    const doc = buildClipDoc(keys);
    const { json } = exportSkeletonToSpine(doc);
    const timeline = json.animations.walk.bones.bone;

    const skeleton = parseSkeletonAsset(doc);
    const rest = createRestLocalPose(skeleton);
    const clip = { name: 'walk', durationMs: 1000, loop: false, tracks: new Map([['bone', keys]]) };
    const setup = { x: 10, y: -30, rot: 15, sx: 1, sy: 1 };

    for (let time = 0; time <= 1000; time += 10) {
      const pose = sampleClip(clip, time, rest).get('bone');
      expect(pose.x).toBeCloseTo(setup.x + sampleSpine(timeline.translate, time, 1), 5);
      expect(pose.y).toBeCloseTo(setup.y + sampleSpine(timeline.translate, time, 2), 5);
      expect(pose.rot).toBeCloseTo(setup.rot + sampleSpine(timeline.rotate, time, 1), 5);
      expect(pose.sx).toBeCloseTo(setup.sx * sampleSpine(timeline.scale, time, 1), 5);
      expect(pose.sy).toBeCloseTo(setup.sy * sampleSpine(timeline.scale, time, 2), 5);
    }
  });

  it('缺省帧（null）：导出时补阶跃关键帧，缺省段内取值与本引擎一致', () => {
    const keys = [
      { t: 0, x: 10, y: -30, rot: 15, scaleX: null, scaleY: null, ease: 'linear' },
      { t: 400, x: null, y: null, rot: null, scaleX: null, scaleY: null, ease: 'linear' },
      { t: 800, x: 50, y: -60, rot: 60, scaleX: 2, scaleY: 2, ease: 'linear' }
    ];
    const doc = buildClipDoc(keys);
    const { json } = exportSkeletonToSpine(doc);
    const timeline = json.animations.walk.bones.bone;

    const skeleton = parseSkeletonAsset(doc);
    const rest = createRestLocalPose(skeleton);
    const clip = { name: 'walk', durationMs: 1000, loop: false, tracks: new Map([['bone', keys]]) };

    // 缺省段 [400, 800) 起点补了一条与下一有效值相同的关键帧 → 形成阶跃
    expect(timeline.translate.some(entry => entry[0] === 400)).toBe(true);
    // 缺省段内部（不含起点那一帧）两边取值一致
    for (const time of [450, 600, 799]) {
      const pose = sampleClip(clip, time, rest).get('bone');
      expect(pose.x).toBeCloseTo(10 + sampleSpine(timeline.translate, time, 1), 5);
      expect(pose.rot).toBeCloseTo(15 + sampleSpine(timeline.rotate, time, 1), 5);
    }
  });

  it('easeInOut 缓动导出为 Spine 贝塞尔曲线控制点', () => {
    const keys = [
      { t: 0, x: 0, y: 0, rot: 0, scaleX: null, scaleY: null, ease: 'linear' },
      { t: 500, x: 10, y: 0, rot: 0, scaleX: null, scaleY: null, ease: 'easeInOut' }
    ];
    const { json } = exportSkeletonToSpine(buildClipDoc(keys));
    const rotate = json.animations.walk.bones.bone.rotate;
    expect(rotate[1][2]).toEqual([0.42, 0, 0.58, 1]);
  });
});

describe('exportSkeletonToSpine · 有损项报告', () => {
  it('序列帧附件：只导出静态图并记有损', () => {
    const doc = buildDoc();
    doc.slots[0].attachment = {
      type: 'sequence',
      assetId: 'img.seq',
      x: 0, y: 0, rot: 0,
      width: 32, height: 32,
      fps: 8,
      frames: [{ sx: 0, sy: 0, sw: 32, sh: 32 }, { sx: 32, sy: 0, sw: 32, sh: 32 }]
    };
    const { report } = exportSkeletonToSpine(doc);
    expect(report.lossy.some(item => item.feature === 'attachment.type=sequence')).toBe(true);
  });

  it('挂图不跟随缩放：Spine 侧无法表达，记有损', () => {
    const doc = buildDoc();
    doc.slots[0].follow = 'noScale';
    const { report } = exportSkeletonToSpine(doc);
    expect(report.lossy.some(item => item.feature === 'slot.follow=noScale')).toBe(true);
  });

  it('未声明 follow 的槽位按运行时缺省 noScale 处理（同样记有损）', () => {
    const doc = buildDoc();
    expect(doc.slots[0].follow).toBeUndefined();
    const { report } = exportSkeletonToSpine(doc);
    expect(report.lossy.some(item => item.feature === 'slot.follow=noScale' && item.slot === 'body')).toBe(true);
  });

  it('显式 follow=bone 的槽位不记有损', () => {
    const doc = buildDoc();
    doc.slots[0].follow = 'bone';
    const { report } = exportSkeletonToSpine(doc);
    expect(report.lossy.some(item => item.feature === 'slot.follow=noScale')).toBe(false);
  });

  it('transform 约束（挂件跟随挂件）：Spine 无等价物，记有损', () => {
    const doc = buildDoc();
    doc.constraints = [{ type: 'transform', slot: 'body', target: 'body' }];
    const { report } = exportSkeletonToSpine(doc);
    expect(report.lossy.some(item => item.feature.includes('transform 约束'))).toBe(true);
  });

  it('循环剪辑：回绕插值差异记有损', () => {
    const doc = buildDoc({
      clips: [{ name: 'idle', durationMs: 1000, loop: true, tracks: [{ bone: 'bone', keys: [{ t: 0, x: 0, y: 0, rot: 0 }] }] }]
    });
    const { report } = exportSkeletonToSpine(doc);
    expect(report.lossy.some(item => item.feature === 'clip.loop 回绕插值')).toBe(true);
  });
});

describe('buildSpineAtlasText', () => {
  it('输出 atlas 文本（页头 + region 条目）', () => {
    const text = buildSpineAtlasText([
      { name: 'img.body', xyX: 0, xyY: 0, width: 32, height: 40 },
      { name: 'img.body_se', xyX: 32, xyY: 0, width: 36, height: 44 }
    ], { pageName: 'atlas.png', width: 128, height: 128 });
    expect(text).toContain('atlas.png');
    expect(text).toContain('size: 128, 128');
    expect(text).toContain('format: RGBA8888');
    expect(text).toContain('img.body');
    expect(text).toContain('xy: 32, 0');
    expect(text).toContain('size: 36, 44');
  });
});

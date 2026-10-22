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
import { evaluateSkeletonPose } from '../animation/SkeletonPose.js';
import { SkeletonRenderer } from './SkeletonRenderer.js';

/** 记录 canvas 调用的假上下文。 */
function createCtx() {
  const calls = [];
  return {
    calls,
    save() {},
    restore() {},
    translate(x, y) { calls.push({ op: 'translate', x, y }); },
    rotate(angle) { calls.push({ op: 'rotate', angle }); },
    scale(x, y) { calls.push({ op: 'scale', x, y }); },
    drawImage(...args) { calls.push({ op: 'drawImage', args }); }
  };
}

/** 父骨 scale=2，子骨挂一张 32×32 图片——用于验证挂图是否跟随骨骼缩放。 */
function buildScene(follow) {
  const skeleton = parseSkeletonAsset({
    schemaVersion: 1,
    skeletonId: 'skeleton.render',
    meta: { width: 100, height: 160 },
    bones: [
      { id: 'root', parent: null, x: 0, y: 0, scaleX: 2, scaleY: 2 },
      { id: 'child', parent: 'root', x: 0, y: -50 }
    ],
    slots: [
      {
        id: 'body',
        bone: 'child',
        z: 0,
        follow,
        attachment: { type: 'image', assetId: 'img.body', width: 32, height: 32 }
      }
    ],
    clips: []
  });
  const component = {
    skeletonId: 'skeleton.render',
    skeletonAsset: skeleton,
    currentClip: null,
    getWorldPose: () => evaluateSkeletonPose(skeleton, null, 0).world,
    resolveSlotAttachment: slot => slot.attachment,
    getSlotFrame: () => 0
  };
  const assetManager = {
    getImage: () => ({ naturalWidth: 32, naturalHeight: 32 })
  };
  return { skeleton, component, assetManager };
}

/** drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) → 绘制宽/高索引。 */
const DRAW_W = 7;
const DRAW_H = 8;

describe('SkeletonRenderer 方向形态换图', () => {
  /** 带方向形态覆盖的骨架：基准图 img.base（32×32）。 */
  function buildFormScene(directionOverrides) {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.form',
      meta: { width: 100, height: 160 },
      bones: [
        { id: 'root', parent: null, x: 0, y: 0 },
        { id: 'child', parent: 'root', x: 0, y: -50 }
      ],
      slots: [{
        id: 'body',
        bone: 'child',
        z: 0,
        attachment: {
          type: 'image',
          assetId: 'img.base',
          x: 0,
          y: 0,
          rot: 0,
          width: 32,
          height: 32,
          directionOffsets: directionOverrides
        }
      }],
      clips: []
    });
    const requested = [];
    const component = {
      skeletonId: 'skeleton.form',
      skeletonAsset: skeleton,
      currentClip: null,
      getWorldPose: () => evaluateSkeletonPose(skeleton, null, 0).world,
      resolveSlotAttachment: slot => slot.attachment,
      getSlotFrame: () => 0
    };
    const assetManager = {
      getImage: id => {
        requested.push(id);
        return { naturalWidth: 32, naturalHeight: 32 };
      }
    };
    return { component, assetManager, requested };
  }

  function renderForm(scene, direction) {
    const ctx = createCtx();
    new SkeletonRenderer().render(ctx, {
      assetManager: scene.assetManager,
      skeletonComponent: scene.component,
      sprite: { flipX: false, direction },
      x: 0, y: 0, width: 100, height: 160
    });
    return ctx.calls.find(call => call.op === 'drawImage');
  }

  it('斜前右形态：用 SE 专属形态图与绘制尺寸', () => {
    const scene = buildFormScene({ SE: { x: 0, y: 0, rot: 0, assetId: 'img.se', width: 40, height: 44 } });
    const draw = renderForm(scene, 'down-right');
    expect(scene.requested).toContain('img.se');
    expect(draw.args[DRAW_W]).toBe(40);
    expect(draw.args[DRAW_H]).toBe(44);
  });

  it('斜向未配置形态图时沿用正面基准图（与编辑器预览同口径）', () => {
    const scene = buildFormScene({ side: { x: 0, y: 0, rot: 0, assetId: 'img.side', width: 36, height: 36 } });
    const draw = renderForm(scene, 'down-right');
    expect(scene.requested).toContain('img.base');
    expect(draw.args[DRAW_W]).toBe(32);
  });

  it('正面：用基准图与基准尺寸', () => {
    const scene = buildFormScene({ SE: { x: 0, y: 0, rot: 0, assetId: 'img.se', width: 40, height: 44 } });
    const draw = renderForm(scene, 'down');
    expect(scene.requested).toContain('img.base');
    expect(draw.args[DRAW_W]).toBe(32);
  });

  it('侧面形态：只配偏移不换图时沿用基准图', () => {
    const scene = buildFormScene({ side: { x: 3, y: -2, rot: 0 } });
    const draw = renderForm(scene, 'left');
    expect(scene.requested).toContain('img.base');
    expect(draw.args[DRAW_W]).toBe(32);
  });
});

describe('SkeletonRenderer 挂图跟随模式', () => {
  it('noScale（缺省）：骨骼缩放 2× 时挂图仍按原尺寸绘制，不被拉伸', () => {
    const { component, assetManager } = buildScene(undefined);
    const ctx = createCtx();
    const handled = new SkeletonRenderer().render(ctx, {
      assetManager,
      skeletonComponent: component,
      sprite: { flipX: false, direction: 'down' },
      x: 0, y: 0, width: 100, height: 160
    });
    expect(handled).toBe(true);
    const draw = ctx.calls.find(call => call.op === 'drawImage');
    expect(draw).toBeTruthy();
    expect(draw.args[DRAW_W]).toBe(32);
    expect(draw.args[DRAW_H]).toBe(32);
    // 没有出现骨骼缩放分量（2,2）
    expect(ctx.calls.some(call => call.op === 'scale' && call.x === 2 && call.y === 2)).toBe(false);
  });

  it('bone：挂图完全跟随骨骼缩放（squash & stretch 语义）', () => {
    const { component, assetManager } = buildScene('bone');
    const ctx = createCtx();
    new SkeletonRenderer().render(ctx, {
      assetManager,
      skeletonComponent: component,
      sprite: { flipX: false, direction: 'down' },
      x: 0, y: 0, width: 100, height: 160
    });
    const draw = ctx.calls.find(call => call.op === 'drawImage');
    // 绘制盒参数仍是原始尺寸——缩放由 ctx 变换矩阵承担（视觉上被放大 2 倍）
    expect(draw.args[DRAW_W]).toBe(32);
    expect(draw.args[DRAW_H]).toBe(32);
    // 骨骼世界缩放分量进入了变换矩阵
    expect(ctx.calls.some(call => call.op === 'scale' && call.x === 2 && call.y === 2)).toBe(true);
  });

  it('noScale：挂图锚点仍在骨骼原点（父缩放只改骨架比例）', () => {
    const { component, assetManager } = buildScene('noScale');
    const ctx = createCtx();
    new SkeletonRenderer().render(ctx, {
      assetManager,
      skeletonComponent: component,
      sprite: { flipX: false, direction: 'down' },
      x: 0, y: 0, width: 100, height: 160
    });
    // 子骨局部 (0,-50) 被父缩放 2 放大 → 世界 (0,-100)
    const anchor = ctx.calls.find(call => call.op === 'translate' && call.y === -100);
    expect(anchor).toBeTruthy();
  });
});

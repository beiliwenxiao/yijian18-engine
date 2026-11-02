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
import { SkeletonComponent } from '../ecs/components/SkeletonComponent.js';
import { SkeletonRenderer } from './SkeletonRenderer.js';

/** 记录 canvas 调用的假上下文（save/restore 含 globalAlpha 栈，模拟真 canvas 行为）。 */
function createCtx() {
  const calls = [];
  const stack = [];
  const ctx = {
    calls,
    globalAlpha: 1,
    save() { stack.push(ctx.globalAlpha); },
    restore() { ctx.globalAlpha = stack.pop() ?? 1; },
    translate(x, y) { calls.push({ op: 'translate', x, y }); },
    rotate(angle) { calls.push({ op: 'rotate', angle }); },
    scale(x, y) { calls.push({ op: 'scale', x, y }); },
    drawImage(...args) { calls.push({ op: 'drawImage', args, alpha: ctx.globalAlpha }); }
  };
  return ctx;
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

describe('SkeletonRenderer 转身过渡（分层延迟 + 交叉淡化）', () => {
  /**
   * 两个槽位配置不同转身参数：
   *   head —— turnDelayMs 0 / turnFadeMs 100（切换即交叉淡化）
   *   leg  —— turnDelayMs 120 / turnFadeMs 0（延迟 120ms 后瞬切）
   * 附件带 side 形态图（img.side），基准图 img.base。
   */
  function buildTurnScene() {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.turn',
      meta: { width: 100, height: 160 },
      bones: [{ id: 'root', parent: null, x: 0, y: 0 }],
      slots: [
        {
          id: 'head', bone: 'root', z: 0, turnDelayMs: 0, turnFadeMs: 100,
          attachment: {
            type: 'image', assetId: 'img.base', width: 32, height: 32,
            directionOffsets: { side: { x: 0, y: 0, rot: 0, assetId: 'img.side' } }
          }
        },
        {
          id: 'leg', bone: 'root', z: 1, turnDelayMs: 120, turnFadeMs: 0,
          attachment: {
            type: 'image', assetId: 'img.base', width: 32, height: 32,
            directionOffsets: { side: { x: 0, y: 0, rot: 0, assetId: 'img.side' } }
          }
        }
      ],
      clips: []
    });
    const component = new SkeletonComponent({ skeletonId: 'skeleton.turn' });
    component.setSkeletonAsset(skeleton);
    const assetManager = {
      getImage: () => ({ naturalWidth: 32, naturalHeight: 32 })
    };
    return { skeleton, component, assetManager };
  }

  /** 渲染一帧并返回 drawImage 调用（按源图 assetId 索引：args[0].id 由 mock 提供）。 */
  function renderTurn(scene, direction, advanceSeconds) {
    if (advanceSeconds) scene.component.update(advanceSeconds);
    const ctx = createCtx();
    new SkeletonRenderer().render(ctx, {
      assetManager: scene.assetManager,
      skeletonComponent: scene.component,
      sprite: { flipX: false, direction },
      x: 0, y: 0, width: 100, height: 160
    });
    const draws = ctx.calls.filter(call => call.op === 'drawImage');
    // mock 图片无 id——按 drawImage 的调用顺序区分：形态换图后 source 不同对象但同一 mock 图。
    // 这里用绘制顺序 + alpha 区分：cross 期两个槽位各自至多 2 次 draw。
    return draws;
  }

  it('parse 透传 turnDelayMs/turnFadeMs 并汇总 maxTurnMs', () => {
    const { skeleton } = buildTurnScene();
    expect(skeleton.slots[0].turnDelayMs).toBe(0);
    expect(skeleton.slots[0].turnFadeMs).toBe(100);
    expect(skeleton.slots[1].turnDelayMs).toBe(120);
    expect(skeleton.maxTurnMs).toBe(120); // max(0+100, 120+0)
  });

  it('未配置 turn 参数的槽位：方向切换瞬切（零回归）', () => {
    const skeleton = parseSkeletonAsset({
      schemaVersion: 1,
      skeletonId: 'skeleton.plain',
      meta: { width: 100, height: 160 },
      bones: [{ id: 'root', parent: null, x: 0, y: 0 }],
      slots: [{
        id: 'body', bone: 'root', z: 0,
        attachment: {
          type: 'image', assetId: 'img.base', width: 32, height: 32,
          directionOffsets: { side: { x: 0, y: 0, rot: 0, assetId: 'img.side' } }
        }
      }],
      clips: []
    });
    expect(skeleton.maxTurnMs).toBe(0);
    const component = new SkeletonComponent({ skeletonId: 'skeleton.plain' });
    component.setSkeletonAsset(skeleton);
    const ctx = createCtx();
    component.update(0.016);
    new SkeletonRenderer().render(ctx, {
      assetManager: { getImage: () => ({ naturalWidth: 32, naturalHeight: 32 }) },
      skeletonComponent: component,
      sprite: { flipX: false, direction: 'right' },
      x: 0, y: 0, width: 100, height: 160
    });
    const draws = ctx.calls.filter(call => call.op === 'drawImage');
    expect(draws).toHaveLength(1); // 无过渡：只画新形态，不叠影
  });

  it('切换瞬间：head 画旧形态（新形态 alpha=0 被裁剪），leg 延迟期内仍画旧形态', () => {
    const scene = buildTurnScene();
    renderTurn(scene, 'down', 0);        // 基线帧：组件记录旧形态
    scene.component.update(0.016);       // 时钟推进一帧
    const draws = renderTurn(scene, 'right', 0); // 切换帧：过渡启动，elapsed=0
    expect(draws).toHaveLength(2);       // head 旧形态 + leg 旧形态（head 新形态 alpha=0 跳过）
    expect(draws.every(draw => draw.alpha === 1)).toBe(true);
  });

  it('交叉中段：head 新旧形态叠画（旧淡出新淡入），leg 仍在延迟期画旧形态', () => {
    const scene = buildTurnScene();
    renderTurn(scene, 'down', 0);        // 基线帧
    renderTurn(scene, 'right', 0);       // 切换帧：过渡启动（elapsed=0）
    scene.component.update(0.05);        // 时钟 +50ms
    const draws = renderTurn(scene, 'right', 0); // elapsed=50：head 交叉中段，leg 延迟期（<120）
    expect(draws).toHaveLength(3);       // head 旧 + head 新 + leg 旧
    const alphas = draws.map(draw => draw.alpha).sort((a, b) => b - a);
    expect(alphas[0]).toBeCloseTo(1, 1);     // leg 旧形态
    expect(alphas[1]).toBeCloseTo(0.5, 1);   // head 新形态（50/100）
    expect(alphas[2]).toBeCloseTo(0.5, 1);   // head 旧形态（1-0.5）
  });

  it('过渡结束后：全部槽位只画新形态', () => {
    const scene = buildTurnScene();
    renderTurn(scene, 'down', 0);
    renderTurn(scene, 'right', 0);
    scene.component.update(0.2);         // 200ms > maxTurnMs 120：过渡结束
    const draws = renderTurn(scene, 'right', 0);
    expect(draws).toHaveLength(2);
    expect(draws.every(draw => draw.alpha === 1)).toBe(true);
  });
});

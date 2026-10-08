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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpriteRenderer } from './SpriteRenderer.js';
import { TransformComponent } from '../ecs/components/TransformComponent.js';
import { SpriteComponent } from '../ecs/components/SpriteComponent.js';

/**
 * 最小 mock ctx：只关心 translate 调用参数
 */
function makeMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    fillText: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0
  };
}

function makeEntity(transform, sprite) {
  return {
    id: 1,
    type: 'player',
    active: true,
    getComponent(name) {
      if (name === 'transform') return transform;
      if (name === 'sprite') return sprite;
      if (name === 'name') return null;
      return null;
    }
  };
}

describe('SpriteRenderer elevation 偏移', () => {
  let renderer, ctx;

  beforeEach(() => {
    renderer = new SpriteRenderer(null);
    ctx = makeMockCtx();
  });

  it('默认 elevationScale=0：elevation 不影响绘制位置', () => {
    const transform = new TransformComponent(100, 200);
    transform.position.elevation = 50;
    const sprite = new SpriteComponent('mock', { width: 32, height: 32 });

    renderer.render(ctx, makeEntity(transform, sprite), transform, sprite);

    expect(ctx.translate).toHaveBeenCalledWith(100, 200);
  });

  it('设置 elevationScale=1：translate 的 Y 被 elevation 上移', () => {
    renderer.setElevationScale(1);
    const transform = new TransformComponent(100, 200);
    transform.position.elevation = 50;
    const sprite = new SpriteComponent('mock', { width: 32, height: 32 });

    renderer.render(ctx, makeEntity(transform, sprite), transform, sprite);

    // 期望 200 - 50*1 = 150
    expect(ctx.translate).toHaveBeenCalledWith(100, 150);
  });

  it('elevation=0 时，任何 scale 下绘制位置与原来一致', () => {
    renderer.setElevationScale(1);
    const transform = new TransformComponent(100, 200);
    const sprite = new SpriteComponent('mock', { width: 32, height: 32 });

    renderer.render(ctx, makeEntity(transform, sprite), transform, sprite);

    expect(ctx.translate).toHaveBeenCalledWith(100, 200);
  });

  it('elevationScale=0.5 时，elevation=80 → 上移 40px', () => {
    renderer.setElevationScale(0.5);
    const transform = new TransformComponent(0, 0);
    transform.position.elevation = 80;
    const sprite = new SpriteComponent('mock', { width: 32, height: 32 });

    renderer.render(ctx, makeEntity(transform, sprite), transform, sprite);

    expect(ctx.translate).toHaveBeenCalledWith(0, -40);
  });
});

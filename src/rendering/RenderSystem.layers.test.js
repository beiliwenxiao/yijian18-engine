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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenderSystem } from './RenderSystem.js';
import { LayerComponent } from '../ecs/components/LayerComponent.js';
import { TransformComponent } from '../ecs/components/TransformComponent.js';
import { SpriteComponent } from '../ecs/components/SpriteComponent.js';

/**
 * 最小 ctx
 */
function makeCtx() {
  const ctx = {
    canvas: { width: 1280, height: 720 },
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    scale: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    fill: vi.fn(), arc: vi.fn(), drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })), fillText: vi.fn(),
    clearRect: vi.fn(),
    fillStyle: '', strokeStyle: '', lineWidth: 0,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0
  };
  return ctx;
}

function makeEntity(id, { x = 0, y = 0, worldLayer, renderOrder = 0, floorId = 'ground' } = {}) {
  const transform = new TransformComponent(x, y);
  transform.floorId = floorId;
  const sprite = new SpriteComponent('mock', { width: 32, height: 32 });
  const comps = {
    transform,
    sprite,
  };
  if (worldLayer) comps.layer = new LayerComponent({ worldLayer, renderOrder, floorId });
  return {
    id,
    type: 'mock',
    active: true,
    getComponent(n) { return comps[n] ?? null; }
  };
}

describe('RenderSystem 世界子层', () => {
  let ctx, rs;

  beforeEach(() => {
    ctx = makeCtx();
    rs = new RenderSystem(ctx, null, 1280, 720);
    rs.backgroundCacheEnabled = false;
    // 相机默认在 (0,0)，视野 1280x720 足够覆盖这些小 x/y
    // 避免视锥剔除导致漏掉
  });

  it('order: ground < decal < entity < aerial < effect', () => {
    const order = [];
    // 用 renderEntity spy 记录渲染顺序
    rs.renderEntity = (e) => order.push(e.id);

    const entities = [
      makeEntity('effect1', { worldLayer: 'effect' }),
      makeEntity('entity1', { worldLayer: 'entity' }),
      makeEntity('ground1', { worldLayer: 'ground' }),
      makeEntity('aerial1', { worldLayer: 'aerial' }),
      makeEntity('decal1',  { worldLayer: 'decal' })
    ];

    rs.renderEntityLayer(entities);

    expect(order).toEqual(['ground1', 'decal1', 'entity1', 'aerial1', 'effect1']);
  });

  it('entity 层内按 z（Y-sort）', () => {
    const order = [];
    rs.renderEntity = (e) => order.push(e.id);

    const a = makeEntity('A', { worldLayer: 'entity', x: 0, y: 10 });
    const b = makeEntity('B', { worldLayer: 'entity', x: 0, y: 100 });
    const c = makeEntity('C', { worldLayer: 'entity', x: 0, y: 50 });

    rs.renderEntityLayer([b, a, c]);
    expect(order).toEqual(['A', 'C', 'B']);
  });

  it('未挂 LayerComponent 默认视为 entity', () => {
    const order = [];
    rs.renderEntity = (e) => order.push(e.id);

    const ground = makeEntity('G', { worldLayer: 'ground' });
    const noLayer = makeEntity('N');   // 无 LayerComponent

    rs.renderEntityLayer([noLayer, ground]);
    expect(order).toEqual(['G', 'N']);
  });

  it('renderOrder 优先于 Y-sort', () => {
    const order = [];
    rs.renderEntity = (e) => order.push(e.id);

    const a = makeEntity('A', { worldLayer: 'entity', x: 0, y: 200, renderOrder: 5 });
    const b = makeEntity('B', { worldLayer: 'entity', x: 0, y: 10,  renderOrder: 0 });
    const c = makeEntity('C', { worldLayer: 'entity', x: 0, y: 150, renderOrder: 0 });

    rs.renderEntityLayer([a, b, c]);
    // renderOrder=0 先渲染，内部按 z 排 B(10) C(150)；renderOrder=5 最后 A(200)
    expect(order).toEqual(['B', 'C', 'A']);
  });

  it('不同 floorId 被过滤掉', () => {
    const order = [];
    rs.renderEntity = (e) => order.push(e.id);

    rs.setCurrentFloor('ground');
    const g = makeEntity('G', { worldLayer: 'entity', floorId: 'ground' });
    const u = makeEntity('U', { worldLayer: 'entity', floorId: 'upper' });

    rs.renderEntityLayer([g, u]);
    expect(order).toEqual(['G']);
  });
});

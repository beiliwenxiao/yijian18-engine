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
import * as THREE from 'three';
import { createEntityView, updateEntityView } from './EntityView3D.js';
import { TransformComponent } from '../../ecs/components/TransformComponent.js';
import { SpriteComponent } from '../../ecs/components/SpriteComponent.js';
import { LayerComponent } from '../../ecs/components/LayerComponent.js';

function makeEntity({ sprite = null, layer = null, transform = null, id = 'e1' } = {}) {
  const comps = {
    transform: transform || new TransformComponent(10, 20),
    sprite: sprite || new SpriteComponent('mock', { width: 32, height: 32 }),
    layer
  };
  return {
    id,
    active: true,
    getComponent(n) { return comps[n] ?? null; }
  };
}

describe('EntityView3D', () => {
  it('无资源时创建占位 Sprite，scale 匹配 sprite 尺寸', () => {
    const e = makeEntity();
    const view = createEntityView(e, null);
    expect(view).toBeInstanceOf(THREE.Object3D);
    if (view.isSprite) {
      expect(view.scale.x).toBe(32);
      expect(view.scale.y).toBe(32);
    }
  });

  it('updateEntityView 把 transform 应用到 three.js 坐标', () => {
    const t = new TransformComponent({ x: 5, y: 10, elevation: 7 });
    const e = makeEntity({ transform: t });
    const view = createEntityView(e, null);
    updateEntityView(view, e);
    expect(view.position.x).toBe(5);
    expect(view.position.y).toBe(7);
    expect(view.position.z).toBe(10);
  });

  it('layer.worldLayer 映射到 renderOrder', () => {
    const e1 = makeEntity({ layer: new LayerComponent({ worldLayer: 'ground' }) });
    const e2 = makeEntity({ layer: new LayerComponent({ worldLayer: 'aerial' }) });
    const v1 = createEntityView(e1, null);
    const v2 = createEntityView(e2, null);
    updateEntityView(v1, e1);
    updateEntityView(v2, e2);
    expect(v2.renderOrder).toBeGreaterThan(v1.renderOrder);
  });

  it('active=false 时 visible=false', () => {
    const e = makeEntity();
    e.active = false;
    const view = createEntityView(e, null);
    updateEntityView(view, e);
    expect(view.visible).toBe(false);
  });
});

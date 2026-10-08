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
import { LayerComponent, WORLD_LAYERS } from './LayerComponent.js';
import { EntityFactory } from '../EntityFactory.js';

describe('LayerComponent', () => {
  it('默认 worldLayer = entity，floorId = ground，renderOrder = 0', () => {
    const l = new LayerComponent();
    expect(l.worldLayer).toBe('entity');
    expect(l.floorId).toBe('ground');
    expect(l.renderOrder).toBe(0);
    expect(l.type).toBe('layer');
  });

  it('非法 worldLayer 回退为 entity', () => {
    const l = new LayerComponent({ worldLayer: 'xxxxx' });
    expect(l.worldLayer).toBe('entity');
  });

  it('合法 worldLayer 保留', () => {
    for (const w of WORLD_LAYERS) {
      expect(new LayerComponent({ worldLayer: w }).worldLayer).toBe(w);
    }
  });

  it('pushLayer / popLayer 能正确切换与恢复', () => {
    const l = new LayerComponent({ worldLayer: 'entity' });
    l.pushLayer('aerial');
    expect(l.worldLayer).toBe('aerial');
    l.popLayer();
    expect(l.worldLayer).toBe('entity');
  });

  it('setFloor 更新 floorId', () => {
    const l = new LayerComponent();
    l.setFloor('upper');
    expect(l.floorId).toBe('upper');
  });
});

describe('EntityFactory 默认挂载 LayerComponent', () => {
  const factory = new EntityFactory();

  it('createPlayer 挂载 worldLayer=entity', () => {
    const player = factory.createPlayer({
      name: 't', class: 'warrior', stats: {}, position: { x: 0, y: 0 }
    });
    const layer = player.getComponent('layer');
    expect(layer).toBeTruthy();
    expect(layer.worldLayer).toBe('entity');
  });

  it('createEnemy 挂载 worldLayer=entity', () => {
    const enemy = factory.createEnemy({
      templateId: 'slime', name: 'E', stats: {}, position: { x: 0, y: 0 }
    });
    const layer = enemy.getComponent('layer');
    expect(layer.worldLayer).toBe('entity');
  });

  it('createNPC 挂载 worldLayer=entity', () => {
    const npc = factory.createNPC({ name: 'N', position: { x: 0, y: 0 } });
    expect(npc.getComponent('layer').worldLayer).toBe('entity');
  });
});

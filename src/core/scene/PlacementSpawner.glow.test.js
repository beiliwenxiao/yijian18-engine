/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-28
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { mergeOverrides, PlacementSpawner } from './PlacementSpawner.js';

/** 点光源物品：worldProp 静物（蜡烛），定义携带 glow 块。 */
const CANDLE_DEFINITION = {
  id: 'prop.candle',
  name: '蜡烛',
  type: 'light',
  worldProp: true,
  renderStyle: 'candle',
  glow: { color: '#ffca7a', radius: 110, intensity: 0.5, flicker: 'fire', yOffset: -26 }
};

const PICKUP_GLOW_DEFINITION = {
  id: 'resource.glowshard',
  name: '荧石碎片',
  type: 'light',
  glow: { color: '#a8ff9e', radius: 90, intensity: 0.42 }
};

const registries = {
  items: {
    get: ref => ([CANDLE_DEFINITION, PICKUP_GLOW_DEFINITION]
      .find(definition => definition.id === ref)) || null
  }
};

function createSpawner() {
  const store = {
    enemies: [], all: [], pickups: [], equipmentItems: [],
    addPickup: item => store.pickups.push(item),
    remove: () => true
  };
  const spawner = new PlacementSpawner({
    entityFactory: {
      createProp: data => ({ id: data.id, components: [], addComponent() {} })
    },
    entityStore: store,
    getConditionRoot: () => undefined
  });
  spawner._store = store;
  return spawner;
}

const itemPlacement = (id, ref, overrides = undefined) => ({
  id, sceneId: 'S01', type: 'ref', kind: 'item', ref,
  group: 'lights', x: 300, y: 420, ...(overrides ? { overrides } : {})
});

describe('PlacementSpawner 物品发光（glow 块）', () => {
  it('worldProp 静物：定义 glow 注入实体 glowProfile（字段原样透传）', () => {
    const spawner = createSpawner();
    const result = spawner.spawnMatching({
      placements: [itemPlacement('S01-candle-1', 'prop.candle')],
      registries,
      selector: { group: 'lights' }
    });
    expect(result.errors).toHaveLength(0);
    expect(result.counts.item).toBe(1);
    expect(result.entities[0].glowProfile).toEqual({
      color: '#ffca7a', radius: 110, intensity: 0.5, flicker: 'fire', yOffset: -26
    });
  });

  it('场景 overrides.glow 与定义 glow 合成（浅一层深合并，场景值优先）', () => {
    const spawner = createSpawner();
    const result = spawner.spawnMatching({
      placements: [itemPlacement('S01-candle-2', 'prop.candle', {
        glow: { radius: 160, intensity: 0.7 }
      })],
      registries,
      selector: { group: 'lights' }
    });
    expect(result.entities[0].glowProfile).toEqual({
      color: '#ffca7a', radius: 160, intensity: 0.7, flicker: 'fire', yOffset: -26
    });
  });

  it('非 worldProp 物品走拾取物路径：{...data} 展开天然携带 glow', () => {
    const spawner = createSpawner();
    const result = spawner.spawnMatching({
      placements: [itemPlacement('S01-shard-1', 'resource.glowshard')],
      registries,
      selector: { group: 'lights' }
    });
    expect(result.counts.item).toBe(1);
    const pickup = spawner._store.pickups[0];
    expect(pickup.picked).toBe(false);
    expect(pickup.glow).toEqual({ color: '#a8ff9e', radius: 90, intensity: 0.42 });
    expect(pickup.x).toBe(300);
    expect(pickup.y).toBe(420);
  });

  it('定义无 glow：不注入 glowProfile、拾取物不带 glow 字段（零回归）', () => {
    const spawner = createSpawner();
    const result = spawner.spawnMatching({
      placements: [itemPlacement('S01-wood-1', 'resource.plain')],
      registries: { items: { get: ref => (ref === 'resource.plain'
        ? { id: 'resource.plain', name: '木材', type: 'material' } : null) } },
      selector: { group: 'lights' }
    });
    expect(result.entities[0].glowProfile).toBeUndefined();
    expect(spawner._store.pickups[0]?.glow).toBeUndefined();
  });

  it('mergeOverrides：glow 顶层替换与子字段合并语义与 shadow/ai 一致', () => {
    const merged = mergeOverrides(
      { glow: { color: '#ffca7a', radius: 110, intensity: 0.5 } },
      { glow: { radius: 200 } }
    );
    expect(merged.glow).toEqual({ color: '#ffca7a', radius: 200, intensity: 0.5 });
    expect(mergeOverrides({ glow: { radius: 110 } }, { glow: null }).glow).toBeNull();
  });
});

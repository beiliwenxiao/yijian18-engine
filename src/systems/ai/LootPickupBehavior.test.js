/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

/**
 * M3 3D 敌对 NPC 拾取行为：最近/半径/敌对/归属/上限/lootTable 返还。
 */

import { describe, expect, it } from 'vitest';
import { CombatSystem } from '../CombatSystem.js';
import { LootPickupBehavior, readGroundLoot } from './LootPickupBehavior.js';

function makeEntity(id, position, components = {}) {
  return {
    id,
    position,
    components,
    getComponent(name) {
      return this.components[name] || null;
    }
  };
}

function makeDrop(id, position, loot, extra = {}) {
  const entity = makeEntity(id, position, { itemProjection: loot });
  entity.downedDrop = true;
  entity.ownerId = 'player';
  Object.assign(entity, extra);
  return entity;
}

function makeNpc(id, position, extra = {}) {
  return Object.assign(makeEntity(id, position), { faction: 'enemy', lootTable: [] }, extra);
}

describe('LootPickupBehavior · 敌对 NPC 拾取（M3 3D）', () => {
  it('拾取半径内最近的玩家掉落并写回 lootTable', () => {
    const behavior = new LootPickupBehavior({ radius: 90, publishEvent: () => {} });
    const near = makeDrop('drop-near', { x: 15, y: 0 }, { definitionId: 'material.herb', quantity: 2 });
    const far = makeDrop('drop-far', { x: 70, y: 0 }, { definitionId: 'weapon.axe', quantity: 1 });
    const npc = makeNpc('wolf', { x: 0, y: 0 });
    const removed = [];

    const result = behavior.update({
      npcs: [npc],
      groundItems: [far, near],
      removeGroundItem: entity => removed.push(entity.id)
    });

    expect(result.picked).toEqual([
      { npcId: 'wolf', entityId: 'drop-near', definitionId: 'material.herb', quantity: 2 }
    ]);
    expect(removed).toEqual(['drop-near']);
    expect(near.picked).toBe(true);
    expect(behavior.carriedLootOf(npc)).toEqual([
      { definitionId: 'material.herb', quantity: 2, instanceId: null, mutable: null }
    ]);
    expect(npc.lootTable).toEqual([
      { itemId: 'material.herb', chance: 1, minQuantity: 2, maxQuantity: 2, source: 'npcPickup' }
    ]);
  });

  it('只拾玩家倒地掉落，不碰普通地面物/自己的掉落/未标记归属的掉落', () => {
    const behavior = new LootPickupBehavior({ radius: 90 });
    const playerDrop = makeDrop('d1', { x: 10, y: 0 }, { definitionId: 'material.herb', quantity: 1 });
    const ordinary = makeEntity('d2', { x: 12, y: 0 }, { itemProjection: { definitionId: 'material.ore', quantity: 1 } });
    const own = makeDrop('d3', { x: 14, y: 0 }, { definitionId: 'material.wood', quantity: 1 }, { ownerId: 'wolf' });
    const anonymous = makeDrop('d4', { x: 16, y: 0 }, { definitionId: 'material.stone', quantity: 1 }, { ownerId: null });
    const npc = makeNpc('wolf', { x: 0, y: 0 });

    const result = behavior.update({ npcs: [npc], groundItems: [ordinary, own, anonymous, playerDrop] });

    expect(result.picked.map(entry => entry.entityId)).toEqual(['d1']);
  });

  it('半径外与友军不拾取；isHostile 可注入', () => {
    const behavior = new LootPickupBehavior({ radius: 30, isHostile: npc => npc.faction === 'enemy' });
    const drop = makeDrop('d1', { x: 60, y: 0 }, { definitionId: 'material.herb', quantity: 1 });
    const ally = makeNpc('ally', { x: 10, y: 0 }, { faction: 'ally' });
    const enemy = makeNpc('wolf', { x: 0, y: 0 });
    expect(behavior.update({ npcs: [ally, enemy], groundItems: [drop] }).picked).toHaveLength(0);
    enemy.position = { x: 55, y: 0 };
    expect(behavior.update({ npcs: [enemy], groundItems: [drop] }).picked).toHaveLength(1);
  });

  it('携带上限后停止拾取；同定义多堆合并数量并 upsert lootTable', () => {
    const behavior = new LootPickupBehavior({ radius: 200, maxCarried: 2 });
    const first = makeDrop('d1', { x: 10, y: 0 }, { definitionId: 'material.herb', quantity: 2 });
    const second = makeDrop('d2', { x: 20, y: 0 }, { definitionId: 'material.herb', quantity: 3 });
    const third = makeDrop('d3', { x: 30, y: 0 }, { definitionId: 'material.ore', quantity: 1 });
    const fourth = makeDrop('d4', { x: 40, y: 0 }, { definitionId: 'material.stone', quantity: 1 });
    const npc = makeNpc('wolf', { x: 0, y: 0 });

    expect(behavior.update({ npcs: [npc], groundItems: [first, second, third] }).picked).toHaveLength(1);
    expect(behavior.update({ npcs: [npc], groundItems: [second, third] }).picked).toHaveLength(1);
    expect(behavior.carriedLootOf(npc)).toEqual([
      { definitionId: 'material.herb', quantity: 5, instanceId: null, mutable: null }
    ]);
    expect(npc.lootTable).toEqual([
      { itemId: 'material.herb', chance: 1, minQuantity: 5, maxQuantity: 5, source: 'npcPickup' }
    ]);
    expect(behavior.update({ npcs: [npc], groundItems: [third] }).picked).toHaveLength(1);
    expect(behavior.update({ npcs: [npc], groundItems: [fourth] }).picked).toHaveLength(0);
  });

  it('死亡/倒地 NPC 不拾取', () => {
    const behavior = new LootPickupBehavior({ radius: 90 });
    const drop = makeDrop('d1', { x: 10, y: 0 }, { definitionId: 'material.herb', quantity: 1 });
    const dead = makeNpc('dead', { x: 0, y: 0 }, { isDead: true });
    const downed = makeNpc('downed', { x: 0, y: 0 }, { plotDowned: true });
    expect(behavior.update({ npcs: [dead, downed], groundItems: [drop] }).picked).toHaveLength(0);
  });

  it('击杀返还：generateLoot 按 lootTable 原样掉落拾来的物品', () => {
    const behavior = new LootPickupBehavior({ radius: 90 });
    const drop = makeDrop('d1', { x: 10, y: 0 }, { definitionId: 'weapon.axe', quantity: 2 });
    const npc = makeNpc('wolf', { x: 0, y: 0 });
    behavior.update({ npcs: [npc], groundItems: [drop] });

    const combat = new CombatSystem({});
    const loot = combat.generateLoot(npc);
    expect(loot).toEqual([{ itemId: 'weapon.axe', name: 'weapon.axe', quantity: 2 }]);
  });

  it('readGroundLoot 只认物品投影实体', () => {
    expect(readGroundLoot(makeDrop('d1', { x: 0, y: 0 }, { definitionId: 'material.herb', quantity: 4 })))
      .toEqual({ definitionId: 'material.herb', quantity: 4, instanceId: null, mutable: null });
    expect(readGroundLoot(makeEntity('plain', { x: 0, y: 0 }))).toBeNull();
  });
});

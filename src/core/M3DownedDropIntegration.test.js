/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

/**
 * M3 3D 端到端纯逻辑链：CombatSystem 倒地钩子 → 掉落 → 敌对 NPC 拾取 → 击杀返还。
 * 不依赖浏览器/DOM；场景适配器以最小假实现注入。
 */

import { describe, expect, it, vi } from 'vitest';
import { CombatSystem } from '../systems/CombatSystem.js';
import { DownedDropService } from '../systems/DownedDropService.js';
import { LootPickupBehavior } from '../systems/ai/LootPickupBehavior.js';
import { InventoryComponent } from '../ecs/components/InventoryComponent.js';

function makeWorld() {
  const inventory = new InventoryComponent({ maxSlots: 8 });
  inventory.addItem({ id: 'material.herb', definitionId: 'material.herb', type: 'material', maxStack: 20 }, 4);
  const components = {
    inventory,
    equipment: { slots: {} },
    transform: { position: { x: 200, y: 120 } }
  };
  const player = {
    id: 'player',
    isDead: false,
    plotCause: null,
    getComponent(name) {
      return components[name] || null;
    }
  };
  const ground = [];
  const entities = [];
  const service = new DownedDropService({
    getInventory: owner => owner.getComponent('inventory'),
    getEquipment: owner => owner.getComponent('equipment'),
    createGroundDrop: ({ entityId, runtimeState, transform }) => {
      const entity = {
        id: entityId,
        position: transform,
        components: { itemProjection: runtimeState },
        getComponent(name) {
          return this.components[name] || null;
        }
      };
      ground.push(entity);
      entities.push(entity);
      return entity;
    },
    removeGroundDrop: entity => {
      const index = ground.indexOf(entity);
      if (index >= 0) ground.splice(index, 1);
      const entityIndex = entities.indexOf(entity);
      if (entityIndex >= 0) entities.splice(entityIndex, 1);
    },
    getDay: () => 1,
    rng: () => 0,
    config: { minItems: 1, maxItems: 3, spreadRadius: 0 }
  });
  const behavior = new LootPickupBehavior({ radius: 200 });
  const npc = {
    id: 'wolf',
    faction: 'enemy',
    lootTable: [],
    position: { x: 206, y: 120 },
    components: {},
    getComponent(name) {
      return this.components[name] || null;
    }
  };
  const combat = new CombatSystem({});
  combat.setOnPlayerDeathCallback(() => true);
  combat.setDownedDropCallback(({ player: downedPlayer }) => service.dropAll({ player: downedPlayer }));
  return { inventory, player, ground, entities, service, behavior, npc, combat };
}

describe('M3 3D · 倒地掉落端到端', () => {
  it('战斗倒地掉 1~3 件 → NPC 拾取 → 击杀返还', () => {
    const world = makeWorld();
    world.combat.handlePlayerDeath(world.player);

    expect(world.ground).toHaveLength(1);
    const dropped = world.ground[0];
    expect(dropped.ownerId).toBe('player');
    expect(dropped.downedDrop).toBe(true);
    expect(dropped.expiresAtDay).toBe(3);
    expect(world.inventory.getItemCount('material.herb')).toBe(0);

    const picked = world.behavior.update({
      npcs: [world.npc],
      groundItems: world.entities,
      removeGroundItem: entity => world.service.removeGroundDrop(entity)
    });
    expect(picked.picked).toHaveLength(1);
    expect(world.ground).toHaveLength(0);
    expect(world.npc.lootTable[0]).toMatchObject({ itemId: 'material.herb', chance: 1 });

    const loot = world.combat.generateLoot(world.npc);
    expect(loot).toEqual([{ itemId: 'material.herb', name: 'material.herb', quantity: 4 }]);
  });

  it('剧情倒地（plotCause=story）经钩子判定为豁免，不掉落', () => {
    const world = makeWorld();
    world.player.plotCause = 'story';
    world.combat.setDownedDropCallback(({ player }) => world.service.dropAll({
      player,
      cause: player?.plotCause === 'story' ? 'story' : 'combat'
    }));

    world.combat.handlePlayerDeath(world.player);

    expect(world.ground).toHaveLength(0);
    expect(world.inventory.getItemCount('material.herb')).toBe(4);
  });

  it('倒地钩子异常不阻断死亡结算回调', () => {
    const world = makeWorld();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let resolved = false;
    world.combat.setOnPlayerDeathCallback(() => {
      resolved = true;
      return true;
    });
    world.combat.setDownedDropCallback(() => {
      throw new Error('drop failed');
    });

    expect(() => world.combat.handlePlayerDeath(world.player)).not.toThrow();
    expect(resolved).toBe(true);
    expect(world.player.isDead).toBe(true);
    warn.mockRestore();
  });
});

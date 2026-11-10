/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

/**
 * M3 3D 倒地掉落服务：抽取/排除/豁免/归属时限/夺回/到期。
 */

import { describe, expect, it, vi } from 'vitest';
import { InventoryComponent } from '../ecs/components/InventoryComponent.js';
import { DownedDropService, DOWNED_DROP_EVENT } from './DownedDropService.js';

const rngFrom = (values, fallback = 0.5) => {
  let index = 0;
  return () => {
    if (index < values.length) return values[index++];
    return fallback;
  };
};

function makePlayer() {
  const inventory = new InventoryComponent({ maxSlots: 12 });
  const components = {
    inventory,
    equipment: { slots: { mainhand: { id: 'weapon.sword', instanceId: 'eq-sword' } } },
    transform: { position: { x: 100, y: 60 } }
  };
  return {
    id: 'player',
    isDead: false,
    components,
    addItem: (item, quantity) => inventory.addItem(item, quantity),
    getComponent(name) {
      return components[name] || null;
    }
  };
}

function makeService(player, options = {}) {
  const events = [];
  const drops = [];
  const service = new DownedDropService({
    getInventory: owner => owner.getComponent('inventory'),
    getEquipment: owner => owner.getComponent('equipment'),
    createGroundDrop: request => {
      const entity = { id: request.entityId, transform: request.transform, runtimeState: request.runtimeState };
      drops.push(entity);
      return entity;
    },
    removeGroundDrop: entity => {
      const index = drops.indexOf(entity);
      if (index >= 0) drops.splice(index, 1);
    },
    publishEvent: (event, payload) => events.push({ event, payload }),
    getDay: () => 2,
    rng: rngFrom([0.99, 0.1, 0.2, 0.3, 0.4, 0.5]),
    config: { minItems: 1, maxItems: 3, ownerExpiryDays: 2, spreadRadius: 0 },
    ...options
  });
  return { service, events, drops };
}

function seedEligible(player) {
  const inventory = player.getComponent('inventory');
  inventory.addItem({ id: 'weapon.axe', definitionId: 'weapon.axe', type: 'equipment', maxStack: 1, instanceId: 'axe-1' }, 1);
  inventory.addItem({ id: 'material.herb', definitionId: 'material.herb', type: 'material', maxStack: 20 }, 5);
  inventory.addItem({ id: 'consumable.potion', definitionId: 'consumable.potion', type: 'consumable', maxStack: 10 }, 3);
  inventory.addItem({ id: 'currency.coin', definitionId: 'currency.coin', type: 'currency', maxStack: 999 }, 100);
  inventory.addItem({ id: 'quest.token', definitionId: 'quest.token', type: 'quest', questItem: true, maxStack: 1 }, 1);
  // 已穿戴：不应掉落
  inventory.addItem({ id: 'weapon.sword', definitionId: 'weapon.sword', type: 'equipment', maxStack: 1, instanceId: 'eq-sword' }, 1);
}

describe('DownedDropService · 倒地掉落（M3 3D）', () => {
  it('抽 1~3 件、已穿戴/货币/任务物品不掉、附带归属与 2 日时限', () => {
    const player = makePlayer();
    seedEligible(player);
    const { service, events, drops } = makeService(player);

    const result = service.dropAll({ player, cause: 'combat' });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.dropped).toHaveLength(3);
    const definitions = result.dropped.map(entry => entry.definitionId);
    expect(definitions).toContain('weapon.axe');
    expect(definitions).not.toContain('weapon.sword');
    expect(definitions).not.toContain('currency.coin');
    expect(definitions).not.toContain('quest.token');
    for (const entity of drops) {
      expect(entity.ownerId).toBe('player');
      expect(entity.downedDrop).toBe(true);
      expect(entity.droppedAtDay).toBe(2);
      expect(entity.expiresAtDay).toBe(4);
    }
    const inventory = player.getComponent('inventory');
    expect(inventory.getItemCount('weapon.axe')).toBe(0);
    expect(inventory.getItemCount('material.herb')).toBe(0);
    expect(inventory.getItemCount('currency.coin')).toBe(100);
    expect(inventory.getItemCount('quest.token')).toBe(1);
    expect(inventory.getItemCount('weapon.sword')).toBe(1);
    expect(events.map(entry => entry.event)).toEqual([DOWNED_DROP_EVENT.DROPPED]);
    expect(events[0].payload.items).toHaveLength(3);
  });

  it('最少抽 1 件（rng 低值）', () => {
    const player = makePlayer();
    seedEligible(player);
    const { service } = makeService(player, { rng: rngFrom([0, 0.9, 0.8, 0.7]) });
    const result = service.dropAll({ player });
    expect(result.count).toBe(1);
  });

  it('剧情豁免：cause=story 不抽取、不发事件', () => {
    const player = makePlayer();
    seedEligible(player);
    const { service, events, drops } = makeService(player);
    const result = service.dropAll({ player, cause: 'story' });
    expect(result).toMatchObject({ ok: true, exempt: true, count: 0 });
    expect(drops).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(player.getComponent('inventory').getItemCount('material.herb')).toBe(5);
  });

  it('背包为空时安全返回空结果', () => {
    const player = makePlayer();
    const { service } = makeService(player);
    expect(service.dropAll({ player })).toMatchObject({ ok: true, count: 0, dropped: [] });
  });

  it('投影失败回滚：物品回到背包、不产生事件', () => {
    const player = makePlayer();
    seedEligible(player);
    const { service, events } = makeService(player, { createGroundDrop: () => null });
    const result = service.dropAll({ player });
    expect(result.count).toBe(0);
    expect(events).toHaveLength(0);
    expect(player.getComponent('inventory').getItemCount('material.herb')).toBe(5);
  });

  it('夺回：背包只接收部分，余量返回调用方', () => {
    const player = makePlayer();
    const inventory = player.getComponent('inventory');
    inventory.addItem({ id: 'material.herb', definitionId: 'material.herb', type: 'material', maxStack: 3 }, 2);
    inventory.slots.length = 1;
    const { service, events } = makeService(player, {
      rng: rngFrom([0]),
      resolveItem: () => ({ id: 'material.herb', maxStack: 3 })
    });
    const result = service.recover({
      player,
      entries: [{ definitionId: 'material.herb', quantity: 5 }]
    });
    expect(result.ok).toBe(true);
    expect(result.accepted).toEqual([{ definitionId: 'material.herb', quantity: 1 }]);
    expect(result.remainder).toEqual([{ definitionId: 'material.herb', quantity: 4 }]);
    expect(inventory.getItemCount('material.herb')).toBe(3);
    expect(events.map(entry => entry.event)).toEqual([DOWNED_DROP_EVENT.RECOVERED]);
  });

  it('到期：第 4 日移除、第 3 日保留', () => {
    const player = makePlayer();
    seedEligible(player);
    const { service, drops } = makeService(player);
    service.dropAll({ player });
    const kept = service.expire({ day: 3, drops: [...drops] });
    expect(kept.removed).toHaveLength(0);
    expect(drops).toHaveLength(3);
    const removed = service.expire({ day: 4, drops: [...drops] });
    expect(removed.removed).toHaveLength(3);
    expect(drops).toHaveLength(0);
  });

  it('实例物品保持 instanceId 与 mutable（不按定义合并）', () => {
    const player = makePlayer();
    const inventory = player.getComponent('inventory');
    inventory.addItem({
      id: 'weapon.dagger',
      definitionId: 'weapon.dagger',
      type: 'equipment',
      maxStack: 1,
      instanceId: 'dagger-1',
      durability: 40
    }, 1);
    const { service } = makeService(player, { config: { minItems: 1, maxItems: 1, spreadRadius: 0 } });
    const result = service.dropAll({ player });
    const state = result.dropped[0].entity.runtimeState;
    expect(state).toMatchObject({ definitionId: 'weapon.dagger', instanceId: 'dagger-1' });
    expect(state.mutable).toMatchObject({ durability: 40 });
  });

  it('未提供投影适配器时不崩溃（只警告并回滚）', () => {
    const player = makePlayer();
    seedEligible(player);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new DownedDropService({
      getInventory: owner => owner.getComponent('inventory'),
      getEquipment: owner => owner.getComponent('equipment'),
      createGroundDrop: null,
      config: { minItems: 1, maxItems: 3, spreadRadius: 0 },
      rng: rngFrom([0.99])
    });
    const result = service.dropAll({ player });
    expect(result.count).toBe(0);
    expect(player.getComponent('inventory').getItemCount('material.herb')).toBe(5);
    warn.mockRestore();
  });
});

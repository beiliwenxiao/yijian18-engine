/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { SupplySystem } from './SupplySystem.js';
import { InventoryTransactionService } from './InventoryTransactionService.js';

const clone = value => JSON.parse(JSON.stringify(value));

const ITEM_DEFS = {
  'resource.food': { id: 'resource.food', name: '粮食', type: 'resource', maxStack: 999 },
  'resource.wood': { id: 'resource.wood', name: '木材', type: 'resource', maxStack: 999 },
  'resource.iron': { id: 'resource.iron', name: '铁料', type: 'resource', maxStack: 999 },
  'resource.herb': { id: 'resource.herb', name: '草药', type: 'resource', maxStack: 999 }
};

const SUPPLY_CONFIG = {
  playerFactionId: 'yellow_turban',
  quotas: [
    { rank: 1, daily: { food: 6, wood: 4, iron: 2, herb: 1 } },
    { rank: 5, daily: { food: 12, wood: 8, iron: 4, herb: 2 } }
  ],
  cityModifiers: {
    buildingLevelBonus: 0.1,
    buildingLevelBonusCap: 0.5,
    lowMoraleThreshold: 30,
    lowMoraleMultiplier: 0.7
  },
  carryLimits: { personalMaxWeight: 10 },
  resourceWeights: { food: 1, wood: 2, iron: 3, herb: 1 }
};

function createInventory(capacity = 12) {
  const inventory = {
    slots: Array.from({ length: capacity }, () => null),
    addItem(item, quantity = 1) {
      const maxStack = Math.max(1, Number(item.maxStack) || 999);
      let remaining = quantity;
      for (const stack of this.slots) {
        if (!stack || stack.item.id !== item.id) continue;
        const added = Math.min(remaining, Math.max(0, maxStack - stack.quantity));
        stack.quantity += added;
        remaining -= added;
        if (remaining <= 0) return quantity;
      }
      for (let index = 0; index < this.slots.length && remaining > 0; index++) {
        if (this.slots[index]) continue;
        const added = Math.min(remaining, maxStack);
        this.slots[index] = { item: clone(item), quantity: added };
        remaining -= added;
      }
      return quantity - remaining;
    },
    removeItem(itemId, quantity = 1) {
      let remaining = quantity;
      for (let index = this.slots.length - 1; index >= 0 && remaining > 0; index--) {
        const stack = this.slots[index];
        if (!stack || stack.item.id !== itemId) continue;
        const removed = Math.min(remaining, stack.quantity);
        stack.quantity -= removed;
        remaining -= removed;
        if (stack.quantity <= 0) this.slots[index] = null;
      }
      return quantity - remaining;
    },
    getItemCount(itemId) {
      return this.slots.reduce((sum, stack) => sum + (stack?.item?.id === itemId ? stack.quantity : 0), 0);
    },
    loadItems(snapshot) {
      this.slots = Array.from({ length: capacity }, (_, index) => {
        const stack = (snapshot || [])[index];
        return stack ? { item: clone(stack.item), quantity: stack.quantity } : null;
      });
    }
  };
  return inventory;
}

function createCities() {
  return [
    {
      id: 'city.s01.camp',
      name: '营地',
      factionId: 'yellow_turban',
      resources: { food: 20, wood: 10, iron: 6, herb: 3 },
      morale: 60,
      buildingLevel: 0,
      damageRatio: 0
    },
    {
      id: 'city.han.front',
      name: '汉军前营',
      factionId: 'han',
      resources: { food: 99, wood: 99, iron: 99, herb: 99 },
      morale: 60,
      buildingLevel: 0
    }
  ];
}

function createHarness({ config = SUPPLY_CONFIG, cities = createCities() } = {}) {
  const state = { cities, day: 1 };
  const events = [];
  const inventoryTransactions = new InventoryTransactionService();
  const system = new SupplySystem({
    readCities: () => clone(state.cities),
    commitCities: draft => {
      state.cities = clone(draft);
      return true;
    },
    inventoryTransactions,
    itemResolver: id => clone(ITEM_DEFS[id] || null),
    getDay: () => state.day,
    config,
    onEvent: (event, payload) => events.push({ event, payload })
  });
  return { system, state, events, inventoryTransactions };
}

const foodOf = (state, cityId = 'city.s01.camp') =>
  state.cities.find(city => city.id === cityId)?.resources?.food ?? 0;

describe('M2 · SupplySystem 配给额度', () => {
  it('额度内领取：城池扣减、背包增加、额度累计并发送事件', () => {
    const { system, state, events } = createHarness();
    const inventory = createInventory();

    const result = system.requisition({
      cityId: 'city.s01.camp',
      characterId: 'player',
      rank: 1,
      items: { food: 4 },
      inventory,
      operationId: 'req-1'
    });

    expect(result).toMatchObject({ ok: true, status: 'DELIVERED', destination: 'personal' });
    expect(result.items).toEqual({ food: 4 });
    expect(foodOf(state)).toBe(16);
    expect(inventory.getItemCount('resource.food')).toBe(4);
    expect(events.map(entry => entry.event)).toEqual(
      expect.arrayContaining(['supply.requisitioned', 'supply.delivered'])
    );
    const requisitioned = events.find(entry => entry.event === 'supply.requisitioned');
    expect(requisitioned.payload).toMatchObject({ cityId: 'city.s01.camp', quantity: 4, destination: 'personal' });

    const snapshot = system.open({ cityId: 'city.s01.camp', characterId: 'player', rank: 1 });
    expect(snapshot.quota.remaining.food).toBe(2);
    expect(snapshot.quota.used.food).toBe(4);
  });

  it('同一天超额领取被拒（quotaExceeded），城库存不变', () => {
    const { system, state } = createHarness();
    const inventory = createInventory();
    system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1, items: { food: 6 }, inventory, operationId: 'req-full'
    });
    const before = foodOf(state);

    const result = system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1, items: { food: 1 }, inventory, operationId: 'req-over'
    });

    expect(result).toMatchObject({ ok: false, code: 'quotaExceeded' });
    expect(foodOf(state)).toBe(before);
  });

  it('城库存不足按剩余发放并标记 partial', () => {
    const cities = createCities();
    cities[0].resources.food = 3;
    const { system, state } = createHarness({ cities });
    const inventory = createInventory();

    const result = system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1, items: { food: 5 }, inventory, operationId: 'req-scarce'
    });

    expect(result).toMatchObject({ ok: true, partial: true });
    expect(result.items).toEqual({ food: 3 });
    expect(foodOf(state)).toBe(0);
    expect(result.shortages[0]).toMatchObject({ resource: 'food', reason: 'insufficientCityStock' });
  });

  it('跨日额度刷新', () => {
    const { system, state } = createHarness();
    const inventory = createInventory();
    system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1, items: { food: 6 }, inventory, operationId: 'req-day1'
    });
    expect(system.open({ cityId: 'city.s01.camp', characterId: 'player', rank: 1 }).quota.remaining.food).toBe(0);

    state.day = 2;
    expect(system.open({ cityId: 'city.s01.camp', characterId: 'player', rank: 1 }).quota.remaining.food).toBe(6);
  });

  it('非己方城池被拒', () => {
    const { system, state } = createHarness();
    const result = system.requisition({
      cityId: 'city.han.front', characterId: 'player', rank: 1, items: { food: 1 },
      inventory: createInventory(), operationId: 'req-enemy'
    });
    expect(result).toMatchObject({ ok: false, code: 'cityNotOwned' });
    expect(foodOf(state, 'city.han.front')).toBe(99);
  });

  it('随身超过负重上限要求押运（convoyRequired），不扣库存', () => {
    const { system, state } = createHarness();
    const result = system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1,
      items: { wood: 4, iron: 2 },
      inventory: createInventory(), operationId: 'req-heavy'
    });
    expect(result).toMatchObject({ ok: false, code: 'convoyRequired', weight: 14, maxWeight: 10 });
    expect(foodOf(state)).toBe(20);
  });

  it('等级更高档位与城池修正生效', () => {
    const cities = createCities();
    cities[0].buildingLevel = 2;
    cities[0].morale = 20;
    const { system } = createHarness({ cities });
    const snapshot = system.open({ cityId: 'city.s01.camp', characterId: 'player', rank: 5 });
    // 12 * (1 + 0.2) * 0.7 = 10.08 → 10
    expect(snapshot.quota.rank).toBe(5);
    expect(snapshot.quota.daily.food).toBe(10);
  });
});

describe('M2 · SupplySystem 押运单与幂等', () => {
  it('押运目的地只落 APPROVED 单，城已扣、背包未加', () => {
    const { system, state } = createHarness();
    const inventory = createInventory();

    const result = system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1,
      items: { wood: 4, iron: 2 }, destination: 'convoy', operationId: 'req-convoy'
    });

    expect(result).toMatchObject({ ok: true, status: 'APPROVED', destination: 'convoy' });
    expect(foodOf(state)).toBe(20);
    expect(state.cities[0].resources.wood).toBe(6);
    expect(inventory.getItemCount('resource.wood')).toBe(0);
    expect(system.getOrder(result.orderId)).toMatchObject({ status: 'APPROVED', destination: 'convoy' });
  });

  it('取消 APPROVED 单：城库存与额度双退；已装车不可取消', () => {
    const { system, state } = createHarness();
    const order = system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1,
      items: { food: 4 }, destination: 'convoy', operationId: 'req-cancel'
    });
    expect(foodOf(state)).toBe(16);

    const cancelled = system.cancel({ orderId: order.orderId, operationId: 'cancel-1' });
    expect(cancelled).toMatchObject({ ok: true, status: 'CANCELLED' });
    expect(cancelled.refunded).toEqual({ food: 4 });
    expect(foodOf(state)).toBe(20);
    expect(system.open({ cityId: 'city.s01.camp', characterId: 'player', rank: 1 }).quota.remaining.food).toBe(6);

    const loaded = system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1,
      items: { herb: 1 }, destination: 'convoy', operationId: 'req-loaded'
    });
    expect(system.transitionOrder(loaded.orderId, 'LOADING').ok).toBe(true);
    expect(system.cancel({ orderId: loaded.orderId, operationId: 'cancel-2' }))
      .toMatchObject({ ok: false, code: 'orderNotCancellable' });
  });

  it('重复 operationId 幂等，不双扣城库存', () => {
    const { system, state } = createHarness();
    const inventory = createInventory();
    const payload = {
      cityId: 'city.s01.camp', characterId: 'player', rank: 1, items: { food: 4 },
      inventory, operationId: 'req-idem'
    };
    const first = system.requisition(payload);
    const second = system.requisition(payload);

    expect(second).toMatchObject({ ok: true, idempotent: true, orderId: first.orderId });
    expect(foodOf(state)).toBe(16);
    expect(inventory.getItemCount('resource.food')).toBe(4);
  });

  it('快照序列化往返后额度与订单保留', () => {
    const { system } = createHarness();
    const inventory = createInventory();
    const order = system.requisition({
      cityId: 'city.s01.camp', characterId: 'player', rank: 1,
      items: { food: 4 }, destination: 'convoy', operationId: 'req-snapshot'
    });
    const serialized = JSON.parse(JSON.stringify(system.serialize()));

    const { system: restored } = createHarness();
    expect(restored.deserialize(serialized).ok).toBe(true);
    expect(restored.getOrder(order.orderId)).toMatchObject({ status: 'APPROVED', items: { food: 4 } });
    expect(restored.open({ cityId: 'city.s01.camp', characterId: 'player', rank: 1 }).quota.used.food).toBe(4);
  });
});

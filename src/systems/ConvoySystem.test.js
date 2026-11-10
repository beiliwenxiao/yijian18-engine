/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { ConvoySystem } from './ConvoySystem.js';
import { InventoryTransactionService } from './InventoryTransactionService.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

const ITEM_DEFS = {
  'resource.food': { id: 'resource.food', name: '粮食', type: 'resource', maxStack: 999 },
  'resource.wood': { id: 'resource.wood', name: '木材', type: 'resource', maxStack: 999 }
};

const TEMPLATES = {
  'convoy.light_cart': {
    id: 'convoy.light_cart',
    name: '轻车押运队',
    vehicleRef: 'vehicle.s14.lastCart',
    escort: { count: 2, ref: 'enemy.s02_yellow_turban_soldier' },
    speed: { base: 90, loadedMultiplier: 0.7 },
    cargoCapacity: 80
  }
};

const AMBUSH_CONFIG = {
  baseChance: 0.35,
  escortMitigation: 0.4,
  escortThreshold: 3,
  fleeLossRatio: 0.3,
  defeatLossRatio: 0.5,
  recoverableRatio: 0.25,
  lootDropRatio: 0.5,
  recoveryWindowDays: 2,
  firstConvoySafe: true
};

function createInventory(capacity = 12) {
  return {
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
}

function createHarness({ day = 1, rng = () => 0.99, ambushConfig = AMBUSH_CONFIG } = {}) {
  const inventoryTransactions = new InventoryTransactionService();
  const cargo = createInventory();
  const stash = createInventory();
  const personal = createInventory();
  const orders = new Map();
  const loots = [];
  const events = [];
  const state = { day };
  const system = new ConvoySystem({
    inventoryTransactions,
    itemResolver: id => clone(ITEM_DEFS[id] || null),
    resolveTemplate: id => clone(TEMPLATES[id] || null),
    resolveOrder: id => orders.get(id) || null,
    notifyOrder: (orderId, status) => {
      const order = orders.get(orderId);
      if (order) order.status = status;
    },
    resolveStash: id => (id === 'stash.s01' ? stash : null),
    resolveCargo: id => (id === 'vehicle-1:cargo' ? cargo : null),
    onLootDrop: payload => loots.push(payload),
    onEvent: (event, payload) => events.push({ event, payload }),
    rng,
    getDay: () => state.day,
    ambushConfig
  });
  const addOrder = (orderId, items, status = 'APPROVED') => {
    orders.set(orderId, { orderId, items: clone(items), status });
    return orders.get(orderId);
  };
  return { system, state, cargo, stash, personal, orders, loots, events, addOrder };
}

const assemble = (system, overrides = {}) => system.assemble({
  templateId: 'convoy.light_cart',
  convoyId: 'convoy-1',
  vehicleEntityId: 'vehicle-1',
  cargoInventory: overrides.cargoInventory,
  operationId: 'assemble-1',
  ...overrides
});

describe('M2 · ConvoySystem 装配 / 装车 / 出发', () => {
  it('装配绑定货舱进入 STAGING；模板缺失或货舱不可用被拒', () => {
    const { system, cargo, events } = createHarness();
    expect(system.assemble({ templateId: 'convoy.missing', cargoInventory: cargo, operationId: 'a0' }))
      .toMatchObject({ ok: false, code: 'unknownTemplate' });
    expect(system.assemble({ templateId: 'convoy.light_cart', operationId: 'a1' }))
      .toMatchObject({ ok: false, code: 'cargoUnavailable' });

    const result = assemble(system);
    expect(result).toMatchObject({ ok: true, convoyId: 'convoy-1', status: 'STAGING' });
    expect(events.some(entry => entry.event === 'convoy.assembled')).toBe(true);
  });

  it('装车把订单条目搬入货舱并推进订单到 LOADING', () => {
    const { system, cargo, orders, addOrder, events } = createHarness();
    assemble(system, { cargoInventory: cargo });
    addOrder('order-1', { 'resource.food': 10 });

    const result = system.load({ convoyId: 'convoy-1', orderId: 'order-1', operationId: 'load-1' });

    expect(result).toMatchObject({ ok: true, status: 'LOADING', loaded: [{ itemId: 'resource.food', quantity: 10 }] });
    expect(cargo.getItemCount('resource.food')).toBe(10);
    expect(orders.get('order-1').status).toBe('LOADING');
    expect(events.some(entry => entry.event === 'convoy.loaded')).toBe(true);
  });

  it('货舱容量不足返回 cargoFull，货舱不变', () => {
    const { system, addOrder } = createHarness();
    const cargo = createInventory(1);
    assemble(system, { cargoInventory: cargo });
    addOrder('order-1', { 'resource.food': 10, 'resource.wood': 5 });

    expect(system.load({ convoyId: 'convoy-1', orderId: 'order-1', operationId: 'load-full' }))
      .toMatchObject({ ok: false, code: 'cargoFull' });
    expect(cargo.getItemCount('resource.food')).toBe(0);
  });

  it('空货舱不可出发；装车后可出发并推进订单到 IN_TRANSIT', () => {
    const { system, cargo, orders, addOrder } = createHarness();
    assemble(system, { cargoInventory: cargo });
    addOrder('order-1', { 'resource.food': 6 });

    expect(system.dispatch({ convoyId: 'convoy-1' })).toMatchObject({ ok: false, code: 'cargoEmpty' });
    system.load({ convoyId: 'convoy-1', orderId: 'order-1', operationId: 'load-1' });
    expect(system.dispatch({ convoyId: 'convoy-1', operationId: 'dispatch-1' }))
      .toMatchObject({ ok: true, status: 'MARCHING' });
    expect(orders.get('order-1').status).toBe('IN_TRANSIT');
  });

  it('重复装车 operationId 幂等，不双加货物', () => {
    const { system, cargo, addOrder } = createHarness();
    assemble(system, { cargoInventory: cargo });
    addOrder('order-1', { 'resource.food': 6 });
    const payload = { convoyId: 'convoy-1', orderId: 'order-1', operationId: 'load-idem' };

    system.load(payload);
    const second = system.load(payload);

    expect(second).toMatchObject({ ok: true, idempotent: true });
    expect(cargo.getItemCount('resource.food')).toBe(6);
  });
});

describe('M2 · ConvoySystem 指令与伏击损失', () => {
  const prepare = ({ day = 1, rng = () => 0.99, food = 20 } = {}) => {
    const harness = createHarness({ day, rng });
    assemble(harness.system, { cargoInventory: harness.cargo });
    harness.addOrder('order-1', { 'resource.food': food });
    harness.system.load({ convoyId: 'convoy-1', orderId: 'order-1', operationId: 'load-1' });
    harness.system.dispatch({ convoyId: 'convoy-1', operationId: 'dispatch-1' });
    return harness;
  };

  it('follow / hold 不扣货，flee 立即扣 30% 并产生追回与掉落', () => {
    const { system, cargo, loots, events } = prepare({ food: 20 });

    expect(system.setOrder({ convoyId: 'convoy-1', order: 'follow', operationId: 'order-1' }))
      .toMatchObject({ ok: true, order: 'follow' });
    expect(cargo.getItemCount('resource.food')).toBe(20);

    const fled = system.setOrder({ convoyId: 'convoy-1', order: 'flee', operationId: 'order-2' });
    expect(fled.ok).toBe(true);
    expect(fled.loss.lost).toEqual([{ itemId: 'resource.food', quantity: 6 }]);
    expect(cargo.getItemCount('resource.food')).toBe(14);
    expect(fled.loss.recoverable).toEqual([{ itemId: 'resource.food', quantity: 1, expiresDay: 3 }]);
    expect(fled.loss.lootDropped).toEqual([{ itemId: 'resource.food', quantity: 3 }]);
    expect(loots[0]).toMatchObject({ convoyId: 'convoy-1', reason: 'flee' });
    expect(events.some(entry => entry.event === 'convoy.robbed')).toBe(true);
  });

  it('伏击失败按 50% 扣货并终结订单', () => {
    const { system, cargo, orders, loots } = prepare({ food: 20 });

    const result = system.resolveAmbush({ convoyId: 'convoy-1', result: 'lose', operationId: 'ambush-1' });

    expect(result).toMatchObject({ ok: true, result: 'lose', status: 'LOST' });
    expect(result.lost).toEqual([{ itemId: 'resource.food', quantity: 10 }]);
    expect(cargo.getItemCount('resource.food')).toBe(10);
    expect(orders.get('order-1').status).toBe('LOST');
    expect(loots[0]).toMatchObject({ reason: 'lose', expiresDay: 3 });
    expect(loots[0].entries).toEqual([{ itemId: 'resource.food', quantity: 5 }]);

    expect(system.resolveAmbush({ convoyId: 'convoy-1', result: 'win', operationId: 'ambush-2' }))
      .toMatchObject({ ok: true, lost: [] });
  });

  it('载具被毁扣掉全部在途货物', () => {
    const { system, cargo } = prepare({ food: 12 });

    const result = system.resolveAmbush({
      convoyId: 'convoy-1', result: 'lose', vehicleDestroyed: true, operationId: 'ambush-destroy'
    });

    expect(result).toMatchObject({ ok: true, status: 'DESTROYED' });
    expect(result.lost).toEqual([{ itemId: 'resource.food', quantity: 12 }]);
    expect(cargo.getItemCount('resource.food')).toBe(0);
  });

  it('追回在 2 日窗口内返还，过期拒绝', () => {
    const { system, cargo, state } = prepare({ food: 20 });
    system.resolveAmbush({ convoyId: 'convoy-1', result: 'lose', operationId: 'ambush-1' });

    state.day = 4;
    expect(system.recover({ convoyId: 'convoy-1', operationId: 'recover-late' }))
      .toMatchObject({ ok: false, code: 'recoveryExpired' });

    const fresh = prepare({ food: 20 });
    fresh.system.resolveAmbush({ convoyId: 'convoy-1', result: 'lose', operationId: 'ambush-1' });
    const recovered = fresh.system.recover({ convoyId: 'convoy-1', operationId: 'recover-ok' });
    expect(recovered).toMatchObject({ ok: true, recovered: [{ itemId: 'resource.food', quantity: 2 }] });
    expect(fresh.cargo.getItemCount('resource.food')).toBe(12);
  });

  it('伏击掷骰注入 rng：首单保护 + 护卫减伤', () => {
    const first = createHarness({ rng: () => 0 });
    assemble(first.system, { cargoInventory: first.cargo });
    expect(first.system.rollAmbush({ convoyId: 'convoy-1' }))
      .toMatchObject({ ok: true, ambushed: false, firstConvoy: true });
    expect(first.system.rollAmbush({ convoyId: 'convoy-1' })).toMatchObject({ chance: 0.35, ambushed: true });
    expect(first.system.rollAmbush({ convoyId: 'convoy-1', escortCount: 3 }))
      .toMatchObject({ chance: 0, ambushed: false });
  });
});

describe('M2 · ConvoySystem 卸货与快照', () => {
  const prepareLoaded = () => {
    const harness = createHarness();
    assemble(harness.system, { cargoInventory: harness.cargo });
    harness.addOrder('order-1', { 'resource.food': 8 });
    harness.system.load({ convoyId: 'convoy-1', orderId: 'order-1', operationId: 'load-1' });
    harness.system.dispatch({ convoyId: 'convoy-1', operationId: 'dispatch-1' });
    return harness;
  };

  it('卸到个人背包：目标 +N、货舱清空、订单 DELIVERED、发 convoy.arrived', () => {
    const { system, cargo, personal, orders, events } = prepareLoaded();

    const result = system.unload({
      convoyId: 'convoy-1', target: 'personal', inventory: personal, operationId: 'unload-1'
    });

    expect(result).toMatchObject({ ok: true, target: 'personal', status: 'DELIVERED' });
    expect(personal.getItemCount('resource.food')).toBe(8);
    expect(cargo.getItemCount('resource.food')).toBe(0);
    expect(orders.get('order-1').status).toBe('DELIVERED');
    expect(events.some(entry => entry.event === 'convoy.arrived')).toBe(true);
  });

  it('卸到寨仓：按 stashId 解析目标容器', () => {
    const { system, stash } = prepareLoaded();

    const result = system.unload({ convoyId: 'convoy-1', target: 'stash', stashId: 'stash.s01', operationId: 'unload-stash' });

    expect(result).toMatchObject({ ok: true, target: 'stash', stashId: 'stash.s01' });
    expect(stash.getItemCount('resource.food')).toBe(8);
  });

  it('快照序列化往返后状态与货物保留，重绑货舱后可继续卸货', () => {
    const { system } = prepareLoaded();
    const serialized = JSON.parse(JSON.stringify(system.serialize()));

    const fresh = createHarness();
    const restored = new ConvoySystem({
      inventoryTransactions: fresh.system.inventoryTransactions,
      itemResolver: id => clone(ITEM_DEFS[id] || null),
      resolveTemplate: id => clone(TEMPLATES[id] || null),
      resolveCargo: id => (id === 'vehicle-1:cargo' ? fresh.cargo : null),
      resolveStash: () => fresh.stash,
      getDay: () => 1
    });
    expect(restored.deserialize(serialized, { resolveCargo: id => (id === 'vehicle-1:cargo' ? fresh.cargo : null) }).ok).toBe(true);
    expect(restored.getConvoy('convoy-1')).toMatchObject({ status: 'MARCHING', cargo: [{ itemId: 'resource.food', quantity: 8 }] });

    // 场景侧货舱库存独立随档保存：重建后先恢复货舱内容，再继续卸货
    fresh.cargo.addItem(clone(ITEM_DEFS['resource.food']), 8);
    const unloaded = restored.unload({
      convoyId: 'convoy-1', target: 'stash', stashId: 'stash.s01', operationId: 'unload-restored'
    });
    expect(unloaded).toMatchObject({ ok: true });
    expect(fresh.stash.getItemCount('resource.food')).toBe(8);
  });
});

describe('M3 3A · ConvoySystem 载具物理生成与落点校验（§6.1）', () => {
  function createSpawnHarness({ blocked = () => false, spawnFails = false } = {}) {
    const inventoryTransactions = new InventoryTransactionService();
    const cargo = createInventory();
    const spawned = [];
    const checks = [];
    const system = new ConvoySystem({
      inventoryTransactions,
      itemResolver: id => clone(ITEM_DEFS[id] || null),
      resolveTemplate: id => clone(TEMPLATES[id] || null),
      resolveCargo: id => (id === 'convoy-1:vehicle:cargo' ? cargo : null),
      resolveSpawnPosition: (candidate, radius) => {
        checks.push({ candidate: clone(candidate), radius });
        return blocked(candidate) ? null : candidate;
      },
      spawnVehicleEntity: ({ definitionId, position, convoyId }) => {
        if (spawnFails) return { ok: false, code: 'unknownVehicle' };
        spawned.push({ definitionId, position: clone(position), convoyId });
        return { ok: true, vehicleEntityId: `${convoyId}:vehicle`, cargoId: `${convoyId}:vehicle:cargo` };
      },
      getDay: () => 1
    });
    return { system, cargo, spawned, checks };
  }

  it('给 vehicleDefinitionId 时先生成载具再装配，落点写入 spawnPosition', () => {
    const { system, spawned } = createSpawnHarness();
    const result = system.assemble({
      templateId: 'convoy.light_cart',
      convoyId: 'convoy-1',
      vehicleDefinitionId: 'vehicle.s14.lastCart',
      position: { x: 120, y: 80 },
      operationId: 'spawn-1'
    });
    expect(result).toMatchObject({ ok: true, convoyId: 'convoy-1', status: 'STAGING' });
    expect(spawned).toEqual([{ definitionId: 'vehicle.s14.lastCart', position: { x: 120, y: 80 }, convoyId: 'convoy-1' }]);
    expect(system.getConvoy('convoy-1')).toMatchObject({
      vehicleEntityId: 'convoy-1:vehicle',
      vehicleDefinitionId: 'vehicle.s14.lastCart',
      spawnPosition: { x: 120, y: 80 }
    });
  });

  it('指定点非法时从 marker 落点取可用点，并在 48px 内就近采样', () => {
    const markerOnly = createSpawnHarness({ blocked: candidate => candidate.x !== 300 });
    expect(markerOnly.system.assemble({
      templateId: 'convoy.light_cart',
      convoyId: 'convoy-1',
      vehicleDefinitionId: 'vehicle.s14.lastCart',
      position: { x: 100, y: 100 },
      spawnPosition: { x: 300, y: 100 },
      operationId: 'spawn-2'
    }).ok).toBe(true);
    expect(markerOnly.spawned[0].position).toEqual({ x: 300, y: 100 });

    // 全阻挡 → 以最后候选点为圆心 8 方向 × 2 圈采样，第一圈 24px
    const sampled = createSpawnHarness({ blocked: () => true });
    const sampledBlocked = createSpawnHarness({
      blocked: candidate => {
        const distance = Math.hypot(candidate.x - 100, candidate.y - 100);
        return distance < 10 || distance > 30;
      }
    });
    expect(sampled.system.assemble({
      templateId: 'convoy.light_cart', convoyId: 'convoy-1',
      vehicleDefinitionId: 'vehicle.s14.lastCart', position: { x: 100, y: 100 }, operationId: 'spawn-3'
    })).toMatchObject({ ok: false, code: 'vehicleSpawnBlocked' });
    expect(sampled.spawned).toHaveLength(0);
    expect(sampledBlocked.system.assemble({
      templateId: 'convoy.light_cart', convoyId: 'convoy-1',
      vehicleDefinitionId: 'vehicle.s14.lastCart', position: { x: 100, y: 100 }, operationId: 'spawn-4'
    }).ok).toBe(true);
    expect(sampledBlocked.checks.length).toBeGreaterThan(1);
  });

  it('校验失败不创建车队、不消耗 operationId；生成失败给出明确 code', () => {
    const blockedHarness = createSpawnHarness({ blocked: () => true });
    const failed = blockedHarness.system.assemble({
      templateId: 'convoy.light_cart',
      convoyId: 'convoy-1',
      vehicleDefinitionId: 'vehicle.s14.lastCart',
      position: { x: 10, y: 10 },
      operationId: 'spawn-fail'
    });
    expect(failed).toMatchObject({ ok: false, code: 'vehicleSpawnBlocked' });
    expect(blockedHarness.system.getConvoy('convoy-1')).toBeNull();
    // 失败不消耗 operationId：同一 operationId 在可用落点仍可成功装配
    const retryHarness = createSpawnHarness();
    expect(retryHarness.system.assemble({
      templateId: 'convoy.light_cart', convoyId: 'convoy-1',
      vehicleDefinitionId: 'vehicle.s14.lastCart', position: { x: 10, y: 10 }, operationId: 'spawn-fail'
    })).toMatchObject({ ok: true, convoyId: 'convoy-1' });

    const spawnFailHarness = createSpawnHarness({ spawnFails: true });
    expect(spawnFailHarness.system.assemble({
      templateId: 'convoy.light_cart', convoyId: 'convoy-1',
      vehicleDefinitionId: 'vehicle.s14.lastCart', position: { x: 1, y: 1 }, operationId: 'spawn-5'
    })).toMatchObject({ ok: false, code: 'unknownVehicle' });
    expect(spawnFailHarness.system.getConvoy('convoy-1')).toBeNull();
  });
});

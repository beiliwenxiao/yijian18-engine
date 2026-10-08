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

import { describe, expect, it, vi } from 'vitest';
import { Entity } from '../ecs/Entity.js';
import { InventoryComponent } from '../ecs/components/InventoryComponent.js';
import { EquipmentComponent } from '../ecs/components/EquipmentComponent.js';
import { StatsComponent } from '../ecs/components/StatsComponent.js';
import { TransformComponent } from '../ecs/components/TransformComponent.js';
import { ItemProjectionComponent } from '../ecs/components/ItemProjectionComponent.js';
import { EquipmentSystem } from './EquipmentSystem.js';
import { InventoryTransactionService } from './InventoryTransactionService.js';
import { ItemLifecycleService, ITEM_LIFECYCLE_COMMANDS } from './ItemLifecycleService.js';
import { PickupSystem } from './PickupSystem.js';
import { LocalAuthorityAdapter } from '../core/command/LocalAuthorityAdapter.js';
import { CommandGateway } from '../core/command/CommandGateway.js';
import { ProjectionStore } from '../core/command/ProjectionStore.js';

const DEFINITIONS = {
  sword: { id: 'sword', definitionId: 'sword', name: '铁剑', type: 'equipment', subType: 'weapon', maxStack: 1, stats: { attack: 5 } },
  bow: { id: 'bow', definitionId: 'bow', name: '木弓', type: 'equipment', subType: 'weapon', maxStack: 1, ranged: true, stats: { attack: 3 } },
  potion: { id: 'potion', definitionId: 'potion', name: '药水', type: 'consumable', maxStack: 10, usable: true, effect: { type: 'heal', value: 20 } },
  wood: { id: 'wood', definitionId: 'wood', name: '木材', type: 'material', maxStack: 99 }
};

function createActor({ maxSlots = 6 } = {}) {
  const actor = new Entity('player-1', 'player');
  actor.addComponent(new InventoryComponent({ maxSlots }));
  actor.addComponent(new EquipmentComponent());
  actor.addComponent(new StatsComponent({ hp: 50, maxHp: 100, mp: 20, maxMp: 50, attack: 10, defense: 2, speed: 4 }));
  actor.addComponent(new TransformComponent(10, 20));
  return actor;
}

function createGround(id, definitionId, quantity) {
  const entity = new Entity(id, 'loot');
  entity.addComponent(new TransformComponent(12, 20));
  entity.addComponent(new ItemProjectionComponent({ runtimeState: { definitionId, quantity } }));
  entity.quantity = quantity;
  entity.picked = false;
  return entity;
}

function createFixture(options = {}) {
  const actor = options.actor || createActor(options);
  const inventoryTransactions = new InventoryTransactionService();
  const worlds = new Map();
  const inventories = new Map([[`${actor.id}:inventory`, actor.getComponent('inventory')]]);
  const equipmentChanged = vi.fn();
  const itemUsed = vi.fn();
  const checkpoints = [];
  let checkpointOk = true;
  const service = new ItemLifecycleService({
    inventoryTransactions,
    equipmentSystem: new EquipmentSystem(),
    effectResolver: options.effectResolver || null,
    resolveActor: id => id === actor.id ? actor : null,
    resolveInventory: id => inventories.get(id) || null,
    resolveWorldItem: id => worlds.get(id) || null,
    resolveDefinition: id => DEFINITIONS[id] || null,
    createGroundDrop: ({ entityId, runtimeState, transform }) => {
      const ground = createGround(entityId, runtimeState.definitionId, runtimeState.quantity || 1);
      ground.getComponent('transform').position.x = transform.x;
      ground.getComponent('transform').position.y = transform.y;
      return ground;
    },
    addWorldEntity: entity => { worlds.set(entity.id, entity); return true; },
    removeWorldEntity: entity => worlds.delete(entity.id),
    createCheckpoint: checkpoint => { checkpoints.push(checkpoint); return { ok: checkpointOk }; },
    onEquipmentChanged: equipmentChanged,
    onItemUsed: itemUsed
  });
  const projectionStore = new ProjectionStore();
  projectionStore.registerReducer('itemLifecycle', (_current, event) => event.payload.projection);
  const authority = new LocalAuthorityAdapter({ projectionStore });
  for (const type of Object.values(ITEM_LIFECYCLE_COMMANDS)) authority.registerHandler(type, service);
  const gateway = new CommandGateway({ authorityPort: authority });
  const events = [];
  authority.notificationBus.subscribe(event => events.push(event));
  return {
    actor, service, gateway, authority, worlds, inventories, equipmentChanged,
    itemUsed, checkpoints, events, projectionStore,
    failCheckpoint: () => { checkpointOk = false; }
  };
}

describe('ItemLifecycleService command transactions', () => {
  it('通过 CommandGateway 装备真实 EquipmentSystem 并发布有序投影与兼容事件', async () => {
    const fixture = createFixture();
    fixture.actor.getComponent('inventory').addItem(DEFINITIONS.sword, 1);

    const result = await fixture.gateway.execute({
      intentType: 'item.equip', actorRef: fixture.actor.id, operationId: 'equip-1',
      payload: { itemId: 'sword' }
    });

    expect(result.ok).toBe(true);
    expect(result.value.slot).toBe('mainhand');
    expect(fixture.actor.getComponent('equipment').getEquipment('mainhand').id).toBe('sword');
    expect(fixture.actor.getComponent('inventory').getItemCount('sword')).toBe(0);
    expect(fixture.equipmentChanged).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      slot: 'mainhand', action: 'equip', item: expect.objectContaining({ id: 'sword' })
    }));
    expect(fixture.events.map(entry => entry.kind)).toEqual(['CommittedEvent', 'ApplicationEvent']);
    expect(fixture.projectionStore.get('itemLifecycle', `item-lifecycle:${fixture.actor.id}`)?.value.equipment.mainhand.id).toBe('sword');
  });

  it('背包满时卸装零修改', async () => {
    const fixture = createFixture({ maxSlots: 1 });
    const inventory = fixture.actor.getComponent('inventory');
    const equipment = fixture.actor.getComponent('equipment');
    inventory.addItem(DEFINITIONS.bow, 1);
    equipment.equip('mainhand', DEFINITIONS.sword);
    const beforeStats = fixture.actor.getComponent('stats').attack;

    const result = await fixture.gateway.execute({
      intentType: 'item.unequip', actorRef: fixture.actor.id, operationId: 'unequip-full',
      payload: { slot: 'mainhand' }
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('inventoryFull');
    expect(equipment.getEquipment('mainhand').id).toBe('sword');
    expect(inventory.getItemCount('bow')).toBe(1);
    expect(fixture.actor.getComponent('stats').attack).toBe(beforeStats);
    expect(fixture.events).toHaveLength(0);
  });

  it('checkpoint 失败回滚使用效果与库存且不发布事件', async () => {
    const effectResolver = { getValue: vi.fn(() => 25) };
    const fixture = createFixture({ effectResolver });
    const inventory = fixture.actor.getComponent('inventory');
    inventory.addItem(DEFINITIONS.potion, 1);
    fixture.failCheckpoint();

    const result = await fixture.gateway.execute({
      intentType: 'item.use', actorRef: fixture.actor.id, operationId: 'use-checkpoint-fail',
      payload: { itemId: 'potion', checkpointId: 'checkpoint.use' }
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('checkpointFailed');
    expect(inventory.getItemCount('potion')).toBe(1);
    expect(fixture.actor.getComponent('stats').hp).toBe(50);
    expect(effectResolver.getValue).toHaveBeenCalledOnce();
    expect(fixture.itemUsed).not.toHaveBeenCalled();
    expect(fixture.events).toHaveLength(0);
  });

  it('部分拾取保留地面余量且 transfer 原子复用库存事务', async () => {
    const actor = createActor({ maxSlots: 1 });
    const fixture = createFixture({ actor });
    const ground = createGround('ground-wood', 'wood', 120);
    fixture.worlds.set(ground.id, ground);

    const pickup = await fixture.gateway.execute({
      intentType: 'item.pickup', actorRef: actor.id, operationId: 'pickup-partial',
      payload: { groundId: ground.id, quantity: 120 }
    });
    expect(pickup.ok).toBe(true);
    expect(pickup.value.accepted).toBe(99);
    expect(ground.getComponent('itemProjection').quantity).toBe(21);
    expect(fixture.worlds.has(ground.id)).toBe(true);

    const target = new InventoryComponent({ maxSlots: 2 });
    fixture.inventories.set('cart:cargo', target);
    const transfer = await fixture.gateway.execute({
      intentType: 'item.transfer', actorRef: actor.id, operationId: 'transfer-1',
      payload: { sourceId: `${actor.id}:inventory`, targetId: 'cart:cargo', itemId: 'wood', quantity: 10 }
    });
    expect(transfer.ok).toBe(true);
    expect(transfer.value.accepted).toBe(10);
    expect(actor.getComponent('inventory').getItemCount('wood')).toBe(89);
    expect(target.getItemCount('wood')).toBe(10);
  });

  it('同 operationId 同 payload 重放而不同 payload 冲突且不重复提交', async () => {
    const fixture = createFixture();
    fixture.actor.getComponent('inventory').addItem(DEFINITIONS.potion, 2);
    const intent = {
      intentType: 'item.use', actorRef: fixture.actor.id, operationId: 'stable-use',
      payload: { itemId: 'potion' }
    };
    const first = await fixture.gateway.execute(intent);
    const replay = await fixture.gateway.execute(intent);
    const conflict = await fixture.gateway.execute({ ...intent, payload: { itemId: 'wood' } });

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({ ok: false, code: 'operationConflict' });
    expect(fixture.actor.getComponent('inventory').getItemCount('potion')).toBe(1);
    expect(fixture.itemUsed).toHaveBeenCalledTimes(1);
  });
});

describe('PickupSystem', () => {
  it('只检测候选并转发 item.pickup intent，不直接修改物品', async () => {
    const actor = createActor();
    const ground = createGround('ground-1', 'wood', 3);
    const execute = vi.fn(async () => ({ ok: true, committed: true }));
    const pickup = new PickupSystem({ commandGateway: { execute }, now: () => 1000, pickupCooldown: 0 });

    const result = pickup.requestPickup({ playerEntity: actor, equipmentItems: [ground], operationId: 'input-1' });
    await Promise.resolve();

    expect(result).toEqual({ scheduled: 1, pickedItems: [], removedEntities: [] });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      intentType: 'item.pickup', actorRef: actor.id, operationId: 'input-1:ground-1',
      payload: expect.objectContaining({ groundId: 'ground-1', quantity: 3 })
    }));
    expect(ground.picked).toBe(false);
    expect(ground.getComponent('itemProjection').quantity).toBe(3);
  });
});

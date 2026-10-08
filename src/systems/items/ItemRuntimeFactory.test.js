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

import { describe, expect, it } from 'vitest';
import { CanonicalSnapshot } from '../../core/CanonicalSnapshot.js';
import { DefinitionRepository, DefinitionRepositoryValidationError } from '../../core/DefinitionRepository.js';
import { createStandardConfigConsumptionRegistry } from '../../core/ConfigConsumptionRegistry.js';
import { SceneDeathDropRuntime } from '../../core/scene/SceneDeathDropRuntime.js';
import { SceneEntityStore } from '../../core/scene/SceneEntityStore.js';
import { InventoryComponent } from '../../ecs/components/InventoryComponent.js';
import { EquipmentComponent } from '../../ecs/components/EquipmentComponent.js';
import { CargoComponent } from '../../ecs/components/CargoComponent.js';
import {
  ITEM_CAPABILITY_IDS,
  createStandardCapabilityStrategyRegistry
} from './CapabilityStrategyRegistry.js';
import {
  normalizeItemRuntimeState,
  serializeItemRuntimeState
} from './ItemRuntimeState.js';
import { ItemRuntimeFactory } from './ItemRuntimeFactory.js';

function createFixture() {
  const project = {
    schemaVersion: 1,
    library: {
      items: [
        { id: 'wood', name: 'Wood', maxStack: 99, imageId: 'item.wood', assetId: 'item.wood',
          capabilities: [{ id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack: 99 } }] },
        { id: 'axe', name: 'Axe', imageId: 'item.axe', assetId: 'item.axe',
          capabilities: [
            { id: 'durable', strategyId: 'item.durable.standard', parameters: { maxDurability: 8 } },
            { id: 'tool', strategyId: 'item.tool.gathering', parameters: { toolType: 'axe' } }
          ] },
        { id: 'wagon-box', name: 'Box', imageId: 'item.box', assetId: 'item.box',
          capabilities: [
            { id: 'container', strategyId: 'item.container.slots', parameters: { capacity: 20 } },
            { id: 'cargo', strategyId: 'item.cargo.container', parameters: { capacity: 20 } }
          ] }
      ],
      buildings: [{ id: 'campfire' }]
    },
    quests: [{ id: 'quest-1' }]
  };
  const snapshot = CanonicalSnapshot.fromProject(project, { revision: 4 });
  const capabilityStrategyRegistry = createStandardCapabilityStrategyRegistry();
  const repository = DefinitionRepository.fromSnapshot(snapshot, { capabilityStrategyRegistry });
  return { snapshot, repository, capabilityStrategyRegistry };
}

describe('CapabilityStrategyRegistry', () => {
  it('登记 11 类通用 capability 并对参数、依赖、互斥和引用执行统一校验', () => {
    const registry = createStandardCapabilityStrategyRegistry();
    expect(new Set(registry.entries().map(entry => entry.capabilityId))).toEqual(new Set(ITEM_CAPABILITY_IDS));
    const errors = registry.validateDefinition({ id: 'invalid', capabilities: [
      { id: 'tool', strategyId: 'item.tool.gathering', parameters: { toolType: 'axe' } },
      { id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack: 1 } },
      { id: 'questBound', strategyId: 'item.quest.bound', parameters: { questId: 'missing' } }
    ] }, { hasDefinition: () => false });
    expect(errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'capabilityDependencyMissing', 'capabilityConflict', 'outOfRange', 'invalidReference'
    ]));
  });

  it('DefinitionRepository 与 consumer coverage 使用同一精确 strategy 契约', () => {
    const { snapshot, capabilityStrategyRegistry } = createFixture();
    const coverage = createStandardConfigConsumptionRegistry(capabilityStrategyRegistry).build(snapshot);
    expect(coverage.status.some(entry => entry.consumerId === 'runtime.itemCapability.stackable')).toBe(true);
    expect(coverage.status.some(entry => entry.consumerId === 'runtime.itemCapability.tool')).toBe(true);
  });
});

describe('ItemRuntimeState 与 ItemRuntimeFactory', () => {
  it('从 legacy item 收口为最小 stack/instance state，不保存定义或资源路径', () => {
    const stack = normalizeItemRuntimeState({
      item: { id: 'wood', name: 'Wood', imageId: 'item.wood', sourcePath: '/forbidden.png' }, quantity: 7
    });
    const instance = normalizeItemRuntimeState({
      item: { id: 'axe', instanceId: 'axe-1', durability: 3, name: 'Axe', imageId: 'item.axe' }, quantity: 1
    });
    expect(serializeItemRuntimeState(stack)).toEqual({ definitionId: 'wood', quantity: 7 });
    expect(serializeItemRuntimeState(instance)).toEqual({
      definitionId: 'axe', instanceId: 'axe-1', mutable: { durability: 3 }
    });
    expect(JSON.stringify([stack, instance])).not.toContain('imageId');
    expect(JSON.stringify([stack, instance])).not.toContain('sourcePath');
  });

  it('唯一 Factory 从定义与最小运行态创建 GroundDrop/DeathDrop ECS 投影', () => {
    const { repository, capabilityStrategyRegistry } = createFixture();
    const factory = new ItemRuntimeFactory({ definitionRepository: repository, capabilityStrategyRegistry });
    const ground = factory.createGroundDropProjection({
      entityId: 'ground-1', runtimeState: { definitionId: 'wood', quantity: 5 }, transform: { x: 2, y: 3 }
    });
    expect(ground.getComponent('itemProjection').serialize()).toEqual({
      projectionKind: 'groundDrop',
      runtimeState: { definitionId: 'wood', quantity: 5 },
      pickupState: 'available'
    });
    expect(ground.getComponent('sprite').spriteSheet).toBe('item.wood');

    const death = factory.createDeathDropProjection({
      entityId: 'drop-1', deathId: 'death-1', transform: { x: 9, y: 8 },
      stacks: [
        { id: 'wood-stack', definitionId: 'wood', quantity: 4 },
        { id: 'axe-stack', definitionId: 'axe', instanceId: 'axe-1', mutable: { durability: 2 } }
      ],
      presentation: { imageId: 'world.loot.deathDrop', assetId: 'world.loot.deathDrop' }
    });
    const serialized = death.getComponent('deathDrop').serialize();
    expect(serialized).toEqual({
      schemaVersion: 2,
      deathId: 'death-1',
      stacks: [
        { id: 'wood-stack', definitionId: 'wood', quantity: 4 },
        { id: 'axe-stack', definitionId: 'axe', instanceId: 'axe-1', mutable: { durability: 2 } }
      ]
    });
    expect(serialized.stacks[0]).not.toHaveProperty('item');
    expect(death.getComponent('deathDrop').stacks[0].item).toBe(repository.get('items', 'wood'));
  });

  it('Inventory/Equipment/Cargo 正式快照只保存最小运行态并可由定义恢复', () => {
    const { repository } = createFixture();
    const resolve = id => repository.get('items', id);
    const inventory = new InventoryComponent({ maxSlots: 4, definitionResolver: resolve });
    inventory.addItem(resolve('wood'), 6);
    expect(inventory.exportRuntimeStates()).toEqual([{ definitionId: 'wood', quantity: 6 }]);
    const restoredInventory = new InventoryComponent({ maxSlots: 4, definitionResolver: resolve,
      items: inventory.exportRuntimeStates() });
    expect(restoredInventory.getItemCount('wood')).toBe(6);

    const equipment = new EquipmentComponent({ definitionResolver: resolve });
    equipment.slots.mainhand = { ...resolve('axe'), subType: 'weapon', instanceId: 'axe-equipped', durability: 5 };
    const equipmentState = equipment.exportRuntimeState();
    expect(equipmentState.mainhand).toEqual({
      definitionId: 'axe', instanceId: 'axe-equipped', mutable: { durability: 5 }
    });

    const cargo = new CargoComponent({ capacity: 10, maxSlots: 2, definitionResolver: resolve });
    cargo.addItem(resolve('wood'), 3);
    const cargoState = cargo.serialize();
    expect(cargoState.items).toEqual([{ definitionId: 'wood', quantity: 3 }]);
    expect(cargoState.items[0]).not.toHaveProperty('item');
    expect(new CargoComponent({ capacity: 10, maxSlots: 2, definitionResolver: resolve }).deserialize(cargoState).ok).toBe(true);
  });

  it('恢复先验证全部 refs，失败时不替换现有 ECS world', () => {
    const { repository, capabilityStrategyRegistry } = createFixture();
    const factory = new ItemRuntimeFactory({ definitionRepository: repository, capabilityStrategyRegistry });
    const store = new SceneEntityStore();
    const existing = factory.createDeathDropProjection({
      entityId: 'existing', deathId: 'death-old', transform: { x: 0, y: 0 },
      stacks: [{ id: 'wood', definitionId: 'wood', quantity: 1 }]
    });
    store.add(existing);
    store.addEquipmentItem(existing);
    const runtime = new SceneDeathDropRuntime({ itemRuntimeFactory: factory, entityStore: store });
    const result = runtime.restore([{
      id: 'replacement', position: { x: 1, y: 1 },
      state: { schemaVersion: 2, deathId: 'death-new', stacks: [{ id: 'missing', definitionId: 'missing', quantity: 1 }] }
    }]);
    expect(result.ok).toBe(false);
    expect(store.equipmentItems).toEqual([existing]);
    expect(existing.active).toBe(true);
  });
});

describe('ItemRuntimeState 属性式不变量', () => {
  it('任意支持范围内数量都只序列化稳定引用与数量', () => {
    // **Validates: Requirements 2.2, 2.7, 2.9, 2.12**
    for (let quantity = 1; quantity <= 128; quantity += 1) {
      const serialized = serializeItemRuntimeState(normalizeItemRuntimeState({
        item: { id: `item-${quantity}`, name: `name-${quantity}`, imageId: `asset-${quantity}` },
        quantity
      }));
      expect(serialized).toEqual({ definitionId: `item-${quantity}`, quantity });
      expect(Object.keys(serialized)).toEqual(['definitionId', 'quantity']);
    }
  });

  it('任意重复 instanceId 都在 shadow 重建前拒绝', () => {
    // **Validates: Requirements 2.2, 2.9, 3.9**
    const { repository } = createFixture();
    const factory = new ItemRuntimeFactory({ definitionRepository: repository });
    for (let durability = 0; durability <= 8; durability += 1) {
      const checked = factory.validateRuntimeStates([
        { definitionId: 'axe', instanceId: 'same-instance', mutable: { durability } },
        { definitionId: 'axe', instanceId: 'same-instance', mutable: { durability: 8 - durability } }
      ]);
      expect(checked.ok).toBe(false);
      expect(checked.errors.some(error => error.code === 'duplicateId')).toBe(true);
    }
  });
});

describe('非法 capability 发布', () => {
  it('DefinitionRepository 在发布前拒绝依赖缺失', () => {
    const registry = createStandardCapabilityStrategyRegistry();
    const snapshot = CanonicalSnapshot.fromProject({
      schemaVersion: 1,
      library: { items: [{ id: 'bad-tool', capabilities: [
        { id: 'tool', strategyId: 'item.tool.gathering', parameters: { toolType: 'axe' } }
      ] }] }
    });
    expect(() => DefinitionRepository.fromSnapshot(snapshot, {
      capabilityStrategyRegistry: registry
    })).toThrow(DefinitionRepositoryValidationError);
  });
});

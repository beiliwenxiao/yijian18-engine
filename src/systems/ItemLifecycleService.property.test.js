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
import { SeedGenerator } from '../../test/support/ModelTesting.js';
import { Entity } from '../ecs/Entity.js';
import { InventoryComponent } from '../ecs/components/InventoryComponent.js';
import { EquipmentComponent } from '../ecs/components/EquipmentComponent.js';
import { StatsComponent } from '../ecs/components/StatsComponent.js';
import { TransformComponent } from '../ecs/components/TransformComponent.js';
import { EquipmentSystem } from './EquipmentSystem.js';
import { InventoryTransactionService } from './InventoryTransactionService.js';
import { PlayerDefeatService } from './PlayerDefeatService.js';
import { ItemLifecycleService, ITEM_LIFECYCLE_COMMANDS } from './ItemLifecycleService.js';
import { ItemRuntimeFactory } from './items/ItemRuntimeFactory.js';
import { createStandardCapabilityStrategyRegistry } from './items/CapabilityStrategyRegistry.js';
import { CommandGateway } from '../core/command/CommandGateway.js';
import { LocalAuthorityAdapter } from '../core/command/LocalAuthorityAdapter.js';
import { ProjectionStore } from '../core/command/ProjectionStore.js';

const PROPERTY_SEEDS = Object.freeze([0x1a7e2101, 0x1a7e2102]);
const OPERATION_KINDS = Object.freeze([
  'pickupGround', 'use', 'drop', 'equip', 'unequip', 'transfer', 'pickupDeath', 'deathDrop'
]);
const FAULT_PHASES = Object.freeze(['none', 'validation', 'commit', 'checkpoint']);
const clone = value => value == null ? value : structuredClone(value);
const sortStates = states => [...states].sort((left, right) => (
  `${left.definitionId}:${left.instanceId || ''}`.localeCompare(`${right.definitionId}:${right.instanceId || ''}`)
));
function generatedDefinitions(random) {
  const maxStack = random.int(4, 12);
  const durability = random.int(3, 15);
  const common = (id, extra = {}) => ({ id, definitionId: id, name: id, imageId: `item.${id}`, assetId: `item.${id}`, ...extra });
  const stack = (id, extra = {}) => common(id, {
    type: 'material', maxStack,
    capabilities: [{ id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack } }],
    ...extra
  });
  return {
    material: stack(`material-${random.string(5)}`),
    consumable: stack(`consumable-${random.string(5)}`, {
      type: 'consumable', usable: true, effect: { type: 'heal', value: random.int(1, 25) },
      capabilities: [
        { id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack } },
        { id: 'consumable', strategyId: 'item.consume.effect', parameters: { charges: random.int(1, 4) } }
      ]
    }),
    equipment: common(`equipment-${random.string(5)}`, {
      type: 'equipment', subType: 'weapon', maxStack: 1, stats: { attack: random.int(1, 8) },
      capabilities: [
        { id: 'equippable', strategyId: 'item.equip.slot', parameters: { slot: 'mainhand' } },
        { id: 'durable', strategyId: 'item.durable.standard', parameters: { maxDurability: durability } }
      ]
    }),
    questBound: stack(`quest-${random.string(5)}`, {
      type: 'quest', capabilities: [
        { id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack } },
        { id: 'questBound', strategyId: 'item.quest.bound', parameters: { questId: 'quest-1' } }
      ]
    }),
    cargo: common(`cargo-${random.string(5)}`, { maxStack: 1, capabilities: [
      { id: 'container', strategyId: 'item.container.slots', parameters: { capacity: random.int(2, 12) } },
      { id: 'cargo', strategyId: 'item.cargo.container', parameters: { capacity: random.int(2, 12) } }
    ] }),
    tool: common(`tool-${random.string(5)}`, { maxStack: 1, capabilities: [
      { id: 'durable', strategyId: 'item.durable.standard', parameters: { maxDurability: durability } },
      { id: 'tool', strategyId: 'item.tool.gathering', parameters: { toolType: random.pick(['axe', 'pickaxe', 'shovel']) } }
    ] }),
    throwable: stack(`throwable-${random.string(5)}`, { capabilities: [
      { id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack } },
      { id: 'throwable', strategyId: 'item.throw.projectile', parameters: { range: random.int(1, 10), speed: random.int(1, 8) } }
    ] }),
    fuel: stack(`fuel-${random.string(5)}`, { capabilities: [
      { id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack } },
      { id: 'fuel', strategyId: 'item.fuel.energy', parameters: { energy: random.int(1, 20) } }
    ] }),
    placeable: stack(`placeable-${random.string(5)}`, { capabilities: [
      { id: 'stackable', strategyId: 'item.stack.standard', parameters: { maxStack } },
      { id: 'placeable', strategyId: 'item.place.entity', parameters: {} }
    ] })
  };
}

function generatedScenario(seed, operationKind, faultPhase) {
  const random = new SeedGenerator(seed).fork(`${operationKind}:${faultPhase}`);
  const definitions = generatedDefinitions(random);
  return {
    seed, operationKind, faultPhase, definitions,
    actorId: `actor-${random.string(6)}`,
    sourceId: `source-${random.string(6)}`,
    targetId: `target-${random.string(6)}`,
    operationId: `item-operation-${random.string(10)}`,
    groundId: `ground-${random.string(7)}`,
    deathId: `death-${random.string(7)}`,
    quantity: random.int(2, Math.min(4, definitions.material.maxStack)),
    durability: random.int(0, definitions.equipment.capabilities[1].parameters.maxDurability),
    hp: random.int(20, 60),
    maxHp: random.int(80, 120),
    position: { x: random.int(-20, 20), y: random.int(-20, 20) }
  };
}

class FaultingInventoryTransactions extends InventoryTransactionService {
  constructor(faultPhase) {
    super();
    this.faultPhase = faultPhase;
    this.injected = false;
  }

  commit(operation) {
    if (this.faultPhase === 'commit' && !this.injected) {
      this.injected = true;
      return { ok: false, code: 'injectedCommitFailure', accepted: 0 };
    }
    return super.commit(operation);
  }
}

function runtimeState(definition, scenario, { instance = false, quantity = scenario.quantity } = {}) {
  return instance
    ? { definitionId: definition.id, instanceId: `${definition.id}-instance`, mutable: { durability: scenario.durability } }
    : { definitionId: definition.id, quantity };
}

function repositoryFor(definitions) {
  const byId = new Map(Object.values(definitions).map(definition => [definition.id, definition]));
  return {
    definitionRevision: 1,
    get(kind, id) { return ['items', 'equipment'].includes(kind) ? byId.get(id) || null : null; }
  };
}
function createActor(scenario, resolveDefinition) {
  const actor = new Entity(scenario.actorId, 'player');
  actor.addComponent(new InventoryComponent({ maxSlots: 8, definitionResolver: resolveDefinition }));
  actor.addComponent(new EquipmentComponent({ definitionResolver: resolveDefinition }));
  actor.addComponent(new StatsComponent({
    hp: scenario.hp, maxHp: scenario.maxHp, mp: 10, maxMp: 20,
    attack: 10, defense: 2, speed: 4
  }));
  actor.addComponent(new TransformComponent(scenario.position.x, scenario.position.y));
  return actor;
}

function createFixture(scenario) {
  const capabilityRegistry = createStandardCapabilityStrategyRegistry();
  const repository = repositoryFor(scenario.definitions);
  const resolveDefinition = id => repository.get('items', id) || repository.get('equipment', id);
  const factory = new ItemRuntimeFactory({ definitionRepository: repository, capabilityStrategyRegistry: capabilityRegistry });
  const inventoryTransactions = new FaultingInventoryTransactions(scenario.faultPhase);
  const actor = createActor(scenario, resolveDefinition);
  const target = new InventoryComponent({ maxSlots: 8, definitionResolver: resolveDefinition });
  const worlds = new Map();
  const checkpoints = [];
  const worldStore = {
    add: entity => worlds.set(entity.id, entity),
    addEquipmentItem: () => {},
    remove: entity => worlds.delete(entity.id)
  };
  const defeat = new PlayerDefeatService({
    inventoryTransactions,
    entityFactory: { createDeathDrop: draft => factory.createDeathDropProjection(draft) },
    entityStore: worldStore,
    revivePlayer: () => {},
    respawnResolver: () => null
  });
  const inventories = new Map([
    [scenario.sourceId, actor.getComponent('inventory')],
    [scenario.targetId, target]
  ]);
  const service = new ItemLifecycleService({
    inventoryTransactions,
    equipmentSystem: new EquipmentSystem(),
    resolveActor: id => id === actor.id ? actor : null,
    resolveInventory: id => inventories.get(id) || null,
    resolveWorldItem: id => worlds.get(id) || null,
    resolveDefinition,
    createGroundDrop: draft => factory.createGroundDropProjection(draft),
    addWorldEntity: entity => { worlds.set(entity.id, entity); return true; },
    removeWorldEntity: entity => worlds.delete(entity.id),
    createCheckpoint: checkpoint => {
      checkpoints.push(clone(checkpoint));
      return { ok: scenario.faultPhase !== 'checkpoint', code: 'injectedCheckpointFailure' };
    },
    playerDefeatService: defeat
  });
  const projectionStore = new ProjectionStore({ definitionRevision: 1 });
  projectionStore.registerReducer(service.stateType, (_current, event) => event.payload.projection);
  const authority = new LocalAuthorityAdapter({ projectionStore });
  for (const commandType of Object.values(ITEM_LIFECYCLE_COMMANDS)) authority.registerHandler(commandType, service);
  const gateway = new CommandGateway({ authorityPort: authority, definitionRepository: repository });
  const notifications = [];
  authority.notificationBus.subscribe(event => notifications.push(clone(event)));
  return {
    scenario, capabilityRegistry, repository, factory, inventoryTransactions,
    actor, target, worlds, checkpoints, defeat, service, authority, gateway,
    projectionStore, notifications
  };
}

function prepareOperation(fixture) {
  const { scenario, actor, target, worlds, factory } = fixture;
  const definitions = scenario.definitions;
  const inventory = actor.getComponent('inventory');
  const equipment = actor.getComponent('equipment');
  let intentType;
  let payload;
  switch (scenario.operationKind) {
    case 'pickupGround': {
      const ground = factory.createGroundDropProjection({
        entityId: scenario.groundId,
        runtimeState: runtimeState(definitions.material, scenario),
        transform: scenario.position
      });
      ground.quantity = scenario.quantity;
      ground.picked = false;
      worlds.set(ground.id, ground);
      intentType = ITEM_LIFECYCLE_COMMANDS.PICKUP;
      payload = { groundId: scenario.groundId, quantity: scenario.quantity };
      break;
    }
    case 'use':
      inventory.addItem(definitions.consumable, scenario.quantity);
      intentType = ITEM_LIFECYCLE_COMMANDS.USE;
      payload = { itemId: definitions.consumable.id };
      break;
    case 'drop':
      inventory.addItem(definitions.material, scenario.quantity);
      intentType = ITEM_LIFECYCLE_COMMANDS.DROP;
      payload = { itemId: definitions.material.id, quantity: scenario.quantity, groundId: scenario.groundId };
      break;
    case 'equip': {
      const item = { ...definitions.equipment, instanceId: `${definitions.equipment.id}-instance`, durability: scenario.durability };
      inventory.addItem(item, 1);
      intentType = ITEM_LIFECYCLE_COMMANDS.EQUIP;
      payload = { itemId: definitions.equipment.id, instanceId: item.instanceId, slot: 'mainhand' };
      break;
    }
    case 'unequip': {
      equipment.slots.mainhand = {
        ...definitions.equipment, instanceId: `${definitions.equipment.id}-instance`, durability: scenario.durability
      };
      equipment.recalculateBonusStats();
      intentType = ITEM_LIFECYCLE_COMMANDS.UNEQUIP;
      payload = { slot: 'mainhand' };
      break;
    }
    case 'transfer':
      inventory.addItem(definitions.material, scenario.quantity);
      intentType = ITEM_LIFECYCLE_COMMANDS.TRANSFER;
      payload = { sourceId: scenario.sourceId, targetId: scenario.targetId,
        itemId: definitions.material.id, quantity: scenario.quantity };
      break;
    case 'pickupDeath': {
      const death = factory.createDeathDropProjection({
        entityId: scenario.groundId, deathId: scenario.deathId, transform: scenario.position,
        stacks: [{ id: 'material-stack', ...runtimeState(definitions.material, scenario) }]
      });
      death.picked = false;
      worlds.set(death.id, death);
      intentType = ITEM_LIFECYCLE_COMMANDS.PICKUP;
      payload = { groundId: scenario.groundId };
      break;
    }
    case 'deathDrop':
      inventory.addItem(definitions.material, scenario.quantity * 2);
      intentType = ITEM_LIFECYCLE_COMMANDS.DEATH_DROP;
      payload = { deathId: scenario.deathId, resolution: { type: 'normalDeath' } };
      break;
    default:
      throw new Error(`unknown generated operation: ${scenario.operationKind}`);
  }
  if (scenario.faultPhase === 'validation') {
    if (scenario.operationKind === 'deathDrop') scenario.actorIdForCommand = `${scenario.actorId}-missing`;
    else if (scenario.operationKind === 'unequip') payload.slot = 'offhand';
    else if (scenario.operationKind === 'pickupGround' || scenario.operationKind === 'pickupDeath') payload.groundId = `${scenario.groundId}-missing`;
    else payload.itemId = `${payload.itemId}-missing`;
  }
  payload.checkpointId = `checkpoint.${scenario.operationId}`;
  return {
    intentType,
    actorRef: scenario.actorIdForCommand || scenario.actorId,
    operationId: scenario.operationId,
    payload
  };
}
function worldState(worlds) {
  return [...worlds.values()].map(entity => {
    const item = entity.getComponent?.('itemProjection');
    const death = entity.getComponent?.('deathDrop');
    if (death) return { id: entity.id, kind: 'deathDrop', state: death.serialize() };
    return { id: entity.id, kind: 'groundDrop', state: item.serialize() };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function observableState(fixture) {
  const inventory = fixture.actor.getComponent('inventory');
  const equipment = fixture.actor.getComponent('equipment');
  const stats = fixture.actor.getComponent('stats');
  return {
    inventory: sortStates(inventory.exportRuntimeStates()),
    target: sortStates(fixture.target.exportRuntimeStates()),
    equipment: equipment.exportRuntimeState(),
    worlds: worldState(fixture.worlds),
    stats: { hp: stats.hp, maxHp: stats.maxHp }
  };
}

function addState(states, state) {
  if (state.instanceId) states.push(clone(state));
  else {
    const existing = states.find(entry => !entry.instanceId && entry.definitionId === state.definitionId);
    if (existing) existing.quantity += state.quantity;
    else states.push(clone(state));
  }
  return sortStates(states);
}

function removeState(states, state, quantity = state.quantity || 1) {
  const index = states.findIndex(entry => entry.definitionId === state.definitionId
    && (!state.instanceId || entry.instanceId === state.instanceId));
  if (index === -1) return states;
  if (states[index].instanceId || states[index].quantity <= quantity) states.splice(index, 1);
  else states[index].quantity -= quantity;
  return sortStates(states);
}

function expectedState(scenario, before) {
  const expected = clone(before);
  if (scenario.faultPhase !== 'none') return expected;
  const { material, consumable, equipment } = scenario.definitions;
  const materialState = runtimeState(material, scenario);
  const equipmentState = runtimeState(equipment, scenario, { instance: true, quantity: 1 });
  switch (scenario.operationKind) {
    case 'pickupGround':
      expected.inventory = addState(expected.inventory, materialState);
      expected.worlds = [];
      break;
    case 'use':
      expected.inventory = removeState(expected.inventory, { definitionId: consumable.id }, 1);
      expected.stats.hp = Math.min(expected.stats.maxHp, expected.stats.hp + consumable.effect.value);
      break;
    case 'drop':
      expected.inventory = removeState(expected.inventory, materialState, scenario.quantity);
      expected.worlds = [{ id: scenario.groundId, kind: 'groundDrop', state: {
        projectionKind: 'groundDrop', runtimeState: materialState, pickupState: 'available'
      } }];
      break;
    case 'equip':
      expected.inventory = removeState(expected.inventory, equipmentState, 1);
      expected.equipment.mainhand = equipmentState;
      break;
    case 'unequip':
      expected.inventory = addState(expected.inventory, equipmentState);
      delete expected.equipment.mainhand;
      break;
    case 'transfer':
      expected.inventory = removeState(expected.inventory, materialState, scenario.quantity);
      expected.target = addState(expected.target, materialState);
      break;
    case 'pickupDeath':
      expected.inventory = addState(expected.inventory, materialState);
      expected.worlds = [];
      break;
    case 'deathDrop':
      // 死亡不掉落：背包物品全部保留，世界不生成掉落物（与 before 一致）
      break;
  }
  return expected;
}

function expectedNotificationTypes(operationKind) {
  const commandType = {
    pickupGround: ITEM_LIFECYCLE_COMMANDS.PICKUP,
    pickupDeath: ITEM_LIFECYCLE_COMMANDS.PICKUP,
    use: ITEM_LIFECYCLE_COMMANDS.USE,
    drop: ITEM_LIFECYCLE_COMMANDS.DROP,
    equip: ITEM_LIFECYCLE_COMMANDS.EQUIP,
    unequip: ITEM_LIFECYCLE_COMMANDS.UNEQUIP,
    transfer: ITEM_LIFECYCLE_COMMANDS.TRANSFER,
    deathDrop: ITEM_LIFECYCLE_COMMANDS.DEATH_DROP
  }[operationKind];
  const types = [`${commandType}.committed`];
  if (operationKind === 'pickupGround' || operationKind === 'pickupDeath') types.push('item.picked');
  if (operationKind === 'drop') types.push('item.dropped');
  if (operationKind === 'equip') types.push('item.equipped');
  if (operationKind === 'unequip') types.push('item.unequipped');
  // deathDrop（死亡不掉落）：不再发布 item.deathDropCreated
  return types;
}

function normalizedNotifications(fixture) {
  return fixture.notifications.map(entry => ({
    kind: entry.kind,
    type: entry.value.type,
    operationId: entry.value.operationId,
    eventSequence: entry.value.eventSequence,
    stateRevision: entry.value.stateRevision
  }));
}

function capabilityRuntimeState(definition, scenario) {
  const ids = new Set(definition.capabilities.map(capability => capability.id));
  if (ids.has('durable') || ids.has('container') || ids.has('tool')) {
    const mutable = {};
    if (ids.has('durable')) mutable.durability = scenario.durability;
    if (ids.has('container')) mutable.container = [];
    return { definitionId: definition.id, instanceId: `${definition.id}-capability-instance`, mutable };
  }
  return { definitionId: definition.id, quantity: Math.min(2, definition.maxStack || 2) };
}

async function withScenario(scenario, assertion) {
  try {
    await assertion();
  } catch (error) {
    error.message = `Property 8 minimal counterexample seed=${scenario.seed} scenario=${JSON.stringify(scenario)}\n${error.message}`;
    throw error;
  }
}

// Property 8: Fix Checking — Definition-Driven Item Lifecycle Transaction.
// **Validates: Requirements 2.7, 2.9, 2.12, 3.3, 3.4, 3.9**
describe('Property 8: Definition-driven item lifecycle transaction', () => {
  it('生成 capability 组合与 ItemRuntimeState 时由同一定义投影最小 GroundDrop ECS 状态', () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = generatedScenario(seed, 'pickupGround', 'none');
      const fixture = createFixture(scenario);
      for (const definition of Object.values(scenario.definitions)) {
        const errors = fixture.capabilityRegistry.validateDefinition(definition, {
          path: `items.${definition.id}`,
          hasDefinition: (kind, id) => kind === 'quests' && id === 'quest-1'
        });
        expect(errors, `seed=${seed} definition=${definition.id}`).toEqual([]);
        const state = capabilityRuntimeState(definition, scenario);
        const entity = fixture.factory.createGroundDropProjection({
          entityId: `projection-${definition.id}`, runtimeState: state, transform: scenario.position
        });
        const component = entity.getComponent('itemProjection');
        expect(component.serialize().runtimeState).toEqual(state);
        expect(component.capabilityState).toEqual(fixture.capabilityRegistry.project(definition, state));
        expect(JSON.stringify(component.serialize())).not.toContain('capabilities');
        expect(JSON.stringify(component.serialize())).not.toContain('imageId');
      }
    }
  });

  it('生成 source/target、operationId 与阶段故障时和纯事务/ECS 模型保持一致', async () => {
    for (const baseSeed of PROPERTY_SEEDS) {
      for (const operationKind of OPERATION_KINDS) {
        for (const faultPhase of FAULT_PHASES) {
          const scenario = generatedScenario(baseSeed, operationKind, faultPhase);
          await withScenario(scenario, async () => {
            const fixture = createFixture(scenario);
            const intent = prepareOperation(fixture);
            const before = observableState(fixture);
            const model = expectedState(scenario, before);
            const result = await fixture.gateway.execute(intent);
            // 死亡不掉落：deathDrop 不再有库存事务（prepare/commit 故障面消失）；
            // validation（actor 缺失）与 checkpoint 故障仍导致失败
            const committed = faultPhase === 'none'
              || (operationKind === 'deathDrop' && (faultPhase === 'prepare' || faultPhase === 'commit'));

            expect(result.ok).toBe(committed);
            expect(result.committed).toBe(committed);
            expect(observableState(fixture)).toEqual(model);
            expect(fixture.authority.stateRevisions.current(`item-lifecycle:${intent.actorRef}`)).toBe(committed ? 1 : 0);
            expect(fixture.authority.operationLedger.get(scenario.operationId)?.status)
              .toBe(committed ? 'committed' : 'failed');

            const notificationTypes = committed ? expectedNotificationTypes(operationKind) : [];
            expect(normalizedNotifications(fixture)).toEqual(notificationTypes.map((type, index) => ({
              kind: index === 0 ? 'CommittedEvent' : 'ApplicationEvent',
              type,
              operationId: scenario.operationId,
              eventSequence: index + 1,
              stateRevision: 1
            })));
            expect(fixture.checkpoints).toHaveLength(
              committed || faultPhase === 'checkpoint' ? 1 : 0
            );
            if (fixture.checkpoints.length) {
              expect(fixture.checkpoints[0]).toMatchObject({
                checkpointId: `checkpoint.${scenario.operationId}`,
                operationId: scenario.operationId
              });
            }

            const projection = fixture.projectionStore.get(
              fixture.service.stateType, `item-lifecycle:${scenario.actorId}`
            );
            if (!committed) expect(projection).toBeNull();
            else {
              expect(sortStates(projection.value.inventory.slots.filter(Boolean).map(stack => (
                stack.item.instanceId
                  ? { definitionId: stack.item.definitionId || stack.item.id, instanceId: stack.item.instanceId,
                    mutable: Object.fromEntries(['durability', 'binding', 'charges', 'container']
                      .filter(key => stack.item[key] !== undefined).map(key => [key, clone(stack.item[key])])) }
                  : { definitionId: stack.item.definitionId || stack.item.id, quantity: stack.quantity }
              )))).toEqual(model.inventory);
              expect(projection.value.equipment.mainhand
                ? (projection.value.equipment.mainhand.definitionId || projection.value.equipment.mainhand.id)
                : null
              ).toBe(model.equipment.mainhand?.definitionId || null);
            }
          });
        }
      }
    }
  });
});

import { describe, it, expect } from 'vitest';
import { GameSceneRuntime } from '../src/core/scene/GameSceneRuntime.js';
import { SceneEntityStore } from '../src/core/scene/SceneEntityStore.js';
import { GameSceneContext } from '../src/core/scene/GameSceneContext.js';
import { SceneGameplaySystemAssembler } from '../src/core/scene/SceneGameplaySystemAssembler.js';
import { InventoryTransactionService } from '../src/systems/InventoryTransactionService.js';
import { ArmyOrderSystem } from '../src/systems/ArmyOrderSystem.js';
import { EffectResolver } from '../src/systems/effects/EffectResolver.js';
import { ParticleSystem } from '../src/rendering/ParticleSystem.js';
import { FloatingTextManager } from '../src/ui/FloatingText.js';

/**
 * 装配器真实装配集成测试。
 *
 * 不 mock 被测逻辑：命令端口、快照管理、实体集合、事务服务全部使用真实实现；
 * 只有 InputManager 用无 canvas 的同形替身（它依赖浏览器 window，构造不了）。
 * 目的：覆盖「单测 mock 全绿、真实装配因命令撞名/作用域错误爆炸」这一类问题。
 */

function createHeadlessInput() {
  const point = { x: 0, y: 0 };
  return {
    isKeyDown: () => false,
    wasPressed: () => false,
    wasReleased: () => false,
    isMouseButtonDown: () => false,
    isMouseClickHandled: () => false,
    consumeMouseClick: () => false,
    getMousePosition: () => point,
    isGamepadConnected: () => false,
    isGamepadCursorActive: () => false,
    isTouchDevice: false,
    getGamepadState: () => null
  };
}

function createFixture() {
  const runtime = new GameSceneRuntime();
  const entities = new SceneEntityStore();
  const context = new GameSceneContext({ entities });
  const scene = {
    sceneRuntime: runtime,
    context,
    entityStore: entities,
    entities: entities.all,
    particleSystem: new ParticleSystem(),
    floatingTextManager: new FloatingTextManager(),
    camera: { width: 1280, height: 720, getViewBounds: () => ({ left: 0, top: 0, right: 1280, bottom: 720 }) },
    inputManager: createHeadlessInput(),
    inventoryTransactions: new InventoryTransactionService(),
    simulationClock: { now: () => 0 },
    gameLoader: null,
    currentSceneId: 'test.scene',
    logicalWidth: 1280,
    logicalHeight: 720,
    isMobileLayout: false,
    playerEntity: null,
    airAimConfig: {}
  };
  return { runtime, entities, context, scene };
}

const WORLD_LOGIC = Object.freeze({
  nodes: [
    { id: 'n1', kind: 'city', position: { x: 0, y: 0 }, ref: { id: 'city.n1' } },
    { id: 'n2', kind: 'city', position: { x: 100, y: 0 }, ref: { id: 'city.n2' } }
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', cost: 1 }]
});

const createSharedConfig = () => ({
  effectResolver: new EffectResolver(),
  proficiency: { config: { types: { gathering: { thresholds: [0, 10, 30] } } } },
  construction: { definitions: [{ id: 'test.wall', name: '测试墙', costs: [{ itemId: 'wood', quantity: 1 }] }] },
  supply: { readCities: () => [], commitCities: () => true, getDay: () => 1 },
  convoy: {},
  companion: {},
  downedDrop: {},
  armyOrder: { worldLogic: WORLD_LOGIC }
});

describe('SceneGameplaySystemAssembler 真实装配', () => {
  it('initialize 真实构造并挂载核心系统', () => {
    const { runtime, scene } = createFixture();
    const assembler = new SceneGameplaySystemAssembler(scene);
    const plan = assembler.initialize({});
    expect(plan?.id).toBe('gameplay-core');
    runtime.applyRegistrationPlan(plan);

    for (const field of [
      'combatSystem', 'movementSystem', 'pathfindingSystem', 'aiSystem', 'collisionSystem',
      'equipmentSystem', 'pickupSystem', 'gatheringSystem', 'armyCommandFlow',
      'jumpSystem', 'dodgeSystem', 'locomotionSystem', 'inventoryTransactions'
    ]) {
      expect(scene[field], `scene.${field} 应被真实创建`).toBeTruthy();
    }
    expect(runtime.container.resolve('gameplay.combat')).toBe(scene.combatSystem);
    expect(runtime.container.resolve('gameplay.inventoryTransactions')).toBe(scene.inventoryTransactions);
    expect(scene.context.systems.combat).toBe(scene.combatSystem);
    expect(runtime.authorityPort._handlers.has('item.repair')).toBe(true);
  });

  it('configureSharedSystems 不因场景侧 world.teleport 撞名而失败，且完整注册装配器命令', () => {
    const { runtime, scene } = createFixture();
    const assembler = new SceneGameplaySystemAssembler(scene);
    runtime.applyRegistrationPlan(assembler.initialize({}));

    // 复现真实顺序：场景侧先注册 world.teleport（场景导航语义）
    const scenarioHandler = { execute: () => ({ ok: true, sceneId: 'S01' }) };
    runtime.registerCommandHandler('world.teleport', scenarioHandler);

    const sharedPlan = assembler.configureSharedSystems(createSharedConfig());

    expect(sharedPlan?.id).toBe('gameplay-shared');

    const handlers = runtime.authorityPort._handlers;
    // 场景导航命令未被抢占
    expect(handlers.get('world.teleport')?.receiver).toBe(scenarioHandler);
    // 军团路网位移命令独立命名
    expect(handlers.has('world.unit.teleport')).toBe(true);
    // 撞名异常不再中断后续注册
    expect(handlers.has('world.route.preview')).toBe(true);
    expect(handlers.has('world.route.invalidate')).toBe(true);
    expect(handlers.has('world.encounter.decide')).toBe(true);

    // 军需命令注册表快照：任一新命令漏注册都会在这里失败
    const expected = [
      'inventory.dropAll', 'supply.open', 'supply.requisition', 'supply.cancel',
      'convoy.assemble', 'convoy.load', 'convoy.dispatch', 'convoy.order',
      'companion.assign', 'companion.dismiss', 'companion.stance',
      'unit.order', 'unit.order.cancel', 'unit.setFormation',
      'army.deploy.commit', 'army.deploy.temp', 'battle.deploy.lock',
      'unit.battleOrder', 'army.form', 'army.disband',
      'army.supply.deposit', 'army.supply.withdraw', 'army.raze', 'army.forage', 'army.regroup',
      'city.recruit', 'city.attack', 'city.transport', 'city.siege.begin', 'city.capture',
      'battle.entry.join', 'battle.entry.leave', 'battle.settle', 'battle.supply.recover',
      'battle.redeem', 'camp.register', 'camp.transfer'
    ];
    expect(expected.filter(type => !handlers.has(type))).toEqual([]);

    // #2 回归：生产快照 provider 真实注册（原 ReferenceError 的直接证据）
    expect(runtime.snapshotManager.providers.has('gameplay.production')).toBe(true);
  });

  it('world.route.preview 与 world.unit.teleport 可真实执行', () => {
    const { runtime, scene } = createFixture();
    const assembler = new SceneGameplaySystemAssembler(scene);
    runtime.applyRegistrationPlan(assembler.initialize({}));
    runtime.applyRegistrationPlan(assembler.configureSharedSystems(createSharedConfig()));

    const handlers = runtime.authorityPort._handlers;
    const preview = handlers.get('world.route.preview').execute({ payload: {} });
    expect(preview.ok).toBe(true);
    expect(preview.revision).toBeGreaterThan(0);

    const registered = scene.armyOrderSystem.registerUnit({
      id: 'u1',
      kind: 'army',
      factionId: 'ally',
      position: { x: 0, y: 0 }
    });
    expect(registered.ok).toBe(true);

    const teleported = handlers.get('world.unit.teleport').execute({
      payload: { unitId: 'u1', nodeId: 'n2' }
    });
    expect(teleported.ok).toBe(true);
    expect(teleported.nodeId).toBe('n2');
    expect(scene.armyOrderSystem.getUnit('u1').position).toEqual({ x: 100, y: 0 });
  });

  it('重复 configureSharedSystems 走 scene 维度先撤后注册，不抛错且命令指向新实例', () => {
    const { runtime, scene } = createFixture();
    const assembler = new SceneGameplaySystemAssembler(scene);
    runtime.applyRegistrationPlan(assembler.initialize({}));

    const config = createSharedConfig();
    runtime.applyRegistrationPlan(assembler.configureSharedSystems(config));
    const firstLayer = scene.worldRouteLayer;

    expect(() => assembler.configureSharedSystems(config)).not.toThrow();
    expect(scene.worldRouteLayer).not.toBe(firstLayer);

    const preview = runtime.authorityPort._handlers.get('world.route.preview').execute({ payload: {} });
    expect(preview.revision).toBe(scene.worldRouteLayer.revision);
  });

  it('ArmyOrderSystem 为真实实现（防止 fixture 退化）', () => {
    expect(typeof ArmyOrderSystem).toBe('function');
  });
});

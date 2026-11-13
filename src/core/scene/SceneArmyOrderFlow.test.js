/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { ArmyOrderSystem } from '../../systems/ArmyOrderSystem.js';
import { WorldRouteLayer } from '../world/WorldRouteLayer.js';
import { WorldMarchExecutor } from '../world/WorldMarchExecutor.js';
import { SceneArmyOrderFlow } from './SceneArmyOrderFlow.js';

function makeEntity({ id, armyId, x, y, faction = 'yellow_turban', dead = false, hasTransform = true }) {
  return {
    id,
    faction,
    isDead: dead,
    isDying: false,
    getComponent(name) {
      if (name === 'squadMember') return { armyId };
      if (name === 'transform') return hasTransform ? { position: { x, y } } : null;
      return null;
    }
  };
}

function makeBlackboard(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: key => store.get(key),
    set: (key, value) => store.set(key, value)
  };
}

function makeScene({ entities = [], blackboard = null, armySystem = null } = {}) {
  const frameHooks = [];
  return {
    frameHooks,
    scene: {
      entityStore: { all: entities },
      sceneRuntime: {
        onFramePhase: (phase, fn, key) => frameHooks.push({ phase, fn, key })
      },
      gameLoader: { blackboard, getRegistry: () => null },
      armyCommandFlow: armySystem ? { system: armySystem } : null,
      convoySystem: null
    }
  };
}

function buildLayer() {
  return new WorldRouteLayer({
    logic: {
      schemaVersion: 1,
      nodes: [
        { id: 'n.a', kind: 'city', position: { x: 0, y: 0 } },
        { id: 'n.b', kind: 'city', position: { x: 300, y: 0 } }
      ],
      edges: [{ id: 'e.ab', from: 'n.a', to: 'n.b', mode: 'road', cost: 1 }]
    },
    moverFactionId: 'yellow_turban'
  });
}

function makeSystem(layer) {
  return new ArmyOrderSystem({
    now: () => 1000,
    getDay: () => 1,
    routePlanner: ({ state }) => {
      const path = layer.shortestPath(layer.findNearestNode(state.position)?.nodeId || 'n.a', 'n.b');
      return path.ok ? path : { ok: false, code: path.code };
    }
  });
}

describe('SceneArmyOrderFlow · M4 4A 增量', () => {
  it('行军执行中且有 route：syncArmies 不覆盖 position；无 route 时仍跟实体质心', () => {
    const system = new ArmyOrderSystem({ now: () => 1000 });
    system.registerUnit({ id: 'army.a', kind: 'army', position: { x: 0, y: 0 } });
    const state = system.getUnit('army.a');
    state.order = { type: 'move', state: 'executing', issuedAt: 1, progress: 0 };
    state.route = { nodeIds: ['n.a', 'n.b'], edgeIds: ['e.ab'], index: 1, totalDistance: 300 };

    const { scene } = makeScene({
      entities: [makeEntity({ id: 'e1', armyId: 'army.a', x: 500, y: 500 })]
    });
    const flow = new SceneArmyOrderFlow(scene, { system });

    flow.syncArmies();
    expect(system.getUnit('army.a').position).toEqual({ x: 0, y: 0 });
    expect(system.getUnit('army.a').roster.unitIds).toContain('e1');

    // 清掉 route（改为实体行军）→ 位置重新跟实体质心
    state.route = null;
    flow.syncArmies();
    expect(system.getUnit('army.a').position).toEqual({ x: 500, y: 500 });
  });

  it('samples===0（实体无 transform）不再写 {0,0}，保留原位置', () => {
    const system = new ArmyOrderSystem({ now: () => 1000 });
    system.registerUnit({ id: 'army.a', kind: 'army', position: { x: 42, y: 24 } });
    const { scene } = makeScene({
      entities: [makeEntity({ id: 'e1', armyId: 'army.a', x: 0, y: 0, hasTransform: false })]
    });
    new SceneArmyOrderFlow(scene, { system }).syncArmies();
    expect(system.getUnit('army.a').position).toEqual({ x: 42, y: 24 });
  });

  it('块状场景：实体 transform 已是世界坐标，质心直写 armyStates 不再叠加块偏移', () => {
    const system = new ArmyOrderSystem({ now: () => 1000 });
    const { scene } = makeScene({
      entities: [makeEntity({ id: 'e1', armyId: 'army.a', x: 15960, y: 4712 })]
    });
    scene.currentSceneId = 'S09';
    scene._worldLoadResult = { worldIndex: { getOffset: () => ({ x: 15360, y: 4320 }) } };
    const flow = new SceneArmyOrderFlow(scene, { system });

    flow.syncArmies();
    // 与 city.s09(16000,4680) 同域；曾误加一次块偏移得到 31320/9032
    expect(system.getUnit('army.a').position).toEqual({ x: 15960, y: 4712 });
  });

  it('无世界索引时保持旧行为', () => {
    const system = new ArmyOrderSystem({ now: () => 1000 });
    const { scene } = makeScene({
      entities: [makeEntity({ id: 'e1', armyId: 'army.a', x: 500, y: 500 })]
    });
    scene.currentSceneId = 'S02';
    const flow = new SceneArmyOrderFlow(scene, { system });
    flow.syncArmies();
    expect(system.getUnit('army.a').position).toEqual({ x: 500, y: 500 });
  });

  it('无实体 march 走 WorldMarchExecutor：战略刻推进 route 位置', () => {
    const layer = buildLayer();
    const system = makeSystem(layer);
    system.registerUnit({ id: 'army.a', kind: 'army', position: { x: 0, y: 0 } });
    system.issueOrder({ unitId: 'army.a', order: 'move', target: { nodeId: 'n.b' } });
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100 });
    const { scene } = makeScene();
    const flow = new SceneArmyOrderFlow(scene, { system, marchExecutor: executor });
    flow.attach();

    flow.update(500);
    expect(system.getUnit('army.a').position.x).toBeCloseTo(50);
    flow.update(500);
    expect(system.getUnit('army.a').position.x).toBeCloseTo(100);
  });

  it('帧钩子吃秒：0.5s 转 500ms 走一个战略刻', () => {
    const layer = buildLayer();
    const system = makeSystem(layer);
    system.registerUnit({ id: 'army.a', kind: 'army', position: { x: 0, y: 0 } });
    system.issueOrder({ unitId: 'army.a', order: 'move', target: { nodeId: 'n.b' } });
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100 });
    const { scene, frameHooks } = makeScene();
    const flow = new SceneArmyOrderFlow(scene, { system, marchExecutor: executor });
    flow.attach();

    const hook = frameHooks.find(entry => entry.key === 'armyOrder');
    expect(typeof hook?.fn).toBe('function');
    hook.fn(0.5);
    expect(system.getUnit('army.a').position.x).toBeCloseTo(50);
  });

  it('pendingEncounter 期间战略刻暂停（位置不动）', () => {
    const layer = buildLayer();
    const system = makeSystem(layer);
    system.registerUnit({ id: 'army.a', kind: 'army', position: { x: 0, y: 0 } });
    system.issueOrder({ unitId: 'army.a', order: 'move', target: { nodeId: 'n.b' } });
    system.getUnit('army.a').order.pendingEncounter = { enemyId: 'enemy.wolf' };
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100 });
    const { scene } = makeScene();
    const flow = new SceneArmyOrderFlow(scene, { system, marchExecutor: executor });
    flow.attach();

    flow.update(500);
    expect(system.getUnit('army.a').position).toEqual({ x: 0, y: 0 });
  });

  it('_restoreFromBlackboard 后按 armyStatesMeta 补算（≤20 刻），旧档无 meta 容忍', () => {
    const donorSystem = new ArmyOrderSystem({ now: () => 1000 });
    donorSystem.registerUnit({ id: 'army.a', kind: 'army', position: { x: 0, y: 0 } });
    donorSystem.issueOrder({
      unitId: 'army.a', order: 'move', target: { nodeId: 'n.b' }
    });
    // donor 无 routePlanner → route 为 null；手工补 route 模拟大地图存档
    donorSystem.getUnit('army.a').route = {
      nodeIds: ['n.a', 'n.b'], edgeIds: ['e.ab'], index: 1, totalDistance: 300
    };
    const snapshot = donorSystem.serialize();

    const blackboard = makeBlackboard({
      armyStates: Object.fromEntries(snapshot.units.map(unit => [unit.id, unit])),
      armyStatesMeta: { lastTickAt: 8500, schemaVersion: 1 }
    });
    const layer = buildLayer();
    const system = makeSystem(layer);
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100 });
    const { scene } = makeScene({ blackboard });
    const flow = new SceneArmyOrderFlow(scene, { system, marchExecutor: executor, now: () => 10000 });

    flow.attach();
    expect(flow._catchUpSteps).toBe(3);
    expect(system.getUnit('army.a').position.x).toBeCloseTo(150);

    // 旧档无 meta：不补算也不报错
    const legacyBoard = makeBlackboard({ armyStates: { 'army.b': { kind: 'army', position: { x: 5, y: 5 } } } });
    const legacyScene = makeScene({ blackboard: legacyBoard });
    const legacyFlow = new SceneArmyOrderFlow(legacyScene, {
      system: new ArmyOrderSystem({ now: () => 1000 }),
      now: () => 10000
    });
    legacyFlow.attach();
    expect(legacyFlow._catchUpSteps).toBeUndefined();
  });

  it('update 后 _persist 写入 armyStates 与 armyStatesMeta', () => {
    const blackboard = makeBlackboard();
    const system = new ArmyOrderSystem({ now: () => 1000 });
    system.registerUnit({ id: 'army.a', kind: 'army', position: { x: 1, y: 2 } });
    const { scene } = makeScene({ blackboard });
    const flow = new SceneArmyOrderFlow(scene, { system, now: () => 12345 });
    flow.update(0);
    expect(blackboard.get('armyStates')['army.a'].position).toEqual({ x: 1, y: 2 });
    expect(blackboard.get('armyStatesMeta').lastTickAt).toBe(12345);
  });
});

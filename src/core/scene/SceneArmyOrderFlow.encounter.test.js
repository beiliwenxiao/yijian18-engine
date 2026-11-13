/**
 * SceneArmyOrderFlow 遭遇四选 / 关隘关税 集成测试（4C）
 * 覆盖：探测暂停 / 幂等确认 / 四选落地 / 不可见自动策略 / 超时撤退 / pass 易主 / 关税日结入城。
 */

import { describe, it, expect, vi } from 'vitest';
import { SceneArmyOrderFlow } from './SceneArmyOrderFlow.js';
import { ArmyOrderSystem } from '../../systems/ArmyOrderSystem.js';
import { EncounterResolver } from '../../systems/world/EncounterResolver.js';
import { PassTariffSystem } from '../../systems/world/PassTariffSystem.js';

const makeNode = (id, overrides = {}) => ({
  id,
  kind: 'junction',
  position: { x: 0, y: 0 },
  ownerFactionId: null,
  ...overrides
});

const makeEdge = (id, from, to, overrides = {}) => ({
  id,
  from,
  to,
  mode: 'road',
  cost: 100,
  conditions: {},
  ...overrides
});

function makeLayer({ nodes = [], edges = [], paths = {} } = {}) {
  const nodeMap = new Map(nodes.map(node => [String(node.id), node]));
  const edgeMap = new Map(edges.map(edge => [String(edge.id), edge]));
  const layer = {
    nodes: nodeMap,
    invalidations: [],
    getNode: id => nodeMap.get(String(id)) || null,
    getEdge: id => edgeMap.get(String(id)) || null,
    getOwner: id => nodeMap.get(String(id))?.ownerFactionId ?? null,
    getSnapshot: () => ({
      revision: 3,
      edges: Object.fromEntries(edges.map(edge => [String(edge.id), { passable: true, status: 'open', reasons: [] }]))
    }),
    shortestPath: (from, to, options = {}) => {
      const key = `${from}->${to}:${(options.avoidEdgeIds || []).join(',')}`;
      if (paths[key]) return paths[key];
      const direct = edges.find(edge => (
        (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
      ));
      if (!direct) return { ok: false, code: 'unreachable' };
      if ((options.avoidEdgeIds || []).includes(direct.id)) return { ok: false, code: 'unreachable' };
      return { ok: true, nodeIds: [from, to], edgeIds: [direct.id] };
    },
    resolveTarget: target => target?.nodeId ?? target?.id ?? null,
    findNearestNode: () => null,
    invalidate: reason => layer.invalidations.push(reason)
  };
  return layer;
}

function makeBoard(values = {}) {
  const store = new Map(Object.entries(values));
  return {
    get: key => store.get(key),
    set: (key, value) => store.set(key, value),
    values: store
  };
}

function makeFixture({ layer, panel = undefined, cityStates = null, currentSceneId = 'S01', now = () => 1000, getDay = () => 1 } = {}) {
  const board = makeBoard(cityStates ? { cityStates } : {});
  const scene = {
    entityStore: { all: [] },
    gameLoader: { blackboard: board, getRegistry: () => null },
    worldRouteLayer: layer,
    worldMapPanel: panel,
    currentSceneId,
    sceneRuntime: null
  };
  const system = new ArmyOrderSystem({
    armyOrders: { tickMs: 500, marchSpeed: 120, arrivalRadius: 24 },
    now,
    getDay
  });
  const encounterResolver = new EncounterResolver({
    combat: { engageRadius: 120, decisionTimeoutMs: 8000, decisionHoldTicks: 1, retreat: { moraleCost: 10, cooldownTicks: 4 } },
    rng: () => 0.5,
    now
  });
  const flow = new SceneArmyOrderFlow(scene, { system, encounterResolver, now });
  flow.attach();
  return { scene, system, flow, board, encounterResolver };
}

function registerArmy(system, overrides = {}) {
  const result = system.registerUnit({
    id: 'army.player',
    kind: 'army',
    factionId: 'yellow_turban',
    sceneId: 'S01',
    position: { x: 0, y: 0 },
    roster: { count: 30 },
    morale: 70,
    order: { type: 'move', state: 'executing', target: { nodeId: 'c' } },
    route: { nodeIds: ['a', 'b', 'c'], edgeIds: ['e1', 'e2'], index: 1, totalDistance: 200 },
    ...overrides
  });
  return result.state;
}

const eventsOf = system => {
  const events = [];
  system.onEvent = (event, payload) => events.push({ event, payload });
  return events;
};

describe('SceneArmyOrderFlow 遭遇探测与暂停', () => {
  it('撞见敌占城池：写入 pendingEncounter、本刻不推进、发 unit.encounterPending', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' }), makeNode('c')],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
    });
    const { system, flow } = makeFixture({ layer });
    registerArmy(system);
    const events = eventsOf(system);

    flow.update(500);

    const state = system.getUnit('army.player');
    expect(state.order.pendingEncounter).toMatchObject({ kind: 'city', nodeId: 'b', edgeId: 'e1' });
    expect(state.position).toEqual({ x: 0, y: 0 });
    expect(events.some(entry => entry.event === 'unit.encounterPending')).toBe(true);
  });

  it('待决期间后续战略刻继续暂停（位置不动）', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' }), makeNode('c')],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
    });
    const { system, flow } = makeFixture({ layer, panel: { visible: true, open: () => {} } });
    registerArmy(system);
    flow.update(500);
    flow.update(500);
    flow.update(500);
    expect(system.getUnit('army.player').position).toEqual({ x: 0, y: 0 });
  });

  it('getPendingEncounter 返回最早一条并带倒计时', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' }), makeNode('c')],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
    });
    const { flow } = makeFixture({ layer, now: () => 1000 });
    registerArmy(flow.system);
    flow.update(500);
    expect(flow.getPendingEncounter()).toMatchObject({
      unitId: 'army.player',
      kind: 'city',
      nodeId: 'b',
      remainingMs: 8000
    });
  });
});

describe('SceneArmyOrderFlow 四选结算', () => {
  const baseLayer = () => makeLayer({
    nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' }), makeNode('c')],
    edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
  });

  it('decideEncounter 幂等：encounterId 不匹配拒绝，正确 id 清 pending 并发事件', () => {
    const { system, flow } = makeFixture({ layer: baseLayer() });
    registerArmy(system);
    flow.update(500);
    const encounter = flow.getPendingEncounter();
    const events = eventsOf(system);

    expect(flow.decideEncounter({ unitId: 'army.player', encounterId: 'stale', choice: 'fight' }))
      .toMatchObject({ ok: false, code: 'staleEncounter' });
    const decided = flow.decideEncounter({ unitId: 'army.player', encounterId: encounter.id, choice: 'fight' });
    expect(decided.ok).toBe(true);

    const state = system.getUnit('army.player');
    expect(state.order.pendingEncounter).toBeNull();
    expect(state.order.encounterResolvedAt).toBe(1000);
    expect(state.encounterCooldown).toMatchObject({ edgeId: 'e1', nodeId: 'b' });
    expect(events.some(entry => entry.event === 'unit.encounterResolved')).toBe(true);
  });

  it('撤退：士气 -10、清 route 回退上一节点、4 刻冷却', () => {
    const { system, flow } = makeFixture({ layer: baseLayer() });
    registerArmy(system);
    flow.update(500);
    flow.decideEncounter({ unitId: 'army.player', choice: 'retreat' });

    const state = system.getUnit('army.player');
    expect(state.morale).toBe(60);
    expect(state.route).toBeNull();
    expect(state.order.type).toBe('move');
    expect(state.order.target).toEqual({ nodeId: 'a' });
    expect(state.encounterCooldown).toMatchObject({ edgeId: 'e1', remainingTicks: 4 });
  });

  it('绕道：改走替代路线且不耗刻', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' }), makeNode('c', { position: { x: 200, y: 0 } })],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')],
      paths: { 'a->c:e1': { ok: true, nodeIds: ['a', 'c'], edgeIds: ['e9'] } }
    });
    const { system, flow } = makeFixture({ layer });
    registerArmy(system);
    flow.update(500);
    expect(flow.getPendingEncounter().available.detour).toBe(true);
    flow.decideEncounter({ unitId: 'army.player', choice: 'detour' });

    const state = system.getUnit('army.player');
    expect(state.route.nodeIds).toEqual(['a', 'c']);
    expect(state.route.edgeIds).toEqual(['e9']);
    expect(state.encounterCooldown).toMatchObject({ nodeId: 'b', unitId: null, remainingTicks: 6 });
  });

  it('绕道（野遭遇）后同一支游骑冷却期内不再弹窗，刻数递减', () => {
    const layer = makeLayer({
      nodes: [
        makeNode('a', { position: { x: 0, y: 0 } }),
        makeNode('b', { position: { x: 100, y: 0 } }),
        makeNode('c', { position: { x: 200, y: 0 } })
      ],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')],
      paths: { 'a->c:e1': { ok: true, nodeIds: ['a', 'c'], edgeIds: ['e9'] } }
    });
    const { system, flow } = makeFixture({ layer });
    system.resolveTargetPoint = target => layer.getNode(target?.nodeId)?.position || null;
    registerArmy(system);
    system.registerUnit({
      id: 'army.enemy', kind: 'army', factionId: 'enemy', sceneId: 'S01',
      position: { x: 30, y: 0 }, roster: { count: 30 }
    });

    flow.update(500);
    expect(flow.getPendingEncounter()).toMatchObject({ kind: 'field', defenderUnitId: 'army.enemy' });
    flow.decideEncounter({ unitId: 'army.player', choice: 'detour' });

    const state = system.getUnit('army.player');
    expect(state.encounterCooldown).toMatchObject({
      unitId: 'army.enemy', releaseRadius: 120, remainingTicks: 6
    });

    flow.update(500);
    expect(system.getUnit('army.player').order.pendingEncounter).toBeNull();
    expect(system.getUnit('army.player').encounterCooldown.remainingTicks).toBeLessThanOrEqual(5);
  });

  it('关隘战胜：pass 易主、layer.invalidate、战果适配器被调用', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'pass', ownerFactionId: 'enemy', level: 1 }), makeNode('c')],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
    });
    const applied = [];
    const { system, flow } = makeFixture({ layer });
    flow.applyBattleResult = result => applied.push(result);
    registerArmy(system);
    const events = eventsOf(system);
    flow.update(500);
    const decided = flow.decideEncounter({ unitId: 'army.player', choice: 'fight' });

    expect(decided.ok).toBe(true);
    expect(system.getUnit('b')).toMatchObject({ kind: 'pass', factionId: 'yellow_turban' });
    expect(layer.invalidations).toContain('passCaptured');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ winnerFactionId: 'yellow_turban' });
    expect(events.some(entry => entry.event === 'pass.captured')).toBe(true);
  });

  it('战败：按 casualties 扣减 roster.unitIds 并进 dead', () => {
    const layer = makeLayer({ nodes: [makeNode('a'), makeNode('b'), makeNode('c')], edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')] });
    const { system, flow } = makeFixture({ layer });
    registerArmy(system, { roster: { unitIds: ['u1', 'u2', 'u3', 'u4'] } });
    system.registerUnit({
      id: 'army.enemy', kind: 'army', factionId: 'enemy',
      position: { x: 50, y: 0 }, roster: { count: 200 }
    });
    flow.update(500);
    flow.decideEncounter({ unitId: 'army.player', choice: 'fight' });

    const state = system.getUnit('army.player');
    expect(state.roster.unitIds.length).toBeLessThan(4);
    expect(state.roster.dead.length).toBeGreaterThan(0);
    expect(state.route).toBeNull();
    expect(state.order.target).toEqual({ nodeId: 'a' });
  });

  it('玩家不可见：按 autoPolicy 自动结算并标记 reason', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy', level: 1 }), makeNode('c')],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
    });
    const { system, flow } = makeFixture({ layer, currentSceneId: 'S02' });
    registerArmy(system);
    const events = eventsOf(system);
    flow.update(500);

    const resolved = events.find(entry => entry.event === 'unit.encounterResolved');
    expect(resolved?.payload.reason).toBe('autoPolicy');
    expect(system.getUnit('army.player').order.pendingEncounter).toBeNull();
  });

  it('超时：转撤退并标记 reason=timeout', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' }), makeNode('c')],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')]
    });
    const clock = { value: 1000 };
    const { system, flow } = makeFixture({
      layer,
      panel: { visible: true, open: () => {} },
      now: () => clock.value
    });
    registerArmy(system);
    flow.update(500);
    expect(flow.getPendingEncounter()).not.toBeNull();

    const events = eventsOf(system);
    clock.value = 9000;
    flow.update(0);

    const resolved = events.find(entry => entry.event === 'unit.encounterResolved');
    expect(resolved?.payload).toMatchObject({ choice: 'retreat', reason: 'timeout' });
    expect(system.getUnit('army.player').morale).toBe(60);
  });
});

describe('SceneArmyOrderFlow 关隘关税', () => {
  it('经过关隘按 cargoValue×tollRate 累计；跨日结入归属城池且不动其他字段', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('p1', { kind: 'pass', ownerFactionId: 'enemy', level: 1, tollRate: 0.1 })],
      edges: [makeEdge('e1', 'a', 'p1')]
    });
    let day = 1;
    const cityStates = [{ id: 'city.x', name: '广宗', factionId: 'enemy', resources: { food: 10, wood: 4 } }];
    const { system, flow, board } = makeFixture({ layer, cityStates, getDay: () => day });

    const mover = system.registerUnit({
      id: 'army.player', kind: 'army', factionId: 'yellow_turban',
      position: { x: 0, y: 0 }, supply: { cargoValue: 200 }
    }).state;
    const pass = system.registerUnit({
      id: 'p1', kind: 'pass', factionId: 'enemy', position: { x: 100, y: 0 }
    }).state;

    const tariff = new PassTariffSystem({
      tariff: { rate: 0.05, defaultRate: 0.05, resource: 'food', defaultCargoValue: 100 },
      listPasses: () => system.listUnits(),
      getPass: id => system.getUnit(id),
      updatePassToll: (id, total) => {
        const target = system.getUnit(id);
        if (target) target.supply = { ...(target.supply || {}), toll: total };
      },
      resolveCityForPass: () => 'city.x',
      getDay: () => day
    });
    flow.passTariffSystem = tariff;

    flow.update(0);
    const collected = flow.handleEnterNode({ state: mover, nodeId: 'p1', node: layer.getNode('p1') });
    expect(collected).toMatchObject({ ok: true, exempt: false, tax: 20 });
    expect(pass.supply.toll).toBe(20);

    day = 2;
    flow.update(0);

    expect(tariff.serialize().lastSettledDay).toBe(2);
    expect(pass.supply.toll).toBe(0);
    const settled = board.get('cityStates');
    expect(settled[0]).toMatchObject({ id: 'city.x', name: '广宗' });
    expect(settled[0].resources).toEqual({ food: 30, wood: 4 });
  });

  it('同阵营过关免税；非关隘节点不计税', () => {
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('p1', { kind: 'pass', ownerFactionId: 'yellow_turban', tollRate: 0.1 })],
      edges: [makeEdge('e1', 'a', 'p1')]
    });
    const { system, flow } = makeFixture({ layer });
    flow.passTariffSystem = new PassTariffSystem({ getPass: id => system.getUnit(id), updatePassToll: () => {} });
    const mover = system.registerUnit({
      id: 'army.player', kind: 'army', factionId: 'yellow_turban', position: { x: 0, y: 0 }, supply: { cargoValue: 200 }
    }).state;

    expect(flow.handleEnterNode({ state: mover, nodeId: 'p1', node: layer.getNode('p1') }))
      .toMatchObject({ ok: true, exempt: true, tax: 0 });
    expect(flow.handleEnterNode({ state: mover, nodeId: 'a', node: layer.getNode('a') })).toBeNull();
  });
});

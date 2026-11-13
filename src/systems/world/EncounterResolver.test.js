/**
 * EncounterResolver 单测（4C）
 * 覆盖：探测三类目标 / 冷却 / 四选可用性 / 四选后果 / 公式差异 / 战果形状。
 */

import { describe, it, expect } from 'vitest';
import { EncounterResolver, ENCOUNTER_CHOICES } from './EncounterResolver.js';

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

function makeLayer({ nodes = [], edges = [], status = {}, paths = {} } = {}) {
  const nodeMap = new Map(nodes.map(node => [String(node.id), node]));
  const edgeMap = new Map(edges.map(edge => [String(edge.id), edge]));
  return {
    nodes: nodeMap,
    getNode: id => nodeMap.get(String(id)) || null,
    getEdge: id => edgeMap.get(String(id)) || null,
    getOwner: id => nodeMap.get(String(id))?.ownerFactionId ?? null,
    getSnapshot: () => ({
      revision: 1,
      edges: Object.fromEntries(edges.map(edge => [
        String(edge.id),
        { passable: true, status: status[edge.id] || 'open', reasons: [] }
      ]))
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
    findNearestNode: () => null
  };
}

function makeState(overrides = {}) {
  return {
    id: 'army.player',
    kind: 'army',
    factionId: 'yellow_turban',
    position: { x: 0, y: 0 },
    roster: { count: 30 },
    morale: 70,
    route: {
      nodeIds: ['a', 'b', 'c'],
      edgeIds: ['e1', 'e2'],
      index: 1,
      progress: 0.2,
      travelled: 10,
      totalDistance: 100
    },
    order: { type: 'attack', state: 'executing', target: { nodeId: 'c' } },
    ...overrides
  };
}

function makeResolver(overrides = {}) {
  return new EncounterResolver({
    combat: {
      engageRadius: 120,
      decisionTimeoutMs: 8000,
      decisionHoldTicks: 1,
      retreat: { moraleCost: 10, cooldownTicks: 4 },
      ambushBonus: 0.25
    },
    rng: () => 0.5,
    now: () => 1000,
    ...overrides
  });
}

describe('EncounterResolver.detect', () => {
  it('非 executing / 已有 pending / 无阵营 均返回 null', () => {
    const resolver = makeResolver();
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' })],
      edges: [makeEdge('e1', 'a', 'b')]
    });
    expect(resolver.detect({ state: makeState({ order: { state: 'idle' } }), order: { state: 'idle' }, layer })).toBeNull();
    expect(resolver.detect({ state: makeState(), order: { state: 'executing', pendingEncounter: { id: 'x' } }, layer })).toBeNull();
    expect(resolver.detect({ state: makeState({ factionId: null }), order: { state: 'executing' }, layer })).toBeNull();
  });

  it('① 下一节点敌占城池 → city', () => {
    const resolver = makeResolver();
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' })],
      edges: [makeEdge('e1', 'a', 'b')]
    });
    const order = { state: 'executing', target: { nodeId: 'c' } };
    const encounter = resolver.detect({ state: makeState(), order, layer });
    expect(encounter).toMatchObject({
      unitId: 'army.player',
      kind: 'city',
      nodeId: 'b',
      edgeId: 'e1',
      defenderFactionId: 'enemy',
      attackerFactionId: 'yellow_turban'
    });
    expect(encounter.available.fight).toBe(true);
    expect(encounter.available.retreat).toBe(true);
    expect(encounter.expiresAt - encounter.createdAt).toBe(8000);
  });

  it('① 下一节点敌占关隘 → pass', () => {
    const resolver = makeResolver();
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'pass', ownerFactionId: 'enemy' })],
      edges: [makeEdge('e1', 'a', 'b')]
    });
    const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer });
    expect(encounter.kind).toBe('pass');
    expect(encounter.nodeId).toBe('b');
  });

  it('① 敌占关隘尚在 engageRadius 外 → 不触发（让路上野战遭遇先来）', () => {
    const resolver = makeResolver();
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'pass', ownerFactionId: 'enemy', position: { x: 3240, y: 0 } })],
      edges: [makeEdge('e1', 'a', 'b')]
    });
    expect(resolver.detect({ state: makeState(), order: { state: 'executing' }, layer })).toBeNull();
    const near = makeState({ position: { x: 3200, y: 0 } });
    expect(resolver.detect({ state: near, order: { state: 'executing' }, layer })?.kind).toBe('pass');
  });

  it('② 交战半径内敌单位 → field；同阵营/城池/已歼灭跳过', () => {
    const resolver = makeResolver();
    const layer = makeLayer({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e1', 'a', 'b')] });
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 30, y: 0 }, roster: { count: 8 } };
    const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer, units: [enemy] });
    expect(encounter).toMatchObject({ kind: 'field', defenderUnitId: 'army.enemy', nodeId: 'b' });

    const ally = { ...enemy, id: 'army.ally', factionId: 'yellow_turban' };
    const city = { ...enemy, id: 'army.city', kind: 'city' };
    const dead = { ...enemy, id: 'army.dead', roster: { count: 0 } };
    expect(resolver.detect({ state: makeState(), order: { state: 'executing' }, layer, units: [ally, city, dead] })).toBeNull();
  });

  it('绕道冷却（野遭遇）：只压这一支，换一支照常，走出感应圈/到期即解除', () => {
    const resolver = makeResolver();
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
      edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')],
      paths: { 'a->c:e1': { ok: true, nodeIds: ['a', 'c'], edgeIds: ['e9'] } }
    });
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 30, y: 0 }, roster: { count: 30 } };
    const other = { id: 'army.other', kind: 'army', factionId: 'enemy', position: { x: -40, y: 0 }, roster: { count: 30 } };
    const state = makeState();
    const encounter = resolver.detect({ state, order: { state: 'executing' }, layer, units: [enemy] });
    expect(encounter).toMatchObject({ kind: 'field', defenderUnitId: 'army.enemy' });

    const outcome = resolver.resolve({ encounter, choice: 'detour', state, layer, units: [enemy] });
    expect(outcome.cooldown).toMatchObject({ unitId: 'army.enemy', releaseRadius: 120, remainingTicks: 6 });
    state.encounterCooldown = { ...outcome.cooldown };

    // 同一支：冷却期内不重复触发
    expect(resolver.detect({ state, order: { state: 'executing' }, layer, units: [enemy] })).toBeNull();
    // 另一支：不受影响
    expect(resolver.detect({ state, order: { state: 'executing' }, layer, units: [other] }))
      .toMatchObject({ kind: 'field', defenderUnitId: 'army.other' });
    // 走出感应圈 → 冷却失效（不必等满 6 刻）
    const far = makeState({ position: { x: 400, y: 0 }, encounterCooldown: state.encounterCooldown });
    expect(resolver._activeCooldown(far, [enemy])).toBeNull();
    // 到期 → 同一支可再次触发
    state.encounterCooldown = { ...state.encounterCooldown, remainingTicks: 0 };
    expect(resolver.detect({ state, order: { state: 'executing' }, layer, units: [enemy] }))
      .toMatchObject({ kind: 'field', defenderUnitId: 'army.enemy' });
  });

  it('③ 当前边 hostile → 按 crossingNodeId 判 pass/city', () => {
    const resolver = makeResolver();
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b'), makeNode('p1', { kind: 'pass', ownerFactionId: 'enemy' })],
      edges: [makeEdge('e1', 'a', 'b', { conditions: { crossingNodeId: 'p1' } })],
      status: { e1: 'hostile' }
    });
    const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer });
    expect(encounter).toMatchObject({ kind: 'pass', nodeId: 'p1', edgeId: 'e1' });
  });

  it('冷却命中边或节点 → null', () => {
    const resolver = makeResolver();
    const layer = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' })],
      edges: [makeEdge('e1', 'a', 'b')]
    });
    const byEdge = makeState({ encounterCooldown: { edgeId: 'e1', nodeId: null, remainingTicks: 2 } });
    const byNode = makeState({ encounterCooldown: { edgeId: null, nodeId: 'b', remainingTicks: 2 } });
    expect(resolver.detect({ state: byEdge, order: { state: 'executing' }, layer })).toBeNull();
    expect(resolver.detect({ state: byNode, order: { state: 'executing' }, layer })).toBeNull();
  });
});

describe('EncounterResolver 可用性', () => {
  it('埋伏：field + 道路 + 敌方未进攻己方 → true；水路/敌方已锁定己方 → false', () => {
    const resolver = makeResolver();
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 10, y: 0 }, roster: { count: 5 } };
    const roadLayer = makeLayer({
      nodes: [makeNode('a'), makeNode('b')],
      edges: [makeEdge('e1', 'a', 'b', { mode: 'road' })]
    });
    expect(resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: roadLayer, units: [enemy] }).available.ambush).toBe(true);

    const ferryLayer = makeLayer({
      nodes: [makeNode('a'), makeNode('b')],
      edges: [makeEdge('e1', 'a', 'b', { mode: 'ferry' })]
    });
    expect(resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: ferryLayer, units: [enemy] }).available.ambush).toBe(false);

    const lockedEnemy = { ...enemy, order: { type: 'attack', target: { unitId: 'army.player' } } };
    expect(resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: roadLayer, units: [lockedEnemy] }).available.ambush).toBe(false);
  });

  it('绕道：有替代路 → true；无 → false', () => {
    const resolver = makeResolver();
    const nodes = [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' })];
    const edges = [makeEdge('e1', 'a', 'b')];
    const blocked = makeLayer({ nodes, edges });
    const encounter = resolver.detect({ state: makeState(), order: { state: 'executing', target: { nodeId: 'c' } }, layer: blocked });
    expect(encounter.available.detour).toBe(false);

    const open = makeLayer({
      nodes,
      edges,
      paths: { 'a->c:e1': { ok: true, nodeIds: ['a', 'c'], edgeIds: ['e9'] } }
    });
    const detourable = resolver.detect({ state: makeState(), order: { state: 'executing', target: { nodeId: 'c' } }, layer: open });
    expect(detourable.available.detour).toBe(true);
  });
});

describe('EncounterResolver.resolve', () => {
  const layer = () => makeLayer({
    nodes: [
      makeNode('a'),
      makeNode('b', { kind: 'city', ownerFactionId: 'enemy', level: 1, ref: { id: 'city.x' } }),
      makeNode('c')
    ],
    edges: [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')],
    paths: { 'a->c:e1': { ok: true, nodeIds: ['a', 'c'], edgeIds: ['e9'] } }
  });

  const encounterOf = (resolver, overrides = {}, stateOverrides = {}) => resolver.detect({
    state: makeState(stateOverrides),
    order: { state: 'executing', target: { nodeId: 'c' } },
    layer: overrides.layer || layer(),
    units: overrides.units || []
  });

  it('参数校验', () => {
    const resolver = makeResolver();
    const encounter = encounterOf(resolver);
    expect(resolver.resolve({})).toEqual({ ok: false, code: 'encounterRequired' });
    expect(resolver.resolve({ encounter, choice: 'nope' })).toMatchObject({ ok: false, code: 'unknownChoice' });
    expect(resolver.resolve({ encounter, choice: 'fight', state: makeState({ id: 'other' }) }))
      .toMatchObject({ ok: false, code: 'unitMismatch' });
    expect(resolver.resolve({
      encounter: { ...encounter, available: { ...encounter.available, retreat: false } },
      choice: 'retreat',
      state: makeState()
    })).toMatchObject({ ok: false, code: 'choiceUnavailable' });
  });

  it('绕道：不耗刻、改走替代路、压住同一关隘 6 刻；无替代路 → noDetour', () => {
    const resolver = makeResolver();
    const encounter = encounterOf(resolver, { layer: layer() });
    const outcome = resolver.resolve({ encounter, choice: 'detour', state: makeState(), layer: layer() });
    expect(outcome).toMatchObject({
      ok: true,
      choice: 'detour',
      strategicTicksSpent: 0,
      moraleDelta: 0,
      cooldown: { edgeId: null, nodeId: 'b', unitId: null, remainingTicks: 6 },
      routeRequest: { avoidEdgeIds: ['e1'], nodeIds: ['a', 'c'], edgeIds: ['e9'] }
    });

    const noPath = makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy' })],
      edges: [makeEdge('e1', 'a', 'b')]
    });
    const blockedEncounter = resolver.detect({ state: makeState(), order: { state: 'executing', target: { nodeId: 'c' } }, layer: noPath });
    // 探测期已判定绕道不可用 → 直接拒绝
    expect(resolver.resolve({ encounter: blockedEncounter, choice: 'detour', state: makeState(), layer: noPath }))
      .toMatchObject({ ok: false, code: 'choiceUnavailable' });
    // 探测后路况变化（可用性由调用方放开）→ noDetour
    expect(resolver.resolve({
      encounter: { ...blockedEncounter, available: { ...blockedEncounter.available, detour: true } },
      choice: 'detour',
      state: makeState(),
      layer: noPath
    })).toMatchObject({ ok: false, code: 'noDetour' });
  });

  it('撤退：耗 1 刻、士气 -10、回退上一节点、4 刻冷却', () => {
    const resolver = makeResolver();
    const encounter = encounterOf(resolver);
    const outcome = resolver.resolve({ encounter, choice: 'retreat', state: makeState(), layer: layer() });
    expect(outcome).toMatchObject({
      ok: true,
      choice: 'retreat',
      strategicTicksSpent: 1,
      moraleDelta: -10,
      retreatTo: 'a',
      routeRequest: { retreatTo: 'a' },
      cooldown: { edgeId: 'e1', remainingTicks: 4 }
    });
  });

  it('埋伏比正面战斗多一层攻方加成（同种子比分更高）', () => {
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 10, y: 0 }, roster: { count: 5 } };
    const fieldLayer = makeLayer({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e1', 'a', 'b')] });
    const resolveWith = choice => {
      const resolver = makeResolver();
      const encounter = resolver.detect({
        state: makeState(),
        order: { state: 'executing', target: { nodeId: 'c' } },
        layer: fieldLayer,
        units: [enemy]
      });
      return resolver.resolve({ encounter, choice, state: makeState(), layer: fieldLayer, units: [enemy] });
    };
    const ambush = resolveWith('ambush').battle;
    const fight = resolveWith('fight').battle;
    expect(ambush.attackerForce).toBeGreaterThan(fight.attackerForce);
    expect(ambush.score).toBeGreaterThan(fight.score);
  });

  it('野战胜：无 captured / battleResult', () => {
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 10, y: 0 }, roster: { count: 2 } };
    const resolver = makeResolver();
    const fieldLayer = makeLayer({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e1', 'a', 'b')] });
    const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: fieldLayer, units: [enemy] });
    const outcome = resolver.resolve({ encounter, choice: 'fight', state: makeState(), layer: fieldLayer, units: [enemy] });
    expect(outcome.battle.winner).toBe('attacker');
    expect(outcome.captured).toBeNull();
    expect(outcome.battleResult).toBeNull();
    expect(outcome.cooldown).toBeNull();
  });

  it('攻城胜：captured + BattleResult 形状', () => {
    const resolver = makeResolver();
    const encounter = encounterOf(resolver);
    const outcome = resolver.resolve({ encounter, choice: 'fight', state: makeState(), layer: layer(), day: 3 });
    expect(outcome.battle.winner).toBe('attacker');
    expect(outcome.captured).toEqual({ nodeId: 'b', kind: 'city', cityId: 'city.x' });
    expect(outcome.battleResult).toMatchObject({
      resultId: `battle.${encounter.id}`,
      battleId: encounter.id,
      winnerFactionId: 'yellow_turban',
      affectedCityId: 'city.x',
      completedAt: 3,
      encounter: { id: encounter.id, kind: 'city', nodeId: 'b' }
    });
  });

  it('战败：回退上一节点并带冷却', () => {
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 5, y: 0 }, roster: { count: 200 } };
    const fieldLayer = makeLayer({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e1', 'a', 'b')] });
    const resolver = makeResolver();
    const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: fieldLayer, units: [enemy] });
    const outcome = resolver.resolve({
      encounter, choice: 'fight', state: makeState({ roster: { count: 2 } }), layer: fieldLayer, units: [enemy]
    });
    expect(outcome.battle.winner).toBe('defender');
    expect(outcome.routeRequest).toMatchObject({ retreatTo: 'a' });
    expect(outcome.cooldown).toEqual({ edgeId: 'e1', remainingTicks: 4 });
  });

  it('rng 复现与 0.9~1.1 边界', () => {
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 10, y: 0 }, roster: { count: 3 } };
    const fieldLayer = makeLayer({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e1', 'a', 'b')] });
    const run = rng => {
      const resolver = makeResolver({ rng });
      const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: fieldLayer, units: [enemy] });
      return resolver.resolve({ encounter, choice: 'fight', state: makeState(), layer: fieldLayer, units: [enemy] }).battle;
    };
    expect(run(() => 0).roll).toBeCloseTo(0.9, 3);
    expect(run(() => 0.999).roll).toBeCloseTo(1.0998, 3);
    expect(run(() => 0.42).score).toBe(run(() => 0.42).score);
  });

  it('守军溃败：攻方胜且守方士气低于 routMorale', () => {
    const enemy = {
      id: 'army.enemy', kind: 'army', factionId: 'enemy',
      position: { x: 10, y: 0 }, roster: { count: 2 }, morale: 5
    };
    const fieldLayer = makeLayer({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e1', 'a', 'b')] });
    const resolver = makeResolver();
    const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: fieldLayer, units: [enemy] });
    const battle = resolver.resolve({ encounter, choice: 'fight', state: makeState(), layer: fieldLayer, units: [enemy] }).battle;
    expect(battle.winner).toBe('attacker');
    expect(battle.rout).toBe(true);
    expect(battle.defenderMorale).toBe(15);
  });

  it('城防等级与主将统率影响双方战力', () => {
    const cityLayer = level => makeLayer({
      nodes: [makeNode('a'), makeNode('b', { kind: 'city', ownerFactionId: 'enemy', level, ref: { id: 'city.x' } })],
      edges: [makeEdge('e1', 'a', 'b')]
    });
    const battleAt = (level, commanderHeroId = null) => {
      const resolver = makeResolver({
        getCityState: id => ({ id, buildingLevel: level, morale: 60 })
      });
      const state = makeState({ commanderHeroId });
      const encounter = resolver.detect({ state, order: { state: 'executing' }, layer: cityLayer(level) });
      return resolver.resolve({ encounter, choice: 'fight', state, layer: cityLayer(level) }).battle;
    };
    expect(battleAt(4).defenderForce).toBeGreaterThan(battleAt(1).defenderForce);
  });

  it('同阵营邻近单位提供堆叠加成', () => {
    const fieldLayer = makeLayer({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e1', 'a', 'b')] });
    const enemy = { id: 'army.enemy', kind: 'army', factionId: 'enemy', position: { x: 10, y: 0 }, roster: { count: 3 } };
    const ally = { id: 'army.ally', kind: 'army', factionId: 'yellow_turban', position: { x: 10, y: 0 }, roster: { count: 2 } };
    const battleWith = units => {
      const resolver = makeResolver();
      const encounter = resolver.detect({ state: makeState(), order: { state: 'executing' }, layer: fieldLayer, units });
      return resolver.resolve({ encounter, choice: 'fight', state: makeState(), layer: fieldLayer, units }).battle;
    };
    expect(battleWith([enemy, ally]).attackerForce).toBeGreaterThan(battleWith([enemy]).attackerForce);
  });

  it('toBattleResult：野战返回 null，城池/关隘返回形状', () => {
    const resolver = makeResolver();
    const battle = { winner: 'attacker', spoils: { food: 3 }, spoilsFromCityId: 'city.x', casualties: { attacker: 1, defender: 2 } };
    expect(resolver.toBattleResult({ id: 'x', kind: 'field' }, battle)).toBeNull();
    const result = resolver.toBattleResult(
      { id: 'x', kind: 'pass', nodeId: 'p1', attackerFactionId: 'a', defenderFactionId: 'd' },
      battle,
      { day: 2, cityId: 'city.x', attackerCityId: 'city.a' }
    );
    expect(result).toMatchObject({
      resultId: 'battle.x',
      winnerFactionId: 'a',
      affectedCityId: 'city.x',
      cityDamage: { ratio: 0.1 },
      casualties: { attacker: 1, defender: 2 },
      completedAt: 2
    });
    expect(result.resourceTransfer).toMatchObject({
      fromCityId: 'city.x',
      toCityId: 'city.a',
      resources: { food: 3 }
    });
  });
});

describe('ENCOUNTER_CHOICES', () => {
  it('顺序即确认框按钮顺序', () => {
    expect([...ENCOUNTER_CHOICES]).toEqual(['ambush', 'detour', 'fight', 'retreat']);
  });
});

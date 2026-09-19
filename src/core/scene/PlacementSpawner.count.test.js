import { describe, expect, it } from 'vitest';
import { PlacementSpawner, expandPlacement } from './PlacementSpawner.js';
import { ScenePlacementRuntime, getPlacementSignature } from './ScenePlacementRuntime.js';

const TEMPLATE = {
  id: 'S01-first-wolf', sceneId: 'S01', type: 'ref', kind: 'enemy', ref: 'enemy.s01_first_wolf',
  group: 'S01-first-wolf',
  count: { blackboardKey: 'storyState', path: 's01Survival.firstWolfCount' },
  spawnWhen: { blackboardKey: 'storyState', equals: true, path: 's01Survival.firstWolfSpotted' },
  x: 100, y: 200
};

function createSpawner({ storyState = {}, shouldSpawn = null } = {}) {
  const store = {
    enemies: [], all: [], pickups: [], equipmentItems: [],
    addEnemy: entity => store.enemies.push(entity),
    removeMany: values => values,
    remove: () => true
  };
  const spawner = new PlacementSpawner({
    entityFactory: { createEnemy: data => ({ ...data, isDead: false, isDying: false }) },
    entityStore: store,
    aiSystem: { registerAI: () => {}, deactivateAI: () => {}, unregisterAI: () => {} },
    getConditionRoot: key => (key === 'storyState' ? storyState : undefined),
    shouldSpawn
  });
  spawner._store = store;
  return spawner;
}

const registries = { enemies: { get: ref => (ref === 'enemy.s01_first_wolf' ? { id: 'enemy.s01_first_wolf', hp: 28 } : null) } };

describe('PlacementSpawner count 展开', () => {
  it('动态 count=3 派生 S01-first-wolf-1..3，实例 1 保持模板坐标，其余环形散布', () => {
    const spawner = createSpawner({ storyState: { s01Survival: { firstWolfSpotted: true, firstWolfCount: 3 } } });
    const result = spawner.spawnMatching({ placements: [TEMPLATE], registries, selector: { group: 'S01-first-wolf' } });
    expect(result.ok).not.toBe(false);
    expect(result.counts.enemy).toBe(3);
    expect(result.entities.map(entity => entity.id)).toEqual([
      'S01-first-wolf-1', 'S01-first-wolf-2', 'S01-first-wolf-3'
    ]);
    expect(result.entities[0].position).toEqual({ x: 100, y: 200 });
    const second = expandPlacement(TEMPLATE, 2);
    expect(result.entities[1].position).toEqual({ x: second.x, y: second.y });
    expect(result.entities[1].position).not.toEqual({ x: 100, y: 200 });
  });

  it('实例坐标只依赖 index：count 从 2 涨到 4 时既有实例位置不变，只增补新实例', () => {
    const storyState = { s01Survival: { firstWolfSpotted: true, firstWolfCount: 2 } };
    const spawner = createSpawner({ storyState });
    const selector = { group: 'S01-first-wolf' };
    const first = spawner.spawnMatching({ placements: [TEMPLATE], registries, selector });
    expect(first.counts.enemy).toBe(2);
    const atCount2 = first.entities.map(entity => entity.position);

    storyState.s01Survival.firstWolfCount = 4;
    const second = spawner.spawnMatching({ placements: [TEMPLATE], registries, selector });
    expect(second.counts.enemy).toBe(2);
    expect(second.outcomes.filter(outcome => outcome.status === 'alreadySpawned').map(outcome => outcome.placementId))
      .toEqual(['S01-first-wolf-1', 'S01-first-wolf-2']);
    expect(second.outcomes.filter(outcome => outcome.status === 'spawned').map(outcome => outcome.placementId))
      .toEqual(['S01-first-wolf-3', 'S01-first-wolf-4']);
    expect(second.entities.map(entity => entity.id)).toEqual(['S01-first-wolf-3', 'S01-first-wolf-4']);
    expect(spawner._store.enemies).toHaveLength(4);
    expect(atCount2).toEqual(first.entities.map(entity => entity.position));
  });

  it('count 缺省时不展开：单实体沿用模板 id，兼容旧数据', () => {
    const spawner = createSpawner();
    const legacy = { ...TEMPLATE, count: undefined };
    const result = spawner.spawnMatching({ placements: [legacy], registries, selector: { group: 'S01-first-wolf' } });
    expect(result.counts.enemy).toBe(1);
    expect(result.entities[0].id).toBe('S01-first-wolf');
    expect(result.entities[0].position).toEqual({ x: 100, y: 200 });
  });

  it.each([
    ['静态数字 9999 不设上限', { count: 9999 }, 9999],
    ['静态 0 钳制为 1', { count: 0 }, 1],
    ['动态负数钳制为 1', { count: { blackboardKey: 'storyState', path: 's01Survival.firstWolfCount' } }, 1],
    ['动态非法值回退 1', { count: { blackboardKey: 'storyState', path: 's01Survival.missing' } }, 1]
  ])('%s', (_name, countOverride, expected) => {
    const storyState = { s01Survival: { firstWolfCount: -3 } };
    const spawner = createSpawner({ storyState });
    const result = spawner.spawnMatching({
      placements: [{ ...TEMPLATE, ...countOverride }], registries, selector: { group: 'S01-first-wolf' }
    });
    expect(result.counts.enemy).toBe(expected);
    expect(spawner._store.enemies).toHaveLength(expected);
  });
});

function createRuntime({ storyState = {} } = {}) {
  const store = {
    enemies: [], all: [], pickups: [], equipmentItems: [],
    addEnemy: entity => {
      store.enemies.push(entity);
      store.all.push(entity);
    },
    removeMany: values => {
      const removed = new Set(values);
      store.enemies = store.enemies.filter(entity => !removed.has(entity));
      store.all = store.all.filter(entity => !removed.has(entity));
      return [...removed];
    },
    remove: () => true
  };
  const runtime = new ScenePlacementRuntime({
    entityStore: store,
    entityFactory: { createEnemy: data => ({ ...data, isDead: false, isDying: false }) },
    aiSystem: { registerAI: () => {}, deactivateAI: () => {}, unregisterAI: () => {} },
    getRegistries: () => registries,
    getConditionRoot: key => (key === 'storyState' ? storyState : undefined),
    validatePlacementReferences: () => ({ ok: true, errors: [] }),
    getWorldPromise: () => Promise.resolve({ ok: true })
  });
  runtime._store = store;
  return runtime;
}

describe('ScenePlacementRuntime count 模板的 tombstone 与派生 id', () => {
  it('退散 tombstone 派生实例后，重生只补新实例且不复活已退散个体', async () => {
    const storyState = { s01Survival: { firstWolfSpotted: true, firstWolfCount: 3 } };
    const runtime = createRuntime({ storyState });
    runtime.setProjection([TEMPLATE]);
    await runtime.spawn({ group: 'S01-first-wolf' });
    expect(runtime._store.enemies).toHaveLength(3);

    const tombstone = runtime.tombstonePlacement('S01-first-wolf-2');
    expect(tombstone.ok).toBe(true);
    expect(runtime._store.enemies.map(entity => entity.id)).toEqual(['S01-first-wolf-1', 'S01-first-wolf-3']);
    expect(runtime.inspectPlacement('S01-first-wolf-2').tombstoned).toBe(true);

    const respawn = await runtime.spawn({ group: 'S01-first-wolf' });
    expect(respawn.outcomes.find(outcome => outcome.placementId === 'S01-first-wolf-2').status).toBe('conditionFalse');
    expect(runtime._store.enemies).toHaveLength(2);

    storyState.s01Survival.firstWolfCount = 4;
    const grow = await runtime.spawn({ group: 'S01-first-wolf' });
    expect(grow.entities.map(entity => entity.id)).toEqual(['S01-first-wolf-4']);
    expect(runtime._store.enemies.map(entity => entity.id))
      .toEqual(['S01-first-wolf-1', 'S01-first-wolf-3', 'S01-first-wolf-4']);
  });

  it('_findPlacement 解析派生 id 到虚拟 placement，签名与 tombstone 一致', async () => {
    const storyState = { s01Survival: { firstWolfSpotted: true, firstWolfCount: 3 } };
    const runtime = createRuntime({ storyState });
    runtime.setProjection([TEMPLATE]);
    await runtime.spawn({ group: 'S01-first-wolf' });

    const virtual = runtime._findPlacement('S01-first-wolf-2');
    expect(virtual.id).toBe('S01-first-wolf-2');
    expect(virtual.x).toBe(expandPlacement(TEMPLATE, 2).x);
    expect(getPlacementSignature(virtual)).toBe(getPlacementSignature(expandPlacement(TEMPLATE, 2)));

    expect(runtime._findPlacement('S01-unknown-9')).toBeNull();
    runtime.setProjection([{ ...TEMPLATE, id: 'S01-single', count: undefined }]);
    expect(runtime._findPlacement('S01-single-2')).toBeNull();
  });
});

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { PlacementSpawner } from './PlacementSpawner.js';

/** army 出兵点：引用 armies 注册表定义，编制数量单一来源归定义。 */
const ARMY_PLACEMENT = {
  id: 'S02-army-guard', sceneId: 'S02', type: 'ref', kind: 'army', ref: 'army.s02.guard',
  group: 'S02-army', faction: 'ally', x: 425, y: 315,
  spawnWhen: { blackboardKey: 'storyState', path: 's02ZhangjiaoChoice', equals: 'save' }
};

const ARMY_DEFINITION = {
  id: 'army.s02.guard',
  name: '张角亲卫队',
  squads: [
    { id: 'qian', name: '前军', units: [{ ref: 'enemy.s02_yellow_turban_soldier', count: 2 }] },
    { id: 'hou', name: '后军', units: [{ ref: 'enemy.s02_yellow_turban_soldier', count: 1 }] }
  ]
};

const registries = {
  armies: { get: ref => (ref === 'army.s02.guard' ? ARMY_DEFINITION : null) },
  enemies: { get: ref => (ref === 'enemy.s02_yellow_turban_soldier' ? { id: 'enemy.s02_yellow_turban_soldier', maxHp: 40 } : null) }
};

function createSpawner({ storyState = {} } = {}) {
  const store = {
    enemies: [], all: [], pickups: [], equipmentItems: [],
    addEnemy: entity => store.enemies.push(entity),
    removeMany: values => values,
    remove: () => true
  };
  const spawner = new PlacementSpawner({
    entityFactory: {
      createEnemy: data => ({
        ...data,
        components: [],
        addComponent(component) { this.components.push(component); }
      })
    },
    entityStore: store,
    aiSystem: { registerAI: () => {}, deactivateAI: () => {}, unregisterAI: () => {} },
    getConditionRoot: key => (key === 'storyState' ? storyState : undefined)
  });
  spawner._store = store;
  return spawner;
}

function spawnGuard(spawner, { storyState } = {}) {
  return spawner.spawnMatching({
    placements: [ARMY_PLACEMENT],
    registries,
    selector: { group: 'S02-army' }
  });
}

describe('PlacementSpawner army 编制展开', () => {
  it('按 squads×units 展开士兵：数量/派生 id/counts.soldier 全对齐', () => {
    const spawner = createSpawner({ storyState: { s02ZhangjiaoChoice: 'save' } });
    const result = spawnGuard(spawner);
    expect(result.errors).toHaveLength(0);
    expect(result.counts.soldier).toBe(3);
    expect(result.counts.total).toBe(3);
    expect(result.entities.map(entity => entity.id)).toEqual([
      'S02-army-guard-qian-1', 'S02-army-guard-qian-2', 'S02-army-guard-hou-1'
    ]);
  });

  it('注入 SquadMember/CommandState 组件：armyId/squadId/formationIndex 分队内递增', () => {
    const spawner = createSpawner({ storyState: { s02ZhangjiaoChoice: 'save' } });
    const result = spawnGuard(spawner);
    const [qian1, qian2, hou1] = result.entities;
    expect(qian1.components.map(c => c.name)).toEqual(['squadMember', 'commandState']);
    expect(qian1.components[0].armyId).toBe('army.s02.guard');
    expect(qian1.components[0].squadId).toBe('qian');
    expect(qian1.components[0].formationIndex).toBe(0);
    expect(qian2.components[0].squadId).toBe('qian');
    expect(qian2.components[0].formationIndex).toBe(1);
    expect(hou1.components[0].squadId).toBe('hou');
    expect(hou1.components[0].formationIndex).toBe(0);
    expect(qian1.components[1].stance).toBe('hold');
    expect(qian1.faction).toBe('ally');
  });

  it('首兵在出兵点原位，其余环形散布不重叠；坐标只依赖展开序', () => {
    const spawner = createSpawner({ storyState: { s02ZhangjiaoChoice: 'save' } });
    const result = spawnGuard(spawner);
    const [first, second] = result.entities;
    expect(first.position).toEqual({ x: 425, y: 315 });
    expect(second.position.x).not.toBe(425);
    expect(second.position.y).not.toBe(315);
  });

  it('幂等：重入时虚拟实例 id 已登记，不重复生成', () => {
    const storyState = { s02ZhangjiaoChoice: 'save' };
    const spawner = createSpawner({ storyState });
    const first = spawnGuard(spawner, { storyState });
    expect(first.counts.soldier).toBe(3);
    const second = spawnGuard(spawner, { storyState });
    expect(second.counts.soldier).toBe(0);
    expect(second.outcomes.filter(outcome => outcome.status === 'alreadySpawned')).toHaveLength(3);
    expect(spawner._store.enemies).toHaveLength(3);
  });

  it('placement 上的 count 不影响编制数量（数量单一来源归 armies 定义）', () => {
    const spawner = createSpawner({ storyState: { s02ZhangjiaoChoice: 'save' } });
    const result = spawner.spawnMatching({
      placements: [{ ...ARMY_PLACEMENT, count: 5 }],
      registries,
      selector: { group: 'S02-army' }
    });
    expect(result.counts.soldier).toBe(3);
  });

  it('spawnWhen 门控：条件不满足时逐虚拟实例 conditionFalse', () => {
    const spawner = createSpawner({ storyState: { s02ZhangjiaoChoice: 'kill' } });
    const result = spawnGuard(spawner);
    expect(result.counts.soldier).toBe(0);
    expect(result.outcomes.filter(outcome => outcome.status === 'conditionFalse')).toHaveLength(3);
    expect(spawner._store.enemies).toHaveLength(0);
  });

  it('army 定义缺失：definitionNotFound 且不生成', () => {
    const spawner = createSpawner({ storyState: { s02ZhangjiaoChoice: 'save' } });
    const result = spawner.spawnMatching({
      placements: [{ ...ARMY_PLACEMENT, ref: 'army.missing' }],
      registries,
      selector: { group: 'S02-army' }
    });
    expect(result.counts.soldier).toBe(0);
    expect(result.errors[0]?.reason).toBe('definitionNotFound');
    expect(result.outcomes[0]?.status).toBe('failed');
  });

  it('unit.overrides 合并进兵种定义（placement overrides 同款语义）', () => {
    const spawner = createSpawner({ storyState: { s02ZhangjiaoChoice: 'save' } });
    const overrideDefinition = {
      ...ARMY_DEFINITION,
      squads: [
        { id: 'qian', name: '前军', units: [{ ref: 'enemy.s02_yellow_turban_soldier', count: 1, overrides: { stats: { speed: 65 } } }] }
      ]
    };
    const result = spawner.spawnMatching({
      placements: [ARMY_PLACEMENT],
      registries: {
        armies: { get: () => overrideDefinition },
        enemies: registries.enemies
      },
      selector: { group: 'S02-army' }
    });
    expect(result.entities[0].stats).toEqual({ speed: 65 });
  });
});

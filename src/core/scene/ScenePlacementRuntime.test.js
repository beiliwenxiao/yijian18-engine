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
import { ScenePlacementRuntime, getPlacementSignature } from './ScenePlacementRuntime.js';

function createRuntime(placement) {
  return new ScenePlacementRuntime({
    entityStore: {
      all: [], pickups: [], equipmentItems: [],
      removeMany: values => values
    }
  });
}

const placement = {
  id: 'S01-pickup-worn-axe', sceneId: 'S01', type: 'ref', kind: 'item',
  ref: 'tool.worn_axe', group: 'S01-worn-axe',
  overrides: { instanceId: 'S01-tool-axe-1' },
  spawnWhen: { blackboardKey: 'storyState', path: 's01Survival.axeDropped', equals: true },
  x: 643, y: 506, _localX: 643, _localY: 506
};

describe('ScenePlacementRuntime placement definition signatures', () => {
  it('应用签名匹配的动态状态', () => {
    const runtime = createRuntime(placement);
    runtime.setProjection([placement]);
    runtime.addPendingPlacementState(placement.id, {
      kind: 'item', quantity: 2, placementSignature: getPlacementSignature(placement)
    });
    const item = { placementId: placement.id, quantity: 1 };

    runtime.applyPendingToExisting([item]);

    expect(item.quantity).toBe(2);
    expect(runtime.pendingPlacementStates.has(placement.id)).toBe(false);
  });

  it('签名缺失的旧状态按当前 canonical placement 补签并应用', () => {
    // 现行契约：addPendingPlacementState 为缺失签名自动补当前签名（旧存档兼容）
    const runtime = createRuntime(placement);
    runtime.setProjection([placement]);
    runtime.addPendingPlacementState(placement.id, { kind: 'item', quantity: 2, placementSignature: undefined });
    const item = { placementId: placement.id, quantity: 1 };

    runtime.applyPendingToExisting([item]);

    expect(item.quantity).toBe(2);
    expect(runtime.pendingPlacementStates.has(placement.id)).toBe(false);
  });

  it('坐标已编辑的旧状态不会覆盖当前 canonical placement', () => {
    const runtime = createRuntime(placement);
    runtime.setProjection([placement]);
    runtime.addPendingPlacementState(placement.id, {
      kind: 'item', quantity: 2,
      placementSignature: getPlacementSignature({ ...placement, _localX: 500, _localY: 480, x: 500, y: 480 })
    });
    const item = { placementId: placement.id, quantity: 1 };

    runtime.applyPendingToExisting([item]);

    expect(item.quantity).toBe(1);
    expect(runtime.pendingPlacementStates.has(placement.id)).toBe(false);
  });
});

describe('ScenePlacementRuntime 放置碰撞体（dynamic collider）', () => {
  function createColliderRuntime(placement) {
    const calls = [];
    const entity = { placementId: placement.id };
    const runtime = new ScenePlacementRuntime({
      entityStore: {
        all: [entity], pickups: [], equipmentItems: [],
        removeMany: values => values
      },
      setDynamicCollider: operation => {
        calls.push(operation);
        return true;
      }
    });
    runtime.setProjection([placement]);
    return { runtime, calls, entity };
  }

  it('collision.polygons 一次注册多块碰撞体，移除时一次清理', () => {
    const gate = {
      id: 'S02-camp-gate', sceneId: 'S02', type: 'ref', kind: 'building',
      ref: 'building.s02.gate', x: 600, y: 528, _localX: 600, _localY: 528,
      collision: {
        mode: 'block', shapeType: 'polygon', jumpBlock: true,
        polygons: [
          [[-75, -16], [-45, -16], [-45, -2], [-75, -2]],
          [[45, -16], [75, -16], [75, -2], [45, -2]]
        ]
      }
    };
    const { runtime, calls, entity } = createColliderRuntime(gate);

    const result = runtime._syncDynamicColliders([entity]);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'S02-camp-gate', sceneId: 'S02', mode: 'block', enabled: true });
    expect(calls[0].shapes).toHaveLength(2);
    expect(calls[0].shapes[0].points[0]).toEqual([525, 512]);
    expect(calls[0].shapes[1].points[0]).toEqual([645, 512]);
    expect(calls[0].shapes.every(item => item.jumpBlock === true)).toBe(true);
    expect(calls[0].shape).toBe(calls[0].shapes[0]);

    expect(runtime._removeDynamicCollider('S02-camp-gate')).toBe(true);
    expect(calls[1]).toMatchObject({ id: 'S02-camp-gate', enabled: false });
  });

  it('旧 collision.points 单多边形仍按单碰撞体注册', () => {
    const wall = {
      id: 'S02-wall-south-1', sceneId: 'S02', type: 'ref', kind: 'building',
      ref: 'building.s02.wall', x: 480, y: 528, _localX: 480, _localY: 528,
      collision: {
        mode: 'block', shapeType: 'polygon',
        points: [[-58, -16], [58, -16], [58, -2], [-58, -2]]
      }
    };
    const { runtime, calls, entity } = createColliderRuntime(wall);

    runtime._syncDynamicColliders([entity]);

    expect(calls[0].shapes).toHaveLength(1);
    expect(calls[0].shapes[0].points[0]).toEqual([422, 512]);
  });
});

describe('ScenePlacementRuntime story 生成模式（生成账本 spawnLedger）', () => {
  const storyPlacement = () => ({
    id: 'S01-wolf-pack-1', sceneId: 'S01', type: 'ref', kind: 'item',
    ref: 'tool.worn_axe', group: 'S01-wolf-pack', spawnMode: 'story',
    // story 模式下 spawnWhen 被忽略：即便写 true 条件也不影响账本判定
    spawnWhen: { blackboardKey: 'storyState', path: 's01Survival.anything', equals: true },
    x: 300, y: 300
  });

  function createStoryRuntime({ ledger = {}, committedGroups = [] } = {}) {
    const pickups = [];
    const store = {
      all: [], pickups, equipmentItems: [],
      addPickup: item => pickups.push(item),
      removeMany: values => {
        for (const value of values) {
          const index = pickups.indexOf(value);
          if (index >= 0) pickups.splice(index, 1);
        }
        return values;
      }
    };
    const runtime = new ScenePlacementRuntime({
      entityStore: store,
      getWorldPromise: () => Promise.resolve({ region: {} }),
      validatePlacementReferences: () => ({ ok: true, errors: [] }),
      getRegistries: () => ({ items: { 'tool.worn_axe': { id: 'tool.worn_axe', name: '破旧斧头' } } }),
      getConditionRoot: key => (key === 'spawnLedger' ? ledger : undefined),
      // 与宿主接线同构：记账钩子真实写入账本（供后续重载判定）
      commitSpawnLedger: groupIds => {
        committedGroups.push(...groupIds);
        for (const groupId of groupIds) ledger[groupId] = true;
      }
    });
    runtime.setProjection([storyPlacement()]);
    return { runtime, pickups, ledger, committedGroups };
  }

  it('未触发（账本无记录）：流式/场景加载自动生成被拒且不记账', async () => {
    const { runtime, pickups, committedGroups } = createStoryRuntime();
    const result = await runtime.spawn({ sceneId: 'S01' });
    expect(result.ok).toBe(true);
    expect(result.outcomes[0].status).toBe('conditionFalse');
    expect(pickups).toHaveLength(0);
    expect(committedGroups).toEqual([]);
  });

  it('权威生成（spawnPlacements 触发动作）：越过账本直接生成并记账', async () => {
    const { runtime, pickups, ledger, committedGroups } = createStoryRuntime();
    const result = await runtime.spawn({ group: 'S01-wolf-pack', authoritative: true });
    expect(result.ok).toBe(true);
    expect(result.outcomes[0].status).toBe('spawned');
    expect(pickups).toHaveLength(1);
    expect(committedGroups).toEqual(['S01-wolf-pack']);
    expect(ledger['S01-wolf-pack']).toBe(true);
  });

  it('记账后：重载/流式（非权威）按账本自动生成，重复权威生成 alreadySpawned 幂等', async () => {
    const { runtime, pickups } = createStoryRuntime({ ledger: { 'S01-wolf-pack': true } });
    const reload = await runtime.spawn({ sceneId: 'S01' });
    expect(reload.outcomes[0].status).toBe('spawned');
    expect(pickups).toHaveLength(1);

    const repeat = await runtime.spawn({ group: 'S01-wolf-pack', authoritative: true });
    expect(repeat.outcomes[0].status).toBe('alreadySpawned');
    expect(pickups).toHaveLength(1);
  });

  it('despawn 互斥：tombstone 压过账本——移除后权威与非权威都不再生成', async () => {
    const { runtime, pickups } = createStoryRuntime({ ledger: { 'S01-wolf-pack': true } });
    // 先生成一次（建立 spawnedPlacementIds 登记），再剧情移除（tombstone）
    await runtime.spawn({ sceneId: 'S01' });
    expect(pickups).toHaveLength(1);
    const despawn = await runtime.despawn({ group: 'S01-wolf-pack' });
    expect(despawn.ok).toBe(true);
    expect(pickups).toHaveLength(0);

    const retried = await runtime.spawn({ group: 'S01-wolf-pack', authoritative: true });
    expect(retried.outcomes[0].status).toBe('conditionFalse');
    expect(pickups).toHaveLength(0);
    const streamed = await runtime.spawn({ sceneId: 'S01' });
    expect(streamed.outcomes[0].status).toBe('conditionFalse');
    expect(pickups).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S01S02Coordinator } from '../example/sanguo_zhangjiao/systems/S01S02SceneFlow.js';
import { compileQuestProject } from '../src/systems/quest/QuestRuntime.js';
import { CanonicalStateTransactionService } from '../src/systems/CanonicalStateTransactionService.js';
import { validateTriggerActionParams } from '../src/systems/TriggerCatalog.js';
import { loadProjectWithShards } from './support/projectFixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const project = await loadProjectWithShards();

function createSceneStub({ story = {} } = {}) {
  const tombstones = [];
  const entities = new Map();
  const scene = {
    currentSceneId: 'S01',
    context: { services: {} },
    gameLoader: {
      blackboard: {
        get: key => (key === 'storyState' ? { ...story } : undefined),
        set: (key, value) => { if (key === 'storyState') Object.assign(story, value); }
      }
    },
    entityStore: {
      getById: id => entities.get(id) || null,
      removeMany: values => {
        for (const value of values) entities.delete(value.placementId || value.id);
        return [...values];
      }
    },
    aiSystem: { unregisterAI: () => {}, activateAI: () => true }
  };
  scene.context.services.placements = {
    tombstonePlacement: (placementId, state) => {
      // 镜像真实语义：tombstone 同时销毁 live 实体（ScenePlacementRuntime._destroyValues）。
      const live = [...entities.values()].find(value => (value.placementId || value.id) === placementId);
      if (live) entities.delete(live.placementId || live.id);
      tombstones.push({ placementId, state });
      return { ok: true, placementId, removed: !!live };
    },
    inspectPlacement: () => ({ tombstoned: false })
  };
  scene._tombstones = tombstones;
  scene._entities = entities;
  scene.publishApplicationEvent = () => Promise.resolve({ ok: true });
  return scene;
}

function createWolf(scene, index) {
  const wolf = {
    id: `S01-first-wolf-${index}`,
    placementId: `S01-first-wolf-${index}`,
    isCorpse: false,
    isDead: false,
    isDying: false,
    getComponent: () => null
  };
  scene._entities.set(wolf.id, wolf);
  return wolf;
}

describe('S01 首狼群数量旋钮', () => {
  it('_firstWolfCount 缺省 1，下限钳制 1 且不设上限', () => {
    for (const [stored, expected] of [[undefined, 1], [0, 1], [-3, 1], [5, 5], [9999, 9999], ['7', 7]]) {
      const story = { s01Survival: { firstWolfCount: stored } };
      const coordinator = new S01S02Coordinator(createSceneStub({ story }));
      expect(coordinator._firstWolfCount()).toBe(expected);
    }
  });

  it('commitStoryWhenReady 把触发器参数 firstWolfCount 传入事务 payload；缺省时不携带', async () => {
    const coordinator = new S01S02Coordinator(createSceneStub());
    const submits = [];
    coordinator._submit = (definitionId, payload, operationId) => {
      submits.push({ definitionId, payload, operationId });
      return Promise.resolve({ ok: true });
    };
    const baseParams = {
      completedPath: 's01Survival.firstWolfSpotted',
      definitionId: 'story.s01.firstWolfSpotted',
      gte: 3,
      operation: 'commitStoryWhenReady',
      storyPath: 's01Survival.campfireRefuelCount'
    };
    await coordinator._commitStoryWhenReady({ ...baseParams, firstWolfCount: 5 }, { operationId: 'op-1' });
    await coordinator._commitStoryWhenReady({ ...baseParams }, { operationId: 'op-2' });
    expect(submits[0].payload).toEqual({ firstWolfCount: 5 });
    expect(submits[1].payload).toEqual({});
    expect(submits[0].operationId).toBe('op-1:state:story.s01.firstWolfSpotted');
  });

  it('任意 S01-first-wolf-N 死亡都进入首杀管线，无关实体被拒绝', async () => {
    const coordinator = new S01S02Coordinator(createSceneStub());
    const published = [];
    coordinator._publishFirstWolfKillWhenReady = entity => {
      published.push(entity.id);
      return Promise.resolve(true);
    };
    expect(await coordinator.handleEnemyKilled({ id: 'S01-first-wolf-7' })).toBe(true);
    expect(await coordinator.handleEnemyKilled({ id: 'S01-first-wolf-23' })).toBe(true);
    expect(await coordinator.handleEnemyKilled({ id: 'S01-chase-wolf-1' })).toBe(true);
    expect(await coordinator.handleEnemyKilled({ id: 'S01-wanderer-1' })).toBe(false);
    expect(published).toEqual(['S01-first-wolf-7', 'S01-first-wolf-23']);
  });

  it('首杀发布后其余教学狼退散：击杀个体保留，其余 tombstone 且移出场景', async () => {
    const scene = createSceneStub({ story: { s01Survival: { firstWolfCount: 4 } } });
    const coordinator = new S01S02Coordinator(scene);
    for (const index of [1, 2, 3, 4]) createWolf(scene, index);
    coordinator._retreatRemainingFirstWolves('S01-first-wolf-2');
    expect(scene._tombstones.map(entry => entry.placementId).sort())
      .toEqual(['S01-first-wolf-1', 'S01-first-wolf-3', 'S01-first-wolf-4']);
    expect(scene._entities.has('S01-first-wolf-2')).toBe(true);
    expect(scene._entities.has('S01-first-wolf-1')).toBe(false);
    expect(scene._entities.has('S01-first-wolf-3')).toBe(false);
    expect(scene._entities.has('S01-first-wolf-4')).toBe(false);
    expect(coordinator.firstWolfRetreatDone).toBe(true);
  });

  it('退散后同帧双杀竞态不再重复进入首杀管线', async () => {
    const coordinator = new S01S02Coordinator(createSceneStub());
    const published = [];
    coordinator._publishFirstWolfKillWhenReady = entity => {
      published.push(entity.id);
      return Promise.resolve(true);
    };
    coordinator.firstWolfRetreatDone = true;
    expect(await coordinator.handleEnemyKilled({ id: 'S01-first-wolf-3' })).toBe(true);
    expect(published).toEqual([]);
  });
});

describe('首狼出现事务的数据契约（真实 game.project.json）', () => {
  const definition = project.commands.find(command => command.id === 'story.s01.firstWolfSpotted');
  const firstWolfPlacements = readJson('example/sanguo_zhangjiao/assets/scenes/S01.json')
    .layers.flatMap(layer => layer.objects || [])
    .filter(object => object.group === 'S01-first-wolf');

  function createTransactionService(storyState) {
    const store = { storyState, cityStates: [] };
    const blackboard = {
      get: key => store[key],
      set: (key, value) => { store[key] = value; },
      serialize: () => ({ ...store }),
      deserialize: data => Object.assign(store, data)
    };
    const service = new CanonicalStateTransactionService({
      definitionRepository: {
        get: (kind, id) => (kind === 'commands' && id === definition.id ? definition : null)
      },
      getBlackboard: () => blackboard
    });
    const context = {
      preparedStateRevision: { stateId: 'canonical:state', stateRevision: 1 },
      commitStateRevision: () => ({ ok: true, stateRevision: 2 })
    };
    return { service, context };
  }

  async function storyAfter(payload) {
    const storyState = {
      currentSceneId: 'S01',
      s01Survival: { campfireLit: true, campfireRefuelCount: 3, firstWolfSpotted: false }
    };
    const { service, context } = createTransactionService(storyState);
    const outcome = await service.execute({
      commandType: 'state.transaction',
      operationId: 'op-test:state:story.s01.firstWolfSpotted',
      payload: { definitionId: definition.id, ...payload }
    }, context);
    expect(outcome.result?.ok, JSON.stringify(outcome.result?.error || null)).toBe(true);
    return outcome.result.value.state.story.s01Survival;
  }

  it('payload 未携带 firstWolfCount 时缺省写 1（兼容旧触发器与旧档）', async () => {
    const survival = await storyAfter({});
    expect(survival.firstWolfSpotted).toBe(true);
    expect(survival.firstWolfCount).toBe(1);
  });

  it('payload firstWolfCount=5 写入 5；0 与负数钳制为 1；字符串数字可解析', async () => {
    expect((await storyAfter({ firstWolfCount: 5 })).firstWolfCount).toBe(5);
    expect((await storyAfter({ firstWolfCount: 0 })).firstWolfCount).toBe(1);
    expect((await storyAfter({ firstWolfCount: -2 })).firstWolfCount).toBe(1);
    expect((await storyAfter({ firstWolfCount: '7' })).firstWolfCount).toBe(7);
  });

  it('触发器与场景数据契约：提交链携带 firstWolfCount，S01 首狼为单个 count 模板', () => {
    // 方案 B 编排步骤化：spotWolf 后段（提交 firstWolfSpotted）由任务步骤编译产物承担；
    // 故障恢复链仍由 triggers[] 手写承担
    const compiledAfterSpotWolf = compileQuestProject(project).triggers
      .find(trigger => trigger.id === 'trg_task.s01.survival_after_spotWolf');
    const recoveryTrigger = project.triggers.find(entry => entry.id === 'trg_s01_first_wolf_recovery_requested');
    const candidates = [
      ['trg_task.s01.survival_after_spotWolf', compiledAfterSpotWolf?.do?.find(action => action.stepId === 'step.after.spotWolf.1')],
      ['trg_s01_first_wolf_recovery_requested', recoveryTrigger?.do?.find(action => action.stepId === 'commit-first-wolf-spotted')]
    ];
    for (const [triggerId, step] of candidates) {
      expect(step, triggerId).toBeTruthy();
      expect(step?.params?.firstWolfCount, triggerId).toEqual(expect.any(Number));
      expect(step.params.firstWolfCount).toBeGreaterThanOrEqual(1);
      // 行为目录必须登记 firstWolfCount（paramsSchema additionalProperties:false），
      // 否则项目校验拒绝该参数、事件编辑器也不渲染数量输入。
      expect(validateTriggerActionParams(step, project, `${triggerId}.do`), triggerId).toEqual([]);
    }
    expect(firstWolfPlacements).toHaveLength(1);
    const template = firstWolfPlacements[0];
    expect(template.id).toBe('S01-first-wolf');
    expect(template.count).toEqual({ blackboardKey: 'storyState', path: 's01Survival.firstWolfCount' });
    expect(template.spawnWhen).toEqual({
      blackboardKey: 'storyState', equals: true, path: 's01Survival.firstWolfSpotted'
    });
    expect(template.ref).toBe('enemy.s01_first_wolf');
  });
});

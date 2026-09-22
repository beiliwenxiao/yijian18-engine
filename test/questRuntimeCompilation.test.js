import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateQuestDefinition,
  compileQuestProject,
  compileQuest,
  compileAcceptWhen,
  validateQuestCompilation
} from '../src/systems/quest/QuestRuntime.js';
import {
  buildFactCatalog,
  deriveFactsFromCommands,
  factPathsByDefinitionId
} from '../src/systems/quest/FactCatalog.js';
import { TaskGraphSystem } from '../src/systems/TaskGraphSystem.js';
import { QuestTransactionService } from '../src/systems/QuestTransactionService.js';
import { GameLoader } from '../src/core/GameLoader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const project = readJson('example/sanguo_zhangjiao/game.project.json');

const SAMPLE_QUEST = {
  id: 'quest.test.survival',
  title: '荒原求生',
  description: '测试任务',
  category: 'main',
  scenes: ['S01'],
  accept: { mode: 'auto', when: { type: 'fact', fact: 'story.test.introDone' } },
  steps: [
    { id: 'intro', type: 'dialogue', dialogueId: 'dlg_test_intro', await: true },
    { id: 'tut', type: 'tutorial', tutorialId: 'tut_test_move', await: true },
    { id: 'wood', type: 'objective', objectiveType: 'gather.item', target: 'resource.wood', requiredCount: 3, title: '采集木材' },
    { id: 'spawn', type: 'action', action: 'state.transaction', params: { definitionId: 'story.test.wolfSpawn' } },
    { id: 'wolf', type: 'objective', objectiveType: 'kill.enemy', target: 'story.test.wolfKilled', requiredCount: 1, title: '击杀野狼' },
    { id: 'tip', type: 'action', action: 'showTip', params: { text: '完成' } }
  ],
  completion: { mode: 'allObjectives' },
  rewards: [
    { type: 'state', definitionId: 'story.test.survivalDone' },
    { type: 'items', items: [{ itemId: 'item.potion', count: 2 }] }
  ]
};

describe('QuestRuntime Quest v2 编译器', () => {
  it('空 quests[] 返回空产物（零回归直通）', () => {
    expect(compileQuestProject({})).toEqual({ taskGraphs: [], triggers: [] });
    expect(compileQuestProject({ quests: [] })).toEqual({ taskGraphs: [], triggers: [] });
    expect(compileQuestProject(null)).toEqual({ taskGraphs: [], triggers: [] });
  });

  it('taskGraph 编译：objective 直连成链（裸 nodeId 与手写任务图寻址一致），matcher 由目标类型目录生成', () => {
    const { taskGraph } = compileQuest(SAMPLE_QUEST, project);
    expect(taskGraph.id).toBe('quest.test.survival');
    expect(taskGraph.entryNodeId).toBe('start');
    const types = taskGraph.nodes.map(node => node.type);
    expect(types).toEqual(['start', 'objective', 'objective', 'complete']);
    const wood = taskGraph.nodes.find(node => node.id === 'wood');
    expect(wood.eventMatcher).toEqual({ type: 'gathering.completed', payload: { itemId: 'resource.wood' } });
    expect(wood.progressBy).toBe('accepted');
    expect(wood.requiredCount).toBe(3);
    expect(wood.next).toEqual(['wolf']);
    const wolf = taskGraph.nodes.find(node => node.id === 'wolf');
    expect(wolf.eventMatcher).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.test.wolfKilled' } });
    expect(wolf.progressBy).toBeUndefined();
    // 非 objective 步骤不进节点链（藏进编排触发器 do 链）
    expect(taskGraph.nodes.find(node => node.id === 'intro')).toBeUndefined();
  });

  it('触发器编译：accept/intro/目标后段/completion 四类产物齐全且语义正确', () => {
    const { triggers } = compileQuest(SAMPLE_QUEST, project);
    const ids = triggers.map(trigger => trigger.id);
    expect(ids).toEqual([
      'trg_quest.test.survival_accept',
      'trg_quest.test.survival_intro',
      'trg_quest.test.survival_after_wood',
      'trg_quest.test.survival_after_wolf',
      'trg_quest.test.survival_complete'
    ]);

    const accept = triggers[0];
    expect(accept.when).toEqual({ type: 'state.transaction', params: { definitionId: 'story.test.introDone' } });
    expect(accept.once).toBe(true);
    expect(accept.editorScope).toEqual({ sceneIds: ['S01'] });
    expect(accept.do[0].params).toEqual({
      definitionId: 'quest.test.survival',
      instanceId: 'quest.test.survival.main',
      operation: 'task.start',
      tracking: true
    });

    const intro = triggers[1];
    expect(intro.when).toEqual({ type: 'task.started', params: { definitionId: 'quest.test.survival' } });
    expect(intro.do.map(action => action.action)).toEqual(['dialogue.command', 'tutorial.command']);
    expect(intro.do[0].params).toEqual({ dialogueId: 'dlg_test_intro', operation: 'start' });
    expect(intro.do[1].params).toEqual({ operation: 'show', tutorialId: 'tut_test_move', await: true });

    const afterWood = triggers[2];
    // objective 的 eventMatcher 兼作编排触发器 when（同一事件双消费：任务图 + 编排）
    expect(afterWood.when).toEqual({ type: 'gathering.completed', params: { itemId: 'resource.wood' } });
    expect(afterWood.do.map(action => action.action)).toEqual(['state.transaction']);

    const completion = triggers[4];
    expect(completion.when).toEqual({ type: 'task.completed', params: { definitionId: 'quest.test.survival' } });
    expect(completion.do.map(action => action.action)).toEqual(['state.transaction', 'giveReward']);
    expect(completion.do[1].params).toEqual({ items: [{ id: 'item.potion', quantity: 2 }] });
  });

  it('manual 接取不生成 accept 触发器；无 scenes 不带 editorScope；accept.when 三来源编译', () => {
    const manual = compileQuest({ ...SAMPLE_QUEST, accept: { mode: 'manual', when: SAMPLE_QUEST.accept.when } }, project);
    expect(manual.triggers.some(trigger => trigger.id.endsWith('_accept'))).toBe(false);

    const globalQuest = compileQuest({ ...SAMPLE_QUEST, scenes: [] }, project);
    expect(globalQuest.triggers.every(trigger => trigger.editorScope === undefined)).toBe(true);

    expect(compileAcceptWhen({ type: 'questCompleted', questId: 'quest.a.b' }))
      .toEqual({ type: 'task.completed', params: { definitionId: 'quest.a.b' } });
    expect(compileAcceptWhen({ type: 'event', event: 'sceneEnter', params: { sceneId: 'S01' } }))
      .toEqual({ type: 'sceneEnter', params: { sceneId: 'S01' } });
  });

  it('编译确定性：同一定义两次编译产物 JSON 完全一致（per-trigger fingerprint 稳定的前提）', () => {
    const first = JSON.stringify(compileQuest(SAMPLE_QUEST, project));
    const second = JSON.stringify(compileQuest(structuredClone(SAMPLE_QUEST), project));
    expect(first).toBe(second);
  });

  it('编译产物通过 TaskGraphSystem 与 TriggerCatalog 的唯一校验器（与手写定义同规同矩）', () => {
    const compilation = compileQuest(SAMPLE_QUEST, project);
    expect(validateQuestCompilation(compilation)).toEqual([]);
  });

  it('validateQuestDefinition：缺失字段 / 未知目标类型 / 重复步骤 id 报错', () => {
    expect(validateQuestDefinition({ id: 'a.b', title: 'x', steps: [] }).length).toBeGreaterThan(0);
    expect(validateQuestDefinition({ ...SAMPLE_QUEST, steps: SAMPLE_QUEST.steps.map(step => ({ ...step, id: 'dup' })) }).length).toBeGreaterThan(0);
    expect(validateQuestDefinition({
      ...SAMPLE_QUEST,
      steps: [{ id: 'x', type: 'objective', objectiveType: 'no.such.type', target: 'y' }]
    }).some(message => message.includes('未在目标类型目录登记'))).toBe(true);
    expect(validateQuestDefinition(SAMPLE_QUEST)).toEqual([]);
  });

  it('QuestTransactionService：task.started/task.completed 应用事件带顶层 definitionId/instanceId（触发器浅匹配契约）', async () => {
    const { taskGraph } = compileQuest(SAMPLE_QUEST, project);
    const system = new TaskGraphSystem({ definitions: [taskGraph] });
    const service = new QuestTransactionService({ taskGraphSystem: system });
    const context = {
      preparedStateRevision: { stateId: 'quest:test', stateRevision: 1 },
      commitStateRevision: revision => ({ ok: true, stateRevision: revision.stateRevision })
    };
    const startOutcome = await service._executeTaskGraph({
      operation: 'task.start',
      command: { operationId: 'op-start', payload: { definitionId: 'quest.test.survival' } },
      context,
      actorId: 'player-1'
    });
    expect(startOutcome.result.ok).toBe(true);
    expect(startOutcome.result.value.definitionId).toBe('quest.test.survival');
    expect(startOutcome.applicationEvents[0].type).toBe('task.started');
    expect(startOutcome.applicationEvents[0].payload.definitionId).toBe('quest.test.survival');

    await service._executeTaskGraph({
      operation: 'task.event',
      command: {
        operationId: 'op-wood',
        payload: { event: { eventId: 'evt-wood-1', type: 'gathering.completed', payload: { itemId: 'resource.wood', accepted: 3 } } }
      },
      context,
      actorId: 'player-1'
    });
    const finishOutcome = await service._executeTaskGraph({
      operation: 'task.event',
      command: {
        operationId: 'op-wolf',
        payload: { event: { eventId: 'evt-wolf-1', type: 'state.transaction', payload: { definitionId: 'story.test.wolfKilled' } } }
      },
      context,
      actorId: 'player-1'
    });
    const completed = finishOutcome.applicationEvents.find(event => event.type === 'task.completed');
    expect(completed, '两个目标达成后应发布 task.completed').toBeTruthy();
    expect(completed.payload.definitionId).toBe('quest.test.survival');
    // 未显式指定 instanceId 时由 TaskGraphSystem 自动生成；顶层字段应与 task.started 的实际实例一致
    expect(completed.payload.instanceId).toBe(startOutcome.result.value.instanceId);
  });

  it('GameLoader：构造即暴露 questTaskDefinitions；s01/s02 全部由 quests[] 编译（taskGraphs[] 通道已清零）', () => {
    const loader = new GameLoader();
    expect(loader.questTaskDefinitions).toEqual([]);
    const compiled = compileQuestProject(project);
    expect(compiled.taskGraphs.map(graph => graph.id)).toEqual(['task.s01.survival', 'task.s02.summons']);
    // S01/S02 无 accept/rewards（接取由现有触发器承担）；S01 开场教程步骤（step.1.1 → s01.move）
    // 编译为 intro 触发器：task.started 驱动 tutorial.command show——这是首个由 quest 步骤承接的编排段
    const s01Intro = compiled.triggers.find(trigger => trigger.id === 'trg_task.s01.survival_intro');
    expect(s01Intro).toBeTruthy();
    expect(s01Intro.when).toEqual({ type: 'task.started', params: { definitionId: 'task.s01.survival' } });
    expect(s01Intro.do[0].action).toBe('tutorial.command');
    expect(s01Intro.do[0].params).toEqual({ tutorialId: 's01.move', operation: 'show' });
    expect(compiled.triggers.filter(trigger => trigger !== s01Intro)).toEqual([]); // 除 intro 外无其余产物
    // 手写任务图通道已清零：taskGraphs[] 为空数组（保留数据通道，编辑入口收敛到任务编辑器）
    expect(project.taskGraphs).toEqual([]);
  });
});

describe('阶段③ S01 迁移契约：quest 编译产物与手写任务图逐节点等价', () => {
  const compiledGraph = compileQuestProject(project).taskGraphs.find(graph => graph.id === 'task.s01.survival');

  it('s02 迁移契约：接受召见 → 前往粥棚营地 线性链（state.transaction 事实驱动）', () => {
    const s02Graph = compileQuestProject(project).taskGraphs.find(graph => graph.id === 'task.s02.summons');
    expect(s02Graph.entryNodeId).toBe('start');
    expect(s02Graph.nodes.filter(node => node.type === 'objective').map(node => node.id)).toEqual(['acceptSummons', 'travel']);
    expect(s02Graph.nodes.find(node => node.id === 'acceptSummons').eventMatcher).toEqual({
      type: 'state.transaction', payload: { definitionId: 'story.s02.summons.accept' }
    });
    expect(s02Graph.nodes.find(node => node.id === 'travel').eventMatcher).toEqual({
      type: 'state.transaction', payload: { definitionId: 'story.s02.travel' }
    });
  });

  it('任务图结构：16 objective 线性链 + 裸 start/complete 节点（存档 nodeStates 寻址兼容）', () => {
    expect(compiledGraph, 'quests[] 迁移后应能编译出 task.s01.survival').toBeTruthy();
    expect(compiledGraph.entryNodeId).toBe('start');
    expect(compiledGraph.title).toBe('荒原求生');
    expect(compiledGraph.category).toBe('main');
    const objectives = compiledGraph.nodes.filter(node => node.type === 'objective');
    expect(objectives.map(node => node.id)).toEqual([
      'lightCampfire', 'findTools', 'gatherBerries', 'eatBerry', 'gatherWood',
      'spotWolf', 'killWolf', 'skinWolf', 'cookMeat', 'craftGear',
      'buildShelter', 'stayOvernight', 'leaveShelter', 'crossRiver', 'reachCliff', 'escape'
    ]);
    expect(compiledGraph.nodes.at(-1)).toEqual({ id: 'complete', type: 'complete' });
    // 线性链：前一个 objective 的 next 恰好指向后一个
    objectives.forEach((node, index) => {
      expect(node.next).toEqual([objectives[index + 1]?.id || 'complete']);
    });
  });

  it('事件 matcher 逐节点等价：state.transaction 事实 / gathering.completed 采集（含 resourceType 附加限定与 progressBy）', () => {
    const matcherOf = id => compiledGraph.nodes.find(node => node.id === id)?.eventMatcher;
    expect(matcherOf('lightCampfire')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.campfireLit' } });
    expect(matcherOf('findTools')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.initialToolsPicked' } });
    // gatherBerries 手写定义无 progressBy——迁移后保持逐事件 +1 语义（progressBy:null 显式覆盖目录默认）
    expect(matcherOf('gatherBerries')).toEqual({ type: 'gathering.completed', payload: { itemId: 'resource.wild_berry' } });
    expect(compiledGraph.nodes.find(node => node.id === 'gatherBerries').progressBy).toBeUndefined();
    expect(matcherOf('eatBerry')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.berryEaten' } });
    // gatherWood：resourceType 附加限定保留 + 按入包份数累计
    expect(matcherOf('gatherWood')).toEqual({
      type: 'gathering.completed',
      payload: { itemId: 'resource.wood', resourceType: 'wood' }
    });
    expect(compiledGraph.nodes.find(node => node.id === 'gatherWood').progressBy).toBe('accepted');
    expect(matcherOf('spotWolf')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.refuelCampfire' } });
    expect(matcherOf('killWolf')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.firstWolfKilled' } });
    expect(matcherOf('skinWolf')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.wolfSkinned' } });
    expect(matcherOf('escape')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.complete' } });
    // 全部 objective requiredCount 语义等价（手写仅 gatherWood 显式 1，其余缺省按 1）
    for (const node of compiledGraph.nodes.filter(entry => entry.type === 'objective')) {
      expect(node.requiredCount).toBe(1);
    }
  });

  it('迁移后触发器零删除：trg_s01_start_survival_task 等仍由 triggers[] 手写承担', () => {
    const acceptTrigger = project.triggers.find(trigger => trigger.id === 'trg_s01_start_survival_task');
    expect(acceptTrigger).toBeTruthy();
    expect(acceptTrigger.do[0].params.definitionId).toBe('task.s01.survival');
    // 编译产物仅含 intro 触发器（开场教程步骤），无 accept/steps 后段/rewards 编排触发器
    const triggers = compileQuestProject(project).triggers;
    expect(triggers.map(trigger => trigger.id)).toEqual(['trg_task.s01.survival_intro']);
  });

  it('编译产物通过唯一校验器', () => {
    expect(validateQuestCompilation(compileQuestProject(project))).toEqual([]);
  });
});

describe('FactCatalog 事实目录', () => {
  it('从 commands[] 自动派生 state.transaction 事实（reconcileTaskFacts 同源推导）', () => {
    const facts = deriveFactsFromCommands(project);
    expect(facts.length).toBeGreaterThan(0);
    const refuel = facts.find(fact => fact.id === 'story.s01.refuelCampfire');
    expect(refuel).toBeTruthy();
    expect(refuel.source).toBe('transaction');
    expect(Array.isArray(refuel.paths)).toBe(true);
    const map = factPathsByDefinitionId(project);
    expect(map.get('story.s01.firstWolfKilled')?.length).toBeGreaterThan(0);
  });

  it('项目 questCatalog.facts 可覆盖派生条目 label 并登记事件型事实', () => {
    const extended = {
      ...project,
      questCatalog: {
        facts: [
          { id: 'story.s01.refuelCampfire', label: '添柴重燃' },
          { id: 'gather.wood', label: '采集木材', source: 'event', eventType: 'gathering.completed', identityPayload: { itemId: 'resource.wood' } }
        ]
      }
    };
    const catalog = buildFactCatalog(extended);
    const refuel = catalog.find(fact => fact.id === 'story.s01.refuelCampfire');
    expect(refuel.label).toBe('添柴重燃');
    expect(refuel.paths.length).toBeGreaterThan(0); // 覆盖时未提供的字段保留
    const gather = catalog.find(fact => fact.id === 'gather.wood');
    expect(gather.source).toBe('event');
    expect(gather.eventType).toBe('gathering.completed');
  });
});

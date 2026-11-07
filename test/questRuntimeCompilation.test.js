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
import { loadProjectWithShards } from './support/projectFixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const project = await loadProjectWithShards();

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

  it('choice 步骤编译：分支选项目标并列解锁，任一分支链走到 complete 即任务完成', () => {
    const CHOICE_QUEST = {
      id: 'quest.test.verdict',
      title: '抉择',
      steps: [
        { id: 'prologue', type: 'dialogue', dialogueId: 'dlg.verdict', await: true },
        {
          id: 'makeVerdict',
          type: 'choice',
          dialogueId: 'dlg.verdict',
          title: '张角的抉择',
          options: [
            {
              choice: 'save',
              title: '救他',
              steps: [
                { type: 'action', action: 'scenario.command', params: { operation: 'army.rescue.begin' } },
                { id: 'carry', type: 'objective', objectiveType: 'interact.entity', target: 'S02-camp-rescue', title: '抬回营地' }
              ]
            },
            {
              choice: 'kill',
              title: '杀了',
              steps: [
                { type: 'action', action: 'ending.command', params: { endingId: 'ending.s02.heartless' } }
              ]
            }
          ]
        }
      ]
    };
    const { taskGraph, triggers } = compileQuest(CHOICE_QUEST, project);
    const byId = new Map(taskGraph.nodes.map(node => [node.id, node]));
    // 分支选项目标：start 并列解锁两个选项 objective
    expect(byId.get('start').next).toEqual(['makeVerdict.save', 'makeVerdict.kill']);
    expect(byId.get('makeVerdict.save').eventMatcher).toEqual({
      type: 'dialogueChoice', payload: { id: 'dlg.verdict', choiceId: 'save' }
    });
    expect(byId.get('makeVerdict.save').title).toBe('救他');
    expect(byId.get('makeVerdict.kill').eventMatcher).toEqual({
      type: 'dialogueChoice', payload: { id: 'dlg.verdict', choiceId: 'kill' }
    });
    // save 分支含子链 objective；kill 分支无子链直接到 complete
    expect(byId.get('makeVerdict.save').next).toEqual(['makeVerdict.save.carry']);
    expect(byId.get('makeVerdict.kill').next).toEqual(['complete']);
    expect(byId.get('makeVerdict.save.carry').eventMatcher).toEqual({
      type: 'interact', payload: { target: 'S02-camp-rescue' }
    });
    expect(byId.get('makeVerdict.save.carry').next).toEqual(['complete']);
    // intro 对话进开场触发器；选项段各自进 after 触发器（选项步骤选择后执行）
    const intro = triggers.find(trigger => trigger.id === 'trg_quest.test.verdict_intro');
    expect(intro.do.map(action => action.action)).toEqual(['dialogue.command']);
    const saveAfter = triggers.find(trigger => trigger.id === 'trg_quest.test.verdict_after_makeVerdict.save');
    expect(saveAfter.when).toEqual({ type: 'dialogueChoice', params: { id: 'dlg.verdict', choiceId: 'save' } });
    expect(saveAfter.do.map(action => action.action)).toEqual(['scenario.command']);
    const killAfter = triggers.find(trigger => trigger.id === 'trg_quest.test.verdict_after_makeVerdict.kill');
    expect(killAfter.do.map(action => action.action)).toEqual(['ending.command']);
  });

  it('commitFact：objective 声明事实提交时生成 commit 触发器（同事件 once 提交状态事务）', () => {
    const COMMIT_QUEST = {
      id: 'quest.test.commit',
      title: '事实提交',
      steps: [
        {
          id: 'arrive',
          type: 'objective',
          objectiveType: 'custom.event',
          eventMatcher: { type: 'enterRegion', payload: { regionId: 'S02-camp-rescue' } },
          commitFact: 'story.test.arrived',
          title: '抵达营地'
        }
      ]
    };
    const { triggers } = compileQuest(COMMIT_QUEST, project);
    const commit = triggers.find(trigger => trigger.id === 'trg_quest.test.commit_commit_arrive');
    expect(commit).toBeTruthy();
    expect(commit.when).toEqual({ type: 'enterRegion', params: { regionId: 'S02-camp-rescue' } });
    expect(commit.once).toBe(true);
    expect(commit.do).toEqual([{
      action: 'state.transaction',
      params: { definitionId: 'story.test.arrived' },
      stepId: 'commit.arrive'
    }]);
  });

  it('validateQuestDefinition：choice 缺 dialogueId/options/选项重名与 commitFact 空值报错', () => {
    const errors = validateQuestDefinition({
      id: 'quest.test.bad', title: '坏例子',
      steps: [
        { id: 'c1', type: 'choice', options: [{ choice: 'a' }] },
        { id: 'c2', type: 'choice', dialogueId: 'dlg.x', options: [] },
        { id: 'c3', type: 'choice', dialogueId: 'dlg.x', options: [{ choice: 'a' }, { choice: 'a' }] },
        { id: 'o1', type: 'objective', objectiveType: 'commit.fact', target: 'story.x', commitFact: '  ' }
      ]
    });
    expect(errors.some(error => error.includes('steps[0].dialogueId'))).toBe(true);
    expect(errors.some(error => error.includes('steps[1].options'))).toBe(true);
    expect(errors.some(error => error.includes('steps[2].options[1].choice 重复'))).toBe(true);
    expect(errors.some(error => error.includes('steps[3].commitFact'))).toBe(true);
  });

  it('event 编排步骤：编译为独立触发器（when 事件→动作链），不占任务目标节点', () => {
    const EVENT_QUEST = {
      id: 'quest.test.directed',
      title: '编排',
      steps: [
        {
          id: 'porridgeWaves',
          type: 'event',
          title: '施粥五批',
          eventMatcher: { type: 'dialogueEnd', params: { id: 'dialogue.s02.awakening' } },
          steps: [
            { id: 'lay', type: 'action', action: 'state.transaction', params: { definitionId: 'story.s02.porridge.laid' } },
            { id: 'spawn', type: 'action', action: 'spawnPlacements', params: { selector: { group: 'S02-porridge-batch-1' } } }
          ]
        },
        { id: 'goal', type: 'objective', objectiveType: 'commit.fact', target: 'story.s02.porridge.laid', title: '施粥赈济' }
      ]
    };
    const { taskGraph, triggers } = compileQuest(EVENT_QUEST, project);
    // event 步骤不产生节点：start → goal → complete
    expect(taskGraph.nodes.map(node => node.id)).toEqual(['start', 'goal', 'complete']);
    const eventTrigger = triggers.find(trigger => trigger.id === 'trg_quest.test.directed_event_porridgeWaves');
    expect(eventTrigger).toBeTruthy();
    expect(eventTrigger.once).toBe(true);
    expect(eventTrigger.when).toEqual({ type: 'dialogueEnd', params: { id: 'dialogue.s02.awakening' } });
    expect(eventTrigger.do.map(action => action.action)).toEqual(['state.transaction', 'spawnPlacements']);
  });

  it('gates 附属字段：objective 原样带入任务图节点供编辑器反向查询与定位', () => {
    const GATE_QUEST = {
      id: 'quest.test.gate',
      title: '门引用',
      steps: [
        {
          id: 'enter',
          type: 'objective',
          objectiveType: 'commit.fact',
          target: 'story.test.inside',
          title: '进庇护所',
          gates: [
            { sceneId: 'S01', placementId: 'S01-shelter-door', bindingId: 'S01-binding-shelter-enter' }
          ]
        }
      ]
    };
    const { taskGraph } = compileQuest(GATE_QUEST, project);
    const node = taskGraph.nodes.find(candidate => candidate.id === 'enter');
    expect(node.gates).toEqual([
      { sceneId: 'S01', placementId: 'S01-shelter-door', bindingId: 'S01-binding-shelter-enter' }
    ]);
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
    expect(intro.do[0].params).toEqual({ dialogueId: 'dlg_test_intro', operation: 'start', await: true });
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
    expect(validateQuestCompilation(compilation, project)).toEqual([]);
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
    // 新基线：S02-S14 主线全部任务化（S02 verdict/rescue/summons、S09 joinYellowTurban、
    // S03-S08/S10-S14 薄任务串接），共 16 条 quest 定义
    expect(compiled.taskGraphs.map(graph => graph.id)).toEqual([
      'task.s01.survival',
      'task.s02.verdict',
      'task.s02.rescue',
      'task.s02.summons',
      'task.s09.joinYellowTurban',
      'task.s03.yingchuanBattle',
      'task.s04.changsheDefense',
      'task.s05.wanchengOutskirts',
      'task.s06.wanchengSiege',
      'task.s07.xihuaDelay',
      'task.s08.xihuaRetreat',
      'task.s10.guangchengCamp',
      'task.s11.guangzongRescue',
      'task.s12.xiaquyangRescue',
      'task.s13.jingshanBattle',
      'task.s14.finalCommit'
    ]);
    // S01/S02 无 accept/rewards（接取由现有触发器承担）；S01 开场教程步骤（step.1.1 → s01.move）
    // S01 开场段：step.1.1 对话（await，用户勾选「等待对话完成后再继续」）→ step.1.2 教程（await）
    const s01Intro = compiled.triggers.find(trigger => trigger.id === 'trg_task.s01.survival_intro');
    expect(s01Intro).toBeTruthy();
    expect(s01Intro.when).toEqual({ type: 'task.started', params: { definitionId: 'task.s01.survival' } });
    expect(s01Intro.do.map(action => action.action)).toEqual(['dialogue.command', 'tutorial.command']);
    expect(s01Intro.do[0].params).toEqual({ dialogueId: 'dialogue.s01.wake', operation: 'start', await: true });
    expect(s01Intro.do[1].params).toEqual({ operation: 'show', tutorialId: 's01.move', await: true });
    // 方案 B 编排步骤化：S01 目标后段由步骤编译；编辑器重排后目标链为
    // lightCampfire → gatherBerries → eatBerry → findAxe → gatherWood…，
    // 编排段随步骤归属移动（after.eatBerry.2 现归属 findAxe 段）。
    // 新基线：全集 58 个（s01 编排 7 个 + s01 complete 1 个 + S02-S14 任务化 accept/complete 26 个
    // + s02 编排 5 个 + S03-S13/S09 开场段与目标后段 19 个 + verdict 抉择 3 个 + rescue 事件化增量 2 个），
    // s01 八个仍居首
    // 注意：verdict（accept/after save/after kill）在 s01 之后、rescue 之前——slice(0,7) 是 s01 编排段不受影响
    expect(compiled.triggers.slice(0, 7).map(trigger => trigger.id)).toEqual([
      'trg_task.s01.survival_intro',
      'trg_task.s01.survival_after_lightCampfire',
      'trg_task.s01.survival_after_gatherBerries',
      'trg_task.s01.survival_after_eatBerry',
      'trg_task.s01.survival_after_findAxe',
      'trg_task.s01.survival_after_spotWolf',
      'trg_task.s01.survival_after_skinWolf'
    ]);
    // 手写任务图通道已清零：taskGraphs[] 为空数组（保留数据通道，编辑入口收敛到任务编辑器）
    expect(project.taskGraphs).toEqual([]);
  });
});

describe('阶段③ S01 迁移契约：quest 编译产物与手写任务图逐节点等价', () => {
  const compiledGraph = compileQuestProject(project).taskGraphs.find(graph => graph.id === 'task.s01.survival');

  it('s02 迁移契约：施粥 → 接受召见 → 招募 → 扎营 → 击退围剿 线性链（state.transaction 事实驱动，M3.5 随军抗敌）', () => {
    const s02Graph = compileQuestProject(project).taskGraphs.find(graph => graph.id === 'task.s02.summons');
    expect(s02Graph.entryNodeId).toBe('start');
    expect(s02Graph.nodes.filter(node => node.type === 'objective').map(node => node.id)).toEqual(['porridge', 'acceptSummons', 'recruit', 'camp', 'repelRaid']);
    expect(s02Graph.nodes.find(node => node.id === 'porridge').eventMatcher).toEqual({
      type: 'state.transaction', payload: { definitionId: 'story.s02.porridge.laid' }
    });
    // 召见目标直连对话结束事件（dialogueEnd），事实由 commitFact 自动提交（accept_summons 手写触发器已删除）
    expect(s02Graph.nodes.find(node => node.id === 'acceptSummons').eventMatcher).toEqual({
      type: 'dialogueEnd', payload: { id: 'dialogue.s02.zhangjiaoSummons' }
    });
    expect(s02Graph.nodes.find(node => node.id === 'recruit').eventMatcher).toEqual({
      type: 'state.transaction', payload: { definitionId: 'story.s02.recruit.done' }
    });
    expect(s02Graph.nodes.find(node => node.id === 'camp').eventMatcher).toEqual({
      type: 'state.transaction', payload: { definitionId: 'story.s02.camp.laid' }
    });
    expect(s02Graph.nodes.find(node => node.id === 'repelRaid').eventMatcher).toEqual({
      type: 'state.transaction', payload: { definitionId: 'story.s02.raid.repeled' }
    });
  });

  it('s02 编排步骤化：rescue 教学开场/苏醒段 + summons 招募/扎营/退敌目标后段由步骤编译', () => {
    const triggers = compileQuestProject(project).triggers.filter(trigger => trigger.id.startsWith('trg_task.s02.'));
    const byId = new Map(triggers.map(trigger => [trigger.id, trigger]));
    // rescue 开场段：两条指挥教学（choice_save 触发器不再手写）
    const rescueIntro = byId.get('trg_task.s02.rescue_intro');
    expect(rescueIntro).toBeTruthy();
    expect(rescueIntro.when).toEqual({ type: 'task.started', params: { definitionId: 'task.s02.rescue' } });
    expect(rescueIntro.do.map(action => action.action)).toEqual(['tutorial.command', 'tutorial.command']);
    expect(rescueIntro.do[0].params).toEqual({ operation: 'show', tutorialId: 's02.command.move' });
    expect(rescueIntro.do[1].params).toEqual({ operation: 'show', tutorialId: 's02.command.carry' });
    // rescue 目标后段：教学收尾 → 苏醒对话（await）→ 信使提示 → 赠符水
    const rescueAfter = byId.get('trg_task.s02.rescue_after_carryToCamp');
    expect(rescueAfter).toBeTruthy();
    expect(rescueAfter.when).toEqual({ type: 'enterRegion', params: { regionId: 'S02-camp-rescue' } });
    expect(rescueAfter.once).toBe(true);
    expect(rescueAfter.do.map(action => action.action)).toEqual([
      'scenario.command', 'tutorial.command', 'tutorial.command', 'dialogue.command', 'showTip', 'state.transaction'
    ]);
    expect(rescueAfter.do[0].params).toEqual({ operation: 'army.rescue.awaken', scenarioId: 'scenario.command.army.rescue.awaken' });
    expect(rescueAfter.do[3].params).toEqual({ dialogueId: 'dialogue.s02.awakening', operation: 'start', await: true });
    expect(rescueAfter.do[5].params).toEqual({ definitionId: 'reward.s02.rescueGift' });
    // 缺口 C：carryToCamp 目标直连 enterRegion 事件并自动提交救援事实（camp_arrival 手写触发器已删除）
    const commitTrigger = triggers.find(trigger => trigger.id === 'trg_task.s02.rescue_commit_carryToCamp');
    expect(commitTrigger).toBeTruthy();
    expect(commitTrigger.when).toEqual({ type: 'enterRegion', params: { regionId: 'S02-camp-rescue' } });
    expect(commitTrigger.do[0].params).toEqual({ definitionId: 'story.s02.rescue.done' });
    // summons 目标后三段：招募（提示+对话）/ 扎营（提示+过夜对话+迎战教学）/ 退敌（胜利旁白+教学收尾）
    const summonsAfter = [
      'trg_task.s02.summons_after_recruit',
      'trg_task.s02.summons_after_camp',
      'trg_task.s02.summons_after_repelRaid'
    ].map(id => byId.get(id));
    for (const trigger of summonsAfter) {
      expect(trigger, `${trigger?.id} 存在`).toBeTruthy();
      expect(trigger.once).toBe(true);
    }
    expect(summonsAfter[0].when).toEqual({ type: 'state.transaction', params: { definitionId: 'story.s02.recruit.done' } });
    expect(summonsAfter[0].do.map(action => action.action)).toEqual(['showTip', 'dialogue.command']);
    expect(summonsAfter[1].do.map(action => action.action)).toEqual(['showTip', 'dialogue.command', 'tutorial.command']);
    expect(summonsAfter[1].do[1].params).toEqual({ dialogueId: 'dialogue.s02.overnight', operation: 'start', await: true });
    expect(summonsAfter[2].do.map(action => action.action)).toEqual(['dialogue.command', 'tutorial.command']);
    expect(summonsAfter[2].do[0].params).toEqual({ dialogueId: 'dialogue.s02.raidRepelled', operation: 'start', await: true });
    // 事件编排收编：施粥五批/波次/战败/军队入画/乞讨链由任务 event 步骤编译（手写编排触发器已删除）
    const porridge = triggers.find(trigger => trigger.id === 'trg_task.s02.rescue_event_porridgeWaves');
    expect(porridge).toBeTruthy();
    expect(porridge.when).toEqual({ type: 'dialogueEnd', params: { id: 'dialogue.s02.awakening' } });
    expect(porridge.do[0]).toMatchObject({ action: 'state.transaction', stepId: 'wound-severe-commit' });
    const raidWave2 = triggers.find(trigger => trigger.id === 'trg_task.s02.summons_event_raidWave2');
    expect(raidWave2.when).toEqual({ type: 'waveCleared', params: { group: 'S02-raid-vanguard' } });
    // 原样触发器动作对象（branch 分支容器）透传保留
    expect(Array.isArray(raidWave2.do[0]?.branch)).toBe(true);
    const armyArrival = triggers.find(trigger => trigger.id === 'trg_task.s02.verdict_event_armyArrival');
    expect(armyArrival.when).toEqual({ type: 'armyMarchArrived', params: { armyId: 'army.s02.column' } });
    expect(Array.isArray(armyArrival.do[1]?.branch)).toBe(true);
    const begEnter = triggers.find(trigger => trigger.id === 'trg_task.s02.verdict_event_begChildrenEnter');
    // 编排条件守卫（防重入 if）原样透传
    expect(begEnter.if).toBeTruthy();
    // accept_summons 改造：召见目标直连 dialogueEnd 事件 + commitFact 提交事实
    const summonsGraph = compileQuestProject(project).taskGraphs.find(graph => graph.id === 'task.s02.summons');
    const acceptNode = summonsGraph.nodes.find(node => node.id === 'acceptSummons');
    expect(acceptNode.eventMatcher).toEqual({ type: 'dialogueEnd', payload: { id: 'dialogue.s02.zhangjiaoSummons' } });
  });

  it('任务图结构：18 objective 线性链 + 裸 start/complete 节点（存档 nodeStates 寻址兼容）', () => {
    expect(compiledGraph, 'quests[] 迁移后应能编译出 task.s01.survival').toBeTruthy();
    expect(compiledGraph.entryNodeId).toBe('start');
    expect(compiledGraph.title).toBe('荒原求生');
    expect(compiledGraph.category).toBe('main');
    const objectives = compiledGraph.nodes.filter(node => node.type === 'objective');
    expect(objectives.map(node => node.id)).toEqual([
      'lightCampfire', 'gatherBerries', 'eatBerry', 'findAxe', 'gatherWood',
      'spotWolf', 'killWolf', 'findSkinningKnife', 'skinWolf', 'cookMeat', 'craftGear',
      'buildShelter', 'stayOvernight', 'leaveShelter', 'defeatWolfPack', 'defeatWolfKing',
      'crossRiver', 'reachCliff'
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
    expect(matcherOf('findAxe')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.axeFound' } });
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
    expect(matcherOf('findSkinningKnife')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.skinningKnifeFound' } });
    expect(matcherOf('cookMeat')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.cookMeat' } });
    expect(matcherOf('defeatWolfPack')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.wolfPackCleared' } });
    expect(matcherOf('defeatWolfKing')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.wolfKingDefeated' } });
    expect(matcherOf('reachCliff')).toEqual({ type: 'state.transaction', payload: { definitionId: 'story.s01.cliffReached' } });
    // 全部 objective requiredCount 语义等价（手写仅 gatherWood 显式 1，其余缺省按 1）
    for (const node of compiledGraph.nodes.filter(entry => entry.type === 'objective')) {
      expect(node.requiredCount).toBe(1);
    }
  });

  it('迁移后触发器零删除：trg_s01_start_survival_task 等仍由 triggers[] 手写承担', () => {
    const acceptTrigger = project.triggers.find(trigger => trigger.id === 'trg_s01_start_survival_task');
    expect(acceptTrigger).toBeTruthy();
    expect(acceptTrigger.do[0].params.definitionId).toBe('task.s01.survival');
    // 方案 B 编排步骤化：开场段 + 6 个目标后段由步骤编译（lightCampfire/gatherBerries/eatBerry/findAxe/spotWolf/skinWolf）；
    // 交互/机制类触发器（拾斧、添柴交互、sceneEnter 装配等）仍由 triggers[] 手写承担。
    // 新基线：S02-S14 任务化 accept 13 个 + complete 13 个（含 s02.rescue 无 accept、s01 complete 奖励），
    // 编译触发器全集 = 上一基线 76 + S02 summons 召见线全量收编 8（进场装配/召见对话/招募/扎营/
    //   围剿胜利/拾荒者遭遇×2/北上广宗出口，手写 trg_s02_* 七个已删除）= 84
    const triggers = compileQuestProject(project).triggers;
    expect(triggers.length).toBe(84);
    expect(triggers.slice(0, 7).map(trigger => trigger.id)).toEqual([
      'trg_task.s01.survival_intro',
      'trg_task.s01.survival_after_lightCampfire',
      'trg_task.s01.survival_after_gatherBerries',
      'trg_task.s01.survival_after_eatBerry',
      'trg_task.s01.survival_after_findAxe',
      'trg_task.s01.survival_after_spotWolf',
      'trg_task.s01.survival_after_skinWolf'
    ]);
    const acceptIds = triggers.filter(trigger => trigger.id.endsWith('_accept')).map(trigger => trigger.id);
    expect(acceptIds).toEqual([
      'trg_task.s02.verdict_accept',
      'trg_task.s02.rescue_accept',
      'trg_task.s02.summons_accept',
      'trg_task.s09.joinYellowTurban_accept',
      'trg_task.s03.yingchuanBattle_accept',
      'trg_task.s04.changsheDefense_accept',
      'trg_task.s05.wanchengOutskirts_accept',
      'trg_task.s06.wanchengSiege_accept',
      'trg_task.s07.xihuaDelay_accept',
      'trg_task.s08.xihuaRetreat_accept',
      'trg_task.s10.guangchengCamp_accept',
      'trg_task.s11.guangzongRescue_accept',
      'trg_task.s12.xiaquyangRescue_accept',
      'trg_task.s13.jingshanBattle_accept',
      'trg_task.s14.finalCommit_accept'
    ]);
    // S02 抉择链任务化：verdict 由「军队抵达」事实接取；rescue 由「选择救他」选项事件接取
    expect(triggers.find(trigger => trigger.id === 'trg_task.s02.verdict_accept').when)
      .toEqual({ type: 'state.transaction', params: { definitionId: 'story.s02.beg.armyArrived' } });
    expect(triggers.find(trigger => trigger.id === 'trg_task.s02.rescue_accept').when)
      .toEqual({ type: 'dialogueChoice', params: { id: 'dialogue.s02.prologue', choiceId: 'save' } });
    // verdict 分支选项目标 + 选项段（judgement/结局由任务步骤编译，choice_kill/save 手写触发器已删除）
    const saveAfter = triggers.find(trigger => trigger.id === 'trg_task.s02.verdict_after_makeVerdict.save');
    expect(saveAfter.when).toEqual({ type: 'dialogueChoice', params: { id: 'dialogue.s02.prologue', choiceId: 'save' } });
    expect(saveAfter.do.map(action => action.action)).toEqual(['state.transaction', 'scenario.command']);
    const killAfter = triggers.find(trigger => trigger.id === 'trg_task.s02.verdict_after_makeVerdict.kill');
    expect(killAfter.do.map(action => action.action)).toEqual(['state.transaction', 'ending.command']);
    expect(triggers.find(trigger => trigger.id === 'trg_task.s02.summons_accept').when)
      .toEqual({ type: 'task.completed', params: { definitionId: 'task.s02.rescue' } });
    expect(triggers.find(trigger => trigger.id === 'trg_task.s03.yingchuanBattle_accept').when)
      .toEqual({ type: 'sceneEnter', params: { sceneId: 'S03' } });
    // 目标后段语义抽查（编辑器重排后）：eatBerry 段 = 投斧 + 完成吃教程 + 拾取教程；
    // 砍柴教程步骤现归属 findAxe 段（先完成拾取教程）；spotWolf 段合并了首狼生成链
    const eatBerryAfter = triggers.find(trigger => trigger.id === 'trg_task.s01.survival_after_eatBerry');
    expect(eatBerryAfter.when).toEqual({ type: 'state.transaction', params: { definitionId: 'story.s01.berryEaten' } });
    expect(eatBerryAfter.do.map(action => action.action)).toEqual(['s01Survival', 'tutorial.command', 'tutorial.command']);
    expect(eatBerryAfter.do[0].params).toEqual({ operation: 'dropWornAxe' });
    const findAxeAfter = triggers.find(trigger => trigger.id === 'trg_task.s01.survival_after_findAxe');
    expect(findAxeAfter.do.map(action => action.action)).toEqual(['tutorial.command', 'tutorial.command']);
    expect(findAxeAfter.do[0].params).toEqual({ operation: 'complete', tutorialId: 's01.pickup' });
    expect(findAxeAfter.do[1].params).toEqual({ operation: 'show', tutorialId: 's01.chopWood', await: true });
    const spotWolfAfter = triggers.find(trigger => trigger.id === 'trg_task.s01.survival_after_spotWolf');
    expect(spotWolfAfter.do.map(action => action.params.operation)).toEqual(['commitStoryWhenReady', 'ensureFirstWolf', 'show']);
    // S02 summons 召见线全量收编：8 个手写 trg_s02_* → event 步骤编译产物（id 契约 + 关键语义抽查）
    const summonsEventIds = [
      'trg_task.s02.summons_event_spawnInitial',
      'trg_task.s02.summons_event_acceptSummonsInteract',
      'trg_task.s02.summons_event_recruitInteract',
      'trg_task.s02.summons_event_campComplete',
      'trg_task.s02.summons_event_raidVictory',
      'trg_task.s02.summons_event_scavengerEncounter',
      'trg_task.s02.summons_event_scavengerEncounterEnd',
      'trg_task.s02.summons_event_travelToS09'
    ];
    for (const id of summonsEventIds) {
      expect(triggers.find(trigger => trigger.id === id)).toBeTruthy();
    }
    // 手写触发器的防连点 cooldown / 条件守卫 / branch 结构随收编透传
    const recruitCompiled = triggers.find(trigger => trigger.id === 'trg_task.s02.summons_event_recruitInteract');
    expect(recruitCompiled.cooldown).toBe(0.5);
    expect(recruitCompiled.if).toEqual({ var: 'story.s02SummonsAccepted' });
    expect(recruitCompiled.once).toBe(false);
    expect(recruitCompiled.do).toHaveLength(3);
    expect(recruitCompiled.do.every(item => Array.isArray(item.branch))).toBe(true);
    expect(triggers.find(trigger => trigger.id === 'trg_task.s02.summons_event_acceptSummonsInteract').cooldown).toBe(1);
    expect(triggers.find(trigger => trigger.id === 'trg_task.s02.summons_event_spawnInitial').when)
      .toEqual({ type: 'sceneEnter', params: { sceneId: 'S02' } });
    // 手写 trg_s02_* 七个已删除（收编后零重复定义）
    for (const goneId of ['trg_s02_spawn_initial', 'trg_s02_recruit', 'trg_s02_camp_laid', 'trg_s02_raid_repeled', 'trg_s02_zhangjiao_summons', 'trg_s02_scavenger_chief_encounter', 'trg_s02_scavenger_chief_dialogue_end']) {
      expect(project.triggers.find(trigger => trigger.id === goneId)).toBeUndefined();
    }
  });

  it('编译产物通过唯一校验器', () => {
    expect(validateQuestCompilation(compileQuestProject(project), project)).toEqual([]);
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

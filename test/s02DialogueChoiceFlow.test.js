/************************************************************
 * S02 张角抉择选项链路集成诊断测试。
 *
 * 用真实工程数据（project/dialogues.json、project/triggers.json、
 * project/commands.json、project/quests.json）复盘
 * dialogue.s02.prologue judge 节点的两个选项：
 *   selectChoice → dialogueChoice fireAndWait → state.transaction /
 *   task.command / ending.command / scenario.command。
 * 任一动作失败都会让 TriggerSystem.fireAndWait 返回 ok:false，
 * DialogueSystem.selectChoice 静默不提交（症状=选项无反应）。
 ************************************************************/

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CanonicalSnapshot } from '../src/core/CanonicalSnapshot.js';
import { DefinitionRepository } from '../src/core/DefinitionRepository.js';
import { Blackboard } from '../src/core/Blackboard.js';
import { TriggerSystem } from '../src/systems/TriggerSystem.js';
import { CommandAdapter } from '../src/systems/CommandAdapter.js';
import { createStandardActionDescriptorRegistry } from '../src/systems/ActionDescriptorRegistry.js';
import { CanonicalStateTransactionService } from '../src/systems/CanonicalStateTransactionService.js';
import { QuestTransactionService } from '../src/systems/QuestTransactionService.js';
import { compileQuestProject } from '../src/systems/quest/QuestRuntime.js';
import { DialogueSystem } from '../src/systems/DialogueSystem.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_DIR = path.join(ROOT, 'example/sanguo_zhangjiao');

function readProjectJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, relativePath), 'utf8'));
}

function commandResult(operationId, overrides = {}) {
  return {
    ok: true, operationId, status: 'committed', committed: true, code: null,
    stateId: 'stub:state', stateRevision: 1, eventFrom: 1, eventTo: 1, value: null, error: null,
    ...overrides
  };
}

async function buildChoiceChain({ storyStateOverrides = {} } = {}) {
  const triggers = readProjectJson('project/triggers.json');
  const dialogues = readProjectJson('project/dialogues.json');
  const commands = readProjectJson('project/commands.json');
  const quests = readProjectJson('project/quests.json');

  const prologue = dialogues.find(dialogue => dialogue?.id === 'dialogue.s02.prologue');
  const choiceTriggers = triggers.filter(trigger => (
    ['trg_s02_choice_kill', 'trg_s02_choice_save'].includes(trigger?.id)
  ));
  const judgementCommands = commands.filter(command => (
    ['story.s02.judgement.kill', 'story.s02.judgement.save'].includes(command?.id)
  ));
  const rescueQuest = quests.find(quest => quest?.id === 'task.s02.rescue');

  expect(prologue, 'dialogue.s02.prologue 存在').toBeTruthy();
  expect(choiceTriggers, '两个 S02 选项触发器存在').toHaveLength(2);
  expect(judgementCommands, '两个裁决事务定义存在').toHaveLength(2);
  expect(rescueQuest, 'task.s02.rescue 定义存在').toBeTruthy();

  const project = {
    schemaVersion: 1,
    scenes: [{ id: 'S02' }],
    battles: [], rescues: [], tutorials: [], library: {},
    endings: [{ id: 'sanguo-zhangjiao-endings-v1', endings: [{ id: 'chaos-weed' }, { id: 'order-weed' }] }],
    dialogues: [prologue],
    triggers: choiceTriggers,
    commands: judgementCommands,
    quests: [rescueQuest],
    // 任务中心制：quests[] 编译出 taskGraph 定义，供 task.command 引用校验
    taskGraphs: compileQuestProject({ quests: [rescueQuest] }).taskGraphs || [],
    triggerCatalog: { actions: ['spawnPlacements'] },
    variables: {}
  };
  const snapshot = CanonicalSnapshot.fromProject(project, { revision: 'diag:s02-choice' });
  const repository = DefinitionRepository.fromSnapshot(snapshot);
  const descriptors = createStandardActionDescriptorRegistry();

  const blackboard = new Blackboard();
  blackboard.set('storyState', {
    currentSceneId: 'S02',
    s01Completed: true,
    ...storyStateOverrides
  });

  const intents = [];
  const canonicalTransactions = new CanonicalStateTransactionService({
    definitionRepository: repository,
    getBlackboard: () => blackboard,
    // checkpoint.request / travel 在无头环境以恒真桩代替
    executeScenarioCommand: async () => commandResult('stub-scenario'),
    stateId: () => 'diag:canonical'
  });

  const questInnerGateway = {
    async execute(intent) {
      intents.push({ ...intent, __route: 'quest-inner' });
      return commandResult(intent.operationId);
    }
  };
  // 注意：真实 TaskGraphSystem.prepareStart/prepareConsumeEvent 是同步方法（不返回 Promise），
  // QuestTransactionService._executeTaskGraph 直接取返回值判断 ok/changed，不做 await。
  const taskGraphSystem = {
    prepareStart(definitionId, options = {}) {
      return {
        ok: true,
        changed: true,
        instance: { definitionId, instanceId: options.instanceId || `${definitionId}.main` },
        commit: () => ({ ok: true }),
        rollback() {}
      };
    },
    prepareConsumeEvent() {
      return { ok: true, changed: true, completedInstances: [], commit: () => ({ ok: true }), rollback() {} };
    },
    canConsumeEvent: () => false
  };
  const questService = new QuestTransactionService({
    definitionRepository: repository,
    commandGateway: questInnerGateway,
    taskGraphSystem,
    getDefaultActorId: () => 'player-1'
  });

  let stateRevisionCursor = 1;
  const gateway = {
    async execute(intent, options = {}) {
      intents.push({ ...intent, __route: 'gateway' });
      // 忠实模拟真实 CommandGateway：校验 revision 并把 definitionRevision 注入命令
      if (options.definitionRevision !== undefined && options.definitionRevision !== repository.definitionRevision) {
        throw new Error('definitionRevisionConflict');
      }
      const command = {
        commandType: intent.intentType,
        operationId: intent.operationId,
        actorId: intent.actorRef,
        definitionRevision: repository.definitionRevision,
        payload: intent.payload
      };
      switch (command.commandType) {
        case 'state.transaction': {
          // 模拟 LocalAuthorityAdapter：预置状态修订并注入提交回调
          const prepared = { stateId: 'diag:canonical', stateRevision: stateRevisionCursor, next: stateRevisionCursor + 1 };
          const context = {
            preparedStateRevision: prepared,
            commitStateRevision: p => {
              stateRevisionCursor = p.next;
              return { ok: true, stateRevision: p.next };
            },
            rng: { chance: () => false },
            logicalNow: () => 1,
            clocks: {}
          };
          const outcome = await canonicalTransactions.execute(command, context);
          return outcome.result;
        }
        case 'quest.command': {
          // 模拟 LocalAuthorityAdapter：quest 服务同样需要预置修订上下文；
          // 真实适配器会 normalizeHandlerOutput 提取 .result（拒绝路径返回扁平结果）。
          const prepared = { stateId: 'quest:player-1', stateRevision: stateRevisionCursor, next: stateRevisionCursor + 1 };
          const context = {
            preparedStateRevision: prepared,
            commitStateRevision: p => {
              stateRevisionCursor = p.next;
              return { ok: true, stateRevision: p.next };
            },
            rng: { chance: () => false },
            logicalNow: () => 1,
            stateRevisions: {}
          };
          const outcome = await questService.execute(command, context);
          return outcome?.result || outcome;
        }
        case 'ending.command':
        case 'scenario.command':
          return commandResult(command.operationId);
        default:
          throw new Error(`未路由的命令类型: ${command.commandType}`);
      }
    }
  };

  const adapter = new CommandAdapter({ registry: descriptors, definitionRepository: repository, commandGateway: gateway });
  const triggerSystem = new TriggerSystem({
    actionDescriptorRegistry: descriptors,
    commandAdapter: adapter,
    definitionRevision: snapshot.definitionRevision
  });
  triggerSystem.init({ definitionRepository: repository, player: { id: 'player-1' } });
  triggerSystem.registerAll(choiceTriggers);
  // 对应真实运行时 SceneTriggerActionProvider 的场景动作注册：spawnPlacements 是
  // 场景注入的直接回调（不走命令网关），无头环境下以恒真桩代替。
  triggerSystem.registerAction?.('spawnPlacements', () => true);

  const dialogueSystem = new DialogueSystem();
  dialogueSystem.registerDialogue(prologue.id, prologue);
  dialogueSystem.setChoiceDispatcher(payload => triggerSystem.fireAndWait('dialogueChoice', payload));

  return { dialogueSystem, triggerSystem, intents, blackboard, repository };
}

async function startAtJudge(dialogueSystem) {
  // 关闭打字机：每个 continue 直接推进一个节点（start → collapse → report → judge）
  dialogueSystem.enableTypewriter = false;
  dialogueSystem.startDialogue('dialogue.s02.prologue');
  dialogueSystem.continue();
  dialogueSystem.continue();
  dialogueSystem.continue();
  return dialogueSystem.getCurrentNode();
}

describe('S02 张角抉择选项链路（真实工程数据）', () => {
  it('选择「救他」：dialogueChoice 编排成功并推进到 saveOrder', async () => {
    const { dialogueSystem, intents } = await buildChoiceChain();
    const nodeAtJudge = await startAtJudge(dialogueSystem);
    expect(nodeAtJudge?.id).toBe('judge');

    const result = await dialogueSystem.selectChoice(1);
    const nodeAfter = dialogueSystem.getCurrentNode();

    expect({ result, node: nodeAfter?.id, intents }, JSON.stringify({ node: nodeAfter?.id, intents })).toMatchObject({
      result: true,
      node: 'saveOrder'
    });
  });

  it('选择「杀了」：dialogueChoice 编排成功并推进到 killOrder', async () => {
    const { dialogueSystem, intents } = await buildChoiceChain();
    const nodeAtJudge = await startAtJudge(dialogueSystem);
    expect(nodeAtJudge?.id).toBe('judge');

    const result = await dialogueSystem.selectChoice(0);
    const nodeAfter = dialogueSystem.getCurrentNode();

    expect({ result, node: nodeAfter?.id, intents }, JSON.stringify({ node: nodeAfter?.id, intents })).toMatchObject({
      result: true,
      node: 'killOrder'
    });
  });

  it('裁决事务前置条件：storyState.currentSceneId 缺失时 state.transaction 拒绝（复现静默失败）', async () => {
    const { dialogueSystem } = await buildChoiceChain({
      storyStateOverrides: { currentSceneId: undefined }
    });
    // 覆盖为缺失场景 id 的黑板
    const nodeAtJudge = await startAtJudge(dialogueSystem);
    expect(nodeAtJudge?.id).toBe('judge');

    const result = await dialogueSystem.selectChoice(1);
    expect(result).toBe(false);
    expect(dialogueSystem.getCurrentNode()?.id).toBe('judge');
  });
});

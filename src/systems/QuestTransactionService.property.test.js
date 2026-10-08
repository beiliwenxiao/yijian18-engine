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
import { SeedGenerator } from '../../test/support/ModelTesting.js';
import { DefinitionRepository, DefinitionRepositoryValidationError } from '../core/DefinitionRepository.js';
import { AuthorityClocks } from '../core/command/AuthorityClocks.js';
import { CommandGateway } from '../core/command/CommandGateway.js';
import { LocalAuthorityAdapter } from '../core/command/LocalAuthorityAdapter.js';
import { QuestRuntimeState } from './QuestRuntimeState.js';
import { QuestTransactionService, QUEST_COMMANDS } from './QuestTransactionService.js';
import { QuestResolver } from './resolvers/QuestResolver.js';

const PROPERTY_SEEDS = Object.freeze([0x10a57e01, 0x10a57e02]);
const FAULT_PHASES = Object.freeze(['none', 'rewardPrepare', 'rewardCommit', 'checkpoint']);
const clone = value => value == null ? value : structuredClone(value);

function scenarioFor(seed, faultPhase) {
  const random = new SeedGenerator(seed).fork(`quest:${faultPhase}`);
  const questId = `quest-${random.string(7)}`;
  const objectiveId = `objective-${random.string(5)}`;
  return {
    seed,
    faultPhase,
    actorId: `actor-${random.string(6)}`,
    questId,
    objectiveId,
    targetId: `target-${random.string(5)}`,
    requiredCount: random.int(1, 4),
    duration: random.int(8, 16),
    maxCompletions: random.int(2, 3),
    reward: { experience: random.int(1, 40), gold: random.int(0, 20) }
  };
}

function definitionFor(scenario) {
  return {
    id: scenario.questId,
    type: 'side',
    text: { name: scenario.questId },
    objectives: [
      { id: scenario.objectiveId, type: 'collect', targetId: scenario.targetId, requiredCount: scenario.requiredCount },
      { id: `${scenario.objectiveId}-optional`, type: 'talk', targetId: 'optional', requiredCount: 1, optional: true }
    ],
    reward: clone(scenario.reward),
    time: { duration: scenario.duration },
    repeatPolicy: { cooldown: 1, maxCompletions: scenario.maxCompletions },
    triggerRefs: [],
    dialogueRefs: []
  };
}

function repositoryFor(definition) {
  return DefinitionRepository.fromSnapshot({
    definitionRevision: 1,
    project: {},
    definitions: { quests: [definition] }
  });
}

class RewardSettlementParticipant {
  constructor({ faultPhase, reward }) {
    this.faultPhase = faultPhase;
    this.reward = reward;
    this.prepareCount = 0;
    this.balance = 0;
  }

  prepareReward() {
    this.prepareCount++;
    if (this.faultPhase === 'rewardPrepare' && this.prepareCount === 2) {
      return { ok: false, code: 'injectedRewardPrepareFailure' };
    }
    let settled = false;
    return {
      commit: () => {
        if (this.faultPhase === 'rewardCommit' && this.prepareCount === 2) {
          return { ok: false, code: 'injectedRewardCommitFailure' };
        }
        this.balance += this.reward.experience;
        settled = true;
        return { ok: true };
      },
      rollback: () => {
        if (settled) this.balance -= this.reward.experience;
      }
    };
  }
}

function createFixture(scenario) {
  const definition = definitionFor(scenario);
  const repository = repositoryFor(definition);
  const clocks = new AuthorityClocks();
  const checkpoints = [];
  const rewards = new RewardSettlementParticipant({ faultPhase: scenario.faultPhase, reward: scenario.reward });
  const service = new QuestTransactionService({
    definitionRepository: repository,
    actorId: scenario.actorId,
    rewardParticipants: [rewards],
    scheduleCheckpoint: checkpoint => {
      checkpoints.push({
        kind: checkpoint.kind,
        operationId: checkpoint.operationId,
        questId: checkpoint.questId,
        commandType: checkpoint.command?.commandType ?? null,
        actorId: checkpoint.command?.actorId ?? null
      });
      return {
        ok: !(scenario.faultPhase === 'checkpoint' && checkpoint.operationId.endsWith('turnin-2')),
        code: 'injectedCheckpointFailure'
      };
    }
  });
  const authority = new LocalAuthorityAdapter({ authorityClocks: clocks });
  for (const commandType of Object.values(QUEST_COMMANDS)) authority.registerHandler(commandType, service);
  const gateway = new CommandGateway({ authorityPort: authority, definitionRepository: repository });
  const notifications = [];
  authority.notificationBus.subscribe(event => notifications.push(clone(event)));
  return { definition, repository, clocks, checkpoints, rewards, service, authority, gateway, notifications };
}

function questIntent(scenario, operation, suffix, payload = {}) {
  return {
    intentType: QUEST_COMMANDS.COMMAND,
    actorRef: scenario.actorId,
    operationId: `quest-operation-${scenario.seed}-${suffix}`,
    payload: { questId: scenario.questId, operation, ...payload }
  };
}

function modelResolve(definition, runtime, operation, payload, logicalTime, operationId, actorId) {
  if (operation === 'accept') {
    if (runtime && !QuestResolver.canRepeat(definition, runtime, logicalTime)) return { changed: false, runtime };
    return {
      changed: true,
      runtime: QuestResolver.initialRuntime(definition, {
        questRuntimeId: `${actorId}:${definition.id}`,
        logicalTime,
        repeat: runtime?.repeat
      })
    };
  }
  if (operation === 'advance') return QuestResolver.advance(definition, runtime, payload.signal, logicalTime);
  return QuestResolver.turnIn(runtime, operationId, logicalTime);
}

function runtimeFor(fixture, scenario) {
  return fixture.service.serialize().actors
    .find(actor => actor.actorId === scenario.actorId)?.runtimes
    .find(runtime => runtime.definitionId === scenario.questId) || null;
}

function normalizedNotifications(fixture) {
  return fixture.notifications.map(event => ({
    kind: event.kind,
    type: event.value.type,
    operationId: event.value.operationId,
    stateRevision: event.value.stateRevision,
    eventSequence: event.value.eventSequence
  }));
}

async function runModelledCommand({ fixture, scenario, model, intent }) {
  const operation = intent.payload.operation;
  const logicalTime = fixture.clocks.logical.now();
  const resolved = modelResolve(
    fixture.definition, model.runtime, operation, intent.payload, logicalTime, intent.operationId, scenario.actorId
  );
  const isFinalTurnIn = intent.operationId.endsWith('turnin-2');
  // 现行契约：scheduleCheckpoint 为提交后尽力调度，调度失败不回滚命令；仅 reward 阶段故障仍拒绝
  const rewardFault = scenario.faultPhase === 'rewardPrepare' || scenario.faultPhase === 'rewardCommit';
  const shouldCommit = resolved.changed && (!isFinalTurnIn || !rewardFault);
  const result = await fixture.gateway.execute(intent);

  expect(result.ok, `seed=${scenario.seed}, operation=${intent.operationId}, result=${JSON.stringify(result)}`).toBe(shouldCommit);
  expect(result.committed).toBe(shouldCommit);
  if (shouldCommit) {
    model.stateRevision++;
    model.runtime = resolved.runtime && { ...resolved.runtime, stateRevision: model.stateRevision };
    if (operation === 'turnIn') model.rewardBalance += scenario.reward.experience;
  }

  expect(runtimeFor(fixture, scenario)).toEqual(model.runtime);
  expect(fixture.authority.stateRevisions.current(`quest:${scenario.actorId}`)).toBe(model.stateRevision);
  expect(fixture.rewards.balance).toBe(model.rewardBalance);
  expect(fixture.authority.operationLedger.get(intent.operationId)?.status).toBe(shouldCommit ? 'committed' : 'failed');
  return { result, shouldCommit };
}

function duplicateSnapshot(definition) {
  return {
    definitionRevision: 1,
    project: {},
    definitions: { quests: [definition, { ...clone(definition) }] }
  };
}

// Property 10: Fix Checking — Sole QuestResolver and Atomic Reward Settlement.
// **Validates: Requirements 2.7, 2.10, 2.12, 3.4, 3.7, 3.10**
describe('Property 10: Sole QuestResolver and atomic reward settlement', () => {
  it('拒绝重复 QuestDefinition ID，且不把定义字段写入 QuestRuntimeState', () => {
    for (const seed of PROPERTY_SEEDS) {
      const scenario = scenarioFor(seed, 'none');
      const definition = definitionFor(scenario);
      expect(() => DefinitionRepository.fromSnapshot(duplicateSnapshot(definition))).toThrow(DefinitionRepositoryValidationError);
      const runtime = QuestResolver.initialRuntime(definition, {
        questRuntimeId: `${scenario.actorId}:${scenario.questId}`, logicalTime: 0
      });
      expect(QuestRuntimeState.validate(runtime).ok).toBe(true);
      expect(Object.keys(runtime)).not.toContain('objectives');
      expect(Object.keys(runtime)).not.toContain('reward');
    }
  });

  it('生成任务、信号、时间/重复/奖励、revision 与阶段故障时，真实事务链与纯 Resolver 模型一致', async () => {
    for (const seed of PROPERTY_SEEDS) {
      for (const faultPhase of FAULT_PHASES) {
        const scenario = scenarioFor(seed, faultPhase);
        const fixture = createFixture(scenario);
        const model = { runtime: null, stateRevision: 0, rewardBalance: 0 };
        const signal = { type: 'collect', targetId: scenario.targetId, amount: scenario.requiredCount };
        const commands = [
          questIntent(scenario, 'accept', 'accept-1'),
          questIntent(scenario, 'advance', 'advance-1', { signal }),
          questIntent(scenario, 'turnIn', 'turnin-1')
        ];

        for (const intent of commands) {
          await runModelledCommand({ fixture, scenario, model, intent });
          fixture.clocks.logical.tick();
        }
        expect(model.runtime.repeat.count).toBe(1);
        expect(model.runtime.rewardSettlementLedger).toEqual([commands[2].operationId]);

        const secondCycle = [
          questIntent(scenario, 'accept', 'accept-2'),
          questIntent(scenario, 'advance', 'advance-2', { signal }),
          questIntent(scenario, 'turnIn', 'turnin-2')
        ];
        for (const intent of secondCycle) {
          await runModelledCommand({ fixture, scenario, model, intent });
          fixture.clocks.logical.tick();
        }

        // 现行契约：仅 reward 阶段故障拒绝 turnin-2；checkpoint 调度失败不影响提交
        const rewardFault = faultPhase === 'rewardPrepare' || faultPhase === 'rewardCommit';
        const successfulOperations = rewardFault ? secondCycle.slice(0, 2) : secondCycle;
        const committed = normalizedNotifications(fixture).filter(event => event.kind === 'CommittedEvent');
        expect(committed.map(event => event.operationId)).toEqual([...commands, ...successfulOperations].map(intent => intent.operationId));
        expect(committed.every(event => event.stateRevision > 0)).toBe(true);
        expect(normalizedNotifications(fixture).some(event => event.operationId === secondCycle[2].operationId))
          .toBe(faultPhase === 'none' || faultPhase === 'checkpoint');
        expect(fixture.checkpoints.map(checkpoint => checkpoint.operationId)).toEqual(
          faultPhase === 'rewardPrepare' || faultPhase === 'rewardCommit'
            ? [...commands, ...secondCycle.slice(0, 2)].map(intent => intent.operationId)
            : [...commands, ...secondCycle].map(intent => intent.operationId)
        );
        expect(model.runtime.remaining).toBeLessThanOrEqual(scenario.duration);
      }
    }
  });
});

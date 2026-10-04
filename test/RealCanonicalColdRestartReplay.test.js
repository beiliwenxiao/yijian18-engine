import { describe, expect, it } from 'vitest';
import { CommandContractKind } from '../src/core/command/CommandContracts.js';
import { createColdRestartReplayHarness } from './support/ColdRestartReplayHarness.js';
import { createFakeClocks, InMemoryCacheAdapter } from './support/ModelTesting.js';
import {
  createDemoCanonicalDisk, createEndingInput, createRealCanonicalRuntime, destroyRealCanonicalRuntime,
  executeRealCanonicalCommand, inspectRealCanonicalState, inspectRealCanonicalStableIds,
  inspectRealCanonicalEvents, inspectRealCanonicalEnding
} from './support/RealCanonicalRuntimeFactory.js';

const command = (intentType, operationId, payload) => ({
  intent: { intentType, actorRef: 'player', operationId, payload }
});

function createHarness() {
  const disk = createDemoCanonicalDisk();
  const instances = new Set();
  return {
    disk,
    harness: createColdRestartReplayHarness({
      disk, cache: new InMemoryCacheAdapter({ staleCanonical: { id: 'S00' } }),
      createRuntime: async options => {
        const runtime = await createRealCanonicalRuntime(options);
        instances.add(runtime);
        return runtime;
      },
      destroyRuntime: async runtime => { await destroyRealCanonicalRuntime(runtime); instances.delete(runtime); },
      clearMemory: () => instances.clear(), execute: executeRealCanonicalCommand,
      inspectServiceState: inspectRealCanonicalState,
      inspectStableIds: inspectRealCanonicalStableIds,
      inspectDefinitionRevision: runtime => runtime.repository.definitionRevision,
      inspectCommittedEvents: runtime => inspectRealCanonicalEvents(runtime, CommandContractKind.COMMITTED_EVENT),
      inspectApplicationEvents: runtime => inspectRealCanonicalEvents(runtime, CommandContractKind.APPLICATION_EVENT),
      inspectEndingResult: inspectRealCanonicalEnding
    })
  };
}

const s01Snapshot = () => ({
  completedTutorials: ['s01.move', 's01.attack', 's01.pickup', 's01.jump', 's01.gather'],
  runtimeState: {
    blackboard: { storyState: { currentSceneId: 'S01', unlockedScenes: ['S01'], s02SummonsAccepted: false, s01Survival: { cliffReached: true } }, cityStates: [] },
    inventory: []
  }
});

// 难民冲突剧情已随 S02 难民迁移章节从 S09 迁至 S02 场景触发
//（story.s09.refugee.* 的 when 要求 currentSceneId === 'S02'，城市仍为光宗营），
// 快照场景 ID 跟随内容迁移，函数名保留历史语义。
const s09Snapshot = ({ axe = false } = {}) => ({
  runtimeState: {
    blackboard: {
      storyState: { currentSceneId: 'S02', currentDay: 1, storyTags: [], delayedConsequences: [] },
      cityStates: [{ id: 'city.s09_guangzong_camp', morale: 40, damageRatio: 0.5, buildingDamage: { granary: { s09: 1 } }, resources: { food: 60 } }]
    },
    inventory: [
      { definitionId: 'resource.food', quantity: 20 },
      ...(axe ? [{ definitionId: 'tool.worn_axe', instanceId: 'axe-s09', mutable: { durability: 8 } }] : [])
    ]
  }
});

const donateFlow = prefix => [
  command('state.transaction', `${prefix}:prepare`, { definitionId: 'story.s09.refugee.prepare' }),
  command('state.transaction', `${prefix}:start`, { definitionId: 'story.s09.refugee.start' }),
  command('state.transaction', `${prefix}:donate`, { definitionId: 'story.s09.refugee.branch', event: { choiceId: 'donate_food' }, operationId: `${prefix}:donate` })
];

describe('P1–P5 canonical disk cold restart replay', () => {
  it('P1.1/P1.3 从磁盘定义经 Gateway/Authority 完成 S01→S02，并在召见 checkpoint 后保持 travel 失败前的提交事实', async () => {
    const { harness } = createHarness();
    const replay = await harness.replay({
      seed: 913, clocks: createFakeClocks({ logical: 10, monotonic: 100 }), snapshot: s01Snapshot(),
      commands: [
        command('state.transaction', 's01:complete', { definitionId: 'story.s01.complete' }),
        command('state.transaction', 's02:summons', { definitionId: 'story.s02.summons.accept' })
      ]
    });
    expect(replay.equal).toBe(true);
    expect(replay.first.serviceState.blackboard.storyState).toMatchObject({ currentSceneId: 'S02', s01Completed: true, s02SummonsAccepted: true });
    // 现行契约：story.s01.complete 不再发放物资，事务后背包保持为空
    expect(replay.first.serviceState.inventory).toEqual([]);
    expect(replay.first.committedEvents.map(event => event.type)).toEqual(['state.transaction.committed', 'state.transaction.committed']);
    expect(replay.first.applicationEvents.map(event => event.type)).toEqual(['state.transaction', 'state.transaction']);

    const failureRuntime = await createRealCanonicalRuntime({ disk: createDemoCanonicalDisk(), seed: 913, clocks: createFakeClocks(), snapshot: { ...s01Snapshot(), travelFailure: true } });
    try {
      // 现行原子契约：travel 失败必须整体拒绝并回滚，不得保留部分提交事实
      const complete = await executeRealCanonicalCommand(failureRuntime, command('state.transaction', 'failure:s01', { definitionId: 'story.s01.complete' }));
      expect(complete).toMatchObject({ ok: false, committed: false, code: 'targetUnavailable' });
      expect(failureRuntime.travelAttempts).toHaveLength(1);
      const storyState = failureRuntime.blackboard.get('storyState');
      expect(storyState).toMatchObject({ currentSceneId: 'S01', s02SummonsAccepted: false });
      expect(Object.hasOwn(storyState, 's01Completed')).toBe(false);
      const summons = await executeRealCanonicalCommand(failureRuntime, command('state.transaction', 'failure:s02', { definitionId: 'story.s02.summons.accept' }));
      expect(summons).toMatchObject({ ok: false, committed: false, code: 'preconditionFailed' });
    } finally { await destroyRealCanonicalRuntime(failureRuntime); }
  });

  it('P2.2 使用真实 state.transaction 定义重放 donation、hardline 稳定 RNG/延迟结果、无斧 appease 斥候反馈与 silence 延迟结果', async () => {
    const cases = [
      {
        name: 'hardline', snapshot: s09Snapshot(),
        commands: [...donateFlow('hardline'), command('state.transaction', 'hardline:choice', { definitionId: 'story.s09.refugee.branch', event: { choiceId: 'hardline' } }), command('state.transaction', 'hardline:day', { definitionId: 'story.s09.day.advance', day: 2 }), command('state.transaction', 'hardline:delayed', { definitionId: 'story.s09.delayed.resolve' })],
        assert: state => expect(state.blackboard.storyState.s09RefugeeConflict).toMatchObject({ branch: 'hardline', hardlineEscapeOccurred: expect.any(Boolean) })
      },
      {
        name: 'appease-without-axe', snapshot: s09Snapshot(),
        commands: [...donateFlow('appease'), command('state.transaction', 'appease:choice', { definitionId: 'story.s09.refugee.branch', event: { choiceId: 'appease' } })],
        assert: state => expect(state.blackboard.storyState.s09RefugeeConflict).toMatchObject({ branch: 'appease', result: 'scoutTriggered', scoutTriggered: true })
      },
      {
        name: 'silence', snapshot: s09Snapshot({ axe: true }),
        commands: [...donateFlow('silence'), command('state.transaction', 'silence:choice', { definitionId: 'story.s09.refugee.branch', event: { choiceId: 'silence' } }), command('state.transaction', 'silence:day', { definitionId: 'story.s09.day.advance', day: 2 }), command('state.transaction', 'silence:delayed', { definitionId: 'story.s09.delayed.resolve' })],
        assert: state => {
          expect(state.blackboard.storyState.s09RefugeeConflict).toMatchObject({ branch: 'silence', result: 'delayedFoodCollapse' });
          expect(state.blackboard.cityStates[0].resources.food).toBe(0);
        }
      }
    ];
    for (const scenario of cases) {
      const { harness } = createHarness();
      const replay = await harness.replay({ seed: 0x5eed, clocks: createFakeClocks({ logical: 20, monotonic: 100 }), snapshot: scenario.snapshot, commands: scenario.commands });
      expect(replay.equal, scenario.name).toBe(true);
      scenario.assert(replay.first.serviceState);
      expect(replay.first.committedEvents.length).toBe(scenario.commands.length);
      expect(replay.first.applicationEvents.length).toBe(scenario.commands.length);
    }
  });

  it('P4.3/P4.5 通过真实 rescue 与 cargo/catapult 服务，并在冷重启后保持 state、stable IDs 和事件顺序', async () => {
    const { harness } = createHarness();
    const snapshot = {
      battleId: 'battle.s11.guangzong',
      runtimeState: {
        blackboard: { storyState: { currentSceneId: 'S11', storyTags: [], rescueResults: {} }, cityStates: [] },
        inventory: [
          { definitionId: 'resource.food', quantity: 30 }, { definitionId: 'resource.wood', quantity: 40 }
        ]
      }
    };
    const replay = await harness.replay({
      seed: 44, clocks: createFakeClocks({ logical: 30, monotonic: 100 }), snapshot,
      commands: [
        command('rescue.command', 's11:start', { rescueId: 'rescue.s11.zhangLiang', operation: 'start', mode: 'intervene', startedAt: 100 }),
        command('rescue.command', 's11:beacon', { rescueId: 'rescue.s11.zhangLiang', operation: 'completeStage', stageId: 'light-beacon', completedAt: 101 }),
        command('rescue.command', 's11:rally', { rescueId: 'rescue.s11.zhangLiang', operation: 'completeStage', stageId: 'rally-guards', guardCount: 6, completedAt: 102 }),
        command('rescue.command', 's11:wave1', { rescueId: 'rescue.s11.zhangLiang', operation: 'recordWave', waveNumber: 1, completedAt: 103 }),
        command('rescue.command', 's11:wave2', { rescueId: 'rescue.s11.zhangLiang', operation: 'recordWave', waveNumber: 2, completedAt: 104 }),
        command('rescue.command', 's11:wave3', { rescueId: 'rescue.s11.zhangLiang', operation: 'recordWave', waveNumber: 3, completedAt: 105 }),
        command('rescue.command', 's11:exit', { rescueId: 'rescue.s11.zhangLiang', operation: 'completeStage', stageId: 'breakout-west-gate', completedAt: 106 }),
        command('vehicle.command', 's14:cargo', { vehicleId: 'vehicle.s14.lastCart', operation: 'cargo.transfer', itemId: 'resource.food', quantity: 20 }),
        command('vehicle.command', 's14:catapult', { vehicleId: 'vehicle.s14.catapult', operation: 'catapult.assemble' })
      ]
    });
    expect(replay.equal).toBe(true);
    expect(replay.first.serviceState.rescue.result).toMatchObject({ rescueId: 'rescue.s11.zhangLiang', status: 'succeeded', survived: true });
    expect(replay.first.serviceState.vehicles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'vehicle.s14.lastCart', cargo: expect.objectContaining({ items: [expect.objectContaining({ definitionId: 'resource.food', quantity: 20 })] }) }),
      expect.objectContaining({ id: 'vehicle.s14.catapult', vehicle: expect.objectContaining({ logistics: expect.objectContaining({ catapultAssembled: true }) }) })
    ]));
    expect(replay.first.stableIds.definition.rescues).toEqual(expect.arrayContaining(['rescue.s11.zhangLiang', 'rescue.s12.zhangBao']));
    expect(replay.first.stableIds.definition.vehicles).toEqual(expect.arrayContaining(['vehicle.s14.lastCart', 'vehicle.s14.catapult']));
    expect(replay.first.committedEvents.every((event, index) => event.eventSequence === index * 2 + 1)).toBe(true);
    expect(replay.first.applicationEvents.every((event, index) => event.eventSequence === index * 2 + 2)).toBe(true);
  });

  it('P5.2 从磁盘 ending definitions 通过真实 EndingSystem 覆盖六结局固定优先级，并冷重启严格等价', async () => {
    const expected = ['scorched-earth', 'observer', 'spark', 'ember', 'meteor', 'dust'];
    for (const endingId of expected) {
      const { harness } = createHarness();
      const replay = await harness.replay({
        seed: 17, clocks: createFakeClocks({ logical: 50, monotonic: 100 }),
        snapshot: { endingInput: createEndingInput(endingId), runtimeState: { blackboard: { storyState: {}, cityStates: [] }, inventory: [] } },
        commands: [command('ending.command', `ending:${endingId}`, { endingId, checkpointId: `checkpoint.${endingId}` })]
      });
      // Ending input is supplied as a real injected state projection, not a notification or UI projection.
      expect(replay.equal).toBe(true);
      expect(replay.first.endingResult.endingId).toBe(endingId);
      expect(replay.first.committedEvents).toHaveLength(1);
      expect(replay.first.applicationEvents).toHaveLength(1);
    }
  });

  it('P2.2 checkpoint 失败时真实事务原子回滚 inventory、Story、City 和 operation 结果', async () => {
    const runtime = await createRealCanonicalRuntime({
      disk: createDemoCanonicalDisk(), seed: 91, clocks: createFakeClocks(),
      snapshot: { ...s09Snapshot(), checkpointFailure: true }
    });
    try {
      await executeRealCanonicalCommand(runtime, command('state.transaction', 'rollback:prepare', { definitionId: 'story.s09.refugee.prepare' }));
      await executeRealCanonicalCommand(runtime, command('state.transaction', 'rollback:start', { definitionId: 'story.s09.refugee.start' }));
      const result = await executeRealCanonicalCommand(runtime, command('state.transaction', 'rollback:donate', { definitionId: 'story.s09.refugee.branch', event: { choiceId: 'donate_food' } }));
      expect(result).toMatchObject({ ok: false, committed: false, code: 'injectedCheckpointFailure' });
      expect(runtime.inventory.getItemCount('resource.food')).toBe(20);
      const city = runtime.blackboard.get('cityStates')[0];
      expect(city.morale).toBe(40);
      expect(Object.hasOwn(city, 'damagePausedUntilDay')).toBe(false);
      expect(runtime.blackboard.get('storyState').s09RefugeeConflict).toMatchObject({ status: 'started', donationCommitted: false });
    } finally { await destroyRealCanonicalRuntime(runtime); }
  });
});

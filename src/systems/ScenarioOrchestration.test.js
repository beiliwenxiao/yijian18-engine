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

import { describe, expect, it, vi } from 'vitest';
import { CanonicalSnapshot } from '../core/CanonicalSnapshot.js';
import { DefinitionRepository } from '../core/DefinitionRepository.js';
import { CommandGateway } from '../core/command/CommandGateway.js';
import { ScenarioDefinitionIndex } from '../core/scenario/ScenarioDefinitionIndex.js';
import { TriggerGraph } from '../core/scenario/TriggerGraph.js';
import { createSpatialTriggerBinding } from '../core/scene/SpatialTriggerBinding.js';
import {
  ActionDescriptorRegistry,
  STANDARD_ACTION_DESCRIPTORS,
  createStandardActionDescriptorRegistry
} from './ActionDescriptorRegistry.js';
import { CommandAdapter, CommandAdapterError } from './CommandAdapter.js';
import { TriggerSystem } from './TriggerSystem.js';

function project() {
  return {
    schemaVersion: 1,
    scenes: [{ id: 'S01' }],
    battles: [{ id: 'battle.one' }],
    rescues: [], dialogues: [], quests: [], tutorials: [],
    triggers: [
      { id: 'trigger.entry', when: { type: 'signal' }, triggerRefs: ['trigger.exit'], do: [] },
      { id: 'trigger.exit', when: { type: 'signal' }, triggerRefs: ['trigger.entry'], do: [] }
    ],
    scenarios: [
      {
        id: 'scenario.child', scope: { sceneId: 'S01' }, triggerRefs: ['trigger.exit'],
        sceneRefs: ['S01'], questRefs: [], dialogueRefs: [], commandRefs: []
      },
      {
        id: 'scenario.root', scope: { sceneId: 'S01' }, scenarioRefs: ['scenario.child'],
        triggerRefs: ['trigger.entry', 'trigger.exit'], entryTriggerRefs: ['trigger.entry'],
        exitTriggerRefs: ['trigger.exit'], sceneRefs: ['S01'], questRefs: [], dialogueRefs: [], commandRefs: []
      }
    ],
    library: { vehicles: [] }
  };
}

function commandResult(operationId, overrides = {}) {
  return {
    ok: true, operationId, status: 'committed', committed: true, code: null,
    stateId: 'battle:battle.one', stateRevision: 1, eventFrom: 1, eventTo: 1,
    value: { accepted: true }, error: null, ...overrides
  };
}
describe('Canonical ScenarioDefinitionIndex and TriggerGraph', () => {
  it('从同一快照派生 deep-frozen 引用闭包、scope、entry/exit、可达性、循环和编辑视图', () => {
    const snapshot = CanonicalSnapshot.fromProject(project(), { revision: 8 });
    const graph = TriggerGraph.fromSnapshot(snapshot);
    const index = ScenarioDefinitionIndex.fromSnapshot(snapshot, { triggerGraph: graph });

    expect(index.definitionRevision).toBe(8);
    expect(index.getReferenceClosure('scenario.root')).toEqual({
      scenarios: ['scenario.root', 'scenario.child'],
      triggers: ['trigger.entry', 'trigger.exit'], quests: [], dialogues: [],
      scenes: ['S01'], commands: []
    });
    expect(index.getEntry('scenario.root')).toEqual(['trigger.entry']);
    expect(index.getExit('scenario.root')).toEqual(['trigger.exit']);
    expect(index.getReachable('scenario.root')).toEqual(['trigger.entry', 'trigger.exit']);
    expect(index.getCycles('scenario.root')).toEqual([['trigger.entry', 'trigger.exit', 'trigger.entry']]);
    expect(Object.isFrozen(index.get('scenario.root'))).toBe(true);
    expect(Object.isFrozen(index.toEditorView('scenario.root'))).toBe(true);
    expect(index.execute).toBeUndefined();
    expect(index.serialize).toBeUndefined();
    expect(index.patch).toBeUndefined();
  });

  it('TutorialDefinition 不进入普通 TriggerGraph', () => {
    const value = project();
    value.tutorials = [{
      id: 'tutorial.only', title: '教学', category: 'scene', order: 0,
      steps: [{ text: '提示' }], completionPolicy: 'manual'
    }];
    const graph = TriggerGraph.fromSnapshot(CanonicalSnapshot.fromProject(value));
    expect(graph.has('tutorial.only')).toBe(false);
    expect(graph.ids()).toEqual(['trigger.entry', 'trigger.exit']);
  });
});

describe('ActionDescriptorRegistry and CommandAdapter', () => {
  it('登记十类通用 command contract 并拒绝任何可执行内容', () => {
    const registry = createStandardActionDescriptorRegistry();
    expect(registry.ids()).toEqual(expect.arrayContaining([
      'rescue.command', 'battle.command', 'construction.command', 'vehicle.command',
      'quest.command', 'world.teleport', 'checkpoint.request', 'ending.command',
      'dialogue.command', 'tutorial.command'
    ]));
    for (const descriptor of registry.all()) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(descriptor).toEqual(expect.objectContaining({
        paramsSchema: expect.any(Object), resultSchema: expect.any(Object),
        sideEffect: expect.any(String), requiresOperationId: expect.any(Boolean),
        checkpointPolicy: expect.any(String), allowedReentryPolicies: expect.any(Array),
        adapterId: 'command'
      }));
    }
    expect(() => new ActionDescriptorRegistry([{
      ...STANDARD_ACTION_DESCRIPTORS[0], id: 'invalid.action', handler: () => true
    }])).toThrow(/executable content/);
  });

  it('只解析 schema/稳定引用、构造 ClientIntent 并经 CommandGateway 归一化结果', async () => {
    const snapshot = CanonicalSnapshot.fromProject(project(), { revision: 4 });
    const repository = DefinitionRepository.fromSnapshot(snapshot);
    const authority = { execute: vi.fn(command => commandResult(command.operationId)) };
    const gateway = new CommandGateway({ authorityPort: authority, definitionRepository: repository });
    const adapter = new CommandAdapter({
      registry: createStandardActionDescriptorRegistry(), commandGateway: gateway,
      definitionRepository: repository
    });

    const result = await adapter.execute({
      action: 'battle.command',
      params: { battleId: 'battle.one', operation: 'start' }
    }, { actorRef: 'player-1', operationId: 'trigger-op-1' });

    expect(result).toEqual(commandResult('trigger-op-1'));
    expect(Object.isFrozen(result)).toBe(true);
    expect(authority.execute).toHaveBeenCalledWith(expect.objectContaining({
      commandType: 'battle.command', actorId: 'player-1', operationId: 'trigger-op-1',
      definitionRevision: 4,
      payload: {
        battleId: 'battle.one', operation: 'start',
        definitionRefs: [{ kind: 'battles', id: 'battle.one' }]
      }
    }));
  });
  it('schema、引用或 operationId 无效时不调用 CommandGateway', async () => {
    const repository = DefinitionRepository.fromSnapshot(CanonicalSnapshot.fromProject(project()));
    const gateway = { execute: vi.fn() };
    const adapter = new CommandAdapter({
      registry: createStandardActionDescriptorRegistry(), commandGateway: gateway,
      definitionRepository: repository
    });

    await expect(adapter.execute({
      action: 'battle.command', params: { battleId: 'missing' }
    }, { actorRef: 'player-1', operationId: 'op' })).rejects.toBeInstanceOf(CommandAdapterError);
    await expect(adapter.execute({
      action: 'battle.command', params: { battleId: 'battle.one' }
    }, { actorRef: 'player-1' })).rejects.toMatchObject({ code: 'operationIdRequired' });
    expect(gateway.execute).not.toHaveBeenCalled();
  });

  it('TriggerSystem 对 descriptor action 只委托 CommandAdapter', async () => {
    const commandAdapter = { execute: vi.fn(() => Promise.resolve(commandResult('op-trigger'))) };
    const trigger = new TriggerSystem({
      actionDescriptorRegistry: createStandardActionDescriptorRegistry(), commandAdapter
    });
    trigger.init({ player: { id: 'player-1' }, definitionRepository: {}, runtimeConfig: { definitionRevision: 2 } });
    trigger.register({
      id: 'generic-battle', when: { type: 'signal' },
      do: [{ action: 'battle.command', params: { battleId: 'battle.one', operation: 'start' } }]
    });

    expect(trigger.fire('signal', { operationId: 'op-trigger', actorRef: 'player-1' })).toBe(1);
    await vi.waitFor(() => expect(commandAdapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'battle.command' }),
      // operationId 身份契约：顶层为引擎派生 ID，调用方传入值保留在 eventParams
      expect.objectContaining({
        actorRef: 'player-1',
        operationId: 'event:trigger:2:0:1',
        eventParams: expect.objectContaining({ operationId: 'op-trigger', actorRef: 'player-1' })
      })
    ));
  });
});

describe('spatial trigger binding', () => {
  it('只保留位置、范围、提示、triggerId 和 selector，不复制行为、目标对象或运行态', () => {
    const binding = createSpatialTriggerBinding({
      id: 'binding-1', type: 'trigger', triggerId: 'trigger.entry', sceneId: 'S01',
      x: 10, y: 20, width: 30, height: 40, radius: 50, prompt: '{interact}触发',
      targetMode: 'id', target: 'npc-1',
      when: { type: 'interact' }, do: [{ action: 'bad' }], once: true,
      firedOnce: true, targetObject: { id: 'npc-1' }
    });

    expect(binding).toEqual({
      id: 'binding-1', type: 'trigger', triggerId: 'trigger.entry', sceneId: 'S01',
      selector: { mode: 'id', value: 'npc-1', sceneId: 'S01' },
      x: 10, y: 20, width: 30, height: 40, radius: 50, prompt: '{interact}触发',
      flowGroupId: '', sceneEventId: ''
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(binding).not.toHaveProperty('target');
    expect(binding).not.toHaveProperty('targetObject');
    expect(binding).not.toHaveProperty('when');
    expect(binding).not.toHaveProperty('do');
    expect(binding).not.toHaveProperty('firedOnce');
  });
});
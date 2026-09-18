/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, expect, it, vi } from 'vitest';
import { ScenarioCommandService, SCENARIO_COMMANDS } from './ScenarioCommandService.js';

function command(commandType, payload, operationId = 'scenario-op-1') {
  return { commandType, payload, operationId };
}

function context(stateId) {
  return {
    preparedStateRevision: { ok: true, stateId, next: 1 },
    commitStateRevision: vi.fn(() => ({ ok: true, stateRevision: 1 }))
  };
}

describe('ScenarioCommandService ownership boundaries', () => {
  it('world.teleport 同 Region 只委托 ChunkNavigator，跨 Region 只委托 RegionCoordinator', async () => {
    const teleport = vi.fn(async request => ({ ok: true, sceneId: request.sceneId }));
    const switchTo = vi.fn(async request => ({ ok: true, request }));
    const worldIndex = {
      findScene: sceneId => ({ sceneId, regionIndex: sceneId === 'S02' ? 0 : 1 })
    };
    const service = new ScenarioCommandService({
      getWorldIndex: () => worldIndex,
      getCurrentRegionIndex: () => 0,
      getChunkNavigator: () => ({ teleport }),
      getRegionCoordinator: () => ({ switchTo })
    });

    const localContext = context('world:navigation');
    const local = await service.execute(command(SCENARIO_COMMANDS.WORLD_TELEPORT, {
      sceneId: 'S02', spawnRef: 'player', transition: 'fadeBlack'
    }), localContext);
    expect(local.result).toMatchObject({ ok: true, committed: true, stateId: 'world:navigation' });
    expect(teleport).toHaveBeenCalledWith(expect.objectContaining({ sceneId: 'S02', spawnRef: 'player' }));
    expect(switchTo).not.toHaveBeenCalled();

    const regionContext = context('world:navigation');
    const region = await service.execute(command(SCENARIO_COMMANDS.WORLD_TELEPORT, {
      sceneId: 'S09', spawnRef: 'player'
    }, 'scenario-op-2'), regionContext);
    expect(region.result.ok).toBe(true);
    expect(switchTo).toHaveBeenCalledWith(expect.objectContaining({ sceneId: 'S09', regionIndex: 1 }));
    expect(teleport).toHaveBeenCalledTimes(1);
  });

  it('导航目标失败不提交 revision，也不调用 checkpoint 或其他领域 owner', async () => {
    const story = { currentSceneId: 'S01', completed: false };
    const teleport = vi.fn(async () => ({ ok: false, code: 'targetPrepareFailed' }));
    const requestAutoSave = vi.fn();
    const dialogueSystem = { startDialogue: vi.fn() };
    const tutorialSystem = { showTutorial: vi.fn() };
    const service = new ScenarioCommandService({
      dialogueSystem,
      tutorialSystem,
      getWorldIndex: () => ({ findScene: () => ({ regionIndex: 0 }) }),
      getCurrentRegionIndex: () => 0,
      getChunkNavigator: () => ({ teleport }),
      getSaveGameService: () => ({ requestAutoSave })
    });
    const executionContext = context('world:navigation');

    const output = await service.execute(command(SCENARIO_COMMANDS.WORLD_TELEPORT, {
      sceneId: 'S02', story
    }), executionContext);

    expect(output).toMatchObject({ ok: false, committed: false, code: 'targetPrepareFailed' });
    expect(executionContext.commitStateRevision).not.toHaveBeenCalled();
    expect(story).toEqual({ currentSceneId: 'S01', completed: false });
    expect(requestAutoSave).not.toHaveBeenCalled();
    expect(dialogueSystem.startDialogue).not.toHaveBeenCalled();
    expect(tutorialSystem.showTutorial).not.toHaveBeenCalled();
  });

  it('checkpoint.request 只通过 SaveGameService 调度封账后保存', async () => {
    const requestAutoSave = vi.fn(async meta => ({ ok: true, slot: 'autosave-1', meta }));
    const capture = vi.fn(() => ({ ok: true, snapshot: {} }));
    const service = new ScenarioCommandService({
      getSaveGameService: () => ({ requestAutoSave }),
      getSnapshotManager: () => ({ capture })
    });
    const executionContext = context('snapshot:checkpoint');

    const output = await service.execute(command(SCENARIO_COMMANDS.CHECKPOINT_REQUEST, {
      checkpointId: 'checkpoint.S01.complete', sceneId: 'S01'
    }), executionContext);

    expect(output.result).toMatchObject({ ok: true, committed: true, stateId: 'snapshot:checkpoint' });
    expect(requestAutoSave).toHaveBeenCalledWith({
      reason: 'checkpoint', checkpointId: 'checkpoint.S01.complete', sceneId: 'S01',
      checkpointMode: 'required', originOperationId: 'scenario-op-1'
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('dialogue/tutorial 命令只修改各自唯一 owner', async () => {
    const dialogueSystem = { startDialogue: vi.fn(() => true) };
    const tutorialSystem = { showTutorial: vi.fn(() => true) };
    const service = new ScenarioCommandService({ dialogueSystem, tutorialSystem });

    await service.execute(command(SCENARIO_COMMANDS.DIALOGUE, {
      dialogueId: 'dialogue.one', operation: 'start'
    }), context('dialogue:dialogue.one'));
    expect(dialogueSystem.startDialogue).toHaveBeenCalledWith('dialogue.one', {});
    expect(tutorialSystem.showTutorial).not.toHaveBeenCalled();

    await service.execute(command(SCENARIO_COMMANDS.TUTORIAL, {
      tutorialId: 'tutorial.one', operation: 'show'
    }, 'scenario-op-2'), context('tutorial:tutorial.one'));
    expect(tutorialSystem.showTutorial).toHaveBeenCalledWith('tutorial.one', {});
    expect(dialogueSystem.startDialogue).toHaveBeenCalledTimes(1);
  });

  it('tutorial.command show 不等待离槽：命令提交即完成（等待由 TriggerSystem 步骤层负责）', async () => {
    const tutorialSystem = {
      showTutorial: vi.fn(() => true),
      onHide: vi.fn(() => () => {})
    };
    const service = new ScenarioCommandService({ tutorialSystem });

    const output = await service.execute(command(SCENARIO_COMMANDS.TUTORIAL, {
      tutorialId: 'tutorial.one', operation: 'show', await: true
    }), context('tutorial:tutorial.one'));

    expect(output.result).toMatchObject({ ok: true, committed: true, stateId: 'tutorial:tutorial.one' });
    expect(tutorialSystem.showTutorial).toHaveBeenCalledWith('tutorial.one', {});
    expect(output.result.value).toEqual({ ok: true });
  });
});
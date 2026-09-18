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

export const SCENARIO_COMMANDS = Object.freeze({
  WORLD_TELEPORT: 'world.teleport',
  CHECKPOINT_REQUEST: 'checkpoint.request',
  DIALOGUE: 'dialogue.command',
  TUTORIAL: 'tutorial.command'
});

const clone = value => value == null ? value : (typeof structuredClone === 'function'
  ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

function rejected(command, code, error = null) {
  return {
    ok: false, operationId: command.operationId, status: 'rejected', committed: false,
    code, stateId: null, stateRevision: null, eventFrom: null, eventTo: null,
    value: null, error: error || { message: code }
  };
}

/**
 * Scenario 标准命令的薄领域端口。它不拥有 Dialogue/Tutorial/World/Save 状态，
 * 只把 Authority 已验证的命令委托给各自唯一 owner。
 */
export class ScenarioCommandService {
  constructor(config = {}) {
    this.dialogueSystem = config.dialogueSystem || null;
    this.tutorialSystem = config.tutorialSystem || null;
    this.getChunkNavigator = config.getChunkNavigator || (() => null);
    this.getRegionCoordinator = config.getRegionCoordinator || (() => null);
    this.getWorldIndex = config.getWorldIndex || (() => null);
    this.getCurrentRegionIndex = config.getCurrentRegionIndex || (() => -1);
    this.getSaveGameService = config.getSaveGameService || (() => null);
    this.getSnapshotManager = config.getSnapshotManager || (() => null);
    this.stateType = 'scenarioCommand';
    this.stateId = command => {
      if (command.commandType === SCENARIO_COMMANDS.WORLD_TELEPORT) return 'world:navigation';
      if (command.commandType === SCENARIO_COMMANDS.CHECKPOINT_REQUEST) return 'snapshot:checkpoint';
      if (command.commandType === SCENARIO_COMMANDS.DIALOGUE) return `dialogue:${command.payload.dialogueId}`;
      return `tutorial:${command.payload.tutorialId}`;
    };
  }

  async execute(command, context) {
    let outcome;
    try {
      outcome = await this._dispatch(command);
    } catch (error) {
      const details = Array.isArray(error?.errors) ? clone(error.errors) : [];
      return rejected(command, error.code || 'scenarioCommandFailed', {
        message: error.message,
        ...(details.length > 0 ? { details } : {})
      });
    }
    if (outcome === false || outcome == null || outcome?.ok === false || outcome?.cancelled) {
      const details = Array.isArray(outcome?.errors) ? clone(outcome.errors) : [];
      return rejected(command, outcome?.code || outcome?.reason || 'scenarioCommandRejected', {
        message: outcome?.errors?.[0]?.message || outcome?.message || 'scenario command rejected',
        ...(details.length > 0 ? { details } : {})
      });
    }
    // 幂等：教程 show 命令本身不等待教程离槽（等待由 TriggerSystem 步骤层负责），
    // 保证命令 revision 语义完整——提交即完成，避免跨命令共享 stateId 时的 revision 冲突。
    const revision = context.commitStateRevision(context.preparedStateRevision);
    if (!revision.ok) return rejected(command, revision.code);
    const stateId = context.preparedStateRevision.stateId;
    const value = clone(outcome === true ? { ok: true } : outcome);
    const result = {
      ok: true, operationId: command.operationId, status: 'committed', committed: true,
      code: null, stateId, stateRevision: revision.stateRevision,
      eventFrom: null, eventTo: null, value, error: null
    };
    const eventBase = { stateId, stateType: this.stateType, stateRevision: revision.stateRevision };
    return {
      result,
      committedEvents: [{
        ...eventBase,
        type: `${command.commandType}.committed`,
        payload: { commandType: command.commandType, value }
      }],
      applicationEvents: [{
        ...eventBase,
        type: command.commandType,
        payload: { commandType: command.commandType, value }
      }]
    };
  }

  _dispatch(command) {
    if (command.commandType === SCENARIO_COMMANDS.WORLD_TELEPORT) return this._teleport(command.payload);
    if (command.commandType === SCENARIO_COMMANDS.CHECKPOINT_REQUEST) return this._checkpoint(command.payload, command);
    if (command.commandType === SCENARIO_COMMANDS.DIALOGUE) return this._dialogue(command.payload);
    if (command.commandType === SCENARIO_COMMANDS.TUTORIAL) return this._tutorial(command.payload);
    return { ok: false, code: 'unsupportedScenarioCommand' };
  }

  navigate(payload = {}) {
    return this._teleport(payload);
  }

  requestCheckpoint(payload = {}) {
    return this._checkpoint(payload);
  }

  _teleport(payload) {
    const sceneId = payload.sceneId;
    const worldIndex = this.getWorldIndex();
    const target = worldIndex?.findScene?.(sceneId);
    if (!target) return { ok: false, code: 'targetSceneMissing' };
    const hasSingleRegion = worldIndex?.regions?.length === 1;
    if (!hasSingleRegion && target.regionIndex !== this.getCurrentRegionIndex()) {
      const coordinator = this.getRegionCoordinator();
      if (!coordinator?.switchTo) return { ok: false, code: 'regionCoordinatorUnavailable' };
      return coordinator.switchTo({
        projectUrl: payload.projectUrl || 'game.project.json',
        regionIndex: target.regionIndex,
        sceneId,
        spawnRef: payload.spawnRef || 'player'
      });
    }
    const navigator = this.getChunkNavigator();
    if (!navigator?.teleport) return { ok: false, code: 'chunkNavigatorUnavailable' };
    return navigator.teleport({
      sceneId,
      spawnRef: payload.spawnRef || null,
      x: payload.x,
      y: payload.y,
      transition: payload.transition || 'none'
    });
  }

  async _checkpoint(payload, command = null) {
    const checkpointMode = payload.checkpointMode === 'bestEffort' ? 'bestEffort' : 'required';
    const meta = {
      reason: payload.reason || 'checkpoint',
      checkpointId: payload.checkpointId,
      sceneId: payload.sceneId || null,
      checkpointMode,
      originOperationId: payload.originOperationId || command?.operationId || null
    };
    const saveGameService = this.getSaveGameService();
    if (!saveGameService?.requestAutoSave) {
      return { ok: false, code: 'checkpointSchedulerUnavailable' };
    }
    const saved = await saveGameService.requestAutoSave(meta);
    if (saved?.ok === false && checkpointMode === 'bestEffort') {
      return {
        ...saved,
        ok: true,
        committed: false,
        saved: false,
        checkpointSkipped: true,
        nonBlocking: true
      };
    }
    return saved;
  }

  _dialogue(payload) {
    const system = this.dialogueSystem;
    if (!system) return { ok: false, code: 'dialogueSystemUnavailable' };
    if (payload.operation === 'continue') return system.continue(payload.context || {});
    if (payload.operation === 'end') return system.endDialogue() ?? true;
    if (payload.operation && payload.operation !== 'start') return { ok: false, code: 'unsupportedDialogueOperation' };
    return system.startDialogue(payload.dialogueId, payload.context || {});
  }

  _tutorial(payload) {
    const system = this.tutorialSystem;
    if (!system) return { ok: false, code: 'tutorialSystemUnavailable' };
    if (payload.operation === 'complete') return system.completeTutorial(payload.tutorialId) ?? true;
    if (payload.operation === 'showStep') {
      return system.showTutorialStep(payload.tutorialId, payload.tutorialStepId, payload.context || {});
    }
    if (payload.operation === 'skip') return system.skipTutorial();
    if (payload.operation === 'notify') return system.notify(payload.signal, payload.value || {});
    if (payload.operation && payload.operation !== 'show') return { ok: false, code: 'unsupportedTutorialOperation' };
    const started = system.showTutorial(payload.tutorialId, payload.context || {});
    if (started === false) return { ok: false, code: 'tutorialShowRejected' };
    return true;
  }
}

export default ScenarioCommandService;
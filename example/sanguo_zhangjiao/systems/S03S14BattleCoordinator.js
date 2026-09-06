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

 ************************************************************
 * 三国张角传 - S03-S14 战役历史策略与场景装配
 ************************************************************/

import { SceneBattleRuntime } from '../../../src/core/scene/SceneBattleRuntime.js';
import { BattleMode, BattleState } from '../../../src/systems/BattleSystem.js';
import { RescueSystem } from '../../../src/systems/RescueSystem.js';
import { EndingSystem } from '../../../src/systems/EndingSystem.js';
import { RescueObjectiveView } from '../../../src/ui/RescueObjectiveView.js';
import { IrreversibleChoiceView } from '../../../src/ui/IrreversibleChoiceView.js';
import { EndingPresentationView } from '../../../src/ui/EndingPresentationView.js';
import { S04RouteCoordinator } from './S04RouteCoordinator.js';
import { S03_BATTLE_ID, S04_BOCAI_RESCUE_ID } from './S03S08SceneFlow.js';
import { S05_BATTLE_ID, S05_ZHANG_MANCHENG_RESCUE_ID } from './S05SceneFlow.js';
import { S07_BATTLE_ID } from './S07S08SceneFlow.js';
import {
  S11S12Coordinator, S11_BATTLE_ID, S12_BATTLE_ID, S11_RESCUE_ID, S12_RESCUE_ID
} from './S11S12Coordinator.js';
import { S13S14Coordinator } from './S13S14Coordinator.js';

const S04_BATTLE_ID = 'battle.s04.changshe';
const S13_BATTLE_ID = 'battle.s13.jingshan';
const BATTLE_SCENE_IDS = Object.freeze(['S03', 'S04', 'S05', 'S07', 'S11', 'S12', 'S13']);
const BATTLE_IDS = Object.freeze([
  S03_BATTLE_ID, S04_BATTLE_ID, S05_BATTLE_ID, S07_BATTLE_ID,
  S11_BATTLE_ID, S12_BATTLE_ID, S13_BATTLE_ID
]);
const RESCUE_IDS = Object.freeze([
  S04_BOCAI_RESCUE_ID, S05_ZHANG_MANCHENG_RESCUE_ID, S11_RESCUE_ID, S12_RESCUE_ID
]);
const RESCUE_TITLE_BY_ID = Object.freeze({
  [S04_BOCAI_RESCUE_ID]: '波才限时救援',
  [S05_ZHANG_MANCHENG_RESCUE_ID]: '张曼成限时救援',
  [S11_RESCUE_ID]: '张梁广宗突围',
  [S12_RESCUE_ID]: '张宝下曲阳撤离'
});
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

export class S03S14BattleCoordinator {
  constructor(scene) {
    this.scene = scene;
    this.runtime = null;
    this.definitions = new Map();
    this.rescueDefinitions = new Map();
    this._detachFrameUpdate = null;
    this.initialized = false;
  }

  async initialize(gameLoader) {
    if (this.initialized) this.dispose();
    const battles = gameLoader?.project?.battles || [];
    const rescues = gameLoader?.project?.rescues || [];
    for (const battleId of BATTLE_IDS) {
      const source = battles.find(entry => entry?.battleId === battleId);
      if (!source) throw new Error(`缺少战役配置 ${battleId}`);
      this.definitions.set(battleId, clone(source));
    }
    for (const rescueId of RESCUE_IDS) {
      const source = rescues.find(entry => entry?.id === rescueId);
      if (!source) throw new Error(`缺少救援配置 ${rescueId}`);
      this.rescueDefinitions.set(rescueId, clone(source));
    }
    if (!this.scene._worldLoadPromise) {
      throw new Error('战役初始化需要 canonical 世界加载 Promise');
    }
    await this.scene._worldLoadPromise;
    const session = this.scene._worldLoadSession;
    if (!session || typeof session.loadSceneData !== 'function') {
      throw new Error('战役初始化需要有效的 canonical 世界加载会话');
    }
    const sceneDataList = await Promise.all(BATTLE_SCENE_IDS.map(async sceneId => {
      const sceneData = session.getSceneData(sceneId) || await session.loadSceneData(sceneId);
      if (!sceneData || !Array.isArray(sceneData.layers)) {
        throw new Error(`缺少 canonical 场景配置 ${sceneId}`);
      }
      return sceneData;
    }));
    this.scene.configureSceneBattleFlows(sceneDataList, battles);
    for (const definition of this.definitions.values()) {
      definition.playerEntityId = this.scene.playerEntity?.id || definition.playerEntityId;
    }
    this.definitions.set(S11_BATTLE_ID, this.scene.s10ConstructionCoordinator.projectBattleDefinition(
      this.definitions.get(S11_BATTLE_ID), 'S11'
    ));
    this.definitions.set(S12_BATTLE_ID, this.scene.s10ConstructionCoordinator.projectBattleDefinition(
      this.definitions.get(S12_BATTLE_ID), 'S12'
    ));

    this.runtime = new SceneBattleRuntime({
      battleClient: gameLoader.battleClient,
      validator: gameLoader.contentValidator,
      combatSystem: this.scene.combatSystem,
      aiSystem: this.scene.aiSystem,
      viewWidth: this.scene.logicalWidth,
      getEntities: () => this.scene.entityStore.all,
      getPlayer: () => this.scene.playerEntity,
      getCurrentSceneId: () => this.scene.currentSceneId,
      getFlowByScene: sceneId => this.scene.getBattleFlowByScene(sceneId),
      getFlowByBattle: battleId => this.scene.getBattleFlowById(battleId),
      getEntryPoint: (sceneId, ref) => this.scene._worldLoadSession?.findSpawn?.(sceneId, ref),
      getAppliedResultIds: () => gameLoader.blackboard?.get?.('appliedBattleResultIds') || [],
      getProgressionSystem: () => gameLoader.progressionSystem,
      getBattleRewards: () => gameLoader.project?.progression?.battleRewards,
      showTip: (message, options) => this.scene._showScreenTip(message, options),
      notify: (message, type) => {
        if (type === 'success') this.scene.notificationSystem?.addSuccess?.(message);
        else this.scene.notificationSystem?.addNotification?.(message, type);
      },
      requestCheckpoint: checkpoint => this.scene.requestAutoSave({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId,
        sceneId: checkpoint.sceneId || this.scene.currentSceneId
      }),
      cityWarState: {
        read: () => this.scene.cityWarStateBridge.read(),
        commit: draft => this.scene.cityWarStateBridge.commit(draft),
        restore: before => this.scene.cityWarStateBridge.restore(before)
      },
      movePlayerTo: entry => {
        const transform = this.scene.playerEntity?.getComponent?.('transform');
        if (!transform) return false;
        transform.position.x = entry.x;
        transform.position.y = entry.y;
        this.scene.camera?.setPosition?.(entry.x, entry.y);
        return true;
      },
      hooks: this._createRuntimeHooks(gameLoader)
    });
    try {
      this.runtime.registerDefinitions([...this.definitions.values()]);
      this._detachFrameUpdate = this.scene.sceneRuntime?.onFramePhase?.(
        'afterScene',
        deltaTime => this.update(deltaTime)
      ) || null;
      this._installDemoServices(gameLoader);
      this._projectCompatibilityFields();
      this.initialized = true;
      this.scene.context.services.battleRuntime = this.runtime;
      this.scene.resourceScope?.track(() => this.dispose());
      return true;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  _createRuntimeHooks(gameLoader) {
    return {
      projectDefinition: (definition, flow) => (
        ['S11', 'S12'].includes(flow?.sceneId)
          ? this.scene.s10ConstructionCoordinator.projectBattleDefinition(definition, flow.sceneId)
          : definition
      ),
      beforeOpen: ({ sceneId }) => {
        if (sceneId === 'S13') {
          const route = this.scene.s13s14Coordinator?.resolvePostS12Target?.();
          if (!route?.ok || !route.s13Eligible) {
            this.scene._showScreenTip(
              '只有走南阳路线、在 S05 选择介入且访问过 S05/S06 才能进入精山战场。',
              { title: '精山未开放' }
            );
            return { ok: false };
          }
        }
        if (sceneId === 'S05') this._markS05Visited(gameLoader);
        return { ok: true };
      },
      beforeSelect: ({ mode, sceneId }) => {
        if (sceneId === 'S05') this._markS05Visited(gameLoader);
        if (sceneId !== 'S13') return { ok: true };
        return this.scene.s11s14SceneCoordinator.prepareS13Settlement(mode);
      },
      resolveBeforeBattlefield: context => this._resolveS12LowMorale(gameLoader, context),
      beforeBattlefieldStart: ({ sceneId, definition }) => {
        this.scene.s10ConstructionCoordinator.applyBattleEffects(definition, sceneId);
        return true;
      },
      onSelectFailure: ({ sceneId }) => {
        if (sceneId === 'S13' && this.runtime?.getSessionState?.().state !== BattleState.RESOLVED) {
          this.scene.s11s14SceneCoordinator.rollbackS13Settlement();
        }
      },
      settleResult: context => this._settleSpecialResult(context),
      afterDomainSettlement: context => this._settleUnavailableRescue(context),
      afterSettlement: async ({ result }) => {
        if (result.battleId === S13_BATTLE_ID && this.scene.currentSceneId === 'S13') {
          await this.scene.s11s14SceneCoordinator.checkS13Exit();
        }
      }
    };
  }

  _installDemoServices(gameLoader) {
    const scene = this.scene;
    const rescueObjectiveView = new RescueObjectiveView({
      width: Math.min(500, scene.logicalWidth - 32), title: '波才限时救援'
    });
    const rescueSystem = new RescueSystem({
      now: () => scene.simulationClock?.nowSeconds?.() ?? performance.now() / 1000,
      onEvent: (event, data) => {
        if (event === 'rescueStarted' || event === 'rescueStageAdvanced') {
          rescueObjectiveView.setSnapshot(data);
        }
      }
    });
    const irreversibleChoiceView = new IrreversibleChoiceView({
      width: Math.min(600, scene.logicalWidth - 32),
      onCommand: command => { void scene._handleIrreversibleChoiceCommand(command); }
    });
    const s04RouteCoordinator = new S04RouteCoordinator({
      readState: () => ({
        storyState: clone(gameLoader.blackboard?.get?.('storyState') || {}),
        warState: clone(gameLoader.blackboard?.get?.('warState') || {}),
        appliedBattleResultIds: clone(gameLoader.blackboard?.get?.('appliedBattleResultIds') || [])
      }),
      writeStoryState: storyState => {
        if (!gameLoader.blackboard) return false;
        gameLoader.blackboard.set('storyState', clone(storyState));
        return true;
      },
      hasTarget: sceneId => !!scene._worldLoadSession?.getChunk?.(sceneId)
        && !!scene._worldLoadSession?.findSpawn?.(sceneId, 'player'),
      createCheckpoint: checkpoint => scene.requestAutoSave({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: checkpoint.sceneId
      }),
      onCommitted: ({ route, operationId }) => gameLoader.triggerSystem?.fire?.('routeSelected', {
        routeId: route.id, entrySceneId: route.entrySceneId, operationId
      })
    });
    const endingConfig = clone(gameLoader.project?.extensions?.endings || null);
    const endingPresentationView = new EndingPresentationView({
      width: scene.logicalWidth, height: scene.logicalHeight,
      resolveImage: imageId => scene.assetManager?.getAsset?.(imageId) || null,
      onMusicChange: musicId => {
        if (musicId && scene.audioManager?.hasMusic?.(musicId)) scene.audioManager.playMusic?.(musicId);
        else scene.audioManager?.stopMusic?.(true);
      },
      onCommand: command => { void scene.s11s14SceneCoordinator._handleEndingPresentationCommand(command); }
    });
    const endingSystem = new EndingSystem({
      readState: () => scene.s11s14SceneCoordinator._readEndingRuntimeState(),
      commitState: state => scene.s11s14SceneCoordinator._writeEndingRuntimeState(state),
      restoreState: state => scene.s11s14SceneCoordinator._writeEndingRuntimeState(state),
      projectInput: state => scene.s11s14SceneCoordinator._projectEndingInput(state),
      emit: (event, payload) => {
        if (event === 'endingResolved') gameLoader.triggerSystem?.fire?.('endingResolved', clone(payload));
        return true;
      },
      checkpoint: checkpoint => scene.requestAutoSave({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: 'S14'
      })
    });
    const s11s12Coordinator = new S11S12Coordinator({
      rescueSystem,
      inventoryTransactions: scene.inventoryTransactions,
      getInventory: () => scene.playerEntity?.getComponent?.('inventory') || null,
      getBattleSession: () => this.runtime.getSessionState(),
      canUseRescue: () => this.runtime.canUseRescue(),
      readStoryState: () => clone(gameLoader.blackboard?.get?.('storyState') || {}),
      writeStoryState: storyState => {
        if (!gameLoader.blackboard) return false;
        gameLoader.blackboard.set('storyState', clone(storyState));
        return true;
      },
      createCheckpoint: checkpoint => scene.requestAutoSave({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: checkpoint.sceneId
      }),
      freezeBattleResult: candidate => this.runtime.freezeResult(candidate),
      createLowMoraleResult: context => scene.s11s14SceneCoordinator.createS12LowMoraleResult(context),
      rescueDefinitions: {
        S11: this.rescueDefinitions.get(S11_RESCUE_ID),
        S12: this.rescueDefinitions.get(S12_RESCUE_ID)
      },
      onEvent: (event, data) => scene.s11s14SceneCoordinator.handleS11S12Event(event, data)
    });
    const s13s14Coordinator = new S13S14Coordinator({
      readState: () => scene.s11s14SceneCoordinator._readS13S14State(),
      writeStoryState: storyState => {
        if (!gameLoader.blackboard) return false;
        gameLoader.blackboard.set('storyState', clone(storyState));
        return true;
      },
      applyS13Settlement: context => scene.s11s14SceneCoordinator.applyS13Settlement(context),
      applyResourceDivergence: context => scene.s11s14SceneCoordinator._applyS14ResourceDivergence(context),
      createCheckpoint: checkpoint => scene.requestAutoSave({
        reason: 'checkpoint', checkpointId: checkpoint.checkpointId, sceneId: checkpoint.sceneId
      }),
      hasTarget: sceneId => scene._findRegionIndexForScene?.(sceneId) >= 0,
      endingSystem
    });
    Object.assign(this, {
      rescueSystem, rescueObjectiveView, irreversibleChoiceView, s04RouteCoordinator,
      endingConfig, endingPresentationView, endingSystem, s11s12Coordinator, s13s14Coordinator
    });
    const offDamage = scene.combatSystem?.addDamageListener?.(
      event => scene.s05SceneCoordinator._handleS05CombatDamage(event)
    ) || (() => {});
    scene.resourceScope?.track(offDamage);
  }

  _projectCompatibilityFields() {
    const scene = this.scene;
    Object.assign(scene, {
      rescueSystem: this.rescueSystem,
      rescueObjectiveView: this.rescueObjectiveView,
      irreversibleChoiceView: this.irreversibleChoiceView,
      endingPresentationView: this.endingPresentationView,
      endingSystem: this.endingSystem,
      s04RouteCoordinator: this.s04RouteCoordinator,
      s11s12Coordinator: this.s11s12Coordinator,
      s13s14Coordinator: this.s13s14Coordinator,
      _endingConfig: this.endingConfig
    });
  }

  _markS05Visited(gameLoader) {
    const before = gameLoader.blackboard?.get?.('storyState');
    if (!before || (before.visitedScenes || []).includes('S05')) return true;
    gameLoader.blackboard.set('storyState', {
      ...before, visitedScenes: [...new Set([...(before.visitedScenes || []), 'S05'])]
    });
    return true;
  }

  _resolveS12LowMorale(gameLoader, { sceneId, definition }) {
    if (sceneId !== 'S12') return null;
    const city = (gameLoader.blackboard?.get?.('cityStates') || [])
      .find(entry => entry?.id === 'city.s12_xiaquyang');
    const morale = Math.max(0, Math.floor(Number(
      city?.morale ?? definition.realtimeMorale?.yellow_turban
    ) || 0));
    const resolved = this.s11s12Coordinator?.resolveS12PreBattleMorale({ friendlyMorale: morale });
    if (resolved?.battleMayStart !== false) return null;
    if (!resolved.ok || !resolved.result) return { ok: false, code: resolved.code || 'lowMoraleResolutionRejected' };
    return {
      result: resolved.result,
      title: '未能开战',
      message: '守军士气已经归零，下曲阳战役直接冻结为官军胜利。'
    };
  }

  async _settleSpecialResult({ result, flow }) {
    if (result.battleId !== S13_BATTLE_ID) return null;
    const choice = this.scene.s11s14SceneCoordinator.buildS13Choice(this.runtime.getSessionState().mode, result);
    const settled = await this.s13s14Coordinator?.commitS13Choice?.(choice, {
      checkpointId: flow.checkpointId
    });
    if (!settled?.ok) return settled;
    this.scene._s13PendingSettlement = null;
    return settled;
  }

  async _settleUnavailableRescue({ result }) {
    if (![S11_BATTLE_ID, S12_BATTLE_ID].includes(result.battleId)) return true;
    const mode = this.runtime.getSessionState().mode;
    if (mode !== BattleMode.OBSERVE && result.failureReason !== 'friendlyMoraleZero') {
      return true;
    }
    const sceneId = result.battleId === S11_BATTLE_ID ? 'S11' : 'S12';
    const unavailable = await this.s11s12Coordinator?.settleUnavailableRescue?.(sceneId, {
      mode,
      force: result.failureReason === 'friendlyMoraleZero',
      reason: result.failureReason === 'friendlyMoraleZero' ? 'friendlyMoraleZero' : 'modeObserved',
      completedAt: this.rescueSystem?.now?.()
    });
    if (unavailable?.ok === false) throw new Error(unavailable.message || unavailable.code);
    return true;
  }

  open(sceneId) { return this.runtime?.openByScene(sceneId) || false; }
  selectMode(mode, sceneId) { return this.runtime?.selectMode(mode, sceneId) || false; }
  update(deltaTime) { return this.runtime?.update(deltaTime); }
  getDefinition(battleId) { return this.runtime?.getDefinition(battleId) || null; }
  getRescueDefinition(definitionId) { return clone(this.rescueDefinitions.get(definitionId) || null); }
  hasRescueDefinition(definitionId) { return this.rescueDefinitions.has(definitionId); }
  getSessionState() { return this.runtime?.getSessionState() || {}; }
  isBattlefieldActive() { return this.runtime?.isBattlefieldActive() === true; }
  canUseRescue() { return this.runtime?.canUseRescue() === true; }
  freezeBattleResult(candidate) {
    return this.runtime?.freezeResult(candidate) || { ok: false, code: 'battleRuntimeUnavailable' };
  }
  captureCityWarState() { return this.runtime?.captureCityWarState() || null; }
  restoreCityWarState(snapshot) {
    return this.runtime?.restoreCityWarState(snapshot) || { ok: false, code: 'battleRuntimeUnavailable' };
  }
  applyBattleResult(params) {
    return this.runtime?.applyBattleResult(params)
      || Promise.resolve({ ok: false, code: 'battleRuntimeUnavailable' });
  }
  isInputLayerVisible(layer) { return this.runtime?.isInputLayerVisible(layer) === true; }
  handleInputLayer(layer, context) { return this.runtime?.handleInputLayer(layer, context) || false; }
  renderLayer(layer, ctx, width, height) { return this.runtime?.renderLayer(layer, ctx, width, height); }
  closeUi() { this.runtime?.closeUi(); }
  leaveBattleScene(options) { this.runtime?.leaveBattleScene(options); }
  capture() { return this.runtime?.capture() || {}; }
  validateSnapshot(data) { return this.runtime?.validateSnapshot(data) || { ok: false, code: 'battleRuntimeUnavailable' }; }
  restore(data) { return this.runtime?.restore(data) || { ok: false, code: 'battleRuntimeUnavailable' }; }

  setRescueObjectiveTitle(definitionId) {
    const title = RESCUE_TITLE_BY_ID[definitionId];
    if (!title || !this.rescueObjectiveView) return false;
    this.rescueObjectiveView.title = title;
    return true;
  }

  dispose() {
    if (!this.runtime && !this.initialized) return;
    this._detachFrameUpdate?.();
    this._detachFrameUpdate = null;
    this.runtime?.dispose();
    this.rescueObjectiveView?.clear?.();
    this.irreversibleChoiceView?.close?.();
    this.endingPresentationView?.close?.();
    this.scene.s11s14SceneCoordinator?._removeS12GateEntity?.();
    if (this.scene.context.services.battleRuntime === this.runtime) {
      delete this.scene.context.services.battleRuntime;
    }
    this.runtime = null;
    this.definitions.clear();
    this.rescueDefinitions.clear();
    this.initialized = false;
  }
}

export default S03S14BattleCoordinator;

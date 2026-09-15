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

/**
 * BaseGameScene - 游戏场景基类
 * 
 * 包含所有场景通用的基础功能：
 * - ECS 实体系统
 * - 输入管理
 * - 相机系统
 * - 移动系统
 * - 战斗系统
 * - UI 面板（背包、装备、人物信息）
 * - 粒子系统和特效
 * 
 * 第一幕和第二幕都继承此类
 */

import { Scene } from '../../../src/core/Scene.js';
import { normalizePresentationProfile } from '../../../src/core/PresentationProfile.js';
import presentationProfileData from '../config/presentation.json';
import { EntityFactory } from '../../../src/ecs/EntityFactory.js';
import { InputManager } from '../../../src/core/InputManager.js';
import UIClickHandler from '../../../src/core/UIClickHandler.js';
import { TutorialSystem } from '../../../src/systems/TutorialSystem.js';
import { DialogueSystem } from '../../../src/systems/DialogueSystem.js';
import { QuestTransactionService, QUEST_COMMANDS } from '../../../src/systems/QuestTransactionService.js';
import { IsometricRenderer } from '../../../src/rendering/IsometricRenderer.js';
import { BackpackPanel } from '../../../src/ui/BackpackPanel.js';
import { BottomControlBar } from '../../../src/ui/BottomControlBar.js';
import { PlayerStatusHUD } from '../../../src/ui/PlayerStatusHUD.js';
import { IconButton } from '../../../src/ui/IconButton.js';
import { createUIStrategy } from '../../../src/ui/strategies/index.js';
import { DialogueBox } from '../../../src/ui/DialogueBox.js';
import { Minimap } from '../../../src/ui/Minimap.js';
import { FloatingTextManager } from '../../../src/ui/FloatingText.js';
import { NotificationSystem } from '../../../src/ui/NotificationSystem.js';
import { ItemGainedPopup } from '../../../src/ui/ItemGainedPopup.js';
import { GamepadPanel } from '../../../src/ui/GamepadPanel.js';
import { GamepadCombatController } from '../../../src/core/input/GamepadCombatController.js';
import { InputHints } from '../../../src/core/input/InputHints.js';
import { SkillWheelOverlay } from '../../../src/ui/SkillWheelOverlay.js';
import { SceneTerrainBinding } from '../../../src/core/scene/SceneTerrainBinding.js';
import { SceneTerrainCollision } from '../../../src/core/scene/SceneTerrainCollision.js';
import { SceneEquipmentFlow } from '../../../src/core/scene/SceneEquipmentFlow.js';
import { SceneTransitionFlow } from '../../../src/core/scene/SceneTransitionFlow.js';
import { SceneCombatActions } from '../../../src/core/scene/SceneCombatActions.js';
import { SceneDialogueFlow } from '../../../src/core/scene/SceneDialogueFlow.js';
import { SceneWorldInteraction } from '../../../src/core/scene/SceneWorldInteraction.js';
import { SceneSkillActions } from '../../../src/core/scene/SceneSkillActions.js';
import { SceneWorldPresentation } from '../../../src/core/scene/SceneWorldPresentation.js';
import { SceneApplicationEventService } from '../../../src/core/scene/SceneApplicationEventService.js';
import { ScenePanelLayout } from '../../../src/core/scene/ScenePanelLayout.js';
import { SceneRenderPipeline } from '../../../src/core/scene/SceneRenderPipeline.js';
import { SceneFramePipeline } from '../../../src/core/scene/SceneFramePipeline.js';
import { GameSceneRuntime } from '../../../src/core/scene/GameSceneRuntime.js';
import { SceneItemGainedFlow } from '../../../src/core/scene/SceneItemGainedFlow.js';
import { SceneAimPresentation } from '../../../src/core/scene/SceneAimPresentation.js';
import { SceneGameplaySystemAssembler } from '../../../src/core/scene/SceneGameplaySystemAssembler.js';
import { SceneGameplaySnapshotRuntime } from '../../../src/core/scene/SceneGameplaySnapshotRuntime.js';
import { SceneDeathDropRuntime } from '../../../src/core/scene/SceneDeathDropRuntime.js';
import { SceneDiagnostics } from '../../../src/core/scene/SceneDiagnostics.js';
import { applySceneRuntimeConfig, toggleSceneDebugPanel } from '../../../src/core/scene/RuntimeDebugWiring.js';
import { SceneBattleFlowRegistry } from '../../../src/core/scene/SceneBattleFlowRegistry.js';
import { GameSceneContext } from '../../../src/core/scene/GameSceneContext.js';
import { SceneEntityStore } from '../../../src/core/scene/SceneEntityStore.js';
import { ScenePlayerLifecycle } from '../../../src/core/scene/ScenePlayerLifecycle.js';
import { SceneInputBindings } from '../../../src/core/scene/SceneInputBindings.js';
import { SceneHintPresenter } from '../../../src/core/scene/SceneHintPresenter.js';
import { SceneLifecycleCoordinator } from '../../../src/core/scene/SceneLifecycleCoordinator.js';
import { SceneInventoryFlow } from '../../../src/core/scene/SceneInventoryFlow.js';
import { SceneHudUpdater } from '../../../src/core/scene/SceneHudUpdater.js';
import { SceneTriggerBindingSystem } from '../../../src/core/scene/SceneTriggerBindingSystem.js';
import { SceneInputFlow } from '../../../src/core/input/SceneInputFlow.js';
import { Scene1Terrain } from './Scene1Terrain.js';
import { ParticleSystem } from '../../../src/rendering/ParticleSystem.js';
import { EffectZoneRenderer } from '../../../src/rendering/EffectZoneRenderer.js';
import { EntityLifecycleSystem } from '../../../src/systems/EntityLifecycleSystem.js';
import { ItemRuntimeFactory } from '../../../src/systems/items/ItemRuntimeFactory.js';
import { UISystem } from '../../../src/ui/UISystem.js';
import { PortraitsConfig } from '../data/PortraitsConfig.js';
import { SelectedCharacterStore } from '../data/SelectedCharacterStore.js';
import { DemoPlayerFactory } from '../entities/DemoPlayerFactory.js';
import { getNpcRenderStyle } from '../../../src/rendering/NpcRenderStyles.js';
import { EntityRenderer2D } from '../../../src/rendering/EntityRenderer2D.js';
import { TaskGraphProjectionView } from '../../../src/ui/TaskGraphProjectionView.js';
import { CommandContractKind } from '../../../src/core/command/CommandContracts.js';
import { BaseGameSceneSetup } from './BaseGameSceneSetup.js';

const ZONE_STAT_NAMES = Object.freeze({ hp: '生命', mp: '法力', attack: '攻击', defense: '防御', speed: '速度' });
const ZONE_STAT_SHORT = Object.freeze({ hp: 'HP', mp: 'MP', attack: 'ATK', defense: 'DEF', speed: 'SPD' });

export class BaseGameSceneBehaviors extends BaseGameSceneSetup {  /**
   * 处理装备槽点击（卸下装备）——属性面板/装备面板共用
   * @param {string} slotType - 装备槽类型
   * @param {string} button - 鼠标按钮
   */
  _handleEquipmentSlotClick(slotType, button) {
    return this._ensureInventoryFlow().unequip(slotType, button, { mobile: this.isMobileLayout });
  }

  /**
   * 初始化 UI 面板（兼容入口，委托给场景 HUD 组合器）
   */
  initializeUIPanels() {
    const panelLayout = this._ensurePanelLayout();
    // 物品图标优先使用内容定义的稳定 imageId；退出场景时解除注入。
    this.resourceScope?.track(panelLayout.installItemIconResolver());
    return panelLayout.composeHud();
  }

  /** 加载并应用 UI 编辑器布局（Canvas 面板部分）。 */
  async _applyUILayout() {
    return this._ensurePanelLayout().applyUILayout();
  }

  /**
   * 物品使用回调
   */
  onItemUsed(item, healAmount, manaAmount) {
    return this._ensureInventoryFlow().itemUsed(item, healAmount, manaAmount);
  }

  submitItemIntent(intentType, payload = {}, options = {}) {
    const actorId = options.actorId || this.playerEntity?.id;
    if (!actorId || !this.sceneRuntime?.commandGateway) {
      return Promise.resolve({ ok: false, code: 'itemCommandUnavailable' });
    }
    this._itemIntentSequence = Math.max(0, Number(this._itemIntentSequence) || 0) + 1;
    const operationId = options.operationId
      || `item:${actorId}:${intentType}:${this._itemIntentSequence}`;
    return this.sceneRuntime.commandGateway.execute({
      intentType,
      actorRef: actorId,
      operationId,
      payload
    }, options);
  }

  /** 仅在调用方已确认业务事实成立后，经权威网关发布 application event。 */
  publishApplicationEvent(eventType, payload = {}, options = {}) {
    const actorRef = options.actorId || this.playerEntity?.id;
    if (!actorRef || !this.sceneRuntime?.commandGateway) {
      return Promise.resolve({ ok: false, code: 'applicationEventGatewayUnavailable' });
    }
    this._applicationEventSequence = (Number(this._applicationEventSequence) || 0) + 1;
    return this.sceneRuntime.commandGateway.execute({
      intentType: 'scene.applicationEvent',
      actorRef,
      operationId: options.operationId
        || `application-event:${eventType}:${this._applicationEventSequence}`,
      payload: {
        eventType,
        sceneId: options.sceneId || this.currentSceneId || this.editorSceneId || null,
        reason: options.reason || payload.reason || 'runtime',
        payload
      }
    });
  }

  getItemLifecycleProjection(actorId = this.playerEntity?.id) {
    if (!actorId) return null;
    return this.sceneRuntime?.projectionStore?.get?.('itemLifecycle', `item-lifecycle:${actorId}`) || null;
  }

  seedItemLifecycleProjection(actor = this.playerEntity) {
    if (!actor || !this.itemLifecycleService || !this.sceneRuntime?.projectionStore) return null;
    const stateId = `item-lifecycle:${actor.id}`;
    return this.sceneRuntime.projectionStore.seed({
      projectionType: 'itemLifecycle',
      projectionId: stateId,
      definitionRevision: this.gameLoader?.definitionRepository?.definitionRevision || 0,
      stateRevision: this.sceneRuntime.stateRevisions.current(stateId),
      projectionRevision: 0,
      lastEventSequence: this.sceneRuntime.projectionStore.lastEventSequence,
      value: this.itemLifecycleService.seedProjection(actor)
    });
  }

  /**
   * 装备变化回调
   * @param {Array} messages - 消息数组
   */
  /**
   * 获得物品（拾取/奖励）→ 委托给通用 FIFO 弹窗流程。
   * 物品的入背包仍由 PickupSystem / TriggerActions 在调用前完成。
   */
  onItemGained(item, player) {
    return this._ensureInventoryFlow().itemGained(item, player);
  }

  /** @private 兼容旧场景/手柄弹窗回调：显示队列下一件。 */
  _showNextGained() {
    return this._ensureItemGainedFlow().showNext();
  }

  /** @private 装备预览比较继续复用框架通用实现。 */
  _computeEquipComparison(item, player) {
    return this._ensureItemGainedFlow().computeEquipComparison(item, player);
  }

  /** @private 兼容旧调用：执行当前物品弹窗的主操作。 */
  _onGainedPopupPrimary(item, player) {
    return this._ensureItemGainedFlow().handlePrimary(item, player);
  }

  /** @private 懒创建装备流程实例（注入 EquipmentSystem 以触发属性重算） */
  _ensureEquipmentFlow() {
    if (!this._equipmentFlow) {
      this._equipmentFlow = new SceneEquipmentFlow({ equipmentSystem: this.equipmentSystem });
    }
    return this._equipmentFlow;
  }

  /** @private 装备变化后刷新统一背包显示 */
  _refreshEquipmentPanels(player) {
    this.backpackPanel?.setEntity(player);
  }

  /**
   * 装备变化统一出口。所有装备/卸下路径都必须经过这里，子类可覆盖以派发事件源。
   * @param {string[]} messages - 展示用文案
   * @param {Object} [info] - 结构化信息 { slot, item, oldItem, action }，
   *   由知道细节的调用方传入；InventoryPanel 等旧路径不传，子类需自行兜底推断。
   */
  onEquipmentChanged(messages, info = null) {
    if (!messages || messages.length === 0) return;
    
    if (this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        // 显示每条消息
        let yOffset = -30;
        for (const message of messages) {
          this.floatingTextManager.addText(
            transform.position.x, 
            transform.position.y + yOffset, 
            message,
            message.includes('+') ? '#00ff00' : (message.includes('-') ? '#ff6666' : '#ffff00')
          );
          yOffset -= 25;
        }
      }
    }
    
    console.log('BaseGameScene: 装备变化', messages);
  }

  /**
   * 技能点击回调
   * @param {Object} skill - 技能对象
   */
  onSkillClicked(skill) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureSkillActions().onSkillClicked(skill);
  }

  /** @private 懒创建场景渲染编排器。 */
  _ensureRenderPipeline() {
    if (!this._renderPipeline) {
      this._renderPipeline = new SceneRenderPipeline({ scene: this, context: this.context });
    }
    return this._renderPipeline;
  }

  /** @private 懒创建场景帧更新管线。 */
  _ensureFramePipeline() {
    if (!this._framePipeline) {
      this._framePipeline = new SceneFramePipeline({ scene: this, context: this.context });
    }
    return this._framePipeline;
  }

  /** 初始化唯一 Runtime；场景重入会先幂等释放旧 owner。 */
  _initializeSceneRuntime() {
    this.sceneRuntime?.dispose();
    this.sceneRuntime = new GameSceneRuntime({
      onError: (phase, name, error) => console.warn(`BaseGameScene runtime ${phase} [${name}]`, error)
    });
    this.context.services.eventJournal = this.sceneRuntime.eventJournal;
    this.context.services.taskGraph = this.sceneRuntime.taskGraphSystem;
    this.taskGraphProjectionView = new TaskGraphProjectionView({
      getTaskGraph: () => this.context.services.taskGraph,
      getActorId: () => this.playerEntity?.id || null
    });
    this.context.ui.taskGraph = this.taskGraphProjectionView;
    this.applicationEventService = new SceneApplicationEventService();
    this.sceneRuntime.registerCommandHandler('scene.applicationEvent', this.applicationEventService);
    this.questSystem.setCommandGateway(this.sceneRuntime.commandGateway);
    this.questSystem.setTaskGraphSystem(this.sceneRuntime.taskGraphSystem);
    for (const commandType of Object.values(QUEST_COMMANDS)) {
      this.sceneRuntime.registerCommandHandler(commandType, this.questSystem);
    }
    this.sceneRuntime.authoritySnapshotService.registerService('quests', {
      snapshot: () => this.questSystem.snapshot(),
      validate: snapshot => this.questSystem.validate(snapshot),
      restore: snapshot => this.questSystem.restore(snapshot),
      required: true
    });
    const stopTaskEventConsumption = this.sceneRuntime.notificationBus.subscribe(envelope => {
      if (envelope?.kind !== CommandContractKind.APPLICATION_EVENT || !envelope.value?.eventId) return;
      return this.questSystem.consumeTaskEvent(envelope.value, {
        actorId: this.playerEntity?.id || null
      });
    });
    this.resourceScope?.track?.(stopTaskEventConsumption);
    this.sceneRuntime.provide({ scene: this });
    this.sceneRuntime.enter();
    return this.sceneRuntime;
  }

  /** 迁移兼容入口；正式 SceneFramePipeline 直接调用 Runtime。 */
  _runRuntimePhase(phase, deltaTime) {
    return this.sceneRuntime?.runFramePhase(phase, deltaTime, {
      scene: this,
      frameToken: this.sceneRuntime.currentFrameToken
    }) || false;
  }

  /** @private 顶层输入编排：帧首采集、优先消费，正常帧末统一清帧。 */
  _ensureInputFlow() {
    if (!this._inputFlow) {
      this._inputFlow = new SceneInputFlow({
        inputManager: this.inputManager,
        runtime: this.sceneRuntime,
        router: this.sceneRuntime?.inputRouter,
        gamepadCombat: this.gamepadCombat,
        onModalInput: context => this.handleModalInput(context),
        onPopupConfirm: context => this._handleGainedPopupInput(context),
        onGamepadCombat: () => this._updateGamepadCombat(),
        onGamepadCombatCancel: ({ reason }) => (
          this._ensureCombatActions().cancelGamepadCombatInput(reason)
        ),
        onLocomotionInput: event => this.jumpByInput({ event }),
        chargedJump: {
          canHandle: event => this.jumpChargeController?.canSelectTarget?.(event) === true,
          handleInput: event => this.jumpChargeController?.selectTarget?.(event.world) !== null
        },
        dialogue: this._ensureDialogueFlow(),
        aiming: this._ensureSkillActions(),
        triggerBindings: this._sceneTriggerBindings,
        getNpcInteraction: () => this.context?.services?.npcInteraction || null,
        worldInteraction: this._ensureWorldInteraction()
      });
    }
    return this._inputFlow;
  }

  /** 子场景可覆盖的模态输入出口；返回 true 时本帧所有世界输入均被消费。 */
  handleModalInput(_context) {
    return false;
  }

  /** 子场景在 super.update 前读取输入时调用；同帧重复调用由 flow 守卫跳过。 */
  _beginInputFrame(deltaTime) {
    return this._ensureInputFlow().beforeFrame(deltaTime);
  }

  /** @private 背包、装备和获得物品统一流程。 */
  _ensureInventoryFlow() {
    if (!this._inventoryFlow) {
      this._inventoryFlow = new SceneInventoryFlow({
        equipmentFlow: this._ensureEquipmentFlow(),
        itemGainedFlow: this._ensureItemGainedFlow(),
        getPlayer: () => this.playerEntity,
        getBackpack: () => this.backpackPanel,
        getFloatingText: () => this.floatingTextManager,
        getNotification: () => this.notificationSystem,
        executeIntent: (intentType, payload, options) => this.submitItemIntent(intentType, payload, options),
        onEquipmentChanged: (messages, info) => this.onEquipmentChanged(messages, info),
        onItemUsedEvent: ({ id, item }) => this.gameLoader?.triggerSystem?.fire('itemUsed', { id, item })
      });
    }
    return this._inventoryFlow;
  }

  /** @private HUD 更新器只读取显式 UI/System/World 投影。 */
  _ensureHudUpdater() {
    if (!this._hudUpdater) {
      this._hudUpdater = new SceneHudUpdater({
        getUI: () => ({
          backpack: this.backpackPanel,
          itemGainedPopup: this.itemGainedPopup,
          bottomControlBar: this.bottomControlBar,
          playerStatusHUD: this.playerStatusHUD,
          gamepadPanel: this.gamepadPanel,
          dialogueBox: this.dialogueBox,
          minimap: this.minimap,
          flightButton: this.flightButton,
          throwButton: this.throwButton,
          blockButton: this.blockButton,
          updatePanelHover: () => this.updatePanelHover()
        }),
        getSystems: () => ({
          flight: this.flightSystem,
          weaponRenderer: this.weaponRenderer,
          combat: this.combatSystem,
          dialogue: this.dialogueSystem
        }),
        getWorld: () => ({
          terrainBinding: this._terrainBinding,
          region: this._worldRegion,
          camera: this.camera
        }),
        getContext: () => this.context,
        getPlayer: () => this.playerEntity,
        getEntities: () => this.entities,
        performanceOptimizer: this.performanceOptimizer
      });
    }
    return this._hudUpdater;
  }

  /** @private 懒创建物品获得队列服务。 */
  _ensureItemGainedFlow() {
    if (!this._itemGainedFlow) {
      this._itemGainedFlow = new SceneItemGainedFlow(this, {
        getEquipmentFlow: () => this._ensureEquipmentFlow(),
        executeIntent: (intentType, payload, options) => this.submitItemIntent(intentType, payload, options),
        onEquipmentChanged: (messages, info) => this.onEquipmentChanged(messages, info),
        onQueueDrained: () => this.gameLoader?.triggerSystem?.fire('gainedPopupClosed', {})
      });
    }
    return this._itemGainedFlow;
  }

  /** @private 懒创建统一瞄准预览状态。 */
  _ensureAimPresentation() {
    if (!this._aimPresentation) this._aimPresentation = new SceneAimPresentation(this);
    return this._aimPresentation;
  }

  /** @private 懒创建场景 HUD 组合与布局协调器。 */
  _ensurePanelLayout() {
    if (!this._panelLayout) {
      this._panelLayout = new ScenePanelLayout(this, {
        BackpackPanel,
        BottomControlBar,
        PlayerStatusHUD,
        IconButton,
        DialogueBox,
        NotificationSystem,
        ItemGainedPopup,
        GamepadPanel,
        GamepadCombatController,
        SkillWheelOverlay,
        Minimap,
        SelectedCharacterStore,
        PortraitsConfig
      });
    }
    return this._panelLayout;
  }

  /** @private 懒创建场景战斗动作服务。 */
  _ensureCombatActions() {
    if (!this._combatActions) this._combatActions = new SceneCombatActions(this);
    return this._combatActions;
  }

  /** @private 懒创建对话输入服务。 */
  _ensureDialogueFlow() {
    if (!this._dialogueFlow) this._dialogueFlow = new SceneDialogueFlow(this);
    return this._dialogueFlow;
  }

  /** @private 懒创建世界与 UI 点击交互服务。 */
  _ensureWorldInteraction() {
    if (!this._worldInteraction) this._worldInteraction = new SceneWorldInteraction(this);
    return this._worldInteraction;
  }

  /** @private 懒创建技能释放与瞄准服务。 */
  _ensureSkillActions() {
    if (!this._skillActions) this._skillActions = new SceneSkillActions(this);
    return this._skillActions;
  }

  /** @private 懒创建通用世界表现服务。 */
  _ensureWorldPresentation() {
    if (!this._worldPresentation) {
      this._worldPresentation = new SceneWorldPresentation(this, {
        getRenderOffset: item => this.context?.presentation?.worldItemEvents?.getRenderOffset?.(item)
          || { x: 0, y: 0 }
      });
    }
    return this._worldPresentation;
  }

  /** 检查技能是否可用（蓝量/冷却），不足则飘字提示 */
  checkSkillUsable(skill) {
    return this._ensureSkillActions().checkSkillUsable(skill);
  }

  /** 按技能索引释放技能（用于触屏/虚拟按钮，无鼠标指向时按角色朝向放） */
  useSkillByIndex(index) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureSkillActions().useSkillByIndex(index);
  }

  /** 按指定方向和距离比例释放技能（触屏摇杆瞄准后释放） */
  useSkillByDirection(index, dirX, dirY, distRatio, targetWorldPos) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureSkillActions().useSkillByDirection(
      index, dirX, dirY, distRatio, targetWorldPos);
  }

  /**
   * 设置技能瞄准预览（拖动期间每帧调用,更新落点位置）
   * @param {number} index - 技能索引
   * @param {number} dirX - 方向 X
   * @param {number} dirY - 方向 Y
   * @param {number} distRatio - 拖拽距离占瞄准圈的比例(0~1+),1=最大射程
   * @param {Object} [anchorPos] - 锚点位置(世界坐标),用于固定预览圈到世界中（玩家移动时预览圈不动）
   */
  setSkillAimPreview(index, dirX, dirY, distRatio, anchorPos) {
    return this._ensureSkillActions().setAimPreview(index, dirX, dirY, distRatio, anchorPos);
  }

  /**
   * 清除技能瞄准预览
   */
  clearSkillAimPreview() {
    return this._ensureSkillActions().clearAimPreview();
  }

  /**
   * 进入 PC 瞄准模式（技能3/4/5、轻功、投掷按下时调用，不直接触发）
   * @param {'skill'|'flight'|'throw'} kind
   * @param {number} [index] - 技能索引（kind==='skill' 时用）
   */
  enterPCAimMode(kind, index = -1) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureSkillActions().enterPCAimMode(kind, index);
  }

  /** 取消 PC 瞄准模式 */
  cancelPCAimMode() {
    return this._ensureSkillActions().cancelPCAimMode();
  }

  /** 兼容入口：瞄准控制器由 SceneSkillActions 拥有。 @private */
  _ensureAimController() {
    return this._ensureSkillActions().ensureController();
  }

  /** 每帧更新 PC 瞄准模式。 */
  updatePCAimMode() {
    return this._ensureSkillActions().updatePCAimMode();
  }

  /**
   * 判断鼠标屏幕坐标是否落在底部功能按钮/技能栏区域
   * @param {number} sx
   * @param {number} sy
   * @returns {boolean}
   */
  _isMouseOverBottomUI(sx, sy) {
    return this._ensureSkillActions().isMouseOverBottomUI(sx, sy);
  }

  /**
   * 渲染技能瞄准预览虚线框（在世界坐标系中,由 render 调用）
   * @param {CanvasRenderingContext2D} ctx
   */
  renderSkillAimPreview(ctx) {
    return this._ensureSkillActions().renderAimPreview(ctx);
  }

  /**
   * 获取玩家当前朝向单位向量（用于触屏按钮无指向时的目标方向）
   * @returns {{x:number, y:number}}
   */
  getPlayerFacingVector() {
    const sprite = this.playerEntity?.getComponent('sprite');
    const dirMap = {
      'up': { x: 0, y: -1 },
      'down': { x: 0, y: 1 },
      'left': { x: -1, y: 0 },
      'right': { x: 1, y: 0 },
      'up-left': { x: -0.707, y: -0.707 },
      'up-right': { x: 0.707, y: -0.707 },
      'down-left': { x: -0.707, y: 0.707 },
      'down-right': { x: 0.707, y: 0.707 },
    };
    return dirMap[sprite?.direction] || { x: 1, y: 0 };
  }

  /** 触屏：按角色朝向发起一次扇形攻击。 */
  attackByFacing() {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().attackByFacing() === true;
  }

  /** 触屏：按指定方向发起扇形攻击。 */
  attackByDirection(dirX, dirY, distRatio) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().attackByDirection(dirX, dirY, distRatio) === true;
  }

  /** 虚拟按钮通过 InputActionRouter 入队，和键盘/手柄共享消费优先级。 */
  enqueueLocomotionInput(key = 'jump') {
    this.sceneRuntime?.inputRouter?.enqueueKey?.(key);
    return true;
  }

  /** 子场景可按世界对象语义解析攀爬目标。 */
  resolveClimbTarget(_request = {}) {
    return null;
  }

  /**
   * 键盘/手柄保持键由帧管线开始蓄力；虚拟跳跃按钮进入持续点选模式。
   * @param {{event?:Object}} options
   * @returns {boolean}
   */
  jumpByInput({ event } = {}) {
    if (this.isPlayerActionLocked()) return false;
    if (event?.device === 'virtual') {
      return this.jumpChargeController?.beginTargeting?.(this.playerEntity) === true;
    }
    return true;
  }

  /** 触屏跳跃按钮：设置按住状态，驱动蓄力轮询。 */
  setJumpHeld(held) {
    this._jumpHeld = !!held;
  }

  /** 按指定方向起跳；chargeDistance > 0 时使用蓄力距离（30~120px），否则用默认距离。 */
  jumpByDirection(dirX, dirY, chargeDistance = 0) {
    if (this.isPlayerActionLocked()) return false;
    const started = this._ensureCombatActions().jumpByDirection(dirX, dirY, chargeDistance) === true;
    if (started) {
      const tutorialFlow = this.context?.services?.tutorialFlow;
      if (tutorialFlow) tutorialFlow.notify('jumpPerformed');
      else this.onPlayerTutorialAction?.('jump');
    }
    return started;
  }

  /** 触屏：按角色朝向施展轻功。 */
  flightByFacing() {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().flightByFacing();
  }

  /** 触屏：按指定方向施展轻功。 */
  flightByDirection(dirX, dirY, distRatio) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().flightByDirection(dirX, dirY, distRatio);
  }

  /** 触屏：按角色朝向投掷武器。 */
  throwByFacing() {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().throwByFacing();
  }

  /** 触屏：按指定方向投掷武器。 */
  throwByDirection(dirX, dirY, distRatio) {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().throwByDirection(dirX, dirY, distRatio);
  }

  /** 触屏：激活主动格挡（挡住攻击1秒，冷却8秒）。 */
  activateBlock() {
    if (this.isPlayerActionLocked()) return false;
    return this._ensureCombatActions().activateBlock();
  }

  /** 从快捷栏使用药水。 */
  usePotionFromHotbar(potionType) {
    return this._ensureCombatActions().usePotionFromHotbar(potionType);
  }

  /**
   * 相机更新后的通用后处理：存在 ProjectWorldIndex 时限制在活动 Region 边界，
   * 其他游戏/编辑器场景因缺少 worldIndex 自动 no-op。
   */
  postCameraUpdate() {
    return this.clampCameraToWorldBounds?.() || false;
  }

  /** PC 功能按钮（轻功/投掷/格挡/背包）作为一组水平居中。 */
  layoutPCFunctionButtons(width, height) {
    return this._ensurePanelLayout().layoutPCFunctionButtons(width, height);
  }

  /** 窗口大小变化：采用宿主给出的运行时逻辑视口，缺省时回退参考分辨率。 */
  onResize(width, height) {
    const fallback = this.presentationProfile.logicalResolution;
    const nextWidth = Number(width) > 0 ? Math.floor(width) : fallback.width;
    const nextHeight = Number(height) > 0 ? Math.floor(height) : fallback.height;
    return this._ensurePanelLayout().onResize(nextWidth, nextHeight);
  }

  /**
   * 创建玩家实体 - 子类可覆盖
   */
  createPlayerEntity(data = {}) {
    if (!this.playerLifecycle) {
      throw new Error('BaseGameScene: player lifecycle is not initialized');
    }
    this.playerEntity = this.playerLifecycle.createOrInherit(data);
    return this.playerEntity;
  }

  /**
   * 绑定UI面板到玩家实体（兼容入口，委托给场景 HUD 组合器）
   */
  bindUIPanelsToPlayer(player = this.playerEntity, options = {}) {
    return this._ensurePanelLayout().bindPlayer(player, options);
  }

  /**
   * 底部小型弹窗的设备无关模态输入入口。
   * 空间交互选择优先于物品获得弹窗，两者都由 SceneInputFlow 阻断世界输入。
   * @returns {boolean} 弹窗是否接管本帧输入
   * @private
   */
  _handleGainedPopupInput(context = {}) {
    const inputManager = context.inputManager || this.inputManager;
    const gamepad = context.gamepad || this.inputManager?.gamepad;
    if (this.interactionChoiceView?.visible) {
      return this.interactionChoiceView.handleInput({
        inputManager,
        gamepad,
        viewWidth: this.logicalWidth,
        viewHeight: this.logicalHeight
      }) === true;
    }
    return this.itemGainedPopup?.handleInput?.({ inputManager, gamepad }) === true;
  }

  /** 手柄战斗控制器每帧驱动：产出意图并执行对应操作。 */
  _updateGamepadCombat() {
    return this._ensureCombatActions().updateGamepadCombat();
  }

}

export default BaseGameSceneBehaviors;

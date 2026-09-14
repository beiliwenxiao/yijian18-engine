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
import { PadButton } from '../../../src/core/input/Xbox360Profile.js';
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
import { SceneApplicationEventBridge } from '../../../src/core/scene/SceneApplicationEventBridge.js';
import { SceneWorldItemEventPresenter } from '../../../src/core/scene/SceneWorldItemEventPresenter.js';
import { ScenePanelLayout } from '../../../src/core/scene/ScenePanelLayout.js';
import { SceneRenderPipeline } from '../../../src/core/scene/SceneRenderPipeline.js';
import { SceneFramePipeline } from '../../../src/core/scene/SceneFramePipeline.js';
import { PausableClock } from '../../../src/core/scene/PausableClock.js';
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
import { createEntitySpatialTarget } from '../../../src/core/scene/SceneSpatialGeometry.js';
import { SceneInputFlow } from '../../../src/core/input/SceneInputFlow.js';
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

const ZONE_STAT_NAMES = Object.freeze({ hp: '生命', mp: '法力', attack: '攻击', defense: '防御', speed: '速度' });

export const CAMPAIGN_ID = 'sanguo-zhangjiao-s01-s14';
export const SAVE_SCHEMA_VERSION = 3;
const CANONICAL_SCENE_ID = /^S(?:0[1-9]|1[0-4])(?:-C\d{2})?$/;
const LEGACY_SCENE_ID = /^(?:s\d+-\d+|scene_Prologue)$/;

function findLegacySavePath(value, path = '') {
  if (value === 'mage' || (typeof value === 'string' && LEGACY_SCENE_ID.test(value))) return path;
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'act' || key === 'currentAct' || /^act\d/i.test(key)) return childPath;
    const legacyPath = findLegacySavePath(child, childPath);
    if (legacyPath) return legacyPath;
  }
  return null;
}
const ZONE_STAT_SHORT = Object.freeze({ hp: 'HP', mp: 'MP', attack: 'ATK', defense: 'DEF', speed: 'SPD' });

export class BaseGameSceneSetup extends Scene {
  constructor(sceneData = {}) {
    super(sceneData.name || 'DataDrivenPrologueScene');
    this.isPaused = false;
    this.simulationClock = new PausableClock();
    // 独立于系统菜单暂停；技能轮盘仍需在暂停期间持续轮询 LB 松开沿。
    this.isSkillWheelWorldPaused = false;
    this.sceneManager = null;
    
    // ECS 核心：SceneEntityStore 是所有场景集合的唯一所有者，平铺字段仅作稳定投影。
    this.itemRuntimeFactory = new ItemRuntimeFactory({
      getDefinitionRepository: () => this.gameLoader?.definitionRepository || null
    });
    this.entityFactory = new EntityFactory({ itemRuntimeFactory: this.itemRuntimeFactory });
    this._playerFactory = new DemoPlayerFactory();
    this.entityStore = new SceneEntityStore();
    this.entities = this.entityStore.all;
    this.enemyEntities = this.entityStore.enemies;
    this.pickupItems = this.entityStore.pickups;
    this.equipmentItems = this.entityStore.equipmentItems;
    this.context = new GameSceneContext({ entities: this.entityStore });
    this._gameplaySnapshots = new SceneGameplaySnapshotRuntime({
      context: this.context,
      getPlayer: () => this.context.player.entity,
      getEntities: () => this.context.entities.all
    });
    this._deathDrops = new SceneDeathDropRuntime({
      itemRuntimeFactory: this.itemRuntimeFactory,
      entityStore: this.entityStore,
      getPresentation: entry => this.getDeathDropPresentation?.(entry) || {}
    });
    Object.assign(this.context.services, {
      gameplaySnapshots: this._gameplaySnapshots,
      deathDrops: this._deathDrops
    });
    this.resourceScope = null;
    this.playerLifecycle = null;
    this._lifecycleCoordinator = null;
    this._inputBindings = null;
    this._inputFlow = null;
    this._sceneTriggerBindings = null;
    this._inventoryFlow = null;
    this._hudUpdater = null;
    this._hintPresenter = null;
    
    // canonical 场景只保存 presentationProfile ID；只有内联对象才可覆盖正式配置。
    // 把字符串 ID 直接传给规范化器会退回默认值并丢失当前表现配置。
    const inlinePresentationProfile = sceneData.presentationProfile;
    this.presentationProfile = normalizePresentationProfile(
      inlinePresentationProfile && typeof inlinePresentationProfile === 'object' && !Array.isArray(inlinePresentationProfile)
        ? inlinePresentationProfile
        : presentationProfileData
    );
    this.logicalWidth = this.presentationProfile.logicalResolution.width;
    this.logicalHeight = this.presentationProfile.logicalResolution.height;
    
    // 调试模式只投影 RuntimeConfig 的规范化结果，不再作为独立事实源。
    this.debugMode = false;

    // Terrain 实例由唯一世界流式会话使用 canonical chunk 数据创建。
    this.terrain = null;
    this.editorSceneId = sceneData.editorSceneId || 'S01';
    this._terrainBinding = new SceneTerrainBinding({
      scene: this,
      EffectZoneRenderer,
      SceneTerrainCollision
    });
    this.context.world.terrainBinding = this._terrainBinding;

    // 调试面板、性能采样和 Canvas 观测由框架诊断服务统一管理。
    this._diagnostics = new SceneDiagnostics(this);
    this._battleFlowRegistry = new SceneBattleFlowRegistry();
    Object.assign(this.context.services, {
      diagnostics: this._diagnostics,
      battleFlows: this._battleFlowRegistry
    });
    
    // 核心系统
    this.inputManager = null;
    this.camera = null;
    this.combatSystem = null;
    this.movementSystem = null;
    this.equipmentSystem = null;
    this.aiSystem = null;
    this.isometricRenderer = null;  // 统一渲染器
    this.entityRenderer2D = null;
    this.combatEffects = null;
    this.skillEffects = null;
    this.weaponRenderer = null;
    this.enemyWeaponRenderer = null;
    this.flightSystem = null;
    this.jumpSystem = null;
    this.collisionSystem = null;
    this.pickupSystem = null;
    this.meditationSystem = null;
    this.zoneEffectSystem = null;
    
    // 扇形攻击系统（由 MeleeAttackSystem 管理）
    this.meleeAttackSystem = null;
    
    // 实体生命周期系统
    this.entityLifecycleSystem = new EntityLifecycleSystem();
    
    this.uiClickHandler = new UIClickHandler();
    
    // UI 系统（面板生命周期管理）
    this.uiSystem = new UISystem();
    
    // 序章系统
    this.tutorialSystem = new TutorialSystem();
    this.dialogueSystem = new DialogueSystem();
    this.questSystem = new QuestTransactionService({
      getDefaultActorId: () => this.playerEntity?.id || null,
      createCheckpoint: ({ operationId, questId }) => this.requestAutoSave({
        reason: 'questTransaction', operationId, questId
      })
    });
    
    // UI 面板
    this.backpackPanel = null;
    // 兼容旧场景/系统对三个面板字段的访问；它们都指向唯一组合背包。
    this.inventoryPanel = null;
    this.playerInfoPanel = null;
    this.equipmentPanel = null;
    this.bottomControlBar = null;
    this.playerStatusHUD = null;
    this.dialogueBox = null;
    
    // UI 装配策略（按平台分桌面/移动两套），收敛平台差异
    this.uiStrategy = createUIStrategy();
    // 兼容字段：是否移动端布局（部分旧逻辑仍引用）
    this.isMobileLayout = this.uiStrategy.platform === 'mobile';
    
    // 飘动文字管理器
    this.floatingTextManager = new FloatingTextManager();
    
    // 粒子系统
    this.particleSystem = new ParticleSystem(500);
    
    // 特效区域只由世界加载结果中的已投影 effectZones 装配。
    this.effectZoneRenderer = null;
    
    // 等距渲染器
    this.isometricRenderer = null;
    
    // 等距地图数据
    this.mapData = null;
    this.mapWidth = 30;  // 地图宽度（格子数）
    this.mapHeight = 30; // 地图高度（格子数）
    
    // 玩家实体
    this.playerEntity = null;

    // 教程状态
    this.tutorialPhase = 'init';
    
    // 对话控制标志
    this.lastSpacePressed = false;
    
    // 技能瞄准预览（手机拖拽技能时显示落点虚线框）
    this.skillAimPreview = null; // { skill, targetX, targetY, startX, startY, inRange, color } 或 null
    // 平滑过渡用的显示位置（lerp）
    this._aimDisplayX = 0;
    this._aimDisplayY = 0;
    // 瞄准参数缓存（每帧刷新用）
    this._aimDirX = 0;
    this._aimDirY = 0;
    this._aimDistRatio = 0;

    // PC 瞄准模式由框架的 SceneAimController 管理（懒创建于 _ensureAimController）
    this._aimController = null;
    
    // 世界与 HUD 渲染顺序交由核心渲染管线协调
    this._renderPipeline = null;

    // 每帧更新顺序交由核心帧管线协调
    this._framePipeline = null;
    // 生命周期、阶段钩子与 disposer 由通用运行时管理；旧系统链仍由帧管线保持原顺序。
    this.sceneRuntime = null;
    this._itemGainedFlow = null;
    this._aimPresentation = null;

    // 场景 UI 布局协调器按需创建，集中处理配置加载、缩放与 Canvas/DOM 层级联动
    this._panelLayout = null;

    // 场景战斗动作服务按需创建，只承接攻击、轻功、投掷、格挡和药水动作。
    this._combatActions = null;
    // 输入与交互职责由独立服务拥有；Base 仅保留兼容转发入口。
    this._dialogueFlow = null;
    this._worldInteraction = null;
    this._skillActions = null;
    this._worldPresentation = null;

    // 通用玩法系统由框架装配器集中创建、接线和释放。
    this._gameplaySystemAssembler = new SceneGameplaySystemAssembler(this);

    // 场景过渡：状态机与绘制由框架的 SceneTransitionFlow 承担
    this._transition = new SceneTransitionFlow({
      fadeDuration: 2.0,
      textDuration: 3.0,
      onSwitch: () => this.switchToNextScene()
    });

    // 宿主页面注入系统菜单；检查点持久化只借用 SaveGameService。
    this._systemMenuCallback = null;
    this._saveGameService = null;
  }

  configureSceneBattleFlows(sceneDataList, battleDefinitions = null) {
    return this._battleFlowRegistry.registerMany(sceneDataList, battleDefinitions);
  }

  getBattleFlowByScene(sceneId = this.currentSceneId) {
    return this._battleFlowRegistry.getBySceneId(sceneId);
  }

  getBattleFlowById(battleId) {
    return this._battleFlowRegistry.getByBattleId(battleId);
  }

  getBattleFlows() {
    return this._battleFlowRegistry.list();
  }

  setSceneManager(sceneManager) {
    this.sceneManager = sceneManager;
  }

  setSystemMenuCallback(callback) {
    this._systemMenuCallback = typeof callback === 'function' ? callback : null;
  }

  openSystemMenu() {
    if (this._systemMenuCallback) return this._systemMenuCallback(this);
    return globalThis.__openSystemMenu?.(this);
  }

  setSaveGameService(service) {
    this._saveGameService = service || null;
  }

  requestAutoSave(context = {}) {
    return this._saveGameService?.requestAutoSave?.(context)
      || Promise.resolve({ ok: false, code: 'saveGameServiceUnavailable' });
  }

  requestCheckpointLoad(checkpointId) {
    return this._saveGameService?.loadCheckpoint?.(checkpointId)
      || Promise.resolve({ ok: false, code: 'saveGameServiceUnavailable' });
  }

  /** 采集可序列化的通用游戏状态，供 SnapshotManager 原子存档。 */
  captureSaveState() {
    const player = this.playerEntity;
    const transform = player?.getComponent?.('transform');
    const stats = player?.getComponent?.('stats');
    const inventory = player?.getComponent?.('inventory');
    const equipment = player?.getComponent?.('equipment');
    const name = player?.getComponent?.('name');
    const statsFields = [
      'baseMaxHp', 'baseMaxMp', 'baseMaxStamina', 'baseStaminaRegen', 'baseAttack', 'baseDefense', 'baseSpeed',
      'maxHp', 'hp', 'maxMp', 'mp', 'maxStamina', 'stamina', 'staminaRegen', 'attack', 'defense', 'speed', 'level', 'exp',
      'mainElement', 'elementAttack', 'elementDefense', 'unitType', 'gold', 'attributeEffects',
      'class', 'skillPoints'
    ];
    const statsData = {};
    for (const key of statsFields) {
      if (stats && stats[key] !== undefined) statsData[key] = stats[key];
    }

    const snapshot = JSON.parse(JSON.stringify({
      campaignId: CAMPAIGN_ID,
      schemaVersion: SAVE_SCHEMA_VERSION,
      currentSceneId: this.currentSceneId || this.editorSceneId || 'S01',
      player: {
        id: player?.id || null,
        name: name ? { name: name.name, visible: name.visible, color: name.color } : null,
        transform: transform ? {
          x: transform.position.x,
          y: transform.position.y,
          elevation: transform.position.elevation || 0,
          rotation: transform.rotation || 0,
          scale: { ...transform.scale },
          floorId: transform.floorId || 'ground'
        } : null,
        stats: statsData,
        inventory: (() => {
          inventory?.setDefinitionResolver?.(id => this.gameLoader?.definitionRepository?.get('items', id)
            || this.gameLoader?.definitionRepository?.get('equipment', id));
          return inventory?.exportRuntimeStates?.() || inventory?.exportItems?.() || [];
        })(),
        equipment: (() => {
          equipment?.setDefinitionResolver?.(id => this.gameLoader?.definitionRepository?.get('items', id)
            || this.gameLoader?.definitionRepository?.get('equipment', id));
          return equipment?.exportRuntimeState?.() || equipment?.exportEquipment?.() || {};
        })()
      },
      tutorial: this.tutorialSystem?.saveProgress?.() || null,
      dialogue: this.dialogueSystem?.saveState?.() || null,
      quests: this.questSystem?.serialize?.() || null,
      content: this.gameLoader?.serialize?.(player?.id || null) || null,
      scene: this.captureSceneSaveState()
    }));
    const validation = this.validateSaveState(snapshot);
    if (!validation.ok) {
      const error = new Error('拒绝生成包含旧剧情或非法 canonical 状态的新存档');
      error.name = 'InvalidSaveStateError';
      error.errors = validation.errors;
      throw error;
    }
    return snapshot;
  }

  validateSaveState(data) {
    const errors = [];
    const incompatible = (path) => errors.push({
      code: 'incompatibleSave',
      path,
      message: '版本不兼容，请开始新游戏'
    });

    if (!data || typeof data !== 'object') {
      errors.push({ code: 'missingField', path: '', message: '游戏状态为空' });
      return { ok: false, errors };
    }
    if (data.campaignId !== CAMPAIGN_ID) incompatible('campaignId');
    if (data.schemaVersion !== SAVE_SCHEMA_VERSION) incompatible('schemaVersion');
    if (!CANONICAL_SCENE_ID.test(data.currentSceneId || '')) incompatible('currentSceneId');
    const legacyPath = findLegacySavePath(data);
    if (legacyPath) incompatible(legacyPath);

    if (data.scene?.timeState != null) {
      const timeSystem = this.timeSystem;
      if (typeof timeSystem?.validateSerialized !== 'function') {
        errors.push({
          code: 'timeRuntimeUnavailable',
          path: 'scene.timeState',
          message: '昼夜运行时尚未就绪'
        });
      } else {
        const timeCheck = timeSystem.validateSerialized(data.scene.timeState);
        errors.push(...(timeCheck.errors || []).map(error => ({
          ...error,
          path: error.path ? `scene.timeState.${error.path}` : 'scene.timeState'
        })));
      }
    }

    if (!data.content || typeof data.content !== 'object' || Array.isArray(data.content)) {
      errors.push({ code: 'missingField', path: 'content', message: '缺少游戏内容状态' });
    } else if (typeof this.gameLoader?.validateSerialized === 'function') {
      const contentCheck = this.gameLoader.validateSerialized(data.content, data.player?.id || null);
      const incompatibleTriggerCodes = new Set([
        'invalidSnapshotSchema',
        'definitionDigestMismatch',
        'definitionRevisionMismatch',
        'invalidFingerprint'
      ]);
      for (const error of contentCheck.errors || []) {
        const path = `content.${error.path || ''}`.replace(/\.$/, '');
        const triggerIncompatible = error.path?.startsWith('triggers.')
          && incompatibleTriggerCodes.has(error.code);
        errors.push(triggerIncompatible ? {
          ...error,
          code: 'incompatibleSave',
          originalCode: error.code,
          path,
          message: '版本不兼容，请开始新游戏'
        } : { ...error, path });
      }
    }

    if (!data.player || typeof data.player !== 'object') {
      errors.push({ code: 'missingField', path: 'player', message: '缺少玩家状态' });
    } else if (data.player.transform && (!Number.isFinite(data.player.transform.x) || !Number.isFinite(data.player.transform.y))) {
      errors.push({ code: 'invalidField', path: 'player.transform', message: '玩家坐标无效' });
    }
    if (data.player && this.gameLoader?.definitionRepository) {
      const inventoryStates = Array.isArray(data.player.inventory) ? data.player.inventory : [];
      const equipmentStates = Object.values(data.player.equipment || {}).filter(Boolean);
      const itemCheck = this.itemRuntimeFactory.validateRuntimeStates(
        [...inventoryStates, ...equipmentStates], 'player.items'
      );
      errors.push(...itemCheck.errors);
    }
    if (Array.isArray(data.scene?.deathDrops)) {
      const dropCheck = this._deathDrops.validate(data.scene.deathDrops);
      errors.push(...(dropCheck.errors || []).map(error => ({ ...error, path: `scene.${error.path}` })));
    }
    return { ok: errors.length === 0, errors };
  }

  /** 读档替换表现前清空瞬态队列；不得触发旧提示的完成回调。 */
  _clearTransientPresentationForRestore() {
    this._hintPresenter?.clearForRestore?.();
    this._itemGainedFlow?.cancel?.();
    this.itemGainedPopup?.hide?.();
    this.interactionChoiceView?.close?.();
  }

  /** 恢复通用状态；调用前应等待世界与 GameLoader 初始化完成。 */
  restoreSaveState(data) {
    const check = this.validateSaveState(data);
    if (!check.ok) return check;
    const player = this.playerEntity;
    if (!player) return { ok: false, errors: [{ code: 'missingPlayer', path: 'player', message: '玩家尚未创建' }] };

    let rollbackSnapshot;
    try {
      rollbackSnapshot = this.captureSaveState();
    } catch (error) {
      return {
        ok: false,
        errors: error?.errors || [{
          code: 'rollbackCaptureFailed',
          path: '',
          message: error?.message || '恢复前状态采集失败'
        }]
      };
    }

    const apply = snapshot => {
      try {
        this._clearTransientPresentationForRestore();
        const result = this._applyValidatedSaveState(snapshot);
        return result?.ok === false ? result : { ok: true, errors: [] };
      } catch (error) {
        return {
          ok: false,
          errors: error?.errors || [{
            code: 'saveRestoreFailed',
            path: '',
            message: error?.message || String(error)
          }]
        };
      }
    };

    const result = apply(data);
    if (result.ok) return result;

    const rollback = apply(rollbackSnapshot);
    if (!rollback.ok) {
      return {
        ok: false,
        errors: [
          ...(result.errors || []),
          ...(rollback.errors || []).map(error => ({
            ...error,
            code: error.code || 'saveRestoreRollbackFailed',
            path: error.path ? `rollback.${error.path}` : 'rollback'
          }))
        ]
      };
    }
    return result;
  }

  _applyValidatedSaveState(data) {
    const player = this.playerEntity;
    const transform = player.getComponent('transform');
    const stats = player.getComponent('stats');
    const inventory = player.getComponent('inventory');
    const equipment = player.getComponent('equipment');
    const name = player.getComponent('name');
    const savedPlayer = data.player;
    if (name && savedPlayer.name) {
      name.name = savedPlayer.name.name || name.name;
      name.visible = savedPlayer.name.visible !== false;
      name.color = savedPlayer.name.color || name.color;
    }
    if (transform && savedPlayer.transform) {
      transform.setPosition(savedPlayer.transform.x, savedPlayer.transform.y, savedPlayer.transform.elevation || 0);
      transform.rotation = savedPlayer.transform.rotation || 0;
      if (savedPlayer.transform.scale) transform.setScale(savedPlayer.transform.scale.x, savedPlayer.transform.scale.y);
      transform.floorId = savedPlayer.transform.floorId || 'ground';
      this.camera?.setPosition?.(savedPlayer.transform.x, savedPlayer.transform.y);
    }
    if (equipment && savedPlayer.equipment) {
      for (const slot of Object.keys(equipment.slots)) equipment.slots[slot] = null;
      equipment.setDefinitionResolver?.(id => this.gameLoader?.definitionRepository?.get('items', id)
        || this.gameLoader?.definitionRepository?.get('equipment', id));
      equipment.loadEquipment(savedPlayer.equipment);
    }
    if (stats && savedPlayer.stats) {
      const hasSavedClass = Object.prototype.hasOwnProperty.call(savedPlayer.stats, 'class')
        && savedPlayer.stats.class != null;
      if (!hasSavedClass) {
        delete stats.class;
        delete player.class;
      }
      Object.assign(stats, JSON.parse(JSON.stringify(savedPlayer.stats)));
      if (hasSavedClass) player.class = savedPlayer.stats.class;
    }
    if (inventory && Array.isArray(savedPlayer.inventory)) {
      inventory.setDefinitionResolver?.(id => this.gameLoader?.definitionRepository?.get('items', id)
        || this.gameLoader?.definitionRepository?.get('equipment', id));
      inventory.loadItems(savedPlayer.inventory);
    }

    this.tutorialSystem?.loadProgress?.(data.tutorial);
    this.questSystem?.reset?.();
    this.questSystem?.deserialize?.(data.quests || {});
    const contentResult = this.gameLoader?.deserialize?.(data.content, player.id);
    if (contentResult && contentResult.ok === false) {
      return {
        ok: false,
        errors: (contentResult.errors || []).map(error => ({
          ...error,
          path: `content.${error.path || ''}`.replace(/\.$/, '')
        }))
      };
    }
    this.dialogueSystem?.reset?.();
    this.dialogueSystem?.loadState?.(data.dialogue, { player, scene: this });
    this.currentSceneId = data.currentSceneId;
    const sceneResult = this.restoreSceneSaveState(data.scene || {});
    if (sceneResult && sceneResult.ok === false) {
      return {
        ok: false,
        errors: (sceneResult.errors || []).map(error => ({
          ...error,
          path: `scene.${error.path || ''}`.replace(/\.$/, '')
        }))
      };
    }
    const tutorialRestored = this.tutorialSystem?.restorePresentation?.(data.tutorial, {
      scope: { sceneId: this.currentSceneId },
      source: 'saveRestore'
    }) === true;
    if (!tutorialRestored) this._s01s02Coordinator?.projectRestoredProgress?.();
    this._tutorialFlow?.resetMovementOrigin?.(
      player.getComponent?.('transform')?.position || null
    );
    this.bindUIPanelsToPlayer(player, { syncCameraPosition: false, log: false });
    return { ok: true, errors: [] };
  }

  /** 子场景覆盖以补充剧情/世界状态。 */
  captureSceneSaveState() { return {}; }

  /** 子场景覆盖以恢复剧情/世界状态。 */
  restoreSceneSaveState(_data) {}

  discardPausedInput() {
    this.inputManager?.clear?.();
    this._inputFlow?.releaseFrame?.();
  }

  pause() {
    if (this.isPaused) return false;
    this.simulationClock?.pause?.();
    this.isPaused = true;
    this.discardPausedInput();

    const audioManager = this.audioManager || this.assetManager?.getAudioManager?.() || null;
    this._pausedAudioManager = audioManager;
    this._pausedAudioWasMuted = audioManager?.muted === true;
    this._pausedMusicWasPlaying = !!audioManager?.currentMusic && !audioManager.currentMusic.paused;
    if (audioManager && !this._pausedAudioWasMuted) audioManager.setMuted?.(true);
    return true;
  }

  resume() {
    if (!this.isPaused) return false;

    const audioManager = this._pausedAudioManager || this.audioManager || this.assetManager?.getAudioManager?.() || null;
    if (audioManager && !this._pausedAudioWasMuted) {
      audioManager.setMuted?.(false);
      if (!this._pausedMusicWasPlaying) audioManager.pauseMusic?.();
    }
    this._pausedAudioManager = null;
    this._pausedAudioWasMuted = false;
    this._pausedMusicWasPlaying = false;
    this.simulationClock?.resume?.();
    this.isPaused = false;
    this.discardPausedInput();
    return true;
  }

  /**
   * 场景进入 - 初始化所有基础系统
   */
  enter(data = null) {
    super.enter(data);
    this._sceneResourcesDisposed = false;

    // Runtime 是 container、ResourceScope、输入 disposer 与自建 SnapshotManager 的唯一 owner。
    this._initializeSceneRuntime();
    this.resourceScope = this.sceneRuntime.resourceScope;
    this._lifecycleCoordinator = new SceneLifecycleCoordinator({
      context: this.context,
      onError: (phase, name, error) => console.warn(`BaseGameScene lifecycle ${phase} [${name}]`, error)
    });
    this.context.lifecycle.coordinator = this._lifecycleCoordinator;
    this._lifecycleCoordinator.track(
      'scene-resources',
      this,
      () => this._disposeSceneResources(),
      100
    );
    this._hintPresenter = new SceneHintPresenter({
      resourceScope: this.resourceScope,
      InputHints,
      window: typeof window !== 'undefined' ? window : undefined,
      document: typeof document !== 'undefined' ? document : undefined
    });
    const hintPresenter = this._hintPresenter;
    this.resourceScope.track(() => hintPresenter.dispose());
    this.context.presentation.hints = hintPresenter;
    this.context.lifecycle.scope = this.resourceScope;
    this.context.lifecycle.state = 'entering';

    // 获取 canvas
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
      console.error('BaseGameScene: Canvas not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    this.context.setCanvasRuntime(canvas, ctx);

    // 逻辑视口与物理 backing 分离：宿主有 display scaler 时由它拥有逻辑尺寸（window 模式跟随窗口），
    // 场景不得把高清 backing 或窗口视口重置回参考分辨率。
    const logical = this.presentationProfile.logicalResolution;
    const displayManaged = Number(canvas.logicalWidth) > 0 && Number(canvas.logicalHeight) > 0;
    if (!displayManaged) {
      if (canvas.width !== logical.width) canvas.width = logical.width;
      if (canvas.height !== logical.height) canvas.height = logical.height;
      canvas.logicalWidth = logical.width;
      canvas.logicalHeight = logical.height;
    }
    this.logicalWidth = Number(canvas.logicalWidth) || logical.width;
    this.logicalHeight = Number(canvas.logicalHeight) || logical.height;
    this.context.runtime.width = this.logicalWidth;
    this.context.runtime.height = this.logicalHeight;

    const worldProfile = this.presentationProfile.world;
    // 初始化统一渲染器（包含 Camera）
    this.isometricRenderer = new IsometricRenderer(ctx, {
      tileWidth: worldProfile.tileWidth,
      tileHeight: worldProfile.tileHeight,
      width: this.logicalWidth,
      height: this.logicalHeight,
      assetManager: this.assetManager || null,
      debug: false,
      showGrid: false,  // 关闭网格线
      gridSize: this.mapWidth
    });
    this.context.presentation.renderer = this.isometricRenderer;

    // 从渲染器获取相机，并应用项目统一跟随规格。
    this.camera = this.isometricRenderer.getCamera();
    this.camera.followSpeed = Number(this.presentationProfile.camera.followSpeed);
    this.camera.deadzone = { ...this.presentationProfile.camera.deadzone };
    this.context.camera.instance = this.camera;
    this.context.camera.renderer = this.isometricRenderer;

    // 生成等距地图
    this.generateIsometricMap();

    // Terrain 由 DataDrivenPrologueScene 的世界流式会话创建并在投影提交时写入 Context。
    this.context.world.terrainBinding = this._terrainBinding;
    this.context.world.terrain = this.terrain;

    // 初始化输入管理器
    this.inputManager = new InputManager(canvas);
    this.context.input.manager = this.inputManager;
    this.context.input.gamepad = this.inputManager.gamepad || null;
    // 操作提示按当前输入方案（键鼠 / 触屏 / 手柄）取文案，手柄接上会自动切换
    InputHints.setInputManager(this.inputManager);
    // 输入管理器转交 Runtime owned registration；Context/Scene 仅保留 borrowed projection。
    this.sceneRuntime.setInput({
      inputManager: this.inputManager,
      camera: this.camera,
      ownInputManager: true
    });
    this.context.runtime.sceneRuntime = this.sceneRuntime;

    // Assembler 只产出登记计划，由 Runtime 接管 owner、更新与释放。
    const gameplayPlan = this._gameplaySystemAssembler.initialize({
      zoneCallbacks: this._createZoneEffectCallbacks()
    });
    this.sceneRuntime.applyRegistrationPlan(gameplayPlan);

    // 初始化 UI 面板
    this.initializeUIPanels();
    const panelLayout = this._ensurePanelLayout();
    Object.assign(this.context.ui, {
      layout: panelLayout,
      backpack: this.backpackPanel,
      bottomControlBar: this.bottomControlBar,
      playerStatusHUD: this.playerStatusHUD,
      dialogueBox: this.dialogueBox
    });

    // 创建或继承玩家实体；系统/UI/相机和 EntityLifecycleSystem 接线统一由协调器负责。
    this.playerLifecycle = new ScenePlayerLifecycle({
      scene: this,
      context: this.context,
      playerFactory: this._playerFactory,
      panelLayout,
      lifecycleSystem: this.entityLifecycleSystem,
      minimumInventorySlots: 24
    });
    this.context.lifecycle.player = this.playerLifecycle;
    this.playerEntity = this.playerLifecycle.createOrInherit(data || {}, {
      onInherited: (player) => console.log('BaseGameScene: 继承玩家实体', player),
      onCreated: () => console.log('BaseGameScene: 创建新玩家实体')
    });
    this.seedItemLifecycleProjection();

    const worldItemEvents = new SceneWorldItemEventPresenter({
      particleSystem: this.particleSystem,
      resolveTarget: payload => {
        const ids = new Set([payload.placementId, payload.entityId, payload.groundId].filter(Boolean));
        return [...this.pickupItems, ...this.equipmentItems, ...this.entities]
          .find(value => ids.has(value?.placementId) || ids.has(value?.entityId) || ids.has(value?.id)) || null;
      },
      notify: ({ message }) => {
        if (this.notificationSystem?.addSuccess) this.notificationSystem.addSuccess(message);
        else this._showScreenTip?.(message, { title: '发现物品', owner: 'world-item-event' });
      }
    });
    this.context.presentation.worldItemEvents = worldItemEvents;
    this.context.services.worldItemEvents = worldItemEvents;
    this.sceneRuntime.registerSystem('presentation.worldItemEvents', worldItemEvents, {
      order: 705,
      updateHook: 'update',
      disposeHook: 'dispose'
    });
    const applicationEventBridge = new SceneApplicationEventBridge({
      notificationBus: this.sceneRuntime.notificationBus,
      diagnostics: this._diagnostics,
      presenter: worldItemEvents,
      onContentEvent: event => this.onApplicationEvent?.(event),
      onAuxiliaryEvent: event => {
        if (event.type === 'item.gained') {
          const payload = event.payload || {};
          const definitionId = payload.definitionId || payload.itemId || payload.item?.id;
          const definition = definitionId
            ? this.gameLoader?.getRegistry?.('items')?.get?.(definitionId) || {}
            : {};
          const quantity = Math.max(0, Math.floor(Number(payload.quantity) || 0));
          if (definitionId && quantity > 0) {
            this.onItemGained({
              ...definition,
              ...(payload.item || {}),
              id: payload.itemId || payload.item?.id || definition.id || definitionId,
              definitionId,
              quantity,
              operationId: event.operationId || null,
              gainedCommitted: true
            }, this.playerEntity);
          }
        }
        const signal = event.payload?.tutorialSignal
          || (event.type === 'item.picked' ? 'itemPicked' : null);
        if (signal) this._tutorialFlow?.notify?.(signal, {
          ...event.payload,
          eventId: event.eventId,
          operationId: event.operationId,
          ok: true,
          committed: true
        });
        // 事件成功触发时，在目标物周围显示星星闪光引导视线；仅事件有位置/实体信息时生效。
        this.flashEventTarget?.(event);
      }
    });
    applicationEventBridge.bind();
    this.sceneRuntime.onUpdate(deltaTime => applicationEventBridge.update(deltaTime));
    this.context.services.applicationEvents = applicationEventBridge;
    this.resourceScope.track(() => applicationEventBridge.dispose());

    this._sceneTriggerBindings?.dispose();
    this._sceneTriggerBindings = new SceneTriggerBindingSystem({
      getPlayer: () => this.playerEntity,
      getConditionRoot: key => this.gameLoader?.blackboard?.get?.(key),
      isTutorialCompleted: tutorialId => this._tutorialFlow?.isCompleted?.(tutorialId)
        ?? this.tutorialSystem?.isTutorialCompleted?.(tutorialId)
        ?? false,
      resolveDynamicTarget: (targetId, binding) => {
        const entity = this.entityStore?.getById?.(targetId);
        if (!entity) return null;
        const sceneId = entity.vehicleSceneId || entity.sceneId || this.currentSceneId || '';
        if (binding?.sceneId && sceneId && binding.sceneId !== sceneId) return null;
        return createEntitySpatialTarget(entity, { sceneId });
      },
      logger: (reason, binding) => console.warn(`BaseGameScene: 场景触发器绑定 ${reason}`, binding?.id),
      onPromptChange: prompt => {
        if (prompt) this._hintPresenter?.showHint(prompt, '交互');
        else this._hintPresenter?.hideHint();
      },
      onInteractChoices: candidates => {
        const view = this.interactionChoiceView;
        if (!view || !Array.isArray(candidates) || candidates.length < 2) return false;
        return view.open({
          title: '选择交互',
          description: '此处有多个可用操作，请选择',
          defaultActionId: candidates[0].bindingId,
          allowCancel: true,
          actions: candidates.map(candidate => ({
            id: candidate.bindingId,
            label: candidate.choiceLabel || candidate.prompt || candidate.triggerId,
            onClick: () => {
              view.close();
              return this._sceneTriggerBindings?.executeInteractBinding(candidate.bindingId);
            }
          }))
        });
      }
    });

    console.log(`BaseGameScene: 进入场景 ${this.name}`);

    this.playerLifecycle.configureCleanup();

    // 将交互服务登记到显式 Context；帧/渲染管线可直接调度，Base 方法仅兼容旧调用方。
    Object.assign(this.context.services, {
      dialogue: this._ensureDialogueFlow(),
      triggerBindings: this._sceneTriggerBindings,
      worldInteraction: this._ensureWorldInteraction(),
      skills: this._ensureSkillActions(),
      worldPresentation: this._ensureWorldPresentation(),
      combatActions: this._ensureCombatActions()
    });

    // 玩家生命周期保护完成后再注册输入，并正式加载手柄配置。
    this._inputBindings = new SceneInputBindings({
      inputManager: this.inputManager,
      resourceScope: this.resourceScope,
      toggleBackpack: () => this.backpackPanel?.toggle(),
      toggleSettings: () => this.openSystemMenu(),
      togglePerformance: () => this._diagnostics.togglePerformance(),
      onGamepadConnected: (info) => {
        if (this.notificationSystem) {
          this.notificationSystem.addNotification(
            `${info.isXbox ? 'Xbox 手柄' : '手柄'}已连接（调试面板可查看按键）`, 'success');
        }
        this.inputManager.vibrate(180, 0.5, 0.3);
      },
      onGamepadDisconnected: () => {
        if (this.notificationSystem) this.notificationSystem.addNotification('手柄已断开', 'info');
      },
      logger: () => console.log('BaseGameScene: 已加载手柄绑定配置 config/gamepad.json')
    });
    this.context.input.bindings = this._inputBindings;
    this._inputBindings.register();

    // 顶层 flow 只接收显式依赖；帧管线不再理解弹窗、HUD 和背包内部细节。
    this._ensureInventoryFlow();
    this._ensureHudUpdater();
    this._ensureInputFlow().registerDefaults();
    Object.assign(this.context.services, {
      input: this._inputFlow,
      inventory: this._inventoryFlow,
      hud: this._hudUpdater
    });
    this.context.lifecycle.state = 'active';
  }

  /** Demo 内容层的区域提示；系统创建与生命周期由框架装配器负责。 */
  _createZoneEffectCallbacks() {
    return {
      onEnterZone: (entity, zone) => {
        if (entity !== this.playerEntity) return;
        const effect = zone.effect || {};
        const statName = ZONE_STAT_NAMES[effect.stat] || effect.stat;
        const isGain = (effect.value || 0) > 0;
        const tipText = isGain
          ? `进入增益区域：${zone.name || 'Buff区域'}（${statName} +${effect.value}）`
          : `进入减益区域：${zone.name || 'Buff区域'}（${statName} ${effect.value}）`;
        this._showScreenTip(tipText);
        this.resourceScope?.setTimeout(() => this._hideScreenTip(), 2500);
      },
      onLeaveZone: (entity, zone) => {
        if (entity !== this.playerEntity) return;
        this._showScreenTip(`离开区域：${zone.name || 'Buff区域'}`);
        this.resourceScope?.setTimeout(() => this._hideScreenTip(), 1500);
      },
      onEffectApply: (entity, zone, stat, value) => {
        const transform = entity.getComponent?.('transform');
        if (!transform || !this.floatingTextManager) return;
        const position = transform.position;
        const color = value > 0 ? '#00ff88' : '#ff4444';
        const prefix = value > 0 ? '+' : '';
        const statShort = ZONE_STAT_SHORT[stat] || stat;
        this.floatingTextManager.addText(
          position.x, position.y - 40, `${prefix}${value} ${statShort}`, color);
      }
    };
  }

}

export default BaseGameSceneSetup;

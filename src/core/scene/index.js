/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * core/scene/index.js
 * 场景运行时通用能力导出入口。
 */

export { SceneSystemContainer, DependencyOwnership } from './SceneSystemContainer.js';
export { SceneObjectProjector, ProjectionView } from './SceneObjectProjector.js';
export { GameSceneRuntime, UpdateOrder, FramePhase } from './GameSceneRuntime.js';
export { SceneTerrainCollision } from './SceneTerrainCollision.js';
export { SceneAimController } from './SceneAimController.js';
export { SceneEquipmentFlow, SLOT_MAP, COMPARE_STATS } from './SceneEquipmentFlow.js';
export { SceneTransitionFlow } from './SceneTransitionFlow.js';
export { SceneCombatActions } from './SceneCombatActions.js';
export { SceneDialogueFlow } from './SceneDialogueFlow.js';
export { SceneWorldInteraction } from './SceneWorldInteraction.js';
export { SceneClimbTargetResolver } from './SceneClimbTargetResolver.js';
export { SceneWorldQuery } from './SceneWorldQuery.js';
export { ScenePickedObjectObserver } from './ScenePickedObjectObserver.js';
export { SceneTutorialFlow } from './SceneTutorialFlow.js';
export { SceneFlowCoordinator } from './SceneFlowCoordinator.js';
export { SceneSkillActions } from './SceneSkillActions.js';
export { SceneWorldPresentation } from './SceneWorldPresentation.js';
export { SceneApplicationEventService } from './SceneApplicationEventService.js';
export { SceneApplicationEventBridge } from './SceneApplicationEventBridge.js';
export { SceneWorldItemEventPresenter } from './SceneWorldItemEventPresenter.js';
export { ScenePanelLayout } from './ScenePanelLayout.js';
export { SceneRenderPipeline } from './SceneRenderPipeline.js';
export { SceneFramePipeline } from './SceneFramePipeline.js';
export { SceneTerrainBinding } from './SceneTerrainBinding.js';
export { SceneCameraBounds } from './SceneCameraBounds.js';
export { SceneStreamingRuntime } from './SceneStreamingRuntime.js';
export { SceneItemGainedFlow } from './SceneItemGainedFlow.js';
export { SceneGameLoaderBridge } from './SceneGameLoaderBridge.js';
export { SceneCityWarStateBridge } from './SceneCityWarStateBridge.js';
export { SceneBattleRuntime } from './SceneBattleRuntime.js';
export { BattleSessionFacade } from './BattleSessionFacade.js';
export { registerSceneTriggerActions } from './SceneTriggerActionProvider.js';
export { SceneAimPresentation } from './SceneAimPresentation.js';
export { SceneGameplaySystemAssembler } from './SceneGameplaySystemAssembler.js';
export { SceneDiagnostics } from './SceneDiagnostics.js';
export { GameSceneContext } from './GameSceneContext.js';
export { SceneResourceScope } from './SceneResourceScope.js';
export { SceneEntityStore } from './SceneEntityStore.js';
export { SceneEntityState } from './SceneEntityState.js';
export { SceneGroupClearObserver } from './SceneGroupClearObserver.js';
export { ScenePlayerLifecycle } from './ScenePlayerLifecycle.js';
export { SceneInputBindings } from './SceneInputBindings.js';
export { SceneHintPresenter } from './SceneHintPresenter.js';
export { SceneLifecycleCoordinator } from './SceneLifecycleCoordinator.js';
export { SceneInventoryFlow } from './SceneInventoryFlow.js';
export { SceneHudUpdater } from './SceneHudUpdater.js';
export { WorldReadyGate } from './WorldReadyGate.js';
export { WorldMapLoadSession } from './WorldMapLoadSession.js';
export { ChunkNavigator } from './ChunkNavigator.js';
export { SceneNavigationProjection } from './SceneNavigationProjection.js';
export { PlacementSpawner } from './PlacementSpawner.js';
export { FadeOverlayTransition } from './FadeOverlayTransition.js';

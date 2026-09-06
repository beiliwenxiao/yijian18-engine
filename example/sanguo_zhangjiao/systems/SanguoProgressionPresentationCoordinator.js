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

import { SceneFlowCoordinator } from '../../../src/core/scene/SceneFlowCoordinator.js';
import { ProgressionViewModel } from '../../../src/ui/progression/ProgressionViewModel.js';
import { ProgressionPanel } from '../../../src/ui/progression/ProgressionPanel.js';

/**
 * 《三国张角传》的成长表现装配。
 * ProgressionGraphSystem 与 EffectResolver 仍属于框架；此类只管理 Demo 面板、热键与新档投影。
 */
export class SanguoProgressionPresentationCoordinator extends SceneFlowCoordinator {
  constructor(scene) {
    super(scene, { installProgressionUI, grantStarterProgressionPoints }, {
      name: 'SanguoProgressionPresentationCoordinator'
    });
  }
}

function installProgressionUI(gameLoader) {
  const progressionSystem = gameLoader?.progressionSystem;
  const player = this.playerEntity;
  if (!progressionSystem || !player || !this.uiSystem || !this.uiClickHandler || !this.inputManager) return false;
  this.grantStarterProgressionPoints(progressionSystem, player.id);

  const viewModel = new ProgressionViewModel({ progressionSystem });
  viewModel.setCharacter(player);
  const margin = 20;
  const width = Math.min(800, Math.max(320, this.logicalWidth - margin * 2));
  const height = Math.min(560, Math.max(360, this.logicalHeight - margin * 2));
  const panel = new ProgressionPanel({
    viewModel,
    isMobile: this.isMobileLayout,
    x: Math.round((this.logicalWidth - width) / 2),
    y: Math.round((this.logicalHeight - height) / 2),
    width,
    height,
    zIndex: 150
  });
  const hotkeyId = 'progression-panel';
  const togglePanel = () => {
    if (this.dialogueSystem?.isDialogueActive() || this.itemGainedPopup?.visible || this._classConfirm) return;
    const selectedClass = this.playerEntity?.getComponent?.('stats')?.class;
    if (!['warrior', 'archer', 'strategist'].includes(selectedClass)) {
      this._showScreenTip('加入黄巾并确认职业后才能打开角色成长');
      return;
    }
    if (panel.visible) panel.hide();
    else {
      this.backpackPanel?.hide?.();
      panel.show();
    }
  };

  this.uiSystem.registerPanel('progression', panel);
  this.uiClickHandler.registerElement(panel);
  this.inputManager.registerHotkey(hotkeyId, ['t', 'T'], togglePanel);
  Object.assign(this.context.ui, { progression: panel });
  this.progressionViewModel = viewModel;
  this.progressionPanel = panel;
  this.s09RefugeeCoordinator.installCitySummaryUI(gameLoader);

  this.resourceScope?.track(() => {
    this.inputManager?.unregisterHotkey?.(hotkeyId);
    this.uiClickHandler?.unregisterElement?.(panel);
    this.uiSystem?.unregisterPanel?.('progression');
    if (this.context.ui.progression === panel) this.context.ui.progression = null;
    if (this.progressionPanel === panel) this.progressionPanel = null;
    if (this.progressionViewModel === viewModel) this.progressionViewModel = null;
  });
  return true;
}

function grantStarterProgressionPoints(progressionSystem, characterId) {
  if (!this._progressionBootstrap?.isNewGame || !characterId) return false;
  if (progressionSystem.states.has(characterId) || progressionSystem.ledgers.has(characterId)) return false;
  progressionSystem.grantPoints(characterId, 'skill', 1);
  progressionSystem.grantPoints(characterId, 'talent', 1);
  progressionSystem.grantPoints(characterId, 'unit', 1);
  progressionSystem.grantPoints(characterId, 'passive', 1);
  return true;
}

export default SanguoProgressionPresentationCoordinator;

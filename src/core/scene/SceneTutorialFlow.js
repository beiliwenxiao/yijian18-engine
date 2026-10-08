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

import { setTimeoutFn } from '../Timers.js';

/**
 * TutorialSystem 的场景薄适配器：只转发语义信号与表现生命周期，
 * 不复制 definition、规则、阈值或完成状态。
 */
export class SceneTutorialFlow {
  constructor(config = {}) {
    if (!config.tutorialSystem) throw new TypeError('SceneTutorialFlow requires tutorialSystem');
    this.tutorialSystem = config.tutorialSystem;
    this.getScope = config.getScope || (() => null);
    this.presenter = config.presenter || null;
    this.scheduler = config.scheduler || (callback => setTimeoutFn(callback, 0));
    this._presentationBound = false;
    this._panelVisibility = new Map();
    this._lastMovementPosition = null;
  }

  bindPresentation() {
    const presenter = this.presenter;
    if (!presenter) return false;
    this.tutorialSystem.onShow(data => presenter.show?.(data));
    this.tutorialSystem.onHide(() => presenter.hide?.());
    // 完成回调透出教程定义，供 presenter 展示收场提示（endText）。
    this.tutorialSystem.onComplete((tutorialId, tutorial) => presenter.complete?.(tutorialId, tutorial));
    this._presentationBound = true;
    return true;
  }

  /** 只有事件动作提供稳定 tutorialId 时才展示。 */
  show(tutorialId, context = {}) {
    if (!tutorialId) return false;
    const explicitContext = context && typeof context === 'object' ? context : {};
    return this.tutorialSystem.showTutorial(tutorialId, {
      ...explicitContext,
      scope: explicitContext.scope ?? this.getScope()
    });
  }

  complete(tutorialId) {
    if (!tutorialId || this.isCompleted(tutorialId)) return false;
    this.tutorialSystem.completeTutorial(tutorialId);
    return true;
  }

  notify(signal, payload = {}) {
    return this.tutorialSystem.notify(signal, payload, this.getScope());
  }

  isCurrent(tutorialId) {
    const current = this.tutorialSystem.getCurrentTutorial();
    return current?.id === tutorialId;
  }

  isCompleted(tutorialId) {
    return this.tutorialSystem.isTutorialCompleted(tutorialId);
  }

  resetMovementOrigin(position = null) {
    const scope = this.getScope();
    const definition = this.tutorialSystem.getCurrentTutorial()
      || this.tutorialSystem.getAllTutorials().find(value => this._matchesScope(value, scope)
        && value.movementRule && !this.isCompleted(value.id));
    this.tutorialSystem.resetMovementOrigin(definition?.id || null, position);
    this._lastMovementPosition = this._copyPosition(position);
  }

  updateMovement(position, options = {}) {
    const definition = this.tutorialSystem.getCurrentTutorial();
    if (definition?.movementRule?.mode === 'anyMovement' && this._lastMovementPosition) {
      this.tutorialSystem.resetMovementOrigin(definition.id, this._lastMovementPosition);
    }
    const completed = this.tutorialSystem.updateMovement(position, null, this.getScope());
    this._lastMovementPosition = this._copyPosition(position);
    if (completed) options.onComplete?.({ position });
    return completed;
  }

  /**
   * Observes generic scene event sources without assigning trigger or panel names.
   * Panels may be supplied as an object, a Map, or iterable { id, visible } entries.
   */
  observeEventSources({ position = null, panels = null, onMovementComplete = null, onPanelVisible = null } = {}) {
    const movementCompleted = this.updateMovement(position, {
      onComplete: event => onMovementComplete?.(event)
    });
    for (const { id, visible } of this._normalizePanels(panels)) {
      const wasVisible = this._panelVisibility.get(id) === true;
      if (visible && !wasVisible) onPanelVisible?.({ id });
      this._panelVisibility.set(id, visible);
    }
    return { movementCompleted };
  }

  resetObservedSources() {
    this._panelVisibility.clear();
    this._lastMovementPosition = null;
  }

  _copyPosition(position) {
    return Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? { x: position.x, y: position.y }
      : null;
  }

  _normalizePanels(panels) {
    if (panels instanceof Map) return [...panels].map(([id, panel]) => ({ id, visible: panel?.visible === true }));
    if (Array.isArray(panels)) return panels
      .filter(entry => entry?.id)
      .map(entry => ({ id: entry.id, visible: entry.visible === true || entry.panel?.visible === true }));
    if (panels && typeof panels === 'object') {
      return Object.entries(panels).map(([id, panel]) => ({ id, visible: panel?.visible === true || panel === true }));
    }
    return [];
  }

  _matchesScope(definition, scope) {
    const sceneId = typeof scope === 'string' ? scope : scope?.sceneId;
    const sceneIds = definition?.scope?.sceneIds;
    return !Array.isArray(sceneIds) || sceneIds.length === 0 || !sceneId || sceneIds.includes(sceneId);
  }

  dispose() {
    if (this._presentationBound) {
      this.tutorialSystem.onShow(null);
      this.tutorialSystem.onHide(null);
      this.tutorialSystem.onComplete(null);
    }
    this._presentationBound = false;
    this.resetObservedSources();
  }
}

export default SceneTutorialFlow;
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
 * OnboardingUiProjection - 由已提交领域事实派生的渐进 UI 状态。
 *
 * 定义只描述何时暴露组件；运行时不保存进度、不写入任务或教程状态。
 * 表现宿主通过 stable componentId 接收同一份状态，因此 DOM、Canvas 和微信
 * Canvas 控件不依赖彼此的实现细节。
 */
export class OnboardingUiProjection {
  constructor(options = {}) {
    this.url = options.url || 'config/OnboardingUI.json';
    this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    this.getSceneId = options.getSceneId || (() => null);
    this.getStoryState = options.getStoryState || (() => ({}));
    this.tutorialFlow = options.tutorialFlow || null;
    this.onProjection = typeof options.onProjection === 'function' ? options.onProjection : null;
    // 教学高亮跨会话持久化：宿主实现写入（如记入故事状态，随存档保存）
    this.onDismissComponent = typeof options.onDismissComponent === 'function' ? options.onDismissComponent : null;
    this.definition = null;
    this.loaded = false;
    this._lastSignature = null;
    // 教学高亮熄灭的会话内记录；跨会话持久化经 onDismissComponent 钩子写入故事状态。
    this._dismissedComponents = new Set();
  }

  async load() {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('OnboardingUiProjection requires fetch support');
    }
    const response = await this.fetchImpl(this.url);
    if (!response?.ok) throw new Error(`无法加载渐进 UI 配置: ${this.url}`);
    const definition = await response.json();
    this._validateDefinition(definition);
    this.definition = definition;
    this.loaded = true;
    this.refresh(true);
    return definition;
  }

  refresh(force = false) {
    if (!this.loaded || !this.definition) return false;
    const projection = this._buildProjection();
    const signature = JSON.stringify(projection);
    if (!force && signature === this._lastSignature) return false;
    this._lastSignature = signature;
    this.onProjection?.(projection);
    return true;
  }

  getProjection() {
    return this._buildProjection();
  }

  /**
   * 教学高亮一次性熄灭：高亮组件首次被触发（点击/快捷键）时由 UI 层回调。
   * 熄灭通过 onDismissComponent 钩子持久化（如记入故事状态，随存档保存），
   * 读取时同时考虑会话内记录与故事状态，跨会话不再点亮。
   * @param {string} componentId - 稳定组件 ID（如 pc-potion1）
   * @returns {boolean} 是否发生了熄灭
   */
  dismissComponent(componentId) {
    if (!componentId || this._dismissedComponents.has(componentId)) return false;
    this._dismissedComponents.add(componentId);
    try {
      this.onDismissComponent?.(componentId);
    } catch (error) {
      console.warn('[OnboardingUiProjection] 熄灭状态持久化失败', error);
    }
    this.refresh(true);
    return true;
  }

  dispose() {
    this.onProjection = null;
    this._lastSignature = null;
  }

  _buildProjection() {
    const componentIds = this.definition?.controlledComponentIds || [];
    const sceneId = this.getSceneId();
    const activeRules = (this.definition?.rules || []).filter(rule => this._matchesScope(rule, sceneId));
    const active = activeRules.length > 0;
    const states = Object.fromEntries(componentIds.map(componentId => [componentId, {
      visible: !active,
      enabled: !active,
      highlighted: false,
      hintAction: null
    }]));

    if (!active) return { active: false, sceneId, states };

    const storyState = this.getStoryState() || {};
    for (const rule of activeRules) {
      if (!this._matchesWhen(rule.when, storyState)) continue;
      for (const componentId of rule.revealComponentIds || []) {
        const state = states[componentId];
        if (state) state.visible = true;
      }
      for (const componentId of rule.enabledComponentIds || []) {
        const state = states[componentId];
        if (state) state.enabled = true;
      }
      const highlights = rule.highlightComponentIds || (rule.highlightComponentId ? [rule.highlightComponentId] : []);
      for (const componentId of highlights) {
        const state = states[componentId];
        if (!state || this._isDismissed(componentId, storyState)) continue;
        state.highlighted = true;
        state.hintAction = rule.hintAction || null;
      }
    }
    return { active: true, sceneId, states };
  }

  _matchesScope(rule, sceneId) {
    const scope = rule?.scope;
    const sceneIds = scope?.sceneIds;
    const sceneListed = Array.isArray(sceneIds) && sceneIds.length > 0
      ? sceneIds.includes(sceneId)
      : true;
    if (!sceneListed) return false;
    // excludeSceneIds：全场景兜底规则排除特定场景（如 S01 有自己的渐进节奏，全局常驻规则排除它）
    const excludeSceneIds = scope?.excludeSceneIds;
    if (Array.isArray(excludeSceneIds) && excludeSceneIds.length > 0 && excludeSceneIds.includes(sceneId)) {
      return false;
    }
    return true;
  }

  /** 熄灭判定：会话内已触发，或故事状态已持久化记录（跨会话）。 */
  _isDismissed(componentId, storyState) {
    if (this._dismissedComponents.has(componentId)) return true;
    return storyState?.onboardingDismissed?.[componentId] === true;
  }

  _matchesWhen(when = { type: 'always' }, storyState) {
    const type = when?.type || 'always';
    if (type === 'always') return true;
    if (type === 'tutorialCompleted') return this.tutorialFlow?.isCompleted?.(when.tutorialId) === true;
    if (type === 'tutorialCurrent') return this.tutorialFlow?.isCurrent?.(when.tutorialId) === true;
    if (type === 'storyPath') {
      const value = this._readPath(storyState, when.path);
      return Object.prototype.hasOwnProperty.call(when, 'equals') ? value === when.equals : value === true;
    }
    return false;
  }

  _readPath(source, path) {
    if (!source || typeof path !== 'string' || !path) return undefined;
    return path.split('.').reduce((value, key) => value == null ? undefined : value[key], source);
  }

  _validateDefinition(definition) {
    if (!definition || typeof definition !== 'object' || !Array.isArray(definition.controlledComponentIds)
      || !Array.isArray(definition.rules)) {
      throw new TypeError('OnboardingUI 配置必须包含 controlledComponentIds 和 rules 数组');
    }
    const componentIds = new Set(definition.controlledComponentIds);
    if (componentIds.size !== definition.controlledComponentIds.length || componentIds.has('')) {
      throw new TypeError('OnboardingUI controlledComponentIds 必须是唯一的非空稳定 ID');
    }
    for (const rule of definition.rules) {
      if (!rule?.id || !rule?.when?.type) throw new TypeError('OnboardingUI 规则缺少 id 或 when.type');
      for (const componentId of [
        ...(rule.revealComponentIds || []),
        ...(rule.enabledComponentIds || []),
        ...(rule.highlightComponentIds || []),
        ...(rule.highlightComponentId ? [rule.highlightComponentId] : [])
      ]) {
        if (!componentIds.has(componentId)) {
          throw new TypeError(`OnboardingUI 规则 ${rule.id} 引用了未知组件 ${componentId}`);
        }
      }
    }
  }
}

export default OnboardingUiProjection;

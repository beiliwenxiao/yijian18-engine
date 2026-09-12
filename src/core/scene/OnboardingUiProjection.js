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
    this.definition = null;
    this.loaded = false;
    this._lastSignature = null;
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
        if (!state) continue;
        state.highlighted = true;
        state.hintAction = rule.hintAction || null;
      }
    }
    return { active: true, sceneId, states };
  }

  _matchesScope(rule, sceneId) {
    const sceneIds = rule?.scope?.sceneIds;
    return !Array.isArray(sceneIds) || sceneIds.length === 0 || sceneIds.includes(sceneId);
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

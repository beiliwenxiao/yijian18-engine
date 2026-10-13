/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * 教程系统
 * 
 * 职责：
 * - 教程注册和触发逻辑
 * - 教程完成状态管理
 * - 教程显示和隐藏
 * - 教程步骤管理
 * 
 * 需求：2, 3, 4, 5, 11, 12, 37
 */

import { Logger } from '../core/Logger.js';
import { TutorialDefinitionRepository } from './TutorialDefinitionRepository.js';

const matchesScope = (definition, scope = null) => {
  const sceneId = typeof scope === 'string' ? scope : scope?.sceneId;
  const sceneIds = definition?.scope?.sceneIds;
  return !Array.isArray(sceneIds) || sceneIds.length === 0 || !sceneId || sceneIds.includes(sceneId);
};

export class TutorialSystem {
  constructor(config = {}) {
    // definitions 属于不可变 Repository；本系统只借用索引并拥有运行进度。
    // 兼容期内优先 flowGroupDefinitions，回退 sceneEventDefinitions。
    const fgDefs = config.flowGroupDefinitions ?? config.sceneEventDefinitions ?? [];
    this.definitionRepository = TutorialDefinitionRepository.from(config.definitions || [], {
      flowGroupDefinitions: fgDefs,
      sceneEventDefinitions: config.sceneEventDefinitions || []
    });
    
    // 已完成的教程ID集合
    this.completedTutorials = new Set();

    // 槽位被占用时待显示的教程队列（FIFO，避免阻塞上层状态事务）
    this.pendingTutorials = [];
    
    // 当前显示只保存稳定 definition id；完整定义始终从只读索引解析。
    this.currentTutorialId = null;
    Object.defineProperty(this, 'currentTutorial', {
      enumerable: false,
      configurable: false,
      get: () => this.currentTutorialId
        ? this.definitionRepository.get(this.currentTutorialId)
        : null,
      set: value => {
        this.currentTutorialId = typeof value === 'string' ? value : (value?.id || null);
      }
    });
    
    // 当前教程步骤索引
    this.currentStepIndex = 0;
    
    // 教程是否暂停游戏
    this.pauseGame = false;
    
    // 教程显示回调
    this.onShowCallback = null;
    this.onHideCallback = null;
    this.onCompleteCallback = null;
    // 隐藏多监听器（单 Trigger 多教程路径等待用）
    this._hideListeners = [];
    this.signalProgress = new Map();
    this.movementOrigins = new Map();

    // 是否启用教程系统
    this.enabled = true;
  }

  /**
   * 注册教程
   * @param {string} tutorialId - 教程ID
   * @param {Object} tutorialData - 教程数据
   * @returns {boolean} 是否注册成功
   */
  registerTutorial(tutorialId, tutorialData) {
    if (!tutorialId || !tutorialData) {
      console.error('TutorialSystem: 无效的教程ID或数据');
      return false;
    }
    try {
      this.setDefinitionRepository(this.definitionRepository.withDefinition(tutorialId, tutorialData));
      return true;
    } catch (error) {
      console.error('TutorialSystem: 教程定义无效', error);
      return false;
    }
  }

  setDefinitionRepository(repository) {
    const next = TutorialDefinitionRepository.from(repository);
    const activeId = this.currentTutorial?.id || null;
    this.definitionRepository = next;
    if (activeId) {
      const replacement = next.get(activeId);
      if (replacement) this.currentTutorial = replacement;
      else this.hideTutorial();
    }
    return true;
  }

  replaceDefinitions(definitions = [], flowGroupDefinitionsOrLegacy = undefined, sceneEventDefinitions = undefined) {
    if (!Array.isArray(definitions)) throw new TypeError('Tutorial definitions must be an array');
    // 兼容两种签名：(defs, flowGroupDefs) 或 (defs, undefined, sceneEventDefs) 或旧版 (defs, sceneEventDefs)
    let fgDefs;
    if (flowGroupDefinitionsOrLegacy !== undefined) {
      // 传入的第二个参数：数组、FlowGroupDefinitionRepository 实例、或有 id 字段的 flowGroup/sceneEvent 定义
      const candidate = flowGroupDefinitionsOrLegacy;
      if (Array.isArray(candidate)) {
        fgDefs = candidate;
      } else if (candidate && typeof candidate.all === 'function') {
        // GameLoader 传入 FlowGroupDefinitionRepository 实例（assemble drafts commit 路径）
        fgDefs = candidate;
      } else {
        fgDefs = sceneEventDefinitions ?? this.definitionRepository.flowGroupDefinitions;
      }
    } else if (sceneEventDefinitions !== undefined) {
      fgDefs = sceneEventDefinitions;
    } else {
      fgDefs = this.definitionRepository.flowGroupDefinitions;
    }
    return this.setDefinitionRepository(new TutorialDefinitionRepository(definitions, {
      flowGroupDefinitions: fgDefs,
      sceneEventDefinitions: Array.isArray(sceneEventDefinitions) ? sceneEventDefinitions : fgDefs
    }));
  }

  /** 返回 FlowGroup 只读定义；Tutorial 的宏观顺序直接继承该目录。 */
  getFlowGroupDefinitions() {
    return this.definitionRepository.getFlowGroupDefinitions();
  }
  /** @deprecated 使用 getFlowGroupDefinitions() */
  getSceneEventDefinitions() {
    return this.definitionRepository.getSceneEventDefinitions();
  }

  /**
   * 兼容旧调用；正式运行禁止按定义顺序猜测下一项教程。
   * 教程只能由事件动作显式调用 showTutorial(tutorialId)。
   * @returns {boolean} 始终为 false
   */
  showNext() {
    console.warn('TutorialSystem: showNext 已禁用，请由事件显式调用 showTutorial(tutorialId)');
    return false;
  }

  notify(signal, payload = {}, scope = null) {
    if (!this.enabled || !signal || payload?.ok === false || payload?.committed === false) return false;
    // 教程是 committed event 的辅助消费者，只允许当前已显示教程消费信号。
    // 禁止一个事件在后台提前完成尚未激活、尚未展示的未来教程。
    const definition = this.currentTutorial;
    if (!definition
      || definition.completionPolicy !== 'signal'
      || !matchesScope(definition, scope)
      || this.completedTutorials.has(definition.id)) return false;
    for (const rule of definition.signalRules) {
      if (rule.signal !== signal || !this._matchesSignalRule(rule, payload)) continue;
      const key = `${definition.id}:${rule.id || signal}`;
      const count = (this.signalProgress.get(key) || 0) + 1;
      this.signalProgress.set(key, count);
      if (count < Math.max(1, Number(rule.threshold) || 1)) return false;
      this.completeTutorial(definition.id);
      return true;
    }
    return false;
  }

  updateMovement(position, category = null, scope = null) {
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return false;
    const definition = this.currentTutorial;
    if (!definition
      || (category && definition.category !== category)
      || !matchesScope(definition, scope)
      || definition.completionPolicy !== 'signal'
      || !definition.movementRule
      || this.completedTutorials.has(definition.id)) return false;
    const origin = this.movementOrigins.get(definition.id);
    if (!origin) {
      this.movementOrigins.set(definition.id, { x: position.x, y: position.y });
      return false;
    }
    const deltaX = position.x - origin.x;
    const deltaY = position.y - origin.y;
    if (definition.movementRule.mode === 'anyMovement') {
      const epsilon = Math.max(0.001, Number(definition.movementRule.epsilon) || 0.01);
      if (deltaX * deltaX + deltaY * deltaY <= epsilon * epsilon) return false;
    } else {
      const threshold = Math.max(0, Number(definition.movementRule.threshold) || 0);
      if (Math.hypot(deltaX, deltaY) < threshold) return false;
    }
    this.completeTutorial(definition.id);
    return true;
  }

  resetMovementOrigin(tutorialId = null, position = null) {
    const value = Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? { x: position.x, y: position.y } : null;
    if (tutorialId) {
      if (value) this.movementOrigins.set(tutorialId, value);
      else this.movementOrigins.delete(tutorialId);
    } else {
      this.movementOrigins.clear();
    }
  }

  _matchesSignalRule(rule, payload) {
    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    return conditions.every(condition => {
      const value = String(condition.field || '').split('.').filter(Boolean)
        .reduce((current, key) => current?.[key], payload);
      if (condition.operator === 'exists') return condition.value === false ? value == null : value != null;
      if (condition.operator === 'notEquals') return value !== condition.value;
      if (condition.operator === 'gte') return Number(value) >= Number(condition.value);
      if (condition.operator === 'lte') return Number(value) <= Number(condition.value);
      return value === condition.value;
    });
  }

  /**
   * 显示教程
   * @param {string} tutorialId - 教程ID
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否显示成功
   */
  showTutorial(tutorialId, context = {}) {
    Logger.log(`TutorialSystem: showTutorial 被调用, ID=${tutorialId}`);
    
    if (!this.enabled) {
      Logger.log('TutorialSystem: 教程系统未启用');
      return false;
    }

    // 已完成或同一教程已在显示时视为幂等成功，避免事件重放失败。
    if (this.completedTutorials.has(tutorialId)) {
      Logger.log(`TutorialSystem: 教程 ${tutorialId} 已完成，忽略重复展示请求`);
      return true;
    }
    if (this.currentTutorial?.id === tutorialId) return true;

    // 获取教程
    const tutorial = this.definitionRepository.get(tutorialId);
    if (!tutorial) {
      console.warn(`TutorialSystem: 教程不存在: ${tutorialId}`);
      return false;
    }

    // 检查是否有其他教程正在显示：入队等待，不拒绝请求，避免上层状态事务因槽忙而失败
    if (this.currentTutorial) {
      console.warn(`TutorialSystem: 教程槽忙（当前=${this.currentTutorial.id}），将 ${tutorialId} 加入待显示队列`);
      this.pendingTutorials.push({ tutorialId, context: context || {} });
      return true;
    }

    Logger.log(`TutorialSystem: 显示教程 ${tutorialId}`);

    // 设置当前教程
    this.currentTutorial = tutorial;
    this.currentStepIndex = 0;
    this.pauseGame = tutorial.pauseGame;

    // 显示第一步（showStep内部会调用onShowCallback）
    this.showStep(0, context);

    return true;
  }

  /**
   * 由事件动作按稳定 step ID 显式展示教程步骤。
   * 重放已完成、当前步骤或更早步骤时视为幂等成功，不回退表现。
   * @param {string} tutorialId - 教程 ID
   * @param {string} tutorialStepId - 教程步骤稳定 ID
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否接受展示请求
   */
  showTutorialStep(tutorialId, tutorialStepId, context = {}) {
    if (!this.enabled || !tutorialId || !tutorialStepId) return false;
    if (this.completedTutorials.has(tutorialId)) return true;

    const tutorial = this.definitionRepository.get(tutorialId);
    if (!tutorial) {
      console.warn(`TutorialSystem: 教程不存在: ${tutorialId}`);
      return false;
    }
    const stepIndex = tutorial.steps.findIndex(step => step?.id === tutorialStepId);
    if (stepIndex < 0) {
      console.warn(`TutorialSystem: 教程步骤不存在: ${tutorialId}/${tutorialStepId}`);
      return false;
    }
    if (this.currentTutorial && this.currentTutorial.id !== tutorialId) {
      console.warn('TutorialSystem: 已有其他教程正在显示:', this.currentTutorial.id);
      return false;
    }
    if (this.currentTutorial?.id === tutorialId && this.currentStepIndex >= stepIndex) return true;

    this.currentTutorial = tutorial;
    this.pauseGame = tutorial.pauseGame;
    this.showStep(stepIndex, context);
    return true;
  }

  /**
   * 显示教程步骤
   * @param {number} stepIndex - 步骤索引
   * @param {Object} context - 上下文数据
   */
  showStep(stepIndex, context = {}) {
    if (!this.currentTutorial) {
      return;
    }

    const steps = this.currentTutorial.steps;
    if (stepIndex < 0 || stepIndex >= steps.length) {
      return;
    }

    this.currentStepIndex = stepIndex;
    const step = steps[stepIndex];

    // 构建步骤显示数据
    const stepData = {
      tutorialId: this.currentTutorial.id,
      tutorialTitle: this.currentTutorial.title,
      stepIndex,
      totalSteps: steps.length,
      step: {
        text: step.text || '',
        image: step.image || null,
        target: step.target || null,
        highlightTarget: step.highlightTarget !== undefined ? step.highlightTarget : true,
        position: step.position || 'center',
        arrow: step.arrow || null
      },
      // 教程级提示：开场（beginText）/ 收场（endText），随表现生命周期透出，供 presenter 渲染。
      beginText: this.currentTutorial.beginText || '',
      endText: this.currentTutorial.endText || '',
      canSkip: this.currentTutorial.canSkip,
      isLastStep: stepIndex === steps.length - 1,
      context
    };

    // 触发步骤显示回调
    if (this.onShowCallback) {
      Logger.log('TutorialSystem: 调用 onShowCallback');
      this.onShowCallback(stepData, context);
    } else {
      console.warn('TutorialSystem: onShowCallback 未设置！');
    }
  }

  /**
   * 下一步
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否还有下一步
   */
  nextStep(context = {}) {
    if (!this.currentTutorial) {
      return false;
    }

    const nextIndex = this.currentStepIndex + 1;
    
    if (nextIndex >= this.currentTutorial.steps.length) {
      // 只有 allSteps policy 由步骤浏览完成；signal/manual 等待各自正式命令。
      if (this.currentTutorial.completionPolicy === 'allSteps') this.completeTutorial();
      return false;
    }

    // 显示下一步
    this.showStep(nextIndex, context);
    return true;
  }

  /**
   * 上一步
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否还有上一步
   */
  previousStep(context = {}) {
    if (!this.currentTutorial) {
      return false;
    }

    const prevIndex = this.currentStepIndex - 1;
    
    if (prevIndex < 0) {
      return false;
    }

    // 显示上一步
    this.showStep(prevIndex, context);
    return true;
  }

  /**
   * 跳过教程
   * @returns {boolean} 是否跳过成功
   */
  skipTutorial() {
    if (!this.currentTutorial) {
      return false;
    }

    if (!this.currentTutorial.canSkip) {
      return false;
    }

    // 标记为已完成（跳过也算完成）
    this.completedTutorials.add(this.currentTutorial.id);

    // 隐藏教程
    this.hideTutorial();

    return true;
  }

  /**
   * 完成教程
   * @param {string} tutorialId - 可选的教程ID，如果不提供则完成当前教程
   */
  completeTutorial(tutorialId = null) {
    // 如果提供了 tutorialId，直接标记为完成
    if (tutorialId) {
      this.completedTutorials.add(tutorialId);

      // 如果是当前教程，也隐藏它
      if (this.currentTutorial && this.currentTutorial.id === tutorialId) {
        // 触发完成回调
        if (this.onCompleteCallback) {
          this.onCompleteCallback(tutorialId, this.currentTutorial);
        }
        this.hideTutorial();
      }
      return;
    }

    // 否则完成当前教程
    if (!this.currentTutorial) {
      return;
    }

    const currentTutorialId = this.currentTutorial.id;

    // 标记为已完成
    this.completedTutorials.add(currentTutorialId);

    // 触发完成回调
    if (this.onCompleteCallback) {
      this.onCompleteCallback(currentTutorialId, this.currentTutorial);
    }

    // 隐藏教程
    this.hideTutorial();
  }

  /** 槽位空闲后，依次补显待显示队列中的教程。 */
  _flushPendingTutorials() {
    while (this.pendingTutorials.length && !this.currentTutorial) {
      const next = this.pendingTutorials.shift();
      this.showTutorial(next.tutorialId, next.context || {});
    }
  }

  /**
   * 隐藏教程
   */
  hideTutorial() {
    if (!this.currentTutorial) {
      return;
    }

    const tutorial = this.currentTutorial;

    // 清除当前教程
    this.currentTutorial = null;
    this.currentStepIndex = 0;
    this.pauseGame = false;

    // 触发隐藏回调
    if (this.onHideCallback) {
      this.onHideCallback(tutorial);
    }
    // 多监听器：单 Trigger 多教程路径的等待方在此被唤醒
    if (this._hideListeners && this._hideListeners.length) {
      for (const cb of [...this._hideListeners]) {
        try { cb(tutorial); } catch (error) { console.warn('TutorialSystem: onHide 监听器出错', error); }
      }
    }

    // 补显待显示队列
    this._flushPendingTutorials();
  }

  /**
   * 检查教程是否已完成
   * @param {string} tutorialId - 教程ID
   * @returns {boolean} 是否已完成
   */
  isTutorialCompleted(tutorialId) {
    return this.completedTutorials.has(tutorialId);
  }

  /**
   * 获取教程
   * @param {string} tutorialId - 教程ID
   * @returns {Object|null} 教程对象
   */
  getTutorial(tutorialId) {
    return this.definitionRepository.get(tutorialId);
  }

  /**
   * 获取所有教程
   * @returns {Array} 教程列表
   */
  getAllTutorials() {
    return [...this.definitionRepository.values()];
  }

  /** SceneEvent 只读定义；Tutorial 的宏观顺序直接继承该目录。 */
  getSceneEventDefinitions() {
    return this.definitionRepository.getSceneEventDefinitions();
  }

  /**
   * 获取当前教程
   * @returns {Object|null} 当前教程对象
   */
  getCurrentTutorial() {
    return this.currentTutorial;
  }

  /**
   * 获取当前步骤索引
   * @returns {number} 当前步骤索引
   */
  getCurrentStepIndex() {
    return this.currentStepIndex;
  }

  /**
   * 检查是否有教程正在显示
   * @returns {boolean} 是否有教程正在显示
   */
  isShowingTutorial() {
    return this.currentTutorial !== null;
  }

  /**
   * 检查游戏是否应该暂停
   * @returns {boolean} 是否应该暂停
   */
  shouldPauseGame() {
    return this.pauseGame;
  }

  /**
   * 教程帧更新只保留兼容入口，不允许从定义或游戏状态主动展示教程。
   * @returns {boolean} 始终为 false
   */
  update() {
    return false;
  }

  /**
   * 渲染教程系统（每帧调用）
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   */
  render(ctx) {
    // 教程系统的渲染由 UI 组件负责；保留兼容入口。
  }

  /**
   * 兼容旧 API；autoTrigger 不再具有运行时展示语义。
   * @returns {boolean} 始终为 false
   */
  checkAutoTriggers() {
    return false;
  }

  /**
   * 设置显示回调
   * @param {Function} callback - 回调函数
   */
  onShow(callback) {
    this.onShowCallback = callback;
  }

  /**
   * 注册教程隐藏监听器（支持多个）。
   * 用于"单 Trigger 多教程路径"：tutorial.command show 动作 await=true 时等待该教程离槽。
   * @param {Function} callback - 回调函数 (tutorial) => void
   * @returns {Function} 取消订阅函数
   */
  onHide(callback) {
    if (typeof callback !== 'function') return () => {};
    this._hideListeners.push(callback);
    // 兼容旧代码：保留 onHideCallback 指向最近一个（不影响多监听器）
    this.onHideCallback = callback;
    return () => {
      const index = this._hideListeners.indexOf(callback);
      if (index !== -1) this._hideListeners.splice(index, 1);
      if (this.onHideCallback === callback) this.onHideCallback = null;
    };
  }

  /**
   * 设置完成回调
   * @param {Function} callback - 回调函数
   */
  onComplete(callback) {
    this.onCompleteCallback = callback;
  }

  /**
   * 重置教程（用于测试或重新开始）
   * @param {string} tutorialId - 教程ID（可选，不传则重置所有）
   */
  resetTutorial(tutorialId = null) {
    if (tutorialId) {
      this.completedTutorials.delete(tutorialId);
      this.movementOrigins.delete(tutorialId);
      for (const key of [...this.signalProgress.keys()]) {
        if (key.startsWith(`${tutorialId}:`)) this.signalProgress.delete(key);
      }
    } else {
      this.completedTutorials.clear();
      this.signalProgress.clear();
      this.movementOrigins.clear();
    }

    // 如果当前正在显示该教程，隐藏它
    if (this.currentTutorial && (!tutorialId || this.currentTutorial.id === tutorialId)) {
      this.hideTutorial();
    }
  }

  /**
   * 重置整个教程系统
   */
  reset() {
    this.completedTutorials.clear();
    this.signalProgress.clear();
    this.movementOrigins.clear();
    this.hideTutorial();
  }

  /**
   * 启用/禁用教程系统
   * @param {boolean} enabled - 是否启用
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    
    // 如果禁用，隐藏当前教程
    if (!enabled && this.currentTutorial) {
      this.hideTutorial();
    }
  }

  /**
   * 获取教程进度
   * @returns {Object} 进度信息
   */
  getProgress() {
    const totalTutorials = this.definitionRepository.size;
    const completedCount = this.completedTutorials.size;
    
    return {
      total: totalTutorials,
      completed: completedCount,
      remaining: totalTutorials - completedCount,
      percentage: totalTutorials > 0 ? (completedCount / totalTutorials) * 100 : 0,
      completedIds: Array.from(this.completedTutorials)
    };
  }

  /**
   * 按类别获取教程
   * @param {string} category - 类别
   * @returns {Array} 教程列表
   */
  getTutorialsByCategory(category) {
    return Array.from(this.definitionRepository.values())
      .filter(t => t.category === category);
  }

  /**
   * 获取未完成的教程
   * @returns {Array} 未完成的教程列表
   */
  getIncompleteTutorials() {
    return Array.from(this.definitionRepository.values())
      .filter(t => !this.completedTutorials.has(t.id));
  }

  /**
   * 保存教程进度
   * @returns {Object} 进度数据
   */
  saveProgress() {
    return {
      completedTutorials: Array.from(this.completedTutorials),
      enabled: this.enabled,
      currentTutorialId: this.currentTutorial?.id || null,
      currentStepIndex: this.currentStepIndex,
      signalProgress: Object.fromEntries(this.signalProgress),
      movementOrigins: Object.fromEntries(this.movementOrigins)
    };
  }

  /**
   * 加载教程进度
   * @param {Object} progressData - 进度数据
   */
  loadProgress(progressData) {
    // 直接丢弃旧表现与等待队列，不触发 onHide；读档不能让陈旧回调推进剧情。
    this.pendingTutorials.length = 0;
    this.currentTutorial = null;
    this.currentStepIndex = 0;
    this.pauseGame = false;
    if (!progressData || typeof progressData !== 'object') return;

    this.completedTutorials = new Set(
      Array.isArray(progressData.completedTutorials)
        ? progressData.completedTutorials.filter(id => typeof id === 'string')
        : []
    );
    if (progressData.enabled !== undefined) this.enabled = progressData.enabled === true;
    this.signalProgress = new Map(Object.entries(progressData.signalProgress || {})
      .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))]));
    this.movementOrigins = new Map(Object.entries(progressData.movementOrigins || {})
      .filter(([, value]) => Number.isFinite(value?.x) && Number.isFinite(value?.y)));
  }

  /**
   * 在全部领域状态恢复成功后重投影存档中的当前教程步骤。
   * 此方法不重放 Trigger，也不会恢复已完成或不属于当前场景的教程。
   */
  restorePresentation(progressData, context = {}) {
    if (!progressData || typeof progressData !== 'object' || !this.enabled) return false;
    const tutorialId = progressData.currentTutorialId;
    const tutorial = typeof tutorialId === 'string'
      ? this.definitionRepository.get(tutorialId)
      : null;
    const stepIndex = Number(progressData.currentStepIndex);
    const normalizedContext = context && typeof context === 'object' ? context : {};
    const scope = normalizedContext.scope ?? normalizedContext;
    if (!tutorial || this.completedTutorials.has(tutorialId)
      || !matchesScope(tutorial, scope)
      || !Number.isInteger(stepIndex)
      || stepIndex < 0 || stepIndex >= tutorial.steps.length) return false;

    this.pendingTutorials.length = 0;
    this.currentTutorial = tutorial;
    this.pauseGame = tutorial.pauseGame;
    this.showStep(stepIndex, { ...normalizedContext, restored: true });
    return this.currentTutorial?.id === tutorialId && this.currentStepIndex === stepIndex;
  }

  /**
   * 清理资源（场景退出时调用）
   */
  cleanup() {
    // 隐藏当前教程
    if (this.currentTutorial) {
      this.hideTutorial();
    }
    
    // 清除所有回调
    this.onShowCallback = null;
    this.onHideCallback = null;
    this.onCompleteCallback = null;
  }

  /**
   * 清除所有教程
   */
  clearAllTutorials() {
    this.setDefinitionRepository(new TutorialDefinitionRepository());
    this.completedTutorials.clear();
    this.signalProgress.clear();
    this.movementOrigins.clear();
    this.hideTutorial();
  }
}

export default TutorialSystem;

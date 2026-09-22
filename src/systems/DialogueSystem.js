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
 * 对话系统
 * 
 * 职责：
 * - 对话节点管理
 * - 打字机效果
 * - 对话选择分支
 * - 对话历史记录
 * 
 * 需求：6, 9, 35
 */

export class DialogueSystem {
  constructor() {
    // 对话注册表
    this.dialogues = new Map();
    
    // 当前对话
    this.currentDialogue = null;
    
    // 当前节点
    this.currentNode = null;
    
    // 打字机效果状态
    this.typewriterState = {
      isTyping: false,
      currentText: '',
      displayedText: '',
      currentIndex: 0,
      speed: 50, // 每个字符的显示时间（毫秒）
      timer: 0
    };
    
    // 对话历史
    this.history = [];
    
    // 最大历史记录数
    this.maxHistorySize = 50;
    
    // 已完整播完的对话 id（供 NPC 重复交互、触发器条件判定）
    this.completedDialogues = new Set();

    // 回调函数
    this.onStartCallback = null;
    this.onNodeChangeCallback = null;
    this.onEndCallback = null;
    this.onChoiceCallback = null;
    this._choiceListeners = [];
    this._choiceDispatcher = null;
    this._pendingChoice = null;
    
    // 是否启用打字机效果
    this.enableTypewriter = true;
    
    // 是否可以跳过打字机效果
    this.canSkipTypewriter = true;
  }

  /**
   * 注册对话
   * @param {string} dialogueId - 对话ID
   * @param {Object} dialogueData - 对话数据
   * @returns {boolean} 是否注册成功
   */
  registerDialogue(dialogueId, dialogueData) {
    if (!dialogueId || !dialogueData) {
      console.error('DialogueSystem: 无效的对话ID或数据');
      return false;
    }

    const dialogue = {
      id: dialogueId,
      title: dialogueData.title || '',
      startNode: dialogueData.startNode || 'start',
      nodes: new Map(),
      variables: dialogueData.variables || {},
      metadata: dialogueData.metadata || {},
      // FlowGroup 外键（双轨兼容：flowGroupId 优先，sceneEventId 回退；两者同值双写）
      flowGroupId: dialogueData.flowGroupId || dialogueData.sceneEventId || null,
      sceneEventId: dialogueData.flowGroupId || dialogueData.sceneEventId || null
    };

    // 转换节点为Map
    if (dialogueData.nodes) {
      if (dialogueData.nodes instanceof Map) {
        dialogue.nodes = dialogueData.nodes;
      } else if (typeof dialogueData.nodes === 'object') {
        Object.entries(dialogueData.nodes).forEach(([nodeId, nodeData]) => {
          dialogue.nodes.set(nodeId, nodeData);
        });
      }
    }

    this.dialogues.set(dialogueId, dialogue);
    return true;
  }

  /**
   * 开始对话
   * @param {string} dialogueId - 对话ID
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否开始成功
   */
  startDialogue(dialogueId, context = {}) {
    // 获取对话
    const dialogue = this.dialogues.get(dialogueId);
    if (!dialogue) {
      console.warn(`DialogueSystem: 对话不存在: ${dialogueId}`);
      return false;
    }

    // 检查是否有对话正在进行（同一场对话重复启动幂等成功——场景代码与任务触发器双路编排收敛为单场播放）
    if (this.currentDialogue) {
      if (this.currentDialogue.id === dialogueId) return true;
      console.warn('DialogueSystem: 已有对话正在进行');
      return false;
    }

    // 设置当前对话
    this.currentDialogue = dialogue;
    
    // 跳转到起始节点
    this.goToNode(dialogue.startNode, context);

    // 触发开始回调
    if (this.onStartCallback) {
      this.onStartCallback(dialogue, context);
    }

    // 记录历史
    this.addToHistory({
      type: 'start',
      dialogueId,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * 跳转到指定节点
   * @param {string} nodeId - 节点ID
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否跳转成功
   */
  goToNode(nodeId, context = {}) {
    if (!this.currentDialogue) {
      return false;
    }

    // 获取节点
    const node = this.currentDialogue.nodes.get(nodeId);
    if (!node) {
      console.warn(`DialogueSystem: 节点不存在: ${nodeId}`);
      return false;
    }

    // 设置当前节点
    this.currentNode = {
      id: nodeId,
      speaker: node.speaker || '',
      text: node.text || '',
      portrait: node.portrait || null,
      emotion: node.emotion || 'neutral',
      choices: node.choices || [],
      nextNode: node.nextNode || null,
      condition: node.condition || null,
      action: node.action || null,
      delay: node.delay || 0
    };

    // 检查条件
    if (this.currentNode.condition && !this.currentNode.condition(context)) {
      // 条件不满足，跳过此节点
      if (this.currentNode.nextNode) {
        return this.goToNode(this.currentNode.nextNode, context);
      } else {
        this.endDialogue();
        return false;
      }
    }

    // 执行节点动作
    if (this.currentNode.action) {
      this.currentNode.action(context);
    }

    // 开始打字机效果
    if (this.enableTypewriter) {
      this.startTypewriter(this.currentNode.text);
    }

    // 触发节点变化回调
    if (this.onNodeChangeCallback) {
      this.onNodeChangeCallback(this.currentNode, context);
    }

    // 记录历史
    this.addToHistory({
      type: 'node',
      nodeId,
      speaker: this.currentNode.speaker,
      text: this.currentNode.text,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * 选择对话选项
   * @param {number} choiceIndex - 选项索引
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否选择成功
   */
  selectChoice(choiceIndex, context = {}) {
    if (!this.currentNode || !this.currentNode.choices || this._pendingChoice) return false;
    const choice = this.currentNode.choices[choiceIndex];
    if (!choice) {
      console.warn(`DialogueSystem: 选项不存在: ${choiceIndex}`);
      return false;
    }
    if (choice.condition && !choice.condition(context)) {
      console.warn('DialogueSystem: 选项条件不满足');
      return false;
    }

    const pending = {
      dialogue: this.currentDialogue,
      node: this.currentNode,
      dialogueId: this.currentDialogue.id,
      choiceId: choice.id || null,
      choiceIndex
    };
    this._pendingChoice = pending;

    const commit = () => {
      if (this._pendingChoice !== pending
        || this.currentDialogue !== pending.dialogue
        || this.currentNode !== pending.node) return false;
      this.addToHistory({
        type: 'choice', choiceIndex, choiceId: choice.id || null,
        choiceText: choice.text, timestamp: Date.now()
      });
      for (const callback of [...this._choiceListeners]) {
        try { callback(choice, choiceIndex, context); } catch (error) {
          console.warn('DialogueSystem: onChoice 监听器出错', error);
        }
      }
      if (!this._choiceListeners.length && this.onChoiceCallback) {
        this.onChoiceCallback(choice, choiceIndex, context);
      }
      return choice.nextNode ? this.goToNode(choice.nextNode, context) : (this.endDialogue(), true);
    };

    let dispatch;
    try {
      dispatch = this._choiceDispatcher?.({
        type: 'dialogueChoice', id: pending.dialogueId, dialogueId: pending.dialogueId,
        choiceId: pending.choiceId, index: choiceIndex,
        nextNode: choice.nextNode || null
      }, context);
    } catch (error) {
      if (this._pendingChoice === pending) this._pendingChoice = null;
      console.warn('DialogueSystem: dialogueChoice 编排失败', error);
      return false;
    }

    if (!dispatch || typeof dispatch.then !== 'function') {
      const accepted = dispatch !== false && dispatch?.ok !== false;
      const result = accepted ? commit() : false;
      if (this._pendingChoice === pending) this._pendingChoice = null;
      return result;
    }
    return Promise.resolve(dispatch)
      .then(result => (result === false || result?.ok === false ? false : commit()))
      .catch(error => {
        console.warn('DialogueSystem: dialogueChoice 编排失败', error);
        return false;
      })
      .finally(() => {
        if (this._pendingChoice === pending) this._pendingChoice = null;
      });
  }

  /**
   * 继续到下一个节点（无选择时）
   * @param {Object} context - 上下文数据
   * @returns {boolean} 是否继续成功
   */
  continue(context = {}) {
    if (!this.currentNode) {
      return false;
    }

    // 如果正在打字，跳过打字机效果
    if (this.typewriterState.isTyping && this.canSkipTypewriter) {
      this.skipTypewriter();
      return true;
    }

    // 如果有选项，不能直接继续
    if (this.currentNode.choices && this.currentNode.choices.length > 0) {
      return false;
    }

    // 跳转到下一个节点
    if (this.currentNode.nextNode) {
      return this.goToNode(this.currentNode.nextNode, context);
    } else {
      // 没有下一个节点，结束对话
      this.endDialogue();
      return true;
    }
  }

  /**
   * 结束对话
   */
  endDialogue() {
    if (!this.currentDialogue) {
      return;
    }

    const dialogue = this.currentDialogue;

    // 任何外部结束都会使在途 choice 失效，迟到的 Trigger 结果不得推进旧会话。
    this._pendingChoice = null;

    // 清除状态
    this.currentDialogue = null;
    this.currentNode = null;
    this.stopTypewriter();

    // 标记为已完成（在回调之前置位，监听器里查 hasCompleted 才拿得到正确结果）
    if (dialogue.id) this.completedDialogues.add(dialogue.id);

    // 触发所有结束监听器（多监听器：场景 fire dialogueEnd + 动作 await 等各自独立）
    if (this._endListeners && this._endListeners.length) {
      // 复制一份，避免监听器在回调中取消订阅导致遍历错乱
      for (const cb of [...this._endListeners]) {
        try { cb(dialogue); } catch (e) { console.warn('DialogueSystem: onEnd 监听器出错', e); }
      }
    } else if (this.onEndCallback) {
      this.onEndCallback(dialogue);
    }

    // 记录历史
    this.addToHistory({
      type: 'end',
      dialogueId: dialogue.id,
      timestamp: Date.now()
    });
  }

  /**
   * 开始打字机效果
   * @param {string} text - 要显示的文本
   */
  startTypewriter(text) {
    this.typewriterState.isTyping = true;
    this.typewriterState.currentText = text;
    this.typewriterState.displayedText = '';
    this.typewriterState.currentIndex = 0;
    this.typewriterState.timer = 0;
  }

  /**
   * 停止打字机效果
   */
  stopTypewriter() {
    this.typewriterState.isTyping = false;
    this.typewriterState.currentText = '';
    this.typewriterState.displayedText = '';
    this.typewriterState.currentIndex = 0;
    this.typewriterState.timer = 0;
  }

  /**
   * 跳过打字机效果
   */
  skipTypewriter() {
    if (!this.typewriterState.isTyping) {
      return;
    }

    this.typewriterState.displayedText = this.typewriterState.currentText;
    this.typewriterState.currentIndex = this.typewriterState.currentText.length;
    this.typewriterState.isTyping = false;
  }

  /**
   * 更新打字机效果
   * @param {number} deltaTime - 时间增量（毫秒）
   */
  updateTypewriter(deltaTime) {
    if (!this.typewriterState.isTyping) {
      return;
    }

    this.typewriterState.timer += deltaTime;

    while (this.typewriterState.timer >= this.typewriterState.speed) {
      this.typewriterState.timer -= this.typewriterState.speed;

      if (this.typewriterState.currentIndex < this.typewriterState.currentText.length) {
        this.typewriterState.displayedText += 
          this.typewriterState.currentText[this.typewriterState.currentIndex];
        this.typewriterState.currentIndex++;
      } else {
        this.typewriterState.isTyping = false;
        break;
      }
    }
  }

  /**
   * 更新对话系统（每帧调用）
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    if (this.enableTypewriter) {
      // 转换为毫秒传递给 updateTypewriter
      this.updateTypewriter(deltaTime * 1000);
    }
  }

  /**
   * 渲染对话系统（每帧调用）
   * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
   */
  render(ctx) {
    // 对话系统的渲染由 UI 组件（DialogueBox）负责
    // 这个方法保留用于未来可能的扩展
  }

  /**
   * 获取当前显示的文本
   * @returns {string} 当前显示的文本
   */
  getDisplayedText() {
    if (this.enableTypewriter && this.typewriterState.isTyping) {
      return this.typewriterState.displayedText;
    }
    return this.currentNode ? this.currentNode.text : '';
  }

  /**
   * 检查是否有对话正在进行
   * @returns {boolean} 是否有对话正在进行
   */
  isDialogueActive() {
    return this.currentDialogue !== null;
  }

  /**
   * 该对话是否已完整播完过
   * @param {string} dialogueId - 对话ID
   * @returns {boolean}
   */
  hasCompleted(dialogueId) {
    return !!dialogueId && this.completedDialogues.has(dialogueId);
  }

  /**
   * 清除某段对话的完成标记（供"可重复对话"或调试重播）
   * @param {string} [dialogueId] - 省略则清除全部
   */
  clearCompleted(dialogueId = null) {
    if (dialogueId) this.completedDialogues.delete(dialogueId);
    else this.completedDialogues.clear();
  }

  /**
   * 检查是否正在打字
   * @returns {boolean} 是否正在打字
   */
  isTyping() {
    return this.typewriterState.isTyping;
  }

  /**
   * 获取当前对话
   * @returns {Object|null} 当前对话
   */
  getCurrentDialogue() {
    return this.currentDialogue;
  }

  /**
   * 获取当前节点
   * @returns {Object|null} 当前节点
   */
  getCurrentNode() {
    return this.currentNode;
  }

  /**
   * 获取对话
   * @param {string} dialogueId - 对话ID
   * @returns {Object|null} 对话对象
   */
  getDialogue(dialogueId) {
    return this.dialogues.get(dialogueId) || null;
  }

  /**
   * 设置打字机速度
   * @param {number} speed - 速度（毫秒/字符）
   */
  setTypewriterSpeed(speed) {
    this.typewriterState.speed = Math.max(1, speed);
  }

  /**
   * 启用/禁用打字机效果
   * @param {boolean} enabled - 是否启用
   */
  setTypewriterEnabled(enabled) {
    this.enableTypewriter = enabled;
    if (!enabled) {
      this.stopTypewriter();
    }
  }

  /**
   * 设置是否可以跳过打字机效果
   * @param {boolean} canSkip - 是否可以跳过
   */
  setCanSkipTypewriter(canSkip) {
    this.canSkipTypewriter = canSkip;
  }

  /**
   * 设置开始回调
   * @param {Function} callback - 回调函数
   */
  onStart(callback) {
    this.onStartCallback = callback;
  }

  /**
   * 设置节点变化回调
   * @param {Function} callback - 回调函数
   */
  onNodeChange(callback) {
    this.onNodeChangeCallback = callback;
  }

  /**
   * 注册对话结束监听器（支持多个）。
   * @param {Function} callback - 回调 (dialogue) => void
   * @returns {Function} 取消订阅函数（调用后移除该监听器）
   */
  onEnd(callback) {
    if (typeof callback !== 'function') return () => {};
    if (!this._endListeners) this._endListeners = [];
    this._endListeners.push(callback);
    // 兼容旧代码：保留 onEndCallback 指向最近一个（不影响多监听器）
    this.onEndCallback = callback;
    return () => {
      const i = this._endListeners.indexOf(callback);
      if (i !== -1) this._endListeners.splice(i, 1);
      if (this.onEndCallback === callback) this.onEndCallback = null;
    };
  }

  setChoiceDispatcher(dispatcher) {
    const previous = this._choiceDispatcher;
    this._choiceDispatcher = typeof dispatcher === 'function' ? dispatcher : null;
    return () => {
      if (this._choiceDispatcher === dispatcher) this._choiceDispatcher = previous || null;
    };
  }

  /**
   * 注册选择监听器（仅在 dialogueChoice 编排成功并提交节点后触发）。
   * @param {Function} callback - (choice, choiceIndex, context) => void
   * @returns {Function} 取消订阅函数
   */
  onChoice(callback) {
    if (typeof callback !== 'function') return () => {};
    this._choiceListeners.push(callback);
    this.onChoiceCallback = callback;
    return () => {
      const index = this._choiceListeners.indexOf(callback);
      if (index !== -1) this._choiceListeners.splice(index, 1);
      if (this.onChoiceCallback === callback) {
        this.onChoiceCallback = this._choiceListeners[this._choiceListeners.length - 1] || null;
      }
    };
  }

  /**
   * 添加到历史记录
   * @param {Object} entry - 历史记录条目
   */
  addToHistory(entry) {
    this.history.push(entry);

    // 限制历史记录大小
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * 获取对话历史
   * @param {number} limit - 限制数量
   * @returns {Array} 历史记录
   */
  getHistory(limit = 10) {
    return this.history.slice(-limit);
  }

  /**
   * 清除历史记录
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * 获取对话变量
   * @param {string} key - 变量键
   * @returns {*} 变量值
   */
  getVariable(key) {
    return this.currentDialogue ? this.currentDialogue.variables[key] : undefined;
  }

  /**
   * 设置对话变量
   * @param {string} key - 变量键
   * @param {*} value - 变量值
   */
  setVariable(key, value) {
    if (this.currentDialogue) {
      this.currentDialogue.variables[key] = value;
    }
  }

  /**
   * 保存对话状态
   * @returns {Object} 状态数据
   */
  saveState() {
    return {
      currentDialogueId: this.currentDialogue ? this.currentDialogue.id : null,
      currentNodeId: this.currentNode ? this.currentNode.id : null,
      variables: this.currentDialogue ? { ...this.currentDialogue.variables } : {},
      history: [...this.history],
      completedDialogues: [...this.completedDialogues]
    };
  }

  /**
   * 加载对话状态
   * @param {Object} stateData - 状态数据
   * @param {Object} context - 上下文数据
   */
  loadState(stateData, context = {}) {
    if (!stateData) {
      return;
    }

    // 读档会替换当前会话投影；在途 choice 的迟到结果不得写入恢复后的会话。
    this._pendingChoice = null;
    this.currentDialogue = null;
    this.currentNode = null;
    this.stopTypewriter();

    // 恢复历史
    if (stateData.history) {
      this.history = [...stateData.history];
    }

    // 恢复已完成对话（决定 NPC 是否还会重复讲同一段剧情）
    if (Array.isArray(stateData.completedDialogues)) {
      this.completedDialogues = new Set(stateData.completedDialogues);
    }

    // 恢复对话
    if (stateData.currentDialogueId) {
      const dialogue = this.dialogues.get(stateData.currentDialogueId);
      if (dialogue) {
        this.currentDialogue = dialogue;

        // 恢复变量
        if (stateData.variables) {
          this.currentDialogue.variables = { ...stateData.variables };
        }

        // 恢复节点
        if (stateData.currentNodeId) {
          this.goToNode(stateData.currentNodeId, context);
        }
      }
    }
  }

  /**
   * 重置对话系统
   */
  reset() {
    this.currentDialogue = null;
    this.currentNode = null;
    this._pendingChoice = null;
    this.stopTypewriter();
    this.clearHistory();
  }

  /**
   * 清除所有对话
   */
  clearAllDialogues() {
    this.dialogues.clear();
    this.reset();
  }
}

export default DialogueSystem;

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
 * SkeletonEditorHistory - 骨骼编辑器撤销/重做栈
 *
 * 采用「延迟提交」快照语义：
 *   - push(doc)：只把当前文档序列化存为待提交快照，不立即入撤销栈；
 *   - 下一次 push 或 flush 时，比对「待提交快照 vs 当前文档」：
 *       相同 → 上一次操作没改动文档（空操作）→ 丢弃快照，不占撤销步；
 *       不同 → 上一次操作真的改了文档 → 把快照提交进撤销栈。
 *
 * 为什么需要延迟提交：编辑器在「操作开始前」压快照，若操作最终被拒绝
 * （点进输入框没改值就离开、删除被前置条件拦下、拖拽未产生位移等），
 * 快照已经入栈 → Ctrl+Z 先撤销一个「什么都没发生」的空步骤，
 * 表现为按了没反应，且 50 步上限迅速被空步骤冲掉。
 *
 * 跨文档安全：reset() 清空全部栈——换骨骼资产/模板时必须调用，
 * 否则 Ctrl+Z 会把上一个资产的文档快照恢复到当前编辑器。
 */
export class SkeletonEditorHistory {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxDepth] - 撤销栈深度上限（默认 50）
   */
  constructor({ maxDepth = 50 } = {}) {
    this.maxDepth = maxDepth;
    this._undoStack = [];
    this._redoStack = [];
    this._pending = null; // 待提交快照（JSON 字符串）
  }

  /** 撤销栈深度（已提交的快照数）。 */
  get undoDepth() {
    return this._undoStack.length;
  }

  /** 重做栈深度。 */
  get redoDepth() {
    return this._redoStack.length;
  }

  /** 是否存在待提交快照（供测试断言）。 */
  get hasPending() {
    return this._pending !== null;
  }

  /**
   * 记录一次「操作开始」：暂存当前文档快照。
   * 上一次操作留下的待提交快照在此刻结算（改动过则提交入栈）。
   * @param {Object} doc - 当前文档（会被 JSON.stringify 序列化）
   */
  push(doc) {
    if (!doc) return;
    const current = JSON.stringify(doc);
    if (this._pending !== null) {
      if (this._pending !== current) this._commitPending();
      // 相同 → 上一次操作无改动 → 丢弃快照，redo 栈保持不变
    }
    this._pending = current;
  }

  /**
   * 结算待提交快照（撤销/重做前调用）：最后一次操作若确实改动了文档，
   * 把它补进撤销栈，确保「最后一次操作」也能被撤销。
   * @param {Object} doc - 当前文档
   */
  flush(doc) {
    if (this._pending === null) return;
    if (this._pending !== JSON.stringify(doc)) this._commitPending();
    this._pending = null;
  }

  /**
   * 执行撤销：返回应恢复的文档快照（JSON 字符串），无可撤销时返回 null。
   * @param {Object} currentDoc - 当前文档（用于重做栈）
   */
  undo(currentDoc) {
    this.flush(currentDoc);
    if (!this._undoStack.length) return null;
    this._redoStack.push(JSON.stringify(currentDoc));
    return this._undoStack.pop();
  }

  /**
   * 执行重做：返回应恢复的文档快照（JSON 字符串），无可重做时返回 null。
   * @param {Object} currentDoc - 当前文档
   */
  redo(currentDoc) {
    this.flush(currentDoc);
    if (!this._redoStack.length) return null;
    this._undoStack.push(JSON.stringify(currentDoc));
    return this._redoStack.pop();
  }

  /** 清空全部历史（换文档/换资产时调用）。 */
  reset() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._pending = null;
  }

  /**
   * 提交待提交快照入撤销栈。
   * @private
   */
  _commitPending() {
    this._undoStack.push(this._pending);
    if (this._undoStack.length > this.maxDepth) this._undoStack.shift();
    this._redoStack.length = 0;
  }
}

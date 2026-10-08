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

/************************************************************
 * YiJian18-Engine - Single authoritative Save Data Document store
 ************************************************************/

/**
 * SddStore —— 单一权威存档文档（SDD）的内存持有者。
 *
 * 设计要点（见 .kiro/steering/single-authority-save-document-migration.md）：
 * - 文档是纯数据：任何业务守卫/副作用不得进入文档读写路径。
 * - 不可变：patch 走写时复制（沿路径浅拷贝），旧版本引用不受影响——
 *   回滚 = 换回上一版引用，模型层面不存在「逐系统逆序回滚」。
 * - 节点寻址：点路径（'quests.tasks.<id>'）读写；系统声明消费哪些节点。
 * - 订阅：patch 触达某路径（自身、祖先或后代）时通知订阅者，系统按数据重建运行时视图。
 * - schema 校验：validator 由宿主注入（JSON Schema 或函数），validate() 与提交前校验共用。
 */

/** 递归冻结文档节点（首次构建/导入时使用；patch 产物走写时复制浅冻结）。 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/** 点路径 → 段数组；空段过滤，非法输入返回空数组（= 文档根）。 */
function toSegments(path) {
  return String(path || '').split('.').filter(Boolean);
}

/** 按 segments 取节点；任一层缺失返回 undefined。 */
function nodeAt(document, segments) {
  let current = document;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

/** 沿 segments 写时复制地写入 value；返回新文档根。 */
function writeAtPath(document, segments, value) {
  if (segments.length === 0) return value;
  const base = document !== null && typeof document === 'object' ? document : {};
  const next = { ...base };
  const key = segments[0];
  next[key] = writeAtPath(next[key], segments.slice(1), value);
  return next;
}

/** 判断 patchPath 是否影响 watchPath（patch 在 watch 的根、自身或子树上）。 */
function affectsPath(patchPath, watchPath) {
  if (watchPath === '') return true;
  return patchPath === watchPath
    || patchPath.startsWith(`${watchPath}.`)
    || watchPath.startsWith(`${patchPath}.`);
}

export class SddStore {
  /**
   * @param {Object} [options]
   * @param {number} [options.schemaVersion] 文档 schema 版本（迁移链依据）
   * @param {Object|null} [options.document] 初始文档（默认空对象；会被深度冻结）
   * @param {Function|null} [options.validator] (document) => {ok, errors}
   */
  constructor({ schemaVersion = 3, document = null, validator = null, revision = 0 } = {}) {
    this.schemaVersion = Number(schemaVersion) || 3;
    this.validator = typeof validator === 'function' ? validator : null;
    this._document = deepFreeze(document && typeof document === 'object' ? document : {});
    this._revision = Number(revision) || 0;
    this._listeners = new Set();
  }

  /** 文档修订号：每次成功 patch 递增。 */
  get revision() {
    return this._revision;
  }

  /** 当前文档（只读约定：节点已冻结，patch 产生新文档）。 */
  get document() {
    return this._document;
  }

  /** 点路径取节点；path 为空串返回文档根。 */
  getNode(path = '') {
    return nodeAt(this._document, toSegments(path));
  }

  /**
   * 节点写入（写时复制）。value 为直接值；updater 为 (currentNode) => nextNode。
   * 中间节点不存在时自动创建空对象。写入成功后 revision 递增并通知订阅者。
   * @returns {{ok: boolean, path: string, errors?: Array}}
   */
  patchNode(path, valueOrUpdater) {
    const segments = toSegments(path);
    const current = nodeAt(this._document, segments);
    const next = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(current)
      : valueOrUpdater;
    if (next === undefined) {
      // undefined 视为删除该节点：对父节点 patch 掉该键
      if (segments.length === 0) {
        return { ok: false, path, errors: [{ code: 'sddRootDeleteUnsupported', message: '不能将文档根置为 undefined' }] };
      }
      const parentSegments = segments.slice(0, -1);
      const parent = nodeAt(this._document, parentSegments);
      if (parent === undefined || typeof parent !== 'object' || !(segments[segments.length - 1] in parent)) {
        return { ok: true, path }; // 目标本就不存在，幂等
      }
      const parentCopy = { ...parent };
      delete parentCopy[segments[segments.length - 1]];
      this._commit(parentCopy, parentSegments);
      return { ok: true, path };
    }
    this._commit(next, segments);
    return { ok: true, path };
  }

  /** @private 提交新文档并广播。 */
  _commit(newSubtree, segments) {
    const nextDocument = segments.length === 0
      ? newSubtree
      : writeAtPath(this._document, segments, newSubtree);
    this._document = deepFreeze(nextDocument);
    this._revision += 1;
    this._notify(segments);
  }

  /**
   * 订阅节点变化：patch 命中自身、祖先或后代路径时触发。
   * @returns {Function} 取消订阅
   */
  subscribe(path, listener) {
    const entry = { path: String(path || ''), listener };
    this._listeners.add(entry);
    return () => this._listeners.delete(entry);
  }

  /** 手动触发 schema 校验；validator 未注入时视为通过。 */
  validate() {
    if (!this.validator) return { ok: true, errors: [] };
    try {
      const result = this.validator(this._document);
      return result && result.ok === false
        ? { ok: false, errors: result.errors || [] }
        : { ok: true, errors: [] };
    } catch (error) {
      return { ok: false, errors: [{ code: 'sddValidatorThrew', message: String(error?.message || error) }] };
    }
  }

  /** 序列化形态（与运行时文档解耦的纯 JSON）。 */
  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      revision: this._revision,
      document: JSON.parse(JSON.stringify(this._document))
    };
  }

  /** 从序列化形态重建（新 store，revision 延续）。 */
  static fromJSON(json, options = {}) {
    if (!json || json.schemaVersion == null) {
      throw new Error('SddStore.fromJSON: 缺少 schemaVersion');
    }
    return new SddStore({
      ...options,
      schemaVersion: json.schemaVersion,
      document: json.document || {},
      revision: Number(json.revision) || 0
    });
  }

  // ─── 内部 ───

  /** 通知订阅者（patchSegments 为本次 patch 的路径）。 */
  _notify(patchSegments) {
    const patchPath = patchSegments.join('.');
    for (const entry of [...this._listeners]) {
      if (!affectsPath(patchPath, entry.path)) continue;
      try {
        entry.listener(this.getNode(entry.path), patchPath);
      } catch (error) {
        // 订阅者异常不得阻断文档提交（与 SnapshotManager 回滚通知一致语义）
        console.warn('SddStore: 订阅者回调失败', entry.path, error);
      }
    }
  }
}

export default SddStore;

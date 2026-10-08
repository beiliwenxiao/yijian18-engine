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

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function parsePath(path) {
  if (Array.isArray(path)) return path.slice();
  if (path === '' || path == null) return [];
  if (String(path).startsWith('/')) {
    return String(path).slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  const tokens = [];
  String(path).replace(/([^[.\]]+)|\[(\d+|"[^"]*"|'[^']*')\]/g, (_match, plain, bracket) => {
    const token = plain ?? bracket;
    tokens.push(/^\d+$/.test(token) ? Number(token) : token.replace(/^(?:"|')|(?:"|')$/g, ''));
    return _match;
  });
  return tokens;
}

function assertSafeTokens(tokens) {
  for (const token of tokens) {
    if (['__proto__', 'prototype', 'constructor'].includes(String(token))) {
      throw new TypeError(`不安全的 canonical path: ${String(token)}`);
    }
  }
}

function pathKey(tokens) {
  return tokens.length === 0 ? '' : tokens.map(token => typeof token === 'number' ? `[${token}]` : String(token)).join('.').replace(/\.\[/g, '[');
}
function applyOperation(root, operation) {
  const tokens = parsePath(operation.path);
  assertSafeTokens(tokens);
  if (tokens.length === 0) {
    if (operation.op === 'delete') throw new TypeError('不能删除 canonical 根文档');
    return clone(operation.value);
  }
  const draft = clone(root);
  let owner = draft;
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index];
    if (!owner || typeof owner !== 'object' || !(token in owner)) {
      throw new TypeError(`canonical path 不存在: ${pathKey(tokens.slice(0, index + 1))}`);
    }
    owner = owner[token];
  }
  const key = tokens[tokens.length - 1];
  if (!owner || typeof owner !== 'object') throw new TypeError(`canonical path 父节点无效: ${pathKey(tokens)}`);
  if (operation.op === 'delete') {
    if (Array.isArray(owner) && typeof key === 'number') owner.splice(key, 1);
    else delete owner[key];
  } else {
    owner[key] = clone(operation.value);
  }
  return draft;
}

/** 单一打开项目的 canonical 编辑状态；所有编辑器共享 path patch 与历史。 */
export class CanonicalDocumentModel {
  constructor({ sourceUri, schemaId, canonical, snapshotRevision = 0, historyLimit = 100 } = {}) {
    if (!sourceUri) throw new TypeError('CanonicalDocumentModel requires sourceUri');
    if (!schemaId) throw new TypeError('CanonicalDocumentModel requires schemaId');
    if (canonical === undefined) throw new TypeError('CanonicalDocumentModel requires canonical');
    this.sourceUri = sourceUri;
    this.schemaId = schemaId;
    this.snapshotRevision = snapshotRevision;
    this.historyLimit = historyLimit;
    this.originalCanonical = deepFreeze(clone(canonical));
    this.workingCopy = clone(canonical);
    this.dirtyPaths = new Set();
    this._undoStack = [];
    this._redoStack = [];
  }

  patch(path, value, { op = 'set' } = {}) {
    return this.patchMany([{ path, value, op }]);
  }

  patchMany(operations) {
    if (!Array.isArray(operations) || operations.length === 0) return this.workingCopy;
    const before = clone(this.workingCopy);
    let next = before;
    for (const operation of operations) next = applyOperation(next, operation);
    this._undoStack.push({ value: before, dirtyPaths: [...this.dirtyPaths] });
    if (this._undoStack.length > this.historyLimit) this._undoStack.shift();
    this._redoStack = [];
    this.workingCopy = next;
    for (const operation of operations) this.dirtyPaths.add(pathKey(parsePath(operation.path)));
    return this.workingCopy;
  }
  replaceWorkingCopy(candidate, { dirtyPath = '' } = {}) {
    return this.patch(dirtyPath, candidate);
  }

  undo() {
    const previous = this._undoStack.pop();
    if (!previous) return false;
    this._redoStack.push({ value: clone(this.workingCopy), dirtyPaths: [...this.dirtyPaths] });
    this.workingCopy = previous.value;
    this.dirtyPaths = new Set(previous.dirtyPaths);
    return true;
  }

  redo() {
    const next = this._redoStack.pop();
    if (!next) return false;
    this._undoStack.push({ value: clone(this.workingCopy), dirtyPaths: [...this.dirtyPaths] });
    this.workingCopy = next.value;
    this.dirtyPaths = new Set(next.dirtyPaths);
    return true;
  }

  commitSnapshot(canonical, { snapshotRevision = this.snapshotRevision + 1 } = {}) {
    const committed = clone(canonical);
    this.originalCanonical = deepFreeze(clone(committed));
    this.workingCopy = committed;
    this.snapshotRevision = snapshotRevision;
    this.dirtyPaths.clear();
    this._undoStack = [];
    this._redoStack = [];
    return this.getCommittedSnapshot();
  }

  discardWorkingCopy() {
    this.workingCopy = clone(this.originalCanonical);
    this.dirtyPaths.clear();
    this._undoStack = [];
    this._redoStack = [];
  }

  getCandidate() { return clone(this.workingCopy); }
  getCommittedSnapshot() { return clone(this.originalCanonical); }
  get isDirty() { return this.dirtyPaths.size > 0; }
  get canUndo() { return this._undoStack.length > 0; }
  get canRedo() { return this._redoStack.length > 0; }
}

export default CanonicalDocumentModel;

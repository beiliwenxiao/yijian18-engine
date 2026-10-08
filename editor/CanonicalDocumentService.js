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

import { CanonicalDocumentModel } from './CanonicalDocumentModel.js';

function normalizeUri(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** 由编辑器组合根创建；按项目 URI 保证同一时刻只有一个 CanonicalDocumentModel。 */
export class CanonicalDocumentService {
  constructor({ ModelClass = CanonicalDocumentModel } = {}) {
    this.ModelClass = ModelClass;
    this._models = new Map();
  }

  openProject({ sourceUri, schemaId = 'canonicalProjectClosure', canonical, snapshotRevision = 0 } = {}) {
    const key = normalizeUri(sourceUri);
    if (!key) throw new TypeError('CanonicalDocumentService.openProject requires sourceUri');
    const existing = this._models.get(key);
    if (existing) {
      if (existing.schemaId !== schemaId) throw new TypeError(`项目已用不同 schema 打开: ${key}`);
      return existing;
    }
    const model = new this.ModelClass({ sourceUri: key, schemaId, canonical, snapshotRevision });
    this._models.set(key, model);
    return model;
  }

  getProject(sourceUri) { return this._models.get(normalizeUri(sourceUri)) || null; }
  requireProject(sourceUri) {
    const model = this.getProject(sourceUri);
    if (!model) throw new Error(`canonical 项目尚未打开: ${normalizeUri(sourceUri)}`);
    return model;
  }

  patch(sourceUri, path, value, options) { return this.requireProject(sourceUri).patch(path, value, options); }
  patchMany(sourceUri, operations) { return this.requireProject(sourceUri).patchMany(operations); }
  undo(sourceUri) { return this.requireProject(sourceUri).undo(); }
  redo(sourceUri) { return this.requireProject(sourceUri).redo(); }

  commit(sourceUri, canonical, options) {
    return this.requireProject(sourceUri).commitSnapshot(canonical, options);
  }

  rebuildFromCommitted(sourceUri, canonical, options) {
    const model = this.requireProject(sourceUri);
    model.commitSnapshot(canonical, options);
    return model;
  }

  closeProject(sourceUri) { return this._models.delete(normalizeUri(sourceUri)); }
  get openProjectCount() { return this._models.size; }
}

export default CanonicalDocumentService;

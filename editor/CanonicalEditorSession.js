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

import { SchemaFieldEditor } from './SchemaFieldEditor.js';

/**
 * 配置/场景编辑器共享绑定：仅保存根 path 和 UI schema 投影，文档、undo 与提交均由共享服务拥有。
 */
export class CanonicalEditorSession {
  constructor({ sourceUri, documentService, commandService, schemaRegistry, schemaId = 'gameProject', rootPath = 'project', catalogs = {}, consumptionRegistry = null } = {}) {
    if (!sourceUri || !documentService || !commandService) throw new TypeError('CanonicalEditorSession requires shared canonical services');
    this.sourceUri = sourceUri;
    this.documentService = documentService;
    this.commandService = commandService;
    this.rootPath = rootPath;
    this.dirtyRootPaths = new Set();
    this.fields = new SchemaFieldEditor({
      registry: schemaRegistry,
      documentModel: documentService.requireProject(sourceUri),
      schemaId,
      rootPath,
      catalogs,
      consumptionRegistry
    });
  }

  get model() { return this.documentService.requireProject(this.sourceUri); }
  getValue(path = '') { return this.fields.getValue(path); }
  describe(path = '') { return this.fields.describe(path); }

  patch(path, value, options) {
    const result = this.fields.patch(path, value, options);
    this.dirtyRootPaths.add(this._rootFor(path));
    return result;
  }

  patchMany(operations) {
    const result = this.fields.patchMany(operations);
    operations.forEach(operation => this.dirtyRootPaths.add(this._rootFor(operation.path)));
    return result;
  }

  replace(value) { return this.patch('', value); }
  remove(path) {
    const result = this.fields.remove(path);
    this.dirtyRootPaths.add(this._rootFor(path));
    return result;
  }
  undo() { return this.documentService.undo(this.sourceUri); }
  redo() { return this.documentService.redo(this.sourceUri); }

  /**
   * 接收已由专用原子事务提交的完整工程快照，避免随后普通保存覆写其 Manifest 关联改动。
   */
  acceptExternalProjectCommit(project, { snapshotRevision = null } = {}) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new TypeError('acceptExternalProjectCommit requires a project object');
    }
    const candidate = this.model.getCandidate();
    const canonical = { ...candidate, project: structuredClone(project) };
    this.documentService.commit(this.sourceUri, canonical, {
      snapshotRevision: snapshotRevision ?? this.model.snapshotRevision + 1
    });
    this.dirtyRootPaths.clear();
    return canonical;
  }

  async save(extra = {}) {
    const rootPaths = this.dirtyRootPaths.size > 0 ? [...this.dirtyRootPaths] : [this.rootPath];
    const result = await this.commandService.save(this.sourceUri, { ...extra, rootPaths });
    if (result?.ok === true && result.committed === true) this.dirtyRootPaths.clear();
    return result;
  }

  _rootFor(path) {
    if (!path) return this.rootPath;
    const first = String(path).match(/^[^[.]+/)?.[0];
    return first ? `${this.rootPath}.${first}` : this.rootPath;
  }
}

export default CanonicalEditorSession;

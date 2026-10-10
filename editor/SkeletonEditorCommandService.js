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
 * SkeletonEditorCommandService - 骨骼动画编辑器的浏览器提交服务。
 *
 * 保存走 /api/skeleton-asset-transaction 原子事务（骨骼 JSON 落盘 +
 * Asset Manifest 同步 upsert）；manifest 读取走 dev server 静态文件。
 */

const normalizeProjectPath = value => String(value || '')
  .replace(/\\/g, '/')
  .replace(/^(?:\.\.\/)+/, '')
  .replace(/^\/+/, '');

export class SkeletonEditorCommandService {
  constructor({ endpoint = '/api/skeleton-asset-transaction', fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('SkeletonEditorCommandService requires fetch');
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this._queue = Promise.resolve();
  }

  /** 串行提交骨骼资产（同一时刻只有一个磁盘事务，避免并发覆盖）。options.template=true 写回 templates/ 且不动 Manifest。 */
  saveSkeleton(projectPath, document, options = {}) {
    const normalized = normalizeProjectPath(projectPath);
    const template = options?.template === true;
    const current = this._queue
      .catch(() => undefined)
      .then(() => this._save(normalized, document, template));
    this._queue = current;
    return current;
  }

  async _save(projectPath, document, template = false) {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, skeletons: [{ document, template }] })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true || payload.committed !== true) {
        return {
          ...payload,
          ok: false,
          committed: false,
          error: payload?.error || payload?.error?.message || `骨骼资产提交失败（HTTP ${response.status}）`
        };
      }
      return payload;
    } catch (error) {
      return { ok: false, committed: false, error: error?.message || String(error) };
    }
  }

  /** 读取 Asset Manifest（稳定 ID 目录）。 */
  async fetchManifest(gameRoot) {
    const response = await this.fetchImpl(`/${gameRoot}/assets/manifests/assets.json`);
    if (!response.ok) throw new Error(`Manifest 读取失败（HTTP ${response.status}）`);
    return response.json();
  }

  /** 读取内容库（skeletonParts 部件定义等）。 */
  async fetchLibrary(gameRoot) {
    const response = await this.fetchImpl(`/${gameRoot}/project/library.json`);
    if (!response.ok) throw new Error(`内容库读取失败（HTTP ${response.status}）`);
    return response.json();
  }

  /** 读取骨骼资产 JSON 文档。 */
  async fetchSkeletonDocument(url) {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`骨骼资产读取失败（HTTP ${response.status}）`);
    return response.json();
  }

  /** 保存动作预设（走同一事务端点的 presets 通道，写 assets/skeletons/anim-presets/，不动 Manifest）。 */
  savePreset(projectPath, preset) {
    const normalized = normalizeProjectPath(projectPath);
    const current = this._queue
      .catch(() => undefined)
      .then(() => this._savePreset(normalized, preset));
    this._queue = current;
    return current;
  }

  async _savePreset(projectPath, preset) {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, presets: [{ preset }] })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true || payload.committed !== true) {
        return {
          ...payload,
          ok: false,
          committed: false,
          error: payload?.error || payload?.error?.message || `动作预设提交失败（HTTP ${response.status}）`
        };
      }
      return payload;
    } catch (error) {
      return { ok: false, committed: false, error: error?.message || String(error) };
    }
  }
}

export default SkeletonEditorCommandService;

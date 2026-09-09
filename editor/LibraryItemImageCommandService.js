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

const normalizeProjectPath = value => String(value || '')
  .replace(/\\/g, '/')
  .replace(/^(?:\.\.\/)+/, '')
  .replace(/^\/+/, '');

function postJsonWithXhr(endpoint, body) {
  return new Promise((resolve, reject) => {
    const request = new globalThis.XMLHttpRequest();
    request.open('POST', endpoint, true);
    request.setRequestHeader('Content-Type', 'application/json');
    request.onload = () => {
      let payload = {};
      try { payload = JSON.parse(request.responseText || '{}'); } catch (_error) { /* 保持空响应，交给统一失败分支 */ }
      resolve({
        response: { ok: request.status >= 200 && request.status < 300, status: request.status },
        payload
      });
    };
    request.onerror = () => reject(new Error('内容库图片请求失败'));
    request.onabort = () => reject(new Error('内容库图片请求已取消'));
    request.send(JSON.stringify(body));
  });
}

/**
 * 内容库物品图片的唯一浏览器提交服务。
 * 服务端负责校验并在一次原子事务中写入 library、Asset Manifest 与可选 PNG 文件。
 */
export class LibraryItemImageCommandService {
  constructor({ endpoint = '/api/library-item-image-transaction', fetchImpl = null } = {}) {
    if (fetchImpl != null && typeof fetchImpl !== 'function') throw new TypeError('LibraryItemImageCommandService requires fetch');
    if (fetchImpl == null && typeof globalThis.XMLHttpRequest !== 'function') {
      throw new TypeError('LibraryItemImageCommandService requires XMLHttpRequest or fetch');
    }
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this._queues = new Map();
  }

  save(projectPath, { library, imageUpdates } = {}) {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const previous = this._queues.get(normalizedProjectPath) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this._save(normalizedProjectPath, { library, imageUpdates }));
    this._queues.set(normalizedProjectPath, current);
    return current.finally(() => {
      if (this._queues.get(normalizedProjectPath) === current) this._queues.delete(normalizedProjectPath);
    });
  }

  async _save(projectPath, { library, imageUpdates }) {
    if (!projectPath.endsWith('/game.project.json')) {
      return { ok: false, committed: false, status: 'rejected', code: 'invalidProjectPath', error: 'projectPath 无效' };
    }
    if (!library || typeof library !== 'object' || Array.isArray(library) || !Array.isArray(imageUpdates) || imageUpdates.length === 0) {
      return { ok: false, committed: false, status: 'rejected', code: 'invalidImageTransaction', error: 'library 或 imageUpdates 无效' };
    }

    const body = {
      projectPath,
      library: structuredClone(library),
      imageUpdates: structuredClone(imageUpdates)
    };
    try {
      let response;
      let payload;
      if (this.fetchImpl) {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        payload = await response.json().catch(() => ({}));
      } else {
        ({ response, payload } = await postJsonWithXhr(this.endpoint, body));
      }
      if (!response.ok || payload?.ok !== true || payload.committed !== true) {
        return {
          ...payload,
          ok: false,
          committed: false,
          status: payload?.status || 'rejected',
          code: payload?.code || 'libraryItemImageCommitFailed',
          error: payload?.error || `内容库图片提交失败（HTTP ${response.status}）`
        };
      }
      return payload;
    } catch (error) {
      return { ok: false, committed: false, status: 'failed', code: 'libraryItemImageRequestFailed', error };
    }
  }
}

export default LibraryItemImageCommandService;

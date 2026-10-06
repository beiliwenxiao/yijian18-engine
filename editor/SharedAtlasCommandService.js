const normalizeProjectPath = value => String(value || '')
  .replace(/\\/g, '/')
  .replace(/^(?:\.\.\/)+/, '')
  .replace(/^\/+/, '');

/**
 * 当前游戏共享图集 catalog 的唯一浏览器提交服务。
 * 服务端负责校验 catalog、同步 Manifest，并在同一磁盘事务中提交两者。
 */
export class SharedAtlasCommandService {
  constructor({ endpoint = '/api/asset-transaction', fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('SharedAtlasCommandService requires fetch');
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this._queues = new Map();
  }

  save(projectPath, catalog) {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const previous = this._queues.get(normalizedProjectPath) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this._save(normalizedProjectPath, catalog));
    this._queues.set(normalizedProjectPath, current);
    return current.finally(() => {
      if (this._queues.get(normalizedProjectPath) === current) {
        this._queues.delete(normalizedProjectPath);
      }
    });
  }

  async _save(projectPath, catalog) {
    if (!projectPath.endsWith('/game.project.json')) {
      return {
        ok: false,
        committed: false,
        status: 'rejected',
        code: 'invalidProjectPath',
        error: 'projectPath 无效'
      };
    }

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, catalog: structuredClone(catalog) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true || payload.committed !== true) {
        return {
          ...payload,
          ok: false,
          committed: false,
          status: payload?.status || 'rejected',
          code: payload?.code || 'sharedAtlasCommitFailed',
          error: payload?.error || `共享图集提交失败（HTTP ${response.status}）`
        };
      }
      return payload;
    } catch (error) {
      return {
        ok: false,
        committed: false,
        status: 'failed',
        code: 'sharedAtlasRequestFailed',
        error
      };
    }
  }
}

export default SharedAtlasCommandService;

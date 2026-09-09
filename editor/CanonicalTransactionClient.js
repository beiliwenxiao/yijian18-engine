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

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^(?:\.\.\/)+/, '').replace(/^\//, '');
}

export function projectPathForCanonicalFile(filePath) {
  const normalized = normalizePath(filePath);
  if (normalized.endsWith('/game.project.json')) return normalized;
  const marker = '/assets/scenes/';
  const index = normalized.indexOf(marker);
  if (index < 0) throw new Error(`不是 canonical 项目/场景路径: ${normalized}`);
  return `${normalized.slice(0, index)}/game.project.json`;
}

export async function commitCanonicalChanges(projectPath, changes, { fetchImpl = null } = {}) {
  if (fetchImpl != null && typeof fetchImpl !== 'function') throw new TypeError('canonical transaction requires fetch');
  if (fetchImpl == null && typeof globalThis.fetch !== 'function') throw new TypeError('canonical transaction requires fetch');
  const requestOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectPath: normalizePath(projectPath),
      changes: changes.map(change => ({
        ...change,
        path: normalizePath(change.path || change.to),
        ...(change.from ? { from: normalizePath(change.from) } : {})
      }))
    })
  };
  const response = fetchImpl
    ? await fetchImpl('/api/canonical-transaction', requestOptions)
    : await globalThis.fetch('/api/canonical-transaction', requestOptions);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok || result.committed !== true) {
    const error = new Error(result.error || `canonical transaction HTTP ${response.status}`);
    error.result = result;
    throw error;
  }
  return result;
}

export function replaceCanonicalFile(filePath, content, options) {
  const normalized = normalizePath(filePath);
  return commitCanonicalChanges(projectPathForCanonicalFile(normalized), [
    { operation: 'replace', path: normalized, content }
  ], options);
}

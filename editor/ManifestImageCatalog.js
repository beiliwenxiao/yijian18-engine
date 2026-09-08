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

/** 规范化 canonical game.project.json 路径，供编辑器 Manifest 目录共享使用。 */
export function normalizeManifestProjectPath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(?:\.\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function manifestProjectRoot(projectPath) {
  const normalized = normalizeManifestProjectPath(projectPath);
  return normalized.endsWith('/game.project.json')
    ? normalized.slice(0, -'/game.project.json'.length)
    : normalized;
}

/** 为 assetId/imageId 建立同一 Manifest 条目的别名索引。 */
export function indexManifestEntries(manifest) {
  const index = new Map();
  for (const entry of Array.isArray(manifest?.assets) ? manifest.assets : []) {
    if (!entry || typeof entry !== 'object') continue;
    for (const id of [entry.assetId, entry.imageId]) {
      if (typeof id === 'string' && id.trim()) index.set(id.trim(), entry);
    }
  }
  return index;
}

/** 将 Manifest 的运行时相对路径解析为当前编辑器可预览的同源 URL。 */
export function resolveManifestImageUrl(entry, projectPath) {
  const rawPath = entry?.runtime2D?.path || entry?.sourceFile;
  if (typeof rawPath !== 'string' || !rawPath.trim()) return '';
  const normalizedPath = rawPath.trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const projectRoot = manifestProjectRoot(projectPath);
  if (normalizedPath.startsWith('example/')) return `/${normalizedPath}`;
  if (projectRoot && normalizedPath.startsWith(`${projectRoot}/`)) return `/${normalizedPath}`;
  return projectRoot ? `/${projectRoot}/${normalizedPath}` : `/${normalizedPath}`;
}

/**
 * 投影为内容库选择器所需的稳定图片选项。
 * 路径仅用于只读展示和预览；业务定义继续只保存 imageId/assetId。
 */
export function buildManifestImageOptions(manifestOrEntries, projectPath) {
  const entriesById = manifestOrEntries instanceof Map
    ? manifestOrEntries
    : indexManifestEntries(manifestOrEntries);
  const optionsByImageId = new Map();
  for (const entry of new Set(entriesById.values())) {
    const imageId = [entry?.imageId, entry?.assetId]
      .find(value => typeof value === 'string' && value.trim())?.trim() || '';
    if (!imageId || optionsByImageId.has(imageId)) continue;
    const path = typeof entry?.runtime2D?.path === 'string' && entry.runtime2D.path.trim()
      ? entry.runtime2D.path.trim()
      : '';
    optionsByImageId.set(imageId, {
      imageId,
      assetId: typeof entry?.assetId === 'string' && entry.assetId.trim() ? entry.assetId.trim() : imageId,
      path,
      url: resolveManifestImageUrl(entry, projectPath),
      status: entry?.status || ''
    });
  }
  return [...optionsByImageId.values()].sort((left, right) => left.imageId.localeCompare(right.imageId, 'en'));
}

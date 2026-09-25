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

import fs from 'fs';
import path from 'path';
import { createContentValidator } from '../core/validation/ContentSchemas.js';
import { splitShardedProject } from '../core/projectShards.js';

const MAX_IMPORTED_PNG_BYTES = 15 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function failure(message, errors = []) {
  return Object.assign(new Error(message), { statusCode: 422, errors });
}

function validationError(pathValue, reason) {
  return { path: pathValue, category: 'invalidReference', reason };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(absolutePath, source) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw failure(`${source} 无法解析: ${error.message}`, [validationError(source, error.message)]);
  }
}

function decodeStrictBase64(value) {
  if (typeof value !== 'string' || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw failure('导入图片必须是有效 base64 数据', [validationError('imageUpdates.base64', 'base64 无效')]);
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMPORTED_PNG_BYTES || buffer.toString('base64') !== value) {
    throw failure('导入图片大小或 base64 数据无效', [validationError('imageUpdates.base64', '图片必须介于 1B 和 15MB')]);
  }
  return buffer;
}

function inspectPng(buffer, source) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw failure(`${source} 不是 PNG 文件`, [validationError(source, '只允许 PNG 文件')]);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw failure(`${source} PNG 尺寸无效`, [validationError(source, 'PNG 宽高必须大于 0')]);
  }
  return { width, height };
}

function resolveRuntimePngPath({ repoRoot, projectRoot, runtimePath, source }) {
  const rawPath = String(runtimePath || '').trim();
  const normalizedPath = rawPath.replace(/\\/g, '/');
  if (
    !rawPath
    || rawPath !== normalizedPath
    || path.posix.normalize(normalizedPath) !== normalizedPath
    || !normalizedPath.startsWith('assets/images/')
    || !normalizedPath.endsWith('.png')
  ) {
    throw failure('图片路径必须是当前游戏 assets/images/ 下的 .png 相对路径', [
      validationError(source, '路径仅允许 assets/images/... .png，且不能包含 .. 或反斜杠')
    ]);
  }
  const projectAbsolute = path.resolve(repoRoot, projectRoot);
  const absolutePath = path.resolve(projectAbsolute, normalizedPath);
  const relative = path.relative(projectAbsolute, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw failure('图片路径越出当前游戏目录', [validationError(source, '路径越权')]);
  }
  return { runtimePath: normalizedPath, absolutePath };
}

function getStableManifestEntry(manifest, imageId) {
  const matches = (manifest.assets || []).filter(entry => entry?.assetId === imageId && entry?.imageId === imageId);
  if (matches.length !== 1) {
    throw failure(`稳定图片资源不存在或不唯一: ${imageId}`, [validationError('imageUpdates.imageId', 'Manifest 中必须存在唯一且 assetId === imageId 的条目')]);
  }
  const entry = matches[0];
  if (entry.runtime2D?.mode !== 'image') {
    throw failure(`物品图片只允许替换普通 image 资源: ${imageId}`, [validationError('imageUpdates.imageId', '不允许通过物品编辑器修改 atlas 或非图片资源')]);
  }
  return entry;
}

/**
 * 在同一次磁盘事务中提交 library、Asset Manifest 与可选 PNG 导入。
 * 业务定义只引用稳定 imageId；替换文件只更新该 ID 对应的表现映射。
 */
export function prepareLibraryItemImageTransaction({
  repoRoot,
  projectPath,
  projectRoot,
  library,
  imageUpdates,
  canonicalizeProject
} = {}) {
  if (!library || typeof library !== 'object' || Array.isArray(library)) {
    throw failure('library 必须是对象', [validationError('library', '类型必须是对象')]);
  }
  if (!Array.isArray(imageUpdates) || imageUpdates.length === 0) {
    throw failure('imageUpdates 不能为空', [validationError('imageUpdates', '至少需要一项图片更新')]);
  }
  if (typeof canonicalizeProject !== 'function') throw new TypeError('缺少 canonicalizeProject');

  const projectAbsolute = path.resolve(repoRoot, projectPath);
  const manifestPath = `${projectRoot}/assets/manifests/assets.json`;
  const manifestAbsolute = path.resolve(repoRoot, manifestPath);
  const currentProject = readJson(projectAbsolute, projectPath);
  const candidateProject = { ...currentProject, library: structuredClone(library) };
  const project = canonicalizeProject(candidateProject);
  const manifest = readJson(manifestAbsolute, manifestPath);
  const manifestEntries = manifest.assets || [];
  const updateIds = new Set();
  const importedPaths = new Set();
  const imageChanges = [];

  for (const [index, update] of imageUpdates.entries()) {
    const source = `imageUpdates[${index}]`;
    const imageId = String(update?.imageId || '').trim();
    if (!imageId || updateIds.has(imageId)) {
      throw failure('图片更新 ID 为空或重复', [validationError(`${source}.imageId`, '每个稳定 imageId 只能更新一次')]);
    }
    updateIds.add(imageId);
    if (!Array.isArray(project.library?.items) || !project.library.items.some(item => (
      item?.imageId === imageId && item?.assetId === imageId
    ))) {
      throw failure(`内容库没有物品引用图片资源: ${imageId}`, [validationError(`${source}.imageId`, '物品必须以相同 imageId/assetId 引用该资源')]);
    }

    const entry = getStableManifestEntry(manifest, imageId);
    const { runtimePath, absolutePath } = resolveRuntimePngPath({
      repoRoot,
      projectRoot,
      runtimePath: update?.runtimePath,
      source: `${source}.runtimePath`
    });
    let dimensions;
    if (update?.mode === 'existingPath') {
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        throw failure(`图片文件不存在: ${runtimePath}`, [validationError(`${source}.runtimePath`, '图片文件不存在')]);
      }
      dimensions = inspectPng(fs.readFileSync(absolutePath), runtimePath);
    } else if (update?.mode === 'importPng') {
      const buffer = decodeStrictBase64(update?.base64);
      dimensions = inspectPng(buffer, `${source}.base64`);
      const targetDirectory = path.dirname(absolutePath);
      if (!fs.existsSync(targetDirectory) || !fs.statSync(targetDirectory).isDirectory()) {
        throw failure(`导入目录不存在: ${path.dirname(runtimePath)}`, [validationError(`${source}.runtimePath`, '导入目标目录必须已存在')]);
      }
      if (importedPaths.has(runtimePath)) {
        throw failure(`同一导入路径重复: ${runtimePath}`, [validationError(`${source}.runtimePath`, '同一事务不能重复写入目标文件')]);
      }
      importedPaths.add(runtimePath);
      const exists = fs.existsSync(absolutePath);
      if (exists && update?.replaceExisting !== true) {
        throw failure(`导入目标已存在: ${runtimePath}`, [validationError(`${source}.runtimePath`, '如需覆盖现有文件，必须明确确认替换')]);
      }
      imageChanges.push({
        operation: exists ? 'replace' : 'create',
        path: `${projectRoot}/${runtimePath}`,
        content: buffer.toString('base64'),
        encoding: 'base64'
      });
    } else {
      throw failure('不支持的图片更新模式', [validationError(`${source}.mode`, '仅支持 existingPath 或 importPng')]);
    }

    const entryIndex = manifestEntries.indexOf(entry);
    manifestEntries[entryIndex] = {
      ...entry,
      sourceFile: runtimePath,
      runtime2D: { ...entry.runtime2D, path: runtimePath },
      bounds: { ...entry.bounds, width: dimensions.width, height: dimensions.height },
      revision: Math.max(1, Number(entry.revision) || 1) + 1
    };
  }

  const manifestValidation = createContentValidator().validate(manifest, 'assetManifest');
  if (!manifestValidation.ok) {
    throw failure('更新后的 Asset Manifest 校验失败', manifestValidation.errors);
  }

  // shards 分片工程：主文件与分片文件在同一事务中按声明路由，保持单一数据源
  const { main, shards } = splitShardedProject(project);
  const projectChanges = [
    { operation: 'replace', path: projectPath, content: json(main) },
    ...Object.entries(shards).map(([shardRel, value]) => ({
      operation: 'replace',
      path: `${projectRoot}/${shardRel}`,
      content: json(value)
    }))
  ];
  return {
    project,
    manifest,
    changes: [
      ...projectChanges,
      { operation: 'replace', path: manifestPath, content: json(manifest) },
      ...imageChanges
    ]
  };
}

export default prepareLibraryItemImageTransaction;

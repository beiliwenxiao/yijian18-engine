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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

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
      validationError(`${source}.runtimePath`, '路径仅允许 assets/images/... .png，且不能包含 .. 或反斜杠')
    ]);
  }
  const projectAbsolute = path.resolve(repoRoot, projectRoot);
  const absolutePath = path.resolve(projectAbsolute, normalizedPath);
  const relative = path.relative(projectAbsolute, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw failure('图片路径越出当前游戏目录', [validationError(`${source}.runtimePath`, '路径越权')]);
  }
  return { runtimePath: normalizedPath, absolutePath };
}

/**
 * 「导入即登记」事务：把场景编辑器导入的图片 upsert 进 Asset Manifest。
 * 运行时 prepareChunkAssets 只按 Manifest 解析场景引用的稳定 imageId，
 * 未登记的图片在游戏里退化为 Missing Asset 占位块（required 加载失败）。
 *
 * 约定：
 * - PNG 文件必须已存在于磁盘（编辑器 addImageAsset 流程要求先放入 assets/images/）；
 *   尺寸以服务端读 PNG 头为准，不信任前端上报。
 * - 已存在条目只更新路径与实测尺寸（revision+1），usage/status 等字段保留；
 *   atlas 模式条目不允许通过本事务改写（归共享图集事务管辖）。
 * - 新建条目 status='placeholder'（待美术确认为 final），usage 并入当前场景 ID
 *   （大小写各一份，collectManifestUsageAssetIds 两者都可能匹配）。
 *
 * @param {Object} params
 * @param {string} params.repoRoot - dev server 工作根
 * @param {string} params.projectPath - 项目路径（game.project.json）
 * @param {string} params.projectRoot - 项目根（不含 game.project.json）
 * @param {Array<{imageId: string, runtimePath: string, sceneId?: string}>} params.imageAssets
 * @returns {{ manifest: Object, changes: Array<{operation: string, path: string, content: string}> }}
 */
export function prepareSceneImageAssetTransaction({
  repoRoot,
  projectPath,
  projectRoot,
  imageAssets
} = {}) {
  if (!Array.isArray(imageAssets) || imageAssets.length === 0) {
    throw failure('imageAssets 不能为空', [validationError('imageAssets', '至少需要一项图片登记')]);
  }
  const manifestPath = `${projectRoot}/assets/manifests/assets.json`;
  const manifestAbsolute = path.resolve(repoRoot, manifestPath);
  const manifest = readJson(manifestAbsolute, manifestPath);
  const manifestEntries = manifest.assets || [];
  const seenIds = new Set();
  const seenPaths = new Set();

  for (const [index, update] of imageAssets.entries()) {
    const source = `imageAssets[${index}]`;
    const imageId = String(update?.imageId || '').trim();
    if (!imageId || !IMAGE_ID_PATTERN.test(imageId)) {
      throw failure(`稳定 imageId 无效: ${imageId}`, [
        validationError(`${source}.imageId`, 'imageId 只能包含字母、数字、点、下划线和短横线，且必须以字母开头')
      ]);
    }
    if (seenIds.has(imageId)) {
      throw failure(`同一事务重复登记 imageId: ${imageId}`, [
        validationError(`${source}.imageId`, '每个稳定 imageId 只能登记一次')
      ]);
    }
    seenIds.add(imageId);

    const { runtimePath, absolutePath } = resolveRuntimePngPath({
      repoRoot,
      projectRoot,
      runtimePath: update?.runtimePath,
      source
    });
    if (seenPaths.has(runtimePath)) {
      throw failure(`同一导入路径重复: ${runtimePath}`, [
        validationError(`${source}.runtimePath`, '同一事务不能重复登记目标文件')
      ]);
    }
    seenPaths.add(runtimePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw failure(`图片文件不存在: ${runtimePath}`, [
        validationError(`${source}.runtimePath`, '图片必须已放入项目 assets/images/ 目录')
      ]);
    }
    const dimensions = inspectPng(fs.readFileSync(absolutePath), runtimePath);

    const sceneId = String(update?.sceneId || '').trim();
    const existingIndex = manifestEntries.findIndex(entry => (
      entry?.assetId === imageId || entry?.imageId === imageId
    ));
    if (existingIndex >= 0) {
      const entry = manifestEntries[existingIndex];
      if (entry.runtime2D?.mode === 'atlas') {
        throw failure(`目标条目是共享图集资源，不允许通过场景图片事务改写: ${imageId}`, [
          validationError(`${source}.imageId`, 'atlas 资源请通过共享图集事务维护')
        ]);
      }
      manifestEntries[existingIndex] = {
        ...entry,
        sourceFile: runtimePath,
        runtime2D: { ...entry.runtime2D, path: runtimePath },
        bounds: { ...entry.bounds, width: dimensions.width, height: dimensions.height },
        revision: Math.max(1, Number(entry.revision) || 1) + 1
      };
      const nextEntry = manifestEntries[existingIndex];
      const usage = Array.isArray(nextEntry.usage) ? nextEntry.usage : (nextEntry.usage = []);
      for (const id of [sceneId, sceneId.toLowerCase()]) {
        if (id && !usage.includes(id)) usage.push(id);
      }
    } else {
      manifestEntries.push({
        assetId: imageId,
        imageId,
        category: 'environment-image',
        usage: [sceneId, sceneId.toLowerCase()].filter(Boolean),
        sourceFile: runtimePath,
        runtime2D: { path: runtimePath, mode: 'image' },
        runtime3D: { mode: 'billboard', sourceAssetId: imageId },
        pivot: { x: 0, y: 0 },
        bounds: { width: dimensions.width, height: dimensions.height },
        animations: [],
        targetPhase: 'P1',
        status: 'placeholder',
        revision: 1
      });
    }
  }

  const manifestValidation = createContentValidator().validate(manifest, 'assetManifest');
  if (!manifestValidation.ok) {
    throw failure('登记后的 Asset Manifest 校验失败', manifestValidation.errors);
  }

  return {
    manifest,
    changes: [
      { operation: 'replace', path: manifestPath, content: json(manifest) }
    ]
  };
}

export default prepareSceneImageAssetTransaction;

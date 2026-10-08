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

import fs from 'fs';
import path from 'path';
import { validateSharedAtlasCatalog } from '../core/validation/SharedAtlasCatalogValidator.js';
import { createContentValidator } from '../core/validation/ContentSchemas.js';
import { ValidationCode, makeError } from '../core/validation/ValidationError.js';

const CANONICAL_SCENE_FILE = /^S(?:0[1-9]|1[0-4])(?:-C\d{2})?\.json$/;
const ATLAS_ASSET_ROOT = /^assets\/(?:images|atlases)\//;
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function failure(errors, message = '共享图集候选校验失败') {
  return Object.assign(new Error(message), { statusCode: 422, errors });
}

function readJsonFile(absolutePath, source) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw failure([
      makeError(ValidationCode.INVALID_JSON, source, `${source} 无法解析: ${error.message}`)
    ]);
  }
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function readSvgDimensions(buffer) {
  const source = buffer.toString('utf8');
  if (!/<svg\b/i.test(source)) return null;
  const number = value => {
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)/.exec(String(value || ''));
    return match ? Number(match[1]) : null;
  };
  const width = number(/\bwidth\s*=\s*["']([^"']+)["']/i.exec(source)?.[1]);
  const height = number(/\bheight\s*=\s*["']([^"']+)["']/i.exec(source)?.[1]);
  if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(source)?.[1]
    ?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: Math.round(viewBox[2]), height: Math.round(viewBox[3]) };
  }
  return null;
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (startOfFrame.has(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: readUInt24LE(buffer, 24) + 1, height: readUInt24LE(buffer, 27) + 1 };
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function readImageDimensions(absolutePath) {
  const buffer = fs.readFileSync(absolutePath);
  if (
    buffer.length >= 24
    && buffer[0] === 0x89
    && buffer.toString('ascii', 1, 4) === 'PNG'
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  return readJpegDimensions(buffer) || readWebpDimensions(buffer) || readSvgDimensions(buffer);
}

function resolveAtlasImage(repoRoot, projectRoot, atlas, atlasIndex) {
  const rawPath = String(atlas.path || '').replace(/\\/g, '/');
  const normalizedPath = path.posix.normalize(rawPath);
  const fieldPath = `atlases[${atlasIndex}].path`;
  if (
    !rawPath
    || normalizedPath !== rawPath
    || normalizedPath.startsWith('../')
    || path.posix.isAbsolute(normalizedPath)
    || !ATLAS_ASSET_ROOT.test(normalizedPath)
  ) {
    throw failure([makeError(
      ValidationCode.INVALID_REFERENCE,
      fieldPath,
      '图集图片必须位于当前游戏 assets/images/ 或 assets/atlases/ 下'
    )]);
  }

  const projectAbsolute = path.resolve(repoRoot, projectRoot);
  const imageAbsolute = path.resolve(projectAbsolute, normalizedPath);
  const relative = path.relative(projectAbsolute, imageAbsolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw failure([makeError(ValidationCode.INVALID_REFERENCE, fieldPath, '图集图片路径越过当前游戏目录')]);
  }
  if (!fs.existsSync(imageAbsolute) || !fs.statSync(imageAbsolute).isFile()) {
    throw failure([makeError(ValidationCode.INVALID_REFERENCE, fieldPath, `图集图片不存在: ${normalizedPath}`)]);
  }

  const dimensions = readImageDimensions(imageAbsolute);
  if (!dimensions) {
    throw failure([makeError(ValidationCode.INVALID_REFERENCE, fieldPath, `无法读取图集图片尺寸: ${normalizedPath}`)]);
  }
  if (dimensions.width !== atlas.width || dimensions.height !== atlas.height) {
    throw failure([
      makeError(
        ValidationCode.OUT_OF_RANGE,
        `atlases[${atlasIndex}]`,
        `图集尺寸必须与图片自然尺寸一致，配置 ${atlas.width}×${atlas.height}，文件 ${dimensions.width}×${dimensions.height}`
      )
    ]);
  }
  return normalizedPath;
}

function collectSceneAtlasReferences(value, source, currentPath = '', references = [], localAtlases = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSceneAtlasReferences(item, source, `${currentPath}[${index}]`, references, localAtlases));
    return { references, localAtlases };
  }
  if (!value || typeof value !== 'object') return { references, localAtlases };

  if (typeof value.atlasId === 'string') {
    references.push({
      atlasId: value.atlasId,
      sliceKey: typeof value.sliceKey === 'string' ? value.sliceKey : null,
      path: `${source}${currentPath ? `:${currentPath}` : ''}`
    });
  }
  if (Array.isArray(value.atlases)) {
    value.atlases.forEach((atlas, index) => {
      if (typeof atlas?.id === 'string') {
        localAtlases.push({ id: atlas.id, path: `${source}${currentPath ? `:${currentPath}` : ''}.atlases[${index}]` });
      }
    });
  }

  for (const [key, child] of Object.entries(value)) {
    collectSceneAtlasReferences(child, source, currentPath ? `${currentPath}.${key}` : key, references, localAtlases);
  }
  return { references, localAtlases };
}

function validateSceneReferences(repoRoot, sceneRoot, currentCatalog, candidateCatalog) {
  const sceneAbsolute = path.resolve(repoRoot, sceneRoot);
  const files = fs.readdirSync(sceneAbsolute).filter(fileName => CANONICAL_SCENE_FILE.test(fileName));
  const references = [];
  const localAtlases = [];
  for (const fileName of files) {
    const relativePath = `${sceneRoot}${fileName}`;
    const scene = readJsonFile(path.join(sceneAbsolute, fileName), relativePath);
    collectSceneAtlasReferences(scene, relativePath, '', references, localAtlases);
  }

  const candidateById = new Map(candidateCatalog.atlases.map(atlas => [atlas.id, atlas]));
  const currentIds = new Set((currentCatalog.atlases || []).map(atlas => atlas?.id).filter(Boolean));
  const errors = [];
  for (const reference of references) {
    const atlas = candidateById.get(reference.atlasId);
    if (!atlas) {
      errors.push(makeError(
        ValidationCode.INVALID_REFERENCE,
        reference.path,
        `场景仍引用图集 ${reference.atlasId}`
      ));
    } else if (reference.sliceKey && !Object.prototype.hasOwnProperty.call(atlas.slices || {}, reference.sliceKey)) {
      errors.push(makeError(
        ValidationCode.INVALID_REFERENCE,
        reference.path,
        `场景仍引用已删除切片 ${reference.atlasId}/${reference.sliceKey}`
      ));
    }
  }
  for (const localAtlas of localAtlases) {
    if (currentIds.has(localAtlas.id) && !candidateById.has(localAtlas.id)) {
      errors.push(makeError(
        ValidationCode.INVALID_REFERENCE,
        localAtlas.path,
        `删除共享图集 ${localAtlas.id} 会重新暴露场景局部 legacy 定义`
      ));
    }
  }
  if (errors.length) throw failure(errors, '共享图集仍被 canonical 场景引用');
}

function manifestMapping(entry) {
  return {
    assetId: entry?.assetId,
    imageId: entry?.imageId,
    category: entry?.category,
    sourceFile: entry?.sourceFile,
    runtime2D: entry?.runtime2D,
    runtime3D: entry?.runtime3D,
    pivot: entry?.pivot,
    bounds: entry?.bounds
  };
}

function synchronizeManifest(currentManifest, currentCatalog, candidateCatalog) {
  const currentAtlasIds = new Set((currentCatalog.atlases || []).map(atlas => atlas?.id).filter(Boolean));
  const candidateAtlasIds = new Set(candidateCatalog.atlases.map(atlas => atlas.id));
  const removedAtlasIds = new Set([...currentAtlasIds].filter(id => !candidateAtlasIds.has(id)));
  const assets = (currentManifest.assets || [])
    .filter(entry => !removedAtlasIds.has(entry?.assetId))
    .map(entry => structuredClone(entry));

  for (const atlas of candidateCatalog.atlases) {
    const indexes = [];
    assets.forEach((entry, index) => {
      if (entry?.assetId === atlas.id || entry?.imageId === atlas.id) indexes.push(index);
    });
    if (indexes.length > 1) {
      throw failure([makeError(
        ValidationCode.DUPLICATE_ID,
        `assets.${atlas.id}`,
        `Manifest 中稳定 ID ${atlas.id} 命中多个条目`
      )]);
    }

    const index = indexes[0] ?? -1;
    const existing = index >= 0 ? assets[index] : null;
    if (existing && existing.assetId !== atlas.id) {
      throw failure([makeError(
        ValidationCode.DUPLICATE_ID,
        `assets[${index}].imageId`,
        `图集 ID ${atlas.id} 已被其他 Manifest 资产占用`
      )]);
    }
    if (existing && existing.runtime2D?.mode !== 'atlas' && !currentAtlasIds.has(atlas.id)) {
      throw failure([makeError(
        ValidationCode.DUPLICATE_ID,
        `assets[${index}].assetId`,
        `图集 ID ${atlas.id} 与非 atlas Manifest 资产冲突`
      )]);
    }

    const mapping = {
      assetId: atlas.id,
      imageId: atlas.id,
      category: 'environment-atlas',
      sourceFile: atlas.path,
      runtime2D: { path: atlas.path, mode: 'atlas' },
      runtime3D: { mode: 'billboard', sourceAssetId: atlas.id },
      pivot: { x: 0.5, y: 1 },
      bounds: { width: atlas.width, height: atlas.height }
    };
    const mappingChanged = JSON.stringify(manifestMapping(existing)) !== JSON.stringify(mapping);
    const revision = existing
      ? Math.max(1, Number(existing.revision) || 1) + (mappingChanged ? 1 : 0)
      : 1;
    const nextEntry = {
      ...(existing || {}),
      ...mapping,
      usage: Array.isArray(existing?.usage) && existing.usage.length > 0
        ? structuredClone(existing.usage)
        : ['runtime-environment-atlas', 'environment'],
      animations: Array.isArray(existing?.animations) ? structuredClone(existing.animations) : [],
      targetPhase: existing?.targetPhase || 'P6',
      status: existing?.status || 'third-party-approved',
      revision
    };
    if (index >= 0) assets[index] = nextEntry;
    else assets.push(nextEntry);
  }

  const manifest = { ...structuredClone(currentManifest), assets };
  const validation = createContentValidator().validate(manifest, 'assetManifest');
  if (!validation.ok) throw failure(validation.errors, '同步后的 Asset Manifest 校验失败');
  return manifest;
}

/**
 * 准备共享图集 catalog + Manifest 的原子 change set；不写磁盘。
 */
export function prepareSharedAtlasTransaction({ repoRoot, projectPath, projectRoot, sceneRoot, catalog }) {
  const catalogPath = `${projectRoot}/config/atlases.json`;
  const manifestPath = `${projectRoot}/assets/manifests/assets.json`;
  const projectAbsolute = path.resolve(repoRoot, projectPath);
  const catalogAbsolute = path.resolve(repoRoot, catalogPath);
  const manifestAbsolute = path.resolve(repoRoot, manifestPath);
  const project = readJsonFile(projectAbsolute, projectPath);

  if (project.extensions?.atlases?.$ref !== 'config/atlases.json') {
    throw failure([makeError(
      ValidationCode.INVALID_REFERENCE,
      'extensions.atlases.$ref',
      '当前项目共享图集必须引用 config/atlases.json'
    )]);
  }
  if (project.assetManifest?.$ref !== 'assets/manifests/assets.json') {
    throw failure([makeError(
      ValidationCode.INVALID_REFERENCE,
      'assetManifest.$ref',
      '当前项目 Asset Manifest 必须引用 assets/manifests/assets.json'
    )]);
  }

  const validation = validateSharedAtlasCatalog(catalog);
  if (!validation.ok) throw failure(validation.errors);
  const candidateCatalog = validation.value;

  const requiredReferences = project.extensions?.atlases?.requiredReferences;
  if (requiredReferences !== undefined && !Array.isArray(requiredReferences)) {
    throw failure([
      makeError(
        ValidationCode.TYPE_MISMATCH,
        'extensions.atlases.requiredReferences',
        '共享图集 requiredReferences 必须是数组'
      )
    ], '项目必需共享图集引用无效');
  }
  const candidateAtlasById = new Map(candidateCatalog.atlases.map(atlas => [atlas.id, atlas]));
  const requirementErrors = [];
  for (const [index, requirement] of (requiredReferences || []).entries()) {
    const requirementPath = `extensions.atlases.requiredReferences[${index}]`;
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      requirementErrors.push(makeError(
        ValidationCode.TYPE_MISMATCH,
        requirementPath,
        '必需图集引用必须是对象'
      ));
      continue;
    }

    const atlasId = typeof requirement.atlasId === 'string' ? requirement.atlasId.trim() : '';
    const sliceKeys = requirement.sliceKeys;
    if (!atlasId) {
      requirementErrors.push(makeError(
        ValidationCode.MISSING_FIELD,
        `${requirementPath}.atlasId`,
        '必需图集引用缺少 atlasId'
      ));
    }
    if (!Array.isArray(sliceKeys)) {
      requirementErrors.push(makeError(
        ValidationCode.TYPE_MISMATCH,
        `${requirementPath}.sliceKeys`,
        '必需图集 sliceKeys 必须是数组'
      ));
    }

    const atlas = atlasId ? candidateAtlasById.get(atlasId) : null;
    if (atlasId && !atlas) {
      requirementErrors.push(makeError(
        ValidationCode.INVALID_REFERENCE,
        `${requirementPath}.atlasId`,
        `运行时必需共享图集不存在: ${atlasId}`
      ));
    }
    if (Array.isArray(sliceKeys)) {
      for (const [sliceIndex, sliceKeyValue] of sliceKeys.entries()) {
        const sliceKey = typeof sliceKeyValue === 'string' ? sliceKeyValue.trim() : '';
        const slicePath = `${requirementPath}.sliceKeys[${sliceIndex}]`;
        if (!sliceKey) {
          requirementErrors.push(makeError(
            ValidationCode.TYPE_MISMATCH,
            slicePath,
            '必需切片 Key 必须是非空字符串'
          ));
        } else if (atlas && !Object.prototype.hasOwnProperty.call(atlas.slices || {}, sliceKey)) {
          requirementErrors.push(makeError(
            ValidationCode.INVALID_REFERENCE,
            slicePath,
            `运行时必需共享切片不存在: ${atlasId}/${sliceKey}`
          ));
        }
      }
    }
  }
  if (requirementErrors.length > 0) {
    throw failure(requirementErrors, '项目必需共享图集引用无效');
  }

  candidateCatalog.atlases.forEach((atlas, index) => {
    atlas.path = resolveAtlasImage(repoRoot, projectRoot, atlas, index);
  });

  const currentCatalog = readJsonFile(catalogAbsolute, catalogPath);
  const currentManifest = readJsonFile(manifestAbsolute, manifestPath);
  validateSceneReferences(repoRoot, sceneRoot, currentCatalog, candidateCatalog);
  const manifest = synchronizeManifest(currentManifest, currentCatalog, candidateCatalog);

  return {
    catalog: candidateCatalog,
    manifest,
    catalogPath,
    manifestPath,
    changes: [
      { operation: 'replace', path: catalogPath, content: json(candidateCatalog) },
      { operation: 'replace', path: manifestPath, content: json(manifest) }
    ]
  };
}

export default prepareSharedAtlasTransaction;

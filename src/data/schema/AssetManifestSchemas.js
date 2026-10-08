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

import { FieldType } from '../../core/validation/ContentValidator.js';
import { ValidationCode, makeError } from '../../core/validation/ValidationError.js';
import { CANONICAL_SCHEMA_VERSION } from './CanonicalSchemas.js';

const idField = () => ({ type: FieldType.STRING, required: true, minLength: 1 });

export const ASSET_LICENSE_SCHEMA = {
  id: 'assetLicense',
  fields: {
    status: {
      type: FieldType.STRING,
      required: true,
      enum: ['unverified', 'approved', 'original']
    },
    name: { type: FieldType.STRING, required: true, minLength: 1 },
    sourceUrl: { type: FieldType.STRING },
    attribution: { type: FieldType.STRING },
    commercialUse: { type: FieldType.BOOLEAN, required: true }
  }
};

export const ASSET_RUNTIME_2D_SCHEMA = {
  id: 'assetRuntime2D',
  fields: {
    path: { type: FieldType.STRING, required: true, minLength: 1 },
    mode: {
      type: FieldType.STRING,
      required: true,
      enum: ['image', 'atlas', 'skeleton']
    }
  }
};

export const ASSET_RUNTIME_3D_SCHEMA = {
  id: 'assetRuntime3D',
  fields: {
    mode: {
      type: FieldType.STRING,
      required: true,
      enum: ['billboard', 'sprite', 'model']
    },
    path: { type: FieldType.STRING },
    sourceAssetId: { type: FieldType.STRING }
  }
};


export const ASSET_PIVOT_SCHEMA = {
  id: 'assetPivot',
  allowUnknown: false,
  fields: {
    x: { type: FieldType.NUMBER, required: true, min: 0, max: 1 },
    y: { type: FieldType.NUMBER, required: true, min: 0, max: 1 }
  }
};

export const ASSET_BOUNDS_SCHEMA = {
  id: 'assetBounds',
  allowUnknown: false,
  fields: {
    width: { type: FieldType.NUMBER, required: true, min: 0 },
    height: { type: FieldType.NUMBER, required: true, min: 0 }
  }
};

export const ASSET_MANIFEST_ENTRY_SCHEMA = {
  id: 'assetManifestEntry',
  fields: {
    assetId: idField(),
    imageId: { type: FieldType.STRING, minLength: 1 },
    category: { type: FieldType.STRING, required: true, minLength: 1 },
    usage: { type: FieldType.ARRAY, required: true, itemType: FieldType.STRING },
    sourceFile: { type: FieldType.STRING, required: true, minLength: 1 },
    runtime2D: { type: FieldType.OBJECT, required: true, schema: 'assetRuntime2D' },
    runtime3D: { type: FieldType.OBJECT, required: true, schema: 'assetRuntime3D' },
    pivot: { type: FieldType.OBJECT, required: true, schema: 'assetPivot' },
    bounds: { type: FieldType.OBJECT, required: true, schema: 'assetBounds' },
    animations: { type: FieldType.ARRAY, required: true, itemType: FieldType.STRING },
    // 授权、作者和所有者仅作为可选元数据；项目资源按原创或已获授权处理，
    // 不因缺少这些字段阻断内容加载。
    license: { type: FieldType.OBJECT, schema: 'assetLicense' },
    author: { type: FieldType.STRING },
    owner: { type: FieldType.STRING },
    targetPhase: { type: FieldType.STRING, required: true, minLength: 2 },
    status: {
      type: FieldType.STRING,
      required: true,
      enum: ['placeholder', 'ai-generated', 'third-party-approved', 'final']
    },
    replacesPlaceholderId: { type: FieldType.STRING },
    revision: { type: FieldType.INTEGER, required: true, min: 1 }
  }
};

export const ASSET_MANIFEST_SCHEMA = {
  id: 'assetManifest',
  fields: {
    schemaVersion: {
      type: FieldType.INTEGER,
      required: true,
      min: 1,
      max: CANONICAL_SCHEMA_VERSION
    },
    gameId: idField(),
    assets: {
      type: FieldType.ARRAY,
      required: true,
      itemSchema: 'assetManifestEntry'
    }
  },
  validate(manifest) {
    const errors = [];
    const assetIds = new Set();
    const imageIds = new Set();

    for (const [index, asset] of (manifest.assets || []).entries()) {
      if (!asset) continue;
      if (assetIds.has(asset.assetId)) {
        errors.push(makeError(
          ValidationCode.DUPLICATE_ID,
          `assets[${index}].assetId`,
          `重复的 assetId: ${asset.assetId}`
        ));
      }
      assetIds.add(asset.assetId);

      if (asset.imageId) {
        if (imageIds.has(asset.imageId)) {
          errors.push(makeError(
            ValidationCode.DUPLICATE_ID,
            `assets[${index}].imageId`,
            `重复的 imageId: ${asset.imageId}`
          ));
        }
        imageIds.add(asset.imageId);
        if (['image', 'atlas', 'skeleton'].includes(asset.runtime2D?.mode) && asset.imageId !== asset.assetId) {
          errors.push(makeError(
            ValidationCode.INVALID_REFERENCE,
            `assets[${index}].imageId`,
            'image/atlas/skeleton 资产的 imageId 必须与 assetId 相同'
          ));
        }
      } else if (['image', 'atlas', 'skeleton'].includes(asset.runtime2D?.mode)) {
        errors.push(makeError(
          ValidationCode.MISSING_FIELD,
          `assets[${index}].imageId`,
          'image/atlas/skeleton 资产必须提供稳定 imageId'
        ));
      }

      if (!(Number(asset.bounds?.width) > 0)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `assets[${index}].bounds.width`, 'bounds.width 必须大于 0'));
      }
      if (!(Number(asset.bounds?.height) > 0)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `assets[${index}].bounds.height`, 'bounds.height 必须大于 0'));
      }

      const runtime3D = asset.runtime3D || {};
      if (runtime3D.mode === 'model' && !String(runtime3D.path || '').trim()) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, `assets[${index}].runtime3D.path`, 'model 模式必须提供模型 path'));
      }
      if (['billboard', 'sprite'].includes(runtime3D.mode) && !String(runtime3D.sourceAssetId || '').trim()) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, `assets[${index}].runtime3D.sourceAssetId`, `${runtime3D.mode} 模式必须提供 sourceAssetId`));
      }
    }

    for (const [index, asset] of (manifest.assets || []).entries()) {
      if (!asset) continue;
      const sourceAssetId = asset.runtime3D?.sourceAssetId;
      if (sourceAssetId && !assetIds.has(sourceAssetId)) {
        errors.push(makeError(
          ValidationCode.INVALID_REFERENCE,
          `assets[${index}].runtime3D.sourceAssetId`,
          `3D fallback 引用了不存在的 assetId: ${sourceAssetId}`
        ));
      } else if (['billboard', 'sprite'].includes(asset.runtime3D?.mode) && sourceAssetId !== asset.assetId) {
        errors.push(makeError(
          ValidationCode.INVALID_REFERENCE,
          `assets[${index}].runtime3D.sourceAssetId`,
          '2D 资产的 3D fallback 必须引用自身稳定 assetId'
        ));
      }
      if (asset.replacesPlaceholderId && !assetIds.has(asset.replacesPlaceholderId)) {
        errors.push(makeError(
          ValidationCode.INVALID_REFERENCE,
          `assets[${index}].replacesPlaceholderId`,
          `替换目标不存在: ${asset.replacesPlaceholderId}`
        ));
      }
    }
    return { ok: errors.length === 0, errors };
  }
};

export const ASSET_MANIFEST_SCHEMAS = [
  ASSET_LICENSE_SCHEMA,
  ASSET_RUNTIME_2D_SCHEMA,
  ASSET_RUNTIME_3D_SCHEMA,
  ASSET_PIVOT_SCHEMA,
  ASSET_BOUNDS_SCHEMA,
  ASSET_MANIFEST_ENTRY_SCHEMA,
  ASSET_MANIFEST_SCHEMA
];
import { ValidationCode, makeError } from './ValidationError.js';

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

const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInteger = value => Number.isInteger(value) && value > 0;
const isNonNegativeInteger = value => Number.isInteger(value) && value >= 0;

/**
 * 校验游戏级共享图集 catalog。该校验器不读取文件系统，磁盘图片与场景引用由事务层校验。
 * @param {unknown} catalog
 * @returns {{ok:boolean,errors:Array<object>,value:object|null}}
 */
export function validateSharedAtlasCatalog(catalog) {
  const errors = [];
  if (!isObject(catalog)) {
    return {
      ok: false,
      errors: [makeError(ValidationCode.TYPE_MISMATCH, '', '共享图集配置必须是对象')],
      value: null
    };
  }

  if (!Number.isInteger(catalog.schemaVersion) || catalog.schemaVersion !== 1) {
    errors.push(makeError(
      ValidationCode.VERSION_UNSUPPORTED,
      'schemaVersion',
      '共享图集配置 schemaVersion 必须为 1'
    ));
  }
  if (!Array.isArray(catalog.atlases)) {
    errors.push(makeError(ValidationCode.TYPE_MISMATCH, 'atlases', 'atlases 必须是数组'));
    return { ok: false, errors, value: null };
  }

  const atlasIds = new Set();
  for (const [atlasIndex, atlas] of catalog.atlases.entries()) {
    const atlasPath = `atlases[${atlasIndex}]`;
    if (!isObject(atlas)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, atlasPath, '图集定义必须是对象'));
      continue;
    }

    const id = String(atlas.id || '');
    if (!STABLE_ID_PATTERN.test(id)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${atlasPath}.id`, '图集 ID 必须是稳定标识符'));
    } else if (atlasIds.has(id)) {
      errors.push(makeError(ValidationCode.DUPLICATE_ID, `${atlasPath}.id`, `重复的图集 ID: ${id}`));
    }
    atlasIds.add(id);

    if (atlas.assetId !== id) {
      errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${atlasPath}.assetId`, 'assetId 必须与图集 ID 相同'));
    }
    if (atlas.imageId !== id) {
      errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${atlasPath}.imageId`, 'imageId 必须与图集 ID 相同'));
    }
    if (typeof atlas.name !== 'string' || !atlas.name.trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, `${atlasPath}.name`, '图集名称不能为空'));
    }
    if (typeof atlas.path !== 'string' || !atlas.path.trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, `${atlasPath}.path`, '图集图片路径不能为空'));
    }
    if (!isPositiveInteger(atlas.width)) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${atlasPath}.width`, '图集宽度必须是正整数'));
    }
    if (!isPositiveInteger(atlas.height)) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${atlasPath}.height`, '图集高度必须是正整数'));
    }
    if (!isObject(atlas.slices)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${atlasPath}.slices`, '图集 slices 必须是对象'));
      continue;
    }

    for (const [sliceKey, slice] of Object.entries(atlas.slices)) {
      const slicePath = `${atlasPath}.slices.${sliceKey}`;
      if (!STABLE_ID_PATTERN.test(sliceKey)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, slicePath, `切片 Key 不是稳定标识符: ${sliceKey}`));
      }
      if (!isObject(slice)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, slicePath, '切片定义必须是对象'));
        continue;
      }
      if (typeof slice.name !== 'string' || !slice.name.trim()) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, `${slicePath}.name`, '切片名称不能为空'));
      }
      if (!isNonNegativeInteger(slice.sx)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${slicePath}.sx`, 'sx 必须是非负整数'));
      }
      if (!isNonNegativeInteger(slice.sy)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${slicePath}.sy`, 'sy 必须是非负整数'));
      }
      if (!isPositiveInteger(slice.sw)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${slicePath}.sw`, 'sw 必须是正整数'));
      }
      if (!isPositiveInteger(slice.sh)) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${slicePath}.sh`, 'sh 必须是正整数'));
      }
      if (
        isNonNegativeInteger(slice.sx)
        && isPositiveInteger(slice.sw)
        && isPositiveInteger(atlas.width)
        && slice.sx + slice.sw > atlas.width
      ) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${slicePath}.sw`, '切片横向范围超出图集'));
      }
      if (
        isNonNegativeInteger(slice.sy)
        && isPositiveInteger(slice.sh)
        && isPositiveInteger(atlas.height)
        && slice.sy + slice.sh > atlas.height
      ) {
        errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${slicePath}.sh`, '切片纵向范围超出图集'));
      }
      if (slice.collide !== undefined && typeof slice.collide !== 'boolean') {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${slicePath}.collide`, 'collide 必须是布尔值'));
      }
      if (slice.colliderRadius !== undefined) {
        errors.push(makeError(
          ValidationCode.INVALID_REFERENCE,
          `${slicePath}.colliderRadius`,
          'colliderRadius 已废弃，请使用 colliderRadiusX 和 colliderRadiusY'
        ));
      }
      const ellipseRadii = [
        ['colliderRadiusX', '碰撞椭圆 X 半径'],
        ['colliderRadiusY', '碰撞椭圆 Y 半径']
      ];
      for (const [field, label] of ellipseRadii) {
        const value = slice[field];
        if (value === undefined && slice.collide !== true) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(makeError(
            ValidationCode.TYPE_MISMATCH,
            `${slicePath}.${field}`,
            `${label}必须是有限数字`
          ));
        } else if (value <= 0) {
          errors.push(makeError(
            ValidationCode.OUT_OF_RANGE,
            `${slicePath}.${field}`,
            `${label}必须大于 0`
          ));
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    value: errors.length === 0 ? structuredClone(catalog) : null
  };
}

export default validateSharedAtlasCatalog;

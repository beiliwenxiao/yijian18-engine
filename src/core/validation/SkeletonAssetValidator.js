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
 * SkeletonAssetValidator - 骨骼资产 JSON 校验器（不读文件系统）
 *
 * 校验范围：结构类型、稳定 ID、骨骼父引用无环、slot/track 骨骼引用存在、
 * 关键帧时间单调且不越界、附件类型与必需字段。磁盘文件存在性与 Manifest
 * 引用解析由事务层（SkeletonAssetTransaction）负责。
 * 返回 { ok, errors, value }；ok=true 时 value 为规范化后的文档。
 */

import { ValidationCode, makeError } from './ValidationError.js';

const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const ATTACHMENT_TYPES = ['empty', 'image', 'slice', 'sequence'];
const EASE_TYPES = ['linear', 'easeInOut'];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = value => Number.isFinite(Number(value));
const isPositive = value => isFiniteNumber(value) && Number(value) > 0;

/**
 * 校验骨骼资产文档。
 * @param {unknown} doc
 * @returns {{ok:boolean, errors:Array<object>, value:object|null}}
 */
export function validateSkeletonAsset(doc) {
  const errors = [];
  if (!isObject(doc)) {
    return { ok: false, errors: [makeError(ValidationCode.TYPE_MISMATCH, '', '骨骼资产必须是对象')], value: null };
  }
  if (doc.schemaVersion !== 1) {
    errors.push(makeError(ValidationCode.VERSION_UNSUPPORTED, 'schemaVersion', '骨骼资产 schemaVersion 必须为 1'));
  }
  const skeletonId = String(doc.skeletonId || '').trim();
  if (!STABLE_ID_PATTERN.test(skeletonId)) {
    errors.push(makeError(ValidationCode.TYPE_MISMATCH, 'skeletonId', 'skeletonId 必须是稳定标识符'));
  }
  if (doc.meta !== undefined && !isObject(doc.meta)) {
    errors.push(makeError(ValidationCode.TYPE_MISMATCH, 'meta', 'meta 必须是对象'));
  }

  // ---- bones：唯一 ID + 父引用存在 + 无环 ----
  const boneIds = new Set();
  if (!Array.isArray(doc.bones) || doc.bones.length === 0) {
    errors.push(makeError(ValidationCode.MISSING_FIELD, 'bones', 'bones 必须是非空数组'));
    return { ok: false, errors, value: null };
  }
  for (const [index, bone] of doc.bones.entries()) {
    const path = `bones[${index}]`;
    if (!isObject(bone)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, '骨骼定义必须是对象'));
      continue;
    }
    const id = String(bone.id || '').trim();
    if (!STABLE_ID_PATTERN.test(id)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.id`, '骨骼 ID 必须是稳定标识符'));
    } else if (boneIds.has(id)) {
      errors.push(makeError(ValidationCode.DUPLICATE_ID, `${path}.id`, `重复的骨骼 ID: ${id}`));
    }
    boneIds.add(id);
    if (bone.parent != null && !boneIds.has(String(bone.parent).trim()) ) {
      // 父骨骼可能声明在后：延后统一检查，这里只记录声明
    }
  }
  // 父引用存在性 + 无环（声明顺序无关）
  const parentOf = new Map();
  for (const [index, bone] of (doc.bones || []).entries()) {
    if (!isObject(bone)) continue;
    const id = String(bone.id || '').trim();
    if (!boneIds.has(id)) continue;
    const parent = bone.parent == null ? null : String(bone.parent).trim() || null;
    if (parent) {
      if (!boneIds.has(parent)) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `bones[${index}].parent`, `父骨骼不存在: ${parent}`));
      } else if (parent === id) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `bones[${index}].parent`, '骨骼不能以自身为父'));
      } else {
        parentOf.set(id, parent);
      }
    }
  }
  for (const id of parentOf.keys()) {
    const seen = new Set([id]);
    let cursor = parentOf.get(id) || null;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `bones[${id}].parent`, '骨骼父链存在环'));
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor) || null;
    }
  }

  // ---- slots：骨骼引用存在 + 附件字段 ----
  const slotIds = new Set();
  const slots = Array.isArray(doc.slots) ? doc.slots : [];
  for (const [index, slot] of slots.entries()) {
    const path = `slots[${index}]`;
    if (!isObject(slot)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, '槽位定义必须是对象'));
      continue;
    }
    const slotId = String(slot.id || '').trim();
    if (!slotId) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.id`, '槽位 ID 不能为空'));
    } else if (slotIds.has(slotId)) {
      errors.push(makeError(ValidationCode.DUPLICATE_ID, `${path}.id`, `重复的槽位 ID: ${slotId}`));
    }
    slotIds.add(slotId);
    const boneId = String(slot.bone || '').trim();
    if (!boneIds.has(boneId)) {
      errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${path}.bone`, `槽位引用的骨骼不存在: ${boneId}`));
    }
    const attachment = slot.attachment;
    if (!isObject(attachment)) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.attachment`, '槽位必须提供 attachment'));
      continue;
    }
    if (!ATTACHMENT_TYPES.includes(attachment.type)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.attachment.type`,
        `附件类型必须是 ${ATTACHMENT_TYPES.join('/')} 之一`));
      continue;
    }
    if (attachment.type !== 'empty' && !String(attachment.assetId || '').trim()) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.attachment.assetId`, '非 empty 附件必须提供 assetId'));
    }
    if (attachment.type === 'slice' && !(isFiniteNumber(attachment.sw) && isFiniteNumber(attachment.sh))) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.attachment.sw/sh`, 'slice 附件必须提供源矩形 sw/sh'));
    }
    if (attachment.type === 'sequence') {
      const frames = attachment.frames;
      if (!Array.isArray(frames) || frames.length === 0
        || !frames.every(frame => isObject(frame) && isFiniteNumber(frame?.sx) && isFiniteNumber(frame?.sy)
          && isPositive(frame?.sw) && isPositive(frame?.sh))) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.attachment.frames`,
          'sequence 附件必须提供非空 frames（每帧含 sx/sy/sw/sh 源矩形）'));
      }
      if (!isPositive(attachment.fps)) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.attachment.fps`, 'sequence 附件必须提供正数 fps'));
      }
    }
  }

  // ---- clips：剪辑名唯一、轨道骨骼存在、关键帧单调且不越界 ----
  const clipNames = new Set();
  const clips = Array.isArray(doc.clips) ? doc.clips : [];
  for (const [index, clip] of clips.entries()) {
    const path = `clips[${index}]`;
    if (!isObject(clip)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, '剪辑定义必须是对象'));
      continue;
    }
    const name = String(clip.name || '').trim();
    if (!name) {
      errors.push(makeError(ValidationCode.MISSING_FIELD, `${path}.name`, '剪辑名不能为空'));
    } else if (clipNames.has(name)) {
      errors.push(makeError(ValidationCode.DUPLICATE_ID, `${path}.name`, `重复的剪辑名: ${name}`));
    }
    clipNames.add(name);
    if (!isPositive(clip.durationMs)) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${path}.durationMs`, 'durationMs 必须大于 0'));
    }
    if (!Array.isArray(clip.tracks)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${path}.tracks`, 'tracks 必须是数组'));
      continue;
    }
    for (const [trackIndex, track] of clip.tracks.entries()) {
      const trackPath = `${path}.tracks[${trackIndex}]`;
      if (!isObject(track)) {
        errors.push(makeError(ValidationCode.TYPE_MISMATCH, trackPath, '轨道必须是对象'));
        continue;
      }
      const boneId = String(track.bone || '').trim();
      if (!boneIds.has(boneId)) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${trackPath}.bone`, `轨道引用的骨骼不存在: ${boneId}`));
      }
      const keys = Array.isArray(track.keys) ? track.keys : [];
      if (keys.length === 0) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, `${trackPath}.keys`, '轨道至少需要一个关键帧'));
        continue;
      }
      let previousT = -1;
      for (const [keyIndex, key] of keys.entries()) {
        const keyPath = `${trackPath}.keys[${keyIndex}]`;
        if (!isObject(key) || !isFiniteNumber(key?.t)) {
          errors.push(makeError(ValidationCode.TYPE_MISMATCH, keyPath, '关键帧必须是含数值 t 的对象'));
          continue;
        }
        if (key.t < 0) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${keyPath}.t`, '关键帧时间不能为负'));
        }
        if (isPositive(clip.durationMs) && key.t > clip.durationMs) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, `${keyPath}.t`, '关键帧时间超出剪辑时长'));
        }
        if (key.t < previousT) {
          errors.push(makeError(ValidationCode.OUT_OF_RANGE, keyPath, '关键帧时间必须单调不减'));
        }
        previousT = key.t;
        if (key.ease !== undefined && !EASE_TYPES.includes(key.ease)) {
          errors.push(makeError(ValidationCode.TYPE_MISMATCH, `${keyPath}.ease`, '缓动必须是 linear/easeInOut'));
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: doc };
}

export default { validateSkeletonAsset };

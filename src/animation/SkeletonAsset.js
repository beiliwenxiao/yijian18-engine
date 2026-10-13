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
 * SkeletonAsset.js - 骨骼动画资产解析
 *
 * 骨骼资产 JSON 结构（assets/skeletons/<skeletonId>.json）：
 * {
 *   schemaVersion: 1,
 *   skeletonId: "skeleton.demo",
 *   meta: { width, height },                 // 设计尺寸：根骨骼原点=脚底中心，y 轴向下
 *   bones: [{ id, parent, x, y, rot, scaleX, scaleY, length }],
 *   slots: [{ id, bone, z, attachment: {
 *     type: 'empty' | 'image' | 'slice' | 'sequence',
 *     assetId,                               // image/slice/sequence 的 manifest 稳定图片 ID
 *     sx, sy, sw, sh,                        // slice 源矩形；sequence 每帧源矩形
 *     frames: [{ sx, sy, sw, sh }], fps,     // sequence 帧表
 *     x, y, rot, width, height               // 附件相对骨骼的偏移与绘制盒
 *   } }],
 *   clips: [{ name, durationMs, loop, tracks: [{ bone, keys: [{ t, x, y, rot, scaleX, scaleY, ease }] }] }]
 * }
 *
 * 解析为运行时索引结构（Map + 拓扑排序），渲染与采样共享；
 * 严格合法性校验由 SkeletonAssetValidator 负责，本文件只做宽松归一化。
 */

export const SKELETON_ATTACHMENT_TYPES = Object.freeze(['empty', 'image', 'slice', 'sequence']);

/** 方向偏移覆盖的合法键：编辑器用 down/side/up；运行时斜向键先精确匹配再回退正/背。 */
export const SKELETON_DIRECTION_KEYS = Object.freeze(['down', 'side', 'up', 'SE', 'SW', 'NE', 'NW']);
const DIRECTION_MERGE = Object.freeze({ SE: 'down', SW: 'down', NE: 'up', NW: 'up' });

/**
 * 解析附件方向偏移：{ down|side|up|...: { x, y, rot, flipX? } }。
 * 逐字段生效（缺字段回退附件顶层值）；缺省对象 = 全方向共用顶层偏移（零迁移）。
 */
function normalizeDirectionOffsets(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of SKELETON_DIRECTION_KEYS) {
    const value = raw[key];
    if (!value || typeof value !== 'object') continue;
    const entry = { x: num(value.x), y: num(value.y), rot: num(value.rot) };
    if (value.flipX !== undefined) entry.flipX = value.flipX === true;
    out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 取附件在指定方向键下的偏移覆盖：先精确匹配（含斜向 SE/SW/NE/NW），
 * 无则按语义回退（斜下→down、斜上→up），仍无返回 null（全字段回退顶层值）。
 */
export function resolveAttachmentOffset(attachment, directionKey) {
  const offsets = attachment?.directionOffsets;
  if (!offsets || !directionKey) return null;
  if (offsets[directionKey]) return offsets[directionKey];
  const merged = DIRECTION_MERGE[directionKey];
  return merged ? offsets[merged] || null : null;
}

/**
 * 实体朝向（8 方向字符串）→ 附件方向键：left/right→side、
 * 斜向→SE/SW/NE/NW（与 PlayerSkeletonStateMapper 的 directionKey 对齐）。
 */
export function resolveDirectionKey(direction) {
  const value = String(direction || 'down');
  if (value === 'up') return 'up';
  if (value === 'left' || value === 'right') return 'side';
  if (value === 'down-right') return 'SE';
  if (value === 'down-left') return 'SW';
  if (value === 'up-right') return 'NE';
  if (value === 'up-left') return 'NW';
  return 'down';
}

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const str = value => (typeof value === 'string' ? value.trim() : '');

/** 归一化单个附件；非法类型返回 null（调用方回退 empty）。 */
function normalizeAttachment(raw) {
  const type = SKELETON_ATTACHMENT_TYPES.includes(raw?.type) ? raw.type : 'empty';
  if (type === 'empty') return { type: 'empty', x: 0, y: 0, rot: 0 };
  const base = {
    type,
    assetId: str(raw?.assetId) || str(raw?.spriteSheet),
    x: num(raw?.x), y: num(raw?.y), rot: num(raw?.rot),
    width: num(raw?.width) || 0,
    height: num(raw?.height) || 0,
    // 三方向可见性（front/side/back 组）：解析即透传，缺省可见（缺字段会被当 undefined 恒显示）
    visible: raw?.visible !== false
  };
  const directionOffsets = normalizeDirectionOffsets(raw?.directionOffsets);
  if (directionOffsets) base.directionOffsets = directionOffsets;
  if (raw?.flipX !== undefined) base.flipX = raw.flipX === true;
  if (type === 'slice') {
    return { ...base, sx: num(raw?.sx), sy: num(raw?.sy), sw: num(raw?.sw), sh: num(raw?.sh) };
  }
  if (type === 'sequence') {
    const frames = (Array.isArray(raw?.frames) ? raw.frames : [])
      .map(frame => ({
        sx: num(frame?.sx), sy: num(frame?.sy),
        sw: num(frame?.sw), sh: num(frame?.sh)
      }))
      .filter(frame => frame.sw > 0 && frame.sh > 0);
    return { ...base, frames, fps: num(raw?.fps, 8) > 0 ? num(raw?.fps, 8) : 8 };
  }
  return base;
}

/**
 * 解析骨骼资产 JSON 为运行时索引结构。
 * @param {Object} doc - 已 JSON.parse 的骨骼资产文档
 * @returns {Object|null} 解析结果；骨架明显不合法（无骨骼）返回 null
 */
export function parseSkeletonAsset(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.bones) || doc.bones.length === 0) {
    return null;
  }

  const bones = new Map();
  for (const raw of doc.bones) {
    const id = str(raw?.id);
    if (!id || bones.has(id)) continue;
    bones.set(id, {
      id,
      parent: str(raw?.parent) || null,
      x: num(raw?.x), y: num(raw?.y),
      rot: num(raw?.rot),                       // 角度制（度）
      scaleX: num(raw?.scaleX, 1) || 1,
      scaleY: num(raw?.scaleY, 1) || 1,
      length: num(raw?.length),
      children: []
    });
  }
  // 父引用清理：指向不存在骨骼的视为根
  for (const bone of bones.values()) {
    if (bone.parent && !bones.has(bone.parent)) bone.parent = null;
  }
  for (const bone of bones.values()) {
    if (bone.parent) bones.get(bone.parent).children.push(bone.id);
  }

  // 拓扑排序（父在前）：根骨骼为 parent === null 的第一条；多根按声明顺序
  const boneOrder = [];
  const visited = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    visited.add(id);
    const bone = bones.get(id);
    if (bone.parent) visit(bone.parent);
    boneOrder.push(id);
  };
  for (const id of bones.keys()) visit(id);

  const slots = (Array.isArray(doc.slots) ? doc.slots : [])
    .map((raw, index) => {
      const id = str(raw?.id) || `slot_${index}`;
      const bone = bones.has(str(raw?.bone)) ? str(raw?.bone) : boneOrder[0];
      const attachment = normalizeAttachment(raw?.attachment);
      return {
        id,
        bone: bone || boneOrder[0],
        z: Number.isFinite(Number(raw?.z)) ? Number(raw.z) : index,
        attachment
      };
    })
    .filter(slot => slot.bone)
    .sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  const clips = new Map();
  for (const raw of (Array.isArray(doc.clips) ? doc.clips : [])) {
    const name = str(raw?.name);
    if (!name || clips.has(name)) continue;
    const tracks = new Map();
    for (const track of (Array.isArray(raw?.tracks) ? raw.tracks : [])) {
      const boneId = str(track?.bone);
      if (!boneId || !bones.has(boneId)) continue;
      // null/undefined 一律解析为 null（采样时回退骨骼 rest）；
      // 注意 Number(null)===0，不能用 Number.isFinite(Number(v)) 判空——会把缺省缩放解析成 0（骨骼塌缩）。
      const nullableNum = value => (value == null || !Number.isFinite(Number(value))) ? null : Number(value);
      const keys = (Array.isArray(track?.keys) ? track.keys : [])
        .map(key => ({
          t: Math.max(0, num(key?.t)),
          x: nullableNum(key?.x),
          y: nullableNum(key?.y),
          rot: nullableNum(key?.rot),
          scaleX: nullableNum(key?.scaleX),
          scaleY: nullableNum(key?.scaleY),
          ease: key?.ease === 'easeInOut' ? 'easeInOut' : 'linear'
        }))
        .sort((a, b) => a.t - b.t);
      if (keys.length > 0) tracks.set(boneId, keys);
    }
    clips.set(name, {
      name,
      durationMs: Math.max(1, num(raw?.durationMs, 1000)),
      loop: raw?.loop !== false,
      tracks
    });
  }

  const meta = {
    width: num(doc?.meta?.width) || 0,
    height: num(doc?.meta?.height) || 0
  };

  return {
    id: str(doc?.skeletonId) || 'skeleton',
    schemaVersion: num(doc?.schemaVersion, 1) || 1,
    meta,
    bones,
    boneOrder,
    slots,
    clips,
    clipNames: [...clips.keys()],
    defaultClip: str(doc?.defaultClip) || clips.keys().next().value || null
  };
}

export default { parseSkeletonAsset, SKELETON_ATTACHMENT_TYPES };

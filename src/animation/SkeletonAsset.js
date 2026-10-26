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
 *   bones: [{ id, parent, x, y, rot, scaleX, scaleY, length,
 *             inherit: 'normal'|'noScale'|'noRotation'|'translationOnly' }],
 *   slots: [{ id, bone, z,
 *             follow: 'noScale'|'bone',                  // 挂图是否跟随骨骼缩放
 *             attachment: {
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

import {
  SKELETON_DIRECTION_KEYS,
  resolveDirectionKey
} from './SkeletonDirection.js';

export const SKELETON_ATTACHMENT_TYPES = Object.freeze(['empty', 'image', 'slice', 'sequence']);

/** 方向偏移覆盖的合法键：编辑器用 down/side/up + 四个斜向（SE/SW/NE/NW）；运行时斜向先精确匹配再回退正/背。 */
export { SKELETON_DIRECTION_KEYS, resolveDirectionKey };

/**
 * 骨骼继承模式（Spine Transform Mode 等价）：决定本骨骼如何继承父级的变换。
 *   normal         —— 继承父级位移+旋转+缩放（默认，与历史行为一致）
 *   noScale        —— 继承父级位移+旋转，但不继承父级缩放（父级缩放不再向下传递尺寸）
 *   noRotation     —— 继承父级位移+缩放，但不继承父级旋转
 *   translationOnly—— 只继承父级位移（父级旋转与缩放都不传递）
 * 详见 SkeletonPose.composeWorldTransforms。
 */
export const SKELETON_INHERIT_MODES = Object.freeze(['normal', 'noScale', 'noRotation', 'translationOnly']);

/**
 * 槽位跟随模式：决定挂图是否跟随所在骨骼的缩放。
 *   noScale —— 挂图只跟随骨骼的位置与旋转，不跟随缩放（骨骼缩放只改变肢体骨架，图片不变形）
 *   bone    —— 挂图完全跟随骨骼变换（含缩放，用于 squash & stretch 压扁拉伸）
 * 默认 noScale：拖骨骼缩放不应让绑定图片变形（与 Unity 骨骼=变形、贴图尺寸独立一致）。
 */
export const SKELETON_SLOT_FOLLOW_MODES = Object.freeze(['noScale', 'bone']);

/** 槽位跟随模式缺省值。 */
export const SKELETON_SLOT_FOLLOW_DEFAULT = 'noScale';

/**
 * 解析附件方向偏移：{ down|side|up|SE|SW|NE|NW: { x, y, rot, flipX?, assetId?, width?, height? } }。
 * 逐字段生效（缺字段回退附件顶层值）；缺省对象 = 全方向共用顶层偏移（零迁移）。
 * assetId/width/height = **方向形态换图**（正面/侧面/背面/斜前/斜后各用不同部件图）。
 */
function normalizeDirectionOffsets(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of SKELETON_DIRECTION_KEYS) {
    const value = raw[key];
    if (!value || typeof value !== 'object') continue;
    const entry = { x: num(value.x), y: num(value.y), rot: num(value.rot) };
    if (value.flipX !== undefined) entry.flipX = value.flipX === true;
    // 形态换图：按方向指定不同部件图与绘制尺寸（斜前/斜后形态）
    const assetId = str(value.assetId);
    if (assetId) entry.assetId = assetId;
    if (num(value.width) > 0) entry.width = num(value.width);
    if (num(value.height) > 0) entry.height = num(value.height);
    // 图集切片形态：同一张图集内按形态换源矩形（女骑士正/侧/背三套部件）
    if (num(value.sw) > 0 && num(value.sh) > 0) {
      entry.sx = num(value.sx);
      entry.sy = num(value.sy);
      entry.sw = num(value.sw);
      entry.sh = num(value.sh);
    }
    out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 规范化一条 transform 约束（挂件跟随挂件）。
 * @param {Object} raw - 原始约束
 * @returns {Object|null} 规范化结果；缺关键字段返回 null
 */
function normalizeTransformConstraint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const slot = str(raw.slot);
  const target = str(raw.target);
  if (!slot || !target) return null;
  return {
    type: 'transform',
    name: str(raw.name) || `${slot}->${target}`,
    slot,
    target,
    mix: Math.max(0, Math.min(1, Number.isFinite(Number(raw.mix)) ? Number(raw.mix) : 1)),
    offsetX: num(raw.offsetX),
    offsetY: num(raw.offsetY),
    offsetRot: num(raw.offsetRot),
    followRotation: raw.followRotation !== false
  };
}

/**
 * 取附件在指定形态键下的覆盖：精确匹配该形态（down/side/up/SE/SW/NE/NW）。
 * 未配置该形态 → 返回 null（调用方逐字段回退顶层正面基准），
 * 因此「斜向未配形态图 = 沿用正面基准图」，与编辑器预览口径一致。
 */
export function resolveAttachmentOffset(attachment, directionKey) {
  const offsets = attachment?.directionOffsets;
  if (!offsets || !directionKey) return null;
  return offsets[directionKey] || null;
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
 *
 * **不修改入参**：解析产物（骨骼/槽位/附件/关键帧）全部是新对象，
 * 因此调用方可以直接传原始文档（编辑器热路径每帧重解析，省掉深拷贝）。
 *
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
      // 继承模式：如何继承父级变换（缺省 normal = 历史行为）
      inherit: SKELETON_INHERIT_MODES.includes(raw?.inherit) ? raw.inherit : 'normal',
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
        // 跟随模式：挂图是否跟随所在骨骼的缩放（缺省 noScale = 图片不随骨骼缩放变形）
        follow: SKELETON_SLOT_FOLLOW_MODES.includes(raw?.follow) ? raw.follow : SKELETON_SLOT_FOLLOW_DEFAULT,
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
      // 贝塞尔控制点（schema v2，Unity 切线约定）：x∈[0,1]（时间单调）、y 任意（允许 overshoot）。
      // 非法/缺省剥离（不保留半残对象）；y 坐标不越界钳制——overshoot（ anticipation/follow-through）是合法曲线形态。
      const normalizeHandle = raw => {
        if (!raw || typeof raw !== 'object') return null;
        const x = Number(raw.x);
        const y = Number(raw.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: Math.max(0, Math.min(1, x)), y };
      };
      const keys = (Array.isArray(track?.keys) ? track.keys : [])
        .map(key => {
          const inHandle = normalizeHandle(key?.in);
          const outHandle = normalizeHandle(key?.out);
          return {
            t: Math.max(0, num(key?.t)),
            x: nullableNum(key?.x),
            y: nullableNum(key?.y),
            rot: nullableNum(key?.rot),
            scaleX: nullableNum(key?.scaleX),
            scaleY: nullableNum(key?.scaleY),
            ease: key?.ease === 'easeInOut' ? 'easeInOut' : 'linear',
            ...(inHandle ? { in: inHandle } : {}),
            ...(outHandle ? { out: outHandle } : {}),
            ...(key?.hold === true ? { hold: true } : {})
          };
        })
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

  const constraints = (Array.isArray(doc.constraints) ? doc.constraints : [])
    .map(raw => normalizeTransformConstraint(raw))
    .filter(Boolean);

  // meta 保留自定义扩展字段（frameMode / clipFrames / lpcActions 等）：
  // 整帧模式（meta.frameMode=true）由运行时映射器与编辑器预览共用 meta.clipFrames 帧表，
  // 只透传 width/height 会让这些字段在解析后丢失（整帧模式失效）。
  const meta = {
    ...(doc?.meta && typeof doc.meta === 'object' ? doc.meta : {}),
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
    constraints,
    clipNames: [...clips.keys()],
    defaultClip: str(doc?.defaultClip) || clips.keys().next().value || null
  };
}

export default { parseSkeletonAsset, SKELETON_ATTACHMENT_TYPES };

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
 * SkeletonEditorKeyframes - 骨骼关键帧的纯逻辑（upsert / 缓动语义）
 *
 * 与 UI 解耦，便于单测。编辑器只做「取当前采样姿态 → 调 upsertKey」，
 * 具体的关键帧合并规则集中在 upsertKey 里。
 */

/** 关键帧时间匹配容差（毫秒）：同一时刻的关键帧视为同一帧。 */
export const KEY_TIME_EPSILON = 5;

/** 合法缓动类型（与 SkeletonAsset / SkeletonAssetValidator 保持一致）。 */
export const EASE_TYPES = Object.freeze(['linear', 'easeInOut']);

/**
 * 在轨道中插入或更新关键帧。
 *
 * 语义要点：
 * 1. **缓动属于帧自身**：调用方未显式指定 ease 时，已有帧必须保留原缓动，
 *    新帧继承同轨道前一帧的缓动。绝不能无条件写死 'linear'——否则
 *    「打关键帧」会把动作预设带来的 easeInOut 静默抹掉，动画手感突变。
 * 2. **补全为完整姿态快照**：未显式给出的姿态字段取采样值（所见即所得）。
 *    半字段键（如缩放手柄只写 scale）会让缺省字段在采样时整段保持另一键的值
 *    或回退静止姿态——「调一帧、整段变形」的根因。
 *
 * @param {Object} track - 轨道对象 { bone, keys }
 * @param {Object} key - 待写入的关键帧 { t, x?, y?, rot?, scaleX?, scaleY?, ease? }
 * @param {Object} [sampled] - 当前采样姿态 { x, y, rot, sx, sy }，用于补全缺省字段
 * @returns {Object} 实际写入/更新的关键帧对象
 */
export function upsertKey(track, key, sampled = {}) {
  const existing = (track.keys || []).find(candidate => Math.abs(candidate.t - key.t) <= KEY_TIME_EPSILON);
  if (existing) {
    // 缓动是「帧自身的属性」：调用方未显式指定时必须保留原值。
    const patch = {};
    for (const [field, value] of Object.entries(key)) {
      if (value === null || value === undefined) continue;
      patch[field] = value;
    }
    if (patch.ease === undefined) delete patch.ease;
    Object.assign(existing, patch);
    return existing;
  }
  // 新键：姿态字段补全为完整快照；缓动继承同轨道前一帧（无前帧则 linear）。
  const previousKey = (track.keys || [])
    .filter(candidate => candidate.t < key.t)
    .pop() || null;
  const created = {
    ...key,
    x: key.x ?? sampled.x ?? 0,
    y: key.y ?? sampled.y ?? 0,
    rot: key.rot ?? sampled.rot ?? 0,
    scaleX: key.scaleX ?? sampled.sx ?? 1,
    scaleY: key.scaleY ?? sampled.sy ?? 1,
    ease: key.ease ?? previousKey?.ease ?? 'linear'
  };
  track.keys = track.keys || [];
  track.keys.push(created);
  track.keys.sort((a, b) => a.t - b.t);
  return created;
}

/**
 * 补循环尾帧：在剪辑结尾（t=durationMs）为轨道补一帧闭合帧，姿态=首帧。
 * 缓动沿用首帧——尾帧接回首帧姿态，插值风格须与开头一致才能无缝循环。
 *
 * @param {Object} track - 轨道对象
 * @param {number} durationMs - 剪辑时长
 * @returns {boolean} 是否补了尾帧（已有结尾帧则跳过）
 */
export function appendLoopTieKey(track, durationMs) {
  const keys = track.keys || [];
  if (!keys.length) return false;
  if (durationMs - keys[keys.length - 1].t <= KEY_TIME_EPSILON) return false;
  const first = keys[0];
  track.keys.push({
    t: durationMs,
    x: first.x ?? 0,
    y: first.y ?? 0,
    rot: first.rot ?? 0,
    scaleX: first.scaleX ?? null,
    scaleY: first.scaleY ?? null,
    ease: first.ease ?? 'linear'
  });
  track.keys.sort((a, b) => a.t - b.t);
  return true;
}

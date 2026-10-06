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
 * SkeletonPose.js - 骨骼姿态采样与变换组合（纯函数，与 DOM 解耦）
 *
 * 三个阶段：
 *   1. createRestLocalPose   —— 骨骼静止姿态（setup pose）
 *   2. sampleClip            —— 按时间采样动画剪辑，得到每根骨骼的局部变换
 *   3. composeWorldTransforms—— 沿父链组合成世界变换（供渲染/槽位附件使用）
 *
 * 坐标约定：角度制（度），y 轴向下（与 Canvas 一致）。
 * 世界变换组合：child_world = parent_world ∘ child_local
 *   wx = px + (lx·cos(pr) - ly·sin(pr))·psx
 *   wy = py + (lx·sin(pr) + ly·cos(pr))·psy
 *   wrot = pr + lrot；wsx = psx·lsx；wsy = psy·lsy
 */

const DEG2RAD = Math.PI / 180;

/** 静止局部姿态：Map(boneId -> { x, y, rot, sx, sy })。 */
export function createRestLocalPose(skeleton) {
  const pose = new Map();
  for (const bone of skeleton.bones.values()) {
    pose.set(bone.id, { x: bone.x, y: bone.y, rot: bone.rot, sx: bone.scaleX, sy: bone.scaleY });
  }
  return pose;
}

/** 插值缓动：linear 线性；easeInOut 平滑（smoothstep）。 */
export function applyEase(ease, t) {
  if (ease === 'easeInOut') return t * t * (3 - 2 * t);
  return t;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 单字段插值：两键都缺省返回 null（由调用方回退静止姿态）。 */
function sampleField(keys, timeMs, field) {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (timeMs <= first.t) return first[field];
  if (timeMs >= last.t) return last[field];

  let upper = 1;
  while (upper < keys.length && keys[upper].t < timeMs) upper += 1;
  const a = keys[upper - 1];
  const b = keys[upper];
  const span = b.t - a.t;
  const ratio = span > 0 ? (timeMs - a.t) / span : 0;
  const eased = applyEase(b.ease || a.ease, Math.max(0, Math.min(1, ratio)));
  const va = a[field];
  const vb = b[field];
  if (va === null && vb === null) return null;
  if (va === null) return vb;
  if (vb === null) return va;
  return lerp(va, vb, eased);
}

/**
 * 采样动画剪辑：返回 Map(boneId -> { x, y, rot, sx, sy })。
 * 无轨道的骨骼回退静止姿态；timeMs 会被钳制在 [0, durationMs]。
 * @param {Object} clip - parseSkeletonAsset 产出的 clip
 * @param {number} timeMs - 剪辑内时间（毫秒，调用方负责循环回绕）
 * @param {Map} restPose - createRestLocalPose 的结果
 * @returns {Map}
 */
export function sampleClip(clip, timeMs, restPose) {
  const pose = new Map();
  if (!clip) {
    for (const [boneId, value] of restPose) pose.set(boneId, { ...value });
    return pose;
  }
  const clamped = Math.max(0, Math.min(clip.durationMs, Number(timeMs) || 0));
  for (const boneId of restPose.keys()) {
    const rest = restPose.get(boneId);
    const keys = clip.tracks.get(boneId);
    if (!keys) {
      pose.set(boneId, { ...rest });
      continue;
    }
    const x = sampleField(keys, clamped, 'x');
    const y = sampleField(keys, clamped, 'y');
    const rot = sampleField(keys, clamped, 'rot');
    const sx = sampleField(keys, clamped, 'scaleX');
    const sy = sampleField(keys, clamped, 'scaleY');
    pose.set(boneId, {
      x: x === null ? rest.x : x,
      y: y === null ? rest.y : y,
      rot: rot === null ? rest.rot : rot,
      sx: sx === null ? rest.sx : sx,
      sy: sy === null ? rest.sy : sy
    });
  }
  return pose;
}

/**
 * 沿父链组合世界变换（skeleton.boneOrder 保证父先算）。
 * @returns {Map(boneId -> { x, y, rot, sx, sy, rad })} rad 为世界旋转弧度（渲染直用）
 */
export function composeWorldTransforms(skeleton, localPose) {
  const world = new Map();
  for (const boneId of skeleton.boneOrder) {
    const bone = skeleton.bones.get(boneId);
    const local = localPose.get(boneId) || { x: bone.x, y: bone.y, rot: bone.rot, sx: bone.scaleX, sy: bone.scaleY };
    const parent = bone.parent ? world.get(bone.parent) : null;
    if (!parent) {
      const rad = local.rot * DEG2RAD;
      world.set(boneId, { x: local.x, y: local.y, rot: local.rot, sx: local.sx, sy: local.sy, rad });
      continue;
    }
    const parentRad = parent.rad;
    const cos = Math.cos(parentRad);
    const sin = Math.sin(parentRad);
    const x = parent.x + (local.x * cos - local.y * sin) * parent.sx;
    const y = parent.y + (local.x * sin + local.y * cos) * parent.sy;
    const rot = parent.rot + local.rot;
    world.set(boneId, {
      x, y, rot,
      sx: parent.sx * local.sx,
      sy: parent.sy * local.sy,
      rad: rot * DEG2RAD
    });
  }
  return world;
}

/**
 * 一站式：静止姿态 → 采样 → 世界变换。
 * @returns {{ local: Map, world: Map }}
 */
export function evaluateSkeletonPose(skeleton, clip, timeMs) {
  const rest = createRestLocalPose(skeleton);
  const local = sampleClip(clip, timeMs, rest);
  const world = composeWorldTransforms(skeleton, local);
  return { local, world };
}

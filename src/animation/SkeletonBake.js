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
 * SkeletonBake.js - 动画曲线预烘焙（运行时查表采样）
 *
 * 目的：把「每帧按关键帧扫描 + 贝塞尔二分求解」换成「按固定步长查表 + 线性插值」：
 *   - 贝塞尔曲线（schema v2）每段要二分 20 次求参数，曲线段一多就是主要开销；
 *   - 预烘焙把求值成本压到烘焙时一次，运行时每帧只做一次查表 + 一次插值。
 *
 * 精度：步长 20ms 时线性化误差约 0.2px（肉眼不可见），可在烘焙参数里调细。
 *
 * 烘焙产物（baked clip）：
 * {
 *   name, durationMs, loop, stepMs,
 *   bones: [{ id, x: Float32Array, y, rot, scaleX, scaleY, count }]
 * }
 */

import { sampleClip } from './SkeletonPose.js';

const DEFAULT_STEP_MS = 20;

/**
 * 烘焙一个剪辑：按固定步长预采样每根骨骼的局部姿态。
 *
 * @param {Object} clip - parseSkeletonAsset 产出的 clip（tracks 为 Map）
 * @param {Object} restPose - createRestLocalPose 的结果（缺省帧回退用）
 * @param {Object} [options]
 * @param {number} [options.stepMs] - 采样步长（毫秒，默认 20）
 * @returns {Object} 烘焙产物
 */
export function bakeClip(clip, restPose, options = {}) {
  const stepMs = Math.max(1, Number(options.stepMs) || DEFAULT_STEP_MS);
  const durationMs = Math.max(0, Number(clip?.durationMs) || 0);
  const count = Math.max(1, Math.floor(durationMs / stepMs) + 1);
  const boneIds = new Set(clip?.tracks?.keys?.() || []);
  const columns = new Map();
  for (const boneId of boneIds) {
    columns.set(boneId, {
      id: boneId,
      x: new Float32Array(count),
      y: new Float32Array(count),
      rot: new Float32Array(count),
      scaleX: new Float32Array(count),
      scaleY: new Float32Array(count),
      count
    });
  }
  // 逐采样点用引擎自己的采样器取值（与运行时完全同一套语义，避免另写一份插值）
  for (let index = 0; index < count; index += 1) {
    const time = Math.min(durationMs, index * stepMs);
    const pose = sampleClip(clip, time, restPose);
    for (const boneId of boneIds) {
      const column = columns.get(boneId);
      const value = pose.get(boneId);
      const rest = restPose?.get(boneId) || { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
      column.x[index] = value ? value.x : rest.x;
      column.y[index] = value ? value.y : rest.y;
      column.rot[index] = value ? value.rot : rest.rot;
      column.scaleX[index] = value ? value.sx : rest.sx;
      column.scaleY[index] = value ? value.sy : rest.sy;
    }
  }
  return {
    name: clip?.name || '',
    durationMs,
    loop: clip?.loop !== false,
    stepMs,
    bones: [...columns.values()]
  };
}

/**
 * 烘焙表采样：在相邻两个采样点之间线性插值。
 *
 * @param {Object} baked - bakeClip 的产物
 * @param {number} timeMs - 剪辑内时间
 * @param {Map} out - 复用的输出 Map（boneId -> {x,y,rot,sx,sy}）
 * @returns {Map} 与 out 相同
 */
export function sampleBakedClip(baked, timeMs, out) {
  const target = out instanceof Map ? out : new Map();
  if (!baked) return target;
  const duration = Math.max(0, Number(baked.durationMs) || 0);
  let time = Math.max(0, Number(timeMs) || 0);
  if (baked.loop === true && duration > 0) {
    time %= duration;
  } else {
    time = Math.min(time, duration);
  }
  const step = Math.max(1, Number(baked.stepMs) || DEFAULT_STEP_MS);
  for (const bone of baked.bones) {
    const position = time / step;
    let index = Math.floor(position);
    if (index >= bone.count - 1) index = Math.max(0, bone.count - 2);
    const next = Math.min(bone.count - 1, index + 1);
    const u = bone.count > 1 ? Math.max(0, Math.min(1, position - index)) : 0;
    const values = target.get(bone.id) || { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
    values.x = bone.x[index] + (bone.x[next] - bone.x[index]) * u;
    values.y = bone.y[index] + (bone.y[next] - bone.y[index]) * u;
    values.rot = bone.rot[index] + (bone.rot[next] - bone.rot[index]) * u;
    // 字段名与 sampleClip 的局部姿势结构一致（sx/sy，不是 scaleX/scaleY）
    values.sx = bone.scaleX[index] + (bone.scaleX[next] - bone.scaleX[index]) * u;
    values.sy = bone.scaleY[index] + (bone.scaleY[next] - bone.scaleY[index]) * u;
    target.set(bone.id, values);
  }
  return target;
}

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
 * SkeletonIk.js - IK 约束求解（纯函数，与 DOM 解耦）
 *
 * 骨骼动画里 IK 有两类典型用途，本模块各给一种解法：
 *
 * 1. **朝向 IK（aim / look-at）** —— 等价 Spine 的 IK constraint：
 *    让整条骨链「指向」目标点。做法是链条根骨的世界朝向对齐目标方向，
 *    链内各骨相对根骨的偏角保持不变（所以弯肘、甩尾的形状不被破坏）。
 *    用途：头部朝向、武器指向、瞄准。
 *
 * 2. **位置 IK（twoBone / CCD）** —— 等价 Unity 的 TwoBoneIK：
 *    让骨链末端原点命中目标点。用 CCD（循环下降法）迭代：
 *    从末端往根依次旋转每根骨，让它的子骨指向目标，每轮重算受影响子树。
 *    CCD 对任意局部偏移都收敛（不要求骨段沿自身 x 轴），比解析解更契合
 *    本引擎「骨骼局部偏移任意」的姿态数据。用途：手抓点、脚踩点、骑乘。
 *
 * 姿态写回：IK 解算改写的是**局部 rot**（骨骼局部朝向），
 * 因此导出时天然是 FK 关键帧——编辑器里「用 IK 摆姿势」= 直接烘焙成 FK。
 *
 * 约束结构（运行时由实体/系统提供，不进资产 JSON，保持导出干净）：
 * {
 *   id: 'hand-ik',
 *   type: 'aim' | 'twoBone',
 *   bones: ['upperArm', 'foreArm'],   // 骨骼链，从根到末端（必须是连续的父子链）
 *   target: { x, y },                 // 世界坐标目标点
 *   mix: 1,                           // 0=纯 FK，1=纯 IK（按最短弧混合角度）
 *   offsetAngle: 0,                   // 目标角度偏移（度）
 *   iterations: 4                     // CCD 迭代次数（twoBone 用）
 * }
 */

import { composeWorldTransforms, composeWorldTransformsFrom } from './SkeletonPose.js';

const RAD2DEG = 180 / Math.PI;

/** IK 约束类型。 */
export const IK_CONSTRAINT_TYPES = Object.freeze(['aim', 'twoBone']);

/** 默认 CCD 迭代次数。 */
export const IK_DEFAULT_ITERATIONS = 4;

/** 角度归一到 (-180, 180]（度）。 */
export function normalizeDeg(deg) {
  let value = Number(deg) || 0;
  value %= 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

/** from → to 的最短角差（度，范围 (-180,180]）。 */
export function shortestDeltaDeg(from, to) {
  return normalizeDeg(to - from);
}

/** 按最短弧插值两个角度（度）。 */
export function lerpDeg(a, b, t) {
  const ratio = Math.max(0, Math.min(1, Number(t) || 0));
  return normalizeDeg(a + shortestDeltaDeg(a, b) * ratio);
}

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

/**
 * 规范化一条 IK 约束（缺省补齐、非法值收敛）。
 * @param {Object} raw - 原始约束
 * @returns {Object|null} 规范化后的约束；bones/target 缺失返回 null
 */
export function createIkConstraint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bones = Array.isArray(raw.bones) ? raw.bones.filter(id => typeof id === 'string' && id) : [];
  if (!bones.length) return null;
  const target = raw.target && Number.isFinite(Number(raw.target.x)) && Number.isFinite(Number(raw.target.y))
    ? { x: Number(raw.target.x), y: Number(raw.target.y) }
    : null;
  if (!target) return null;
  const type = IK_CONSTRAINT_TYPES.includes(raw.type) ? raw.type : 'aim';
  return {
    id: raw.id || bones.join('>'),
    type,
    bones,
    target,
    mix: clamp01(raw.mix === undefined ? 1 : raw.mix),
    offsetAngle: Number(raw.offsetAngle) || 0,
    iterations: Math.max(1, Math.min(16, Number(raw.iterations) || IK_DEFAULT_ITERATIONS))
  };
}

/**
 * 校验 IK 骨链：必须是存在的骨骼、且为连续的父子链。
 * @param {Array<string>} bones - 骨骼 id 数组（根 → 末端）
 * @param {Object} skeleton - parseSkeletonAsset 产物
 * @returns {Array<string>} 合法链；不合法返回空数组
 */
export function resolveIkChain(bones, skeleton) {
  if (!Array.isArray(bones) || !bones.length) return [];
  const chain = [];
  for (const boneId of bones) {
    const bone = skeleton.bones.get(boneId);
    if (!bone) return [];
    if (chain.length > 0) {
      const previous = skeleton.bones.get(chain[chain.length - 1]);
      if (bone.parent !== previous.id) return []; // 必须连续父子链
    }
    chain.push(bone.id);
  }
  return chain;
}

/**
 * 朝向 IK（aim）：链条根骨朝向对齐目标，链内相对偏角保持不变。
 * 直接改写传入的局部姿势副本。
 * @returns {Array<string>} 受影响的骨骼 id
 */
function solveAim(skeleton, pose, world, constraint, chain) {
  const rootId = chain[0];
  const rootBone = skeleton.bones.get(rootId);
  const rootWorld = world.get(rootId);
  if (!rootBone || !rootWorld) return [];
  const dx = constraint.target.x - rootWorld.x;
  const dy = constraint.target.y - rootWorld.y;
  if (dx === 0 && dy === 0) return [];
  const desiredRootRot = normalizeDeg(Math.atan2(dy, dx) * RAD2DEG + (constraint.offsetAngle || 0));
  const oldRootRot = rootWorld.rot;
  // 链内各骨的新世界朝向 = 新根朝向 + 原有相对偏角
  const newWorldRot = new Map();
  newWorldRot.set(rootId, desiredRootRot);
  for (let i = 1; i < chain.length; i += 1) {
    const boneId = chain[i];
    const boneWorld = world.get(boneId);
    if (!boneWorld) continue;
    newWorldRot.set(boneId, normalizeDeg(desiredRootRot + (boneWorld.rot - oldRootRot)));
  }
  const affected = [];
  for (const boneId of chain) {
    const bone = skeleton.bones.get(boneId);
    const local = pose.get(boneId);
    const worldRot = newWorldRot.get(boneId);
    if (!bone || !local || worldRot === undefined) continue;
    const parent = bone.parent ? skeleton.bones.get(bone.parent) : null;
    const parentRot = parent
      ? (newWorldRot.get(parent.id) ?? world.get(parent.id)?.rot ?? 0)
      : 0;
    local.rot = normalizeDeg(worldRot - parentRot);
    affected.push(boneId);
  }
  return affected;
}

/**
 * 位置 IK（twoBone / CCD）：链末端原点命中目标。
 * 逐轮从末端往根旋转，每根骨让它的子骨指向目标；每步重算受影响子树。
 * @returns {Array<string>} 受影响的骨骼 id
 */
function solveTwoBone(skeleton, pose, world, constraint, chain) {
  const target = constraint.target;
  const iterations = constraint.iterations;
  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = chain.length - 2; i >= 0; i -= 1) {
      const boneId = chain[i];
      const childId = chain[i + 1];
      const boneWorld = world.get(boneId);
      const childWorld = world.get(childId);
      const local = pose.get(boneId);
      if (!boneWorld || !childWorld || !local) continue;
      // 标准 CCD：旋转本骨，使「子骨相对本骨的方向」转向目标方向
      const currentDir = Math.atan2(childWorld.y - boneWorld.y, childWorld.x - boneWorld.x) * RAD2DEG;
      const desiredDir = Math.atan2(target.y - boneWorld.y, target.x - boneWorld.x) * RAD2DEG;
      const delta = shortestDeltaDeg(currentDir, desiredDir);
      if (Math.abs(delta) < 1e-6) continue;
      local.rot = normalizeDeg(local.rot + delta);
      // 子骨位置随父骨朝向变化 → 必须同步重算，否则下一轮迭代用的是旧位置
      composeWorldTransformsFrom(skeleton, pose, world, boneId);
    }
  }
  return chain.slice();
}

/**
 * 对局部姿势应用一组 IK 约束，返回**新的**局部姿势（入参不被修改）。
 *
 * 流程：FK 世界变换 → 逐条求解 IK（改写局部 rot）→ 按 mix 与 FK 混合 → 重算世界变换。
 * 运行时用法：evaluateSkeletonPose 得到 FK 后再过一遍 applyIkConstraints。
 *
 * @param {Object} skeleton - parseSkeletonAsset 产物
 * @param {Map} localPose - FK 局部姿势（Map boneId -> {x,y,rot,sx,sy}）
 * @param {Map} world - FK 世界变换（Map boneId -> {x,y,rot,sx,sy,rad}）
 * @param {Array<Object>} constraints - IK 约束数组
 * @returns {Map} 应用 IK 后的局部姿势（无有效约束时返回入参本身）
 */
export function applyIkConstraints(skeleton, localPose, world, constraints) {
  if (!Array.isArray(constraints) || !constraints.length) return localPose;
  const pose = new Map();
  for (const [boneId, value] of localPose) pose.set(boneId, { ...value });
  const worldMap = new Map(world);
  for (const raw of constraints) {
    const constraint = createIkConstraint(raw);
    if (!constraint) continue;
    const chain = resolveIkChain(constraint.bones, skeleton);
    if (!chain.length) continue;
    // FK 角度快照（mix 混合用）
    const fkRot = new Map();
    for (const boneId of chain) {
      const local = pose.get(boneId);
      fkRot.set(boneId, local ? local.rot : (skeleton.bones.get(boneId)?.rot ?? 0));
    }
    const affected = constraint.type === 'twoBone' && chain.length >= 2
      ? solveTwoBone(skeleton, pose, worldMap, constraint, chain)
      : solveAim(skeleton, pose, worldMap, constraint, chain);
    if (!affected.length) continue;
    if (constraint.mix < 1) {
      for (const boneId of affected) {
        const local = pose.get(boneId);
        if (!local) continue;
        local.rot = lerpDeg(fkRot.get(boneId) ?? local.rot, local.rot, constraint.mix);
      }
    }
    // 姿势已变 → 同步世界变换（从链根起重算整条链），供后续约束使用
    composeWorldTransformsFrom(skeleton, pose, worldMap, chain[0]);
  }
  return pose;
}

/**
 * 一站式：FK 局部姿势 + 世界变换 + IK 约束 → 最终世界变换。
 * @param {Object} skeleton - parseSkeletonAsset 产物
 * @param {Map} localPose - FK 局部姿势
 * @param {Map} world - FK 世界变换
 * @param {Array<Object>} constraints - IK 约束
 * @returns {{ local: Map, world: Map }}
 */
export function evaluatePoseWithIk(skeleton, localPose, world, constraints) {
  const solved = applyIkConstraints(skeleton, localPose, world, constraints);
  if (solved === localPose) return { local: localPose, world };
  return { local: solved, world: composeWorldTransforms(skeleton, solved) };
}

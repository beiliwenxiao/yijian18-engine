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
 * SkeletonEditorIk.js - 骨骼编辑器 IK 工具的可测内核（无 DOM 依赖）
 *
 * 编辑器侧的 IK 是「工具态」：启用后画布出现目标点，拖动目标点实时求解，
 * 结果直接写回 FK（动画模式打 rot 关键帧 / 装配模式写静止姿态）——
 * 即「用 IK 摆姿势并烘焙成 FK」，资产里不残留任何 IK 数据（导出干净）。
 */

/**
 * 从指定骨骼向上取 chainLength 根组成 IK 链（返回根→末顺序）。
 * @param {Array<Object>} bones - 骨骼定义数组（{ id, parent }）
 * @param {string} boneId - 末骨 id
 * @param {number} chainLength - 链长（1~4）
 * @returns {Array<string>} 骨骼 id 链（根 → 末）
 */
export function buildIkChain(bones, boneId, chainLength) {
  const byId = new Map((bones || []).map(bone => [bone.id, bone]));
  const chain = [];
  let cursor = byId.get(boneId);
  const limit = Math.max(1, Math.min(4, Number(chainLength) || 1));
  while (cursor && chain.length < limit) {
    chain.unshift(cursor.id);
    cursor = cursor.parent ? byId.get(cursor.parent) : null;
  }
  return chain;
}

/**
 * IK 目标点默认位置：末骨沿自身朝向前方一段距离。
 * @param {Object} boneWorld - 末骨世界变换 { x, y, rad }
 * @param {number} [distance] - 前伸距离（默认 30）
 * @returns {{x:number, y:number}}
 */
export function defaultIkTarget(boneWorld, distance = 30) {
  if (!boneWorld) return { x: 0, y: 0 };
  const reach = Number(distance) || 30;
  return {
    x: boneWorld.x + Math.cos(boneWorld.rad) * reach,
    y: boneWorld.y + Math.sin(boneWorld.rad) * reach
  };
}

/**
 * 从 IK 解算结果里挑出需要写回 FK 的骨骼旋转值（忽略变化过小的骨，避免刷关键帧）。
 * @param {Map} solvedPose - IK 解算后的局部姿势（Map boneId -> { rot }）
 * @param {Array<string>} chain - IK 链
 * @param {(boneId: string) => number} currentRot - 取当前 rot 的回调（关键帧采样值或静止姿态）
 * @param {number} [epsilon] - 变化阈值（度）
 * @returns {Map<string, number>} boneId → 新 rot（度，保留一位小数）
 */
export function collectIkRotations(solvedPose, chain, currentRot, epsilon = 0.05) {
  const result = new Map();
  for (const boneId of chain || []) {
    const nextRot = solvedPose?.get(boneId)?.rot;
    if (nextRot === undefined) continue;
    const from = Number(currentRot?.(boneId)) || 0;
    if (Math.abs(from - nextRot) < epsilon) continue;
    result.set(boneId, Math.round(nextRot * 10) / 10);
  }
  return result;
}

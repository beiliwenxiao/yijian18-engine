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
 * SkeletonConstraint.js - transform 约束求解（挂件跟随挂件）
 *
 * 语义（等价 Spine 的 transform constraint）：
 *   跟随者的锚点向「目标锚点 + 偏移」靠拢，mix 控制靠拢比例（0=不动，1=完全跟随）；
 *   followRotation=true 时朝向也跟着目标转（偏移角在目标朝向下叠加）。
 *
 * 约束数据（资产级，存 doc.constraints）：
 *   { type: 'transform', name, slot: '跟随者槽位', target: '目标槽位',
 *     mix: 1, offsetX: 0, offsetY: 0, offsetRot: 0, followRotation: true }
 *
 * 求解在「锚点已算出」之后进行（渲染器/编辑器都是两遍：先算锚点 → 应用约束 → 绘制）。
 */

const DEG2RAD = Math.PI / 180;

/** 角度差取最短弧（弧度）。 */
function shortestDelta(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * 对锚点列表应用 transform 约束（就地修改锚点的 x/y/angle）。
 *
 * @param {Array<Object>} anchors - 锚点列表（每项含 slot.id、x、y、angle）
 * @param {Array<Object>} constraints - 约束列表
 * @returns {Array<Object>} 同一个 anchors
 */
export function applyTransformConstraints(anchors, constraints) {
  if (!Array.isArray(constraints) || !constraints.length || !Array.isArray(anchors)) return anchors;
  const bySlot = new Map();
  for (const entry of anchors) {
    const id = entry?.slot?.id;
    if (id) bySlot.set(id, entry);
  }
  for (const constraint of constraints) {
    if (!constraint || constraint.type !== 'transform') continue;
    const source = bySlot.get(constraint.target);
    const follower = bySlot.get(constraint.slot);
    if (!source || !follower) continue;
    const mix = Math.max(0, Math.min(1, Number(constraint.mix ?? 1)));
    if (mix <= 0) continue;
    // 位置：目标锚点 + 偏移（偏移按目标朝向旋转）
    const cos = Math.cos(source.angle);
    const sin = Math.sin(source.angle);
    const offsetX = Number(constraint.offsetX) || 0;
    const offsetY = Number(constraint.offsetY) || 0;
    const targetX = source.x + (offsetX * cos - offsetY * sin);
    const targetY = source.y + (offsetX * sin + offsetY * cos);
    follower.x += (targetX - follower.x) * mix;
    follower.y += (targetY - follower.y) * mix;
    if (constraint.followRotation !== false) {
      const desired = source.angle + (Number(constraint.offsetRot) || 0) * DEG2RAD;
      follower.angle += shortestDelta(follower.angle, desired) * mix;
    }
  }
  return anchors;
}

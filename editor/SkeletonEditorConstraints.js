/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-26
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * SkeletonEditorConstraints.js - transform 约束（挂件跟随挂件）编辑助手（纯函数）
 *
 * 操作对象是骨骼 JSON 文档的 doc.constraints 数组（作者态数据），与
 * src/animation/SkeletonAsset.normalizeTransformConstraint 的运行时规范化字段对齐：
 *   { type:'transform', name?, slot, target, mix, offsetX, offsetY, offsetRot, followRotation }
 * 编辑器负责保证引用完整性：槽位改名/删除时同步清理约束引用，避免悬挂引用。
 */

/** 约束缺省值（新增约束时的初始参数，与运行时 normalizeTransformConstraint 缺省一致）。 */
const CONSTRAINT_DEFAULTS = Object.freeze({
  type: 'transform',
  mix: 1,
  offsetX: 0,
  offsetY: 0,
  offsetRot: 0,
  followRotation: true
});

/**
 * 取文档的约束数组（只读口径；未配置返回空数组，不创建字段）。
 * @param {Object} doc - 骨骼 JSON 文档
 * @returns {Array<Object>}
 */
export function listConstraints(doc) {
  return Array.isArray(doc?.constraints) ? doc.constraints : [];
}

/**
 * 取某槽位作为跟随者的 transform 约束（每槽最多一条）。
 * @param {Object} doc - 骨骼 JSON 文档
 * @param {string} slotId - 跟随者槽位 id
 * @returns {Object|null}
 */
export function findFollowerConstraint(doc, slotId) {
  if (!slotId) return null;
  return listConstraints(doc).find(
    constraint => constraint?.type === 'transform' && constraint.slot === slotId
  ) || null;
}

/**
 * 取跟随某目标槽位的全部约束（用于检查器反向展示）。
 * @param {Object} doc - 骨骼 JSON 文档
 * @param {string} slotId - 目标槽位 id
 * @returns {Array<Object>}
 */
export function listConstraintsTargeting(doc, slotId) {
  if (!slotId) return [];
  return listConstraints(doc).filter(
    constraint => constraint?.type === 'transform' && constraint.target === slotId
  );
}

/**
 * 为槽位创建跟随约束（每槽最多一条，已存在时返回 null）。
 * 目标缺省取第一个「有附件且非自身」的槽位（无候选返回 null）。
 * @param {Object} doc - 骨骼 JSON 文档
 * @param {string} slotId - 跟随者槽位 id
 * @param {string} [targetId] - 指定目标；缺省自动挑选
 * @returns {Object|null} 新建的约束
 */
export function addFollowerConstraint(doc, slotId, targetId = null) {
  if (!doc || !slotId || findFollowerConstraint(doc, slotId)) return null;
  const slots = Array.isArray(doc.slots) ? doc.slots : [];
  const target = targetId || slots.find(
    candidate => candidate?.id !== slotId && candidate?.attachment?.type && candidate.attachment.type !== 'empty'
  )?.id;
  if (!target || target === slotId) return null;
  if (!Array.isArray(doc.constraints)) doc.constraints = [];
  const constraint = { ...CONSTRAINT_DEFAULTS, slot: slotId, target };
  doc.constraints.push(constraint);
  return constraint;
}

/**
 * 更新约束字段（跟随者维度定位；字段值原样写入，规范化交给运行时解析）。
 * @param {Object} doc - 骨骼 JSON 文档
 * @param {string} slotId - 跟随者槽位 id
 * @param {Object} patch - 字段补丁 { target?, mix?, offsetX?, offsetY?, offsetRot?, followRotation? }
 * @returns {boolean} 是否命中并更新
 */
export function updateFollowerConstraint(doc, slotId, patch = {}) {
  const constraint = findFollowerConstraint(doc, slotId);
  if (!constraint) return false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    constraint[key] = value;
  }
  return true;
}

/**
 * 删除槽位的跟随约束；数组空了连字段一起清（不残留空数组进 JSON）。
 * @param {Object} doc - 骨骼 JSON 文档
 * @param {string} slotId - 跟随者槽位 id
 * @returns {boolean} 是否删除了约束
 */
export function removeFollowerConstraint(doc, slotId) {
  const constraints = listConstraints(doc);
  const next = constraints.filter(
    constraint => !(constraint?.type === 'transform' && constraint.slot === slotId)
  );
  if (next.length === constraints.length) return false;
  if (next.length === 0) delete doc.constraints;
  else doc.constraints = next;
  return true;
}

/**
 * 槽位改名：同步改写约束里的 slot/target 引用。
 * @param {Object} doc - 骨骼 JSON 文档
 * @param {string} oldId - 旧槽位 id
 * @param {string} newId - 新槽位 id
 */
export function renameSlotConstraintRefs(doc, oldId, newId) {
  for (const constraint of listConstraints(doc)) {
    if (constraint?.type !== 'transform') continue;
    if (constraint.slot === oldId) constraint.slot = newId;
    if (constraint.target === oldId) constraint.target = newId;
  }
}

/**
 * 删除槽位：清掉所有引用该槽位的约束（作为跟随者或目标）。
 * @param {Object} doc - 骨骼 JSON 文档
 * @param {string} slotId - 被删除的槽位 id
 * @returns {number} 清理的约束条数
 */
export function pruneSlotConstraints(doc, slotId) {
  const constraints = listConstraints(doc);
  const kept = constraints.filter(
    constraint => constraint?.type === 'transform'
      && constraint.slot !== slotId && constraint.target !== slotId
  );
  const removed = constraints.length - kept.length;
  if (removed === 0) return 0;
  if (kept.length === 0) delete doc.constraints;
  else doc.constraints = kept;
  return removed;
}

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
 * SkeletonJumpClip.js —— 跳跃剪辑命名解析（部件模式）
 *
 * 部件模式的跳跃按形态分三份：jump_down / jump_side / jump_up
 * （新骨架的腿是「大腿/小腿/脚」三节骨链，同一组 rot 在侧视是前后摆、
 *   在正/背视是左右外撇，单一剪辑无法同时成立 → 侧视会膝盖反关节）。
 * 旧资产只有一个通用 'jump' 剪辑 —— 此时回退它。
 *
 * 整帧模式（LPC）资产另有 frameMode 映射器（PlayerLpcFrameMapper），
 * 其 jump 走 meta.clipFrames['jump']，与本模块无关。
 */

import { SKELETON_DIAGONAL_FALLBACK, resolveDirectionKey } from './SkeletonDirection.js';

/**
 * 解析跳跃剪辑名（按朝向形态）。
 * @param {Object|null} asset - parseSkeletonAsset 产物（null=资产未就绪）
 * @param {string} directionKey - 朝向形态键（down/side/up/SE/SW/NE/NW）
 * @returns {string|null} 剪辑名；无可用跳跃剪辑时返回 null（调用方跳过播放）
 */
export function resolveJumpClipName(asset, directionKey) {
  // 资产未就绪：先按通用 'jump' 请求（资产到位后若不存在会回退默认剪辑）
  if (!asset) return 'jump';
  const form = SKELETON_DIAGONAL_FALLBACK[directionKey] || directionKey;
  const formClip = `jump_${form}`;
  if (asset.clips.has(formClip)) return formClip;
  return asset.clips.has('jump') ? 'jump' : null;
}

/** 资产是否提供按形态拆分的跳跃剪辑（部件模式：jump_down/jump_side/jump_up）。 */
export function hasFormJumpClips(asset) {
  if (!asset) return false;
  return asset.clips.has('jump_down') || asset.clips.has('jump_side') || asset.clips.has('jump_up');
}

/**
 * 解析实体应播放的跳跃剪辑名。
 * - 部件模式（提供形态跳跃剪辑）：返回 null —— 跳跃剪辑由状态映射器按当前朝向自行选择，
 *   避免起跳瞬间与滞空中的朝向不一致。
 * - 整帧模式（LPC）或旧资产（单一 'jump'）：返回 'jump'，由外部 playClip 触发。
 * @param {Object} entity - 实体（含 sprite / skeleton 组件）
 * @returns {string|null} 剪辑名；无需外部触发时返回 null
 */
export function resolveEntityJumpClipName(entity) {
  const skeleton = entity?.getComponent?.('skeleton');
  const asset = skeleton?.skeletonAsset || null;
  if (!asset) return null;          // 资产未就绪：等资产加载后由映射器接管
  if (hasFormJumpClips(asset)) return null;
  return asset.clips.has('jump') ? 'jump' : null;
}

/** 是否为跳跃剪辑名（通用 'jump' 或形态剪辑 jump_down/jump_side/jump_up）。 */
export function isJumpClipName(name) {
  return name === 'jump' || String(name || '').startsWith('jump_');
}

export default resolveJumpClipName;

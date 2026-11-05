/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-05
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * AnimationActionResolver - 动作×方向统一解析器（骨骼动画与序列帧共用）
 *
 * ## 抽象模型
 *   动作（action）是主键：walk / idle / attack / jump / death / climb_back …
 *   方向（direction）是次键：8 朝向字符串 → 形态键（down/side/up/SE/SW/NE/NW，
 *   见 SkeletonDirection.js）。一个动作可以有多方向变体，也可以只有单方向：
 *     - 多方向动作：剪辑名 `${action}_${形态键}`（walk_down / attack_side …）
 *     - 单方向动作：仅 `${action}`（death / climb_back / attack …）
 *   方向向下挂载具体实现：
 *     - 骨骼实现：asset.clips（Map）里查骨骼剪辑
 *     - 整帧实现：meta.clipFrames[name] 帧表（dirs 提供逐方向帧序列）
 *
 * ## 回退链（resolveActionClip）
 *   ① ${action}_${dirKey}                      精确形态
 *   ② ${action}_${斜向回退形态}                 SE→down、NE→up（正/背/侧无此级）
 *   ③ ${action}                                单方向动作
 *   ④ null（调用方回退 defaultClip / 跳过）
 *
 * 部件骨骼映射器与整帧（LPC）映射器共用本模块，保证两种实现下
 * 「同一动作 + 同一朝向」解析出同一回退语义。
 */

import {
  SKELETON_DIAGONAL_FALLBACK,
  resolveDirectionKey
} from './SkeletonDirection.js';

/** 已知方向形态后缀（剥离剪辑名方向用；sit_down 这类动作名不受误伤的前提）。 */
const FORM_SUFFIXES = ['sideL', 'down', 'side', 'up', 'SE', 'SW', 'NE', 'NW'];

/**
 * 探测资产是否提供某剪辑（双实现：骨骼 clips Map / 整帧 clipFrames 帧表）。
 * 两源都查：整帧（LPC）资产经 parseSkeletonAsset 也有空 clips Map，
 * 真实帧表在 meta.clipFrames，单查 clips 会漏。
 * @param {Object|null} asset - parseSkeletonAsset 产物
 * @param {string} name - 剪辑名
 * @returns {boolean}
 */
export function hasClip(asset, name) {
  if (!asset || !name) return false;
  if (asset.clips instanceof Map && asset.clips.has(name)) return true;
  return !!asset.meta?.clipFrames?.[name];
}

/**
 * 从剪辑名尾部剥离已知方向形态后缀，还原动作主键。
 * 'walk_SE' → 'walk'；'sit_down' → 'sit'（调用方需先精确命中再剥离，见 resolveDiscreteClip）。
 * @param {string} name
 * @returns {string}
 */
export function stripFormSuffix(name) {
  const value = String(name || '');
  for (const form of FORM_SUFFIXES) {
    if (value.endsWith(`_${form}`)) return value.slice(0, -(form.length + 1));
  }
  return value;
}

/**
 * 动作×方向 → 剪辑名（统一回退链，骨骼/整帧双实现共用）。
 * @param {Object|null} asset - parseSkeletonAsset 产物
 * @param {string} action - 动作主键（walk / idle / attack / death …）
 * @param {string} direction - 原始朝向（8 朝向字符串；内部归一化为形态键）
 * @returns {{clip: string, dirKey: string}|null} dirKey 为实际命中的形态键
 *          （调用方做头部槽位/LPC dirs/镜像等次级处理）；无可用剪辑返回 null
 */
export function resolveActionClip(asset, action, direction) {
  if (!asset || !action) return null;
  const dirKey = resolveDirectionKey(direction);
  // ① 精确形态（多方向动作）
  const exact = `${action}_${dirKey}`;
  if (hasClip(asset, exact)) return { clip: exact, dirKey };
  // ② 斜向回退（SE→down / SW→down / NE→up / NW→up；正/背/侧形态无此级）
  const fallbackForm = SKELETON_DIAGONAL_FALLBACK[dirKey];
  if (fallbackForm && fallbackForm !== dirKey) {
    const fallbackClip = `${action}_${fallbackForm}`;
    if (hasClip(asset, fallbackClip)) return { clip: fallbackClip, dirKey };
  }
  // ③ 单方向动作
  if (hasClip(asset, action)) return { clip: action, dirKey };
  return null;
}

/**
 * 离散动作请求名解析（外部 playAnimation('attack') 进入映射器保持态时调用）。
 *   - 裸动作名（attack）：优先升级为当前朝向的方向变体（attack_side），
 *     无变体回退裸名；裸名也没有 → null。
 *   - 带形态后缀名（attack_side）：精确命中优先；缺失时按裸动作重走回退链（降级裸版）。
 * @param {Object|null} asset
 * @param {string} requestedName - 外部请求的剪辑名
 * @param {string} direction - 原始朝向
 * @returns {{clip: string, base: string}|null} base 为剥离方向后的动作主键
 */
export function resolveDiscreteClip(asset, requestedName, direction) {
  if (!asset || !requestedName) return null;
  const base = stripFormSuffix(requestedName);
  if (base === requestedName) {
    // 裸动作名：方向变体优先（动作多方向时按朝向择优），无变体回退裸名
    const resolved = resolveActionClip(asset, base, direction);
    return resolved ? { clip: resolved.clip, base } : null;
  }
  // 带形态后缀名：精确命中优先（外部点名某方向就播某方向）
  if (hasClip(asset, requestedName)) return { clip: requestedName, base };
  // 缺失：按裸动作重走回退链（attack_side 缺失但 attack 存在 → 降级裸版）
  const resolved = resolveActionClip(asset, base, direction);
  return resolved ? { clip: resolved.clip, base } : null;
}

export default {
  hasClip,
  stripFormSuffix,
  resolveActionClip,
  resolveDiscreteClip
};

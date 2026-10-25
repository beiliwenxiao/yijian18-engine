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
 * PlayerLpcFrameMapper —— 整帧角色模式的状态映射器（LPC 素材）。
 *
 * ## 与部件骨骼模式的区别
 *   部件模式（PlayerSkeletonStateMapper）：按状态切「骨骼剪辑」，各槽位挂部件图。
 *   整帧模式（本文件）：角色是一整张 64×64 像素帧，按状态切「帧矩形列表 + 帧率」，
 *   写进 slot 覆盖层（setSlotOverride 的 frames/fps），SkeletonComponent 自动循环推进帧游标。
 *
 * ## 事实源：meta.clipFrames
 *   资产内 meta.clipFrames[clipName] = { fps, action, dirs: {down,left,up,right} → frames }
 *   —— 剪辑名是唯一事实源，引擎 mapper 与编辑器预览读同一份表：
 *     - 连续状态：按朝向选剪辑名（idle_down / walk_side / walk_SE …）
 *     - 离散剪辑：外部 playClip('attack') 之类，直接用该剪辑的帧表
 *
 * ## 方向
 *   LPC 只有 4 方向（up / left / down / right），左右是**独立手绘帧**（不是镜像），
 *   因此整帧模式不使用 sprite.flipX 表达朝向：
 *     down→down、left→left、right→right、up→up、
 *     斜前（SE/SW）→down、斜后（NE/NW）→up（引擎斜向回退语义一致）。
 */

import { resolveDirectionKey } from './SkeletonDirection.js';

/** 引擎朝向 → LPC 4 方向。 */
const DIRECTION_MAP = {
  down: 'down',
  side: 'right',
  up: 'up',
  SE: 'down',
  SW: 'down',
  NE: 'up',
  NW: 'up'
};

/** 连续状态 → 剪辑名（与旧部件 mapper 的命名约定一致）。 */
const IDLE_CLIPS = {
  down: 'idle_down', side: 'idle_side', up: 'idle_up',
  SE: 'idle_SE', SW: 'idle_SW', NE: 'idle_NE', NW: 'idle_NW'
};
const WALK_CLIPS = {
  down: 'walk_down', side: 'walk_side', up: 'walk_up',
  SE: 'walk_SE', SW: 'walk_SW', NE: 'walk_NE', NW: 'walk_NW'
};

/** 离散剪辑（非连续状态）→ 连续状态不再干预的剪辑名白名单（其余剪辑视为离散动作）。 */
const CONTINUOUS_CLIPS = new Set([
  ...Object.values(IDLE_CLIPS),
  ...Object.values(WALK_CLIPS)
]);

/**
 * 创建整帧模式的状态映射器。
 * @param {Object} entity 实体（读 sprite/状态）
 * @returns {(skeletonComponent: Object) => void} stateHook
 */
export function createPlayerLpcFrameMapper(entity) {
  let lastKey = '';

  return (skeletonComponent) => {
    const asset = skeletonComponent?.skeletonAsset;
    const clipFrames = asset?.meta?.clipFrames;
    if (!clipFrames) return;
    const sprite = entity?.getComponent?.('sprite');
    if (!sprite) return;

    // 动作：离散剪辑优先（外部 playClip 触发），否则按连续状态选待机/行走剪辑
    const key = resolveDirectionKey(sprite.direction || 'down');
    let clip = skeletonComponent.currentClip;
    if (!clip || CONTINUOUS_CLIPS.has(clip)) {
      const walking = sprite.isWalking === true && sprite.isStopping !== true;
      clip = walking ? (WALK_CLIPS[key] || 'walk_down') : (IDLE_CLIPS[key] || 'idle_down');
      if (clip !== skeletonComponent.currentClip) skeletonComponent.playClip?.(clip);
    }

    const entry = clipFrames[clip];
    if (!entry) return;
    // 方向：side 需按实际朝向选 left/right（左右是独立手绘帧，不做镜像）；
    // 8 向素材优先用自身的斜向帧表（SE/SW/NE/NW），缺斜向帧时回退到 4 向映射。
    const dirKey = key === 'side'
      ? (String(sprite.direction || 'down') === 'left' ? 'left' : 'right')
      : key;
    const frames = entry.dirs?.[dirKey] || entry.dirs?.[DIRECTION_MAP[key]];
    if (!Array.isArray(frames) || frames.length === 0) return;

    const signature = `${clip}|${dirKey}`;
    if (signature === lastKey) return;

    lastKey = signature;
    skeletonComponent.setSlotOverride?.('frame', { frames, fps: entry.fps });
    // 整帧模式的左右由 LPC 帧本身表达，不再使用整体镜像
    if (sprite.flipX !== false) sprite.flipX = false;
  };
}

export default createPlayerLpcFrameMapper;

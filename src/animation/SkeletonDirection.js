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
 * SkeletonDirection.js - 角色方向形态的共享定义
 *
 * 角色外观按 **7 个形态** 组织（左右两侧靠整体镜像复用同一套图）：
 *   down 正面基准 / side 侧面 / up 背面
 *   SE 斜前右 / SW 斜前左 / NE 斜后右 / NW 斜后左
 *
 * 实体朝向（8 方向字符串）→ 形态键的映射、斜向形态回退、头部三态槽位可见性
 * 都定义在这里，运行时状态映射器与编辑器预览共用同一份（避免两处漂移）。
 */

/** 形态键（7 形态，顺序即编辑器方向按钮顺序）。 */
export const SKELETON_DIRECTION_KEYS = Object.freeze(['down', 'side', 'up', 'SE', 'SW', 'NE', 'NW']);

/** 形态键 → 中文显示名。 */
export const SKELETON_DIRECTION_LABELS = Object.freeze({
  down: '正面（基准）',
  side: '侧面',
  up: '背面',
  SE: '斜前右',
  SW: '斜前左',
  NE: '斜后右',
  NW: '斜后左'
});

/**
 * 形态键 → 头部/发型三态槽位可见性。
 * 斜前形态用正脸头，斜后形态用后脑头（斜向不做独立头部美术时可直接用）。
 */
export const SKELETON_HEAD_SLOT_PLAN = Object.freeze({
  down: { headFront: true, headSide: false, headBack: false, hairFront: true, hairSide: false, hairBack: false },
  side: { headFront: false, headSide: true, headBack: false, hairFront: false, hairSide: true, hairBack: false },
  up: { headFront: false, headSide: false, headBack: true, hairFront: false, hairSide: false, hairBack: true },
  SE: { headFront: true, headSide: false, headBack: false, hairFront: true, hairSide: false, hairBack: false },
  SW: { headFront: true, headSide: false, headBack: false, hairFront: true, hairSide: false, hairBack: false },
  NE: { headFront: false, headSide: false, headBack: true, hairFront: false, hairSide: false, hairBack: true },
  NW: { headFront: false, headSide: false, headBack: true, hairFront: false, hairSide: false, hairBack: true }
});

/** 斜向形态缺失时的回退形态（斜前→正面、斜后→背面）。 */
export const SKELETON_DIAGONAL_FALLBACK = Object.freeze({ SE: 'down', SW: 'down', NE: 'up', NW: 'up' });

/**
 * 实体朝向（8 方向字符串）→ 形态键。
 * left/right → side（左右由实体 flipX 镜像）；斜向 → SE/SW/NE/NW。
 * @param {string} direction - 朝向字符串
 * @returns {string} 形态键
 */
export function resolveDirectionKey(direction) {
  const value = String(direction || 'down');
  if (value === 'up') return 'up';
  if (value === 'left' || value === 'right') return 'side';
  if (value === 'down-right') return 'SE';
  if (value === 'down-left') return 'SW';
  if (value === 'up-right') return 'NE';
  if (value === 'up-left') return 'NW';
  return 'down';
}

/**
 * 该朝向是否需要整体水平镜像（左系朝向：左/斜左下/斜左上）。
 * @param {string} direction - 朝向字符串
 * @returns {boolean}
 */
export function isMirroredFacing(direction) {
  return direction === 'left' || direction === 'down-left' || direction === 'up-left';
}

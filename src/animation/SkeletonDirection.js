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

/**
 * 形态键（8 形态，顺序即编辑器方向按钮顺序）。
 * sideL = 左侧面：给「左右两侧各有独立美术」的资产用（如一手刀一手盾，镜像会左右手互换）。
 * 老资产不配 sideL 时回退到 side + 实体 flipX，行为不变。
 */
export const SKELETON_DIRECTION_KEYS = Object.freeze(['down', 'side', 'up', 'SE', 'SW', 'NE', 'NW', 'sideL']);

/** 形态键 → 中文显示名（斜向带方向箭头，编辑器标识直观）。 */
export const SKELETON_DIRECTION_LABELS = Object.freeze({
  down: '正面（基准）',
  side: '侧面',
  up: '背面',
  SE: '↘ 斜前右',
  SW: '↙ 斜前左',
  NE: '↗ 斜后右',
  NW: '↖ 斜后左',
  sideL: '左侧面（免镜像）'
});

/**
 * 斜向形态键 → 方向箭头（直观显示标识）。
 * SE=斜前右↘ / SW=斜前左↙ / NE=斜后右↗ / NW=斜后左↖；
 * 正面/侧面/背面无箭头（调用方回退原键名）。
 */
export const SKELETON_DIRECTION_ARROWS = Object.freeze({ SE: '↘', SW: '↙', NE: '↗', NW: '↖' });

/**
 * 形态键 → 头部/发型三态槽位可见性。
 * 斜前形态用正脸头，斜后形态用后脑头（斜向不做独立头部美术时可直接用）。
 */
export const SKELETON_HEAD_SLOT_PLAN = Object.freeze({
  down: { headFront: true, headSide: false, headBack: false, hairFront: true, hairSide: false, hairBack: false },
  side: { headFront: false, headSide: true, headBack: false, hairFront: false, hairSide: true, hairBack: false },
  sideL: { headFront: false, headSide: true, headBack: false, hairFront: false, hairSide: true, hairBack: false },
  up: { headFront: false, headSide: false, headBack: true, hairFront: false, hairSide: false, hairBack: true },
  SE: { headFront: true, headSide: false, headBack: false, hairFront: true, hairSide: false, hairBack: false },
  SW: { headFront: true, headSide: false, headBack: false, hairFront: true, hairSide: false, hairBack: false },
  NE: { headFront: false, headSide: false, headBack: true, hairFront: false, hairSide: false, hairBack: true },
  NW: { headFront: false, headSide: false, headBack: true, hairFront: false, hairSide: false, hairBack: true }
});

/** 斜向形态缺失时的回退形态（斜前→正面、斜后→背面）。 */
export const SKELETON_DIAGONAL_FALLBACK = Object.freeze({ SE: 'down', SW: 'down', NE: 'up', NW: 'up' });

/**
 * 三态头/发槽位在指定形态下的可见性（资产感知）。
 * 基准语义 = SKELETON_HEAD_SLOT_PLAN 按形态显隐；资产缺形态专用槽时回退保留正面槽——
 * 「单头槽 + directionOffsets」结构（如 skirt-girl / skirt-girl-chibi：只有 headFront 一槽，
 * 侧面/背面靠形态图）在 side/up 形态下不再把唯一的头槽隐藏掉。
 * @param {string} formKey - 形态键（down/side/up/SE/SW/NE/NW/sideL）
 * @param {string} slotId - 三态槽位 id（head/hair × Front/Side/Back）
 * @param {(base: 'head'|'hair', form: 'Front'|'Side'|'Back') => boolean} hasSlot - 资产槽位存在性查询
 * @returns {boolean|null} 是否可见；非三态槽位返回 null（调用方不干涉）
 */
export function resolveHeadSlotVisibility(formKey, slotId, hasSlot) {
  const plan = SKELETON_HEAD_SLOT_PLAN[formKey];
  if (!plan || !(slotId in plan)) return null;
  let visible = plan[slotId];
  if (!visible && (slotId === 'headFront' || slotId === 'hairFront')) {
    const base = slotId === 'headFront' ? 'head' : 'hair';
    // 形态计划隐藏正面槽的两种情形：side/sideL 要 Side 槽、up/NE/NW 要 Back 槽——槽缺失则回退
    const wantsSide = formKey === 'side' || formKey === 'sideL';
    if (!hasSlot(base, wantsSide ? 'Side' : 'Back')) visible = true;
  }
  return visible;
}

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

/**
 * 实体朝向 → 附件形态键（用于 directionOffsets 取图/偏移）。
 * 与 resolveDirectionKey 的唯一区别：left 返回独立的 sideL（便于配置左侧专用美术，彻底免镜像）。
 * 资产未配 sideL 时由调用方逐字段回退到 side（见 SkeletonAsset.resolveAttachmentOffset 的调用约定）。
 * @param {string} direction
 * @returns {string}
 */
export function resolveAttachmentFormKey(direction) {
  if (String(direction || '') === 'left') return 'sideL';
  return resolveDirectionKey(direction);
}

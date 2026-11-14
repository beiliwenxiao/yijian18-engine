/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * CharacterGlow.js
 * 角色自身光晕半径 + 近战射程推导的唯一权威实现。
 *
 * 「角色光晕多大」只在这里定义，两处消费：
 *   - SceneCampfireService：夜间透光洞（角色脚下柔光圆的绘制半径）
 *   - MeleeAttackSystem：近战默认攻击范围 = 光晕半径 + 额外余量
 * 命中判定、刀光、战斗扇形显示都经由 MeleeAttackSystem.getAttackDistance 取同一个值，
 * 不再各自维护一份魔法数，避免「画的光晕 / 画的扇形 / 实际打到」三者漂移。
 */

/** 角色自身光晕基础半径（世界 px，与夜间透光洞同值）。 */
export const CHARACTER_GLOW_RADIUS = 150;

/** 近战范围在角色光晕之外的额外余量（px）。 */
export const MELEE_RANGE_GLOW_MARGIN = 10;

/**
 * 解析角色自身光晕半径。
 * 当前光晕是角色的固定视觉属性，不随体型/缩放变化；将来若改为按体型推导，
 * 只需修改本函数，近战范围（resolveMeleeRangeFromGlow）会自动跟随。
 * @returns {number} 光晕半径（世界 px）
 */
export function resolveCharacterGlowRadius() {
  return CHARACTER_GLOW_RADIUS;
}

/**
 * 近战默认攻击范围 = 角色光晕半径 + 额外余量。
 * @param {number} [glowRadius] - 光晕半径；缺省取 resolveCharacterGlowRadius()
 * @returns {number} 近战攻击距离（世界 px）
 */
export function resolveMeleeRangeFromGlow(glowRadius = resolveCharacterGlowRadius()) {
  const radius = Number(glowRadius);
  return (Number.isFinite(radius) && radius > 0 ? radius : CHARACTER_GLOW_RADIUS)
    + MELEE_RANGE_GLOW_MARGIN;
}

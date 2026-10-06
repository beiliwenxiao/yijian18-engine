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
 * SkillIconResolver - 技能图标统一解析（技能栏/技能轮盘共用）
 *
 * 解析优先级：
 *   1. skill.icon（skills.json 配置的 Manifest 稳定图片 ID）→ 运行时图片
 *   2. HudIconPainter 矢量图标（按技能 id / effectType 映射）
 *   3. 返回 false，调用方回退自有兜底（代码图标/emoji）
 *
 * 美术出技能图标图后：登记 Manifest + skills.json 填 icon 字段即全端生效。
 */

import { HudIconPainter } from './HudIconPainter.js';

const ID_TO_PAINTER = Object.freeze({
  flame_palm: 'flame',
  inferno_palm: 'flame',
  fireball: 'flame',
  flame_burst: 'flame',
  ice_finger: 'frost',
  ice_lance: 'frost',
  heal: 'heal',
  talisman_water: 'heal',
  meditation: 'meditation',
  cleave: 'attack',
  basic_attack: 'attack',
  warrior_slash: 'attack',
  arrow_shot: 'arrow',
  power_jump: 'jump',
  jump: 'jump',
  flight: 'flight',
  gathering_puppet: 'gather',
  climb: 'interact'
});

/** 按技能解析矢量图标键（icon 字段是图片 ID，不走 painter）。 */
export function resolveSkillPainterKey(skill) {
  if (!skill) return '';
  if (HudIconPainter.has(skill.id)) return skill.id;
  const byId = ID_TO_PAINTER[skill.id];
  if (byId) return byId;
  const byEffect = ID_TO_PAINTER[skill.effectType];
  if (byEffect) return byEffect;
  return ID_TO_PAINTER[skill.category] || '';
}

/** 从 AssetManager 取技能 icon 的 manifest 图片（未就绪返回 null）。 */
function getSkillIconImage(skill, getAssetManager) {
  const stableId = skill?.icon || skill?.imageId || skill?.assetId;
  if (!stableId) return null;
  const manager = getAssetManager?.();
  if (!manager) return null;
  const key = manager.resolveManifestAsset?.(stableId, '2d')?.key || stableId;
  const image = manager.getAsset?.(key);
  return image && image.naturalWidth > 0 ? image : null;
}

/**
 * 在 (cx, cy) 绘制技能图标（size 盒内等比居中）。
 * @returns {boolean} 是否绘制成功（false = 调用方回退兜底）
 */
export function drawSkillIcon(ctx, skill, cx, cy, size, getAssetManager = null) {
  const image = getSkillIconImage(skill, getAssetManager);
  if (image) {
    const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * ratio;
    const height = image.naturalHeight * ratio;
    ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height);
    return true;
  }
  const painterKey = resolveSkillPainterKey(skill);
  if (painterKey && HudIconPainter.draw(ctx, painterKey, cx, cy, size)) return true;
  return false;
}

export default { resolveSkillPainterKey, drawSkillIcon };

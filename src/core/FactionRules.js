/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * FactionRules.js
 * 阵营敌我规则 - 全引擎统一的敌对判定单一来源。
 *
 * 消费方：
 * - AISystem（索敌/敌对缓存）
 * - CombatSystem（AOE/直线/烈焰掌伤害与治疗过滤，替代历史硬编码 e.type !== 'enemy'）
 * - EnemySkillDirector（敌人编排技能的目标有效性）
 *
 * 规则要点：
 * - canonical 战役单位（battleParticipant 标签）按 factionId 判敌我；
 * - 普通单位按 legacy faction/type 规则；
 * - 友方阵营（faction 'friendly'，如 S09 粮仓哨兵）不构成任何人的敌对目标，
 *   与近战锁定/军团结算的 e.faction !== 'friendly' 过滤保持一致，
 *   玩家 AOE 与敌方技能都不应误伤这类剧情守卫。
 */

const hasTag = (entity, tag) => Array.isArray(entity?.tags) && entity.tags.includes(tag);

/** canonical 战役单位只攻击其他参战阵营；普通敌人继续使用 legacy faction/type 规则。 */
export function isHostileTarget(entity, candidate) {
  if (candidate === entity || candidate?.isDead || candidate?.isDying || candidate?.isSoulState) return false;
  // 剧情倒地（如 S02 救援昏倒）：敌人不再索敌，避免剧情演出被击杀流程打断。
  if (candidate?.plotDowned) return false;
  // 友方阵营守卫（faction friendly）：对任何施法者/攻击者都非敌对。
  if (candidate?.faction === 'friendly') return false;
  if (hasTag(entity, 'battleParticipant')) {
    const candidateParticipates = hasTag(candidate, 'battleParticipant')
      || hasTag(candidate, 'battleIntervenor');
    return candidateParticipates
      && !!entity.factionId
      && !!candidate.factionId
      && entity.factionId !== candidate.factionId;
  }
  if (candidate?.faction === entity.faction) return false;
  if (entity.faction === 'enemy' && candidate?.type !== 'player' && candidate?.faction !== 'ally') return false;
  if (entity.faction === 'ally' && candidate?.type !== 'enemy') return false;
  return true;
}

export default { isHostileTarget };

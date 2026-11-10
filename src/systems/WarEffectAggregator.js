/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WarEffectAggregator.js —— 工事/建筑战争效果聚合（M5 · 5C）
 *
 * 从 S10ConstructionFlow._deriveS10ConstructionEffects 提为引擎纯函数：
 * 输入「已建结构 + 其 warEffects 定义 + 是否存活」，输出五项战争效果乘积。
 *
 * 与 S10 旧实现**逐条等价**（含"损毁后改用 destroyedDefenseMultiplier"）：
 *   - moraleBonus                      求和
 *   - hungerDrainMultiplier            存活结构连乘
 *   - enemyAdvanceSpeedMultiplier      存活结构连乘
 *   - friendlyCasualtyMultiplier       存活结构连乘
 *   - friendlyDefenseMultiplier        存活结构连乘；损毁结构改乘 destroyedDefenseMultiplier
 */

export const WAR_EFFECT_DEFAULTS = Object.freeze({
  moraleBonus: 0,
  hungerDrainMultiplier: 1,
  enemyAdvanceSpeedMultiplier: 1,
  friendlyCasualtyMultiplier: 1,
  friendlyDefenseMultiplier: 1
});

const finite = value => (Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * @param {Array<{warEffects?:object, alive?:boolean}>} entries
 * @returns {{moraleBonus:number, hungerDrainMultiplier:number, enemyAdvanceSpeedMultiplier:number,
 *            friendlyCasualtyMultiplier:number, friendlyDefenseMultiplier:number}}
 */
export function aggregateWarEffects(entries = []) {
  const effects = { ...WAR_EFFECT_DEFAULTS };
  for (const entry of Array.isArray(entries) ? entries : []) {
    const configured = (entry && typeof entry === 'object' && entry.warEffects) || {};
    const alive = entry?.alive !== false;
    if (alive) {
      effects.moraleBonus += finite(configured.moraleBonus) || 0;
      const hunger = finite(configured.hungerDrainMultiplier);
      if (hunger !== null) effects.hungerDrainMultiplier *= hunger;
      const advance = finite(configured.enemyAdvanceSpeedMultiplier);
      if (advance !== null) effects.enemyAdvanceSpeedMultiplier *= advance;
      const casualty = finite(configured.friendlyCasualtyMultiplier);
      if (casualty !== null) effects.friendlyCasualtyMultiplier *= casualty;
      const defense = finite(configured.friendlyDefenseMultiplier);
      if (defense !== null) effects.friendlyDefenseMultiplier *= defense;
    } else {
      const destroyed = finite(configured.destroyedDefenseMultiplier);
      if (destroyed !== null) effects.friendlyDefenseMultiplier *= destroyed;
    }
  }
  return effects;
}

export default aggregateWarEffects;

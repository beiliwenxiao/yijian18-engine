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
 * HeroAuraResolver - 主将光环与入场位置（模块 6 · 6C/6D）
 *
 * 设计依据：06-battle-plan-intervene.md §3.7（主将一律下场、光环常驻）与模块 5 §3.3/§6.3。
 *
 * 语义：
 *   - 主将实体**在场即生效**（未阵亡、未撤离/逃亡），不论入场身份是接管/支援/旁观；
 *   - 主将位置由战前部署 `deployment.commanderSlot` 控制，缺省读武将 `deploySlot`，再缺省 mid；
 *   - 光环换算成 CombatModifierPipeline 的 `auras` 输入（attack/defense 乘算），
 *     多个光环按连乘叠加；主角死亡/离场由调用方传 `onField:false` 退化为 1.0。
 *
 * 纯函数，供 BattlefieldRuntimeSystem / 战场卡 / 编辑器共用，不读全局。
 */

export const HERO_DEPLOY_SLOTS = Object.freeze(['front', 'mid', 'rear']);

const AURA_MULTIPLIER_RANGE = Object.freeze({ min: 0.1, max: 10 });

function num(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

/** 主将下场位置：部署 > 武将自身 > mid。 */
export function resolveCommanderSlot({ hero = null, deployment = null } = {}) {
  const fromDeployment = deployment?.commanderSlot ?? deployment?.commander?.slot ?? null;
  if (HERO_DEPLOY_SLOTS.includes(fromDeployment)) return fromDeployment;
  const fromHero = hero?.deploySlot ?? null;
  if (HERO_DEPLOY_SLOTS.includes(fromHero)) return fromHero;
  return 'mid';
}

/**
 * 单个主将光环 → 修正乘区。
 * @param {Object} input
 * @param {Object|null} input.hero - 武将定义（aura: { radius, modifiers:{attack,defense} }）
 * @param {boolean} [input.onField] - 主将实体是否在场（默认 true）
 * @returns {{active:boolean, attack:number, defense:number, radius:number, heroId:string|null}}
 */
export function resolveHeroAura({ hero = null, onField = true } = {}) {
  const aura = hero?.aura;
  const heroId = hero?.id != null ? String(hero.id) : null;
  if (onField !== true || !aura || typeof aura !== 'object') {
    return { active: false, attack: 1, defense: 1, radius: 0, heroId };
  }
  const modifiers = aura.modifiers && typeof aura.modifiers === 'object' ? aura.modifiers : aura;
  const attack = clamp(num(modifiers.attack, 1), AURA_MULTIPLIER_RANGE.min, AURA_MULTIPLIER_RANGE.max);
  const defense = clamp(num(modifiers.defense, 1), AURA_MULTIPLIER_RANGE.min, AURA_MULTIPLIER_RANGE.max);
  const radius = Math.max(0, num(aura.radius, 0));
  return { active: true, attack, defense, radius, heroId };
}

/**
 * 多主将光环连乘，产出 CombatModifierPipeline 的 auras 输入。
 * @param {Array<{hero?:Object, onField?:boolean}>} entries
 */
export function aggregateHeroAuras(entries = []) {
  let attack = 1;
  let defense = 1;
  let radius = 0;
  const activeHeroes = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const aura = resolveHeroAura({ hero: entry?.hero, onField: entry?.onField !== false });
    if (!aura.active) continue;
    attack *= aura.attack;
    defense *= aura.defense;
    radius = Math.max(radius, aura.radius);
    if (aura.heroId) activeHeroes.push(aura.heroId);
  }
  return {
    attack: clamp(attack, AURA_MULTIPLIER_RANGE.min, AURA_MULTIPLIER_RANGE.max),
    defense: clamp(defense, AURA_MULTIPLIER_RANGE.min, AURA_MULTIPLIER_RANGE.max),
    radius,
    activeHeroes
  };
}

/**
 * 生成主将入场数据（供 BattlefieldRuntimeSystem 的 deployments / commanders 使用）。
 * 非战斗场景与旧战斗不传 commanders 时零变化。
 */
export function buildCommanderEntry({ hero = null, deployment = null, factionId = null, raidId = null, onField = true } = {}) {
  const slot = resolveCommanderSlot({ hero, deployment });
  const aura = resolveHeroAura({ hero, onField });
  return {
    factionId: factionId != null ? String(factionId) : null,
    raidId: raidId != null ? String(raidId) : null,
    heroId: hero?.id != null ? String(hero.id) : null,
    name: hero?.name != null ? String(hero.name) : null,
    slot,
    deploySlot: slot,
    aura,
    onField: onField === true
  };
}

export default {
  HERO_DEPLOY_SLOTS,
  resolveCommanderSlot,
  resolveHeroAura,
  aggregateHeroAuras,
  buildCommanderEntry
};

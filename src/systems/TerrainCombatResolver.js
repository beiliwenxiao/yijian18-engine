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
 * TerrainCombatResolver.js —— 地势战斗修正（M5 · 5C）
 *
 * 把编辑器 buffZone 里的 `terrainCombat` 区域解析成 CombatModifierPipeline 的 terrain 输入：
 *   { attack, defense, range, speed }
 *
 * 数据形状（library/scene 内 buffZone.effect）：
 *   {
 *     kind: 'terrainCombat',
 *     unitTypeFilter: ['unit.archer'],      // 可缺省 = 全部兵种
 *     side: 'attacker' | 'defender' | 'any',// 可缺省 = any
 *     modifiers: { attack: 0.9, defense: 1.15, archerRangeMultiplier: 1.2, moveSpeedMultiplier: 0.85 }
 *   }
 *
 * 语义：多层区域连乘；`range` 只对包含弓/远程关键词的兵种生效（高台弓兵射更远），
 * 其余兵种忽略 range —— 这样同一块高台对枪兵无害、对弓兵有利。
 */

export const TERRAIN_COMBAT_DEFAULTS = Object.freeze({ attack: 1, defense: 1, range: 1, speed: 1 });

const finite = value => (Number.isFinite(Number(value)) ? Number(value) : null);
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function isTerrainCombatEffect(effect) {
  return isObject(effect) && effect.kind === 'terrainCombat';
}

function matchesFilter(effect, context) {
  const filter = Array.isArray(effect.unitTypeFilter) ? effect.unitTypeFilter : null;
  if (filter && filter.length > 0) {
    const unitTypeId = context.unitTypeId;
    if (!unitTypeId || !filter.includes(unitTypeId)) return false;
  }
  const side = effect.side || 'any';
  if (side !== 'any' && context.side && side !== context.side) return false;
  return true;
}

function isRangedUnit(context) {
  if (context.ranged === true) return true;
  const unitTypeId = String(context.unitTypeId || '');
  return /archer|bow|弓/i.test(unitTypeId);
}

/**
 * @param {Array<{id?:string, effect?:object}>} zones 命中（点在多边形内）的 buffZone
 * @param {{unitTypeId?:string, side?:string, ranged?:boolean}} context
 * @returns {{attack:number, defense:number, range:number, speed:number, sources:string[]}}
 */
export function resolveTerrainCombatModifiers(zones = [], context = {}) {
  const result = { ...TERRAIN_COMBAT_DEFAULTS, sources: [] };
  const ranged = isRangedUnit(context);
  for (const zone of Array.isArray(zones) ? zones : []) {
    const effect = zone?.effect;
    if (!isTerrainCombatEffect(effect)) continue;
    if (!matchesFilter(effect, context)) continue;
    const modifiers = isObject(effect.modifiers) ? effect.modifiers : {};
    const attack = finite(modifiers.attackMultiplier ?? modifiers.attack);
    const defense = finite(modifiers.defenseMultiplier ?? modifiers.defense);
    const range = finite(modifiers.archerRangeMultiplier ?? modifiers.rangeMultiplier);
    const speed = finite(modifiers.moveSpeedMultiplier ?? modifiers.speed);
    if (attack !== null) result.attack *= attack;
    if (defense !== null) result.defense *= defense;
    if (range !== null && ranged) result.range *= range;
    if (speed !== null) result.speed *= speed;
    result.sources.push(zone?.id ? String(zone.id) : 'terrainCombat');
  }
  result.attack = Math.round(result.attack * 1e6) / 1e6;
  result.defense = Math.round(result.defense * 1e6) / 1e6;
  result.range = Math.round(result.range * 1e6) / 1e6;
  result.speed = Math.round(result.speed * 1e6) / 1e6;
  return result;
}

export default resolveTerrainCombatModifiers;

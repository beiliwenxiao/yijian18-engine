/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * CombatModifierPipeline.js
 * 战斗修正管线（M0 交付：只建、不接线）。
 *
 * 分三层合成，**顺序固定**：
 *   ① 兵种克制层 —— 查 attacker.dealMultiplier[defender.unitTypeId]，未列出即 1.0；
 *      等级压制在此层内做"向 1.0 收缩"（不新增乘数层，避免层数膨胀）。
 *   ② 阵法层 —— formation.modifiers.attack / defense（只给加成，不含克制）。
 *   ③ 地形/光环层 —— terrain / auras 的 attack / defense。
 *
 * 输出两个乘法系数（攻方乘伤 / 守方乘防），交战公式仍是
 * `伤害 = 基础 × attackMultiplier / defenseMultiplier`，**不改变任何既有结算顺序**。
 *
 * M0 阶段没有任何调用点（CombatSystem 零改动）；M5 接线时逐点替换。
 */

/** 默认钳制与等级压制参数（以 project 根 combatModifiers 覆盖）。 */
export const DEFAULT_COMBAT_MODIFIER_CONFIG = Object.freeze({
  clamp: Object.freeze({
    /** 单层倍率区间：防"某一层数据写错"导致整体失真 */
    layer: Object.freeze([0.6, 1.6]),
    /** 总倍率区间：三层连乘后的最终兜底 */
    total: Object.freeze([0.4, 2.2])
  }),
  levelDecay: Object.freeze({
    /** 攻方等级落后守方 ≥ 该值才触发压制惩罚 */
    triggerGap: 2,
    /** 强克制档（≥ min）统一压到 value */
    strong: Object.freeze({ min: 1.25, value: 1.15 }),
    /** 劣势档（≤ max）统一抬到 value（被压制时"劣势没那么亏"） */
    weak: Object.freeze({ max: 0.85, value: 0.85 }),
    /** 其余倍率按同比例向 1.0 收缩（0.5 = 收一半） */
    shrinkToNeutral: 0.5
  })
});

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : 1);
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));

function resolveConfig(overrides) {
  if (!isObject(overrides)) return DEFAULT_COMBAT_MODIFIER_CONFIG;
  return {
    clamp: {
      layer: overrides.clamp?.layer || DEFAULT_COMBAT_MODIFIER_CONFIG.clamp.layer,
      total: overrides.clamp?.total || DEFAULT_COMBAT_MODIFIER_CONFIG.clamp.total
    },
    levelDecay: {
      triggerGap: overrides.levelDecay?.triggerGap ?? DEFAULT_COMBAT_MODIFIER_CONFIG.levelDecay.triggerGap,
      strong: overrides.levelDecay?.strong || DEFAULT_COMBAT_MODIFIER_CONFIG.levelDecay.strong,
      weak: overrides.levelDecay?.weak || DEFAULT_COMBAT_MODIFIER_CONFIG.levelDecay.weak,
      shrinkToNeutral: overrides.levelDecay?.shrinkToNeutral ?? DEFAULT_COMBAT_MODIFIER_CONFIG.levelDecay.shrinkToNeutral
    }
  };
}

/** 等级压制：把克制倍率向 1.0 收缩（强档/劣势档走硬档位，其余按比例）。 */
export function applyLevelDecay(multiplier, attackerLevel, defenderLevel, config = DEFAULT_COMBAT_MODIFIER_CONFIG) {
  const decay = config.levelDecay;
  if (!Number.isFinite(attackerLevel) || !Number.isFinite(defenderLevel)) return multiplier;
  if (attackerLevel > defenderLevel - decay.triggerGap) return multiplier;
  if (multiplier >= decay.strong.min) return decay.strong.value;
  if (multiplier <= decay.weak.max) return decay.weak.value;
  return 1 + (multiplier - 1) * decay.shrinkToNeutral;
}

/** 从 unitTypes 模板取克制表（M5 传 unitType 对象即可；M0 允许直接传表）。 */
function counterTable(source) {
  if (!isObject(source)) return null;
  if (isObject(source.dealMultiplier)) return source.dealMultiplier;
  if (isObject(source.unitType?.dealMultiplier)) return source.unitType.dealMultiplier;
  return null;
}

/**
 * 解析一次交战的修正系数。
 *
 * @param {object} input
 * @param {{unitTypeId?:string, level?:number, dealMultiplier?:object, unitType?:object}} [input.attacker]
 * @param {{unitTypeId?:string, level?:number, damageTakenFrom?:object}} [input.defender]
 * @param {{attack?:number, defense?:number}} [input.formation] 攻方阵法 modifiers
 * @param {{attack?:number, defense?:number}} [input.defenderFormation] 守方阵法 modifiers
 * @param {{attack?:number, defense?:number}} [input.terrain]
 * @param {{attack?:number, defense?:number}} [input.auras]
 * @param {object} [input.config] project 根 combatModifiers（可选覆盖）
 * @returns {{attackMultiplier:number, defenseMultiplier:number, clamped:boolean, breakdown:object}}
 */
export function resolveCombatModifier(input = {}) {
  const config = resolveConfig(input.config);
  const layerClamp = bounds => value => clamp(value, bounds);
  const clampLayer = layerClamp(config.clamp.layer);

  const attacker = isObject(input.attacker) ? input.attacker : {};
  const defender = isObject(input.defender) ? input.defender : {};

  const table = counterTable(attacker);
  const counterRaw = table && defender.unitTypeId ? num(table[defender.unitTypeId]) : 1;
  const counterDecayed = applyLevelDecay(counterRaw, attacker.level, defender.level, config);
  const counter = clampLayer(counterDecayed);

  const formation = clampLayer(num(input.formation?.attack));
  const terrain = clampLayer(num(input.terrain?.attack));
  const aura = clampLayer(num(input.auras?.attack));

  const defenseTaken = clampLayer(
    isObject(defender.damageTakenFrom) && attacker.unitTypeId
      ? num(defender.damageTakenFrom[attacker.unitTypeId])
      : 1
  );
  const defenseFormation = clampLayer(num(input.defenderFormation?.defense));
  const defenseTerrain = clampLayer(num(input.terrain?.defense));
  const defenseAura = clampLayer(num(input.auras?.defense));

  const attackRaw = counter * formation * terrain * aura;
  const defenseRaw = defenseTaken * defenseFormation * defenseTerrain * defenseAura;

  const attackMultiplier = clamp(round6(attackRaw), config.clamp.total);
  const defenseMultiplier = clamp(round6(defenseRaw), config.clamp.total);

  return {
    attackMultiplier,
    defenseMultiplier,
    clamped: attackMultiplier !== round6(attackRaw) || defenseMultiplier !== round6(defenseRaw),
    breakdown: {
      counter: { base: counterRaw, afterLevelDecay: counterDecayed, value: counter },
      formation,
      terrain,
      aura,
      defense: {
        damageTakenFrom: defenseTaken,
        formation: defenseFormation,
        terrain: defenseTerrain,
        aura: defenseAura
      },
      raw: { attack: round6(attackRaw), defense: round6(defenseRaw) },
      clamps: { layer: [...config.clamp.layer], total: [...config.clamp.total] }
    }
  };
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

export default resolveCombatModifier;

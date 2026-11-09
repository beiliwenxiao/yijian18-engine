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

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMBAT_MODIFIER_CONFIG,
  applyLevelDecay,
  resolveCombatModifier
} from './CombatModifierPipeline.js';

const spear = {
  unitTypeId: 'unit.spear',
  dealMultiplier: { 'unit.shield': 1.15, 'unit.heavy': 0.85, 'unit.light_cav': 1.3 }
};

describe('CombatModifierPipeline', () => {
  it('恒等：任何输入缺失都返回 1.0 / 1.0', () => {
    const result = resolveCombatModifier();
    expect(result.attackMultiplier).toBe(1);
    expect(result.defenseMultiplier).toBe(1);
    expect(result.clamped).toBe(false);
    expect(result.breakdown.counter.base).toBe(1);
    expect(result.breakdown.formation).toBe(1);
  });

  it('克制层：只查一次表，未列出的组合恒为 1.0', () => {
    expect(resolveCombatModifier({ attacker: spear, defender: { unitTypeId: 'unit.shield' } }).attackMultiplier)
      .toBeCloseTo(1.15, 6);
    expect(resolveCombatModifier({ attacker: spear, defender: { unitTypeId: 'unit.archer' } }).attackMultiplier)
      .toBe(1);
    // 从 unitTypes 模板对象取表也成立（M5 的传法）
    const viaTemplate = resolveCombatModifier({
      attacker: { unitTypeId: 'unit.spear', unitType: { dealMultiplier: { 'unit.shield': 1.15 } } },
      defender: { unitTypeId: 'unit.shield' }
    });
    expect(viaTemplate.attackMultiplier).toBeCloseTo(1.15, 6);
  });

  it('阵法/地形/光环逐层连乘', () => {
    const result = resolveCombatModifier({
      attacker: { unitTypeId: 'unit.spear', dealMultiplier: { 'unit.shield': 1.15 } },
      defender: { unitTypeId: 'unit.shield' },
      formation: { attack: 1.1 },
      terrain: { attack: 1.2 },
      auras: { attack: 1.05 }
    });
    expect(result.attackMultiplier).toBeCloseTo(1.15 * 1.1 * 1.2 * 1.05, 6);
    expect(result.breakdown.formation).toBe(1.1);
    expect(result.breakdown.terrain).toBe(1.2);
    expect(result.breakdown.aura).toBe(1.05);
  });

  it('守方系数来自守方阵法/地形/受击覆盖', () => {
    const result = resolveCombatModifier({
      attacker: { unitTypeId: 'unit.archer' },
      defender: { unitTypeId: 'unit.heavy', damageTakenFrom: { 'unit.archer': 0.9 } },
      defenderFormation: { defense: 1.2 },
      terrain: { defense: 1.1 }
    });
    expect(result.defenseMultiplier).toBeCloseTo(0.9 * 1.2 * 1.1, 6);
    expect(result.breakdown.defense.damageTakenFrom).toBe(0.9);
  });

  it('等级衰减：落后 ≥2 级才触发，强档/劣势档走硬档位，其余向 1.0 收一半', () => {
    const { triggerGap } = DEFAULT_COMBAT_MODIFIER_CONFIG.levelDecay;
    expect(triggerGap).toBe(2);
    // 落后 1 级不触发
    expect(applyLevelDecay(1.3, 4, 5)).toBe(1.3);
    // 落后 ≥2 级
    expect(applyLevelDecay(1.3, 1, 5)).toBe(1.15);
    expect(applyLevelDecay(1.4, 1, 5)).toBe(1.15);
    expect(applyLevelDecay(0.8, 1, 5)).toBe(0.85);
    expect(applyLevelDecay(1.1, 1, 5)).toBeCloseTo(1.05, 6);
    expect(applyLevelDecay(1.2, 1, 5)).toBeCloseTo(1.1, 6);
    // 无等级数据不衰减
    expect(applyLevelDecay(1.3, undefined, 5)).toBe(1.3);
  });

  it('等级衰减在克制层内生效，不新增乘数层', () => {
    const result = resolveCombatModifier({
      attacker: { ...spear, level: 1 },
      defender: { unitTypeId: 'unit.light_cav', level: 6 },
      formation: { attack: 1.1 }
    });
    expect(result.breakdown.counter.base).toBe(1.3);
    expect(result.breakdown.counter.afterLevelDecay).toBe(1.15);
    expect(result.attackMultiplier).toBeCloseTo(1.15 * 1.1, 6);
  });

  it('单层 clamp [0.6,1.6]，总量 clamp [0.4,2.2]', () => {
    const single = resolveCombatModifier({ terrain: { attack: 3 } });
    expect(single.breakdown.terrain).toBe(1.6);
    expect(single.attackMultiplier).toBe(1.6);

    const total = resolveCombatModifier({
      attacker: { unitTypeId: 'unit.spear', dealMultiplier: { 'unit.shield': 1.6 } },
      defender: { unitTypeId: 'unit.shield' },
      formation: { attack: 1.6 },
      terrain: { attack: 1.6 }
    });
    expect(total.attackMultiplier).toBe(2.2);
    expect(total.clamped).toBe(true);
    expect(total.breakdown.raw.attack).toBeCloseTo(4.096, 6);

    const low = resolveCombatModifier({ terrain: { attack: 0.1 } });
    expect(low.breakdown.terrain).toBe(0.6);
  });

  it('project 根 combatModifiers 可覆盖钳制区间', () => {
    const result = resolveCombatModifier({
      terrain: { attack: 3 },
      config: { clamp: { layer: [0.5, 2], total: [0.4, 3] } }
    });
    expect(result.breakdown.terrain).toBe(2);
    expect(result.attackMultiplier).toBe(2);
  });

  it('输出结构稳定（breakdown 含四层与钳制区间）', () => {
    const result = resolveCombatModifier({ attacker: spear, defender: { unitTypeId: 'unit.heavy' } });
    expect(Object.keys(result).sort()).toEqual(['attackMultiplier', 'breakdown', 'clamped', 'defenseMultiplier']);
    expect(result.breakdown.clamps.layer).toEqual([0.6, 1.6]);
    expect(result.breakdown.clamps.total).toEqual([0.4, 2.2]);
    // 纯函数：不改入参
    expect(spear.dealMultiplier['unit.heavy']).toBe(0.85);
  });
});

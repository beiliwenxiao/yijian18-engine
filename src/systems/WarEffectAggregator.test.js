import { describe, it, expect } from 'vitest';
import { aggregateWarEffects, WAR_EFFECT_DEFAULTS } from './WarEffectAggregator.js';

describe('WarEffectAggregator', () => {
  it('空输入返回中性默认值', () => {
    expect(aggregateWarEffects()).toEqual(WAR_EFFECT_DEFAULTS);
    expect(aggregateWarEffects([])).toEqual(WAR_EFFECT_DEFAULTS);
  });

  it('存活结构：士气求和、其余连乘', () => {
    const effects = aggregateWarEffects([
      { alive: true, warEffects: { moraleBonus: 5, hungerDrainMultiplier: 0.8, friendlyDefenseMultiplier: 1.2 } },
      { alive: true, warEffects: { moraleBonus: 3, enemyAdvanceSpeedMultiplier: 0.5, friendlyDefenseMultiplier: 1.1 } }
    ]);
    expect(effects.moraleBonus).toBe(8);
    expect(effects.hungerDrainMultiplier).toBeCloseTo(0.8);
    expect(effects.enemyAdvanceSpeedMultiplier).toBeCloseTo(0.5);
    expect(effects.friendlyDefenseMultiplier).toBeCloseTo(1.32);
  });

  it('损毁结构只乘 destroyedDefenseMultiplier，不计士气与其它项', () => {
    const effects = aggregateWarEffects([
      { alive: false, warEffects: { moraleBonus: 9, hungerDrainMultiplier: 0.1, friendlyDefenseMultiplier: 2, destroyedDefenseMultiplier: 0.7 } }
    ]);
    expect(effects.moraleBonus).toBe(0);
    expect(effects.hungerDrainMultiplier).toBe(1);
    expect(effects.friendlyDefenseMultiplier).toBeCloseTo(0.7);
  });

  it('缺失/非法数值被忽略（与旧实现 Number 兜底一致）', () => {
    const effects = aggregateWarEffects([
      { alive: true, warEffects: { moraleBonus: 'abc', friendlyCasualtyMultiplier: 'abc' } },
      { alive: true },
      { warEffects: undefined }
    ]);
    expect(effects).toEqual(WAR_EFFECT_DEFAULTS);
  });

  it('null 数值按旧实现 Number(null)=0 处理（保持逐条等价）', () => {
    const effects = aggregateWarEffects([{ alive: true, warEffects: { friendlyCasualtyMultiplier: null } }]);
    expect(effects.friendlyCasualtyMultiplier).toBe(0);
  });

  it('alive 缺省视为存活（只按 durability 判定的调用方兼容）', () => {
    const effects = aggregateWarEffects([{ warEffects: { friendlyDefenseMultiplier: 1.5 } }]);
    expect(effects.friendlyDefenseMultiplier).toBeCloseTo(1.5);
  });
});

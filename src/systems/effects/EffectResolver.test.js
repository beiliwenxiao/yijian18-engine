/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { describe, it, expect, beforeEach } from 'vitest';
import { EffectResolver } from './EffectResolver.js';
import { EffectSource, EffectSourceKind } from './EffectSource.js';
import { EffectType, EffectOperation, fromLegacyEffects } from './EffectTypes.js';

describe('EffectTypes 规范化与旧字段映射', () => {
  it('拒绝缺少必填字段的效果', () => {
    const { effects } = fromLegacyEffects(null);
    expect(effects).toEqual([]);
  });

  it('将旧版 attackBonus 映射为属性加法效果', () => {
    const { effects, unmapped } = fromLegacyEffects({ attackBonus: 5 }, { sourceId: 's1' });
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe(EffectType.ATTRIBUTE_MODIFY);
    expect(effects[0].target).toBe('attack');
    expect(effects[0].operation).toBe(EffectOperation.ADD);
    expect(effects[0].value).toBe(5);
    expect(unmapped).toEqual({});
  });

  it('未登记字段保留在 unmapped 而不静默丢弃', () => {
    const { effects, unmapped } = fromLegacyEffects({ mysteryStat: 3 });
    expect(effects).toHaveLength(0);
    expect(unmapped.mysteryStat).toBe(3);
  });
});

describe('EffectResolver 数值结算', () => {
  let resolver;

  beforeEach(() => {
    resolver = new EffectResolver();
  });

  it('无来源时返回基线值', () => {
    expect(resolver.getValue('p1', 'attack', 10)).toBe(10);
  });

  it('按 add 累加多个来源', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'talent_a',
      kind: EffectSourceKind.TALENT,
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 5 }]
    }));
    resolver.addSource('p1', new EffectSource({
      id: 'equip_a',
      kind: EffectSourceKind.EQUIPMENT,
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 3 }]
    }));
    expect(resolver.getValue('p1', 'attack', 10)).toBe(18);
  });

  it('按 base+add → addPercent → multiply 的固定顺序结算', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'mix',
      effects: [
        { type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 10 },
        { type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'addPercent', value: 0.5 },
        { type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'multiply', value: 2 }
      ]
    }));
    // (10 + 10) * 1.5 * 2 = 60
    expect(resolver.getValue('p1', 'attack', 10)).toBe(60);
  });

  it('override 覆盖计算结果并受 priority 控制', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'keystone',
      effects: [
        { type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 100 },
        { type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'override', value: 7, priority: 1 },
        { type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'override', value: 9, priority: 5 }
      ]
    }));
    expect(resolver.getValue('p1', 'attack', 10)).toBe(9);
  });

  it('clampMax 限制最终值', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'cap',
      effects: [
        { type: EffectType.COMBAT_MODIFY, target: 'criticalChance', operation: 'add', value: 0.9 },
        { type: EffectType.COMBAT_MODIFY, target: 'criticalChance', operation: 'clampMax', value: 0.5 }
      ]
    }));
    expect(resolver.getValue('p1', 'criticalChance', 0)).toBe(0.5);
  });

  it('移除来源后数值回退', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'buff',
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 20 }]
    }));
    expect(resolver.getValue('p1', 'attack', 10)).toBe(30);
    resolver.removeSource('p1', 'buff');
    expect(resolver.getValue('p1', 'attack', 10)).toBe(10);
  });

  it('按来源种类批量移除，用于重置天赋盘', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'board_1',
      kind: EffectSourceKind.PASSIVE_BOARD,
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 4 }]
    }));
    resolver.addSource('p1', new EffectSource({
      id: 'talent_1',
      kind: EffectSourceKind.TALENT,
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 6 }]
    }));
    expect(resolver.getValue('p1', 'attack', 0)).toBe(10);
    expect(resolver.removeSourcesByKind('p1', EffectSourceKind.PASSIVE_BOARD)).toBe(1);
    expect(resolver.getValue('p1', 'attack', 0)).toBe(6);
  });

  it('不同实体的成长状态互不影响', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'talent',
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 5 }]
    }));
    expect(resolver.getValue('p1', 'attack', 10)).toBe(15);
    expect(resolver.getValue('p2', 'attack', 10)).toBe(10);
  });
});

describe('EffectResolver 条件、标记与追溯', () => {
  it('未注入条件求值器时条件效果不生效', () => {
    const resolver = new EffectResolver();
    resolver.addSource('p1', new EffectSource({
      id: 'cond',
      effects: [{
        type: EffectType.ATTRIBUTE_MODIFY,
        target: 'attack',
        operation: 'add',
        value: 50,
        condition: { when: 'lowHp' }
      }]
    }));
    expect(resolver.getValue('p1', 'attack', 10)).toBe(10);
  });

  it('注入求值器后按上下文启用条件效果', () => {
    const resolver = new EffectResolver({
      conditionEvaluator: (condition, effect, context) =>
        condition.when === 'lowHp' && context && context.hpRatio < 0.3
    });
    resolver.addSource('p1', new EffectSource({
      id: 'cond',
      effects: [{
        type: EffectType.ATTRIBUTE_MODIFY,
        target: 'attack',
        operation: 'add',
        value: 50,
        condition: { when: 'lowHp' }
      }]
    }));
    expect(resolver.getValue('p1', 'attack', 10, { hpRatio: 0.9 })).toBe(10);
    expect(resolver.getValue('p1', 'attack', 10, { hpRatio: 0.1 })).toBe(60);
  });

  it('技能解锁与规则覆盖可查询', () => {
    const resolver = new EffectResolver();
    resolver.addSource('p1', new EffectSource({
      id: 'skill_node',
      kind: EffectSourceKind.SKILL,
      effects: [
        { type: EffectType.SKILL_UNLOCK, target: 'flight', value: true },
        { type: EffectType.SKILL_UNLOCK, target: 'climb', value: true },
        { type: EffectType.RULE_OVERRIDE, target: 'cannotCrit', value: true }
      ]
    }));
    expect(resolver.getUnlockedSkills('p1')).toEqual(['flight', 'climb']);
    expect(resolver.hasRuleOverride('p1', 'cannotCrit')).toBe(true);
    expect(resolver.hasRuleOverride('p1', 'immuneToFire')).toBe(false);
  });

  it('explain 返回每个来源的贡献明细', () => {
    const resolver = new EffectResolver();
    resolver.addSource('p1', EffectSource.fromLegacy('talent_a', EffectSourceKind.TALENT, { attackBonus: 5 }));
    resolver.addSource('p1', EffectSource.fromLegacy('equip_a', EffectSourceKind.EQUIPMENT, { attackBonus: 3 }));

    const detail = resolver.explain('p1', 'attack', 10);
    expect(detail.baseValue).toBe(10);
    expect(detail.finalValue).toBe(18);
    expect(detail.sources).toHaveLength(2);
    expect(detail.sources.map(s => s.sourceKind)).toContain(EffectSourceKind.TALENT);
  });

  it('职业固定修正作为基线，天赋盘在其上叠加', () => {
    const resolver = new EffectResolver();
    // 战士伐木时长基线为标准 75%
    const classBaseline = 10 * 0.75;
    resolver.addSource('p1', new EffectSource({
      id: 'board_gather',
      kind: EffectSourceKind.PASSIVE_BOARD,
      effects: [{ type: EffectType.GATHER_MODIFY, target: 'gather.duration', operation: 'addPercent', value: -0.2 }]
    }));
    expect(resolver.getValue('p1', 'gather.duration', classBaseline)).toBeCloseTo(6, 5);
  });

  it('stackGroup 内同类效果只取最大值', () => {
    const resolver = new EffectResolver();
    resolver.addSource('p1', new EffectSource({
      id: 'a',
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'defense', operation: 'add', value: 5, stackGroup: 'shield' }]
    }));
    resolver.addSource('p1', new EffectSource({
      id: 'b',
      effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'defense', operation: 'add', value: 8, stackGroup: 'shield' }]
    }));
    expect(resolver.getValue('p1', 'defense', 0)).toBe(8);
  });
});

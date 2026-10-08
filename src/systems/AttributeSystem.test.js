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

/**
 * AttributeSystem.test.js
 * 属性系统单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  AttributeSystem, 
  AttributeData, 
  AttributeEffectCalculator, 
  AttributeType 
} from './AttributeSystem.js';

describe('AttributeData', () => {
  let attributeData;

  beforeEach(() => {
    // 创建基础属性数据（所有属性都是基础值10）
    attributeData = new AttributeData({
      availablePoints: 10
    });
  });

  it('应该正确初始化属性数据', () => {
    expect(attributeData.strength).toBe(10);
    expect(attributeData.agility).toBe(10);
    expect(attributeData.intelligence).toBe(10);
    expect(attributeData.constitution).toBe(10);
    expect(attributeData.spirit).toBe(10);
    expect(attributeData.availablePoints).toBe(10);
  });

  it('应该能够获取属性值', () => {
    expect(attributeData.getAttribute(AttributeType.STRENGTH)).toBe(10);
    expect(attributeData.getAttribute(AttributeType.AGILITY)).toBe(10);
    expect(attributeData.getAttribute('invalid')).toBe(0);
  });

  it('应该能够设置属性值', () => {
    attributeData.setAttribute(AttributeType.STRENGTH, 20);
    expect(attributeData.strength).toBe(20);
    
    // 测试负值处理
    attributeData.setAttribute(AttributeType.STRENGTH, -5);
    expect(attributeData.strength).toBe(0);
  });

  it('应该能够增加属性点', () => {
    const success = attributeData.addAttribute(AttributeType.STRENGTH, 3);
    expect(success).toBe(true);
    expect(attributeData.strength).toBe(13);
    expect(attributeData.availablePoints).toBe(7);
    expect(attributeData.totalInvestedPoints).toBe(3);
  });

  it('应该在可用点数不足时拒绝增加属性', () => {
    const success = attributeData.addAttribute(AttributeType.STRENGTH, 15);
    expect(success).toBe(false);
    expect(attributeData.strength).toBe(10);
    expect(attributeData.availablePoints).toBe(10);
  });

  it('应该能够重置属性', () => {
    attributeData.addAttribute(AttributeType.STRENGTH, 5);
    attributeData.addAttribute(AttributeType.AGILITY, 3);
    
    attributeData.resetAttributes();
    
    expect(attributeData.strength).toBe(10);
    expect(attributeData.agility).toBe(10);
    expect(attributeData.availablePoints).toBe(10); // 原始10点（重置后回到初始状态）
    expect(attributeData.totalInvestedPoints).toBe(0);
  });
});

describe('AttributeEffectCalculator', () => {
  it('应该正确计算力量效果', () => {
    const effects = AttributeEffectCalculator.calculateStrengthEffects(20);
    
    expect(effects.attackBonus).toBe(16); // 20 * 0.8
    expect(effects.carryCapacityBonus).toBe(100); // 20 * 5
    expect(effects.weaponDamageMultiplier).toBe(1.2); // 1 + (20-10) * 0.02
  });

  it('应该正确计算敏捷效果', () => {
    const effects = AttributeEffectCalculator.calculateAgilityEffects(25);
    
    expect(effects.speedBonus).toBe(37); // floor(25 * 1.5)
    expect(effects.attackSpeedBonus).toBeCloseTo(0.45, 2); // (25-10) * 0.03
    expect(effects.dodgeChance).toBe(0.075); // (25-10) * 0.005
    expect(effects.criticalChance).toBe(0.045); // (25-10) * 0.003
  });

  it('应该正确计算智力效果', () => {
    const effects = AttributeEffectCalculator.calculateIntelligenceEffects(30);
    
    expect(effects.magicAttackBonus).toBe(36); // floor(30 * 1.2)
    expect(effects.maxManaBonus).toBe(240); // 30 * 8
    expect(effects.spellDamageMultiplier).toBe(1.5); // 1 + (30-10) * 0.025
    expect(effects.elementAttackBonus).toBe(15); // floor(30 * 0.5)
  });

  it('应该正确计算体质效果', () => {
    const effects = AttributeEffectCalculator.calculateConstitutionEffects(22);
    
    expect(effects.maxHpBonus).toBe(264); // 22 * 12
    expect(effects.defenseBonus).toBe(13); // floor(22 * 0.6)
    expect(effects.hpRegenBonus).toBe(6); // floor(22 * 0.3)
    expect(effects.damageReduction).toBe(0.024); // (22-10) * 0.002
  });

  it('应该正确计算精神效果', () => {
    const effects = AttributeEffectCalculator.calculateSpiritEffects(28);
    
    expect(effects.manaRegenBonus).toBe(22); // floor(28 * 0.8)
    expect(effects.statusResistance).toBe(0.18); // (28-10) * 0.01
    expect(effects.elementDefenseBonus).toBe(11); // floor(28 * 0.4)
    expect(effects.spellCooldownReduction).toBe(0.09); // (28-10) * 0.005
  });

  it('应该正确计算综合效果', () => {
    const attributeData = new AttributeData({
      strength: 20,
      agility: 15,
      intelligence: 25,
      constitution: 18,
      spirit: 22
    });

    const effects = AttributeEffectCalculator.calculateTotalEffects(attributeData);
    
    // 验证关键效果
    expect(effects.attackBonus).toBe(46); // 力量16 + 智力30
    expect(effects.maxHpBonus).toBe(216); // 体质18 * 12
    expect(effects.maxManaBonus).toBe(200); // 智力25 * 8
    expect(effects.speedBonus).toBe(22); // 敏捷15 * 1.5
    expect(effects.defenseBonus).toBe(10); // 体质18 * 0.6
  });

  it('应该限制最大值', () => {
    const effects = AttributeEffectCalculator.calculateAgilityEffects(100);
    
    // 闪避率应该被限制在30%
    expect(effects.dodgeChance).toBe(0.3);
    // 暴击率应该被限制在20%
    expect(effects.criticalChance).toBe(0.2);
  });
});

describe('AttributeSystem', () => {
  let attributeSystem;
  const characterId = 'test_character';

  beforeEach(() => {
    attributeSystem = new AttributeSystem();
  });

  it('应该能够初始化角色属性', () => {
    const attributeData = attributeSystem.initializeCharacterAttributes(characterId, {
      strength: 12,
      availablePoints: 5
    });

    expect(attributeData).toBeDefined();
    expect(attributeData.strength).toBe(12);
    expect(attributeData.availablePoints).toBe(5);
  });

  it('应该能够获取角色属性数据', () => {
    attributeSystem.initializeCharacterAttributes(characterId);
    const attributeData = attributeSystem.getCharacterAttributes(characterId);
    
    expect(attributeData).toBeDefined();
    expect(attributeData.strength).toBe(10);
  });

  it('应该在角色升级时获得属性点', () => {
    attributeSystem.initializeCharacterAttributes(characterId, { availablePoints: 0 });
    
    attributeSystem.onLevelUp(characterId, 2);
    
    const attributeData = attributeSystem.getCharacterAttributes(characterId);
    expect(attributeData.availablePoints).toBe(5);
  });

  it('应该能够分配属性点', () => {
    attributeSystem.initializeCharacterAttributes(characterId, { availablePoints: 10 });
    
    const success = attributeSystem.allocateAttribute(characterId, AttributeType.STRENGTH, 3);
    
    expect(success).toBe(true);
    const attributeData = attributeSystem.getCharacterAttributes(characterId);
    expect(attributeData.strength).toBe(13);
    expect(attributeData.availablePoints).toBe(7);
  });

  it('应该拒绝无效的属性分配', () => {
    attributeSystem.initializeCharacterAttributes(characterId, { availablePoints: 2 });
    
    const success = attributeSystem.allocateAttribute(characterId, AttributeType.STRENGTH, 5);
    
    expect(success).toBe(false);
  });

  it('应该能够重置角色属性', () => {
    attributeSystem.initializeCharacterAttributes(characterId, { availablePoints: 10 });
    attributeSystem.allocateAttribute(characterId, AttributeType.STRENGTH, 5);
    attributeSystem.allocateAttribute(characterId, AttributeType.AGILITY, 3);
    
    const success = attributeSystem.resetCharacterAttributes(characterId);
    
    expect(success).toBe(true);
    const attributeData = attributeSystem.getCharacterAttributes(characterId);
    expect(attributeData.strength).toBe(10);
    expect(attributeData.agility).toBe(10);
    expect(attributeData.availablePoints).toBe(10); // 回到初始状态
  });

  it('应该能够计算角色属性效果', () => {
    attributeSystem.initializeCharacterAttributes(characterId, {
      strength: 20,
      intelligence: 25,
      constitution: 18
    });
    
    const effects = attributeSystem.calculateCharacterEffects(characterId);
    
    expect(effects).toBeDefined();
    expect(effects.attackBonus).toBeGreaterThan(0);
    expect(effects.maxHpBonus).toBeGreaterThan(0);
    expect(effects.maxManaBonus).toBeGreaterThan(0);
  });

  it('应该能够应用属性效果到基础属性', () => {
    attributeSystem.initializeCharacterAttributes(characterId, {
      strength: 20,
      constitution: 18,
      intelligence: 25
    });
    
    const baseStats = {
      attack: 10,
      defense: 5,
      maxHp: 100,
      maxMp: 50,
      hp: 100,
      mp: 50,
      speed: 100
    };
    
    const modifiedStats = attributeSystem.applyAttributeEffects(characterId, baseStats);
    
    expect(modifiedStats.attack).toBeGreaterThan(baseStats.attack);
    expect(modifiedStats.defense).toBeGreaterThan(baseStats.defense);
    expect(modifiedStats.maxHp).toBeGreaterThan(baseStats.maxHp);
    expect(modifiedStats.maxMp).toBeGreaterThan(baseStats.maxMp);
    expect(modifiedStats.attributeEffects).toBeDefined();
  });

  it('应该返回属性描述信息', () => {
    const description = attributeSystem.getAttributeDescription(AttributeType.STRENGTH);
    
    expect(description).toBeDefined();
    expect(description.name).toBe('力量');
    expect(description.description).toBeDefined();
    expect(description.effects).toBeInstanceOf(Array);
    expect(description.effects.length).toBeGreaterThan(0);
  });

  it('应该返回所有属性描述', () => {
    const descriptions = attributeSystem.getAllAttributeDescriptions();
    
    expect(Object.keys(descriptions)).toHaveLength(5);
    expect(descriptions[AttributeType.STRENGTH]).toBeDefined();
    expect(descriptions[AttributeType.AGILITY]).toBeDefined();
    expect(descriptions[AttributeType.INTELLIGENCE]).toBeDefined();
    expect(descriptions[AttributeType.CONSTITUTION]).toBeDefined();
    expect(descriptions[AttributeType.SPIRIT]).toBeDefined();
  });
});
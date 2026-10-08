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
 * ClassSystem.test.js
 * 职业系统单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClassSystem, ClassType, ClassNames, ClassInstructors } from './ClassSystem.js';
import { UnitTypes } from './UnitSystem.js';
import { AttributeType } from './AttributeSystem.js';

describe('ClassSystem', () => {
  let classSystem;
  
  beforeEach(() => {
    classSystem = new ClassSystem();
  });
  
  describe('职业数据管理', () => {
    it('应该初始化三个职业', () => {
      const allClasses = classSystem.getAllClasses();
      expect(allClasses).toHaveLength(3);
      
      const classTypes = allClasses.map(c => c.id);
      expect(classTypes).toContain(ClassType.WARRIOR);
      expect(classTypes).toContain(ClassType.ARCHER);
      expect(classTypes).toContain(ClassType.STRATEGIST);
    });
    
    it('应该能获取职业数据', () => {
      const warriorData = classSystem.getClassData(ClassType.WARRIOR);
      expect(warriorData).toBeDefined();
      expect(warriorData.displayName).toBe('战士');
      expect(warriorData.instructor.name).toBe('张梁');
    });
    
    it('应该返回null对于不存在的职业', () => {
      const invalidClass = classSystem.getClassData('invalid_class');
      expect(invalidClass).toBeNull();
    });
  });
  
  describe('职业选择', () => {
    it('应该能成功选择职业', () => {
      const characterId = 'player1';
      const result = classSystem.selectClass(characterId, ClassType.WARRIOR);
      
      expect(result).toBe(true);
      expect(classSystem.getCharacterClass(characterId)).toBe(ClassType.WARRIOR);
    });
    
    it('应该初始化角色属性系统', () => {
      const characterId = 'player1';
      classSystem.selectClass(characterId, ClassType.WARRIOR);
      
      const attributes = classSystem.getCharacterAttributes(characterId);
      expect(attributes).toBeDefined();
      expect(attributes.strength).toBe(10);
      expect(attributes.availablePoints).toBe(5);
    });
    
    it('不应该允许重复选择职业', () => {
      const characterId = 'player1';
      classSystem.selectClass(characterId, ClassType.WARRIOR);
      
      const result = classSystem.selectClass(characterId, ClassType.STRATEGIST);
      expect(result).toBe(false);
      expect(classSystem.getCharacterClass(characterId)).toBe(ClassType.WARRIOR);
    });
    
    it('应该拒绝无效的职业类型', () => {
      const characterId = 'player1';
      const result = classSystem.selectClass(characterId, 'invalid_class');
      
      expect(result).toBe(false);
      expect(classSystem.getCharacterClass(characterId)).toBeNull();
    });
  });
  
  describe('兵种特化', () => {
    beforeEach(() => {
      classSystem.selectClass('player1', ClassType.WARRIOR);
    });
    
    it('应该能选择兵种特化', () => {
      const result = classSystem.selectSpecialization('player1', 'warrior_heavy_infantry', 10);
      
      expect(result).toBe(true);
      const specialization = classSystem.getCharacterSpecialization('player1');
      expect(specialization).toBeDefined();
      expect(specialization.name).toBe('重甲步兵');
    });
    
    it('应该检查等级要求', () => {
      const result = classSystem.selectSpecialization('player1', 'warrior_heavy_infantry', 5);
      
      expect(result).toBe(false);
      expect(classSystem.getCharacterSpecialization('player1')).toBeNull();
    });
    
    it('不应该允许重复选择特化', () => {
      classSystem.selectSpecialization('player1', 'warrior_heavy_infantry', 10);
      const result = classSystem.selectSpecialization('player1', 'warrior_berserker', 10);
      
      expect(result).toBe(false);
      const specialization = classSystem.getCharacterSpecialization('player1');
      expect(specialization.id).toBe('warrior_heavy_infantry');
    });
    
    it('应该返回正确的兵种类型', () => {
      // 未选择特化时返回基础兵种
      let unitType = classSystem.getCharacterUnitType('player1');
      expect(unitType).toBe(UnitTypes.SWORD_SHIELD);
      
      // 选择特化后返回特化兵种
      classSystem.selectSpecialization('player1', 'warrior_heavy_infantry', 10);
      unitType = classSystem.getCharacterUnitType('player1');
      expect(unitType).toBe(UnitTypes.HEAVY_INFANTRY);
    });
    
    it('应该能检查是否可以选择特化', () => {
      expect(classSystem.canSelectSpecialization('player1', 5)).toBe(false);
      expect(classSystem.canSelectSpecialization('player1', 10)).toBe(true);
      
      classSystem.selectSpecialization('player1', 'warrior_heavy_infantry', 10);
      expect(classSystem.canSelectSpecialization('player1', 15)).toBe(false);
    });
    
    it('应该返回可用的特化选项', () => {
      const available = classSystem.getAvailableSpecializations('player1', 10);
      expect(available).toHaveLength(2);
      expect(available.map(s => s.id)).toContain('warrior_heavy_infantry');
      expect(available.map(s => s.id)).toContain('warrior_berserker');
    });
  });
  
  describe('技能树集成', () => {
    beforeEach(() => {
      classSystem.selectClass('player1', ClassType.WARRIOR);
    });
    
    it('应该能获取角色技能树', () => {
      const skillTree = classSystem.getCharacterSkillTree('player1');
      expect(skillTree).toBeDefined();
      expect(skillTree.className).toBe('warrior');
    });
    
    it('应该能学习技能', () => {
      const character = {
        level: 5,
        skillPoints: 10
      };
      
      const result = classSystem.learnSkill('player1', 'warrior_basic_combat', character);
      expect(result).toBe(true);
      expect(character.skillPoints).toBe(9);
    });
    
    it('应该能重置技能树', () => {
      const character = {
        level: 5,
        skillPoints: 5
      };
      
      classSystem.learnSkill('player1', 'warrior_basic_combat', character);
      // 学习消耗 1 点：5 → 4
      expect(character.skillPoints).toBe(4);

      const returnedPoints = classSystem.resetSkillTree('player1', character);
      
      expect(returnedPoints).toBe(1);
      // 重置返还 1 点：4 → 5
      expect(character.skillPoints).toBe(5);
    });
  });
  
  describe('属性系统集成', () => {
    beforeEach(() => {
      classSystem.selectClass('player1', ClassType.WARRIOR);
    });
    
    it('应该能分配属性点', () => {
      const result = classSystem.allocateAttribute('player1', AttributeType.STRENGTH, 2);
      expect(result).toBe(true);
      
      const attributes = classSystem.getCharacterAttributes('player1');
      expect(attributes.strength).toBe(12);
      expect(attributes.availablePoints).toBe(3);
    });
    
    it('应该检查可用属性点', () => {
      classSystem.allocateAttribute('player1', AttributeType.STRENGTH, 5);
      const result = classSystem.allocateAttribute('player1', AttributeType.AGILITY, 1);
      
      expect(result).toBe(false);
    });
    
    it('应该能重置属性点', () => {
      classSystem.allocateAttribute('player1', AttributeType.STRENGTH, 3);
      // 分配后可用点数 5 - 3 = 2
      expect(classSystem.getCharacterAttributes('player1').availablePoints).toBe(2);

      const result = classSystem.resetAttributes('player1');
      
      expect(result).toBe(true);
      const attributes = classSystem.getCharacterAttributes('player1');
      expect(attributes.strength).toBe(10);
      // 返还 3 点后回到初始 5
      expect(attributes.availablePoints).toBe(5);
    });
  });
  
  describe('最终属性计算', () => {
    beforeEach(() => {
      classSystem.selectClass('player1', ClassType.WARRIOR);
    });
    
    it('应该计算基础属性和等级成长', () => {
      const character = { level: 5, hp: 150, mp: 30 };
      const stats = classSystem.calculateFinalStats('player1', character);
      
      // 基础150 + 成长15*4 = 210
      expect(stats.maxHp).toBeGreaterThanOrEqual(210);
      // 基础30 + 成长3*4 = 42
      expect(stats.maxMp).toBeGreaterThanOrEqual(42);
    });
    
    it('应该应用属性系统效果', () => {
      const character = { level: 1, hp: 150, mp: 30 };
      
      // 分配力量点
      classSystem.allocateAttribute('player1', AttributeType.STRENGTH, 5);
      
      const stats = classSystem.calculateFinalStats('player1', character);
      
      // 应该有力量加成
      expect(stats.attack).toBeGreaterThan(15); // 基础攻击15
    });
    
    it('应该应用特化加成', () => {
      const character = { level: 10, hp: 150, mp: 30 };
      
      classSystem.selectSpecialization('player1', 'warrior_heavy_infantry', 10);
      const stats = classSystem.calculateFinalStats('player1', character);
      
      // 重甲步兵有1.3倍防御加成
      expect(stats.defense).toBeGreaterThan(10);
      expect(stats.specializationBonuses).toBeDefined();
      expect(stats.specializationBonuses.defenseMultiplier).toBe(1.3);
    });
    
    it('应该包含兵种类型', () => {
      const character = { level: 1, hp: 150, mp: 30 };
      const stats = classSystem.calculateFinalStats('player1', character);
      
      expect(stats.unitType).toBe(UnitTypes.SWORD_SHIELD);
    });
  });
  
  describe('角色升级', () => {
    beforeEach(() => {
      classSystem.selectClass('player1', ClassType.WARRIOR);
    });
    
    it('应该在升级时给予属性点', () => {
      const attributesBefore = classSystem.getCharacterAttributes('player1');
      const pointsBefore = attributesBefore.availablePoints;
      
      classSystem.onLevelUp('player1', 2);
      
      const attributesAfter = classSystem.getCharacterAttributes('player1');
      expect(attributesAfter.availablePoints).toBe(pointsBefore + 5);
    });
  });
  
  describe('职业信息查询', () => {
    it('应该返回推荐属性', () => {
      const recommended = classSystem.getRecommendedAttributes(ClassType.WARRIOR);
      expect(recommended).toBeDefined();
      expect(recommended.primary).toBe(AttributeType.STRENGTH);
      expect(recommended.secondary).toBe(AttributeType.CONSTITUTION);
    });
    
    it('应该返回初始装备', () => {
      const equipment = classSystem.getStartingEquipment(ClassType.WARRIOR);
      expect(equipment).toHaveLength(3);
      expect(equipment[0].type).toBe('weapon');
    });
    
    it('应该返回教官信息', () => {
      const instructor = classSystem.getInstructor(ClassType.WARRIOR);
      expect(instructor).toBeDefined();
      expect(instructor.name).toBe('张梁');
      expect(instructor.title).toBe('地公将军');
    });
    
    it('应该返回所有教官信息', () => {
      const instructors = classSystem.getAllInstructors();
      expect(instructors).toHaveLength(3);
      expect(instructors.map(i => i.name)).toContain('张梁');
      expect(instructors.map(i => i.name)).toContain('张宝');
      expect(instructors.map(i => i.name)).toContain('张角');
    });
  });
  
  describe('不同职业的特性', () => {
    it('战士应该有高生命值和防御', () => {
      const warriorData = classSystem.getClassData(ClassType.WARRIOR);
      expect(warriorData.baseAttributes.health).toBeGreaterThan(100);
      expect(warriorData.baseAttributes.defense).toBeGreaterThan(5);
    });
    
    it('弓箭手应该有高攻击和速度', () => {
      const archerData = classSystem.getClassData(ClassType.ARCHER);
      expect(archerData.baseAttributes.attack).toBeGreaterThan(15);
      expect(archerData.baseAttributes.speed).toBeGreaterThan(100);
    });
    
    it('军师应该有高法力值', () => {
      const strategistData = classSystem.getClassData(ClassType.STRATEGIST);
      expect(strategistData.baseAttributes.mana).toBeGreaterThan(80);
    });
    
    it('每个职业应该有两个特化选项', () => {
      const allClasses = classSystem.getAllClasses();
      allClasses.forEach(classData => {
        expect(classData.specializations).toHaveLength(2);
      });
    });
  });
});

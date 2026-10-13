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
 * ClassSystem.js
 * 职业系统 - 管理职业选择、技能树和兵种特化
 * 
 * 集成系统：
 * - SkillTreeSystem: 技能树管理
 * - UnitSystem: 兵种系统
 * - AttributeSystem: 属性系统
 */

import { Logger } from '../core/Logger.js';
import { SkillTreeSystem } from './SkillTreeSystem.js';
import { UnitSystem, UnitTypes } from './UnitSystem.js';
import { AttributeSystem, AttributeType } from './AttributeSystem.js';
import { EffectResolver } from './effects/EffectResolver.js';
import { EffectSource, EffectSourceKind } from './effects/EffectSource.js';

/** 特化加成可作用的角色属性字段 */
const SPECIALIZATION_STAT_TARGETS = ['maxHp', 'attack', 'defense', 'speed'];

/**
 * 职业固定规则只产出统一效果协议；具体系统通过 EffectResolver 消费。
 * 数值属于职业基线，不写入场景或 UI。
 */
const CLASS_FIXED_EFFECTS = Object.freeze({
  warrior: Object.freeze([
    { type: 'gather.modify', target: 'gather.duration', operation: 'multiply', value: 0.8 },
    { type: 'inventory.modify', target: 'resourceCapacity', operation: 'multiply', value: 0.75 }
  ]),
  archer: Object.freeze([
    { type: 'gather.modify', target: 'gather.duration', operation: 'multiply', value: 1.2 },
    { type: 'rule.override', target: 'gather.rangedGuardLure', value: true }
  ]),
  strategist: Object.freeze([
    { type: 'skill.unlock', target: 'gathering_puppet', value: true },
    { type: 'rule.override', target: 'gather.puppetCharges', value: 1 }
  ])
});

/**
 * 职业类型枚举
 */
export const ClassType = {
  WARRIOR: 'warrior',   // 战士
  ARCHER: 'archer',     // 弓箭手
  STRATEGIST: 'strategist' // 军师
};

/**
 * 职业名称映射
 */
export const ClassNames = {
  [ClassType.WARRIOR]: '战士',
  [ClassType.ARCHER]: '弓箭手',
  [ClassType.STRATEGIST]: '军师'
};

/**
 * 教官NPC映射
 */
export const ClassInstructors = {
  [ClassType.WARRIOR]: {
    id: 'zhang_liang',
    name: '张梁',
    title: '地公将军',
    description: '张角的弟弟，擅长近战和防御'
  },
  [ClassType.ARCHER]: {
    id: 'zhang_bao',
    name: '张宝',
    title: '人公将军',
    description: '张角的弟弟，擅长远程攻击和机动'
  },
  [ClassType.STRATEGIST]: {
    id: 'zhang_jiao',
    name: '张角',
    title: '天公将军',
    description: '太平道创始人，擅长战场谋略、符法辅助与阵势控制'
  }
};

/**
 * 职业数据类
 */
export class ClassData {
  /**
   * @param {Object} config - 职业配置
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.displayName = config.displayName;
    this.description = config.description;
    this.instructor = config.instructor;
    
    // 基础属性
    this.baseAttributes = config.baseAttributes || {
      health: 100,
      mana: 50,
      attack: 10,
      defense: 5,
      speed: 100
    };
    
    // 属性成长
    this.attributeGrowth = config.attributeGrowth || {
      health: 10,
      mana: 5,
      attack: 2,
      defense: 1,
      speed: 1
    };
    
    // 推荐属性分配
    this.recommendedAttributes = config.recommendedAttributes || {
      primary: AttributeType.STRENGTH,
      secondary: AttributeType.CONSTITUTION
    };
    
    // 基础兵种
    this.baseUnitType = config.baseUnitType || UnitTypes.SWORD_SHIELD;
    
    // 兵种特化选项
    this.specializations = config.specializations || [];
    
    // 初始装备
    this.startingEquipment = config.startingEquipment || [];
  }
}

/**
 * 兵种特化数据类
 */
export class SpecializationData {
  /**
   * @param {Object} config - 特化配置
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.unitType = config.unitType;
    this.requiredLevel = config.requiredLevel || 10;
    this.bonuses = config.bonuses || {};
    this.specialSkills = config.specialSkills || [];
  }
}

/**
 * 职业系统主类
 */
export class ClassSystem {
  /**
   * @param {Object} [config]
   * @param {EffectResolver} [config.effectResolver] - 可注入的统一效果结算器，
   *        不传时自行创建，并与内部 SkillTreeSystem 共用同一实例。
   */
  constructor(config = {}) {
    // 统一效果结算器（职业固定修正是基线，其余来源在其上叠加）
    this.effectResolver = config.effectResolver || new EffectResolver();

    // 集成现有系统
    this.skillTreeSystem = new SkillTreeSystem({ effectResolver: this.effectResolver });
    this.unitSystem = new UnitSystem();
    this.attributeSystem = new AttributeSystem();
    
    // 职业数据
    this.classes = new Map();
    this.characterClasses = new Map(); // 角色ID -> 职业ID
    this.characterSpecializations = new Map(); // 角色ID -> 特化ID
    
    // 初始化职业数据
    this.initializeClasses();
    
    Logger.log('ClassSystem: 职业系统已初始化');
  }
  
  /**
   * 初始化职业数据
   */
  initializeClasses() {
    // 战士职业
    this.classes.set(ClassType.WARRIOR, new ClassData({
      id: ClassType.WARRIOR,
      name: 'warrior',
      displayName: '战士',
      description: '近战专家，拥有强大的生命值和防御力，擅长冲锋陷阵',
      instructor: ClassInstructors[ClassType.WARRIOR],
      baseAttributes: {
        health: 150,
        mana: 30,
        attack: 15,
        defense: 10,
        speed: 90
      },
      attributeGrowth: {
        health: 15,
        mana: 3,
        attack: 3,
        defense: 2,
        speed: 1
      },
      recommendedAttributes: {
        primary: AttributeType.STRENGTH,
        secondary: AttributeType.CONSTITUTION,
        tertiary: AttributeType.AGILITY
      },
      baseUnitType: UnitTypes.SWORD_SHIELD,
      specializations: [
        new SpecializationData({
          id: 'warrior_heavy_infantry',
          name: '重甲步兵',
          description: '专注于防御和生存，成为战场上的铁壁',
          unitType: UnitTypes.HEAVY_INFANTRY,
          requiredLevel: 10,
          bonuses: {
            defenseMultiplier: 1.3,
            healthMultiplier: 1.2,
            damageReduction: 0.1
          },
          specialSkills: ['warrior_fortress', 'warrior_shield_wall']
        }),
        new SpecializationData({
          id: 'warrior_berserker',
          name: '狂战士',
          description: '专注于攻击和爆发，成为战场上的杀神',
          unitType: UnitTypes.LIGHT_INFANTRY,
          requiredLevel: 10,
          bonuses: {
            attackMultiplier: 1.4,
            criticalChance: 0.15,
            attackSpeed: 0.2
          },
          specialSkills: ['warrior_berserker_rage', 'warrior_whirlwind']
        })
      ],
      startingEquipment: [
        { id: 'iron_sword', name: '铁剑', type: 'weapon' },
        { id: 'leather_armor', name: '皮甲', type: 'armor' },
        { id: 'wooden_shield', name: '木盾', type: 'shield' }
      ]
    }));
    
    // 弓箭手职业
    this.classes.set(ClassType.ARCHER, new ClassData({
      id: ClassType.ARCHER,
      name: 'archer',
      displayName: '弓箭手',
      description: '远程专家，拥有高攻击力和敏捷，擅长风筝和爆发',
      instructor: ClassInstructors[ClassType.ARCHER],
      baseAttributes: {
        health: 100,
        mana: 40,
        attack: 18,
        defense: 5,
        speed: 120
      },
      attributeGrowth: {
        health: 10,
        mana: 4,
        attack: 4,
        defense: 1,
        speed: 2
      },
      recommendedAttributes: {
        primary: AttributeType.AGILITY,
        secondary: AttributeType.STRENGTH,
        tertiary: AttributeType.CONSTITUTION
      },
      baseUnitType: UnitTypes.ARCHER_CROSSBOW,
      specializations: [
        new SpecializationData({
          id: 'archer_mounted',
          name: '弓骑兵',
          description: '骑射合一，拥有极高的机动性和持续输出',
          unitType: UnitTypes.MOUNTED_ARCHER,
          requiredLevel: 10,
          bonuses: {
            speedMultiplier: 1.5,
            attackRange: 50,
            dodgeChance: 0.15
          },
          specialSkills: ['archer_rapid_fire', 'archer_phantom_shot']
        }),
        new SpecializationData({
          id: 'archer_crossbow',
          name: '连弩步兵',
          description: '专注于爆发伤害和范围攻击',
          unitType: UnitTypes.REPEATING_CROSSBOW,
          requiredLevel: 10,
          bonuses: {
            attackMultiplier: 1.3,
            criticalDamage: 0.5,
            armorPenetration: 0.2
          },
          specialSkills: ['archer_explosive_arrow', 'archer_arrow_storm']
        })
      ],
      startingEquipment: [
        { id: 'short_bow', name: '短弓', type: 'weapon' },
        { id: 'leather_vest', name: '皮背心', type: 'armor' },
        { id: 'wooden_arrow', name: '木箭', type: 'ammo', quantity: 90 }
      ]
    }));
    
    // 军师职业
    this.classes.set(ClassType.STRATEGIST, new ClassData({
      id: ClassType.STRATEGIST,
      name: 'strategist',
      displayName: '军师',
      description: '战场谋略与符阵辅助专家，擅长火攻、控制和调度',
      instructor: ClassInstructors[ClassType.STRATEGIST],
      baseAttributes: {
        health: 80,
        mana: 100,
        attack: 8,
        defense: 3,
        speed: 95
      },
      attributeGrowth: {
        health: 8,
        mana: 10,
        attack: 2,
        defense: 1,
        speed: 1
      },
      recommendedAttributes: {
        primary: AttributeType.INTELLIGENCE,
        secondary: AttributeType.SPIRIT,
        tertiary: AttributeType.CONSTITUTION
      },
      baseUnitType: UnitTypes.ARCHER_CROSSBOW,
      specializations: [
        new SpecializationData({
          id: 'strategist_tactician',
          name: '战阵谋士',
          description: '专注火攻与战场调度，以谋略制造范围压制',
          unitType: UnitTypes.REPEATING_CROSSBOW,
          requiredLevel: 10,
          bonuses: {
            spellDamageMultiplier: 1.4,
            fireElementBonus: 20,
            criticalChance: 0.2
          },
          specialSkills: ['strategist_fire_attack', 'strategist_grand_strategy']
        }),
        new SpecializationData({
          id: 'strategist_talismanist',
          name: '符阵军师',
          description: '专注符阵辅助与控制，牵制敌军并保护友军',
          unitType: UnitTypes.MOUNTED_ARCHER,
          requiredLevel: 10,
          bonuses: {
            spellDamageMultiplier: 1.2,
            iceElementBonus: 20,
            slowEffect: 0.3,
            manaEfficiency: 0.2
          },
          specialSkills: ['strategist_wind_snow_formation', 'strategist_stasis_formation']
        })
      ],
      startingEquipment: [
        { id: 'strategist_talisman_staff', name: '符杖', type: 'weapon' },
        { id: 'strategist_robe', name: '军师道袍', type: 'armor' },
        { id: 'strategist_talisman', name: '护身符', type: 'accessory' }
      ]
    }));
  }
  
  /**
   * 获取职业数据
   * @param {string} classType - 职业类型
   * @returns {ClassData|null}
   */
  getClassData(classType) {
    return this.classes.get(classType) || null;
  }
  
  /**
   * 获取所有职业数据
   * @returns {Array<ClassData>}
   */
  getAllClasses() {
    return Array.from(this.classes.values());
  }
  
  /**
   * 选择职业
   * @param {string} characterId - 角色ID
   * @param {string} classType - 职业类型
   * @returns {boolean} 是否成功
   */
  selectClass(characterId, classType) {
    const classData = this.getClassData(classType);
    if (!characterId || !classData) {
      console.warn(`职业 ${classType} 不存在或角色 ID 无效`);
      return false;
    }

    // 职业不可逆；相同职业由 restoreClass() 负责幂等重建，不在选择入口重复提交。
    if (this.characterClasses.has(characterId)) {
      console.warn(`角色 ${characterId} 已经选择过职业`);
      return false;
    }

    this.characterClasses.set(characterId, classType);
    this.attributeSystem.initializeCharacterAttributes(characterId, {
      strength: 10,
      agility: 10,
      intelligence: 10,
      constitution: 10,
      spirit: 10,
      availablePoints: 5
    });
    this.syncClassSource(characterId);

    Logger.log(`角色 ${characterId} 选择了职业: ${classData.displayName}`);
    return true;
  }

  /**
   * 从持久化职业事实重建运行时映射和固定效果来源；相同职业重复调用幂等。
   * @param {string} characterId
   * @param {string} classType
   * @returns {boolean}
   */
  restoreClass(characterId, classType) {
    const classData = this.getClassData(classType);
    if (!characterId || !classData) return false;
    const current = this.characterClasses.get(characterId);
    if (current && current !== classType) this.clearClass(characterId);
    if (this.characterClasses.get(characterId) !== classType) {
      this.characterClasses.set(characterId, classType);
      if (!this.attributeSystem.getCharacterAttributes(characterId)) {
        this.attributeSystem.initializeCharacterAttributes(characterId, {
          strength: 10, agility: 10, intelligence: 10,
          constitution: 10, spirit: 10, availablePoints: 5
        });
      }
    }
    this.syncClassSource(characterId);
    return true;
  }

  /**
   * 回滚尚未持久化的职业选择；只清理由 ClassSystem 拥有的状态和来源。
   * @param {string} characterId
   * @returns {boolean}
   */
  clearClass(characterId) {
    if (!characterId) return false;
    const existed = this.characterClasses.delete(characterId);
    this.characterSpecializations.delete(characterId);
    this.effectResolver.removeSource(characterId, `class:${characterId}`);
    for (const source of this.effectResolver.getSources(characterId)) {
      if (String(source.id || '').startsWith('specialization:')) {
        this.effectResolver.removeSource(characterId, source.id);
      }
    }
    this.attributeSystem.attributeData?.delete?.(characterId);
    return existed;
  }

  /** 将职业固定规则同步到共享 EffectResolver。 */
  syncClassSource(characterId) {
    const classType = this.characterClasses.get(characterId);
    const sourceId = `class:${characterId}`;
    if (!classType) {
      this.effectResolver.removeSource(characterId, sourceId);
      return sourceId;
    }
    this.effectResolver.addSource(characterId, new EffectSource({
      id: sourceId,
      kind: EffectSourceKind.CLASS,
      priority: 10,
      effects: CLASS_FIXED_EFFECTS[classType] || []
    }));
    return sourceId;
  }
  
  /**
   * 获取角色职业
   * @param {string} characterId - 角色ID
   * @returns {string|null}
   */
  getCharacterClass(characterId) {
    return this.characterClasses.get(characterId) || null;
  }
  
  /**
   * 获取角色职业数据
   * @param {string} characterId - 角色ID
   * @returns {ClassData|null}
   */
  getCharacterClassData(characterId) {
    const classType = this.getCharacterClass(characterId);
    if (!classType) {
      return null;
    }
    return this.getClassData(classType);
  }
  
  /**
   * 选择兵种特化
   * @param {string} characterId - 角色ID
   * @param {string} specializationId - 特化ID
   * @param {number} characterLevel - 角色等级
   * @returns {boolean} 是否成功
   */
  selectSpecialization(characterId, specializationId, characterLevel) {
    const classData = this.getCharacterClassData(characterId);
    if (!classData) {
      console.warn(`角色 ${characterId} 没有职业`);
      return false;
    }
    
    // 查找特化
    const specialization = classData.specializations.find(s => s.id === specializationId);
    if (!specialization) {
      console.warn(`特化 ${specializationId} 不存在`);
      return false;
    }
    
    // 检查等级要求
    if (characterLevel < specialization.requiredLevel) {
      console.warn(`角色等级不足，需要 ${specialization.requiredLevel} 级`);
      return false;
    }
    
    // 检查是否已经选择过特化
    if (this.characterSpecializations.has(characterId)) {
      console.warn(`角色 ${characterId} 已经选择过特化`);
      return false;
    }
    
    // 设置特化
    this.characterSpecializations.set(characterId, specializationId);
    
    Logger.log(`角色 ${characterId} 选择了特化: ${specialization.name}`);
    return true;
  }
  
  /**
   * 获取角色特化
   * @param {string} characterId - 角色ID
   * @returns {SpecializationData|null}
   */
  getCharacterSpecialization(characterId) {
    const specializationId = this.characterSpecializations.get(characterId);
    if (!specializationId) {
      return null;
    }
    
    const classData = this.getCharacterClassData(characterId);
    if (!classData) {
      return null;
    }
    
    return classData.specializations.find(s => s.id === specializationId) || null;
  }
  
  /**
   * 获取角色兵种类型
   * @param {string} characterId - 角色ID
   * @returns {number}
   */
  getCharacterUnitType(characterId) {
    const specialization = this.getCharacterSpecialization(characterId);
    if (specialization) {
      return specialization.unitType;
    }
    
    const classData = this.getCharacterClassData(characterId);
    if (classData) {
      return classData.baseUnitType;
    }
    
    return UnitTypes.SWORD_SHIELD; // 默认兵种
  }
  
  /**
   * 学习技能
   * @param {string} characterId - 角色ID
   * @param {string} skillId - 技能ID
   * @param {Object} character - 角色数据
   * @returns {boolean} 是否成功
   */
  learnSkill(characterId, skillId, character) {
    const classType = this.getCharacterClass(characterId);
    if (!classType) {
      console.warn(`角色 ${characterId} 没有职业`);
      return false;
    }
    
    // 设置角色职业（用于技能树系统）
    character.class = classType;
    
    return this.skillTreeSystem.learnSkill(character, skillId);
  }
  
  /**
   * 获取角色技能树
   * @param {string} characterId - 角色ID
   * @returns {SkillTree|null}
   */
  getCharacterSkillTree(characterId) {
    const classType = this.getCharacterClass(characterId);
    if (!classType) {
      return null;
    }
    
    return this.skillTreeSystem.getSkillTree(classType);
  }
  
  /**
   * 分配属性点
   * @param {string} characterId - 角色ID
   * @param {string} attributeType - 属性类型
   * @param {number} points - 点数
   * @returns {boolean} 是否成功
   */
  allocateAttribute(characterId, attributeType, points = 1) {
    return this.attributeSystem.allocateAttribute(characterId, attributeType, points);
  }
  
  /**
   * 获取角色属性
   * @param {string} characterId - 角色ID
   * @returns {AttributeData|null}
   */
  getCharacterAttributes(characterId) {
    return this.attributeSystem.getCharacterAttributes(characterId);
  }
  
  /**
   * 计算角色最终属性
   * @param {string} characterId - 角色ID
   * @param {Object} character - 角色数据
   * @returns {Object} 最终属性
   */
  calculateFinalStats(characterId, character) {
    const classData = this.getCharacterClassData(characterId);
    if (!classData) {
      return character;
    }
    
    // 基础属性 + 等级成长
    const level = character.level || 1;
    const baseStats = {
      maxHp: classData.baseAttributes.health + classData.attributeGrowth.health * (level - 1),
      maxMp: classData.baseAttributes.mana + classData.attributeGrowth.mana * (level - 1),
      attack: classData.baseAttributes.attack + classData.attributeGrowth.attack * (level - 1),
      defense: classData.baseAttributes.defense + classData.attributeGrowth.defense * (level - 1),
      speed: classData.baseAttributes.speed + classData.attributeGrowth.speed * (level - 1),
      hp: character.hp || classData.baseAttributes.health,
      mp: character.mp || classData.baseAttributes.mana
    };
    
    // 应用属性系统效果
    const statsWithAttributes = this.attributeSystem.applyAttributeEffects(characterId, baseStats);
    
    // 应用特化加成（统一走 EffectResolver，不再逐字段判断倍率）
    const specialization = this.getCharacterSpecialization(characterId);
    if (specialization) {
      const bonuses = specialization.bonuses || {};
      this._syncSpecializationSource(characterId, specialization);

      const targets = {};
      for (const key of SPECIALIZATION_STAT_TARGETS) {
        if (typeof statsWithAttributes[key] === 'number') {
          targets[key] = statsWithAttributes[key];
        }
      }

      const resolved = this.effectResolver.resolveAll(characterId, targets);
      for (const key of Object.keys(targets)) {
        // 只改写确实被加成影响的字段，保持未受影响字段的原值
        if (resolved[key] !== targets[key]) {
          statsWithAttributes[key] = Math.floor(resolved[key]);
        }
      }

      // 添加特化特殊效果（保留旧字段供未迁移系统使用）
      statsWithAttributes.specializationBonuses = bonuses;
    }
    
    // 添加兵种类型
    statsWithAttributes.unitType = this.getCharacterUnitType(characterId);
    
    return statsWithAttributes;
  }
  
  /**
   * 将兵种特化加成同步为 EffectResolver 的一个来源
   * @private
   * @param {string} characterId - 角色ID
   * @param {SpecializationData} specialization - 特化数据
   * @returns {string} 来源标识
   */
  _syncSpecializationSource(characterId, specialization) {
    const sourceId = `specialization:${specialization.id}`;

    // 同一角色只保留当前特化来源；不得按 kind 删除职业固定来源。
    for (const source of this.effectResolver.getSources(characterId)) {
      if (String(source.id || '').startsWith('specialization:')) {
        this.effectResolver.removeSource(characterId, source.id);
      }
    }

    this.effectResolver.addSource(characterId, EffectSource.fromLegacy(
      sourceId,
      EffectSourceKind.CLASS,
      specialization.bonuses || {}
    ));

    return sourceId;
  }

  /**
   * 查询某个属性的最终来源明细，用于验证“职业修正为基线、其余来源叠加”
   * @param {string} characterId - 角色ID
   * @param {string} target - 目标属性名
   * @param {number} [baseValue] - 基线值
   * @returns {Object}
   */
  explainStat(characterId, target, baseValue = 0) {
    return this.effectResolver.explain(characterId, target, baseValue);
  }

  /**
   * 角色升级
   * @param {string} characterId - 角色ID
   * @param {number} newLevel - 新等级
   */
  onLevelUp(characterId, newLevel) {
    // 给予属性点
    this.attributeSystem.onLevelUp(characterId, newLevel);
    
    Logger.log(`角色 ${characterId} 升级到 ${newLevel} 级`);
  }
  
  /**
   * 重置技能树
   * @param {string} characterId - 角色ID
   * @param {Object} character - 角色数据
   * @returns {number} 返还的技能点
   */
  resetSkillTree(characterId, character) {
    const classType = this.getCharacterClass(characterId);
    if (!classType) {
      return 0;
    }
    
    character.class = classType;
    return this.skillTreeSystem.resetSkillTree(character);
  }
  
  /**
   * 重置属性点
   * @param {string} characterId - 角色ID
   * @returns {boolean} 是否成功
   */
  resetAttributes(characterId) {
    return this.attributeSystem.resetCharacterAttributes(characterId);
  }
  
  /**
   * 获取职业推荐属性
   * @param {string} classType - 职业类型
   * @returns {Object|null}
   */
  getRecommendedAttributes(classType) {
    const classData = this.getClassData(classType);
    if (!classData) {
      return null;
    }
    
    return classData.recommendedAttributes;
  }
  
  /**
   * 获取职业初始装备
   * @param {string} classType - 职业类型
   * @returns {Array}
   */
  getStartingEquipment(classType) {
    const classData = this.getClassData(classType);
    if (!classData) {
      return [];
    }
    
    return classData.startingEquipment;
  }
  
  /**
   * 检查是否可以选择特化
   * @param {string} characterId - 角色ID
   * @param {number} characterLevel - 角色等级
   * @returns {boolean}
   */
  canSelectSpecialization(characterId, characterLevel) {
    // 检查是否已经选择过特化
    if (this.characterSpecializations.has(characterId)) {
      return false;
    }
    
    const classData = this.getCharacterClassData(characterId);
    if (!classData || classData.specializations.length === 0) {
      return false;
    }
    
    // 检查等级要求
    const minLevel = Math.min(...classData.specializations.map(s => s.requiredLevel));
    return characterLevel >= minLevel;
  }
  
  /**
   * 获取可用的特化选项
   * @param {string} characterId - 角色ID
   * @param {number} characterLevel - 角色等级
   * @returns {Array<SpecializationData>}
   */
  getAvailableSpecializations(characterId, characterLevel) {
    const classData = this.getCharacterClassData(characterId);
    if (!classData) {
      return [];
    }
    
    return classData.specializations.filter(s => characterLevel >= s.requiredLevel);
  }
  
  /**
   * 获取教官信息
   * @param {string} classType - 职业类型
   * @returns {Object|null}
   */
  getInstructor(classType) {
    return ClassInstructors[classType] || null;
  }
  
  /**
   * 获取所有教官信息
   * @returns {Array<Object>}
   */
  getAllInstructors() {
    return Object.values(ClassInstructors);
  }
}

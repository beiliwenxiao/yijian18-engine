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

import { Logger } from '../core/Logger.js';

/**
 * AttributeSystem.js
 * 属性点分配系统 - 管理角色的五大属性点分配和效果计算
 */

/**
 * 属性类型枚举
 */
export const AttributeType = {
  STRENGTH: 'strength',     // 力量 - 影响攻击力和负重
  AGILITY: 'agility',       // 敏捷 - 影响攻击速度和闪避
  INTELLIGENCE: 'intelligence', // 智力 - 影响魔法攻击和法力值
  CONSTITUTION: 'constitution', // 体质 - 影响生命值和防御力
  SPIRIT: 'spirit'          // 精神 - 影响法力回复和抗性
};

/**
 * 属性数据类
 */
export class AttributeData {
  /**
   * @param {Object} config - 属性配置
   */
  constructor(config = {}) {
    // 五大基础属性
    this.strength = config.strength || 10;
    this.agility = config.agility || 10;
    this.intelligence = config.intelligence || 10;
    this.constitution = config.constitution || 10;
    this.spirit = config.spirit || 10;
    
    // 可用属性点
    this.availablePoints = config.availablePoints || 0;
    
    // 总投入点数（用于重置计算）- 计算当前超过基础值10的点数
    const initialInvested = Math.max(0, this.strength - 10) + 
                           Math.max(0, this.agility - 10) + 
                           Math.max(0, this.intelligence - 10) + 
                           Math.max(0, this.constitution - 10) + 
                           Math.max(0, this.spirit - 10);
    this.totalInvestedPoints = config.totalInvestedPoints || initialInvested;
  }

  /**
   * 获取属性值
   * @param {string} attributeType - 属性类型
   * @returns {number}
   */
  getAttribute(attributeType) {
    return this[attributeType] || 0;
  }

  /**
   * 设置属性值
   * @param {string} attributeType - 属性类型
   * @param {number} value - 属性值
   */
  setAttribute(attributeType, value) {
    if (this.hasOwnProperty(attributeType)) {
      this[attributeType] = Math.max(0, value);
    }
  }

  /**
   * 增加属性点
   * @param {string} attributeType - 属性类型
   * @param {number} points - 增加的点数
   * @returns {boolean} 是否成功
   */
  addAttribute(attributeType, points = 1) {
    if (this.availablePoints >= points && points > 0) {
      this.setAttribute(attributeType, this.getAttribute(attributeType) + points);
      this.availablePoints -= points;
      this.totalInvestedPoints += points;
      return true;
    }
    return false;
  }

  /**
   * 获取所有属性
   * @returns {Object}
   */
  getAllAttributes() {
    return {
      strength: this.strength,
      agility: this.agility,
      intelligence: this.intelligence,
      constitution: this.constitution,
      spirit: this.spirit
    };
  }

  /**
   * 重置所有属性点
   */
  resetAttributes() {
    // 计算当前已分配的点数（超过基础值10的部分）
    const currentInvested = Math.max(0, this.strength - 10) + 
                           Math.max(0, this.agility - 10) + 
                           Math.max(0, this.intelligence - 10) + 
                           Math.max(0, this.constitution - 10) + 
                           Math.max(0, this.spirit - 10);
    
    // 返还所有投入的点数
    this.availablePoints += currentInvested;
    this.totalInvestedPoints = 0;
    
    // 重置为基础值
    this.strength = 10;
    this.agility = 10;
    this.intelligence = 10;
    this.constitution = 10;
    this.spirit = 10;
  }

  /**
   * 添加可用属性点
   * @param {number} points - 点数
   */
  addAvailablePoints(points) {
    this.availablePoints += points;
  }
}

/**
 * 属性效果计算器
 */
export class AttributeEffectCalculator {
  /**
   * 计算力量对战斗属性的影响
   * @param {number} strength - 力量值
   * @returns {Object} 力量效果
   */
  static calculateStrengthEffects(strength) {
    return {
      attackBonus: Math.floor(strength * 0.8), // 每点力量增加0.8攻击力
      carryCapacityBonus: strength * 5,        // 每点力量增加5负重
      weaponDamageMultiplier: 1 + (strength - 10) * 0.02 // 每点力量增加2%武器伤害
    };
  }

  /**
   * 计算敏捷对战斗属性的影响
   * @param {number} agility - 敏捷值
   * @returns {Object} 敏捷效果
   */
  static calculateAgilityEffects(agility) {
    return {
      speedBonus: Math.floor(agility * 1.5),   // 每点敏捷增加1.5移动速度
      attackSpeedBonus: (agility - 10) * 0.03, // 每点敏捷增加3%攻击速度
      dodgeChance: Math.min((agility - 10) * 0.005, 0.3), // 每点敏捷增加0.5%闪避，最大30%
      criticalChance: Math.min((agility - 10) * 0.003, 0.2) // 每点敏捷增加0.3%暴击，最大20%
    };
  }

  /**
   * 计算智力对战斗属性的影响
   * @param {number} intelligence - 智力值
   * @returns {Object} 智力效果
   */
  static calculateIntelligenceEffects(intelligence) {
    return {
      magicAttackBonus: Math.floor(intelligence * 1.2), // 每点智力增加1.2魔法攻击
      maxManaBonus: intelligence * 8,                   // 每点智力增加8最大法力值
      spellDamageMultiplier: 1 + (intelligence - 10) * 0.025, // 每点智力增加2.5%法术伤害
      elementAttackBonus: Math.floor(intelligence * 0.5) // 每点智力增加0.5元素攻击力
    };
  }

  /**
   * 计算体质对战斗属性的影响
   * @param {number} constitution - 体质值
   * @returns {Object} 体质效果
   */
  static calculateConstitutionEffects(constitution) {
    return {
      maxHpBonus: constitution * 12,                    // 每点体质增加12最大生命值
      defenseBonus: Math.floor(constitution * 0.6),     // 每点体质增加0.6防御力
      hpRegenBonus: Math.floor(constitution * 0.3),     // 每点体质增加0.3生命回复
      damageReduction: Math.min((constitution - 10) * 0.002, 0.15) // 每点体质增加0.2%伤害减免，最大15%
    };
  }

  /**
   * 计算精神对战斗属性的影响
   * @param {number} spirit - 精神值
   * @returns {Object} 精神效果
   */
  static calculateSpiritEffects(spirit) {
    return {
      manaRegenBonus: Math.floor(spirit * 0.8),         // 每点精神增加0.8法力回复
      statusResistance: Math.min((spirit - 10) * 0.01, 0.5), // 每点精神增加1%状态抗性，最大50%
      elementDefenseBonus: Math.floor(spirit * 0.4),    // 每点精神增加0.4元素防御力
      spellCooldownReduction: Math.min((spirit - 10) * 0.005, 0.25) // 每点精神减少0.5%技能冷却，最大25%
    };
  }

  /**
   * 计算所有属性的综合效果
   * @param {AttributeData} attributeData - 属性数据
   * @returns {Object} 综合效果
   */
  static calculateTotalEffects(attributeData) {
    const effects = {
      // 基础战斗属性
      attackBonus: 0,
      defenseBonus: 0,
      maxHpBonus: 0,
      maxManaBonus: 0,
      speedBonus: 0,
      hpRegenBonus: 0,
      manaRegenBonus: 0,
      
      // 伤害和防御倍率
      weaponDamageMultiplier: 1,
      spellDamageMultiplier: 1,
      damageReduction: 0,
      
      // 特殊属性
      attackSpeedBonus: 0,
      dodgeChance: 0,
      criticalChance: 0,
      statusResistance: 0,
      spellCooldownReduction: 0,
      
      // 元素属性
      elementAttackBonus: 0,
      elementDefenseBonus: 0,
      
      // 其他
      carryCapacityBonus: 0
    };

    // 力量效果
    const strengthEffects = this.calculateStrengthEffects(attributeData.strength);
    effects.attackBonus += strengthEffects.attackBonus;
    effects.carryCapacityBonus += strengthEffects.carryCapacityBonus;
    effects.weaponDamageMultiplier *= strengthEffects.weaponDamageMultiplier;

    // 敏捷效果
    const agilityEffects = this.calculateAgilityEffects(attributeData.agility);
    effects.speedBonus += agilityEffects.speedBonus;
    effects.attackSpeedBonus += agilityEffects.attackSpeedBonus;
    effects.dodgeChance += agilityEffects.dodgeChance;
    effects.criticalChance += agilityEffects.criticalChance;

    // 智力效果
    const intelligenceEffects = this.calculateIntelligenceEffects(attributeData.intelligence);
    effects.attackBonus += intelligenceEffects.magicAttackBonus; // 魔法攻击也算入总攻击
    effects.maxManaBonus += intelligenceEffects.maxManaBonus;
    effects.spellDamageMultiplier *= intelligenceEffects.spellDamageMultiplier;
    effects.elementAttackBonus += intelligenceEffects.elementAttackBonus;

    // 体质效果
    const constitutionEffects = this.calculateConstitutionEffects(attributeData.constitution);
    effects.maxHpBonus += constitutionEffects.maxHpBonus;
    effects.defenseBonus += constitutionEffects.defenseBonus;
    effects.hpRegenBonus += constitutionEffects.hpRegenBonus;
    effects.damageReduction += constitutionEffects.damageReduction;

    // 精神效果
    const spiritEffects = this.calculateSpiritEffects(attributeData.spirit);
    effects.manaRegenBonus += spiritEffects.manaRegenBonus;
    effects.statusResistance += spiritEffects.statusResistance;
    effects.elementDefenseBonus += spiritEffects.elementDefenseBonus;
    effects.spellCooldownReduction += spiritEffects.spellCooldownReduction;

    return effects;
  }
}

/**
 * 属性系统主类
 */
export class AttributeSystem {
  constructor() {
    this.attributeData = new Map(); // 存储各角色的属性数据
  }

  /**
   * 初始化角色属性
   * @param {string} characterId - 角色ID
   * @param {Object} config - 初始配置
   */
  initializeCharacterAttributes(characterId, config = {}) {
    const attributeData = new AttributeData(config);
    this.attributeData.set(characterId, attributeData);
    return attributeData;
  }

  /**
   * 获取角色属性数据
   * @param {string} characterId - 角色ID
   * @returns {AttributeData|null}
   */
  getCharacterAttributes(characterId) {
    return this.attributeData.get(characterId) || null;
  }

  /**
   * 角色升级时获得属性点
   * @param {string} characterId - 角色ID
   * @param {number} level - 新等级
   */
  onLevelUp(characterId, level) {
    const attributeData = this.getCharacterAttributes(characterId);
    if (!attributeData) {
      console.warn(`角色 ${characterId} 的属性数据不存在`);
      return;
    }

    // 每级获得5个属性点
    const pointsGained = 5;
    attributeData.addAvailablePoints(pointsGained);
    
    Logger.log(`角色 ${characterId} 升级到 ${level} 级，获得 ${pointsGained} 属性点`);
  }

  /**
   * 分配属性点
   * @param {string} characterId - 角色ID
   * @param {string} attributeType - 属性类型
   * @param {number} points - 点数
   * @returns {boolean} 是否成功
   */
  allocateAttribute(characterId, attributeType, points = 1) {
    const attributeData = this.getCharacterAttributes(characterId);
    if (!attributeData) {
      console.warn(`角色 ${characterId} 的属性数据不存在`);
      return false;
    }

    if (!Object.values(AttributeType).includes(attributeType)) {
      console.warn(`无效的属性类型: ${attributeType}`);
      return false;
    }

    return attributeData.addAttribute(attributeType, points);
  }

  /**
   * 重置角色属性点
   * @param {string} characterId - 角色ID
   * @returns {boolean} 是否成功
   */
  resetCharacterAttributes(characterId) {
    const attributeData = this.getCharacterAttributes(characterId);
    if (!attributeData) {
      console.warn(`角色 ${characterId} 的属性数据不存在`);
      return false;
    }

    attributeData.resetAttributes();
    Logger.log(`角色 ${characterId} 的属性点已重置`);
    return true;
  }

  /**
   * 计算角色的属性效果
   * @param {string} characterId - 角色ID
   * @returns {Object|null} 属性效果
   */
  calculateCharacterEffects(characterId) {
    const attributeData = this.getCharacterAttributes(characterId);
    if (!attributeData) {
      return null;
    }

    return AttributeEffectCalculator.calculateTotalEffects(attributeData);
  }

  /**
   * 应用属性效果到角色统计数据
   * @param {string} characterId - 角色ID
   * @param {Object} baseStats - 基础属性
   * @returns {Object} 应用效果后的属性
   */
  applyAttributeEffects(characterId, baseStats) {
    const effects = this.calculateCharacterEffects(characterId);
    if (!effects) {
      return { ...baseStats };
    }

    const modifiedStats = { ...baseStats };

    // 应用加成效果
    modifiedStats.attack = Math.floor((modifiedStats.attack + effects.attackBonus) * effects.weaponDamageMultiplier);
    modifiedStats.defense = modifiedStats.defense + effects.defenseBonus;
    modifiedStats.maxHp = modifiedStats.maxHp + effects.maxHpBonus;
    modifiedStats.maxMp = modifiedStats.maxMp + effects.maxManaBonus;
    modifiedStats.speed = modifiedStats.speed + effects.speedBonus;

    // 确保当前HP/MP不超过最大值
    if (modifiedStats.hp > modifiedStats.maxHp) {
      modifiedStats.hp = modifiedStats.maxHp;
    }
    if (modifiedStats.mp > modifiedStats.maxMp) {
      modifiedStats.mp = modifiedStats.maxMp;
    }

    // 添加特殊效果（用于其他系统使用）
    modifiedStats.attributeEffects = effects;

    return modifiedStats;
  }

  /**
   * 获取属性描述信息
   * @param {string} attributeType - 属性类型
   * @returns {Object} 属性描述
   */
  getAttributeDescription(attributeType) {
    const descriptions = {
      [AttributeType.STRENGTH]: {
        name: '力量',
        description: '影响物理攻击力和负重能力',
        effects: [
          '每点增加0.8攻击力',
          '每点增加5负重',
          '每点增加2%武器伤害'
        ]
      },
      [AttributeType.AGILITY]: {
        name: '敏捷',
        description: '影响攻击速度、移动速度和闪避能力',
        effects: [
          '每点增加1.5移动速度',
          '每点增加3%攻击速度',
          '每点增加0.5%闪避率（最大30%）',
          '每点增加0.3%暴击率（最大20%）'
        ]
      },
      [AttributeType.INTELLIGENCE]: {
        name: '智力',
        description: '影响魔法攻击力和法力值',
        effects: [
          '每点增加1.2魔法攻击',
          '每点增加8最大法力值',
          '每点增加2.5%法术伤害',
          '每点增加0.5元素攻击力'
        ]
      },
      [AttributeType.CONSTITUTION]: {
        name: '体质',
        description: '影响生命值和防御能力',
        effects: [
          '每点增加12最大生命值',
          '每点增加0.6防御力',
          '每点增加0.3生命回复',
          '每点增加0.2%伤害减免（最大15%）'
        ]
      },
      [AttributeType.SPIRIT]: {
        name: '精神',
        description: '影响法力回复和状态抗性',
        effects: [
          '每点增加0.8法力回复',
          '每点增加1%状态抗性（最大50%）',
          '每点增加0.4元素防御力',
          '每点减少0.5%技能冷却（最大25%）'
        ]
      }
    };

    return descriptions[attributeType] || null;
  }

  /**
   * 获取所有属性描述
   * @returns {Object} 所有属性描述
   */
  getAllAttributeDescriptions() {
    const descriptions = {};
    for (const attributeType of Object.values(AttributeType)) {
      descriptions[attributeType] = this.getAttributeDescription(attributeType);
    }
    return descriptions;
  }
}
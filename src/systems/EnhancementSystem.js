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
 * EnhancementSystem.js
 * 装备强化系统 - 管理装备强化和品质提升
 */

/**
 * 强化结果枚举
 */
export const EnhancementResult = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  DESTROYED: 'destroyed'
};

/**
 * 强化材料定义
 */
export const EnhancementMaterials = {
  // 基础强化石
  basic_stone: {
    id: 'basic_stone',
    name: '基础强化石',
    description: '用于强化+1到+3的装备',
    maxLevel: 3,
    successBonus: 0,
    protectionLevel: 0
  },
  
  // 中级强化石
  intermediate_stone: {
    id: 'intermediate_stone',
    name: '中级强化石',
    description: '用于强化+4到+6的装备',
    maxLevel: 6,
    successBonus: 0.1,
    protectionLevel: 0
  },
  
  // 高级强化石
  advanced_stone: {
    id: 'advanced_stone',
    name: '高级强化石',
    description: '用于强化+7到+9的装备',
    maxLevel: 9,
    successBonus: 0.2,
    protectionLevel: 0
  },
  
  // 保护符
  protection_scroll: {
    id: 'protection_scroll',
    name: '保护符',
    description: '防止装备在强化失败时损坏',
    maxLevel: 15,
    successBonus: 0,
    protectionLevel: 1
  },
  
  // 祝福符
  blessing_scroll: {
    id: 'blessing_scroll',
    name: '祝福符',
    description: '提高强化成功率',
    maxLevel: 15,
    successBonus: 0.3,
    protectionLevel: 0
  }
};

/**
 * 装备强化系统
 */
export class EnhancementSystem {
  constructor(mockDataService, rng = null) {
    this.name = 'EnhancementSystem';
    this.mockDataService = mockDataService;
    // 强化随机：注入 rng（RNG 实例）时走确定性序列，否则退化为 Math.random
    this.rng = rng;
    
    // 强化配置
    this.config = {
      maxEnhancementLevel: 15,
      baseSuccessRate: 1.0, // 基础成功率
      successRateDecay: 0.1, // 每级成功率衰减
      minSuccessRate: 0.01, // 最小成功率
      destructionStartLevel: 7, // 开始有损坏风险的等级
      destructionRate: 0.1, // 基础损坏率
      costMultiplier: 1.5, // 强化费用倍数
      baseCost: 100 // 基础强化费用
    };
    
    // 强化效果配置
    this.enhancementEffects = {
      // 每级强化的属性提升百分比
      statBonus: 0.1, // 10%
      // 特殊等级的额外奖励
      specialLevels: {
        5: { bonus: 0.05, effect: 'glow' },
        10: { bonus: 0.1, effect: 'sparkle' },
        15: { bonus: 0.2, effect: 'legendary_aura' }
      }
    };
  }

  /** [0,1) 强化随机，注入 rng 时确定可复现 */
  _rng() {
    return this.rng ? this.rng.next() : Math.random();
  }

  /**
   * 计算强化成功率
   * @param {Object} equipment - 装备数据
   * @param {Array} materials - 强化材料
   * @returns {number} 成功率 (0-1)
   */
  calculateSuccessRate(equipment, materials = []) {
    const currentLevel = equipment.enhancement || 0;
    
    // 基础成功率计算
    let successRate = this.config.baseSuccessRate - (currentLevel * this.config.successRateDecay);
    successRate = Math.max(successRate, this.config.minSuccessRate);
    
    // 材料加成
    for (const material of materials) {
      const materialData = EnhancementMaterials[material.id];
      if (materialData && currentLevel <= materialData.maxLevel) {
        successRate += materialData.successBonus;
      }
    }
    
    // 装备品质影响
    const qualityBonus = {
      0: 0,    // 普通
      1: 0.05, // 不凡
      2: 0.1,  // 稀有
      3: 0.15, // 史诗
      4: 0.2   // 传说
    };
    successRate += qualityBonus[equipment.quality] || 0;
    
    return Math.min(successRate, 1.0);
  }

  /**
   * 计算强化费用
   * @param {Object} equipment - 装备数据
   * @returns {number} 强化费用
   */
  calculateEnhancementCost(equipment) {
    const currentLevel = equipment.enhancement || 0;
    const baseCost = this.config.baseCost * (equipment.level || 1);
    return Math.floor(baseCost * Math.pow(this.config.costMultiplier, currentLevel));
  }

  /**
   * 计算损坏概率
   * @param {Object} equipment - 装备数据
   * @param {Array} materials - 强化材料
   * @returns {number} 损坏概率 (0-1)
   */
  calculateDestructionRate(equipment, materials = []) {
    const currentLevel = equipment.enhancement || 0;
    
    if (currentLevel < this.config.destructionStartLevel) {
      return 0; // 低等级不会损坏
    }
    
    let destructionRate = this.config.destructionRate * (currentLevel - this.config.destructionStartLevel + 1);
    
    // 检查保护材料
    const hasProtection = materials.some(material => {
      const materialData = EnhancementMaterials[material.id];
      return materialData && materialData.protectionLevel > 0;
    });
    
    if (hasProtection) {
      destructionRate = 0;
    }
    
    return Math.min(destructionRate, 0.5); // 最大50%损坏率
  }

  /**
   * 强化装备
   * @param {Object} equipment - 装备数据
   * @param {Array} materials - 强化材料
   * @param {number} gold - 玩家金币
   * @returns {Object} 强化结果
   */
  enhanceEquipment(equipment, materials = [], gold = 0) {
    const currentLevel = equipment.enhancement || 0;
    
    // 检查是否达到最大等级
    if (currentLevel >= this.config.maxEnhancementLevel) {
      return {
        result: EnhancementResult.FAILURE,
        message: '装备已达到最大强化等级',
        equipment: equipment,
        cost: 0
      };
    }
    
    // 计算费用
    const cost = this.calculateEnhancementCost(equipment);
    if (gold < cost) {
      return {
        result: EnhancementResult.FAILURE,
        message: '金币不足',
        equipment: equipment,
        cost: cost
      };
    }
    
    // 验证材料
    const materialValidation = this.validateMaterials(equipment, materials);
    if (!materialValidation.valid) {
      return {
        result: EnhancementResult.FAILURE,
        message: materialValidation.message,
        equipment: equipment,
        cost: 0
      };
    }
    
    // 计算成功率和损坏率
    const successRate = this.calculateSuccessRate(equipment, materials);
    const destructionRate = this.calculateDestructionRate(equipment, materials);
    
    // 执行强化
    const random = this._rng();
    
    if (random < successRate) {
      // 强化成功
      const enhancedEquipment = this.applyEnhancement(equipment);
      
      return {
        result: EnhancementResult.SUCCESS,
        message: `强化成功！装备等级提升至 +${enhancedEquipment.enhancement}`,
        equipment: enhancedEquipment,
        cost: cost,
        successRate: successRate,
        destructionRate: destructionRate
      };
    } else if (random < successRate + destructionRate) {
      // 装备损坏
      return {
        result: EnhancementResult.DESTROYED,
        message: '强化失败，装备已损坏！',
        equipment: null,
        cost: cost,
        successRate: successRate,
        destructionRate: destructionRate
      };
    } else {
      // 强化失败但装备保持
      return {
        result: EnhancementResult.FAILURE,
        message: '强化失败，装备等级保持不变',
        equipment: equipment,
        cost: cost,
        successRate: successRate,
        destructionRate: destructionRate
      };
    }
  }

  /**
   * 验证强化材料
   * @param {Object} equipment - 装备数据
   * @param {Array} materials - 强化材料
   * @returns {Object} 验证结果
   */
  validateMaterials(equipment, materials) {
    const currentLevel = equipment.enhancement || 0;
    
    // 检查是否有合适的强化石
    const hasValidStone = materials.some(material => {
      const materialData = EnhancementMaterials[material.id];
      return materialData && currentLevel < materialData.maxLevel;
    });
    
    if (!hasValidStone) {
      return {
        valid: false,
        message: '需要合适等级的强化石'
      };
    }
    
    return { valid: true };
  }

  /**
   * 应用强化效果
   * @param {Object} equipment - 装备数据
   * @returns {Object} 强化后的装备
   */
  applyEnhancement(equipment) {
    const enhancedEquipment = { ...equipment };
    const newLevel = (equipment.enhancement || 0) + 1;
    
    enhancedEquipment.enhancement = newLevel;
    
    // 重新计算属性
    this.recalculateStats(enhancedEquipment);
    
    // 应用特殊效果
    if (this.enhancementEffects.specialLevels[newLevel]) {
      const specialEffect = this.enhancementEffects.specialLevels[newLevel];
      enhancedEquipment.specialEffect = specialEffect.effect;
    }
    
    return enhancedEquipment;
  }

  /**
   * 重新计算装备属性
   * @param {Object} equipment - 装备数据
   */
  recalculateStats(equipment) {
    const baseStats = { ...equipment.baseStats || equipment.stats };
    const enhancementLevel = equipment.enhancement || 0;
    
    // 计算强化加成
    const bonusMultiplier = 1 + (enhancementLevel * this.enhancementEffects.statBonus);
    
    // 应用特殊等级奖励
    let specialBonus = 0;
    for (const level in this.enhancementEffects.specialLevels) {
      if (enhancementLevel >= parseInt(level)) {
        specialBonus += this.enhancementEffects.specialLevels[level].bonus;
      }
    }
    
    const totalMultiplier = bonusMultiplier + specialBonus;
    
    // 更新属性
    equipment.stats = {};
    for (const stat in baseStats) {
      if (typeof baseStats[stat] === 'number') {
        equipment.stats[stat] = Math.floor(baseStats[stat] * totalMultiplier);
      } else if (typeof baseStats[stat] === 'object') {
        equipment.stats[stat] = {};
        for (const subStat in baseStats[stat]) {
          equipment.stats[stat][subStat] = Math.floor(baseStats[stat][subStat] * totalMultiplier);
        }
      }
    }
  }

  /**
   * 获取强化预览信息
   * @param {Object} equipment - 装备数据
   * @param {Array} materials - 强化材料
   * @returns {Object} 预览信息
   */
  getEnhancementPreview(equipment, materials = []) {
    const currentLevel = equipment.enhancement || 0;
    const cost = this.calculateEnhancementCost(equipment);
    const successRate = this.calculateSuccessRate(equipment, materials);
    const destructionRate = this.calculateDestructionRate(equipment, materials);
    
    // 预览强化后的属性
    const previewEquipment = { ...equipment };
    previewEquipment.enhancement = currentLevel + 1;
    this.recalculateStats(previewEquipment);
    
    return {
      currentLevel: currentLevel,
      nextLevel: currentLevel + 1,
      cost: cost,
      successRate: successRate,
      destructionRate: destructionRate,
      currentStats: equipment.stats,
      previewStats: previewEquipment.stats,
      canEnhance: currentLevel < this.config.maxEnhancementLevel,
      requiredMaterials: this.getRequiredMaterials(currentLevel)
    };
  }

  /**
   * 获取所需材料
   * @param {number} currentLevel - 当前强化等级
   * @returns {Array} 所需材料列表
   */
  getRequiredMaterials(currentLevel) {
    const materials = [];
    
    if (currentLevel < 3) {
      materials.push({ id: 'basic_stone', name: '基础强化石' });
    } else if (currentLevel < 6) {
      materials.push({ id: 'intermediate_stone', name: '中级强化石' });
    } else {
      materials.push({ id: 'advanced_stone', name: '高级强化石' });
    }
    
    if (currentLevel >= this.config.destructionStartLevel) {
      materials.push({ id: 'protection_scroll', name: '保护符 (可选)' });
    }
    
    materials.push({ id: 'blessing_scroll', name: '祝福符 (可选)' });
    
    return materials;
  }

  /**
   * 获取强化等级显示文本
   * @param {number} level - 强化等级
   * @returns {string}
   */
  getEnhancementDisplayText(level) {
    if (level <= 0) return '';
    return `+${level}`;
  }

  /**
   * 获取强化等级颜色
   * @param {number} level - 强化等级
   * @returns {string}
   */
  getEnhancementColor(level) {
    if (level <= 0) return '#ffffff';
    if (level <= 3) return '#00ff00';
    if (level <= 6) return '#0080ff';
    if (level <= 9) return '#8000ff';
    if (level <= 12) return '#ff8000';
    return '#ff0000';
  }
}
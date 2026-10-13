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
 * UnitSystem.js
 * 兵种升级系统 - 处理兵种相克、升级和战斗加成计算
 */

/**
 * 兵种类型定义 (升级体系)
 */
export const UnitTypes = {
  // 步兵升级链 (三级)
  SWORD_SHIELD: 0,     // 刀盾步兵 (基础)
  LIGHT_INFANTRY: 1,   // 轻甲步兵 (一级升级)
  HEAVY_INFANTRY: 2,   // 重甲步兵 (二级升级，最强步兵)
  
  // 远程兵升级链 (分支升级)
  ARCHER_CROSSBOW: 3,  // 弓弩兵 (基础，合并弓箭兵和弩兵)
  MOUNTED_ARCHER: 4,   // 弓骑兵 (骑射分支)
  REPEATING_CROSSBOW: 5, // 连弩步兵 (步射分支)
  
  // 枪骑升级链 (三级)
  SPEARMAN: 6,         // 长枪兵 (基础)
  LIGHT_CAVALRY: 7,    // 轻骑兵 (一级升级)
  HEAVY_CAVALRY: 8     // 重甲骑兵 (二级升级，最强骑兵)
};

/**
 * 兵种名称映射
 */
export const UnitNames = {
  [UnitTypes.SWORD_SHIELD]: '刀盾步兵',
  [UnitTypes.LIGHT_INFANTRY]: '轻甲步兵',
  [UnitTypes.HEAVY_INFANTRY]: '重甲步兵',
  [UnitTypes.ARCHER_CROSSBOW]: '弓弩兵',
  [UnitTypes.MOUNTED_ARCHER]: '弓骑兵',
  [UnitTypes.REPEATING_CROSSBOW]: '连弩步兵',
  [UnitTypes.SPEARMAN]: '长枪兵',
  [UnitTypes.LIGHT_CAVALRY]: '轻骑兵',
  [UnitTypes.HEAVY_CAVALRY]: '重甲骑兵'
};

/**
 * 兵种升级关系
 */
export const UnitUpgrades = {
  // 步兵线性升级
  [UnitTypes.SWORD_SHIELD]: UnitTypes.LIGHT_INFANTRY,
  [UnitTypes.LIGHT_INFANTRY]: UnitTypes.HEAVY_INFANTRY,
  
  // 远程兵分支升级
  [UnitTypes.ARCHER_CROSSBOW]: [UnitTypes.MOUNTED_ARCHER, UnitTypes.REPEATING_CROSSBOW],
  
  // 枪骑线性升级
  [UnitTypes.SPEARMAN]: UnitTypes.LIGHT_CAVALRY,
  [UnitTypes.LIGHT_CAVALRY]: UnitTypes.HEAVY_CAVALRY
};

/**
 * 兵种相克关系 (攻击兵种 -> 被克制的兵种列表)
 * 重甲兵种无克制关系
 */
export const UnitCounters = {
  // 枪兵克轻骑兵 (长武器克冲锋)
  [UnitTypes.SPEARMAN]: [UnitTypes.LIGHT_CAVALRY],
  
  // 轻骑兵克远程兵 (机动性克远程)
  [UnitTypes.LIGHT_CAVALRY]: [UnitTypes.ARCHER_CROSSBOW, UnitTypes.MOUNTED_ARCHER, UnitTypes.REPEATING_CROSSBOW],
  
  // 远程兵克步兵 (远程克近战)
  [UnitTypes.ARCHER_CROSSBOW]: [UnitTypes.SWORD_SHIELD, UnitTypes.LIGHT_INFANTRY],
  [UnitTypes.MOUNTED_ARCHER]: [UnitTypes.SWORD_SHIELD, UnitTypes.LIGHT_INFANTRY],
  [UnitTypes.REPEATING_CROSSBOW]: [UnitTypes.SWORD_SHIELD, UnitTypes.LIGHT_INFANTRY],
  
  // 步兵克枪兵 (灵活性克长武器)
  [UnitTypes.SWORD_SHIELD]: [UnitTypes.SPEARMAN],
  [UnitTypes.LIGHT_INFANTRY]: [UnitTypes.SPEARMAN]
  
  // 重甲兵种无克制关系 (最强兵种)
  // UnitTypes.HEAVY_INFANTRY 和 UnitTypes.HEAVY_CAVALRY 没有被克制
};

/**
 * 兵种相克倍率表 (预计算)
 * [攻击兵种][防御兵种] = 伤害系数
 */
export class UnitCounterTable {
  constructor() {
    // 初始化9x9的相克矩阵 (0-8对应9种兵种)
    this.counterMatrix = [];
    for (let i = 0; i < 9; i++) {
      this.counterMatrix[i] = new Array(9).fill(1.0); // 默认倍率为1.0
    }
    
    // 填充相克关系
    this.initializeCounterMatrix();
  }
  
  /**
   * 初始化相克矩阵
   */
  initializeCounterMatrix() {
    const counterMultiplier = 1.3; // 相克伤害倍率
    const resistMultiplier = 0.8; // 被克制时的伤害减免
    
    // 遍历所有相克关系
    for (const [attackUnit, defendUnits] of Object.entries(UnitCounters)) {
      const attackType = parseInt(attackUnit);
      
      for (const defendUnit of defendUnits) {
        // 攻击方对被克制方造成额外伤害
        this.counterMatrix[attackType][defendUnit] = counterMultiplier;
        // 被克制方对攻击方造成减少伤害
        this.counterMatrix[defendUnit][attackType] = resistMultiplier;
      }
    }
  }
  
  /**
   * 获取兵种相克倍率
   * @param {number} attackUnit - 攻击兵种类型
   * @param {number} defendUnit - 防御兵种类型
   * @returns {number} 伤害倍率
   */
  getCounterMultiplier(attackUnit, defendUnit) {
    if (attackUnit < 0 || attackUnit >= 9 || 
        defendUnit < 0 || defendUnit >= 9) {
      return 1.0;
    }
    
    return this.counterMatrix[attackUnit][defendUnit];
  }
}

/**
 * 兵种升级系统
 */
export class UnitSystem {
  constructor() {
    // 初始化相克表
    this.counterTable = new UnitCounterTable();
    
    Logger.log('UnitSystem: 兵种升级系统已初始化');
  }
  
  /**
   * 获取兵种名称
   * @param {number} unitType - 兵种类型
   * @returns {string} 兵种名称
   */
  getUnitName(unitType) {
    return UnitNames[unitType] || '未知兵种';
  }
  
  /**
   * 检查兵种是否可以升级
   * @param {number} unitType - 兵种类型
   * @returns {boolean} 是否可以升级
   */
  canUpgradeUnit(unitType) {
    return UnitUpgrades.hasOwnProperty(unitType);
  }
  
  /**
   * 获取兵种升级选项
   * @param {number} unitType - 基础兵种类型
   * @returns {Array<number>|number|null} 升级后的兵种类型，如果无法升级返回null
   */
  getUpgradeOptions(unitType) {
    const upgrade = UnitUpgrades[unitType];
    if (!upgrade) return null;
    
    // 如果是数组，说明有多个升级选项（分支升级）
    if (Array.isArray(upgrade)) {
      return upgrade;
    }
    
    // 否则是单一升级选项（线性升级）
    return [upgrade];
  }
  
  /**
   * 升级兵种
   * @param {number} unitType - 基础兵种类型
   * @param {number} upgradeIndex - 升级选项索引（用于分支升级）
   * @returns {number|null} 升级后的兵种类型，如果无法升级返回null
   */
  upgradeUnit(unitType, upgradeIndex = 0) {
    const options = this.getUpgradeOptions(unitType);
    if (!options || upgradeIndex >= options.length) {
      return null;
    }
    
    return options[upgradeIndex];
  }
  
  /**
   * 计算兵种战斗加成
   * @param {Object} attacker - 攻击者属性
   * @param {Object} defender - 防御者属性
   * @param {number} baseDamage - 基础伤害
   * @returns {number} 最终兵种加成伤害
   */
  calculateUnitDamage(attacker, defender, baseDamage) {
    // 获取攻击者和防御者的兵种类型
    const attackerUnitType = attacker.unitType || UnitTypes.SWORD_SHIELD; // 默认刀盾步兵
    const defenderUnitType = defender.unitType || UnitTypes.SWORD_SHIELD;
    
    // 获取相克倍率
    const counterMultiplier = this.counterTable.getCounterMultiplier(attackerUnitType, defenderUnitType);
    
    // 对基础伤害应用相克倍率
    const finalDamage = Math.floor(baseDamage * counterMultiplier);
    
    return Math.max(1, finalDamage);
  }
  
  /**
   * 获取兵种相克信息
   * @param {number} attackUnit - 攻击兵种
   * @param {number} defendUnit - 防御兵种
   * @returns {Object} 相克信息
   */
  getUnitCounterInfo(attackUnit, defendUnit) {
    const multiplier = this.counterTable.getCounterMultiplier(attackUnit, defendUnit);
    
    let relationship = 'normal';
    if (multiplier > 1.0) {
      relationship = 'advantage'; // 相克优势
    } else if (multiplier < 1.0) {
      relationship = 'disadvantage'; // 相克劣势
    }
    
    return {
      multiplier,
      relationship,
      attackUnitName: this.getUnitName(attackUnit),
      defendUnitName: this.getUnitName(defendUnit)
    };
  }
  
  /**
   * 获取兵种被克制的兵种列表
   * @param {number} unitType - 兵种类型
   * @returns {Array<number>} 被克制的兵种类型列表
   */
  getCounteredUnits(unitType) {
    return UnitCounters[unitType] || [];
  }
  
  /**
   * 检查兵种是否克制另一个兵种
   * @param {number} attackUnit - 攻击兵种
   * @param {number} defendUnit - 防御兵种
   * @returns {boolean} 是否克制
   */
  isUnitCountering(attackUnit, defendUnit) {
    const counteredUnits = this.getCounteredUnits(attackUnit);
    return counteredUnits.includes(defendUnit);
  }
  
  /**
   * 获取所有基础兵种
   * @returns {Array<number>} 基础兵种类型列表
   */
  getBaseUnits() {
    return [
      UnitTypes.SWORD_SHIELD,
      UnitTypes.ARCHER_CROSSBOW,
      UnitTypes.SPEARMAN
    ];
  }
  
  /**
   * 获取所有高级兵种
   * @returns {Array<number>} 高级兵种类型列表
   */
  getAdvancedUnits() {
    return [
      UnitTypes.LIGHT_INFANTRY,
      UnitTypes.HEAVY_INFANTRY,
      UnitTypes.MOUNTED_ARCHER,
      UnitTypes.REPEATING_CROSSBOW,
      UnitTypes.LIGHT_CAVALRY,
      UnitTypes.HEAVY_CAVALRY
    ];
  }
  
  /**
   * 检查兵种是否为基础兵种
   * @param {number} unitType - 兵种类型
   * @returns {boolean} 是否为基础兵种
   */
  isBaseUnit(unitType) {
    return this.getBaseUnits().includes(unitType);
  }
  
  /**
   * 检查兵种是否为高级兵种
   * @param {number} unitType - 兵种类型
   * @returns {boolean} 是否为高级兵种
   */
  isAdvancedUnit(unitType) {
    return this.getAdvancedUnits().includes(unitType);
  }
  
  /**
   * 检查兵种是否为重甲兵种（最强兵种）
   * @param {number} unitType - 兵种类型
   * @returns {boolean} 是否为重甲兵种
   */
  isHeavyUnit(unitType) {
    return unitType === UnitTypes.HEAVY_INFANTRY || unitType === UnitTypes.HEAVY_CAVALRY;
  }
  
  /**
   * 获取兵种的基础形态
   * @param {number} unitType - 兵种类型
   * @returns {number} 基础兵种类型
   */
  getBaseUnitType(unitType) {
    // 步兵系
    if (unitType === UnitTypes.LIGHT_INFANTRY || unitType === UnitTypes.HEAVY_INFANTRY) {
      return UnitTypes.SWORD_SHIELD;
    }
    
    // 远程系
    if (unitType === UnitTypes.MOUNTED_ARCHER || unitType === UnitTypes.REPEATING_CROSSBOW) {
      return UnitTypes.ARCHER_CROSSBOW;
    }
    
    // 枪骑系
    if (unitType === UnitTypes.LIGHT_CAVALRY || unitType === UnitTypes.HEAVY_CAVALRY) {
      return UnitTypes.SPEARMAN;
    }
    
    // 如果本身就是基础兵种，返回自己
    return unitType;
  }
  
  /**
   * 获取兵种升级路径
   * @param {number} unitType - 兵种类型
   * @returns {Array<number>} 升级路径
   */
  getUpgradePath(unitType) {
    const path = [unitType];
    let current = unitType;
    
    // 向前追溯到基础兵种
    while (!this.isBaseUnit(current)) {
      const baseType = this.getBaseUnitType(current);
      if (baseType !== current) {
        path.unshift(baseType);
        current = baseType;
      } else {
        break;
      }
    }
    
    return path;
  }
  
  /**
   * 获取兵种类别
   * @param {number} unitType - 兵种类型
   * @returns {string} 兵种类别
   */
  getUnitCategory(unitType) {
    // 步兵系
    if (unitType <= UnitTypes.HEAVY_INFANTRY) {
      return 'infantry';
    }
    
    // 远程系
    if (unitType <= UnitTypes.REPEATING_CROSSBOW) {
      return 'ranged';
    }
    
    // 枪骑系
    return 'cavalry';
  }
  
  /**
   * 获取兵种等级
   * @param {number} unitType - 兵种类型
   * @returns {number} 兵种等级 (1-3)
   */
  getUnitTier(unitType) {
    switch (unitType) {
      case UnitTypes.SWORD_SHIELD:
      case UnitTypes.ARCHER_CROSSBOW:
      case UnitTypes.SPEARMAN:
        return 1; // 基础兵种
        
      case UnitTypes.LIGHT_INFANTRY:
      case UnitTypes.MOUNTED_ARCHER:
      case UnitTypes.REPEATING_CROSSBOW:
      case UnitTypes.LIGHT_CAVALRY:
        return 2; // 一级升级
        
      case UnitTypes.HEAVY_INFANTRY:
      case UnitTypes.HEAVY_CAVALRY:
        return 3; // 二级升级（最强）
        
      default:
        return 1;
    }
  }
}
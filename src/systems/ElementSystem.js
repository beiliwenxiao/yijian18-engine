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
 * ElementSystem.js
 * 五行元素系统 - 处理元素相克、升级和伤害计算
 */

/**
 * 元素类型定义 (五行体系)
 */
export const ElementTypes = {
  // 火系升级链
  FIRE: 0,        // 火 (基础)
  EXPLOSION: 1,   // 爆 (火系升级)
  
  // 水系升级链  
  WATER: 2,       // 水 (基础)
  ICE: 3,         // 冰 (水系升级)
  
  // 金系升级链 (风电合并)
  WIND: 4,        // 风 (基础)
  ELECTRIC: 5,    // 电 (基础)
  STORM: 6,       // 暴风 (风系升级)
  THUNDER: 7,     // 雷电 (电系升级)
  THUNDERSTORM: 8, // 雷暴 (暴风+雷电合成)
  
  // 土系升级链
  EARTH: 9,       // 土 (基础)
  ROCKFALL: 10,   // 滚石 (土系升级)
  
  // 木系升级链
  WOOD: 11,       // 木 (基础)
  TIMBER: 12      // 落木 (木系升级)
};

/**
 * 元素名称映射
 */
export const ElementNames = {
  [ElementTypes.FIRE]: '火',
  [ElementTypes.EXPLOSION]: '爆',
  [ElementTypes.WATER]: '水',
  [ElementTypes.ICE]: '冰',
  [ElementTypes.WIND]: '风',
  [ElementTypes.ELECTRIC]: '电',
  [ElementTypes.STORM]: '暴风',
  [ElementTypes.THUNDER]: '雷电',
  [ElementTypes.THUNDERSTORM]: '雷暴',
  [ElementTypes.EARTH]: '土',
  [ElementTypes.ROCKFALL]: '滚石',
  [ElementTypes.WOOD]: '木',
  [ElementTypes.TIMBER]: '落木'
};

/**
 * 元素升级关系
 */
export const ElementUpgrades = {
  [ElementTypes.FIRE]: ElementTypes.EXPLOSION,
  [ElementTypes.WATER]: ElementTypes.ICE,
  [ElementTypes.WIND]: ElementTypes.STORM,
  [ElementTypes.ELECTRIC]: ElementTypes.THUNDER,
  [ElementTypes.EARTH]: ElementTypes.ROCKFALL,
  [ElementTypes.WOOD]: ElementTypes.TIMBER
};

/**
 * 元素合成关系 (特殊合成)
 */
export const ElementSynthesis = {
  // 暴风 + 雷电 = 雷暴
  [`${ElementTypes.STORM}_${ElementTypes.THUNDER}`]: ElementTypes.THUNDERSTORM,
  [`${ElementTypes.THUNDER}_${ElementTypes.STORM}`]: ElementTypes.THUNDERSTORM
};

/**
 * 五行相克关系 (攻击元素 -> 被克制的元素列表)
 */
export const ElementCounters = {
  // 火克木
  [ElementTypes.FIRE]: [ElementTypes.WOOD, ElementTypes.TIMBER],
  [ElementTypes.EXPLOSION]: [ElementTypes.WOOD, ElementTypes.TIMBER],
  
  // 木克土
  [ElementTypes.WOOD]: [ElementTypes.EARTH, ElementTypes.ROCKFALL],
  [ElementTypes.TIMBER]: [ElementTypes.EARTH, ElementTypes.ROCKFALL],
  
  // 土克水
  [ElementTypes.EARTH]: [ElementTypes.WATER, ElementTypes.ICE],
  [ElementTypes.ROCKFALL]: [ElementTypes.WATER, ElementTypes.ICE],
  
  // 水克火
  [ElementTypes.WATER]: [ElementTypes.FIRE, ElementTypes.EXPLOSION],
  [ElementTypes.ICE]: [ElementTypes.FIRE, ElementTypes.EXPLOSION],
  
  // 金(风电)克木
  [ElementTypes.WIND]: [ElementTypes.WOOD, ElementTypes.TIMBER],
  [ElementTypes.ELECTRIC]: [ElementTypes.WOOD, ElementTypes.TIMBER],
  [ElementTypes.STORM]: [ElementTypes.WOOD, ElementTypes.TIMBER],
  [ElementTypes.THUNDER]: [ElementTypes.WOOD, ElementTypes.TIMBER],
  [ElementTypes.THUNDERSTORM]: [ElementTypes.WOOD, ElementTypes.TIMBER]
};

/**
 * 元素相克倍率表 (预计算)
 * [攻击元素][防御元素] = 伤害系数
 */
export class ElementCounterTable {
  constructor() {
    // 初始化13x13的相克矩阵 (0-12对应13种元素)
    this.counterMatrix = [];
    for (let i = 0; i < 13; i++) {
      this.counterMatrix[i] = new Array(13).fill(1.0); // 默认倍率为1.0
    }
    
    // 填充相克关系
    this.initializeCounterMatrix();
  }
  
  /**
   * 初始化相克矩阵
   */
  initializeCounterMatrix() {
    const counterMultiplier = 1.5; // 相克伤害倍率
    const resistMultiplier = 0.75; // 被克制时的伤害减免
    
    // 遍历所有相克关系
    for (const [attackElement, defendElements] of Object.entries(ElementCounters)) {
      const attackType = parseInt(attackElement);
      
      for (const defendElement of defendElements) {
        // 攻击方对被克制方造成额外伤害
        this.counterMatrix[attackType][defendElement] = counterMultiplier;
        // 被克制方对攻击方造成减少伤害
        this.counterMatrix[defendElement][attackType] = resistMultiplier;
      }
    }
  }
  
  /**
   * 获取元素相克倍率
   * @param {number} attackElement - 攻击元素类型
   * @param {number} defendElement - 防御元素类型
   * @returns {number} 伤害倍率
   */
  getCounterMultiplier(attackElement, defendElement) {
    if (attackElement < 0 || attackElement >= 13 || 
        defendElement < 0 || defendElement >= 13) {
      return 1.0;
    }
    
    return this.counterMatrix[attackElement][defendElement];
  }
}

/**
 * 五行元素系统
 */
export class ElementSystem {
  constructor() {
    // 初始化相克表
    this.counterTable = new ElementCounterTable();
    
    Logger.log('ElementSystem: 五行元素系统已初始化');
  }
  
  /**
   * 获取元素名称
   * @param {number} elementType - 元素类型
   * @returns {string} 元素名称
   */
  getElementName(elementType) {
    return ElementNames[elementType] || '未知';
  }
  
  /**
   * 检查元素是否可以升级
   * @param {number} elementType - 元素类型
   * @returns {boolean} 是否可以升级
   */
  canUpgradeElement(elementType) {
    return ElementUpgrades.hasOwnProperty(elementType);
  }
  
  /**
   * 升级元素
   * @param {number} elementType - 基础元素类型
   * @returns {number|null} 升级后的元素类型，如果无法升级返回null
   */
  upgradeElement(elementType) {
    return ElementUpgrades[elementType] || null;
  }
  
  /**
   * 检查两个元素是否可以合成
   * @param {number} element1 - 元素1
   * @param {number} element2 - 元素2
   * @returns {boolean} 是否可以合成
   */
  canSynthesizeElements(element1, element2) {
    const key1 = `${element1}_${element2}`;
    const key2 = `${element2}_${element1}`;
    return ElementSynthesis.hasOwnProperty(key1) || ElementSynthesis.hasOwnProperty(key2);
  }
  
  /**
   * 合成元素
   * @param {number} element1 - 元素1
   * @param {number} element2 - 元素2
   * @returns {number|null} 合成后的元素类型，如果无法合成返回null
   */
  synthesizeElements(element1, element2) {
    const key1 = `${element1}_${element2}`;
    const key2 = `${element2}_${element1}`;
    
    return ElementSynthesis[key1] || ElementSynthesis[key2] || null;
  }
  
  /**
   * 计算元素伤害
   * @param {Object} attacker - 攻击者属性
   * @param {Object} defender - 防御者属性
   * @param {number} skillElementType - 技能元素类型
   * @param {number} baseDamage - 基础伤害
   * @returns {number} 最终元素伤害
   */
  calculateElementDamage(attacker, defender, skillElementType, baseDamage) {
    // 获取攻击者的元素攻击力
    const elementAttack = attacker.elementAttack?.[skillElementType] || 0;
    
    // 获取防御者的对应元素防御力
    const elementDefense = defender.elementDefense?.[skillElementType] || 0;
    
    // 计算元素伤害：元素攻击力 - 对应元素防御力，最小值1
    const elementDamage = Math.max(1, elementAttack - elementDefense);
    
    // 计算总伤害（基础伤害 + 元素伤害）
    const totalDamage = baseDamage + elementDamage;
    
    // 获取相克倍率
    const defenderMainElement = defender.mainElement || ElementTypes.FIRE; // 默认火元素
    const counterMultiplier = this.counterTable.getCounterMultiplier(skillElementType, defenderMainElement);
    
    // 对总伤害应用相克倍率
    const finalDamage = Math.floor(totalDamage * counterMultiplier);
    
    return Math.max(1, finalDamage);
  }
  
  /**
   * 获取元素相克信息
   * @param {number} attackElement - 攻击元素
   * @param {number} defendElement - 防御元素
   * @returns {Object} 相克信息
   */
  getElementCounterInfo(attackElement, defendElement) {
    const multiplier = this.counterTable.getCounterMultiplier(attackElement, defendElement);
    
    let relationship = 'normal';
    if (multiplier > 1.0) {
      relationship = 'advantage'; // 相克优势
    } else if (multiplier < 1.0) {
      relationship = 'disadvantage'; // 相克劣势
    }
    
    return {
      multiplier,
      relationship,
      attackElementName: this.getElementName(attackElement),
      defendElementName: this.getElementName(defendElement)
    };
  }
  
  /**
   * 获取元素被克制的元素列表
   * @param {number} elementType - 元素类型
   * @returns {Array<number>} 被克制的元素类型列表
   */
  getCounteredElements(elementType) {
    return ElementCounters[elementType] || [];
  }
  
  /**
   * 检查元素是否克制另一个元素
   * @param {number} attackElement - 攻击元素
   * @param {number} defendElement - 防御元素
   * @returns {boolean} 是否克制
   */
  isElementCountering(attackElement, defendElement) {
    const counteredElements = this.getCounteredElements(attackElement);
    return counteredElements.includes(defendElement);
  }
  
  /**
   * 获取所有基础元素
   * @returns {Array<number>} 基础元素类型列表
   */
  getBaseElements() {
    return [
      ElementTypes.FIRE,
      ElementTypes.WATER,
      ElementTypes.WIND,
      ElementTypes.ELECTRIC,
      ElementTypes.EARTH,
      ElementTypes.WOOD
    ];
  }
  
  /**
   * 获取所有高级元素
   * @returns {Array<number>} 高级元素类型列表
   */
  getAdvancedElements() {
    return [
      ElementTypes.EXPLOSION,
      ElementTypes.ICE,
      ElementTypes.STORM,
      ElementTypes.THUNDER,
      ElementTypes.THUNDERSTORM,
      ElementTypes.ROCKFALL,
      ElementTypes.TIMBER
    ];
  }
  
  /**
   * 检查元素是否为基础元素
   * @param {number} elementType - 元素类型
   * @returns {boolean} 是否为基础元素
   */
  isBaseElement(elementType) {
    return this.getBaseElements().includes(elementType);
  }
  
  /**
   * 检查元素是否为高级元素
   * @param {number} elementType - 元素类型
   * @returns {boolean} 是否为高级元素
   */
  isAdvancedElement(elementType) {
    return this.getAdvancedElements().includes(elementType);
  }
  
  /**
   * 获取元素的基础形态
   * @param {number} elementType - 元素类型
   * @returns {number} 基础元素类型
   */
  getBaseElementType(elementType) {
    // 查找哪个基础元素可以升级到当前元素
    for (const [baseElement, advancedElement] of Object.entries(ElementUpgrades)) {
      if (parseInt(advancedElement) === elementType) {
        return parseInt(baseElement);
      }
    }
    
    // 如果本身就是基础元素，返回自己
    if (this.isBaseElement(elementType)) {
      return elementType;
    }
    
    // 特殊处理雷暴（合成元素）
    if (elementType === ElementTypes.THUNDERSTORM) {
      return ElementTypes.WIND; // 返回风作为主要基础元素
    }
    
    return elementType;
  }
}
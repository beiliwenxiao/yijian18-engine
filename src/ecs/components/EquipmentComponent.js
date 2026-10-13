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
 * EquipmentComponent.js
 * 装备组件 - 管理实体的装备系统
 */

import { Logger } from '../../core/Logger.js';
import { Component } from '../Component.js';

/**
 * 装备组件
 * 管理角色的装备槽位和装备属性加成
 */
export class EquipmentComponent extends Component {
  /**
   * @param {Object} options - 装备配置
   */
  constructor(options = {}) {
    super('equipment');
    this.definitionResolver = typeof options.definitionResolver === 'function' ? options.definitionResolver : null;
    
    // 装备槽位（与 PlayerInfoPanel 保持一致）
    this.slots = {
      accessory: null,    // 饰品
      helmet: null,       // 头盔
      necklace: null,     // 项链
      mainhand: null,     // 主手武器
      armor: null,        // 胸甲
      offhand: null,      // 副手武器
      ring1: null,        // 戒指1
      belt: null,         // 腰带
      ring2: null,        // 戒指2
      instrument: null,   // 器械
      boots: null,        // 鞋子
      mount: null         // 坐骑
    };
    
    // 装备属性加成缓存
    this.bonusStats = {
      attack: 0,
      defense: 0,
      maxHp: 0,
      maxMp: 0,
      speed: 0,
      elementAttack: {},
      elementDefense: {}
    };
    
    // 初始化装备
    if (options.equipment) {
      this.loadEquipment(options.equipment);
    }
  }

  setDefinitionResolver(definitionResolver) {
    this.definitionResolver = typeof definitionResolver === 'function' ? definitionResolver : null;
    return this;
  }

  /**
   * 装备物品
   * @param {string} slotType - 装备槽位类型
   * @param {Object} equipment - 装备数据
   * @returns {Object|null} 被替换的装备，如果没有则返回null
   */
  equip(slotType, equipment) {
    Logger.log(`尝试装备到槽位 ${slotType}:`, equipment);
    
    if (!this.slots.hasOwnProperty(slotType)) {
      console.warn(`Invalid equipment slot: ${slotType}`);
      return null;
    }

    // 检查装备类型是否匹配槽位
    if (!this.isValidEquipmentForSlot(equipment, slotType)) {
      console.warn(`Equipment ${equipment.id} (subType: ${equipment.subType}) cannot be equipped in slot ${slotType}`);
      return null;
    }

    // 保存被替换的装备
    const oldEquipment = this.slots[slotType];
    
    // 装备新物品
    this.slots[slotType] = equipment;
    
    // 重新计算属性加成
    this.recalculateBonusStats();
    
    Logger.log(`成功装备到槽位 ${slotType}，属性加成:`, this.bonusStats);
    
    return oldEquipment;
  }

  /**
   * 卸下装备
   * @param {string} slotType - 装备槽位类型
   * @returns {Object|null} 被卸下的装备
   */
  unequip(slotType) {
    if (!this.slots.hasOwnProperty(slotType)) {
      console.warn(`Invalid equipment slot: ${slotType}`);
      return null;
    }

    const equipment = this.slots[slotType];
    this.slots[slotType] = null;
    
    // 重新计算属性加成
    this.recalculateBonusStats();
    
    return equipment;
  }

  /**
   * 获取指定槽位的装备
   * @param {string} slotType - 装备槽位类型
   * @returns {Object|null}
   */
  getEquipment(slotType) {
    return this.slots[slotType];
  }

  /**
   * 获取所有装备
   * @returns {Object} 所有装备的副本
   */
  getAllEquipment() {
    return { ...this.slots };
  }

  /**
   * 检查装备是否适合指定槽位
   * @param {Object} equipment - 装备数据
   * @param {string} slotType - 槽位类型
   * @returns {boolean}
   */
  isValidEquipmentForSlot(equipment, slotType) {
    if (!equipment || !equipment.subType) return false;
    
    const validTypes = {
      accessory: ['accessory'],
      helmet: ['helmet'],
      necklace: ['necklace'],
      mainhand: ['mainhand', 'weapon', 'tool'],  // 兼容旧的 weapon 类型；tool=工具类可当武器装备（斧头/剥皮刀等）
      armor: ['armor'],
      offhand: ['offhand', 'shield', 'ammo'],
      ring1: ['ring'],
      belt: ['belt'],
      ring2: ['ring'],
      instrument: ['instrument'],
      boots: ['boots'],
      mount: ['mount']
    };
    
    return validTypes[slotType] && validTypes[slotType].includes(equipment.subType);
  }

  /**
   * 重新计算装备属性加成
   */
  recalculateBonusStats() {
    // 重置加成
    this.bonusStats = {
      attack: 0,
      defense: 0,
      maxHp: 0,
      maxMp: 0,
      speed: 0,
      elementAttack: {},
      elementDefense: {}
    };

    // 遍历所有装备槽位
    for (const slotType in this.slots) {
      const equipment = this.slots[slotType];
      if (equipment && equipment.stats) {
        this.addEquipmentStats(equipment.stats);
      }
    }
  }

  /**
   * 添加装备属性到加成中
   * @param {Object} stats - 装备属性
   */
  addEquipmentStats(stats) {
    // 基础属性加成
    if (stats.attack) this.bonusStats.attack += stats.attack;
    if (stats.defense) this.bonusStats.defense += stats.defense;
    if (stats.maxHp) this.bonusStats.maxHp += stats.maxHp;
    if (stats.maxMp) this.bonusStats.maxMp += stats.maxMp;
    if (stats.speed) this.bonusStats.speed += stats.speed;

    // 元素攻击力加成
    if (stats.elementAttack) {
      for (const elementType in stats.elementAttack) {
        if (!this.bonusStats.elementAttack[elementType]) {
          this.bonusStats.elementAttack[elementType] = 0;
        }
        this.bonusStats.elementAttack[elementType] += stats.elementAttack[elementType];
      }
    }

    // 元素防御力加成
    if (stats.elementDefense) {
      for (const elementType in stats.elementDefense) {
        if (!this.bonusStats.elementDefense[elementType]) {
          this.bonusStats.elementDefense[elementType] = 0;
        }
        this.bonusStats.elementDefense[elementType] += stats.elementDefense[elementType];
      }
    }
  }

  /**
   * 获取装备属性加成
   * @returns {Object} 属性加成对象
   */
  getBonusStats() {
    return { ...this.bonusStats };
  }

  /**
   * 获取指定属性的加成值
   * @param {string} statType - 属性类型
   * @returns {number}
   */
  getBonusStat(statType) {
    return this.bonusStats[statType] || 0;
  }

  /**
   * 获取元素攻击力加成
   * @param {number} elementType - 元素类型
   * @returns {number}
   */
  getElementAttackBonus(elementType) {
    return this.bonusStats.elementAttack[elementType] || 0;
  }

  /**
   * 获取元素防御力加成
   * @param {number} elementType - 元素类型
   * @returns {number}
   */
  getElementDefenseBonus(elementType) {
    return this.bonusStats.elementDefense[elementType] || 0;
  }

  /**
   * 检查是否有装备
   * @returns {boolean}
   */
  hasAnyEquipment() {
    return Object.values(this.slots).some(equipment => equipment !== null);
  }

  /**
   * 获取装备数量
   * @returns {number}
   */
  getEquipmentCount() {
    return Object.values(this.slots).filter(equipment => equipment !== null).length;
  }

  /**
   * 加载装备数据
   * @param {Object} equipmentData - 装备数据
   */
  loadEquipment(equipmentData) {
    for (const slotType in equipmentData) {
      if (!this.slots.hasOwnProperty(slotType) || !equipmentData[slotType]) continue;
      const saved = equipmentData[slotType];
      if (saved.definitionId) {
        const definition = this.definitionResolver?.(saved.definitionId);
        if (!definition) throw new Error(`equipmentDefinitionMissing:${saved.definitionId}`);
        this.slots[slotType] = saved.instanceId
          ? { ...definition, instanceId: saved.instanceId, ...(saved.mutable || {}) }
          : definition;
      } else {
        this.slots[slotType] = saved;
      }
    }
    this.recalculateBonusStats();
  }

  exportRuntimeState() {
    const data = {};
    for (const [slotType, item] of Object.entries(this.slots)) {
      if (!item) continue;
      const definitionId = item.definitionId || item.id;
      if (!item.instanceId) {
        data[slotType] = { definitionId, quantity: 1 };
        continue;
      }
      const mutable = {};
      for (const key of ['durability', 'binding', 'charges', 'container']) {
        if (item[key] !== undefined) mutable[key] = structuredClone(item[key]);
      }
      data[slotType] = { definitionId, instanceId: item.instanceId, mutable };
    }
    return data;
  }

  /**
   * 导出装备数据
   * @returns {Object} 装备数据
   */
  exportEquipment() {
    const data = {};
    for (const slotType in this.slots) {
      if (this.slots[slotType]) {
        data[slotType] = { ...this.slots[slotType] };
      }
    }
    return data;
  }
}
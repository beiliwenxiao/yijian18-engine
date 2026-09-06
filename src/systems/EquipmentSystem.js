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
 * EquipmentSystem.js
 * 装备系统 - 管理装备的穿戴、卸下和属性计算
 */

/**
 * 装备系统类
 */
export class EquipmentSystem {
  constructor() {
    this.name = 'EquipmentSystem';
  }

  /**
   * 更新装备系统
   * @param {number} deltaTime - 帧间隔时间
   * @param {Array} entities - 实体数组
   */
  update(deltaTime, entities) {
    // 装备系统主要处理装备变化时的属性重新计算
    // 这里可以添加装备耐久度损耗等逻辑
    for (const entity of entities) {
      const equipmentComponent = entity.getComponent('equipment');
      if (equipmentComponent) {
        this.updateEquipmentEffects(entity, equipmentComponent, deltaTime);
      }
    }
  }

  /**
   * 更新装备效果
   * @param {Entity} entity - 实体
   * @param {EquipmentComponent} equipmentComponent - 装备组件
   * @param {number} deltaTime - 帧间隔时间
   */
  updateEquipmentEffects(entity, equipmentComponent, deltaTime) {
    // 这里可以添加装备的特殊效果处理
    // 比如装备耐久度损耗、特殊装备的持续效果等
  }

  _normalizeBonusStats(bonusStats = {}) {
    const toFiniteNumber = value => {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    };
    const normalizeElementStats = values => Object.fromEntries(
      Object.entries(values || {}).map(([elementType, value]) => [elementType, toFiniteNumber(value)])
    );
    return {
      attack: toFiniteNumber(bonusStats.attack),
      defense: toFiniteNumber(bonusStats.defense),
      maxHp: toFiniteNumber(bonusStats.maxHp),
      maxMp: toFiniteNumber(bonusStats.maxMp),
      speed: toFiniteNumber(bonusStats.speed),
      elementAttack: normalizeElementStats(bonusStats.elementAttack),
      elementDefense: normalizeElementStats(bonusStats.elementDefense)
    };
  }

  _getEquipmentBonusSnapshot(equipmentComponent) {
    return this._normalizeBonusStats(equipmentComponent?.getBonusStats?.());
  }

  _applyElementBonusDelta(currentValues, previousValues, nextValues) {
    const result = currentValues && typeof currentValues === 'object' ? currentValues : {};
    const elementTypes = new Set([
      ...Object.keys(previousValues || {}),
      ...Object.keys(nextValues || {})
    ]);
    for (const elementType of elementTypes) {
      const current = Number(result[elementType]);
      result[elementType] = (Number.isFinite(current) ? current : 0)
        - (previousValues[elementType] || 0)
        + (nextValues[elementType] || 0);
    }
    return result;
  }

  /**
   * 装备物品
   * @param {Entity} entity - 实体
   * @param {string} slotType - 装备槽位
   * @param {Object} equipment - 装备数据
   * @returns {Object|null} 被替换的装备
   */
  equipItem(entity, slotType, equipment) {
    const equipmentComponent = entity.getComponent('equipment');
    if (!equipmentComponent) {
      console.warn('Entity does not have equipment component');
      return null;
    }

    const previousBonusStats = this._getEquipmentBonusSnapshot(equipmentComponent);
    const oldEquipment = equipmentComponent.equip(slotType, equipment);
    this.updateEntityStats(entity, previousBonusStats);
    return oldEquipment;
  }

  /**
   * 卸下装备
   * @param {Entity} entity - 实体
   * @param {string} slotType - 装备槽位
   * @returns {Object|null} 被卸下的装备
   */
  unequipItem(entity, slotType) {
    const equipmentComponent = entity.getComponent('equipment');
    if (!equipmentComponent) {
      console.warn('Entity does not have equipment component');
      return null;
    }

    const previousBonusStats = this._getEquipmentBonusSnapshot(equipmentComponent);
    const equipment = equipmentComponent.unequip(slotType);
    this.updateEntityStats(entity, previousBonusStats);
    return equipment;
  }

  /**
   * 以装备变更前后的加成差量更新 live StatsComponent。
   * 这样不会清除职业、成长、区域等已经提交的非装备效果。
   * @param {Entity} entity - 实体
   * @param {Object|null} previousBonusStats - 装备槽变更前的总加成；省略时仅规范当前值
   */
  updateEntityStats(entity, previousBonusStats = null) {
    const statsComponent = entity.getComponent('stats');
    const equipmentComponent = entity.getComponent('equipment');
    if (!statsComponent || !equipmentComponent) return;

    const oldHp = statsComponent.hp;
    const oldMaxHp = statsComponent.maxHp;
    const oldMp = statsComponent.mp;
    const oldMaxMp = statsComponent.maxMp;
    const hpRatio = oldMaxHp > 0 ? oldHp / oldMaxHp : 1;
    const mpRatio = oldMaxMp > 0 ? oldMp / oldMaxMp : 1;
    const nextBonusStats = this._getEquipmentBonusSnapshot(equipmentComponent);
    const previous = previousBonusStats == null
      ? nextBonusStats
      : this._normalizeBonusStats(previousBonusStats);

    for (const statName of ['attack', 'defense', 'maxHp', 'maxMp', 'speed']) {
      const current = Number(statsComponent[statName]);
      statsComponent[statName] = (Number.isFinite(current) ? current : 0)
        - previous[statName]
        + nextBonusStats[statName];
    }
    statsComponent.elementAttack = this._applyElementBonusDelta(
      statsComponent.elementAttack,
      previous.elementAttack,
      nextBonusStats.elementAttack
    );
    statsComponent.elementDefense = this._applyElementBonusDelta(
      statsComponent.elementDefense,
      previous.elementDefense,
      nextBonusStats.elementDefense
    );

    const nextHp = statsComponent.maxHp !== oldMaxHp
      ? Math.floor(statsComponent.maxHp * hpRatio)
      : oldHp;
    const nextMp = statsComponent.maxMp !== oldMaxMp
      ? Math.floor(statsComponent.maxMp * mpRatio)
      : oldMp;
    statsComponent.hp = Math.min(statsComponent.maxHp, Math.max(0, nextHp));
    statsComponent.mp = Math.min(statsComponent.maxMp, Math.max(0, nextMp));

    console.log('EquipmentSystem: 更新实体属性', {
      attack: statsComponent.attack,
      defense: statsComponent.defense,
      maxHp: statsComponent.maxHp,
      maxMp: statsComponent.maxMp,
      speed: statsComponent.speed
    });
  }

  /**
   * 计算装备总价值
   * @param {Entity} entity - 实体
   * @returns {number} 总价值
   */
  calculateTotalEquipmentValue(entity) {
    const equipmentComponent = entity.getComponent('equipment');
    if (!equipmentComponent) return 0;

    let totalValue = 0;
    const allEquipment = equipmentComponent.getAllEquipment();
    
    for (const slotType in allEquipment) {
      const equipment = allEquipment[slotType];
      if (equipment && equipment.value) {
        totalValue += equipment.value;
      }
    }
    
    return totalValue;
  }

  /**
   * 获取装备总属性加成
   * @param {Entity} entity - 实体
   * @returns {Object} 属性加成对象
   */
  getTotalEquipmentBonus(entity) {
    const equipmentComponent = entity.getComponent('equipment');
    if (!equipmentComponent) {
      return {
        attack: 0,
        defense: 0,
        maxHp: 0,
        maxMp: 0,
        speed: 0,
        elementAttack: {},
        elementDefense: {}
      };
    }

    return equipmentComponent.getBonusStats();
  }

  /**
   * 检查装备是否损坏
   * @param {Entity} entity - 实体
   * @returns {Array} 损坏的装备列表
   */
  getBrokenEquipment(entity) {
    const equipmentComponent = entity.getComponent('equipment');
    if (!equipmentComponent) return [];

    const brokenEquipment = [];
    const allEquipment = equipmentComponent.getAllEquipment();
    
    for (const slotType in allEquipment) {
      const equipment = allEquipment[slotType];
      if (equipment && equipment.durability <= 0) {
        brokenEquipment.push({ slotType, equipment });
      }
    }
    
    return brokenEquipment;
  }

  /**
   * 修复装备
   * @param {Entity} entity - 实体
   * @param {string} slotType - 装备槽位
   * @param {number} repairAmount - 修复量（0-100）
   * @returns {boolean} 是否修复成功
   */
  repairEquipment(entity, slotType, repairAmount = 100) {
    const equipmentComponent = entity.getComponent('equipment');
    if (!equipmentComponent) return false;

    const equipment = equipmentComponent.getEquipment(slotType);
    if (!equipment) return false;

    equipment.durability = Math.min(100, equipment.durability + repairAmount);
    return true;
  }

  /**
   * 损坏装备（战斗中使用）
   * @param {Entity} entity - 实体
   * @param {number} damageAmount - 损坏量
   */
  damageEquipment(entity, damageAmount = 1) {
    const equipmentComponent = entity.getComponent('equipment');
    if (!equipmentComponent) return;

    const allEquipment = equipmentComponent.getAllEquipment();
    
    // 随机选择一件装备进行损坏
    const equippedSlots = Object.keys(allEquipment).filter(slot => allEquipment[slot] !== null);
    if (equippedSlots.length === 0) return;

    const randomSlot = equippedSlots[Math.floor(Math.random() * equippedSlots.length)];
    const equipment = allEquipment[randomSlot];
    
    if (equipment) {
      equipment.durability = Math.max(0, equipment.durability - damageAmount);
      
      // 如果装备完全损坏，可能需要特殊处理
      if (equipment.durability === 0) {
        console.log(`Equipment ${equipment.name} is broken!`);
        // 这里可以触发装备损坏事件
      }
    }
  }
}
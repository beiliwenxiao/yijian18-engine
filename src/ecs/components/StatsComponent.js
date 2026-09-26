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
 * StatsComponent.js
 * 属性组件 - 管理实体的生命值、魔法值和战斗属性
 */

import { Component } from '../Component.js';

/**
 * 属性组件
 * 存储角色的各项属性数据
 */
export class StatsComponent extends Component {
  /**
   * @param {Object} stats - 属性配置
   * @param {number} stats.maxHp - 最大生命值
   * @param {number} stats.maxMp - 最大魔法值
   * @param {number} stats.maxStamina - 最大体力值
   * @param {number} stats.stamina - 当前体力值
   * @param {number} stats.staminaRegen - 每秒体力恢复值
   * @param {number} stats.attack - 攻击力
   * @param {number} stats.defense - 防御力
   * @param {number} stats.speed - 移动速度
   * @param {number} stats.level - 等级
   * @param {number} stats.exp - 经验值
   * @param {number} stats.mainElement - 主元素类型
   * @param {Object} stats.elementAttack - 元素攻击力 {elementType: value}
   * @param {Object} stats.elementDefense - 元素防御力 {elementType: value}
   * @param {number} stats.unitType - 兵种类型
   */
  constructor(stats = {}) {
    super('stats');
    
    // 基础属性（不受属性点影响的原始值）
    this.baseMaxHp = stats.maxHp || 100;
    this.baseMaxMp = stats.maxMp || 100;
    this.baseMaxStamina = stats.maxStamina || 100;
    this.baseStaminaRegen = stats.staminaRegen ?? 12;
    this.baseAttack = stats.attack || 10;
    this.baseDefense = stats.defense || 5;
    this.baseSpeed = stats.speed || 100;
    
    // 当前属性（应用属性点效果后的值）
    this.maxHp = this.baseMaxHp;
    this.hp = stats.hp !== undefined ? stats.hp : this.maxHp;
    this.maxMp = this.baseMaxMp;
    this.mp = stats.mp !== undefined ? stats.mp : this.maxMp;
    this.maxStamina = this.baseMaxStamina;
    this.stamina = stats.stamina !== undefined ? stats.stamina : this.maxStamina;
    this.staminaRegen = Math.max(0, Number(this.baseStaminaRegen) || 0);
    this.attack = this.baseAttack;
    this.defense = this.baseDefense;
    this.speed = this.baseSpeed;
    
    // 等级和经验
    this.level = stats.level || 1;
    this.exp = stats.exp || 0;
    
    // 元素属性
    this.mainElement = stats.mainElement || 0; // 默认火元素
    this.elementAttack = stats.elementAttack || {}; // 各元素攻击力
    this.elementDefense = stats.elementDefense || {}; // 各元素防御力
    
    // 兵种属性
    this.unitType = stats.unitType || 0; // 默认刀盾步兵
    
    // 金币
    this.gold = stats.gold || 0;
    
    // 属性效果缓存
    this.attributeEffects = null;
  }

  /** 每帧恢复体力；deltaTime 使用引擎统一的秒单位。 */
  update(deltaTime) {
    const elapsed = Math.max(0, Number(deltaTime) || 0);
    if (elapsed <= 0 || this.stamina >= this.maxStamina || this.staminaRegen <= 0) return;
    this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * elapsed);
  }

  /**
   * 受到伤害
   * @param {number} damage - 伤害值
   * @returns {number} 实际受到的伤害
   */
  takeDamage(damage) {
    const actualDamage = Math.max(0, damage);
    this.hp = Math.max(0, this.hp - actualDamage);
    return actualDamage;
  }

  /**
   * 恢复生命值
   * @param {number} amount - 恢复量
   * @returns {number} 实际恢复量
   */
  heal(amount) {
    const oldHp = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - oldHp;
  }

  /**
   * 消耗魔法值
   * @param {number} amount - 消耗量
   * @returns {boolean} 是否成功消耗
   */
  consumeMana(amount) {
    if (this.mp >= amount) {
      this.mp -= amount;
      return true;
    }
    return false;
  }

  /**
   * 恢复魔法值
   * @param {number} amount - 恢复量
   * @returns {number} 实际恢复量
   */
  restoreMana(amount) {
    const oldMp = this.mp;
    this.mp = Math.min(this.maxMp, this.mp + amount);
    return this.mp - oldMp;
  }

  /**
   * 反序列化恢复 HP（夹取到 [0, maxHp]；maxHp 缺失时以恢复值为准）
   * @param {number} hpValue - 持久化的 HP 值
   */
  applyRestoredHp(hpValue) {
    const maxHp = Number.isFinite(Number(this.maxHp)) ? Number(this.maxHp) : Number(hpValue);
    this.hp = Math.min(maxHp, Math.max(0, Number(hpValue)));
  }

  /**
   * 检查是否存活
   * @returns {boolean}
   */
  isAlive() {
    return this.hp > 0;
  }

  /**
   * 检查是否死亡
   * @returns {boolean}
   */
  isDead() {
    return this.hp <= 0;
  }

  /**
   * 获取生命值百分比
   * @returns {number} 0-1之间的值
   */
  getHpPercent() {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /**
   * 获取魔法值百分比
   * @returns {number} 0-1之间的值
   */
  getMpPercent() {
    return this.maxMp > 0 ? this.mp / this.maxMp : 0;
  }

  /**
   * 增加经验值
   * @param {number} amount - 经验值
   */
  addExp(amount) {
    this.exp += amount;
  }

  /**
   * 升级
   */
  levelUp() {
    this.level++;
    // 升级时恢复满血、满蓝与满体力
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.stamina = this.maxStamina;
  }

  /**
   * 完全恢复
   */
  fullRestore() {
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.stamina = this.maxStamina;
  }

  /**
   * 设置主元素
   * @param {number} elementType - 元素类型
   */
  setMainElement(elementType) {
    this.mainElement = elementType;
  }

  /**
   * 获取主元素
   * @returns {number} 元素类型
   */
  getMainElement() {
    return this.mainElement;
  }

  /**
   * 设置元素攻击力
   * @param {number} elementType - 元素类型
   * @param {number} value - 攻击力值
   */
  setElementAttack(elementType, value) {
    this.elementAttack[elementType] = value;
  }

  /**
   * 获取元素攻击力
   * @param {number} elementType - 元素类型
   * @returns {number} 攻击力值
   */
  getElementAttack(elementType) {
    return this.elementAttack[elementType] || 0;
  }

  /**
   * 设置元素防御力
   * @param {number} elementType - 元素类型
   * @param {number} value - 防御力值
   */
  setElementDefense(elementType, value) {
    this.elementDefense[elementType] = value;
  }

  /**
   * 获取元素防御力
   * @param {number} elementType - 元素类型
   * @returns {number} 防御力值
   */
  getElementDefense(elementType) {
    return this.elementDefense[elementType] || 0;
  }

  /**
   * 增加元素攻击力
   * @param {number} elementType - 元素类型
   * @param {number} value - 增加值
   */
  addElementAttack(elementType, value) {
    this.elementAttack[elementType] = (this.elementAttack[elementType] || 0) + value;
  }

  /**
   * 增加元素防御力
   * @param {number} elementType - 元素类型
   * @param {number} value - 增加值
   */
  addElementDefense(elementType, value) {
    this.elementDefense[elementType] = (this.elementDefense[elementType] || 0) + value;
  }

  /**
   * 获取所有元素攻击力
   * @returns {Object} 元素攻击力对象
   */
  getAllElementAttack() {
    return { ...this.elementAttack };
  }

  /**
   * 获取所有元素防御力
   * @returns {Object} 元素防御力对象
   */
  getAllElementDefense() {
    return { ...this.elementDefense };
  }

  /**
   * 设置兵种类型
   * @param {number} unitType - 兵种类型
   */
  setUnitType(unitType) {
    this.unitType = unitType;
  }

  /**
   * 应用属性效果
   * @param {Object} effects - 属性效果对象
   */
  applyAttributeEffects(effects) {
    if (!effects) return;
    
    this.attributeEffects = effects;
    
    // 保存当前HP/MP比例
    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const mpRatio = this.maxMp > 0 ? this.mp / this.maxMp : 1;
    
    // 应用属性加成
    this.maxHp = Math.floor(this.baseMaxHp + (effects.maxHpBonus || 0));
    this.maxMp = Math.floor(this.baseMaxMp + (effects.maxManaBonus || 0));
    this.attack = Math.floor((this.baseAttack + (effects.attackBonus || 0)) * (effects.weaponDamageMultiplier || 1));
    this.defense = Math.floor(this.baseDefense + (effects.defenseBonus || 0));
    this.speed = Math.floor(this.baseSpeed + (effects.speedBonus || 0));
    
    // 按比例调整当前HP/MP
    this.hp = Math.floor(this.maxHp * hpRatio);
    this.mp = Math.floor(this.maxMp * mpRatio);
    
    // 应用元素攻击力加成
    if (effects.elementAttackBonus) {
      for (const elementType in this.elementAttack) {
        this.elementAttack[elementType] += effects.elementAttackBonus;
      }
    }
    
    // 应用元素防御力加成
    if (effects.elementDefenseBonus) {
      for (const elementType in this.elementDefense) {
        this.elementDefense[elementType] += effects.elementDefenseBonus;
      }
    }
  }

  /**
   * 重置到基础属性
   */
  resetToBaseStats() {
    // 保存当前HP/MP比例
    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const mpRatio = this.maxMp > 0 ? this.mp / this.maxMp : 1;
    
    // 重置为基础值
    this.maxHp = this.baseMaxHp;
    this.maxMp = this.baseMaxMp;
    this.attack = this.baseAttack;
    this.defense = this.baseDefense;
    this.speed = this.baseSpeed;
    
    // 按比例调整当前HP/MP
    this.hp = Math.floor(this.maxHp * hpRatio);
    this.mp = Math.floor(this.maxMp * mpRatio);
    
    this.attributeEffects = null;
  }

  /**
   * 获取兵种类型
   * @returns {number} 兵种类型
   */
  getUnitType() {
    return this.unitType;
  }
}

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
 * StatusEffectComponent.js
 * 状态效果组件 - 管理实体的状态效果（Buff/Debuff）
 */

import { Logger } from '../../core/Logger.js';
import { Component } from '../Component.js';

/**
 * 状态效果类型枚举
 */
export const StatusEffectType = {
  POISON: 0,      // 中毒 (-HP/秒)
  REGENERATION: 1, // 恢复 (+HP/秒)
  HASTE: 2,       // 加速 (+移动速度)
  SHIELD: 3,      // 护盾 (+防御)
  WEAKNESS: 4,    // 虚弱 (-攻击力)
  RAGE: 5         // 狂暴 (+攻击力)
};

/**
 * 状态效果数据
 */
export const StatusEffectData = {
  [StatusEffectType.POISON]: {
    id: StatusEffectType.POISON,
    name: '中毒',
    icon: 'poison',
    color: '#8B4513',
    hpPerSecond: -10,
    description: '每秒失去10点生命值'
  },
  [StatusEffectType.REGENERATION]: {
    id: StatusEffectType.REGENERATION,
    name: '恢复',
    icon: 'regeneration',
    color: '#00FF00',
    hpPerSecond: 5,
    description: '每秒恢复5点生命值'
  },
  [StatusEffectType.HASTE]: {
    id: StatusEffectType.HASTE,
    name: '加速',
    icon: 'haste',
    color: '#FFD700',
    speedMultiplier: 1.5,
    description: '移动速度提升50%'
  },
  [StatusEffectType.SHIELD]: {
    id: StatusEffectType.SHIELD,
    name: '护盾',
    icon: 'shield',
    color: '#4169E1',
    defenseBonus: 20,
    description: '防御力增加20点'
  },
  [StatusEffectType.WEAKNESS]: {
    id: StatusEffectType.WEAKNESS,
    name: '虚弱',
    icon: 'weakness',
    color: '#DC143C',
    attackMultiplier: 0.8,
    description: '攻击力降低20%'
  },
  [StatusEffectType.RAGE]: {
    id: StatusEffectType.RAGE,
    name: '狂暴',
    icon: 'rage',
    color: '#FF4500',
    attackMultiplier: 1.3,
    description: '攻击力提升30%'
  }
};

/**
 * 单个状态效果实例
 */
export class StatusEffect {
  /**
   * @param {number} type - 状态效果类型
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Object} [source=null] - 来源实体
   */
  constructor(type, duration, intensity = 1, source = null) {
    this.type = type;
    this.duration = duration;
    this.remainingTime = duration;
    this.intensity = intensity;
    this.source = source;
    this.data = StatusEffectData[type];
    
    // 生成唯一ID
    this.id = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 上次触发时间（用于DOT/HOT效果）
    this.lastTriggerTime = 0;
    this.triggerInterval = 1000; // 1秒触发一次
  }

  /**
   * 更新状态效果
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @returns {boolean} 是否仍然有效
   */
  update(deltaTime) {
    this.remainingTime -= deltaTime;
    return this.remainingTime > 0;
  }

  /**
   * 检查是否应该触发效果
   * @param {number} currentTime - 当前时间（毫秒）
   * @returns {boolean}
   */
  shouldTrigger(currentTime) {
    if (this.lastTriggerTime === 0) {
      this.lastTriggerTime = currentTime;
      return true;
    }
    
    if (currentTime - this.lastTriggerTime >= this.triggerInterval) {
      this.lastTriggerTime = currentTime;
      return true;
    }
    
    return false;
  }

  /**
   * 获取剩余时间百分比
   * @returns {number} 0-1之间的值
   */
  getRemainingPercent() {
    return this.remainingTime / this.duration;
  }

  /**
   * 检查是否过期
   * @returns {boolean}
   */
  isExpired() {
    return this.remainingTime <= 0;
  }
}

/**
 * 状态效果组件
 * 管理实体身上的所有状态效果
 */
export class StatusEffectComponent extends Component {
  constructor() {
    super('statusEffect');
    
    // 活跃的状态效果列表
    this.effects = new Map(); // type -> StatusEffect
    
    // 属性修改缓存
    this.modifiers = {
      attackMultiplier: 1.0,
      defenseBonus: 0,
      speedMultiplier: 1.0
    };
    
    // 是否需要重新计算修改器
    this.needsRecalculation = false;
  }

  /**
   * 添加状态效果
   * @param {number} type - 状态效果类型
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Object} [source=null] - 来源实体
   * @returns {boolean} 是否成功添加
   */
  addEffect(type, duration, intensity = 1, source = null) {
    // 检查是否已存在相同类型的效果
    if (this.effects.has(type)) {
      const existing = this.effects.get(type);
      
      // 如果新效果持续时间更长或强度更高，替换现有效果
      if (duration > existing.remainingTime || intensity > existing.intensity) {
        this.effects.set(type, new StatusEffect(type, duration, intensity, source));
        this.needsRecalculation = true;
        Logger.log(`StatusEffect: 替换状态效果 ${StatusEffectData[type].name}`);
        return true;
      } else {
        // 刷新现有效果的持续时间
        existing.remainingTime = Math.max(existing.remainingTime, duration);
        Logger.log(`StatusEffect: 刷新状态效果 ${StatusEffectData[type].name}`);
        return false;
      }
    }
    
    // 添加新效果
    const effect = new StatusEffect(type, duration, intensity, source);
    this.effects.set(type, effect);
    this.needsRecalculation = true;
    
    Logger.log(`StatusEffect: 添加状态效果 ${StatusEffectData[type].name}，持续${duration}秒`);
    return true;
  }

  /**
   * 移除状态效果
   * @param {number} type - 状态效果类型
   * @returns {boolean} 是否成功移除
   */
  removeEffect(type) {
    if (this.effects.has(type)) {
      this.effects.delete(type);
      this.needsRecalculation = true;
      Logger.log(`StatusEffect: 移除状态效果 ${StatusEffectData[type].name}`);
      return true;
    }
    return false;
  }

  /**
   * 检查是否有指定状态效果
   * @param {number} type - 状态效果类型
   * @returns {boolean}
   */
  hasEffect(type) {
    return this.effects.has(type);
  }

  /**
   * 获取指定状态效果
   * @param {number} type - 状态效果类型
   * @returns {StatusEffect|null}
   */
  getEffect(type) {
    return this.effects.get(type) || null;
  }

  /**
   * 获取所有状态效果
   * @returns {Array<StatusEffect>}
   */
  getAllEffects() {
    return Array.from(this.effects.values());
  }

  /**
   * 清除所有状态效果
   */
  clearAllEffects() {
    this.effects.clear();
    this.needsRecalculation = true;
    Logger.log('StatusEffect: 清除所有状态效果');
  }

  /**
   * 清除指定类型的状态效果（Buff或Debuff）
   * @param {string} effectType - 'buff' 或 'debuff'
   */
  clearEffectsByType(effectType) {
    const buffTypes = [StatusEffectType.REGENERATION, StatusEffectType.HASTE, StatusEffectType.SHIELD, StatusEffectType.RAGE];
    const debuffTypes = [StatusEffectType.POISON, StatusEffectType.WEAKNESS];
    
    const typesToClear = effectType === 'buff' ? buffTypes : debuffTypes;
    
    for (const type of typesToClear) {
      if (this.effects.has(type)) {
        this.removeEffect(type);
      }
    }
  }

  /**
   * 更新状态效果组件
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {Entity} entity - 拥有此组件的实体
   */
  update(deltaTime, entity) {
    const currentTime = performance.now();
    let hasExpiredEffects = false;
    
    // 更新所有状态效果
    for (const [type, effect] of this.effects) {
      // 更新持续时间
      if (!effect.update(deltaTime)) {
        // 效果过期，标记为需要移除
        hasExpiredEffects = true;
        continue;
      }
      
      // 处理DOT/HOT效果
      if (effect.shouldTrigger(currentTime)) {
        this.triggerEffect(effect, entity);
      }
    }
    
    // 移除过期的效果
    if (hasExpiredEffects) {
      for (const [type, effect] of this.effects) {
        if (effect.isExpired()) {
          this.effects.delete(type);
          this.needsRecalculation = true;
          Logger.log(`StatusEffect: 状态效果 ${effect.data.name} 过期`);
        }
      }
    }
    
    // 重新计算属性修改器
    if (this.needsRecalculation) {
      this.recalculateModifiers();
      this.needsRecalculation = false;
    }
  }

  /**
   * 触发状态效果
   * @param {StatusEffect} effect - 状态效果
   * @param {Entity} entity - 目标实体
   */
  triggerEffect(effect, entity) {
    const stats = entity.getComponent('stats');
    if (!stats) return;
    
    const data = effect.data;
    
    // 处理生命值变化效果
    if (data.hpPerSecond !== undefined) {
      const hpChange = data.hpPerSecond * effect.intensity;
      
      if (hpChange > 0) {
        // 治疗效果
        const actualHeal = stats.heal(hpChange);
        if (actualHeal > 0) {
          Logger.log(`${data.name}: 恢复 ${actualHeal} 点生命值`);
          // 可以在这里触发治疗特效
        }
      } else {
        // 伤害效果
        const actualDamage = stats.takeDamage(-hpChange);
        if (actualDamage > 0) {
          Logger.log(`${data.name}: 造成 ${actualDamage} 点伤害`);
          // 可以在这里触发伤害特效
        }
      }
    }
  }

  /**
   * 重新计算属性修改器
   */
  recalculateModifiers() {
    // 重置修改器
    this.modifiers.attackMultiplier = 1.0;
    this.modifiers.defenseBonus = 0;
    this.modifiers.speedMultiplier = 1.0;
    
    // 应用所有状态效果的修改器
    for (const effect of this.effects.values()) {
      const data = effect.data;
      
      if (data.attackMultiplier !== undefined) {
        this.modifiers.attackMultiplier *= data.attackMultiplier;
      }
      
      if (data.defenseBonus !== undefined) {
        this.modifiers.defenseBonus += data.defenseBonus * effect.intensity;
      }
      
      if (data.speedMultiplier !== undefined) {
        this.modifiers.speedMultiplier *= data.speedMultiplier;
      }
    }
    
    Logger.log('StatusEffect: 重新计算属性修改器', this.modifiers);
  }

  /**
   * 获取修改后的攻击力
   * @param {number} baseAttack - 基础攻击力
   * @returns {number} 修改后的攻击力
   */
  getModifiedAttack(baseAttack) {
    return Math.floor(baseAttack * this.modifiers.attackMultiplier);
  }

  /**
   * 获取修改后的防御力
   * @param {number} baseDefense - 基础防御力
   * @returns {number} 修改后的防御力
   */
  getModifiedDefense(baseDefense) {
    return baseDefense + this.modifiers.defenseBonus;
  }

  /**
   * 获取修改后的移动速度
   * @param {number} baseSpeed - 基础移动速度
   * @returns {number} 修改后的移动速度
   */
  getModifiedSpeed(baseSpeed) {
    return baseSpeed * this.modifiers.speedMultiplier;
  }

  /**
   * 获取状态效果数量
   * @returns {number}
   */
  getEffectCount() {
    return this.effects.size;
  }

  /**
   * 检查是否有任何状态效果
   * @returns {boolean}
   */
  hasAnyEffect() {
    return this.effects.size > 0;
  }

  /**
   * 获取Buff数量
   * @returns {number}
   */
  getBuffCount() {
    const buffTypes = [StatusEffectType.REGENERATION, StatusEffectType.HASTE, StatusEffectType.SHIELD, StatusEffectType.RAGE];
    return buffTypes.filter(type => this.effects.has(type)).length;
  }

  /**
   * 获取Debuff数量
   * @returns {number}
   */
  getDebuffCount() {
    const debuffTypes = [StatusEffectType.POISON, StatusEffectType.WEAKNESS];
    return debuffTypes.filter(type => this.effects.has(type)).length;
  }
}
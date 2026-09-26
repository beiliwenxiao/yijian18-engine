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
 * StatusEffectSystem.js
 * 状态效果系统 - 管理所有实体的状态效果更新和应用
 */

import { StatusEffectType, StatusEffectData } from '../ecs/components/StatusEffectComponent.js';
import { RNG } from '../core/RNG.js';

// 表现层随机：状态特效粒子（非玩法结算，非权威）
const fxRng = new RNG();

/**
 * 状态效果系统
 * 负责更新所有实体的状态效果，处理效果触发和属性修改
 */
export class StatusEffectSystem {
  /**
   * @param {Object} config - 配置
   * @param {ParticleSystem} [config.particleSystem] - 粒子系统（用于特效）
   */
  constructor(config = {}) {
    this.particleSystem = config.particleSystem;
    
    // 伤害数字列表（用于显示DOT/HOT数字）
    this.damageNumbers = [];
    
    console.log('StatusEffectSystem: Initialized');
  }

  /**
   * 更新系统
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {Array<Entity>} entities - 实体列表
   */
  update(deltaTime, entities) {
    // 更新所有实体的状态效果
    for (const entity of entities) {
      const statusEffect = entity.getComponent('statusEffect');
      if (statusEffect) {
        statusEffect.update(deltaTime, entity);
      }
    }
    
    // 更新伤害数字
    this.updateDamageNumbers(deltaTime);
  }

  /**
   * 渲染系统（主要是伤害数字）
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Camera} camera - 相机（用于坐标转换）
   */
  render(ctx, camera) {
    this.renderDamageNumbers(ctx, camera);
  }

  /**
   * 为实体添加状态效果
   * @param {Entity} entity - 目标实体
   * @param {number} type - 状态效果类型
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Entity} [source=null] - 来源实体
   * @returns {boolean} 是否成功添加
   */
  async addStatusEffect(entity, type, duration, intensity = 1, source = null) {
    let statusEffect = entity.getComponent('statusEffect');
    
    // 如果实体没有状态效果组件，添加一个
    if (!statusEffect) {
      const { StatusEffectComponent } = await import('../ecs/components/StatusEffectComponent.js');
      statusEffect = new StatusEffectComponent();
      entity.addComponent(statusEffect);
    }
    
    const success = statusEffect.addEffect(type, duration, intensity, source);
    
    // 创建添加效果的特效
    if (success) {
      this.createStatusEffectParticle(entity, type, true);
    }
    
    return success;
  }

  /**
   * 移除实体的状态效果
   * @param {Entity} entity - 目标实体
   * @param {number} type - 状态效果类型
   * @returns {boolean} 是否成功移除
   */
  removeStatusEffect(entity, type) {
    const statusEffect = entity.getComponent('statusEffect');
    if (!statusEffect) return false;
    
    const success = statusEffect.removeEffect(type);
    
    // 创建移除效果的特效
    if (success) {
      this.createStatusEffectParticle(entity, type, false);
    }
    
    return success;
  }

  /**
   * 清除实体的所有状态效果
   * @param {Entity} entity - 目标实体
   */
  clearAllStatusEffects(entity) {
    const statusEffect = entity.getComponent('statusEffect');
    if (statusEffect) {
      statusEffect.clearAllEffects();
    }
  }

  /**
   * 清除指定类型的状态效果
   * @param {Entity} entity - 目标实体
   * @param {string} effectType - 'buff' 或 'debuff'
   */
  clearStatusEffectsByType(entity, effectType) {
    const statusEffect = entity.getComponent('statusEffect');
    if (statusEffect) {
      statusEffect.clearEffectsByType(effectType);
    }
  }

  /**
   * 检查实体是否有指定状态效果
   * @param {Entity} entity - 实体
   * @param {number} type - 状态效果类型
   * @returns {boolean}
   */
  hasStatusEffect(entity, type) {
    const statusEffect = entity.getComponent('statusEffect');
    return statusEffect ? statusEffect.hasEffect(type) : false;
  }

  /**
   * 获取实体的修改后属性
   * @param {Entity} entity - 实体
   * @returns {Object} 修改后的属性 {attack, defense, speed}
   */
  getModifiedStats(entity) {
    const stats = entity.getComponent('stats');
    const statusEffect = entity.getComponent('statusEffect');
    
    if (!stats) {
      return { attack: 0, defense: 0, speed: 0 };
    }
    
    if (!statusEffect) {
      return {
        attack: stats.attack,
        defense: stats.defense,
        speed: stats.speed
      };
    }
    
    return {
      attack: statusEffect.getModifiedAttack(stats.attack),
      defense: statusEffect.getModifiedDefense(stats.defense),
      speed: statusEffect.getModifiedSpeed(stats.speed)
    };
  }

  /**
   * 创建状态效果粒子特效
   * @param {Entity} entity - 实体
   * @param {number} type - 状态效果类型
   * @param {boolean} isAdding - 是否是添加效果（true）还是移除效果（false）
   */
  createStatusEffectParticle(entity, type, isAdding) {
    if (!this.particleSystem) return;
    
    const transform = entity.getComponent('transform');
    if (!transform) return;
    
    const data = StatusEffectData[type];
    const position = {
      x: transform.position.x,
      y: transform.position.y - 20 // 在实体上方
    };
    
    // 创建粒子特效
    const particleCount = isAdding ? 10 : 5;
    const color = data.color;
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const speed = isAdding ? 50 : 30;
      
      this.particleSystem.createParticle({
        position: { ...position },
        velocity: {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed - 20
        },
        life: 1.0,
        size: isAdding ? 4 : 2,
        color: color,
        alpha: 0.8,
        gravity: 50
      });
    }
  }

  /**
   * 显示状态效果伤害/治疗数字
   * @param {Entity} entity - 实体
   * @param {number} value - 数值（正数为治疗，负数为伤害）
   * @param {string} effectName - 效果名称
   */
  showStatusEffectNumber(entity, value, effectName) {
    const transform = entity.getComponent('transform');
    if (!transform) return;
    
    const damageNumber = {
      x: transform.position.x + (fxRng.next() - 0.5) * 20,
      y: transform.position.y - 30,
      value: Math.abs(value),
      isHeal: value > 0,
      effectName: effectName,
      life: 1.5,
      maxLife: 1.5,
      velocity: { x: (fxRng.next() - 0.5) * 30, y: -40 }
    };
    
    this.damageNumbers.push(damageNumber);
  }

  /**
   * 更新伤害数字
   * @param {number} deltaTime - 帧间隔时间（秒）
   */
  updateDamageNumbers(deltaTime) {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      
      // 更新位置
      dn.x += dn.velocity.x * deltaTime;
      dn.y += dn.velocity.y * deltaTime;
      
      // 应用重力
      dn.velocity.y += 100 * deltaTime;
      
      // 减少生命周期
      dn.life -= deltaTime;
      
      // 移除过期的数字
      if (dn.life <= 0) {
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  /**
   * 渲染伤害数字
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Camera} camera - 相机
   */
  renderDamageNumbers(ctx, camera) {
    if (!camera) return;
    
    ctx.save();
    
    for (const dn of this.damageNumbers) {
      // 转换为屏幕坐标
      const screenPos = this.worldToScreen({ x: dn.x, y: dn.y }, camera);
      
      // 计算透明度
      const alpha = dn.life / dn.maxLife;
      
      // 绘制数字
      ctx.globalAlpha = alpha;
      ctx.fillStyle = dn.isHeal ? '#00ff00' : '#ff6600'; // 治疗为绿色，DOT为橙色
      ctx.strokeStyle = '#000000';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.lineWidth = 2;
      
      const text = dn.isHeal ? `+${dn.value}` : `-${dn.value}`;
      
      // 描边
      ctx.strokeText(text, screenPos.x, screenPos.y);
      // 填充
      ctx.fillText(text, screenPos.x, screenPos.y);
      
      // 绘制效果名称（小字）
      if (dn.effectName) {
        ctx.font = '10px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(dn.effectName, screenPos.x, screenPos.y + 15);
      }
    }
    
    ctx.restore();
  }

  /**
   * 世界坐标转屏幕坐标
   * @param {Object} worldPos - 世界坐标 {x, y}
   * @param {Camera} camera - 相机
   * @returns {Object} 屏幕坐标 {x, y}
   */
  worldToScreen(worldPos, camera) {
    if (!camera) {
      return { x: worldPos.x, y: worldPos.y };
    }
    
    const viewBounds = camera.getViewBounds();
    return {
      x: worldPos.x - viewBounds.left,
      y: worldPos.y - viewBounds.top
    };
  }

  /**
   * 应用中毒效果
   * @param {Entity} target - 目标实体
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Entity} [source=null] - 来源实体
   */
  applyPoison(target, duration, intensity = 1, source = null) {
    return this.addStatusEffect(target, StatusEffectType.POISON, duration, intensity, source);
  }

  /**
   * 应用恢复效果
   * @param {Entity} target - 目标实体
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Entity} [source=null] - 来源实体
   */
  applyRegeneration(target, duration, intensity = 1, source = null) {
    return this.addStatusEffect(target, StatusEffectType.REGENERATION, duration, intensity, source);
  }

  /**
   * 应用加速效果
   * @param {Entity} target - 目标实体
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Entity} [source=null] - 来源实体
   */
  applyHaste(target, duration, intensity = 1, source = null) {
    return this.addStatusEffect(target, StatusEffectType.HASTE, duration, intensity, source);
  }

  /**
   * 应用护盾效果
   * @param {Entity} target - 目标实体
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Entity} [source=null] - 来源实体
   */
  applyShield(target, duration, intensity = 1, source = null) {
    return this.addStatusEffect(target, StatusEffectType.SHIELD, duration, intensity, source);
  }

  /**
   * 应用虚弱效果
   * @param {Entity} target - 目标实体
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Entity} [source=null] - 来源实体
   */
  applyWeakness(target, duration, intensity = 1, source = null) {
    return this.addStatusEffect(target, StatusEffectType.WEAKNESS, duration, intensity, source);
  }

  /**
   * 应用狂暴效果
   * @param {Entity} target - 目标实体
   * @param {number} duration - 持续时间（秒）
   * @param {number} [intensity=1] - 强度倍数
   * @param {Entity} [source=null] - 来源实体
   */
  applyRage(target, duration, intensity = 1, source = null) {
    return this.addStatusEffect(target, StatusEffectType.RAGE, duration, intensity, source);
  }

  /**
   * 获取系统统计信息
   * @param {Array<Entity>} entities - 实体列表
   * @returns {Object} 统计信息
   */
  getSystemStats(entities) {
    let totalEffects = 0;
    let entitiesWithEffects = 0;
    const effectCounts = {};
    
    for (const entity of entities) {
      const statusEffect = entity.getComponent('statusEffect');
      if (statusEffect && statusEffect.hasAnyEffect()) {
        entitiesWithEffects++;
        const effects = statusEffect.getAllEffects();
        totalEffects += effects.length;
        
        for (const effect of effects) {
          const typeName = StatusEffectData[effect.type].name;
          effectCounts[typeName] = (effectCounts[typeName] || 0) + 1;
        }
      }
    }
    
    return {
      totalEffects,
      entitiesWithEffects,
      effectCounts,
      damageNumbers: this.damageNumbers.length
    };
  }
}
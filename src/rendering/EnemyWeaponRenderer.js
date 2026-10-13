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
 * EnemyWeaponRenderer.js
 * 敌人武器渲染器 - 负责渲染敌人的攻击动画
 */

export class EnemyWeaponRenderer {
  constructor() {
    // 敌人武器配置
    this.weaponConfigs = {
      'wild_dog': {
        type: 'bite',
        attackSpeed: 1.0, // 每1秒攻击1次
        jawSize: 16, // 牙齿大小
        jawColor: '#ffffff',
        animationDuration: 0.3 // 咬合动画时长（秒）
      },
      'soldier': {
        type: 'slash', // 刀砍
        attackSpeed: 1.0,
        weaponLength: 48,
        weaponWidth: 6,
        weaponColor: '#c0c0c0',
        animationDuration: 0.4
      },
      'bandit': {
        type: 'thrust', // 剑刺
        attackSpeed: 1.0,
        weaponLength: 56,
        weaponWidth: 4,
        weaponColor: '#b0b0b0',
        animationDuration: 0.35
      },
      'starving': {
        type: 'sweep', // 棍扫
        attackSpeed: 1.0,
        weaponLength: 64,
        weaponWidth: 8,
        weaponColor: '#8B4513',
        animationDuration: 0.45
      },
      'default': {
        type: 'slash',
        attackSpeed: 1.0,
        weaponLength: 48,
        weaponWidth: 6,
        weaponColor: '#888888',
        animationDuration: 0.4
      }
    };
    
    // 敌人攻击动画状态 Map<entityId, animationState>
    this.attackAnimations = new Map();
  }

  /**
   * 获取敌人的武器配置
   * @param {Entity} entity - 敌人实体
   * @returns {Object} 武器配置
   */
  getWeaponConfig(entity) {
    const templateId = entity.templateId || '';
    const name = entity.name || '';
    
    // 根据 templateId 或名字匹配配置
    // 野狗不显示武器
    if (templateId === 'wild_dog' || name.includes('野狗')) {
      return null;
    } else if (templateId === 'soldier' || name.includes('士兵')) {
      return this.weaponConfigs['soldier'];
    } else if (templateId === 'bandit' || name.includes('土匪')) {
      return this.weaponConfigs['bandit'];
    } else if (templateId === 'starving' || name.includes('饥民')) {
      return this.weaponConfigs['starving'];
    }
    
    return this.weaponConfigs['default'];
  }

  /**
   * 开始攻击动画
   * @param {Entity} entity - 敌人实体
   * @param {Object} targetPos - 目标位置 {x, y}
   */
  startAttack(entity, targetPos) {
    const config = this.getWeaponConfig(entity);
    if (!config) return; // 野狗无武器，跳过攻击动画
    const transform = entity.getComponent('transform');
    if (!transform) return;
    
    // 计算攻击方向
    const dx = targetPos.x - transform.position.x;
    const dy = targetPos.y - transform.position.y;
    const angle = Math.atan2(dy, dx);
    
    Logger.log(`[EnemyWeaponRenderer] startAttack: entity=${entity.id}, duration=${config.animationDuration}`);
    
    // 创建攻击动画状态
    this.attackAnimations.set(entity.id, {
      active: true,
      progress: 0,
      duration: config.animationDuration,
      type: config.type,
      angle: angle,
      config: config
    });
  }

  /**
   * 更新攻击动画
   * @param {number} deltaTime - 帧间隔时间（秒）
   */
  update(deltaTime) {
    // 更新所有攻击动画
    for (const [entityId, animation] of this.attackAnimations.entries()) {
      if (!animation.active) continue;
      
      animation.progress += deltaTime / animation.duration;
      
      if (animation.progress >= 1) {
        // 动画结束
        animation.active = false;
        animation.progress = 0;
      }
    }
  }

  /**
   * 渲染敌人武器
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Entity} entity - 敌人实体
   * @param {Entity} targetEntity - 目标实体（用于计算武器朝向，可选）
   */
  render(ctx, entity, targetEntity = null) {
    const transform = entity.getComponent('transform');
    if (!transform) return;
    
    const config = this.getWeaponConfig(entity);
    if (!config) return; // 无武器配置则跳过渲染
    const x = Math.round(transform.position.x);
    const y = Math.round(transform.position.y);
    
    // 计算武器朝向（朝向目标或默认朝右）
    let weaponAngle = 0;
    if (targetEntity) {
      const targetTransform = targetEntity.getComponent('transform');
      if (targetTransform) {
        const dx = targetTransform.position.x - transform.position.x;
        const dy = targetTransform.position.y - transform.position.y;
        weaponAngle = Math.atan2(dy, dx);
      }
    }
    
    ctx.save();
    ctx.translate(x, y);
    
    // 检查是否有攻击动画
    const animation = this.attackAnimations.get(entity.id);
    
    if (animation && animation.active) {
      // 攻击动画中，根据攻击类型渲染动画
      switch (animation.type) {
        case 'bite':
          this.renderBiteAnimation(ctx, animation);
          break;
        case 'slash':
          this.renderSlashAnimation(ctx, animation);
          break;
        case 'thrust':
          this.renderThrustAnimation(ctx, animation);
          break;
        case 'sweep':
          this.renderSweepAnimation(ctx, animation);
          break;
      }
    } else {
      // 非攻击状态，显示静止的武器
      this.renderIdleWeapon(ctx, config, weaponAngle);
    }
    
    ctx.restore();
  }

  /**
   * 渲染静止状态的武器
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} config - 武器配置
   * @param {number} angle - 武器角度
   */
  renderIdleWeapon(ctx, config, angle) {
    if (config.type === 'bite') {
      // 野狗：显示闭合的牙齿
      ctx.rotate(angle);
      const jawOffset = 20;
      
      // 绘制闭合的上牙
      ctx.save();
      ctx.translate(jawOffset, 0);
      ctx.rotate(-Math.PI / 12); // 轻微张开（15度）
      this.drawJaw(ctx, config.jawSize, config.jawColor, true);
      ctx.restore();
      
      // 绘制闭合的下牙
      ctx.save();
      ctx.translate(jawOffset, 0);
      ctx.rotate(Math.PI / 12); // 轻微张开（15度）
      this.drawJaw(ctx, config.jawSize, config.jawColor, false);
      ctx.restore();
    } else {
      // 其他武器：显示在身体旁边
      ctx.rotate(angle);
      ctx.translate(16, 0); // 武器起点在身体边缘
      this.drawWeapon(ctx, config);
    }
  }

  /**
   * 渲染咬合动画（野狗）
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} animation - 动画状态
   */
  renderBiteAnimation(ctx, animation) {
    const config = animation.config;
    const progress = this.easeInOutQuad(animation.progress);
    
    // 咬合角度：0 -> 30度 -> 0
    const maxBiteAngle = Math.PI / 6; // 30度
    const biteAngle = Math.sin(progress * Math.PI) * maxBiteAngle;
    
    // 旋转到攻击方向
    ctx.rotate(animation.angle);
    
    // 牙齿位置偏移（在身体旁边）
    const jawOffset = 20;
    
    // 绘制上牙
    ctx.save();
    ctx.translate(jawOffset, 0);
    ctx.rotate(-biteAngle);
    this.drawJaw(ctx, config.jawSize, config.jawColor, true);
    ctx.restore();
    
    // 绘制下牙
    ctx.save();
    ctx.translate(jawOffset, 0);
    ctx.rotate(biteAngle);
    this.drawJaw(ctx, config.jawSize, config.jawColor, false);
    ctx.restore();
  }

  /**
   * 绘制牙齿
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {number} size - 牙齿大小
   * @param {string} color - 颜色
   * @param {boolean} isUpper - 是否是上牙
   */
  drawJaw(ctx, size, color, isUpper) {
    const direction = isUpper ? -1 : 1;
    
    // 绘制3个尖牙
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    
    for (let i = 0; i < 3; i++) {
      const x = i * 6 - 6;
      const y = 0;
      
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + direction * size);
      ctx.lineTo(x + 3, y + direction * size);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * 渲染刀砍动画
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} animation - 动画状态
   */
  renderSlashAnimation(ctx, animation) {
    const config = animation.config;
    const progress = this.easeInOutQuad(animation.progress);
    
    // 挥砍角度：从右上到左下（-45度到45度）
    const startAngle = animation.angle - Math.PI / 4;
    const endAngle = animation.angle + Math.PI / 4;
    const currentAngle = startAngle + (endAngle - startAngle) * progress;
    
    ctx.rotate(currentAngle);
    
    // 武器起点在身体边缘
    ctx.translate(16, 0);
    
    // 绘制刀
    this.drawWeapon(ctx, config);
  }

  /**
   * 渲染剑刺动画
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} animation - 动画状态
   */
  renderThrustAnimation(ctx, animation) {
    const config = animation.config;
    const progress = this.easeInOutQuad(animation.progress);
    
    // 刺击：向前伸出
    ctx.rotate(animation.angle);
    
    // 武器起点在身体边缘
    ctx.translate(16, 0);
    
    // 刺击距离
    const thrustDistance = config.weaponLength * 0.8;
    const currentDistance = progress * thrustDistance;
    ctx.translate(currentDistance, 0);
    
    // 绘制剑
    this.drawWeapon(ctx, config);
  }

  /**
   * 渲染棍扫动画
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} animation - 动画状态
   */
  renderSweepAnimation(ctx, animation) {
    const config = animation.config;
    const progress = this.easeInOutQuad(animation.progress);
    
    // 横扫角度：从左到右（-60度到60度）
    const sweepRange = Math.PI / 3; // 60度
    const startAngle = animation.angle - sweepRange;
    const endAngle = animation.angle + sweepRange;
    const currentAngle = startAngle + (endAngle - startAngle) * progress;
    
    ctx.rotate(currentAngle);
    
    // 武器起点在身体边缘
    ctx.translate(16, 0);
    
    // 绘制棍
    this.drawWeapon(ctx, config);
  }

  /**
   * 绘制武器
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} config - 武器配置
   */
  drawWeapon(ctx, config) {
    // 绘制武器主体（矩形）
    ctx.fillStyle = config.weaponColor;
    ctx.fillRect(0, -config.weaponWidth / 2, config.weaponLength, config.weaponWidth);
    
    // 绘制武器边框
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, -config.weaponWidth / 2, config.weaponLength, config.weaponWidth);
    
    // 绘制握柄（深色部分）
    ctx.fillStyle = '#654321';
    ctx.fillRect(0, -config.weaponWidth / 2, config.weaponLength * 0.2, config.weaponWidth);
  }

  /**
   * 缓动函数 - 先加速后减速
   * @param {number} t - 进度 (0-1)
   * @returns {number}
   */
  easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /**
   * 检查敌人是否可以攻击（基于攻击速度）
   * @param {Entity} entity - 敌人实体
   * @param {number} currentTime - 当前时间（秒）
   * @returns {boolean}
   */
  canAttack(entity, currentTime) {
    const combat = entity.getComponent('combat');
    if (!combat) return false;
    
    const config = this.getWeaponConfig(entity);
    const cooldownTime = 1.0 / config.attackSpeed;
    
    // 检查冷却时间
    const timeSinceLastAttack = currentTime - (combat.lastAttackTime || 0);
    return timeSinceLastAttack >= cooldownTime;
  }

  /**
   * 清理实体的动画状态
   * @param {string} entityId - 实体ID
   */
  clearAnimation(entityId) {
    this.attackAnimations.delete(entityId);
  }

  /**
   * 清理所有动画
   */
  cleanup() {
    this.attackAnimations.clear();
  }
}

export default EnemyWeaponRenderer;

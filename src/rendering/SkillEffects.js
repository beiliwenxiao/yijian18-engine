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
 * SkillEffects.js
 * 技能特效系统 - 为不同技能创建粒子特效
 */

/**
 * 技能特效管理器
 * 负责创建和管理技能相关的粒子特效
 */
export class SkillEffects {
  /**
   * @param {ParticleSystem} particleSystem - 粒子系统
   */
  constructor(particleSystem) {
    this.particleSystem = particleSystem;
    
    // 活跃的发射器列表
    this.activeEmitters = [];
    
    // 抛射物列表（如火球、箭矢等）
    this.projectiles = [];
    
    Logger.log('SkillEffects: Initialized');
  }

  /**
   * 更新所有特效
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    // 更新发射器
    for (let i = this.activeEmitters.length - 1; i >= 0; i--) {
      const emitter = this.activeEmitters[i];
      this.particleSystem.updateEmitter(emitter, deltaTime);
      
      // 移除不活跃的发射器
      if (!emitter.active) {
        this.activeEmitters.splice(i, 1);
      }
    }
    
    // 更新抛射物
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      this.updateProjectile(projectile, deltaTime);
      
      // 移除已完成的抛射物
      if (projectile.completed) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  /**
   * 更新抛射物
   * @param {Object} projectile - 抛射物对象
   * @param {number} deltaTime - 时间增量（秒）
   */
  updateProjectile(projectile, deltaTime) {
    projectile.position.x += projectile.velocity.x * deltaTime;
    projectile.position.y += projectile.velocity.y * deltaTime;
    projectile.elapsed += deltaTime;
    const progress = projectile.maxLife > 0
      ? Math.min(1, Math.max(0, projectile.elapsed / projectile.maxLife))
      : 1;
    projectile.elevation = Math.sin(progress * Math.PI) * (Number(projectile.arcHeight) || 0);

    if (projectile.trailConfig) {
      this.particleSystem.emit({
        ...projectile.trailConfig,
        position: { ...projectile.position }
      });
    }

    if (projectile.target) {
      const dx = projectile.target.x - projectile.position.x;
      const dy = projectile.target.y - projectile.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 20 || projectile.elapsed >= projectile.maxLife) {
        if (projectile.onHit) projectile.onHit({ ...projectile.target });
        projectile.completed = true;
      }
    } else if (projectile.elapsed >= projectile.maxLife) {
      projectile.completed = true;
    }
  }

  /**
   * 渲染抛射物
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} camera - 相机对象
   */
  render(ctx, camera) {
    const viewBounds = camera.getViewBounds();

    for (const projectile of this.projectiles) {
      const screenX = projectile.position.x - viewBounds.left;
      const screenY = projectile.position.y - viewBounds.top - (Number(projectile.elevation) || 0);

      ctx.save();
      ctx.fillStyle = projectile.color || '#ffffff';
      ctx.globalAlpha = 1 - (projectile.elapsed / projectile.maxLife);

      if (projectile.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(screenX, screenY, projectile.size || 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (projectile.shape === 'rect') {
        ctx.fillRect(
          screenX - (projectile.size || 5) / 2,
          screenY - (projectile.size || 5) / 2,
          projectile.size || 5,
          projectile.size || 5
        );
      }

      ctx.restore();
    }
  }

  /**
   * 创建技能释放特效
   * @param {string} skillId - 技能ID
   * @param {Object} position - 释放位置
   * @param {Object} target - 目标位置（可选）
   * @param {Function} onHit - 命中回调（可选）
   */
  createSkillEffect(skillId, position, target = null, onHit = null) {
    // 根据技能ID创建对应的特效
    switch (skillId) {
      // 通用攻击
      case 'basic_attack':
        this.createSlashEffect(position);
        break;
      
      // 战士技能
      case 'warrior_slash':
        this.createHeavySlashEffect(position);
        break;
      case 'warrior_charge':
        this.createChargeEffect(position, target);
        break;
      case 'warrior_defense':
        this.createShieldEffect(position);
        break;
      
      // 军师技能
      case 'strategist_fire_talisman':
        this.createFireballEffect(position, target, onHit);
        break;
      case 'strategist_binding_talisman':
        this.createIceLanceEffect(position, target, onHit);
        break;
      case 'strategist_talisman_water':
        this.createHealEffect(position);
        break;
      
      // Act1 场景技能
      case 'fireball':
        this.createFireballEffect(position, target, onHit);
        break;
      case 'ice_lance':
        this.createIceLanceEffect(position, target, onHit);
        break;
      case 'flame_burst':
        this.createFlameBurstEffect(position, target, onHit);
        break;
      
      // 新技能特效
      case 'flame_palm':
        this.createFlamePalmEffect(position, target, onHit);
        break;
      case 'one_yang_finger':
        this.createOneYangFingerEffect(position, target, onHit);
        break;
      case 'ice_finger':
        this.createIceFingerEffect(position, target, onHit);
        break;
      case 'inferno_palm':
        this.createInfernoPalmEffect(position, target, onHit);
        break;
      case 'meditation':
        this.createMeditationEffect(position);
        break;
      
      // 弓箭手技能
      case 'archer_multi_shot':
        this.createMultiArrowEffect(position, target, onHit);
        break;
      case 'archer_poison_arrow':
        this.createPoisonArrowEffect(position, target, onHit);
        break;
      case 'archer_trap':
        this.createTrapEffect(position);
        break;
      
      default:
        console.warn(`SkillEffects: Unknown skill effect: ${skillId}`);
        this.createDefaultEffect(position);
    }
  }

  /**
   * 创建斩击特效
   * @param {Object} position - 位置
   */
  createSlashEffect(position) {
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 300, // 毫秒
        size: 4,
        color: '#ffffff',
        gravity: 0
      },
      8,
      {
        velocityRange: { min: 50, max: 100 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 3, max: 6 }
      }
    );
  }

  /**
   * 创建强力斩击特效
   * @param {Object} position - 位置
   */
  createHeavySlashEffect(position) {
    // 更大更持久的斩击效果
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 500, // 毫秒
        size: 8,
        color: '#ff6600',
        gravity: 0
      },
      15,
      {
        velocityRange: { min: 80, max: 150 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 6, max: 10 }
      }
    );
  }

  /**
   * 创建冲锋特效
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   */
  createChargeEffect(position, target) {
    if (!target) return;
    
    // 创建冲锋尾迹发射器
    const emitter = this.particleSystem.createEmitter({
      position: { ...position },
      particleConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 500, // 毫秒
        size: 6,
        color: '#ffaa00',
        gravity: 0
      },
      rate: 30,
      duration: 0.5
    });
    
    this.activeEmitters.push(emitter);
  }

  /**
   * 创建护盾特效
   * @param {Object} position - 位置
   */
  createShieldEffect(position) {
    // 创建环形粒子效果
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = 40;
      
      this.particleSystem.emit({
        position: {
          x: position.x + Math.cos(angle) * radius,
          y: position.y + Math.sin(angle) * radius
        },
        velocity: { x: 0, y: 0 },
        life: 1000, // 毫秒
        size: 5,
        color: '#4444ff',
        gravity: 0
      });
    }
  }

  /**
   * 创建火球特效
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createFireballEffect(position, target, onHit) {
    if (!target) return;
    
    // 计算方向
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const speed = 300; // 像素/秒
    
    // 创建火球抛射物
    const projectile = {
      position: { ...position },
      velocity: {
        x: (dx / distance) * speed,
        y: (dy / distance) * speed
      },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      size: 10,
      color: '#ff4400',
      shape: 'circle',
      trailConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 400, // 毫秒
        size: 8,
        color: '#ff6600',
        gravity: 0
      },
      onHit: (hitPos) => {
        this.createFireballHitEffect(hitPos);
        if (onHit) onHit(hitPos);
      },
      completed: false
    };
    
    this.projectiles.push(projectile);
  }

  /**
   * 创建火球命中特效
   * @param {Object} position - 命中位置
   */
  createFireballHitEffect(position) {
    // 爆炸效果
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 600, // 毫秒
        size: 10,
        color: '#ff4400',
        gravity: 50
      },
      25,
      {
        velocityRange: { min: 100, max: 200 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 8, max: 12 }
      }
    );
  }

  /** 创建带抛物线高度的投石车石弹，命中时复用爆炸粒子。 */
  createCatapultProjectile(position, target, { speed = 260, arcHeight = 120, onHit = null } = {}) {
    if (!target) return false;
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) {
      this.createFireballHitEffect(position);
      onHit?.(position);
      return true;
    }
    this.projectiles.push({
      position: { ...position },
      velocity: { x: (dx / distance) * speed, y: (dy / distance) * speed },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      arcHeight,
      elevation: 0,
      size: 13,
      color: '#4a4035',
      shape: 'circle',
      trailConfig: {
        position: { ...position }, velocity: { x: 0, y: 0 }, life: 260,
        size: 5, color: '#8b7355', gravity: 25
      },
      onHit: hitPos => {
        this.createFireballHitEffect(hitPos);
        onHit?.(hitPos);
      },
      completed: false
    });
    return true;
  }

  /**
   * 创建冰枪特效
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createIceLanceEffect(position, target, onHit) {
    if (!target) return;
    
    // 计算方向
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const speed = 400; // 冰枪比火球快
    
    // 创建冰枪抛射物
    const projectile = {
      position: { ...position },
      velocity: {
        x: (dx / distance) * speed,
        y: (dy / distance) * speed
      },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      size: 8,
      color: '#44ccff',
      shape: 'rect',
      trailConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 300, // 毫秒
        size: 6,
        color: '#88ddff',
        gravity: 0
      },
      onHit: (hitPos) => {
        this.createIceLanceHitEffect(hitPos);
        if (onHit) onHit(hitPos);
      },
      completed: false
    };
    
    this.projectiles.push(projectile);
  }

  /**
   * 创建冰枪命中特效
   * @param {Object} position - 命中位置
   */
  createIceLanceHitEffect(position) {
    // 冰晶爆裂效果
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 500, // 毫秒
        size: 8,
        color: '#44ccff',
        gravity: 100
      },
      20,
      {
        velocityRange: { min: 80, max: 150 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 6, max: 10 }
      }
    );
  }

  /**
   * 创建烈焰爆发特效
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createFlameBurstEffect(position, target, onHit) {
    if (!target) return;
    
    // 计算方向
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const speed = 400;
    
    // 创建更大的火焰球
    const projectile = {
      position: { ...position },
      velocity: {
        x: (dx / distance) * speed,
        y: (dy / distance) * speed
      },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      size: 16, // 更大的尺寸
      color: '#ff2200',
      shape: 'circle',
      trailConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 600, // 更持久的尾迹
        size: 12,
        color: '#ff4400',
        gravity: 0
      },
      onHit: (hitPos) => {
        this.createFlameBurstHitEffect(hitPos);
        if (onHit) onHit(hitPos);
      },
      completed: false
    };
    
    this.projectiles.push(projectile);
  }

  /**
   * 创建烈焰爆发命中特效
   * @param {Object} position - 命中位置
   */
  createFlameBurstHitEffect(position) {
    // 大范围爆炸效果
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 800, // 更持久
        size: 14,
        color: '#ff2200',
        gravity: 30
      },
      40, // 更多粒子
      {
        velocityRange: { min: 150, max: 300 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 10, max: 16 }
      }
    );
    
    // 额外的火焰环效果
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 600,
        size: 10,
        color: '#ff6600',
        gravity: 0
      },
      30,
      {
        velocityRange: { min: 100, max: 200 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 8, max: 12 }
      }
    );
  }

  /**
   * 创建治疗特效（从玩家位置向上飘）
   * @param {Object} position - 位置
   */
  createHealEffect(position) {
    // 创建少量向上飘动的治疗粒子（从玩家位置开始）
    const emitter = this.particleSystem.createEmitter({
      position: { ...position },
      particleConfig: {
        position: { ...position },
        velocity: { x: 0, y: -40 },
        life: 1200, // 毫秒
        size: 8,
        color: '#00ff88',
        gravity: -15 // 负重力，向上飘
      },
      rate: 8, // 减少发射率：从20降到8
      duration: 0.8 // 缩短持续时间
    });
    
    this.activeEmitters.push(emitter);
    
    // 简化的初始爆发效果（从玩家位置）
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: -30 },
        life: 800, // 毫秒
        size: 10,
        color: '#00ff88',
        gravity: -10
      },
      6, // 减少粒子数：从15降到6
      {
        velocityRange: { min: 20, max: 50 },
        angleRange: { min: -Math.PI / 3, max: -Math.PI * 2 / 3 }, // 向上的扇形范围
        sizeRange: { min: 8, max: 12 }
      }
    );
  }

  /**
   * 创建多重箭矢特效
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createMultiArrowEffect(position, target, onHit) {
    if (!target) return;
    
    // 创建3支箭，稍微分散
    const angles = [-0.2, 0, 0.2]; // 弧度偏移
    
    for (const angleOffset of angles) {
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      const baseAngle = Math.atan2(dy, dx);
      const angle = baseAngle + angleOffset;
      const speed = 350;
      
      const projectile = {
        position: { ...position },
        velocity: {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed
        },
        target: { ...target },
        elapsed: 0,
        maxLife: 1.5,
        size: 6,
        color: '#ffaa00',
        shape: 'rect',
        trailConfig: {
          position: { ...position },
          velocity: { x: 0, y: 0 },
          life: 200, // 毫秒
          size: 4,
          color: '#ffcc44',
          gravity: 0
        },
        onHit: (hitPos) => {
          this.createArrowHitEffect(hitPos);
          if (onHit) onHit(hitPos);
        },
        completed: false
      };
      
      this.projectiles.push(projectile);
    }
  }

  /**
   * 创建箭矢命中特效
   * @param {Object} position - 命中位置
   */
  createArrowHitEffect(position) {
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 300, // 毫秒
        size: 5,
        color: '#ffaa00',
        gravity: 0
      },
      10,
      {
        velocityRange: { min: 50, max: 100 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 3, max: 6 }
      }
    );
  }

  /**
   * 创建毒箭特效
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createPoisonArrowEffect(position, target, onHit) {
    if (!target) return;
    
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const speed = 350;
    
    const projectile = {
      position: { ...position },
      velocity: {
        x: (dx / distance) * speed,
        y: (dy / distance) * speed
      },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      size: 6,
      color: '#88ff00',
      shape: 'rect',
      trailConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 400, // 毫秒
        size: 5,
        color: '#66cc00',
        gravity: 0
      },
      onHit: (hitPos) => {
        this.createPoisonHitEffect(hitPos);
        if (onHit) onHit(hitPos);
      },
      completed: false
    };
    
    this.projectiles.push(projectile);
  }

  /**
   * 创建毒素命中特效
   * @param {Object} position - 命中位置
   */
  createPoisonHitEffect(position) {
    // 毒云效果
    const emitter = this.particleSystem.createEmitter({
      position: { ...position },
      particleConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 1000, // 毫秒
        size: 8,
        color: '#88ff00',
        gravity: -10
      },
      rate: 15,
      duration: 0.8
    });
    
    this.activeEmitters.push(emitter);
  }

  /**
   * 创建陷阱特效
   * @param {Object} position - 位置
   */
  createTrapEffect(position) {
    // 陷阱放置效果
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 500, // 毫秒
        size: 6,
        color: '#996633',
        gravity: 100
      },
      12,
      {
        velocityRange: { min: 40, max: 80 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 4, max: 8 }
      }
    );
  }

  /**
   * 创建默认特效
   * @param {Object} position - 位置
   */
  createDefaultEffect(position) {
    this.particleSystem.emitBurst(
      {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 500, // 毫秒
        size: 5,
        color: '#ffffff',
        gravity: 0
      },
      10,
      {
        velocityRange: { min: 50, max: 100 },
        angleRange: { min: 0, max: Math.PI * 2 }
      }
    );
  }

  /**
   * 创建火焰掌特效（一小坨火焰 + 溅射小火焰）
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createFlamePalmEffect(position, target, onHit) {
    if (!target) return;
    
    // 计算方向
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const speed = 350;
    
    // 创建主火焰球
    const projectile = {
      position: { ...position },
      velocity: {
        x: (dx / distance) * speed,
        y: (dy / distance) * speed
      },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      size: 12,
      color: '#ff6600',
      shape: 'circle',
      trailConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 400,
        size: 8,
        color: '#ff8800',
        gravity: 0
      },
      onHit: (hitPos) => {
        // 主火焰命中效果
        this.particleSystem.emitBurst(
          {
            position: { ...hitPos },
            velocity: { x: 0, y: 0 },
            life: 500,
            size: 10,
            color: '#ff6600',
            gravity: 50
          },
          20,
          {
            velocityRange: { min: 80, max: 150 },
            angleRange: { min: 0, max: Math.PI * 2 },
            sizeRange: { min: 8, max: 12 }
          }
        );
        
        // 溅射小火焰（8个方向）
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const splashSpeed = 150 + Math.random() * 100;
          const splashDistance = 40 + Math.random() * 30;
          
          // 创建溅射火焰粒子
          for (let j = 0; j < 5; j++) {
            this.particleSystem.emit({
              position: { ...hitPos },
              velocity: {
                x: Math.cos(angle) * splashSpeed,
                y: Math.sin(angle) * splashSpeed
              },
              life: 400,
              size: 4 + Math.random() * 4,
              color: '#ff4400',
              gravity: 100
            });
          }
        }
        
        if (onHit) onHit(hitPos);
      },
      completed: false
    };
    
    this.projectiles.push(projectile);
  }

  /**
   * 创建一阳指特效（直线攻击）
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createOneYangFingerEffect(position, target, onHit) {
    if (!target) return;
    
    // 计算方向
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const speed = 600; // 更快的速度
    
    // 创建金色光束
    const projectile = {
      position: { ...position },
      velocity: {
        x: (dx / distance) * speed,
        y: (dy / distance) * speed
      },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      size: 6,
      color: '#ffdd00',
      shape: 'rect',
      trailConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 300,
        size: 5,
        color: '#ffee88',
        gravity: 0
      },
      onHit: (hitPos) => {
        // 终点爆炸效果
        this.particleSystem.emitBurst(
          {
            position: { ...hitPos },
            velocity: { x: 0, y: 0 },
            life: 600,
            size: 12,
            color: '#ffdd00',
            gravity: 0
          },
          30,
          {
            velocityRange: { min: 100, max: 200 },
            angleRange: { min: 0, max: Math.PI * 2 },
            sizeRange: { min: 8, max: 14 }
          }
        );
        
        if (onHit) onHit(hitPos);
      },
      completed: false
    };
    
    this.projectiles.push(projectile);
  }

  /**
   * 创建寒冰指特效（冰蓝色直线攻击）
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createIceFingerEffect(position, target, onHit) {
    if (!target) return;
    
    // 计算方向
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const speed = 600; // 快速
    
    // 创建冰蓝色光束
    const projectile = {
      position: { ...position },
      velocity: {
        x: (dx / distance) * speed,
        y: (dy / distance) * speed
      },
      target: { ...target },
      elapsed: 0,
      maxLife: distance / speed,
      size: 6,
      color: '#00ccff',
      shape: 'rect',
      trailConfig: {
        position: { ...position },
        velocity: { x: 0, y: 0 },
        life: 300,
        size: 5,
        color: '#88ddff',
        gravity: 0
      },
      onHit: (hitPos) => {
        // 终点冰晶爆炸效果
        this.particleSystem.emitBurst(
          {
            position: { ...hitPos },
            velocity: { x: 0, y: 0 },
            life: 600,
            size: 12,
            color: '#00ccff',
            gravity: 0
          },
          30,
          {
            velocityRange: { min: 100, max: 200 },
            angleRange: { min: 0, max: Math.PI * 2 },
            sizeRange: { min: 8, max: 14 }
          }
        );
        
        // 额外的冰晶碎片
        this.particleSystem.emitBurst(
          {
            position: { ...hitPos },
            velocity: { x: 0, y: 0 },
            life: 400,
            size: 6,
            color: '#ffffff',
            gravity: 50
          },
          15,
          {
            velocityRange: { min: 80, max: 150 },
            angleRange: { min: 0, max: Math.PI * 2 },
            sizeRange: { min: 4, max: 8 }
          }
        );
        
        if (onHit) onHit(hitPos);
      },
      completed: false
    };
    
    this.projectiles.push(projectile);
  }

  /**
   * 创建烈焰掌特效（5大坨火焰）
   * @param {Object} position - 起始位置
   * @param {Object} target - 目标位置
   * @param {Function} onHit - 命中回调
   */
  createInfernoPalmEffect(position, target, onHit) {
    if (!target) return;
    
    // 计算基础方向
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 防止除以零
    if (distance < 1) {
      if (onHit) onHit(position);
      return;
    }
    
    const baseAngle = Math.atan2(dy, dx);
    
    // 创建5个火焰球，呈扇形分布
    const angles = [-0.3, -0.15, 0, 0.15, 0.3]; // 弧度偏移
    
    for (let i = 0; i < 5; i++) {
      const angle = baseAngle + angles[i];
      const speed = 300 + Math.random() * 50;
      
      // 计算目标位置（稍微分散）
      const targetX = target.x + Math.cos(angles[i]) * 50;
      const targetY = target.y + Math.sin(angles[i]) * 50;
      
      const projectile = {
        position: { ...position },
        velocity: {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed
        },
        target: { x: targetX, y: targetY },
        elapsed: 0,
        maxLife: distance / speed,
        size: 16,
        color: '#ff2200',
        shape: 'circle',
        trailConfig: {
          position: { ...position },
          velocity: { x: 0, y: 0 },
          life: 600,
          size: 12,
          color: '#ff4400',
          gravity: 0
        },
        onHit: (hitPos) => {
          // 大爆炸效果
          this.particleSystem.emitBurst(
            {
              position: { ...hitPos },
              velocity: { x: 0, y: 0 },
              life: 800,
              size: 16,
              color: '#ff2200',
              gravity: 30
            },
            40,
            {
              velocityRange: { min: 150, max: 300 },
              angleRange: { min: 0, max: Math.PI * 2 },
              sizeRange: { min: 12, max: 18 }
            }
          );
          
          if (onHit) onHit(hitPos);
        },
        completed: false
      };
      
      this.projectiles.push(projectile);
    }
  }

  /**
   * 创建打坐特效（头顶缓慢飘动的烟雾）
   * @param {Object} position - 位置
   */
  createMeditationEffect(position) {
    // 保存打坐发射器引用
    this.meditationEmitter = this.particleSystem.createEmitter({
      position: { x: position.x, y: position.y - 50 }, // 头顶位置
      particleConfig: {
        position: { x: position.x, y: position.y - 50 },
        velocity: { x: 0, y: -8 }, // 缓慢向上飘
        life: 800, // 较短的生命周期（0.8秒）
        size: 6,
        color: '#aaddff',
        gravity: -5 // 轻微负重力
      },
      rate: 4, // 每秒4个粒子，更稀疏
      duration: 999 // 持续很长时间（由外部控制停止）
    });
    
    this.activeEmitters.push(this.meditationEmitter);
    
    return this.meditationEmitter;
  }

  /**
   * 更新打坐特效位置（跟随玩家）
   * @param {Object} position - 玩家位置
   */
  updateMeditationPosition(position) {
    if (this.meditationEmitter && this.meditationEmitter.active) {
      this.meditationEmitter.position.x = position.x;
      this.meditationEmitter.position.y = position.y - 50;
      this.meditationEmitter.particleConfig.position.x = position.x;
      this.meditationEmitter.particleConfig.position.y = position.y - 50;
    }
  }

  /**
   * 停止打坐特效
   */
  stopMeditationEffect() {
    // 停止打坐发射器
    if (this.meditationEmitter) {
      this.meditationEmitter.active = false;
      const index = this.activeEmitters.indexOf(this.meditationEmitter);
      if (index !== -1) {
        this.activeEmitters.splice(index, 1);
      }
      this.meditationEmitter = null;
    }
    
    // 备用：停止所有打坐相关的发射器（通过颜色判断）
    for (let i = this.activeEmitters.length - 1; i >= 0; i--) {
      const emitter = this.activeEmitters[i];
      if (emitter.particleConfig && emitter.particleConfig.color === '#88ccff') {
        emitter.active = false;
        this.activeEmitters.splice(i, 1);
      }
    }
  }

  /**
   * 清除所有特效
   */
  clear() {
    this.activeEmitters = [];
    this.projectiles = [];
  }
}

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

import { Particle } from './Particle.js';

/**
 * ParticleSystem - 粒子系统
 * 管理粒子池，创建和更新粒子
 */
export class ParticleSystem {
  /**
   * @param {number} [maxParticles=1000] - 最大粒子数量
   */
  constructor(maxParticles = 1000) {
    this.maxParticles = maxParticles;
    this.particles = [];
    this.particlePool = [];
    
    // 预创建粒子池
    this.initializePool();
  }

  /**
   * 初始化粒子池
   */
  initializePool() {
    for (let i = 0; i < this.maxParticles; i++) {
      const particle = new Particle({
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        life: 0,
        size: 1,
        color: '#ffffff'
      });
      particle.active = false;
      this.particlePool.push(particle);
    }
  }

  /**
   * 从池中获取粒子
   * @returns {Particle|null}
   */
  getParticleFromPool() {
    // 先尝试从池中获取
    if (this.particlePool.length > 0) {
      return this.particlePool.pop();
    }
    
    // 如果池为空，尝试回收不活跃的粒子
    for (let i = 0; i < this.particles.length; i++) {
      if (!this.particles[i].active) {
        const particle = this.particles.splice(i, 1)[0];
        return particle;
      }
    }
    
    // 如果达到最大数量，返回 null
    if (this.particles.length >= this.maxParticles) {
      return null;
    }
    
    // 创建新粒子
    return new Particle({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      life: 0,
      size: 1,
      color: '#ffffff'
    });
  }

  /**
   * 归还粒子到池中
   * @param {Particle} particle
   */
  returnParticleToPool(particle) {
    particle.active = false;
    this.particlePool.push(particle);
  }

  /**
   * 发射单个粒子
   * @param {Object} config - 粒子配置
   */
  emit(config) {
    const particle = this.getParticleFromPool();
    if (particle) {
      particle.reset(config);
      this.particles.push(particle);
    }
  }

  /**
   * 发射粒子爆发
   * @param {Object} config - 基础粒子配置
   * @param {number} count - 粒子数量
   * @param {Object} [spread] - 扩散配置
   */
  emitBurst(config, count, spread = {}) {
    const {
      velocityRange = { min: 50, max: 150 },
      angleRange = { min: 0, max: Math.PI * 2 },
      sizeRange = { min: config.size * 0.5, max: config.size * 1.5 },
      lifeRange = { min: config.life * 0.8, max: config.life * 1.2 }
    } = spread;

    for (let i = 0; i < count; i++) {
      const angle = angleRange.min + Math.random() * (angleRange.max - angleRange.min);
      const speed = velocityRange.min + Math.random() * (velocityRange.max - velocityRange.min);
      
      this.emit({
        ...config,
        velocity: {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed
        },
        size: sizeRange.min + Math.random() * (sizeRange.max - sizeRange.min),
        life: lifeRange.min + Math.random() * (lifeRange.max - lifeRange.min)
      });
    }
  }

  /**
   * 创建持续发射器
   * @param {Object} config - 发射器配置
   * @returns {Object} 发射器对象
   */
  createEmitter(config) {
    const emitter = {
      position: { ...config.position },
      particleConfig: { ...config.particleConfig },
      rate: config.rate || 10, // 每秒发射粒子数
      duration: config.duration || Infinity,
      active: true,
      elapsed: 0,
      accumulator: 0,
      // 可选逐粒子速度抖动（如烟雾飘散）：{ x: 全幅, y: 全幅 }，缺省不抖动
      velocityJitter: config.velocityJitter || null,
      // 可选逐粒子发射位置散布（如火焰底部的横向铺开）：{ x: 全幅 }，缺省不散布
      positionJitter: config.positionJitter || null
    };

    return emitter;
  }

  /**
   * 更新发射器
   * @param {Object} emitter - 发射器对象
   * @param {number} deltaTime - 时间增量（秒）
   */
  updateEmitter(emitter, deltaTime) {
    if (!emitter.active) return;

    emitter.elapsed += deltaTime;
    if (emitter.elapsed >= emitter.duration) {
      emitter.active = false;
      return;
    }

    emitter.accumulator += deltaTime;
    const interval = 1 / emitter.rate;

    while (emitter.accumulator >= interval) {
      const config = {
        ...emitter.particleConfig,
        position: { ...emitter.position }
      };
      const spread = emitter.positionJitter;
      if (spread?.x) {
        config.position.x += (Math.random() - 0.5) * spread.x;
      }
      const jitter = emitter.velocityJitter;
      if (jitter) {
        config.velocity = { ...(config.velocity || { x: 0, y: 0 }) };
        config.velocity.x += (Math.random() - 0.5) * jitter.x;
        config.velocity.y += (Math.random() - 0.5) * jitter.y;
      }
      this.emit(config);
      emitter.accumulator -= interval;
    }
  }

  /**
   * 更新所有粒子
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    // 使用双指针法批量删除，避免 splice O(n²)
    let writeIndex = 0;
    for (let readIndex = 0, len = this.particles.length; readIndex < len; readIndex++) {
      const particle = this.particles[readIndex];
      particle.update(deltaTime);
      
      if (particle.active) {
        // 保留活跃粒子
        if (writeIndex !== readIndex) {
          this.particles[writeIndex] = particle;
        }
        writeIndex++;
      } else {
        // 回收不活跃粒子
        this.returnParticleToPool(particle);
      }
    }
    // 截断数组
    this.particles.length = writeIndex;
  }

  /**
   * 渲染顶层粒子。进入 worldDepth 队列的粒子由 collectDepthSorted() 绘制，避免重复。
   * @param {CanvasRenderingContext2D} ctx - Canvas 渲染上下文
   * @param {Object} camera - 相机对象
   */
  render(ctx, camera) {
    for (const particle of this.particles) {
      if (particle.renderLayer === 'worldDepth') continue;
      particle.render(ctx, camera);
    }
  }

  /**
   * 把显式 worldDepth 粒子加入场景实体 Y-sort 队列。
   * @param {Array} renderQueue
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} camera
   * @param {{left:number,top:number,right:number,bottom:number}} [viewBounds]
   */
  collectDepthSorted(renderQueue, ctx, camera, viewBounds = null) {
    for (const particle of this.particles) {
      if (!particle.active || particle.renderLayer !== 'worldDepth') continue;
      const padding = Math.max(4, particle.size || 1) * 2;
      if (viewBounds &&
          (particle.position.x + padding < viewBounds.left || particle.position.x - padding > viewBounds.right ||
           particle.position.y + padding < viewBounds.top || particle.position.y - padding > viewBounds.bottom)) {
        continue;
      }
      let item = particle._worldDepthQueueItem;
      if (!item) {
        item = {
          type: 'particle',
          y: 0,
          sortPriority: 1,
          particle,
          ctx: null,
          camera: null,
          render() { this.particle.render(this.ctx, this.camera); }
        };
        particle._worldDepthQueueItem = item;
      }
      item.y = particle.sortY;
      item.ctx = ctx;
      item.camera = camera;
      renderQueue.push(item);
    }
  }

  /**
   * 清除所有粒子
   */
  clear() {
    for (const particle of this.particles) {
      this.returnParticleToPool(particle);
    }
    this.particles = [];
  }

  /**
   * 获取活跃粒子数量
   * @returns {number}
   */
  getActiveCount() {
    return this.particles.length;
  }

  /**
   * 获取池中粒子数量
   * @returns {number}
   */
  getPoolCount() {
    return this.particlePool.length;
  }
}

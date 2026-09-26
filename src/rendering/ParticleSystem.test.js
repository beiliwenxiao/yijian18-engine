import { describe, it, expect, beforeEach } from 'vitest';
import { Particle } from './Particle.js';
import { ParticleSystem } from './ParticleSystem.js';

describe('Particle', () => {
  it('应该正确初始化粒子', () => {
    const particle = new Particle({
      position: { x: 100, y: 200 },
      velocity: { x: 50, y: -50 },
      life: 1000,
      size: 5,
      color: '#ff0000',
      alpha: 0.8
    });

    expect(particle.position).toEqual({ x: 100, y: 200 });
    expect(particle.velocity).toEqual({ x: 50, y: -50 });
    expect(particle.life).toBe(1000);
    expect(particle.maxLife).toBe(1000);
    expect(particle.size).toBe(5);
    expect(particle.color).toBe('#ff0000');
    expect(particle.alpha).toBe(0.8);
    expect(particle.active).toBe(true);
  });

  it('应该在生命周期结束后变为不活跃', () => {
    const particle = new Particle({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      life: 100,
      size: 5,
      color: '#ffffff'
    });

    particle.update(0.2); // 200ms
    expect(particle.active).toBe(false);
  });

  it('应该正确更新位置', () => {
    const particle = new Particle({
      position: { x: 0, y: 0 },
      velocity: { x: 100, y: 50 },
      life: 1000,
      size: 5,
      color: '#ffffff'
    });

    particle.update(0.1); // 100ms
    expect(particle.position.x).toBeCloseTo(10);
    expect(particle.position.y).toBeCloseTo(5);
  });

  it('应该随生命周期衰减透明度（前80%保持明亮，最后20%快速消失）', () => {
    const particle = new Particle({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      life: 1000,
      size: 5,
      color: '#ffffff',
      alpha: 1
    });

    // 前 80% 生命周期保持初始透明度（火焰粒子明亮阶段）
    particle.update(0.5); // 500ms，生命周期剩余50%
    expect(particle.alpha).toBe(1);
    // 最后 20% 线性快速衰减
    particle.update(0.45); // 950ms，剩余 5%
    expect(particle.alpha).toBeCloseTo(0.25, 1);
  });

  it('应该应用重力', () => {
    const particle = new Particle({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      life: 1000,
      size: 5,
      color: '#ffffff',
      gravity: 100
    });

    particle.update(0.1);
    expect(particle.velocity.y).toBeCloseTo(10);
  });
});

describe('ParticleSystem', () => {
  let particleSystem;

  beforeEach(() => {
    particleSystem = new ParticleSystem(100);
  });

  it('应该正确初始化粒子池', () => {
    expect(particleSystem.getPoolCount()).toBe(100);
    expect(particleSystem.getActiveCount()).toBe(0);
  });

  it('应该能够发射单个粒子', () => {
    particleSystem.emit({
      position: { x: 100, y: 100 },
      velocity: { x: 50, y: -50 },
      life: 1000,
      size: 5,
      color: '#ff0000'
    });

    expect(particleSystem.getActiveCount()).toBe(1);
    expect(particleSystem.getPoolCount()).toBe(99);
  });

  it('应该能够发射粒子爆发', () => {
    particleSystem.emitBurst({
      position: { x: 100, y: 100 },
      velocity: { x: 0, y: 0 },
      life: 1000,
      size: 5,
      color: '#ff0000'
    }, 10);

    expect(particleSystem.getActiveCount()).toBe(10);
  });

  it('应该正确更新粒子', () => {
    particleSystem.emit({
      position: { x: 0, y: 0 },
      velocity: { x: 100, y: 0 },
      life: 100,
      size: 5,
      color: '#ffffff'
    });

    particleSystem.update(0.05);
    expect(particleSystem.getActiveCount()).toBe(1);

    particleSystem.update(0.1); // 总共150ms，超过生命周期
    expect(particleSystem.getActiveCount()).toBe(0);
    expect(particleSystem.getPoolCount()).toBe(100); // 粒子应该回到池中
  });

  it('应该能够清除所有粒子', () => {
    particleSystem.emitBurst({
      position: { x: 100, y: 100 },
      velocity: { x: 0, y: 0 },
      life: 1000,
      size: 5,
      color: '#ff0000'
    }, 20);

    expect(particleSystem.getActiveCount()).toBe(20);
    
    particleSystem.clear();
    expect(particleSystem.getActiveCount()).toBe(0);
    expect(particleSystem.getPoolCount()).toBe(100);
  });

  it('应该正确处理发射器', () => {
    const emitter = particleSystem.createEmitter({
      position: { x: 100, y: 100 },
      particleConfig: {
        position: { x: 100, y: 100 },
        velocity: { x: 50, y: -50 },
        life: 1000,
        size: 5,
        color: '#00ff00'
      },
      rate: 10, // 每秒10个粒子
      duration: 1
    });

    expect(emitter.active).toBe(true);

    // 更新0.5秒，应该发射约5个粒子
    particleSystem.updateEmitter(emitter, 0.5);
    expect(particleSystem.getActiveCount()).toBeGreaterThanOrEqual(4);
    expect(particleSystem.getActiveCount()).toBeLessThanOrEqual(6);

    // 更新超过持续时间
    particleSystem.updateEmitter(emitter, 1);
    expect(emitter.active).toBe(false);
  });

  it('应该限制最大粒子数量', () => {
    const smallSystem = new ParticleSystem(10);
    
    // 尝试发射超过最大数量的粒子
    smallSystem.emitBurst({
      position: { x: 100, y: 100 },
      velocity: { x: 0, y: 0 },
      life: 1000,
      size: 5,
      color: '#ff0000'
    }, 20);

    expect(smallSystem.getActiveCount()).toBeLessThanOrEqual(10);
  });
});

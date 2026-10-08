/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { describe, it, expect, beforeEach } from 'vitest';
import { CombatEffects } from './CombatEffects.js';
import { ParticleSystem } from './ParticleSystem.js';
import { Entity } from '../ecs/Entity.js';

describe('CombatEffects', () => {
  let particleSystem;
  let combatEffects;

  beforeEach(() => {
    particleSystem = new ParticleSystem(1000);
    combatEffects = new CombatEffects(particleSystem);
  });

  describe('伤害数字', () => {
    it('应该能够创建伤害数字', () => {
      combatEffects.createDamageNumber(100, { x: 100, y: 100 }, 'damage');
      
      expect(combatEffects.getActiveDamageNumberCount()).toBe(1);
    });

    it('应该能够创建治疗数字', () => {
      combatEffects.createDamageNumber(50, { x: 100, y: 100 }, 'heal');
      
      expect(combatEffects.getActiveDamageNumberCount()).toBe(1);
      expect(particleSystem.getActiveCount()).toBeGreaterThan(0);
    });

    it('应该能够创建暴击数字', () => {
      combatEffects.createDamageNumber(200, { x: 100, y: 100 }, 'critical');
      
      expect(combatEffects.getActiveDamageNumberCount()).toBe(1);
      expect(particleSystem.getActiveCount()).toBeGreaterThan(0);
    });

    it('伤害数字应该随时间更新', () => {
      combatEffects.createDamageNumber(100, { x: 100, y: 100 });
      
      const initialY = combatEffects.damageNumbers[0].position.y;
      combatEffects.updateDamageNumbers(0.1);
      
      expect(combatEffects.damageNumbers[0].position.y).not.toBe(initialY);
    });

    it('伤害数字生命周期结束后应该被移除', () => {
      combatEffects.createDamageNumber(100, { x: 100, y: 100 });
      
      combatEffects.updateDamageNumbers(2.0); // 超过生命周期
      
      expect(combatEffects.getActiveDamageNumberCount()).toBe(0);
    });

    it('应该能够同时显示多个伤害数字', () => {
      combatEffects.createDamageNumber(100, { x: 100, y: 100 });
      combatEffects.createDamageNumber(50, { x: 150, y: 150 });
      combatEffects.createDamageNumber(200, { x: 200, y: 200 });
      
      expect(combatEffects.getActiveDamageNumberCount()).toBe(3);
    });
  });

  describe('闪烁效果', () => {
    it('应该能够创建闪烁效果', () => {
      const entity = new Entity('test');
      combatEffects.createFlashEffect(entity, 300, '#ffffff');
      
      expect(combatEffects.getActiveFlashEffectCount()).toBe(1);
    });

    it('闪烁效果应该随时间更新', () => {
      const entity = new Entity('test');
      combatEffects.createFlashEffect(entity, 300);
      
      combatEffects.updateFlashEffects(0.1);
      
      expect(combatEffects.flashEffects[0].elapsed).toBeGreaterThan(0);
    });

    it('闪烁效果持续时间结束后应该被移除', () => {
      const entity = new Entity('test');
      combatEffects.createFlashEffect(entity, 300);
      
      combatEffects.updateFlashEffects(0.4); // 超过持续时间
      
      expect(combatEffects.getActiveFlashEffectCount()).toBe(0);
    });

    it('应该能够检测实体是否有活跃的闪烁效果', () => {
      const entity = new Entity('test');
      const ctx = {
        globalCompositeOperation: 'source-over',
        globalAlpha: 1
      };
      
      combatEffects.createFlashEffect(entity, 300);
      
      const hasFlash = combatEffects.applyFlashEffect(ctx, entity);
      expect(hasFlash).toBe(true);
    });
  });

  describe('治疗特效', () => {
    it('应该能够创建治疗特效', () => {
      const emitter = combatEffects.createHealEffect({ x: 100, y: 100 }, 50);
      
      expect(emitter).toBeDefined();
      expect(combatEffects.getActiveDamageNumberCount()).toBe(1);
      expect(particleSystem.getActiveCount()).toBeGreaterThan(0);
    });
  });

  describe('暴击特效', () => {
    it('应该能够创建暴击特效', () => {
      combatEffects.createCriticalEffect({ x: 100, y: 100 }, 200);
      
      expect(combatEffects.getActiveDamageNumberCount()).toBe(1);
      expect(particleSystem.getActiveCount()).toBeGreaterThan(0);
    });
  });

  describe('格挡特效', () => {
    it('应该能够创建格挡特效', () => {
      combatEffects.createBlockEffect({ x: 100, y: 100 });
      
      expect(particleSystem.getActiveCount()).toBeGreaterThan(0);
    });
  });

  describe('闪避特效', () => {
    it('应该能够创建闪避特效', () => {
      combatEffects.createDodgeEffect({ x: 100, y: 100 });
      
      expect(particleSystem.getActiveCount()).toBeGreaterThan(0);
    });
  });

  describe('更新和渲染', () => {
    it('应该能够更新所有战斗特效', () => {
      combatEffects.createDamageNumber(100, { x: 100, y: 100 });
      const entity = new Entity('test');
      combatEffects.createFlashEffect(entity, 300);
      
      combatEffects.update(0.1);
      
      // 验证更新后状态改变
      expect(combatEffects.damageNumbers[0].life).toBeLessThan(1500);
      expect(combatEffects.flashEffects[0].elapsed).toBeGreaterThan(0);
    });

    it('应该能够清除所有战斗特效', () => {
      combatEffects.createDamageNumber(100, { x: 100, y: 100 });
      const entity = new Entity('test');
      combatEffects.createFlashEffect(entity, 300);
      
      combatEffects.clear();
      
      expect(combatEffects.getActiveDamageNumberCount()).toBe(0);
      expect(combatEffects.getActiveFlashEffectCount()).toBe(0);
    });
  });
});

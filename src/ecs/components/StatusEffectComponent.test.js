/**
 * StatusEffectComponent.test.js
 * 状态效果组件单元测试
 */

import { describe, it, expect } from 'vitest';
import { StatusEffectComponent, StatusEffectType, StatusEffect } from './StatusEffectComponent.js';
import { Entity } from '../Entity.js';
import { StatsComponent } from './StatsComponent.js';

const expectApprox = (actual, expected, tolerance = 0.01, message) =>
  expect(Math.abs(actual - expected), message).toBeLessThanOrEqual(tolerance);

// 创建测试实体
function createTestEntity() {
  const entity = new Entity('test-entity', 'player');
  const stats = new StatsComponent({
    maxHp: 100,
    maxMp: 100,
    attack: 20,
    defense: 10,
    speed: 100
  });
  entity.addComponent(stats);
  return entity;
}

describe('StatusEffect', () => {
  it('基础功能', () => {
    const effect = new StatusEffect(StatusEffectType.POISON, 5.0, 1);

    expect(effect.type).toBe(StatusEffectType.POISON);
    expect(effect.duration).toBe(5.0);
    expect(effect.remainingTime).toBe(5.0);
    expect(effect.intensity).toBe(1);
    expect(effect.data.name).toBe('中毒');
  });

  it('时间更新', () => {
    const effect = new StatusEffect(StatusEffectType.HASTE, 3.0, 1);

    // 更新1秒
    const stillActive = effect.update(1.0);
    expect(stillActive).toBe(true);
    expectApprox(effect.remainingTime, 2.0, 0.01, '剩余时间应该减少1秒');

    // 更新到过期
    effect.update(2.5);
    expect(effect.isExpired()).toBe(true);
  });
});

describe('StatusEffectComponent', () => {
  it('添加效果', () => {
    const component = new StatusEffectComponent();

    // 添加中毒效果
    const success = component.addEffect(StatusEffectType.POISON, 5.0, 1);
    expect(success).toBe(true);
    expect(component.hasEffect(StatusEffectType.POISON)).toBe(true);
    expect(component.getEffectCount()).toBe(1);
  });

  it('效果替换', () => {
    const component = new StatusEffectComponent();

    // 添加弱中毒效果
    component.addEffect(StatusEffectType.POISON, 3.0, 1);

    // 添加强中毒效果（应该替换）
    const success = component.addEffect(StatusEffectType.POISON, 5.0, 2);
    expect(success).toBe(true);

    const effect = component.getEffect(StatusEffectType.POISON);
    expect(effect.duration).toBe(5.0);
    expect(effect.intensity).toBe(2);
  });

  it('属性修改器', () => {
    const component = new StatusEffectComponent();

    // 添加狂暴效果（攻击力+30%）
    component.addEffect(StatusEffectType.RAGE, 5.0, 1);

    // 添加护盾效果（防御力+20）
    component.addEffect(StatusEffectType.SHIELD, 5.0, 1);

    // 添加加速效果（速度+50%）
    component.addEffect(StatusEffectType.HASTE, 5.0, 1);

    // 强制重新计算修改器
    component.needsRecalculation = true;
    component.recalculateModifiers();

    // 测试修改后的属性
    const modifiedAttack = component.getModifiedAttack(100);
    const modifiedDefense = component.getModifiedDefense(50);
    const modifiedSpeed = component.getModifiedSpeed(100);

    expectApprox(modifiedAttack, 130, 1, '攻击力应该增加30%');
    expectApprox(modifiedDefense, 70, 1, '防御力应该增加20');
    expectApprox(modifiedSpeed, 150, 1, '速度应该增加50%');
  });

  it('效果更新', () => {
    const entity = createTestEntity();
    const component = new StatusEffectComponent();
    entity.addComponent(component);

    // 添加恢复效果
    component.addEffect(StatusEffectType.REGENERATION, 2.0, 1);

    // 模拟1秒更新
    component.update(1.0, entity);

    // 检查恢复效果是否仍然存在（恢复在 triggerEffect 中处理）
    expect(component.hasEffect(StatusEffectType.REGENERATION)).toBe(true);

    // 模拟效果过期
    component.update(1.5, entity);
    expect(component.hasEffect(StatusEffectType.REGENERATION)).toBe(false);
  });

  it('清除效果', () => {
    const component = new StatusEffectComponent();

    // 添加多个效果
    component.addEffect(StatusEffectType.POISON, 5.0, 1);
    component.addEffect(StatusEffectType.HASTE, 5.0, 1);
    component.addEffect(StatusEffectType.RAGE, 5.0, 1);
    component.addEffect(StatusEffectType.WEAKNESS, 5.0, 1);

    expect(component.getEffectCount()).toBe(4);

    // 清除Buff
    component.clearEffectsByType('buff');
    expect(component.hasEffect(StatusEffectType.HASTE)).toBe(false);
    expect(component.hasEffect(StatusEffectType.RAGE)).toBe(false);
    expect(component.hasEffect(StatusEffectType.POISON)).toBe(true);
    expect(component.hasEffect(StatusEffectType.WEAKNESS)).toBe(true);

    // 清除Debuff
    component.clearEffectsByType('debuff');
    expect(component.getEffectCount()).toBe(0);
  });

  it('Buff/Debuff 计数', () => {
    const component = new StatusEffectComponent();

    // 添加Buff
    component.addEffect(StatusEffectType.HASTE, 5.0, 1);
    component.addEffect(StatusEffectType.RAGE, 5.0, 1);

    // 添加Debuff
    component.addEffect(StatusEffectType.POISON, 5.0, 1);
    component.addEffect(StatusEffectType.WEAKNESS, 5.0, 1);

    expect(component.getBuffCount()).toBe(2);
    expect(component.getDebuffCount()).toBe(2);
    expect(component.getEffectCount()).toBe(4);
  });
});

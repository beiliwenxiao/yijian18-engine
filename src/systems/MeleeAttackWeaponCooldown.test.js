/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @file      MeleeAttackSystem 武器冷却解析测试
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { MeleeAttackSystem } from './MeleeAttackSystem.js';

/** 构造带装备槽的玩家桩：equipment 组件按槽位返回装备对象 */
function makePlayer(equipment = {}) {
  return {
    getComponent(name) {
      if (name !== 'equipment') return null;
      return {
        getEquipment: slot => equipment[slot] || null
      };
    }
  };
}

describe('MeleeAttackSystem 武器冷却解析（attackSpeed / attackSpeedReduce 词条）', () => {
  it('无装备时使用全局默认冷却（3秒）', () => {
    const system = new MeleeAttackSystem();
    system.playerEntity = makePlayer();
    expect(system._resolveWeaponCooldown()).toBe(3.0);
  });

  it('主手 attackSpeed 覆盖全局冷却', () => {
    const system = new MeleeAttackSystem();
    system.playerEntity = makePlayer({ mainhand: { attackSpeed: 0.8 } });
    expect(system._resolveWeaponCooldown()).toBe(0.8);
  });

  it('狼牙词条：默认冷却3秒 ≥ 门槛1秒 → 缩短1.5秒（3→1.5）', () => {
    const system = new MeleeAttackSystem();
    system.playerEntity = makePlayer({
      mainhand: {
        attackSpeedReduce: { thresholdSec: 1, reduceSec: 1.5, minSec: 0.5 }
      }
    });
    expect(system._resolveWeaponCooldown()).toBeCloseTo(1.5, 10);
  });

  it('冷却低于门槛时不触发缩短（attackSpeed 0.8 + 门槛1 → 保持0.8）', () => {
    const system = new MeleeAttackSystem();
    system.playerEntity = makePlayer({
      mainhand: {
        attackSpeed: 0.8,
        attackSpeedReduce: { thresholdSec: 1, reduceSec: 1.5, minSec: 0.5 }
      }
    });
    expect(system._resolveWeaponCooldown()).toBe(0.8);
  });

  it('minSec 兜底：冷却1.2秒-1.5秒会被抬到下限0.5秒', () => {
    const system = new MeleeAttackSystem();
    system.playerEntity = makePlayer({
      mainhand: {
        attackSpeed: 1.2,
        attackSpeedReduce: { thresholdSec: 1, reduceSec: 1.5, minSec: 0.5 }
      }
    });
    expect(system._resolveWeaponCooldown()).toBe(0.5);
  });

  it('词条在副手时同样生效', () => {
    const system = new MeleeAttackSystem();
    system.playerEntity = makePlayer({
      offhand: {
        attackSpeedReduce: { thresholdSec: 1, reduceSec: 1.5, minSec: 0.5 }
      }
    });
    expect(system._resolveWeaponCooldown()).toBeCloseTo(1.5, 10);
  });
});

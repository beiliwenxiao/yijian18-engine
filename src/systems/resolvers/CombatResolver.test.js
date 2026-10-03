/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @file      CombatResolver 虚弱攻击上限（maxDamage）测试
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { CombatResolver } from './CombatResolver.js';

/** 确定性 rng：依次返回序列值，耗尽后重复最后一个 */
function makeRng(sequence) {
  let index = 0;
  return { next: () => sequence[Math.min(index++, sequence.length - 1)] };
}

const baseTarget = { defense: 15, hp: 100 };

describe('CombatResolver.resolveAttack 虚弱攻击上限（attacker.maxDamage）', () => {
  it('无 maxDamage：维持通用 1~5 随机下限（低攻不出 0 伤害）', () => {
    const result = CombatResolver.resolveAttack({
      attacker: { attack: 3, moraleMultiplier: 1 },
      target: baseTarget
    }, { rng: makeRng([0.99, 0.0]) });
    // 基础 max(1, 3-15)=1 → 1*1.098 floor=1 → minDamage=max(1, floor(0*5)+1)=1
    expect(result.damage).toBe(1);
  });

  it('maxDamage=1 且攻击低于防御：伤害落在 0~1（0.9 浮动 floor 出 0）', () => {
    // rng=0 → 浮动 1*0.9=0.9 floor=0；maxDamage 分支不再取 minDamage
    const low = CombatResolver.resolveAttack({
      attacker: { attack: 3, moraleMultiplier: 1, maxDamage: 1 },
      target: baseTarget
    }, { rng: makeRng([0.0]) });
    expect(low.damage).toBe(0);

    // rng=0.5 → 浮动 1*1.0 floor=1
    const high = CombatResolver.resolveAttack({
      attacker: { attack: 3, moraleMultiplier: 1, maxDamage: 1 },
      target: baseTarget
    }, { rng: makeRng([0.5]) });
    expect(high.damage).toBe(1);
  });

  it('maxDamage=1 clamp 高攻击：无论如何单次最多 1 点', () => {
    const result = CombatResolver.resolveAttack({
      attacker: { attack: 50, moraleMultiplier: 1, maxDamage: 1 },
      target: { defense: 0, hp: 100 }
    }, { rng: makeRng([0.99]) });
    expect(result.damage).toBe(1);
  });

  it('maxDamage 范围扫描：攻击 3 vs 防御 15，100 次采样伤害恒在 {0,1}', () => {
    for (let i = 0; i < 100; i++) {
      const result = CombatResolver.resolveAttack({
        attacker: { attack: 3, moraleMultiplier: 1, maxDamage: 1 },
        target: baseTarget
      }, { rng: makeRng([i / 100]) });
      expect([0, 1]).toContain(result.damage);
    }
  });

  it('maxDamage 只作用于攻击方：玩家攻击狼不受狼的 maxDamage 影响', () => {
    const result = CombatResolver.resolveAttack({
      attacker: { attack: 30, moraleMultiplier: 1 },
      target: { defense: 1, hp: 24 }
    }, { rng: makeRng([0.5, 0.0]) });
    // 基础 29 → 浮动 29 → minDamage=1 → 29
    expect(result.damage).toBe(29);
  });
});

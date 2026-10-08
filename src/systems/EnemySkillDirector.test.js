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

/**
 * EnemySkillDirector.test.js
 * 敌人攻击编排调度器 + FactionRules 阵营规则单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EnemySkillDirector } from './EnemySkillDirector.js';
import { AISystem } from './AISystem.js';
import { isHostileTarget } from '../core/FactionRules.js';

// ─── 测试桩 ───────────────────────────────────────────────

class MockEntity {
  constructor(id, type = 'enemy', faction = 'enemy') {
    this.id = id;
    this.type = type;
    this.faction = faction;
    this.isDead = false;
    this.isDying = false;
    this.isSoulState = false;
    this.plotDowned = false;
    this.aiProfile = null;
    this.components = new Map();
  }

  getComponent(name) {
    return this.components.get(name);
  }

  addComponent(name, component) {
    this.components.set(name, component);
  }
}

class MockTransform {
  constructor(x = 0, y = 0) {
    this.position = { x, y };
  }
}

class MockCombat {
  constructor(attackRange = 50) {
    this.target = null;
    this.attackRange = attackRange;
    this.attackCooldown = 1000;
    this.lastAttackTime = 0;
    this.skillCooldowns = new Map();
    this.isCasting = false;
    this.castingSkill = null;
    this.castStartTime = 0;
    this.interrupts = 0;
    this.completions = 0;
  }

  hasTarget() {
    return this.target !== null;
  }

  setTarget(target) {
    this.target = target;
  }

  clearTarget() {
    this.target = null;
  }

  canAttack(currentTime) {
    if (this.lastAttackTime === 0) return true;
    return currentTime - this.lastAttackTime >= this.attackCooldown;
  }

  attack(currentTime) {
    this.lastAttackTime = currentTime;
    return true;
  }

  interruptCast() {
    this.isCasting = false;
    this.castingSkill = null;
    this.castStartTime = 0;
    this.interrupts += 1;
  }

  completeCast() {
    this.isCasting = false;
    this.castingSkill = null;
    this.castStartTime = 0;
    this.completions += 1;
    return null;
  }
}

class MockMovement {
  constructor() {
    this.velocity = { x: 0, y: 0 };
    this.stopped = 0;
  }

  stop() {
    this.stopped += 1;
  }
}

class MockCombatSystem {
  constructor() {
    this.attacks = [];
    this.skillCasts = [];
    this.attackTelegraphs = new Map();
  }

  performAttack(attacker, target, currentTime) {
    this.attacks.push({ attacker, target, currentTime });
    // 镜像真实 CombatSystem.performAttack：攻击落地推进普攻冷却
    attacker?.getComponent?.('combat')?.attack?.(currentTime);
  }

  executeSkill(context) {
    this.skillCasts.push(context);
    return true;
  }
}

/** 技能定义注册表桩：仅实现 get()。 */
function makeRegistry(defs = {}) {
  return {
    get: skillId => defs[skillId] || null
  };
}

/** 构造敌怪（带编排）与其玩家目标，距离由参数控制。 */
function makePair({ enemyPos = [0, 0], targetPos = [100, 0], attackRange = 200 } = {}) {
  const enemy = new MockEntity('wolf_boss', 'enemy', 'enemy');
  enemy.addComponent('transform', new MockTransform(enemyPos[0], enemyPos[1]));
  enemy.addComponent('combat', new MockCombat(attackRange));
  enemy.addComponent('movement', new MockMovement());

  const target = new MockEntity('player1', 'player', 'ally');
  target.addComponent('transform', new MockTransform(targetPos[0], targetPos[1]));

  enemy.getComponent('combat').setTarget(target);
  return { enemy, target };
}

// ─── FactionRules ─────────────────────────────────────────

describe('FactionRules.isHostileTarget', () => {
  it('友方阵营守卫（faction friendly）对任何人非敌对', () => {
    const player = new MockEntity('player1', 'player', 'ally');
    const sentinel = new MockEntity('sentinel', 'enemy', 'friendly');
    expect(isHostileTarget(player, sentinel)).toBe(false);
  });

  it('玩家（ally）对普通敌人敌对，对同阵营友军非敌对', () => {
    const player = new MockEntity('player1', 'player', 'ally');
    const wolf = new MockEntity('wolf', 'enemy', 'enemy');
    const allyNpc = new MockEntity('npc1', 'npc', 'ally');
    expect(isHostileTarget(player, wolf)).toBe(true);
    expect(isHostileTarget(player, allyNpc)).toBe(false);
  });

  it('敌人对玩家与 ally 阵营敌对，对同类非敌对', () => {
    const wolf = new MockEntity('wolf', 'enemy', 'enemy');
    const player = new MockEntity('player1', 'player', 'ally');
    const wolf2 = new MockEntity('wolf2', 'enemy', 'enemy');
    expect(isHostileTarget(wolf, player)).toBe(true);
    expect(isHostileTarget(wolf, wolf2)).toBe(false);
  });

  it('死亡/剧情倒地候选非敌对', () => {
    const wolf = new MockEntity('wolf', 'enemy', 'enemy');
    const player = new MockEntity('player1', 'player', 'ally');
    player.plotDowned = true;
    expect(isHostileTarget(wolf, player)).toBe(false);
    player.plotDowned = false;
    player.isDead = true;
    expect(isHostileTarget(wolf, player)).toBe(false);
  });
});

// ─── EnemySkillDirector ───────────────────────────────────

describe('EnemySkillDirector', () => {
  let clock;
  let director;
  let combatSystem;
  let registry;

  beforeEach(() => {
    clock = 100000;
    director = new EnemySkillDirector({ now: () => clock });
    combatSystem = new MockCombatSystem();
    registry = makeRegistry({
      cleave: {
        id: 'cleave',
        name: '劈砍',
        targeting: 'direction',
        params: { damage: 30, range: 90, radius: 60, cooldown: 4 }
      },
      smash: {
        id: 'smash',
        name: '重击',
        targeting: 'area',
        params: { damage: 50, range: 120, radius: 100, cooldown: 0, castTime: 800 }
      }
    });
    director.setSkillRegistry(registry);
  });

  it('未配置编排的实体直接跳过', () => {
    const { enemy } = makePair();
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.attacks).toHaveLength(0);
    expect(combatSystem.skillCasts).toHaveLength(0);
  });

  it('intervalSeconds 兼作开场延迟：未到期不触发，到期立即触发技能', () => {
    const { enemy } = makePair({ targetPos: [80, 0] }); // cleave range 90 内
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 8 }
      ]
    };

    // 开场第 0 帧：间隔 8 秒未到
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(0);

    // 7.9 秒后仍未到
    clock += 7900;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(0);

    // 8 秒整触发（间隔 100ms 内时钟推进）
    clock += 100;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);
    expect(combatSystem.skillCasts[0].definition.id).toBe('cleave');
  });

  it('intervalSeconds = 0 接敌立即触发', () => {
    const { enemy } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);
  });

  it('paramsOverride.radius 覆盖技能定义参数并进入结算上下文', () => {
    const { enemy } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 0, paramsOverride: { radius: 180 } }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);
    expect(combatSystem.skillCasts[0].params.radius).toBe(180);
    expect(combatSystem.skillCasts[0].params.damage).toBe(30); // 未覆盖字段沿用定义
  });

  it('params.cooldown 为硬闸：冷却期内不重复触发', () => {
    const { enemy } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);

    // interval 0，但 cleave 冷却 4 秒
    clock += 1000;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);

    clock += 3100; // 共 4.1 秒
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(2);
  });

  it('目标超出技能 range 不触发', () => {
    const { enemy } = makePair({ targetPos: [500, 0] }); // cleave range 90
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(0);
  });

  it('castTime > 0 先进 telegraph 前摇，到点结算并清 casting', () => {
    const { enemy } = makePair({ targetPos: [100, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'smash', intervalSeconds: 0 }
      ]
    };

    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(0); // 前摇中不结算
    expect(combatSystem.attackTelegraphs.get(enemy.id)).toBeTruthy();
    expect(combatSystem.attackTelegraphs.get(enemy.id).shape).toBe('circle');
    expect(combatSystem.attackTelegraphs.get(enemy.id).radius).toBe(100);
    expect(enemy.getComponent('combat').isCasting).toBe(true);

    clock += 300;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(0); // 800ms 前摇未结束

    clock += 600; // 900ms > 800ms
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);
    expect(combatSystem.skillCasts[0].params.radius).toBe(100);
    expect(combatSystem.attackTelegraphs.has(enemy.id)).toBe(false);
    expect(enemy.getComponent('combat').isCasting).toBe(false);
  });

  it('前摇锁定落点：目标移动后仍在原位置结算（可躲避）', () => {
    const { enemy, target } = makePair({ targetPos: [100, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'smash', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    target.getComponent('transform').position.x = 1000; // 前摇期间跑远
    clock += 900;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);
    expect(combatSystem.skillCasts[0].targetPosition).toEqual({ x: 100, y: 0 });
  });

  it('basic 动作走 performAttack 并受 canAttack 闸门', () => {
    const { enemy } = makePair({ targetPos: [40, 0], attackRange: 50 });
    enemy.aiProfile = {
      attackActions: [
        { id: 'b1', type: 'basic', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.attacks).toHaveLength(1);

    // attackCooldown 1000ms 内不重复
    clock += 500;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.attacks).toHaveLength(1);

    clock += 600;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.attacks).toHaveLength(2);
  });

  it('多动作就绪按数组顺序取第一个', () => {
    const { enemy } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 0 },
        { id: 'a2', type: 'skill', skillId: 'smash', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);
    expect(combatSystem.skillCasts[0].definition.id).toBe('cleave');
  });

  it('链式：afterSkillId 源动作触发前不触发，触发后按延迟计时', () => {
    const { enemy } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 0 },
        { id: 'a2', type: 'skill', skillId: 'smash', intervalSeconds: 999, afterSkillId: 'a1', delayAfterSkillSeconds: 2 }
      ]
    };
    // 第 0 帧：a1 立即触发，a2 因链锚未建立不触发（但 a1 触发后本帧已 return）
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts.map(ctx => ctx.definition.id)).toEqual(['cleave']);

    // 1 秒后：链锚已建（a1 触发时）但 2 秒延迟未到，自身间隔 999 秒也未到
    clock += 1000;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);

    // 2.1 秒后：链延迟到期，a2 进入 800ms 前摇
    clock += 1100;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts.map(ctx => ctx.definition.id)).toEqual(['cleave']);
    expect(enemy.getComponent('combat').isCasting).toBe(true);

    // 前摇结束结算
    clock += 900;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts.map(ctx => ctx.definition.id)).toEqual(['cleave', 'smash']);
  });

  it('脱战（无有效目标）重置计时，重新接敌按开场延迟重计', () => {
    const { enemy } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'cleave', intervalSeconds: 8 }
      ]
    };
    // 接敌 5 秒后脱战
    clock += 5000;
    director.update(enemy, [enemy], combatSystem);
    enemy.getComponent('combat').clearTarget();
    director.update(enemy, [enemy], combatSystem);

    // 重新接敌：开场延迟重新计 8 秒（而非剩余 3 秒）
    enemy.getComponent('combat').setTarget(
      makePair({ targetPos: [80, 0] }).target
    );
    clock += 3000;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(0);

    clock += 8100;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.skillCasts).toHaveLength(1);
  });

  it('目标死亡视为脱战，清计时与前摇', () => {
    const { enemy, target } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'smash', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.attackTelegraphs.has(enemy.id)).toBe(true);

    target.isDead = true;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.attackTelegraphs.has(enemy.id)).toBe(false);
    expect(enemy.getComponent('combat').isCasting).toBe(false);
  });

  it('剧情倒地（plotDowned）清施法状态与前摇 telegraph', () => {
    const { enemy } = makePair({ targetPos: [80, 0] });
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'smash', intervalSeconds: 0 }
      ]
    };
    director.update(enemy, [enemy], combatSystem);
    expect(enemy.getComponent('combat').isCasting).toBe(true);

    enemy.plotDowned = true;
    director.update(enemy, [enemy], combatSystem);
    expect(combatSystem.attackTelegraphs.has(enemy.id)).toBe(false);
    expect(enemy.getComponent('combat').isCasting).toBe(false);
  });

  it('技能定义缺失：动作跳过且不崩溃', () => {
    const { enemy } = makePair();
    enemy.aiProfile = {
      attackActions: [
        { id: 'a1', type: 'skill', skillId: 'no_such_skill', intervalSeconds: 0 }
      ]
    };
    expect(() => director.update(enemy, [enemy], combatSystem)).not.toThrow();
    expect(combatSystem.skillCasts).toHaveLength(0);
  });
});

// ─── AISystem 集成：编排让位 ──────────────────────────────

describe('AISystem 攻击编排让位', () => {
  it('有编排的实体普攻由 Director 触发，AI 控制器不再自行 performAttack', () => {
    const aiSystem = new AISystem();
    const combatSystem = new MockCombatSystem();

    const enemy = new MockEntity('wolf_boss', 'enemy', 'enemy');
    enemy.addComponent('transform', new MockTransform(0, 0));
    enemy.addComponent('combat', new MockCombat(50));
    enemy.addComponent('movement', new MockMovement());
    enemy.aiProfile = {
      attackActions: [
        { id: 'b1', type: 'basic', intervalSeconds: 0 }
      ]
    };

    const player = new MockEntity('player1', 'player', 'ally');
    player.addComponent('transform', new MockTransform(30, 0));

    aiSystem.registerAI(enemy, 'aggressive');
    enemy.getComponent('combat').setTarget(player);

    // 步进 0.5 秒：跨过 AggressiveAI 的 0.3s 决策间隔，确保控制器决策真的发生
    aiSystem.update(0.5, [enemy, player], combatSystem);

    // Director 恰好触发一次普攻；AI 控制器未叠加攻击
    expect(combatSystem.attacks).toHaveLength(1);
    expect(combatSystem.attacks[0].attacker).toBe(enemy);
  });

  it('无编排的实体保持原普攻路径', () => {
    const aiSystem = new AISystem();
    const combatSystem = new MockCombatSystem();

    const enemy = new MockEntity('wolf', 'enemy', 'enemy');
    enemy.addComponent('transform', new MockTransform(0, 0));
    enemy.addComponent('combat', new MockCombat(50));
    enemy.addComponent('movement', new MockMovement());

    const player = new MockEntity('player1', 'player', 'ally');
    player.addComponent('transform', new MockTransform(30, 0));

    aiSystem.registerAI(enemy, 'aggressive');
    enemy.getComponent('combat').setTarget(player);

    aiSystem.update(0.5, [enemy, player], combatSystem);
    expect(combatSystem.attacks).toHaveLength(1);
  });
});

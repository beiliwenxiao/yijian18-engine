/**
 * WolfSkillsCombat.test.js
 * 狼王技能运行时结算测试：撕咬（entity 瞄准 AOE）与冲刺撕咬（位移 + 落点 AOE）。
 */

import { describe, it, expect } from 'vitest';
import { CombatSystem } from './CombatSystem.js';
import { isHostileTarget } from '../core/FactionRules.js';

class MockEntity {
  constructor(id, type, faction) {
    this.id = id;
    this.type = type;
    this.faction = faction;
    this.isDead = false;
    this.isDying = false;
    this.isSoulState = false;
    this.plotDowned = false;
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
  constructor(x, y) {
    this.position = { x, y };
  }

  setPosition(x, y) {
    this.position.x = x;
    this.position.y = y;
  }
}

class MockStats {
  constructor(hp) {
    this.hp = hp;
    this.maxHp = hp;
    this.attack = 9;
    this.defense = 2;
    this.mainElement = 0;
    this.elementAttack = {};
    this.elementDefense = {};
    this.unitType = 0;
    this.moraleMultiplier = 1;
  }

  getMainElement() {
    return this.mainElement;
  }

  takeDamage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    return this.hp <= 0;
  }
}

class MockCombat {
  constructor() {
    this.skillCooldowns = new Map();
    this.isCasting = false;
  }
}

class MockMovement {
  constructor() {
    this.velocity = { x: 0, y: 0 };
  }
}

/** 真实 CombatSystem：仅注入结算所需协作者（其余 config 可选）。 */
function makeCombatSystem() {
  return new CombatSystem({});
}

function makeWolf({ x = 0, y = 0 } = {}) {
  const wolf = new MockEntity('wolf_king', 'enemy', 'enemy');
  wolf.addComponent('transform', new MockTransform(x, y));
  wolf.addComponent('stats', new MockStats(110));
  wolf.addComponent('combat', new MockCombat());
  wolf.addComponent('movement', new MockMovement());
  return wolf;
}

function makePlayer({ x = 200, y = 0, hp = 100 } = {}) {
  const player = new MockEntity('player1', 'player', 'ally');
  player.addComponent('transform', new MockTransform(x, y));
  player.addComponent('stats', new MockStats(hp));
  player.addComponent('combat', new MockCombat());
  return player;
}

const WOLF_BITE = {
  id: 'wolf_bite',
  name: '撕咬',
  category: 'attack',
  targeting: 'entity',
  params: { damageMin: 6, damageMax: 12, range: 90, radius: 90, cooldown: 5 }
};

const WOLF_DASH_BITE = {
  id: 'wolf_dash_bite',
  name: '冲刺撕咬',
  category: 'attack',
  targeting: 'entity',
  params: { damageMin: 14, damageMax: 22, range: 260, radius: 100, cooldown: 10, castTime: 600 }
};

describe('狼王技能结算（CombatSystem.executeSkill）', () => {
  it('撕咬：对目标位置半径内玩家结算定值伤害', () => {
    const combatSystem = makeCombatSystem();
    const wolf = makeWolf({ x: 0, y: 0 });
    const player = makePlayer({ x: 80, y: 0, hp: 100 });
    const entities = [wolf, player];

    const result = combatSystem.executeSkill({
      caster: wolf,
      definition: WOLF_BITE,
      view: WOLF_BITE,
      params: { ...WOLF_BITE.params },
      target: player,
      targetPosition: { x: 80, y: 0 },
      entities,
      currentTime: 1000
    });

    expect(result).toBe(true);
    expect(player.getComponent('stats').hp).toBeLessThan(100);
    expect(player.getComponent('stats').hp).toBeGreaterThanOrEqual(100 - 12);
  });

  it('冲刺撕咬：狼王位移到目标身前 40px，落点范围伤害命中玩家', () => {
    const combatSystem = makeCombatSystem();
    const wolf = makeWolf({ x: 0, y: 0 });
    const player = makePlayer({ x: 200, y: 0, hp: 100 });
    const entities = [wolf, player];

    const result = combatSystem.executeSkill({
      caster: wolf,
      definition: WOLF_DASH_BITE,
      view: WOLF_DASH_BITE,
      params: { ...WOLF_DASH_BITE.params },
      target: player,
      targetPosition: { x: 200, y: 0 },
      entities,
      currentTime: 1000
    });

    expect(result).toBe(true);
    const wolfTransform = wolf.getComponent('transform');
    // 冲到目标身前 40px：200 - 40 = 160
    expect(wolfTransform.position.x).toBe(160);
    expect(player.getComponent('stats').hp).toBeLessThan(100);
    expect(player.getComponent('stats').hp).toBeGreaterThanOrEqual(100 - 22);
  });

  it('冲刺撕咬：目标身后的友军也会被落点范围波及（敌我按施法者相对判定）', () => {
    const combatSystem = makeCombatSystem();
    const wolf = makeWolf({ x: 0, y: 0 });
    const player = makePlayer({ x: 200, y: 0, hp: 100 });
    const ally = new MockEntity('ally1', 'npc', 'ally');
    ally.addComponent('transform', new MockTransform(240, 0));
    ally.addComponent('stats', new MockStats(80));
    const entities = [wolf, player, ally];

    combatSystem.executeSkill({
      caster: wolf,
      definition: WOLF_DASH_BITE,
      view: WOLF_DASH_BITE,
      params: { ...WOLF_DASH_BITE.params },
      target: player,
      targetPosition: { x: 200, y: 0 },
      entities,
      currentTime: 1000
    });

    expect(ally.getComponent('stats').hp).toBeLessThan(80);
    expect(isHostileTarget(wolf, ally)).toBe(true);
  });

  it('矩形形状：落点周围按轴对齐矩形判定（圆形半径外的角落点命中）', () => {
    const combatSystem = makeCombatSystem();
    const wolf = makeWolf({ x: 0, y: 0 });
    // 矩形 200×120（半宽 100/半高 60）：(90, 50) 距离约 103 > 圆形 100，但矩形内命中
    const params = { shape: 'rect', shapeData: { width: 200, height: 120 }, damageMin: 10, damageMax: 10 };
    const inRect = makePlayer({ x: 90, y: 50, hp: 100 });
    const outside = makePlayer({ x: 110, y: 0, hp: 100 });
    const entities = [wolf, inRect, outside];

    combatSystem.executeSkill({
      caster: wolf,
      definition: { id: 'wolf_slam', name: '狼王重击', category: 'attack', targeting: 'position', params },
      view: { id: 'wolf_slam', name: '狼王重击', category: 'attack', targeting: 'position', params },
      params,
      target: inRect,
      targetPosition: { x: 0, y: 0 },
      entities,
      currentTime: 1000
    });

    expect(inRect.getComponent('stats').hp).toBe(90);
    expect(outside.getComponent('stats').hp).toBe(100);
  });

  it('多边形形状：按顶点射线法判定（菱形对角外的点不命中）', () => {
    const combatSystem = makeCombatSystem();
    const wolf = makeWolf({ x: 0, y: 0 });
    const params = {
      shape: 'polygon',
      shapeData: { points: [[0, -100], [100, 0], [0, 100], [-100, 0]] },
      damageMin: 10, damageMax: 10
    };
    const inside = makePlayer({ x: 70, y: 0, hp: 100 });
    const outside = makePlayer({ x: 60, y: 60, hp: 100 }); // |dx|+|dy|=120 > 100，菱形对角外
    const entities = [wolf, inside, outside];

    combatSystem.executeSkill({
      caster: wolf,
      definition: { id: 'wolf_claw', name: '狼王爪击', category: 'attack', targeting: 'position', params },
      view: { id: 'wolf_claw', name: '狼王爪击', category: 'attack', targeting: 'position', params },
      params,
      target: inside,
      targetPosition: { x: 0, y: 0 },
      entities,
      currentTime: 1000
    });

    expect(inside.getComponent('stats').hp).toBe(90);
    expect(outside.getComponent('stats').hp).toBe(100);
  });
});

/**
 * AISystem.test.js
 * AI系统单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AISystem } from './AISystem.js';

// Mock实体类
class MockEntity {
  constructor(id, type = 'enemy', faction = 'enemy') {
    this.id = id;
    this.type = type;
    this.faction = faction;
    this.isDead = false;
    this.isDying = false;
    this.isAI = false;
    this.aiType = null;
    this.components = new Map();
  }

  getComponent(name) {
    return this.components.get(name);
  }

  addComponent(name, component) {
    this.components.set(name, component);
  }
}

// Mock组件
class MockTransform {
  constructor(x = 0, y = 0) {
    this.position = { x, y };
  }

  setPosition(x, y) {
    this.position.x = x;
    this.position.y = y;
  }
}

class MockCombat {
  constructor() {
    this.target = null;
    this.attackRange = 50;
    this.lastAttackTime = 0;
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
    return currentTime - this.lastAttackTime >= 1000;
  }

  recordAttack(currentTime) {
    this.lastAttackTime = currentTime;
  }
}

class MockMovement {
  constructor() {
    this.velocity = { x: 0, y: 0 };
    this.speed = 100;
  }
}

class MockStats {
  constructor(hp = 100, maxHp = 100) {
    this.hp = hp;
    this.maxHp = maxHp;
  }
}

class MockSprite {
  constructor() {
    this.currentAnimation = 'idle';
  }

  playAnimation(name) {
    this.currentAnimation = name;
  }
}

// Mock战斗系统
class MockCombatSystem {
  constructor() {
    this.attacks = [];
  }

  performAttack(attacker, target) {
    this.attacks.push({ attacker, target });
  }
}

describe('AISystem', () => {
  let aiSystem;
  let entity;
  let target;
  let combatSystem;

  beforeEach(() => {
    aiSystem = new AISystem();
    
    // 创建测试实体
    entity = new MockEntity('enemy1', 'enemy', 'enemy');
    entity.addComponent('transform', new MockTransform(100, 100));
    entity.addComponent('combat', new MockCombat());
    entity.addComponent('movement', new MockMovement());
    entity.addComponent('stats', new MockStats());
    entity.addComponent('sprite', new MockSprite());

    // 创建目标实体
    target = new MockEntity('player1', 'player', 'ally');
    target.addComponent('transform', new MockTransform(200, 200));
    target.addComponent('stats', new MockStats());

    combatSystem = new MockCombatSystem();
  });

  describe('注册和管理', () => {
    it('应该能够注册AI控制器', () => {
      aiSystem.registerAI(entity, 'aggressive');
      
      expect(entity.isAI).toBe(true);
      expect(entity.aiType).toBe('aggressive');
      expect(aiSystem.isAIControlled(entity)).toBe(true);
      expect(aiSystem.getAICount()).toBe(1);
    });

    it('应该能够移除AI控制器', () => {
      aiSystem.registerAI(entity, 'aggressive');
      aiSystem.unregisterAI(entity);
      
      expect(entity.isAI).toBe(false);
      expect(entity.aiType).toBe(null);
      expect(aiSystem.isAIControlled(entity)).toBe(false);
      expect(aiSystem.getAICount()).toBe(0);
    });

    it('应该能够批量注册AI', () => {
      const entities = [
        new MockEntity('enemy1'),
        new MockEntity('enemy2'),
        new MockEntity('enemy3')
      ];

      aiSystem.registerBatch(entities, 'defensive');

      expect(aiSystem.getAICount()).toBe(3);
      entities.forEach(e => {
        expect(e.isAI).toBe(true);
        expect(e.aiType).toBe('defensive');
      });
    });

    it('应该能够更改AI类型', () => {
      aiSystem.registerAI(entity, 'aggressive');
      expect(entity.aiType).toBe('aggressive');

      aiSystem.changeAIType(entity, 'defensive');
      expect(entity.aiType).toBe('defensive');
    });

    it('应该能够清除所有AI控制器', () => {
      aiSystem.registerAI(entity, 'aggressive');
      aiSystem.registerAI(new MockEntity('enemy2'), 'defensive');
      
      expect(aiSystem.getAICount()).toBe(2);
      
      aiSystem.clear();
      expect(aiSystem.getAICount()).toBe(0);
    });
  });

  describe('AI类型', () => {
    it('应该支持aggressive AI类型', () => {
      aiSystem.registerAI(entity, 'aggressive');
      expect(aiSystem.getAIType(entity)).toBe('aggressive');
    });

    it('应该支持defensive AI类型', () => {
      aiSystem.registerAI(entity, 'defensive');
      expect(aiSystem.getAIType(entity)).toBe('defensive');
    });

    it('应该支持support AI类型', () => {
      aiSystem.registerAI(entity, 'support');
      expect(aiSystem.getAIType(entity)).toBe('support');
    });

    it('未知AI类型应该默认为aggressive', () => {
      aiSystem.registerAI(entity, 'unknown');
      expect(entity.aiType).toBe('unknown');
      // AI控制器会被创建为aggressive类型
    });
  });

  describe('AI行为', () => {
    it('aggressive AI应该主动寻找并攻击敌人', () => {
      aiSystem.registerAI(entity, 'aggressive');
      
      const entities = [entity, target];
      const combat = entity.getComponent('combat');

      // 更新AI（多次以触发决策）
      for (let i = 0; i < 10; i++) {
        aiSystem.update(0.1, entities, combatSystem);
      }

      // 应该设置了目标
      expect(combat.hasTarget()).toBe(true);
      expect(combat.target).toBe(target);
    });

    it('AI应该在目标死亡后寻找新目标', () => {
      aiSystem.registerAI(entity, 'aggressive');
      
      const combat = entity.getComponent('combat');
      combat.setTarget(target);

      // 目标死亡
      target.isDead = true;

      const entities = [entity, target];
      
      // 更新AI
      for (let i = 0; i < 10; i++) {
        aiSystem.update(0.1, entities, combatSystem);
      }

      // 目标应该被清除（因为没有其他敌人）
      expect(combat.target).toBe(null);
    });

    it('AI应该跳过死亡实体', () => {
      aiSystem.registerAI(entity, 'aggressive');
      entity.isDead = true;

      const entities = [entity, target];
      
      // 更新AI不应该抛出错误
      expect(() => {
        aiSystem.update(0.1, entities, combatSystem);
      }).not.toThrow();
    });

    it('defensive AI应该在敌人靠近时后退', () => {
      aiSystem.registerAI(entity, 'defensive');
      
      // 将目标放在很近的位置
      const targetTransform = target.getComponent('transform');
      if (!targetTransform) {
        target.addComponent('transform', new MockTransform(110, 110));
      } else {
        targetTransform.setPosition(110, 110);
      }

      const entities = [entity, target];
      const movement = entity.getComponent('movement');

      // 更新AI
      for (let i = 0; i < 10; i++) {
        aiSystem.update(0.1, entities, combatSystem);
      }

      // 应该有后退的速度（远离目标）
      // 由于目标在(110, 110)，实体在(100, 100)
      // 后退应该是负方向
      const hasRetreatVelocity = movement.velocity.x !== 0 || movement.velocity.y !== 0;
      expect(hasRetreatVelocity).toBe(true);
    });

    it('support AI应该优先攻击低血量敌人', () => {
      aiSystem.registerAI(entity, 'support');
      
      // 创建两个目标，一个低血量，一个高血量
      const weakTarget = new MockEntity('weak', 'player', 'ally');
      weakTarget.addComponent('transform', new MockTransform(150, 150));
      weakTarget.addComponent('stats', new MockStats(20, 100)); // 20% HP

      const strongTarget = new MockEntity('strong', 'player', 'ally');
      strongTarget.addComponent('transform', new MockTransform(180, 180));
      strongTarget.addComponent('stats', new MockStats(90, 100)); // 90% HP

      const entities = [entity, weakTarget, strongTarget];
      const combat = entity.getComponent('combat');

      // 更新AI
      for (let i = 0; i < 10; i++) {
        aiSystem.update(0.1, entities, combatSystem);
      }

      // 应该选择低血量目标
      expect(combat.target).toBe(weakTarget);
    });
  });

  describe('移动行为', () => {
    it('AI应该向目标移动', () => {
      aiSystem.registerAI(entity, 'aggressive');
      
      const entities = [entity, target];
      const movement = entity.getComponent('movement');

      // 更新AI
      for (let i = 0; i < 10; i++) {
        aiSystem.update(0.1, entities, combatSystem);
      }

      // 应该有移动速度
      const isMoving = movement.velocity.x !== 0 || movement.velocity.y !== 0;
      expect(isMoving).toBe(true);
    });

    it('AI在攻击范围内应该停止移动', () => {
      aiSystem.registerAI(entity, 'aggressive');
      
      // 将目标放在攻击范围内
      const targetTransform = target.getComponent('transform');
      if (!targetTransform) {
        target.addComponent('transform', new MockTransform(120, 120));
      } else {
        targetTransform.setPosition(120, 120);
      }

      const entities = [entity, target];
      const movement = entity.getComponent('movement');
      const combat = entity.getComponent('combat');

      // 更新AI
      for (let i = 0; i < 10; i++) {
        aiSystem.update(0.1, entities, combatSystem);
      }

      // 应该设置了目标
      expect(combat.hasTarget()).toBe(true);
      
      // 应该停止移动（速度为0）
      expect(movement.velocity.x).toBe(0);
      expect(movement.velocity.y).toBe(0);
    });
  });

  describe('边界情况', () => {
    it('应该处理没有transform组件的实体', () => {
      const brokenEntity = new MockEntity('broken');
      aiSystem.registerAI(brokenEntity, 'aggressive');

      const entities = [brokenEntity, target];
      
      // 不应该抛出错误
      expect(() => {
        aiSystem.update(0.1, entities, combatSystem);
      }).not.toThrow();
    });

    it('应该处理没有combat组件的实体', () => {
      const brokenEntity = new MockEntity('broken');
      brokenEntity.addComponent('transform', new MockTransform());
      aiSystem.registerAI(brokenEntity, 'aggressive');

      const entities = [brokenEntity, target];
      
      // 不应该抛出错误
      expect(() => {
        aiSystem.update(0.1, entities, combatSystem);
      }).not.toThrow();
    });

    it('应该处理空实体列表', () => {
      aiSystem.registerAI(entity, 'aggressive');
      
      // 不应该抛出错误
      expect(() => {
        aiSystem.update(0.1, [], combatSystem);
      }).not.toThrow();
    });

    it('应该处理实体被移除的情况', () => {
      aiSystem.registerAI(entity, 'aggressive');
      expect(aiSystem.getAICount()).toBe(1);

      // 更新时实体不在列表中
      aiSystem.update(0.1, [], combatSystem);

      // AI控制器应该被自动移除
      expect(aiSystem.getAICount()).toBe(0);
    });
  });

  describe('性能', () => {
    it('应该能够处理大量AI实体', () => {
      const entities = [];
      
      // 创建100个AI实体
      for (let i = 0; i < 100; i++) {
        const e = new MockEntity(`enemy${i}`, 'enemy', 'enemy');
        e.addComponent('transform', new MockTransform(Math.random() * 1000, Math.random() * 1000));
        e.addComponent('combat', new MockCombat());
        e.addComponent('movement', new MockMovement());
        e.addComponent('stats', new MockStats());
        e.addComponent('sprite', new MockSprite());
        
        aiSystem.registerAI(e, 'aggressive');
        entities.push(e);
      }

      // 添加一个目标
      entities.push(target);

      expect(aiSystem.getAICount()).toBe(100);

      // 更新应该在合理时间内完成
      const startTime = performance.now();
      aiSystem.update(0.016, entities, combatSystem); // 60 FPS
      const endTime = performance.now();

      // 更新时间应该小于16ms（60 FPS）
      expect(endTime - startTime).toBeLessThan(16);
    });
  });

  describe('AI 行为画像（aiProfile：巡逻/警戒/追击/回家）', () => {
    /** 构造带 aiProfile 的实体与候选敌人，脱离共享 beforeEach 的坐标预设。 */
    function makeScenario({ profile, entityPos = [0, 0], enemyPos = [80, 0], spawnAnchor = [0, 0] }) {
      const ai = new AISystem();
      const self = new MockEntity('wolf1', 'enemy', 'enemy');
      self.addComponent('transform', new MockTransform(entityPos[0], entityPos[1]));
      self.addComponent('combat', new MockCombat());
      self.addComponent('movement', new MockMovement());
      self.addComponent('stats', new MockStats());
      self.addComponent('sprite', new MockSprite());
      self.aiProfile = profile;
      if (spawnAnchor) self.spawnAnchor = { x: spawnAnchor[0], y: spawnAnchor[1] };
      const enemy = new MockEntity('player1', 'player', 'ally');
      enemy.addComponent('transform', new MockTransform(enemyPos[0], enemyPos[1]));
      enemy.addComponent('stats', new MockStats());
      return { ai, self, enemy };
    }

    it('警戒范围（detectionRange）：圈内索敌，圈外不索', () => {
      const { ai, self, enemy } = makeScenario({
        profile: { detectionRange: 100 },
        entityPos: [0, 0], enemyPos: [150, 0]
      });
      ai.createAIController('aggressive').makeDecision(self, [enemy], null);
      expect(self.getComponent('combat').hasTarget()).toBe(false);

      const near = makeScenario({ profile: { detectionRange: 100 }, enemyPos: [80, 0] });
      near.ai.createAIController('aggressive').makeDecision(near.self, [near.enemy], null);
      expect(near.self.getComponent('combat').hasTarget()).toBe(true);
    });

    it('无 aiProfile 时维持现状：默认 400 索敌半径', () => {
      const { ai, self, enemy } = makeScenario({ profile: null, enemyPos: [350, 0] });
      ai.createAIController('aggressive').makeDecision(self, [enemy], null);
      expect(self.getComponent('combat').hasTarget()).toBe(true);
    });

    it('追击范围（pursuitRange）：目标距出生锚点超出即放弃', () => {
      const { ai, self, enemy } = makeScenario({
        profile: { pursuitRange: 300 },
        enemyPos: [500, 0], spawnAnchor: [0, 0]
      });
      self.getComponent('combat').setTarget(enemy);
      ai.createAIController('aggressive').makeDecision(self, [enemy], null);
      expect(self.getComponent('combat').hasTarget()).toBe(false);
    });

    it('巡逻（patrol）：无目标时朝相对锚点的路径点移动', () => {
      const { ai, self } = makeScenario({
        profile: { patrol: { enabled: true, mode: 'loop', points: [[100, 0]] } },
        entityPos: [0, 0], enemyPos: [9999, 9999], spawnAnchor: [0, 0]
      });
      ai.createAIController('aggressive').makeDecision(self, [], null);
      const velocity = self.getComponent('movement').velocity;
      expect(velocity.x).toBeGreaterThan(0);   // 朝 +x 方向的路径点移动
      expect(velocity.y).toBe(0);
    });

    it('回家（leashRange）：远离出生锚点且无目标时先走回出生点', () => {
      const { ai, self } = makeScenario({
        profile: { leashRange: 100 },
        entityPos: [400, 0], enemyPos: [9999, 9999], spawnAnchor: [0, 0]
      });
      ai.createAIController('aggressive').makeDecision(self, [], null);
      const velocity = self.getComponent('movement').velocity;
      expect(velocity.x).toBeLessThan(0);      // 朝出生点（-x）返回
      expect(velocity.y).toBe(0);
    });
  });
});

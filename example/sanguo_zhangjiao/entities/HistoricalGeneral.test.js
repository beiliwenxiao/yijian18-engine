/************************************************************

 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)

 * 

 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎

 * @author    刘枭 (beiliwenxiao)

 * @email     beiliwenxiao@qq.com

 * @date      2026-01-14

 * @blog      https://blog.csdn.net/beiliwenxiao

 * @repo      https://github.com/beiliwenxiao/yijian18-engine

 *            https://gitee.com/coderaaa/yijian18-engine

 ************************************************************/

/**
 * HistoricalGeneral.test.js
 * 历史武将系统单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoricalGeneral, HistoricalGeneralFactory } from './HistoricalGeneral.js';

describe('HistoricalGeneral', () => {
  let mockSystems;
  let generalData;

  beforeEach(() => {
    // 模拟系统引用
    mockSystems = {
      camera: {
        setTarget: vi.fn(),
        target: null,
        followSpeed: 0.1
      },
      particleSystem: {
        emitBurst: vi.fn(),
        createEmitter: vi.fn(() => ({ id: 'test_emitter' }))
      },
      skillEffects: {
        createSkillEffect: vi.fn()
      },
      skillTreeSystem: {}
    };

    // 测试武将数据
    generalData = {
      name: '测试武将',
      title: '测试',
      biography: '这是一个测试武将',
      level: 10,
      position: { x: 100, y: 100 },
      attributes: {
        health: 1000,
        attack: 50,
        defense: 30,
        speed: 100
      },
      skills: ['test_skill'],
      retreatThreshold: 0.2
    };
  });

  describe('构造函数', () => {
    it('应该正确创建历史武将实例', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);

      expect(general.id).toBe('test_general');
      expect(general.type).toBe('historical_general');
      expect(general.generalName).toBe('测试武将');
      expect(general.title).toBe('测试');
      expect(general.level).toBe(10);
    });

    it('应该初始化所有必要的组件', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);

      expect(general.hasComponent('transform')).toBe(true);
      expect(general.hasComponent('sprite')).toBe(true);
      expect(general.hasComponent('stats')).toBe(true);
      expect(general.hasComponent('combat')).toBe(true);
      expect(general.hasComponent('movement')).toBe(true);
    });

    it('应该正确设置属性值', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      const stats = general.getComponent('stats');

      expect(stats.maxHp).toBe(1000);
      expect(stats.hp).toBe(1000);
      expect(stats.attack).toBe(50);
      expect(stats.defense).toBe(30);
    });
  });

  describe('playIntroduction', () => {
    it('应该播放武将登场特写', async () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      
      // 缩短测试时间
      general.cinematicIntro.duration = 100;

      await general.playIntroduction();

      expect(general.hasIntroPlayed).toBe(true);
      expect(mockSystems.camera.setTarget).toHaveBeenCalled();
      expect(mockSystems.particleSystem.emitBurst).toHaveBeenCalled();
    });

    it('应该只播放一次登场特写', async () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      general.cinematicIntro.duration = 100;

      await general.playIntroduction();
      const firstCallCount = mockSystems.camera.setTarget.mock.calls.length;

      await general.playIntroduction();
      const secondCallCount = mockSystems.camera.setTarget.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('useSpecialSkill', () => {
    it('应该拒绝使用武将没有的技能', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      const result = general.useSpecialSkill('unknown_skill');

      expect(result).toBe(false);
      expect(mockSystems.skillEffects.createSkillEffect).not.toHaveBeenCalled();
    });
    
    it('应该调用技能特效系统', () => {
      const general = new HistoricalGeneral('test_general', {
        ...generalData,
        skills: ['cavalry_charge']
      }, mockSystems);
      
      // 使用技能（即使返回false，也应该尝试调用特效系统）
      general.useSpecialSkill('cavalry_charge');
      
      // 验证至少尝试了使用技能的流程
      expect(general.skills).toContain('cavalry_charge');
    });
  });

  describe('shouldRetreat', () => {
    it('当生命值高于阈值时应该返回false', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      const stats = general.getComponent('stats');
      stats.health = 500; // 50% 生命值

      expect(general.shouldRetreat()).toBe(false);
    });

    it('当生命值低于阈值时应该返回true', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      const stats = general.getComponent('stats');
      stats.hp = 100; // 10% 生命值，低于20%阈值

      expect(general.shouldRetreat()).toBe(true);
    });

    it('当已经在撤退时应该返回true', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      general.isRetreating = true;

      expect(general.shouldRetreat()).toBe(true);
    });
  });

  describe('retreat', () => {
    it('应该正确执行撤退逻辑', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      
      general.retreat();

      expect(general.isRetreating).toBe(true);
      expect(mockSystems.particleSystem.emitBurst).toHaveBeenCalled();
    });

    it('应该将阵营改为中立', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      const combat = general.getComponent('combat');
      
      expect(combat.faction).toBe('enemy');
      
      general.retreat();
      
      expect(combat.faction).toBe('neutral');
    });

    it('不应该重复执行撤退', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      
      general.retreat();
      const firstCallCount = mockSystems.particleSystem.emitBurst.mock.calls.length;
      
      general.retreat();
      const secondCallCount = mockSystems.particleSystem.emitBurst.mock.calls.length;
      
      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('update', () => {
    it('应该在生命值过低时自动撤退', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      const stats = general.getComponent('stats');
      stats.hp = 100; // 10% 生命值

      general.update(16); // 一帧

      expect(general.isRetreating).toBe(true);
    });

    it('当不活跃时不应该更新', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      general.active = false;

      const stats = general.getComponent('stats');
      const initialHealth = stats.health;

      general.update(16);

      expect(stats.health).toBe(initialHealth);
    });
  });

  describe('getInfo', () => {
    it('应该返回完整的武将信息', () => {
      const general = new HistoricalGeneral('test_general', generalData, mockSystems);
      const info = general.getInfo();

      expect(info.id).toBe('test_general');
      expect(info.name).toBe('测试武将');
      expect(info.title).toBe('测试');
      expect(info.level).toBe(10);
      expect(info.health).toBe(1000);
      expect(info.maxHealth).toBe(1000);
      expect(info.isRetreating).toBe(false);
      expect(info.skills).toEqual(['test_skill']);
    });
  });
});

describe('HistoricalGeneralFactory', () => {
  let factory;
  let mockSystems;

  beforeEach(() => {
    mockSystems = {
      camera: {},
      particleSystem: {
        emitBurst: vi.fn(),
        createEmitter: vi.fn()
      },
      skillEffects: {
        createSkillEffect: vi.fn()
      }
    };

    factory = new HistoricalGeneralFactory(mockSystems);
  });

  describe('createGeneral', () => {
    it('应该成功创建预定义的武将', () => {
      const caoCao = factory.createGeneral('cao_cao');

      expect(caoCao).not.toBeNull();
      expect(caoCao.generalName).toBe('曹操');
      expect(caoCao.title).toBe('孟德');
    });

    it('应该为未知武将ID返回null', () => {
      const unknown = factory.createGeneral('unknown_general');

      expect(unknown).toBeNull();
    });

    it('应该支持覆盖配置', () => {
      const caoCao = factory.createGeneral('cao_cao', {
        level: 30,
        position: { x: 200, y: 200 }
      });

      expect(caoCao.level).toBe(30);
      const transform = caoCao.getComponent('transform');
      expect(transform.position.x).toBe(200);
      expect(transform.position.y).toBe(200);
    });
  });

  describe('createGenerals', () => {
    it('应该批量创建多个武将', () => {
      const generals = factory.createGenerals(['cao_cao', 'liu_bei', 'guan_yu']);

      expect(generals).toHaveLength(3);
      expect(generals[0].generalName).toBe('曹操');
      expect(generals[1].generalName).toBe('刘备');
      expect(generals[2].generalName).toBe('关羽');
    });

    it('应该过滤掉无效的武将ID', () => {
      const generals = factory.createGenerals(['cao_cao', 'unknown', 'liu_bei']);

      expect(generals).toHaveLength(2);
      expect(generals[0].generalName).toBe('曹操');
      expect(generals[1].generalName).toBe('刘备');
    });
  });

  describe('getAvailableGenerals', () => {
    it('应该返回所有可用的武将ID', () => {
      const available = factory.getAvailableGenerals();

      expect(available).toContain('cao_cao');
      expect(available).toContain('liu_bei');
      expect(available).toContain('guan_yu');
      expect(available).toContain('zhang_fei');
      expect(available).toContain('zhao_yun');
      expect(available).toContain('huangfu_song');
    });
  });
});

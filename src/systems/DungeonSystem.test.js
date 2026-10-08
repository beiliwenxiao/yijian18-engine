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
 * DungeonSystem.test.js
 * 副本系统单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DungeonSystem,
  DungeonTemplate,
  DungeonInstance,
  DungeonWave,
  DungeonReward,
  DungeonDifficulty,
  DungeonState
} from './DungeonSystem.js';

describe('DungeonReward', () => {
  it('应该正确计算基础奖励', () => {
    const reward = new DungeonReward({
      exp: 100,
      gold: 50,
      items: [{ itemId: 'potion', quantity: 2, dropRate: 1.0 }]
    });

    const result = reward.calculateRewards(false);
    expect(result.exp).toBe(100);
    expect(result.gold).toBe(50);
    expect(result.items.length).toBe(1);
  });

  it('应该正确计算首次通关奖励', () => {
    const reward = new DungeonReward({
      exp: 100,
      gold: 50,
      bonusExp: 200,
      bonusGold: 100
    });

    const result = reward.calculateRewards(true);
    expect(result.exp).toBe(300);
    expect(result.gold).toBe(150);
  });

  it('应该根据掉落率计算物品', () => {
    const reward = new DungeonReward({
      items: [{ itemId: 'rare_item', quantity: 1, dropRate: 0 }]
    });

    const result = reward.calculateRewards(false);
    expect(result.items.length).toBe(0);
  });
});

describe('DungeonWave', () => {
  let wave;

  beforeEach(() => {
    wave = new DungeonWave({
      waveNumber: 1,
      enemies: [
        { enemyType: 'slime', count: 3, level: 1 },
        { enemyType: 'goblin', count: 2, level: 2 }
      ]
    });
  });

  it('应该正确计算敌人总数', () => {
    expect(wave.getTotalEnemyCount()).toBe(5);
  });

  it('应该正确开始波次', () => {
    wave.start();
    expect(wave.remainingEnemies).toBe(5);
    expect(wave.isCompleted).toBe(false);
  });

  it('应该正确处理敌人击杀', () => {
    wave.start();
    wave.onEnemyKilled();
    expect(wave.remainingEnemies).toBe(4);
    expect(wave.isCompleted).toBe(false);
  });

  it('应该在所有敌人被击杀后完成', () => {
    wave.start();
    for (let i = 0; i < 5; i++) {
      wave.onEnemyKilled();
    }
    expect(wave.remainingEnemies).toBe(0);
    expect(wave.isCompleted).toBe(true);
  });
});

describe('DungeonTemplate', () => {
  let template;
  let character;

  beforeEach(() => {
    template = new DungeonTemplate({
      id: 'test_dungeon',
      name: '测试副本',
      description: '测试用副本',
      minLevel: 5,
      timeLimit: 300,
      dailyLimit: 3,
      entryCost: 50,
      difficulties: [DungeonDifficulty.NORMAL, DungeonDifficulty.HARD],
      waveConfigs: {
        [DungeonDifficulty.NORMAL]: [
          { enemies: [{ enemyType: 'slime', count: 3, level: 5 }] }
        ]
      },
      rewards: {
        [DungeonDifficulty.NORMAL]: { exp: 100, gold: 50 }
      }
    });

    character = {
      level: 10,
      gold: 100,
      dungeonCounts: {}
    };
  });

  it('应该正确初始化副本模板', () => {
    expect(template.id).toBe('test_dungeon');
    expect(template.name).toBe('测试副本');
    expect(template.minLevel).toBe(5);
  });

  it('等级足够且有金币应该可以进入', () => {
    template.unlock();
    const result = template.canEnter(character, DungeonDifficulty.NORMAL);
    expect(result.canEnter).toBe(true);
  });

  it('等级不足不能进入', () => {
    template.unlock();
    character.level = 3;
    const result = template.canEnter(character, DungeonDifficulty.NORMAL);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('等级');
  });

  it('金币不足不能进入', () => {
    template.unlock();
    character.gold = 10;
    const result = template.canEnter(character, DungeonDifficulty.NORMAL);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('金币');
  });

  it('每日次数用完不能进入', () => {
    template.unlock();
    character.dungeonCounts = { test_dungeon: 3 };
    const result = template.canEnter(character, DungeonDifficulty.NORMAL);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('次数');
  });

  it('应该正确创建副本实例', () => {
    const instance = template.createInstance(character, DungeonDifficulty.NORMAL);
    expect(instance.templateId).toBe('test_dungeon');
    expect(instance.difficulty).toBe(DungeonDifficulty.NORMAL);
    expect(instance.waves.length).toBe(1);
  });
});

describe('DungeonInstance', () => {
  let instance;

  beforeEach(() => {
    instance = new DungeonInstance({
      templateId: 'test_dungeon',
      difficulty: DungeonDifficulty.NORMAL,
      character: { level: 10 },
      timeLimit: 5000
    });

    instance.addWave(new DungeonWave({
      waveNumber: 1,
      enemies: [{ enemyType: 'slime', count: 2, level: 5 }]
    }));
    instance.addWave(new DungeonWave({
      waveNumber: 2,
      enemies: [{ enemyType: 'boss', count: 1, level: 10 }],
      isBossWave: true
    }));
  });

  it('应该正确初始化副本实例', () => {
    expect(instance.state).toBe(DungeonState.IN_PROGRESS);
    expect(instance.waves.length).toBe(2);
  });

  it('应该正确开始副本', () => {
    instance.start();
    expect(instance.currentWave).toBe(0);
    expect(instance.getCurrentWave().remainingEnemies).toBe(2);
  });

  it('应该正确计算进度', () => {
    expect(instance.getProgress()).toBe(0);
    instance.currentWave = 1;
    expect(instance.getProgress()).toBe(50);
  });

  it('应该正确处理敌人击杀', () => {
    instance.start();
    instance.onEnemyKilled();
    expect(instance.stats.enemiesKilled).toBe(1);
  });
});

describe('DungeonSystem', () => {
  let dungeonSystem;
  let character;

  beforeEach(() => {
    dungeonSystem = new DungeonSystem();
    character = {
      level: 10,
      gold: 1000,
      dungeonCounts: {}
    };
  });

  it('应该正确初始化默认副本', () => {
    expect(dungeonSystem.getTemplate('beginner_trial')).not.toBeNull();
    expect(dungeonSystem.getTemplate('dark_mine')).not.toBeNull();
  });

  it('新手试炼应该默认解锁', () => {
    const template = dungeonSystem.getTemplate('beginner_trial');
    expect(template.isUnlocked).toBe(true);
  });

  it('应该正确获取可用副本', () => {
    const available = dungeonSystem.getAvailableDungeons(character);
    expect(available.length).toBeGreaterThan(0);
  });

  it('应该正确进入副本', () => {
    const result = dungeonSystem.enterDungeon('beginner_trial', character, DungeonDifficulty.NORMAL);
    expect(result.success).toBe(true);
    expect(result.instance).not.toBeNull();
  });

  it('进入副本应该扣除入场费', () => {
    dungeonSystem.unlockDungeon('dark_mine');
    const initialGold = character.gold;
    const template = dungeonSystem.getTemplate('dark_mine');
    
    dungeonSystem.enterDungeon('dark_mine', character, DungeonDifficulty.NORMAL);
    expect(character.gold).toBe(initialGold - template.entryCost);
  });

  it('进入副本应该增加今日次数', () => {
    dungeonSystem.enterDungeon('beginner_trial', character, DungeonDifficulty.NORMAL);
    expect(character.dungeonCounts['beginner_trial']).toBe(1);
  });

  it('应该正确解锁副本', () => {
    const template = dungeonSystem.getTemplate('dark_mine');
    expect(template.isUnlocked).toBe(false);
    
    dungeonSystem.unlockDungeon('dark_mine');
    expect(template.isUnlocked).toBe(true);
  });

  it('应该正确检查并解锁副本', () => {
    character.level = 15;
    dungeonSystem.checkAndUnlockDungeons(character);
    
    expect(dungeonSystem.getTemplate('dark_mine').isUnlocked).toBe(true);
    expect(dungeonSystem.getTemplate('poison_abyss').isUnlocked).toBe(true);
  });
});

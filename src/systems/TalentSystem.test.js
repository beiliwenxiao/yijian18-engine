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
 * TalentSystem.test.js
 * 天赋系统单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TalentSystem, TalentTree, TalentNode, TalentType } from './TalentSystem.js';

describe('TalentNode', () => {
  let node;
  let character;
  let talentTree;

  beforeEach(() => {
    node = new TalentNode({
      id: 'test_talent',
      name: '测试天赋',
      description: '这是一个测试天赋',
      type: TalentType.COMBAT,
      maxLevel: 3,
      requiredCharacterLevel: 5,
      requiredTalentPoints: 2,
      position: { x: 0, y: 0 },
      effects: { attackBonus: 10 }
    });

    character = {
      level: 10,
      talentPoints: 5,
      class: 'warrior'
    };

    // 创建一个简单的天赋树用于测试
    talentTree = new TalentTree('warrior', [node]);
  });

  it('应该正确初始化天赋节点', () => {
    expect(node.id).toBe('test_talent');
    expect(node.name).toBe('测试天赋');
    expect(node.maxLevel).toBe(3);
    expect(node.currentLevel).toBe(0);
    expect(node.isLearned).toBe(false);
  });

  it('应该正确检查学习条件', () => {
    const result = node.canLearn(character, talentTree);
    expect(result.canLearn).toBe(true);
  });

  it('角色等级不足时不能学习', () => {
    character.level = 3;
    const result = node.canLearn(character, talentTree);
    expect(result.canLearn).toBe(false);
    expect(result.reason).toContain('角色等级');
  });

  it('天赋点不足时不能学习', () => {
    character.talentPoints = 1;
    const result = node.canLearn(character, talentTree);
    expect(result.canLearn).toBe(false);
    expect(result.reason).toContain('天赋点');
  });

  it('应该正确学习天赋', () => {
    const success = node.learn();
    expect(success).toBe(true);
    expect(node.currentLevel).toBe(1);
    expect(node.isLearned).toBe(true);
  });

  it('达到最大等级后不能继续学习', () => {
    node.learn();
    node.learn();
    node.learn();
    const success = node.learn();
    expect(success).toBe(false);
    expect(node.currentLevel).toBe(3);
  });

  it('应该正确计算当前等级效果', () => {
    node.learn();
    const effects = node.getCurrentEffects();
    expect(effects.attackBonus).toBe(10);

    node.learn();
    const effects2 = node.getCurrentEffects();
    expect(effects2.attackBonus).toBe(20);
  });

  it('应该正确重置天赋', () => {
    node.learn();
    node.learn();
    node.reset();
    expect(node.currentLevel).toBe(0);
    expect(node.isLearned).toBe(false);
  });
});

describe('TalentTree', () => {
  let talentTree;
  let character;

  beforeEach(() => {
    const nodes = [
      new TalentNode({
        id: 'talent_1',
        name: '天赋1',
        description: '基础天赋',
        type: TalentType.COMBAT,
        maxLevel: 3,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 0, y: 0 },
        effects: { attackBonus: 5 }
      }),
      new TalentNode({
        id: 'talent_2',
        name: '天赋2',
        description: '进阶天赋',
        type: TalentType.COMBAT,
        maxLevel: 2,
        prerequisites: ['talent_1'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 0, y: 1 },
        effects: { defenseBonus: 3 }
      })
    ];

    talentTree = new TalentTree('warrior', nodes);
    character = {
      level: 10,
      talentPoints: 10,
      class: 'warrior'
    };
  });

  it('应该正确获取天赋节点', () => {
    const node = talentTree.getNode('talent_1');
    expect(node).not.toBeNull();
    expect(node.name).toBe('天赋1');
  });

  it('应该正确学习天赋', () => {
    const result = talentTree.learnTalent(character, 'talent_1');
    expect(result.success).toBe(true);
    expect(character.talentPoints).toBe(9);
  });

  it('前置天赋未学习时不能学习后续天赋', () => {
    const result = talentTree.learnTalent(character, 'talent_2');
    expect(result.success).toBe(false);
  });

  it('学习前置天赋后可以学习后续天赋', () => {
    talentTree.learnTalent(character, 'talent_1');
    const result = talentTree.learnTalent(character, 'talent_2');
    expect(result.success).toBe(true);
  });

  it('应该正确重置所有天赋', () => {
    talentTree.learnTalent(character, 'talent_1');
    talentTree.learnTalent(character, 'talent_1');
    talentTree.learnTalent(character, 'talent_2');
    
    const initialPoints = character.talentPoints;
    const returnedPoints = talentTree.resetAllTalents(character);
    
    expect(returnedPoints).toBe(4); // 1*2 + 2*1 = 4
    expect(character.talentPoints).toBe(initialPoints + 4);
  });

  it('应该正确计算所有天赋效果', () => {
    talentTree.learnTalent(character, 'talent_1');
    talentTree.learnTalent(character, 'talent_1');
    talentTree.learnTalent(character, 'talent_2');
    
    const effects = talentTree.getAllEffects();
    expect(effects.attackBonus).toBe(10); // 5 * 2
    expect(effects.defenseBonus).toBe(3);  // 3 * 1
  });

  it('应该正确获取已学习天赋数量', () => {
    talentTree.learnTalent(character, 'talent_1');
    talentTree.learnTalent(character, 'talent_1');
    talentTree.learnTalent(character, 'talent_2');
    
    const count = talentTree.getLearnedCount();
    expect(count).toBe(3); // 2 + 1
  });
});

describe('TalentSystem', () => {
  let talentSystem;
  let character;

  beforeEach(() => {
    talentSystem = new TalentSystem();
    character = {
      level: 10,
      talentPoints: 10,
      class: 'warrior'
    };
  });

  it('应该正确初始化所有职业天赋树', () => {
    expect(talentSystem.getTalentTree('warrior')).not.toBeNull();
    expect(talentSystem.getTalentTree('strategist')).not.toBeNull();
    expect(talentSystem.getTalentTree('archer')).not.toBeNull();
  });

  it('应该正确学习天赋', () => {
    const result = talentSystem.learnTalent(character, 'warrior_iron_will');
    expect(result.success).toBe(true);
  });

  it('应该正确检查天赋是否可学习', () => {
    const result = talentSystem.canLearnTalent(character, 'warrior_iron_will');
    expect(result.canLearn).toBe(true);
  });

  it('应该正确重置天赋树', () => {
    talentSystem.learnTalent(character, 'warrior_iron_will');
    talentSystem.learnTalent(character, 'warrior_brutal_force');
    
    const returnedPoints = talentSystem.resetTalentTree(character);
    expect(returnedPoints).toBe(2);
  });

  it('应该正确获取天赋效果', () => {
    talentSystem.learnTalent(character, 'warrior_iron_will');
    talentSystem.learnTalent(character, 'warrior_iron_will');
    
    const effects = talentSystem.getTalentEffects(character);
    expect(effects.maxHpBonus).toBe(100); // 50 * 2
  });

  it('升级时应该获得天赋点', () => {
    character.talentPoints = 0;
    talentSystem.onLevelUp(character, 2);
    expect(character.talentPoints).toBe(1);
  });

  it('应该正确应用天赋效果到角色属性', () => {
    talentSystem.learnTalent(character, 'warrior_iron_will');
    talentSystem.learnTalent(character, 'warrior_brutal_force');
    
    const baseStats = {
      maxHp: 100,
      attack: 10,
      defense: 5
    };
    
    const modifiedStats = talentSystem.applyTalentEffects(character, baseStats);
    expect(modifiedStats.maxHp).toBe(150); // 100 + 50
    expect(modifiedStats.attack).toBe(15); // 10 + 5
  });

  it('不存在的职业应该返回null', () => {
    character.class = 'unknown';
    const tree = talentSystem.getTalentTree(character.class);
    expect(tree).toBeNull();
  });
});

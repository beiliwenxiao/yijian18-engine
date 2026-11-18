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
 * EntityFactory.test.js
 * 实体工厂测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityFactory } from './EntityFactory.js';
import { Entity } from './Entity.js';

describe('EntityFactory', () => {
  let factory;

  beforeEach(() => {
    factory = new EntityFactory();
  });

  describe('createPlayer', () => {
    it('should create a player entity with all required components', () => {
      const characterData = {
        name: 'TestWarrior',
        class: 'warrior',
        level: 1,
        stats: {
          maxHp: 100,
          maxMp: 50,
          attack: 15,
          defense: 10,
          speed: 100
        },
        position: { x: 100, y: 200 },
        skills: []
      };

      const player = factory.createPlayer(characterData);

      expect(player).toBeInstanceOf(Entity);
      expect(player.type).toBe('player');
      expect(player.name).toBe('TestWarrior');
      expect(player.class).toBe('warrior');
      
      // 检查组件
      expect(player.hasComponent('transform')).toBe(true);
      expect(player.hasComponent('stats')).toBe(true);
      expect(player.hasComponent('sprite')).toBe(true);
      expect(player.hasComponent('combat')).toBe(true);
      expect(player.hasComponent('movement')).toBe(true);
    });

    it('should set correct position from character data', () => {
      const characterData = {
        name: 'TestMage',
        class: 'strategist',
        position: { x: 50, y: 75 }
      };

      const player = factory.createPlayer(characterData);
      const transform = player.getComponent('transform');

      expect(transform.position.x).toBe(50);
      expect(transform.position.y).toBe(75);
    });

    it('should set correct stats from character data', () => {
      const characterData = {
        name: 'TestArcher',
        class: 'archer',
        stats: {
          maxHp: 80,
          maxMp: 60,
          attack: 12,
          defense: 8,
          speed: 120
        }
      };

      const player = factory.createPlayer(characterData);
      const stats = player.getComponent('stats');

      expect(stats.maxHp).toBe(80);
      expect(stats.hp).toBe(80);
      expect(stats.maxMp).toBe(60);
      expect(stats.mp).toBe(60);
      expect(stats.attack).toBe(12);
      expect(stats.defense).toBe(8);
      expect(stats.speed).toBe(120);
    });
  });

  describe('createEnemy', () => {
    it('should create an enemy entity with all required components', () => {
      const enemyData = {
        templateId: 'slime',
        name: 'Green Slime',
        level: 1,
        stats: {
          maxHp: 30,
          attack: 5,
          defense: 2,
          speed: 60
        },
        position: { x: 300, y: 400 },
        aiType: 'aggressive'
      };

      const enemy = factory.createEnemy(enemyData);

      expect(enemy).toBeInstanceOf(Entity);
      expect(enemy.type).toBe('enemy');
      expect(enemy.name).toBe('Green Slime');
      expect(enemy.templateId).toBe('slime');
      expect(enemy.aiType).toBe('aggressive');
      
      // 检查组件
      expect(enemy.hasComponent('transform')).toBe(true);
      expect(enemy.hasComponent('stats')).toBe(true);
      expect(enemy.hasComponent('sprite')).toBe(true);
      expect(enemy.hasComponent('combat')).toBe(true);
      expect(enemy.hasComponent('movement')).toBe(true);
    });

    it('should use default values when stats are not provided', () => {
      const enemyData = {
        templateId: 'goblin',
        name: 'Goblin',
        position: { x: 0, y: 0 }
      };

      const enemy = factory.createEnemy(enemyData);
      const stats = enemy.getComponent('stats');

      expect(stats.maxHp).toBe(50);
      expect(stats.attack).toBe(5);
      expect(stats.defense).toBe(2);
    });

    it('should pass through avatar/dialogueAvatar/portraitImage and skills', () => {
      const enemy = factory.createEnemy({
        templateId: 'slime',
        name: 'Avatar Slime',
        avatar: 'ui.avatar.enemy',
        dialogueAvatar: 'ui.dialogue.enemy',
        portraitImage: 'ui.portrait.enemy',
        skills: ['skill_a', 'skill_b', 'skill_c', 'skill_d']
      });

      expect(enemy.avatarImageId).toBe('ui.avatar.enemy');
      expect(enemy.dialogueAvatarImageId).toBe('ui.dialogue.enemy');
      expect(enemy.portraitImageId).toBe('ui.portrait.enemy');
      // 最多保留 3 个技能槽
      expect(enemy.skillIds).toEqual(['skill_a', 'skill_b', 'skill_c']);
    });

    it('should leave image ids null when not configured (旧数据零回归)', () => {
      const enemy = factory.createEnemy({ templateId: 'goblin', name: 'Goblin' });

      expect(enemy.avatarImageId).toBeNull();
      expect(enemy.dialogueAvatarImageId).toBeNull();
      expect(enemy.portraitImageId).toBeNull();
      expect(enemy.skillIds).toEqual([]);
    });
  });

  describe('createNPC', () => {
    it('should pass through avatar/dialogueAvatar/portraitImage and level/skills', () => {
      const npc = factory.createNPC({
        id: 'npc.test',
        name: '测试NPC',
        avatar: 'ui.avatar.npc',
        dialogueAvatar: 'ui.dialogue.npc',
        portraitImage: 'ui.portrait.npc',
        level: 7,
        stats: { maxHp: 120, attack: 9 },
        skills: ['skill_fire', '', 'skill_ice', 'skill_extra']
      });

      expect(npc.avatarImageId).toBe('ui.avatar.npc');
      expect(npc.dialogueAvatarImageId).toBe('ui.dialogue.npc');
      expect(npc.portraitImageId).toBe('ui.portrait.npc');
      // 空槽过滤 + 最多 3 个
      expect(npc.skillIds).toEqual(['skill_fire', 'skill_ice', 'skill_extra']);
      const stats = npc.getComponent('stats');
      expect(stats.level).toBe(7);
      expect(stats.maxHp).toBe(120);
    });

    it('should leave image ids null and skip stats when not configured (旧数据零回归)', () => {
      const npc = factory.createNPC({ id: 'npc.legacy', name: '旧NPC' });

      expect(npc.avatarImageId).toBeNull();
      expect(npc.dialogueAvatarImageId).toBeNull();
      expect(npc.portraitImageId).toBeNull();
      expect(npc.skillIds).toEqual([]);
      expect(npc.hasComponent('stats')).toBe(false);
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = factory.generateId();
      const id2 = factory.generateId();
      const id3 = factory.generateId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });
});

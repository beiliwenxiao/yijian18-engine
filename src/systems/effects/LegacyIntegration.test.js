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

import { describe, it, expect, beforeEach } from 'vitest';
import { EffectResolver } from './EffectResolver.js';
import { TalentSystem } from '../TalentSystem.js';
import { SkillTreeSystem } from '../SkillTreeSystem.js';
import { ClassSystem, ClassType } from '../ClassSystem.js';

/**
 * 验证现有系统改接 EffectResolver 后行为不回退，
 * 并验证多角色状态隔离与来源可追溯。
 */

describe('TalentSystem 接入 EffectResolver', () => {
  let talentSystem;
  let character;

  beforeEach(() => {
    talentSystem = new TalentSystem();
    character = { id: 'hero-1', class: 'warrior', level: 10, talentPoints: 10 };
  });

  it('无天赋时返回基础属性副本', () => {
    const stats = talentSystem.applyTalentEffects(character, { maxHp: 100, attack: 10 });
    expect(stats.maxHp).toBe(100);
    expect(stats.attack).toBe(10);
  });

  it('天赋加成通过统一结算器写入属性', () => {
    talentSystem.learnTalent(character, 'warrior_iron_will');
    talentSystem.learnTalent(character, 'warrior_brutal_force');

    const stats = talentSystem.applyTalentEffects(character, {
      maxHp: 100, maxMp: 50, attack: 10, defense: 5, speed: 100
    });

    expect(stats.maxHp).toBe(150);
    expect(stats.attack).toBe(15);
    expect(stats.defense).toBe(5);
  });

  it('保留 talentEffects 旧字段供未迁移系统使用', () => {
    talentSystem.learnTalent(character, 'warrior_iron_will');
    const stats = talentSystem.applyTalentEffects(character, { maxHp: 100 });
    expect(stats.talentEffects.maxHpBonus).toBe(50);
  });

  it('基础属性缺少字段时也能写入天赋提供的回复值', () => {
    character.level = 10;
    talentSystem.learnTalent(character, 'warrior_iron_will');
    talentSystem.learnTalent(character, 'warrior_vitality');

    const stats = talentSystem.applyTalentEffects(character, { maxHp: 100 });
    expect(stats.hpRegen).toBe(2);
  });

  it('重置天赋后效果来源同时被移除', () => {
    talentSystem.learnTalent(character, 'warrior_iron_will');
    expect(talentSystem.applyTalentEffects(character, { maxHp: 100 }).maxHp).toBe(150);

    talentSystem.resetTalentTree(character);
    const stats = talentSystem.applyTalentEffects(character, { maxHp: 100 });
    expect(stats.maxHp).toBe(100);
    expect(talentSystem.effectResolver.hasSource('hero-1', 'talent:warrior')).toBe(false);
  });

  it('explainTalentEffect 返回来源明细', () => {
    talentSystem.learnTalent(character, 'warrior_brutal_force');
    const detail = talentSystem.explainTalentEffect(character, 'attack', 10);
    expect(detail.baseValue).toBe(10);
    expect(detail.finalValue).toBe(15);
    expect(detail.sources[0].sourceKind).toBe('talent');
  });
});

describe('SkillTreeSystem 被动效果应用', () => {
  let skillTreeSystem;
  let character;

  beforeEach(() => {
    skillTreeSystem = new SkillTreeSystem();
    character = { id: 'hero-2', class: 'warrior', level: 10, skillPoints: 10 };
  });

  it('未学习被动时属性保持不变', () => {
    const stats = skillTreeSystem.applyPassiveEffects(character, { attack: 10, defense: 5 });
    expect(stats.attack).toBe(10);
    expect(stats.defense).toBe(5);
  });

  it('已学被动技能通过统一结算器影响属性', () => {
    skillTreeSystem.learnSkill(character, 'warrior_basic_combat');
    const stats = skillTreeSystem.applyPassiveEffects(character, { attack: 10, defense: 5 });
    expect(stats.attack).toBe(12);
    expect(stats.defense).toBe(6);
  });

  it('与天赋系统共用结算器时效果叠加', () => {
    const shared = new EffectResolver();
    const skills = new SkillTreeSystem({ effectResolver: shared });
    const talents = new TalentSystem({ effectResolver: shared });
    const hero = { id: 'hero-3', class: 'warrior', level: 10, skillPoints: 10, talentPoints: 10 };

    skills.learnSkill(hero, 'warrior_basic_combat'); // attack +2
    talents.learnTalent(hero, 'warrior_brutal_force'); // attack +5
    skills.syncEffectSource(hero);
    talents.syncEffectSource(hero);

    expect(shared.getValue('hero-3', 'attack', 10)).toBe(17);

    const detail = shared.explain('hero-3', 'attack', 10);
    const kinds = detail.sources.map(s => s.sourceKind);
    expect(kinds).toContain('skill');
    expect(kinds).toContain('talent');
  });
});

describe('ClassSystem 特化加成', () => {
  let classSystem;

  beforeEach(() => {
    classSystem = new ClassSystem();
  });

  it('未选特化时不产生特化加成来源', () => {
    classSystem.selectClass('c1', ClassType.WARRIOR);
    const stats = classSystem.calculateFinalStats('c1', { level: 1, hp: 150, mp: 30 });

    // 未选特化：只有职业基础与属性系统加成，不写入 specializationBonuses
    expect(stats.specializationBonuses).toBeUndefined();
    expect(stats.maxHp).toBeGreaterThanOrEqual(150);
    // 现行契约：selectClass 会登记职业固定来源 class:<id>，但不得产生特化来源
    const sources = classSystem.effectResolver.getSources('c1');
    expect(sources.some(source => String(source.id || '').startsWith('specialization:'))).toBe(false);
  });

  it('重甲步兵特化按倍率提升生命与防御', () => {
    classSystem.selectClass('c2', ClassType.WARRIOR);
    const before = classSystem.calculateFinalStats('c2', { level: 1, hp: 150, mp: 30 });

    classSystem.selectSpecialization('c2', 'warrior_heavy_infantry', 10);
    const after = classSystem.calculateFinalStats('c2', { level: 1, hp: 150, mp: 30 });

    expect(after.maxHp).toBe(Math.floor(before.maxHp * 1.2));
    expect(after.defense).toBe(Math.floor(before.defense * 1.3));
    expect(after.specializationBonuses.damageReduction).toBe(0.1);
  });

  it('不同角色的特化互不影响', () => {
    classSystem.selectClass('c3', ClassType.WARRIOR);
    classSystem.selectClass('c4', ClassType.WARRIOR);
    classSystem.selectSpecialization('c3', 'warrior_berserker', 10);

    const withSpec = classSystem.calculateFinalStats('c3', { level: 1, hp: 150, mp: 30 });
    const withoutSpec = classSystem.calculateFinalStats('c4', { level: 1, hp: 150, mp: 30 });

    expect(withSpec.attack).toBeGreaterThan(withoutSpec.attack);
  });
});

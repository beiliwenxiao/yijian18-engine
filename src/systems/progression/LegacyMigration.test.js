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
import { LegacyProgressionAdapter } from './LegacyProgressionAdapter.js';
import {
  convertSkillTreeSystem,
  convertTalentSystem,
  convertLegacyEffects,
  convertSkillNode,
  convertTalentNode
} from './LegacyTreeConverter.js';
import { GraphDefinition, GraphMode, PointPool } from './GraphDefinition.js';
import { NodeKind } from './NodeDefinition.js';
import { SkillTreeSystem } from '../SkillTreeSystem.js';
import { TalentSystem } from '../TalentSystem.js';

describe('LegacyTreeConverter 效果转换', () => {
  it('数值字段映射为标准效果并保留按等级累计语义', () => {
    const effects = convertLegacyEffects({ attackBonus: 5 });
    expect(effects).toHaveLength(1);
    expect(effects[0].target).toBe('attack');
    expect(effects[0].operation).toBe('add');
    expect(effects[0].value).toBe(5);
  });

  it('数组字段保留数组值以按等级取项', () => {
    const effects = convertLegacyEffects({ damageReduction: [0.1, 0.15, 0.2] });
    expect(effects[0].value).toEqual([0.1, 0.15, 0.2]);
  });

  it('未登记字段转为 legacy 规则覆盖而不丢弃', () => {
    const effects = convertLegacyEffects({ controlImmunity: true });
    expect(effects[0].type).toBe('rule.override');
    expect(effects[0].target).toBe('legacy.controlImmunity');
    expect(effects[0].value).toBe(true);
  });

  it('主动技能节点额外产出 skill.unlock', () => {
    const node = convertSkillNode({
      id: 'whirlwind', name: '旋风斩', type: 'active', maxLevel: 3,
      requiredPoints: 3, requiredLevel: 15, effects: { damageMultiplier: [1.5, 1.8, 2.2] }
    });
    expect(node.kind).toBe(NodeKind.ACTIVE_SKILL);
    expect(node.effects[0].type).toBe('skill.unlock');
    expect(node.effects[0].target).toBe('whirlwind');
    expect(node.costs[PointPool.SKILL]).toBe(3);
    expect(node.gates.characterLevel).toBe(15);
  });

  it('天赋节点按类型写入区域', () => {
    const node = convertTalentNode({
      id: 'iron_will', name: '钢铁意志', type: 'survival', maxLevel: 5,
      requiredTalentPoints: 1, effects: { maxHpBonus: 50 }
    });
    expect(node.region).toBe('survival');
    expect(node.costs[PointPool.TALENT]).toBe(1);
    expect(node.maxRank).toBe(5);
  });
});

describe('从现有硬编码树导出图配置', () => {
  it('技能树系统可全部转换为合法图配置', () => {
    const graphs = convertSkillTreeSystem(new SkillTreeSystem());
    expect(graphs.length).toBeGreaterThanOrEqual(3);

    for (const config of graphs) {
      const graph = new GraphDefinition(config);
      const result = graph.validate();
      expect(result.ok, `${config.id} 校验失败: ${JSON.stringify(result.errors)}`).toBe(true);
    }
  });

  it('天赋系统可全部转换为合法图配置', () => {
    const graphs = convertTalentSystem(new TalentSystem());
    expect(graphs.length).toBeGreaterThanOrEqual(3);

    for (const config of graphs) {
      const graph = new GraphDefinition(config);
      expect(graph.validate().ok, `${config.id} 校验失败`).toBe(true);
    }
  });

  it('导出的配置可序列化后再次解析', () => {
    const config = convertTalentSystem(new TalentSystem())[0];
    const json = new GraphDefinition(config).toJSON();
    expect(new GraphDefinition(json).toJSON()).toEqual(json);
  });

  it('转换保留原有节点数量', () => {
    const talentSystem = new TalentSystem();
    const warriorTree = talentSystem.getTalentTree('warrior');
    const config = convertTalentSystem(talentSystem).find(g => g.id === 'warrior-talent');
    expect(config.nodes).toHaveLength(warriorTree.getAllNodes().length);
  });
});

describe('LegacyProgressionAdapter 旧 API 兼容', () => {
  let adapter;
  let character;

  beforeEach(() => {
    adapter = new LegacyProgressionAdapter();
    adapter.registerGraphs(convertSkillTreeSystem(new SkillTreeSystem()));
    adapter.registerGraphs(convertTalentSystem(new TalentSystem()));
    character = { id: 'hero-1', class: 'warrior', level: 20, skillPoints: 10, talentPoints: 10 };
  });

  it('learnTalent 返回旧格式并扣除角色天赋点', () => {
    const result = adapter.learnTalent(character, 'warrior_iron_will');
    expect(result.success).toBe(true);
    expect(result.message).toContain('钢铁意志');
    expect(character.talentPoints).toBe(9);
  });

  it('前置未满足时 learnTalent 失败且不扣点', () => {
    const result = adapter.learnTalent(character, 'warrior_blood_rage');
    expect(result.success).toBe(false);
    expect(character.talentPoints).toBe(10);
  });

  it('learnSkill 返回布尔并扣除技能点', () => {
    expect(adapter.learnSkill(character, 'warrior_basic_combat')).toBe(true);
    expect(character.skillPoints).toBe(9);
  });

  it('canLearnTalent 返回旧格式原因', () => {
    const result = adapter.canLearnTalent(character, 'warrior_blood_rage');
    expect(result.canLearn).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  it('getTalentEffects 仍返回旧字段名并按等级累计', () => {
    adapter.learnTalent(character, 'warrior_iron_will');
    adapter.learnTalent(character, 'warrior_iron_will');

    const effects = adapter.getTalentEffects(character);
    expect(effects.maxHpBonus).toBe(100);
  });

  it('getPassiveEffects 只统计被动技能节点', () => {
    adapter.learnSkill(character, 'warrior_basic_combat');
    const effects = adapter.getPassiveEffects(character);
    expect(effects.attackBonus).toBe(2);
    expect(effects.defenseBonus).toBe(1);
  });

  it('getActiveSkills 返回已学主动技能', () => {
    adapter.learnSkill(character, 'warrior_basic_combat');
    adapter.learnSkill(character, 'warrior_weapon_mastery');
    adapter.learnSkill(character, 'warrior_berserker_rage');

    const skills = adapter.getActiveSkills(character);
    expect(skills.map(s => s.id)).toContain('warrior_berserker_rage');
    expect(skills.every(s => s.id !== 'warrior_basic_combat')).toBe(true);
  });

  it('主动技能解锁后可被 EffectResolver 查询', () => {
    adapter.learnSkill(character, 'warrior_basic_combat');
    adapter.learnSkill(character, 'warrior_weapon_mastery');
    adapter.learnSkill(character, 'warrior_berserker_rage');

    expect(adapter.effectResolver.getUnlockedSkills('hero-1')).toContain('warrior_berserker_rage');
  });

  it('resetTalentTree 返还全部天赋点', () => {
    adapter.learnTalent(character, 'warrior_iron_will');
    adapter.learnTalent(character, 'warrior_brutal_force');
    expect(character.talentPoints).toBe(8);

    const refunded = adapter.resetTalentTree(character);
    expect(refunded).toBe(2);
    expect(character.talentPoints).toBe(10);
    expect(adapter.getTalentEffects(character)).toEqual({});
  });

  it('applyEffectsToStats 与旧 applyTalentEffects 结果一致', () => {
    adapter.learnTalent(character, 'warrior_iron_will');
    adapter.learnTalent(character, 'warrior_brutal_force');

    const stats = adapter.applyEffectsToStats(character, {
      maxHp: 100, maxMp: 50, attack: 10, defense: 5, speed: 100
    });

    expect(stats.maxHp).toBe(150);
    expect(stats.attack).toBe(15);
    expect(stats.defense).toBe(5);
  });

  it('多角色状态互相隔离', () => {
    const other = { id: 'hero-2', class: 'warrior', level: 20, talentPoints: 10 };
    adapter.learnTalent(character, 'warrior_iron_will');

    expect(adapter.getNodeRank(character, GraphMode.CLASS_TALENT, 'warrior_iron_will')).toBe(1);
    expect(adapter.getNodeRank(other, GraphMode.CLASS_TALENT, 'warrior_iron_will')).toBe(0);
    expect(adapter.getTalentEffects(other)).toEqual({});
  });

  it('角色点数字段可作为唯一来源被同步', () => {
    character.talentPoints = 1;
    expect(adapter.learnTalent(character, 'warrior_iron_will').success).toBe(true);
    expect(character.talentPoints).toBe(0);
    expect(adapter.learnTalent(character, 'warrior_brutal_force').success).toBe(false);
  });

  it('存档往返后等级、点数与效果保持一致', () => {
    adapter.learnTalent(character, 'warrior_iron_will');
    adapter.learnSkill(character, 'warrior_basic_combat');
    const saved = adapter.serialize(character);

    const restoredAdapter = new LegacyProgressionAdapter();
    restoredAdapter.registerGraphs(convertSkillTreeSystem(new SkillTreeSystem()));
    restoredAdapter.registerGraphs(convertTalentSystem(new TalentSystem()));

    const restoredCharacter = { id: 'hero-1', class: 'warrior', level: 20 };
    const result = restoredAdapter.deserialize(restoredCharacter, saved);

    expect(result.ok).toBe(true);
    expect(restoredAdapter.getTalentEffects(restoredCharacter).maxHpBonus).toBe(50);
    expect(restoredCharacter.talentPoints).toBe(9);
    expect(restoredCharacter.skillPoints).toBe(9);
  });

  it('视图模型可用于替换旧面板数据源', () => {
    adapter.learnTalent(character, 'warrior_iron_will');
    const vm = adapter.getViewModel(character, GraphMode.CLASS_TALENT);

    expect(vm.mode).toBe(GraphMode.CLASS_TALENT);
    expect(vm.nodes.find(n => n.id === 'warrior_iron_will').rank).toBe(1);
    expect(vm.availablePoints).toBe(9);
  });
});

describe('SkillTreeSystem / TalentSystem 转发到成长图内核', () => {
  let skillTreeSystem;
  let talentSystem;
  let hero;
  let other;

  beforeEach(() => {
    skillTreeSystem = new SkillTreeSystem();
    talentSystem = new TalentSystem();
    hero = { id: 'hero-1', class: 'warrior', level: 20, skillPoints: 10, talentPoints: 10 };
    other = { id: 'hero-2', class: 'warrior', level: 20, skillPoints: 10, talentPoints: 10 };
  });

  it('learnSkill 结果保存在按角色隔离的状态中', () => {
    expect(skillTreeSystem.learnSkill(hero, 'warrior_basic_combat')).toBe(true);
    expect(hero.skillPoints).toBe(9);

    // 关键改进：另一角色不受影响（旧实现共享节点等级）
    expect(skillTreeSystem.getPassiveEffects(other)).toEqual({});
    expect(other.skillPoints).toBe(10);
  });

  it('learnTalent 结果按角色隔离', () => {
    talentSystem.learnTalent(hero, 'warrior_iron_will');
    expect(talentSystem.getTalentEffects(hero).maxHpBonus).toBe(50);
    expect(talentSystem.getTalentEffects(other)).toEqual({});
  });

  it('共享节点上的等级是当前角色的投影', () => {
    talentSystem.learnTalent(hero, 'warrior_iron_will');
    const node = talentSystem.getTalentTree('warrior').getNode('warrior_iron_will');
    expect(node.currentLevel).toBe(1);
    expect(node.isLearned).toBe(true);

    // 切换到另一角色后投影随之刷新
    talentSystem.projectCharacterState(other);
    expect(node.currentLevel).toBe(0);
    expect(node.isLearned).toBe(false);
  });

  it('前置未满足时拒绝并保留点数', () => {
    const result = talentSystem.learnTalent(hero, 'warrior_blood_rage');
    expect(result.success).toBe(false);
    expect(hero.talentPoints).toBe(10);
  });

  it('不存在的天赋返回旧格式错误', () => {
    const result = talentSystem.learnTalent(hero, 'not_exist');
    expect(result.success).toBe(false);
    expect(result.message).toContain('不存在');
  });

  it('canLearnSkill 与 canLearnTalent 保持旧返回类型', () => {
    expect(typeof skillTreeSystem.canLearnSkill(hero, 'warrior_basic_combat')).toBe('boolean');
    const talentCheck = talentSystem.canLearnTalent(hero, 'warrior_iron_will');
    expect(talentCheck.canLearn).toBe(true);
  });

  it('重置返还点数并清空效果', () => {
    skillTreeSystem.learnSkill(hero, 'warrior_basic_combat');
    expect(skillTreeSystem.resetSkillTree(hero)).toBe(1);
    expect(hero.skillPoints).toBe(10);
    expect(skillTreeSystem.getPassiveEffects(hero)).toEqual({});
  });

  it('主动技能通过转发后可被 EffectResolver 查询', () => {
    skillTreeSystem.learnSkill(hero, 'warrior_basic_combat');
    skillTreeSystem.learnSkill(hero, 'warrior_weapon_mastery');
    skillTreeSystem.learnSkill(hero, 'warrior_berserker_rage');

    expect(skillTreeSystem.getUnlockedActiveSkillIds(hero)).toContain('warrior_berserker_rage');
    expect(skillTreeSystem.effectResolver.getUnlockedSkills('hero-1')).toContain('warrior_berserker_rage');
  });

  it('applyTalentEffects 与改造前结果一致', () => {
    talentSystem.learnTalent(hero, 'warrior_iron_will');
    talentSystem.learnTalent(hero, 'warrior_brutal_force');

    const stats = talentSystem.applyTalentEffects(hero, { maxHp: 100, attack: 10, defense: 5 });
    expect(stats.maxHp).toBe(150);
    expect(stats.attack).toBe(15);
    expect(stats.talentEffects.maxHpBonus).toBe(50);
  });

  it('applyPassiveEffects 使用统一结算器', () => {
    skillTreeSystem.learnSkill(hero, 'warrior_basic_combat');
    const stats = skillTreeSystem.applyPassiveEffects(hero, { attack: 10, defense: 5 });
    expect(stats.attack).toBe(12);
    expect(stats.defense).toBe(6);
  });

  it('技能与天赋共用结算器时效果叠加', () => {
    const shared = new SkillTreeSystem();
    const talents = new TalentSystem({ progressionSystem: shared.progressionSystem });
    talents._registerProgressionGraphs();

    shared.learnSkill(hero, 'warrior_basic_combat'); // attack +2
    talents.learnTalent(hero, 'warrior_brutal_force'); // attack +5

    expect(shared.progressionSystem.effectResolver.getValue('hero-1', 'attack', 10)).toBe(17);
  });

  it('存档往返后等级与效果一致', () => {
    talentSystem.learnTalent(hero, 'warrior_iron_will');
    const saved = talentSystem.serializeCharacter(hero);

    const restoredSystem = new TalentSystem();
    const restoredHero = { id: 'hero-1', class: 'warrior', level: 20 };
    const result = restoredSystem.deserializeCharacter(restoredHero, saved);

    expect(result.ok).toBe(true);
    expect(restoredSystem.getTalentEffects(restoredHero).maxHpBonus).toBe(50);
    expect(restoredHero.talentPoints).toBe(9);
  });

  it('getViewModel 可作为 UI 新数据源', () => {
    skillTreeSystem.learnSkill(hero, 'warrior_basic_combat');
    const vm = skillTreeSystem.getViewModel(hero);
    expect(vm.nodes.find(n => n.id === 'warrior_basic_combat').rank).toBe(1);
    expect(vm.availablePoints).toBe(9);
  });
});

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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GraphDefinition, GraphMode } from '../../../src/systems/progression/GraphDefinition.js';
import { ProgressionGraphSystem } from '../../../src/systems/progression/ProgressionGraphSystem.js';
import { SkillRegistry } from '../../../src/systems/ability/SkillRegistry.js';
import { AbilitySystem } from '../../../src/systems/ability/AbilitySystem.js';
import { PointPool } from '../../../src/systems/progression/GraphDefinition.js';

const configDir = dirname(fileURLToPath(import.meta.url));

function loadJson(name) {
  return JSON.parse(readFileSync(join(configDir, name), 'utf-8'));
}

const skillsConfig = loadJson('skills.json');
const warriorSkillGraph = loadJson('progression-warrior-skill.json');

describe('Demo 技能定义配置', () => {
  it('全部技能定义通过校验', () => {
    const registry = new SkillRegistry();
    const result = registry.registerAll(skillsConfig.skills);
    expect(result.errors).toEqual([]);
    expect(result.registered).toBe(skillsConfig.skills.length);
  });

  it('位移能力四类齐备', () => {
    const registry = new SkillRegistry();
    registry.registerAll(skillsConfig.skills);
    const ids = registry.getByCategory('locomotion').map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(['jump', 'power_jump', 'flight', 'climb']));
  });

  it('形态定义可被解析', () => {
    const registry = new SkillRegistry();
    registry.registerAll(skillsConfig.skills);

    const cleave = registry.get('cleave');
    expect(cleave.hasVariant('whirlwind')).toBe(true);
    expect(cleave.resolveVariant('whirlwind').targeting).toBe('area');

    const flight = registry.get('flight');
    expect(flight.hasVariant('double_flight')).toBe(true);
  });
});

describe('Demo 战士技能树配置', () => {
  it('图定义通过校验', () => {
    const graph = new GraphDefinition(warriorSkillGraph);
    const result = graph.validate();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('模式与点数池正确', () => {
    const graph = new GraphDefinition(warriorSkillGraph);
    expect(graph.mode).toBe(GraphMode.CLASS_SKILL);
    expect(graph.pointPool).toBe(PointPool.SKILL);
  });

  it('技能解锁节点引用的技能都存在定义', () => {
    const registry = new SkillRegistry();
    registry.registerAll(skillsConfig.skills);

    const graph = new GraphDefinition(warriorSkillGraph);
    for (const node of graph.getAllNodes()) {
      for (const effect of node.effects) {
        if (effect.type === 'skill.unlock') {
          expect(registry.has(effect.target), `未定义技能: ${effect.target}`).toBe(true);
        }
      }
    }
  });

  it('形态覆盖效果引用的形态都存在', () => {
    const registry = new SkillRegistry();
    registry.registerAll(skillsConfig.skills);

    const graph = new GraphDefinition(warriorSkillGraph);
    for (const node of graph.getAllNodes()) {
      for (const effect of node.effects) {
        if (effect.type !== 'rule.override') continue;
        const match = /^skill\.(.+)\.variant$/.exec(effect.target);
        if (!match) continue;

        const def = registry.get(match[1]);
        expect(def, `未定义技能: ${match[1]}`).not.toBeNull();
        expect(def.hasVariant(effect.value), `未定义形态: ${effect.value}`).toBe(true);
      }
    }
  });

  it('互斥组内节点不少于两个，否则互斥无意义', () => {
    const graph = new GraphDefinition(warriorSkillGraph);
    const groups = new Map();

    for (const node of graph.getAllNodes()) {
      if (!node.choiceGroup) continue;
      groups.set(node.choiceGroup, (groups.get(node.choiceGroup) || 0) + 1);
    }

    expect(groups.size).toBeGreaterThan(0);
    for (const [group, count] of groups) {
      expect(count, `互斥组 ${group} 仅有 ${count} 个节点`).toBeGreaterThanOrEqual(2);
    }
  });

  it('配置可驱动完整的解锁到形态流程', () => {
    const progression = new ProgressionGraphSystem();
    expect(progression.registerGraph(warriorSkillGraph).ok).toBe(true);
    progression.grantPoints('hero', PointPool.SKILL, 30);

    const registry = new SkillRegistry();
    registry.registerAll(skillsConfig.skills);

    const ability = new AbilitySystem({
      skillRegistry: registry,
      effectResolver: progression.effectResolver,
      now: () => 0,
      executor: () => true
    });
    const caster = {
      id: 'hero',
      getComponent: (n) => ({
        transform: { position: { x: 0, y: 0 } },
        stats: { mp: 100, stamina: 100 },
        combat: { skills: [], skillCooldowns: new Map(), isCasting: false }
      })[n] || null
    };

    progression.allocateNode('hero', 'warrior-skill', 'cleave');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    const form = progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind');

    expect(form.ok).toBe(true);
    expect(ability.resolveSkillVariant(caster, 'cleave')).toBe('whirlwind');
    // 旋风斩基线 20，两级强化 +20%
    expect(ability.resolveSkillParams(caster, 'cleave').damage).toBeCloseTo(24, 5);
  });

  it('keystone 提供带取舍的规则覆盖', () => {
    const progression = new ProgressionGraphSystem();
    progression.registerGraph(warriorSkillGraph);
    progression.grantPoints('hero', PointPool.SKILL, 30);

    for (let i = 0; i < 5; i++) {
      progression.allocateNode('hero', 'warrior-skill', 'warrior_toughness');
    }
    const result = progression.allocateNode('hero', 'warrior-skill', 'warrior_unyielding', { characterLevel: 12 });

    expect(result.ok).toBe(true);
    expect(progression.effectResolver.hasRuleOverride('hero', 'combat.knockbackImmune')).toBe(true);
    // 取舍：受到治疗降低 30%
    expect(progression.effectResolver.getValue('hero', 'healingReceived', 100)).toBe(70);
  });
});

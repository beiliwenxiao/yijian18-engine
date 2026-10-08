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
import { AbilitySystem } from './AbilitySystem.js';
import { SkillRegistry } from './SkillRegistry.js';
import { SkillDefinition } from './SkillDefinition.js';
import { ProgressionGraphSystem } from '../progression/ProgressionGraphSystem.js';
import { GraphMode, PointPool } from '../progression/GraphDefinition.js';
import { AllocationReject } from '../progression/AllocationRules.js';

/** 与 example/sanguo_zhangjiao/config/skills.json 的劈砍定义一致 */
function makeCleaveDefinition() {
  return {
    id: 'cleave',
    name: '劈砍',
    category: 'attack',
    targeting: 'direction',
    params: { damage: 30, range: 90, radius: 60, cooldown: 4 },
    costs: { stamina: 10 },
    variants: {
      whirlwind: {
        name: '旋风斩',
        targeting: 'area',
        params: { damage: 20, radius: 120, cooldown: 6 },
        vfx: { effect: 'whirlwind' }
      },
      execute: {
        name: '斩杀',
        targeting: 'entity',
        params: { damage: 70, range: 70, cooldown: 9 }
      }
    }
  };
}

/** 暗黑式分支图：解锁 → 两条强化 → 二选一形态 */
function makeBranchGraph() {
  return {
    id: 'warrior-skill',
    mode: GraphMode.CLASS_SKILL,
    version: 1,
    nodes: [
      {
        id: 'cleave',
        kind: 'activeSkill',
        region: 'cleave',
        effects: [{ type: 'skill.unlock', target: 'cleave', value: true }]
      },
      {
        id: 'cleave_damage',
        kind: 'skillModifier',
        maxRank: 3,
        prerequisites: ['cleave'],
        region: 'cleave',
        effects: [{ type: 'skill.modify', target: 'skill.cleave.damage', operation: 'addPercent', value: 0.1 }]
      },
      {
        id: 'cleave_cooldown',
        kind: 'skillModifier',
        maxRank: 2,
        prerequisites: ['cleave'],
        region: 'cleave',
        effects: [{ type: 'skill.modify', target: 'skill.cleave.cooldown', operation: 'add', value: -0.5 }]
      },
      {
        id: 'cleave_form_whirlwind',
        kind: 'skillModifier',
        prerequisites: { mode: 'any', nodes: ['cleave_damage', 'cleave_cooldown'] },
        choiceGroup: 'cleave_form',
        gates: { spentInRegion: 3 },
        region: 'cleave',
        effects: [{ type: 'rule.override', target: 'skill.cleave.variant', value: 'whirlwind' }]
      },
      {
        id: 'cleave_form_execute',
        kind: 'skillModifier',
        prerequisites: { mode: 'any', nodes: ['cleave_damage', 'cleave_cooldown'] },
        choiceGroup: 'cleave_form',
        gates: { spentInRegion: 3 },
        region: 'cleave',
        effects: [{ type: 'rule.override', target: 'skill.cleave.variant', value: 'execute' }]
      }
    ]
  };
}

function makeCaster(id = 'hero') {
  const components = {
    transform: { position: { x: 0, y: 0 } },
    stats: { mp: 100, stamina: 100 },
    combat: { skills: [], skillCooldowns: new Map(), isCasting: false, castingSkill: null, castStartTime: 0 }
  };
  return { id, type: 'player', getComponent: (n) => components[n] || null, components };
}

describe('SkillDefinition 形态替换', () => {
  it('未指定形态时返回基础定义视图', () => {
    const def = new SkillDefinition(makeCleaveDefinition());
    const view = def.resolveVariant(null);
    expect(view.name).toBe('劈砍');
    expect(view.params.damage).toBe(30);
    expect(view.variantId).toBeNull();
  });

  it('形态只覆盖显式声明的字段', () => {
    const def = new SkillDefinition(makeCleaveDefinition());
    const view = def.resolveVariant('whirlwind');
    expect(view.name).toBe('旋风斩');
    expect(view.targeting).toBe('area');
    expect(view.params.damage).toBe(20);
    expect(view.params.radius).toBe(120);
    // range 未被形态覆盖，沿用基础定义
    expect(view.params.range).toBe(90);
    // 消耗未被覆盖
    expect(view.costs.stamina).toBe(10);
  });

  it('未知形态回退为基础定义', () => {
    const def = new SkillDefinition(makeCleaveDefinition());
    expect(def.hasVariant('unknown')).toBe(false);
    expect(def.resolveVariant('unknown').params.damage).toBe(30);
  });

  it('形态定义可序列化后再次解析', () => {
    const json = new SkillDefinition(makeCleaveDefinition()).toJSON();
    expect(new SkillDefinition(json).toJSON()).toEqual(json);
  });
});

describe('暗黑式分支：互斥与门槛', () => {
  let progression;

  beforeEach(() => {
    progression = new ProgressionGraphSystem();
    const result = progression.registerGraph(makeBranchGraph());
    expect(result.ok).toBe(true);
    progression.grantPoints('hero', PointPool.SKILL, 20);
  });

  it('区域投入不足时形态节点被门槛拒绝', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');

    const result = progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind');
    expect(result.reason).toBe(AllocationReject.GATE_REGION);
    expect(result.required).toBe(3);
  });

  it('any 前置只需一条强化路线满足', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');

    expect(progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind').ok).toBe(true);
  });

  it('同一 choiceGroup 内两种形态互斥', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_form_execute');

    const conflict = progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind');
    expect(conflict.reason).toBe(AllocationReject.EXCLUSIVE);
    expect(conflict.conflictId).toBe('cleave_form_execute');
  });

  it('撤销形态后可改选另一形态', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_form_execute');

    expect(progression.deallocateNode('hero', 'warrior-skill', 'cleave_form_execute').ok).toBe(true);
    expect(progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind').ok).toBe(true);
  });
});

describe('分支效果作用于技能运行期', () => {
  let progression;
  let ability;
  let caster;

  beforeEach(() => {
    progression = new ProgressionGraphSystem();
    progression.registerGraph(makeBranchGraph());
    progression.grantPoints('hero', PointPool.SKILL, 20);

    const registry = new SkillRegistry();
    registry.register(makeCleaveDefinition());

    ability = new AbilitySystem({
      skillRegistry: registry,
      effectResolver: progression.effectResolver,
      now: () => 0,
      executor: () => true
    });
    caster = makeCaster('hero');

    progression.allocateNode('hero', 'warrior-skill', 'cleave');
  });

  it('解锁节点使技能可释放', () => {
    expect(ability.isUnlocked(caster, 'cleave')).toBe(true);
    expect(ability.getAvailableSkills(caster).map(s => s.id)).toEqual(['cleave']);
  });

  it('强化节点按等级提升伤害', () => {
    expect(ability.resolveSkillParams(caster, 'cleave').damage).toBe(30);

    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    expect(ability.resolveSkillParams(caster, 'cleave').damage).toBeCloseTo(33, 5);

    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    expect(ability.resolveSkillParams(caster, 'cleave').damage).toBeCloseTo(36, 5);
  });

  it('冷却强化按等级递减', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    expect(ability.resolveSkillParams(caster, 'cleave').cooldown).toBe(3);
  });

  it('形态节点改变技能目标方式与参数', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind');

    expect(ability.resolveSkillVariant(caster, 'cleave')).toBe('whirlwind');

    const view = ability.resolveSkillView(caster, 'cleave');
    expect(view.name).toBe('旋风斩');
    expect(view.targeting).toBe('area');
    expect(view.params.radius).toBe(120);
  });

  it('形态与强化叠加：形态为基线，强化在其上生效', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind');

    // 旋风斩基线 20，强化 +10%，冷却基线 6 减 0.5
    expect(ability.resolveSkillParams(caster, 'cleave').damage).toBeCloseTo(22, 5);
    expect(ability.resolveSkillParams(caster, 'cleave').cooldown).toBe(5.5);
  });

  it('斩杀形态改为单体，超距时被拒绝', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_form_execute');

    const view = ability.resolveSkillView(caster, 'cleave');
    expect(view.targeting).toBe('entity');

    const far = { id: 't', getComponent: () => ({ position: { x: 300, y: 0 } }) };
    expect(ability.canUse(caster, 'cleave', { target: far }).reason).toBe('outOfRange');
  });

  it('释放时把形态信息传给执行器', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind');

    let received = null;
    ability.setExecutor((ctx) => { received = ctx; return true; });

    const result = ability.use(caster, 'cleave', { targetPosition: { x: 40, y: 0 }, currentTime: 0 });
    expect(result.ok).toBe(true);
    expect(received.variantId).toBe('whirlwind');
    expect(received.view.name).toBe('旋风斩');
    expect(received.view.vfx.effect).toBe('whirlwind');
  });

  it('重置技能树后形态与强化同时失效', () => {
    progression.allocateNode('hero', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('hero', 'warrior-skill', 'cleave_form_whirlwind');
    expect(ability.resolveSkillVariant(caster, 'cleave')).toBe('whirlwind');

    progression.resetGraph('hero', 'warrior-skill');
    expect(ability.resolveSkillVariant(caster, 'cleave')).toBeNull();
    expect(ability.isUnlocked(caster, 'cleave')).toBe(false);
  });

  it('不同角色的形态选择互不影响', () => {
    progression.grantPoints('other', PointPool.SKILL, 20);
    progression.allocateNode('other', 'warrior-skill', 'cleave');
    progression.allocateNode('other', 'warrior-skill', 'cleave_damage');
    progression.allocateNode('other', 'warrior-skill', 'cleave_cooldown');
    progression.allocateNode('other', 'warrior-skill', 'cleave_form_execute');

    expect(ability.resolveSkillVariant(makeCaster('other'), 'cleave')).toBe('execute');
    expect(ability.resolveSkillVariant(caster, 'cleave')).toBeNull();
  });
});

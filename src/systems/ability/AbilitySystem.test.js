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
import { AbilitySystem, AbilityRejectReason } from './AbilitySystem.js';
import { SkillRegistry } from './SkillRegistry.js';
import { SkillDefinition, SkillTargeting, SkillCategory } from './SkillDefinition.js';
import { EffectResolver } from '../effects/EffectResolver.js';
import { EffectSource, EffectSourceKind } from '../effects/EffectSource.js';
import { EffectType } from '../effects/EffectTypes.js';

/** 构造最小可用的施法者实体 */
function makeCaster(id = 'p1', overrides = {}) {
  const components = {
    transform: { position: { x: 0, y: 0 } },
    stats: { mp: 100, stamina: 100 },
    combat: {
      skills: [],
      skillCooldowns: new Map(),
      isCasting: false,
      castingSkill: null,
      castStartTime: 0,
      completeCast() {
        this.isCasting = false;
        const s = this.castingSkill;
        this.castingSkill = null;
        this.castStartTime = 0;
        return s;
      }
    },
    ...overrides
  };
  return {
    id,
    type: 'player',
    getComponent: (name) => components[name] || null,
    components
  };
}

function makeTarget(x = 50, y = 0) {
  const components = { transform: { position: { x, y } } };
  return { id: 't1', getComponent: (n) => components[n] || null };
}

describe('SkillDefinition 与 SkillRegistry', () => {
  it('缺少 id 的定义校验失败', () => {
    const def = new SkillDefinition({ name: '无名' });
    const result = def.validate();
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('id');
  });

  it('非法 targeting 报告取值约束', () => {
    const def = new SkillDefinition({ id: 'x', targeting: 'weird' });
    const result = def.validate();
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.path === 'targeting')).toBe(true);
  });

  it('注册表拒绝非法定义且不写入', () => {
    const registry = new SkillRegistry();
    const result = registry.register({ name: '无 id' });
    expect(result.ok).toBe(false);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('旧版技能对象可升格为定义', () => {
    const def = SkillDefinition.fromLegacy({
      id: 'fireball', name: '火球', damage: 30, range: 300, cooldown: 5, manaCost: 20, type: 'attack'
    });
    expect(def.params.damage).toBe(30);
    expect(def.params.range).toBe(300);
    expect(def.costs.mp).toBe(20);
    expect(def.targeting).toBe(SkillTargeting.ENTITY);
  });

  it('序列化后可再次解析且字段等价', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 'a', name: 'A', params: { damage: 10, cooldown: 3 }, costs: { mp: 5 } });
    const json = registry.toJSON();

    const restored = new SkillRegistry();
    restored.registerAll(json);
    expect(restored.toJSON()).toEqual(json);
  });
});

describe('AbilitySystem 准入判定', () => {
  let registry;
  let resolver;
  let ability;
  let caster;
  let executed;

  beforeEach(() => {
    registry = new SkillRegistry();
    registry.register({
      id: 'fireball',
      name: '火球',
      category: SkillCategory.ATTACK,
      targeting: SkillTargeting.ENTITY,
      params: { damage: 30, range: 100, cooldown: 5 },
      costs: { mp: 20 }
    });

    resolver = new EffectResolver();
    executed = [];
    ability = new AbilitySystem({
      skillRegistry: registry,
      effectResolver: resolver,
      now: () => 10000,
      executor: (ctx) => {
        executed.push(ctx);
        return true;
      }
    });
    caster = makeCaster();
  });

  it('未解锁技能被拒绝', () => {
    const result = ability.canUse(caster, 'fireball', { target: makeTarget() });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(AbilityRejectReason.NOT_UNLOCKED);
  });

  it('技能定义不存在时报告原因', () => {
    const result = ability.canUse(caster, 'unknown');
    expect(result.reason).toBe(AbilityRejectReason.NO_DEFINITION);
  });

  it('解锁后可释放并扣除消耗与进入冷却', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'skill_tree',
      kind: EffectSourceKind.SKILL,
      effects: [{ type: EffectType.SKILL_UNLOCK, target: 'fireball', value: true }]
    }));

    const result = ability.use(caster, 'fireball', { target: makeTarget(50, 0), currentTime: 10000 });
    expect(result.ok).toBe(true);
    expect(caster.components.stats.mp).toBe(80);
    expect(caster.components.combat.skillCooldowns.get('fireball')).toBe(10000);
    expect(executed).toHaveLength(1);
    expect(executed[0].params.damage).toBe(30);
  });

  it('冷却期间拒绝再次释放', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'skill_tree',
      effects: [{ type: EffectType.SKILL_UNLOCK, target: 'fireball', value: true }]
    }));

    ability.use(caster, 'fireball', { target: makeTarget(), currentTime: 10000 });
    const second = ability.canUse(caster, 'fireball', { target: makeTarget(), currentTime: 12000 });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe(AbilityRejectReason.ON_COOLDOWN);
  });

  it('法力不足时拒绝且不扣资源', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'skill_tree',
      effects: [{ type: EffectType.SKILL_UNLOCK, target: 'fireball', value: true }]
    }));
    caster.components.stats.mp = 5;

    const result = ability.use(caster, 'fireball', { target: makeTarget(), currentTime: 10000 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(AbilityRejectReason.INSUFFICIENT_COST);
    expect(caster.components.stats.mp).toBe(5);
    expect(caster.components.combat.skillCooldowns.has('fireball')).toBe(false);
  });

  it('超出射程时拒绝', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'skill_tree',
      effects: [{ type: EffectType.SKILL_UNLOCK, target: 'fireball', value: true }]
    }));

    const result = ability.canUse(caster, 'fireball', { target: makeTarget(500, 0) });
    expect(result.reason).toBe(AbilityRejectReason.OUT_OF_RANGE);
  });

  it('执行器失败时回滚消耗与冷却', () => {
    resolver.addSource('p1', new EffectSource({
      id: 'skill_tree',
      effects: [{ type: EffectType.SKILL_UNLOCK, target: 'fireball', value: true }]
    }));
    ability.setExecutor(() => false);

    const result = ability.use(caster, 'fireball', { target: makeTarget(), currentTime: 10000 });
    expect(result.ok).toBe(false);
    expect(caster.components.stats.mp).toBe(100);
    expect(caster.components.combat.skillCooldowns.has('fireball')).toBe(false);
  });
});

describe('AbilitySystem 与效果系统联动', () => {
  it('skill.modify 效果提升技能参数', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'fireball',
      targeting: SkillTargeting.ENTITY,
      params: { damage: 30, range: 100, cooldown: 5 },
      costs: { mp: 20 }
    });

    const resolver = new EffectResolver();
    resolver.addSource('p1', new EffectSource({
      id: 'talent_fire',
      kind: EffectSourceKind.TALENT,
      effects: [
        { type: EffectType.SKILL_UNLOCK, target: 'fireball', value: true },
        { type: EffectType.SKILL_MODIFY, target: 'skill.fireball.damage', operation: 'addPercent', value: 0.5 },
        { type: EffectType.SKILL_MODIFY, target: 'skill.fireball.cooldown', operation: 'add', value: -2 },
        { type: EffectType.SKILL_MODIFY, target: 'skill.fireball.cost.mp', operation: 'add', value: -5 }
      ]
    }));

    const ability = new AbilitySystem({ skillRegistry: registry, effectResolver: resolver, now: () => 0 });
    const caster = makeCaster();

    const params = ability.resolveSkillParams(caster, 'fireball');
    expect(params.damage).toBe(45);
    expect(params.cooldown).toBe(3);

    const costs = ability.resolveSkillCosts(caster, 'fireball');
    expect(costs.mp).toBe(15);
  });

  it('getAvailableSkills 只返回已解锁技能', () => {
    const registry = new SkillRegistry();
    registry.registerAll([
      { id: 'a', targeting: SkillTargeting.SELF },
      { id: 'b', targeting: SkillTargeting.SELF }
    ]);

    const resolver = new EffectResolver();
    resolver.addSource('p1', new EffectSource({
      id: 'tree',
      effects: [{ type: EffectType.SKILL_UNLOCK, target: 'b', value: true }]
    }));

    const ability = new AbilitySystem({ skillRegistry: registry, effectResolver: resolver });
    const skills = ability.getAvailableSkills(makeCaster());
    expect(skills.map(s => s.id)).toEqual(['b']);
  });

  it('施法完成后清除施法状态', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 'cast', targeting: SkillTargeting.SELF, params: { castTime: 500 } });

    let now = 0;
    const ability = new AbilitySystem({
      skillRegistry: registry,
      now: () => now,
      requireUnlock: false,
      executor: () => true
    });
    const caster = makeCaster();

    ability.use(caster, 'cast', { currentTime: 0 });
    expect(caster.components.combat.isCasting).toBe(true);

    now = 600;
    ability.update(0.6, [caster]);
    expect(caster.components.combat.isCasting).toBe(false);
  });
});

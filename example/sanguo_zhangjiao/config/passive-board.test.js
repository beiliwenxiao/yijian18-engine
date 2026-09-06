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

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GraphDefinition, GraphMode, PointPool } from '../../../src/systems/progression/GraphDefinition.js';
import { NodeKind } from '../../../src/systems/progression/NodeDefinition.js';
import { ProgressionGraphSystem } from '../../../src/systems/progression/ProgressionGraphSystem.js';
import { AllocationReject } from '../../../src/systems/progression/AllocationRules.js';
import { SkillRegistry } from '../../../src/systems/ability/SkillRegistry.js';
import { AbilitySystem } from '../../../src/systems/ability/AbilitySystem.js';

const configDir = dirname(fileURLToPath(import.meta.url));
const boardConfig = JSON.parse(readFileSync(join(configDir, 'progression-passive-board.json'), 'utf-8'));
const skillsConfig = JSON.parse(readFileSync(join(configDir, 'skills.json'), 'utf-8'));

/** 沿路径依次分配，返回最后一次结果 */
function allocatePath(system, characterId, graphId, path, context = {}) {
  let last = null;
  for (const nodeId of path) {
    last = system.allocateNode(characterId, graphId, nodeId, context);
    if (!last.ok) return last;
  }
  return last;
}

describe('天赋盘配置结构', () => {
  it('图定义通过校验', () => {
    const graph = new GraphDefinition(boardConfig);
    const result = graph.validate();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('节点总数为首版约定的 45', () => {
    expect(new GraphDefinition(boardConfig).size).toBe(45);
  });

  it('节点类型分布符合决策 12', () => {
    const graph = new GraphDefinition(boardConfig);
    const count = (kind) => graph.getNodesByKind(kind).length;

    expect(count(NodeKind.START)).toBe(3);
    expect(count(NodeKind.NOTABLE)).toBe(9);
    expect(count(NodeKind.MASTERY)).toBe(4);
    expect(count(NodeKind.KEYSTONE)).toBe(3);
    expect(count(NodeKind.SOCKET)).toBe(2);
    expect(count(NodeKind.MINOR)).toBe(24);
  });

  it('模式为天赋盘且要求路径连通', () => {
    const graph = new GraphDefinition(boardConfig);
    expect(graph.mode).toBe(GraphMode.PASSIVE_BOARD);
    expect(graph.pointPool).toBe(PointPool.PASSIVE);
    expect(graph.rules.requireConnected).toBe(true);
  });

  it('三个职业起点各自连接到本区域节点', () => {
    const graph = new GraphDefinition(boardConfig);
    for (const start of ['start_warrior', 'start_archer', 'start_strategist']) {
      expect(graph.getNeighbors(start).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('全部节点从任一起点可达', () => {
    const graph = new GraphDefinition(boardConfig);
    const visited = new Set(graph.startNodes);
    const queue = [...graph.startNodes];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of graph.getNeighbors(current)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    const unreachable = graph.getAllNodes().map(n => n.id).filter(id => !visited.has(id));
    expect(unreachable).toEqual([]);
  });

  it('核心天赋均带明确取舍', () => {
    const graph = new GraphDefinition(boardConfig);
    for (const node of graph.getNodesByKind(NodeKind.KEYSTONE)) {
      const negative = node.effects.some(e =>
        (typeof e.value === 'number' && e.value < 0) ||
        (e.type === 'rule.override' && e.value === true) ||
        (e.operation === 'multiply' && typeof e.value === 'number' && e.value > 1)
      );
      expect(negative, `核心天赋 ${node.id} 缺少取舍`).toBe(true);
    }
  });

  it('技能相关效果引用的技能都有定义', () => {
    const registry = new SkillRegistry();
    registry.registerAll(skillsConfig.skills);

    const graph = new GraphDefinition(boardConfig);
    for (const node of graph.getAllNodes()) {
      for (const effect of node.effects) {
        const match = /^skill\.([^.]+)\./.exec(effect.target || '');
        if (!match) continue;
        expect(registry.has(match[1]), `未定义技能: ${match[1]}`).toBe(true);
      }
    }
  });

  it('起点不消耗点数', () => {
    const graph = new GraphDefinition(boardConfig);
    for (const id of graph.startNodes) {
      expect(graph.getNode(id).costs[PointPool.PASSIVE]).toBe(0);
    }
  });
});

describe('天赋盘路径构筑', () => {
  let system;

  beforeEach(() => {
    system = new ProgressionGraphSystem();
    expect(system.registerGraph(boardConfig).ok).toBe(true);
    system.grantPoints('hero', PointPool.PASSIVE, 60);
  });

  it('起点相邻节点可直接分配', () => {
    expect(system.allocateNode('hero', 'global-passive', 'inf_hp_1').ok).toBe(true);
  });

  it('远离已分配路径的节点被拒绝', () => {
    const result = system.allocateNode('hero', 'global-passive', 'inf_notable_wall');
    expect(result.reason).toBe(AllocationReject.NOT_CONNECTED);
  });

  it('必须沿路径逐步推进到重要节点', () => {
    const result = allocatePath(system, 'hero', 'global-passive', [
      'inf_def_1', 'inf_block', 'inf_notable_wall'
    ]);
    expect(result.ok).toBe(true);

    // getSpentPoints 统计已分配的节点等级数
    expect(system.getSpentPoints('hero', 'global-passive')).toBe(3);
    // 重要节点单级消耗 2 点，因此实际扣点为 1 + 1 + 2
    expect(system.getLedger('hero').getAvailable(PointPool.PASSIVE)).toBe(56);
  });

  it('核心天赋需要累计投入达到门槛', () => {
    const reach = allocatePath(system, 'hero', 'global-passive', [
      'life_gather_speed', 'life_yield', 'life_mastery', 'core_bridge_south'
    ]);
    expect(reach.ok).toBe(true);

    const early = system.allocateNode('hero', 'global-passive', 'key_reckless_gather');
    expect(early.reason).toBe(AllocationReject.GATE_REGION);
    expect(early.required).toBe(12);
  });

  it('跨职业路线需要更多过路点', () => {
    // 战士起点走到东路桥需要绕行位移区，成本明显高于本区域节点
    const spentBefore = system.getSpentPoints('hero', 'global-passive');
    const result = allocatePath(system, 'hero', 'global-passive', [
      'inf_stamina_1', 'core_bridge_west'
    ]);
    expect(result.ok).toBe(true);
    expect(system.getSpentPoints('hero', 'global-passive') - spentBefore).toBe(2);

    // 直接跳到弓手区域仍被连通性拒绝
    expect(system.allocateNode('hero', 'global-passive', 'rng_notable_volley').reason)
      .toBe(AllocationReject.NOT_CONNECTED);
  });

  it('撤销中间过路点会造成孤立时被拒绝', () => {
    allocatePath(system, 'hero', 'global-passive', ['inf_def_1', 'inf_block']);
    const result = system.deallocateNode('hero', 'global-passive', 'inf_def_1');
    expect(result.reason).toBe(AllocationReject.WOULD_ORPHAN);
  });

  it('从末端向内撤销可正常进行', () => {
    allocatePath(system, 'hero', 'global-passive', ['inf_def_1', 'inf_block']);
    expect(system.deallocateNode('hero', 'global-passive', 'inf_block').ok).toBe(true);
    expect(system.deallocateNode('hero', 'global-passive', 'inf_def_1').ok).toBe(true);
    expect(system.getSpentPoints('hero', 'global-passive')).toBe(0);
  });

  it('三个起点各自可独立发展', () => {
    expect(system.allocateNode('hero', 'global-passive', 'inf_hp_1').ok).toBe(true);
    expect(system.allocateNode('hero', 'global-passive', 'rng_crit_1').ok).toBe(true);
    expect(system.allocateNode('hero', 'global-passive', 'life_capacity').ok).toBe(true);
  });
});

describe('天赋盘效果结算', () => {
  let system;

  beforeEach(() => {
    system = new ProgressionGraphSystem();
    system.registerGraph(boardConfig);
    system.grantPoints('hero', PointPool.PASSIVE, 60);
  });

  it('小点按等级累计属性', () => {
    system.allocateNode('hero', 'global-passive', 'inf_hp_1');
    expect(system.effectResolver.getValue('hero', 'maxHp', 100)).toBe(120);

    system.allocateNode('hero', 'global-passive', 'inf_hp_1');
    expect(system.effectResolver.getValue('hero', 'maxHp', 100)).toBe(140);
  });

  it('重要节点同时提供加法与百分比效果', () => {
    allocatePath(system, 'hero', 'global-passive', ['inf_def_1', 'inf_block', 'inf_notable_wall']);
    expect(system.effectResolver.getValue('hero', 'damageReduction', 0)).toBeCloseTo(0.08, 5);
    expect(system.effectResolver.getValue('hero', 'maxHp', 100)).toBeCloseTo(105, 5);
  });

  it('采集类效果作用于采集时长', () => {
    system.allocateNode('hero', 'global-passive', 'life_gather_speed');
    system.allocateNode('hero', 'global-passive', 'life_gather_speed');
    expect(system.effectResolver.getValue('hero', 'gather.duration', 10)).toBeCloseTo(9, 5);
  });

  it('核心天赋 稳手 生效后禁止暴击并提高命中伤害', () => {
    // 从战士起点绕行到中心，累计等级需达到 12 才能进入核心天赋
    const reach = allocatePath(system, 'hero', 'global-passive', [
      'inf_def_1', 'inf_block', 'inf_mastery', 'inf_socket',
      'inf_hp_1', 'inf_stamina_1', 'inf_charge_resist', 'inf_notable_formation',
      'core_bridge_west', 'core_notable_veteran', 'core_hp', 'core_attack'
    ]);
    expect(reach.ok).toBe(true);
    expect(system.getSpentPoints('hero', 'global-passive')).toBe(12);

    const keystone = system.allocateNode('hero', 'global-passive', 'key_no_crit');
    expect(keystone.ok).toBe(true);

    expect(system.effectResolver.hasRuleOverride('hero', 'combat.cannotCrit')).toBe(true);
    expect(system.effectResolver.getValue('hero', 'hitDamage', 100)).toBeCloseTo(125, 5);
  });

  it('累计等级不足 12 时核心天赋被门槛拒绝', () => {
    allocatePath(system, 'hero', 'global-passive', [
      'inf_stamina_1', 'core_bridge_west', 'core_notable_veteran', 'core_hp', 'core_attack'
    ]);
    const result = system.allocateNode('hero', 'global-passive', 'key_no_crit');
    expect(result.reason).toBe(AllocationReject.GATE_REGION);
    expect(result.required).toBe(12);
  });

  it('核心天赋 竭泽 同时改善与恶化两项数值', () => {
    allocatePath(system, 'hero', 'global-passive', [
      'life_gather_speed', 'life_gather_speed', 'life_gather_speed',
      'life_yield', 'life_yield', 'life_capacity', 'life_capacity', 'life_capacity',
      'life_tool_durability', 'life_tool_durability',
      'life_mastery', 'core_bridge_south'
    ]);

    const result = system.allocateNode('hero', 'global-passive', 'key_reckless_gather');
    expect(result.ok).toBe(true);

    // 采集更快，但警戒范围翻倍
    expect(system.effectResolver.getValue('hero', 'gather.alertRadius', 100)).toBeCloseTo(200, 5);
    expect(system.effectResolver.getValue('hero', 'gather.duration', 10)).toBeLessThan(5);
  });

  it('位移小点作用于轻功运行期参数', () => {
    allocatePath(system, 'hero', 'global-passive', [
      'life_capacity', 'life_construction', 'life_notable_engineer',
      'loco_climb', 'loco_range'
    ]);

    const registry = new SkillRegistry();
    registry.registerAll(skillsConfig.skills);
    const ability = new AbilitySystem({
      skillRegistry: registry,
      effectResolver: system.effectResolver,
      requireUnlock: false,
      now: () => 0
    });
    const caster = { id: 'hero', getComponent: () => null };

    // 轻功基线射程 400，+8%
    expect(ability.resolveSkillParams(caster, 'flight').range).toBeCloseTo(432, 5);
  });

  it('重置天赋盘后全部效果清空', () => {
    allocatePath(system, 'hero', 'global-passive', ['inf_def_1', 'inf_block']);
    expect(system.effectResolver.getValue('hero', 'blockChance', 0)).toBeGreaterThan(0);

    system.resetGraph('hero', 'global-passive');
    expect(system.effectResolver.getValue('hero', 'blockChance', 0)).toBe(0);
    expect(system.getLedger('hero').getAvailable(PointPool.PASSIVE)).toBe(60);
  });

  it('天赋盘与技能树使用独立点数池', () => {
    system.grantPoints('hero', PointPool.SKILL, 5);
    system.allocateNode('hero', 'global-passive', 'inf_hp_1');

    expect(system.getLedger('hero').getAvailable(PointPool.SKILL)).toBe(5);
    expect(system.getLedger('hero').getAvailable(PointPool.PASSIVE)).toBe(59);
  });
});

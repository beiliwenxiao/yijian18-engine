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
import { ProgressionGraphSystem } from './ProgressionGraphSystem.js';
import { GraphDefinition, GraphMode, PointPool } from './GraphDefinition.js';
import { NodeKind } from './NodeDefinition.js';
import { PointLedger } from './PointLedger.js';
import { AllocationReject } from './AllocationRules.js';
import { EffectType } from '../effects/EffectTypes.js';

/** 简单职业天赋树：根节点 + 两个互斥分支 */
function makeTalentGraph() {
  return {
    id: 'warrior-talent',
    mode: GraphMode.CLASS_TALENT,
    version: 1,
    nodes: [
      {
        id: 'root',
        name: '基础',
        maxRank: 3,
        effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 2 }]
      },
      {
        id: 'heavy',
        name: '重甲',
        prerequisites: ['root'],
        choiceGroup: 'spec',
        effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'defense', operation: 'add', value: 5 }]
      },
      {
        id: 'berserk',
        name: '狂战',
        prerequisites: ['root'],
        choiceGroup: 'spec',
        effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'attack', operation: 'add', value: 8 }]
      },
      {
        id: 'ultimate',
        name: '终极',
        prerequisites: { mode: 'any', nodes: ['heavy', 'berserk'] },
        gates: { characterLevel: 10 },
        effects: [{ type: EffectType.RULE_OVERRIDE, target: 'controlImmunity', value: true }]
      }
    ]
  };
}

/** 小型天赋盘：起点 → a → b，另有孤立点 c */
function makePassiveBoard() {
  return {
    id: 'board',
    mode: GraphMode.PASSIVE_BOARD,
    version: 1,
    startNodes: ['start'],
    nodes: [
      { id: 'start', kind: NodeKind.START, maxRank: 1 },
      { id: 'a', kind: NodeKind.MINOR, effects: [{ type: EffectType.ATTRIBUTE_MODIFY, target: 'maxHp', operation: 'add', value: 10 }] },
      { id: 'b', kind: NodeKind.NOTABLE, effects: [{ type: EffectType.GATHER_MODIFY, target: 'gather.duration', operation: 'addPercent', value: -0.1 }] },
      { id: 'c', kind: NodeKind.MINOR }
    ],
    edges: [['start', 'a'], ['a', 'b']]
  };
}

describe('GraphDefinition 校验', () => {
  it('前置引用不存在时报告字段路径', () => {
    const graph = new GraphDefinition({
      id: 'g', nodes: [{ id: 'a', prerequisites: ['missing'] }]
    });
    const result = graph.validate();
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toContain('prerequisites');
  });

  it('前置关系存在环时校验失败', () => {
    const graph = new GraphDefinition({
      id: 'g',
      nodes: [
        { id: 'a', prerequisites: ['b'] },
        { id: 'b', prerequisites: ['a'] }
      ]
    });
    expect(graph.validate().ok).toBe(false);
  });

  it('天赋盘缺少起点时校验失败', () => {
    const graph = new GraphDefinition({
      id: 'g', mode: GraphMode.PASSIVE_BOARD, nodes: [{ id: 'a' }]
    });
    expect(graph.validate().ok).toBe(false);
  });

  it('序列化后可再次解析且字段等价', () => {
    const graph = new GraphDefinition(makeTalentGraph());
    const json = graph.toJSON();
    expect(new GraphDefinition(json).toJSON()).toEqual(json);
  });

  it('默认点数池按模式确定', () => {
    expect(new GraphDefinition({ id: 'g', mode: GraphMode.UNIT_TALENT, nodes: [{ id: 'a' }] }).pointPool)
      .toBe(PointPool.UNIT);
  });
});

describe('ProgressionGraphSystem 分配规则', () => {
  let system;

  beforeEach(() => {
    system = new ProgressionGraphSystem();
    system.registerGraph(makeTalentGraph());
    system.grantPoints('hero', PointPool.TALENT, 10);
  });

  it('校验失败的图不会被注册', () => {
    const result = system.registerGraph({ id: 'bad', nodes: [{ id: 'x', maxRank: 0 }] });
    expect(result.ok).toBe(false);
    expect(system.getGraph('bad')).toBeNull();
  });

  it('前置未满足时拒绝分配且不扣点', () => {
    const result = system.allocateNode('hero', 'warrior-talent', 'heavy');
    expect(result.reason).toBe(AllocationReject.PREREQUISITE);
    expect(system.getLedger('hero').getAvailable(PointPool.TALENT)).toBe(10);
  });

  it('满足前置后可逐级分配', () => {
    expect(system.allocateNode('hero', 'warrior-talent', 'root').rank).toBe(1);
    expect(system.allocateNode('hero', 'warrior-talent', 'root').rank).toBe(2);
    expect(system.getSpentPoints('hero', 'warrior-talent')).toBe(2);
    expect(system.getLedger('hero').getAvailable(PointPool.TALENT)).toBe(8);
  });

  it('达到最大等级后拒绝继续分配', () => {
    for (let i = 0; i < 3; i++) system.allocateNode('hero', 'warrior-talent', 'root');
    const result = system.allocateNode('hero', 'warrior-talent', 'root');
    expect(result.reason).toBe(AllocationReject.MAX_RANK);
  });

  it('互斥组内只能选择一个分支', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    expect(system.allocateNode('hero', 'warrior-talent', 'heavy').ok).toBe(true);

    const conflict = system.allocateNode('hero', 'warrior-talent', 'berserk');
    expect(conflict.reason).toBe(AllocationReject.EXCLUSIVE);
    expect(conflict.conflictId).toBe('heavy');
  });

  it('any 模式前置只需满足其一', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'berserk');
    const result = system.allocateNode('hero', 'warrior-talent', 'ultimate', { characterLevel: 10 });
    expect(result.ok).toBe(true);
  });

  it('等级门槛不足时拒绝', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'heavy');
    const result = system.allocateNode('hero', 'warrior-talent', 'ultimate', { characterLevel: 5 });
    expect(result.reason).toBe(AllocationReject.GATE_LEVEL);
    expect(result.required).toBe(10);
  });

  it('点数不足时拒绝并报告缺口', () => {
    const poor = new ProgressionGraphSystem();
    poor.registerGraph(makeTalentGraph());
    const result = poor.allocateNode('p', 'warrior-talent', 'root');
    expect(result.reason).toBe(AllocationReject.INSUFFICIENT_POINTS);
    expect(result.missing[PointPool.TALENT]).toBe(1);
  });

  it('撤销会返还点数', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'root');
    const result = system.deallocateNode('hero', 'warrior-talent', 'root');
    expect(result.rank).toBe(1);
    expect(system.getLedger('hero').getAvailable(PointPool.TALENT)).toBe(9);
  });

  it('撤销会使后续节点失去前置时被拒绝', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'heavy');

    const result = system.deallocateNode('hero', 'warrior-talent', 'root');
    expect(result.reason).toBe(AllocationReject.WOULD_ORPHAN);
    expect(result.orphanId).toBe('heavy');
    expect(system.getRank('hero', 'warrior-talent', 'root')).toBe(1);
  });

  it('重置整图返还全部点数', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'heavy');

    const result = system.resetGraph('hero', 'warrior-talent');
    expect(result.refunded[PointPool.TALENT]).toBe(3);
    expect(system.getLedger('hero').getAvailable(PointPool.TALENT)).toBe(10);
    expect(system.getSpentPoints('hero', 'warrior-talent')).toBe(0);
  });

  it('不同角色的分配互不影响', () => {
    system.grantPoints('other', PointPool.TALENT, 5);
    system.allocateNode('hero', 'warrior-talent', 'root');
    expect(system.getRank('other', 'warrior-talent', 'root')).toBe(0);
  });
});

describe('ProgressionGraphSystem 天赋盘连通性', () => {
  let system;

  beforeEach(() => {
    system = new ProgressionGraphSystem();
    system.registerGraph(makePassiveBoard());
    system.grantPoints('hero', PointPool.PASSIVE, 10);
  });

  it('未与已分配路径相连的节点被拒绝', () => {
    const result = system.allocateNode('hero', 'board', 'c');
    expect(result.reason).toBe(AllocationReject.NOT_CONNECTED);
  });

  it('起点相邻节点可直接分配', () => {
    expect(system.allocateNode('hero', 'board', 'a').ok).toBe(true);
  });

  it('必须先经过中间节点才能到达更远节点', () => {
    expect(system.allocateNode('hero', 'board', 'b').reason).toBe(AllocationReject.NOT_CONNECTED);
    system.allocateNode('hero', 'board', 'a');
    expect(system.allocateNode('hero', 'board', 'b').ok).toBe(true);
  });

  it('撤销中间节点会导致孤立时被拒绝', () => {
    system.allocateNode('hero', 'board', 'a');
    system.allocateNode('hero', 'board', 'b');
    const result = system.deallocateNode('hero', 'board', 'a');
    expect(result.reason).toBe(AllocationReject.WOULD_ORPHAN);
  });
});

describe('ProgressionGraphSystem 效果同步与存档', () => {
  let system;

  beforeEach(() => {
    system = new ProgressionGraphSystem();
    system.registerGraph(makeTalentGraph());
    system.registerGraph(makePassiveBoard());
    system.grantPoints('hero', PointPool.TALENT, 10);
    system.grantPoints('hero', PointPool.PASSIVE, 10);
  });

  it('分配后效果进入统一结算器且按等级累计', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    expect(system.effectResolver.getValue('hero', 'attack', 10)).toBe(12);

    system.allocateNode('hero', 'warrior-talent', 'root');
    expect(system.effectResolver.getValue('hero', 'attack', 10)).toBe(14);
  });

  it('撤销后效果同步回退', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.deallocateNode('hero', 'warrior-talent', 'root');
    expect(system.effectResolver.getValue('hero', 'attack', 10)).toBe(10);
  });

  it('keystone 规则覆盖可被查询', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'heavy');
    system.allocateNode('hero', 'warrior-talent', 'ultimate', { characterLevel: 10 });
    expect(system.effectResolver.hasRuleOverride('hero', 'controlImmunity')).toBe(true);
  });

  it('多张图的效果在同一结算器中叠加', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'board', 'a');

    const detail = system.effectResolver.explain('hero', 'attack', 10);
    expect(detail.finalValue).toBe(12);
    expect(system.effectResolver.getValue('hero', 'maxHp', 100)).toBe(110);
  });

  it('存档往返后分配、点数与效果一致', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    system.allocateNode('hero', 'warrior-talent', 'heavy');
    const saved = system.serializeCharacter('hero');

    const restored = new ProgressionGraphSystem();
    restored.registerGraph(makeTalentGraph());
    restored.registerGraph(makePassiveBoard());
    const result = restored.deserializeCharacter('hero', saved);

    expect(result.ok).toBe(true);
    expect(restored.getRank('hero', 'warrior-talent', 'heavy')).toBe(1);
    expect(restored.getLedger('hero').getAvailable(PointPool.TALENT)).toBe(8);
    expect(restored.effectResolver.getValue('hero', 'defense', 5)).toBe(10);
    expect(restored.serializeCharacter('hero')).toEqual(saved);
  });

  it('存档版本与当前图不一致时拒绝恢复', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    const saved = system.serializeCharacter('hero');

    const upgraded = new ProgressionGraphSystem();
    upgraded.registerGraph({ ...makeTalentGraph(), version: 2 });
    const result = upgraded.deserializeCharacter('hero', saved);

    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('versionMismatch');
    expect(upgraded.getRank('hero', 'warrior-talent', 'root')).toBe(0);
  });

  it('禁用某图时其存档状态保留', () => {
    system.allocateNode('hero', 'board', 'a');
    const saved = system.serializeCharacter('hero');
    expect(saved.state.graphs.board.allocations.a).toBe(1);
  });

  it('视图模型包含等级与可分配标记', () => {
    system.allocateNode('hero', 'warrior-talent', 'root');
    const vm = system.getViewModel('hero', 'warrior-talent', { characterLevel: 1 });

    const root = vm.nodes.find(n => n.id === 'root');
    const ultimate = vm.nodes.find(n => n.id === 'ultimate');
    expect(root.rank).toBe(1);
    expect(root.allocated).toBe(true);
    expect(ultimate.canAllocate).toBe(false);
    expect(vm.availablePoints).toBe(9);
  });
});

describe('PointLedger 点数池', () => {
  it('独立池互不影响', () => {
    const ledger = new PointLedger({ pools: { skill: 3, talent: 2 } });
    expect(ledger.spend({ skill: 3 })).toBe(true);
    expect(ledger.getAvailable('talent')).toBe(2);
    expect(ledger.spend({ skill: 1 })).toBe(false);
  });

  it('别名可实现共享池', () => {
    const ledger = new PointLedger({
      pools: { growth: 5 },
      aliases: { talent: 'growth', passive: 'growth' }
    });
    expect(ledger.spend({ talent: 3 })).toBe(true);
    expect(ledger.getAvailable('passive')).toBe(2);
  });

  it('共享池下合并判定避免超支', () => {
    const ledger = new PointLedger({
      pools: { growth: 2 },
      aliases: { talent: 'growth', passive: 'growth' }
    });
    expect(ledger.canAfford({ talent: 2, passive: 1 }).ok).toBe(false);
  });

  it('不足时不做任何修改', () => {
    const ledger = new PointLedger({ pools: { skill: 1 } });
    expect(ledger.spend({ skill: 5 })).toBe(false);
    expect(ledger.getAvailable('skill')).toBe(1);
    expect(ledger.getSpent('skill')).toBe(0);
  });
});

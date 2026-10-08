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
import {
  ProgressionProfile,
  ProgressionKind,
  PROGRESSION_PRESETS,
  DEFAULT_PROFILE_NAME
} from './ProgressionProfile.js';
import { ProgressionGraphSystem } from './ProgressionGraphSystem.js';
import { GraphMode, PointPool } from './GraphDefinition.js';
import { AllocationReject } from './AllocationRules.js';

function makeGraph(id, mode) {
  return {
    id,
    mode,
    version: 1,
    startNodes: mode === GraphMode.PASSIVE_BOARD ? ['s'] : [],
    nodes: mode === GraphMode.PASSIVE_BOARD
      ? [
        { id: 's', kind: 'start', costs: { passive: 0 } },
        { id: 'n', kind: 'minor', effects: [{ type: 'attribute.modify', target: 'maxHp', operation: 'add', value: 10 }] }
      ]
      : [{ id: 'n', effects: [{ type: 'attribute.modify', target: 'attack', operation: 'add', value: 5 }] }],
    edges: mode === GraphMode.PASSIVE_BOARD ? [['s', 'n']] : []
  };
}

describe('ProgressionProfile 预设与默认值', () => {
  it('默认使用 arpg 预设', () => {
    const profile = new ProgressionProfile();
    expect(profile.profileName).toBe(DEFAULT_PROFILE_NAME);
    expect(profile.primary).toBe(ProgressionKind.TALENT_TREE);
    expect(profile.enabled).toHaveLength(4);
  });

  it('未知预设名回退到默认', () => {
    expect(new ProgressionProfile({ profile: 'unknown' }).profileName).toBe(DEFAULT_PROFILE_NAME);
  });

  it('四个内置预设均合法', () => {
    for (const name of Object.keys(PROGRESSION_PRESETS)) {
      const profile = new ProgressionProfile({ profile: name });
      expect(profile.validate().ok, `${name} 配置非法`).toBe(true);
    }
  });

  it('classicRpg 不启用天赋盘', () => {
    const profile = new ProgressionProfile({ profile: 'classicRpg' });
    expect(profile.isEnabled(ProgressionKind.PASSIVE_BOARD)).toBe(false);
    expect(profile.isEnabled(ProgressionKind.SKILL_TREE)).toBe(true);
  });

  it('poeLike 以天赋盘为主要成长', () => {
    const profile = new ProgressionProfile({ profile: 'poeLike' });
    expect(profile.isPrimary(ProgressionKind.PASSIVE_BOARD)).toBe(true);
  });

  it('显式配置覆盖预设', () => {
    const profile = new ProgressionProfile({
      profile: 'arpg',
      primary: ProgressionKind.SKILL_TREE,
      enabled: [ProgressionKind.SKILL_TREE, ProgressionKind.PASSIVE_BOARD]
    });
    expect(profile.primary).toBe(ProgressionKind.SKILL_TREE);
    expect(profile.enabled).toEqual([ProgressionKind.SKILL_TREE, ProgressionKind.PASSIVE_BOARD]);
  });

  it('主结构未启用时回退到启用列表首项', () => {
    const profile = new ProgressionProfile({
      primary: ProgressionKind.PASSIVE_BOARD,
      enabled: [ProgressionKind.SKILL_TREE]
    });
    expect(profile.primary).toBe(ProgressionKind.SKILL_TREE);
    expect(profile.validate().ok).toBe(true);
  });

  it('页签顺序把主结构排在最前', () => {
    const profile = new ProgressionProfile({ profile: 'arpg' });
    expect(profile.getTabOrder()[0]).toBe(ProgressionKind.TALENT_TREE);
    expect(profile.getTabOrder()).toHaveLength(4);
  });

  it('独立点数池不产生别名', () => {
    const profile = new ProgressionProfile({
      pointPools: { skill: 'independent', talent: 'independent' }
    });
    expect(profile.getPointAliases()).toEqual({});
  });

  it('共享点数池生成别名映射', () => {
    const profile = new ProgressionProfile({
      pointPools: { talent: 'growth', passive: 'growth' }
    });
    expect(profile.getPointAliases()).toEqual({ talent: 'growth', passive: 'growth' });
  });

  it('开放条件可查询', () => {
    const profile = new ProgressionProfile({
      unlock: { passiveBoard: 'milestone' }
    });
    expect(profile.getUnlockCondition(ProgressionKind.PASSIVE_BOARD)).toBe('milestone');
    expect(profile.getUnlockCondition(ProgressionKind.SKILL_TREE)).toBeNull();
  });

  it('enabled 为空时校验失败', () => {
    const profile = new ProgressionProfile({ enabled: ['notAKind'] });
    // 非法项被过滤后回退到预设，因此仍合法
    expect(profile.enabled.length).toBeGreaterThan(0);

    const empty = new ProgressionProfile();
    empty.enabled = [];
    expect(empty.validate().ok).toBe(false);
  });

  it('配置可序列化后再次解析', () => {
    const json = new ProgressionProfile({ profile: 'arpg' }).toJSON();
    expect(new ProgressionProfile(json).toJSON()).toEqual(json);
  });
});

describe('Profile 驱动 ProgressionGraphSystem', () => {
  let system;

  beforeEach(() => {
    system = new ProgressionGraphSystem({
      profile: { profile: 'classicRpg' }
    });
    system.registerGraph(makeGraph('w-skill', GraphMode.CLASS_SKILL));
    system.registerGraph(makeGraph('w-talent', GraphMode.CLASS_TALENT));
    system.registerGraph(makeGraph('board', GraphMode.PASSIVE_BOARD));
    system.grantPoints('hero', PointPool.SKILL, 5);
    system.grantPoints('hero', PointPool.PASSIVE, 5);
  });

  it('启用的图可正常分配', () => {
    expect(system.isGraphEnabled('w-skill')).toBe(true);
    expect(system.allocateNode('hero', 'w-skill', 'n').ok).toBe(true);
  });

  it('未启用的图拒绝分配', () => {
    expect(system.isGraphEnabled('board')).toBe(false);
    const result = system.allocateNode('hero', 'board', 'n');
    expect(result.reason).toBe(AllocationReject.GRAPH_DISABLED);
  });

  it('切换 Profile 后原禁用图变为可用', () => {
    system.setProfile({ profile: 'arpg' });
    expect(system.isGraphEnabled('board')).toBe(true);
    expect(system.allocateNode('hero', 'board', 'n').ok).toBe(true);
  });

  it('禁用图的已有分配状态不被删除', () => {
    system.setProfile({ profile: 'arpg' });
    system.allocateNode('hero', 'board', 'n');
    expect(system.getRank('hero', 'board', 'n')).toBe(1);

    system.setProfile({ profile: 'classicRpg' });
    // 禁用只影响新的分配入口，存档状态保留
    expect(system.getRank('hero', 'board', 'n')).toBe(1);
    expect(system.serializeCharacter('hero').state.graphs.board.allocations.n).toBe(1);
  });

  it('未设置 Profile 时全部图可用', () => {
    const open = new ProgressionGraphSystem();
    open.registerGraph(makeGraph('board', GraphMode.PASSIVE_BOARD));
    open.grantPoints('hero', PointPool.PASSIVE, 5);
    expect(open.isGraphEnabled('board')).toBe(true);
    expect(open.allocateNode('hero', 'board', 'n').ok).toBe(true);
  });

  it('共享点数池下不同图消耗同一池', () => {
    const shared = new ProgressionGraphSystem({
      profile: {
        profile: 'arpg',
        pointPools: { talent: 'growth', passive: 'growth' }
      }
    });
    shared.registerGraph(makeGraph('w-talent', GraphMode.CLASS_TALENT));
    shared.registerGraph(makeGraph('board', GraphMode.PASSIVE_BOARD));
    shared.grantPoints('hero', 'growth', 2);

    expect(shared.allocateNode('hero', 'w-talent', 'n').ok).toBe(true);
    expect(shared.getLedger('hero').getAvailable('growth')).toBe(1);

    expect(shared.allocateNode('hero', 'board', 'n').ok).toBe(true);
    expect(shared.getLedger('hero').getAvailable('growth')).toBe(0);

    // 池已耗尽：未达上限的新节点同样无法分配（共享池拦截）
    shared.registerGraph({
      id: 'w-talent-2', mode: GraphMode.CLASS_TALENT, version: 1, startNodes: [],
      nodes: [{ id: 'm', maxRank: 2, effects: [{ type: 'attribute.modify', target: 'attack', operation: 'add', value: 5 }] }],
      edges: []
    });
    expect(shared.allocateNode('hero', 'w-talent-2', 'm').reason)
      .toBe(AllocationReject.INSUFFICIENT_POINTS);
    // 已达上限的节点也无法继续分配（等级校验先于点数校验）
    expect(shared.allocateNode('hero', 'w-talent', 'n').reason)
      .toBe(AllocationReject.MAX_RANK);
  });
});

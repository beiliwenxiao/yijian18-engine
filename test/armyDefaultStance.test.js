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

import { describe, expect, it, vi } from 'vitest';
import SceneArmyCommandFlow from '../src/core/scene/SceneArmyCommandFlow.js';
import { SquadMemberComponent } from '../src/ecs/components/SquadMemberComponent.js';
import { CommandStateComponent } from '../src/ecs/components/CommandStateComponent.js';

/** 最小编组实体：仅需 squadMember/commandState/transform。 */
function makeSoldier(id, { armyId = 'army.s02.guard', squadId = 'qian' } = {}) {
  const components = new Map([
    ['transform', { position: { x: 0, y: 0 } }],
    ['squadMember', new SquadMemberComponent({ armyId, squadId })],
    ['commandState', new CommandStateComponent({ stance: 'escort' })]
  ]);
  return {
    id,
    isDead: false,
    getComponent: type => components.get(type) || null,
    addComponent: component => components.set(component.type, component)
  };
}

/** 构造只提供「实体仓库 + armies 注册表」的最小场景。 */
function makeScene(entities, armyDefinitions) {
  return {
    entityStore: { all: entities },
    gameLoader: {
      registries: {
        armies: { get: ref => armyDefinitions[ref] || null }
      }
    }
  };
}

/** 走一次编组同步（等价 flow.update 里的 _syncUnits 调用）。 */
function sync(flow) {
  flow._syncUnits();
}

describe('军团指挥：内容库 defaultStance → 战前预设', () => {
  it('内容库 defaultStance 套用到该军各分队预设', () => {
    const soldiers = [makeSoldier('u1', { squadId: 'qian' }), makeSoldier('u2', { squadId: 'hou' })];
    const flow = new SceneArmyCommandFlow(makeScene(soldiers, {
      'army.s02.guard': { id: 'army.s02.guard', defaultStance: 'hold' }
    }));
    sync(flow);
    expect(flow.system.getSquadPreset('qian')).toBe('hold');
    expect(flow.system.getSquadPreset('hou')).toBe('hold');
  });

  it('未配置 defaultStance 的军队保持跟随（escort）', () => {
    const soldiers = [makeSoldier('u1', { squadId: 'qian' })];
    const flow = new SceneArmyCommandFlow(makeScene(soldiers, {
      'army.s02.guard': { id: 'army.s02.guard' }
    }));
    sync(flow);
    expect(flow.system.getSquadPreset('qian')).toBe('escort');
  });

  it('玩家已在 HUD 改过预设时不被内容默认覆盖', () => {
    const soldiers = [makeSoldier('u1', { squadId: 'qian' })];
    const flow = new SceneArmyCommandFlow(makeScene(soldiers, {
      'army.s02.guard': { id: 'army.s02.guard', defaultStance: 'hold' }
    }));
    flow.system.setSquadPreset('qian', 'assault');
    sync(flow);
    expect(flow.system.getSquadPreset('qian')).toBe('assault');
  });

  it('非法 defaultStance 不套用并告警（不静默吞错）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const soldiers = [makeSoldier('u1', { squadId: 'qian' })];
    const flow = new SceneArmyCommandFlow(makeScene(soldiers, {
      'army.s02.guard': { id: 'army.s02.guard', defaultStance: 'fly' }
    }));
    sync(flow);
    expect(flow.system.getSquadPreset('qian')).toBe('escort');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('重复同步不重复套用（每分队只应用一次）', () => {
    const soldiers = [makeSoldier('u1', { squadId: 'qian' })];
    const flow = new SceneArmyCommandFlow(makeScene(soldiers, {
      'army.s02.guard': { id: 'army.s02.guard', defaultStance: 'hold' }
    }));
    sync(flow);
    flow.system.setSquadPreset('qian', 'advance');
    sync(flow);
    expect(flow.system.getSquadPreset('qian')).toBe('advance');
  });
});

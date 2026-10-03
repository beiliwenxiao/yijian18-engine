/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @file      GatheringSystem 状态准入（requiredState）测试
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { GatheringSystem } from './GatheringSystem.js';

/** 最小采集桩：节点实体 + 带 inventory 的玩家 */
function makeFixture({ requiredState = null, climbing = false, remaining = 10 } = {}) {
  const node = {
    depleted: false, remaining, maxRemaining: remaining,
    interactionRadius: 80, requiredToolType: null, requiredState,
    gatherDuration: 1.5, yieldPerGather: 1, resourceType: 'food'
  };
  const nodeEntity = {
    getComponent: name => {
      if (name === 'resourceNode') return node;
      if (name === 'transform') return { position: { x: 0, y: 0 } };
      return null;
    }
  };
  const player = {
    id: 'probe-player',
    getComponent: name => {
      if (name === 'inventory') return { exportItems: () => [] };
      if (name === 'transform') return { position: { x: 0, y: 0 } };
      return null;
    }
  };
  const system = new GatheringSystem({
    inventoryTransactions: { previewAdd: () => ({ accepted: 1 }) },
    stateCheckers: { climbing: entity => climbing }
  });
  return { system, player, nodeEntity, node };
}

describe('GatheringSystem 状态准入（node.requiredState）', () => {
  it('requiredState: climbing 且未攀爬 → 拒绝并返回 stateRequired', () => {
    const { system, player, nodeEntity } = makeFixture({ requiredState: 'climbing', climbing: false });
    const result = system.start({ player, nodeEntity });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('stateRequired');
    expect(result.requiredState).toBe('climbing');
  });

  it('requiredState: climbing 且攀爬中 → 采集启动成功', () => {
    const { system, player, nodeEntity } = makeFixture({ requiredState: 'climbing', climbing: true });
    const result = system.start({ player, nodeEntity });
    expect(result.ok).toBe(true);
    expect(system.isActive()).toBe(true);
  });

  it('无 requiredState 的节点不校验状态（既有节点零回归）', () => {
    const { system, player, nodeEntity } = makeFixture({ requiredState: null, climbing: false });
    const result = system.start({ player, nodeEntity });
    expect(result.ok).toBe(true);
  });

  it('stateCheckers 未注入 checker 时 requiredState 不阻断（防御性缺省）', () => {
    const { system, player, nodeEntity } = makeFixture({ requiredState: 'climbing', climbing: false });
    system.stateCheckers = {}; // 未注册 climbing checker
    const result = system.start({ player, nodeEntity });
    expect(result.ok).toBe(true);
  });
});

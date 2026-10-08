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

import { describe, it, expect } from 'vitest';
import { MovementSystem } from './MovementSystem.js';

/** 最小实体桩：MovementSystem 点击跳只读 transform。 */
function makeEntity(x = 0, y = 0) {
  return {
    type: 'player',
    getComponent: name => (name === 'transform' ? { position: { x, y } } : null)
  };
}

function makeSystem({ blockedPoints = [], jumped = [] } = {}) {
  // 真实 isPositionBlocked 带 entityRadius(12px) 查询碰撞几何——mock 同语义
  const isBlocked = (x, y) => blockedPoints.some(p => Math.hypot(x - p[0], y - p[1]) <= 12);
  const system = new MovementSystem({
    onAutoJump: (entity, dirX, dirY, chargeDistance) => {
      jumped.push({ dirX, dirY, chargeDistance });
      return true;
    },
    isPositionBlocked: isBlocked,
    autoJumpMaxDistance: 120
  });
  return { system, jumped };
}

describe('MovementSystem 点击跳（跳跃可达但步行不可达时自动跳跃）', () => {
  it('直线路径被阻挡：朝目标方向自动跳，方向与距离正确', () => {
    // 目标 (100, 0)，路径中点 (50, 0) 有一格阻挡
    const { system, jumped } = makeSystem({ blockedPoints: [[50, 0]] });
    const entity = makeEntity(0, 0);
    const started = system._tryAutoJumpToPosition(entity, { x: 100, y: 0 });
    expect(started).toBe(true);
    expect(jumped.length).toBe(1);
    expect(jumped[0].dirX).toBe(1);
    expect(jumped[0].dirY).toBe(0);
    expect(jumped[0].chargeDistance).toBe(100);
  });

  it('直线路径无阻挡：正常步行，不触发跳跃', () => {
    const { system, jumped } = makeSystem({ blockedPoints: [] });
    const entity = makeEntity(0, 0);
    expect(system._tryAutoJumpToPosition(entity, { x: 100, y: 0 })).toBe(false);
    expect(jumped.length).toBe(0);
  });

  it('超出跳跃距离上限：不处理（维持现状走向目标）', () => {
    const { system, jumped } = makeSystem({ blockedPoints: [[80, 0]] });
    const entity = makeEntity(0, 0);
    expect(system._tryAutoJumpToPosition(entity, { x: 300, y: 0 })).toBe(false);
    expect(jumped.length).toBe(0);
  });

  it('目标点本身不可站立：跳过去没有意义，不触发', () => {
    const { system, jumped } = makeSystem({ blockedPoints: [[100, 0], [50, 0]] });
    const entity = makeEntity(0, 0);
    expect(system._tryAutoJumpToPosition(entity, { x: 100, y: 0 })).toBe(false);
    expect(jumped.length).toBe(0);
  });

  it('距离太近（≤24）：步行直达，不触发跳跃', () => {
    const { system, jumped } = makeSystem({ blockedPoints: [[12, 0]] });
    const entity = makeEntity(0, 0);
    expect(system._tryAutoJumpToPosition(entity, { x: 20, y: 0 })).toBe(false);
    expect(jumped.length).toBe(0);
  });

  it('未注入回调（旧装配）时直接返回 false：零回归', () => {
    const system = new MovementSystem({});
    const entity = makeEntity(0, 0);
    expect(system._tryAutoJumpToPosition(entity, { x: 100, y: 0 })).toBe(false);
  });
});

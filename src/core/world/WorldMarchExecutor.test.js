/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { WorldRouteLayer } from './WorldRouteLayer.js';
import { WorldMarchExecutor, DEFAULT_MODE_SPEED } from './WorldMarchExecutor.js';

const buildLayer = ({ getOwnership = null } = {}) => new WorldRouteLayer({
  logic: {
    schemaVersion: 1,
    nodes: [
      { id: 'n.a', kind: 'city', position: { x: 0, y: 0 } },
      { id: 'n.b', kind: 'bridge', position: { x: 300, y: 0 }, ownerFactionId: 'yellow_turban' },
      { id: 'n.c', kind: 'city', position: { x: 300, y: 400 } }
    ],
    edges: [
      { id: 'e.ab', from: 'n.a', to: 'n.b', mode: 'road', cost: 1, conditions: { crossingNodeId: 'n.b' } },
      { id: 'e.bc', from: 'n.b', to: 'n.c', mode: 'mountainPath', cost: 2 }
    ]
  },
  moverFactionId: 'yellow_turban',
  getOwnership
});

const buildState = (route, position = { x: 0, y: 0 }) => ({ position: { ...position }, route });
const buildRoute = () => ({ nodeIds: ['n.a', 'n.b', 'n.c'], edgeIds: ['e.ab', 'e.bc'], index: 1 });

describe('WorldMarchExecutor', () => {
  it('沿边推进：道路按基准速度，进度按总路程累计', () => {
    const layer = buildLayer();
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100 });
    const state = buildState(buildRoute());
    const result = executor.execute({ state, order: {}, stepMs: 1000 });
    expect(result.status).toBe('executing');
    expect(state.position.x).toBeCloseTo(100);
    expect(state.position.y).toBeCloseTo(0);
    expect(result.progress).toBeCloseTo(100 / 700, 4);
  });

  it('抵达中间节点回调 onEnterNode，走完全程 completed + position 对齐终点', () => {
    const layer = buildLayer();
    const entered = [];
    const executor = new WorldMarchExecutor({
      layer,
      marchSpeed: 100,
      onEnterNode: ({ nodeId }) => entered.push(nodeId)
    });
    const state = buildState(buildRoute());
    let result = null;
    for (let step = 0; step < 20 && result?.status !== 'completed'; step += 1) {
      result = executor.execute({ state, order: {}, stepMs: 1000 });
    }
    expect(result.status).toBe('completed');
    expect(result.progress).toBe(1);
    expect(state.position).toEqual({ x: 300, y: 400 });
    expect(entered).toEqual(['n.b', 'n.c']);
  });

  it('边形态速度倍率生效（mountainPath 0.6）', () => {
    const layer = buildLayer();
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100 });
    expect(executor.modeSpeed.mountainPath).toBe(DEFAULT_MODE_SPEED.mountainPath);
    const state = buildState(
      { nodeIds: ['n.b', 'n.c'], edgeIds: ['e.bc'], index: 1 },
      { x: 300, y: 0 }
    );
    const result = executor.execute({ state, order: {}, stepMs: 1000 });
    expect(result.status).toBe('executing');
    expect(state.position.y).toBeCloseTo(60);
  });

  it('无 route → failed(routeMissing)', () => {
    const layer = buildLayer();
    const executor = new WorldMarchExecutor({ layer });
    expect(executor.execute({ state: { position: { x: 0, y: 0 } }, order: {}, stepMs: 500 }))
      .toMatchObject({ status: 'failed', code: 'routeMissing' });
  });

  it('行军途中边变不可走 → failed(routeBlocked)，位置停在上一个节点', () => {
    let crossingFaction = 'yellow_turban';
    const layer = buildLayer({ getOwnership: nodeId => (nodeId === 'n.b' ? crossingFaction : undefined) });
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100 });
    const state = buildState(buildRoute());
    layer.getSnapshot();
    crossingFaction = 'han_government';
    layer.invalidate('enemyCapturedBridge');

    const result = executor.execute({ state, order: {}, stepMs: 1000 });
    expect(result).toMatchObject({ status: 'failed', code: 'routeBlocked', edgeId: 'e.ab' });
    expect(state.position).toEqual({ x: 0, y: 0 });
  });

  it('抵达半径内直接吸附并完成最后一段', () => {
    const layer = buildLayer();
    const executor = new WorldMarchExecutor({ layer, marchSpeed: 100, arrivalRadius: 16 });
    const state = buildState({ nodeIds: ['n.a', 'n.b'], edgeIds: ['e.ab'], index: 1 }, { x: 292, y: 0 });
    const result = executor.execute({ state, order: {}, stepMs: 100 });
    expect(result.status).toBe('completed');
    expect(state.position).toEqual({ x: 300, y: 0 });
  });
});

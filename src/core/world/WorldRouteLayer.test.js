/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 ************************************************************/

import { describe, it, expect } from 'vitest';
import {
  WorldRouteLayer,
  evaluateEdgePassability,
  validateWorldLogic,
  ROUTE_STATUS,
  ROUTE_STATUS_SEVERITY
} from './WorldRouteLayer.js';

const NODES = () => [
  { id: 'node.a', kind: 'city', name: '甲城', position: { x: 100, y: 100 }, ownerFactionId: 'yellow_turban' },
  { id: 'node.b', kind: 'bridge', name: '桥', position: { x: 1400, y: 100 }, ownerFactionId: 'yellow_turban' },
  { id: 'node.c', kind: 'city', name: '乙城', position: { x: 2700, y: 100 }, ownerFactionId: 'han_government' },
  { id: 'node.d', kind: 'junction', name: '岔路', position: { x: 100, y: 800 } },
  { id: 'node.e', kind: 'ferry', name: '渡口', position: { x: 1400, y: 800 } },
  { id: 'node.f', kind: 'pass', name: '关隘', position: { x: 2700, y: 800 }, ownerFactionId: 'han_government' }
];

const EDGES = () => [
  { id: 'edge.bridge_in', from: 'node.a', to: 'node.b', mode: 'road', cost: 1, conditions: { crossingNodeId: 'node.b' } },
  { id: 'edge.bridge_out', from: 'node.b', to: 'node.c', mode: 'road', cost: 2, conditions: { crossingNodeId: 'node.b' } },
  { id: 'edge.road1', from: 'node.a', to: 'node.d', mode: 'road', cost: 1 },
  { id: 'edge.ferry1', from: 'node.d', to: 'node.e', mode: 'ferry', cost: 1, conditions: { crossingNodeId: 'node.e' } },
  { id: 'edge.ferry2', from: 'node.e', to: 'node.c', mode: 'ferry', cost: 1, conditions: { crossingNodeId: 'node.e' } },
  { id: 'edge.pass', from: 'node.c', to: 'node.f', mode: 'road', cost: 1 },
  { id: 'edge.terrain', from: 'node.a', to: 'node.f', mode: 'mountainPath', cost: 3, conditions: { terrainBlocked: true } },
  { id: 'edge.closed', from: 'node.d', to: 'node.c', mode: 'road', cost: 1, conditions: { blockedUntilDay: 10 } },
  { id: 'edge.faction', from: 'node.a', to: 'node.e', mode: 'waterway', cost: 1, conditions: { factionIds: ['han_government'] } }
];

const makeLayer = (overrides = {}) => new WorldRouteLayer({
  logic: { schemaVersion: 1, nodes: NODES(), edges: EDGES() },
  moverFactionId: 'yellow_turban',
  ...overrides
});

describe('WorldRouteLayer · 唯一通行判定', () => {
  const nodes = new Map(NODES().map(node => [node.id, node]));
  const ownership = new Map(NODES().map(node => [node.id, node.ownerFactionId ?? null]));
  const ctx = { day: 1, moverFactionId: 'yellow_turban', ownership, nodes };

  it('优先级：terrain > closed > hostile > passable', () => {
    const all = {
      id: 'edge.all',
      from: 'node.a',
      to: 'node.c',
      conditions: { terrainBlocked: true, blockedUntilDay: 9, factionIds: ['nobody'] }
    };
    expect(evaluateEdgePassability(all, ctx).status).toBe(ROUTE_STATUS.TERRAIN);

    const closedAndHostile = {
      id: 'edge.ch',
      from: 'node.a',
      to: 'node.c',
      conditions: { blockedUntilDay: 9, factionIds: ['nobody'] }
    };
    expect(evaluateEdgePassability(closedAndHostile, ctx).status).toBe(ROUTE_STATUS.CLOSED);
  });

  it('阵营白名单不含行军方 → hostile', () => {
    const result = evaluateEdgePassability(
      { id: 'edge.x', from: 'node.a', to: 'node.b', conditions: { factionIds: ['han_government'] } },
      ctx
    );
    expect(result).toMatchObject({ passable: false, status: ROUTE_STATUS.HOSTILE });
    expect(result.reasons).toContain('factionNotAllowed');
  });

  it('crossing 节点不存在/类别不对 → invalid', () => {
    const result = evaluateEdgePassability(
      { id: 'edge.x', from: 'node.a', to: 'node.b', conditions: { crossingNodeId: 'node.a' } },
      ctx
    );
    expect(result.status).toBe(ROUTE_STATUS.INVALID);
  });

  it('crossing 中立放行；敌方控制 → hostile(crossingHeldByEnemy)', () => {
    const neutralOwnership = new Map(ownership);
    neutralOwnership.set('node.b', null);
    const neutral = evaluateEdgePassability(
      { id: 'edge.x', from: 'node.a', to: 'node.b', conditions: { crossingNodeId: 'node.b' } },
      { ...ctx, ownership: neutralOwnership }
    );
    expect(neutral).toMatchObject({ passable: true, status: ROUTE_STATUS.PASSABLE });

    const enemy = evaluateEdgePassability(
      { id: 'edge.x', from: 'node.a', to: 'node.b', conditions: { crossingNodeId: 'node.b' } },
      { ...ctx, ownership: new Map([...ownership, ['node.b', 'han_government']]) }
    );
    expect(enemy).toMatchObject({ passable: false, status: ROUTE_STATUS.HOSTILE });
    expect(enemy.reasons[0]).toContain('crossingHeldByEnemy');
  });

  it('端点关隘被敌方控制 → hostile(passBlocked)；己方控制 → 放行', () => {
    const blocked = evaluateEdgePassability(
      { id: 'edge.pass', from: 'node.c', to: 'node.f', conditions: {} },
      ctx
    );
    expect(blocked).toMatchObject({ passable: false, status: ROUTE_STATUS.HOSTILE });
    expect(blocked.reasons[0]).toContain('passBlocked');

    const friendly = evaluateEdgePassability(
      { id: 'edge.pass', from: 'node.c', to: 'node.f', conditions: {} },
      { ...ctx, ownership: new Map([...ownership, ['node.f', 'yellow_turban']]) }
    );
    expect(friendly).toMatchObject({ passable: true, status: ROUTE_STATUS.PASSABLE });
  });
});

describe('WorldRouteLayer · 快照与重算', () => {
  it('load 后可用；invalidate 递增 revision 并重建快照', () => {
    const layer = makeLayer();
    const first = layer.getSnapshot();
    expect(first.revision).toBe(layer.revision);
    expect(first.adjacency.get('node.a').map(step => step.edgeId)).toContain('edge.bridge_in');

    layer.invalidate('enemyCaptured');
    const second = layer.getSnapshot();
    expect(second.revision).toBe(first.revision + 1);
    expect(second).not.toBe(first);
  });

  it('不可走边不进 adjacency（terrain/closed/hostile 全过滤）', () => {
    const layer = makeLayer();
    const snapshot = layer.getSnapshot();
    const fromA = snapshot.adjacency.get('node.a').map(step => step.edgeId);
    expect(fromA).not.toContain('edge.terrain');
    expect(fromA).not.toContain('edge.faction');
    const fromD = snapshot.adjacency.get('node.d').map(step => step.edgeId);
    expect(fromD).not.toContain('edge.closed');
  });

  it('运行态归属覆盖定义归属', () => {
    const layer = makeLayer({
      getOwnership: nodeId => (nodeId === 'node.b' ? 'han_government' : undefined)
    });
    expect(layer.getSnapshot().edges['edge.bridge_in'].status).toBe(ROUTE_STATUS.HOSTILE);
    expect(layer.getOwner('node.b')).toBe('han_government');
  });

  it('游戏日变化自动作废快照（blockedUntilDay 解封）', () => {
    let day = 1;
    const layer = makeLayer({ getDay: () => day });
    expect(layer.getSnapshot().edges['edge.closed'].status).toBe(ROUTE_STATUS.CLOSED);
    const before = layer.revision;
    day = 10;
    const snapshot = layer.getSnapshot();
    expect(snapshot.edges['edge.closed'].status).toBe(ROUTE_STATUS.PASSABLE);
    expect(snapshot.revision).toBe(before + 1);
  });
});

describe('WorldRouteLayer · 图最短路', () => {
  it('走可用边返回节点链与边链', () => {
    const layer = makeLayer();
    const path = layer.shortestPath('node.a', 'node.b');
    expect(path).toMatchObject({ ok: true, nodeIds: ['node.a', 'node.b'], edgeIds: ['edge.bridge_in'] });
    expect(path.cost).toBeCloseTo(1);
  });

  it('avoidEdgeIds 绕行；不可绕则 noPath', () => {
    const layer = makeLayer();
    // 甲城到关隘：edge.pass 被敌占关隘挡、edge.terrain 永久阻隔 → 不可达
    expect(layer.shortestPath('node.a', 'node.f').ok).toBe(false);
    expect(layer.shortestPath('node.a', 'node.f').code).toBe('noPath');
    // 甲城到渡口经桥绕行仍可达（桥己方控制）
    expect(layer.shortestPath('node.a', 'node.e').ok).toBe(true);

    // 避开桥入口后仍可绕道（甲城→岔路→渡口→乙城→桥）
    const detour = layer.shortestPath('node.a', 'node.b', { avoidEdgeIds: ['edge.bridge_in'] });
    expect(detour.ok).toBe(true);
    expect(detour.edgeIds).not.toContain('edge.bridge_in');
    expect(detour.nodeIds).toEqual(['node.a', 'node.d', 'node.e', 'node.c', 'node.b']);

    // 桥到乙城避开桥出口后同样绕道
    const second = layer.shortestPath('node.b', 'node.c', { avoidEdgeIds: ['edge.bridge_out'] });
    expect(second.ok).toBe(true);
    expect(second.edgeIds).not.toContain('edge.bridge_out');
  });

  it('未知节点返回 unknownNode；同点返回空路径', () => {
    const layer = makeLayer();
    expect(layer.shortestPath('node.zzz', 'node.a')).toMatchObject({ ok: false, code: 'unknownNode' });
    expect(layer.shortestPath('node.a', 'node.a')).toMatchObject({ ok: true, edgeIds: [], cost: 0 });
  });
});

describe('WorldRouteLayer · 目标解析', () => {
  it('findNearestNode 按距离过滤；resolveTarget 支持坐标吸附与显式 id', () => {
    const layer = makeLayer();
    const nearest = layer.findNearestNode({ x: 150, y: 120 });
    expect(nearest.nodeId).toBe('node.a');
    expect(layer.findNearestNode({ x: 9999, y: 9999 }, { maxDistance: 100 })).toBeNull();

    expect(layer.resolveTarget({ x: 1390, y: 90 })).toBe('node.b');
    expect(layer.resolveTarget({ nodeId: 'node.d' })).toBe('node.d');
    expect(layer.resolveTarget('node.c')).toBe('node.c');
    expect(layer.resolveTarget({ x: 9999, y: 9999 })).toBeNull();
  });
});

describe('WorldRouteLayer · 通行色派生投影', () => {
  const logic = {
    schemaVersion: 1,
    nodes: [
      { id: 'n.a', kind: 'city', position: { x: 100, y: 100 }, cell: { row: 0, col: 0 }, ownerFactionId: 'yellow_turban' },
      { id: 'n.b', kind: 'bridge', position: { x: 1400, y: 100 }, cell: { row: 0, col: 1 }, ownerFactionId: 'yellow_turban' },
      { id: 'n.c', kind: 'city', position: { x: 2700, y: 100 }, cell: { row: 0, col: 2 }, ownerFactionId: 'han_government' },
      { id: 'n.d', kind: 'junction', position: { x: 100, y: 800 }, cell: { row: 1, col: 0 } },
      { id: 'n.e', kind: 'junction', position: { x: 1400, y: 800 }, cell: { row: 1, col: 1 } },
      { id: 'n.f', kind: 'junction', position: { x: 1400, y: 1500 }, cell: { row: 2, col: 1 } },
      { id: 'n.h', kind: 'junction', position: { x: 2700, y: 1500 }, cell: { row: 2, col: 2 } }
    ],
    edges: [
      { id: 'e.ab', from: 'n.a', to: 'n.b', mode: 'road', cost: 1, conditions: { crossingNodeId: 'n.b' } },
      { id: 'e.bc', from: 'n.b', to: 'n.c', mode: 'road', cost: 1, conditions: { crossingNodeId: 'n.b' } },
      { id: 'e.de', from: 'n.d', to: 'n.e', mode: 'road', cost: 1, conditions: { factionIds: ['han_government'] } },
      { id: 'e.ef', from: 'n.e', to: 'n.f', mode: 'mountainPath', cost: 4, conditions: { terrainBlocked: true } },
      { id: 'e.eh', from: 'n.e', to: 'n.h', mode: 'road', cost: 2, conditions: { blockedUntilDay: 10 } }
    ]
  };
  const region = { rows: 3, cols: 3, chunkWidth: 1280, chunkHeight: 720 };

  it('四色 + noRoute：一格覆盖取最高严重度，节点格由节点状态派生', () => {
    const layer = new WorldRouteLayer({ logic, moverFactionId: 'yellow_turban' });
    const overlay = layer.buildCellOverlay(region);
    const cell = (row, col) => overlay.find(entry => entry.row === row && entry.col === col);

    // 通行：边 e.ab / e.bc 与己方/中立节点
    expect(cell(0, 0).status).toBe(ROUTE_STATUS.PASSABLE);
    expect(cell(0, 1).status).toBe(ROUTE_STATUS.PASSABLE);
    // 敌方城池节点格由节点状态派生为敌情挡（边本身可走不改变敌占格颜色）
    expect(cell(0, 2).status).toBe(ROUTE_STATUS.HOSTILE);
    // 敌情挡（阵营白名单）在 (1,0)
    expect(cell(1, 0).status).toBe(ROUTE_STATUS.HOSTILE);
    // (1,1) 被 terrain 边覆盖 → 优先 terrain（高于 hostile/closed）
    expect(cell(1, 1).status).toBe(ROUTE_STATUS.TERRAIN);
    // 完全无边的格 = noRoute（浅灰），与 terrain（深灰）明确区分
    expect(cell(2, 0).status).toBe(ROUTE_STATUS.NO_ROUTE);
    expect(cell(2, 1).status).toBe(ROUTE_STATUS.TERRAIN);
    expect(cell(2, 2).status).toBe(ROUTE_STATUS.CLOSED);

    // 严重度不变量：terrain > closed > hostile > passable > noRoute
    expect(ROUTE_STATUS_SEVERITY.terrain).toBeGreaterThan(ROUTE_STATUS_SEVERITY.closed);
    expect(ROUTE_STATUS_SEVERITY.closed).toBeGreaterThan(ROUTE_STATUS_SEVERITY.hostile);
    expect(ROUTE_STATUS_SEVERITY.hostile).toBeGreaterThan(ROUTE_STATUS_SEVERITY.passable);
    expect(ROUTE_STATUS_SEVERITY.passable).toBeGreaterThan(ROUTE_STATUS_SEVERITY.noRoute);
  });

  it('投影带 revision，且不返回颜色（颜色映射归 UI）', () => {
    const layer = new WorldRouteLayer({ logic, moverFactionId: 'yellow_turban' });
    const overlay = layer.buildCellOverlay(region);
    expect(overlay).toHaveLength(9);
    expect(overlay[0].revision).toBe(layer.getSnapshot().revision);
    expect(overlay[0]).not.toHaveProperty('color');
    expect(overlay[0]).not.toHaveProperty('fillStyle');

    const lines = layer.buildEdgeLines();
    expect(lines).toHaveLength(5);
    expect(lines.find(line => line.edgeId === 'e.ef').status).toBe(ROUTE_STATUS.TERRAIN);
    expect(lines.every(line => line.revision === layer.getSnapshot().revision)).toBe(true);
  });

  it('region 为空时返回空数组（面板降级）', () => {
    const layer = new WorldRouteLayer({ logic, moverFactionId: 'yellow_turban' });
    expect(layer.buildCellOverlay({})).toEqual([]);
  });
});

describe('validateWorldLogic', () => {
  it('默认样例合法', () => {
    const result = validateWorldLogic({ nodes: NODES(), edges: EDGES() });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('重复 id / 未知端点 / 自环 / 非法 crossing / 非法 cost 报错', () => {
    const result = validateWorldLogic({
      nodes: [
        { id: 'n1', kind: 'city', position: { x: 0, y: 0 } },
        { id: 'n1', kind: 'city', position: { x: 1, y: 1 } },
        { id: 'n2', kind: 'bridge', position: { x: 2, y: 2 } }
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n1', mode: 'road', cost: 0 },
        { id: 'e2', from: 'n1', to: 'ghost', mode: 'road', cost: 1 },
        { id: 'e3', from: 'n2', to: 'n1', mode: 'road', cost: 1, conditions: { crossingNodeId: 'n1' } },
        { id: 'e4', from: 'n2', to: 'n1', mode: 'air', cost: 1 }
      ]
    });
    expect(result.ok).toBe(false);
    const codes = result.errors.map(error => error.code);
    expect(codes).toContain('duplicateNodeId');
    expect(codes).toContain('edgeSelfLoop');
    expect(codes).toContain('edgeToUnknown');
    expect(codes).toContain('crossingNodeInvalid');
    expect(codes).toContain('edgeCostInvalid');
    expect(codes).toContain('unknownEdgeMode');
  });

  it('tollRate 配在非 pass 节点给 warning 而非 error', () => {
    const result = validateWorldLogic({
      nodes: [{ id: 'n1', kind: 'city', position: { x: 0, y: 0 }, tollRate: 0.1 }],
      edges: []
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.map(warning => warning.code)).toContain('tollOnNonPass');
  });
});

describe('WorldRouteLayer · 4B 来源标记与内容别名', () => {
  it('load 原样保留节点/边扩展字段（source/autoRevision），不做白名单裁剪', () => {
    const nodes = [
      { id: 'n.a', kind: 'city', position: { x: 0, y: 0 }, source: 'auto', autoRevision: 3, extra: { keep: 1 } }
    ];
    const edges = [
      { id: 'e.ab', from: 'n.a', to: 'n.b', mode: 'road', cost: 1, source: 'manual', autoRevision: 2, extra: 'keep' }
    ];
    nodes.push({ id: 'n.b', kind: 'junction', position: { x: 100, y: 0 }, source: 'manual' });
    const layer = new WorldRouteLayer({ logic: { nodes, edges } });
    expect(layer.getNode('n.a')).toBe(nodes[0]);
    expect(layer.getNode('n.a')).toMatchObject({ source: 'auto', autoRevision: 3, extra: { keep: 1 } });
    expect(layer.getEdge('e.ab')).toMatchObject({ source: 'manual', autoRevision: 2, extra: 'keep' });
  });

  it('来源标记不参与通行判定：同一张图仅改 source 结果不变', () => {
    const build = source => makeLayer({
      logic: {
        nodes: NODES().map(node => ({ ...node, source })),
        edges: EDGES().map(edge => ({ ...edge, source }))
      }
    });
    const auto = build('auto');
    const manual = build('manual');
    expect(auto.shortestPath('node.a', 'node.c')).toEqual(manual.shortestPath('node.a', 'node.c'));
    expect(auto.getSnapshot().edges).toEqual(manual.getSnapshot().edges);
  });

  it('兼容 4A 内容别名：weight 参与最短路权重', () => {
    const layer = new WorldRouteLayer({
      logic: {
        nodes: [
          { id: 'n.a', kind: 'city', position: { x: 0, y: 0 } },
          { id: 'n.b', kind: 'junction', position: { x: 100, y: 0 } },
          { id: 'n.c', kind: 'city', position: { x: 200, y: 0 } }
        ],
        edges: [
          { id: 'e.ab', from: 'n.a', to: 'n.b', mode: 'road', weight: 5 },
          { id: 'e.bc', from: 'n.b', to: 'n.c', mode: 'road', weight: 7 }
        ]
      }
    });
    expect(layer.shortestPath('n.a', 'n.c')).toMatchObject({ ok: true, cost: 12 });
    expect(validateWorldLogic({ nodes: [{ id: 'n.a', kind: 'city', position: { x: 0, y: 0 } }], edges: [] }).ok).toBe(true);
  });

  it('兼容顶层 crossingNodeId：桥被敌方控制时该边不可走', () => {
    const layer = new WorldRouteLayer({
      logic: {
        nodes: [
          { id: 'n.a', kind: 'city', position: { x: 0, y: 0 } },
          { id: 'n.bridge', kind: 'bridge', position: { x: 100, y: 0 }, ownerFactionId: 'han_government' },
          { id: 'n.c', kind: 'city', position: { x: 200, y: 0 } }
        ],
        edges: [
          { id: 'e.ab', from: 'n.a', to: 'n.bridge', mode: 'road', weight: 1 },
          { id: 'e.bc', from: 'n.bridge', to: 'n.c', mode: 'bridge', weight: 1, crossingNodeId: 'n.bridge' }
        ]
      },
      moverFactionId: 'yellow_turban'
    });
    const snapshot = layer.getSnapshot();
    expect(snapshot.edges['e.bc']).toMatchObject({ passable: false, status: ROUTE_STATUS.HOSTILE });
    expect(layer.shortestPath('n.a', 'n.c')).toMatchObject({ ok: false, code: 'noPath' });
  });

  it('未知 source / 非法 autoRevision 只给 warning，不阻塞校验', () => {
    const result = validateWorldLogic({
      nodes: [{ id: 'n1', kind: 'city', position: { x: 0, y: 0 }, source: 'robot', autoRevision: 'x' }],
      edges: []
    });
    expect(result.ok).toBe(true);
    const codes = result.warnings.map(warning => warning.code);
    expect(codes).toContain('unknownRouteSource');
    expect(codes).toContain('invalidAutoRevision');
  });
});

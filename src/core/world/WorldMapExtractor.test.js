import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { extractWorldLogic } from './WorldMapExtractor.js';

const CHUNK_W = 1280;
const CHUNK_H = 720;

/** 造一个最小 project：1 个 region + cityStates + roadEdges。 */
function makeProject({ cells = [], cityStates = [], roadEdges = [], chunkWidth = CHUNK_W, chunkHeight = CHUNK_H } = {}) {
  return {
    worldMap: {
      regions: [{
        id: 'mainland',
        mapType: 'terrainGrid',
        chunkWidth,
        chunkHeight,
        grid: cells,
        roadEdges
      }]
    },
    variables: { cityStates }
  };
}

const plain = (extra = {}) => ({ terrain: 'plain', ...extra });

describe('WorldMapExtractor 读取顺序（cityStates → city → cell.poi → 关隘/渡口 → roadEdges → 边）', () => {
  it('cityStates 生成 city 节点：id/ref/位置取格中心/faction', () => {
    const project = makeProject({
      cells: [
        [plain(), plain()],
        [plain(), plain({ sceneId: 'S09' })]
      ],
      cityStates: [{ id: 'city.s09_camp', name: '广宗营地', factionId: 'yellow_turban' }]
    });
    const { nodes, edges } = extractWorldLogic(project);
    expect(nodes).toEqual([{
      id: 'city.s09',
      name: '广宗营地',
      kind: 'city',
      ref: { id: 'city.s09_camp' },
      position: { x: 1 * CHUNK_W + CHUNK_W / 2, y: 1 * CHUNK_H + CHUNK_H / 2 },
      source: 'auto',
      ownerFactionId: 'yellow_turban'
    }]);
    expect(edges).toEqual([]);
  });

  it('城市找不到承载格只记 gap，不猜位置', () => {
    const project = makeProject({
      cells: [[plain()]],
      cityStates: [{ id: 'city.s99_none', name: '不存在' }]
    });
    const { nodes, gaps } = extractWorldLogic(project);
    expect(nodes).toEqual([]);
    expect(gaps.map(gap => gap.code)).toContain('cityWithoutCell');
  });

  it('cell.poi 生成关隘/渡口节点：位置取格上边中点', () => {
    const project = makeProject({
      cells: [
        [plain({ poi: 'pass' }), plain({ poi: 'ferry' }), plain({ poi: 'unknown' })]
      ]
    });
    const { nodes } = extractWorldLogic(project);
    expect(nodes.map(node => [node.id, node.kind, node.position])).toEqual([
      ['pass.mainland.r0c0', 'pass', { x: CHUNK_W / 2, y: 0 }],
      ['ferry.mainland.r0c1', 'ferry', { x: CHUNK_W + CHUNK_W / 2, y: 0 }]
    ]);
  });

  it('无道路标记不出边：只有 cell.road 而没有 roadEdges 时零边并记 gap', () => {
    const project = makeProject({
      cells: [[plain({ road: true, sceneId: 'S01' }), plain({ road: true, sceneId: 'S02' })]],
      cityStates: [
        { id: 'city.s01_camp', name: '甲' },
        { id: 'city.s02_camp', name: '乙' }
      ]
    });
    const { edges, gaps } = extractWorldLogic(project);
    expect(edges).toEqual([]);
    expect(gaps.map(gap => gap.code)).toContain('noRoadEdges');
  });

  it('roadEdges 两端都能落名才出边，端点无法落名记 gap', () => {
    const project = makeProject({
      cells: [[plain({ sceneId: 'S01' }), plain({ sceneId: 'S02' }), plain()]],
      cityStates: [
        { id: 'city.s01_camp', name: '甲' },
        { id: 'city.s02_camp', name: '乙' }
      ],
      roadEdges: [
        [[0, 0], [0, 1]],
        [[0, 1], [0, 2]]
      ]
    });
    const { edges, gaps } = extractWorldLogic(project);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe('edge.city.s01__city.s02');
    expect(edges[0].mode).toBe('road');
    expect(edges[0].cost).toBe(CHUNK_W);
    expect(edges[0].source).toBe('auto');
    expect(gaps.filter(gap => gap.code === 'roadEdgeEndpointUnresolved')).toHaveLength(1);
  });

  it('渡口相邻的边标 ferry 并在 conditions 里带上 crossingNodeId', () => {
    const project = makeProject({
      cells: [[plain({ sceneId: 'S01' }), plain({ poi: 'ferry' })]],
      cityStates: [{ id: 'city.s01_camp', name: '甲' }],
      roadEdges: [[[0, 0], [0, 1]]]
    });
    const { edges } = extractWorldLogic(project);
    expect(edges[0].mode).toBe('ferry');
    expect(edges[0].conditions).toEqual({ crossingNodeId: 'ferry.mainland.r0c1' });
  });

  it('岔路按 roadEdges 度数 ≥3 结构推导（落点在格左上角），可开关', () => {
    const project = makeProject({
      cells: [
        [plain({ sceneId: 'S01', road: true }), plain({ road: true }), plain({ sceneId: 'S02', road: true })],
        [plain(), plain({ sceneId: 'S03', road: true }), plain()]
      ],
      cityStates: [
        { id: 'city.s01_camp', name: '甲' },
        { id: 'city.s02_camp', name: '乙' },
        { id: 'city.s03_camp', name: '丙' }
      ],
      roadEdges: [
        [[0, 0], [0, 1]],
        [[0, 1], [0, 2]],
        [[0, 1], [1, 1]]
      ]
    });
    const withJunction = extractWorldLogic(project);
    const junction = withJunction.nodes.find(node => node.kind === 'junction');
    expect(junction.id).toBe('junction.mainland.r0c1');
    expect(junction.position).toEqual({ x: CHUNK_W, y: 0 });
    expect(withJunction.edges).toHaveLength(3);

    const withoutJunction = extractWorldLogic(project, { deriveJunctions: false });
    expect(withoutJunction.nodes.map(node => node.kind)).not.toContain('junction');
    expect(withoutJunction.edges).toHaveLength(0);
  });

  it('多 region 的格坐标互不覆盖，roadEdges 只在所属 region 内解析', () => {
    const project = {
      worldMap: {
        regions: [
          {
            id: 'a', mapType: 'terrainGrid', chunkWidth: CHUNK_W, chunkHeight: CHUNK_H,
            grid: [[plain({ sceneId: 'S01' }), plain({ sceneId: 'S02' })]],
            roadEdges: [[[0, 0], [0, 1]]]
          },
          {
            id: 'b', mapType: 'terrainGrid', chunkWidth: CHUNK_W, chunkHeight: CHUNK_H,
            grid: [[plain({ sceneId: 'S11' }), plain({ sceneId: 'S12' })]],
            roadEdges: [[[0, 0], [0, 1]]]
          }
        ]
      },
      variables: {
        cityStates: [
          { id: 'city.s01_camp', name: '甲' },
          { id: 'city.s02_camp', name: '乙' },
          { id: 'city.s11_camp', name: '丙' },
          { id: 'city.s12_camp', name: '丁' }
        ]
      }
    };
    const { nodes, edges, gaps } = extractWorldLogic(project, { revision: 3 });
    expect(nodes.map(node => node.id).sort()).toEqual(['city.s01', 'city.s02', 'city.s11', 'city.s12']);
    expect(edges).toHaveLength(2);
    expect(gaps).toEqual([]);
    expect(extractWorldLogic(project, { revision: 3 }).revision).toBe(3);
  });
});

describe('WorldMapExtractor 与示例项目人工层对照（验收口径）', () => {
  const project = JSON.parse(fs.readFileSync('example/sanguo_zhangjiao/game.project.json', 'utf8'));
  const manual = project.worldLogic;
  const auto = extractWorldLogic(project);

  /** 自动节点 → 人工节点：先按 id，再按 (kind + 位置 ≤1px)。 */
  const autoToManual = new Map();
  const matchedManualIds = new Set();
  for (const autoNode of auto.nodes) {
    let manualNode = manual.nodes.find(node => node.id === autoNode.id);
    if (!manualNode) {
      manualNode = manual.nodes.find(node => (
        !matchedManualIds.has(node.id)
        && node.kind === autoNode.kind
        && Math.abs(node.position.x - autoNode.position.x) <= 1
        && Math.abs(node.position.y - autoNode.position.y) <= 1
      ));
    }
    if (!manualNode) continue;
    autoToManual.set(autoNode.id, manualNode.id);
    matchedManualIds.add(manualNode.id);
  }
  const manualToAuto = new Map([...autoToManual].map(([autoId, manualId]) => [manualId, autoId]));
  const extraNodes = auto.nodes.filter(node => !autoToManual.has(node.id));
  const missingNodes = manual.nodes.filter(node => !matchedManualIds.has(node.id));

  it('节点差 ≤2（自动多出 s11/s12 两座城，人工独有颍川桥）', () => {
    expect(extraNodes.map(node => node.id).sort()).toEqual(['city.s11', 'city.s12']);
    expect(missingNodes.map(node => node.id)).toEqual(['bridge.yingchuan']);
    expect(Math.max(extraNodes.length, missingNodes.length)).toBeLessThanOrEqual(2);
  });

  it('边端点匹配 ≥80%', () => {
    let matchedEndpoints = 0;
    let matchedEdges = 0;
    for (const edge of manual.edges) {
      const from = manualToAuto.has(edge.from);
      const to = manualToAuto.has(edge.to);
      matchedEndpoints += (from ? 1 : 0) + (to ? 1 : 0);
      if (from && to) matchedEdges += 1;
    }
    expect(matchedEndpoints / (manual.edges.length * 2)).toBeGreaterThanOrEqual(0.8);
    expect(matchedEdges / manual.edges.length).toBeGreaterThanOrEqual(0.8);
  });

  it('无凭空多出的关隘/渡口（数量与位置都对得上人工层）', () => {
    const autoPois = auto.nodes.filter(node => node.kind === 'pass' || node.kind === 'ferry');
    const manualPois = manual.nodes.filter(node => node.kind === 'pass' || node.kind === 'ferry');
    expect(autoPois).toHaveLength(manualPois.length);
    for (const node of autoPois) {
      expect(autoToManual.get(node.id)).toBeTruthy();
    }
  });

  it('全部节点/边标记 source=auto，且自动层不会被当成人工层内容', () => {
    expect(auto.nodes.every(node => node.source === 'auto')).toBe(true);
    expect(auto.edges.every(edge => edge.source === 'auto')).toBe(true);
    expect(auto.gaps).toEqual([]);
  });
});

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-11
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WorldMapExtractor - 世界地图 → 自动逻辑层抽取（模块 4 · 4E）
 *
 * 分层语义（用户 2026-11-11 定稿）：
 * 1. 自动层只由地图抽取生成、可整体重抽、不可手改、**不参与运行时判定**；
 * 2. 人工修正层（`worldLogic.nodes/edges`）是唯一事实源，运行时只读这一层；
 * 3. 本模块产出的所有节点/边都带 `source:'auto'`，只能进差异面板的「新增待确认」，永不直接生效。
 *
 * 读取顺序（用户定稿，不可跳步/不可按地形臆测）：
 *   cityStates → city 节点 → cell.poi → 关隘/渡口 → road/roadEdges → 边
 * 即：城市只认 cityStates，关隘/渡口只认 cell.poi，边只认 roadEdges（无道路标记不出边）。
 *
 * 格坐标是 region 内局部坐标，跨 region 不互相覆盖；`roadEdges` 也只在所属 region 内解析端点。
 *
 * 位置约定（对齐人工层既有数据）：城市取格中心；关隘/渡口取格上边中点；岔路取格左上角
 * （道路分岔在格线上，与人工层 `junction.crossroads` 的落点一致）。
 * 岔路（junction）不在读取顺序里，是**结构推导**：roadEdges 度数 ≥3 且该格既无城市也无 POI 时，
 * 才补一个 `junction` 节点（不做按地形/名称的猜测）。可用 `deriveJunctions:false` 关闭以便对照。
 *
 * 纯函数：不碰 DOM、不写存档、不判定通行（判定仍只走 WorldRouteLayer）。
 */

import {
  getWorldMapCellPoi,
  isWorldMapRoadCell,
  normalizeWorldMapRoadEdges
} from '../WorldMapCell.js';

const DEFAULT_CHUNK_WIDTH = 1280;
const DEFAULT_CHUNK_HEIGHT = 720;

const POI_NODE_LABELS = Object.freeze({ pass: '关隘', ferry: '渡口' });

/** `city.s09_guangzong_camp` → `s09`；非 city 前缀返回 null。 */
function sceneTokenFromCityId(cityId) {
  const match = /^city\.(s\d+)(?:_|$)/i.exec(String(cityId || ''));
  return match ? match[1].toLowerCase() : null;
}

/** 索引一个 region 的格（坐标是 region 局部坐标，key 带 region 前缀防跨 region 串号）。 */
function indexRegion(region, index) {
  const regionId = region?.id ?? `region${index}`;
  const chunkWidth = Number(region?.chunkWidth) || DEFAULT_CHUNK_WIDTH;
  const chunkHeight = Number(region?.chunkHeight) || DEFAULT_CHUNK_HEIGHT;
  const cells = [];
  const byKey = new Map();
  const bySceneId = new Map();
  for (const [row, gridRow] of (region?.grid || []).entries()) {
    for (const [col, cell] of (gridRow || []).entries()) {
      const key = `${index}:${row},${col}`;
      const sceneId = typeof cell === 'string' ? cell : (cell?.sceneId || null);
      const entry = {
        key,
        row,
        col,
        cell,
        sceneId: sceneId ? String(sceneId) : null,
        poi: getWorldMapCellPoi(cell),
        road: isWorldMapRoadCell(cell),
        center: { x: col * chunkWidth + chunkWidth / 2, y: row * chunkHeight + chunkHeight / 2 },
        topCenter: { x: col * chunkWidth + chunkWidth / 2, y: row * chunkHeight },
        topLeft: { x: col * chunkWidth, y: row * chunkHeight }
      };
      byKey.set(`${row},${col}`, entry);
      cells.push(entry);
      if (entry.sceneId) bySceneId.set(entry.sceneId.toUpperCase(), entry);
    }
  }
  return {
    regionId,
    cells,
    byKey,
    bySceneId,
    roadEdges: normalizeWorldMapRoadEdges(region?.roadEdges)
  };
}

/** 城市节点：只认 cityStates，按 id 场景 token 找承载格（跨 region 查找）。 */
function buildCityNodes(project, regionViews, nodeIdByCell, gaps) {
  const nodes = [];
  const cityStates = Array.isArray(project?.variables?.cityStates) ? project.variables.cityStates : [];
  for (const city of cityStates) {
    const cityId = city?.id;
    if (!cityId) continue;
    const token = sceneTokenFromCityId(cityId);
    let entry = null;
    if (token) {
      const sceneId = token.toUpperCase();
      for (const view of regionViews) {
        if (view.bySceneId.has(sceneId)) {
          entry = view.bySceneId.get(sceneId);
          break;
        }
      }
    }
    if (!entry) {
      gaps.push({ code: 'cityWithoutCell', cityId, message: 'cityStates 里的城市找不到承载场景格' });
      continue;
    }
    const node = {
      id: `city.${token}`,
      name: city.name || cityId,
      kind: 'city',
      ref: { id: cityId },
      position: { ...entry.center },
      source: 'auto'
    };
    const factionId = city.factionId ?? city.ownerFactionId;
    if (factionId) node.ownerFactionId = factionId;
    nodes.push(node);
    nodeIdByCell.set(entry.key, node.id);
  }
  return nodes;
}

/** 关隘/渡口节点：只认 cell.poi（位置取格上边中点，与人工层约定一致）。 */
function buildPoiNodes(regionViews, nodeIdByCell) {
  const nodes = [];
  for (const view of regionViews) {
    for (const entry of view.cells) {
      if (!entry.poi) continue;
      const node = {
        id: `${entry.poi}.${view.regionId}.r${entry.row}c${entry.col}`,
        name: `${POI_NODE_LABELS[entry.poi]}(${entry.col},${entry.row})`,
        kind: entry.poi,
        position: { ...entry.topCenter },
        source: 'auto'
      };
      nodes.push(node);
      nodeIdByCell.set(entry.key, node.id);
    }
  }
  return nodes;
}

/** 岔路节点：roadEdges 度数 ≥3 且无城市/POI 的格（结构推导，非按地形臆测）。 */
function buildJunctionNodes(regionViews, nodeIdByCell) {
  const nodes = [];
  for (const view of regionViews) {
    const degree = new Map();
    for (const [a, b] of view.roadEdges) {
      for (const [row, col] of [a, b]) {
        const key = `${row},${col}`;
        degree.set(key, (degree.get(key) || 0) + 1);
      }
    }
    for (const entry of view.cells) {
      if (nodeIdByCell.has(entry.key)) continue;
      if (!entry.road) continue;
      if ((degree.get(`${entry.row},${entry.col}`) || 0) < 3) continue;
      const node = {
        id: `junction.${view.regionId}.r${entry.row}c${entry.col}`,
        name: `岔路(${entry.col},${entry.row})`,
        kind: 'junction',
        position: { ...entry.topLeft },
        source: 'auto'
      };
      nodes.push(node);
      nodeIdByCell.set(entry.key, node.id);
    }
  }
  return nodes;
}

function edgeModeFor(nodeById, fromId, toId) {
  for (const id of [fromId, toId]) {
    const kind = nodeById.get(id)?.kind;
    if (kind === 'ferry') return { mode: 'ferry', crossingNodeId: id };
    if (kind === 'bridge') return { mode: 'bridge', crossingNodeId: id };
  }
  return { mode: 'road', crossingNodeId: null };
}

/** 道路边：只认所属 region 的 roadEdges；端点必须已解析成节点，否则记 gap 且不出边。 */
function buildRoadEdges(regionViews, nodeIdByCell, nodeById, gaps) {
  const edges = [];
  const seen = new Set();
  let declared = 0;
  for (const view of regionViews) {
    for (const [a, b] of view.roadEdges) {
      declared += 1;
      const fromEntry = view.byKey.get(`${a[0]},${a[1]}`);
      const toEntry = view.byKey.get(`${b[0]},${b[1]}`);
      const fromId = fromEntry ? nodeIdByCell.get(fromEntry.key) ?? null : null;
      const toId = toEntry ? nodeIdByCell.get(toEntry.key) ?? null : null;
      if (!fromId || !toId) {
        gaps.push({
          code: 'roadEdgeEndpointUnresolved',
          regionId: view.regionId,
          from: a,
          to: b,
          message: '道路端点所在格既无城市也无关隘/渡口/岔路可落名'
        });
        continue;
      }
      if (fromId === toId) {
        gaps.push({ code: 'roadEdgeSelfLoop', regionId: view.regionId, from: a, to: b });
        continue;
      }
      const pairKey = fromId <= toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const { mode, crossingNodeId } = edgeModeFor(nodeById, fromId, toId);
      const from = nodeById.get(fromId);
      const to = nodeById.get(toId);
      const edge = {
        id: `edge.${fromId}__${toId}`,
        from: fromId,
        to: toId,
        mode,
        cost: Math.round(Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y)),
        source: 'auto'
      };
      if (crossingNodeId) edge.conditions = { crossingNodeId };
      edges.push(edge);
    }
  }
  if (declared === 0) {
    gaps.push({ code: 'noRoadEdges', message: 'region 未声明 roadEdges，自动层不会产出任何道路边' });
  }
  return edges;
}

/**
 * 抽取自动逻辑层。
 * @param {Object} project - game.project.json 结构（只读 worldMap / variables.cityStates）
 * @param {Object} [options]
 * @param {number} [options.revision=1] - 自动层版本号（差异面板缓存键）
 * @param {boolean} [options.deriveJunctions=true] - 是否推导岔路节点
 * @returns {{nodes:Array, edges:Array, revision:number, gaps:Array}}
 */
export function extractWorldLogic(project, { revision = 1, deriveJunctions = true } = {}) {
  const gaps = [];
  const regions = Array.isArray(project?.worldMap?.regions) ? project.worldMap.regions : [];
  const regionViews = regions.map((region, index) => indexRegion(region, index));
  const nodeIdByCell = new Map();

  const nodes = [
    ...buildCityNodes(project, regionViews, nodeIdByCell, gaps),
    ...buildPoiNodes(regionViews, nodeIdByCell)
  ];
  if (deriveJunctions) {
    nodes.push(...buildJunctionNodes(regionViews, nodeIdByCell));
  }
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edges = buildRoadEdges(regionViews, nodeIdByCell, nodeById, gaps);

  return {
    nodes,
    edges,
    revision: Number(revision) || 1,
    gaps
  };
}

export default extractWorldLogic;

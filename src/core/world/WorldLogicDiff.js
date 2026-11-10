/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-11
 ************************************************************/

/**
 * WorldLogicDiff - 自动层 vs 人工修正层的差异模型（模块 4 · 4D）
 *
 * 分层语义（用户 2026-11-11 定稿）：
 * 1. 自动层只由地图抽取生成、可整体重抽、不可手改、**不参与运行时判定**；
 * 2. 人工修正层（`worldLogic.nodes/edges`）是唯一事实源，运行时只读这一层；
 * 3. 未确认的自动结果一律不生效——本模块只产差异与「采纳」动作，由编辑器逐条写入人工层。
 *
 * 本模块是纯函数：不碰 DOM、不写存档、不判定通行（判定仍只走 WorldRouteLayer）。
 */

import { resolveEdgeConditions, resolveEdgeCost } from './WorldRouteLayer.js';

/** 三类差异（顺序即面板展示顺序）。 */
export const DIFF_CATEGORIES = Object.freeze(['autoOnly', 'manualOnly', 'changed']);

export const DIFF_CATEGORY_LABELS = Object.freeze({
  autoOnly: '新增待确认（自动有 / 人工无）',
  manualOnly: '地图上没了（人工有 / 自动无）',
  changed: '两边都有但不一致'
});

/** 节点参与差异判定的字段（name 只展示，不参与判定，避免自动命名制造噪声）。 */
export const NODE_DIFF_FIELDS = Object.freeze([
  'kind', 'position.x', 'position.y', 'ownerFactionId', 'level', 'tollRate', 'ref.id'
]);

/** 边参与差异判定的字段（from/to 即连通关系）。 */
export const EDGE_DIFF_FIELDS = Object.freeze([
  'from', 'to', 'mode', 'cost', 'bidirectional',
  'conditions.crossingNodeId', 'conditions.factionIds',
  'conditions.blockedUntilDay', 'conditions.terrainBlocked'
]);

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function normalizeLogic(logic) {
  const next = clone(logic) || {};
  if (!Array.isArray(next.nodes)) next.nodes = [];
  if (!Array.isArray(next.edges)) next.edges = [];
  return next;
}

function normalizeLayer(layer) {
  if (!layer) return { nodes: [], edges: [], revision: 0 };
  return {
    nodes: Array.isArray(layer.nodes) ? layer.nodes : [],
    edges: Array.isArray(layer.edges) ? layer.edges : [],
    revision: Number(layer.revision) || 0
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function readNodeField(node, field) {
  if (!node) return null;
  switch (field) {
    case 'kind': return node.kind ?? null;
    case 'position.x': return numberOrNull(node.position?.x);
    case 'position.y': return numberOrNull(node.position?.y);
    case 'ownerFactionId': return node.ownerFactionId ?? null;
    case 'level': return numberOrNull(node.level);
    case 'tollRate': return numberOrNull(node.tollRate);
    case 'ref.id': return node.ref?.id ?? null;
    default: return node[field] ?? null;
  }
}

function mapEndpoint(id, endpointMap) {
  if (id === null || id === undefined) return null;
  if (endpointMap && endpointMap.has(String(id))) return endpointMap.get(String(id));
  return String(id);
}

function readEdgeField(edge, field, endpointMap = null, normalizeDirection = false) {
  if (!edge) return null;
  if (field === 'from' || field === 'to') {
    const a = mapEndpoint(edge.from, endpointMap);
    const b = mapEndpoint(edge.to, endpointMap);
    // 双向边不区分 from/to 方向：比较时统一按字典序，单向边保留原方向。
    const pair = normalizeDirection && edge.bidirectional !== false ? [a, b].sort() : [a, b];
    return field === 'from' ? pair[0] : pair[1];
  }
  if (field === 'mode') return edge.mode ?? null;
  if (field === 'cost') return numberOrNull(resolveEdgeCost(edge));
  if (field === 'bidirectional') return edge.bidirectional === false ? false : true;
  if (field.startsWith('conditions.')) {
    const key = field.slice('conditions.'.length);
    const value = resolveEdgeConditions(edge)[key];
    return value === undefined ? null : value;
  }
  return edge[field] ?? null;
}

function nodeLabel(node) {
  if (!node) return '';
  return node.name ? `${node.name}` : String(node.id ?? '');
}

/** 位置差 ≤1px 视为同一节点（抽取器与手工图对齐时允许小数误差）。 */
function isSamePosition(a, b) {
  const ax = numberOrNull(a?.position?.x);
  const ay = numberOrNull(a?.position?.y);
  const bx = numberOrNull(b?.position?.x);
  const by = numberOrNull(b?.position?.y);
  if (ax === null || ay === null || bx === null || by === null) return false;
  return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;
}

function edgeEndpointKey(from, to) {
  const a = from === null || from === undefined ? '' : String(from);
  const b = to === null || to === undefined ? '' : String(to);
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 计算三类差异。
 * @param {Object|null} autoLayer - { nodes, edges, revision }
 * @param {Object|null} manualLogic - worldLogic 人工层
 * @param {Object} [options]
 * @param {string[]} [options.ignoredKeys] - 本次忽略的差异 key
 * @param {string[]} [options.resolvedKeys] - 本次已「保留人工」的差异 key
 * @returns {{categories:Object, counts:Object, total:number, hidden:number, autoRevision:number}}
 */
export function buildDiff(autoLayer, manualLogic, { ignoredKeys = [], resolvedKeys = [] } = {}) {
  const auto = normalizeLayer(autoLayer);
  const manual = normalizeLogic(manualLogic);
  const hiddenKeys = new Set([...ignoredKeys, ...resolvedKeys].map(String));

  // ── 节点匹配：id → 位置 ───────────────────────────────
  const manualNodes = manual.nodes;
  const manualNodeById = new Map(manualNodes.map(node => [String(node.id), node]));
  const matchedManualNodeIds = new Set();
  const nodePairs = [];
  const endpointMap = new Map();

  for (const autoNode of auto.nodes) {
    const manualNode = manualNodeById.get(String(autoNode.id));
    if (!manualNode) continue;
    nodePairs.push({ auto: autoNode, manual: manualNode });
    matchedManualNodeIds.add(String(manualNode.id));
    endpointMap.set(String(autoNode.id), String(manualNode.id));
  }
  for (const autoNode of auto.nodes) {
    if (endpointMap.has(String(autoNode.id))) continue;
    const manualNode = manualNodes.find(node => (
      !matchedManualNodeIds.has(String(node.id))
      && String(node.kind) === String(autoNode.kind)
      && isSamePosition(node, autoNode)
    ));
    if (!manualNode) continue;
    nodePairs.push({ auto: autoNode, manual: manualNode });
    matchedManualNodeIds.add(String(manualNode.id));
    endpointMap.set(String(autoNode.id), String(manualNode.id));
  }

  const categories = { autoOnly: [], manualOnly: [], changed: [] };

  for (const pair of nodePairs) {
    const fields = NODE_DIFF_FIELDS
      .map(field => ({
        name: field,
        autoValue: displayValue(readNodeField(pair.auto, field)),
        manualValue: displayValue(readNodeField(pair.manual, field))
      }))
      .filter(field => !sameValue(field.autoValue, field.manualValue));
    if (fields.length === 0) continue;
    categories.changed.push({
      key: `node:${pair.manual.id}`,
      category: 'changed',
      target: 'node',
      id: String(pair.manual.id),
      label: nodeLabel(pair.manual),
      auto: pair.auto,
      manual: pair.manual,
      fields
    });
  }

  for (const autoNode of auto.nodes) {
    if (endpointMap.has(String(autoNode.id))) continue;
    const fields = NODE_DIFF_FIELDS.map(field => ({
      name: field,
      autoValue: displayValue(readNodeField(autoNode, field)),
      manualValue: null
    }));
    categories.autoOnly.push({
      key: `node:auto:${autoNode.id}`,
      category: 'autoOnly',
      target: 'node',
      id: String(autoNode.id),
      label: nodeLabel(autoNode),
      auto: autoNode,
      manual: null,
      fields
    });
  }

  for (const manualNode of manualNodes) {
    if (matchedManualNodeIds.has(String(manualNode.id))) continue;
    const fields = NODE_DIFF_FIELDS.map(field => ({
      name: field,
      autoValue: null,
      manualValue: displayValue(readNodeField(manualNode, field))
    }));
    categories.manualOnly.push({
      key: `node:manual:${manualNode.id}`,
      category: 'manualOnly',
      target: 'node',
      id: String(manualNode.id),
      label: nodeLabel(manualNode),
      auto: null,
      manual: manualNode,
      fields
    });
  }

  // ── 边匹配：id → 端点（经节点映射）─────────────────────
  const manualEdges = manual.edges;
  const manualEdgeById = new Map(manualEdges.map(edge => [String(edge.id), edge]));
  const matchedManualEdgeIds = new Set();
  const edgePairs = [];

  for (const autoEdge of auto.edges) {
    const manualEdge = manualEdgeById.get(String(autoEdge.id));
    if (!manualEdge) continue;
    edgePairs.push({ auto: autoEdge, manual: manualEdge });
    matchedManualEdgeIds.add(String(manualEdge.id));
  }
  for (const autoEdge of auto.edges) {
    if (edgePairs.some(pair => pair.auto === autoEdge)) continue;
    const key = edgeEndpointKey(mapEndpoint(autoEdge.from, endpointMap), mapEndpoint(autoEdge.to, endpointMap));
    const manualEdge = manualEdges.find(edge => (
      !matchedManualEdgeIds.has(String(edge.id))
      && edgeEndpointKey(edge.from, edge.to) === key
    ));
    if (!manualEdge) continue;
    edgePairs.push({ auto: autoEdge, manual: manualEdge });
    matchedManualEdgeIds.add(String(manualEdge.id));
  }

  for (const pair of edgePairs) {
    const normalizeDirection = pair.auto.bidirectional !== false && pair.manual.bidirectional !== false;
    const fields = EDGE_DIFF_FIELDS
      .map(field => ({
        name: field,
        autoValue: displayValue(readEdgeField(pair.auto, field, endpointMap, normalizeDirection)),
        manualValue: displayValue(readEdgeField(pair.manual, field, null, normalizeDirection))
      }))
      .filter(field => !sameValue(field.autoValue, field.manualValue));
    if (fields.length === 0) continue;
    categories.changed.push({
      key: `edge:${pair.manual.id}`,
      category: 'changed',
      target: 'edge',
      id: String(pair.manual.id),
      label: `${pair.manual.from} → ${pair.manual.to}`,
      auto: pair.auto,
      manual: pair.manual,
      endpointMap: new Map(endpointMap),
      fields
    });
  }

  for (const autoEdge of auto.edges) {
    if (edgePairs.some(pair => pair.auto === autoEdge)) continue;
    const fields = EDGE_DIFF_FIELDS.map(field => ({
      name: field,
      autoValue: displayValue(readEdgeField(autoEdge, field, endpointMap)),
      manualValue: null
    }));
    categories.autoOnly.push({
      key: `edge:auto:${autoEdge.id}`,
      category: 'autoOnly',
      target: 'edge',
      id: String(autoEdge.id),
      label: `${mapEndpoint(autoEdge.from, endpointMap)} → ${mapEndpoint(autoEdge.to, endpointMap)}`,
      auto: autoEdge,
      manual: null,
      endpointMap: new Map(endpointMap),
      fields
    });
  }

  for (const manualEdge of manualEdges) {
    if (matchedManualEdgeIds.has(String(manualEdge.id))) continue;
    const fields = EDGE_DIFF_FIELDS.map(field => ({
      name: field,
      autoValue: null,
      manualValue: displayValue(readEdgeField(manualEdge, field))
    }));
    categories.manualOnly.push({
      key: `edge:manual:${manualEdge.id}`,
      category: 'manualOnly',
      target: 'edge',
      id: String(manualEdge.id),
      label: `${manualEdge.from} → ${manualEdge.to}`,
      auto: null,
      manual: manualEdge,
      endpointMap: new Map(endpointMap),
      fields
    });
  }

  let hidden = 0;
  for (const category of DIFF_CATEGORIES) {
    categories[category] = categories[category].filter(entry => {
      if (!hiddenKeys.has(entry.key)) return true;
      hidden += 1;
      return false;
    });
  }

  const counts = {
    autoOnly: categories.autoOnly.length,
    manualOnly: categories.manualOnly.length,
    changed: categories.changed.length
  };
  return {
    categories,
    counts,
    total: counts.autoOnly + counts.manualOnly + counts.changed,
    hidden,
    autoRevision: auto.revision
  };
}

function cleanNodeForManual(node, revision) {
  const next = clone(node) || {};
  next.id = String(next.id);
  next.source = 'manual';
  if (revision) next.autoRevision = revision;
  return next;
}

function cleanEdgeForManual(edge, revision) {
  const next = clone(edge) || {};
  next.id = String(next.id);
  next.source = 'manual';
  if (revision) next.autoRevision = revision;
  return next;
}

/**
 * 采纳一条差异写回人工层（返回新 logic，不原地修改）。
 * - autoOnly：追加自动条目；
 * - changed：用自动值覆盖人工条目的比较字段；
 * - manualOnly：删除人工条目（节点级联删除关联边）。
 * @returns {{ok:boolean, logic?:Object, code?:string, missing?:string[], removedEdgeIds?:string[]}}
 */
export function adoptAuto(autoLayer, manualLogic, entry) {
  if (!entry || !entry.category) return { ok: false, code: 'unknownEntry' };
  const revision = normalizeLayer(autoLayer).revision;
  const logic = normalizeLogic(manualLogic);

  if (entry.category === 'manualOnly') {
    if (entry.target === 'node') {
      const nodeId = String(entry.id);
      const before = logic.nodes.length;
      logic.nodes = logic.nodes.filter(node => String(node.id) !== nodeId);
      if (logic.nodes.length === before) return { ok: false, code: 'entryMissing' };
      const removedEdgeIds = [];
      logic.edges = logic.edges.filter(edge => {
        const hit = String(edge.from) === nodeId || String(edge.to) === nodeId;
        if (hit) removedEdgeIds.push(String(edge.id));
        return !hit;
      });
      return { ok: true, logic, removedEdgeIds };
    }
    const edgeId = String(entry.id);
    const before = logic.edges.length;
    logic.edges = logic.edges.filter(edge => String(edge.id) !== edgeId);
    if (logic.edges.length === before) return { ok: false, code: 'entryMissing' };
    return { ok: true, logic, removedEdgeIds: [edgeId] };
  }

  if (entry.category === 'autoOnly') {
    if (entry.target === 'node') {
      if (logic.nodes.some(node => String(node.id) === String(entry.auto.id))) {
        return { ok: false, code: 'duplicateId' };
      }
      logic.nodes.push(cleanNodeForManual(entry.auto, revision));
      return { ok: true, logic };
    }
    const endpointMap = entry.endpointMap instanceof Map ? entry.endpointMap : new Map();
    const from = mapEndpoint(entry.auto.from, endpointMap);
    const to = mapEndpoint(entry.auto.to, endpointMap);
    const nodeIds = new Set(logic.nodes.map(node => String(node.id)));
    const missing = [from, to].filter(id => !nodeIds.has(String(id)));
    if (missing.length > 0) return { ok: false, code: 'missingEndpoint', missing };
    if (logic.edges.some(edge => String(edge.id) === String(entry.auto.id))) {
      return { ok: false, code: 'duplicateId' };
    }
    const edge = cleanEdgeForManual(entry.auto, revision);
    edge.from = String(from);
    edge.to = String(to);
    logic.edges.push(edge);
    return { ok: true, logic };
  }

  if (entry.category === 'changed') {
    const source = entry.auto;
    if (!source) return { ok: false, code: 'unknownEntry' };
    if (entry.target === 'node') {
      const node = logic.nodes.find(item => String(item.id) === String(entry.manual.id));
      if (!node) return { ok: false, code: 'entryMissing' };
      for (const field of ['kind', 'position', 'ownerFactionId', 'level', 'tollRate', 'ref']) {
        if (source[field] !== undefined) node[field] = clone(source[field]);
        else delete node[field];
      }
      node.source = 'manual';
      if (revision) node.autoRevision = revision;
      return { ok: true, logic };
    }
    const edge = logic.edges.find(item => String(item.id) === String(entry.manual.id));
    if (!edge) return { ok: false, code: 'entryMissing' };
    const endpointMap = entry.endpointMap instanceof Map ? entry.endpointMap : new Map();
    const from = mapEndpoint(source.from, endpointMap);
    const to = mapEndpoint(source.to, endpointMap);
    const nodeIds = new Set(logic.nodes.map(node => String(node.id)));
    const missing = [from, to].filter(id => !nodeIds.has(String(id)));
    if (missing.length > 0) return { ok: false, code: 'missingEndpoint', missing };
    edge.from = String(from);
    edge.to = String(to);
    if (source.mode !== undefined) edge.mode = source.mode;
    if (source.cost !== undefined) edge.cost = source.cost;
    else if (source.weight !== undefined) edge.cost = source.weight;
    else delete edge.cost;
    delete edge.weight;
    edge.bidirectional = source.bidirectional !== false;
    const conditions = resolveEdgeConditions(source);
    if (Object.keys(conditions).length > 0) edge.conditions = clone(conditions);
    else delete edge.conditions;
    edge.source = 'manual';
    if (revision) edge.autoRevision = revision;
    return { ok: true, logic };
  }

  return { ok: false, code: 'unknownCategory' };
}

/**
 * 单类「全部采纳」——只处理一个类别，绝不跨类。
 * @returns {{ok:boolean, logic:Object, applied:string[], skipped:Array<{key:string,code:string}>}}
 */
export function adoptAllOfCategory(autoLayer, manualLogic, category, entries = []) {
  let logic = normalizeLogic(manualLogic);
  const applied = [];
  const skipped = [];
  const list = entries
    .filter(entry => entry?.category === category)
    .sort((a, b) => (a.target === b.target ? 0 : (a.target === 'node' ? -1 : 1)));
  for (const entry of list) {
    const result = adoptAuto(autoLayer, logic, entry);
    if (result.ok) {
      logic = result.logic;
      applied.push(entry.key);
    } else {
      skipped.push({ key: entry.key, code: result.code || 'failed' });
    }
  }
  return { ok: true, logic, applied, skipped };
}

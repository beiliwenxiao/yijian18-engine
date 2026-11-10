/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WorldRouteLayer - 世界逻辑路径层 + 通行色投影（模块 4 · 4A）
 *
 * 设计依据：.trae/specs/military-supply-strategy/m4-implementation/spec.md §3
 *
 * 硬约束（改动前先读）：
 * 1. 通行判定只有一处：导出的 `evaluateEdgePassability`。本类内部与派生投影
 *    （buildCellOverlay / buildEdgeLines）以及 UI/编辑器一律只读 `getSnapshot()`，
 *    不得另写阵营/关隘/封路判断。
 * 2. 没有第二份缓存：动态因素（敌占、关隘易主、道路被烧、剧情封路）只能经
 *    `invalidate(reason)` 触发一次重算；快照以 `revision` 标识，UI 缓存键 = revision。
 * 3. 本模块不依赖 canvas / DOM / 实体 / Blackboard，可直接单测（纯数据 + 纯函数）。
 *
 * 数据来源：game.project.json `worldLogic`（nodes / edges / conditions / combat / tariff）。
 * 与 `WORLD_MAP_TERRAINS`（mountain/yellowRiver/forest/plain）**无数据依赖**：
 * 地形只是表现底图，`edge.mode` 才是路径属性。
 */

/** 逻辑节点类别（city 城池 / pass 关隘 / bridge 桥 / ferry 渡口 / junction 岔路 / camp 营寨）。 */
export const ROUTE_NODE_KINDS = Object.freeze(['city', 'pass', 'bridge', 'ferry', 'junction', 'camp']);

/** 边形态（road 官道 / bridge 桥面 / ferry 渡船 / mountainPath 山径 / waterway 水路）。 */
export const ROUTE_EDGE_MODES = Object.freeze(['road', 'bridge', 'ferry', 'mountainPath', 'waterway']);

/** 可作 `crossingNodeId` 的节点类别（过河/过关必须控制该节点）。 */
export const ROUTE_CROSSING_KINDS = Object.freeze(['bridge', 'ferry', 'pass']);

/**
 * 来源标记（4B 预留，spec §5.1）：只用于未来「重抽只覆盖 auto 层、保留 manual 修正」，
 * **不参与任何通行判定**。节点/边缺省视为 manual。
 */
export const ROUTE_SOURCES = Object.freeze(['auto', 'manual']);

/** 通行状态（格覆盖与边线共用；优先级见 ROUTE_STATUS_SEVERITY）。 */
export const ROUTE_STATUS = Object.freeze({
  PASSABLE: 'passable',
  HOSTILE: 'hostile',
  CLOSED: 'closed',
  TERRAIN: 'terrain',
  INVALID: 'invalid',
  NO_ROUTE: 'noRoute'
});

/**
 * 一格被多条边覆盖时取最高严重度（spec §3.4）：
 * terrain(4) > closed(3) > hostile(2) > passable(1) > noRoute(0)；
 * invalid(5) 是数据错误，优先级最高以便在编辑器里一眼看见。
 */
export const ROUTE_STATUS_SEVERITY = Object.freeze({
  noRoute: 0,
  passable: 1,
  hostile: 2,
  closed: 3,
  terrain: 4,
  invalid: 5
});

const DEFAULT_CHUNK_WIDTH = 1280;
const DEFAULT_CHUNK_HEIGHT = 720;

const isFiniteNumber = value => Number.isFinite(Number(value)) && value !== null && value !== '';

function normalizePosition(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function normalizeCost(value) {
  const cost = Number(value);
  return Number.isFinite(cost) && cost > 0 ? cost : 1;
}

/**
 * 边权重口径（唯一）：规范键 `cost`，兼容 4A 初版内容里的别名 `weight`。
 * 编辑器改权重时一律写 `cost` 并删除 `weight`，避免双源。
 */
export function resolveEdgeCost(edge) {
  return normalizeCost(edge?.cost ?? edge?.weight);
}

/**
 * 边通行条件口径（唯一）：规范位置 `edge.conditions`，兼容早期把 `crossingNodeId`
 * 写在边顶层的写法。判定/校验/编辑器共用本函数，不各自拼装。
 */
export function resolveEdgeConditions(edge) {
  const conditions = edge?.conditions && typeof edge.conditions === 'object' ? edge.conditions : {};
  const merged = { ...conditions };
  for (const key of ['crossingNodeId', 'factionIds', 'blockedUntilDay', 'terrainBlocked']) {
    if (merged[key] == null && edge?.[key] != null) merged[key] = edge[key];
  }
  return merged;
}

/** 来源标记归一：未知值按 manual 处理（只用于标注，不影响通行）。 */
export function resolveRouteSource(value) {
  return ROUTE_SOURCES.includes(value) ? value : 'manual';
}

/**
 * 全工程唯一的通行判定函数（spec §3.3）。
 *
 * @param {Object} edge - worldLogic.edges[] 的一条边
 * @param {Object} ctx
 * @param {number} [ctx.day=1] - 当前游戏日（blockedUntilDay 比较）
 * @param {string|null} [ctx.moverFactionId] - 行军方阵营
 * @param {Map<string,string|null>|null} [ctx.ownership] - nodeId → 控制方阵营（已解析，含运行态）
 * @param {Map<string,Object>|null} [ctx.nodes] - nodeId → 节点定义（查 kind）
 * @returns {{passable:boolean, status:string, reasons:string[]}}
 */
export function evaluateEdgePassability(edge, {
  day = 1,
  moverFactionId = null,
  ownership = null,
  nodes = null
} = {}) {
  if (!edge || typeof edge !== 'object') {
    return { passable: false, status: ROUTE_STATUS.INVALID, reasons: ['edgeMissing'] };
  }
  const conditions = resolveEdgeConditions(edge);
  const currentDay = Number.isFinite(Number(day)) ? Number(day) : 1;

  // ① 永久地形阻隔（深灰·无路，不参与任何绕行）
  if (conditions.terrainBlocked === true) {
    return { passable: false, status: ROUTE_STATUS.TERRAIN, reasons: ['terrainBlocked'] };
  }

  // ② 剧情封路（橙·等到解封日）
  if (isFiniteNumber(conditions.blockedUntilDay) && Number(conditions.blockedUntilDay) > currentDay) {
    return {
      passable: false,
      status: ROUTE_STATUS.CLOSED,
      reasons: [`blockedUntilDay:${Number(conditions.blockedUntilDay)}`]
    };
  }

  // ③ 阵营白名单（红·敌情挡）
  if (Array.isArray(conditions.factionIds) && conditions.factionIds.length > 0) {
    const allowed = conditions.factionIds.map(id => String(id));
    if (!moverFactionId || !allowed.includes(String(moverFactionId))) {
      return { passable: false, status: ROUTE_STATUS.HOSTILE, reasons: ['factionNotAllowed'] };
    }
  }

  const ownerOf = nodeId => {
    if (ownership && ownership.has(nodeId)) return ownership.get(nodeId);
    const node = nodes?.get?.(nodeId);
    return node?.ownerFactionId != null ? String(node.ownerFactionId) : null;
  };
  const kindOf = nodeId => nodes?.get?.(nodeId)?.kind || null;

  // ④ 过河/过关：必须控制该节点（中立可过，收税见 §8）
  if (conditions.crossingNodeId != null) {
    const crossingId = String(conditions.crossingNodeId);
    const kind = kindOf(crossingId);
    if (!kind || !ROUTE_CROSSING_KINDS.includes(kind)) {
      return { passable: false, status: ROUTE_STATUS.INVALID, reasons: [`crossingNodeInvalid:${crossingId}`] };
    }
    const owner = ownerOf(crossingId);
    if (owner != null && moverFactionId != null && String(owner) !== String(moverFactionId)) {
      return {
        passable: false,
        status: ROUTE_STATUS.HOSTILE,
        reasons: [`crossingHeldByEnemy:${crossingId}`]
      };
    }
  }

  // ⑤ 端点关隘被敌方控制（以 pass 节点为门户的边）
  for (const endpointId of [edge.from, edge.to]) {
    if (endpointId == null) continue;
    const id = String(endpointId);
    if (kindOf(id) !== 'pass') continue;
    const owner = ownerOf(id);
    if (owner != null && moverFactionId != null && String(owner) !== String(moverFactionId)) {
      return { passable: false, status: ROUTE_STATUS.HOSTILE, reasons: [`passBlocked:${id}`] };
    }
  }

  return { passable: true, status: ROUTE_STATUS.PASSABLE, reasons: [] };
}

/**
 * worldLogic 结构校验（编辑器保存前与 M4Content 测试共用；不含通行判定）。
 * @returns {{ok:boolean, errors:Array<{code:string,id?:string,message:string}>, warnings:Array}}
 */
export function validateWorldLogic(logic, { knownFactions = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!logic || typeof logic !== 'object') {
    return { ok: false, errors: [{ code: 'logicMissing', message: 'worldLogic 缺失' }], warnings };
  }
  const rawNodes = Array.isArray(logic.nodes) ? logic.nodes : [];
  const rawEdges = Array.isArray(logic.edges) ? logic.edges : [];
  if (rawNodes.length === 0) errors.push({ code: 'nodesEmpty', message: 'worldLogic.nodes 为空' });

  const nodeIds = new Set();
  const nodesById = new Map();
  for (const node of rawNodes) {
    if (!node || typeof node !== 'object' || !node.id) {
      errors.push({ code: 'nodeIdRequired', message: '节点缺少 id' });
      continue;
    }
    const id = String(node.id);
    if (nodeIds.has(id)) errors.push({ code: 'duplicateNodeId', id, message: `节点 id 重复：${id}` });
    nodeIds.add(id);
    nodesById.set(id, node);
    if (!ROUTE_NODE_KINDS.includes(node.kind)) {
      errors.push({ code: 'unknownNodeKind', id, message: `未知节点类别：${node.kind}` });
    }
    if (node.source != null && !ROUTE_SOURCES.includes(node.source)) {
      warnings.push({ code: 'unknownRouteSource', id, message: `节点 ${id} source 未知（auto|manual）：${node.source}` });
    }
    if (node.autoRevision != null && !Number.isFinite(Number(node.autoRevision))) {
      warnings.push({ code: 'invalidAutoRevision', id, message: `节点 ${id} autoRevision 必须是数字` });
    }
    if (!normalizePosition(node.position)) {
      errors.push({ code: 'nodePositionInvalid', id, message: `节点 ${id} position 非法` });
    }
    if (node.cell && (!isFiniteNumber(node.cell.row) || !isFiniteNumber(node.cell.col))) {
      warnings.push({ code: 'nodeCellInvalid', id, message: `节点 ${id} cell 非法，运行时按 position 反推` });
    }
    if (node.tollRate != null && node.kind !== 'pass') {
      warnings.push({ code: 'tollOnNonPass', id, message: `节点 ${id} 非 pass 却配置 tollRate` });
    }
    if (knownFactions && node.ownerFactionId != null && !knownFactions.has(String(node.ownerFactionId))) {
      warnings.push({ code: 'unknownFaction', id, message: `节点 ${id} 归属阵营未登记：${node.ownerFactionId}` });
    }
  }

  const edgeIds = new Set();
  for (const edge of rawEdges) {
    if (!edge || typeof edge !== 'object' || !edge.id) {
      errors.push({ code: 'edgeIdRequired', message: '边缺少 id' });
      continue;
    }
    const id = String(edge.id);
    if (edgeIds.has(id)) errors.push({ code: 'duplicateEdgeId', id, message: `边 id 重复：${id}` });
    edgeIds.add(id);
    if (!nodeIds.has(String(edge.from))) {
      errors.push({ code: 'edgeFromUnknown', id, message: `边 ${id} 起点不存在：${edge.from}` });
    }
    if (!nodeIds.has(String(edge.to))) {
      errors.push({ code: 'edgeToUnknown', id, message: `边 ${id} 终点不存在：${edge.to}` });
    }
    if (String(edge.from) === String(edge.to)) {
      errors.push({ code: 'edgeSelfLoop', id, message: `边 ${id} 起终点相同` });
    }
    if (edge.mode != null && !ROUTE_EDGE_MODES.includes(edge.mode)) {
      errors.push({ code: 'unknownEdgeMode', id, message: `边 ${id} mode 非法：${edge.mode}` });
    }
    if (edge.source != null && !ROUTE_SOURCES.includes(edge.source)) {
      warnings.push({ code: 'unknownRouteSource', id, message: `边 ${id} source 未知（auto|manual）：${edge.source}` });
    }
    if (edge.autoRevision != null && !Number.isFinite(Number(edge.autoRevision))) {
      warnings.push({ code: 'invalidAutoRevision', id, message: `边 ${id} autoRevision 必须是数字` });
    }
    if (edge.cost != null && (!Number.isFinite(Number(edge.cost)) || Number(edge.cost) <= 0)) {
      errors.push({ code: 'edgeCostInvalid', id, message: `边 ${id} cost 必须为正数` });
    }
    if (edge.cost == null && edge.weight != null
      && (!Number.isFinite(Number(edge.weight)) || Number(edge.weight) <= 0)) {
      errors.push({ code: 'edgeCostInvalid', id, message: `边 ${id} weight 必须为正数` });
    }
    const conditions = resolveEdgeConditions(edge);
    if (conditions?.crossingNodeId != null) {
      const crossingId = String(conditions.crossingNodeId);
      const crossing = nodesById.get(crossingId);
      if (!crossing) {
        errors.push({ code: 'crossingNodeUnknown', id, message: `边 ${id} crossingNodeId 不存在：${crossingId}` });
      } else if (!ROUTE_CROSSING_KINDS.includes(crossing.kind)) {
        errors.push({ code: 'crossingNodeInvalid', id, message: `边 ${id} crossingNodeId 类别不可过关：${crossing.kind}` });
      }
    }
    if (conditions?.factionIds != null && !Array.isArray(conditions.factionIds)) {
      errors.push({ code: 'factionIdsInvalid', id, message: `边 ${id} conditions.factionIds 必须是数组` });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 世界逻辑路径层：唯一权威（数据 + 判定 + 快照 + 图算法 + 派生投影）。
 */
export class WorldRouteLayer {
  /**
   * @param {Object} [options]
   * @param {Object|null} [options.logic] - game.project.json 的 worldLogic
   * @param {Function} [options.getDay] - () => number
   * @param {Function} [options.getOwnership] - (nodeId) => factionId|null（运行态覆盖，如 armyStates）
   * @param {string|null} [options.moverFactionId] - 行军方阵营（缺省 null）
   */
  constructor({
    logic = null,
    getDay = null,
    getOwnership = null,
    moverFactionId = null
  } = {}) {
    this._getDay = typeof getDay === 'function' ? getDay : (() => 1);
    this._getOwnership = typeof getOwnership === 'function' ? getOwnership : null;
    this.moverFactionId = moverFactionId != null ? String(moverFactionId) : null;

    /** @type {Map<string, Object>} nodeId → 节点定义 */
    this.nodes = new Map();
    /** @type {Map<string, Object>} edgeId → 边定义 */
    this.edges = new Map();
    this.combat = null;
    this.tariff = null;

    this._revision = 0;
    /** @type {Object|null} */
    this._snapshot = null;
    /** @type {{key:string, value:Object}|null} 派生投影按 revision+region 缓存 */
    this._previewCache = null;
    this._validation = { ok: false, errors: [], warnings: [] };

    if (logic) this.load(logic);
  }

  /**
   * 加载/替换 worldLogic（编辑器保存后调用）；返回校验结果。
   *
   * 注意：节点/边对象**按引用原样保留**（含 `source` / `autoRevision` 等未来扩展字段），
   * 这里不做字段级拷贝或白名单裁剪——否则自动抽取层与手工修正层的来源标记会丢失。
   * 通行口径统一走 `resolveEdgeCost` / `resolveEdgeConditions`，不在加载期改写内容。
   */
  load(logic) {
    this.nodes.clear();
    this.edges.clear();
    this.combat = logic?.combat && typeof logic.combat === 'object' ? logic.combat : null;
    this.tariff = logic?.tariff && typeof logic.tariff === 'object' ? logic.tariff : null;
    for (const node of Array.isArray(logic?.nodes) ? logic.nodes : []) {
      if (node?.id) this.nodes.set(String(node.id), node);
    }
    for (const edge of Array.isArray(logic?.edges) ? logic.edges : []) {
      if (edge?.id) this.edges.set(String(edge.id), edge);
    }
    this._validation = validateWorldLogic(logic);
    this.invalidate('load');
    return this._validation;
  }

  getValidation() {
    return this._validation;
  }

  /** 行军方阵营变化（换主角/接管他军）→ 重算一次快照。 */
  setMoverFaction(factionId) {
    const next = factionId != null ? String(factionId) : null;
    if (next === this.moverFactionId) return;
    this.moverFactionId = next;
    this.invalidate('moverFaction');
  }

  /** 动态因素变化（敌占/关隘易主/道路被烧/剧情封路）唯一入口：revision++ 并作废快照。 */
  invalidate(reason = 'manual') {
    this._revision += 1;
    this._snapshot = null;
    this._previewCache = null;
    this.lastInvalidateReason = String(reason);
    return this._revision;
  }

  get revision() {
    return this._revision;
  }

  getNode(nodeId) {
    return nodeId == null ? null : this.nodes.get(String(nodeId)) || null;
  }

  getEdge(edgeId) {
    return edgeId == null ? null : this.edges.get(String(edgeId)) || null;
  }

  /** nodeId → 控制方阵营（运行态优先，缺省定义归属）。 */
  getOwner(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return null;
    if (this._getOwnership) {
      const runtime = this._getOwnership(String(node.id));
      if (runtime !== undefined) return runtime == null ? null : String(runtime);
    }
    return node.ownerFactionId != null ? String(node.ownerFactionId) : null;
  }

  /**
   * 唯一快照出口：动态因素只在这里算一次（按 revision 缓存）。
   * @returns {{revision:number, day:number, moverFactionId:string|null,
   *            edges:Object, nodes:Object, adjacency:Map<string, Array<{edgeId:string,to:string,weight:number}>>}}
   */
  getSnapshot() {
    const day = Number(this._getDay());
    const currentDay = Number.isFinite(day) ? day : 1;
    if (this._snapshot && this._snapshot.day !== currentDay) this.invalidate('day');
    if (!this._snapshot) this._recompute(currentDay);
    return this._snapshot;
  }

  _recompute(day) {
    const ownership = new Map();
    for (const node of this.nodes.values()) {
      ownership.set(String(node.id), this.getOwner(String(node.id)));
    }

    const edges = {};
    const nodeEntries = {};
    const adjacency = new Map();
    for (const nodeId of this.nodes.keys()) adjacency.set(nodeId, []);

    for (const [edgeId, edge] of this.edges) {
      const result = evaluateEdgePassability(edge, {
        day,
        moverFactionId: this.moverFactionId,
        ownership,
        nodes: this.nodes
      });
      edges[edgeId] = { passable: result.passable, status: result.status, reasons: result.reasons };
      if (result.passable) {
        const from = String(edge.from);
        const to = String(edge.to);
        const weight = resolveEdgeCost(edge);
        adjacency.get(from)?.push({ edgeId, to, weight });
        if (edge.bidirectional !== false) adjacency.get(to)?.push({ edgeId, to: from, weight });
      }
    }

    for (const node of this.nodes.values()) {
      const owner = ownership.get(String(node.id)) ?? null;
      const hostile = owner != null && this.moverFactionId != null && owner !== this.moverFactionId;
      nodeEntries[String(node.id)] = {
        status: hostile ? ROUTE_STATUS.HOSTILE : ROUTE_STATUS.PASSABLE,
        ownerFactionId: owner,
        kind: node.kind || null
      };
    }

    this._snapshot = {
      revision: this._revision,
      day,
      moverFactionId: this.moverFactionId,
      edges,
      nodes: nodeEntries,
      adjacency
    };
  }

  /**
   * 图最短路（Dijkstra，走快照 adjacency，只含 passable 边）。
   * @param {string} fromId
   * @param {string} toId
   * @param {{avoidEdgeIds?: Iterable<string>|null}} [options]
   * @returns {{ok:boolean, code?:string, nodeIds?:string[], edgeIds?:string[], cost?:number}}
   */
  shortestPath(fromId, toId, { avoidEdgeIds = null } = {}) {
    const from = fromId != null ? String(fromId) : '';
    const to = toId != null ? String(toId) : '';
    if (!this.nodes.has(from)) return { ok: false, code: 'unknownNode', nodeId: from };
    if (!this.nodes.has(to)) return { ok: false, code: 'unknownNode', nodeId: to };
    if (from === to) return { ok: true, nodeIds: [from], edgeIds: [], cost: 0 };

    const snapshot = this.getSnapshot();
    const avoid = new Set(
      avoidEdgeIds == null
        ? []
        : Array.from(avoidEdgeIds).map(id => String(id))
    );

    const distances = new Map();
    const previous = new Map();
    const visited = new Set();
    for (const nodeId of this.nodes.keys()) distances.set(nodeId, Infinity);
    distances.set(from, 0);

    while (visited.size < this.nodes.size) {
      let current = null;
      let currentDistance = Infinity;
      for (const [nodeId, distance] of distances) {
        if (visited.has(nodeId) || distance >= currentDistance) continue;
        current = nodeId;
        currentDistance = distance;
      }
      if (current == null) break;
      if (current === to) break;
      visited.add(current);
      for (const step of snapshot.adjacency.get(current) || []) {
        if (avoid.has(step.edgeId)) continue;
        const next = currentDistance + step.weight;
        if (next < (distances.get(step.to) ?? Infinity)) {
          distances.set(step.to, next);
          previous.set(step.to, { nodeId: current, edgeId: step.edgeId });
        }
      }
    }

    if (!previous.has(to) && from !== to) return { ok: false, code: 'noPath', from, to };
    const nodeIds = [to];
    const edgeIds = [];
    let cursor = to;
    while (cursor !== from) {
      const step = previous.get(cursor);
      if (!step) return { ok: false, code: 'noPath', from, to };
      edgeIds.unshift(step.edgeId);
      nodeIds.unshift(step.nodeId);
      cursor = step.nodeId;
    }
    return { ok: true, nodeIds, edgeIds, cost: distances.get(to) ?? 0 };
  }

  /**
   * 最近节点（按世界坐标欧氏距离；编辑器吸附与「目标点 → 节点」解析共用）。
   * @returns {{nodeId:string, node:Object, distance:number}|null}
   */
  findNearestNode(position, { maxDistance = Infinity, kinds = null } = {}) {
    const point = normalizePosition(position);
    if (!point) return null;
    const allowed = Array.isArray(kinds) && kinds.length > 0 ? new Set(kinds) : null;
    let best = null;
    for (const node of this.nodes.values()) {
      if (allowed && !allowed.has(node.kind)) continue;
      const nodePosition = normalizePosition(node.position);
      if (!nodePosition) continue;
      const distance = Math.hypot(nodePosition.x - point.x, nodePosition.y - point.y);
      if (distance > maxDistance) continue;
      if (!best || distance < best.distance) best = { nodeId: String(node.id), node, distance };
    }
    return best;
  }

  /**
   * 指令目标 → 节点 id：支持 `nodeId` / `id` / 世界坐标 `{x,y}`（吸附最近节点）。
   * @returns {string|null}
   */
  resolveTarget(target, { maxSnapDistance = 240 } = {}) {
    if (target == null) return null;
    if (typeof target === 'string') return this.nodes.has(target) ? target : null;
    if (typeof target !== 'object') return null;
    const explicit = target.nodeId ?? target.logicNodeId ?? null;
    if (explicit != null) {
      const id = String(explicit);
      return this.nodes.has(id) ? id : null;
    }
    // 城池卡「攻击」别名：cityId（cityStates.id）→ 绑定它的逻辑节点。
    if (target.cityId != null) {
      const wanted = String(target.cityId);
      for (const node of this.nodes.values()) {
        if (String(node.id) === wanted) return String(node.id);
        if (node.ref?.id != null && String(node.ref.id) === wanted) return String(node.id);
      }
      return null;
    }
    if (target.id != null && this.nodes.has(String(target.id))) return String(target.id);
    const point = normalizePosition(target.position) || normalizePosition(target);
    if (!point) return null;
    return this.findNearestNode(point, { maxDistance: maxSnapDistance })?.nodeId || null;
  }

  /**
   * 派生投影：按格通行色（只读快照，不含任何通行判定）。
   * @param {Object} region - { rows, cols, chunkWidth, chunkHeight, bounds? }
   * @returns {Array<{row:number,col:number,status:string,reasons:string[],
   *                  edgeIds:string[],nodeIds:string[],kind:string|null,revision:number}>}
   */
  buildCellOverlay(region = {}) {
    const snapshot = this.getSnapshot();
    const cols = Math.max(0, Math.floor(Number(region.cols) || 0));
    const rows = Math.max(0, Math.floor(Number(region.rows) || 0));
    const metrics = {
      cols,
      rows,
      chunkWidth: Number(region.chunkWidth) > 0 ? Number(region.chunkWidth) : DEFAULT_CHUNK_WIDTH,
      chunkHeight: Number(region.chunkHeight) > 0 ? Number(region.chunkHeight) : DEFAULT_CHUNK_HEIGHT,
      left: Number(region.bounds?.left) || 0,
      top: Number(region.bounds?.top) || 0
    };
    if (cols === 0 || rows === 0) return [];

    const cells = new Map();
    const keyOf = (row, col) => `${row}:${col}`;
    const ensure = (row, col) => {
      const key = keyOf(row, col);
      let entry = cells.get(key);
      if (!entry) {
        entry = {
          row,
          col,
          status: ROUTE_STATUS.NO_ROUTE,
          severity: ROUTE_STATUS_SEVERITY.noRoute,
          reasons: [],
          edgeIds: [],
          nodeIds: [],
          kind: null
        };
        cells.set(key, entry);
      }
      return entry;
    };
    const apply = (entry, status, reasons = []) => {
      const severity = ROUTE_STATUS_SEVERITY[status] ?? 0;
      for (const reason of reasons) {
        if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      }
      if (severity > entry.severity) {
        entry.status = status;
        entry.severity = severity;
      }
    };

    const nodeCellOf = node => {
      if (node.cell && isFiniteNumber(node.cell.row) && isFiniteNumber(node.cell.col)) {
        return { row: Math.floor(Number(node.cell.row)), col: Math.floor(Number(node.cell.col)) };
      }
      const point = normalizePosition(node.position);
      if (!point) return null;
      return {
        row: Math.floor((point.y - metrics.top) / metrics.chunkHeight),
        col: Math.floor((point.x - metrics.left) / metrics.chunkWidth)
      };
    };
    const inside = cell => cell && cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols;

    for (const node of this.nodes.values()) {
      const cell = nodeCellOf(node);
      if (!inside(cell)) continue;
      const entry = ensure(cell.row, cell.col);
      entry.nodeIds.push(String(node.id));
      if (entry.kind == null) entry.kind = node.kind || null;
      apply(entry, snapshot.nodes[String(node.id)]?.status || ROUTE_STATUS.PASSABLE);
    }

    for (const [edgeId, edge] of this.edges) {
      const fromNode = this.getNode(edge.from);
      const toNode = this.getNode(edge.to);
      if (!fromNode || !toNode) continue;
      const fromCell = nodeCellOf(fromNode);
      const toCell = nodeCellOf(toNode);
      if (!inside(fromCell) || !inside(toCell)) continue;
      const status = snapshot.edges[edgeId]?.status || ROUTE_STATUS.INVALID;
      const reasons = snapshot.edges[edgeId]?.reasons || [];
      for (const cell of rasterizeCells(fromCell, toCell)) {
        if (!inside(cell)) continue;
        const entry = ensure(cell.row, cell.col);
        if (!entry.edgeIds.includes(edgeId)) entry.edgeIds.push(edgeId);
        apply(entry, status, reasons);
      }
    }

    const overlay = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const entry = cells.get(keyOf(row, col)) || ensure(row, col);
        delete entry.severity;
        overlay.push({ ...entry, revision: snapshot.revision });
      }
    }
    return overlay;
  }

  /**
   * 派生投影：边线（只读快照；虚线样式由 UI 决定）。
   * @returns {Array<{edgeId:string, from:string, to:string, fromPosition:Object|null,
   *                  toPosition:Object|null, mode:string|null, status:string,
   *                  reasons:string[], revision:number}>}
   */
  /**
   * 派生投影（数据 + 视图的唯一出口）：格覆盖 + 边线，按 `revision` 缓存。
   * UI/编辑器只调用本方法取色块数据，颜色映射留给表现层；这里不做第二次通行判定。
   */
  buildPreview(region = {}) {
    const snapshot = this.getSnapshot();
    const key = [
      snapshot.revision,
      Number(region.cols) || 0,
      Number(region.rows) || 0,
      Number(region.bounds?.left) || 0,
      Number(region.bounds?.top) || 0,
      Number(region.chunkWidth) || 0,
      Number(region.chunkHeight) || 0
    ].join(':');
    if (this._previewCache?.key === key) return this._previewCache.value;
    const value = {
      revision: snapshot.revision,
      overlay: this.buildCellOverlay(region),
      edges: this.buildEdgeLines()
    };
    this._previewCache = { key, value };
    return value;
  }

  buildEdgeLines() {
    const snapshot = this.getSnapshot();
    const lines = [];
    for (const [edgeId, edge] of this.edges) {
      const entry = snapshot.edges[edgeId];
      lines.push({
        edgeId,
        from: String(edge.from),
        to: String(edge.to),
        fromPosition: normalizePosition(this.getNode(edge.from)?.position),
        toPosition: normalizePosition(this.getNode(edge.to)?.position),
        mode: edge.mode || null,
        status: entry?.status || ROUTE_STATUS.INVALID,
        reasons: entry?.reasons ? [...entry.reasons] : [],
        revision: snapshot.revision
      });
    }
    return lines;
  }
}

/** 两端格做 Bresenham 栅格化（含首尾格）。 */
function rasterizeCells(from, to) {
  const cells = [];
  let x0 = from.col;
  let y0 = from.row;
  const x1 = to.col;
  const y1 = to.row;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  // 防御：坐标异常时不至于死循环（理论上 Bresenham 必收敛）
  let guard = 10000;
  while (guard > 0) {
    cells.push({ row: y0, col: x0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
    guard -= 1;
  }
  return cells;
}

export default WorldRouteLayer;

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 ************************************************************/

import {
  ROUTE_CROSSING_KINDS,
  ROUTE_EDGE_MODES,
  ROUTE_NODE_KINDS,
  ROUTE_STATUS,
  WorldRouteLayer,
  resolveEdgeConditions,
  resolveEdgeCost,
  resolveRouteSource,
  validateWorldLogic
} from '../src/core/world/WorldRouteLayer.js';
import {
  DIFF_CATEGORIES,
  DIFF_CATEGORY_LABELS,
  adoptAllOfCategory,
  adoptAuto,
  buildDiff
} from '../src/core/world/WorldLogicDiff.js';

/**
 * WorldLogicEditor - 世界逻辑路径编辑器（模块 4 · 4B）
 *
 * 边界（2026-11-10 裁定，改动前先读 spec §5.1）：
 * 1. 本轮只做「改已有」：拖节点、改权重/条件/归属、桥渡关隘属性；**不做**新建节点/连线/删除。
 * 2. 通行色与边线颜色**只读** `WorldRouteLayer` 的派生投影（buildCellOverlay / buildEdgeLines），
 *    本文件不得出现第二套阵营/关隘/封路判断。
 * 3. 数据结构预留 `source: 'auto'|'manual'` 与 `autoRevision`：原样保留、不参与判定、
 *    不在保存时裁剪（自动抽取方案拍板后，重抽只覆盖 auto 层）。
 * 4. 不新开页面：由 `WorldMapEditor` 内嵌（S2 形态），保存仍走同一个 `CanonicalEditorSession`。
 */

/** 三视图：表现视图 / 逻辑视图 / 叠加只读（spec §4.3）。 */
export const WORLD_LOGIC_VIEW_MODES = Object.freeze(['presentation', 'logic', 'overlay']);

export const WORLD_LOGIC_VIEW_LABELS = Object.freeze({
  presentation: '表现视图',
  logic: '逻辑视图',
  overlay: '叠加只读'
});

/** 通行色（表现层常量；判定结果只来自 WorldRouteLayer 快照）。 */
export const WORLD_ROUTE_STATUS_STYLES = Object.freeze({
  [ROUTE_STATUS.PASSABLE]: { color: '#4caf50', dash: '' },
  [ROUTE_STATUS.HOSTILE]: { color: '#e74c3c', dash: '6 4' },
  [ROUTE_STATUS.CLOSED]: { color: '#f39c12', dash: '6 4' },
  [ROUTE_STATUS.TERRAIN]: { color: '#555b63', dash: '' },
  [ROUTE_STATUS.INVALID]: { color: '#b06bd6', dash: '2 3' },
  [ROUTE_STATUS.NO_ROUTE]: { color: '#8a8f98', dash: '' }
});

/** 不可达错误码 → 玩家/策划可读提示（spec §5.2）。 */
export const ROUTE_ERROR_MESSAGES = Object.freeze({
  noPath: '不可达：图中没有连通路线',
  unknownNode: '不可达：节点不存在',
  passBlocked: '不可达：关隘/桥渡被敌方控制或阵营禁行',
  blockedByDay: '不可达：剧情封路尚未解封',
  terrainBlocked: '不可达：地形永久阻隔',
  hostileBlocked: '不可达：阵营禁行'
});

const NODE_KIND_LABELS = Object.freeze({
  city: '城池',
  pass: '关隘',
  bridge: '桥',
  ferry: '渡口',
  junction: '岔路',
  camp: '营寨'
});

const NODE_KIND_COLORS = Object.freeze({
  city: '#f6e7a8',
  pass: '#e67e22',
  bridge: '#69b7ff',
  ferry: '#4fd1c5',
  junction: '#c8c8c8',
  camp: '#a3d977'
});

const VALIDATION_MESSAGES = Object.freeze({
  logicMissing: '逻辑数据缺失',
  nodesEmpty: '节点为空',
  nodeIdRequired: '节点缺少 id',
  duplicateNodeId: '节点 id 重复',
  unknownNodeKind: '未知节点类别',
  nodePositionInvalid: '节点坐标非法',
  nodeCellInvalid: '节点 cell 非法',
  tollOnNonPass: '非关隘配置了税率',
  unknownFaction: '归属阵营未登记',
  edgeIdRequired: '边缺少 id',
  duplicateEdgeId: '边 id 重复',
  edgeFromUnknown: '边起点不存在',
  edgeToUnknown: '边终点不存在',
  edgeSelfLoop: '边起终点相同',
  unknownEdgeMode: '未知边形态',
  edgeCostInvalid: '边权重必须为正数',
  crossingNodeUnknown: '过河节点不存在',
  crossingNodeInvalid: '过河节点类别不可过关',
  factionIdsInvalid: '阵营白名单必须是数组',
  unknownRouteSource: '来源标记未知',
  invalidAutoRevision: 'autoRevision 非法'
});

const SVG_NS = 'http://www.w3.org/2000/svg';

function clone(value) {
  if (value == null) return null;
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function toNumberOrNull(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class WorldLogicEditor {
  /**
   * @param {Object} [options]
   * @param {HTMLElement|null} [options.toolbarHost] - 工具栏挂点（WorldMapEditor 工具栏内）
   * @param {HTMLElement|null} [options.panelHost] - 属性/校验面板挂点（画布下方）
   * @param {HTMLElement|null} [options.diffHost] - 差异面板挂点（画布下方独立块）
   * @param {Object|null} [options.logic] - game.project.json 的 worldLogic 草稿（人工层，唯一事实源）
   * @param {Object|null} [options.autoLayer] - 自动层（{nodes,edges,revision}，不参与判定）
   * @param {Function|null} [options.autoLayerProvider] - () => autoLayer|null（重抽入口，抽取器接入后提供）
   * @param {Function|null} [options.sceneResolver] - node => sceneId|null（跳到场景改对象）
   * @param {Function|null} [options.openScene] - sceneId => void（打开场景编辑器）
   * @param {string[]} [options.factions] - 可选阵营
   * @param {string|null} [options.moverFactionId] - 预览用行军方
   * @param {Function|null} [options.getDay] - () => number（编辑器缺省 1）
   * @param {Function|null} [options.onChange] - 草稿变更回调
   */
  constructor({
    toolbarHost = null,
    panelHost = null,
    diffHost = null,
    logic = null,
    autoLayer = null,
    autoLayerProvider = null,
    sceneResolver = null,
    openScene = null,
    factions = [],
    moverFactionId = null,
    getDay = null,
    onChange = null
  } = {}) {
    this.toolbarHost = toolbarHost;
    this.panelHost = panelHost;
    this.diffHost = diffHost;
    this.factions = Array.isArray(factions) ? factions.slice() : [];
    this._getDay = typeof getDay === 'function' ? getDay : () => 1;
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.autoLayerProvider = typeof autoLayerProvider === 'function' ? autoLayerProvider : null;
    this.sceneResolver = typeof sceneResolver === 'function' ? sceneResolver : null;
    this.openScene = typeof openScene === 'function' ? openScene : null;

    this.logic = clone(logic) || { nodes: [], edges: [] };
    this.autoLayer = autoLayer || null;
    this.diff = null;
    this.diffIgnores = new Set();
    this.diffResolved = new Set();
    this.diffOpen = false;
    this.diffMessage = '';
    this.lastRebuildSummary = null;
    this.layer = null;
    this.viewMode = 'presentation';
    this.selected = { type: null, id: null };
    this.routeResult = null;
    this.region = null;
    this.metrics = null;

    this._dirty = false;
    this._svg = null;
    this._drag = null;

    this._rebuildLayer(moverFactionId);
    this._rebuildDiff();
    this._renderToolbar();
    this._renderPanel();
    this._bindDiffHost();
    this._renderDiff();
  }

  // ================ 公共 API ================

  /** 替换草稿（WorldMapEditor 加载/保存后调用）；保留 source/autoRevision 等全部字段。 */
  setLogic(logic, { factions = null, moverFactionId = undefined } = {}) {
    this.logic = clone(logic) || { nodes: [], edges: [] };
    if (!Array.isArray(this.logic.nodes)) this.logic.nodes = [];
    if (!Array.isArray(this.logic.edges)) this.logic.edges = [];
    if (Array.isArray(factions)) this.factions = factions.slice();
    this.selected = { type: null, id: null };
    this.routeResult = null;
    this._dirty = false;
    this._rebuildLayer(moverFactionId);
    this._rebuildDiff();
    this._renderToolbar();
    this._renderPanel();
    this._renderDiff();
    this._draw();
    return this;
  }

  getLogic() {
    // 存档只写人工层：autoLayer 是独立内存数据，永不并入这里。
    return clone(this.logic);
  }

  isDirty() {
    return this._dirty;
  }

  getLayer() {
    return this.layer;
  }

  getViewMode() {
    return this.viewMode;
  }

  // ================ 差异面板（auto vs manual）================

  /** 设置自动层（null=未接入抽取器）；重设会清空本次忽略/保留标记。 */
  setAutoLayer(autoLayer) {
    this.autoLayer = autoLayer || null;
    this.diffIgnores.clear();
    this.diffResolved.clear();
    this.diffMessage = '';
    this._rebuildDiff();
    this._renderToolbar();
    this._renderDiff();
    return this;
  }

  /** 重抽自动层：只重建 auto，人工层原样不动；返回新增/消失条目摘要。 */
  rebuildAutoLayer() {
    if (!this.autoLayerProvider) {
      this.diffMessage = '自动层抽取器尚未接入（下一批），本轮只支持外部注入 auto 层。';
      this._renderDiff();
      return null;
    }
    const previous = this.autoLayer;
    const next = this.autoLayerProvider();
    const summary = this._summarizeRebuild(previous, next);
    this.setAutoLayer(next);
    this.lastRebuildSummary = summary;
    this.diffOpen = true;
    this._renderToolbar();
    this._renderDiff();
    return summary;
  }

  getDiff() {
    return this.diff;
  }

  toggleDiff(open = !this.diffOpen) {
    this.diffOpen = open === true;
    this._renderToolbar();
    this._renderDiff();
    return this.diffOpen;
  }

  /** 采纳单条差异（写人工层）。返回 {ok, code?}。 */
  adoptDiffEntry(key) {
    const entry = this._findDiffEntry(key);
    if (!entry) return { ok: false, code: 'entryMissing' };
    const result = adoptAuto(this.autoLayer, this.logic, entry);
    if (!result.ok) {
      this.diffMessage = this._diffErrorText(result);
      this._renderDiff();
      return result;
    }
    this.logic = result.logic;
    this.diffResolved.delete(key);
    this.diffIgnores.delete(key);
    this.diffMessage = Array.isArray(result.removedEdgeIds) && result.removedEdgeIds.length > 0
      ? `已删除 1 个人工条目，并级联删除 ${result.removedEdgeIds.length} 条关联边。`
      : '';
    this._touch();
    return result;
  }

  /** 保留人工：不改数据，本次对比不再列出该条。 */
  keepManualDiff(key) {
    if (!this._findDiffEntry(key)) return false;
    this.diffResolved.add(String(key));
    this._rebuildDiff();
    this._renderToolbar();
    this._renderDiff();
    return true;
  }

  /** 忽略此差异：本次对比不再列出（重抽/重开清空）。 */
  ignoreDiff(key) {
    if (!this._findDiffEntry(key)) return false;
    this.diffIgnores.add(String(key));
    this._rebuildDiff();
    this._renderToolbar();
    this._renderDiff();
    return true;
  }

  /** 单类「全部采纳」——只处理该类别，绝不跨类。 */
  adoptAllDiff(category) {
    if (!DIFF_CATEGORIES.includes(category) || !this.diff) {
      return { ok: false, code: 'unknownCategory' };
    }
    const entries = this.diff.categories[category];
    const result = adoptAllOfCategory(this.autoLayer, this.logic, category, entries);
    this.logic = result.logic;
    for (const key of result.applied) this.diffResolved.add(key);
    this.diffMessage = result.skipped.length > 0
      ? `已采纳 ${result.applied.length} 条，${result.skipped.length} 条因端点缺失被跳过。`
      : `已采纳 ${result.applied.length} 条。`;
    this._touch();
    return result;
  }

  /** 跳到场景里改对象：返回 sceneId（找不到返回 null）。 */
  jumpToScene(key) {
    const entry = this._findDiffEntry(key);
    if (!entry) return null;
    const node = entry.target === 'node'
      ? (entry.manual || entry.auto)
      : this._entryEndpointNode(entry);
    const sceneId = this._resolveSceneId(node);
    if (!sceneId) {
      this.diffMessage = '无法定位场景：该对象没有 sceneId，且坐标不在任何场景格内。';
      this._renderDiff();
      return null;
    }
    if (this.openScene) this.openScene(sceneId);
    return sceneId;
  }

  /** 三视图切换（只影响交互与压暗，不影响数据）。 */
  setViewMode(mode) {
    if (!WORLD_LOGIC_VIEW_MODES.includes(mode)) return false;
    this.viewMode = mode;
    this._renderToolbar();
    this._applyViewMode();
    return true;
  }

  setMoverFaction(factionId) {
    const next = factionId ? String(factionId) : null;
    this.layer.setMoverFaction(next);
    this.routeResult = null;
    this._draw();
    this._renderToolbar();
    this._renderPanel();
  }

  /** 绑定画面 region 与像素度量，绘制只读通行投影 + 节点/边。 */
  render(region, metrics = {}) {
    this.region = region || null;
    this.metrics = {
      gridEl: metrics.gridEl || null,
      thumbW: Number(metrics.thumbW) || 256,
      thumbH: Number(metrics.thumbH) || 144,
      labelH: Number(metrics.labelH) || 20,
      gap: Number(metrics.gap) || 2
    };
    this._draw();
    this._renderPanel();
  }

  selectNode(nodeId) {
    if (!this.layer.getNode(nodeId)) return false;
    this.selected = { type: 'node', id: String(nodeId) };
    this._draw();
    this._renderPanel();
    return true;
  }

  selectEdge(edgeId) {
    if (!this.layer.getEdge(edgeId)) return false;
    this.selected = { type: 'edge', id: String(edgeId) };
    this._draw();
    this._renderPanel();
    return true;
  }

  /** 拖拽/数值输入统一走这里：写 nodes[].position（清掉过期 cell 吸附）。 */
  moveNode(nodeId, position) {
    const node = this.layer.getNode(nodeId);
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    node.position = { x, y };
    delete node.cell;
    this._touch();
    return true;
  }

  /** 改已有节点（name/kind/ownerFactionId/level/tollRate）。 */
  updateNode(nodeId, patch = {}) {
    const node = this.layer.getNode(nodeId);
    if (!node || !patch || typeof patch !== 'object') return false;
    Object.assign(node, patch);
    for (const key of Object.keys(patch)) {
      if (patch[key] == null) delete node[key];
    }
    this._touch();
    return true;
  }

  /** 改已有边（mode/cost/bidirectional）；写 cost 时删除 weight 别名，保持单源。 */
  updateEdge(edgeId, patch = {}) {
    const edge = this.layer.getEdge(edgeId);
    if (!edge || !patch || typeof patch !== 'object') return false;
    Object.assign(edge, patch);
    if (Object.hasOwn(patch, 'cost')) delete edge.weight;
    this._touch();
    return true;
  }

  /** 改边通行条件（白名单/过河节点/封路日/地形阻隔）；统一收敛到 edge.conditions。 */
  updateEdgeConditions(edgeId, patch = {}) {
    const edge = this.layer.getEdge(edgeId);
    if (!edge || !patch || typeof patch !== 'object') return false;
    const conditions = { ...resolveEdgeConditions(edge), ...patch };
    for (const key of Object.keys(conditions)) {
      if (conditions[key] == null) delete conditions[key];
    }
    for (const key of ['crossingNodeId', 'factionIds', 'blockedUntilDay', 'terrainBlocked']) {
      delete edge[key];
    }
    if (Object.keys(conditions).length === 0) delete edge.conditions;
    else edge.conditions = conditions;
    this._touch();
    return true;
  }

  /** 选中目标节点后做一次只读求路；失败时给出 spec 约定的错误码。 */
  previewRoute(fromId, toId) {
    const from = fromId != null ? String(fromId) : '';
    const to = toId != null ? String(toId) : '';
    const result = this.layer.shortestPath(from, to);
    if (result.ok) {
      this.routeResult = { ...result, code: null, message: '' };
    } else {
      const code = result.code === 'unknownNode' ? 'unknownNode' : this._explainUnreachable(from, to);
      this.routeResult = {
        ok: false,
        code,
        message: ROUTE_ERROR_MESSAGES[code] || ROUTE_ERROR_MESSAGES.noPath,
        from,
        to
      };
    }
    this._draw();
    this._renderPanel();
    return this.routeResult;
  }

  clearRoutePreview() {
    this.routeResult = null;
    this._draw();
    this._renderPanel();
  }

  /** 结构校验（编辑器保存前与 M4Content 测试共用同一实现）。 */
  validate() {
    return validateWorldLogic(this.logic, {
      knownFactions: this.factions.length > 0 ? new Set(this.factions) : null
    });
  }

  destroy() {
    this._teardownDrag();
    if (this._svg?.parentNode) this._svg.parentNode.removeChild(this._svg);
    if (this.toolbarHost) this.toolbarHost.innerHTML = '';
    if (this.panelHost) this.panelHost.innerHTML = '';
    if (this.diffHost) this.diffHost.innerHTML = '';
    this._svg = null;
    this._bound = false;
  }

  // ================ 内部：数据 ================

  _rebuildLayer(moverFactionId = undefined) {
    const mover = moverFactionId === undefined
      ? this.layer?.moverFactionId ?? null
      : moverFactionId;
    this.layer = new WorldRouteLayer({
      logic: this.logic,
      getDay: this._getDay,
      moverFactionId: mover
    });
  }

  _touch() {
    this._dirty = true;
    this.layer.load(this.logic);
    if (this.selected.type === 'node' && !this.layer.getNode(this.selected.id)) {
      this.selected = { type: null, id: null };
    }
    if (this.selected.type === 'edge' && !this.layer.getEdge(this.selected.id)) {
      this.selected = { type: null, id: null };
    }
    this._rebuildDiff();
    this._draw();
    this._renderToolbar();
    this._renderPanel();
    this._renderValidation();
    this._renderDiff();
    if (this.onChange) this.onChange(this.logic);
  }

  // ================ 内部：差异（auto vs manual）================

  _rebuildDiff() {
    this.diff = buildDiff(this.autoLayer, this.logic, {
      ignoredKeys: [...this.diffIgnores],
      resolvedKeys: [...this.diffResolved]
    });
    return this.diff;
  }

  _findDiffEntry(key) {
    if (!this.diff || key === null || key === undefined) return null;
    for (const category of DIFF_CATEGORIES) {
      const entry = this.diff.categories[category].find(item => item.key === String(key));
      if (entry) return entry;
    }
    return null;
  }

  /** 重抽摘要：按 id 比对前后两份自动层（人工层不参与）。 */
  _summarizeRebuild(previous, next) {
    const collect = layer => {
      const map = new Map();
      for (const node of layer?.nodes || []) map.set(`node:${node.id}`, JSON.stringify(node));
      for (const edge of layer?.edges || []) map.set(`edge:${edge.id}`, JSON.stringify(edge));
      return map;
    };
    const before = collect(previous);
    const after = collect(next);
    return {
      added: [...after.keys()].filter(key => !before.has(key)),
      removed: [...before.keys()].filter(key => !after.has(key)),
      changed: [...after.keys()].filter(key => before.has(key) && before.get(key) !== after.get(key))
    };
  }

  _diffErrorText(result) {
    if (result.code === 'missingEndpoint') {
      return `无法采纳：端点 ${(result.missing || []).join('、')} 还不在人工层，请先采纳对应节点。`;
    }
    if (result.code === 'duplicateId') return '无法采纳：人工层已存在同 id 条目。';
    return '无法采纳该差异。';
  }

  _entryEndpointNode(entry) {
    const edge = entry?.manual || entry?.auto;
    if (!edge) return null;
    const from = String(edge.from);
    return (this.logic.nodes || []).find(item => String(item.id) === from)
      || (this.autoLayer?.nodes || []).find(item => String(item.id) === from)
      || null;
  }

  _resolveSceneId(node) {
    if (!node) return null;
    if (node.sceneId) return String(node.sceneId);
    if (this.sceneResolver) {
      const resolved = this.sceneResolver(node);
      if (resolved) return String(resolved);
    }
    return null;
  }

  _bindDiffHost() {
    if (!this.diffHost || this._diffBound) return;
    this._diffBound = true;
    this.diffHost.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-diff-action]');
      if (!button) return;
      event.preventDefault();
      const key = button.getAttribute('data-diff-key') || '';
      const action = button.getAttribute('data-diff-action') || '';
      if (action === 'toggle') this.toggleDiff();
      else if (action === 'rebuild') this.rebuildAutoLayer();
      else if (action === 'adopt') this.adoptDiffEntry(key);
      else if (action === 'keep') this.keepManualDiff(key);
      else if (action === 'ignore') this.ignoreDiff(key);
      else if (action === 'scene') this.jumpToScene(key);
      else if (action === 'adoptAll') this.adoptAllDiff(key);
      else if (action === 'close') this.toggleDiff(false);
    });
  }

  _diffButton(action, key, label, { disabled = false, title = '' } = {}) {
    return `<button type="button" data-diff-action="${action}" data-diff-key="${escapeHtml(key)}"`
      + ` title="${escapeHtml(title)}"${disabled ? ' disabled' : ''}`
      + ' style="background:#1b2a3a;color:#cfe4f7;border:1px solid #35506b;border-radius:4px;'
      + 'padding:2px 7px;font-size:11px;cursor:pointer">'
      + `${escapeHtml(label)}</button>`;
  }

  _renderDiff() {
    const host = this.diffHost;
    if (!host) return;
    if (!this.diffOpen) {
      host.innerHTML = '';
      return;
    }
    const counts = this.diff?.counts || { autoOnly: 0, manualOnly: 0, changed: 0 };
    const total = this.diff?.total || 0;
    const parts = [];
    parts.push('<div style="margin-top:8px;border:1px solid #2c4055;border-radius:6px;'
      + 'background:#101b27;color:#c9dcee;font-size:12px">');
    parts.push('<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;'
      + 'border-bottom:1px solid #24364a">');
    parts.push('<strong style="color:#e8f3ff">自动层 / 人工修正层 差异</strong>');
    parts.push(`<span style="color:#8fb0cc">共 ${total} 条</span>`);
    if (this.autoLayer) {
      parts.push(`<span style="color:#7f97ad">自动层 revision ${Number(this.autoLayer.revision) || 0}</span>`);
    }
    parts.push('<span style="flex:1"></span>');
    parts.push(this._diffButton('rebuild', '', '重抽自动层', {
      disabled: !this.autoLayerProvider,
      title: this.autoLayerProvider ? '只重建自动层，人工层不动' : '抽取器下一批接入'
    }));
    parts.push(this._diffButton('close', '', '收起'));
    parts.push('</div>');

    if (!this.autoLayer) {
      parts.push('<div style="padding:10px;color:#94a9bd">自动层尚未注入（抽取器下一批接入）。'
        + '差异面板只读取自动层，不会改动人工层。</div>');
      parts.push('</div>');
      host.innerHTML = parts.join('');
      return;
    }

    if (this.lastRebuildSummary) {
      const summary = this.lastRebuildSummary;
      const list = (items) => (items.length === 0 ? '无'
        : `${items.length} 条（${items.slice(0, 5).join('、')}${items.length > 5 ? '…' : ''}）`);
      parts.push('<div style="padding:6px 10px;border-bottom:1px solid #24364a;color:#9fc4e2">'
        + `本次重抽：新增 ${list(summary.added)} / 消失 ${list(summary.removed)} / 变化 ${list(summary.changed)}`
        + '（人工层未改动）</div>');
    }
    if (this.diffMessage) {
      parts.push(`<div style="padding:6px 10px;border-bottom:1px solid #24364a;color:#ffd18a">`
        + `${escapeHtml(this.diffMessage)}</div>`);
    }
    if (total === 0) {
      parts.push('<div style="padding:10px;color:#8fd6a4">自动层与人工层一致，无待处理差异。</div>');
    }

    for (const category of DIFF_CATEGORIES) {
      const entries = this.diff?.categories[category] || [];
      parts.push('<div style="border-top:1px solid #24364a">');
      parts.push('<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;'
        + 'background:#14212f">');
      parts.push(`<strong style="color:#dcecfa">${escapeHtml(DIFF_CATEGORY_LABELS[category])}</strong>`);
      parts.push(`<span style="color:#8fb0cc">${counts[category]}</span>`);
      parts.push('<span style="flex:1"></span>');
      parts.push(this._diffButton('adoptAll', category, '全部采纳（仅此类）', {
        disabled: entries.length === 0
      }));
      parts.push('</div>');
      if (entries.length === 0) {
        parts.push('<div style="padding:8px 10px;color:#6f869b">无</div>');
      }
      for (const entry of entries) {
        parts.push('<div style="padding:6px 10px;border-top:1px solid #1d2c3c">');
        parts.push('<div style="display:flex;align-items:center;gap:8px">');
        parts.push(`<strong style="color:#e3effb">${escapeHtml(entry.label || entry.id)}</strong>`);
        parts.push(`<code style="color:#7fa6c8">${escapeHtml(entry.id)}</code>`);
        parts.push(`<span style="color:#7f97ad">${entry.target === 'node' ? '节点' : '边'}</span>`);
        parts.push('<span style="flex:1"></span>');
        parts.push(this._diffButton('adopt', entry.key,
          category === 'manualOnly' ? '采纳（删除）' : '采纳自动'));
        parts.push(this._diffButton('keep', entry.key, '保留人工', {
          disabled: category === 'autoOnly'
        }));
        parts.push(this._diffButton('ignore', entry.key, '忽略'));
        parts.push(this._diffButton('scene', entry.key, '去场景改'));
        parts.push('</div>');
        parts.push('<div style="display:grid;grid-template-columns:120px 1fr 1fr;gap:2px 8px;'
          + 'margin-top:4px;font-size:11px;color:#9fb3c8">');
        parts.push('<span style="color:#7f97ad">字段</span><span>自动值</span><span>人工值</span>');
        for (const field of entry.fields) {
          const autoValue = field.autoValue === null || field.autoValue === undefined ? '—' : field.autoValue;
          const manualValue = field.manualValue === null || field.manualValue === undefined ? '—' : field.manualValue;
          parts.push(`<span style="color:#8aa7c0">${escapeHtml(field.name)}</span>`);
          parts.push(`<span>${escapeHtml(String(autoValue))}</span>`);
          parts.push(`<span>${escapeHtml(String(manualValue))}</span>`);
        }
        parts.push('</div>');
        parts.push('</div>');
      }
      parts.push('</div>');
    }

    parts.push('</div>');
    host.innerHTML = parts.join('');
  }

  // ================ 内部：DOM ================

  _renderToolbar() {
    if (!this.toolbarHost) return;
    const faction = this.layer.moverFactionId || '';
    const options = ['<option value="">未指定</option>'].concat(
      this.factions.map(id => `<option value="${escapeHtml(id)}"${id === faction ? ' selected' : ''}>${escapeHtml(id)}</option>`)
    ).join('');
    const views = WORLD_LOGIC_VIEW_MODES.map(mode => (
      `<button type="button" class="wle-view" data-view="${mode}"${mode === this.viewMode ? ' data-active="1"' : ''}>${WORLD_LOGIC_VIEW_LABELS[mode]}</button>`
    )).join('');
    const diffCount = this.autoLayer ? (this.diff?.total || 0) : '—';
    this.toolbarHost.innerHTML = `
      <span class="wle-toolbar" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;color:#d9c28d;">
        <strong>逻辑路径</strong>
        <span class="wle-views">${views}</span>
        <button type="button" class="wle-diff-toggle" data-open="${this.diffOpen ? '1' : '0'}">差异面板（${diffCount}）</button>
        <label>行军方 <select class="wle-mover" style="max-width:150px;">${options}</select></label>
        <span class="wle-counts" style="color:#9c927c;">节点 ${this.logic.nodes.length} / 边 ${this.logic.edges.length}</span>
        <span class="wle-dirty" style="color:#f39c12;">${this._dirty ? '未保存' : ''}</span>
      </span>`;
    this._bindToolbar();
  }

  _bindToolbar() {
    if (!this.toolbarHost) return;
    this.toolbarHost.querySelectorAll('.wle-view').forEach(button => {
      button.onclick = () => this.setViewMode(button.dataset.view);
    });
    const diffToggle = this.toolbarHost.querySelector('.wle-diff-toggle');
    if (diffToggle) diffToggle.onclick = () => this.toggleDiff();
    const mover = this.toolbarHost.querySelector('.wle-mover');
    if (mover) mover.onchange = () => this.setMoverFaction(mover.value);
  }

  _renderPanel() {
    if (!this.panelHost) return;
    const logic = this.logic;
    if (!logic.nodes.length && !logic.edges.length) {
      this.panelHost.innerHTML = '<div class="wle-panel" style="padding:8px;border:1px solid #2a3a5e;border-radius:4px;color:#9c927c;">'
        + '当前工程没有 worldLogic。4B 只支持改已有节点/边，新建图待来源方案拍板。</div>';
      return;
    }
    const nodeOptions = ['<option value="">选择节点</option>'].concat(
      logic.nodes.map(node => (
        `<option value="${escapeHtml(node.id)}"${this.selected.type === 'node' && this.selected.id === node.id ? ' selected' : ''}>${escapeHtml(node.name || node.id)}</option>`
      ))
    ).join('');
    this.panelHost.innerHTML = `
      <div class="wle-panel" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;padding:8px;border:1px solid #2a3a5e;border-radius:4px;margin-top:8px;">
        <div class="wle-props" style="min-width:280px;flex:1;">
          <div style="color:#d9c28d;margin-bottom:6px;">选中对象：${this._selectionLabel()}</div>
          <div class="wle-fields">${this._buildFieldsHtml()}</div>
          <div style="margin-top:6px;color:#9c927c;font-size:12px;">节点下拉：<select class="wle-node-pick">${nodeOptions}</select></div>
        </div>
        <div class="wle-route" style="min-width:300px;flex:1;">
          <div style="color:#d9c28d;margin-bottom:6px;">路线预览（只读求路）</div>
          <select class="wle-route-from">${nodeOptions}</select>
          <span style="color:#9c927c;"> → </span>
          <select class="wle-route-to">${nodeOptions}</select>
          <button type="button" class="wle-route-run">预览</button>
          <button type="button" class="wle-route-clear">清除</button>
          <div class="wle-route-result" style="margin-top:6px;font-size:12px;">${this._routeResultHtml()}</div>
          <div class="wle-legend" style="margin-top:8px;font-size:12px;color:#9c927c;display:flex;gap:10px;flex-wrap:wrap;">
            ${this._legendHtml()}
          </div>
        </div>
        <div class="wle-validation" style="min-width:260px;flex:1;"></div>
      </div>`;
    this._bindPanel();
    this._renderValidation();
  }

  _bindPanel() {
    const panel = this.panelHost?.querySelector('.wle-panel');
    if (!panel) return;
    panel.onchange = event => this._handlePanelChange(event.target);
    const pick = panel.querySelector('.wle-node-pick');
    if (pick) {
      pick.value = this.selected.type === 'node' ? this.selected.id : '';
      pick.onchange = () => { if (pick.value) this.selectNode(pick.value); };
    }
    const from = panel.querySelector('.wle-route-from');
    const to = panel.querySelector('.wle-route-to');
    if (from && this.routeResult) from.value = this.routeResult.from || '';
    if (to && this.routeResult) to.value = this.routeResult.to || '';
    const run = panel.querySelector('.wle-route-run');
    if (run) run.onclick = () => this.previewRoute(from?.value, to?.value);
    const clear = panel.querySelector('.wle-route-clear');
    if (clear) clear.onclick = () => this.clearRoutePreview();
  }

  _selectionLabel() {
    if (this.selected.type === 'node') {
      const node = this.layer.getNode(this.selected.id);
      return `<span style="color:#69b7ff;">节点</span> ${escapeHtml(node?.name || '')} <code>${escapeHtml(this.selected.id)}</code>`;
    }
    if (this.selected.type === 'edge') {
      return `<span style="color:#e67e22;">边</span> <code>${escapeHtml(this.selected.id)}</code>`;
    }
    return '<span style="color:#9c927c;">未选中（点节点或边线）</span>';
  }

  _buildFieldsHtml() {
    if (this.selected.type === 'node') return this._buildNodeFields();
    if (this.selected.type === 'edge') return this._buildEdgeFields();
    return '<div style="color:#9c927c;font-size:12px;">点选节点/边后在此修改已有属性。</div>';
  }

  _buildNodeFields() {
    const node = this.layer.getNode(this.selected.id);
    if (!node) return '';
    const source = resolveRouteSource(node.source);
    const factionOptions = ['<option value="">中立</option>'].concat(
      this.factions.map(id => `<option value="${escapeHtml(id)}"${node.ownerFactionId === id ? ' selected' : ''}>${escapeHtml(id)}</option>`)
    ).join('');
    const kindOptions = ROUTE_NODE_KINDS.map(kind => (
      `<option value="${kind}"${node.kind === kind ? ' selected' : ''}>${NODE_KIND_LABELS[kind] || kind}</option>`
    )).join('');
    const position = node.position || {};
    return `
      <div class="wle-row">id <code>${escapeHtml(node.id)}</code>
        <span style="color:${source === 'auto' ? '#69b7ff' : '#9c927c'};">[${source}${node.autoRevision != null ? ` r${escapeHtml(node.autoRevision)}` : ''}]</span>
      </div>
      <div class="wle-row">名称 <input type="text" data-scope="node" data-prop="name" value="${escapeHtml(node.name || '')}" /></div>
      <div class="wle-row">类别 <select data-scope="node" data-prop="kind">${kindOptions}</select></div>
      <div class="wle-row">坐标
        <input type="number" step="any" data-scope="node" data-prop="x" value="${escapeHtml(position.x ?? '')}" style="width:90px;" />
        <input type="number" step="any" data-scope="node" data-prop="y" value="${escapeHtml(position.y ?? '')}" style="width:90px;" />
      </div>
      <div class="wle-row">归属 <select data-scope="node" data-prop="ownerFactionId">${factionOptions}</select></div>
      <div class="wle-row">规模 <input type="number" step="1" data-scope="node" data-prop="level" value="${escapeHtml(node.level ?? '')}" style="width:70px;" /></div>
      ${node.kind === 'pass' ? `<div class="wle-row">关税税率 <input type="number" step="any" data-scope="node" data-prop="tollRate" value="${escapeHtml(node.tollRate ?? '')}" style="width:90px;" /></div>` : ''}`;
  }

  _buildEdgeFields() {
    const edge = this.layer.getEdge(this.selected.id);
    if (!edge) return '';
    const conditions = resolveEdgeConditions(edge);
    const source = resolveRouteSource(edge.source);
    const modeOptions = ROUTE_EDGE_MODES.map(mode => (
      `<option value="${mode}"${edge.mode === mode ? ' selected' : ''}>${mode}</option>`
    )).join('');
    const crossingNodes = [...this.layer.nodes.values()].filter(node => ROUTE_CROSSING_KINDS.includes(node.kind));
    const crossingOptions = ['<option value="">（无关隘/桥渡）</option>'].concat(
      crossingNodes.map(node => (
        `<option value="${escapeHtml(node.id)}"${String(conditions.crossingNodeId || '') === String(node.id) ? ' selected' : ''}>${escapeHtml(node.name || node.id)}</option>`
      ))
    ).join('');
    const factionIds = Array.isArray(conditions.factionIds) ? conditions.factionIds.join(',') : '';
    return `
      <div class="wle-row">id <code>${escapeHtml(edge.id)}</code>
        <span style="color:${source === 'auto' ? '#69b7ff' : '#9c927c'};">[${source}${edge.autoRevision != null ? ` r${escapeHtml(edge.autoRevision)}` : ''}]</span>
      </div>
      <div class="wle-row">${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</div>
      <div class="wle-row">形态 <select data-scope="edge" data-prop="mode">${modeOptions}</select></div>
      <div class="wle-row">权重 <input type="number" step="any" data-scope="edge" data-prop="cost" value="${escapeHtml(resolveEdgeCost(edge))}" style="width:90px;" /></div>
      <div class="wle-row"><label><input type="checkbox" data-scope="edge" data-prop="bidirectional"${edge.bidirectional === false ? '' : ' checked'} /> 双向可走</label></div>
      <div class="wle-row">过河/过关 <select data-scope="conditions" data-prop="crossingNodeId">${crossingOptions}</select></div>
      <div class="wle-row">阵营白名单 <input type="text" data-scope="conditions" data-prop="factionIds" value="${escapeHtml(factionIds)}" placeholder="逗号分隔，空=全通" style="width:180px;" /></div>
      <div class="wle-row">封路至日 <input type="number" step="1" data-scope="conditions" data-prop="blockedUntilDay" value="${escapeHtml(conditions.blockedUntilDay ?? '')}" style="width:80px;" /></div>
      <div class="wle-row"><label><input type="checkbox" data-scope="conditions" data-prop="terrainBlocked"${conditions.terrainBlocked === true ? ' checked' : ''} /> 地形永久阻隔</label></div>`;
  }

  _handlePanelChange(target) {
    if (!target?.dataset) return;
    const scope = target.dataset.scope;
    const prop = target.dataset.prop;
    if (!scope || !prop) return;
    const isCheckbox = target.type === 'checkbox';
    const raw = isCheckbox ? target.checked : target.value;

    if (scope === 'node' && this.selected.type === 'node') {
      if (prop === 'x' || prop === 'y') {
        const node = this.layer.getNode(this.selected.id);
        const next = { ...(node?.position || {}), [prop]: toNumberOrNull(raw) };
        if (Number.isFinite(next.x) && Number.isFinite(next.y)) this.moveNode(this.selected.id, next);
        return;
      }
      const value = target.type === 'number' ? toNumberOrNull(raw) : raw;
      this.updateNode(this.selected.id, { [prop]: value });
      return;
    }
    if (scope === 'edge' && this.selected.type === 'edge') {
      if (prop === 'bidirectional') {
        this.updateEdge(this.selected.id, { bidirectional: raw !== false });
        return;
      }
      this.updateEdge(this.selected.id, {
        [prop]: target.type === 'number' ? toNumberOrNull(raw) : raw
      });
      return;
    }
    if (scope === 'conditions' && this.selected.type === 'edge') {
      let value = raw;
      if (target.type === 'number') value = toNumberOrNull(raw);
      if (isCheckbox) value = raw === true ? true : null;
      if (prop === 'factionIds') {
        value = String(raw || '').split(',').map(item => item.trim()).filter(Boolean);
        if (value.length === 0) value = null;
      }
      if (prop === 'crossingNodeId' && !raw) value = null;
      this.updateEdgeConditions(this.selected.id, { [prop]: value });
    }
  }

  _routeResultHtml() {
    const result = this.routeResult;
    if (!result) return '<span style="color:#9c927c;">选择起终点后预览；不可达会给出原因码。</span>';
    if (!result.ok) {
      return `<span style="color:#e74c3c;">[${escapeHtml(result.code)}] ${escapeHtml(result.message)}</span>`;
    }
    const cost = Number.isFinite(result.cost) ? result.cost.toFixed(1) : '-';
    return `<span style="color:#4caf50;">可走：${result.nodeIds.length} 节点 / 总权重 ${cost}</span>`;
  }

  _legendHtml() {
    return [
      [ROUTE_STATUS.PASSABLE, '可走'],
      [ROUTE_STATUS.HOSTILE, '敌情挡'],
      [ROUTE_STATUS.CLOSED, '剧情封闭'],
      [ROUTE_STATUS.TERRAIN, '地形挡'],
      [ROUTE_STATUS.NO_ROUTE, '无路']
    ].map(([status, label]) => {
      const style = WORLD_ROUTE_STATUS_STYLES[status];
      return `<span><i style="display:inline-block;width:10px;height:10px;background:${style.color};margin-right:4px;"></i>${label}</span>`;
    }).join('');
  }

  _renderValidation() {
    const host = this.panelHost?.querySelector('.wle-validation');
    if (!host) return;
    const result = this.validate();
    const items = []
      .concat(result.errors.map(item => ({ ...item, level: 'error' })))
      .concat(result.warnings.map(item => ({ ...item, level: 'warn' })));
    if (items.length === 0) {
      host.innerHTML = '<div style="color:#d9c28d;margin-bottom:6px;">校验</div><div style="color:#4caf50;font-size:12px;">结构校验通过</div>';
      return;
    }
    host.innerHTML = `<div style="color:#d9c28d;margin-bottom:6px;">校验（${result.errors.length} 错 / ${result.warnings.length} 警）</div>`
      + items.slice(0, 10).map(item => (
        `<div style="font-size:12px;color:${item.level === 'error' ? '#e74c3c' : '#f39c12'};">`
        + `${escapeHtml(item.id || '')} ${escapeHtml(VALIDATION_MESSAGES[item.code] || item.message)}</div>`
      )).join('');
  }

  // ================ 内部：画布投影（只读快照） ================

  _applyViewMode() {
    const grid = this.metrics?.gridEl;
    if (grid) {
      grid.style.filter = this.viewMode === 'logic' ? 'grayscale(.5) brightness(.55)' : '';
      grid.style.opacity = this.viewMode === 'logic' ? '0.85' : '';
    }
    if (this._svg) {
      this._svg.style.display = this.viewMode === 'presentation' ? 'none' : 'block';
      this._svg.style.pointerEvents = this.viewMode === 'logic' ? 'auto' : 'none';
    }
  }

  _ensureSvg() {
    const grid = this.metrics?.gridEl;
    if (!grid) return null;
    if (this._svg && this._svg.parentNode === grid) return this._svg;
    if (this._svg?.parentNode) this._svg.parentNode.removeChild(this._svg);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'wle-overlay');
    svg.style.cssText = 'position:absolute;left:0;top:0;z-index:5;overflow:visible;';
    grid.appendChild(svg);
    this._svg = svg;
    this._bindSvg(svg);
    return svg;
  }

  _draw() {
    const svg = this._ensureSvg();
    if (!svg || !this.region || !this.metrics) {
      this._applyViewMode();
      return;
    }
    const region = this.region;
    const { thumbW, thumbH, labelH, gap } = this.metrics;
    const cellH = thumbH + labelH + gap;
    const cols = Math.max(0, Math.floor(Number(region.cols) || 0));
    const rows = Math.max(0, Math.floor(Number(region.rows) || 0));
    const width = Math.max(0, cols * (thumbW + gap) - gap);
    const height = Math.max(0, rows * cellH - gap);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;

    const parts = [];
    const preview = this.layer.buildPreview({
      rows,
      cols,
      chunkWidth: region.chunkWidth,
      chunkHeight: region.chunkHeight,
      bounds: { left: 0, top: 0 }
    });
    parts.push('<g class="wle-cells">');
    for (const cell of preview.overlay) {
      if (cell.status === ROUTE_STATUS.NO_ROUTE) continue;
      const style = WORLD_ROUTE_STATUS_STYLES[cell.status] || WORLD_ROUTE_STATUS_STYLES.noRoute;
      parts.push(`<rect x="${cell.col * (thumbW + gap)}" y="${cell.row * cellH + labelH}" width="${thumbW}" height="${thumbH}" fill="${style.color}" fill-opacity="0.18" />`);
    }
    parts.push('</g>');

    parts.push('<g class="wle-edges">');
    for (const line of preview.edges) {
      const from = this._worldToPixel(line.fromPosition);
      const to = this._worldToPixel(line.toPosition);
      if (!from || !to) continue;
      const style = WORLD_ROUTE_STATUS_STYLES[line.status] || WORLD_ROUTE_STATUS_STYLES.invalid;
      const selected = this.selected.type === 'edge' && this.selected.id === line.edgeId;
      const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
      parts.push(`<line class="wle-edge" data-edge-id="${escapeHtml(line.edgeId)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${style.color}" stroke-width="${selected ? 6 : 3}"${dash} />`);
      parts.push(`<line class="wle-edge-hit" data-edge-id="${escapeHtml(line.edgeId)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="transparent" stroke-width="14" />`);
    }
    parts.push('</g>');

    if (this.routeResult?.ok && this.routeResult.nodeIds?.length > 1) {
      const points = this.routeResult.nodeIds
        .map(nodeId => this._worldToPixel(this.layer.getNode(nodeId)?.position))
        .filter(Boolean)
        .map(point => `${point.x},${point.y}`)
        .join(' ');
      parts.push(`<polyline class="wle-route-line" points="${points}" fill="none" stroke="#f6e7a8" stroke-width="3" stroke-dasharray="8 5" />`);
    }

    parts.push('<g class="wle-nodes">');
    const snapshot = this.layer.getSnapshot();
    for (const node of this.layer.nodes.values()) {
      const point = this._worldToPixel(node.position);
      if (!point) continue;
      const selected = this.selected.type === 'node' && this.selected.id === String(node.id);
      const color = NODE_KIND_COLORS[node.kind] || '#ffffff';
      const status = snapshot.nodes[String(node.id)]?.status;
      const ring = status === ROUTE_STATUS.HOSTILE ? '#e74c3c' : (selected ? '#f6e7a8' : '#0a0a1e');
      parts.push(`<g class="wle-node" data-node-id="${escapeHtml(node.id)}" style="cursor:grab;">`
        + `<circle cx="${point.x}" cy="${point.y}" r="8" fill="${color}" stroke="${ring}" stroke-width="${selected ? 3 : 2}" />`
        + `<text x="${point.x}" y="${point.y - 12}" fill="#e6ecf7" font-size="12" text-anchor="middle">${escapeHtml(node.name || node.id)}</text>`
        + '</g>');
    }
    parts.push('</g>');

    svg.innerHTML = parts.join('');
    this._applyViewMode();
    this._bindSvg(svg);
  }

  _worldToPixel(position) {
    const point = position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))
      ? { x: Number(position.x), y: Number(position.y) }
      : null;
    if (!point || !this.region || !this.metrics) return null;
    const { chunkWidth, chunkHeight, cols, rows } = this.region;
    const { thumbW, thumbH, labelH, gap } = this.metrics;
    if (!(Number(chunkWidth) > 0) || !(Number(chunkHeight) > 0)) return null;
    const colF = point.x / Number(chunkWidth);
    const rowF = point.y / Number(chunkHeight);
    if (colF < 0 || rowF < 0 || colF >= cols || rowF >= rows) return null;
    const col = Math.floor(colF);
    const row = Math.floor(rowF);
    return {
      x: col * (thumbW + gap) + (colF - col) * thumbW,
      y: row * (thumbH + labelH + gap) + labelH + (rowF - row) * thumbH
    };
  }

  _bindSvg(svg) {
    svg.onclick = event => {
      const nodeTarget = event.target.closest?.('[data-node-id]');
      if (nodeTarget) {
        event.stopPropagation();
        this.selectNode(nodeTarget.dataset.nodeId);
        return;
      }
      const edgeTarget = event.target.closest?.('[data-edge-id]');
      if (edgeTarget) {
        event.stopPropagation();
        this.selectEdge(edgeTarget.dataset.edgeId);
      }
    };
    svg.onmousedown = event => {
      const nodeTarget = event.target.closest?.('[data-node-id]');
      if (!nodeTarget) return;
      const node = this.layer.getNode(nodeTarget.dataset.nodeId);
      if (!node) return;
      event.preventDefault?.();
      this.selectNode(node.id);
      this._drag = {
        nodeId: String(node.id),
        startX: event.clientX,
        startY: event.clientY,
        origin: { ...(node.position || { x: 0, y: 0 }) }
      };
      this._bindDrag();
    };
  }

  _bindDrag() {
    if (this._dragBound) return;
    this._dragBound = true;
    this._onDragMove = event => {
      const drag = this._drag;
      if (!drag || !this.region || !this.metrics) return;
      const { chunkWidth, chunkHeight } = this.region;
      const { thumbW, thumbH } = this.metrics;
      const dx = (event.clientX - drag.startX) * (Number(chunkWidth) / thumbW);
      const dy = (event.clientY - drag.startY) * (Number(chunkHeight) / thumbH);
      this.moveNode(drag.nodeId, { x: drag.origin.x + dx, y: drag.origin.y + dy });
    };
    this._onDragEnd = () => {
      this._drag = null;
    };
    document.addEventListener('mousemove', this._onDragMove);
    document.addEventListener('mouseup', this._onDragEnd);
  }

  _teardownDrag() {
    if (this._onDragMove) document.removeEventListener('mousemove', this._onDragMove);
    if (this._onDragEnd) document.removeEventListener('mouseup', this._onDragEnd);
    this._dragBound = false;
    this._onDragMove = null;
    this._onDragEnd = null;
    this._drag = null;
  }

  /**
   * 不可达原因：只读快照 + 结构连通性（忽略通行）推断第一个阻断原因。
   * 不重新判定通行，只读取 snapshot 里已有的 status/reasons。
   */
  _explainUnreachable(fromId, toId) {
    const structural = this._structuralPath(fromId, toId);
    if (!structural) return 'noPath';
    const snapshot = this.layer.getSnapshot();
    let worst = 'noPath';
    for (const edgeId of structural) {
      const entry = snapshot.edges[edgeId];
      if (!entry || entry.passable) continue;
      for (const reason of entry.reasons || []) {
        if (reason === 'terrainBlocked') return 'terrainBlocked';
        if (reason.startsWith('blockedUntilDay')) worst = 'blockedByDay';
        else if (reason.startsWith('passBlocked') || reason.startsWith('crossingHeldByEnemy')) worst = 'passBlocked';
        else if (reason === 'factionNotAllowed') worst = 'hostileBlocked';
      }
      if (worst === 'noPath') worst = 'passBlocked';
    }
    return worst;
  }

  /** 忽略通行状态的 BFS（仅用于解释「为什么不可达」，不参与寻路结果）。 */
  _structuralPath(fromId, toId) {
    if (!this.layer.nodes.has(fromId) || !this.layer.nodes.has(toId)) return null;
    const adjacency = new Map();
    for (const edge of this.layer.edges.values()) {
      const from = String(edge.from);
      const to = String(edge.to);
      if (!adjacency.has(from)) adjacency.set(from, []);
      if (!adjacency.has(to)) adjacency.set(to, []);
      adjacency.get(from).push({ to, edgeId: edge.id });
      if (edge.bidirectional !== false) adjacency.get(to).push({ to: from, edgeId: edge.id });
    }
    const queue = [fromId];
    const previous = new Map([[fromId, null]]);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === toId) break;
      for (const step of adjacency.get(current) || []) {
        if (previous.has(step.to)) continue;
        previous.set(step.to, { from: current, edgeId: step.edgeId });
        queue.push(step.to);
      }
    }
    if (!previous.has(toId)) return null;
    const edgeIds = [];
    let cursor = toId;
    while (cursor !== fromId) {
      const step = previous.get(cursor);
      if (!step) return null;
      edgeIds.unshift(step.edgeId);
      cursor = step.from;
    }
    return edgeIds;
  }
}

export default WorldLogicEditor;

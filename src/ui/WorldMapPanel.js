/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-08
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { UIElement } from './UIElement.js';
import { WorldCommandRing } from './WorldCommandRing.js';

/** 一格世界 chunk 在大地图上的基准像素宽度（96 / 1280 = 7.5%）。 */
const CELL_WIDTH = 96;
/** 面板内边距与标题栏/图例高度。 */
const PAD = 24;
const HEADER_H = 54;
const LEGEND_H = 42;

const TERRAIN_COLORS = Object.freeze({
  mountain: '#6f6b63',
  forest: '#3f6b3a',
  yellowRiver: '#3f6f9a',
  plain: '#8a7a4e'
});
const SCENE_NO_TERRAIN_COLOR = '#57503f';
const EMPTY_CELL_COLOR = '#1c1a17';
const GRID_LINE_COLOR = 'rgba(0, 0, 0, 0.28)';
const PLAYER_COLOR = '#59d96b';
const CITY_FACTION_COLORS = Object.freeze({
  yellow_turban: '#d9a521',
  han_government: '#4a6f9a'
});
const CITY_DEFAULT_COLOR = '#cfcfcf';
const CITY_SCENE_PATTERN = /^city\.s(\d{2})_/;

/** 通行状态色（逻辑层派生结果的表现映射；面板不做任何通行判定）。 */
const ROUTE_STATUS_COLORS = Object.freeze({
  passable: 'rgba(89, 217, 107, 0.24)',
  hostile: 'rgba(214, 74, 60, 0.36)',
  closed: 'rgba(230, 150, 40, 0.36)',
  terrain: 'rgba(28, 26, 23, 0.72)',
  invalid: 'rgba(160, 40, 160, 0.34)',
  noRoute: 'rgba(140, 140, 140, 0.10)'
});
const ROUTE_EDGE_LINE_COLORS = Object.freeze({
  passable: 'rgba(120, 220, 130, 0.55)',
  hostile: 'rgba(226, 96, 80, 0.8)',
  closed: 'rgba(235, 170, 70, 0.8)',
  terrain: 'rgba(150, 145, 135, 0.6)',
  invalid: 'rgba(200, 90, 200, 0.8)'
});
const NODE_KIND_GLYPHS = Object.freeze({
  city: '城',
  pass: '关',
  bridge: '桥',
  ferry: '渡',
  junction: '岔',
  camp: '营'
});

const terrainColor = terrain => TERRAIN_COLORS[terrain] || null;

/**
 * 大地图面板（M 键）。
 *
 * 展示当前 Region 的世界地形网格、场景锚点、城池与玩家位置，支持按住左键拖动查看。
 * 数据全部通过 setDataProviders 惰性拉取，便于运行时替换世界/玩家而不重建面板；
 * 地形块绘制到离屏 canvas 缓存，逐帧只绘制动态标记。
 */
export class WorldMapPanel extends UIElement {
  /**
   * @param {Object} options - UIElement 配置（x/y/width/height/visible）
   */
  constructor(options = {}) {
    super({ ...options, visible: options.visible === true });
    this.zIndex = options.zIndex ?? 900;

    this._providers = {
      getWorldIndex: null,
      getRegionId: null,
      getPlayer: null,
      getSceneId: null,
      getCityStates: null,
      getProject: null,
      getArmyStates: null,
      getWorldLogic: null,
      getRoutePreview: null,
      getOrderDefinitions: null,
      getPendingEncounter: null,
      // 建筑前 NPC：只读 storyState.buildingNpcUnlocked（未解锁由面板置灰）
      getNpcMarkers: null
    };

    // 地图像素尺寸与滚动量（地图坐标系，px）
    this._mapWidth = 0;
    this._mapHeight = 0;
    this._pxPerWorld = 1;
    this._scrollX = 0;
    this._scrollY = 0;
    this._viewport = { left: PAD, top: HEADER_H, width: 1, height: 1 };

    // 静态地形缓存
    this._staticCanvas = null;
    this._staticSignature = '';
    this._cities = [];
    this._logicNodes = [];
    this._armies = [];
    this._npcs = [];
    this._preview = null;
    this._previewDirty = true;

    // 选中标记与指令环（4A）
    this._ring = new WorldCommandRing();
    this._selected = null;
    /** 待选目标的指令（move/attack 需要第二次点选目标；不落任何通行判定） */
    this._pendingOrder = null;
    this.onSelect = null;
    this.onCommand = null;
    /** 建筑 NPC 点选回调（已解锁才打开对话；未解锁只给提示） */
    this.onNpcSelect = null;
    /** 四选确认回调（4C）：({unitId, encounterId, choice}) => void */
    this.onEncounterDecide = null;
    /** @type {Array<{x:number,y:number,w:number,h:number,choice:string,enabled:boolean}>} */
    this._encounterRects = [];

    // 拖拽状态
    this._drag = { active: false, moved: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0 };
    this._wasMouseDown = false;
  }

  /** 选中/下令回调（宿主转 commands）；null 时只显示。 */
  setHandlers({ onSelect = null, onCommand = null, onEncounterDecide = null, onNpcSelect = null } = {}) {
    this.onSelect = typeof onSelect === 'function' ? onSelect : null;
    this.onCommand = typeof onCommand === 'function' ? onCommand : null;
    this.onEncounterDecide = typeof onEncounterDecide === 'function' ? onEncounterDecide : null;
    this.onNpcSelect = typeof onNpcSelect === 'function' ? onNpcSelect : null;
    return this;
  }

  /** 注入惰性数据源（全部可选，缺失时降级为空地图/无标记）。 */
  setDataProviders(providers = {}) {
    for (const key of Object.keys(this._providers)) {
      const next = providers[key];
      this._providers[key] = typeof next === 'function' ? next : null;
    }
    this._staticSignature = '';
    return this;
  }

  open() {
    if (!this.visible) this.visible = true;
    this._ring.close();
    this._selected = null;
    this._pendingOrder = null;
    this._refreshCities();
    this._refreshLogicNodes();
    this._refreshArmies();
    this._refreshNpcs();
    this._previewDirty = true;
    this._rebuildStaticCache();
    this.refreshLayout();
    this._centerOnPlayer();
    this._drag = { active: false, moved: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0 };
    this._wasMouseDown = false;
    return true;
  }

  close() {
    this.visible = false;
    this._drag.active = false;
    this._drag.moved = false;
    this._ring.close();
    this._selected = null;
    this._pendingOrder = null;
    return false;
  }

  toggle() {
    return this.visible ? this.close() : this.open();
  }

  /** 依据面板尺寸重算视口并夹紧滚动量。 */
  refreshLayout() {
    const left = this.x + PAD;
    const top = this.y + HEADER_H;
    const width = Math.max(1, this.width - PAD * 2);
    const height = Math.max(1, this.height - HEADER_H - LEGEND_H - PAD / 2);
    this._viewport = { left, top, width, height };
    this._applyRegionMetrics();
    this._clampScroll();
    return this._viewport;
  }

  /** 世界坐标 → 地图像素坐标。 */
  worldToMap(x, y) {
    const bounds = this._regionBounds();
    return {
      x: (Number(x) - bounds.left) * this._pxPerWorld,
      y: (Number(y) - bounds.top) * this._pxPerWorld
    };
  }

  /** 地图像素坐标 → 屏幕坐标。 */
  mapToScreen(x, y) {
    return {
      x: this._viewport.left + x - this._scrollX,
      y: this._viewport.top + y - this._scrollY
    };
  }

  /** 可见时返回 true（模态），并处理拖拽与按钮点击。 */
  handleInput({ inputManager } = {}) {
    if (!this.visible) return false;
    const mouse = inputManager?.getMousePosition?.() || { x: 0, y: 0 };
    const down = inputManager?.isMouseButtonDown?.(0) === true;

    // 四选确认框（4C）：模态优先，弹窗存在时吞掉其余输入。
    if (this._encounterRects.length > 0) {
      if (down && !this._wasMouseDown) {
        const hit = this._encounterAt(mouse.x, mouse.y);
        if (hit?.enabled) this._handleEncounterHit(hit.choice);
        this._wasMouseDown = true;
        return true;
      }
      if (!down) this._wasMouseDown = false;
      return true;
    }

    if (down && !this._wasMouseDown) {
      const button = this._buttonAt(mouse.x, mouse.y);
      if (button === 'close') {
        this.close();
        this._wasMouseDown = true;
        return true;
      }
      if (button === 'recenter') {
        this._centerOnPlayer();
        this._wasMouseDown = true;
        return true;
      }
      // 指令环 > 标记 > 拖拽（4A：点选与拖图互不吞事件）
      const ringHit = this._ring.hitTest(mouse.x, mouse.y);
      if (ringHit) {
        this._handleRingHit(ringHit);
        this._wasMouseDown = true;
        return true;
      }
      const marker = this._markerAt(mouse.x, mouse.y);
      if (marker) {
        this._handleMarkerClick(marker);
        this._wasMouseDown = true;
        return true;
      }
      this._drag = {
        active: true,
        moved: false,
        startX: mouse.x,
        startY: mouse.y,
        scrollX: this._scrollX,
        scrollY: this._scrollY
      };
    }

    if (down && this._drag.active) {
      const dx = mouse.x - this._drag.startX;
      const dy = mouse.y - this._drag.startY;
      if (!this._drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) this._drag.moved = true;
      if (this._drag.moved) {
        this._scrollX = this._drag.scrollX - dx;
        this._scrollY = this._drag.scrollY - dy;
        this._clampScroll();
      }
    } else if (!down) {
      this._drag.active = false;
      this._drag.moved = false;
    }

    this._wasMouseDown = down;
    return true;
  }

  /** UIClickHandler 兜底：可见即消费点击，并处理按钮/指令环/标记。 */
  handleMouseClick(x, y) {
    if (!this.visible) return false;
    if (this._encounterRects.length > 0) {
      const hit = this._encounterAt(x, y);
      if (hit?.enabled) this._handleEncounterHit(hit.choice);
      return true;
    }
    const button = this._buttonAt(x, y);
    if (button === 'close') this.close();
    else if (button === 'recenter') this._centerOnPlayer();
    else {
      const ringHit = this._ring.hitTest(x, y);
      if (ringHit) this._handleRingHit(ringHit);
      else {
        const marker = this._markerAt(x, y);
        if (marker) this._handleMarkerClick(marker);
        else {
          this._ring.close();
          this._selected = null;
          this._pendingOrder = null;
        }
      }
    }
    return true;
  }

  render(ctx) {
    if (!this.visible) return;
    ctx.save();
    if (this.alpha < 1) ctx.globalAlpha = this.alpha;

    // 遮罩
    ctx.fillStyle = 'rgba(6, 5, 4, 0.78)';
    ctx.fillRect(this.x, this.y, this.width, this.height);

    const panel = this._panelRect();
    ctx.fillStyle = 'rgba(24, 20, 15, 0.96)';
    this._roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 10);
    ctx.fill();
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 2;
    this._roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 10);
    ctx.stroke();

    // 标题
    ctx.fillStyle = '#f0d9a8';
    ctx.font = 'bold 20px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('大地图', panel.x + PAD, panel.y + HEADER_H / 2 + 2);

    this._renderButtons(ctx, panel);
    // 军团位置/路线逐帧变化（战略刻），每帧重取；不做任何通行计算。
    this._refreshArmies();
    this._renderMap(ctx);
    this._renderLegend(ctx, panel);
    this._renderCommandRing(ctx);
    this._renderEncounter(ctx, panel);

    ctx.restore();
  }

  // ─── 内部：数据 ─────────────────────────────────────────

  _region() {
    const index = this._providers.getWorldIndex?.();
    if (!index || typeof index.getRegion !== 'function') return null;
    const regionId = this._providers.getRegionId?.();
    return index.getRegion(regionId ?? 0) || index.getRegion(0) || null;
  }

  _regionBounds() {
    const region = this._region();
    return region?.bounds || { left: 0, top: 0, width: 0, height: 0 };
  }

  _applyRegionMetrics() {
    const region = this._region();
    if (!region || !region.bounds) {
      this._mapWidth = 0;
      this._mapHeight = 0;
      this._pxPerWorld = 1;
      return;
    }
    const chunkWidth = region.chunkWidth > 0 ? region.chunkWidth : 1280;
    const chunkHeight = region.chunkHeight > 0 ? region.chunkHeight : 720;
    this._pxPerWorld = CELL_WIDTH / chunkWidth;
    this._cellWidth = CELL_WIDTH;
    this._cellHeight = CELL_WIDTH * (chunkHeight / chunkWidth);
    this._mapWidth = region.cols * CELL_WIDTH;
    this._mapHeight = region.rows * this._cellHeight;
  }

  _clampScroll() {
    const viewW = this._viewport.width;
    const viewH = this._viewport.height;
    const clampAxis = (value, content, view) => {
      if (content <= view) return (content - view) / 2;
      return Math.min(Math.max(0, value), content - view);
    };
    this._scrollX = clampAxis(this._scrollX, this._mapWidth, viewW);
    this._scrollY = clampAxis(this._scrollY, this._mapHeight, viewH);
  }

  _centerOnPlayer() {
    const player = this._playerWorldPosition();
    if (!player || this._mapWidth <= 0) return;
    const map = this.worldToMap(player.x, player.y);
    this._scrollX = map.x - this._viewport.width / 2;
    this._scrollY = map.y - this._viewport.height / 2;
    this._clampScroll();
  }

  _playerWorldPosition() {
    const raw = this._providers.getPlayer?.();
    if (!raw) return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  _currentSceneId() {
    const raw = String(this._providers.getSceneId?.() || '');
    return raw.replace(/-C\d{2}$/, '');
  }

  _cityStates() {
    const states = this._providers.getCityStates?.();
    if (Array.isArray(states)) return states;
    return this._providers.getProject?.()?.variables?.cityStates || [];
  }

  /** 城池 id 前缀 city.sNN_* → 场景 SNN 锚点中心（世界坐标）。 */
  _refreshCities() {
    this._cities = [];
    const index = this._providers.getWorldIndex?.();
    if (!index || typeof index.findScene !== 'function') return;
    for (const state of this._cityStates()) {
      const match = CITY_SCENE_PATTERN.exec(String(state?.id || ''));
      if (!match) continue;
      const sceneId = `S${match[1]}`;
      const anchor = index.findScene(sceneId);
      if (!anchor || !anchor.offset) continue;
      this._cities.push({
        id: state.id,
        name: state.name || sceneId,
        factionId: state.factionId || '',
        sceneId,
        x: anchor.offset.x + (anchor.worldWidth || 0) / 2,
        y: anchor.offset.y + (anchor.worldHeight || 0) / 2
      });
    }
  }

  /** 逻辑节点标记（worldLogic 优先；与城池状态按 ref.id 绑定）。 */
  _refreshLogicNodes() {
    this._logicNodes = [];
    const logic = this._providers.getWorldLogic?.();
    const nodes = Array.isArray(logic?.nodes) ? logic.nodes : [];
    if (nodes.length === 0) return;
    const cityStates = new Map(this._cityStates().map(state => [String(state?.id), state]));
    for (const node of nodes) {
      if (!node?.id || !node.position) continue;
      const x = Number(node.position.x);
      const y = Number(node.position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const state = node.ref?.id != null ? cityStates.get(String(node.ref.id)) : null;
      this._logicNodes.push({
        id: String(node.id),
        kind: node.kind || 'junction',
        name: node.name || state?.name || String(node.id),
        factionId: state?.factionId || node.ownerFactionId || '',
        x,
        y
      });
    }
  }

  /** 军团标记（armyStates：position 由逻辑层/执行器权威维护）。 */
  _refreshArmies() {
    const raw = this._providers.getArmyStates?.();
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
    this._armies = [];
    for (const state of list) {
      const x = Number(state?.position?.x);
      const y = Number(state?.position?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      this._armies.push({
        id: String(state.id || state.armyId || ''),
        kind: 'army',
        name: state.name || String(state.id || ''),
        factionId: state.factionId || '',
        x,
        y,
        route: state.route || null,
        order: state.order || null
      });
    }
  }

  /** 建筑前 NPC 标记（解锁事实由数据源给出；面板只负责置灰与命中）。 */
  _refreshNpcs() {
    const raw = this._providers.getNpcMarkers?.();
    const list = Array.isArray(raw) ? raw : [];
    this._npcs = [];
    for (const marker of list) {
      const x = Number(marker?.x);
      const y = Number(marker?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      this._npcs.push({
        id: String(marker.id || `npc:${marker.npcId || ''}`),
        npcId: String(marker.npcId || ''),
        kind: 'npc',
        name: marker.name || String(marker.npcId || ''),
        title: marker.title || '',
        sceneId: marker.sceneId || '',
        unlocked: marker.unlocked === true,
        x,
        y
      });
    }
  }

  _markerScreen(marker) {    const map = this.worldToMap(marker.x, marker.y);
    return this.mapToScreen(map.x, map.y);
  }

  /** 命中标记：军团 > 建筑 NPC > 逻辑节点 > 旧城池推导（14px 半径）。 */
  _markerAt(x, y) {
    const legacies = this._logicNodes.length === 0
      ? this._cities.map(city => ({ ...city, kind: 'city' }))
      : [];
    const candidates = [...this._armies, ...this._npcs, ...this._logicNodes, ...legacies];
    let best = null;
    for (const marker of candidates) {
      const screen = this._markerScreen(marker);
      const distance = Math.hypot(screen.x - x, screen.y - y);
      if (distance > 14) continue;
      if (!best || distance < best.distance) best = { marker, distance };
    }
    return best ? best.marker : null;
  }

  /**
   * 标记点击：处于「待选目标」时把本次点击作为目标消费（move/attack），
   * 否则正常打开指令环。目标坐标只取自标记，不做任何通行/可达判定。
   */
  _handleMarkerClick(marker) {
    // 建筑 NPC：不打开指令环，直接交给宿主打开同一套对话（未解锁由宿主给提示）。
    if (marker?.kind === 'npc') {
      this._ring.close();
      this._selected = null;
      this.onNpcSelect?.(marker);
      return;
    }
    const pending = this._pendingOrder;
    if (pending) {
      this._pendingOrder = null;
      this.onCommand?.({
        marker: pending.marker,
        tab: 'orders',
        key: pending.key,
        target: { x: marker.x, y: marker.y },
        targetMarker: marker
      });
      return;
    }
    this._selectMarker(marker);
  }

  _selectMarker(marker) {
    this._selected = marker;
    const screen = this._markerScreen(marker);
    this._ring.open({ x: screen.x, y: screen.y, markerId: marker.id, tabs: this._ringTabs() });
    this.onSelect?.(marker);
  }

  _ringTabs() {
    const definitions = this._providers.getOrderDefinitions?.();
    const list = Array.isArray(definitions) && definitions.length > 0
      ? definitions
      : [
        { key: 'attack', label: '进攻' },
        { key: 'defend', label: '防守' },
        { key: 'transport', label: '运输' },
        { key: 'move', label: '移动' },
        { key: 'camp', label: '扎营' }
      ];
    return [
      {
        key: 'orders',
        label: '指令',
        items: list.map(entry => ({
          key: String(entry.key),
          label: entry.label ? String(entry.label) : String(entry.key),
          disabled: entry.disabled === true
        }))
      },
      {
        key: 'deploy',
        label: '部署',
        items: [{ key: 'front', label: '前' }, { key: 'mid', label: '中' }, { key: 'rear', label: '后' }]
      }
    ];
  }

  _handleRingHit(hit) {
    if (hit.kind === 'tab') {
      this._ring.setActiveTab(hit.key);
      return;
    }
    if (hit.kind === 'close') {
      this._ring.close();
      this._selected = null;
      return;
    }
    if (hit.kind !== 'item' || hit.disabled) return;
    // 需要目标地点的指令：收起指令环，进入一次点选（下一次点标记即目标）。
    if (this._ring.activeTab === 'orders' && (hit.key === 'move' || hit.key === 'attack')
      && this._selected) {
      this._pendingOrder = { marker: this._selected, key: hit.key };
      this._ring.close();
      return;
    }
    const payload = { marker: this._selected, tab: this._ring.activeTab, key: hit.key };
    // 指令下达后自动收起（选择是瞬态的，不存在滞留指挥模式）。
    this._ring.close();
    this._selected = null;
    this._previewDirty = true;
    this.onCommand?.(payload);
  }

  // ─── 内部：渲染 ─────────────────────────────────────────

  _panelRect() {
    const w = Math.min(this.width - PAD, 1000);
    const h = Math.min(this.height - PAD, 720);
    return {
      x: this.x + (this.width - w) / 2,
      y: this.y + (this.height - h) / 2,
      w,
      h
    };
  }

  _buttonRects() {
    const panel = this._panelRect();
    const top = panel.y + 14;
    const size = 26;
    return {
      close: { x: panel.x + panel.w - PAD - size, y: top, w: size, h: size, label: '×' },
      recenter: { x: panel.x + panel.w - PAD - size * 2 - 8, y: top, w: size, h: size, label: '回' }
    };
  }

  _buttonAt(x, y) {
    const rects = this._buttonRects();
    for (const [name, rect] of Object.entries(rects)) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return name;
    }
    return null;
  }

  _renderButtons(ctx, panel) {
    const rects = this._buttonRects();
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const rect of Object.values(rects)) {
      ctx.fillStyle = 'rgba(60, 50, 38, 0.95)';
      this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
      ctx.fill();
      ctx.strokeStyle = '#8B7355';
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
      ctx.stroke();
      ctx.fillStyle = '#f0d9a8';
      ctx.fillText(rect.label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    }
  }

  _renderMap(ctx) {
    const region = this._region();
    if (!region || !Array.isArray(region.coverage) || region.coverage.length === 0) {
      ctx.fillStyle = 'rgba(240, 217, 168, 0.7)';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('暂无可显示的世界地图', this._viewport.left + this._viewport.width / 2,
        this._viewport.top + this._viewport.height / 2);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(this._viewport.left, this._viewport.top, this._viewport.width, this._viewport.height);
    ctx.clip();

    const cache = this._staticCanvas;
    if (cache) {
      const origin = this.mapToScreen(0, 0);
      // 只 blit 视口覆盖的地图区域：地图比视口大时避免整张缓存逐帧 overdraw。
      const dstLeft = Math.max(this._viewport.left, origin.x);
      const dstTop = Math.max(this._viewport.top, origin.y);
      const dstRight = Math.min(this._viewport.left + this._viewport.width, origin.x + cache.width);
      const dstBottom = Math.min(this._viewport.top + this._viewport.height, origin.y + cache.height);
      const w = dstRight - dstLeft;
      const h = dstBottom - dstTop;
      if (w > 0 && h > 0) {
        ctx.drawImage(cache, dstLeft - origin.x, dstTop - origin.y, w, h, dstLeft, dstTop, w, h);
      }
    }

    // 通行色叠加（WorldRouteLayer 派生投影，面板只读快照，不做通行判定）
    this._renderPassability(ctx);

    // 场景锚点标签
    const currentScene = this._currentSceneId();
    const cityScenes = new Set(this._cities.map(city => city.sceneId));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    for (const anchor of region.cells || []) {
      if (!anchor || !anchor.loadable) continue;
      const center = this.worldToMap(
        anchor.offset.x + anchor.worldWidth / 2,
        anchor.offset.y + anchor.worldHeight / 2
      );
      const screen = this.mapToScreen(center.x, center.y);
      if (!this._inViewport(screen.x, screen.y, 24)) continue;
      const isCurrent = anchor.sceneId === currentScene;
      ctx.fillStyle = isCurrent ? '#ffe9b0' : 'rgba(255, 255, 255, 0.55)';
      ctx.fillText(anchor.sceneId, screen.x, screen.y + (cityScenes.has(anchor.sceneId) ? 16 : 0));
    }

    // 城池（有 worldLogic 时由逻辑节点标记接管，避免同一位置双图元互抢命中）
    for (const city of (this._logicNodes.length === 0 ? this._cities : [])) {
      const map = this.worldToMap(city.x, city.y);
      const screen = this.mapToScreen(map.x, map.y);
      if (!this._inViewport(screen.x, screen.y, 40)) continue;
      const color = CITY_FACTION_COLORS[city.factionId] || CITY_DEFAULT_COLOR;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // 旗杆
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(screen.x, screen.y - 16);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y - 16);
      ctx.lineTo(screen.x + 9, screen.y - 12);
      ctx.lineTo(screen.x, screen.y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 12px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#f7e9c6';
      ctx.textAlign = 'left';
      ctx.fillText(city.name, screen.x + 11, screen.y - 12);
      ctx.textAlign = 'center';
      ctx.font = '11px system-ui, sans-serif';
    }

    // 军团路线与旗子、逻辑节点标记
    this._renderArmyRoutes(ctx);
    this._renderArmyFlags(ctx);
    this._renderLogicMarkers(ctx);
    this._renderNpcMarkers(ctx);

    // 玩家
    const player = this._playerWorldPosition();
    if (player) {
      const map = this.worldToMap(player.x, player.y);
      const screen = this.mapToScreen(map.x, map.y);
      const pulse = (Math.sin(Date.now() / 380) + 1) / 2;
      ctx.strokeStyle = `rgba(89, 217, 107, ${0.25 + pulse * 0.35})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 8 + pulse * 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = PLAYER_COLOR;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 每帧向逻辑层取派生投影（逻辑层按 revision 缓存，面板不做任何通行判定）。 */
  _refreshPreview() {
    this._previewDirty = false;
    const preview = this._providers.getRoutePreview?.(this._region());
    this._preview = preview && typeof preview === 'object' ? preview : null;
  }

  /** 通行色与边线（只读 getRoutePreview 的结果，颜色映射归本面板）。 */
  _renderPassability(ctx) {
    this._refreshPreview();
    const preview = this._preview;
    if (!preview) return;
    const cellW = this._cellWidth || CELL_WIDTH;
    const cellH = this._cellHeight || CELL_WIDTH;
    const origin = this.mapToScreen(0, 0);
    for (const cell of preview.overlay || []) {
      const color = ROUTE_STATUS_COLORS[cell.status];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(
        origin.x + cell.col * cellW,
        origin.y + cell.row * cellH,
        cellW + 0.5,
        cellH + 0.5
      );
    }
    for (const edge of preview.edges || []) {
      if (!edge?.fromPosition || !edge?.toPosition) continue;
      const a = this._markerScreen(edge.fromPosition);
      const b = this._markerScreen(edge.toPosition);
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = ROUTE_EDGE_LINE_COLORS[edge.status] || 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 行军路线虚线 + 终点圈。 */
  _renderArmyRoutes(ctx) {
    const nodeById = new Map(this._logicNodes.map(node => [node.id, node]));
    for (const army of this._armies) {
      const route = army.route;
      if (!route) continue;
      const points = Array.isArray(route.points) && route.points.length > 1
        ? route.points
        : (route.nodeIds || []).map(id => nodeById.get(String(id))).filter(Boolean);
      if (points.length < 2) continue;
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = this._selected?.id === army.id
        ? '#ffe9b0'
        : 'rgba(240, 217, 168, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const first = this._markerScreen(points[0]);
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < points.length; index += 1) {
        const point = this._markerScreen(points[index]);
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();

      const last = this._markerScreen(points[points.length - 1]);
      ctx.strokeStyle = '#ffe9b0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 军团旗子（位置来自 armyStates，已由逻辑层权威维护）。 */
  _renderArmyFlags(ctx) {
    for (const army of this._armies) {
      const screen = this._markerScreen(army);
      if (!this._inViewport(screen.x, screen.y, 24)) continue;
      const color = CITY_FACTION_COLORS[army.factionId] || CITY_DEFAULT_COLOR;
      const selected = this._selected?.id === army.id;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y + 4);
      ctx.lineTo(screen.x, screen.y - 15);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y - 15);
      ctx.lineTo(screen.x + 11, screen.y - 11);
      ctx.lineTo(screen.x, screen.y - 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = selected ? '#fff4d8' : '#e8d5ab';
      ctx.font = '10px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(army.name || army.id, screen.x + 13, screen.y - 11);
      ctx.textAlign = 'center';
      if (selected) {
        ctx.strokeStyle = '#ffe9b0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** 四类逻辑标记：城 / 关 / 桥 / 渡（另有岔路、营寨）。 */
  _renderLogicMarkers(ctx) {
    if (this._logicNodes.length === 0) return;
    for (const node of this._logicNodes) {
      const screen = this._markerScreen(node);
      if (!this._inViewport(screen.x, screen.y, 24)) continue;
      const color = CITY_FACTION_COLORS[node.factionId] || CITY_DEFAULT_COLOR;
      const half = 8;
      ctx.fillStyle = 'rgba(20, 16, 12, 0.85)';
      ctx.fillRect(screen.x - half, screen.y - half, half * 2, half * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(screen.x - half, screen.y - half, half * 2, half * 2);
      ctx.fillStyle = color;
      ctx.font = 'bold 9px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(NODE_KIND_GLYPHS[node.kind] || '·', screen.x, screen.y + 1);
      ctx.fillStyle = '#f7e9c6';
      ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(node.name || '', screen.x + half + 3, screen.y - 2);
      ctx.textAlign = 'center';
    }
  }

  /** 建筑 NPC 标记：已解锁实心可点，未解锁置灰（点击由宿主给「先到实地」提示）。 */
  _renderNpcMarkers(ctx) {
    for (const npc of this._npcs) {
      const screen = this._markerScreen(npc);
      if (!this._inViewport(screen.x, screen.y, 30)) continue;
      const color = npc.unlocked ? '#ffe9b0' : 'rgba(240, 217, 168, 0.28)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
      ctx.stroke();
      if (npc.unlocked) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(npc.name || '', screen.x + 8, screen.y - 2);
      ctx.textAlign = 'center';
    }
  }

  _renderCommandRing(ctx) {
    if (this._ring.visible) this._ring.render(ctx);
    if (!this._pendingOrder) return;
    // 待选目标提示（纯提示文案，不参与任何通行判定）
    const view = this._viewport;
    ctx.save();
    ctx.fillStyle = 'rgba(24, 20, 15, 0.86)';
    this._roundRect(ctx, view.left + view.width / 2 - 130, view.top + 8, 260, 26, 6);
    ctx.fill();
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    this._roundRect(ctx, view.left + view.width / 2 - 130, view.top + 8, 260, 26, 6);
    ctx.stroke();
    ctx.fillStyle = '#f0d9a8';
    ctx.font = '13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('点击目标地点下达指令', view.left + view.width / 2, view.top + 21);
    ctx.restore();
  }

  // ─── 四选确认框（4C）──────────────────────────────────────

  /**
   * 遭遇确认框（撞见时弹，不是判定后直接结算）。
   * 纯展示 + 命中表：后果说明与置灰只读 `encounter.available`，不做任何结算。
   */
  _renderEncounter(ctx, panel) {
    const encounter = this._providers.getPendingEncounter?.() || null;
    this._encounterRects = [];
    if (!encounter) return;

    const cardW = Math.min(580, Math.max(360, panel.w - 96));
    const cardH = 272;
    const cardX = panel.x + (panel.w - cardW) / 2;
    const cardY = panel.y + (panel.h - cardH) / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(6, 5, 4, 0.58)';
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.fillStyle = 'rgba(30, 25, 18, 0.98)';
    this._roundRect(ctx, cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.strokeStyle = '#c9a15a';
    ctx.lineWidth = 2;
    this._roundRect(ctx, cardX, cardY, cardW, cardH, 12);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0d9a8';
    ctx.font = 'bold 20px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText('遭遇敌军', cardX + 20, cardY + 30);

    const kindLabel = encounter.kind === 'city' ? '攻城' : (encounter.kind === 'pass' ? '关隘' : '野战');
    const node = (this._logicNodes || []).find(entry => entry && entry.id === encounter.nodeId);
    const targetName = node?.name ? ` · ${node.name}` : '';
    ctx.fillStyle = '#c9bfa8';
    ctx.font = '13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText(`${kindLabel}${targetName} · ${encounter.unitId || ''}`, cardX + 20, cardY + 56);

    // 超时倒计时（到点由场景层默认撤退；这里只画剩余量）
    const total = Math.max(1, Number(encounter.expiresAt) - Number(encounter.createdAt) || 8000);
    const ratio = Math.max(0, Math.min(1, (Number(encounter.remainingMs) || 0) / total));
    const barW = cardW - 40;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(cardX + 20, cardY + 70, barW, 6);
    ctx.fillStyle = ratio < 0.3 ? '#d64a3c' : '#c9a15a';
    ctx.fillRect(cardX + 20, cardY + 70, barW * ratio, 6);

    const options = [
      { choice: 'ambush', label: '埋伏', hint: '先手 · 消耗 1 刻 · 攻方加成' },
      { choice: 'detour', label: '绕道', hint: '不战 · 不耗刻 · 改走替代路线' },
      { choice: 'fight', label: '战斗', hint: '公式结算 · 败则强制撤退' },
      { choice: 'retreat', label: '撤退', hint: '不战 · 消耗 1 刻 · 士气与位置代价' }
    ];
    const buttonW = (cardW - 60) / 2;
    const buttonH = 52;
    options.forEach((option, index) => {
      const x = cardX + 20 + (index % 2) * (buttonW + 20);
      const y = cardY + 96 + Math.floor(index / 2) * (buttonH + 14);
      const enabled = encounter.available?.[option.choice] !== false;
      ctx.fillStyle = enabled ? 'rgba(70, 58, 40, 0.95)' : 'rgba(52, 48, 42, 0.6)';
      this._roundRect(ctx, x, y, buttonW, buttonH, 8);
      ctx.fill();
      ctx.strokeStyle = enabled ? '#a98a52' : 'rgba(120, 112, 100, 0.5)';
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, x, y, buttonW, buttonH, 8);
      ctx.stroke();
      ctx.fillStyle = enabled ? '#f0d9a8' : 'rgba(190, 182, 165, 0.45)';
      ctx.font = 'bold 15px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(option.label, x + 14, y + 18);
      ctx.fillStyle = enabled ? '#c9bfa8' : 'rgba(190, 182, 165, 0.35)';
      ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(enabled ? option.hint : '当前不可用', x + 14, y + 38);
      this._encounterRects.push({ x, y, w: buttonW, h: buttonH, choice: option.choice, enabled });
    });

    ctx.restore();
  }

  _encounterAt(x, y) {
    for (const rect of this._encounterRects) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return rect;
    }
    return null;
  }

  _handleEncounterHit(choice) {
    const encounter = this._providers.getPendingEncounter?.() || null;
    if (!encounter || !this.onEncounterDecide) return;
    this.onEncounterDecide({
      unitId: encounter.unitId,
      encounterId: encounter.id,
      choice
    });
  }

  _renderLegend(ctx, panel) {
    const y = panel.y + panel.h - LEGEND_H / 2 + 4;
    let x = panel.x + PAD;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '12px system-ui, sans-serif';
    const items = [
      { color: TERRAIN_COLORS.mountain, label: '山脉' },
      { color: TERRAIN_COLORS.forest, label: '森林' },
      { color: TERRAIN_COLORS.yellowRiver, label: '河流' },
      { color: TERRAIN_COLORS.plain, label: '平原' },
      // 通行四色（逻辑层派生状态的展示映射；灰=地形挡 / 无路，红=敌情挡）
      { color: ROUTE_STATUS_COLORS.passable, label: '可通' },
      { color: ROUTE_STATUS_COLORS.hostile, label: '敌占' },
      { color: ROUTE_STATUS_COLORS.closed, label: '封路' },
      { color: ROUTE_STATUS_COLORS.terrain, label: '险阻' },
      { color: ROUTE_STATUS_COLORS.noRoute, label: '无路' }
    ];
    for (const item of items) {
      ctx.fillStyle = item.color;
      ctx.fillRect(x, y - 6, 14, 12);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y - 6, 14, 12);
      ctx.fillStyle = '#cbb98f';
      ctx.fillText(item.label, x + 20, y);
      x += 20 + ctx.measureText(item.label).width + 18;
    }
    ctx.fillStyle = 'rgba(203, 185, 143, 0.75)';
    ctx.textAlign = 'right';
    ctx.fillText('M / ESC 关闭 · 拖动查看', panel.x + panel.w - PAD, y);
  }

  _inViewport(x, y, margin = 0) {
    return x >= this._viewport.left - margin
      && x <= this._viewport.left + this._viewport.width + margin
      && y >= this._viewport.top - margin
      && y <= this._viewport.top + this._viewport.height + margin;
  }

  _rebuildStaticCache() {
    if (typeof document === 'undefined') return;
    const region = this._region();
    this._applyRegionMetrics();
    if (!region || this._mapWidth <= 0 || this._mapHeight <= 0) {
      this._staticCanvas = null;
      this._staticSignature = '';
      return;
    }
    const signature = `${region.id}:${region.rows}x${region.cols}:${Math.round(this._mapWidth)}x${Math.round(this._mapHeight)}`;
    if (signature === this._staticSignature && this._staticCanvas) return;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(this._mapWidth));
    canvas.height = Math.max(1, Math.round(this._mapHeight));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this._staticCanvas = null;
      return;
    }
    ctx.fillStyle = EMPTY_CELL_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellW = this._cellWidth;
    const cellH = this._cellHeight;
    for (const cell of region.coverage) {
      if (!cell) continue;
      const color = terrainColor(cell.terrain)
        || (cell.sceneId ? SCENE_NO_TERRAIN_COLOR : EMPTY_CELL_COLOR);
      ctx.fillStyle = color;
      ctx.fillRect(cell.col * cellW, cell.row * cellH, cellW + 0.5, cellH + 0.5);
    }

    // 网格线
    ctx.strokeStyle = GRID_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = 0; col <= region.cols; col++) {
      const x = Math.round(col * cellW) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (let row = 0; row <= region.rows; row++) {
      const y = Math.round(row * cellH) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    // 场景 footprint 描边
    ctx.strokeStyle = 'rgba(255, 233, 176, 0.55)';
    ctx.lineWidth = 1.5;
    for (const anchor of region.cells || []) {
      if (!anchor || !anchor.loadable || !anchor.footprint) continue;
      const left = anchor.footprint.col * cellW;
      const top = anchor.footprint.row * cellH;
      ctx.strokeRect(left + 1, top + 1, anchor.footprint.cols * cellW - 2, anchor.footprint.rows * cellH - 2);
    }

    this._staticCanvas = canvas;
    this._staticSignature = signature;
  }

  _roundRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

export default WorldMapPanel;

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
      getProject: null
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

    // 拖拽状态
    this._drag = { active: false, moved: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0 };
    this._wasMouseDown = false;
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
    this._refreshCities();
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

  /** UIClickHandler 兜底：可见即消费点击，并处理按钮。 */
  handleMouseClick(x, y) {
    if (!this.visible) return false;
    const button = this._buttonAt(x, y);
    if (button === 'close') this.close();
    else if (button === 'recenter') this._centerOnPlayer();
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
    this._renderMap(ctx);
    this._renderLegend(ctx, panel);

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

    // 城池
    for (const city of this._cities) {
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
      { color: TERRAIN_COLORS.plain, label: '平原' }
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

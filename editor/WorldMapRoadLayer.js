/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * WorldMapRoadLayer - 世界地图编辑器的「路网」图层（只画、不改数据）
 *
 * 数据来源与抽取器完全一致：
 * - region.roadEdges（[[row,col],[row,col]]）→ 每条边画在相邻两格中心之间；
 * - cell.poi（pass/ferry）→ 格上边中点画关隘/渡口标识（与 WorldMapExtractor 落点一致）。
 *
 * 交互只上报意图，不改 region：
 * - connect 模式：先点 A 格再点 B 格 → onChange({type:'connect', a, b})
 * - delete 模式：点已有连线 → onChange({type:'delete', index})
 * 数据写入、自动补边、存盘与差异面板刷新都由 WorldMapEditor 负责。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const INTERACTIVE_SELECTOR = 'input,select,button,textarea,label,a';

export const ROAD_LAYER_MODES = Object.freeze(['connect', 'delete']);

export class WorldMapRoadLayer {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.gridEl - `.wme-grid`（与逻辑层共用同一坐标基准）
   * @param {Function|null} [options.onChange] - 路网意图回调
   */
  constructor({ gridEl, onChange = null } = {}) {
    this.gridEl = gridEl || null;
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.region = null;
    this.metrics = null;
    this.visible = false;
    this.mode = 'connect';
    this._pending = null;
    this._svg = null;
    this._onGridClick = event => this._handleGridClick(event);
    this._onSvgClick = event => this._handleSvgClick(event);
    this.gridEl?.addEventListener?.('click', this._onGridClick, true);
  }

  setVisible(visible) {
    this.visible = visible === true;
    if (this._svg) {
      this._svg.style.display = this.visible ? 'block' : 'none';
    }
    return this;
  }

  isVisible() {
    return this.visible;
  }

  setMode(mode) {
    this.mode = ROAD_LAYER_MODES.includes(mode) ? mode : 'connect';
    this._pending = null;
    this._draw();
    return this;
  }

  getMode() {
    return this.mode;
  }

  /** 用当前 region + 画布尺寸重绘；region 为草稿引用，只读。 */
  render(region, metrics = {}) {
    this.region = region || null;
    this.metrics = metrics || null;
    this._pending = null;
    this._draw();
    return this;
  }

  destroy() {
    this.gridEl?.removeEventListener?.('click', this._onGridClick, true);
    this._svg?.removeEventListener?.('click', this._onSvgClick);
    if (this._svg?.parentNode) this._svg.parentNode.removeChild(this._svg);
    this._svg = null;
    this.gridEl = null;
    this.onChange = null;
  }

  // ─── 绘制 ──────────────────────────────────────────────

  _ensureSvg() {
    if (!this.gridEl) return null;
    if (this._svg && this._svg.parentNode === this.gridEl) return this._svg;
    if (this._svg?.parentNode) this._svg.parentNode.removeChild(this._svg);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'wmr-overlay');
    // 只有删除模式下的命中线吃指针事件（见 _draw），其余时候让点击穿透到格子控件。
    svg.style.cssText = 'position:absolute;left:0;top:0;z-index:6;overflow:visible;pointer-events:none;';
    this.gridEl.appendChild(svg);
    svg.addEventListener('click', this._onSvgClick);
    this._svg = svg;
    return svg;
  }

  _cellMetrics() {
    const { thumbW, thumbH, labelH, gap = 0 } = this.metrics || {};
    if (!(Number(thumbW) > 0) || !(Number(thumbH) > 0)) return null;
    return {
      thumbW: Number(thumbW),
      thumbH: Number(thumbH),
      labelH: Number(labelH) || 0,
      gap: Number(gap) || 0,
      cellH: Number(thumbH) + (Number(labelH) || 0) + (Number(gap) || 0)
    };
  }

  _cellRect(row, col) {
    const m = this._cellMetrics();
    if (!m) return null;
    const x = col * (m.thumbW + m.gap);
    const y = row * m.cellH + m.labelH;
    return { x, y, w: m.thumbW, h: m.thumbH, cx: x + m.thumbW / 2, cy: y + m.thumbH / 2 };
  }

  _draw() {
    const svg = this._ensureSvg();
    if (!svg) return;
    const region = this.region;
    const m = this._cellMetrics();
    const cols = Math.max(0, Math.floor(Number(region?.cols) || 0));
    const rows = Math.max(0, Math.floor(Number(region?.rows) || 0));
    if (!region || !m || cols === 0 || rows === 0) {
      svg.innerHTML = '';
      this.setVisible(this.visible);
      return;
    }
    const width = cols * (m.thumbW + m.gap) - m.gap;
    const height = rows * m.cellH - m.gap;
    svg.setAttribute('width', String(Math.max(0, width)));
    svg.setAttribute('height', String(Math.max(0, height)));
    svg.style.width = `${Math.max(0, width)}px`;
    svg.style.height = `${Math.max(0, height)}px`;

    const parts = [];
    const edges = Array.isArray(region.roadEdges) ? region.roadEdges : [];
    parts.push('<g class="wmr-edges">');
    edges.forEach((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2) return;
      const from = this._cellRect(Number(pair[0]?.[0]), Number(pair[0]?.[1]));
      const to = this._cellRect(Number(pair[1]?.[0]), Number(pair[1]?.[1]));
      if (!from || !to) return;
      parts.push(`<line class="wmr-edge" x1="${from.cx}" y1="${from.cy}" x2="${to.cx}" y2="${to.cy}" stroke="#e0b45c" stroke-width="4" stroke-linecap="round" />`);
      parts.push(`<line class="wmr-edge-hit" data-road-edge-index="${index}" x1="${from.cx}" y1="${from.cy}" x2="${to.cx}" y2="${to.cy}" stroke="transparent" stroke-width="16" pointer-events="${this.mode === 'delete' ? 'stroke' : 'none'}" style="cursor:pointer;" />`);
    });
    parts.push('</g>');

    parts.push('<g class="wmr-pois">');
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const cell = region.grid?.[row]?.[col];
        const poi = cell && typeof cell === 'object' && !Array.isArray(cell)
          && (cell.poi === 'pass' || cell.poi === 'ferry') ? cell.poi : null;
        if (!poi) continue;
        const rect = this._cellRect(row, col);
        if (!rect) continue;
        const x = rect.x + rect.w / 2;
        const y = rect.y;
        parts.push(poi === 'pass'
          ? `<rect class="wmr-poi wmr-poi-pass" x="${x - 7}" y="${y - 7}" width="14" height="14" transform="rotate(45 ${x} ${y})" fill="#d9822b" stroke="#2a1a08" stroke-width="2" />`
          : `<circle class="wmr-poi wmr-poi-ferry" cx="${x}" cy="${y}" r="7" fill="#4aa3df" stroke="#0b2233" stroke-width="2" />`);
        parts.push(`<text x="${x}" y="${y + (poi === 'pass' ? 20 : -10)}" fill="#f2e3c6" font-size="11" text-anchor="middle">${poi === 'pass' ? '关' : '渡'}</text>`);
      }
    }
    parts.push('</g>');

    if (this._pending) {
      const rect = this._cellRect(this._pending[0], this._pending[1]);
      if (rect) {
        parts.push(`<rect class="wmr-pending" x="${rect.x + 1}" y="${rect.y + 1}" width="${rect.w - 2}" height="${rect.h - 2}" fill="none" stroke="#f6e7a8" stroke-width="3" stroke-dasharray="6 4" />`);
      }
    }

    svg.innerHTML = parts.join('');
    this.setVisible(this.visible);
  }

  // ─── 交互 ──────────────────────────────────────────────

  _handleSvgClick(event) {
    if (!this.visible || this.mode !== 'delete') return;
    const hit = event.target?.closest?.('[data-road-edge-index]');
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(hit.dataset.roadEdgeIndex);
    if (Number.isInteger(index) && index >= 0) {
      this.onChange?.({ type: 'delete', index });
    }
  }

  _handleGridClick(event) {
    if (!this.visible || this.mode !== 'connect') return;
    if (event.target?.closest?.(INTERACTIVE_SELECTOR)) return;
    const cell = event.target?.closest?.('.wme-cell');
    if (!cell) return;
    const row = Number(cell.dataset.r);
    const col = Number(cell.dataset.c);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (!this._pending) {
      this._pending = [row, col];
      this._draw();
      return;
    }
    const from = this._pending;
    if (from[0] === row && from[1] === col) {
      this._pending = null;
      this._draw();
      return;
    }
    this._pending = null;
    this._draw();
    this.onChange?.({ type: 'connect', a: from, b: [row, col] });
  }
}

export default WorldMapRoadLayer;

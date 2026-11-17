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

import { UIElement } from './UIElement.js';
import { COMPANION_STANCES } from '../systems/CompanionSquadSystem.js';

const GOLD = '#c9a227';
const PANEL_BG = 'rgba(13, 19, 38, 0.86)';
const STANCE_BG = '#233055';
const STANCE_BG_ACTIVE = '#4a3a1d';
const STANCE_BG_LOCKED = '#2a2a2a';
const CELL_BG = '#1a2f55';
const CELL_BG_DOWNED = '#5a2a2a';
const CELL_BG_DEAD = '#2a2a2a';
const SCROLL_TRACK_BG = 'rgba(26, 47, 85, 0.6)';
const SCROLL_THUMB_BG = 'rgba(201, 162, 39, 0.55)';

/**
 * 随行小队 HUD 纯布局计算（军团体系 v2 §8：左侧置顶 WoW 团队框风格）。
 *
 * 三行结构：
 *   第 1 行 命令切换（五档按钮单排：跟随/进攻/防守/冲锋/撤退）
 *   第 2 行 状态行（玩家军衔 + 亲卫 count/capacity + 士气）
 *   第 3 行 成员小方块列表（cols 列 × visibleRows 行可视窗口 + 右侧滚动条，
 *           一屏默认 50 人，随行上限 100 人滚动查看）
 *
 * 纯函数：不触碰 DOM/Canvas，供 HUD 渲染与布局单测共用。
 * @param {Object} [options]
 * @param {number} [options.viewportWidth=1280] - 逻辑画布宽
 * @param {number} [options.viewportHeight=720] - 逻辑画布高
 * @param {number} [options.cols=10] - 成员格列数
 * @param {number} [options.visibleRows=5] - 可视行数（10 列 × 5 行 = 一屏 50 人）
 * @param {number} [options.cellSize=24] - 单元格边长
 * @param {number} [options.cellGap=3] - 单元格间距
 * @param {number} [options.padding=10] - 面板内边距
 * @param {number} [options.stanceHeight=38] - 第 1 行命令切换高度
 * @param {number} [options.statusHeight=26] - 第 2 行状态行高度
 * @param {number} [options.rowGap=4] - 行间距
 * @param {number} [options.stanceGap=4] - 五档按钮间距
 * @param {number} [options.scrollbarWidth=12] - 滚动条宽度
 * @param {number} [options.scrollbarGap=5] - 滚动条与网格间距
 * @param {number} [options.x=10] - 面板左上角 X（默认最左侧）
 * @param {number} [options.y=10] - 面板左上角 Y（默认置顶）
 * @returns {{x:number,y:number,width:number,height:number,padding:number,
 *   stanceRow:{x:number,y:number,height:number}, buttons:Array<Object>,
 *   statusRow:{x:number,y:number,height:number},
 *   grid:{x:number,y:number,cols:number,visibleRows:number,cellSize:number,cellGap:number,width:number,height:number},
 *   scrollbar:{x:number,y:number,width:number,height:number,thumbMin:number}}}
 */
export function computeCompanionHudLayout({
  viewportWidth = 1280,
  viewportHeight = 720,
  cols = 10,
  visibleRows = 5,
  cellSize = 24,
  cellGap = 3,
  padding = 10,
  stanceHeight = 38,
  statusHeight = 26,
  rowGap = 4,
  stanceGap = 4,
  scrollbarWidth = 12,
  scrollbarGap = 5,
  x = 10,
  y = 10
} = {}) {
  const safeCols = Math.max(1, Math.floor(Number(cols) || 10));
  const safeVisibleRows = Math.max(1, Math.floor(Number(visibleRows) || 5));
  const gridWidth = safeCols * cellSize + (safeCols - 1) * cellGap;
  const gridHeight = safeVisibleRows * cellSize + (safeVisibleRows - 1) * cellGap;
  const width = padding * 2 + gridWidth + scrollbarGap + scrollbarWidth;
  const height = padding + stanceHeight + rowGap + statusHeight + rowGap + gridHeight + padding;
  const panelX = Number.isFinite(x) ? Math.round(x) : 10;
  const panelY = Number.isFinite(y) ? Math.round(y) : 10;
  const buttonWidth = (gridWidth - (COMPANION_STANCES.length - 1) * stanceGap) / COMPANION_STANCES.length;
  const stanceY = panelY + padding;
  const statusY = stanceY + stanceHeight + rowGap;
  const gridY = statusY + statusHeight + rowGap;
  const gridX = panelX + padding;
  const buttons = COMPANION_STANCES.map((stance, index) => ({
    key: stance.key,
    label: stance.label,
    x: Math.round(gridX + index * (buttonWidth + stanceGap)),
    y: stanceY,
    width: Math.round(buttonWidth),
    height: stanceHeight
  }));
  return {
    x: panelX,
    y: panelY,
    width,
    height,
    padding,
    stanceRow: { x: gridX, y: stanceY, height: stanceHeight },
    statusRow: { x: gridX, y: statusY, height: statusHeight },
    buttons,
    grid: {
      x: gridX,
      y: gridY,
      cols: safeCols,
      visibleRows: safeVisibleRows,
      cellSize,
      cellGap,
      width: gridWidth,
      height: gridHeight
    },
    scrollbar: {
      x: gridX + gridWidth + scrollbarGap,
      y: gridY,
      width: scrollbarWidth,
      height: gridHeight,
      thumbMin: 18
    }
  };
}

/**
 * 单元格中心点（纯函数，命中测试/渲染共用）。
 * @param {Object} layout - computeCompanionHudLayout 返回值
 * @param {number} index - 0 起的成员槽位序号
 * @param {number} [scrollRow=0] - 当前滚动行（0 = 顶部）
 * @returns {{x:number,y:number}|null} 可视窗口外返回 null
 */
export function companionCellCenter(layout, index, scrollRow = 0) {
  const { grid } = layout;
  const safeCols = Math.max(1, grid.cols);
  const col = index % safeCols;
  const row = Math.floor(index / safeCols) - Math.max(0, Math.floor(Number(scrollRow) || 0));
  if (row < 0 || row >= grid.visibleRows) return null;
  return {
    x: grid.x + col * (grid.cellSize + grid.cellGap) + grid.cellSize / 2,
    y: grid.y + row * (grid.cellSize + grid.cellGap) + grid.cellSize / 2
  };
}

/**
 * CompanionGridHud - 随行小队框体（军团体系 v2 §8，WoW 团队框风格）
 *
 * 左侧置顶竖框；第 1 行五档命令切换（跟随/进攻/防守/冲锋/撤退，PC 1-5 快捷键由
 * SceneCompanionSquadFlow 接线）；第 2 行军衔 + 亲卫 count/capacity + 士气；
 * 第 3 行成员小方块列表（每格 = 成员姓氏首字 + 底部细血条；阵亡置灰、倒地闪烁），
 * 一屏默认 50 人，随行上限 100 人经滚动条/滚轮查看。
 */
export class CompanionGridHud extends UIElement {
  /**
   * @param {Object} options
   * @param {Object} options.system - CompanionSquadSystem（五档切换与成员状态来源）
   */
  constructor({ system = null } = {}) {
    super({
      x: 10, y: 10, width: 316, height: 224,
      visible: true,
      zIndex: 206
    });
    this.system = system;
    this._layout = null;
    this._pulse = 0;
    /** 滚动行（0 = 顶部；成员超过一屏时可下滚） */
    this._scrollRow = 0;
    /** UI 编辑器 armyCommandHud 位置矩形（可选；未提供时默认最左侧置顶） */
    this._editorRect = null;
    /** 面板编辑器「亲卫队操作」三部件行高（可选；缺省用内置常量） */
    this._panelRows = null;
    this._viewport = { width: 1280, height: 720 };
  }

  /**
   * 面板编辑器「亲卫队操作」定义（ScenePanelLayout.applyPanelLayout 传入）：
   * - parts 三部件高度 → 第 1/2/3 行行高（groupBar/comboRow/stancePanel，钳制防畸形）
   * - rect/editorRect → 面板位置（可选）
   */
  setPanelDefinition(panelDefinition) {
    if (!panelDefinition) return false;
    const rect = panelDefinition?.rect || panelDefinition?.editorRect || null;
    if (rect) {
      this._editorRect = {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0
      };
    }
    const parts = Array.isArray(panelDefinition?.parts) ? panelDefinition.parts : null;
    if (parts) {
      const heightOf = id => {
        const part = parts.find(entry => entry?.id === id);
        return Math.max(0, Math.floor(Number(part?.height) || 0));
      };
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      this._panelRows = {
        stanceHeight: clamp(heightOf('groupBar'), 14, 72),
        statusHeight: clamp(heightOf('comboRow'), 14, 60),
        gridHeight: clamp(heightOf('stancePanel'), 60, 400)
      };
    }
    if (this._lastLayoutSizeRef) this.layout(this._viewport.width, this._viewport.height);
    return true;
  }

  /** UI 编辑器 armyCommandHud 位置矩形（SceneCompanionSquadFlow.onResize 传入）。 */
  setEditorRect(rect) {
    this._editorRect = rect
      ? {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0
      }
      : null;
  }

  /**
   * 重排：计算三行与滚动条矩形（ScenePanelLayout/SceneCompanionSquadFlow.onResize 调用）。
   * @param {number} viewportWidth
   * @param {number} viewportHeight
   */
  layout(viewportWidth = 1280, viewportHeight = 720) {
    this._viewport = { width: viewportWidth, height: viewportHeight };
    this._lastLayoutSizeRef = true;
    const rows = this._panelRows || {};
    const cellSize = 24;
    const cellGap = 3;
    const gridHeight = Math.max(60, Number(rows.gridHeight) || 132);
    const visibleRows = Math.max(1, Math.floor((gridHeight + cellGap) / (cellSize + cellGap)));
    this._layout = computeCompanionHudLayout({
      viewportWidth,
      viewportHeight,
      cols: 10,
      visibleRows,
      cellSize,
      cellGap,
      stanceHeight: Math.max(14, Number(rows.stanceHeight) || 38),
      statusHeight: Math.max(14, Number(rows.statusHeight) || 26),
      x: this._editorRect ? this._editorRect.x : 10,
      y: this._editorRect ? this._editorRect.y : 10
    });
    this.x = this._layout.x;
    this.y = this._layout.y;
    this.width = this._layout.width;
    this.height = this._layout.height;
    this._clampScrollRow();
    return this._layout;
  }

  /** 当前布局（未 layout 时即时计算一份）。 */
  getLayout() {
    return this._layout || this.layout(this._viewport.width, this._viewport.height);
  }

  /** 总行数 = ceil(容量 / 列数)（容量槽全展示，成员不满画淡格）。 */
  _totalRows(capacity) {
    const layout = this.getLayout();
    const slots = Math.max(1, Math.floor(Number(capacity) || 0));
    return Math.max(1, Math.ceil(slots / Math.max(1, layout.grid.cols)));
  }

  _maxScrollRow(capacity) {
    const layout = this.getLayout();
    return Math.max(0, this._totalRows(capacity) - layout.grid.visibleRows);
  }

  _clampScrollRow() {
    const capacity = this.system?.getCapacity?.() ?? 0;
    this._scrollRow = Math.max(0, Math.min(this._maxScrollRow(capacity), Math.floor(Number(this._scrollRow) || 0)));
  }

  /** 滚动指定行数（正=向下；钳制在有效范围）。返回是否发生滚动。 */
  scrollByRows(delta) {
    const capacity = this.system?.getCapacity?.() ?? 0;
    const before = this._scrollRow;
    this._scrollRow = Math.max(0, Math.min(this._maxScrollRow(capacity), before + Math.sign(Number(delta) || 0)));
    return this._scrollRow !== before;
  }

  /** 滚轮：调用方保证指针在面板内。返回是否消费。 */
  handleWheel(deltaY) {
    if (this.visible === false) return false;
    return this.scrollByRows(Number(deltaY) > 0 ? 1 : -1);
  }

  /** 命中测试：五档按钮 → 成员格（按滚动行）→ 滚动条。 */
  hitTest(x, y) {
    const layout = this.getLayout();
    for (const button of layout.buttons) {
      if (x >= button.x && x <= button.x + button.width
        && y >= button.y && y <= button.y + button.height) {
        return { type: 'stance', key: button.key, label: button.label };
      }
    }
    const capacity = Math.max(0, Math.min(layout.grid.cols * 10, this.system?.getCapacity?.() ?? 0));
    for (let index = 0; index < capacity; index += 1) {
      const center = companionCellCenter(layout, index, this._scrollRow);
      if (!center) continue;
      if (Math.abs(x - center.x) <= layout.grid.cellSize / 2
        && Math.abs(y - center.y) <= layout.grid.cellSize / 2) {
        return { type: 'cell', index };
      }
    }
    const bar = layout.scrollbar;
    if (x >= bar.x && x <= bar.x + bar.width && y >= bar.y && y <= bar.y + bar.height) {
      const thumb = this._scrollThumbRect(layout, capacity);
      if (thumb && y >= thumb.y && y <= thumb.y + thumb.height) {
        return { type: 'scrollbar', zone: 'thumb' };
      }
      return { type: 'scrollbar', zone: y < (thumb ? thumb.y : bar.y + bar.height / 2) ? 'trackUp' : 'trackDown' };
    }
    return null;
  }

  /** 滚动条滑块矩形（纯展示计算；容量≤一屏时返回 null 隐藏滑块）。 */
  _scrollThumbRect(layout, capacity) {
    const maxScroll = this._maxScrollRow(capacity);
    if (maxScroll <= 0) return null;
    const trackHeight = layout.scrollbar.height;
    const thumbHeight = Math.max(layout.scrollbar.thumbMin, Math.round(trackHeight * layout.grid.visibleRows / this._totalRows(capacity)));
    const thumbY = layout.scrollbar.y
      + Math.round((trackHeight - thumbHeight) * (this._scrollRow / maxScroll));
    return { x: layout.scrollbar.x, y: thumbY, width: layout.scrollbar.width, height: thumbHeight };
  }

  /** @returns {boolean} 是否消费该点击（隐藏/未命中返回 false） */
  handleMouseClick(x, y, button = 'left') {
    if (button !== 'left' || this.visible === false) return false;
    const hit = this.hitTest(x, y);
    if (!hit) return false;
    if (hit.type === 'stance') {
      this.system?.setStance?.(hit.key);
      return true;
    }
    if (hit.type === 'scrollbar') {
      const layout = this.getLayout();
      if (hit.zone === 'trackUp') this.scrollByRows(-1);
      else if (hit.zone === 'trackDown') this.scrollByRows(1);
      else {
        // 滑块点击：按点击位置比例跳页（无拖拽环境下的近似定位）
        const capacity = this.system?.getCapacity?.() ?? 0;
        const maxScroll = this._maxScrollRow(capacity);
        if (maxScroll > 0) {
          const bar = layout.scrollbar;
          const ratio = Math.max(0, Math.min(1, (y - bar.y) / bar.height));
          const before = this._scrollRow;
          this._scrollRow = Math.round(maxScroll * ratio);
          if (this._scrollRow !== before) this._clampScrollRow();
        }
      }
      return true;
    }
    return true;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  render(ctx) {
    this._pulse += 0.12;
    if (this.visible === false || !this.system) return;
    const layout = this.getLayout();
    const snapshot = this.system.getSnapshot();
    const capacity = Math.max(0, Math.min(layout.grid.cols * 10, snapshot.capacity));
    const members = snapshot.members || [];

    ctx.save();
    ctx.fillStyle = PANEL_BG;
    ctx.strokeStyle = 'rgba(201, 162, 39, 0.65)';
    ctx.lineWidth = 1;
    this._roundRect(ctx, layout.x, layout.y, layout.width, layout.height, 6);
    ctx.fill();
    ctx.stroke();

    // 第 1 行：五档命令切换
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const button of layout.buttons) {
      const active = snapshot.stance === button.key;
      const locked = this.system.isStanceLocked?.(button.key) === true;
      ctx.fillStyle = locked ? STANCE_BG_LOCKED : (active ? STANCE_BG_ACTIVE : STANCE_BG);
      this._roundRect(ctx, button.x, button.y, button.width, button.height, 4);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = GOLD;
        ctx.stroke();
      }
      ctx.fillStyle = locked ? '#777' : (active ? '#f0d27a' : '#b9c4dd');
      ctx.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2 + 0.5);
    }

    // 第 2 行：军衔 + 亲卫 count/capacity（左） · 士气（右）
    const statusCenterY = layout.statusRow.y + layout.statusRow.height / 2 + 0.5;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0d27a';
    ctx.fillText(String(snapshot.rankLabel || '白身'), layout.statusRow.x, statusCenterY);
    const rankLabelWidth = ctx.measureText(String(snapshot.rankLabel || '白身')).width;
    ctx.fillStyle = '#e8eefc';
    ctx.fillText(`亲卫 ${snapshot.memberCount}/${capacity}`, layout.statusRow.x + rankLabelWidth + 10, statusCenterY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9aa7c2';
    ctx.fillText(`士气 ${Math.round(snapshot.morale)}`, layout.statusRow.x + layout.grid.width, statusCenterY);

    // 第 3 行：成员小方块列表（滚动窗口）
    const startIndex = this._scrollRow * layout.grid.cols;
    const windowSlots = layout.grid.cols * layout.grid.visibleRows;
    for (let offset = 0; offset < windowSlots; offset += 1) {
      const index = startIndex + offset;
      if (index >= capacity) break;
      const center = companionCellCenter(layout, index, this._scrollRow);
      if (!center) continue;
      const member = members[index] || null;
      const half = layout.grid.cellSize / 2;
      ctx.fillStyle = this._cellFill(member);
      ctx.fillRect(center.x - half, center.y - half, layout.grid.cellSize, layout.grid.cellSize);
      if (member?.state === 'downed') {
        ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(this._pulse * 2));
        ctx.fillStyle = '#ff6b5a';
        ctx.fillRect(center.x - half, center.y - half, layout.grid.cellSize, layout.grid.cellSize);
        ctx.globalAlpha = 1;
      }
      if (member) {
        ctx.fillStyle = member.state === 'dead' ? '#777' : '#e8eefc';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(member.initial || '兵', center.x, center.y - 1);
        const ratio = Math.max(0, Math.min(1, Number(member.hpRatio) || 0));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(center.x - half + 2, center.y + half - 5, layout.grid.cellSize - 4, 3);
        ctx.fillStyle = ratio > 0.4 ? '#5ed07a' : '#e0a53c';
        ctx.fillRect(center.x - half + 2, center.y + half - 5, (layout.grid.cellSize - 4) * ratio, 3);
      }
    }

    // 滚动条（容量 ≤ 一屏时只画轨道不画滑块）
    const bar = layout.scrollbar;
    ctx.fillStyle = SCROLL_TRACK_BG;
    ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
    const thumb = this._scrollThumbRect(layout, capacity);
    if (thumb) {
      ctx.fillStyle = SCROLL_THUMB_BG;
      ctx.fillRect(thumb.x, thumb.y, thumb.width, thumb.height);
    }

    ctx.restore();
  }

  _cellFill(member) {
    if (!member) return 'rgba(26, 47, 85, 0.45)';
    if (member.state === 'dead') return CELL_BG_DEAD;
    if (member.state === 'downed') return CELL_BG_DOWNED;
    return CELL_BG;
  }

  _roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

export default CompanionGridHud;

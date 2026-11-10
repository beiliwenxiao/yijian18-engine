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

/**
 * 随行小队 HUD 纯布局计算（模块 3 §8：10×10 小方格阵 + 上方单排五档按钮）。
 *
 * 纯函数：不触碰 DOM/Canvas，供 HUD 渲染与布局单测共用。
 * @param {Object} [options]
 * @param {number} [options.viewportWidth=1280] - 逻辑画布宽
 * @param {number} [options.viewportHeight=720] - 逻辑画布高
 * @param {number} [options.cols=10] - 网格列数（10×10 = 随行上限 100）
 * @param {number} [options.rows=10] - 网格行数
 * @param {number} [options.cellSize=22] - 单元格边长
 * @param {number} [options.cellGap=3] - 单元格间距
 * @param {number} [options.padding=10] - 面板内边距
 * @param {number} [options.stanceHeight=26] - 五档按钮行高
 * @param {number} [options.stanceGap=4] - 五档按钮间距
 * @returns {{x:number,y:number,width:number,height:number,padding:number,
 *   stanceRow:{x:number,y:number,height:number}, buttons:Array<Object>,
 *   grid:{x:number,y:number,cols:number,rows:number,cellSize:number,cellGap:number,width:number,height:number}}}
 */
export function computeCompanionHudLayout({
  viewportWidth = 1280,
  viewportHeight = 720,
  cols = 10,
  rows = 10,
  cellSize = 22,
  cellGap = 3,
  padding = 10,
  stanceHeight = 26,
  stanceGap = 4,
  x = null,
  y = null
} = {}) {
  const safeCols = Math.max(1, Math.floor(Number(cols) || 10));
  const safeRows = Math.max(1, Math.floor(Number(rows) || 10));
  const gridWidth = safeCols * cellSize + (safeCols - 1) * cellGap;
  const gridHeight = safeRows * cellSize + (safeRows - 1) * cellGap;
  const width = gridWidth + padding * 2;
  const height = stanceHeight + stanceGap + gridHeight + padding * 2;
  const panelX = Number.isFinite(x) ? Math.round(x) : 16;
  const panelY = Number.isFinite(y) ? Math.round(y) : 16;
  const buttonWidth = (gridWidth - (COMPANION_STANCES.length - 1) * stanceGap) / COMPANION_STANCES.length;
  const stanceY = panelY + padding;
  const buttons = COMPANION_STANCES.map((stance, index) => ({
    key: stance.key,
    label: stance.label,
    x: Math.round(panelX + padding + index * (buttonWidth + stanceGap)),
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
    stanceRow: { x: panelX + padding, y: stanceY, height: stanceHeight },
    buttons,
    grid: {
      x: panelX + padding,
      y: stanceY + stanceHeight + stanceGap,
      cols: safeCols,
      rows: safeRows,
      cellSize,
      cellGap,
      width: gridWidth,
      height: gridHeight
    }
  };
}

/**
 * 单元格中心点（纯函数，命中测试/渲染共用）。
 * @param {Object} layout - computeCompanionHudLayout 返回值
 * @param {number} index - 0 起的成员序号
 * @returns {{x:number,y:number}}
 */
export function companionCellCenter(layout, index) {
  const { grid } = layout;
  const safeCols = Math.max(1, grid.cols);
  const col = index % safeCols;
  const row = Math.floor(index / safeCols);
  return {
    x: grid.x + col * (grid.cellSize + grid.cellGap) + grid.cellSize / 2,
    y: grid.y + row * (grid.cellSize + grid.cellGap) + grid.cellSize / 2
  };
}

/**
 * CompanionGridHud - 随行小队框体（模块 3 §8）
 *
 * 上方单排五档按钮（跟随/进攻/防守/冲锋/撤退，PC 1-5 快捷键由 SceneCompanionSquadFlow 接线）；
 * 下方 10×10 小方格阵：每格 = 成员姓氏首字 + 底部细血条；阵亡格置灰、倒地格闪烁。
 */
export class CompanionGridHud extends UIElement {
  /**
   * @param {Object} options
   * @param {Object} options.system - CompanionSquadSystem（五档切换与成员状态来源）
   */
  constructor({ system = null } = {}) {
    super({
      x: 16, y: 16, width: 276, height: 300,
      visible: true,
      zIndex: 206
    });
    this.system = system;
    this._layout = null;
    this._pulse = 0;
    this._editorRect = null;
    this._viewport = { width: 1280, height: 720 };
  }

  /** 面板编辑器矩形（可选；未提供时固定左上角）。 */
  setPanelDefinition(panelDefinition) {
    const rect = panelDefinition?.rect || panelDefinition?.editorRect || null;
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
   * 重排：计算网格与五档按钮矩形（ScenePanelLayout/onResize 调用）。
   * @param {number} viewportWidth
   * @param {number} viewportHeight
   */
  layout(viewportWidth = 1280, viewportHeight = 720) {
    this._viewport = { width: viewportWidth, height: viewportHeight };
    this._layout = computeCompanionHudLayout({
      viewportWidth,
      viewportHeight,
      cols: 10,
      rows: 10,
      x: this._editorRect ? this._editorRect.x : 16,
      y: this._editorRect ? this._editorRect.y : 16
    });
    this.x = this._layout.x;
    this.y = this._layout.y;
    this.width = this._layout.width;
    this.height = this._layout.height;
    return this._layout;
  }

  /** 当前布局（未 layout 时即时计算一份）。 */
  getLayout() {
    return this._layout || this.layout(this._viewport.width, this._viewport.height);
  }

  /** 命中测试：五档按钮优先，其次网格单元格。 */
  hitTest(x, y) {
    const layout = this.getLayout();
    for (const button of layout.buttons) {
      if (x >= button.x && x <= button.x + button.width
        && y >= button.y && y <= button.y + button.height) {
        return { type: 'stance', key: button.key, label: button.label };
      }
    }
    const capacity = Math.max(0, Math.min(layout.grid.cols * layout.grid.rows, this.system?.getCapacity?.() ?? 0));
    for (let index = 0; index < capacity; index += 1) {
      const center = companionCellCenter(layout, index);
      if (Math.abs(x - center.x) <= layout.grid.cellSize / 2
        && Math.abs(y - center.y) <= layout.grid.cellSize / 2) {
        return { type: 'cell', index };
      }
    }
    return null;
  }

  /** @returns {boolean} 是否消费该点击（隐藏/未命中返回 false） */
  handleMouseClick(x, y, button = 'left') {
    if (button !== 'left' || this.visible === false) return false;
    const hit = this.hitTest(x, y);
    if (!hit) return false;
    if (hit.type === 'stance') this.system?.setStance?.(hit.key);
    return true;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  render(ctx) {
    this._pulse += 0.12;
    if (this.visible === false || !this.system) return;
    const layout = this.getLayout();
    const snapshot = this.system.getSnapshot();

    ctx.save();
    ctx.fillStyle = PANEL_BG;
    ctx.strokeStyle = 'rgba(201, 162, 39, 0.65)';
    ctx.lineWidth = 1;
    this._roundRect(ctx, layout.x, layout.y, layout.width, layout.height, 6);
    ctx.fill();
    ctx.stroke();

    // 五档按钮
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

    // 10×10 成员格
    const capacity = Math.max(0, Math.min(layout.grid.cols * layout.grid.rows, snapshot.capacity));
    const members = snapshot.members || [];
    for (let index = 0; index < capacity; index += 1) {
      const center = companionCellCenter(layout, index);
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
        ctx.fillText(member.initial || '兵', center.x, center.y - 1);
        const ratio = Math.max(0, Math.min(1, Number(member.hpRatio) || 0));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(center.x - half + 2, center.y + half - 5, layout.grid.cellSize - 4, 3);
        ctx.fillStyle = ratio > 0.4 ? '#5ed07a' : '#e0a53c';
        ctx.fillRect(center.x - half + 2, center.y + half - 5, (layout.grid.cellSize - 4) * ratio, 3);
      }
    }

    ctx.fillStyle = '#9aa7c2';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`士气 ${Math.round(snapshot.morale)} · ${snapshot.memberCount}/${snapshot.capacity}`, layout.x + layout.padding, layout.y + layout.height - 6);
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

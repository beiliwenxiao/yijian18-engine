/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://github.com/coderaaa/yijian18-engine
 ************************************************************/

import { UIElement } from './UIElement.js';

/** 与 FoodLedgerSystem.SUPPLY_STATES 对齐的展示阈值。 */
export const SUPPLY_WARN_DAYS = 3;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 归一化粮草条条目：
 * - 军团：{ kind:'army', armyId, name, days, state }
 * - 军营：{ kind:'camp', campId, name, stock }
 */
export function normalizeSupplyEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(entry => entry && (entry.armyId != null || entry.campId != null))
    .map(entry => {
      const kind = entry.kind === 'camp' || entry.campId != null ? 'camp' : 'army';
      const id = kind === 'camp' ? String(entry.campId) : String(entry.armyId);
      return {
        kind,
        id,
        name: String(entry.name || id),
        days: Number.isFinite(Number(entry.days)) ? Number(entry.days) : null,
        stock: toNumber(entry.stock, null),
        state: entry.state || 'normal'
      };
    });
}

/** 条目告警色：断粮/紧张或剩余 <3 日转红，否则米黄。 */
export function resolveSupplyTone(entry) {
  if (!entry) return '#eee4cf';
  if (entry.state && entry.state !== 'normal') return '#e05a5a';
  if (entry.kind === 'camp') return entry.stock != null && entry.stock <= 0 ? '#e05a5a' : '#eee4cf';
  return entry.days != null && entry.days < SUPPLY_WARN_DAYS ? '#e05a5a' : '#eee4cf';
}

/** 行文本：军团「还剩 N 日」（∞ 显示「充足」），军营「存粮 N」。 */
export function formatSupplyText(entry) {
  if (!entry) return '';
  if (entry.kind === 'camp') return `存粮 ${entry.stock == null ? 0 : Math.floor(entry.stock)}`;
  if (entry.days == null) return '粮草未知';
  if (!Number.isFinite(entry.days)) return '粮草充足';
  return `还剩 ${Math.max(0, Math.floor(entry.days))} 日`;
}

/**
 * 粮草条 HUD：只读 FoodLedgerSystem.queryDays 的投影，不写领域状态。
 */
export class SupplyStatusBar extends UIElement {
  constructor(options = {}) {
    super({
      x: options.x || 12,
      y: options.y || 12,
      width: options.width || 232,
      height: options.height || 150,
      visible: options.visible === true,
      zIndex: options.zIndex || 46
    });
    this.compact = options.compact === true;
    this.title = options.title || '军需';
    this.entries = [];
  }

  setEntries(entries) {
    this.entries = normalizeSupplyEntries(entries);
  }

  getEntries() {
    return this.entries.slice();
  }

  render(ctx) {
    if (!this.visible || !ctx || !this.entries.length) return;
    const pad = this.compact ? 7 : 9;
    const lineHeight = this.compact ? 15 : 18;
    const fontSize = this.compact ? 11 : 12;
    const maxRows = Math.max(1, Math.floor((this.height - pad * 2 - lineHeight) / lineHeight));

    ctx.save();
    ctx.fillStyle = 'rgba(20, 18, 14, 0.88)';
    ctx.strokeStyle = 'rgba(214, 184, 95, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.width, this.height, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f2d17a';
    ctx.font = `bold ${fontSize + 2}px Arial`;
    ctx.fillText(this.title, this.x + pad, this.y + pad);

    const rows = this.entries.slice(0, maxRows);
    let y = this.y + pad + lineHeight + 2;
    ctx.font = `${fontSize}px Arial`;
    for (const entry of rows) {
      ctx.fillStyle = resolveSupplyTone(entry);
      ctx.fillText(`${entry.name}  ${formatSupplyText(entry)}`, this.x + pad, y);
      y += lineHeight;
    }
    if (this.entries.length > rows.length) {
      ctx.fillStyle = '#9c9486';
      ctx.fillText(`+${this.entries.length - rows.length} 支`, this.x + pad, y);
    }
    ctx.restore();
  }
}

export default SupplyStatusBar;

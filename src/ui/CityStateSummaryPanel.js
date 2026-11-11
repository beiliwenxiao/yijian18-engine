/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * YiJian18-Engine - 城市状态只读摘要
 ************************************************************/

import { UIElement } from './UIElement.js';

function cloneSnapshot(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

/** 只绘制调用方提供的领域快照，不持有也不修改 Blackboard。 */
export class CityStateSummaryPanel extends UIElement {
  constructor(options = {}) {
    super({
      x: options.x || 12,
      y: options.y || 12,
      width: options.width || 250,
      height: options.height || (options.compact === true ? 144 : 176),
      visible: options.visible === true,
      zIndex: options.zIndex || 45
    });
    this.compact = options.compact === true;
    this.resolveImage = typeof options.resolveImage === 'function'
      ? options.resolveImage
      : () => null;
    this.snapshot = null;
  }

  setSnapshot(snapshot) {
    this.snapshot = cloneSnapshot(snapshot);
  }

  _drawIcon(ctx, imageId, x, y, size) {
    if (!imageId) return false;
    const image = this.resolveImage(imageId);
    if (!image) return false;
    const isCanvas = typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement;
    if (!isCanvas && (image.complete === false || (image.naturalWidth || image.width || 0) <= 0)) return false;
    ctx.drawImage(image, x, y, size, size);
    return true;
  }

  render(ctx) {
    if (!this.visible || !ctx || !this.snapshot) return;
    const data = this.snapshot;
    const pad = this.compact ? 8 : 10;
    const lineHeight = this.compact ? 15 : 18;
    const fontSize = this.compact ? 11 : 12;

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
    ctx.fillText(`${data.cityName || '城市'} · 第 ${data.currentDay || 1} 日`, this.x + pad, this.y + pad);

    let y = this.y + pad + lineHeight + 2;
    ctx.fillStyle = '#eee4cf';
    ctx.font = `${fontSize}px Arial`;
    const resources = data.resources || {};
    ctx.fillText(
      `粮 ${resources.food || 0}  木 ${resources.wood || 0}  药 ${resources.herb || 0}  铁 ${resources.iron || 0}`,
      this.x + pad,
      y
    );
    y += lineHeight;

    const icons = data.icons || {};
    const iconSize = this.compact ? 12 : 14;
    const damageX = this.x + pad;
    const moraleX = this.x + (this.compact ? 82 : 101);
    const reputationX = this.x + (this.compact ? 150 : 184);
    ctx.fillText(`损毁 ${Math.round((data.damageRatio || 0) * 100)}%`, damageX, y);
    const moraleHasIcon = this._drawIcon(ctx, icons.morale, moraleX, y - 1, iconSize);
    ctx.fillText(`士气 ${data.morale || 0}`, moraleX + (moraleHasIcon ? iconSize + 3 : 0), y);
    const reputationHasIcon = this._drawIcon(ctx, icons.reputation, reputationX, y - 1, iconSize);
    ctx.fillText(`声望 ${data.reputation || 0}`, reputationX + (reputationHasIcon ? iconSize + 3 : 0), y);
    y += lineHeight;

    const storyHasIcon = this._drawIcon(ctx, icons.story, this.x + pad, y - 1, iconSize);
    ctx.fillText(
      `饥民事件：${data.refugeeStatus || '尚未发生'}`,
      this.x + pad + (storyHasIcon ? iconSize + 3 : 0),
      y
    );

    // 城况行：仅新数据提供时渲染，旧调用（S09 等）布局零变化。
    if (data.siegeStatus || data.stockDays != null) {
      y += lineHeight;
      const statusText = data.siegeStatus === 'captured'
        ? '已占领'
        : data.siegeStatus === 'siege' ? '围城中' : '安定';
      ctx.fillStyle = data.siegeStatus === 'siege' ? '#e8a35a' : '#eee4cf';
      const stockText = data.stockDays == null ? '' : ` · 存粮 ${data.stockDays} 日`;
      ctx.fillText(`城况：${statusText}${stockText}`, this.x + pad, y);
    }
    ctx.restore();
  }
}

export default CityStateSummaryPanel;

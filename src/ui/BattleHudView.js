/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/************************************************************
 * YiJian18-Engine - read-only live battle HUD
 ************************************************************/

import { UIElement } from './UIElement.js';

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));

/** 只绘制调用方提供的战场快照，不读取或修改领域状态。 */
export class BattleHudView extends UIElement {
  constructor(options = {}) {
    super({ x: 16, y: 16, width: options.width || 460, height: 118, visible: false, zIndex: 80 });
    this.snapshot = null;
  }

  setSnapshot(snapshot) {
    this.snapshot = clone(snapshot);
    this.visible = !!snapshot;
  }

  clear() {
    this.snapshot = null;
    this.visible = false;
  }

  render(ctx, viewWidth = ctx?.canvas?.width || 1280) {
    if (!this.visible || !this.snapshot || !ctx) return;
    const width = Math.min(this.width, viewWidth - 32);
    const x = (viewWidth - width) / 2;
    const factions = Object.values(this.snapshot.factions || {});
    ctx.save();
    ctx.fillStyle = 'rgba(17,20,24,0.9)';
    ctx.strokeStyle = '#c9ad5c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, this.y, width, this.height, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f0d27e';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(`${this.snapshot.mode === 'intervene' ? '介入' : '观战'} · ${this.snapshot.objective}`, x + width / 2, this.y + 10);
    const cardWidth = (width - 42) / Math.max(1, factions.length);
    factions.forEach((faction, index) => this._renderFaction(ctx, {
      x: x + 14 + index * (cardWidth + 14), y: this.y + 38, width: cardWidth, height: 62
    }, faction));
    ctx.restore();
  }

  _renderFaction(ctx, box, faction) {
    const morale = Math.max(0, Math.min(100, Number(faction.morale) || 0));
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = faction.factionId === 'yellow_turban' ? '#e2c250' : '#d8786e';
    ctx.font = 'bold 13px Arial';
    ctx.fillText(faction.name || faction.factionId, box.x + box.width / 2, box.y + 6);
    ctx.fillStyle = '#d9d9d9';
    ctx.font = '12px Arial';
    ctx.fillText(`兵力 ${faction.alive}/${faction.initial}　伤亡 ${faction.casualties}`, box.x + box.width / 2, box.y + 25);
    const barX = box.x + 12;
    const barY = box.y + 46;
    const barWidth = box.width - 24;
    ctx.fillStyle = '#363636';
    ctx.fillRect(barX, barY, barWidth, 8);
    ctx.fillStyle = morale > 35 ? '#d1ad48' : '#b54b43';
    ctx.fillRect(barX, barY, barWidth * morale / 100, 8);
    ctx.fillStyle = '#f1f1f1';
    ctx.font = '10px Arial';
    ctx.fillText(`士气 ${morale}`, box.x + box.width / 2, barY - 1);
  }
}

export default BattleHudView;

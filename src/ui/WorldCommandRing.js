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
 * WorldCommandRing - 大地图指令环（模块 4 · 4A）
 *
 * 设计依据：spec.md §5/D8（PC 点选 + 指令环 + 右键快捷）。
 * 纯绘制/命中几何组件：不读 Blackboard、不做通行判定、不发指令语义；
 * 只把「点了哪个页签 / 哪个指令」回报给宿主（WorldMapPanel），由宿主转 commands。
 *
 * 布局：圆心 = 选中标记屏幕坐标；指令按钮等角分布在半径 radius 的圆周上（从正上方起始）；
 * 页签（指令 / 部署）排成一行在圆上方；关闭按钮在右上。
 */

const TAU = Math.PI * 2;

export class WorldCommandRing {
  /**
   * @param {Object} [options]
   * @param {number} [options.radius=62] - 圆周半径（px）
   * @param {number} [options.buttonSize=34] - 指令按钮直径
   * @param {number} [options.tabHeight=22] - 页签高度
   * @param {number} [options.tabWidth=52] - 页签宽度
   */
  constructor({ radius = 62, buttonSize = 34, tabHeight = 22, tabWidth = 52 } = {}) {
    this.radius = Math.max(30, Number(radius) || 62);
    this.buttonSize = Math.max(20, Number(buttonSize) || 34);
    this.tabHeight = Math.max(16, Number(tabHeight) || 22);
    this.tabWidth = Math.max(32, Number(tabWidth) || 52);
    this._center = null;
    this._markerId = null;
    this._tabs = [];
    this._activeTab = null;
  }

  /**
   * @param {Object} options
   * @param {number} options.x - 圆心的屏幕 x
   * @param {number} options.y - 圆心的屏幕 y
   * @param {string|null} [options.markerId]
   * @param {Array<{key:string,label:string,items:Array<{key:string,label:string,disabled?:boolean}>}>} options.tabs
   * @param {string|null} [options.activeTab]
   */
  open({ x, y, markerId = null, tabs = [], activeTab = null } = {}) {
    this._center = { x: Number(x) || 0, y: Number(y) || 0 };
    this._markerId = markerId != null ? String(markerId) : null;
    this._tabs = Array.isArray(tabs)
      ? tabs.filter(tab => tab && tab.key).map(tab => ({
        key: String(tab.key),
        label: tab.label ? String(tab.label) : String(tab.key),
        items: Array.isArray(tab.items) ? tab.items.map(item => ({
          key: String(item.key),
          label: item.label ? String(item.label) : String(item.key),
          disabled: item.disabled === true
        })) : []
      }))
      : [];
    this._activeTab = activeTab != null && this._tabs.some(tab => tab.key === String(activeTab))
      ? String(activeTab)
      : (this._tabs[0]?.key || null);
    return this;
  }

  close() {
    this._center = null;
    this._markerId = null;
    this._tabs = [];
    this._activeTab = null;
  }

  get visible() {
    return this._center != null && this._tabs.length > 0;
  }

  get markerId() {
    return this._markerId;
  }

  get activeTab() {
    return this._activeTab;
  }

  setActiveTab(key) {
    if (this._tabs.some(tab => tab.key === String(key))) this._activeTab = String(key);
    return this;
  }

  _activeTabEntry() {
    return this._tabs.find(tab => tab.key === this._activeTab) || null;
  }

  /** 几何布局（屏幕坐标）；未打开时返回 null。 */
  layout() {
    if (!this.visible) return null;
    const { x, y } = this._center;
    const tabWidth = this.tabWidth;
    const tabHeight = this.tabHeight;
    const tabs = this._tabs.map((tab, index) => ({
      key: tab.key,
      label: tab.label,
      rect: {
        x: x + index * (tabWidth + 6) - ((this._tabs.length - 1) * (tabWidth + 6)) / 2,
        y: y - this.radius - tabHeight - 14,
        w: tabWidth,
        h: tabHeight
      }
    }));
    const items = this._activeTabEntry()?.items || [];
    const size = this.buttonSize;
    const itemRects = items.map((item, index) => {
      const angle = -Math.PI / 2 + (TAU * index) / Math.max(1, items.length);
      return {
        key: item.key,
        label: item.label,
        disabled: item.disabled === true,
        cx: x + Math.cos(angle) * this.radius,
        cy: y + Math.sin(angle) * this.radius,
        rect: {
          x: x + Math.cos(angle) * this.radius - size / 2,
          y: y + Math.sin(angle) * this.radius - size / 2,
          w: size,
          h: size
        }
      };
    });
    const closeSize = 20;
    return {
      center: { x, y },
      tabs,
      items: itemRects,
      close: { x: x + this.radius + 6, y: y - this.radius - 24, w: closeSize, h: closeSize }
    };
  }

  /**
   * 命中：{kind:'tab'|'item'|'close', key, disabled?} 或 null。
   */
  hitTest(px, py) {
    const layout = this.layout();
    if (!layout) return null;
    const inside = rect => px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
    if (inside(layout.close)) return { kind: 'close', key: null };
    for (const tab of layout.tabs) {
      if (inside(tab.rect)) return { kind: 'tab', key: tab.key };
    }
    for (const item of layout.items) {
      if (inside(item.rect)) return { kind: 'item', key: item.key, disabled: item.disabled };
    }
    return null;
  }

  render(ctx) {
    const layout = this.layout();
    if (!layout || !ctx) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 底环
    ctx.beginPath();
    ctx.arc(layout.center.x, layout.center.y, this.radius + this.buttonSize / 2 + 4, 0, TAU);
    ctx.fillStyle = 'rgba(16, 13, 10, 0.55)';
    ctx.fill();

    // 页签
    ctx.font = 'bold 12px system-ui, "Microsoft YaHei", sans-serif';
    for (const tab of layout.tabs) {
      const active = tab.key === this._activeTab;
      ctx.fillStyle = active ? 'rgba(139, 115, 85, 0.95)' : 'rgba(40, 34, 26, 0.9)';
      roundRect(ctx, tab.rect.x, tab.rect.y, tab.rect.w, tab.rect.h, 5);
      ctx.fill();
      ctx.strokeStyle = active ? '#f0d9a8' : '#8B7355';
      ctx.lineWidth = 1;
      roundRect(ctx, tab.rect.x, tab.rect.y, tab.rect.w, tab.rect.h, 5);
      ctx.stroke();
      ctx.fillStyle = active ? '#fff4d8' : '#cbb98f';
      ctx.fillText(tab.label, tab.rect.x + tab.rect.w / 2, tab.rect.y + tab.rect.h / 2 + 1);
    }

    // 指令按钮
    for (const item of layout.items) {
      ctx.beginPath();
      ctx.arc(item.cx, item.cy, this.buttonSize / 2, 0, TAU);
      ctx.fillStyle = item.disabled ? 'rgba(45, 40, 34, 0.85)' : 'rgba(60, 50, 38, 0.96)';
      ctx.fill();
      ctx.strokeStyle = item.disabled ? '#5a5147' : '#b89a68';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = item.disabled ? '#7d7468' : '#f0d9a8';
      ctx.font = 'bold 12px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillText(item.label, item.cx, item.cy + 1);
    }

    // 关闭
    ctx.fillStyle = 'rgba(60, 50, 38, 0.95)';
    roundRect(ctx, layout.close.x, layout.close.y, layout.close.w, layout.close.h, 5);
    ctx.fill();
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    roundRect(ctx, layout.close.x, layout.close.y, layout.close.w, layout.close.h, 5);
    ctx.stroke();
    ctx.fillStyle = '#f0d9a8';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('×', layout.close.x + layout.close.w / 2, layout.close.y + layout.close.h / 2 + 1);

    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, radius) {
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

export default WorldCommandRing;

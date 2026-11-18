/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-18
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { UIElement } from './UIElement.js';

/** 成员单元高度（设计像素） */
const ENTRY_HEIGHT = 48;
/** 标题行高度（设计像素） */
const TITLE_HEIGHT = 22;

/**
 * 独立亲卫列表面板：主角固定首项 + 亲卫名册成员（首字头像 + 血条），可滚动。
 *
 * 与 BackpackPanel 各自独立（不共享布局/命中框），仅通过回调交互数据：
 * - 选中状态唯一事实源在 BackpackPanel（getSelected 读取，onSelect 回写）；
 * - 名册数据由 getCompanionEntities 提供，玩家实体由 getPlayer 提供。
 *
 * 可见性由场景接线跟随背包面板（背包开则开、背包关则关），不自行管理开关。
 * 观感由面板编辑器「亲卫列表」面板管理（PanelLayout.companionListPanel，
 * applyPanelDefinition 消费；无定义时走内置默认）。
 */
export class CompanionListPanel extends UIElement {
  constructor(options = {}) {
    super({
      x: options.x || 20,
      y: options.y || 20,
      width: options.width || 80,
      height: options.height || 520,
      visible: options.visible || false,
      // 弹窗层：与背包（250）同档，略低保证背包浮层（物品菜单）在上
      zIndex: options.zIndex || 249
    });

    this.backgroundColor = options.backgroundColor || 'rgba(0, 0, 0, 0.88)';
    this.borderColor = options.borderColor || '#c49a52';
    this.borderWidth = options.borderWidth || 2;

    /** 名册：unitIds → 实体仓库 */
    this._companionProvider = typeof options.getCompanionEntities === 'function'
      ? options.getCompanionEntities
      : null;
    this._getPlayer = typeof options.getPlayer === 'function' ? options.getPlayer : null;
    /** 选中状态唯一事实源（BackpackPanel.selectedCompanionEntity） */
    this._getSelected = typeof options.getSelected === 'function' ? options.getSelected : null;
    /** 选中回写（scene → backpackPanel.selectCompanion） */
    this._onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
    /** 资产管理器读取回调（成员头像 avatarImageId → Manifest 懒解析图片） */
    this._getAssetManager = typeof options.getAssetManager === 'function' ? options.getAssetManager : null;

    this._entries = [];
    this._cells = [];
    this._hovered = null;
    this._scroll = 0;
    /** 面板编辑器定义（PanelLayout.companionListPanel）；null = 内置默认观感 */
    this._panelDefinition = null;
  }

  /**
   * 应用面板编辑器定义（PanelLayout.companionListPanel）。
   * 面板级字段（backgroundColor/borderColor/borderWidth）直接套用外框观感；
   * 部件按 type 消费：text = 标题（文本/颜色/字号/位置），member-cell = 成员格（行高/配色）。
   * 部件缺失或无定义时对应项走内置默认（标题与成员格是面板全部内容，不随缺失隐藏）。
   * 部件设计坐标按 def.width/def.height → 实际面板等比映射。
   * @param {Object|null} def - { width, height, backgroundColor, borderColor, borderWidth, parts[] }
   */
  applyPanelDefinition(def) {
    this._panelDefinition = def && typeof def === 'object' ? def : null;
    if (this._panelDefinition) {
      this.backgroundColor = this._panelDefinition.backgroundColor ?? this.backgroundColor;
      this.borderColor = this._panelDefinition.borderColor ?? this.borderColor;
      this.borderWidth = this._panelDefinition.borderWidth ?? this.borderWidth;
    }
  }

  /** 标题部件样式（设计坐标 → 实际面板）；无定义返回 null = 内置默认。 */
  _titleStyle() {
    const def = this._panelDefinition;
    const part = Array.isArray(def?.parts) ? def.parts.find(item => item.type === 'text') : null;
    if (!part || !(Number(def.height) > 0)) return null;
    const scaleY = this.height / Number(def.height);
    const scaleX = Number(def.width) > 0 ? this.width / Number(def.width) : 1;
    return {
      text: String(part.text ?? '亲卫'),
      color: part.color || '#c9a227',
      fontSize: Math.max(8, Math.round((Number(part.fontSize) || 12) * scaleY)),
      fontWeight: part.fontWeight || 'bold',
      x: (Number(part.x) || 8) * scaleX,
      y: (Number(part.y) || 5) * scaleY
    };
  }

  /** 标题带高度（成员列表从标题带之下开始）；标题部件缺失时用内置高度。 */
  _titleBandHeight() {
    const def = this._panelDefinition;
    const part = Array.isArray(def?.parts) ? def.parts.find(item => item.type === 'text') : null;
    if (!part || !(Number(def.height) > 0)) return TITLE_HEIGHT;
    const scaleY = this.height / Number(def.height);
    const bottom = ((Number(part.y) || 5) + (Number(part.height) || 16)) * scaleY;
    return Math.max(TITLE_HEIGHT, Math.round(bottom) + 1);
  }

  /** 成员格样式（行高/配色）；无定义返回 null = 内置默认。行高按面板高度等比映射。 */
  _cellStyle() {
    const def = this._panelDefinition;
    const part = Array.isArray(def?.parts) ? def.parts.find(item => item.type === 'member-cell') : null;
    if (!part || !(Number(def.height) > 0)) return null;
    const scaleY = this.height / Number(def.height);
    return {
      entryHeight: Math.max(28, Math.round((Number(part.entryHeight) || Number(part.height) || ENTRY_HEIGHT) * scaleY)),
      bgColor: part.bgColor || 'rgba(26, 47, 85, 0.6)',
      borderColor: part.borderColor || 'rgba(196, 154, 82, 0.45)',
      selectedBgColor: part.selectedBgColor || 'rgba(74, 58, 29, 0.9)',
      selectedBorderColor: part.selectedBorderColor || '#ffe785'
    };
  }

  /** 跟随背包面板定位：贴在背包左侧，留 6px 间距；左缘不足时夹到 4px。 */
  followPanel(panel) {
    if (!panel) return;
    this.height = panel.height;
    this.y = panel.y;
    this.x = Math.max(4, Math.round(panel.x - this.width - 6));
  }

  update() {
    if (!this.visible) return;
    this._refreshEntries();
    // 选中的亲卫已离队/被清理 → 回写 null（回主角展示）
    const selected = this._readSelected();
    if (selected && !this._entries.some(entry => entry.entity === selected)) {
      this._onSelect?.(null);
    }
    this._clampScroll();
  }

  render(ctx) {
    if (!this.visible) return;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.width, this.height, 6);
    ctx.fillStyle = this.backgroundColor;
    ctx.fill();
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.stroke();
    ctx.restore();

    const titleStyle = this._titleStyle();
    const cellStyle = this._cellStyle();
    const titleHeight = this._titleBandHeight();
    const entryHeight = cellStyle?.entryHeight || ENTRY_HEIGHT;
    const maxScroll = this._maxScroll();
    const visibleCount = this._visibleCount();
    const startIndex = Math.min(this._scroll, maxScroll);
    this._cells = [];

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x + 2, this.y + titleHeight, this.width - 4, this.height - titleHeight - 2);
    ctx.clip();
    for (let row = 0; row < visibleCount; row += 1) {
      const entry = this._entries[startIndex + row];
      if (!entry) break;
      const cell = {
        entity: entry.entity,
        isPlayer: entry.isPlayer,
        x: this.x + 4,
        y: this.y + titleHeight + row * entryHeight + 4,
        width: this.width - 8 - (maxScroll > 0 ? 8 : 0),
        height: entryHeight - 8
      };
      this._cells.push(cell);
      this._drawCell(ctx, cell, cellStyle);
    }

    // 滚动条
    if (maxScroll > 0) {
      const trackX = this.x + this.width - 7;
      const trackY = this.y + titleHeight;
      const trackH = this.height - titleHeight;
      ctx.fillStyle = 'rgba(26, 47, 85, 0.6)';
      ctx.fillRect(trackX, trackY, 5, trackH);
      const thumbHeight = Math.max(14, trackH * (visibleCount / (visibleCount + maxScroll)));
      const thumbY = trackY + (trackH - thumbHeight) * (startIndex / maxScroll);
      ctx.fillStyle = 'rgba(201, 162, 39, 0.55)';
      ctx.fillRect(trackX, thumbY, 5, thumbHeight);
    }
    ctx.restore();

    ctx.fillStyle = titleStyle?.color || '#c9a227';
    const titleWeight = (titleStyle?.fontWeight || 'bold') === 'normal' ? '' : 'bold ';
    ctx.font = `${titleWeight}${titleStyle?.fontSize || 12}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(titleStyle?.text || '亲卫', this.x + (titleStyle?.x ?? 8), this.y + (titleStyle?.y ?? 5));
    ctx.textBaseline = 'alphabetic';
  }

  handleMouseMove(x, y) {
    if (!this.visible) return;
    this._hovered = this.containsPoint(x, y)
      ? this._cells.find(entry =>
          x >= entry.x && x <= entry.x + entry.width && y >= entry.y && y <= entry.y + entry.height
        )?.entity || null
      : null;
  }

  handleMouseClick(x, y, button = 'left') {
    if (!this.visible) return false;
    if (!this.containsPoint(x, y)) return false;
    const cell = this._cells.find(entry =>
      x >= entry.x && x <= entry.x + entry.width && y >= entry.y && y <= entry.y + entry.height);
    if (cell) this._onSelect?.(cell.entity);
    return true;
  }

  /**
   * 模态输入（背包打开期间由场景协调器转发）：滚轮滚动成员列表 + 点击选中。
   * 返回是否消费了本帧输入；未消费时背包面板继续处理。
   */
  handleInput({ inputManager = null } = {}) {
    if (!this.visible || !inputManager) return false;
    let consumed = false;
    if (this._maxScroll() > 0) {
      const pointer = inputManager.getMousePosition?.();
      if (pointer && this.containsPoint(pointer.x, pointer.y)) {
        const wheel = inputManager.consumeWheelDelta?.();
        if (wheel?.y) {
          this._scrollBy(wheel.y > 0 ? 1 : -1);
          consumed = true;
        }
      }
    }
    if (inputManager.isMouseClicked?.() && !inputManager.isMouseClickHandled?.()) {
      const point = inputManager.getMousePosition?.() || { x: 0, y: 0 };
      if (this.handleMouseClick(point.x, point.y)) {
        inputManager.markMouseClickHandled?.();
        consumed = true;
      }
    }
    return consumed;
  }

  _readSelected() {
    const selected = this._getSelected?.() || null;
    const player = this._getPlayer?.() || null;
    return selected && selected !== player ? selected : null;
  }

  /** 刷新成员条目（主角固定首项 + 名册实体）。 */
  _refreshEntries() {
    let entities = [];
    try {
      entities = this._companionProvider?.() || [];
    } catch (error) {
      entities = [];
    }
    const player = this._getPlayer?.() || null;
    const entries = [];
    if (player) entries.push({ entity: player, isPlayer: true });
    for (const entity of entities) {
      if (!entity || entity === player) continue;
      entries.push({ entity, isPlayer: false });
    }
    this._entries = entries;
  }

  _visibleCount() {
    return Math.max(1, Math.floor((this.height - this._titleBandHeight()) / ENTRY_HEIGHT));
  }

  _maxScroll() {
    return Math.max(0, this._entries.length - this._visibleCount());
  }

  _clampScroll() {
    this._scroll = Math.max(0, Math.min(this._maxScroll(), Math.floor(Number(this._scroll) || 0)));
  }

  /** 滚动成员列表（正=向下）；返回是否发生滚动。 */
  _scrollBy(delta) {
    const before = this._scroll;
    this._scroll = Math.max(0, Math.min(this._maxScroll(), before + Math.sign(Number(delta) || 0)));
    return this._scroll !== before;
  }

  /** 实体头像解析：avatarImageId → AssetManager 懒加载（未就绪返回 null，下帧自然显示）。 */
  _resolveAvatarImage(entity) {
    const imageId = String(entity?.avatarImageId || '').trim();
    if (!imageId) return null;
    const assetManager = this._getAssetManager?.() || null;
    if (!assetManager?.getImage) return null;
    const img = assetManager.getImage(imageId);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** 渲染单个成员格：选中/悬停底色 + 头像图（首字兜底） + 名字 + 血条（亲卫队 HUD 同款）。 */
  _drawCell(ctx, cell, cellStyle = null) {
    const stats = cell.entity?.getComponent?.('stats') || null;
    const nameComponent = cell.entity?.getComponent?.('name');
    const rawName = nameComponent?.name || nameComponent?.displayName || cell.entity?.name || '';
    const label = cell.isPlayer ? '主角' : (String(rawName).trim() || '亲卫');
    const selected = cell.isPlayer ? this._readSelected() == null : this._readSelected() === cell.entity;
    const hovered = this._hovered === cell.entity;
    const dead = cell.entity?.isDead === true || cell.entity?.isDowned === true;

    ctx.fillStyle = selected
      ? (cellStyle?.selectedBgColor || 'rgba(74, 58, 29, 0.9)')
      : hovered ? 'rgba(35, 48, 85, 0.9)' : (cellStyle?.bgColor || 'rgba(26, 47, 85, 0.6)');
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
    ctx.strokeStyle = selected
      ? (cellStyle?.selectedBorderColor || '#ffe785')
      : (cellStyle?.borderColor || 'rgba(196, 154, 82, 0.45)');
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);

    // 头像块：实体 avatar 图片（内容库 avatar 字段，Manifest 懒解析），缺失时回退名字首字
    const avatarSize = Math.min(cell.height - 4, cell.width * 0.42);
    const avatarX = cell.x + 4;
    const avatarY = cell.y + (cell.height - avatarSize) / 2;
    ctx.fillStyle = dead ? '#3a3a3a' : '#233055';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    const avatarImage = this._resolveAvatarImage(cell.entity);
    if (avatarImage) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(avatarX, avatarY, avatarSize, avatarSize);
      ctx.clip();
      if (dead) ctx.globalAlpha *= 0.4;
      // cover 裁剪居中：头像图可能非正方形
      const scale = Math.max(avatarSize / avatarImage.naturalWidth, avatarSize / avatarImage.naturalHeight);
      const drawWidth = avatarImage.naturalWidth * scale;
      const drawHeight = avatarImage.naturalHeight * scale;
      ctx.drawImage(
        avatarImage,
        avatarX + (avatarSize - drawWidth) / 2,
        avatarY + (avatarSize - drawHeight) / 2,
        drawWidth, drawHeight
      );
      ctx.restore();
    } else {
      ctx.fillStyle = dead ? '#888888' : '#ffd166';
      ctx.font = `bold ${Math.max(10, Math.round(avatarSize * 0.5))}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.charAt(0), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
    }

    // 名字 + 底部血条
    const textX = avatarX + avatarSize + 5;
    ctx.fillStyle = dead ? '#777777' : '#e8eef7';
    ctx.font = '11px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(label.slice(0, 3), textX, cell.y + 7);
    const hpRatio = stats && Number(stats.maxHp) > 0
      ? Math.max(0, Math.min(1, Number(stats.hp) / Number(stats.maxHp)))
      : 1;
    const barX = textX;
    const barY = cell.y + cell.height - 10;
    const barWidth = Math.max(8, cell.x + cell.width - 5 - barX);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, 4);
    ctx.fillStyle = dead
      ? '#666666'
      : hpRatio > 0.5 ? '#4caf50' : hpRatio > 0.25 ? '#ffb300' : '#e53935';
    ctx.fillRect(barX, barY, Math.max(0, barWidth * hpRatio), 4);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

export default CompanionListPanel;

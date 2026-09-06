/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * InventoryPanel.js
 * 背包UI组件 - 显示和管理物品
 */

import { UIElement } from './UIElement.js';
import { ItemRarity } from '../data/ItemData.js';
import { ItemIconRenderer } from './ItemIconRenderer.js';

/**
 * 背包面板
 */
export class InventoryPanel extends UIElement {
  /**
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    super({
      x: options.x || 400,
      y: options.y || 50,
      width: options.width || 370,  // 调整宽度: 20 + 6*(50+5) - 5 + 20 = 370
      height: options.height || 380,  // 调整高度: 80 + 4*(50+5) - 5 + 20 = 315，留余量 + 金币行
      visible: options.visible || false,
      zIndex: options.zIndex || 100
    });

    this.title = '背包';
    this.backgroundColor = options.backgroundColor || 'rgba(0, 0, 0, 0.85)';
    this.borderColor = options.borderColor || '#666';
    this.borderWidth = options.borderWidth || 2;
    this.entity = null;
    this._entitySource = null;
    this.getProjection = typeof options.getProjection === 'function' ? options.getProjection : () => null;
    this.onIntent = typeof options.onIntent === 'function' ? options.onIntent : null;
    // 卸下仍经 SceneInventoryFlow 提交，保留背包容量失败反馈与面板重绑。
    this.onEquipmentUnequip = typeof options.onEquipmentUnequip === 'function'
      ? options.onEquipmentUnequip
      : null;
    // 由组合 BackpackPanel 渲染唯一详情/操作菜单；本面板只上报稳定物品身份。
    this.onItemActionMenu = typeof options.onItemActionMenu === 'function'
      ? options.onItemActionMenu
      : null;
    this.currentFilter = 'all';
    this.slotSize = options.slotSize || 50;
    this.slotPadding = options.slotPadding || 5;
    this.slotsPerRow = options.slotsPerRow || 6;  // 每行格子数
    this.maxVisibleRows = options.maxVisibleRows || 4;  // 可见行数
    
    // 计算槽位布局
    this.slotStartX = 20;
    this.slotStartY = 80;
    
    // 滚动状态（按行偏移）
    this.scrollRow = 0;            // 当前滚动到的起始行
    this.scrollbarWidth = 8;       // 滚动条宽度
    this.scrollbarDragging = false;
    this.scrollbarDragStartY = 0;
    this.scrollbarDragStartRow = 0;
    
    // 过滤器按钮（尺寸/间距可配置，移动端可缩短并缩进面板内）
    const fbWidth = options.filterButtonWidth || 60;
    const fbGap = options.filterButtonGap !== undefined ? options.filterButtonGap : 10;
    const fbStartX = options.filterButtonStartX !== undefined ? options.filterButtonStartX : 20;
    const fbHeight = options.filterButtonHeight || 25;
    const fbY = options.filterButtonY || 45;
    const fbDefs = [
      { name: 'all', label: '全部' },
      { name: 'equipment', label: '装备' },
      { name: 'consumable', label: '消耗品' },
      { name: 'material', label: '材料' },
      { name: 'quest', label: '任务' }
    ];
    this.filterButtons = fbDefs.map((d, i) => ({
      name: d.name,
      label: d.label,
      x: fbStartX + i * (fbWidth + fbGap),
      y: fbY,
      width: fbWidth,
      height: fbHeight
    }));
    
    // 交互状态
    this.hoveredSlot = -1;
    this.selectedSlot = -1;
    // 手柄焦点独立于鼠标选中：空格子也可被聚焦，确认时不产生物品命令。
    this.focusedSlot = -1;
    this.draggedItem = null;
    this.dragOffset = { x: 0, y: 0 };
    this.mouseX = 0;
    this.mouseY = 0;
    
    // 悬停提示延迟（秒）
    this.tooltipDelay = options.tooltipDelay !== undefined ? options.tooltipDelay : 0.5;
    this.hoverTime = 0;         // 当前悬停在同一槽位的累计时间
    this.lastHoveredSlot = -1;  // 上一帧的悬停槽位
    
    // 长按提示（移动端：按住1秒显示道具tooltip，释放关闭，期间不使用道具）
    this.longPressSlot = -1;       // 当前长按的槽位（-1=无）
    this.longPressStart = 0;       // 长按开始时间（performance.now ms）
    this.longPressActive = false;  // 是否已触发长按 tooltip
    this.longPressDuration = 1000; // 长按阈值（毫秒）
    this.longPressShowTooltip = false; // 是否正在展示长按 tooltip
    
    // 右键菜单
    this.contextMenu = {
      visible: false,
      x: 0,
      y: 0,
      slotIndex: -1,
      options: []
    };
    
    // 事件回调
    this.onItemUse = options.onItemUse || null;
    this.onItemDrop = options.onItemDrop || null;
    this.onFilterChange = options.onFilterChange || null;
    this.onEquipmentChange = options.onEquipmentChange || null; // 装备变化回调
    this.canUseItem = options.canUseItem || null; // 检查物品是否可以使用的回调
    
    // 是否显示悬停提示框（移动端可关闭）
    this.showTooltip = options.showTooltip !== false;
    
    // 统一物品详情/操作菜单。descriptor 只保存稳定身份，避免异步命令返回后误操作新物品。
    this.itemDetail = null; // { kind, itemId, instanceId, slotIndex?, slotType? }
    this.itemDetailSlot = -1; // 兼容旧调用方，仅背包来源时写入实际槽位。
    this.itemDetailButtons = [];
    this.itemDetailActions = [];
    this.itemDetailSelectedActionId = null;
    this.itemDetailPending = false;
  }

  /**
   * 设置显示的实体
   * @param {Entity} entity - 实体对象
   */
  setEntity(entity) {
    this._entitySource = entity || null;
    if (!entity) {
      this.entity = null;
      return;
    }
    this.entity = new Proxy(entity, {
      get: (target, property, receiver) => {
        if (property !== 'getComponent') return Reflect.get(target, property, receiver);
        return type => {
          const projectionSnapshot = this.getProjection();
          const projection = projectionSnapshot?.value || projectionSnapshot;
          if (!projection) return target.getComponent?.(type);
          if (type === 'stats') {
            return target.getComponent?.('stats') || projection.stats || null;
          }
          if (type === 'equipment') {
            const slots = projection.equipment || {};
            return { slots, getEquipment: slot => slots[slot] || null };
          }
          // 物品获得事务直接提交到 InventoryComponent；旧的只读投影尚未刷新时
          // 不得覆盖真实库存，否则会出现“已获得但背包空白”的错误状态。
          if (type === 'inventory') return target.getComponent?.('inventory') || null;
          return target.getComponent?.(type);
        };
      }
    });
  }

  /**
   * 应用面板编辑器的布局数据
   * 从 PanelLayout.json 读取面板配置，覆盖默认参数
   * @param {Object} panelDef - 面板定义
   */
  applyPanelLayout(panelDef) {
    if (!panelDef) return;
    this._panelLayout = panelDef;
    // 组合背包中几何信息由外层 BackpackPanel 同步；这里仅保留内部部件的样式和参数。
    this.width = panelDef.width ?? this.width;
    this.height = panelDef.height ?? this.height;
    this.backgroundColor = panelDef.backgroundColor ?? this.backgroundColor;
    this.borderColor = panelDef.borderColor ?? this.borderColor;
    this.borderWidth = panelDef.borderWidth ?? this.borderWidth;

    const grid = panelDef.parts.find(p => p.id === 'slotGrid' || p.type === 'slot-grid');
    if (grid) {
      this.slotsPerRow = grid.cols ?? this.slotsPerRow;
      this.maxVisibleRows = grid.rows ?? this.maxVisibleRows;
      this.slotSize = grid.slotSize ?? this.slotSize;
      this.slotPadding = grid.slotPadding ?? this.slotPadding;
      this.slotStartX = grid.x ?? this.slotStartX;
      this.slotStartY = grid.y ?? this.slotStartY;
    }

    const filters = panelDef.parts.filter(p => p.type === 'button' && p.id && p.id.startsWith('filter'));
    if (filters.length > 0) {
      const fbDefs = [
        { name: 'all', label: '全部' },
        { name: 'equipment', label: '装备' },
        { name: 'consumable', label: '消耗品' },
        { name: 'material', label: '材料' },
        { name: 'quest', label: '任务' }
      ];
      this.filterButtons = filters.map((f, i) => ({
        name: fbDefs[i] ? fbDefs[i].name : f.id,
        label: f.text || (fbDefs[i] ? fbDefs[i].label : ''),
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        color: f.color,
        bgColor: f.bgColor,
        borderColor: f.borderColor,
        activeBgColor: f.activeBgColor,
        activeBorderColor: f.activeBorderColor,
        fontSize: f.fontSize
      }));
    }

    const scrollbar = panelDef.parts.find(p => p.type === 'scrollbar');
    if (scrollbar) this.scrollbarWidth = scrollbar.width ?? this.scrollbarWidth;
  }

  /**
   * 设置 InputManager 引用（用于长按检测中判断手指释放）
   * @param {InputManager} inputManager
   */
  setInputManager(inputManager) {
    this._inputManager = inputManager;
  }

  /**
   * 获取当前过滤条件下的总行数（用于滚动）
   * @returns {number}
   */
  getTotalRows() {
    if (!this.entity) return 0;
    const inv = this.entity.getComponent('inventory');
    if (!inv) return 0;
    let count;
    if (inv.currentFilter === 'all') {
      count = inv.maxSlots;
    } else {
      count = this.getFilteredItems(inv).length;
    }
    // 至少铺满可见区域，避免筛选结果稀少时网格塌缩
    return Math.max(Math.ceil(count / this.slotsPerRow), this.maxVisibleRows);
  }

  /**
   * 最大可滚动起始行
   * @returns {number}
   */
  getMaxScrollRow() {
    return Math.max(0, this.getTotalRows() - this.maxVisibleRows);
  }

  /**
   * 限制滚动行在有效范围内
   */
  clampScroll() {
    const max = this.getMaxScrollRow();
    if (this.scrollRow < 0) this.scrollRow = 0;
    if (this.scrollRow > max) this.scrollRow = max;
  }

  /**
   * 滚动若干行（正数向下）
   * @param {number} deltaRows
   */
  scrollBy(deltaRows) {
    this.scrollRow += deltaRows;
    this.clampScroll();
  }

  /**
   * 更新背包面板
   * @param {number} deltaTime - 帧间隔时间
   */
  update(deltaTime) {
    if (!this.visible || !this.entity) return;
    
    // 悬停计时：检测是否一直停在同一个槽位上
    if (this.hoveredSlot >= 0 && this.hoveredSlot === this.lastHoveredSlot) {
      this.hoverTime += deltaTime;
    } else {
      this.hoverTime = 0;
    }
    this.lastHoveredSlot = this.hoveredSlot;
    
    // 长按逻辑：按住道具 1 秒 → 显示 tooltip；释放 → 关闭 tooltip，不使用道具
    if (this.longPressSlot >= 0) {
      const elapsed = performance.now() - this.longPressStart;
      if (!this.longPressActive && elapsed >= this.longPressDuration) {
        // 达到长按阈值 → 进入 tooltip 展示模式
        this.longPressActive = true;
        this.longPressShowTooltip = true;
        this.hoveredSlot = this.longPressSlot; // 让 tooltip 瞄准该槽位
      }
    }
    
    // 检测手指/鼠标释放（isDown 变 false）→ 结束长按
    if (this.longPressSlot >= 0 && this._inputManager) {
      const stillDown = this._inputManager.mouse && this._inputManager.mouse.isDown;
      if (!stillDown) {
        if (this.longPressActive) {
          // 长按释放：关闭 tooltip，不使用道具
          this.longPressShowTooltip = false;
        } else {
          // 移动端短按只打开统一详情/操作菜单，不直接装备、使用或丢弃。
          this.requestItemActionMenu(this.longPressSlot);
        }
        this.longPressSlot = -1;
        this.longPressActive = false;
      }
    }
  }

  /**
   * 渲染背包面板
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.visible) return;

    ctx.save();

    // 绘制面板背景
    this.renderBackground(ctx);
    
    // 绘制标题
    this.renderTitle(ctx);
    
    // 绘制过滤器按钮
    this.renderFilterButtons(ctx);
    
    // 绘制物品槽位
    this.renderItemSlots(ctx);
    
    // 绘制金币
    this.renderGold(ctx);
    
    // 绘制右键菜单
    this.renderContextMenu(ctx);
    
    // 绘制物品提示框
    this.renderItemTooltip(ctx);
    
    // 绘制物品详情面板（移动端点击后弹出）
    this.renderItemDetailPanel(ctx);
    
    // 绘制拖拽物品
    this.renderDraggedItem(ctx);

    ctx.restore();
  }

  /**
   * 渲染金币显示
   * @param {CanvasRenderingContext2D} ctx
   */
  renderGold(ctx) {
    if (!this.entity) return;
    const stats = this.entity.getComponent('stats');
    const gold = stats ? (stats.gold || 0) : 0;
    const part = this._getLayoutPart('bagGoldRow', 'goldRow');
    const x = this.x + (part?.x ?? 16);
    const y = this.y + (part?.y ?? this.height - 22);
    const width = part?.width || 120;
    // 背景条高度跟随部件高度，保证面板缩放后比例一致
    const height = part?.height || 20;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - height * 0.3, y - height * 0.7, width, height);
    ctx.fillStyle = part?.color || '#FFD700';
    ctx.font = `bold ${part?.fontSize || 13}px Arial`;
    ctx.textAlign = part?.align || 'left';
    const textX = part?.align === 'right' ? x + width : x;
    ctx.fillText(`💰 ${gold} 金币`, textX, y);
    ctx.textAlign = 'left';
  }

  /**
   * 渲染背景
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderBackground(ctx) {
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(this.x, this.y, this.width, this.height);
    if (this.borderWidth > 0) {
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWidth;
      ctx.strokeRect(this.x, this.y, this.width, this.height);
    }
  }

  /**
   * 渲染标题
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderTitle(ctx) {
    const titlePart = this._getLayoutPart('bagTitle', 'title');
    const titleX = this.x + (titlePart?.x ?? 20);
    const titleY = this.y + (titlePart?.y ?? 12) + (titlePart?.fontSize || 16);
    const titleWidth = titlePart?.width || 100;
    ctx.fillStyle = titlePart?.color || '#ffffff';
    ctx.font = `${titlePart?.fontWeight || 'bold'} ${titlePart?.fontSize || 16}px Arial`;
    ctx.textAlign = titlePart?.align || 'left';
    const titleTextX = titlePart?.align === 'right' ? titleX + titleWidth : titleX;
    ctx.fillText(titlePart?.text || this.title, titleTextX, titleY);

    if (this.entity) {
      const inventoryComponent = this.entity.getComponent('inventory');
      if (inventoryComponent) {
        const countPart = this._getLayoutPart('bagSlotCount', 'slotCount');
        const countX = this.x + (countPart?.x ?? this.width - 100);
        const countY = this.y + (countPart?.y ?? 14) + (countPart?.fontSize || 12);
        const countWidth = countPart?.width || 80;
        ctx.fillStyle = countPart?.color || '#cccccc';
        ctx.font = `${countPart?.fontSize || 12}px Arial`;
        ctx.textAlign = countPart?.align || 'right';
        const textX = countPart?.align === 'left' ? countX : countX + countWidth;
        ctx.fillText(`${inventoryComponent.getUsedSlotCount()}/${inventoryComponent.maxSlots}`, textX, countY);
      }
    }
    ctx.textAlign = 'left';
  }

  _getLayoutPart(...ids) {
    const parts = this._panelLayout?.parts || [];
    return parts.find(part => ids.includes(part.id)) || null;
  }

  _getSlotStyle() {
    const grid = this._getLayoutPart('slotGrid');
    return {
      background: grid?.slotBgColor || 'rgba(100, 100, 100, 0.3)',
      border: grid?.slotBorderColor || '#666'
    };
  }

  _renderSlotFrame(ctx, x, y, hovered, selected) {
    const style = this._getSlotStyle();
    ctx.fillStyle = hovered ? 'rgba(255, 255, 255, 0.2)' : style.background;
    ctx.fillRect(x, y, this.slotSize, this.slotSize);
    ctx.strokeStyle = selected ? '#ffff00' : (hovered ? '#ffffff' : style.border);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, this.slotSize, this.slotSize);
  }

  /**
   * 渲染过滤器按钮
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderFilterButtons(ctx) {
    if (!this.entity) return;
    
    const inventoryComponent = this.entity.getComponent('inventory');
    if (!inventoryComponent) return;

    for (const button of this.filterButtons) {
      const buttonX = this.x + button.x;
      const buttonY = this.y + button.y;
      const isActive = inventoryComponent.currentFilter === button.name;
      
      // 按钮背景：激活态用 activeBgColor，常态用 bgColor。
      // 两者必须分开配置，否则某个按钮的常态色被设成高亮色时会看起来"永远选中"。
      ctx.fillStyle = isActive
        ? (button.activeBgColor || 'rgba(100, 150, 255, 0.8)')
        : (button.bgColor || 'rgba(100, 100, 100, 0.5)');
      ctx.fillRect(buttonX, buttonY, button.width, button.height);
      
      // 按钮边框
      ctx.strokeStyle = isActive
        ? (button.activeBorderColor || '#6496ff')
        : (button.borderColor || '#888');
      ctx.lineWidth = 1;
      ctx.strokeRect(buttonX, buttonY, button.width, button.height);
      
      // 按钮文字
      ctx.fillStyle = button.color || '#ffffff';
      ctx.font = `${button.fontSize || 11}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(button.label, buttonX + button.width / 2, buttonY + button.height / 2 + 4);
    }
  }

  /**
   * 渲染物品槽位
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderItemSlots(ctx) {
    if (!this.entity) return;
    
    const inventoryComponent = this.entity.getComponent('inventory');
    if (!inventoryComponent) return;

    const currentFilter = inventoryComponent.currentFilter;
    
    if (currentFilter === 'all') {
      // 显示全部：渲染所有槽位（包括空槽位）
      const totalSlots = inventoryComponent.maxSlots;
      
      for (let i = 0; i < totalSlots; i++) {
        const row = Math.floor(i / this.slotsPerRow);
        const col = i % this.slotsPerRow;
        
        // 仅渲染滚动可见区间内的行
        const visibleRow = row - this.scrollRow;
        if (visibleRow < 0) continue;
        if (visibleRow >= this.maxVisibleRows) break;
        
        const slotX = this.x + this.slotStartX + col * (this.slotSize + this.slotPadding);
        const slotY = this.y + this.slotStartY + visibleRow * (this.slotSize + this.slotPadding);
        
        const slot = inventoryComponent.getSlot(i);
        
        if (slot) {
          // 渲染有物品的槽位
          this.renderSlot(ctx, i, slotX, slotY, inventoryComponent);
        } else {
          // 渲染空槽位
          this.renderEmptySlot(ctx, slotX, slotY, i);
        }
      }
    } else {
      // 分类显示：符合条件的物品紧密排列，其余位置保留空格子，
      // 保证切换筛选时网格始终存在（匹配项为 0 时也不会整片消失）。
      const filteredItems = this.getFilteredItems(inventoryComponent);
      const totalCells = this.getTotalRows() * this.slotsPerRow;

      for (let i = 0; i < totalCells; i++) {
        const row = Math.floor(i / this.slotsPerRow);
        const col = i % this.slotsPerRow;

        const visibleRow = row - this.scrollRow;
        if (visibleRow < 0) continue;
        if (visibleRow >= this.maxVisibleRows) break;

        const slotX = this.x + this.slotStartX + col * (this.slotSize + this.slotPadding);
        const slotY = this.y + this.slotStartY + visibleRow * (this.slotSize + this.slotPadding);

        const filteredItem = filteredItems[i];
        if (filteredItem) {
          this.renderFilteredSlot(ctx, filteredItem, slotX, slotY, filteredItem.index);
        } else {
          // 占位空格子：传 -1 避免与真实槽位的悬停/选中状态冲突
          this.renderEmptySlot(ctx, slotX, slotY, -1);
        }
      }
    }
    
    // 绘制滚动条
    this.renderScrollbar(ctx);
  }

  /**
   * 渲染右侧滚动条
   * @param {CanvasRenderingContext2D} ctx
   */
  renderScrollbar(ctx) {
    // 滚动条常驻：切换分类导致内容不足一屏时也保留，避免控件忽隐忽现。
    // 不可滚动时滑块铺满轨道并降低对比度表示禁用。
    const scrollable = this.getMaxScrollRow() > 0;

    const scrollbar = this._getLayoutPart('scrollbar');
    const track = this.getScrollbarTrackRect();
    ctx.fillStyle = scrollbar?.trackColor || 'rgba(255,255,255,0.12)';
    ctx.fillRect(track.x, track.y, track.width, track.height);

    const thumb = this.getScrollbarThumbRect();
    if (this.scrollbarDragging) {
      ctx.fillStyle = 'rgba(180,200,255,0.95)';
    } else if (scrollable) {
      ctx.fillStyle = scrollbar?.thumbColor || 'rgba(180,180,180,0.8)';
    } else {
      ctx.fillStyle = scrollbar?.thumbDisabledColor || 'rgba(180,180,180,0.3)';
    }
    ctx.fillRect(thumb.x, thumb.y, thumb.width, thumb.height);
  }

  /**
   * 滚动条轨道矩形
   */
  getScrollbarTrackRect() {
    const scrollbar = this._getLayoutPart('scrollbar');
    if (scrollbar) {
      return {
        x: this.x + scrollbar.x,
        y: this.y + scrollbar.y,
        width: scrollbar.width || this.scrollbarWidth,
        height: scrollbar.height || 0
      };
    }
    const x = this.x + this.slotStartX + this.slotsPerRow * (this.slotSize + this.slotPadding) + 4;
    const y = this.y + this.slotStartY;
    const height = this.maxVisibleRows * (this.slotSize + this.slotPadding) - this.slotPadding;
    return { x, y, width: this.scrollbarWidth, height };
  }

  /**
   * 滚动条滑块矩形
   */
  getScrollbarThumbRect() {
    const track = this.getScrollbarTrackRect();
    const totalRows = this.getTotalRows();
    const visible = this.maxVisibleRows;
    const ratio = Math.min(1, visible / totalRows);
    const thumbHeight = Math.max(24, track.height * ratio);
    const maxScroll = this.getMaxScrollRow();
    const t = maxScroll > 0 ? this.scrollRow / maxScroll : 0;
    const thumbY = track.y + (track.height - thumbHeight) * t;
    return { x: track.x, y: thumbY, width: track.width, height: thumbHeight };
  }

  /**
   * 获取筛选后的物品
   * @param {InventoryComponent} inventoryComponent - 背包组件
   * @returns {Array} 筛选后的物品列表
   */
  getFilteredItems(inventoryComponent) {
    const allItems = inventoryComponent.getAllItems();
    const currentFilter = inventoryComponent.currentFilter;
    
    if (currentFilter === 'all') {
      return allItems;
    }
    
    const filter = inventoryComponent.filters[currentFilter];
    if (!filter) {
      return allItems;
    }
    
    return allItems.filter(({ slot }) => filter(slot.item));
  }

  /**
   * 渲染筛选后的槽位
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {Object} filteredItem - 筛选后的物品
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} displayIndex - 显示索引
   */
  renderFilteredSlot(ctx, filteredItem, x, y, displayIndex) {
    const { slot, index: originalIndex } = filteredItem;
    const isHovered = this.hoveredSlot === originalIndex;
    const isSelected = this.selectedSlot === originalIndex || this.focusedSlot === originalIndex;
    this._renderSlotFrame(ctx, x, y, isHovered, isSelected);
    
    // 渲染物品
    if (slot) {
      this.renderItem(ctx, slot, x, y);
    }
  }

  /**
   * 渲染空槽位
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} slotIndex - 槽位索引
   */
  renderEmptySlot(ctx, x, y, slotIndex) {
    // slotIndex < 0 表示筛选视图里的占位格子，不参与悬停/选中判定。
    // 否则它会与 hoveredSlot/selectedSlot 的初始值 -1 相等而被误判为选中（黄框）。
    const isRealSlot = slotIndex >= 0;
    const isHovered = isRealSlot && this.hoveredSlot === slotIndex;
    const isSelected = isRealSlot && (this.selectedSlot === slotIndex || this.focusedSlot === slotIndex);
    this._renderSlotFrame(ctx, x, y, isHovered, isSelected);
  }

  /**
   * 渲染单个槽位
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {number} slotIndex - 槽位索引
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {InventoryComponent} inventoryComponent - 背包组件
   */
  renderSlot(ctx, slotIndex, x, y, inventoryComponent) {
    const slot = inventoryComponent.getSlot(slotIndex);
    const isHovered = this.hoveredSlot === slotIndex;
    const isSelected = this.selectedSlot === slotIndex || this.focusedSlot === slotIndex;
    this._renderSlotFrame(ctx, x, y, isHovered, isSelected);
    
    // 渲染物品
    if (slot) {
      this.renderItem(ctx, slot, x, y);
    }
  }

  /**
   * 渲染物品
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {ItemStack} itemStack - 物品堆叠
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   */
  renderItem(ctx, itemStack, x, y) {
    const item = itemStack.item;
    
    // 物品背景（根据稀有度）
    const rarityColors = ['#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000'];
    ctx.fillStyle = rarityColors[item.rarity] || '#ffffff';
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x + 2, y + 2, this.slotSize - 4, this.slotSize - 4);
    ctx.globalAlpha = 1.0;
    
    // 物品图标
    const iconDrawn = this.drawItemIcon(ctx, item, x, y, this.slotSize);
    
    if (!iconDrawn) {
      // 没有专用图标，使用文字
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      const iconText = item.name.substring(0, 2);
      ctx.fillText(iconText, x + this.slotSize / 2, y + this.slotSize / 2 + 4);
    }
    
    // 数量显示
    if (itemStack.quantity > 1) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(itemStack.quantity.toString(), x + this.slotSize - 2, y + this.slotSize - 2);
    }
  }

  /**
   * 绘制物品图标
   * @returns {boolean} 是否成功绘制了图标
   */
  drawItemIcon(ctx, item, x, y, size) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    return ItemIconRenderer.drawIcon(ctx, item, cx, cy, size);
  }

  /**
   * 渲染物品提示框
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderItemTooltip(ctx) {
    if (!this.showTooltip && !this.longPressShowTooltip) return;
    if (this.hoveredSlot === -1 || !this.entity) return;
    // 悬停延迟：桌面鼠标悬停需 tooltipDelay 秒；长按模式直接显示
    if (!this.longPressShowTooltip && this.hoverTime < this.tooltipDelay) return;
    
    const inventoryComponent = this.entity.getComponent('inventory');
    if (!inventoryComponent) return;
    
    const slot = inventoryComponent.getSlot(this.hoveredSlot);
    if (!slot) return;
    
    const item = slot.item;
    const tooltipWidth = 280;
    const isTool = typeof item.toolType === 'string' && item.toolType.length > 0;
    const toolLineCount = isTool ? (Number(item.durability) <= 0 ? 4 : 3) : 0;
    const tooltipHeight = 200 + toolLineCount * 14;
    
    // 获取canvas尺寸
    const canvas = document.getElementById('gameCanvas');
    const canvasWidth = canvas ? canvas.width : 800;
    const canvasHeight = canvas ? canvas.height : 600;
    
    // 默认显示在鼠标右侧
    let tooltipX = this.mouseX + 15;
    let tooltipY = this.mouseY - 20;
    
    // 如果超出右边界，显示在鼠标左侧
    if (tooltipX + tooltipWidth > canvasWidth) {
      tooltipX = this.mouseX - tooltipWidth - 15;
    }
    
    // 如果左侧也超出，显示在背包右侧
    if (tooltipX < 0) {
      tooltipX = this.x + this.width + 10;
      // 如果背包右侧也超出，显示在背包左侧
      if (tooltipX + tooltipWidth > canvasWidth) {
        tooltipX = this.x - tooltipWidth - 10;
      }
    }
    
    // 如果超出下边界，向上调整
    if (tooltipY + tooltipHeight > canvasHeight) {
      tooltipY = canvasHeight - tooltipHeight - 10;
    }
    
    // 如果超出上边界，向下调整
    if (tooltipY < 0) {
      tooltipY = 10;
    }
    
    // 提示框背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    
    // 提示框边框
    const rarityColors = ['#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000'];
    ctx.strokeStyle = rarityColors[item.rarity] || '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

    let yOffset = 20;
    
    // 物品名称
    ctx.fillStyle = rarityColors[item.rarity] || '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(item.name, tooltipX + 10, tooltipY + yOffset);
    yOffset += 20;
    
    // 物品类型和稀有度
    ctx.fillStyle = '#cccccc';
    ctx.font = '11px Arial';
    const rarityNames = ['普通', '不凡', '稀有', '史诗', '传说'];
    const typeNames = {
      'consumable': '消耗品',
      'material': '材料',
      'equipment': '装备',
      'quest': '任务物品'
    };
    const typeName = typeNames[item.type] || item.type;
    const rarityName = rarityNames[item.rarity] || '未知';
    ctx.fillText(`${typeName} | ${rarityName}`, tooltipX + 10, tooltipY + yOffset);
    yOffset += 15;
    
    // 数量
    if (slot.quantity > 1) {
      ctx.fillStyle = '#ffff00';
      ctx.fillText(`数量: ${slot.quantity}`, tooltipX + 10, tooltipY + yOffset);
      yOffset += 15;
    }
    
    // 物品描述
    if (item.description) {
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '10px Arial';
      yOffset += 5;
      this.wrapText(ctx, item.description, tooltipX + 10, tooltipY + yOffset, tooltipWidth - 20, 12);
      yOffset += 30;
    }
    
    // 物品效果（消耗品）
    if (item.effect && item.usable) {
      ctx.fillStyle = '#00ff00';
      ctx.font = '11px Arial';
      ctx.fillText('使用效果:', tooltipX + 10, tooltipY + yOffset);
      yOffset += 15;
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Arial';
      let effectText = '';
      
      switch (item.effect.type) {
        case 'heal':
          effectText = `恢复 ${item.effect.value} 点生命值`;
          break;
        case 'restore_mana':
          effectText = `恢复 ${item.effect.value} 点魔法值`;
          break;
        case 'buff':
          effectText = `提升 ${item.effect.stat} ${Math.round(item.effect.value * 100)}%，持续 ${item.effect.duration} 秒`;
          break;
        default:
          effectText = '特殊效果';
      }
      
      ctx.fillText(effectText, tooltipX + 15, tooltipY + yOffset);
      yOffset += 15;
    }
    
    // 装备属性（如果是装备）
    if (item.type === 'equipment' && item.stats) {
      ctx.fillStyle = '#ffff00';
      ctx.font = '11px Arial';
      ctx.fillText('装备属性:', tooltipX + 10, tooltipY + yOffset);
      yOffset += 15;
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Arial';
      
      if (item.stats.attack) {
        ctx.fillText(`攻击力: +${item.stats.attack}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.defense) {
        ctx.fillText(`防御力: +${item.stats.defense}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.maxHp) {
        ctx.fillText(`生命值: +${item.stats.maxHp}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.maxMp) {
        ctx.fillText(`魔法值: +${item.stats.maxMp}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
      if (item.stats.speed) {
        ctx.fillText(`速度: +${item.stats.speed}`, tooltipX + 15, tooltipY + yOffset);
        yOffset += 12;
      }
    }
    
    // 工具属性：功能、耐久和速度属于定义/实例状态，只读展示。
    if (isTool) {
      const maxDurability = Number(item.maxDurability) || 0;
      const durability = Math.max(0, Number(item.durability) || 0);
      ctx.fillStyle = '#7fd6ff';
      ctx.font = '10px Arial';
      ctx.fillText(`功能: ${item.functionDescription || `用于${item.toolType}`}`, tooltipX + 10, tooltipY + yOffset);
      yOffset += 14;
      ctx.fillStyle = durability <= 0 ? '#ff7777' : '#ffffff';
      ctx.fillText(`耐久: ${durability}/${maxDurability}`, tooltipX + 10, tooltipY + yOffset);
      yOffset += 14;
      ctx.fillStyle = '#a9e59b';
      ctx.fillText(`采集速度: ×${Number(item.gatherSpeed) > 0 ? item.gatherSpeed : 1}`, tooltipX + 10, tooltipY + yOffset);
      yOffset += 14;
      if (durability <= 0) {
        ctx.fillStyle = '#ff7777';
        ctx.fillText('工具已损坏，可锻造修复', tooltipX + 10, tooltipY + yOffset);
        yOffset += 14;
      }
    }

    // 特殊属性（穿刺、多重箭等）
    if (item.pierce) {
      ctx.fillStyle = '#ff8800';
      ctx.font = '10px Arial';
      ctx.fillText(`穿刺: ${item.pierce}`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    }
    if (item.multishot) {
      ctx.fillStyle = '#ff8800';
      ctx.font = '10px Arial';
      ctx.fillText(`多重箭: ${item.multishot}`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    }
    
    // 攻击间隔（武器特有属性）
    if (item.attackSpeed != null) {
      ctx.fillStyle = '#ffaa00';
      ctx.font = '10px Arial';
      ctx.fillText(`攻击间隔: ${item.attackSpeed}秒`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    } else if (item.subType === 'mainhand' || item.subType === 'offhand' || item.subType === 'weapon') {
      ctx.fillStyle = '#ffaa00';
      ctx.font = '10px Arial';
      ctx.fillText(`攻击间隔: 3秒`, tooltipX + 15, tooltipY + yOffset);
      yOffset += 12;
    }
    
    // 物品价值
    if (item.value) {
      ctx.fillStyle = '#ffaa00';
      ctx.font = '10px Arial';
      ctx.fillText(`价值: ${item.value} 金币`, tooltipX + 10, tooltipY + tooltipHeight - 15);
    }
  }

  /**
   * 文字换行
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   * @param {string} text - 文本
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} maxWidth - 最大宽度
   * @param {number} lineHeight - 行高
   */
  wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split('');
    let line = '';
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i];
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = words[i];
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  /**
   * 渲染右键菜单
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderContextMenu(ctx) {
    if (!this.contextMenu.visible) return;
    
    const menuWidth = 100;
    const menuHeight = this.contextMenu.options.length * 25;
    
    // 菜单背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(this.contextMenu.x, this.contextMenu.y, menuWidth, menuHeight);
    
    // 菜单边框
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.contextMenu.x, this.contextMenu.y, menuWidth, menuHeight);
    
    // 菜单选项
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    
    for (let i = 0; i < this.contextMenu.options.length; i++) {
      const option = this.contextMenu.options[i];
      const optionY = this.contextMenu.y + (i + 1) * 20;
      ctx.fillText(option.label, this.contextMenu.x + 10, optionY);
    }
  }

  /**
   * 渲染拖拽中的物品
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderDraggedItem(ctx) {
    if (!this.draggedItem) return;
    
    // 这里可以渲染正在拖拽的物品
    // 暂时省略实现
  }

  /**
   * 处理鼠标移动事件
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   */
  handleMouseMove(x, y) {
    if (!this.visible) return;

    // 保存鼠标位置
    this.mouseX = x;
    this.mouseY = y;

    // 滚动条拖动中：根据 Y 位移换算滚动行
    if (this.scrollbarDragging) {
      const track = this.getScrollbarTrackRect();
      const thumb = this.getScrollbarThumbRect();
      const usable = track.height - thumb.height;
      const maxScroll = this.getMaxScrollRow();
      if (usable > 0 && maxScroll > 0) {
        const dy = y - this.scrollbarDragStartY;
        const deltaRow = Math.round((dy / usable) * maxScroll);
        this.scrollRow = this.scrollbarDragStartRow + deltaRow;
        this.clampScroll();
      }
      return;
    }

    this.hoveredSlot = -1;

    // 检查是否悬停在物品槽上
    if (this.entity) {
      const inventoryComponent = this.entity.getComponent('inventory');
      if (inventoryComponent) {
        const slotIndex = this.getSlotAtPosition(x, y);
        if (slotIndex >= 0 && slotIndex < inventoryComponent.maxSlots) {
          this.hoveredSlot = slotIndex;
        }
      }
    }
  }

  /**
   * 结束滚动条拖动（鼠标/触摸抬起时调用）
   */
  endScrollbarDrag() {
    this.scrollbarDragging = false;
  }

  /**
   * 处理鼠标点击事件
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   * @param {string} button - 鼠标按钮 ('left' | 'right')
   * @returns {boolean} 是否处理了点击事件
   */
  handleMouseClick(x, y, button = 'left') {
    if (!this.visible || !this.containsPoint(x, y)) return false;

    // 检查右键菜单点击
    if (this.contextMenu.visible) {
      if (this.handleContextMenuClick(x, y)) {
        return true;
      }
      // 点击菜单外部，隐藏菜单
      this.contextMenu.visible = false;
    }

    // 滚动条交互（仅当需要滚动时）
    if (button === 'left' && this.getTotalRows() > this.maxVisibleRows) {
      const track = this.getScrollbarTrackRect();
      const onTrackX = x >= track.x - 4 && x <= track.x + track.width + 4;
      if (onTrackX && y >= track.y && y <= track.y + track.height) {
        const thumb = this.getScrollbarThumbRect();
        if (y >= thumb.y && y <= thumb.y + thumb.height) {
          // 按住滑块开始拖动
          this.scrollbarDragging = true;
          this.scrollbarDragStartY = y;
          this.scrollbarDragStartRow = this.scrollRow;
        } else {
          // 点击轨道：按页翻动
          this.scrollBy(y < thumb.y ? -this.maxVisibleRows : this.maxVisibleRows);
        }
        return true;
      }
    }

    // 检查过滤器按钮点击
    for (const filterButton of this.filterButtons) {
      const buttonX = this.x + filterButton.x;
      const buttonY = this.y + filterButton.y;
      
      if (x >= buttonX && x <= buttonX + filterButton.width &&
          y >= buttonY && y <= buttonY + filterButton.height) {
        this.setFilter(filterButton.name);
        return true;
      }
    }

    // 检查物品详情按钮点击（移动端）
    if (this.itemDetailSlot >= 0 && this.itemDetailButtons.length > 0) {
      for (const btn of this.itemDetailButtons) {
        if (x >= btn.x && x <= btn.x + btn.width && y >= btn.y && y <= btn.y + btn.height) {
          if (btn.action === 'equip') {
            this.handleSlotLeftClick(this.itemDetailSlot, true);
          } else if (btn.action === 'use') {
            this.useItem(this.itemDetailSlot);
          } else if (btn.action === 'repair') {
            this.repairItem(this.itemDetailSlot);
          } else if (btn.action === 'drop') {
            this.dropItem(this.itemDetailSlot);
          }
          this.itemDetailSlot = -1;
          this.itemDetailButtons = [];
          return true;
        }
      }
      // 点击了详情面板外区域，关闭详情
      this.itemDetailSlot = -1;
      this.itemDetailButtons = [];
      return true;
    }

    // 检查物品槽点击
    const slotIndex = this.getSlotAtPosition(x, y);
    if (slotIndex >= 0) {
      if (button === 'left') {
        if (!this.showTooltip) {
          // 移动端：不立即使用/装备，进入长按检测模式
          // 短按释放 → update() 中执行 handleSlotLeftClick
          // 长按 1 秒 → 显示 tooltip，释放关闭
          this.longPressSlot = slotIndex;
          this.longPressStart = performance.now();
          this.longPressActive = false;
          this.longPressShowTooltip = false;
        } else {
          // 桌面端：直接使用/装备
          this.handleSlotLeftClick(slotIndex);
        }
      } else if (button === 'right') {
        this.handleSlotRightClick(slotIndex, x, y);
      }
      return true;
    }

    return true;
  }

  /**
   * 处理右键菜单点击
   * @param {number} x - 鼠标X坐标
   * @param {number} y - 鼠标Y坐标
   * @returns {boolean} 是否处理了点击
   */
  handleContextMenuClick(x, y) {
    if (!this.contextMenu.visible) return false;
    
    const menuWidth = 100;
    const menuHeight = this.contextMenu.options.length * 25;
    
    // 检查是否点击在菜单内
    if (x < this.contextMenu.x || x > this.contextMenu.x + menuWidth ||
        y < this.contextMenu.y || y > this.contextMenu.y + menuHeight) {
      return false;
    }
    
    // 计算点击的选项索引
    const relativeY = y - this.contextMenu.y;
    const optionIndex = Math.floor(relativeY / 25);
    
    if (optionIndex >= 0 && optionIndex < this.contextMenu.options.length) {
      const option = this.contextMenu.options[optionIndex];
      const slotIndex = this.contextMenu.slotIndex;
      
      console.log(`点击菜单选项: ${option.label}, 槽位: ${slotIndex}`);
      
      // 执行对应操作
      switch (option.action) {
        case 'use':
          this.useItem(slotIndex);
          break;
        case 'repair':
          this.repairItem(slotIndex);
          break;
        case 'drop':
          this.dropItem(slotIndex);
          break;
      }
      
      // 隐藏菜单
      this.contextMenu.visible = false;
      return true;
    }
    
    return false;
  }

  /**
   * 丢弃物品
   * @param {number} slotIndex - 槽位索引
   */
  dropItem(slotIndex) {
    const inventory = this.entity?.getComponent?.('inventory');
    const stack = inventory?.getSlot?.(slotIndex);
    if (!stack?.item || !this.onIntent) return;
    const item = stack.item;
    console.log(`丢弃物品: ${item.name}`);
    return this.onIntent('item.drop', {
      itemId: item.id,
      instanceId: item.instanceId || null,
      quantity: 1
    });
  }

  repairItem(slotIndex) {
    const inventory = this.entity?.getComponent?.('inventory');
    const item = inventory?.getSlot?.(slotIndex)?.item;
    if (!item?.instanceId || !this.onIntent) return;
    const maxDurability = Number(item.maxDurability) || 0;
    if (maxDurability <= 0 || Number(item.durability) >= maxDurability) return;
    return this.onIntent('item.repair', {
      itemId: item.id,
      instanceId: item.instanceId
    });
  }

  /**
   * 获取指定位置的槽位索引
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @returns {number} 槽位索引，-1表示无效
   */
  getSlotAtPosition(x, y) {
    const relativeX = x - this.x - this.slotStartX;
    const relativeY = y - this.y - this.slotStartY;
    
    if (relativeX < 0 || relativeY < 0) return -1;
    
    const col = Math.floor(relativeX / (this.slotSize + this.slotPadding));
    const visibleRow = Math.floor(relativeY / (this.slotSize + this.slotPadding));
    
    if (col >= this.slotsPerRow || visibleRow >= this.maxVisibleRows) return -1;
    
    const slotX = col * (this.slotSize + this.slotPadding);
    const slotY = visibleRow * (this.slotSize + this.slotPadding);
    
    // 检查是否在槽位内部
    if (relativeX >= slotX && relativeX <= slotX + this.slotSize &&
        relativeY >= slotY && relativeY <= slotY + this.slotSize) {
      
      // 加上滚动偏移得到真实行号
      const actualRow = visibleRow + this.scrollRow;
      const displayIndex = actualRow * this.slotsPerRow + col;
      
      if (this.entity) {
        const inventoryComponent = this.entity.getComponent('inventory');
        if (inventoryComponent) {
          const currentFilter = inventoryComponent.currentFilter;
          
          if (currentFilter === 'all') {
            // 显示全部时，直接返回槽位索引
            return displayIndex < inventoryComponent.maxSlots ? displayIndex : -1;
          } else {
            // 分类模式时，返回筛选后物品的原始索引
            const filteredItems = this.getFilteredItems(inventoryComponent);
            if (displayIndex < filteredItems.length) {
              return filteredItems[displayIndex].index;
            }
          }
        }
      }
    }
    
    return -1;
  }

  /**
   * 兼容旧调用：详情展示统一交给组合 BackpackPanel 的操作菜单。
   * @param {number} slotIndex
   * @returns {boolean}
   */
  openItemDetail(slotIndex) {
    return this.requestItemActionMenu(slotIndex);
  }

  /**
   * 渲染物品详情面板（移动端）
   * @param {CanvasRenderingContext2D} ctx
   */
  renderItemDetailPanel(ctx) {
    if (this.itemDetailSlot < 0 || !this.entity) return;
    const inv = this.entity.getComponent('inventory');
    if (!inv) return;
    const slot = inv.getSlot(this.itemDetailSlot);
    if (!slot || !slot.item) { this.itemDetailSlot = -1; return; }
    const item = slot.item;

    // 面板位置：背包面板顶部居中
    const isTool = typeof item.toolType === 'string' && item.toolType.length > 0;
    const pw = 220;
    const isRepairable = isTool && item.instanceId && Number(item.maxDurability) > 0
      && Number(item.durability) < Number(item.maxDurability);
    const ph = isTool ? 182 : 140;
    const px = this.x + Math.round((this.width - pw) / 2);
    const py = this.y - ph - 6;

    ctx.save();
    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(px, py, pw, ph);
    const rarityColors = ['#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000'];
    ctx.strokeStyle = rarityColors[item.rarity] || '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    let yOff = 18;
    // 名称
    ctx.fillStyle = rarityColors[item.rarity] || '#ffffff';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(item.name, px + 10, py + yOff);
    yOff += 18;

    // 属性
    ctx.fillStyle = '#cccccc';
    ctx.font = '11px Arial';
    if (item.stats) {
      const statLabels = { attack: '攻击', defense: '防御', maxHp: '生命', maxMp: '魔法', speed: '速度' };
      for (const k of Object.keys(statLabels)) {
        if (item.stats[k]) {
          ctx.fillText(`${statLabels[k]}: +${item.stats[k]}`, px + 10, py + yOff);
          yOff += 14;
        }
      }
    }
    if (item.effect) {
      const effectText = item.effect.type === 'heal' ? `回复 ${item.effect.value} 生命`
        : item.effect.type === 'restore_mana' ? `回复 ${item.effect.value} 魔法`
        : '特殊效果';
      ctx.fillStyle = '#00ff00';
      ctx.fillText(effectText, px + 10, py + yOff);
      yOff += 14;
    }

    if (typeof item.toolType === 'string' && item.toolType) {
      ctx.fillStyle = '#7fd6ff';
      ctx.fillText(`功能: ${item.functionDescription || `用于${item.toolType}`}`, px + 10, py + yOff);
      yOff += 14;
      ctx.fillStyle = Number(item.durability) <= 0 ? '#ff7777' : '#ffffff';
      ctx.fillText(`耐久: ${Math.max(0, Number(item.durability) || 0)}/${Number(item.maxDurability) || 0}`, px + 10, py + yOff);
      yOff += 14;
      ctx.fillStyle = '#a9e59b';
      ctx.fillText(`采集速度: ×${Number(item.gatherSpeed) > 0 ? item.gatherSpeed : 1}`, px + 10, py + yOff);
      yOff += 14;
    }

    // 按钮：装备/使用 + 丢弃
    const btnY = py + ph - 32;
    const btnH = 24;
    this.itemDetailButtons = [];

    if (isRepairable) {
      const b1 = { label: '锻造修复', action: 'repair', x: px + 12, y: btnY, width: 92, height: btnH };
      const b2 = { label: '丢弃', action: 'drop', x: px + 120, y: btnY, width: 70, height: btnH };
      this.itemDetailButtons.push(b1, b2);
    } else if (item.type === 'equipment') {
      const b1 = { label: '装备', action: 'equip', x: px + 20, y: btnY, width: 70, height: btnH };
      const b2 = { label: '丢弃', action: 'drop', x: px + 120, y: btnY, width: 70, height: btnH };
      this.itemDetailButtons.push(b1, b2);
    } else if (item.type === 'consumable' && item.usable) {
      const b1 = { label: '使用', action: 'use', x: px + 20, y: btnY, width: 70, height: btnH };
      const b2 = { label: '丢弃', action: 'drop', x: px + 120, y: btnY, width: 70, height: btnH };
      this.itemDetailButtons.push(b1, b2);
    } else {
      const b1 = { label: '丢弃', action: 'drop', x: px + 70, y: btnY, width: 70, height: btnH };
      this.itemDetailButtons.push(b1);
    }

    // 绘制按钮
    for (const btn of this.itemDetailButtons) {
      ctx.fillStyle = 'rgba(80, 130, 200, 0.8)';
      ctx.fillRect(btn.x, btn.y, btn.width, btn.height);
      ctx.strokeStyle = '#aaccff';
      ctx.lineWidth = 1;
      ctx.strokeRect(btn.x, btn.y, btn.width, btn.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(btn.label, btn.x + btn.width / 2, btn.y + btn.height / 2 + 4);
    }

    ctx.restore();
  }

  /**
   * 处理槽位左键点击
   * @param {number} slotIndex - 槽位索引
   */
  handleSlotLeftClick(slotIndex) {
    this.selectedSlot = slotIndex;
    console.log(`选中槽位: ${slotIndex}`);
    const inventory = this.entity?.getComponent?.('inventory');
    const stack = inventory?.getSlot?.(slotIndex);
    if (!stack?.item || !this.onIntent) return;
    const item = stack.item;
    if (item.type === 'equipment') {
      console.log(`尝试装备物品: ${item.name}, subType: ${item.subType}`);
      return this.onIntent('item.equip', {
        itemId: item.id,
        instanceId: item.instanceId || null
      });
    }
    if (item.type === 'consumable' && item.usable) return this.useItem(slotIndex);
  }

  /**
   * 使用物品
   * @param {number} slotIndex - 槽位索引
   */
  useItem(slotIndex) {
    const inventory = this.entity?.getComponent?.('inventory');
    const stack = inventory?.getSlot?.(slotIndex);
    if (!stack?.item?.usable || !this.onIntent) return;
    const item = stack.item;
    if (this.canUseItem && !this.canUseItem(item)) {
      console.log(`物品 ${item.name} 暂时无法使用`);
      return;
    }
    console.log(`使用物品: ${item.name}`);
    return this.onIntent('item.use', {
      itemId: item.id,
      instanceId: item.instanceId || null,
      quantity: 1
    });
  }

  /**
   * 桌面右键打开与移动端/手柄共用的详情操作菜单。
   * @param {number} slotIndex - 背包真实槽位索引
   * @returns {boolean}
   */
  handleSlotRightClick(slotIndex) {
    return this.requestItemActionMenu(slotIndex);
  }

  /**
   * 只向外层菜单发送稳定身份，避免异步命令完成后对变更后的槽位误操作。
   * @param {number} slotIndex - 背包真实槽位索引
   * @returns {boolean}
   */
  requestItemActionMenu(slotIndex) {
    const inventory = this.entity?.getComponent?.('inventory');
    const item = inventory?.getSlot?.(slotIndex)?.item || null;
    if (!item || !this.onItemActionMenu) return false;
    this.selectedSlot = slotIndex;
    return this.onItemActionMenu({
      kind: 'inventory',
      slotIndex,
      itemId: item.id,
      instanceId: item.instanceId ?? null
    }) === true;
  }

  /**
   * 设置过滤器
   * @param {string} filterName - 过滤器名称
   */
  setFilter(filterName) {
    if (!this.entity) return;
    
    const inventoryComponent = this.entity.getComponent('inventory');
    if (inventoryComponent) {
      inventoryComponent.setFilter(filterName);
      // 切换分类后回到首行，避免沿用上一分类的滚动位置而显示空白区域
      this.scrollRow = 0;
      this.hoveredSlot = -1;
      this.selectedSlot = -1;

      if (this.onFilterChange) {
        this.onFilterChange(filterName);
      }
    }
  }

  /**
   * 切换面板显示状态
   */
  toggle() {
    this.visible = !this.visible;
  }

  /**
   * 显示面板
   */
  show() {
    this.visible = true;
  }

  /**
   * 隐藏面板
   */
  hide() {
    this.visible = false;
    this.contextMenu.visible = false;
  }

  /**
   * 计算属性变化
   * @param {Object} oldStats - 旧属性
   * @param {Object} newStats - 新属性组件
   * @returns {Object} 属性变化对象
   */
  calculateStatChanges(oldStats, newStats) {
    if (!oldStats || !newStats) return {};
    
    const changes = {};
    const statNames = {
      attack: '攻击',
      defense: '防御',
      maxHp: '生命',
      maxMp: '魔法',
      speed: '速度'
    };
    
    for (const stat in statNames) {
      const diff = newStats[stat] - oldStats[stat];
      if (diff !== 0) {
        changes[stat] = {
          name: statNames[stat],
          value: diff
        };
      }
    }
    
    return changes;
  }

  /**
   * 显示装备通知
   * @param {string} equipName - 装备的物品名称
   * @param {string} unequipName - 卸下的物品名称
   * @param {Object} statChanges - 属性变化
   * @param {boolean} isEquip - 是否是装备操作
   * @param {Object} [info] - 结构化变更信息 { slot, item, oldItem, action }，
   *   随 onEquipmentChange 一并回传，供上层派发事件（如"装备武器后刷怪"的触发器）
   */
  showEquipmentNotification(equipName, unequipName, statChanges, isEquip, info = null) {
    // 构建通知消息
    let messages = [];
    
    if (isEquip) {
      messages.push(`装备了 ${equipName}`);
      if (unequipName) {
        messages.push(`卸下了 ${unequipName}`);
      }
    } else {
      messages.push(`卸下了 ${unequipName || equipName}`);
    }
    
    // 添加属性变化
    const changeTexts = [];
    for (const stat in statChanges) {
      const change = statChanges[stat];
      if (change.value > 0) {
        changeTexts.push(`${change.name} +${change.value}`);
      } else {
        changeTexts.push(`${change.name} ${change.value}`);
      }
    }
    
    if (changeTexts.length > 0) {
      messages.push(changeTexts.join(' '));
    }
    
    // 输出到控制台
    console.log('装备变化:', messages.join(' | '));
    
    // 触发通知回调
    if (this.onEquipmentChange) {
      this.onEquipmentChange(messages, info);
    }
  }
}
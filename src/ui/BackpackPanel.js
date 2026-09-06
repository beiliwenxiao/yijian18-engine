import { UIElement } from './UIElement.js';
import { PlayerInfoPanel } from './PlayerInfoPanel.js';
import { InventoryPanel } from './InventoryPanel.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

const LEFT_STICK_NAV_THRESHOLD = 0.5;
const RARITY_COLORS = ['#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000'];

/**
 * 单一背包面板：组合角色属性、已装备物品和背包物品。
 * 外层位置与尺寸由 UIEditor 的 backpackPanel 配置控制；内部部件由
 * PanelEditor 的 backpackPanel.parts 通过 section 分区控制。
 */
export class BackpackPanel extends UIElement {
  constructor(options = {}) {
    super({
      x: options.x || 20,
      y: options.y || 20,
      width: options.width || 900,
      height: options.height || 520,
      visible: options.visible || false,
      // 弹窗层：高于底部技能栏/功能按钮/HUD/小地图（200 档），
      // 低于“获得物品”弹窗(260) 和手柄面板(900)
      zIndex: options.zIndex || 250
    });

    this.backgroundColor = options.backgroundColor || 'rgba(0, 0, 0, 0.88)';
    this.borderColor = options.borderColor || '#4a9eff';
    this.borderWidth = options.borderWidth || 2;
    this._characterBounds = { x: 0, y: 0, width: 300, height: this.height };
    this._inventoryBounds = { x: 310, y: 0, width: this.width - 310, height: this.height };
    this._onEquipmentClick = typeof options.onEquipmentClick === 'function'
      ? options.onEquipmentClick
      : null;
    this._isMobileLayout = options.isMobileLayout === true || options.inventoryOptions?.showTooltip === false;

    // PanelEditor 的部件坐标以设计基准尺寸为参照；外框由 UIEditor 百分比缩放。
    this._panelLayout = null;
    this._contentScale = 1;
    this._contentOffsetX = 0;
    this._contentOffsetY = 0;
    this._contentWidth = this.width;
    this._contentHeight = this.height;
    this._lastFrameWidth = this.width;
    this._lastFrameHeight = this.height;

    // 详情菜单只保存稳定身份，所有业务写入仍经既有原子命令。
    this._itemActionMenu = this._createItemActionMenu();
    this._gamepadFocus = { area: 'inventory', slotIndex: 0, slotType: 'accessory' };
    this._leftStickNavArmed = false;
    this._leftStickDirection = null;

    this.playerInfoContent = new PlayerInfoPanel({
      x: this.x,
      y: this.y,
      width: this._characterBounds.width,
      height: this.height,
      visible: true,
      showAttributeSection: true,
      showEquipmentSection: true,
      onAttributeAllocate: options.onAttributeAllocate,
      onEquipmentClick: (slotType, button) => this._handleEquipmentSlotClick(slotType, button),
      getProjection: options.getProjection
    });
    this.inventoryContent = new InventoryPanel({
      x: this.x + this._inventoryBounds.x,
      y: this.y,
      width: this._inventoryBounds.width,
      height: this.height,
      visible: true,
      ...options.inventoryOptions,
      onItemUse: options.onItemUse,
      onItemDrop: options.onItemDrop,
      onFilterChange: options.onFilterChange,
      onEquipmentChange: options.onEquipmentChange,
      canUseItem: options.canUseItem,
      onIntent: options.onIntent,
      onEquipmentUnequip: slotType => this._submitUnequip(slotType),
      onItemActionMenu: descriptor => this.openItemActionMenu(descriptor),
      getProjection: options.getProjection
    });

    this._setContentFrameTransparent();
    this._syncContentLayout();
  }

  get scrollbarDragging() {
    return this.inventoryContent.scrollbarDragging;
  }

  setEntity(entity) {
    this.inventoryContent.setEntity(entity);
    this.playerInfoContent.setPlayer(entity);
  }

  setPlayer(player) {
    this.setEntity(player);
  }

  updatePlayer(player) {
    this.setEntity(player);
  }

  updateInventory(player) {
    this.inventoryContent.setEntity(player);
  }

  setInputManager(inputManager) {
    this.inventoryContent.setInputManager(inputManager);
  }

  useItem(slotIndex) {
    return this.inventoryContent.useItem(slotIndex);
  }

  endScrollbarDrag() {
    this.inventoryContent.endScrollbarDrag();
  }

  show() {
    const wasVisible = this.visible;
    super.show();
    if (!wasVisible) this.resetGamepadFocus();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  hide() {
    super.hide();
    this.closeItemActionMenu();
    this._resetLeftStickNavigation();
    this.inventoryContent.endScrollbarDrag();
    this.inventoryContent.itemDetailSlot = -1;
    this.inventoryContent.itemDetailButtons = [];
  }

  layout() {
    this._applyScaledLayout();
  }

  applyPanelLayout(panelDef) {
    if (!panelDef) return;
    this._panelLayout = panelDef;
    this.backgroundColor = panelDef.backgroundColor ?? this.backgroundColor;
    this.borderColor = panelDef.borderColor ?? this.borderColor;
    this.borderWidth = panelDef.borderWidth ?? this.borderWidth;
    this._applyScaledLayout();
  }

  update(deltaTime) {
    if (!this.visible) return;
    this._ensureScaledLayout();
    this.inventoryContent.update(deltaTime);
    this.playerInfoContent.update(deltaTime);
  }

  render(ctx) {
    if (!this.visible) return;
    this._ensureScaledLayout();

    const fx = this.x + this._contentOffsetX;
    const fy = this.y + this._contentOffsetY;
    const fw = this._contentWidth;
    const fh = this._contentHeight;

    ctx.save();
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(fx, fy, fw, fh);
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    ctx.strokeRect(fx, fy, fw, fh);
    ctx.restore();

    this.playerInfoContent.render(ctx);
    this.inventoryContent.render(ctx);
    this._renderItemActionMenu(ctx);
  }

  handleMouseMove(x, y) {
    if (!this.visible || this._itemActionMenu.visible) return;
    this.playerInfoContent.handleMouseMove(x, y);
    this.inventoryContent.handleMouseMove(x, y);
  }

  handleMouseClick(x, y, button = 'left') {
    if (!this.visible) return false;
    const fx = this.x + this._contentOffsetX;
    const fy = this.y + this._contentOffsetY;
    if (x < fx || x > fx + this._contentWidth || y < fy || y > fy + this._contentHeight) return false;

    if (this._itemActionMenu.visible) {
      if (this._handleItemActionMenuClick(x, y)) return true;
      this.closeItemActionMenu();
      return true;
    }
    // PanelLayout 的 inventory 标题/分隔线可能横跨角色区，使两个 section 包围盒重叠。
    // 角色区内的装备槽必须优先命中；真实背包格位于 character bounds 之外。
    if (this._isInBounds(x, y, this._characterBounds)) {
      return this.playerInfoContent.handleMouseClick(x, y, button);
    }
    if (this._isInBounds(x, y, this._inventoryBounds)) {
      return this.inventoryContent.handleMouseClick(x, y, button);
    }
    return true;
  }

  /** 背包可见期间是正式模态层：自行处理指针/手柄并阻断世界输入。 */
  handleInput({ inputManager = null, gamepad = null } = {}) {
    if (!this.visible) return false;

    if (inputManager?.isMouseClicked?.() && !inputManager.isMouseClickHandled?.()) {
      const point = inputManager.getMousePosition?.() || { x: 0, y: 0 };
      const button = inputManager.getMouseButton?.() === 2 ? 'right' : 'left';
      const handled = this.handleMouseClick(point.x, point.y, button);
      if (handled || inputManager.mouse?.isTouch === true) inputManager.markMouseClickHandled?.();
      else if (button === 'left' && !this.containsPoint(point.x, point.y)) {
        this.hide();
        inputManager.markMouseClickHandled?.();
      }
    }

    if (gamepad?.isButtonPressed?.(PadButton.B) || gamepad?.isButtonPressed?.(PadButton.RS)) {
      if (this._itemActionMenu.visible) this.closeItemActionMenu();
      else this.hide();
      return true;
    }

    const direction = this._readLeftStickDirection(gamepad);
    const confirmed = gamepad?.isButtonPressed?.(PadButton.A) === true
      || gamepad?.isButtonPressed?.(PadButton.X) === true;
    if (this._itemActionMenu.visible) {
      if (direction) this._moveMenuSelection(direction);
      if (confirmed) this._activateSelectedMenuAction();
    } else {
      if (direction) this._moveGamepadFocus(direction);
      if (confirmed) this._openFocusedItemActionMenu();
    }
    return true;
  }

  /** 桌面左键保持旧的快捷卸下；右键和移动端点击进入统一菜单。 */
  _handleEquipmentSlotClick(slotType, button) {
    const item = this.playerInfoContent.getEquipmentItem(slotType);
    if (!item) return true;
    if (button === 'right' || this._isMobileLayout) {
      return this.openItemActionMenu({
        kind: 'equipment',
        slotType,
        itemId: item.id,
        instanceId: item.instanceId ?? null
      });
    }
    return this._submitUnequip(slotType);
  }

  _submitUnequip(slotType) {
    return this._onEquipmentClick?.(slotType, 'left') || { ok: false, code: 'unequipUnavailable' };
  }

  openItemActionMenu(descriptor = {}) {
    const normalized = {
      kind: descriptor.kind,
      itemId: descriptor.itemId,
      instanceId: descriptor.instanceId ?? null,
      slotIndex: descriptor.slotIndex,
      slotType: descriptor.slotType
    };
    const resolved = this._resolveMenuItem(normalized);
    if (!resolved) return false;
    const actions = this._getMenuActions(resolved);
    if (actions.length === 0) return false;
    this._itemActionMenu = {
      visible: true,
      descriptor: normalized,
      actions,
      selectedActionId: actions[0].id,
      pending: false,
      bounds: null,
      buttons: []
    };
    this._gamepadFocus.area = 'menu';
    this._resetLeftStickNavigation();
    return true;
  }

  closeItemActionMenu() {
    const descriptor = this._itemActionMenu.descriptor;
    this._itemActionMenu = this._createItemActionMenu();
    if (descriptor?.kind === 'equipment') {
      this._gamepadFocus.area = 'equipment';
      this._setEquipmentFocus(descriptor.slotType);
    } else {
      this._gamepadFocus.area = 'inventory';
      this._setInventoryFocus(descriptor?.slotIndex ?? this._gamepadFocus.slotIndex);
    }
    this._resetLeftStickNavigation();
  }

  resetGamepadFocus() {
    this._gamepadFocus.area = 'inventory';
    this._gamepadFocus.slotType = 'accessory';
    this._setInventoryFocus(0);
    this.playerInfoContent.setFocusedEquipSlot(null);
    this._resetLeftStickNavigation();
  }

  _createItemActionMenu() {
    return {
      visible: false,
      descriptor: null,
      actions: [],
      selectedActionId: null,
      pending: false,
      bounds: null,
      buttons: []
    };
  }

  _resolveMenuItem(descriptor = this._itemActionMenu.descriptor) {
    if (!descriptor?.itemId) return null;
    if (descriptor.kind === 'inventory') {
      const inventory = this.inventoryContent.entity?.getComponent?.('inventory');
      const stack = inventory?.getSlot?.(descriptor.slotIndex);
      const item = stack?.item || null;
      return this._matchesItemIdentity(item, descriptor) ? { item, descriptor } : null;
    }
    if (descriptor.kind === 'equipment') {
      const item = this.playerInfoContent.getEquipmentItem(descriptor.slotType);
      return this._matchesItemIdentity(item, descriptor) ? { item, descriptor } : null;
    }
    return null;
  }

  _matchesItemIdentity(item, descriptor) {
    return !!item && item.id === descriptor.itemId && (item.instanceId ?? null) === descriptor.instanceId;
  }

  _getMenuActions({ item, descriptor }) {
    if (descriptor.kind === 'equipment') return [{ id: 'unequip', label: '卸下', color: '#8d5a3b' }];
    if (item.type === 'equipment') {
      return [
        { id: 'equip', label: '装备', color: '#3f7e48' },
        { id: 'drop', label: '丢弃', color: '#8d3d3d' }
      ];
    }
    if (item.type === 'consumable' && item.usable) {
      return [
        { id: 'use', label: '使用', color: '#3f7e48' },
        { id: 'drop', label: '丢弃', color: '#8d3d3d' }
      ];
    }
    return [{ id: 'drop', label: '丢弃', color: '#8d3d3d' }];
  }

  _renderItemActionMenu(ctx) {
    const menu = this._itemActionMenu;
    if (!menu.visible) return;
    const resolved = this._resolveMenuItem();
    if (!resolved) {
      this.closeItemActionMenu();
      return;
    }
    const { item, descriptor } = resolved;
    const actions = this._getMenuActions(resolved);
    menu.actions = actions;
    if (!actions.some(action => action.id === menu.selectedActionId)) {
      menu.selectedActionId = actions[0]?.id || null;
    }

    const statEntries = Object.entries(item.stats || {}).filter(([, value]) => Number(value) !== 0).slice(0, 4);
    const width = Math.min(280, Math.max(220, this._contentWidth - 32));
    const height = 132 + statEntries.length * 15;
    const x = this.x + this._contentOffsetX + Math.round((this._contentWidth - width) / 2);
    const y = this.y + this._contentOffsetY + Math.max(16, Math.round((this._contentHeight - height) / 2));
    menu.bounds = { x, y, width, height };
    menu.buttons = [];

    ctx.save();
    ctx.fillStyle = 'rgba(5, 10, 18, 0.97)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = RARITY_COLORS[item.rarity] || '#aaccff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = RARITY_COLORS[item.rarity] || '#ffffff';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(item.name || item.id, x + 14, y + 23);
    ctx.fillStyle = '#a9bad2';
    ctx.font = '11px Arial';
    ctx.fillText(descriptor.kind === 'equipment' ? '已装备物品' : '背包物品', x + 14, y + 40);

    let lineY = y + 59;
    for (const [key, value] of statEntries) {
      ctx.fillStyle = '#77df8e';
      ctx.fillText(`${this._statLabel(key)}: +${value}`, x + 14, lineY);
      lineY += 15;
    }
    if (statEntries.length === 0 && item.description) {
      ctx.fillStyle = '#d4d4d4';
      ctx.fillText(item.description.slice(0, 34), x + 14, lineY);
    }

    const gap = 10;
    const buttonY = y + height - 38;
    const buttonWidth = Math.floor((width - 28 - gap * (actions.length - 1)) / actions.length);
    actions.forEach((action, index) => {
      const button = {
        ...action,
        x: x + 14 + index * (buttonWidth + gap),
        y: buttonY,
        width: buttonWidth,
        height: 25
      };
      menu.buttons.push(button);
      const selected = action.id === menu.selectedActionId;
      ctx.fillStyle = menu.pending ? 'rgba(86, 96, 110, 0.75)' : action.color;
      ctx.fillRect(button.x, button.y, button.width, button.height);
      ctx.strokeStyle = selected ? '#ffe785' : '#d5e5ff';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(button.x, button.y, button.width, button.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(menu.pending && selected ? '处理中…' : action.label, button.x + button.width / 2, button.y + 17);
    });
    ctx.restore();
  }

  _statLabel(key) {
    return ({ attack: '攻击', defense: '防御', maxHp: '生命', maxMp: '法力', speed: '速度' })[key] || key;
  }

  _handleItemActionMenuClick(x, y) {
    const menu = this._itemActionMenu;
    const bounds = menu.bounds;
    if (!bounds || x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) {
      return false;
    }
    const button = menu.buttons.find(entry => x >= entry.x && x <= entry.x + entry.width && y >= entry.y && y <= entry.y + entry.height);
    if (button) this._activateMenuAction(button.id);
    return true;
  }

  _activateSelectedMenuAction() {
    return this._activateMenuAction(this._itemActionMenu.selectedActionId);
  }

  _activateMenuAction(actionId) {
    const menu = this._itemActionMenu;
    if (!menu.visible || menu.pending || !actionId) return false;
    const resolved = this._resolveMenuItem();
    if (!resolved) {
      this.closeItemActionMenu();
      return false;
    }
    const { item, descriptor } = resolved;
    let result = null;
    if (actionId === 'equip') {
      result = this.inventoryContent.onIntent?.('item.equip', { itemId: item.id, instanceId: item.instanceId ?? null });
    } else if (actionId === 'unequip') {
      result = this._submitUnequip(descriptor.slotType);
    } else if (actionId === 'drop') {
      result = this.inventoryContent.onIntent?.('item.drop', {
        itemId: item.id,
        instanceId: item.instanceId ?? null,
        quantity: 1
      });
    } else if (actionId === 'use') {
      result = this.inventoryContent.useItem(descriptor.slotIndex);
    }
    if (!result || typeof result.then !== 'function') return false;

    menu.pending = true;
    Promise.resolve(result)
      .then(commandResult => {
        if (this._itemActionMenu === menu && commandResult?.ok === true) this.closeItemActionMenu();
      })
      .catch(error => console.warn('BackpackPanel: 物品菜单命令失败', error))
      .finally(() => {
        if (this._itemActionMenu === menu) menu.pending = false;
      });
    return true;
  }

  _readLeftStickDirection(gamepad) {
    const stick = gamepad?.leftStick || { x: 0, y: 0 };
    const x = Number(stick.x) || 0;
    const y = Number(stick.y) || 0;
    let direction = null;
    if (Math.abs(x) >= LEFT_STICK_NAV_THRESHOLD || Math.abs(y) >= LEFT_STICK_NAV_THRESHOLD) {
      if (Math.abs(x) >= Math.abs(y)) direction = x < 0 ? 'left' : 'right';
      else direction = y < 0 ? 'up' : 'down';
    }
    if (!this._leftStickNavArmed) {
      if (!direction) this._leftStickNavArmed = true;
      this._leftStickDirection = direction;
      return null;
    }
    const step = direction && direction !== this._leftStickDirection ? direction : null;
    this._leftStickDirection = direction;
    return step;
  }

  _resetLeftStickNavigation() {
    this._leftStickNavArmed = false;
    this._leftStickDirection = null;
  }

  _moveMenuSelection(direction) {
    const menu = this._itemActionMenu;
    if (menu.pending || menu.actions.length === 0) return false;
    const delta = direction === 'left' || direction === 'up' ? -1 : 1;
    const current = menu.actions.findIndex(action => action.id === menu.selectedActionId);
    const index = (Math.max(0, current) + delta + menu.actions.length) % menu.actions.length;
    menu.selectedActionId = menu.actions[index].id;
    return true;
  }

  _moveGamepadFocus(direction) {
    if (this._gamepadFocus.area === 'equipment') return this._moveEquipmentFocus(direction);
    return this._moveInventoryFocus(direction);
  }

  _moveInventoryFocus(direction) {
    const inventory = this.inventoryContent.entity?.getComponent?.('inventory');
    const maxSlots = Number(inventory?.maxSlots) || 0;
    if (maxSlots <= 0) return false;
    const columns = this.inventoryContent.slotsPerRow;
    const slotIndex = Math.max(0, Math.min(maxSlots - 1, this._gamepadFocus.slotIndex));
    const row = Math.floor(slotIndex / columns);
    const col = slotIndex % columns;
    if (direction === 'left' && col === 0) {
      this._gamepadFocus.area = 'equipment';
      return this._setEquipmentFocus(this.playerInfoContent.getEquipmentSlotAt(Math.min(3, row), 2));
    }
    let next = slotIndex;
    if (direction === 'left' && col > 0) next--;
    else if (direction === 'right' && col < columns - 1 && slotIndex + 1 < maxSlots) next++;
    else if (direction === 'up' && slotIndex >= columns) next -= columns;
    else if (direction === 'down' && slotIndex + columns < maxSlots) next += columns;
    return this._setInventoryFocus(next);
  }

  _moveEquipmentFocus(direction) {
    const current = this.playerInfoContent.getEquipmentSlotPosition(this._gamepadFocus.slotType) || { row: 0, col: 0 };
    if (direction === 'right' && current.col === 2) {
      this._gamepadFocus.area = 'inventory';
      const inventory = this.inventoryContent.entity?.getComponent?.('inventory');
      const maxSlots = Number(inventory?.maxSlots) || 0;
      return maxSlots > 0 && this._setInventoryFocus(Math.min(maxSlots - 1, current.row * this.inventoryContent.slotsPerRow));
    }
    let row = current.row;
    let col = current.col;
    if (direction === 'left') col = Math.max(0, col - 1);
    if (direction === 'right') col = Math.min(2, col + 1);
    if (direction === 'up') row = Math.max(0, row - 1);
    if (direction === 'down') row = Math.min(3, row + 1);
    return this._setEquipmentFocus(this.playerInfoContent.getEquipmentSlotAt(row, col));
  }

  _setInventoryFocus(slotIndex) {
    const inventory = this.inventoryContent.entity?.getComponent?.('inventory');
    const maxSlots = Number(inventory?.maxSlots) || 0;
    if (maxSlots <= 0) return false;
    const next = Math.max(0, Math.min(maxSlots - 1, Number(slotIndex) || 0));
    this._gamepadFocus.slotIndex = next;
    this.inventoryContent.focusedSlot = next;
    this.playerInfoContent.setFocusedEquipSlot(null);
    const row = Math.floor(next / this.inventoryContent.slotsPerRow);
    if (row < this.inventoryContent.scrollRow) this.inventoryContent.scrollRow = row;
    if (row >= this.inventoryContent.scrollRow + this.inventoryContent.maxVisibleRows) {
      this.inventoryContent.scrollRow = row - this.inventoryContent.maxVisibleRows + 1;
    }
    this.inventoryContent.clampScroll();
    return true;
  }

  _setEquipmentFocus(slotType) {
    if (!slotType) return false;
    this._gamepadFocus.slotType = slotType;
    this.playerInfoContent.setFocusedEquipSlot(slotType);
    this.inventoryContent.focusedSlot = -1;
    return true;
  }

  _openFocusedItemActionMenu() {
    if (this._gamepadFocus.area === 'equipment') {
      const slotType = this._gamepadFocus.slotType;
      const item = this.playerInfoContent.getEquipmentItem(slotType);
      if (!item) return true;
      return this.openItemActionMenu({ kind: 'equipment', slotType, itemId: item.id, instanceId: item.instanceId ?? null });
    }
    const inventory = this.inventoryContent.entity?.getComponent?.('inventory');
    const slotIndex = this._gamepadFocus.slotIndex;
    const item = inventory?.getSlot?.(slotIndex)?.item || null;
    if (!item) return true;
    return this.openItemActionMenu({ kind: 'inventory', slotIndex, itemId: item.id, instanceId: item.instanceId ?? null });
  }

  _createContentLayout(parts) {
    return {
      width: this._contentWidth,
      height: this._contentHeight,
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderColor: 'rgba(0, 0, 0, 0)',
      borderWidth: 0,
      parts
    };
  }

  _ensureScaledLayout() {
    if (this._lastFrameWidth !== this.width || this._lastFrameHeight !== this.height) {
      this._applyScaledLayout();
      return;
    }
    this._syncContentLayout();
  }

  _applyScaledLayout() {
    this._lastFrameWidth = this.width;
    this._lastFrameHeight = this.height;
    const panelDef = this._panelLayout;
    if (!panelDef) {
      this._contentScale = 1;
      this._contentOffsetX = 0;
      this._contentOffsetY = 0;
      this._contentWidth = this.width;
      this._contentHeight = this.height;
      this._syncContentLayout();
      return;
    }

    const designWidth = panelDef.width || this.width;
    const designHeight = panelDef.height || this.height;
    const scale = Math.min(this.width / designWidth, this.height / designHeight) || 1;
    const frameWidth = Math.round(designWidth * scale);
    const frameHeight = Math.round(designHeight * scale);
    this._contentScale = scale;
    this._contentWidth = frameWidth;
    this._contentHeight = frameHeight;
    this._contentOffsetX = Math.round((this.width - frameWidth) / 2);
    this._contentOffsetY = Math.round((this.height - frameHeight) / 2);

    const scaledParts = (panelDef.parts || []).map(part => this._scalePart(part, scale));
    const characterParts = scaledParts.filter(part => part.section === 'character');
    const inventoryParts = scaledParts.filter(part => part.section === 'inventory');
    this._characterBounds = this._getPartsBounds(characterParts, this._characterBounds);
    this._inventoryBounds = this._getPartsBounds(inventoryParts, this._inventoryBounds);
    this.playerInfoContent.applyPanelLayout(this._createContentLayout(characterParts));
    this.inventoryContent.applyPanelLayout(this._createContentLayout(inventoryParts));
    this._setContentFrameTransparent();
    this._syncContentLayout();
  }

  _scalePart(part, scale) {
    const scaled = { ...part };
    const scaleValue = value => (typeof value === 'number' ? value * scale : value);
    scaled.x = scaleValue(part.x ?? 0);
    scaled.y = scaleValue(part.y ?? 0);
    scaled.width = scaleValue(part.width ?? 0);
    scaled.height = scaleValue(part.height ?? 0);
    if (typeof part.slotSize === 'number') scaled.slotSize = part.slotSize * scale;
    if (typeof part.slotPadding === 'number') scaled.slotPadding = part.slotPadding * scale;
    if (typeof part.fontSize === 'number') scaled.fontSize = Math.max(8, Math.round(part.fontSize * scale));
    if (part.type === 'attr-row') scaled.valueOffsetX = (part.valueOffsetX ?? 60) * scale;
    return scaled;
  }

  _setContentFrameTransparent() {
    this.playerInfoContent.backgroundColor = 'rgba(0, 0, 0, 0)';
    this.playerInfoContent.borderColor = 'rgba(0, 0, 0, 0)';
    this.playerInfoContent.borderWidth = 0;
    this.inventoryContent.backgroundColor = 'rgba(0, 0, 0, 0)';
    this.inventoryContent.borderColor = 'rgba(0, 0, 0, 0)';
    this.inventoryContent.borderWidth = 0;
  }

  _syncContentLayout() {
    const frameX = this.x + this._contentOffsetX;
    const frameY = this.y + this._contentOffsetY;
    const hasSectionLayout = section => this._panelLayout?.parts?.some(part => part.section === section) === true;
    const sync = (panel, bounds, useSharedFrame) => {
      panel.x = frameX + (useSharedFrame ? 0 : bounds.x);
      panel.y = frameY + (useSharedFrame ? 0 : bounds.y);
      panel.width = useSharedFrame ? this._contentWidth : bounds.width;
      panel.height = useSharedFrame ? this._contentHeight : bounds.height;
      panel.visible = true;
    };

    // PanelLayout 部件使用组合面板设计坐标；回退布局则让子面板与外层命中分区共用同一坐标。
    sync(this.playerInfoContent, this._characterBounds, hasSectionLayout('character'));
    sync(this.inventoryContent, this._inventoryBounds, hasSectionLayout('inventory'));
  }

  _getPartsBounds(parts, fallback) {
    if (!parts || parts.length === 0) return { ...fallback };
    const left = Math.min(...parts.map(part => part.x || 0));
    const top = Math.min(...parts.map(part => part.y || 0));
    const right = Math.max(...parts.map(part => (part.x || 0) + (part.width || 0)));
    const bottom = Math.max(...parts.map(part => (part.y || 0) + (part.height || 0)));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  _isInBounds(x, y, bounds) {
    const left = this.x + this._contentOffsetX + bounds.x;
    const top = this.y + this._contentOffsetY + bounds.y;
    return x >= left && x <= left + bounds.width && y >= top && y <= top + bounds.height;
  }
}

export default BackpackPanel;

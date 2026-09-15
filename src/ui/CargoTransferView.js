/************************************************************

 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)

 *

 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎

 * @author    刘枭 (beiliwenxiao)

 * @email     beiliwenxiao@qq.com

 * @date      2026-01-14

 * @blog      https://blog.csdn.net/beiliwenxiao

 * @repo      https://github.com/beiliwenxiao/yijian18-engine

 *            https://gitee.com/coderaaa/yijian18-engine

 ************************************************************/

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

const GRID_COLUMNS = 6;
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const inside = (point, box) => point.x >= box.x && point.x <= box.x + box.width
  && point.y >= box.y && point.y <= box.y + box.height;

/** 只消费库存/容器快照并发出命令；领域事务由场景和注入的库存服务拥有。 */
export class CargoTransferView extends UIElement {
  constructor(options = {}) {
    super({
      x: 0, y: 0,
      width: options.width || 900,
      height: options.height || 560,
      visible: false,
      zIndex: options.zIndex || 132
    });
    this.onCommand = options.onCommand || (() => {});
    this.resolveItemImage = options.resolveItemImage || (() => null);
    this.snapshot = null;
    this.direction = 'toCargo';
    this.selectedItemId = null;
    this.quantity = 1;
    this.busy = false;
  }

  open(snapshot = {}) {
    this.direction = snapshot.direction === 'toInventory' ? 'toInventory' : 'toCargo';
    this.busy = false;
    this.visible = true;
    this.setSnapshot(snapshot, { preserveSelection: false });
  }

  setSnapshot(snapshot = {}, { preserveSelection = true } = {}) {
    const previousItemId = preserveSelection ? this.selectedItemId : null;
    this.snapshot = clone(snapshot);
    const items = this._sourceItems();
    this.selectedItemId = items.some(entry => entry.itemId === previousItemId)
      ? previousItemId
      : items[0]?.itemId || null;
    this._clampQuantity();
  }

  close() {
    this.visible = false;
    this.snapshot = null;
    this.selectedItemId = null;
    this.quantity = 1;
    this.busy = false;
  }

  setBusy(value) { this.busy = value === true; }

  _panelKeyForDirection(direction = this.direction) {
    return direction === 'toInventory' ? 'cargo' : 'inventory';
  }

  _itemsForDirection(direction = this.direction) {
    const panel = this.snapshot?.[this._panelKeyForDirection(direction)] || null;
    return Array.isArray(panel?.items) ? panel.items : [];
  }

  _sourceItems() {
    return this._itemsForDirection(this.direction);
  }

  _selectedItem() {
    return this._sourceItems().find(entry => entry.itemId === this.selectedItemId) || null;
  }

  _clampQuantity() {
    const available = Math.max(1, Number(this._selectedItem()?.quantity) || 1);
    this.quantity = Math.max(1, Math.min(available, Math.floor(Number(this.quantity) || 1)));
  }

  _setDirection(direction) {
    if (this.busy || direction === this.direction) return;
    this.direction = direction === 'toInventory' ? 'toInventory' : 'toCargo';
    this.selectedItemId = this._sourceItems()[0]?.itemId || null;
    this.quantity = 1;
  }

  _moveSelection(offset) {
    const items = this._sourceItems();
    if (!items.length) return;
    const current = Math.max(0, items.findIndex(entry => entry.itemId === this.selectedItemId));
    this.selectedItemId = items[(current + offset + items.length) % items.length].itemId;
    this.quantity = 1;
  }

  _adjustQuantity(offset) {
    this.quantity += offset;
    this._clampQuantity();
  }

  _createSlots(panel, direction, box) {
    const items = this._itemsForDirection(direction);
    const requestedCapacity = direction === 'toCargo'
      ? Number(panel?.maxSlots)
      : Number(panel?.capacity);
    const capacity = Math.max(items.length, Number.isFinite(requestedCapacity) ? requestedCapacity : 0, 1);
    const rows = Math.max(2, Math.ceil(capacity / GRID_COLUMNS));
    const gap = 5;
    const horizontalSpace = Math.max(1, box.width - 28 - gap * (GRID_COLUMNS - 1));
    const verticalSpace = Math.max(1, box.height - 70 - gap * (rows - 1));
    const size = Math.max(30, Math.floor(Math.min(horizontalSpace / GRID_COLUMNS, verticalSpace / rows, 58)));
    const gridWidth = size * GRID_COLUMNS + gap * (GRID_COLUMNS - 1);
    const gridHeight = size * rows + gap * (rows - 1);
    const gridX = box.x + (box.width - gridWidth) / 2;
    const gridY = box.y + 54 + Math.max(0, (box.height - 70 - gridHeight) / 2);
    return Array.from({ length: capacity }, (_value, index) => ({
      direction,
      index,
      entry: items[index] || null,
      x: gridX + (index % GRID_COLUMNS) * (size + gap),
      y: gridY + Math.floor(index / GRID_COLUMNS) * (size + gap),
      width: size,
      height: size
    }));
  }

  _layout(viewWidth, viewHeight) {
    const width = Math.max(520, Math.min(this.width, viewWidth - 24));
    const height = Math.max(390, Math.min(this.height, viewHeight - 24));
    const x = (viewWidth - width) / 2;
    const y = (viewHeight - height) / 2;
    const panelGap = 18;
    const panelWidth = (width - 48 - panelGap) / 2;
    const panelHeight = height - 188;
    const inventory = { x: x + 16, y: y + 58, width: panelWidth, height: panelHeight };
    const cargo = { x: inventory.x + panelWidth + panelGap, y: inventory.y, width: panelWidth, height: panelHeight };
    return {
      x, y, width, height,
      inventory,
      cargo,
      inventorySlots: this._createSlots(this.snapshot?.inventory, 'toCargo', inventory),
      cargoSlots: this._createSlots(this.snapshot?.cargo, 'toInventory', cargo),
      decrease: { x: x + width / 2 - 112, y: y + height - 104, width: 46, height: 34 },
      increase: { x: x + width / 2 + 66, y: y + height - 104, width: 46, height: 34 },
      transfer: { x: x + width / 2 - 112, y: y + height - 62, width: 224, height: 38 },
      close: { x: x + width - 48, y: y + 12, width: 32, height: 28 }
    };
  }

  handleInput({ inputManager, gamepad, viewWidth = 1280, viewHeight = 720 } = {}) {
    if (!this.visible) return false;
    if (this.busy || !inputManager) return true;

    const left = inputManager.isKeyPressed?.('arrowleft')
      || gamepad?.isButtonPressed?.(PadButton.DPAD_LEFT) === true;
    const right = inputManager.isKeyPressed?.('arrowright')
      || gamepad?.isButtonPressed?.(PadButton.DPAD_RIGHT) === true;
    if (left) this._setDirection('toCargo');
    if (right) this._setDirection('toInventory');
    if (inputManager.isKeyPressed?.('arrowup') || gamepad?.isButtonPressed?.(PadButton.DPAD_UP)) {
      this._moveSelection(-GRID_COLUMNS);
    }
    if (inputManager.isKeyPressed?.('arrowdown') || gamepad?.isButtonPressed?.(PadButton.DPAD_DOWN)) {
      this._moveSelection(GRID_COLUMNS);
    }
    if (inputManager.isKeyPressed?.('-') || gamepad?.isButtonPressed?.(PadButton.LB)) this._adjustQuantity(-1);
    if (inputManager.isKeyPressed?.('=') || inputManager.isKeyPressed?.('+')
      || gamepad?.isButtonPressed?.(PadButton.RB)) this._adjustQuantity(1);

    this._handlePointer(inputManager, this._layout(viewWidth, viewHeight));
    const confirmed = inputManager.isKeyPressed?.('e') || inputManager.isKeyPressed?.('enter')
      || gamepad?.isButtonPressed?.(PadButton.A) === true
      || gamepad?.isButtonPressed?.(PadButton.X) === true;
    if (confirmed) this._confirm();
    const cancelled = inputManager.isKeyPressed?.('escape')
      || gamepad?.isButtonPressed?.(PadButton.B) === true;
    if (cancelled) this.onCommand({ type: 'close' });
    return true;
  }

  _handlePointer(inputManager, layout) {
    if (!inputManager.isMouseClicked?.() || inputManager.isMouseClickHandled?.()) return;
    const point = inputManager.getMousePosition?.() || { x: -1, y: -1 };
    inputManager.markMouseClickHandled?.();
    if (inside(point, layout.close)) this.onCommand({ type: 'close' });
    else if (inside(point, layout.decrease)) this._adjustQuantity(-1);
    else if (inside(point, layout.increase)) this._adjustQuantity(1);
    else if (inside(point, layout.transfer)) this._confirm();
    else {
      const slot = [...layout.inventorySlots, ...layout.cargoSlots].find(box => inside(point, box));
      if (!slot) return;
      this._setDirection(slot.direction);
      if (slot.entry?.itemId) {
        this.selectedItemId = slot.entry.itemId;
        this.quantity = 1;
      }
    }
  }

  _confirm() {
    if (this.busy || !this.selectedItemId) return;
    this.onCommand({
      type: 'transfer',
      direction: this.direction,
      itemId: this.selectedItemId,
      quantity: this.quantity
    });
  }

  render(ctx, viewWidth = ctx?.canvas?.width || 1280, viewHeight = ctx?.canvas?.height || 720) {
    if (!this.visible || !ctx || !this.snapshot) return;
    const layout = this._layout(viewWidth, viewHeight);
    const storageLabel = this.snapshot.storageLabel || '货舱';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = 'rgba(25,27,29,0.98)';
    ctx.strokeStyle = '#c49a52';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(layout.x, layout.y, layout.width, layout.height, 10);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0d080';
    ctx.font = 'bold 22px Arial';
    ctx.fillText(this.snapshot.title || storageLabel, layout.x + layout.width / 2, layout.y + 30);
    this._renderStoragePanel(ctx, layout.inventory, layout.inventorySlots, {
      title: '背包',
      used: this.snapshot.inventory?.usedSlots || 0,
      capacity: this.snapshot.inventory?.maxSlots || 0,
      active: this.direction === 'toCargo'
    });
    this._renderStoragePanel(ctx, layout.cargo, layout.cargoSlots, {
      title: storageLabel,
      used: this.snapshot.cargo?.total || 0,
      capacity: this.snapshot.cargo?.capacity || 0,
      active: this.direction === 'toInventory'
    });

    ctx.textAlign = 'center';
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`数量 ${this.quantity}`, layout.x + layout.width / 2, layout.decrease.y + 17);
    this._renderButton(ctx, layout.decrease, '−', false);
    this._renderButton(ctx, layout.increase, '+', false);
    this._renderButton(ctx, layout.transfer, this.busy
      ? '正在转移……'
      : (this.direction === 'toCargo' ? `存入${storageLabel}` : '取回背包'), this.busy);
    this._renderButton(ctx, layout.close, '×', false);
    ctx.fillStyle = this.snapshot.statusType === 'error' ? '#ef766d' : '#8fd18f';
    ctx.font = '12px Arial';
    ctx.fillText(this.snapshot.statusMessage || `${InputHints.phrase('modalNavigate')}切换栏位，` +
      `${InputHints.phrase('modalDecrease')}/${InputHints.phrase('modalIncrease')}调整数量，` +
      `${InputHints.phrase('confirm')}转移，${InputHints.phrase('modalCancel')}关闭`,
    layout.x + layout.width / 2, layout.y + layout.height - 10);
    ctx.restore();
  }

  _renderStoragePanel(ctx, box, slots, { title, used, capacity, active }) {
    ctx.fillStyle = active ? 'rgba(196,154,82,0.13)' : 'rgba(255,255,255,0.035)';
    ctx.strokeStyle = active ? '#e7c06e' : '#6b6b6b';
    ctx.lineWidth = active ? 2 : 1;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = active ? '#f0d080' : '#d0d0d0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(title, box.x + 14, box.y + 24);
    ctx.textAlign = 'right';
    ctx.font = '12px Arial';
    ctx.fillStyle = '#b9b9b9';
    ctx.fillText(`${used}/${capacity}`, box.x + box.width - 14, box.y + 24);
    for (const slot of slots) this._renderSlot(ctx, slot);
  }

  _renderSlot(ctx, slot) {
    const entry = slot.entry;
    const selected = entry?.itemId === this.selectedItemId && slot.direction === this.direction;
    ctx.fillStyle = selected ? 'rgba(207,165,77,0.32)' : 'rgba(0,0,0,0.3)';
    ctx.strokeStyle = selected ? '#f2cf70' : '#505050';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
    ctx.strokeRect(slot.x, slot.y, slot.width, slot.height);
    if (!entry) return;

    const image = entry.imageId ? this.resolveItemImage(entry.imageId) : null;
    if (image) {
      const padding = Math.max(5, Math.floor(slot.width * 0.12));
      const drawableWidth = Math.max(1, Number(image.naturalWidth || image.width) || 1);
      const drawableHeight = Math.max(1, Number(image.naturalHeight || image.height) || 1);
      const scale = Math.min((slot.width - padding * 2) / drawableWidth, (slot.height - padding * 2) / drawableHeight);
      const width = drawableWidth * scale;
      const height = drawableHeight * scale;
      ctx.drawImage(image, slot.x + (slot.width - width) / 2, slot.y + (slot.height - height) / 2, width, height);
    } else {
      ctx.fillStyle = '#d6d0c5';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(entry.name || entry.itemId, slot.x + slot.width / 2, slot.y + slot.height / 2, slot.width - 8);
    }
    ctx.fillStyle = '#f5ead4';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`×${entry.quantity || 0}`, slot.x + slot.width - 4, slot.y + slot.height - 3);
  }

  _renderButton(ctx, box, text, disabled) {
    ctx.fillStyle = disabled ? '#4b4b4b' : '#72572f';
    ctx.strokeStyle = disabled ? '#686868' : '#d3a85b';
    ctx.lineWidth = 1;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = disabled ? '#a0a0a0' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2);
  }
}

export default CargoTransferView;

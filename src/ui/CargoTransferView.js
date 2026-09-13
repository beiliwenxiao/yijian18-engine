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

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const inside = (point, box) => point.x >= box.x && point.x <= box.x + box.width
  && point.y >= box.y && point.y <= box.y + box.height;

/** 只消费库存/容器快照并发出命令；领域事务由场景和注入的库存服务拥有。 */
export class CargoTransferView extends UIElement {
  constructor(options = {}) {
    super({
      x: 0, y: 0,
      width: options.width || 680,
      height: options.height || 470,
      visible: false,
      zIndex: options.zIndex || 132
    });
    this.onCommand = options.onCommand || (() => {});
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

  _sourceItems() {
    const key = this.direction === 'toCargo' ? 'inventory' : 'cargo';
    return Array.isArray(this.snapshot?.[key]?.items) ? this.snapshot[key].items : [];
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
    this.direction = direction;
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

  _layout(viewWidth, viewHeight) {
    const width = Math.min(this.width, viewWidth - 24);
    const height = Math.min(this.height, viewHeight - 24);
    const x = (viewWidth - width) / 2;
    const y = (viewHeight - height) / 2;
    const tabWidth = (width - 48) / 2;
    const sourceItems = this._sourceItems().slice(0, 8);
    return {
      x, y, width, height,
      toCargo: { x: x + 16, y: y + 58, width: tabWidth, height: 36 },
      toInventory: { x: x + 32 + tabWidth, y: y + 58, width: tabWidth, height: 36 },
      rows: sourceItems.map((entry, index) => ({
        itemId: entry.itemId, x: x + 24, y: y + 116 + index * 32, width: width - 48, height: 28
      })),
      decrease: { x: x + width / 2 - 112, y: y + height - 102, width: 46, height: 34 },
      increase: { x: x + width / 2 + 66, y: y + height - 102, width: 46, height: 34 },
      transfer: { x: x + width / 2 - 92, y: y + height - 58, width: 184, height: 38 },
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
      this._moveSelection(-1);
    }
    if (inputManager.isKeyPressed?.('arrowdown') || gamepad?.isButtonPressed?.(PadButton.DPAD_DOWN)) {
      this._moveSelection(1);
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
    else if (inside(point, layout.toCargo)) this._setDirection('toCargo');
    else if (inside(point, layout.toInventory)) this._setDirection('toInventory');
    else if (inside(point, layout.decrease)) this._adjustQuantity(-1);
    else if (inside(point, layout.increase)) this._adjustQuantity(1);
    else if (inside(point, layout.transfer)) this._confirm();
    else {
      const row = layout.rows.find(box => inside(point, box));
      if (row) {
        this.selectedItemId = row.itemId;
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
    const storageLabel = this.snapshot.storageLabel || '货舱';
    ctx.fillText(this.snapshot.title || storageLabel, layout.x + layout.width / 2, layout.y + 30);
    this._renderTab(ctx, layout.toCargo, `背包 → ${storageLabel}`, this.direction === 'toCargo');
    this._renderTab(ctx, layout.toInventory, `${storageLabel} → 背包`, this.direction === 'toInventory');

    const source = this.direction === 'toCargo' ? this.snapshot.inventory : this.snapshot.cargo;
    ctx.textAlign = 'left';
    ctx.font = '13px Arial';
    ctx.fillStyle = '#c9c9c9';
    ctx.fillText(this.direction === 'toCargo' ? '背包物品' : `${storageLabel}物品`, layout.x + 24, layout.y + 106);
    layout.rows.forEach((box, index) => this._renderRow(ctx, box, this._sourceItems()[index]));
    if (!layout.rows.length) {
      ctx.fillStyle = '#969696';
      ctx.fillText('当前来源没有可转移物品', layout.x + 24, layout.y + 142);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e0cf';
    ctx.font = '13px Arial';
    ctx.fillText(`背包槽位 ${this.snapshot.inventory.usedSlots}/${this.snapshot.inventory.maxSlots}　` +
      `${storageLabel}容量 ${this.snapshot.cargo.total}/${this.snapshot.cargo.capacity}`,
    layout.x + layout.width / 2, layout.y + layout.height - 126);
    this._renderButton(ctx, layout.decrease, '−', false);
    this._renderButton(ctx, layout.increase, '+', false);
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`数量 ${this.quantity}`, layout.x + layout.width / 2, layout.decrease.y + 17);
    this._renderButton(ctx, layout.transfer, this.busy ? '正在转移……' : '确认转移', this.busy);
    this._renderButton(ctx, layout.close, '×', false);
    ctx.fillStyle = this.snapshot.statusType === 'error' ? '#ef766d' : '#8fd18f';
    ctx.font = '12px Arial';
    ctx.fillText(this.snapshot.statusMessage || `${InputHints.phrase('modalNavigate')}选择，` +
      `${InputHints.phrase('modalDecrease')}/${InputHints.phrase('modalIncrease')}调整数量，` +
      `${InputHints.phrase('confirm')}转移，${InputHints.phrase('modalCancel')}关闭`,
    layout.x + layout.width / 2, layout.y + layout.height - 8);
    ctx.restore();
  }

  _renderTab(ctx, box, text, selected) {
    ctx.fillStyle = selected ? 'rgba(196,154,82,0.28)' : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = selected ? '#e7c06e' : '#666666';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = selected ? '#f0d080' : '#c8c8c8';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2);
  }

  _renderRow(ctx, box, entry = {}) {
    const selected = entry.itemId === this.selectedItemId;
    ctx.fillStyle = selected ? 'rgba(196,154,82,0.24)' : 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = selected ? '#dcb565' : '#555555';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = selected ? '#f1d48c' : '#dedede';
    ctx.font = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(entry.name || entry.itemId || '未知物品', box.x + 10, box.y + box.height / 2);
    ctx.textAlign = 'right';
    ctx.fillText(`×${entry.quantity || 0}`, box.x + box.width - 10, box.y + box.height / 2);
  }

  _renderButton(ctx, box, text, disabled) {
    ctx.fillStyle = disabled ? '#4b4b4b' : '#72572f';
    ctx.strokeStyle = disabled ? '#686868' : '#d3a85b';
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = disabled ? '#a0a0a0' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2);
  }
}

export default CargoTransferView;
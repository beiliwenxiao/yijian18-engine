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

import { InventoryComponent } from './InventoryComponent.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/**
 * 载具独立货舱。复用 InventoryComponent 的槽位契约，同时额外限制总件数容量。
 */
export class CargoComponent extends InventoryComponent {
  constructor(options = {}) {
    const capacity = Math.max(1, Math.floor(Number(options.capacity) || 40));
    super({
      maxSlots: Math.max(1, Math.floor(Number(options.maxSlots) || capacity)),
      items: [],
      definitionResolver: options.definitionResolver
    });
    this.type = 'cargo';
    this.capacity = capacity;
    this.dropGenerated = options.dropGenerated === true;
    this.dropOperationId = typeof options.dropOperationId === 'string' ? options.dropOperationId : null;
    this.dropManifest = Array.isArray(options.dropManifest) ? clone(options.dropManifest) : [];
    if (Array.isArray(options.items)) this.loadItems(options.items);
  }

  getItemCountTotal() {
    return this.slots.reduce((sum, stack) => sum + (stack ? Math.max(0, Number(stack.quantity) || 0) : 0), 0);
  }

  getAvailableCapacity() {
    return Math.max(0, this.capacity - this.getItemCountTotal());
  }

  addItem(item, quantity = 1) {
    const accepted = Math.min(Math.max(0, Math.floor(Number(quantity) || 0)), this.getAvailableCapacity());
    return accepted > 0 ? super.addItem(item, accepted) : 0;
  }

  serialize() {
    return {
      schemaVersion: 2,
      capacity: this.capacity,
      maxSlots: this.maxSlots,
      dropGenerated: this.dropGenerated,
      dropOperationId: this.dropOperationId,
      dropManifest: clone(this.dropManifest.map(entry => entry.definitionId ? entry : ({
        definitionId: entry.item?.definitionId || entry.item?.id,
        ...(entry.item?.instanceId ? { instanceId: entry.item.instanceId, mutable: {} } : { quantity: entry.quantity })
      }))),
      items: clone(this.exportRuntimeStates())
    };
  }
  validateSerialized(data) {
    if (!data || data.schemaVersion !== 2 || !Array.isArray(data.items)
      || !Array.isArray(data.dropManifest)) {
      return { ok: false, code: 'invalidCargoSnapshot' };
    }
    const capacity = Math.floor(Number(data.capacity));
    const maxSlots = Math.floor(Number(data.maxSlots));
    const total = data.items.reduce((sum, entry) => sum
      + (entry?.instanceId ? 1 : Math.max(0, Math.floor(Number(entry?.quantity) || 0))), 0);
    const validDrop = data.dropGenerated === false
      ? data.dropOperationId == null && data.dropManifest.length === 0
      : typeof data.dropOperationId === 'string' && data.dropOperationId.length > 0;
    if (capacity <= 0 || maxSlots <= 0 || total > capacity || !validDrop
      || [...data.items, ...data.dropManifest].some(entry => !(entry?.definitionId || entry?.item?.id)
        || !(entry?.instanceId || Number(entry.quantity) > 0))) {
      return { ok: false, code: 'invalidCargoState' };
    }
    return { ok: true };
  }

  deserialize(data) {
    const check = this.validateSerialized(data);
    if (!check.ok) return check;
    const before = this.serialize();
    this.capacity = Math.floor(Number(data.capacity));
    this.maxSlots = Math.floor(Number(data.maxSlots));
    this.slots = new Array(this.maxSlots).fill(null);
    this.dropGenerated = data.dropGenerated === true;
    this.dropOperationId = data.dropOperationId || null;
    this.dropManifest = clone(data.dropManifest);
    this.loadItems(clone(data.items));
    if (this.getItemCountTotal() > this.capacity) {
      this.capacity = before.capacity;
      this.maxSlots = before.maxSlots;
      this.slots = new Array(this.maxSlots).fill(null);
      this.dropGenerated = before.dropGenerated;
      this.dropOperationId = before.dropOperationId;
      this.dropManifest = clone(before.dropManifest);
      this.loadItems(before.items);
      return { ok: false, code: 'cargoRestoreOverflow' };
    }
    return { ok: true };
  }
}

export default CargoComponent;
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

let nextInventoryId = 1;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function itemKey(item) {
  return `${item?.id || ''}:${item?.instanceId || ''}`;
}

function isCompatible(stack, item) {
  if (!stack?.item || stack.item.id !== item?.id) return false;
  const left = stack.item.instanceId || '';
  const right = item.instanceId || '';
  return left === right && !left;
}

function cloneItem(item) {
  if (!item || typeof item !== 'object') return item;
  if (typeof structuredClone === 'function') return structuredClone(item);
  return JSON.parse(JSON.stringify(item));
}

function snapshotInventory(inventory) {
  return inventory.slots
    .filter(Boolean)
    .map(stack => ({ item: cloneItem(stack.item), quantity: stack.quantity }));
}

function restoreInventory(inventory, snapshot) {
  inventory.loadItems(snapshot);
}

function isResourceItem(item) {
  return item?.type === 'material' || item?.type === 'resource';
}

/**
 * 对 InventoryComponent 提供预检、原子提交与 operationId 幂等。
 * 事务使用组件公开 API，并在任一步数量不符时恢复提交前快照。
 */
export class InventoryTransactionService {
  constructor({ effectResolver = null, getEntityId = null, baseResourceCapacity = 120 } = {}) {
    this.results = new Map();
    this.inventoryIds = new WeakMap();
    this.configureEffects({ effectResolver, getEntityId, baseResourceCapacity });
  }

  /** 运行时可在 GameLoader 完成后注入共享 EffectResolver。 */
  configureEffects({ effectResolver = null, getEntityId = null, baseResourceCapacity = this.baseResourceCapacity } = {}) {
    this.effectResolver = effectResolver || null;
    this.getEntityId = typeof getEntityId === 'function' ? getEntityId : () => null;
    const capacity = Math.floor(Number(baseResourceCapacity));
    this.baseResourceCapacity = Number.isFinite(capacity) && capacity >= 0 ? capacity : 120;
    return this;
  }

  _resourceCapacity(inventory) {
    if (!this.effectResolver) return Infinity;
    const entityId = this.getEntityId(inventory);
    if (!entityId) return Infinity;
    const resolved = this.effectResolver.getValue(entityId, 'resourceCapacity', this.baseResourceCapacity, { inventory });
    return Math.max(0, Math.floor(Number(resolved) || 0));
  }

  _resourceCount(inventory) {
    return (inventory?.slots || []).reduce((sum, stack) => (
      stack && isResourceItem(stack.item) ? sum + Math.max(0, Math.floor(Number(stack.quantity) || 0)) : sum
    ), 0);
  }

  _resourceAvailable(inventory, item) {
    if (!isResourceItem(item)) return Infinity;
    return Math.max(0, this._resourceCapacity(inventory) - this._resourceCount(inventory));
  }

  previewAdd(inventory, item, quantity = 1) {
    const requested = positiveInteger(quantity);
    if (!inventory || !item?.id || requested === 0) {
      return { requested, accepted: 0, remainder: requested, reason: 'invalidInput' };
    }
    const maxStack = item.instanceId ? 1 : Math.max(1, positiveInteger(item.maxStack) || 1);
    let capacity = 0;
    for (const stack of inventory.slots || []) {
      if (!stack) capacity += maxStack;
      else if (isCompatible(stack, item)) capacity += Math.max(0, maxStack - stack.quantity);
    }
    const slotAccepted = Math.min(requested, capacity);
    const accepted = Math.min(slotAccepted, this._resourceAvailable(inventory, item));
    const reason = accepted
      ? null
      : (slotAccepted > 0 && isResourceItem(item) ? 'resourceCapacityFull' : 'inventoryFull');
    return { requested, accepted, remainder: requested - accepted, reason };
  }

  previewRemove(inventory, itemId, quantity = 1) {
    const requested = positiveInteger(quantity);
    const available = inventory?.getItemCount?.(itemId) || 0;
    const accepted = Math.min(requested, available);
    return { requested, accepted, remainder: requested - accepted, reason: accepted ? null : 'itemMissing' };
  }

  previewTransfer(source, target, item, quantity = 1) {
    const remove = this.previewRemove(source, item?.id, quantity);
    const add = this.previewAdd(target, item, remove.accepted);
    const accepted = Math.min(remove.accepted, add.accepted);
    return { requested: remove.requested, accepted, remainder: remove.requested - accepted, reason: accepted ? null : (remove.reason || add.reason) };
  }

  /** 在不修改库存的影子槽位上预演一组入库，避免多个条目争用同一空槽。 */
  previewBatchAdd(inventory, entries = []) {
    if (!inventory || !Array.isArray(entries) || entries.length === 0) {
      return { valid: false, requested: 0, accepted: 0, remainder: 0, reason: 'invalidInput', entries: [] };
    }

    const occupiedInstanceIds = new Set((inventory.slots || [])
      .map(stack => typeof stack?.item?.instanceId === 'string' ? stack.item.instanceId.trim() : '')
      .filter(Boolean));
    const normalized = entries.map(entry => {
      const item = entry?.item;
      const requested = positiveInteger(entry?.quantity);
      const declaresInstanceId = item?.instanceId !== undefined
        && item?.instanceId !== null && item?.instanceId !== '';
      const instanceId = typeof item?.instanceId === 'string' ? item.instanceId.trim() : '';
      let reason = null;
      if (!item?.id || requested === 0 || (declaresInstanceId && !instanceId)) reason = 'invalidInput';
      else if (instanceId && requested !== 1) reason = 'invalidInstanceQuantity';
      else if (instanceId && occupiedInstanceIds.has(instanceId)) reason = 'duplicateInstanceId';
      if (!reason && instanceId) occupiedInstanceIds.add(instanceId);
      return { item, requested, instanceId, reason };
    });
    const requested = normalized.reduce((sum, entry) => sum + entry.requested, 0);
    const invalid = normalized.find(entry => entry.reason);
    if (invalid) {
      return {
        valid: false,
        requested,
        accepted: 0,
        remainder: requested,
        reason: invalid.reason,
        entries: normalized.map(entry => ({
          item: entry.item,
          requested: entry.requested,
          accepted: 0,
          remainder: entry.requested,
          reason: entry.reason || invalid.reason
        }))
      };
    }

    const shadow = (inventory.slots || []).map(stack => stack
      ? { item: cloneItem(stack.item), quantity: stack.quantity }
      : null);
    let resourceRemaining = Math.max(0, this._resourceCapacity(inventory) - this._resourceCount(inventory));
    const results = [];
    for (const entry of normalized) {
      const { item } = entry;
      const maxStack = entry.instanceId ? 1 : Math.max(1, positiveInteger(item.maxStack) || 1);
      const capacityRequest = isResourceItem(item)
        ? Math.min(entry.requested, resourceRemaining)
        : entry.requested;
      let remaining = capacityRequest;
      for (const stack of shadow) {
        if (remaining <= 0) break;
        if (!isCompatible(stack, item)) continue;
        const added = Math.min(remaining, Math.max(0, maxStack - stack.quantity));
        stack.quantity += added;
        remaining -= added;
      }
      for (let index = 0; index < shadow.length && remaining > 0; index++) {
        if (shadow[index]) continue;
        const added = Math.min(remaining, maxStack);
        shadow[index] = { item: cloneItem(item), quantity: added };
        remaining -= added;
      }
      const accepted = capacityRequest - remaining;
      if (isResourceItem(item)) resourceRemaining = Math.max(0, resourceRemaining - accepted);
      const blockedByResourceCapacity = isResourceItem(item) && capacityRequest === 0;
      results.push({ item, requested: entry.requested, accepted, remainder: entry.requested - accepted,
        reason: accepted === 0 ? (blockedByResourceCapacity ? 'resourceCapacityFull' : 'inventoryFull') : null });
    }
    const accepted = results.reduce((sum, result) => sum + result.accepted, 0);
    return { valid: true, requested, accepted, remainder: requested - accepted,
      reason: accepted ? null : (results.find(result => result.reason)?.reason || 'inventoryFull'), entries: results };
  }

  /** 外层复合事务回滚后释放 operationId，允许完整事务安全重试。 */
  forgetOperation(operationId) {
    return typeof operationId === 'string' && operationId ? this.results.delete(operationId) : false;
  }

  commit(operation = {}) {
    const fingerprint = this._fingerprint(operation);
    if (operation.operationId && this.results.has(operation.operationId)) {
      const previous = this.results.get(operation.operationId);
      return previous.fingerprint === fingerprint
        ? { ...previous.result, idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: operation.operationId };
    }

    let result;
    if (operation.type === 'add') result = this._commitAdd(operation);
    else if (operation.type === 'remove') result = this._commitRemove(operation);
    else if (operation.type === 'transfer') result = this._commitTransfer(operation);
    else if (operation.type === 'batchAdd') result = this._commitBatchAdd(operation);
    else if (operation.type === 'batchRemove') result = this._commitBatchRemove(operation);
    else if (operation.type === 'batchExchange') result = this._commitBatchExchange(operation);
    else result = { ok: false, code: 'unsupportedOperation', accepted: 0 };

    if (operation.operationId) this.results.set(operation.operationId, { fingerprint, result: { ...result } });
    return result;
  }

  _commitAdd({ inventory, item, quantity = 1, allowPartial = true } = {}) {
    const preview = this.previewAdd(inventory, item, quantity);
    if (preview.accepted === 0 || (!allowPartial && preview.remainder > 0)) {
      return { ok: false, code: preview.reason || 'insufficientCapacity', ...preview };
    }
    const before = snapshotInventory(inventory);
    const accepted = inventory.addItem(item, preview.accepted);
    if (accepted !== preview.accepted) {
      restoreInventory(inventory, before);
      return { ok: false, code: 'commitMismatch', requested: preview.requested, accepted: 0, remainder: preview.requested };
    }
    return { ok: true, code: null, requested: preview.requested, accepted, remainder: preview.requested - accepted };
  }

  _commitRemove({ inventory, itemId, quantity = 1, allowPartial = false } = {}) {
    const preview = this.previewRemove(inventory, itemId, quantity);
    if (preview.accepted === 0 || (!allowPartial && preview.remainder > 0)) {
      return { ok: false, code: preview.reason || 'insufficientItems', ...preview };
    }
    const before = snapshotInventory(inventory);
    const accepted = inventory.removeItem(itemId, preview.accepted);
    if (accepted !== preview.accepted) {
      restoreInventory(inventory, before);
      return { ok: false, code: 'commitMismatch', requested: preview.requested, accepted: 0, remainder: preview.requested };
    }
    return { ok: true, code: null, requested: preview.requested, accepted, remainder: preview.requested - accepted };
  }

  _commitTransfer({ source, target, item, quantity = 1, allowPartial = true } = {}) {
    const preview = this.previewTransfer(source, target, item, quantity);
    if (preview.accepted === 0 || (!allowPartial && preview.remainder > 0)) {
      return { ok: false, code: preview.reason || 'transferRejected', ...preview };
    }
    const sourceBefore = snapshotInventory(source);
    const targetBefore = snapshotInventory(target);
    const removed = source.removeItem(item.id, preview.accepted);
    const added = removed === preview.accepted ? target.addItem(item, removed) : 0;
    if (removed !== preview.accepted || added !== preview.accepted) {
      restoreInventory(source, sourceBefore);
      restoreInventory(target, targetBefore);
      return { ok: false, code: 'commitMismatch', requested: preview.requested, accepted: 0, remainder: preview.requested };
    }
    return { ok: true, code: null, requested: preview.requested, accepted: added, remainder: preview.requested - added };
  }

  _commitBatchAdd({ inventory, entries = [], allowPartial = false } = {}) {
    const preview = this.previewBatchAdd(inventory, entries);
    if (preview.accepted === 0 || (!allowPartial && preview.remainder > 0)) {
      return { ok: false, code: preview.reason || 'insufficientCapacity', ...preview };
    }
    const before = snapshotInventory(inventory);
    const committed = [];
    for (const entry of preview.entries) {
      const quantity = allowPartial ? entry.accepted : entry.requested;
      if (quantity <= 0) continue;
      const accepted = inventory.addItem(entry.item, quantity);
      if (accepted !== quantity) {
        restoreInventory(inventory, before);
        return { ok: false, code: 'commitMismatch', requested: preview.requested,
          accepted: 0, remainder: preview.requested, entries: [] };
      }
      committed.push({ item: entry.item, requested: entry.requested, accepted, remainder: entry.requested - accepted });
    }
    const accepted = committed.reduce((sum, entry) => sum + entry.accepted, 0);
    return { ok: true, code: null, requested: preview.requested, accepted,
      remainder: preview.requested - accepted, entries: committed };
  }

  _commitBatchRemove({ inventory, entries = [] } = {}) {
    if (!inventory || !Array.isArray(entries) || entries.length === 0) {
      return { ok: false, code: 'invalidInput', accepted: 0, entries: [] };
    }
    const totals = new Map();
    for (const entry of entries) {
      const quantity = positiveInteger(entry?.quantity);
      if (!entry?.itemId || quantity === 0) continue;
      totals.set(entry.itemId, (totals.get(entry.itemId) || 0) + quantity);
    }
    const normalized = [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
    if (normalized.length === 0) return { ok: false, code: 'invalidInput', accepted: 0, entries: [] };
    for (const entry of normalized) {
      if (this.previewRemove(inventory, entry.itemId, entry.quantity).remainder > 0) {
        return { ok: false, code: 'insufficientItems', accepted: 0, entries: normalized };
      }
    }
    const before = snapshotInventory(inventory);
    const removed = [];
    for (const entry of normalized) {
      const accepted = inventory.removeItem(entry.itemId, entry.quantity);
      if (accepted !== entry.quantity) {
        restoreInventory(inventory, before);
        return { ok: false, code: 'commitMismatch', accepted: 0, entries: [] };
      }
      removed.push({ ...entry, accepted });
    }
    return {
      ok: true, code: null,
      accepted: removed.reduce((sum, entry) => sum + entry.accepted, 0),
      entries: removed
    };
  }

  _commitBatchExchange({ inventory, removeEntries = [], addEntries = [] } = {}) {
    if (!inventory || !Array.isArray(removeEntries) || !Array.isArray(addEntries)
      || removeEntries.length === 0 || addEntries.length === 0) {
      return { ok: false, code: 'invalidInput', accepted: 0 };
    }
    const removals = removeEntries
      .map(entry => ({ itemId: entry?.itemId, quantity: positiveInteger(entry?.quantity) }))
      .filter(entry => entry.itemId && entry.quantity > 0);
    const additions = addEntries
      .map(entry => ({ item: entry?.item, quantity: positiveInteger(entry?.quantity) }))
      .filter(entry => entry.item?.id && entry.quantity > 0);
    if (removals.length === 0 || additions.length === 0) {
      return { ok: false, code: 'invalidInput', accepted: 0 };
    }
    for (const entry of removals) {
      if (this.previewRemove(inventory, entry.itemId, entry.quantity).remainder > 0) {
        return { ok: false, code: 'insufficientItems', accepted: 0, removeEntries: removals };
      }
    }

    const before = snapshotInventory(inventory);
    try {
      for (const entry of removals) {
        if (inventory.removeItem(entry.itemId, entry.quantity) !== entry.quantity) {
          throw Object.assign(new Error('removeCommitMismatch'), { code: 'commitMismatch' });
        }
      }
      const preview = this.previewBatchAdd(inventory, additions);
      if (preview.remainder > 0) {
        throw Object.assign(new Error('insufficientCapacity'), { code: preview.reason || 'insufficientCapacity' });
      }
      for (const entry of additions) {
        if (inventory.addItem(entry.item, entry.quantity) !== entry.quantity) {
          throw Object.assign(new Error('addCommitMismatch'), { code: 'commitMismatch' });
        }
      }
      return {
        ok: true,
        code: null,
        accepted: additions.reduce((sum, entry) => sum + entry.quantity, 0),
        removed: removals,
        added: additions.map(entry => ({ itemId: entry.item.id, quantity: entry.quantity }))
      };
    } catch (error) {
      restoreInventory(inventory, before);
      return { ok: false, code: error.code || 'commitMismatch', accepted: 0 };
    }
  }

  _inventoryId(inventory) {
    if (!inventory || typeof inventory !== 'object') return 'none';
    if (!this.inventoryIds.has(inventory)) this.inventoryIds.set(inventory, `inventory-${nextInventoryId++}`);
    return this.inventoryIds.get(inventory);
  }

  _fingerprint(operation) {
    return JSON.stringify({
      type: operation.type || '', source: this._inventoryId(operation.source),
      target: this._inventoryId(operation.target), inventory: this._inventoryId(operation.inventory),
      item: itemKey(operation.item || { id: operation.itemId }), quantity: positiveInteger(operation.quantity),
      entries: Array.isArray(operation.entries)
        ? operation.entries.map(entry => ({
          item: itemKey(entry?.item || { id: entry?.itemId }),
          quantity: positiveInteger(entry?.quantity)
        }))
        : [],
      removeEntries: Array.isArray(operation.removeEntries)
        ? operation.removeEntries.map(entry => ({ itemId: entry?.itemId, quantity: positiveInteger(entry?.quantity) }))
        : [],
      addEntries: Array.isArray(operation.addEntries)
        ? operation.addEntries.map(entry => ({ item: itemKey(entry?.item), quantity: positiveInteger(entry?.quantity) }))
        : [],
      allowPartial: operation.allowPartial !== false
    });
  }
}

export default InventoryTransactionService;
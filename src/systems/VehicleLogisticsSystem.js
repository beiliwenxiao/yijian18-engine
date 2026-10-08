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

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const snapshotInventory = inventory => clone(inventory?.exportItems?.() || []);
const restoreInventory = (inventory, snapshot) => inventory?.loadItems?.(clone(snapshot || []));

/** 载具运输、耗粮、摧毁与攻城资源的原子领域服务。 */
export class VehicleLogisticsSystem {
  constructor({
    inventoryTransactions, createCheckpoint = null, onEvent = null, maxOperations = 256,
    getInventoryOwnerId = null
  } = {}) {
    if (!inventoryTransactions) throw new TypeError('VehicleLogisticsSystem requires inventoryTransactions');
    this.inventoryTransactions = inventoryTransactions;
    this.createCheckpoint = typeof createCheckpoint === 'function' ? createCheckpoint : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.getInventoryOwnerId = typeof getInventoryOwnerId === 'function' ? getInventoryOwnerId : null;
    this.maxOperations = Math.max(16, Math.floor(Number(maxOperations) || 256));
    this.operations = new Map();
    this.inFlight = new Map();
    this.inventoryIds = new WeakMap();
    this.nextInventoryId = 1;
  }

  async transfer({
    source, target, itemId, quantity, operationId, checkpointId = null, context = null,
    sourceOwnerId = null, targetOwnerId = null
  } = {}) {
    const requested = Math.max(0, Math.floor(Number(quantity) || 0));
    const item = (source?.slots || []).find(stack => stack?.item?.id === itemId)?.item;
    if (!source || !target || !item || requested <= 0 || !operationId) return { ok: false, code: 'invalidTransfer' };
    const fingerprint = JSON.stringify([
      'transfer', sourceOwnerId || this._inventoryId(source), targetOwnerId || this._inventoryId(target), itemId, requested
    ]);
    return this._executeOperation(operationId, fingerprint, async () => {
      const cargoAvailable = typeof target.getAvailableCapacity === 'function' ? target.getAvailableCapacity() : Infinity;
      const preview = this.inventoryTransactions.previewTransfer(source, target, item, Math.min(requested, cargoAvailable));
      if (preview.accepted <= 0) return { ok: false, code: preview.reason || 'transferRejected', ...preview };
      const sourceBefore = snapshotInventory(source);
      const targetBefore = snapshotInventory(target);
      const transactionId = `${operationId}:inventory`;
      const committed = this.inventoryTransactions.commit({
        type: 'transfer', source, target, item: clone(item), quantity: preview.accepted,
        allowPartial: false, operationId: transactionId
      });
      if (!committed.ok) return committed;
      const result = { ok: true, operationId, itemId, requested, accepted: committed.accepted, remainder: requested - committed.accepted };
      const saved = await this._saveOperation(operationId, fingerprint, result, {
        checkpointId, operationId, context, kind: 'cargoTransfer'
      });
      if (!saved.ok) {
        restoreInventory(source, sourceBefore);
        restoreInventory(target, targetBefore);
        this.inventoryTransactions.forgetOperation(transactionId);
        return saved;
      }
      this._emit('cargoTransferred', result);
      return clone(result);
    });
  }

  async transferBatch({
    source, target, entries = [], operationId, checkpointId = null, context = null,
    sourceOwnerId = null, targetOwnerId = null, deferCheckpoint = false
  } = {}) {
    const normalized = this._resourceEntries(entries);
    if (!source || !target || !operationId || normalized.length === 0) {
      return { ok: false, code: 'invalidBatchTransfer' };
    }
    const fingerprint = JSON.stringify([
      'transferBatch', sourceOwnerId || this._inventoryId(source), targetOwnerId || this._inventoryId(target), normalized
    ]);
    return this._executeOperation(operationId, fingerprint, async () => {
      const prepared = [];
      for (const entry of normalized) {
        const stack = (source.slots || []).find(value => value?.item?.id === entry.itemId);
        const preview = this.inventoryTransactions.previewRemove(source, entry.itemId, entry.quantity);
        if (!stack?.item || preview.remainder > 0) {
          return { ok: false, code: 'insufficientItems', itemId: entry.itemId, missing: preview.remainder || entry.quantity };
        }
        prepared.push({ item: clone(stack.item), quantity: entry.quantity });
      }
      const required = normalized.reduce((sum, entry) => sum + entry.quantity, 0);
      if (typeof target.getAvailableCapacity === 'function' && target.getAvailableCapacity() < required) {
        return { ok: false, code: 'cargoCapacityFull', required, available: target.getAvailableCapacity() };
      }
      const addPreview = this.inventoryTransactions.previewBatchAdd(target, prepared);
      if (addPreview.remainder > 0) return { ok: false, code: addPreview.reason || 'inventoryFull', ...addPreview };

      const sourceBefore = snapshotInventory(source);
      const targetBefore = snapshotInventory(target);
      const transactionIds = [];
      for (let index = 0; index < prepared.length; index += 1) {
        const transactionId = `${operationId}:inventory:${index}`;
        const entry = prepared[index];
        const committed = this.inventoryTransactions.commit({
          type: 'transfer', source, target, item: entry.item, quantity: entry.quantity,
          allowPartial: false, operationId: transactionId
        });
        if (!committed.ok) {
          restoreInventory(source, sourceBefore);
          restoreInventory(target, targetBefore);
          for (const id of transactionIds) this.inventoryTransactions.forgetOperation(id);
          this.inventoryTransactions.forgetOperation(transactionId);
          return committed;
        }
        transactionIds.push(transactionId);
      }
      const result = { ok: true, operationId, entries: clone(normalized), accepted: required };
      const saved = await this._saveOperation(operationId, fingerprint, result, {
        checkpointId, operationId, context, kind: 'cargoBatchTransfer', deferCheckpoint
      });
      if (!saved.ok) {
        restoreInventory(source, sourceBefore);
        restoreInventory(target, targetBefore);
        for (const id of transactionIds) this.inventoryTransactions.forgetOperation(id);
        return saved;
      }
      this._emit('cargoTransferred', result);
      return clone(result);
    });
  }
  async recordHorseTravel({
    vehicle, inventory, distance, config = {}, operationId, checkpointId = null, context = null,
    inventoryOwnerId = null
  } = {}) {
    const component = vehicle?.getComponent?.('vehicle');
    const travelled = Math.max(0, Number(distance) || 0);
    if (!component || component.vehicleType !== 'horse' || !inventory || !operationId || travelled <= 0) {
      return { ok: false, code: 'invalidHorseTravel' };
    }
    const interval = Math.max(1, Number(config.distancePerFood) || 1000);
    const itemId = config.foodItemId || 'resource.food';
    const fingerprint = JSON.stringify([
      'horseTravel', vehicle.id, inventoryOwnerId || this._inventoryId(inventory), travelled, interval, itemId
    ]);
    return this._executeOperation(operationId, fingerprint, async () => {
      const before = clone(component.logistics);
      const inventoryBefore = snapshotInventory(inventory);
      const accumulated = before.distanceSinceFeed + travelled;
      const required = Math.floor(accumulated / interval);
      if (required > 0 && inventory.getItemCount(itemId) < required) {
        component.logistics = {
          ...before,
          odometer: before.odometer + travelled,
          distanceSinceFeed: accumulated,
          starved: true
        };
        const failed = {
          ok: false, code: 'horseFoodMissing', operationId, required,
          available: inventory.getItemCount(itemId), behavior: config.onMissingFood || 'stop'
        };
        const saved = await this._saveOperation(operationId, fingerprint, failed, {
          checkpointId, operationId, context, kind: 'horseStarved'
        });
        if (!saved.ok) component.logistics = before;
        return saved.ok ? clone(failed) : saved;
      }
      const transactionId = `${operationId}:food`;
      if (required > 0) {
        const removed = this.inventoryTransactions.commit({
          type: 'remove', inventory, itemId, quantity: required, allowPartial: false, operationId: transactionId
        });
        if (!removed.ok) return removed;
      }
      component.logistics = {
        ...before,
        odometer: before.odometer + travelled,
        distanceSinceFeed: accumulated - required * interval,
        foodConsumed: before.foodConsumed + required,
        starved: false
      };
      const result = { ok: true, operationId, distance: travelled, foodConsumed: required, logistics: clone(component.logistics) };
      const saved = await this._saveOperation(operationId, fingerprint, result, {
        checkpointId, operationId, context, kind: 'horseTravel'
      });
      if (!saved.ok) {
        component.logistics = before;
        restoreInventory(inventory, inventoryBefore);
        if (required > 0) this.inventoryTransactions.forgetOperation(transactionId);
        return saved;
      }
      this._emit('horseTravelCommitted', result);
      return clone(result);
    });
  }

  async refeedHorse({
    vehicle, inventory, config = {}, operationId, checkpointId = null, context = null,
    inventoryOwnerId = null
  } = {}) {
    const component = vehicle?.getComponent?.('vehicle');
    if (!component || component.vehicleType !== 'horse' || !inventory || !operationId) {
      return { ok: false, code: 'invalidHorseRefeed' };
    }
    const interval = Math.max(1, Number(config.distancePerFood) || 1000);
    const itemId = config.foodItemId || 'resource.food';
    const fingerprint = JSON.stringify([
      'horseRefeed', vehicle.id, inventoryOwnerId || this._inventoryId(inventory), interval, itemId
    ]);
    return this._executeOperation(operationId, fingerprint, async () => {
      if (component.logistics.starved !== true) return { ok: false, code: 'horseNotStarved' };
      const required = Math.max(1, Math.floor(component.logistics.distanceSinceFeed / interval));
      const available = inventory.getItemCount(itemId);
      if (available < required) {
        return { ok: false, code: 'horseFoodMissing', operationId, required, available };
      }
      const before = clone(component.logistics);
      const inventoryBefore = snapshotInventory(inventory);
      const transactionId = `${operationId}:food`;
      const removed = this.inventoryTransactions.commit({
        type: 'remove', inventory, itemId, quantity: required, allowPartial: false, operationId: transactionId
      });
      if (!removed.ok) return removed;

      component.logistics = {
        ...before,
        distanceSinceFeed: Math.max(0, before.distanceSinceFeed - required * interval),
        foodConsumed: before.foodConsumed + required,
        starved: false
      };
      const result = {
        ok: true,
        operationId,
        vehicleId: vehicle.id,
        foodConsumed: required,
        logistics: clone(component.logistics)
      };
      const saved = await this._saveOperation(operationId, fingerprint, result, {
        checkpointId, operationId, context, kind: 'horseRefed'
      });
      if (!saved.ok) {
        component.logistics = before;
        restoreInventory(inventory, inventoryBefore);
        this.inventoryTransactions.forgetOperation(transactionId);
        return saved;
      }
      this._emit('horseRefed', result);
      return clone(result);
    });
  }

  async destroyCargoVehicle({
    vehicle, operationId, checkpointId = null, context = null,
    deferCheckpoint = false, deferEvent = false
  } = {}) {
    const cargo = vehicle?.getComponent?.('cargo');
    const component = vehicle?.getComponent?.('vehicle');
    if (!cargo || !component || !operationId) return { ok: false, code: 'cargoVehicleMissing' };
    const fingerprint = JSON.stringify(['destroyCargo', vehicle.id]);
    return this._executeOperation(operationId, fingerprint, async () => {
      if (cargo.dropGenerated) {
        return cargo.dropOperationId === operationId
          ? {
            ok: true, idempotent: true, operationId, vehicleId: vehicle.id,
            drop: clone(cargo.dropManifest), singleDrop: true
          }
          : { ok: false, code: 'cargoDropAlreadyGenerated', operationId: cargo.dropOperationId };
      }
      const cargoBefore = cargo.serialize();
      const vehicleBefore = component.serialize();
      const drop = snapshotInventory(cargo);
      cargo.clear();
      cargo.dropGenerated = true;
      cargo.dropOperationId = operationId;
      cargo.dropManifest = clone(drop);
      component.destroyed = true;
      component.hp = 0;
      const result = { ok: true, operationId, vehicleId: vehicle.id, drop: clone(drop), singleDrop: true };
      const saved = await this._saveOperation(operationId, fingerprint, result, {
        checkpointId, operationId, context, kind: 'cargoVehicleDestroyed', drop, deferCheckpoint
      });
      if (!saved.ok) {
        const cargoRestored = cargo.deserialize(cargoBefore);
        const vehicleRestored = component.deserialize(vehicleBefore);
        if (!cargoRestored?.ok || !vehicleRestored?.ok) {
          return {
            ok: false,
            code: 'cargoVehicleRollbackFailed',
            cause: saved.code,
            cargoCode: cargoRestored?.code,
            vehicleCode: vehicleRestored?.code
          };
        }
        return saved;
      }
      if (!deferEvent) this.emitCargoVehicleDestroyed(result);
      return clone(result);
    });
  }

  emitCargoVehicleDestroyed(result) {
    if (!result?.ok || !result.vehicleId || !result.operationId) return false;
    this._emit('cargoVehicleDestroyed', result);
    return true;
  }

  async burnLadder({ vehicle, operationId, checkpointId = null, context = null } = {}) {
    return this._commitVehicleFlag({
      vehicle, operationId, checkpointId, context,
      kind: 'ladderBurned',
      validate: component => component.vehicleType === 'ladder'
        && !component.logistics.ladderEntryDisabled && !component.destroyed,
      mutate: component => { component.logistics.ladderEntryDisabled = true; component.destroyed = true; component.hp = 0; }
    });
  }

  async assembleCatapult({
    vehicle, inventory, requirements = {}, operationId, checkpointId = null, context = null,
    inventoryOwnerId = null, deferCheckpoint = false
  } = {}) {
    const component = vehicle?.getComponent?.('vehicle');
    if (!component || component.vehicleType !== 'catapult' || !inventory || !operationId) {
      return { ok: false, code: 'invalidCatapultAssembly' };
    }
    const entries = this._resourceEntries(requirements);
    return this._consumeForVehicle({
      vehicle, component, inventory, entries, operationId, checkpointId, context,
      inventoryOwnerId, deferCheckpoint, kind: 'catapultAssembled',
      validate: value => !value.logistics.catapultAssembled,
      alreadyCode: 'catapultAlreadyAssembled',
      mutate: () => { component.logistics.catapultAssembled = true; }
    });
  }

  async fireCatapult({
    vehicle, inventory, costs = {}, targetId = null, execute = null,
    operationId, checkpointId = null, context = null, inventoryOwnerId = null
  } = {}) {
    const component = vehicle?.getComponent?.('vehicle');
    if (!component || component.vehicleType !== 'catapult' || !inventory || !operationId) {
      return { ok: false, code: 'catapultNotReady' };
    }
    return this._consumeForVehicle({
      vehicle, component, inventory, entries: this._resourceEntries(costs), operationId, checkpointId, context,
      inventoryOwnerId, kind: 'catapultFired', fingerprintSuffix: targetId ? [targetId] : [], execute,
      validate: value => value.logistics.catapultAssembled && !value.destroyed,
      alreadyCode: 'catapultNotReady',
      mutate: () => { component.logistics.catapultShots += 1; }
    });
  }

  serialize() {
    return {
      schemaVersion: 1,
      operations: [...this.operations.entries()].map(([operationId, value]) => ({ operationId, ...clone(value) }))
    };
  }

  deserialize(data = {}) {
    if (data.schemaVersion !== 1 || !Array.isArray(data.operations)) return { ok: false, code: 'invalidVehicleLogisticsSnapshot' };
    const prepared = new Map();
    for (const entry of data.operations) {
      if (!entry?.operationId || !entry.fingerprint || !entry.result || prepared.has(entry.operationId)) {
        return { ok: false, code: 'invalidVehicleLogisticsOperation' };
      }
      prepared.set(entry.operationId, { fingerprint: entry.fingerprint, result: clone(entry.result) });
    }
    this.operations = prepared;
    return { ok: true };
  }

  async _consumeForVehicle({
    vehicle, component, inventory, entries, operationId, checkpointId, context, kind, mutate,
    inventoryOwnerId = null, deferCheckpoint = false, fingerprintSuffix = [], execute = null,
    validate = () => true, alreadyCode = 'invalidVehicleOperation'
  }) {
    if (!entries.length) return { ok: false, code: 'resourceRequirementsMissing' };
    const fingerprint = JSON.stringify([
      kind, vehicle?.id || 'unknown', inventoryOwnerId || this._inventoryId(inventory), entries,
      ...fingerprintSuffix
    ]);
    return this._executeOperation(operationId, fingerprint, async () => {
      if (!validate(component)) return { ok: false, code: alreadyCode };
      const inventoryBefore = snapshotInventory(inventory);
      const logisticsBefore = clone(component.logistics);
      const transactionId = `${operationId}:resources`;
      const rollbackBase = () => {
        restoreInventory(inventory, inventoryBefore);
        component.logistics = logisticsBefore;
        this.inventoryTransactions.forgetOperation(transactionId);
      };
      const removed = this.inventoryTransactions.commit({
        type: 'batchRemove', inventory, entries, operationId: transactionId
      });
      if (!removed.ok) return { ...removed, code: removed.code || 'vehicleResourcesMissing' };
      mutate();

      let execution = null;
      if (typeof execute === 'function') {
        try {
          execution = await execute({ vehicle, component, operationId, kind, context });
        } catch (error) {
          rollbackBase();
          return { ok: false, code: 'vehicleWeaponExecutionFailed', message: String(error?.message || error) };
        }
        if (execution?.ok === false) {
          try { await execution.rollback?.(); } catch (error) { /* executor 尚未提交，继续恢复基础状态 */ }
          rollbackBase();
          return clone(execution);
        }
      }

      const result = {
        ok: true,
        operationId,
        kind,
        consumed: clone(entries),
        logistics: clone(component.logistics),
        ...(fingerprintSuffix.length ? { targetId: fingerprintSuffix[0] } : {}),
        ...(execution?.result ? { execution: clone(execution.result) } : {})
      };
      const saved = await this._saveOperation(operationId, fingerprint, result, {
        checkpointId, operationId, context, kind, deferCheckpoint
      });
      if (!saved.ok) {
        let executorRollbackOk = true;
        try { executorRollbackOk = await execution?.rollback?.() !== false; }
        catch (error) { executorRollbackOk = false; }
        rollbackBase();
        return executorRollbackOk
          ? saved
          : { ok: false, code: 'vehicleRollbackFailed', cause: saved.code };
      }
      try { await execution?.finalize?.(); }
      catch (error) { console.warn('VehicleLogisticsSystem: executor finalize failed', error); }
      this._emit(kind, result);
      return clone(result);
    });
  }
  async _commitVehicleFlag({ vehicle, operationId, checkpointId, context, kind, validate, mutate }) {
    const component = vehicle?.getComponent?.('vehicle');
    if (!component || !operationId) return { ok: false, code: 'invalidVehicleOperation' };
    const fingerprint = JSON.stringify([kind, vehicle.id]);
    return this._executeOperation(operationId, fingerprint, async () => {
      if (!validate(component)) return { ok: false, code: 'invalidVehicleOperation' };
      const before = component.serialize();
      mutate(component);
      const result = { ok: true, operationId, kind, vehicleId: vehicle.id, logistics: clone(component.logistics) };
      const saved = await this._saveOperation(operationId, fingerprint, result, {
        checkpointId, operationId, context, kind
      });
      if (!saved.ok) {
        const restored = component.deserialize(before);
        return restored?.ok
          ? saved
          : { ok: false, code: 'vehicleRollbackFailed', cause: saved.code, vehicleCode: restored?.code };
      }
      this._emit(kind, result);
      return clone(result);
    });
  }

  _resourceEntries(source) {
    const aliases = { wood: 'resource.wood', iron: 'resource.iron', food: 'resource.food', herb: 'resource.herb', stone: 'resource.stone', manpower: 'resource.manpower' };
    const values = Array.isArray(source)
      ? source.map(entry => [entry?.itemId, entry?.quantity])
      : Object.entries(source || {});
    const totals = new Map();
    for (const [key, rawQuantity] of values) {
      const itemId = aliases[key] || key;
      const quantity = Math.max(0, Math.floor(Number(rawQuantity) || 0));
      if (itemId && quantity > 0) totals.set(itemId, (totals.get(itemId) || 0) + quantity);
    }
    return [...totals.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
  }

  async _saveOperation(operationId, fingerprint, result, payload) {
    const journal = this._remember(operationId, fingerprint, result);
    if (payload?.deferCheckpoint === true) return { ok: true, deferred: true };
    const saved = await this._checkpoint(payload);
    if (!saved.ok) this._rollbackRemember(journal);
    return saved;
  }

  async _executeOperation(operationId, fingerprint, executor) {
    const known = this._known(operationId, fingerprint);
    if (known) return known;
    const active = this.inFlight.get(operationId);
    if (active) {
      return active.fingerprint === fingerprint
        ? clone(await active.promise)
        : { ok: false, code: 'operationIdConflict', operationId };
    }
    const promise = Promise.resolve().then(executor);
    this.inFlight.set(operationId, { fingerprint, promise });
    try { return clone(await promise); }
    finally {
      if (this.inFlight.get(operationId)?.promise === promise) this.inFlight.delete(operationId);
    }
  }

  _inventoryId(inventory) {
    const configured = this.getInventoryOwnerId?.(inventory);
    if (configured) return String(configured);
    if (!inventory || typeof inventory !== 'object') return 'none';
    if (!this.inventoryIds.has(inventory)) {
      this.inventoryIds.set(inventory, `runtime-inventory-${this.nextInventoryId++}`);
    }
    return this.inventoryIds.get(inventory);
  }

  async _checkpoint(payload) {
    if (!this.createCheckpoint) return { ok: false, code: 'checkpointAdapterMissing' };
    try {
      const result = await this.createCheckpoint({
        ...clone(payload),
        checkpointId: payload.checkpointId || `checkpoint.vehicle.${payload.kind}`
      });
      return result === false || result?.ok === false
        ? { ok: false, code: 'vehicleCheckpointRejected', message: result?.message || result?.code }
        : { ok: true };
    } catch (error) {
      return { ok: false, code: 'vehicleCheckpointRejected', message: String(error?.message || error) };
    }
  }

  _known(operationId, fingerprint) {
    const known = this.operations.get(operationId);
    if (!known) return null;
    return known.fingerprint === fingerprint
      ? { ...clone(known.result), idempotent: true }
      : { ok: false, code: 'operationIdConflict', operationId };
  }

  _remember(operationId, fingerprint, result) {
    const previous = this.operations.get(operationId);
    const previousIndex = [...this.operations.keys()].indexOf(operationId);
    const entry = { fingerprint, result: clone(result) };
    this.operations.set(operationId, entry);
    const evicted = [];
    while (this.operations.size > this.maxOperations) {
      const evictedId = this.operations.keys().next().value;
      const evictedValue = this.operations.get(evictedId);
      this.operations.delete(evictedId);
      evicted.push({ operationId: evictedId, value: evictedValue, index: 0 });
    }
    return { operationId, entry, previous, previousIndex, evicted };
  }

  _rollbackRemember(journal) {
    if (!journal || this.operations.get(journal.operationId) !== journal.entry) return false;
    this.operations.delete(journal.operationId);
    if (journal.previous && !this.operations.has(journal.operationId)) {
      this._insertOperationAt(journal.operationId, journal.previous, journal.previousIndex);
    }
    for (const evicted of [...journal.evicted].reverse()) {
      if (!this.operations.has(evicted.operationId)) {
        this._insertOperationAt(evicted.operationId, evicted.value, evicted.index);
      }
    }
    return true;
  }

  _insertOperationAt(operationId, value, index) {
    const entries = [...this.operations.entries()];
    entries.splice(Math.max(0, Math.min(entries.length, Number(index) || 0)), 0, [operationId, value]);
    this.operations = new Map(entries);
  }

  _emit(event, payload) {
    try { this.onEvent(event, clone(payload)); }
    catch (error) { console.warn(`[VehicleLogisticsSystem] ${event} listener failed`, error); }
  }
}

export default VehicleLogisticsSystem;
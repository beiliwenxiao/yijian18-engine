/************************************************************
 * 通用营建领域系统：前置校验、材料托管、工期、工具损毁与幂等结果。
 ************************************************************/

const SNAPSHOT_VERSION = 1;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const normalizeId = value => typeof value === 'string' ? value.trim() : '';

export class ConstructionSystem {
  constructor({ inventoryTransactions, proficiencySystem = null, itemResolver = null,
    validateSite = null, createCheckpoint = null, createEventId = null, onEvent = null, maxOperations = 256 } = {}) {
    if (!inventoryTransactions) throw new TypeError('ConstructionSystem requires inventoryTransactions');
    this.inventoryTransactions = inventoryTransactions;
    this.proficiencySystem = proficiencySystem;
    this.itemResolver = typeof itemResolver === 'function' ? itemResolver : () => null;
    this.validateSite = typeof validateSite === 'function' ? validateSite : () => ({ ok: true });
    this.createCheckpoint = typeof createCheckpoint === 'function' ? createCheckpoint : null;
    this.createEventId = typeof createEventId === 'function' ? createEventId : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.maxOperations = Math.max(16, Math.floor(Number(maxOperations) || 256));
    this.definitions = new Map();
    this.pending = new Map();
    this.structures = new Map();
    this.operations = new Map();
    this.toolReservations = new Map();
    this.repairLocks = new Set();
  }

  registerDefinitions(definitions = []) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      return { ok: false, code: 'missingDefinitions' };
    }
    const prepared = new Map();
    for (const source of definitions) {
      const definition = this._normalizeDefinition(source);
      if (!definition.ok) return definition;
      if (prepared.has(definition.value.id)) {
        return { ok: false, code: 'duplicateDefinition', id: definition.value.id };
      }
      prepared.set(definition.value.id, definition.value);
    }
    this.definitions = prepared;
    return { ok: true, count: prepared.size };
  }

  getDefinition(id) { return clone(this.definitions.get(id) || null); }
  getStructure(siteId) { return clone(this.structures.get(normalizeId(siteId)) || null); }
  getPending(siteId) { return this._describePending(this.pending.get(siteId)); }
  getStructures() { return [...this.structures.values()].map(clone); }

  /**
   * 将外部 ECS 建筑耐久同步回营建领域镜像，不创建检查点。
   * 调用方必须以 BuildingComponent 为运行时事实源，并在维修事务开始前调用。
   */
  synchronizeStructure({ siteId, durability, destroyed = false } = {}) {
    const siteKey = normalizeId(siteId);
    const structure = this.structures.get(siteKey);
    const value = Math.floor(Number(durability));
    if (!siteKey || !structure) return { ok: false, code: 'structureMissing', siteId: siteKey };
    if (!Number.isFinite(value) || value < 0 || value > structure.maxDurability) {
      return { ok: false, code: 'invalidStructureDurability', siteId: siteKey };
    }
    structure.durability = destroyed === true ? 0 : value;
    return { ok: true, structure: clone(structure) };
  }

  /**
   * 只校验并生成维修草稿，不修改运行时状态。
   * @param {{siteId:string, amount:number}} request
   */
  prepareRepairDraft({ siteId, amount } = {}) {
    const siteKey = normalizeId(siteId);
    const requested = Math.floor(Number(amount));
    if (!siteKey || !Number.isFinite(requested) || requested <= 0) {
      return { ok: false, code: 'invalidRepairInput' };
    }
    const structure = this.structures.get(siteKey);
    if (!structure) return { ok: false, code: 'structureMissing', siteId: siteKey };

    const maxDurability = Math.floor(Number(structure.maxDurability));
    const durability = Math.floor(Number(structure.durability));
    if (!Number.isFinite(maxDurability) || maxDurability <= 0
      || !Number.isFinite(durability) || durability < 0 || durability > maxDurability) {
      return { ok: false, code: 'invalidStructureDurability', siteId: siteKey };
    }
    if (durability >= maxDurability) {
      return { ok: false, code: 'repairNotNeeded', siteId: siteKey, durability, maxDurability };
    }

    const appliedAmount = Math.min(requested, maxDurability - durability);
    const draft = clone(structure);
    draft.durability = durability + appliedAmount;
    return {
      ok: true,
      siteId: siteKey,
      requestedAmount: requested,
      appliedAmount,
      before: clone(structure),
      draft
    };
  }

  /**
   * 建筑维修事务：validate → draft → commit → emit → checkpoint。
   * checkpoint 失败时恢复提交前状态；相同 operationId 与参数重复调用返回幂等结果。
   */
  async repair({ siteId, amount, operationId, checkpointId = null, context = null } = {}) {
    const siteKey = normalizeId(siteId);
    const opId = normalizeId(operationId);
    const requested = Math.floor(Number(amount));
    if (!siteKey || !opId || !Number.isFinite(requested) || requested <= 0) {
      return { ok: false, code: 'invalidRepairInput' };
    }

    const fingerprint = JSON.stringify([siteKey, requested]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    if (!this.createCheckpoint) return { ok: false, code: 'checkpointAdapterMissing' };
    if (this.repairLocks.has(siteKey)) return { ok: false, code: 'structureBusy', siteId: siteKey };

    const prepared = this.prepareRepairDraft({ siteId: siteKey, amount: requested });
    if (!prepared.ok) return prepared;

    this.repairLocks.add(siteKey);
    this.structures.set(siteKey, clone(prepared.draft));
    const result = {
      ok: true,
      status: 'repaired',
      operationId: opId,
      siteId: siteKey,
      requestedAmount: prepared.requestedAmount,
      appliedAmount: prepared.appliedAmount,
      structure: clone(prepared.draft)
    };
    this._emit('constructionRepaired', { ...result, context: clone(context) });

    try {
      const checkpoint = await this.createCheckpoint({
        checkpointId: normalizeId(checkpointId) || `checkpoint.construction.${siteKey}.repair`,
        operationId: opId,
        structure: clone(prepared.draft),
        context: clone(context)
      });
      if (checkpoint === false || checkpoint?.ok === false) {
        throw new Error(checkpoint?.message || checkpoint?.errors?.[0]?.message || 'checkpointRejected');
      }
    } catch (error) {
      this.structures.set(siteKey, clone(prepared.before));
      const message = String(error?.message || error);
      this._emit('constructionRepairRolledBack', {
        operationId: opId,
        siteId: siteKey,
        reason: message,
        structure: clone(prepared.before)
      });
      return { ok: false, code: 'repairRolledBack', operationId: opId, siteId: siteKey, message };
    } finally {
      this.repairLocks.delete(siteKey);
    }

    this._remember(opId, fingerprint, result);
    return clone(result);
  }

  start({ characterId, inventory, definitionId, siteId, operationId,
    cityDamageRatio = 0, context = null } = {}) {
    const character = normalizeId(characterId);
    const definitionKey = normalizeId(definitionId);
    const siteKey = normalizeId(siteId);
    const opId = normalizeId(operationId);
    if (!character || !definitionKey || !siteKey || !opId || !inventory) {
      return { ok: false, code: 'invalidInput' };
    }
    const fingerprint = JSON.stringify([character, definitionKey, siteKey, Number(cityDamageRatio) > 0.5]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }

    const definition = this.definitions.get(definitionKey);
    if (!definition) return { ok: false, code: 'unknownDefinition', definitionId: definitionKey };

    // 固定前置顺序：占用 → 熟练度 → 材料 → 工具 → 位置；失败不扣材料。
    if (this.pending.has(siteKey)) return { ok: false, code: 'siteBusy', siteId: siteKey };
    if (this.structures.has(siteKey)) return { ok: false, code: 'siteOccupied', siteId: siteKey };
    const level = Number(this.proficiencySystem?.getState?.(character, 'construction')?.level) || 0;
    if (level < definition.requiredProficiency) {
      return { ok: false, code: 'proficiencyRequired', required: definition.requiredProficiency, actual: level };
    }

    const reservedItems = [];
    for (const entry of definition.costs) {
      if (this.inventoryTransactions.previewRemove(inventory, entry.itemId, entry.quantity).remainder > 0) {
        return { ok: false, code: 'materialsRequired', itemId: entry.itemId, quantity: entry.quantity };
      }
      const item = this.itemResolver(entry.itemId);
      if (!item?.id) return { ok: false, code: 'unknownMaterialDefinition', itemId: entry.itemId };
      reservedItems.push({ item: clone(item), quantity: entry.quantity });
    }

    const tool = this._findTool(inventory, definition.requiredToolType);
    if (definition.requiredToolType && !tool) {
      return { ok: false, code: 'toolRequired', toolType: definition.requiredToolType };
    }
    if (tool && !normalizeId(tool.instanceId)) {
      return { ok: false, code: 'toolInstanceRequired', toolType: definition.requiredToolType };
    }
    if (tool && this.toolReservations.has(tool.instanceId)) {
      return { ok: false, code: 'toolReserved', toolInstanceId: tool.instanceId };
    }

    const site = this.validateSite({
      siteId: siteKey,
      characterId: character,
      definition: clone(definition),
      context: clone(context)
    }) || { ok: false };
    if (site.ok === false) return { ok: false, code: site.code || 'invalidSite', siteId: siteKey };

    const materialOperationId = `${opId}:materials`;
    const removed = this.inventoryTransactions.commit({
      type: 'batchRemove', inventory, entries: definition.costs, operationId: materialOperationId
    });
    if (!removed.ok) {
      this.inventoryTransactions.forgetOperation?.(materialOperationId);
      return { ok: false, code: removed.code || 'materialCommitFailed' };
    }

    const emergency = Number(cityDamageRatio) > 0.5;
    const pending = {
      characterId: character,
      inventory,
      definition,
      definitionId: definitionKey,
      siteId: siteKey,
      operationId: opId,
      operationFingerprint: fingerprint,
      materialOperationId,
      elapsed: 0,
      duration: emergency ? definition.duration * 0.5 : definition.duration,
      emergency,
      toolInstanceId: tool?.instanceId || null,
      toolId: tool?.id || null,
      reservedCosts: clone(definition.costs),
      reservedItems,
      status: 'active',
      cancelReason: null
    };
    this.pending.set(siteKey, pending);
    if (pending.toolInstanceId) this.toolReservations.set(pending.toolInstanceId, siteKey);
    const result = {
      ok: true,
      status: 'active',
      operationId: opId,
      siteId: siteKey,
      definitionId: definitionKey,
      duration: pending.duration,
      emergency
    };
    this._remember(opId, fingerprint, result);
    this._emit('constructionStarted', result);
    return clone(result);
  }

  update(deltaTime) {
    const terminal = [];
    const elapsed = Math.max(0, Number(deltaTime) || 0);
    for (const [siteId, pending] of [...this.pending]) {
      if (pending.status !== 'active') continue;
      pending.elapsed = Math.min(pending.duration, pending.elapsed + elapsed);
      this._emit('constructionProgress', this._describePending(pending));
      if (pending.elapsed >= pending.duration) terminal.push(this._complete(siteId, pending));
    }
    return terminal;
  }

  cancel(siteId, reason = 'cancelled') {
    const pending = this.pending.get(normalizeId(siteId));
    if (!pending) return { ok: false, code: 'noPendingConstruction' };
    return pending.status === 'refundPending'
      ? this.retryRefund(pending.siteId)
      : this._cancel(pending.siteId, pending, reason);
  }

  retryRefund(siteId) {
    const pending = this.pending.get(normalizeId(siteId));
    if (!pending || pending.status !== 'refundPending') {
      return { ok: false, code: 'noPendingRefund' };
    }
    return this._refundAndClose(pending.siteId, pending, pending.cancelReason || 'cancelled');
  }

  captureRuntime() {
    return {
      pending: new Map([...this.pending].map(([id, value]) => [id, this._cloneRuntimePending(value)])),
      structures: new Map([...this.structures].map(([id, value]) => [id, clone(value)])),
      operations: new Map([...this.operations].map(([id, value]) => [id, clone(value)]))
    };
  }

  restoreRuntime(snapshot) {
    if (!(snapshot?.pending instanceof Map)
      || !(snapshot?.structures instanceof Map)
      || !(snapshot?.operations instanceof Map)) return false;
    this.pending = new Map([...snapshot.pending].map(([id, value]) => [id, this._cloneRuntimePending(value)]));
    this.structures = new Map([...snapshot.structures].map(([id, value]) => [id, clone(value)]));
    this.operations = new Map([...snapshot.operations].map(([id, value]) => [id, clone(value)]));
    this._rebuildToolReservations();
    return true;
  }

  serialize() {
    return {
      schemaVersion: SNAPSHOT_VERSION,
      structures: [...this.structures.values()].map(clone),
      pending: [...this.pending.values()].map(value => ({
        ...this._describePending(value),
        characterId: value.characterId,
        materialOperationId: value.materialOperationId,
        operationFingerprint: value.operationFingerprint,
        reservedCosts: clone(value.reservedCosts),
        reservedItems: clone(value.reservedItems),
        cancelReason: value.cancelReason || null
      })),
      operations: [...this.operations.entries()].map(([operationId, entry]) => ({
        operationId,
        fingerprint: entry.fingerprint,
        result: clone(entry.result)
      }))
    };
  }

  validateSerialized(data = {}, options = {}) {
    const prepared = this._prepareSerialized(data, options);
    return prepared.ok ? { ok: true, errors: [] } : { ok: false, errors: prepared.errors };
  }

  deserialize(data = {}, options = {}) {
    const prepared = this._prepareSerialized(data, options);
    if (!prepared.ok) return { ok: false, errors: prepared.errors };
    this.structures = prepared.structures;
    this.pending = prepared.pending;
    this.operations = prepared.operations;
    this._rebuildToolReservations();
    return { ok: true, errors: [] };
  }

  _createEventId(eventType, payload) {
    if (!this.createEventId) return null;
    try {
      return this.createEventId({ eventType, payload: clone(payload) }) || null;
    } catch (error) {
      console.warn('[ConstructionSystem] 创建事件 ID 失败', { eventType, error });
      return null;
    }
  }

  _complete(siteId, pending) {
    const tool = this._findReservedTool(pending.inventory, pending);
    if (pending.definition.requiredToolType && !tool) return this._cancel(siteId, pending, 'toolMissing');
    if (tool) {
      tool.durability = Math.max(0, Math.floor(Number(tool.durability) || 0) - 1);
      if (tool.durability === 0) return this._cancel(siteId, pending, 'toolBroken');
    }

    const maxDurability = pending.definition.maxDurability;
    const structure = {
      schemaVersion: 1,
      id: `${pending.definitionId}:${siteId}`,
      siteId,
      definitionId: pending.definitionId,
      status: 'completed',
      maxDurability,
      durability: pending.emergency ? Math.max(1, Math.floor(maxDurability * 0.5)) : maxDurability,
      manned: pending.definition.manned,
      operationId: pending.operationId
    };
    this.pending.delete(siteId);
    this._releaseTool(pending);
    this.structures.set(siteId, structure);
    const experienceResult = this.proficiencySystem?.gainExperience?.({
      characterId: pending.characterId,
      type: 'construction',
      amount: pending.definition.experience,
      operationId: `${pending.operationId}:proficiency`
    }) || { ok: true, skipped: true };
    const resultPayload = {
      siteId,
      status: 'completed',
      operationId: pending.operationId,
      structure: clone(structure),
      experienceResult: clone(experienceResult)
    };
    const result = {
      ok: true,
      status: 'completed',
      operationId: pending.operationId,
      eventId: this._createEventId('construction.constructionCompleted', resultPayload),
      structure: clone(structure),
      experienceResult: clone(experienceResult)
    };
    this._remember(pending.operationId, pending.operationFingerprint, result);
    this._emit('constructionCompleted', result);
    return clone(result);
  }

  _cancel(siteId, pending, reason) {
    pending.status = 'refundPending';
    pending.cancelReason = reason;
    return this._refundAndClose(siteId, pending, reason);
  }

  _refundAndClose(siteId, pending, reason) {
    const refundId = `${pending.operationId}:refund`;
    const refunded = this.inventoryTransactions.commit({
      type: 'batchAdd',
      inventory: pending.inventory,
      entries: pending.reservedItems,
      allowPartial: false,
      operationId: refundId
    });
    if (!refunded.ok) {
      this.inventoryTransactions.forgetOperation?.(refundId);
      return { ok: false, code: 'refundPending', reason, status: 'refundPending', siteId };
    }
    this.pending.delete(siteId);
    this._releaseTool(pending);
    const resultPayload = {
      siteId,
      status: 'cancelled',
      operationId: pending.operationId,
      definitionId: pending.definitionId,
      reason
    };
    const result = {
      ok: false,
      code: reason,
      status: 'cancelled',
      refunded: true,
      operationId: pending.operationId,
      eventId: this._createEventId('construction.constructionCancelled', resultPayload),
      siteId,
      definitionId: pending.definitionId
    };
    this._remember(pending.operationId, pending.operationFingerprint, result);
    this._emit('constructionCancelled', result);
    return clone(result);
  }

  _findTool(inventory, toolType) {
    if (!toolType) return null;
    return (inventory?.slots || []).map(stack => stack?.item).find(item => (
      item?.toolType === toolType
      && Number(item.durability) > 0
      && normalizeId(item.instanceId)
      && !this.toolReservations.has(item.instanceId)
    )) || null;
  }

  _findReservedTool(inventory, pending) {
    if (!pending.toolInstanceId) return null;
    return (inventory?.slots || []).map(stack => stack?.item)
      .find(item => item?.instanceId === pending.toolInstanceId) || null;
  }

  _releaseTool(pending) {
    if (pending?.toolInstanceId) this.toolReservations.delete(pending.toolInstanceId);
  }

  _rebuildToolReservations() {
    this.toolReservations = new Map();
    for (const pending of this.pending.values()) {
      if (pending.toolInstanceId) this.toolReservations.set(pending.toolInstanceId, pending.siteId);
    }
  }

  _describePending(pending) {
    if (!pending) return null;
    return {
      definitionId: pending.definitionId,
      siteId: pending.siteId,
      operationId: pending.operationId,
      status: pending.status,
      elapsed: pending.elapsed,
      duration: pending.duration,
      progress: pending.duration > 0 ? pending.elapsed / pending.duration : 1,
      emergency: pending.emergency,
      toolInstanceId: pending.toolInstanceId,
      toolId: pending.toolId
    };
  }

  _cloneRuntimePending(value) {
    return {
      ...value,
      inventory: value.inventory,
      definition: clone(value.definition),
      reservedCosts: clone(value.reservedCosts),
      reservedItems: clone(value.reservedItems)
    };
  }

  _prepareSerialized(data, { resolveInventory = null } = {}) {
    const errors = [];
    if (!data || Number(data.schemaVersion) !== SNAPSHOT_VERSION) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: 'schemaVersion' }] };
    }
    if (!Array.isArray(data.structures) || !Array.isArray(data.pending) || !Array.isArray(data.operations)) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: '', message: '营建存档集合必须为数组' }] };
    }
    const structures = new Map();
    data.structures.forEach((source, index) => {
      const siteId = normalizeId(source?.siteId);
      const definitionId = normalizeId(source?.definitionId);
      if (!siteId || !this.definitions.has(definitionId) || structures.has(siteId)) {
        errors.push({ code: 'invalidStructure', path: `structures[${index}]` });
        return;
      }
      structures.set(siteId, clone(source));
    });

    const pending = new Map();
    data.pending.forEach((source, index) => {
      const siteId = normalizeId(source?.siteId);
      const definitionId = normalizeId(source?.definitionId);
      const characterId = normalizeId(source?.characterId);
      const operationId = normalizeId(source?.operationId);
      const definition = this.definitions.get(definitionId);
      const inventory = typeof resolveInventory === 'function'
        ? resolveInventory(characterId, clone(source))
        : null;
      if (!siteId || !characterId || !operationId || !definition || !inventory
        || pending.has(siteId) || structures.has(siteId)) {
        errors.push({ code: 'invalidPendingConstruction', path: `pending[${index}]` });
        return;
      }
      const duration = Number(source.duration);
      const elapsed = Number(source.elapsed);
      const status = source.status === 'refundPending' ? 'refundPending' : 'active';
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(elapsed) || elapsed < 0) {
        errors.push({ code: 'invalidPendingTime', path: `pending[${index}]` });
        return;
      }
      const value = {
        characterId,
        inventory,
        definition,
        definitionId,
        siteId,
        operationId,
        operationFingerprint: normalizeId(source.operationFingerprint),
        materialOperationId: normalizeId(source.materialOperationId) || `${operationId}:materials`,
        elapsed: Math.min(duration, elapsed),
        duration,
        emergency: source.emergency === true,
        toolInstanceId: normalizeId(source.toolInstanceId) || null,
        toolId: normalizeId(source.toolId) || null,
        reservedCosts: clone(source.reservedCosts || definition.costs),
        reservedItems: clone(source.reservedItems || []),
        status,
        cancelReason: source.cancelReason || null
      };
      if (definition.requiredToolType && !this._findReservedTool(inventory, value)) {
        errors.push({ code: 'reservedToolMissing', path: `pending[${index}].toolInstanceId` });
        return;
      }
      if (!Array.isArray(value.reservedItems) || value.reservedItems.some(entry => !entry?.item?.id || !(entry.quantity > 0))) {
        errors.push({ code: 'invalidReservedItems', path: `pending[${index}].reservedItems` });
        return;
      }
      pending.set(siteId, value);
    });

    const operations = new Map();
    data.operations.forEach((source, index) => {
      const operationId = normalizeId(source?.operationId);
      if (!operationId || !normalizeId(source?.fingerprint) || !source?.result || operations.has(operationId)) {
        errors.push({ code: 'invalidOperation', path: `operations[${index}]` });
        return;
      }
      operations.set(operationId, { fingerprint: source.fingerprint, result: clone(source.result) });
    });
    return errors.length ? { ok: false, errors } : { ok: true, structures, pending, operations };
  }

  _normalizeDefinition(source) {
    const id = normalizeId(source?.id);
    if (!id || !Array.isArray(source.costs) || source.costs.length === 0) {
      return { ok: false, code: 'invalidDefinition', id };
    }
    const costs = source.costs.map(entry => ({
      itemId: normalizeId(entry?.itemId),
      quantity: Math.floor(Number(entry?.quantity) || 0)
    }));
    if (costs.some(entry => !entry.itemId || entry.quantity <= 0)) {
      return { ok: false, code: 'invalidCost', id };
    }
    return {
      ok: true,
      value: {
        id,
        name: source.name || id,
        costs,
        requiredProficiency: Math.max(0, Math.floor(Number(source.requiredProficiency) || 0)),
        requiredToolType: normalizeId(source.requiredToolType) || null,
        duration: Math.max(0.1, Number(source.duration) || 1),
        maxDurability: Math.max(1, Math.floor(Number(source.maxDurability) || 100)),
        experience: Math.max(1, Math.floor(Number(source.experience) || 1)),
        manned: source.manned === true,
        imageId: normalizeId(source.imageId) || null,
        warEffects: source.warEffects && typeof source.warEffects === 'object'
          ? clone(source.warEffects)
          : null
      }
    };
  }

  _remember(operationId, fingerprint, result) {
    if (!operationId) return;
    this.operations.set(operationId, { fingerprint, result: clone(result) });
    while (this.operations.size > this.maxOperations) this.operations.delete(this.operations.keys().next().value);
  }

  _emit(event, payload) {
    try {
      this.onEvent(event, clone(payload));
    } catch (error) {
      console.warn(`[ConstructionSystem] ${event} listener failed`, error);
    }
  }
}

export default ConstructionSystem;
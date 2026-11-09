/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-09
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://github.com/beiliwenxiao/yijian18-engine`
 ************************************************************/

/************************************************************
 * 通用生产领域系统：配方注册、工位占用、材料/工钱预扣、工期、
 * 品质掷骰、失败三档与幂等结果。
 *
 * 与 ConstructionSystem 同构：
 *  - 材料在 start 时预扣（含 wage 铜钱），产出由场景侧
 *    `craft.production.<recipeId>`（state.transaction / batchAdd）提交，
 *    成功后调用 commitOutput 结算——本系统自身从不 add 物品。
 ************************************************************/

const SNAPSHOT_VERSION = 1;
const WAGE_ITEM_ID = 'currency.copper';
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const normalizeId = value => typeof value === 'string' ? value.trim() : '';
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

export class ProductionSystem {
  constructor({ inventoryTransactions, proficiencySystem = null, itemResolver = null,
    resolveStation = null, createCheckpoint = null, createEventId = null, onEvent = null,
    rng = null, maxOperations = 256 } = {}) {
    if (!inventoryTransactions) throw new TypeError('ProductionSystem requires inventoryTransactions');
    this.inventoryTransactions = inventoryTransactions;
    this.proficiencySystem = proficiencySystem;
    this.itemResolver = typeof itemResolver === 'function' ? itemResolver : () => null;
    this.resolveStation = typeof resolveStation === 'function' ? resolveStation : () => ({ ok: false, code: 'stationUnavailable' });
    this.createCheckpoint = typeof createCheckpoint === 'function' ? createCheckpoint : null;
    this.createEventId = typeof createEventId === 'function' ? createEventId : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.rng = typeof rng === 'function' ? rng : () => Math.random();
    this.maxOperations = Math.max(16, Math.floor(Number(maxOperations) || 256));
    this.recipes = new Map();
    this.pending = new Map();
    this.operations = new Map();
  }

  registerRecipes(list) {
    const source = list instanceof Map ? [...list.values()] : (Array.isArray(list) ? list : []);
    for (const entry of source) {
      const recipe = this._normalizeRecipe(entry);
      if (!recipe) {
        return { ok: false, code: 'invalidRecipe', id: normalizeId(entry?.id) };
      }
      if (this.recipes.has(recipe.id)) {
        return { ok: false, code: 'duplicateRecipe', id: recipe.id };
      }
      this.recipes.set(recipe.id, recipe);
    }
    return { ok: true, count: this.recipes.size };
  }

  getRecipe(recipeId) {
    const recipe = this.recipes.get(normalizeId(recipeId));
    return recipe ? clone(recipe) : null;
  }

  /**
   * 工位配方快照（供 UI）：逐条给出可用性与缺口。
   */
  getStationRecipes(stationId, { characterId = null, inventory = null } = {}) {
    const stationKey = normalizeId(stationId);
    const station = this.resolveStation(stationKey, { characterId });
    if (!station || station.ok === false) {
      return { ok: false, code: station?.code || 'stationUnavailable', stationId: stationKey, recipes: [] };
    }
    const allowed = Array.isArray(station.station?.recipes) ? station.station.recipes : [];
    const recipes = allowed
      .map(recipeId => this.recipes.get(recipeId))
      .filter(Boolean)
      .map(recipe => {
        const preview = this.previewStart({
          characterId: characterId || 'ui', inventory, stationId: stationKey, recipeId: recipe.id
        });
        return {
          recipeId: recipe.id,
          name: recipe.name,
          kind: recipe.kind,
          duration: recipe.duration,
          inputs: clone(recipe.inputs),
          outputs: clone(recipe.outputs),
          wage: clone(recipe.wage),
          requiredProficiency: clone(recipe.requiredProficiency),
          enabled: preview.ok === true && preview.busy !== true,
          busy: preview.busy === true,
          disabledReason: preview.ok ? (preview.busy ? 'stationBusy' : null) : preview.code
        };
      });
    return {
      ok: true,
      stationId: stationKey,
      definitionId: station.definitionId || null,
      entityId: station.entityId || null,
      station: clone(station.station),
      recipes
    };
  }

  previewStart({ characterId, inventory, stationId, recipeId } = {}) {
    const character = normalizeId(characterId);
    const stationKey = normalizeId(stationId);
    const recipe = this.recipes.get(normalizeId(recipeId));
    if (!character || !stationKey || !recipe) return { ok: false, code: 'invalidInput' };
    const station = this.resolveStation(stationKey, { characterId: character });
    if (!station || station.ok === false) {
      return { ok: false, code: station?.code || 'stationUnavailable', stationId: stationKey };
    }
    if (recipe.station !== stationKey) return { ok: false, code: 'stationMismatch', stationId: stationKey };
    if (!this._stationAllows(recipe, station)) return { ok: false, code: 'recipeNotAllowed', recipeId: recipe.id };
    const level = this._proficiencyLevel(character, recipe.kind);
    if (level < this._requiredProficiency(recipe)) {
      return { ok: false, code: 'proficiencyRequired', required: this._requiredProficiency(recipe), actual: level };
    }
    const costs = this._costsOf(recipe);
    if (inventory) {
      for (const entry of costs) {
        if (this.inventoryTransactions.previewRemove(inventory, entry.itemId, entry.quantity).remainder > 0) {
          return { ok: false, code: 'materialsRequired', itemId: entry.itemId, quantity: entry.quantity };
        }
      }
    }
    return {
      ok: true,
      busy: this.pending.has(stationKey),
      stationId: stationKey,
      recipeId: recipe.id,
      duration: recipe.duration,
      costs
    };
  }

  start({ characterId, inventory, stationId, recipeId, operationId, context = null } = {}) {
    const character = normalizeId(characterId);
    const stationKey = normalizeId(stationId);
    const recipe = this.recipes.get(normalizeId(recipeId));
    const opId = normalizeId(operationId);
    if (!character || !stationKey || !recipe || !opId || !inventory) {
      return { ok: false, code: 'invalidInput' };
    }
    const fingerprint = JSON.stringify([character, stationKey, recipe.id]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }

    const station = this.resolveStation(stationKey, { characterId: character });
    if (!station || station.ok === false) {
      return { ok: false, code: station?.code || 'stationUnavailable', stationId: stationKey };
    }
    if (station.durability != null && Number(station.durability) <= 0) {
      return { ok: false, code: 'stationDestroyed', stationId: stationKey };
    }
    if (recipe.station !== stationKey) return { ok: false, code: 'stationMismatch', stationId: stationKey };
    if (!this._stationAllows(recipe, station)) return { ok: false, code: 'recipeNotAllowed', recipeId: recipe.id };
    if (this.pending.has(stationKey)) return { ok: false, code: 'stationBusy', stationId: stationKey };

    const level = this._proficiencyLevel(character, recipe.kind);
    if (level < this._requiredProficiency(recipe)) {
      return { ok: false, code: 'proficiencyRequired', required: this._requiredProficiency(recipe), actual: level };
    }

    const reservedItems = [];
    for (const entry of this._costsOf(recipe)) {
      if (this.inventoryTransactions.previewRemove(inventory, entry.itemId, entry.quantity).remainder > 0) {
        return { ok: false, code: 'materialsRequired', itemId: entry.itemId, quantity: entry.quantity };
      }
      const item = this.itemResolver(entry.itemId);
      if (!item?.id) return { ok: false, code: 'unknownMaterialDefinition', itemId: entry.itemId };
      reservedItems.push({ item: clone(item), quantity: entry.quantity });
    }

    const materialOperationId = `${opId}:materials`;
    const removed = this.inventoryTransactions.commit({
      type: 'batchRemove', inventory, entries: this._costsOf(recipe), operationId: materialOperationId
    });
    if (!removed.ok) {
      this.inventoryTransactions.forgetOperation?.(materialOperationId);
      return { ok: false, code: removed.code || 'materialCommitFailed' };
    }

    const roll = this._rollJob(recipe);
    const pending = {
      characterId: character,
      inventory,
      recipe: clone(recipe),
      recipeId: recipe.id,
      stationId: stationKey,
      definitionId: station.definitionId || null,
      entityId: station.entityId || null,
      operationId: opId,
      operationFingerprint: fingerprint,
      materialOperationId,
      elapsed: 0,
      duration: recipe.duration,
      reservedCosts: this._costsOf(recipe),
      reservedItems,
      failure: roll.failure,
      qualityMultiplier: roll.qualityMultiplier,
      status: 'active',
      cancelReason: null
    };
    this.pending.set(stationKey, pending);
    const result = {
      ok: true,
      status: 'active',
      operationId: opId,
      jobId: stationKey,
      stationId: stationKey,
      recipeId: recipe.id,
      duration: pending.duration,
      outputs: clone(recipe.outputs)
    };
    this._remember(opId, fingerprint, result);
    this._emit('productionStarted', result);
    return clone(result);
  }

  update(deltaTime) {
    const terminal = [];
    const elapsed = Math.max(0, Number(deltaTime) || 0);
    for (const [stationId, pending] of [...this.pending]) {
      if (pending.status !== 'active') continue;
      pending.elapsed = Math.min(pending.duration, pending.elapsed + elapsed);
      this._emit('productionProgress', this._describePending(pending));
      if (pending.elapsed >= pending.duration) terminal.push(this._finish(stationId, pending));
    }
    return terminal;
  }

  /**
   * 产物提交：场景侧 craft.production.<recipeId> 成功后调用。
   * transactionResult.ok === false 时保持 ready，等待重试。
   */
  commitOutput(stationId, transactionResult = { ok: true }) {
    const key = normalizeId(stationId);
    const pending = this.pending.get(key);
    if (!pending) return { ok: false, code: 'noPendingProduction' };
    if (pending.status !== 'ready') return { ok: false, code: 'productionNotReady', status: pending.status };
    if (transactionResult && transactionResult.ok === false) {
      return { ok: false, code: transactionResult.code || 'outputCommitFailed', status: 'ready' };
    }
    this.pending.delete(key);
    const experienceResult = this.proficiencySystem?.gainExperience?.({
      characterId: pending.characterId,
      type: pending.recipe.kind,
      amount: this._experienceOf(pending.recipe),
      operationId: `${pending.operationId}:proficiency`
    }) || { ok: true, skipped: true };
    const payload = {
      stationId: key,
      recipeId: pending.recipeId,
      outputs: clone(pending.recipe.outputs),
      itemId: pending.recipe.outputs[0]?.itemId || null,
      quantity: pending.recipe.outputs[0]?.quantity || 0,
      qualityMultiplier: pending.qualityMultiplier,
      operationId: pending.operationId
    };
    const result = {
      ok: true,
      status: 'completed',
      operationId: pending.operationId,
      eventId: this._createEventId('production.completed', payload),
      ...clone(payload),
      experienceResult: clone(experienceResult)
    };
    this._remember(pending.operationId, pending.operationFingerprint, result);
    this._emit('productionCompleted', result);
    return clone(result);
  }

  cancel(stationId, reason = 'cancelled') {
    const pending = this.pending.get(normalizeId(stationId));
    if (!pending) return { ok: false, code: 'noPendingProduction' };
    return pending.status === 'refundPending'
      ? this.retryRefund(pending.stationId)
      : this._cancel(pending.stationId, pending, reason);
  }

  retryRefund(stationId) {
    const pending = this.pending.get(normalizeId(stationId));
    if (!pending || pending.status !== 'refundPending') {
      return { ok: false, code: 'noPendingRefund' };
    }
    return this._refundAndClose(pending.stationId, pending, pending.cancelReason || 'cancelled',
      pending.reservedItems, pending.reservedCosts);
  }

  captureRuntime() {
    return {
      pending: new Map([...this.pending].map(([id, value]) => [id, this._cloneRuntimePending(value)])),
      operations: new Map([...this.operations].map(([id, value]) => [id, clone(value)]))
    };
  }

  restoreRuntime(snapshot) {
    if (!(snapshot?.pending instanceof Map) || !(snapshot?.operations instanceof Map)) return false;
    this.pending = new Map([...snapshot.pending].map(([id, value]) => [id, this._cloneRuntimePending(value)]));
    this.operations = new Map([...snapshot.operations].map(([id, value]) => [id, clone(value)]));
    return true;
  }

  serialize() {
    return {
      schemaVersion: SNAPSHOT_VERSION,
      pending: [...this.pending.values()].map(value => ({
        ...this._describePending(value),
        characterId: value.characterId,
        definitionId: value.definitionId,
        entityId: value.entityId,
        materialOperationId: value.materialOperationId,
        operationFingerprint: value.operationFingerprint,
        reservedCosts: clone(value.reservedCosts),
        reservedItems: clone(value.reservedItems),
        failure: clone(value.failure),
        qualityMultiplier: value.qualityMultiplier,
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
    this.pending = prepared.pending;
    this.operations = prepared.operations;
    return { ok: true, errors: [] };
  }

  // ===== internals =====

  _finish(stationId, pending) {
    if (pending.failure?.outcome === 'failed') {
      return this._fail(stationId, pending);
    }
    pending.status = 'ready';
    const payload = this._describePending(pending);
    payload.pending = true;
    this._emit('productionReady', payload);
    return clone(payload);
  }

  _fail(stationId, pending) {
    // 失败只返还材料（工钱不退）；destroy_materials 不返还任何东西。
    const materialReserved = pending.reservedItems.filter(entry => entry.item?.id !== WAGE_ITEM_ID);
    const refundEntries = pending.failure.mode === 'partial_refund'
      ? materialReserved.map(entry => ({
        item: clone(entry.item),
        quantity: Math.floor(Number(entry.quantity) * clamp01(pending.failure.rate) || 0)
      })).filter(entry => entry.quantity > 0)
      : [];
    const refundCosts = pending.reservedCosts
      .filter(entry => entry.itemId !== WAGE_ITEM_ID)
      .map(entry => ({
        itemId: entry.itemId,
        quantity: Math.floor(Number(entry.quantity) * clamp01(pending.failure.rate) || 0)
      })).filter(entry => entry.quantity > 0);
    const closed = this._refundAndClose(stationId, pending, pending.failure.mode, refundEntries, refundCosts,
      'productionFailed');
    return closed;
  }

  _cancel(stationId, pending, reason) {
    pending.status = 'refundPending';
    pending.cancelReason = reason;
    return this._refundAndClose(stationId, pending, reason, pending.reservedItems, pending.reservedCosts);
  }

  _refundAndClose(stationId, pending, reason, refundItems, refundCosts, eventName = 'productionCancelled') {
    const refundId = `${pending.operationId}:refund`;
    const refunded = refundItems.length > 0
      ? this.inventoryTransactions.commit({
        type: 'batchAdd',
        inventory: pending.inventory,
        entries: refundItems,
        allowPartial: false,
        operationId: refundId
      })
      : { ok: true };
    if (!refunded.ok) {
      this.inventoryTransactions.forgetOperation?.(refundId);
      pending.status = 'refundPending';
      pending.cancelReason = reason;
      return { ok: false, code: 'refundPending', reason, status: 'refundPending', stationId };
    }
    this.pending.delete(stationId);
    const payload = {
      stationId,
      status: 'cancelled',
      operationId: pending.operationId,
      recipeId: pending.recipeId,
      reason,
      refundCosts: clone(refundCosts)
    };
    const result = {
      ok: true,
      status: 'cancelled',
      refunded: true,
      operationId: pending.operationId,
      eventId: this._createEventId('production.cancelled', payload),
      stationId,
      recipeId: pending.recipeId,
      refundCosts: clone(refundCosts)
    };
    this._remember(pending.operationId, pending.operationFingerprint, result);
    this._emit(eventName, result);
    return clone(result);
  }

  _rollJob(recipe) {
    const failureConfig = recipe.failure || null;
    let failure = null;
    if (failureConfig && Number(failureConfig.chance) > 0 && this.rng() < clamp01(failureConfig.chance)) {
      failure = {
        outcome: 'failed',
        mode: failureConfig.mode || 'partial_refund',
        rate: clamp01(failureConfig.rate ?? 0.5)
      };
    }
    const qualityConfig = recipe.quality;
    let qualityMultiplier = 1;
    if (qualityConfig && qualityConfig.mode === 'roll') {
      const min = Number.isFinite(Number(qualityConfig.min)) ? Number(qualityConfig.min) : 0.8;
      const max = Number.isFinite(Number(qualityConfig.max)) ? Number(qualityConfig.max) : 1.2;
      const step = Number(qualityConfig.step) > 0 ? Number(qualityConfig.step) : 0.05;
      const span = Math.max(0, max - min);
      const steps = span > 0 ? Math.round(span / step) : 0;
      const index = steps > 0 ? Math.min(steps, Math.floor(this.rng() * (steps + 1))) : 0;
      qualityMultiplier = Number((min + index * step).toFixed(4));
    }
    return { failure, qualityMultiplier };
  }

  _costsOf(recipe) {
    const costs = recipe.inputs.map(entry => ({ itemId: entry.itemId, quantity: entry.quantity }));
    const wage = Number(recipe.wage?.copper) || 0;
    if (wage > 0) costs.push({ itemId: WAGE_ITEM_ID, quantity: Math.floor(wage) });
    return costs;
  }

  _stationAllows(recipe, station) {
    const allowed = station?.station?.recipes;
    if (!Array.isArray(allowed)) return true; // 工位未声明允许清单 → 不限制
    return allowed.includes(recipe.id);
  }

  _requiredProficiency(recipe) {
    const value = recipe.requiredProficiency || {};
    return Math.max(0, Math.floor(Number(value[recipe.kind] ?? value.craft) || 0));
  }

  _experienceOf(recipe) {
    const value = recipe.experience || {};
    return Math.max(1, Math.floor(Number(value[recipe.kind] ?? value.craft) || 1));
  }

  _proficiencyLevel(characterId, kind) {
    return Number(this.proficiencySystem?.getState?.(characterId, kind)?.level) || 0;
  }

  _normalizeRecipe(source) {
    const id = normalizeId(source?.id);
    const station = normalizeId(source?.station);
    if (!id || !station) return null;
    const inputs = Array.isArray(source.inputs)
      ? source.inputs.map(entry => ({ itemId: normalizeId(entry?.itemId), quantity: Math.floor(Number(entry?.quantity) || 0) }))
      : [];
    const outputs = Array.isArray(source.outputs)
      ? source.outputs.map(entry => ({ itemId: normalizeId(entry?.itemId), quantity: Math.floor(Number(entry?.quantity) || 0) }))
      : [];
    if (inputs.some(entry => !entry.itemId || entry.quantity <= 0)) return null;
    if (outputs.some(entry => !entry.itemId || entry.quantity <= 0)) return null;
    const kind = normalizeId(source.kind) || 'craft';
    return {
      id,
      name: source.name || id,
      station,
      kind,
      duration: Math.max(0.1, Number(source.duration) || 1),
      inputs,
      outputs,
      wage: source.wage && typeof source.wage === 'object' ? clone(source.wage) : null,
      experience: source.experience && typeof source.experience === 'object' ? clone(source.experience) : null,
      requiredProficiency: source.requiredProficiency && typeof source.requiredProficiency === 'object'
        ? clone(source.requiredProficiency)
        : null,
      quality: source.quality && typeof source.quality === 'object' ? clone(source.quality) : null,
      failure: source.failure && typeof source.failure === 'object' ? clone(source.failure) : null
    };
  }

  _describePending(pending) {
    if (!pending) return null;
    return {
      jobId: pending.stationId,
      stationId: pending.stationId,
      recipeId: pending.recipeId,
      definitionId: pending.definitionId,
      entityId: pending.entityId,
      operationId: pending.operationId,
      status: pending.status,
      elapsed: pending.elapsed,
      duration: pending.duration,
      progress: pending.duration > 0 ? Math.min(1, pending.elapsed / pending.duration) : 1,
      outputs: clone(pending.recipe.outputs)
    };
  }

  _cloneRuntimePending(value) {
    return {
      ...value,
      inventory: value.inventory,
      recipe: clone(value.recipe),
      reservedCosts: clone(value.reservedCosts),
      reservedItems: clone(value.reservedItems),
      failure: clone(value.failure)
    };
  }

  _prepareSerialized(data, { resolveInventory = null } = {}) {
    const errors = [];
    if (!data || Number(data.schemaVersion) !== SNAPSHOT_VERSION) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: 'schemaVersion' }] };
    }
    if (!Array.isArray(data.pending) || !Array.isArray(data.operations)) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: '', message: '生产存档集合必须为数组' }] };
    }
    const pending = new Map();
    data.pending.forEach((source, index) => {
      const stationId = normalizeId(source?.stationId);
      const recipeId = normalizeId(source?.recipeId);
      const characterId = normalizeId(source?.characterId);
      const operationId = normalizeId(source?.operationId);
      const recipe = this.recipes.get(recipeId);
      const inventory = typeof resolveInventory === 'function'
        ? resolveInventory(characterId, clone(source))
        : null;
      if (!stationId || !characterId || !operationId || !recipe || !inventory
        || pending.has(stationId)) {
        errors.push({ code: 'invalidPendingProduction', path: `pending[${index}]` });
        return;
      }
      const duration = Number(source.duration);
      const elapsed = Number(source.elapsed);
      const status = ['active', 'ready', 'refundPending'].includes(source.status) ? source.status : 'active';
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(elapsed) || elapsed < 0) {
        errors.push({ code: 'invalidPendingTime', path: `pending[${index}]` });
        return;
      }
      pending.set(stationId, {
        characterId,
        inventory,
        recipe: clone(recipe),
        recipeId,
        stationId,
        definitionId: normalizeId(source.definitionId) || null,
        entityId: normalizeId(source.entityId) || null,
        operationId,
        operationFingerprint: normalizeId(source.operationFingerprint),
        materialOperationId: normalizeId(source.materialOperationId) || `${operationId}:materials`,
        elapsed: Math.min(duration, elapsed),
        duration,
        reservedCosts: clone(source.reservedCosts || this._costsOf(recipe)),
        reservedItems: clone(source.reservedItems || []),
        failure: clone(source.failure || null),
        qualityMultiplier: Number(source.qualityMultiplier) || 1,
        status,
        cancelReason: source.cancelReason || null
      });
    });
    if (errors.length) return { ok: false, errors };
    const operations = new Map();
    data.operations.forEach(source => {
      const operationId = normalizeId(source?.operationId);
      if (operationId) operations.set(operationId, { fingerprint: source.fingerprint, result: clone(source.result) });
    });
    return { ok: true, pending, operations, errors };
  }

  _createEventId(eventType, payload) {
    if (!this.createEventId) return null;
    try {
      return this.createEventId({ eventType, payload: clone(payload) }) || null;
    } catch (error) {
      console.warn('[ProductionSystem] 创建事件 ID 失败', { eventType, error });
      return null;
    }
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
      console.warn(`[ProductionSystem] ${event} listener failed`, error);
    }
  }
}

export default ProductionSystem;

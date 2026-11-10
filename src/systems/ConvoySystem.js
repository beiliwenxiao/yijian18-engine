/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 ************************************************************/

/************************************************************
 * 通用押运领域系统：模板装配（逻辑押运队绑定载具货舱）、装车、
 * 出发、到达卸货（个人背包 / 寨仓）、follow/hold/flee 指令、
 * 被抢按比例损失（胜 0 / 逃 30% / 败 50% / 载具毁 100%）、
 * 掉落投影与限时追回。
 *
 * 物理载具与护卫生成（M3 3A 薄适配）：本系统仍只持有业务状态——载具实体生成与
 * 地形落点校验经注入适配器（spawnVehicleEntity / resolveSpawnPosition）完成，
 * 引擎不依赖场景实体；货舱库存与目标容器全部由注入适配器提供。
 * 货物在「领用单 → 货舱 → 目标容器」之间只存一份，转移一律走
 * InventoryTransactionService。
 ************************************************************/

const SNAPSHOT_VERSION = 1;
const CONVOY_ORDERS = ['follow', 'hold', 'flee'];
const TERMINAL_STATUSES = new Set(['DELIVERED', 'LOST', 'DESTROYED']);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const normalizeId = value => typeof value === 'string' ? value.trim() : '';
const isPoint = value => !!value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y));
const VEHICLE_SPAWN_RADIUS = 24;
/** 非法落点就近采样：48px 内 8 方向 × 2 圈（内圈 24 / 外圈 48，2.5D 纵向压缩）。 */
const SPAWN_SAMPLE_RINGS = Object.freeze([24, 48]);
const SPAWN_SAMPLE_DIRECTIONS = 8;
const SPAWN_SAMPLE_Y_SQUASH = 0.75;
const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const positiveQuantity = value => {
  const number = Math.floor(Number(value) || 0);
  return number > 0 ? number : 0;
};

export class ConvoySystem {
  constructor({ inventoryTransactions, itemResolver = null, resolveTemplate = null,
    resolveOrder = null, notifyOrder = null, resolveStash = null, resolveCargo = null,
    resolveSpawnPosition = null, spawnVehicleEntity = null,
    onLootDrop = null, onEvent = null, createEventId = null, rng = null, getDay = () => 1,
    ambushConfig = {}, maxOperations = 256, maxConvoys = 128 } = {}) {
    if (!inventoryTransactions) throw new TypeError('ConvoySystem requires inventoryTransactions');
    this.inventoryTransactions = inventoryTransactions;
    this.itemResolver = typeof itemResolver === 'function' ? itemResolver : () => null;
    this.resolveTemplate = typeof resolveTemplate === 'function' ? resolveTemplate : () => null;
    this.resolveOrder = typeof resolveOrder === 'function' ? resolveOrder : () => null;
    this.notifyOrder = typeof notifyOrder === 'function' ? notifyOrder : null;
    this.resolveStash = typeof resolveStash === 'function' ? resolveStash : () => null;
    this.resolveCargo = typeof resolveCargo === 'function' ? resolveCargo : () => null;
    /** 场景侧落点校验适配器：(candidate, radius) => {x,y}|null|{ok,position}（模块 3 §6.1） */
    this.resolveSpawnPosition = typeof resolveSpawnPosition === 'function' ? resolveSpawnPosition : null;
    /** 场景侧载具生成适配器：({definitionId, position, convoyId, template}) => {ok, vehicleEntityId, cargoId} */
    this.spawnVehicleEntity = typeof spawnVehicleEntity === 'function' ? spawnVehicleEntity : null;
    this.onLootDrop = typeof onLootDrop === 'function' ? onLootDrop : null;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.createEventId = typeof createEventId === 'function' ? createEventId : null;
    this.rng = typeof rng === 'function' ? rng : () => Math.random();
    this.getDay = typeof getDay === 'function' ? getDay : () => 1;
    this.ambush = this._normalizeAmbush(ambushConfig);
    this.maxOperations = Math.max(16, Math.floor(Number(maxOperations) || 256));
    this.maxConvoys = Math.max(8, Math.floor(Number(maxConvoys) || 128));
    this.convoys = new Map();
    this.operations = new Map();
    this.sequence = 0;
    this._firstConvoyId = null;
  }

  /**
   * 装配：绑定模板与载具货舱，进入 STAGING 等装车。
   * 可选载具物理生成（模块 3 §6.1）：给 vehicleDefinitionId 时先生成载具实体，
   * 落点经 resolveSpawnPosition 校验（非法则就近 48px 内找可站立点），
   * 校验失败返回 {ok:false, code:'vehicleSpawnBlocked'}，不创建车队、不记住 operationId。
   */
  assemble({ templateId, convoyId, vehicleEntityId, cargoInventory, cargoId, escortIds,
    vehicleDefinitionId, position, spawnPosition, vehicleRadius, operationId } = {}) {
    const templateKey = normalizeId(templateId);
    const opId = normalizeId(operationId);
    const template = this._resolveTemplate(templateKey);
    if (!template) return { ok: false, code: 'unknownTemplate', templateId: templateKey };
    const id = normalizeId(convoyId) || `convoy:${++this.sequence}`;
    const normalizedVehicleId = normalizeId(vehicleEntityId);
    const normalizedCargoId = normalizeId(cargoId)
      || (normalizedVehicleId ? `${normalizedVehicleId}:cargo` : '');
    const vehicleDefId = normalizeId(vehicleDefinitionId);
    const spawnAnchor = isPoint(position) ? position : (isPoint(spawnPosition) ? spawnPosition : null);
    const fingerprint = JSON.stringify([
      'assemble', templateKey, normalizedVehicleId, normalizedCargoId, vehicleDefId,
      spawnAnchor ? [Math.round(spawnAnchor.x), Math.round(spawnAnchor.y)] : null
    ]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    const existing = this.convoys.get(id);
    if (existing) {
      return existing.templateId === templateKey
        ? { ok: true, convoyId: id, status: existing.status, idempotent: true }
        : { ok: false, code: 'duplicateConvoy', convoyId: id };
    }

    let resolvedVehicleId = normalizedVehicleId;
    let resolvedCargoId = normalizedCargoId;
    let resolvedSpawnPosition = null;
    if (!resolvedVehicleId && vehicleDefId) {
      const spawned = this._assembleVehicle({
        template,
        definitionId: vehicleDefId,
        convoyId: id,
        position,
        markerPosition: spawnPosition,
        radius: vehicleRadius
      });
      if (!spawned.ok) return spawned;
      resolvedVehicleId = spawned.vehicleEntityId;
      resolvedCargoId = resolvedCargoId || spawned.cargoId || '';
      resolvedSpawnPosition = spawned.position || null;
    }

    const cargo = cargoInventory
      || (resolvedCargoId && typeof this.resolveCargo === 'function' ? this.resolveCargo(resolvedCargoId) : null);
    if (!cargo) return { ok: false, code: 'cargoUnavailable', convoyId: id };

    const convoy = {
      convoyId: id,
      templateId: templateKey,
      vehicleEntityId: resolvedVehicleId || null,
      vehicleDefinitionId: vehicleDefId || null,
      spawnPosition: resolvedSpawnPosition,
      cargoId: resolvedCargoId || null,
      cargoInventory: cargo,
      escortIds: (Array.isArray(escortIds) ? escortIds : []).map(normalizeId).filter(Boolean),
      status: 'STAGING',
      order: 'follow',
      orderId: null,
      cargo: [],
      recoverable: [],
      ambushRolled: false
    };
    this.convoys.set(id, convoy);
    if (!this._firstConvoyId) this._firstConvoyId = id;
    this._trimConvoys();
    const result = { ok: true, convoyId: id, templateId: templateKey, status: 'STAGING' };
    this._remember(opId, fingerprint, result);
    this._emit('convoy.assembled', { convoyId: id, templateId: templateKey });
    return clone(result);
  }

  /**
   * 生成载具并校验落点（模块 3 §6.1）。
   * 失败返回明确 code：vehicleSpawnBlocked（落点非法/无候选点）或 vehicleSpawnUnavailable（缺生成适配器）。
   * @private
   */
  _assembleVehicle({ template, definitionId, convoyId, position, markerPosition, radius } = {}) {
    const resolved = this._resolveVehicleSpawnPoint(position, markerPosition, radius);
    if (!resolved.ok) return resolved;
    if (!this.spawnVehicleEntity) return { ok: false, code: 'vehicleSpawnUnavailable' };
    try {
      const spawned = this.spawnVehicleEntity({
        definitionId,
        position: resolved.position,
        convoyId,
        template
      });
      if (!spawned || spawned.ok === false || !spawned.vehicleEntityId) {
        return { ok: false, code: spawned?.code || 'vehicleSpawnUnavailable' };
      }
      return {
        ok: true,
        vehicleEntityId: normalizeId(spawned.vehicleEntityId),
        cargoId: normalizeId(spawned.cargoId) || `${spawned.vehicleEntityId}:cargo`,
        position: resolved.position
      };
    } catch (error) {
      return { ok: false, code: 'vehicleSpawnUnavailable', message: error?.message || '' };
    }
  }

  /**
   * 落点解析：候选点优先 position（调用方指定）→ markerPosition（放置点），
   * 逐个过 resolveSpawnPosition；全部非法时以最后一个候选点为圆心就近采样 8 方向 × 2 圈。
   * @private
   */
  _resolveVehicleSpawnPoint(position, markerPosition, radius = VEHICLE_SPAWN_RADIUS) {
    const candidates = [];
    if (isPoint(position)) candidates.push({ x: Number(position.x), y: Number(position.y) });
    if (isPoint(markerPosition)) candidates.push({ x: Number(markerPosition.x), y: Number(markerPosition.y) });
    if (candidates.length === 0) return { ok: false, code: 'vehicleSpawnBlocked' };
    // 未注入地形适配器：无地形场景按调用方落点原样放行（行为与旧版一致）
    if (!this.resolveSpawnPosition) return { ok: true, position: candidates[0] };
    for (const candidate of candidates) {
      const point = this._trySpawnPoint(candidate, radius);
      if (point) return { ok: true, position: point };
    }
    const origin = candidates[candidates.length - 1];
    for (const ring of SPAWN_SAMPLE_RINGS) {
      for (let i = 0; i < SPAWN_SAMPLE_DIRECTIONS; i += 1) {
        const angle = (Math.PI * 2 * i) / SPAWN_SAMPLE_DIRECTIONS;
        const point = this._trySpawnPoint({
          x: origin.x + Math.cos(angle) * ring,
          y: origin.y + Math.sin(angle) * ring * SPAWN_SAMPLE_Y_SQUASH
        }, radius);
        if (point) return { ok: true, position: point };
      }
    }
    return { ok: false, code: 'vehicleSpawnBlocked' };
  }

  /** @private 单点校验：适配器返回 true/point/{ok,position} 视为可用，null/{ok:false} 视为阻挡。 */
  _trySpawnPoint(candidate, radius) {
    try {
      const result = this.resolveSpawnPosition({ x: candidate.x, y: candidate.y }, radius);
      if (result === true) return { x: candidate.x, y: candidate.y };
      if (!result || result.ok === false) return null;
      if (isPoint(result.position)) return { x: Number(result.position.x), y: Number(result.position.y) };
      if (isPoint(result)) return { x: Number(result.x), y: Number(result.y) };
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 重新绑定货舱库存（读档后载具实体重建时由场景侧调用）。
   */
  bindCargo(convoyId, inventory) {
    const convoy = this.convoys.get(normalizeId(convoyId));
    if (!convoy || !inventory) return { ok: false, code: 'cargoUnavailable' };
    convoy.cargoInventory = inventory;
    return { ok: true };
  }

  /**
   * 装车：把 APPROVED 领用单的条目搬入货舱（只存一份）。
   */
  load({ convoyId, orderId, operationId } = {}) {
    const id = normalizeId(convoyId);
    const orderKey = normalizeId(orderId);
    const opId = normalizeId(operationId);
    const convoy = this.convoys.get(id);
    if (!convoy) return { ok: false, code: 'unknownConvoy', convoyId: id };
    if (!orderKey || !opId) return { ok: false, code: 'invalidInput' };
    if (convoy.status !== 'STAGING' && convoy.status !== 'LOADING') {
      return { ok: false, code: 'convoyNotLoading', convoyId: id, status: convoy.status };
    }
    if (!convoy.cargoInventory) return { ok: false, code: 'cargoUnavailable', convoyId: id };
    const fingerprint = JSON.stringify(['load', orderKey]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    const order = this._resolveOrder(orderKey);
    if (!order) return { ok: false, code: 'unknownOrder', orderId: orderKey };
    if (order.status !== 'APPROVED' && order.status !== 'LOADING') {
      return { ok: false, code: 'orderNotApproved', orderId: orderKey, status: order.status };
    }
    const quantities = this._orderEntries(order);
    if (quantities.length === 0) return { ok: false, code: 'orderEmpty', orderId: orderKey };
    const entries = [];
    for (const entry of quantities) {
      const item = this.itemResolver(entry.itemId);
      if (!item?.id) return { ok: false, code: 'unknownItem', itemId: entry.itemId };
      entries.push({ item: clone(item), quantity: entry.quantity });
    }
    const preview = this.inventoryTransactions.previewBatchAdd(convoy.cargoInventory, entries);
    if (preview.remainder > 0) {
      return { ok: false, code: 'cargoFull', convoyId: id, remainder: preview.remainder };
    }
    const committed = this.inventoryTransactions.commit({
      type: 'batchAdd',
      inventory: convoy.cargoInventory,
      entries,
      allowPartial: false,
      operationId: `${opId}:cargo`
    });
    if (!committed.ok) {
      this.inventoryTransactions.forgetOperation?.(`${opId}:cargo`);
      return { ok: false, code: 'cargoCommitFailed', reason: committed.code || null };
    }
    this._mergeCargo(convoy, quantities);
    convoy.status = 'LOADING';
    convoy.orderId = orderKey;
    this._notifyOrder(orderKey, 'LOADING', id);
    const result = { ok: true, convoyId: id, orderId: orderKey, loaded: clone(quantities), status: 'LOADING' };
    this._remember(opId, fingerprint, result);
    this._emit('convoy.loaded', { convoyId: id, orderId: orderKey, items: clone(quantities) });
    return clone(result);
  }

  /**
   * 出发：装车完成进入行军。
   */
  dispatch({ convoyId, operationId } = {}) {
    const id = normalizeId(convoyId);
    const convoy = this.convoys.get(id);
    if (!convoy) return { ok: false, code: 'unknownConvoy', convoyId: id };
    if (convoy.status !== 'LOADING' && convoy.status !== 'STAGING') {
      return { ok: false, code: 'convoyNotDispatchable', convoyId: id, status: convoy.status };
    }
    if (convoy.cargo.length === 0) return { ok: false, code: 'cargoEmpty', convoyId: id };
    const opId = normalizeId(operationId);
    const fingerprint = JSON.stringify(['dispatch']);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    convoy.status = 'MARCHING';
    if (convoy.orderId) this._notifyOrder(convoy.orderId, 'IN_TRANSIT', id);
    const result = { ok: true, convoyId: id, status: 'MARCHING' };
    this._remember(opId, fingerprint, result);
    this._emit('convoy.dispatched', { convoyId: id, orderId: convoy.orderId || null });
    return clone(result);
  }

  /**
   * 载具指令（状态层，移动/寻路归 M3/M4）：flee 立即按比例扣货。
   */
  setOrder({ convoyId, order, operationId } = {}) {
    const id = normalizeId(convoyId);
    const nextOrder = normalizeId(order);
    const convoy = this.convoys.get(id);
    if (!convoy) return { ok: false, code: 'unknownConvoy', convoyId: id };
    if (!CONVOY_ORDERS.includes(nextOrder)) return { ok: false, code: 'invalidOrder', order: nextOrder };
    if (TERMINAL_STATUSES.has(convoy.status)) {
      return { ok: false, code: 'convoyNotActive', convoyId: id, status: convoy.status };
    }
    const opId = normalizeId(operationId);
    const fingerprint = JSON.stringify(['order', nextOrder]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    const previous = convoy.order;
    convoy.order = nextOrder;
    let loss = { lost: [], lootDropped: [], recoverable: [] };
    if (nextOrder === 'flee' && previous !== 'flee') {
      const applied = this._applyLoss(convoy, this.ambush.fleeLossRatio, 'flee',
        opId || `convoy:${id}:flee:${++this.sequence}`);
      if (applied.ok === false) {
        convoy.order = previous;
        return applied;
      }
      loss = applied;
      if (loss.recoverable.length > 0) {
        this._emit('convoy.robbed', {
          convoyId: id,
          lost: clone(loss.lost),
          recoverable: clone(loss.recoverable),
          expiresDay: this._expiryOf(loss.recoverable)
        });
      }
    }
    const result = { ok: true, convoyId: id, order: nextOrder, loss: clone(loss) };
    this._remember(opId, fingerprint, result);
    this._emit('convoy.orderChanged', { convoyId: id, order: nextOrder });
    return clone(result);
  }

  /**
   * 伏击结算：win 0% / flee 30% / lose 50% / 载具毁 100%。
   * 真实战斗链在 M6 调用。
   */
  resolveAmbush({ convoyId, result = 'win', vehicleDestroyed = false, operationId } = {}) {
    const id = normalizeId(convoyId);
    const convoy = this.convoys.get(id);
    if (!convoy) return { ok: false, code: 'unknownConvoy', convoyId: id };
    const outcome = ['win', 'flee', 'lose'].includes(result) ? result : null;
    if (!outcome) return { ok: false, code: 'invalidResult', result };
    const opId = normalizeId(operationId);
    const fingerprint = JSON.stringify(['ambush', outcome, vehicleDestroyed === true]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    const ratio = vehicleDestroyed
      ? 1
      : (outcome === 'win' ? 0 : (outcome === 'flee' ? this.ambush.fleeLossRatio : this.ambush.defeatLossRatio));
    const applied = ratio > 0
      ? this._applyLoss(convoy, ratio, outcome, opId || `convoy:${id}:ambush:${++this.sequence}`)
      : { ok: true, lost: [], lootDropped: [], recoverable: [] };
    if (applied.ok === false) return applied;
    if (outcome === 'lose' || vehicleDestroyed) {
      convoy.status = vehicleDestroyed ? 'DESTROYED' : 'LOST';
      if (convoy.orderId) this._notifyOrder(convoy.orderId, 'LOST', id);
    }
    const resultPayload = {
      ok: true,
      convoyId: id,
      result: outcome,
      lost: clone(applied.lost),
      lootDropped: clone(applied.lootDropped),
      recoverable: clone(applied.recoverable),
      status: convoy.status
    };
    this._remember(opId, fingerprint, resultPayload);
    this._emit('convoy.ambushed', {
      convoyId: id,
      result: outcome,
      lost: clone(applied.lost),
      recoverable: clone(applied.recoverable)
    });
    if (applied.lost.length > 0) {
      this._emit('convoy.robbed', {
        convoyId: id,
        lost: clone(applied.lost),
        recoverable: clone(applied.recoverable),
        expiresDay: this._expiryOf(applied.recoverable)
      });
    }
    return clone(resultPayload);
  }

  /**
   * 追回：窗口内返还可追回条目到货舱。
   */
  recover({ convoyId, operationId } = {}) {
    const id = normalizeId(convoyId);
    const convoy = this.convoys.get(id);
    if (!convoy) return { ok: false, code: 'unknownConvoy', convoyId: id };
    const opId = normalizeId(operationId);
    const day = this._day();
    const valid = convoy.recoverable.filter(entry => Number(entry.expiresDay) >= day);
    convoy.recoverable = valid;
    if (valid.length === 0) return { ok: false, code: 'recoveryExpired', convoyId: id };
    if (!convoy.cargoInventory) return { ok: false, code: 'cargoUnavailable', convoyId: id };
    const fingerprint = JSON.stringify(['recover', clone(valid)]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    const entries = [];
    for (const entry of valid) {
      const item = this.itemResolver(entry.itemId);
      if (!item?.id) return { ok: false, code: 'unknownItem', itemId: entry.itemId };
      entries.push({ item: clone(item), quantity: entry.quantity });
    }
    const preview = this.inventoryTransactions.previewBatchAdd(convoy.cargoInventory, entries);
    if (preview.remainder > 0) return { ok: false, code: 'cargoFull', convoyId: id, remainder: preview.remainder };
    const committed = this.inventoryTransactions.commit({
      type: 'batchAdd',
      inventory: convoy.cargoInventory,
      entries,
      allowPartial: false,
      operationId: `${opId}:recover`
    });
    if (!committed.ok) {
      this.inventoryTransactions.forgetOperation?.(`${opId}:recover`);
      return { ok: false, code: 'cargoCommitFailed', reason: committed.code || null };
    }
    convoy.recoverable = [];
    const quantities = valid.map(entry => ({ itemId: entry.itemId, quantity: entry.quantity }));
    this._mergeCargo(convoy, quantities);
    const result = { ok: true, convoyId: id, recovered: clone(quantities) };
    this._remember(opId, fingerprint, result);
    this._emit('convoy.recovered', { convoyId: id, items: clone(quantities) });
    return clone(result);
  }

  /**
   * 卸货：personal 入玩家背包；stash 入指定寨仓。
   */
  unload({ convoyId, target = 'personal', stashId, inventory = null, operationId } = {}) {
    const id = normalizeId(convoyId);
    const convoy = this.convoys.get(id);
    if (!convoy) return { ok: false, code: 'unknownConvoy', convoyId: id };
    if (convoy.cargo.length === 0) return { ok: false, code: 'cargoEmpty', convoyId: id };
    if (!convoy.cargoInventory) return { ok: false, code: 'cargoUnavailable', convoyId: id };
    if (target !== 'personal' && target !== 'stash') return { ok: false, code: 'invalidTarget', target };
    let destination = inventory;
    if (target === 'stash') {
      const stash = this.resolveStash(normalizeId(stashId));
      destination = stash?.inventory || stash || null;
    }
    if (!destination) return { ok: false, code: 'inventoryUnavailable', target };
    const opId = normalizeId(operationId);
    const fingerprint = JSON.stringify(['unload', target, normalizeId(stashId)]);
    const known = this.operations.get(opId);
    if (known) {
      return known.fingerprint === fingerprint
        ? { ...clone(known.result), idempotent: true }
        : { ok: false, code: 'operationIdConflict', operationId: opId };
    }
    const quantities = convoy.cargo.map(entry => ({ itemId: entry.itemId, quantity: entry.quantity }));
    const entries = [];
    for (const entry of quantities) {
      const item = this.itemResolver(entry.itemId);
      if (!item?.id) return { ok: false, code: 'unknownItem', itemId: entry.itemId };
      entries.push({ item: clone(item), quantity: entry.quantity });
    }
    const preview = this.inventoryTransactions.previewBatchAdd(destination, entries);
    if (preview.remainder > 0) {
      return { ok: false, code: 'inventoryFull', target, remainder: preview.remainder };
    }
    const delivered = this.inventoryTransactions.commit({
      type: 'batchAdd',
      inventory: destination,
      entries,
      allowPartial: false,
      operationId: `${opId}:deliver`
    });
    if (!delivered.ok) {
      this.inventoryTransactions.forgetOperation?.(`${opId}:deliver`);
      return { ok: false, code: 'deliverCommitFailed', reason: delivered.code || null };
    }
    const removed = this.inventoryTransactions.commit({
      type: 'batchRemove',
      inventory: convoy.cargoInventory,
      entries: quantities,
      operationId: `${opId}:cargo`
    });
    if (!removed.ok) {
      const rollback = this.inventoryTransactions.commit({
        type: 'batchRemove',
        inventory: destination,
        entries,
        operationId: `${opId}:rollback`
      });
      if (!rollback.ok) this.inventoryTransactions.forgetOperation?.(`${opId}:rollback`);
      return { ok: false, code: 'cargoCommitFailed', reason: removed.code || null };
    }
    convoy.cargo = [];
    convoy.status = 'DELIVERED';
    if (convoy.orderId) this._notifyOrder(convoy.orderId, 'DELIVERED', id);
    const result = {
      ok: true,
      convoyId: id,
      target,
      stashId: target === 'stash' ? normalizeId(stashId) || null : null,
      delivered: clone(quantities),
      status: 'DELIVERED'
    };
    this._remember(opId, fingerprint, result);
    this._emit('convoy.arrived', { convoyId: id, stashId: result.stashId });
    return clone(result);
  }

  /**
   * 伏击掷骰（M6 战斗链调用；首单保护 + 护卫减伤）。
   */
  rollAmbush({ convoyId, escortCount = null } = {}) {
    const id = normalizeId(convoyId);
    const convoy = this.convoys.get(id);
    if (!convoy) return { ok: false, code: 'unknownConvoy', convoyId: id };
    if (this.ambush.firstConvoySafe && this._firstConvoyId === id && !convoy.ambushRolled) {
      convoy.ambushRolled = true;
      return { ok: true, ambushed: false, chance: 0, firstConvoy: true };
    }
    const escorts = escortCount == null
      ? (this._resolveTemplate(convoy.templateId)?.escort?.count || 0)
      : Number(escortCount) || 0;
    const chance = clamp01(this.ambush.baseChance
      - (escorts >= this.ambush.escortThreshold ? this.ambush.escortMitigation : 0));
    const roll = this.rng();
    convoy.ambushRolled = true;
    return { ok: true, ambushed: roll < chance, chance, roll };
  }

  getConvoy(convoyId) {
    const convoy = this.convoys.get(normalizeId(convoyId));
    if (!convoy) return null;
    const snapshot = clone(convoy);
    delete snapshot.cargoInventory;
    return snapshot;
  }

  listConvoys({ status = null } = {}) {
    return [...this.convoys.values()]
      .filter(convoy => !status || convoy.status === status)
      .map(convoy => {
        const snapshot = clone(convoy);
        delete snapshot.cargoInventory;
        return snapshot;
      });
  }

  captureRuntime() {
    return {
      sequence: this.sequence,
      firstConvoyId: this._firstConvoyId,
      convoys: new Map([...this.convoys].map(([key, value]) => [key, this._cloneConvoy(value)])),
      operations: new Map([...this.operations].map(([key, value]) => [key, clone(value)]))
    };
  }

  restoreRuntime(snapshot) {
    if (!(snapshot?.convoys instanceof Map) || !(snapshot?.operations instanceof Map)) return false;
    this.sequence = Math.max(0, Math.floor(Number(snapshot.sequence) || 0));
    this._firstConvoyId = normalizeId(snapshot.firstConvoyId) || null;
    this.convoys = new Map([...snapshot.convoys].map(([key, value]) => [key, this._cloneConvoy(value)]));
    this.operations = new Map([...snapshot.operations].map(([key, value]) => [key, clone(value)]));
    return true;
  }

  serialize() {
    return {
      schemaVersion: SNAPSHOT_VERSION,
      sequence: this.sequence,
      firstConvoyId: this._firstConvoyId,
      convoys: [...this.convoys.values()].map(convoy => {
        const snapshot = clone(convoy);
        delete snapshot.cargoInventory;
        return snapshot;
      }),
      operations: [...this.operations.entries()].map(([operationId, entry]) => ({
        operationId,
        fingerprint: entry.fingerprint,
        result: clone(entry.result)
      }))
    };
  }

  validateSerialized(data = {}) {
    const prepared = this._prepareSerialized(data);
    return prepared.ok ? { ok: true, errors: [] } : { ok: false, errors: prepared.errors };
  }

  deserialize(data = {}, { resolveCargo = null } = {}) {
    const prepared = this._prepareSerialized(data);
    if (!prepared.ok) return { ok: false, errors: prepared.errors };
    const resolver = typeof resolveCargo === 'function' ? resolveCargo : this.resolveCargo;
    for (const convoy of prepared.convoys.values()) {
      const cargo = convoy.cargoId && typeof resolver === 'function' ? resolver(convoy.cargoId) : null;
      convoy.cargoInventory = cargo || null;
    }
    this.sequence = prepared.sequence;
    this._firstConvoyId = prepared.firstConvoyId;
    this.convoys = prepared.convoys;
    this.operations = prepared.operations;
    return { ok: true, errors: [] };
  }

  // ===== internals =====

  _normalizeAmbush(config = {}) {
    const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return {
      baseChance: clamp01(numberOr(config.baseChance, 0.35)),
      escortMitigation: clamp01(numberOr(config.escortMitigation, 0.4)),
      escortThreshold: Math.max(1, Math.floor(numberOr(config.escortThreshold, 3))),
      fleeLossRatio: clamp01(numberOr(config.fleeLossRatio, 0.3)),
      defeatLossRatio: clamp01(numberOr(config.defeatLossRatio, 0.5)),
      vehicleDestroyChance: clamp01(numberOr(config.vehicleDestroyChance, 0.3)),
      recoverableRatio: clamp01(numberOr(config.recoverableRatio, 0.25)),
      lootDropRatio: clamp01(numberOr(config.lootDropRatio, 0.5)),
      recoveryWindowDays: Math.max(0, Math.floor(numberOr(config.recoveryWindowDays, 2))),
      firstConvoySafe: config.firstConvoySafe === true
    };
  }

  _resolveTemplate(templateId) {
    const key = normalizeId(templateId);
    if (!key) return null;
    const raw = this.resolveTemplate(key);
    const template = raw?.template || raw || null;
    if (!template || raw?.ok === false) return null;
    return template;
  }

  _resolveOrder(orderId) {
    const key = normalizeId(orderId);
    if (!key) return null;
    const raw = this.resolveOrder(key);
    if (!raw) return null;
    const order = raw.order || raw;
    return order && normalizeId(order.orderId) === key ? order : null;
  }

  _orderEntries(order) {
    const items = order?.items && typeof order.items === 'object' ? order.items : {};
    return Object.entries(items)
      .map(([itemId, quantity]) => ({ itemId: normalizeId(itemId), quantity: positiveQuantity(quantity) }))
      .filter(entry => entry.itemId && entry.quantity > 0);
  }

  _mergeCargo(convoy, entries) {
    for (const entry of entries) {
      const existing = convoy.cargo.find(row => row.itemId === entry.itemId);
      if (existing) existing.quantity += entry.quantity;
      else convoy.cargo.push({ itemId: entry.itemId, quantity: entry.quantity });
    }
  }

  /**
   * 按比例扣货：移除在途货物的 floor(ratio)，50% 转掉落投影、
   * 25% 记入限时追回（窗口按日）。返回失败时保持运行状态不变。
   */
  _applyLoss(convoy, ratio, reason, operationId) {
    const lost = [];
    for (const entry of convoy.cargo) {
      const quantity = Math.floor(entry.quantity * clamp01(ratio));
      if (quantity > 0) lost.push({ itemId: entry.itemId, quantity });
    }
    if (lost.length === 0) return { ok: true, lost: [], lootDropped: [], recoverable: [] };
    if (!convoy.cargoInventory) return { ok: false, code: 'cargoUnavailable', convoyId: convoy.convoyId };
    const removed = this.inventoryTransactions.commit({
      type: 'batchRemove',
      inventory: convoy.cargoInventory,
      entries: lost,
      operationId: `${operationId}:loss`
    });
    if (!removed.ok) {
      this.inventoryTransactions.forgetOperation?.(`${operationId}:loss`);
      return { ok: false, code: 'cargoCommitFailed', reason: removed.code || null };
    }
    for (const entry of lost) {
      const row = convoy.cargo.find(item => item.itemId === entry.itemId);
      if (!row) continue;
      row.quantity -= entry.quantity;
      if (row.quantity <= 0) convoy.cargo = convoy.cargo.filter(item => item !== row);
    }
    const lootDropped = lost
      .map(entry => ({ itemId: entry.itemId, quantity: Math.floor(entry.quantity * this.ambush.lootDropRatio) }))
      .filter(entry => entry.quantity > 0);
    const expiresDay = this._day() + this.ambush.recoveryWindowDays;
    const recoverable = lost
      .map(entry => ({
        itemId: entry.itemId,
        quantity: Math.floor(entry.quantity * this.ambush.recoverableRatio),
        expiresDay
      }))
      .filter(entry => entry.quantity > 0);
    if (lootDropped.length > 0) this._dropLoot(convoy, reason, lootDropped, expiresDay);
    for (const entry of recoverable) {
      const existing = convoy.recoverable.find(row => row.itemId === entry.itemId && row.expiresDay === expiresDay);
      if (existing) existing.quantity += entry.quantity;
      else convoy.recoverable.push({ ...entry });
    }
    return { ok: true, lost, lootDropped, recoverable };
  }

  _dropLoot(convoy, reason, entries, expiresDay) {
    const items = entries
      .map(entry => {
        const item = this.itemResolver(entry.itemId);
        return item?.id ? { item: clone(item), quantity: entry.quantity } : null;
      })
      .filter(Boolean);
    const payload = {
      convoyId: convoy.convoyId,
      reason,
      entries: clone(entries),
      items,
      expiresDay
    };
    try {
      this.onLootDrop?.(clone(payload));
    } catch (error) {
      console.warn('[ConvoySystem] 掉落投影回调失败', error);
    }
  }

  _notifyOrder(orderId, status, convoyId) {
    try {
      this.notifyOrder?.(orderId, status, { convoyId });
    } catch (error) {
      console.warn('[ConvoySystem] 订单状态回写失败', error);
    }
  }

  _expiryOf(entries) {
    return entries.reduce((max, entry) => Math.max(max, Number(entry.expiresDay) || 0), 0);
  }

  _day() {
    return Math.max(1, Math.floor(Number(this.getDay()) || 1));
  }

  _cloneConvoy(value) {
    return { ...clone(value), cargoInventory: value.cargoInventory || null };
  }

  _trimConvoys() {
    if (this.convoys.size <= this.maxConvoys) return;
    for (const [id, convoy] of this.convoys) {
      if (TERMINAL_STATUSES.has(convoy.status)) {
        this.convoys.delete(id);
        if (this.convoys.size <= this.maxConvoys) break;
      }
    }
  }

  _remember(operationId, fingerprint, result) {
    if (!operationId) return;
    this.operations.set(operationId, { fingerprint, result: clone(result) });
    while (this.operations.size > this.maxOperations) this.operations.delete(this.operations.keys().next().value);
  }

  _createEventId(eventType, payload) {
    if (!this.createEventId) return null;
    try {
      return this.createEventId({ eventType, payload: clone(payload) }) || null;
    } catch (error) {
      console.warn('[ConvoySystem] 创建事件 ID 失败', { eventType, error });
      return null;
    }
  }

  _emit(event, payload) {
    const data = clone(payload) || {};
    const eventId = this._createEventId(event, data);
    if (eventId) data.eventId = eventId;
    try {
      this.onEvent(event, data);
    } catch (error) {
      console.warn(`[ConvoySystem] ${event} listener failed`, error);
    }
  }

  _prepareSerialized(data) {
    const errors = [];
    if (!data || Number(data.schemaVersion) !== SNAPSHOT_VERSION) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: 'schemaVersion' }] };
    }
    if (!Array.isArray(data.convoys) || !Array.isArray(data.operations)) {
      return { ok: false, errors: [{ code: 'invalidSnapshot', path: '', message: '押运存档集合必须为数组' }] };
    }
    const convoys = new Map();
    data.convoys.forEach((source, index) => {
      const convoyId = normalizeId(source?.convoyId);
      const templateId = normalizeId(source?.templateId);
      const status = normalizeId(source?.status);
      if (!convoyId || !templateId || !status) {
        errors.push({ code: 'invalidConvoy', path: `convoys[${index}]` });
        return;
      }
      convoys.set(convoyId, {
        ...clone(source),
        convoyId,
        templateId,
        status,
        cargoId: normalizeId(source.cargoId) || null,
        orderId: normalizeId(source.orderId) || null,
        order: CONVOY_ORDERS.includes(source.order) ? source.order : 'follow',
        cargo: Array.isArray(source.cargo) ? clone(source.cargo) : [],
        recoverable: Array.isArray(source.recoverable) ? clone(source.recoverable) : [],
        cargoInventory: null
      });
    });
    if (errors.length) return { ok: false, errors };
    const operations = new Map();
    data.operations.forEach(source => {
      const operationId = normalizeId(source?.operationId);
      if (operationId) operations.set(operationId, { fingerprint: source.fingerprint, result: clone(source.result) });
    });
    return {
      ok: true,
      sequence: Math.max(0, Math.floor(Number(data.sequence) || 0)),
      firstConvoyId: normalizeId(data.firstConvoyId) || null,
      convoys,
      operations,
      errors: []
    };
  }
}

export default ConvoySystem;

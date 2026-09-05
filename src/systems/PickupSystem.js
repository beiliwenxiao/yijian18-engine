/**
 * PickupSystem 只负责候选检测与 item.pickup intent 转发。
 * 库存、世界实体、效果与反馈均由 ItemLifecycleService 在提交后处理。
 */
export class PickupSystem {
  constructor(config = {}) {
    this.pickupRadius = config.pickupRadius ?? 75;
    this.pickupCooldown = config.pickupCooldown ?? 300;
    this.pickupKey = config.pickupKey ?? 'e';
    this.lastPickupTime = Number.NEGATIVE_INFINITY;
    this.commandGateway = config.commandGateway || null;
    this.resolveActorId = config.resolveActorId || (entity => entity?.id || null);
    this.now = config.now || (() => globalThis.performance?.now?.() ?? 0);
    this.onResult = config.onResult || (() => {});
    this._requestSequence = 0;
    this.inputManager = null;
    this.weaponRenderer = null;
  }

  init(deps = {}) {
    this.inputManager = deps.inputManager || null;
    this.weaponRenderer = deps.weaponRenderer || null;
    this.commandGateway = deps.commandGateway || this.commandGateway;
    this.resolveActorId = deps.resolveActorId || this.resolveActorId;
    this.onResult = deps.onResult || this.onResult;
    this.now = deps.now || this.now;
    return this;
  }

  onPickup(callback) {
    this.onResult = typeof callback === 'function' ? callback : this.onResult;
  }

  update(playerEntity, pickupItems, equipmentItems) {
    if (!playerEntity || !this.inputManager) return this._emptyResult();
    const pressed = this.inputManager.isKeyDown(this.pickupKey)
      || this.inputManager.isKeyDown(this.pickupKey.toUpperCase());
    return pressed ? this._tryPickup(playerEntity, pickupItems, equipmentItems) : this._emptyResult();
  }

  triggerPickup(playerEntity, pickupItems, equipmentItems, request = {}) {
    return playerEntity
      ? this._tryPickup(playerEntity, pickupItems, equipmentItems, request)
      : this._emptyResult();
  }

  requestPickup({ playerEntity, pickupItems = [], equipmentItems = [], ...request } = {}) {
    return this.triggerPickup(playerEntity, pickupItems, equipmentItems, request);
  }

  _tryPickup(playerEntity, pickupItems = [], equipmentItems = [], request = {}) {
    const position = playerEntity.getComponent?.('transform')?.position;
    if (!position || !this.commandGateway) return this._emptyResult();
    const now = this.now();
    if (now - this.lastPickupTime < this.pickupCooldown) return this._emptyResult();

    const candidates = [];
    for (const item of [...pickupItems, ...equipmentItems]) {
      if (!item || item.picked) continue;
      const itemPosition = item.getComponent?.('transform')?.position || item;
      if (!Number.isFinite(itemPosition?.x) || !Number.isFinite(itemPosition?.y)) continue;
      const playerDistance = Math.hypot(itemPosition.x - position.x, itemPosition.y - position.y);
      if (playerDistance > this.pickupRadius) continue;
      candidates.push({
        item,
        playerDistance,
        stableId: String(item.placementId || item.entityId || item.id || ''),
        sequence: candidates.length
      });
    }
    candidates.sort((left, right) => {
      const distanceDifference = left.playerDistance - right.playerDistance;
      if (distanceDifference !== 0) return distanceDifference;
      const idDifference = left.stableId.localeCompare(right.stableId);
      return idDifference !== 0 ? idDifference : left.sequence - right.sequence;
    });

    let scheduled = 0;
    let executionQueue = Promise.resolve();
    const baseOperationId = request.operationId
      || `pickup:${this.resolveActorId(playerEntity)}:${++this._requestSequence}`;
    for (const { item } of candidates) {
      const groundId = item.placementId || item.entityId || item.id;
      if (!groundId) continue;
      const operationId = `${baseOperationId}:${groundId}`;
      const quantity = Math.max(1, Math.floor(Number(item.quantity
        ?? item.getComponent?.('itemProjection')?.quantity) || 1));
      const command = {
        intentType: 'item.pickup',
        actorRef: this.resolveActorId(playerEntity),
        operationId,
        payload: { groundId, quantity, checkpointId: request.checkpointId || null }
      };
      scheduled += 1;
      executionQueue = executionQueue
        .then(() => this.commandGateway.execute(command))
        .then(result => this.onResult(result, item, playerEntity))
        .catch(error => this.onResult(
          { ok: false, code: 'pickupCommandFailed', error },
          item,
          playerEntity
        ))
        .catch(() => undefined);
    }
    if (scheduled > 0) this.lastPickupTime = now;
    return { scheduled, pickedItems: [], removedEntities: [] };
  }

  _emptyResult() {
    return { scheduled: 0, pickedItems: [], removedEntities: [] };
  }

  checkWeaponPickup(playerEntity) {
    if (!this.weaponRenderer || !playerEntity) return false;
    return Boolean(this.weaponRenderer.retrieveWeapon(playerEntity));
  }
}

export default PickupSystem;

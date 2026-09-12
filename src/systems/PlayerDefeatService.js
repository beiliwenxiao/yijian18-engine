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

function isDroppableResource(item) {
  return item?.type === 'material' || String(item?.id || '').startsWith('resource.');
}

function buildLossDraft(inventory) {
  const byId = new Map();
  for (const stack of inventory?.slots || []) {
    if (!stack || !isDroppableResource(stack.item)) continue;
    const definitionId = stack.item.definitionId || stack.item.id;
    byId.set(definitionId, (byId.get(definitionId) || 0)
      + Math.max(0, Math.floor(Number(stack.quantity) || 0)));
  }
  return [...byId.entries()]
    .map(([definitionId, quantity], index) => ({
      id: `${definitionId}-${index}`,
      definitionId,
      quantity: Math.floor(quantity * 0.5)
    }))
    .filter(entry => entry.quantity > 0);
}

/** 玩家失败结算：普通死亡与特殊昏迷共用同一互斥、幂等入口。 */
export class PlayerDefeatService {
  constructor({ inventoryTransactions, entityFactory, entityStore, revivePlayer,
    reviveOptions = {}, respawnResolver = null, onResolved = null, getDeathDropPresentation = null } = {}) {
    if (!inventoryTransactions) throw new TypeError('PlayerDefeatService requires inventoryTransactions');
    this.inventoryTransactions = inventoryTransactions;
    this.entityFactory = entityFactory;
    this.entityStore = entityStore;
    this.revivePlayer = typeof revivePlayer === 'function' ? revivePlayer : () => {};
    this.reviveOptions = { ...reviveOptions };
    this.respawnResolver = typeof respawnResolver === 'function' ? respawnResolver : () => null;
    this.onResolved = typeof onResolved === 'function' ? onResolved : () => {};
    this.getDeathDropPresentation = typeof getDeathDropPresentation === 'function'
      ? getDeathDropPresentation
      : () => ({});
    this.resolvedDeathIds = new Set();
    this.nextDeathSequence = 1;
  }

  resolve({ player, deathId = null, resolution = { type: 'normalDeath' }, deferFinalize = false, deferRespawn = false } = {}) {
    if (!player) return { ok: false, code: 'invalidInput' };
    const stableDeathId = deathId || `player-death-${this.nextDeathSequence++}`;
    if (this.resolvedDeathIds.has(stableDeathId)) {
      return { ok: true, idempotent: true, deathId: stableDeathId };
    }
    deathId = stableDeathId;
    const type = resolution?.type === 'specialFaint' ? 'specialFaint' : 'normalDeath';
    const result = type === 'specialFaint'
      ? this._resolveSpecialFaint(player, deathId, resolution)
      : this._resolveNormalDeath(player, deathId);
    if (!result.ok) return result;
    this.resolvedDeathIds.add(deathId);
    const sequenceMatch = /^player-death-(\d+)$/.exec(deathId);
    if (sequenceMatch) this.nextDeathSequence = Math.max(this.nextDeathSequence, Number(sequenceMatch[1]) + 1);
    result.deferredRespawn = deferRespawn === true;
    result.respawnPosition = deferRespawn === true ? null : this._respawn(player, resolution);
    const finalize = () => {
      try { this.onResolved(result); } catch (error) {
        console.warn('PlayerDefeatService: onResolved failed', error);
      }
    };
    if (deferFinalize) result.finalize = finalize;
    else finalize();
    return result;
  }

  _resolveNormalDeath(player, deathId) {
    const inventory = player.getComponent?.('inventory');
    const transform = player.getComponent?.('transform');
    if (!inventory || !transform) return { ok: false, code: 'missingPlayerState' };
    const stacks = buildLossDraft(inventory);
    let drop = null;
    if (stacks.length > 0) {
      const presentation = this.getDeathDropPresentation({ player, deathId, stacks }) || {};
      drop = this.entityFactory?.createDeathDrop?.({
        ...presentation,
        id: `death-drop-${deathId}`,
        deathId,
        stacks,
        position: { x: transform.position.x, y: transform.position.y }
      });
      if (!drop) return { ok: false, code: 'dropCreationFailed' };
      const removal = this.inventoryTransactions.commit({
        type: 'batchRemove',
        inventory,
        entries: stacks.map(stack => ({ itemId: stack.definitionId, quantity: stack.quantity })),
        operationId: `death:${deathId}:remove`
      });
      if (!removal.ok) return { ...removal, code: removal.code || 'lossCommitFailed' };
      this.entityStore?.add?.(drop);
      this.entityStore?.addEquipmentItem?.(drop);
    }
    return { ok: true, type: 'normalDeath', deathId, drop, stacks };
  }

  _resolveSpecialFaint(_player, deathId, resolution) {
    return {
      ok: true,
      type: 'specialFaint',
      deathId,
      rescueType: resolution.rescueType || 'passerby',
      stacks: [],
      drop: null
    };
  }

  _respawn(player, resolution) {
    this.revivePlayer(player, this.reviveOptions);
    const position = this.respawnResolver({ player, resolution });
    const transform = player.getComponent?.('transform');
    if (transform && Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
      transform.position.x = position.x;
      transform.position.y = position.y;
      return { ...position };
    }
    return null;
  }

  /** 完成延迟复活：写回复活位置并恢复玩家状态；幂等要求 deathId 已结算。 */
  completeDeferredRespawn(player, deathId, position = null, resolution = { type: 'normalDeath' }) {
    if (!player || !deathId) return { ok: false, code: 'invalidInput' };
    if (!this.resolvedDeathIds.has(deathId)) return { ok: false, code: 'unknownDeath' };
    const target = Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? position
      : this.respawnResolver({ player, resolution });
    const transform = player.getComponent?.('transform');
    if (transform && Number.isFinite(target?.x) && Number.isFinite(target?.y)) {
      transform.position.x = target.x;
      transform.position.y = target.y;
    }
    this.revivePlayer(player, this.reviveOptions);
    return { ok: true, deathId, respawnPosition: target ? { ...target } : null };
  }

  serialize() {
    return {
      schemaVersion: 2,
      nextDeathSequence: this.nextDeathSequence,
      resolvedDeathIds: [...this.resolvedDeathIds]
    };
  }

  deserialize(data = {}) {
    this.resolvedDeathIds = new Set((data.resolvedDeathIds || []).filter(id => typeof id === 'string'));
    const highestPersistedSequence = [...this.resolvedDeathIds].reduce((highest, id) => {
      const match = /^player-death-(\d+)$/.exec(id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const savedNext = Math.max(1, Math.floor(Number(data.nextDeathSequence) || 1));
    this.nextDeathSequence = Math.max(savedNext, highestPersistedSequence + 1);
  }
}

export default PlayerDefeatService;

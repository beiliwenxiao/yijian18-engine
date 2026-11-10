/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * LootPickupBehavior - 敌对 NPC 拾取玩家倒地掉落（M3 3D）。
 *
 * 独立行为，不改变 AISystem 主循环：
 * - 只拾 `downedDrop === true` 的玩家掉落（D7 拍板），不碰怪物战利品；
 * - 距离 ≤ radius 的最近目标优先，`maxCarried` 限制携带条目；
 * - 拾取后并入 `npc._carriedLoot`，同时 upsert 到 `npc.lootTable`（chance:1），
 *   击杀时由既有 CombatSystem.generateLoot 原样返还，无需改动掉落链。
 */

export const DEFAULT_LOOT_PICKUP_CONFIG = Object.freeze({
  radius: 90,
  maxCarried: 6
});

function positionOf(entity) {
  return entity?.getComponent?.('transform')?.position || entity?.position || null;
}

function distanceSquared(a, b) {
  const dx = (Number(a?.x) || 0) - (Number(b?.x) || 0);
  const dy = (Number(a?.y) || 0) - (Number(b?.y) || 0);
  return dx * dx + dy * dy;
}

/** 从地面投影实体读取可拾取内容；非物品投影返回 null。 */
export function readGroundLoot(entity) {
  const projection = entity?.getComponent?.('itemProjection');
  if (!projection?.definitionId) return null;
  return {
    definitionId: projection.definitionId,
    quantity: Math.max(1, Math.floor(Number(projection.quantity) || 1)),
    instanceId: projection.instanceId || null,
    mutable: projection.mutable ? { ...projection.mutable } : null
  };
}

export class LootPickupBehavior {
  constructor(options = {}) {
    this.radius = Number(options.radius) > 0 ? Number(options.radius) : DEFAULT_LOOT_PICKUP_CONFIG.radius;
    this.maxCarried = Number(options.maxCarried) > 0 ? Number(options.maxCarried) : DEFAULT_LOOT_PICKUP_CONFIG.maxCarried;
    this.isHostile = typeof options.isHostile === 'function' ? options.isHostile : npc => npc?.faction === 'enemy';
    this.publishEvent = typeof options.publishEvent === 'function' ? options.publishEvent : null;
    this._sequence = 0;
  }

  /**
   * 单帧拾取扫描。
   * @param {{npcs?: Array, groundItems?: Array, removeGroundItem?: Function}} request
   * @returns {{ok: boolean, picked: Array}}
   */
  update({ npcs = [], groundItems = [], removeGroundItem = null } = {}) {
    const picked = [];
    const claimed = new Set();
    for (const npc of Array.isArray(npcs) ? npcs : []) {
      if (!npc || npc.isDead || npc.isDying || npc.plotDowned) continue;
      if (npc.type === 'player') continue;
      if (!this.isHostile(npc)) continue;
      const carried = this.carriedLootOf(npc);
      if (carried.length >= this.maxCarried) continue;
      const npcPosition = positionOf(npc);
      if (!npcPosition) continue;
      const target = this._findTarget(npc, npcPosition, groundItems, claimed);
      if (!target) continue;
      claimed.add(target.entity);
      const loot = readGroundLoot(target.entity);
      if (!loot) continue;
      removeGroundItem?.(target.entity);
      target.entity.picked = true;
      this._carry(npc, loot);
      picked.push({
        npcId: npc.id || null,
        entityId: target.entity.id || null,
        definitionId: loot.definitionId,
        quantity: loot.quantity
      });
    }
    if (picked.length > 0) this._publish(picked);
    return { ok: true, picked };
  }

  /** 读取（并按需初始化）NPC 携带清单。 */
  carriedLootOf(npc) {
    if (!npcsCarryLoot(npc)) npc._carriedLoot = [];
    return npc._carriedLoot;
  }

  clearCarried(npc) {
    if (npcsCarryLoot(npc)) npc._carriedLoot = [];
    return npc;
  }

  /** @private */
  _findTarget(npc, npcPosition, groundItems, claimed) {
    const radiusSquared = this.radius * this.radius;
    let best = null;
    for (const entity of Array.isArray(groundItems) ? groundItems : []) {
      if (!entity || entity.picked || claimed.has(entity)) continue;
      if (entity.downedDrop !== true) continue;
      if (!entity.ownerId || entity.ownerId === npc.id) continue;
      const position = positionOf(entity);
      if (!position) continue;
      const distance = distanceSquared(npcPosition, position);
      if (distance > radiusSquared) continue;
      if (!best || distance < best.distance) best = { entity, distance };
    }
    return best;
  }

  /** @private 并入携带清单 + upsert lootTable（同定义合并数量）。 */
  _carry(npc, loot) {
    const carried = this.carriedLootOf(npc);
    const existing = carried.find(entry => entry.definitionId === loot.definitionId && entry.instanceId === loot.instanceId);
    if (existing) {
      existing.quantity += loot.quantity;
    } else {
      carried.push({ ...loot });
    }
    if (!Array.isArray(npc.lootTable)) npc.lootTable = [];
    const total = carried
      .filter(entry => entry.definitionId === loot.definitionId)
      .reduce((sum, entry) => sum + Math.max(1, Number(entry.quantity) || 1), 0);
    const tableEntry = npc.lootTable.find(entry => entry?.source === 'npcPickup' && entry.itemId === loot.definitionId);
    if (tableEntry) {
      tableEntry.minQuantity = total;
      tableEntry.maxQuantity = total;
    } else {
      npc.lootTable.push({
        itemId: loot.definitionId,
        chance: 1,
        minQuantity: loot.quantity,
        maxQuantity: loot.quantity,
        source: 'npcPickup'
      });
    }
  }

  /** @private */
  _publish(picked) {
    if (!this.publishEvent) return;
    try {
      this.publishEvent('npc.lootPicked', { picked }, `npc-loot-picked:${++this._sequence}`);
    } catch (error) {
      console.warn('LootPickupBehavior: 事件发布失败', error);
    }
  }
}

function npcsCarryLoot(npc) {
  return Array.isArray(npc?._carriedLoot);
}

export default LootPickupBehavior;

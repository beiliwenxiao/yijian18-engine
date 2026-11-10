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
 * DownedDropService - 玩家倒地掉落（M3 3D）。
 *
 * 语义（decisions.md P8）：
 * - 战斗倒地从背包随机抽 1~3 件，装备优先、材料补足，零损耗；
 * - 已穿戴装备不掉，货币与任务物品不掉；
 * - `cause:'story'`（剧情豁免）整体跳过；
 * - 掉落物带 `ownerId` 与 `expiresAtDay`（默认 2 个游戏日）；
 * - 夺回时按背包容量部分入包，返回未入包余量由调用方保留在地面。
 *
 * 纯领域服务：不依赖场景、ECS 与浏览器；掉落实体生成/移除走注入适配器。
 */

import { normalizeItemRuntimeState } from './items/ItemRuntimeState.js';

export const DOWNED_DROP_EVENT = Object.freeze({
  DROPPED: 'player.downedDropped',
  RECOVERED: 'player.lootRecovered'
});

export const DEFAULT_DOWNED_DROP_CONFIG = Object.freeze({
  minItems: 1,
  maxItems: 3,
  lossRatio: 0,
  includeCurrency: false,
  plotExempt: true,
  ownerExpiryDays: 2,
  spreadRadius: 12
});

const EQUIPMENT_TYPES = new Set([
  'equipment', 'weapon', 'armor', 'helmet', 'boots', 'gloves', 'accessory', 'ring', 'necklace', 'belt'
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isCurrencyItem(item, definitionId) {
  return item?.type === 'currency'
    || item?.isCurrency === true
    || String(definitionId || '').startsWith('currency.');
}

function isEquipmentItem(item) {
  return EQUIPMENT_TYPES.has(item?.type)
    || item?.equipment === true
    || Boolean(item?.equipmentSlot)
    || (item?.type === 'equipment');
}

/** 已穿戴物品的实例/定义集合：实例优先，只有定义无实例时按定义排除。 */
function collectEquippedKeys(equipment) {
  const instanceIds = new Set();
  const definitionIds = new Set();
  for (const entry of Object.values(equipment?.slots || {})) {
    if (!entry) continue;
    if (typeof entry.instanceId === 'string' && entry.instanceId) instanceIds.add(entry.instanceId);
    else if (typeof entry.id === 'string' && entry.id) definitionIds.add(entry.id);
  }
  return { instanceIds, definitionIds };
}

export class DownedDropService {
  constructor(options = {}) {
    this.getInventory = typeof options.getInventory === 'function' ? options.getInventory : player => player?.getComponent?.('inventory') || null;
    this.getEquipment = typeof options.getEquipment === 'function' ? options.getEquipment : player => player?.getComponent?.('equipment') || null;
    this.resolveItem = typeof options.resolveItem === 'function' ? options.resolveItem : null;
    this.createGroundDrop = typeof options.createGroundDrop === 'function' ? options.createGroundDrop : null;
    this.removeGroundDrop = typeof options.removeGroundDrop === 'function' ? options.removeGroundDrop : null;
    this.publishEvent = typeof options.publishEvent === 'function' ? options.publishEvent : null;
    this.getDay = typeof options.getDay === 'function' ? options.getDay : () => 0;
    this.rng = typeof options.rng === 'function' ? options.rng : Math.random;
    this.config = { ...DEFAULT_DOWNED_DROP_CONFIG, ...(options.config || {}) };
    this._sequence = 0;
  }

  /**
   * 倒地掉落：从背包抽 1~3 件，移除并生成地面投影。
   * @param {{player: Object, cause?: 'combat'|'story', position?: {x:number,y:number}}} request
   * @returns {{ok: boolean, code?: string, exempt?: boolean, count: number, dropped: Array}}
   */
  dropAll({ player = null, cause = 'combat', position = null } = {}) {
    const normalizedCause = cause === 'story' ? 'story' : 'combat';
    if (normalizedCause === 'story' && this.config.plotExempt !== false) {
      return { ok: true, exempt: true, count: 0, dropped: [] };
    }
    const inventory = this.getInventory(player);
    if (!inventory || !Array.isArray(inventory.slots)) {
      return { ok: false, code: 'inventoryUnavailable', count: 0, dropped: [] };
    }
    const candidates = this._collectCandidates(inventory, this.getEquipment(player));
    if (candidates.length === 0) return { ok: true, count: 0, dropped: [] };

    const count = this._rollCount(candidates.length);
    const chosen = this._choose(candidates, count);
    const origin = position || this._playerPosition(player);
    const day = Number(this.getDay()) || 0;
    const dropped = [];
    for (const candidate of chosen) {
      const entry = this._materializeDrop({ player, candidate, inventory, origin, day, cause: normalizedCause });
      if (entry) dropped.push(entry);
    }
    if (dropped.length > 0) {
      this._publish(DOWNED_DROP_EVENT.DROPPED, {
        playerId: player?.id || null,
        cause: normalizedCause,
        items: dropped.map(entry => ({
          entityId: entry.entityId,
          definitionId: entry.definitionId,
          quantity: entry.quantity
        }))
      }, `downed-drop:${player?.id || 'player'}:${day}:${++this._sequence}`);
    }
    return { ok: true, count: dropped.length, dropped };
  }

  /**
   * 夺回：把掉落条目放回背包；背包不足的余量返回给调用方留在地面。
   * @param {{player: Object, entries: Array}} request
   */
  recover({ player = null, entries = [] } = {}) {
    const inventory = this.getInventory(player);
    if (!inventory || typeof inventory.addItem !== 'function') {
      return { ok: false, code: 'inventoryUnavailable', accepted: [], remainder: [] };
    }
    const accepted = [];
    const remainder = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const definitionId = entry?.definitionId || entry?.item?.definitionId || entry?.item?.id;
      const quantity = Math.max(0, Math.floor(Number(entry?.quantity) || 0));
      if (!definitionId || quantity <= 0) continue;
      const item = this._buildInventoryItem(definitionId, entry);
      const added = Math.max(0, Number(inventory.addItem(item, quantity)) || 0);
      if (added > 0) accepted.push({ definitionId, quantity: added });
      if (added < quantity) remainder.push({ ...entry, definitionId, quantity: quantity - added });
    }
    if (accepted.length > 0) {
      this._publish(DOWNED_DROP_EVENT.RECOVERED, {
        playerId: player?.id || null,
        items: accepted
      }, `loot-recovered:${player?.id || 'player'}:${++this._sequence}`);
    }
    return { ok: true, accepted, remainder };
  }

  /**
   * 到期清理：`day >= expiresAtDay` 的掉落移除。
   * @param {{day: number, drops: Array}} request
   */
  expire({ day = 0, drops = [] } = {}) {
    const currentDay = Number(day) || 0;
    const removed = [];
    for (const drop of Array.isArray(drops) ? drops : []) {
      const expiresAtDay = Number(drop?.expiresAtDay);
      if (!Number.isFinite(expiresAtDay) || currentDay < expiresAtDay) continue;
      this.removeGroundDrop?.(drop);
      removed.push(drop?.id ?? null);
    }
    return { ok: true, removed };
  }

  /** @private */
  _collectCandidates(inventory, equipment) {
    const { instanceIds, definitionIds } = collectEquippedKeys(equipment);
    const candidates = [];
    inventory.slots.forEach((slot, slotIndex) => {
      const item = slot?.item;
      if (!item) return;
      const definitionId = item.definitionId || item.id;
      if (!definitionId) return;
      if (!this.config.includeCurrency && isCurrencyItem(item, definitionId)) return;
      if (item.questItem === true) return;
      if (item.instanceId && instanceIds.has(item.instanceId)) return;
      if (!item.instanceId && definitionIds.has(definitionId)) return;
      candidates.push({
        slotIndex,
        item,
        definitionId,
        quantity: Math.max(1, Math.floor(Number(slot.quantity) || 1)),
        equipment: isEquipmentItem(item)
      });
    });
    return candidates;
  }

  /** @private */
  _rollCount(maxAvailable) {
    const min = clamp(Math.floor(Number(this.config.minItems) || 0), 1, maxAvailable);
    const max = clamp(Math.floor(Number(this.config.maxItems) || min), min, maxAvailable);
    if (max <= min) return min;
    return clamp(min + Math.floor(this.rng() * (max - min + 1)), min, max);
  }

  /** @private 装备优先，材料补足；两组各自乱序。 */
  _choose(candidates, count) {
    const equipment = candidates.filter(entry => entry.equipment);
    const material = candidates.filter(entry => !entry.equipment);
    return [...this._shuffle(equipment), ...this._shuffle(material)].slice(0, count);
  }

  /** @private */
  _shuffle(list) {
    const result = list.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /** @private */
  _dropQuantity(quantity) {
    const ratio = clamp(Number(this.config.lossRatio) || 0, 0, 1);
    if (ratio <= 0) return quantity;
    return Math.floor(quantity * (1 - ratio));
  }

  /** @private */
  _materializeDrop({ player, candidate, inventory, origin, day, cause }) {
    const item = candidate.item;
    const requested = item.instanceId ? 1 : this._dropQuantity(candidate.quantity);
    if (requested <= 0) return null;
    const removed = typeof inventory.removeFromSlot === 'function'
      ? inventory.removeFromSlot(candidate.slotIndex, requested)
      : null;
    if (!removed) return null;

    const runtimeState = { definitionId: candidate.definitionId, quantity: requested };
    if (item.instanceId) {
      runtimeState.instanceId = item.instanceId;
      runtimeState.mutable = { ...(item.mutable || {}) };
      for (const key of ['durability', 'binding', 'charges', 'container']) {
        if (item[key] !== undefined) runtimeState.mutable[key] = item[key];
      }
      runtimeState.quantity = 1;
    }
    const position = this._spreadPosition(origin);
    const entityId = `downed-drop-${player?.id || 'player'}-${day}-${++this._sequence}`;
    let entity = null;
    if (this.createGroundDrop) {
      try {
        entity = this.createGroundDrop({ entityId, runtimeState: normalizeItemRuntimeState(runtimeState), transform: position });
      } catch (error) {
        console.warn('DownedDropService: 掉落投影生成失败，物品返回背包', error);
      }
    }
    if (!entity) {
      inventory.addItem?.(item, requested);
      return null;
    }
    entity.ownerId = player?.id || null;
    entity.downedDrop = true;
    entity.droppedAtDay = day;
    entity.expiresAtDay = day + Math.max(0, Number(this.config.ownerExpiryDays) || 0);
    entity.downedDropCause = cause;
    return {
      entityId: entity.id || entityId,
      definitionId: candidate.definitionId,
      quantity: requested,
      entity
    };
  }

  /** @private */
  _buildInventoryItem(definitionId, entry) {
    const resolved = this.resolveItem?.(definitionId) || {};
    const item = {
      ...resolved,
      id: resolved.id || definitionId,
      definitionId,
      maxStack: entry?.instanceId ? 1 : Math.max(1, Number(resolved.maxStack) || 1)
    };
    if (entry?.instanceId) {
      item.instanceId = entry.instanceId;
      item.mutable = { ...(entry.mutable || {}) };
    }
    return item;
  }

  /** @private */
  _playerPosition(player) {
    const position = player?.getComponent?.('transform')?.position || player?.position || null;
    return {
      x: Number(position?.x) || 0,
      y: Number(position?.y) || 0
    };
  }

  /** @private */
  _spreadPosition(origin) {
    const radius = Math.max(0, Number(this.config.spreadRadius) || 0);
    if (radius <= 0) return { x: origin.x, y: origin.y };
    const angle = this.rng() * Math.PI * 2;
    const distance = radius * (0.35 + this.rng() * 0.65);
    return {
      x: origin.x + Math.cos(angle) * distance,
      y: origin.y + Math.sin(angle) * distance
    };
  }

  /** @private */
  _publish(event, payload, operationId) {
    if (!this.publishEvent) return;
    try {
      this.publishEvent(event, payload, operationId ? { operationId } : undefined);
    } catch (error) {
      console.warn('DownedDropService: 事件发布失败', error);
    }
  }
}

export default DownedDropService;

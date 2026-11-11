/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://github.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * CampStockContainerAdapter - 军营粮草容器（M9 9B）与 CargoTransferView 的接线适配器。
 *
 * 权威数据仍在 FoodLedgerSystem：军营库存 camp.stock、军团随身粮 army.supply.food。
 * 本适配器只做两件事：
 * 1. 按 CargoTransferView 的快照契约导出「军团粮草 ↔ 军营存粮」两侧面板；
 * 2. 把面板转移命令翻译为 FoodLedgerSystem.deposit / withdraw。
 *
 * 目前只开放粮草（food）——deposit/withdraw 对非食物资源没有扣减来源，
 * 放开会让资源凭空增减，因此显式拒绝其它资源。
 */

const RESOURCE_LABELS = Object.freeze({ food: '粮草', wood: '木料', iron: '铁料' });
const FOOD_ITEM_ID = 'resource.food';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resourceItemId(resource) {
  return `resource.${resource}`;
}

function parseResource(itemId) {
  const matched = /^resource\.([a-z_]+)$/i.exec(String(itemId || ''));
  return matched ? matched[1].toLowerCase() : null;
}

export class CampStockContainerAdapter {
  constructor({ foodLedger = null, campId = null, nonce = 'camp' } = {}) {
    if (!foodLedger || typeof foodLedger.deposit !== 'function') {
      throw new TypeError('CampStockContainerAdapter requires a FoodLedgerSystem');
    }
    if (campId == null || !String(campId)) throw new TypeError('CampStockContainerAdapter requires a campId');
    this.foodLedger = foodLedger;
    this.campId = String(campId);
    this.nonce = String(nonce || 'camp');
    this._sequence = 0;
  }

  getCamp() {
    return this.foodLedger.getCamp?.(this.campId) || null;
  }

  /** 容器契约：军营库存 → 物品数组（CargoTransferView 右侧面板）。 */
  exportItems() {
    const camp = this.getCamp();
    return Object.entries(camp?.stock || {})
      .map(([resource, amount]) => ({
        itemId: resourceItemId(resource),
        name: RESOURCE_LABELS[resource] || resource,
        quantity: Math.max(0, Math.floor(toNumber(amount, 0)))
      }))
      .filter(entry => entry.quantity > 0);
  }

  /** 容器契约：物品数组 → 军营库存（注册表恢复路径；军营权威在 FoodLedger，正常不调用）。 */
  loadItems(items = []) {
    const camp = this.foodLedger.camps?.get?.(this.campId) || null;
    if (!camp) return { ok: false, code: 'unknownCamp', campId: this.campId };
    const stock = {};
    for (const entry of Array.isArray(items) ? items : []) {
      const resource = parseResource(entry?.itemId);
      if (!resource) continue;
      stock[resource] = Math.max(0, Math.floor(toNumber(entry?.quantity, 0)));
    }
    camp.stock = stock;
    return { ok: true, camp: this.getCamp() };
  }

  /** 每次转移独立幂等键：boot nonce 避免读档后序号重置撞上旧账本。 */
  nextOperationId() {
    this._sequence += 1;
    return `camp-supply:${this.campId}:${this.nonce}:${this._sequence}`;
  }

  /**
   * CargoTransferView 快照：左「军团粮草」、右「军营存粮」。
   * @param {Object} options
   * @param {Object|null} [options.army] - 军团账本对象（读 supply.food）
   * @param {'toCargo'|'toInventory'} [options.direction]
   * @param {string} [options.statusMessage]
   * @param {'info'|'error'} [options.statusType]
   */
  buildSnapshot({ army = null, direction = null, statusMessage = '', statusType = 'info' } = {}) {
    const camp = this.getCamp();
    const armyFood = Math.max(0, Math.floor(toNumber(army?.supply?.food, 0)));
    const cargoItems = this.exportItems();
    return {
      campId: this.campId,
      title: `军营 ${this.campId} · 粮草`,
      storageLabel: '军营',
      inventoryLabel: '军团粮草',
      direction: direction === 'toInventory' ? 'toInventory' : 'toCargo',
      inventory: {
        items: armyFood > 0
          ? [{ itemId: FOOD_ITEM_ID, name: RESOURCE_LABELS.food, quantity: armyFood }]
          : [],
        usedSlots: armyFood > 0 ? 1 : 0,
        maxSlots: 1
      },
      cargo: {
        items: cargoItems,
        total: cargoItems.reduce((total, entry) => total + entry.quantity, 0),
        capacity: Math.max(0, Math.floor(toNumber(camp?.capacity, 0)))
      },
      statusMessage,
      statusType
    };
  }

  /**
   * 面板转移命令 → 军营存取。
   * @param {Object} options
   * @param {string} [options.armyId]
   * @param {'toCargo'|'toInventory'} [options.direction] - toCargo=存入军营，toInventory=取回军团
   * @param {string} [options.itemId] - 仅支持 resource.food
   * @param {number} [options.quantity]
   * @param {string|null} [options.operationId]
   */
  transfer({ armyId = null, direction = 'toCargo', itemId = FOOD_ITEM_ID, quantity = 0, operationId = null } = {}) {
    const resource = parseResource(itemId);
    if (resource !== 'food') return { ok: false, code: 'unsupportedResource', itemId };
    const amount = Math.floor(toNumber(quantity, 0));
    if (amount <= 0) return { ok: false, code: 'invalidQuantity', quantity };
    const entries = { food: amount };
    const opId = operationId != null ? String(operationId) : this.nextOperationId();
    const result = direction === 'toInventory'
      ? this.foodLedger.withdraw({ armyId, campId: this.campId, entries, operationId: opId })
      : this.foodLedger.deposit({ armyId, campId: this.campId, entries, operationId: opId });
    return { ...result, direction: direction === 'toInventory' ? 'toInventory' : 'toCargo', operationId: opId };
  }
}

export default CampStockContainerAdapter;

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

const DEFAULT_AMMO_ITEM = 'wooden_arrow';

/**
 * 箭矢消耗服务（P16）。
 *
 * 仅在武器物品声明 `ammo` 时生效：
 *   `"ammo": { "itemId": "wooden_arrow", "perShot": 1 }`
 * 玩家从背包扣（InventoryTransactionService），NPC 从 `entity.ammoCount` 扣；
 * 两者都没有或数量不足 → `outOfAmmo`，本次远程攻击不结算。
 * 未声明 `ammo` 的武器恒为 skipped（旧兵种/旧武器零变化）。
 */
export class AmmoService {
  constructor({ inventoryTransactions = null, resolveInventory = null } = {}) {
    this.inventoryTransactions = inventoryTransactions;
    this.resolveInventory = typeof resolveInventory === 'function'
      ? resolveInventory
      : entity => entity?.getComponent?.('inventory') || null;
  }

  /**
   * 从实体已装备物品中挑出声明了 ammo 的武器。
   * @param {Entity} entity
   * @returns {Object|null} 武器物品实例
   */
  resolveAmmoWeapon(entity) {
    const equipment = entity?.getComponent?.('equipment');
    const all = equipment?.getAllEquipment?.() || {};
    for (const slotType in all) {
      const item = all[slotType];
      if (item && item.ammo && typeof item.ammo === 'object') return item;
    }
    return null;
  }

  /** 只读探查：不扣减，供 AI/UI 判断能否远程出手。 */
  peek(entity, weapon = null) {
    const source = weapon || this.resolveAmmoWeapon(entity);
    if (!source?.ammo) return { configured: false, ok: true, skipped: true };
    const itemId = typeof source.ammo.itemId === 'string' && source.ammo.itemId
      ? source.ammo.itemId
      : DEFAULT_AMMO_ITEM;
    const perShot = Math.max(1, Math.floor(Number(source.ammo.perShot) || 1));
    const inventory = this.resolveInventory(entity);
    if (inventory && this.inventoryTransactions?.previewRemove) {
      const available = this.inventoryTransactions.previewRemove(inventory, itemId, perShot);
      return {
        configured: true,
        ok: available.remainder === 0,
        code: available.remainder === 0 ? null : 'outOfAmmo',
        itemId,
        perShot,
        mode: 'inventory'
      };
    }
    const count = Number(entity?.ammoCount);
    if (Number.isFinite(count)) {
      return {
        configured: true,
        ok: count >= perShot,
        code: count >= perShot ? null : 'outOfAmmo',
        itemId,
        perShot,
        mode: 'counter',
        remaining: count
      };
    }
    return { configured: true, ok: false, code: 'outOfAmmo', itemId, perShot, mode: 'none' };
  }

  /**
   * 扣减一次远程攻击的弹药。
   * @param {Entity} entity
   * @param {string} operationId - 幂等键（同一发不重复扣）
   * @param {Object|null} weapon
   * @returns {{ok:boolean, skipped?:boolean, code?:string, itemId?:string, perShot?:number, remaining?:number}}
   */
  consume(entity, operationId, weapon = null) {
    const probe = this.peek(entity, weapon);
    if (probe.configured !== true) return { ok: true, skipped: true };
    if (probe.ok !== true) return probe;
    if (probe.mode === 'inventory') {
      const inventory = this.resolveInventory(entity);
      const committed = this.inventoryTransactions.commit({
        type: 'batchRemove',
        inventory,
        entries: [{ itemId: probe.itemId, quantity: probe.perShot }],
        operationId
      });
      if (committed?.ok !== true) {
        this.inventoryTransactions.forgetOperation?.(operationId);
        return { ok: false, code: committed?.code || 'outOfAmmo', ...probe };
      }
      return { ok: true, code: null, itemId: probe.itemId, perShot: probe.perShot, mode: 'inventory' };
    }
    entity.ammoCount = Math.max(0, Number(entity.ammoCount) - probe.perShot);
    return {
      ok: true,
      code: null,
      itemId: probe.itemId,
      perShot: probe.perShot,
      mode: 'counter',
      remaining: entity.ammoCount
    };
  }
}

export default AmmoService;

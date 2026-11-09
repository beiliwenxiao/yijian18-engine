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

const clone = value => value == null ? value : (typeof structuredClone === 'function'
  ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

const rejected = (command, code, error = null) => ({
  ok: false, operationId: command.operationId, status: 'rejected', committed: false,
  code, stateId: null, stateRevision: null, eventFrom: null, eventTo: null,
  value: null, error: error || { message: code }
});

const DEFAULT_COST_RULES = Object.freeze({
  ironPerDurability: 20,
  copperPerDurability: 10
});

/**
 * 铁匠铺装备修复的权威 command handler（P17 / 1B）。
 *
 * 与 ToolRepairService 同构：材料预检 → 扣材料 → 回填耐久 → checkpoint → 版本提交，
 * 但识别的是「装备耐久配置」（durabilityMax / durabilityPerUse / durabilityPerHit）
 * 而不是 toolType；工具修复链完全不受影响（item.repair 外层按 payload.kind 分流）。
 */
export class EquipmentRepairService {
  constructor(config = {}) {
    if (!config.inventoryTransactions) throw new TypeError('EquipmentRepairService requires inventoryTransactions');
    this.inventoryTransactions = config.inventoryTransactions;
    this.resolveActor = config.resolveActor || (() => null);
    this.resolveDefinition = config.resolveDefinition || (() => null);
    this.resolveStation = config.resolveStation || (() => ({ ok: true }));
    this.equipmentSystem = config.equipmentSystem || null;
    this.createCheckpoint = config.createCheckpoint || (async () => ({ ok: true, skipped: true }));
    this.costRules = { ...DEFAULT_COST_RULES, ...(config.costRules || {}) };
    this.stateType = 'equipmentRepair';
    this.stateId = command => `equipment-repair:${command.actorId}`;
  }

  /** 修复报价：缺口越大，材料与铜钱越多（无缺口返回 repairNotNeeded）。 */
  quote({ item, definition } = {}) {
    const source = item || {};
    const declared = definition || source;
    const maxDurability = Math.floor(Number(source.durabilityMax ?? declared.durabilityMax ?? declared.maxDurability));
    const durability = Math.floor(Number(source.durability));
    if (!Number.isInteger(maxDurability) || maxDurability <= 0) return { ok: false, code: 'itemNotRepairable' };
    if (!Number.isInteger(durability) || durability < 0) return { ok: false, code: 'invalidEquipmentDurability' };
    if (durability >= maxDurability) return { ok: false, code: 'repairNotNeeded', durability, maxDurability };
    const gap = maxDurability - durability;
    const costs = clone(source.repairCosts || declared.repairCosts);
    const materials = Array.isArray(costs) && costs.length > 0
      ? costs.map(cost => ({ itemId: cost.itemId, quantity: Math.floor(Number(cost.quantity)) }))
      : [
        {
          itemId: 'resource.iron',
          quantity: Math.max(1, Math.ceil(gap / this.costRules.ironPerDurability))
        },
        {
          itemId: 'currency.copper',
          quantity: Math.max(1, Math.ceil(gap / this.costRules.copperPerDurability))
        }
      ];
    if (materials.some(entry => !entry.itemId || !Number.isInteger(entry.quantity) || entry.quantity <= 0)) {
      return { ok: false, code: 'repairCostsMissing' };
    }
    return { ok: true, gap, durability, maxDurability, materials };
  }

  async execute(command, context) {
    const actor = this.resolveActor(command.actorId, command);
    const inventory = actor?.getComponent?.('inventory');
    if (!actor) return rejected(command, 'actorMissing');
    if (!inventory) return rejected(command, 'missingInventory');

    const itemId = typeof command.payload?.itemId === 'string' ? command.payload.itemId : '';
    const instanceId = typeof command.payload?.instanceId === 'string' ? command.payload.instanceId.trim() : '';
    if (!itemId) return rejected(command, 'itemIdRequired');
    if (!instanceId) return rejected(command, 'equipmentInstanceRequired');

    const stack = (inventory.slots || []).find(candidate => candidate?.item?.id === itemId
      && candidate.item.instanceId === instanceId);
    if (!stack?.item) return rejected(command, 'equipmentInstanceMissing');

    const equipment = stack.item;
    const definitionId = equipment.definitionId || equipment.id;
    const definition = this.resolveDefinition(definitionId) || equipment;
    const stationId = typeof command.payload?.stationId === 'string' ? command.payload.stationId.trim() : '';
    if (stationId) {
      const station = this.resolveStation(stationId, { characterId: actor.id });
      if (!station || station.ok === false) return rejected(command, station?.code || 'stationUnavailable');
      if (station.station?.kind && station.station.kind !== 'repair') return rejected(command, 'stationNotRepair');
    }

    const quote = this.quote({ item: equipment, definition });
    if (!quote.ok) return rejected(command, quote.code, { message: quote.code, ...quote });
    for (const cost of quote.materials) {
      if (this.inventoryTransactions.previewRemove(inventory, cost.itemId, cost.quantity).remainder > 0) {
        return rejected(command, 'insufficientRepairMaterials');
      }
    }

    const inventoryBefore = clone(inventory.exportItems?.() || []);
    const transactionId = `${command.operationId}:materials`;
    const checkpointId = command.payload?.checkpointId || `checkpoint.equipmentRepair.${actor.id}.${instanceId}`;
    const committed = this.inventoryTransactions.commit({
      type: 'batchRemove', inventory, entries: quote.materials, operationId: transactionId
    });
    if (!committed?.ok) return rejected(command, committed?.code || 'repairMaterialCommitFailed');

    equipment.durability = quote.maxDurability;
    const value = {
      action: 'repair',
      itemId: equipment.id || itemId,
      definitionId,
      instanceId,
      name: equipment.name || definition.name || definitionId,
      previousDurability: quote.durability,
      durability: quote.maxDurability,
      maxDurability: quote.maxDurability,
      consumed: clone(quote.materials)
    };
    const rollback = () => {
      inventory.loadItems?.(clone(inventoryBefore));
      this.inventoryTransactions.forgetOperation?.(transactionId);
    };

    const checkpoint = await this._checkpoint(
      { ...command, payload: { ...command.payload, checkpointId } },
      value
    );
    if (!checkpoint.ok) {
      rollback();
      return rejected(command, checkpoint.code, { message: checkpoint.message || checkpoint.code });
    }
    const revision = context.commitStateRevision(context.preparedStateRevision);
    if (!revision.ok) {
      rollback();
      return rejected(command, revision.code);
    }

    const stateId = context.preparedStateRevision.stateId;
    const eventBase = { stateId, stateType: this.stateType, stateRevision: revision.stateRevision };
    const result = {
      ok: true, operationId: command.operationId, status: 'committed', committed: true,
      code: null, stateId, stateRevision: revision.stateRevision,
      eventFrom: null, eventTo: null, value, error: null
    };
    return {
      result,
      committedEvents: [{ ...eventBase, type: 'item.repair.committed', payload: value }],
      applicationEvents: [{ ...eventBase, type: 'item.durability.repaired', payload: value }]
    };
  }

  async _checkpoint(command, value) {
    try {
      const result = await this.createCheckpoint({
        checkpointId: command.payload.checkpointId, command, value, operationId: command.operationId
      });
      if (result === false || result?.ok === false) {
        return { ok: false, code: result?.code || 'checkpointFailed', message: result?.message };
      }
      return { ok: true, result };
    } catch (error) {
      return { ok: false, code: 'checkpointFailed', message: error?.message || String(error) };
    }
  }
}

export default EquipmentRepairService;

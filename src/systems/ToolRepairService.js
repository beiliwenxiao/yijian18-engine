/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

const clone = value => value == null ? value : (typeof structuredClone === 'function'
  ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

const rejected = (command, code, error = null) => ({
  ok: false, operationId: command.operationId, status: 'rejected', committed: false,
  code, stateId: null, stateRevision: null, eventFrom: null, eventTo: null,
  value: null, error: error || { message: code }
});

function normalizeCosts(costs) {
  if (!Array.isArray(costs) || costs.length === 0) return null;
  const totals = new Map();
  for (const cost of costs) {
    const itemId = typeof cost?.itemId === 'string' ? cost.itemId : '';
    const quantity = Math.floor(Number(cost?.quantity));
    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) return null;
    totals.set(itemId, (totals.get(itemId) || 0) + quantity);
  }
  return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/**
 * 修复背包中单个耐久工具的权威 command handler。
 * 工具本体不会被消耗；库存材料、实例耐久、checkpoint 和状态版本统一提交或回滚。
 */
export class ToolRepairService {
  constructor(config = {}) {
    if (!config.inventoryTransactions) throw new TypeError('ToolRepairService requires inventoryTransactions');
    this.inventoryTransactions = config.inventoryTransactions;
    this.resolveActor = config.resolveActor || (() => null);
    this.resolveDefinition = config.resolveDefinition || (() => null);
    this.createCheckpoint = config.createCheckpoint || (async () => ({ ok: true, skipped: true }));
    this.stateType = 'toolRepair';
    this.stateId = command => `tool-repair:${command.actorId}`;
  }

  async execute(command, context) {
    const actor = this.resolveActor(command.actorId, command);
    const inventory = actor?.getComponent?.('inventory');
    if (!actor) return rejected(command, 'actorMissing');
    if (!inventory) return rejected(command, 'missingInventory');

    const itemId = typeof command.payload?.itemId === 'string' ? command.payload.itemId : '';
    const instanceId = typeof command.payload?.instanceId === 'string' ? command.payload.instanceId.trim() : '';
    if (!itemId) return rejected(command, 'itemIdRequired');
    if (!instanceId) return rejected(command, 'toolInstanceRequired');

    const stack = (inventory.slots || []).find(candidate => candidate?.item?.id === itemId
      && candidate.item.instanceId === instanceId);
    if (!stack?.item) return rejected(command, 'toolInstanceMissing');

    const tool = stack.item;
    const definitionId = tool.definitionId || tool.id;
    const definition = this.resolveDefinition(definitionId) || tool;
    const maxDurability = Math.floor(Number(tool.maxDurability ?? definition.maxDurability));
    const durability = Math.floor(Number(tool.durability));
    const costs = normalizeCosts(tool.repairCosts || definition.repairCosts);
    if (!tool.toolType && !definition.toolType) return rejected(command, 'itemNotRepairable');
    if (!Number.isInteger(maxDurability) || maxDurability <= 0 || !Number.isInteger(durability) || durability < 0) {
      return rejected(command, 'invalidToolDurability');
    }
    if (durability >= maxDurability) return rejected(command, 'repairNotNeeded');
    if (!costs) return rejected(command, 'repairCostsMissing');
    for (const cost of costs) {
      if (this.inventoryTransactions.previewRemove(inventory, cost.itemId, cost.quantity).remainder > 0) {
        return rejected(command, 'insufficientRepairMaterials');
      }
    }

    const inventoryBefore = clone(inventory.exportItems?.() || []);
    const transactionId = `${command.operationId}:materials`;
    const checkpointId = command.payload?.checkpointId || `checkpoint.toolRepair.${actor.id}.${instanceId}`;
    const committed = this.inventoryTransactions.commit({
      type: 'batchRemove', inventory, entries: costs, operationId: transactionId
    });
    if (!committed?.ok) return rejected(command, committed?.code || 'repairMaterialCommitFailed');

    tool.durability = maxDurability;
    const value = {
      action: 'repair', itemId: tool.id || itemId, definitionId, instanceId,
      name: tool.name || definition.name || definitionId,
      previousDurability: durability, durability: maxDurability, maxDurability,
      consumed: clone(costs), projection: this._project(actor)
    };
    const rollback = () => {
      inventory.loadItems?.(clone(inventoryBefore));
      this.inventoryTransactions.forgetOperation?.(transactionId);
    };

    const checkpoint = await this._checkpoint({ ...command, payload: { ...command.payload, checkpointId } }, value);
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
      applicationEvents: [{ ...eventBase, type: 'item.repaired', payload: value }]
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

  _project(actor) {
    const inventory = actor?.getComponent?.('inventory');
    return {
      actorId: actor?.id || null,
      inventory: {
        maxSlots: inventory?.maxSlots || 0,
        slots: (inventory?.slots || []).map(stack => stack
          ? { item: clone(stack.item), quantity: stack.quantity }
          : null)
      }
    };
  }
}

export default ToolRepairService;
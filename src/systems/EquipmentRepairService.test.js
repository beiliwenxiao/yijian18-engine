/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-09
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { EquipmentRepairService } from './EquipmentRepairService.js';

function createHarness({ durability = 60, materials = { 'resource.iron': 10, 'currency.copper': 10 },
  station = { ok: true, station: { id: 'station.forge.repair', kind: 'repair' } }, repairCosts = null } = {}) {
  const equipment = {
    id: 'equipment.test_shield',
    name: '测试木盾',
    instanceId: 'instance.1',
    durability,
    durabilityMax: 100,
    durabilityPerHit: 1,
    ...(repairCosts ? { repairCosts } : {})
  };
  const stocks = new Map(Object.entries(materials));
  const inventory = {
    slots: [{ item: equipment }],
    exportItems: () => [{ item: { ...equipment } }],
    loadItems: items => { inventory.slots = items; }
  };
  const actor = {
    id: 'hero',
    getComponent: name => (name === 'inventory' ? inventory : null)
  };
  const inventoryTransactions = {
    previewRemove(_inventory, itemId, quantity) {
      const have = stocks.get(itemId) || 0;
      return { remainder: Math.max(0, Number(quantity) - have) };
    },
    commit({ type, entries }) {
      if (type !== 'batchRemove') return { ok: false, code: 'unsupportedType' };
      for (const entry of entries) {
        if ((stocks.get(entry.itemId) || 0) < entry.quantity) return { ok: false, code: 'materialsRequired' };
      }
      for (const entry of entries) {
        stocks.set(entry.itemId, (stocks.get(entry.itemId) || 0) - entry.quantity);
      }
      return { ok: true };
    },
    forgetOperation() {}
  };
  const checkpoints = [];
  const service = new EquipmentRepairService({
    inventoryTransactions,
    resolveActor: id => (id === 'hero' ? actor : null),
    resolveDefinition: id => ({ id, name: '测试木盾' }),
    resolveStation: () => station,
    createCheckpoint: async payload => { checkpoints.push(payload); return { ok: true }; }
  });
  const context = {
    preparedStateRevision: { stateId: 'state.repair.1' },
    commitStateRevision: prepared => ({ ok: true, stateId: prepared.stateId, stateRevision: 'rev.2' })
  };
  return { service, equipment, stocks, actor, context, checkpoints };
}

const command = (payload = {}) => ({
  operationId: 'op.repair.1',
  actorId: 'hero',
  payload: { itemId: 'equipment.test_shield', instanceId: 'instance.1', stationId: 'station.forge.repair', ...payload }
});

describe('EquipmentRepairService · 报价', () => {
  it('按耐久缺口推导铁料与铜钱，无缺口返回 repairNotNeeded', () => {
    const { service } = createHarness({ durability: 60 });
    const quote = service.quote({ item: { durability: 60, durabilityMax: 100 } });
    expect(quote.ok).toBe(true);
    expect(quote.gap).toBe(40);
    expect(quote.materials).toEqual([
      { itemId: 'resource.iron', quantity: 2 },
      { itemId: 'currency.copper', quantity: 4 }
    ]);

    const full = service.quote({ item: { durability: 100, durabilityMax: 100 } });
    expect(full).toMatchObject({ ok: false, code: 'repairNotNeeded' });
  });

  it('未声明耐久上限的装备不可修复', () => {
    const { service } = createHarness();
    expect(service.quote({ item: { durability: 10 } })).toMatchObject({ ok: false, code: 'itemNotRepairable' });
  });
});

describe('EquipmentRepairService · 结算', () => {
  it('扣材料、回填耐久、写 checkpoint 并产出提交/应用事件', async () => {
    const { service, equipment, stocks, context, checkpoints } = createHarness({ durability: 60 });
    const result = await service.execute(command(), context);

    expect(result.result).toMatchObject({ ok: true, status: 'committed', committed: true });
    expect(result.result.value).toMatchObject({ previousDurability: 60, durability: 100, maxDurability: 100 });
    expect(equipment.durability).toBe(100);
    expect(stocks.get('resource.iron')).toBe(8);
    expect(stocks.get('currency.copper')).toBe(6);
    expect(checkpoints).toHaveLength(1);
    expect(result.committedEvents.map(event => event.type)).toEqual(['item.repair.committed']);
    expect(result.applicationEvents.map(event => event.type)).toEqual(['item.durability.repaired']);
  });

  it('材料不足直接拒绝，库存与耐久都不变', async () => {
    const { service, equipment, stocks, context } = createHarness({
      durability: 60, materials: { 'resource.iron': 1, 'currency.copper': 10 }
    });
    const result = await service.execute(command(), context);

    expect(result).toMatchObject({ ok: false, status: 'rejected', code: 'insufficientRepairMaterials' });
    expect(equipment.durability).toBe(60);
    expect(stocks.get('resource.iron')).toBe(1);
  });

  it('工位不是 repair 类型时拒绝（铁匠修复专属）', async () => {
    const { service, context } = createHarness({
      station: { ok: true, station: { id: 'station.workshop.carpenter', kind: 'craft' } }
    });
    const result = await service.execute(command(), context);
    expect(result).toMatchObject({ ok: false, code: 'stationNotRepair' });
  });

  it('实例缺失与重复修复（已满耐久）都被拒绝', async () => {
    const { service, context } = createHarness({ durability: 100 });
    const notNeeded = await service.execute(command(), context);
    expect(notNeeded).toMatchObject({ ok: false, code: 'repairNotNeeded' });

    const missing = await service.execute(command({ instanceId: 'instance.404' }), context);
    expect(missing).toMatchObject({ ok: false, code: 'equipmentInstanceMissing' });
  });
});

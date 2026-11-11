import { describe, it, expect } from 'vitest';
import { FoodLedgerSystem } from '../../systems/FoodLedgerSystem.js';
import { CampStockContainerAdapter } from './CampStockContainerAdapter.js';

function makeLedger({ armyFood = 100, campFood = 40, capacity = 500 } = {}) {
  return new FoodLedgerSystem({
    config: { campStorage: { base: 500, perLevel: 250, max: 2000 } },
    armies: [{
      id: 'army.a',
      factionId: 'yellow_turban',
      control: 'player',
      manpower: 100,
      supply: { food: armyFood, cap: 200 }
    }]
  });
}

function makeAdapter(ledger, campFood = 40) {
  ledger.registerCamp({ campId: 'camp.s02.field', level: 1 });
  const camp = ledger.camps.get('camp.s02.field');
  camp.stock = { food: campFood };
  return new CampStockContainerAdapter({ foodLedger: ledger, campId: 'camp.s02.field', nonce: 't1' });
}

describe('CampStockContainerAdapter', () => {
  it('导出军营库存为物品数组（resource.*）', () => {
    const adapter = makeAdapter(makeLedger());
    expect(adapter.exportItems()).toEqual([{ itemId: 'resource.food', name: '粮草', quantity: 40 }]);
  });

  it('快照：左军团粮草、右军营存粮，含容量与方向', () => {
    const ledger = makeLedger();
    const adapter = makeAdapter(ledger);
    const snapshot = adapter.buildSnapshot({ army: ledger.getArmy('army.a') });
    expect(snapshot.inventoryLabel).toBe('军团粮草');
    expect(snapshot.storageLabel).toBe('军营');
    expect(snapshot.direction).toBe('toCargo');
    expect(snapshot.inventory.items).toEqual([{ itemId: 'resource.food', name: '粮草', quantity: 100 }]);
    expect(snapshot.cargo.total).toBe(40);
    expect(snapshot.cargo.capacity).toBe(500);
  });

  it('存入军营：扣军团粮、加军营库存', () => {
    const ledger = makeLedger();
    const adapter = makeAdapter(ledger);
    const result = adapter.transfer({ armyId: 'army.a', direction: 'toCargo', quantity: 30 });
    expect(result.ok).toBe(true);
    expect(ledger.getArmy('army.a').supply.food).toBe(70);
    expect(ledger.getCamp('camp.s02.field').stock.food).toBe(70);
  });

  it('从军营取回：加军团粮、扣军营库存', () => {
    const ledger = makeLedger();
    const adapter = makeAdapter(ledger);
    const result = adapter.transfer({ armyId: 'army.a', direction: 'toInventory', quantity: 25 });
    expect(result.ok).toBe(true);
    expect(ledger.getArmy('army.a').supply.food).toBe(125);
    expect(ledger.getCamp('camp.s02.field').stock.food).toBe(15);
  });

  it('军营只收粮草：其它资源与非法数量被拒', () => {
    const adapter = makeAdapter(makeLedger());
    expect(adapter.transfer({ armyId: 'army.a', itemId: 'resource.wood', quantity: 5 }))
      .toMatchObject({ ok: false, code: 'unsupportedResource' });
    expect(adapter.transfer({ armyId: 'army.a', quantity: 0 }))
      .toMatchObject({ ok: false, code: 'invalidQuantity' });
  });

  it('军团粮不足 / 军营容量不足透传账本错误码', () => {
    const poor = makeLedger({ armyFood: 10 });
    const adapter = makeAdapter(poor);
    expect(adapter.transfer({ armyId: 'army.a', quantity: 20 }))
      .toMatchObject({ ok: false, code: 'insufficientSupply' });

    const full = makeLedger({ campFood: 500 });
    const fullAdapter = makeAdapter(full, 500);
    expect(fullAdapter.transfer({ armyId: 'army.a', quantity: 10 }))
      .toMatchObject({ ok: false, code: 'campCapacityExceeded' });
  });

  it('operationId 带 boot nonce 且递增；同 id 不重复记账', () => {
    const ledger = makeLedger();
    const adapter = makeAdapter(ledger);
    const first = adapter.transfer({ armyId: 'army.a', quantity: 10 });
    const second = adapter.transfer({ armyId: 'army.a', quantity: 10 });
    expect(first.operationId).toBe('camp-supply:camp.s02.field:t1:1');
    expect(second.operationId).toBe('camp-supply:camp.s02.field:t1:2');
    const replay = adapter.transfer({ armyId: 'army.a', quantity: 10, operationId: first.operationId });
    expect(replay).toMatchObject({ ok: true, idempotent: true });
    expect(ledger.getArmy('army.a').supply.food).toBe(80);
  });

  it('loadItems 可按资源物品写回军营库存', () => {
    const adapter = makeAdapter(makeLedger());
    expect(adapter.loadItems([{ itemId: 'resource.food', quantity: 12 }])).toMatchObject({ ok: true });
    expect(adapter.getCamp().stock.food).toBe(12);
  });
});

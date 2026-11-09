import { describe, it, expect } from 'vitest';
import { ProductionSystem } from './ProductionSystem.js';

const RECIPE = {
  id: 'recipe.test_arrow',
  name: '测试木箭',
  station: 'station.test.carpenter',
  kind: 'craft',
  duration: 6,
  inputs: [{ itemId: 'resource.wood', quantity: 1 }],
  outputs: [{ itemId: 'wooden_arrow', quantity: 10 }],
  wage: { copper: 2 },
  experience: { craft: 3 },
  requiredProficiency: { craft: 0 }
};

function createHarness({ items = { 'resource.wood': 3, 'currency.copper': 10 }, level = 0,
  stationRecipes = [RECIPE.id], rng = () => 0.5, durability = 100 } = {}) {
  const stocks = new Map(Object.entries(items));
  const inventory = { id: 'inv.test' };
  const inventoryTransactions = {
    previewRemove(_inventory, itemId, quantity) {
      const have = stocks.get(itemId) || 0;
      return { remainder: Math.max(0, Number(quantity) - have) };
    },
    commit({ type, entries }) {
      if (type === 'batchRemove') {
        for (const entry of entries) {
          if ((stocks.get(entry.itemId) || 0) < entry.quantity) return { ok: false, code: 'materialsRequired' };
        }
        for (const entry of entries) {
          stocks.set(entry.itemId, (stocks.get(entry.itemId) || 0) - entry.quantity);
        }
        return { ok: true };
      }
      if (type === 'batchAdd') {
        for (const entry of entries) {
          stocks.set(entry.item.id, (stocks.get(entry.item.id) || 0) + entry.quantity);
        }
        return { ok: true };
      }
      return { ok: false, code: 'unsupportedType' };
    },
    forgetOperation() {}
  };
  const station = {
    id: 'station.test.carpenter',
    name: '测试木作台',
    kind: 'craft',
    workerSlots: 1,
    recipes: stationRecipes
  };
  const events = [];
  const system = new ProductionSystem({
    inventoryTransactions,
    proficiencySystem: {
      getState: () => ({ level }),
      gainExperience: () => ({ ok: true })
    },
    itemResolver: id => ({ id, name: id }),
    resolveStation: stationId => (stationId === station.id
      ? { ok: true, station, definitionId: 'construction.workshop', entityId: 'entity.building', durability }
      : { ok: false, code: 'stationUnavailable' }),
    rng,
    onEvent: (event, payload) => events.push({ event, payload })
  });
  system.registerRecipes([RECIPE]);
  return { system, stocks, inventory, station, events };
}

describe('ProductionSystem · craft 主链', () => {
  it('开工预扣材料与工钱，单工位只留一条 pending', () => {
    const { system, stocks, inventory } = createHarness();
    const started = system.start({
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.1'
    });
    expect(started.ok).toBe(true);
    expect(started.status).toBe('active');
    expect(stocks.get('resource.wood')).toBe(2);
    expect(stocks.get('currency.copper')).toBe(8);
    expect(system.pending.size).toBe(1);
  });

  it('材料不足时不建 pending、不扣库存', () => {
    const { system, stocks, inventory } = createHarness({ items: { 'resource.wood': 0, 'currency.copper': 10 } });
    const started = system.start({
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.2'
    });
    expect(started).toMatchObject({ ok: false, code: 'materialsRequired', itemId: 'resource.wood' });
    expect(system.pending.size).toBe(0);
    expect(stocks.get('currency.copper')).toBe(10);
  });

  it('工钱不足同样拒绝，且只返回铜钱缺口', () => {
    const { system, inventory } = createHarness({ items: { 'resource.wood': 3, 'currency.copper': 0 } });
    const started = system.start({
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.3'
    });
    expect(started).toMatchObject({ ok: false, code: 'materialsRequired', itemId: 'currency.copper' });
  });

  it('取消退料含工钱，且幂等只退一次', () => {
    const { system, stocks, inventory } = createHarness();
    system.start({
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.4'
    });
    const first = system.cancel('station.test.carpenter');
    expect(first).toMatchObject({ ok: true, refunded: true, status: 'cancelled' });
    expect(stocks.get('resource.wood')).toBe(3);
    expect(stocks.get('currency.copper')).toBe(10);
    expect(system.pending.size).toBe(0);
    expect(system.cancel('station.test.carpenter')).toMatchObject({ ok: false, code: 'noPendingProduction' });
  });

  it('相同 operationId 重放幂等，不重复扣材料', () => {
    const { system, stocks, inventory } = createHarness();
    const args = {
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.5'
    };
    system.start(args);
    const replay = system.start(args);
    expect(replay).toMatchObject({ ok: true, idempotent: true });
    expect(stocks.get('resource.wood')).toBe(2);
  });

  it('不同指纹复用 operationId 报冲突', () => {
    const { system, inventory } = createHarness();
    const base = {
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.6'
    };
    system.start(base);
    const conflict = system.start({ ...base, characterId: 'other' });
    expect(conflict).toMatchObject({ ok: false, code: 'operationIdConflict' });
  });

  it('工位占用、熟练度不足、工位不可用分别拒绝', () => {
    const busy = createHarness();
    busy.system.start({
      characterId: 'hero', inventory: busy.inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.7'
    });
    expect(busy.system.start({
      characterId: 'hero', inventory: busy.inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.7b'
    })).toMatchObject({ ok: false, code: 'stationBusy' });

    const weak = createHarness({ level: 0 });
    weak.system.registerRecipes([{ ...RECIPE, id: 'recipe.need_one', requiredProficiency: { craft: 1 } }]);
    weak.station.recipes.push('recipe.need_one');
    expect(weak.system.start({
      characterId: 'hero', inventory: weak.inventory, stationId: 'station.test.carpenter',
      recipeId: 'recipe.need_one', operationId: 'op.8'
    })).toMatchObject({ ok: false, code: 'proficiencyRequired' });

    const missing = createHarness();
    expect(missing.system.start({
      characterId: 'hero', inventory: missing.inventory, stationId: 'station.unknown',
      recipeId: RECIPE.id, operationId: 'op.9'
    })).toMatchObject({ ok: false, code: 'stationUnavailable' });
  });

  it('未在工位允许清单内的配方被拒绝', () => {
    const strict = createHarness({ stationRecipes: [] });
    expect(strict.system.start({
      characterId: 'hero', inventory: strict.inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.10'
    })).toMatchObject({ ok: false, code: 'recipeNotAllowed' });
  });

  it('update 到点转 ready 并发 productionReady，commitOutput 后完成发 productionCompleted', () => {
    const { system, inventory, events } = createHarness();
    system.start({
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.11'
    });
    expect(system.update(5)).toEqual([]);
    const terminal = system.update(1);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ status: 'ready', progress: 1 });
    expect(events.map(entry => entry.event)).toContain('productionReady');
    expect(system.pending.get('station.test.carpenter').status).toBe('ready');

    const committed = system.commitOutput('station.test.carpenter', { ok: true });
    expect(committed).toMatchObject({
      ok: true, status: 'completed', recipeId: RECIPE.id, itemId: 'wooden_arrow', quantity: 10
    });
    expect(system.pending.size).toBe(0);
    expect(events.map(entry => entry.event)).toContain('productionCompleted');
  });

  it('产物提交失败时保持 ready 等待重试', () => {
    const { system, inventory } = createHarness();
    system.start({
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.12'
    });
    system.update(6);
    expect(system.commitOutput('station.test.carpenter', { ok: false, code: 'transactionFailed' }))
      .toMatchObject({ ok: false, code: 'transactionFailed', status: 'ready' });
    expect(system.pending.has('station.test.carpenter')).toBe(true);
  });

  it('captureRuntime/restoreRuntime 与 serialize/deserialize 保留进度', () => {
    const { system, inventory } = createHarness();
    system.start({
      characterId: 'hero', inventory, stationId: 'station.test.carpenter',
      recipeId: RECIPE.id, operationId: 'op.13'
    });
    system.update(2);

    const snapshot = system.captureRuntime();
    const restored = createHarness().system;
    expect(restored.restoreRuntime(snapshot)).toBe(true);
    expect(restored.pending.get('station.test.carpenter').elapsed).toBe(2);

    const serialized = system.serialize();
    const deserialized = createHarness().system;
    expect(deserialized.deserialize(serialized, { resolveInventory: () => inventory }).ok).toBe(true);
    expect(deserialized.pending.get('station.test.carpenter').status).toBe('active');
  });

  it('getStationRecipes 给出可用性快照', () => {
    const { system, inventory } = createHarness();
    const view = system.getStationRecipes('station.test.carpenter', { characterId: 'hero', inventory });
    expect(view.ok).toBe(true);
    expect(view.recipes).toHaveLength(1);
    expect(view.recipes[0]).toMatchObject({ recipeId: RECIPE.id, enabled: true, busy: false });
  });
});

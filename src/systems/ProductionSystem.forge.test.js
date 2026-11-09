import { describe, it, expect } from 'vitest';
import { ProductionSystem } from './ProductionSystem.js';

const FORGE_RECIPE = {
  id: 'recipe.test_blade',
  name: '测试锻刃',
  station: 'station.test.anvil',
  kind: 'forge',
  duration: 4,
  inputs: [{ itemId: 'resource.iron', quantity: 4 }],
  outputs: [{ itemId: 'weapon.test_blade', quantity: 1 }],
  experience: { forge: 6 },
  requiredProficiency: { forge: 0 },
  quality: { mode: 'roll', min: 0.8, max: 1.2, step: 0.1 }
};

function seededRng(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function createHarness({ recipe = FORGE_RECIPE, rng = seededRng(7), iron = 10 } = {}) {
  const stocks = new Map([['resource.iron', iron]]);
  const inventory = { id: 'inv.forge' };
  const events = [];
  const inventoryTransactions = {
    previewRemove(_inventory, itemId, quantity) {
      return { remainder: Math.max(0, Number(quantity) - (stocks.get(itemId) || 0)) };
    },
    commit({ type, entries }) {
      if (type === 'batchRemove') {
        for (const entry of entries) {
          if ((stocks.get(entry.itemId) || 0) < entry.quantity) return { ok: false };
        }
        for (const entry of entries) stocks.set(entry.itemId, (stocks.get(entry.itemId) || 0) - entry.quantity);
        return { ok: true };
      }
      if (type === 'batchAdd') {
        for (const entry of entries) stocks.set(entry.item.id, (stocks.get(entry.item.id) || 0) + entry.quantity);
        return { ok: true };
      }
      return { ok: false };
    },
    forgetOperation() {}
  };
  const station = { id: 'station.test.anvil', kind: 'forge', workerSlots: 1, recipes: [recipe.id] };
  const system = new ProductionSystem({
    inventoryTransactions,
    proficiencySystem: { getState: () => ({ level: 0 }), gainExperience: () => ({ ok: true }) },
    itemResolver: id => ({ id }),
    resolveStation: stationId => (stationId === station.id ? { ok: true, station, durability: 100 } : { ok: false }),
    rng,
    onEvent: (event, payload) => events.push({ event, payload })
  });
  system.registerRecipes([recipe]);
  return { system, stocks, inventory, events };
}

describe('ProductionSystem · 锻造品质与失败三档', () => {
  it('相同种子得到相同品质倍率', () => {
    const run = () => {
      const harness = createHarness({ rng: seededRng(42) });
      harness.system.start({
        characterId: 'hero', inventory: harness.inventory, stationId: 'station.test.anvil',
        recipeId: FORGE_RECIPE.id, operationId: 'forge.1'
      });
      const pending = harness.system.pending.get('station.test.anvil');
      harness.system.update(4);
      const committed = harness.system.commitOutput('station.test.anvil', { ok: true });
      return { multiplier: pending.qualityMultiplier, committed };
    };
    const first = run();
    const second = run();
    expect(first.multiplier).toBe(second.multiplier);
    expect(first.committed.qualityMultiplier).toBe(first.multiplier);
    expect(first.multiplier).toBeGreaterThanOrEqual(0.8);
    expect(first.multiplier).toBeLessThanOrEqual(1.2);
    expect(Number((first.multiplier * 10).toFixed(4)) % 1).toBe(0);
  });

  it('partial_refund：返还一半材料、不退工钱、清空工位', () => {
    const recipe = {
      ...FORGE_RECIPE,
      failure: { chance: 1, mode: 'partial_refund', rate: 0.5 }
    };
    const harness = createHarness({ recipe, rng: () => 0 });
    harness.system.start({
      characterId: 'hero', inventory: harness.inventory, stationId: 'station.test.anvil',
      recipeId: recipe.id, operationId: 'forge.2'
    });
    expect(harness.stocks.get('resource.iron')).toBe(6);
    const terminal = harness.system.update(4);
    expect(terminal).toHaveLength(1);
    expect(harness.system.pending.size).toBe(0);
    expect(harness.stocks.get('resource.iron')).toBe(8);
    expect(harness.events.map(entry => entry.event)).toContain('productionFailed');
  });

  it('destroy_materials：完全不返还', () => {
    const recipe = {
      ...FORGE_RECIPE,
      failure: { chance: 1, mode: 'destroy_materials' }
    };
    const harness = createHarness({ recipe, rng: () => 0 });
    harness.system.start({
      characterId: 'hero', inventory: harness.inventory, stationId: 'station.test.anvil',
      recipeId: recipe.id, operationId: 'forge.3'
    });
    harness.system.update(4);
    expect(harness.stocks.get('resource.iron')).toBe(6);
    expect(harness.system.pending.size).toBe(0);
  });

  it('成功路径仍可提交品质倍率', () => {
    const harness = createHarness({ rng: () => 0.99 });
    harness.system.start({
      characterId: 'hero', inventory: harness.inventory, stationId: 'station.test.anvil',
      recipeId: FORGE_RECIPE.id, operationId: 'forge.4'
    });
    harness.system.update(4);
    const committed = harness.system.commitOutput('station.test.anvil', { ok: true });
    expect(committed).toMatchObject({ ok: true, status: 'completed', itemId: 'weapon.test_blade' });
    expect(committed.qualityMultiplier).toBe(1.2);
  });
});

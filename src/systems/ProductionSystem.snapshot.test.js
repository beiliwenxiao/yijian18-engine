import { describe, it, expect, vi } from 'vitest';
import { ProductionSystem } from './ProductionSystem.js';
import { SnapshotManager } from '../core/snapshot/SnapshotManager.js';
import { createProductionSnapshotProvider } from '../core/scene/SceneGameplaySystemAssembler.js';

const STATION_ID = 'station.test.carpenter';
const RECIPE = {
  id: 'recipe.test_arrow',
  name: '测试木箭',
  station: STATION_ID,
  kind: 'craft',
  duration: 6,
  inputs: [{ itemId: 'resource.wood', quantity: 1 }],
  outputs: [{ itemId: 'wooden_arrow', quantity: 10 }],
  wage: { copper: 2 },
  experience: { craft: 3 },
  requiredProficiency: { craft: 0 }
};

/**
 * 存档场景：库存状态（stocks）视作已持久化的背包事实，读档时原样带回来；
 * 新系统只允许通过 resolveInventory 拿到同一个背包引用，绝不重放扣料事务。
 */
function createHarness({ stocks = new Map([['resource.wood', 3], ['currency.copper', 10]]) } = {}) {
  const inventory = { id: 'inv.hero' };
  const commits = [];
  const inventoryTransactions = {
    previewRemove(_inventory, itemId, quantity) {
      const have = Number(stocks.get(itemId)) || 0;
      return { remainder: Math.max(0, Number(quantity) - have) };
    },
    commit({ type, entries, operationId }) {
      commits.push({ type, operationId, entries: entries.map(entry => ({ ...entry })) });
      if (type === 'batchRemove') {
        for (const entry of entries) {
          if ((Number(stocks.get(entry.itemId)) || 0) < entry.quantity) return { ok: false, code: 'materialsRequired' };
        }
        for (const entry of entries) {
          stocks.set(entry.itemId, (Number(stocks.get(entry.itemId)) || 0) - entry.quantity);
        }
        return { ok: true };
      }
      if (type === 'batchAdd') {
        for (const entry of entries) {
          const itemId = entry.item?.id || entry.itemId;
          stocks.set(itemId, (Number(stocks.get(itemId)) || 0) + entry.quantity);
        }
        return { ok: true };
      }
      return { ok: false, code: 'unsupportedType' };
    },
    forgetOperation() {}
  };
  const station = { id: STATION_ID, name: '测试木作台', kind: 'craft', workerSlots: 1, recipes: [RECIPE.id] };
  const checkpoints = [];
  const system = new ProductionSystem({
    inventoryTransactions,
    proficiencySystem: { getState: () => ({ level: 0 }), gainExperience: () => ({ ok: true }) },
    itemResolver: id => ({ id, name: id }),
    resolveStation: stationId => (stationId === STATION_ID
      ? { ok: true, station, definitionId: 'construction.workshop', entityId: 'entity.building', durability: 100 }
      : { ok: false, code: 'stationUnavailable' }),
    createCheckpoint: checkpoint => {
      checkpoints.push(checkpoint);
      return { ok: true };
    },
    rng: () => 0.5
  });
  system.registerRecipes([RECIPE]);
  return { system, stocks, inventory, commits, checkpoints };
}

const startJob = (system, inventory, operationId = 'op.snapshot') => system.start({
  characterId: 'hero', inventory, stationId: STATION_ID, recipeId: RECIPE.id, operationId
});

describe('ProductionSystem · 生产状态快照', () => {
  it('存档→读档：工单/预扣凭证/工位占用恢复，不重复扣料；完成后不重复产出', () => {
    const first = createHarness();
    expect(startJob(first.system, first.inventory).ok).toBe(true);
    first.system.update(2);
    // 存档发生在预扣之后：库存已扣（3→2 / 10→8）。
    expect(first.stocks.get('resource.wood')).toBe(2);
    expect(first.stocks.get('currency.copper')).toBe(8);
    const snapshot = first.system.serialize();

    // 读档：背包事实沿用同一份库存，新系统没有扣料事务可重放。
    const second = createHarness({ stocks: first.stocks });
    const restored = second.system.deserialize(snapshot, { resolveInventory: () => second.inventory });
    expect(restored.ok).toBe(true);
    expect(second.commits).toHaveLength(0);
    expect(second.stocks.get('resource.wood')).toBe(2);
    expect(second.stocks.get('currency.copper')).toBe(8);

    const pending = second.system.pending.get(STATION_ID);
    expect(pending).toMatchObject({ characterId: 'hero', recipeId: RECIPE.id, operationId: 'op.snapshot', elapsed: 2, status: 'active' });
    expect(second.system.previewStart({
      characterId: 'hero', inventory: second.inventory, stationId: STATION_ID, recipeId: RECIPE.id
    }).busy).toBe(true);

    // 旧 operationId 重放走账本幂等，不会第二次扣料。
    const replay = startJob(second.system, second.inventory);
    expect(replay).toMatchObject({ ok: true, idempotent: true });
    expect(second.stocks.get('resource.wood')).toBe(2);
    expect(second.commits).toHaveLength(0);

    // 继续同一工单：走完剩余工期 → ready → 提交一次产出。
    const terminal = second.system.update(4);
    expect(terminal[0]).toMatchObject({ status: 'ready', progress: 1 });
    const committed = second.system.commitOutput(STATION_ID, { ok: true });
    expect(committed).toMatchObject({ ok: true, status: 'completed', operationId: 'op.snapshot' });
    expect(second.system.pending.size).toBe(0);
    // commitOutput 自身不 add 物品（由场景事务入库）；重复提交不再产出。
    expect(second.system.commitOutput(STATION_ID, { ok: true })).toMatchObject({ ok: false, code: 'noPendingProduction' });
    expect(second.stocks.get('wooden_arrow')).toBeUndefined();
  });

  it('旧档缺 gameplay.production 段：provider 可选，读档放行且不改动生产状态', () => {
    const manager = new SnapshotManager();
    const oldArchive = { version: 1, createdAt: 1, meta: {}, data: { 'worldStreaming': {} } };

    const restored = createHarness();
    const provider = createProductionSnapshotProvider(restored.system, { resolveInventory: () => restored.inventory });
    manager.register('gameplay.production', provider);

    const result = manager.restore(oldArchive);
    expect(result.ok).toBe(true);
    expect(result.restored).toEqual([]);
    expect(restored.system.pending.size).toBe(0);
  });

  it('旧档段存在但不可用：告警跳过，不拒整档', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new SnapshotManager();
    const brokenArchive = {
      version: 1, createdAt: 1, meta: {},
      data: { 'gameplay.production': { schemaVersion: 99, pending: 'oops', operations: [] } }
    };
    const target = createHarness();
    manager.register('gameplay.production', createProductionSnapshotProvider(target.system, {
      resolveInventory: () => target.inventory
    }));

    const result = manager.restore(brokenArchive);
    expect(result.ok).toBe(true);
    expect(target.system.pending.size).toBe(0);
    warn.mockRestore();
  });

  it('provider 走 SnapshotManager 往返：工单恢复后仍可继续到完成', () => {
    const first = createHarness();
    startJob(first.system, first.inventory, 'op.roundtrip');
    first.system.update(3);
    const managerA = new SnapshotManager();
    managerA.register('gameplay.production', createProductionSnapshotProvider(first.system, {
      resolveInventory: () => first.inventory
    }));
    const captured = managerA.capture({ label: 'test' });
    expect(captured.ok).toBe(true);
    expect(captured.snapshot.data['gameplay.production'].pending).toHaveLength(1);

    const second = createHarness({ stocks: first.stocks });
    const managerB = new SnapshotManager();
    managerB.register('gameplay.production', createProductionSnapshotProvider(second.system, {
      resolveInventory: () => second.inventory
    }));
    expect(managerB.restore(captured.snapshot)).toMatchObject({ ok: true, restored: ['gameplay.production'] });
    expect(second.system.pending.get(STATION_ID).elapsed).toBe(3);
    expect(second.commits).toHaveLength(0);

    second.system.update(3);
    expect(second.system.commitOutput(STATION_ID, { ok: true }).status).toBe('completed');
  });

  it('生产状态变更触发检查点：开工/完成各一次，检查点失败不影响生产', async () => {
    const harness = createHarness();
    const { system, inventory, checkpoints } = harness;
    expect(startJob(system, inventory, 'op.checkpoint').ok).toBe(true);
    expect(checkpoints.map(entry => entry.reason)).toEqual(['started']);

    system.update(6);
    expect(system.commitOutput(STATION_ID, { ok: true }).ok).toBe(true);
    expect(checkpoints.map(entry => entry.reason)).toEqual(['started', 'completed']);
    expect(checkpoints[1]).toMatchObject({ stationId: STATION_ID, recipeId: RECIPE.id, operationId: 'op.checkpoint' });

    const failing = createHarness();
    failing.system.createCheckpoint = () => Promise.reject(new Error('disk full'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(startJob(failing.system, failing.inventory, 'op.checkpoint.fail').ok).toBe(true);
    expect(failing.system.pending.size).toBe(1);
    await Promise.resolve();
    warn.mockRestore();
  });
});

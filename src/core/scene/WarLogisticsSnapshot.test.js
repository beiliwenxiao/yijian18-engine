import { describe, it, expect } from 'vitest';
import { FoodLedgerSystem } from '../../systems/FoodLedgerSystem.js';
import {
  WAR_LOGISTICS_SCHEMA_VERSION,
  createWarLogisticsSnapshot,
  applyWarLogisticsSnapshot,
  readWarLogistics,
  writeWarLogistics
} from './WarLogisticsSnapshot.js';

class MemoryBlackboard {
  constructor(initial = {}) {
    this.state = { ...initial };
  }
  get(key) {
    return this.state[key];
  }
  set(key, value) {
    this.state[key] = value;
  }
}

function makeFakeService(payload) {
  return {
    serialize: () => payload,
    restore: data => ({ ok: true, data })
  };
}

describe('WarLogisticsSnapshot', () => {
  it('采集四本账并带 schemaVersion；缺服务记 null', () => {
    const snapshot = createWarLogisticsSnapshot({
      foodLedger: makeFakeService({ armies: [] }),
      cityAdmin: null,
      battleSettlement: makeFakeService({ ledgers: {} }),
      reputation: makeFakeService({ values: { a: 1 } })
    });
    expect(snapshot.schemaVersion).toBe(WAR_LOGISTICS_SCHEMA_VERSION);
    expect(snapshot.foodLedger).toEqual({ armies: [] });
    expect(snapshot.cityAdmin).toBeNull();
    expect(snapshot.battleSettlement).toEqual({ ledgers: {} });
    expect(snapshot.reputation).toEqual({ values: { a: 1 } });
  });

  it('回灌四本账：缺段/脏段跳过，不抛错', () => {
    const calls = [];
    const services = {
      foodLedger: { restore: data => { calls.push(['food', data]); return { ok: true }; } },
      cityAdmin: { restore: () => { throw new Error('bad data'); } },
      battleSettlement: { restore: data => { calls.push(['battle', data]); return { ok: false, code: 'bad' }; } },
      reputation: null
    };
    const result = applyWarLogisticsSnapshot({
      foodLedger: { armies: [1] },
      cityAdmin: { cities: [] },
      battleSettlement: { ledgers: {} }
    }, services);
    expect(result.applied).toEqual(['foodLedger']);
    expect(result.skipped).toEqual(['cityAdmin', 'battleSettlement', 'reputation']);
    expect(calls).toEqual([['food', { armies: [1] }], ['battle', { ledgers: {} }]]);
  });

  it('空快照按 skippedAll 放行，不触碰服务', () => {
    let called = false;
    const result = applyWarLogisticsSnapshot(null, {
      foodLedger: { restore: () => { called = true; } }
    });
    expect(result.ok).toBe(true);
    expect(result.skippedAll).toBe(true);
    expect(called).toBe(false);
  });

  it('写黑板保留 battles/casualties，读回同一份 logistics', () => {
    const blackboard = new MemoryBlackboard({
      warState: { battles: { b1: { winnerFactionId: 'player' } }, casualties: { b1: 3 } }
    });
    const snapshot = { schemaVersion: 1, foodLedger: { armies: [] } };
    expect(writeWarLogistics(blackboard, snapshot)).toBe(true);
    expect(blackboard.get('warState').battles.b1.winnerFactionId).toBe('player');
    expect(blackboard.get('warState').casualties.b1).toBe(3);
    expect(readWarLogistics(blackboard)).toEqual(snapshot);
  });

  it('旧档无 warState.logistics 时读回 null（空态兼容）', () => {
    const blackboard = new MemoryBlackboard({ warState: { battles: {}, casualties: {} } });
    expect(readWarLogistics(blackboard)).toBeNull();
    expect(writeWarLogistics(blackboard, null)).toBe(false);
    expect(readWarLogistics(null)).toBeNull();
  });

  it('真实 FoodLedgerSystem 往返：粮草与军营状态一致', () => {
    const ledger = new FoodLedgerSystem({
      armies: [{ id: 'army.a', roster: { melee: 10 }, manpower: 10, supply: { food: 80, cap: 300 } }]
    });
    ledger.registerCamp({ campId: 'camp.s02', level: 2, stock: { food: 120 } });
    ledger.settleDay({ day: 1 });
    const snapshot = createWarLogisticsSnapshot({ foodLedger: ledger });

    const restored = new FoodLedgerSystem({ getDay: () => 1 });
    const result = applyWarLogisticsSnapshot(snapshot, { foodLedger: restored });
    expect(result.applied).toContain('foodLedger');
    expect(restored.getArmy('army.a').supply.food).toBe(ledger.getArmy('army.a').supply.food);
    expect(restored.getCamp('camp.s02').stock.food).toBe(120);
  });
});

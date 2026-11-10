/**
 * PassTariffSystem 单测（4C）
 * 覆盖：同阵营免税 / 计税口径 / 当日累计 / 日结幂等 / 无归属城池保留 / 序列化。
 */

import { describe, it, expect } from 'vitest';
import { PassTariffSystem, DEFAULT_TARIFF } from './PassTariffSystem.js';

function makeStore(passes = []) {
  const states = new Map(passes.map(pass => [String(pass.id), { ...pass, supply: { ...(pass.supply || {}) } }]));
  let listCalls = 0;
  return {
    states,
    get listCalls() { return listCalls; },
    listPasses: () => {
      listCalls += 1;
      return [...states.values()];
    },
    getPass: id => states.get(String(id)) || null,
    updatePassToll: (id, total) => {
      const pass = states.get(String(id));
      if (pass) pass.supply.toll = total;
    }
  };
}

function makeSystem(store, options = {}) {
  return new PassTariffSystem({
    tariff: { rate: 0.05, defaultRate: 0.05, resource: 'food', defaultCargoValue: 100 },
    listPasses: () => store.listPasses(),
    getPass: id => store.getPass(id),
    updatePassToll: (id, total) => store.updatePassToll(id, total),
    getDay: () => 1,
    resolveCityForPass: () => 'city.x',
    ...options
  });
}

describe('PassTariffSystem.collect', () => {
  it('缺 passId 返回错误', () => {
    expect(makeSystem(makeStore()).collect({})).toEqual({ ok: false, code: 'passRequired' });
  });

  it('同阵营免税：tax 0、累计不变', () => {
    const store = makeStore([{ id: 'pass.yique', kind: 'pass', factionId: 'yellow_turban', supply: { toll: 7 } }]);
    const result = makeSystem(store).collect({
      passId: 'pass.yique', moverFactionId: 'yellow_turban', ownerFactionId: 'yellow_turban', cargoValue: 500
    });
    expect(result).toMatchObject({ ok: true, exempt: true, rate: 0, tax: 0, toll: 7 });
    expect(store.getPass('pass.yique').supply.toll).toBe(7);
  });

  it('计税：cargoValue × rate 向下取整并累计', () => {
    const store = makeStore([{ id: 'pass.a', kind: 'pass', factionId: 'enemy', supply: {} }]);
    const system = makeSystem(store);
    expect(system.collect({ passId: 'pass.a', moverFactionId: 'yellow_turban', ownerFactionId: 'enemy', cargoValue: 100 }))
      .toMatchObject({ ok: true, exempt: false, tax: 5, toll: 5 });
    expect(system.collect({ passId: 'pass.a', moverFactionId: 'yellow_turban', ownerFactionId: 'enemy', cargoValue: 55 }))
      .toMatchObject({ tax: 2, toll: 7 });
  });

  it('缺省 rate / cargoValue 走 tariff 配置，rate 覆盖优先', () => {
    const store = makeStore([{ id: 'pass.a', kind: 'pass', factionId: 'enemy', supply: {} }]);
    const system = makeSystem(store);
    expect(system.collect({ passId: 'pass.a', moverFactionId: 'a', ownerFactionId: 'enemy' }).tax).toBe(5);
    expect(system.collect({ passId: 'pass.a', moverFactionId: 'a', ownerFactionId: 'enemy', cargoValue: 200, rate: 0.1 }).tax).toBe(20);
  });
});

describe('PassTariffSystem.settle', () => {
  it('日结产出 transfers 并清零累计', () => {
    const store = makeStore([
      { id: 'pass.a', kind: 'pass', factionId: 'enemy', supply: { toll: 12 } },
      { id: 'pass.b', kind: 'pass', factionId: 'enemy', supply: { toll: 8 } }
    ]);
    const events = [];
    const system = makeSystem(store, { onEvent: (event, payload) => events.push([event, payload]) });
    const result = system.settle({ day: 2 });
    expect(result).toMatchObject({ ok: true, day: 2, total: 20 });
    expect(result.transfers).toEqual([
      { passId: 'pass.a', cityId: 'city.x', ownerFactionId: 'enemy', resource: 'food', amount: 12 },
      { passId: 'pass.b', cityId: 'city.x', ownerFactionId: 'enemy', resource: 'food', amount: 8 }
    ]);
    expect(store.getPass('pass.a').supply.toll).toBe(0);
    expect(store.getPass('pass.b').supply.toll).toBe(0);
    expect(events.some(([event]) => event === 'pass.tariffSettled')).toBe(true);
  });

  it('同 day 二次日结幂等', () => {
    const store = makeStore([{ id: 'pass.a', kind: 'pass', factionId: 'enemy', supply: { toll: 5 } }]);
    const system = makeSystem(store);
    expect(system.settle({ day: 2 }).total).toBe(5);
    store.getPass('pass.a').supply.toll = 9;
    expect(system.settle({ day: 2 })).toMatchObject({ total: 0, skipped: 'alreadySettled' });
    expect(store.getPass('pass.a').supply.toll).toBe(9);
  });

  it('无归属城池：保留累计进 pending，补上归属后次日可结', () => {
    const store = makeStore([{ id: 'pass.a', kind: 'pass', factionId: 'enemy', supply: { toll: 6 } }]);
    let cityId = null;
    const system = makeSystem(store, { resolveCityForPass: () => cityId });
    const first = system.settle({ day: 2 });
    expect(first).toMatchObject({ total: 0 });
    expect(first.pending).toEqual([{ passId: 'pass.a', ownerFactionId: 'enemy', amount: 6 }]);
    expect(store.getPass('pass.a').supply.toll).toBe(6);

    cityId = 'city.late';
    const second = system.settle({ day: 3 });
    expect(second.transfers).toEqual([
      { passId: 'pass.a', cityId: 'city.late', ownerFactionId: 'enemy', resource: 'food', amount: 6 }
    ]);
    expect(store.getPass('pass.a').supply.toll).toBe(0);
  });

  it('非 pass 状态与零税额忽略；pass 列表只读取一次', () => {
    const store = makeStore([
      { id: 'army.a', kind: 'army', factionId: 'enemy', supply: { toll: 10 } },
      { id: 'pass.zero', kind: 'pass', factionId: 'enemy', supply: { toll: 0 } }
    ]);
    const system = makeSystem(store);
    const result = system.settle({ day: 2 });
    expect(result.transfers).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(store.listCalls).toBe(1);
  });
});

describe('PassTariffSystem 序列化', () => {
  it('serialize/restore 只带 lastSettledDay', () => {
    const system = makeSystem(makeStore());
    system.settle({ day: 4 });
    expect(system.serialize()).toEqual({ lastSettledDay: 4 });
    const restored = makeSystem(makeStore());
    restored.restore({ lastSettledDay: 4, supply: { toll: 99 } });
    expect(restored.lastSettledDay).toBe(4);
    expect(restored.settle({ day: 4 }).skipped).toBe('alreadySettled');
  });

  it('默认口径与配置合并', () => {
    expect(DEFAULT_TARIFF).toMatchObject({ rate: 0.05, resource: 'food', sweepToCity: true });
    const system = new PassTariffSystem({ tariff: { rate: 0.2 } });
    expect(system.config).toMatchObject({ rate: 0.2, defaultRate: 0.05, resource: 'food', defaultCargoValue: 100 });
  });
});

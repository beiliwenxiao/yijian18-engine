import { describe, it, expect } from 'vitest';
import {
  toLogisticsArmy,
  createArmyLogisticsAdapter,
  createAutoResupplyAdapter,
  createCityWarAdapters
} from './WarLogisticsAdapters.js';

function makeUnits() {
  return [
    { id: 'army.a', kind: 'army', roster: { melee: 10 }, morale: 70, supply: { food: 100, cap: 300 } },
    { id: 'army.b', kind: 'army', roster: { cavalry: 2 }, morale: 50, factionId: 'bandit', ai: true },
    { id: 'pass.1', kind: 'pass', roster: {} }
  ];
}

describe('WarLogisticsAdapters', () => {
  it('toLogisticsArmy 只搬运账本字段并保留阵营/AI 标记', () => {
    const army = toLogisticsArmy({ id: 7, roster: { melee: 3 }, morale: '60', factionId: 'bandit', ai: true });
    expect(army).toMatchObject({
      id: '7',
      roster: { melee: 3 },
      morale: 60,
      factionId: 'bandit',
      control: 'ai',
      ai: true
    });
    expect(toLogisticsArmy(null)).toBeNull();
  });

  it('军团适配器只列出 army 单位，写入时回写 supply/morale/manpower', () => {
    const units = makeUnits();
    const adapter = createArmyLogisticsAdapter({
      listUnits: () => units,
      getUnit: id => units.find(unit => unit.id === id) || null
    });
    expect(adapter.listArmies().map(army => army.id)).toEqual(['army.a', 'army.b']);

    const ok = adapter.writeArmy('army.a', {
      supply: { food: 42, cap: 300 },
      morale: 88,
      manpower: 9,
      initialManpower: 20
    });
    expect(ok).toBe(true);
    expect(units[0].supply.food).toBe(42);
    expect(units[0].morale).toBe(88);
    expect(units[0].manpower).toBe(9);
    expect(units[0].initialManpower).toBe(20);
    expect(adapter.writeArmy('missing', {})).toBe(false);
  });

  it('AI 自动输送按 aiSupplyEfficiency 乘算，玩家 1:1，未知军团 0', () => {
    const armies = {
      player: { id: 'player', factionId: 'yellow_turban' },
      ai: { id: 'ai', factionId: 'bandit' }
    };
    const deliver = createAutoResupplyAdapter({
      resolveArmy: id => armies[id] || null,
      isAiArmy: army => String(army.factionId) !== 'yellow_turban',
      aiSupplyEfficiency: 0.5
    });
    expect(deliver('player', 10)).toBe(10);
    expect(deliver('ai', 10)).toBe(5);
    expect(deliver('ai', 7)).toBe(3);
    expect(deliver('unknown', 10)).toBe(0);
    expect(deliver('player', 0)).toBe(0);
  });

  it('未显式 isAiArmy 时按 control/ai 标记判定', () => {
    const deliver = createAutoResupplyAdapter({
      resolveArmy: id => ({ ai: id === 'ai', control: id === 'ai' ? 'ai' : undefined }),
      aiSupplyEfficiency: 0.25
    });
    expect(deliver('ai', 8)).toBe(2);
    expect(deliver('human', 8)).toBe(8);
  });

  it('城池/战果适配器写入 battleLedgers 且保留 warState 其它键', () => {
    let warState = { battles: { b1: { winnerFactionId: 'player' } }, casualties: { b1: 5 } };
    const adapters = createCityWarAdapters({
      readWarState: () => warState,
      writeWarState: next => { warState = next; }
    });
    expect(adapters.readLedger('b1')).toBeNull();
    expect(adapters.writeLedger('b1', { defeated: 3, fled: 1 })).toBe(true);
    expect(warState.battles.b1.winnerFactionId).toBe('player');
    expect(warState.casualties.b1).toBe(5);
    expect(adapters.readLedger('b1')).toEqual({ defeated: 3, fled: 1 });
  });

  it('配置缺省时返回安全空实现', () => {
    const adapters = createCityWarAdapters();
    expect(adapters.readCities()).toEqual([]);
    expect(adapters.commitCities([])).toBe(false);
    expect(adapters.readArmy('x')).toBeNull();
    expect(adapters.writeArmy('x', {})).toBe(false);
    expect(adapters.readLedger('x')).toBeNull();
    expect(adapters.writeLedger('x', {})).toBe(false);
  });
});

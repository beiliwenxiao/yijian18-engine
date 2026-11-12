/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-10
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { CompanionSquadSystem, COMPANION_STANCES, resolveCompanionCapacity } from './CompanionSquadSystem.js';

function createSystem(overrides = {}) {
  let now = 0;
  const events = [];
  const spawned = [];
  const system = new CompanionSquadSystem({
    rule: overrides.rule,
    now: () => now,
    getCommand: overrides.getCommand || (() => 60),
    getRankValue: overrides.getRankValue || (() => 20),
    spawnMember: overrides.spawnMember || (unitId => {
      spawned.push(unitId);
      return true;
    }),
    onEvent: (event, payload) => events.push({ event, payload })
  });
  return { system, events, spawned, advance: ms => { now += ms; }, get now() { return now; } };
}

describe('M3 3A · CompanionSquadSystem 容量', () => {
  it('上限 = floor((统率 + 官职值) / 2)，封顶 100', () => {
    const { system } = createSystem({ getCommand: () => 88, getRankValue: () => 0 });
    expect(system.getCapacity()).toBe(44);
    const maxed = createSystem({ getCommand: () => 100, getRankValue: () => 100 });
    expect(maxed.system.getCapacity()).toBe(100);
    const clamped = createSystem({
      rule: { capacityMax: 30 },
      getCommand: () => 100,
      getRankValue: () => 100
    });
    expect(clamped.system.getCapacity()).toBe(30);
  });

  it('纯函数口径唯一：封顶 100、非负、旧写法 10+floor(command/10) 不再生效', () => {
    expect(resolveCompanionCapacity({ command: 20, rankValue: 0 })).toBe(10);
    expect(resolveCompanionCapacity({ command: 88, rankValue: 0 })).toBe(44);
    expect(resolveCompanionCapacity({ command: 100, rankValue: 100 })).toBe(100);
    expect(resolveCompanionCapacity({ command: 100, rankValue: 100, capacityMax: 80 })).toBe(80);
    expect(resolveCompanionCapacity({ command: 80, rankValue: 0 })).toBe(40);
    expect(resolveCompanionCapacity({ command: -10, rankValue: -10 })).toBe(0);
  });

  it('超出上限的名册/编入被拒绝（不静默截断）', () => {
    const { system } = createSystem({ getCommand: () => 20, getRankValue: () => 0 });
    expect(system.getCapacity()).toBe(10);
    const ids = Array.from({ length: 11 }, (_, index) => `u${index}`);
    expect(system.setRoster({ unitIds: ids })).toMatchObject({ ok: false, code: 'capacityExceeded' });
    expect(system.setRoster({ unitIds: ids.slice(0, 10) })).toMatchObject({ ok: true, count: 10 });
    expect(system.assign(['u10'])).toMatchObject({ ok: false, code: 'capacityExceeded' });
  });
});

describe('M3 3A · CompanionSquadSystem 士气账', () => {
  it('初值 60；休整 +3/日不重复；驻扎同日取高不叠乘', () => {
    const { system } = createSystem();
    expect(system.getSnapshot().morale).toBe(60);
    expect(system.rest(3)).toMatchObject({ ok: true, applied: true });
    expect(system.getSnapshot().morale).toBe(63);
    expect(system.rest(3)).toMatchObject({ ok: true, applied: false });
    expect(system.camp(3)).toMatchObject({ ok: true, applied: false });
    // 同一天先驻扎(+2)再休整(+3)：只补差 1，不叠乘成 +5
    expect(system.camp(4)).toMatchObject({ ok: true, applied: true });
    expect(system.getSnapshot().morale).toBe(65);
    expect(system.rest(4)).toMatchObject({ ok: true, applied: true });
    expect(system.getSnapshot().morale).toBe(66);
  });

  it('阵亡 -2/人、单场封顶 -10；胜利 +5 按 battleId 幂等', () => {
    const { system } = createSystem();
    system.setRoster({ unitIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    for (let index = 0; index < 7; index += 1) {
      system.reportMemberDowned(['a', 'b', 'c', 'd', 'e', 'f', 'g'][index], { battleId: 'b1' });
    }
    expect(system.getSnapshot().morale).toBe(50);
    system.reportMemberDowned('a', { battleId: 'b2' });
    expect(system.getSnapshot().morale).toBe(48);
    expect(system.reportBattleResult({ battleId: 'b2', victory: true })).toMatchObject({ applied: true });
    expect(system.getSnapshot().morale).toBe(53);
    expect(system.reportBattleResult({ battleId: 'b2', victory: true })).toMatchObject({ idempotent: true });
    expect(system.getSnapshot().morale).toBe(53);
  });

  it('士气 < 10 锁定防守档并拒绝冲锋档', () => {
    const { system } = createSystem();
    system.setRoster({ unitIds: ['a'], morale: 9 });
    expect(system.setStance('charge')).toMatchObject({ ok: false, code: 'moraleLocked' });
    expect(system.setStance('assault')).toMatchObject({ ok: false, code: 'moraleLocked' });
    expect(system.setStance('hold')).toMatchObject({ ok: true, stance: 'hold' });
  });

  it('连续 3 日未休整 -3/日；休整清零计时', () => {
    const { system } = createSystem();
    system.setRoster({ unitIds: ['a'], day: 1 });
    expect(system.onDayChanged(2)).toMatchObject({ decayed: false });
    expect(system.onDayChanged(4)).toMatchObject({ decayed: true });
    expect(system.getSnapshot().morale).toBe(57);
    expect(system.onDayChanged(4)).toMatchObject({ idempotent: true });
    system.rest(4);
    expect(system.onDayChanged(5)).toMatchObject({ decayed: false });
  });
});

describe('M3 3A · CompanionSquadSystem 五档与冲锋', () => {
  it('五档全集可切；冲锋 4s 后自动转进攻', () => {
    const { system, events } = createSystem();
    for (const stance of COMPANION_STANCES) {
      expect(system.setStance(stance.key)).toMatchObject({ ok: true, stance: stance.key });
    }
    expect(system.setStance('charge')).toMatchObject({ ok: true, stance: 'charge' });
    expect(system.tick(3999)).toMatchObject({ chargeConverted: false });
    expect(system.tick(1)).toMatchObject({ chargeConverted: true });
    expect(system.getStance()).toBe('assault');
    expect(events.some(entry => entry.event === 'companion.stanceChanged' && entry.payload.to === 'assault')).toBe(true);
  });

  it('玩家倒地自动防守，起立恢复原档', () => {
    const { system } = createSystem();
    system.setStance('assault');
    system.setPlayerDowned(true);
    expect(system.getStance()).toBe('hold');
    system.setPlayerDowned(false);
    expect(system.getStance()).toBe('assault');
  });
});

describe('M3 3A · CompanionSquadSystem 补位', () => {
  it('阵亡扣统兵池 1 兵，约 8s 后补位；兵源枯竭中断并上报', () => {
    const { system, spawned, advance, events } = createSystem();
    system.setRoster({ unitIds: ['a', 'b'], armyPool: { troops: 1, cap: 5 } });
    system.reportMemberDowned('a', { battleId: 'b1' });
    expect(system.armyPool.troops).toBe(0);
    advance(7999);
    expect(system.tick(0).reinforced).toEqual([]);
    advance(1);
    expect(system.tick(0).reinforced).toEqual(['a']);
    expect(spawned).toEqual(['a']);
    expect(system.members.get('a').state).toBe('active');

    system.reportMemberDowned('b', { battleId: 'b1' });
    expect(events.some(entry => entry.event === 'companion.replenishBlocked')).toBe(true);
    expect(system.reinforcements.length).toBe(0);
  });
});

describe('M3 3A · CompanionSquadSystem 快照', () => {
  it('serialize/restore 往返保持名册、档位、士气与统兵池', () => {
    const { system } = createSystem();
    system.setRoster({ unitIds: ['a', 'b'], morale: 42, armyPool: { troops: 3, cap: 8 } });
    system.setStance('retreat');
    const snapshot = system.serialize();

    const fresh = createSystem().system;
    expect(fresh.restore(snapshot)).toMatchObject({ ok: true });
    expect(fresh.unitIds).toEqual(['a', 'b']);
    expect(fresh.getStance()).toBe('retreat');
    expect(fresh.getSnapshot().morale).toBe(42);
    expect(fresh.armyPool).toEqual({ troops: 3, cap: 8, replenishFrom: [] });
    expect(fresh.restore(null)).toMatchObject({ ok: false, code: 'invalidSnapshot' });
  });
});

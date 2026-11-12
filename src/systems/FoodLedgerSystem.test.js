import { describe, it, expect } from 'vitest';
import {
  FoodLedgerSystem,
  SUPPLY_STATES,
  DEFAULT_LOGISTICS_CONFIG,
  resolveUnitCategory,
  normalizeRoster,
  computeDailyUpkeep
} from './FoodLedgerSystem.js';

function makeArmy(overrides = {}) {
  return {
    id: 'army.s02.guard',
    roster: { melee: 100 },
    manpower: 100,
    initialManpower: 100,
    morale: 80,
    supply: { food: 1000, cap: 2000 },
    ...overrides
  };
}

function makeSystem({ config = null, armies = [makeArmy()], rng = () => 0.9, autoResupply = null } = {}) {
  const events = [];
  let day = 1;
  const service = new FoodLedgerSystem({
    config,
    armies,
    now: () => 0,
    getDay: () => day,
    rng,
    autoResupply,
    onEvent: (event, payload) => events.push({ event, payload })
  });
  return { service, events, setDay: value => { day = value; }, getDay: () => day };
}

describe('FoodLedgerSystem 日耗公式', () => {
  it('兵种类别解析：配置优先，其次按命名启发', () => {
    expect(resolveUnitCategory('s02_yellow_turban_soldier')).toBe('melee');
    expect(resolveUnitCategory('yt_archer')).toBe('archer');
    expect(resolveUnitCategory('yellow_turban_cavalry')).toBe('cavalry');
    expect(resolveUnitCategory('骑')).toBe('cavalry');
    expect(resolveUnitCategory('神秘兵种', { unitTypeCategory: { 神秘兵种: 'archer' } })).toBe('archer');
  });

  it('roster 支持对象与数组两种形态', () => {
    expect(normalizeRoster({ melee: 3, archer: 2 })).toEqual([
      { unitType: 'melee', count: 3 },
      { unitType: 'archer', count: 2 }
    ]);
    expect(normalizeRoster([{ unitType: 'melee', count: 5 }, { count: 9 }])).toEqual([
      { unitType: 'melee', count: 5 }
    ]);
    expect(normalizeRoster(null)).toEqual([]);
  });

  it('100 人步兵团日耗 80；混合编制按 0.8 / 0.8 / 2.4 累加', () => {
    expect(computeDailyUpkeep({ melee: 100 })).toBe(80);
    expect(computeDailyUpkeep({ melee: 50, archer: 20, cavalry: 5 })).toBe(68);
    expect(computeDailyUpkeep({ melee: 10 }, { ...DEFAULT_LOGISTICS_CONFIG, armyBaseUpkeep: 4 })).toBe(12);
  });

  it('军团注册补齐 initialManpower 与默认 supply 字段', () => {
    const { service } = makeSystem({ armies: [{ id: 'a1', roster: { melee: 30 } }] });
    const army = service.getArmy('a1');
    expect(army.manpower).toBe(30);
    expect(army.initialManpower).toBe(30);
    expect(army.supply.state).toBe(SUPPLY_STATES.NORMAL);
    expect(army.supply.cap).toBe(DEFAULT_LOGISTICS_CONFIG.campStorage.base);
  });

  it('queryDays 给出可支撑天数', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 400, cap: 2000 } })] });
    const info = service.queryDays('army.s02.guard');
    expect(info.upkeep).toBe(80);
    expect(info.days).toBeCloseTo(5, 5);
  });
});

describe('FoodLedgerSystem 9A 日结四档', () => {
  it('饱食档扣粮 + 仓储损耗，士气向基准回升', () => {
    const { service } = makeSystem({ armies: [makeArmy({ morale: 60 })] });
    const result = service.settleDay({ day: 1 });
    const entry = result.armies[0];
    expect(entry.spoil).toBe(3);
    expect(entry.food).toBe(917);
    expect(entry.state).toBe(SUPPLY_STATES.NORMAL);
    expect(entry.morale).toBe(65);
    expect(service.getArmy('army.s02.guard').supply.days).toBeCloseTo(11.5, 5);
  });

  it('紧张档：库存不足 1 日耗 → 清零 + 士气 -3 + supplyLow', () => {
    const { service, events } = makeSystem({ armies: [makeArmy({ supply: { food: 40, cap: 2000 } })] });
    const entry = service.settleDay({ day: 1 }).armies[0];
    expect(entry.state).toBe(SUPPLY_STATES.TIGHT);
    expect(entry.food).toBe(0);
    expect(entry.morale).toBe(77);
    expect(events.some(item => item.event === 'army.supplyLow')).toBe(true);
  });

  it('断粮前 3 日只掉士气、不减员（护栏②）', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    const entry = service.settleDay({ day: 10 }).armies[0];
    expect(entry.state).toBe(SUPPLY_STATES.EMPTY);
    expect(entry.lost).toBe(0);
    expect(entry.morale).toBe(72);
    const army = service.getArmy('army.s02.guard');
    expect(army.supply.starved).toBe(true);
    expect(army.manpower).toBe(100);
    expect(service.listScattered({ day: 10 })).toHaveLength(0);
  });

  it('第 4 日起转饥溃：战力 ×0.7、逃散 3.5% 起逐日递增并封顶 8%', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    const trace = [];
    for (let day = 1; day <= 7; day += 1) {
      const entry = service.settleDay({ day }).armies[0];
      trace.push({ state: entry.state, lost: entry.lost, mult: entry.combatPowerMultiplier });
    }
    expect(trace).toEqual([
      { state: SUPPLY_STATES.EMPTY, lost: 0, mult: 1 },
      { state: SUPPLY_STATES.EMPTY, lost: 0, mult: 1 },
      { state: SUPPLY_STATES.EMPTY, lost: 0, mult: 1 },
      { state: SUPPLY_STATES.COLLAPSE, lost: 3, mult: 0.7 },
      { state: SUPPLY_STATES.COLLAPSE, lost: 4, mult: 0.7 },
      { state: SUPPLY_STATES.COLLAPSE, lost: 6, mult: 0.7 },
      { state: SUPPLY_STATES.COLLAPSE, lost: 6, mult: 0.7 }
    ]);
    // 80 - 8×3（断粮） - 15×4（饥溃）＜0 → 钳制到 0
    expect(service.getArmy('army.s02.guard').morale).toBe(0);
  });

  it('兵力地板 30%：长期饥溃也不跌破建制底线', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    for (let day = 1; day <= 30; day += 1) service.settleDay({ day });
    expect(service.getArmy('army.s02.guard').manpower).toBe(30);
  });

  it('noDesertion 白名单不产生逃散也不写散兵池', () => {
    const army = makeArmy({ supply: { food: 0, cap: 2000, noDesertion: true } });
    const { service } = makeSystem({ armies: [army] });
    for (let day = 1; day <= 6; day += 1) service.settleDay({ day });
    expect(service.getArmy('army.s02.guard').manpower).toBe(100);
    expect(service.listScattered({ day: 6 })).toHaveLength(0);
  });

  it('同一日重复结算幂等（alreadySettled 跳过，不双扣）', () => {
    const { service } = makeSystem();
    service.settleDay({ day: 5 });
    const second = service.settleDay({ day: 5 });
    expect(second.armies[0].skipped).toBe(true);
    expect(second.armies[0].code).toBe('alreadySettled');
    expect(service.getArmy('army.s02.guard').supply.food).toBe(917);
  });

  it('catchUp 最多补算 maxCatchUpDays 天', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    const result = service.catchUp({ fromDay: 1, toDay: 10 });
    expect(result.days).toBe(7);
    expect(service.getArmy('army.s02.guard').supply.settledDay).toBe(7);
    expect(service.getArmy('army.s02.guard').manpower).toBeLessThan(100);
  });

  it('断粮锁：empty / collapse 拒绝战略指令', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    expect(service.canIssueStrategicOrder('army.s02.guard').ok).toBe(true);
    service.settleDay({ day: 1 });
    const check = service.canIssueStrategicOrder('army.s02.guard');
    expect(check.ok).toBe(false);
    expect(check.code).toBe('armyStarved');
    expect(service.canIssueStrategicOrder('unknown').code).toBe('unknownArmy');
  });

  it('自动输送：补给到位当日止血并清空 emptyDays', () => {
    const { service } = makeSystem({
      armies: [makeArmy({ supply: { food: 0, cap: 2000, autoResupply: true } })],
      autoResupply: () => 200
    });
    const entry = service.settleDay({ day: 1 }).armies[0];
    expect(entry.delivered).toBe(200);
    expect(entry.state).toBe(SUPPLY_STATES.NORMAL);
    expect(entry.lost).toBe(0);
    expect(service.getArmy('army.s02.guard').supply.emptyDays).toBe(0);
  });
});

describe('FoodLedgerSystem P15 散兵池与招回', () => {
  it('regroup 招回窗口内散兵并清池', () => {
    const { service, events } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    for (let day = 1; day <= 4; day += 1) service.settleDay({ day });
    expect(service.getArmy('army.s02.guard').manpower).toBe(97);
    const pool = service.listScattered({ day: 4 });
    expect(pool).toHaveLength(1);
    expect(pool[0].count).toBe(3);
    expect(pool[0].expiresDay).toBe(34);

    const regrouped = service.regroup({ armyId: 'army.s02.guard', day: 20 });
    expect(regrouped.returned).toBe(3);
    expect(service.getArmy('army.s02.guard').manpower).toBe(100);
    expect(service.listScattered({ day: 20 })).toHaveLength(0);
    expect(events.some(item => item.event === 'army.regrouped')).toBe(true);
  });

  it('过期散兵不在 listScattered 中显示，也不可招回', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    for (let day = 1; day <= 4; day += 1) service.settleDay({ day });
    expect(service.listScattered({ armyId: 'army.s02.guard', day: 41 })).toHaveLength(0);
    expect(service.regroup({ armyId: 'army.s02.guard', day: 41 }).returned).toBe(0);
  });
});

describe('FoodLedgerSystem 9C 烧毁与抢掠', () => {
  it('常规焚粮 60%，20% 可抢回', () => {
    const { service, events } = makeSystem();
    const target = { kind: 'camp', id: 'camp.a', stock: { food: 100, wood: 10 } };
    const result = service.raze({ target, hasFireSource: true });
    expect(result.razed).toEqual({ food: 60, wood: 6 });
    expect(result.recovered).toEqual({ food: 12, wood: 1 });
    expect(target.stock).toEqual({ food: 40, wood: 4 });
    expect(events.some(item => item.event === 'army.supplyRazed')).toBe(true);
  });

  it('夜袭 90% / 守军在场 30% / 守方胜 0%', () => {
    const { service } = makeSystem();
    const night = { stock: { food: 100 } };
    expect(service.raze({ target: night, night: true, hasFireSource: true }).razed.food).toBe(90);
    const defended = { stock: { food: 100 } };
    expect(service.raze({ target: defended, defended: true, hasFireSource: true }).razed.food).toBe(30);
    const held = { stock: { food: 100 } };
    const result = service.raze({ target: held, defenderWins: true, hasFireSource: true });
    expect(result.razed).toEqual({});
    expect(held.stock.food).toBe(100);
  });

  it('无火种拒绝焚粮；可配置关闭火种要求', () => {
    const { service } = makeSystem();
    expect(service.raze({ target: { stock: { food: 100 } } }).code).toBe('fireSourceRequired');
    const permissive = makeSystem({
      config: { raze: { ...DEFAULT_LOGISTICS_CONFIG.raze, requiresFireSource: false } }
    });
    expect(permissive.service.raze({ target: { stock: { food: 100 } } }).razed.food).toBe(60);
  });

  it('operationId 幂等：重复烧毁不二次扣减', () => {
    const { service } = makeSystem();
    const target = { stock: { food: 100 } };
    service.raze({ target, hasFireSource: true, operationId: 'raze-1' });
    const again = service.raze({ target, hasFireSource: true, operationId: 'raze-1' });
    expect(again.idempotent).toBe(true);
    expect(target.stock.food).toBe(40);
  });

  it('forage 仅断粮档可用，得日耗 ×0.6 直接入军营库存', () => {
    const { service, events } = makeSystem({
      armies: [makeArmy({ supply: { food: 0, cap: 2000 } })],
      rng: () => 0
    });
    service.settleDay({ day: 1 });
    const result = service.forage({ armyId: 'army.s02.guard', operationId: 'forage-1' });
    expect(result.ok).toBe(true);
    expect(result.gained).toBe(48);
    expect(result.moraleCost).toBe(6);
    expect(result.renownCost).toBe(3);
    expect(result.alerted).toBe(true);
    expect(service.getArmy('army.s02.guard').supply.food).toBe(48);
    expect(events.some(item => item.event === 'army.foraged')).toBe(true);
    expect(service.forage({ armyId: 'army.s02.guard', operationId: 'forage-1' }).idempotent).toBe(true);

    const wellFed = makeSystem({ armies: [makeArmy()] });
    expect(wellFed.service.forage({ armyId: 'army.s02.guard' }).code).toBe('notStarved');
  });
});

describe('FoodLedgerSystem 9B 军营存取', () => {
  it('军营容量按等级增长并封顶 2000', () => {
    const { service } = makeSystem();
    expect(service.registerCamp({ campId: 'camp.a', level: 1 }).camp.capacity).toBe(500);
    expect(service.registerCamp({ campId: 'camp.b', level: 3 }).camp.capacity).toBe(1000);
    expect(service.registerCamp({ campId: 'camp.c', level: 10 }).camp.capacity).toBe(2000);
    expect(service.registerCamp({}).code).toBe('campIdRequired');
  });

  it('deposit 扣军团粮入仓；库存/容量不足拒绝且不扣减', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 200, cap: 2000 } })] });
    service.registerCamp({ campId: 'camp.a', level: 1, stock: { food: 400 } });
    const ok = service.deposit({ armyId: 'army.s02.guard', campId: 'camp.a', entries: { food: 100 } });
    expect(ok.ok).toBe(true);
    expect(service.getArmy('army.s02.guard').supply.food).toBe(100);
    expect(service.getCamp('camp.a').stock.food).toBe(500);

    const overflow = service.deposit({ armyId: 'army.s02.guard', campId: 'camp.a', entries: { food: 100 } });
    expect(overflow.code).toBe('campCapacityExceeded');
    expect(service.getArmy('army.s02.guard').supply.food).toBe(100);
    expect(service.getCamp('camp.a').stock.food).toBe(500);

    const tooMuch = service.deposit({ armyId: 'army.s02.guard', campId: 'camp.a', entries: { food: 500 } });
    expect(tooMuch.code).toBe('insufficientSupply');
    expect(service.deposit({ armyId: 'army.s02.guard', campId: 'missing', entries: { food: 1 } }).code).toBe('unknownCamp');
  });

  it('withdraw 从军营取粮回军团库存，受 cap 限制；operationId 幂等', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 60 } })] });
    service.registerCamp({ campId: 'camp.a', level: 1, stock: { food: 300 } });
    const result = service.withdraw({ armyId: 'army.s02.guard', campId: 'camp.a', entries: { food: 100 }, operationId: 'w1' });
    expect(result.ok).toBe(true);
    expect(service.getArmy('army.s02.guard').supply.food).toBe(60);
    expect(service.getCamp('camp.a').stock.food).toBe(200);
    expect(service.withdraw({ armyId: 'army.s02.guard', campId: 'camp.a', entries: { food: 100 }, operationId: 'w1' }).idempotent).toBe(true);
    expect(service.withdraw({ armyId: 'army.s02.guard', campId: 'camp.a', entries: { food: 500 } }).code).toBe('insufficientCampStock');
  });
});

describe('FoodLedgerSystem 存档', () => {
  it('serialize / restore 保留军团、军营、散兵池与幂等键', () => {
    const { service } = makeSystem({ armies: [makeArmy({ supply: { food: 0, cap: 2000 } })] });
    service.registerCamp({ campId: 'camp.a', level: 2, stock: { food: 120 } });
    for (let day = 1; day <= 4; day += 1) service.settleDay({ day });
    service.raze({ target: { stock: { food: 10 } }, hasFireSource: true, operationId: 'raze-x' });
    const snapshot = service.serialize();

    const restored = new FoodLedgerSystem({ getDay: () => 4 });
    const result = restored.restore(snapshot);
    expect(result.ok).toBe(true);
    expect(restored.getArmy('army.s02.guard').supply.food).toBe(0);
    expect(restored.getArmy('army.s02.guard').manpower).toBe(97);
    expect(restored.getCamp('camp.a').stock.food).toBe(120);
    expect(restored.listScattered({ day: 4 })).toHaveLength(1);
    expect(restored.raze({ target: { stock: { food: 10 } }, hasFireSource: true, operationId: 'raze-x' }).idempotent).toBe(true);
  });

  it('旧档缺字段（无 camps / scatteredPool）仍可恢复', () => {
    const restored = new FoodLedgerSystem({ getDay: () => 1 });
    const result = restored.restore({ armies: [makeArmy()] });
    expect(result.ok).toBe(true);
    expect(restored.getCamp('missing')).toBeNull();
    expect(restored.listScattered({ day: 1 })).toEqual([]);
    expect(restored.restore(null).code).toBe('invalidSnapshot');
  });
});

describe('FoodLedgerSystem 战争物资核销（B4）', () => {
  it('营地仓优先，食物缺口再走军团随身粮；非食物只认营地仓', () => {
    const { service } = makeSystem({ armies: [{ id: 'a1', roster: { melee: 10 }, supply: { food: 30, cap: 500 } }] });
    service.registerCamp({ campId: 'camp.a', level: 2, stock: { food: 10, herb: 4, wood: 6 } });

    const plan = service.previewConsume({ campId: 'camp.a', armyId: 'a1', entries: { 'resource.food': 18, 'resource.herb': 3 } });
    expect(plan.ok).toBe(true);
    expect(plan.fromCamp).toEqual({ food: 10, herb: 3 });
    expect(plan.fromArmy).toEqual({ food: 8 });

    const consumed = service.consume({ campId: 'camp.a', armyId: 'a1', entries: { 'resource.food': 18, 'resource.herb': 3 }, operationId: 'cost:test' });
    expect(consumed.ok).toBe(true);
    expect(service.getCamp('camp.a').stock).toMatchObject({ food: 0, herb: 1, wood: 6 });
    expect(service.getArmy('a1').supply.food).toBe(22);
  });

  it('不足返回 missing；同 operationId 幂等不重复扣', () => {
    const { service } = makeSystem({ armies: [{ id: 'a1', roster: { melee: 10 }, supply: { food: 5, cap: 500 } }] });
    service.registerCamp({ campId: 'camp.a', level: 1, stock: { food: 10, herb: 1 } });

    const missing = service.consume({ campId: 'camp.a', armyId: 'a1', entries: { food: 20, herb: 3 } });
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('insufficientStock');
    expect(missing.missing).toEqual({ food: 5, herb: 2 });
    expect(service.getCamp('camp.a').stock).toMatchObject({ food: 10, herb: 1 });

    expect(service.consume({ campId: 'camp.a', armyId: 'a1', entries: { food: 12 }, operationId: 'cost:idem' }).ok).toBe(true);
    const again = service.consume({ campId: 'camp.a', armyId: 'a1', entries: { food: 12 }, operationId: 'cost:idem' });
    expect(again.idempotent).toBe(true);
    expect(service.getCamp('camp.a').stock.food).toBe(0);
    expect(service.getArmy('a1').supply.food).toBe(3);
  });
});

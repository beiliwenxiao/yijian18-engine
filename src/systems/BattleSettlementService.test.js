import { describe, it, expect } from 'vitest';
import {
  BattleSettlementService,
  resolveDefeatMoralePenalty,
  resolveFledMoralePenalty,
  seededRand
} from './BattleSettlementService.js';

const DAY = 86400000;

function makeArmy(overrides = {}) {
  return {
    id: 'army.s02.guard',
    factionId: 'yellow_turban',
    commanderHeroId: 'hero.zhangjiao',
    morale: 80,
    manpower: 100,
    roster: { 'unit.spear': 60, 'unit.archer': 40 },
    supply: { grain: 100, coin: 50 },
    ...overrides
  };
}

function makeService(options = {}) {
  const events = [];
  const scattered = [];
  const caches = [];
  const reputation = [];
  let now = 0;
  const service = new BattleSettlementService({
    now: () => now,
    getDay: () => 1,
    addScattered: entry => scattered.push(entry),
    addSupplyCache: entry => caches.push(entry),
    adjustReputation: entry => reputation.push(entry),
    onEvent: (event, payload) => events.push({ event, payload }),
    ...options
  });
  return {
    service,
    events,
    scattered,
    caches,
    reputation,
    advance: ms => { now += ms; },
    setNow: value => { now = value; }
  };
}

describe('BattleSettlementService 纯函数', () => {
  it('战败士气阶梯 -10×n 封顶 -60', () => {
    expect(resolveDefeatMoralePenalty(1)).toBe(10);
    expect(resolveDefeatMoralePenalty(3)).toBe(30);
    expect(resolveDefeatMoralePenalty(9)).toBe(60);
    expect(resolveDefeatMoralePenalty(0)).toBe(0);
  });

  it('逃亡士气阶梯 -5/-10/-15 封顶 -30', () => {
    expect(resolveFledMoralePenalty(1)).toBe(5);
    expect(resolveFledMoralePenalty(2)).toBe(10);
    expect(resolveFledMoralePenalty(3)).toBe(15);
    expect(resolveFledMoralePenalty(8)).toBe(30);
  });

  it('battleId 种子随机稳定（读档重放一致）', () => {
    expect(seededRand('battle.s04', 'troopLoss')).toBe(seededRand('battle.s04', 'troopLoss'));
    expect(seededRand('battle.s04', 'troopLoss')).not.toBe(seededRand('battle.s05', 'troopLoss'));
  });
});

describe('BattleSettlementService 战败结算（6D）', () => {
  it('首次战败：士气 -10、按比例减兵、丢辎重并生成缓存', () => {
    const { service, events, scattered, caches } = makeService();
    const army = makeArmy();
    const result = service.settleBattle({ battleId: 'battle.s04', event: 'defeat', army, initialManpower: 100 });
    expect(result.ok).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.morale).toBe(70);
    expect(army.morale).toBe(70);
    expect(result.lostTroops).toBeGreaterThanOrEqual(8);
    expect(result.lostTroops).toBeLessThanOrEqual(18);
    expect(army.manpower).toBe(100 - result.lostTroops);
    expect(result.scattered).toBe(Math.floor(result.lostTroops * 0.6));
    expect(scattered[0]).toMatchObject({ armyId: 'army.s02.guard', battleId: 'battle.s04' });
    expect(Object.keys(result.lostSupply).length).toBeGreaterThan(0);
    expect(caches.length).toBe(1);
    expect(caches[0].expiresAt).toBe(600 * 1000);
    expect(events.map(entry => entry.event)).toEqual(['army.defeated']);
  });

  it('同一 battleId 重复结算幂等（读档不重复扣）', () => {
    const { service } = makeService();
    const army = makeArmy();
    const first = service.settleBattle({ battleId: 'battle.s04', event: 'defeat', army, initialManpower: 100 });
    const moraleAfter = army.morale;
    const manpowerAfter = army.manpower;
    const second = service.settleBattle({ battleId: 'battle.s04', event: 'defeat', army, initialManpower: 100 });
    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(army.morale).toBe(moraleAfter);
    expect(army.manpower).toBe(manpowerAfter);
    expect(second.ledger.events.defeat.lostTroops).toBe(first.lostTroops);
  });

  it('战败与逃亡各记各账，互不折算', () => {
    const { service } = makeService();
    const army = makeArmy();
    const defeat = service.settleBattle({ battleId: 'battle.s04', event: 'defeat', army, initialManpower: 100 });
    const fled = service.settleBattle({ battleId: 'battle.s04', event: 'fled', army, initialManpower: 100 });
    expect(fled.ok).toBe(true);
    expect(fled.idempotent).toBe(false);
    expect(defeat.moralePenalty).toBe(10);
    expect(fled.moralePenalty).toBe(5);
    expect(army.streak.defeat).toBe(1);
    expect(army.streak.fled).toBe(1);
    expect(army.fledRecord.length).toBe(1);
    expect(army.fledRecord[0].moraleBefore).toBe(70);
  });

  it('兵力地板 30%：触地板后只丢辎重不减兵', () => {
    const { service } = makeService();
    const army = makeArmy({ manpower: 30, roster: { 'unit.spear': 30 } });
    const result = service.settleBattle({ battleId: 'battle.floor', event: 'defeat', army, initialManpower: 100 });
    expect(result.lostTroops).toBe(0);
    expect(result.floorReached).toBe(true);
    expect(army.manpower).toBe(30);
    expect(Object.keys(result.lostSupply).length).toBeGreaterThan(0);
  });

  it('连续战败阶梯 + 胜利清零', () => {
    const { service } = makeService();
    const army = makeArmy({ morale: 100 });
    const first = service.settleBattle({ battleId: 'b1', event: 'defeat', army, initialManpower: 100 });
    const second = service.settleBattle({ battleId: 'b2', event: 'defeat', army, initialManpower: 100 });
    expect(first.morale).toBe(90);
    expect(second.moralePenalty).toBe(20);
    expect(second.morale).toBe(70);
    const victory = service.applyVictory({ army, battleId: 'b3' });
    expect(victory.cleared).toBe(2);
    expect(army.streak.defeat).toBe(0);
  });
});

describe('BattleSettlementService 洗刷 / 追回 / 序列化', () => {
  it('hybrid：白名单主将必须走剧情（force），非白名单自动洗刷一次', () => {
    const { service, reputation } = makeService();
    const storyArmy = makeArmy();
    service.settleBattle({ battleId: 'b1', event: 'fled', army: storyArmy, initialManpower: 100 });
    const blocked = service.redeem({ army: storyArmy });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('storyRedeemRequired');
    const forced = service.redeem({ army: storyArmy, force: true });
    expect(forced.ok).toBe(true);
    expect(forced.moraleRestored).toBeGreaterThanOrEqual(0);
    expect(forced.moraleRestored).toBeLessThanOrEqual(8);
    expect(storyArmy.streak.fled).toBe(0);
    expect(storyArmy.fledRecord[0].redeemed).toBe(true);
    expect(reputation[0].delta).toBe(3);

    const npcArmy = makeArmy({ id: 'army.npc', commanderHeroId: 'hero.general_li' });
    service.settleBattle({ battleId: 'b2', event: 'fled', army: npcArmy, initialManpower: 100 });
    const auto = service.autoRedeemOnVictory({ army: npcArmy });
    expect(auto.ok).toBe(true);
    expect(npcArmy.streak.fled).toBe(0);
  });

  it('一日内不可重复洗刷（无污点返回 noStigma）', () => {
    const { service } = makeService();
    const army = makeArmy({ commanderHeroId: 'hero.x' });
    service.settleBattle({ battleId: 'b1', event: 'fled', army, initialManpower: 100 });
    expect(service.redeem({ army }).ok).toBe(true);
    expect(service.redeem({ army }).code).toBe('noStigma');
  });

  it('辎重追回：窗口内按比例追回，过期/重复追回拒绝', () => {
    const { service, advance } = makeService({ rng: () => 0.1 });
    const army = makeArmy();
    const result = service.settleBattle({ battleId: 'b1', event: 'defeat', army, initialManpower: 100 });
    const caches = service.listSupplyCaches({ armyId: army.id });
    expect(caches.length).toBe(1);
    const recovered = service.recoverSupply({ cacheId: result.cache.cacheId, army });
    expect(recovered.ok).toBe(true);
    expect(service.recoverSupply({ cacheId: result.cache.cacheId, army }).code).toBe('alreadyRecovered');

    const second = service.settleBattle({ battleId: 'b2', event: 'defeat', army, initialManpower: 100 });
    advance(700 * 1000);
    expect(service.recoverSupply({ cacheId: second.cache.cacheId, army }).code).toBe('cacheExpired');
  });

  it('serialize/restore 后账本仍幂等', () => {
    const { service } = makeService();
    const army = makeArmy();
    service.settleBattle({ battleId: 'b1', event: 'defeat', army, initialManpower: 100 });
    const snapshot = service.serialize();
    const restored = new BattleSettlementService({ now: () => 0, getDay: () => 1 });
    expect(restored.restore(snapshot).ok).toBe(true);
    const replay = restored.settleBattle({ battleId: 'b1', event: 'defeat', army, initialManpower: 100 });
    expect(replay.idempotent).toBe(true);
  });

  it('缺省适配器时直接作用于传入 army（无外部写回）', () => {
    const { service } = makeService();
    const army = makeArmy();
    service.settleBattle({ battleId: 'b1', event: 'fled', army });
    expect(army.morale).toBe(75);
    expect(army.streak.fled).toBe(1);
  });
});

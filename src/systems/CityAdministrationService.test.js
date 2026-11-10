import { describe, it, expect } from 'vitest';
import {
  CityAdministrationService,
  CITY_STATUS,
  computeCityProduction,
  computeRecruitableGain,
  resolveMoraleMultiplier,
  resolveLevelMultiplier,
  resolveRecruitCost
} from './CityAdministrationService.js';

function makeCity(overrides = {}) {
  return {
    id: 'city.s11_guangzong',
    name: '广宗',
    factionId: 'yellow_turban',
    buildingLevel: 2,
    resources: { food: 320, herb: 64, iron: 40, wood: 90, coin: 210 },
    morale: 60,
    damageRatio: 0.1,
    buildingDamage: { granary: 0.3 },
    population: { total: 100, recruitable: 0 },
    ...overrides
  };
}

const constructions = [
  { id: 'farm', production: { food: 10 } },
  { id: 'granary', production: { food: 6 } },
  { id: 'lumber', production: { wood: 5 } },
  { id: 'mine', production: { iron: 3 } }
];

function makeService(overrides = {}) {
  const events = [];
  let day = 1;
  const service = new CityAdministrationService({
    cities: [makeCity()],
    constructionDefinitions: constructions,
    now: () => 0,
    getDay: () => day,
    onEvent: (event, payload) => events.push({ event, payload }),
    ...overrides
  });
  return { service, events, setDay: value => { day = value; }, getDay: () => day };
}

describe('CityAdministrationService 产出公式', () => {
  it('民心乘数 / 等级乘数', () => {
    expect(resolveMoraleMultiplier(60)).toBeCloseTo(1.1, 5);
    expect(resolveMoraleMultiplier(0)).toBeCloseTo(0.5, 5);
    expect(resolveMoraleMultiplier(100)).toBeCloseTo(1.5, 5);
    expect(resolveLevelMultiplier(1)).toBe(1);
    expect(resolveLevelMultiplier(3)).toBeCloseTo(1.4, 5);
  });

  it('建筑产出 × 损毁 × 民心 × 等级；铜钱按人口', () => {
    const city = makeCity({ population: { total: 4200 }, buildings: { farm: 1, granary: 1, lumber: 1, mine: 1 } });
    const production = computeCityProduction(city, { constructionDefinitions: constructions });
    // food: farm 10 + granary 6×(1-0.3)=4.2 → 14.2 ×1.1×1.2 = 18.7 → 19
    expect(production.food).toBe(19);
    expect(production.wood).toBe(7);
    expect(production.iron).toBe(4);
    expect(production.coin).toBe(92);
  });

  it('可招募名额公式 floor(total/100×mult/10)+recover', () => {
    expect(computeRecruitableGain(4200, 60)).toBe(12);
    expect(computeRecruitableGain(0, 60)).toBe(8);
  });

  it('招募成本按兵种覆盖 perSoldier', () => {
    const base = resolveRecruitCost(null, 3);
    expect(base).toEqual({ coin: 24, food: 6, recruitable: 3 });
    const config = {
      perSoldier: { coin: 8, food: 2, recruitable: 1 },
      byUnitType: { archer: { coin: 12, food: 2, wood: 1 } }
    };
    expect(resolveRecruitCost('archer', 2, config)).toEqual({ coin: 24, food: 4, wood: 2, recruitable: 2 });
  });
});

describe('CityAdministrationService 日结（§4）', () => {
  it('①产出 ②民心 ③兵源，且幂等', () => {
    const { service, events } = makeService();
    const first = service.settleDay({ day: 2 });
    expect(first.ok).toBe(true);
    const city = service.getCity('city.s11_guangzong');
    expect(city.settledDay).toBe(2);
    expect(city.resources.coin).toBeGreaterThan(210);
    expect(city.population.recruitable).toBe(8);
    expect(events.map(entry => entry.event)).toContain('city.productionSettled');
    expect(events.map(entry => entry.event)).toContain('city.recruitPoolUpdated');

    const second = service.settleDay({ day: 2 });
    expect(second.cities[0].skipped).toBe(true);
    expect(second.cities[0].code).toBe('alreadySettled');
    expect(service.getCity('city.s11_guangzong').resources).toEqual(city.resources);
  });

  it('围城每日 -3 民心；饥荒按缺口扣 1~4', () => {
    const { service } = makeService({
      cities: [makeCity({ status: CITY_STATUS.UNDER_SIEGE, population: { total: 4200, recruitable: 0 }, resources: { food: 0, coin: 210 } })]
    });
    const result = service.settleDay({ day: 2 });
    const change = result.cities[0];
    expect(change.moraleDelta).toBeLessThanOrEqual(-4);
    expect(change.moraleAfter).toBeLessThanOrEqual(56);
  });

  it('军团补给扣城内 food，不越扣', () => {
    const { service } = makeService({
      cities: [makeCity({ resources: { food: 5, coin: 210 } })]
    });
    const result = service.settleDay({ day: 2, garrisonSupplies: [{ cityId: 'city.s11_guangzong', foodCost: 50 }] });
    expect(result.cities[0].supplyFood).toBeGreaterThanOrEqual(5);
    expect(service.getCity('city.s11_guangzong').resources.food).toBe(0);
  });

  it('战败 / 守城胜民心显式来源', () => {
    const { service } = makeService();
    expect(service.applyMoraleChange({ cityId: 'city.s11_guangzong', delta: -12, reason: 'defeat' }).morale).toBe(48);
    expect(service.applyMoraleChange({ cityId: 'city.s11_guangzong', delta: 8, reason: 'defenseWin' }).morale).toBe(56);
  });
});

describe('CityAdministrationService 招募三路径（§6）', () => {
  it('城内：扣名额 + 铜钱 + 食物', () => {
    const { service } = makeService();
    service.setCity(makeCity({ population: { total: 4200, recruitable: 60 } }));
    const result = service.recruit({ cityId: 'city.s11_guangzong', count: 5 });
    expect(result.ok).toBe(true);
    expect(result.path).toBe('city');
    expect(result.cost).toEqual({ coin: 40, food: 10 });
    const city = service.getCity('city.s11_guangzong');
    expect(city.population.recruitable).toBe(55);
    expect(city.resources.coin).toBe(170);
    expect(city.resources.food).toBe(310);
  });

  it('营地：扣寨仓名额与资源，未知营地拒绝', () => {
    const { service } = makeService({
      camps: [{ campId: 'S02-camp', sceneId: 'S02', storageContainerId: 'camp:S02', resources: { coin: 40, food: 20 }, recruitable: 20 }]
    });
    const unknown = service.recruit({ fromCampId: 'nope', count: 1 });
    expect(unknown.code).toBe('unknownCamp');
    const result = service.recruit({ fromCampId: 'S02-camp', count: 4 });
    expect(result.ok).toBe(true);
    expect(result.path).toBe('camp');
    expect(service.camps.get('S02-camp').recruitable).toBe(16);
    const broke = service.recruit({ fromCampId: 'S02-camp', count: 5 });
    expect(broke.ok).toBe(false);
    expect(broke.code).toBe('insufficientResource');
  });

  it('流浪：扣玩家背包、不扣名额、受队伍空位限制', () => {
    const { service } = makeService({ playerResources: { coin: 100, food: 50 } });
    const noSpace = service.recruit({ count: 5, partySpace: 2 });
    expect(noSpace.code).toBe('insufficientSpace');
    const ok = service.recruit({ count: 4, partySpace: 10 });
    expect(ok.ok).toBe(true);
    expect(ok.path).toBe('wandering');
    expect(service.playerResources.coin).toBe(68);
    expect(service.playerResources.food).toBe(42);
  });

  it('批量上限与名额不足拒绝，失败不改数据', () => {
    const { service } = makeService();
    service.setCity(makeCity({ population: { total: 4200, recruitable: 2 } }));
    const before = service.getCity('city.s11_guangzong');
    expect(service.recruit({ cityId: 'city.s11_guangzong', count: 21 }).code).toBe('batchExceeded');
    expect(service.recruit({ cityId: 'city.s11_guangzong', count: 5 }).code).toBe('insufficientRecruitable');
    expect(service.getCity('city.s11_guangzong')).toEqual(before);
  });
});

describe('CityAdministrationService 输送 / 围城 / 易主', () => {
  it('输送扣库存；围城禁止输送出城', () => {
    const { service, events } = makeService();
    const ok = service.orderTransport({ cityId: 'city.s11_guangzong', target: { x: 1, y: 2 }, items: { food: 20 } });
    expect(ok.ok).toBe(true);
    expect(ok.plan.kind).toBe('convoy.assemble');
    expect(service.getCity('city.s11_guangzong').resources.food).toBe(300);
    expect(events.some(entry => entry.event === 'city.transportDispatched')).toBe(true);

    service.beginSiege({ cityId: 'city.s11_guangzong', byFactionId: 'han' });
    expect(service.orderTransport({ cityId: 'city.s11_guangzong', target: {}, items: { food: 1 } }).code).toBe('siegeNoTransportOut');
  });

  it('攻击按钮：有军团派军，无军团先建军', () => {
    const { service } = makeService();
    expect(service.orderAttack({ cityId: 'city.s11_guangzong', target: { x: 3, y: 4 } }).plan.kind).toBe('army.order');
    const form = service.orderAttack({ cityId: 'city.s11_guangzong', target: { x: 3, y: 4 }, hasArmy: false });
    expect(form.plan.kind).toBe('army.form');
    expect(form.requiresConfirm).toBe(true);
  });

  it('围城开始/解除；守城胜 +8 民心', () => {
    const { service, events } = makeService();
    service.beginSiege({ cityId: 'city.s11_guangzong', byFactionId: 'han', day: 3 });
    expect(service.getCity('city.s11_guangzong').status).toBe(CITY_STATUS.UNDER_SIEGE);
    const lifted = service.liftSiege({ cityId: 'city.s11_guangzong', victory: true });
    expect(lifted.morale).toBe(68);
    expect(service.getCity('city.s11_guangzong').status).toBe(CITY_STATUS.NORMAL);
    expect(events.some(entry => entry.event === 'city.siegeLifted')).toBe(true);
  });

  it('易主：换势力、-12 民心、损毁 +0.15、按比例资源转移', () => {
    const { service } = makeService({
      cities: [makeCity(), makeCity({ id: 'city.winner', factionId: 'han', resources: { food: 0, coin: 0 } })]
    });
    const captured = service.captureCity({
      cityId: 'city.s11_guangzong',
      factionId: 'han',
      winnerCityId: 'city.winner'
    });
    expect(captured.fromFactionId).toBe('yellow_turban');
    expect(captured.toFactionId).toBe('han');
    expect(captured.morale).toBe(48);
    const city = service.getCity('city.s11_guangzong');
    expect(city.status).toBe(CITY_STATUS.NORMAL);
    expect(city.damageRatio).toBeCloseTo(0.25, 5);
    expect(captured.transferred.food).toBe(160);
    expect(service.getCity('city.winner').resources.food).toBe(160);
  });

  it('赈济每日一次并扣 food', () => {
    const { service } = makeService();
    const first = service.relief({ cityId: 'city.s11_guangzong', day: 5 });
    expect(first.ok).toBe(true);
    expect(first.to).toBe(65);
    expect(service.getCity('city.s11_guangzong').resources.food).toBe(300);
    expect(service.relief({ cityId: 'city.s11_guangzong', day: 5 }).code).toBe('reliefAlreadyUsedToday');
    expect(service.relief({ cityId: 'city.s11_guangzong', day: 6 }).ok).toBe(true);
  });
});

describe('CityAdministrationService 存档', () => {
  it('serialize/restore 保留城池、营地与玩家资源', () => {
    const { service } = makeService({
      camps: [{ campId: 'S02-camp', resources: { coin: 40 }, recruitable: 20 }],
      playerResources: { coin: 10 }
    });
    service.beginSiege({ cityId: 'city.s11_guangzong', byFactionId: 'han', day: 2 });
    const snapshot = service.serialize();
    const restored = new CityAdministrationService();
    expect(restored.restore(snapshot).ok).toBe(true);
    expect(restored.getCity('city.s11_guangzong').status).toBe(CITY_STATUS.UNDER_SIEGE);
    expect(restored.camps.get('S02-camp').recruitable).toBe(20);
    expect(restored.playerResources.coin).toBe(10);
  });

  it('旧档缺字段不报错', () => {
    const service = new CityAdministrationService();
    expect(service.restore({}).ok).toBe(true);
    expect(service.listCities()).toEqual([]);
    expect(service.restore(null).ok).toBe(false);
  });
});

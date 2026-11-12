import { describe, it, expect } from 'vitest';
import {
  ReputationSystem,
  REPUTATION_TIERS,
  resolveAttitude,
  resolvePriceMultiplier
} from './ReputationSystem.js';

describe('ReputationSystem 态度档位', () => {
  it('五档边界与默认中立', () => {
    expect(REPUTATION_TIERS.map(tier => tier.key)).toEqual(['admired', 'friendly', 'neutral', 'cold', 'hostile']);
    expect(resolveAttitude(60).key).toBe('admired');
    expect(resolveAttitude(20).key).toBe('friendly');
    expect(resolveAttitude(0).key).toBe('neutral');
    expect(resolveAttitude(-19).key).toBe('neutral');
    expect(resolveAttitude(-20).key).toBe('cold');
    expect(resolveAttitude(-60).key).toBe('hostile');
    expect(resolvePriceMultiplier(80)).toBe(0.9);
    expect(resolvePriceMultiplier(80, REPUTATION_TIERS, false)).toBe(1);
  });
});

describe('ReputationSystem 账本与势力/城池覆盖', () => {
  it('adjust 写势力账并 clamp 到 [-100,100]', () => {
    const system = new ReputationSystem();
    const first = system.adjust({ factionId: 'yellow_turban', delta: 30 });
    expect(first.value).toBe(30);
    system.adjust({ factionId: 'yellow_turban', delta: 200 });
    expect(system.getValue({ factionId: 'yellow_turban' })).toBe(100);
    system.adjust({ factionId: 'yellow_turban', delta: -300 });
    expect(system.getValue({ factionId: 'yellow_turban' })).toBe(-100);
  });

  it('城池覆盖优先于势力与全局', () => {
    const system = new ReputationSystem();
    system.adjust({ delta: 10 });
    system.adjust({ factionId: 'f1', delta: 30 });
    system.adjust({ cityId: 'city.luoyang', factionId: 'f1', delta: 70 });
    expect(system.getValue()).toBe(10);
    expect(system.getValue({ factionId: 'f1' })).toBe(30);
    expect(system.getValue({ cityId: 'city.luoyang', factionId: 'f1' })).toBe(70);
    expect(system.getValue({ cityId: 'city.unknown', factionId: 'f1' })).toBe(30);
  });

  it('未提到的势力继承全局值', () => {
    const system = new ReputationSystem();
    system.adjust({ delta: 25 });
    expect(system.getValue({ factionId: 'nobody' })).toBe(25);
  });
});

describe('ReputationSystem 报价（R3）', () => {
  it('买价/修理/锻造按态度系数，最低 1', () => {
    const system = new ReputationSystem();
    system.adjust({ factionId: 'f1', delta: 70 });
    expect(system.quote({ kind: 'buy', basePrice: 100, factionId: 'f1' }).price).toBe(90);
    expect(system.quote({ kind: 'repair', basePrice: 100, factionId: 'f1' }).price).toBe(90);
    expect(system.quote({ kind: 'buy', basePrice: 1, factionId: 'f1' }).price).toBe(1);
  });

  it('卖价方向相反（高态度卖更贵）且有 ×3 上限', () => {
    const system = new ReputationSystem();
    system.adjust({ factionId: 'f1', delta: 90 });
    const sell = system.quote({ kind: 'sell', basePrice: 100, factionId: 'f1' });
    expect(sell.price).toBe(111);
    const capped = system.quote({ kind: 'sell', basePrice: 100, factionId: 'f1', });
    expect(capped.price).toBeLessThanOrEqual(300);
  });

  it('敌对拒绝交易（sell 仍可回收）', () => {
    const system = new ReputationSystem();
    system.adjust({ factionId: 'f1', delta: -80 });
    expect(system.getAttitude({ factionId: 'f1' }).refuseTrade).toBe(true);
    const buy = system.quote({ kind: 'buy', basePrice: 100, factionId: 'f1' });
    expect(buy.ok).toBe(false);
    expect(buy.code).toBe('tradeRefused');
    expect(system.quote({ kind: 'sell', basePrice: 100, factionId: 'f1' }).ok).toBe(true);
  });

  it('招募系数随态度变化，敌对为 0', () => {
    const system = new ReputationSystem();
    system.adjust({ factionId: 'f1', delta: 70 });
    expect(system.getRecruitMultiplier({ factionId: 'f1' })).toBe(1.5);
    system.adjust({ factionId: 'f2', delta: -80 });
    expect(system.getRecruitMultiplier({ factionId: 'f2' })).toBe(0);
  });

  it('enabled:false 时全系数 1.0（零回归）', () => {
    const system = new ReputationSystem({ config: { enabled: false } });
    system.adjust({ factionId: 'f1', delta: -80 });
    const quote = system.quote({ kind: 'buy', basePrice: 100, factionId: 'f1' });
    expect(quote.ok).toBe(true);
    expect(quote.price).toBe(100);
    expect(system.getRecruitMultiplier({ factionId: 'f1' })).toBe(1);
  });
});

describe('ReputationSystem 存档', () => {
  it('serialize/restore 保留势力与城池账', () => {
    const system = new ReputationSystem();
    system.adjust({ factionId: 'f1', delta: 30 });
    system.adjust({ cityId: 'city.luoyang', factionId: 'f1', delta: 50 });
    const snapshot = system.serialize();
    const restored = new ReputationSystem({ state: snapshot });
    expect(restored.getValue({ factionId: 'f1' })).toBe(30);
    expect(restored.getValue({ cityId: 'city.luoyang' })).toBe(50);
  });

  it('旧档缺字段一律视为 0，不报错', () => {
    const system = new ReputationSystem();
    expect(system.restore({}).ok).toBe(true);
    expect(system.getValue()).toBe(0);
    expect(system.restore(null).ok).toBe(false);
  });
});

describe('ReputationSystem B4 旧键兼容读', () => {
  it('新账没有势力值时回落旧键；新账有值时优先新账', () => {
    const legacy = { yellow_turban: 20, han: -10 };
    const system = new ReputationSystem({ legacyReader: ({ factionId }) => legacy[factionId] ?? null });
    expect(system.getValue({ factionId: 'yellow_turban' })).toBe(20);
    expect(system.getValue({ factionId: 'han' })).toBe(-10);
    system.adjust({ factionId: 'yellow_turban', delta: 5 });
    expect(system.getValue({ factionId: 'yellow_turban' })).toBe(5);
  });

  it('无势力/城池上下文不读旧键，避免与全局 50 混用', () => {
    const system = new ReputationSystem({ legacyReader: () => 50 });
    expect(system.getValue()).toBe(0);
  });
});

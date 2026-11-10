import { describe, it, expect } from 'vitest';
import {
  HERO_DEPLOY_SLOTS,
  resolveCommanderSlot,
  resolveHeroAura,
  aggregateHeroAuras,
  buildCommanderEntry
} from './HeroAuraResolver.js';
import { BattlefieldRuntimeSystem } from './BattlefieldRuntimeSystem.js';
import { BattleState, BattleMode } from './BattleSystem.js';

const hero = {
  id: 'hero.zhangjiao',
  name: '张角',
  deploySlot: 'rear',
  aura: { radius: 160, modifiers: { attack: 1.10, defense: 0.95 } }
};

describe('HeroAuraResolver 主将位置', () => {
  it('部署 > 武将自身 > mid', () => {
    expect(HERO_DEPLOY_SLOTS).toEqual(['front', 'mid', 'rear']);
    expect(resolveCommanderSlot({ hero, deployment: { commanderSlot: 'front' } })).toBe('front');
    expect(resolveCommanderSlot({ hero })).toBe('rear');
    expect(resolveCommanderSlot({ hero: { id: 'h' } })).toBe('mid');
    expect(resolveCommanderSlot({})).toBe('mid');
  });
});

describe('HeroAuraResolver 光环', () => {
  it('在场才生效，离场/阵亡退化为 1.0', () => {
    expect(resolveHeroAura({ hero })).toMatchObject({ active: true, attack: 1.1, defense: 0.95, radius: 160 });
    expect(resolveHeroAura({ hero, onField: false })).toMatchObject({ active: false, attack: 1, defense: 1 });
    expect(resolveHeroAura({ hero: { id: 'h' } })).toMatchObject({ active: false, attack: 1, defense: 1 });
  });

  it('多光环连乘并记录生效武将', () => {
    const aggregated = aggregateHeroAuras([
      { hero },
      { hero: { id: 'hero.a', aura: { modifiers: { attack: 1.2 } } } },
      { hero: { id: 'hero.dead', aura: { modifiers: { attack: 2 } } }, onField: false }
    ]);
    expect(aggregated.attack).toBeCloseTo(1.32, 5);
    expect(aggregated.defense).toBeCloseTo(0.95, 5);
    expect(aggregated.activeHeroes).toEqual(['hero.zhangjiao', 'hero.a']);
  });

  it('buildCommanderEntry 输出可入场的条目', () => {
    const entry = buildCommanderEntry({ hero, factionId: 'shu' });
    expect(entry).toMatchObject({ factionId: 'shu', heroId: 'hero.zhangjiao', slot: 'rear', onField: true });
    expect(entry.aura.active).toBe(true);
  });
});

function makeEntity(id, factionId, hp = 100) {
  return {
    id,
    factionId,
    tags: ['battleParticipant'],
    isDead: false,
    isDying: false,
    getComponent: name => (name === 'stats' ? { hp, maxHp: 100 } : null)
  };
}

describe('BattlefieldRuntimeSystem 主将入场（6C/6D）', () => {
  function makeRuntime() {
    const battleSystem = {
      state: BattleState.ACTIVE,
      mode: BattleMode.OBSERVE,
      definition: {
        battleId: 'battle.test',
        participantFactionIds: ['shu', 'wei'],
        objective: '击溃敌军',
        createParams: {
          attackerArmy: { id: 'army.shu', factionId: 'shu' },
          defenderArmy: { id: 'army.wei', factionId: 'wei' }
        },
        outcomeSignals: {
          shuDefeated: { type: 'factionDefeated', factionId: 'shu' },
          weiDefeated: { type: 'factionDefeated', factionId: 'wei' }
        }
      },
      evaluateOutcome: () => ({ ok: false, code: 'battleOngoing' })
    };
    return new BattlefieldRuntimeSystem({
      battleSystem,
      aiSystem: { activateAI: () => {}, deactivateAI: () => {} }
    });
  }

  it('不传 commanders 时 snapshot 无主将/光环字段（零回归）', () => {
    const runtime = makeRuntime();
    const entities = [makeEntity('s1', 'shu'), makeEntity('w1', 'wei')];
    const started = runtime.start({ entities });
    expect(started.ok).toBe(true);
    expect(runtime.commanders).toEqual({});
    expect(runtime.auras).toEqual({});
    expect(started.snapshot.factions.shu.commander).toBeUndefined();
    expect(started.snapshot.factions.shu.aura).toBeUndefined();
  });

  it('传入主将后 snapshot 带 commander + aura，且可序列化恢复', () => {
    const runtime = makeRuntime();
    const entities = [makeEntity('s1', 'shu'), makeEntity('w1', 'wei')];
    const started = runtime.start({
      entities,
      commanders: [{ factionId: 'shu', hero, controlled: true }]
    });
    expect(started.ok).toBe(true);
    expect(started.snapshot.factions.shu.commander).toEqual({
      heroId: 'hero.zhangjiao',
      slot: 'rear',
      controlled: true,
      onField: true
    });
    expect(started.snapshot.factions.shu.aura).toMatchObject({ attack: 1.1, defense: 0.95, radius: 160 });
    expect(started.snapshot.factions.wei.commander).toBeUndefined();

    const serialized = runtime.serialize();
    expect(serialized.commanders.shu.heroId).toBe('hero.zhangjiao');
    expect(serialized.auras.shu.attack).toBeCloseTo(1.1, 5);

    const restored = makeRuntime();
    expect(restored.deserialize(serialized, { entities }).ok).toBe(true);
    expect(restored.commanders.shu.slot).toBe('rear');
    expect(restored.auras.shu.defense).toBeCloseTo(0.95, 5);
  });

  it('主将离场（onField:false）不产生光环', () => {
    const runtime = makeRuntime();
    const entities = [makeEntity('s1', 'shu'), makeEntity('w1', 'wei')];
    const started = runtime.start({
      entities,
      commanders: [{ factionId: 'shu', hero, onField: false }]
    });
    expect(started.ok).toBe(true);
    expect(started.snapshot.factions.shu.commander.onField).toBe(false);
    expect(started.snapshot.factions.shu.aura).toBeUndefined();
    expect(runtime.auras.shu).toBeUndefined();
  });
});

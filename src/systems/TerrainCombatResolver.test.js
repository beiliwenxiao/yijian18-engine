import { describe, it, expect } from 'vitest';
import {
  resolveTerrainCombatModifiers,
  isTerrainCombatEffect,
  TERRAIN_COMBAT_DEFAULTS
} from './TerrainCombatResolver.js';
import { ZoneEffectSystem } from './ZoneEffectSystem.js';

const highGround = {
  id: 'zone.highGround',
  effect: {
    kind: 'terrainCombat',
    unitTypeFilter: ['unit.archer'],
    modifiers: { archerRangeMultiplier: 1.2, defenseMultiplier: 1.1 }
  }
};
const mud = {
  id: 'zone.mud',
  effect: { kind: 'terrainCombat', modifiers: { moveSpeedMultiplier: 0.8 } }
};

describe('TerrainCombatResolver', () => {
  it('只认 kind=terrainCombat', () => {
    expect(isTerrainCombatEffect({ kind: 'terrainCombat' })).toBe(true);
    expect(isTerrainCombatEffect({ kind: 'damage' })).toBe(false);
    expect(isTerrainCombatEffect(null)).toBe(false);
  });

  it('单位类型不匹配的区域被忽略', () => {
    const archer = resolveTerrainCombatModifiers([highGround], { unitTypeId: 'unit.archer' });
    expect(archer.range).toBeCloseTo(1.2);
    expect(archer.defense).toBeCloseTo(1.1);
    const spear = resolveTerrainCombatModifiers([highGround], { unitTypeId: 'unit.spear' });
    expect(spear).toEqual({ ...TERRAIN_COMBAT_DEFAULTS, sources: [] });
  });

  it('range 只对远程兵种生效，近战不吃高台射程', () => {
    const meleeInMud = resolveTerrainCombatModifiers(
      [{ id: 'z', effect: { kind: 'terrainCombat', modifiers: { archerRangeMultiplier: 1.5, attackMultiplier: 1.1 } } }],
      { unitTypeId: 'unit.spear' }
    );
    expect(meleeInMud.range).toBe(1);
    expect(meleeInMud.attack).toBeCloseTo(1.1);
  });

  it('多层区域连乘并记录来源', () => {
    const zones = [highGround, mud, { id: 'anotherMud', effect: { ...mud.effect } }];
    const result = resolveTerrainCombatModifiers(zones, { unitTypeId: 'unit.archer' });
    expect(result.speed).toBeCloseTo(0.64);
    expect(result.sources).toEqual(['zone.highGround', 'zone.mud', 'anotherMud']);
  });

  it('side 过滤：只对指定阵营生效', () => {
    const zone = { id: 'z', effect: { kind: 'terrainCombat', side: 'attacker', modifiers: { attack: 0.9 } } };
    expect(resolveTerrainCombatModifiers([zone], { side: 'defender' }).attack).toBe(1);
    expect(resolveTerrainCombatModifiers([zone], { side: 'attacker' }).attack).toBeCloseTo(0.9);
  });
});

describe('ZoneEffectSystem.resolveTerrainCombat', () => {
  const system = new ZoneEffectSystem();
  system.setZones([
    { id: 'zone.highGround', points: [[0, 0], [100, 0], [100, 100], [0, 100]], effect: highGround.effect },
    { id: 'zone.buff', points: [[0, 0], [100, 0], [100, 100], [0, 100]], effect: { kind: 'buff', stat: 'attack', value: 5 } }
  ]);

  it('点内命中地形区，点外不命中', () => {
    expect(system.resolveTerrainCombat(50, 50, { unitTypeId: 'unit.archer' }).range).toBeCloseTo(1.2);
    expect(system.resolveTerrainCombat(500, 500, { unitTypeId: 'unit.archer' })).toEqual({
      ...TERRAIN_COMBAT_DEFAULTS, sources: []
    });
  });

  it('普通 buffZone 不参与地形战斗求值', () => {
    expect(system.resolveTerrainCombat(50, 50, { unitTypeId: 'unit.archer' }).sources).toEqual(['zone.highGround']);
  });
});

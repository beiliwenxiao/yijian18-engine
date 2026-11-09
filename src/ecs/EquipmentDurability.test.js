/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-09
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { Entity } from './Entity.js';
import { EquipmentComponent } from './components/EquipmentComponent.js';
import { StatsComponent } from './components/StatsComponent.js';
import { EquipmentSystem } from '../systems/EquipmentSystem.js';

function createEntity() {
  const entity = new Entity('durability-player', 'player');
  entity.addComponent(new EquipmentComponent());
  entity.addComponent(new StatsComponent({ attack: 10, defense: 5, maxHp: 100, maxMp: 50 }));
  return entity;
}

describe('装备耐久消耗（P17）', () => {
  it('未声明耐久配置的旧装备零变化', () => {
    const entity = createEntity();
    const system = new EquipmentSystem();
    const weapon = { id: 'legacy-sword', subType: 'weapon', stats: { attack: 5 } };
    system.equipItem(entity, 'mainhand', weapon);

    const attackBefore = entity.getComponent('stats').attack;
    const changed = system.consumeDurability(entity, 'use');

    expect(changed).toEqual([]);
    expect(weapon.durability).toBeUndefined();
    expect(entity.getComponent('stats').attack).toBe(attackBefore);
    expect(attackBefore).toBe(15);
  });

  it('出手按 durabilityPerUse 扣减，未损坏时加成不折损', () => {
    const entity = createEntity();
    const system = new EquipmentSystem();
    const weapon = {
      id: 'bow', subType: 'weapon', stats: { attack: 5 },
      durabilityMax: 100, durabilityPerUse: 3, durabilityPerHit: 0, durability: 100
    };
    system.equipItem(entity, 'mainhand', weapon);

    const changed = system.consumeDurability(entity, 'use');

    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ slotType: 'mainhand', broken: false });
    expect(weapon.durability).toBe(97);
    expect(entity.getComponent('stats').attack).toBe(15);
  });

  it('受击按 durabilityPerHit 扣减，不同 kind 互不串用', () => {
    const entity = createEntity();
    const system = new EquipmentSystem();
    const armor = {
      id: 'vest', subType: 'armor', stats: { defense: 6 },
      durabilityMax: 50, durabilityPerUse: 0, durabilityPerHit: 5, durability: 50
    };
    system.equipItem(entity, 'armor', armor);

    system.consumeDurability(entity, 'use');
    expect(armor.durability).toBe(50);

    system.consumeDurability(entity, 'hit');
    expect(armor.durability).toBe(45);
    expect(entity.getComponent('stats').defense).toBe(11);
  });

  it('耐久归零后加成按 brokenMultiplier 折损（默认 0.5）', () => {
    const entity = createEntity();
    const system = new EquipmentSystem();
    const armor = {
      id: 'vest', subType: 'armor', stats: { defense: 10 },
      durabilityMax: 5, durabilityPerHit: 5, durability: 5
    };
    system.equipItem(entity, 'armor', armor);
    expect(entity.getComponent('stats').defense).toBe(15);

    const changed = system.consumeDurability(entity, 'hit');

    expect(changed[0].broken).toBe(true);
    expect(armor.durability).toBe(0);
    expect(entity.getComponent('stats').defense).toBe(10);
  });

  it('自定义 brokenMultiplier 生效，且耐久为 0 后不再重复扣减', () => {
    const entity = createEntity();
    const system = new EquipmentSystem();
    const armor = {
      id: 'vest', subType: 'armor', stats: { defense: 10 },
      durabilityMax: 4, durabilityPerHit: 4, durability: 4, brokenMultiplier: 0.2
    };
    system.equipItem(entity, 'armor', armor);

    system.consumeDurability(entity, 'hit');
    expect(entity.getComponent('stats').defense).toBe(7);

    const again = system.consumeDurability(entity, 'hit');
    expect(again).toEqual([]);
    expect(armor.durability).toBe(0);
    expect(entity.getComponent('stats').defense).toBe(7);
  });
});

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

import { describe, expect, it } from 'vitest';
import { Entity } from '../ecs/Entity.js';
import { EquipmentComponent } from '../ecs/components/EquipmentComponent.js';
import { StatsComponent } from '../ecs/components/StatsComponent.js';
import { EquipmentSystem } from './EquipmentSystem.js';

function createEntity(stats) {
  const entity = new Entity('equipment-stats-player', 'player');
  entity.addComponent(new EquipmentComponent());
  entity.addComponent(new StatsComponent(stats));
  return entity;
}

describe('EquipmentSystem current HP/MP adjustment', () => {
  it('攻击类装备不改变上限时原样保留当前 HP/MP', () => {
    const entity = createEntity({ hp: 59, maxHp: 84, mp: 13, maxMp: 20 });
    const system = new EquipmentSystem();
    const weapon = { id: 'attack-only', subType: 'weapon', stats: { attack: 5 } };

    system.equipItem(entity, 'mainhand', weapon);
    expect(entity.getComponent('stats')).toMatchObject({ hp: 59, maxHp: 84, mp: 13, maxMp: 20 });

    system.unequipItem(entity, 'mainhand');
    expect(entity.getComponent('stats')).toMatchObject({ hp: 59, maxHp: 84, mp: 13, maxMp: 20 });
  });

  it('上限实际变化时按比例取整，并始终 clamp 当前值', () => {
    const entity = createEntity({ hp: 59, maxHp: 84, mp: 13, maxMp: 20 });
    const system = new EquipmentSystem();
    const necklace = { id: 'vitality', subType: 'necklace', stats: { maxHp: 20, maxMp: 10 } };

    system.equipItem(entity, 'necklace', necklace);
    const stats = entity.getComponent('stats');
    expect(stats).toMatchObject({ hp: 73, maxHp: 104, mp: 19, maxMp: 30 });

    stats.hp = 999;
    stats.mp = -5;
    system.updateEntityStats(entity);
    expect(stats).toMatchObject({ hp: 104, maxHp: 104, mp: 0, maxMp: 30 });
  });
});
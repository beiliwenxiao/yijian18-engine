import { describe, it, expect } from 'vitest';
import { EquipmentComponent } from './EquipmentComponent.js';
import { EquipmentSystem } from '../../systems/EquipmentSystem.js';

/** 工具类道具（type=tool, subType=tool）装备到 mainhand：破旧斧头场景。 */
function buildWornAxe() {
  return {
    id: 'tool.worn_axe',
    type: 'tool',
    subType: 'tool',
    toolType: 'axe',
    stats: { attack: 10 },
    attackSpeedReduce: { thresholdSec: 1, reduceSec: 0.5, minSec: 2.5 }
  };
}

describe('工具类道具装备（tool → mainhand）', () => {
  it('isValidEquipmentForSlot 接受 subType=tool 到 mainhand', () => {
    const eq = new EquipmentComponent();
    expect(eq.isValidEquipmentForSlot(buildWornAxe(), 'mainhand')).toBe(true);
    expect(eq.isValidEquipmentForSlot(buildWornAxe(), 'armor')).toBe(false);
  });

  it('equip 成功并可被替换/卸下', () => {
    const eq = new EquipmentComponent();
    const replaced = eq.equip('mainhand', buildWornAxe());
    expect(replaced).toBeNull();
    expect(eq.getEquipment('mainhand').id).toBe('tool.worn_axe');
    const removed = eq.unequip('mainhand');
    expect(removed.id).toBe('tool.worn_axe');
    expect(eq.getEquipment('mainhand')).toBeNull();
  });

  it('装备工具后属性加成生效（attack +10）', () => {
    const eq = new EquipmentComponent();
    eq.equip('mainhand', buildWornAxe());
    expect(eq.getBonusStats().attack).toBe(10);
    eq.unequip('mainhand');
    expect(eq.getBonusStats().attack).toBe(0);
  });

  it('EquipmentSystem.equipItem 走通 tool 装备并更新 stats', () => {
    const entity = {
      components: new Map(),
      getComponent(name) { return this.components.get(name) || null; },
      addComponent(c) { this.components.set(c.type, c); }
    };
    entity.addComponent(new EquipmentComponent());
    entity.addComponent({
      type: 'stats',
      attack: 5, defense: 0, maxHp: 100, hp: 100, maxMp: 50, mp: 50, speed: 100,
      elementAttack: {}, elementDefense: {}
    });
    const system = new EquipmentSystem();
    const old = system.equipItem(entity, 'mainhand', buildWornAxe());
    expect(old).toBeNull();
    expect(entity.getComponent('equipment').getEquipment('mainhand').toolType).toBe('axe');
    expect(entity.getComponent('stats').attack).toBe(15); // 5 + 10
  });
});

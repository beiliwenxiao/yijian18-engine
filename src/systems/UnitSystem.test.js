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

/**
 * UnitSystem.test.js
 * 兵种系统单元测试
 */

import { UnitSystem, UnitTypes, UnitNames, UnitCounters } from './UnitSystem.js';

describe('UnitSystem', () => {
  let unitSystem;

  beforeEach(() => {
    unitSystem = new UnitSystem();
  });

  describe('基础功能', () => {
    test('应该正确初始化', () => {
      expect(unitSystem).toBeDefined();
      expect(unitSystem.counterTable).toBeDefined();
    });

    test('应该正确获取兵种名称', () => {
      expect(unitSystem.getUnitName(UnitTypes.SWORD_SHIELD)).toBe('刀盾步兵');
      expect(unitSystem.getUnitName(UnitTypes.HEAVY_CAVALRY)).toBe('重甲骑兵');
      expect(unitSystem.getUnitName(999)).toBe('未知兵种');
    });

    test('应该正确识别基础兵种', () => {
      expect(unitSystem.isBaseUnit(UnitTypes.SWORD_SHIELD)).toBe(true);
      expect(unitSystem.isBaseUnit(UnitTypes.ARCHER_CROSSBOW)).toBe(true);
      expect(unitSystem.isBaseUnit(UnitTypes.SPEARMAN)).toBe(true);
      expect(unitSystem.isBaseUnit(UnitTypes.HEAVY_INFANTRY)).toBe(false);
    });

    test('应该正确识别重甲兵种', () => {
      expect(unitSystem.isHeavyUnit(UnitTypes.HEAVY_INFANTRY)).toBe(true);
      expect(unitSystem.isHeavyUnit(UnitTypes.HEAVY_CAVALRY)).toBe(true);
      expect(unitSystem.isHeavyUnit(UnitTypes.LIGHT_INFANTRY)).toBe(false);
      expect(unitSystem.isHeavyUnit(UnitTypes.SPEARMAN)).toBe(false);
    });
  });

  describe('升级机制', () => {
    test('应该正确检测可升级兵种', () => {
      expect(unitSystem.canUpgradeUnit(UnitTypes.SWORD_SHIELD)).toBe(true);
      expect(unitSystem.canUpgradeUnit(UnitTypes.ARCHER_CROSSBOW)).toBe(true);
      expect(unitSystem.canUpgradeUnit(UnitTypes.HEAVY_INFANTRY)).toBe(false);
      expect(unitSystem.canUpgradeUnit(UnitTypes.HEAVY_CAVALRY)).toBe(false);
    });

    test('应该正确处理线性升级', () => {
      // 刀盾步兵 -> 轻甲步兵
      const upgrade1 = unitSystem.upgradeUnit(UnitTypes.SWORD_SHIELD, 0);
      expect(upgrade1).toBe(UnitTypes.LIGHT_INFANTRY);

      // 轻甲步兵 -> 重甲步兵
      const upgrade2 = unitSystem.upgradeUnit(UnitTypes.LIGHT_INFANTRY, 0);
      expect(upgrade2).toBe(UnitTypes.HEAVY_INFANTRY);

      // 长枪兵 -> 轻骑兵
      const upgrade3 = unitSystem.upgradeUnit(UnitTypes.SPEARMAN, 0);
      expect(upgrade3).toBe(UnitTypes.LIGHT_CAVALRY);
    });

    test('应该正确处理分支升级', () => {
      const options = unitSystem.getUpgradeOptions(UnitTypes.ARCHER_CROSSBOW);
      expect(options).toHaveLength(2);
      expect(options).toContain(UnitTypes.MOUNTED_ARCHER);
      expect(options).toContain(UnitTypes.REPEATING_CROSSBOW);

      // 测试两个分支
      const upgrade1 = unitSystem.upgradeUnit(UnitTypes.ARCHER_CROSSBOW, 0);
      const upgrade2 = unitSystem.upgradeUnit(UnitTypes.ARCHER_CROSSBOW, 1);
      
      expect([UnitTypes.MOUNTED_ARCHER, UnitTypes.REPEATING_CROSSBOW]).toContain(upgrade1);
      expect([UnitTypes.MOUNTED_ARCHER, UnitTypes.REPEATING_CROSSBOW]).toContain(upgrade2);
      expect(upgrade1).not.toBe(upgrade2);
    });

    test('应该正确获取兵种等级', () => {
      expect(unitSystem.getUnitTier(UnitTypes.SWORD_SHIELD)).toBe(1);
      expect(unitSystem.getUnitTier(UnitTypes.LIGHT_INFANTRY)).toBe(2);
      expect(unitSystem.getUnitTier(UnitTypes.HEAVY_INFANTRY)).toBe(3);
      expect(unitSystem.getUnitTier(UnitTypes.MOUNTED_ARCHER)).toBe(2);
    });
  });

  describe('相克关系', () => {
    test('应该正确计算相克倍率', () => {
      // 长枪兵克轻骑兵
      const multiplier1 = unitSystem.counterTable.getCounterMultiplier(
        UnitTypes.SPEARMAN, 
        UnitTypes.LIGHT_CAVALRY
      );
      expect(multiplier1).toBeGreaterThan(1.0);

      // 轻骑兵被长枪兵克制
      const multiplier2 = unitSystem.counterTable.getCounterMultiplier(
        UnitTypes.LIGHT_CAVALRY, 
        UnitTypes.SPEARMAN
      );
      expect(multiplier2).toBeLessThan(1.0);

      // 重甲兵种无相克关系
      const multiplier3 = unitSystem.counterTable.getCounterMultiplier(
        UnitTypes.HEAVY_INFANTRY, 
        UnitTypes.SPEARMAN
      );
      expect(multiplier3).toBe(1.0);
    });

    test('应该正确识别相克关系', () => {
      expect(unitSystem.isUnitCountering(UnitTypes.SPEARMAN, UnitTypes.LIGHT_CAVALRY)).toBe(true);
      expect(unitSystem.isUnitCountering(UnitTypes.LIGHT_CAVALRY, UnitTypes.ARCHER_CROSSBOW)).toBe(true);
      expect(unitSystem.isUnitCountering(UnitTypes.ARCHER_CROSSBOW, UnitTypes.SWORD_SHIELD)).toBe(true);
      expect(unitSystem.isUnitCountering(UnitTypes.SWORD_SHIELD, UnitTypes.SPEARMAN)).toBe(true);
      
      // 重甲兵种不克制任何兵种
      expect(unitSystem.isUnitCountering(UnitTypes.HEAVY_INFANTRY, UnitTypes.SPEARMAN)).toBe(false);
      expect(unitSystem.isUnitCountering(UnitTypes.HEAVY_CAVALRY, UnitTypes.ARCHER_CROSSBOW)).toBe(false);
    });

    test('应该正确获取相克信息', () => {
      const info = unitSystem.getUnitCounterInfo(UnitTypes.SPEARMAN, UnitTypes.LIGHT_CAVALRY);
      expect(info.relationship).toBe('advantage');
      expect(info.multiplier).toBeGreaterThan(1.0);
      expect(info.attackUnitName).toBe('长枪兵');
      expect(info.defendUnitName).toBe('轻骑兵');
    });
  });

  describe('伤害计算', () => {
    test('应该正确计算兵种伤害加成', () => {
      const attackerStats = { unitType: UnitTypes.SPEARMAN };
      const defenderStats = { unitType: UnitTypes.LIGHT_CAVALRY };
      const baseDamage = 100;

      const finalDamage = unitSystem.calculateUnitDamage(attackerStats, defenderStats, baseDamage);
      
      // 应该有相克加成
      expect(finalDamage).toBeGreaterThan(baseDamage);
      
      // 验证倍率
      const expectedMultiplier = unitSystem.counterTable.getCounterMultiplier(
        UnitTypes.SPEARMAN, 
        UnitTypes.LIGHT_CAVALRY
      );
      expect(finalDamage).toBe(Math.floor(baseDamage * expectedMultiplier));
    });

    test('应该正确处理无相克关系的伤害', () => {
      const attackerStats = { unitType: UnitTypes.HEAVY_INFANTRY };
      const defenderStats = { unitType: UnitTypes.SPEARMAN };
      const baseDamage = 100;

      const finalDamage = unitSystem.calculateUnitDamage(attackerStats, defenderStats, baseDamage);
      
      // 无相克关系，伤害应该不变
      expect(finalDamage).toBe(baseDamage);
    });

    test('应该保证最小伤害为1', () => {
      const attackerStats = { unitType: UnitTypes.SWORD_SHIELD };
      const defenderStats = { unitType: UnitTypes.ARCHER_CROSSBOW };
      const baseDamage = 0;

      const finalDamage = unitSystem.calculateUnitDamage(attackerStats, defenderStats, baseDamage);
      
      expect(finalDamage).toBeGreaterThanOrEqual(1);
    });
  });

  describe('兵种分类', () => {
    test('应该正确获取兵种类别', () => {
      expect(unitSystem.getUnitCategory(UnitTypes.SWORD_SHIELD)).toBe('infantry');
      expect(unitSystem.getUnitCategory(UnitTypes.HEAVY_INFANTRY)).toBe('infantry');
      expect(unitSystem.getUnitCategory(UnitTypes.ARCHER_CROSSBOW)).toBe('ranged');
      expect(unitSystem.getUnitCategory(UnitTypes.MOUNTED_ARCHER)).toBe('ranged');
      expect(unitSystem.getUnitCategory(UnitTypes.SPEARMAN)).toBe('cavalry');
      expect(unitSystem.getUnitCategory(UnitTypes.HEAVY_CAVALRY)).toBe('cavalry');
    });

    test('应该正确获取基础兵种类型', () => {
      expect(unitSystem.getBaseUnitType(UnitTypes.HEAVY_INFANTRY)).toBe(UnitTypes.SWORD_SHIELD);
      expect(unitSystem.getBaseUnitType(UnitTypes.MOUNTED_ARCHER)).toBe(UnitTypes.ARCHER_CROSSBOW);
      expect(unitSystem.getBaseUnitType(UnitTypes.HEAVY_CAVALRY)).toBe(UnitTypes.SPEARMAN);
      expect(unitSystem.getBaseUnitType(UnitTypes.SWORD_SHIELD)).toBe(UnitTypes.SWORD_SHIELD);
    });
  });

  describe('边界条件', () => {
    test('应该处理无效的兵种类型', () => {
      expect(unitSystem.counterTable.getCounterMultiplier(-1, 0)).toBe(1.0);
      expect(unitSystem.counterTable.getCounterMultiplier(0, 999)).toBe(1.0);
      expect(unitSystem.upgradeUnit(999)).toBeNull();
    });

    test('应该处理默认兵种类型', () => {
      const attackerStats = {}; // 没有unitType
      const defenderStats = { unitType: UnitTypes.SPEARMAN };
      const baseDamage = 100;

      const finalDamage = unitSystem.calculateUnitDamage(attackerStats, defenderStats, baseDamage);
      
      // 应该使用默认兵种类型
      expect(finalDamage).toBeDefined();
      expect(finalDamage).toBeGreaterThanOrEqual(1);
    });
  });
});
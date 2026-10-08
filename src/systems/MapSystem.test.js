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
 * MapSystem.test.js
 * 地图系统单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MapSystem, GameMap, Portal, MapState, PortalType } from './MapSystem.js';

describe('Portal', () => {
  let portal;
  let character;

  beforeEach(() => {
    portal = new Portal({
      id: 'test_portal',
      name: '测试传送点',
      type: PortalType.NORMAL,
      position: { x: 100, y: 100 },
      targetMapId: 'target_map',
      targetPosition: { x: 50, y: 50 },
      radius: 30
    });

    character = {
      level: 10,
      completedQuests: [],
      inventory: null
    };
  });

  it('应该正确初始化传送点', () => {
    expect(portal.id).toBe('test_portal');
    expect(portal.name).toBe('测试传送点');
    expect(portal.type).toBe(PortalType.NORMAL);
    expect(portal.isUnlocked).toBe(true);
  });

  it('应该正确检查范围', () => {
    expect(portal.isInRange({ x: 100, y: 100 })).toBe(true);
    expect(portal.isInRange({ x: 120, y: 100 })).toBe(true);
    expect(portal.isInRange({ x: 200, y: 200 })).toBe(false);
  });

  it('无条件传送点应该可以使用', () => {
    const result = portal.canUse(character);
    expect(result.canUse).toBe(true);
  });

  it('有等级条件的传送点应该正确检查', () => {
    portal.unlockCondition = { minLevel: 15 };
    portal.isUnlocked = false;
    
    const result = portal.checkUnlockCondition(character);
    expect(result.met).toBe(false);
    expect(result.reason).toContain('等级');
  });

  it('应该正确解锁传送点', () => {
    portal.isUnlocked = false;
    portal.unlock();
    expect(portal.isUnlocked).toBe(true);
  });
});

describe('GameMap', () => {
  let gameMap;
  let character;

  beforeEach(() => {
    gameMap = new GameMap({
      id: 'test_map',
      name: '测试地图',
      description: '这是一个测试地图',
      width: 1000,
      height: 1000,
      minLevel: 5,
      portals: [
        {
          id: 'portal_1',
          name: '传送点1',
          position: { x: 100, y: 100 },
          targetMapId: 'other_map',
          targetPosition: { x: 50, y: 50 }
        }
      ]
    });

    character = {
      level: 10
    };
  });

  it('应该正确初始化地图', () => {
    expect(gameMap.id).toBe('test_map');
    expect(gameMap.name).toBe('测试地图');
    expect(gameMap.minLevel).toBe(5);
    expect(gameMap.state).toBe(MapState.LOCKED);
  });

  it('应该正确获取传送点', () => {
    const portal = gameMap.getPortal('portal_1');
    expect(portal).not.toBeNull();
    expect(portal.name).toBe('传送点1');
  });

  it('应该正确检查传送点触发', () => {
    const portal = gameMap.checkPortalTrigger({ x: 100, y: 100 });
    expect(portal).not.toBeNull();
    
    const noPortal = gameMap.checkPortalTrigger({ x: 500, y: 500 });
    expect(noPortal).toBeNull();
  });

  it('锁定状态不能进入', () => {
    const result = gameMap.canEnter(character);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('未解锁');
  });

  it('解锁后等级足够可以进入', () => {
    gameMap.unlock();
    const result = gameMap.canEnter(character);
    expect(result.canEnter).toBe(true);
  });

  it('解锁后等级不足不能进入', () => {
    gameMap.unlock();
    character.level = 3;
    const result = gameMap.canEnter(character);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('等级');
  });

  it('应该正确解锁和完成地图', () => {
    expect(gameMap.state).toBe(MapState.LOCKED);
    
    gameMap.unlock();
    expect(gameMap.state).toBe(MapState.UNLOCKED);
    
    gameMap.complete();
    expect(gameMap.state).toBe(MapState.COMPLETED);
  });
});

describe('MapSystem', () => {
  let mapSystem;
  let character;

  beforeEach(() => {
    mapSystem = new MapSystem();
    character = {
      level: 10,
      transform: {
        position: { x: 0, y: 0 }
      }
    };
  });

  it('应该正确初始化默认地图', () => {
    expect(mapSystem.getMap('starter_village')).not.toBeNull();
    expect(mapSystem.getMap('green_forest')).not.toBeNull();
    expect(mapSystem.getMap('mine_cave')).not.toBeNull();
  });

  it('新手村应该默认解锁', () => {
    const starterVillage = mapSystem.getMap('starter_village');
    expect(starterVillage.state).toBe(MapState.UNLOCKED);
  });

  it('应该正确获取所有地图', () => {
    const allMaps = mapSystem.getAllMaps();
    expect(allMaps.length).toBeGreaterThan(0);
  });

  it('应该正确获取已解锁地图', () => {
    const unlockedMaps = mapSystem.getUnlockedMaps();
    expect(unlockedMaps.length).toBeGreaterThan(0);
    expect(unlockedMaps.every(m => m.state !== MapState.LOCKED)).toBe(true);
  });

  it('应该正确切换地图', () => {
    mapSystem.currentMapId = 'starter_village';
    
    // 解锁目标地图
    mapSystem.unlockMap('green_forest');
    
    const result = mapSystem.changeMap('green_forest', character);
    expect(result.success).toBe(true);
  });

  it('不能切换到未解锁的地图', () => {
    mapSystem.currentMapId = 'starter_village';
    
    const result = mapSystem.changeMap('ancient_castle', character);
    expect(result.success).toBe(false);
  });

  it('等级不足不能切换地图', () => {
    mapSystem.currentMapId = 'starter_village';
    mapSystem.unlockMap('ancient_castle');
    character.level = 5;
    
    const result = mapSystem.changeMap('ancient_castle', character);
    expect(result.success).toBe(false);
    expect(result.message).toContain('等级');
  });

  it('应该正确解锁地图', () => {
    const map = mapSystem.getMap('green_forest');
    expect(map.state).toBe(MapState.LOCKED);
    
    mapSystem.unlockMap('green_forest');
    expect(map.state).toBe(MapState.UNLOCKED);
  });

  it('应该正确获取进度信息', () => {
    const progress = mapSystem.getProgressInfo();
    expect(progress.total).toBeGreaterThan(0);
    expect(progress.unlocked).toBeGreaterThanOrEqual(1);
    expect(progress.progress).toBeGreaterThanOrEqual(0);
  });

  it('应该正确使用传送点', () => {
    mapSystem.currentMapId = 'starter_village';
    mapSystem.unlockMap('green_forest');
    
    const result = mapSystem.usePortal('portal_to_forest', character);
    expect(result.success).toBe(true);
  });

  it('不能使用不存在的传送点', () => {
    mapSystem.currentMapId = 'starter_village';
    
    const result = mapSystem.usePortal('nonexistent_portal', character);
    expect(result.success).toBe(false);
  });

  it('应该正确检查位置是否触发传送点', () => {
    mapSystem.currentMapId = 'starter_village';
    mapSystem.unlockMap('green_forest');
    
    const starterVillage = mapSystem.getMap('starter_village');
    const portal = starterVillage.getPortal('portal_to_forest');
    
    const triggeredPortal = mapSystem.checkPortalAtPosition(portal.position, character);
    expect(triggeredPortal).not.toBeNull();
  });
});

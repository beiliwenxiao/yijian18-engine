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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MovementSystem } from './MovementSystem.js';
import { TransformComponent } from '../ecs/components/TransformComponent.js';

/**
 * 构造带 transform 的最小实体
 */
function makeEntity(id, type = 'player', pos = { x: 0, y: 0 }) {
  const transform = new TransformComponent(pos.x, pos.y);
  transform.floorId = 'ground';
  return {
    id,
    type,
    getComponent(name) {
      if (name === 'transform') return transform;
      return null;
    }
  };
}

function makeCollision(rows, cols, walls = []) {
  const m = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(false);
    m.push(row);
  }
  for (const { r, c } of walls) m[r][c] = true;
  return m;
}

describe('MovementSystem 多楼层', () => {
  let ms;

  beforeEach(() => {
    ms = new MovementSystem({});
  });

  describe('setMapData', () => {
    it('按 floors 构造 Map', () => {
      ms.setMapData({
        defaultFloor: 'ground',
        tileSize: 32,
        floors: [
          { id: 'ground', elevation: 0, tileSize: 32, collision: makeCollision(5, 5) },
          { id: 'upper',  elevation: 80, tileSize: 32, collision: makeCollision(5, 5) }
        ]
      });
      expect(ms.floors.size).toBe(2);
      expect(ms.defaultFloorId).toBe('ground');
    });
  });

  describe('canMoveTo - 按楼层查 collision', () => {
    it('不同楼层碰撞图独立', () => {
      const groundWalls = [{ r: 1, c: 1 }];
      const upperWalls = [{ r: 2, c: 2 }];
      ms.setMapData({
        defaultFloor: 'ground',
        tileSize: 32,
        floors: [
          { id: 'ground', elevation: 0, tileSize: 32, collision: makeCollision(5, 5, groundWalls) },
          { id: 'upper',  elevation: 80, tileSize: 32, collision: makeCollision(5, 5, upperWalls) }
        ]
      });

      const entity = makeEntity('p');
      // ground 层 (1,1) 格禁止通行（绝对坐标 32+ ~ 64- => 用 40, 40 刚好落在 tile (1,1)）
      expect(ms.canMoveTo(40, 40, entity)).toBe(false);
      // ground 层 (2,2) 可通
      expect(ms.canMoveTo(72, 72, entity)).toBe(true);

      // 切到 upper
      entity.getComponent('transform').floorId = 'upper';
      expect(ms.canMoveTo(40, 40, entity)).toBe(true);    // upper (1,1) 可通
      expect(ms.canMoveTo(72, 72, entity)).toBe(false);   // upper (2,2) 禁止
    });
  });

  describe('teleport', () => {
    it('切换 floorId 并同步 elevation', () => {
      ms.setMapData({
        defaultFloor: 'ground',
        tileSize: 32,
        floors: [
          { id: 'ground', elevation: 0, tileSize: 32 },
          { id: 'upper',  elevation: 80, tileSize: 32 }
        ]
      });
      const entity = makeEntity('p');
      const ok = ms.teleport(entity, 'upper', 100, 200);
      expect(ok).toBe(true);
      const t = entity.getComponent('transform');
      expect(t.floorId).toBe('upper');
      expect(t.position.x).toBe(100);
      expect(t.position.z).toBe(200);
      expect(t.position.elevation).toBe(80);
    });

    it('未知楼层返回 false', () => {
      ms.setMapData({ defaultFloor: 'ground', floors: [{ id: 'ground', elevation: 0 }] });
      expect(ms.teleport(makeEntity('p'), 'missing', 0, 0)).toBe(false);
    });
  });

  describe('_checkPortals', () => {
    it('touch 型 portal 自动切换楼层', () => {
      ms.setMapData({
        defaultFloor: 'ground',
        tileSize: 32,
        floors: [
          {
            id: 'ground', elevation: 0, tileSize: 32,
            portals: [{ x: 500, z: 500, radius: 32, toFloor: 'upper', toX: 1000, toZ: 1000, trigger: 'touch' }]
          },
          { id: 'upper', elevation: 80, tileSize: 32 }
        ]
      });
      const entity = makeEntity('p', 'player', { x: 490, y: 500 });
      ms._checkPortals(entity);
      expect(entity.getComponent('transform').floorId).toBe('upper');
      expect(entity.getComponent('transform').position.x).toBe(1000);
    });

    it('interact 型 portal 需按交互键', () => {
      ms.setMapData({
        defaultFloor: 'ground',
        tileSize: 32,
        floors: [
          {
            id: 'ground', elevation: 0, tileSize: 32,
            portals: [{ x: 500, z: 500, radius: 32, toFloor: 'upper', toX: 1000, toZ: 1000, trigger: 'interact' }]
          },
          { id: 'upper', elevation: 80, tileSize: 32 }
        ]
      });
      const input = { isKeyPressed: vi.fn(() => false) };
      ms.inputManager = input;

      const entity = makeEntity('p', 'player', { x: 500, y: 500 });
      ms._checkPortals(entity);
      expect(entity.getComponent('transform').floorId).toBe('ground');

      input.isKeyPressed = vi.fn(() => true);
      ms._checkPortals(entity);
      expect(entity.getComponent('transform').floorId).toBe('upper');
    });

    it('距离超出 radius 不触发', () => {
      ms.setMapData({
        defaultFloor: 'ground',
        tileSize: 32,
        floors: [
          {
            id: 'ground', elevation: 0, tileSize: 32,
            portals: [{ x: 500, z: 500, radius: 10, toFloor: 'upper', toX: 1000, toZ: 1000, trigger: 'touch' }]
          },
          { id: 'upper', elevation: 80, tileSize: 32 }
        ]
      });
      const entity = makeEntity('p', 'player', { x: 600, y: 500 });
      ms._checkPortals(entity);
      expect(entity.getComponent('transform').floorId).toBe('ground');
    });
  });
});

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

import { describe, it, expect } from 'vitest';
import { TransformComponent } from './TransformComponent.js';

describe('TransformComponent (三维化 / 阶段 A)', () => {
  describe('构造', () => {
    it('无参构造：位置/旋转/缩放默认值正确', () => {
      const t = new TransformComponent();
      expect(t.position.x).toBe(0);
      expect(t.position.y).toBe(0);
      expect(t.position.z).toBe(0);
      expect(t.position.elevation).toBe(0);
      expect(t.rotation).toBe(0);
      expect(t.scale).toEqual({ x: 1, y: 1 });
      expect(t.floorId).toBe('ground');
    });

    it('传统数值入参等价于 setPosition(x, y)', () => {
      const t = new TransformComponent(10, 20);
      expect(t.position.x).toBe(10);
      expect(t.position.y).toBe(20);
      expect(t.position.z).toBe(20);
      expect(t.position.elevation).toBe(0);
    });

    it('对象入参支持 x/y/z/elevation/floorId', () => {
      const t = new TransformComponent({
        x: 5, y: 15, elevation: 40, floorId: 'upper', scaleX: 2, rotation: 0.3
      });
      expect(t.position.x).toBe(5);
      expect(t.position.y).toBe(15);
      expect(t.position.z).toBe(15);
      expect(t.position.elevation).toBe(40);
      expect(t.floorId).toBe('upper');
      expect(t.scale.x).toBe(2);
      expect(t.rotation).toBeCloseTo(0.3);
    });

    it('对象入参若提供 z，优先使用 z 作为地面深度', () => {
      const t = new TransformComponent({ x: 1, z: 99 });
      expect(t.position.y).toBe(99);
      expect(t.position.z).toBe(99);
    });
  });

  describe('position 代理读写', () => {
    it('写 position.y 应同步到 position.z', () => {
      const t = new TransformComponent();
      t.position.y = 50;
      expect(t.position.z).toBe(50);
    });

    it('写 position.z 应同步到 position.y', () => {
      const t = new TransformComponent();
      t.position.z = 77;
      expect(t.position.y).toBe(77);
    });

    it('写 position.elevation 不影响 y/z', () => {
      const t = new TransformComponent(1, 2);
      t.position.elevation = 10;
      expect(t.position.x).toBe(1);
      expect(t.position.y).toBe(2);
      expect(t.position.z).toBe(2);
      expect(t.position.elevation).toBe(10);
    });
  });

  describe('setPosition', () => {
    it('旧签名 setPosition(x, y) 不破坏 elevation', () => {
      const t = new TransformComponent();
      t.position.elevation = 40;
      t.setPosition(3, 4);
      expect(t.position.x).toBe(3);
      expect(t.position.y).toBe(4);
      expect(t.position.elevation).toBe(40);
    });

    it('新签名 setPosition(x, y, elevation) 正确写入', () => {
      const t = new TransformComponent();
      t.setPosition(1, 2, 3);
      expect(t.position.x).toBe(1);
      expect(t.position.y).toBe(2);
      expect(t.position.elevation).toBe(3);
    });

    it('setWorldPosition3D 使用 three.js 语义（x, elevation, z）', () => {
      const t = new TransformComponent();
      t.setWorldPosition3D(10, 20, 30);
      expect(t.position.x).toBe(10);
      expect(t.position.elevation).toBe(20);
      expect(t.position.z).toBe(30);
      expect(t.position.y).toBe(30);
    });
  });

  describe('translate / rotate / setScale', () => {
    it('translate 按 XZ 平面累加', () => {
      const t = new TransformComponent(0, 0);
      t.translate(5, 7);
      t.translate(1, 2);
      expect(t.position.x).toBe(6);
      expect(t.position.y).toBe(9);
    });

    it('rotate 累加角度', () => {
      const t = new TransformComponent();
      t.rotate(0.1);
      t.rotate(0.2);
      expect(t.rotation).toBeCloseTo(0.3);
    });

    it('setScale 正确设置 x/y 缩放', () => {
      const t = new TransformComponent();
      t.setScale(2);
      expect(t.scale).toEqual({ x: 2, y: 2 });
      t.setScale(3, 4);
      expect(t.scale).toEqual({ x: 3, y: 4 });
    });
  });

  describe('getWorldPosition / getWorldPosition3D', () => {
    it('getWorldPosition 返回 2D {x, y}（兼容旧代码）', () => {
      const t = new TransformComponent(1, 2);
      t.position.elevation = 9;
      expect(t.getWorldPosition()).toEqual({ x: 1, y: 2 });
    });

    it('getWorldPosition3D 返回 three.js 语义 {x, y=elevation, z=depth}', () => {
      const t = new TransformComponent(1, 2);
      t.position.elevation = 9;
      expect(t.getWorldPosition3D()).toEqual({ x: 1, y: 9, z: 2 });
    });
  });

  describe('floorId / setFloor', () => {
    it('默认 ground', () => {
      expect(new TransformComponent().floorId).toBe('ground');
    });
    it('setFloor 正确更新', () => {
      const t = new TransformComponent();
      t.setFloor('upper');
      expect(t.floorId).toBe('upper');
    });
  });
});

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
import { toThreePosition, applyTransformToObject3D } from './Transform3DAdapter.js';
import { TransformComponent } from '../../ecs/components/TransformComponent.js';

describe('Transform3DAdapter', () => {
  describe('toThreePosition', () => {
    it('标准映射：{x, elevation, z} → three {x, y, z}', () => {
      const t = new TransformComponent({ x: 10, y: 20, elevation: 5, floorId: 'upper' });
      const p = toThreePosition(t);
      expect(p).toEqual({ x: 10, y: 5, z: 20, floorId: 'upper' });
    });

    it('未指定 elevation → y=0', () => {
      const t = new TransformComponent(1, 2);
      expect(toThreePosition(t)).toEqual({ x: 1, y: 0, z: 2, floorId: 'ground' });
    });

    it('null/undefined 返回 null', () => {
      expect(toThreePosition(null)).toBeNull();
      expect(toThreePosition(undefined)).toBeNull();
    });

    it('floorId 透传', () => {
      const t = new TransformComponent();
      t.setFloor('basement');
      expect(toThreePosition(t).floorId).toBe('basement');
    });
  });

  describe('applyTransformToObject3D', () => {
    function makeMockObject3D() {
      return {
        position: {
          x: 0, y: 0, z: 0,
          set(x, y, z) { this.x = x; this.y = y; this.z = z; }
        },
        rotation: { x: 0, y: 0, z: 0 }
      };
    }

    it('将 TransformComponent 应用到 object3D.position', () => {
      const t = new TransformComponent({ x: 3, y: 4, elevation: 7 });
      const obj = makeMockObject3D();
      applyTransformToObject3D(obj, t);
      expect(obj.position.x).toBe(3);
      expect(obj.position.y).toBe(7);
      expect(obj.position.z).toBe(4);
    });

    it('旋转应用到 rotation.y（单值语义）', () => {
      const t = new TransformComponent();
      t.rotation = 1.23;
      const obj = makeMockObject3D();
      applyTransformToObject3D(obj, t);
      expect(obj.rotation.y).toBeCloseTo(1.23);
    });

    it('缺少 object3D 或 transform 不崩溃', () => {
      expect(() => applyTransformToObject3D(null, new TransformComponent())).not.toThrow();
      expect(() => applyTransformToObject3D(makeMockObject3D(), null)).not.toThrow();
    });
  });
});

/**
 * Camera.test.js
 * 相机类单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Camera } from './Camera.js';

describe('Camera', () => {
  let camera;

  beforeEach(() => {
    camera = new Camera(0, 0, 1280, 720);
  });

  describe('基础功能', () => {
    it('应该正确初始化相机', () => {
      expect(camera.position.x).toBe(0);
      expect(camera.position.y).toBe(0);
      expect(camera.width).toBe(1280);
      expect(camera.height).toBe(720);
    });

    it('应该能设置相机位置', () => {
      // 设置足够大的边界以避免限制
      camera.setBounds(0, 0, 5000, 5000);
      camera.setPosition(1000, 1000);
      expect(camera.position.x).toBe(1000);
      expect(camera.position.y).toBe(1000);
    });

    it('应该能移动相机', () => {
      // 设置足够大的边界以避免限制
      camera.setBounds(0, 0, 5000, 5000);
      camera.setPosition(1000, 1000);
      camera.move(50, -30);
      expect(camera.position.x).toBe(1050);
      expect(camera.position.y).toBe(970);
    });
  });

  describe('自由移动（不钳制边界）', () => {
    beforeEach(() => {
      // 设置地图边界: 0-2000 x 0-1500
      camera.setBounds(0, 0, 2000, 1500);
    });

    it('setPosition 不钳制，可越出左边界', () => {
      camera.setPosition(-1000, 500);
      // 自由移动：相机位置不再被钳制
      expect(camera.position.x).toBe(-1000);
      expect(camera.position.y).toBe(500);
    });

    it('setPosition 不钳制，可越出右边界', () => {
      camera.setPosition(3000, 500);
      expect(camera.position.x).toBe(3000);
    });

    it('setPosition 不钳制，可越出上边界', () => {
      camera.setPosition(1000, -1000);
      expect(camera.position.y).toBe(-1000);
    });

    it('setPosition 不钳制，可越出下边界', () => {
      camera.setPosition(1000, 3000);
      expect(camera.position.y).toBe(3000);
    });

    it('move 同样不应用边界钳制', () => {
      camera.setPosition(100, 100);
      camera.move(-200, -200);
      expect(camera.position.x).toBe(-100);
      expect(camera.position.y).toBe(-100);
    });

    it('小于视野的地图也不强制居中，位置保持所设值', () => {
      // 地图比视野小
      camera.setBounds(0, 0, 800, 500);
      camera.setPosition(400, 250);
      expect(camera.position.x).toBe(400);
      expect(camera.position.y).toBe(250);
    });
  });

  describe('目标跟随', () => {
    let target;

    beforeEach(() => {
      target = { position: { x: 1000, y: 1000 } };
      camera.setBounds(0, 0, 3000, 3000);
      camera.setPosition(800, 800);
    });

    it('应该能设置跟随目标', () => {
      camera.setTarget(target);
      expect(camera.target).toBe(target);
    });

    it('应该直接跟随目标（直跟语义）', () => {
      camera.setTarget(target);
      camera.followSpeed = 0.1;
      camera.deadzone = { x: 0, y: 0 }; // 禁用死区以确保相机移动

      // 直跟：更新一帧后相机应立即到达目标位置
      camera.update(1/60);

      expect(camera.position.x).toBe(target.position.x);
      expect(camera.position.y).toBe(target.position.y);
    });

    it('开启平滑追赶后应渐进趋近目标', () => {
      camera.setTarget(target);
      camera.beginSmoothFollow(0.1);

      const initialX = camera.position.x;
      const initialY = camera.position.y;

      // 更新一帧：只按比例趋近，不会立即到达
      camera.update(1/60);

      expect(camera.position.x).toBeCloseTo(initialX + (target.position.x - initialX) * 0.1);
      expect(camera.position.y).toBeCloseTo(initialY + (target.position.y - initialY) * 0.1);
      expect(camera.position.x).toBeLessThan(target.position.x);
      expect(camera.position.y).toBeLessThan(target.position.y);
    });

    it('死区不再拦截跟随：目标在死区内相机也直接跟随', () => {
      camera.setPosition(500, 500);
      camera.setTarget(target);
      camera.deadzone = { x: 100, y: 100 };

      // 目标在死区内
      target.position = { x: 550, y: 550 };

      camera.update(1/60);

      // 直跟语义：相机仍然直接到达目标位置
      expect(camera.position.x).toBe(550);
      expect(camera.position.y).toBe(550);
    });

    it('应该在目标离开死区时移动相机', () => {
      camera.setPosition(500, 500);
      camera.setTarget(target);
      camera.deadzone = { x: 50, y: 50 };
      
      // 目标在死区外
      target.position = { x: 700, y: 700 };
      
      const initialX = camera.position.x;
      const initialY = camera.position.y;
      
      camera.update(1/60);
      
      // 相机应该移动
      expect(camera.position.x).toBeGreaterThan(initialX);
      expect(camera.position.y).toBeGreaterThan(initialY);
    });

    it('跟随不进行边界钳制', () => {
      camera.setTarget(target);
      camera.followSpeed = 1.0; // 立即跟随

      // 目标在地图边界外
      target.position = { x: 5000, y: 5000 };

      camera.update(1/60);

      // 自由移动：相机直接到达目标位置，不被钳制在边界内
      expect(camera.position.x).toBe(5000);
      expect(camera.position.y).toBe(5000);
    });

    it('平滑追赶速度越大单帧趋近越多', () => {
      camera.setTarget(target);
      camera.deadzone = { x: 0, y: 0 }; // 禁用死区以确保相机移动

      // 慢速平滑追赶
      camera.beginSmoothFollow(0.05);
      camera.update(1/60);
      const slowX = camera.position.x;

      // 重置并测试快速平滑追赶
      camera.setPosition(800, 800);
      camera.beginSmoothFollow(0.5);
      camera.update(1/60);
      const fastX = camera.position.x;

      // 快速趋近应该移动更多
      expect(fastX).toBeGreaterThan(slowX);
    });
  });

  describe('坐标转换', () => {
    beforeEach(() => {
      camera.setPosition(1000, 500);
    });

    it('应该正确转换世界坐标到屏幕坐标', () => {
      const screen = camera.worldToScreen(1000, 500);
      // 目标在相机中心，应该在屏幕中心
      expect(screen.x).toBe(640); // 1280/2
      expect(screen.y).toBe(360); // 720/2
    });

    it('应该正确转换屏幕坐标到世界坐标', () => {
      const world = camera.screenToWorld(640, 360);
      // 屏幕中心应该对应相机位置
      expect(world.x).toBe(1000);
      expect(world.y).toBe(500);
    });

    it('世界到屏幕再到世界应该保持一致', () => {
      const worldX = 1234;
      const worldY = 567;
      
      const screen = camera.worldToScreen(worldX, worldY);
      const world = camera.screenToWorld(screen.x, screen.y);
      
      expect(world.x).toBeCloseTo(worldX, 0);
      expect(world.y).toBeCloseTo(worldY, 0);
    });
  });

  describe('可见性检测', () => {
    beforeEach(() => {
      camera.setPosition(1000, 500);
    });

    it('应该正确检测点是否可见', () => {
      // 相机中心的点应该可见
      expect(camera.isPointVisible(1000, 500)).toBe(true);
      
      // 视野内的点应该可见
      expect(camera.isPointVisible(1200, 600)).toBe(true);
      
      // 视野外的点不应该可见
      expect(camera.isPointVisible(3000, 3000)).toBe(false);
    });

    it('应该支持边距参数', () => {
      const x = 1000 + 700; // 刚好在视野外
      const y = 500;
      
      // 不带边距应该不可见
      expect(camera.isPointVisible(x, y, 0)).toBe(false);
      
      // 带边距应该可见
      expect(camera.isPointVisible(x, y, 100)).toBe(true);
    });

    it('应该正确检测矩形是否可见', () => {
      // 完全在视野内的矩形
      expect(camera.isRectVisible(1000, 500, 50, 50)).toBe(true);
      
      // 部分在视野内的矩形
      expect(camera.isRectVisible(1600, 500, 100, 100)).toBe(true);
      
      // 完全在视野外的矩形
      expect(camera.isRectVisible(3000, 3000, 50, 50)).toBe(false);
    });
  });

  describe('视野边界', () => {
    it('应该正确计算视野边界', () => {
      camera.setPosition(1000, 500);
      const bounds = camera.getViewBounds();
      
      expect(bounds.left).toBe(360);    // 1000 - 640
      expect(bounds.right).toBe(1640);  // 1000 + 640
      expect(bounds.top).toBe(140);     // 500 - 360
      expect(bounds.bottom).toBe(860);  // 500 + 360
    });

    it('视野边界应该随相机移动更新', () => {
      camera.setPosition(500, 500);
      const bounds1 = camera.getViewBounds();
      
      camera.move(100, 100);
      const bounds2 = camera.getViewBounds();
      
      expect(bounds2.left).toBe(bounds1.left + 100);
      expect(bounds2.right).toBe(bounds1.right + 100);
      expect(bounds2.top).toBe(bounds1.top + 100);
      expect(bounds2.bottom).toBe(bounds1.bottom + 100);
    });
  });
});

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
import { Camera3DAdapter } from './Camera3DAdapter.js';
import * as THREE from 'three';

describe('Camera3DAdapter', () => {
  it('默认创建正交相机', () => {
    const cam = new Camera3DAdapter({ width: 1280, height: 720 });
    expect(cam.native).toBeInstanceOf(THREE.OrthographicCamera);
  });

  it('setAngle 后 position 会重新计算', () => {
    const cam = new Camera3DAdapter({});
    const before = cam.native.position.clone();
    cam.setAngle(60, 90);
    const after = cam.native.position.clone();
    expect(after.equals(before)).toBe(false);
  });

  it('screenToWorld → 打在 y=0 地面平面', () => {
    const cam = new Camera3DAdapter({ width: 1280, height: 720 });
    // 屏幕中心应对应相机 focus（默认 0,0,0）附近
    const p = cam.screenToWorld(640, 360);
    expect(Math.abs(p.y)).toBeLessThan(0.01);
  });

  it('setTarget + update 更新 focus', () => {
    const cam = new Camera3DAdapter({});
    cam.setTarget({ position: { x: 100, y: 0, z: 200, elevation: 0 } });
    cam.update(0);
    expect(cam._focus.x).toBe(100);
    expect(cam._focus.z).toBe(200);
  });

  it('setSize 更新投影', () => {
    const cam = new Camera3DAdapter({ width: 1280, height: 720 });
    cam.setSize(1920, 1080);
    expect(cam.native.right - cam.native.left).toBeCloseTo(1920);
  });

  it('切换到透视相机', () => {
    const cam = new Camera3DAdapter({ camera: 'perspective', width: 800, height: 600 });
    expect(cam.native).toBeInstanceOf(THREE.PerspectiveCamera);
  });
});

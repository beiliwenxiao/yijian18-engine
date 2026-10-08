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
import { Canvas2DBackend } from './Canvas2DBackend.js';
import { IRenderBackend } from './IRenderBackend.js';

/**
 * 构造一个满足 Canvas2DBackend 使用的最小 mock canvas/ctx。
 */
function makeMockCanvas() {
  const ctx = {
    fillStyle: '',
    textRendering: '',
    setTransform: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    // 其他被 RenderSystem 可能触碰的 API 可留空实现
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    fillText: vi.fn(),
    clearRect: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: vi.fn(() => ctx)
  };
  return { canvas, ctx };
}

describe('Canvas2DBackend', () => {
  let backend;
  let canvas;
  let ctx;

  beforeEach(() => {
    ({ canvas, ctx } = makeMockCanvas());
    backend = new Canvas2DBackend();
  });

  it('继承自 IRenderBackend', () => {
    expect(backend).toBeInstanceOf(IRenderBackend);
    expect(backend.mode).toBe('2d');
  });

  describe('init', () => {
    it('无 canvas 入参应抛错', async () => {
      await expect(backend.init(null)).rejects.toThrow(/canvas is required/);
    });

    it('正常初始化应创建 camera/picker/renderSystem/particleRenderer', async () => {
      await backend.init(canvas, { gameWidth: 800, gameHeight: 600 });
      expect(backend.canvas).toBe(canvas);
      expect(backend.ctx).toBe(ctx);
      expect(backend.camera).toBeTruthy();
      expect(backend.picker).toBeTruthy();
      expect(backend.renderSystem).toBeTruthy();
      expect(backend.particleRenderer).toBeTruthy();
      expect(backend.gameWidth).toBe(800);
      expect(backend.gameHeight).toBe(600);
    });
  });

  describe('resize', () => {
    it('应按 DPR 设置实际像素尺寸并保持游戏逻辑尺寸', async () => {
      await backend.init(canvas, { gameWidth: 1280, gameHeight: 720 });
      // 模拟 window.devicePixelRatio
      const originalWin = global.window;
      global.window = { devicePixelRatio: 2 };
      backend.resize(1920, 1080);
      global.window = originalWin;

      expect(canvas.width).toBe(1280 * 2);
      expect(canvas.height).toBe(720 * 2);
      // camera 尺寸保持游戏逻辑尺寸
      expect(backend.camera.width).toBe(1280);
      expect(backend.camera.height).toBe(720);
    });
  });

  describe('生命周期', () => {
    it('dispose 后清理内部引用', async () => {
      await backend.init(canvas);
      backend.dispose();
      expect(backend.ctx).toBeNull();
      expect(backend.renderSystem).toBeNull();
      expect(backend.particleRenderer).toBeNull();
      expect(backend._disposed).toBe(true);
    });
  });

  describe('beginFrame/endFrame', () => {
    it('beginFrame 应清屏', async () => {
      await backend.init(canvas);
      backend.beginFrame();
      expect(ctx.fillRect).toHaveBeenCalled();
    });
    it('endFrame 应无副作用', async () => {
      await backend.init(canvas);
      expect(() => backend.endFrame()).not.toThrow();
    });
  });

  describe('renderEntities/renderParticles/renderEffects', () => {
    it('renderEntities 应委托给 renderSystem.render', async () => {
      await backend.init(canvas);
      const spy = vi.spyOn(backend.renderSystem, 'render').mockImplementation(() => {});
      backend.renderEntities([{ id: 1 }]);
      expect(spy).toHaveBeenCalled();
    });

    it('renderParticles 调用 particleRenderer.render', async () => {
      await backend.init(canvas);
      const spy = vi.spyOn(backend.particleRenderer, 'render');
      const ps = { render: vi.fn() };
      backend.renderParticles(ps);
      expect(spy).toHaveBeenCalled();
    });

    it('renderEffects 对具有 render 方法的对象应调用 render', async () => {
      await backend.init(canvas);
      const effects = { render: vi.fn() };
      backend.renderEffects(effects);
      expect(effects.render).toHaveBeenCalled();
    });

    it('renderEffects 对 null/非法入参不崩溃', async () => {
      await backend.init(canvas);
      expect(() => backend.renderEffects(null)).not.toThrow();
      expect(() => backend.renderEffects({})).not.toThrow();
    });
  });

  describe('getHUDContext', () => {
    it('返回主 canvas 2D context', async () => {
      await backend.init(canvas);
      expect(backend.getHUDContext()).toBe(ctx);
    });
  });
});

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

import { describe, it, expect, vi } from 'vitest';
import { AssetManager } from './AssetManager.js';

describe('AssetManager 多后端注册', () => {
  it('registerAsset 不崩溃且向后兼容 addImage', () => {
    const am = new AssetManager();
    am.registerAsset('hero', { type: 'image', url: 'assets/hero.png', backends: ['2d', '3d'] });
    expect(am.loadQueue.some(a => a.key === 'hero')).toBe(true);
  });

  it('getAsset 不传 mode 回落到旧 getImage 行为', () => {
    const am = new AssetManager();
    am.images.set('x', { _fake: true });
    expect(am.getAsset('x')).toEqual({ _fake: true });
  });

  it('getAsset 传 mode 时命中多后端注册表', () => {
    const am = new AssetManager();
    const mock2d = { tag: '2d' };
    const mock3d = { tag: '3d' };
    // 手动放入 images（绕开实际网络加载）
    am.images.set('assets/2d.png', mock2d);
    am.images.set('assets/3d.png', mock3d);
    am.registerAsset('hero', { type: 'image', url: 'assets/2d.png', backends: ['2d'] });
    am.registerAsset('hero', { type: 'image', url: 'assets/3d.png', backends: ['3d'] });

    expect(am.getAsset('hero', '2d')).toBe(mock2d);
    expect(am.getAsset('hero', '3d')).toBe(mock3d);
  });

  it('未注册的资源 getAsset 返回 null 且发出 warn', () => {
    const am = new AssetManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(am.getAsset('missing')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

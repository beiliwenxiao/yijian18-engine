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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseBackendConfig,
  getHostBackendDefaults,
  HOST_BACKEND_DEFAULTS
} from './BackendConfig.js';
import { supportsThreeBackend, pickBackend } from './pickBackend.js';
import { PlatformProfile, RuntimeHost } from '../../core/PlatformProfile.js';

describe('按宿主的后端默认值', () => {
  it('PC 桌面与浏览器默认 auto，允许选到 3D', () => {
    expect(getHostBackendDefaults(RuntimeHost.ELECTRON).mode).toBe('auto');
    expect(getHostBackendDefaults(RuntimeHost.WEB).mode).toBe('auto');
  });

  it('Android 与微信小游戏默认 2D', () => {
    expect(getHostBackendDefaults(RuntimeHost.CAPACITOR).mode).toBe('2d');
    expect(getHostBackendDefaults(RuntimeHost.WEAPP).mode).toBe('2d');
  });

  it('未知宿主不产生默认值', () => {
    expect(getHostBackendDefaults('unknown')).toEqual({});
    expect(getHostBackendDefaults(undefined)).toEqual({});
  });

  it('默认值表为只读常量', () => {
    expect(Object.isFrozen(HOST_BACKEND_DEFAULTS)).toBe(true);
  });
});

describe('parseBackendConfig 的优先级', () => {
  it('宿主默认值覆盖全局默认值', () => {
    const cfg = parseBackendConfig({}, '', { host: RuntimeHost.CAPACITOR });
    expect(cfg.mode).toBe('2d');
  });

  it('userConfig 高于宿主默认值', () => {
    const cfg = parseBackendConfig({ mode: '3d' }, '', { host: RuntimeHost.WEAPP });
    expect(cfg.mode).toBe('3d');
  });

  it('URL 参数高于 userConfig', () => {
    const cfg = parseBackendConfig({ mode: '2d' }, '?mode=3d', { host: RuntimeHost.CAPACITOR });
    expect(cfg.mode).toBe('3d');
  });

  it('宿主默认值不影响其他字段', () => {
    const cfg = parseBackendConfig({}, '', { host: RuntimeHost.WEAPP });
    expect(cfg.hud).toBe('auto');
    expect(cfg.three.pitchDeg).toBe(30);
    expect(cfg.layers.order).toContain('entity');
  });

  it('不传 host 时使用当前宿主检测结果', () => {
    PlatformProfile.setHost(RuntimeHost.CAPACITOR);
    expect(parseBackendConfig({}, '').mode).toBe('2d');

    PlatformProfile.setHost(RuntimeHost.ELECTRON);
    expect(parseBackendConfig({}, '').mode).toBe('auto');
  });

  it('显式传入 host 时不受全局状态影响', () => {
    PlatformProfile.setHost(RuntimeHost.ELECTRON);
    expect(parseBackendConfig({}, '', { host: RuntimeHost.WEAPP }).mode).toBe('2d');
  });
});

describe('PlatformProfile 宿主判定', () => {
  let originalHost;

  beforeEach(() => {
    originalHost = PlatformProfile.host;
  });

  afterEach(() => {
    PlatformProfile.setHost(originalHost);
  });

  it('可手动设置宿主并通过便捷属性查询', () => {
    PlatformProfile.setHost(RuntimeHost.WEAPP);
    expect(PlatformProfile.isWeapp).toBe(true);
    expect(PlatformProfile.isElectron).toBe(false);
    expect(PlatformProfile.hasDOM).toBe(false);

    PlatformProfile.setHost(RuntimeHost.ELECTRON);
    expect(PlatformProfile.isElectron).toBe(true);
    expect(PlatformProfile.hasDOM).toBe(true);
  });

  it('非法宿主值被忽略', () => {
    PlatformProfile.setHost(RuntimeHost.WEB);
    PlatformProfile.setHost('not-a-host');
    expect(PlatformProfile.host).toBe(RuntimeHost.WEB);
  });

  it('交互形态与运行宿主互相独立', () => {
    PlatformProfile.set('mobile');
    PlatformProfile.setHost(RuntimeHost.CAPACITOR);
    expect(PlatformProfile.isMobile).toBe(true);
    expect(PlatformProfile.isCapacitor).toBe(true);

    // 桌面浏览器调试移动端布局：形态 mobile 但宿主仍是 web
    PlatformProfile.setHost(RuntimeHost.WEB);
    expect(PlatformProfile.isMobile).toBe(true);
    expect(PlatformProfile.isWeb).toBe(true);
  });
});

describe('pickBackend 的宿主约束', () => {
  let originalHost;

  beforeEach(() => {
    originalHost = PlatformProfile.host;
  });

  afterEach(() => {
    PlatformProfile.setHost(originalHost);
  });

  it('微信小游戏宿主不支持 3D 后端', () => {
    expect(supportsThreeBackend(RuntimeHost.WEAPP)).toBe(false);
  });

  it('其余宿主允许 3D 后端', () => {
    expect(supportsThreeBackend(RuntimeHost.ELECTRON)).toBe(true);
    expect(supportsThreeBackend(RuntimeHost.WEB)).toBe(true);
    expect(supportsThreeBackend(RuntimeHost.CAPACITOR)).toBe(true);
  });

  it('小游戏宿主下即使显式指定 3D 也回退 Canvas2D', async () => {
    const backend = await pickBackend({ mode: '3d', host: RuntimeHost.WEAPP });
    expect(backend.constructor.name).toBe('Canvas2DBackend');
  });

  it('2D 模式在任何宿主下都返回 Canvas2D', async () => {
    const backend = await pickBackend({ mode: '2d', host: RuntimeHost.ELECTRON });
    expect(backend.constructor.name).toBe('Canvas2DBackend');
  });

  it('未传 host 时使用当前宿主判定', async () => {
    PlatformProfile.setHost(RuntimeHost.WEAPP);
    const backend = await pickBackend({ mode: '3d' });
    expect(backend.constructor.name).toBe('Canvas2DBackend');
  });
});

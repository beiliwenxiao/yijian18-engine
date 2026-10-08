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
import {
  DEFAULT_BACKEND_CONFIG,
  parseBackendConfig,
  parseUrlParams
} from './BackendConfig.js';

describe('BackendConfig', () => {
  describe('DEFAULT_BACKEND_CONFIG', () => {
    it('应该冻结默认配置，避免被意外改写', () => {
      expect(Object.isFrozen(DEFAULT_BACKEND_CONFIG)).toBe(true);
      expect(DEFAULT_BACKEND_CONFIG.mode).toBe('auto');
      expect(DEFAULT_BACKEND_CONFIG.debug).toBe(false);
      expect(DEFAULT_BACKEND_CONFIG.three.camera).toBe('ortho');
      expect(DEFAULT_BACKEND_CONFIG.layers.order).toEqual([
        'ground', 'decal', 'entity', 'aerial', 'effect'
      ]);
    });
  });

  describe('parseBackendConfig - 默认值', () => {
    it('不传参数时应返回默认配置的拷贝', () => {
      const cfg = parseBackendConfig({}, '');
      expect(cfg.mode).toBe('auto');
      expect(cfg.debug).toBe(false);
      expect(cfg.three.pitchDeg).toBe(30);
      expect(cfg.layers.crossFloorAlpha).toBe(0.2);
      // 验证是独立拷贝
      cfg.mode = '2d';
      expect(DEFAULT_BACKEND_CONFIG.mode).toBe('auto');
    });
  });

  describe('parseBackendConfig - userConfig 覆盖', () => {
    it('userConfig 应覆盖默认值', () => {
      const cfg = parseBackendConfig({ mode: '3d', debug: true }, '');
      expect(cfg.mode).toBe('3d');
      expect(cfg.debug).toBe(true);
    });

    it('部分覆盖不影响其他字段', () => {
      const cfg = parseBackendConfig(
        { three: { pitchDeg: 60 } },
        ''
      );
      expect(cfg.three.pitchDeg).toBe(60);
      expect(cfg.three.yawDeg).toBe(45); // 默认值保留
      expect(cfg.three.camera).toBe('ortho');
    });
  });

  describe('parseBackendConfig - URL 参数覆盖', () => {
    it('URL 参数应覆盖 userConfig', () => {
      const cfg = parseBackendConfig({ mode: '2d' }, '?mode=3d');
      expect(cfg.mode).toBe('3d');
    });

    it('解析 debug/camera/pitch/yaw', () => {
      const cfg = parseBackendConfig({}, '?mode=3d&debug=1&camera=perspective&pitch=45&yaw=60');
      expect(cfg.mode).toBe('3d');
      expect(cfg.debug).toBe(true);
      expect(cfg.three.camera).toBe('perspective');
      expect(cfg.three.pitchDeg).toBe(45);
      expect(cfg.three.yawDeg).toBe(60);
    });

    it('debug=true 字符串也应解析为 true', () => {
      const cfg = parseBackendConfig({}, '?debug=true');
      expect(cfg.debug).toBe(true);
    });

    it('debug=0 应解析为 false', () => {
      const cfg = parseBackendConfig({ debug: true }, '?debug=0');
      expect(cfg.debug).toBe(false);
    });
  });

  describe('parseBackendConfig - 非法值兜底', () => {
    it('非法 mode 应回退到 userConfig 或默认值', () => {
      const cfg = parseBackendConfig({ mode: 'xxx' }, '?mode=yyy');
      expect(cfg.mode).toBe('auto');
    });

    it('非法 hud 不应污染配置', () => {
      const cfg = parseBackendConfig({ hud: 'bad' }, '');
      expect(cfg.hud).toBe('auto');
    });

    it('非法 pitch 字符串应被忽略', () => {
      const cfg = parseBackendConfig({}, '?pitch=abc');
      expect(cfg.three.pitchDeg).toBe(30);
    });

    it('非对象 userConfig 应被安全忽略', () => {
      expect(() => parseBackendConfig(null, '')).not.toThrow();
      expect(() => parseBackendConfig(undefined, '')).not.toThrow();
      expect(() => parseBackendConfig(42, '')).not.toThrow();
      const cfg = parseBackendConfig(null, '');
      expect(cfg.mode).toBe('auto');
    });
  });

  describe('parseUrlParams', () => {
    it('支持 URLSearchParams 输入', () => {
      const params = new URLSearchParams('mode=3d&debug=1');
      const result = parseUrlParams(params);
      expect(result.mode).toBe('3d');
      expect(result.debug).toBe(true);
    });

    it('支持字符串输入（带或不带问号）', () => {
      expect(parseUrlParams('mode=3d').mode).toBe('3d');
      expect(parseUrlParams('?mode=3d').mode).toBe('3d');
    });

    it('不传参数时不崩溃（jsdom 环境有 window）', () => {
      expect(() => parseUrlParams()).not.toThrow();
    });
  });
});

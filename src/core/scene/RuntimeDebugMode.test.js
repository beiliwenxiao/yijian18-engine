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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeRuntimeDebugMode, RuntimeConfigSnapshot } from '../CanonicalSnapshot.js';
import { TriggerSystem } from '../../systems/TriggerSystem.js';
import { SceneEntityStore } from './SceneEntityStore.js';
import { GameSceneContext } from './GameSceneContext.js';
import { SceneDiagnostics } from './SceneDiagnostics.js';
import { applySceneRuntimeConfig, toggleSceneDebugPanel } from './RuntimeDebugWiring.js';

const ENABLED = [true, 1, '1'];
const DISABLED = [false, 0, '0', null, undefined, '', 'true', 2, {}, []];

function project(debug) {
  return { schemaVersion: 1, system: { debug } };
}

function wiredScene() {
  const scene = {
    name: 'debug-scene', isActive: true, isPaused: false, sceneManager: null,
    context: new GameSceneContext({ entities: new SceneEntityStore() }),
    debugMode: false,
    gameLoader: { triggerSystem: new TriggerSystem() }
  };
  scene._diagnostics = new SceneDiagnostics(scene);
  return scene;
}

function applyRuntimeConfig(scene, runtimeConfig) {
  return applySceneRuntimeConfig(scene, runtimeConfig);
}

function toggleDebugPanel(scene) {
  return toggleSceneDebugPanel(scene);
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('RuntimeConfig unified debug mode', () => {
  it.each(ENABLED)('仅受支持值 %j 归一化为启用并投影到真实 debug 接线', value => {
    const runtimeConfig = new RuntimeConfigSnapshot(project(value), 4);
    const scene = wiredScene();

    expect(normalizeRuntimeDebugMode(value)).toBe(true);
    expect(applyRuntimeConfig(scene, runtimeConfig)).toBe(true);
    expect(runtimeConfig.debug).toBe(true);
    expect(scene.context.runtime.config).toBe(runtimeConfig);
    expect(scene.context.runtime.debugMode).toBe(true);
    expect(scene.debugMode).toBe(true);
    expect(scene._diagnostics.runtimeConfig).toBe(runtimeConfig);
    expect(scene._diagnostics.isDebugEnabled()).toBe(true);
    expect(scene.gameLoader.triggerSystem.runtimeConfig).toBe(runtimeConfig);
    expect(scene.gameLoader.triggerSystem.isDebugEnabled()).toBe(true);
    expect(Object.isFrozen(runtimeConfig)).toBe(true);
  });

  it.each(DISABLED)('其他值 %j 均归一化为禁用并投影到真实 debug 接线', value => {
    const runtimeConfig = new RuntimeConfigSnapshot(project(value), 4);
    const scene = wiredScene();

    expect(normalizeRuntimeDebugMode(value)).toBe(false);
    expect(applyRuntimeConfig(scene, runtimeConfig)).toBe(false);
    expect(runtimeConfig.debug).toBe(false);
    expect(scene.context.runtime.debugMode).toBe(false);
    expect(scene.debugMode).toBe(false);
    expect(scene._diagnostics.isDebugEnabled()).toBe(false);
    expect(scene.gameLoader.triggerSystem.isDebugEnabled()).toBe(false);
  });

  it('失败、快捷和程序入口共用门禁，关闭重开、dispose 与后续失败不清空记录', () => {
    const scene = wiredScene();
    const diagnostics = scene._diagnostics;
    const disabled = new RuntimeConfigSnapshot(project(false), 1);
    applyRuntimeConfig(scene, disabled);

    // 现有反引号快捷入口和 toggleDebug 程序 action 最终都调用该真实生产入口。
    expect(toggleDebugPanel(scene)).toBe(false);
    expect(scene.debugPanel).toBeNull();
    expect(diagnostics.recordTriggerFailure({ type: 'triggerFailure', triggerId: 'disabled' })).toBe(false);
    expect(diagnostics.getRecords()).toEqual([]);

    const enabled = new RuntimeConfigSnapshot(project(true), 2);
    applyRuntimeConfig(scene, enabled);
    const first = Object.freeze({
      type: 'triggerFailure', triggerId: 'trigger.one', reason: 'unknownAction',
      action: Object.freeze({ index: 1 })
    });
    expect(diagnostics.recordTriggerFailure(first)).toBe(true);
    const panel = scene.debugPanel;
    expect(panel.visible).toBe(true);
    expect(panel.diagnosticRecords).toEqual([first]);

    panel.hide();
    expect(panel.visible).toBe(false);
    expect(toggleDebugPanel(scene)).toBe(true);
    expect(panel.diagnosticRecords).toEqual([first]);
    panel.hide();
    expect(panel.show()).toBe(true);
    expect(panel.diagnosticRecords).toEqual([first]);

    applyRuntimeConfig(scene, disabled);
    expect(panel.visible).toBe(false);
    expect(toggleDebugPanel(scene)).toBe(false);
    expect(panel.show()).toBe(false);
    expect(panel.toggle()).toBe(false);
    panel._create();
    expect(document.getElementById('debug-panel')).toBeNull();
    expect(diagnostics.getRecords()).toEqual([first]);

    diagnostics.dispose();
    expect(scene.debugPanel).toBeNull();
    expect(diagnostics.getRecords()).toEqual([first]);

    applyRuntimeConfig(scene, enabled);
    const second = Object.freeze({
      type: 'triggerFailure', triggerId: 'trigger.two', reason: 'executeAsync',
      action: Object.freeze({ index: 0 })
    });
    expect(diagnostics.recordTriggerFailure(second)).toBe(true);
    expect(diagnostics.getRecords()).toEqual([first, second]);
    expect(scene.debugPanel).not.toBe(panel);
    expect(scene.debugPanel.diagnosticRecords).toEqual([first, second]);
  });
});

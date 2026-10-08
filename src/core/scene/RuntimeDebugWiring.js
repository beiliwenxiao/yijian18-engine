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

import { normalizeRuntimeDebugMode } from '../CanonicalSnapshot.js';

/**
 * 将唯一 RuntimeConfig 投影到 Scene、Context、Diagnostics 与 TriggerSystem。
 * BaseGameScene 只转发到这里，避免在 Demo 组合根中复制门禁逻辑。
 */
export function applySceneRuntimeConfig(scene, runtimeConfig = null) {
  if (!scene?.context?.applyRuntimeConfig) {
    throw new TypeError('Scene runtime debug wiring requires GameSceneContext');
  }
  const enabled = scene.context.applyRuntimeConfig(runtimeConfig);
  scene.debugMode = enabled;
  scene._diagnostics?.setRuntimeConfig?.(runtimeConfig);
  scene.gameLoader?.triggerSystem?.updateContext?.({
    runtimeConfig,
    sceneDiagnostics: scene._diagnostics || null
  });
  return normalizeRuntimeDebugMode(enabled);
}

/** 所有快捷、程序和 Trigger 入口共用 SceneDiagnostics 的现有面板门禁。 */
export function toggleSceneDebugPanel(scene) {
  return scene?._diagnostics?.toggleDebugPanel?.() === true;
}

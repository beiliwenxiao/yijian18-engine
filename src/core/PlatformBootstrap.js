/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * PlatformBootstrap.js
 * 平台引导边界：浏览器宿主的 DOM / 全局对象访问集中于此（platformInfra）。
 * 组装层（main.js 等）通过这里的纯函数取宿主资源，自身不触 DOM。
 */

/** 解析主画布元素 */
export function resolveGameCanvas(elementId = 'game-canvas') {
  if (typeof document === 'undefined') return null;
  return document.getElementById(elementId);
}

/** 将引擎实例暴露为宿主全局（供遗留调试工具访问） */
export function exposeGameEngine(engine) {
  if (typeof window !== 'undefined') {
    window.gameEngine = engine;
  }
}

/** 更新加载进度 UI */
export function updateLoadingProgress(progress, message) {
  if (typeof document === 'undefined') return;
  const progressFill = document.getElementById('progress-fill');
  const loadingText = document.getElementById('loading-text');

  if (progressFill) {
    progressFill.style.width = `${progress * 100}%`;
  }

  if (loadingText && message) {
    loadingText.textContent = message;
  }
}

/** 显示致命错误信息 */
export function showError(message) {
  if (typeof document === 'undefined') return;
  const loadingText = document.getElementById('loading-text');
  if (loadingText) {
    loadingText.textContent = message;
    loadingText.style.color = '#ff4444';
  }
}

/** 隐藏加载屏幕 */
export function hideLoadingScreen(delayMs = 500) {
  if (typeof document === 'undefined') return;
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    setTimeout(() => {
      loadingScreen.classList.add('hidden');
    }, delayMs);
  }
}

/** 检查浏览器兼容性 */
export function checkBrowserCompatibility() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const canvas = document.createElement('canvas');
  if (!canvas.getContext) {
    showError('Your browser does not support HTML5 Canvas');
    return false;
  }

  if (!window.requestAnimationFrame) {
    showError('Your browser does not support requestAnimationFrame');
    return false;
  }

  return true;
}

/** DOM 就绪后执行引导 */
export function onDomReady(bootstrap) {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}

/** 宿主 document.body（供演示场景挂载 UI 面板） */
export function getDocumentBody() {
  if (typeof document === 'undefined') return null;
  return document.body;
}

/** 全局 DOM 事件订阅（键盘快捷键等；平台边界统一入口） */
export function addDomEventListener(type, listener) {
  if (typeof document === 'undefined') return;
  document.addEventListener(type, listener);
}

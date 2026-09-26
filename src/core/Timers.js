/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 ************************************************************/

/**
 * Timers.js - 定时器边界基础设施（platformInfra）
 *
 * 业务层禁止直接调用 setTimeout/setInterval（审计规则 story-timer）：
 * 需要定时的系统应注入 scheduler（可测、可暂停），未注入时经此边界
 * 回落到真实定时器。集中一处，便于将来替换为可控时间轴调度。
 */

export function setTimeoutFn(callback, delay = 0, ...args) {
  return globalThis.setTimeout(callback, delay, ...args);
}

export function clearTimeoutFn(id) {
  return globalThis.clearTimeout(id);
}

export function setIntervalFn(callback, delay = 0, ...args) {
  return globalThis.setInterval(callback, delay, ...args);
}

export function clearIntervalFn(id) {
  return globalThis.clearInterval(id);
}

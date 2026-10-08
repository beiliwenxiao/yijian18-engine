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

const nonNegative = (value, name) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`);
  return value;
};

export class LogicalClock {
  constructor(value = 0) { this.value = nonNegative(value, 'logical clock'); }
  now() { return this.value; }
  tick() { return ++this.value; }
  snapshot() { return this.value; }
  validate(value) { return Number.isInteger(value) && value >= 0; }
  restore(value) {
    if (!this.validate(value)) throw new TypeError('invalid logical clock snapshot');
    this.value = value;
    return this;
  }
}

export class MonotonicClock {
  constructor(value = 0) { this.value = nonNegative(value, 'monotonic clock'); }
  now() { return this.value; }
  advance(elapsed) { this.value += nonNegative(elapsed, 'elapsed'); return this.value; }
}

export class WallClock {
  constructor(value = 0) { this.value = nonNegative(value, 'wall clock'); }
  now() { return this.value; }
  set(value) { this.value = nonNegative(value, 'wall clock'); return this.value; }
  advance(elapsed) { this.value += nonNegative(elapsed, 'elapsed'); return this.value; }
}

/** 三种时间语义显式注入；业务代码不读取平台全局时间。 */
export class AuthorityClocks {
  constructor(config = {}) {
    this.logical = config.logical || new LogicalClock(config.logicalTime || 0);
    this.monotonic = config.monotonic || new MonotonicClock(config.monotonicTime || 0);
    this.wall = config.wall || new WallClock(config.wallTime || 0);
  }
}

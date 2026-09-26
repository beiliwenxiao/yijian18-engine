/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { setTimeoutFn } from '../Timers.js';

const TOKEN_OWNER = Symbol('SceneResourceScope.owner');

/** 统一管理场景定时器、监听器、清理函数和异步任务有效期。 */
export class SceneResourceScope {
  constructor() {
    this.disposed = false;
    this._timers = new Set();
    this._disposers = new Set();
    this._tokenVersion = 0;
  }

  setTimeout(callback, delay = 0, ...args) {
    if (this.disposed || typeof callback !== 'function') return null;
    const timerId = setTimeoutFn(() => {
      this._timers.delete(timerId);
      if (!this.disposed) callback(...args);
    }, delay);
    this._timers.add(timerId);
    return timerId;
  }

  clearTimeout(timerId) {
    if (timerId === null || timerId === undefined) return false;
    const tracked = this._timers.delete(timerId);
    globalThis.clearTimeout(timerId);
    return tracked;
  }

  listen(target, type, listener, options) {
    if (this.disposed || !target || typeof listener !== 'function') return () => {};
    const guarded = this.guard(function (...args) {
      return listener.apply(target, args);
    });
    let remove;
    if (typeof target.addEventListener === 'function') {
      target.addEventListener(type, guarded, options);
      remove = () => target.removeEventListener(type, guarded, options);
    } else if (typeof target.on === 'function' && typeof target.off === 'function') {
      target.on(type, guarded);
      remove = () => target.off(type, guarded);
    } else {
      throw new TypeError('listen target must support addEventListener/removeEventListener or on/off');
    }
    return this.trackDisposer(remove);
  }

  /** 返回退出后自动失效的回调包装。 */
  guard(callback) {
    if (typeof callback !== 'function') return () => undefined;
    const scope = this;
    return function (...args) {
      if (scope.disposed) return undefined;
      return callback.apply(this, args);
    };
  }

  trackDisposer(disposer) {
    if (typeof disposer !== 'function') return () => {};
    let active = true;
    const tracked = () => {
      if (!active) return false;
      active = false;
      this._disposers.delete(tracked);
      disposer();
      return true;
    };
    if (this.disposed) tracked();
    else this._disposers.add(tracked);
    return tracked;
  }

  add(disposer) {
    return this.trackDisposer(disposer);
  }

  track(disposer) {
    return this.trackDisposer(disposer);
  }

  createToken() {
    return Object.freeze({ [TOKEN_OWNER]: this, version: ++this._tokenVersion });
  }

  isCurrent(token) {
    return !this.disposed && token?.[TOKEN_OWNER] === this && token.version === this._tokenVersion;
  }

  /** 只读残留快照，供 P6.2 真实场景释放测量记录使用。 */
  getLifecycleSnapshot() {
    return Object.freeze({
      disposed: this.disposed,
      pendingTimerCount: this._timers.size,
      disposerCount: this._disposers.size,
      tokenVersion: this._tokenVersion
    });
  }

  dispose() {
    if (this.disposed) return false;
    // 必须先令异步 guard/token 失效，再清理资源。
    this.disposed = true;
    this._tokenVersion++;
    for (const timerId of this._timers) globalThis.clearTimeout(timerId);
    this._timers.clear();
    const disposers = Array.from(this._disposers).reverse();
    this._disposers.clear();
    for (const disposer of disposers) {
      try {
        disposer();
      } catch (error) {
        console.warn('SceneResourceScope: disposer failed', error);
      }
    }
    return true;
  }
}

export default SceneResourceScope;
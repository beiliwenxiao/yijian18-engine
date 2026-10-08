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

/**
 * Explicitly hosts a group of scene-flow functions without mutating a Scene prototype.
 * Flow functions read/write scene state through a scoped proxy; nested flow calls stay
 * inside the same coordinator while framework/scene methods retain their real receiver.
 */
export class SceneFlowCoordinator {
  constructor(scene, methods = {}, { name = 'SceneFlowCoordinator' } = {}) {
    if (!scene || typeof scene !== 'object') throw new TypeError(`${name} requires a scene`);
    if (!methods || typeof methods !== 'object' || Array.isArray(methods)) {
      throw new TypeError(`${name} methods must be an object`);
    }

    this.scene = scene;
    this.name = name;
    this.methods = methods;
    let context = null;
    context = new Proxy(Object.create(null), {
      get: (_target, property) => {
        if (property === '$scene') return scene;
        const flowMethod = methods[property];
        if (typeof flowMethod === 'function') {
          return (...args) => Reflect.apply(flowMethod, context, args);
        }
        const value = Reflect.get(scene, property, scene);
        return typeof value === 'function' ? value.bind(scene) : value;
      },
      set: (_target, property, value) => Reflect.set(scene, property, value, scene),
      has: (_target, property) => property in methods || property in scene,
      deleteProperty: (_target, property) => Reflect.deleteProperty(scene, property)
    });
    this.context = context;

    for (const [methodName, method] of Object.entries(methods)) {
      if (typeof method !== 'function') continue;
      if (methodName in this) throw new Error(`${name} method conflict: ${methodName}`);
      Object.defineProperty(this, methodName, {
        configurable: false,
        enumerable: false,
        value: (...args) => Reflect.apply(method, context, args)
      });
    }
  }

  invoke(methodName, ...args) {
    const method = this.methods[methodName];
    if (typeof method !== 'function') throw new Error(`${this.name} unknown method: ${String(methodName)}`);
    return Reflect.apply(method, this.context, args);
  }
}

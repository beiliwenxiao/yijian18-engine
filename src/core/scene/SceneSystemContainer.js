/************************************************************

 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)

 * 

 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎

 * @author    刘枭 (beiliwenxiao)

 * @email     beiliwenxiao@qq.com

 * @date      2026-01-14

 * @blog      https://blog.csdn.net/beiliwenxiao

 * @repo      https://github.com/beiliwenxiao/yijian18-engine

 *            https://gitee.com/coderaaa/yijian18-engine

 ************************************************************/

export const DependencyOwnership = Object.freeze({
  OWNED: 'OWNED',
  BORROWED: 'BORROWED'
});

const DEFAULT_ORDER = 100;
const DEFAULT_PHASE = 'systems';

function inferHook(instance, candidates) {
  for (const name of candidates) {
    if (typeof instance?.[name] === 'function') return name;
  }
  return false;
}

/**
 * 以对象身份为边界的场景生命周期容器。
 * 名称只用于解析；ownership 决定释放责任，borrowed alias 永不被当前容器释放。
 */
export class SceneSystemContainer {
  constructor(config = {}) {
    this.systems = new Map();
    this.dependencies = Object.create(null);
    this.onError = config.onError || ((phase, name, error) => {
      console.warn(`SceneSystemContainer: ${phase} 阶段出错 [${name}]`, error);
    });
    this._ownedIdentities = new Map();
    this._sequence = 0;
    this._sortedCache = null;
    this.disposed = false;
  }

  _reject(name, message) {
    const error = new Error(message);
    this.onError('register', String(name), error);
    return null;
  }

  _createRegistration(name, instance, options = {}) {
    const ownership = options.ownership || DependencyOwnership.OWNED;
    if (!Object.values(DependencyOwnership).includes(ownership)) {
      return this._reject(name, `invalid ownership: ${ownership}`);
    }
    const identity = options.identity ?? instance;
    if (this.systems.has(name) || Object.prototype.hasOwnProperty.call(this.dependencies, name)) {
      return this._reject(name, `duplicate registration name "${name}"; use replace() explicitly`);
    }
    if (ownership === DependencyOwnership.OWNED && this._ownedIdentities.has(identity)) {
      return this._reject(name, `identity already owned by "${this._ownedIdentities.get(identity)}"`);
    }

    const borrowed = ownership === DependencyOwnership.BORROWED;
    const registration = {
      name,
      instance,
      identity,
      ownership,
      order: Number.isFinite(options.order) ? options.order : DEFAULT_ORDER,
      sequence: this._sequence++,
      phase: options.phase || DEFAULT_PHASE,
      updateHook: options.updateHook !== undefined
        ? options.updateHook
        : (options.update !== undefined ? options.update : (borrowed ? false : 'update')),
      renderHook: options.renderHook !== undefined
        ? options.renderHook
        : (options.render !== undefined ? options.render : false),
      disposeHook: borrowed
        ? false
        : (options.disposeHook !== undefined
          ? options.disposeHook
          : (options.destroy !== undefined ? options.destroy : inferHook(instance, ['dispose', 'destroy', 'cleanup']))),
      frameToken: null,
      disposed: false,
      dependency: options.dependency === true
    };
    return registration;
  }

  register(name, systemOrFactory, options = {}) {
    if (this.disposed) return this._reject(name, 'container is disposed');
    if (!name) return this._reject(name, 'registration requires a name');
    const instance = typeof systemOrFactory === 'function' && !systemOrFactory.prototype?.update
      ? systemOrFactory(this.dependencies)
      : systemOrFactory;
    if (!instance) return this._reject(name, 'registration instance is empty');

    const registration = this._createRegistration(name, instance, options);
    if (!registration) return null;
    this.systems.set(name, registration);
    if (registration.ownership === DependencyOwnership.OWNED) {
      this._ownedIdentities.set(registration.identity, name);
    }
    if (registration.dependency) this.dependencies[name] = instance;
    this._sortedCache = null;
    return instance;
  }

  provide(deps = {}, options = {}) {
    const registered = [];
    for (const [name, instance] of Object.entries(deps)) {
      const value = this.register(name, instance, {
        ...options,
        ownership: options.ownership || DependencyOwnership.BORROWED,
        updateHook: false,
        renderHook: false,
        dependency: true
      });
      if (value) registered.push(name);
    }
    return registered;
  }

  replace(name, instance, options = {}) {
    if (!this.systems.has(name)) return this.register(name, instance, options);
    this.unregister(name);
    return this.register(name, instance, options);
  }

  registerAll(list = []) {
    return list.map(item => this.register(item.name, item.instance ?? item.system, item.options || item));
  }

  resolve(name) {
    return this.systems.get(name)?.instance;
  }

  getRegistration(name) {
    return this.systems.get(name) || null;
  }

  has(name) {
    return this.systems.has(name);
  }

  getNames() {
    return Array.from(this.systems.keys());
  }

  /** 只读生命周期登记快照，供真实释放验收记录 owner 残留。 */
  getLifecycleSnapshot() {
    const registrations = this._sorted().map(registration => Object.freeze({
      name: registration.name,
      ownership: registration.ownership,
      disposed: registration.disposed,
      phase: registration.phase
    }));
    return Object.freeze({
      disposed: this.disposed,
      registeredCount: registrations.length,
      ownedCount: registrations.filter(entry => entry.ownership === DependencyOwnership.OWNED).length,
      registrations: Object.freeze(registrations)
    });
  }

  _sorted() {
    if (!this._sortedCache) {
      this._sortedCache = Array.from(this.systems.values())
        .sort((a, b) => a.order - b.order || a.sequence - b.sequence);
    }
    return this._sortedCache;
  }

  _invoke(phase, registration, hook, args) {
    if (hook === false || hook === null || registration.disposed) return false;
    try {
      if (typeof hook === 'function') hook.apply(registration.instance, args);
      else if (typeof hook === 'string' && typeof registration.instance?.[hook] === 'function') {
        registration.instance[hook](...args);
      } else return false;
      return true;
    } catch (error) {
      this.onError(phase, registration.name, error);
      return false;
    }
  }

  update(deltaTime, ...extraArgs) {
    return this.updateFrame(Symbol('implicit-frame'), deltaTime, { extraArgs });
  }

  updateFrame(frameToken, deltaTime, { phase = DEFAULT_PHASE, extraArgs = [] } = {}) {
    if (this.disposed || frameToken === null || frameToken === undefined) return [];
    const updated = [];
    const identities = new Set();
    for (const registration of this._sorted()) {
      if (registration.phase !== phase || registration.frameToken === frameToken) continue;
      registration.frameToken = frameToken;
      if (registration.updateHook === false || registration.updateHook === null) continue;
      if (identities.has(registration.identity)) continue;
      identities.add(registration.identity);
      if (this._invoke('update', registration, registration.updateHook, [deltaTime, ...extraArgs])) {
        updated.push(registration.name);
      }
    }
    return updated;
  }

  render(ctx, ...extraArgs) {
    for (const registration of this._sorted()) {
      this._invoke('render', registration, registration.renderHook, [ctx, ...extraArgs]);
    }
  }

  unregister(name) {
    const registration = this.systems.get(name);
    if (!registration) return false;
    if (registration.ownership === DependencyOwnership.OWNED && !registration.disposed) {
      this._invoke('dispose', registration, registration.disposeHook, []);
      registration.disposed = true;
      this._ownedIdentities.delete(registration.identity);
    }
    delete this.dependencies[name];
    this.systems.delete(name);
    this._sortedCache = null;
    return true;
  }

  destroy() {
    if (this.disposed) return [];
    this.disposed = true;
    const cleaned = [];
    for (const registration of this._sorted().slice().reverse()) {
      if (registration.ownership !== DependencyOwnership.OWNED || registration.disposed) continue;
      if (this._invoke('dispose', registration, registration.disposeHook, [])) cleaned.push(registration.name);
      registration.disposed = true;
    }
    this.systems.clear();
    this._ownedIdentities.clear();
    this.dependencies = Object.create(null);
    this._sortedCache = null;
    return cleaned;
  }
}

export default SceneSystemContainer;

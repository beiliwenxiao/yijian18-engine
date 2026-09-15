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

import { SceneSystemContainer, DependencyOwnership } from './SceneSystemContainer.js';
import { SceneResourceScope } from './SceneResourceScope.js';
import { InputActionRouter } from '../input/InputActionRouter.js';
import { SnapshotManager } from '../snapshot/SnapshotManager.js';
import { CommandGateway } from '../command/CommandGateway.js';
import { LocalAuthorityAdapter } from '../command/LocalAuthorityAdapter.js';
import { OperationLedger } from '../command/OperationLedger.js';
import { AuthorityClocks } from '../command/AuthorityClocks.js';
import { AuthorityRng } from '../command/AuthorityRng.js';
import { StateRevisionStore } from '../command/StateRevisionStore.js';
import { ProjectionStore } from '../command/ProjectionStore.js';
import { PostCommitNotificationBus } from '../command/PostCommitNotificationBus.js';
import { AuthoritySnapshotService } from '../command/AuthoritySnapshotService.js';
import { EventJournal } from '../events/EventJournal.js';
import { TaskGraphSystem } from '../../systems/TaskGraphSystem.js';

export const UpdateOrder = Object.freeze({
  INPUT: 0,
  MOVEMENT: 100,
  COMBAT: 200,
  AI: 300,
  COLLISION: 400,
  GAMEPLAY: 500,
  EFFECTS: 700,
  UI: 900
});

export const FramePhase = Object.freeze({
  BEFORE_INPUT: 'beforeInput',
  PRIORITY_INPUT: 'priorityInput',
  SYSTEMS: 'systems',
  AFTER_SCENE: 'afterScene',
  POST_SCENE: 'postScene'
});

/** 场景有状态能力的唯一生命周期 owner。 */
export class GameSceneRuntime {
  constructor(config = {}) {
    this.container = new SceneSystemContainer({ onError: config.onError });
    this.isActive = false;
    this.disposed = false;
    this._disposeResult = null;
    this._registrationSequence = 0;
    this._frameSequence = 0;
    this._currentFrameToken = null;
    this._flushedFrameToken = null;
    this._phaseFrameTokens = new Map();
    this._updateHooks = [];
    this._phaseHooks = new Map(Object.values(FramePhase).map(phase => [phase, []]));

    this._ownsResourceScope = !config.resourceScope;
    this.resourceScope = config.resourceScope || new SceneResourceScope();
    this.container.register('$resourceScope', this.resourceScope, {
      ownership: this._ownsResourceScope ? DependencyOwnership.OWNED : DependencyOwnership.BORROWED,
      order: 1_000_000,
      updateHook: false,
      disposeHook: 'dispose'
    });

    this.inputManager = config.inputManager || null;
    this.camera = config.camera || null;
    if (this.inputManager) {
      this.container.register('$inputManager', this.inputManager, {
        ownership: config.ownInputManager === true
          ? DependencyOwnership.OWNED
          : DependencyOwnership.BORROWED,
        order: 900_000,
        updateHook: false,
        disposeHook: 'destroy'
      });
    }

    if (this.camera) {
      this.container.register('$camera', this.camera, {
        ownership: DependencyOwnership.BORROWED,
        order: 900_000,
        updateHook: false,
        disposeHook: false
      });
    }

    this.inputRouter = new InputActionRouter({
      inputManager: this.inputManager,
      camera: this.camera
    });
    this.container.register('$inputRouter', this.inputRouter, {
      ownership: DependencyOwnership.OWNED,
      order: 850_000,
      updateHook: false,
      disposeHook: () => this.inputRouter.clearAll()
    });

    const ownsSnapshotManager = !config.snapshotManager;
    this.snapshotManager = config.snapshotManager || new SnapshotManager();
    this.container.register('$snapshotManager', this.snapshotManager, {
      ownership: ownsSnapshotManager ? DependencyOwnership.OWNED : DependencyOwnership.BORROWED,
      order: 800_000,
      updateHook: false,
      disposeHook: false
    });

    const registerAuthorityDependency = (name, instance, supplied, order, disposeHook = false) => {
      this.container.register(name, instance, {
        ownership: supplied ? DependencyOwnership.BORROWED : DependencyOwnership.OWNED,
        order,
        updateHook: false,
        disposeHook
      });
      return instance;
    };
    this.authorityClocks = registerAuthorityDependency(
      '$authorityClocks',
      config.authorityClocks || new AuthorityClocks(config.authorityClockConfig),
      Boolean(config.authorityClocks),
      775_000
    );
    this.operationLedger = registerAuthorityDependency(
      '$operationLedger',
      config.operationLedger || new OperationLedger({
        ...config.operationLedgerConfig,
        now: config.operationLedgerConfig?.now || (() => this.authorityClocks.monotonic.now())
      }),
      Boolean(config.operationLedger),
      774_000
    );
    this.authorityRng = registerAuthorityDependency(
      '$authorityRng',
      config.authorityRng || new AuthorityRng({ seed: config.authoritySeed ?? 0 }),
      Boolean(config.authorityRng),
      773_000
    );
    this.stateRevisions = registerAuthorityDependency(
      '$stateRevisions',
      config.stateRevisions || new StateRevisionStore(),
      Boolean(config.stateRevisions),
      772_000
    );
    this.projectionStore = registerAuthorityDependency(
      '$projectionStore',
      config.projectionStore || new ProjectionStore({
        definitionRevision: config.definitionRepository?.definitionRevision ?? 0,
        requestRecovery: config.requestProjectionRecovery
      }),
      Boolean(config.projectionStore),
      771_000,
      'clear'
    );
    this.eventJournal = registerAuthorityDependency(
      '$eventJournal',
      config.eventJournal || new EventJournal({ runId: config.getCommandSessionId?.() || null }),
      Boolean(config.eventJournal),
      770_500
    );
    this.taskGraphSystem = registerAuthorityDependency(
      '$taskGraphSystem',
      config.taskGraphSystem || new TaskGraphSystem({
        definitions: config.taskDefinitions || [],
        eventJournal: this.eventJournal,
        now: () => this.authorityClocks.logical.now()
      }),
      Boolean(config.taskGraphSystem),
      770_400
    );
    this.notificationBus = config.notificationBus || new PostCommitNotificationBus({
      logicalClock: this.authorityClocks.logical,
      projectionStore: this.projectionStore,
      eventJournal: this.eventJournal
    });
    if (this.notificationBus.logicalClock !== this.authorityClocks.logical) {
      throw new Error('GameSceneRuntime: notificationBus must use injected logical clock');
    }
    registerAuthorityDependency(
      '$notificationBus',
      this.notificationBus,
      Boolean(config.notificationBus),
      770_000,
      'dispose'
    );
    this.authoritySnapshotService = config.authoritySnapshotService || new AuthoritySnapshotService({
      getDefinitionRevision: () => config.definitionRepository?.definitionRevision ?? 0,
      stateRevisions: this.stateRevisions,
      logicalClock: this.authorityClocks.logical,
      rng: this.authorityRng,
      operationLedger: this.operationLedger,
      notificationBus: this.notificationBus,
      eventJournal: this.eventJournal
    });
    this.authoritySnapshotService.registerService('eventJournal', this.eventJournal.asSnapshotProvider());
    registerAuthorityDependency(
      '$authoritySnapshotService',
      this.authoritySnapshotService,
      Boolean(config.authoritySnapshotService),
      769_000
    );
    this.registerSnapshotProvider('authority', this.authoritySnapshotService.asSnapshotProvider());

    const suppliedGateway = config.commandGateway || null;
    const suppliedAuthority = config.authorityPort || suppliedGateway?.authorityPort || null;
    if (suppliedGateway && config.authorityPort && suppliedGateway.authorityPort !== config.authorityPort) {
      throw new Error('GameSceneRuntime: commandGateway and authorityPort must reference the same authority');
    }
    const ownsAuthorityPort = !suppliedAuthority;
    this.authorityPort = suppliedAuthority || new LocalAuthorityAdapter({
      handlers: config.commandHandlers || {},
      notificationSink: config.commandNotificationSink || null,
      authorityClocks: this.authorityClocks,
      operationLedger: this.operationLedger,
      authorityRng: this.authorityRng,
      stateRevisions: this.stateRevisions,
      projectionStore: this.projectionStore,
      notificationBus: this.notificationBus,
      authoritySnapshotService: this.authoritySnapshotService
    });
    this.container.register('$authorityPort', this.authorityPort, {
      ownership: ownsAuthorityPort || config.ownAuthorityPort === true
        ? DependencyOwnership.OWNED
        : DependencyOwnership.BORROWED,
      order: 780_000,
      updateHook: false,
      disposeHook: 'dispose'
    });

    const ownsCommandGateway = !suppliedGateway;
    this.commandGateway = suppliedGateway || new CommandGateway({
      authorityPort: this.authorityPort,
      definitionRepository: config.definitionRepository || null,
      getActorId: config.getCommandActorId,
      getSessionId: config.getCommandSessionId,
      operationIdFactory: config.operationIdFactory,
      validateReferences: config.validateCommandReferences
    });
    this.container.register('$commandGateway', this.commandGateway, {
      ownership: ownsCommandGateway || config.ownCommandGateway === true
        ? DependencyOwnership.OWNED
        : DependencyOwnership.BORROWED,
      order: 790_000,
      updateHook: false,
      disposeHook: 'dispose'
    });
  }

  setInput(deps = {}) {
    if (deps.inputManager && deps.inputManager !== this.inputManager) {
      this.inputManager = deps.inputManager;
      this.inputRouter.inputManager = deps.inputManager;
      const options = {
        ownership: deps.ownInputManager === true
          ? DependencyOwnership.OWNED
          : DependencyOwnership.BORROWED,
        order: 900_000,
        updateHook: false,
        disposeHook: 'destroy'
      };
      if (this.container.has('$inputManager')) {
        this.container.replace('$inputManager', deps.inputManager, options);
      } else {
        this.container.register('$inputManager', deps.inputManager, options);
      }
    }
    if (deps.camera && deps.camera !== this.camera) {
      this.camera = deps.camera;
      this.inputRouter.setCamera(deps.camera);
      const options = {
        ownership: DependencyOwnership.BORROWED,
        order: 900_000,
        updateHook: false,
        disposeHook: false
      };
      if (this.container.has('$camera')) this.container.replace('$camera', deps.camera, options);
      else this.container.register('$camera', deps.camera, options);
    }
  }

  provide(deps = {}, options = {}) {
    return this.container.provide(deps, {
      ...options,
      ownership: options.ownership || DependencyOwnership.BORROWED
    });
  }

  registerSystem(name, system, options = {}) {
    return this.container.register(name, system, options);
  }

  registerCommandHandler(commandType, handler) {
    if (typeof this.authorityPort?.registerHandler !== 'function') {
      throw new Error('GameSceneRuntime authority does not support command handler registration');
    }
    const off = this.authorityPort.registerHandler(commandType, handler);
    this.addDisposer(off, `command:${commandType}`);
    return off;
  }

  /** 应用 Assembler 产生的纯登记计划；兼容字段只作为 borrowed projection。 */
  applyRegistrationPlan(plan) {
    if (!plan || !Array.isArray(plan.registrations)) {
      throw new TypeError('GameSceneRuntime.applyRegistrationPlan requires SystemRegistrationPlan');
    }
    const registered = [];
    for (const item of plan.registrations) {
      const instance = this.registerSystem(item.name, item.instance, item.options || item);
      if (!instance) {
        for (const name of registered.slice().reverse()) this.container.unregister(name);
        throw new Error(`SystemRegistrationPlan rejected at "${item.name}"`);
      }
      registered.push(item.name);
    }

    const projections = [];
    for (const projection of plan.projections || []) {
      if (!projection?.target || !projection.key) continue;
      projection.target[projection.key] = projection.instance;
      projections.push(projection);
    }
    for (const disposer of plan.disposers || []) {
      const callback = typeof disposer === 'function' ? disposer : disposer?.dispose;
      if (typeof callback === 'function') {
        this.addDisposer(callback, `plan:${plan.id || 'anonymous'}:${disposer.label || 'cleanup'}`);
      }
    }
    if (projections.length > 0) {
      this.addDisposer(() => {
        for (const projection of projections.slice().reverse()) {
          if (projection.target[projection.key] === projection.instance) {
            projection.target[projection.key] = projection.clearValue ?? null;
          }
        }
      }, `plan:${plan.id || 'anonymous'}:projections`);
    }
    return plan;
  }

  get(name) {
    return this.container.resolve(name);
  }

  registerInputHandler(handlerName, config) {
    const off = this.inputRouter.register(handlerName, config);
    this.addDisposer(off, `input:${handlerName}`);
    return off;
  }

  registerSnapshotProvider(key, provider) {
    const off = this.snapshotManager.register(key, provider);
    this.addDisposer(off, `snapshot:${key}`);
    return off;
  }

  attachWorldStreaming(manager, {
    key = 'worldStreaming',
    getPosition = null,
    onTransition = null,
    onError = null
  } = {}) {
    if (!manager || typeof manager.serialize !== 'function' || typeof manager.deserialize !== 'function') {
      throw new TypeError('GameSceneRuntime.attachWorldStreaming requires WorldStreamingManager');
    }
    const offSnapshot = this.registerSnapshotProvider(key, {
      snapshot: () => manager.serialize(),
      validate: data => manager.validateSerialized(data),
      restore: data => manager.deserialize(data),
      required: true
    });
    const offUpdate = typeof getPosition === 'function'
      ? this.onFramePhase(FramePhase.AFTER_SCENE, () => {
        const position = getPosition();
        if (!position) return;
        const token = this.resourceScope.createToken();
        Promise.resolve(manager.update(position.x, position.y))
          .then(this.resourceScope.guard(result => {
            if (!this.resourceScope.isCurrent(token)) return;
            if (result?.ok) onTransition?.(result);
            else if (!result?.superseded) onError?.(result);
          }))
          .catch(this.resourceScope.guard(error => onError?.({
            ok: false,
            errors: [{ code: 'streamingUpdateFailed', path: '', message: error?.message || String(error) }]
          })));
      })
      : () => {};
    return () => {
      offUpdate();
      offSnapshot();
    };
  }

  onUpdate(hook) {
    if (typeof hook !== 'function') return () => {};
    this._updateHooks.push(hook);
    const off = () => {
      const index = this._updateHooks.indexOf(hook);
      if (index !== -1) this._updateHooks.splice(index, 1);
    };
    this.addDisposer(off, 'update-hook');
    return off;
  }

  addDisposer(disposer, label = 'custom') {
    if (typeof disposer !== 'function' || this.disposed) return () => false;
    const holder = { dispose: disposer };
    const name = `$disposer:${label}:${this._registrationSequence++}`;
    this.container.register(name, holder, {
      ownership: DependencyOwnership.OWNED,
      order: 750_000,
      updateHook: false,
      disposeHook: 'dispose'
    });
    return () => this.container.unregister(name);
  }

  enter() {
    if (!this.disposed) this.isActive = true;
    return this;
  }

  onFramePhase(phase, hook) {
    const hooks = this._phaseHooks.get(phase);
    if (!hooks || typeof hook !== 'function') return () => {};
    hooks.push(hook);
    const off = () => {
      const index = hooks.indexOf(hook);
      if (index !== -1) hooks.splice(index, 1);
    };
    this.addDisposer(off, `phase:${phase}`);
    return off;
  }

  beginFrame() {
    if (!this.isActive || this.disposed) return null;
    this._currentFrameToken = Object.freeze({ runtime: this, sequence: ++this._frameSequence });
    return this._currentFrameToken;
  }

  get currentFrameToken() {
    return this._currentFrameToken;
  }

  runFramePhase(phase, deltaTime, options = {}) {
    if (!this.isActive || this.disposed || !this._phaseHooks.has(phase)) return false;
    const frameToken = options.frameToken || this._currentFrameToken || this.beginFrame();
    if (!frameToken || this._phaseFrameTokens.get(phase) === frameToken) return false;
    this._phaseFrameTokens.set(phase, frameToken);

    if (phase === FramePhase.PRIORITY_INPUT && options.routeInput) {
      this.inputRouter.update(options.watchedKeys);
    }
    if (options.updateSystems || phase === FramePhase.SYSTEMS) {
      this.container.updateFrame(frameToken, deltaTime, {
        phase,
        extraArgs: options.systemArgs || []
      });
    }
    const context = Object.freeze({
      runtime: this,
      phase,
      frameToken,
      scene: options.scene || null
    });
    for (const hook of [...(this._phaseHooks.get(phase) || [])]) {
      try {
        hook(deltaTime, context);
      } catch (error) {
        console.warn(`GameSceneRuntime: ${phase} 阶段钩子出错`, error);
      }
    }
    return true;
  }

  flushInput(options = {}) {
    const frameToken = options.frameToken || this._currentFrameToken;
    if (options.skipInputFlush || (frameToken && this._flushedFrameToken === frameToken)) return false;
    if (this.inputManager?.update) this.inputManager.update();
    this._flushedFrameToken = frameToken;
    return true;
  }

  update(deltaTime, options = {}) {
    if (!this.isActive || this.disposed) return false;
    const frameToken = this.beginFrame();
    const frameOptions = { ...options, frameToken };
    this.runFramePhase(FramePhase.BEFORE_INPUT, deltaTime, frameOptions);
    this.runFramePhase(FramePhase.PRIORITY_INPUT, deltaTime, { ...frameOptions, routeInput: true });
    this.runFramePhase(FramePhase.SYSTEMS, deltaTime, { ...frameOptions, updateSystems: true });
    for (const hook of [...this._updateHooks]) {
      try {
        hook(deltaTime);
      } catch (error) {
        console.warn('GameSceneRuntime: update 钩子出错', error);
      }
    }
    this.runFramePhase(FramePhase.AFTER_SCENE, deltaTime, frameOptions);
    this.flushInput(frameOptions);
    return true;
  }

  render(ctx, ...args) {
    if (this.isActive && !this.disposed) this.container.render(ctx, ...args);
  }

  captureCheckpoint(meta = {}) {
    return this.snapshotManager.capture(meta);
  }

  restoreCheckpoint(snapshot) {
    return this.snapshotManager.restore(snapshot);
  }

  /** 先关闭异步写回门闩；正式资源仍由 dispose 的逆序生命周期释放。 */
  invalidate() {
    this.isActive = false;
    return this._ownsResourceScope ? this.container.unregister('$resourceScope') : false;
  }

  dispose() {
    if (this.disposed) return this._disposeResult;
    this.isActive = false;
    this.disposed = true;
    const systems = this.container.destroy();
    this._updateHooks.length = 0;
    for (const hooks of this._phaseHooks.values()) hooks.length = 0;
    this._currentFrameToken = null;
    this._disposeResult = Object.freeze({ systems, disposed: true });
    return this._disposeResult;
  }
}

export default GameSceneRuntime;

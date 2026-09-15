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

/**
 * SceneGameLoaderBridge - 将 GameLoader 的通用依赖与场景生命周期连接起来。
 *
 * 场景剧情专属动作仍通过 onReady 注入；本桥接只处理可复用的默认依赖、
 * 对话结束事件、物品奖励回调、场景标记、上下文同步和 sceneEnter。
 */
import { GameLoader } from '../GameLoader.js';

export class SceneGameLoaderBridge {
  /**
   * 推荐传入显式配置；第二参数存在时兼容旧 constructor(scene, options)。
   * @param {Object} [config]
   * @param {Object} [legacyOptions]
   */
  constructor(config = {}, legacyOptions) {
    const normalized = arguments.length > 1
      ? SceneGameLoaderBridge._fromLegacyScene(config, legacyOptions)
      : config;
    const {
      GameLoaderClass = GameLoader,
      loaderConfig = {},
      scope = null,
      dialogueSystem = null,
      deps = {},
      onShowTip = null,
      onItemGained = null,
      getPlayer = null
    } = normalized || {};

    this.GameLoaderClass = GameLoaderClass;
    this.loaderConfig = loaderConfig && typeof loaderConfig === 'object' ? loaderConfig : {};
    this.scope = scope;
    this.dialogueSystem = dialogueSystem;
    this.deps = deps;
    this.onShowTip = onShowTip;
    this.onItemGained = onItemGained;
    this.getPlayer = typeof getPlayer === 'function' ? getPlayer : (() => null);
    this.loader = null;
    this._dialogueEndOff = null;
    this._dialogueChoiceDispatchOff = null;
    this._initializeToken = 0;
    this._disposed = false;
  }

  /** 支持 initialize(url, options) 与 initialize({ projectUrl, ...options })。 */
  async initialize(projectOrOptions = {}, legacyOptions = {}) {
    const options = typeof projectOrOptions === 'string'
      ? { ...legacyOptions, projectUrl: projectOrOptions }
      : (projectOrOptions || {});
    const {
      projectUrl = 'game.project.json',
      deps = {},
      sceneFlag,
      sceneId,
      registerActions,
      onReady
    } = options;

    this.dispose();
    this._disposed = false;
    const token = this._initializeToken;
    const loader = new this.GameLoaderClass(this.loaderConfig);
    this.loader = loader;
    if (this.scope) this.scope.gameLoader = loader;

    const loadDeps = this._createDeps(deps);
    await loader.load(projectUrl, loadDeps);
    if (!this._isActive(token, loader)) return loader;

    const triggerSystem = loader.triggerSystem;
    this._bindDialogueEnd(loadDeps.dialogueSystem, triggerSystem, token, loader);
    this._bindDialogueChoice(loadDeps.dialogueSystem, triggerSystem, token, loader);
    if (!this._isActive(token, loader)) return loader;

    if (sceneFlag) loader.blackboard.set(sceneFlag, true);
    if (typeof registerActions === 'function') registerActions(triggerSystem, loader);
    if (!this._isActive(token, loader)) return loader;

    // 保持旧 onReady 顺序：自定义动作先注册，再由通用动作定义最终默认实现。
    // 允许宿主异步准备 Manifest 等 sceneEnter 前置资源。
    if (typeof onReady === 'function') await onReady(loader, triggerSystem);
    if (!this._isActive(token, loader)) return loader;

    this._registerScopeActions(triggerSystem);
    if (!this._isActive(token, loader)) return loader;

    const player = this.getPlayer();
    if (player) loader.updateContext({ player });
    if (sceneId && this._isActive(token, loader)) {
      // 全 Trigger 化后不再有 FlowGroup 状态机；sceneEnter 直接触发（顺序由 when/if 驱动）。
      const sceneEnterResult = await triggerSystem.fireAndWait('sceneEnter', { sceneId });
      if (!sceneEnterResult.ok) {
        const error = new Error(`SceneGameLoaderBridge sceneEnter failed: ${sceneId}`);
        error.code = 'sceneEnterTriggerFailed';
        error.records = sceneEnterResult.records;
        throw error;
      }
    }
    return loader;
  }

  /** 幂等释放桥接监听以及桥接创建并拥有的 GameLoader。 */
  dispose() {
    this._disposed = true;
    this._initializeToken += 1;
    const dialogueEndOff = this._dialogueEndOff;
    const dialogueChoiceDispatchOff = this._dialogueChoiceDispatchOff;
    this._dialogueEndOff = null;
    this._dialogueChoiceDispatchOff = null;

    const loader = this.loader;
    this.loader = null;
    if (this.scope?.gameLoader === loader) this.scope.gameLoader = null;
    try {
      if (typeof dialogueEndOff === 'function') dialogueEndOff();
      if (typeof dialogueChoiceDispatchOff === 'function') dialogueChoiceDispatchOff();
    } finally {
      if (loader && typeof loader.dispose === 'function') loader.dispose();
    }
  }

  _createDeps(overrides) {
    const scope = this.scope;
    const engine = typeof window !== 'undefined' ? window.gameEngine : null;
    const defaults = {
      dialogueSystem: this.dialogueSystem || scope?.dialogueSystem || null,
      tutorialSystem: scope?.tutorialSystem || null,
      questSystem: scope?.questSystem,
      questTransactionService: scope?.questSystem,
      combatSystem: scope?.combatSystem,
      sceneManager: engine?.sceneManager || scope?.sceneManager || null,
      audioManager: scope?.audioManager || engine?.audioManager || null,
      floatingText: scope?.floatingTextManager,
      player: this.getPlayer(),
      scene: scope,
      sceneDiagnostics: scope?.services?.diagnostics || null,
      eventJournal: scope?.sceneRuntime?.eventJournal || scope?.services?.eventJournal || null,
      commandGateway: scope?.sceneRuntime?.commandGateway || null
    };
    if (typeof this.onShowTip === 'function') {
      defaults.tutorial = { showTip: params => this.onShowTip(params?.text || '') };
    }
    if (typeof this.onItemGained === 'function') {
      defaults.onItemGained = (item, player) => this.onItemGained(item, player || this.getPlayer());
    }
    return { ...defaults, ...this.deps, ...(overrides || {}) };
  }

  _registerScopeActions(triggerSystem) {
    const scope = this.scope;
    if (typeof scope?._toggleDebugPanel === 'function') {
      triggerSystem.registerAction('toggleDebug', () => scope._toggleDebugPanel() !== false);
    }
  }

  _bindDialogueEnd(dialogueSystem, triggerSystem, token, loader) {
    if (!dialogueSystem?.onEnd) return;
    const off = dialogueSystem.onEnd(data => {
      if (this._isActive(token, loader)) {
        triggerSystem.fire('dialogueEnd', { id: data?.id });
      }
    });
    this._dialogueEndOff = typeof off === 'function' ? off : null;
  }

  _bindDialogueChoice(dialogueSystem, triggerSystem, token, loader) {
    if (!dialogueSystem?.setChoiceDispatcher) return;
    const dispatch = async (payload) => {
      if (!this._isActive(token, loader)) return { ok: false, code: 'dialogueRuntimeDisposed' };
      return triggerSystem.fireAndWait('dialogueChoice', payload);
    };
    this._dialogueChoiceDispatchOff = dialogueSystem.setChoiceDispatcher(dispatch);
  }

  _isActive(token, loader) {
    return !this._disposed && this._initializeToken === token && this.loader === loader;
  }

  static _fromLegacyScene(scene = {}, options = {}) {
    return {
      ...options,
      scope: scene,
      dialogueSystem: scene.dialogueSystem,
      onShowTip: text => scene._showScreenTip?.(text),
      onItemGained: (item, player) => scene.onItemGained?.(item, player),
      getPlayer: () => scene.playerEntity || null
    };
  }
}

export default SceneGameLoaderBridge;
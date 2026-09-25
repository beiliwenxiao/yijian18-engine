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

import { Blackboard } from './Blackboard.js';
import { mergeShardedProject } from './projectShards.js';
import { ProgressionGraphSystem } from '../systems/progression/ProgressionGraphSystem.js';
import { ProgressionProfile } from '../systems/progression/ProgressionProfile.js';
import { SkillRegistry } from '../systems/ability/SkillRegistry.js';
import { createContentValidator } from './validation/ContentSchemas.js';
import { CanonicalCandidatePipeline } from './validation/CanonicalCandidatePipeline.js';
import { CandidateRuleValidator } from './validation/CandidateRuleValidator.js';
import { formatErrors } from './validation/ValidationError.js';
import { TriggerSystem } from '../systems/TriggerSystem.js';
import { SceneEventDefinitionRepository } from './scene/SceneEventDefinitionRepository.js';
import { FlowGroupDefinitionRepository } from './scene/FlowGroupDefinitionRepository.js';
import { normalizeProjectForRuntime } from '../migration/SceneEventToFlowGroupMigrator.js';
import { registerDefaultActions } from '../systems/TriggerActions.js';
import { createStandardActionDescriptorRegistry } from '../systems/ActionDescriptorRegistry.js';
import { CommandAdapter } from '../systems/CommandAdapter.js';
import { ScenarioDefinitionIndex } from './scenario/ScenarioDefinitionIndex.js';
import { TriggerGraph } from './scenario/TriggerGraph.js';
import { createStandardRegistries } from './Registry.js';
import { DefinitionRepository } from './DefinitionRepository.js';
import { compileQuestProject } from '../systems/quest/QuestRuntime.js';
import { createStandardCapabilityStrategyRegistry } from '../systems/items/CapabilityStrategyRegistry.js';
import {
  ConfigConsumptionSnapshot,
  createStandardConfigConsumptionRegistry
} from './ConfigConsumptionRegistry.js';
import { BattleClient } from '../integration/BattleClient.js';
import { LocalMockTransport } from '../integration/LocalMockTransport.js';

/**
 * GameLoader - 数据驱动游戏装配器（P4）
 *
 * 读取 GameProject（单一数据源），装配运行时系统：
 *   variables → Blackboard
 *   triggers  → TriggerSystem（+默认动作）
 *   dialogues → DialogueSystem（若提供）
 *   quests    → QuestSystem（若提供）
 *   library   → 各系统 registry（若提供）
 *   worldMap  → WorldStreamingManager（P5，若提供）
 *
 * 取代 PrologueManager 的手写装配（分步迁移，先做地基，不破坏现有场景）。
 * 支持 $ref 分文件：{ "$ref": "scenes/a.json" } 会被加载替换。
 */
export class GameLoader {
  constructor(config = {}) {
    const {
      contentValidator = null,
      contentValidatorConfig = {},
      candidatePipeline = null,
      projectValidators = [],
      contentPolicy = null,
      capabilityStrategyRegistry = null,
      configConsumptionRegistry = null,
      actionDescriptorRegistry = null
    } = config || {};
    this.project = null;
    this.lastSuccessfulSnapshot = null;
    this.runtimeConfigSnapshot = null;
    this.definitionRepository = DefinitionRepository.empty();
    this.capabilityStrategyRegistry = capabilityStrategyRegistry || createStandardCapabilityStrategyRegistry();
    this.configConsumptionRegistry = configConsumptionRegistry
      || createStandardConfigConsumptionRegistry(this.capabilityStrategyRegistry);
    this.configConsumptionSnapshot = ConfigConsumptionSnapshot.empty();
    this.actionDescriptorRegistry = actionDescriptorRegistry || createStandardActionDescriptorRegistry();
    this.scenarioDefinitionIndex = ScenarioDefinitionIndex.empty();
    this.triggerGraph = TriggerGraph.fromSnapshot(Object.freeze({ project: Object.freeze({}), definitionRevision: 0 }));
    // 双轨初始化：flowGroupDefinitionRepository 为主，sceneEventDefinitionRepository 作为同引用别名（兼容旧代码）
    this.flowGroupDefinitionRepository = FlowGroupDefinitionRepository.empty();
    this.sceneEventDefinitionRepository = this.flowGroupDefinitionRepository;
    this.commandAdapter = null;
    this._definitionRevision = 0;
    this.blackboard = new Blackboard();
    this.triggerSystem = new TriggerSystem();
    // 任务中心制：quests[] 编译产物（taskGraph 定义 + 触发器），装配时刷新
    this.questCompilation = { taskGraphs: [], triggers: [] };
    // 兼容 Registry 只读委托当前 DefinitionRepository revision。
    this.registries = createStandardRegistries(this.definitionRepository);

    // 成长系统（技能树 / 职业天赋 / 兵种天赋 / 天赋盘）
    this.progressionProfile = null;
    this.progressionSystem = null;
    this.skillRegistry = new SkillRegistry();

    // 内容校验器：在修改运行状态之前拦截错误配置
    this.contentValidator = contentValidator || createContentValidator(contentValidatorConfig);
    this.projectValidators = Array.isArray(projectValidators)
      ? projectValidators.filter(validator => typeof validator === 'function')
      : [];
    if (typeof contentPolicy === 'function') {
      this.projectValidators.push(contentPolicy);
    } else if (typeof contentPolicy?.validateProject === 'function') {
      this.projectValidators.push(contentPolicy.validateProject.bind(contentPolicy));
    }
    this.candidatePipeline = candidatePipeline || new CanonicalCandidatePipeline({
      contentValidator: this.contentValidator,
      ruleValidator: new CandidateRuleValidator({
        contentValidator: this.contentValidator,
        businessRuleValidators: this.projectValidators,
        capabilityStrategyRegistry: this.capabilityStrategyRegistry
      })
    });
    /** 最近一次装配的校验错误，供错误提示界面读取 */
    this.lastValidationErrors = [];

    // 战斗集成只允许一个结果源；默认在有效工程装配时创建。
    this.battleTransport = null;
    this.battleClient = null;

    this._baseDir = '';
    this._loadGeneration = 0;
    this._disposed = false;
    this._eventSourceDisposers = [];
    this._lastAssemblyDeps = null;
  }

  /** 任务中心制：quests[] 编译出的 taskGraph 定义（与 project.taskGraphs 一并注入 TaskGraphSystem）。 */
  get questTaskDefinitions() {
    return this.questCompilation?.taskGraphs || [];
  }

  /**
   * 装配成长系统：Profile、成长图、技能定义。
   *
   * 校验失败的图或技能不会写入运行时，并通过返回值报告，
   * 保证错误配置不进入可运行状态。
   *
   * @param {Object} proj - GameProject
   * @param {Object} [deps] - { effectResolver }
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  assembleProgression(proj, deps = {}) {
    try {
      const draft = this._buildProgressionDraft(proj, deps);
      Object.assign(this, {
        progressionProfile: draft.profile,
        progressionSystem: draft.progressionSystem,
        skillRegistry: draft.skillRegistry
      });
      this.lastValidationErrors = [];
      return { ok: true, errors: [] };
    } catch (error) {
      const errors = error?.errors || [{ code: 'progressionDraftFailed', path: 'progression', message: String(error?.message || error) }];
      this.lastValidationErrors = errors;
      return { ok: false, errors };
    }
  }

  /**
   * 在任何运行状态写入前完成工程、成长配置、触发器和内容库预检。
   * @returns {{ok: boolean, value: Object|null, errors: Array<Object>}}
   */
  validateProjectCandidate(project, options = {}) {
    return this.candidatePipeline.process(project, {
      schemaId: 'gameProject',
      source: options.source || this._baseDir || 'game.project.json',
      lastSuccessfulValue: this.project,
      context: { loader: this, ...(options.context || {}) },
      trace: options.trace || null
    });
  }

  /** 创建带结构化 errors 的公开内容校验异常。 */
  createValidationError(errors = []) {
    const error = new Error('GameLoader: 工程内容校验失败\n' + formatErrors(errors));
    error.name = 'ContentValidationError';
    error.errors = errors;
    return error;
  }

  _createValidationError(errors) {
    return this.createValidationError(errors);
  }

  _createBattleIntegration(project, deps = {}) {
    const battleConfig = project.integration.battle;
    if (battleConfig.resultSource === 'localMock') {
      const transport = new LocalMockTransport({ validator: this.contentValidator });
      return { transport, client: new BattleClient({ transport }) };
    }
    if (battleConfig.resultSource === 'external' && deps.battleTransport?.request) {
      return {
        transport: deps.battleTransport,
        client: new BattleClient({ transport: deps.battleTransport })
      };
    }
    throw this._createValidationError([{
      code: 'invalidResultSource',
      path: `integration.battle.${battleConfig.resultSource}`,
      message: `战斗结果源 ${battleConfig.resultSource} 当前不可用`
    }]);
  }

  /**
   * 获取最近一次装配的校验错误文本，供错误提示界面显示
   * @returns {string}
   */
  getValidationReport() {
    return formatErrors(this.lastValidationErrors);
  }

  /** 取某类内容库注册表。 */
  getRegistry(name) {
    return this.registries[name] || null;
  }

  /** 获取当前 definition revision 下的只读通用配置 consumer。 */
  getConfigConsumer(id) {
    return this.configConsumptionSnapshot.getConsumer(id);
  }

  getConfigConsumptionStatus() {
    return this.configConsumptionSnapshot.status;
  }

  /**
   * 在实例化前校验场景 ref 放置点，运行态防线仍由 PlacementSpawner 保留。
   * @param {Array<Object>} placements
   */
  validatePlacementReferences(placements = []) {
    const registryNames = {
      item: 'items', equipment: 'equipment', enemy: 'enemies', npc: 'npcs',
      building: 'buildings', vehicle: 'vehicles', resourceNode: 'resourceNodes'
    };
    const errors = [];
    for (const [index, placement] of (placements || []).entries()) {
      if (placement?.type !== 'ref' || !placement.kind) continue;
      const registryName = registryNames[placement.kind];
      if (!registryName) continue;
      const registry = this.registries[registryName];
      if (registry?.get?.(placement.ref)) continue;
      const key = placement.id || index;
      errors.push({
        code: 'invalidReference',
        path: `placements[${key}].ref`,
        message: `放置点引用了不存在的 ${placement.kind} 定义: ${placement.ref}`
      });
    }
    return { ok: errors.length === 0, errors };
  }

  /**
   * 加载并装配游戏工程
   * @param {string} url - GameProject.json 路径
   * @param {Object} deps - 运行时依赖：
   *   { dialogueSystem, questSystem, sceneManager, world, player,
   *     audioManager, floatingText, tutorial, registries }
   * @returns {Promise<Object>} 解析后的 project
   */
  async load(url, deps = {}) {
    const generation = ++this._loadGeneration;
    this._disposed = false;
    const baseDir = url.substring(0, url.lastIndexOf('/') + 1);
    this._baseDir = baseDir;
    const proj = await this._loadJson(url);
    // shards 分片：主文件声明 { shards: { 字段: 相对路径 } } 时加载分片并浅合并；无声明走原单体加载
    const project = await mergeShardedProject(proj, ref => this._loadJson(baseDir + ref));
    await this._resolveRefs(project, baseDir);
    if (generation !== this._loadGeneration) return project;
    return this.assemble(project, deps);
  }

  _buildProgressionDraft(project, deps = {}) {
    const config = project?.progression;
    const errors = [];
    if (config) {
      const configCheck = this.contentValidator.validate(config, 'progressionConfig', 'progression');
      if (!configCheck.ok) errors.push(...configCheck.errors);
    }
    const profile = new ProgressionProfile(config || {});
    const profileCheck = profile.validate();
    if (!profileCheck.ok) {
      errors.push(...profileCheck.errors.map(error => ({ ...error, path: `progression.${error.path}` })));
    }

    const skillRegistry = new SkillRegistry();
    const skills = Array.isArray(config?.skills?.skills)
      ? config.skills.skills
      : (Array.isArray(config?.skills) ? config.skills : []);
    const skillCheck = this.contentValidator.validateList(skills, 'skill', 'progression.skills');
    if (!skillCheck.ok) errors.push(...skillCheck.errors);
    const skillResult = skillCheck.ok ? skillRegistry.registerAll(skills) : { errors: [] };
    skillResult.errors.forEach(entry => {
      for (const error of entry.errors || []) {
        errors.push({ ...error, path: `progression.skills.${entry.id || '<unknown>'}.${error.path || ''}`.replace(/\.$/, '') });
      }
    });

    const progressionSystem = new ProgressionGraphSystem({
      effectResolver: deps.effectResolver,
      profile
    });
    for (const graphConfig of config?.graphs || []) {
      const id = graphConfig?.id || '<unknown>';
      const graphPath = `progression.graphs.${id}`;
      const graphCheck = this.contentValidator.validate(graphConfig, 'progressionGraph', graphPath);
      if (!graphCheck.ok) {
        errors.push(...graphCheck.errors);
        continue;
      }
      const result = progressionSystem.registerGraph(graphConfig);
      if (!result.ok) {
        errors.push(...result.errors.map(error => ({
          ...error,
          path: `progression.graphs.${id}.${error.path || ''}`.replace(/\.$/, '')
        })));
      }
    }
    if (errors.length > 0) throw this._createValidationError(errors);
    return { profile, progressionSystem, skillRegistry };
  }

  _buildExternalConsumerDrafts(project, deps, context) {
    const drafts = [];
    const dialogueSystem = deps.dialogueSystem;
    if (dialogueSystem && Array.isArray(project.dialogues)) {
      const nextDialogues = new Map();
      for (const definition of project.dialogues) {
        if (definition.enabled === false) continue;
        const nodes = definition.nodes instanceof Map
          ? new Map(definition.nodes)
          : new Map(Object.entries(definition.nodes || {}));
        nextDialogues.set(definition.id, {
          id: definition.id,
          title: definition.title || '',
          startNode: definition.startNode || 'start',
          nodes,
          variables: definition.variables || {},
          metadata: definition.metadata || {}
        });
      }
      let previous;
      drafts.push({
        commit: () => { previous = dialogueSystem.dialogues; dialogueSystem.dialogues = nextDialogues; },
        rollback: () => { if (previous) dialogueSystem.dialogues = previous; }
      });
    }

    const tutorialSystem = deps.tutorialSystem;
    if (tutorialSystem && Array.isArray(project.tutorials)) {
      const previous = tutorialSystem.getAllTutorials?.() || [];
      const previousSceneEvents = tutorialSystem.getSceneEventDefinitions?.() || [];
      drafts.push({
        commit: () => tutorialSystem.replaceDefinitions(
          project.tutorials,
          context.sceneEventDefinitionRepository
        ),
        rollback: () => tutorialSystem.replaceDefinitions(previous, previousSceneEvents)
      });
    }

    const questTransactionService = deps.questTransactionService || deps.questSystem;
    if (questTransactionService && Array.isArray(project.quests)) {
      const prepared = typeof questTransactionService.prepareDefinitions === 'function'
        ? questTransactionService.prepareDefinitions(context.repository)
        : null;
      if (prepared?.ok === false) throw this._createValidationError(prepared.errors || []);
      if (prepared?.commit) {
        drafts.push({
          commit: () => prepared.commit(),
          rollback: () => prepared.rollback?.()
        });
      }
    }

    const consumers = Array.isArray(deps.canonicalConsumers) ? deps.canonicalConsumers : [];
    for (const consumer of consumers) {
      const prepared = typeof consumer?.prepare === 'function'
        ? consumer.prepare(context)
        : (typeof consumer === 'function' ? consumer(context) : consumer);
      if (prepared && typeof prepared.then === 'function') {
        throw new TypeError('GameLoader canonical consumer prepare must be synchronous');
      }
      if (prepared?.ok === false) throw this._createValidationError(prepared.errors || [{ code: 'consumerRejected', path: '', message: 'consumer draft rejected' }]);
      if (prepared && (typeof prepared.commit === 'function' || typeof consumer?.commit === 'function')) {
        drafts.push({
          commit: () => (prepared.commit || consumer.commit).call(prepared.commit ? prepared : consumer, context),
          rollback: () => (prepared.rollback || consumer.rollback)?.call(prepared.rollback ? prepared : consumer, context)
        });
      }
    }

    const world = deps.world;
    const region = project.worldMap?.regions?.[0];
    if (world?.init && region) {
      if (typeof world.createCanonicalDraft === 'function') {
        const prepared = world.createCanonicalDraft({ ...context, region, project });
        if (prepared?.ok === false) throw this._createValidationError(prepared.errors || []);
        drafts.push({
          commit: () => {
            const result = typeof world.publishCanonicalDraft === 'function'
              ? world.publishCanonicalDraft(prepared)
              : prepared?.commit?.();
            if (result?.ok === false) throw this._createValidationError(result.errors || []);
          },
          rollback: () => prepared?.rollback?.()
        });
      } else {
        const previousSerialized = typeof world.serialize === 'function' ? world.serialize() : null;
        const previousRegion = {
          id: world.regionId,
          chunkWidth: world.chunkWidth,
          chunkHeight: world.chunkHeight,
          cols: world.cols,
          rows: world.rows,
          grid: world.grid
        };
        const previousOptions = {
          sceneResolver: world.sceneResolver,
          placementAdapter: world.placementAdapter,
          onChunkLoad: world.onChunkLoad,
          onChunkUnload: world.onChunkUnload
        };
        drafts.push({
          commit: () => {
            const result = world.init(region, project, {
              entityFactory: deps.entityFactory || null,
              triggerSystem: context.triggerSystem,
              registries: context.registries
            });
            if (result?.ok === false) throw this._createValidationError(result.errors || []);
          },
          rollback: () => {
            world.configureRegion?.(previousRegion, previousOptions);
            if (previousSerialized && typeof world.deserialize === 'function') world.deserialize(previousSerialized);
          }
        });
      }
    }
    return drafts;
  }

  _buildShadowDraft({ snapshot, repository, runtimeConfig }, deps = {}) {
    // ★ FlowGroup 兼容归一化：内存补齐 flowGroups/flowGroupId（不修改源 JSON）
    const project = normalizeProjectForRuntime(snapshot.project);
    const blackboard = new Blackboard();
    blackboard.init(project.variables || {});
    const registries = createStandardRegistries(repository);
    const battleIntegration = this._createBattleIntegration(project, deps);
    // 主仓库 flowGroups；sceneEventDefinitionRepository 保持同引用别名，兼容读取旧代码
    const flowGroupDefinitionRepository = FlowGroupDefinitionRepository.from(project.flowGroups || []);
    const sceneEventDefinitionRepository = flowGroupDefinitionRepository;
    const triggerGraph = TriggerGraph.fromSnapshot(snapshot);
    const scenarioDefinitionIndex = ScenarioDefinitionIndex.fromSnapshot(snapshot, { triggerGraph });
    const commandAdapter = deps.commandAdapter || (deps.commandGateway ? new CommandAdapter({
      registry: this.actionDescriptorRegistry,
      commandGateway: deps.commandGateway,
      definitionRepository: repository
    }) : null);
    const triggerSystem = new TriggerSystem({
      actionDescriptorRegistry: this.actionDescriptorRegistry,
      commandAdapter,
      definitionRevision: snapshot.definitionRevision,
      monotonicClock: deps.authorityClocks?.monotonic || deps.monotonicClock,
      logicalClock: deps.authorityClocks?.logical || deps.logicalClock,
      advanceClockOnUpdate: deps.advanceTriggerClockOnUpdate,
      operationIdFactory: deps.triggerOperationIdFactory,
      eventJournal: deps.eventJournal || deps.services?.eventJournal || null,
      applicationEventPublisher: deps.triggerApplicationEventPublisher,
      serviceReferenceResolver: deps.triggerServiceReferenceResolver,
      bindingReferenceResolver: deps.triggerBindingReferenceResolver,
      operationFingerprintValidator: deps.triggerOperationFingerprintValidator,
      sceneEventDefinitionRepository,
      runtimeConfig,
      sceneDiagnostics: deps.sceneDiagnostics
    });
    triggerSystem.init({
      blackboard,
      dialogue: deps.dialogueSystem,
      questSystem: deps.questSystem,
      sceneManager: deps.sceneManager,
      scene: deps.scene || null,
      eventJournal: deps.eventJournal || deps.services?.eventJournal || null,
      world: deps.world,
      player: deps.player,
      audioManager: deps.audioManager,
      floatingText: deps.floatingText,
      tutorial: deps.tutorial,
      tutorialSystem: deps.tutorialSystem,
      services: deps.services,
      triggerBindings: deps.triggerBindings,
      onItemGained: deps.onItemGained,
      battleClient: battleIntegration.client,
      registries,
      definitionRepository: repository,
      sceneEventDefinitionRepository,
      runtimeConfig,
      sceneDiagnostics: deps.sceneDiagnostics
    });
    registerDefaultActions(triggerSystem);
    // 任务中心制：quests[] → 编译产物（taskGraph 定义 + 触发器）， quests 为空时产物为空（零回归）
    const questCompilation = compileQuestProject(project);
    triggerSystem.registerAll([...(project.triggers || []), ...questCompilation.triggers]);
    const progression = this._buildProgressionDraft(project, deps);
    const configConsumption = this.configConsumptionRegistry.build(snapshot);
    const context = {
      snapshot: { ...snapshot, project },
      repository, runtimeConfig, configConsumption,
      scenarioDefinitionIndex, triggerGraph, commandAdapter,
      sceneEventDefinitionRepository,
      flowGroupDefinitionRepository,
      blackboard, triggerSystem, registries,
      questCompilation
    };
    const consumerDrafts = this._buildExternalConsumerDrafts(project, deps, context);
    return { ...context, ...progression, battleIntegration, consumerDrafts, deps };
  }

  _publishShadowDraft(draft) {
    const committed = [];
    const previous = {
      project: this.project,
      lastSuccessfulSnapshot: this.lastSuccessfulSnapshot,
      runtimeConfigSnapshot: this.runtimeConfigSnapshot,
      definitionRepository: this.definitionRepository,
      configConsumptionSnapshot: this.configConsumptionSnapshot,
      scenarioDefinitionIndex: this.scenarioDefinitionIndex,
      triggerGraph: this.triggerGraph,
      sceneEventDefinitionRepository: this.sceneEventDefinitionRepository,
      flowGroupDefinitionRepository: this.flowGroupDefinitionRepository,
      commandAdapter: this.commandAdapter,
      registries: this.registries,
      blackboard: this.blackboard,
      triggerSystem: this.triggerSystem,
      questCompilation: this.questCompilation,
      battleTransport: this.battleTransport,
      battleClient: this.battleClient,
      progressionProfile: this.progressionProfile,
      progressionSystem: this.progressionSystem,
      skillRegistry: this.skillRegistry,
      _definitionRevision: this._definitionRevision,
      _disposed: this._disposed
    };
    try {
      for (const consumer of draft.consumerDrafts) {
        try {
          consumer.commit?.();
          committed.push(consumer);
        } catch (error) {
          try { consumer.rollback?.(); } catch { /* preserve original publication error */ }
          throw error;
        }
      }

      this._releaseEventSources();
      Object.assign(this, {
        project: draft.snapshot.project,
        lastSuccessfulSnapshot: draft.snapshot,
        runtimeConfigSnapshot: draft.runtimeConfig,
        definitionRepository: draft.repository,
        configConsumptionSnapshot: draft.configConsumption,
        scenarioDefinitionIndex: draft.scenarioDefinitionIndex,
        triggerGraph: draft.triggerGraph,
        sceneEventDefinitionRepository: draft.sceneEventDefinitionRepository,
        flowGroupDefinitionRepository: draft.flowGroupDefinitionRepository,
        commandAdapter: draft.commandAdapter,
        registries: draft.registries,
        blackboard: draft.blackboard,
        triggerSystem: draft.triggerSystem,
        questCompilation: draft.questCompilation,
        battleTransport: draft.battleIntegration.transport,
        battleClient: draft.battleIntegration.client,
        progressionProfile: draft.profile,
        progressionSystem: draft.progressionSystem,
        skillRegistry: draft.skillRegistry,
        _definitionRevision: draft.snapshot.definitionRevision,
        _disposed: false
      });
      this.bridgeEventSources(draft.deps);
      this._lastAssemblyDeps = draft.deps;
    } catch (error) {
      this._releaseEventSources();
      Object.assign(this, previous);
      for (const consumer of committed.reverse()) {
        try { consumer.rollback?.(); } catch { /* best-effort rollback */ }
      }
      if (this._lastAssemblyDeps) {
        try { this.bridgeEventSources(this._lastAssemblyDeps); } catch { /* preserve publication error */ }
      }
      throw error;
    }
  }

  /**
   * 用已解析的 project 对象直接装配（无需 fetch，供编辑器/测试）。
   * 完整 shadow 构建成功后才交换正式快照与全部内部 consumer。
   */
  assemble(proj, deps = {}) {
    const result = this.candidatePipeline.processToSnapshot(proj, {
      schemaId: 'gameProject',
      source: this._baseDir || 'game.project.json',
      revision: this._definitionRevision + 1,
      lastSuccessfulSnapshot: this.lastSuccessfulSnapshot,
      context: { loader: this },
      repositoryOptions: { capabilityStrategyRegistry: this.capabilityStrategyRegistry },
      buildShadow: context => this._buildShadowDraft(context, deps)
    });
    if (!result.ok) {
      this.lastValidationErrors = result.errors;
      throw this._createValidationError(result.errors);
    }

    try {
      this._publishShadowDraft(result.draft);
    } catch (error) {
      const errors = error?.errors || [{ code: 'snapshotPublishFailed', path: '', message: String(error?.message || error) }];
      this.lastValidationErrors = errors;
      throw this._createValidationError(errors);
    }
    this.lastValidationErrors = [];
    return result.snapshot.project;
  }

  /** 捕获命令开始时的不可变定义 revision；后续 reload 不改变此 lock。 */
  lockDefinitionRevision() {
    return this.definitionRepository.lockRevision();
  }

  /**
   * Canonical 内容事件只允许从 PostCommitNotificationBus 进入 EventJournal 与 Trigger。
   * 旧 Quest local emit / Combat callback → Trigger 旁路已退出正式运行路径。
   */
  bridgeEventSources(_deps = {}) {
    this._disposed = false;
    this._releaseEventSources();
  }

  _releaseEventSources() {
    const disposers = this._eventSourceDisposers.splice(0).reverse();
    for (const disposer of disposers) {
      try {
        disposer();
      } catch (error) {
        console.warn('GameLoader: 事件源释放失败', error);
      }
    }
  }

  /** 释放事件桥接并使当前在途加载失效。 */
  dispose() {
    if (this._disposed) return false;
    this._disposed = true;
    this._loadGeneration++;
    this._releaseEventSources();
    return true;
  }

  /** 更新触发器/表达式上下文（如玩家实体创建后） */
  updateContext(patch = {}) {
    this.triggerSystem.updateContext(patch);
  }

  /** 每帧更新（timer 触发器） */
  update(dt) {
    this.triggerSystem.update(dt);
  }

  /**
   * 序列化运行时状态（存档：黑板 + 触发器 once/cooldown + 角色成长）
   * @param {string} [characterId] - 提供时一并保存该角色的成长状态
   */
  serialize(characterId = null, metadata = {}) {
    const data = {
      blackboard: this.blackboard.serialize(),
      triggers: this.triggerSystem.serialize(metadata)
    };

    if (characterId && this.progressionSystem) {
      data.progression = this.progressionSystem.serializeCharacter(characterId);
    }

    return data;
  }

  /**
   * 纯校验序列化内容；供存档 inspect 在任何状态写入前发现深层不兼容。
   * @param {Object} data
   * @param {string} [characterId]
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  validateSerialized(data, characterId = null) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: [{ code: 'missingField', path: '', message: '存档为空' }] };
    }

    const errors = [];
    if (!data.blackboard || typeof data.blackboard !== 'object' || Array.isArray(data.blackboard)) {
      errors.push({ code: 'invalidField', path: 'blackboard', message: 'Blackboard 存档必须是对象' });
    }

    const triggerValidation = this.triggerSystem.validateSnapshot(data.triggers);
    if (!triggerValidation.ok) errors.push(...triggerValidation.errors);

    if (characterId && data.progression && this.progressionSystem) {
      const progressionValidation = this.progressionSystem.validateSerializedCharacter(data.progression);
      if (!progressionValidation.ok) {
        errors.push(...progressionValidation.errors.map(error => ({
          ...error,
          path: `progression.${error.path || ''}`.replace(/\.$/, '')
        })));
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /**
   * 从存档恢复
   * @param {Object} data
   * @param {string} [characterId]
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  deserialize(data, characterId = null, { restoreTriggers = true } = {}) {
    const validation = this.validateSerialized(data, characterId);
    if (!validation.ok) return validation;

    this.blackboard.deserialize(data.blackboard);
    if (restoreTriggers) {
      const triggerResult = this.triggerSystem.deserialize(data.triggers);
      if (!triggerResult.ok) return triggerResult;
    }

    if (characterId && data.progression && this.progressionSystem) {
      return this.progressionSystem.deserializeCharacter(characterId, data.progression);
    }

    return { ok: true, errors: [] };
  }

  // ---- 内部：加载 + $ref 解析 ----

  async _loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('GameLoader: 加载失败 ' + url);
    const text = await res.text();
    const parsed = this.contentValidator.parseJson(text);
    if (!parsed.ok) {
      const errors = parsed.errors.map(error => ({ ...error, resource: url }));
      this.lastValidationErrors = errors;
      throw this._createValidationError(errors);
    }
    return parsed.value;
  }

  /**
   * 递归解析对象/数组中的 { "$ref": "相对路径" }，加载并替换
   * @private
   */
  async _resolveRefs(node, baseDir = this._baseDir) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = await this._resolveNode(node[i], baseDir);
      }
    } else if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        node[key] = await this._resolveNode(node[key], baseDir);
      }
    }
    return node;
  }

  async _resolveNode(value, baseDir = this._baseDir) {
    if (value && typeof value === 'object' && typeof value.$ref === 'string') {
      const loaded = await this._loadJson(baseDir + value.$ref);
      await this._resolveRefs(loaded, baseDir);
      return loaded;
    }
    if (value && typeof value === 'object') {
      await this._resolveRefs(value, baseDir);
    }
    return value;
  }
}

export default GameLoader;

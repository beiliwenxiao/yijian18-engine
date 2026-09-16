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

import { QuestRuntimeState, QUEST_RUNTIME_SCHEMA_VERSION } from './QuestRuntimeState.js';
import { QuestResolver } from './resolvers/QuestResolver.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const logicalNow = context => Math.max(0, Math.floor(Number(context?.clocks?.logical?.now?.() ?? 0) || 0));
const reject = (command, code, error = null) => ({
  ok: false, operationId: command.operationId, status: 'rejected', committed: false,
  code, stateId: null, stateRevision: null, eventFrom: null, eventTo: null,
  value: null, error: error || { message: code }
});

export const QUEST_COMMANDS = Object.freeze({
  COMMAND: 'quest.command',
  ACCEPT: 'quest.accept',
  ADVANCE: 'quest.advance',
  ABANDON: 'quest.abandon',
  TURN_IN: 'quest.turnIn',
  TRACK: 'quest.track',
  EXPIRE: 'quest.expire',
  TASK_START: 'task.start',
  TASK_EVENT: 'task.event',
  TASK_TRACK: 'task.track'
});

const OPERATION_BY_COMMAND = Object.freeze({
  [QUEST_COMMANDS.ACCEPT]: 'accept',
  [QUEST_COMMANDS.ADVANCE]: 'advance',
  [QUEST_COMMANDS.ABANDON]: 'abandon',
  [QUEST_COMMANDS.TURN_IN]: 'turnIn',
  [QUEST_COMMANDS.TRACK]: 'track',
  [QUEST_COMMANDS.EXPIRE]: 'expire',
  [QUEST_COMMANDS.TASK_START]: 'task.start',
  [QUEST_COMMANDS.TASK_EVENT]: 'task.event',
  [QUEST_COMMANDS.TASK_TRACK]: 'task.track'
});

/**
 * QuestRuntimeState 的唯一写入者。所有状态转换经 AuthorityPort → execute，
 * 由 LocalAuthorityAdapter 统一处理 operation ledger、definition/state revision 与通知发布。
 */
export class QuestTransactionService {
  constructor(config = {}) {
    this.definitionRepository = config.definitionRepository || null;
    this.rewardParticipants = Array.isArray(config.rewardParticipants) ? config.rewardParticipants : [];
    this.scheduleCheckpoint = typeof config.scheduleCheckpoint === 'function' ? config.scheduleCheckpoint : null;
    this.commandGateway = config.commandGateway || null;
    this.taskGraphSystem = config.taskGraphSystem || null;
    this.getDefaultActorId = typeof config.getDefaultActorId === 'function' ? config.getDefaultActorId : (() => config.actorId || null);
    this.stateType = 'questRuntime';
    this.stateId = command => `quest:${command.actorId}`;
    this._states = new Map();
    this._listeners = new Map();
  }

  setDefinitionRepository(repository) {
    if (!repository || typeof repository.get !== 'function') throw new TypeError('QuestTransactionService requires DefinitionRepository');
    this.definitionRepository = repository;
    return this;
  }

  setCommandGateway(commandGateway) {
    if (commandGateway && typeof commandGateway.execute !== 'function') throw new TypeError('Quest command gateway must implement execute');
    this.commandGateway = commandGateway;
    return this;
  }

  setTaskGraphSystem(taskGraphSystem) {
    if (taskGraphSystem && (typeof taskGraphSystem.prepareStart !== 'function'
      || typeof taskGraphSystem.prepareConsumeEvent !== 'function')) {
      throw new TypeError('QuestTransactionService requires a transactional TaskGraphSystem');
    }
    this.taskGraphSystem = taskGraphSystem || null;
    return this;
  }

  prepareDefinitions(repository) {
    if (!repository || typeof repository.get !== 'function') return { ok: false, errors: [{ code: 'definitionRepositoryMissing', path: 'quests', message: '任务定义仓库不可用' }] };
    const previous = this.definitionRepository;
    return {
      ok: true,
      commit: () => { this.definitionRepository = repository; },
      rollback: () => { this.definitionRepository = previous; }
    };
  }

  on(type, callback) {
    if (typeof callback !== 'function') return () => {};
    const listeners = this._listeners.get(type) || new Set();
    listeners.add(callback);
    this._listeners.set(type, listeners);
    return () => listeners.delete(callback);
  }

  off(type, callback) {
    return this._listeners.get(type)?.delete(callback) || false;
  }

  async submit(operation, questId, payload = {}, options = {}) {
    const actorRef = options.actorId || this.getDefaultActorId();
    if (!this.commandGateway || !hasText(actorRef) || !hasText(questId)) return { ok: false, code: 'questCommandUnavailable' };
    return this.commandGateway.execute({
      intentType: QUEST_COMMANDS.COMMAND,
      actorRef,
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
      ...(options.expectedStateRevision === undefined ? {} : { expectedStateRevision: options.expectedStateRevision }),
      payload: { ...clone(payload), questId, operation }
    }, options);
  }

  acceptQuest(questId, options = {}) { return this.submit('accept', questId, {}, options); }
  advanceQuest(questId, signal, options = {}) { return this.submit('advance', questId, { signal }, options); }
  abandonQuest(questId, options = {}) { return this.submit('abandon', questId, {}, options); }
  turnInQuest(questId, options = {}) { return this.submit('turnIn', questId, {}, options); }
  setTracking(questId, tracking, options = {}) { return this.submit('track', questId, { tracking }, options); }
  toggleTracking(questId, options = {}) {
    const runtime = this._runtime(this.getDefaultActorId(), questId);
    return this.setTracking(questId, !runtime?.tracking, options);
  }

  startTaskGraph(definitionId, options = {}) {
    return this._submitTaskCommand(QUEST_COMMANDS.TASK_START, {
      definitionId,
      instanceId: options.instanceId || null,
      startedByEventId: options.startedByEventId || null,
      tracking: options.tracking !== false
    }, options);
  }

  consumeTaskEvent(event, options = {}) {
    const actorId = options.actorId || this.getDefaultActorId();
    if (!this.taskGraphSystem?.canConsumeEvent?.(event, actorId)) {
      return Promise.resolve({ ok: true, committed: false, skipped: true, code: 'taskEventNotMatched' });
    }
    return this._submitTaskCommand(QUEST_COMMANDS.TASK_EVENT, { event: clone(event) }, {
      ...options,
      actorId,
      operationId: options.operationId || `task-event:${actorId}:${event.eventId}`
    });
  }

  setTaskTracking(instanceId, tracking, options = {}) {
    return this._submitTaskCommand(QUEST_COMMANDS.TASK_TRACK, { instanceId, tracking: tracking === true }, options);
  }

  _submitTaskCommand(intentType, payload, options = {}) {
    const actorRef = options.actorId || this.getDefaultActorId();
    if (!this.commandGateway || !hasText(actorRef)) return Promise.resolve({ ok: false, code: 'taskCommandUnavailable' });
    return this.commandGateway.execute({
      intentType,
      actorRef,
      ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
      ...(options.expectedStateRevision === undefined ? {} : { expectedStateRevision: options.expectedStateRevision }),
      payload: clone(payload)
    }, options);
  }

  async execute(command, context) {
    if (command.definitionRevision !== this.definitionRepository?.definitionRevision) return reject(command, 'definitionRevisionConflict');
    const operation = OPERATION_BY_COMMAND[command.commandType] || command.payload?.operation;
    if (hasText(operation) && operation.startsWith('task.')) {
      return this._executeTaskGraph({ operation, command, context, actorId: command.actorId });
    }
    const definitionId = command.payload?.questId;
    const definition = this._definition(definitionId);
    if (!definition || !hasText(operation)) return reject(command, definition ? 'questOperationMissing' : 'unknownQuest');
    const now = logicalNow(context);
    const actorId = command.actorId;
    const previous = this._actorStates(actorId);
    const draft = new Map(previous);
    const existing = draft.get(definitionId) || null;
    let resolution;
    try {
      resolution = this._resolve({ operation, definition, existing, command, now, actorId });
    } catch (error) {
      return reject(command, error.code || 'questValidationFailed', { message: error.message });
    }
    if (!resolution.changed) return reject(command, resolution.code || 'questStateRejected');
    if (resolution.runtime) draft.set(definitionId, resolution.runtime);
    else draft.delete(definitionId);

    const rewards = operation === 'turnIn' ? await this._prepareRewards(definition, resolution.runtime, command) : { ok: true, participants: [] };
    if (!rewards.ok) return reject(command, rewards.code, rewards.error);
    return this._commit({ command, context, actorId, previous, draft, definition, resolution, rewards });
  }

  async _executeTaskGraph({ operation, command, context, actorId }) {
    const system = this.taskGraphSystem;
    if (!system) return reject(command, 'taskGraphUnavailable');
    let prepared;
    if (operation === 'task.start') {
      const definitionId = command.payload?.definitionId || command.payload?.questId;
      prepared = system.prepareStart(definitionId, {
        instanceId: command.payload?.instanceId || null,
        startedByEventId: command.payload?.startedByEventId || null,
        actorId,
        tracking: command.payload?.tracking !== false
      });
    } else if (operation === 'task.event') {
      prepared = system.prepareConsumeEvent(command.payload?.event, { actorId });
    } else if (operation === 'task.track') {
      prepared = system.prepareTracking(command.payload?.instanceId, command.payload?.tracking === true, actorId);
    } else {
      return reject(command, 'unsupportedTaskGraphOperation');
    }
    if (prepared?.ok !== true) return reject(command, prepared?.code || 'taskGraphPrepareFailed');
    if (prepared.changed !== true) return reject(command, prepared.code || 'taskGraphUnchanged');

    const completedInstances = operation === 'task.event'
      ? prepared.completedInstances || []
      : (prepared.completed && prepared.instance ? [prepared.instance] : []);
    const rewardParticipants = [];
    for (const instance of completedInstances) {
      const definition = this._definition(instance.definitionId) || system.getDefinition(instance.definitionId);
      const rewards = await this._prepareRewards(definition || {}, instance, command);
      if (!rewards.ok) return reject(command, rewards.code, rewards.error);
      rewardParticipants.push(...rewards.participants);
    }

    const committedRewards = [];
    let graphCommitted = false;
    let revisionCommitted = false;
    const rollback = async () => {
      if (graphCommitted) prepared.rollback?.();
      for (const participant of [...committedRewards].reverse()) {
        try { await participant.rollback?.(); } catch { /* 保留原始失败 */ }
      }
      if (revisionCommitted) context.stateRevisions?.rollbackCommitted?.(context.preparedStateRevision);
    };
    try {
      const graphCommit = prepared.commit?.();
      if (graphCommit?.ok === false) throw Object.assign(new Error(graphCommit.errors?.[0]?.message || graphCommit.code), { code: graphCommit.code || 'taskGraphCommitFailed' });
      graphCommitted = true;
      for (const participant of rewardParticipants) {
        committedRewards.push(participant);
        const outcome = await participant.commit?.();
        if (outcome?.ok === false) throw Object.assign(new Error(outcome.message || outcome.code || 'task reward commit rejected'), { code: outcome.code || 'taskRewardCommitRejected' });
      }
      const stateRevision = context.commitStateRevision(context.preparedStateRevision);
      if (!stateRevision?.ok) throw Object.assign(new Error(stateRevision?.code || 'stateRevisionCommitFailed'), { code: stateRevision?.code || 'stateRevisionCommitFailed' });
      revisionCommitted = true;
      const value = {
        operation,
        actorId,
        instance: clone(prepared.instance || null),
        changes: clone(prepared.changes || []),
        completedInstances: clone(completedInstances),
        checkpoint: { scheduled: this.scheduleCheckpoint !== null }
      };
      const result = {
        ok: true, operationId: command.operationId, status: 'committed', committed: true,
        code: null, stateId: context.preparedStateRevision.stateId,
        stateRevision: stateRevision.stateRevision,
        eventFrom: null, eventTo: null, value, error: null
      };
      // 存档副本把本 operation/Trigger step 投影到即将提交的终态；live 状态保持真实 in-flight。
      for (const participant of committedRewards) {
        try { await participant.finalize?.(); } catch { /* 表现失败不回滚事实 */ }
      }
      const eventBase = { stateId: result.stateId, stateType: this.stateType, stateRevision: result.stateRevision };
      const applicationEvents = [{
        ...eventBase,
        type: operation === 'task.start' ? 'task.started'
          : operation === 'task.track' ? 'task.trackingChanged'
            : 'task.advanced',
        payload: value
      }];
      for (const instance of completedInstances) {
        applicationEvents.push({ ...eventBase, type: 'task.completed', payload: { instance: clone(instance) } });
      }
      return {
        result,
        committedEvents: [{ ...eventBase, type: `${operation}.committed`, payload: value }],
        applicationEvents,
        postCommit: () => this._scheduleCheckpoint(command, command.payload?.definitionId || command.payload?.instanceId || 'taskGraph')
      };
    } catch (error) {
      await rollback();
      return reject(command, error.code || 'taskGraphCommitFailed', { message: error.message || String(error) });
    }
  }

  _resolve({ operation, definition, existing, command, now, actorId }) {
    if (operation === 'accept') {
      if (existing?.state === 'active' || existing?.state === 'completed') return { changed: false, code: 'questAlreadyActive' };
      if (existing && !QuestResolver.canRepeat(definition, existing, now)) {
        if (existing.state === 'turned_in') return { changed: false, code: 'questAlreadyCompleted' };
      }
      this._assertPrerequisites(definition, actorId);
      const runtime = QuestResolver.initialRuntime(definition, {
        questRuntimeId: `${actorId}:${definition.id}`, logicalTime: now, repeat: existing?.repeat
      });
      return { changed: true, runtime, events: [{ type: 'questAccepted' }] };
    }
    if (operation === 'advance') {
      const result = QuestResolver.advance(definition, existing, command.payload?.signal || command.payload, now);
      return { ...result, code: result.changed ? null : 'questProgressUnchanged' };
    }
    if (operation === 'abandon') return QuestResolver.abandon(existing);
    if (operation === 'track') return QuestResolver.setTracking(existing, command.payload?.tracking);
    if (operation === 'expire') {
      const result = QuestResolver.advance(definition, existing, { type: '__expiration__', amount: 0 }, now);
      return { ...result, code: result.changed ? null : 'questNotExpired' };
    }
    if (operation === 'turnIn') {
      const result = QuestResolver.turnIn(existing, command.operationId, now);
      return { ...result, code: result.changed ? null : 'questNotReadyToTurnIn' };
    }
    return { changed: false, code: 'unsupportedQuestOperation' };
  }

  _assertPrerequisites(definition, actorId) {
    const states = this._actorStates(actorId);
    const prerequisites = Array.isArray(definition.prerequisites) ? definition.prerequisites : (definition.requiredQuests || []);
    if (prerequisites.some(id => states.get(id)?.state !== 'turned_in')) {
      throw Object.assign(new Error('任务前置条件尚未完成'), { code: 'questPrerequisitesIncomplete' });
    }
  }

  async _prepareRewards(definition, runtime, command) {
    const participants = [];
    const configuredParticipants = this.rewardParticipants.filter(participant => typeof participant?.prepareReward === 'function');
    const reward = definition?.reward;
    const hasReward = Array.isArray(reward)
      ? reward.length > 0
      : Boolean(reward && typeof reward === 'object' && Object.keys(reward).length > 0);
    if (hasReward && configuredParticipants.length === 0) {
      return {
        ok: false,
        code: 'rewardSettlementUnavailable',
        error: { message: '任务定义包含奖励，但未配置原子奖励结算参与者' }
      };
    }
    for (const participant of configuredParticipants) {
      let prepared;
      try { prepared = await participant.prepareReward({ definition: clone(definition), runtime: clone(runtime), reward: clone(definition.reward || {}), command }); }
      catch (error) { return { ok: false, code: 'rewardPrepareFailed', error: { message: error.message || String(error) } }; }
      if (prepared?.ok === false) return { ok: false, code: prepared.code || 'rewardPrepareRejected', error: prepared.error || { message: prepared.message || '奖励参与者拒绝' } };
      participants.push(prepared || {});
    }
    return { ok: true, participants };
  }

  async _commit({ command, context, actorId, previous, draft, definition, resolution, rewards }) {
    const committed = [];
    let revisionCommitted = false;
    const rollback = async () => {
      this._states.set(actorId, previous);
      for (const participant of [...committed].reverse()) {
        try { await participant.rollback?.(); } catch { /* 保留原始失败，继续严格逆序回滚 */ }
      }
      if (revisionCommitted) context.stateRevisions?.rollbackCommitted?.(context.preparedStateRevision);
    };
    try {
      for (const participant of rewards.participants) {
        committed.push(participant);
        const outcome = await participant.commit?.();
        if (outcome?.ok === false) throw Object.assign(new Error(outcome.message || outcome.code || 'reward commit rejected'), { code: outcome.code || 'rewardCommitRejected' });
      }
      const revision = context.preparedStateRevision?.next;
      const runtime = draft.get(definition.id);
      if (runtime) draft.set(definition.id, new QuestRuntimeState({ ...runtime, stateRevision: revision ?? runtime.stateRevision }).toJSON());
      this._states.set(actorId, draft);

      const stateRevision = context.commitStateRevision(context.preparedStateRevision);
      if (!stateRevision?.ok) throw Object.assign(new Error(stateRevision?.code || 'stateRevisionCommitFailed'), { code: stateRevision?.code || 'stateRevisionCommitFailed' });
      revisionCommitted = true;
      const stateId = context.preparedStateRevision.stateId;
      const runtimeState = this._runtime(actorId, definition.id);
      const quest = this._project(definition, runtimeState, actorId);
      const eventQuest = this._eventProjection(quest);
      const value = {
        operation: command.payload?.operation || OPERATION_BY_COMMAND[command.commandType],
        quest: eventQuest,
        reward: clone(definition.reward || {}),
        checkpoint: { scheduled: this.scheduleCheckpoint !== null }
      };
      const result = {
        ok: true, operationId: command.operationId, status: 'committed', committed: true,
        code: null, stateId, stateRevision: stateRevision.stateRevision,
        eventFrom: null, eventTo: null, value, error: null
      };
      const eventBase = { stateId, stateType: this.stateType, stateRevision: stateRevision.stateRevision };
      const applicationEvents = this._applicationEvents(resolution.events || [], eventQuest, definition.reward || {});
      for (const participant of committed) {
        try { await participant.finalize?.(); } catch { /* finalize 仅表现，不回滚已提交事实 */ }
      }
      this._emitResolved(resolution.events || [], quest, definition.reward || {});
      return {
        result,
        committedEvents: [{ ...eventBase, type: `${command.commandType}.committed`, payload: value }],
        applicationEvents: applicationEvents.map(event => ({ ...eventBase, ...event })),
        postCommit: () => this._scheduleCheckpoint(command, definition.id)
      };
    } catch (error) {
      await rollback();
      return reject(command, error.code || 'questCommitFailed', { message: error.message || String(error) });
    }
  }

  async _scheduleCheckpoint(command, definitionId) {
    const scheduler = this.scheduleCheckpoint;
    if (!scheduler) return { ok: true, skipped: true };
    const value = await scheduler({
      kind: 'quest',
      operationId: command.operationId,
      questId: definitionId,
      command
    });
    if (value === false || value?.ok === false) {
      throw Object.assign(new Error(value?.message || value?.code || 'quest checkpoint scheduling failed'), {
        code: value?.code || 'questCheckpointRejected'
      });
    }
    return value || { ok: true };
  }

  _applicationEvents(events, quest, reward) {
    return events.map(event => ({
      type: `quest.${event.type}`,
      payload: event.type === 'questTurnedIn' ? { quest, reward: clone(reward) } : { quest, ...clone(event) }
    }));
  }

  _emitResolved(events, quest, reward) {
    for (const event of events) {
      const type = event.type;
      const local = {
        questAccepted: 'questAccepted', objectiveProgress: 'questProgress', questCompleted: 'questCompleted',
        questTurnedIn: 'questTurnedIn', questAbandoned: 'questAbandoned', questTrackingChanged: 'questTrackingChanged', questExpired: 'questFailed'
      }[type];
      if (local) this._emit(local, type === 'questTurnedIn' ? { quest, reward: clone(reward) } : { quest, ...clone(event) });
    }
  }

  _emit(type, value) {
    for (const listener of this._listeners.get(type) || []) {
      try { listener(clone(value)); } catch { /* UI 监听器不可影响领域事务 */ }
    }
  }

  _definition(id) {
    return hasText(id) ? this.definitionRepository?.get?.('quests', id) || null : null;
  }

  _actorStates(actorId) {
    const known = this._states.get(actorId);
    return known ? new Map([...known.entries()].map(([id, runtime]) => [id, clone(runtime)])) : new Map();
  }

  _runtime(actorId, definitionId) {
    return this._states.get(actorId)?.get(definitionId) || null;
  }

  _definitionEntries() {
    const repository = this.definitionRepository;
    if (!repository?.snapshot?.definitions?.quests) return [];
    return repository.snapshot.definitions.quests;
  }

  _project(definition, runtime, actorId) {
    const state = runtime?.state || this._availableState(definition, actorId);
    const objectiveProgress = runtime?.objectiveProgress || {};
    const objectives = (definition.objectives || []).map(objective => {
      const currentCount = Math.max(0, Math.floor(Number(objectiveProgress[objective.id]) || 0));
      const requiredCount = Math.max(1, Math.floor(Number(objective.requiredCount) || 1));
      return Object.freeze({ ...clone(objective), currentCount, requiredCount, isComplete: () => currentCount >= requiredCount });
    });
    const projection = {
      id: definition.id,
      definitionId: definition.id,
      questRuntimeId: runtime?.questRuntimeId || null,
      name: definition.name || definition.text?.name || definition.id,
      type: definition.type || 'side',
      description: definition.description || definition.text?.description || '',
      shortDescription: definition.shortDescription || definition.text?.shortDescription || '',
      giverNPCId: definition.giverNPCId || definition.giver?.npcId || null,
      turnInNPCId: definition.turnInNPCId || definition.turnIn?.npcId || null,
      minLevel: definition.minLevel || 1,
      reward: clone(definition.reward || {}),
      objectives,
      state,
      tracked: runtime?.tracking === true,
      remaining: runtime?.remaining ?? null,
      stateRevision: runtime?.stateRevision ?? 0,
      getProgressPercent: () => QuestResolver.progressPercent(definition, runtime || { objectiveProgress: {} })
    };
    return Object.freeze(projection);
  }

  _eventProjection(quest) {
    return {
      id: quest.id,
      definitionId: quest.definitionId,
      questRuntimeId: quest.questRuntimeId,
      name: quest.name,
      type: quest.type,
      description: quest.description,
      shortDescription: quest.shortDescription,
      giverNPCId: quest.giverNPCId,
      turnInNPCId: quest.turnInNPCId,
      minLevel: quest.minLevel,
      reward: clone(quest.reward),
      objectives: quest.objectives.map(objective => ({
        ...Object.fromEntries(Object.entries(objective).filter(([, value]) => typeof value !== 'function'))
      })),
      state: quest.state,
      tracked: quest.tracked,
      remaining: quest.remaining,
      stateRevision: quest.stateRevision,
      progressPercent: quest.getProgressPercent()
    };
  }

  _availableState(definition, actorId) {
    const prerequisites = Array.isArray(definition.prerequisites) ? definition.prerequisites : (definition.requiredQuests || []);
    return prerequisites.every(id => this._runtime(actorId, id)?.state === 'turned_in') ? 'available' : 'locked';
  }

  getQuest(definitionId, actorId = this.getDefaultActorId()) {
    const definition = this._definition(definitionId);
    return definition ? this._project(definition, this._runtime(actorId, definitionId), actorId) : null;
  }

  getAllQuests(actorId = this.getDefaultActorId()) {
    return this._definitionEntries().map(definition => this._project(definition, this._runtime(actorId, definition.id), actorId));
  }

  getActiveQuests(actorId = this.getDefaultActorId()) {
    return this.getAllQuests(actorId).filter(quest => quest.state === 'active' || quest.state === 'completed');
  }

  getTrackedQuests(actorId = this.getDefaultActorId()) {
    return this.getActiveQuests(actorId).filter(quest => quest.tracked);
  }

  getCompletedQuestIds(actorId = this.getDefaultActorId()) {
    return this.getAllQuests(actorId).filter(quest => quest.state === 'turned_in').map(quest => quest.id);
  }

  get quests() { return new Map(this.getAllQuests().map(quest => [quest.id, quest])); }
  get activeQuests() { return new Map(this.getActiveQuests().map(quest => [quest.id, quest])); }
  get completedQuests() { return new Set(this.getCompletedQuestIds()); }

  snapshot() { return this.serialize(); }
  serialize() {
    return {
      schemaVersion: QUEST_RUNTIME_SCHEMA_VERSION,
      definitionRevision: this.definitionRepository?.definitionRevision ?? 0,
      taskGraph: this.taskGraphSystem?.snapshot?.() || null,
      actors: [...this._states.entries()].map(([actorId, states]) => ({
        actorId, runtimes: [...states.values()].map(runtime => clone(runtime))
      }))
    };
  }

  validate(data = {}) { return this.validateSerialized(data); }
  validateSerialized(data = {}) {
    const errors = [];
    if (data?.schemaVersion !== QUEST_RUNTIME_SCHEMA_VERSION) errors.push({ code: 'versionMismatch', path: 'schemaVersion', message: 'QuestRuntimeState 存档版本不兼容' });
    if (data?.definitionRevision !== (this.definitionRepository?.definitionRevision ?? 0)) errors.push({ code: 'definitionRevisionConflict', path: 'definitionRevision', message: '任务定义 revision 不匹配' });
    let taskGraph = null;
    if (this.taskGraphSystem) {
      if (!data?.taskGraph) errors.push({ code: 'missingTaskGraphState', path: 'taskGraph', message: '缺少任务图运行态' });
      else {
        const checked = this.taskGraphSystem.validate(data.taskGraph);
        if (!checked.ok) errors.push(...checked.errors.map(item => ({ ...item, path: `taskGraph.${item.path || ''}`.replace(/\.$/, '') })));
        else taskGraph = clone(data.taskGraph);
      }
    }
    const actors = new Map();
    for (const [index, actor] of (Array.isArray(data?.actors) ? data.actors : []).entries()) {
      if (!hasText(actor?.actorId) || actors.has(actor.actorId)) { errors.push({ code: 'invalidActorId', path: `actors[${index}].actorId`, message: '角色 ID 缺失或重复' }); continue; }
      const states = new Map();
      for (const [runtimeIndex, raw] of (Array.isArray(actor.runtimes) ? actor.runtimes : []).entries()) {
        const checked = QuestRuntimeState.validate(raw);
        if (!checked.ok) { errors.push(...checked.errors.map(item => ({ ...item, path: `actors[${index}].runtimes[${runtimeIndex}].${item.path}`.replace(/\.$/, '') }))); continue; }
        if (!this._definition(raw.definitionId) || states.has(raw.definitionId)) { errors.push({ code: 'invalidRuntimeReference', path: `actors[${index}].runtimes[${runtimeIndex}].definitionId`, message: '任务定义不存在或重复' }); continue; }
        states.set(raw.definitionId, clone(raw));
      }
      actors.set(actor.actorId, states);
    }
    return { ok: errors.length === 0, errors, actors, taskGraph };
  }

  restore(data = {}) { return this.deserialize(data); }
  deserialize(data = {}) {
    const prepared = this.validateSerialized(data);
    if (!prepared.ok) return { ok: false, errors: prepared.errors };
    const previousStates = this._states;
    const previousTaskGraph = this.taskGraphSystem?.snapshot?.() || null;
    if (this.taskGraphSystem && prepared.taskGraph) {
      const restored = this.taskGraphSystem.restore(prepared.taskGraph);
      if (!restored.ok) return restored;
    }
    try {
      this._states = prepared.actors;
      return { ok: true, errors: [] };
    } catch (error) {
      this._states = previousStates;
      if (previousTaskGraph) this.taskGraphSystem?.restore?.(previousTaskGraph);
      return { ok: false, errors: [{ code: 'questRestoreFailed', path: '', message: error?.message || String(error) }] };
    }
  }

  reset() {
    this._states.clear();
    if (this.taskGraphSystem) {
      this.taskGraphSystem.restore({ schemaVersion: 1, nextInstanceSequence: 0, instances: [] });
    }
  }
  cleanup() { this._listeners.clear(); }
}

export default QuestTransactionService;

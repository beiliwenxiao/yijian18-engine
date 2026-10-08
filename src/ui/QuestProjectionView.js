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

const clone = value => value === undefined ? undefined : structuredClone(value);
const freeze = value => Object.freeze(clone(value));
const list = value => Array.isArray(value) ? value : [];

function questValues(projection) {
  const value = projection?.value;
  if (Array.isArray(value?.quests)) return value.quests;
  if (Array.isArray(value?.runtimes)) return value.runtimes;
  if (value?.quest) return [value.quest];
  return [];
}

/** ProjectionStore 的任务只读视图；不持有或回写 QuestRuntimeState。 */
export class QuestProjectionView {
  constructor({ projectionStore, projectionType = 'questRuntime', projectionId } = {}) {
    if (!projectionStore || typeof projectionStore.get !== 'function' || typeof projectionStore.list !== 'function') {
      throw new TypeError('QuestProjectionView requires ProjectionStore');
    }
    this.projectionStore = projectionStore;
    this.projectionType = projectionType;
    this.projectionId = projectionId || null;
  }

  projection() {
    return this.projectionId ? this.projectionStore.get(this.projectionType, this.projectionId)
      : this.projectionStore.list(this.projectionType)[0] || null;
  }

  all() { return freeze(questValues(this.projection())); }
  get(questId) { return this.all().find(quest => quest.id === questId || quest.definitionId === questId) || null; }
  active() { return freeze(this.all().filter(quest => quest.state === 'active' || quest.state === 'completed')); }
  tracked() { return freeze(this.active().filter(quest => quest.tracked === true || quest.tracking === true)); }
  completed() { return freeze(this.all().filter(quest => quest.state === 'turned_in')); }
}

/** UI 只可构造标准任务意图，不能直接调用 QuestTransactionService。 */
export class QuestIntentClient {
  constructor({ commandGateway, actorRef, operationIdFactory = null } = {}) {
    if (!commandGateway || typeof commandGateway.execute !== 'function') throw new TypeError('QuestIntentClient requires CommandGateway');
    if (!actorRef) throw new TypeError('QuestIntentClient requires actorRef');
    this.commandGateway = commandGateway;
    this.actorRef = actorRef;
    this.operationIdFactory = operationIdFactory;
  }

  send(operation, questId, payload = {}, options = {}) {
    if (!['accept', 'advance', 'abandon', 'turnIn', 'track'].includes(operation)) throw new TypeError(`不支持的 quest intent: ${operation}`);
    return this.commandGateway.execute({
      intentType: 'quest.command', actorRef: this.actorRef,
      ...(options.operationId || !this.operationIdFactory ? {} : { operationId: this.operationIdFactory(operation, questId) }),
      ...(options.operationId ? { operationId: options.operationId } : {}),
      ...(options.expectedStateRevision === undefined ? {} : { expectedStateRevision: options.expectedStateRevision }),
      payload: { ...clone(payload), operation, questId }
    }, options);
  }

  accept(questId, options) { return this.send('accept', questId, {}, options); }
  advance(questId, signal, options) { return this.send('advance', questId, { signal }, options); }
  abandon(questId, options) { return this.send('abandon', questId, {}, options); }
  turnIn(questId, options) { return this.send('turnIn', questId, {}, options); }
  track(questId, tracking, options) { return this.send('track', questId, { tracking }, options); }
}

/** Tracker、NPC marker 和 HUD 均只从同一不可变任务视图派生。 */
export class QuestTracker {
  constructor(view) { this.view = view; }
  items() { return this.view.tracked(); }
}
export class QuestNpcMarker {
  constructor(view) { this.view = view; }
  markerFor(npcId) {
    const quests = this.view.all();
    if (quests.some(quest => quest.turnInNPCId === npcId && quest.state === 'completed')) return 'completable';
    if (quests.some(quest => quest.giverNPCId === npcId && quest.state === 'available')) return 'available';
    return null;
  }
}
export class QuestHud {
  constructor(view) { this.view = view; }
  items() { return this.view.active(); }
}

export default QuestProjectionView;

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

import { cloneCanonicalValue } from '../core/CanonicalSnapshot.js';

const clone = value => value == null ? value : cloneCanonicalValue(value);
const hasPath = (value, path) => path.split('.').every((part, index, parts) => {
  if (value == null || !Object.prototype.hasOwnProperty.call(value, part)) return false;
  value = value[part];
  return index === parts.length - 1 || value != null;
});
const getPath = (value, path, fallback = undefined) => {
  for (const part of String(path || '').split('.').filter(Boolean)) {
    if (value == null || !Object.prototype.hasOwnProperty.call(value, part)) return fallback;
    value = value[part];
  }
  return value === undefined ? fallback : value;
};
const setPath = (value, path, next) => {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return next;
  let cursor = value;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {};
  cursor[parts.at(-1)] = next;
  return value;
};

function rejected(command, code, message = code) {
  return { ok: false, operationId: command.operationId, status: 'rejected', committed: false,
    code, stateId: null, stateRevision: null, eventFrom: null, eventTo: null, value: null, error: { message } };
}

/**
 * Interprets immutable canonical command definitions. The vocabulary is intentionally generic:
 * guarded state patches, inventory mutations, checkpoint, travel, and delayed-result scheduling.
 * Content only supplies stable definition IDs and data; no scene/content handler is registered here.
 */
export class CanonicalStateTransactionService {
  constructor({ definitionRepository, getBlackboard, getInventory = () => null, inventoryTransactions = null,
    getItem = () => null, checkpoint = async () => ({ ok: true }), travel = async () => ({ ok: true }),
    executeScenarioCommand = null, tutorialComplete = () => true, stateId = 'canonical:state' } = {}) {
    if (!definitionRepository?.get) throw new TypeError('CanonicalStateTransactionService requires DefinitionRepository');
    if (typeof getBlackboard !== 'function') throw new TypeError('CanonicalStateTransactionService requires getBlackboard');
    this.definitionRepository = definitionRepository;
    this.getBlackboard = getBlackboard;
    this.getInventory = getInventory;
    this.inventoryTransactions = inventoryTransactions;
    this.getItem = getItem;
    this.executeScenarioCommand = typeof executeScenarioCommand === 'function' ? executeScenarioCommand : null;
    this.checkpoint = checkpoint;
    this.travel = travel;
    this.tutorialComplete = tutorialComplete;
    this.stateType = 'canonicalState';
    this.stateId = typeof stateId === 'function' ? stateId : () => stateId;
  }

  _definition(id) {
    const definition = this.definitionRepository.get('commands', id);
    if (!definition?.transaction || definition.commandType !== 'state.transaction') {
      throw Object.assign(new Error(`Unknown canonical transaction: ${String(id)}`), { code: 'unknownTransactionDefinition' });
    }
    return definition;
  }

  _environment(blackboard, payload, context) {
    const cityStates = clone(blackboard.get('cityStates') || []);
    return { payload: clone(payload), story: clone(blackboard.get('storyState') || {}), cityStates,
      blackboard: clone(blackboard.serialize?.() || {}), rng: context.rng, event: null };
  }

  _value(spec, env) {
    if (Array.isArray(spec)) return spec.map(value => this._value(value, env));
    if (!spec || typeof spec !== 'object') return spec;
    if ('$get' in spec) return clone(getPath(env, spec.$get, spec.default));
    if ('$add' in spec) return spec.$add.reduce((sum, value) => sum + Number(this._value(value, env) || 0), 0);
    if ('$max' in spec) return Math.max(...spec.$max.map(value => Number(this._value(value, env) || 0)));
    if ('$min' in spec) return Math.min(...spec.$min.map(value => Number(this._value(value, env) || 0)));
    if ('$eq' in spec) return this._value(spec.$eq[0], env) === this._value(spec.$eq[1], env);
    if ('$if' in spec) return this._value(spec.$if[0], env) ? this._value(spec.$if[1], env) : this._value(spec.$if[2], env);
    if ('$chance' in spec) return env.rng.chance(Number(this._value(spec.$chance, env)));
    if ('$merge' in spec) return Object.assign({}, ...spec.$merge.map(value => this._value(value, env)));
    if ('$concat' in spec) return spec.$concat.flatMap(value => this._value(value, env) || []);
    if ('$appendUnique' in spec) {
      const values = this._value(spec.$appendUnique.values, env) || [];
      return [...new Set([...(this._value(spec.$appendUnique.source, env) || []), ...values])];
    }
    return Object.fromEntries(Object.entries(spec).map(([key, value]) => [key, this._value(value, env)]));
  }

  _matches(rule, env) {
    if (!rule) return true;
    if (Array.isArray(rule.all)) return rule.all.every(entry => this._matches(entry, env));
    if (Array.isArray(rule.any)) return rule.any.some(entry => this._matches(entry, env));
    if (rule.not) return !this._matches(rule.not, env);
    if (rule.path) {
      const exists = hasPath(env, rule.path);
      const value = getPath(env, rule.path);
      if (rule.exists !== undefined && exists !== rule.exists) return false;
      if (rule.equals !== undefined && value !== this._value(rule.equals, env)) return false;
      if (rule.gte !== undefined && Number(value) < Number(this._value(rule.gte, env))) return false;
      if (rule.lte !== undefined && Number(value) > Number(this._value(rule.lte, env))) return false;
    }
    if (rule.tutorials && !rule.tutorials.every(id => this.tutorialComplete(id))) return false;
    if (rule.inventory) {
      const inventory = this.getInventory();
      if (rule.inventory.itemId && (inventory?.getItemCount?.(rule.inventory.itemId) || 0) < Number(rule.inventory.quantity || 1)) return false;
      if (rule.inventory.toolType && !(inventory?.slots || []).some(stack => stack?.item?.toolType === rule.inventory.toolType && Number(stack.item.durability) > 0)) return false;
    }
    return true;
  }

  _applyWrite(write, env) {
    const target = write.target || 'story';
    const path = write.path || '';
    const value = this._value(write.value, env);
    if (target === 'story') setPath(env.story, path, value);
    else if (target === 'blackboard') setPath(env.blackboard, path, value);
    else if (target === 'city') {
      const city = env.cityStates.find(entry => entry?.id === this._value(write.cityId, env));
      if (!city) throw Object.assign(new Error('canonical city reference is missing'), { code: 'cityMissing' });
      setPath(city, path, value);
    } else throw Object.assign(new Error(`unsupported state target: ${target}`), { code: 'invalidTransactionTarget' });
  }

  _writes(transaction, env) {
    const selector = transaction.selector ? this._value(transaction.selector, env) : null;
    let variant = selector == null ? null : transaction.variants?.[selector];
    if (transaction.when && !this._matches(transaction.when, env)) throw Object.assign(new Error('canonical transaction precondition failed'), { code: 'preconditionFailed' });
    if (variant?.when && !this._matches(variant.when, env)) {
      if (!variant.onPreconditionFailed) {
        throw Object.assign(new Error('canonical transaction variant precondition failed'), { code: 'preconditionFailed' });
      }
      variant = variant.onPreconditionFailed;
    }
    for (const write of [...(transaction.writes || []), ...(variant?.writes || [])]) this._applyWrite(write, env);
    return variant || {};
  }

  async execute(command, context) {
    let definition;
    try {
      definition = this._definition(command.payload.definitionId);
      const delegateId = definition.transaction.variantDefinitions?.[getPath(command.payload, 'event.choiceId')];
      if (delegateId) definition = this._definition(delegateId);
    } catch (error) { return rejected(command, error.code || 'invalidTransaction', error.message); }
    const transaction = definition.transaction;
    const blackboard = this.getBlackboard();
    const inventory = this.getInventory(command.actorId);
    if (!blackboard) return rejected(command, 'blackboardUnavailable');
    const beforeBoard = clone(blackboard.serialize?.() || {});
    const beforeInventory = inventory?.exportItems?.();
    const env = this._environment(blackboard, command.payload || {}, context);
    let inventoryOperation = null;
    let addedItems = [];
    try {
      const delayed = transaction.delayed;
      if (delayed) {
        const events = getPath(env.story, delayed.path || 'delayedConsequences', []);
        const currentDay = Number(getPath(env, delayed.currentDayPath || 'story.currentDay', 0));
        env.event = Array.isArray(events) ? events.find(event => event?.status === 'pending' && Number(event?.[delayed.dueField || 'dueDay']) <= currentDay) : null;
        if (!env.event) throw Object.assign(new Error('no delayed transaction is due'), { code: 'noDelayedTransactionDue' });
      }
      const variant = this._writes(transaction, env);
      const checkpointSpec = variant.checkpoint || transaction.checkpoint;
      const travelSpec = variant.travel || transaction.travel;
      if (checkpointSpec && travelSpec) {
        throw Object.assign(
          new Error('checkpoint and travel require a composite transaction participant'),
          { code: 'atomicActionCompositionUnsupported' }
        );
      }
      if (delayed) {
        const path = delayed.path || 'delayedConsequences';
        const outcome = this._value(variant.outcome ?? delayed.outcome ?? 'completed', env);
        const events = getPath(env.story, path, []);
        setPath(env.story, path, events.map(event => event?.id === env.event.id
          ? { ...event, status: 'completed', completedDay: getPath(env, delayed.currentDayPath || 'story.currentDay', 0), outcome }
          : event));
      }
      const inventorySpec = variant.inventory || transaction.inventory;
      if (inventorySpec) {
        if (!this.inventoryTransactions || !inventory) throw Object.assign(new Error('inventory transaction service unavailable'), { code: 'inventoryUnavailable' });
        if (inventorySpec.type === 'batchExchange') {
          const removeEntries = this._value(inventorySpec.removeEntries || [], env)
            .map(entry => ({ itemId: entry.itemId, quantity: entry.quantity }));
          const addEntries = this._value(inventorySpec.addEntries || [], env)
            .map(entry => ({
              item: { ...this.getItem(entry.itemId), ...(entry.item || {}) },
              quantity: entry.quantity
            }));
          inventoryOperation = this.inventoryTransactions.commit({
            type: 'batchExchange', inventory, removeEntries, addEntries,
            operationId: `${command.operationId}:inventory`
          });
          if (inventoryOperation.ok && inventoryOperation.idempotent !== true) {
            addedItems = addEntries.map(entry => ({ item: clone(entry.item), quantity: entry.quantity }));
          }
        } else {
          const entries = this._value(inventorySpec.entries || [], env).map(entry => inventorySpec.type === 'batchAdd'
            ? { item: { ...this.getItem(entry.itemId), ...(entry.item || {}) }, quantity: entry.quantity }
            : { itemId: entry.itemId, quantity: entry.quantity });
          inventoryOperation = this.inventoryTransactions.commit({ type: inventorySpec.type, inventory, entries,
            allowPartial: false, operationId: `${command.operationId}:inventory` });
          if (inventorySpec.type === 'batchAdd' && inventoryOperation.ok && inventoryOperation.idempotent !== true) {
            addedItems = (inventoryOperation.entries || []).map(entry => ({
              item: clone(entry.item),
              quantity: entry.accepted
            }));
          }
        }
        if (!inventoryOperation.ok) throw Object.assign(new Error(inventoryOperation.code), { code: inventoryOperation.code });
      }
      blackboard.set('storyState', env.story);
      blackboard.set('cityStates', env.cityStates);
      for (const [key, value] of Object.entries(env.blackboard)) {
        if (key !== 'storyState' && key !== 'cityStates') blackboard.set(key, value);
      }
      if (checkpointSpec) {
        const checkpointPayload = this._value(checkpointSpec, env);
        const saved = this.executeScenarioCommand
          ? await this.executeScenarioCommand('checkpoint.request', checkpointPayload, command)
          : await this.checkpoint(checkpointPayload, command);
        if (!saved?.ok) throw Object.assign(new Error(saved?.code || 'checkpointFailed'), { code: saved?.code || 'checkpointFailed' });
      }
      const travelPayload = travelSpec ? this._value(travelSpec, env) : null;
      const travelResult = travelPayload
        ? (this.executeScenarioCommand
          ? await this.executeScenarioCommand('world.teleport', travelPayload, command)
          : await this.travel(travelPayload, command))
        : null;
      if (travelPayload && !travelResult?.ok) {
        throw Object.assign(
          new Error(travelResult?.code || 'travelFailed'),
          { code: travelResult?.code || 'travelFailed' }
        );
      }
      const revision = context.commitStateRevision(context.preparedStateRevision);
      if (!revision.ok) throw Object.assign(new Error(revision.code), { code: revision.code });
      const value = { definitionId: definition.id, inventory: inventoryOperation, travel: travelResult, state: { story: env.story, cityStates: env.cityStates } };
      const stateId = context.preparedStateRevision.stateId;
      const result = { ok: true, operationId: command.operationId, status: 'committed', committed: true, code: null,
        stateId, stateRevision: revision.stateRevision, eventFrom: null, eventTo: null, value, error: null };
      const base = { stateId, stateType: this.stateType, stateRevision: revision.stateRevision };
      const itemGainEvents = addedItems
        .filter(entry => entry?.item?.id && Number(entry.quantity) > 0)
        .map((entry, index) => {
          const item = clone(entry.item);
          const definitionId = item.definitionId || item.id;
          const quantity = Math.max(1, Math.floor(Number(entry.quantity) || 1));
          return {
            ...base,
            type: 'item.gained',
            payload: {
              source: 'state.transaction',
              sourceDefinitionId: definition.id,
              gainIndex: index,
              definitionId,
              itemId: item.id || definitionId,
              quantity,
              item: { ...item, definitionId, quantity }
            }
          };
        });
      return {
        result,
        committedEvents: [{ ...base, type: 'state.transaction.committed', payload: value }],
        applicationEvents: [
          { ...base, type: 'state.transaction', payload: value },
          ...itemGainEvents
        ]
      };
    } catch (error) {
      if (beforeInventory && inventory?.loadItems) inventory.loadItems(beforeInventory);
      if (inventoryOperation) this.inventoryTransactions?.forgetOperation?.(`${command.operationId}:inventory`);
      blackboard.deserialize?.(beforeBoard);
      return rejected(command, error.code || 'transactionFailed', error.message);
    }
  }
}

export default CanonicalStateTransactionService;

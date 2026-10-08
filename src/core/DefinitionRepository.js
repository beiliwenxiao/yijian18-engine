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

import { cloneCanonicalValue, deepFreeze } from './CanonicalSnapshot.js';
import { DEFAULT_TRIGGER_ACTION_IDS } from '../systems/TriggerActions.js';
import { createStandardCapabilityStrategyRegistry } from '../systems/items/CapabilityStrategyRegistry.js';
import { ValidationCode, makeError } from './validation/ValidationError.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];

export class DefinitionRepositoryValidationError extends Error {
  constructor(errors) {
    super(`DefinitionRepository: ${errors.length} definition validation error(s)`);
    this.name = 'DefinitionRepositoryValidationError';
    this.errors = errors;
  }
}

function catalogEntries(catalog) {
  if (Array.isArray(catalog)) {
    return catalog.map(value => [typeof value === 'string' ? value : value?.id, value]);
  }
  if (isObject(catalog)) return Object.entries(catalog);
  return [];
}

function catalogIndex(catalog) {
  const result = Object.create(null);
  for (const [id, descriptor] of catalogEntries(catalog)) {
    if (typeof id === 'string' && id.trim()) result[id] = descriptor;
  }
  return result;
}

function capabilityList(definition) {
  if (Array.isArray(definition?.capabilities)) return definition.capabilities;
  if (!isObject(definition?.capabilities)) return [];
  return Object.entries(definition.capabilities).map(([id, value]) => ({
    id,
    ...(isObject(value) ? value : { parameters: value })
  }));
}

function matchesType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function validateParameters(parameters, schema, path, errors) {
  if (parameters === undefined) return;
  if (!isObject(parameters)) {
    errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, 'capability/strategy parameters 必须为对象'));
    return;
  }
  if (!isObject(schema)) return;
  const fields = isObject(schema.fields) ? schema.fields : schema;
  for (const [name, rule] of Object.entries(fields)) {
    if (!isObject(rule)) continue;
    const fieldPath = `${path}.${name}`;
    const present = Object.prototype.hasOwnProperty.call(parameters, name);
    if (!present) {
      if (rule.required === true) errors.push(makeError(ValidationCode.MISSING_FIELD, fieldPath, `缺少参数 ${name}`));
      continue;
    }
    const value = parameters[name];
    if (rule.nullable === true && value === null) continue;
    if (rule.type && !matchesType(value, rule.type)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, fieldPath, `参数 ${name} 类型无效`));
      continue;
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, fieldPath, `参数 ${name} 不在允许范围内`));
    }
    if (typeof value === 'number' && ((rule.min != null && value < rule.min) || (rule.max != null && value > rule.max))) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, fieldPath, `参数 ${name} 超出范围`));
    }
  }
}

function addReferenceError(indexes, targetKind, id, path, errors) {
  if (typeof id === 'string' && indexes[targetKind]?.[id]) return;
  errors.push(makeError(ValidationCode.INVALID_REFERENCE, path, `悬空引用 ${targetKind}:${String(id)}`));
}

function validateReferenceArray(indexes, targetKind, values, path, errors) {
  list(values).forEach((id, index) => addReferenceError(indexes, targetKind, id, `${path}[${index}]`, errors));
}

function validateKnownReferences(indexes, errors, actionIds) {
  for (const [index, definition] of Object.values(indexes.resourceNodes || {}).entries()) {
    if (Object.prototype.hasOwnProperty.call(definition, 'itemId')) {
      addReferenceError(indexes, 'items', definition.itemId, `library.resourceNodes[${index}].itemId`, errors);
    }
  }
  for (const [index, definition] of Object.values(indexes.quests || {}).entries()) {
    const path = `quests[${index}]`;
    validateReferenceArray(indexes, 'quests', definition.prerequisites, `${path}.prerequisites`, errors);
    validateReferenceArray(indexes, 'triggers', definition.triggerRefs, `${path}.triggerRefs`, errors);
    validateReferenceArray(indexes, 'dialogues', definition.dialogueRefs, `${path}.dialogueRefs`, errors);
    validateReferenceArray(indexes, 'scenes', definition.sceneRefs, `${path}.sceneRefs`, errors);
  }
  for (const [index, definition] of Object.values(indexes.scenarios || {}).entries()) {
    const path = `scenarios[${index}]`;
    validateReferenceArray(indexes, 'triggers', definition.triggerRefs, `${path}.triggerRefs`, errors);
    validateReferenceArray(indexes, 'quests', definition.questRefs, `${path}.questRefs`, errors);
    validateReferenceArray(indexes, 'dialogues', definition.dialogueRefs, `${path}.dialogueRefs`, errors);
    validateReferenceArray(indexes, 'scenes', definition.sceneRefs, `${path}.sceneRefs`, errors);
    validateReferenceArray(indexes, 'commands', definition.commandRefs, `${path}.commandRefs`, errors);
    validateReferenceArray(indexes, 'scenarios', definition.scenarioRefs, `${path}.scenarioRefs`, errors);
    validateReferenceArray(indexes, 'triggers', definition.entryTriggerRefs, `${path}.entryTriggerRefs`, errors);
    validateReferenceArray(indexes, 'triggers', definition.exitTriggerRefs, `${path}.exitTriggerRefs`, errors);
  }
  for (const [kind, definitions] of Object.entries(indexes)) {
    for (const definition of Object.values(definitions)) {
      list(definition.definitionRefs).forEach((ref, index) => {
        if (!isObject(ref)) return;
        addReferenceError(indexes, ref.kind, ref.id, `${kind}.${definition.id}.definitionRefs[${index}]`, errors);
      });
      for (const [targetKind, ids] of Object.entries(isObject(definition.refs) ? definition.refs : {})) {
        validateReferenceArray(indexes, targetKind, Array.isArray(ids) ? ids : [ids], `${kind}.${definition.id}.refs.${targetKind}`, errors);
      }
    }
  }
  const standardActionReferences = {
    'rescue.command': ['rescueId', 'rescues'],
    'battle.command': ['battleId', 'battles'],
    'construction.command': ['definitionId', 'constructions'],
    'vehicle.command': ['vehicleId', 'vehicles'],
    'quest.command': ['questId', 'quests'],
    'world.teleport': ['sceneId', 'scenes'],
    'ending.command': ['endingId', 'endings'],
    'dialogue.command': ['dialogueId', 'dialogues'],
    'tutorial.command': ['tutorialId', 'tutorials'],
    'state.transaction': ['definitionId', 'commands']
  };
  for (const [kind, definitions] of Object.entries(indexes)) {
    for (const definition of Object.values(definitions)) {
      const actionLists = kind === 'triggers' ? list(definition.do) : [];
      actionLists.forEach((action, index) => {
        if (typeof action?.action !== 'string' || !actionIds.has(action.action)) {
          errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${kind}.${definition.id}.do[${index}].action`, `未知 action: ${String(action?.action)}`));
          return;
        }
        const contract = standardActionReferences[action.action];
        if (!contract) return;
        const [field, targetKind] = contract;
        if (!indexes[targetKind]) return;
        addReferenceError(indexes, targetKind, action?.params?.[field], `${kind}.${definition.id}.do[${index}].params.${field}`, errors);
      });
    }
  }
}

export class DefinitionRevisionLock {
  constructor(repository) {
    this.definitionRevision = repository.revision;
    this.repository = repository;
    Object.freeze(this);
  }

  get(kind, id) { return this.repository.get(kind, id); }
  has(kind, id) { return this.repository.has(kind, id); }
}

/** 由单个 CanonicalSnapshot 派生的只读定义索引。 */
export class DefinitionRepository {
  constructor(snapshot, indexes) {
    this.snapshot = snapshot;
    this.revision = snapshot.definitionRevision ?? snapshot.revision;
    this.definitionRevision = this.revision;
    this._indexes = indexes;
    Object.freeze(this);
  }

  static empty(revision = 0) {
    return new DefinitionRepository(Object.freeze({ revision, definitionRevision: revision }), Object.freeze(Object.create(null)));
  }

  static fromSnapshot(snapshot, options = {}) {
    if (!snapshot || !isObject(snapshot.definitions)) throw new TypeError('DefinitionRepository.fromSnapshot requires CanonicalSnapshot');
    const errors = [];
    const indexes = Object.create(null);
    const occurrences = new Map();
    const policy = snapshot.project?.definitionPolicy || {};
    const globallyUniqueKinds = new Set([
      ...list(policy.globalUniqueKinds),
      ...list(options.globalUniqueKinds)
    ]);
    const allKindsGlobal = policy.globalUnique === true || options.globalUnique === true;

    for (const [kind, definitions] of Object.entries(snapshot.definitions)) {
      const index = Object.create(null);
      list(definitions).forEach((rawDefinition, position) => {
        const path = `${kind}[${position}].id`;
        const id = rawDefinition?.id;
        if (typeof id !== 'string' || !id.trim()) {
          errors.push(makeError(ValidationCode.MISSING_FIELD, path, `定义缺少非空稳定 id (${kind})`));
          return;
        }
        if (Object.prototype.hasOwnProperty.call(index, id)) {
          errors.push(makeError(ValidationCode.DUPLICATE_ID, path, `同 kind 重复定义: ${kind}:${id}`));
          return;
        }
        const definition = deepFreeze(cloneCanonicalValue(rawDefinition));
        index[id] = definition;
        const entries = occurrences.get(id) || [];
        entries.push({ kind, path, global: allKindsGlobal || globallyUniqueKinds.has(kind) || definition.globalUnique === true });
        occurrences.set(id, entries);
      });
      indexes[kind] = index;
    }

    for (const [id, entries] of occurrences) {
      const kinds = new Set(entries.map(entry => entry.kind));
      if (kinds.size > 1 && entries.some(entry => entry.global)) {
        entries.slice(1).forEach(entry => errors.push(makeError(
          ValidationCode.DUPLICATE_ID,
          entry.path,
          `声明为全局唯一的定义跨 kind 冲突: ${id}`
        )));
      }
    }

    const capabilityCatalog = catalogIndex(snapshot.project?.capabilityCatalog);
    const strategyCatalog = catalogIndex(snapshot.project?.strategyCatalog);
    const capabilityStrategyRegistry = options.capabilityStrategyRegistry || createStandardCapabilityStrategyRegistry();
    for (const [kind, index] of Object.entries(indexes)) {
      for (const definition of Object.values(index)) {
        capabilityList(definition).forEach((capability, position) => {
          const id = typeof capability === 'string' ? capability : capability?.capabilityId || capability?.id;
          const strategyId = isObject(capability) ? capability.strategyId : null;
          const path = `${kind}.${definition.id}.capabilities[${position}]`;
          const builtInStrategy = capabilityStrategyRegistry.find(id, strategyId);
          if (!builtInStrategy && !Object.prototype.hasOwnProperty.call(capabilityCatalog, id)) {
            errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${path}.id`, `未知 capability: ${String(id)}`));
          }
          if (strategyId && !builtInStrategy && !Object.prototype.hasOwnProperty.call(strategyCatalog, strategyId)) {
            errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${path}.strategyId`, `未知 strategy: ${strategyId}`));
          }
          const descriptor = builtInStrategy || (strategyId ? strategyCatalog[strategyId] : capabilityCatalog[id]);
          const schema = isObject(descriptor) ? descriptor.parametersSchema || descriptor.paramsSchema : null;
          validateParameters(isObject(capability) ? capability.parameters : undefined, schema, `${path}.parameters`, errors);
        });
        if (kind === 'items' && capabilityList(definition).length > 0) {
          errors.push(...capabilityStrategyRegistry.validateDefinition(definition, {
            path: `${kind}.${definition.id}`,
            hasDefinition: (targetKind, targetId) => Boolean(indexes[targetKind]?.[targetId]),
            allowUnknownStrategies: true
          }));
        }
      }
    }

    const actionIds = new Set(DEFAULT_TRIGGER_ACTION_IDS);
    for (const action of list(snapshot.project?.triggerCatalog?.actions)) {
      const id = typeof action === 'string' ? action : action?.id || action?.value;
      if (id) actionIds.add(id);
    }
    for (const id of Object.keys(indexes.actions || {})) actionIds.add(id);
    validateKnownReferences(indexes, errors, actionIds);

    if (errors.length > 0) throw new DefinitionRepositoryValidationError(errors);
    for (const index of Object.values(indexes)) deepFreeze(index);
    return new DefinitionRepository(snapshot, deepFreeze(indexes));
  }

  get(kind, id) { return this._indexes[kind]?.[id] || null; }
  has(kind, id) { return Object.prototype.hasOwnProperty.call(this._indexes[kind] || {}, id); }
  all(kind) { return Object.freeze(Object.values(this._indexes[kind] || {})); }
  ids(kind) { return Object.freeze(Object.keys(this._indexes[kind] || {})); }
  kinds() { return Object.freeze(Object.keys(this._indexes)); }
  size(kind) { return Object.keys(this._indexes[kind] || {}).length; }
  lockRevision() { return new DefinitionRevisionLock(this); }
}

export default DefinitionRepository;

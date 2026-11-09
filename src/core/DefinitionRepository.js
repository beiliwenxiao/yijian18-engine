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

/** 递归收集触发步骤（branch[] 分支容器是一等步骤类型：展开每条子路径的 do 动作）。 */
function collectActionSteps(steps) {
  const actionSteps = [];
  const walk = candidates => {
    for (const step of candidates) {
      if (Array.isArray(step?.branch)) {
        step.branch.forEach(alternative => walk(list(alternative?.do)));
        continue;
      }
      actionSteps.push(step);
    }
  };
  walk(list(steps));
  return actionSteps;
}

/** 收集对话定义全部选项 id（跨所有节点；触发器 choiceId 声明校验用）。 */
function collectDialogueChoiceIds(definition) {
  const ids = new Set();
  const nodes = isObject(definition?.nodes) ? definition.nodes : {};
  for (const node of Object.values(nodes)) {
    for (const choice of list(node?.choices)) {
      if (typeof choice?.id === 'string' && choice.id) ids.add(choice.id);
    }
  }
  return ids;
}

/**
 * 收集对话启动来源（孤儿对话告警用）：触发器 startDialogue / dialogue.command(start)
 * 步骤 + quest 步骤 dialogueId（编译触发器运行时注册、不在 snapshot 里，须扫 quest 原定义）
 * + quest/scenario 的 dialogueRefs。值为首个来源路径，便于告警定位。
 */
function collectDialogueStartSources(indexes) {
  const sources = new Map();
  const mark = (id, path) => {
    if (typeof id !== 'string' || !id || sources.has(id)) return;
    sources.set(id, path);
  };
  for (const definition of Object.values(indexes.triggers || {})) {
    collectActionSteps(list(definition?.do)).forEach((action, index) => {
      const base = `triggers.${definition.id}.do[${index}]`;
      if (action?.action === 'startDialogue') mark(action?.params?.id, `${base}.params.id`);
      if (action?.action === 'dialogue.command') {
        const operation = action?.params?.operation;
        if (!operation || operation === 'start') mark(action?.params?.dialogueId, `${base}.params.dialogueId`);
      }
    });
  }
  for (const quest of Object.values(indexes.quests || {})) {
    list(quest?.dialogueRefs).forEach((id, index) => mark(id, `quests.${quest.id}.dialogueRefs[${index}]`));
    list(quest?.steps).forEach((step, index) => {
      if (step?.type === 'dialogue') mark(step?.dialogueId, `quests.${quest.id}.steps[${index}].dialogueId`);
    });
  }
  for (const scenario of Object.values(indexes.scenarios || {})) {
    list(scenario?.dialogueRefs).forEach((id, index) => mark(id, `scenarios.${scenario.id}.dialogueRefs[${index}]`));
  }
  return sources;
}

/**
 * 对话图静态校验（接线完整性，2026-11-03 乞讨链断链事故沉淀）：
 * - 错误（阻断）：对话内节点引用悬空（choice/node nextNode、startNode）、
 *   dialogueChoice/dialogueEnd 触发器引用不存在的对话、声明的 choiceId 不属于该对话任何选项；
 * - 告警（不阻断，经 repository.warnings 浮出）：孤儿对话（无任何启动来源）、
 *   多选项对话的 dialogueChoice 触发器未声明 choiceId（将对所有选项生效——2026-10-29 乞讨链
 *   摇头误扣野果即此类）；被引擎代码直接启动的对话在定义上声明 runtimeStarted: true 豁免。
 */
function validateDialogueGraph(indexes, errors, warnings) {
  const dialogues = indexes.dialogues;
  if (!dialogues) return;
  const startedBy = collectDialogueStartSources(indexes);
  for (const definition of Object.values(dialogues)) {
    const basePath = `dialogues.${definition.id}`;
    const nodes = isObject(definition.nodes) ? definition.nodes : {};
    if (typeof definition.startNode === 'string' && definition.startNode && !nodes[definition.startNode]) {
      errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${basePath}.startNode`, `startNode 指向不存在的节点: ${definition.startNode}`));
    }
    for (const [nodeId, node] of Object.entries(nodes)) {
      const nodePath = `${basePath}.nodes.${nodeId}`;
      if (typeof node?.nextNode === 'string' && node.nextNode && !nodes[node.nextNode]) {
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${nodePath}.nextNode`, `节点 nextNode 指向不存在的节点: ${node.nextNode}`));
      }
      list(node?.choices).forEach((choice, index) => {
        if (typeof choice?.nextNode === 'string' && choice.nextNode && !nodes[choice.nextNode]) {
          errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${nodePath}.choices[${index}].nextNode`, `选项 nextNode 指向不存在的节点: ${choice.nextNode}`));
        }
      });
    }
    if (definition.runtimeStarted !== true && !startedBy.has(definition.id)) {
      warnings.push(makeError(ValidationCode.UNREACHABLE_DIALOGUE, basePath,
        '对话无任何启动来源（startDialogue/dialogue.command/quest 步骤/dialogueRefs）；若由引擎代码直接启动，请在对话定义上声明 runtimeStarted: true'));
    }
  }
  for (const definition of Object.values(indexes.triggers || {})) {
    const when = definition?.when;
    const type = when?.type;
    if (type !== 'dialogueChoice' && type !== 'dialogueEnd') continue;
    const dialogueId = when?.params?.id;
    const idPath = `triggers.${definition.id}.when.params.id`;
    if (typeof dialogueId !== 'string' || !dialogueId) {
      warnings.push(makeError(ValidationCode.MISSING_FIELD, idPath, `${type} 触发器未声明对话 id（when.params.id），将对所有对话生效`));
      continue;
    }
    const dialogue = dialogues[dialogueId];
    if (!dialogue) {
      errors.push(makeError(ValidationCode.INVALID_REFERENCE, idPath, `悬空引用 dialogues:${dialogueId}`));
      continue;
    }
    if (type !== 'dialogueChoice') continue;
    const choiceIds = collectDialogueChoiceIds(dialogue);
    const declared = when?.params?.choiceId;
    if (typeof declared !== 'string' || !declared) {
      if (choiceIds.size > 0) {
        warnings.push(makeError(ValidationCode.UNFILTERED_DIALOGUE_CHOICE, `triggers.${definition.id}.when.params.choiceId`,
          `对话 ${dialogueId} 存在选项但触发器未声明 choiceId，将对所有选项生效；有副作用的选项请按 choiceId 过滤`));
      }
      continue;
    }
    if (!choiceIds.has(declared)) {
      errors.push(makeError(ValidationCode.INVALID_REFERENCE, `triggers.${definition.id}.when.params.choiceId`,
        `choiceId 不属于对话 ${dialogueId} 的任何选项: ${declared}`));
    }
  }
}

function validateKnownReferences(indexes, errors, actionIds, warnings = []) {
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
    'startDialogue': ['id', 'dialogues'],
    'tutorial.command': ['tutorialId', 'tutorials'],
    'state.transaction': ['definitionId', 'commands']
  };
  for (const [kind, definitions] of Object.entries(indexes)) {
    for (const definition of Object.values(definitions)) {
      const actionLists = kind === 'triggers' ? [list(definition.do)] : [];
      // branch[] 分支容器是 _runSteps 的一等步骤类型：递归校验每条子路径的 do 动作引用
      const actionSteps = collectActionSteps(actionLists.flatMap(list));
      actionSteps.forEach((action, index) => {
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
  validateDialogueGraph(indexes, errors, warnings);
  validateM0CrossReferences(indexes, warnings);
}

/**
 * M0 底座跨库引用校验（2026-11-09）——**只告警、不阻断**。
 *
 * 为什么是 warn：battles 的 formationIds/commanderHeroId 在 M0 之前就存在且从未被校验，
 * 直接改成错误会让现有战役配置加载失败；M0 的职责只是把悬空引用**暴露出来**，
 * 由 M3/M5 接线时逐条补实数（或删除多余引用）。
 *
 * 覆盖：battles → formations/heroes；formations → unitTypes/heroes；heroes → ranks。
 */
function validateM0CrossReferences(indexes, warnings) {
  const warn = (path, message) => warnings.push(makeError(ValidationCode.INVALID_REFERENCE, path, message));
  const known = (kind, id) => typeof id === 'string' && !!indexes[kind]?.[id];

  for (const [index, battle] of Object.values(indexes.battles || {}).entries()) {
    list(battle?.formationIds).forEach((id, i) => {
      if (!known('formations', id)) warn(`battles[${index}].formationIds[${i}]`, `悬空引用 formations:${String(id)}（M0 仅告警）`);
    });
    const heroId = battle?.commanderHeroId;
    if (heroId && !known('heroes', heroId)) warn(`battles[${index}].commanderHeroId`, `悬空引用 heroes:${String(heroId)}（M0 仅告警）`);
  }

  for (const [index, formation] of Object.values(indexes.formations || {}).entries()) {
    list(formation?.unitIds).forEach((id, i) => {
      if (!known('unitTypes', id)) warn(`library.formations[${index}].unitIds[${i}]`, `悬空引用 unitTypes:${String(id)}（M0 仅告警）`);
    });
    const leaderId = formation?.leaderHeroId;
    if (leaderId && !known('heroes', leaderId)) {
      warn(`library.formations[${index}].leaderHeroId`, `悬空引用 heroes:${String(leaderId)}（M0 仅告警）`);
    }
  }

  for (const [index, hero] of Object.values(indexes.heroes || {}).entries()) {
    const rankId = hero?.rankId;
    if (rankId && !known('ranks', rankId)) warn(`library.heroes[${index}].rankId`, `悬空引用 ranks:${String(rankId)}（M0 仅告警）`);
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
  constructor(snapshot, indexes, warnings = []) {
    this.snapshot = snapshot;
    this.revision = snapshot.definitionRevision ?? snapshot.revision;
    this.definitionRevision = this.revision;
    this._indexes = indexes;
    this._warnings = Object.freeze([...warnings]);
    Object.freeze(this);
  }

  /** 最近一次构建的非阻断告警（孤儿对话/未过滤选项触发器等接线问题）。 */
  get warnings() { return this._warnings; }

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
    const warnings = [];
    validateKnownReferences(indexes, errors, actionIds, warnings);

    if (errors.length > 0) throw new DefinitionRepositoryValidationError(errors);
    for (const index of Object.values(indexes)) deepFreeze(index);
    return new DefinitionRepository(snapshot, deepFreeze(indexes), warnings);
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

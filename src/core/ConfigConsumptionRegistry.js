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
import { createStandardCapabilityStrategyRegistry } from '../systems/items/CapabilityStrategyRegistry.js';
import { ValidationCode, makeError } from './validation/ValidationError.js';

const isObject = value => value !== null && typeof value === 'object';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function tokenize(path) {
  return String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

function readPath(root, path) {
  return tokenize(path).reduce((value, key) => value == null ? undefined : value[key], root);
}

function compilePattern(pattern) {
  const source = String(pattern || '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[\\\*\\\]/g, '\\[\\d+\\]')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^.\\[\\]]+')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`);
}

function leafEntries(value, prefix = '', output = []) {
  if (!isObject(value) || Object.keys(value).length === 0) {
    if (prefix) output.push({ path: prefix, value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => leafEntries(child, `${prefix}[${index}]`, output));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    leafEntries(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function normalizeProof(result, value) {
  if (result === true) return { consumed: true, value };
  if (result && result.consumed === true) return result;
  return null;
}

function materializeEntries(entries) {
  const root = {};
  for (const entry of entries) {
    const tokens = tokenize(entry.path);
    let target = root;
    tokens.forEach((key, index) => {
      if (index === tokens.length - 1) {
        target[key] = cloneCanonicalValue(entry.value);
        return;
      }
      if (!isObject(target[key])) {
        target[key] = /^\d+$/.test(tokens[index + 1]) ? [] : {};
      }
      target = target[key];
    });
  }
  return root;
}

export class ReadonlyConfigView {
  constructor(source, { revision = 0, sourceId = 'canonical' } = {}) {
    this.revision = revision;
    this.sourceId = sourceId;
    this._source = deepFreeze(cloneCanonicalValue(source || {}));
    Object.freeze(this);
  }

  get(path, fallback) {
    const value = readPath(this._source, path);
    return value === undefined ? fallback : value;
  }

  has(path) {
    return readPath(this._source, path) !== undefined;
  }

  project(paths = []) {
    const projection = {};
    for (const path of paths) {
      const value = this.get(path);
      if (value !== undefined) projection[path] = value;
    }
    return deepFreeze(projection);
  }
}

class ConfigConsumerView {
  constructor({ id, revision, entries, descriptor }) {
    this.id = id;
    this.revision = revision;
    this.descriptor = descriptor;
    this._entries = deepFreeze(cloneCanonicalValue(entries));
    this._source = new ReadonlyConfigView(materializeEntries(this._entries), { revision, sourceId: id });
    Object.freeze(this);
  }

  get(path, fallback) {
    return this._source.get(path, fallback);
  }

  entries() { return this._entries; }
  projection() { return deepFreeze(Object.fromEntries(this._entries.map(entry => [entry.path, entry.projection]))); }
}

export class ConfigConsumptionSnapshot {
  constructor({ revision = 0, consumers = [], events = [], status = [] } = {}) {
    this.revision = revision;
    this._consumers = new Map(consumers.map(consumer => [consumer.id, consumer]));
    this.events = deepFreeze(cloneCanonicalValue(events));
    this.status = deepFreeze(cloneCanonicalValue(status));
    Object.freeze(this);
  }

  static empty(revision = 0) { return new ConfigConsumptionSnapshot({ revision }); }
  getConsumer(id) { return this._consumers.get(id) || null; }
  hasConsumer(id) { return this._consumers.has(id); }
  get(id, path, fallback) { return this.getConsumer(id)?.get(path, fallback) ?? fallback; }
  listConsumers() { return Object.freeze([...this._consumers.values()]); }
}

function selectorMatches(registration, selector) {
  return ['definitionKind', 'capabilityId', 'strategyId'].every(key => (
    registration[key] === '*' || registration[key] === selector[key]
  ));
}

function capabilityEntries(snapshot, registrations = []) {
  const entries = [];
  for (const [definitionKind, definitions] of Object.entries(snapshot?.definitions || {})) {
    for (const definition of definitions || []) {
      const capabilities = Array.isArray(definition?.capabilities)
        ? definition.capabilities
        : Object.entries(definition?.capabilities || {}).map(([id, parameters]) => ({ id, parameters }));
      capabilities.forEach((capability, index) => {
        const capabilityId = typeof capability === 'string' ? capability : capability?.capabilityId || capability?.id;
        const explicitStrategyId = typeof capability === 'object' ? capability?.strategyId : null;
        const defaultStrategyId = registrations.find(registration => registration.definitionKind === definitionKind
          && registration.capabilityId === capabilityId && registration.strategyId !== '*')?.strategyId;
        const strategyId = explicitStrategyId || defaultStrategyId || capabilityId;
        entries.push({
          definitionKind, capabilityId, strategyId,
          definitionId: definition.id,
          value: capability,
          path: `${definitionKind}.${definition.id}.capabilities[${index}]`
        });
      });
    }
  }
  return entries;
}
export class ConfigConsumptionRegistry {
  constructor() {
    this._pathConsumers = [];
    this._definitionConsumers = [];
  }

  registerPath({ id, pathPattern, descriptor = {}, consume }) {
    if (!id || !pathPattern || typeof consume !== 'function') {
      throw new TypeError('path consumer requires id, pathPattern and consume');
    }
    if (this._pathConsumers.some(entry => entry.id === id && entry.pathPattern === pathPattern)) {
      throw new Error(`duplicateConfigConsumer:${id}:${pathPattern}`);
    }
    this._pathConsumers.push(deepFreeze({
      id, pathPattern, descriptor: cloneCanonicalValue(descriptor), consume, matcher: compilePattern(pathPattern)
    }));
    return this;
  }

  registerDefinition({ id, definitionKind = '*', capabilityId = '*', strategyId = '*', descriptor = {}, consume }) {
    if (!id || typeof consume !== 'function') throw new TypeError('definition consumer requires id and consume');
    const selector = { definitionKind, capabilityId, strategyId };
    const duplicate = this._definitionConsumers.some(entry => entry.id === id
      && ['definitionKind', 'capabilityId', 'strategyId'].every(key => entry[key] === selector[key]));
    if (duplicate) {
      throw new Error(`duplicateDefinitionConsumer:${id}`);
    }
    this._definitionConsumers.push(deepFreeze({ id, ...selector, descriptor: cloneCanonicalValue(descriptor), consume }));
    return this;
  }

  build(snapshot, options = {}) {
    if (!snapshot?.project) throw new TypeError('ConfigConsumptionRegistry.build requires CanonicalSnapshot');
    return this.buildSources({ project: snapshot.project }, {
      revision: snapshot.definitionRevision ?? snapshot.revision,
      snapshot,
      requirements: snapshot.project.consumptionRequirements,
      ...options
    });
  }

  buildSources(sources, { revision = 0, snapshot = null, requirements = null } = {}) {
    const entries = [];
    for (const [sourceId, source] of Object.entries(sources || {})) {
      leafEntries(source, sourceId === 'project' ? '' : sourceId, entries);
    }
    const byConsumer = new Map();
    const events = [];
    const status = [];
    const errors = [];
    const add = (registration, entry, proof) => {
      const list = byConsumer.get(registration.id) || [];
      list.push({ path: entry.path, value: entry.value, projection: proof.value });
      byConsumer.set(registration.id, list);
      const observation = {
        consumerId: registration.id,
        descriptorId: registration.descriptor.id || registration.id,
        path: entry.path,
        eventType: registration.descriptor.eventType || 'configConsumed',
        projectionType: registration.descriptor.projectionType || 'configConsumption'
      };
      events.push(observation);
      status.push({ ...observation, consumed: true });
    };

    for (const entry of entries) {
      for (const registration of this._pathConsumers) {
        if (!registration.matcher.test(entry.path)) continue;
        const proof = normalizeProof(registration.consume(entry.value, {
          path: entry.path, revision, snapshot, descriptor: registration.descriptor
        }), entry.value);
        if (!proof) {
          errors.push(makeError('configConsumptionUnproven', entry.path, `consumer ${registration.id} 无法证明消费`));
          continue;
        }
        add(registration, entry, proof);
      }
    }

    const definitionEntries = snapshot ? capabilityEntries(snapshot, this._definitionConsumers) : [];
    for (const entry of definitionEntries) {
      const matches = this._definitionConsumers.filter(registration => selectorMatches(registration, entry));
      if (matches.length === 0) {
        errors.push(makeError('configConsumerMissing', entry.path,
          `未登记 consumer: ${entry.definitionKind}+${entry.capabilityId}+${entry.strategyId}`));
        continue;
      }
      for (const registration of matches) {
        const proof = normalizeProof(registration.consume(entry.value, { ...entry, revision, snapshot }), entry.value);
        if (!proof) errors.push(makeError('configConsumptionUnproven', entry.path, `consumer ${registration.id} 无法证明消费`));
        else add(registration, entry, proof);
      }
    }

    this._validateRequirements(entries, requirements, errors);
    if (errors.length > 0) {
      const error = new Error(`ConfigConsumptionRegistry: ${errors.length} coverage error(s)`);
      error.name = 'ConfigConsumptionValidationError';
      error.errors = errors;
      throw error;
    }

    const consumers = [...byConsumer.entries()].map(([id, values]) => {
      const registration = this._pathConsumers.find(entry => entry.id === id)
        || this._definitionConsumers.find(entry => entry.id === id);
      return new ConfigConsumerView({ id, revision, entries: values, descriptor: registration.descriptor });
    });
    return new ConfigConsumptionSnapshot({ revision, consumers, events, status });
  }

  _validateRequirements(entries, requirements, errors) {
    const pathRequirements = Array.isArray(requirements) ? requirements : requirements?.paths || [];
    for (const requirement of pathRequirements) {
      const pattern = typeof requirement === 'string' ? requirement : requirement?.pathPattern;
      if (!pattern) continue;
      const matcher = compilePattern(pattern);
      const concrete = entries.filter(entry => matcher.test(entry.path));
      if (concrete.length === 0 && requirement?.required === true) {
        errors.push(makeError(ValidationCode.MISSING_FIELD, pattern, '必需消费配置不存在'));
        continue;
      }
      for (const entry of concrete) {
        const registered = this._pathConsumers.some(consumer => consumer.matcher.test(entry.path));
        if (!registered) errors.push(makeError('configConsumerMissing', entry.path, '配置未登记通用 consumer'));
      }
    }
  }
}

const observable = (id, projectionType) => ({
  id,
  eventType: 'runtimeConfigConsumed',
  projectionType
});
const passThrough = value => ({ consumed: true, value });

export function createStandardConfigConsumptionRegistry(
  capabilityStrategyRegistry = createStandardCapabilityStrategyRegistry()
) {
  const registry = new ConfigConsumptionRegistry()
    .registerPath({ id: 'runtime.weather', pathPattern: 'system.weather.**', descriptor: observable('weather', 'weatherState'), consume: passThrough })
    .registerPath({ id: 'runtime.month', pathPattern: 'variables.storyState.month', descriptor: observable('month', 'storyCalendar'), consume: passThrough })
    .registerPath({ id: 'runtime.endings', pathPattern: 'extensions.endings.**', descriptor: observable('endings', 'endingDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.skills', pathPattern: 'progression.skills.**', descriptor: observable('skills', 'skillDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.librarySkills', pathPattern: 'library.skills[*].**', descriptor: observable('librarySkills', 'skillDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.progression', pathPattern: 'progression.**', descriptor: observable('progression', 'progressionGraph'), consume: passThrough })
    .registerPath({ id: 'runtime.battle', pathPattern: 'battles[*].**', descriptor: observable('battle', 'battleDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.rescue', pathPattern: 'rescues[*].**', descriptor: observable('rescue', 'rescueDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.presentation', pathPattern: 'presentation.**', descriptor: observable('presentation', 'presentationState'), consume: passThrough })
    .registerPath({ id: 'runtime.construction', pathPattern: 'construction.**', descriptor: observable('construction', 'constructionDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.items', pathPattern: 'library.items[*].**', descriptor: observable('items', 'itemDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.equipment', pathPattern: 'library.equipment[*].**', descriptor: observable('equipment', 'equipmentDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.resourceNodes', pathPattern: 'library.resourceNodes[*].**', descriptor: observable('resourceNodes', 'resourceNodeDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.vehicles', pathPattern: 'library.vehicles[*].**', descriptor: observable('vehicles', 'vehicleDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.tutorial', pathPattern: 'tutorials[*].**', descriptor: observable('tutorial', 'tutorialDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.scenario', pathPattern: 'scenarios[*].**', descriptor: observable('scenario', 'scenarioDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.trigger', pathPattern: 'triggers[*].**', descriptor: observable('trigger', 'triggerDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.dialogue', pathPattern: 'dialogues[*].**', descriptor: observable('dialogue', 'dialogueDefinition'), consume: passThrough })
    .registerPath({ id: 'runtime.spawn', pathPattern: 'triggers[*].do[*].params.*', descriptor: observable('spawn', 'spawnPlan'), consume: passThrough })
    .registerPath({ id: 'runtime.prompt', pathPattern: 'extensions.**.steps[*].text', descriptor: observable('prompt', 'hintText'), consume: passThrough })
    .registerPath({ id: 'runtime.scene', pathPattern: 'scenes[*].**', descriptor: observable('scene', 'sceneDefinition'), consume: passThrough })
    .registerPath({ id: 'scene.gameplay', pathPattern: 'scene.gameplay.**', descriptor: observable('sceneGameplay', 'sceneGameplay'), consume: passThrough });
  for (const strategy of capabilityStrategyRegistry.entries()) {
    registry.registerDefinition({
      id: `runtime.itemCapability.${strategy.capabilityId}`,
      definitionKind: 'items',
      capabilityId: strategy.capabilityId,
      strategyId: strategy.strategyId,
      descriptor: observable(strategy.strategyId, 'itemCapabilityProjection'),
      consume: passThrough
    });
  }
  return registry;
}

export default ConfigConsumptionRegistry;

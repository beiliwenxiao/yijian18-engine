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

import { ValidationCode, makeError } from '../../core/validation/ValidationError.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const list = value => Array.isArray(value) ? value : [];

export const ITEM_CAPABILITY_IDS = Object.freeze([
  'stackable', 'consumable', 'equippable', 'throwable', 'container',
  'questBound', 'fuel', 'cargo', 'tool', 'durable', 'placeable'
]);

export function normalizeCapabilities(definition) {
  if (Array.isArray(definition?.capabilities)) {
    return definition.capabilities.map(value => typeof value === 'string' ? { id: value } : value);
  }
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
  return typeof value === type;
}

function validateParameters(parameters, fields, path, errors) {
  if (parameters === undefined) parameters = {};
  if (!isObject(parameters)) {
    errors.push(makeError(ValidationCode.TYPE_MISMATCH, path, 'capability parameters 必须为对象'));
    return;
  }
  for (const [name, rule] of Object.entries(fields || {})) {
    const fieldPath = `${path}.${name}`;
    if (!own(parameters, name)) {
      if (rule.required) errors.push(makeError(ValidationCode.MISSING_FIELD, fieldPath, `缺少参数 ${name}`));
      continue;
    }
    const value = parameters[name];
    if (!matchesType(value, rule.type)) {
      errors.push(makeError(ValidationCode.TYPE_MISMATCH, fieldPath, `参数 ${name} 类型无效`));
      continue;
    }
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, fieldPath, `参数 ${name} 不在允许范围内`));
    }
    if (typeof value === 'number' && ((rule.min != null && value < rule.min) || (rule.max != null && value > rule.max))) {
      errors.push(makeError(ValidationCode.OUT_OF_RANGE, fieldPath, `参数 ${name} 超出范围`));
    }
  }
}

export class CapabilityStrategyRegistry {
  constructor() {
    this._strategies = new Map();
    this._sealed = false;
  }

  register(descriptor) {
    if (this._sealed) throw new Error('CapabilityStrategyRegistry is sealed');
    const { capabilityId, strategyId, project } = descriptor || {};
    if (!ITEM_CAPABILITY_IDS.includes(capabilityId) || typeof strategyId !== 'string' || !strategyId
      || typeof project !== 'function') {
      throw new TypeError('capability strategy requires known capabilityId, strategyId and project');
    }
    if (this._strategies.has(strategyId)) throw new Error(`duplicateCapabilityStrategy:${strategyId}`);
    this._strategies.set(strategyId, Object.freeze({
      capabilityId,
      strategyId,
      parametersSchema: Object.freeze({ ...(descriptor.parametersSchema || {}) }),
      requires: Object.freeze([...(descriptor.requires || [])]),
      conflictsWith: Object.freeze([...(descriptor.conflictsWith || [])]),
      references: Object.freeze([...(descriptor.references || [])]),
      project
    }));
    return this;
  }

  seal() {
    this._sealed = true;
    return Object.freeze(this);
  }

  get(strategyId) { return this._strategies.get(strategyId) || null; }
  has(strategyId) { return this._strategies.has(strategyId); }
  entries() { return Object.freeze([...this._strategies.values()]); }

  find(capabilityId, strategyId = null) {
    if (strategyId) {
      const strategy = this.get(strategyId);
      return strategy?.capabilityId === capabilityId ? strategy : null;
    }
    return this.entries().find(entry => entry.capabilityId === capabilityId) || null;
  }

  validateDefinition(definition, { path = 'item', hasDefinition = null, allowUnknownStrategies = false } = {}) {
    const errors = [];
    const capabilities = normalizeCapabilities(definition);
    const ids = new Set();
    capabilities.forEach((capability, index) => {
      const capabilityId = capability?.capabilityId || capability?.id;
      const capabilityPath = `${path}.capabilities[${index}]`;
      if (ids.has(capabilityId)) {
        errors.push(makeError(ValidationCode.DUPLICATE_ID, `${capabilityPath}.id`, `重复 capability: ${capabilityId}`));
      }
      ids.add(capabilityId);
      const strategy = this.find(capabilityId, capability?.strategyId);
      if (!strategy) {
        if (allowUnknownStrategies) return;
        errors.push(makeError(ValidationCode.INVALID_REFERENCE, `${capabilityPath}.strategyId`,
          `未登记 capability strategy: ${String(capabilityId)}+${String(capability?.strategyId || '<default>')}`));
        return;
      }
      validateParameters(capability.parameters, strategy.parametersSchema, `${capabilityPath}.parameters`, errors);
      for (const required of strategy.requires) {
        if (!ids.has(required) && !capabilities.some(entry => (entry?.capabilityId || entry?.id) === required)) {
          errors.push(makeError('capabilityDependencyMissing', capabilityPath, `${capabilityId} 依赖 ${required}`));
        }
      }
      for (const conflict of strategy.conflictsWith) {
        if (capabilities.some(entry => (entry?.capabilityId || entry?.id) === conflict)) {
          errors.push(makeError('capabilityConflict', capabilityPath, `${capabilityId} 与 ${conflict} 互斥`));
        }
      }
      for (const reference of strategy.references) {
        const ref = capability.parameters?.[reference.parameter];
        if (ref === undefined && reference.required !== true) continue;
        if (typeof ref !== 'string' || !ref || (hasDefinition && !hasDefinition(reference.kind, ref))) {
          errors.push(makeError(ValidationCode.INVALID_REFERENCE,
            `${capabilityPath}.parameters.${reference.parameter}`,
            `悬空引用 ${reference.kind}:${String(ref)}`));
        }
      }
    });
    return errors;
  }

  project(definition, runtimeState) {
    const projection = {};
    for (const capability of normalizeCapabilities(definition)) {
      const capabilityId = capability?.capabilityId || capability?.id;
      const strategy = this.find(capabilityId, capability?.strategyId);
      if (!strategy) continue;
      projection[capabilityId] = strategy.project({
        definition, runtimeState, parameters: capability.parameters || {}
      });
    }
    return projection;
  }
}

const mutable = (state, key, fallback = null) => state?.mutable?.[key] ?? fallback;

export function createStandardCapabilityStrategyRegistry() {
  return new CapabilityStrategyRegistry()
    .register({ capabilityId: 'stackable', strategyId: 'item.stack.standard',
      parametersSchema: { maxStack: { type: 'integer', required: true, min: 2 } },
      conflictsWith: ['container', 'durable', 'tool'],
      project: ({ parameters }) => ({ maxStack: parameters.maxStack }) })
    .register({ capabilityId: 'consumable', strategyId: 'item.consume.effect',
      parametersSchema: { charges: { type: 'integer', min: 1 } },
      project: ({ runtimeState, parameters }) => ({ charges: mutable(runtimeState, 'charges', parameters.charges ?? 1) }) })
    .register({ capabilityId: 'equippable', strategyId: 'item.equip.slot',
      parametersSchema: { slot: { type: 'string', required: true,
        enum: ['mainhand', 'offhand', 'armor', 'helmet', 'necklace', 'accessory'] } },
      project: ({ parameters }) => ({ slot: parameters.slot }) })
    .register({ capabilityId: 'throwable', strategyId: 'item.throw.projectile',
      parametersSchema: { range: { type: 'number', required: true, min: 0 }, speed: { type: 'number', min: 0 } },
      project: ({ parameters }) => ({ range: parameters.range, speed: parameters.speed ?? 0 }) })
    .register({ capabilityId: 'container', strategyId: 'item.container.slots',
      parametersSchema: { capacity: { type: 'integer', required: true, min: 1 } },
      conflictsWith: ['stackable'],
      project: ({ runtimeState, parameters }) => ({ capacity: parameters.capacity,
        count: list(mutable(runtimeState, 'container', [])).length }) })
    .register({ capabilityId: 'questBound', strategyId: 'item.quest.bound',
      parametersSchema: { questId: { type: 'string', required: true } },
      references: [{ parameter: 'questId', kind: 'quests', required: true }],
      project: ({ parameters, runtimeState }) => ({ questId: parameters.questId,
        binding: mutable(runtimeState, 'binding') }) })
    .register({ capabilityId: 'fuel', strategyId: 'item.fuel.energy',
      parametersSchema: { energy: { type: 'number', required: true, min: 0 } },
      project: ({ parameters, runtimeState }) => ({ energy: mutable(runtimeState, 'charges', parameters.energy) }) })
    .register({ capabilityId: 'cargo', strategyId: 'item.cargo.container',
      parametersSchema: { capacity: { type: 'integer', required: true, min: 1 } },
      requires: ['container'],
      project: ({ parameters, runtimeState }) => ({ capacity: parameters.capacity,
        count: list(mutable(runtimeState, 'container', [])).length }) })
    .register({ capabilityId: 'tool', strategyId: 'item.tool.gathering',
      parametersSchema: {
        toolType: { type: 'string', required: true },
        gatherSpeed: { type: 'number', min: Number.MIN_VALUE }
      },
      requires: ['durable'],
      conflictsWith: ['stackable'],
      project: ({ parameters, runtimeState }) => ({
        toolType: parameters.toolType,
        gatherSpeed: parameters.gatherSpeed ?? 1,
        durability: mutable(runtimeState, 'durability')
      }) })
    .register({ capabilityId: 'durable', strategyId: 'item.durable.standard',
      parametersSchema: { maxDurability: { type: 'integer', required: true, min: 1 } },
      conflictsWith: ['stackable'],
      project: ({ parameters, runtimeState }) => ({ maxDurability: parameters.maxDurability,
        durability: mutable(runtimeState, 'durability', parameters.maxDurability) }) })
    .register({ capabilityId: 'placeable', strategyId: 'item.place.entity',
      parametersSchema: { buildingId: { type: 'string' } },
      references: [{ parameter: 'buildingId', kind: 'buildings' }],
      project: ({ parameters }) => ({ buildingId: parameters.buildingId || null }) })
    .seal();
}

export default CapabilityStrategyRegistry;
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

import { cloneCanonicalValue, deepFreeze } from '../core/CanonicalSnapshot.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const EXECUTABLE_FIELDS = new Set([
  'execute', 'handler', 'callback', 'modulePath', 'className', 'function',
  'code', 'script', 'sourceCode', 'eval', 'adapter'
]);

export const ActionSideEffect = Object.freeze({
  DOMAIN: 'domain', WORLD: 'world', PRESENTATION: 'presentation'
});
export const ActionCheckpointPolicy = Object.freeze({
  NEVER: 'never', ON_COMMIT: 'onCommit', REQUIRED: 'required'
});
export const ActionReentryPolicy = Object.freeze({
  REJECT: 'reject', QUEUE: 'queue', RESTART: 'restart'
});

function executablePath(value, path = 'descriptor', schemaPropertyMap = false) {
  if (!isObject(value) && !Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if ((!schemaPropertyMap && EXECUTABLE_FIELDS.has(key)) || typeof child === 'function') return `${path}.${key}`;
    const nested = executablePath(child, `${path}.${key}`, key === 'properties');
    if (nested) return nested;
  }
  return null;
}

function validateSchema(value, schema, path, errors) {
  if (!schema) return;
  const type = Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value);
  if (schema.type && type !== schema.type) {
    errors.push({ code: 'typeMismatch', path, message: `expected ${schema.type}` });
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push({ code: 'outOfRange', path, message: 'value is not allowed' });
  if (schema.type === 'object' && isObject(value)) {
    for (const name of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) errors.push({ code: 'missingField', path: `${path}.${name}`, message: 'field is required' });
    }
    for (const [name, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[name];
      if (childSchema) validateSchema(child, childSchema, `${path}.${name}`, errors);
      else if (schema.additionalProperties === false) errors.push({ code: 'unknownField', path: `${path}.${name}`, message: 'field is not allowed' });
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((child, index) => validateSchema(child, schema.items, `${path}[${index}]`, errors));
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push({ code: 'outOfRange', path, message: `minimum is ${schema.minimum}` });
    if (schema.maximum != null && value > schema.maximum) errors.push({ code: 'outOfRange', path, message: `maximum is ${schema.maximum}` });
  }
}

function assertDescriptor(raw) {
  if (!isObject(raw) || !hasText(raw.id)) throw new TypeError('ActionDescriptor.id must be a non-empty string');
  const executable = executablePath(raw);
  if (executable) throw new TypeError(`ActionDescriptor cannot contain executable content at ${executable}`);
  if (!isObject(raw.paramsSchema) || !isObject(raw.resultSchema)) throw new TypeError(`ActionDescriptor ${raw.id} requires params/result schema`);
  if (!Object.values(ActionSideEffect).includes(raw.sideEffect)) throw new TypeError(`ActionDescriptor ${raw.id} has invalid sideEffect`);
  if (typeof raw.requiresOperationId !== 'boolean') throw new TypeError(`ActionDescriptor ${raw.id} requires operationId policy`);
  if (!Object.values(ActionCheckpointPolicy).includes(raw.checkpointPolicy)) throw new TypeError(`ActionDescriptor ${raw.id} has invalid checkpoint policy`);
  if (!Array.isArray(raw.allowedReentryPolicies) || !raw.allowedReentryPolicies.length
    || raw.allowedReentryPolicies.some(value => !Object.values(ActionReentryPolicy).includes(value))) {
    throw new TypeError(`ActionDescriptor ${raw.id} has invalid reentry policy`);
  }
  if (!hasText(raw.adapterId) || !hasText(raw.commandType)) throw new TypeError(`ActionDescriptor ${raw.id} requires adapterId/commandType`);
}

export class ActionDescriptorRegistry {
  constructor(descriptors = []) {
    const index = Object.create(null);
    for (const raw of descriptors) {
      assertDescriptor(raw);
      if (index[raw.id]) throw new TypeError(`Duplicate ActionDescriptor id: ${raw.id}`);
      index[raw.id] = deepFreeze(cloneCanonicalValue(raw));
    }
    this._index = deepFreeze(index);
    Object.freeze(this);
  }

  has(id) { return Object.prototype.hasOwnProperty.call(this._index, id); }
  get(id) { return this._index[id] || null; }
  require(id) {
    const descriptor = this.get(id);
    if (!descriptor) throw new TypeError(`Unknown ActionDescriptor: ${String(id)}`);
    return descriptor;
  }
  ids() { return Object.freeze(Object.keys(this._index)); }
  all() { return Object.freeze(Object.values(this._index)); }
  validateParams(id, value) { return this._validate(id, 'paramsSchema', value, 'params'); }
  validateResult(id, value) { return this._validate(id, 'resultSchema', value, 'result'); }
  _validate(id, schemaField, value, path) {
    const errors = [];
    validateSchema(value, this.require(id)[schemaField], path, errors);
    return deepFreeze({ ok: errors.length === 0, errors });
  }
}

const PARAM_META = {
  actorRef: { type: 'string' }, operationId: { type: 'string' }, expectedStateRevision: { type: 'number', minimum: 0 }
};
const RESULT_SCHEMA = {
  type: 'object', required: ['ok', 'operationId', 'status', 'committed'],
  properties: {
    ok: { type: 'boolean' }, operationId: { type: 'string' }, status: { type: 'string' },
    committed: { type: 'boolean' }, code: {}, stateId: {}, stateRevision: {},
    eventFrom: {}, eventTo: {}, value: {}, error: {}
  }
};
function descriptor(id, commandType, idField, kind, sideEffect = ActionSideEffect.DOMAIN, checkpointPolicy = ActionCheckpointPolicy.ON_COMMIT, paramsSchemaOverrides = {}) {
  const baseProperties = {
    ...PARAM_META, [idField]: { type: 'string' }, operation: { type: 'string' },
    ...(paramsSchemaOverrides?.properties || {})
  };
  return {
    id, commandType, adapterId: 'command', sideEffect,
    requiresOperationId: true, checkpointPolicy,
    allowedReentryPolicies: [ActionReentryPolicy.REJECT, ActionReentryPolicy.QUEUE, ActionReentryPolicy.RESTART],
    paramsSchema: {
      type: 'object', required: [idField], additionalProperties: true,
      ...paramsSchemaOverrides,
      properties: baseProperties
    },
    resultSchema: RESULT_SCHEMA,
    referenceFields: kind && !['vehicles', 'endings'].includes(kind)
      ? [{ field: idField, kind, required: true }] : []
  };
}

export const STANDARD_ACTION_DESCRIPTORS = deepFreeze([
  descriptor('rescue.command', 'rescue.command', 'rescueId', 'rescues'),
  descriptor('battle.command', 'battle.command', 'battleId', 'battles'),
  descriptor('construction.command', 'construction.command', 'definitionId', 'constructions'),
  descriptor('vehicle.command', 'vehicle.command', 'vehicleId', 'vehicles'),
  descriptor('quest.command', 'quest.command', 'questId', 'quests'),
  descriptor('task.command', 'quest.command', 'definitionId', null),
  descriptor('world.teleport', 'world.teleport', 'sceneId', 'scenes', ActionSideEffect.WORLD, ActionCheckpointPolicy.REQUIRED),
  descriptor('checkpoint.request', 'checkpoint.request', 'checkpointId', null, ActionSideEffect.DOMAIN, ActionCheckpointPolicy.REQUIRED),
  descriptor('ending.command', 'ending.command', 'endingId', 'endings', ActionSideEffect.DOMAIN, ActionCheckpointPolicy.REQUIRED),
  descriptor('dialogue.command', 'dialogue.command', 'dialogueId', 'dialogues'),
  descriptor('tutorial.command', 'tutorial.command', 'tutorialId', 'tutorials', ActionSideEffect.DOMAIN, ActionCheckpointPolicy.ON_COMMIT, {
    properties: { await: { type: 'boolean' } }
  }),
  {
    ...descriptor('state.transaction', 'state.transaction', 'definitionId', 'commands'),
    emits: [{ type: 'state.transaction', idParam: 'definitionId', condition: 'committed' }]
  },
  descriptor('scenario.command', 'scenario.command', 'scenarioId', null)
]);

export function createStandardActionDescriptorRegistry(extraDescriptors = []) {
  return new ActionDescriptorRegistry([...STANDARD_ACTION_DESCRIPTORS, ...extraDescriptors]);
}

export default ActionDescriptorRegistry;
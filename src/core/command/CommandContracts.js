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

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRevision = value => (Number.isInteger(value) && value >= 0)
  || (typeof value === 'string' && value.length > 0);
const isSequence = value => Number.isInteger(value) && value >= 0;
const hasText = value => typeof value === 'string' && value.trim().length > 0;

export const CommandContractKind = Object.freeze({
  CLIENT_INTENT: 'ClientIntent',
  AUTHORITATIVE_COMMAND: 'AuthoritativeCommand',
  COMMAND_RESULT: 'CommandResult',
  COMMITTED_EVENT: 'CommittedEvent',
  APPLICATION_EVENT: 'ApplicationEvent',
  PROJECTION: 'Projection'
});

export const COMMAND_CONTRACT_SCHEMAS = Object.freeze({
  ClientIntent: Object.freeze({ required: ['intentType', 'actorRef', 'payload'], optional: ['operationId', 'expectedStateRevision'] }),
  AuthoritativeCommand: Object.freeze({ required: ['commandType', 'operationId', 'actorId', 'definitionRevision', 'payload'], optional: ['sessionId', 'clientSequence', 'expectedStateRevision'] }),
  CommandResult: Object.freeze({ required: ['ok', 'operationId', 'status', 'committed', 'code', 'stateId', 'stateRevision', 'eventFrom', 'eventTo', 'value', 'error'] }),
  CommittedEvent: Object.freeze({ required: ['eventId', 'stateId', 'stateType', 'stateRevision', 'operationId', 'logicalTime', 'type', 'payload'], optional: ['eventSequence'] }),
  ApplicationEvent: Object.freeze({ required: ['eventId', 'stateId', 'stateType', 'stateRevision', 'operationId', 'logicalTime', 'type', 'payload'], optional: ['eventSequence', 'committedEventId'] }),
  Projection: Object.freeze({ required: ['projectionType', 'projectionId', 'definitionRevision', 'stateRevision', 'projectionRevision', 'lastEventSequence', 'value'] })
});

export class CommandContractError extends Error {
  constructor(kind, errors) {
    super(`${kind} contract validation failed: ${errors.map(error => `${error.path} ${error.message}`).join('; ')}`);
    this.name = 'CommandContractError';
    this.kind = kind;
    this.errors = Object.freeze(errors.map(error => Object.freeze({ ...error })));
  }
}

function add(errors, path, code, message) {
  errors.push({ path, code, message });
}

function validateJson(value, path, errors, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) add(errors, path, 'notSerializable', '必须为有限数值');
    return;
  }
  if (typeof value !== 'object') {
    add(errors, path, 'notSerializable', '必须为 JSON 可序列化值');
    return;
  }
  if (seen.has(value)) {
    add(errors, path, 'cyclicValue', '不得包含循环引用');
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateJson(child, `${path}[${index}]`, errors, seen));
  } else {
    for (const [key, child] of Object.entries(value)) validateJson(child, `${path}.${key}`, errors, seen);
  }
  seen.delete(value);
}

function requireObject(value, kind, errors) {
  if (!isObject(value)) add(errors, kind, 'typeMismatch', '必须为对象');
  return isObject(value);
}

function requireKeys(value, kind, errors) {
  if (!isObject(value)) return;
  for (const key of COMMAND_CONTRACT_SCHEMAS[kind].required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) add(errors, `${kind}.${key}`, 'missingField', '缺少必填字段');
  }
}

function validateEvent(value, kind, errors) {
  if (!requireObject(value, kind, errors)) return;
  requireKeys(value, kind, errors);
  for (const key of ['eventId', 'stateId', 'stateType', 'operationId', 'type']) {
    if (!hasText(value[key])) add(errors, `${kind}.${key}`, 'typeMismatch', '必须为非空字符串');
  }
  if (!isSequence(value.stateRevision)) add(errors, `${kind}.stateRevision`, 'invalidRevision', '必须为非负整数');
  if (!isSequence(value.logicalTime)) add(errors, `${kind}.logicalTime`, 'invalidClock', '必须为非负整数');
  if (value.eventSequence !== undefined && !isSequence(value.eventSequence)) add(errors, `${kind}.eventSequence`, 'invalidSequence', '必须为非负整数');
  validateJson(value.payload, `${kind}.payload`, errors);
}

const validators = {
  ClientIntent(value, errors) {
    if (!requireObject(value, 'ClientIntent', errors)) return;
    requireKeys(value, 'ClientIntent', errors);
    if (!hasText(value.intentType)) add(errors, 'ClientIntent.intentType', 'typeMismatch', '必须为非空字符串');
    const actorValid = hasText(value.actorRef) || (isObject(value.actorRef) && hasText(value.actorRef.id));
    if (!actorValid) add(errors, 'ClientIntent.actorRef', 'invalidReference', '必须为稳定 actor ID 或含 id 的引用');
    if (!isObject(value.payload)) add(errors, 'ClientIntent.payload', 'typeMismatch', '必须为对象');
    else validateJson(value.payload, 'ClientIntent.payload', errors);
    if (value.operationId !== undefined && !hasText(value.operationId)) add(errors, 'ClientIntent.operationId', 'typeMismatch', '必须为非空字符串');
    if (value.expectedStateRevision !== undefined && !isSequence(value.expectedStateRevision)) add(errors, 'ClientIntent.expectedStateRevision', 'invalidRevision', '必须为非负整数');
    for (const key of ['definitionRevision', 'stateRevision', 'eventSequence', 'projectionRevision', 'snapshotSchemaVersion']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) add(errors, `ClientIntent.${key}`, 'revisionBoundary', '该 revision 不属于 ClientIntent');
    }
  },
  AuthoritativeCommand(value, errors) {
    if (!requireObject(value, 'AuthoritativeCommand', errors)) return;
    requireKeys(value, 'AuthoritativeCommand', errors);
    for (const key of ['commandType', 'operationId', 'actorId']) {
      if (!hasText(value[key])) add(errors, `AuthoritativeCommand.${key}`, 'typeMismatch', '必须为非空字符串');
    }
    if (!isRevision(value.definitionRevision)) add(errors, 'AuthoritativeCommand.definitionRevision', 'invalidRevision', '必须为非负整数或非空字符串');
    if (!isObject(value.payload)) add(errors, 'AuthoritativeCommand.payload', 'typeMismatch', '必须为对象');
    else validateJson(value.payload, 'AuthoritativeCommand.payload', errors);
    if (value.sessionId !== undefined && !hasText(value.sessionId)) add(errors, 'AuthoritativeCommand.sessionId', 'typeMismatch', '必须为非空字符串');
    if (value.clientSequence !== undefined && !isSequence(value.clientSequence)) add(errors, 'AuthoritativeCommand.clientSequence', 'invalidSequence', '必须为非负整数');
    if (value.expectedStateRevision !== undefined && !isSequence(value.expectedStateRevision)) add(errors, 'AuthoritativeCommand.expectedStateRevision', 'invalidRevision', '必须为非负整数');
    for (const key of ['stateRevision', 'eventSequence', 'projectionRevision', 'snapshotSchemaVersion']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) add(errors, `AuthoritativeCommand.${key}`, 'revisionBoundary', '该 revision 不属于 AuthoritativeCommand');
    }
  },
  CommandResult(value, errors) {
    if (!requireObject(value, 'CommandResult', errors)) return;
    requireKeys(value, 'CommandResult', errors);
    if (typeof value.ok !== 'boolean') add(errors, 'CommandResult.ok', 'typeMismatch', '必须为布尔值');
    if (!hasText(value.operationId)) add(errors, 'CommandResult.operationId', 'typeMismatch', '必须为非空字符串');
    if (!hasText(value.status)) add(errors, 'CommandResult.status', 'typeMismatch', '必须为非空字符串');
    if (typeof value.committed !== 'boolean') add(errors, 'CommandResult.committed', 'typeMismatch', '必须为布尔值');
    for (const key of ['stateRevision', 'eventFrom', 'eventTo']) {
      if (value[key] !== null && !isSequence(value[key])) add(errors, `CommandResult.${key}`, 'invalidRevision', '必须为 null 或非负整数');
    }
    if (value.code !== null && !hasText(value.code)) add(errors, 'CommandResult.code', 'typeMismatch', '必须为 null 或非空字符串');
    validateJson(value.value, 'CommandResult.value', errors);
    validateJson(value.error, 'CommandResult.error', errors);
    for (const key of ['definitionRevision', 'eventSequence', 'projectionRevision', 'snapshotSchemaVersion']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) add(errors, `CommandResult.${key}`, 'revisionBoundary', '该 revision 不属于 CommandResult');
    }
  },
  CommittedEvent: (value, errors) => validateEvent(value, 'CommittedEvent', errors),
  ApplicationEvent: (value, errors) => validateEvent(value, 'ApplicationEvent', errors),
  Projection(value, errors) {
    if (!requireObject(value, 'Projection', errors)) return;
    requireKeys(value, 'Projection', errors);
    for (const key of ['projectionType', 'projectionId']) {
      if (!hasText(value[key])) add(errors, `Projection.${key}`, 'typeMismatch', '必须为非空字符串');
    }
    if (!isRevision(value.definitionRevision)) add(errors, 'Projection.definitionRevision', 'invalidRevision', '必须为非负整数或非空字符串');
    for (const key of ['stateRevision', 'projectionRevision', 'lastEventSequence']) {
      if (!isSequence(value[key])) add(errors, `Projection.${key}`, 'invalidRevision', '必须为非负整数');
    }
    validateJson(value.value, 'Projection.value', errors);
    for (const key of ['eventSequence', 'snapshotSchemaVersion']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) add(errors, `Projection.${key}`, 'revisionBoundary', '该 revision 不属于 Projection');
    }
  }
};

export function validateCommandContract(kind, value) {
  const validator = validators[kind];
  if (!validator) throw new TypeError(`Unknown command contract: ${kind}`);
  const errors = [];
  validator(value, errors);
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertCommandContract(kind, value) {
  const validation = validateCommandContract(kind, value);
  if (!validation.ok) throw new CommandContractError(kind, validation.errors);
  return value;
}

export function cloneCommandValue(value) {
  const validationErrors = [];
  validateJson(value, 'value', validationErrors);
  if (validationErrors.length) throw new CommandContractError('SerializableValue', validationErrors);
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

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

import { cloneCanonicalValue, deepFreeze } from '../core/CanonicalSnapshot.js';

const META_FIELDS = new Set(['actorRef', 'operationId', 'expectedStateRevision']);
const hasText = value => typeof value === 'string' && value.trim().length > 0;

export class CommandAdapterError extends Error {
  constructor(code, path, message, errors = null) {
    super(message);
    this.name = 'CommandAdapterError';
    this.code = code;
    this.path = path;
    this.errors = errors;
  }
}

/** ActionDescriptor 到 ClientIntent 的薄适配器；不持有或调用领域服务。 */
export class CommandAdapter {
  constructor({ registry, commandGateway, definitionRepository = null } = {}) {
    if (!registry || typeof registry.require !== 'function') throw new TypeError('CommandAdapter requires ActionDescriptorRegistry');
    if (!commandGateway || typeof commandGateway.execute !== 'function') throw new TypeError('CommandAdapter requires CommandGateway');
    this.registry = registry;
    this.commandGateway = commandGateway;
    this.definitionRepository = definitionRepository;
    Object.freeze(this);
  }

  _resolveReferences(descriptor, params, repository) {
    const definitionRefs = [];
    for (const reference of descriptor.referenceFields || []) {
      const id = params[reference.field];
      if (!hasText(id)) {
        if (reference.required !== false) throw new CommandAdapterError('invalidReference', `params.${reference.field}`, 'missing stable reference');
        continue;
      }
      if (!repository?.has?.(reference.kind, id)) {
        throw new CommandAdapterError('invalidReference', `params.${reference.field}`, `unknown ${reference.kind}:${id}`);
      }
      definitionRefs.push({ kind: reference.kind, id });
    }
    return definitionRefs;
  }

  _payload(params, definitionRefs, eventParams = null) {
    const payload = {};
    for (const [key, value] of Object.entries(params)) {
      if (!META_FIELDS.has(key)) payload[key] = cloneCanonicalValue(value);
    }
    if (eventParams && typeof eventParams === 'object') payload.event = cloneCanonicalValue(eventParams);
    if (definitionRefs.length) {
      const existing = Array.isArray(payload.definitionRefs) ? payload.definitionRefs : [];
      payload.definitionRefs = [...existing, ...definitionRefs];
    }
    return payload;
  }

  async execute(action, context = {}) {
    const actionId = typeof action === 'string' ? action : action?.action;
    const params = cloneCanonicalValue(typeof action === 'string' ? {} : (action?.params || {}));
    const descriptor = this.registry.require(actionId);
    if (descriptor.adapterId !== 'command') {
      throw new CommandAdapterError('unsupportedAdapter', 'descriptor.adapterId', `unsupported adapter ${descriptor.adapterId}`);
    }
    const validation = this.registry.validateParams(actionId, params);
    if (!validation.ok) throw new CommandAdapterError('invalidActionParams', 'params', 'action params validation failed', validation.errors);

    const operationId = context.operationId || params.operationId;
    if (descriptor.requiresOperationId && !hasText(operationId)) {
      throw new CommandAdapterError('operationIdRequired', 'operationId', `action ${actionId} requires stable operationId`);
    }
    const actorRef = context.actorRef || params.actorRef;
    if (!hasText(actorRef)) throw new CommandAdapterError('actorRefRequired', 'actorRef', 'stable actorRef is required');
    const repository = context.definitionRepository || this.definitionRepository;
    const definitionRefs = this._resolveReferences(descriptor, params, repository);
    const intent = {
      intentType: descriptor.commandType,
      actorRef,
      ...(operationId ? { operationId } : {}),
      ...(params.expectedStateRevision === undefined ? {} : { expectedStateRevision: params.expectedStateRevision }),
      payload: this._payload(params, definitionRefs, context.eventParams)
    };
    const result = await this.commandGateway.execute(intent, {
      definitionRepository: repository,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.definitionRevision === undefined ? {} : { definitionRevision: context.definitionRevision })
    });
    const normalized = deepFreeze(cloneCanonicalValue({
      ok: result.ok,
      operationId: result.operationId,
      status: result.status,
      committed: result.committed,
      code: result.code ?? null,
      stateId: result.stateId ?? null,
      stateRevision: result.stateRevision ?? null,
      eventFrom: result.eventFrom ?? null,
      eventTo: result.eventTo ?? null,
      value: result.value ?? null,
      error: result.error ?? null
    }));
    const resultValidation = this.registry.validateResult(actionId, normalized);
    if (!resultValidation.ok) throw new CommandAdapterError('invalidActionResult', 'result', 'command result validation failed', resultValidation.errors);
    return normalized;
  }
}

export default CommandAdapter;
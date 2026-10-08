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

import { assertAuthorityPort } from './AuthorityPort.js';
import {
  CommandContractError,
  CommandContractKind,
  assertCommandContract,
  cloneCommandValue
} from './CommandContracts.js';

const hasText = value => typeof value === 'string' && value.trim().length > 0;
const actorIdOf = actorRef => typeof actorRef === 'string' ? actorRef : actorRef?.id;

function referenceErrors(payload, repository) {
  if (!repository || typeof repository.has !== 'function' || !Array.isArray(payload?.definitionRefs)) return [];
  const errors = [];
  payload.definitionRefs.forEach((reference, index) => {
    if (!reference || !hasText(reference.kind) || !hasText(reference.id) || !repository.has(reference.kind, reference.id)) {
      errors.push({
        path: `ClientIntent.payload.definitionRefs[${index}]`,
        code: 'invalidReference',
        message: `Unknown definition reference ${String(reference?.kind)}:${String(reference?.id)}`
      });
    }
  });
  return errors;
}

/** UI、Trigger、Scene 与业务 client 构造权威命令的唯一入口。 */
export class CommandGateway {
  constructor(config = {}) {
    this.authorityPort = assertAuthorityPort(config.authorityPort);
    this.definitionRepository = config.definitionRepository || null;
    this.getActorId = config.getActorId || null;
    this.getSessionId = config.getSessionId || null;
    this.validateReferences = config.validateReferences || null;
    this._operationSequence = 0;
    this._clientSequence = 0;
    this.operationIdFactory = config.operationIdFactory || ((intent, context) => {
      const session = context.sessionId || 'local';
      return `operation:${session}:${actorIdOf(intent.actorRef)}:${++this._operationSequence}`;
    });
    this.disposed = false;
  }

  _currentDefinitionRevision(repository = this.definitionRepository) {
    const revision = repository?.definitionRevision
      ?? repository?.revision
      ?? 0;
    return revision;
  }

  async execute(intent, options = {}) {
    if (this.disposed) throw new Error('CommandGateway is disposed');
    const candidate = cloneCommandValue(intent);
    assertCommandContract(CommandContractKind.CLIENT_INTENT, candidate);

    const repository = options.definitionRepository || this.definitionRepository;
    const errors = referenceErrors(candidate.payload, repository);
    if (this.validateReferences) {
      const custom = await this.validateReferences(candidate, Object.freeze({ repository }));
      if (custom === false) errors.push({ path: 'ClientIntent.payload', code: 'invalidReference', message: 'Reference validation failed' });
      else if (Array.isArray(custom)) errors.push(...custom);
      else if (custom?.ok === false && Array.isArray(custom.errors)) errors.push(...custom.errors);
    }
    if (errors.length) throw new CommandContractError(CommandContractKind.CLIENT_INTENT, errors);

    const actorId = options.actorId || actorIdOf(candidate.actorRef) || this.getActorId?.(candidate);
    const sessionId = options.sessionId || this.getSessionId?.(candidate);
    const definitionRevision = this._currentDefinitionRevision(repository);
    if (options.definitionRevision !== undefined && options.definitionRevision !== definitionRevision) {
      throw new CommandContractError(CommandContractKind.AUTHORITATIVE_COMMAND, [{
        path: 'AuthoritativeCommand.definitionRevision',
        code: 'definitionRevisionConflict',
        message: `Expected current definition revision ${String(definitionRevision)}`
      }]);
    }
    const expectedStateRevision = options.expectedStateRevision ?? candidate.expectedStateRevision;
    const operationId = candidate.operationId || this.operationIdFactory(candidate, { actorId, sessionId });
    const command = {
      commandType: candidate.intentType,
      operationId,
      actorId,
      ...(sessionId === undefined || sessionId === null ? {} : { sessionId }),
      clientSequence: options.clientSequence ?? ++this._clientSequence,
      ...(expectedStateRevision === undefined ? {} : { expectedStateRevision }),
      definitionRevision,
      payload: candidate.payload
    };
    assertCommandContract(CommandContractKind.AUTHORITATIVE_COMMAND, command);
    const result = await this.authorityPort.execute(Object.freeze(command));
    assertCommandContract(CommandContractKind.COMMAND_RESULT, result);
    if (result.operationId !== operationId) throw new Error('AuthorityPort returned a result for another operationId');
    return result;
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this.definitionRepository = null;
    this.validateReferences = null;
    return true;
  }
}

export default CommandGateway;

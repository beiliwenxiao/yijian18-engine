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

const clone = value => value == null ? value : (typeof structuredClone === 'function'
  ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

function rejected(command, code, error = null) {
  return {
    ok: false, operationId: command.operationId, status: 'rejected', committed: false,
    code, stateId: null, stateRevision: null, eventFrom: null, eventTo: null,
    value: null, error: error || { message: code }
  };
}

/**
 * 标准领域命令的通用 Authority handler。
 * 它不拥有任何业务状态：所有领域写入委托给注入的 Transaction Service 或受控 Facade；
 * Authority 只在委托成功后提交统一 state revision 并发布有序提交通知。
 */
export class DomainCommandService {
  constructor({ ports = {}, statePrefix = 'domainCommand', stateId = null } = {}) {
    this.ports = { ...ports };
    this.statePrefix = statePrefix;
    this.stateType = 'domainCommand';
    this.stateId = typeof stateId === 'function'
      ? stateId
      : (stateId ? () => stateId : command => `${this.statePrefix}:${command.commandType}`);
  }

  async execute(command, context) {
    const port = this.ports[command.commandType];
    if (!port?.execute) return rejected(command, 'unsupportedDomainCommand');
    let outcome;
    try {
      outcome = await port.execute({
        commandType: command.commandType,
        operationId: command.operationId,
        actorId: command.actorId,
        payload: clone(command.payload || {})
      });
    } catch (error) {
      return rejected(command, error?.code || 'domainCommandFailed', { message: error?.message || String(error) });
    }
    if (outcome === false || outcome == null || outcome?.ok === false || outcome?.cancelled) {
      return rejected(command, outcome?.code || 'domainCommandRejected', {
        message: outcome?.errors?.[0]?.message || outcome?.message || 'domain command rejected'
      });
    }
    const revision = context.commitStateRevision(context.preparedStateRevision);
    if (!revision.ok) return rejected(command, revision.code);
    const stateId = context.preparedStateRevision.stateId;
    const value = clone(outcome === true ? { ok: true } : outcome);
    const result = {
      ok: true, operationId: command.operationId, status: 'committed', committed: true,
      code: null, stateId, stateRevision: revision.stateRevision,
      eventFrom: null, eventTo: null, value, error: null
    };
    const eventBase = { stateId, stateType: this.stateType, stateRevision: revision.stateRevision };
    return {
      result,
      committedEvents: [{
        ...eventBase, type: `${command.commandType}.committed`,
        payload: { commandType: command.commandType, value }
      }],
      applicationEvents: [{
        ...eventBase, type: command.commandType,
        payload: { commandType: command.commandType, value }
      }]
    };
  }
}

export default DomainCommandService;
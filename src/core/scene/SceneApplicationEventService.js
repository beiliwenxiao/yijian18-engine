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

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const rejected = (command, code, message = code) => ({
  ok: false,
  operationId: command.operationId,
  status: 'rejected',
  committed: false,
  code,
  stateId: null,
  stateRevision: null,
  eventFrom: null,
  eventTo: null,
  value: null,
  error: { message }
});

/**
 * 将已经成立、但不属于特定领域 handler 的场景事实发布为 committed application event。
 * 调用方必须先确认事实已提交；本服务只拥有事件流 revision，不拥有业务状态。
 */
export class SceneApplicationEventService {
  constructor(config = {}) {
    this.stateType = config.stateType || 'sceneApplicationEvents';
    this.stateId = command => {
      const sceneId = String(command?.payload?.sceneId || 'global').trim() || 'global';
      return `scene-application-events:${sceneId}`;
    };
  }

  execute(command, context) {
    const eventType = String(command?.payload?.eventType || '').trim();
    const payload = command?.payload?.payload;
    const rawSceneId = command?.payload?.sceneId;
    if (!eventType) return rejected(command, 'applicationEventTypeMissing');
    if (!isPlainObject(payload)) return rejected(command, 'applicationEventPayloadInvalid');
    if (rawSceneId !== null && rawSceneId !== undefined
      && (typeof rawSceneId !== 'string' || !rawSceneId.trim())) {
      return rejected(command, 'applicationEventSceneIdInvalid');
    }
    const revision = context.commitStateRevision(context.preparedStateRevision);
    if (!revision.ok) return rejected(command, revision.code || 'stateRevisionCommitFailed');
    const stateId = context.preparedStateRevision.stateId;
    const value = {
      eventType,
      sceneId: command.payload.sceneId || null,
      reason: command.payload.reason || payload.reason || 'runtime'
    };
    const eventBase = {
      stateId,
      stateType: this.stateType,
      stateRevision: revision.stateRevision
    };
    return {
      result: {
        ok: true,
        operationId: command.operationId,
        status: 'committed',
        committed: true,
        code: null,
        stateId,
        stateRevision: revision.stateRevision,
        eventFrom: null,
        eventTo: null,
        value,
        error: null
      },
      committedEvents: [{
        ...eventBase,
        type: 'scene.applicationEvent.committed',
        payload: value
      }],
      applicationEvents: [{
        ...eventBase,
        type: eventType,
        payload: {
          ...payload,
          sceneId: command.payload.sceneId || payload.sceneId || null,
          reason: command.payload.reason || payload.reason || 'runtime'
        }
      }]
    };
  }
}

export default SceneApplicationEventService;
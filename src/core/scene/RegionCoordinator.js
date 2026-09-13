/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

function normalizeFailure(error, fallbackCode = 'regionSwitchFailed') {
  if (Array.isArray(error?.errors) && error.errors.length) return error.errors;
  const rawMessage = error?.message;
  const objectDetail = rawMessage && typeof rawMessage === 'object' ? rawMessage : null;
  return [{
    code: error?.code || fallbackCode,
    path: error?.path || 'region',
    message: typeof rawMessage === 'string' ? rawMessage : '大区切换失败（详见诊断详情）',
    ...(objectDetail ? { details: objectDetail } : {})
  }];
}

/**
 * 跨 Region 两阶段协调器：shadow load/validate → commit → release old。
 * 领域状态和表现如何提交由调用方注入，协调器只拥有事务顺序与并发互斥。
 */
export class RegionCoordinator {
  constructor({
    createSession,
    getCurrentSession = () => null,
    captureDraft = () => null,
    validateTarget = () => ({ ok: true, errors: [] }),
    commitTarget,
    restoreDraft = () => ({ ok: true }),
    releaseSession = session => session?.dispose?.()
  } = {}) {
    if (typeof createSession !== 'function') throw new TypeError('RegionCoordinator requires createSession');
    if (typeof commitTarget !== 'function') throw new TypeError('RegionCoordinator requires commitTarget');
    this.createSession = createSession;
    this.getCurrentSession = getCurrentSession;
    this.captureDraft = captureDraft;
    this.validateTarget = validateTarget;
    this.commitTarget = commitTarget;
    this.restoreDraft = restoreDraft;
    this.releaseSession = releaseSession;
    this.inFlight = null;
  }

  switchTo(request = {}) {
    if (this.inFlight) return Promise.resolve({ ok: false, code: 'regionSwitchBusy', errors: [
      { code: 'regionSwitchBusy', path: 'region', message: '已有大区切换正在进行' }
    ] });
    const operation = this._switchTo(request).finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  async _switchTo(request) {
    let oldSession = null;
    let draft = null;
    let shadowSession = null;
    let commitStarted = false;
    try {
      oldSession = this.getCurrentSession();
      draft = await this.captureDraft(request);
      shadowSession = this.createSession(request);
      const result = await shadowSession.load({
        projectUrl: request.projectUrl || 'game.project.json',
        regionIndex: request.regionIndex,
        sceneIds: request.sceneId ? [request.sceneId] : null
      });
      const validation = await this.validateTarget({ request, result, shadowSession, draft });
      if (validation?.ok === false) {
        const error = new Error(validation.errors?.[0]?.message || '目标大区校验失败');
        error.code = 'regionValidationFailed';
        error.errors = validation.errors;
        throw error;
      }

      commitStarted = true;
      const committed = await this.commitTarget({
        request,
        result,
        shadowSession,
        oldSession,
        draft,
        validation
      });
      if (committed?.ok === false) {
        const error = new Error(committed.errors?.[0]?.message || '目标大区提交失败');
        error.code = 'regionCommitFailed';
        error.errors = committed.errors;
        throw error;
      }

      if (oldSession && oldSession !== shadowSession) this.releaseSession(oldSession);
      return { ok: true, code: null, request, result, session: shadowSession };
    } catch (error) {
      let rollbackFailure = null;
      if (commitStarted) {
        try {
          const rollback = await this.restoreDraft({ request, draft, oldSession, shadowSession, error });
          if (rollback?.ok === false) rollbackFailure = rollback;
        } catch (rollbackError) {
          rollbackFailure = rollbackError;
        }
      }
      if (shadowSession && shadowSession !== oldSession) this.releaseSession(shadowSession);
      if (rollbackFailure) {
        return {
          ok: false,
          code: 'regionRollbackFailed',
          errors: [...normalizeFailure(error), ...normalizeFailure(rollbackFailure, 'regionRollbackFailed')]
        };
      }
      return { ok: false, code: error?.code || 'regionSwitchFailed', errors: normalizeFailure(error) };
    }
  }
}

export default RegionCoordinator;
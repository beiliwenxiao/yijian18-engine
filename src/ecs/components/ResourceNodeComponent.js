import { Component } from '../Component.js';

/** 资源节点纯数据组件；采集规则由 GatheringSystem 处理。 */
export class ResourceNodeComponent extends Component {
  constructor(config = {}) {
    super('resourceNode');
    this.schemaVersion = config.schemaVersion || 1;
    this.resourceType = config.resourceType || 'wood';
    this.itemId = config.itemId || this.resourceType;
    this.remaining = Math.max(0, Math.floor(Number(config.remaining) || 0));
    this.maxRemaining = Math.max(this.remaining, Math.floor(Number(config.maxRemaining) || this.remaining));
    this.yieldPerGather = Math.max(1, Math.floor(Number(config.yieldPerGather) || 1));
    // 每次采集产量的随机区间（min/max 正整数且 min<=max 才生效）；缺省回退固定 yieldPerGather。
    const rangeMin = Math.floor(Number(config.gatherYieldRange?.min) || 0);
    const rangeMax = Math.floor(Number(config.gatherYieldRange?.max) || 0);
    this.gatherYieldRange = rangeMin >= 1 && rangeMax >= rangeMin
      ? { min: rangeMin, max: rangeMax }
      : null;
    this.gatherDuration = Math.max(0.1, Number(config.gatherDuration) || 1);
    this.interactionRadius = Math.max(1, Number(config.interactionRadius) || 72);
    this.requiredToolType = config.requiredToolType || null;
    // 状态准入（如 "climbing"：必须攀爬中才能采集）；由 GatheringSystem.stateCheckers 校验
    this.requiredState = config.requiredState || null;
    // 旧 refreshDays 仅用于兼容历史存档；不会隐式启用实时刷新。
    this.refreshDays = Math.max(0, Math.floor(Number(config.refreshDays) || 0));
    this.refreshProgressDays = Math.max(0, Math.floor(Number(config.refreshProgressDays) || 0));
    this.refreshMode = config.refreshMode === 'timed' ? 'timed' : 'none';
    this.refreshIntervalSeconds = this.refreshMode === 'timed'
      ? Math.max(0.1, Number(config.refreshIntervalSeconds) || 0.1)
      : Math.max(0, Number(config.refreshIntervalSeconds) || 0);
    this.refreshElapsedSeconds = Math.max(0, Number(config.refreshElapsedSeconds) || 0);
    // 采空后的下架/刷新墙钟时间戳（ms）：消失期限后由放置运行时下架；
    // timed 刷新点在消失时点再叠加一个刷新间隔，到点由墓碑放行重建。
    this.disappearAtMs = Math.max(0, Number(config.disappearAtMs) || 0);
    this.refreshAtMs = Math.max(0, Number(config.refreshAtMs) || 0);
    this.guardUnitIds = Array.isArray(config.guardUnitIds) ? [...config.guardUnitIds] : [];
    this.riskEvents = Array.isArray(config.riskEvents)
      ? config.riskEvents
        .filter(event => event && typeof event.id === 'string' && event.id.trim())
        .map(event => ({
          id: event.id.trim(),
          type: typeof event.type === 'string' && event.type.trim() ? event.type.trim() : 'generic',
          chance: Math.min(1, Math.max(0, Number(event.chance) || 0)),
          message: typeof event.message === 'string' ? event.message : '',
          payload: event.payload && typeof event.payload === 'object' ? { ...event.payload } : {}
        }))
      : [];
    this.damageRatio = Math.min(1, Math.max(0, Number(config.damageRatio) || 0));
    this.depleted = config.depleted === true || this.remaining <= 0;
  }

  /**
   * 在节点耗尽后按显式秒数刷新；默认 none，旧 refreshDays 不会触发该路径。
   * @returns {boolean} 本帧是否完成了资源恢复
   */
  updateRefresh(deltaTime) {
    if (!this.depleted || this.refreshMode !== 'timed' || this.refreshIntervalSeconds <= 0) return false;
    const elapsed = Math.max(0, Number(deltaTime) || 0);
    if (elapsed <= 0) return false;
    this.refreshElapsedSeconds += elapsed;
    if (this.refreshElapsedSeconds < this.refreshIntervalSeconds) return false;
    this.remaining = this.maxRemaining;
    this.depleted = false;
    this.refreshElapsedSeconds = 0;
    this.disappearAtMs = 0;
    this.refreshAtMs = 0;
    return true;
  }

  /**
   * 采空时打上消失/刷新时间戳（墙钟 ms，幂等）：默认 30 秒后从场景消失；
   * timed 刷新点在消失时点再叠加 refreshIntervalSeconds，到点由放置运行时重建。
   * @returns {boolean} 本次是否写入了时间戳
   */
  beginDepletion(now = Date.now(), disappearDelaySeconds = 30) {
    if (!this.depleted || this.disappearAtMs > 0) return false;
    const base = Math.max(0, Number(now) || Date.now());
    this.disappearAtMs = base + Math.max(0, Number(disappearDelaySeconds) || 0) * 1000;
    this.refreshAtMs = this.refreshMode === 'timed' && this.refreshIntervalSeconds > 0
      ? this.disappearAtMs + this.refreshIntervalSeconds * 1000
      : 0;
    return true;
  }

  /** 采集结算回滚：资源不再采空时撤销消失/刷新时间戳。 */
  revokeDepletion() {
    if (this.depleted || this.remaining <= 0) return false;
    this.disappearAtMs = 0;
    this.refreshAtMs = 0;
    return true;
  }

  /** 采空后是否已到消失期限（引擎每帧检查，由放置运行时执行下架）。 */
  isDisappearDue(now = Date.now()) {
    return this.depleted && this.disappearAtMs > 0 && (Number(now) || Date.now()) >= this.disappearAtMs;
  }

  serialize() {
    return {
      schemaVersion: this.schemaVersion,
      resourceType: this.resourceType,
      itemId: this.itemId,
      remaining: this.remaining,
      maxRemaining: this.maxRemaining,
      yieldPerGather: this.yieldPerGather,
      gatherYieldRange: this.gatherYieldRange ? { ...this.gatherYieldRange } : null,
      gatherDuration: this.gatherDuration,
      requiredToolType: this.requiredToolType,
      requiredState: this.requiredState || null,
      refreshDays: this.refreshDays,
      refreshProgressDays: this.refreshProgressDays,
      refreshMode: this.refreshMode,
      refreshIntervalSeconds: this.refreshIntervalSeconds,
      refreshElapsedSeconds: this.refreshElapsedSeconds,
      disappearAtMs: this.disappearAtMs,
      refreshAtMs: this.refreshAtMs,
      guardUnitIds: [...this.guardUnitIds],
      riskEvents: this.riskEvents.map(event => ({ ...event, payload: { ...event.payload } })),
      damageRatio: this.damageRatio,
      depleted: this.depleted
    };
  }

  deserialize(data = {}) {
    if (Number.isInteger(data.remaining) && data.remaining >= 0) this.remaining = data.remaining;
    if (Number.isInteger(data.maxRemaining) && data.maxRemaining >= this.remaining) this.maxRemaining = data.maxRemaining;
    if (Number.isInteger(data.yieldPerGather) && data.yieldPerGather >= 1) this.yieldPerGather = data.yieldPerGather;
    if (data.gatherYieldRange !== undefined) {
      const min = Math.floor(Number(data.gatherYieldRange?.min) || 0);
      const max = Math.floor(Number(data.gatherYieldRange?.max) || 0);
      this.gatherYieldRange = min >= 1 && max >= min ? { min, max } : null;
    }
    if (Number.isInteger(data.refreshProgressDays) && data.refreshProgressDays >= 0) this.refreshProgressDays = data.refreshProgressDays;
    if (data.refreshMode === 'timed' || data.refreshMode === 'none') this.refreshMode = data.refreshMode;
    if (Number.isFinite(data.refreshIntervalSeconds) && data.refreshIntervalSeconds >= 0) {
      this.refreshIntervalSeconds = this.refreshMode === 'timed'
        ? Math.max(0.1, data.refreshIntervalSeconds)
        : data.refreshIntervalSeconds;
    }
    if (Number.isFinite(data.refreshElapsedSeconds) && data.refreshElapsedSeconds >= 0) {
      this.refreshElapsedSeconds = data.refreshElapsedSeconds;
    }
    if (Number.isFinite(data.disappearAtMs) && data.disappearAtMs >= 0) this.disappearAtMs = data.disappearAtMs;
    if (Number.isFinite(data.refreshAtMs) && data.refreshAtMs >= 0) this.refreshAtMs = data.refreshAtMs;
    if (Number.isFinite(data.damageRatio)) this.damageRatio = Math.min(1, Math.max(0, data.damageRatio));
    this.depleted = data.depleted === true || this.remaining <= 0;
  }
}

export default ResourceNodeComponent;
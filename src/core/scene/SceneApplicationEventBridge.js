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

import { CommandContractKind } from '../command/CommandContracts.js';

const DEFAULT_RETRY_DELAYS = Object.freeze([0.5, 1, 2]);

/** committed application event 的有序场景消费桥。 */
export class SceneApplicationEventBridge {
  constructor(config = {}) {
    if (!config.notificationBus?.subscribe) {
      throw new TypeError('SceneApplicationEventBridge requires notificationBus');
    }
    this.notificationBus = config.notificationBus;
    this.eventJournal = config.eventJournal || config.notificationBus.eventJournal || null;
    this.consumerId = String(config.consumerId || 'scene-content').trim();
    if (!this.consumerId) throw new TypeError('SceneApplicationEventBridge requires consumerId');
    this.onContentEvent = config.onContentEvent || null;
    this.presenter = config.presenter || null;
    this.onAuxiliaryEvent = config.onAuxiliaryEvent || null;
    this.diagnostics = config.diagnostics || null;
    this.retryDelays = Array.isArray(config.retryDelays)
      ? config.retryDelays.map(value => Math.max(0, Number(value) || 0))
      : [...DEFAULT_RETRY_DELAYS];
    this.maxRememberedEvents = Math.max(32, Number(config.maxRememberedEvents) || 512);
    this.seenEventIds = new Set();
    this.eventOrder = [];
    this.pendingEvents = new Map();
    this.inFlightEventIds = new Set();
    this.retryInFlight = null;
    this.recoveryInFlight = null;
    this.unsubscribe = null;
    this.disposed = false;
    this.generation = 0;
  }

  bind() {
    if (this.unsubscribe) return this.unsubscribe;
    this.disposed = false;
    this.unsubscribe = this.notificationBus.subscribe(event => this._consume(event));
    queueMicrotask(() => { void this.resumeBacklog(); });
    return this.unsubscribe;
  }

  resumeBacklog() {
    if (this.disposed) return Promise.resolve(false);
    if (this.recoveryInFlight) return this.recoveryInFlight;
    const generation = this.generation;
    this.recoveryInFlight = this._resumeBacklog(generation).finally(() => {
      if (generation === this.generation) this.recoveryInFlight = null;
    });
    return this.recoveryInFlight;
  }

  resetForRestore() {
    for (const eventId of this.inFlightEventIds) {
      this.eventJournal?.interruptConsumer?.(eventId, this.consumerId, {
        ok: false,
        code: 'consumerResetForRestore'
      });
    }
    this.generation += 1;
    this.pendingEvents.clear();
    this.inFlightEventIds.clear();
    this.retryInFlight = null;
    this.recoveryInFlight = null;
    this.seenEventIds.clear();
    this.eventOrder.length = 0;
    return true;
  }

  async _resumeBacklog(generation) {
    const backlog = this.eventJournal?.getConsumerBacklog?.(this.consumerId) || [];
    for (const record of backlog) {
      if (this.disposed || generation !== this.generation) return;
      const metadata = record.commitMetadata || {};
      await this._consume({
        kind: CommandContractKind.APPLICATION_EVENT,
        value: {
          type: record.type,
          eventId: record.eventId,
          eventDefinitionId: record.eventDefinitionId,
          source: record.source,
          actorRef: record.actorRef,
          sceneId: record.sceneId,
          payload: record.payload,
          logicalTime: record.logicalTime,
          operationId: metadata.operationId || null,
          stateId: metadata.stateId || null,
          stateType: metadata.stateType || null,
          stateRevision: metadata.stateRevision ?? null,
          eventSequence: metadata.eventSequence ?? null
        }
      });
    }
  }

  _beginReceipt(event) {
    if (!this.eventJournal?.beginConsumer) return { ok: true, tracked: false };
    return {
      ...this.eventJournal.beginConsumer({
        eventId: event.eventId,
        consumerId: this.consumerId,
        logicalTime: event.logicalTime || 0
      }),
      tracked: true
    };
  }

  _finishReceipt(event, status, result = null) {
    if (!this.eventJournal?.completeConsumer) return { ok: true };
    return this.eventJournal.completeConsumer({
      eventId: event.eventId,
      consumerId: this.consumerId,
      status,
      result,
      logicalTime: event.logicalTime || 0
    });
  }

  async _consume(event) {
    const value = event?.value;
    const eventId = value?.eventId;
    if (event?.kind !== CommandContractKind.APPLICATION_EVENT || !eventId || this.disposed) return false;
    if (this.seenEventIds.has(eventId)
      || this.pendingEvents.has(eventId)
      || this.inFlightEventIds.has(eventId)) return false;

    const receipt = this.eventJournal?.getConsumerReceipt?.(eventId, this.consumerId);
    if (receipt?.status === 'succeeded' || receipt?.status === 'skipped') {
      this._remember(eventId);
      return false;
    }

    const started = this._beginReceipt(value);
    if (started?.replay) {
      this._remember(eventId);
      return false;
    }
    if (started?.ok !== true || started?.inFlight) {
      if (started?.ok === false) {
        this._recordConsumerFailure(value, 'content', {
          code: started.code || 'consumerReceiptRejected',
          message: 'EventJournal 拒绝 application event consumer receipt'
        }, { attempt: 0, willRetry: false, exhausted: true });
      }
      return false;
    }

    const generation = this.generation;
    this.inFlightEventIds.add(eventId);
    const outcome = await this._consumeEssential(value);
    this.inFlightEventIds.delete(eventId);
    if (this.disposed || generation !== this.generation) return false;
    if (!outcome.ok) {
      const willRetry = this.retryDelays.length > 0;
      this._finishReceipt(value, willRetry ? 'pending' : 'failed', outcome);
      this._scheduleRetry(value, outcome);
      return false;
    }
    const completed = this._finishReceipt(value, 'succeeded', outcome);
    if (completed?.ok === false) {
      this._recordConsumerFailure(value, 'content', {
        code: completed.code || 'consumerReceiptCommitFailed',
        message: 'application event consumer receipt 提交失败'
      }, { attempt: 0, willRetry: false, exhausted: true });
      return false;
    }
    await this._completeEvent(value);
    return true;
  }

  async _consumeEssential(event) {
    try {
      const result = await this.onContentEvent?.(event);
      if (result?.ok === false) {
        return {
          ok: false,
          code: result.code || 'contentConsumerRejected',
          message: result.message || result.error?.message || '内容消费者拒绝 application event'
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: error?.code || 'contentConsumerFailed',
        message: error?.message || String(error)
      };
    }
  }

  _scheduleRetry(event, outcome) {
    const entry = {
      event,
      retryIndex: 0,
      remaining: this.retryDelays[0] ?? 0,
      exhausted: this.retryDelays.length === 0,
      lastFailure: outcome
    };
    this.pendingEvents.set(event.eventId, entry);
    this._recordConsumerFailure(event, 'content', outcome, {
      attempt: 0,
      willRetry: !entry.exhausted,
      exhausted: entry.exhausted
    });
    this._trimPendingEvents();
  }

  update(deltaTime = 0) {
    if (this.disposed) return false;
    const elapsed = Math.max(0, Number(deltaTime) || 0);
    for (const entry of this.pendingEvents.values()) {
      if (!entry.exhausted) entry.remaining = Math.max(0, entry.remaining - elapsed);
    }
    if (this.retryInFlight) return false;
    const entry = [...this.pendingEvents.values()]
      .find(candidate => !candidate.exhausted && candidate.remaining <= 0);
    if (!entry) return false;

    const generation = this.generation;
    this.retryInFlight = entry.event.eventId;
    this._retry(entry, generation).finally(() => {
      if (generation === this.generation) this.retryInFlight = null;
    });
    return true;
  }

  async _retry(entry, generation) {
    const event = entry.event;
    const attempt = entry.retryIndex + 1;
    const started = this._beginReceipt(event);
    if (started?.ok !== true || started?.inFlight || started?.replay) return;
    const outcome = await this._consumeEssential(event);
    if (this.disposed || generation !== this.generation) return;
    if (outcome.ok) {
      const completed = this._finishReceipt(event, 'succeeded', outcome);
      if (completed?.ok === false) return;
      this.pendingEvents.delete(event.eventId);
      await this._completeEvent(event);
      return;
    }

    entry.lastFailure = outcome;
    entry.retryIndex += 1;
    entry.exhausted = entry.retryIndex >= this.retryDelays.length;
    entry.remaining = entry.exhausted ? Infinity : this.retryDelays[entry.retryIndex];
    this._finishReceipt(event, entry.exhausted ? 'failed' : 'pending', outcome);
    this._recordConsumerFailure(event, 'content', outcome, {
      attempt,
      willRetry: !entry.exhausted,
      exhausted: entry.exhausted
    });
  }

  async _completeEvent(event) {
    if (this.disposed || this.seenEventIds.has(event.eventId)) return false;
    this._remember(event.eventId);
    const silent = event.payload?.reason === 'restore'
      || event.payload?.announce === false;
    if (silent) return true;
    await this._runBestEffort('presenter', event, () => this.presenter?.present?.(event));
    await this._runBestEffort('auxiliary', event, () => this.onAuxiliaryEvent?.(event));
    return true;
  }

  async _runBestEffort(consumer, event, callback) {
    try {
      await callback();
    } catch (error) {
      this._recordConsumerFailure(event, consumer, {
        code: error?.code || `${consumer}ConsumerFailed`,
        message: error?.message || String(error)
      }, { attempt: 0, willRetry: false, exhausted: true });
    }
  }

  _recordConsumerFailure(event, consumer, outcome, retry) {
    this.diagnostics?.recordApplicationEventConsumerFailure?.({
      type: 'applicationEventConsumerFailure',
      eventType: event.type,
      eventId: event.eventId,
      operationId: event.operationId || null,
      consumer,
      attempt: retry.attempt,
      maxRetries: this.retryDelays.length,
      willRetry: retry.willRetry,
      exhausted: retry.exhausted,
      status: 'failed',
      code: outcome.code || 'consumerFailed',
      message: outcome.message || 'application event consumer failed'
    }, { openPanel: false });
  }

  _trimPendingEvents() {
    if (this.pendingEvents.size <= this.maxRememberedEvents) return;
    for (const [eventId, entry] of this.pendingEvents) {
      if (!entry.exhausted) continue;
      this.pendingEvents.delete(eventId);
      if (this.pendingEvents.size <= this.maxRememberedEvents) break;
    }
  }

  _remember(eventId) {
    this.seenEventIds.add(eventId);
    this.eventOrder.push(eventId);
    while (this.eventOrder.length > this.maxRememberedEvents) {
      this.seenEventIds.delete(this.eventOrder.shift());
    }
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const eventId of this.inFlightEventIds) {
      this.eventJournal?.interruptConsumer?.(eventId, this.consumerId, {
        ok: false,
        code: 'sceneApplicationEventBridgeDisposed'
      });
    }
    this.pendingEvents.clear();
    this.inFlightEventIds.clear();
    this.retryInFlight = null;
    this.recoveryInFlight = null;
    this.seenEventIds.clear();
    this.eventOrder.length = 0;
  }
}

export default SceneApplicationEventBridge;

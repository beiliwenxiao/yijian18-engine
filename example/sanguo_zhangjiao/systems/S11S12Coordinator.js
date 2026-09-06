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

export const S11_BATTLE_ID = 'battle.s11.guangzong';
export const S12_BATTLE_ID = 'battle.s12.xiaquyang';
export const S11_RESCUE_ID = 'rescue.s11.zhangLiang';
export const S12_RESCUE_ID = 'rescue.s12.zhangBao';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const TERMINAL = new Set(['succeeded', 'failed']);

/**
 * S11/S12 历史内容编排器。通用 Battle/Rescue/Inventory 系统仍拥有各自领域状态，
 * 本类只负责阶段事实、跨系统原子提交和 checkpoint。
 */
export class S11S12Coordinator {
  constructor(config = {}) {
    this.rescueSystem = config.rescueSystem || null;
    this.inventoryTransactions = config.inventoryTransactions || null;
    this.getInventory = config.getInventory || (() => null);
    this.getBattleSession = config.getBattleSession || (() => ({}));
    this.canUseRescue = config.canUseRescue || (() => false);
    this.readStoryState = config.readStoryState || (() => ({}));
    this.writeStoryState = config.writeStoryState || (() => false);
    this.createCheckpoint = config.createCheckpoint || (async () => ({ ok: false, code: 'checkpointUnavailable' }));
    this.freezeBattleResult = config.freezeBattleResult || (() => ({ ok: false, code: 'battleResultFreezeUnavailable' }));
    this.createLowMoraleResult = config.createLowMoraleResult || (() => null);
    this.onEvent = config.onEvent || (() => {});
    this.definitions = config.rescueDefinitions || {};
    this.busy = false;
    this.reset();
  }

  reset() {
    this.state = {
      schemaVersion: 1,
      s11: { assassinWavesDefeated: 0, resolved: false },
      s12: { gateDeadline: null, secretPassageOpen: false, escortOpen: false, costsCommitted: false, resolved: false }
    };
  }

  getState() {
    return clone({ ...this.state, rescue: this.rescueSystem?.getState?.() || null });
  }

  serialize() { return clone(this.state); }

  validateSerialized(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.s11 || !snapshot.s12) {
      return { ok: false, code: 'invalidSnapshot' };
    }
    const waves = Number(snapshot.s11.assassinWavesDefeated);
    const waveCount = Number(this._definition('S11')?.assassinWaveCount);
    if (!Number.isInteger(waves) || waves < 0 || !Number.isInteger(waveCount) || waves > waveCount) {
      return { ok: false, code: 'invalidAssassinWaveCount' };
    }
    const deadline = snapshot.s12.gateDeadline;
    if (deadline !== null && (!Number.isFinite(Number(deadline)) || Number(deadline) < 0)) {
      return { ok: false, code: 'invalidGateDeadline' };
    }
    return { ok: true };
  }

  deserialize(snapshot) {
    const check = this.validateSerialized(snapshot);
    if (!check.ok) return check;
    this.state = clone(snapshot);
    return { ok: true, state: this.getState() };
  }

  async startS11Rescue(options = {}) {
    const definition = this._definition('S11');
    const available = this._validateStart(definition, options.mode);
    if (!available.ok || available.idempotent) return available;
    const started = this.rescueSystem.start(definition, {
      mode: options.mode,
      startedAt: options.startedAt,
      operationId: options.operationId || `start:${S11_RESCUE_ID}`
    });
    if (!started.ok) return started;
    this.state.s11 = { assassinWavesDefeated: 0, resolved: false };
    this.onEvent('s11RescueStarted', clone(started.state));
    return started;
  }

  async advanceBeaconStage(options = {}) {
    return this._advanceS11('light-beacon', 's11BeaconLit', options);
  }

  async completeS11GuardRally(options = {}) {
    const required = Number(this._definition('S11')?.requiredGuardCount);
    const count = Math.max(0, Math.floor(Number(options.guardCount) || 0));
    if (count < required) return { ok: false, code: 'guardsMissing', required, actual: count };
    return this._advanceS11('rally-guards', 's11GuardsRallied', options);
  }

  async reportS11AssassinWaveDefeated(waveNumber, options = {}) {
    const rescue = this.rescueSystem?.getState?.();
    if (rescue?.definitionId !== S11_RESCUE_ID || rescue.status !== 'active' || rescue.stageId !== 'repel-assassins') {
      return { ok: false, code: 'stageNotActive', stageId: rescue?.stageId || null };
    }
    const wave = Math.floor(Number(waveNumber));
    const completed = this.state.s11.assassinWavesDefeated;
    if (wave <= completed && wave >= 1) return { ok: true, idempotent: true, wave, state: this.getState() };
    const waveCount = Number(this._definition('S11')?.assassinWaveCount);
    if (wave !== completed + 1 || wave > waveCount) return { ok: false, code: 'assassinWaveOutOfOrder', expected: completed + 1 };
    this.state.s11.assassinWavesDefeated = wave;
    this.onEvent('s11AssassinWaveDefeated', { wave, total: waveCount });
    if (wave < waveCount) return { ok: true, completed: false, wave, state: this.getState() };
    const advanced = await this._advanceS11('repel-assassins', 's11AssassinsRepelled', options);
    if (!advanced?.ok) this.state.s11.assassinWavesDefeated = completed;
    return advanced;
  }

  async completeS11WestGateBreakout(options = {}) {
    return this._advanceS11('breakout-west-gate', 's11WestGateBreakout', options);
  }

  async updateS11({ timestamp, targetAlive = true } = {}) {
    const rescue = this.rescueSystem?.getState?.();
    if (rescue?.definitionId !== S11_RESCUE_ID || rescue.status !== 'active') return { ok: true, active: false };
    const before = this.rescueSystem.serialize();
    let outcome;
    if (!targetAlive) {
      outcome = this.rescueSystem.fail(`targetDefeated:${rescue.stageId}`, {
        failedAt: timestamp, operationId: `fail:${S11_RESCUE_ID}:target:${rescue.stageId}`
      });
    } else if (Number(timestamp) > Number(rescue.deadline)) {
      outcome = this.rescueSystem.fail(`deadlineExceeded:${rescue.stageId}`, {
        failedAt: timestamp, operationId: `fail:${S11_RESCUE_ID}:deadline:${rescue.stageId}`
      });
    } else {
      outcome = this.rescueSystem.update(timestamp);
    }
    return this._settleIfTerminal('S11', outcome, before);
  }

  /** 士气为 0 时不启动实时战场，直接冻结敌胜事实。 */
  resolveS12PreBattleMorale({ friendlyMorale, result } = {}) {
    const morale = Math.max(0, Math.floor(Number(friendlyMorale) || 0));
    if (morale > 0) return { ok: true, battleMayStart: true, morale };
    const candidate = result || this.createLowMoraleResult({
      battleId: S12_BATTLE_ID,
      winnerFactionId: 'han_government',
      failureReason: 'friendlyMoraleZero'
    });
    if (!candidate) return { ok: false, code: 'lowMoraleResultMissing', failureReason: 'friendlyMoraleZero' };
    const frozen = this.freezeBattleResult(candidate);
    const response = frozen || { ok: false, code: 'battleResultFreezeUnavailable' };
    if (response.ok) this.onEvent('s12LowMoraleDefeat', { ...clone(response), failureReason: 'friendlyMoraleZero' });
    return { ...response, battleMayStart: false, failureReason: 'friendlyMoraleZero' };
  }

  async startS12Rescue(options = {}) {
    if (this.busy) return { ok: false, code: 'coordinatorBusy' };
    const definition = this._definition('S12');
    const available = this._validateStart(definition, options.mode);
    if (!available.ok || available.idempotent) return available;
    const inventory = this.getInventory();
    if (!inventory || !this.inventoryTransactions) return { ok: false, code: 'inventoryUnavailable' };

    const costs = this._costEntries(definition.costs);
    for (const entry of costs) {
      const preview = this.inventoryTransactions.previewRemove(inventory, entry.itemId, entry.quantity);
      if (preview.remainder > 0) {
        return { ok: false, code: 'rescueResourceMissing', itemId: entry.itemId,
          required: entry.quantity, available: preview.accepted, missing: preview.remainder };
      }
    }

    const operationId = options.costOperationId || `cost:${S12_RESCUE_ID}`;
    const inventoryBefore = clone(inventory.exportItems?.() || []);
    const rescueBefore = this.rescueSystem.serialize();
    const storyBefore = clone(this.readStoryState() || {});
    this.busy = true;
    try {
      const removed = this.inventoryTransactions.commit({ type: 'batchRemove', inventory, entries: costs, operationId });
      if (!removed.ok) return removed;
      const started = this.rescueSystem.start(definition, {
        mode: options.mode,
        startedAt: options.startedAt,
        costs: clone(definition.costs || {}),
        operationId: options.operationId || `start:${S12_RESCUE_ID}`
      });
      if (!started.ok) throw new Error(started.code || 'rescueStartRejected');

      this.state.s12 = {
        gateDeadline: started.state.deadline,
        secretPassageOpen: false,
        escortOpen: false,
        costsCommitted: true,
        resolved: false
      };
      const draft = {
        ...storyBefore,
        s12RescueRoute: {
          status: 'confirmed', operationId, costs: clone(definition.costs || {}),
          gateDeadline: started.state.deadline
        },
        lastCheckpointId: 'checkpoint.S12.rescueRoute'
      };
      if (this.writeStoryState(clone(draft)) === false) throw new Error('storyCommitRejected');
      const checkpoint = await this.createCheckpoint({
        checkpointId: 'checkpoint.S12.rescueRoute', sceneId: 'S12', operationId
      });
      if (checkpoint?.ok === false) throw new Error(checkpoint.message || checkpoint.code || 'checkpointRejected');
      this.onEvent('s12RescueStarted', { state: clone(started.state), costs: clone(definition.costs || {}) });
      return started;
    } catch (error) {
      inventory.loadItems?.(inventoryBefore);
      this.inventoryTransactions.forgetOperation?.(operationId);
      this.rescueSystem.deserialize(rescueBefore);
      this.writeStoryState(storyBefore);
      this.state.s12 = { gateDeadline: null, secretPassageOpen: false, escortOpen: false, costsCommitted: false, resolved: false };
      return { ok: false, code: 's12RescueStartRolledBack', message: String(error?.message || error) };
    } finally {
      this.busy = false;
    }
  }

  async updateS12({ timestamp, gateIntegrity = 1, targetAlive = true } = {}) {
    const rescue = this.rescueSystem?.getState?.();
    if (rescue?.definitionId !== S12_RESCUE_ID || rescue.status !== 'active') return { ok: true, active: false };
    const now = Number(timestamp ?? this.rescueSystem.now?.());
    const before = this.rescueSystem.serialize();
    let outcome;
    if (!targetAlive) {
      outcome = this.rescueSystem.fail(`targetDefeated:${rescue.stageId}`, {
        failedAt: now, operationId: `fail:${S12_RESCUE_ID}:target:${rescue.stageId}`
      });
    } else if (rescue.stageId === 'defend-yamen-gate') {
      if (Number(gateIntegrity) <= 0 && now < this.state.s12.gateDeadline) {
        outcome = this.rescueSystem.fail('yamenGateBreachedEarly', {
          failedAt: now, operationId: `fail:${S12_RESCUE_ID}:gate-breached`
        });
      } else if (now >= this.state.s12.gateDeadline) {
        outcome = this.rescueSystem.completeStage('defend-yamen-gate', {
          completedAt: this.state.s12.gateDeadline,
          operationId: `complete:${S12_RESCUE_ID}:defend-yamen-gate`
        });
        if (outcome.ok && !outcome.completed) {
          const extended = this._extendS12PostGateWindow();
          if (!extended.ok) return extended;
          this.state.s12.secretPassageOpen = true;
          this.onEvent('s12SecretPassageOpened', { gateDeadline: this.state.s12.gateDeadline });
          return { ...outcome, state: this.getState() };
        }
      } else {
        outcome = this.rescueSystem.update(now);
      }
    } else {
      const activeDeadline = Number(rescue.deadline);
      if (Number.isFinite(now) && Number.isFinite(activeDeadline) && now > activeDeadline) {
        const reason = rescue.stageId === 'open-secret-passage' ? 'secretPassageFailed' : 'escortFailed';
        outcome = this.rescueSystem.fail(reason, {
          failedAt: now, operationId: `fail:${S12_RESCUE_ID}:${reason}`
        });
      } else outcome = this.rescueSystem.update(now);
    }
    return this._settleIfTerminal('S12', outcome, before);
  }

  async completeS12SecretPassage(options = {}) {
    const rescue = this.rescueSystem?.getState?.();
    if (!this.state.s12.secretPassageOpen) return { ok: false, code: 'secretPassageLocked' };
    if (rescue?.stageId !== 'open-secret-passage') return { ok: false, code: 'stageNotActive', stageId: rescue?.stageId || null };
    const outcome = this.rescueSystem.completeStage('open-secret-passage', {
      completedAt: options.completedAt,
      operationId: options.operationId || `complete:${S12_RESCUE_ID}:open-secret-passage`
    });
    if (outcome.ok && !outcome.completed) {
      this.state.s12.escortOpen = true;
      this.onEvent('s12EscortOpened', clone(outcome.state));
    }
    return outcome;
  }

  async failS12SecretPassage(options = {}) {
    return this._failS12Stage('open-secret-passage', 'secretPassageFailed', options);
  }

  async completeS12Evacuation(options = {}) {
    const rescue = this.rescueSystem?.getState?.();
    if (!this.state.s12.escortOpen) return { ok: false, code: 'escortLocked' };
    if (rescue?.stageId !== 'escort-zhang-bao') return { ok: false, code: 'stageNotActive', stageId: rescue?.stageId || null };
    const before = this.rescueSystem.serialize();
    const outcome = this.rescueSystem.completeStage('escort-zhang-bao', {
      completedAt: options.completedAt,
      operationId: options.operationId || `complete:${S12_RESCUE_ID}:escort-zhang-bao`
    });
    return this._settleIfTerminal('S12', outcome, before);
  }

  async failS12Escort(options = {}) {
    return this._failS12Stage('escort-zhang-bao', 'escortFailed', options);
  }

  /**
   * 观战或战前直接失败时，救援不会启动，但仍必须冻结人物死亡事实。
   * 复用统一 _settle 事务，保证 StoryState、checkpoint 与幂等语义一致。
   */
  async settleUnavailableRescue(sceneId, options = {}) {
    if (!['S11', 'S12'].includes(sceneId)) return { ok: false, code: 'invalidSceneId' };
    const rescueId = sceneId === 'S11' ? S11_RESCUE_ID : S12_RESCUE_ID;
    const existing = this.readStoryState()?.rescueResults?.[rescueId];
    if (existing) return { ok: true, idempotent: true, result: clone(existing) };
    if (options.mode && options.mode !== 'observe' && options.force !== true) {
      return { ok: false, code: 'rescueStillAvailable', mode: options.mode };
    }
    const beforeRescue = this.rescueSystem?.serialize?.();
    if (!beforeRescue) return { ok: false, code: 'rescueUnavailable' };
    const result = {
      rescueId,
      battleId: sceneId === 'S11' ? S11_BATTLE_ID : S12_BATTLE_ID,
      status: 'failed',
      survived: false,
      completedAt: Number(options.completedAt ?? this.rescueSystem.now?.() ?? 0),
      failureReason: String(options.reason || (options.mode === 'observe' ? 'modeObserved' : 'rescueUnavailable')),
      completedStageIds: [],
      costs: {}
    };
    return this._settle(sceneId, result, beforeRescue);
  }

  /**
   * Canonical rescue command entry. Trigger IDs are intentionally not interpreted here:
   * callers provide the stable rescue definition ID and its declared stage/signal payload.
   */
  async executeCommand({ rescueId, operation, stageId, waveNumber, ...payload } = {}) {
    const definition = this._definitionById(rescueId);
    if (!definition) return { ok: false, code: 'unknownRescueDefinition', rescueId };
    if (operation === 'start') {
      return rescueId === S11_RESCUE_ID ? this.startS11Rescue(payload) : this.startS12Rescue(payload);
    }
    if (operation === 'recordWave') {
      return rescueId === S11_RESCUE_ID
        ? this.reportS11AssassinWaveDefeated(waveNumber, payload)
        : { ok: false, code: 'unsupportedRescueSignal', rescueId, operation };
    }
    if (operation !== 'completeStage') return { ok: false, code: 'unsupportedRescueOperation', operation };
    if (rescueId === S11_RESCUE_ID) {
      if (stageId === 'light-beacon') return this.advanceBeaconStage(payload);
      if (stageId === 'rally-guards') return this.completeS11GuardRally(payload);
      if (stageId === 'breakout-west-gate') return this.completeS11WestGateBreakout(payload);
    }
    if (rescueId === S12_RESCUE_ID) {
      if (stageId === 'open-secret-passage') return this.completeS12SecretPassage(payload);
      if (stageId === 'escort-zhang-bao') return this.completeS12Evacuation(payload);
    }
    return { ok: false, code: 'unknownRescueStage', rescueId, stageId };
  }

  _definitionById(rescueId) {
    return this.definitions[rescueId]
      || Object.values(this.definitions).find(definition => definition?.id === rescueId)
      || null;
  }

  _definition(sceneId) {
    return this.definitions[sceneId] || this.definitions[sceneId === 'S11' ? S11_RESCUE_ID : S12_RESCUE_ID] || null;
  }

  _validateStart(definition, mode) {
    if (!definition || !this.rescueSystem) return { ok: false, code: 'rescueUnavailable' };
    if (mode !== 'intervene') return { ok: false, code: 'modeNotAllowed', mode };
    if (!this.canUseRescue()) {
      return { ok: false, code: 'battleNotIntervened' };
    }
    const currentBattleId = this.getBattleSession()?.battleId || null;
    if (currentBattleId && currentBattleId !== definition.battleId) {
      return { ok: false, code: 'battleMismatch', battleId: currentBattleId };
    }
    const existing = this.rescueSystem.getState();
    if (existing.status === 'idle') return { ok: true };
    if (existing.definitionId === definition.id) return { ok: true, idempotent: true, state: existing };
    if (!TERMINAL.has(existing.status)) return { ok: false, code: 'rescueAlreadyActive' };
    const persisted = this.readStoryState()?.rescueResults?.[existing.definitionId];
    if (!persisted) return { ok: false, code: 'previousRescueNotPersisted' };
    this.rescueSystem.reset();
    return { ok: true };
  }

  async _advanceS11(stageId, event, options) {
    const rescue = this.rescueSystem?.getState?.();
    if (rescue?.definitionId !== S11_RESCUE_ID || rescue.status !== 'active' || rescue.stageId !== stageId) {
      return { ok: false, code: 'stageNotActive', stageId: rescue?.stageId || null };
    }
    const before = this.rescueSystem.serialize();
    const outcome = this.rescueSystem.completeStage(stageId, {
      completedAt: options.completedAt,
      operationId: options.operationId || `complete:${S11_RESCUE_ID}:${stageId}`
    });
    if (outcome.ok) this.onEvent(event, clone(outcome.state || outcome.result));
    return this._settleIfTerminal('S11', outcome, before);
  }

  async _failS12Stage(stageId, reason, options) {
    const rescue = this.rescueSystem?.getState?.();
    if (rescue?.definitionId !== S12_RESCUE_ID || rescue.status !== 'active' || rescue.stageId !== stageId) {
      return { ok: false, code: 'stageNotActive', stageId: rescue?.stageId || null };
    }
    const before = this.rescueSystem.serialize();
    const outcome = this.rescueSystem.fail(reason, {
      failedAt: options.failedAt,
      operationId: options.operationId || `fail:${S12_RESCUE_ID}:${reason}`
    });
    return this._settleIfTerminal('S12', outcome, before);
  }

  _extendS12PostGateWindow() {
    const definition = this._definition('S12');
    const seconds = Number(definition?.postGateDuration);
    const snapshot = this.rescueSystem.serialize();
    if (snapshot.status !== 'active' || snapshot.stageIndex !== 1) return { ok: false, code: 'postGateStateMismatch' };
    snapshot.definition.duration = Number(snapshot.definition.duration) + seconds;
    snapshot.remaining = seconds;
    return this.rescueSystem.deserialize(snapshot);
  }

  _costEntries(costs = {}) {
    return ['resource.food', 'resource.herb']
      .map(itemId => ({ itemId, quantity: Math.max(0, Math.floor(Number(costs[itemId]) || 0)) }))
      .filter(entry => entry.quantity > 0);
  }

  async _settleIfTerminal(sceneId, outcome, beforeRescue) {
    if (!outcome?.completed || !outcome.result) return outcome;
    const settled = await this._settle(sceneId, outcome.result, beforeRescue);
    return settled.ok ? { ...outcome, settlement: settled } : settled;
  }

  async _settle(sceneId, result, beforeRescue) {
    if (this.busy) return { ok: false, code: 'coordinatorBusy' };
    const rescueId = sceneId === 'S11' ? S11_RESCUE_ID : S12_RESCUE_ID;
    if (result?.rescueId !== rescueId) return { ok: false, code: 'rescueResultMismatch' };
    const beforeStory = clone(this.readStoryState() || {});
    const persisted = beforeStory.rescueResults?.[rescueId];
    if (persisted) return { ok: true, idempotent: true, result: clone(persisted) };

    const survived = result.survived === true;
    const tags = new Set(beforeStory.storyTags || []);
    const person = sceneId === 'S11' ? 'zhangLiang' : 'zhangBao';
    tags.delete(`rescue.${person}.${survived ? 'failed' : 'survived'}`);
    tags.add(`rescue.${person}.${survived ? 'survived' : 'failed'}`);
    const draft = {
      ...beforeStory,
      rescueResults: { ...(beforeStory.rescueResults || {}), [rescueId]: clone(result) },
      storyTags: [...tags],
      lastCheckpointId: `checkpoint.${sceneId}.${person}Rescue`
    };
    if (sceneId === 'S11') {
      draft.zhangLiangSurvived = survived;
      draft.yellowTurbanEvacuatedToXiaquyang = survived ? 20000 : 0;
      draft.s12DefenseBoost = survived
        ? clone(this._definition('S11')?.successEffects?.s12DefenseBoost || {})
        : null;
    } else {
      draft.zhangBaoSurvived = survived;
      draft.s12Resolved = true;
      draft.s12RescueRoute = {
        ...(beforeStory.s12RescueRoute || {}), status: 'resolved', survived,
        failureReason: result.failureReason || null, costs: clone(result.costs || {})
      };
    }

    this.busy = true;
    try {
      if (this.writeStoryState(clone(draft)) === false) throw new Error('storyCommitRejected');
      const checkpoint = await this.createCheckpoint({
        checkpointId: draft.lastCheckpointId, sceneId, rescueId,
        operationId: `settle:${rescueId}`
      });
      if (checkpoint?.ok === false) throw new Error(checkpoint.message || checkpoint.code || 'checkpointRejected');
      this.state[sceneId.toLowerCase()].resolved = true;
      try {
        await this.onEvent(`${sceneId.toLowerCase()}RescueResolved`, { result: clone(result), storyState: clone(draft) });
      } catch (error) {
        return { ok: true, result: clone(result), eventError: String(error?.message || error) };
      }
      return { ok: true, result: clone(result), storyState: clone(draft) };
    } catch (error) {
      this.writeStoryState(beforeStory);
      this.rescueSystem.deserialize(beforeRescue);
      return { ok: false, code: 'rescueSettlementRolledBack', message: String(error?.message || error) };
    } finally {
      this.busy = false;
    }
  }
}

export default S11S12Coordinator;

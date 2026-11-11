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

/************************************************************
 * YiJian18-Engine - reusable scene battle session runtime
 ************************************************************/

import { BattleSystem, BattleMode, BattleState } from '../../systems/BattleSystem.js';
import { BattlefieldRuntimeSystem } from '../../systems/BattlefieldRuntimeSystem.js';
import { CityWarSystem } from '../../systems/CityWarSystem.js';
import { BattleModeView } from '../../ui/BattleModeView.js';
import { BattleHudView } from '../../ui/BattleHudView.js';
import { BattleResultView } from '../../ui/BattleResultView.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

/** 战果卡操作失败码 → 玩家可读文案（未知码原样显示，便于排查）。 */
const RESULT_FAILURE_LABELS = Object.freeze({
  warLogisticsUnavailable: '军需服务未装配',
  battleEntryUnavailable: '入场服务未装配',
  unknownArmy: '未找到军团',
  cacheMissing: '辎重不存在',
  alreadyRecovered: '辎重已追回',
  cacheExpired: '辎重已过期',
  battleIdRequired: '缺少战役标识',
  rejoinForbidden: '本场禁止重新接管',
  supportUsed: '本场支援身份已用过',
  previewDefeated: '预演已判负，只能观战',
  supportMustArriveInPerson: '随军需本人抵达战场',
  onsiteRequiresPlayer: '现场接管需本人到场'
});

/**
 * Owns one active battle session and its generic UI. Historical scene rules are
 * supplied through hooks; this module never depends on canonical Demo scene IDs.
 */
export class SceneBattleRuntime {
  constructor(config = {}) {
    this.config = config;
    this.hooks = config.hooks || {};
    this.getEntities = config.getEntities || (() => []);
    this.getPlayer = config.getPlayer || (() => null);
    this.getCurrentSceneId = config.getCurrentSceneId || (() => null);
    this.getFlowByScene = config.getFlowByScene || (() => null);
    this.getFlowByBattle = config.getFlowByBattle || (() => null);
    this.getEntryPoint = config.getEntryPoint || (() => null);
    this.getAppliedResultIds = config.getAppliedResultIds || (() => []);
    this.showTip = config.showTip || (() => {});
    this.notify = config.notify || (() => {});
    this.requestCheckpoint = config.requestCheckpoint || (async () => ({ ok: true }));
    this.warLogistics = config.warLogistics || null;
    this.definitions = new Map();
    this.activeDefinition = null;
    this.busy = false;
    this.disposed = false;
    // P1：战果发现后先挂起，等 battle.settle 命令触发领域结算（不在此处直接提交）
    this.pendingSettlement = null;
    this._settlePromise = null;
    this._generation = 0;
    this._previousEffectFilter = null;
    this._createOwnedRuntime(config);
  }

  _createOwnedRuntime(config) {
    this.battleSystem = new BattleSystem({
      battleClient: config.battleClient,
      validator: config.validator,
      onEvent: (event, data) => {
        if (event === 'battleModeSelected') {
          this.notify(data.mode === BattleMode.OBSERVE ? '本场已选择观战' : '本场已选择介入', 'info');
        }
        this.hooks.onBattleEvent?.(event, clone(data));
      }
    });
    this.cityWarSystem = new CityWarSystem({
      validator: config.validator,
      readState: config.cityWarState?.read,
      commitState: config.cityWarState?.commit,
      restoreState: config.cityWarState?.restore,
      createCheckpoint: checkpoint => this.requestCheckpoint(checkpoint),
      onEvent: (event, data) => {
        if (event === 'battleResultRolledBack') {
          this.notify('战果检查点失败，城市与战争状态已回滚', 'error');
        }
        this.hooks.onCityWarEvent?.(event, clone(data));
      }
    });
    this.modeView = new BattleModeView({
      width: Math.min(560, Number(config.viewWidth) - 32 || 560),
      onCommand: command => { void this.handleModeCommand(command); }
    });
    this.hudView = new BattleHudView({ width: Math.min(500, Number(config.viewWidth) - 32 || 500) });
    this.resultView = new BattleResultView({
      width: Math.min(520, Number(config.viewWidth) - 32 || 520),
      onCommand: command => { void this.handleResultCommand(command); }
    });
    this.battlefieldRuntime = new BattlefieldRuntimeSystem({
      battleSystem: this.battleSystem,
      aiSystem: config.aiSystem,
      onEvent: (event, data) => {
        if (event === 'battlefieldStarted') this.hudView.setSnapshot(data);
        if (event === 'battlefieldResolved') this.hudView.clear();
        this.hooks.onBattlefieldEvent?.(event, clone(data));
      }
    });
    this._previousEffectFilter = config.combatSystem?.setEffectAmountFilter?.(
      (context, amount) => this.battleSystem.filterEffectAmount(context, amount)
    ) || null;
  }

  /**
   * 战果卡命令：追回辎重 / 收拢散兵 / 接管身份切换。
   * 领域服务未接线时静默忽略（保持旧行为），成功后即时更新面板快照。
   */
  handleResultCommand(command = {}) {
    if (!command || typeof command !== 'object') return { ok: false, code: 'invalidCommand' };
    if (command.type === 'close') {
      this.resultView.close();
      return { ok: true };
    }
    const snapshot = this.resultView.snapshot;
    const failure = (result, fallback) => {
      const code = result?.code || fallback;
      this.notify?.(`操作未完成：${RESULT_FAILURE_LABELS[code] || code}`, 'error');
      return result || { ok: false, code: fallback };
    };
    if (command.type === 'recover') {
      const result = this.warLogistics?.recoverSupply?.({
        cacheId: command.cacheId ?? null,
        army: this._resolveBattleArmy()
      }) || null;
      if (result?.ok !== true) return failure(result, 'warLogisticsUnavailable');
      if (snapshot) {
        const caches = Array.isArray(snapshot.supplyCaches) ? snapshot.supplyCaches : [];
        snapshot.supplyCaches = caches.filter(cache => {
          const id = cache?.cacheId ?? cache?.id ?? null;
          return id !== command.cacheId;
        });
      }
      this.notify?.('已追回辎重', 'success');
      return result;
    }
    if (command.type === 'regroup') {
      const result = this.warLogistics?.regroup?.({
        armyId: this._resolveBattleArmy()?.id ?? null
      }) || null;
      if (result?.ok !== true) return failure(result, 'warLogisticsUnavailable');
      if (snapshot) {
        const count = Number(snapshot.scattered?.count ?? snapshot.scattered ?? 0);
        const remaining = Math.max(0, count - (Number(result.returned ?? result.regrouped ?? 0) || 0));
        snapshot.scattered = { count: remaining };
      }
      this.notify?.(`已收拢散兵 ${Number(result.returned) || 0} 人`, 'success');
      return result;
    }
    if (command.type === 'entry') {
      const result = this.warLogistics?.joinBattle?.({
        battleId: this.battleSystem?.definition?.battleId || null,
        identity: command.identity,
        entry: 'battleResult'
      }) || null;
      if (result?.ok !== true) return failure(result, 'battleEntryUnavailable');
      if (snapshot) snapshot.identity = command.identity;
      this.notify?.(`已切换为${command.identity === 'support' ? '随军' : command.identity === 'takeover' ? '接管' : '观战'}`, 'info');
      return result;
    }
    return { ok: false, code: 'unknownCommand' };
  }

  _resolveBattleArmy() {
    const definition = this.battleSystem?.definition || {};
    const state = this.battleSystem?.state || {};
    const armyId = definition.armyId || definition.playerArmyId || state.armyId || null;
    // 未映射到具体军团时也交给端口决定（内容层可回落到玩家军团）
    return this.warLogistics?.resolveArmy?.(armyId) || null;
  }

  /**
   * 给结果面板快照附加军需数据（两本账/散兵/辎重/身份）。
   * 领域服务未接线时原样返回，旧行为零变化。
   */
  _buildResultSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const army = this._resolveBattleArmy();
    const battleId = snapshot.result?.battleId || this.battleSystem?.definition?.battleId || null;
    const report = this.warLogistics?.describeBattle?.({ battleId, armyId: army?.id ?? null }) || null;
    return report ? { ...snapshot, ...report } : snapshot;
  }


  registerDefinitions(definitions = []) {
    if (!Array.isArray(definitions)) throw new TypeError('battleDefinitions must be an array');
    const next = new Map();
    for (const source of definitions) {
      const definition = clone(source);
      if (!definition?.battleId || next.has(definition.battleId)) {
        throw new Error(`invalidBattleDefinition:${definition?.battleId || 'missing'}`);
      }
      next.set(definition.battleId, definition);
    }
    this.definitions = next;
    this.activeDefinition = null;
    return [...next.values()].map(clone);
  }

  getDefinition(battleId) {
    return clone(this.definitions.get(battleId) || null);
  }

  /** Return an immutable projection of the active battle session. */
  getSessionState() {
    const state = this.battleSystem?.getState?.() || {};
    return clone({
      battleId: this.battleSystem?.definition?.battleId || state.definition?.battleId || null,
      mode: this.battleSystem?.mode || state.mode || null,
      state: this.battleSystem?.state || state.state || null,
      result: state.result || null,
      busy: this.busy === true,
      battlefieldActive: this.battlefieldRuntime?.active === true
    });
  }

  isBattlefieldActive() {
    return this.battlefieldRuntime?.active === true;
  }

  canUseRescue() {
    return this.battleSystem?.canUseRescue?.() === true;
  }

  freezeResult(candidate) {
    return this.battleSystem?.freezeResult?.(clone(candidate))
      || { ok: false, code: 'battleRuntimeUnavailable' };
  }

  captureCityWarState() {
    return clone(this.cityWarSystem?.serialize?.() || null);
  }

  restoreCityWarState(snapshot) {
    if (!snapshot) return { ok: false, code: 'cityWarSnapshotMissing' };
    return this.cityWarSystem?.deserialize?.(clone(snapshot))
      || { ok: false, code: 'cityWarRuntimeUnavailable' };
  }

  applyBattleResult(params = {}) {
    if (!this.cityWarSystem?.applyBattleResult) {
      return Promise.resolve({ ok: false, code: 'cityWarRuntimeUnavailable' });
    }
    return this.cityWarSystem.applyBattleResult(clone(params));
  }

  _resolveDefinition(flow) {
    const source = this.definitions.get(flow?.battleId);
    if (!source) return null;
    const projected = this.hooks.projectDefinition?.(clone(source), clone(flow));
    return clone(projected || source);
  }

  activateBattle(definition) {
    if (!definition || this.disposed) return false;
    const currentBattleId = this.battleSystem.definition?.battleId;
    if (!currentBattleId || currentBattleId === definition.battleId) {
      this.activeDefinition = clone(definition);
      return true;
    }
    if (this.battleSystem.state !== BattleState.RESOLVED) return false;
    const frozenResult = this.battleSystem.getState().result;
    if (!frozenResult || !this.getAppliedResultIds().includes(frozenResult.resultId)) return false;
    this.battlefieldRuntime.stop({ entities: this.getEntities() });
    this.battlefieldRuntime.reset();
    this.battleSystem.reset();
    this.activeDefinition = clone(definition);
    return true;
  }

  async openByScene(sceneId) {
    const flow = this.getFlowByScene(sceneId);
    const definition = this._resolveDefinition(flow);
    const gate = await this.hooks.beforeOpen?.({ sceneId, flow: clone(flow), definition: clone(definition), runtime: this });
    if (gate === false || gate?.ok === false) return false;
    if (!flow || this.getCurrentSceneId() !== sceneId || !definition) {
      this.showTip(flow?.unavailableMessage || '未知战役不能选择参战模式', { title: '无法选择战役模式' });
      return false;
    }
    if (!this.activateBattle(definition)) {
      this.showTip(flow.conflictMessage, { title: '战役状态冲突' });
      return false;
    }
    const frozenResult = this.battleSystem.getState().result;
    const resultApplied = frozenResult && this.getAppliedResultIds().includes(frozenResult.resultId);
    if (this.battleSystem.state === BattleState.RESOLVED && resultApplied) {
      this.resultView.open(this._buildResultSnapshot({
        title: flow.appliedTitle, result: frozenResult, mode: this.battleSystem.mode,
        winnerName: frozenResult?.winnerFactionId, worldChanges: clone(flow.worldChanges),
        message: '该战果已经冻结并写入检查点，不能重新选择参战模式。'
      }));
      return true;
    }
    if (this.battleSystem.state === BattleState.RESOLVED && frozenResult) {
      // P1：战果已冻结但尚未提交结算——不重新开模式，补发结算命令
      const pending = this.getPendingSettlement();
      if (pending) this.hooks.settlementRequired?.({ ...pending, runtime: this });
      return true;
    }
    if (this.battleSystem.state === BattleState.ACTIVE && this.battlefieldRuntime.active) {
      this.showTip(flow.activeMessage, { title: '战役进行中' });
      return true;
    }
    try {
      const requestId = `create:${flow.battleId}`;
      const started = this.battleSystem.state === BattleState.IDLE
        ? await this.battleSystem.start(definition, { requestId })
        : await this.battleSystem.rehydrate({ requestId });
      if (!started?.ok) throw new Error(started?.code || 'battleStartRejected');
      this.modeView.open({
        ...clone(definition.modeView || {}),
        selectedMode: this.battleSystem.mode || BattleMode.OBSERVE
      });
      return true;
    } catch (error) {
      this.showTip(`创建${flow.locationName}战役失败：${error?.message || error}`, { title: '战役服务错误' });
      return false;
    }
  }

  async handleModeCommand(command = {}) {
    if (command.type === 'cancel') {
      if (!this.busy) this.modeView.close();
      return true;
    }
    if (command.type !== 'selectMode') return false;
    return this.selectMode(command.mode, this.getCurrentSceneId());
  }

  async selectMode(mode, sceneId = this.getCurrentSceneId()) {
    const flow = this.getFlowByScene(sceneId);
    const definition = this._resolveDefinition(flow);
    if (this.busy || !flow || this.getCurrentSceneId() !== sceneId || !definition
      || definition.battleId !== flow.battleId || !this.activateBattle(definition)) return false;
    this.busy = true;
    this.modeView.setBusy(true);
    const generation = this._generation;
    try {
      if (this.battleSystem.mode && this.battleSystem.mode !== mode) {
        throw new Error(`modeLocked:${this.battleSystem.mode}`);
      }
      const before = await this.hooks.beforeSelect?.({ mode, sceneId, flow: clone(flow), definition: clone(definition), runtime: this });
      if (before === false || before?.ok === false) {
        throw new Error(before?.message || before?.code || 'battlePreparationRejected');
      }
      const frozenResult = this.battleSystem.getState().result;
      if (frozenResult) {
        await this.settleFrozenResult({ resultId: frozenResult.resultId });
        this.modeView.close();
        return true;
      }
      const entry = this.getEntryPoint(sceneId, definition.entryPointRef || 'battle-intervention');
      if (!this.battleSystem.mode) {
        const selected = await this.battleSystem.selectMode(mode, {
          operationId: `mode:${definition.battleId}:${mode}`,
          heroId: this.getPlayer()?.id,
          entryPoint: entry ? { x: entry.x, y: entry.y } : null
        });
        if (!selected?.ok) throw new Error(selected?.code || 'modeSelectionRejected');
      }
      const immediate = await this.hooks.resolveBeforeBattlefield?.({
        mode: this.battleSystem.mode, sceneId, flow: clone(flow), definition: clone(definition), runtime: this
      });
      if (immediate?.ok === false) {
        throw new Error(immediate.message || immediate.code || 'battlefieldPreconditionRejected');
      }
      if (immediate?.result) {
        await this.settleResult(immediate.result, null);
        this.modeView.close();
        if (immediate.message) this.showTip(immediate.message, { title: immediate.title || '未能开战' });
        return true;
      }
      await this.hooks.beforeBattlefieldStart?.({ sceneId, definition: clone(definition), runtime: this });
      const started = this.battlefieldRuntime.start({
        entities: this.getEntities(), playerEntity: this.getPlayer(),
        playerFactionId: definition.playerInterventionFactionId || 'yellow_turban'
      });
      if (!started?.ok) throw new Error(started?.code || 'battlefieldStartRejected');
      if (this.battleSystem.mode === BattleMode.INTERVENE && entry) {
        this.config.movePlayerTo?.(entry);
      }
      this.hudView.setSnapshot(started.snapshot);
      this.modeView.close();
      this.showTip(
        this.battleSystem.mode === BattleMode.OBSERVE
          ? `${flow.locationName}两军开始交战。观战期间不能影响参战单位。`
          : flow.interventionMessage,
        { title: '战役开始' }
      );
      return true;
    } catch (error) {
      await this.hooks.onSelectFailure?.({ mode, sceneId, error, runtime: this });
      this.showTip(`战役模式未启动：${error?.message || error}。可保留当前选择重试。`, { title: '启动失败' });
      return false;
    } finally {
      if (generation === this._generation && !this.disposed) {
        this.busy = false;
        this.modeView.setBusy(false);
      }
    }
  }

  update(deltaTime) {
    if (this.disposed || !this.getFlowByScene(this.getCurrentSceneId())
      || !this.battlefieldRuntime.active || this.busy) return null;
    const updated = this.battlefieldRuntime.update(deltaTime, this.getEntities());
    if (updated?.snapshot) this.hudView.setSnapshot(updated.snapshot);
    if (!updated?.resolved || !updated.result) return updated;
    // P1：update 只负责“发现战果并挂起”，真正的领域结算由 battle.settle 命令触发。
    this.pendingSettlement = {
      result: clone(updated.result),
      snapshot: clone(updated.snapshot || this.battlefieldRuntime.getSnapshot())
    };
    this.hooks.settlementRequired?.({
      result: clone(this.pendingSettlement.result),
      battleSnapshot: clone(this.pendingSettlement.snapshot),
      runtime: this
    });
    return updated;
  }

  hasPendingSettlement() {
    if (this.pendingSettlement) return true;
    return this.getPendingSettlement() != null;
  }

  getPendingSettlement() {
    if (this.pendingSettlement) return clone(this.pendingSettlement);
    const result = this.battleSystem.getState().result;
    if (!result || this._isResultApplied(result.resultId)) return null;
    return { result: clone(result), snapshot: clone(this.battlefieldRuntime.getSnapshot()) };
  }

  _isResultApplied(resultId) {
    if (!resultId) return false;
    try {
      return (this.getAppliedResultIds() || []).includes(resultId);
    } catch {
      return false;
    }
  }

  /**
   * 以冻结战果为唯一输入执行领域结算。
   * 幂等键固定为 settle:${resultId}（见 settleResult），重复命令返回 idempotent。
   */
  async settleFrozenResult({ resultId = null } = {}) {
    if (this.disposed) return { ok: false, code: 'battleRuntimeUnavailable' };
    const frozen = this.battleSystem.getState().result;
    if (!frozen) return { ok: false, code: 'battleResultNotFrozen' };
    if (resultId && frozen.resultId !== resultId) {
      return { ok: false, code: 'battleResultMismatch', message: `battleResultMismatch:${resultId}` };
    }
    if (this._isResultApplied(frozen.resultId)) {
      this.pendingSettlement = null;
      return { ok: true, idempotent: true, resultId: frozen.resultId };
    }
    if (this._settlePromise) return this._settlePromise;
    const snapshot = this.pendingSettlement?.result?.resultId === frozen.resultId
      ? this.pendingSettlement.snapshot
      : this.battlefieldRuntime.getSnapshot();
    const generation = this._generation;
    this._settlePromise = this.settleResult(frozen, snapshot)
      .then(() => {
        if (generation === this._generation) this.pendingSettlement = null;
        return { ok: true, idempotent: false, resultId: frozen.resultId };
      })
      .finally(() => { this._settlePromise = null; });
    return this._settlePromise;
  }

  async grantProgressionRewards(flow, result) {
    const progression = this.config.getProgressionSystem?.();
    const characterId = this.getPlayer()?.id;
    const configured = this.config.getBattleRewards?.();
    if (!progression?.grantPointsOnce || !characterId || !configured || !flow || !result?.battleId) {
      return { ok: true, granted: [] };
    }
    const rewards = [
      ...(configured.byScene?.[flow.sceneId] || []).map(entry => ({ ...entry, reason: 'completion' }))
    ];
    if (this.battleSystem.mode === BattleMode.INTERVENE) {
      rewards.push(...(configured.intervention || []).map(entry => ({ ...entry, reason: 'intervention' })));
      if (result.winnerFactionId === (flow.playerFactionId || 'yellow_turban')) {
        rewards.push(...(configured.victory || []).map(entry => ({ ...entry, reason: 'victory' })));
      }
    }
    if (!rewards.length) return { ok: true, granted: [] };
    const before = progression.serializeCharacter(characterId);
    const granted = [];
    for (const reward of rewards) {
      const pool = String(reward?.pool || '');
      const amount = Math.floor(Number(reward?.amount) || 0);
      const applied = progression.grantPointsOnce(
        characterId, pool, amount, `progression:${result.resultId}:${reward.reason}:${pool}`
      );
      if (!applied?.ok) {
        progression.deserializeCharacter(characterId, before);
        return applied;
      }
      if (!applied.idempotent) granted.push({ pool, amount, reason: reward.reason });
    }
    if (!granted.length) return { ok: true, idempotent: true, granted: [] };
    const saved = await this.requestCheckpoint({
      checkpointId: `${flow.checkpointId}.progressionRewards`, sceneId: flow.sceneId
    });
    if (!saved?.ok && !saved?.snapshot) {
      progression.deserializeCharacter(characterId, before);
      return { ok: false, code: 'progressionRewardCheckpointFailed', message: saved?.message || '成长奖励保存失败' };
    }
    this.notify(`成长奖励：${granted.map(entry => `${entry.pool} +${entry.amount}`).join('、')}`, 'success');
    return { ok: true, granted };
  }

  async settleResult(result, battleSnapshot = null) {
    const flow = this.getFlowByBattle(result?.battleId);
    if (!flow) throw new Error(`unknownBattleId:${result?.battleId || 'missing'}`);
    const context = { result: clone(result), flow: clone(flow), battleSnapshot: clone(battleSnapshot), runtime: this };
    let settled = await this.hooks.settleResult?.(context);
    if (settled == null) {
      settled = await this.cityWarSystem.applyBattleResult({
        result, operationId: `settle:${result.resultId}`,
        context: { mode: this.battleSystem.mode, checkpointId: flow.checkpointId }
      });
    }
    if (!settled?.ok) throw new Error(settled?.message || settled?.code || 'battleSettlementRejected');
    await this.hooks.afterDomainSettlement?.({ ...context, settled });
    const reward = await this.grantProgressionRewards(flow, result);
    if (!reward?.ok) throw new Error(reward?.message || reward?.code || 'progressionRewardRejected');
    const faction = battleSnapshot?.factions?.[result.winnerFactionId];
    this.hudView.clear();
    this.resultView.open(this._buildResultSnapshot({
      title: flow.resultTitle, result, mode: this.battleSystem.mode,
      winnerName: faction?.name || result.winnerFactionId,
      worldChanges: clone(flow.worldChanges), message: flow.resultMessage
    }));
    this.showTip(flow.settlementMessage, { title: '战役结算完成' });
    await this.hooks.afterSettlement?.({ ...context, settled, reward });
    return settled;
  }

  closeUi() {
    this.modeView.close();
    this.resultView.close();
    this.hudView.clear();
  }

  leaveBattleScene({ preserveSnapshot = true } = {}) {
    this.closeUi();
    if (this.battlefieldRuntime.active) {
      this.battlefieldRuntime.stop({ entities: this.getEntities(), preserveSnapshot });
    }
  }

  isInputLayerVisible(layer) {
    if (layer === 'result') return this.resultView.visible === true;
    if (layer === 'mode') return this.modeView.visible === true;
    return false;
  }

  handleInputLayer(layer, context = {}) {
    if (layer === 'result' && this.resultView.visible) return this.resultView.handleInput(context);
    if (layer === 'mode' && this.modeView.visible) return this.modeView.handleInput(context);
    return false;
  }

  handleInput(context = {}) {
    if (this.isInputLayerVisible('result')) return this.handleInputLayer('result', context);
    if (this.isInputLayerVisible('mode')) return this.handleInputLayer('mode', context);
    return false;
  }

  renderLayer(layer, ctx, width, height) {
    if (layer === 'hud') return this.hudView.render(ctx, width, height);
    if (layer === 'mode') return this.modeView.render(ctx, width, height);
    if (layer === 'result') return this.resultView.render(ctx, width, height);
    return false;
  }

  render(ctx, width, height) {
    this.renderLayer('hud', ctx, width, height);
    this.renderLayer('mode', ctx, width, height);
    this.renderLayer('result', ctx, width, height);
  }

  capture() {
    return {
      battleState: this.battleSystem.serialize(),
      battlefieldRuntimeState: this.battlefieldRuntime.serialize(),
      cityWarState: this.cityWarSystem.serialize()
    };
  }

  validateSnapshot(data = {}) {
    if (data.battleState) {
      const battleState = data.battleState;
      const probe = new BattleSystem();
      const check = probe.deserialize(battleState);
      if (!check.ok) return { ok: false, code: check.code, path: 'battleState' };
      const isEmptyIdle = battleState.state === BattleState.IDLE
        && battleState.definition == null
        && battleState.mode == null
        && battleState.frozenResult == null
        && (battleState.operations?.length || 0) === 0;
      if (!isEmptyIdle) {
        const battleId = battleState.definition?.battleId;
        const hasDefinition = this.definitions.has(battleId);
        const hasFlow = !!this.getFlowByBattle(battleId);
        if (!hasDefinition || !hasFlow) {
          return {
            ok: false,
            code: 'unknownBattleId',
            path: 'battleState.definition.battleId',
            battleId: battleId || null,
            hasDefinition,
            hasFlow
          };
        }
      }
    }
    if (data.battlefieldRuntimeState) {
      const check = this.battlefieldRuntime.validateSerialized(data.battlefieldRuntimeState);
      if (!check.ok) return { ok: false, code: check.code, path: 'battlefieldRuntimeState' };
    }
    if (data.cityWarState) {
      const probe = new CityWarSystem();
      const check = probe.deserialize(data.cityWarState);
      if (!check.ok) return { ok: false, code: check.code, path: 'cityWarState' };
    }
    return { ok: true };
  }

  _restoreValidated(data = {}) {
    // 挂起态是内存瞬态，读档后按快照重建（由控制层补发 battle.settle）
    this.pendingSettlement = null;
    this._settlePromise = null;
    if (data.battleState) {
      const restored = this.battleSystem.deserialize(data.battleState);
      if (!restored.ok) return { ...restored, path: 'battleState' };
      this.activeDefinition = this.getDefinition(data.battleState.definition?.battleId);
    }
    if (data.battlefieldRuntimeState) {
      const restored = this.battlefieldRuntime.deserialize(data.battlefieldRuntimeState, {
        entities: this.getEntities(), playerEntity: this.getPlayer(),
        playerFactionId: this.activeDefinition?.playerInterventionFactionId || 'yellow_turban'
      });
      if (!restored.ok) return { ...restored, path: 'battlefieldRuntimeState' };
      this.hudView.setSnapshot(this.battlefieldRuntime.active ? this.battlefieldRuntime.getSnapshot() : null);
    }
    if (data.cityWarState) {
      const restored = this.cityWarSystem.deserialize(data.cityWarState);
      if (!restored.ok) return { ...restored, path: 'cityWarState' };
    }
    return { ok: true };
  }

  restore(data = {}) {
    const validation = this.validateSnapshot(data);
    if (!validation.ok) return validation;
    const before = this.capture();
    const beforeDefinition = clone(this.activeDefinition);
    const restored = this._restoreValidated(data);
    if (restored.ok) return restored;

    const rollback = this._restoreValidated(before);
    this.activeDefinition = beforeDefinition;
    if (!rollback.ok) {
      return {
        ...restored,
        rollbackCode: rollback.code || 'battleRuntimeRollbackFailed',
        rollbackPath: rollback.path || null
      };
    }
    return restored;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._generation += 1;
    this.closeUi();
    this.battlefieldRuntime.dispose(this.getEntities());
    this.config.combatSystem?.setEffectAmountFilter?.(this._previousEffectFilter);
    this.definitions.clear();
    this.activeDefinition = null;
    this.busy = false;
  }
}

export default SceneBattleRuntime;

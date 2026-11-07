/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-08
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************
 * 战斗会话门面（BattleSessionFacade）
 *
 * 定位：内容层（场景/剧情协调器）与框架战斗运行时之间的唯一出入口。
 * 目的：把“会话流程、结算、输入层、渲染层、存档恢复”从场景代码里收口，
 *      后续 P2/P3（视图与输入外移、快照 provider 化）只改门面内部，不再改调用方。
 * 约束：本门面只做委托与命令编排，不实现战斗规则，不持有玩法状态。
 ************************************************************/

export class BattleSessionFacade {
  constructor({ runtime = null } = {}) {
    this.runtime = runtime;
  }

  get ready() {
    return !!this.runtime;
  }

  // ---- 会话流程 ----
  openByScene(sceneId) {
    return this.runtime?.openByScene(sceneId) || false;
  }

  selectMode(mode, sceneId) {
    return this.runtime?.selectMode(mode, sceneId) || false;
  }

  update(deltaTime) {
    return this.runtime?.update(deltaTime) || null;
  }

  registerDefinitions(definitions = []) {
    this.runtime?.registerDefinitions(definitions);
  }

  getDefinition(battleId) {
    return this.runtime?.getDefinition(battleId) || null;
  }

  getSessionState() {
    return this.runtime?.getSessionState() || {};
  }

  isBattlefieldActive() {
    return this.runtime?.isBattlefieldActive() === true;
  }

  canUseRescue() {
    return this.runtime?.canUseRescue() === true;
  }

  freezeResult(candidate) {
    return this.runtime?.freezeResult(candidate) || { ok: false, code: 'battleRuntimeUnavailable' };
  }

  // ---- 结算（P1：update 只挂起，结算由 battle.settle 命令触发） ----
  hasPendingSettlement() {
    return this.runtime?.hasPendingSettlement() === true;
  }

  getPendingSettlement() {
    return this.runtime?.getPendingSettlement() || null;
  }

  settleFrozenResult(options = {}) {
    return this.runtime?.settleFrozenResult(options)
      || Promise.resolve({ ok: false, code: 'battleRuntimeUnavailable' });
  }

  captureCityWarState() {
    return this.runtime?.captureCityWarState() || null;
  }

  restoreCityWarState(snapshot) {
    return this.runtime?.restoreCityWarState(snapshot) || { ok: false, code: 'battleRuntimeUnavailable' };
  }

  applyBattleResult(params = {}) {
    return this.runtime?.applyBattleResult(params)
      || Promise.resolve({ ok: false, code: 'battleRuntimeUnavailable' });
  }

  // ---- 输入层 ----
  isInputLayerVisible(layer) {
    return this.runtime?.isInputLayerVisible(layer) === true;
  }

  handleInputLayer(layer, context = {}) {
    return this.runtime?.handleInputLayer(layer, context) || false;
  }

  // ---- 渲染层 ----
  renderLayer(layer, ctx, width, height) {
    return this.runtime?.renderLayer(layer, ctx, width, height);
  }

  // ---- 表现层生命周期 ----
  closeUi() {
    this.runtime?.closeUi();
  }

  leaveBattleScene(options = {}) {
    this.runtime?.leaveBattleScene(options);
  }

  // ---- 存档（键名与结构保持不变） ----
  capture() {
    return this.runtime?.capture() || {};
  }

  validateSnapshot(data = {}) {
    return this.runtime?.validateSnapshot(data) || { ok: false, code: 'battleRuntimeUnavailable' };
  }

  restore(data = {}) {
    if (!this.runtime) return { ok: false, code: 'battleRuntimeUnavailable' };
    return this.runtime.restore(data);
  }

  dispose() {
    this.runtime?.dispose();
    this.runtime = null;
  }
}

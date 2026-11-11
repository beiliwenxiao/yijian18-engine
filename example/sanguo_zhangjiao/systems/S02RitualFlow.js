/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-12
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * S02RitualFlow - 荒村符水/铜钱剑交互流程（v3 任务链 ⑤⑥）
 *
 * 交互契约（trg_s02_ritual_serve → scenario.command s02.ritual.step）：
 * - 锅边：接符纸 → 撕一角 → 凑灶火点着 → 投进锅 → 搅匀盛粥 → 双手递碗；
 *   每完成一碗提交 story.s02.porridge.served（封顶 50），并记录 servedIds；
 * - 木箱边：递出一串铜钱剑，提交 story.s02.coins.given（封顶 7）；
 * - 施粥累计 ≥20 碗或铜钱剑 7 串发完（先到者）提交 story.s02.accusation.ready，
 *   推进诬告段（阈值按建议值待确认）。
 *
 * 状态只保存在本实例（一锅一次：递完碗 stage 归零），事实写入全部走
 * canonical state.transaction，读档后从 storyState 恢复计数。
 */

const STAGE_TIPS = [
  '接符纸：从信众手里接过一叠黄纸符箓。',
  '撕一角：撕下符纸一角——整张烧不起，一角就够。',
  '点着：把符角凑到灶火边，看它卷起来烧着。',
  '投锅：把烧着的符角投进锅里，搅匀。',
  '盛粥：舀起一碗，碗沿热气腾腾。',
  '递碗：双手递给排在最前面的乡亲。'
];

const CAULDRON = { x: 520, y: 430 };
const COIN_CHEST = { x: 610, y: 432 };

export class S02RitualFlow {
  constructor(scene) {
    if (!scene) throw new TypeError('S02RitualFlow requires scene');
    this.scene = scene;
    this.stage = 0;
    this.bowls = 0;
    this.coins = 0;
    this.sequence = 0;
    this.accusationFired = false;
    this._busy = false;
  }

  _story() {
    return this.scene.gameLoader?.blackboard?.get?.('storyState') || {};
  }

  _offset() {
    return this.scene._worldLoadResult?.worldIndex?.getOffset?.(this.scene.currentSceneId) || { x: 0, y: 0 };
  }

  _playerNear(target, radius) {
    const position = this.scene.playerEntity?.getComponent?.('transform')?.position;
    if (!position) return false;
    const offset = this._offset();
    const dx = (Number(position.x) || 0) - (target.x + (offset.x || 0));
    const dy = (Number(position.y) || 0) - (target.y + (offset.y || 0));
    return dx * dx + dy * dy <= radius * radius;
  }

  _submit(definitionId, payload = {}) {
    const gateway = this.scene.sceneRuntime?.commandGateway;
    const actorRef = this.scene.playerEntity?.id;
    if (!gateway || !actorRef) return { ok: false, code: 'commandGatewayUnavailable' };
    return gateway.execute({
      intentType: 'state.transaction',
      actorRef,
      operationId: `story:${definitionId}:s02ritual:${++this.sequence}`,
      payload: { definitionId, ...payload }
    });
  }

  _tip(text, title = '符水') {
    this.scene._showScreenTip?.(text, { title });
  }

  /** 交互入口：锅边推进六步，木箱边递铜钱剑。 */
  step() {
    const story = this._story();
    if (story.s02Accused === true || this._busy) return { ok: false, code: 'ritualClosed' };
    if (this._playerNear(CAULDRON, 72)) return this._advanceBowl();
    if (this._playerNear(COIN_CHEST, 64) && this.servedCount() >= 1) return this._giveCoin();
    return { ok: false, code: 'notNearRitualSite' };
  }

  servedCount() {
    return Math.max(Number(this._story().s02PorridgeServed) || 0, this.bowls);
  }

  coinCount() {
    return Math.max(Number(this._story().s02CoinsGiven) || 0, this.coins);
  }

  _advanceBowl() {
    if (this.stage < 5) {
      this.stage += 1;
      this._tip(`（${this.stage}/6）${STAGE_TIPS[this.stage - 1]}`);
      return { ok: true, stage: this.stage };
    }
    const served = this.servedCount();
    const villagerId = served === 0 ? 'S02-relief-child' : `S02-relief-villager-${((served - 1) % 5) + 1}`;
    this.stage = 0;
    this.bowls = Math.min(50, served + 1);
    this._busy = true;
    const request = this._submit('story.s02.porridge.served', { villagerId });
    Promise.resolve(request).finally(() => { this._busy = false; });
    this._tip(served === 0
      ? '第一碗符水递给了排在最前的孩子：他先低头把碗沿那角焦纸捞出来，搁在碗边，才捧起来喝。'
      : `第 ${this.bowls} 碗递出。一锅一次，接符纸再来。`);
    this._checkAccusation();
    return { ok: true, served: this.bowls, villagerId };
  }

  _giveCoin() {
    const given = this.coinCount();
    if (given >= 7) return { ok: false, code: 'coinsExhausted' };
    this.coins = given + 1;
    this._busy = true;
    const request = this._submit('story.s02.coins.given', { index: this.coins });
    Promise.resolve(request).finally(() => { this._busy = false; });
    this._tip(`第 ${this.coins} 串铜钱剑递出。七枚铜钱缠作剑形，送的是平安。`);
    this._checkAccusation();
    return { ok: true, coins: this.coins };
  }

  _checkAccusation() {
    if (this.accusationFired) return;
    if (this.servedCount() < 20 && this.coinCount() < 7) return;
    this.accusationFired = true;
    this._submit('story.s02.accusation.ready');
  }
}

export default S02RitualFlow;

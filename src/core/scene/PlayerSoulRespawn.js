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

/**
 * PlayerSoulRespawn - 普通死亡后的延期复活流程。
 *
 * 死亡掉落、资源损失与检查点已在启动前由权威命令提交；本类只保存
 * 本次死亡的表现等待与已确定复活位置，完成时委托领域服务提交复活。
 */
import { describeDeathCause } from './PlayerDeathCountdown.js';

export class PlayerSoulRespawn {
  constructor({
    durationSeconds = 10,
    reviveOffsetY = 46,
    getCampfirePosition = () => null,
    getSpawnPosition = () => null,
    showTip = () => {},
    hideTip = () => {},
    onCountdown = () => {},
    onSoulStateChange = () => {},
    onAwaitConfirmation = () => false,
    onComplete = () => ({ ok: false })
  } = {}) {
    this.durationSeconds = Math.max(1, Number(durationSeconds) || 10);
    this.reviveOffsetY = Number(reviveOffsetY) || 0;
    this.getCampfirePosition = typeof getCampfirePosition === 'function' ? getCampfirePosition : () => null;
    this.getSpawnPosition = typeof getSpawnPosition === 'function' ? getSpawnPosition : () => null;
    this.showTip = showTip;
    this.hideTip = hideTip;
    this.onCountdown = onCountdown;
    this.onSoulStateChange = onSoulStateChange;
    this.onAwaitConfirmation = onAwaitConfirmation;
    this.onComplete = onComplete;
    this.pending = null;
    this.disposed = false;
  }

  /**
   * 在死亡结算已成功提交后，立即将玩家投影到已确定的复活锚点并开始倒计时。
   * 同一 deathId 只能拥有一个 pending，避免网络重放重复启动表现流程。
   */
  start({ player, deathId, resolution, deathEvent = null } = {}) {
    if (this.disposed || !player || !deathId || this.pending) return false;
    const transform = player.getComponent?.('transform');
    if (!transform?.position) return false;

    const campfire = this.getCampfirePosition();
    const hasCampfire = Number.isFinite(campfire?.x) && Number.isFinite(campfire?.y);
    const fallback = hasCampfire ? null : this.getSpawnPosition();
    const target = hasCampfire
      ? {
        x: campfire.x,
        y: campfire.y + this.reviveOffsetY,
        label: campfire.label || '已点燃的火堆旁'
      }
      : (Number.isFinite(fallback?.x) && Number.isFinite(fallback?.y) ? { ...fallback } : null);

    if (target) {
      transform.position.x = target.x;
      transform.position.y = target.y;
    }

    this.pending = {
      player,
      deathId,
      resolution: resolution || { type: 'normalDeath' },
      deathEvent,
      remaining: this.durationSeconds,
      displayedSeconds: null,
      campfirePosition: hasCampfire ? { x: campfire.x, y: campfire.y } : null,
      respawnPosition: target,
      completing: false,
      awaitingConfirmation: false,
      confirmationPresented: false
    };
    player.isSoulState = true;
    this.onSoulStateChange(true);
    this._presentDeathTip(this.pending);
    this._presentCountdown(this.pending, Math.ceil(this.pending.remaining));
    return true;
  }

  isPendingFor(deathId) {
    return this.pending?.deathId === deathId;
  }

  get awaitingConfirmation() {
    return this.pending?.awaitingConfirmation === true;
  }

  update(deltaTime) {
    const pending = this.pending;
    if (!pending || pending.completing || this.disposed) return false;
    if (pending.awaitingConfirmation) {
      this._requestConfirmation(pending);
      return true;
    }

    pending.remaining = Math.max(0, pending.remaining - Math.max(0, Number(deltaTime) || 0));
    this._presentDeathTip(pending);
    this._presentCountdown(pending, pending.remaining > 0 ? Math.ceil(pending.remaining) : null);
    if (pending.remaining > 0) return true;

    pending.awaitingConfirmation = true;
    this._requestConfirmation(pending);
    return true;
  }

  /** 由模态确认入口调用；只有成功的领域复活才退出灵魂状态。 */
  confirm() {
    const pending = this.pending;
    if (!pending || !pending.awaitingConfirmation || pending.completing || this.disposed) {
      return Promise.resolve({ ok: false, code: 'reviveConfirmationUnavailable' });
    }
    pending.completing = true;
    return Promise.resolve(this.onComplete({
      player: pending.player,
      deathId: pending.deathId,
      resolution: pending.resolution,
      position: pending.respawnPosition
    })).then(result => {
      if (this.disposed || this.pending !== pending) return result;
      if (result?.ok) {
        this._finish(pending, result);
        return result;
      }
      pending.completing = false;
      return result || { ok: false, code: 'reviveFailed' };
    }).catch(error => {
      if (!this.disposed && this.pending === pending) pending.completing = false;
      console.warn('PlayerSoulRespawn: 复活完成回调失败', error);
      return { ok: false, code: 'reviveFailed', error };
    });
  }

  /**
   * 取消不回滚已提交的死亡结算，玩家继续保持死亡；重新开始本次显示倒计时，
   * 从而保留下一次复活确认入口而不会让玩家卡死。
   */
  cancelConfirmation() {
    const pending = this.pending;
    if (!pending || !pending.awaitingConfirmation || pending.completing || this.disposed) return false;
    pending.awaitingConfirmation = false;
    pending.confirmationPresented = false;
    pending.remaining = this.durationSeconds;
    pending.displayedSeconds = null;
    this._presentDeathTip(pending);
    this._presentCountdown(pending, Math.ceil(pending.remaining));
    return true;
  }

  _requestConfirmation(pending) {
    if (this.pending !== pending || pending.confirmationPresented || this.disposed) return false;
    pending.confirmationPresented = this.onAwaitConfirmation(pending) !== false;
    return pending.confirmationPresented;
  }

  _finish(pending, result) {
    pending.player.isSoulState = false;
    this.onSoulStateChange(false);
    this._presentCountdown(pending, null);
    this.hideTip?.();
    const position = result.respawnPosition || pending.respawnPosition || null;
    const location = position?.label
      || (Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? `（${Math.round(position.x)}, ${Math.round(position.y)}）`
        : '安全地点');
    this.showTip?.(`你已在${location}复活`, { title: '复活' });
    this.pending = null;
  }

  _presentDeathTip(pending) {
    const seconds = Math.max(0, Math.ceil(pending.remaining));
    if (pending.displayedSeconds === seconds) return;
    pending.displayedSeconds = seconds;
    const cause = describeDeathCause(pending.deathEvent || {});
    this.showTip?.(`你已经${cause}，${seconds}秒后复活。`, {
      title: '死亡',
      owner: 'playerSoul',
      persist: true
    });
  }

  _presentCountdown(pending, seconds) {
    this.onCountdown(seconds, {
      durationSeconds: this.durationSeconds,
      approachRadius: 0,
      remainingSeconds: pending.remaining
    });
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    if (this.pending) {
      this.pending.player.isSoulState = false;
      this._presentCountdown(this.pending, null);
      this.pending = null;
    }
    this.hideTip?.();
    this.onSoulStateChange(false);
    return true;
  }
}

export default PlayerSoulRespawn;

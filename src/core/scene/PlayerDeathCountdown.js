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

const nameOf = entity => entity?.name || entity?.getComponent?.('name')?.name || '';

export function describeDeathCause(event = {}) {
  const sourceName = nameOf(event.sourceEntity);
  const damageType = String(event.damageType || '');
  const text = `${sourceName} ${damageType}`.toLowerCase();
  if (/狼|wolf/.test(text)) return '被狼咬死';
  if (/冻|冰|frost|cold/.test(text)) return '被冻死';
  if (/饿|饥|hunger|starv/.test(text)) return '被饿死';
  if (/枪|戟|矛|刺|spear|lance/.test(text)) return '被枪戳死';
  if (sourceName) return `被${sourceName}击败`;
  return '因伤势过重倒下';
}

/** 管理普通死亡的倒计时表现；实际掉落、检查点与复活仍委托既有命令事务。 */
export class PlayerDeathCountdown {
  constructor({ durationSeconds = 10, show = () => {}, hide = () => {},
    onAwaitConfirmation = () => false, onComplete = () => ({ ok: false }) } = {}) {
    this.durationSeconds = Math.max(1, Math.floor(Number(durationSeconds) || 10));
    this.show = show;
    this.hide = hide;
    this.onAwaitConfirmation = onAwaitConfirmation;
    this.onComplete = onComplete;
    this.pending = null;
    this.disposed = false;
  }

  start({ player, deathId, resolution, deathEvent = null } = {}) {
    if (this.disposed || !player || !deathId || this.pending) return false;
    this.pending = {
      player, deathId, resolution, deathEvent,
      remaining: this.durationSeconds,
      displayedSeconds: null,
      resolving: false,
      awaitingConfirmation: false,
      confirmationPresented: false
    };
    this._present();
    return true;
  }

  update(deltaTime) {
    const pending = this.pending;
    if (!pending || pending.resolving || this.disposed) return false;
    if (pending.awaitingConfirmation) {
      this._requestConfirmation(pending);
      return true;
    }
    pending.remaining = Math.max(0, pending.remaining - Math.max(0, Number(deltaTime) || 0));
    this._present();
    if (pending.remaining > 0) return true;
    pending.awaitingConfirmation = true;
    this.hide();
    this._requestConfirmation(pending);
    return true;
  }

  _requestConfirmation(pending) {
    if (this.pending !== pending || pending.confirmationPresented || this.disposed) return false;
    pending.confirmationPresented = this.onAwaitConfirmation(pending) !== false;
    return pending.confirmationPresented;
  }

  get awaitingConfirmation() {
    return this.pending?.awaitingConfirmation === true;
  }

  confirm() {
    const pending = this.pending;
    if (!pending || !pending.awaitingConfirmation || pending.resolving || this.disposed) {
      return Promise.resolve({ ok: false, code: 'reviveConfirmationUnavailable' });
    }
    pending.awaitingConfirmation = false;
    return this._resolve(pending);
  }

  _resolve(pending) {
    pending.resolving = true;
    return Promise.resolve(this.onComplete(pending)).then(result => {
      if (this.disposed || this.pending !== pending) return result;
      if (result?.ok) {
        this.pending = null;
        return result;
      }
      pending.resolving = false;
      pending.awaitingConfirmation = true;
      return result;
    }).catch(error => {
      if (!this.disposed && this.pending === pending) {
        pending.resolving = false;
        pending.awaitingConfirmation = true;
      }
      return { ok: false, code: 'reviveFailed', error };
    });
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this.pending = null;
    this.hide();
    return true;
  }

  _present(prefix = '') {
    const pending = this.pending;
    if (!pending) return;
    const seconds = Math.max(0, Math.ceil(pending.remaining));
    if (pending.displayedSeconds === seconds && !prefix) return;
    pending.displayedSeconds = seconds;
    const cause = describeDeathCause(pending.deathEvent || {});
    const retry = prefix ? `${prefix}\n` : '';
    this.show(`${retry}你已经${cause}，${seconds}秒后可确认复活。`);
  }
}

export default PlayerDeathCountdown;

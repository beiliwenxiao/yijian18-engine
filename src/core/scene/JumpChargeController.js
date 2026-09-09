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
 * JumpChargeController - 蓄力跳跃控制器
 *
 * 统一持有蓄力进度、最大可达范围和当前落点选择：
 * - 手柄以左摇杆在当前蓄力距离内移动落点；松开 Y 起跳；
 * - PC 以鼠标移动落点，左键确认起跳；
 * - 触屏以触点选择落点并确认起跳。
 *
 * 按住前 0.2 秒是朝向短跳预备阶段，不显示瞄准表现也不接收落点输入。
 * 本控制器不持有业务准入或位移实现，只经回调提交已冻结的方向与距离。
 */
import { AimPreviewRenderer } from '../../rendering/AimPreviewRenderer.js';

export class JumpChargeController {
  constructor(config = {}) {
    this.config = {
      tapMaxMs: 200,
      chargeMaxMs: 1000,
      tapDistance: 30,
      maxDistance: 120,
      targetRadius: 24,
      rangeColor: '#ffc46b',
      targetColor: '#00ff00',
      barWidth: 72,
      barHeight: 8,
      barOffsetY: 22,
      ...config
    };
    this._now = config.now || (() => performance.now());
    this.active = false;
    this.actor = null;
    this.startMs = 0;
    this.holdMs = 0;
    this.aimDirection = { x: 0, y: 0 };
    this.aimMagnitude = 0;
    this._pointerOffset = null;
    this._manualTargeting = false;
    this._ignoreHeldUntilReleased = false;
    this._jumpFn = null;
  }

  /** 设置最终跳跃执行回调（由场景注入）。 */
  setJumpCallback(fn) {
    this._jumpFn = typeof fn === 'function' ? fn : null;
  }

  /**
   * 虚拟跳跃按钮进入独立点选模式；模式会持续蓄力，直到点击/触碰落点。
   * @param {Object} actor
   * @returns {boolean}
   */
  beginTargeting(actor) {
    if (!actor || this.active) return false;
    this._begin(actor, true);
    return true;
  }

  /**
   * 每帧由场景输入驱动调用。
   * @param {Object} options
   * @param {boolean} options.held - 空格、Y 或按住式触屏跳跃键的保持状态
   * @param {boolean} [options.blocked] - 死亡/对话/模态等取消条件
   * @param {Object} [options.actor] - 跳跃实体
   * @param {{x:number,y:number,magnitude?:number}} [options.direction] - 手柄/移动轴落点输入
   * @param {{x:number,y:number}} [options.targetPosition] - PC 指针当前世界坐标
   * @returns {Object|null}
   */
  update({ held = false, blocked = false, actor = null, direction = null, targetPosition = null } = {}) {
    if (blocked) {
      if (this.active || this._ignoreHeldUntilReleased) this.cancel();
      return this.active ? { charging: false, cancelled: true } : null;
    }
    if (this._ignoreHeldUntilReleased) {
      if (!held) this._ignoreHeldUntilReleased = false;
      return null;
    }
    if (held && !this.active) this._begin(actor, false);
    if (!this.active) return null;

    this.holdMs = Math.max(0, this._now() - this.startMs);
    if (this.isChargeActive()) {
      if (direction) this.setAimFromAxis(direction);
      if (targetPosition) this.setTargetPosition(targetPosition);
    }

    if (!held && !this._manualTargeting) return this.release();
    return {
      charging: true,
      progress: this.getProgress(),
      holdMs: this.holdMs,
      manualTargeting: this._manualTargeting
    };
  }

  /** 是否应在 AIMING 优先级消费该左键/触点。 */
  canSelectTarget(event) {
    return this.isChargeActive()
      && event?.isLeftDown?.() === true
      && Number.isFinite(event?.world?.x)
      && Number.isFinite(event?.world?.y);
  }

  /** 点击/触点确认当前世界落点，并且本次蓄力只释放一次。 */
  selectTarget(targetPosition) {
    if (!this.isChargeActive() || !this.setTargetPosition(targetPosition)) return null;
    return this.release({ ignoreHeldUntilReleased: true, selectedByPointer: true });
  }

  /** 用手柄左摇杆更新落点方向和相对距离。 */
  setAimFromAxis(direction) {
    const x = Number(direction?.x) || 0;
    const y = Number(direction?.y) || 0;
    const rawMagnitude = Number(direction?.magnitude);
    const magnitude = Math.min(1, Math.max(0,
      Number.isFinite(rawMagnitude) ? rawMagnitude : Math.hypot(x, y)
    ));
    const length = Math.hypot(x, y);
    this._pointerOffset = null;
    this.aimMagnitude = magnitude > 0.01 ? magnitude : 0;
    this.aimDirection = this.aimMagnitude > 0 && length > 0.01
      ? { x: x / length, y: y / length }
      : { x: 0, y: 0 };
    return this.aimMagnitude > 0;
  }

  /** 以 PC 鼠标或 Android 触点更新落点；实际距离受当前蓄力距离限制。 */
  setTargetPosition(targetPosition) {
    const origin = this._getActorPosition();
    const x = Number(targetPosition?.x);
    const y = Number(targetPosition?.y);
    if (!origin || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const dx = x - origin.x;
    const dy = y - origin.y;
    const distance = Math.hypot(dx, dy);
    this._pointerOffset = { x: dx, y: dy };
    this.aimMagnitude = distance > 0.01 ? 1 : 0;
    this.aimDirection = distance > 0.01
      ? { x: dx / distance, y: dy / distance }
      : { x: 0, y: 0 };
    return true;
  }

  /** 主动释放：键/手柄松开或点选落点后按冻结目标起跳。 */
  release({ ignoreHeldUntilReleased = false, selectedByPointer = false } = {}) {
    if (!this.active) return null;
    const holdMs = Math.max(0, this._now() - this.startMs);
    const chargeActive = this.isChargeActive(holdMs);
    const aim = chargeActive ? this.getAimTarget(holdMs) : null;
    const distance = aim?.distance ?? this._distanceForHold(holdMs);
    const direction = chargeActive
      ? aim?.direction || { ...this.aimDirection }
      : { x: 0, y: 0 };
    const actor = this.actor;
    const result = this._jumpFn?.({ distance, holdMs, actor, direction, selectedByPointer }) || null;
    this.active = false;
    this.actor = null;
    this.holdMs = 0;
    this._manualTargeting = false;
    this._ignoreHeldUntilReleased = ignoreHeldUntilReleased;
    return {
      charging: false,
      distance,
      holdMs,
      direction,
      selectedByPointer,
      started: result?.started === true
    };
  }

  /** 取消蓄力，不起跳。 */
  cancel() {
    this.active = false;
    this.actor = null;
    this.holdMs = 0;
    this.aimDirection = { x: 0, y: 0 };
    this.aimMagnitude = 0;
    this._pointerOffset = null;
    this._manualTargeting = false;
    this._ignoreHeldUntilReleased = false;
  }

  isCharging() {
    return this.active;
  }

  /** 是否已越过短跳预备阶段，并允许进行瞄准和正式蓄力。 */
  isChargeActive(holdMs = null) {
    const elapsedMs = Number.isFinite(holdMs)
      ? holdMs
      : this.active ? Math.max(0, this._now() - this.startMs) : 0;
    return this.active && elapsedMs > this.config.tapMaxMs;
  }

  /** 蓄力条进度 0~1；点按区间保持 0。 */
  getProgress() {
    if (!this.active) return 0;
    const { tapMaxMs, chargeMaxMs } = this.config;
    if (this.holdMs <= tapMaxMs) return 0;
    return Math.min(1, (this.holdMs - tapMaxMs) / Math.max(1, chargeMaxMs - tapMaxMs));
  }

  /** 当前蓄力允许的最大实际跳跃距离。 */
  getAvailableDistance(holdMs = this.holdMs) {
    return this._distanceForHold(holdMs);
  }

  /** 返回当前可见、可提交的落点；PC/触点目标会裁剪到当前蓄力距离。 */
  getAimTarget(holdMs = this.holdMs) {
    if (!this.isChargeActive(holdMs)) return null;
    const origin = this._getActorPosition();
    if (!origin) return null;
    const availableDistance = this.getAvailableDistance(holdMs);
    if (this._pointerOffset) {
      const rawDistance = Math.hypot(this._pointerOffset.x, this._pointerOffset.y);
      if (rawDistance > 0.01) {
        const scale = Math.min(1, availableDistance / rawDistance);
        const dx = this._pointerOffset.x * scale;
        const dy = this._pointerOffset.y * scale;
        const distance = Math.hypot(dx, dy);
        return {
          x: origin.x + dx,
          y: origin.y + dy,
          distance,
          direction: { x: dx / distance, y: dy / distance }
        };
      }
    }
    if (this.aimMagnitude > 0.01) {
      const distance = availableDistance * this.aimMagnitude;
      return {
        x: origin.x + this.aimDirection.x * distance,
        y: origin.y + this.aimDirection.y * distance,
        distance,
        direction: { ...this.aimDirection }
      };
    }
    return null;
  }

  /** 渲染头顶蓄力条、最大范围虚线框与当前落点小圈。 */
  render(ctx) {
    if (!this.active) return false;
    const transform = this.actor?.getComponent?.('transform');
    if (!transform?.position) {
      this.cancel();
      return false;
    }
    if (!this.isChargeActive()) return true;

    const playerX = transform.position.x;
    const playerY = transform.position.y;
    AimPreviewRenderer.renderRange(ctx, playerX, playerY, this.config.maxDistance, this.config.rangeColor);

    const aim = this.getAimTarget();
    if (aim) {
      AimPreviewRenderer.renderTarget(
        ctx,
        aim.x,
        aim.y,
        this.config.targetRadius,
        this.config.targetColor
      );
    }

    const sprite = this.actor.getComponent?.('sprite');
    const spriteHeight = (Number(sprite?.height) || 48) * (Number(sprite?.scale) || 1);
    const x = playerX;
    const y = playerY - (Number(transform.position.elevation) || 0)
      - spriteHeight - this.config.barOffsetY;
    const progress = this.getProgress();
    const { barWidth, barHeight } = this.config;
    const left = x - barWidth / 2;
    const top = y - barHeight / 2;
    const fillWidth = Math.max(0, (barWidth - 2) * progress);

    ctx.save();
    ctx.fillStyle = 'rgba(12, 10, 8, 0.88)';
    ctx.fillRect(left - 2, top - 2, barWidth + 4, barHeight + 4);
    ctx.fillStyle = '#3a2f45';
    ctx.fillRect(left, top, barWidth, barHeight);
    if (fillWidth > 0) {
      ctx.fillStyle = progress >= 1 ? '#ffd75e' : '#ff9d3f';
      ctx.fillRect(left + 1, top + 1, fillWidth, barHeight - 2);
    }
    ctx.strokeStyle = '#ffc46b';
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 0.5, top - 0.5, barWidth + 1, barHeight + 1);
    ctx.restore();
    return true;
  }

  dispose() {
    this.cancel();
  }

  _begin(actor, manualTargeting) {
    this.active = true;
    this.actor = actor || this.actor;
    this.startMs = this._now();
    this.holdMs = 0;
    this.aimDirection = { x: 0, y: 0 };
    this.aimMagnitude = 0;
    this._pointerOffset = null;
    this._manualTargeting = manualTargeting === true;
  }

  _getActorPosition() {
    const position = this.actor?.getComponent?.('transform')?.position;
    return position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: position.x, y: position.y }
      : null;
  }

  _distanceForHold(holdMs) {
    const { tapMaxMs, chargeMaxMs, tapDistance, maxDistance } = this.config;
    if (holdMs <= tapMaxMs) return tapDistance;
    const ratio = Math.min(1, (holdMs - tapMaxMs) / Math.max(1, chargeMaxMs - tapMaxMs));
    return Math.round(tapDistance + (maxDistance - tapDistance) * ratio);
  }
}

export default JumpChargeController;

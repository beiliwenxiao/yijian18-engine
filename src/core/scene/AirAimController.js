/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * AirAimController - 悬停瞄准跳跃控制器（AIR_AIM 状态机）
 *
 * 新跳跃流程（设计见 .kiro/steering/air-aim-jump-design.md）：
 * - T1 按下起跳键（PC空格/手柄Y/触屏按住式键）立即起跳（短跳，方向=移动输入或朝向）；
 * - T3 持续按住 ≥ apexHoldMs 且仍在空中 → 进入 AIR_AIM 悬停瞄准（冻结跳跃进度，
 *      启动 aimWindowMs 倒计时，显示范围圈与落点标记；"子弹时间"仅为表现层）；
 * - T5 悬停中松开起跳键且已有有效落点 → 跳向落点（无落点则恢复原跳跃剩余段）；
 * - T6 aimWindowMs 超时未释放 → 恢复原跳跃剩余段；
 * - T7 死亡/硬控/对话/切_scene 等打断 → 恢复原跳跃剩余段。
 *
 * 落点输入：PC 鼠标右键调整落点（松开起跳键才执行）；手柄左摇杆方向+幅度；
 * 触屏点选落点即跳（虚拟键点选模式）。
 *
 * 本控制器不持有位移实现，只经回调提交：
 * setPressJumpCallback / setHoverCallback / setRelocateCallback / setResumeCallback。
 * 状态迁移日志统一走 Logger（受 IS_TEST 开关控制）。
 */
import { AimPreviewRenderer } from '../../rendering/AimPreviewRenderer.js';
import { Logger } from '../Logger.js';

export class AirAimController {
  constructor(config = {}) {
    this.config = {
      apexHoldMs: 300,          // 按住多久触发悬停瞄准（基础跳 duration 须使顶点≈该值）
      aimWindowMs: 3000,        // 悬停瞄准窗口（超时恢复原跳跃）
      aimRange: 120,            // 悬停点为圆心的最大重定位距离
      pressJump: { distance: 84, duration: 0.6 },  // 按下即跳的短跳参数
      targetRadius: 24,
      rangeColor: '#ffc46b',
      targetColor: '#00ff00',
      barWidth: 72,
      barHeight: 8,
      barOffsetY: 22,
      ...config,
      pressJump: { distance: 84, duration: 0.6, ...(config.pressJump || {}) }
    };
    this._now = config.now || (() => performance.now());
    this.active = false;      // 正在跟踪一次起跳按键（T1 之后）
    this.aiming = false;      // 处于 AIR_AIM 悬停瞄准（T3 之后）
    this.actor = null;
    this.startMs = 0;
    this.holdMs = 0;
    this._pressStarted = false;
    this._expireAt = 0;
    this.aimTarget = null;    // {x,y,distance,direction}
    this._pointerOffset = null;
    this.aimDirection = { x: 0, y: 0 };
    this.aimMagnitude = 0;
    this._manualTargeting = false;         // 触屏虚拟键点选模式：点落点即跳
    this._ignoreHeldUntilReleased = false;
    this._pressFn = null;
    this._hoverFn = null;
    this._relocateFn = null;
    this._resumeFn = null;
  }

  /** T1 按下即跳回调：({actor, moveDirection, distance, duration}) => {started} */
  setPressJumpCallback(fn) {
    this._pressFn = typeof fn === 'function' ? fn : null;
  }

  /** T3 进入悬停回调：({actor, expireAt}) => {started} */
  setHoverCallback(fn) {
    this._hoverFn = typeof fn === 'function' ? fn : null;
  }

  /** T5 跳向落点回调：({actor, target, distance, direction}) => {started} */
  setRelocateCallback(fn) {
    this._relocateFn = typeof fn === 'function' ? fn : null;
  }

  /** T6/T7/无落点释放 恢复原跳跃回调：({actor, reason}) => {resumed} */
  setResumeCallback(fn) {
    this._resumeFn = typeof fn === 'function' ? fn : null;
  }

  /** 触屏虚拟跳跃键：标记本次按住为点选模式（点落点即跳）。 */
  beginVirtualTargeting() {
    this._manualTargeting = true;
    return true;
  }

  /**
   * 每帧由帧管线驱动调用。
   * @param {Object} options
   * @param {boolean} options.held - 起跳键保持状态（空格/Y/触屏按住式键）
   * @param {boolean} [options.blocked] - 死亡/对话/冥想等打断或取消条件
   * @param {Object} [options.actor] - 跳跃实体
   * @param {boolean} [options.isJumping] - 实体是否处于跳跃中（决定能否进入悬停）
   * @param {{x:number,y:number}} [options.moveDirection] - 按下瞬间的移动输入（决定短跳方向）
   * @param {{x:number,y:number,magnitude?:number}} [options.direction] - 手柄摇杆落点输入
   * @returns {Object|null}
   */
  update({
    held = false, blocked = false, actor = null, isJumping = false,
    moveDirection = null, direction = null
  } = {}) {
    if (blocked) {
      if (this.aiming) {
        return this._resume('interrupt');           // T7 打断
      }
      if (this.active) this._resetTracking(false);  // 仅停止跟踪，跳跃自然继续
      return null;
    }
    if (this._ignoreHeldUntilReleased) {
      if (!held) this._ignoreHeldUntilReleased = false;
      return null;
    }
    if (held && !this.active && !this.aiming) this._beginPress(actor, moveDirection);  // T1
    if (!this.active) return null;

    this.holdMs = Math.max(0, this._now() - this.startMs);
    if (!this.aiming) {
      if (!held) {                                  // T2 提前松手：普通短跳自然落地
        this._resetTracking(false);
        return null;
      }
      if (this.holdMs >= this.config.apexHoldMs) {  // T3 按住超阈值
        if (!this._pressStarted || !isJumping) {
          this._resetTracking(false);
          return null;
        }
        this._enterAim();
        if (!this.aiming) return null;
      }
      return { tracking: true, holdMs: this.holdMs, aiming: false };
    }

    // AIR_AIM：手柄摇杆持续更新落点（PC 右键 / 触屏点选走 selectTarget）
    if (direction) this.setAimFromAxis(direction);
    if (!held) return this._relocate();             // T5 释放
    if (this._now() >= this._expireAt) return this._resume('timeout');  // T6 超时
    return {
      aiming: true,
      remainMs: Math.max(0, this._expireAt - this._now()),
      target: this.aimTarget
    };
  }

  /** 是否应在 AIMING 优先消费该指针事件：PC 右键；触屏左键/触点。 */
  canSelectTarget(event) {
    if (!this.aiming) return false;
    if (event?.isRightDown?.() === true) return Number.isFinite(event?.world?.x);
    if (event?.isLeftDown?.() === true
      && (this._manualTargeting || event?.device === 'touch')) {
      return Number.isFinite(event?.world?.x);
    }
    return false;
  }

  /** 点选落点：触屏（点选模式）立即跳向落点；PC 右键只调整落点，松开起跳键才执行。 */
  selectTarget(targetPosition) {
    if (!this.aiming || !this.setTargetPosition(targetPosition)) return null;
    if (this._manualTargeting) return this._relocate();
    return { aiming: true, target: this.aimTarget };
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

  /** 以 PC 右键或触点更新落点；实际距离受 aimRange 限制。 */
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

  /** 当前已选落点（超出 aimRange 时按方向裁剪到上限）；无有效落点返回 null。 */
  getAimTarget() {
    if (!this.aiming) return null;
    const origin = this._getActorPosition();
    if (!origin) return null;
    const availableDistance = this.config.aimRange;
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

  isCharging() {
    return this.active || this.aiming;
  }

  isAiming() {
    return this.aiming;
  }

  /** 渲染范围圈、落点标记与剩余时间条。 */
  render(ctx) {
    if (!this.aiming) return false;
    const transform = this.actor?.getComponent?.('transform');
    if (!transform?.position) {
      this._resetTracking(false);
      return false;
    }
    const playerX = transform.position.x;
    const playerY = transform.position.y;
    AimPreviewRenderer.renderRange(ctx, playerX, playerY, this.config.aimRange, this.config.rangeColor);

    const aim = this.getAimTarget();
    if (aim) {
      AimPreviewRenderer.renderTarget(ctx, aim.x, aim.y, this.config.targetRadius, this.config.targetColor);
    }

    const sprite = this.actor.getComponent?.('sprite');
    const spriteHeight = (Number(sprite?.height) || 48) * (Number(sprite?.scale) || 1);
    const x = playerX;
    const y = playerY - (Number(transform.position.elevation) || 0)
      - spriteHeight - this.config.barOffsetY;
    const progress = Math.min(1, Math.max(0,
      (this._expireAt - this._now()) / Math.max(1, this.config.aimWindowMs)));
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
      ctx.fillStyle = '#5ec8ff';
      ctx.fillRect(left + 1, top + 1, fillWidth, barHeight - 2);
    }
    ctx.strokeStyle = '#7fd4ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 0.5, top - 0.5, barWidth + 1, barHeight + 1);
    ctx.restore();
    return true;
  }

  dispose() {
    this._resetTracking(false);
  }

  /** T1 按下即跳：立即提交短跳；起跳被拒则不进入瞄准跟踪。 */
  _beginPress(actor, moveDirection) {
    this.active = true;
    this.actor = actor || this.actor;
    this.startMs = this._now();
    this.holdMs = 0;
    const result = this._pressFn?.({
      actor: this.actor,
      moveDirection: moveDirection || null,
      distance: this.config.pressJump.distance,
      duration: this.config.pressJump.duration
    }) || null;
    this._pressStarted = result?.started === true;
    if (this._pressStarted) {
      Logger.log('[AirAim] 起跳', { holdMsTarget: this.config.apexHoldMs });
    } else {
      this._resetTracking(false);
    }
  }

  /** T3 进入悬停瞄准；悬停被拒（如悬停前跳跃已结束）则停止跟踪。 */
  _enterAim() {
    const expireAt = this._now() + this.config.aimWindowMs;
    const result = this._hoverFn?.({ actor: this.actor, expireAt }) || null;
    if (result?.started !== true) {
      this._resetTracking(false);
      return;
    }
    this.aiming = true;
    this._expireAt = expireAt;
    this.aimTarget = null;
    Logger.log('[AirAim] 进入悬停瞄准', { expireAt });
  }

  /** T5 释放：有落点跳向落点；无落点恢复原跳跃。 */
  _relocate() {
    const target = this.getAimTarget();
    if (!target) return this._resume('release');
    const result = this._relocateFn?.({
      actor: this.actor,
      target,
      distance: target.distance,
      direction: target.direction
    }) || null;
    if (result?.started === true) {
      Logger.log('[AirAim] 跳向落点', { x: target.x, y: target.y, distance: target.distance });
      this._resetTracking(true);
      return { aiming: false, relocated: true, target };
    }
    return this._resume('release');   // 重定位被拒：兜底恢复，避免悬挂在空中
  }

  /** T6/T7/兜底：恢复原跳跃剩余段。 */
  _resume(reason) {
    const result = this._resumeFn?.({ actor: this.actor, reason }) || null;
    Logger.log('[AirAim] 悬停结束', { reason, resumed: result?.resumed === true });
    this._resetTracking(true);
    return { aiming: false, resumed: result?.resumed === true, reason };
  }

  _resetTracking(ignoreHeld) {
    this.active = false;
    this.aiming = false;
    this.actor = null;
    this.holdMs = 0;
    this._pressStarted = false;
    this._expireAt = 0;
    this.aimTarget = null;
    this._pointerOffset = null;
    this.aimDirection = { x: 0, y: 0 };
    this.aimMagnitude = 0;
    this._manualTargeting = false;
    this._ignoreHeldUntilReleased = ignoreHeld === true;
  }

  _getActorPosition() {
    const position = this.actor?.getComponent?.('transform')?.position;
    return position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: position.x, y: position.y }
      : null;
  }
}

export default AirAimController;

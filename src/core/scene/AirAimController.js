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
 * AirAimController - 按下即跳控制器（v2.2：大跳 / 二段跳 / 空中轻推转向）
 *
 * 新跳跃流程（设计见 .trae/rules/air-aim-jump-design.md v2.2）：
 * - T1 按下起跳键（PC空格/手柄Y/触屏虚拟键）立即起跳（短跳，方向=移动输入或朝向）；
 * - T2 起跳后持续按住 ≥ bigJumpHoldMs → 大跳升级（剩余距离拉满 maxJumpDistance）；
 * - T3 起跳后 doubleJumpWindowMs 内再次按下 → 二段跳（从空中位置再跳一段，限一次）；
 * - T4 滞空中方向键/左摇杆持续输入 → 空中轻推（衰减转向，保持惯性，剩余距离守恒）；
 * - T5 滞空中右键/触点点击 → 朝点击方向单次推（比连续输入更强，仍非瞬时对齐）；
 * - 落地或死亡/对话/冥想等 blocked → 结束跟踪。
 *
 * 本控制器不持有位移实现，只经回调提交：
 * setPressJumpCallback / setBigJumpCallback / setDoubleJumpCallback / setSteerCallback。
 * 状态迁移日志统一走 Logger（受 IS_TEST 开关控制）。
 */
import { Logger } from '../Logger.js';

export class AirAimController {
  constructor(config = {}) {
    this.config = {
      bigJumpHoldMs: 300,          // 按住多久触发大跳升级
      doubleJumpWindowMs: 500,     // 首次起跳后多久内允许二段跳
      maxJumpDistance: 120,        // 大跳最远距离
      pressJump: { distance: 84, duration: 0.6 },  // 按下即跳的短跳参数
      airSteer: {
        strength: 1.2,      // 连续轻推强度（/秒）：小于行走响应，转向渐进保持惯性
        pointerBlend: 0.5  // 右键/触点单次推的混合比（0.5=一次转一半，保留另一半惯性）
      },
      ...config,
      airSteer: { strength: 1.2, pointerBlend: 0.5, ...(config.airSteer || {}) },
      pressJump: { distance: 84, duration: 0.6, ...(config.pressJump || {}) }
    };
    this._now = config.now || (() => performance.now());
    this.active = false;      // 正在跟踪一次跳跃（T1 成功起跳后到落地）
    this.actor = null;
    this.pressTs = 0;         // 最近一次按下时刻（holdMs 基准）
    this.jumpTs = 0;          // 首次起跳时刻（二段跳窗口基准）
    this.holdMs = 0;
    this._prevHeld = false;   // 起跳键上一帧状态（检测按下沿）
    this.releasedThisHold = false;  // 本次按住已松手（松手后不再升级大跳）
    this.upgradedThisHold = false;  // 本段已大跳升级
    this.doubleJumped = false;      // 本次跟踪内已二段跳
    this._pressFn = null;
    this._bigJumpFn = null;
    this._doubleJumpFn = null;
    this._steerFn = null;
  }

  /** T1 按下即跳回调：({actor, moveDirection, distance, duration}) => {started} */
  setPressJumpCallback(fn) {
    this._pressFn = typeof fn === 'function' ? fn : null;
  }

  /** T2 大跳升级回调：({actor, distance}) => {upgraded} */
  setBigJumpCallback(fn) {
    this._bigJumpFn = typeof fn === 'function' ? fn : null;
  }

  /** T3 二段跳回调：({actor, moveDirection, distance, duration}) => {started} */
  setDoubleJumpCallback(fn) {
    this._doubleJumpFn = typeof fn === 'function' ? fn : null;
  }

  /** T4/T5 空中轻推回调：({actor, direction, blend}) => {steered}——blend 为矢量混合比。 */
  setSteerCallback(fn) {
    this._steerFn = typeof fn === 'function' ? fn : null;
  }

  /**
   * 每帧由帧管线驱动调用。
   * @param {Object} options
   * @param {boolean} options.held - 起跳键保持状态（空格/Y/触屏虚拟键）
   * @param {boolean} [options.blocked] - 死亡/对话/冥想等打断条件
   * @param {Object} [options.actor] - 跳跃实体
   * @param {boolean} [options.isJumping] - 实体是否处于跳跃中（落地则结束跟踪）
   * @param {{x:number,y:number}} [options.moveDirection] - 移动输入轴（按下瞬间决定起跳/
   *        二段跳方向；滞空中持续消费=空中轻推）
   * @param {number} [options.dt] - 帧时长（秒，轻推 blend 随时间积分）
   * @returns {Object|null}
   */
  update({
    held = false, blocked = false, actor = null, isJumping = false,
    moveDirection = null, dt = 0
  } = {}) {
    if (blocked) {
      if (this.active) this._resetTracking();   // T7 打断：无冻结态，仅停止跟踪
      this._prevHeld = held;
      return null;
    }
    // 跟踪中落地 → 结束（二段跳 relocate 是同步替换，isJumping 不中断）
    if (this.active && !isJumping) {
      this._resetTracking();
      this._prevHeld = held;
      return null;
    }
    if (!this.active) {
      if (held && !this._prevHeld) this._beginPress(actor, moveDirection);  // T1
      this._prevHeld = held;
      return null;
    }

    const now = this._now();
    const risingEdge = held && !this._prevHeld;
    this._prevHeld = held;

    // T4 空中轻推：滞空中移动输入渐进转向（blend 随 dt 积分，保持惯性）
    if (moveDirection) this._steerByAxis(moveDirection, dt);

    // T3 二段跳：松手后再次按下，且在首跳窗口内，且未用过
    if (risingEdge && this.releasedThisHold
      && !this.doubleJumped && (now - this.jumpTs) <= this.config.doubleJumpWindowMs) {
      this._doubleJump(moveDirection);
    }

    // T2 大跳升级：持续按住超阈值（本次按住未松手、本段未升级过）
    if (held) {
      this.holdMs = now - this.pressTs;
      if (!this.releasedThisHold && !this.upgradedThisHold
        && this.holdMs >= this.config.bigJumpHoldMs) {
        this._upgradeBigJump();
      }
    } else {
      this.releasedThisHold = true;   // 松手：本次按住的大跳升级机会结束
      this.holdMs = 0;
    }

    return { tracking: true, holdMs: this.holdMs };
  }

  /** 是否应在跳跃中优先消费该指针事件（右键/触点推方向）：PC 右键；触屏左键/触点。 */
  canSteer(event) {
    if (!this.active) return false;
    if (event?.isRightDown?.() === true) return Number.isFinite(event?.world?.x);
    if (event?.device === 'touch' && event?.isLeftDown?.() === true) {
      return Number.isFinite(event?.world?.x);
    }
    return false;
  }

  /** 右键/触点推方向：朝点击方向单次较强轻推（blend=pointerBlend，非瞬时对齐）。 */
  steerTowardsPointer(targetPosition) {
    if (!this.active) return false;
    const origin = this.actor?.getComponent?.('transform')?.position;
    const x = Number(targetPosition?.x);
    const y = Number(targetPosition?.y);
    if (!origin || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const dx = x - origin.x;
    const dy = y - origin.y;
    if (Math.hypot(dx, dy) < 0.01) return false;
    const steered = this._steerFn?.({
      actor: this.actor,
      direction: { x: dx, y: dy },
      blend: this.config.airSteer.pointerBlend
    })?.steered === true;
    if (steered) Logger.log('[AirAim] 空中右键推方向', { x, y });
    return steered;
  }

  isCharging() {
    return this.active;
  }

  dispose() {
    this._resetTracking();
  }

  /** T1 按下即跳：立即提交短跳；起跳被拒则不进入跟踪。 */
  _beginPress(actor, moveDirection) {
    this.actor = actor || this.actor;
    const now = this._now();
    const result = this._pressFn?.({
      actor: this.actor,
      moveDirection: moveDirection || null,
      distance: this.config.pressJump.distance,
      duration: this.config.pressJump.duration
    }) || null;
    if (result?.started !== true) return;
    this.active = true;
    this.pressTs = now;
    this.jumpTs = now;
    this.holdMs = 0;
    this.releasedThisHold = false;
    this.upgradedThisHold = false;
    this.doubleJumped = false;
    Logger.log('[AirAim] 起跳', { holdMsTarget: this.config.bigJumpHoldMs });
  }

  /** T2 大跳升级：剩余水平距离拉满到 maxJumpDistance。 */
  _upgradeBigJump() {
    const result = this._bigJumpFn?.({
      actor: this.actor,
      distance: this.config.maxJumpDistance
    }) || null;
    if (result?.upgraded !== true) return;
    this.upgradedThisHold = true;
    Logger.log('[AirAim] 大跳升级', { distance: this.config.maxJumpDistance });
  }

  /** T3 二段跳：从空中位置再跳一段（短跳参数）；成功后新段可再升级大跳。 */
  _doubleJump(moveDirection) {
    const result = this._doubleJumpFn?.({
      actor: this.actor,
      moveDirection: moveDirection || null,
      distance: this.config.pressJump.distance,
      duration: this.config.pressJump.duration
    }) || null;
    if (result?.started !== true) return;
    this.doubleJumped = true;
    this.pressTs = this._now();
    this.holdMs = 0;
    this.releasedThisHold = false;    // 新按下：本段可再升级大跳
    this.upgradedThisHold = false;
    Logger.log('[AirAim] 二段跳');
  }

  /** T4 空中轻推：blend = strength × dt（时间积分），矢量混合渐进转向。 */
  _steerByAxis(moveDirection, dt) {
    const x = Number(moveDirection?.x) || 0;
    const y = Number(moveDirection?.y) || 0;
    if (Math.hypot(x, y) < 0.01) return;
    const blend = Math.min(1, Math.max(0, this.config.airSteer.strength) * Math.max(0, Number(dt) || 0));
    if (!(blend > 0)) return;
    this._steerFn?.({ actor: this.actor, direction: { x, y }, blend });
  }

  _resetTracking() {
    this.active = false;
    this.actor = null;
    this.pressTs = 0;
    this.jumpTs = 0;
    this.holdMs = 0;
    this.releasedThisHold = false;
    this.upgradedThisHold = false;
    this.doubleJumped = false;
  }
}

export default AirAimController;

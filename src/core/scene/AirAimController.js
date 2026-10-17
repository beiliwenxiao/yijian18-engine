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
 * AirAimController - 按下即跳控制器（v3：方向大跳 / 空中换向跳）
 *
 * 跳跃流程（设计见 .trae/rules/air-aim-jump-design.md v3）：
 * - T1 按下起跳键立即起跳：无方向输入=原地小跳（0.5s）；有方向输入=顺方向小跳（0.5s）；
 * - T2 起跳后持续控制方向且方向不变 ≥ bigJumpHoldMs → 大跳升级（距离拉满+置空 1s）；
 * - T3 滞空中方向明显改变（与当前跳跃方向夹角超过阈值）→ 空中换向跳（从空中位置向
 *   新方向再跳一段 0.5s，每次腾空限一次）；
 * - T4 方向微调（夹角未超阈值）→ 空中轻推（渐进转向，保持惯性，剩余距离守恒）；
 * - T5 滞空中右键/触点点击 → 朝点击方向单次推（比连续输入更强，仍非瞬时对齐）；
 * - 落地或死亡/对话/冥想等 blocked → 结束跟踪。
 *
 * 本控制器不持有位移实现，只经回调提交：
 * setPressJumpCallback / setBigJumpCallback / setAirRedirectCallback / setSteerCallback。
 * 状态迁移日志统一走 Logger（受 IS_TEST 开关控制）。
 */
import { Logger } from '../Logger.js';

export class AirAimController {
  constructor(config = {}) {
    this.config = {
      bigJumpHoldMs: 300,          // 起跳后方向持续不变的时长阈值 → 升级大跳
      turnThreshold: 0.5,          // 方向改变判定（输入·当前方向点积）：< 0.5 即夹角 >60° 视为改向
      pressJump: { distance: 100, duration: 0.5 },   // 小跳：距离 100、置空 0.5s
      bigJump: { distance: 150, duration: 1.0, peakHeight: 60 },   // 大跳：距离 150、置空 1s、峰值 60（渐变提升）
      airSteer: {
        strength: 1.6,      // 连续轻推强度（/秒）：小于行走响应，转向渐进保持惯性
        pointerBlend: 0.5  // 右键/触点单次推的混合比（0.5=一次转一半，保留另一半惯性）
      },
      ...config,
      airSteer: {
        strength: 1.6, pointerBlend: 0.5, ...(config.airSteer || {}) },
      pressJump: { distance: 100, duration: 0.5, ...(config.pressJump || {}) },
      bigJump: { distance: 150, duration: 1.0, peakHeight: 60, ...(config.bigJump || {}) }
    };
    this.active = false;      // 正在跟踪一次跳跃（T1 成功起跳后到落地）
    this.actor = null;
    this._jumpDir = null;     // 当前跳跃方向（起跳/换向时归一化记录；null=原地跳）
    this._dirHoldMs = 0;      // 方向持续不变的累计时长（大跳升级基准）
    this._launched = false;   // 是否已空中跳出（原地跳后首次方向输入时置 true）
    this._prevHeld = false;   // 起跳键上一帧状态（检测按下沿）
    this.upgradedThisHold = false;  // 本段已大跳升级（换向跳后重置，每段限一次）
    this.doubleJumped = false;      // 本次腾空已空中换向跳（限一次）
    this._pressFn = null;
    this._launchFn = null;
    this._bigJumpFn = null;
    this._redirectFn = null;
    this._steerFn = null;
  }

  /** T1 按下即跳回调：({actor, moveDirection: null, distance: 0, duration}) => {started}——原地跳。 */
  setPressJumpCallback(fn) {
    this._pressFn = typeof fn === 'function' ? fn : null;
  }

  /** T2 空中跳出回调：({actor, direction, distance}) => {launched}——原地跳中首次方向输入时触发。 */
  setLaunchCallback(fn) {
    this._launchFn = typeof fn === 'function' ? fn : null;
  }

  /** T2 大跳升级回调：({actor, distance, duration}) => {upgraded}——距离拉满+置空 1s。 */
  setBigJumpCallback(fn) {
    this._bigJumpFn = typeof fn === 'function' ? fn : null;
  }

  /** T3 空中换向跳回调：({actor, moveDirection, distance, duration}) => {started} */
  setAirRedirectCallback(fn) {
    this._redirectFn = typeof fn === 'function' ? fn : null;
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
   * @param {{x:number,y:number}} [options.moveDirection] - 移动输入轴（起跳瞬间决定方向；
   *        滞空中：同向持续=大跳累计+轻推，明显改向=空中换向跳）
   * @param {number} [options.dt] - 帧时长（秒，轻推 blend 与方向累计随时间积分）
   * @returns {Object|null}
   */
  update({
    held = false, blocked = false, actor = null, isJumping = false,
    moveDirection = null, dt = 0
  } = {}) {
    if (blocked) {
      if (this.active) this._resetTracking();   // 打断：无冻结态，仅停止跟踪
      this._prevHeld = held;
      return null;
    }
    // 跟踪中落地 → 结束（换向跳 relocate 是同步替换，isJumping 不中断）
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

    const risingEdge = held && !this._prevHeld;
    this._prevHeld = held;

    // 滞空方向处理（v3.2）：起跳永远原地，方向全部在空中生效——
    // 首次输入方向=向该方向跳出（launch）；已跳出后同向持续=大跳累计；微调/反向=轻推（steerJump 自带死区）
    const x = Number(moveDirection?.x) || 0;
    const y = Number(moveDirection?.y) || 0;
    if (Math.hypot(x, y) >= 0.2) {
      const mag = Math.hypot(x, y);
      const nx = x / mag;
      const ny = y / mag;
      if (!this._launched) {
        this._launch(nx, ny);   // 首次方向输入：原地跳中向该方向跳出
      } else {
        const dot = this._jumpDir ? nx * this._jumpDir.x + ny * this._jumpDir.y : 1;
        if (dot >= this.config.turnThreshold) {
          // 同向（含微调）：方向不变累计 → 大跳升级
          this._dirHoldMs += Math.max(0, Number(dt) || 0) * 1000;
          if (!this.upgradedThisHold && this._dirHoldMs >= this.config.bigJumpHoldMs) {
            this._upgradeBigJump();
          }
        }
        this._steerByAxis(moveDirection, dt);
      }
    } else if (this._launched) {
      this._dirHoldMs = 0;   // 松开方向：大跳累计清零
    }

    // 二段跳/空中换向跳（v3.2）：滞空中再次按下跳跃键触发（每次腾空限一次），
    // 方向取当前输入（无输入则沿当前跳跃方向直线上再跳一段）
    if (risingEdge && this.active && !this.doubleJumped) {
      this._doubleJump(moveDirection);
    }

    return { tracking: true, dirHoldMs: this._dirHoldMs };
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

  /** T1 按下即跳：无条件原地小跳（方向全部在滞空中生效）；被拒则不进入跟踪。 */
  _beginPress(actor) {
    this.actor = actor || this.actor;
    const result = this._pressFn?.({
      actor: this.actor,
      moveDirection: null,           // 起跳不带方向：原地跳
      distance: 0,
      duration: this.config.pressJump.duration
    }) || null;
    if (result?.started !== true) return;
    this.active = true;
    this._launched = false;          // 尚未跳出（滞空中首次方向输入时 launch）
    this._jumpDir = null;
    this._dirHoldMs = 0;
    this.upgradedThisHold = false;
    this.doubleJumped = false;
    Logger.log('[AirAim] 原地起跳');
  }

  /** T2 空中首次方向输入：原地跳中向该方向跳出（launch，距离=pressJump.distance）。 */
  _launch(nx, ny) {
    const result = this._launchFn?.({
      actor: this.actor,
      direction: { x: nx, y: ny },
      distance: this.config.pressJump.distance
    }) || null;
    if (result?.launched !== true) return;
    this._launched = true;
    this._jumpDir = { x: nx, y: ny };
    this._dirHoldMs = 0;              // 大跳累计从 launch 时刻起算
    Logger.log('[AirAim] 空中跳出', { x: nx, y: ny });
  }

  /** T3 大跳升级：距离拉满 + 置空扩展 1s + 峰值高度渐变提升。 */
  _upgradeBigJump() {
    const result = this._bigJumpFn?.({
      actor: this.actor,
      distance: this.config.bigJump.distance,
      duration: this.config.bigJump.duration,
      peakHeight: this.config.bigJump.peakHeight
    }) || null;
    if (result?.upgraded !== true) return;
    this.upgradedThisHold = true;
    Logger.log('[AirAim] 大跳升级', {
      distance: this.config.bigJump.distance,
      duration: this.config.bigJump.duration,
      peakHeight: this.config.bigJump.peakHeight
    });
  }

  /** T4 二段跳/空中换向跳：滞空中再按跳跃键触发；方向取当前输入，无输入沿当前跳跃方向。 */
  _doubleJump(moveDirection) {
    const x = Number(moveDirection?.x) || 0;
    const y = Number(moveDirection?.y) || 0;
    const mag = Math.hypot(x, y);
    const dir = mag >= 0.2
      ? { x: x / mag, y: y / mag }
      : (this._jumpDir ? { ...this._jumpDir } : { x: 0, y: 0 });
    const result = this._redirectFn?.({
      actor: this.actor,
      moveDirection: dir,
      distance: this.config.pressJump.distance,
      duration: this.config.pressJump.duration
    }) || null;
    if (result?.started !== true) return;
    this.doubleJumped = true;
    this._jumpDir = mag >= 0.2 ? dir : this._jumpDir;
    this._dirHoldMs = 0;
    this.upgradedThisHold = false;    // 新段可再升级大跳（每段限一次）
    Logger.log('[AirAim] 二段跳', dir);
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
    this._jumpDir = null;
    this._dirHoldMs = 0;
    this._launched = false;
    this.upgradedThisHold = false;
    this.doubleJumped = false;
  }
}

export default AirAimController;

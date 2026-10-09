/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-08-02
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * GamepadManager - 手柄输入管理器（Gamepad API）
 *
 * 每帧 poll() 一次读取手柄快照（Gamepad API 是轮询式，不是事件式），
 * 计算按住 / 本帧按下 / 本帧释放，并按 Xbox360Profile 的绑定输出虚拟键集合。
 *
 * 由 InputManager 在帧首调用，键状态与键盘状态取"或"，两者可混用。
 *
 * 平台支持：
 *   web / electron —— 完整支持（Chrome/Edge 下 Xbox 360 走 XInput，标准映射）
 *   capacitor(Android WebView) —— 按钮/摇杆可用，震动多数机型不支持
 *   weapp(微信小游戏) —— 无 Gamepad API，isSupported() 返回 false，全部降级为不可用
 *
 * authority: 'client'  // 纯输入采集
 */

import {
  PadButton,
  PadAxis,
  DEFAULT_BINDINGS,
  ATTACK_ACTION,
  NONE_ACTION,
  SKILL_RELEASE_ACTION,
  SKILL_SWITCH_ACTION,
  FLIGHT_ACTION,
  THROW_ACTION,
  BLOCK_ACTION,
  isStandardMapping,
  looksLikeXboxPad
} from './Xbox360Profile.js';

/** 默认攻击键（RT）。实际攻击键由绑定表中值为 ATTACK_ACTION 的按钮决定，此常量仅作向后兼容默认值 */
export const ATTACK_BUTTON = PadButton.RT;

/** 手柄专用动作集合：这些动作不注入虚拟键，由 GamepadCombatController 解释 */
const GAMEPAD_SPECIAL_ACTIONS = new Set([
  ATTACK_ACTION, SKILL_RELEASE_ACTION, SKILL_SWITCH_ACTION,
  FLIGHT_ACTION, THROW_ACTION, BLOCK_ACTION
]);

export class GamepadManager {
  /**
   * @param {Object} [options]
   * @param {number} [options.deadzone=0.22] - 摇杆死区（低于此值视为归中）
   * @param {number} [options.triggerThreshold=0.5] - 扳机被视为"按下"的阈值
   * @param {Object} [options.bindings] - 覆盖默认绑定（按钮索引 → 虚拟键名）
   * @param {Object} [options.nav] - 注入 navigator（供测试）
   * @param {Object} [options.window] - 注入 window（供测试），默认 globalThis.window
   */
  constructor(options = {}) {
    this.deadzone = options.deadzone != null ? options.deadzone : 0.22;
    this.triggerThreshold = options.triggerThreshold != null ? options.triggerThreshold : 0.5;
    this.bindings = { ...DEFAULT_BINDINGS, ...(options.bindings || {}) };
    this._nav = options.nav || (typeof navigator !== 'undefined' ? navigator : null);
    this._window = options.window !== undefined
      ? options.window
      : (typeof globalThis !== 'undefined' ? globalThis.window : null);

    /** 当前使用的手柄索引（首个连接的手柄） */
    this.activeIndex = -1;
    /** 最近一次 poll 的手柄信息 */
    this.info = null;      // { index, id, mapping, isXbox, buttonCount, axisCount }

    /** 按钮按住状态：index → boolean */
    this.buttons = new Map();
    /** 按钮模拟值：index → 0~1（扳机是连续值） */
    this.values = new Map();
    /** 本帧按下 / 本帧释放 */
    this.buttonsPressed = new Set();
    this.buttonsReleased = new Set();

    /** 按钮按住时长（毫秒），用于区分快按/长按 */
    this._buttonDownTime = new Map();  // index → timestamp(ms) 按下瞬间时间戳
    this._lastPollTime = 0;

    /** 摇杆（已过死区并重标定） */
    this.leftStick = { x: 0, y: 0, magnitude: 0 };
    this.rightStick = { x: 0, y: 0, magnitude: 0 };

    /** 摇杆静息偏置（自动校准）：连接后首次近静息读数时采集，读数先扣偏置再过死区 */
    this._stickBias = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this._stickBiasCaptured = false;

    /** 连接 / 断开监听 */
    this._connectListeners = [];
    this._disconnectListeners = [];
    this._wasConnected = false;

    /** 保存浏览器事件监听引用，供 destroy() 精确移除 */
    this._onGamepadConnected = (e) => {
      console.log('GamepadManager: gamepadconnected', e.gamepad && e.gamepad.id);
    };
    this._onGamepadDisconnected = (e) => {
      console.log('GamepadManager: gamepaddisconnected', e.gamepad && e.gamepad.id);
    };
    this._browserEventsBound = false;

    this._bindBrowserEvents();
  }

  /** 当前运行环境是否有 Gamepad API（微信小游戏没有） */
  isSupported() {
    return !!(this._nav && typeof this._nav.getGamepads === 'function');
  }

  /** 是否有手柄已连接 */
  isConnected() {
    return this.activeIndex >= 0;
  }

  /**
   * 订阅手柄连接
   * @param {Function} cb - (info) => void
   * @returns {Function} 取消订阅
   */
  onConnect(cb) {
    if (typeof cb !== 'function') return () => {};
    this._connectListeners.push(cb);
    return () => {
      const i = this._connectListeners.indexOf(cb);
      if (i !== -1) this._connectListeners.splice(i, 1);
    };
  }

  /**
   * 订阅手柄断开
   * @param {Function} cb - (info) => void
   * @returns {Function} 取消订阅
   */
  onDisconnect(cb) {
    if (typeof cb !== 'function') return () => {};
    this._disconnectListeners.push(cb);
    return () => {
      const i = this._disconnectListeners.indexOf(cb);
      if (i !== -1) this._disconnectListeners.splice(i, 1);
    };
  }

  /**
   * 每帧轮询手柄状态。必须在帧首调用（读取输入之前）。
   * @returns {boolean} 本帧是否有可用手柄
   */
  poll() {
    this._lastPollTime = performance.now();
    if (!this.isSupported()) {
      if (this._wasConnected) this._handleDisconnect();
      return false;
    }

    const pad = this._pickPad();
    if (!pad) {
      if (this._wasConnected) this._handleDisconnect();
      this._clearFrameState();
      return false;
    }

    if (!this._wasConnected || this.activeIndex !== pad.index) {
      this.activeIndex = pad.index;
      this.info = {
        index: pad.index,
        id: pad.id || '未知手柄',
        mapping: pad.mapping || '',
        standard: isStandardMapping(pad),
        isXbox: looksLikeXboxPad(pad),
        buttonCount: (pad.buttons || []).length,
        axisCount: (pad.axes || []).length
      };
      this._wasConnected = true;
      for (const cb of [...this._connectListeners]) {
        try { cb(this.info); } catch (e) { console.warn('GamepadManager: onConnect 监听器出错', e); }
      }
      console.log('GamepadManager: 手柄已连接 →', this.info.id,
        `(mapping=${this.info.mapping || 'none'}, 按钮${this.info.buttonCount}, 轴${this.info.axisCount})`);
    }

    this._readButtons(pad);
    this._readSticks(pad);
    return true;
  }

  /** @private 选取要使用的手柄：优先当前活动的，否则第一个非空的 */
  _pickPad() {
    const pads = this._nav.getGamepads() || [];
    if (this.activeIndex >= 0) {
      const cur = pads[this.activeIndex];
      if (cur && cur.connected !== false) return cur;
    }
    for (const p of pads) {
      if (p && p.connected !== false) return p;
    }
    return null;
  }

  /** @private 读按钮，计算本帧按下/释放。扳机按阈值离散化 */
  _readButtons(pad) {
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();

    const list = pad.buttons || [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const value = typeof b === 'number' ? b : (b ? (b.value || 0) : 0);
      const isTrigger = (i === PadButton.LT || i === PadButton.RT);
      // 扳机是模拟量，用阈值判定；普通键直接读 pressed
      const down = isTrigger
        ? value >= this.triggerThreshold
        : (typeof b === 'object' && b !== null && b.pressed !== undefined ? !!b.pressed : value > 0.5);

      const was = this.buttons.get(i) === true;
      if (down && !was) {
        this.buttonsPressed.add(i);
        this._buttonDownTime.set(i, this._lastPollTime);
      }
      if (!down && was) {
        this.buttonsReleased.add(i);
        // _buttonDownTime 保留到下帧，供 getButtonHoldDuration 在释放帧查询
      }

      this.buttons.set(i, down);
      this.values.set(i, value);
    }
  }

  /**
   * 获取按钮从按下到现在（或刚释放时）的持续毫秒数。
   * 适合在 buttonsReleased 帧调用，用于区分快按(<150ms)与长按。
   * @param {number} index - 按钮索引
   * @returns {number} 持续毫秒，未按过则 0
   */
  getButtonHoldDuration(index) {
    const start = this._buttonDownTime.get(index);
    if (start == null) return 0;
    return this._lastPollTime - start;
  }

  /** @private 读摇杆，应用死区后把 [deadzone,1] 重标定到 [0,1]，避免死区边缘速度跳变 */
  _readSticks(pad) {
    const axes = pad.axes || [];
    const lx = Number(axes[PadAxis.LEFT_X]) || 0;
    const ly = Number(axes[PadAxis.LEFT_Y]) || 0;
    const rx = Number(axes[PadAxis.RIGHT_X]) || 0;
    const ry = Number(axes[PadAxis.RIGHT_Y]) || 0;
    this._captureStickBias(lx, ly, rx, ry);
    // 先扣静息偏置再过死区：老摇杆中位漂移（如实测静息 -0.23、下行程只剩 0.67）
    // 会让单侧方向的有效行程大幅缩水；校准后下行程恢复 0.90、静息不再缓慢漂移。
    this.leftStick = this._applyDeadzone(lx - this._stickBias.lx, ly - this._stickBias.ly);
    this.rightStick = this._applyDeadzone(rx - this._stickBias.rx, ry - this._stickBias.ry);
  }

  /**
   * 连接后首次读到"全部轴近静息"时采集偏置，仅采集一次（重连后重新采集）。
   * 阈值 0.35 必须高于常见漂移幅度、低于玩家主动推杆，避免把主动推杆当静息中心；
   * 漂移超过阈值的极端手柄采不到偏置，退化为未校准行为（与旧版一致）。
   * @private
   */
  _captureStickBias(lx, ly, rx, ry) {
    if (this._stickBiasCaptured) return;
    if (Math.max(Math.abs(lx), Math.abs(ly), Math.abs(rx), Math.abs(ry)) > 0.35) return;
    this._stickBias = { lx, ly, rx, ry };
    this._stickBiasCaptured = true;
    if (lx || ly || rx || ry) {
      console.log('GamepadManager: 摇杆静息校准完成', { lx, ly, rx, ry });
    }
  }

  /** 清除已采集的静息偏置，下一次近静息读数会重新校准（供设置界面"重新校准摇杆"）。 */
  recalibrateSticks() {
    this._stickBias = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this._stickBiasCaptured = false;
  }

  /** @private 径向死区 + 重标定 */
  _applyDeadzone(rawX, rawY) {
    const mag = Math.hypot(rawX, rawY);
    if (mag <= this.deadzone) return { x: 0, y: 0, magnitude: 0 };
    const scaled = Math.min(1, (mag - this.deadzone) / (1 - this.deadzone));
    return { x: (rawX / mag) * scaled, y: (rawY / mag) * scaled, magnitude: scaled };
  }

  /** @private 断开处理 */
  _handleDisconnect() {
    const info = this.info;
    this.activeIndex = -1;
    this.info = null;
    this._wasConnected = false;
    this.buttons.clear();
    this.values.clear();
    this._clearFrameState();
    this.leftStick = { x: 0, y: 0, magnitude: 0 };
    this.rightStick = { x: 0, y: 0, magnitude: 0 };
    // 重连后需要重新采集静息偏置（换手柄或同一手柄状态可能不同）
    this._stickBias = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this._stickBiasCaptured = false;
    console.log('GamepadManager: 手柄已断开');
    for (const cb of [...this._disconnectListeners]) {
      try { cb(info); } catch (e) { console.warn('GamepadManager: onDisconnect 监听器出错', e); }
    }
  }

  /** @private */
  _clearFrameState() {
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
  }

  /** @private 浏览器连接事件只用来打日志和立即唤醒轮询；状态仍以 poll 为准 */
  _bindBrowserEvents() {
    if (this._browserEventsBound || !this._window || typeof this._window.addEventListener !== 'function') return;
    this._window.addEventListener('gamepadconnected', this._onGamepadConnected);
    this._window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
    this._browserEventsBound = true;
  }

  // ---- 查询 ----

  /** 按钮是否按住 */
  isButtonDown(index) {
    return this.buttons.get(index) === true;
  }

  /** 按钮是否本帧按下 */
  isButtonPressed(index) {
    return this.buttonsPressed.has(index);
  }

  /** 按钮是否本帧释放 */
  isButtonReleased(index) {
    return this.buttonsReleased.has(index);
  }

  /** 按钮模拟值（扳机 0~1，普通键 0/1） */
  getButtonValue(index) {
    return this.values.get(index) || 0;
  }

  /**
   * 左摇杆 + 十字键合成的移动向量。
   * 十字键为数字输入，magnitude 记为 1（全速）。
   * @returns {{x:number, y:number, magnitude:number}}
   */
  getMoveVector() {
    if (this.leftStick.magnitude > 0) return { ...this.leftStick };

    let x = 0, y = 0;
    if (this.isButtonDown(PadButton.DPAD_LEFT)) x -= 1;
    if (this.isButtonDown(PadButton.DPAD_RIGHT)) x += 1;
    if (this.isButtonDown(PadButton.DPAD_UP)) y -= 1;
    if (this.isButtonDown(PadButton.DPAD_DOWN)) y += 1;
    if (x === 0 && y === 0) return { x: 0, y: 0, magnitude: 0 };

    const mag = Math.hypot(x, y);
    return { x: x / mag, y: y / mag, magnitude: 1 };
  }

  /** 右摇杆（瞄准）向量 */
  getAimVector() {
    return { ...this.rightStick };
  }

  /**
   * 按绑定输出虚拟键状态。
   * @returns {{down:Set<string>, pressed:Set<string>, released:Set<string>}}
   */
  getVirtualKeys() {
    const down = new Set();
    const pressed = new Set();
    const released = new Set();
    if (!this.isConnected()) return { down, pressed, released };

    for (const [indexStr, key] of Object.entries(this.bindings)) {
      // 空绑定与手柄专用动作不注入虚拟键，由 GamepadCombatController 单独处理
      if (!key || key === NONE_ACTION || GAMEPAD_SPECIAL_ACTIONS.has(key)) continue;
      const index = Number(indexStr);
      if (this.isButtonDown(index)) down.add(key);
      if (this.isButtonPressed(index)) pressed.add(key);
      if (this.isButtonReleased(index)) released.add(key);
    }

    // 左摇杆推向某方向时，同时给出对应的数字方向键，
    // 让只读 isKeyDown('up') 的旧代码（动画/朝向判定）也能跟着动
    const mv = this.leftStick;
    if (mv.magnitude > 0) {
      if (mv.y < -0.35) down.add('up');
      if (mv.y > 0.35) down.add('down');
      if (mv.x < -0.35) down.add('left');
      if (mv.x > 0.35) down.add('right');
    }

    return { down, pressed, released };
  }

  /** 绑定为攻击动作的按钮索引集合（支持多个按钮都当攻击） */
  getAttackButtons() {
    const out = [];
    for (const [indexStr, key] of Object.entries(this.bindings)) {
      if (key === ATTACK_ACTION) out.push(Number(indexStr));
    }
    return out;
  }

  /** 任一攻击键是否按住 */
  isAttackDown() {
    if (!this.isConnected()) return false;
    return this.getAttackButtons().some(i => this.isButtonDown(i));
  }

  /** 任一攻击键是否本帧按下 */
  isAttackPressed() {
    if (!this.isConnected()) return false;
    return this.getAttackButtons().some(i => this.isButtonPressed(i));
  }

  /**
   * 应用外部配置（编辑器保存的 gamepad.json）。
   * @param {Object} config - { bindings:{索引:动作}, deadzone, triggerThreshold }
   */
  applyConfig(config) {
    if (!config) return;
    if (config.deadzone != null) this.deadzone = config.deadzone;
    if (config.triggerThreshold != null) this.triggerThreshold = config.triggerThreshold;
    if (config.bindings && typeof config.bindings === 'object') {
      // 合并到默认绑定：配置未列出的按钮保持默认
      for (const [k, v] of Object.entries(config.bindings)) {
        this.bindings[Number(k)] = v;
      }
    }
  }

  /**
   * 震动（Chrome/Edge 的 dual-rumble；不支持时静默忽略）
   * @param {number} [duration=200] - 毫秒
   * @param {number} [strong=0.6] - 低频马达强度 0~1
   * @param {number} [weak=0.3] - 高频马达强度 0~1
   * @returns {Promise<boolean>} 是否真的震了
   */
  async vibrate(duration = 200, strong = 0.6, weak = 0.3) {
    if (!this.isSupported() || this.activeIndex < 0) return false;
    const pad = (this._nav.getGamepads() || [])[this.activeIndex];
    const actuator = pad && pad.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return false;
    try {
      await actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration,
        strongMagnitude: Math.max(0, Math.min(1, strong)),
        weakMagnitude: Math.max(0, Math.min(1, weak))
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 覆盖绑定（按钮索引 → 虚拟键名，null 表示取消映射） */
  setBinding(buttonIndex, key) {
    this.bindings[buttonIndex] = key || null;
  }

  /** 取当前绑定的浅拷贝（UI 展示用） */
  getBindings() {
    return { ...this.bindings };
  }

  /**
   * 释放浏览器监听、订阅和内部输入状态。可重复调用。
   */
  destroy() {
    if (this._browserEventsBound && this._window && typeof this._window.removeEventListener === 'function') {
      this._window.removeEventListener('gamepadconnected', this._onGamepadConnected);
      this._window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
    }
    this._browserEventsBound = false;

    this._connectListeners.length = 0;
    this._disconnectListeners.length = 0;
    this.activeIndex = -1;
    this.info = null;
    this._wasConnected = false;
    this.buttons.clear();
    this.values.clear();
    this._clearFrameState();
    this._buttonDownTime.clear();
    this._lastPollTime = 0;
    this.leftStick = { x: 0, y: 0, magnitude: 0 };
    this.rightStick = { x: 0, y: 0, magnitude: 0 };
    this._stickBias = { lx: 0, ly: 0, rx: 0, ry: 0 };
    this._stickBiasCaptured = false;
  }
}

export default GamepadManager;

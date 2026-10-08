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

/**
 * GamepadCombatController - 手柄战斗操作控制器
 *
 * 处理手柄的「按住→瞄准→释放」三段式操作：
 *   RT  普通攻击（右摇杆方向，快按=面向攻击，长按=精确朝向）
 *   RB  释放当前选中技能（右摇杆瞄准）
 *   LB  切换技能（按住弹环形轮盘，右摇杆选择，松开确认）
 *   Y   由 InputManager 作为独立 jump 虚拟键处理（按下即跳）
 *   轻功/投掷 作为轮盘技能，由 RB 释放
 *   LT  格挡（按住期间生效）
 *
 * 该控制器不直接修改游戏状态，而是产出「意图」供场景逻辑执行。
 * 场景每帧调用 update() → 读取 intents → 执行对应操作 → 调用 consumeIntents()。
 */

import {
  PadButton,
  ATTACK_ACTION,
  SKILL_RELEASE_ACTION,
  SKILL_SWITCH_ACTION,
  FLIGHT_ACTION,
  THROW_ACTION,
  BLOCK_ACTION
} from './Xbox360Profile.js';

/** 快按阈值（毫秒）：无有效右摇杆方向时使用角色面向方向 */
const QUICK_TAP_MS = 150;
/** 已由 GamepadManager 应用死区；这里只过滤非零浮点噪声。 */
const ATTACK_AIM_EPSILON = 0.001;
/** Y 按住达到此时长后才进入轻功瞄准；此前松开均视为跳跃 */
const FLIGHT_AIM_HOLD_MS = 1000;
/** 环形轮盘弹出延迟（毫秒）：LB 按住超过此时间才弹轮盘，否则为快切 */
const WHEEL_POPUP_MS = 200;

/**
 * 意图类型
 */
export const IntentType = {
  ATTACK: 'attack',             // 普通攻击
  SKILL_RELEASE: 'skillRelease', // 释放技能
  SKILL_SWITCH: 'skillSwitch',   // 切换技能（快按顺切）
  SKILL_WHEEL_OPEN: 'skillWheelOpen',   // 打开轮盘
  SKILL_WHEEL_CLOSE: 'skillWheelClose', // 关闭轮盘并确认
  FLIGHT: 'flight',             // 轻功
  JUMP: 'jump',                 // 跳跃
  THROW: 'throw',               // 投掷
  BLOCK_START: 'blockStart',    // 格挡开始
  BLOCK_END: 'blockEnd'         // 格挡结束
};

export class GamepadCombatController {
  constructor() {
    /** 当前选中的技能索引（0-based，对应 combat.skills 中可用技能列表） */
    this.currentSkillIndex = 0;
    /** 可用技能数量（由场景设置） */
    this.skillCount = 5;

    // ---- 内部状态 ----
    this._attackHolding = false;
    this._lastAttackDirection = null;
    this._lastAttackMagnitude = 0;
    this._skillHolding = false;
    this._flightHolding = false;
    this._flightAiming = false;
    this._throwHolding = false;
    this._throwDirection = { x: 0, y: 0 };
    this._throwMagnitude = 0;
    this._blockActive = false;
    this._wheelOpen = false;
    this._wheelHoldStart = 0;

    /** 本帧产出的意图列表 */
    this.intents = [];

    /** 最近一次瞄准方向（归一化），供场景读取 */
    this.aimDirection = { x: 0, y: 0 };
    /** 最近一次瞄准推杆量（0~1） */
    this.aimMagnitude = 0;
    /** 轻功瞄准方向（右摇杆） */
    this.flightDirection = { x: 0, y: 0 };
    this.flightMagnitude = 0;
    /** Y 轻按期间缓存的左摇杆方向，保证同时松开摇杆与 Y 时仍按按下方向跳跃。 */
    this.jumpDirection = { x: 0, y: 0 };
    this.jumpMagnitude = 0;
    /** 轮盘选中索引（-1=未选） */
    this.wheelSelectedIndex = -1;
  }

  /**
   * 每帧更新，读取 GamepadManager 状态产出意图。
   * @param {import('./GamepadManager.js').GamepadManager} gamepad
   * @param {Object} [options]
   * @param {boolean} [options.shoulderOverride] 肩键让位（手柄军团指挥态，按住 LB 下达军队命令）：
   *   RB 技能释放与 LB 技能切换/轮盘暂停，瞬态复位；松开 LB 后自动恢复。RT 攻击 / LT 格挡不受影响。
   */
  update(gamepad, options = {}) {
    this.intents = [];
    if (!gamepad || !gamepad.isConnected()) {
      this.cancelTransientState();
      return;
    }

    const shoulderOverride = options.shoulderOverride === true;
    const rightStick = gamepad.rightStick;

    // 更新瞄准方向（右摇杆）；归中时清空，避免 RB 松开沿用上一次摇杆方向。
    this.aimDirection = rightStick.magnitude > 0
      ? { x: rightStick.x, y: rightStick.y }
      : { x: 0, y: 0 };
    this.aimMagnitude = rightStick.magnitude;

    // ---- RT 攻击 ----
    this._processAttack(gamepad, rightStick);

    // ---- RB 释放技能 / LB 切换技能（军团指挥态时让位给军队命令）----
    if (shoulderOverride) {
      this._cancelShoulderTransientState();
    } else {
      this._processSkillRelease(gamepad, rightStick);
      this._processSkillSwitch(gamepad, rightStick);
    }

    // ---- LT 格挡 ----
    this._processBlock(gamepad);
  }

  /** 肩键瞬态复位（指挥态接管期间防残留：瞄准/轮盘/按住计数全部清零）。 */
  _cancelShoulderTransientState() {
    this._skillHolding = false;
    this._flightHolding = false;
    this._flightAiming = false;
    this._throwHolding = false;
    this._throwMagnitude = 0;
    this._wheelOpen = false;
    this._wheelHoldStart = 0;
    this.wheelSelectedIndex = -1;
  }

  /** 消费意图（场景处理完毕后调用） */
  consumeIntents() {
    this.intents = [];
  }

  /** 查询是否有指定类型的意图 */
  hasIntent(type) {
    return this.intents.some(i => i.type === type);
  }

  /** 获取指定类型的意图 */
  getIntent(type) {
    return this.intents.find(i => i.type === type) || null;
  }

  /** 轮盘是否打开中 */
  get isWheelOpen() {
    return this._wheelOpen;
  }

  /** RT 是否处于按住瞄准阶段。 */
  get isAttackHolding() {
    return this._attackHolding;
  }

  /** RB 是否处于按住瞄准阶段。 */
  get isSkillHolding() {
    return this._skillHolding;
  }

  /** RT 本次按住期间最后一个越过死区的单位方向；调用方只能读取副本。 */
  get attackDirection() {
    return this._lastAttackDirection ? { ...this._lastAttackDirection } : null;
  }

  get attackMagnitude() {
    return this._lastAttackMagnitude;
  }

  /**
   * 取消断连、模态接管或场景退出后不能再收到释放沿的瞬态。
   * @returns {{blockWasActive:boolean, skillWasHolding:boolean}}
   */
  cancelTransientState() {
    const result = {
      blockWasActive: this._blockActive,
      skillWasHolding: this._skillHolding
    };
    this._attackHolding = false;
    this._lastAttackDirection = null;
    this._lastAttackMagnitude = 0;
    this._skillHolding = false;
    this._flightHolding = false;
    this._flightAiming = false;
    this._throwHolding = false;
    this._throwDirection = { x: 0, y: 0 };
    this._throwMagnitude = 0;
    this._blockActive = false;
    this._wheelOpen = false;
    this._wheelHoldStart = 0;
    this.wheelSelectedIndex = this.currentSkillIndex;
    this.aimDirection = { x: 0, y: 0 };
    this.aimMagnitude = 0;
    this.flightDirection = { x: 0, y: 0 };
    this.flightMagnitude = 0;
    this.jumpDirection = { x: 0, y: 0 };
    this.jumpMagnitude = 0;
    this.consumeIntents();
    return result;
  }

  /**
   * 取消当前轮盘选择，供不需要清空其他战斗状态的轮盘路径调用。
   * @returns {void}
   */
  cancelSkillWheel() {
    this._wheelOpen = false;
    this._wheelHoldStart = 0;
    this.wheelSelectedIndex = this.currentSkillIndex;
    this.consumeIntents();
  }

  /** 是否正在瞄准（攻击/技能/投掷按住中） */
  get isAiming() {
    return this._attackHolding || this._skillHolding || this._throwHolding;
  }

  /** Y 按住超过阈值后是否正在瞄准轻功 */
  get isFlightAiming() {
    return this._flightAiming;
  }

  // ==================== 私有处理方法 ====================

  _getButtonForAction(gamepad, action) {
    for (const [indexStr, bound] of Object.entries(gamepad.bindings)) {
      if (bound === action) return Number(indexStr);
    }
    return -1;
  }

  _processAttack(gamepad, rightStick) {
    const btn = this._getButtonForAction(gamepad, ATTACK_ACTION);
    if (btn < 0) {
      this._resetAttackState();
      return;
    }

    const pressed = gamepad.isButtonPressed(btn);
    const released = gamepad.buttonsReleased.has(btn);
    const down = gamepad.isButtonDown(btn);

    if (pressed) {
      this._attackHolding = true;
      this._lastAttackDirection = null;
      this._lastAttackMagnitude = 0;
    }

    // 只在本次 RT holding 内缓存越过死区的最后有效单位方向；归中不覆盖它。
    if (this._attackHolding) this._cacheAttackDirection(rightStick);

    if (released && this._attackHolding) {
      const holdMs = gamepad.getButtonHoldDuration(btn);
      const direction = this.attackDirection;
      const magnitude = this.attackMagnitude;
      this._resetAttackState();
      this.intents.push({
        type: IntentType.ATTACK,
        direction,
        magnitude,
        holdMs,
        isQuickTap: holdMs < QUICK_TAP_MS
      });
      return;
    }

    // 若释放沿被模态层消费，下一次可执行帧只清状态，绝不补发陈旧攻击。
    if (this._attackHolding && !down) this._resetAttackState();
  }

  _cacheAttackDirection(rightStick = {}) {
    const x = Number(rightStick.x) || 0;
    const y = Number(rightStick.y) || 0;
    const vectorMagnitude = Math.hypot(x, y);
    const stickMagnitude = Number(rightStick.magnitude) || 0;
    if (stickMagnitude <= ATTACK_AIM_EPSILON || vectorMagnitude <= ATTACK_AIM_EPSILON) return;
    this._lastAttackDirection = { x: x / vectorMagnitude, y: y / vectorMagnitude };
    this._lastAttackMagnitude = Math.min(1, Math.max(0, stickMagnitude));
  }

  _resetAttackState() {
    this._attackHolding = false;
    this._lastAttackDirection = null;
    this._lastAttackMagnitude = 0;
  }

  _processSkillRelease(gamepad, rightStick) {
    const btn = this._getButtonForAction(gamepad, SKILL_RELEASE_ACTION);
    if (btn < 0) return;

    const pressed = gamepad.isButtonPressed(btn);
    const released = gamepad.buttonsReleased.has(btn);

    if (pressed) {
      this._skillHolding = true;
    }

    if (released && this._skillHolding) {
      this._skillHolding = false;
      this.intents.push({
        type: IntentType.SKILL_RELEASE,
        skillIndex: this.currentSkillIndex,
        direction: { x: this.aimDirection.x, y: this.aimDirection.y },
        magnitude: this.aimMagnitude
      });
    }
  }

  _processSkillSwitch(gamepad, rightStick) {
    const btn = this._getButtonForAction(gamepad, SKILL_SWITCH_ACTION);
    if (btn < 0) return;

    const pressed = gamepad.isButtonPressed(btn);
    const released = gamepad.buttonsReleased.has(btn);
    const down = gamepad.isButtonDown(btn);

    if (pressed) {
      this._wheelHoldStart = performance.now();
    }

    // 按住超过阈值：弹出轮盘
    if (down && !this._wheelOpen) {
      const elapsed = performance.now() - this._wheelHoldStart;
      if (elapsed >= WHEEL_POPUP_MS) {
        this._wheelOpen = true;
        this.wheelSelectedIndex = this.currentSkillIndex;
        this.intents.push({ type: IntentType.SKILL_WHEEL_OPEN });
      }
    }

    // 轮盘打开期间：右摇杆选择
    if (this._wheelOpen && rightStick.magnitude > 0.4) {
      // 按角度确定选中索引
      const angle = Math.atan2(rightStick.y, rightStick.x);
      // 将 -PI~PI 映射到 0~skillCount 的索引
      const normalizedAngle = (angle + Math.PI) / (Math.PI * 2); // 0~1
      this.wheelSelectedIndex = Math.floor(normalizedAngle * this.skillCount) % this.skillCount;
    }

    // 释放
    if (released) {
      if (this._wheelOpen) {
        // 轮盘确认
        this._wheelOpen = false;
        if (this.wheelSelectedIndex >= 0 && this.wheelSelectedIndex < this.skillCount) {
          this.currentSkillIndex = this.wheelSelectedIndex;
        }
        this.intents.push({
          type: IntentType.SKILL_WHEEL_CLOSE,
          selectedIndex: this.currentSkillIndex
        });
      } else {
        // 快按：顺序切到下一个
        this.currentSkillIndex = (this.currentSkillIndex + 1) % this.skillCount;
        this.intents.push({
          type: IntentType.SKILL_SWITCH,
          selectedIndex: this.currentSkillIndex
        });
      }
      this._wheelHoldStart = 0;
    }
  }

  _processFlight(gamepad, leftStick) {
    const btn = this._getButtonForAction(gamepad, FLIGHT_ACTION);
    if (btn < 0) return;

    const pressed = gamepad.isButtonPressed(btn);
    const released = gamepad.buttonsReleased.has(btn);
    const rightStick = gamepad.rightStick;

    if (pressed) {
      this._flightHolding = true;
      this._flightAiming = false;
      this.flightDirection = { x: 0, y: 0 };
      this.flightMagnitude = 0;
      this.jumpDirection = leftStick.magnitude > 0.2
        ? { x: leftStick.x, y: leftStick.y }
        : { x: 0, y: 0 };
      this.jumpMagnitude = leftStick.magnitude;
    }

    const holdMs = this._flightHolding ? gamepad.getButtonHoldDuration(btn) : 0;
    if (this._flightHolding && holdMs < FLIGHT_AIM_HOLD_MS && leftStick.magnitude > 0.2) {
      this.jumpDirection = { x: leftStick.x, y: leftStick.y };
      this.jumpMagnitude = leftStick.magnitude;
    }
    if (this._flightHolding && holdMs >= FLIGHT_AIM_HOLD_MS) {
      this._flightAiming = true;
      // 进入轻功瞄准后，右摇杆绝对位置实时映射虚线框；归中即回到脚下。
      if (rightStick.magnitude > 0.2) {
        this.flightDirection = { x: rightStick.x, y: rightStick.y };
        this.flightMagnitude = rightStick.magnitude;
      } else {
        this.flightDirection = { x: 0, y: 0 };
        this.flightMagnitude = 0;
      }
    }

    if (released && this._flightHolding) {
      const wasAiming = this._flightAiming;
      this._flightHolding = false;
      this._flightAiming = false;

      if (holdMs < FLIGHT_AIM_HOLD_MS) {
        // 未满 1 秒：使用按住期间缓存的左摇杆方向；无方向时原地跳跃。
        const direction = this.jumpMagnitude > 0.2 ? { ...this.jumpDirection } : null;
        this.intents.push({
          type: IntentType.JUMP,
          direction,
          isQuickTap: true
        });
      } else if (wasAiming && this.flightMagnitude > 0.2) {
        // 满 1 秒并移动了虚线框：松开后施展轻功。
        this.intents.push({
          type: IntentType.FLIGHT,
          direction: { ...this.flightDirection },
          magnitude: this.flightMagnitude,
          isQuickTap: false
        });
      }
      // 满 1 秒但虚线框仍在脚下时取消轻功。
      this.flightMagnitude = 0;
      this.jumpMagnitude = 0;
    }
  }

  _processThrow(gamepad, rightStick) {
    const btn = this._getButtonForAction(gamepad, THROW_ACTION);
    if (btn < 0) return;

    const pressed = gamepad.isButtonPressed(btn);
    const released = gamepad.buttonsReleased.has(btn);

    if (pressed) {
      this._throwHolding = true;
      this._throwDirection = { x: 0, y: 0 };
      this._throwMagnitude = 0;
    }

    // 按住期间：右摇杆更新投掷方向（统一用右摇杆瞄准）
    if (this._throwHolding && rightStick.magnitude > 0) {
      this._throwDirection = { x: rightStick.x, y: rightStick.y };
      this._throwMagnitude = rightStick.magnitude;
    }

    if (released && this._throwHolding) {
      this._throwHolding = false;
      const holdMs = gamepad.getButtonHoldDuration(btn);

      if (holdMs < QUICK_TAP_MS) {
        // 快按：面向方向投掷（由场景用角色朝向填充方向）
        this.intents.push({
          type: IntentType.THROW,
          direction: null, // null = 用角色面向
          magnitude: 1,
          isQuickTap: true
        });
      } else if (this._throwMagnitude > 0.2) {
        // 长按+推了摇杆：精确方向投掷
        this.intents.push({
          type: IntentType.THROW,
          direction: { ...this._throwDirection },
          magnitude: this._throwMagnitude,
          isQuickTap: false
        });
      }
      // 长按但没推摇杆 = 取消
      this._throwMagnitude = 0;
    }
  }

  _processBlock(gamepad) {
    const btn = this._getButtonForAction(gamepad, BLOCK_ACTION);
    if (btn < 0) return;

    const pressed = gamepad.isButtonPressed(btn);
    const released = gamepad.buttonsReleased.has(btn);

    if (pressed && !this._blockActive) {
      this._blockActive = true;
      this.intents.push({ type: IntentType.BLOCK_START });
    }

    if (released && this._blockActive) {
      this._blockActive = false;
      this.intents.push({ type: IntentType.BLOCK_END });
    }
  }
}

export default GamepadCombatController;

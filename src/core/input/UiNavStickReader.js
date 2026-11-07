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
 * UI 方向导航统一读取器（手柄侧）。
 *
 * 口径：手柄状态下所有方向控制只认左摇杆——十字键不参与任何方向判定
 * （十字键上/下仍是红/蓝药水的动作绑定，走虚拟键 skill1/skill2，另链处理）。
 * 摇杆优先：死区（默认 0.5）内不放行任何方向输入。
 *
 * 边沿触发：方向发生变化时才输出非零分量，避免按住不放连发；
 * 首次读取（以及 reset 后的首帧）只采集基线——弹窗弹出瞬间摇杆若仍被推着，
 * 不会立即触发切换。
 */
export const UI_NAV_STICK_DEADZONE = 0.5;

export class UiNavStickReader {
  constructor({ deadzone = UI_NAV_STICK_DEADZONE } = {}) {
    this.deadzone = deadzone;
    this._x = 0;
    this._y = 0;
    this._baselinePending = true;
  }

  /** 打开/关闭弹窗时复位：下一次读取重新采集基线，不继承上一个界面的摇杆状态。 */
  reset() {
    this._x = 0;
    this._y = 0;
    this._baselinePending = true;
  }

  /**
   * 读取一次方向（每个视图每帧只应调用一次）。
   * @param {object|null} gamepad GamepadManager（读取 leftStick）
   * @param {{horizontal?: boolean, vertical?: boolean, dominant?: boolean}} options
   *   需要读取的轴（视图内保持固定）；dominant=true 时双轴同时越死区只保留偏转更大的一轴，
   *   保证一帧只产生一个方向（网格导航用）。
   * @returns {{x: number, y: number}} 分量取值 -1/0/1，边沿触发
   */
  read(gamepad, { horizontal = true, vertical = true, dominant = false } = {}) {
    const stick = gamepad?.leftStick;
    const rawX = horizontal ? (Number(stick?.x) || 0) : 0;
    const rawY = vertical ? (Number(stick?.y) || 0) : 0;
    let x = this._discretize(rawX);
    let y = this._discretize(rawY);
    if (dominant && x !== 0 && y !== 0) {
      // 等值时取横向，与原「|x| >= |y| 优先横向」口径一致。
      if (Math.abs(rawX) >= Math.abs(rawY)) y = 0;
      else x = 0;
    }
    if (this._baselinePending) {
      this._x = x;
      this._y = y;
      this._baselinePending = false;
      return { x: 0, y: 0 };
    }
    const directionX = x !== 0 && x !== this._x ? x : 0;
    const directionY = y !== 0 && y !== this._y ? y : 0;
    this._x = x;
    this._y = y;
    return { x: directionX, y: directionY };
  }

  _discretize(value) {
    if (value <= -this.deadzone) return -1;
    if (value >= this.deadzone) return 1;
    return 0;
  }
}

export default UiNavStickReader;

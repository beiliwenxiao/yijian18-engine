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

import { describe, expect, it } from 'vitest';
import { UI_NAV_STICK_DEADZONE, UiNavStickReader } from './UiNavStickReader.js';
import { PadButton } from './Xbox360Profile.js';

const pad = ({ x = 0, y = 0, pressed = [] } = {}) => ({
  leftStick: { x, y, magnitude: Math.hypot(x, y) },
  isButtonPressed: index => pressed.includes(index)
});

describe('UiNavStickReader 手柄方向统一读取器', () => {
  it('死区内不放行任何方向输入', () => {
    const reader = new UiNavStickReader();
    expect(reader.read(pad({ x: 0.49, y: -0.49 }))).toEqual({ x: 0, y: 0 });
    reader.read(pad());
    expect(reader.read(pad({ x: 0.49, y: 0 }))).toEqual({ x: 0, y: 0 });
    expect(UI_NAV_STICK_DEADZONE).toBe(0.5);
  });

  it('首帧只采集基线：偏置摇杆打开时不触发方向', () => {
    const reader = new UiNavStickReader();
    expect(reader.read(pad({ x: -0.9 }))).toEqual({ x: 0, y: 0 });
    expect(reader.read(pad({ x: -0.9 }))).toEqual({ x: 0, y: 0 });
  });

  it('方向变化时边沿触发，持续按住不连发', () => {
    const reader = new UiNavStickReader();
    reader.read(pad());
    expect(reader.read(pad({ x: 0.9 }))).toEqual({ x: 1, y: 0 });
    expect(reader.read(pad({ x: 0.9 }))).toEqual({ x: 0, y: 0 });
    reader.read(pad());
    expect(reader.read(pad({ x: 0.9 }))).toEqual({ x: 1, y: 0 });
  });

  it('十字键完全不参与方向判定（只认左摇杆）', () => {
    const reader = new UiNavStickReader();
    reader.read(pad());
    const dpadOnly = pad({ pressed: [PadButton.DPAD_LEFT, PadButton.DPAD_UP] });
    expect(reader.read(dpadOnly)).toEqual({ x: 0, y: 0 });
    expect(reader.read(dpadOnly)).toEqual({ x: 0, y: 0 });
  });

  it('按轴过滤：只读水平轴时忽略竖直输入', () => {
    const reader = new UiNavStickReader();
    reader.read(pad());
    expect(reader.read(pad({ x: 0, y: -0.9 }), { horizontal: true, vertical: false }))
      .toEqual({ x: 0, y: 0 });
  });

  it('dominant：双轴同时越死区只输出偏转更大的一轴（等值取横向）', () => {
    const reader = new UiNavStickReader();
    reader.read(pad());
    expect(reader.read(pad({ x: -0.7, y: 0.9 }), { dominant: true })).toEqual({ x: 0, y: 1 });
    reader.read(pad());
    expect(reader.read(pad({ x: 0.9, y: -0.7 }), { dominant: true })).toEqual({ x: 1, y: 0 });
    reader.read(pad());
    expect(reader.read(pad({ x: -0.8, y: 0.8 }), { dominant: true })).toEqual({ x: -1, y: 0 });
  });

  it('reset 后重新采集基线，不继承上一界面的摇杆状态', () => {
    const reader = new UiNavStickReader();
    reader.read(pad());
    expect(reader.read(pad({ x: -0.9 }))).toEqual({ x: -1, y: 0 });
    reader.reset();
    expect(reader.read(pad({ x: -0.9 }))).toEqual({ x: 0, y: 0 });
    expect(reader.read(pad({ x: 0.9 }))).toEqual({ x: 1, y: 0 });
  });
});

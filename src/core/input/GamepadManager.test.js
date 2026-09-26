/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 ************************************************************/

import { describe, it, expect, beforeEach } from 'vitest';
import { GamepadManager } from './GamepadManager.js';
import { PadButton } from './Xbox360Profile.js';

/** 构造一个假的 W3C standard gamepad 快照 */
function makePad(overrides = {}) {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  const axes = [0, 0, 0, 0];
  return {
    index: 0,
    id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
    mapping: 'standard',
    connected: true,
    buttons,
    axes,
    ...overrides
  };
}

/** 假 navigator：getGamepads 返回可变的 pad 数组 */
function makeNav(pad) {
  const state = { pads: pad ? [pad] : [] };
  return {
    nav: { getGamepads: () => state.pads },
    setPads: (pads) => { state.pads = pads; }
  };
}

describe('GamepadManager 基础', () => {
  it('无 Gamepad API 时 isSupported 为 false', () => {
    const gm = new GamepadManager({ nav: {} });
    expect(gm.isSupported()).toBe(false);
    expect(gm.poll()).toBe(false);
    expect(gm.isConnected()).toBe(false);
  });

  it('连接手柄后 poll 返回 true 并触发 onConnect', () => {
    const pad = makePad();
    const { nav } = makeNav(pad);
    const gm = new GamepadManager({ nav });
    let connectedInfo = null;
    gm.onConnect((info) => { connectedInfo = info; });

    expect(gm.poll()).toBe(true);
    expect(gm.isConnected()).toBe(true);
    expect(connectedInfo).toBeTruthy();
    expect(connectedInfo.isXbox).toBe(true);
    expect(connectedInfo.standard).toBe(true);
  });

  it('手柄移除后 poll 返回 false 并触发 onDisconnect', () => {
    const pad = makePad();
    const { nav, setPads } = makeNav(pad);
    const gm = new GamepadManager({ nav });
    let disconnected = false;
    gm.onDisconnect(() => { disconnected = true; });

    gm.poll();
    setPads([]);
    expect(gm.poll()).toBe(false);
    expect(gm.isConnected()).toBe(false);
    expect(disconnected).toBe(true);
  });
});

describe('GamepadManager 按钮', () => {
  let pad, nav, gm;
  beforeEach(() => {
    pad = makePad();
    ({ nav } = makeNav(pad));
    gm = new GamepadManager({ nav });
    gm.poll();
  });

  it('按下 A 键：本帧 pressed，持续 down，松开 released', () => {
    pad.buttons[PadButton.A] = { pressed: true, value: 1 };
    gm.poll();
    expect(gm.isButtonDown(PadButton.A)).toBe(true);
    expect(gm.isButtonPressed(PadButton.A)).toBe(true);

    // 保持按住：不再是本帧 pressed
    gm.poll();
    expect(gm.isButtonDown(PadButton.A)).toBe(true);
    expect(gm.isButtonPressed(PadButton.A)).toBe(false);

    // 松开
    pad.buttons[PadButton.A] = { pressed: false, value: 0 };
    gm.poll();
    expect(gm.isButtonDown(PadButton.A)).toBe(false);
    expect(gm.isButtonReleased(PadButton.A)).toBe(true);
  });

  it('扳机按阈值离散化', () => {
    const g = new GamepadManager({ nav, triggerThreshold: 0.5 });
    g.poll();
    pad.buttons[PadButton.LT] = { pressed: false, value: 0.3 };
    g.poll();
    expect(g.isButtonDown(PadButton.LT)).toBe(false);

    pad.buttons[PadButton.LT] = { pressed: false, value: 0.8 };
    g.poll();
    expect(g.isButtonDown(PadButton.LT)).toBe(true);
  });
});

describe('GamepadManager 摇杆', () => {
  let pad, nav, gm;
  beforeEach(() => {
    pad = makePad();
    ({ nav } = makeNav(pad));
    gm = new GamepadManager({ nav, deadzone: 0.2 });
    gm.poll();
  });

  it('死区内的轻微漂移被归零', () => {
    pad.axes = [0.1, -0.1, 0, 0];
    gm.poll();
    expect(gm.leftStick.magnitude).toBe(0);
    expect(gm.getMoveVector().magnitude).toBe(0);
  });

  it('推满摇杆输出归一化方向且 magnitude 接近 1', () => {
    pad.axes = [1, 0, 0, 0];
    gm.poll();
    const mv = gm.getMoveVector();
    expect(mv.x).toBeCloseTo(1, 5);
    expect(mv.y).toBeCloseTo(0, 5);
    expect(mv.magnitude).toBeCloseTo(1, 5);
  });

  it('摇杆归中时十字键接管移动，magnitude 记为 1', () => {
    pad.axes = [0, 0, 0, 0];
    pad.buttons[PadButton.DPAD_RIGHT] = { pressed: true, value: 1 };
    gm.poll();
    const mv = gm.getMoveVector();
    expect(mv.x).toBeCloseTo(1, 5);
    expect(mv.magnitude).toBe(1);
  });
});

describe('GamepadManager 虚拟键映射', () => {
  it('默认绑定把 X 映射为拾取键 e、Back 映射为背包 b、Start 映射为系统设置', () => {
    const pad = makePad();
    const { nav } = makeNav(pad);
    const gm = new GamepadManager({ nav });
    gm.poll();

    pad.buttons[PadButton.X] = { pressed: true, value: 1 };
    pad.buttons[PadButton.BACK] = { pressed: true, value: 1 };
    pad.buttons[PadButton.START] = { pressed: true, value: 1 };
    gm.poll();

    const vk = gm.getVirtualKeys();
    expect(vk.down.has('e')).toBe(true);
    expect(vk.pressed.has('e')).toBe(true);
    expect(vk.down.has('b')).toBe(true);
    expect(vk.down.has('settings')).toBe(true);
  });

  it('A 键不产生虚拟按键（走虚拟鼠标左键）', () => {
    const pad = makePad();
    const { nav } = makeNav(pad);
    const gm = new GamepadManager({ nav });
    gm.poll();
    pad.buttons[PadButton.A] = { pressed: true, value: 1 };
    gm.poll();
    const vk = gm.getVirtualKeys();
    // A 绑定为 null，不进虚拟键集合
    expect([...vk.down]).not.toContain('a');
  });

  it('左摇杆推向左上时补出方向键 up/left', () => {
    const pad = makePad();
    const { nav } = makeNav(pad);
    const gm = new GamepadManager({ nav });
    gm.poll();
    pad.axes = [-0.8, -0.8, 0, 0];
    gm.poll();
    const vk = gm.getVirtualKeys();
    expect(vk.down.has('left')).toBe(true);
    expect(vk.down.has('up')).toBe(true);
  });

  it('setBinding 可覆盖默认绑定', () => {
    const pad = makePad();
    const { nav } = makeNav(pad);
    const gm = new GamepadManager({ nav });
    gm.setBinding(PadButton.B, 'skill5');
    gm.poll();
    pad.buttons[PadButton.B] = { pressed: true, value: 1 };
    gm.poll();
    expect(gm.getVirtualKeys().down.has('skill5')).toBe(true);
  });
});

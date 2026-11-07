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

import { describe, expect, it, vi } from 'vitest';
import { IrreversibleChoiceView } from './IrreversibleChoiceView.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

const SOUL_CHOICES = [
  { id: 'cancel', label: '取消', immediate: true, consequences: ['保持死亡状态'] },
  { id: 'revive', label: '复活', immediate: true, consequences: ['在火堆旁复活'] }
];

const createInputManager = ({ pressedKeys = [] } = {}) => ({
  isKeyPressed: key => pressedKeys.includes(key),
  isMouseClicked: () => false,
  isMouseClickHandled: () => false,
  getMouseButton: () => 0,
  getMousePosition: () => ({ x: -1, y: -1 }),
  markMouseClickHandled: () => {}
});

const createGamepad = ({ x = 0, pressed = [] } = {}) => ({
  leftStick: { x, y: 0, magnitude: Math.abs(x) },
  isButtonPressed: index => pressed.includes(index)
});

function createView({ compact = true, selectedId = undefined } = {}) {
  const onCommand = vi.fn();
  const view = new IrreversibleChoiceView({ onCommand });
  view.open({
    title: '确认复活',
    ...(compact ? { presentation: { variant: 'compact', allowMovement: true } } : {}),
    allowCancel: true,
    ...(selectedId === undefined ? {} : { selectedId }),
    choices: SOUL_CHOICES
  });
  return { view, onCommand };
}

const tick = (view, { inputManager = createInputManager(), gamepad = createGamepad() } = {}) => (
  view.handleInput({ inputManager, gamepad, viewWidth: 1280, viewHeight: 720 })
);

describe('IrreversibleChoiceView 灵魂复活焦点与摇杆导航', () => {
  it('compact 灵魂快照默认焦点为「复活」', () => {
    const { view } = createView({ selectedId: 'revive' });
    expect(view.focusedChoiceId).toBe('revive');
  });

  it('调用方漏传 selectedId 时回退到非「取消」选项', () => {
    const { view } = createView();
    expect(view.focusedChoiceId).toBe('revive');
  });

  it('打开时摇杆已偏置：首帧不切换，松手后再推才切换', () => {
    const { view } = createView({ selectedId: 'revive' });
    tick(view, { gamepad: createGamepad({ x: -0.9 }) });
    expect(view.focusedChoiceId).toBe('revive');
    tick(view, { gamepad: createGamepad({ x: -0.9 }) });
    expect(view.focusedChoiceId).toBe('revive');
    tick(view, { gamepad: createGamepad({ x: 0 }) });
    expect(view.focusedChoiceId).toBe('revive');
    tick(view, { gamepad: createGamepad({ x: 0.9 }) });
    expect(view.focusedChoiceId).toBe('cancel');
  });

  it('持续推住摇杆只切换一次，不连发', () => {
    const { view } = createView({ selectedId: 'revive' });
    tick(view, { gamepad: createGamepad({ x: 0 }) });
    tick(view, { gamepad: createGamepad({ x: 0.9 }) });
    expect(view.focusedChoiceId).toBe('cancel');
    tick(view, { gamepad: createGamepad({ x: 0.9 }) });
    tick(view, { gamepad: createGamepad({ x: 0.9 }) });
    expect(view.focusedChoiceId).toBe('cancel');
  });

  it('十字键不参与方向切换（方向只认左摇杆）', () => {
    const { view } = createView({ selectedId: 'revive' });
    tick(view, { gamepad: createGamepad({ x: 0 }) });
    tick(view, { gamepad: createGamepad({ pressed: [PadButton.DPAD_RIGHT] }) });
    expect(view.focusedChoiceId).toBe('revive');
    tick(view, { gamepad: createGamepad({ pressed: [PadButton.DPAD_LEFT] }) });
    expect(view.focusedChoiceId).toBe('revive');
  });

  it('A 键确认当前焦点，B 键在 allowCancel 下取消', () => {
    const { view, onCommand } = createView({ selectedId: 'revive' });
    tick(view, { gamepad: createGamepad({ pressed: [PadButton.A] }) });
    expect(onCommand).toHaveBeenCalledWith({ type: 'selectChoice', choiceId: 'revive' });
    tick(view, { gamepad: createGamepad({ pressed: [PadButton.B] }) });
    expect(onCommand).toHaveBeenCalledWith({ type: 'cancel' });
  });

  it('非 compact 弹窗键盘左右键仍可切换（回归）', () => {
    const onCommand = vi.fn();
    const view = new IrreversibleChoiceView({ onCommand });
    view.open({
      title: '不可逆选择',
      allowCancel: true,
      choices: [
        { id: 'left', label: '左' },
        { id: 'right', label: '右' }
      ]
    });
    expect(view.focusedChoiceId).toBe('left');
    tick(view, { inputManager: createInputManager() });
    tick(view, { inputManager: createInputManager({ pressedKeys: ['right'] }) });
    expect(view.focusedChoiceId).toBe('right');
  });
});

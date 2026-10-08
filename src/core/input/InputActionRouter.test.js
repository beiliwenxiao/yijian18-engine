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

import { describe, it, expect, beforeEach } from 'vitest';
import { InputActionRouter, HANDLER_PRIORITY } from './InputActionRouter.js';
import { InputEvent, InputEventType, InputDevice, PointerButton, InputHandler } from './InputEvent.js';

/** 最小可用的 InputManager 替身 */
function makeInputManager(state = {}) {
  const keys = new Set(state.keysDown || []);
  const pressed = new Set(state.keysPressed || []);
  let handled = false;

  return {
    mouse: { isTouch: !!state.isTouch },
    isKeyDown: (k) => keys.has(k),
    isKeyPressed: (k) => pressed.has(k),
    isMouseClicked: () => !!state.clicked,
    getMouseButton: () => (state.button !== undefined ? state.button : PointerButton.LEFT),
    getMousePosition: () => ({ x: state.x || 0, y: state.y || 0 }),
    getMouseWorldPosition: () => ({ x: (state.x || 0) + 100, y: (state.y || 0) + 100 }),
    markMouseClickHandled: () => { handled = true; },
    isMouseClickHandled: () => handled
  };
}

function leftClick(modifiers = {}) {
  return new InputEvent({
    type: InputEventType.POINTER_DOWN,
    device: InputDevice.MOUSE,
    button: PointerButton.LEFT,
    modifiers,
    screen: { x: 10, y: 10 }
  });
}

describe('InputEvent 单一消费', () => {
  it('首次消费成功，重复消费失败', () => {
    const event = leftClick();
    expect(event.consume(InputHandler.PICKUP)).toBe(true);
    expect(event.consumedBy).toBe(InputHandler.PICKUP);

    expect(event.consume(InputHandler.ATTACK)).toBe(false);
    expect(event.consumedBy).toBe(InputHandler.PICKUP);
  });

  it('未消费时 isConsumed 为 false', () => {
    expect(leftClick().isConsumed()).toBe(false);
  });

  it('修饰键与按键判定', () => {
    const ctrlClick = leftClick({ ctrl: true });
    expect(ctrlClick.isLeftDown()).toBe(true);
    expect(ctrlClick.modifiers.ctrl).toBe(true);

    const keyEvent = new InputEvent({ type: InputEventType.KEY_PRESS, key: 'e' });
    expect(keyEvent.isKey('e')).toBe(true);
    expect(keyEvent.isKey('f')).toBe(false);
  });
});

describe('InputActionRouter 优先级', () => {
  let router;
  let log;

  beforeEach(() => {
    router = new InputActionRouter({ inputManager: makeInputManager() });
    log = [];
  });

  /** 注册一个总是消费的处理者 */
  function registerGreedy(handlerName) {
    router.register(handlerName, {
      id: handlerName,
      handle: () => { log.push(handlerName); return true; }
    });
  }

  it('优先级顺序符合既有交互约定', () => {
    expect(HANDLER_PRIORITY).toEqual([
      InputHandler.MODAL_UI,
      InputHandler.PANEL_UI,
      InputHandler.AIMING,
      InputHandler.FLIGHT,
      InputHandler.THROW,
      InputHandler.PICKUP,
      InputHandler.SKILL,
      InputHandler.ATTACK,
      InputHandler.MOVE
    ]);
  });

  it('拾取优先于攻击', () => {
    registerGreedy(InputHandler.ATTACK);
    registerGreedy(InputHandler.PICKUP);

    router.enqueue(leftClick());
    const [event] = router.dispatch();

    expect(event.consumedBy).toBe(InputHandler.PICKUP);
    expect(log).toEqual([InputHandler.PICKUP]);
  });

  it('内置约束自动生效：攻击不接收右键，无需手写 canHandle', () => {
    registerGreedy(InputHandler.ATTACK);
    registerGreedy(InputHandler.MOVE);

    router.enqueue(new InputEvent({
      type: InputEventType.POINTER_DOWN,
      button: PointerButton.RIGHT
    }));

    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.MOVE);
    expect(log).toEqual([InputHandler.MOVE]);
  });

  it('内置约束自动生效：移动不接收左键', () => {
    registerGreedy(InputHandler.MOVE);

    router.enqueue(leftClick());
    expect(router.dispatch()[0].isConsumed()).toBe(false);
  });

  it('内置约束自动生效：Ctrl 左键跳过拾取与攻击，落到轻功', () => {
    registerGreedy(InputHandler.FLIGHT);
    registerGreedy(InputHandler.PICKUP);
    registerGreedy(InputHandler.ATTACK);

    router.enqueue(leftClick({ ctrl: true }));
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.FLIGHT);
    expect(log).toEqual([InputHandler.FLIGHT]);
  });

  it('内置约束自动生效：Shift 左键落到投掷', () => {
    registerGreedy(InputHandler.THROW);
    registerGreedy(InputHandler.PICKUP);
    registerGreedy(InputHandler.ATTACK);

    router.enqueue(leftClick({ shift: true }));
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.THROW);
  });

  it('无修饰键左键落到拾取而非轻功', () => {
    registerGreedy(InputHandler.FLIGHT);
    registerGreedy(InputHandler.PICKUP);

    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.PICKUP);
  });

  it('键盘事件不受按键约束影响', () => {
    registerGreedy(InputHandler.PICKUP);

    router.enqueueInteract();
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.PICKUP);
  });

  it('constraint 为 null 时取消内置约束', () => {
    router.register(InputHandler.ATTACK, {
      constraint: null,
      handle: () => { log.push('attack'); return true; }
    });

    router.enqueue(new InputEvent({
      type: InputEventType.POINTER_DOWN,
      button: PointerButton.RIGHT
    }));
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.ATTACK);
  });

  it('自定义 constraint 可覆盖内置约束', () => {
    router.register(InputHandler.MOVE, {
      constraint: { buttons: [PointerButton.LEFT] },
      handle: () => true
    });

    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.MOVE);
  });

  it('模态 UI 优先于其余全部处理者', () => {
    registerGreedy(InputHandler.PICKUP);
    registerGreedy(InputHandler.ATTACK);
    registerGreedy(InputHandler.MODAL_UI);

    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.MODAL_UI);
    expect(log).toEqual([InputHandler.MODAL_UI]);
  });

  it('无修饰键且未命中物品时落到攻击', () => {
    registerGreedy(InputHandler.FLIGHT);
    router.register(InputHandler.PICKUP, {
      // 模拟未命中可拾取对象
      handle: () => false
    });
    registerGreedy(InputHandler.ATTACK);

    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.ATTACK);
  });

  it('canHandle 返回 false 时跳过该处理者', () => {
    router.register(InputHandler.PICKUP, {
      canHandle: () => false,
      handle: () => { log.push('pickup'); return true; }
    });
    registerGreedy(InputHandler.ATTACK);

    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.ATTACK);
    expect(log).toEqual([InputHandler.ATTACK]);
  });

  it('handle 抛出异常时不中断分发', () => {
    router.register(InputHandler.PICKUP, {
      handle: () => { throw new Error('boom'); }
    });
    registerGreedy(InputHandler.ATTACK);

    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.ATTACK);
  });

  it('左键由攻击消费，不误触发移动', () => {
    registerGreedy(InputHandler.MOVE);
    registerGreedy(InputHandler.ATTACK);

    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.ATTACK);
  });

  it('无人消费时事件保持未消费', () => {
    router.enqueue(leftClick());
    expect(router.dispatch()[0].isConsumed()).toBe(false);
  });

  it('注销后不再接收事件', () => {
    const off = router.register(InputHandler.PICKUP, {
      handle: () => { log.push('pickup'); return true; }
    });
    registerGreedy(InputHandler.ATTACK);

    off();
    router.enqueue(leftClick());
    expect(router.dispatch()[0].consumedBy).toBe(InputHandler.ATTACK);
  });

  it('分发后队列清空', () => {
    router.enqueue(leftClick());
    router.dispatch();
    expect(router.dispatch()).toHaveLength(0);
  });
});

describe('InputActionRouter 采集与桥接', () => {
  it('从 InputManager 采集按键与指针事件', () => {
    const im = makeInputManager({ keysPressed: ['e'], clicked: true, x: 20, y: 30 });
    const router = new InputActionRouter({ inputManager: im });

    const events = router.collect(['e']);
    expect(events).toHaveLength(2);
    expect(events[0].isKey('e')).toBe(true);
    expect(events[1].type).toBe(InputEventType.POINTER_DOWN);
    expect(events[1].world).toEqual({ x: 120, y: 130 });
  });

  it('采集时带上修饰键状态', () => {
    const im = makeInputManager({ keysDown: ['ctrl'], clicked: true });
    const router = new InputActionRouter({ inputManager: im });

    const [pointer] = router.collect([]);
    expect(pointer.modifiers.ctrl).toBe(true);
    expect(pointer.modifiers.shift).toBe(false);
  });

  it('相机存在时用相机换算世界坐标', () => {
    const im = makeInputManager({ clicked: true, x: 5, y: 5 });
    const router = new InputActionRouter({
      inputManager: im,
      camera: { screenToWorld: (x, y) => ({ x: x * 2, y: y * 3 }) }
    });

    const [pointer] = router.collect([]);
    expect(pointer.world).toEqual({ x: 10, y: 15 });
  });

  it('拾取消费指针事件时同步标记旧 handled 机制', () => {
    const im = makeInputManager();
    const router = new InputActionRouter({ inputManager: im });
    router.register(InputHandler.PICKUP, { handle: () => true });

    router.enqueue(leftClick());
    router.dispatch();

    // 迁移期内 MeleeAttackSystem 仍读取该标记，必须同步
    expect(im.isMouseClickHandled()).toBe(true);
  });

  it('攻击消费时不标记 handled', () => {
    const im = makeInputManager();
    const router = new InputActionRouter({ inputManager: im });
    router.register(InputHandler.ATTACK, { handle: () => true });

    router.enqueue(leftClick());
    router.dispatch();
    expect(im.isMouseClickHandled()).toBe(false);
  });

  it('交互入口统一产生 E 键事件', () => {
    const router = new InputActionRouter({ inputManager: makeInputManager() });
    const candidates = [];

    router.register(InputHandler.PICKUP, {
      handle: (e) => { candidates.push(`${e.device}:${e.key}`); return true; }
    });

    router.enqueueInteract(InputDevice.VIRTUAL);
    router.enqueueInteract(InputDevice.TOUCH);
    router.enqueue(new InputEvent({ type: InputEventType.KEY_PRESS, device: InputDevice.KEYBOARD, key: 'e' }));
    router.dispatch();

    // 三种入口都被同一处理者以相同 key 处理
    expect(candidates).toEqual(['virtual:e', 'touch:e', 'keyboard:e']);
  });

  it('describeLastFrame 输出消费者用于排查争抢', () => {
    const router = new InputActionRouter({ inputManager: makeInputManager() });
    router.register(InputHandler.PICKUP, { handle: () => true });

    router.enqueue(leftClick());
    router.dispatch();

    expect(router.describeLastFrame()[0]).toContain('pickup');
  });
});

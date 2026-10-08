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
import { SceneSystemContainer, DependencyOwnership } from './SceneSystemContainer.js';
import { SceneLifecycleCoordinator } from './SceneLifecycleCoordinator.js';
import { SceneObjectProjector } from './SceneObjectProjector.js';
import { GameSceneRuntime, UpdateOrder, FramePhase } from './GameSceneRuntime.js';
import { InputHandler, InputEvent, InputEventType, PointerButton } from '../input/InputEvent.js';

/** 记录调用顺序的系统替身 */
function makeSystem(log, name) {
  return {
    updated: 0,
    destroyed: false,
    update() { this.updated++; log.push(`update:${name}`); },
    render() { log.push(`render:${name}`); },
    destroy() { this.destroyed = true; log.push(`destroy:${name}`); }
  };
}

function makeInputManager(state = {}) {
  let handled = false;
  let flushed = 0;
  return {
    mouse: {},
    isKeyDown: () => false,
    isKeyPressed: (k) => (state.keysPressed || []).includes(k),
    isMouseClicked: () => !!state.clicked,
    getMouseButton: () => (state.button !== undefined ? state.button : PointerButton.LEFT),
    getMousePosition: () => ({ x: 0, y: 0 }),
    getMouseWorldPosition: () => ({ x: 0, y: 0 }),
    markMouseClickHandled: () => { handled = true; },
    isMouseClickHandled: () => handled,
    update: () => { flushed++; },
    getFlushCount: () => flushed
  };
}

describe('SceneSystemContainer', () => {
  let container;
  let log;

  beforeEach(() => {
    container = new SceneSystemContainer();
    log = [];
  });

  it('按 order 升序更新系统', () => {
    container.register('late', makeSystem(log, 'late'), { order: 900 });
    container.register('early', makeSystem(log, 'early'), { order: 100 });
    container.register('mid', makeSystem(log, 'mid'), { order: 500 });

    container.update(0.016);
    expect(log).toEqual(['update:early', 'update:mid', 'update:late']);
  });

  it('update 为 false 的系统不参与更新', () => {
    const system = makeSystem(log, 'passive');
    container.register('passive', system, { update: false });

    container.update(0.016);
    expect(system.updated).toBe(0);
  });

  it('只有声明 render 的系统参与渲染', () => {
    container.register('a', makeSystem(log, 'a'), { order: 1, render: 'render' });
    container.register('b', makeSystem(log, 'b'), { order: 2 });

    container.render({});
    expect(log).toEqual(['render:a']);
  });

  it('单个系统抛错不影响其余系统', () => {
    container.register('bad', { update() { throw new Error('boom'); } }, { order: 1 });
    const good = makeSystem(log, 'good');
    container.register('good', good, { order: 2 });

    container.update(0.016);
    expect(good.updated).toBe(1);
  });

  it('destroy 覆盖全部系统并按逆序执行', () => {
    container.register('first', makeSystem(log, 'first'), { order: 1 });
    container.register('second', makeSystem(log, 'second'), { order: 2 });

    const cleaned = container.destroy();
    expect(log).toEqual(['destroy:second', 'destroy:first']);
    expect(cleaned).toEqual(['second', 'first']);
    expect(container.getNames()).toEqual([]);
  });

  it('依赖可注入并解析', () => {
    container.provide({ camera: { id: 'cam' } });
    container.register('sys', makeSystem(log, 'sys'));

    expect(container.resolve('camera').id).toBe('cam');
    expect(container.resolve('sys')).toBeDefined();
  });

  it('工厂函数创建系统时收到依赖', () => {
    container.provide({ value: 42 });
    const created = container.register('made', (deps) => ({ value: deps.value, update() {} }));
    expect(created.value).toBe(42);
  });

  it('注销系统会执行其清理', () => {
    const system = makeSystem(log, 'sys');
    container.register('sys', system);

    expect(container.unregister('sys')).toBe(true);
    expect(system.destroyed).toBe(true);
    expect(container.has('sys')).toBe(false);
  });

  it('拒绝同名隐式覆盖并保留原实例', () => {
    const first = makeSystem(log, 'first');
    const second = makeSystem(log, 'second');
    container.register('same', first);

    expect(container.register('same', second)).toBeNull();
    expect(container.resolve('same')).toBe(first);
  });

  it('同一 identity 只能有一个 owned 登记，borrowed alias 不释放', () => {
    const shared = makeSystem(log, 'shared');
    expect(container.register('owner', shared)).toBe(shared);
    expect(container.register('second-owner', shared)).toBeNull();
    expect(container.register('alias', shared, {
      ownership: DependencyOwnership.BORROWED,
      updateHook: false
    })).toBe(shared);

    container.destroy();
    expect(log).toEqual(['destroy:shared']);
  });

  it('同 order 按 sequence 更新，且同 frame token 恰好一次', () => {
    container.register('first', makeSystem(log, 'first'), { order: 10 });
    container.register('second', makeSystem(log, 'second'), { order: 10 });
    const token = Object.freeze({ frame: 1 });

    container.updateFrame(token, 0.016);
    container.updateFrame(token, 0.016);

    expect(log).toEqual(['update:first', 'update:second']);
    expect(container.getRegistration('first').frameToken).toBe(token);
  });

  it('重复 destroy 为 no-op 且不重复释放', () => {
    container.register('owned', makeSystem(log, 'owned'));
    expect(container.destroy()).toEqual(['owned']);
    expect(container.destroy()).toEqual([]);
    expect(log).toEqual(['destroy:owned']);
  });
});

describe('SceneLifecycleCoordinator', () => {
  it('严格逆序释放 owned，borrowed 只解除投影且重复 exit no-op', () => {
    const log = [];
    const coordinator = new SceneLifecycleCoordinator();
    coordinator.track('first', {}, () => log.push('dispose:first'), 1);
    coordinator.track('borrowed', {}, null, 2, {
      ownership: DependencyOwnership.BORROWED,
      detach: () => log.push('detach:borrowed')
    });
    coordinator.track('last', {}, () => log.push('dispose:last'), 2);

    coordinator.exit({ synchronous: true });
    coordinator.exit({ synchronous: true });

    expect(log).toEqual(['dispose:last', 'detach:borrowed', 'dispose:first']);
  });
});

describe('SceneObjectProjector 一次偏移', () => {
  let projector;

  beforeEach(() => {
    projector = new SceneObjectProjector();
  });

  function makeSceneData() {
    return {
      layers: [
        {
          objects: [
            { id: 'wall', type: 'shape', collide: true, points: [[10, 10], [20, 20]] },
            { id: 'tree', type: 'sprite', x: 50, y: 60 },
            { id: 'door', type: 'shape', collide: true, interactive: true, points: [[5, 5]] }
          ]
        },
        { hidden: true, objects: [{ id: 'hiddenTree', type: 'sprite', x: 1, y: 1 }] }
      ]
    };
  }

  it('原始对象不被修改', () => {
    const data = makeSceneData();
    projector.projectScene(data, { x: 100, y: 200 });

    expect(data.layers[0].objects[1].x).toBe(50);
    expect(data.layers[0].objects[0].points[0]).toEqual([10, 10]);
  });

  it('坐标只偏移一次', () => {
    const projection = projector.projectScene(makeSceneData(), { x: 100, y: 200 });
    const tree = projection.byId.get('tree');

    expect(tree.x).toBe(150);
    expect(tree.y).toBe(260);
  });

  it('多边形顶点只偏移一次', () => {
    const projection = projector.projectScene(makeSceneData(), { x: 100, y: 200 });
    const wall = projection.collision.find(o => o.id === 'wall');

    expect(wall.points).toEqual([[110, 210], [120, 220]]);
  });

  it('同时具有碰撞与交互的对象在两个视图中坐标一致', () => {
    const projection = projector.projectScene(makeSceneData(), { x: 100, y: 200 });
    const inCollision = projection.collision.find(o => o.id === 'door');
    const inInteraction = projection.interaction.find(o => o.id === 'door');

    expect(inCollision.points).toEqual([[105, 205]]);
    expect(inInteraction.points).toEqual(inCollision.points);
  });

  it('视图之间不共享对象引用，避免重复偏移', () => {
    const projection = projector.projectScene(makeSceneData(), { x: 100, y: 200 });
    const inCollision = projection.collision.find(o => o.id === 'door');
    const inInteraction = projection.interaction.find(o => o.id === 'door');

    expect(inCollision).not.toBe(inInteraction);
    expect(inCollision.points).not.toBe(inInteraction.points);

    const check = SceneObjectProjector.verifyNoSharedReferences(projection);
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('修改一个视图不影响另一个视图', () => {
    const projection = projector.projectScene(makeSceneData(), { x: 100, y: 200 });
    const inCollision = projection.collision.find(o => o.id === 'door');
    const inInteraction = projection.interaction.find(o => o.id === 'door');

    inCollision.points[0][0] = 9999;
    expect(inInteraction.points[0][0]).toBe(105);
  });

  it('隐藏图层对象不进入渲染视图但保留在对象列表', () => {
    const projection = projector.projectScene(makeSceneData(), { x: 0, y: 0 });

    expect(projection.render.some(o => o.id === 'hiddenTree')).toBe(false);
    expect(projection.byId.has('hiddenTree')).toBe(true);
  });

  it('重复投影同一场景结果一致', () => {
    const data = makeSceneData();
    const first = projector.projectScene(data, { x: 100, y: 200 });
    const second = projector.projectScene(data, { x: 100, y: 200 });

    expect(second.byId.get('tree').x).toBe(first.byId.get('tree').x);
    expect(second.collision.find(o => o.id === 'wall').points)
      .toEqual(first.collision.find(o => o.id === 'wall').points);
  });

  it('共享引用可被检测出来', () => {
    // 模拟旧实现：同一对象被放进两个视图
    const shared = { id: 'bug', points: [[1, 1]] };
    const check = SceneObjectProjector.verifyNoSharedReferences({
      collision: [shared],
      render: [shared],
      interaction: []
    });

    expect(check.ok).toBe(false);
    expect(check.errors[0].code).toBe('sharedReference');
  });
});

describe('GameSceneRuntime 帧顺序与清理', () => {
  let runtime;
  let inputManager;
  let log;

  beforeEach(() => {
    log = [];
    inputManager = makeInputManager();
    runtime = new GameSceneRuntime({ inputManager });
    runtime.enter();
  });

  it('未进入场景时不更新', () => {
    const idle = new GameSceneRuntime({ inputManager });
    const system = makeSystem(log, 'sys');
    idle.registerSystem('sys', system);

    idle.update(0.016);
    expect(system.updated).toBe(0);
  });

  it('输入分发早于系统更新，清帧最后执行', () => {
    runtime.registerInputHandler(InputHandler.PICKUP, {
      handle: () => { log.push('input:pickup'); return true; }
    });
    runtime.registerSystem('combat', makeSystem(log, 'combat'), { order: UpdateOrder.COMBAT });
    runtime.onUpdate(() => log.push('hook'));

    runtime.inputRouter.enqueue(new InputEvent({
      type: InputEventType.POINTER_DOWN,
      button: PointerButton.LEFT
    }));

    runtime.update(0.016);

    expect(log).toEqual(['input:pickup', 'update:combat', 'hook']);
    // 清帧必须在最后，否则本帧按键状态会被提前清空
    expect(inputManager.getFlushCount()).toBe(1);
  });

  it('拾取优先于攻击，攻击不再收到该事件', () => {
    const consumed = [];
    runtime.registerInputHandler(InputHandler.ATTACK, {
      handle: () => { consumed.push('attack'); return true; }
    });
    runtime.registerInputHandler(InputHandler.PICKUP, {
      handle: () => { consumed.push('pickup'); return true; }
    });

    runtime.inputRouter.enqueue(new InputEvent({
      type: InputEventType.POINTER_DOWN,
      button: PointerButton.LEFT
    }));
    runtime.update(0.016);

    expect(consumed).toEqual(['pickup']);
  });

  it('skipInputFlush 时不清帧，交由调用方处理', () => {
    runtime.update(0.016, { skipInputFlush: true });
    expect(inputManager.getFlushCount()).toBe(0);
  });

  it('dispose 清理系统、输入处理者与自定义清理', () => {
    const system = makeSystem(log, 'sys');
    runtime.registerSystem('sys', system);
    runtime.registerInputHandler(InputHandler.PICKUP, { handle: () => true });

    let disposed = false;
    runtime.addDisposer(() => { disposed = true; });

    const result = runtime.dispose();

    expect(system.destroyed).toBe(true);
    expect(disposed).toBe(true);
    expect(result.systems).toContain('sys');
    expect(runtime.isActive).toBe(false);
  });

  it('dispose 后输入处理者不再响应', () => {
    const consumed = [];
    runtime.registerInputHandler(InputHandler.PICKUP, {
      handle: () => { consumed.push('pickup'); return true; }
    });

    runtime.dispose();
    runtime.enter();

    runtime.inputRouter.enqueue(new InputEvent({
      type: InputEventType.POINTER_DOWN,
      button: PointerButton.LEFT
    }));
    runtime.update(0.016);

    expect(consumed).toEqual([]);
  });

  it('dispose 后 update 钩子不再执行', () => {
    let count = 0;
    runtime.onUpdate(() => { count++; });

    runtime.update(0.016);
    expect(count).toBe(1);

    runtime.dispose();
    runtime.enter();
    runtime.update(0.016);
    expect(count).toBe(1);
  });

  it('registration plan 由 Runtime 拥有并只解除 borrowed projection', () => {
    const projection = {};
    const owned = makeSystem(log, 'planned');
    runtime.applyRegistrationPlan({
      id: 'test-plan',
      registrations: [{ name: 'planned', instance: owned, options: { order: 1 } }],
      projections: [{ target: projection, key: 'system', instance: owned }]
    });

    expect(projection.system).toBe(owned);
    runtime.dispose();
    expect(projection.system).toBeNull();
    expect(log).toEqual(['destroy:planned']);
  });

  it('相同 frame token 的阶段和系统不会重复执行', () => {
    const token = runtime.beginFrame();
    const system = makeSystem(log, 'once');
    let hooks = 0;
    runtime.registerSystem('once', system, { phase: FramePhase.SYSTEMS });
    runtime.onFramePhase(FramePhase.SYSTEMS, () => { hooks++; });

    runtime.runFramePhase(FramePhase.SYSTEMS, 0.016, { frameToken: token, updateSystems: true });
    runtime.runFramePhase(FramePhase.SYSTEMS, 0.016, { frameToken: token, updateSystems: true });

    expect(system.updated).toBe(1);
    expect(hooks).toBe(1);
  });

  it('ResourceScope 在 Runtime 失效后拒绝迟到异步写回', () => {
    const ownedRuntime = new GameSceneRuntime();
    const guarded = ownedRuntime.resourceScope.guard(() => log.push('late-write'));
    ownedRuntime.enter();

    ownedRuntime.invalidate();
    guarded();

    expect(log).toEqual([]);
  });

  it('检查点参与者可注册并原子恢复', () => {
    const state = { value: 1 };
    runtime.registerSnapshotProvider('demo', {
      snapshot: () => ({ value: state.value }),
      validate: (d) => ({ ok: typeof d.value === 'number', errors: [] }),
      restore: (d) => { state.value = d.value; }
    });

    const captured = runtime.captureCheckpoint({ sceneId: 'S01' });
    expect(captured.ok).toBe(true);

    state.value = 99;
    expect(runtime.restoreCheckpoint(captured.snapshot).ok).toBe(true);
    expect(state.value).toBe(1);
  });

  it('检查点校验失败时不改运行状态', () => {
    const state = { value: 5 };
    runtime.registerSnapshotProvider('demo', {
      snapshot: () => ({ value: state.value }),
      validate: () => ({ ok: false, errors: [{ code: 'bad', path: 'value', message: '非法' }] }),
      restore: (d) => { state.value = d.value; }
    });

    const result = runtime.restoreCheckpoint({ version: 1, data: { demo: { value: 1 } } });
    expect(result.ok).toBe(false);
    expect(state.value).toBe(5);
  });

  it('setInput 后路由使用新的相机换算世界坐标', () => {
    runtime.setInput({ camera: { screenToWorld: (x, y) => ({ x: x + 7, y: y + 8 }) } });
    const [event] = runtime.inputRouter.collect([]);
    expect(event).toBeUndefined();

    runtime.inputRouter.inputManager = makeInputManager({ clicked: true });
    const [pointer] = runtime.inputRouter.collect([]);
    expect(pointer.world).toEqual({ x: 7, y: 8 });
  });
});


describe('P6.2 生命周期测量快照', () => {
  it('ResourceScope 与容器公开只读残留计数', () => {
    const container = new SceneSystemContainer();
    container.register('owned', makeSystem([], 'owned'));
    const scope = new GameSceneRuntime().resourceScope;
    scope.setTimeout(() => {}, 60_000);

    expect(container.getLifecycleSnapshot()).toMatchObject({ registeredCount: 1, ownedCount: 1 });
    expect(scope.getLifecycleSnapshot()).toMatchObject({ disposed: false, pendingTimerCount: 1 });

    container.destroy();
    scope.dispose();
    expect(container.getLifecycleSnapshot()).toMatchObject({ registeredCount: 0, ownedCount: 0 });
    expect(scope.getLifecycleSnapshot()).toMatchObject({ disposed: true, pendingTimerCount: 0, disposerCount: 0 });
  });
});
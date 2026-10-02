import { describe, it, expect, vi } from 'vitest';
import { SddStore } from './SddStore.js';

/**
 * SddStore 骨架契约（SDD 迁移阶段 1a）：
 * 不可变文档、点路径读写、写时复制、订阅广播、schema 校验、序列化往返。
 */

describe('SddStore：节点读取', () => {
  it('getNode 支持顶层、嵌套与缺失路径', () => {
    const store = new SddStore({ document: { player: { stats: { hp: 5 } }, quests: { tasks: {} } } });
    expect(store.getNode()).toEqual({ player: { stats: { hp: 5 } }, quests: { tasks: {} } });
    expect(store.getNode('player.stats.hp')).toBe(5);
    expect(store.getNode('quests.tasks')).toEqual({});
    expect(store.getNode('quests.missing.deep')).toBeUndefined();
  });
});

describe('SddStore：patch 写时复制', () => {
  it('patch 叶子节点生成新文档，旧文档引用不受影响', () => {
    const store = new SddStore({ document: { player: { stats: { hp: 5, mp: 9 } } } });
    const before = store.document;
    store.patchNode('player.stats.hp', 7);
    expect(before.player.stats.hp).toBe(5);       // 旧版本不变
    expect(store.getNode('player.stats.hp')).toBe(7);
    expect(before).not.toBe(store.document);       // 根引用更换
    expect(before.player.stats).not.toBe(store.document.player.stats); // 路径浅拷贝
    expect(before.player).not.toBe(store.document.player);
  });

  it('updater 函数式写入：基于当前节点计算下一状态', () => {
    const store = new SddStore({ document: { quests: { tasks: { t1: { done: 2 } } } } });
    store.patchNode('quests.tasks.t1', node => ({ ...node, done: node.done + 1 }));
    expect(store.getNode('quests.tasks.t1')).toEqual({ done: 3 });
  });

  it('中间节点不存在时自动创建', () => {
    const store = new SddStore({ document: {} });
    store.patchNode('world.chunks.S01.placements', [{ id: 'p1' }]);
    expect(store.getNode('world.chunks.S01.placements')).toEqual([{ id: 'p1' }]);
  });

  it('patch undefined 删除节点；目标不存在时幂等', () => {
    const store = new SddStore({ document: { quests: { a: 1, b: 2 } } });
    store.patchNode('quests.a', undefined);
    expect(store.getNode('quests')).toEqual({ b: 2 });
    const result = store.patchNode('quests.missing', undefined);
    expect(result.ok).toBe(true);
    expect(store.getNode('quests')).toEqual({ b: 2 });
  });

  it('revision 每次 patch 递增', () => {
    const store = new SddStore({ document: {} });
    expect(store.revision).toBe(0);
    store.patchNode('a', 1);
    store.patchNode('b', 2);
    expect(store.revision).toBe(2);
  });
});

describe('SddStore：订阅广播', () => {
  it('祖先 patch 通知子路径订阅者，子 patch 通知根订阅者', () => {
    const store = new SddStore({ document: { quests: { tasks: {} } } });
    const rootListener = vi.fn();
    const taskListener = vi.fn();
    store.subscribe('', rootListener);
    store.subscribe('quests.tasks', taskListener);
    store.patchNode('quests.tasks.t1', { done: 1 });
    expect(taskListener).toHaveBeenCalledTimes(1);
    expect(taskListener).toHaveBeenCalledWith({ t1: { done: 1 } }, 'quests.tasks.t1');
    expect(rootListener).toHaveBeenCalledTimes(1);
  });

  it('无关路径的 patch 不通知', () => {
    const store = new SddStore({ document: { a: {}, b: {} } });
    const listener = vi.fn();
    store.subscribe('a', listener);
    store.patchNode('b.x', 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('取消订阅后不再通知；订阅者抛错不影响提交与其它订阅者', () => {
    const store = new SddStore({ document: {} });
    const unsubscribe = store.subscribe('x', () => { throw new Error('boom'); });
    const after = vi.fn();
    store.subscribe('x', after);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.patchNode('x', 1);
    expect(store.getNode('x')).toBe(1); // 提交成功
    expect(after).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.patchNode('x', 2);
    // 已取消的订阅者不再被通知；其余订阅者第二次 patch 照常收到
    expect(after).toHaveBeenCalledTimes(2);
    expect(after).toHaveBeenLastCalledWith(2, 'x');
    warnSpy.mockRestore();
  });
});

describe('SddStore：校验与序列化', () => {
  it('validate 调用注入的 validator；未注入视为通过', () => {
    const okStore = new SddStore({ document: {} });
    expect(okStore.validate()).toEqual({ ok: true, errors: [] });
    const badStore = new SddStore({
      document: { player: {} },
      validator: doc => (doc.player?.hp ? { ok: true } : { ok: false, errors: [{ code: 'missingHp' }] })
    });
    expect(badStore.validate()).toEqual({ ok: false, errors: [{ code: 'missingHp' }] });
  });

  it('validator 抛错转为结构化错误，不向外抛异常', () => {
    const store = new SddStore({ validator: () => { throw new Error('schema boom'); } });
    const result = store.validate();
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('sddValidatorThrew');
  });

  it('toJSON/fromJSON 往返保持数据与 revision', () => {
    const store = new SddStore({ document: { player: { hp: 5 } } });
    store.patchNode('player.hp', 9);
    const json = store.toJSON();
    expect(json.schemaVersion).toBe(3);
    expect(json.revision).toBe(1);
    const restored = SddStore.fromJSON(json);
    expect(restored.getNode('player.hp')).toBe(9);
    expect(restored.revision).toBe(1);
  });

  it('fromJSON 缺 schemaVersion 时抛错', () => {
    expect(() => SddStore.fromJSON({ document: {} })).toThrow(/schemaVersion/);
  });
});

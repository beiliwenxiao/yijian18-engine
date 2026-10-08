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
import { SnapshotManager, SNAPSHOT_VERSION } from './SnapshotManager.js';
import { LocalStorageAdapter } from './LocalStorageAdapter.js';

/** 可控的参与者替身 */
function makeProvider(initial, options = {}) {
  return {
    state: { ...initial },
    required: options.required,
    snapshot() { return { ...this.state }; },
    validate(data) {
      if (options.validate) return options.validate(data);
      if (!data || typeof data.value !== 'number') {
        return { ok: false, errors: [{ code: 'missingField', path: 'value', message: '缺少 value' }] };
      }
      return { ok: true, errors: [] };
    },
    restore(data) {
      if (options.restoreFails) throw new Error('restore boom');
      if (options.restoreRejects) return { ok: false, errors: [{ code: 'rejected', path: '', message: '拒绝' }] };
      this.state = { ...data };
      return undefined;
    }
  };
}

/** 内存版 storage，避免依赖真实 localStorage */
function makeMemoryStorage() {
  const map = new Map();
  return {
    setItem: (k, v) => map.set(k, v),
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

function register(manager, key, provider) {
  manager.register(key, {
    required: provider.required,
    snapshot: () => provider.snapshot(),
    validate: (d) => provider.validate(d),
    restore: (d) => provider.restore(d)
  });
}

describe('SnapshotManager 采集与校验', () => {
  let manager;
  let progression;
  let story;

  beforeEach(() => {
    manager = new SnapshotManager({ now: () => 1000 });
    progression = makeProvider({ value: 1 });
    story = makeProvider({ value: 2 });
    register(manager, 'progression', progression);
    register(manager, 'story', story);
  });

  it('采集包含版本、时间与全部参与者', () => {
    const result = manager.capture({ sceneId: 'S01' });

    expect(result.ok).toBe(true);
    expect(result.snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(result.snapshot.createdAt).toBe(1000);
    expect(result.snapshot.meta.sceneId).toBe('S01');
    expect(Object.keys(result.snapshot.data)).toEqual(['progression', 'story']);
  });

  it('参与者采集抛错时整体失败', () => {
    manager.register('broken', {
      snapshot: () => { throw new Error('bad'); },
      restore: () => {}
    });

    const result = manager.capture();
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('broken');
  });

  it('缺少必填段时校验失败并报告路径', () => {
    const snapshot = manager.capture().snapshot;
    delete snapshot.data.story;

    const result = manager.validate(snapshot);
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('data.story');
  });

  it('可选段缺失不影响校验', () => {
    const optional = makeProvider({ value: 3 }, { required: false });
    manager.register('optional', {
      required: false,
      snapshot: () => optional.snapshot(),
      validate: (d) => optional.validate(d),
      restore: (d) => optional.restore(d)
    });

    const snapshot = manager.capture().snapshot;
    delete snapshot.data.optional;
    expect(manager.validate(snapshot).ok).toBe(true);
  });

  it('参与者校验错误带上段落前缀', () => {
    const snapshot = manager.capture().snapshot;
    snapshot.data.progression = { value: 'not a number' };

    const result = manager.validate(snapshot);
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('data.progression.value');
  });

  it('版本高于当前支持时拒绝', () => {
    const snapshot = manager.capture().snapshot;
    snapshot.version = SNAPSHOT_VERSION + 5;

    const result = manager.validate(snapshot);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('versionMismatch');
  });

  it('空快照直接失败', () => {
    expect(manager.validate(null).ok).toBe(false);
  });
});

describe('SnapshotManager 原子恢复', () => {
  let manager;
  let a;
  let b;

  beforeEach(() => {
    manager = new SnapshotManager();
    a = makeProvider({ value: 1 });
    b = makeProvider({ value: 2 });
    register(manager, 'a', a);
    register(manager, 'b', b);
  });

  it('校验通过后全部恢复', () => {
    const saved = manager.capture().snapshot;
    a.state.value = 99;
    b.state.value = 98;

    const result = manager.restore(saved);
    expect(result.ok).toBe(true);
    expect(result.restored).toEqual(['a', 'b']);
    expect(a.state.value).toBe(1);
    expect(b.state.value).toBe(2);
  });

  it('校验失败时不修改任何运行状态', () => {
    const saved = manager.capture().snapshot;
    saved.data.b = { value: 'invalid' };
    a.state.value = 99;

    const result = manager.restore(saved);
    expect(result.ok).toBe(false);
    // 第一段只校验，因此 a 未被写入
    expect(a.state.value).toBe(99);
  });

  it('某个 restore 抛错时回滚已写入的参与者', () => {
    const failing = makeProvider({ value: 5 }, { restoreFails: true });
    register(manager, 'z', failing);

    const saved = manager.capture().snapshot;
    a.state.value = 42;
    b.state.value = 43;

    const result = manager.restore(saved);
    expect(result.ok).toBe(false);
    // a、b 已写入后被回滚到加载前的值
    expect(a.state.value).toBe(42);
    expect(b.state.value).toBe(43);
  });

  it('restore 返回失败结果时同样回滚', () => {
    const rejecting = makeProvider({ value: 5 }, { restoreRejects: true });
    register(manager, 'z', rejecting);

    const saved = manager.capture().snapshot;
    a.state.value = 7;

    const result = manager.restore(saved);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('rejected');
    expect(a.state.value).toBe(7);
  });

  it('两轮保存加载后状态等价', () => {
    a.state.value = 11;
    b.state.value = 22;

    const first = manager.capture().snapshot;
    manager.restore(first);
    const second = manager.capture().snapshot;
    manager.restore(second);

    expect(manager.capture().snapshot.data).toEqual(first.data);
  });

  it('旧版本快照通过迁移器升级', () => {
    const migrating = new SnapshotManager({
      migrations: {
        0: (snapshot) => ({
          ...snapshot,
          version: 1,
          data: { a: { value: snapshot.data.legacyValue } }
        })
      }
    });
    const provider = makeProvider({ value: 0 });
    register(migrating, 'a', provider);

    const result = migrating.restore({ version: 0, data: { legacyValue: 77 } });
    expect(result.ok).toBe(true);
    expect(provider.state.value).toBe(77);
  });

  it('缺少迁移器时拒绝恢复', () => {
    const result = manager.restore({ version: 0, data: {} });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('missingMigration');
  });
});

describe('SnapshotManager 与存储适配器', () => {
  let manager;
  let storage;
  let provider;

  beforeEach(() => {
    storage = makeMemoryStorage();
    manager = new SnapshotManager({
      storage: new LocalStorageAdapter({ storage, prefix: 'test' })
    });
    provider = makeProvider({ value: 1 });
    register(manager, 'a', provider);
  });

  it('保存后可读取并恢复', () => {
    provider.state.value = 33;
    expect(manager.save('slot1').ok).toBe(true);

    provider.state.value = 0;
    expect(manager.load('slot1').ok).toBe(true);
    expect(provider.state.value).toBe(33);
  });

  it('读取不存在的槽位返回 notFound', () => {
    const result = manager.load('missing');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('notFound');
  });

  it('存档 JSON 损坏时保留原存档且不改运行状态', () => {
    manager.save('slot1');
    storage.setItem('test:slot1', '{ not json');
    provider.state.value = 55;

    const result = manager.load('slot1');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('invalidJson');
    expect(provider.state.value).toBe(55);
    // 损坏存档原样保留，便于人工排查
    expect(storage.getItem('test:slot1')).toBe('{ not json');
  });

  it('未配置存储时保存与读取都失败', () => {
    const bare = new SnapshotManager();
    expect(bare.save('s').ok).toBe(false);
    expect(bare.load('s').errors[0].code).toBe('noStorage');
  });

  it('适配器提供摘要而不做完整恢复', () => {
    manager.save('slot1', { label: '第一幕' });

    const adapter = new LocalStorageAdapter({ storage, prefix: 'test' });
    const info = adapter.getInfo('slot1');

    expect(info.meta.label).toBe('第一幕');
    expect(info.sections).toEqual(['a']);
    expect(adapter.has('slot1')).toBe(true);
  });

  it('删除存档后不存在', () => {
    manager.save('slot1');
    const adapter = new LocalStorageAdapter({ storage, prefix: 'test' });
    expect(adapter.remove('slot1')).toBe(true);
    expect(adapter.has('slot1')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { SceneContainerInventoryRegistry } from './SceneContainerInventoryRegistry.js';

const makeInventory = items => ({
  items: [...items],
  exportItems() { return this.items.map(entry => ({ ...entry })); },
  loadItems(next) { this.items = next.map(entry => ({ ...entry })); }
});

describe('SceneContainerInventoryRegistry 易失容器', () => {
  it('易失容器可 resolve 并参与 nextOperationId', () => {
    const registry = new SceneContainerInventoryRegistry();
    const camp = makeInventory([{ itemId: 'resource.food', quantity: 40 }]);
    registry.registerVolatile('camp:camp.s02.field', camp);
    expect(registry.resolve('camp:camp.s02.field')).toBe(camp);
    expect(registry.nextOperationId('camp:camp.s02.field', 'camp-supply'))
      .toBe('camp-supply:camp:camp.s02.field:1');
    expect(registry.nextOperationId('camp:camp.s02.field', 'camp-supply'))
      .toBe('camp-supply:camp:camp.s02.field:2');
  });

  it('易失容器不进入序列化，也不影响持久容器的旧档校验', () => {
    const registry = new SceneContainerInventoryRegistry();
    const chest = makeInventory([{ itemId: 'item.herb', quantity: 2 }]);
    registry.register('s01-shelter-chest:inventory', chest);
    registry.registerVolatile('camp:camp.s02.field', makeInventory([{ itemId: 'resource.food', quantity: 40 }]));

    const snapshot = registry.serialize();
    expect(snapshot.entries.map(entry => entry.id)).toEqual(['s01-shelter-chest:inventory']);

    // 旧档（只有持久容器）仍通过校验与恢复
    const legacy = {
      schemaVersion: 1,
      entries: [{ id: 's01-shelter-chest:inventory', items: [{ itemId: 'item.herb', quantity: 1 }], operationSequence: 3 }]
    };
    expect(registry.validateSerialized(legacy)).toEqual({ ok: true, errors: [] });
    expect(registry.restore(legacy)).toEqual({ ok: true });
    expect(chest.items).toEqual([{ itemId: 'item.herb', quantity: 1 }]);
  });

  it('同一实例重复注册幂等；不同实例或与持久 id 冲突时报错', () => {
    const registry = new SceneContainerInventoryRegistry();
    const camp = makeInventory([]);
    registry.registerVolatile('camp:a', camp);
    expect(registry.registerVolatile('camp:a', camp)).toBe(camp);
    expect(() => registry.registerVolatile('camp:a', makeInventory([]))).toThrow();
    registry.register('chest:a', makeInventory([]));
    expect(() => registry.registerVolatile('chest:a', camp)).toThrow();
  });

  it('缺少容器 API 的易失注册被拒绝', () => {
    const registry = new SceneContainerInventoryRegistry();
    expect(() => registry.registerVolatile('camp:bad', {})).toThrow(TypeError);
  });
});

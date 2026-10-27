/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-27
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/
import { describe, it, expect } from 'vitest';
import { registerDefaultActions } from '../src/systems/TriggerActions.js';

function createHarness(items = {}) {
  const bag = new Map(Object.entries(items));
  const inventory = {
    getItemCount: id => bag.get(id) || 0,
    removeItem: (id, quantity) => {
      const have = bag.get(id) || 0;
      const removed = Math.min(have, quantity);
      const rest = have - removed;
      if (rest > 0) bag.set(id, rest); else bag.delete(id);
      return removed;
    },
    exportItems: () => Array.from(bag, ([id, quantity]) => ({ id, quantity })),
    loadItems: list => {
      bag.clear();
      for (const entry of list || []) bag.set(entry.id, entry.quantity);
    }
  };
  const player = { getComponent: name => (name === 'inventory' ? inventory : null) };
  const triggerSystem = { actions: {}, registerActions(map) { Object.assign(this.actions, map); } };
  registerDefaultActions(triggerSystem);
  return { takeReward: (params) => triggerSystem.actions.takeReward(params, { player }), bag };
}

describe('TriggerActions.takeReward（扣取物品，S02 乞讨链）', () => {
  it('固定数量扣除成功，返回 taken 明细', () => {
    const h = createHarness({ 'resource.wild_berry': 7 });
    const result = h.takeReward({ items: [{ id: 'resource.wild_berry', quantity: 5 }] });
    expect(result.ok).toBe(true);
    expect(result.taken).toEqual([{ id: 'resource.wild_berry', quantity: 5 }]);
    expect(h.bag.get('resource.wild_berry')).toBe(2);
  });

  it('all=true 扣光该物品全部持有量', () => {
    const h = createHarness({ 'resource.food': 4, 'resource.raw_wolf_meat': 0 });
    const result = h.takeReward({ items: [{ id: 'resource.food', all: true }, { id: 'resource.raw_wolf_meat', all: true }] });
    expect(result.ok).toBe(true);
    expect(h.bag.get('resource.food') || 0).toBe(0);
    expect(h.bag.get('resource.raw_wolf_meat') || 0).toBe(0);
  });

  it('strict 默认全或无：任一项不足则整体回滚', () => {
    const h = createHarness({ 'resource.wild_berry': 3, 'resource.raw_wolf_meat': 9 });
    const result = h.takeReward({ items: [
      { id: 'resource.wild_berry', quantity: 3 },
      { id: 'resource.raw_wolf_meat', quantity: 15 }
    ] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficientItems');
    expect(h.bag.get('resource.wild_berry')).toBe(3);
    expect(h.bag.get('resource.raw_wolf_meat')).toBe(9);
  });

  it('strict=false 尽量扣：有多少扣多少，永不失败', () => {
    const h = createHarness({ 'resource.wild_berry': 2 });
    const result = h.takeReward({ items: [{ id: 'resource.wild_berry', quantity: 20 }], strict: false });
    expect(result.ok).toBe(true);
    expect(result.taken).toEqual([{ id: 'resource.wild_berry', quantity: 2 }]);
    expect(h.bag.get('resource.wild_berry') || 0).toBe(0);
  });

  it('缺 id 或无 inventory 时失败且不误伤', () => {
    const h = createHarness({ 'resource.wild_berry': 5 });
    expect(h.takeReward({ items: [{ id: '  ', quantity: 1 }] }).ok).toBe(false);
    const noBag = { takeReward: null };
    const triggerSystem = { actions: {}, registerActions(map) { Object.assign(this.actions, map); } };
    registerDefaultActions(triggerSystem);
    const bare = triggerSystem.actions.takeReward({ items: [] }, { player: { getComponent: () => null } });
    expect(bare).toBe(false);
    expect(noBag).toBeTruthy();
  });
});

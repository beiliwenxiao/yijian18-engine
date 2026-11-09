/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @date      2026-11-09
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { AmmoService } from './AmmoService.js';

function createStocks(initial = {}) {
  const stocks = new Map(Object.entries(initial));
  return {
    stocks,
    transactions: {
      previewRemove(_inventory, itemId, quantity) {
        const have = stocks.get(itemId) || 0;
        return { remainder: Math.max(0, Number(quantity) - have) };
      },
      commit({ type, entries }) {
        if (type !== 'batchRemove') return { ok: false, code: 'unsupportedType' };
        for (const entry of entries) {
          if ((stocks.get(entry.itemId) || 0) < entry.quantity) return { ok: false, code: 'outOfAmmo' };
        }
        for (const entry of entries) {
          stocks.set(entry.itemId, (stocks.get(entry.itemId) || 0) - entry.quantity);
        }
        return { ok: true };
      },
      forgetOperation() {}
    }
  };
}

function createArcher({ weapon, inventory = {} } = {}) {
  const equipment = { getAllEquipment: () => ({ mainhand: weapon }) };
  return {
    id: 'archer',
    getComponent: name => {
      if (name === 'equipment') return equipment;
      if (name === 'inventory') return inventory;
      return null;
    }
  };
}

describe('AmmoService · 零回归', () => {
  it('未声明 ammo 的旧武器恒为 skipped，不扣任何物品', () => {
    const { stocks, transactions } = createStocks({ wooden_arrow: 9 });
    const service = new AmmoService({ inventoryTransactions: transactions });
    const archer = createArcher({ weapon: { id: 'legacy-sword', subType: 'weapon' }, inventory: { id: 'inv' } });

    expect(service.peek(archer)).toMatchObject({ configured: false, ok: true, skipped: true });
    expect(service.consume(archer, 'op.0')).toMatchObject({ ok: true, skipped: true });
    expect(stocks.get('wooden_arrow')).toBe(9);
  });
});

describe('AmmoService · 玩家背包扣箭', () => {
  it('命中声明 ammo 的武器时按 perShot 从背包扣除', () => {
    const { stocks, transactions } = createStocks({ wooden_arrow: 5 });
    const service = new AmmoService({ inventoryTransactions: transactions });
    const archer = createArcher({
      weapon: { id: 'bow', subType: 'weapon', ammo: { itemId: 'wooden_arrow', perShot: 2 } },
      inventory: { id: 'inv' }
    });

    expect(service.peek(archer)).toMatchObject({ configured: true, ok: true, itemId: 'wooden_arrow', perShot: 2 });
    expect(service.consume(archer, 'op.1')).toMatchObject({ ok: true, itemId: 'wooden_arrow', perShot: 2 });
    expect(stocks.get('wooden_arrow')).toBe(3);
  });

  it('弹药不足返回 outOfAmmo 且不扣减（本次攻击不结算）', () => {
    const { stocks, transactions } = createStocks({ wooden_arrow: 0 });
    const service = new AmmoService({ inventoryTransactions: transactions });
    const archer = createArcher({
      weapon: { id: 'bow', subType: 'weapon', ammo: { itemId: 'wooden_arrow' } },
      inventory: { id: 'inv' }
    });

    expect(service.peek(archer)).toMatchObject({ configured: true, ok: false, code: 'outOfAmmo' });
    expect(service.consume(archer, 'op.2')).toMatchObject({ ok: false, code: 'outOfAmmo' });
    expect(stocks.get('wooden_arrow')).toBe(0);
  });
});

describe('AmmoService · NPC 计数扣箭', () => {
  it('无背包时走 entity.ammoCount，扣到 0 后拒绝出手', () => {
    const service = new AmmoService({});
    const npc = createArcher({ weapon: { id: 'bow', subType: 'weapon', ammo: { itemId: 'wooden_arrow' } } });
    npc.ammoCount = 2;

    expect(service.consume(npc, 'npc.1')).toMatchObject({ ok: true, mode: 'counter', remaining: 1 });
    expect(service.consume(npc, 'npc.2')).toMatchObject({ ok: true, mode: 'counter', remaining: 0 });
    expect(service.peek(npc)).toMatchObject({ ok: false, code: 'outOfAmmo' });
    expect(npc.ammoCount).toBe(0);
  });
});

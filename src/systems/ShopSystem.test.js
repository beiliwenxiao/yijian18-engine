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

/**
 * ShopSystem.test.js
 * 商店系统单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ShopType,
  CurrencyType,
  ShopItem,
  Shop,
  ShopSystem
} from './ShopSystem.js';

describe('ShopType', () => {
  it('should have all shop types defined', () => {
    expect(ShopType.GENERAL).toBe('general');
    expect(ShopType.WEAPON).toBe('weapon');
    expect(ShopType.ARMOR).toBe('armor');
    expect(ShopType.SPECIAL).toBe('special');
  });
});

describe('CurrencyType', () => {
  it('should have all currency types defined', () => {
    expect(CurrencyType.GOLD).toBe('gold');
    expect(CurrencyType.DIAMOND).toBe('diamond');
    expect(CurrencyType.HONOR).toBe('honor');
  });
});

describe('ShopItem', () => {
  let item;

  beforeEach(() => {
    item = new ShopItem({
      id: 'test_item',
      name: 'Test Item',
      price: 100,
      currency: CurrencyType.GOLD
    });
  });

  it('should create item with correct properties', () => {
    expect(item.id).toBe('test_item');
    expect(item.name).toBe('Test Item');
    expect(item.price).toBe(100);
  });

  it('should calculate actual price with discount', () => {
    item.discount = 0.2;
    expect(item.getActualPrice()).toBe(80);
  });

  it('should check purchase availability', () => {
    const context = { level: 5, currencies: { gold: 200 } };
    const result = item.canPurchase(context);
    expect(result.canBuy).toBe(true);
  });

  it('should reject purchase with insufficient currency', () => {
    const context = { level: 5, currencies: { gold: 50 } };
    const result = item.canPurchase(context);
    expect(result.canBuy).toBe(false);
    expect(result.reason).toBe('货币不足');
  });

  it('should reject purchase with insufficient level', () => {
    item.requiredLevel = 10;
    const context = { level: 5, currencies: { gold: 200 } };
    const result = item.canPurchase(context);
    expect(result.canBuy).toBe(false);
  });

  it('should track stock', () => {
    item.stock = 3;
    item.purchase();
    expect(item.stock).toBe(2);
  });

  it('should reject purchase when out of stock', () => {
    item.stock = 0;
    const context = { level: 5, currencies: { gold: 200 } };
    const result = item.canPurchase(context);
    expect(result.canBuy).toBe(false);
    expect(result.reason).toBe('库存不足');
  });

  it('should restock items', () => {
    item.stock = 0;
    item.maxStock = 5;
    item.restock();
    expect(item.stock).toBe(5);
  });
});

describe('Shop', () => {
  let shop;

  beforeEach(() => {
    shop = new Shop({
      id: 'test_shop',
      name: 'Test Shop',
      type: ShopType.GENERAL,
      items: [
        { id: 'item1', name: 'Item 1', price: 50 },
        { id: 'item2', name: 'Item 2', price: 100 }
      ]
    });
  });

  it('should create shop with correct properties', () => {
    expect(shop.id).toBe('test_shop');
    expect(shop.name).toBe('Test Shop');
    expect(shop.items.size).toBe(2);
  });

  it('should add and remove items', () => {
    shop.addItem(new ShopItem({ id: 'item3', name: 'Item 3' }));
    expect(shop.items.size).toBe(3);
    
    shop.removeItem('item3');
    expect(shop.items.size).toBe(2);
  });

  it('should get item by id', () => {
    const item = shop.getItem('item1');
    expect(item.name).toBe('Item 1');
  });

  it('should get all items', () => {
    const items = shop.getAllItems();
    expect(items.length).toBe(2);
  });

  it('should calculate sell price', () => {
    shop.sellRate = 0.5;
    const sellPrice = shop.calculateSellPrice({ price: 100 });
    expect(sellPrice).toBe(50);
  });

  it('should check if open', () => {
    expect(shop.checkOpen()).toBe(true);
    
    shop.isOpen = false;
    expect(shop.checkOpen()).toBe(false);
  });

  it('should refresh shop', () => {
    const item = shop.getItem('item1');
    item.stock = 0;
    item.maxStock = 5;
    item.purchaseCount = 3;
    
    shop.refresh();
    
    expect(item.stock).toBe(5);
    expect(item.purchaseCount).toBe(0);
  });
});

describe('ShopSystem', () => {
  let system;

  beforeEach(() => {
    system = new ShopSystem();
  });

  it('should initialize with default shops', () => {
    expect(system.shops.size).toBeGreaterThan(0);
    expect(system.getShop('general_store')).not.toBeNull();
  });

  it('should register custom shop', () => {
    const shop = new Shop({ id: 'custom_shop', name: 'Custom' });
    system.registerShop(shop);
    expect(system.getShop('custom_shop')).toBe(shop);
  });

  it('should get shop by NPC', () => {
    const shop = system.getShopByNPC('merchant_chen');
    expect(shop).not.toBeNull();
    expect(shop.id).toBe('general_store');
  });

  it('should buy item successfully', () => {
    const onPurchased = vi.fn();
    system.on('itemPurchased', onPurchased);
    
    system.playerCurrencies[CurrencyType.GOLD] = 1000;
    const result = system.buyItem('general_store', 'health_potion_small', 1, { level: 5, currencies: system.playerCurrencies });
    
    expect(result.success).toBe(true);
    expect(system.playerCurrencies[CurrencyType.GOLD]).toBe(950);
    expect(onPurchased).toHaveBeenCalled();
  });

  it('should fail to buy with insufficient gold', () => {
    system.playerCurrencies[CurrencyType.GOLD] = 10;
    const result = system.buyItem('general_store', 'health_potion_small', 1, { level: 5, currencies: system.playerCurrencies });
    
    expect(result.success).toBe(false);
    expect(result.message).toBe('货币不足');
  });

  it('should sell item', () => {
    const onSold = vi.fn();
    system.on('itemSold', onSold);
    
    const initialGold = system.playerCurrencies[CurrencyType.GOLD];
    const result = system.sellItem('general_store', { id: 'test', name: 'Test', price: 100 }, 1);
    
    expect(result.success).toBe(true);
    expect(system.playerCurrencies[CurrencyType.GOLD]).toBe(initialGold + 50);
    expect(onSold).toHaveBeenCalled();
  });

  it('should track transaction history', () => {
    system.buyItem('general_store', 'health_potion_small', 1, { level: 5, currencies: system.playerCurrencies });
    
    const history = system.getTransactionHistory();
    expect(history.length).toBe(1);
    expect(history[0].type).toBe('buy');
  });

  it('should manage currencies', () => {
    system.setCurrency(CurrencyType.GOLD, 500);
    expect(system.getCurrency(CurrencyType.GOLD)).toBe(500);
    
    system.addCurrency(CurrencyType.GOLD, 100);
    expect(system.getCurrency(CurrencyType.GOLD)).toBe(600);
  });

  it('should get stats', () => {
    const stats = system.getStats();
    expect(stats.totalShops).toBeGreaterThan(0);
    expect(stats.currencies).toBeDefined();
  });

  it('should reset system', () => {
    system.buyItem('general_store', 'health_potion_small', 1, { level: 5, currencies: system.playerCurrencies });
    system.reset();
    
    expect(system.transactionHistory.length).toBe(0);
    expect(system.playerCurrencies[CurrencyType.GOLD]).toBe(1000);
  });
});

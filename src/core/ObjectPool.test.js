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
import { ObjectPool } from './ObjectPool.js';

describe('ObjectPool', () => {
  let pool;
  let createCount;

  beforeEach(() => {
    createCount = 0;
    
    // 创建一个简单的对象池
    pool = new ObjectPool(
      // 工厂函数
      () => {
        createCount++;
        return { id: createCount, value: 0, active: false };
      },
      // 重置函数
      (obj) => {
        obj.value = 0;
      },
      5,  // 初始大小
      20  // 最大大小
    );
  });

  it('应该在初始化时创建指定数量的对象', () => {
    expect(pool.getPoolSize()).toBe(5);
    expect(pool.getActiveCount()).toBe(0);
    expect(createCount).toBe(5);
  });

  it('应该能够从池中获取对象', () => {
    const obj = pool.acquire();
    
    expect(obj).toBeDefined();
    expect(obj.active).toBe(true);
    expect(pool.getActiveCount()).toBe(1);
    expect(pool.getPoolSize()).toBe(4);
  });

  it('应该能够归还对象到池中', () => {
    const obj = pool.acquire();
    obj.value = 100;
    
    pool.release(obj);
    
    expect(obj.active).toBe(false);
    expect(obj.value).toBe(0); // 应该被重置
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.getPoolSize()).toBe(5);
  });

  it('当池为空时应该创建新对象', () => {
    // 获取所有初始对象
    for (let i = 0; i < 5; i++) {
      pool.acquire();
    }
    
    expect(pool.getPoolSize()).toBe(0);
    expect(createCount).toBe(5);
    
    // 再获取一个，应该创建新对象
    const obj = pool.acquire();
    
    expect(obj).toBeDefined();
    expect(createCount).toBe(6);
  });

  it('应该能够释放所有活跃对象', () => {
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    const obj3 = pool.acquire();
    
    obj1.value = 10;
    obj2.value = 20;
    obj3.value = 30;
    
    expect(pool.getActiveCount()).toBe(3);
    
    pool.releaseAll();
    
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.getPoolSize()).toBe(5);
    expect(obj1.value).toBe(0);
    expect(obj2.value).toBe(0);
    expect(obj3.value).toBe(0);
  });

  it('不应该超过最大池大小', () => {
    // 创建超过最大大小的对象
    const objects = [];
    for (let i = 0; i < 25; i++) {
      objects.push(pool.acquire());
    }
    
    expect(pool.getActiveCount()).toBe(25);
    
    // 归还所有对象
    for (const obj of objects) {
      pool.release(obj);
    }
    
    // 池大小不应该超过最大值
    expect(pool.getPoolSize()).toBe(20);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('应该正确计算总对象数量', () => {
    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    
    expect(pool.getTotalCount()).toBe(5); // 3 in pool + 2 active
    
    pool.release(obj1);
    
    expect(pool.getTotalCount()).toBe(5); // 4 in pool + 1 active
  });

  it('应该能够清空对象池', () => {
    pool.acquire();
    pool.acquire();
    
    pool.clear();
    
    expect(pool.getPoolSize()).toBe(0);
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.getTotalCount()).toBe(0);
  });

  it('不应该重复释放同一个对象', () => {
    const obj = pool.acquire();
    
    pool.release(obj);
    expect(pool.getPoolSize()).toBe(5);
    
    // 再次释放同一个对象
    pool.release(obj);
    expect(pool.getPoolSize()).toBe(5); // 不应该增加
  });
});

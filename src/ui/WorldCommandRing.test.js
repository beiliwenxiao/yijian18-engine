/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { WorldCommandRing } from './WorldCommandRing.js';

const TABS = [
  {
    key: 'orders',
    label: '指令',
    items: [
      { key: 'attack', label: '进攻' },
      { key: 'defend', label: '防守' },
      { key: 'transport', label: '运输' },
      { key: 'move', label: '移动' },
      { key: 'camp', label: '扎营' }
    ]
  },
  {
    key: 'deploy',
    label: '部署',
    items: [
      { key: 'front', label: '前' },
      { key: 'mid', label: '中' },
      { key: 'rear', label: '后' }
    ]
  }
];

function fakeCtx() {
  const calls = [];
  const handler = {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 12 });
      if (prop === 'canvas') return { width: 800, height: 600 };
      return (...args) => { calls.push({ prop, args }); };
    },
    set() { return true; }
  };
  return { ctx: new Proxy({}, handler), calls };
}

describe('WorldCommandRing', () => {
  it('未打开时不渲染/不命中', () => {
    const ring = new WorldCommandRing();
    expect(ring.visible).toBe(false);
    expect(ring.layout()).toBeNull();
    expect(ring.hitTest(0, 0)).toBeNull();
  });

  it('五指令等角分布；命中项返回 key，切换页签后布局换为部署槽', () => {
    const ring = new WorldCommandRing({ radius: 60, buttonSize: 30 });
    ring.open({ x: 400, y: 300, markerId: 'army.a', tabs: TABS });
    const layout = ring.layout();
    expect(layout.items.map(item => item.key)).toEqual(['attack', 'defend', 'transport', 'move', 'camp']);

    const attack = layout.items[0];
    expect(ring.hitTest(attack.cx, attack.cy)).toMatchObject({ kind: 'item', key: 'attack' });

    const deployTab = layout.tabs.find(tab => tab.key === 'deploy').rect;
    expect(ring.hitTest(deployTab.x + 2, deployTab.y + 2)).toMatchObject({ kind: 'tab', key: 'deploy' });

    ring.setActiveTab('deploy');
    expect(ring.activeTab).toBe('deploy');
    const deployLayout = ring.layout();
    expect(deployLayout.items.map(item => item.key)).toEqual(['front', 'mid', 'rear']);
  });

  it('页签/关闭命中与渲染无异常', () => {
    const ring = new WorldCommandRing();
    ring.open({ x: 200, y: 200, tabs: TABS, activeTab: 'deploy' });
    const layout = ring.layout();
    const ordersTab = layout.tabs.find(tab => tab.key === 'orders').rect;
    expect(ring.hitTest(ordersTab.x + 1, ordersTab.y + 1)).toMatchObject({ kind: 'tab', key: 'orders' });
    expect(ring.hitTest(layout.close.x + 1, layout.close.y + 1)).toMatchObject({ kind: 'close' });
    expect(ring.hitTest(5, 5)).toBeNull();

    const { ctx } = fakeCtx();
    expect(() => ring.render(ctx)).not.toThrow();
  });

  it('close 后 visible 与 markerId 复位', () => {
    const ring = new WorldCommandRing();
    ring.open({ x: 10, y: 10, markerId: 'm1', tabs: TABS });
    expect(ring.markerId).toBe('m1');
    ring.close();
    expect(ring.visible).toBe(false);
    expect(ring.markerId).toBeNull();
  });
});

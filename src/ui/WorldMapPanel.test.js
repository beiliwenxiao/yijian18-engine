/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-08
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { describe, expect, it, vi } from 'vitest';
import { WorldMapPanel } from './WorldMapPanel.js';

const S09_ANCHOR = {
  sceneId: 'S09',
  loadable: true,
  offset: { x: 12800, y: 7200 },
  worldWidth: 2560,
  worldHeight: 1440,
  footprint: { row: 10, col: 10, rows: 2, cols: 2 }
};

const makeRegion = () => ({
  id: 'mainland',
  rows: 20,
  cols: 20,
  chunkWidth: 1280,
  chunkHeight: 720,
  bounds: { left: 0, top: 0, width: 25600, height: 14400 },
  cells: [S09_ANCHOR],
  coverage: [
    { row: 0, col: 0, terrain: 'mountain', sceneId: null, loadable: false },
    { row: 0, col: 1, terrain: 'forest', sceneId: 'S02', loadable: true }
  ]
});

const makeIndex = (region = makeRegion()) => ({
  getRegion: ref => (ref === 'mainland' || ref === 0 ? region : null),
  findScene: sceneId => (sceneId === 'S09' ? S09_ANCHOR : null)
});

const makePanel = providers => {
  const panel = new WorldMapPanel({ x: 0, y: 0, width: 1000, height: 700 });
  panel.setDataProviders({
    getWorldIndex: () => makeIndex(),
    getRegionId: () => 'mainland',
    getPlayer: () => ({ x: 0, y: 0 }),
    getSceneId: () => 'S09-C01',
    getCityStates: () => ([
      { id: 'city.s09_guangzong_camp', name: '广宗', factionId: 'yellow_turban' },
      { id: 'city.unknown_city', name: '无锚点', factionId: 'han_government' }
    ]),
    ...providers
  });
  return panel;
};

describe('WorldMapPanel', () => {
  it('城池按 city.sNN_ 前缀映射到场景锚点中心，无锚点城池跳过', () => {
    const panel = makePanel();
    panel.open();
    expect(panel.visible).toBe(true);
    expect(panel._cities).toHaveLength(1);
    // 中心 = offset + worldSize/2 → 地图像素 = 世界坐标 × 0.2（与编辑器同一显示比例）
    expect(panel._cities[0]).toMatchObject({ sceneId: 'S09', name: '广宗', x: 14080, y: 7920 });
    const map = panel.worldToMap(panel._cities[0].x, panel._cities[0].y);
    expect(map.x).toBeCloseTo(2816);
    expect(map.y).toBeCloseTo(1584);
  });

  it('地图尺寸按 region 格数与 chunk 尺寸换算，滚动量在边界内夹紧', () => {
    const panel = makePanel();
    panel.open();
    // 20×20 格、1280×720/格、显示比例 0.2 → 256×144/格，整图 5120×2880（与编辑器一致）
    expect(panel._cellWidth).toBe(256);
    expect(panel._cellHeight).toBe(144);
    expect(panel._mapWidth).toBe(5120);
    expect(panel._mapHeight).toBe(2880);
    // 玩家在原点：向左上居中会变负 → 夹到 0
    expect(panel._scrollX).toBe(0);
    expect(panel._scrollY).toBe(0);

    panel._scrollX = 99999;
    panel._scrollY = 99999;
    panel._clampScroll();
    expect(panel._scrollX).toBe(5120 - panel._viewport.width);
    expect(panel._scrollY).toBe(2880 - panel._viewport.height);
  });

  it('拖动到四边后地图始终盖满视口，不露出地图外空白', () => {
    const panel = makePanel();
    panel.open();
    const view = panel._viewport;

    panel._scrollX = 99999;
    panel._scrollY = 99999;
    panel._clampScroll();
    const maxTopLeft = panel.mapToScreen(0, 0);
    const maxBottomRight = panel.mapToScreen(panel._mapWidth, panel._mapHeight);
    expect(maxTopLeft.x).toBeLessThanOrEqual(view.left + 0.001);
    expect(maxTopLeft.y).toBeLessThanOrEqual(view.top + 0.001);
    expect(maxBottomRight.x).toBeGreaterThanOrEqual(view.left + view.width - 0.001);
    expect(maxBottomRight.y).toBeGreaterThanOrEqual(view.top + view.height - 0.001);

    panel._scrollX = -99999;
    panel._scrollY = -99999;
    panel._clampScroll();
    const minTopLeft = panel.mapToScreen(0, 0);
    expect(minTopLeft.x).toBeGreaterThanOrEqual(view.left - 0.001);
    expect(minTopLeft.y).toBeGreaterThanOrEqual(view.top - 0.001);
  });

  it('currentSceneId 去掉 chunk 后缀后与锚点对齐', () => {
    const panel = makePanel();
    expect(panel._currentSceneId()).toBe('S09');
  });

  it('无世界索引/无城池时安全降级，open/close/toggle 可用', () => {
    const panel = new WorldMapPanel({ x: 0, y: 0, width: 800, height: 600 });
    panel.setDataProviders({});
    expect(() => panel.open()).not.toThrow();
    expect(panel.visible).toBe(true);
    expect(panel._cities).toEqual([]);
    expect(panel._mapWidth).toBe(0);
    expect(panel.toggle()).toBe(false);
    expect(panel.visible).toBe(false);
  });

  it('可见时 handleInput 消费输入（模态），不可见时不消费', () => {
    const panel = makePanel();
    const inputManager = {
      getMousePosition: () => ({ x: 500, y: 350 }),
      isMouseButtonDown: () => false
    };
    expect(panel.handleInput({ inputManager })).toBe(false);
    panel.open();
    expect(panel.handleInput({ inputManager })).toBe(true);
  });
});

describe('WorldMapPanel 遭遇四选确认框（4C）', () => {
  const makeCtx = () => new Proxy({}, {
    get: (target, key) => {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 40 });
      return () => {};
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    }
  });

  const card = { x: 0, y: 0, w: 1000, h: 700 };
  const makeEncounter = (available = {}) => ({
    id: 'enc.1',
    unitId: 'army.player',
    kind: 'city',
    nodeId: 'S09',
    createdAt: 0,
    expiresAt: 8000,
    remainingMs: 4000,
    available: { ambush: true, detour: false, fight: true, retreat: true, ...available }
  });

  it('渲染四个按钮，不可用项置灰并标注当前不可用', () => {
    const panel = makePanel({ getPendingEncounter: () => makeEncounter() });
    panel._renderEncounter(makeCtx(), card);
    expect(panel._encounterRects).toHaveLength(4);
    expect(panel._encounterRects.map(rect => rect.choice)).toEqual(['ambush', 'detour', 'fight', 'retreat']);
    expect(panel._encounterRects.find(rect => rect.choice === 'detour').enabled).toBe(false);
    expect(panel._encounterRects.filter(rect => rect.enabled)).toHaveLength(3);
  });

  it('点击可用按钮回调 { unitId, encounterId, choice }', () => {
    const decide = vi.fn();
    const panel = makePanel({ getPendingEncounter: () => makeEncounter() });
    panel.setHandlers({ onEncounterDecide: decide });
    panel.open();
    panel._renderEncounter(makeCtx(), card);
    const rect = panel._encounterRects.find(entry => entry.choice === 'ambush');

    expect(panel.handleMouseClick(rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(true);
    expect(decide).toHaveBeenCalledWith({ unitId: 'army.player', encounterId: 'enc.1', choice: 'ambush' });
  });

  it('点击置灰按钮只吞输入、不回调', () => {
    const decide = vi.fn();
    const panel = makePanel({ getPendingEncounter: () => makeEncounter() });
    panel.setHandlers({ onEncounterDecide: decide });
    panel.open();
    panel._renderEncounter(makeCtx(), card);
    const rect = panel._encounterRects.find(entry => entry.choice === 'detour');

    expect(panel.handleMouseClick(rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });

  it('无待决遭遇：按钮表为空且不回调', () => {
    const decide = vi.fn();
    const panel = makePanel({ getPendingEncounter: () => null });
    panel.setHandlers({ onEncounterDecide: decide });
    panel._renderEncounter(makeCtx(), card);
    expect(panel._encounterRects).toEqual([]);
    panel.handleMouseClick(500, 350);
    expect(decide).not.toHaveBeenCalled();
  });
});

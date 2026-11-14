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

describe('WorldMapPanel 缩放与拖拽互斥', () => {
  const makeWheel = (deltaY, position) => ({
    getMousePosition: () => position,
    isMouseButtonDown: () => false,
    consumeWheelDelta: () => ({ x: 0, y: deltaY })
  });

  it('滚轮缩放以鼠标为锚点，并限制在整图适配～4 倍', () => {
    const panel = makePanel();
    panel.open();
    const view = panel._viewport;
    const anchor = { x: view.left + 220, y: view.top + 140 };
    const basePoint = {
      x: (anchor.x - view.left + panel._scrollX) / panel._zoom,
      y: (anchor.y - view.top + panel._scrollY) / panel._zoom
    };

    expect(panel.handleInput({ inputManager: makeWheel(-120, anchor) })).toBe(true);
    expect(panel._zoom).toBeGreaterThan(1);
    expect((anchor.x - view.left + panel._scrollX) / panel._zoom).toBeCloseTo(basePoint.x, 6);
    expect((anchor.y - view.top + panel._scrollY) / panel._zoom).toBeCloseTo(basePoint.y, 6);

    for (let i = 0; i < 30; i += 1) panel.handleInput({ inputManager: makeWheel(-500, anchor) });
    expect(panel._zoom).toBe(4);
    expect(panel._cellWidth).toBe(1024);
    expect(panel._cellHeight).toBe(576);
    expect(panel._mapWidth).toBe(20480);
    expect(panel.worldToMap(12800, 7200)).toEqual({ x: 10240, y: 5760 });

    for (let i = 0; i < 30; i += 1) panel.handleInput({ inputManager: makeWheel(500, anchor) });
    const limits = panel._zoomLimits();
    expect(panel._zoom).toBeCloseTo(limits.min, 6);
    expect(panel._mapWidth).toBeCloseTo(5120 * limits.min, 6);
    expect(panel._mapHeight).toBeCloseTo(2880 * limits.min, 6);
  });

  it('缩放后格子尺寸、标记换算与命中同步', () => {
    const panel = makePanel();
    panel.open();
    panel._setZoom(2);
    expect(panel._cellWidth).toBe(512);
    expect(panel._cellHeight).toBe(288);
    expect(panel._mapWidth).toBe(10240);
    expect(panel._mapHeight).toBe(5760);

    const city = panel._cities[0];
    expect(panel.worldToMap(city.x, city.y)).toEqual({ x: 5632, y: 3168 });
    panel._scrollX = 5632 - panel._viewport.width / 2;
    panel._scrollY = 3168 - panel._viewport.height / 2;
    panel._clampScroll();
    const screen = panel._markerScreen(city);
    expect(panel._markerAt(screen.x, screen.y)?.id).toBe('city.s09_guangzong_camp');
  });

  it('放大与缩小后滚动量都夹在边界内，不会卡在边缘回不来', () => {
    const panel = makePanel();
    panel.open();
    panel._setZoom(4);
    panel._scrollX = 1e9;
    panel._scrollY = 1e9;
    panel._clampScroll();
    expect(panel._scrollX).toBeCloseTo(panel._mapWidth - panel._viewport.width, 6);
    expect(panel._scrollY).toBeCloseTo(panel._mapHeight - panel._viewport.height, 6);

    panel._setZoom(panel._zoomLimits().min);
    expect(panel._scrollX).toBeGreaterThanOrEqual(0);
    expect(panel._scrollX).toBeLessThanOrEqual(panel._mapWidth - panel._viewport.width + 0.001);
    expect(panel._scrollY).toBeGreaterThanOrEqual(0);
    expect(panel._scrollY).toBeLessThanOrEqual(panel._mapHeight - panel._viewport.height + 0.001);
    const topLeft = panel.mapToScreen(0, 0);
    expect(topLeft.x).toBeLessThanOrEqual(panel._viewport.left + 0.001);
    expect(topLeft.y).toBeLessThanOrEqual(panel._viewport.top + 0.001);
    const bottomRight = panel.mapToScreen(panel._mapWidth, panel._mapHeight);
    expect(bottomRight.x).toBeGreaterThanOrEqual(panel._viewport.left + panel._viewport.width - 0.001);
    expect(bottomRight.y).toBeGreaterThanOrEqual(panel._viewport.top + panel._viewport.height - 0.001);
  });

  it('从标记上开始拖动只平移，不开指令环；原地松开才点选', () => {
    const panel = makePanel();
    panel.open();
    panel._setZoom(2);
    const city = panel._cities[0];
    panel._scrollX = 5632 - panel._viewport.width / 2;
    panel._scrollY = 3168 - panel._viewport.height / 2;
    panel._clampScroll();
    const start = panel._markerScreen(city);
    const scrollBefore = panel._scrollX;

    let pos = { x: start.x, y: start.y };
    let down = true;
    const inputManager = { getMousePosition: () => pos, isMouseButtonDown: () => down };
    panel.handleInput({ inputManager });
    pos = { x: start.x - 60, y: start.y - 30 };
    panel.handleInput({ inputManager });
    down = false;
    panel.handleInput({ inputManager });
    expect(panel._selected).toBe(null);
    expect(panel._scrollX).toBeGreaterThan(scrollBefore);

    panel._scrollX = 5632 - panel._viewport.width / 2;
    panel._scrollY = 3168 - panel._viewport.height / 2;
    panel._clampScroll();
    const clickPoint = panel._markerScreen(city);
    pos = { x: clickPoint.x, y: clickPoint.y };
    down = true;
    panel.handleInput({ inputManager });
    down = false;
    panel.handleInput({ inputManager });
    expect(panel._selected?.id).toBe('city.s09_guangzong_camp');
  });

  it('按下与松开落在同一帧的快速点击仍能点选标记', () => {
    const panel = makePanel();
    panel.open();
    panel._setZoom(2);
    const city = panel._cities[0];
    panel._scrollX = 5632 - panel._viewport.width / 2;
    panel._scrollY = 3168 - panel._viewport.height / 2;
    panel._clampScroll();
    const screen = panel._markerScreen(city);
    const inputManager = {
      getMousePosition: () => screen,
      isMouseButtonDown: () => false,
      mouse: { clicked: true, clickedButton: 0, dragged: false }
    };
    expect(panel.handleInput({ inputManager })).toBe(true);
    expect(panel._selected?.id).toBe('city.s09_guangzong_camp');
  });

  it('重新打开复位缩放；窗口尺寸变化后视口与缩放重新夹紧', () => {
    const panel = makePanel();
    panel.open();
    panel._setZoom(3);
    expect(panel._zoom).toBe(3);
    panel.close();
    panel.open();
    expect(panel._zoom).toBe(1);
    expect(panel._mapWidth).toBe(5120);

    panel._setZoom(4);
    panel.setSize(600, 500);
    panel.refreshLayout();
    const rect = panel._panelRect();
    expect(panel._viewport.left).toBeGreaterThanOrEqual(rect.x);
    expect(panel._viewport.left + panel._viewport.width).toBeLessThanOrEqual(rect.x + rect.w + 0.001);
    expect(panel._viewport.top + panel._viewport.height).toBeLessThanOrEqual(rect.y + rect.h + 0.001);
    expect(panel._zoom).toBeLessThanOrEqual(4);
    expect(panel._scrollX).toBeLessThanOrEqual(panel._mapWidth - panel._viewport.width + 0.001);
  });
});

describe('WorldMapPanel 双指缩放与惯性滑动', () => {
  /** 用状态对象模拟 InputManager 的鼠标 + 触点接口。 */
  const makeInput = state => ({
    getMousePosition: () => state.mouse,
    isMouseButtonDown: () => state.down,
    getTouchPoints: () => state.points,
    consumeWheelDelta: () => ({ x: 0, y: 0 }),
    mouse: state.mouseState
  });

  const centerScroll = panel => {
    panel._scrollX = Math.max(0, panel._mapWidth / 2 - panel._viewport.width / 2);
    panel._scrollY = Math.max(0, panel._mapHeight / 2 - panel._viewport.height / 2);
    panel._clampScroll();
  };

  /** 屏幕上某点对应的 1× 地图坐标（缩放锚点是否漂移的判据）。 */
  const anchorBase = (panel, point) => ({
    x: (point.x - panel._viewport.left + panel._scrollX) / panel._zoom,
    y: (point.y - panel._viewport.top + panel._scrollY) / panel._zoom
  });

  it('双指缩放以双指中心为锚点，倍率夹在「盖满视口」～4 倍', () => {
    const panel = makePanel();
    panel.open();
    centerScroll(panel);
    const view = panel._viewport;
    const center = { x: view.left + view.width / 2, y: view.top + view.height / 2 };
    const state = {
      mouse: center,
      down: true,
      points: [
        { x: center.x - 100, y: center.y - 100 },
        { x: center.x + 100, y: center.y + 100 }
      ]
    };
    const input = makeInput(state);
    // 首帧只记基准
    panel.handleInput({ inputManager: input });
    const emptyBefore = anchorBase(panel, center);

    // 双指张开一倍：中心下的地图坐标保持不动
    state.points = [
      { x: center.x - 200, y: center.y - 200 },
      { x: center.x + 200, y: center.y + 200 }
    ];
    panel.handleInput({ inputManager: input });
    expect(panel._zoom).toBeCloseTo(2, 6);
    const emptyAfter = anchorBase(panel, center);
    expect(emptyAfter.x).toBeCloseTo(emptyBefore.x, 4);
    expect(emptyAfter.y).toBeCloseTo(emptyBefore.y, 4);
    // 标记在缩放中不漂移：屏幕位置与地图坐标换算一致
    const city = panel._cities[0];
    const screen = panel._markerScreen(city);
    const map = panel.worldToMap(city.x, city.y);
    expect(screen.x).toBeCloseTo(view.left + map.x - panel._scrollX, 6);
    expect(screen.y).toBeCloseTo(view.top + map.y - panel._scrollY, 6);

    // 持续张开 → 上限 4 倍
    for (let i = 0; i < 6; i += 1) {
      state.points = [
        { x: center.x - 500, y: center.y - 500 },
        { x: center.x + 500, y: center.y + 500 }
      ];
      panel.handleInput({ inputManager: input });
    }
    expect(panel._zoom).toBe(4);

    // 持续收拢 → 下限仍盖满视口，四边不露空白
    for (let i = 0; i < 8; i += 1) {
      state.points = [
        { x: center.x - 10, y: center.y - 10 },
        { x: center.x + 10, y: center.y + 10 }
      ];
      panel.handleInput({ inputManager: input });
    }
    expect(panel._zoom).toBeCloseTo(panel._zoomLimits().min, 6);
    const topLeft = panel.mapToScreen(0, 0);
    const bottomRight = panel.mapToScreen(panel._mapWidth, panel._mapHeight);
    expect(topLeft.x).toBeLessThanOrEqual(view.left + 0.001);
    expect(topLeft.y).toBeLessThanOrEqual(view.top + 0.001);
    expect(bottomRight.x).toBeGreaterThanOrEqual(view.left + view.width - 0.001);
    expect(bottomRight.y).toBeGreaterThanOrEqual(view.top + view.height - 0.001);
  });

  it('单指拖图切双指、再回单指拖动都不跳变，松手不误点选', () => {
    const panel = makePanel();
    panel.open();
    centerScroll(panel);
    const view = panel._viewport;
    const start = { x: view.left + 300, y: view.top + 200 };
    const state = { mouse: start, down: true, points: [start] };
    const input = makeInput(state);
    panel.handleInput({ inputManager: input }); // 单指按下
    const scroll0 = { x: panel._scrollX, y: panel._scrollY };
    state.mouse = { x: start.x - 50, y: start.y - 20 };
    state.points = [state.mouse];
    panel.handleInput({ inputManager: input });
    expect(panel._scrollX).toBeCloseTo(scroll0.x + 50, 6);

    // 第二指落下：首帧只记基准，不缩放、不跳变
    const beforePinch = { x: panel._scrollX, y: panel._scrollY, zoom: panel._zoom };
    const a = { x: state.mouse.x - 80, y: state.mouse.y - 60 };
    const b = { x: state.mouse.x + 80, y: state.mouse.y + 60 };
    state.points = [a, b];
    panel.handleInput({ inputManager: input });
    expect(panel._zoom).toBeCloseTo(beforePinch.zoom, 6);
    expect(panel._scrollX).toBeCloseTo(beforePinch.x, 6);
    expect(panel._scrollY).toBeCloseTo(beforePinch.y, 6);

    // 张开双指：以中心为锚点缩放
    const pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const anchorBefore = anchorBase(panel, pinchCenter);
    state.points = [
      { x: pinchCenter.x - 160, y: pinchCenter.y - 120 },
      { x: pinchCenter.x + 160, y: pinchCenter.y + 120 }
    ];
    panel.handleInput({ inputManager: input });
    expect(panel._zoom).toBeGreaterThan(beforePinch.zoom);
    const anchorAfter = anchorBase(panel, pinchCenter);
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 4);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 4);

    // 抬起一指：剩余手指就地接续拖动，不跳变
    const remaining = state.points[1];
    const beforeOne = { x: panel._scrollX, y: panel._scrollY };
    state.points = [remaining];
    state.mouse = remaining;
    panel.handleInput({ inputManager: input });
    expect(panel._scrollX).toBeCloseTo(beforeOne.x, 6);
    expect(panel._scrollY).toBeCloseTo(beforeOne.y, 6);

    state.mouse = { x: remaining.x - 30, y: remaining.y };
    state.points = [state.mouse];
    panel.handleInput({ inputManager: input });
    expect(panel._scrollX).toBeCloseTo(beforeOne.x + 30, 6);
    expect(panel._scrollY).toBeCloseTo(beforeOne.y, 6);

    // 松手：clicked 残留 + 惯性都不能把这次手势变成点选
    state.down = false;
    state.points = [];
    state.mouseState = { clicked: true, clickedButton: 0, dragged: false };
    panel.handleInput({ inputManager: input });
    expect(panel._selected).toBe(null);
    expect(panel._inertia.active).toBe(false);
  });

  it('松手后按松手前的速度继续滑动并逐渐减速停下', () => {
    const panel = makePanel();
    panel.open();
    centerScroll(panel);
    let clock = 0;
    panel._now = () => clock;
    const state = {
      mouse: { x: panel._viewport.left + 300, y: panel._viewport.top + 200 },
      down: true,
      points: []
    };
    const input = makeInput(state);

    panel.handleInput({ inputManager: input }); // t=0 按下
    const start = { x: panel._scrollX, y: panel._scrollY };
    clock = 16;
    state.mouse = { x: state.mouse.x - 120, y: state.mouse.y };
    panel.handleInput({ inputManager: input }); // 拖动 120px
    expect(panel._scrollX).toBeCloseTo(start.x + 120, 6);

    const afterDrag = panel._scrollX;
    clock = 32;
    state.down = false;
    panel.handleInput({ inputManager: input }); // 松手 → 惯性
    expect(panel._inertia.active).toBe(true);
    expect(panel._inertia.vx).toBeGreaterThan(0);

    clock = 48;
    panel.handleInput({ inputManager: input });
    expect(panel._scrollX).toBeGreaterThan(afterDrag);
    const speed1 = panel._inertia.vx;

    clock = 64;
    panel.handleInput({ inputManager: input });
    expect(panel._inertia.vx).toBeLessThan(speed1);
    const speed2 = panel._inertia.vx;

    // 继续积分直到自然停下：速度单调下降、最终归零
    for (clock = 80; clock < 20000 && panel._inertia.active; clock += 16) {
      panel.handleInput({ inputManager: input });
      if (panel._inertia.active) expect(panel._inertia.vx).toBeLessThan(speed2);
    }
    expect(panel._inertia.active).toBe(false);
    expect(panel._scrollX).toBeLessThanOrEqual(panel._mapWidth - panel._viewport.width + 0.001);
  });

  it('惯性撞到边界立即停住，不滑出界再弹回', () => {
    const panel = makePanel();
    panel.open();
    let clock = 1000;
    panel._now = () => clock;
    // 视口贴住右下角，惯性仍向右下推
    panel._scrollX = panel._mapWidth - panel._viewport.width;
    panel._scrollY = panel._mapHeight - panel._viewport.height;
    const maxX = panel._scrollX;
    const maxY = panel._scrollY;
    panel._inertia = { active: true, vx: 4000, vy: 4000, lastTime: clock };

    const input = makeInput({ mouse: { x: 0, y: 0 }, down: false, points: [] });
    clock = 1016;
    panel.handleInput({ inputManager: input });
    expect(panel._scrollX).toBeCloseTo(maxX, 6);
    expect(panel._scrollY).toBeCloseTo(maxY, 6);
    expect(panel._inertia.vx).toBe(0);
    expect(panel._inertia.vy).toBe(0);
    expect(panel._scrollX).toBeLessThanOrEqual(panel._mapWidth - panel._viewport.width + 0.001);
    expect(panel._scrollY).toBeLessThanOrEqual(panel._mapHeight - panel._viewport.height + 0.001);
  });

  it('惯性滑动本身不触发点选，从标记上拖动松手也不会被误点选', () => {
    const panel = makePanel();
    panel.open();
    const city = panel._cities[0];
    const map = panel.worldToMap(city.x, city.y);
    panel._scrollX = map.x - panel._viewport.width / 2;
    panel._scrollY = map.y - panel._viewport.height / 2;
    panel._clampScroll();
    const marker = panel._markerScreen(city);

    let clock = 0;
    panel._now = () => clock;
    const state = { mouse: { x: marker.x, y: marker.y }, down: true, points: [] };
    const input = makeInput(state);
    panel.handleInput({ inputManager: input }); // 按在标记上
    clock = 16;
    state.mouse = { x: marker.x - 80, y: marker.y };
    panel.handleInput({ inputManager: input }); // 拖过阈值 → 转拖图
    clock = 32;
    state.down = false;
    panel.handleInput({ inputManager: input }); // 松手：不点选，启动惯性
    expect(panel._selected).toBe(null);
    expect(panel._inertia.active).toBe(true);

    // 惯性持续推进期间也不会凭空产生点选
    for (let t = 48; t < 2000 && panel._inertia.active; t += 16) {
      clock = t;
      state.mouse = { x: marker.x - 80, y: marker.y };
      panel.handleInput({ inputManager: input });
      expect(panel._selected).toBe(null);
    }
  });
});

describe('WorldMapPanel 遭遇四选确认框（4C）', () => {  const makeCtx = () => new Proxy({}, {
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

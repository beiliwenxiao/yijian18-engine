// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { WorldMapEditor } from './WorldMapEditor.js';

function makeEditor() {
  const editor = new WorldMapEditor(null, {
    gameId: 'test',
    canonicalSession: { sourceUri: 'example/test/game.project.json' }
  });
  const region = {
    id: 'region.test',
    name: '测试',
    mapType: 'terrainGrid',
    chunkWidth: 100,
    chunkHeight: 100,
    cols: 2,
    rows: 2,
    grid: [
      [{ terrain: 'plain', sceneId: 'S01' }, { terrain: 'forest' }],
      [{ terrain: 'plain' }, { terrain: 'forest' }]
    ]
  };
  editor.region = region;
  editor.draftWorldMap = { entrySceneId: null, regions: [structuredClone(region)] };
  editor._draftIndex = { getCell: () => null, getFootprint: () => null };
  editor._buildDraftIndex = vi.fn(() => ({ getCell: () => null, getFootprint: () => null }));
  editor._prepareMainlandCellReplacements = vi.fn(() => []);
  editor._commitMainlandCellReplacements = vi.fn();
  editor._paintMainlandMinimapCells = vi.fn();
  editor._requestMainlandViewportSync = vi.fn();
  editor._showToast = vi.fn();
  return editor;
}

function control(tagName, className, attrs = {}) {
  const el = document.createElement(tagName);
  el.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'r' || key === 'c') el.dataset[key] = String(value);
    else el[key] = value;
  }
  return el;
}

function poiSelect(r, c, value) {
  const el = document.createElement('select');
  el.className = 'wme-poi-select';
  el.dataset.r = String(r);
  el.dataset.c = String(c);
  el.append(new Option('无', ''), new Option('关隘', 'pass'), new Option('渡口', 'ferry'));
  el.value = value;
  return el;
}

function terrainSelect(r, c, value) {
  const el = document.createElement('select');
  el.className = 'wme-terrain-select';
  el.dataset.r = String(r);
  el.dataset.c = String(c);
  for (const terrain of ['mountain', 'yellowRiver', 'forest', 'plain']) {
    el.append(new Option(terrain, terrain));
  }
  el.value = value;
  return el;
}

describe('WorldMapEditor 地图格道路/落点写回（4E 数据层）', () => {
  it('勾选道路格写入 road，取消勾选清理字段', () => {
    const editor = makeEditor();
    const toggle = control('input', 'wme-road-toggle', { r: 1, c: 1, checked: true });
    editor._handleMainlandCellChange({ target: toggle });
    expect(editor.region.grid[1][1]).toEqual({ terrain: 'forest', road: true });

    const off = control('input', 'wme-road-toggle', { r: 1, c: 1, checked: false });
    editor.region.grid[1][1] = { terrain: 'forest', road: true };
    editor._handleMainlandCellChange({ target: off });
    expect(editor.region.grid[1][1]).toEqual({ terrain: 'forest' });
    expect(Object.hasOwn(editor.region.grid[1][1], 'road')).toBe(false);
  });

  it('选择 POI 类型写入 poi，选择「无」清理字段', () => {
    const editor = makeEditor();
    editor._handleMainlandCellChange({ target: poiSelect(0, 0, 'pass') });
    expect(editor.region.grid[0][0]).toEqual({ terrain: 'plain', sceneId: 'S01', poi: 'pass' });

    editor.region.grid[0][0] = { terrain: 'plain', sceneId: 'S01', poi: 'pass' };
    editor._handleMainlandCellChange({ target: poiSelect(0, 0, '') });
    expect(editor.region.grid[0][0]).toEqual({ terrain: 'plain', sceneId: 'S01' });
  });

  it('改地形时保留既有的 road/poi 声明', () => {
    const editor = makeEditor();
    editor.region.grid[1][1] = { terrain: 'forest', road: true, poi: 'ferry' };
    const terrain = terrainSelect(1, 1, 'plain');
    editor._handleMainlandCellChange({ target: terrain });
    expect(editor.region.grid[1][1]).toEqual({ terrain: 'plain', road: true, poi: 'ferry' });
  });

  it('sceneGrid 不承载 terrain/road/poi（写回时剥离）', () => {
    const editor = makeEditor();
    const sceneGridEditor = makeEditor();
    sceneGridEditor.region.mapType = 'sceneGrid';
    sceneGridEditor.region.grid = [[{ sceneId: 'S01', road: true, poi: 'pass' }, null]];
    sceneGridEditor.draftWorldMap.regions[0].mapType = 'sceneGrid';
    sceneGridEditor.draftWorldMap.regions[0].grid = [[{ sceneId: 'S01', road: true, poi: 'pass' }, null]];

    const select = document.createElement('select');
    select.className = 'wme-scene-select';
    select.dataset.r = '0';
    select.dataset.c = '0';
    select.append(new Option('(空)', ''), new Option('S01', 'S01'), new Option('S02', 'S02'));
    select.value = 'S02';
    sceneGridEditor._handleMainlandCellChange({ target: select });
    expect(sceneGridEditor.region.grid[0][0]).toBe('S02');
    expect(editor.region.mapType).toBe('terrainGrid');
  });

  it('非法 POI 值不写入（保持缺省无 POI）', () => {
    const editor = makeEditor();
    editor.region.grid[1][1] = { terrain: 'forest' };
    editor._handleMainlandCellChange({ target: poiSelect(1, 1, 'bridge') });
    expect(editor.region.grid[1][1]).toEqual({ terrain: 'forest' });
  });

  it('_restoreCellControl 按旧格还原道路勾选与 POI 下拉', () => {
    const editor = makeEditor();
    const toggle = control('input', 'wme-road-toggle', { checked: false });
    editor._restoreCellControl(toggle, { terrain: 'plain', road: true }, null);
    expect(toggle.checked).toBe(true);

    const select = poiSelect(0, 0, '');
    editor._restoreCellControl(select, { terrain: 'plain', poi: 'ferry' }, null);
    expect(select.value).toBe('ferry');

    const cleared = control('input', 'wme-road-toggle', { checked: true });
    editor._restoreCellControl(cleared, { terrain: 'plain' }, null);
    expect(cleared.checked).toBe(false);
  });
});

describe('WorldMapEditor 路网图层（roadEdges 录入与抽取器联动）', () => {
  function wireRoad(editor) {
    editor.draftWorldMap.regions[0] = editor.region;
    editor._buildCandidateProject = vi.fn(() => ({ worldMap: structuredClone(editor.draftWorldMap) }));
    editor.logicEditor = { setAutoLayer: vi.fn() };
    editor._roadLayer = { render: vi.fn() };
    editor._showToast = vi.fn();
    return editor;
  }

  it('自动推导只补正交相邻道路格的缺边，既有手工边原样保留', () => {
    const editor = wireRoad(makeEditor());
    editor.region.roadEdges = [[[0, 0], [1, 1]]];
    editor.region.grid[0][0] = { terrain: 'plain', road: true };
    editor.region.grid[0][1] = { terrain: 'forest', road: true };
    editor.region.grid[1][1] = { terrain: 'forest', road: true };

    expect(editor._deriveRoadEdges(editor.region)).toBe(2);
    expect(editor.region.roadEdges[0]).toEqual([[0, 0], [1, 1]]);
    expect(editor.region.roadEdges).toHaveLength(3);

    expect(editor._deriveRoadEdges(editor.region)).toBe(0);
    expect(editor.region.roadEdges).toHaveLength(3);
  });

  it('连线要求两端都是道路格且正交相邻；对角与重复连接被拒绝', () => {
    const editor = wireRoad(makeEditor());
    editor.region.grid[0][0] = { terrain: 'plain', road: true };
    editor.region.grid[0][1] = { terrain: 'forest', road: true };

    expect(editor._connectRoadCells([0, 0], [1, 1])).toBe(false);
    expect(editor._connectRoadCells([0, 0], [1, 0])).toBe(false);
    expect(editor.region.roadEdges).toBeUndefined();

    expect(editor._connectRoadCells([0, 0], [0, 1])).toBe(true);
    expect(editor.region.roadEdges).toEqual([[[0, 0], [0, 1]]]);
    expect(editor._connectRoadCells([0, 0], [0, 1])).toBe(false);
    expect(editor.logicEditor.setAutoLayer).toHaveBeenCalledTimes(1);
  });

  it('删除按索引落到 roadEdges，并重画图层、重抽自动层', () => {
    const editor = wireRoad(makeEditor());
    editor.region.roadEdges = [[[0, 0], [0, 1]], [[0, 1], [1, 1]]];

    expect(editor._deleteRoadEdge(0)).toBe(true);
    expect(editor.region.roadEdges).toEqual([[[0, 1], [1, 1]]]);
    expect(editor._roadLayer.render).toHaveBeenCalled();
    expect(editor.logicEditor.setAutoLayer).toHaveBeenCalledTimes(1);

    expect(editor._deleteRoadEdge(9)).toBe(false);
    expect(editor.region.roadEdges).toHaveLength(1);
  });

  it('图层里的边与抽取器同源：关隘—渡口连线进入自动层并标记 ferry', () => {
    const editor = wireRoad(makeEditor());
    const region = {
      id: 'region.test',
      name: '测试',
      mapType: 'terrainGrid',
      chunkWidth: 100,
      chunkHeight: 100,
      cols: 2,
      rows: 1,
      grid: [[
        { terrain: 'plain', road: true, poi: 'pass' },
        { terrain: 'plain', road: true, poi: 'ferry' }
      ]]
    };
    editor.region = region;
    editor.draftWorldMap = { entrySceneId: null, regions: [region] };

    expect(editor._connectRoadCells([0, 0], [0, 1])).toBe(true);
    const autoLayer = editor.logicEditor.setAutoLayer.mock.calls[0][0];
    const edge = autoLayer.edges.find(item => item.mode === 'ferry');
    expect(edge).toBeTruthy();
    expect(edge.id).toBe('edge.pass.region.test.r0c0__ferry.region.test.r0c1');
  });
});

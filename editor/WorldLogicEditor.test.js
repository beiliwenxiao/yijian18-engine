/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-10
 ************************************************************/

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { WorldLogicEditor } from './WorldLogicEditor.js';
import { WorldMapEditor } from './WorldMapEditor.js';

const REGION = Object.freeze({
  id: 'region.test',
  chunkWidth: 1280,
  chunkHeight: 720,
  cols: 2,
  rows: 1
});

function makeLogic() {
  return {
    nodes: [
      { id: 'n.a', kind: 'city', name: '甲城', position: { x: 100, y: 100 }, ownerFactionId: 'yellow_turban' },
      { id: 'n.b', kind: 'bridge', name: '桥', position: { x: 800, y: 100 }, ownerFactionId: 'han_government', source: 'auto', autoRevision: 4 },
      { id: 'n.c', kind: 'city', name: '丙城', position: { x: 1500, y: 100 }, ownerFactionId: 'yellow_turban' }
    ],
    edges: [
      { id: 'e.ab', from: 'n.a', to: 'n.b', mode: 'road', cost: 2 },
      { id: 'e.bc', from: 'n.b', to: 'n.c', mode: 'bridge', weight: 3, crossingNodeId: 'n.b', source: 'manual' }
    ]
  };
}

function makeEditor(logic = makeLogic()) {
  const toolbarHost = document.createElement('div');
  const panelHost = document.createElement('div');
  const gridEl = document.createElement('div');
  const editor = new WorldLogicEditor({
    toolbarHost,
    panelHost,
    logic,
    factions: ['han_government', 'yellow_turban'],
    moverFactionId: 'yellow_turban'
  });
  editor.render(REGION, { gridEl, thumbW: 256, thumbH: 144, labelH: 20, gap: 2 });
  return { editor, toolbarHost, panelHost, gridEl };
}

describe('WorldLogicEditor · 三视图外壳', () => {
  it('默认表现视图隐藏投影；逻辑视图显示且接管指针；叠加只读显示但不接管', () => {
    const { editor, toolbarHost, gridEl } = makeEditor();
    const svg = gridEl.querySelector('.wle-overlay');
    expect(svg).toBeTruthy();
    expect(svg.style.display).toBe('none');

    editor.setViewMode('logic');
    expect(svg.style.display).toBe('block');
    expect(svg.style.pointerEvents).toBe('auto');
    expect(gridEl.style.filter).toContain('grayscale');
    expect(toolbarHost.querySelector('[data-view="logic"]').dataset.active).toBe('1');

    editor.setViewMode('overlay');
    expect(svg.style.display).toBe('block');
    expect(svg.style.pointerEvents).toBe('none');
    expect(gridEl.style.filter).toBe('');

    editor.setViewMode('presentation');
    expect(svg.style.display).toBe('none');
    expect(editor.getViewMode()).toBe('presentation');
  });
});

describe('WorldLogicEditor · 通行投影只读派生', () => {
  it('桥被敌方控制时同一条边红虚线，且预览给出 passBlocked', () => {
    const { editor, gridEl } = makeEditor();
    editor.setViewMode('logic');
    const line = gridEl.querySelector('line.wle-edge[data-edge-id="e.bc"]');
    expect(line.getAttribute('stroke')).toBe('#e74c3c');
    expect(line.getAttribute('stroke-dasharray')).toBeTruthy();
    const green = gridEl.querySelector('line.wle-edge[data-edge-id="e.ab"]');
    expect(green.getAttribute('stroke')).toBe('#4caf50');

    const result = editor.previewRoute('n.a', 'n.c');
    expect(result).toMatchObject({ ok: false, code: 'passBlocked' });
  });

  it('无可绕路径与地形阻隔分别给出 noPath / terrainBlocked', () => {
    const logic = makeLogic();
    logic.nodes.push({ id: 'n.d', kind: 'city', name: '孤城', position: { x: 100, y: 500 } });
    logic.edges.push({
      id: 'e.da', from: 'n.d', to: 'n.a', mode: 'mountainPath', cost: 1,
      conditions: { terrainBlocked: true }
    });
    const { editor } = makeEditor(logic);
    expect(editor.previewRoute('n.d', 'n.a')).toMatchObject({ ok: false, code: 'terrainBlocked' });
    expect(editor.previewRoute('n.d', 'n.c')).toMatchObject({ ok: false, code: 'terrainBlocked' });
  });
});

describe('WorldLogicEditor · 改已有写回', () => {
  it('拖节点写 position 并清掉过期 cell 吸附', () => {
    const logic = makeLogic();
    logic.nodes[0].cell = { row: 0, col: 0 };
    const { editor } = makeEditor(logic);
    expect(editor.moveNode('n.a', { x: 240, y: 360 })).toBe(true);
    const node = editor.getLogic().nodes.find(item => item.id === 'n.a');
    expect(node.position).toEqual({ x: 240, y: 360 });
    expect(node.cell).toBeUndefined();
    expect(editor.isDirty()).toBe(true);
  });

  it('改权重写 cost 并删除 weight 别名；条件统一收敛到 conditions', () => {
    const { editor } = makeEditor();
    editor.updateEdge('e.bc', { cost: 9 });
    let edge = editor.getLogic().edges.find(item => item.id === 'e.bc');
    expect(edge.cost).toBe(9);
    expect(edge.weight).toBeUndefined();

    editor.updateEdgeConditions('e.bc', { blockedUntilDay: 6 });
    edge = editor.getLogic().edges.find(item => item.id === 'e.bc');
    expect(edge.crossingNodeId).toBeUndefined();
    expect(edge.conditions).toMatchObject({ crossingNodeId: 'n.b', blockedUntilDay: 6 });
  });

  it('面板输入改边权重走同一写回路径', () => {
    const { editor, panelHost } = makeEditor();
    editor.selectEdge('e.ab');
    const input = panelHost.querySelector('[data-scope="edge"][data-prop="cost"]');
    expect(input).toBeTruthy();
    input.value = '7';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(editor.getLogic().edges.find(item => item.id === 'e.ab').cost).toBe(7);
  });

  it('getLogic 原样保留 source / autoRevision 扩展字段', () => {
    const { editor } = makeEditor();
    const logic = editor.getLogic();
    const node = logic.nodes.find(item => item.id === 'n.b');
    const edge = logic.edges.find(item => item.id === 'e.bc');
    expect(node).toMatchObject({ source: 'auto', autoRevision: 4 });
    expect(edge.source).toBe('manual');
  });
});

describe('WorldMapEditor · 逻辑草稿保存接线', () => {
  function makeProject({ withLogic = true } = {}) {
    const project = {
      scenes: [],
      variables: { cityStates: [{ id: 'city.x', factionId: 'han_government' }] },
      worldMap: {
        entrySceneId: null,
        regions: [{
          id: 'region.test',
          name: '测试',
          mapType: 'terrainGrid',
          chunkWidth: 1280,
          chunkHeight: 720,
          cols: 2,
          rows: 1,
          grid: [[{ terrain: 'plain' }, { terrain: 'forest' }]]
        }]
      }
    };
    if (withLogic) project.worldLogic = makeLogic();
    return project;
  }

  function makeMapEditor(project) {
    const patches = [];
    const canonicalSession = {
      sourceUri: 'example/game/game.project.json',
      getValue: () => project,
      patch: (path, value) => patches.push({ path, value }),
      save: async () => ({ ok: true, committed: true })
    };
    const editor = new WorldMapEditor(document.createElement('div'), { canonicalSession });
    editor.project = structuredClone(project);
    editor.draftWorldMap = structuredClone(project.worldMap);
    editor.selectedRegionId = 'region.test';
    editor.region = editor.draftWorldMap.regions[0];
    editor._repositorySceneIds = new Set();
    editor.logicEditor = new WorldLogicEditor({ logic: project.worldLogic || { nodes: [], edges: [] } });
    editor._normalizeGrid = region => region;
    editor._buildWorldIndex = () => ({});
    editor._buildDraftIndex = () => ({ getEntry: () => null });
    editor._commitDraftState = () => {};
    editor._syncLogicEditor = () => {};
    editor._populateRegionSelect = () => {};
    editor._syncRegionControls = () => {};
    editor._render = () => {};
    editor._showToast = () => {};
    return { editor, patches };
  }

  it('有 worldLogic 时同一次保存提交 worldMap + worldLogic', async () => {
    const { editor, patches } = makeMapEditor(makeProject({ withLogic: true }));
    editor.logicEditor.moveNode('n.a', { x: 320, y: 100 });
    const result = await editor.save();
    expect(result).toMatchObject({ ok: true, committed: true });
    expect(patches.map(item => item.path)).toEqual(['worldMap', 'worldLogic']);
    expect(patches[1].value.nodes.find(node => node.id === 'n.a').position).toEqual({ x: 320, y: 100 });
  });

  it('旧工程无 worldLogic 且未改逻辑时不凭空写入', async () => {
    const { editor, patches } = makeMapEditor(makeProject({ withLogic: false }));
    await editor.save();
    expect(patches.map(item => item.path)).toEqual(['worldMap']);
  });
});

function makeDiffFixture() {
  const manual = {
    nodes: [
      {
        id: 'city.a', kind: 'city', name: '甲城',
        position: { x: 100, y: 100 }, ownerFactionId: 'han_government', level: 1
      },
      { id: 'bridge.b', kind: 'bridge', name: '乙桥', position: { x: 800, y: 100 } }
    ],
    edges: [{ id: 'e1', from: 'city.a', to: 'bridge.b', mode: 'road', cost: 2 }]
  };
  const auto = {
    revision: 3,
    nodes: [
      {
        id: 'city.a', kind: 'city', name: '甲城',
        position: { x: 100, y: 100 }, ownerFactionId: 'yellow_turban', level: 2
      },
      { id: 'ferry.c', kind: 'ferry', name: '丙渡', position: { x: 1500, y: 100 } }
    ],
    edges: [{ id: 'auto.e1', from: 'city.a', to: 'ferry.c', mode: 'ferry', cost: 3 }]
  };
  return { manual, auto };
}

function makeDiffEditor({ manual, auto, autoLayerProvider = null, sceneResolver = null, openScene = null } = {}) {
  const toolbarHost = document.createElement('div');
  const panelHost = document.createElement('div');
  const diffHost = document.createElement('div');
  const editor = new WorldLogicEditor({
    toolbarHost,
    panelHost,
    diffHost,
    logic: manual,
    autoLayer: auto,
    autoLayerProvider,
    sceneResolver,
    openScene,
    factions: ['han_government', 'yellow_turban'],
    moverFactionId: 'yellow_turban'
  });
  return { editor, toolbarHost, panelHost, diffHost };
}

describe('WorldLogicEditor · 差异面板（auto vs manual）', () => {
  it('三类差异分开列，并排显示自动值 / 人工值', () => {
    const { manual, auto } = makeDiffFixture();
    const { editor, diffHost } = makeDiffEditor({ manual, auto });
    editor.toggleDiff(true);
    const text = diffHost.textContent;
    expect(text).toContain('新增待确认');
    expect(text).toContain('地图上没了');
    expect(text).toContain('两边都有但不一致');
    expect(text).toContain('自动值');
    expect(text).toContain('人工值');
    expect(text).toContain('yellow_turban');
    expect(text).toContain('han_government');
    expect(editor.getDiff().counts).toMatchObject({ autoOnly: 2, manualOnly: 2, changed: 1 });
  });

  it('采纳 autoOnly 节点写人工层并触发 onChange', () => {
    const { manual, auto } = makeDiffFixture();
    let changed = 0;
    const { editor, diffHost } = makeDiffEditor({ manual, auto });
    editor.onChange = () => { changed += 1; };
    editor.toggleDiff(true);
    diffHost.querySelector('[data-diff-action="adopt"][data-diff-key="node:auto:ferry.c"]').click();
    const added = editor.getLogic().nodes.find(node => node.id === 'ferry.c');
    expect(added).toMatchObject({ source: 'manual', autoRevision: 3 });
    expect(changed).toBe(1);
  });

  it('端点未采纳时采纳 autoOnly 边被拒绝并提示', () => {
    const { manual, auto } = makeDiffFixture();
    const { editor, diffHost } = makeDiffEditor({ manual, auto });
    editor.toggleDiff(true);
    diffHost.querySelector('[data-diff-action="adopt"][data-diff-key="edge:auto:auto.e1"]').click();
    expect(editor.getLogic().edges.some(edge => edge.id === 'auto.e1')).toBe(false);
    expect(diffHost.textContent).toContain('还不在人工层');
  });

  it('全部采纳只处理单类：autoOnly 两条都进人工层，其它类保留', () => {
    const { manual, auto } = makeDiffFixture();
    const { editor } = makeDiffEditor({ manual, auto });
    const result = editor.adoptAllDiff('autoOnly');
    expect(result.applied.length).toBe(2);
    const logic = editor.getLogic();
    expect(logic.nodes.some(node => node.id === 'ferry.c')).toBe(true);
    expect(logic.edges.some(edge => edge.id === 'auto.e1')).toBe(true);
    expect(logic.nodes.some(node => node.id === 'bridge.b')).toBe(true);
    expect(logic.edges.some(edge => edge.id === 'e1')).toBe(true);
  });

  it('采纳 manualOnly 节点：级联删边并清空选中', () => {
    const { manual, auto } = makeDiffFixture();
    const { editor } = makeDiffEditor({ manual, auto });
    editor.selectNode('bridge.b');
    const result = editor.adoptDiffEntry('node:manual:bridge.b');
    expect(result.ok).toBe(true);
    const logic = editor.getLogic();
    expect(logic.nodes.some(node => node.id === 'bridge.b')).toBe(false);
    expect(logic.edges.some(edge => edge.id === 'e1')).toBe(false);
  });

  it('保留人工 / 忽略只隐藏本次差异，不改数据', () => {
    const { manual, auto } = makeDiffFixture();
    const { editor } = makeDiffEditor({ manual, auto });
    const before = JSON.stringify(editor.getLogic());
    expect(editor.keepManualDiff('node:auto:ferry.c')).toBe(true);
    expect(editor.ignoreDiff('node:manual:bridge.b')).toBe(true);
    expect(editor.getDiff().categories.autoOnly.some(entry => entry.key === 'node:auto:ferry.c')).toBe(false);
    expect(editor.getDiff().categories.manualOnly.some(entry => entry.key === 'node:manual:bridge.b')).toBe(false);
    expect(JSON.stringify(editor.getLogic())).toBe(before);
  });

  it('重抽只重建自动层：摘要新增/消失，人工层不变', () => {
    const { manual, auto } = makeDiffFixture();
    const nextAuto = {
      revision: 4,
      nodes: [
        auto.nodes[0],
        { id: 'ferry.d', kind: 'ferry', name: '丁渡', position: { x: 2000, y: 100 } }
      ],
      edges: []
    };
    const { editor } = makeDiffEditor({ manual, auto, autoLayerProvider: () => nextAuto });
    const before = JSON.stringify(editor.getLogic());
    const summary = editor.rebuildAutoLayer();
    expect(summary.added).toEqual(expect.arrayContaining(['node:ferry.d']));
    expect(summary.removed).toEqual(expect.arrayContaining(['node:ferry.c', 'edge:auto.e1']));
    expect(JSON.stringify(editor.getLogic())).toBe(before);
    expect(editor.getDiff().autoRevision).toBe(4);
  });

  it('去场景改对象：解析 sceneId 并交给 openScene', () => {
    const { manual, auto } = makeDiffFixture();
    const opened = [];
    const { editor } = makeDiffEditor({
      manual,
      auto,
      sceneResolver: node => (node.id === 'ferry.c' ? 'S12' : null),
      openScene: sceneId => opened.push(sceneId)
    });
    expect(editor.jumpToScene('node:auto:ferry.c')).toBe('S12');
    expect(opened).toEqual(['S12']);
  });

  it('保存只写人工层：auto 条目不会被 getLogic 带出', () => {
    const { manual, auto } = makeDiffFixture();
    const { editor } = makeDiffEditor({ manual, auto });
    const logic = editor.getLogic();
    expect(logic.nodes.some(node => node.id === 'ferry.c')).toBe(false);
    expect(logic.edges.some(edge => edge.id === 'auto.e1')).toBe(false);
  });
});

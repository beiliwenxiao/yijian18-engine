import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressionViewModel } from './ProgressionViewModel.js';
import { GraphViewport } from './GraphViewport.js';
import { ProgressionPanel } from './ProgressionPanel.js';
import { ProgressionGraphSystem } from '../../systems/progression/ProgressionGraphSystem.js';
import { GraphMode, PointPool } from '../../systems/progression/GraphDefinition.js';
import { ProgressionKind } from '../../systems/progression/ProgressionProfile.js';

function makeSkillGraph() {
  return {
    id: 'warrior-skill',
    mode: GraphMode.CLASS_SKILL,
    nodes: [
      {
        id: 'root', name: '基础', maxRank: 3, position: { x: 0, y: 0 },
        effects: [{ type: 'attribute.modify', target: 'attack', operation: 'add', value: 2 }]
      },
      { id: 'branch', name: '分支', prerequisites: ['root'], position: { x: 1, y: 0 } }
    ]
  };
}

function makeBoardGraph() {
  return {
    id: 'global-passive',
    mode: GraphMode.PASSIVE_BOARD,
    startNodes: ['s'],
    nodes: [
      { id: 's', name: '起点', kind: 'start', costs: { passive: 0 }, position: { x: 0, y: 0 } },
      { id: 'a', name: '甲', kind: 'minor', position: { x: 1, y: 0 } },
      { id: 'far', name: '远点', kind: 'minor', position: { x: 40, y: 40 } }
    ],
    edges: [['s', 'a'], ['a', 'far']]
  };
}

function makeSetup(profileConfig = { profile: 'arpg' }) {
  const system = new ProgressionGraphSystem({ profile: profileConfig });
  system.registerGraph(makeSkillGraph());
  system.registerGraph(makeBoardGraph());
  system.grantPoints('hero', PointPool.SKILL, 10);
  system.grantPoints('hero', PointPool.PASSIVE, 10);

  const viewModel = new ProgressionViewModel({ progressionSystem: system });
  viewModel.setCharacter({ id: 'hero', class: 'warrior', level: 10 });

  return { system, viewModel };
}

describe('ProgressionViewModel 页签与主结构', () => {
  it('页签按 Profile 顺序生成，主结构在首位', () => {
    const { viewModel } = makeSetup();
    const tabs = viewModel.getTabs();

    expect(tabs[0].kind).toBe(ProgressionKind.TALENT_TREE);
    expect(tabs[0].primary).toBe(true);
    expect(tabs).toHaveLength(4);
  });

  it('无对应图的页签标记为不可用', () => {
    const { viewModel } = makeSetup();
    const tabs = viewModel.getTabs();

    // 只注册了技能树与天赋盘
    expect(tabs.find(t => t.kind === ProgressionKind.SKILL_TREE).available).toBe(true);
    expect(tabs.find(t => t.kind === ProgressionKind.PASSIVE_BOARD).available).toBe(true);
    expect(tabs.find(t => t.kind === ProgressionKind.TALENT_TREE).available).toBe(false);
  });

  it('禁用结构不出现在页签中', () => {
    const { viewModel } = makeSetup({ profile: 'classicRpg' });
    const kinds = viewModel.getTabs().map(t => t.kind);
    expect(kinds).not.toContain(ProgressionKind.PASSIVE_BOARD);
  });

  it('页签展示对应池的可用点数', () => {
    const { viewModel } = makeSetup();
    const skillTab = viewModel.getTabs().find(t => t.kind === ProgressionKind.SKILL_TREE);
    expect(skillTab.availablePoints).toBe(10);
  });

  it('切换页签后图视图随之变化', () => {
    const { viewModel } = makeSetup();
    expect(viewModel.setActiveTab(ProgressionKind.SKILL_TREE)).toBe(true);
    expect(viewModel.getActiveGraphView().graphId).toBe('warrior-skill');

    viewModel.setActiveTab(ProgressionKind.PASSIVE_BOARD);
    expect(viewModel.getActiveGraphView().graphId).toBe('global-passive');
  });

  it('切换到未知页签失败', () => {
    const { viewModel } = makeSetup();
    expect(viewModel.setActiveTab('notAKind')).toBe(false);
  });
});

describe('ProgressionViewModel 命令与详情', () => {
  let system;
  let viewModel;

  beforeEach(() => {
    ({ system, viewModel } = makeSetup());
    viewModel.setActiveTab(ProgressionKind.SKILL_TREE);
  });

  it('通过 ViewModel 分配后系统状态变化', () => {
    expect(viewModel.allocate('root').ok).toBe(true);
    expect(system.getRank('hero', 'warrior-skill', 'root')).toBe(1);
  });

  it('分配失败时返回原因且不改变状态', () => {
    const result = viewModel.allocate('branch');
    expect(result.ok).toBe(false);
    expect(system.getRank('hero', 'warrior-skill', 'branch')).toBe(0);
  });

  it('撤销命令生效', () => {
    viewModel.allocate('root');
    expect(viewModel.deallocate('root').ok).toBe(true);
    expect(system.getRank('hero', 'warrior-skill', 'root')).toBe(0);
  });

  it('重置返还点数', () => {
    viewModel.allocate('root');
    viewModel.allocate('root');
    const result = viewModel.resetActiveGraph();
    expect(result.ok).toBe(true);
    expect(system.getLedger('hero').getAvailable(PointPool.SKILL)).toBe(10);
  });

  it('节点详情包含当前与下一级效果', () => {
    viewModel.allocate('root');
    const detail = viewModel.getNodeDetail('root');

    expect(detail.rank).toBe(1);
    expect(detail.currentEffects[0].value).toBe(2);
    expect(detail.nextEffects[0].value).toBe(4);
    expect(detail.canAllocate).toBe(true);
  });

  it('满级节点无下一级效果', () => {
    for (let i = 0; i < 3; i++) viewModel.allocate('root');
    const detail = viewModel.getNodeDetail('root');
    expect(detail.nextEffects).toBeNull();
    expect(detail.canAllocate).toBe(false);
  });

  it('未分配点数汇总供 HUD 使用', () => {
    expect(viewModel.hasPendingPoints()).toBe(true);
    const pending = viewModel.getPendingPoints();
    expect(pending.map(p => p.kind)).toContain(ProgressionKind.SKILL_TREE);
  });

  it('状态变化触发 onChange 回调', () => {
    let count = 0;
    viewModel.onChange = () => { count++; };
    viewModel.allocate('root');
    expect(count).toBe(1);
  });
});

describe('GraphViewport 缩放平移与裁剪', () => {
  let viewport;

  beforeEach(() => {
    viewport = new GraphViewport({ width: 400, height: 300, nodeSpacing: 50, nodeRadius: 10 });
  });

  it('缩放受上下限约束', () => {
    viewport.setScale(99);
    expect(viewport.scale).toBe(viewport.maxScale);
    viewport.setScale(0.01);
    expect(viewport.scale).toBe(viewport.minScale);
  });

  it('坐标换算可往返', () => {
    viewport.panBy(20, 30);
    viewport.setScale(1.5);

    const screen = viewport.toScreen({ x: 3, y: 2 });
    const graph = viewport.toGraph(screen.x, screen.y);
    expect(graph.x).toBeCloseTo(3, 5);
    expect(graph.y).toBeCloseTo(2, 5);
  });

  it('居中后节点位于视口中心', () => {
    viewport.centerOn({ x: 5, y: 5 });
    const screen = viewport.toScreen({ x: 5, y: 5 });
    expect(screen.x).toBeCloseTo(200, 5);
    expect(screen.y).toBeCloseTo(150, 5);
  });

  it('裁剪只返回可见节点', () => {
    const nodes = [
      { id: 'near', position: { x: 1, y: 1 } },
      { id: 'far', position: { x: 80, y: 80 } }
    ];
    const result = viewport.cull(nodes, [['near', 'far']]);

    expect(result.nodes.map(n => n.id)).toEqual(['near']);
    // 一端可见的连线仍绘制，避免边界断线
    expect(result.edges).toHaveLength(1);
  });

  it('视口状态未变时复用裁剪缓存', () => {
    const nodes = [{ id: 'a', position: { x: 1, y: 1 } }];
    const first = viewport.cull(nodes, []);
    expect(viewport.cull(nodes, [])).toBe(first);

    viewport.panBy(10, 0);
    expect(viewport.cull(nodes, [])).not.toBe(first);
  });

  it('fitToNodes 使全部节点可见', () => {
    // 注意：fit 受 minScale=0.5 钳制，跨度太大会无法完整放下，这里用可容纳的跨度验证 fit 行为
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'b', position: { x: 5, y: 3 } }
    ];
    viewport.fitToNodes(nodes);
    for (const node of nodes) {
      expect(viewport.isVisible(node.position), `${node.id} 不可见`).toBe(true);
    }
  });

  it('命中测试返回半径内的节点', () => {
    const nodes = [{ id: 'a', position: { x: 2, y: 2 } }];
    const screen = viewport.toScreen(nodes[0].position);

    expect(viewport.hitTest(nodes, screen.x, screen.y).id).toBe('a');
    expect(viewport.hitTest(nodes, screen.x + 200, screen.y)).toBeNull();
  });

  it('视口状态可序列化恢复', () => {
    viewport.setScale(1.3);
    viewport.panBy(15, 25);
    const saved = viewport.serialize();

    const restored = new GraphViewport({ width: 400, height: 300 });
    restored.deserialize(saved);
    expect(restored.serialize()).toEqual(saved);
  });
});

describe('ProgressionPanel 交互', () => {
  let system;
  let viewModel;
  let panel;

  beforeEach(() => {
    ({ system, viewModel } = makeSetup());
    panel = new ProgressionPanel({ viewModel, x: 0, y: 0, width: 800, height: 560 });
    panel.show();
    panel.switchTab(ProgressionKind.SKILL_TREE);
  });

  it('默认隐藏，show 后可见', () => {
    const fresh = new ProgressionPanel({ viewModel });
    expect(fresh.visible).toBe(false);
    fresh.show();
    expect(fresh.visible).toBe(true);
  });

  it('页签数量与 Profile 一致', () => {
    expect(panel.getTabRects()).toHaveLength(4);
  });

  it('点击页签切换当前结构', () => {
    const boardTab = panel.getTabRects().find(r => r.kind === ProgressionKind.PASSIVE_BOARD);
    const handled = panel.handleClick(boardTab.x + 5, boardTab.y + 5);

    expect(handled).toBe(true);
    expect(viewModel.activeTab).toBe(ProgressionKind.PASSIVE_BOARD);
  });

  it('点击不可用页签给出提示且不切换', () => {
    const talentTab = panel.getTabRects().find(r => r.kind === ProgressionKind.TALENT_TREE);
    panel.handleClick(talentTab.x + 5, talentTab.y + 5);

    expect(viewModel.activeTab).toBe(ProgressionKind.SKILL_TREE);
    expect(panel.statusMessage).toContain('不可用');
  });

  it('点击节点提交分配', () => {
    const view = viewModel.getActiveGraphView();
    const node = view.nodes.find(n => n.id === 'root');
    const rect = panel.getViewportRect();
    const screen = panel.viewport.toScreen(node.position);

    const handled = panel.handleClick(rect.x + screen.x, rect.y + screen.y);
    expect(handled).toBe(true);
    expect(system.getRank('hero', 'warrior-skill', 'root')).toBe(1);
  });

  it('右键点击节点撤销', () => {
    viewModel.allocate('root');

    const node = viewModel.getActiveGraphView().nodes.find(n => n.id === 'root');
    const rect = panel.getViewportRect();
    const screen = panel.viewport.toScreen(node.position);

    panel.handleClick(rect.x + screen.x, rect.y + screen.y, 'right');
    expect(system.getRank('hero', 'warrior-skill', 'root')).toBe(0);
  });

  it('移动端需要二次确认才投入', () => {
    const mobile = new ProgressionPanel({ viewModel, isMobile: true, x: 0, y: 0 });
    mobile.show();
    mobile.switchTab(ProgressionKind.SKILL_TREE);

    const node = viewModel.getActiveGraphView().nodes.find(n => n.id === 'root');
    const rect = mobile.getViewportRect();
    const screen = mobile.viewport.toScreen(node.position);

    mobile.handleClick(rect.x + screen.x, rect.y + screen.y);
    expect(system.getRank('hero', 'warrior-skill', 'root')).toBe(0);
    expect(mobile.statusMessage).toContain('确认');

    mobile.handleClick(rect.x + screen.x, rect.y + screen.y);
    expect(system.getRank('hero', 'warrior-skill', 'root')).toBe(1);
  });

  it('点击重置按钮清空当前页', () => {
    viewModel.allocate('root');
    const reset = panel._getResetButtonRect();
    panel.handleClick(reset.x + 5, reset.y + 5);

    expect(system.getRank('hero', 'warrior-skill', 'root')).toBe(0);
    expect(panel.statusMessage).toContain('重置');
  });

  it('面板范围外的点击不被消费', () => {
    expect(panel.handleClick(-50, -50)).toBe(false);
  });

  it('面板内空白点击仍被消费，避免穿透', () => {
    const rect = panel.getViewportRect();
    expect(panel.handleClick(rect.x + rect.width - 2, rect.y + rect.height - 2)).toBe(true);
  });

  it('拖拽平移视口并标记发生移动', () => {
    const rect = panel.getViewportRect();
    expect(panel.beginDrag(rect.x + 10, rect.y + 10)).toBe(true);

    const before = panel.viewport.offsetX;
    panel.handleMouseMove(rect.x + 60, rect.y + 10);
    expect(panel.viewport.offsetX).not.toBe(before);
    expect(panel.endDrag()).toBe(true);
  });

  it('搜索与聚焦节点', () => {
    panel.switchTab(ProgressionKind.PASSIVE_BOARD);
    const found = panel.searchNodes('远');
    expect(found.map(n => n.id)).toContain('far');

    expect(panel.focusNode('far')).toBe(true);
    expect(panel.viewport.isVisible({ x: 40, y: 40 })).toBe(true);
  });

  it('渲染不抛出异常', () => {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, prop) => {
        if (prop === 'canvas') return { width: 800, height: 600 };
        return (...args) => { calls.push(prop); return undefined; };
      },
      set: () => true
    });

    expect(() => panel.render(ctx)).not.toThrow();
    expect(calls).toContain('fillRect');
  });
});

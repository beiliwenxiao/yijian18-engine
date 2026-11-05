/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 ************************************************************/

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SceneEditorEventFilter } from './SceneEditorEventFilter.js';

function sceneData() {
  return {
    id: 'S02',
    layers: [
      { id: 'layer_bg', name: '背景层', objects: [{ type: 'image', id: 'bg-1', name: '地面' }] },
      {
        id: 'layer_deco', name: '装饰层', objects: [
          { type: 'shape', id: 'zone-a', name: '施粥区' },
          { type: 'deco', id: 'tree-1', name: '树' }
        ]
      },
      {
        id: 'layer_entity', name: '实体层', objects: [
          { type: 'ref', id: 'pot-1', name: '施粥大锅', group: 'g-porridge' },
          { type: 'ref', id: 'villager-1', name: '村民', group: 'g-porridge' },
          { type: 'ref', id: 'wolf-1', name: '狼', group: 'g-raid' }
        ]
      },
      {
        id: 'layer_logic', name: '逻辑对象', objects: [
          { type: 'trigger', id: 'bind-a', name: '施粥入口', triggerId: 'trg.a', target: 'zone-a', targetMode: 'id', event: 'enter' },
          { type: 'trigger', id: 'bind-b', name: '狼群刷新', triggerId: 'trg.b', target: 'wolf-1', targetMode: 'id', event: 'sceneEnter' }
        ]
      }
    ]
  };
}

function project() {
  return {
    triggers: [
      {
        id: 'trg.a', name: '施粥', when: { type: 'enter' }, do: [
          { action: 'spawnPlacements', params: { selector: { group: 'g-porridge' } } },
          { action: 'state.transaction', params: { definitionId: 'story.porridge.laid' } }
        ]
      },
      {
        id: 'trg.b', name: '狼群', when: { type: 'sceneEnter' }, do: [
          { action: 'state.transaction', params: { definitionId: 'story.camp.laid' } }
        ]
      }
    ],
    quests: [
      {
        id: 'task.porridge', title: '施粥赈济', category: 'main', scenes: ['S02'], steps: [
          { id: 'porridge', type: 'objective', target: 'story.porridge.laid', title: '支锅施粥' }
        ]
      },
      {
        id: 'task.camp', title: '安营扎寨', category: 'main', scenes: ['S02'], steps: [
          { id: 'camp', type: 'objective', target: 'story.camp.laid', title: '指挥扎营' }
        ]
      }
    ]
  };
}

function buildFilter({ withQuests = true } = {}) {
  const definitions = project();
  if (!withQuests) delete definitions.quests;
  const editor = {
    sceneData: sceneData(),
    getProjectDefinitions: () => definitions,
    selectedObjects: [],
    interaction: {},
    render: () => {},
    layers: { updateLayerList: () => {} },
    ui: { updateObjectProperties: () => {} },
    options: {}
  };
  const filter = new SceneEditorEventFilter(editor);
  filter.rebuild({ preserveSelection: false });
  return filter;
}

const idsOf = objects => new Set([...objects].map(object => object.id));

describe('SceneEditorEventFilter 聚焦/隔离视图', () => {
  it('无聚焦时全场景可见，不压暗', () => {
    const filter = buildFilter();
    expect(filter.visibleObjects).toBeNull();
    expect(filter.dimmedObjects).toBeNull();
    expect(filter.isFiltering()).toBe(false);
  });

  it('selectTrigger 单独聚焦：dim 档全量可见，闭包外压暗，背景层豁免', () => {
    const filter = buildFilter();
    filter.selectTrigger('trg.a');
    // dim 档：全部对象保持可见（可交互），仅渲染压暗
    const allIds = idsOf(filter.sceneData.layers.flatMap(layer => layer.objects));
    expect(idsOf(filter.visibleObjects)).toEqual(allIds);
    const dimmed = idsOf(filter.dimmedObjects);
    expect(dimmed.has('tree-1')).toBe(true);
    expect(dimmed.has('wolf-1')).toBe(true);
    expect(dimmed.has('bind-b')).toBe(true);
    // 参与对象不压暗：binding 目标 + group selector 闭包
    expect(dimmed.has('zone-a')).toBe(false);
    expect(dimmed.has('pot-1')).toBe(false);
    expect(dimmed.has('villager-1')).toBe(false);
    expect(dimmed.has('bind-a')).toBe(false);
    // 背景层永远不压暗（空间定位锚点）
    expect(dimmed.has('bg-1')).toBe(false);
    expect(filter.highlightObjects.size).toBe(4); // zone-a + pot-1 + villager-1 + bind-a
  });

  it('isolate 档：只显示关联闭包与背景层，其余隐藏且不压暗', () => {
    const filter = buildFilter();
    filter.setFocusLevel('isolate');
    filter.selectTrigger('trg.a');
    const visible = idsOf(filter.visibleObjects);
    expect(visible.has('zone-a')).toBe(true);
    expect(visible.has('pot-1')).toBe(true);
    expect(visible.has('villager-1')).toBe(true);
    expect(visible.has('bind-a')).toBe(true);
    expect(visible.has('bg-1')).toBe(true);
    expect(visible.has('tree-1')).toBe(false);
    expect(visible.has('wolf-1')).toBe(false);
    expect(visible.has('bind-b')).toBe(false);
    expect(filter.dimmedObjects).toBeNull();
  });

  it('toggleTriggerFocus 多选并集：两个流程的参与对象同时高亮', () => {
    const filter = buildFilter();
    filter.toggleTriggerFocus('trg.a', true);
    filter.toggleTriggerFocus('trg.b', true);
    expect([...filter.state.focusedTriggerIds].sort()).toEqual(['trg.a', 'trg.b']);
    const dimmed = idsOf(filter.dimmedObjects);
    expect(dimmed.has('pot-1')).toBe(false);
    expect(dimmed.has('villager-1')).toBe(false);
    expect(dimmed.has('wolf-1')).toBe(false);
    expect(dimmed.has('bind-a')).toBe(false);
    expect(dimmed.has('bind-b')).toBe(false);
    expect(dimmed.has('tree-1')).toBe(true);
  });

  it('取消全部聚焦勾选后恢复全显', () => {
    const filter = buildFilter();
    filter.toggleTriggerFocus('trg.a', true);
    filter.toggleTriggerFocus('trg.a', false);
    expect(filter.state.focusedTriggerIds.size).toBe(0);
    expect(filter.visibleObjects).toBeNull();
    expect(filter.dimmedObjects).toBeNull();
  });

  it('selectQuest 聚焦整个任务的参与对象并集', () => {
    const filter = buildFilter();
    filter.selectQuest('task.camp');
    expect([...filter.state.focusedTriggerIds]).toEqual(['trg.b']);
    const dimmed = idsOf(filter.dimmedObjects);
    expect(dimmed.has('wolf-1')).toBe(false);
    expect(dimmed.has('pot-1')).toBe(true);
  });

  it('选中对象永不压暗', () => {
    const filter = buildFilter();
    const tree = filter.sceneData.layers[1].objects[1];
    filter.editor.selectedObjects = [tree];
    filter.selectTrigger('trg.a');
    expect(filter.isObjectDimmed(tree)).toBe(false);
  });

  it('标记显隐（无聚焦）保持旧行为：仅隐藏指定 binding 标记', () => {
    const filter = buildFilter();
    filter.setEventVisible('bind-a', false);
    const visible = idsOf(filter.visibleObjects);
    expect(visible.has('bind-a')).toBe(false);
    expect(visible.has('pot-1')).toBe(true);
    expect(visible.has('zone-a')).toBe(true);
    expect(filter.dimmedObjects).toBeNull();
  });

  it('禁用 binding：标记隐藏，但流程参与闭包由 Trigger 定义决定', () => {
    const filter = buildFilter();
    filter.events.find(event => event.id === 'bind-a').binding.enabled = false;
    filter.selectTrigger('trg.a');
    const visible = idsOf(filter.visibleObjects);
    expect(visible.has('bind-a')).toBe(false); // 禁用 binding 标记不显示
    const dimmed = idsOf(filter.dimmedObjects);
    expect(dimmed.has('pot-1')).toBe(false); // 动作 selector 闭包不受 binding 禁用影响
    expect(dimmed.has('villager-1')).toBe(false);
  });
});

describe('SceneEditorEventFilter 任务分组投影', () => {
  it('按 quest step 事实归属 Trigger，形成任务分组', () => {
    const filter = buildFilter();
    expect(filter.questGroups.map(group => group.id)).toEqual(['task.porridge', 'task.camp']);
    const porridge = filter.questGroups[0];
    expect(porridge.title).toBe('施粥赈济');
    expect(porridge.steps[0].title).toBe('支锅施粥');
    expect(porridge.steps[0].triggerIds).toEqual(['trg.a']);
    expect(filter.questByTriggerId.get('trg.a')?.questTitle).toBe('施粥赈济');
    expect(filter.questByTriggerId.get('trg.b')?.questTitle).toBe('安营扎寨');
  });

  it('无 quests 定义时优雅退化为扁平列表', () => {
    const filter = buildFilter({ withQuests: false });
    expect(filter.questGroups).toEqual([]);
    expect(filter.questByTriggerId.size).toBe(0);
    expect(filter.state.focusedTriggerIds.size).toBe(0);
    filter.selectTrigger('trg.a');
    expect(filter.state.focusedTriggerIds.has('trg.a')).toBe(true);
  });
});

describe('SceneEditorEventFilter 反向查询', () => {
  it('group selector 参与对象可反查到流程', () => {
    const filter = buildFilter();
    const pot = filter.sceneData.layers[2].objects[0];
    const flows = filter.getFlowsForObject(pot);
    expect(flows).toHaveLength(1);
    expect(flows[0].triggerId).toBe('trg.a');
    expect(flows[0].enabled).toBe(true);
  });

  it('binding 直接目标可反查，无关对象返回空', () => {
    const filter = buildFilter();
    const zone = filter.sceneData.layers[1].objects[0];
    expect(filter.getFlowsForObject(zone).map(flow => flow.triggerId)).toEqual(['trg.a']);
    const bg = filter.sceneData.layers[0].objects[0];
    expect(filter.getFlowsForObject(bg)).toEqual([]);
  });

  it('反向查询结果带任务标注', () => {
    const filter = buildFilter();
    const wolf = filter.sceneData.layers[2].objects[2];
    const flows = filter.getFlowsForObject(wolf);
    expect(flows[0].quest?.questId).toBe('task.camp');
    expect(flows[0].quest?.stepTitle).toBe('指挥扎营');
  });
});

describe('SceneEditorEventFilter 流程条 UI（renderBar/bindUI）', () => {
  function mountBar(filter) {
    document.body.innerHTML = '<div id="editor-scene-event-filter"></div>';
    filter.bindUI();
    return document.getElementById('editor-scene-event-filter');
  }

  it('有任务定义时渲染任务分组头 + Trigger 聚焦勾选 + 压暗/隔离档位', () => {
    const filter = buildFilter();
    const bar = mountBar(filter);
    const questHeaders = [...bar.querySelectorAll('button[data-filter-mode="quest"]')];
    expect(questHeaders.map(button => button.textContent)).toEqual([
      '任务 · 施粥赈济 · 1流程',
      '任务 · 安营扎寨 · 1流程'
    ]);
    expect(bar.querySelectorAll('input[data-trigger-focus]').length).toBe(2);
    expect(bar.querySelectorAll('button[data-focus-level="dim"]').length).toBe(1);
    expect(bar.querySelectorAll('button[data-focus-level="isolate"]').length).toBe(1);
  });

  it('点击任务头聚焦该任务全部参与对象，状态栏显示聚焦信息', () => {
    const filter = buildFilter();
    const bar = mountBar(filter);
    bar.querySelector('button[data-filter-mode="quest"][data-quest-id="task.camp"]').click();
    expect([...filter.state.focusedTriggerIds]).toEqual(['trg.b']);
    expect(filter.statusFocusText?.() ?? bar.querySelector('.scene-event-filter-status').textContent)
      .toContain('聚焦1流程');
    const dimmed = idsOf(filter.dimmedObjects);
    expect(dimmed.has('pot-1')).toBe(true);
    expect(dimmed.has('wolf-1')).toBe(false);
  });

  it('勾选 Trigger 聚焦框纳入并集；切隔离档后无关对象隐藏', () => {
    const filter = buildFilter();
    const bar = mountBar(filter);
    bar.querySelector('input[data-trigger-focus="trg.a"]').checked = true;
    bar.querySelector('input[data-trigger-focus="trg.a"]').dispatchEvent(new Event('change', { bubbles: true }));
    expect([...filter.state.focusedTriggerIds]).toEqual(['trg.a']);
    bar.querySelector('button[data-focus-level="isolate"]').click();
    expect(filter.state.focusLevel).toBe('isolate');
    const visible = idsOf(filter.visibleObjects);
    expect(visible.has('pot-1')).toBe(true);
    expect(visible.has('tree-1')).toBe(false);
  });

  it('无任务定义时退化为扁平列表且功能可用', () => {
    const filter = buildFilter({ withQuests: false });
    const bar = mountBar(filter);
    expect(bar.querySelectorAll('.scene-event-filter-quest-header').length).toBe(0);
    expect(bar.querySelectorAll('input[data-trigger-focus]').length).toBe(2);
    bar.querySelector('button[data-filter-mode="trigger"][data-trigger-id="trg.a"]').click();
    expect(filter.state.focusedTriggerIds.has('trg.a')).toBe(true);
    expect(filter.state.focusLevel).toBe('dim');
  });
});

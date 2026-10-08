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

// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TriggerInteractionPanel } from './TriggerInteractionPanel.js';

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildEditor(project) {
  return {
    project,
    getSceneList: () => [{ id: 'S01', name: '荒原' }],
    projectIndex: {
      getBindingsForTrigger: triggerId => ({
        'trg_campfire': [{ sceneId: 'S01', binding: { id: 'bind-1', prompt: '点燃篝火' } }]
      })[triggerId] || []
    },
    _escapeHtml: escapeHtml,
    _status: () => {},
    selectById: vi.fn(),
    _nextStableId: (base, definitionList) => {
      const ids = new Set((definitionList || []).map(item => item?.id).filter(Boolean));
      let sequence = 1;
      let candidate = '';
      do candidate = `${base}-${String(sequence++).padStart(3, '0')}`;
      while (ids.has(candidate));
      return candidate;
    }
  };
}

const baseProject = () => ({
  // 目录补 operations：行内「动作+操作」下拉依赖 TriggerCatalog 的 operations
  triggerCatalog: {
    actions: [{
      id: 'task.command',
      label: '任务命令',
      operations: [{ id: 'task.start', label: '接取任务' }, { id: 'task.complete', label: '完成目标' }]
    }]
  },
  triggers: [
    {
      id: 'trg_campfire',
      name: '点燃篝火',
      when: { type: 'interact', params: {} },
      once: true,
      do: [{ action: 's01Survival', params: { operation: 'campfireLit' }, stepId: 's1' }]
    },
    {
      id: 'trg_scene_enter',
      name: '进入场景装配',
      when: { type: 'sceneEnter', params: { sceneId: 'S01' } },
      do: []
    }
  ]
});

describe('TriggerInteractionPanel 交互注册表', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('ti-panel-styles')?.remove();
    vi.restoreAllMocks();
  });

  it('只聚合 interact 触发器并按场景分组；绑定 prompt 作为交互点显示', () => {
    const panel = document.createElement('div');
    new TriggerInteractionPanel(buildEditor(baseProject())).render(panel);
    const html = panel.innerHTML;
    expect(html).toContain('交互注册表');
    expect(html).toContain('trg_campfire');
    expect(html).toContain('点燃篝火');
    expect(html).toContain('荒原（S01）');
    // 非交互触发器不进视图
    expect(html).not.toContain('trg_scene_enter');
    // 交互点来自空间绑定的 prompt
    expect(panel.querySelector('.ti-point').textContent).toContain('点燃篝火');
  });

  it('无绑定时按 editorScope 归组，无任何归属显示未绑定', () => {
    const project = baseProject();
    project.triggers[0].id = 'trg_scoped';
    project.triggers[0].editorScope = { sceneIds: ['S01'] };
    project.triggers[1] = { id: 'trg_free', name: '游离', when: { type: 'interact', params: {} }, do: [] };
    const panel = document.createElement('div');
    new TriggerInteractionPanel(buildEditor(project)).render(panel);
    const html = panel.innerHTML;
    expect(html).toContain('荒原（S01）');
    expect(html).toContain('（未绑定场景）');
    expect(panel.querySelector('[data-trigger="trg_free"] .ti-point').textContent).toContain('未绑定交互点');
  });

  it('新增交互：写 when/interact 结构与 editorScope 场景归属，数据格式不变', () => {
    const editor = buildEditor(baseProject());
    const panel = document.createElement('div');
    new TriggerInteractionPanel(editor).render(panel);
    panel.querySelector('.ti-new-scene').value = 'S01';
    panel.querySelector('.ti-new-scene').dispatchEvent(new Event('change'));
    panel.querySelector('.ti-add').click();
    expect(editor.project.triggers).toHaveLength(3);
    const created = editor.project.triggers[2];
    expect(created.id).toBe('trg-interact-001');
    expect(created.when).toEqual({ type: 'interact', params: {} });
    expect(created.editorScope).toEqual({ sceneIds: ['S01'] });
    expect(created.do).toEqual([]);
  });

  it('动作链行内编辑：选动作+操作追加 do 步骤，切换操作与删除写回', () => {
    const editor = buildEditor(baseProject());
    const panel = document.createElement('div');
    new TriggerInteractionPanel(editor).render(panel);
    // 追加一个动作（每次改动后面板会重渲染，必须重新查询 DOM）
    let row = panel.querySelector('[data-trigger="trg_campfire"]');
    row.querySelector('.ti-add-action').value = 'task.command';
    row.querySelector('.ti-add-action').dispatchEvent(new Event('change'));
    row.querySelector('.ti-add-operation').value = 'task.start';
    row.querySelector('.ti-add-operation').dispatchEvent(new Event('change'));
    const trigger = editor.project.triggers[0];
    expect(trigger.do).toHaveLength(2);
    expect(trigger.do[1]).toMatchObject({ action: 'task.command', params: { operation: 'task.start' } });
    expect(trigger.do[1].stepId).toBe('trg_campfire-step-001'); // 已有步骤 stepId=s1 不占该前缀序号
    // 切换既有步骤的操作
    row = panel.querySelector('[data-trigger="trg_campfire"]');
    let stepRow = row.querySelector('.ti-step[data-step-index="1"]');
    stepRow.querySelector('.ti-step-operation').value = 'task.complete';
    stepRow.querySelector('.ti-step-operation').dispatchEvent(new Event('change'));
    expect(trigger.do[1].params.operation).toBe('task.complete');
    // 上移 + 删除
    row = panel.querySelector('[data-trigger="trg_campfire"]');
    stepRow = row.querySelector('.ti-step[data-step-index="1"]');
    stepRow.querySelector('.ti-step-up').click();
    expect(trigger.do[0].action).toBe('task.command');
    row = panel.querySelector('[data-trigger="trg_campfire"]');
    row.querySelector('.ti-step[data-step-index="0"] .ti-step-del').click();
    expect(trigger.do).toHaveLength(1);
    expect(trigger.do[0].action).toBe('s01Survival');
  });

  it('名称与 once 写回；详细编辑跳转规则编辑；删除从 triggers 移除', () => {
    const editor = buildEditor(baseProject());
    vi.stubGlobal('confirm', () => true);
    const panel = document.createElement('div');
    new TriggerInteractionPanel(editor).render(panel);
    const row = panel.querySelector('[data-trigger="trg_campfire"]');
    row.querySelector('.ti-name').value = '点燃第一堆篝火';
    row.querySelector('.ti-name').dispatchEvent(new Event('change'));
    expect(editor.project.triggers[0].name).toBe('点燃第一堆篝火');

    // 重渲染后：取消 once / 跳转 / 删除
    const fresh = document.createElement('div');
    new TriggerInteractionPanel(editor).render(fresh);
    const onceRow = fresh.querySelector('[data-trigger="trg_campfire"]');
    onceRow.querySelector('.ti-once-cb').checked = false;
    onceRow.querySelector('.ti-once-cb').dispatchEvent(new Event('change'));
    expect(editor.project.triggers[0].once).toBeUndefined();

    const fresh2 = document.createElement('div');
    new TriggerInteractionPanel(editor).render(fresh2);
    fresh2.querySelector('[data-trigger="trg_campfire"] .ti-edit').click();
    expect(editor.selectById).toHaveBeenCalledWith('trg_campfire', 'triggers');

    fresh2.querySelector('[data-trigger="trg_campfire"] .ti-del').click();
    expect(editor.project.triggers.some(item => item.id === 'trg_campfire')).toBe(false);
  });

  it('含分支步骤的交互触发器锁定行内编辑（保护数据结构）', () => {
    const project = baseProject();
    project.triggers[0].do = [{ stepId: 's1', branch: [{ when: null, do: [] }] }];
    const panel = document.createElement('div');
    new TriggerInteractionPanel(project && buildEditor(project)).render(panel);
    const row = panel.querySelector('[data-trigger="trg_campfire"]');
    expect(row.querySelector('.ti-locked')).toBeTruthy();
    expect(row.querySelector('.ti-add-action')).toBeNull();
    expect(row.querySelector('.ti-step-action')).toBeNull();
  });
});

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
import { beforeEach, describe, expect, it } from 'vitest';
import { TriggerEditor } from './TriggerEditor.js';

function buildEditor(project = null) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="trg-root">
      <div class="trg-target-tabs" id="trg-target-tabs"></div>
      <div class="trg-toolbar">
        <select id="trg-filter-enabled"><option value="">全部状态</option></select>
        <select id="trg-filter-scene"><option value="">全部场景关联</option></select>
        <select id="trg-filter-event"><option value="">全部 Trigger</option></select>
        <select id="trg-filter-when"><option value="">全部时机</option></select>
        <select id="trg-filter-do"><option value="">全部动作</option></select>
        <button id="trg-add">+ 新增</button>
        <button id="trg-del">删除</button>
        <button id="trg-fg-debug">执行轨迹</button>
        <button id="trg-save">保存</button>
      </div>
      <div class="trg-association-summary" id="trg-association-summary"></div>
      <div class="trg-main">
        <div class="trg-list" id="trg-list"></div>
        <div class="trg-detail" id="trg-detail"></div>
      </div>
      <div class="trg-status" id="trg-status"></div>
    </div>`;
  document.body.appendChild(container);
  const editor = new TriggerEditor(container, { gameId: 'test-game' });
  editor.project = project || { triggers: [], tutorials: [] };
  editor.triggers = editor.project.triggers;
  editor.target = 'triggers';
  editor._initialized = true;
  editor._renderDetail = editor._renderDetail.bind(editor);
  editor._commitDetail = editor._commitDetail.bind(editor);
  return editor;
}

describe('TriggerEditor 步骤级 if 可视化编辑器', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('渲染条件表单：无条件时折叠、有条件时展开并显示摘要', () => {
    const project = {
      triggers: [{
        id: 'trg-1',
        when: { type: 'signal', params: {} },
        do: [
          { action: 'setVar', params: { key: 'x', value: 1 }, stepId: 's1' },
          { action: 'setVar', params: { key: 'y', value: 2 }, stepId: 's2', if: { op: '==', var: 'hp', value: 0 } }
        ]
      }],
      tutorials: []
    };
    const editor = buildEditor(project);
    editor.selectedIndex = 0;
    editor._renderDetail();
    const details = document.querySelectorAll('.do-step-if');
    expect(details.length).toBe(2);
    expect(details[0].open).toBe(false);
    expect(details[0].textContent).toContain('（无条件，总是执行）');
    expect(details[1].open).toBe(true);
    expect(details[1].textContent).toContain('==');
    expect(details[1].textContent).toContain('hp');
  });

  it('表单变更即时同步到隐藏 JSON textarea，commit 后写回 act.if', () => {
    const project = {
      triggers: [{
        id: 'trg-1',
        when: { type: 'signal', params: {} },
        do: [{ action: 'setVar', params: { key: 'x', value: 1 }, stepId: 's1' }]
      }],
      tutorials: []
    };
    const editor = buildEditor(project);
    editor.selectedIndex = 0;
    editor._renderDetail();
    // 页面有多个 .do-cond-form（trigger 级 if / 分支 when / 步骤 if），必须定位步骤 if 的表单
    const form = document.querySelector('.do-step-if .do-cond-form');
    const opSelect = form.querySelector('.do-if-op');
    const varInput = form.querySelector('.do-if-var');
    const valueInput = form.querySelector('.do-if-value');
    const textarea = form.querySelector('.do-step-if-input');
    opSelect.value = '==';
    varInput.value = 'story.done';
    valueInput.value = 'true';
    opSelect.dispatchEvent(new Event('change'));
    valueInput.dispatchEvent(new Event('change'));
    expect(textarea.value).toBe('{"op":"==","var":"story.done","value":true}');
    editor._commitDetail();
    expect(editor.project.triggers[0].do[0].if).toEqual({ op: '==', var: 'story.done', value: true });
  });

  it('hasItem 操作切换显示物品/数量字段，隐藏变量/值字段', () => {
    const project = {
      triggers: [{
        id: 'trg-1',
        when: { type: 'signal', params: {} },
        do: [{ action: 'setVar', params: {}, stepId: 's1', if: { op: 'hasItem', item: 'resource.wood', count: 3 } }]
      }],
      tutorials: []
    };
    const editor = buildEditor(project);
    editor.selectedIndex = 0;
    editor._renderDetail();
    // 页面有多个 .do-cond-form，步骤 if 的表单在 details.do-step-if 内
    const form = document.querySelector('.do-step-if .do-cond-form');
    expect(form.querySelector('.do-if-item-wrap').classList.contains('hidden')).toBe(false);
    expect(form.querySelector('.do-if-count-wrap').classList.contains('hidden')).toBe(false);
    expect(form.querySelector('.do-if-var-wrap').classList.contains('hidden')).toBe(true);
    expect(form.querySelector('.do-if-value-wrap').classList.contains('hidden')).toBe(true);
    const textarea = form.querySelector('.do-step-if-input');
    expect(textarea.value).toBe('{"op":"hasItem","item":"resource.wood","count":3}');
  });
});

describe('TriggerEditor 步骤拖拽排序', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  function projectWithSteps() {
    return {
      triggers: [{
        id: 'trg-1',
        when: { type: 'signal', params: {} },
        do: [
          { action: 'setVar', params: { key: 'a' }, stepId: 's1' },
          { action: 'setVar', params: { key: 'b' }, stepId: 's2' },
          { action: 'setVar', params: { key: 'c' }, stepId: 's3' }
        ]
      }],
      tutorials: []
    };
  }

  it('同层拖拽：下移一步（before→after）重排 do[]', () => {
    const editor = buildEditor(projectWithSteps());
    editor.selectedIndex = 0;
    // s1(0) 拖到 s3(2) 之后
    const moved = editor._moveActionPath('0', '2', true);
    expect(moved).toBe(true);
    expect(editor.project.triggers[0].do.map(s => s.stepId)).toEqual(['s2', 's3', 's1']);
  });

  it('同层拖拽：上移一步（after→before）重排 do[]', () => {
    const editor = buildEditor(projectWithSteps());
    editor.selectedIndex = 0;
    // s3(2) 拖到 s1(0) 之前
    const moved = editor._moveActionPath('2', '0', false);
    expect(moved).toBe(true);
    expect(editor.project.triggers[0].do.map(s => s.stepId)).toEqual(['s3', 's1', 's2']);
  });

  it('跨分支拖拽被拒绝（不同父数组）', () => {
    const project = projectWithSteps();
    project.triggers[0].do.push({
      stepId: 's4',
      branch: [
        { when: null, do: [{ action: 'setVar', params: { key: 'x' }, stepId: 's4.0.0' }] },
        { otherwise: true, do: [{ action: 'setVar', params: { key: 'y' }, stepId: 's4.1.0' }] }
      ]
    });
    const editor = buildEditor(project);
    editor.selectedIndex = 0;
    // 把顶层 s1 拖进分支 s4.0.0 所在数组（不同父数组）→ 拒绝
    const moved = editor._moveActionPath('0', '3.0.0', true);
    expect(moved).toBe(false);
    // 顶层 do[] 未变
    expect(editor.project.triggers[0].do.map(s => s.stepId)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('同分支内拖拽重排分支 do[]', () => {
    const project = projectWithSteps();
    project.triggers[0].do = [{
      stepId: 's1',
      branch: [
        { when: null, do: [
          { action: 'setVar', params: { key: 'a' }, stepId: 's1.0.0' },
          { action: 'setVar', params: { key: 'b' }, stepId: 's1.0.1' }
        ] },
        { otherwise: true, do: [] }
      ]
    }];
    const editor = buildEditor(project);
    editor.selectedIndex = 0;
    // 分支0内 s1.0.1 拖到 s1.0.0 之前
    const moved = editor._moveActionPath('0.0.1', '0.0.0', false);
    expect(moved).toBe(true);
    expect(editor.project.triggers[0].do[0].branch[0].do.map(s => s.stepId)).toEqual(['s1.0.1', 's1.0.0']);
  });

  it('渲染后拖拽手柄与 data-path 就位', () => {
    const editor = buildEditor(projectWithSteps());
    editor.selectedIndex = 0;
    editor._renderDetail();
    const items = document.querySelectorAll('.trg-do-item');
    expect(items.length).toBe(3);
    expect([...items].map(el => el.dataset.path)).toEqual(['0', '1', '2']);
    for (const item of items) {
      expect(item.querySelector('.do-drag-handle')).toBeTruthy();
    }
  });
});

describe('TriggerEditor 嵌套条件保护（and/or/not 降级只读 JSON）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  const nestedProject = () => ({
    triggers: [{
      id: 'trg-1',
      when: { type: 'signal', params: {} },
      do: [{
        action: 'setVar',
        params: { key: 'x' },
        stepId: 's1',
        if: { op: 'and', args: [
          { op: '==', var: 'story.s01Survival.firstWolfKilled', value: true },
          { op: '==', var: 'story.s01Survival.wolfSkinned', value: false }
        ] }
      }]
    }],
    tutorials: []
  });

  it('嵌套条件降级为只读 JSON 编辑，不渲染表单字段', () => {
    const editor = buildEditor(nestedProject());
    editor.selectedIndex = 0;
    editor._renderDetail();
    const nested = document.querySelector('.do-cond-nested');
    expect(nested).toBeTruthy();
    expect(nested.textContent).toContain('嵌套条件');
    // 无表单字段，避免表单改动破坏嵌套结构
    expect(nested.querySelector('.do-if-op')).toBeNull();
    expect(nested.querySelector('.do-if-var')).toBeNull();
    // 摘要显示嵌套标记
    expect(document.querySelector('.do-if-summary').textContent).toContain('嵌套条件');
  });

  it('嵌套条件的原始结构在 textarea 中完整保留，编辑 JSON 后 commit 写回', () => {
    const editor = buildEditor(nestedProject());
    editor.selectedIndex = 0;
    editor._renderDetail();
    const textarea = document.querySelector('.do-cond-nested .do-step-if-input');
    const parsed = JSON.parse(textarea.value);
    expect(parsed.op).toBe('and');
    expect(parsed.args).toHaveLength(2);
    expect(parsed.args[0]).toEqual({ op: '==', var: 'story.s01Survival.firstWolfKilled', value: true });
    // 编辑 JSON 后 commit 写回嵌套结构
    const edited = JSON.stringify({ op: 'or', args: [{ op: '==', var: 'hp', value: 0 }] });
    textarea.value = edited;
    textarea.dispatchEvent(new Event('change'));
    editor._commitDetail();
    expect(editor.project.triggers[0].do[0].if).toEqual({ op: 'or', args: [{ op: '==', var: 'hp', value: 0 }] });
  });

  it('扁平条件仍走可视化表单（不受嵌套保护影响）', () => {
    const editor = buildEditor({
      triggers: [{
        id: 'trg-1',
        when: { type: 'signal', params: {} },
        do: [{ action: 'setVar', params: { key: 'x' }, stepId: 's1', if: { op: '==', var: 'hp', value: 0 } }]
      }],
      tutorials: []
    });
    editor.selectedIndex = 0;
    editor._renderDetail();
    expect(document.querySelector('.do-cond-nested')).toBeNull();
    expect(document.querySelector('.do-if-op')).toBeTruthy();
  });
});

describe('TriggerEditor 分支条件可视化编辑器', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  function projectWithBranch() {
    return {
      triggers: [{
        id: 'trg-1',
        when: { type: 'signal', params: {} },
        do: [{
          stepId: 's1',
          branch: [
            { when: { op: '==', var: 'hp', value: 0 }, do: [{ action: 'setVar', params: { key: 'a' }, stepId: 's1.0.0' }] },
            { otherwise: true, do: [{ action: 'setVar', params: { key: 'b' }, stepId: 's1.1.0' }] }
          ]
        }]
      }],
      tutorials: []
    };
  }

  it('分支条件渲染为可视化表单（非纯 JSON textarea），otherwise 分支无表单', () => {
    const editor = buildEditor(projectWithBranch());
    editor.selectedIndex = 0;
    editor._renderDetail();
    const wrap = document.querySelector('.do-branch-when-wrap');
    expect(wrap).toBeTruthy();
    // 第一个分支有条件 → 可视化表单 + 隐藏 JSON textarea 同步值
    const textarea = wrap.querySelector('.do-branch-when');
    expect(textarea.value).toBe('{"op":"==","var":"hp","value":0}');
    expect(wrap.querySelector('.do-if-op').value).toBe('==');
    // otherwise 分支不渲染 when 表单：整个分支容器里只有 1 个条件块
    expect(document.querySelectorAll('.do-branch-when-wrap').length).toBe(1);
  });

  it('分支条件表单变更同步隐藏 textarea，commit 后写回 branch.when', () => {
    const editor = buildEditor(projectWithBranch());
    editor.selectedIndex = 0;
    editor._renderDetail();
    const wrap = document.querySelector('.do-branch-when-wrap');
    const opSelect = wrap.querySelector('.do-if-op');
    const varInput = wrap.querySelector('.do-if-var');
    const valueInput = wrap.querySelector('.do-if-value');
    opSelect.value = '>';
    varInput.value = 'hp';
    valueInput.value = '5';
    opSelect.dispatchEvent(new Event('change'));
    expect(wrap.querySelector('.do-branch-when').value).toBe('{"op":">","var":"hp","value":5}');
    editor._commitDetail();
    expect(editor.project.triggers[0].do[0].branch[0].when).toEqual({ op: '>', var: 'hp', value: 5 });
  });
});

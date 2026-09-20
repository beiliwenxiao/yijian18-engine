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
  return editor;
}

const SCHEMA = {
  type: 'object',
  required: ['operation'],
  additionalProperties: false,
  properties: {
    operation: { enum: ['commitStoryWhenReady'], title: '操作', type: 'string' },
    firstWolfCount: {
      description: '首狼任务出现的野狼数量；仅在提交 story.s01.firstWolfSpotted 时生效，运行时上限 200',
      maximum: 200,
      minimum: 1,
      title: '首狼群数量',
      type: 'integer'
    },
    gte: { title: '前置数值下限', type: 'number' }
  }
};

describe('TriggerEditor 结构化参数数字字段手动填写', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('number/integer 字段渲染为可手动输入的 number input，并附带 datalist 预设', () => {
    const editor = buildEditor();
    const html = editor._renderStructuredParams(
      SCHEMA,
      { operation: 'commitStoryWhenReady', firstWolfCount: 3 },
      { excludeOperation: true }
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    const input = container.querySelector('input[data-param-name="firstWolfCount"]');
    expect(input).not.toBeNull();
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('200');
    expect(input.getAttribute('step')).toBe('1');
    expect(input.value).toBe('3');
    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();
    const datalist = container.querySelector(`datalist[id="${listId}"]`);
    expect(datalist?.querySelectorAll('option').length).toBeGreaterThan(3);
  });

  it('手动填写的任意值经 _readStructuredParams 原样写回 params；清空即移除参数', () => {
    const editor = buildEditor();
    const html = editor._renderStructuredParams(
      SCHEMA,
      { operation: 'commitStoryWhenReady', firstWolfCount: 3 },
      { excludeOperation: true }
    );
    const item = document.createElement('div');
    item.innerHTML = html;
    const input = item.querySelector('input[data-param-name="firstWolfCount"]');
    input.value = '7';
    const next = editor._readStructuredParams(item, { operation: 'commitStoryWhenReady', firstWolfCount: 3 });
    expect(next.firstWolfCount).toBe(7);
    input.value = '';
    const cleared = editor._readStructuredParams(item, { operation: 'commitStoryWhenReady', firstWolfCount: 7 });
    expect(Object.prototype.hasOwnProperty.call(cleared, 'firstWolfCount')).toBe(false);
  });

  it('多个字段实例生成互不冲突的 datalist id', () => {
    const editor = buildEditor();
    const first = document.createElement('div');
    first.innerHTML = editor._renderStructuredParams(SCHEMA, { operation: 'commitStoryWhenReady' }, { excludeOperation: true });
    const second = document.createElement('div');
    second.innerHTML = editor._renderStructuredParams(SCHEMA, { operation: 'commitStoryWhenReady' }, { excludeOperation: true });
    const firstId = first.querySelector('input[data-param-name="firstWolfCount"]')?.getAttribute('list');
    const secondId = second.querySelector('input[data-param-name="firstWolfCount"]')?.getAttribute('list');
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
  });
});

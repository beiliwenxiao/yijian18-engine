// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateTransactionEditor } from './StateTransactionEditor.js';
import { loadProjectWithShards } from '../test/support/projectFixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const project = await loadProjectWithShards();

function buildEditor() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const patched = {};
    const canonicalSession = {
        sourceUri: 'test://game.project.json',
        getValue: () => project,
        patch: (key, value) => { patched[key] = value; },
        save: async () => ({ ok: true, committed: true })
    };
    const editor = new StateTransactionEditor(container, { canonicalSession });
    editor._initialized = true;
    editor._buildUI();
    editor._load();
    editor._render();
    return { editor, patched };
}

const detail = editor => editor.container.querySelector('[data-role="transaction-detail"]');

describe('StateTransactionEditor 状态事务管理', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.head.innerHTML = '';
    });

    it('渲染：列表 40 条事务，选中显示表单（条件行/写入行按结构解析）', () => {
        const { editor } = buildEditor();
        expect(editor.container.querySelectorAll('[data-transaction-id]').length).toBe(40);

        // 选中「点亮篝火」：when 为 all 两条件，writes 一条布尔写入
        editor.selectedId = 'story.s01.campfireLit';
        editor._render();
        expect(detail(editor).querySelector('[data-ste-field="id"]').value).toBe('story.s01.campfireLit');
        expect(detail(editor).querySelector('[data-ste-field="name"]').value).toBe('点亮篝火');
        expect(detail(editor).querySelectorAll('[data-condition-index]').length).toBe(2);
        expect(detail(editor).querySelectorAll('[data-write-index]').length).toBe(1);
        // 写入行：布尔模式 + 值为真
        const writeRow = detail(editor).querySelector('[data-write-index="0"]');
        expect(writeRow.querySelector('[data-write-field="mode"]').value).toBe('bool');
        expect(writeRow.querySelector('[data-write-field="boolValue"]').value).toBe('true');
    });

    it('计数事务解析：$add 写入显示为「原值+N」模式，编辑后写回等价结构', () => {
        const { editor } = buildEditor();
        editor.selectedId = 'story.s01.berryGathered';
        editor._render();
        const writeRow = detail(editor).querySelector('[data-write-index="0"]');
        expect(writeRow.querySelector('[data-write-field="mode"]').value).toBe('add');
        expect(Number(writeRow.querySelector('[data-write-field="addValue"]').value)).toBe(1);
        expect(writeRow.querySelector('[data-write-field="path"]').value).toBe('s01Survival.berryGatherCount');

        // 改为每次 +2 → 序列化回 $add 结构
        writeRow.querySelector('[data-write-field="addValue"]').value = '2';
        writeRow.querySelector('[data-write-field="addValue"]').dispatchEvent(new Event('change'));
        const command = editor.commands.find(item => item.id === 'story.s01.berryGathered');
        expect(command.transaction.writes[0].value).toEqual({ $add: [{ $get: 'story.s01Survival.berryGatherCount' }, 2] });
    });

    it('高级字段锁定：variants/delayed 类事务强制 JSON 模式，编辑写回', () => {
        const { editor } = buildEditor();
        editor.selectedId = 'story.s09.delayed.resolve';
        editor._render();
        // 含 selector/variants → 无表单字段，直接 JSON 源码
        expect(detail(editor).querySelector('[data-role="json-source"]')).toBeTruthy();
        expect(detail(editor).querySelector('[data-ste-field="id"]')).toBeNull();

        // JSON 改名写回
        const textarea = detail(editor).querySelector('[data-role="json-source"]');
        const parsed = JSON.parse(textarea.value);
        parsed.name = '延迟后果结算（改名测试）';
        textarea.value = JSON.stringify(parsed, null, 2);
        textarea.dispatchEvent(new Event('change'));
        expect(editor.commands.find(item => item.id === 'story.s09.delayed.resolve').name).toBe('延迟后果结算（改名测试）');
    });

    it('新增事务 + 保存：patch commands 且草稿随 save 提交', async () => {
        const { editor, patched } = buildEditor();
        const promptSpy = vi.spyOn(window, 'prompt')
            .mockReturnValueOnce('story.s01.testFact')
            .mockReturnValueOnce('测试事实');
        editor.container.querySelector('[data-action="add"]').click();
        promptSpy.mockRestore();
        expect(editor.commands.some(command => command?.id === 'story.s01.testFact')).toBe(true);

        const result = await editor.save();
        expect(result.ok).toBe(true);
        expect(patched.commands).toBeTruthy();
        expect(patched.commands.find(command => command.id === 'story.s01.testFact').name).toBe('测试事实');
    });
});

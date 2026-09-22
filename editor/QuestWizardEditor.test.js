// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuestWizardEditor } from './QuestWizardEditor.js';
import { compileQuest, compileQuestProject } from '../src/systems/quest/QuestRuntime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const project = readJson('example/sanguo_zhangjiao/game.project.json');

function buildEditor(questsOverride = null) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const quests = questsOverride ?? cloneQuests();
    const patched = {};
    const canonicalSession = {
        sourceUri: 'test://game.project.json',
        getValue: () => ({ ...project, quests }),
        patch: (key, value) => { patched[key] = value; },
        save: async () => ({ ok: true, committed: true })
    };
    const editor = new QuestWizardEditor(container, { canonicalSession });
    editor.project = { ...project, quests };
    editor.quests = structuredClone(quests);
    editor.selectedId = editor.quests[0]?.id || null;
    editor._initialized = true;
    editor._buildUI();
    editor._render();
    return { editor, patched };
}

function cloneQuests() {
    return structuredClone(project.quests);
}

const detail = editor => editor.container.querySelector('[data-role="quest-detail"]');

describe('QuestWizardEditor 任务向导', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.head.innerHTML = '';
    });

    it('渲染迁移后的 S01 任务：五区块齐全，编译预览展示 16 目标链且校验通过', () => {
        const { editor } = buildEditor();
        expect(editor.container.querySelectorAll('[data-quest-id]').length).toBe(2);
        const html = detail(editor).innerHTML;
        // 五区块
        for (const legend of ['① 元信息', '② 接取', '③ 奖励', '④ 后续任务', '⚙ 编译预览']) {
            expect(html).toContain(legend);
        }
        // 编译预览：目标链 + intro 触发器（S01 开场教程步骤 s01.move 由 task.started 驱动展示）
        expect(html).toContain('点燃火堆');
        expect(html).toContain('逃往废弃营地');
        expect(html).toContain('编译校验通过');
        expect(html).toContain('trg_task.s01.survival_intro');
        // 示意图：start + 16 目标 + complete 节点（教程步骤不进图，含连线容器）
        expect(detail(editor).querySelectorAll('[data-graph-node-id]').length).toBe(18);
        expect(detail(editor).querySelector('[data-graph-node-id="lightCampfire"]')).toBeTruthy();
        expect(detail(editor).querySelector('.qwe-graph-edges path')).toBeTruthy();
    });

    it('目标步骤编辑：目标类型切换写回 objectiveType，身份与数量字段按目录渲染', () => {
        const { editor } = buildEditor();
        // S01 第 0 步为开场教程（step.1.1），首个目标是 index 1 的 lightCampfire = commit.fact
        const card = detail(editor).querySelector('[data-step-index="1"]');
        expect(card.querySelector('[data-step-field="objectiveType"]').value).toBe('commit.fact');
        const targetSelect = card.querySelector('[data-step-field="target"]');
        expect(targetSelect.value).toBe('story.s01.campfireLit');

        targetSelect.value = 'story.s01.berryEaten';
        targetSelect.dispatchEvent(new Event('change'));
        const quest = editor.quests.find(item => item.id === 'task.s01.survival');
        expect(quest.steps[1].target).toBe('story.s01.berryEaten');
        // 编译产物同步反映
        const { taskGraph } = compileQuest(quest, project);
        expect(taskGraph.nodes.find(node => node.id === 'lightCampfire').eventMatcher.payload.definitionId).toBe('story.s01.berryEaten');
    });

    it('步骤类型切换重置为对应字段集（objective → tutorial）', () => {
        const { editor } = buildEditor();
        const card = detail(editor).querySelector('[data-step-index="0"]');
        card.querySelector('[data-step-field="type"]').value = 'tutorial';
        card.querySelector('[data-step-field="type"]').dispatchEvent(new Event('change'));
        const quest = editor.quests.find(item => item.id === 'task.s01.survival');
        expect(quest.steps[0].type).toBe('tutorial');
        expect(quest.steps[0].objectiveType).toBeUndefined();
        expect(detail(editor).querySelector('[data-step-index="0"] [data-step-field="tutorialId"]')).toBeTruthy();
    });

    it('接取模式三态：accept 缺省显示「由现有触发器接取」，manual 显示 giver 指引，auto 显示条件来源', () => {
        const { editor } = buildEditor();
        const modeSelect = detail(editor).querySelector('[data-accept-field="mode"]');
        // S01 quest 无 accept 字段 → external 态
        expect(modeSelect.value).toBe('external');
        expect(detail(editor).innerHTML).toContain('由 triggers[] 中的现有触发器承担');

        modeSelect.value = 'manual';
        modeSelect.dispatchEvent(new Event('change'));
        let html = detail(editor).innerHTML;
        expect(html).toContain('data-giver-field="npcId"');
        expect(html).toContain('task.command');

        modeSelect.value = 'auto';
        modeSelect.dispatchEvent(new Event('change'));
        html = detail(editor).innerHTML;
        expect(html).toContain('data-when-field="type"');
        expect(html).toContain('事实提交（状态事务）');

        // 切回 external：accept 字段整体移除
        modeSelect.value = 'external';
        modeSelect.dispatchEvent(new Event('change'));
        const quest = editor.quests.find(item => item.id === 'task.s01.survival');
        expect(quest.accept).toBeUndefined();
    });

    it('保存：定义非法（目标缺失）被阻止，合法定义写入 quests 并通过编译校验', async () => {
        const broken = [{ id: 'quest.broken', title: '残缺', steps: [{ id: 'x', type: 'objective', objectiveType: 'commit.fact', target: '' }] }];
        const brokenRun = buildEditor(broken);
        const rejected = await brokenRun.editor.save();
        expect(rejected.ok).toBe(false);
        expect(brokenRun.patched.quests).toBeUndefined();

        const { editor, patched } = buildEditor();
        const result = await editor.save();
        expect(result.ok).toBe(true);
        expect(patched.quests.map(quest => quest.id)).toEqual(['task.s01.survival', 'task.s02.summons']);
    });

    it('教程内嵌：展开就地编辑步骤文案，保存时 quests+tutorials 双字段提交', async () => {
        const { editor, patched } = buildEditor();
        editor.tutorials = [{ id: 's01.move', title: '移动教学', completionPolicy: 'signal', steps: [{ id: 's01.move-step-01', text: '摇杆移动' }] }];
        // 步骤 0（objective）切换为 tutorial 并选择教程
        const card = detail(editor).querySelector('[data-step-index="0"]');
        card.querySelector('[data-step-field="type"]').value = 'tutorial';
        card.querySelector('[data-step-field="type"]').dispatchEvent(new Event('change'));
        const tutCard = detail(editor).querySelector('[data-step-index="0"]');
        tutCard.querySelector('[data-step-field="tutorialId"]').value = 's01.move';
        tutCard.querySelector('[data-step-field="tutorialId"]').dispatchEvent(new Event('change'));

        detail(editor).querySelector('[data-step-index="0"] [data-action="toggle-tut-edit"]').click();
        const edit = detail(editor).querySelector('.qwe-tut-edit');
        expect(edit, '展开后应渲染教程内嵌编辑区').toBeTruthy();

        const textarea = edit.querySelector('[data-tut-field="text"]');
        textarea.value = '改后的教程文案';
        textarea.dispatchEvent(new Event('change'));
        expect(editor._tutorialsDirty).toBe(true);

        await editor.save();
        expect(patched.quests).toBeTruthy();
        expect(patched.tutorials).toBeTruthy();
        expect(patched.tutorials.some(tutorial =>
            (tutorial.steps || []).some(step => step.text === '改后的教程文案')
        )).toBe(true);
    });

    it('新建与删除任务', () => {
        const { editor } = buildEditor();
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValueOnce('quest.new.test').mockReturnValueOnce('新任务');
        editor.container.querySelector('[data-action="add-quest"]').click();
        expect(editor.quests.some(quest => quest.id === 'quest.new.test')).toBe(true);

        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        editor.container.querySelector('[data-action="delete-quest"]').click();
        expect(editor.quests.some(quest => quest.id === 'quest.new.test')).toBe(false);
        promptSpy.mockRestore();
        confirmSpy.mockRestore();
    });
});

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
        localStorage.removeItem('qwe-col-widths');
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
        // S01 第 0/1 步为开场教程+对话（step.1.1/step.1.2），首个目标是 index 2 的 lightCampfire = commit.fact
        const card = detail(editor).querySelector('[data-step-index="2"]');
        expect(card.querySelector('[data-step-field="objectiveType"]').value).toBe('commit.fact');
        const targetSelect = card.querySelector('[data-step-field="target"]');
        expect(targetSelect.value).toBe('story.s01.campfireLit');

        targetSelect.value = 'story.s01.berryEaten';
        targetSelect.dispatchEvent(new Event('change'));
        const quest = editor.quests.find(item => item.id === 'task.s01.survival');
        expect(quest.steps[2].target).toBe('story.s01.berryEaten');
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

    it('对话内嵌：展开就地编辑节点台词，保存时 quests+dialogues 双字段提交', async () => {
        const { editor, patched } = buildEditor();
        editor.dialogues = [{ id: 'dlg_test', title: '测试对话', startNode: 'start', nodes: { start: { speaker: '旁白', text: '开场词' } } }];
        // 步骤 0（开场教程）切换为 dialogue 并选择对话
        const card = detail(editor).querySelector('[data-step-index="0"]');
        card.querySelector('[data-step-field="type"]').value = 'dialogue';
        card.querySelector('[data-step-field="type"]').dispatchEvent(new Event('change'));
        const dlgCard = detail(editor).querySelector('[data-step-index="0"]');
        dlgCard.querySelector('[data-step-field="dialogueId"]').value = 'dlg_test';
        dlgCard.querySelector('[data-step-field="dialogueId"]').dispatchEvent(new Event('change'));

        detail(editor).querySelector('[data-step-index="0"] [data-action="toggle-dlg-edit"]').click();
        const edit = detail(editor).querySelector('.qwe-dlg-edit');
        expect(edit, '展开后应渲染对话内嵌编辑区').toBeTruthy();
        expect(edit.querySelectorAll('[data-dlg-node-id]').length).toBe(1);

        const speaker = edit.querySelector('[data-dlg-node-id="start"] [data-dlg-field="speaker"]');
        speaker.value = '老者';
        speaker.dispatchEvent(new Event('change'));
        const textarea = edit.querySelector('[data-dlg-node-id="start"] [data-dlg-field="text"]');
        textarea.value = '改后的台词';
        textarea.dispatchEvent(new Event('change'));
        expect(editor._dialoguesDirty).toBe(true);

        // 添加节点：接在主链末尾（前驱 nextNode 接线）
        edit.querySelector('[data-action="dlg-add-node"]').click();
        expect(detail(editor).querySelectorAll('.qwe-dlg-edit [data-dlg-node-id]').length).toBe(2);
        const dlg = editor.dialogues[0];
        expect(dlg.nodes['node-02']).toBeTruthy();
        expect(dlg.nodes.start.nextNode).toBe('node-02');
        expect(dlg.startNode).toBe('start');

        await editor.save();
        expect(patched.quests).toBeTruthy();
        expect(patched.dialogues).toBeTruthy();
        expect(patched.dialogues[0].nodes.start.speaker).toBe('老者');
        expect(patched.dialogues[0].nodes.start.text).toBe('改后的台词');
        expect(patched.dialogues[0].nodes.start.nextNode).toBe('node-02');
    });

    it('步骤次级导航：类型背景色区分，拖动 drop 重排写回 quest.steps，点击高亮定位', () => {
        const { editor } = buildEditor();
        const nav = editor.container.querySelector('[data-role="steps-nav"]');
        // S01：18 步 = 开场教程 + 开场对话 + 16 目标
        const items = nav.querySelectorAll('[data-snav-index]');
        expect(items.length).toBe(18);
        expect(items[0].classList.contains('type-tutorial')).toBe(true);
        expect(items[1].classList.contains('type-dialogue')).toBe(true);
        expect(items[2].classList.contains('type-objective')).toBe(true);
        expect(items[0].textContent).toContain('1 · 教程');
        expect(items[1].textContent).toContain('2 · 对话');
        expect(items[2].textContent).toContain('3 · 目标');
        expect(items[2].draggable).toBe(true);

        // 拖动排序：把第 0 项拖到第 1 项位置（jsdom 无 DataTransfer，走 _dragFromIndex 兜底）
        const orderBefore = editor.quests[0].steps.map(step => step.id);
        items[0].dispatchEvent(new Event('dragstart'));
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
        items[1].dispatchEvent(dropEvent);
        expect(dropEvent.defaultPrevented).toBe(true); // drop handler 已处理（preventDefault）
        const orderAfter = editor.quests[0].steps.map(step => step.id);
        expect(orderAfter[0]).toBe(orderBefore[1]);
        expect(orderAfter[1]).toBe(orderBefore[0]);
        // 重排后次级导航序号同步刷新（导航项显示 title || id）
        const navAfter = editor.container.querySelectorAll('[data-role="steps-nav"] [data-snav-index]');
        const movedStep = editor.quests[0].steps[0];
        expect(navAfter[0].textContent).toContain(movedStep.title || movedStep.id);

        // 点击定位：设置 active 高亮
        navAfter[2].click();
        expect(navAfter[2].classList.contains('active')).toBe(true);
        expect(editor._activeStepNavId).toBe(editor.quests[0].steps[2].id);
    });

    it('列宽拖动：竖线手柄 mousedown+mousemove 调整相邻列宽，mouseup 持久化且停止响应', () => {
        const { editor } = buildEditor();
        const listAside = editor.container.querySelector('[data-role="quest-list"]');
        const navAside = editor.container.querySelector('[data-role="steps-nav"]');
        expect(editor.container.querySelectorAll('.qwe-divider').length).toBe(2);

        const divider = editor.container.querySelector('[data-divider="list"]');
        // jsdom 中 getBoundingClientRect 宽为 0，故起始 clientX 用 0（width = 0 + delta）
        divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 380 }));
        expect(listAside.style.width).toBe('380px');
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(JSON.parse(localStorage.getItem('qwe-col-widths')).list).toBe(380);
        // 松开后 move 不再生效
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
        expect(listAside.style.width).toBe('380px');

        // 步骤导航列同理 + 宽度钳制（最小 120）
        const navDivider = editor.container.querySelector('[data-divider="nav"]');
        navDivider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 500 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }));
        expect(navAside.style.width).toBe('120px');
        document.dispatchEvent(new MouseEvent('mouseup'));

        // 刷新后恢复列宽
        const restored = buildEditor();
        expect(restored.editor.container.querySelector('[data-role="quest-list"]').style.width).toBe('380px');
        expect(restored.editor.container.querySelector('[data-role="steps-nav"]').style.width).toBe('120px');
    });

    it('步骤右键菜单：六操作按钮按边界禁用，添加插入右键项之后，置顶/删除写回 steps', () => {
        const { editor } = buildEditor();
        const quest = editor.quests[0];
        const nav = editor.container.querySelector('[data-role="steps-nav"]');
        const items = nav.querySelectorAll('[data-snav-index]');

        // 右键第 2 项（index 1，非边界）：六按钮全可用
        items[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        let menu = document.body.querySelector('.qwe-ctx-menu');
        expect(menu, '右键后应弹出菜单').toBeTruthy();
        const labels = Array.from(menu.querySelectorAll('button')).map(b => b.textContent.trim());
        expect(labels).toEqual(['➕ 添加步骤', '🗑 删除步骤', '⤒ 置顶', '↑ 上移', '↓ 下移', '⤓ 置底']);
        expect(Array.from(menu.querySelectorAll('button')).every(b => !b.disabled)).toBe(true);
        expect(editor._activeStepNavId).toBe(quest.steps[1].id);

        // 添加 → 插入右键项之后（index 2）
        const orderBefore = quest.steps.map(s => s.id);
        menu.querySelector('[data-ctx="add"]').click();
        expect(document.body.querySelector('.qwe-ctx-menu'), '点击后菜单关闭').toBeNull();
        expect(quest.steps.length).toBe(orderBefore.length + 1);
        expect(quest.steps[2].type).toBe('objective');
        expect(quest.steps[2].id).not.toBe(orderBefore[2]);
        // 菜单操作后次级导航同步刷新且右键项仍高亮
        const navAfterAdd = editor.container.querySelectorAll('[data-role="steps-nav"] [data-snav-index]');
        expect(navAfterAdd.length).toBe(orderBefore.length + 1);
        expect(navAfterAdd[1].classList.contains('active')).toBe(true);

        // 置顶：右键 index 2（新添加的步骤）→ 移到首位
        const addedId = quest.steps[2].id;
        navAfterAdd[2].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        menu = document.body.querySelector('.qwe-ctx-menu');
        menu.querySelector('[data-ctx="top"]').click();
        expect(quest.steps[0].id).toBe(addedId);

        // 删除（confirm 确认）
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const countBefore = quest.steps.length;
        const navTop = editor.container.querySelectorAll('[data-role="steps-nav"] [data-snav-index]');
        navTop[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        menu = document.body.querySelector('.qwe-ctx-menu');
        expect(menu.querySelector('[data-ctx="top"]').disabled).toBe(true); // 首项：置顶/上移禁用
        expect(menu.querySelector('[data-ctx="up"]').disabled).toBe(true);
        menu.querySelector('[data-ctx="delete"]').click();
        expect(quest.steps.length).toBe(countBefore - 1);
        expect(quest.steps.some(s => s.id === addedId)).toBe(false);
        confirmSpy.mockRestore();

        // 右键末项：下移/置底禁用
        const navEnd = editor.container.querySelectorAll('[data-role="steps-nav"] [data-snav-index]');
        navEnd[navEnd.length - 1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        menu = document.body.querySelector('.qwe-ctx-menu');
        expect(menu.querySelector('[data-ctx="down"]').disabled).toBe(true);
        expect(menu.querySelector('[data-ctx="bottom"]').disabled).toBe(true);
        editor._hideStepContextMenu();
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

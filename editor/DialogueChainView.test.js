/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-03
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildDialogueWiring, collectActionSteps } from './DialogueChainView.js';

const dialogue = (id, extra = {}) => ({ id, title: id, startNode: 'start', nodes: { start: { speaker: '旁白', text: '…' } }, ...extra });

const judgeDialogue = () => ({
  id: 'dialogue.test.judge',
  startNode: 'start',
  nodes: { start: { text: '怎么处置？', choices: [{ id: 'save', text: '救他' }, { id: 'kill', text: '杀了' }] } }
});

describe('buildDialogueWiring 对话链接线模型', () => {
  it('孤儿对话告警；startDialogue 触发器来源与去向串接识别', () => {
    const model = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.orphan'), dialogue('dialogue.test.reached')],
      triggers: [{
        id: 'trg_enter',
        when: { type: 'sceneEnter', params: {} },
        do: [{ action: 'startDialogue', params: { id: 'dialogue.test.reached' } }]
      }]
    });
    const orphan = model.dialogues.find(card => card.id === 'dialogue.test.orphan');
    const reached = model.dialogues.find(card => card.id === 'dialogue.test.reached');
    expect(orphan.issues.some(issue => issue.code === 'unreachableDialogue')).toBe(true);
    expect(reached.issues.some(issue => issue.code === 'unreachableDialogue')).toBe(false);
    // 来源收集扫全量触发器（sceneEnter 等 when 类型也会 startDialogue）
    expect(reached.sources[0]).toMatchObject({ kind: 'trigger', label: '由触发器 trg_enter 启动' });
    expect(reached.listeners.map(listener => listener.triggerId)).toEqual([]);
    // orphan 无人监听、无去向
    expect(orphan.nextDialogueIds).toEqual([]);
    expect(model.summary.orphans).toBe(1);
  });

  it('监听触发器挂卡：dialogueChoice 带 choiceId / dialogueEnd；动作摘要含事务与生成', () => {
    const model = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.judge', judgeDialogue())],
      triggers: [{
        id: 'trg_save',
        when: { type: 'dialogueChoice', params: { id: 'dialogue.test.judge', choiceId: 'save' } },
        do: [
          { action: 'state.transaction', params: { definitionId: 'story.test.saved' } },
          { action: 'startDialogue', params: { id: 'dialogue.test.next' } }
        ]
      }]
    });
    // dialogue.test.next 不在 dialogues 里 → startDialogue 去向不标记（不产生幽灵卡片），
    // 但来源收集同样只认已存在的对话
    const card = model.dialogues[0];
    expect(card.listeners).toHaveLength(1);
    expect(card.listeners[0]).toMatchObject({ triggerId: 'trg_save', event: 'dialogueChoice', choiceId: 'save' });
    expect(card.listeners[0].actions).toContain('⚑ 事务 story.test.saved');
    expect(card.nextDialogueIds).toEqual([]);
    expect(model.summary.unfiltered).toBe(0);
  });

  it('branch 容器内的 startDialogue 同样计入去向串接', () => {
    const model = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.a'), dialogue('dialogue.test.b')],
      triggers: [{
        id: 'trg_branch',
        when: { type: 'dialogueEnd', params: { id: 'dialogue.test.a' } },
        do: [{
          branch: [
            { do: [{ action: 'startDialogue', params: { id: 'dialogue.test.b' } }] },
            { do: [{ action: 'showTip', params: { text: '另一条分支' } }] }
          ]
        }]
      }]
    });
    const cardA = model.dialogues.find(card => card.id === 'dialogue.test.a');
    const cardB = model.dialogues.find(card => card.id === 'dialogue.test.b');
    expect(cardA.nextDialogueIds).toEqual(['dialogue.test.b']);
    expect(cardB.sources.some(source => source.kind === 'trigger')).toBe(true);
    expect(cardB.issues.some(issue => issue.code === 'unreachableDialogue')).toBe(false);
  });

  it('dialogueChoice 未声明 choiceId 且对话有多选项 → unfilteredDialogueChoice 提示', () => {
    const model = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.judge', judgeDialogue())],
      triggers: [{ id: 'trg_any', when: { type: 'dialogueChoice', params: { id: 'dialogue.test.judge' } }, do: [] }]
    });
    expect(model.summary.unfiltered).toBe(1);
    expect(model.dialogues[0].issues.some(issue => issue.code === 'unfilteredDialogueChoice')).toBe(true);
  });

  it('声明的 choiceId 不属于任何选项 → 断引用错误', () => {
    const model = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.judge', judgeDialogue())],
      triggers: [{ id: 'trg_typo', when: { type: 'dialogueChoice', params: { id: 'dialogue.test.judge', choiceId: 'sve' } }, do: [] }]
    });
    expect(model.summary.broken).toBeGreaterThanOrEqual(1);
    expect(model.dialogues[0].issues.some(issue => issue.code === 'invalidReference' && issue.message.includes('sve'))).toBe(true);
  });

  it('监听不存在的对话 → danglingListeners（这类触发器永远不触发）', () => {
    const model = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.a')],
      triggers: [
        { id: 'trg_dangling', when: { type: 'dialogueEnd', params: { id: 'dialogue.missing' } }, do: [] },
        { id: 'trg_noid', when: { type: 'dialogueChoice', params: {} }, do: [] }
      ]
    });
    expect(model.danglingListeners).toHaveLength(2);
    expect(model.danglingListeners[0]).toMatchObject({ triggerId: 'trg_dangling', dialogueId: 'dialogue.missing' });
    expect(model.danglingListeners[1].reason).toContain('未声明对话 id');
    expect(model.summary.broken).toBe(2);
  });

  it('节点引用悬空（choice/node nextNode、startNode）逐条报断链', () => {
    const model = buildDialogueWiring({
      dialogues: [{
        id: 'dialogue.test.broken',
        startNode: 'nope',
        nodes: { start: { text: '…', nextNode: 'gone', choices: [{ id: 'go', nextNode: 'void' }] } }
      }]
    });
    const issues = model.dialogues[0].issues.filter(issue => issue.code === 'invalidReference');
    expect(issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('startNode 悬空'),
      expect.stringContaining('start.nextNode 悬空'),
      expect.stringContaining('choices[0].nextNode 悬空')
    ]));
  });

  it('quest 步骤/dialogueRefs/giver 对话都算启动来源；runtimeStarted 豁免孤儿', () => {
    const model = buildDialogueWiring({
      dialogues: [
        dialogue('dialogue.test.by-step'),
        dialogue('dialogue.test.by-ref'),
        dialogue('dialogue.test.by-giver'),
        dialogue('dialogue.test.by-code', { runtimeStarted: true })
      ],
      quests: [{
        id: 'task.test',
        giver: { dialogueId: 'dialogue.test.by-giver' },
        dialogueRefs: ['dialogue.test.by-ref'],
        steps: [{ id: 's1', type: 'dialogue', dialogueId: 'dialogue.test.by-step' }]
      }]
    });
    expect(model.summary.orphans).toBe(0);
    expect(model.dialogues.every(card => card.issues.every(issue => issue.code !== 'unreachableDialogue'))).toBe(true);
    const stepCard = model.dialogues.find(card => card.id === 'dialogue.test.by-step');
    expect(stepCard.sources[0].ref).toBe('quests.task.test.steps[0].dialogueId');
  });

  it('runtimeStarted 对话来源区展示引擎代码启动徽标', () => {
    const model = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.wake', { runtimeStarted: true })]
    });
    expect(model.dialogues[0].runtimeStarted).toBe(true);
    expect(model.dialogues[0].sources).toHaveLength(0);
    expect(model.dialogues[0].issues).toHaveLength(0);
  });

  it('collectActionSteps 展开 branch 容器且顺序保持', () => {
    const steps = [
      { action: 'showTip' },
      { branch: [{ do: [{ action: 'a1' }] }, { do: [{ action: 'a2' }, { branch: [{ do: [{ action: 'a3' }] }] }] }] },
      { action: 'end' }
    ];
    expect(collectActionSteps(steps).map(step => step.action)).toEqual(['showTip', 'a1', 'a2', 'a3', 'end']);
  });
});

describe('DialogueChainView 渲染', () => {
  it('render 输出汇总条与卡片；点击卡片回跳；仅问题过滤生效', async () => {
    const { DialogueChainView } = await import('./DialogueChainView.js');
    document.body.innerHTML = '';
    document.getElementById('dlg-chain-styles')?.remove();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const selected = [];
    const view = new DialogueChainView(container, { onSelectDialogue: id => selected.push(id) });
    const model = buildDialogueWiring({
      dialogues: [
        dialogue('dialogue.test.ok'),
        dialogue('dialogue.test.orphan')
      ],
      triggers: [{ id: 'trg_start', when: { type: 'sceneEnter', params: {} }, do: [{ action: 'startDialogue', params: { id: 'dialogue.test.ok' } }] }]
    });
    view.render(model);
    expect(container.querySelectorAll('.dc-card').length).toBe(2);
    expect(container.querySelector('.dc-summary').textContent).toContain('孤儿');

    container.querySelectorAll('.dc-card')[1].click();
    expect(selected).toEqual(['dialogue.test.orphan']);

    view.setFilter('issues');
    expect(container.querySelectorAll('.dc-card').length).toBe(1);
    // 去向跳转芯片 stopPropagation 且回跳
    const model2 = buildDialogueWiring({
      dialogues: [dialogue('dialogue.test.a'), dialogue('dialogue.test.b')],
      triggers: [{ id: 'trg', when: { type: 'dialogueEnd', params: { id: 'dialogue.test.a' } }, do: [{ action: 'startDialogue', params: { id: 'dialogue.test.b' } }] }]
    });
    view.render(model2);
    const jump = container.querySelector('[data-dc-jump]');
    expect(jump.textContent).toContain('dialogue.test.b');
    jump.click();
    expect(selected).toEqual(['dialogue.test.orphan', 'dialogue.test.b']);
  });
});

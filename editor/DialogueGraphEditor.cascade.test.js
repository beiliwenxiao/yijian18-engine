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
import { DialogueGraphEditor } from './DialogueGraphEditor.js';

/** 免 DOM 构造：只注入级联方法依赖的 project/dialogues（方法均为实例纯逻辑）。 */
function buildBare(project) {
  const editor = Object.create(DialogueGraphEditor.prototype);
  editor.project = project;
  editor.dialogues = project.dialogues;
  return editor;
}

describe('DialogueGraphEditor 节点删除级联清理', () => {
  const dialogue = {
    id: 'dialogue.test', startNode: 'a',
    nodes: {
      a: { text: '起', nextNode: 'b' },
      b: { text: '中', nextNode: 'c', choices: [{ id: 'ch1', text: '去c', nextNode: 'c' }] },
      c: { text: '终' }
    }
  };

  it('删除节点时把其他节点指向它的 nextNode/choices 引用置空并计数', () => {
    const editor = buildBare({ dialogues: [dialogue] });
    const cleaned = editor._cleanupNodeReferences(dialogue, 'c');
    expect(cleaned).toBe(2);
    expect(dialogue.nodes.b.nextNode).toBeNull();
    expect(dialogue.nodes.b.choices[0].nextNode).toBeNull();
    // a→b 的引用与被删节点无关，保持不变
    expect(dialogue.nodes.a.nextNode).toBe('b');
  });

  it('删除节点自身不参与清理；无引用时计数为 0', () => {
    const editor = buildBare({ dialogues: [dialogue] });
    expect(editor._cleanupNodeReferences(dialogue, 'a')).toBe(0);
    expect(dialogue.nodes.a.nextNode).toBe('b');
  });
});

describe('DialogueGraphEditor 对话 id 改名引用扫描', () => {
  const project = () => ({
    dialogues: [dialogue('dialogue.old')],
    triggers: [
      {
        id: 'trg_listen',
        when: { type: 'dialogueChoice', params: { id: 'dialogue.old', choiceId: 'save' } },
        do: []
      },
      {
        id: 'trg_start',
        when: { type: 'sceneEnter', params: {} },
        do: [{ action: 'startDialogue', params: { id: 'dialogue.old' } }]
      },
      {
        id: 'trg_branch',
        when: { type: 'dialogueEnd', params: { id: 'dialogue.old' } },
        do: [{ branch: [{ do: [{ action: 'dialogue.command', params: { dialogueId: 'dialogue.old', operation: 'start' } }] }] }]
      }
    ],
    quests: [{
      id: 'task.test',
      giver: { dialogueId: 'dialogue.old' },
      dialogueRefs: ['dialogue.old', 'dialogue.other'],
      steps: [{ id: 's1', type: 'dialogue', dialogueId: 'dialogue.old' }]
    }]
  });
  const dialogue = id => ({ id, title: id, startNode: 'start', nodes: { start: { text: '…' } } });

  it('全量识别触发器监听/启动/编排 + 任务步骤/dialogueRefs/giver 七类引用点', () => {
    const editor = buildBare(project());
    const sites = editor._dialogueReferenceSites('dialogue.old');
    expect(sites).toHaveLength(7);
    expect(sites.filter(site => site.kind === 'trigger')).toHaveLength(4);
    expect(sites.filter(site => site.kind === 'quest')).toHaveLength(3);
  });

  it('apply(newId) 原地更新全部引用点且不误伤其他对话引用', () => {
    const data = project();
    const editor = buildBare(data);
    editor._dialogueReferenceSites('dialogue.old').forEach(site => site.apply('dialogue.new'));

    expect(data.triggers[0].when.params.id).toBe('dialogue.new');
    expect(data.triggers[1].do[0].params.id).toBe('dialogue.new');
    expect(data.triggers[2].do[0].branch[0].do[0].params.dialogueId).toBe('dialogue.new');
    expect(data.quests[0].steps[0].dialogueId).toBe('dialogue.new');
    expect(data.quests[0].dialogueRefs).toEqual(['dialogue.new', 'dialogue.other']);
    expect(data.quests[0].giver.dialogueId).toBe('dialogue.new');
  });

  it('无引用的对话改名不产生引用点', () => {
    const editor = buildBare({ dialogues: [dialogue('dialogue.lonely')], triggers: [], quests: [] });
    expect(editor._dialogueReferenceSites('dialogue.lonely')).toEqual([]);
  });
});

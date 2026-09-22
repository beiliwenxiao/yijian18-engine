/**
 * 对话系统测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DialogueSystem } from './DialogueSystem.js';

describe('DialogueSystem', () => {
  let dialogueSystem;
  let testDialogue;

  beforeEach(() => {
    dialogueSystem = new DialogueSystem();
    
    // 创建测试对话
    testDialogue = {
      title: '测试对话',
      startNode: 'node1',
      nodes: {
        node1: {
          speaker: '张角',
          text: '你好，欢迎来到黄巾军。',
          nextNode: 'node2'
        },
        node2: {
          speaker: '张角',
          text: '你愿意加入我们吗？',
          choices: [
            { text: '愿意', nextNode: 'node3' },
            { text: '拒绝', nextNode: 'node4' }
          ]
        },
        node3: {
          speaker: '张角',
          text: '很好！欢迎加入！',
          nextNode: null
        },
        node4: {
          speaker: '张角',
          text: '那真是遗憾...',
          nextNode: null
        }
      }
    };

    dialogueSystem.registerDialogue('test_dialogue', testDialogue);
  });

  describe('对话注册', () => {
    it('应该能注册对话', () => {
      const result = dialogueSystem.registerDialogue('new_dialogue', {
        startNode: 'start',
        nodes: { start: { text: '测试' } }
      });
      
      expect(result).toBe(true);
      expect(dialogueSystem.getDialogue('new_dialogue')).toBeDefined();
    });

    it('应该拒绝无效的对话数据', () => {
      const result = dialogueSystem.registerDialogue(null, null);
      expect(result).toBe(false);
    });
  });

  describe('对话开始', () => {
    it('应该能开始对话', () => {
      const result = dialogueSystem.startDialogue('test_dialogue');
      
      expect(result).toBe(true);
      expect(dialogueSystem.isDialogueActive()).toBe(true);
      expect(dialogueSystem.getCurrentNode()).toBeDefined();
    });

    it('应该从起始节点开始', () => {
      dialogueSystem.startDialogue('test_dialogue');
      const node = dialogueSystem.getCurrentNode();
      
      expect(node.id).toBe('node1');
      expect(node.speaker).toBe('张角');
    });

    it('应该不能开始不存在的对话', () => {
      const result = dialogueSystem.startDialogue('nonexistent');
      
      expect(result).toBe(false);
      expect(dialogueSystem.isDialogueActive()).toBe(false);
    });

    it('应该在有对话进行时拒绝新对话', () => {
      dialogueSystem.startDialogue('test_dialogue');
      
      dialogueSystem.registerDialogue('test2', {
        startNode: 'start',
        nodes: { start: { text: '测试2' } }
      });
      
      const result = dialogueSystem.startDialogue('test2');
      expect(result).toBe(false);
    });

    it('同一场对话重复启动应幂等成功且不重置播放进度（场景代码与任务触发器双路编排收敛）', () => {
      dialogueSystem.registerDialogue('dup_dialogue', {
        startNode: 'node1',
        nodes: {
          node1: { text: '第一段', nextNode: 'node2' },
          node2: { text: '第二段' }
        }
      });
      dialogueSystem.startDialogue('dup_dialogue');
      // 推进到第二节点后，重复启动同一场对话
      dialogueSystem.goToNode('node2');
      expect(dialogueSystem.startDialogue('dup_dialogue')).toBe(true);
      // 进度未被重置（仍在 node2），对话未被中断
      expect(dialogueSystem.getCurrentNode().id).toBe('node2');
      expect(dialogueSystem.isDialogueActive()).toBe(true);
      // 幂等启动不重复写入历史
      const starts = dialogueSystem.getHistory().filter(entry => entry.type === 'start' && entry.dialogueId === 'dup_dialogue');
      expect(starts.length).toBe(1);
    });
  });

  describe('节点跳转', () => {
    beforeEach(() => {
      dialogueSystem.startDialogue('test_dialogue');
    });

    it('应该能跳转到指定节点', () => {
      const result = dialogueSystem.goToNode('node2');
      
      expect(result).toBe(true);
      expect(dialogueSystem.getCurrentNode().id).toBe('node2');
    });

    it('应该不能跳转到不存在的节点', () => {
      const result = dialogueSystem.goToNode('nonexistent');
      
      expect(result).toBe(false);
    });
  });

  describe('对话继续', () => {
    beforeEach(() => {
      dialogueSystem.startDialogue('test_dialogue');
      dialogueSystem.setTypewriterEnabled(false); // 禁用打字机效果以简化测试
    });

    it('应该能继续到下一个节点', () => {
      const result = dialogueSystem.continue();
      
      expect(result).toBe(true);
      expect(dialogueSystem.getCurrentNode().id).toBe('node2');
    });

    it('应该在有选项时不能直接继续', () => {
      dialogueSystem.continue(); // 到node2
      const result = dialogueSystem.continue();
      
      expect(result).toBe(false);
    });

    it('应该在最后一个节点时结束对话', () => {
      dialogueSystem.goToNode('node3');
      dialogueSystem.continue();
      
      expect(dialogueSystem.isDialogueActive()).toBe(false);
    });
  });

  describe('选择分支', () => {
    beforeEach(() => {
      dialogueSystem.startDialogue('test_dialogue');
      dialogueSystem.setTypewriterEnabled(false);
      dialogueSystem.continue(); // 到node2（有选择）
    });

    it('应该能选择对话选项', () => {
      const result = dialogueSystem.selectChoice(0); // 选择"愿意"
      
      expect(result).toBe(true);
      expect(dialogueSystem.getCurrentNode().id).toBe('node3');
    });

    it('应该能选择不同的选项', () => {
      const result = dialogueSystem.selectChoice(1); // 选择"拒绝"
      
      expect(result).toBe(true);
      expect(dialogueSystem.getCurrentNode().id).toBe('node4');
    });

    it('应该不能选择不存在的选项', () => {
      const result = dialogueSystem.selectChoice(99);
      
      expect(result).toBe(false);
    });
  });

  describe('打字机效果', () => {
    beforeEach(() => {
      dialogueSystem.setTypewriterEnabled(true);
      dialogueSystem.setTypewriterSpeed(10); // 加快速度以便测试
    });

    it('应该在开始时启动打字机效果', () => {
      dialogueSystem.startDialogue('test_dialogue');
      
      expect(dialogueSystem.isTyping()).toBe(true);
    });

    it('应该逐字显示文本', () => {
      dialogueSystem.startDialogue('test_dialogue');
      
      // update() 接收秒；10ms/字时每次推进 10ms，避免第一次更新就显示完整文本
      dialogueSystem.update(0.01);
      const displayed1 = dialogueSystem.getDisplayedText();
      
      dialogueSystem.update(0.01);
      const displayed2 = dialogueSystem.getDisplayedText();
      
      expect(displayed2.length).toBeGreaterThan(displayed1.length);
    });

    it('应该能跳过打字机效果', () => {
      dialogueSystem.startDialogue('test_dialogue');
      const fullText = dialogueSystem.getCurrentNode().text;
      
      dialogueSystem.skipTypewriter();
      
      expect(dialogueSystem.isTyping()).toBe(false);
      expect(dialogueSystem.getDisplayedText()).toBe(fullText);
    });

    it('应该在打字完成后停止', () => {
      dialogueSystem.startDialogue('test_dialogue');
      const fullText = dialogueSystem.getCurrentNode().text;
      
      // 更新足够长的时间
      for (let i = 0; i < fullText.length + 10; i++) {
        dialogueSystem.update(10);
      }
      
      expect(dialogueSystem.isTyping()).toBe(false);
    });
  });

  describe('回调函数', () => {
    it('应该触发开始回调', () => {
      const callback = vi.fn();
      dialogueSystem.onStart(callback);
      
      dialogueSystem.startDialogue('test_dialogue');
      
      expect(callback).toHaveBeenCalled();
    });

    it('应该触发节点变化回调', () => {
      const callback = vi.fn();
      dialogueSystem.onNodeChange(callback);
      
      dialogueSystem.startDialogue('test_dialogue');
      
      expect(callback).toHaveBeenCalled();
    });

    it('应该触发结束回调', () => {
      const callback = vi.fn();
      dialogueSystem.onEnd(callback);
      
      dialogueSystem.startDialogue('test_dialogue');
      dialogueSystem.endDialogue();
      
      expect(callback).toHaveBeenCalled();
    });

    it('应该触发选择回调', () => {
      const callback = vi.fn();
      dialogueSystem.onChoice(callback);
      
      dialogueSystem.setTypewriterEnabled(false);
      dialogueSystem.startDialogue('test_dialogue');
      dialogueSystem.continue(); // 到node2
      dialogueSystem.selectChoice(0);
      
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('对话历史', () => {
    it('应该记录对话历史', () => {
      dialogueSystem.startDialogue('test_dialogue');
      
      const history = dialogueSystem.getHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it('应该能清除历史', () => {
      dialogueSystem.startDialogue('test_dialogue');
      dialogueSystem.clearHistory();
      
      const history = dialogueSystem.getHistory();
      expect(history.length).toBe(0);
    });
  });

  describe('对话变量', () => {
    beforeEach(() => {
      dialogueSystem.startDialogue('test_dialogue');
    });

    it('应该能设置和获取变量', () => {
      dialogueSystem.setVariable('playerName', '张三');
      
      expect(dialogueSystem.getVariable('playerName')).toBe('张三');
    });

    it('应该在没有对话时返回undefined', () => {
      dialogueSystem.endDialogue();
      
      expect(dialogueSystem.getVariable('test')).toBeUndefined();
    });
  });

  describe('条件节点', () => {
    it('应该跳过条件不满足的节点', () => {
      dialogueSystem.registerDialogue('conditional', {
        startNode: 'node1',
        nodes: {
          node1: {
            text: '节点1',
            nextNode: 'node2'
          },
          node2: {
            text: '节点2（条件不满足）',
            condition: () => false,
            nextNode: 'node3'
          },
          node3: {
            text: '节点3',
            nextNode: null
          }
        }
      });

      dialogueSystem.setTypewriterEnabled(false);
      dialogueSystem.startDialogue('conditional');
      dialogueSystem.continue();
      
      // 应该跳过node2，直接到node3
      expect(dialogueSystem.getCurrentNode().text).toBe('节点3');
    });
  });

  describe('节点动作', () => {
    it('应该执行节点动作', () => {
      const action = vi.fn();
      
      dialogueSystem.registerDialogue('action_test', {
        startNode: 'node1',
        nodes: {
          node1: {
            text: '测试',
            action,
            nextNode: null
          }
        }
      });

      dialogueSystem.startDialogue('action_test');
      
      expect(action).toHaveBeenCalled();
    });

    it('选项内嵌 action 不执行，副作用必须由 dialogueChoice Trigger 编排', () => {
      const action = vi.fn();
      
      dialogueSystem.registerDialogue('choice_action', {
        startNode: 'node1',
        nodes: {
          node1: {
            text: '选择',
            choices: [
              { text: '选项1', action, nextNode: null }
            ]
          }
        }
      });

      dialogueSystem.setTypewriterEnabled(false);
      dialogueSystem.startDialogue('choice_action');
      dialogueSystem.selectChoice(0);
      expect(action).not.toHaveBeenCalled();
    });

    it('仅在 dialogueChoice 编排成功后推进节点，失败保持 node/history/completed', async () => {
      dialogueSystem.registerDialogue('choice_commit', {
        startNode: 'start',
        nodes: {
          start: { text: '选择', choices: [{ id: 'yes', text: '确认', nextNode: 'done' }] },
          done: { text: '完成' }
        }
      });
      dialogueSystem.setTypewriterEnabled(false);
      dialogueSystem.startDialogue('choice_commit');
      const historyBefore = dialogueSystem.getHistory(100);
      dialogueSystem.setChoiceDispatcher(() => Promise.resolve({ ok: false, code: 'triggerFailed' }));
      expect(await dialogueSystem.selectChoice(0)).toBe(false);
      expect(dialogueSystem.getCurrentNode().id).toBe('start');
      expect(dialogueSystem.getHistory(100)).toEqual(historyBefore);
      expect(dialogueSystem.hasCompleted('choice_commit')).toBe(false);

      const dispatch = vi.fn(() => Promise.resolve({ ok: true }));
      dialogueSystem.setChoiceDispatcher(dispatch);
      expect(await dialogueSystem.selectChoice(0)).toBe(true);
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: 'dialogueChoice', id: 'choice_commit', dialogueId: 'choice_commit',
        choiceId: 'yes', index: 0, nextNode: 'done'
      }), {});
      expect(dialogueSystem.getCurrentNode().id).toBe('done');
      expect(dialogueSystem.getHistory(100).at(-2)).toMatchObject({ type: 'choice', choiceId: 'yes' });
    });
  });

  describe('状态保存和加载', () => {
    it('应该能保存状态', () => {
      dialogueSystem.startDialogue('test_dialogue');
      dialogueSystem.setVariable('test', 'value');
      
      const state = dialogueSystem.saveState();
      
      expect(state.currentDialogueId).toBe('test_dialogue');
      expect(state.currentNodeId).toBe('node1');
      expect(state.variables.test).toBe('value');
    });

    it('应该能加载状态', () => {
      const state = {
        currentDialogueId: 'test_dialogue',
        currentNodeId: 'node2',
        variables: { test: 'value' },
        history: []
      };

      dialogueSystem.loadState(state);
      
      expect(dialogueSystem.isDialogueActive()).toBe(true);
      expect(dialogueSystem.getCurrentNode().id).toBe('node2');
      expect(dialogueSystem.getVariable('test')).toBe('value');
    });
  });

  describe('系统重置', () => {
    it('应该能重置系统', () => {
      dialogueSystem.startDialogue('test_dialogue');
      dialogueSystem.reset();
      
      expect(dialogueSystem.isDialogueActive()).toBe(false);
      expect(dialogueSystem.getCurrentNode()).toBeNull();
    });

    it('应该能清除所有对话', () => {
      dialogueSystem.clearAllDialogues();
      
      expect(dialogueSystem.getDialogue('test_dialogue')).toBeNull();
    });
  });
});

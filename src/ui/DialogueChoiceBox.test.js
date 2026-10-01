/**
 * DialogueChoiceBox 单元测试：与 DialogueBox 拆分的独立选项弹窗
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DialogueChoiceBox } from './DialogueChoiceBox.js';

function createMockDialogueSystem({ choices = [], typing = false, selectImpl = null } = {}) {
  return {
    active: choices.length > 0,
    isDialogueActive() { return this.active; },
    getCurrentNode: () => ({ id: 'judge', choices }),
    isTyping: () => typing,
    selectChoice: selectImpl || (() => true)
  };
}

function createChoiceBox(dialogueSystem, overrides = {}) {
  return new DialogueChoiceBox({
    dialogueSystem,
    x: 430,
    y: 490,
    width: 420,
    height: 120,
    visible: false,
    ...overrides
  });
}

const TWO_CHOICES = [
  { text: '杀了它', next: 'killOrder' },
  { text: '救他', next: 'saveOrder' }
];

describe('DialogueChoiceBox', () => {
  let dialogueSystem;
  let choiceBox;

  describe('初始化与布局', () => {
    beforeEach(() => {
      dialogueSystem = createMockDialogueSystem();
      choiceBox = createChoiceBox(dialogueSystem);
    });

    it('应该正确初始化', () => {
      expect(choiceBox.x).toBe(430);
      expect(choiceBox.y).toBe(490);
      expect(choiceBox.width).toBe(420);
      expect(choiceBox.height).toBe(120);
      expect(choiceBox.zIndex).toBe(210);
      expect(choiceBox.visible).toBe(false);
      expect(choiceBox.hoveredChoiceIndex).toBe(-1);
    });

    it('setLayoutRect 应保存 UI 编辑器矩形并在 update 时应用', () => {
      choiceBox.setLayoutRect({ x: 100, y: 200, width: 300, height: 90 });
      choiceBox.update(16);
      expect(choiceBox.x).toBe(100);
      expect(choiceBox.y).toBe(200);
      expect(choiceBox.width).toBe(300);
      expect(choiceBox.height).toBe(90);
    });

    it('setLayoutRect(null) 应清除矩形并回退构造几何', () => {
      choiceBox.setLayoutRect({ x: 1, y: 2, width: 3, height: 4 });
      choiceBox.setLayoutRect(null);
      choiceBox.update(16);
      expect(choiceBox.x).toBe(430);
      expect(choiceBox.y).toBe(490);
    });
  });

  describe('显隐跟随对话状态', () => {
    it('当前节点有 choices 时可见，无 choices 时隐藏', () => {
      dialogueSystem = createMockDialogueSystem({ choices: TWO_CHOICES });
      choiceBox = createChoiceBox(dialogueSystem);
      choiceBox.update(16);
      expect(choiceBox.visible).toBe(true);

      dialogueSystem.getCurrentNode = () => ({ id: 'saveOrder' });
      choiceBox.update(16);
      expect(choiceBox.visible).toBe(false);
    });

    it('打字机进行中隐藏', () => {
      dialogueSystem = createMockDialogueSystem({ choices: TWO_CHOICES, typing: true });
      choiceBox = createChoiceBox(dialogueSystem);
      choiceBox.update(16);
      expect(choiceBox.visible).toBe(false);
    });

    it('无对话系统时不显示', () => {
      choiceBox = createChoiceBox(null);
      choiceBox.update(16);
      expect(choiceBox.visible).toBe(false);
    });

    it('高度应按选项数量向下增长', () => {
      dialogueSystem = createMockDialogueSystem({ choices: TWO_CHOICES });
      choiceBox = createChoiceBox(dialogueSystem);
      choiceBox.update(16);
      const expected = 14 * 2 + 2 * 44 + 1 * 10; // padding*2 + n*choiceHeight + (n-1)*spacing
      expect(choiceBox.height).toBe(expected);
    });
  });

  describe('鼠标交互', () => {
    beforeEach(() => {
      dialogueSystem = createMockDialogueSystem({ choices: TWO_CHOICES });
      choiceBox = createChoiceBox(dialogueSystem);
      choiceBox.update(16);
    });

    it('命中选项时调用 dialogueSystem.selectChoice 并触发 onSelect', () => {
      const selected = [];
      choiceBox.onSelect = (index, choice) => selected.push({ index, choice });

      const rect = choiceBox.choiceRects(TWO_CHOICES)[0];
      const handled = choiceBox.handleMouseClick(rect.x + 5, rect.y + 5);

      expect(handled).toBe(true);
      expect(selected).toEqual([{ index: 0, choice: TWO_CHOICES[0] }]);
    });

    it('selectChoice 返回 Promise 时异步回调 onSelect', async () => {
      let resolveSelect;
      dialogueSystem.selectChoice = () => new Promise(resolve => { resolveSelect = resolve; });
      const selected = [];
      choiceBox.onSelect = (index, choice) => selected.push(index);

      const rect = choiceBox.choiceRects(TWO_CHOICES)[1];
      expect(choiceBox.handleMouseClick(rect.x + 5, rect.y + 5)).toBe(true);
      expect(selected).toEqual([]);

      resolveSelect(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(selected).toEqual([1]);
    });

    it('selectChoice 返回 false 时不触发 onSelect', () => {
      dialogueSystem.selectChoice = () => false;
      const selected = [];
      choiceBox.onSelect = index => selected.push(index);

      const rect = choiceBox.choiceRects(TWO_CHOICES)[0];
      expect(choiceBox.handleMouseClick(rect.x + 5, rect.y + 5)).toBe(true);
      expect(selected).toEqual([]);
    });

    it('未命中任何选项时不消费点击', () => {
      expect(choiceBox.handleMouseClick(5, 5)).toBe(false);
    });

    it('不可见或不可交互时忽略点击', () => {
      choiceBox.visible = false;
      const rect = choiceBox.choiceRects(TWO_CHOICES)[0];
      expect(choiceBox.handleMouseClick(rect.x + 5, rect.y + 5)).toBe(false);

      choiceBox.visible = true;
      choiceBox.canInteract = false;
      expect(choiceBox.handleMouseClick(rect.x + 5, rect.y + 5)).toBe(false);
    });

    it('handleMouseMove 更新悬停索引', () => {
      const rects = choiceBox.choiceRects(TWO_CHOICES);
      choiceBox.handleMouseMove(rects[1].x + 5, rects[1].y + 5);
      expect(choiceBox.hoveredChoiceIndex).toBe(1);
      choiceBox.handleMouseMove(-100, -100);
      expect(choiceBox.hoveredChoiceIndex).toBe(-1);
    });

    it('containsPoint 判断点是否在弹窗内', () => {
      expect(choiceBox.containsPoint(430 + 10, 490 + 10)).toBe(true);
      expect(choiceBox.containsPoint(10, 10)).toBe(false);
    });
  });

  describe('显隐控制', () => {
    beforeEach(() => {
      dialogueSystem = createMockDialogueSystem();
      choiceBox = createChoiceBox(dialogueSystem);
    });

    it('show/hide 切换可见性与交互', () => {
      choiceBox.show();
      expect(choiceBox.visible).toBe(true);
      expect(choiceBox.canInteract).toBe(true);
      choiceBox.hide();
      expect(choiceBox.visible).toBe(false);
      expect(choiceBox.canInteract).toBe(false);
    });

    it('对话结束后点击选择会自动隐藏', () => {
      dialogueSystem.active = true;
      dialogueSystem.getCurrentNode = () => ({ id: 'judge', choices: TWO_CHOICES });
      dialogueSystem.selectChoice = () => {
        dialogueSystem.active = false;
        return true;
      };
      choiceBox.show();
      choiceBox.update(16);
      expect(choiceBox.visible).toBe(true);
      const rect = choiceBox.choiceRects(TWO_CHOICES)[0];
      choiceBox.handleMouseClick(rect.x + 5, rect.y + 5);
      expect(choiceBox.visible).toBe(false);
    });
  });
});

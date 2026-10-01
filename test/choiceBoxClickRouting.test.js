/************************************************************
 * 复现：PC 端点击对话选项无反应。
 * 用桩 InputManager 驱动 SceneWorldInteraction.handleUIClick，
 * 验证点击选项按钮是否到达 DialogueChoiceBox.handleMouseClick → selectChoice。
 ************************************************************/

import { describe, it, expect } from 'vitest';
import { SceneWorldInteraction } from '../src/core/scene/SceneWorldInteraction.js';
import { DialogueChoiceBox } from '../src/ui/DialogueChoiceBox.js';

function createInputStub() {
  const state = {
    clicked: false,
    handled: false,
    x: 0,
    y: 0,
    button: 0
  };
  return {
    state,
    isMouseClicked: () => state.clicked,
    isMouseClickHandled: () => state.handled,
    markMouseClickHandled: () => { state.handled = true; },
    getMousePosition: () => ({ x: state.x, y: state.y }),
    getMouseButton: () => state.button
  };
}

function createDialogueSystemStub() {
  const calls = { selectChoice: [] };
  return {
    calls,
    active: true,
    isDialogueActive: () => true,
    getCurrentNode: () => ({
      id: 'judge',
      choices: [
        { text: '杀了：乱世自有一套规矩', next: 'killOrder' },
        { text: '救他：黄巾不杀无辜之人', next: 'saveOrder' }
      ]
    }),
    isTyping: () => false,
    selectChoice: index => {
      calls.selectChoice.push(index);
      return true;
    }
  };
}

describe('对话选项点击路由（复现 PC 点击无反应）', () => {
  it('点击选项按钮中心应到达 selectChoice', () => {
    const dialogueSystem = createDialogueSystemStub();
    // 与 ScenePanelLayout 相同的默认几何（UI 编辑器 dialogue-choices 矩形）
    const choiceBox = new DialogueChoiceBox({
      dialogueSystem,
      x: 441,
      y: 531,
      width: 420,
      height: 120,
      visible: false,
      zIndex: 210
    });
    choiceBox.update(16); // 驱动 visible 跟随当前节点
    expect(choiceBox.visible).toBe(true);

    const rects = choiceBox.choiceRects(dialogueSystem.getCurrentNode().choices);
    const input = createInputStub();
    const scene = {
      inputManager: input,
      dialogueSystem,
      dialogueChoiceBox: choiceBox,
      dialogueBox: { visible: true, handleMouseClick: () => false },
      minimap: null,
      uiClickHandler: { handleClick: () => false },
      backpackPanel: null
    };
    const interaction = new SceneWorldInteraction(scene, {
      entityStore: { removeMany() {} }
    });

    // 点击第一个选项按钮中心
    input.state.clicked = true;
    input.state.x = rects[0].x + rects[0].width / 2;
    input.state.y = rects[0].y + rects[0].height / 2;
    interaction.handleUIClick();

    expect(dialogueSystem.calls.selectChoice, 'selectChoice 应被调用').toEqual([0]);
    expect(input.state.handled, '点击应被标记消费').toBe(true);
  });

  it('选项按钮矩形应完整落在弹窗内（两选项）', () => {
    const dialogueSystem = createDialogueSystemStub();
    const choiceBox = new DialogueChoiceBox({
      dialogueSystem, x: 441, y: 531, width: 420, height: 120, visible: false
    });
    choiceBox.update(16);
    const rects = choiceBox.choiceRects(dialogueSystem.getCurrentNode().choices);
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(choiceBox.x);
      expect(rect.y).toBeGreaterThanOrEqual(choiceBox.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(choiceBox.x + choiceBox.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(choiceBox.y + choiceBox.height);
    }
  });
});

describe('对话选项手柄/键盘焦点（A 确认 + 焦点导航）', () => {
  function createInputStub({ downKeys = [], pressedKeys = [] } = {}) {
    return {
      isKeyDown: key => downKeys.includes(key),
      isKeyPressed: key => pressedKeys.includes(key)
    };
  }

  function createSetup() {
    const dialogueSystem = createDialogueSystemStub();
    const choiceBox = new DialogueChoiceBox({
      dialogueSystem, x: 441, y: 531, width: 420, height: 120, visible: false
    });
    choiceBox.update(16);
    return { dialogueSystem, choiceBox };
  }

  it('弹窗出现时焦点默认聚焦第一项', () => {
    const { choiceBox } = createSetup();
    expect(choiceBox.visible).toBe(true);
    expect(choiceBox.focusedIndex).toBe(0);
  });

  it('手柄 A（虚拟 e 键）确认焦点项', () => {
    const { dialogueSystem, choiceBox } = createSetup();
    const input = createInputStub({ pressedKeys: ['e'] });
    const consumed = choiceBox.handleConfirmInput(input);
    expect(consumed).toBe(true);
    expect(dialogueSystem.calls.selectChoice).toEqual([0]);
  });

  it('摇杆/方向键下沿切换焦点到第二项，再按 A 确认', () => {
    const { dialogueSystem, choiceBox } = createSetup();
    // 第一帧：摇杆推下（down 按住）→ 沿触发切到 1
    choiceBox.handleConfirmInput(createInputStub({ downKeys: ['down'] }));
    expect(choiceBox.focusedIndex).toBe(1);
    // 持续按住：不重复切换
    choiceBox.handleConfirmInput(createInputStub({ downKeys: ['down'] }));
    expect(choiceBox.focusedIndex).toBe(1);
    // 松开摇杆，按 A 确认第二项
    choiceBox.handleConfirmInput(createInputStub({ pressedKeys: ['e'] }));
    expect(dialogueSystem.calls.selectChoice).toEqual([1]);
  });

  it('焦点在第一项时向上循环到最后一项', () => {
    const { choiceBox } = createSetup();
    choiceBox.handleConfirmInput(createInputStub({ downKeys: ['up'] }));
    expect(choiceBox.focusedIndex).toBe(1);
  });

  it('鼠标悬停同步焦点', () => {
    const { choiceBox } = createSetup();
    const rect = choiceBox.choiceRects(choiceBox.currentChoices())[1];
    choiceBox.handleMouseMove(rect.x + 5, rect.y + 5);
    expect(choiceBox.focusedIndex).toBe(1);
    expect(choiceBox.hoveredChoiceIndex).toBe(1);
  });

  it('不可见时不消费确认输入', () => {
    const { dialogueSystem, choiceBox } = createSetup();
    choiceBox.visible = false;
    const consumed = choiceBox.handleConfirmInput(createInputStub({ pressedKeys: ['e'] }));
    expect(consumed).toBe(false);
    expect(dialogueSystem.calls.selectChoice).toEqual([]);
  });
});

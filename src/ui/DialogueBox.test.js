/**
 * DialogueBox 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DialogueBox } from './DialogueBox.js';

describe('DialogueBox', () => {
  let dialogueBox;

  beforeEach(() => {
    // 创建对话框（不依赖其他系统）
    dialogueBox = new DialogueBox({
      x: 50,
      y: 450,
      width: 1100,
      height: 230,
      visible: false
    });
  });

  describe('初始化', () => {
    it('应该正确初始化对话框', () => {
      expect(dialogueBox).toBeDefined();
      expect(dialogueBox.x).toBe(50);
      expect(dialogueBox.y).toBe(450);
      expect(dialogueBox.width).toBe(1100);
      expect(dialogueBox.height).toBe(230);
      expect(dialogueBox.visible).toBe(false);
    });

    it('应该正确初始化交互状态', () => {
      expect(dialogueBox.choiceBox).toBeNull();
      expect(dialogueBox.canInteract).toBe(true);
    });

    it('应该正确初始化布局配置', () => {
      expect(dialogueBox.padding).toBe(20);
      expect(dialogueBox.portraitSize).toBe(100);
    });
  });

  describe('显示和隐藏', () => {
    it('应该能够显示对话框', () => {
      dialogueBox.show();
      expect(dialogueBox.visible).toBe(true);
      expect(dialogueBox.canInteract).toBe(true);
    });

    it('应该能够隐藏对话框', () => {
      dialogueBox.show();
      dialogueBox.hide();
      expect(dialogueBox.visible).toBe(false);
      expect(dialogueBox.canInteract).toBe(false);
    });

    it('挂接的选项弹窗应随对话框一起显隐', () => {
      const choiceBox = {
        visible: false,
        show: function () { this.visible = true; },
        hide: function () { this.visible = false; }
      };
      dialogueBox.setChoiceBox(choiceBox);
      dialogueBox.show();
      expect(choiceBox.visible).toBe(true);
      dialogueBox.hide();
      expect(choiceBox.visible).toBe(false);
    });
  });

  describe('设置方法', () => {
    it('应该能够设置打字机音效键名', () => {
      dialogueBox.setTypewriterSoundKey('new_type_sound');
      expect(dialogueBox.typewriterSoundKey).toBe('new_type_sound');
    });
  });

  describe('鼠标交互', () => {
    it('应该忽略对话框外的点击', () => {
      dialogueBox.visible = true;
      
      // 点击对话框外
      const handled = dialogueBox.handleMouseClick(10, 10);
      expect(handled).toBe(false);
    });

    it('不可见时应该忽略点击', () => {
      dialogueBox.visible = false;
      
      // 点击对话框内
      const handled = dialogueBox.handleMouseClick(100, 500);
      expect(handled).toBe(false);
    });
  });
});

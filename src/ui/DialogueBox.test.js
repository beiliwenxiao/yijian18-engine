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

  describe('面板布局消费（PanelLayout dialogue-* 面板）', () => {
    const PANEL_DEF = {
      id: 'dialogue-portrait',
      width: 700,
      height: 230,
      parts: [
        { id: 'speaker', type: 'text', x: 20, y: 18, width: 400, height: 26, fontSize: 20, color: '#FFD700' },
        { id: 'portrait', type: 'image', x: 20, y: 60, width: 100, height: 100 },
        { id: 'text', type: 'text', x: 135, y: 60, width: 545, height: 150, fontSize: 18 },
        { id: 'continue', type: 'text', x: 600, y: 198, width: 80, height: 22, align: 'right' }
      ]
    };

    function createMockDialogueSystem(boxType = 'portrait') {
      return {
        active: true,
        isDialogueActive: () => true,
        currentDialogue: { presentation: { boxType } },
        getCurrentNode: () => ({ id: 'n1', speaker: '张角', text: '你好' }),
        isTyping: () => false,
        getDisplayedText: () => '你好'
      };
    }

    it('applyDialoguePanelLayouts 保存面板定义，未传时回退内置布局', () => {
      dialogueBox.applyDialoguePanelLayouts({ portrait: PANEL_DEF });
      expect(dialogueBox.dialoguePanelDefs.portrait).toBe(PANEL_DEF);

      dialogueBox.applyDialoguePanelLayouts(null);
      expect(dialogueBox.dialoguePanelDefs).toBeNull();
      // 无面板：立绘区走内置硬编码
      dialogueBox.dialogueSystem = createMockDialogueSystem();
      const region = dialogueBox._portraitRegion(dialogueBox._layoutMetrics());
      expect(region).toEqual({ x: 70, y: 510, width: 100, height: 100 });
    });

    it('portrait part 按外框实际尺寸缩放换算', () => {
      dialogueBox.applyDialoguePanelLayouts({ portrait: PANEL_DEF });
      dialogueBox.dialogueSystem = createMockDialogueSystem();
      // 外框 50,450 1100×230；基准 700×230 → 宽比 1100/700、高比 1
      const region = dialogueBox._portraitRegion(dialogueBox._layoutMetrics());
      expect(region.x).toBeCloseTo(50 + 20 * (1100 / 700), 5);
      expect(region.y).toBe(510); // 450 + 60*1
      expect(region.width).toBeCloseTo(100 * (1100 / 700), 5);
      expect(region.height).toBe(100);
    });

    it('形态无对应面板时该形态回退内置布局', () => {
      dialogueBox.applyDialoguePanelLayouts({ portrait: PANEL_DEF });
      dialogueBox.dialogueSystem = createMockDialogueSystem('halfBody');
      const region = dialogueBox._portraitRegion(dialogueBox._layoutMetrics());
      // halfBody 无面板定义 → 硬编码位置
      expect(region.x).toBe(70);
      expect(region.y).toBe(510);
    });
  });
});

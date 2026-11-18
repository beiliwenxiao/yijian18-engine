/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

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

  describe('内容库对话头像回退链（dialogueAvatar）', () => {
    function createImage() {
      return { complete: true, naturalWidth: 64, naturalHeight: 64 };
    }

    function createAssetManager(images) {
      return {
        getImage: imageId => images.get(imageId) || null
      };
    }

    it('节点 portrait 缺失时回退当前交互实体的 dialogueAvatar', () => {
      const npcImage = createImage();
      const box = new DialogueBox({
        x: 0, y: 0, width: 700, height: 230, visible: false,
        getAssetManager: () => createAssetManager(new Map([['ui.dialogue.npc', npcImage]]))
      });
      box.setActiveEntityPortrait({ dialogueAvatarImageId: 'ui.dialogue.npc' });

      const source = box._resolvePortraitSource({}, {});
      expect(source.img).toBe(npcImage);
      expect(source.fallbackKey).toBeNull();
    });

    it('无交互实体时回退主角 dialogueAvatar', () => {
      const playerImage = createImage();
      const box = new DialogueBox({
        x: 0, y: 0, width: 700, height: 230, visible: false,
        getAssetManager: () => createAssetManager(new Map([['ui.dialogue.player', playerImage]])),
        getPlayerEntity: () => ({ dialogueAvatarImageId: 'ui.dialogue.player' })
      });

      const source = box._resolvePortraitSource({}, {});
      expect(source.img).toBe(playerImage);
    });

    it('节点 portrait 优先于实体对话头像', () => {
      const npcImage = createImage();
      const box = new DialogueBox({
        x: 0, y: 0, width: 700, height: 230, visible: false,
        getAssetManager: () => createAssetManager(new Map([['ui.dialogue.npc', npcImage]]))
      });
      box.setActiveEntityPortrait({ dialogueAvatarImageId: 'ui.dialogue.npc' });

      // 无 portraits 配置时节点 key 走 PortraitsConfig 查找（未命中 → img 为 null，key 保留）
      const source = box._resolvePortraitSource({ portrait: 'zhangjiao' }, {});
      expect(source.img).not.toBe(npcImage);
      expect(source.fallbackKey).toBe('zhangjiao');
    });

    it('对话头像未配置时返回空来源（走既有占位兜底）', () => {
      const box = new DialogueBox({
        x: 0, y: 0, width: 700, height: 230, visible: false,
        getAssetManager: () => createAssetManager(new Map()),
        getPlayerEntity: () => null
      });
      box.setActiveEntityPortrait({});

      const source = box._resolvePortraitSource({}, {});
      expect(source.img).toBeNull();
      expect(source.fallbackKey).toBeNull();
    });
  });
});

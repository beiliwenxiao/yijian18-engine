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
 * TutorialTooltip 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TutorialTooltip } from './TutorialTooltip.js';

describe('TutorialTooltip', () => {
  let tooltip;
  let mockAudioManager;
  let mockTutorialSystem;

  beforeEach(() => {
    // 创建模拟音频管理器
    mockAudioManager = {
      hasSound: vi.fn(() => true),
      playSound: vi.fn()
    };

    // 创建模拟教程系统
    mockTutorialSystem = {
      tutorials: new Map()
    };

    // 创建提示框实例
    tooltip = new TutorialTooltip({
      audioManager: mockAudioManager,
      tutorialSystem: mockTutorialSystem
    });
  });

  describe('初始化', () => {
    it('应该正确初始化', () => {
      expect(tooltip).toBeDefined();
      expect(tooltip.visible).toBe(false);
      expect(tooltip.currentTutorial).toBeNull();
      expect(tooltip.currentStepIndex).toBe(0);
    });

    it('应该设置正确的默认值', () => {
      expect(tooltip.width).toBe(400);
      expect(tooltip.height).toBe(150);
      expect(tooltip.zIndex).toBe(300);
      expect(tooltip.arrowDirection).toBe('down');
    });
  });

  describe('显示教程', () => {
    it('应该显示有效的教程', () => {
      const tutorial = {
        id: 'test_tutorial',
        title: '测试教程',
        steps: [
          { text: '第一步', targetElement: null }
        ],
        pauseGame: false
      };

      tooltip.showTutorial(tutorial);

      expect(tooltip.visible).toBe(true);
      expect(tooltip.currentTutorial).toBe(tutorial);
      expect(tooltip.currentStepIndex).toBe(0);
    });

    it('应该拒绝无效的教程', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      tooltip.showTutorial(null);
      expect(tooltip.visible).toBe(false);

      tooltip.showTutorial({ steps: [] });
      expect(tooltip.visible).toBe(false);

      consoleSpy.mockRestore();
    });

    it('应该播放显示音效', () => {
      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }]
      };

      tooltip.showTutorial(tutorial);

      expect(mockAudioManager.playSound).toHaveBeenCalledWith(
        'tutorial_show',
        { volume: 0.5 }
      );
    });
  });

  describe('步骤导航', () => {
    beforeEach(() => {
      const tutorial = {
        id: 'multi_step',
        title: '多步骤教程',
        steps: [
          { text: '第一步' },
          { text: '第二步' },
          { text: '第三步' }
        ]
      };
      tooltip.showTutorial(tutorial);
    });

    it('应该前进到下一步', () => {
      expect(tooltip.currentStepIndex).toBe(0);

      tooltip.nextStep();
      expect(tooltip.currentStepIndex).toBe(1);

      tooltip.nextStep();
      expect(tooltip.currentStepIndex).toBe(2);
    });

    it('应该后退到上一步', () => {
      tooltip.currentStepIndex = 2;

      tooltip.prevStep();
      expect(tooltip.currentStepIndex).toBe(1);

      tooltip.prevStep();
      expect(tooltip.currentStepIndex).toBe(0);
    });

    it('在第一步时不应该后退', () => {
      expect(tooltip.currentStepIndex).toBe(0);

      tooltip.prevStep();
      expect(tooltip.currentStepIndex).toBe(0);
    });

    it('在最后一步时应该完成教程', () => {
      const onComplete = vi.fn();
      tooltip.onComplete = onComplete;

      tooltip.currentStepIndex = 2;
      tooltip.nextStep();

      expect(tooltip.visible).toBe(false);
      expect(onComplete).toHaveBeenCalled();
    });

    it('应该播放步骤切换音效', () => {
      mockAudioManager.playSound.mockClear();

      tooltip.nextStep();

      expect(mockAudioManager.playSound).toHaveBeenCalledWith(
        'tutorial_step',
        { volume: 0.5 }
      );
    });
  });

  describe('跳过教程', () => {
    it('应该跳过教程', () => {
      const onSkip = vi.fn();
      tooltip.onSkip = onSkip;

      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }, { text: '步骤2' }]
      };
      tooltip.showTutorial(tutorial);

      tooltip.skipTutorial();

      expect(tooltip.visible).toBe(false);
      expect(tooltip.currentTutorial).toBeNull();
      expect(onSkip).toHaveBeenCalled();
    });
  });

  describe('完成教程', () => {
    it('应该完成教程', () => {
      const onComplete = vi.fn();
      tooltip.onComplete = onComplete;

      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }]
      };
      tooltip.showTutorial(tutorial);

      tooltip.completeTutorial();

      expect(tooltip.visible).toBe(false);
      expect(tooltip.currentTutorial).toBeNull();
      expect(onComplete).toHaveBeenCalledWith(tutorial);
    });

    it('应该播放完成音效', () => {
      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }]
      };
      tooltip.showTutorial(tutorial);

      mockAudioManager.playSound.mockClear();
      tooltip.completeTutorial();

      expect(mockAudioManager.playSound).toHaveBeenCalledWith(
        'tutorial_complete',
        { volume: 0.7 }
      );
    });
  });

  describe('位置计算', () => {
    it('无目标元素时应该居中显示', () => {
      tooltip.targetElement = null;
      tooltip.calculatePosition();

      expect(tooltip.x).toBe((800 - tooltip.width) / 2);
      expect(tooltip.y).toBe(100);
    });

    it('应该根据箭头方向计算位置 - down', () => {
      tooltip.targetElement = { x: 300, y: 100, width: 50, height: 50 };
      tooltip.arrowDirection = 'down';
      tooltip.calculatePosition();

      // 位置会被边界检查调整，所以只检查 y 坐标
      expect(tooltip.y).toBeGreaterThan(150);
    });

    it('应该根据箭头方向计算位置 - up', () => {
      tooltip.targetElement = { x: 100, y: 200, width: 50, height: 50 };
      tooltip.arrowDirection = 'up';
      tooltip.calculatePosition();

      expect(tooltip.y).toBeLessThan(200);
    });

    it('应该确保提示框在画布内', () => {
      tooltip.targetElement = { x: -100, y: -100, width: 50, height: 50 };
      tooltip.calculatePosition();

      expect(tooltip.x).toBeGreaterThanOrEqual(10);
      expect(tooltip.y).toBeGreaterThanOrEqual(10);
    });
  });

  describe('鼠标交互', () => {
    beforeEach(() => {
      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }, { text: '步骤2' }]
      };
      tooltip.showTutorial(tutorial);
      tooltip.x = 200;
      tooltip.y = 200;
      tooltip.width = 400;
      tooltip.height = 150;
    });

    it('应该检测按钮悬停', () => {
      const buttonY = tooltip.y + tooltip.height - tooltip.padding - 30;
      const nextX = tooltip.x + tooltip.width - tooltip.padding - tooltip.buttonWidth;

      tooltip.handleMouseMove(nextX + 40, buttonY + 20);

      expect(tooltip.hoveredButton).toBe('next');
    });

    it('应该处理下一步按钮点击', () => {
      const buttonY = tooltip.y + tooltip.height - tooltip.padding - 30;
      const nextX = tooltip.x + tooltip.width - tooltip.padding - tooltip.buttonWidth;

      const result = tooltip.handleMouseClick(nextX + 40, buttonY + 20);

      expect(result).toBe(true);
      expect(tooltip.currentStepIndex).toBe(1);
    });

    it('应该处理跳过按钮点击', () => {
      const onSkip = vi.fn();
      tooltip.onSkip = onSkip;

      const buttonY = tooltip.y + tooltip.height - tooltip.padding - 30;
      const skipX = tooltip.x + tooltip.width / 2 - tooltip.buttonWidth / 2;

      const result = tooltip.handleMouseClick(skipX + 40, buttonY + 20);

      expect(result).toBe(true);
      expect(onSkip).toHaveBeenCalled();
    });
  });

  describe('动画更新', () => {
    it('应该更新脉冲动画', () => {
      tooltip.show();
      const initialAlpha = tooltip.pulseAlpha;

      tooltip.update(100);

      expect(tooltip.pulseAlpha).not.toBe(initialAlpha);
    });

    it('脉冲动画应该在范围内', () => {
      tooltip.show();

      for (let i = 0; i < 100; i++) {
        tooltip.update(50);
        expect(tooltip.pulseAlpha).toBeGreaterThanOrEqual(0.5);
        expect(tooltip.pulseAlpha).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('文本换行', () => {
    it('应该正确换行文本', () => {
      const ctx = {
        measureText: vi.fn((text) => ({ width: text.length * 10 }))
      };

      const text = '这是一段很长的文本需要换行显示';
      const lines = tooltip.wrapText(ctx, text, 100);

      expect(lines.length).toBeGreaterThan(1);
    });

    it('应该处理多段落文本', () => {
      const ctx = {
        measureText: vi.fn((text) => ({ width: text.length * 10 }))
      };

      const text = '第一段\n第二段';
      const lines = tooltip.wrapText(ctx, text, 200);

      expect(lines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('辅助方法', () => {
    it('应该正确判断是否是最后一步', () => {
      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }, { text: '步骤2' }]
      };
      tooltip.showTutorial(tutorial);

      expect(tooltip.isLastStep()).toBe(false);

      tooltip.currentStepIndex = 1;
      expect(tooltip.isLastStep()).toBe(true);
    });

    it('应该返回当前教程', () => {
      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }]
      };
      tooltip.showTutorial(tutorial);

      expect(tooltip.getCurrentTutorial()).toBe(tutorial);
    });

    it('应该返回当前步骤索引', () => {
      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [{ text: '步骤1' }, { text: '步骤2' }]
      };
      tooltip.showTutorial(tutorial);

      expect(tooltip.getCurrentStepIndex()).toBe(0);

      tooltip.nextStep();
      expect(tooltip.getCurrentStepIndex()).toBe(1);
    });
  });

  describe('步骤变化回调', () => {
    it('应该触发步骤变化回调', () => {
      const onStepChange = vi.fn();
      tooltip.onStepChange = onStepChange;

      const tutorial = {
        id: 'test',
        title: '测试',
        steps: [
          { text: '步骤1', targetElement: { x: 0, y: 0, width: 50, height: 50 } },
          { text: '步骤2', targetElement: { x: 100, y: 100, width: 50, height: 50 } }
        ]
      };
      tooltip.showTutorial(tutorial);

      onStepChange.mockClear();
      tooltip.nextStep();

      expect(onStepChange).toHaveBeenCalledWith(1, tutorial.steps[1]);
    });
  });
});

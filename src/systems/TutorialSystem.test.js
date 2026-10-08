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
 * 教程系统测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TutorialSystem } from './TutorialSystem.js';
import { FlowGroupDefinitionRepository } from '../core/scene/FlowGroupDefinitionRepository.js';

describe('TutorialSystem', () => {
  let tutorialSystem;
  let testTutorial;

  beforeEach(() => {
    tutorialSystem = new TutorialSystem();
    
    // 创建测试教程
    testTutorial = {
      title: '移动教程',
      description: '学习如何移动角色',
      steps: [
        {
          text: '使用WASD键移动',
          target: 'player',
          highlightTarget: true
        },
        {
          text: '或点击地面移动',
          target: 'ground'
        }
      ],
      pauseGame: false,
      canSkip: true,
      priority: 1,
      category: 'movement'
    };

    tutorialSystem.registerTutorial('movement_tutorial', testTutorial);
  });

  describe('教程注册', () => {
    it('应该能注册教程', () => {
      const result = tutorialSystem.registerTutorial('test', {
        title: '测试教程',
        steps: []
      });
      
      expect(result).toBe(true);
      expect(tutorialSystem.getTutorial('test')).toBeDefined();
    });

    it('应该拒绝无效的教程数据', () => {
      const result = tutorialSystem.registerTutorial(null, null);
      expect(result).toBe(false);
    });

    it('应该能获取所有教程', () => {
      tutorialSystem.registerTutorial('test2', { title: '测试2', steps: [] });
      const tutorials = tutorialSystem.getAllTutorials();
      
      expect(tutorials.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('教程显示', () => {
    it('应该能显示教程', () => {
      const result = tutorialSystem.showTutorial('movement_tutorial');
      
      expect(result).toBe(true);
      expect(tutorialSystem.isShowingTutorial()).toBe(true);
      expect(tutorialSystem.getCurrentTutorial()).toBeDefined();
    });

    it('应该不显示已完成的教程（幂等成功但不进入显示态）', () => {
      tutorialSystem.completedTutorials.add('movement_tutorial');
      const result = tutorialSystem.showTutorial('movement_tutorial');

      // canonical 收口后：已完成教程的重复 show 请求幂等返回 true（事件重放不打断），
      // 但绝不重新进入显示态。
      expect(result).toBe(true);
      expect(tutorialSystem.isShowingTutorial()).toBe(false);
    });

    it('应该不显示不存在的教程', () => {
      const result = tutorialSystem.showTutorial('nonexistent');
      
      expect(result).toBe(false);
    });

    it('应该在槽忙时入队等待，而非拒绝，空出槽位后自动补显', () => {
      tutorialSystem.showTutorial('movement_tutorial');
      tutorialSystem.registerTutorial('test2', { title: '测试2', steps: [] });
      const result = tutorialSystem.showTutorial('test2');

      // 槽忙：不拒绝请求（避免上层状态事务失败），进入待显示队列
      expect(result).toBe(true);
      expect(tutorialSystem.getCurrentTutorial().id).toBe('movement_tutorial');
      expect(tutorialSystem.pendingTutorials.length).toBe(1);

      // 当前教程结束 → 自动补显队列中的教程
      tutorialSystem.hideTutorial();
      expect(tutorialSystem.getCurrentTutorial().id).toBe('test2');
      expect(tutorialSystem.pendingTutorials.length).toBe(0);
    });
  });

  describe('教程步骤', () => {
    beforeEach(() => {
      tutorialSystem.showTutorial('movement_tutorial');
    });

    it('应该从第一步开始', () => {
      expect(tutorialSystem.getCurrentStepIndex()).toBe(0);
    });

    it('应该能前进到下一步', () => {
      const hasNext = tutorialSystem.nextStep();
      
      expect(hasNext).toBe(true);
      expect(tutorialSystem.getCurrentStepIndex()).toBe(1);
    });

    it('应该在最后一步时完成教程', () => {
      tutorialSystem.nextStep(); // 到第2步
      const hasNext = tutorialSystem.nextStep(); // 尝试到第3步
      
      expect(hasNext).toBe(false);
      expect(tutorialSystem.isShowingTutorial()).toBe(false);
      expect(tutorialSystem.isTutorialCompleted('movement_tutorial')).toBe(true);
    });

    it('应该能返回上一步', () => {
      tutorialSystem.nextStep(); // 到第2步
      const hasPrev = tutorialSystem.previousStep();
      
      expect(hasPrev).toBe(true);
      expect(tutorialSystem.getCurrentStepIndex()).toBe(0);
    });

    it('应该在第一步时不能返回上一步', () => {
      const hasPrev = tutorialSystem.previousStep();
      
      expect(hasPrev).toBe(false);
      expect(tutorialSystem.getCurrentStepIndex()).toBe(0);
    });
  });

  describe('教程跳过', () => {
    it('应该能跳过可跳过的教程', () => {
      tutorialSystem.showTutorial('movement_tutorial');
      const result = tutorialSystem.skipTutorial();
      
      expect(result).toBe(true);
      expect(tutorialSystem.isShowingTutorial()).toBe(false);
      expect(tutorialSystem.isTutorialCompleted('movement_tutorial')).toBe(true);
    });

    it('应该不能跳过不可跳过的教程', () => {
      tutorialSystem.registerTutorial('mandatory', {
        title: '必须教程',
        steps: [{ text: '步骤1' }],
        canSkip: false
      });
      
      tutorialSystem.showTutorial('mandatory');
      const result = tutorialSystem.skipTutorial();
      
      expect(result).toBe(false);
      expect(tutorialSystem.isShowingTutorial()).toBe(true);
    });
  });

  describe('教程完成', () => {
    it('应该能完成教程', () => {
      tutorialSystem.showTutorial('movement_tutorial');
      tutorialSystem.completeTutorial();
      
      expect(tutorialSystem.isShowingTutorial()).toBe(false);
      expect(tutorialSystem.isTutorialCompleted('movement_tutorial')).toBe(true);
    });

    it('应该触发完成回调', () => {
      const callback = vi.fn();
      tutorialSystem.onComplete(callback);
      
      tutorialSystem.showTutorial('movement_tutorial');
      tutorialSystem.completeTutorial();
      
      expect(callback).toHaveBeenCalledWith('movement_tutorial', expect.any(Object));
    });

    it('显示数据透出 beginText / endText，供 presenter 渲染教程级提示', () => {
      tutorialSystem.registerTutorial('prompt_tutorial', {
        title: '带提示的教程',
        beginText: '开场：采集野果',
        endText: '收场：野果已采集',
        steps: [{ text: '按{eat}吃掉' }]
      });
      const shown = [];
      tutorialSystem.onShow(data => shown.push(data));
      tutorialSystem.showTutorial('prompt_tutorial');
      expect(shown[0]).toMatchObject({
        stepIndex: 0,
        beginText: '开场：采集野果',
        endText: '收场：野果已采集'
      });
    });
  });

  describe('回调函数', () => {
    it('应该触发显示回调', () => {
      const callback = vi.fn();
      tutorialSystem.onShow(callback);
      
      tutorialSystem.showTutorial('movement_tutorial');
      
      expect(callback).toHaveBeenCalled();
    });

    it('应该触发隐藏回调', () => {
      const callback = vi.fn();
      tutorialSystem.onHide(callback);
      
      tutorialSystem.showTutorial('movement_tutorial');
      tutorialSystem.hideTutorial();
      
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('自动触发', () => {
    it('canonical 收口后 update 不再按 autoTrigger/triggerCondition 主动展示教程', () => {
      const triggerCondition = vi.fn(() => true);
      tutorialSystem.registerTutorial('auto_tutorial', {
        title: '自动教程',
        steps: [{ text: '步骤1' }],
        autoTrigger: true,
        triggerCondition
      });

      tutorialSystem.update(0, { playerLevel: 5 });

      // 帧更新不得展示教程，也不得执行 JavaScript 条件（canonical 安全边界）。
      expect(tutorialSystem.isShowingTutorial()).toBe(false);
      expect(triggerCondition).not.toHaveBeenCalled();
      // 展示唯一途径是事件动作显式调用 showTutorial。
      expect(tutorialSystem.showTutorial('auto_tutorial')).toBe(true);
      expect(tutorialSystem.getCurrentTutorial().id).toBe('auto_tutorial');
    });

    it('canonical 收口后优先级只在显式展示互斥时生效，update 不做选择', () => {
      tutorialSystem.registerTutorial('low_priority', {
        title: '低优先级',
        steps: [{ text: '步骤1' }],
        autoTrigger: true,
        priority: 1,
        triggerCondition: () => true
      });

      tutorialSystem.registerTutorial('high_priority', {
        title: '高优先级',
        steps: [{ text: '步骤1' }],
        autoTrigger: true,
        priority: 10,
        triggerCondition: () => true
      });

      tutorialSystem.update(0, {});

      // 帧更新不选择任何教程；显式展示按调用方指定。
      expect(tutorialSystem.getCurrentTutorial()).toBeNull();
      expect(tutorialSystem.showTutorial('high_priority')).toBe(true);
      expect(tutorialSystem.getCurrentTutorial().id).toBe('high_priority');
    });
  });

  describe('教程进度', () => {
    it('应该正确计算进度', () => {
      tutorialSystem.registerTutorial('test2', { title: '测试2', steps: [] });
      tutorialSystem.registerTutorial('test3', { title: '测试3', steps: [] });
      
      tutorialSystem.completedTutorials.add('movement_tutorial');
      
      const progress = tutorialSystem.getProgress();
      
      expect(progress.total).toBe(3);
      expect(progress.completed).toBe(1);
      expect(progress.remaining).toBe(2);
      expect(progress.percentage).toBeCloseTo(33.33, 1);
    });

    it('应该能获取未完成的教程', () => {
      tutorialSystem.registerTutorial('test2', { title: '测试2', steps: [] });
      tutorialSystem.completedTutorials.add('movement_tutorial');
      
      const incomplete = tutorialSystem.getIncompleteTutorials();
      
      expect(incomplete.length).toBe(1);
      expect(incomplete[0].id).toBe('test2');
    });
  });

  describe('教程类别', () => {
    it('应该能按类别获取教程', () => {
      tutorialSystem.registerTutorial('combat1', {
        title: '战斗1',
        steps: [],
        category: 'combat'
      });
      
      tutorialSystem.registerTutorial('combat2', {
        title: '战斗2',
        steps: [],
        category: 'combat'
      });

      const combatTutorials = tutorialSystem.getTutorialsByCategory('combat');
      
      expect(combatTutorials.length).toBe(2);
    });
  });

  describe('FlowGroup 装配兼容（GameLoader 路径）', () => {
    it('replaceDefinitions 接受 FlowGroupDefinitionRepository 实例（回归：sanguo 加载失败）', () => {
      // GameLoader.assemble drafts commit 调用：
      //   tutorialSystem.replaceDefinitions(project.tutorials, context.sceneEventDefinitionRepository)
      // 第二参是 repository 对象而非数组——旧实现会误用空定义集导致"未知 FlowGroup"校验失败。
      const repository = new FlowGroupDefinitionRepository([
        { id: 's01.event.awakening', name: '寒风苏醒', scope: { sceneIds: ['S01'] }, order: 0 }
      ]);
      const result = tutorialSystem.replaceDefinitions([
        { id: 's01.move', title: '移动教学', steps: [], sceneEventId: 's01.event.awakening' }
      ], repository);

      expect(result).toBe(true);
      expect(tutorialSystem.getTutorial('s01.move')).toBeDefined();
      expect(tutorialSystem.getTutorial('s01.move').flowGroupId).toBe('s01.event.awakening');
      expect(tutorialSystem.getFlowGroupDefinitions().some(def => def.id === 's01.event.awakening')).toBe(true);
    });

    it('构造器 config.flowGroupDefinitions 同样接受 repository 实例', () => {
      const repository = new FlowGroupDefinitionRepository([
        { id: 'fg-1', name: '组一', scope: { sceneIds: ['S01'] }, order: 0 }
      ]);
      const system = new TutorialSystem({
        flowGroupDefinitions: repository,
        definitions: [{ id: 'tu-1', title: '教程一', steps: [], flowGroupId: 'fg-1' }]
      });
      expect(system.getTutorial('tu-1')).toBeDefined();
      expect(system.getFlowGroupDefinitions().some(def => def.id === 'fg-1')).toBe(true);
    });
  });

  describe('教程重置', () => {
    it('应该能重置单个教程', () => {
      tutorialSystem.completedTutorials.add('movement_tutorial');
      tutorialSystem.resetTutorial('movement_tutorial');

      expect(tutorialSystem.isTutorialCompleted('movement_tutorial')).toBe(false);
    });

    it('应该能重置所有教程', () => {
      tutorialSystem.completedTutorials.add('movement_tutorial');
      tutorialSystem.registerTutorial('test2', { title: '测试2', steps: [] });
      tutorialSystem.completedTutorials.add('test2');
      
      tutorialSystem.resetTutorial();
      
      expect(tutorialSystem.completedTutorials.size).toBe(0);
    });
  });

  describe('启用/禁用', () => {
    it('应该能禁用教程系统', () => {
      tutorialSystem.setEnabled(false);
      const result = tutorialSystem.showTutorial('movement_tutorial');
      
      expect(result).toBe(false);
    });

    it('应该在禁用时隐藏当前教程', () => {
      tutorialSystem.showTutorial('movement_tutorial');
      tutorialSystem.setEnabled(false);
      
      expect(tutorialSystem.isShowingTutorial()).toBe(false);
    });
  });

  describe('进度保存和加载', () => {
    it('canonical definitions 完整持有 signal/threshold/policy，运行态可保存恢复', () => {
      tutorialSystem.replaceDefinitions([{
        id: 'canonical', title: '规范教学', category: 'scene', order: 1,
        steps: [{ text: '完成两次动作' }],
        signalRules: [{ signal: 'performed', threshold: 2 }],
        completionPolicy: 'signal', canSkip: false, autoTrigger: false
      }]);
      // canonical 收口：信号只被当前已显示教程消费，先显式展示再累计。
      tutorialSystem.showTutorial('canonical');
      expect(tutorialSystem.notify('performed')).toBe(false);
      expect(tutorialSystem.notify('performed')).toBe(true);
      const saved = tutorialSystem.saveProgress();
      expect(saved.completedTutorials).toEqual(['canonical']);
      expect(saved.signalProgress['canonical:performed']).toBe(2);

      const restored = new TutorialSystem();
      restored.replaceDefinitions(tutorialSystem.getAllTutorials());
      restored.loadProgress(saved);
      expect(restored.isTutorialCompleted('canonical')).toBe(true);
      expect(restored.getTutorial('canonical')).toMatchObject({
        completionPolicy: 'signal', signalRules: [{ signal: 'performed', threshold: 2 }]
      });
    });

    it('应该能保存进度', () => {
      tutorialSystem.completedTutorials.add('movement_tutorial');
      const progress = tutorialSystem.saveProgress();
      
      expect(progress.completedTutorials).toContain('movement_tutorial');
      expect(progress.enabled).toBe(true);
    });

    it('应该能加载进度', () => {
      const progress = {
        completedTutorials: ['movement_tutorial', 'test2'],
        enabled: false
      };
      
      tutorialSystem.loadProgress(progress);
      
      expect(tutorialSystem.isTutorialCompleted('movement_tutorial')).toBe(true);
      expect(tutorialSystem.isTutorialCompleted('test2')).toBe(true);
      expect(tutorialSystem.enabled).toBe(false);
    });
  });

  describe('游戏暂停', () => {
    it('应该在教程要求时暂停游戏', () => {
      tutorialSystem.registerTutorial('pause_tutorial', {
        title: '暂停教程',
        steps: [{ text: '步骤1' }],
        pauseGame: true
      });

      tutorialSystem.showTutorial('pause_tutorial');
      
      expect(tutorialSystem.shouldPauseGame()).toBe(true);
    });

    it('应该在教程结束时恢复游戏', () => {
      tutorialSystem.registerTutorial('pause_tutorial', {
        title: '暂停教程',
        steps: [{ text: '步骤1' }],
        pauseGame: true
      });

      tutorialSystem.showTutorial('pause_tutorial');
      tutorialSystem.completeTutorial();
      
      expect(tutorialSystem.shouldPauseGame()).toBe(false);
    });
  });
});


describe('TutorialSystem canonical policy boundary', () => {
  it('signal/manual policy 不会被普通步骤浏览错误完成，且不执行 JavaScript 条件', () => {
    const system = new TutorialSystem();
    const triggerCondition = vi.fn(() => true);
    const completionCondition = vi.fn(() => true);
    system.replaceDefinitions([
      {
        id: 'signal-only', title: '信号教程', category: 'test', order: 0,
        steps: [{ text: '等待信号' }], signalRules: [{ signal: 'done', threshold: 1 }],
        completionPolicy: 'signal', autoTrigger: true, triggerCondition, completionCondition
      },
      {
        id: 'manual-only', title: '手动教程', category: 'test', order: 1,
        steps: [{ text: '等待命令' }], completionPolicy: 'manual', autoTrigger: false
      }
    ]);

    system.update(0, { ready: true });
    // canonical 收口：帧更新不展示教程（autoTrigger 无运行时语义），JS 条件不执行。
    expect(system.getCurrentTutorial()).toBeNull();
    expect(triggerCondition).not.toHaveBeenCalled();
    expect(completionCondition).not.toHaveBeenCalled();

    expect(system.showTutorial('signal-only')).toBe(true);
    expect(system.nextStep()).toBe(false);
    expect(system.isTutorialCompleted('signal-only')).toBe(false);

    expect(system.notify('done')).toBe(true);
    expect(system.isTutorialCompleted('signal-only')).toBe(true);
    expect(system.showTutorial('manual-only')).toBe(true);
    expect(system.nextStep()).toBe(false);
    expect(system.isTutorialCompleted('manual-only')).toBe(false);
    system.completeTutorial('manual-only');
    expect(system.isTutorialCompleted('manual-only')).toBe(true);
  });

  it('只有 signal policy 消费 signal rule，definition 不进入 TriggerSystem', () => {
    const system = new TutorialSystem();
    system.replaceDefinitions([{
      id: 'all-steps', title: '步骤教程', category: 'test', order: 0,
      steps: [{ text: '步骤' }], signalRules: [{ signal: 'done', threshold: 1 }],
      completionPolicy: 'allSteps', autoTrigger: false
    }]);

    expect(system.notify('done')).toBe(false);
    expect(system.isTutorialCompleted('all-steps')).toBe(false);
    expect(system.getTutorial('all-steps')).not.toHaveProperty('when');
    expect(system.getTutorial('all-steps')).not.toHaveProperty('do');
  });
});
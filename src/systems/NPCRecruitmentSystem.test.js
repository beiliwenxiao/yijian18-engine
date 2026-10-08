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
 * NPCRecruitmentSystem 单元测试
 * 
 * 测试内容：
 * - NPC注册和数据管理
 * - 招募条件检查
 * - NPC招募和解雇
 * - 状态保存和加载
 * 
 * @author Kiro
 * @date 2026-01-08
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NPCRecruitmentSystem } from './NPCRecruitmentSystem.js';

describe('NPCRecruitmentSystem', () => {
  let system;

  beforeEach(() => {
    system = new NPCRecruitmentSystem();
  });

  describe('NPC注册', () => {
    it('应该能够注册NPC', () => {
      const npc = {
        id: 'guan_hai',
        name: '管骇',
        description: '黄巾军猛将',
        attributes: {
          health: 150,
          maxHealth: 150,
          attack: 25,
          defense: 15
        },
        skills: ['heavy_strike'],
        unitType: 'heavy_infantry',
        recruitCondition: {
          type: 'rescue_success',
          targetId: 'zhang_liang'
        }
      };

      system.registerNPC(npc);

      const registered = system.getNPC('guan_hai');
      expect(registered).toBeDefined();
      expect(registered.name).toBe('管骇');
      expect(registered.attributes.attack).toBe(25);
      expect(registered.isRecruited).toBe(false);
    });

    it('应该在注册时设置默认值', () => {
      const npc = {
        id: 'test_npc',
        name: '测试NPC'
      };

      system.registerNPC(npc);

      const registered = system.getNPC('test_npc');
      expect(registered.attributes.health).toBe(100);
      expect(registered.attributes.attack).toBe(10);
      expect(registered.loyalty).toBe(100);
      expect(registered.unitType).toBe('infantry');
    });

    it('应该在缺少必需字段时抛出错误', () => {
      expect(() => {
        system.registerNPC({ name: '无ID的NPC' });
      }).toThrow('NPC must have an id');

      expect(() => {
        system.registerNPC({ id: 'no_name' });
      }).toThrow('NPC must have a name');
    });
  });

  describe('招募条件检查', () => {
    beforeEach(() => {
      // 注册测试NPC
      system.registerNPC({
        id: 'guan_hai',
        name: '管骇',
        recruitCondition: {
          type: 'rescue_success',
          targetId: 'zhang_liang'
        }
      });

      system.registerNPC({
        id: 'zhou_cang',
        name: '周仓',
        recruitCondition: {
          type: 'rescue_success',
          targetId: 'zhang_bao'
        }
      });

      system.registerNPC({
        id: 'always_available',
        name: '总是可用',
        recruitCondition: {
          type: 'always'
        }
      });
    });

    it('应该正确检查救援成功条件', () => {
      const context = {
        rescuedTargets: ['zhang_liang']
      };

      expect(system.checkRecruitmentCondition('guan_hai', context)).toBe(true);
      expect(system.checkRecruitmentCondition('zhou_cang', context)).toBe(false);
    });

    it('应该对always类型总是返回true', () => {
      expect(system.checkRecruitmentCondition('always_available', {})).toBe(true);
    });

    it('应该检查任务完成条件', () => {
      system.registerNPC({
        id: 'quest_npc',
        name: '任务NPC',
        recruitCondition: {
          type: 'quest_completed',
          questId: 'main_quest_1'
        }
      });

      const context = {
        completedQuests: ['main_quest_1', 'side_quest_1']
      };

      expect(system.checkRecruitmentCondition('quest_npc', context)).toBe(true);
    });

    it('应该检查等级要求', () => {
      system.registerNPC({
        id: 'level_npc',
        name: '等级NPC',
        recruitCondition: {
          type: 'level_requirement',
          level: 10
        }
      });

      expect(system.checkRecruitmentCondition('level_npc', { playerLevel: 5 })).toBe(false);
      expect(system.checkRecruitmentCondition('level_npc', { playerLevel: 10 })).toBe(true);
      expect(system.checkRecruitmentCondition('level_npc', { playerLevel: 15 })).toBe(true);
    });

    it('应该支持自定义条件检查器', () => {
      system.registerNPC({
        id: 'custom_npc',
        name: '自定义NPC',
        recruitCondition: {
          type: 'custom_condition',
          value: 100
        }
      });

      // 注册自定义检查器
      system.registerConditionChecker('custom_condition', (condition, context) => {
        return context.customValue >= condition.value;
      });

      expect(system.checkRecruitmentCondition('custom_npc', { customValue: 50 })).toBe(false);
      expect(system.checkRecruitmentCondition('custom_npc', { customValue: 100 })).toBe(true);
    });
  });

  describe('NPC招募', () => {
    beforeEach(() => {
      system.registerNPC({
        id: 'guan_hai',
        name: '管骇',
        attributes: {
          attack: 25,
          defense: 15
        },
        recruitCondition: {
          type: 'rescue_success',
          targetId: 'zhang_liang'
        },
        dialogue: {
          recruitment: '管骇愿意追随将军！'
        }
      });
    });

    it('应该能够招募满足条件的NPC', () => {
      const context = {
        rescuedTargets: ['zhang_liang']
      };

      const result = system.recruitNPC('guan_hai', context);

      expect(result.success).toBe(true);
      expect(result.message).toBe('管骇愿意追随将军！');
      expect(system.isRecruited('guan_hai')).toBe(true);
    });

    it('应该拒绝招募不满足条件的NPC', () => {
      const context = {
        rescuedTargets: []
      };

      const result = system.recruitNPC('guan_hai', context);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('condition_not_met');
      expect(system.isRecruited('guan_hai')).toBe(false);
    });

    it('应该拒绝重复招募', () => {
      const context = {
        rescuedTargets: ['zhang_liang']
      };

      system.recruitNPC('guan_hai', context);
      const result = system.recruitNPC('guan_hai', context);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('already_recruited');
    });

    it('应该在招募时触发回调', () => {
      let recruited = null;
      system.on('NPCRecruited', (npc) => {
        recruited = npc;
      });

      const context = {
        rescuedTargets: ['zhang_liang']
      };

      system.recruitNPC('guan_hai', context);

      expect(recruited).toBeDefined();
      expect(recruited.name).toBe('管骇');
    });
  });

  describe('NPC解雇', () => {
    beforeEach(() => {
      system.registerNPC({
        id: 'test_npc',
        name: '测试NPC',
        recruitCondition: { type: 'always' }
      });

      system.recruitNPC('test_npc', {});
    });

    it('应该能够解雇已招募的NPC', () => {
      expect(system.isRecruited('test_npc')).toBe(true);

      const result = system.dismissNPC('test_npc');

      expect(result).toBe(true);
      expect(system.isRecruited('test_npc')).toBe(false);
    });

    it('应该在解雇时触发回调', () => {
      let dismissed = null;
      system.on('NPCDismissed', (npc) => {
        dismissed = npc;
      });

      system.dismissNPC('test_npc');

      expect(dismissed).toBeDefined();
      expect(dismissed.name).toBe('测试NPC');
    });
  });

  describe('队伍管理', () => {
    beforeEach(() => {
      system.registerNPC({
        id: 'npc1',
        name: 'NPC1',
        attributes: { attack: 20, defense: 10, maxHealth: 100 },
        recruitCondition: { type: 'always' }
      });

      system.registerNPC({
        id: 'npc2',
        name: 'NPC2',
        attributes: { attack: 30, defense: 15, maxHealth: 150 },
        recruitCondition: { type: 'always' }
      });

      system.recruitNPC('npc1', {});
      system.recruitNPC('npc2', {});
    });

    it('应该能够获取所有已招募的NPC', () => {
      const recruited = system.getRecruitedNPCs();

      expect(recruited).toHaveLength(2);
      expect(recruited.map(npc => npc.id)).toContain('npc1');
      expect(recruited.map(npc => npc.id)).toContain('npc2');
    });

    it('应该能够计算队伍总战斗力', () => {
      // npc1: 20 + 10 + 10 = 40
      // npc2: 30 + 15 + 15 = 60
      // 总计: 100
      const power = system.getPartyPower();

      expect(power).toBe(100);
    });

    it('应该能够获取可招募的NPC列表', () => {
      system.registerNPC({
        id: 'available_npc',
        name: '可招募NPC',
        recruitCondition: { type: 'always' }
      });

      system.registerNPC({
        id: 'unavailable_npc',
        name: '不可招募NPC',
        recruitCondition: {
          type: 'quest_completed',
          questId: 'impossible_quest'
        }
      });

      const available = system.getAvailableNPCs({});

      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('available_npc');
    });
  });

  describe('NPC属性管理', () => {
    beforeEach(() => {
      system.registerNPC({
        id: 'test_npc',
        name: '测试NPC',
        attributes: { attack: 20, defense: 10 },
        loyalty: 100,
        recruitCondition: { type: 'always' }
      });
    });

    it('应该能够更新NPC属性', () => {
      system.updateNPCAttributes('test_npc', {
        attack: 30,
        defense: 20
      });

      const npc = system.getNPC('test_npc');
      expect(npc.attributes.attack).toBe(30);
      expect(npc.attributes.defense).toBe(20);
    });

    it('应该能够更新NPC忠诚度', () => {
      system.updateLoyalty('test_npc', -20);

      const npc = system.getNPC('test_npc');
      expect(npc.loyalty).toBe(80);
    });

    it('应该限制忠诚度在0-100之间', () => {
      system.updateLoyalty('test_npc', 50);
      expect(system.getNPC('test_npc').loyalty).toBe(100);

      system.updateLoyalty('test_npc', -200);
      expect(system.getNPC('test_npc').loyalty).toBe(0);
    });

    it('应该在忠诚度为0时自动解雇NPC', () => {
      system.recruitNPC('test_npc', {});
      expect(system.isRecruited('test_npc')).toBe(true);

      system.updateLoyalty('test_npc', -100);

      expect(system.isRecruited('test_npc')).toBe(false);
    });
  });

  describe('状态保存和加载', () => {
    beforeEach(() => {
      system.registerNPC({
        id: 'npc1',
        name: 'NPC1',
        attributes: { attack: 20 },
        loyalty: 80,
        recruitCondition: { type: 'always' }
      });

      system.registerNPC({
        id: 'npc2',
        name: 'NPC2',
        attributes: { attack: 30 },
        loyalty: 90,
        recruitCondition: { type: 'always' }
      });

      system.recruitNPC('npc1', {});
    });

    it('应该能够保存招募状态', () => {
      const state = system.saveState();

      expect(state.recruitedNPCs).toContain('npc1');
      expect(state.recruitedNPCs).not.toContain('npc2');
      expect(state.npcStates).toHaveLength(2);
    });

    it('应该能够加载招募状态', () => {
      const state = system.saveState();

      // 创建新系统并加载状态
      const newSystem = new NPCRecruitmentSystem();
      newSystem.registerNPC({
        id: 'npc1',
        name: 'NPC1',
        recruitCondition: { type: 'always' }
      });
      newSystem.registerNPC({
        id: 'npc2',
        name: 'NPC2',
        recruitCondition: { type: 'always' }
      });

      newSystem.loadState(state);

      expect(newSystem.isRecruited('npc1')).toBe(true);
      expect(newSystem.isRecruited('npc2')).toBe(false);
    });

    it('应该能够保存和恢复NPC属性', () => {
      system.updateLoyalty('npc1', -20);
      const state = system.saveState();

      const newSystem = new NPCRecruitmentSystem();
      newSystem.registerNPC({
        id: 'npc1',
        name: 'NPC1',
        recruitCondition: { type: 'always' }
      });

      newSystem.loadState(state);

      const npc = newSystem.getNPC('npc1');
      expect(npc.loyalty).toBe(60);
    });
  });

  describe('系统重置', () => {
    beforeEach(() => {
      system.registerNPC({
        id: 'test_npc',
        name: '测试NPC',
        recruitCondition: { type: 'always' }
      });

      system.recruitNPC('test_npc', {});
    });

    it('应该能够重置系统状态', () => {
      expect(system.isRecruited('test_npc')).toBe(true);

      system.reset();

      expect(system.isRecruited('test_npc')).toBe(false);
      expect(system.getRecruitedNPCs()).toHaveLength(0);
    });

    it('应该能够清空所有NPC', () => {
      system.clear();

      expect(system.getNPC('test_npc')).toBeNull();
      expect(system.getRecruitedNPCs()).toHaveLength(0);
    });
  });
});

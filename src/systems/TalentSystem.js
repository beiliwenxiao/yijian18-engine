/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * TalentSystem.js
 * 天赋系统 - 管理角色天赋的解锁、效果计算和重置
 *
 * 效果结算已统一交由 EffectResolver：本系统只负责节点解锁与效果产出，
 * 不再逐字段判断 effects.xxx 后手工写入 stats。
 */

import { Logger } from '../core/Logger.js';
import { EffectResolver } from './effects/EffectResolver.js';
import { ProgressionGraphSystem } from './progression/ProgressionGraphSystem.js';
import { LegacyProgressionAdapter } from './progression/LegacyProgressionAdapter.js';
import { convertTalentTree } from './progression/LegacyTreeConverter.js';
import { GraphMode } from './progression/GraphDefinition.js';

/** 天赋效果可作用的角色属性字段（与现有 stats 字段命名保持一致） */
const TALENT_STAT_TARGETS = ['maxHp', 'maxMp', 'attack', 'defense', 'speed', 'hpRegen', 'manaRegen'];

/**
 * 天赋类型枚举
 */
export const TalentType = {
  COMBAT: 'combat',       // 战斗天赋
  SURVIVAL: 'survival',   // 生存天赋
  UTILITY: 'utility',     // 实用天赋
  ELEMENT: 'element'      // 元素天赋
};

/**
 * 天赋节点类
 */
export class TalentNode {
  /**
   * @param {Object} config - 天赋配置
   * @param {string} config.id - 天赋ID
   * @param {string} config.name - 天赋名称
   * @param {string} config.description - 天赋描述
   * @param {string} config.type - 天赋类型
   * @param {number} config.maxLevel - 最大等级
   * @param {Array<string>} config.prerequisites - 前置天赋ID列表
   * @param {number} config.requiredCharacterLevel - 需要的角色等级
   * @param {number} config.requiredTalentPoints - 需要的天赋点数
   * @param {Object} config.position - 在天赋树中的位置 {x, y}
   * @param {Object} config.effects - 天赋效果配置（每级效果）
   * @param {string} config.icon - 天赋图标
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.type = config.type || TalentType.COMBAT;
    this.maxLevel = config.maxLevel || 1;
    this.currentLevel = 0;
    this.prerequisites = config.prerequisites || [];
    this.requiredCharacterLevel = config.requiredCharacterLevel || 1;
    this.requiredTalentPoints = config.requiredTalentPoints || 1;
    this.position = config.position || { x: 0, y: 0 };
    this.effects = config.effects || {};
    this.icon = config.icon || 'default';
    this.isUnlocked = false;
    this.isLearned = false;
  }

  /**
   * 检查是否可以学习
   * @param {Object} character - 角色数据
   * @param {TalentTree} talentTree - 天赋树实例
   * @returns {Object} {canLearn: boolean, reason: string}
   */
  canLearn(character, talentTree) {
    // 检查是否已达到最大等级
    if (this.currentLevel >= this.maxLevel) {
      return { canLearn: false, reason: '已达到最大等级' };
    }

    // 检查角色等级
    if (character.level < this.requiredCharacterLevel) {
      return { canLearn: false, reason: `需要角色等级 ${this.requiredCharacterLevel}` };
    }

    // 检查天赋点
    if ((character.talentPoints || 0) < this.requiredTalentPoints) {
      return { canLearn: false, reason: `需要 ${this.requiredTalentPoints} 天赋点` };
    }

    // 检查前置天赋
    for (const prereqId of this.prerequisites) {
      const prereqNode = talentTree.getNode(prereqId);
      if (!prereqNode || !prereqNode.isLearned) {
        return { canLearn: false, reason: `需要先学习前置天赋` };
      }
    }

    return { canLearn: true, reason: '' };
  }

  /**
   * 学习天赋
   * @returns {boolean} 是否成功学习
   */
  learn() {
    if (this.currentLevel < this.maxLevel) {
      this.currentLevel++;
      this.isLearned = true;
      this.isUnlocked = true;
      return true;
    }
    return false;
  }

  /**
   * 重置天赋
   */
  reset() {
    this.currentLevel = 0;
    this.isLearned = false;
  }

  /**
   * 获取当前等级的效果
   * @returns {Object}
   */
  getCurrentEffects() {
    if (this.currentLevel === 0) {
      return {};
    }

    const effects = {};
    for (const [key, value] of Object.entries(this.effects)) {
      if (typeof value === 'number') {
        // 数值效果按等级累加
        effects[key] = value * this.currentLevel;
      } else if (Array.isArray(value)) {
        // 数组效果取对应等级的值
        effects[key] = value[Math.min(this.currentLevel - 1, value.length - 1)];
      } else {
        effects[key] = value;
      }
    }
    return effects;
  }

  /**
   * 获取下一等级的效果预览
   * @returns {Object|null}
   */
  getNextLevelEffects() {
    if (this.currentLevel >= this.maxLevel) {
      return null;
    }

    const nextLevel = this.currentLevel + 1;
    const effects = {};
    for (const [key, value] of Object.entries(this.effects)) {
      if (typeof value === 'number') {
        effects[key] = value * nextLevel;
      } else if (Array.isArray(value)) {
        effects[key] = value[Math.min(nextLevel - 1, value.length - 1)];
      } else {
        effects[key] = value;
      }
    }
    return effects;
  }
}

/**
 * 天赋树类
 */
export class TalentTree {
  /**
   * @param {string} className - 职业名称
   * @param {Array<TalentNode>} nodes - 天赋节点列表
   */
  constructor(className, nodes) {
    this.className = className;
    this.nodes = new Map();
    
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
    
    this.updateUnlockStatus();
  }

  /**
   * 获取天赋节点
   * @param {string} talentId - 天赋ID
   * @returns {TalentNode|null}
   */
  getNode(talentId) {
    return this.nodes.get(talentId) || null;
  }

  /**
   * 获取所有节点
   * @returns {Array<TalentNode>}
   */
  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  /**
   * 获取指定类型的节点
   * @param {string} type - 天赋类型
   * @returns {Array<TalentNode>}
   */
  getNodesByType(type) {
    return this.getAllNodes().filter(node => node.type === type);
  }

  /**
   * 学习天赋
   * @param {Object} character - 角色数据
   * @param {string} talentId - 天赋ID
   * @returns {Object} {success: boolean, message: string}
   */
  learnTalent(character, talentId) {
    const node = this.getNode(talentId);
    if (!node) {
      return { success: false, message: `天赋 ${talentId} 不存在` };
    }

    const checkResult = node.canLearn(character, this);
    if (!checkResult.canLearn) {
      return { success: false, message: checkResult.reason };
    }

    // 消耗天赋点
    character.talentPoints = (character.talentPoints || 0) - node.requiredTalentPoints;
    
    // 学习天赋
    const success = node.learn();
    
    if (success) {
      this.updateUnlockStatus();
      return { success: true, message: `成功学习天赋: ${node.name} (等级 ${node.currentLevel})` };
    }

    return { success: false, message: '学习失败' };
  }

  /**
   * 重置所有天赋
   * @param {Object} character - 角色数据
   * @returns {number} 返还的天赋点数
   */
  resetAllTalents(character) {
    let returnedPoints = 0;
    
    for (const node of this.nodes.values()) {
      if (node.isLearned) {
        returnedPoints += node.requiredTalentPoints * node.currentLevel;
        node.reset();
      }
    }
    
    // 返还天赋点
    character.talentPoints = (character.talentPoints || 0) + returnedPoints;
    
    this.updateUnlockStatus();
    
    return returnedPoints;
  }

  /**
   * 更新天赋解锁状态
   */
  updateUnlockStatus() {
    for (const node of this.nodes.values()) {
      let canUnlock = true;
      for (const prereqId of node.prerequisites) {
        const prereqNode = this.getNode(prereqId);
        if (!prereqNode || !prereqNode.isLearned) {
          canUnlock = false;
          break;
        }
      }
      node.isUnlocked = canUnlock;
    }
  }

  /**
   * 获取所有天赋效果
   * @returns {Object} 天赋效果汇总
   */
  getAllEffects() {
    const effects = {};
    
    for (const node of this.nodes.values()) {
      if (node.isLearned) {
        const nodeEffects = node.getCurrentEffects();
        
        for (const [key, value] of Object.entries(nodeEffects)) {
          if (effects[key] === undefined) {
            effects[key] = value;
          } else if (typeof value === 'number') {
            effects[key] += value;
          }
        }
      }
    }
    
    return effects;
  }

  /**
   * 获取已学习的天赋数量
   * @returns {number}
   */
  getLearnedCount() {
    let count = 0;
    for (const node of this.nodes.values()) {
      if (node.isLearned) {
        count += node.currentLevel;
      }
    }
    return count;
  }

  /**
   * 获取天赋树布局信息
   * @returns {Object}
   */
  getLayoutInfo() {
    let maxX = 0;
    let maxY = 0;
    
    for (const node of this.nodes.values()) {
      maxX = Math.max(maxX, node.position.x);
      maxY = Math.max(maxY, node.position.y);
    }
    
    return {
      width: maxX + 1,
      height: maxY + 1,
      nodes: this.getAllNodes()
    };
  }
}


/**
 * 天赋系统主类
 */
export class TalentSystem {
  /**
   * @param {Object} [config]
   * @param {EffectResolver} [config.effectResolver] - 可注入的统一效果结算器
   */
  constructor(config = {}) {
    this.talentTrees = new Map(); // 按职业存储天赋树（节点定义，兼容旧 UI 读取）
    this.effectResolver = config.effectResolver || new EffectResolver();
    this.initializeTalentTrees();

    // 统一成长图内核：角色分配状态与效果结算的唯一真实来源
    this.progressionSystem = config.progressionSystem || new ProgressionGraphSystem({
      effectResolver: this.effectResolver
    });
    this.progressionAdapter = new LegacyProgressionAdapter({
      progressionSystem: this.progressionSystem
    });
    this._registerProgressionGraphs();
  }

  /**
   * 把硬编码天赋树导出为图配置并注册到成长图系统
   * @private
   */
  _registerProgressionGraphs() {
    for (const [className, tree] of this.talentTrees) {
      this.progressionSystem.registerGraph(convertTalentTree(tree, { id: `${className}-talent` }));
    }
  }

  /**
   * 把指定角色的分配状态投影到共享节点对象。
   *
   * 节点上的 currentLevel / isLearned 仅作为当前查询角色的只读视图，
   * 供尚未迁移到 getViewModel 的 TalentPanel 渲染使用；
   * 真实状态保存在 ProgressionState 中，按角色隔离。
   *
   * @param {Object} character - 角色数据
   */
  projectCharacterState(character) {
    const tree = this.getTalentTree(character && character.class);
    if (!tree) return;

    for (const node of tree.getAllNodes()) {
      const rank = this.progressionAdapter.getNodeRank(character, GraphMode.CLASS_TALENT, node.id);
      node.currentLevel = rank;
      node.isLearned = rank > 0;
    }
    tree.updateUnlockStatus();
  }

  /**
   * 初始化天赋树数据
   */
  initializeTalentTrees() {
    // 战士天赋树
    this.talentTrees.set('warrior', this.createWarriorTalentTree());
    
    // 军师天赋树
    this.talentTrees.set('strategist', this.createStrategistTalentTree());
    
    // 弓箭手天赋树
    this.talentTrees.set('archer', this.createArcherTalentTree());
  }

  /**
   * 创建战士天赋树
   * @returns {TalentTree}
   */
  createWarriorTalentTree() {
    const nodes = [
      // 战斗天赋 - 第一层
      new TalentNode({
        id: 'warrior_iron_will',
        name: '钢铁意志',
        description: '提高最大生命值',
        type: TalentType.SURVIVAL,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 0, y: 0 },
        effects: { maxHpBonus: 50 }
      }),
      new TalentNode({
        id: 'warrior_brutal_force',
        name: '蛮力',
        description: '提高物理攻击力',
        type: TalentType.COMBAT,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 1, y: 0 },
        effects: { attackBonus: 5 }
      }),
      new TalentNode({
        id: 'warrior_thick_skin',
        name: '厚皮',
        description: '提高防御力',
        type: TalentType.SURVIVAL,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 2, y: 0 },
        effects: { defenseBonus: 3 }
      }),

      // 战斗天赋 - 第二层
      new TalentNode({
        id: 'warrior_blood_rage',
        name: '血怒',
        description: '生命值越低，攻击力越高',
        type: TalentType.COMBAT,
        maxLevel: 3,
        prerequisites: ['warrior_brutal_force'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 1, y: 1 },
        effects: { lowHpAttackBonus: [0.1, 0.15, 0.2] }
      }),
      new TalentNode({
        id: 'warrior_shield_mastery',
        name: '盾牌精通',
        description: '提高格挡几率和格挡伤害减免',
        type: TalentType.SURVIVAL,
        maxLevel: 3,
        prerequisites: ['warrior_thick_skin'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 2, y: 1 },
        effects: { 
          blockChance: [0.05, 0.08, 0.12],
          blockReduction: [0.2, 0.3, 0.4]
        }
      }),
      new TalentNode({
        id: 'warrior_vitality',
        name: '活力',
        description: '提高生命回复速度',
        type: TalentType.SURVIVAL,
        maxLevel: 3,
        prerequisites: ['warrior_iron_will'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 0, y: 1 },
        effects: { hpRegenBonus: 2 }
      }),

      // 战斗天赋 - 第三层
      new TalentNode({
        id: 'warrior_critical_strike',
        name: '致命打击',
        description: '提高暴击率和暴击伤害',
        type: TalentType.COMBAT,
        maxLevel: 3,
        prerequisites: ['warrior_blood_rage'],
        requiredCharacterLevel: 10,
        requiredTalentPoints: 3,
        position: { x: 1, y: 2 },
        effects: { 
          criticalChance: 0.03,
          criticalDamage: 0.15
        }
      }),
      new TalentNode({
        id: 'warrior_last_stand',
        name: '背水一战',
        description: '生命值低于30%时获得伤害减免',
        type: TalentType.SURVIVAL,
        maxLevel: 3,
        prerequisites: ['warrior_vitality', 'warrior_shield_mastery'],
        requiredCharacterLevel: 10,
        requiredTalentPoints: 3,
        position: { x: 0, y: 2 },
        effects: { lowHpDamageReduction: [0.1, 0.15, 0.2] }
      }),

      // 战斗天赋 - 第四层（终极天赋）
      new TalentNode({
        id: 'warrior_unstoppable',
        name: '势不可挡',
        description: '免疫控制效果，并提高所有属性',
        type: TalentType.COMBAT,
        maxLevel: 1,
        prerequisites: ['warrior_critical_strike', 'warrior_last_stand'],
        requiredCharacterLevel: 15,
        requiredTalentPoints: 5,
        position: { x: 1, y: 3 },
        effects: { 
          controlImmunity: true,
          allStatsBonus: 0.1
        }
      })
    ];

    return new TalentTree('warrior', nodes);
  }

  /**
   * 创建军师天赋树
   * @returns {TalentTree}
   */
  createStrategistTalentTree() {
    const nodes = [
      new TalentNode({
        id: 'strategist_foresight',
        name: '洞察先机',
        description: '提高最大法力值，为连续谋划提供余裕',
        type: TalentType.UTILITY,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 0, y: 0 },
        effects: { maxManaBonus: 30 }
      }),
      new TalentNode({
        id: 'strategist_tactical_power',
        name: '谋略强化',
        description: '提高符法和谋略伤害',
        type: TalentType.COMBAT,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 1, y: 0 },
        effects: { spellDamageBonus: 8 }
      }),
      new TalentNode({
        id: 'strategist_breath_control',
        name: '调息养神',
        description: '提高法力回复速度',
        type: TalentType.UTILITY,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 2, y: 0 },
        effects: { manaRegenBonus: 2 }
      }),
      new TalentNode({
        id: 'strategist_fire_planning',
        name: '火攻推演',
        description: '提高火攻与火系符法效果',
        type: TalentType.ELEMENT,
        maxLevel: 3,
        prerequisites: ['strategist_tactical_power'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 0, y: 1 },
        effects: { fireElementBonus: 10 }
      }),
      new TalentNode({
        id: 'strategist_binding_arts',
        name: '寒阵符法',
        description: '提高寒阵与控制符法效果',
        type: TalentType.ELEMENT,
        maxLevel: 3,
        prerequisites: ['strategist_tactical_power'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 2, y: 1 },
        effects: { iceElementBonus: 10 }
      }),
      new TalentNode({
        id: 'strategist_meditation',
        name: '静思',
        description: '战斗外法力回复大幅提高',
        type: TalentType.UTILITY,
        maxLevel: 3,
        prerequisites: ['strategist_breath_control'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 1, y: 1 },
        effects: { outOfCombatManaRegen: [2, 3, 5] }
      }),
      new TalentNode({
        id: 'strategist_exploit_weakness',
        name: '洞敌破绽',
        description: '谋略攻击无视部分抗性',
        type: TalentType.COMBAT,
        maxLevel: 3,
        prerequisites: ['strategist_fire_planning', 'strategist_binding_arts'],
        requiredCharacterLevel: 10,
        requiredTalentPoints: 3,
        position: { x: 1, y: 2 },
        effects: { spellPenetration: 5 }
      }),
      new TalentNode({
        id: 'strategist_guard_talisman',
        name: '护身符阵',
        description: '由法力承担部分伤害',
        type: TalentType.SURVIVAL,
        maxLevel: 3,
        prerequisites: ['strategist_foresight'],
        requiredCharacterLevel: 10,
        requiredTalentPoints: 3,
        position: { x: 0, y: 2 },
        effects: { manaShieldPercent: [0.1, 0.15, 0.2] }
      }),
      new TalentNode({
        id: 'strategist_supreme_strategy',
        name: '决胜千里',
        description: '大幅提高全部谋略效果并减少法力消耗',
        type: TalentType.COMBAT,
        maxLevel: 1,
        prerequisites: ['strategist_exploit_weakness', 'strategist_guard_talisman'],
        requiredCharacterLevel: 15,
        requiredTalentPoints: 5,
        position: { x: 1, y: 3 },
        effects: { spellDamageMultiplier: 0.2, manaCostReduction: 0.15 }
      })
    ];

    return new TalentTree('strategist', nodes);
  }

  /**
   * 创建弓箭手天赋树
   * @returns {TalentTree}
   */
  createArcherTalentTree() {
    const nodes = [
      // 第一层
      new TalentNode({
        id: 'archer_keen_eye',
        name: '锐眼',
        description: '提高攻击命中率',
        type: TalentType.COMBAT,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 0, y: 0 },
        effects: { hitChanceBonus: 0.02 }
      }),
      new TalentNode({
        id: 'archer_swift_shot',
        name: '迅捷射击',
        description: '提高攻击速度',
        type: TalentType.COMBAT,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 1, y: 0 },
        effects: { attackSpeedBonus: 0.03 }
      }),
      new TalentNode({
        id: 'archer_nimble',
        name: '灵活',
        description: '提高移动速度和闪避率',
        type: TalentType.UTILITY,
        maxLevel: 5,
        requiredCharacterLevel: 1,
        requiredTalentPoints: 1,
        position: { x: 2, y: 0 },
        effects: { 
          speedBonus: 5,
          dodgeChance: 0.01
        }
      }),

      // 第二层
      new TalentNode({
        id: 'archer_deadly_aim',
        name: '致命瞄准',
        description: '提高暴击率',
        type: TalentType.COMBAT,
        maxLevel: 3,
        prerequisites: ['archer_keen_eye'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 0, y: 1 },
        effects: { criticalChance: 0.04 }
      }),
      new TalentNode({
        id: 'archer_piercing_shot',
        name: '穿透射击',
        description: '攻击无视部分护甲',
        type: TalentType.COMBAT,
        maxLevel: 3,
        prerequisites: ['archer_swift_shot'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 1, y: 1 },
        effects: { armorPenetration: 5 }
      }),
      new TalentNode({
        id: 'archer_evasion',
        name: '闪避专精',
        description: '大幅提高闪避率',
        type: TalentType.SURVIVAL,
        maxLevel: 3,
        prerequisites: ['archer_nimble'],
        requiredCharacterLevel: 5,
        requiredTalentPoints: 2,
        position: { x: 2, y: 1 },
        effects: { dodgeChance: 0.03 }
      }),

      // 第三层
      new TalentNode({
        id: 'archer_headshot',
        name: '爆头',
        description: '暴击伤害大幅提高',
        type: TalentType.COMBAT,
        maxLevel: 3,
        prerequisites: ['archer_deadly_aim', 'archer_piercing_shot'],
        requiredCharacterLevel: 10,
        requiredTalentPoints: 3,
        position: { x: 0, y: 2 },
        effects: { criticalDamage: 0.25 }
      }),
      new TalentNode({
        id: 'archer_wind_walker',
        name: '风行者',
        description: '移动时获得攻击力加成',
        type: TalentType.UTILITY,
        maxLevel: 3,
        prerequisites: ['archer_evasion'],
        requiredCharacterLevel: 10,
        requiredTalentPoints: 3,
        position: { x: 2, y: 2 },
        effects: { movingAttackBonus: [0.05, 0.1, 0.15] }
      }),

      // 第四层（终极天赋）
      new TalentNode({
        id: 'archer_eagle_eye',
        name: '鹰眼',
        description: '大幅提高攻击范围和暴击率',
        type: TalentType.COMBAT,
        maxLevel: 1,
        prerequisites: ['archer_headshot', 'archer_wind_walker'],
        requiredCharacterLevel: 15,
        requiredTalentPoints: 5,
        position: { x: 1, y: 3 },
        effects: { 
          rangeBonus: 50,
          criticalChance: 0.1,
          criticalDamage: 0.3
        }
      })
    ];

    return new TalentTree('archer', nodes);
  }

  /**
   * 获取指定职业的天赋树
   * @param {string} className - 职业名称
   * @returns {TalentTree|null}
   */
  getTalentTree(className) {
    return this.talentTrees.get(className) || null;
  }

  /**
   * 学习天赋
   * @param {Object} character - 角色数据
   * @param {string} talentId - 天赋ID
   * @returns {Object} {success: boolean, message: string}
   */
  learnTalent(character, talentId) {
    const talentTree = this.getTalentTree(character && character.class);
    if (!talentTree) {
      return { success: false, message: `未找到职业 ${character && character.class} 的天赋树` };
    }
    if (!talentTree.getNode(talentId)) {
      return { success: false, message: `天赋 ${talentId} 不存在` };
    }

    // 转发到统一成长图内核，角色等级不再写入共享节点
    const result = this.progressionAdapter.learnTalent(character, talentId);
    if (result.success) this.projectCharacterState(character);
    return result;
  }

  /**
   * 重置天赋树
   * @param {Object} character - 角色数据
   * @returns {number} 返还的天赋点数
   */
  resetTalentTree(character) {
    const talentTree = this.getTalentTree(character && character.class);
    if (!talentTree) {
      console.warn(`未找到职业 ${character && character.class} 的天赋树`);
      return 0;
    }

    const refunded = this.progressionAdapter.resetTalentTree(character);
    this.projectCharacterState(character);
    return refunded;
  }

  /**
   * 获取角色的天赋效果
   * @param {Object} character - 角色数据
   * @returns {Object} 天赋效果汇总
   */
  getTalentEffects(character) {
    const talentTree = this.getTalentTree(character && character.class);
    if (!talentTree) {
      return {};
    }

    return this.progressionAdapter.getTalentEffects(character);
  }

  /**
   * 检查天赋是否可学习
   * @param {Object} character - 角色数据
   * @param {string} talentId - 天赋ID
   * @returns {Object} {canLearn: boolean, reason: string}
   */
  canLearnTalent(character, talentId) {
    const talentTree = this.getTalentTree(character && character.class);
    if (!talentTree) {
      return { canLearn: false, reason: '未找到天赋树' };
    }

    if (!talentTree.getNode(talentId)) {
      return { canLearn: false, reason: '天赋不存在' };
    }

    return this.progressionAdapter.canLearnTalent(character, talentId);
  }

  /**
   * 角色升级时获得天赋点
   * @param {Object} character - 角色数据
   * @param {number} level - 新等级
   */
  onLevelUp(character, level) {
    // 每级获得1个天赋点
    const pointsGained = 1;
    character.talentPoints = (character.talentPoints || 0) + pointsGained;
    
    Logger.log(`角色升级到 ${level} 级，获得 ${pointsGained} 天赋点`);
  }

  /**
   * 应用天赋效果到角色属性
   * @param {Object} character - 角色数据
   * @param {Object} baseStats - 基础属性
   * @returns {Object} 应用效果后的属性
   */
  applyTalentEffects(character, baseStats) {
    const effects = this.getTalentEffects(character);
    if (!effects || Object.keys(effects).length === 0) {
      return { ...baseStats };
    }

    const modifiedStats = this.progressionAdapter.applyEffectsToStats(
      character,
      baseStats,
      TALENT_STAT_TARGETS
    );

    // 保留旧字段供尚未迁移的系统与 UI 使用
    modifiedStats.talentEffects = effects;

    return modifiedStats;
  }

  /**
   * 同步角色的效果来源。
   *
   * 分配动作已由成长图内核自动同步效果，此方法保留用于外部显式刷新
   * （例如存档恢复后），行为为幂等。
   *
   * @param {Object} character - 角色数据
   * @returns {string} 来源标识
   */
  syncEffectSource(character) {
    const graphId = this.progressionAdapter.resolveGraphId(character, GraphMode.CLASS_TALENT);
    if (!graphId) return this.getEffectSourceId(character);
    return this.progressionSystem.syncEffectSource(this._resolveEntityId(character), graphId);
  }

  /**
   * 获取角色天赋在 EffectResolver 中的来源标识
   * @param {Object} character - 角色数据
   * @returns {string}
   */
  getEffectSourceId(character) {
    return `progression:${character && character.class ? character.class : 'unknown'}-talent`;
  }

  /**
   * 获取天赋树 UI 视图模型（推荐替代直接读取节点状态）
   * @param {Object} character - 角色数据
   * @returns {Object|null}
   */
  getViewModel(character) {
    return this.progressionAdapter.getViewModel(character, GraphMode.CLASS_TALENT);
  }

  /**
   * 序列化角色天赋成长数据
   * @param {Object} character - 角色数据
   * @returns {Object}
   */
  serializeCharacter(character) {
    return this.progressionAdapter.serialize(character);
  }

  /**
   * 恢复角色天赋成长数据，并刷新节点投影
   * @param {Object} character - 角色数据
   * @param {Object} data - 存档数据
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  deserializeCharacter(character, data) {
    const result = this.progressionAdapter.deserialize(character, data);
    if (result.ok) this.projectCharacterState(character);
    return result;
  }

  /**
   * 查询天赋对某个数值的贡献明细
   * @param {Object} character - 角色数据
   * @param {string} target - 目标数值名，如 'attack'
   * @param {number} [baseValue] - 基线值
   * @returns {Object}
   */
  explainTalentEffect(character, target, baseValue = 0) {
    this.syncEffectSource(character);
    return this.effectResolver.explain(this._resolveEntityId(character), target, baseValue);
  }

  /**
   * 解析角色在效果系统中的实体标识
   * @private
   * @param {Object} character
   * @returns {string}
   */
  _resolveEntityId(character) {
    if (!character) return 'unknown-character';
    return String(character.id || character.characterId || character.name || 'default-character');
  }
}

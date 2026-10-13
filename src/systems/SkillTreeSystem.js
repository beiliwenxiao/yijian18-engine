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
 * SkillTreeSystem.js
 * 技能树系统 - 管理技能树数据结构、技能点分配和技能解锁
 *
 * 被动效果不再由调用方逐字段解释，统一通过 EffectResolver 结算；
 * 主动技能的实际释放将在 AbilitySystem 中处理，本系统只负责解锁与等级。
 */

import { Logger } from '../core/Logger.js';
import { EffectResolver } from './effects/EffectResolver.js';
import { ProgressionGraphSystem } from './progression/ProgressionGraphSystem.js';
import { LegacyProgressionAdapter } from './progression/LegacyProgressionAdapter.js';
import { convertSkillTree } from './progression/LegacyTreeConverter.js';
import { GraphMode } from './progression/GraphDefinition.js';

/** 被动技能可作用的角色属性字段（与现有 stats 字段命名保持一致） */
const SKILL_STAT_TARGETS = ['maxHp', 'maxMp', 'attack', 'defense', 'speed', 'hpRegen', 'manaRegen'];

/**
 * 技能树节点
 */
export class SkillTreeNode {
  /**
   * @param {Object} config - 节点配置
   * @param {string} config.id - 技能ID
   * @param {string} config.name - 技能名称
   * @param {string} config.description - 技能描述
   * @param {string} config.type - 技能类型 ('active' | 'passive')
   * @param {number} config.maxLevel - 最大等级
   * @param {Array<string>} config.prerequisites - 前置技能ID列表
   * @param {number} config.requiredLevel - 需要的角色等级
   * @param {number} config.requiredPoints - 需要的技能点数
   * @param {Object} config.position - 在技能树中的位置 {x, y}
   * @param {Object} config.effects - 技能效果配置
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.type = config.type || 'active'; // 'active' 或 'passive'
    this.maxLevel = config.maxLevel || 1;
    this.currentLevel = 0;
    this.prerequisites = config.prerequisites || [];
    this.requiredLevel = config.requiredLevel || 1;
    this.requiredPoints = config.requiredPoints || 1;
    this.position = config.position || { x: 0, y: 0 };
    this.effects = config.effects || {};
    this.isUnlocked = false;
    this.isLearned = false;
  }

  /**
   * 检查是否可以学习
   * @param {Object} character - 角色数据
   * @param {SkillTree} skillTree - 技能树实例
   * @returns {boolean}
   */
  canLearn(character, skillTree) {
    // 检查是否已达到最大等级
    if (this.currentLevel >= this.maxLevel) {
      return false;
    }

    // 检查角色等级
    if (character.level < this.requiredLevel) {
      return false;
    }

    // 检查技能点
    if (character.skillPoints < this.requiredPoints) {
      return false;
    }

    // 检查前置技能
    for (const prereqId of this.prerequisites) {
      const prereqNode = skillTree.getNode(prereqId);
      if (!prereqNode || !prereqNode.isLearned) {
        return false;
      }
    }

    return true;
  }

  /**
   * 学习技能
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
   * 重置技能
   */
  reset() {
    this.currentLevel = 0;
    this.isLearned = false;
    // 保持解锁状态，因为前置条件可能仍然满足
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
        effects[key] = value * this.currentLevel;
      } else if (Array.isArray(value)) {
        effects[key] = value[Math.min(this.currentLevel - 1, value.length - 1)];
      } else {
        effects[key] = value;
      }
    }
    return effects;
  }
}

/**
 * 技能树系统
 */
export class SkillTreeSystem {
  /**
   * @param {Object} [config]
   * @param {EffectResolver} [config.effectResolver] - 可注入的统一效果结算器
   */
  constructor(config = {}) {
    this.skillTrees = new Map(); // 按职业存储技能树（节点定义，兼容旧 UI 读取）
    this.effectResolver = config.effectResolver || new EffectResolver();
    this.initializeSkillTrees();

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
   * 把硬编码技能树导出为图配置并注册到成长图系统
   * @private
   */
  _registerProgressionGraphs() {
    for (const [className, tree] of this.skillTrees) {
      this.progressionSystem.registerGraph(convertSkillTree(tree, { id: `${className}-skill` }));
    }
  }

  /**
   * 把指定角色的分配状态投影到共享节点对象。
   *
   * 节点上的 currentLevel / isLearned 仅作为当前查询角色的只读视图，
   * 供尚未迁移到 getViewModel 的 SkillTreePanel 渲染使用；
   * 真实状态保存在 ProgressionState 中，按角色隔离。
   *
   * @param {Object} character - 角色数据
   */
  projectCharacterState(character) {
    const tree = this.getSkillTree(character && character.class);
    if (!tree) return;

    for (const node of tree.getAllNodes()) {
      const rank = this.progressionAdapter.getNodeRank(character, GraphMode.CLASS_SKILL, node.id);
      node.currentLevel = rank;
      node.isLearned = rank > 0;
    }
    tree.updateUnlockStatus();
  }

  /**
   * 初始化技能树数据
   */
  initializeSkillTrees() {
    // 战士技能树
    this.skillTrees.set('warrior', this.createWarriorSkillTree());
    
    // 军师技能树
    this.skillTrees.set('strategist', this.createStrategistSkillTree());
    
    // 弓箭手技能树
    this.skillTrees.set('archer', this.createArcherSkillTree());
  }

  /**
   * 创建战士技能树
   * @returns {SkillTree}
   */
  createWarriorSkillTree() {
    const nodes = [
      // 第一层 - 基础技能
      new SkillTreeNode({
        id: 'warrior_basic_combat',
        name: '基础战斗',
        description: '提高攻击力和防御力',
        type: 'passive',
        maxLevel: 5,
        requiredLevel: 1,
        requiredPoints: 1,
        position: { x: 1, y: 0 },
        effects: {
          attackBonus: 2,
          defenseBonus: 1
        }
      }),
      
      new SkillTreeNode({
        id: 'warrior_weapon_mastery',
        name: '武器精通',
        description: '提高武器伤害',
        type: 'passive',
        maxLevel: 3,
        prerequisites: ['warrior_basic_combat'], // 添加前置条件
        requiredLevel: 3,
        requiredPoints: 1,
        position: { x: 0, y: 1 },
        effects: {
          weaponDamageMultiplier: 0.1
        }
      }),

      new SkillTreeNode({
        id: 'warrior_armor_mastery',
        name: '护甲精通',
        description: '提高护甲防御效果',
        type: 'passive',
        maxLevel: 3,
        prerequisites: ['warrior_basic_combat'], // 添加前置条件
        requiredLevel: 3,
        requiredPoints: 1,
        position: { x: 2, y: 1 },
        effects: {
          armorDefenseMultiplier: 0.15
        }
      }),

      // 第二层 - 进阶技能
      new SkillTreeNode({
        id: 'warrior_berserker_rage',
        name: '狂暴',
        description: '激活后大幅提高攻击力，但降低防御力',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['warrior_weapon_mastery'], // 修改为依赖武器精通
        requiredLevel: 8,
        requiredPoints: 2,
        position: { x: 0, y: 2 },
        effects: {
          attackMultiplier: [1.5, 1.7, 2.0],
          defenseMultiplier: [0.7, 0.6, 0.5],
          duration: [10, 12, 15],
          cooldown: [60, 55, 50]
        }
      }),

      new SkillTreeNode({
        id: 'warrior_shield_wall',
        name: '盾墙',
        description: '大幅提高防御力并反弹部分伤害',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['warrior_armor_mastery'], // 修改为依赖护甲精通
        requiredLevel: 8,
        requiredPoints: 2,
        position: { x: 2, y: 2 },
        effects: {
          defenseMultiplier: [2.0, 2.5, 3.0],
          reflectDamage: [0.2, 0.3, 0.4],
          duration: [8, 10, 12],
          cooldown: [45, 40, 35]
        }
      }),

      // 第三层 - 高级技能
      new SkillTreeNode({
        id: 'warrior_whirlwind',
        name: '旋风斩',
        description: '对周围所有敌人造成伤害',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['warrior_weapon_mastery', 'warrior_berserker_rage'],
        requiredLevel: 15,
        requiredPoints: 3,
        position: { x: 0, y: 3 },
        effects: {
          damageMultiplier: [1.5, 1.8, 2.2],
          radius: [80, 100, 120],
          manaCost: [30, 35, 40],
          cooldown: [20, 18, 15]
        }
      }),

      new SkillTreeNode({
        id: 'warrior_fortress',
        name: '要塞形态',
        description: '变为不可移动但极高防御的状态',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['warrior_armor_mastery', 'warrior_shield_wall'],
        requiredLevel: 15,
        requiredPoints: 3,
        position: { x: 2, y: 3 },
        effects: {
          defenseMultiplier: [4.0, 5.0, 6.0],
          damageReduction: [0.8, 0.85, 0.9],
          duration: [15, 18, 20],
          cooldown: [90, 80, 70]
        }
      })
    ];

    return new SkillTree('warrior', nodes);
  }

  /**
   * 创建军师技能树
   * @returns {SkillTree}
   */
  createStrategistSkillTree() {
    const nodes = [
      new SkillTreeNode({
        id: 'strategist_planning_focus',
        name: '凝神筹策',
        description: '提高最大法力值和法力回复速度，为持续谋划提供资源',
        type: 'passive',
        maxLevel: 5,
        requiredLevel: 1,
        requiredPoints: 1,
        position: { x: 1, y: 0 },
        effects: { maxManaBonus: 20, manaRegenBonus: 2 }
      }),
      new SkillTreeNode({
        id: 'strategist_fire_tactics',
        name: '火攻筹划',
        description: '提高火攻与火系符法效果',
        type: 'passive',
        maxLevel: 3,
        prerequisites: ['strategist_planning_focus'],
        requiredLevel: 3,
        requiredPoints: 1,
        position: { x: 0, y: 1 },
        effects: { fireElementBonus: 5 }
      }),
      new SkillTreeNode({
        id: 'strategist_formation_mastery',
        name: '符阵精通',
        description: '提高寒阵与控制符法效果',
        type: 'passive',
        maxLevel: 3,
        prerequisites: ['strategist_planning_focus'],
        requiredLevel: 3,
        requiredPoints: 1,
        position: { x: 2, y: 1 },
        effects: { iceElementBonus: 5 }
      }),
      new SkillTreeNode({
        id: 'strategist_fire_attack',
        name: '火攻号令',
        description: '在目标区域发动火攻，造成范围压制',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['strategist_fire_tactics'],
        requiredLevel: 10,
        requiredPoints: 2,
        position: { x: 0, y: 2 },
        effects: {
          damageMultiplier: [2.0, 2.5, 3.0],
          radius: [60, 80, 100],
          manaCost: [50, 60, 70],
          cooldown: [25, 22, 20]
        }
      }),
      new SkillTreeNode({
        id: 'strategist_wind_snow_formation',
        name: '风雪困阵',
        description: '布置持续范围符阵，减缓并消耗敌军',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['strategist_formation_mastery'],
        requiredLevel: 10,
        requiredPoints: 2,
        position: { x: 2, y: 2 },
        effects: {
          damagePerSecond: [15, 20, 25],
          radius: [120, 140, 160],
          duration: [8, 10, 12],
          manaCost: [60, 70, 80],
          cooldown: [30, 28, 25]
        }
      }),
      new SkillTreeNode({
        id: 'strategist_grand_strategy',
        name: '运筹帷幄',
        description: '全面强化符法和谋略，并获得法术穿透',
        type: 'passive',
        maxLevel: 3,
        prerequisites: ['strategist_planning_focus'],
        requiredLevel: 12,
        requiredPoints: 2,
        position: { x: 1, y: 2 },
        effects: { spellDamageMultiplier: 0.2, spellPenetration: 10 }
      }),
      new SkillTreeNode({
        id: 'strategist_stasis_formation',
        name: '定军阵',
        description: '短暂定住战局，使敌军无法行动',
        type: 'active',
        maxLevel: 1,
        prerequisites: ['strategist_grand_strategy', 'strategist_fire_attack', 'strategist_wind_snow_formation'],
        requiredLevel: 20,
        requiredPoints: 5,
        position: { x: 1, y: 3 },
        effects: { duration: 3, manaCost: 100, cooldown: 120 }
      })
    ];

    return new SkillTree('strategist', nodes);
  }

  /**
   * 创建弓箭手技能树
   * @returns {SkillTree}
   */
  createArcherSkillTree() {
    const nodes = [
      // 第一层 - 基础技能
      new SkillTreeNode({
        id: 'archer_precision',
        name: '精准射击',
        description: '提高攻击力和暴击率',
        type: 'passive',
        maxLevel: 5,
        requiredLevel: 1,
        requiredPoints: 1,
        position: { x: 1, y: 0 },
        effects: {
          attackBonus: 3,
          criticalChance: 0.05
        }
      }),

      new SkillTreeNode({
        id: 'archer_speed',
        name: '敏捷',
        description: '提高移动速度和攻击速度',
        type: 'passive',
        maxLevel: 3,
        prerequisites: ['archer_precision'], // 添加前置条件
        requiredLevel: 3,
        requiredPoints: 1,
        position: { x: 0, y: 1 },
        effects: {
          speedBonus: 10,
          attackSpeedBonus: 0.1
        }
      }),

      new SkillTreeNode({
        id: 'archer_range',
        name: '远程精通',
        description: '提高攻击范围',
        type: 'passive',
        maxLevel: 3,
        prerequisites: ['archer_precision'], // 添加前置条件
        requiredLevel: 3,
        requiredPoints: 1,
        position: { x: 2, y: 1 },
        effects: {
          rangeBonus: 30
        }
      }),

      // 第二层 - 进阶技能
      new SkillTreeNode({
        id: 'archer_rapid_fire',
        name: '连射',
        description: '快速射出多支箭',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['archer_speed'],
        requiredLevel: 8,
        requiredPoints: 2,
        position: { x: 0, y: 2 },
        effects: {
          arrowCount: [3, 4, 5],
          damageMultiplier: [0.7, 0.8, 0.9],
          manaCost: [25, 30, 35],
          cooldown: [15, 13, 10]
        }
      }),

      new SkillTreeNode({
        id: 'archer_explosive_arrow',
        name: '爆炸箭',
        description: '射出会爆炸的箭矢',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['archer_range'],
        requiredLevel: 8,
        requiredPoints: 2,
        position: { x: 2, y: 2 },
        effects: {
          damageMultiplier: [1.5, 1.8, 2.2],
          explosionRadius: [50, 60, 70],
          manaCost: [30, 35, 40],
          cooldown: [18, 16, 14]
        }
      }),

      // 第三层 - 高级技能
      new SkillTreeNode({
        id: 'archer_arrow_storm',
        name: '箭雨',
        description: '在大范围内降下箭雨',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['archer_precision', 'archer_rapid_fire'],
        requiredLevel: 15,
        requiredPoints: 3,
        position: { x: 0, y: 3 },
        effects: {
          arrowCount: [20, 30, 40],
          damageMultiplier: [0.8, 1.0, 1.2],
          radius: [150, 180, 200],
          duration: [5, 6, 7],
          manaCost: [60, 70, 80],
          cooldown: [35, 30, 25]
        }
      }),

      new SkillTreeNode({
        id: 'archer_phantom_shot',
        name: '幻影射击',
        description: '射出穿透所有敌人的幻影箭',
        type: 'active',
        maxLevel: 3,
        prerequisites: ['archer_precision', 'archer_explosive_arrow'],
        requiredLevel: 15,
        requiredPoints: 3,
        position: { x: 2, y: 3 },
        effects: {
          damageMultiplier: [2.0, 2.5, 3.0],
          pierceCount: [5, 8, 999], // 999表示无限穿透
          manaCost: [40, 45, 50],
          cooldown: [20, 18, 15]
        }
      })
    ];

    return new SkillTree('archer', nodes);
  }

  /**
   * 获取指定职业的技能树
   * @param {string} className - 职业名称
   * @returns {SkillTree|null}
   */
  getSkillTree(className) {
    return this.skillTrees.get(className) || null;
  }

  /**
   * 学习技能
   * @param {Object} character - 角色数据
   * @param {string} skillId - 技能ID
   * @returns {boolean} 是否成功学习
   */
  learnSkill(character, skillId) {
    const skillTree = this.getSkillTree(character.class);
    if (!skillTree) {
      console.warn(`未找到职业 ${character.class} 的技能树`);
      return false;
    }

    // 转发到统一成长图内核，角色等级不再写入共享节点
    const success = this.progressionAdapter.learnSkill(character, skillId);
    if (success) {
      this.projectCharacterState(character);
      const node = skillTree.getNode(skillId);
      if (node) Logger.log(`成功学习技能: ${node.name} (等级 ${node.currentLevel})`);
    }
    return success;
  }

  /**
   * 重置技能树
   * @param {Object} character - 角色数据
   * @returns {number} 返还的技能点数
   */
  resetSkillTree(character) {
    const skillTree = this.getSkillTree(character.class);
    if (!skillTree) {
      console.warn(`未找到职业 ${character.class} 的技能树`);
      return 0;
    }

    const refunded = this.progressionAdapter.resetSkillTree(character);
    this.projectCharacterState(character);
    return refunded;
  }

  /**
   * 获取角色的被动技能效果
   * @param {Object} character - 角色数据
   * @returns {Object} 被动技能效果汇总
   */
  getPassiveEffects(character) {
    const skillTree = this.getSkillTree(character && character.class);
    if (!skillTree) {
      return {};
    }

    return this.progressionAdapter.getPassiveEffects(character);
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
    const graphId = this.progressionAdapter.resolveGraphId(character, GraphMode.CLASS_SKILL);
    if (!graphId) return this.getEffectSourceId(character);
    return this.progressionSystem.syncEffectSource(this._resolveEntityId(character), graphId);
  }

  /**
   * 获取角色已解锁的主动技能标识列表
   * @param {Object} character - 角色数据
   * @returns {Array<string>}
   */
  getUnlockedActiveSkillIds(character) {
    return this.getActiveSkills(character).map(s => s.id);
  }

  /**
   * 应用被动技能效果到角色属性
   * @param {Object} character - 角色数据
   * @param {Object} baseStats - 基础属性
   * @returns {Object} 应用效果后的属性
   */
  applyPassiveEffects(character, baseStats) {
    const effects = this.getPassiveEffects(character);
    if (!effects || Object.keys(effects).length === 0) {
      return { ...baseStats };
    }

    const modifiedStats = this.progressionAdapter.applyEffectsToStats(
      character,
      baseStats,
      SKILL_STAT_TARGETS
    );

    modifiedStats.passiveSkillEffects = effects;
    return modifiedStats;
  }

  /**
   * 获取角色被动技能在 EffectResolver 中的来源标识
   * @param {Object} character - 角色数据
   * @returns {string}
   */
  getEffectSourceId(character) {
    return `progression:${character && character.class ? character.class : 'unknown'}-skill`;
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

  /**
   * 获取角色的主动技能列表
   * @param {Object} character - 角色数据
   * @returns {Array} 主动技能列表
   */
  getActiveSkills(character) {
    const skillTree = this.getSkillTree(character && character.class);
    if (!skillTree) {
      return [];
    }

    return this.progressionAdapter.getActiveSkills(character);
  }

  /**
   * 检查技能是否可学习
   * @param {Object} character - 角色数据
   * @param {string} skillId - 技能ID
   * @returns {boolean}
   */
  canLearnSkill(character, skillId) {
    const skillTree = this.getSkillTree(character && character.class);
    if (!skillTree || !skillTree.getNode(skillId)) {
      return false;
    }

    return this.progressionAdapter.canLearnSkill(character, skillId);
  }

  /**
   * 获取技能树 UI 视图模型（推荐替代直接读取节点状态）
   * @param {Object} character - 角色数据
   * @returns {Object|null}
   */
  getViewModel(character) {
    return this.progressionAdapter.getViewModel(character, GraphMode.CLASS_SKILL);
  }

  /**
   * 序列化角色技能成长数据
   * @param {Object} character - 角色数据
   * @returns {Object}
   */
  serializeCharacter(character) {
    return this.progressionAdapter.serialize(character);
  }

  /**
   * 恢复角色技能成长数据，并刷新节点投影
   * @param {Object} character - 角色数据
   * @param {Object} data - 存档数据
   * @returns {{ok: boolean, errors: Array<Object>}}
   */
  deserializeCharacter(character, data) {
    const result = this.progressionAdapter.deserialize(character, data);
    if (result.ok) this.projectCharacterState(character);
    return result;
  }
}

/**
 * 技能树类
 */
export class SkillTree {
  /**
   * @param {string} className - 职业名称
   * @param {Array<SkillTreeNode>} nodes - 技能节点列表
   */
  constructor(className, nodes) {
    this.className = className;
    this.nodes = new Map();
    
    // 添加所有节点
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
    
    // 更新解锁状态
    this.updateUnlockStatus();
  }

  /**
   * 获取技能节点
   * @param {string} skillId - 技能ID
   * @returns {SkillTreeNode|null}
   */
  getNode(skillId) {
    return this.nodes.get(skillId) || null;
  }

  /**
   * 获取所有节点
   * @returns {Array<SkillTreeNode>}
   */
  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  /**
   * 学习技能
   * @param {Object} character - 角色数据
   * @param {string} skillId - 技能ID
   * @returns {boolean} 是否成功学习
   */
  learnSkill(character, skillId) {
    const node = this.getNode(skillId);
    if (!node) {
      console.warn(`技能 ${skillId} 不存在`);
      return false;
    }

    if (!node.canLearn(character, this)) {
      console.warn(`无法学习技能 ${skillId}`);
      return false;
    }

    // 消耗技能点
    character.skillPoints -= node.requiredPoints;
    
    // 学习技能
    const success = node.learn();
    
    if (success) {
      // 更新解锁状态
      this.updateUnlockStatus();
      Logger.log(`成功学习技能: ${node.name} (等级 ${node.currentLevel})`);
    }

    return success;
  }

  /**
   * 重置所有技能
   * @param {Object} character - 角色数据
   * @returns {number} 返还的技能点数
   */
  resetAllSkills(character) {
    let returnedPoints = 0;
    
    for (const node of this.nodes.values()) {
      if (node.isLearned) {
        returnedPoints += node.requiredPoints * node.currentLevel;
        node.reset();
      }
    }
    
    // 返还技能点
    character.skillPoints += returnedPoints;
    
    // 更新解锁状态
    this.updateUnlockStatus();
    
    Logger.log(`技能树重置完成，返还 ${returnedPoints} 技能点`);
    return returnedPoints;
  }

  /**
   * 更新技能解锁状态
   */
  updateUnlockStatus() {
    for (const node of this.nodes.values()) {
      // 检查前置条件
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
   * 获取被动技能效果
   * @returns {Object} 被动技能效果汇总
   */
  getPassiveEffects() {
    const effects = {};
    
    for (const node of this.nodes.values()) {
      if (node.type === 'passive' && node.isLearned) {
        const nodeEffects = node.getCurrentEffects();
        
        // 合并效果
        for (const [key, value] of Object.entries(nodeEffects)) {
          if (effects[key] === undefined) {
            effects[key] = value;
          } else {
            effects[key] += value;
          }
        }
      }
    }
    
    return effects;
  }

  /**
   * 获取主动技能列表
   * @returns {Array} 主动技能列表
   */
  getActiveSkills() {
    const activeSkills = [];
    
    for (const node of this.nodes.values()) {
      if (node.type === 'active' && node.isLearned) {
        activeSkills.push({
          id: node.id,
          name: node.name,
          description: node.description,
          level: node.currentLevel,
          effects: node.getCurrentEffects()
        });
      }
    }
    
    return activeSkills;
  }

  /**
   * 获取技能树布局信息（用于UI渲染）
   * @returns {Object} 布局信息
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
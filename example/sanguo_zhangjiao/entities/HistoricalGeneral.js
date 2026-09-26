/**
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 */

/**
 * HistoricalGeneral.js
 * 历史武将系统 - 管理历史武将的登场、战斗和撤退
 * 
 * 复用系统:
 * - Camera: 武将登场特写镜头
 * - ParticleSystem: 武将特效
 * - SkillEffects: 技能特效
 * - SkillTreeSystem: 武将特殊技能
 */

import { Entity } from '../../../src/ecs/Entity.js';
import { setTimeoutFn } from '../../../src/core/Timers.js';
import { TransformComponent } from '../../../src/ecs/components/TransformComponent.js';
import { SpriteComponent } from '../../../src/ecs/components/SpriteComponent.js';
import { CombatComponent } from '../../../src/ecs/components/CombatComponent.js';
import { StatsComponent } from '../../../src/ecs/components/StatsComponent.js';
import { MovementComponent } from '../../../src/ecs/components/MovementComponent.js';

/**
 * 历史武将类
 * 继承自 Entity，添加历史武将特有的功能
 */
export class HistoricalGeneral extends Entity {
  /**
   * @param {string} id - 武将唯一标识
   * @param {Object} data - 武将数据
   * @param {Object} systems - 系统引用
   */
  constructor(id, data, systems = {}) {
    super(id, 'historical_general');
    
    // 武将基础信息
    this.generalName = data.name || '未知武将';
    this.title = data.title || '';
    this.biography = data.biography || '';
    this.level = data.level || 1;
    
    // 系统引用
    this.camera = systems.camera;
    this.particleSystem = systems.particleSystem;
    this.skillEffects = systems.skillEffects;
    this.skillTreeSystem = systems.skillTreeSystem;
    
    // 武将状态
    this.hasIntroPlayed = false;
    this.isRetreating = false;
    this.retreatThreshold = data.retreatThreshold || 0.2; // 生命值低于20%时撤退
    
    // 特殊能力
    this.specialAbilities = data.specialAbilities || [];
    this.skills = data.skills || [];
    
    // 登场特效配置
    this.cinematicIntro = data.cinematicIntro || {
      text: `${this.generalName}，字${this.title}`,
      duration: 3000, // 3秒
      cameraEffect: 'zoom_in'
    };
    
    // 初始化组件
    this.initializeComponents(data);
    
    console.log(`HistoricalGeneral: Created ${this.generalName} (${this.title})`);
  }

  /**
   * 初始化实体组件
   * @param {Object} data - 武将数据
   */
  initializeComponents(data) {
    // 位置组件
    const transform = new TransformComponent(
      data.position?.x || 0,
      data.position?.y || 0
    );
    this.addComponent(transform);
    
    // 精灵组件（外观）
    const sprite = new SpriteComponent({
      width: data.width || 64,
      height: data.height || 64,
      color: data.color || '#ff0000', // 默认红色表示敌方
      layer: 2 // 武将在较高层级
    });
    this.addComponent(sprite);
    
    // 属性组件
    const stats = new StatsComponent({
      maxHp: data.attributes?.health || 1000,
      hp: data.attributes?.health || 1000,
      maxMp: 100,
      mp: 100,
      attack: data.attributes?.attack || 50,
      defense: data.attributes?.defense || 30,
      speed: data.attributes?.speed || 100,
      level: this.level
    });
    this.addComponent(stats);
    
    // 战斗组件
    const combat = new CombatComponent({
      attackRange: data.attackRange || 100,
      attackCooldown: (data.attackSpeed || 1.0) * 1000 // 转换为毫秒
    });
    // 添加阵营属性（自定义属性）
    combat.faction = 'enemy'; // 历史武将通常是敌方
    this.addComponent(combat);
    
    // 移动组件
    const movement = new MovementComponent({
      speed: data.attributes?.speed || 100,
      acceleration: 500,
      friction: 0.9
    });
    this.addComponent(movement);
  }

  /**
   * 播放武将登场特写
   * 复用 Camera 系统实现特写镜头效果
   * @returns {Promise} 返回Promise，在特写结束后resolve
   */
  playIntroduction() {
    if (this.hasIntroPlayed) {
      return Promise.resolve();
    }
    
    this.hasIntroPlayed = true;
    
    return new Promise((resolve) => {
      const transform = this.getComponent('transform');
      if (!transform || !this.camera) {
        console.warn('HistoricalGeneral: Cannot play intro without camera or transform');
        resolve();
        return;
      }
      
      console.log(`HistoricalGeneral: Playing introduction for ${this.generalName}`);
      
      // 保存原始相机状态
      const originalTarget = this.camera.target;
      const originalFollowSpeed = this.camera.followSpeed;
      
      // 相机特写效果
      if (this.cinematicIntro.cameraEffect === 'zoom_in') {
        // 快速移动相机到武将位置
        this.camera.setTarget(this);
        this.camera.followSpeed = 0.3; // 快速跟随
      }
      
      // 创建登场特效
      this.createIntroEffect();
      
      // 显示武将介绍文本（这里简化处理，实际应该通过UI系统显示）
      this.displayIntroText();
      
      // 持续指定时间后恢复
      setTimeoutFn(() => {
        // 恢复相机状态
        this.camera.setTarget(originalTarget);
        this.camera.followSpeed = originalFollowSpeed;

        console.log(`HistoricalGeneral: Introduction complete for ${this.generalName}`);
        resolve();
      }, this.cinematicIntro.duration);
    });
  }

  /**
   * 创建登场特效
   * 复用 ParticleSystem 创建华丽的登场效果
   */
  createIntroEffect() {
    if (!this.particleSystem) return;
    
    const transform = this.getComponent('transform');
    if (!transform) return;
    
    const position = transform.position;
    
    // 创建金色光环效果
    this.particleSystem.emitBurst(
      {
        position: { x: position.x, y: position.y },
        velocity: { x: 0, y: 0 },
        life: 2000, // 2秒
        size: 12,
        color: '#ffd700', // 金色
        gravity: 0
      },
      30,
      {
        velocityRange: { min: 50, max: 150 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 8, max: 16 },
        lifeRange: { min: 1500, max: 2500 }
      }
    );
    
    // 创建向上的光柱效果
    const emitter = this.particleSystem.createEmitter({
      position: { x: position.x, y: position.y },
      particleConfig: {
        position: { x: position.x, y: position.y },
        velocity: { x: 0, y: -100 },
        life: 1500,
        size: 10,
        color: '#ffaa00',
        gravity: -20 // 向上飘
      },
      rate: 40,
      duration: 2.0
    });
    
    // 注意：这里需要在外部更新发射器
    // 实际使用时应该将emitter添加到某个管理列表中
  }

  /**
   * 显示介绍文本
   * 实际应该通过UI系统显示，这里只是打印日志
   */
  displayIntroText() {
    console.log(`=== ${this.generalName} ===`);
    console.log(`字: ${this.title}`);
    if (this.biography) {
      console.log(`简介: ${this.biography}`);
    }
    console.log('===================');
  }

  /**
   * 使用武将特殊技能
   * 复用 SkillTreeSystem 和 SkillEffects
   * @param {string} skillId - 技能ID
   * @param {Object} target - 目标对象
   * @returns {boolean} 是否成功使用技能
   */
  useSpecialSkill(skillId, target = null) {
    if (!this.skills.includes(skillId)) {
      console.warn(`HistoricalGeneral: ${this.generalName} does not have skill ${skillId}`);
      return false;
    }
    
    const combat = this.getComponent('combat');
    const currentTime = Date.now();
    
    if (!combat || !combat.canUseSkill(skillId, currentTime)) {
      return false;
    }
    
    console.log(`HistoricalGeneral: ${this.generalName} uses ${skillId}`);
    
    // 获取技能数据
    const skillData = this.getSkillData(skillId);
    if (!skillData) {
      console.warn(`HistoricalGeneral: Skill data not found for ${skillId}`);
      return false;
    }
    
    // 添加技能到战斗组件（如果还没有）
    if (!combat.skills.find(s => s.id === skillId)) {
      combat.addSkill({
        id: skillId,
        ...skillData,
        cooldown: (skillData.cooldown || 5000) / 1000 // 转换为秒
      });
    }
    
    // 使用技能
    combat.useSkill(skillId, currentTime);
    
    // 创建技能特效
    if (this.skillEffects) {
      const transform = this.getComponent('transform');
      const targetPos = target?.getComponent?.('transform')?.position || target;
      
      this.skillEffects.createSkillEffect(
        skillId,
        transform.position,
        targetPos,
        (hitPos) => {
          // 技能命中回调
          this.onSkillHit(skillId, target, hitPos);
        }
      );
    }
    
    return true;
  }

  /**
   * 获取技能数据
   * @param {string} skillId - 技能ID
   * @returns {Object|null} 技能数据
   */
  getSkillData(skillId) {
    // 这里应该从技能数据库或配置中获取
    // 简化处理，返回基础数据
    const skillDatabase = {
      'cavalry_charge': {
        name: '骑兵冲锋',
        damage: 150,
        cooldown: 8000,
        range: 200
      },
      'tactical_genius': {
        name: '战术天才',
        buffDuration: 10000,
        cooldown: 15000,
        effect: 'increase_ally_attack'
      },
      'benevolence': {
        name: '仁德',
        healAmount: 200,
        cooldown: 12000,
        range: 150
      },
      'inspire_troops': {
        name: '激励士气',
        buffDuration: 15000,
        cooldown: 20000,
        effect: 'increase_ally_morale'
      }
    };
    
    return skillDatabase[skillId] || null;
  }

  /**
   * 技能命中回调
   * @param {string} skillId - 技能ID
   * @param {Object} target - 目标对象
   * @param {Object} hitPos - 命中位置
   */
  onSkillHit(skillId, target, hitPos) {
    const skillData = this.getSkillData(skillId);
    if (!skillData) return;
    
    // 根据技能类型处理效果
    if (skillData.damage && target) {
      // 造成伤害
      const targetStats = target.getComponent?.('stats');
      if (targetStats) {
        const stats = this.getComponent('stats');
        const finalDamage = Math.max(1, skillData.damage + (stats?.attack || 0) - (targetStats.defense || 0));
        targetStats.takeDamage(finalDamage);
        console.log(`HistoricalGeneral: ${this.generalName}'s ${skillId} deals ${finalDamage} damage`);
      }
    } else if (skillData.healAmount) {
      // 治疗效果
      const stats = this.getComponent('stats');
      if (stats) {
        stats.heal(skillData.healAmount);
        console.log(`HistoricalGeneral: ${this.generalName} heals ${skillData.healAmount} HP`);
      }
    }
  }

  /**
   * 检查是否应该撤退
   * @returns {boolean} 是否应该撤退
   */
  shouldRetreat() {
    if (this.isRetreating) return true;
    
    const stats = this.getComponent('stats');
    if (!stats) return false;
    
    const healthPercent = stats.hp / stats.maxHp;
    return healthPercent <= this.retreatThreshold;
  }

  /**
   * 执行撤退逻辑
   * 武将不会死亡，而是撤退离开战场
   */
  retreat() {
    if (this.isRetreating) return;
    
    this.isRetreating = true;
    console.log(`HistoricalGeneral: ${this.generalName} is retreating!`);
    
    // 创建撤退特效
    this.createRetreatEffect();
    
    // 播放撤退对话（如果有）
    this.displayRetreatMessage();
    
    // 设置撤退状态
    const combat = this.getComponent('combat');
    if (combat) {
      combat.faction = 'neutral'; // 变为中立，不再参与战斗
    }
    
    // 开始向地图边缘移动
    this.moveToMapEdge();
  }

  /**
   * 创建撤退特效
   */
  createRetreatEffect() {
    if (!this.particleSystem) return;
    
    const transform = this.getComponent('transform');
    if (!transform) return;
    
    // 创建烟雾效果
    this.particleSystem.emitBurst(
      {
        position: { x: transform.position.x, y: transform.position.y },
        velocity: { x: 0, y: 0 },
        life: 1500,
        size: 20,
        color: '#888888',
        gravity: -10
      },
      25,
      {
        velocityRange: { min: 30, max: 80 },
        angleRange: { min: 0, max: Math.PI * 2 },
        sizeRange: { min: 15, max: 25 },
        lifeRange: { min: 1000, max: 2000 }
      }
    );
  }

  /**
   * 显示撤退消息
   */
  displayRetreatMessage() {
    const messages = [
      `${this.generalName}: 今日不宜久战，撤！`,
      `${this.generalName}: 留得青山在，不怕没柴烧！`,
      `${this.generalName}: 此地不可久留，速速撤退！`
    ];
    
    const message = messages[Math.floor(Math.random() * messages.length)];
    console.log(message);
  }

  /**
   * 移动到地图边缘
   */
  moveToMapEdge() {
    const transform = this.getComponent('transform');
    const movement = this.getComponent('movement');
    
    if (!transform || !movement) return;
    
    // 简化处理：向最近的地图边缘移动
    // 实际应该根据地图边界计算
    const currentX = transform.position.x;
    const currentY = transform.position.y;
    
    // 假设地图中心在 (0, 0)，向远离中心的方向移动
    const angle = Math.atan2(currentY, currentX);
    const retreatSpeed = 200;
    
    movement.velocity.x = Math.cos(angle) * retreatSpeed;
    movement.velocity.y = Math.sin(angle) * retreatSpeed;
    
    // 设置一个定时器，一段时间后移除武将
    setTimeoutFn(() => {
      this.active = false;
      console.log(`HistoricalGeneral: ${this.generalName} has left the battlefield`);
    }, 5000); // 5秒后离开
  }

  /**
   * 更新武将状态
   * @param {number} deltaTime - 帧间隔时间（毫秒）
   */
  update(deltaTime) {
    if (!this.active) return;
    
    // 检查是否应该撤退
    if (!this.isRetreating && this.shouldRetreat()) {
      this.retreat();
    }
    
    // 更新所有组件
    super.update(deltaTime);
    
    // 武将特有的AI逻辑可以在这里添加
    if (!this.isRetreating) {
      this.updateCombatAI(deltaTime);
    }
  }

  /**
   * 更新战斗AI
   * @param {number} deltaTime - 帧间隔时间（毫秒）
   */
  updateCombatAI(deltaTime) {
    // 简化的AI逻辑
    // 实际应该更复杂，包括技能使用判断、目标选择等
    
    const combat = this.getComponent('combat');
    if (!combat) return;
    
    // 随机使用技能（简化处理）
    if (this.skills.length > 0 && Math.random() < 0.01) { // 1%概率每帧
      const randomSkill = this.skills[Math.floor(Math.random() * this.skills.length)];
      this.useSpecialSkill(randomSkill);
    }
  }

  /**
   * 获取武将信息
   * @returns {Object} 武将信息对象
   */
  getInfo() {
    const stats = this.getComponent('stats');
    const transform = this.getComponent('transform');
    
    return {
      id: this.id,
      name: this.generalName,
      title: this.title,
      level: this.level,
      health: stats?.hp || 0,
      maxHealth: stats?.maxHp || 0,
      position: transform?.position || { x: 0, y: 0 },
      isRetreating: this.isRetreating,
      skills: this.skills,
      specialAbilities: this.specialAbilities
    };
  }
}

/**
 * 历史武将工厂
 * 用于创建预定义的历史武将
 */
export class HistoricalGeneralFactory {
  /**
   * @param {Object} systems - 系统引用
   */
  constructor(systems) {
    this.systems = systems;
    this.generalDatabase = this.initializeGeneralDatabase();
  }

  /**
   * 初始化武将数据库
   * @returns {Map} 武将数据映射
   */
  initializeGeneralDatabase() {
    const database = new Map();
    
    // 曹操
    database.set('cao_cao', {
      name: '曹操',
      title: '孟德',
      biography: '魏武帝，三国时期著名的政治家、军事家、文学家',
      level: 20,
      position: { x: 0, y: 0 },
      attributes: {
        health: 1500,
        attack: 80,
        defense: 60,
        speed: 120,
        strength: 25,
        agility: 20,
        intelligence: 30,
        constitution: 28,
        spirit: 25
      },
      skills: ['cavalry_charge', 'tactical_genius'],
      specialAbilities: ['奸雄', '治世之能臣'],
      retreatThreshold: 0.3,
      attackRange: 150,
      color: '#8b0000'
    });
    
    // 刘备
    database.set('liu_bei', {
      name: '刘备',
      title: '玄德',
      biography: '蜀汉昭烈帝，以仁德著称',
      level: 18,
      position: { x: 0, y: 0 },
      attributes: {
        health: 1400,
        attack: 70,
        defense: 70,
        speed: 90,
        strength: 22,
        agility: 18,
        intelligence: 25,
        constitution: 26,
        spirit: 28
      },
      skills: ['benevolence', 'inspire_troops'],
      specialAbilities: ['仁德', '激励'],
      retreatThreshold: 0.25,
      attackRange: 120,
      color: '#006400'
    });
    
    // 关羽
    database.set('guan_yu', {
      name: '关羽',
      title: '云长',
      biography: '蜀汉五虎上将之首，忠义无双',
      level: 22,
      position: { x: 0, y: 0 },
      attributes: {
        health: 1600,
        attack: 95,
        defense: 75,
        speed: 100,
        strength: 30,
        agility: 22,
        intelligence: 20,
        constitution: 30,
        spirit: 25
      },
      skills: ['warrior_slash', 'warrior_charge'],
      specialAbilities: ['武圣', '义薄云天'],
      retreatThreshold: 0.2,
      attackRange: 130,
      color: '#8b0000'
    });
    
    // 张飞
    database.set('zhang_fei', {
      name: '张飞',
      title: '翼德',
      biography: '蜀汉五虎上将，勇猛过人',
      level: 21,
      position: { x: 0, y: 0 },
      attributes: {
        health: 1700,
        attack: 90,
        defense: 70,
        speed: 95,
        strength: 32,
        agility: 20,
        intelligence: 15,
        constitution: 32,
        spirit: 20
      },
      skills: ['warrior_slash', 'warrior_defense'],
      specialAbilities: ['猛将', '咆哮'],
      retreatThreshold: 0.15,
      attackRange: 120,
      color: '#8b0000'
    });
    
    // 赵云
    database.set('zhao_yun', {
      name: '赵云',
      title: '子龙',
      biography: '蜀汉五虎上将，常胜将军',
      level: 20,
      position: { x: 0, y: 0 },
      attributes: {
        health: 1500,
        attack: 85,
        defense: 80,
        speed: 110,
        strength: 26,
        agility: 25,
        intelligence: 22,
        constitution: 28,
        spirit: 23
      },
      skills: ['warrior_charge', 'warrior_defense'],
      specialAbilities: ['常胜', '龙胆'],
      retreatThreshold: 0.25,
      attackRange: 140,
      color: '#ffffff'
    });
    
    // 皇甫嵩
    database.set('huangfu_song', {
      name: '皇甫嵩',
      title: '义真',
      biography: '东汉末年名将，平定黄巾起义的主要将领',
      level: 19,
      position: { x: 0, y: 0 },
      attributes: {
        health: 1450,
        attack: 75,
        defense: 75,
        speed: 95,
        strength: 24,
        agility: 19,
        intelligence: 26,
        constitution: 27,
        spirit: 24
      },
      skills: ['tactical_genius', 'inspire_troops'],
      specialAbilities: ['名将', '平叛'],
      retreatThreshold: 0.3,
      attackRange: 130,
      color: '#4169e1'
    });
    
    return database;
  }

  /**
   * 创建历史武将
   * @param {string} generalId - 武将ID
   * @param {Object} overrides - 覆盖配置
   * @returns {HistoricalGeneral} 武将实例
   */
  createGeneral(generalId, overrides = {}) {
    const data = this.generalDatabase.get(generalId);
    if (!data) {
      console.error(`HistoricalGeneralFactory: Unknown general ID: ${generalId}`);
      return null;
    }
    
    // 合并覆盖配置
    const finalData = {
      ...data,
      ...overrides,
      attributes: {
        ...data.attributes,
        ...(overrides.attributes || {})
      }
    };
    
    const general = new HistoricalGeneral(
      `general_${generalId}_${Date.now()}`,
      finalData,
      this.systems
    );
    
    return general;
  }

  /**
   * 批量创建武将
   * @param {Array<string>} generalIds - 武将ID数组
   * @param {Object} commonOverrides - 通用覆盖配置
   * @returns {Array<HistoricalGeneral>} 武将实例数组
   */
  createGenerals(generalIds, commonOverrides = {}) {
    return generalIds.map(id => this.createGeneral(id, commonOverrides)).filter(g => g !== null);
  }

  /**
   * 获取所有可用的武将ID
   * @returns {Array<string>} 武将ID数组
   */
  getAvailableGenerals() {
    return Array.from(this.generalDatabase.keys());
  }
}

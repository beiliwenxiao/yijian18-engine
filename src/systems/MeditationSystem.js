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

import { Logger } from '../core/Logger.js';

/**
 * MeditationSystem.js
 * 冥想/打坐系统 - 管理打坐状态、恢复逻辑、中断检测
 */

export class MeditationSystem {
  /**
   * @param {Object} config - 配置
   * @param {number} config.healPercent - 每秒恢复血量百分比，默认0.1
   * @param {number} config.manaPercent - 每秒恢复魔法百分比，默认0.1
   * @param {number} config.tickInterval - 恢复间隔（秒），默认1.0
   */
  constructor(config = {}) {
    this.healPercent = config.healPercent ?? 0.1;
    this.manaPercent = config.manaPercent ?? 0.1;
    this.tickInterval = config.tickInterval ?? 1.0;
    this.now = typeof config.now === 'function' ? config.now : () => performance.now();
    
    // 打坐状态
    this.active = false;
    this.startTime = 0;
    this.lastTickTime = 0;
    
    // 外部依赖
    this.inputManager = null;
    this.floatingTextManager = null;
    this.skillEffects = null;
    this.combatSystem = null;
    
    // 移动按键列表
    this.moveKeys = ['up', 'down', 'left', 'right', 'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'];
  }

  /**
   * 初始化依赖
   * @param {Object} deps
   */
  init(deps = {}) {
    this.inputManager = deps.inputManager || null;
    this.floatingTextManager = deps.floatingTextManager || null;
    this.skillEffects = deps.skillEffects || null;
    this.combatSystem = deps.combatSystem || null;
  }

  /**
   * 是否正在打坐
   * @returns {boolean}
   */
  isActive() {
    return this.active;
  }

  /**
   * 开始打坐
   * @param {Object} playerEntity - 玩家实体
   * @returns {boolean} 是否成功开始
   */
  start(playerEntity) {
    if (this.combatSystem && this.combatSystem.isInCombat()) {
      Logger.log('MeditationSystem: 战斗中无法打坐');
      return false;
    }
    
    const currentTime = this.now() / 1000;
    this.active = true;
    this.startTime = currentTime;
    this.lastTickTime = currentTime;
    
    if (playerEntity) {
      const transform = playerEntity.getComponent('transform');
      if (transform) {
        if (this.floatingTextManager) {
          this.floatingTextManager.addText(
            transform.position.x, transform.position.y - 60,
            '打坐', '#00ffff'
          );
        }
        if (this.skillEffects) {
          this.skillEffects.createSkillEffect('meditation', transform.position);
        }
      }
    }
    
    Logger.log('MeditationSystem: 开始打坐');
    return true;
  }

  /**
   * 停止打坐
   */
  stop() {
    this.active = false;
    if (this.skillEffects) {
      this.skillEffects.stopMeditationEffect();
    }
    Logger.log('MeditationSystem: 停止打坐');
  }

  /**
   * 更新打坐状态
   * @param {number} deltaTime - 帧间隔时间（秒）
   * @param {Object} playerEntity - 玩家实体
   */
  update(deltaTime, playerEntity) {
    if (!this.active || !playerEntity) return;
    
    // 检测移动中断
    this.checkMovementInterrupt(playerEntity);
    if (!this.active) return;
    
    const currentTime = this.now() / 1000;
    const stats = playerEntity.getComponent('stats');
    const transform = playerEntity.getComponent('transform');
    
    if (!stats || !transform) return;
    
    // 满血满蓝自动停止
    if (stats.hp >= stats.maxHp && stats.mp >= stats.maxMp) {
      Logger.log('MeditationSystem: 满血满蓝，自动停止打坐');
      this.stop();
      return;
    }
    
    // 更新特效位置
    if (this.skillEffects) {
      this.skillEffects.updateMeditationPosition(transform.position);
    }
    
    // 每秒恢复
    if (currentTime - this.lastTickTime >= this.tickInterval) {
      const healAmount = Math.floor(stats.maxHp * this.healPercent);
      const manaAmount = Math.floor(stats.maxMp * this.manaPercent);
      
      const actualHeal = stats.heal(healAmount);
      const actualMana = stats.restoreMana(manaAmount);
      
      if (this.floatingTextManager) {
        if (actualHeal > 0) {
          this.floatingTextManager.addHeal(transform.position.x - 20, transform.position.y - 40, actualHeal);
        }
        if (actualMana > 0) {
          this.floatingTextManager.addManaRestore(transform.position.x + 20, transform.position.y - 40, actualMana);
        }
      }
      
      this.lastTickTime = currentTime;
    }
  }

  /**
   * 检测移动中断
   * @param {Object} playerEntity - 玩家实体
   */
  checkMovementInterrupt(playerEntity) {
    if (!this.active || !this.inputManager) return;
    
    const isMoving = this.moveKeys.some(key => this.inputManager.isKeyDown(key));
    
    if (isMoving) {
      Logger.log('MeditationSystem: 移动中断打坐');
      this.stop();
      
      if (this.floatingTextManager && playerEntity) {
        const transform = playerEntity.getComponent('transform');
        if (transform) {
          this.floatingTextManager.addText(
            transform.position.x, transform.position.y - 50,
            '移动中断打坐', '#ffaa00'
          );
        }
      }
    }
  }
}

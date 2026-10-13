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
 * example.js
 * ECS系统使用示例
 */

import { Logger } from '../core/Logger.js';
import { EntityFactory } from './EntityFactory.js';

// 创建实体工厂
const factory = new EntityFactory();

// ========== 示例1: 创建玩家角色 ==========
Logger.log('=== 示例1: 创建玩家角色 ===');

const player = factory.createPlayer({
  name: '勇者',
  class: 'warrior',
  level: 5,
  stats: {
    maxHp: 150,
    maxMp: 80,
    attack: 20,
    defense: 15,
    speed: 100
  },
  position: { x: 400, y: 300 },
  skills: [
    {
      id: 'slash',
      name: '斩击',
      cooldown: 1000,
      manaCost: 10,
      damage: 30,
      castTime: 0,
      range: 50
    }
  ]
});

Logger.log(`创建玩家: ${player.name} (${player.class})`);
Logger.log(`实体ID: ${player.id}`);
Logger.log(`实体类型: ${player.type}`);

// 获取组件
const playerTransform = player.getComponent('transform');
const playerStats = player.getComponent('stats');
const playerCombat = player.getComponent('combat');
const playerMovement = player.getComponent('movement');
const playerSprite = player.getComponent('sprite');

Logger.log(`位置: (${playerTransform.position.x}, ${playerTransform.position.y})`);
Logger.log(`生命值: ${playerStats.hp}/${playerStats.maxHp}`);
Logger.log(`魔法值: ${playerStats.mp}/${playerStats.maxMp}`);
Logger.log(`攻击力: ${playerStats.attack}`);
Logger.log(`防御力: ${playerStats.defense}`);
Logger.log(`技能数量: ${playerCombat.skills.length}`);

// ========== 示例2: 创建敌人 ==========
Logger.log('\n=== 示例2: 创建敌人 ===');

const enemy = factory.createEnemy({
  templateId: 'goblin',
  name: '哥布林战士',
  level: 3,
  stats: {
    maxHp: 50,
    attack: 8,
    defense: 5,
    speed: 80
  },
  position: { x: 500, y: 300 },
  aiType: 'aggressive'
});

Logger.log(`创建敌人: ${enemy.name}`);
Logger.log(`模板ID: ${enemy.templateId}`);
Logger.log(`AI类型: ${enemy.aiType}`);

const enemyStats = enemy.getComponent('stats');
Logger.log(`生命值: ${enemyStats.hp}/${enemyStats.maxHp}`);

// ========== 示例3: 战斗系统 ==========
Logger.log('\n=== 示例3: 战斗系统 ===');

// 设置攻击目标
playerCombat.setTarget(enemy);
Logger.log(`${player.name} 锁定目标: ${enemy.name}`);

// 执行攻击
const currentTime = Date.now();
if (playerCombat.canAttack(currentTime)) {
  playerCombat.attack(currentTime);
  
  // 计算伤害
  const damage = Math.max(1, playerStats.attack - enemyStats.defense);
  const actualDamage = enemyStats.takeDamage(damage);
  
  Logger.log(`${player.name} 攻击 ${enemy.name}，造成 ${actualDamage} 点伤害`);
  Logger.log(`${enemy.name} 剩余生命值: ${enemyStats.hp}/${enemyStats.maxHp}`);
  
  if (enemyStats.isDead()) {
    Logger.log(`${enemy.name} 被击败了！`);
  }
}

// 使用技能
Logger.log('\n使用技能:');
const skill = playerCombat.useSkill('slash', currentTime);
if (skill) {
  Logger.log(`${player.name} 使用技能: ${skill.name}`);
  
  // 消耗魔法值
  if (playerStats.consumeMana(skill.manaCost)) {
    Logger.log(`消耗魔法值: ${skill.manaCost}`);
    Logger.log(`剩余魔法值: ${playerStats.mp}/${playerStats.maxMp}`);
    
    // 技能伤害
    const skillDamage = skill.damage;
    enemyStats.takeDamage(skillDamage);
    Logger.log(`技能造成 ${skillDamage} 点伤害`);
    Logger.log(`${enemy.name} 剩余生命值: ${enemyStats.hp}/${enemyStats.maxHp}`);
  }
}

// ========== 示例4: 移动系统 ==========
Logger.log('\n=== 示例4: 移动系统 ===');

// 设置移动路径
playerMovement.setPath([
  { x: 450, y: 300 },
  { x: 500, y: 350 },
  { x: 550, y: 400 }
]);

Logger.log(`设置移动路径，共 ${playerMovement.path.length} 个路径点`);
Logger.log(`移动状态: ${playerMovement.isMoving ? '移动中' : '静止'}`);
Logger.log(`移动类型: ${playerMovement.movementType}`);

// 模拟移动更新
Logger.log('\n模拟移动:');
for (let i = 0; i < 3; i++) {
  playerMovement.calculateVelocityToTarget(playerTransform.position);
  
  // 模拟一帧的移动（假设60fps，每帧16.67ms）
  const deltaTime = 16.67 / 1000; // 转换为秒
  playerTransform.translate(
    playerMovement.velocity.x * deltaTime,
    playerMovement.velocity.y * deltaTime
  );
  
  Logger.log(`帧 ${i + 1}: 位置 (${Math.round(playerTransform.position.x)}, ${Math.round(playerTransform.position.y)})`);
  Logger.log(`  速度: (${Math.round(playerMovement.velocity.x)}, ${Math.round(playerMovement.velocity.y)})`);
  Logger.log(`  朝向: ${playerMovement.facing}`);
  
  // 检查是否到达目标点
  if (playerMovement.hasReachedTarget(playerTransform.position)) {
    Logger.log('  到达路径点！');
    if (!playerMovement.moveToNextPathPoint()) {
      Logger.log('  到达最终目的地');
      break;
    }
  }
}

// ========== 示例5: 精灵动画 ==========
Logger.log('\n=== 示例5: 精灵动画 ===');

Logger.log(`当前动画: ${playerSprite.currentAnimation}`);

// 播放行走动画
playerSprite.playAnimation('walk');
Logger.log(`切换到行走动画: ${playerSprite.currentAnimation}`);

// 模拟动画更新
Logger.log('\n模拟动画帧:');
for (let i = 0; i < 5; i++) {
  playerSprite.update(125); // 每帧125ms（8fps）
  Logger.log(`帧 ${i + 1}: 当前帧索引 ${playerSprite.frame}, 精灵帧 ${playerSprite.getCurrentFrame()}`);
}

// 播放攻击动画
playerSprite.playAnimation('attack');
Logger.log(`\n切换到攻击动画: ${playerSprite.currentAnimation}`);

// ========== 示例6: 属性操作 ==========
Logger.log('\n=== 示例6: 属性操作 ===');

Logger.log(`初始状态:`);
Logger.log(`  生命值: ${playerStats.hp}/${playerStats.maxHp} (${Math.round(playerStats.getHpPercent() * 100)}%)`);
Logger.log(`  魔法值: ${playerStats.mp}/${playerStats.maxMp} (${Math.round(playerStats.getMpPercent() * 100)}%)`);

// 受到伤害
const damage = 30;
playerStats.takeDamage(damage);
Logger.log(`\n受到 ${damage} 点伤害`);
Logger.log(`  生命值: ${playerStats.hp}/${playerStats.maxHp} (${Math.round(playerStats.getHpPercent() * 100)}%)`);

// 恢复生命值
const healAmount = 20;
const actualHeal = playerStats.heal(healAmount);
Logger.log(`\n恢复 ${actualHeal} 点生命值`);
Logger.log(`  生命值: ${playerStats.hp}/${playerStats.maxHp} (${Math.round(playerStats.getHpPercent() * 100)}%)`);

// 恢复魔法值
const manaRestore = 30;
const actualManaRestore = playerStats.restoreMana(manaRestore);
Logger.log(`\n恢复 ${actualManaRestore} 点魔法值`);
Logger.log(`  魔法值: ${playerStats.mp}/${playerStats.maxMp} (${Math.round(playerStats.getMpPercent() * 100)}%)`);

// ========== 示例7: 实体更新 ==========
Logger.log('\n=== 示例7: 实体更新 ===');

Logger.log('更新玩家实体...');
player.update(16.67); // 模拟一帧（60fps）
Logger.log('更新完成');

Logger.log('\n更新敌人实体...');
enemy.update(16.67);
Logger.log('更新完成');

// ========== 示例8: 实体销毁 ==========
Logger.log('\n=== 示例8: 实体销毁 ===');

Logger.log(`敌人状态: ${enemy.active ? '活跃' : '已销毁'}`);
Logger.log(`组件数量: ${enemy.components.size}`);

enemy.destroy();
Logger.log('\n销毁敌人实体...');
Logger.log(`敌人状态: ${enemy.active ? '活跃' : '已销毁'}`);
Logger.log(`组件数量: ${enemy.components.size}`);

Logger.log('\n=== 示例完成 ===');

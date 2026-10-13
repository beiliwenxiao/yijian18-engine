/**
 * Act5Scene - 第五幕：四场战斗
 * 
 * 继承自 BaseGameScene，包含第五幕特有功能：
 * - 四场大型战役（起义之战、广宗之战、阳城之战、黄巾终战）
 * - 玩家主动参与战斗，消灭所有敌人后按N键进入下一场
 * - 大量敌人，复用 BaseGameScene 已有战斗系统
 * 
 * 需求：24, 25, 26, 27, 28, 29, 30, 31
 */

import { Logger } from '../../../src/core/Logger.js';
import { BaseGameScene } from './BaseGameScene.js';

export class Act5Scene extends BaseGameScene {
  constructor() {
    super(5, {
      title: '第五幕：四场战斗',
      description: '黄巾起义的关键战役'
    });

    // 战斗管理
    this.currentBattle = -1;  // -1=未开始, 0=起义, 1=广宗, 2=阳城, 3=黄巾终战
    this.battleState = 'intro';  // intro, battle, cleared, complete
    this.totalBattles = 4;
    
    // 对话完成标志
    this.introDialogueCompleted = false;
    
    // 场景完成标志
    this.isSceneComplete = false;
    
    // N键防抖
    this._lastNextKeyTime = 0;
  }

  /**
   * 场景进入
   */
  enter(data = null) {
    super.enter(data);
    
    Logger.log('Act5Scene: 进入第五幕场景', data);
    
    // 重置玩家位置
    if (this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        transform.position.x = 400;
        transform.position.y = 450;
      }
    }
    
    // 清除前面幕次的敌人和物品
    this.enemyEntities = [];
    this.pickupItems = [];
    this.equipmentItems = [];
    
    // 注册对话
    this.registerAct5Dialogues();
    
    // 开始介绍对话
    this.battleState = 'intro';
    this.dialogueSystem.startDialogue('act5_intro');
  }

  /**
   * 注册第五幕对话
   */
  registerAct5Dialogues() {
    this.dialogueSystem.registerDialogue('act5_intro', {
      title: '四场战斗',
      startNode: 'start',
      nodes: {
        start: { speaker: '张角', portrait: 'zhangjiao', text: '苍天已死，黄天当立！岁在甲子，天下大吉！', nextNode: 'player_ready' },
        player_ready: { speaker: '你', portrait: 'player', text: '我已准备好战斗！', nextNode: 'zhangjiao_explain' },
        zhangjiao_explain: { speaker: '张角', portrait: 'zhangjiao', text: '我们将面临四场关键战役。每一场都关系到黄巾军的命运。', nextNode: 'zhangjiao_warning' },
        zhangjiao_warning: { speaker: '张角', portrait: 'zhangjiao', text: '朝廷派出了众多名将。你要小心应对，消灭所有敌人！', nextNode: null }
      }
    });

    this.dialogueSystem.registerDialogue('battle_uprising', {
      title: '起义之战', startNode: 'start',
      nodes: { start: { speaker: '张角', portrait: 'zhangjiao', text: '第一战：占领县城！让朝廷看看我们的力量！', nextNode: null } }
    });

    this.dialogueSystem.registerDialogue('battle_guangzong', {
      title: '广宗之战', startNode: 'start',
      nodes: {
        start: { speaker: '张角', portrait: 'zhangjiao', text: '张梁在广宗被皇甫嵩围困！曹操也来了，小心！', nextNode: null }
      }
    });

    this.dialogueSystem.registerDialogue('battle_yangcheng', {
      title: '阳城之战', startNode: 'start',
      nodes: {
        start: { speaker: '张角', portrait: 'zhangjiao', text: '张宝在阳城遭遇刘备军！刘关张三兄弟都在！', nextNode: null }
      }
    });

    this.dialogueSystem.registerDialogue('battle_final', {
      title: '黄巾终战', startNode: 'start',
      nodes: {
        start: { speaker: '张角', portrait: 'zhangjiao', text: '最后一战...朝廷大军压境，众多名将齐聚。黄天之志，永不磨灭！', nextNode: null }
      }
    });
  }

  /**
   * 开始指定战斗
   */
  startBattle(battleIndex) {
    this.currentBattle = battleIndex;
    this.battleState = 'dialogue';
    
    // 清除上一场残留敌人
    this.enemyEntities = [];
    // 也从 entities 中移除旧敌人
    this.entities = this.entities.filter(e => e.type !== 'enemy');
    
    // 重置玩家位置到场景中央
    if (this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        transform.position.x = 400;
        transform.position.y = 450;
      }
      // 恢复一些血量
      const stats = this.playerEntity.getComponent('stats');
      if (stats) {
        stats.hp = Math.min(stats.maxHp, stats.hp + Math.floor(stats.maxHp * 0.3));
      }
    }
    
    const dialogueKeys = ['battle_uprising', 'battle_guangzong', 'battle_yangcheng', 'battle_final'];
    this.dialogueSystem.startDialogue(dialogueKeys[battleIndex]);
    
    Logger.log(`Act5Scene: 开始第${battleIndex + 1}场战斗对话`);
  }

  /**
   * 生成战斗敌人
   */
  spawnBattleEnemies(battleIndex) {
    const battleConfigs = [
      // 第1场：起义之战 - 40个官府士兵 + 1个县令
      {
        waves: [
          { name: '官府士兵', count: 40, stats: { maxHp: 60, hp: 60, attack: 8, defense: 5, speed: 80 }, templateId: 'soldier' },
          { name: '县令', count: 1, stats: { maxHp: 150, hp: 150, attack: 18, defense: 12, speed: 90 }, templateId: 'soldier', color: '#FF5722' }
        ]
      },
      // 第2场：广宗之战 - 50个官府士兵 + 曹操
      {
        waves: [
          { name: '官府士兵', count: 50, stats: { maxHp: 80, hp: 80, attack: 10, defense: 7, speed: 85 }, templateId: 'soldier' },
          { name: '曹操·孟德', count: 1, stats: { maxHp: 300, hp: 300, attack: 30, defense: 20, speed: 120 }, templateId: 'soldier', color: '#9C27B0' }
        ]
      },
      // 第3场：阳城之战 - 40个官府士兵 + 刘备、关羽、张飞
      {
        waves: [
          { name: '官府士兵', count: 40, stats: { maxHp: 90, hp: 90, attack: 12, defense: 8, speed: 90 }, templateId: 'soldier' },
          { name: '刘备·玄德', count: 1, stats: { maxHp: 250, hp: 250, attack: 25, defense: 18, speed: 110 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '关羽·云长', count: 1, stats: { maxHp: 350, hp: 350, attack: 35, defense: 22, speed: 130 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '张飞·翼德', count: 1, stats: { maxHp: 380, hp: 380, attack: 38, defense: 20, speed: 125 }, templateId: 'soldier', color: '#9C27B0' }
        ]
      },
      // 第4场：黄巾终战 - 60个官府士兵 + 7个名将
      {
        waves: [
          { name: '官府精兵', count: 60, stats: { maxHp: 100, hp: 100, attack: 14, defense: 10, speed: 95 }, templateId: 'soldier' },
          { name: '卢植', count: 1, stats: { maxHp: 280, hp: 280, attack: 28, defense: 19, speed: 115 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '朱儁', count: 1, stats: { maxHp: 300, hp: 300, attack: 30, defense: 20, speed: 118 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '皇甫嵩', count: 1, stats: { maxHp: 320, hp: 320, attack: 32, defense: 22, speed: 120 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '曹操', count: 1, stats: { maxHp: 300, hp: 300, attack: 30, defense: 20, speed: 120 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '孙坚', count: 1, stats: { maxHp: 340, hp: 340, attack: 33, defense: 23, speed: 125 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '刘备', count: 1, stats: { maxHp: 260, hp: 260, attack: 26, defense: 18, speed: 112 }, templateId: 'soldier', color: '#9C27B0' },
          { name: '关羽', count: 1, stats: { maxHp: 360, hp: 360, attack: 36, defense: 24, speed: 132 }, templateId: 'soldier', color: '#9C27B0' }
        ]
      }
    ];

    const config = battleConfigs[battleIndex];
    if (!config) return;

    // 生成敌人，分散在场景右侧和上方
    for (const wave of config.waves) {
      for (let i = 0; i < wave.count; i++) {
        const x = 500 + Math.random() * 400;
        const y = 150 + Math.random() * 350;
        
        const enemy = this.entityFactory.createEnemy({
          name: wave.name,
          templateId: wave.templateId || 'soldier',
          position: { x, y },
          stats: { ...wave.stats },
          aiType: 'aggressive'
        });
        
        // 武将用紫色名字
        if (wave.color) {
          const nameComp = enemy.getComponent('name');
          if (nameComp) {
            nameComp.color = wave.color;
            nameComp.fontSize = 16;
          }
        }
        
        this.entities.push(enemy);
        this.enemyEntities.push(enemy);
      }
    }

    // 注册所有敌人的AI
    this.aiSystem.registerBatch(this.enemyEntities, 'aggressive');
    
    Logger.log(`Act5Scene: 第${battleIndex + 1}场战斗生成 ${this.enemyEntities.length} 个敌人`);
  }

  /**
   * 更新场景
   */
  update(deltaTime) {
    // 调用父类 update（处理移动、战斗、碰撞、死亡清理等）
    super.update(deltaTime);
    
    // 检查对话流程
    this.updateDialogueFlow();
    
    // 检查战斗状态
    this.updateBattleState();
    
    // 检查N键
    this.checkNextKey();
    
    // 更新提示信息
    this.updateHints();
  }

  /**
   * 更新对话流程
   */
  updateDialogueFlow() {
    if (!this.dialogueSystem || this.dialogueSystem.isDialogueActive()) return;
    
    // 介绍对话结束 -> 开始第一场战斗
    if (this.battleState === 'intro' && !this.introDialogueCompleted) {
      this.introDialogueCompleted = true;
      this.startBattle(0);
    }
    
    // 战斗对话结束 -> 生成敌人，进入战斗
    if (this.battleState === 'dialogue') {
      this.battleState = 'battle';
      this.spawnBattleEnemies(this.currentBattle);
      Logger.log(`Act5Scene: 第${this.currentBattle + 1}场战斗开始！`);
    }
  }

  /**
   * 更新战斗状态
   */
  updateBattleState() {
    if (this.battleState !== 'battle') return;
    
    // 检查是否所有敌人都被消灭
    const aliveEnemies = this.enemyEntities.filter(e => !e.isDead && !e.isDying);
    if (aliveEnemies.length === 0) {
      this.battleState = 'cleared';
      
      const battleNames = ['起义之战', '广宗之战', '阳城之战', '黄巾终战'];
      Logger.log(`Act5Scene: ${battleNames[this.currentBattle]} 胜利！`);
      
      // 显示胜利文字
      if (this.playerEntity) {
        const transform = this.playerEntity.getComponent('transform');
        if (transform) {
          this.floatingTextManager.addText(
            transform.position.x, transform.position.y - 80,
            `${battleNames[this.currentBattle]} 胜利！`, '#ffd700'
          );
        }
      }
    }
  }

  /**
   * 检查N键
   */
  checkNextKey() {
    if (!this.inputManager) return;
    
    const nPressed = this.inputManager.isKeyDown('n') || this.inputManager.isKeyDown('N');
    if (!nPressed) return;
    
    const now = Date.now();
    if (now - this._lastNextKeyTime < 1000) return;
    this._lastNextKeyTime = now;
    
    if (this.battleState === 'cleared') {
      if (this.currentBattle < this.totalBattles - 1) {
        // 还有下一场战斗
        this.startBattle(this.currentBattle + 1);
      } else {
        // 全部战斗完成，切换到第六幕
        this.isSceneComplete = true;
        this.battleState = 'complete';
        this.switchToNextScene();
      }
    }
  }

  /**
   * 渲染背景
   */
  renderBackground(ctx) {
    super.renderBackground(ctx);
  }

  /**
   * 渲染场景
   */
  render(ctx) {
    super.render(ctx);
    this.renderSceneTitle(ctx);
    this.renderBattleInfo(ctx);
    this.renderHints(ctx);
  }

  /**
   * 渲染场景标题
   */
  renderSceneTitle(ctx) {
    if (!this._titleStartTime) this._titleStartTime = performance.now();
    const elapsed = (performance.now() - this._titleStartTime) / 1000;
    if (elapsed > 5) return;
    
    let alpha = elapsed > 4 ? 1 - (elapsed - 4) : 1;
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * alpha})`;
    ctx.fillRect(0, 0, this.logicalWidth, 80);
    ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('第五幕：四场战斗', this.logicalWidth / 2, 50);
    ctx.restore();
  }

  /**
   * 渲染战斗信息
   */
  renderBattleInfo(ctx) {
    if (this.battleState !== 'battle' && this.battleState !== 'cleared') return;
    
    const battleNames = ['起义之战', '广宗之战', '阳城之战', '黄巾终战'];
    const battleName = battleNames[this.currentBattle] || '';
    const aliveEnemies = this.enemyEntities.filter(e => !e.isDead && !e.isDying).length;
    
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 90, 200, 80);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 90, 200, 80);
    
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(battleName, 20, 115);
    
    ctx.fillStyle = '#F44336';
    ctx.font = '16px Arial';
    ctx.fillText(`剩余敌人: ${aliveEnemies}`, 20, 140);
    
    ctx.fillStyle = '#CCCCCC';
    ctx.font = '14px Arial';
    ctx.fillText(`第 ${this.currentBattle + 1} / ${this.totalBattles} 场`, 20, 160);
    
    ctx.restore();
  }

  /**
   * 更新提示信息（使用教程提示面板）
   */
  updateHints() {
    if (this.dialogueSystem && this.dialogueSystem.isDialogueActive()) {
      this.hideHint();
    } else if (this.battleState === 'battle') {
      this.showHint('消灭所有敌人！');
    } else if (this.battleState === 'cleared') {
      if (this.currentBattle < this.totalBattles - 1) {
        this.showHint('战斗胜利！按<span class="key">N</span>键进入下一场战斗');
      } else {
        this.showHint('全部战斗完成！按<span class="key">N</span>键前往第六幕');
      }
    } else if (this.isSceneComplete) {
      this.showHint('第五幕完成！');
    } else {
      this.hideHint();
    }
  }

  /**
   * 渲染提示信息（已迁移到updateHints）
   */
  renderHints(ctx) {
    // 提示信息已通过 updateHints() 使用教程提示面板显示
  }

  /**
   * 退出场景
   */
  exit() {
    super.exit();
  }
}

export default Act5Scene;

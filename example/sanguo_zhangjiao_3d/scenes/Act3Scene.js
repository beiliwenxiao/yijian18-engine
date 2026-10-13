/**
 * Act3Scene - 第三幕：铜钱法器
 * 
 * 继承自 BaseGameScene，包含第三幕特有功能：
 * - 铜钱法器剧情
 * - 使用铜钱剑直接跳转第四幕
 * 
 * 需求：13, 14, 15, 16, 17, 18
 */

import { Logger } from '../../../src/core/Logger.js';
import { BaseGameScene } from './BaseGameScene.js';

export class Act3Scene extends BaseGameScene {
  constructor() {
    super(3, {
      title: '第三幕：铜钱法器',
      description: '张角传授铜钱法器，学习货币和交易系统'
    });

    // 第三幕特有：对话阶段
    this.dialoguePhase = 'coin_artifact';
    
    // 第三幕特有：对话完成标志
    this.coinArtifactDialogueCompleted = false;
    
    // 第三幕特有：物品获得标志
    this.hasReceivedCoinSword = false;
    
    // 第三幕特有：张角NPC
    this.zhangjiaoNPC = null;
    
    // 第三幕特有：场景完成标志
    this.isSceneComplete = false;
    
    // 第三幕特有：通知回调
    this.onNotification = null;
  }

  /**
   * 场景进入
   */
  enter(data = null) {
    // 调用父类的 enter，初始化所有基础系统
    super.enter(data);
    
    Logger.log('Act3Scene: 进入第三幕场景', data);
    
    // 重置玩家位置
    if (this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        transform.position.x = 300;
        transform.position.y = 350;
      }
    }
    
    // 清除前面幕次的敌人和物品
    this.enemyEntities = [];
    this.pickupItems = [];
    this.equipmentItems = [];
    
    // 初始化第三幕特有系统
    this.initializeAct3Systems();
    
    // 创建张角NPC
    this.createZhangjiaoNPC();
    
    // 开始铜钱法器对话
    this.startCoinArtifactDialogue();
  }


  /**
   * 初始化第三幕特有系统
   */
  initializeAct3Systems() {
    // 注册第三幕对话
    this.registerAct3Dialogues();
    
    // 注册第三幕教程
    this.registerAct3Tutorials();
    
    Logger.log('Act3Scene: 第三幕系统初始化完成');
  }

  /**
   * 注册第三幕对话
   */
  registerAct3Dialogues() {
    // 铜钱法器对话
    this.dialogueSystem.registerDialogue('coin_artifact', {
      title: '铜钱法器',
      startNode: 'start',
      nodes: {
        start: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '来，我给你一把铜钱剑。', 
          nextNode: 'player_question' 
        },
        player_question: { 
          speaker: '你', 
          portrait: 'player', 
          text: '铜钱剑？', 
          nextNode: 'zhangjiao_explain' 
        },
        zhangjiao_explain: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '官府不允许私人发钱，但铜钱剑就是法器，就合法了。', 
          nextNode: 'player_understand' 
        },
        player_understand: { 
          speaker: '你', 
          portrait: 'player', 
          text: '原来如此...又是一个巧妙的方法。', 
          nextNode: 'zhangjiao_gift' 
        },
        zhangjiao_gift: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '这把铜钱剑给你。使用它，即可前往下一幕。', 
          nextNode: null 
        }
      }
    });
  }

  /**
   * 注册第三幕教程
   */
  registerAct3Tutorials() {
    // 铜钱剑使用教程
    this.tutorialSystem.registerTutorial('coin_sword_use', {
      id: 'coin_sword_use',
      title: '铜钱剑',
      content: '打开背包，使用铜钱剑即可前往第四幕。',
      triggerCondition: () => this.hasReceivedCoinSword,
      completionCondition: () => this.isSceneComplete,
      pauseGame: false
    });
  }


  /**
   * 创建张角NPC
   */
  createZhangjiaoNPC() {
    this.zhangjiaoNPC = {
      id: 'zhangjiao',
      name: '张角',
      title: '太平道创始人',
      position: { x: 400, y: 300 }
    };
  }

  /**
   * 开始铜钱法器对话
   */
  startCoinArtifactDialogue() {
    this.dialoguePhase = 'coin_artifact';
    this.dialogueSystem.startDialogue('coin_artifact');
  }

  /**
   * 给予铜钱剑
   */
  giveCoinSword() {
    const coinSword = {
      id: 'coin_sword',
      name: '铜钱剑',
      type: 'consumable',
      subType: 'currency_item',
      rarity: 1,
      maxStack: 1,
      usable: true,
      description: '用铜钱串成的剑，使用后前往第四幕',
      effect: {
        type: 'next_scene'
      }
    };

    if (this.playerEntity) {
      const inventory = this.playerEntity.getComponent('inventory');
      if (inventory) {
        inventory.addItem(coinSword, 1);
      }
    }

    this.hasReceivedCoinSword = true;
    this.notify('得到 铜钱剑x1（使用可前往第四幕）', 'success');
  }

  /**
   * 设置通知回调
   */
  setNotificationCallback(callback) {
    this.onNotification = callback;
  }

  /**
   * 发送通知
   */
  notify(message, type = 'info') {
    Logger.log(`Act3Scene 通知: ${message}`);
    if (this.onNotification) {
      this.onNotification(message, type);
    }
  }

  /**
   * 物品使用回调 - 检测铜钱剑使用，触发跳转第四幕
   */
  onItemUsed(item, healAmount, manaAmount) {
    super.onItemUsed(item, healAmount, manaAmount);
    
    if (item && item.effect && item.effect.type === 'next_scene') {
      if (!this.isSceneComplete) {
        this.isSceneComplete = true;
        this.notify('使用铜钱剑，即将前往第四幕...', 'success');
        setTimeout(() => this.switchToNextScene(), 1500);
      }
    }
  }

  /**
   * 更新场景 - 覆盖父类方法，添加第三幕特有逻辑
   */
  update(deltaTime) {
    // 调用父类的 update
    super.update(deltaTime);
    
    // 第三幕特有：检查对话流程
    this.updateDialogueFlow();
    
    // 更新提示信息
    this.updateHints();
  }

  /**
   * 更新对话流程
   */
  updateDialogueFlow() {
    if (this.dialogueSystem && !this.dialogueSystem.isDialogueActive()) {
      // 铜钱法器对话结束 -> 给予铜钱剑
      if (this.dialoguePhase === 'coin_artifact' && !this.coinArtifactDialogueCompleted) {
        Logger.log('Act3Scene: 铜钱法器对话完成');
        this.coinArtifactDialogueCompleted = true;
        this.giveCoinSword();
      }
    }
  }

  /**
   * 切换到下一幕（第四幕）
   */
  switchToNextScene() {
    const stats = this.playerEntity?.getComponent('stats');
    const inventory = this.playerEntity?.getComponent('inventory');
    const equipment = this.playerEntity?.getComponent('equipment');
    
    const sceneData = {
      player: {
        name: this.playerEntity?.name || '玩家',
        class: this.playerEntity?.class || 'refugee',
        level: stats?.level || 3,
        hp: stats?.hp || 150,
        maxHp: stats?.maxHp || 150,
        mp: stats?.mp || 80,
        maxMp: stats?.maxMp || 80,
        attack: stats?.attack || 25,
        defense: stats?.defense || 15,
        inventory: inventory?.getAllItems() || [],
        equipment: equipment?.slots || {}
      },
      playerEntity: this.playerEntity,
      previousAct: 3
    };
    
    this.goToNextScene(sceneData);
  }

  /**
   * 渲染背景 - 覆盖父类方法
   */
  renderBackground(ctx) {
    // 调用父类渲染网格背景
    super.renderBackground(ctx);
  }


  /**
   * 渲染世界对象 - 覆盖父类方法，添加NPC渲染
   */
  renderWorldObjects(ctx) {
    super.renderWorldObjects(ctx);
    
    if (this.zhangjiaoNPC) {
      this.renderNPC(ctx, this.zhangjiaoNPC, '#4CAF50');
    }
  }

  /**
   * 渲染场景 - 覆盖父类方法，添加第三幕特有渲染
   */
  render(ctx) {
    super.render(ctx);
    this.renderSceneTitle(ctx);
    this.renderHints(ctx);
  }

  /**
   * 渲染场景标题
   */
  renderSceneTitle(ctx) {
    if (!this._titleStartTime) {
      this._titleStartTime = performance.now();
    }
    const elapsed = (performance.now() - this._titleStartTime) / 1000;
    if (elapsed > 5) return;
    
    let alpha = 1;
    if (elapsed > 4) alpha = 1 - (elapsed - 4);
    
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * alpha})`;
    ctx.fillRect(0, 0, this.logicalWidth, 80);
    ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('第三幕：铜钱法器', this.logicalWidth / 2, 50);
    ctx.restore();
  }

  /**
   * 渲染NPC - 人物图形
   */
  renderNPC(ctx, npc, color) {
    ctx.save();
    
    const x = npc.position.x;
    const y = npc.position.y;
    
    if (npc.id === 'zhangjiao') {
      this._renderZhangjiao(ctx, x, y);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.textAlign = 'center';
    ctx.font = '12px Arial';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(npc.title, x, y - 90);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(npc.name, x, y - 74);
    
    ctx.restore();
  }

  /** 绘制张角（道士） */
  _renderZhangjiao(ctx, x, y) {
    const s = 28;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.05, s * 0.5, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // 腿
    ctx.strokeStyle = '#d4a574'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - s*0.15, y - s*0.5); ctx.quadraticCurveTo(x - s*0.17, y - s*0.28, x - s*0.18, y - s*0.05); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s*0.15, y - s*0.5); ctx.quadraticCurveTo(x + s*0.17, y - s*0.28, x + s*0.18, y - s*0.05); ctx.stroke();
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath(); ctx.ellipse(x - s*0.18, y - s*0.02, s*0.09, s*0.05, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + s*0.18, y - s*0.02, s*0.09, s*0.05, 0, 0, Math.PI*2); ctx.fill();
    // 道袍
    const bg = ctx.createLinearGradient(x, y - s*1.15, x, y - s*0.45);
    bg.addColorStop(0, '#c8a84e'); bg.addColorStop(1, '#a08830');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(x - s*0.42, y - s*1.08); ctx.quadraticCurveTo(x - s*0.5, y - s*0.8, x - s*0.38, y - s*0.45);
    ctx.lineTo(x + s*0.38, y - s*0.45); ctx.quadraticCurveTo(x + s*0.5, y - s*0.8, x + s*0.42, y - s*1.08);
    ctx.closePath(); ctx.fill();
    // 腰带
    ctx.fillStyle = '#5a4a20'; ctx.fillRect(x - s*0.42, y - s*0.78, s*0.84, s*0.08);
    // 臂
    ctx.strokeStyle = '#d4a574'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - s*0.42, y - s*1.0); ctx.quadraticCurveTo(x - s*0.55, y - s*0.8, x - s*0.5, y - s*0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s*0.42, y - s*1.0); ctx.quadraticCurveTo(x + s*0.55, y - s*0.8, x + s*0.5, y - s*0.6); ctx.stroke();
    // 拂尘
    ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + s*0.5, y - s*0.6); ctx.lineTo(x + s*0.55, y - s*1.4); ctx.stroke();
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath(); ctx.moveTo(x + s*0.55, y - s*1.4);
      ctx.quadraticCurveTo(x + s*0.55 + (i-2)*2, y - s*1.25, x + s*0.55 + (i-2)*3, y - s*1.1); ctx.stroke();
    }
    // 头
    const headY = y - s*1.4;
    ctx.fillStyle = '#d4a574'; ctx.beginPath(); ctx.arc(x, headY, s*0.3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.arc(x, headY - s*0.06, s*0.28, Math.PI*0.8, Math.PI*2.2); ctx.fill();
    ctx.fillStyle = '#c8a84e'; ctx.beginPath(); ctx.ellipse(x, headY - s*0.35, s*0.08, s*0.12, 0, 0, Math.PI*2); ctx.fill();
    // 胡须
    ctx.strokeStyle = '#555'; ctx.lineWidth = 0.8;
    for (const dx of [-s*0.06, 0, s*0.06]) {
      ctx.beginPath(); ctx.moveTo(x + dx, headY + s*0.2); ctx.quadraticCurveTo(x + dx, headY + s*0.45, x + dx*0.8, headY + s*0.6); ctx.stroke();
    }
    // 眼
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x - s*0.11, headY + s*0.01, s*0.025, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + s*0.11, headY + s*0.01, s*0.025, 0, Math.PI*2); ctx.fill();
  }



  /**
   * 更新提示信息（使用教程提示面板）
   */
  updateHints() {
    if (this.dialogueSystem && this.dialogueSystem.isDialogueActive()) {
      this.hideHint();
    } else if (this.isSceneComplete) {
      this.showHint('第三幕完成！即将进入第四幕...');
    } else if (this.hasReceivedCoinSword) {
      this.showHint('打开背包（<span class="key">B</span>键），使用铜钱剑前往第四幕');
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

export default Act3Scene;

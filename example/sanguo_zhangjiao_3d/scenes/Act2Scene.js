/**
 * Act2Scene - 第二幕：符水救灾
 * 
 * 继承自 BaseGameScene，包含第二幕特有功能：
 * - 张角NPC和对话
 * - 符水剧情
 * - 装备升级
 * 
 * 需求：8, 9, 10, 11, 12
 */

import { Logger } from '../../../src/core/Logger.js';
import { BaseGameScene } from './BaseGameScene.js';
import { AttributeSystem } from '../../../src/systems/AttributeSystem.js';
import { SkillTreeSystem } from '../../../src/systems/SkillTreeSystem.js';

export class Act2Scene extends BaseGameScene {
  constructor() {
    super(2, {
      title: '第二幕：符水救灾',
      description: '你在张角的粥棚中醒来，了解符水的真相'
    });

    // 第二幕特有：对话阶段
    this.dialoguePhase = 'awakening';
    
    // 第二幕特有：对话完成标志
    this.awakeningDialogueCompleted = false;
    this.talismanWaterDialogueCompleted = false;
    this.equipmentUpgradeDialogueCompleted = false;
    
    // 第二幕特有：物品获得标志
    this.hasReceivedEquipment = false;
    
    // 第二幕特有：符水流程状态
    this.talismanWaterGiven = false;
    this.waitingForTalismanUse = false;
    this.talismanWaterUsed = false;
    
    // 第二幕特有：张角NPC
    this.zhangjiaoNPC = null;
    
    // 第二幕特有：场景完成标志
    this.isSceneComplete = false;
    
    // 第二幕特有：通知回调
    this.onNotification = null;
  }

  /**
   * 场景进入
   */
  enter(data = null) {
    // 调用父类的 enter，初始化所有基础系统
    // 父类会自动处理玩家实体的继承
    super.enter(data);
    
    Logger.log('Act2Scene: 进入第二幕场景', data);
    
    // 重置玩家位置
    if (this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        transform.position.x = 200;
        transform.position.y = 300;
      }
      
      // 设置玩家濒死状态（第二幕开始时生命值1点，魔法值1点）
      const stats = this.playerEntity.getComponent('stats');
      if (stats) {
        stats.hp = 1;
        stats.mp = 1;
        Logger.log('Act2Scene: 玩家处于濒死状态 - HP: 1, MP: 1');
      }
    }
    
    // 清除第一幕的敌人和物品
    this.enemyEntities = [];
    this.pickupItems = [];
    this.equipmentItems = [];
    
    // 重置第一幕的状态
    this.tutorialPhase = 'awakening';
    this.playerDied = false;
    this.isTransitioning = false;
    this.combatWave = 0;
    
    // 隐藏第一幕的火堆
    if (this.campfire) {
      this.campfire.lit = false;
      this.campfire.emitters = [];
    }
    
    // 初始化第二幕特有系统
    this.initializeAct2Systems();
    
    // 创建张角NPC
    this.createZhangjiaoNPC();
    
    // 开始觉醒对话
    this.startAwakeningDialogue();
  }

  /**
   * 初始化第二幕特有系统
   */
  initializeAct2Systems() {
    this.attributeSystem = new AttributeSystem();
    this.skillTreeSystem = new SkillTreeSystem();
    this.registerAct2Dialogues();
    this.registerAct2Tutorials();
    Logger.log('Act2Scene: 第二幕系统初始化完成');
  }

  /**
   * 注册第二幕对话
   */
  registerAct2Dialogues() {
    // 觉醒对话
    this.dialogueSystem.registerDialogue('awakening', {
      title: '觉醒',
      startNode: 'start',
      nodes: {
        start: { speaker: '张角', portrait: 'zhangjiao', text: '你醒了。你在荒野中昏倒了，我们把你救了回来。', nextNode: 'player_response' },
        player_response: { speaker: '你', portrait: 'player', text: '这里是...？', nextNode: 'zhangjiao_explain' },
        zhangjiao_explain: { speaker: '张角', portrait: 'zhangjiao', text: '这里是我们的粥棚。乱世之中，百姓流离失所，我们在这里施粥救济灾民。', nextNode: 'player_thanks' },
        player_thanks: { speaker: '你', portrait: 'player', text: '多谢救命之恩。', nextNode: 'zhangjiao_invite' },
        zhangjiao_invite: { speaker: '张角', portrait: 'zhangjiao', text: '不必客气。如果你愿意，可以留下来帮忙。这乱世，需要更多有志之士。', nextNode: null }
      }
    });

    // 符水对话
    this.dialogueSystem.registerDialogue('talisman_water', {
      title: '符水的真相',
      startNode: 'start',
      nodes: {
        start: { speaker: '张角', portrait: 'zhangjiao', text: '来，喝碗符水吧。', nextNode: 'player_question' },
        player_question: { speaker: '你', portrait: 'player', text: '符水？', nextNode: 'zhangjiao_explain' },
        zhangjiao_explain: { speaker: '张角', portrait: 'zhangjiao', text: '官府不允许私人施粥，但如果说这是"仙家符水"，就合法了。', nextNode: 'player_understand' },
        player_understand: { speaker: '你', portrait: 'player', text: '原来如此...这是智慧啊。', nextNode: 'zhangjiao_smile' },
        zhangjiao_smile: { speaker: '张角', portrait: 'zhangjiao', text: '乱世求生，需要智慧。来，喝吧，这符水能恢复你的体力。', nextNode: null }
      }
    });

    // 装备升级对话
    this.dialogueSystem.registerDialogue('equipment_upgrade', {
      title: '装备升级',
      startNode: 'start',
      nodes: {
        start: { speaker: '张角', portrait: 'zhangjiao', text: '你需要更好的装备来保护自己。这些给你。', nextNode: 'player_receive' },
        player_receive: { speaker: '你', portrait: 'player', text: '这些装备...太好了！', nextNode: 'zhangjiao_advice' },
        zhangjiao_advice: { speaker: '张角', portrait: 'zhangjiao', text: '装备只是外物，真正的力量来自于你自己。', nextNode: null }
      }
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
    
    // 粥棚场景装饰（棚子已移除）
    
    // 大锅位置
    this.cauldron = { x: 340, y: 260 };
    
    // 熬粥NPC
    this.cookNPC = {
      name: '粥棚伙夫',
      position: { x: 300, y: 275 }
    };
    
    // 灾民（坐着/躺着）
    this.refugees = [
      { x: 180, y: 370, pose: 'sitting', facing: 'right' },
      { x: 210, y: 395, pose: 'lying', facing: 'right' },
      { x: 570, y: 240, pose: 'sitting', facing: 'left' },
      { x: 610, y: 260, pose: 'sitting', facing: 'right' },
      { x: 540, y: 290, pose: 'lying', facing: 'left' },
      { x: 260, y: 210, pose: 'sitting', facing: 'right' }
    ];
  }

  /**
   * 开始觉醒对话
   */
  startAwakeningDialogue() {
    this.dialoguePhase = 'awakening';
    this.dialogueSystem.startDialogue('awakening');
  }

  /**
   * 开始符水对话
   */
  startTalismanWaterDialogue() {
    this.dialoguePhase = 'talisman_water';
    this.dialogueSystem.startDialogue('talisman_water');
  }

  /**
   * 开始装备升级对话
   */
  startEquipmentUpgradeDialogue() {
    this.dialoguePhase = 'upgrade';
    this.dialogueSystem.startDialogue('equipment_upgrade');
  }

  /**
   * 给予符水物品
   */
  giveTalismanWater() {
    let talismanWater;
    
    if (this.actData && this.actData.rewards && this.actData.rewards.talisman_water) {
      talismanWater = { ...this.actData.rewards.talisman_water };
    } else {
      // fallback
      talismanWater = {
        id: 'talisman_water',
        name: '符水',
        type: 'consumable',
        usable: true,
        maxStack: 10,
        rarity: 1,
        description: '张角的符水，可以恢复50点生命值',
        effect: { type: 'heal', value: 50 }
      };
    }

    if (this.playerEntity) {
      const inventory = this.playerEntity.getComponent('inventory');
      if (inventory) {
        inventory.addItem(talismanWater, 1);
      }
    }

    this.talismanWaterGiven = true;
    this.waitingForTalismanUse = true;
    this.notify(`得到 ${talismanWater.name}x1`, 'success');
  }

  /**
   * 给予新装备（从 ActData.json 读取）
   */
  giveNewEquipment() {
    let equipmentList;
    
    if (this.actData && this.actData.rewards && this.actData.rewards.equipment) {
      equipmentList = this.actData.rewards.equipment.map(e => ({ ...e }));
    } else {
      // fallback
      equipmentList = [
        { id: 'cloth_armor', name: '布衣', type: 'equipment', subType: 'armor', rarity: 0, maxStack: 1, stats: { defense: 5, maxHp: 20 } },
        { id: 'wooden_sword', name: '木剑', type: 'equipment', subType: 'weapon', rarity: 0, maxStack: 1, attackSpeed: 3, stats: { attack: 10 } }
      ];
    }

    if (this.playerEntity) {
      const inventory = this.playerEntity.getComponent('inventory');
      if (inventory) {
        for (const equip of equipmentList) {
          inventory.addItem(equip, 1);
        }
      }
    }
    
    this.hasReceivedEquipment = true;
    equipmentList.forEach((equip, index) => {
      setTimeout(() => this.notify(`得到 ${equip.name}x1`, 'success'), index * 500);
    });
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
    Logger.log(`Act2Scene 通知: ${message}`);
    if (this.onNotification) {
      this.onNotification(message, type);
    }
  }


  /**
   * 更新场景 - 覆盖父类方法，添加第二幕特有逻辑
   */
  update(deltaTime) {
    // 调用父类的 update
    super.update(deltaTime);
    
    // 第二幕特有：检查对话流程
    this.updateDialogueFlow();
    
    // 更新提示信息（使用教程提示面板）
    this.updateHints();
  }

  /**
   * 更新对话流程
   */
  updateDialogueFlow() {
    if (this.dialogueSystem && !this.dialogueSystem.isDialogueActive()) {
      // 觉醒对话结束 -> 符水对话
      if (this.dialoguePhase === 'awakening' && !this.awakeningDialogueCompleted) {
        this.awakeningDialogueCompleted = true;
        setTimeout(() => this.startTalismanWaterDialogue(), 1000);
      }
      // 符水对话结束 -> 给予符水
      else if (this.dialoguePhase === 'talisman_water' && !this.talismanWaterDialogueCompleted) {
        this.talismanWaterDialogueCompleted = true;
        this.giveTalismanWater();
      }
      // 符水已使用 -> 装备升级对话
      else if (this.talismanWaterUsed && !this.equipmentUpgradeDialogueCompleted) {
        this.equipmentUpgradeDialogueCompleted = true;
        setTimeout(() => this.startEquipmentUpgradeDialogue(), 1000);
      }
      // 装备升级对话结束 -> 给予装备，等待玩家装备
      else if (this.dialoguePhase === 'upgrade' && this.equipmentUpgradeDialogueCompleted && !this.hasReceivedEquipment) {
        this.giveNewEquipment();
        this.waitingForEquip = true;
      }
      // 玩家已装备两件物品 -> 切换到第三幕
      else if (this.waitingForEquip && !this.isSceneComplete && this.checkEquipmentDone()) {
        this.isSceneComplete = true;
        this.notify('装备完成！即将进入第三幕...', 'success');
        setTimeout(() => {
          this.transitionToAct3();
        }, 2000);
      }
    }
  }

  /**
   * 检查玩家是否已装备腰带和鞋子
   * @returns {boolean}
   */
  checkEquipmentDone() {
    if (!this.playerEntity) return false;
    const equipment = this.playerEntity.getComponent('equipment');
    if (!equipment) return false;
    
    const hasBelt = equipment.getEquipment('belt') !== null;
    const hasBoots = equipment.getEquipment('boots') !== null;
    return hasBelt && hasBoots;
  }

  /**
   * 切换到第三幕
   */
  transitionToAct3() {
    Logger.log('Act2Scene: 切换到第三幕');
    
    // 通过 SceneManager 切换场景
    if (this.sceneManager) {
      // 直接传递玩家实体，让BaseGameScene继承
      this.sceneManager.switchTo('Act3Scene', {
        playerEntity: this.playerEntity,
        previousAct: 2
      });
    } else {
      console.error('Act2Scene: SceneManager 未设置，无法切换场景');
    }
  }

  /**
   * 物品使用回调 - 覆盖父类方法，检测符水使用
   */
  onItemUsed(item, healAmount, manaAmount) {
    super.onItemUsed(item, healAmount, manaAmount);
    
    // 检测符水使用
    if (item && item.id === 'talisman_water' && this.waitingForTalismanUse) {
      this.waitingForTalismanUse = false;
      this.talismanWaterUsed = true;
      this.notify(`恢复了 ${healAmount} 点生命值`, 'success');
    }
  }

  /**
   * 渲染背景 - 覆盖父类方法，渲染粥棚背景
   */
  renderBackground(ctx) {
    // 调用父类渲染网格背景
    super.renderBackground(ctx);
  }

  /**
   * 渲染场景 - 覆盖父类方法，添加第二幕特有渲染
   */
  render(ctx) {
    // 调用父类的 render
    super.render(ctx);
    
    // 渲染场景标题（UI层，在对话框之后）
    this.renderSceneTitle(ctx);
    
    // 渲染提示信息（UI层）
    this.renderHints(ctx);
  }

  /**
   * 渲染世界对象 - 覆盖父类方法，添加NPC渲染
   */
  renderWorldObjects(ctx) {
    // 渲染大锅
    if (this.cauldron) {
      this.renderCauldron(ctx, this.cauldron);
    }
    
    // 渲染灾民
    if (this.refugees) {
      for (const ref of this.refugees) {
        this.renderRefugee(ctx, ref);
      }
    }
    
    // 渲染熬粥NPC
    if (this.cookNPC) {
      this.renderCookNPC(ctx, this.cookNPC);
    }
    
    // 调用父类的渲染（渲染实体）
    super.renderWorldObjects(ctx);
    
    // 渲染张角NPC（在相机变换内）
    if (this.zhangjiaoNPC) {
      this.renderNPC(ctx, this.zhangjiaoNPC);
    }
  }

  /**
   * 渲染场景标题
   */
  renderSceneTitle(ctx) {
    // 标题显示5秒后消失
    if (!this._titleStartTime) {
      this._titleStartTime = performance.now();
    }
    const elapsed = (performance.now() - this._titleStartTime) / 1000;
    if (elapsed > 5) return;
    
    // 最后1秒淡出
    let alpha = 1;
    if (elapsed > 4) {
      alpha = 1 - (elapsed - 4);
    }
    
    ctx.save();
    
    ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * alpha})`;
    ctx.fillRect(0, 0, this.logicalWidth, 80);
    
    ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('第二幕：符水救灾', this.logicalWidth / 2, 50);
    
    ctx.restore();
  }

  /**
   * 渲染NPC
   */
  renderNPC(ctx, npc) {
    ctx.save();
    
    const x = npc.position.x;
    const y = npc.position.y;
    const s = 40; // 缩放基准（主角约64px，张角两倍高）
    
    // 地面阴影
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.05, s * 0.5, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 左腿
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.15, y - s * 0.5);
    ctx.quadraticCurveTo(x - s * 0.17, y - s * 0.28, x - s * 0.18, y - s * 0.05);
    ctx.stroke();
    // 鞋
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.18, y - s * 0.02, s * 0.09, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 右腿
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.15, y - s * 0.5);
    ctx.quadraticCurveTo(x + s * 0.17, y - s * 0.28, x + s * 0.18, y - s * 0.05);
    ctx.stroke();
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(x + s * 0.18, y - s * 0.02, s * 0.09, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 道袍身体（黄色道袍）
    const bodyGrad = ctx.createLinearGradient(x, y - s * 1.15, x, y - s * 0.45);
    bodyGrad.addColorStop(0, '#c8a84e');
    bodyGrad.addColorStop(0.5, '#b89840');
    bodyGrad.addColorStop(1, '#a08830');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.42, y - s * 1.08);
    ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.8, x - s * 0.38, y - s * 0.45);
    ctx.lineTo(x + s * 0.38, y - s * 0.45);
    ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.8, x + s * 0.42, y - s * 1.08);
    ctx.closePath();
    ctx.fill();
    
    // 道袍中线
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.05);
    ctx.lineTo(x, y - s * 0.45);
    ctx.stroke();
    
    // 腰带（深色）
    ctx.fillStyle = '#5a4a20';
    ctx.fillRect(x - s * 0.42, y - s * 0.78, s * 0.84, s * 0.08);
    
    // 左臂
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.42, y - s * 1.0);
    ctx.quadraticCurveTo(x - s * 0.55, y - s * 0.8, x - s * 0.5, y - s * 0.6);
    ctx.stroke();
    // 袖子
    ctx.strokeStyle = '#b89840';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.42, y - s * 1.0);
    ctx.lineTo(x - s * 0.48, y - s * 0.9);
    ctx.stroke();
    // 手
    ctx.fillStyle = '#d4a574';
    ctx.beginPath();
    ctx.arc(x - s * 0.5, y - s * 0.6, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
    
    // 右臂（持拂尘）
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.42, y - s * 1.0);
    ctx.quadraticCurveTo(x + s * 0.55, y - s * 0.8, x + s * 0.5, y - s * 0.6);
    ctx.stroke();
    ctx.strokeStyle = '#b89840';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.42, y - s * 1.0);
    ctx.lineTo(x + s * 0.48, y - s * 0.9);
    ctx.stroke();
    ctx.fillStyle = '#d4a574';
    ctx.beginPath();
    ctx.arc(x + s * 0.5, y - s * 0.6, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
    
    // 拂尘（右手持）
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y - s * 0.6);
    ctx.lineTo(x + s * 0.55, y - s * 1.4);
    ctx.stroke();
    // 拂尘毛
    ctx.strokeStyle = '#e8e0d0';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.55, y - s * 1.4);
      ctx.quadraticCurveTo(
        x + s * 0.55 + (i - 2) * 3, y - s * 1.25,
        x + s * 0.55 + (i - 2) * 4, y - s * 1.1
      );
      ctx.stroke();
    }
    
    // 脖子
    ctx.fillStyle = '#d4a574';
    ctx.fillRect(x - s * 0.07, y - s * 1.16, s * 0.14, s * 0.1);
    
    // 头部
    const headY = y - s * 1.4;
    const headGrad = ctx.createRadialGradient(x - s * 0.04, headY - s * 0.04, 0, x, headY, s * 0.32);
    headGrad.addColorStop(0, '#f5d4a8');
    headGrad.addColorStop(1, '#d4a574');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(x, headY, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    
    // 道士发髻
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(x, headY - s * 0.06, s * 0.28, Math.PI * 0.8, Math.PI * 2.2);
    ctx.fill();
    // 发髻顶部（道冠）
    ctx.fillStyle = '#c8a84e';
    ctx.beginPath();
    ctx.ellipse(x, headY - s * 0.35, s * 0.08, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // 胡须（长须）
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.06, headY + s * 0.2);
    ctx.quadraticCurveTo(x - s * 0.08, headY + s * 0.45, x - s * 0.05, headY + s * 0.6);
    ctx.moveTo(x, headY + s * 0.22);
    ctx.quadraticCurveTo(x, headY + s * 0.45, x + s * 0.02, headY + s * 0.65);
    ctx.moveTo(x + s * 0.06, headY + s * 0.2);
    ctx.quadraticCurveTo(x + s * 0.08, headY + s * 0.45, x + s * 0.05, headY + s * 0.6);
    ctx.stroke();
    
    // 眉毛
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.16, headY - s * 0.06);
    ctx.lineTo(x - s * 0.07, headY - s * 0.08);
    ctx.moveTo(x + s * 0.07, headY - s * 0.08);
    ctx.lineTo(x + s * 0.16, headY - s * 0.06);
    ctx.stroke();
    
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.11, headY + s * 0.01, s * 0.04, s * 0.03, 0, 0, Math.PI * 2);
    ctx.ellipse(x + s * 0.11, headY + s * 0.01, s * 0.04, s * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(x - s * 0.11, headY + s * 0.01, s * 0.025, 0, Math.PI * 2);
    ctx.arc(x + s * 0.11, headY + s * 0.01, s * 0.025, 0, Math.PI * 2);
    ctx.fill();
    
    // 嘴巴
    ctx.strokeStyle = '#a07050';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, headY + s * 0.15, s * 0.04, 0.2, Math.PI - 0.2);
    ctx.stroke();
    
    // 绘制NPC称号
    ctx.font = '12px Arial';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(npc.title, x, y - s * 2.15);
    
    // 绘制NPC名称
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(npc.name, x, y - s * 1.9);
    
    ctx.restore();
  }

  /**
   * 渲染棚子
   */
  renderShelter(ctx, shelter) {
    const { x, y, width, height } = shelter;
    ctx.save();
    
    // 四根柱子
    const pillarW = 10, pillarH = 90;
    ctx.fillStyle = '#6b4226';
    const corners = [
      [x - width/2 + 10, y + height/2],
      [x + width/2 - 10, y + height/2],
      [x - width/2 + 10, y - height/2],
      [x + width/2 - 10, y - height/2]
    ];
    for (const [px, py] of corners) {
      ctx.fillRect(px - pillarW/2, py - pillarH, pillarW, pillarH);
    }
    
    // 棚顶（茅草）
    const roofY = y - pillarH + height/2 - 5;
    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    ctx.moveTo(x - width/2 - 15, roofY + 12);
    ctx.lineTo(x, roofY - 20);
    ctx.lineTo(x + width/2 + 15, roofY + 12);
    ctx.closePath();
    ctx.fill();
    
    // 茅草纹理
    ctx.strokeStyle = '#6b5a3a';
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * (width/9), roofY - 18 + Math.abs(i) * 3);
      ctx.lineTo(x + i * (width/6) - 6, roofY + 12);
      ctx.stroke();
    }
    
    // 棚顶底边（横梁）
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - width/2 - 12, roofY + 12);
    ctx.lineTo(x + width/2 + 12, roofY + 12);
    ctx.stroke();
    
    ctx.restore();
  }

  /**
   * 渲染大锅
   */
  renderCauldron(ctx, pos) {
    const { x, y } = pos;
    ctx.save();
    
    // 锅底火焰
    const time = performance.now() / 200;
    ctx.fillStyle = '#ff6600';
    for (let i = 0; i < 7; i++) {
      const fx = x - 18 + i * 6;
      const fh = 10 + Math.sin(time + i * 1.3) * 6;
      ctx.globalAlpha = 0.6 + Math.sin(time + i) * 0.3;
      ctx.beginPath();
      ctx.ellipse(fx, y + 20, 4, fh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    
    // 柴火
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 30, y + 26); ctx.lineTo(x + 20, y + 22);
    ctx.moveTo(x - 20, y + 30); ctx.lineTo(x + 30, y + 24);
    ctx.moveTo(x - 12, y + 22); ctx.lineTo(x + 10, y + 32);
    ctx.stroke();
    
    // 锅身（椭圆）
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, 36, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // 锅口（椭圆，浅色表示粥）
    ctx.fillStyle = '#d4c8a0';
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 30, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 粥面气泡
    ctx.fillStyle = '#e8dcc0';
    for (let i = 0; i < 4; i++) {
      const bx = x - 12 + i * 8 + Math.sin(time * 0.7 + i * 2) * 4;
      const by = y - 9 + Math.sin(time + i) * 2;
      ctx.beginPath();
      ctx.arc(bx, by, 3 + Math.sin(time + i) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // 蒸汽
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const sx = x - 10 + i * 7;
      const sOffset = Math.sin(time * 0.5 + i * 1.5) * 6;
      ctx.beginPath();
      ctx.moveTo(sx, y - 16);
      ctx.quadraticCurveTo(sx + sOffset, y - 35, sx - sOffset, y - 55);
      ctx.stroke();
    }
    
    // 锅边高光
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 30, 13, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    
    ctx.restore();
  }

  /**
   * 渲染熬粥NPC
   */
  renderCookNPC(ctx, npc) {
    const { x, y } = npc.position;
    const s = 30;
    ctx.save();
    
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.05, s * 0.4, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 腿
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s*0.12, y - s*0.4);
    ctx.lineTo(x - s*0.15, y - s*0.05);
    ctx.moveTo(x + s*0.12, y - s*0.4);
    ctx.lineTo(x + s*0.15, y - s*0.05);
    ctx.stroke();
    
    // 身体
    ctx.fillStyle = '#787878';
    ctx.beginPath();
    ctx.moveTo(x - s*0.35, y - s*0.95);
    ctx.quadraticCurveTo(x - s*0.4, y - s*0.65, x - s*0.3, y - s*0.4);
    ctx.lineTo(x + s*0.3, y - s*0.4);
    ctx.quadraticCurveTo(x + s*0.4, y - s*0.65, x + s*0.35, y - s*0.95);
    ctx.closePath();
    ctx.fill();
    
    // 围裙
    ctx.fillStyle = '#a09080';
    ctx.fillRect(x - s*0.25, y - s*0.7, s*0.5, s*0.3);
    
    // 手臂（伸向锅的方向）
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + s*0.35, y - s*0.85);
    ctx.quadraticCurveTo(x + s*0.6, y - s*0.7, x + s*0.55, y - s*0.5);
    ctx.stroke();
    // 勺子
    ctx.strokeStyle = '#6b4226';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + s*0.55, y - s*0.5);
    ctx.lineTo(x + s*0.7, y - s*0.2);
    ctx.stroke();
    ctx.fillStyle = '#6b4226';
    ctx.beginPath();
    ctx.ellipse(x + s*0.7, y - s*0.15, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 左臂
    ctx.strokeStyle = '#d4a574';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - s*0.35, y - s*0.85);
    ctx.quadraticCurveTo(x - s*0.5, y - s*0.65, x - s*0.4, y - s*0.5);
    ctx.stroke();
    
    // 脖子+头
    ctx.fillStyle = '#d4a574';
    ctx.fillRect(x - s*0.06, y - s*1.05, s*0.12, s*0.1);
    ctx.beginPath();
    ctx.arc(x, y - s*1.25, s*0.22, 0, Math.PI * 2);
    ctx.fill();
    
    // 头巾
    ctx.fillStyle = '#a09080';
    ctx.beginPath();
    ctx.arc(x, y - s*1.3, s*0.2, Math.PI * 0.85, Math.PI * 2.15);
    ctx.fill();
    
    // 眼睛
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(x - s*0.08, y - s*1.24, 1.5, 0, Math.PI * 2);
    ctx.arc(x + s*0.08, y - s*1.24, 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // 名字
    ctx.fillStyle = '#cccccc';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(npc.name, x, y - s*1.55);
    
    ctx.restore();
  }

  /**
   * 渲染灾民（使用饥民精灵图）
   */
  renderRefugee(ctx, ref) {
    const { x, y, pose, facing } = ref;
    
    // 获取饥民精灵图
    const spriteSheet = this.assetManager ? this.assetManager.getAsset('enemy_animated_starving') : null;
    
    if (spriteSheet) {
      const cols = 4, rows = 8;
      const cellW = spriteSheet.width / cols;
      const cellH = spriteSheet.height / rows;
      const destSize = 64; // 和主角一样大
      
      if (pose === 'lying') {
        // 躺姿：取静止帧，旋转90度
        // 朝右用行5（右），朝左用行4（左）
        const row = facing === 'left' ? 4 : 5;
        const col = 0; // 静止帧
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 2); // 旋转90度变成躺着
        ctx.drawImage(
          spriteSheet,
          col * cellW, row * cellH, cellW, cellH,
          -destSize/2, -destSize, destSize, destSize
        );
        ctx.restore();
      } else {
        // 坐姿：取静止帧，只画上半身（裁剪下半部分）
        // 朝右用行5（右），朝左用行4（左）
        const row = facing === 'left' ? 4 : 5;
        const col = 0; // 静止帧
        
        ctx.save();
        // 画完整精灵但位置下移，模拟坐着
        ctx.drawImage(
          spriteSheet,
          col * cellW, row * cellH, cellW, cellH,
          x - destSize/2, y - destSize * 0.6, destSize, destSize
        );
        ctx.restore();
      }
    } else {
      // 降级：简单矩形
      ctx.save();
      ctx.fillStyle = '#696969';
      ctx.fillRect(x - 12, y - 24, 24, 24);
      ctx.restore();
    }
  }

  /**
   * 更新提示信息（使用教程提示面板）
   */
  updateHints() {
    if (this.dialogueSystem && this.dialogueSystem.isDialogueActive()) {
      this.hideHint();
    } else if (this.waitingForTalismanUse) {
      this.showHint('按<span class="key">B</span>键打开背包，使用符水');
    } else if (this.waitingForEquip && !this.isSceneComplete) {
      this.showHint('按<span class="key">B</span>键打开背包，装备腰带和草鞋后继续');
    } else if (this.isSceneComplete) {
      this.showHint('第二幕完成！即将进入第三幕...');
    } else {
      this.hideHint();
    }
  }

  /**
   * 渲染提示信息（已迁移到updateHints，使用教程提示面板）
   */
  renderHints(ctx) {
    // 提示信息已通过 updateHints() 使用教程提示面板显示
  }

  /**
   * 注册第二幕教程（占位方法）
   */
  registerAct2Tutorials() {
    // 第二幕暂无特殊教程
    Logger.log('Act2Scene: 第二幕教程注册完成');
  }
}

export default Act2Scene;
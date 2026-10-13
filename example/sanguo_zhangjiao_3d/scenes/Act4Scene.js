/**
 * Act4Scene - 第四幕：职业选择
 * 
 * 继承自 BaseGameScene，包含第四幕特有功能：
 * - 职业选择界面
 * - 三位教官 NPC 系统（张梁、张宝、张角）
 * - 集成 SkillTreeSystem（职业技能树）
 * - 集成 UnitSystem（兵种特化）
 * - 集成 AttributeSystem（天赋树）
 * 
 * 需求：19, 20, 21, 22, 23
 */

import { Logger } from '../../../src/core/Logger.js';
import { BaseGameScene } from './BaseGameScene.js';
import { ClassSystem, ClassType, ClassNames } from '../../../src/systems/ClassSystem.js';
import { SkillTreePanel } from '../../../src/ui/SkillTreePanel.js';
import { UnitInfoPanel } from '../../../src/ui/UnitInfoPanel.js';
import { AttributePanel } from '../../../src/ui/AttributePanel.js';

export class Act4Scene extends BaseGameScene {
  constructor() {
    super(4, {
      title: '第四幕：职业选择',
      description: '选择你的职业，开启新的征程'
    });

    // 第四幕特有：职业系统
    this.classSystem = null;
    
    // 第四幕特有：UI面板
    this.skillTreePanel = null;
    this.unitInfoPanel = null;
    this.attributePanel = null;
    
    // 第四幕特有：教官NPCs
    this.instructors = [];
    
    // 第四幕特有：职业选择状态
    this.classSelected = false;
    this.selectedClass = null;
    this.hoveredInstructor = null;
    this.pendingClassType = null;  // 待选择的职业类型
    this.showClassConfirmation = false;  // 是否显示职业确认窗口
    this.confirmButtonHovered = false;  // 确定按钮悬停
    this.cancelButtonHovered = false;   // 取消按钮悬停
    
    // 第四幕特有：兵种选择状态（战士专用）
    this.showUnitSelection = false;  // 是否显示兵种选择窗口
    this.selectedUnitType = null;  // 选择的兵种类型
    this.shieldSoldierButtonHovered = false;  // 刀盾兵按钮悬停
    this.spearmanButtonHovered = false;  // 长枪兵按钮悬停
    
    // 第四幕特有：对话阶段
    this.dialoguePhase = 'intro';
    
    // 第四幕特有：对话完成标志
    this.introDialogueCompleted = false;
    this.classSelectionDialogueCompleted = false;
    
    // 第四幕特有：场景完成标志
    this.isSceneComplete = false;
    
    // 第四幕特有：通知回调
    this.onNotification = null;
    
    // 第四幕特有：快捷键切换时间戳
    this.lastSkillTreeToggleTime = 0;
    this.lastAttributeToggleTime = 0;
    this.lastUnitInfoToggleTime = 0;
  }

  /**
   * 场景进入
   */
  enter(data = null) {
    // 调用父类的 enter，初始化所有基础系统
    super.enter(data);
    
    Logger.log('Act4Scene: 进入第四幕场景', data);
    
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
    
    // 初始化第四幕特有系统
    this.initializeAct4Systems();
    
    // 创建教官NPCs
    this.createInstructors();
    
    // 开始介绍对话
    this.startIntroDialogue();
  }

  /**
   * 初始化第四幕特有系统
   */
  initializeAct4Systems() {
    // 初始化职业系统
    this.classSystem = new ClassSystem();
    
    // 初始化技能树面板
    this.skillTreePanel = new SkillTreePanel({
      x: 50,
      y: 50,
      width: 700,
      height: 500,
      skillTreeSystem: this.classSystem.skillTreeSystem,
      character: this.getPlayerCharacterData()
    });
    
    // 初始化兵种信息面板
    this.unitInfoPanel = new UnitInfoPanel();
    this.unitInfoPanel.setPosition(this.logicalWidth - 320, 100);
    
    // 初始化属性面板（HTML面板）
    const container = document.body;
    this.attributePanel = new AttributePanel(container, this.classSystem.attributeSystem);
    
    // 注册UI元素
    this.uiClickHandler.registerElement(this.skillTreePanel);
    
    // 注册第四幕对话
    this.registerAct4Dialogues();
    
    // 注册第四幕教程
    this.registerAct4Tutorials();
    
    Logger.log('Act4Scene: 第四幕系统初始化完成');
  }

  /**
   * 获取玩家角色数据（用于技能树系统）
   */
  getPlayerCharacterData() {
    if (!this.playerEntity) return null;
    
    const stats = this.playerEntity.getComponent('stats');
    const name = this.playerEntity.getComponent('name');
    
    return {
      id: 'player',
      name: name ? name.name : '玩家',
      class: this.selectedClass || 'warrior',
      level: stats ? stats.level : 1,
      skillPoints: stats ? stats.skillPoints : 5
    };
  }

  /**
   * 注册第四幕对话
   */
  registerAct4Dialogues() {
    // 介绍对话
    this.dialogueSystem.registerDialogue('intro', {
      title: '职业选择',
      startNode: 'start',
      nodes: {
        start: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '你已经掌握了基本的生存技能。现在，是时候选择你的道路了。', 
          nextNode: 'player_question' 
        },
        player_question: { 
          speaker: '你', 
          portrait: 'player', 
          text: '我该如何选择？', 
          nextNode: 'zhangjiao_explain' 
        },
        zhangjiao_explain: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '我和我的两位兄弟，各自精通不同的战斗之道。你可以向我们学习。', 
          nextNode: 'zhangjiao_introduce' 
        },
        zhangjiao_introduce: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '张梁精通近战，张宝擅长远程，而我则掌握法术之道。选择适合你的职业吧。', 
          nextNode: null 
        }
      }
    });

    // 战士职业对话
    this.dialogueSystem.registerDialogue('warrior_intro', {
      title: '战士之道',
      startNode: 'start',
      nodes: {
        start: { 
          speaker: '张梁', 
          portrait: 'zhangliang', 
          text: '你想学习战士之道？很好！战士是战场上的铁壁，拥有强大的生命值和防御力。', 
          nextNode: 'player_interest' 
        },
        player_interest: { 
          speaker: '你', 
          portrait: 'player', 
          text: '请教我战士的技能。', 
          nextNode: 'zhangliang_teach' 
        },
        zhangliang_teach: { 
          speaker: '张梁', 
          portrait: 'zhangliang', 
          text: '战士可以选择成为重甲步兵或狂战士。重甲步兵专注防御，狂战士专注攻击。', 
          nextNode: null 
        }
      }
    });

    // 弓箭手职业对话
    this.dialogueSystem.registerDialogue('archer_intro', {
      title: '弓箭手之道',
      startNode: 'start',
      nodes: {
        start: { 
          speaker: '张宝', 
          portrait: 'zhangbao', 
          text: '你想学习弓箭手之道？明智的选择！弓箭手拥有高攻击力和敏捷，擅长风筝和爆发。', 
          nextNode: 'player_interest' 
        },
        player_interest: { 
          speaker: '你', 
          portrait: 'player', 
          text: '请教我弓箭手的技能。', 
          nextNode: 'zhangbao_teach' 
        },
        zhangbao_teach: { 
          speaker: '张宝', 
          portrait: 'zhangbao', 
          text: '弓箭手可以选择成为弓骑兵或连弩步兵。弓骑兵机动性强，连弩步兵爆发伤害高。', 
          nextNode: null 
        }
      }
    });

    // 法师职业对话
    this.dialogueSystem.registerDialogue('mage_intro', {
      title: '法师之道',
      startNode: 'start',
      nodes: {
        start: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '你想学习法师之道？法师拥有强大的法术伤害和控制能力，但生命值较低。', 
          nextNode: 'player_interest' 
        },
        player_interest: { 
          speaker: '你', 
          portrait: 'player', 
          text: '请教我法师的技能。', 
          nextNode: 'zhangjiao_teach' 
        },
        zhangjiao_teach: { 
          speaker: '张角', 
          portrait: 'zhangjiao', 
          text: '法师可以选择火系或冰系。火系专注爆发伤害，冰系专注控制和持续伤害。', 
          nextNode: null 
        }
      }
    });
  }

  /**
   * 注册第四幕教程
   */
  registerAct4Tutorials() {
    // 职业选择教程
    this.tutorialSystem.registerTutorial('class_selection', {
      id: 'class_selection',
      title: '职业选择',
      content: '点击教官NPC选择你的职业。每个职业都有独特的技能树和兵种特化。',
      triggerCondition: () => this.introDialogueCompleted && !this.classSelected,
      completionCondition: () => this.classSelected,
      pauseGame: false
    });

    // 技能树教程
    this.tutorialSystem.registerTutorial('skill_tree', {
      id: 'skill_tree',
      title: '技能树系统',
      content: '按 T 键打开技能树，学习职业专属技能。',
      triggerCondition: () => this.classSelected,
      completionCondition: () => true,
      pauseGame: false
    });

    // 属性分配教程
    this.tutorialSystem.registerTutorial('attribute_allocation', {
      id: 'attribute_allocation',
      title: '属性分配',
      content: '按 A 键打开属性面板，分配属性点提升角色能力。',
      triggerCondition: () => this.classSelected,
      completionCondition: () => true,
      pauseGame: false
    });

    // 兵种特化教程
    this.tutorialSystem.registerTutorial('unit_specialization', {
      id: 'unit_specialization',
      title: '兵种特化',
      content: '按 U 键查看兵种信息，了解兵种相克关系和升级路径。',
      triggerCondition: () => this.classSelected,
      completionCondition: () => true,
      pauseGame: false
    });
  }

  /**
   * 创建教官NPCs
   */
  createInstructors() {
    // 张梁 - 战士教官
    this.instructors.push({
      id: 'zhangliang',
      name: '张梁',
      title: '地公将军',
      classType: ClassType.WARRIOR,
      position: { x: 300, y: 300 },
      color: '#FF5722'
    });

    // 张宝 - 弓箭手教官
    this.instructors.push({
      id: 'zhangbao',
      name: '张宝',
      title: '人公将军',
      classType: ClassType.ARCHER,
      position: { x: 500, y: 300 },
      color: '#4CAF50'
    });
  }

  /**
   * 开始介绍对话
   */
  startIntroDialogue() {
    this.dialoguePhase = 'intro';
    this.dialogueSystem.startDialogue('intro');
  }

  /**
   * 选择职业
   */
  selectClass(classType) {
    if (this.classSelected) {
      Logger.log('Act4Scene: 已经选择过职业');
      return;
    }

    // 使用职业系统选择职业
    const success = this.classSystem.selectClass('player', classType);
    if (!success) {
      console.error('Act4Scene: 职业选择失败');
      return;
    }

    this.selectedClass = classType;
    this.classSelected = true;

    // 更新玩家实体的职业和兵种
    if (this.playerEntity) {
      const stats = this.playerEntity.getComponent('stats');
      if (stats) {
        stats.class = classType;
        stats.skillPoints = 5; // 给予初始技能点
        
        // 根据职业设置兵种类型
        const classData = this.classSystem.getClassData(classType);
        if (classData) {
          // 如果是战士且选择了兵种，使用选择的兵种
          if (classType === ClassType.WARRIOR && this.selectedUnitType) {
            if (this.selectedUnitType === 'shield_soldier') {
              stats.setUnitType(0); // 刀盾兵 SWORD_SHIELD
            } else if (this.selectedUnitType === 'spearman') {
              stats.setUnitType(6); // 长枪兵 SPEARMAN
            }
          } else {
            // 其他职业使用默认基础兵种
            stats.setUnitType(classData.baseUnitType);
          }
          Logger.log(`Act4Scene: 设置兵种类型为 ${stats.getUnitType()}`);
        }
      }
    }

    // 更新技能树面板
    if (this.skillTreePanel) {
      this.skillTreePanel.character = this.getPlayerCharacterData();
      this.skillTreePanel.updateSkillTree();
    }

    // 给予职业初始装备
    this.giveClassEquipment(classType);

    // 显示职业选择成功提示
    const className = ClassNames[classType];
    this.notify(`你选择了 ${className} 职业！`, 'success');

    Logger.log(`Act4Scene: 选择职业 ${className}`);
  }

  /**
   * 给予职业初始装备
   */
  giveClassEquipment(classType) {
    const startingEquipment = this.classSystem.getStartingEquipment(classType);
    
    if (!this.playerEntity || !startingEquipment) return;

    const inventory = this.playerEntity.getComponent('inventory');
    if (!inventory) return;

    for (const equipData of startingEquipment) {
      // 弹药类型特殊处理
      if (equipData.type === 'ammo') {
        const ammoItem = {
          id: equipData.id,
          name: equipData.name,
          type: 'equipment',
          subType: 'ammo',
          rarity: 0,
          maxStack: 99,
          stats: {}
        };
        inventory.addItem(ammoItem, equipData.quantity || 30);
        this.notify(`得到 ${equipData.name}x${equipData.quantity || 30}`, 'success');
      } else {
        const equipment = {
          id: equipData.id,
          name: equipData.name,
          type: 'equipment',
          subType: equipData.type,
          rarity: 1,
          maxStack: 1,
          stats: this.getEquipmentStats(classType, equipData.type)
        };

        inventory.addItem(equipment, 1);
        this.notify(`得到 ${equipment.name}`, 'success');
      }
    }
  }

  /**
   * 获取装备属性（根据职业和装备类型）
   */
  getEquipmentStats(classType, equipType) {
    const stats = {};

    if (equipType === 'weapon') {
      switch (classType) {
        case ClassType.WARRIOR:
          stats.attack = 20;
          break;
        case ClassType.ARCHER:
          stats.attack = 25;
          break;
        case ClassType.MAGE:
          stats.attack = 15;
          stats.magicAttack = 30;
          break;
      }
    } else if (equipType === 'armor') {
      switch (classType) {
        case ClassType.WARRIOR:
          stats.defense = 15;
          stats.maxHp = 50;
          break;
        case ClassType.ARCHER:
          stats.defense = 8;
          stats.maxHp = 30;
          break;
        case ClassType.MAGE:
          stats.defense = 5;
          stats.maxMp = 50;
          break;
      }
    } else if (equipType === 'accessory') {
      switch (classType) {
        case ClassType.WARRIOR:
          stats.defense = 10;
          break;
        case ClassType.ARCHER:
          stats.speed = 20;
          break;
        case ClassType.MAGE:
          stats.maxMp = 30;
          break;
      }
    }

    return stats;
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
    Logger.log(`Act4Scene 通知: ${message}`);
    if (this.onNotification) {
      this.onNotification(message, type);
    }
  }

  /**
   * 更新场景 - 覆盖父类方法，添加第四幕特有逻辑
   */
  update(deltaTime) {
    // 第四幕特有：先更新教官悬停状态（需要在检查点击之前）
    this.updateInstructorHover();
    
    // 第四幕特有：更新确认窗口悬停状态
    this.updateConfirmationHover();
    
    // 第四幕特有：更新兵种选择窗口悬停状态
    this.updateUnitSelectionHover();
    
    // 第四幕特有：在父类update之前检查教官点击（避免被父类的handleUIClick阻止）
    this.checkInstructorClick();
    
    // 第四幕特有：检查确认窗口点击
    this.checkConfirmationClick();
    
    // 第四幕特有：检查兵种选择窗口点击
    this.checkUnitSelectionClick();
    
    // 调用父类的 update
    super.update(deltaTime);

    // 更新职业系统
    if (this.classSystem) {
      // 职业系统没有update方法，不需要更新
    }

    // 更新技能树面板
    if (this.skillTreePanel) {
      this.skillTreePanel.update(deltaTime);
    }

    // 更新兵种信息面板
    if (this.unitInfoPanel && this.playerEntity) {
      // 兵种信息面板没有update方法，不需要更新
    }

    // 第四幕特有：检查对话流程
    this.updateDialogueFlow();
    
    // 第四幕特有：检查快捷键
    this.checkHotkeys();
    
    // 更新提示信息
    this.updateHints();
  }

  /**
   * 更新对话流程
   */
  updateDialogueFlow() {
    if (this.dialogueSystem && !this.dialogueSystem.isDialogueActive()) {
      // 介绍对话结束
      if (this.dialoguePhase === 'intro' && !this.introDialogueCompleted) {
        this.introDialogueCompleted = true;
        Logger.log('Act4Scene: 介绍对话完成，可以点击教官选择职业了');
      }
      // 职业选择对话结束 - 显示确认窗口
      else if (this.dialoguePhase === 'class_selection' && !this.classSelectionDialogueCompleted) {
        // 如果有待选择的职业且还没选择职业，显示确认窗口
        if (this.pendingClassType && !this.classSelected) {
          Logger.log('Act4Scene: 显示确认窗口, pendingClassType:', this.pendingClassType);
          this.showClassConfirmation = true;
          this.classSelectionDialogueCompleted = true;
        }
      }
    }
  }

  /**
   * 更新教官悬停状态
   */
  updateInstructorHover() {
    if (!this.inputManager || this.classSelected) {
      this.hoveredInstructor = null;
      return;
    }

    const mouseWorldPos = this.inputManager.getMouseWorldPosition(this.camera);
    this.hoveredInstructor = null;

    for (const instructor of this.instructors) {
      // 人物图形高度约 s*2.2 = 26*2.2 ≈ 57px，宽约 s*1.2 ≈ 31px
      // position.y 是脚部，人物向上延伸
      const hitW = 50;
      const hitH = 100;
      const dx = Math.abs(mouseWorldPos.x - instructor.position.x);
      const dy = mouseWorldPos.y - instructor.position.y; // 负值=上方

      if (dx <= hitW / 2 && dy >= -hitH && dy <= 10) {
        this.hoveredInstructor = instructor;
        break;
      }
    }
  }

  /**
   * 更新确认窗口悬停状态
   */
  updateConfirmationHover() {
    if (!this.showClassConfirmation || !this.inputManager) {
      this.confirmButtonHovered = false;
      this.cancelButtonHovered = false;
      return;
    }

    const mousePos = this.inputManager.getMousePosition();
    
    // 确认窗口位置和尺寸
    const panelWidth = 400;
    const panelHeight = 200;
    const panelX = (this.logicalWidth - panelWidth) / 2;
    const panelY = (this.logicalHeight - panelHeight) / 2;
    
    // 按钮尺寸和位置
    const buttonWidth = 120;
    const buttonHeight = 40;
    const buttonY = panelY + panelHeight - 60;
    const confirmButtonX = panelX + panelWidth / 2 - buttonWidth - 10;
    const cancelButtonX = panelX + panelWidth / 2 + 10;
    
    // 检查确定按钮悬停
    this.confirmButtonHovered = (
      mousePos.x >= confirmButtonX &&
      mousePos.x <= confirmButtonX + buttonWidth &&
      mousePos.y >= buttonY &&
      mousePos.y <= buttonY + buttonHeight
    );
    
    // 检查取消按钮悬停
    this.cancelButtonHovered = (
      mousePos.x >= cancelButtonX &&
      mousePos.x <= cancelButtonX + buttonWidth &&
      mousePos.y >= buttonY &&
      mousePos.y <= buttonY + buttonHeight
    );
  }

  /**
   * 检查确认窗口点击
   */
  checkConfirmationClick() {
    if (!this.showClassConfirmation || !this.inputManager) {
      return;
    }
    
    // 检查鼠标点击
    if (!this.inputManager.isMouseClicked() || this.inputManager.isMouseClickHandled()) {
      return;
    }
    
    // 点击确定按钮
    if (this.confirmButtonHovered) {
      Logger.log('Act4Scene: 确认选择职业', this.pendingClassType);
      
      // 如果选择的是战士，显示兵种选择窗口
      if (this.pendingClassType === ClassType.WARRIOR) {
        this.showClassConfirmation = false;
        this.showUnitSelection = true;
        Logger.log('Act4Scene: 显示兵种选择窗口');
      } else {
        // 其他职业直接选择
        this.selectClass(this.pendingClassType);
        this.showClassConfirmation = false;
        this.pendingClassType = null;
      }
      
      this.inputManager.markMouseClickHandled();
    }
    // 点击取消按钮
    else if (this.cancelButtonHovered) {
      Logger.log('Act4Scene: 取消选择职业');
      this.showClassConfirmation = false;
      this.pendingClassType = null;
      this.classSelectionDialogueCompleted = false; // 重置对话完成标志，允许重新点击教官
      this.inputManager.markMouseClickHandled();
    }
  }

  /**
   * 更新兵种选择窗口悬停状态
   */
  updateUnitSelectionHover() {
    if (!this.showUnitSelection || !this.inputManager) {
      this.shieldSoldierButtonHovered = false;
      this.spearmanButtonHovered = false;
      return;
    }

    const mousePos = this.inputManager.getMousePosition();
    
    // 兵种选择窗口位置和尺寸
    const panelWidth = 500;
    const panelHeight = 300;
    const panelX = (this.logicalWidth - panelWidth) / 2;
    const panelY = (this.logicalHeight - panelHeight) / 2;
    
    // 按钮尺寸和位置
    const buttonWidth = 200;
    const buttonHeight = 80;
    const buttonY = panelY + 140;
    const shieldButtonX = panelX + 50;
    const spearButtonX = panelX + panelWidth - buttonWidth - 50;
    
    // 检查刀盾兵按钮悬停
    this.shieldSoldierButtonHovered = (
      mousePos.x >= shieldButtonX &&
      mousePos.x <= shieldButtonX + buttonWidth &&
      mousePos.y >= buttonY &&
      mousePos.y <= buttonY + buttonHeight
    );
    
    // 检查长枪兵按钮悬停
    this.spearmanButtonHovered = (
      mousePos.x >= spearButtonX &&
      mousePos.x <= spearButtonX + buttonWidth &&
      mousePos.y >= buttonY &&
      mousePos.y <= buttonY + buttonHeight
    );
  }

  /**
   * 检查兵种选择窗口点击
   */
  checkUnitSelectionClick() {
    if (!this.showUnitSelection || !this.inputManager) {
      return;
    }
    
    // 检查鼠标点击
    if (!this.inputManager.isMouseClicked() || this.inputManager.isMouseClickHandled()) {
      return;
    }
    
    // 点击刀盾兵按钮
    if (this.shieldSoldierButtonHovered) {
      Logger.log('Act4Scene: 选择刀盾兵');
      this.selectedUnitType = 'shield_soldier';
      this.selectClass(ClassType.WARRIOR);
      this.showUnitSelection = false;
      this.pendingClassType = null;
      this.inputManager.markMouseClickHandled();
    }
    // 点击长枪兵按钮
    else if (this.spearmanButtonHovered) {
      Logger.log('Act4Scene: 选择长枪兵');
      this.selectedUnitType = 'spearman';
      this.selectClass(ClassType.WARRIOR);
      this.showUnitSelection = false;
      this.pendingClassType = null;
      this.inputManager.markMouseClickHandled();
    }
  }

  /**
   * 检查教官点击
   */
  checkInstructorClick() {
    // 只在未选择职业且介绍对话完成后才能点击教官
    if (this.classSelected || !this.introDialogueCompleted) {
      return;
    }
    
    // 检查鼠标点击
    if (!this.inputManager || !this.inputManager.isMouseClicked() || this.inputManager.isMouseClickHandled()) {
      return;
    }
    
    // 直接检查鼠标位置是否在教官上（矩形碰撞，覆盖整个人物）
    const mouseWorldPos = this.inputManager.getMouseWorldPosition(this.camera);
    let clickedInstructor = null;
    
    for (const instructor of this.instructors) {
      const hitW = 50;
      const hitH = 100;
      const dx = Math.abs(mouseWorldPos.x - instructor.position.x);
      const dy = mouseWorldPos.y - instructor.position.y;

      if (dx <= hitW / 2 && dy >= -hitH && dy <= 10) {
        clickedInstructor = instructor;
        break;
      }
    }
    
    // 如果没有点击在教官上，返回
    if (!clickedInstructor) {
      return;
    }
    
    Logger.log('Act4Scene: 点击教官', clickedInstructor.name, clickedInstructor.classType);
    
    // 保存选择的职业类型，用于对话结束后选择
    this.pendingClassType = clickedInstructor.classType;
    
    // 开始职业对话
    this.dialoguePhase = 'class_selection';
    
    switch (clickedInstructor.classType) {
      case ClassType.WARRIOR:
        this.dialogueSystem.startDialogue('warrior_intro');
        break;
      case ClassType.ARCHER:
        this.dialogueSystem.startDialogue('archer_intro');
        break;
      case ClassType.MAGE:
        this.dialogueSystem.startDialogue('mage_intro');
        break;
    }
    
    this.inputManager.markMouseClickHandled();
    
    Logger.log('Act4Scene: 开始职业对话', clickedInstructor.name);
  }

  /**
   * 检查快捷键
   */
  checkHotkeys() {
    if (!this.classSelected) return;
    
    // T键 - 打开技能树
    const tPressed = this.inputManager.isKeyDown('t') || this.inputManager.isKeyDown('T');
    if (tPressed && this.skillTreePanel) {
      const now = Date.now();
      if (!this.lastSkillTreeToggleTime || now - this.lastSkillTreeToggleTime > 300) {
        this.skillTreePanel.toggle();
        this.lastSkillTreeToggleTime = now;
      }
    }
    
    // P键 - 打开属性面板（不使用A键，因为A是移动键）
    const pPressed = this.inputManager.isKeyDown('p') || this.inputManager.isKeyDown('P');
    if (pPressed && this.attributePanel) {
      const now = Date.now();
      if (!this.lastAttributeToggleTime || now - this.lastAttributeToggleTime > 300) {
        if (this.attributePanel.isOpen()) {
          this.attributePanel.hide();
        } else {
          this.attributePanel.show('player');
        }
        this.lastAttributeToggleTime = now;
      }
    }
    
    // U键 - 打开兵种信息面板
    const uPressed = this.inputManager.isKeyDown('u') || this.inputManager.isKeyDown('U');
    if (uPressed && this.unitInfoPanel && this.playerEntity) {
      const now = Date.now();
      if (!this.lastUnitInfoToggleTime || now - this.lastUnitInfoToggleTime > 300) {
        if (this.unitInfoPanel.isVisible()) {
          this.unitInfoPanel.hide();
        } else {
          this.unitInfoPanel.show(this.playerEntity);
        }
        this.lastUnitInfoToggleTime = now;
      }
    }

    // N键 - 前往第五幕
    const nPressed = this.inputManager.isKeyDown('n') || this.inputManager.isKeyDown('N');
    if (nPressed) {
      const now = Date.now();
      if (!this._lastNextSceneTime || now - this._lastNextSceneTime > 1000) {
        this._lastNextSceneTime = now;
        Logger.log('Act4Scene: N键触发，切换到第五幕');
        this.switchToNextScene();
      }
    }
  }

  /**
   * 渲染背景 - 覆盖父类方法，渲染第四幕背景
   */
  renderBackground(ctx) {
    // 调用父类渲染网格背景
    super.renderBackground(ctx);
  }

  /**
   * 渲染场景 - 覆盖父类方法，添加第四幕特有渲染
   */
  render(ctx) {
    // 调用父类的 render
    super.render(ctx);

    // 渲染场景标题
    this.renderSceneTitle(ctx);

    // 渲染教官NPCs（在相机变换之后）
    ctx.save();
    const viewBounds = this.camera.getViewBounds();
    ctx.translate(-viewBounds.left, -viewBounds.top);

    for (const instructor of this.instructors) {
      this.renderInstructor(ctx, instructor);
    }

    ctx.restore();

    // 渲染技能树面板
    if (this.skillTreePanel && this.skillTreePanel.isVisible) {
      this.skillTreePanel.render(ctx);
    }

    // 渲染兵种信息面板
    if (this.unitInfoPanel && this.unitInfoPanel.isVisible()) {
      this.unitInfoPanel.render(ctx);
    }

    // 渲染提示信息
    this.renderHints(ctx);

    // 渲染职业选择UI
    if (!this.classSelected && this.introDialogueCompleted) {
      this.renderClassSelectionUI(ctx);
    }
    
    // 渲染确认窗口（最上层）
    if (this.showClassConfirmation) {
      this.renderClassConfirmation(ctx);
    }
    
    // 渲染兵种选择窗口（最上层）
    if (this.showUnitSelection) {
      this.renderUnitSelection(ctx);
    }
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
    ctx.fillText('第四幕：职业选择', this.logicalWidth / 2, 50);
    ctx.restore();
  }

  /**
   * 渲染教官NPC
   */
  renderInstructor(ctx, instructor) {
    ctx.save();

    const x = instructor.position.x;
    const y = instructor.position.y;
    const isHovered = this.hoveredInstructor === instructor;

    // 悬停光晕
    if (isHovered && !this.classSelected) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.arc(x, y, 55, 0, Math.PI * 2);
      ctx.fill();
    }

    if (instructor.id === 'zhangliang') {
      this._renderZhangliang(ctx, x, y, isHovered);
    } else if (instructor.id === 'zhangbao') {
      this._renderZhangbao(ctx, x, y, isHovered);
    }

    // 职业名称（人物头顶最上方）
    const className = ClassNames[instructor.classType];
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = instructor.color;
    ctx.fillText(className, x, y - 110);

    // 名称和称号
    ctx.font = '12px Arial';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(instructor.title, x, y - 90);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(instructor.name, x, y - 74);

    if (isHovered && !this.classSelected) {
      ctx.font = '12px Arial';
      ctx.fillStyle = '#FFFF00';
      ctx.fillText('点击选择', x, y + 60);
    }

    ctx.restore();
  }

  /** 绘制张梁（战士，红色铠甲） */
  _renderZhangliang(ctx, x, y, isHovered) {
    const s = 26;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x, y + s*0.05, s*0.55, s*0.13, 0, 0, Math.PI*2); ctx.fill();
    // 腿（铠甲裙摆）
    ctx.fillStyle = '#8B0000';
    ctx.beginPath();
    ctx.moveTo(x - s*0.35, y - s*0.5);
    ctx.lineTo(x - s*0.38, y - s*0.05);
    ctx.lineTo(x + s*0.38, y - s*0.05);
    ctx.lineTo(x + s*0.35, y - s*0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a0000';
    ctx.beginPath(); ctx.ellipse(x - s*0.22, y - s*0.02, s*0.1, s*0.05, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + s*0.22, y - s*0.02, s*0.1, s*0.05, 0, 0, Math.PI*2); ctx.fill();
    // 身体（红色铠甲）
    const bg = ctx.createLinearGradient(x, y - s*1.15, x, y - s*0.45);
    bg.addColorStop(0, '#cc2200'); bg.addColorStop(0.5, '#aa1800'); bg.addColorStop(1, '#881000');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(x - s*0.45, y - s*1.1); ctx.lineTo(x - s*0.48, y - s*0.5);
    ctx.lineTo(x + s*0.48, y - s*0.5); ctx.lineTo(x + s*0.45, y - s*1.1);
    ctx.closePath(); ctx.fill();
    // 铠甲纹路
    ctx.strokeStyle = '#ff4422'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - s*0.3, y - s*1.05); ctx.lineTo(x - s*0.3, y - s*0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s*0.3, y - s*1.05); ctx.lineTo(x + s*0.3, y - s*0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s*0.45, y - s*0.8); ctx.lineTo(x + s*0.45, y - s*0.8); ctx.stroke();
    // 护肩
    ctx.fillStyle = '#cc2200';
    ctx.beginPath(); ctx.ellipse(x - s*0.5, y - s*1.0, s*0.15, s*0.1, -0.3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + s*0.5, y - s*1.0, s*0.15, s*0.1, 0.3, 0, Math.PI*2); ctx.fill();
    // 臂
    ctx.strokeStyle = '#c47050'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - s*0.48, y - s*0.98); ctx.quadraticCurveTo(x - s*0.58, y - s*0.78, x - s*0.52, y - s*0.58); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s*0.48, y - s*0.98); ctx.quadraticCurveTo(x + s*0.58, y - s*0.78, x + s*0.52, y - s*0.58); ctx.stroke();
    // 右手持大刀
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x + s*0.52, y - s*0.58); ctx.lineTo(x + s*0.6, y - s*1.5); ctx.stroke();
    ctx.fillStyle = '#aaa';
    ctx.beginPath(); ctx.moveTo(x + s*0.55, y - s*1.5); ctx.lineTo(x + s*0.72, y - s*1.35); ctx.lineTo(x + s*0.58, y - s*1.2); ctx.closePath(); ctx.fill();
    // 头
    const headY = y - s*1.38;
    ctx.fillStyle = '#c47050'; ctx.beginPath(); ctx.arc(x, headY, s*0.3, 0, Math.PI*2); ctx.fill();
    // 头盔
    ctx.fillStyle = '#aa1800';
    ctx.beginPath(); ctx.arc(x, headY - s*0.05, s*0.32, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#cc2200';
    ctx.beginPath(); ctx.ellipse(x, headY - s*0.05, s*0.32, s*0.1, 0, 0, Math.PI*2); ctx.fill();
    // 头盔顶饰
    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.moveTo(x - s*0.05, headY - s*0.35); ctx.lineTo(x + s*0.05, headY - s*0.35); ctx.lineTo(x, headY - s*0.55); ctx.closePath(); ctx.fill();
    // 眼
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x - s*0.11, headY + s*0.02, s*0.03, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + s*0.11, headY + s*0.02, s*0.03, 0, Math.PI*2); ctx.fill();
    // 胡须
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - s*0.08, headY + s*0.18); ctx.quadraticCurveTo(x - s*0.1, headY + s*0.38, x - s*0.06, headY + s*0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s*0.08, headY + s*0.18); ctx.quadraticCurveTo(x + s*0.1, headY + s*0.38, x + s*0.06, headY + s*0.5); ctx.stroke();
  }

  /** 绘制张宝（弓箭手，绿色猎装） */
  _renderZhangbao(ctx, x, y, isHovered) {
    const s = 24;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x, y + s*0.05, s*0.5, s*0.12, 0, 0, Math.PI*2); ctx.fill();
    // 腿
    ctx.strokeStyle = '#4a6a30'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - s*0.15, y - s*0.5); ctx.lineTo(x - s*0.16, y - s*0.05); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s*0.15, y - s*0.5); ctx.lineTo(x + s*0.16, y - s*0.05); ctx.stroke();
    ctx.fillStyle = '#2a3a18';
    ctx.beginPath(); ctx.ellipse(x - s*0.16, y - s*0.02, s*0.09, s*0.05, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + s*0.16, y - s*0.02, s*0.09, s*0.05, 0, 0, Math.PI*2); ctx.fill();
    // 身体（绿色猎装）
    const bg = ctx.createLinearGradient(x, y - s*1.1, x, y - s*0.45);
    bg.addColorStop(0, '#4a7a30'); bg.addColorStop(1, '#2a5a18');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(x - s*0.4, y - s*1.05); ctx.quadraticCurveTo(x - s*0.46, y - s*0.8, x - s*0.36, y - s*0.45);
    ctx.lineTo(x + s*0.36, y - s*0.45); ctx.quadraticCurveTo(x + s*0.46, y - s*0.8, x + s*0.4, y - s*1.05);
    ctx.closePath(); ctx.fill();
    // 腰带
    ctx.fillStyle = '#3a2810'; ctx.fillRect(x - s*0.38, y - s*0.73, s*0.76, s*0.07);
    // 箭袋（背后）
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + s*0.3, y - s*1.05, s*0.12, s*0.45);
    ctx.strokeStyle = '#5a2a08'; ctx.lineWidth = 0.8; ctx.strokeRect(x + s*0.3, y - s*1.05, s*0.12, s*0.45);
    // 箭
    ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x + s*0.33 + i*3, y - s*1.05); ctx.lineTo(x + s*0.33 + i*3, y - s*1.25); ctx.stroke();
    }
    // 臂
    ctx.strokeStyle = '#c4a070'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - s*0.4, y - s*0.98); ctx.quadraticCurveTo(x - s*0.52, y - s*0.78, x - s*0.48, y - s*0.58); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + s*0.4, y - s*0.98); ctx.quadraticCurveTo(x + s*0.52, y - s*0.78, x + s*0.48, y - s*0.58); ctx.stroke();
    // 左手持弓
    ctx.strokeStyle = '#8B4513'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x - s*0.48, y - s*0.88, s*0.32, -0.8, 0.8); ctx.stroke();
    ctx.strokeStyle = '#c8a870'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - s*0.48 + s*0.32*Math.cos(-0.8), y - s*0.88 + s*0.32*Math.sin(-0.8));
    ctx.lineTo(x - s*0.48 + s*0.32*Math.cos(0.8), y - s*0.88 + s*0.32*Math.sin(0.8)); ctx.stroke();
    // 头
    const headY = y - s*1.33;
    ctx.fillStyle = '#c4a070'; ctx.beginPath(); ctx.arc(x, headY, s*0.28, 0, Math.PI*2); ctx.fill();
    // 头巾（绿色）
    ctx.fillStyle = '#2a5a18';
    ctx.beginPath(); ctx.arc(x, headY - s*0.05, s*0.3, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#4a7a30';
    ctx.beginPath(); ctx.ellipse(x, headY - s*0.05, s*0.3, s*0.1, 0, 0, Math.PI*2); ctx.fill();
    // 头巾飘带
    ctx.strokeStyle = '#2a5a18'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + s*0.28, headY - s*0.05); ctx.quadraticCurveTo(x + s*0.4, headY + s*0.1, x + s*0.35, headY + s*0.3); ctx.stroke();
    // 眼
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x - s*0.1, headY + s*0.01, s*0.025, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + s*0.1, headY + s*0.01, s*0.025, 0, Math.PI*2); ctx.fill();
    // 嘴
    ctx.strokeStyle = '#8B5030'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, headY + s*0.12, s*0.05, 0.2, Math.PI - 0.2); ctx.stroke();
  }


  /**
   * 渲染职业选择UI
   */
  renderClassSelectionUI(ctx) {
    // 职业名称已在 renderInstructor 中显示在人物头上，这里不再渲染底部面板
  }

  /**
   * 更新提示信息（使用教程提示面板）
   */
  updateHints() {
    if (this.dialogueSystem && this.dialogueSystem.isDialogueActive()) {
      this.hideHint();
    } else if (!this.classSelected && this.introDialogueCompleted) {
      this.showHint('点击教官选择职业');
    } else if (this.classSelected) {
      this.showHint('按<span class="key">T</span>/<span class="key">P</span>/<span class="key">U</span>键查看技能树/属性/兵种 | 按<span class="key">N</span>键前往第五幕');
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
   * 渲染职业确认窗口
   */
  renderClassConfirmation(ctx) {
    if (!this.pendingClassType) return;
    
    ctx.save();
    
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    
    // 确认窗口
    const panelWidth = 400;
    const panelHeight = 200;
    const panelX = (this.logicalWidth - panelWidth) / 2;
    const panelY = (this.logicalHeight - panelHeight) / 2;
    
    // 窗口背景
    ctx.fillStyle = 'rgba(30, 30, 30, 0.95)';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    
    // 窗口边框
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
    
    // 标题
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('确认职业选择', panelX + panelWidth / 2, panelY + 40);
    
    // 职业名称
    const className = ClassNames[this.pendingClassType];
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(`你确定要选择 ${className} 吗？`, panelX + panelWidth / 2, panelY + 90);
    
    // 提示文字
    ctx.font = '14px Arial';
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText('职业一旦选择将无法更改', panelX + panelWidth / 2, panelY + 120);
    
    // 按钮
    const buttonWidth = 120;
    const buttonHeight = 40;
    const buttonY = panelY + panelHeight - 60;
    const confirmButtonX = panelX + panelWidth / 2 - buttonWidth - 10;
    const cancelButtonX = panelX + panelWidth / 2 + 10;
    
    // 确定按钮
    ctx.fillStyle = this.confirmButtonHovered ? '#4CAF50' : '#2E7D32';
    ctx.fillRect(confirmButtonX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = this.confirmButtonHovered ? '#FFFFFF' : '#4CAF50';
    ctx.lineWidth = 2;
    ctx.strokeRect(confirmButtonX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('确定', confirmButtonX + buttonWidth / 2, buttonY + buttonHeight / 2 + 6);
    
    // 取消按钮
    ctx.fillStyle = this.cancelButtonHovered ? '#F44336' : '#C62828';
    ctx.fillRect(cancelButtonX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = this.cancelButtonHovered ? '#FFFFFF' : '#F44336';
    ctx.lineWidth = 2;
    ctx.strokeRect(cancelButtonX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('取消', cancelButtonX + buttonWidth / 2, buttonY + buttonHeight / 2 + 6);
    
    ctx.restore();
  }

  /**
   * 渲染兵种选择窗口
   */
  renderUnitSelection(ctx) {
    ctx.save();
    
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    
    // 兵种选择窗口
    const panelWidth = 500;
    const panelHeight = 300;
    const panelX = (this.logicalWidth - panelWidth) / 2;
    const panelY = (this.logicalHeight - panelHeight) / 2;
    
    // 窗口背景
    ctx.fillStyle = 'rgba(30, 30, 30, 0.95)';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    
    // 窗口边框
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
    
    // 标题
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('选择兵种', panelX + panelWidth / 2, panelY + 40);
    
    // 提示文字
    ctx.font = '14px Arial';
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText('战士可以选择不同的兵种特化', panelX + panelWidth / 2, panelY + 70);
    
    // 按钮尺寸和位置
    const buttonWidth = 200;
    const buttonHeight = 80;
    const buttonY = panelY + 140;
    const shieldButtonX = panelX + 50;
    const spearButtonX = panelX + panelWidth - buttonWidth - 50;
    
    // 刀盾兵按钮
    ctx.fillStyle = this.shieldSoldierButtonHovered ? '#2196F3' : '#1565C0';
    ctx.fillRect(shieldButtonX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = this.shieldSoldierButtonHovered ? '#FFFFFF' : '#2196F3';
    ctx.lineWidth = 2;
    ctx.strokeRect(shieldButtonX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('刀盾兵', shieldButtonX + buttonWidth / 2, buttonY + 30);
    
    ctx.font = '12px Arial';
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText('高防御 | 稳健', shieldButtonX + buttonWidth / 2, buttonY + 50);
    ctx.fillText('擅长保护队友', shieldButtonX + buttonWidth / 2, buttonY + 65);
    
    // 长枪兵按钮
    ctx.fillStyle = this.spearmanButtonHovered ? '#FF5722' : '#D84315';
    ctx.fillRect(spearButtonX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = this.spearmanButtonHovered ? '#FFFFFF' : '#FF5722';
    ctx.lineWidth = 2;
    ctx.strokeRect(spearButtonX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('长枪兵', spearButtonX + buttonWidth / 2, buttonY + 30);
    
    ctx.font = '12px Arial';
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText('高攻击 | 突刺', spearButtonX + buttonWidth / 2, buttonY + 50);
    ctx.fillText('擅长破甲攻击', spearButtonX + buttonWidth / 2, buttonY + 65);
    
    ctx.restore();
  }

  /**
   * 退出场景
   */
  exit() {
    // 清理第四幕特有资源
    this.classSystem = null;
    this.skillTreePanel = null;
    this.unitInfoPanel = null;
    
    // 隐藏属性面板
    if (this.attributePanel) {
      this.attributePanel.hide();
    }

    // 调用父类的 exit
    super.exit();
  }
}

export default Act4Scene;

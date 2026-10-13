/**
 * Act1Scene - 第一幕：绝望的开始（重构版）
 * 
 * 【配置驱动实现】
 * 本场景采用配置驱动的方式，所有功能性代码都在核心系统中实现。
 * 场景类只负责：
 * 1. 加载配置
 * 2. 初始化场景
 * 3. 协调各个系统
 * 
 * 需求：1, 2, 3, 4, 5, 6, 7
 */

import { Logger } from '../../../src/core/Logger.js';
import { Scene } from '../../../src/core/Scene.js';
import Act1Config from '../config/Act1Config.js';
import { TutorialConfig } from '../config/TutorialConfig.js';
import { ProgressiveTipsConfig } from '../config/ProgressiveTipsConfig.js';

export class Act1Scene extends Scene {
  constructor(engine) {
    super(engine);
    
    // 加载配置
    this.config = Act1Config;
    this.tutorialConfig = TutorialConfig;
    this.tipsConfig = ProgressiveTipsConfig;
    
    // 场景状态
    this.initialized = false;
    this.playerEntity = null;
    this.npcEntities = [];
    
    Logger.log('Act1Scene: 场景已创建');
  }
  
  /**
   * 初始化场景
   */
  async init() {
    Logger.log('Act1Scene: 开始初始化场景');
    
    // 获取引擎提供的系统
    this.dialogueSystem = this.engine.getSystem('dialogue');
    this.tutorialSystem = this.engine.getSystem('tutorial');
    this.questSystem = this.engine.getSystem('quest');
    this.classSystem = this.engine.getSystem('class');
    
    // 如果系统不存在，创建临时实例（向后兼容）
    if (!this.dialogueSystem) {
      const { DialogueSystem } = await import('../../systems/DialogueSystem.js');
      this.dialogueSystem = new DialogueSystem();
      console.warn('Act1Scene: DialogueSystem 未在引擎中注册，使用临时实例');
    }
    
    if (!this.tutorialSystem) {
      const { TutorialSystem } = await import('../../systems/TutorialSystem.js');
      this.tutorialSystem = new TutorialSystem();
      console.warn('Act1Scene: TutorialSystem 未在引擎中注册，使用临时实例');
    }
    
    if (!this.questSystem) {
      const { QuestSystem } = await import('../../systems/QuestSystem.js');
      this.questSystem = new QuestSystem();
      console.warn('Act1Scene: QuestSystem 未在引擎中注册，使用临时实例');
    }
    
    if (!this.classSystem) {
      const { ClassSystem } = await import('../../systems/ClassSystem.js');
      this.classSystem = new ClassSystem();
      console.warn('Act1Scene: ClassSystem 未在引擎中注册，使用临时实例');
    }
    
    // 加载配置
    await this.loadConfigurations();
    
    // 设置场景
    this.setupScene();
    
    // 创建实体
    this.createEntities();
    
    this.initialized = true;
    Logger.log('Act1Scene: 场景初始化完成');
  }
  
  /**
   * 加载配置
   */
  async loadConfigurations() {
    Logger.log('Act1Scene: 加载配置');
    
    // 加载对话配置
    this.loadDialogues();
    
    // 加载教程配置
    this.loadTutorials();
    
    // 加载任务配置
    this.loadQuests();
  }
  
  /**
   * 加载对话配置
   */
  loadDialogues() {
    const dialogues = this.config.dialogues;
    
    for (const [dialogueId, dialogueData] of Object.entries(dialogues)) {
      this.dialogueSystem.registerDialogue(dialogueId, dialogueData);
      Logger.log(`Act1Scene: 注册对话 "${dialogueId}"`);
    }
  }
  
  /**
   * 加载教程配置
   */
  loadTutorials() {
    const tutorials = this.config.tutorials;
    
    for (const [tutorialId, tutorialData] of Object.entries(tutorials)) {
      this.tutorialSystem.registerTutorial(tutorialId, tutorialData);
      Logger.log(`Act1Scene: 注册教程 "${tutorialId}"`);
    }
  }
  
  /**
   * 加载任务配置
   */
  loadQuests() {
    const quests = this.config.quests;
    
    quests.forEach(questData => {
      const { Quest } = require('../../systems/QuestSystem.js');
      const quest = new Quest(questData);
      this.questSystem.registerQuest(quest);
      Logger.log(`Act1Scene: 注册任务 "${questData.name}"`);
    });
  }
  
  /**
   * 设置场景
   */
  setupScene() {
    Logger.log('Act1Scene: 设置场景');
    
    // 设置场景尺寸
    this.width = this.config.scene.width;
    this.height = this.config.scene.height;
    
    // 设置背景
    this.backgroundColor = this.config.scene.background.color;
    
    // 如果有背景图片，加载它
    if (this.config.scene.background.image) {
      this.loadBackgroundImage(this.config.scene.background.image);
    }
  }
  
  /**
   * 创建实体
   */
  createEntities() {
    Logger.log('Act1Scene: 创建实体');
    
    // 创建玩家
    this.createPlayer();
    
    // 创建NPC
    this.createNPCs();
  }
  
  /**
   * 创建玩家实体
   */
  createPlayer() {
    // 如果引擎有 entityFactory，使用它
    if (this.engine && this.engine.entityFactory) {
      this.playerEntity = this.engine.entityFactory.createEntity('player');
      
      const spawn = this.config.scene.playerSpawn;
      this.playerEntity.addComponent('position', {
        x: spawn.x,
        y: spawn.y
      });
      
      this.playerEntity.addComponent('renderable', {
        sprite: 'player',
        width: 32,
        height: 32
      });
      
      this.addEntity(this.playerEntity);
      Logger.log('Act1Scene: 玩家实体已创建');
    } else {
      // 简化版本：创建一个简单的玩家对象
      const spawn = this.config.scene.playerSpawn;
      this.playerEntity = {
        x: spawn.x,
        y: spawn.y,
        width: 32,
        height: 32,
        type: 'player'
      };
      Logger.log('Act1Scene: 玩家对象已创建（简化版）');
    }
  }
  
  /**
   * 创建NPC实体
   */
  createNPCs() {
    const npcs = this.config.npcs;
    
    npcs.forEach(npcData => {
      const npc = this.createNPC(npcData);
      this.npcEntities.push(npc);
      Logger.log(`Act1Scene: NPC "${npcData.name}" 已创建`);
    });
  }
  
  /**
   * 创建单个NPC实体
   */
  createNPC(npcData) {
    // 如果引擎有 entityFactory，使用它
    if (this.engine && this.engine.entityFactory) {
      const npc = this.engine.entityFactory.createEntity('npc');
      
      npc.addComponent('position', {
        x: npcData.position.x,
        y: npcData.position.y
      });
      
      npc.addComponent('npc', {
        id: npcData.id,
        name: npcData.name,
        title: npcData.title,
        dialogueId: npcData.dialogueId
      });
      
      npc.addComponent('renderable', {
        sprite: npcData.portrait,
        width: 50,
        height: 50
      });
      
      this.addEntity(npc);
      return npc;
    } else {
      // 简化版本：创建一个简单的NPC对象
      return {
        id: npcData.id,
        name: npcData.name,
        title: npcData.title,
        x: npcData.position.x,
        y: npcData.position.y,
        width: 50,
        height: 50,
        dialogueId: npcData.dialogueId,
        type: 'npc'
      };
    }
  }
  
  /**
   * 场景进入
   */
  enter(data = null) {
    Logger.log('Act1Scene: 进入场景');
    
    if (!this.initialized) {
      this.init();
    }
    
    // 触发进入事件
    this.onEnter(data);
  }
  
  /**
   * 场景退出
   */
  exit() {
    Logger.log('Act1Scene: 退出场景');
    
    // 清理资源
    this.cleanup();
    
    // 触发退出事件
    this.onExit();
  }
  
  /**
   * 更新场景
   */
  update(deltaTime) {
    if (!this.initialized) return;
    
    // 更新系统
    if (this.dialogueSystem) {
      this.dialogueSystem.update(deltaTime);
    }
    
    if (this.tutorialSystem) {
      this.tutorialSystem.update(deltaTime, this.getGameState());
    }
    
    if (this.questSystem) {
      this.questSystem.update(deltaTime);
    }
    
    // 调用父类更新
    if (super.update) {
      super.update(deltaTime);
    }
  }
  
  /**
   * 渲染场景
   */
  render(ctx) {
    if (!this.initialized) return;
    
    // 渲染背景
    this.renderBackground(ctx);
    
    // 渲染实体
    this.renderEntities(ctx);
    
    // 渲染系统UI
    if (this.dialogueSystem) {
      this.dialogueSystem.render(ctx);
    }
    
    if (this.tutorialSystem) {
      this.tutorialSystem.render(ctx);
    }
    
    // 调用父类渲染
    if (super.render) {
      super.render(ctx);
    }
  }
  
  /**
   * 渲染背景
   */
  renderBackground(ctx) {
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, this.width, this.height);
  }
  
  /**
   * 渲染实体
   */
  renderEntities(ctx) {
    // 渲染玩家
    if (this.playerEntity) {
      ctx.fillStyle = '#4A90E2';
      ctx.fillRect(
        this.playerEntity.x - 16,
        this.playerEntity.y - 16,
        32,
        32
      );
    }
    
    // 渲染NPC
    this.npcEntities.forEach(npc => {
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(
        npc.x - 25,
        npc.y - 25,
        50,
        50
      );
      
      // 渲染NPC名称
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(npc.name, npc.x, npc.y - 35);
    });
  }
  
  /**
   * 获取游戏状态（用于教程系统）
   */
  getGameState() {
    return {
      isFirstTime: true,
      tutorialCompleted: [],
      questAccepted: false,
      classSelected: false,
      hasMoved: false,
      nearNPC: this.isPlayerNearNPC(),
      hasInteracted: false
    };
  }
  
  /**
   * 检查玩家是否靠近NPC
   */
  isPlayerNearNPC() {
    if (!this.playerEntity) return false;
    
    const interactionDistance = 100;
    
    return this.npcEntities.some(npc => {
      const dx = this.playerEntity.x - npc.x;
      const dy = this.playerEntity.y - npc.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance < interactionDistance;
    });
  }
  
  /**
   * 处理鼠标点击
   */
  handleClick(x, y) {
    // 检查是否点击了NPC
    const clickedNPC = this.npcEntities.find(npc => {
      return x >= npc.x - 25 && x <= npc.x + 25 &&
             y >= npc.y - 25 && y <= npc.y + 25;
    });
    
    if (clickedNPC) {
      this.interactWithNPC(clickedNPC);
    }
  }
  
  /**
   * 与NPC交互
   */
  interactWithNPC(npc) {
    Logger.log(`Act1Scene: 与 ${npc.name} 交互`);
    
    // 开始对话
    if (this.dialogueSystem && npc.dialogueId) {
      this.dialogueSystem.startDialogue(npc.dialogueId, {
        npc: npc,
        player: this.playerEntity
      });
    }
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    Logger.log('Act1Scene: 清理资源');
    
    // 清理实体
    this.playerEntity = null;
    this.npcEntities = [];
    
    // 清理系统（如果是临时创建的）
    // 注意：如果系统是从引擎获取的，不应该清理
  }
  
  /**
   * 加载背景图片
   * @param {string} imagePath - 图片路径
   */
  loadBackgroundImage(imagePath) {
    // 使用AssetManager加载背景图片
    if (this.engine && this.engine.assetManager) {
      this.engine.assetManager.loadImage(imagePath)
        .then(image => {
          this.backgroundImage = image;
          Logger.log(`Act1Scene: 背景图片加载成功 "${imagePath}"`);
        })
        .catch(error => {
          console.warn(`Act1Scene: 背景图片加载失败 "${imagePath}"`, error);
          // 使用默认背景色
          this.backgroundImage = null;
        });
    } else {
      Logger.log(`Act1Scene: AssetManager不可用，跳过背景图片加载 "${imagePath}"`);
    }
  }
  
  /**
   * 添加实体（如果使用ECS）
   */
  addEntity(entity) {
    if (this.entities) {
      this.entities.push(entity);
    }
  }
  
  /**
   * 场景进入回调
   */
  onEnter(data) {
    // 子类可以重写此方法
  }
  
  /**
   * 场景退出回调
   */
  onExit() {
    // 子类可以重写此方法
  }
}

export default Act1Scene;

/**
 * Act1SceneECS - 第一幕：绝望的开始
 * 
 * 继承自 BaseGameScene，包含第一幕特有功能：
 * - 角色创建
 * - 渐进式教程提示
 * - 火堆点燃
 * - 战斗波次
 * - 死亡过渡到第二幕
 * 
 * 需求：1, 2, 3, 4, 5, 6, 7
 */

import { Logger } from '../../../src/core/Logger.js';
import { BaseGameScene } from './BaseGameScene.js';
import { TutorialConfig } from '../config/TutorialConfig.js';
import { TutorialConditions } from '../conditions/TutorialConditions.js';
import { ProgressiveTipsConfig } from '../config/ProgressiveTipsConfig.js';
import { ProgressiveTipsConditions } from '../conditions/ProgressiveTipsConditions.js';
import { Entity } from '../../../src/ecs/Entity.js';
import { TransformComponent } from '../../../src/ecs/components/TransformComponent.js';
import { SpriteComponent } from '../../../src/ecs/components/SpriteComponent.js';
import { NameComponent } from '../../../src/ecs/components/NameComponent.js';

export class Act1SceneECS extends BaseGameScene {
  constructor() {
    super(1, {
      title: '第一幕：绝望的开始',
      description: '在乱世中挣扎求生'
    });
    
    // 第一幕特有：教程状态
    this.tutorialPhase = 'character_creation';
    this.tutorialsCompleted = {
      movement: false,
      pickup: false,
      equipment: false,
      consumable: false,
      combat: false
    };
    
    // 第一幕特有：教程追踪
    this.playerMovedDistance = 0;
    this.lastPlayerPosition = null;
    
    // 第一幕特有：火堆
    this.campfire = {
      x: 350,
      y: 250,
      lit: false,
      emitters: [],
      emitterSmoke: null,
      fireImage: null,
      imageLoaded: false,
      frameWidth: 658 / 4,
      frameHeight: 712 / 3,
      frameCols: 4,
      frameRows: 3,
      frameCount: 12,
      currentFrame: 0,
      frameTime: 0,
      frameDuration: 0.16
    };
    
    // 第一幕特有：战斗状态
    this.combatWave = 0;
    this.combatComplete = false;
    this.starvingWaveTriggered = false;
    this.waveSpawned = false;
    
    // 第一幕特有：饥民逐渐生成器
    this.starvingSpawner = {
      active: false,
      totalCount: 18,
      spawnedCount: 0,
      spawnInterval: 0.6,  // 每0.6秒生成一个
      spawnTimer: 0
    };
    
    // 第一幕特有：气泡对话
    this.speechBubbles = [];  // [{entityId, text, x, y, age, maxAge}]
    this.STARVING_PHRASES = [
      '好饿...', '饿死了...', '有吃的吗...', '救命...', 
      '三天没吃了...', '谁有粮食...', '活不下去了...',
      '肚子好饿...', '求求你...', '给口吃的吧...',
      '饿得头晕...', '快饿死了...', '好冷好饿...',
      '有没有人...', '太饿了...'
    ];
    this.DOG_PHRASES = [
      '汪汪！', '汪！', '呜...', '嗷呜~',
      '汪汪汪！', '呜呜...', '嗷！', '汪~'
    ];
    
    // 第一幕特有：死亡和过渡
    this.playerDied = false;
    this.isTransitioning = false;
    this.transitionAlpha = 0;
    this.transitionPhase = 'none';
    this.transitionTimer = 0;
    this.transitionDuration = 2.0;
    this.textDisplayDuration = 3.0;
    
    // 第一幕特有：角色名称
    this.characterName = '';
    
    // 第一幕特有：角色创建标志
    this.characterCreated = false;
    
    // 第一幕特有：迷雾效果
    this.fog = {
      opacity: 0.85,        // 初始迷雾浓度
      targetOpacity: 0.85,  // 目标浓度
      fadeSpeed: 0.4,        // 每秒消散速度（约2秒完全消散）
      color: 'rgba(30, 30, 40,',  // 灰黑色
      active: true           // 迷雾是否激活
    };
  }

  /**
   * 场景进入
   */
  enter(data = null) {
    // 调用父类的 enter，初始化所有基础系统
    super.enter(data);
    
    Logger.log('Act1SceneECS: enter() 完成，isActive =', this.isActive);
    
    // 初始化教程阶段配置
    this.initTutorialPhases();
    
    // 第一幕特有：覆盖背包快捷键，添加教程逻辑（先注销父类注册的，再重新注册）
    this.inputManager.unregisterHotkey('toggle_inventory');
    this.inputManager.registerHotkey('toggle_inventory', ['b', 'B'], () => {
      this.inventoryPanel.toggle();
      // 第一幕特有：在 view_inventory 阶段打开背包时完成 tip_5
      if (this.tutorialPhase === 'view_inventory' && !this.tutorialsCompleted.progressive_tip_5 && this.inventoryPanel.visible) {
        this.completeTutorial('progressive_tip_5');
      }
    }, { cooldown: 300 });
    
    // 第一幕特有：注册渐进式教程
    this.registerTutorials();
    
    // 第一幕特有：加载火焰图片
    this.loadFireImage();
    
    // 第一幕特有：显示角色创建
    this.showCharacterCreation();
    
    Logger.log('Act1SceneECS: 进入第一幕 - 绝望的开始');
  }

  /**
   * 创建玩家实体 - 调用父类方法，然后设置第一幕特有的初始状态
   */
  createPlayerEntity() {
    // 调用父类方法创建玩家（使用统一的技能配置）
    super.createPlayerEntity();
    
    // 第一幕特有：设置角色名称和初始血量（30%，受伤状态）
    this.characterName = '玩家1';
    this.playerEntity.name = this.characterName;
    
    const stats = this.playerEntity.getComponent('stats');
    if (stats) {
      stats.hp = Math.floor(stats.maxHp * 0.3); // 30% 生命值
    }
    
    Logger.log('Act1SceneECS: 创建玩家实体（初始血量30%）', this.playerEntity);
  }

  /**
   * 显示角色创建界面
   */
  showCharacterCreation() {
    this.characterCreated = true;
    
    // 不在这里显示教程，等待回调设置后再显示
    // 教程会在 index.html 的 initGame 中设置回调后显示
    Logger.log('Act1SceneECS: showCharacterCreation 完成，等待教程回调设置');
  }

  /**
   * 渐进式提示配置
   */
  getProgressiveTipsConfig() {
    const tips = [];
    
    for (const tipId in ProgressiveTipsConfig) {
      const config = ProgressiveTipsConfig[tipId];
      
      tips.push({
        id: config.id,
        title: config.title,
        description: config.description,
        text: config.text,
        position: config.position,
        priority: config.priority,
        triggerCondition: () => {
          return ProgressiveTipsConditions.evaluate(config.triggerConditionId, this);
        }
      });
    }
    
    return tips;
  }

  /**
   * 基础教程配置
   */
  getBasicTutorialsConfig() {
    const tutorials = [];
    
    for (const tutorialId in TutorialConfig) {
      const config = TutorialConfig[tutorialId];
      
      tutorials.push({
        id: config.id,
        title: config.title,
        description: config.description,
        steps: config.steps,
        priority: config.priority,
        triggerCondition: () => {
          return TutorialConditions.evaluate(
            config.triggerConditionId,
            this,
            this.getGameState()
          );
        },
        completionCondition: () => {
          return TutorialConditions.evaluate(
            config.completionConditionId,
            this,
            this.getGameState()
          );
        }
      });
    }
    
    return tutorials;
  }

  /**
   * 注册教程（仅渐进式提示）
   */
  registerTutorials() {
    // 只注册渐进式提示，不注册基础教程
    const progressiveTips = this.getProgressiveTipsConfig();
    for (const tip of progressiveTips) {
      this.tutorialSystem.registerTutorial(tip.id, {
        title: tip.title,
        description: tip.description,
        steps: [{ text: tip.text, position: tip.position }],
        triggerCondition: tip.triggerCondition,
        pauseGame: false,
        canSkip: false,
        priority: tip.priority,
        autoTrigger: true
      });
    }
  }

  /**
   * 开始移动教程
   */
  startMovementTutorial() {
    Logger.log('Act1SceneECS: 开始移动教程');
    this.tutorialPhase = 'movement';
    // 不再调用 showTutorial，使用渐进式提示系统
    
    // 记录初始位置
    const transform = this.playerEntity.getComponent('transform');
    if (transform) {
      this.lastPlayerPosition = { x: transform.position.x, y: transform.position.y };
    }
  }

  /**
   * 开始拾取教程
   */
  startPickupTutorial() {
    Logger.log('Act1SceneECS: 开始拾取教程');
    this.tutorialPhase = 'pickup';
    this.spawnPickupItems();
    // 不再调用 showTutorial，使用渐进式提示系统
  }

  /**
   * 生成可拾取物品（从 ActData.json 读取）
   */
  spawnPickupItems() {
    let items = [];

    if (this.actData && this.actData.pickupItems) {
      items = this.actData.pickupItems.map(item => ({
        ...item,
        x: item.position ? item.position.x : item.x,
        y: item.position ? item.position.y : item.y
      }));
    } else {
      // fallback：数据未加载时使用默认值
      console.warn('Act1SceneECS: actData未加载，使用默认物品数据');
      items = [
        { 
          id: 'leftover_food', 
          name: '残羹', 
          type: 'consumable', 
          x: 250, 
          y: 300, 
          heal: 20,
          description: '剩余的食物，可以恢复少量生命值',
          rarity: 0,
          maxStack: 10,
          usable: true,
          effect: { type: 'heal', value: 20 }
        }
      ];
    }

    for (const item of items) {
      this.pickupItems.push({
        ...item,
        picked: false
      });
    }

    Logger.log('Act1SceneECS: 生成拾取物品', this.pickupItems);
  }


  /**
   * 生成装备物品（从 ActData.json 读取）
   */
  spawnEquipmentItems() {
    let items = [];
    
    if (this.actData && this.actData.equipmentItems) {
      items = this.actData.equipmentItems.map(item => ({
        ...item,
        x: item.position ? item.position.x : item.x,
        y: item.position ? item.position.y : item.y
      }));
    } else {
      // fallback：数据未加载时使用默认值
      console.warn('Act1SceneECS: actData未加载，使用默认装备数据');
      items = [
        { 
          id: 'ragged_clothes', 
          name: '破旧衣服', 
          type: 'equipment',
          subType: 'armor',
          x: 200, 
          y: 200,
          stats: { defense: 2 },
          description: '破旧的衣服，聊胜于无',
          rarity: 0,
          maxStack: 1
        },
        { 
          id: 'wooden_sword', 
          name: '木剑', 
          type: 'equipment',
          subType: 'mainhand',
          x: 300, 
          y: 250,
          attackSpeed: 1.0,
          stats: { attack: 5 },
          description: '简陋的木棍，可以用来防身',
          rarity: 0,
          maxStack: 1
        }
      ];
    }
    
    for (const item of items) {
      this.equipmentItems.push({
        ...item,
        picked: false
      });
    }
    
    Logger.log('Act1SceneECS: 生成装备物品', this.equipmentItems);
  }

  /**
   * 拾取物品（支持两个数组）
   */
  pickupItem(item, fromEquipmentItems = false) {
    if (item.picked) return;
    
    Logger.log(`Act1SceneECS: 拾取物品 - ${item.name}`);
    item.picked = true;
    
    // 添加到背包
    const inventory = this.playerEntity.getComponent('inventory');
    if (inventory) {
      // 创建完整的物品对象
      const itemData = {
        id: item.id,
        name: item.name,
        type: item.type,
        subType: item.subType,
        description: item.description || '',
        rarity: item.rarity || 0,
        maxStack: item.maxStack || 1,
        usable: item.usable || false,
        effect: item.effect || null,
        stats: {}
      };
      
      // 添加装备属性
      if (item.attack) itemData.stats.attack = item.attack;
      if (item.defense) itemData.stats.defense = item.defense;
      if (item.heal) itemData.heal = item.heal;
      if (item.stats) itemData.stats = { ...itemData.stats, ...item.stats };
      if (item.attackSpeed != null) itemData.attackSpeed = item.attackSpeed;
      if (item.ranged) itemData.ranged = true;
      if (item.quantity != null) itemData.quantity = item.quantity;
      if (item.attackRange != null) itemData.attackRange = item.attackRange;
      if (item.attackDistance != null) itemData.attackDistance = item.attackDistance;
      if (item.pierce != null) itemData.pierce = item.pierce;
      if (item.multishot != null) itemData.multishot = item.multishot;
      
      inventory.addItem(itemData, item.quantity || 1);
      Logger.log('Act1SceneECS: 物品已添加到背包', itemData);
    }
  }

  /**
   * 开始装备教程
   */
  startEquipmentTutorial() {
    Logger.log('Act1SceneECS: 开始装备教程');
    this.tutorialPhase = 'equipment';
    // 不再调用 showTutorial，使用渐进式提示系统
  }

  /**
   * 开始战斗教程
   */
  startCombatTutorial() {
    Logger.log('Act1SceneECS: 开始战斗教程');
    this.tutorialPhase = 'combat';
    // 不再调用 showTutorial，使用渐进式提示系统
    this.spawnCombatWave(0);
  }

  /**
   * 生成战斗波次
   */
  spawnCombatWave(waveIndex) {
    Logger.log(`Act1SceneECS: 生成第${waveIndex + 1}波敌人`);
    this.combatWave = waveIndex;
    this.waveSpawned = true;
    
    // 清除旧敌人
    for (const enemy of this.enemyEntities) {
      const index = this.entities.indexOf(enemy);
      if (index > -1) {
        this.entities.splice(index, 1);
      }
    }
    this.enemyEntities = [];
    
    // 生成新敌人
    const waves = [
      // 第一波：野狗
      [
        { name: '野狗', templateId: 'wild_dog', level: 1, stats: { maxHp: 30, attack: 5, defense: 2 }, x: 500, y: 300 },
        { name: '野狗', templateId: 'wild_dog', level: 1, stats: { maxHp: 30, attack: 5, defense: 2 }, x: 600, y: 300 }
      ],
      // 第二波：饥民围困
      []
    ];
    
    // 第二波特殊处理（饥民逐渐从四面八方进入）
    if (waveIndex === 1) {
      // 启动逐渐生成模式，不在这里一次性生成
      this.starvingSpawner.active = true;
      this.starvingSpawner.spawnedCount = 0;
      this.starvingSpawner.spawnTimer = 0;
      Logger.log('Act1SceneECS: 启动饥民逐渐生成模式，总数:', this.starvingSpawner.totalCount);
      return; // 不走下面的批量生成逻辑
    }
    
    const waveData = waves[waveIndex] || [];
    for (const enemyData of waveData) {
      const enemy = this.entityFactory.createEnemy({
        name: enemyData.name,
        templateId: enemyData.templateId,
        level: enemyData.level,
        position: { x: enemyData.x, y: enemyData.y },
        stats: enemyData.stats,
        aiType: 'aggressive'
      });
      
      // 调试：检查名字组件
      const nameComp = enemy.getComponent('name');
      Logger.log(`创建敌人: ${enemy.name}, 名字组件:`, nameComp);
      
      this.entities.push(enemy);
      this.enemyEntities.push(enemy);
      
      // 注册AI控制器（让敌人主动攻击）
      this.aiSystem.registerAI(enemy, 'aggressive');
      
      // 野狗生成时给初始气泡
      if (enemyData.templateId === 'wild_dog') {
        this.addSpeechBubble(enemy);
      }
      
      // 调试：确认敌人属性
      Logger.log(`敌人 ${enemy.name} 已创建:`, {
        id: enemy.id,
        type: enemy.type,
        faction: enemy.faction,
        aiType: enemy.aiType,
        position: enemyData
      });
    }
    
    Logger.log(`Act1SceneECS: 生成了 ${waveData.length} 个敌人，已注册AI`);
    Logger.log(`玩家信息:`, {
      id: this.playerEntity?.id,
      type: this.playerEntity?.type,
      faction: this.playerEntity?.faction
    });
  }

  /**
   * 更新场景 - 调用父类并添加第一幕特有逻辑
   */
  update(deltaTime) {
    if (!this.isActive) {
      Logger.log('Act1SceneECS: update 被跳过，场景未激活');
      return;
    }
    
    // 更新场景过渡（优先处理）
    if (this.isTransitioning) {
      this.updateTransition(deltaTime);
      if (this.transitionPhase === 'show_text' || this.transitionPhase === 'switch_scene') {
        this.inputManager.update();
        return;
      }
    }
    
    // 更新教程阶段（第一幕特有）
    this.updateTutorialPhase(deltaTime);
    
    // 更新火焰帧动画（第一幕特有）
    this.updateCampfireAnimation(deltaTime);
    
    // 第一幕特有：检查N键触发饥民围困（必须在super.update之前，因为super.update末尾会清除keysPressed）
    if (this.combatComplete && !this.starvingWaveTriggered && this.inputManager && 
        (this.inputManager.isKeyPressed('n') || this.inputManager.isKeyPressed('N'))) {
      this.starvingWaveTriggered = true;
      this.combatComplete = false;
      // 标记 tip_11 完成
      this.tutorialsCompleted.progressive_tip_11 = true;
      if (this.tutorialSystem) {
        this.tutorialSystem.completeTutorial('progressive_tip_11');
      }
      // 切回 combat 阶段，让 checkWaveCompletion 能检测第二波完成
      this.tutorialPhase = 'combat';
      this.spawnCombatWave(1);
    }
    
    // 调用父类的 update
    super.update(deltaTime);
    
    // 第一幕特有：检查火堆碰撞
    this.checkCampfireCollision();
    
    // 第一幕特有：检查点燃火堆
    this.checkCampfire();
    
    // 第一幕特有：检查波次完成
    this.checkWaveCompletion();
    
    // 第一幕特有：逐渐生成饥民
    this.updateStarvingSpawner(deltaTime);
    
    // 第一幕特有：更新气泡对话
    this.updateSpeechBubbles(deltaTime);
    
    // 第一幕特有：检查玩家是否死亡
    this.checkPlayerDeath();
    
    // 第一幕特有：更新迷雾效果
    this.updateFog(deltaTime);
  }

  /**
   * 检查玩家是否死亡
   */
  checkPlayerDeath() {
    if (this.playerDied || this.isTransitioning) return;
    
    const stats = this.playerEntity?.getComponent('stats');
    if (stats && stats.hp <= 0) {
      Logger.log('Act1SceneECS: 检测到玩家死亡');
      this.triggerPlayerDeath();
    }
  }

  /**
   * 更新火堆动画（第一幕特有）
   */
  updateCampfireAnimation(deltaTime) {
    if (this.campfire.lit && this.campfire.imageLoaded) {
      this.campfire.frameTime += deltaTime;
      if (this.campfire.frameTime >= this.campfire.frameDuration) {
        this.campfire.frameTime = 0;
        this.campfire.currentFrame = (this.campfire.currentFrame + 1) % this.campfire.frameCount;
      }
    }
    
    // 更新火焰粒子效果
    if (this.campfire.lit) {
      const time = performance.now() / 1000;
      
      this.campfire.emitters.forEach((emitter, index) => {
        if (emitter) {
          let swayAmount;
          if (index < 2) {
            swayAmount = (Math.random() - 0.5) * 10;
          } else {
            swayAmount = Math.sin(time * 2 + index * 0.5) * 4 + (Math.random() - 0.5) * 2;
          }
          
          const baseX = this.campfire.x;
          const baseY = this.campfire.y + 2;
          
          emitter.position.x = baseX + swayAmount;
          emitter.position.y = baseY - 15;  // 火堆中心位置（底部向上15像素）
          emitter.particleConfig.velocity.x = (Math.random() - 0.5) * 10;
          
          this.particleSystem.updateEmitter(emitter, deltaTime);
        }
      });
    }
  }
  /**
   * 初始化教程阶段配置
   */
  initTutorialPhases() {
    this.tutorialPhaseHandlers = {
      'character_creation': {
        check: () => {
          // 检查是否按下任意键
          const anyPressed = this.inputManager.isAnyKeyPressed();
          
          if (anyPressed) {
            const pressedKeys = this.inputManager.getKeysPressed();
            Logger.log('Act1SceneECS: 检测到按键！', pressedKeys);
          }
          
          return anyPressed;
        },
        onComplete: () => {
          this.completeTutorial('progressive_tip_1');
          Logger.log('Act1SceneECS: 完成tip_1，进入移动阶段');
          this.startMovementTutorial();
        }
      },
      
      'movement': {
        update: (deltaTime) => {
          const transform = this.playerEntity.getComponent('transform');
          if (transform && this.lastPlayerPosition) {
            const dx = transform.position.x - this.lastPlayerPosition.x;
            const dy = transform.position.y - this.lastPlayerPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            this.playerMovedDistance += distance;
            this.lastPlayerPosition = { x: transform.position.x, y: transform.position.y };
            
            if (this.playerMovedDistance >= 10 && !this.tutorialsCompleted.progressive_tip_2) {
              this.completeTutorial('progressive_tip_2');
              Logger.log('Act1SceneECS: 完成tip_2 - 移动');
            }
          }
        },
        check: () => this.playerMovedDistance >= 100 && !this.tutorialsCompleted.movement,
        onComplete: () => {
          this.completeTutorial('movement');
          this.tutorialPhase = 'campfire';
          Logger.log('Act1SceneECS: 等待点燃火堆');
        }
      },
      
      'campfire': {
        check: () => this.campfire.lit && !this.tutorialsCompleted.campfire,
        onComplete: () => {
          this.tutorialsCompleted.campfire = true;
          Logger.log('Act1SceneECS: 火堆已点燃');
          
          if (!this.tutorialsCompleted.progressive_tip_3) {
            this.completeTutorial('progressive_tip_3');
            Logger.log('Act1SceneECS: 完成tip_3 - 点燃火堆');
          }
          
          // 确保当前教程已隐藏，避免阻塞后续提示
          if (this.tutorialSystem && this.tutorialSystem.currentTutorial) {
            this.tutorialSystem.hideTutorial();
          }
          
          this.startPickupTutorial();
          
          // 主动显示 tip_4
          if (this.tutorialSystem && !this.tutorialsCompleted.progressive_tip_4) {
            this.tutorialSystem.showTutorial('progressive_tip_4');
          }
        }
      },
      
      'pickup': {
        check: () => {
          const pickedCount = this.pickupItems.filter(item => item.picked).length;
          return pickedCount >= 1 && !this.tutorialsCompleted.pickup;
        },
        onComplete: () => {
          this.completeTutorial('pickup');
          
          if (!this.tutorialsCompleted.progressive_tip_4) {
            this.completeTutorial('progressive_tip_4');
            Logger.log('Act1SceneECS: 完成tip_4 - 拾取物品');
          }
          
          this.tutorialPhase = 'view_inventory';
          Logger.log('Act1SceneECS: 进入背包查看阶段');
        }
      },
      
      'view_inventory': {
        check: () => this.tutorialsCompleted.progressive_tip_5,
        onComplete: () => {
          this.tutorialPhase = 'consumable';
          Logger.log('Act1SceneECS: 进入消耗品使用阶段');
        }
      },
      
      'consumable': {
        check: () => {
          const inventory = this.playerEntity.getComponent('inventory');
          if (!inventory) return false;
          
          const items = inventory.getAllItems();
          const hasConsumable = items.some(({ slot }) => 
            slot.item.type === 'consumable' && slot.item.id === 'leftover_food'
          );
          
          return !hasConsumable && !this.tutorialsCompleted.consumable;
        },
        onComplete: () => {
          this.tutorialsCompleted.consumable = true;
          Logger.log('Act1SceneECS: 完成消耗品使用阶段');
          
          if (!this.tutorialsCompleted.progressive_tip_7) {
            this.completeTutorial('progressive_tip_7');
            Logger.log('Act1SceneECS: 完成tip_7 - 使用消耗品');
          }
          
          this.tutorialPhase = 'close_panels';
          Logger.log('Act1SceneECS: 进入关闭面板阶段');
        }
      },
      
      'close_panels': {
        update: (deltaTime) => {
          const bothPanelsClosed = !this.playerInfoPanel?.visible && !this.inventoryPanel?.visible;
          
          if (bothPanelsClosed && !this.tutorialsCompleted.progressive_tip_7_1) {
            this.completeTutorial('progressive_tip_7_1');
            Logger.log('Act1SceneECS: 完成tip_7.1 - 关闭面板');
          }
        },
        check: () => this.tutorialsCompleted.progressive_tip_7_1,
        onComplete: () => {
          if (this.equipmentItems.length === 0) {
            this.spawnEquipmentItems();
            Logger.log('Act1SceneECS: 生成第二批物品（装备）');
          }
          
          this.tutorialPhase = 'pickup_equipment';
          Logger.log('Act1SceneECS: 进入装备拾取阶段');
        }
      },
      
      'pickup_equipment': {
        check: () => {
          const pickedCount = this.equipmentItems.filter(item => item.picked).length;
          return pickedCount >= 2;
        },
        onComplete: () => {
          if (!this.tutorialsCompleted.progressive_tip_8) {
            this.completeTutorial('progressive_tip_8');
            Logger.log('Act1SceneECS: 完成tip_8 - 拾取装备');
          }
          
          this.startEquipmentTutorial();
        }
      },
      
      'equipment': {
        check: () => {
          const equipment = this.playerEntity.getComponent('equipment');
          const equippedCount = equipment && equipment.slots ? 
            Object.keys(equipment.slots).filter(slot => equipment.slots[slot]).length : 0;
          
          return equippedCount >= 2 && !this.tutorialsCompleted.equipment;
        },
        onComplete: () => {
          this.completeTutorial('equipment');
          
          if (!this.tutorialsCompleted.progressive_tip_9) {
            this.completeTutorial('progressive_tip_9');
            Logger.log('Act1SceneECS: 完成tip_9 - 装备物品');
          }
          
          if (!this.tutorialsCompleted.progressive_tip_10) {
            this.completeTutorial('progressive_tip_10');
            Logger.log('Act1SceneECS: 完成tip_10 - 查看装备');
          }
          
          this.startCombatTutorial();
        }
      },
      
      'combat': {
        check: () => {
          // 检查是否完成了战斗（第一波野狗）
          return this.tutorialsCompleted.combat && !this.tutorialsCompleted.progressive_tip_11;
        },
        onComplete: () => {
          // 战斗完成，显示 tip_11（按N键进入下一幕）
          // 先隐藏当前教程，避免冲突
          if (this.tutorialSystem && this.tutorialSystem.currentTutorial) {
            this.tutorialSystem.hideTutorial();
          }
          
          if (this.tutorialSystem) {
            this.tutorialSystem.showTutorial('progressive_tip_11');
          }
          
          this.tutorialPhase = 'combat_complete';
          Logger.log('Act1SceneECS: 战斗完成，等待按N键进入下一幕');
        }
      },
      
      'combat_complete': {
        // 等待用户按N键，由 update 方法中的 N 键检测处理
        // 这个阶段不需要额外的处理逻辑
        check: () => false,
        onComplete: () => {}
      }
    };
  }

  /**
   * 更新教程阶段 - 使用配置驱动
   */
  updateTutorialPhase(deltaTime) {
    const handler = this.tutorialPhaseHandlers[this.tutorialPhase];
    if (!handler) {
      Logger.log('Act1SceneECS: 没有找到阶段处理器:', this.tutorialPhase);
      return;
    }
    
    // 执行阶段特定的更新逻辑
    if (handler.update) {
      handler.update(deltaTime);
    }
    
    // 检查阶段完成条件
    if (handler.check && handler.check()) {
      Logger.log('Act1SceneECS: 阶段完成条件满足，当前阶段:', this.tutorialPhase);
      handler.onComplete();
    }
  }

  /**
   * 检查人物信息面板切换 - 覆盖父类，添加教程逻辑
   */
  checkPlayerInfoToggle() {
    if (this.inputManager.isKeyDown('c') || this.inputManager.isKeyDown('C')) {
      const now = Date.now();
      if (!this.lastPlayerInfoToggleTime || now - this.lastPlayerInfoToggleTime > 300) {
        this.playerInfoPanel.toggle();
        this.lastPlayerInfoToggleTime = now;
        
        // 第一幕特有：完成tip_6: 查看属性（在view_stats阶段打开面板）
        if (this.tutorialPhase === 'view_stats' && !this.tutorialsCompleted.progressive_tip_6 && this.playerInfoPanel.visible) {
          this.completeTutorial('progressive_tip_6');
        }
      }
    }
  }

  /**
   * 检查背包切换 - 覆盖父类，添加教程逻辑
   */
  checkInventoryToggle() {
    if (this.inputManager.isKeyDown('b') || this.inputManager.isKeyDown('B')) {
      const now = Date.now();
      if (!this.lastInventoryToggleTime || now - this.lastInventoryToggleTime > 300) {
        this.inventoryPanel.toggle();
        this.lastInventoryToggleTime = now;
        
        // 第一幕特有：完成tip_5: 按B键查看背包（在view_inventory阶段打开背包）
        if (this.tutorialPhase === 'view_inventory' && !this.tutorialsCompleted.progressive_tip_5 && this.inventoryPanel.visible) {
          this.completeTutorial('progressive_tip_5');
        }
      }
    }
  }

  /**
   * 检查点燃火堆
   */
  checkCampfire() {
    // 如果火堆已点燃，不再检查
    if (this.campfire.lit) return;
    
    // 使用 isKeyDown 检测 E 键
    const ePressed = this.inputManager.isKeyDown('e') || this.inputManager.isKeyDown('E');
    if (!ePressed) return;
    
    const transform = this.playerEntity.getComponent('transform');
    if (!transform) return;
    
    const playerX = transform.position.x;
    const playerY = transform.position.y;
    
    // 计算玩家与火堆中心的距离（火堆 y 是底部，中心在 y - 15）
    const campfireCenterY = this.campfire.y - 15;
    const dx = this.campfire.x - playerX;
    const dy = campfireCenterY - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 如果玩家靠近火堆（距离小于80），点燃火堆
    if (distance <= 80) {
      this.lightCampfire();
      Logger.log('Act1SceneECS: 点燃火堆');
    }
  }

  /**
   * 检查火堆碰撞（阻止玩家穿过火堆）
   */
  checkCampfireCollision() {
    // 如果正在轻功飞行，不检查火堆碰撞（可以飞过火堆）
    if (this.flightSystem && this.flightSystem.isPlayerFlying()) {
      return;
    }
    
    const transform = this.playerEntity.getComponent('transform');
    if (!transform) return;
    
    const playerX = transform.position.x;
    const playerY = transform.position.y;
    const playerRadius = 20; // 玩家半径
    
    // 火堆的碰撞区域（缩小，只阻止穿过火堆中心）
    const fullWidth = 30;
    const fullHeight = 20;
    const collisionWidth = fullWidth * 0.6; // 18
    const collisionHeight = fullHeight * 0.6; // 12
    
    const campfireLeft = this.campfire.x - collisionWidth / 2;
    const campfireRight = this.campfire.x + collisionWidth / 2;
    const campfireTop = this.campfire.y - 15;
    const campfireBottom = this.campfire.y - 15 + collisionHeight;
    
    // 检查玩家是否与火堆碰撞（AABB碰撞检测）
    const playerLeft = playerX - playerRadius;
    const playerRight = playerX + playerRadius;
    const playerTop = playerY - playerRadius;
    const playerBottom = playerY + playerRadius;
    
    // 检测碰撞
    if (playerRight > campfireLeft && 
        playerLeft < campfireRight && 
        playerBottom > campfireTop && 
        playerTop < campfireBottom) {
      
      // 发生碰撞，计算推开方向
      const dx = playerX - this.campfire.x;
      const dy = playerY - this.campfire.y;
      
      // 计算重叠量
      const overlapX = dx > 0 
        ? (campfireRight - playerLeft) 
        : (campfireLeft - playerRight);
      const overlapY = dy > 0 
        ? (campfireBottom - playerTop) 
        : (campfireTop - playerBottom);
      
      // 沿重叠较小的方向推开
      if (Math.abs(overlapX) < Math.abs(overlapY)) {
        // 水平推开
        transform.position.x += overlapX;
      } else {
        // 垂直推开
        transform.position.y += overlapY;
      }
    }
  }

  /**
   * 检查实体之间的碰撞（玩家与敌人）
   */
  checkEntityCollisions() {
    // 获取所有活着的实体
    const aliveEntities = this.entities.filter(e => !e.isDead && !e.isDying);
    
    // 实体半径（与火堆碰撞比例一致）
    const entityRadius = 20; // 玩家半径
    
    // 碰撞区域比例（与火堆一致：宽度8/10，高度3/4）
    const collisionWidthRatio = 0.8;
    const collisionHeightRatio = 0.75;
    
    // 检查每对实体之间的碰撞
    for (let i = 0; i < aliveEntities.length; i++) {
      const entityA = aliveEntities[i];
      const transformA = entityA.getComponent('transform');
      if (!transformA) continue;
      
      for (let j = i + 1; j < aliveEntities.length; j++) {
        const entityB = aliveEntities[j];
        const transformB = entityB.getComponent('transform');
        if (!transformB) continue;
        
        // 计算碰撞区域（应用比例）
        const radiusA = entityRadius * collisionWidthRatio;
        const radiusB = entityRadius * collisionWidthRatio;
        const heightA = entityRadius * 2 * collisionHeightRatio;
        const heightB = entityRadius * 2 * collisionHeightRatio;
        
        // AABB 碰撞检测
        const aLeft = transformA.position.x - radiusA;
        const aRight = transformA.position.x + radiusA;
        const aTop = transformA.position.y - heightA / 2;
        const aBottom = transformA.position.y + heightA / 2;
        
        const bLeft = transformB.position.x - radiusB;
        const bRight = transformB.position.x + radiusB;
        const bTop = transformB.position.y - heightB / 2;
        const bBottom = transformB.position.y + heightB / 2;
        
        // 检测碰撞
        if (aRight > bLeft && 
            aLeft < bRight && 
            aBottom > bTop && 
            aTop < bBottom) {
          
          // 发生碰撞，计算推开方向
          const dx = transformA.position.x - transformB.position.x;
          const dy = transformA.position.y - transformB.position.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance === 0) continue; // 避免除以零
          
          // 归一化方向
          const nx = dx / distance;
          const ny = dy / distance;
          
          // 计算重叠量
          const overlapX = (radiusA + radiusB) - Math.abs(dx);
          const overlapY = (heightA / 2 + heightB / 2) - Math.abs(dy);
          
          // 沿重叠较小的方向推开
          const pushDistance = Math.min(overlapX, overlapY) / 2;
          
          if (Math.abs(overlapX) < Math.abs(overlapY)) {
            // 水平推开
            transformA.position.x += nx * pushDistance;
            transformB.position.x -= nx * pushDistance;
          } else {
            // 垂直推开
            transformA.position.y += ny * pushDistance;
            transformB.position.y -= ny * pushDistance;
          }
        }
      }
    }
  }

  /**
   * 点燃火堆
   */
  lightCampfire() {
    if (this.campfire.lit) return;
    
    Logger.log('Act1SceneECS: 点燃火堆');
    this.campfire.lit = true;
    
    // 创建简洁的火焰粒子效果
    this.campfire.emitters = [];
    
    // 火堆底部的1个发射点（中心位置）
    // 火堆 y 坐标是底部中心，粒子从火堆中心发射（向上偏移15像素）
    const fireBaseY = this.campfire.y - 15;
    const firePoint = { x: this.campfire.x, y: fireBaseY };
    
    // 大火焰粒子（7-10像素，向上移动10-15像素，较少）
    this.campfire.emitters.push(this.particleSystem.createEmitter({
      position: { x: firePoint.x, y: firePoint.y },
      rate: 6,
      duration: Infinity,
      particleConfig: {
        position: { x: firePoint.x, y: firePoint.y },
        velocity: { x: 0, y: -50 },  // 速度50，生命周期0.25秒，移动12.5像素
        life: 250,
        size: 8.5,
        color: '#ffaa22',
        alpha: 0.85,
        gravity: 0,
        friction: 0.95
      }
    }));
    
    // 中火焰粒子（5-7像素，向上移动5-10像素）
    this.campfire.emitters.push(this.particleSystem.createEmitter({
      position: { x: firePoint.x, y: firePoint.y },
      rate: 8,
      duration: Infinity,
      particleConfig: {
        position: { x: firePoint.x, y: firePoint.y },
        velocity: { x: 0, y: -35 },  // 速度35，生命周期0.2秒，移动7像素
        life: 200,
        size: 6,
        color: '#ff8833',
        alpha: 0.8,
        gravity: 0,
        friction: 0.95
      }
    }));
    
    // 白色亮点（4-5像素，向上移动40-50像素，少量）
    this.campfire.emitters.push(this.particleSystem.createEmitter({
      position: { x: firePoint.x, y: firePoint.y },
      rate: 4,
      duration: Infinity,
      particleConfig: {
        position: { x: firePoint.x, y: firePoint.y },
        velocity: { x: 0, y: -120 },
        life: 400,
        size: 4.5,
        color: '#ffffee',
        alpha: 1.0,
        gravity: 0,
        friction: 0.95
      }
    }));
    
    // 亮黄色火星（3-4像素，向上移动30-40像素）
    this.campfire.emitters.push(this.particleSystem.createEmitter({
      position: { x: firePoint.x, y: firePoint.y },
      rate: 10,
      duration: Infinity,
      particleConfig: {
        position: { x: firePoint.x, y: firePoint.y },
        velocity: { x: 0, y: -100 },
        life: 350,
        size: 3.5,
        color: '#ffee44',
        alpha: 0.9,
        gravity: 0,
        friction: 0.95
      }
    }));
    
    // 橙色火星（2-3像素，向上移动20-30像素）
    this.campfire.emitters.push(this.particleSystem.createEmitter({
      position: { x: firePoint.x, y: firePoint.y },
      rate: 8,
      duration: Infinity,
      particleConfig: {
        position: { x: firePoint.x, y: firePoint.y },
        velocity: { x: 0, y: -80 },
        life: 300,
        size: 2.5,
        color: '#ff9933',
        alpha: 0.85,
        gravity: 0,
        friction: 0.95
      }
    }));
    
    // 红色火星（2像素，向上移动10-20像素）
    this.campfire.emitters.push(this.particleSystem.createEmitter({
      position: { x: firePoint.x, y: firePoint.y },
      rate: 6,
      duration: Infinity,
      particleConfig: {
        position: { x: firePoint.x, y: firePoint.y },
        velocity: { x: 0, y: -60 },
        life: 250,
        size: 2,
        color: '#ff5522',
        alpha: 0.8,
        gravity: 0,
        friction: 0.95
      }
    }));
    
    // 小火星（2像素，向上移动5-10像素，较多）
    this.campfire.emitters.push(this.particleSystem.createEmitter({
      position: { x: firePoint.x, y: firePoint.y },
      rate: 12,
      duration: Infinity,
      particleConfig: {
        position: { x: firePoint.x, y: firePoint.y },
        velocity: { x: 0, y: -40 },
        life: 200,
        size: 2,
        color: '#ff6633',
        alpha: 0.7,
        gravity: 0,
        friction: 0.95
      }
    }));
    
    Logger.log('Act1SceneECS: 火焰粒子效果已创建（1个发射点，7种粒子）');
    
    // 触发迷雾消散
    this.fog.targetOpacity = 0;
  }

  /**
   * 更新迷雾效果
   */
  updateFog(deltaTime) {
    if (!this.fog.active) return;
    
    // 平滑过渡到目标浓度
    if (Math.abs(this.fog.opacity - this.fog.targetOpacity) > 0.01) {
      if (this.fog.opacity > this.fog.targetOpacity) {
        this.fog.opacity -= this.fog.fadeSpeed * deltaTime;
        if (this.fog.opacity < this.fog.targetOpacity) {
          this.fog.opacity = this.fog.targetOpacity;
        }
      }
    } else if (this.fog.targetOpacity === 0) {
      this.fog.opacity = 0;
      this.fog.active = false;
    }
  }

  /**
   * 逐渐生成饥民
   */
  updateStarvingSpawner(deltaTime) {
    if (!this.starvingSpawner.active) return;
    if (this.starvingSpawner.spawnedCount >= this.starvingSpawner.totalCount) return;
    
    this.starvingSpawner.spawnTimer += deltaTime;
    if (this.starvingSpawner.spawnTimer >= this.starvingSpawner.spawnInterval) {
      this.starvingSpawner.spawnTimer -= this.starvingSpawner.spawnInterval;
      this.spawnSingleStarving();
    }
  }

  /**
   * 从画面边缘随机位置生成一个饥民
   */
  spawnSingleStarving() {
    // 获取玩家位置作为中心参考
    const playerTransform = this.playerEntity?.getComponent('transform');
    const centerX = playerTransform ? playerTransform.position.x : 400;
    const centerY = playerTransform ? playerTransform.position.y : 300;
    
    // 从画面四面八方生成（距离中心 150-250 像素，更靠近火堆）
    const spawnDistance = 150 + Math.random() * 100;
    const angle = Math.random() * Math.PI * 2;
    const x = centerX + Math.cos(angle) * spawnDistance;
    const y = centerY + Math.sin(angle) * spawnDistance;
    
    const enemy = this.entityFactory.createEnemy({
      name: '饥民',
      templateId: 'starving',
      level: 2,
      position: { x, y },
      stats: { maxHp: 40, attack: 6, defense: 3 },
      aiType: 'aggressive'
    });
    
    this.entities.push(enemy);
    this.enemyEntities.push(enemy);
    this.aiSystem.registerAI(enemy, 'aggressive');
    
    this.starvingSpawner.spawnedCount++;
    
    // 生成时立即给一个气泡
    this.addSpeechBubble(enemy);
  }

  /**
   * 给实体添加气泡对话
   */
  addSpeechBubble(entity) {
    const phrases = entity.name === '野狗' ? this.DOG_PHRASES : this.STARVING_PHRASES;
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    this.speechBubbles.push({
      entityId: entity.id,
      text,
      age: 0,
      maxAge: 2.5 + Math.random() * 1.5  // 2.5~4秒
    });
  }

  /**
   * 更新气泡对话
   */
  updateSpeechBubbles(deltaTime) {
    // 更新现有气泡
    for (let i = this.speechBubbles.length - 1; i >= 0; i--) {
      this.speechBubbles[i].age += deltaTime;
      if (this.speechBubbles[i].age >= this.speechBubbles[i].maxAge) {
        this.speechBubbles.splice(i, 1);
      }
    }
    
    // 随机给活着的敌人添加新气泡（每帧约2%概率）
    if (this.enemyEntities.length > 0) {
      for (const enemy of this.enemyEntities) {
        if (enemy.isDead || enemy.isDying) continue;
        if (enemy.name !== '饥民' && enemy.name !== '野狗') continue;
        
        // 检查该实体是否已有气泡
        const hasBubble = this.speechBubbles.some(b => b.entityId === enemy.id);
        if (hasBubble) continue;
        
        // 2%概率产生新气泡
        if (Math.random() < 0.02) {
          this.addSpeechBubble(enemy);
        }
      }
    }
  }

  /**
   * 检查波次完成
   */
  checkWaveCompletion() {
    if (this.tutorialPhase !== 'combat') return;
    if (this.combatComplete) return; // 已完成则不再检查
    
    if (!this.waveSpawned) return; // 还没生成过敌人
    
    // 检查所有敌人是否都已死亡（hp <= 0）
    const hasAliveEnemy = this.enemyEntities.some(enemy => {
      const stats = enemy.getComponent('stats');
      return stats && stats.hp > 0;
    });
    
    if (!hasAliveEnemy) {
      Logger.log(`Act1SceneECS: 第${this.combatWave + 1}波完成, enemyEntities.length=${this.enemyEntities.length}`);
      
      if (this.combatWave === 0) {
        // 野狗打完，标记战斗完成
        this.tutorialsCompleted.combat = true;
        this.combatComplete = true;
        Logger.log('Act1SceneECS: combatComplete=true, 等待 updateTutorialPhase 触发 onComplete');
      } else if (this.combatWave === 1) {
        // 饥民波次：所有饥民都已生成且全部死亡后触发死亡
        if (this.starvingSpawner.spawnedCount >= this.starvingSpawner.totalCount) {
          this.starvingSpawner.active = false;
          setTimeout(() => this.triggerPlayerDeath(), 5000);
        }
      }
    }
  }

  /**
   * 完成教程
   */
  completeTutorial(tutorialId) {
    this.tutorialsCompleted[tutorialId] = true;
    
    // 调用教程系统的完成方法
    if (this.tutorialSystem) {
      this.tutorialSystem.completeTutorial(tutorialId);
    }
  }

  /**
   * 触发玩家死亡（第一幕特有）
   */
  triggerPlayerDeath() {
    if (this.playerDied) return;
    
    Logger.log('Act1SceneECS: 触发玩家死亡');
    this.playerDied = true;
    
    const stats = this.playerEntity.getComponent('stats');
    if (stats) {
      stats.hp = 0;
    }
    
    // 使用父类的过渡方法
    setTimeout(() => this.startTransition('眼前一黑，你晕了过去...'), 1000);
  }

  /**
   * 切换到下一幕
   */
  switchToNextScene() {
    Logger.log('Act1SceneECS: 切换到第二幕');
    
    // 获取玩家组件数据
    const stats = this.playerEntity.getComponent('stats');
    const inventory = this.playerEntity.getComponent('inventory');
    const equipment = this.playerEntity.getComponent('equipment');
    const combat = this.playerEntity.getComponent('combat');
    
    // 准备传递给第二幕的数据
    const sceneData = {
      player: {
        id: this.playerEntity.id,
        name: this.playerEntity.name || '玩家',
        class: this.playerEntity.class || 'refugee',
        level: stats?.level || 1,
        health: stats?.hp || 100,
        maxHealth: stats?.maxHp || 100,
        hp: stats?.hp || 100,
        maxHp: stats?.maxHp || 100,
        mp: stats?.mp || 100,
        maxMp: stats?.maxMp || 100,
        attack: stats?.attack || 10,
        defense: stats?.defense || 5,
        speed: stats?.speed || 100,
        skillPoints: 0,
        inventory: inventory?.getAllItems() || [],
        equipment: equipment?.slots || {}
      },
      playerEntity: this.playerEntity, // 传递完整的玩家实体引用
      previousAct: 1
    };
    
    Logger.log('Act1SceneECS: 传递数据到第二幕', sceneData);
    
    // 调用父类的场景切换方法
    this.goToNextScene(sceneData);
  }

  /**
   * 获取游戏状态
   */
  getGameState() {
    return {
      tutorialPhase: this.tutorialPhase,
      playerMovedDistance: this.playerMovedDistance,
      pickupItems: this.pickupItems,
      tutorialsCompleted: this.tutorialsCompleted
    };
  }

  /**
   * 渲染 - 覆盖父类，添加迷雾效果
   */
  render(ctxOrBackend) {
    // 调用父类渲染
    super.render(ctxOrBackend);
    
    // 后续迷雾渲染只支持 2D ctx；3D 模式下取 HUD ctx
    const is3D = ctxOrBackend && ctxOrBackend.mode === '3d';
    const ctx = is3D ? ctxOrBackend.getHUDContext() : ctxOrBackend;
    if (!ctx) return;
    
    // 渲染迷雾效果（在所有内容之上，UI之上）
    if (this.fog.active && this.fog.opacity > 0.01) {
      ctx.save();
      
      // 获取玩家屏幕位置（需要减去相机偏移）
      const playerTransform = this.playerEntity?.getComponent('transform');
      const viewBounds = this.camera.getViewBounds();
      
      if (playerTransform) {
        const playerScreenX = playerTransform.position.x - viewBounds.left;
        const playerScreenY = playerTransform.position.y - viewBounds.top;
        const lightRadius = 120;
        
        // 使用径向渐变实现人物周围的光圈
        // 创建一个临时 canvas 来绘制迷雾+光圈
        if (!this._fogCanvas) {
          this._fogCanvas = document.createElement('canvas');
        }
        // 每帧同步 fogCanvas 尺寸，确保全屏覆盖
        if (this._fogCanvas.width !== this.logicalWidth || this._fogCanvas.height !== this.logicalHeight) {
          this._fogCanvas.width = this.logicalWidth;
          this._fogCanvas.height = this.logicalHeight;
        }
        const fogCtx = this._fogCanvas.getContext('2d');
        
        // 先画满迷雾
        fogCtx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
        fogCtx.fillStyle = `${this.fog.color} ${this.fog.opacity})`;
        fogCtx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
        
        // 用 destination-out 在玩家位置挖出光圈
        fogCtx.globalCompositeOperation = 'destination-out';
        const gradient = fogCtx.createRadialGradient(
          playerScreenX, playerScreenY, 0,
          playerScreenX, playerScreenY, lightRadius
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.6)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        fogCtx.fillStyle = gradient;
        fogCtx.beginPath();
        fogCtx.arc(playerScreenX, playerScreenY, lightRadius, 0, Math.PI * 2);
        fogCtx.fill();
        fogCtx.globalCompositeOperation = 'source-over';
        
        // 将迷雾 canvas 绘制到主 canvas
        ctx.drawImage(this._fogCanvas, 0, 0);
      } else {
        // 没有玩家时直接画满迷雾
        ctx.fillStyle = `${this.fog.color} ${this.fog.opacity})`;
        ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
      }
      
      ctx.restore();
    }
  }

  /**
   * 渲染世界对象 - 覆盖父类，添加火堆渲染
   */
  renderWorldObjects(ctx) {
    // 创建渲染队列
    const renderQueue = [];
    
    // 添加实体到渲染队列
    for (const entity of this.entities) {
      const transform = entity.getComponent('transform');
      if (transform) {
        renderQueue.push({
          type: 'entity',
          y: transform.position.y,
          entity: entity
        });
      }
    }
    
    // 添加火堆到渲染队列（在移动阶段及之后显示）
    // 火堆在完成第一个提示后就应该显示，让玩家可以去点燃
    const showCampfire = this.tutorialPhase !== 'character_creation';
    if (showCampfire) {
      renderQueue.push({
        type: 'campfire_bottom',
        y: this.campfire.y,
        render: () => this.renderCampfireBottom(ctx)
      });
      
      renderQueue.push({
        type: 'campfire_top',
        y: this.campfire.y - 1,
        render: () => this.renderCampfireTop(ctx)
      });
    }
    
    // 按 Y 坐标排序
    renderQueue.sort((a, b) => a.y - b.y);
    
    // 按顺序渲染
    for (const item of renderQueue) {
      if (item.type === 'entity') {
        this.renderEntity(ctx, item.entity);
      } else if (item.render) {
        item.render();
      }
    }
    
    // 渲染气泡对话（在所有实体之上）
    this.renderSpeechBubbles(ctx);
  }

  /**
   * 渲染气泡对话（带尾巴的气泡）
   */
  renderSpeechBubbles(ctx) {
    if (this.speechBubbles.length === 0) return;
    
    ctx.save();
    
    for (const bubble of this.speechBubbles) {
      // 找到对应实体
      const entity = this.entities.find(e => e.id === bubble.entityId);
      if (!entity) continue;
      
      const transform = entity.getComponent('transform');
      if (!transform) continue;
      
      const sprite = entity.getComponent('sprite');
      const entityHeight = sprite?.height || 32;
      
      // 气泡位置（实体头顶上方）
      const bx = transform.position.x;
      const by = transform.position.y - entityHeight - 20;
      
      // 淡入淡出
      const fadeIn = Math.min(bubble.age / 0.3, 1);
      const fadeOut = Math.max(0, 1 - (bubble.age - (bubble.maxAge - 0.5)) / 0.5);
      const alpha = Math.min(fadeIn, fadeOut);
      
      // 气泡上浮效果
      const floatY = by - bubble.age * 8;
      
      ctx.globalAlpha = alpha;
      ctx.font = '11px Arial';
      const textWidth = ctx.measureText(bubble.text).width;
      const padX = 6;
      const padY = 4;
      const bw = textWidth + padX * 2;
      const bh = 18;
      const radius = 8;
      
      // 气泡背景（圆角矩形）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(bx - bw / 2 + radius, floatY - bh);
      ctx.lineTo(bx + bw / 2 - radius, floatY - bh);
      ctx.quadraticCurveTo(bx + bw / 2, floatY - bh, bx + bw / 2, floatY - bh + radius);
      ctx.lineTo(bx + bw / 2, floatY - radius);
      ctx.quadraticCurveTo(bx + bw / 2, floatY, bx + bw / 2 - radius, floatY);
      // 尾巴
      ctx.lineTo(bx + 4, floatY);
      ctx.lineTo(bx, floatY + 6);
      ctx.lineTo(bx - 4, floatY);
      ctx.lineTo(bx - bw / 2 + radius, floatY);
      ctx.quadraticCurveTo(bx - bw / 2, floatY, bx - bw / 2, floatY - radius);
      ctx.lineTo(bx - bw / 2, floatY - bh + radius);
      ctx.quadraticCurveTo(bx - bw / 2, floatY - bh, bx - bw / 2 + radius, floatY - bh);
      ctx.closePath();
      ctx.fill();
      
      // 气泡边框
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      
      // 文字
      ctx.fillStyle = '#333';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bubble.text, bx, floatY - bh / 2);
    }
    
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * 渲染火堆下半部分（木材下半部分和底部发光）
   */
  renderCampfireBottom(ctx) {
    // 直接使用世界坐标（已经应用了相机变换）
    // 火堆位置是底部中心点
    const x = this.campfire.x;
    const y = this.campfire.y;
    
    if (!this.campfire.lit) {
      // 渲染熄灭的火堆 - 木材堆（下半部分）
      // 绘制木材下半部分（使用裁剪）- 从中心线到底部
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 30, y - 15, 60, 15); // 只渲染中心线以下的部分（底部对齐）
      ctx.clip();
      
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      
      // 木材1 - 左下到右上（相对于底部中心）
      ctx.beginPath();
      ctx.moveTo(x - 20, y - 5);
      ctx.lineTo(x + 20, y - 25);
      ctx.stroke();
      
      // 木材2 - 右下到左上
      ctx.beginPath();
      ctx.moveTo(x + 20, y - 5);
      ctx.lineTo(x - 20, y - 25);
      ctx.stroke();
      
      // 木材3 - 水平
      ctx.beginPath();
      ctx.moveTo(x - 18, y - 15);
      ctx.lineTo(x + 18, y - 15);
      ctx.stroke();
      
      // 木材4 - 左侧斜
      ctx.strokeStyle = '#4a3a2a';
      ctx.beginPath();
      ctx.moveTo(x - 15, y - 7);
      ctx.lineTo(x - 5, y - 27);
      ctx.stroke();
      
      // 木材5 - 右侧斜
      ctx.beginPath();
      ctx.moveTo(x + 15, y - 7);
      ctx.lineTo(x + 5, y - 27);
      ctx.stroke();
      
      ctx.restore();
    } else {
      // 渲染点燃的火堆 - 下半部分
      // 绘制燃烧的木材底座下半部分（使用裁剪）
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 30, y - 15, 60, 15); // 只渲染中心线以下的部分
      ctx.clip();
      
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      
      // 木材轮廓（简化，因为火焰会覆盖大部分）
      ctx.beginPath();
      ctx.moveTo(x - 20, y - 5);
      ctx.lineTo(x + 20, y - 25);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(x + 20, y - 5);
      ctx.lineTo(x - 20, y - 25);
      ctx.stroke();
      
      ctx.restore();
      
      // 绘制火堆底部的发光效果（大范围）- 以底部中心为圆心
      const gradient = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, 60);
      gradient.addColorStop(0, 'rgba(255, 200, 0, 0.4)');
      gradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.2)');
      gradient.addColorStop(1, 'rgba(255, 50, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y - 15, 60, 0, Math.PI * 2);
      ctx.fill();
      
      // 绘制火堆中心的亮光
      const centerGlow = ctx.createRadialGradient(x, y - 15, 0, x, y - 15, 20);
      centerGlow.addColorStop(0, 'rgba(255, 255, 200, 0.6)');
      centerGlow.addColorStop(0.5, 'rgba(255, 150, 0, 0.3)');
      centerGlow.addColorStop(1, 'rgba(255, 100, 0, 0)');
      ctx.fillStyle = centerGlow;
      ctx.beginPath();
      ctx.arc(x, y - 15, 20, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 渲染火堆上半部分（木材上半部分和火焰图片）
   */
  renderCampfireTop(ctx) {
    // 直接使用世界坐标（已经应用了相机变换）
    // 火堆位置是底部中心点
    const x = this.campfire.x;
    const y = this.campfire.y;
    
    if (!this.campfire.lit) {
      // 渲染熄灭的火堆 - 木材上半部分
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 30, y - 45, 60, 30); // 只渲染中心线以上的部分（底部对齐）
      ctx.clip();
      
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      
      // 木材1 - 左下到右上
      ctx.beginPath();
      ctx.moveTo(x - 20, y - 5);
      ctx.lineTo(x + 20, y - 25);
      ctx.stroke();
      
      // 木材2 - 右下到左上
      ctx.beginPath();
      ctx.moveTo(x + 20, y - 5);
      ctx.lineTo(x - 20, y - 25);
      ctx.stroke();
      
      // 木材3 - 水平
      ctx.beginPath();
      ctx.moveTo(x - 18, y - 15);
      ctx.lineTo(x + 18, y - 15);
      ctx.stroke();
      
      // 木材4 - 左侧斜
      ctx.strokeStyle = '#4a3a2a';
      ctx.beginPath();
      ctx.moveTo(x - 15, y - 7);
      ctx.lineTo(x - 5, y - 27);
      ctx.stroke();
      
      // 木材5 - 右侧斜
      ctx.beginPath();
      ctx.moveTo(x + 15, y - 7);
      ctx.lineTo(x + 5, y - 27);
      ctx.stroke();
      
      ctx.restore();
      
      // 绘制提示文字（在火堆上方）
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      ctx.fillText('熄灭的火堆', x, y - 55);
      ctx.fillText('按 E 点燃', x, y - 40);
      ctx.shadowBlur = 0;
      
      return;
    }
    
    // 渲染点燃的火堆 - 上半部分
    // 绘制燃烧的木材上半部分（使用裁剪）
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 30, y - 45, 60, 30); // 只渲染中心线以上的部分
    ctx.clip();
    
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    
    // 木材轮廓（简化，因为火焰会覆盖大部分）
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 5);
    ctx.lineTo(x + 20, y - 25);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(x + 20, y - 5);
    ctx.lineTo(x - 20, y - 25);
    ctx.stroke();
    
    ctx.restore();
    
    // 绘制火焰帧动画（如果已加载）
    if (this.campfire.imageLoaded && this.campfire.fireImage) {
      // 计算当前帧在精灵图中的位置（4列3行布局）
      const col = this.campfire.currentFrame % this.campfire.frameCols;
      const row = Math.floor(this.campfire.currentFrame / this.campfire.frameCols);
      const frameX = col * this.campfire.frameWidth;
      const frameY = row * this.campfire.frameHeight;
      
      // 计算图片绘制位置和大小（缩小为50%）
      const fireWidth = 40;  // 原来80，现在40
      const fireHeight = 60; // 原来120，现在60
      const fireX = x - fireWidth / 2;
      const fireY = y - fireHeight - 5; // 火焰底部在火堆底部上方5像素
      
      // 绘制当前帧
      ctx.globalAlpha = 0.9;
      ctx.drawImage(
        this.campfire.fireImage,
        frameX, frameY, this.campfire.frameWidth, this.campfire.frameHeight, // 源矩形
        fireX, fireY, fireWidth, fireHeight // 目标矩形
      );
      ctx.globalAlpha = 1.0;
    }
  }

  /**
   * 渲染火堆（保留用于兼容，实际使用 renderCampfireBottom 和 renderCampfireTop）
   */
  renderCampfire(ctx) {
    this.renderCampfireBottom(ctx);
    this.renderCampfireTop(ctx);
  }

}

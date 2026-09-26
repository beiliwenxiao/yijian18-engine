/**
 * BaseGameScene - 游戏场景基类
 * 
 * 包含所有场景通用的基础功能：
 * - ECS 实体系统
 * - 输入管理
 * - 相机系统
 * - 移动系统
 * - 战斗系统
 * - UI 面板（背包、装备、人物信息）
 * - 粒子系统和特效
 * 
 * 第一幕和第二幕都继承此类
 */

import { PrologueScene } from './PrologueScene.js';
import { EntityFactory } from '../../../src/ecs/EntityFactory.js';
import { InputManager } from '../../../src/core/InputManager.js';
import UIClickHandler from '../../../src/core/UIClickHandler.js';
import { CombatSystem } from '../../../src/systems/CombatSystem.js';
import { MovementSystem } from '../../../src/systems/MovementSystem.js';
import { EquipmentSystem } from '../../../src/systems/EquipmentSystem.js';
import { AISystem } from '../../../src/systems/AISystem.js';
import { TutorialSystem } from '../../../src/systems/TutorialSystem.js';
import { DialogueSystem } from '../../../src/systems/DialogueSystem.js';
import { QuestSystem } from '../../../src/systems/QuestSystem.js';
import { IsometricRenderer } from '../../../src/rendering/IsometricRenderer.js';
import { CombatEffects } from '../../../src/rendering/CombatEffects.js';
import { SkillEffects } from '../../../src/rendering/SkillEffects.js';
import { InventoryPanel } from '../../../src/ui/InventoryPanel.js';
import { PlayerInfoPanel } from '../../../src/ui/PlayerInfoPanel.js';
import { BottomControlBar } from '../../../src/ui/BottomControlBar.js';
import { DialogueBox } from '../../../src/ui/DialogueBox.js';
import { FloatingTextManager } from '../../../src/ui/FloatingText.js';
import { ParticleSystem } from '../../../src/rendering/ParticleSystem.js';
import { WeaponRenderer } from '../../../src/rendering/WeaponRenderer.js';
import { EnemyWeaponRenderer } from '../../../src/rendering/EnemyWeaponRenderer.js';
import { FlightSystem } from '../../../src/systems/FlightSystem.js';
import { CollisionSystem } from '../../../src/systems/CollisionSystem.js';
import { PickupSystem } from '../../../src/systems/PickupSystem.js';
import { MeditationSystem } from '../../../src/systems/MeditationSystem.js';
import { MeleeAttackSystem } from '../../../src/systems/MeleeAttackSystem.js';
import { EntityLifecycleSystem } from '../../../src/systems/EntityLifecycleSystem.js';
import { Entity } from '../../../src/ecs/Entity.js';
import { TransformComponent } from '../../../src/ecs/components/TransformComponent.js';
import { SpriteComponent } from '../../../src/ecs/components/SpriteComponent.js';
import { NameComponent } from '../../../src/ecs/components/NameComponent.js';
import { PerformanceOptimizer } from '../../../src/systems/PerformanceOptimizer.js';
import { PerformanceMonitor } from '../../../src/core/PerformanceMonitor.js';
import { UISystem } from '../../../src/ui/UISystem.js';
import { PortraitsConfig } from '../data/PortraitsConfig.js';

export class BaseGameScene extends PrologueScene {
  constructor(actNumber, sceneData = {}) {
    super(actNumber, sceneData);
    
    // 标记为双后端感知，让 SceneManager 传入完整 backend
    this.__dualBackendAware = true;
    
    // 3D 渲染后端引用（由外部注入）
    this.renderBackend = null;
    
    // ECS 核心
    this.entityFactory = new EntityFactory();
    this.entities = [];
    
    // 逻辑尺寸（用于渲染计算，不受 devicePixelRatio 影响）
    this.logicalWidth = 800;
    this.logicalHeight = 600;
    
    // 核心系统
    this.inputManager = null;
    this.camera = null;
    this.combatSystem = null;
    this.movementSystem = null;
    this.equipmentSystem = null;
    this.aiSystem = null;
    this.isometricRenderer = null;  // 统一渲染器
    this.combatEffects = null;
    this.skillEffects = null;
    this.weaponRenderer = null;
    this.enemyWeaponRenderer = null;
    this.flightSystem = null;
    this.collisionSystem = null;
    this.pickupSystem = null;
    this.meditationSystem = null;
    
    // 扇形攻击系统（由 MeleeAttackSystem 管理）
    this.meleeAttackSystem = null;
    
    // 实体生命周期系统
    this.entityLifecycleSystem = new EntityLifecycleSystem();
    
    this.uiClickHandler = new UIClickHandler();
    
    // UI 系统（面板生命周期管理）
    this.uiSystem = new UISystem();
    
    // 性能优化系统
    this.performanceOptimizer = new PerformanceOptimizer({
      cellSize: 128,
      spatialGrid: true,
      batching: true,
      pooling: true,
      lod: true
    });
    this.performanceMonitor = new PerformanceMonitor({
      enabled: false,  // 默认关闭，按P键开启
      showGraph: false
    });
    
    // 序章系统
    this.tutorialSystem = new TutorialSystem();
    this.dialogueSystem = new DialogueSystem();
    this.questSystem = new QuestSystem();
    
    // UI 面板
    this.inventoryPanel = null;
    this.playerInfoPanel = null;
    this.bottomControlBar = null;
    this.dialogueBox = null;
    
    // 飘动文字管理器
    this.floatingTextManager = new FloatingTextManager();
    
    // 粒子系统
    this.particleSystem = new ParticleSystem(500);
    
    // 等距渲染器
    this.isometricRenderer = null;
    
    // 等距地图数据
    this.mapData = null;
    this.mapWidth = 30;  // 地图宽度（格子数）
    this.mapHeight = 30; // 地图高度（格子数）
    
    // 玩家实体
    this.playerEntity = null;
    
    // 敌人实体
    this.enemyEntities = [];
    
    // 可拾取物品
    this.pickupItems = [];
    this.equipmentItems = [];
    
    // 幕数据（从 ActXData.json 加载）
    this.actData = null;
    
    // 教程状态
    this.tutorialPhase = 'init';
    
    // 面板切换冷却时间
    this.lastPlayerInfoToggleTime = 0;
    this.lastInventoryToggleTime = 0;
    this.lastPickupTime = 0;
    this.lastPerformanceToggleTime = 0;
    
    // 对话控制标志
    this.lastSpacePressed = false;
    
    // 场景过渡状态
    this.isTransitioning = false;
    this.transitionAlpha = 0;
    this.transitionPhase = 'none'; // 'none', 'fade_out', 'show_text', 'switch_scene'
    this.transitionTimer = 0;
    this.transitionDuration = 2.0;
    this.textDisplayDuration = 3.0;
    this.transitionText = { main: '', sub: '' };
  }

  /**
   * 场景进入 - 初始化所有基础系统
   */
  enter(data = null) {
    super.enter(data);
    
    // 获取 canvas
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
      console.error('BaseGameScene: Canvas not found');
      return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // 用实际 canvas 尺寸覆盖默认逻辑尺寸
    if (canvas.width > 0 && canvas.height > 0) {
      this.logicalWidth = canvas.width;
      this.logicalHeight = canvas.height;
    }
    
    // 初始化统一渲染器（包含 Camera）
    this.isometricRenderer = new IsometricRenderer(ctx, {
      tileWidth: 64,
      tileHeight: 32,
      width: this.logicalWidth,
      height: this.logicalHeight,
      assetManager: this.assetManager || null,
      debug: false,
      showGrid: false,  // 关闭网格线
      gridSize: this.mapWidth
    });
    
    // 从渲染器获取相机
    this.camera = this.isometricRenderer.getCamera();
    
    // 生成等距地图
    this.generateIsometricMap();
    
    // 初始化输入管理器
    this.inputManager = new InputManager(canvas);
    
    // 初始化战斗特效
    this.combatEffects = new CombatEffects(this.particleSystem);
    
    // 初始化技能特效
    this.skillEffects = new SkillEffects(this.particleSystem);
    
    // 初始化武器渲染器
    this.weaponRenderer = new WeaponRenderer();
    
    // 初始化敌人武器渲染器
    this.enemyWeaponRenderer = new EnemyWeaponRenderer();
    
    // 初始化轻功飞行系统
    this.flightSystem = new FlightSystem({
      particleSystem: this.particleSystem,
      floatingTextManager: this.floatingTextManager,
      camera: this.camera
    });
    
    // 初始化游戏系统
    this.combatSystem = new CombatSystem({
      inputManager: this.inputManager,
      camera: this.camera,
      skillEffects: this.skillEffects,
      weaponRenderer: this.weaponRenderer,
      enemyWeaponRenderer: this.enemyWeaponRenderer,
      floatingTextManager: this.floatingTextManager
    });
    
    // 设置打坐技能回调
    this.combatSystem.onMeditationSkill = (skill) => {
      this.onSkillClicked(skill);
    };
    
    // 设置进入战斗回调（中断打坐）
    this.combatSystem.setOnEnterCombat(() => {
      if (this.meditationSystem.isActive()) {
        this.meditationSystem.stop();
      }
    });
    
    // 设置战斗脱离延迟为20秒（与原来一致）
    this.combatSystem.combatState.combatExitDelay = 20;
    
    // 设置药水快捷键回调
    this.combatSystem.onPotionUse = (potionType) => {
      this.usePotionFromHotbar(potionType);
    };
    
    // 设置掉落回调
    this.combatSystem.setLootDropCallback((position, lootItems) => {
      const lootEntities = this.pickupSystem.spawnLootItems(position, lootItems);
      for (const entity of lootEntities) {
        this.entities.push(entity);
        this.equipmentItems.push(entity);
      }
    });
    
    this.movementSystem = new MovementSystem({
      inputManager: this.inputManager,
      camera: this.camera
    });
    // 不设置地图边界，允许玩家自由移动
    
    this.equipmentSystem = new EquipmentSystem();
    
    // 初始化AI系统
    this.aiSystem = new AISystem();
    
    // 初始化碰撞系统
    this.collisionSystem = new CollisionSystem();
    
    // 初始化拾取系统
    this.pickupSystem = new PickupSystem();
    this.pickupSystem.init({
      inputManager: this.inputManager,
      floatingTextManager: this.floatingTextManager,
      weaponRenderer: this.weaponRenderer
    });
    
    // 初始化冥想系统
    this.meditationSystem = new MeditationSystem();
    this.meditationSystem.init({
      inputManager: this.inputManager,
      floatingTextManager: this.floatingTextManager,
      skillEffects: this.skillEffects,
      combatSystem: this.combatSystem
    });
    
    // 初始化近战攻击系统
    this.meleeAttackSystem = new MeleeAttackSystem();
    this.meleeAttackSystem.init({
      inputManager: this.inputManager,
      combatSystem: this.combatSystem,
      floatingTextManager: this.floatingTextManager
    });
    
    // 初始化 UI 面板
    this.initializeUIPanels();
    
    // 创建或继承玩家实体
    // 如果data中有playerEntity，则使用传入的实体（场景切换时）
    // 否则创建新的玩家实体
    if (data && data.playerEntity) {
      this.playerEntity = data.playerEntity;
      this.entities.push(this.playerEntity);
      console.log(`BaseGameScene: 继承玩家实体`, this.playerEntity);
      
      // 重新绑定UI面板到继承的玩家实体
      this.bindUIPanelsToPlayer();
    } else {
      this.createPlayerEntity();
      console.log(`BaseGameScene: 创建新玩家实体`);
    }
    
    console.log(`BaseGameScene: 进入场景 ${this.name}`);
    
    // 配置实体生命周期系统
    this.entityLifecycleSystem.protect(this.playerEntity);
    this.entityLifecycleSystem.trackList(this.enemyEntities);
    this.entityLifecycleSystem.setOnBeforeRemove((entity) => {
      // 处理武器钉住状态
      if (entity.pinnedByWeapon && this.weaponRenderer) {
        entity.pinnedByWeapon = false;
        if (this.weaponRenderer.thrownWeapon.targetEntity === entity) {
          this.weaponRenderer.thrownWeapon.targetEntity = null;
        }
      }
    });
    
    // 异步加载幕数据（从 ActXData.json）
    this.loadActData();
    
    // 注册快捷键
    this.registerHotkeys();
  }

  /**
   * 注册通用快捷键
   */
  registerHotkeys() {
    // 人物信息面板切换 (C)
    this.inputManager.registerHotkey('toggle_playerinfo', ['c', 'C'], () => {
      this.playerInfoPanel.toggle();
    }, { cooldown: 300 });
    
    // 背包面板切换 (B)
    this.inputManager.registerHotkey('toggle_inventory', ['b', 'B'], () => {
      this.inventoryPanel.toggle();
    }, { cooldown: 300 });
    
    // 性能监控切换 (P)
    this.inputManager.registerHotkey('toggle_performance', ['p', 'P'], () => {
      this.performanceMonitor.toggle();
      console.log('性能监控:', this.performanceMonitor.enabled ? '开启' : '关闭');
    }, { cooldown: 300 });
  }

  /**
   * 异步加载幕数据
   * 从 ActXData.json 加载当前幕的配置数据
   */
  loadActData() {
    const actNumber = this.actNumber;
    const url = `data/Act${actNumber}Data.json`;
    
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        this.actData = data;
        console.log(`BaseGameScene: 加载幕数据成功 Act${actNumber}`, data);
      })
      .catch(error => {
        console.warn(`BaseGameScene: 加载幕数据失败 Act${actNumber}`, error);
        this.actData = null;
      });
  }

  /**
   * 加载火焰图片
   */
  loadFireImage() {
    if (!this.campfire) return;
    this.campfire.fireImage = new Image();
    this.campfire.fireImage.onload = () => {
      this.campfire.imageLoaded = true;
      console.log('BaseGameScene: 火焰图片加载成功');
    };
    this.campfire.fireImage.onerror = () => {
      console.warn('BaseGameScene: 火焰图片加载失败');
      this.campfire.imageLoaded = false;
    };
    this.campfire.fireImage.src = 'assets/images/fire.webp';
  }


  /**
   * 初始化 UI 面板
   */
  initializeUIPanels() {
    // 角色信息面板（包含装备）- 左下角，底部控制栏上方
    this.playerInfoPanel = new PlayerInfoPanel({
      x: 10,
      y: this.logicalHeight - 100 - 580,
      width: 320,
      height: 580,
      visible: false,
      onAttributeAllocate: (player) => {
        console.log('BaseGameScene: 属性加点按钮被点击');
      },
      onEquipmentClick: (slotType, button) => {
        console.log('BaseGameScene: 装备槽被点击', slotType, button);
        // 右键点击卸下装备
        if (button === 'right' && this.playerEntity) {
          const equipment = this.playerEntity.getComponent('equipment');
          if (equipment && equipment.slots[slotType]) {
            this.equipmentSystem.unequip(this.playerEntity, slotType);
            // 显示卸下装备的提示
            const transform = this.playerEntity.getComponent('transform');
            if (transform) {
              this.floatingTextManager.addText(
                transform.position.x,
                transform.position.y - 30,
                `卸下 ${equipment.slots[slotType].name}`,
                '#ffff00'
              );
            }
          }
        }
      }
    });
    
    // 背包面板 - 右下角，底部控制栏上方
    this.inventoryPanel = new InventoryPanel({
      x: this.logicalWidth - 370 - 10,
      y: this.logicalHeight - 100 - 350,
      width: 370,
      height: 350,
      visible: false,
      onItemUse: (item, healAmount, manaAmount) => {
        this.onItemUsed(item, healAmount, manaAmount);
      },
      onEquipmentChange: (messages) => {
        this.onEquipmentChanged(messages);
      }
    });
    
    // 底部控制栏
    this.bottomControlBar = new BottomControlBar({
      x: 0,
      y: this.logicalHeight - 100,
      width: this.logicalWidth,
      height: 100,
      visible: true,
      onSkillClick: (skill) => {
        this.onSkillClicked(skill);
      },
      onPotionUse: (potionType) => {
        this.usePotionFromHotbar(potionType);
      }
    });
    
    // 对话框 - 居中显示
    const dialogueBoxWidth = 700;
    const dialogueBoxHeight = 230;
    this.dialogueBox = new DialogueBox({
      x: (this.logicalWidth - dialogueBoxWidth) / 2,
      y: (this.logicalHeight - dialogueBoxHeight) / 2,
      width: dialogueBoxWidth,
      height: dialogueBoxHeight,
      visible: false,
      zIndex: 200,
      dialogueSystem: this.dialogueSystem,
      portraits: PortraitsConfig,
      onDialogueEnd: () => {
        console.log('BaseGameScene: 对话结束');
      }
    });
    
    // 注册 UI 元素到 UIClickHandler
    this.uiClickHandler.registerElement(this.inventoryPanel);
    this.uiClickHandler.registerElement(this.playerInfoPanel);
    this.uiClickHandler.registerElement(this.bottomControlBar);
    this.uiClickHandler.registerElement(this.dialogueBox);
    
    // 注册面板到 UISystem（统一管理悬停等）
    this.uiSystem.registerPanel('inventory', this.inventoryPanel);
    this.uiSystem.registerPanel('playerInfo', this.playerInfoPanel);
    this.uiSystem.registerPanel('bottomControl', this.bottomControlBar);
    this.uiSystem.registerPanel('dialogue', this.dialogueBox);
  }

  /**
   * 物品使用回调
   */
  onItemUsed(item, healAmount, manaAmount) {
    if (this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        if (healAmount > 0) {
          this.floatingTextManager.addHeal(transform.position.x, transform.position.y - 30, healAmount);
        }
        if (manaAmount > 0) {
          this.floatingTextManager.addManaRestore(transform.position.x, transform.position.y - 50, manaAmount);
        }
      }
    }
  }

  /**
   * 装备变化回调
   * @param {Array} messages - 消息数组
   */
  onEquipmentChanged(messages) {
    if (!messages || messages.length === 0) return;
    
    if (this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        // 显示每条消息
        let yOffset = -30;
        for (const message of messages) {
          this.floatingTextManager.addText(
            transform.position.x, 
            transform.position.y + yOffset, 
            message,
            message.includes('+') ? '#00ff00' : (message.includes('-') ? '#ff6666' : '#ffff00')
          );
          yOffset -= 25;
        }
      }
    }
    
    console.log('BaseGameScene: 装备变化', messages);
  }

  /**
   * 技能点击回调
   * @param {Object} skill - 技能对象
   */
  onSkillClicked(skill) {
    console.log('BaseGameScene: 技能点击', skill);
    
    if (!this.playerEntity || !this.combatSystem) return;
    
    // 特殊处理：打坐技能
    if (skill.id === 'meditation') {
      // 检查是否在战斗中
      if (this.combatSystem.isInCombat()) {
        if (this.floatingTextManager) {
          const transform = this.playerEntity.getComponent('transform');
          if (transform) {
            this.floatingTextManager.addText(
              transform.position.x,
              transform.position.y - 50,
              '战斗中无法打坐',
              '#ff6666'
            );
          }
        }
        return;
      }
      
      // 切换打坐状态
      if (this.meditationSystem.isActive()) {
        this.meditationSystem.stop();
      } else {
        this.meditationSystem.start(this.playerEntity);
      }
      return;
    }
    
    // 特殊处理：治疗技能（自己释放）
    if (skill.id === 'heal') {
      const combat = this.playerEntity.getComponent('combat');
      const currentTime = performance.now();
      
      if (combat && combat.canUseSkill(skill.id, currentTime)) {
        this.combatSystem.tryUseSkillAtPosition(
          this.playerEntity,
          skill,
          this.playerEntity.getComponent('transform').position,
          currentTime,
          this.entities
        );
      }
      return;
    }
    
    // 其他技能：使用鼠标位置作为目标
    const mouseWorldPos = this.inputManager.getMouseWorldPosition(this.camera);
    const currentTime = performance.now();
    
    this.combatSystem.tryUseSkillAtPosition(
      this.playerEntity,
      skill,
      mouseWorldPos,
      currentTime,
      this.entities
    );
  }

  /**
   * 从快捷栏使用药水
   * @param {string} potionType - 'health' 或 'mana'
   */
  usePotionFromHotbar(potionType) {
    if (!this.playerEntity) return;
    
    const inventory = this.playerEntity.getComponent('inventory');
    const stats = this.playerEntity.getComponent('stats');
    if (!inventory || !stats) return;
    
    const effectType = potionType === 'health' ? 'heal' : 'restore_mana';
    
    // 在背包中查找对应效果的消耗品
    const items = inventory.getAllItems();
    let potionSlotIndex = -1;
    
    for (const { slot, index } of items) {
      if (slot.item && slot.item.type === 'consumable' && slot.item.usable &&
          slot.item.effect && slot.item.effect.type === effectType) {
        potionSlotIndex = index;
        break;
      }
    }
    
    if (potionSlotIndex === -1) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform && this.floatingTextManager) {
        const name = potionType === 'health' ? '生命药水' : '魔法药水';
        this.floatingTextManager.addText(
          transform.position.x,
          transform.position.y - 50,
          `没有${name}`,
          '#ff6666'
        );
      }
      return;
    }
    
    // 复用 InventoryPanel 的使用逻辑
    if (this.inventoryPanel) {
      this.inventoryPanel.useItem(potionSlotIndex);
    }
  }

  /**
   * 生成等距地图
   */
  /**
   * 窗口大小变化时更新逻辑尺寸和相关系统
   * @param {number} width - 新宽度
   * @param {number} height - 新高度
   */
  onResize(width, height) {
    this.logicalWidth = width;
    this.logicalHeight = height;
    
    if (this.isometricRenderer) {
      this.isometricRenderer.canvasWidth = width;
      this.isometricRenderer.canvasHeight = height;
    }
    if (this.camera) {
      this.camera.width = width;
      this.camera.height = height;
    }
    
    // 更新底部控制栏位置
    if (this.bottomControlBar) {
      this.bottomControlBar.width = width;
      this.bottomControlBar.x = 0;
      this.bottomControlBar.y = height - this.bottomControlBar.height;
      
      // 重新计算槽位居中
      const slotSize = this.bottomControlBar.skillSlots[0]?.size || 40;
      const slotGap = 6;
      const totalSlots = this.bottomControlBar.skillSlots.length;
      const totalWidth = totalSlots * slotSize + (totalSlots - 1) * slotGap;
      const startX = width / 2 - totalWidth / 2 + slotSize / 2;
      for (let i = 0; i < totalSlots; i++) {
        this.bottomControlBar.skillSlots[i].x = startX + i * (slotSize + slotGap);
      }
      
      // 重新计算红蓝球位置（紧贴技能槽两侧）
      const orbRadius = this.bottomControlBar.hpOrb.radius;
      const orbGap = 10;
      const slotsLeftEdge = width / 2 - totalWidth / 2;
      const slotsRightEdge = width / 2 + totalWidth / 2;
      this.bottomControlBar.hpOrb.x = slotsLeftEdge - orbGap - orbRadius;
      this.bottomControlBar.mpOrb.x = slotsRightEdge + orbGap + orbRadius;
    }
    
    // 更新角色信息面板位置（左下角，底部控制栏上方）
    if (this.playerInfoPanel) {
      this.playerInfoPanel.x = 10;
      this.playerInfoPanel.y = height - 100 - this.playerInfoPanel.height;
    }
    
    // 更新背包面板位置（右下角，底部控制栏上方）
    if (this.inventoryPanel) {
      this.inventoryPanel.x = width - this.inventoryPanel.width - 10;
      this.inventoryPanel.y = height - 100 - this.inventoryPanel.height;
    }
  }

  generateIsometricMap() {
    // 创建地图数据（2D数组）
    // 图块类型：0=空, 1=草地, 2=泥土, 3=石头, 4=水, 5=沙地
    this.mapData = [];
    
    for (let y = 0; y < this.mapHeight; y++) {
      const row = [];
      for (let x = 0; x < this.mapWidth; x++) {
        // 生成地形
        let tileType = 1; // 默认草地
        
        // 边缘用石头
        if (x === 0 || y === 0 || x === this.mapWidth - 1 || y === this.mapHeight - 1) {
          tileType = 3;
        }
        // 随机添加一些变化
        else if (Math.random() < 0.1) {
          tileType = 2; // 泥土
        }
        else if (Math.random() < 0.05) {
          tileType = 5; // 沙地
        }
        
        row.push(tileType);
      }
      this.mapData.push(row);
    }
    
    // 设置地图数据到等距渲染器
    if (this.isometricRenderer) {
      this.isometricRenderer.setMapData(this.mapData, null);
    }
    
    console.log('BaseGameScene: 生成等距地图', this.mapWidth, 'x', this.mapHeight);
  }

  /**
   * 创建玩家实体 - 子类可覆盖
   */
  createPlayerEntity() {
    // 玩家初始位置在火堆附近（火堆位置是 350, 250）
    const startX = 420;  // 火堆x + 70
    const startY = 330;  // 火堆y + 80
    
    this.playerEntity = this.entityFactory.createPlayer({
      name: '玩家',
      class: 'refugee',
      level: 1,
      position: { x: startX, y: startY },
      stats: {
        maxHp: 150,
        hp: 150,
        maxMp: 100,
        mp: 100,
        attack: 15,
        defense: 8,
        speed: 120
      },
      skills: [
        { 
          id: 'flame_palm', 
          name: '火焰掌', 
          type: 'magic', 
          damageMin: 30,
          damageMax: 100,
          splashDamageMin: 5,
          splashDamageMax: 20,
          splashCount: 8,
          manaCost: 15, 
          cooldown: 3.0, 
          range: 400, 
          effectType: 'flame_palm', 
          projectileSpeed: 450, 
          hotkey: '1' 
        },
        { 
          id: 'ice_finger', 
          name: '寒冰指', 
          type: 'magic', 
          damageMin: 20,
          damageMax: 50,
          finalDamageMin: 50,
          finalDamageMax: 120,
          manaCost: 12, 
          cooldown: 3.0, 
          range: 550, 
          effectType: 'ice_finger', 
          projectileSpeed: 600, 
          hotkey: '2' 
        },
        { 
          id: 'inferno_palm', 
          name: '烈焰掌', 
          type: 'magic', 
          damageMin: 50,
          damageMax: 200,
          projectileCount: 5,
          manaCost: 25, 
          cooldown: 10.0, 
          range: 450, 
          effectType: 'inferno_palm', 
          projectileSpeed: 400, 
          hotkey: '3' 
        },
        { 
          id: 'heal', 
          name: '治疗', 
          type: 'heal', 
          healAmount: 50,
          manaCost: 20, 
          cooldown: 20.0, 
          range: 0, 
          effectType: 'heal', 
          hotkey: '4' 
        },
        { 
          id: 'meditation', 
          name: '打坐', 
          type: 'channel', 
          healPerSecond: 0.1,
          manaPerSecond: 0.1,
          manaCost: 0, 
          cooldown: 5.0, 
          range: 0, 
          effectType: 'meditation', 
          hotkey: '5',
          requiresNonCombat: true
        }
      ],
      equipment: {},
      inventory: []
    });
    
    this.entities.push(this.playerEntity);
    
    // 调试：检查精灵组件
    const sprite = this.playerEntity.getComponent('sprite');
    console.log('BaseGameScene: 玩家精灵组件', {
      spriteSheet: sprite?.spriteSheet,
      useDirectionalSprite: sprite?.useDirectionalSprite,
      direction: sprite?.direction,
      width: sprite?.width,
      height: sprite?.height
    });
    
    // 设置相机跟随玩家
    const transform = this.playerEntity.getComponent('transform');
    if (transform) {
      this.camera.setTarget(transform);
    }
    
    // 设置各系统的玩家实体
    this.combatSystem.setPlayerEntity(this.playerEntity);
    this.movementSystem.setPlayerEntity(this.playerEntity);
    this.inventoryPanel.setEntity(this.playerEntity);
    this.playerInfoPanel.setPlayer(this.playerEntity);
    this.bottomControlBar.setEntity(this.playerEntity);
    
    console.log('BaseGameScene: 创建玩家实体', this.playerEntity);
  }

  /**
   * 绑定UI面板到玩家实体
   */
  bindUIPanelsToPlayer() {
    if (!this.playerEntity) return;
    
    // 设置相机跟随玩家
    const transform = this.playerEntity.getComponent('transform');
    if (transform && this.camera) {
      this.camera.setTarget(transform);
      // 立即设置相机位置到玩家位置，避免初始时的视野偏移
      this.camera.setPosition(transform.position.x, transform.position.y);
    }
    
    // 设置各系统的玩家实体
    if (this.combatSystem) {
      this.combatSystem.setPlayerEntity(this.playerEntity);
    }
    if (this.movementSystem) {
      this.movementSystem.setPlayerEntity(this.playerEntity);
    }
    if (this.inventoryPanel) {
      this.inventoryPanel.setEntity(this.playerEntity);
    }
    if (this.playerInfoPanel) {
      this.playerInfoPanel.setPlayer(this.playerEntity);
    }
    if (this.bottomControlBar) {
      this.bottomControlBar.setEntity(this.playerEntity);
    }
    
    console.log('BaseGameScene: UI面板已绑定到玩家实体');
  }


  /**
   * 更新场景
   */
  update(deltaTime) {
    if (!this.isActive || this.isPaused) return;
    
    // 性能监控：开始计时
    const updateStartTime = performance.now();
    
    // 调试：输出update调用
    if (this._debugNextUpdate) {
      console.log('【更新】update方法被调用, deltaTime=', deltaTime);
      this._debugNextUpdate = false;
    }
    
    // 更新场景过渡
    if (this.isTransitioning) {
      this.updateTransition(deltaTime);
      // 过渡期间不更新其他逻辑
      if (this.transitionPhase === 'show_text' || this.transitionPhase === 'switch_scene') {
        return;
      }
    }
    
    // 更新性能优化器
    this.performanceOptimizer.update();
    
    // 更新空间分区网格
    this.performanceOptimizer.updateSpatialGrid(this.entities);
    
    // 更新相机
    this.camera.update(deltaTime);
    
    // 更新武器渲染器的鼠标角度（保留用于攻击范围计算）
    if (this.weaponRenderer && this.playerEntity && this.inputManager) {
      const mouseWorldPos = this.inputManager.getMouseWorldPosition(this.camera);
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        const currentTime = performance.now() / 1000;
        const sprite = this.playerEntity.getComponent('sprite');
        const spriteHeight = sprite?.height || 64;
        const playerCenter = {
          x: transform.position.x,
          y: transform.position.y - spriteHeight / 2
        };
        this.weaponRenderer.updateMouseAngle(mouseWorldPos, playerCenter, currentTime);
        
        // 水果忍者式滑动攻击检测（通过 MeleeAttackSystem）
        this.meleeAttackSystem.setPlayerEntity(this.playerEntity);
        this.meleeAttackSystem.setEntities(this.entities);
        this.meleeAttackSystem.update(mouseWorldPos, playerCenter, currentTime);
      }
    }
    
    // 更新所有实体
    for (const entity of this.entities) {
      entity.update(deltaTime);
    }
    
    // UI 点击处理
    this.handleUIClick();
    
    // 处理Ctrl+鼠标左键瞬移
    this.handleTeleport();
    
    // 更新轻功飞行系统
    if (this.flightSystem && this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        this.flightSystem.update(deltaTime, transform);
      }
    }
    
    // 更新移动系统（打坐时禁止玩家移动）
    if (this.meditationSystem.isActive() && this.playerEntity) {
      // 打坐时只更新非玩家实体
      const nonPlayerEntities = this.entities.filter(e => e !== this.playerEntity);
      this.movementSystem.update(deltaTime, nonPlayerEntities);
      
      // 移动中断检测由 meditationSystem.update 处理
    } else {
      // 正常更新所有实体
      this.movementSystem.update(deltaTime, this.entities);
    }
    
    // 检查实体之间的碰撞
    this.collisionSystem.update(this.entities);
    
    // 处理敌人选中
    this.handleEnemySelection();
    
    // 更新AI系统（使用节流）
    if (this.performanceOptimizer.shouldUpdate('ai')) {
      this.aiSystem.update(deltaTime, this.entities, this.combatSystem);
    }
    
    // 更新战斗系统
    this.combatSystem.update(deltaTime, this.entities);
    
    // 更新战斗状态（通过 CombatSystem）
    this.combatSystem.updateCombatState(deltaTime, this.entities);
    
    // 更新打坐状态（通过冥想系统）
    this.meditationSystem.update(deltaTime, this.playerEntity);
    
    // 更新装备系统
    this.equipmentSystem.update(deltaTime, this.entities);
    
    // 更新序章系统
    this.tutorialSystem.update(deltaTime, this.getGameState());
    this.dialogueSystem.update(deltaTime);
    this.questSystem.update(deltaTime);
    
    // 更新特效（使用节流）
    if (this.performanceOptimizer.shouldUpdate('effects')) {
      this.combatEffects.update(deltaTime);
      this.skillEffects.update(deltaTime);
    }
    this.floatingTextManager.update(deltaTime);
    this.particleSystem.update(deltaTime);
    
    // 更新武器渲染器
    if (this.weaponRenderer) {
      const currentTime = performance.now() / 1000; // 转换为秒
      this.weaponRenderer.update(deltaTime, currentTime);
    }
    
    // 更新敌人武器渲染器
    if (this.enemyWeaponRenderer) {
      this.enemyWeaponRenderer.update(deltaTime);
      
      // 检查武器飞行路径上的碰撞
      if (this.weaponRenderer.thrownWeapon.flying) {
        this.weaponRenderer.checkThrowPathCollision(this.entities, (enemy, isFinalTarget) => {
          // 计算伤害
          const stats = this.playerEntity.getComponent('stats');
          if (!stats) return;
          
          const baseDamage = stats.attack || 15;
          let damageMultiplier = 0.3; // 路径上的敌人30%伤害
          let damageText = '投掷伤害 30%';
          let damageColor = '#ffaa00';
          
          if (isFinalTarget) {
            damageMultiplier = 3.0; // 最终目标300%伤害
            damageText = '投掷伤害 300%';
            damageColor = '#ff0000';
          }
          
          const finalDamage = Math.floor(baseDamage * damageMultiplier);
          
          // 计算击退方向
          const playerTransform = this.playerEntity.getComponent('transform');
          const enemyTransform = enemy.getComponent('transform');
          if (playerTransform && enemyTransform) {
            const dx = enemyTransform.position.x - playerTransform.position.x;
            const dy = enemyTransform.position.y - playerTransform.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const knockbackDir = distance > 0 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
            
            // 应用伤害
            this.combatSystem.applyDamage(enemy, finalDamage, knockbackDir);
            
            // 显示伤害提示
            this.floatingTextManager.addText(
              enemyTransform.position.x,
              enemyTransform.position.y - 60,
              damageText,
              damageColor
            );
          }
        });
      }
      
      // 检查武器拾取
      if (this.weaponRenderer.isWeaponThrown() && !this.weaponRenderer.thrownWeapon.flying) {
        this.pickupSystem.checkWeaponPickup(this.playerEntity);
      }
    }
    
    // 检查空格键继续对话
    this.checkDialogueContinue();
    
    // 更新面板（使用节流）
    if (this.performanceOptimizer.shouldUpdate('ui')) {
      this.inventoryPanel.update(deltaTime);
      this.playerInfoPanel.update(deltaTime);
      this.bottomControlBar.update(deltaTime);
    }
    
    // 更新对话框 - 根据对话系统状态显示/隐藏
    if (this.dialogueBox && this.dialogueSystem) {
      const isDialogueActive = this.dialogueSystem.isDialogueActive();
      if (isDialogueActive && !this.dialogueBox.visible) {
        this.dialogueBox.show();
      } else if (!isDialogueActive && this.dialogueBox.visible) {
        this.dialogueBox.hide();
      }
      this.dialogueBox.update(deltaTime);
    }
    
    // 更新鼠标悬停状态
    this.updatePanelHover();
    
    // 检查拾取（使用拾取系统）
    const pickupResult = this.pickupSystem.update(
      this.playerEntity, this.pickupItems, this.equipmentItems, this.entities
    );
    // 移除已拾取的掉落物实体
    for (const removed of pickupResult.removedEntities) {
      this.entities = this.entities.filter(e => e !== removed);
    }
    
    // 移除死亡实体
    this.removeDeadEntities();
    
    // 更新输入管理器
    this.inputManager.update();
    
    // 性能监控：结束计时并更新
    const updateEndTime = performance.now();
    const updateTime = updateEndTime - updateStartTime;
    
    // 更新性能监控器
    this.performanceMonitor.update(deltaTime, {
      entityCount: this.entities.length,
      visibleEntityCount: this.isometricRenderer ? this.isometricRenderer.cullEntities(this.entities).length : 0,
      particleCount: this.particleSystem.getActiveCount(),
      poolStats: this.performanceOptimizer.getPoolStats(),
      updateTime: updateTime
    });
  }

  /**
   * 开始场景过渡
   */
  startTransition(mainText = '场景切换中...', subText = '') {
    console.log('BaseGameScene: 开始场景过渡');
    this.isTransitioning = true;
    this.transitionPhase = 'fade_out';
    this.transitionTimer = 0;
    this.transitionAlpha = 0;
    this.transitionText = { main: mainText, sub: subText };
  }

  /**
   * 更新场景过渡
   */
  updateTransition(deltaTime) {
    this.transitionTimer += deltaTime;
    
    if (this.transitionPhase === 'fade_out') {
      this.transitionAlpha = Math.min(1, this.transitionTimer / this.transitionDuration);
      if (this.transitionAlpha >= 1) {
        this.transitionPhase = 'show_text';
        this.transitionTimer = 0;
      }
    } else if (this.transitionPhase === 'show_text') {
      if (this.transitionTimer >= this.textDisplayDuration) {
        this.transitionPhase = 'switch_scene';
        this.switchToNextScene();
      }
    }
  }

  /**
   * 渲染场景过渡
   */
  renderTransition(ctx) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${this.transitionAlpha})`;
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    
    if (this.transitionPhase === 'show_text') {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(this.transitionText.main, this.logicalWidth / 2, this.logicalHeight / 2 - 30);
      
      if (this.transitionText.sub) {
        ctx.font = '24px Arial';
        ctx.fillText(this.transitionText.sub, this.logicalWidth / 2, this.logicalHeight / 2 + 30);
      }
    }
    
    ctx.restore();
  }

  /**
   * 处理 UI 点击
   */
  handleUIClick() {
    if (this.inputManager.isMouseClicked() && !this.inputManager.isMouseClickHandled()) {
      const mousePos = this.inputManager.getMousePosition();
      const button = this.inputManager.getMouseButton() === 2 ? 'right' : 'left';
      
      // 如果对话激活，优先处理对话框点击
      if (this.dialogueSystem && this.dialogueSystem.isDialogueActive()) {
        // 检查是否点击在对话框内
        if (this.dialogueBox && this.dialogueBox.visible) {
          const dialogueHandled = this.dialogueBox.handleMouseClick(mousePos.x, mousePos.y, button);
          if (dialogueHandled) {
            this.inputManager.markMouseClickHandled();
            return;
          }
        }
        // 对话激活时，即使点击在对话框外也阻止移动
        this.inputManager.markMouseClickHandled();
        return;
      }
      
      const uiHandled = this.uiClickHandler.handleClick(mousePos.x, mousePos.y, button);
      
      if (uiHandled) {
        this.inputManager.markMouseClickHandled();
      } else if (button === 'left') {
        // UI 没有处理点击
        // 检查是否按住Shift键 - 如果是，则投掷武器
        const shiftPressed = this.inputManager.isKeyDown('shift');
        if (shiftPressed) {
          this.handleWeaponThrow();
        }
        // 否则，左键为攻击（由 MeleeAttackSystem 处理），右键移动由 MovementSystem 处理
      }
    }
  }

  /**
   * 处理Ctrl+鼠标左键轻功
   */
  handleTeleport() {
    if (!this.inputManager.isCtrlClick() || this.inputManager.isMouseClickHandled()) {
      return;
    }
    
    // 如果正在飞行中，不允许再次触发
    if (this.flightSystem && this.flightSystem.isPlayerFlying()) {
      this.inputManager.markMouseClickHandled();
      return;
    }
    
    if (!this.playerEntity || !this.camera) return;
    
    const transform = this.playerEntity.getComponent('transform');
    if (!transform) return;
    
    try {
      console.log('=== 轻功开始 ===');
      
      // 获取鼠标屏幕坐标
      const mouseScreenPos = this.inputManager.getMousePosition();
      
      // 使用相机的screenToWorld方法转换坐标
      const mouseWorld = this.camera.screenToWorld(mouseScreenPos.x, mouseScreenPos.y);
      
      // 使用飞行系统开始飞行
      if (this.flightSystem) {
        const success = this.flightSystem.startFlight(transform, mouseWorld.x, mouseWorld.y);
        if (success) {
          // 标记点击已处理
          this.inputManager.markMouseClickHandled();
        }
      }
      
    } catch (error) {
      console.error('轻功过程中发生错误:', error);
      console.error('错误堆栈:', error.stack);
      // 即使出错也要标记点击已处理，避免重复触发
      this.inputManager.markMouseClickHandled();
    }
  }
  
  /**
   * 处理武器投掷
   */
  handleWeaponThrow() {
    if (!this.weaponRenderer || !this.playerEntity) return;
    
    // 检查是否已经投掷了武器
    if (this.weaponRenderer.isWeaponThrown()) {
      return;
    }
    
    // 检查是否有主手武器
    const equipment = this.playerEntity.getComponent('equipment');
    if (!equipment || !equipment.slots.mainhand) {
      return;
    }
    
    // 获取鼠标世界坐标
    const mouseWorldPos = this.inputManager.getMouseWorldPosition(this.camera);
    
    // 查找点击位置的敌人（作为最终目标）
    const clickedEnemy = this.combatSystem.findEnemyAtPosition(mouseWorldPos, this.entities);
    
    // 获取玩家位置
    const playerTransform = this.playerEntity.getComponent('transform');
    if (!playerTransform) return;
    
    // 确定投掷目标位置
    let targetPos = mouseWorldPos;
    if (clickedEnemy) {
      const targetTransform = clickedEnemy.getComponent('transform');
      if (targetTransform) {
        targetPos = targetTransform.position;
      }
    }
    
    // 投掷武器
    const success = this.weaponRenderer.throwWeapon(
      this.playerEntity,
      clickedEnemy, // 可能为null
      playerTransform.position,
      targetPos,
      performance.now() / 1000 // 当前时间（秒）
    );
    
    if (success) {
      console.log('BaseGameScene: 武器投掷成功', clickedEnemy ? '目标敌人' : '自由投掷');
      this.inputManager.markMouseClickHandled();
    }
  }


  handleEnemySelection() {
    // 不再需要选中敌人，使用滑动攻击
  }

  /**
   * 处理自动攻击（鼠标移动时）
   * @param {number} currentTime - 当前时间（秒）
   */
  handleAutoAttack(currentTime) {
    if (!this.combatSystem || !this.playerEntity || !this.weaponRenderer) return;
    
    // 如果武器被投掷出去，不能进行自动攻击
    if (this.weaponRenderer.isWeaponThrown()) {
      return;
    }
    
    // 如果武器被禁用（武器碰撞失败），不能进行自动攻击
    if (this.weaponRenderer.disabled && this.weaponRenderer.disabled.active) {
      const now = performance.now();
      if (now < this.weaponRenderer.disabled.endTime) {
        return;
      } else {
        this.weaponRenderer.disabled.active = false;
      }
    }
    
    // 获取攻击类型和速度
    const attackTypeName = this.weaponRenderer.getAttackTypeName();
    const speedKmh = this.weaponRenderer.mouseMovement.speedKmh;
    
    // 检查速度阈值
    // 扫击：速度小于3km/h不产生伤害
    // 刺击：速度小于3km/h不产生伤害
    const minSpeed = 3;
    
    if (speedKmh < minSpeed) {
      // 速度太慢，攻击无效
      // 清空移动记录，但不消耗武器冷却时间
      this.weaponRenderer.mouseMovement.movements = [];
      this.weaponRenderer.mouseMovement.thrustMovements = 0;
      this.weaponRenderer.mouseMovement.sweepMovements = 0;
      this.weaponRenderer.mouseMovement.totalDistance = 0;
      this.weaponRenderer.mouseMovement.movementsPerSecond = 0;
      this.weaponRenderer.mouseMovement.lastAttackTime = currentTime;
      return;
    }
    
    // 获取攻击范围
    const attackRange = this.weaponRenderer.getAttackRange(this.playerEntity);
    
    // 获取玩家位置
    const transform = this.playerEntity.getComponent('transform');
    if (!transform) return;
    
    // 获取攻击范围内的所有敌人
    const enemiesInRange = this.weaponRenderer.getEnemiesInRange(
      transform.position, 
      this.entities, 
      attackRange
    );
    
    if (enemiesInRange.length === 0) {
      // 没有敌人，攻击无效
      // 清空移动记录，但不消耗武器冷却时间
      this.weaponRenderer.mouseMovement.movements = [];
      this.weaponRenderer.mouseMovement.thrustMovements = 0;
      this.weaponRenderer.mouseMovement.sweepMovements = 0;
      this.weaponRenderer.mouseMovement.totalDistance = 0;
      this.weaponRenderer.mouseMovement.movementsPerSecond = 0;
      this.weaponRenderer.mouseMovement.lastAttackTime = currentTime;
      return;
    }
    
    // 攻击有效，检查武器是否就绪
    const isWeaponReady = this.weaponRenderer.weaponCooldown.isReady;
    
    // 记录攻击并触发动画（会消耗武器冷却时间）
    this.weaponRenderer.recordAttack(currentTime);
    
    // 获取伤害倍率（基于武器就绪状态和移动速度）
    const damageMultiplier = this.weaponRenderer.getSwipeDamageMultiplier(isWeaponReady);
    
    // 计算击退方向（武器指向的方向）
    const weaponAngle = this.weaponRenderer.currentMouseAngle;
    const knockbackDir = {
      x: Math.cos(weaponAngle),
      y: Math.sin(weaponAngle)
    };
    
    // 对范围内的所有敌人造成伤害
    for (const enemy of enemiesInRange) {
      const stats = this.playerEntity.getComponent('stats');
      if (!stats) continue;
      
      let finalDamage;
      let damageType; // 伤害类型
      
      if (!isWeaponReady) {
        // 冷却中：damageMultiplier 是固定伤害值（0-5）
        finalDamage = Math.floor(damageMultiplier);
        damageType = `${attackTypeName}[冷却]`;
      } else {
        // 就绪：damageMultiplier 是倍率，需要乘以基础攻击力
        const baseDamage = stats.attack || 15;
        finalDamage = Math.floor(baseDamage * damageMultiplier);
        const multiplierPercent = Math.floor(damageMultiplier * 100);
        damageType = `${attackTypeName}${multiplierPercent}%`;
      }
      
      // 应用伤害和击退效果（传入伤害类型）
      this.combatSystem.applyDamage(enemy, finalDamage, knockbackDir, damageType);
      
      // 创建攻击特效
      if (this.skillEffects) {
        const enemyTransform = enemy.getComponent('transform');
        if (enemyTransform) {
          this.skillEffects.createSkillEffect('basic_attack', transform.position, enemyTransform.position);
        }
      }
    }
    
    // 在玩家头上显示攻击统计信息
    if (enemiesInRange.length > 0) {
      let summaryText;
      let summaryColor;
      
      if (!isWeaponReady) {
        summaryText = `${attackTypeName} [冷却] 命中${enemiesInRange.length}个敌人`;
        summaryColor = '#888888';
      } else {
        const multiplierPercent = Math.floor(damageMultiplier * 100);
        summaryText = `${attackTypeName} ${speedKmh.toFixed(1)}km/h ${multiplierPercent}% 命中${enemiesInRange.length}个`;
        summaryColor = attackTypeName === '刺击' ? '#ff9900' : '#00ffff';
      }
      
      this.floatingTextManager.addText(
        transform.position.x,
        transform.position.y - 80,
        summaryText,
        summaryColor
      );
    }
  }

  /**
   * 检查空格键继续对话
   */
  checkDialogueContinue() {
    // 检查对话系统是否激活
    if (!this.dialogueSystem || !this.dialogueSystem.isDialogueActive()) {
      return;
    }
    
    // 检查空格键是否按下
    const spacePressed = this.inputManager.isKeyDown('space');
    if (!spacePressed) {
      // 重置标志，允许下次按键
      this.lastSpacePressed = false;
      return;
    }
    
    // 防止连续触发（按住空格键时只触发一次）
    if (this.lastSpacePressed) {
      return;
    }
    
    this.lastSpacePressed = true;
    
    // 如果正在打字，跳过打字动画
    if (this.dialogueSystem.isTyping()) {
      this.dialogueSystem.skipTypewriter();
      return;
    }
    
    // 否则继续对话
    const currentNode = this.dialogueSystem.getCurrentNode();
    if (currentNode) {
      // 如果有选项，不自动继续（需要玩家点击选项）
      if (currentNode.choices && currentNode.choices.length > 0) {
        return;
      }
      
      // 继续对话
      this.dialogueSystem.continue();
      
      // 如果对话结束，隐藏对话框
      if (!this.dialogueSystem.isDialogueActive() && this.dialogueBox) {
        this.dialogueBox.hide();
      }
    }
  }

  /**
   * 更新面板悬停状态（委托给 UISystem）
   */
  updatePanelHover() {
    const mousePos = this.inputManager.getMousePosition();
    this.uiSystem.updateHover(mousePos.x, mousePos.y);
  }

  /**
   * 移除死亡实体
   */
  /**
   * 移除死亡实体（委托给 EntityLifecycleSystem）
   */
  removeDeadEntities() {
    this.entityLifecycleSystem.removeDeadEntities(this.entities);
  }

  /**
   * 获取游戏状态
   */
  getGameState() {
    return {
      tutorialPhase: this.tutorialPhase,
      pickupItems: this.pickupItems
    };
  }


  /**
   * 双后端渲染入口（SceneManager 调用）
   */
  renderCommon(backend) {
    this.render(backend);
  }

  /**
   * 渲染场景
   * @param {CanvasRenderingContext2D|IRenderBackend} ctxOrBackend
   */
  render(ctxOrBackend) {
    const is3D = ctxOrBackend && ctxOrBackend.mode === '3d';
    const ctx = is3D ? ctxOrBackend.getHUDContext() : ctxOrBackend;
    const backend = is3D ? ctxOrBackend : null;

    if (this._debugNextRender) {
      console.log('【渲染】render, is3D=', is3D);
    }
    
    // 3D 模式：让相机跟随玩家
    if (is3D && backend.camera && this.playerEntity) {
      const transform = this.playerEntity.getComponent('transform');
      if (transform) {
        backend.camera.setTarget(transform);
        backend.camera.update();
      }
    }

    if (!is3D) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    }
    
    if (is3D) {
      // 3D 世界渲染
      this._ensure3DSceneObjects(backend);
      backend.renderEntities(this.entities, backend.camera);
      if (this.particleSystem) {
        backend.renderParticles(this.particleSystem);
      }
    } else {
      // 2D 世界渲染
      ctx.save();
      const viewBounds = this.camera.getViewBounds();
      if (this._debugNextRender) {
        console.log('【渲染】相机:', this.camera.position.x, this.camera.position.y);
        this._debugNextRender = false;
      }
      ctx.translate(-viewBounds.left, -viewBounds.top);
      this.renderBackground(ctx);
      this.renderPickupItems(ctx);
      this.renderWorldObjects(ctx);
      if (this.weaponRenderer && this.weaponRenderer.thrownWeapon.active) {
        this.weaponRenderer.renderThrownWeapon(ctx, this.camera);
      }
      if (this.combatSystem && this.combatSystem.isInCombat() && this.playerEntity) {
        this.meleeAttackSystem.renderCombatAlertCircle(ctx, this.camera);
      }
      if (this.meleeAttackSystem.sliceTrail && this.meleeAttackSystem.sliceTrail.length > 1) {
        this.meleeAttackSystem.renderSliceTrail(ctx);
      }
      this.meleeAttackSystem.renderSectorSlashEffects(ctx);
      this.particleSystem.render(ctx, this.camera);
      if (this._debugParticleFrames > 0) {
        console.log('【渲染】粒子系统活跃粒子数:', this.particleSystem.getActiveCount());
        this._debugParticleFrames--;
      }
      if (this.combatSystem) {
        this.combatSystem.renderSkillRangeIndicators(ctx);
      }
      ctx.restore();
      this.skillEffects.render(ctx, this.camera);
      this.combatEffects.render();
      this.floatingTextManager.render(ctx, this.camera);
    }

    // HUD / UI 渲染
    if (!ctx) return;
    if (this.tutorialSystem) this.tutorialSystem.render(ctx);
    if (this.dialogueBox) this.dialogueBox.render(ctx);
    if (this.combatSystem) this.combatSystem.render(ctx);
    if (this.playerInfoPanel) this.playerInfoPanel.render(ctx);
    if (this.inventoryPanel) this.inventoryPanel.render(ctx);
    if (this.bottomControlBar) this.bottomControlBar.render(ctx);
    this.renderCombatStateUI(ctx);
    if (this.isTransitioning) this.renderTransition(ctx);
    if (this.performanceMonitor && this.performanceMonitor.enabled) {
      this.performanceMonitor.render(ctx);
    }
    if (is3D) {
      // 3D 模式 HUD 特效：使用 2D camera 的 position 做偏移
      // 因为所有 2D 特效（粒子、刀光等）的坐标都在 2D 世界空间
      // 2D camera 已经跟随玩家，它的 viewBounds 就是正确的偏移
      const proxyBounds = this.camera.getViewBounds();
      
      const cam3d = backend.camera;
      const camera3DProxy = {
        worldToScreen: (wx, wy) => {
          // 直接用 2D camera 的 worldToScreen
          return this.camera.worldToScreen(wx, wy);
        },
        getViewBounds: () => proxyBounds,
        position: this.camera.position,
        width: this.camera.width,
        height: this.camera.height
      };
      
      this.skillEffects.render(ctx, camera3DProxy);
      this.floatingTextManager.render(ctx, camera3DProxy);
      
      // 战斗特效（世界坐标系内渲染）
      ctx.save();
      ctx.translate(-proxyBounds.left, -proxyBounds.top);
      
      if (this.meleeAttackSystem.sliceTrail && this.meleeAttackSystem.sliceTrail.length > 1) {
        this.meleeAttackSystem.renderSliceTrail(ctx);
      }
      this.meleeAttackSystem.renderSectorSlashEffects(ctx);
      if (this.combatSystem && this.combatSystem.isInCombat() && this.playerEntity) {
        this.meleeAttackSystem.renderCombatAlertCircle(ctx, camera3DProxy);
      }
      // 粒子已在 3D 场景中渲染，不再重复绘制到 HUD
      if (this.combatSystem) {
        this.combatSystem.renderSkillRangeIndicators(ctx);
      }
      
      ctx.restore();
      
      this.combatEffects.render();
    }
  }

  /**
   * 渲染世界对象（实体等）- 子类可覆盖以添加自定义渲染顺序
   */
  renderWorldObjects(ctx) {
    // 使用等距渲染器的深度排序（如果可用）
    let sortedEntities;
    if (this.isometricRenderer) {
      sortedEntities = this.isometricRenderer.sortByDepth(this.entities);
    } else {
      // 备用：按Y坐标排序
      sortedEntities = [...this.entities].sort((a, b) => {
        const transformA = a.getComponent('transform');
        const transformB = b.getComponent('transform');
        const yA = transformA ? transformA.position.y : 0;
        const yB = transformB ? transformB.position.y : 0;
        return yA - yB;
      });
    }
    
    for (const entity of sortedEntities) {
      this.renderEntity(ctx, entity);
    }
  }

  /**
   * 渲染战斗状态UI
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderCombatStateUI(ctx) {
    if (!this.combatSystem.isInCombat()) return;
    
    // 战斗状态面板位置（屏幕右上角）
    const panelX = this.logicalWidth - 90;
    const panelY = 10;
    const panelWidth = 80;
    const panelHeight = 30;
    
    ctx.save();
    
    // 绘制背景
    ctx.fillStyle = 'rgba(139, 0, 0, 0.7)'; // 深红色背景
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    
    // 绘制边框
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
    
    // 绘制"战斗中"文字
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('战斗中', panelX + panelWidth / 2, panelY + 14);
    
    // 绘制脱离战斗倒计时
    const timer = Math.ceil(this.combatSystem.getCombatExitTimer());
    if (timer > 0) {
      ctx.fillStyle = '#ffff00';
      ctx.font = '10px Arial';
      ctx.fillText(`${timer}秒`, panelX + panelWidth / 2, panelY + 26);
    } else {
      ctx.fillStyle = '#ff6666';
      ctx.font = '9px Arial';
      ctx.fillText('敌人附近', panelX + panelWidth / 2, panelY + 26);
    }
    
    ctx.restore();
  }

  /**
   * 渲染背景 - 子类覆盖
   */
  renderBackground(ctx) {
    // 渲染等距地图
    if (this.isometricRenderer) {
      // 先绘制无限延伸的网格
      const viewBounds = this.camera.getViewBounds();
      this.isometricRenderer.drawInfiniteGrid(viewBounds);
      
      // 再绘制等距地图（覆盖在网格上）
      if (this.mapData) {
        this.isometricRenderer.drawMap();
      }
    } else {
      // 备用：简单背景
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
    }
  }

  /**
   * 渲染可拾取物品
   */
  renderPickupItems(ctx) {
    for (const item of this.pickupItems) {
      if (item.picked) continue;
      
      // 物品位置（世界坐标）
      const x = item.x;
      const y = item.y;
      
      // 根据物品类型绘制不同图标
      if (item.id === 'leftover_food') {
        this.renderLeftoverFoodSprite(ctx, x, y);
      } else if (item.id === 'ragged_clothes') {
        this.renderRaggedClothesSprite(ctx, x, y);
      } else if (item.id === 'wooden_sword') {
        this.renderWoodenSwordSprite(ctx, x, y);
      } else if (item.id === 'wooden_bow') {
        this.renderWoodenBowSprite(ctx, x, y);
      } else if (item.id === 'wooden_arrow') {
        this.renderWoodenArrowSprite(ctx, x, y);
      } else {
        // 默认：绘制物品圆形（底部对齐）
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(x, y - 5, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // 绘制物品名称
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(item.name, x, y - 20);
    }
    
    for (const item of this.equipmentItems) {
      if (item.picked) continue;
      
      const x = item.x;
      const y = item.y;
      
      // 根据装备类型绘制不同图标
      if (item.id === 'ragged_clothes') {
        this.renderRaggedClothesSprite(ctx, x, y);
      } else if (item.id === 'wooden_sword') {
        this.renderWoodenSwordSprite(ctx, x, y);
      } else if (item.id === 'wooden_bow') {
        this.renderWoodenBowSprite(ctx, x, y);
      } else if (item.id === 'wooden_arrow') {
        this.renderWoodenArrowSprite(ctx, x, y);
      } else {
        // 绘制装备物品圆形（底部对齐）
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(x, y - 5, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // 绘制物品名称
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(item.name, x, y - 20);
    }
  }

  /**
   * 渲染残羹精灵（场景地图上的破碗图标）
   */
  renderLeftoverFoodSprite(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y - 8);

      // 中国碗 - 口大底小，碗壁外展
      // 碗身（用贝塞尔曲线画出口大底小的形状）
      ctx.fillStyle = '#8B7355';
      ctx.beginPath();
      ctx.moveTo(-13, -5);  // 左碗口
      ctx.bezierCurveTo(-12, 0, -6, 6, -4, 8);  // 左壁向内收
      ctx.lineTo(4, 8);     // 碗底（小）
      ctx.bezierCurveTo(6, 6, 12, 0, 13, -5);   // 右壁向内收
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 碗底座（小圆底）
      ctx.fillStyle = '#7a6345';
      ctx.beginPath();
      ctx.ellipse(0, 8, 4, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // 碗口（大椭圆）
      ctx.fillStyle = '#a08060';
      ctx.beginPath();
      ctx.ellipse(0, -5, 13, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a4a3a';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 碗内部（深色）
      ctx.fillStyle = '#6b5a48';
      ctx.beginPath();
      ctx.ellipse(0, -5, 11, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // 裂缝（破碗效果）
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(7, -8);
      ctx.lineTo(9, -3);
      ctx.lineTo(10, 2);
      ctx.stroke();

      // 碗口缺口
      ctx.fillStyle = '#6b5a48';
      ctx.beginPath();
      ctx.arc(-9, -7, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // 碗内米粒
      ctx.fillStyle = '#f5f0e0';
      const grains = [[-3, -5], [1, -6], [4, -5], [-1, -4], [2, -4]];
      for (const [gx, gy] of grains) {
        ctx.beginPath();
        ctx.ellipse(gx, gy, 1.5, 0.8, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 碗外散落米粒
      ctx.fillStyle = '#e8e0c8';
      ctx.beginPath();
      ctx.ellipse(-8, 2, 1.2, 0.7, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(10, 3, 1, 0.6, -0.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

  /**
   * 渲染破旧衣服精灵（场景地图上的破衣服图标）
   */
  renderRaggedClothesSprite(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y - 8);

      // 衣服主体（褐色破旧布料）
      ctx.fillStyle = '#8B6914';
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-6, -10);
      ctx.lineTo(-12, -4);
      ctx.lineTo(-10, -2);
      ctx.lineTo(-7, -6);
      ctx.lineTo(-8, 10);
      ctx.lineTo(8, 10);
      ctx.lineTo(7, -6);
      ctx.lineTo(10, -2);
      ctx.lineTo(12, -4);
      ctx.lineTo(6, -10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#5a4a0a';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 领口
      ctx.fillStyle = '#6b5210';
      ctx.beginPath();
      ctx.ellipse(0, -11, 4, 2, 0, 0, Math.PI);
      ctx.fill();

      // 补丁
      ctx.fillStyle = '#6b5a10';
      ctx.fillRect(-5, 0, 4, 4);
      ctx.strokeStyle = '#4a3a08';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1, 1]);
      ctx.strokeRect(-5, 0, 4, 4);
      ctx.setLineDash([]);

      // 破洞
      ctx.fillStyle = '#2a1a00';
      ctx.beginPath();
      ctx.ellipse(4, 3, 2, 1.5, 0.3, 0, Math.PI * 2);
      ctx.fill();

      // 撕裂痕迹（下摆）
      ctx.strokeStyle = '#5a4a0a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-6, 10);
      ctx.lineTo(-5, 12);
      ctx.moveTo(-2, 10);
      ctx.lineTo(-1, 11);
      ctx.moveTo(3, 10);
      ctx.lineTo(4, 12);
      ctx.stroke();

      ctx.restore();
  }

  /**
   * 渲染木剑精灵（场景地图上的木剑图标）
   */
  renderWoodenSwordSprite(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y - 10);
      ctx.rotate(-Math.PI / 4); // 斜放45度

      // 剑身
      ctx.fillStyle = '#a08030';
      ctx.beginPath();
      ctx.moveTo(0, -16);   // 剑尖
      ctx.lineTo(3.5, -12);
      ctx.lineTo(3.5, 3);
      ctx.lineTo(-3.5, 3);
      ctx.lineTo(-3.5, -12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#6b5210';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // 剑身高光
      ctx.fillStyle = '#c0a050';
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(1.5, -12);
      ctx.lineTo(1.5, 2);
      ctx.lineTo(0, 2);
      ctx.closePath();
      ctx.fill();

      // 护手
      ctx.fillStyle = '#5a4a0a';
      ctx.fillRect(-6, 3, 12, 3);

      // 剑柄
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(-2, 6, 4, 9);

      // 剑柄底部
      ctx.fillStyle = '#5a4a0a';
      ctx.beginPath();
      ctx.arc(0, 16, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
  }

  /**
   * 渲染木弓精灵（场景地图上的木弓图标）
   */
  renderWoodenBowSprite(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y - 10);

    // 弓身（弧形木杆）
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(4, 0, 14, Math.PI * 0.7, Math.PI * 1.3, false);
    ctx.stroke();

    // 弓身高光
    ctx.strokeStyle = '#a08030';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(4, 0, 13, Math.PI * 0.8, Math.PI * 1.2, false);
    ctx.stroke();

    // 弓弦
    ctx.strokeStyle = '#d4c4a0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4 + 14 * Math.cos(Math.PI * 0.7), 14 * Math.sin(Math.PI * 0.7));
    ctx.lineTo(4 + 14 * Math.cos(Math.PI * 1.3), 14 * Math.sin(Math.PI * 1.3));
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 渲染木箭精灵（场景地图上的木箭图标，一捆箭）
   */
  renderWoodenArrowSprite(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y - 8);

    // 画3支箭组成一捆
    for (let i = -1; i <= 1; i++) {
      const ox = i * 3;
      const rot = i * 0.15;
      ctx.save();
      ctx.translate(ox, 0);
      ctx.rotate(rot);

      // 箭杆
      ctx.strokeStyle = '#8B6914';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(0, -8);
      ctx.stroke();

      // 箭头（三角形）
      ctx.fillStyle = '#888888';
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-2.5, -7);
      ctx.lineTo(2.5, -7);
      ctx.closePath();
      ctx.fill();

      // 箭羽
      ctx.fillStyle = '#cc4444';
      ctx.beginPath();
      ctx.moveTo(-2, 8);
      ctx.lineTo(0, 5);
      ctx.lineTo(2, 8);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }


  /**
   * 渲染单个实体
   */
  renderEntity(ctx, entity) {
    const transform = entity.getComponent('transform');
    const sprite = entity.getComponent('sprite');
    const stats = entity.getComponent('stats');
    
    if (!transform) return;
    
    const x = transform.position.x;
    const y = transform.position.y;
    const size = sprite?.width || 32;
    const height = sprite?.height || 32;
    
    // 检查是否被选中 - 已禁用（不再需要选中敌人）
    // const isSelected = this.combatSystem && this.combatSystem.selectedTarget === entity;
    
    // 渲染精灵（使用底部中心锚点）
    if (sprite && sprite.visible) {
      
      // 应用精灵透明度
      const prevAlpha = ctx.globalAlpha;
      if (sprite.alpha !== undefined && sprite.alpha < 1.0) {
        ctx.globalAlpha = sprite.alpha;
      }
      
      let rendered = false;
      
      // 4x9格式精灵渲染
      if (sprite.useAnimatedSprite && this.assetManager) {
        const image = this.assetManager.getAsset(sprite.spriteSheet);
        // Image对象需要complete且naturalWidth>0才算加载完成
        const isImageReady = image && (
          (image instanceof HTMLCanvasElement) ||
          (image.complete && image.naturalWidth > 0)
        );
        if (isImageReady) {
          // 调试：首次输出图片信息
          if (!this._debugSpriteLogged) {
            const cellW = image.width / sprite.spriteColumns;
            const cellH = image.height / sprite.spriteRows;
            console.log(`【精灵调试】图片尺寸: ${image.width}x${image.height}, 列数: ${sprite.spriteColumns}, 行数: ${sprite.spriteRows}, 单元格: ${cellW}x${cellH}`);
            this._debugSpriteLogged = true;
          }
          // 获取当前帧的行和列
          const frameInfo = sprite.getAnimatedFrame();
          const row = frameInfo.row;
          const col = frameInfo.col;
          
          // 计算每个格子的尺寸
          const cellWidth = image.width / sprite.spriteColumns;
          const cellHeight = image.height / sprite.spriteRows;
          
          // 源矩形
          const sx = col * cellWidth;
          const sy = row * cellHeight;
          
          // 目标尺寸
          const destWidth = size;
          const destHeight = height;
          
          // 绘制精灵（底部中心锚点）
          ctx.drawImage(
            image,
            sx, sy, cellWidth, cellHeight,
            x - destWidth/2, y - destHeight, destWidth, destHeight
          );
          rendered = true;
        }
      }
      // 旧格式九宫格精灵渲染
      else if (sprite.useDirectionalSprite && this.assetManager) {
        const image = this.assetManager.getAsset(sprite.spriteSheet);
        // canvas 元素没有 complete 属性，但可以直接使用
        const isImageReady = image && (image.complete !== false || image instanceof HTMLCanvasElement);
        if (isImageReady) {
          // 获取当前方向对应的帧索引
          const frameIndex = sprite.getCurrentFrame();
          const framesPerRow = 3; // 九宫格是3x3
          const row = Math.floor(frameIndex / framesPerRow);
          const col = frameIndex % framesPerRow;
          
          // 计算每个格子的尺寸（图片尺寸 / 3）
          const cellWidth = image.width / 3;
          const cellHeight = image.height / 3;
          
          // 源矩形（从九宫格精灵图中裁剪）
          const sx = col * cellWidth;
          const sy = row * cellHeight;
          
          // 目标尺寸（可以根据需要缩放）
          const destWidth = size;
          const destHeight = height;
          
          // 绘制精灵（底部中心锚点：x居中，y在底部）
          ctx.drawImage(
            image,
            sx, sy, cellWidth, cellHeight,  // 源矩形
            x - destWidth/2, y - destHeight, destWidth, destHeight  // 目标矩形（底部对齐）
          );
          rendered = true;
        }
      }
      
      // 如果没有成功渲染精灵图，使用占位符（底部对齐）
      if (!rendered) {
        if (entity.type === 'loot' && entity.itemData) {
          // 掉落物：绘制瓶子形状
          this.renderPotionSprite(ctx, x, y, entity.itemData.type);
        } else {
          ctx.fillStyle = sprite.color || '#00ff00';
          ctx.fillRect(x - size/2, y - height, size, height);
          
          ctx.strokeStyle = entity.type === 'player' ? '#4CAF50' : '#ff4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - size/2, y - height, size, height);
        }
      }
      
      // 恢复透明度
      ctx.globalAlpha = prevAlpha;
    }
    
    // 渲染名字（在实体上方）
    const nameComponent = entity.getComponent('name');
    if (nameComponent && nameComponent.visible) {
      const nameY = y - height + (nameComponent.offsetY || -10);
      
      ctx.save();
      ctx.font = `bold ${nameComponent.fontSize || 14}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      
      const textWidth = ctx.measureText(nameComponent.name).width;
      const padding = 4;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x - textWidth / 2 - padding, nameY - 16, textWidth + padding * 2, 18);
      
      ctx.fillStyle = nameComponent.color || '#ffffff';
      ctx.fillText(nameComponent.name, x, nameY);
      ctx.restore();
    }
    
    // 渲染生命值条（在实体头顶上方）
    if (stats && stats.maxHp > 0) {
      const barWidth = 40;
      const barHeight = 4;
      const barX = x - barWidth / 2;
      const barY = y - height - 8;  // 在实体顶部上方8像素
      
      ctx.fillStyle = '#333333';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      
      const hpRatio = stats.hp / stats.maxHp;
      ctx.fillStyle = hpRatio > 0.5 ? '#00ff00' : hpRatio > 0.2 ? '#ffaa00' : '#ff0000';
      ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
      
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barWidth, barHeight);
    }
  }

  /**
   * 渲染药瓶精灵
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - 底部中心X
   * @param {number} y - 底部Y
   * @param {string} potionType - 'health_potion' 或 'mana_potion'
   */
  renderPotionSprite(ctx, x, y, potionType) {
    const isHealth = potionType === 'health_potion';
    const bodyColor = isHealth ? '#ff3333' : '#3366ff';
    const liquidColor = isHealth ? '#cc0000' : '#0033cc';
    const highlightColor = isHealth ? '#ff8888' : '#88aaff';

    ctx.save();
    ctx.translate(x, y);

    // 瓶身（圆角矩形）
    const bw = 12, bh = 16;
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-bw/2, -4);
    ctx.quadraticCurveTo(-bw/2, -bh - 2, -3, -bh - 2);
    ctx.lineTo(3, -bh - 2);
    ctx.quadraticCurveTo(bw/2, -bh - 2, bw/2, -4);
    ctx.quadraticCurveTo(bw/2, 0, 0, 0);
    ctx.quadraticCurveTo(-bw/2, 0, -bw/2, -4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 液体（下半部分）
    ctx.fillStyle = liquidColor;
    ctx.fillRect(-bw/2 + 1, -bh/2, bw - 2, bh/2 - 1);

    // 高光
    ctx.fillStyle = highlightColor;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(-bw/2 + 2, -bh, 3, bh - 4);
    ctx.globalAlpha = 1.0;

    // 瓶口
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(-3, -bh - 6, 6, 5);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(-3, -bh - 6, 6, 5);

    // 瓶盖
    ctx.fillStyle = '#654321';
    ctx.fillRect(-4, -bh - 8, 8, 3);

    ctx.restore();
  }

  /**
   * 切换到下一幕
   */
  switchToNextScene() {
    const stats = this.playerEntity.getComponent('stats');
    const inventory = this.playerEntity.getComponent('inventory');
    const equipment = this.playerEntity.getComponent('equipment');
    
    const sceneData = {
      player: {
        id: this.playerEntity.id,
        name: this.playerEntity.name || '玩家',
        class: this.playerEntity.class || 'refugee',
        level: stats?.level || 1,
        hp: stats?.hp || 100,
        maxHp: stats?.maxHp || 100,
        mp: stats?.mp || 100,
        maxMp: stats?.maxMp || 100,
        attack: stats?.attack || 10,
        defense: stats?.defense || 5,
        speed: stats?.speed || 100,
        inventory: inventory?.getAllItems() || [],
        equipment: equipment?.slots || {}
      },
      playerEntity: this.playerEntity,
      previousAct: this.actNumber
    };
    
    console.log(`BaseGameScene: 切换到下一幕，传递数据`, sceneData);
    this.goToNextScene(sceneData);
  }

  /**
   * 设置场景提示回调
   * @param {Function} showCallback - 显示提示回调 (text, title) => void
   * @param {Function} hideCallback - 隐藏提示回调 () => void
   */
  setHintCallbacks(showCallback, hideCallback) {
    this._onHintShow = showCallback;
    this._onHintHide = hideCallback;
  }

  /**
   * 显示场景提示（通过回调，支持HTML和.key样式）
   * @param {string} text - 提示文本（支持HTML，如 <span class="key">N</span>）
   * @param {string} title - 提示标题，默认'提示'
   */
  showHint(text, title = '提示') {
    // 如果提示内容没变，不重复显示
    if (this._currentHintText === text) return;
    this._currentHintText = text;
    
    if (this._onHintShow) {
      this._onHintShow(text, title);
    }
  }

  /**
   * 隐藏场景提示
   */
  hideHint() {
    if (this._currentHintText === null) return;
    this._currentHintText = null;
    
    if (this._onHintHide) {
      this._onHintHide();
    }
  }

  /**
   * 场景退出
   */
  exit() {
    super.exit();
    
    if (this.inputManager) {
      this.inputManager.destroy();
    }
    
    if (this.flightSystem) {
      this.flightSystem.cleanup();
    }
    
    if (this.meleeAttackSystem) {
      this.meleeAttackSystem.cleanup();
    }
    
    if (this.enemyWeaponRenderer) {
      this.enemyWeaponRenderer.cleanup();
    }
    
    this.tutorialSystem.cleanup();
    
    for (const entity of this.entities) {
      entity.destroy();
    }
    this.entities = [];
    
    console.log(`BaseGameScene: 退出场景 ${this.name}`);
  }

  /**
   * 3D 模式下确保场景中有火堆、拾取物等 3D 对象
   */
  _ensure3DSceneObjects(backend) {
    if (!backend || !backend.scene) return;
    if (!this._3dObjects) this._3dObjects = {};
    
    // 火堆 3D 对象
    if (this.campfire && !this._3dObjects.campfire) {
      const { THREE } = this._getThree(backend);
      if (THREE) {
        const group = new THREE.Group();
        group.position.set(this.campfire.x, 0, this.campfire.y);
        
        // 几根交叉的木柴（加大尺寸）
        const logMat = new THREE.MeshLambertMaterial({ color: 0x5C3317 });
        const logConfigs = [
          { rx: 0.3, rz: 0.8, ry: 0 },
          { rx: -0.4, rz: -0.6, ry: 1.2 },
          { rx: 0.1, rz: -0.3, ry: 2.4 },
          { rx: -0.2, rz: 0.5, ry: 0.6 },
          { rx: 0.5, rz: 0.2, ry: 1.8 },
          { rx: -0.3, rz: 0.4, ry: 3.0 },
        ];
        for (const lp of logConfigs) {
          const logGeom = new THREE.CylinderGeometry(3.5, 4.5, 45, 6);
          const log = new THREE.Mesh(logGeom, logMat);
          log.rotation.x = lp.rx;
          log.rotation.z = lp.rz;
          log.rotation.y = lp.ry;
          log.position.y = 3;
          group.add(log);
        }
        
        // 底部石头圈（缩小匹配碰撞区域）
        const stoneMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const stoneGeom = new THREE.SphereGeometry(4, 5, 4);
          const stone = new THREE.Mesh(stoneGeom, stoneMat);
          stone.position.set(Math.cos(angle) * 18, 3, Math.sin(angle) * 18);
          stone.scale.set(1, 0.6, 1);
          group.add(stone);
        }
        
        // 火焰面片（用序列帧贴图，billboard）
        let flamePlane = null;
        const fireImg = this.campfire.fireImage;
        if (fireImg && fireImg.complete && fireImg.naturalWidth > 0) {
          const tex = new THREE.Texture(fireImg);
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.needsUpdate = true;
          tex.repeat.set(1 / 4, 1 / 3);
          tex.offset.set(0, 1 - 1 / 3);
          
          const flameW = 60;
          const flameH = 70;
          const flameGeom = new THREE.PlaneGeometry(flameW, flameH);
          const flameMat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          flamePlane = new THREE.Mesh(flameGeom, flameMat);
          flamePlane.position.y = 40;
          flamePlane.userData.isBillboard = true;
          group.add(flamePlane);
        } else {
          // 没有图片时用球体代替
          const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.8 });
          flamePlane = new THREE.Mesh(new THREE.SphereGeometry(15, 8, 6), flameMat2);
          flamePlane.position.y = 25;
          flamePlane.scale.set(1, 1.5, 1);
          group.add(flamePlane);
        }
        
        // 点光源
        const light = new THREE.PointLight(0xff6600, 0, 300);
        light.position.set(0, 30, 0);
        group.add(light);
        
        // 3D 火焰粒子系统（用 THREE.Points）
        const particleCount = 80;
        const pGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const velocities = new Float32Array(particleCount * 3);
        const lifetimes = new Float32Array(particleCount);
        const ages = new Float32Array(particleCount);
        
        for (let i = 0; i < particleCount; i++) {
          // 初始化在火堆中心附近
          positions[i * 3] = (Math.random() - 0.5) * 20;
          positions[i * 3 + 1] = Math.random() * 30 + 10;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
          // 速度：主要向上
          velocities[i * 3] = (Math.random() - 0.5) * 15;
          velocities[i * 3 + 1] = 30 + Math.random() * 50;
          velocities[i * 3 + 2] = (Math.random() - 0.5) * 15;
          // 颜色：橙黄红随机
          const colorChoice = Math.random();
          if (colorChoice < 0.3) { colors[i*3]=1; colors[i*3+1]=0.95; colors[i*3+2]=0.3; }
          else if (colorChoice < 0.6) { colors[i*3]=1; colors[i*3+1]=0.6; colors[i*3+2]=0.1; }
          else { colors[i*3]=1; colors[i*3+1]=0.3; colors[i*3+2]=0.1; }
          sizes[i] = 3 + Math.random() * 5;
          lifetimes[i] = 0.5 + Math.random() * 1.5;
          ages[i] = Math.random() * lifetimes[i]; // 错开初始时间
        }
        pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        pGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        const pMat = new THREE.PointsMaterial({
          size: 5,
          vertexColors: true,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          sizeAttenuation: true
        });
        const points = new THREE.Points(pGeom, pMat);
        group.add(points);
        
        backend.scene.add(group);
        this._3dObjects.campfire = { group, flamePlane, light, points, velocities, lifetimes, ages, particleCount };
      }
    }
    
    // 更新火堆状态
    if (this._3dObjects.campfire) {
      const cf = this._3dObjects.campfire;
      const { flamePlane, light, points, velocities, lifetimes, ages, particleCount } = cf;
      
      if (this.campfire.lit) {
        // 火焰面片可见 + 序列帧动画
        if (flamePlane) {
          flamePlane.visible = true;
          // billboard：面向相机
          if (backend.camera?.native) {
            const camPos = backend.camera.native.position;
            const fp = flamePlane.parent.position; // group position
            const dx = camPos.x - fp.x;
            const dz = camPos.z - fp.z;
            flamePlane.rotation.y = Math.atan2(dx, dz);
          }
          // 序列帧 UV 更新
          if (flamePlane.material?.map) {
            const frame = this.campfire.currentFrame;
            const col = frame % 4;
            const row = Math.floor(frame / 4);
            flamePlane.material.map.offset.set(col / 4, 1 - (row + 1) / 3);
            flamePlane.material.map.repeat.set(1 / 4, 1 / 3);
            flamePlane.material.map.needsUpdate = true;
          }
        }
        
        // 点光源闪烁
        const t = Date.now() * 0.004;
        light.intensity = 1.8 + Math.sin(t * 3) * 0.4;
        
        // 更新 3D 粒子
        if (points && points.geometry) {
          const posAttr = points.geometry.attributes.position;
          const dt = 0.016;
          for (let i = 0; i < particleCount; i++) {
            ages[i] += dt;
            // 超出生命周期或飘太远则重生
            const px = posAttr.array[i * 3];
            const py = posAttr.array[i * 3 + 1];
            const pz = posAttr.array[i * 3 + 2];
            if (ages[i] >= lifetimes[i] || py > 80 || Math.abs(px) > 30 || Math.abs(pz) > 30) {
              ages[i] = 0;
              posAttr.array[i * 3] = (Math.random() - 0.5) * 15;
              posAttr.array[i * 3 + 1] = Math.random() * 8 + 5;
              posAttr.array[i * 3 + 2] = (Math.random() - 0.5) * 15;
              velocities[i * 3] = (Math.random() - 0.5) * 10;
              velocities[i * 3 + 1] = 30 + Math.random() * 40;
              velocities[i * 3 + 2] = (Math.random() - 0.5) * 10;
            } else {
              posAttr.array[i * 3] += velocities[i * 3] * dt;
              posAttr.array[i * 3 + 1] += velocities[i * 3 + 1] * dt;
              posAttr.array[i * 3 + 2] += velocities[i * 3 + 2] * dt;
              // 横向微弱摇摆
              posAttr.array[i * 3] += Math.sin(t + i) * 0.15;
              // 速度衰减
              velocities[i * 3] *= 0.98;
              velocities[i * 3 + 1] *= 0.97;
              velocities[i * 3 + 2] *= 0.98;
            }
          }
          posAttr.needsUpdate = true;
          points.visible = true;
        }
      } else {
        if (flamePlane) flamePlane.visible = false;
        light.intensity = 0;
        if (points) points.visible = false;
      }
    }
    
    // 拾取物品 3D 对象
    this._update3DPickupItems(backend);
  }
  
  _update3DPickupItems(backend) {
    if (!backend.scene) return;
    if (!this._3dObjects.pickups) this._3dObjects.pickups = new Map();
    const { THREE } = this._getThree(backend);
    if (!THREE) return;
    
    const allItems = [...(this.pickupItems || []), ...(this.equipmentItems || [])];
    
    for (const item of allItems) {
      if (item.picked) {
        const obj = this._3dObjects.pickups.get(item);
        if (obj) {
          backend.scene.remove(obj);
          this._3dObjects.pickups.delete(item);
        }
        continue;
      }
      if (!this._3dObjects.pickups.has(item)) {
        // 创建物品面片，贴 canvas 绘制的图标
        const size = 35;
        const geom = new THREE.PlaneGeometry(size, size);
        
        // 生成物品图标纹理
        const iconTex = this._createItemIconTexture(item, THREE);
        const mat = new THREE.MeshBasicMaterial({
          map: iconTex,
          transparent: true,
          alphaTest: 0.1,
          side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(item.x, size / 2 + 2, item.y);
        backend.scene.add(mesh);
        this._3dObjects.pickups.set(item, mesh);
      } else {
        // 浮动 + 自转动画
        const mesh = this._3dObjects.pickups.get(item);
        mesh.position.y = 20 + Math.sin(Date.now() * 0.003 + item.x) * 5;
        mesh.rotation.y += 0.1;
      }
    }
  }
  
  /**
   * 用离屏 canvas 绘制物品图标，生成 THREE.Texture
   */
  _createItemIconTexture(item, THREE) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // 背景透明
    ctx.clearRect(0, 0, size, size);
    
    // 根据物品 id 绘制对应图标
    ctx.save();
    ctx.translate(size / 2, size / 2);
    
    if (item.id === 'leftover_food') {
      // 碗 + 食物
      ctx.fillStyle = '#8B7355';
      ctx.beginPath();
      ctx.ellipse(0, 5, 18, 10, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#CD853F';
      ctx.beginPath();
      ctx.ellipse(0, 2, 14, 7, 0, Math.PI, 0);
      ctx.fill();
      // 热气
      ctx.strokeStyle = '#ffffff88';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-5, -8); ctx.quadraticCurveTo(-3, -14, -5, -20);
      ctx.moveTo(3, -6); ctx.quadraticCurveTo(5, -12, 3, -18);
      ctx.stroke();
    } else if (item.id === 'ragged_clothes') {
      // 衣服
      ctx.fillStyle = '#6B5B4F';
      ctx.fillRect(-12, -15, 24, 30);
      ctx.fillStyle = '#5A4A3E';
      ctx.fillRect(-16, -15, 6, 20);
      ctx.fillRect(10, -15, 6, 20);
      // 补丁
      ctx.fillStyle = '#8B7355';
      ctx.fillRect(-5, -5, 8, 8);
    } else if (item.id === 'wooden_sword') {
      // 木剑
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(-2, -22, 4, 30);
      ctx.fillStyle = '#654321';
      ctx.fillRect(-6, 8, 12, 4);
      ctx.fillStyle = '#A0522D';
      ctx.fillRect(-3, 12, 6, 8);
      // 剑尖
      ctx.fillStyle = '#8B6914';
      ctx.beginPath();
      ctx.moveTo(-2, -22); ctx.lineTo(0, -28); ctx.lineTo(2, -22);
      ctx.fill();
    } else if (item.id === 'wooden_bow') {
      // 弓
      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 18, -Math.PI * 0.7, Math.PI * 0.7);
      ctx.stroke();
      // 弦
      ctx.strokeStyle = '#DDD';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -17); ctx.lineTo(0, 17);
      ctx.stroke();
    } else if (item.id === 'wooden_arrow') {
      // 箭
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(-1, -20, 2, 35);
      // 箭头
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.moveTo(-4, -20); ctx.lineTo(0, -28); ctx.lineTo(4, -20);
      ctx.fill();
      // 箭羽
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(-3, 12); ctx.lineTo(0, 8); ctx.lineTo(3, 12);
      ctx.fill();
    } else {
      // 默认：金色圆形
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#B8860B';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    
    ctx.restore();
    
    const tex = new THREE.Texture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }
  
  _getThree(backend) {
    if (backend && backend.THREE) {
      return { THREE: backend.THREE };
    }
    return { THREE: null };
  }
}

export default BaseGameScene;

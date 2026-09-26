/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-02-10
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { Scene } from '../core/Scene.js';
import { Camera } from '../rendering/Camera.js';
import { RenderSystem } from '../rendering/RenderSystem.js';
import { ParticleSystem } from '../rendering/ParticleSystem.js';
import { SkillEffects } from '../rendering/SkillEffects.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { RNG } from '../core/RNG.js';
import { setTimeoutFn } from '../core/Timers.js';

// 表现层随机：场景特效偏移（非玩法结算，非权威）
const fxRng = new RNG();
import { AttributeSystem } from '../systems/AttributeSystem.js';
import { UISystem } from '../ui/UISystem.js';
import { PlayerInfoPanel } from '../ui/PlayerInfoPanel.js';
import { AttributePanel } from '../ui/AttributePanel.js';
import { getDocumentBody, addDomEventListener } from '../core/PlatformBootstrap.js';
import { EntityFactory } from '../ecs/EntityFactory.js';
import { MockDataService } from '../data/MockDataService.js';

/**
 * 游戏主场景
 * 整合所有游戏系统，处理游戏主循环
 */
export class GameScene extends Scene {
  constructor(engine) {
    super('Game');
    
    this.engine = engine;
    
    // 系统
    this.camera = null;
    this.renderSystem = null;
    this.particleSystem = null;
    this.skillEffects = null;
    this.movementSystem = null;
    this.combatSystem = null;
    this.attributeSystem = null;
    this.uiSystem = null;
    
    // 数据服务
    this.dataService = new MockDataService();
    
    // 实体工厂
    this.entityFactory = new EntityFactory();
    
    // 实体列表
    this.entities = [];
    
    // 玩家实体
    this.player = null;
    
    // 地图数据
    this.mapData = null;
    
    // 敌人AI更新计时器
    this.aiUpdateTimer = 0;
    this.aiUpdateInterval = 0.1; // 每0.1秒更新一次AI
    
    console.log('GameScene: Created');

    // 标识：本场景已适配双后端抽象，使用 renderCommon(backend)
    this.__dualBackendAware = true;
  }

  /**
   * 场景进入
   * @param {Object} data - 场景数据
   * @param {Object} data.character - 角色数据
   */
  enter(data = null) {
    super.enter(data);
    
    console.log('GameScene: Entering with data:', data);
    
    // 初始化系统
    this.initializeSystems();
    
    // 加载地图
    this.loadMap('test_map');
    
    // 创建玩家
    if (data && data.character) {
      this.createPlayer(data.character);
    } else {
      console.error('GameScene: No character data provided');
      // 创建默认角色用于测试
      this.createPlayer({
        name: '测试角色',
        class: 'warrior',
        level: 1,
        stats: {
          hp: 150,
          maxHp: 150,
          mp: 50,
          maxMp: 50,
          attack: 15,
          defense: 10,
          speed: 100
        },
        skills: ['basic_attack', 'warrior_slash', 'warrior_charge', 'warrior_defense'],
        position: { x: 400, y: 300 }
      });
    }
    
    // 生成敌人
    this.spawnEnemies();
    
    console.log(`GameScene: Initialized with ${this.entities.length} entities`);
  }

  /**
   * 初始化所有系统
   */
  initializeSystems() {
    const canvas = this.engine.canvas;
    const ctx = this.engine.canvasContext;
    
    // 创建相机
    this.camera = new Camera(
      canvas.width / 2,
      canvas.height / 2,
      canvas.width,
      canvas.height
    );
    
    // 创建渲染系统
    this.renderSystem = new RenderSystem(ctx, null, canvas.width, canvas.height);
    this.renderSystem.camera = this.camera; // 使用我们创建的相机
    // this.renderSystem.setDebugMode(true); // 调试模式（可选）
    
    // 创建粒子系统
    this.particleSystem = new ParticleSystem(2000);
    
    // 创建技能特效系统
    this.skillEffects = new SkillEffects(this.particleSystem);
    
    // 创建移动系统
    this.movementSystem = new MovementSystem({
      inputManager: this.engine.inputManager,
      camera: this.camera,
      // 楼层切换表现回调：替代旧的 document floorChanged DOM 事件
      onFloorChanged: detail => this.renderSystem?.setCurrentFloor?.(detail?.floorId)
    });
    
    // 创建战斗系统
    this.combatSystem = new CombatSystem({
      inputManager: this.engine.inputManager,
      camera: this.camera,
      dataService: this.dataService,
      skillEffects: this.skillEffects
    });
    
    // 创建属性系统
    this.attributeSystem = new AttributeSystem();
    
    // 创建UI系统
    this.uiSystem = new UISystem({
      canvas: canvas,
      camera: this.camera
    });
    
    console.log('GameScene: All systems initialized');
  }

  /**
   * 加载地图
   * @param {string} mapId - 地图ID
   */
  loadMap(mapId) {
    this.mapData = this.dataService.getMapData(mapId);
    
    if (!this.mapData) {
      console.error(`GameScene: Map ${mapId} not found`);
      return;
    }
    
    // 设置相机边界
    this.camera.setBounds(
      this.mapData.boundaries.minX,
      this.mapData.boundaries.minY,
      this.mapData.boundaries.maxX,
      this.mapData.boundaries.maxY
    );
    
    // 设置移动系统的地图边界和碰撞地图
    this.movementSystem.setMapBounds(
      this.mapData.boundaries.minX,
      this.mapData.boundaries.minY,
      this.mapData.boundaries.maxX,
      this.mapData.boundaries.maxY
    );
    this.movementSystem.setCollisionMap(
      this.mapData.layers.collision,
      this.mapData.tileSize
    );
    // 新：把 floors 一并交给 MovementSystem
    this.movementSystem.setMapData(this.mapData);

    // 监听 floorChanged，同步 RenderSystem 的 currentFloorId
    // （已改为 MovementSystem.onFloorChanged 回调，见 initializeSystems 注入）
    if (this.renderSystem?.setCurrentFloor) {
      this.renderSystem.setCurrentFloor(this.mapData.defaultFloor || 'ground');
    }
    
    console.log(`GameScene: Map ${mapId} loaded`);
  }

  /**
   * 创建玩家
   * @param {Object} characterData - 角色数据
   */
  createPlayer(characterData) {
    // 使用地图的玩家出生点
    if (this.mapData && this.mapData.spawnPoints.player) {
      characterData.position = this.mapData.spawnPoints.player;
    }
    
    // 创建玩家实体
    this.player = this.entityFactory.createPlayer(characterData);
    this.entities.push(this.player);
    
    // 初始化玩家属性系统
    this.initializePlayerAttributes(characterData);
    
    // 设置系统的玩家引用
    this.movementSystem.setPlayerEntity(this.player);
    this.combatSystem.setPlayerEntity(this.player);
    
    // 相机跟随玩家
    this.camera.setTarget(this.player.getComponent('transform'));
    
    // 加载玩家技能
    if (characterData.skills) {
      this.combatSystem.loadSkills(this.player, characterData.skills);
    }
    
    // 创建玩家信息面板
    this.createPlayerInfoPanel();
    
    // 创建属性面板
    this.createAttributePanel();
    
    console.log(`GameScene: Player created - ${this.player.name}`);
  }

  /**
   * 初始化玩家属性系统
   * @param {Object} characterData - 角色数据
   */
  initializePlayerAttributes(characterData) {
    // 初始化角色属性
    const attributeConfig = {
      strength: characterData.attributes?.strength || 10,
      agility: characterData.attributes?.agility || 10,
      intelligence: characterData.attributes?.intelligence || 10,
      constitution: characterData.attributes?.constitution || 10,
      spirit: characterData.attributes?.spirit || 10,
      availablePoints: characterData.attributes?.availablePoints || (characterData.level - 1) * 5
    };
    
    this.attributeSystem.initializeCharacterAttributes(this.player.id, attributeConfig);

    // 应用属性效果到角色属性
    this.applyAttributeEffectsToPlayer();

    console.log('GameScene: Player attributes initialized');
  }

  /**
   * 属性变化回调（由 AttributePanel.onAttributeChanged 注入触发，替代 document 事件监听）
   * @param {{characterId: string}} detail - 事件明细
   */
  onAttributeChanged(detail) {
    if (detail?.characterId === this.player.id) {
      this.applyAttributeEffectsToPlayer();
      console.log('GameScene: Player attributes updated');
    }
  }

  /**
   * 应用属性效果到玩家
   */
  applyAttributeEffectsToPlayer() {
    if (!this.player || !this.attributeSystem) return;
    
    const statsComponent = this.player.getComponent('stats');
    if (!statsComponent) return;
    
    // 重置到基础属性
    statsComponent.resetToBaseStats();
    
    // 获取基础属性
    const baseStats = {
      attack: statsComponent.baseAttack,
      defense: statsComponent.baseDefense,
      maxHp: statsComponent.baseMaxHp,
      maxMp: statsComponent.baseMaxMp,
      speed: statsComponent.baseSpeed,
      hp: statsComponent.hp,
      mp: statsComponent.mp
    };
    
    // 应用属性效果
    const modifiedStats = this.attributeSystem.applyAttributeEffects(this.player.id, baseStats);
    
    // 更新角色属性
    statsComponent.applyAttributeEffects(modifiedStats.attributeEffects);
    
    // 更新移动组件的速度
    const movementComponent = this.player.getComponent('movement');
    if (movementComponent) {
      movementComponent.speed = modifiedStats.speed;
    }
  }

  /**
   * 创建属性面板
   */
  createAttributePanel() {
    if (!this.player || !this.attributeSystem) return;

    // 创建属性面板容器（宿主 DOM 经 platformInfra 引导层获取）
    const container = getDocumentBody();
    this.attributePanel = new AttributePanel(container, this.attributeSystem);

    // 绑定快捷键 'C' 打开属性面板
    addDomEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'c' && !this.attributePanel.isOpen()) {
        event.preventDefault(); // 防止事件冲突
        this.attributePanel.show(this.player.id);
      }
    });
    
    console.log('GameScene: Attribute panel created (Press C to open)');
  }

  /**
   * 创建玩家信息面板
   */
  createPlayerInfoPanel() {
    if (!this.player) return;
    
    const playerInfoPanel = new PlayerInfoPanel({
      x: 10,
      y: 10,
      player: this.player
    });
    
    this.uiSystem.addElement(playerInfoPanel);
    console.log('GameScene: Player info panel created');
  }

  /**
   * 生成敌人
   */
  spawnEnemies() {
    if (!this.mapData || !this.mapData.spawnPoints.enemies) {
      console.warn('GameScene: No enemy spawn points defined');
      return;
    }
    
    let enemyCount = 0;
    
    for (const spawnPoint of this.mapData.spawnPoints.enemies) {
      const template = this.dataService.getEnemyTemplate(spawnPoint.templateId);
      
      if (!template) {
        console.warn(`GameScene: Enemy template ${spawnPoint.templateId} not found`);
        continue;
      }
      
      // 生成指定数量的敌人
      const count = spawnPoint.count || 1;
      for (let i = 0; i < count; i++) {
        // 在出生点周围随机偏移
        const offsetX = (fxRng.next() - 0.5) * 100;
        const offsetY = (fxRng.next() - 0.5) * 100;
        
        const enemyData = this.dataService.createEnemy(
          spawnPoint.templateId,
          {
            x: spawnPoint.x + offsetX,
            y: spawnPoint.y + offsetY
          }
        );
        
        const enemy = this.entityFactory.createEnemy(enemyData);
        this.entities.push(enemy);
        enemyCount++;
      }
    }
    
    console.log(`GameScene: Spawned ${enemyCount} enemies`);
  }

  /**
   * 更新场景
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    if (!this.isActive) return;
    
    // 更新相机
    this.camera.update(deltaTime);
    
    // 更新移动系统
    this.movementSystem.update(deltaTime, this.entities);
    
    // 更新战斗系统
    this.combatSystem.update(deltaTime, this.entities);
    
    // 更新粒子系统
    this.particleSystem.update(deltaTime);
    
    // 更新技能特效
    this.skillEffects.update(deltaTime);
    
    // 更新UI系统
    this.uiSystem.update(deltaTime);
    
    // 更新敌人AI
    this.aiUpdateTimer += deltaTime;
    if (this.aiUpdateTimer >= this.aiUpdateInterval) {
      this.updateEnemyAI(this.aiUpdateInterval);
      this.aiUpdateTimer = 0;
    }
    
    // 移除死亡的实体
    this.removeDeadEntities();
  }

  /**
   * 更新敌人AI
   * @param {number} deltaTime - 时间增量（秒）
   */
  updateEnemyAI(deltaTime) {
    if (!this.player) return;
    
    const playerTransform = this.player.getComponent('transform');
    if (!playerTransform) return;
    
    const enemies = this.entities.filter(e => e.type === 'enemy' && !e.isDead);
    
    for (const enemy of enemies) {
      const enemyTransform = enemy.getComponent('transform');
      const enemyCombat = enemy.getComponent('combat');
      const enemyMovement = enemy.getComponent('movement');
      
      if (!enemyTransform || !enemyCombat) continue;
      
      // 计算与玩家的距离
      const dx = playerTransform.position.x - enemyTransform.position.x;
      const dy = playerTransform.position.y - enemyTransform.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 根据AI类型执行不同行为
      switch (enemy.aiType) {
        case 'passive':
          // 被动型：不主动攻击
          break;
          
        case 'aggressive':
          // 主动型：检测范围内自动追击
          if (distance <= (enemy.detectionRange || 150)) {
            this.enemyChasePlayer(enemy, playerTransform, enemyMovement, enemyCombat, distance);
          }
          break;
          
        case 'patrol':
          // 巡逻型：在区域内巡逻，检测到玩家后追击
          if (distance <= (enemy.detectionRange || 200)) {
            this.enemyChasePlayer(enemy, playerTransform, enemyMovement, enemyCombat, distance);
          } else {
            // TODO: 实现巡逻逻辑
          }
          break;
      }
    }
  }

  /**
   * 敌人追击玩家
   * @param {Entity} enemy - 敌人实体
   * @param {TransformComponent} playerTransform - 玩家变换组件
   * @param {MovementComponent} enemyMovement - 敌人移动组件
   * @param {CombatComponent} enemyCombat - 敌人战斗组件
   * @param {number} distance - 与玩家的距离
   */
  enemyChasePlayer(enemy, playerTransform, enemyMovement, enemyCombat, distance) {
    const enemyTransform = enemy.getComponent('transform');
    
    // 如果在攻击范围内，攻击玩家
    if (distance <= (enemyCombat.attackRange || 40)) {
      // 停止移动
      if (enemyMovement) {
        enemyMovement.stop();
      }
      
      // 设置目标为玩家
      if (!enemyCombat.hasTarget() || enemyCombat.target !== this.player) {
        enemyCombat.setTarget(this.player);
      }
      
      // 尝试攻击
      const currentTime = performance.now();
      if (enemyCombat.canAttack(currentTime)) {
        this.performEnemyAttack(enemy, this.player, currentTime);
      }
    } else {
      // 移动向玩家
      if (enemyMovement) {
        const dx = playerTransform.position.x - enemyTransform.position.x;
        const dy = playerTransform.position.y - enemyTransform.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // 设置移动目标
        enemyMovement.setPath([{
          x: playerTransform.position.x,
          y: playerTransform.position.y
        }]);
      }
    }
  }

  /**
   * 执行敌人攻击
   * @param {Entity} enemy - 敌人实体
   * @param {Entity} target - 目标实体
   * @param {number} currentTime - 当前时间
   */
  performEnemyAttack(enemy, target, currentTime) {
    const enemyCombat = enemy.getComponent('combat');
    const enemySprite = enemy.getComponent('sprite');
    const enemyTransform = enemy.getComponent('transform');
    
    if (!enemyCombat) return;
    
    // 执行攻击
    if (enemyCombat.attack(currentTime)) {
      // 播放攻击动画
      if (enemySprite) {
        enemySprite.playAnimation('attack');
        
        setTimeoutFn(() => {
          if (enemySprite.currentAnimation === 'attack') {
            enemySprite.playAnimation('idle');
          }
        }, 300);
      }
      
      // 创建攻击特效
      if (this.skillEffects && enemyTransform) {
        this.skillEffects.createSkillEffect('basic_attack', enemyTransform.position);
      }
      
      // 计算并应用伤害
      const damage = this.combatSystem.calculateDamage(enemy, target);
      this.combatSystem.applyDamage(target, damage);
      
      console.log(`${enemy.name} 攻击 ${target.name}，造成 ${damage} 点伤害`);
    }
  }

  /**
   * 移除死亡的实体
   */
  removeDeadEntities() {
    const deadEntities = this.combatSystem.getDeadEntities(this.entities);
    
    if (deadEntities.length > 0) {
      // 从实体列表中移除
      this.entities = this.entities.filter(e => !e.isDead);
      
      console.log(`GameScene: Removed ${deadEntities.length} dead entities`);
    }
  }

  /**
   * 新接口：双后端渲染入口
   * @param {import('../rendering/backends/IRenderBackend.js').IRenderBackend} backend
   */
  renderCommon(backend) {
    if (!this.isActive) return;
    if (!backend) return;
    const hudCtx = backend.getHUDContext?.();

    // 背景：若是 2D 后端，沿用 ctx 直绘；3D 后端留给 setMapData（M5 之后）
    if (hudCtx) {
      hudCtx.fillStyle = this.mapData?.backgroundColor || '#2d5016';
      hudCtx.fillRect(0, 0, hudCtx.canvas.width, hudCtx.canvas.height);
      this.renderMapBackground(hudCtx);
    }

    // 实体（2D 走 renderSystem；3D 走 backend.renderEntities）
    if (this.entities.length > 0) {
      if (backend.mode === '3d' && typeof backend.renderEntities === 'function') {
        backend.renderEntities(this.entities, backend.camera);
      } else {
        // 2D：复用现有 renderSystem
        this.renderSystem.render(this.entities);
      }
    }

    // 粒子
    if (this.particleSystem && typeof backend.renderParticles === 'function') {
      backend.renderParticles(this.particleSystem, backend.camera);
    } else if (hudCtx) {
      this.particleSystem?.render(hudCtx, this.camera);
    }

    // 技能特效（抛射物）
    if (this.skillEffects && typeof backend.renderEffects === 'function') {
      backend.renderEffects(this.skillEffects, backend.camera);
    } else if (hudCtx) {
      this.skillEffects?.render(hudCtx, this.camera);
    }

    // 战斗 UI（目标高亮、伤害数字）
    if (hudCtx) this.combatSystem?.render(hudCtx);

    // UI
    if (hudCtx) this.uiSystem?.render(hudCtx);
  }

  /**
   * 渲染场景
   * 兼容旧接口：直接传 CanvasRenderingContext2D
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  render(ctx) {
    if (!this.isActive) return;
    
    // 清空画布
    ctx.fillStyle = this.mapData?.backgroundColor || '#2d5016';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // 渲染地图背景
    this.renderMapBackground(ctx);
    
    // 渲染实体
    if (this.entities.length > 0) {
      this.renderSystem.render(this.entities);
    }
    
    // 渲染粒子
    this.particleSystem.render(ctx, this.camera);
    
    // 渲染技能特效（抛射物）
    this.skillEffects.render(ctx, this.camera);
    
    // 渲染战斗系统UI（目标高亮、伤害数字等）
    this.combatSystem.render(ctx);
    
    // 渲染UI
    this.uiSystem.render(ctx);
    

  }

  /**
   * 渲染地图背景
   * @param {CanvasRenderingContext2D} ctx - 渲染上下文
   */
  renderMapBackground(ctx) {
    if (!this.mapData) return;
    
    // 简单的纯色背景已经在render方法开始时绘制
    // 这里可以扩展为绘制瓦片地图
    
    // 绘制网格（调试用）
    if (false) { // 设置为true可以显示网格
      const viewBounds = this.camera.getViewBounds();
      const tileSize = this.mapData.tileSize;
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      
      // 垂直线
      for (let x = Math.floor(viewBounds.left / tileSize) * tileSize; x < viewBounds.right; x += tileSize) {
        const screenX = x - viewBounds.left;
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, ctx.canvas.height);
        ctx.stroke();
      }
      
      // 水平线
      for (let y = Math.floor(viewBounds.top / tileSize) * tileSize; y < viewBounds.bottom; y += tileSize) {
        const screenY = y - viewBounds.top;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(ctx.canvas.width, screenY);
        ctx.stroke();
      }
    }
  }

  /**
   * 处理输入
   * @param {InputManager} inputManager - 输入管理器
   */
  handleInput(inputManager) {
    // 检查ESC键退出游戏
    if (inputManager.isKeyPressed('escape')) {
      this.showPauseMenu();
    }
    
    // 检查C键打开属性面板
    if (inputManager.isKeyPressed('c') && this.attributePanel && !this.attributePanel.isOpen()) {
      this.attributePanel.show(this.player.id);
      console.log('GameScene: Attribute panel opened via input manager');
    }
    
    // 检查L键模拟升级（测试用）
    if (inputManager.isKeyPressed('l')) {
      this.simulateLevelUp();
    }
  }

  /**
   * 模拟升级（测试用）
   */
  simulateLevelUp() {
    if (!this.player || !this.attributeSystem) return;
    
    const statsComponent = this.player.getComponent('stats');
    if (!statsComponent) return;
    
    // 升级
    const oldLevel = statsComponent.level;
    statsComponent.levelUp();
    const newLevel = statsComponent.level;
    
    // 获得属性点
    this.attributeSystem.onLevelUp(this.player.id, newLevel);
    
    // 应用属性效果
    this.applyAttributeEffectsToPlayer();
    
    console.log(`Player leveled up from ${oldLevel} to ${newLevel}! Press C to allocate attribute points.`);
  }

  /**
   * 显示暂停菜单
   */
  showPauseMenu() {
    console.log('GameScene: Pause menu (not implemented yet)');
    // TODO: 实现暂停菜单
  }

  /**
   * 场景退出
   */
  exit() {
    super.exit();
    
    // 清理资源
    this.entities = [];
    this.player = null;
    
    // 清理粒子
    if (this.particleSystem) {
      this.particleSystem.clear();
    }
    
    if (this.skillEffects) {
      this.skillEffects.clear();
    }

    console.log('GameScene: Exited and cleaned up');
  }
}

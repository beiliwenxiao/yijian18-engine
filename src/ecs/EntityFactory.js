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
 * EntityFactory.js
 * 实体工厂 - 根据模板数据创建实体
 */

import { Entity } from './Entity.js';
import { TransformComponent } from './components/TransformComponent.js';
import { StatsComponent } from './components/StatsComponent.js';
import { SpriteComponent } from './components/SpriteComponent.js';
import { CombatComponent } from './components/CombatComponent.js';
import { MovementComponent } from './components/MovementComponent.js';
import { EquipmentComponent } from './components/EquipmentComponent.js';
import { InventoryComponent } from './components/InventoryComponent.js';
import { NameComponent } from './components/NameComponent.js';
import { LayerComponent } from './components/LayerComponent.js';
import { BuildingComponent } from './components/BuildingComponent.js';
import { VehicleComponent } from './components/VehicleComponent.js';
import { CargoComponent } from './components/CargoComponent.js';
import { ObjectiveComponent } from './components/ObjectiveComponent.js';
import { ControllerComponent, ControllerKind } from './components/ControllerComponent.js';
import { NpcComponent } from './components/NpcComponent.js';
import { ResourceNodeComponent } from './components/ResourceNodeComponent.js';
import { SkeletonComponent } from './components/SkeletonComponent.js';
import { createPlayerSkeletonStateMapper } from '../animation/PlayerSkeletonStateMapper.js';

/**
 * 实体工厂类
 * 提供创建各种游戏实体的工厂方法
 */
export class EntityFactory {
  constructor({ itemRuntimeFactory = null, manifestReader = null } = {}) {
    this.entityIdCounter = 0;
    this.itemRuntimeFactory = itemRuntimeFactory;
    // Manifest 读取器：(stableId) => manifestEntry|null，用于骨骼资产判定（资产级替换）
    this.manifestReader = typeof manifestReader === 'function' ? manifestReader : null;
  }

  /**
   * 注入 Manifest 读取器（宿主 Scene 在 assetManager 就绪后调用；懒访问安全）。
   * @param {(stableId: string) => Object|null} reader
   */
  setManifestReader(reader) {
    this.manifestReader = typeof reader === 'function' ? reader : null;
    return this;
  }

  /**
   * 注入骨骼动画依赖（assetManager 访问器）：身体槽位帧表按实体实际贴图计算。
   * @param {{ getAssetManager: () => Object|null }} deps
   */
  setAnimationDeps(deps) {
    this.animationDeps = deps && typeof deps.getAssetManager === 'function' ? deps : null;
    return this;
  }

  /**
   * 稳定 ID 指向骨骼资产（manifest runtime2D.mode==='skeleton'）时：
   * SpriteComponent 标记 isSkeleton 并清空帧动画（保留外观语义），挂 SkeletonComponent。
   * playAnimation 由 SpriteComponent 兼容转发到 playClip，杜绝双驱动。
   */
  _attachSkeletonIfAsset(entity, sprite, stableSpriteId) {
    if (!sprite || !stableSpriteId || !this.manifestReader) return;
    const entry = this.manifestReader(stableSpriteId);
    if (entry?.runtime2D?.mode !== 'skeleton') return;
    sprite.isSkeleton = true;
    sprite.animations.clear();
    const skeletonComponent = new SkeletonComponent({
      skeletonId: stableSpriteId,
      deps: this.animationDeps
    });
    sprite.skeletonDelegate = skeletonComponent;
    // 角色/生物实体挂状态映射器：连续状态（死亡/灵魂/攀爬/行走/待机）自动驱动剪辑
    skeletonComponent.stateHook = createPlayerSkeletonStateMapper(entity, this.animationDeps || {});
    entity.addComponent(skeletonComponent);
  }

  /**
   * Manifest 就绪后补挂骨骼组件（玩家实体创建早于异步 Manifest 注册的场景）。
   * @param {Entity} entity
   * @param {string} stableSpriteId
   */
  attachSkeletonForEntity(entity, stableSpriteId) {
    if (!entity || entity.getComponent?.('skeleton')) return false;
    const sprite = entity.getComponent?.('sprite');
    if (!sprite) return false;
    this._attachSkeletonIfAsset(entity, sprite, stableSpriteId);
    return sprite.isSkeleton === true;
  }

  setItemRuntimeFactory(itemRuntimeFactory) {
    if (!itemRuntimeFactory?.createDeathDropProjection) {
      throw new TypeError('EntityFactory requires ItemRuntimeFactory');
    }
    this.itemRuntimeFactory = itemRuntimeFactory;
    return this;
  }

  /**
   * 生成唯一实体ID
   * @returns {string}
   */
  generateId() {
    return `entity_${++this.entityIdCounter}`;
  }

  /**
   * 创建玩家实体
   * @param {Object} characterData - 角色数据
   * @param {string} characterData.name - 角色名称
   * @param {string} characterData.class - 职业
   * @param {number} characterData.level - 等级
   * @param {Object} characterData.stats - 属性数据
   * @param {Object} characterData.position - 位置
   * @param {Array} characterData.skills - 技能列表
   * @returns {Entity}
   */
  createPlayer(characterData) {
    const entity = new Entity(characterData.id || this.generateId(), 'player');
    
    // 设置阵营（玩家/友军阵营）
    entity.faction = 'ally';
    
    // 添加变换组件
    const position = characterData.position || { x: 0, y: 0 };
    entity.addComponent(new TransformComponent(position.x, position.y));
    
    // 添加属性组件
    const stats = characterData.stats || {};
    entity.addComponent(new StatsComponent({
      maxHp: stats.maxHp || 100,
      hp: stats.hp,
      maxMp: stats.maxMp || 100,
      mp: stats.mp,
      attack: stats.attack || 10,
      defense: stats.defense || 5,
      speed: stats.speed || 100,
      level: characterData.level || 1,
      exp: characterData.exp || 0,
      mainElement: stats.mainElement || 0,
      elementAttack: stats.elementAttack || {},
      elementDefense: stats.elementDefense || {},
      unitType: stats.unitType || 0
    }));
    
    // 添加精灵组件（默认使用4x8动画精灵，可由 characterData 覆盖）
    // characterData.spriteSheet  - 覆盖精灵图集名称
    // characterData.spriteConfig - 覆盖/合并精灵配置（如静态单图主角）
    const spriteSheet = characterData.spriteSheet || 'player_animated';
    const defaultSpriteConfig = {
      width: 64,   // 放大两倍：32 -> 64
      height: 64,  // 放大两倍：32 -> 64
      defaultAnimation: 'idle',
      useAnimatedSprite: true,   // 启用动画精灵
      spriteColumns: 4,          // 4列（动画帧）
      spriteRows: 8,             // 8行（方向）
      direction: 'down',         // 默认朝下
      walkFrameDuration: 150,    // 每帧150ms
      directionRowMap: {
        'down-left': 0,
        'up-right': 1,
        'up-left': 2,
        'down-right': 3,
        'left': 4,
        'right': 5,
        'up': 6,
        'down': 7,
        'idle': 7       // idle用down行
      }
    };
    const sprite = new SpriteComponent(spriteSheet, {
      ...defaultSpriteConfig,
      ...(characterData.spriteConfig || {})
    });
    
    // 添加基础动画
    this.addCharacterAnimations(sprite);
    entity.addComponent(sprite);
    // 主角绑定骨骼资产（manifest 资产级替换）
    this._attachSkeletonIfAsset(entity, sprite, spriteSheet);

    // 添加战斗组件
    const combat = new CombatComponent({
      attackRange: 50,
      attackCooldown: 1000
    });
    
    // 添加技能
    if (characterData.skills) {
      characterData.skills.forEach(skill => {
        combat.addSkill(skill);
      });
    }
    entity.addComponent(combat);
    
    // 添加移动组件
    entity.addComponent(new MovementComponent({
      speed: stats.speed || 100
    }));
    
    // 添加装备组件
    entity.addComponent(new EquipmentComponent({
      equipment: characterData.equipment || {}
    }));
    
    // 添加背包组件
    entity.addComponent(new InventoryComponent({
      maxSlots: Math.max(1, Math.floor(Number(characterData.inventorySlots) || 24)),
      items: characterData.inventory || []
    }));
    
    // 存储角色名称和职业
    entity.name = characterData.name;
    entity.class = characterData.class;
    
    // 默认分层
    entity.addComponent(new LayerComponent({ worldLayer: 'entity' }));

    return entity;
  }

  /**
   * 创建敌人实体
   * @param {Object} enemyData - 敌人数据
   * @param {string} enemyData.templateId - 敌人模板ID
   * @param {string} enemyData.name - 敌人名称
   * @param {number} enemyData.level - 等级
   * @param {Object} enemyData.stats - 属性数据
   * @param {Object} enemyData.position - 位置
   * @param {string} enemyData.aiType - AI类型
   * @returns {Entity}
   */
  createEnemy(enemyData) {
    const entity = new Entity(enemyData.id || this.generateId(), 'enemy');
    
    // 设置阵营；faction 保留敌我兼容语义，factionId 保存 canonical 战役阵营。
    entity.faction = enemyData.faction || 'enemy';
    entity.factionId = enemyData.factionId || entity.faction;
    
    // 添加变换组件
    const position = enemyData.position || { x: 0, y: 0 };
    entity.addComponent(new TransformComponent(position.x, position.y));
    // 出生锚点：AI 脱战回归与原地游荡的基准点。
    entity.spawnAnchor = { x: position.x, y: position.y };

    // 添加属性组件
    const stats = enemyData.stats || {};
    entity.addComponent(new StatsComponent({
      maxHp: stats.maxHp || 50,
      hp: stats.hp,
      maxMp: stats.maxMp || 0,
      mp: stats.mp,
      attack: stats.attack || 5,
      defense: stats.defense || 2,
      speed: stats.speed || 80,
      level: enemyData.level || 1,
      exp: 0,
      mainElement: stats.mainElement || 0,
      elementAttack: stats.elementAttack || {},
      elementDefense: stats.elementDefense || {},
      unitType: stats.unitType || 0
    }));
    
    // 添加精灵组件：稳定 imageId/assetId 优先，模板图集仅作兼容回退。
    const spriteCfg = enemyData.sprite || {};
    const stableSpriteId = enemyData.imageId || enemyData.assetId
      || spriteCfg.imageId || spriteCfg.assetId || '';
    const spriteSheet = stableSpriteId || spriteCfg.sheet || spriteCfg.src
      || enemyData.spriteSheet || this.getSpriteSheetForEnemy(enemyData.templateId);
    const isStatic = Boolean(stableSpriteId) ? spriteCfg.isStatic !== false : !!spriteCfg.isStatic;
    const isAnimated = !isStatic && spriteSheet.startsWith('enemy_animated_');
    const sprite = new SpriteComponent(spriteSheet, {
      width: spriteCfg.width || spriteCfg.frameWidth || enemyData.width || (isAnimated ? 64 : 32),
      height: spriteCfg.height || spriteCfg.frameHeight || enemyData.height || (isAnimated ? 64 : 32),
      isStatic,
      defaultAnimation: 'idle',
      useAnimatedSprite: isAnimated,
      spriteColumns: isAnimated ? 4 : undefined,
      spriteRows: isAnimated ? 8 : undefined,
      direction: 'down',
      walkFrameDuration: 150,
      directionRowMap: isAnimated ? {
        'down-left': 0,
        'up-right': 1,
        'up-left': 2,
        'down-right': 3,
        'left': 4,
        'right': 5,
        'up': 6,
        'down': 7,
        'idle': 7
      } : undefined
    });
    
    // 添加基础动画
    this.addCharacterAnimations(sprite);
    entity.addComponent(sprite);
    // 敌人绑定骨骼资产（manifest 资产级替换）
    this._attachSkeletonIfAsset(entity, sprite, stableSpriteId);

    // 添加战斗组件
    const combat = new CombatComponent({
      // 攻击范围：库定义 enemy.attackRange 优先（如狼王扑击距离），未配置维持 40 现状
      attackRange: Number(enemyData.attackRange) > 0 ? Number(enemyData.attackRange) : 40,
      attackCooldown: 1500
    });
    entity.addComponent(combat);
    
    // 添加移动组件
    entity.addComponent(new MovementComponent({
      speed: stats.speed || 80
    }));
    
    // 添加名字组件
    entity.addComponent(new NameComponent(enemyData.name, {
      // 同阵营友军（faction 显式非敌，如黄巾粮仓哨兵/波才/张曼成）显示绿色名字
      color: enemyData.faction && enemyData.faction !== 'enemy' ? '#66ff66' : '#ff6666',
      fontSize: 14,
      offsetY: -10
    }));
    
    // 存储敌人信息；所有敌人默认保留尸体，具体内容可追加采集定义或专用表现。
    entity.name = enemyData.name;
    entity.contentId = enemyData.contentId || enemyData.id || null;
    entity.definitionId = enemyData.contentId || enemyData.id || null;
    entity.templateId = enemyData.templateId;
    entity.renderStyle = enemyData.renderStyle || null;
    entity.aiType = enemyData.aiType || 'passive';
    // AI 行为画像（可选）：库定义 enemy.ai ← placement overrides.ai 已由 PlacementSpawner
    // mergeOverrides 合成；AISystem 据此驱动巡逻/警戒/追击/回家（无 ai 块 = 现行为零回归）。
    entity.aiProfile = enemyData.ai && typeof enemyData.ai === 'object'
      ? JSON.parse(JSON.stringify(enemyData.ai))
      : null;
    entity.lootTable = enemyData.lootTable || [];
    // 虚弱攻击上限（可选）：enemy.maxDamage > 0 时该敌人单次攻击伤害不超过此值
    //（结算跳过通用 1~5 随机下限，剧情弱狼 0~1 伤害即由此实现）。
    entity.maxDamage = Number(enemyData.maxDamage) > 0 ? Number(enemyData.maxDamage) : null;
    const corpseDefinition = enemyData.corpse && typeof enemyData.corpse === 'object'
      ? enemyData.corpse
      : {};
    entity.corpseDefinition = {
      ...corpseDefinition,
      name: corpseDefinition.name || `${enemyData.name || '怪物'}尸体`,
      ...(corpseDefinition.resourceNode
        ? { resourceNode: JSON.parse(JSON.stringify(corpseDefinition.resourceNode)) }
        : {})
    };
    
    // 添加敌人标签
    entity.tags = entity.tags || [];
    entity.tags.push('enemy');
    
    // 默认分层
    entity.addComponent(new LayerComponent({ worldLayer: 'entity' }));

    return entity;
  }

  /**
   * 根据职业获取精灵图集
   * @param {string} className - 职业名称
   * @returns {string}
   */
  getSpriteSheetForClass(className) {
    // 返回九宫格方向精灵的名称
    const spriteSheets = {
      'warrior': 'directional_warrior',
      'strategist': 'directional_strategist',
      'archer': 'directional_archer',
      'refugee': 'directional_refugee'
    };
    return spriteSheets[className] || 'directional_refugee';
  }

  /**
   * 根据敌人模板ID获取精灵图集
   * @param {string} templateId - 模板ID
   * @returns {string}
   */
  getSpriteSheetForEnemy(templateId) {
    // 支持4x8动画精灵的敌人类型
    const animatedEnemies = {
      'wild_dog': 'enemy_animated_wild_dog',
      'soldier': 'enemy_animated_soldier',
      'government_soldier': 'enemy_animated_government_soldier',
      'bandit': 'enemy_animated_bandit',
      'starving': 'enemy_animated_starving',
      'refugee': 'enemy_animated_refugee'
    };
    if (animatedEnemies[templateId]) {
      return animatedEnemies[templateId];
    }
    const spriteSheets = {
      'slime': 'slime_sprite',
      'goblin': 'goblin_sprite',
      'skeleton': 'skeleton_sprite'
    };
    return spriteSheets[templateId] || 'enemy_default_sprite';
  }

  /**
   * 为角色添加基础动画
   * @param {SpriteComponent} sprite - 精灵组件
   */
  addCharacterAnimations(sprite) {
    // 待机动画
    sprite.addAnimation('idle', {
      frames: [0],
      frameRate: 1,
      loop: true
    });
    
    // 行走动画
    sprite.addAnimation('walk', {
      frames: [0, 1, 2, 3],
      frameRate: 8,
      loop: true
    });
    
    // 攻击动画
    sprite.addAnimation('attack', {
      frames: [4, 5, 6],
      frameRate: 10,
      loop: false
    });
    
    // 技能动画
    sprite.addAnimation('skill', {
      frames: [7, 8, 9],
      frameRate: 10,
      loop: false
    });
    
    // 受击动画
    sprite.addAnimation('hit', {
      frames: [10],
      frameRate: 10,
      loop: false
    });
    
    // 死亡动画
    sprite.addAnimation('death', {
      frames: [11, 12, 13],
      frameRate: 8,
      loop: false
    });
  }

  /**
   * 创建NPC实体
   * @param {Object} npcData - NPC数据
   * @returns {Entity}
   */
  createNPC(npcData) {
    const entity = new Entity(npcData.id || this.generateId(), 'npc');

    // 变换组件
    const position = npcData.position || { x: 0, y: 0 };
    entity.addComponent(new TransformComponent(position.x, position.y));
    // 出生锚点：AI 脱战回归与原地游荡的基准点。
    entity.spawnAnchor = { x: position.x, y: position.y };

    // ---- 精灵组件（稳定图片 ID / 序列帧配置）----
    // imageId/assetId 由 AssetManager Manifest 解析；旧 sprite.src/sheet 继续兼容。
    const spriteCfg = npcData.sprite || {};
    const stableSpriteId = npcData.imageId || npcData.assetId
      || spriteCfg.imageId || spriteCfg.assetId || '';
    const sheet = stableSpriteId || spriteCfg.sheet || spriteCfg.src || npcData.spriteSheet || '';
    const frameW = spriteCfg.frameWidth || spriteCfg.width || npcData.width || 32;
    const frameH = spriteCfg.frameHeight || spriteCfg.height || npcData.height || 32;
    const cols = spriteCfg.cols || 1;
    const sprite = new SpriteComponent(sheet, {
      width: frameW,
      height: frameH,
      isStatic: stableSpriteId ? spriteCfg.isStatic !== false : !!spriteCfg.isStatic,
      defaultAnimation: spriteCfg.defaultAnimation || 'idle'
    });
    sprite.scale = spriteCfg.scale || 1;
    // 动作配置：注册所有动画（两种格式归一化为帧索引数组）
    const anims = spriteCfg.animations || { idle: { row: 0, frames: 1, speed: 0.5 } };
    let firstAnim = null;
    for (const [name, a] of Object.entries(anims)) {
      if (!firstAnim) firstAnim = name;
      let frames, frameRate;
      if (Array.isArray(a.frames)) {
        // 简写格式：frames 已是索引数组
        frames = a.frames;
        frameRate = a.frameRate || 4;
      } else {
        // 编辑器格式：{row, frames:数量, speed:秒/帧} → 展开为帧索引数组
        const count = a.frames || 1;
        const row = a.row || 0;
        frames = [];
        for (let i = 0; i < count; i++) frames.push(row * cols + i);
        frameRate = a.speed ? (1 / a.speed) : 4;
      }
      sprite.addAnimation(name, {
        frames,
        frameRate,
        loop: a.loop !== undefined ? a.loop : true
      });
    }
    sprite.playAnimation(spriteCfg.defaultAnimation || firstAnim || 'idle', true);
    entity.addComponent(sprite);
    // NPC 绑定骨骼资产（manifest 资产级替换）
    this._attachSkeletonIfAsset(entity, sprite, stableSpriteId);

    // ---- 名字组件（含称号）----
    entity.addComponent(new NameComponent(npcData.name || 'NPC', {
      color: npcData.faction === 'hostile' ? '#ff6666' : '#ffffff'
    }));

    // ---- 属性组件（可选，兼容 stats / baseStats）----
    const npcStats = npcData.stats || npcData.baseStats;
    if (npcStats) {
      entity.addComponent(new StatsComponent(npcStats));
    }

    // ---- NPC 组件（交互/对话/立绘/阵营）----
    entity.addComponent(new NpcComponent(npcData));

    // 兼容旧字段
    entity.name = npcData.name;
    entity.dialogue = npcData.dialogue || [];

    // 分层（entity 层参与 Y-sort）
    entity.addComponent(new LayerComponent({ worldLayer: 'entity' }));

    return entity;
  }

  /**
   * 创建建筑实体（城墙/城门/箭塔/兵营，§14.3）
   * @param {Object} data - { id, buildingType, position, maxHp, team, footprint, colliderRadius, controllable, onDestroyed, spriteSheet, name }
   * @returns {Entity}
   */
  /**
   * 创建静态世界道具（如煮粥大锅）——归类为物品(worldProp)，但作为场景静物渲染，不可拾取。
   * 支持序列帧图片(sprite.src/spriteSheet)或内置代码渲染样式(renderStyle)。
   * @param {Object} data - 道具定义（来自 library.items 且 worldProp:true）
   */
  createProp(data = {}) {
    const entity = new Entity(data.id || this.generateId(), 'prop');
    const position = data.position || { x: 0, y: 0 };
    entity.addComponent(new TransformComponent(position.x, position.y));

    // 代码渲染样式（无图时用内置绘制）
    if (data.renderStyle) entity.renderStyle = data.renderStyle;

    // 精灵（稳定静态图片、序列帧图片或占位；有 renderStyle 也需要 sprite 进入渲染流程）
    const spCfg = data.sprite || {};
    const stableId = data.imageId || data.assetId || spCfg.imageId || spCfg.assetId || '';
    const sheet = stableId || spCfg.sheet || spCfg.src || data.spriteSheet || '';
    const sprite = new SpriteComponent(sheet, {
      width: spCfg.width || spCfg.frameWidth || data.width || 64,
      height: spCfg.height || spCfg.frameHeight || data.height || 64,
      defaultAnimation: 'idle',
      isStatic: spCfg.isStatic === true || Boolean(stableId),
      visible: spCfg.visible !== false
    });
    sprite.visible = spCfg.visible !== false;
    sprite.scale = spCfg.scale || data.scale || 1;
    sprite.addAnimation('idle', { frames: [0], frameRate: 1, loop: true });
    entity.addComponent(sprite);

    if (data.name) entity.addComponent(new NameComponent(data.name, { color: '#ddd', fontSize: 12, offsetY: -18, visible: data.showName !== false }));
    entity.name = data.name || 'prop';
    entity.addComponent(new LayerComponent({ worldLayer: 'entity' }));
    return entity;
  }

  createResourceNode(data = {}) {
    const entity = new Entity(data.id || this.generateId(), 'resourceNode');
    const position = data.position || { x: 0, y: 0 };
    entity.addComponent(new TransformComponent(position.x, position.y));
    entity.addComponent(new ResourceNodeComponent(data));

    const spriteCfg = data.sprite || {};
    const stableSpriteId = data.imageId || data.assetId
      || spriteCfg.imageId || spriteCfg.assetId || '';
    const sprite = new SpriteComponent(
      stableSpriteId || spriteCfg.sheet || spriteCfg.src || data.spriteSheet || '',
      {
        width: spriteCfg.width || spriteCfg.frameWidth || data.width || 48,
        height: spriteCfg.height || spriteCfg.frameHeight || data.height || 48,
        isStatic: stableSpriteId ? spriteCfg.isStatic !== false : !!spriteCfg.isStatic,
        color: data.resourceType === 'herb' ? '#69a83c' : '#8b6238',
        defaultAnimation: 'idle'
      }
    );
    sprite.addAnimation('idle', { frames: [0], frameRate: 1, loop: true });
    entity.addComponent(sprite);
    entity.addComponent(new NameComponent(data.name || data.resourceType || '资源节点', {
      color: '#f0dfb0', fontSize: 12, offsetY: -12
    }));
    entity.name = data.name || data.resourceType || '资源节点';
    entity.tags = ['resourceNode', data.resourceType].filter(Boolean);
    // 深度排序抬升：依附在大树等装饰物上的节点（如果丛贴在树冠上）把排序基线
    // 抬到装饰物脚底之上，否则 y 排序会让装饰树冠盖住节点贴图。
    entity.sortYOffset = Math.max(0, Number(data.sortYOffset) || 0);
    entity.addComponent(new LayerComponent({ worldLayer: 'entity' }));
    return entity;
  }

  createDeathDrop(data = {}) {
    if (!this.itemRuntimeFactory) {
      throw new Error('EntityFactory.createDeathDrop requires injected ItemRuntimeFactory');
    }
    return this.itemRuntimeFactory.createDeathDropProjection({
      ...data,
      entityId: data.entityId || data.id,
      transform: data.transform || data.position,
      presentation: data.presentation || data
    });
  }

  createBuilding(data = {}) {
    const entity = new Entity(data.id || this.generateId(), 'building');
    entity.faction = data.team || 'neutral';

    const position = data.position || { x: 0, y: 0 };
    entity.addComponent(new TransformComponent(position.x, position.y));

    entity.addComponent(new BuildingComponent({
      buildingType: data.buildingType,
      maxHp: data.maxHp,
      hp: data.hp,
      team: data.team,
      footprint: data.footprint,
      colliderRadius: data.colliderRadius,
      controllable: data.controllable,
      onDestroyed: data.onDestroyed
    }));

    // 代码渲染样式（无精灵图时用内置绘制，如 'cauldron'）
    if (data.renderStyle) entity.renderStyle = data.renderStyle;

    // 稳定资源 ID 优先，旧 spriteSheet/renderStyle 仅作兼容降级。
    const stableId = data.imageId || data.assetId || '';
    if (stableId || data.spriteSheet || data.renderStyle) {
      const sprite = new SpriteComponent(stableId || data.spriteSheet || '', {
        width: data.width || 64,
        height: data.height || 64,
        defaultAnimation: 'idle',
        isStatic: Boolean(stableId)
      });
      sprite.scale = data.scale || 1;
      sprite.addAnimation('idle', { frames: [0], frameRate: 1, loop: true });
      entity.addComponent(sprite);
    }

    // 可控建筑（如箭塔）挂控制者，默认 AI
    if (data.controllable) {
      entity.addComponent(new ControllerComponent({ kind: ControllerKind.AI, team: data.team }));
    }

    if (data.name) entity.addComponent(new NameComponent(data.name, { color: '#ddd', fontSize: 13, offsetY: -20 }));
    entity.name = data.name || data.buildingType;
    entity.addComponent(new LayerComponent({ worldLayer: 'entity' }));
    return entity;
  }

  /**
   * 创建载具实体（战马/战车/八床弩，§14.3）
   * @param {Object} data - { id, vehicleType, position, speed, turnRate, maxHp, seats, onDestroyed, spriteSheet, team, name }
   * @returns {Entity}
   */
  createVehicle(data = {}) {
    const entity = new Entity(data.id || this.generateId(), 'vehicle');
    entity.faction = data.team || 'neutral';

    const position = data.position || { x: 0, y: 0 };
    entity.addComponent(new TransformComponent(position.x, position.y));

    entity.addComponent(new VehicleComponent({
      vehicleType: data.vehicleType,
      speed: data.speed,
      turnRate: data.turnRate,
      maxHp: data.maxHp,
      hp: data.hp,
      seats: data.seats,
      onDestroyed: data.onDestroyed,
      logistics: data.logistics
    }));
    if (data.cargo) entity.addComponent(new CargoComponent({
      ...data.cargo,
      definitionResolver: id => this.itemRuntimeFactory?.resolveDefinition?.(id) || null
    }));

    // 载具移动能力（复用 MovementSystem）
    entity.addComponent(new MovementComponent({ speed: data.speed != null ? data.speed : 120 }));

    // 载具本体控制者（driver 席位有人时被接管）
    entity.addComponent(new ControllerComponent({ kind: ControllerKind.AI, team: data.team }));

    const stableId = data.imageId || data.assetId || '';
    if (stableId || data.spriteSheet) {
      const sprite = new SpriteComponent(stableId || data.spriteSheet, {
        width: data.width || 64,
        height: data.height || 64,
        defaultAnimation: 'idle',
        isStatic: Boolean(stableId)
      });
      sprite.scale = data.scale || 1;
      sprite.addAnimation('idle', { frames: [0], frameRate: 1, loop: true });
      entity.addComponent(sprite);
      // 载具绑定骨骼资产（manifest 资产级替换）
      this._attachSkeletonIfAsset(entity, sprite, stableId || data.spriteSheet);
    }

    entity.name = data.name || data.vehicleType;
    entity.addComponent(new LayerComponent({ worldLayer: 'entity' }));
    return entity;
  }

  /**
   * 为已有实体附加战场目标物标记（§14.3）
   * @param {Entity} entity
   * @param {Object} data - ObjectiveComponent 配置
   * @returns {Entity}
   */
  attachObjective(entity, data = {}) {
    if (!entity) return entity;
    entity.addComponent(new ObjectiveComponent(data));
    return entity;
  }
}

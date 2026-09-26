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
 * DungeonSystem.js
 * 副本系统 - 管理副本创建、进入、奖励和特殊机制
 */

/**
 * 副本难度枚举
 */
export const DungeonDifficulty = {
  EASY: 'easy',
  NORMAL: 'normal',
  HARD: 'hard',
  NIGHTMARE: 'nightmare'
};

/**
 * 副本状态枚举
 */
export const DungeonState = {
  LOCKED: 'locked',
  AVAILABLE: 'available',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * 副本奖励类
 */
export class DungeonReward {
  /**
   * @param {Object} config - 奖励配置
   */
  constructor(config) {
    this.exp = config.exp || 0;
    this.gold = config.gold || 0;
    this.items = config.items || []; // [{itemId, quantity, dropRate}]
    this.bonusExp = config.bonusExp || 0; // 首次通关奖励
    this.bonusGold = config.bonusGold || 0;
    this.bonusItems = config.bonusItems || [];
    // 掉落随机：注入 rng（RNG 实例）时走确定性序列，否则退化为 Math.random
    this.rng = config.rng || null;
  }

  /** [0,1) 掉落随机，注入 rng 时确定可复现 */
  _rng() {
    return this.rng ? this.rng.next() : Math.random();
  }

  /**
   * 计算实际掉落物品
   * @param {boolean} isFirstClear - 是否首次通关
   * @returns {Object} 奖励结果
   */
  calculateRewards(isFirstClear = false) {
    const rewards = {
      exp: this.exp,
      gold: this.gold,
      items: []
    };

    // 计算物品掉落
    for (const item of this.items) {
      if (this._rng() < item.dropRate) {
        rewards.items.push({
          itemId: item.itemId,
          quantity: item.quantity || 1
        });
      }
    }

    // 首次通关奖励
    if (isFirstClear) {
      rewards.exp += this.bonusExp;
      rewards.gold += this.bonusGold;
      for (const item of this.bonusItems) {
        rewards.items.push({
          itemId: item.itemId,
          quantity: item.quantity || 1
        });
      }
    }

    return rewards;
  }
}

/**
 * 副本波次类
 */
export class DungeonWave {
  /**
   * @param {Object} config - 波次配置
   */
  constructor(config) {
    this.waveNumber = config.waveNumber || 1;
    this.enemies = config.enemies || []; // [{enemyType, count, level}]
    this.spawnDelay = config.spawnDelay || 0; // 生成延迟（毫秒）
    this.isBossWave = config.isBossWave || false;
    this.isCompleted = false;
    this.remainingEnemies = 0;
  }

  /**
   * 获取敌人总数
   * @returns {number}
   */
  getTotalEnemyCount() {
    return this.enemies.reduce((sum, e) => sum + e.count, 0);
  }

  /**
   * 开始波次
   */
  start() {
    this.remainingEnemies = this.getTotalEnemyCount();
    this.isCompleted = false;
  }

  /**
   * 敌人被击杀
   */
  onEnemyKilled() {
    this.remainingEnemies--;
    if (this.remainingEnemies <= 0) {
      this.isCompleted = true;
    }
  }
}

/**
 * 副本实例类
 */
export class DungeonInstance {
  /**
   * @param {Object} config - 副本配置
   * @param {string} config.id - 副本ID
   * @param {string} config.templateId - 副本模板ID
   * @param {string} config.difficulty - 难度
   * @param {Object} config.character - 角色数据
   */
  constructor(config) {
    this.id = config.id || `dungeon_${Date.now()}`;
    this.templateId = config.templateId;
    this.difficulty = config.difficulty || DungeonDifficulty.NORMAL;
    this.character = config.character;
    
    this.state = DungeonState.IN_PROGRESS;
    this.currentWave = 0;
    this.waves = [];
    this.startTime = Date.now();
    this.timeLimit = config.timeLimit || 0; // 0表示无时间限制
    this.remainingTime = this.timeLimit;
    
    // 统计数据
    this.stats = {
      enemiesKilled: 0,
      damageTaken: 0,
      damageDealt: 0,
      itemsCollected: 0
    };
    
    // 回调
    this.onWaveStart = null;
    this.onWaveComplete = null;
    this.onDungeonComplete = null;
    this.onDungeonFail = null;
  }

  /**
   * 添加波次
   * @param {DungeonWave} wave
   */
  addWave(wave) {
    this.waves.push(wave);
  }

  /**
   * 开始副本
   */
  start() {
    this.state = DungeonState.IN_PROGRESS;
    this.startTime = Date.now();
    this.startNextWave();
  }

  /**
   * 开始下一波
   */
  startNextWave() {
    if (this.currentWave >= this.waves.length) {
      this.complete();
      return;
    }

    const wave = this.waves[this.currentWave];
    wave.start();
    this.onWaveStart && this.onWaveStart(wave, this.currentWave + 1);
  }

  /**
   * 敌人被击杀
   */
  onEnemyKilled() {
    this.stats.enemiesKilled++;
    
    const currentWave = this.waves[this.currentWave];
    if (currentWave) {
      currentWave.onEnemyKilled();
      
      if (currentWave.isCompleted) {
        this.onWaveComplete && this.onWaveComplete(currentWave, this.currentWave + 1);
        this.currentWave++;
        
        // 延迟开始下一波
        setTimeout(() => this.startNextWave(), 2000);
      }
    }
  }

  /**
   * 更新副本状态
   * @param {number} deltaTime - 时间增量（毫秒）
   */
  update(deltaTime) {
    if (this.state !== DungeonState.IN_PROGRESS) return;

    // 更新时间限制
    if (this.timeLimit > 0) {
      this.remainingTime = Math.max(0, this.timeLimit - (Date.now() - this.startTime));
      if (this.remainingTime <= 0) {
        this.fail('时间耗尽');
      }
    }
  }

  /**
   * 完成副本
   */
  complete() {
    this.state = DungeonState.COMPLETED;
    this.onDungeonComplete && this.onDungeonComplete(this);
  }

  /**
   * 副本失败
   * @param {string} reason - 失败原因
   */
  fail(reason) {
    this.state = DungeonState.FAILED;
    this.onDungeonFail && this.onDungeonFail(this, reason);
  }

  /**
   * 获取当前波次
   * @returns {DungeonWave|null}
   */
  getCurrentWave() {
    return this.waves[this.currentWave] || null;
  }

  /**
   * 获取进度百分比
   * @returns {number}
   */
  getProgress() {
    if (this.waves.length === 0) return 0;
    return (this.currentWave / this.waves.length) * 100;
  }

  /**
   * 获取已用时间（秒）
   * @returns {number}
   */
  getElapsedTime() {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

/**
 * 副本模板类
 */
export class DungeonTemplate {
  /**
   * @param {Object} config - 副本模板配置
   */
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description || '';
    this.minLevel = config.minLevel || 1;
    this.maxPlayers = config.maxPlayers || 1;
    this.timeLimit = config.timeLimit || 0; // 秒，0表示无限制
    this.entryCost = config.entryCost || 0; // 入场费用
    this.dailyLimit = config.dailyLimit || 0; // 每日次数限制，0表示无限制
    this.cooldown = config.cooldown || 0; // 冷却时间（秒）
    
    // 难度配置
    this.difficulties = config.difficulties || [DungeonDifficulty.NORMAL];
    
    // 波次配置（按难度）
    this.waveConfigs = config.waveConfigs || {};
    
    // 奖励配置（按难度）
    this.rewards = config.rewards || {};
    
    // 解锁条件
    this.unlockCondition = config.unlockCondition || null;
    
    // 状态
    this.isUnlocked = !config.unlockCondition;
  }

  /**
   * 检查是否可以进入
   * @param {Object} character - 角色数据
   * @param {string} difficulty - 难度
   * @returns {Object} {canEnter: boolean, reason: string}
   */
  canEnter(character, difficulty = DungeonDifficulty.NORMAL) {
    if (!this.isUnlocked) {
      return { canEnter: false, reason: '副本未解锁' };
    }

    if (character.level < this.minLevel) {
      return { canEnter: false, reason: `需要等级 ${this.minLevel}` };
    }

    if (!this.difficulties.includes(difficulty)) {
      return { canEnter: false, reason: '该难度不可用' };
    }

    if (this.entryCost > 0 && (character.gold || 0) < this.entryCost) {
      return { canEnter: false, reason: `需要 ${this.entryCost} 金币` };
    }

    // 检查每日次数
    if (this.dailyLimit > 0) {
      const todayCount = character.dungeonCounts?.[this.id] || 0;
      if (todayCount >= this.dailyLimit) {
        return { canEnter: false, reason: '今日次数已用完' };
      }
    }

    return { canEnter: true, reason: '' };
  }

  /**
   * 创建副本实例
   * @param {Object} character - 角色数据
   * @param {string} difficulty - 难度
   * @returns {DungeonInstance}
   */
  createInstance(character, difficulty = DungeonDifficulty.NORMAL) {
    const instance = new DungeonInstance({
      templateId: this.id,
      difficulty: difficulty,
      character: character,
      timeLimit: this.timeLimit * 1000 // 转换为毫秒
    });

    // 添加波次
    const waveConfig = this.waveConfigs[difficulty] || this.waveConfigs[DungeonDifficulty.NORMAL] || [];
    for (let i = 0; i < waveConfig.length; i++) {
      instance.addWave(new DungeonWave({
        waveNumber: i + 1,
        ...waveConfig[i]
      }));
    }

    return instance;
  }

  /**
   * 获取奖励
   * @param {string} difficulty - 难度
   * @returns {DungeonReward}
   */
  getReward(difficulty = DungeonDifficulty.NORMAL) {
    const rewardConfig = this.rewards[difficulty] || this.rewards[DungeonDifficulty.NORMAL] || {};
    return new DungeonReward(rewardConfig);
  }

  /**
   * 解锁副本
   */
  unlock() {
    this.isUnlocked = true;
  }
}


/**
 * 副本系统主类
 */
export class DungeonSystem {
  constructor() {
    this.templates = new Map();
    this.activeInstances = new Map();
    this.completedDungeons = new Map(); // 记录完成情况
    
    // 回调
    this.onDungeonEnter = null;
    this.onDungeonExit = null;
    this.onRewardClaimed = null;
    
    // 初始化默认副本
    this.initializeDefaultDungeons();
  }

  /**
   * 初始化默认副本
   */
  initializeDefaultDungeons() {
    // 新手试炼
    this.addTemplate(new DungeonTemplate({
      id: 'beginner_trial',
      name: '新手试炼',
      description: '适合新手的简单副本，学习战斗基础',
      minLevel: 1,
      maxPlayers: 1,
      timeLimit: 300, // 5分钟
      dailyLimit: 5,
      difficulties: [DungeonDifficulty.EASY, DungeonDifficulty.NORMAL],
      waveConfigs: {
        [DungeonDifficulty.EASY]: [
          { enemies: [{ enemyType: 'slime', count: 3, level: 1 }] },
          { enemies: [{ enemyType: 'slime', count: 5, level: 1 }] },
          { enemies: [{ enemyType: 'goblin', count: 2, level: 2 }], isBossWave: true }
        ],
        [DungeonDifficulty.NORMAL]: [
          { enemies: [{ enemyType: 'slime', count: 5, level: 2 }] },
          { enemies: [{ enemyType: 'goblin', count: 3, level: 3 }] },
          { enemies: [{ enemyType: 'slime', count: 3, level: 2 }, { enemyType: 'goblin', count: 2, level: 3 }] },
          { enemies: [{ enemyType: 'goblin_chief', count: 1, level: 5 }], isBossWave: true }
        ]
      },
      rewards: {
        [DungeonDifficulty.EASY]: {
          exp: 50, gold: 30,
          items: [{ itemId: 'potion_hp_small', quantity: 2, dropRate: 0.8 }],
          bonusExp: 100, bonusGold: 50
        },
        [DungeonDifficulty.NORMAL]: {
          exp: 100, gold: 60,
          items: [
            { itemId: 'potion_hp_small', quantity: 3, dropRate: 0.9 },
            { itemId: 'weapon_sword_basic', quantity: 1, dropRate: 0.3 }
          ],
          bonusExp: 200, bonusGold: 100,
          bonusItems: [{ itemId: 'equipment_box_common', quantity: 1 }]
        }
      }
    }));

    // 幽暗矿洞
    this.addTemplate(new DungeonTemplate({
      id: 'dark_mine',
      name: '幽暗矿洞',
      description: '废弃的矿洞深处，充满了亡灵生物',
      minLevel: 5,
      maxPlayers: 1,
      timeLimit: 600, // 10分钟
      dailyLimit: 3,
      entryCost: 50,
      difficulties: [DungeonDifficulty.NORMAL, DungeonDifficulty.HARD],
      unlockCondition: { minLevel: 5 },
      waveConfigs: {
        [DungeonDifficulty.NORMAL]: [
          { enemies: [{ enemyType: 'skeleton', count: 4, level: 5 }] },
          { enemies: [{ enemyType: 'skeleton', count: 3, level: 5 }, { enemyType: 'bat', count: 5, level: 4 }] },
          { enemies: [{ enemyType: 'skeleton_warrior', count: 2, level: 6 }] },
          { enemies: [{ enemyType: 'skeleton', count: 5, level: 5 }, { enemyType: 'skeleton_warrior', count: 2, level: 6 }] },
          { enemies: [{ enemyType: 'skeleton_king', count: 1, level: 8 }], isBossWave: true }
        ],
        [DungeonDifficulty.HARD]: [
          { enemies: [{ enemyType: 'skeleton', count: 6, level: 7 }] },
          { enemies: [{ enemyType: 'skeleton_warrior', count: 4, level: 8 }] },
          { enemies: [{ enemyType: 'skeleton', count: 5, level: 7 }, { enemyType: 'skeleton_mage', count: 2, level: 8 }] },
          { enemies: [{ enemyType: 'skeleton_warrior', count: 3, level: 8 }, { enemyType: 'skeleton_mage', count: 2, level: 8 }] },
          { enemies: [{ enemyType: 'skeleton_king', count: 1, level: 10 }, { enemyType: 'skeleton_warrior', count: 2, level: 8 }], isBossWave: true }
        ]
      },
      rewards: {
        [DungeonDifficulty.NORMAL]: {
          exp: 300, gold: 150,
          items: [
            { itemId: 'potion_hp_medium', quantity: 2, dropRate: 0.7 },
            { itemId: 'ore_iron', quantity: 5, dropRate: 0.6 },
            { itemId: 'weapon_sword_iron', quantity: 1, dropRate: 0.2 }
          ],
          bonusExp: 500, bonusGold: 200,
          bonusItems: [{ itemId: 'equipment_box_rare', quantity: 1 }]
        },
        [DungeonDifficulty.HARD]: {
          exp: 500, gold: 300,
          items: [
            { itemId: 'potion_hp_medium', quantity: 3, dropRate: 0.8 },
            { itemId: 'ore_iron', quantity: 10, dropRate: 0.7 },
            { itemId: 'weapon_sword_steel', quantity: 1, dropRate: 0.3 },
            { itemId: 'armor_plate_iron', quantity: 1, dropRate: 0.2 }
          ],
          bonusExp: 800, bonusGold: 400,
          bonusItems: [{ itemId: 'equipment_box_epic', quantity: 1 }]
        }
      }
    }));

    // 毒沼深渊
    this.addTemplate(new DungeonTemplate({
      id: 'poison_abyss',
      name: '毒沼深渊',
      description: '剧毒弥漫的沼泽深处，危险重重',
      minLevel: 10,
      maxPlayers: 1,
      timeLimit: 900, // 15分钟
      dailyLimit: 2,
      entryCost: 100,
      difficulties: [DungeonDifficulty.NORMAL, DungeonDifficulty.HARD, DungeonDifficulty.NIGHTMARE],
      unlockCondition: { minLevel: 10 },
      waveConfigs: {
        [DungeonDifficulty.NORMAL]: [
          { enemies: [{ enemyType: 'poison_frog', count: 5, level: 10 }] },
          { enemies: [{ enemyType: 'swamp_creature', count: 3, level: 11 }] },
          { enemies: [{ enemyType: 'poison_snake', count: 4, level: 10 }, { enemyType: 'poison_frog', count: 3, level: 10 }] },
          { enemies: [{ enemyType: 'swamp_creature', count: 4, level: 11 }] },
          { enemies: [{ enemyType: 'swamp_hydra', count: 1, level: 13 }], isBossWave: true }
        ],
        [DungeonDifficulty.HARD]: [
          { enemies: [{ enemyType: 'poison_frog', count: 8, level: 12 }] },
          { enemies: [{ enemyType: 'swamp_creature', count: 5, level: 13 }] },
          { enemies: [{ enemyType: 'poison_snake', count: 6, level: 12 }, { enemyType: 'swamp_creature', count: 3, level: 13 }] },
          { enemies: [{ enemyType: 'swamp_creature', count: 4, level: 13 }, { enemyType: 'poison_elemental', count: 2, level: 14 }] },
          { enemies: [{ enemyType: 'swamp_hydra', count: 1, level: 15 }, { enemyType: 'poison_elemental', count: 2, level: 14 }], isBossWave: true }
        ],
        [DungeonDifficulty.NIGHTMARE]: [
          { enemies: [{ enemyType: 'poison_frog', count: 10, level: 15 }] },
          { enemies: [{ enemyType: 'swamp_creature', count: 6, level: 16 }, { enemyType: 'poison_elemental', count: 3, level: 16 }] },
          { enemies: [{ enemyType: 'poison_snake', count: 8, level: 15 }, { enemyType: 'swamp_creature', count: 4, level: 16 }] },
          { enemies: [{ enemyType: 'poison_elemental', count: 5, level: 16 }] },
          { enemies: [{ enemyType: 'swamp_hydra', count: 1, level: 18 }, { enemyType: 'poison_elemental', count: 3, level: 16 }], isBossWave: true }
        ]
      },
      rewards: {
        [DungeonDifficulty.NORMAL]: {
          exp: 600, gold: 300,
          items: [
            { itemId: 'potion_hp_large', quantity: 2, dropRate: 0.7 },
            { itemId: 'antidote', quantity: 5, dropRate: 0.8 },
            { itemId: 'poison_essence', quantity: 3, dropRate: 0.5 }
          ],
          bonusExp: 1000, bonusGold: 500
        },
        [DungeonDifficulty.HARD]: {
          exp: 1000, gold: 500,
          items: [
            { itemId: 'potion_hp_large', quantity: 3, dropRate: 0.8 },
            { itemId: 'poison_essence', quantity: 5, dropRate: 0.6 },
            { itemId: 'weapon_dagger_poison', quantity: 1, dropRate: 0.25 }
          ],
          bonusExp: 1500, bonusGold: 800,
          bonusItems: [{ itemId: 'equipment_box_epic', quantity: 1 }]
        },
        [DungeonDifficulty.NIGHTMARE]: {
          exp: 1500, gold: 800,
          items: [
            { itemId: 'potion_hp_large', quantity: 5, dropRate: 0.9 },
            { itemId: 'poison_essence', quantity: 10, dropRate: 0.7 },
            { itemId: 'weapon_dagger_venom', quantity: 1, dropRate: 0.3 },
            { itemId: 'armor_scale_hydra', quantity: 1, dropRate: 0.2 }
          ],
          bonusExp: 2500, bonusGold: 1200,
          bonusItems: [{ itemId: 'equipment_box_legendary', quantity: 1 }]
        }
      }
    }));

    // 古堡地牢
    this.addTemplate(new DungeonTemplate({
      id: 'castle_dungeon',
      name: '古堡地牢',
      description: '古老城堡的地下监狱，黑暗领主的巢穴',
      minLevel: 15,
      maxPlayers: 1,
      timeLimit: 1200, // 20分钟
      dailyLimit: 1,
      entryCost: 200,
      cooldown: 3600, // 1小时冷却
      difficulties: [DungeonDifficulty.HARD, DungeonDifficulty.NIGHTMARE],
      unlockCondition: { minLevel: 15 },
      waveConfigs: {
        [DungeonDifficulty.HARD]: [
          { enemies: [{ enemyType: 'skeleton_knight', count: 4, level: 15 }] },
          { enemies: [{ enemyType: 'ghost', count: 5, level: 15 }, { enemyType: 'skeleton_knight', count: 2, level: 15 }] },
          { enemies: [{ enemyType: 'vampire_spawn', count: 3, level: 16 }] },
          { enemies: [{ enemyType: 'skeleton_knight', count: 3, level: 15 }, { enemyType: 'vampire_spawn', count: 2, level: 16 }] },
          { enemies: [{ enemyType: 'ghost', count: 4, level: 15 }, { enemyType: 'death_knight', count: 1, level: 17 }] },
          { enemies: [{ enemyType: 'dark_lord', count: 1, level: 20 }], isBossWave: true }
        ],
        [DungeonDifficulty.NIGHTMARE]: [
          { enemies: [{ enemyType: 'skeleton_knight', count: 6, level: 18 }] },
          { enemies: [{ enemyType: 'ghost', count: 6, level: 18 }, { enemyType: 'death_knight', count: 2, level: 19 }] },
          { enemies: [{ enemyType: 'vampire_spawn', count: 5, level: 19 }] },
          { enemies: [{ enemyType: 'death_knight', count: 3, level: 19 }, { enemyType: 'vampire_spawn', count: 3, level: 19 }] },
          { enemies: [{ enemyType: 'vampire_lord', count: 1, level: 20 }, { enemyType: 'death_knight', count: 2, level: 19 }] },
          { enemies: [{ enemyType: 'dark_lord', count: 1, level: 25 }, { enemyType: 'vampire_lord', count: 1, level: 20 }], isBossWave: true }
        ]
      },
      rewards: {
        [DungeonDifficulty.HARD]: {
          exp: 2000, gold: 1000,
          items: [
            { itemId: 'potion_hp_large', quantity: 5, dropRate: 0.9 },
            { itemId: 'dark_essence', quantity: 5, dropRate: 0.6 },
            { itemId: 'weapon_sword_dark', quantity: 1, dropRate: 0.2 },
            { itemId: 'armor_plate_dark', quantity: 1, dropRate: 0.15 }
          ],
          bonusExp: 3000, bonusGold: 1500,
          bonusItems: [{ itemId: 'equipment_box_legendary', quantity: 1 }]
        },
        [DungeonDifficulty.NIGHTMARE]: {
          exp: 3500, gold: 2000,
          items: [
            { itemId: 'potion_hp_large', quantity: 10, dropRate: 1.0 },
            { itemId: 'dark_essence', quantity: 10, dropRate: 0.8 },
            { itemId: 'weapon_sword_shadow', quantity: 1, dropRate: 0.3 },
            { itemId: 'armor_plate_shadow', quantity: 1, dropRate: 0.25 },
            { itemId: 'accessory_ring_dark', quantity: 1, dropRate: 0.2 }
          ],
          bonusExp: 5000, bonusGold: 3000,
          bonusItems: [
            { itemId: 'equipment_box_legendary', quantity: 2 },
            { itemId: 'title_dark_slayer', quantity: 1 }
          ]
        }
      }
    }));

    // 解锁新手试炼
    this.getTemplate('beginner_trial')?.unlock();
  }

  /**
   * 添加副本模板
   * @param {DungeonTemplate} template
   */
  addTemplate(template) {
    this.templates.set(template.id, template);
  }

  /**
   * 获取副本模板
   * @param {string} templateId
   * @returns {DungeonTemplate|null}
   */
  getTemplate(templateId) {
    return this.templates.get(templateId) || null;
  }

  /**
   * 获取所有副本模板
   * @returns {Array<DungeonTemplate>}
   */
  getAllTemplates() {
    return Array.from(this.templates.values());
  }

  /**
   * 获取可用副本
   * @param {Object} character
   * @returns {Array<DungeonTemplate>}
   */
  getAvailableDungeons(character) {
    return this.getAllTemplates().filter(t => t.isUnlocked && character.level >= t.minLevel);
  }

  /**
   * 进入副本
   * @param {string} templateId
   * @param {Object} character
   * @param {string} difficulty
   * @returns {Object} {success: boolean, instance: DungeonInstance|null, message: string}
   */
  enterDungeon(templateId, character, difficulty = DungeonDifficulty.NORMAL) {
    const template = this.getTemplate(templateId);
    if (!template) {
      return { success: false, instance: null, message: '副本不存在' };
    }

    const canEnter = template.canEnter(character, difficulty);
    if (!canEnter.canEnter) {
      return { success: false, instance: null, message: canEnter.reason };
    }

    // 扣除入场费
    if (template.entryCost > 0) {
      character.gold = (character.gold || 0) - template.entryCost;
    }

    // 增加今日次数
    if (!character.dungeonCounts) character.dungeonCounts = {};
    character.dungeonCounts[templateId] = (character.dungeonCounts[templateId] || 0) + 1;

    // 创建副本实例
    const instance = template.createInstance(character, difficulty);
    this.activeInstances.set(instance.id, instance);

    // 设置回调
    instance.onDungeonComplete = (inst) => this.handleDungeonComplete(inst);
    instance.onDungeonFail = (inst, reason) => this.handleDungeonFail(inst, reason);

    this.onDungeonEnter && this.onDungeonEnter(instance);

    return { success: true, instance: instance, message: `进入副本: ${template.name}` };
  }

  /**
   * 退出副本
   * @param {string} instanceId
   * @returns {boolean}
   */
  exitDungeon(instanceId) {
    const instance = this.activeInstances.get(instanceId);
    if (!instance) return false;

    instance.fail('主动退出');
    this.activeInstances.delete(instanceId);
    this.onDungeonExit && this.onDungeonExit(instance);

    return true;
  }

  /**
   * 处理副本完成
   * @param {DungeonInstance} instance
   */
  handleDungeonComplete(instance) {
    const template = this.getTemplate(instance.templateId);
    if (!template) return;

    // 检查是否首次通关
    const completionKey = `${instance.templateId}_${instance.difficulty}`;
    const isFirstClear = !this.completedDungeons.has(completionKey);
    
    if (isFirstClear) {
      this.completedDungeons.set(completionKey, true);
    }

    // 计算奖励
    const reward = template.getReward(instance.difficulty);
    const rewards = reward.calculateRewards(isFirstClear);

    // 发放奖励
    if (instance.character) {
      instance.character.exp = (instance.character.exp || 0) + rewards.exp;
      instance.character.gold = (instance.character.gold || 0) + rewards.gold;
    }

    this.onRewardClaimed && this.onRewardClaimed(instance, rewards, isFirstClear);
    this.activeInstances.delete(instance.id);
  }

  /**
   * 处理副本失败
   * @param {DungeonInstance} instance
   * @param {string} reason
   */
  handleDungeonFail(instance, reason) {
    console.log(`副本失败: ${reason}`);
    this.activeInstances.delete(instance.id);
  }

  /**
   * 获取活动副本实例
   * @param {string} instanceId
   * @returns {DungeonInstance|null}
   */
  getActiveInstance(instanceId) {
    return this.activeInstances.get(instanceId) || null;
  }

  /**
   * 解锁副本
   * @param {string} templateId
   * @returns {boolean}
   */
  unlockDungeon(templateId) {
    const template = this.getTemplate(templateId);
    if (template) {
      template.unlock();
      return true;
    }
    return false;
  }

  /**
   * 检查并解锁副本
   * @param {Object} character
   */
  checkAndUnlockDungeons(character) {
    for (const template of this.templates.values()) {
      if (!template.isUnlocked && template.unlockCondition) {
        if (character.level >= (template.unlockCondition.minLevel || 0)) {
          template.unlock();
          console.log(`解锁副本: ${template.name}`);
        }
      }
    }
  }

  /**
   * 重置每日次数
   */
  resetDailyCounts() {
    // 这个方法应该在每日重置时调用
    console.log('重置每日副本次数');
  }

  /**
   * 设置回调
   */
  setOnDungeonEnter(callback) { this.onDungeonEnter = callback; }
  setOnDungeonExit(callback) { this.onDungeonExit = callback; }
  setOnRewardClaimed(callback) { this.onRewardClaimed = callback; }
}

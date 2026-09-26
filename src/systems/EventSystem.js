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
 * EventSystem.js
 * 动态事件系统 - 管理世界事件、随机事件和事件奖励
 */

/**
 * 事件类型枚举
 */
export const EventType = {
  ELITE_SPAWN: 'elite_spawn',       // 精英怪刷新
  TREASURE_CHEST: 'treasure_chest', // 宝箱出现
  WORLD_BOSS: 'world_boss',         // 世界Boss
  INVASION: 'invasion',             // 怪物入侵
  BONUS_EXP: 'bonus_exp',           // 经验加成
  BONUS_DROP: 'bonus_drop',         // 掉落加成
  MERCHANT: 'merchant',             // 神秘商人
  PORTAL: 'portal'                  // 随机传送门
};

/**
 * 事件状态枚举
 */
export const EventState = {
  PENDING: 'pending',       // 等待开始
  ACTIVE: 'active',         // 进行中
  COMPLETED: 'completed',   // 已完成
  EXPIRED: 'expired',       // 已过期
  FAILED: 'failed'          // 失败
};

/**
 * 事件奖励类
 */
export class EventReward {
  constructor(config = {}) {
    this.exp = config.exp || 0;
    this.gold = config.gold || 0;
    this.items = config.items || [];
    this.participationReward = config.participationReward || null;
    // 掉落随机：注入 rng（RNG 实例）时走确定性序列，否则退化为 Math.random
    this.rng = config.rng || null;
  }

  /** [0,1) 掉落随机 */
  _rng() {
    return this.rng ? this.rng.next() : Math.random();
  }

  /**
   * 计算奖励
   * @param {number} contribution - 贡献度 (0-1)
   * @returns {Object}
   */
  calculate(contribution = 1) {
    return {
      exp: Math.floor(this.exp * contribution),
      gold: Math.floor(this.gold * contribution),
      items: this.items.filter(item => this._rng() < (item.dropRate || 1) * contribution)
    };
  }
}

/**
 * 世界事件类
 */
export class WorldEvent {
  /**
   * @param {Object} config - 事件配置
   */
  constructor(config) {
    this.id = config.id || `event_${Date.now()}`;
    this.type = config.type;
    this.name = config.name;
    this.description = config.description || '';
    this.mapId = config.mapId;
    this.position = config.position || { x: 0, y: 0 };
    this.radius = config.radius || 100;
    
    // 时间相关
    this.startTime = config.startTime || Date.now();
    this.duration = config.duration || 300000; // 默认5分钟
    this.endTime = this.startTime + this.duration;
    
    // 状态
    this.state = EventState.PENDING;
    this.participants = new Map(); // 参与者及其贡献度
    this.progress = 0;
    this.maxProgress = config.maxProgress || 100;
    
    // 奖励
    this.reward = new EventReward(config.reward || {});
    
    // 事件特定数据
    this.data = config.data || {};
    
    // 回调
    this.onStart = null;
    this.onComplete = null;
    this.onExpire = null;
    this.onProgress = null;
  }

  /**
   * 开始事件
   */
  start() {
    this.state = EventState.ACTIVE;
    this.startTime = Date.now();
    this.endTime = this.startTime + this.duration;
    this.onStart && this.onStart(this);
  }

  /**
   * 更新事件
   * @param {number} deltaTime - 时间增量
   */
  update(deltaTime) {
    if (this.state !== EventState.ACTIVE) return;

    // 检查是否过期
    if (Date.now() >= this.endTime) {
      this.expire();
      return;
    }
  }

  /**
   * 添加进度
   * @param {string} participantId - 参与者ID
   * @param {number} amount - 进度量
   */
  addProgress(participantId, amount) {
    if (this.state !== EventState.ACTIVE) return;

    // 记录参与者贡献
    const currentContribution = this.participants.get(participantId) || 0;
    this.participants.set(participantId, currentContribution + amount);

    this.progress = Math.min(this.maxProgress, this.progress + amount);
    this.onProgress && this.onProgress(this, this.progress);

    if (this.progress >= this.maxProgress) {
      this.complete();
    }
  }

  /**
   * 完成事件
   */
  complete() {
    this.state = EventState.COMPLETED;
    this.onComplete && this.onComplete(this);
  }

  /**
   * 事件过期
   */
  expire() {
    this.state = EventState.EXPIRED;
    this.onExpire && this.onExpire(this);
  }

  /**
   * 获取剩余时间（秒）
   * @returns {number}
   */
  getRemainingTime() {
    if (this.state !== EventState.ACTIVE) return 0;
    return Math.max(0, Math.floor((this.endTime - Date.now()) / 1000));
  }

  /**
   * 获取进度百分比
   * @returns {number}
   */
  getProgressPercent() {
    return (this.progress / this.maxProgress) * 100;
  }

  /**
   * 获取参与者奖励
   * @param {string} participantId - 参与者ID
   * @returns {Object}
   */
  getParticipantReward(participantId) {
    const contribution = this.participants.get(participantId) || 0;
    const totalContribution = Array.from(this.participants.values()).reduce((a, b) => a + b, 0);
    const ratio = totalContribution > 0 ? contribution / totalContribution : 0;
    return this.reward.calculate(ratio);
  }

  /**
   * 检查位置是否在事件范围内
   * @param {Object} position - 位置
   * @returns {boolean}
   */
  isInRange(position) {
    const dx = position.x - this.position.x;
    const dy = position.y - this.position.y;
    return Math.sqrt(dx * dx + dy * dy) <= this.radius;
  }
}

/**
 * 事件模板类
 */
export class EventTemplate {
  constructor(config) {
    this.id = config.id;
    this.type = config.type;
    this.name = config.name;
    this.description = config.description || '';
    this.duration = config.duration || 300000;
    this.maxProgress = config.maxProgress || 100;
    this.reward = config.reward || {};
    this.spawnCondition = config.spawnCondition || null;
    this.spawnChance = config.spawnChance || 0.1;
    this.cooldown = config.cooldown || 600000; // 默认10分钟冷却
    this.lastSpawnTime = 0;
    this.data = config.data || {};
    // 生成随机：注入 rng（RNG 实例）时走确定性序列，否则退化为 Math.random
    this.rng = config.rng || null;
  }

  /** [0,1) 生成随机 */
  _rng() {
    return this.rng ? this.rng.next() : Math.random();
  }

  /**
   * 检查是否可以生成
   * @param {Object} context - 上下文（地图、时间等）
   * @returns {boolean}
   */
  canSpawn(context) {
    // 检查冷却
    if (Date.now() - this.lastSpawnTime < this.cooldown) {
      return false;
    }

    // 检查生成条件
    if (this.spawnCondition) {
      if (this.spawnCondition.minPlayers && (context.playerCount || 0) < this.spawnCondition.minPlayers) {
        return false;
      }
      if (this.spawnCondition.mapIds && !this.spawnCondition.mapIds.includes(context.mapId)) {
        return false;
      }
      if (this.spawnCondition.timeRange) {
        const hour = new Date().getHours();
        if (hour < this.spawnCondition.timeRange.start || hour >= this.spawnCondition.timeRange.end) {
          return false;
        }
      }
    }

    return this._rng() < this.spawnChance;
  }

  /**
   * 创建事件实例
   * @param {string} mapId - 地图ID
   * @param {Object} position - 位置
   * @returns {WorldEvent}
   */
  createEvent(mapId, position) {
    this.lastSpawnTime = Date.now();
    
    return new WorldEvent({
      type: this.type,
      name: this.name,
      description: this.description,
      mapId: mapId,
      position: position,
      duration: this.duration,
      maxProgress: this.maxProgress,
      reward: this.reward,
      data: { ...this.data }
    });
  }
}

/**
 * 事件系统主类
 */
export class EventSystem {
  constructor() {
    this.templates = new Map();
    this.activeEvents = new Map();
    this.completedEvents = [];
    this.eventHistory = [];
    this.maxHistorySize = 100;
    
    // 事件监听器
    this.listeners = new Map();
    
    // 更新间隔
    this.updateInterval = 1000; // 1秒
    this.lastUpdateTime = 0;
    
    // 事件生成检查间隔
    this.spawnCheckInterval = 30000; // 30秒
    this.lastSpawnCheckTime = 0;
    
    // 初始化默认事件模板
    this.initDefaultTemplates();
  }

  /**
   * 初始化默认事件模板
   */
  initDefaultTemplates() {
    // 精英怪刷新事件
    this.registerTemplate(new EventTemplate({
      id: 'elite_spawn_forest',
      type: EventType.ELITE_SPAWN,
      name: '精英怪物出现',
      description: '一只强大的精英怪物出现在森林中！',
      duration: 600000, // 10分钟
      maxProgress: 100,
      reward: {
        exp: 500,
        gold: 200,
        items: [
          { id: 'rare_weapon', name: '稀有武器', dropRate: 0.3 },
          { id: 'elite_essence', name: '精英精华', dropRate: 0.8 }
        ]
      },
      spawnChance: 0.15,
      cooldown: 900000, // 15分钟冷却
      spawnCondition: {
        minPlayers: 1,
        mapIds: ['green_forest', 'dark_cave']
      },
      data: {
        eliteType: 'forest_guardian',
        eliteLevel: 15
      }
    }));

    // 宝箱出现事件
    this.registerTemplate(new EventTemplate({
      id: 'treasure_chest_random',
      type: EventType.TREASURE_CHEST,
      name: '神秘宝箱',
      description: '一个神秘的宝箱出现了！',
      duration: 300000, // 5分钟
      maxProgress: 1,
      reward: {
        exp: 100,
        gold: 500,
        items: [
          { id: 'gold_coin', name: '金币袋', dropRate: 1.0 },
          { id: 'rare_gem', name: '稀有宝石', dropRate: 0.2 }
        ]
      },
      spawnChance: 0.2,
      cooldown: 600000, // 10分钟冷却
      data: {
        chestType: 'golden'
      }
    }));

    // 世界Boss事件
    this.registerTemplate(new EventTemplate({
      id: 'world_boss_dragon',
      type: EventType.WORLD_BOSS,
      name: '远古巨龙降临',
      description: '远古巨龙从沉睡中苏醒，威胁着整个世界！',
      duration: 1800000, // 30分钟
      maxProgress: 1000,
      reward: {
        exp: 5000,
        gold: 2000,
        items: [
          { id: 'dragon_scale', name: '龙鳞', dropRate: 0.5 },
          { id: 'dragon_heart', name: '龙心', dropRate: 0.1 },
          { id: 'legendary_weapon', name: '传说武器', dropRate: 0.05 }
        ]
      },
      spawnChance: 0.05,
      cooldown: 7200000, // 2小时冷却
      spawnCondition: {
        minPlayers: 5,
        mapIds: ['boss_area', 'castle_throne']
      },
      data: {
        bossType: 'ancient_dragon',
        bossLevel: 50
      }
    }));

    // 怪物入侵事件
    this.registerTemplate(new EventTemplate({
      id: 'monster_invasion',
      type: EventType.INVASION,
      name: '怪物入侵',
      description: '大量怪物正在入侵村庄！',
      duration: 900000, // 15分钟
      maxProgress: 500,
      reward: {
        exp: 1000,
        gold: 500,
        items: [
          { id: 'invasion_token', name: '入侵徽章', dropRate: 1.0 },
          { id: 'defender_medal', name: '守护者勋章', dropRate: 0.3 }
        ]
      },
      spawnChance: 0.1,
      cooldown: 1800000, // 30分钟冷却
      spawnCondition: {
        minPlayers: 3,
        mapIds: ['starter_village']
      },
      data: {
        waveCount: 5,
        monstersPerWave: 10
      }
    }));

    // 经验加成事件
    this.registerTemplate(new EventTemplate({
      id: 'bonus_exp_event',
      type: EventType.BONUS_EXP,
      name: '经验狂欢',
      description: '限时双倍经验！',
      duration: 1800000, // 30分钟
      maxProgress: 1,
      reward: {
        exp: 0,
        gold: 0,
        items: []
      },
      spawnChance: 0.08,
      cooldown: 3600000, // 1小时冷却
      data: {
        expMultiplier: 2.0
      }
    }));

    // 掉落加成事件
    this.registerTemplate(new EventTemplate({
      id: 'bonus_drop_event',
      type: EventType.BONUS_DROP,
      name: '掉落狂欢',
      description: '限时双倍掉落率！',
      duration: 1800000, // 30分钟
      maxProgress: 1,
      reward: {
        exp: 0,
        gold: 0,
        items: []
      },
      spawnChance: 0.08,
      cooldown: 3600000, // 1小时冷却
      data: {
        dropMultiplier: 2.0
      }
    }));

    // 神秘商人事件
    this.registerTemplate(new EventTemplate({
      id: 'mysterious_merchant',
      type: EventType.MERCHANT,
      name: '神秘商人',
      description: '一位神秘的商人出现了，带来了稀有物品！',
      duration: 600000, // 10分钟
      maxProgress: 1,
      reward: {
        exp: 50,
        gold: 0,
        items: []
      },
      spawnChance: 0.12,
      cooldown: 1200000, // 20分钟冷却
      data: {
        merchantType: 'rare_goods',
        discountRate: 0.2
      }
    }));

    // 随机传送门事件
    this.registerTemplate(new EventTemplate({
      id: 'random_portal',
      type: EventType.PORTAL,
      name: '神秘传送门',
      description: '一个神秘的传送门出现了，通往未知的地方！',
      duration: 300000, // 5分钟
      maxProgress: 1,
      reward: {
        exp: 200,
        gold: 100,
        items: [
          { id: 'portal_shard', name: '传送门碎片', dropRate: 0.5 }
        ]
      },
      spawnChance: 0.1,
      cooldown: 900000, // 15分钟冷却
      data: {
        destinationType: 'random',
        possibleDestinations: ['secret_dungeon', 'treasure_room', 'boss_lair']
      }
    }));
  }

  /**
   * 注册事件模板
   * @param {EventTemplate} template
   */
  registerTemplate(template) {
    this.templates.set(template.id, template);
  }

  /**
   * 获取事件模板
   * @param {string} templateId
   * @returns {EventTemplate|null}
   */
  getTemplate(templateId) {
    return this.templates.get(templateId) || null;
  }

  /**
   * 获取所有模板
   * @returns {EventTemplate[]}
   */
  getAllTemplates() {
    return Array.from(this.templates.values());
  }

  /**
   * 创建事件
   * @param {string} templateId - 模板ID
   * @param {string} mapId - 地图ID
   * @param {Object} position - 位置
   * @returns {WorldEvent|null}
   */
  createEvent(templateId, mapId, position) {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const event = template.createEvent(mapId, position);
    this.activeEvents.set(event.id, event);
    
    // 设置事件回调
    event.onStart = (e) => this.emit('eventStart', e);
    event.onComplete = (e) => this.handleEventComplete(e);
    event.onExpire = (e) => this.handleEventExpire(e);
    event.onProgress = (e, progress) => this.emit('eventProgress', { event: e, progress });

    this.emit('eventCreated', event);
    return event;
  }

  /**
   * 开始事件
   * @param {string} eventId
   */
  startEvent(eventId) {
    const event = this.activeEvents.get(eventId);
    if (event && event.state === EventState.PENDING) {
      event.start();
    }
  }

  /**
   * 处理事件完成
   * @param {WorldEvent} event
   */
  handleEventComplete(event) {
    this.activeEvents.delete(event.id);
    this.completedEvents.push(event);
    this.addToHistory(event);
    this.emit('eventComplete', event);
  }

  /**
   * 处理事件过期
   * @param {WorldEvent} event
   */
  handleEventExpire(event) {
    this.activeEvents.delete(event.id);
    this.addToHistory(event);
    this.emit('eventExpire', event);
  }

  /**
   * 添加到历史记录
   * @param {WorldEvent} event
   */
  addToHistory(event) {
    this.eventHistory.push({
      id: event.id,
      type: event.type,
      name: event.name,
      state: event.state,
      mapId: event.mapId,
      startTime: event.startTime,
      endTime: Date.now(),
      participants: Array.from(event.participants.keys()),
      progress: event.progress
    });

    // 限制历史记录大小
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * 更新系统
   * @param {number} deltaTime - 时间增量（毫秒）
   */
  update(deltaTime) {
    const now = Date.now();

    // 更新活跃事件
    if (now - this.lastUpdateTime >= this.updateInterval) {
      this.lastUpdateTime = now;
      
      for (const event of this.activeEvents.values()) {
        event.update(deltaTime);
      }
    }
  }

  /**
   * 检查并生成随机事件
   * @param {Object} context - 上下文（地图、玩家数等）
   */
  checkAndSpawnEvents(context) {
    const now = Date.now();
    
    if (now - this.lastSpawnCheckTime < this.spawnCheckInterval) {
      return;
    }
    
    this.lastSpawnCheckTime = now;

    for (const template of this.templates.values()) {
      if (template.canSpawn(context)) {
        // 生成随机位置
        const position = this.generateRandomPosition(context.mapBounds);
        const event = this.createEvent(template.id, context.mapId, position);
        
        if (event) {
          event.start();
        }
      }
    }
  }

  /**
   * 生成随机位置
   * @param {Object} bounds - 地图边界
   * @returns {Object}
   */
  generateRandomPosition(bounds = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 }) {
    return {
      x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
      y: bounds.minY + Math.random() * (bounds.maxY - bounds.minY)
    };
  }

  /**
   * 参与事件
   * @param {string} eventId - 事件ID
   * @param {string} participantId - 参与者ID
   * @param {number} contribution - 贡献度
   */
  participate(eventId, participantId, contribution) {
    const event = this.activeEvents.get(eventId);
    if (event) {
      event.addProgress(participantId, contribution);
    }
  }

  /**
   * 获取活跃事件
   * @param {string} mapId - 可选，按地图筛选
   * @returns {WorldEvent[]}
   */
  getActiveEvents(mapId = null) {
    const events = Array.from(this.activeEvents.values());
    if (mapId) {
      return events.filter(e => e.mapId === mapId);
    }
    return events;
  }

  /**
   * 获取事件
   * @param {string} eventId
   * @returns {WorldEvent|null}
   */
  getEvent(eventId) {
    return this.activeEvents.get(eventId) || null;
  }

  /**
   * 获取事件历史
   * @param {number} limit - 限制数量
   * @returns {Object[]}
   */
  getEventHistory(limit = 20) {
    return this.eventHistory.slice(-limit);
  }

  /**
   * 获取范围内的事件
   * @param {Object} position - 位置
   * @param {number} radius - 半径
   * @returns {WorldEvent[]}
   */
  getEventsInRange(position, radius) {
    return Array.from(this.activeEvents.values()).filter(event => {
      const dx = event.position.x - position.x;
      const dy = event.position.y - position.y;
      return Math.sqrt(dx * dx + dy * dy) <= radius + event.radius;
    });
  }

  /**
   * 获取按类型分组的活跃事件
   * @returns {Object}
   */
  getEventsByType() {
    const grouped = {};
    for (const event of this.activeEvents.values()) {
      if (!grouped[event.type]) {
        grouped[event.type] = [];
      }
      grouped[event.type].push(event);
    }
    return grouped;
  }

  /**
   * 强制结束事件
   * @param {string} eventId
   */
  forceEndEvent(eventId) {
    const event = this.activeEvents.get(eventId);
    if (event) {
      event.state = EventState.FAILED;
      this.activeEvents.delete(eventId);
      this.addToHistory(event);
      this.emit('eventFailed', event);
    }
  }

  /**
   * 清理已完成的事件
   */
  cleanupCompletedEvents() {
    this.completedEvents = [];
  }

  /**
   * 添加事件监听器
   * @param {string} eventName
   * @param {Function} callback
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
  }

  /**
   * 移除事件监听器
   * @param {string} eventName
   * @param {Function} callback
   */
  off(eventName, callback) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   * @param {string} eventName
   * @param {*} data
   */
  emit(eventName, data) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  /**
   * 获取系统统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      activeEventCount: this.activeEvents.size,
      completedEventCount: this.completedEvents.length,
      historySize: this.eventHistory.length,
      templateCount: this.templates.size
    };
  }

  /**
   * 重置系统
   */
  reset() {
    this.activeEvents.clear();
    this.completedEvents = [];
    this.eventHistory = [];
    this.lastUpdateTime = 0;
    this.lastSpawnCheckTime = 0;
  }

  /**
   * 序列化
   * @returns {Object}
   */
  serialize() {
    return {
      activeEvents: Array.from(this.activeEvents.entries()).map(([id, event]) => ({
        id,
        type: event.type,
        name: event.name,
        mapId: event.mapId,
        position: event.position,
        state: event.state,
        progress: event.progress,
        maxProgress: event.maxProgress,
        startTime: event.startTime,
        endTime: event.endTime,
        participants: Array.from(event.participants.entries())
      })),
      eventHistory: this.eventHistory
    };
  }

  /**
   * 反序列化
   * @param {Object} data
   */
  deserialize(data) {
    if (data.eventHistory) {
      this.eventHistory = data.eventHistory;
    }
    
    // 注意：活跃事件需要重新创建，因为回调函数无法序列化
    // 这里只恢复历史记录
  }
}

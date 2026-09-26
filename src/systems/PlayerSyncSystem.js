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

import { setIntervalFn, clearIntervalFn } from '../core/Timers.js';

/**
 * PlayerSyncSystem.js
 * 玩家同步系统 - 管理其他玩家实体的创建、同步和显示
 */

/**
 * 玩家状态枚举
 */
export const PlayerState = {
  IDLE: 'idle',
  MOVING: 'moving',
  ATTACKING: 'attacking',
  CASTING: 'casting',
  DEAD: 'dead',
  OFFLINE: 'offline'
};

/**
 * 远程玩家数据结构
 */
export class RemotePlayer {
  constructor(data) {
    this.id = data.id || data.playerId;
    this.name = data.name || 'Unknown';
    this.level = data.level || 1;
    this.classType = data.classType || 'warrior';
    
    // 位置和移动
    this.position = { x: data.position?.x || 0, y: data.position?.y || 0 };
    this.targetPosition = null;
    this.velocity = { x: 0, y: 0 };
    this.direction = data.direction || 'down';
    this.speed = data.speed || 200;
    
    // 状态
    this.state = data.state || PlayerState.IDLE;
    this.hp = data.hp || 100;
    this.maxHp = data.maxHp || 100;
    this.mp = data.mp || 50;
    this.maxMp = data.maxMp || 50;
    
    // 外观
    this.appearance = data.appearance || {};
    this.equipment = data.equipment || {};
    
    // 同步相关
    this.lastUpdate = Date.now();
    this.positionHistory = [];
    this.maxHistoryLength = 10;
    this.interpolationDelay = 100; // ms
    
    // 显示相关
    this.visible = true;
    this.alpha = 1;
    this.nameVisible = true;
    this.hpBarVisible = true;
  }

  /**
   * 更新位置历史
   */
  addPositionHistory(position, timestamp) {
    this.positionHistory.push({
      position: { ...position },
      timestamp: timestamp || Date.now()
    });
    
    // 保持历史记录长度
    while (this.positionHistory.length > this.maxHistoryLength) {
      this.positionHistory.shift();
    }
  }

  /**
   * 获取插值位置
   */
  getInterpolatedPosition(renderTime) {
    if (this.positionHistory.length < 2) {
      return this.position;
    }
    
    const targetTime = renderTime - this.interpolationDelay;
    
    // 找到两个用于插值的状态
    let before = null, after = null;
    for (let i = 0; i < this.positionHistory.length - 1; i++) {
      if (this.positionHistory[i].timestamp <= targetTime && 
          this.positionHistory[i + 1].timestamp >= targetTime) {
        before = this.positionHistory[i];
        after = this.positionHistory[i + 1];
        break;
      }
    }
    
    if (!before || !after) {
      return this.position;
    }
    
    const t = (targetTime - before.timestamp) / (after.timestamp - before.timestamp);
    return {
      x: before.position.x + (after.position.x - before.position.x) * t,
      y: before.position.y + (after.position.y - before.position.y) * t
    };
  }

  /**
   * 更新玩家数据
   */
  update(data) {
    if (data.position) {
      this.addPositionHistory(data.position, data.timestamp);
      this.position = { ...data.position };
    }
    if (data.velocity) this.velocity = { ...data.velocity };
    if (data.direction) this.direction = data.direction;
    if (data.state) this.state = data.state;
    if (data.hp !== undefined) this.hp = data.hp;
    if (data.maxHp !== undefined) this.maxHp = data.maxHp;
    if (data.mp !== undefined) this.mp = data.mp;
    if (data.maxMp !== undefined) this.maxMp = data.maxMp;
    if (data.level !== undefined) this.level = data.level;
    if (data.equipment) this.equipment = { ...data.equipment };
    if (data.appearance) this.appearance = { ...data.appearance };
    
    this.lastUpdate = Date.now();
  }

  /**
   * 检查是否超时
   */
  isTimedOut(timeout = 30000) {
    return Date.now() - this.lastUpdate > timeout;
  }
}

/**
 * 玩家同步系统类
 */
export class PlayerSyncSystem {
  constructor(config = {}) {
    // 远程玩家管理
    this.remotePlayers = new Map();
    this.localPlayerId = null;
    
    // 配置
    this.config = {
      interpolationEnabled: config.interpolationEnabled !== false,
      interpolationDelay: config.interpolationDelay || 100,
      playerTimeout: config.playerTimeout || 30000,
      cleanupInterval: config.cleanupInterval || 5000,
      maxPlayers: config.maxPlayers || 100,
      viewDistance: config.viewDistance || 1000,
      ...config
    };
    
    // 事件监听器
    this.listeners = new Map();

    // 清理定时器（经边界注入，可测可停）
    this.cleanupTimer = null;
    this.setIntervalFn = config.setIntervalFn || setIntervalFn;
    this.clearIntervalFn = config.clearIntervalFn || clearIntervalFn;
    
    // 统计
    this.stats = {
      totalJoins: 0,
      totalLeaves: 0,
      syncUpdates: 0
    };
  }

  /**
   * 初始化系统
   */
  initialize(localPlayerId) {
    this.localPlayerId = localPlayerId;
    this.startCleanup();
  }

  /**
   * 销毁系统
   */
  destroy() {
    this.stopCleanup();
    this.remotePlayers.clear();
    this.listeners.clear();
  }

  /**
   * 开始清理定时器
   */
  startCleanup() {
    this.stopCleanup();
    this.cleanupTimer = this.setIntervalFn(() => {
      this.cleanupTimedOutPlayers();
    }, this.config.cleanupInterval);
  }

  /**
   * 停止清理定时器
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      this.clearIntervalFn(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 清理超时玩家
   */
  cleanupTimedOutPlayers() {
    const now = Date.now();
    const timedOut = [];
    
    this.remotePlayers.forEach((player, id) => {
      if (player.isTimedOut(this.config.playerTimeout)) {
        timedOut.push(id);
      }
    });
    
    timedOut.forEach(id => {
      this.removePlayer(id, 'timeout');
    });
  }

  /**
   * 添加远程玩家
   */
  addPlayer(data) {
    const playerId = data.id || data.playerId;
    
    // 不添加本地玩家
    if (playerId === this.localPlayerId) {
      return null;
    }
    
    // 检查玩家数量限制
    if (this.remotePlayers.size >= this.config.maxPlayers) {
      console.warn('PlayerSyncSystem: Max players reached');
      return null;
    }
    
    // 检查是否已存在
    if (this.remotePlayers.has(playerId)) {
      return this.updatePlayer(playerId, data);
    }
    
    const player = new RemotePlayer(data);
    player.interpolationDelay = this.config.interpolationDelay;
    
    this.remotePlayers.set(playerId, player);
    this.stats.totalJoins++;
    
    this.emit('playerJoin', { player, data });
    
    return player;
  }

  /**
   * 移除远程玩家
   */
  removePlayer(playerId, reason = 'leave') {
    const player = this.remotePlayers.get(playerId);
    if (!player) return false;
    
    this.remotePlayers.delete(playerId);
    this.stats.totalLeaves++;
    
    this.emit('playerLeave', { player, playerId, reason });
    
    return true;
  }

  /**
   * 更新远程玩家
   */
  updatePlayer(playerId, data) {
    const player = this.remotePlayers.get(playerId);
    if (!player) {
      // 如果玩家不存在，创建新玩家
      return this.addPlayer(data);
    }
    
    player.update(data);
    this.stats.syncUpdates++;
    
    this.emit('playerUpdate', { player, data });
    
    return player;
  }

  /**
   * 处理玩家移动
   */
  handlePlayerMove(data) {
    const playerId = data.playerId;
    if (playerId === this.localPlayerId) return;
    
    const player = this.remotePlayers.get(playerId);
    if (player) {
      player.update({
        position: data.position,
        velocity: data.velocity,
        direction: data.direction,
        state: data.velocity?.x || data.velocity?.y ? PlayerState.MOVING : PlayerState.IDLE,
        timestamp: data.timestamp
      });
      
      this.emit('playerMove', { player, data });
    }
  }

  /**
   * 处理玩家动作
   */
  handlePlayerAction(data) {
    const playerId = data.playerId;
    if (playerId === this.localPlayerId) return;
    
    const player = this.remotePlayers.get(playerId);
    if (player) {
      switch (data.action) {
        case 'attack':
          player.state = PlayerState.ATTACKING;
          break;
        case 'cast':
          player.state = PlayerState.CASTING;
          break;
        case 'die':
          player.state = PlayerState.DEAD;
          break;
        case 'respawn':
          player.state = PlayerState.IDLE;
          player.hp = player.maxHp;
          break;
      }
      
      this.emit('playerAction', { player, action: data.action, data: data.data });
    }
  }

  /**
   * 处理玩家同步
   */
  handlePlayerSync(data) {
    const playerId = data.playerId;
    if (playerId === this.localPlayerId) return;
    
    this.updatePlayer(playerId, data.state || data);
  }

  /**
   * 获取远程玩家
   */
  getPlayer(playerId) {
    return this.remotePlayers.get(playerId) || null;
  }

  /**
   * 获取所有远程玩家
   */
  getAllPlayers() {
    return Array.from(this.remotePlayers.values());
  }

  /**
   * 获取视野范围内的玩家
   */
  getPlayersInView(centerX, centerY, viewDistance = null) {
    const distance = viewDistance || this.config.viewDistance;
    const players = [];
    
    this.remotePlayers.forEach(player => {
      const dx = player.position.x - centerX;
      const dy = player.position.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= distance) {
        players.push(player);
      }
    });
    
    return players;
  }

  /**
   * 获取附近的玩家（按距离排序）
   */
  getNearbyPlayers(centerX, centerY, maxCount = 10) {
    const players = this.getAllPlayers().map(player => {
      const dx = player.position.x - centerX;
      const dy = player.position.y - centerY;
      return {
        player,
        distance: Math.sqrt(dx * dx + dy * dy)
      };
    });
    
    players.sort((a, b) => a.distance - b.distance);
    
    return players.slice(0, maxCount).map(p => p.player);
  }

  /**
   * 更新所有玩家（每帧调用）
   */
  update(deltaTime) {
    const renderTime = Date.now();
    
    this.remotePlayers.forEach(player => {
      // 更新插值位置
      if (this.config.interpolationEnabled) {
        player.renderPosition = player.getInterpolatedPosition(renderTime);
      } else {
        player.renderPosition = player.position;
      }
      
      // 更新状态（如果正在移动但速度为0，切换到空闲）
      if (player.state === PlayerState.MOVING) {
        if (Math.abs(player.velocity.x) < 0.1 && Math.abs(player.velocity.y) < 0.1) {
          player.state = PlayerState.IDLE;
        }
      }
    });
  }

  /**
   * 渲染所有玩家
   */
  render(ctx, camera = { x: 0, y: 0 }) {
    this.remotePlayers.forEach(player => {
      if (!player.visible) return;
      
      const renderPos = player.renderPosition || player.position;
      const screenX = renderPos.x - camera.x;
      const screenY = renderPos.y - camera.y;
      
      // 渲染玩家精灵
      this.renderPlayerSprite(ctx, player, screenX, screenY);
      
      // 渲染名称
      if (player.nameVisible) {
        this.renderPlayerName(ctx, player, screenX, screenY);
      }
      
      // 渲染血条
      if (player.hpBarVisible) {
        this.renderPlayerHpBar(ctx, player, screenX, screenY);
      }
    });
  }

  /**
   * 渲染玩家精灵
   */
  renderPlayerSprite(ctx, player, x, y) {
    ctx.save();
    ctx.globalAlpha = player.alpha;
    
    // 根据状态选择颜色
    let color = '#4CAF50'; // 默认绿色
    switch (player.state) {
      case PlayerState.ATTACKING:
        color = '#FF5722';
        break;
      case PlayerState.CASTING:
        color = '#9C27B0';
        break;
      case PlayerState.DEAD:
        color = '#9E9E9E';
        break;
      case PlayerState.OFFLINE:
        color = '#607D8B';
        break;
    }
    
    // 绘制玩家圆形
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 绘制方向指示器
    const directionAngles = {
      up: -Math.PI / 2,
      down: Math.PI / 2,
      left: Math.PI,
      right: 0
    };
    const angle = directionAngles[player.direction] || 0;
    
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12);
    ctx.lineTo(x + Math.cos(angle) * 20, y + Math.sin(angle) * 20);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    ctx.restore();
  }

  /**
   * 渲染玩家名称
   */
  renderPlayerName(ctx, player, x, y) {
    ctx.save();
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    
    // 绘制名称背景
    const nameText = `${player.name} Lv.${player.level}`;
    const textWidth = ctx.measureText(nameText).width;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x - textWidth / 2 - 4, y - 45, textWidth + 8, 16);
    
    // 绘制名称
    ctx.fillStyle = '#fff';
    ctx.fillText(nameText, x, y - 32);
    
    ctx.restore();
  }

  /**
   * 渲染玩家血条
   */
  renderPlayerHpBar(ctx, player, x, y) {
    const barWidth = 40;
    const barHeight = 4;
    const barX = x - barWidth / 2;
    const barY = y - 28;
    
    // 背景
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // 血量
    const hpPercent = Math.max(0, Math.min(1, player.hp / player.maxHp));
    let hpColor = '#4CAF50';
    if (hpPercent < 0.3) hpColor = '#f44336';
    else if (hpPercent < 0.6) hpColor = '#FF9800';
    
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
    
    // 边框
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  /**
   * 获取玩家数量
   */
  getPlayerCount() {
    return this.remotePlayers.size;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      currentPlayers: this.remotePlayers.size,
      maxPlayers: this.config.maxPlayers
    };
  }

  /**
   * 添加事件监听器
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
  }

  /**
   * 移除事件监听器
   */
  off(eventName, callback) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) callbacks.splice(index, 1);
    }
  }

  /**
   * 触发事件
   */
  emit(eventName, data) {
    const callbacks = this.listeners.get(eventName);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }
}

export default PlayerSyncSystem;

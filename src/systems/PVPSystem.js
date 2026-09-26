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
 * PVPSystem.js
 * PVP系统 - 管理玩家对战功能
 */

/**
 * PVP状态枚举
 */
export const PVPState = {
  PEACE: 'peace',       // 和平状态（白名）
  COMBAT: 'combat',     // 战斗状态
  HOSTILE: 'hostile'    // 敌对状态（红名）
};

/**
 * 竞技场状态
 */
export const ArenaState = {
  IDLE: 'idle',
  MATCHING: 'matching',
  READY: 'ready',
  IN_BATTLE: 'in_battle',
  FINISHED: 'finished'
};

/**
 * PVP配置
 */
export const PVPConfig = {
  // 红名相关
  hostileKillCount: 3,        // 杀死多少白名玩家变红名
  hostileDuration: 30 * 60 * 1000, // 红名持续时间(30分钟)
  
  // 死亡掉落
  deathDropRate: 0.1,         // 死亡掉落比例(10%)
  hostileDropRate: 0.2,       // 红名死亡掉落比例(20%)
  
  // 竞技场
  matchTimeout: 60000,        // 匹配超时(60秒)
  battleDuration: 180000,     // 战斗时长(3分钟)
  
  // 奖励
  winExp: 100,
  winGold: 50,
  loseExp: 20,
  loseGold: 10
};

import { setTimeoutFn, clearTimeoutFn } from '../core/Timers.js';

/**
 * PVP玩家数据
 */
export class PVPPlayerData {
  constructor(data = {}) {
    this.playerId = data.playerId || '';
    this.name = data.name || '';
    this.level = data.level || 1;
    // 挂钟注入（随系统传入；默认真实时间）
    this.now = data.now || (() => Date.now());
    
    // PVP状态
    this.pvpEnabled = data.pvpEnabled || false;
    this.state = data.state || PVPState.PEACE;
    this.killCount = data.killCount || 0;
    this.deathCount = data.deathCount || 0;
    this.hostileUntil = data.hostileUntil || 0;
    
    // 竞技场数据
    this.arenaScore = data.arenaScore || 1000;
    this.arenaWins = data.arenaWins || 0;
    this.arenaLosses = data.arenaLosses || 0;
    this.arenaStreak = data.arenaStreak || 0;
  }

  /**
   * 是否红名
   */
  isHostile(now = this.now()) {
    return this.state === PVPState.HOSTILE && now < this.hostileUntil;
  }

  /**
   * 获取胜率
   */
  getWinRate() {
    const total = this.arenaWins + this.arenaLosses;
    return total > 0 ? (this.arenaWins / total * 100).toFixed(1) : 0;
  }

  /**
   * 获取KD比
   */
  getKDRatio() {
    return this.deathCount > 0 ? (this.killCount / this.deathCount).toFixed(2) : this.killCount;
  }

  toJSON() {
    return {
      playerId: this.playerId,
      name: this.name,
      level: this.level,
      pvpEnabled: this.pvpEnabled,
      state: this.state,
      killCount: this.killCount,
      deathCount: this.deathCount,
      hostileUntil: this.hostileUntil,
      arenaScore: this.arenaScore,
      arenaWins: this.arenaWins,
      arenaLosses: this.arenaLosses,
      arenaStreak: this.arenaStreak
    };
  }
}

/**
 * 竞技场战斗
 */
export class ArenaBattle {
  constructor(data = {}) {
    this.id = data.id || `arena_${Date.now()}`;
    this.now = data.now || (() => Date.now());
    this.player1 = data.player1 || null;
    this.player2 = data.player2 || null;
    this.state = data.state || ArenaState.READY;
    this.startTime = data.startTime || 0;
    this.endTime = data.endTime || 0;
    this.winnerId = data.winnerId || null;
    this.player1Hp = data.player1Hp || 100;
    this.player2Hp = data.player2Hp || 100;
  }

  /**
   * 开始战斗
   */
  start() {
    this.state = ArenaState.IN_BATTLE;
    this.startTime = this.now();
    this.endTime = this.startTime + PVPConfig.battleDuration;
  }

  /**
   * 检查是否超时
   */
  isTimeout() {
    return this.state === ArenaState.IN_BATTLE && this.now() > this.endTime;
  }

  /**
   * 获取剩余时间
   */
  getRemainingTime() {
    if (this.state !== ArenaState.IN_BATTLE) return 0;
    return Math.max(0, this.endTime - this.now());
  }

  /**
   * 结束战斗
   */
  finish(winnerId) {
    this.state = ArenaState.FINISHED;
    this.winnerId = winnerId;
    this.endTime = this.now();
  }
}

/**
 * PVP系统主类
 */
export class PVPSystem {
  constructor(config = {}) {
    this.config = { ...PVPConfig, ...config };
    // 挂钟注入：红名截止/竞技场计时统一走 this.now()，可注入以支持测试/暂停
    this.now = config.now || (() => Date.now());
    this.localPlayer = null;
    this.players = new Map();
    
    // 竞技场
    this.matchQueue = [];
    this.currentBattle = null;
    this.matchTimer = null;
    
    // 排行榜
    this.leaderboard = [];
    this.maxLeaderboardSize = 100;
    
    // 事件监听
    this.listeners = new Map();
  }

  /**
   * 初始化
   */
  initialize(playerData) {
    this.localPlayer = new PVPPlayerData(playerData);
    this.players.set(this.localPlayer.playerId, this.localPlayer);
  }

  /**
   * 销毁
   */
  destroy() {
    this.cancelMatch();
    this.players.clear();
    this.listeners.clear();
  }

  // ==================== PVP开关 ====================

  /**
   * 开启PVP
   */
  enablePVP() {
    if (!this.localPlayer) return { success: false, error: '未初始化' };
    
    this.localPlayer.pvpEnabled = true;
    this.emit('pvpEnabled', { player: this.localPlayer });
    return { success: true };
  }

  /**
   * 关闭PVP
   */
  disablePVP() {
    if (!this.localPlayer) return { success: false, error: '未初始化' };
    
    if (this.localPlayer.isHostile()) {
      return { success: false, error: '红名状态无法关闭PVP' };
    }
    
    if (this.localPlayer.state === PVPState.COMBAT) {
      return { success: false, error: '战斗中无法关闭PVP' };
    }
    
    this.localPlayer.pvpEnabled = false;
    this.emit('pvpDisabled', { player: this.localPlayer });
    return { success: true };
  }

  /**
   * 检查是否可以攻击
   */
  canAttack(targetId) {
    if (!this.localPlayer?.pvpEnabled) return false;
    
    const target = this.players.get(targetId);
    if (!target) return false;
    
    // 红名玩家可以被任何人攻击
    if (target.isHostile()) return true;
    
    // 双方都开启PVP才能互相攻击
    return target.pvpEnabled;
  }

  // ==================== 击杀处理 ====================

  /**
   * 处理击杀
   */
  handleKill(killerId, victimId) {
    const killer = this.players.get(killerId);
    const victim = this.players.get(victimId);
    
    if (!killer || !victim) return;

    killer.killCount++;
    victim.deathCount++;

    // 检查是否变红名
    if (!victim.isHostile() && !killer.isHostile()) {
      // 杀死白名玩家
      const recentKills = this.getRecentKills(killerId);
      if (recentKills >= this.config.hostileKillCount) {
        this.setHostile(killerId);
      }
    }

    // 计算掉落
    const dropRate = victim.isHostile() ? this.config.hostileDropRate : this.config.deathDropRate;
    const drops = this.calculateDrops(victim, dropRate);

    this.emit('playerKilled', { killer, victim, drops });
    return { killer, victim, drops };
  }

  /**
   * 获取最近击杀数（简化实现）
   */
  getRecentKills(playerId) {
    const player = this.players.get(playerId);
    return player ? player.killCount : 0;
  }

  /**
   * 设置红名状态
   */
  setHostile(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    player.state = PVPState.HOSTILE;
    player.hostileUntil = this.now() + this.config.hostileDuration;
    
    this.emit('playerHostile', { player });
  }

  /**
   * 清除红名状态
   */
  clearHostile(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;

    player.state = PVPState.PEACE;
    player.hostileUntil = 0;
    
    this.emit('hostileCleared', { player });
  }

  /**
   * 计算掉落物品
   */
  calculateDrops(victim, dropRate) {
    // 简化实现：返回固定比例的金币
    const goldDrop = Math.floor(100 * dropRate);
    return { gold: goldDrop, items: [] };
  }

  // ==================== 竞技场 ====================

  /**
   * 开始匹配
   */
  startMatch() {
    if (!this.localPlayer) return { success: false, error: '未初始化' };
    
    if (this.currentBattle) {
      return { success: false, error: '已在战斗中' };
    }

    // 加入匹配队列
    this.matchQueue.push({
      player: this.localPlayer,
      joinTime: this.now()
    });

    // 尝试匹配
    const match = this.tryMatch();
    if (match) {
      return { success: true, battle: match };
    }

    // 设置超时
    this.matchTimer = setTimeoutFn(() => {
      this.cancelMatch();
      this.emit('matchTimeout', { player: this.localPlayer });
    }, this.config.matchTimeout);

    this.emit('matchStarted', { player: this.localPlayer });
    return { success: true, matching: true };
  }

  /**
   * 取消匹配
   */
  cancelMatch() {
    if (this.matchTimer) {
      clearTimeoutFn(this.matchTimer);
      this.matchTimer = null;
    }

    this.matchQueue = this.matchQueue.filter(
      q => q.player.playerId !== this.localPlayer?.playerId
    );

    this.emit('matchCancelled', { player: this.localPlayer });
    return { success: true };
  }

  /**
   * 尝试匹配
   */
  tryMatch() {
    if (this.matchQueue.length < 2) return null;

    // 简单匹配：取前两个玩家
    const [entry1, entry2] = this.matchQueue.splice(0, 2);
    
    const battle = new ArenaBattle({
      player1: entry1.player,
      player2: entry2.player,
      now: this.now
    });

    this.currentBattle = battle;
    battle.start();

    this.emit('matchFound', { battle });
    return battle;
  }

  /**
   * 模拟添加对手到匹配队列
   */
  addOpponentToQueue(opponentData) {
    const opponent = new PVPPlayerData(opponentData);
    this.players.set(opponent.playerId, opponent);
    
    this.matchQueue.push({
      player: opponent,
      joinTime: this.now()
    });

    return this.tryMatch();
  }

  /**
   * 处理竞技场伤害
   */
  handleArenaDamage(attackerId, damage) {
    if (!this.currentBattle || this.currentBattle.state !== ArenaState.IN_BATTLE) {
      return { success: false, error: '不在战斗中' };
    }

    const battle = this.currentBattle;
    
    if (attackerId === battle.player1.playerId) {
      battle.player2Hp = Math.max(0, battle.player2Hp - damage);
      if (battle.player2Hp <= 0) {
        return this.finishArenaBattle(battle.player1.playerId);
      }
    } else if (attackerId === battle.player2.playerId) {
      battle.player1Hp = Math.max(0, battle.player1Hp - damage);
      if (battle.player1Hp <= 0) {
        return this.finishArenaBattle(battle.player2.playerId);
      }
    }

    this.emit('arenaDamage', { battle, attackerId, damage });
    return { success: true, battle };
  }

  /**
   * 结束竞技场战斗
   */
  finishArenaBattle(winnerId) {
    if (!this.currentBattle) return { success: false, error: '无战斗' };

    const battle = this.currentBattle;
    battle.finish(winnerId);

    const winner = winnerId === battle.player1.playerId ? battle.player1 : battle.player2;
    const loser = winnerId === battle.player1.playerId ? battle.player2 : battle.player1;

    // 更新数据
    winner.arenaWins++;
    winner.arenaStreak++;
    winner.arenaScore += 25;

    loser.arenaLosses++;
    loser.arenaStreak = 0;
    loser.arenaScore = Math.max(0, loser.arenaScore - 20);

    // 计算奖励
    const rewards = {
      winner: { exp: this.config.winExp, gold: this.config.winGold },
      loser: { exp: this.config.loseExp, gold: this.config.loseGold }
    };

    // 更新排行榜
    this.updateLeaderboard(winner);
    this.updateLeaderboard(loser);

    this.currentBattle = null;
    
    this.emit('arenaFinished', { battle, winner, loser, rewards });
    return { success: true, battle, winner, loser, rewards };
  }

  /**
   * 检查战斗超时
   */
  checkBattleTimeout() {
    if (!this.currentBattle?.isTimeout()) return;

    // 超时判定：血量多的获胜
    const battle = this.currentBattle;
    const winnerId = battle.player1Hp >= battle.player2Hp 
      ? battle.player1.playerId 
      : battle.player2.playerId;

    this.finishArenaBattle(winnerId);
  }

  // ==================== 排行榜 ====================

  /**
   * 更新排行榜
   */
  updateLeaderboard(player) {
    const index = this.leaderboard.findIndex(p => p.playerId === player.playerId);
    
    if (index >= 0) {
      this.leaderboard[index] = player.toJSON();
    } else {
      this.leaderboard.push(player.toJSON());
    }

    // 排序
    this.leaderboard.sort((a, b) => b.arenaScore - a.arenaScore);

    // 限制大小
    if (this.leaderboard.length > this.maxLeaderboardSize) {
      this.leaderboard = this.leaderboard.slice(0, this.maxLeaderboardSize);
    }
  }

  /**
   * 获取排行榜
   */
  getLeaderboard(limit = 10) {
    return this.leaderboard.slice(0, limit);
  }

  /**
   * 获取玩家排名
   */
  getPlayerRank(playerId) {
    const index = this.leaderboard.findIndex(p => p.playerId === playerId);
    return index >= 0 ? index + 1 : null;
  }

  // ==================== 事件系统 ====================

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => {
        try { cb(data); } catch (e) { console.error('PVP event error:', e); }
      });
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 获取本地玩家数据
   */
  getLocalPlayer() {
    return this.localPlayer;
  }

  /**
   * 获取玩家数据
   */
  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  /**
   * 获取当前战斗
   */
  getCurrentBattle() {
    return this.currentBattle;
  }

  /**
   * 是否在匹配中
   */
  isMatching() {
    return this.matchQueue.some(q => q.player.playerId === this.localPlayer?.playerId);
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      playerId: this.localPlayer?.playerId,
      pvpEnabled: this.localPlayer?.pvpEnabled,
      state: this.localPlayer?.state,
      killCount: this.localPlayer?.killCount,
      deathCount: this.localPlayer?.deathCount,
      kdRatio: this.localPlayer?.getKDRatio(),
      arenaScore: this.localPlayer?.arenaScore,
      arenaWins: this.localPlayer?.arenaWins,
      arenaLosses: this.localPlayer?.arenaLosses,
      winRate: this.localPlayer?.getWinRate(),
      rank: this.getPlayerRank(this.localPlayer?.playerId),
      isMatching: this.isMatching(),
      inBattle: !!this.currentBattle
    };
  }
}

export default PVPSystem;

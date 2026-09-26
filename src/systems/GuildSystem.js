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

import { setTimeoutFn } from '../core/Timers.js';

/**
 * GuildSystem.js
 * 公会系统 - 管理公会创建、成员、等级和公会战
 */

/**
 * 公会成员权限
 */
export const GuildRole = {
  LEADER: 'leader',       // 会长
  VICE_LEADER: 'vice_leader', // 副会长
  ELDER: 'elder',         // 长老
  MEMBER: 'member'        // 成员
};

/**
 * 公会申请状态
 */
export const ApplicationStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
};

/**
 * 公会战状态
 */
export const GuildWarState = {
  IDLE: 'idle',
  SIGNUP: 'signup',
  PREPARING: 'preparing',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished'
};

/**
 * 公会成员类
 */
export class GuildMember {
  constructor(data = {}) {
    this.id = data.id || '';
    this.name = data.name || '';
    this.level = data.level || 1;
    this.classType = data.classType || 'warrior';
    this.role = data.role || GuildRole.MEMBER;
    this.contribution = data.contribution || 0;
    this.weeklyContribution = data.weeklyContribution || 0;
    this.joinedAt = data.joinedAt || Date.now();
    this.lastOnline = data.lastOnline || Date.now();
    this.isOnline = data.isOnline || false;
  }

  getRoleText() {
    const texts = {
      [GuildRole.LEADER]: '会长',
      [GuildRole.VICE_LEADER]: '副会长',
      [GuildRole.ELDER]: '长老',
      [GuildRole.MEMBER]: '成员'
    };
    return texts[this.role] || '成员';
  }

  toJSON() {
    return { ...this };
  }
}

/**
 * 公会申请类
 */
export class GuildApplication {
  constructor(data = {}) {
    this.id = data.id || `app_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.playerId = data.playerId || '';
    this.playerName = data.playerName || '';
    this.playerLevel = data.playerLevel || 1;
    this.message = data.message || '';
    this.status = data.status || ApplicationStatus.PENDING;
    this.createdAt = data.createdAt || Date.now();
    this.expiresAt = data.expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000;
  }

  isExpired() {
    return Date.now() > this.expiresAt;
  }

  isPending() {
    return this.status === ApplicationStatus.PENDING && !this.isExpired();
  }
}

/**
 * 公会类
 */
export class Guild {
  constructor(data = {}) {
    this.id = data.id || `guild_${Date.now()}`;
    this.name = data.name || '未命名公会';
    this.announcement = data.announcement || '欢迎加入公会！';
    this.level = data.level || 1;
    this.exp = data.exp || 0;
    this.funds = data.funds || 0;
    this.maxMembers = data.maxMembers || 50;
    this.leaderId = data.leaderId || '';
    this.createdAt = data.createdAt || Date.now();
    
    this.members = new Map();
    this.applications = new Map();
    
    // 公会战数据
    this.warScore = data.warScore || 0;
    this.warWins = data.warWins || 0;
    this.warLosses = data.warLosses || 0;

    if (data.members) {
      data.members.forEach(m => {
        const member = new GuildMember(m);
        this.members.set(member.id, member);
      });
    }
  }

  /**
   * 获取升级所需经验
   */
  getExpToNextLevel() {
    return this.level * 1000;
  }

  /**
   * 添加经验
   */
  addExp(amount) {
    this.exp += amount;
    while (this.exp >= this.getExpToNextLevel()) {
      this.exp -= this.getExpToNextLevel();
      this.level++;
      this.maxMembers = 50 + this.level * 5;
    }
  }

  /**
   * 添加成员
   */
  addMember(memberData) {
    if (this.members.size >= this.maxMembers) {
      return { success: false, error: '公会已满' };
    }
    if (this.members.has(memberData.id)) {
      return { success: false, error: '已是公会成员' };
    }

    const member = new GuildMember({
      ...memberData,
      role: this.members.size === 0 ? GuildRole.LEADER : GuildRole.MEMBER
    });

    if (this.members.size === 0) {
      this.leaderId = member.id;
    }

    this.members.set(member.id, member);
    return { success: true, member };
  }

  /**
   * 移除成员
   */
  removeMember(memberId) {
    if (memberId === this.leaderId) {
      return { success: false, error: '会长不能退出，请先转让' };
    }
    
    const member = this.members.get(memberId);
    if (!member) {
      return { success: false, error: '成员不存在' };
    }

    this.members.delete(memberId);
    return { success: true, member };
  }

  /**
   * 设置成员职位
   */
  setMemberRole(memberId, role) {
    const member = this.members.get(memberId);
    if (!member) return { success: false, error: '成员不存在' };
    
    if (role === GuildRole.LEADER) {
      return { success: false, error: '请使用转让会长功能' };
    }

    member.role = role;
    return { success: true, member };
  }

  /**
   * 转让会长
   */
  transferLeader(newLeaderId) {
    const newLeader = this.members.get(newLeaderId);
    if (!newLeader) return { success: false, error: '成员不存在' };

    const oldLeader = this.members.get(this.leaderId);
    if (oldLeader) oldLeader.role = GuildRole.MEMBER;

    newLeader.role = GuildRole.LEADER;
    this.leaderId = newLeaderId;
    return { success: true };
  }

  /**
   * 添加贡献
   */
  addContribution(memberId, amount) {
    const member = this.members.get(memberId);
    if (!member) return false;

    member.contribution += amount;
    member.weeklyContribution += amount;
    this.funds += Math.floor(amount * 0.1);
    this.addExp(Math.floor(amount * 0.05));
    return true;
  }

  /**
   * 获取所有成员
   */
  getAllMembers() {
    return Array.from(this.members.values());
  }

  /**
   * 获取在线成员
   */
  getOnlineMembers() {
    return this.getAllMembers().filter(m => m.isOnline);
  }

  /**
   * 按贡献排序成员
   */
  getMembersByContribution() {
    return this.getAllMembers().sort((a, b) => b.contribution - a.contribution);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      announcement: this.announcement,
      level: this.level,
      exp: this.exp,
      funds: this.funds,
      maxMembers: this.maxMembers,
      leaderId: this.leaderId,
      members: this.getAllMembers().map(m => m.toJSON()),
      warScore: this.warScore,
      warWins: this.warWins,
      warLosses: this.warLosses,
      createdAt: this.createdAt
    };
  }
}

/**
 * 公会战地图配置
 */
export const GuildWarMapConfig = {
  CASTLE_SIEGE: {
    id: 'castle_siege',
    name: '城堡攻防战',
    description: '攻占敌方城堡获得积分',
    duration: 30 * 60 * 1000, // 30分钟
    objectives: [
      { id: 'outer_gate', name: '外城门', points: 100 },
      { id: 'inner_gate', name: '内城门', points: 200 },
      { id: 'throne_room', name: '王座厅', points: 500 }
    ]
  },
  RESOURCE_WAR: {
    id: 'resource_war',
    name: '资源争夺战',
    description: '占领资源点获得积分',
    duration: 20 * 60 * 1000, // 20分钟
    objectives: [
      { id: 'mine_1', name: '矿点1', points: 50 },
      { id: 'mine_2', name: '矿点2', points: 50 },
      { id: 'mine_3', name: '矿点3', points: 50 }
    ]
  },
  ELIMINATION: {
    id: 'elimination',
    name: '歼灭战',
    description: '击杀敌方成员获得积分',
    duration: 15 * 60 * 1000, // 15分钟
    objectives: []
  }
};

/**
 * 公会战奖励配置
 */
export const GuildWarRewards = {
  WINNER: {
    guildExp: 5000,
    guildFunds: 10000,
    memberExp: 1000,
    memberGold: 500,
    warScore: 100
  },
  LOSER: {
    guildExp: 2000,
    guildFunds: 3000,
    memberExp: 300,
    memberGold: 100,
    warScore: -50
  },
  PARTICIPATION: {
    memberExp: 500,
    memberGold: 200
  }
};

/**
 * 公会战参与者类
 */
export class GuildWarParticipant {
  constructor(data = {}) {
    this.playerId = data.playerId || '';
    this.playerName = data.playerName || '';
    this.guildId = data.guildId || '';
    this.kills = data.kills || 0;
    this.deaths = data.deaths || 0;
    this.assists = data.assists || 0;
    this.objectivesCaptured = data.objectivesCaptured || 0;
    this.damageDealt = data.damageDealt || 0;
    this.healingDone = data.healingDone || 0;
    this.score = data.score || 0;
  }

  addKill() {
    this.kills++;
    this.score += 10;
  }

  addDeath() {
    this.deaths++;
  }

  addAssist() {
    this.assists++;
    this.score += 5;
  }

  captureObjective(points) {
    this.objectivesCaptured++;
    this.score += points;
  }

  addDamage(amount) {
    this.damageDealt += amount;
    this.score += Math.floor(amount / 100);
  }

  addHealing(amount) {
    this.healingDone += amount;
    this.score += Math.floor(amount / 100);
  }

  toJSON() {
    return { ...this };
  }
}

/**
 * 公会战目标点类
 */
export class GuildWarObjective {
  constructor(data = {}) {
    this.id = data.id || '';
    this.name = data.name || '';
    this.points = data.points || 0;
    this.controlledBy = data.controlledBy || null; // guildId
    this.captureProgress = data.captureProgress || 0;
    this.position = data.position || { x: 0, y: 0 };
    this.radius = data.radius || 100;
  }

  startCapture(guildId) {
    if (this.controlledBy === guildId) return false;
    this.captureProgress = 0;
    return true;
  }

  updateCapture(guildId, delta) {
    if (this.controlledBy === guildId) return false;
    
    this.captureProgress += delta;
    if (this.captureProgress >= 100) {
      this.controlledBy = guildId;
      this.captureProgress = 100;
      return true; // 占领成功
    }
    return false;
  }

  resetCapture() {
    this.captureProgress = 0;
  }

  isControlledBy(guildId) {
    return this.controlledBy === guildId;
  }
}

/**
 * 公会战类
 */
export class GuildWar {
  constructor(data = {}) {
    this.id = data.id || `war_${Date.now()}`;
    this.guild1Id = data.guild1Id || '';
    this.guild2Id = data.guild2Id || '';
    this.guild1Name = data.guild1Name || '';
    this.guild2Name = data.guild2Name || '';
    this.guild1Score = data.guild1Score || 0;
    this.guild2Score = data.guild2Score || 0;
    this.state = data.state || GuildWarState.PREPARING;
    this.startTime = data.startTime || 0;
    this.endTime = data.endTime || 0;
    this.winnerId = data.winnerId || null;
    
    // 地图配置
    this.mapType = data.mapType || 'CASTLE_SIEGE';
    this.mapConfig = GuildWarMapConfig[this.mapType];
    
    // 参与者
    this.participants = new Map();
    if (data.participants) {
      data.participants.forEach(p => {
        this.participants.set(p.playerId, new GuildWarParticipant(p));
      });
    }
    
    // 目标点
    this.objectives = new Map();
    if (this.mapConfig?.objectives) {
      this.mapConfig.objectives.forEach(obj => {
        this.objectives.set(obj.id, new GuildWarObjective(obj));
      });
    }
    
    // 战斗记录
    this.killLog = data.killLog || [];
    this.objectiveLog = data.objectiveLog || [];
  }

  /**
   * 开始公会战
   */
  start() {
    this.state = GuildWarState.IN_PROGRESS;
    this.startTime = Date.now();
    this.endTime = this.startTime + (this.mapConfig?.duration || 30 * 60 * 1000);
  }

  /**
   * 添加参与者
   */
  addParticipant(playerData) {
    if (this.participants.has(playerData.playerId)) {
      return { success: false, error: '已经参与' };
    }

    const participant = new GuildWarParticipant({
      playerId: playerData.playerId,
      playerName: playerData.playerName,
      guildId: playerData.guildId
    });

    this.participants.set(participant.playerId, participant);
    return { success: true, participant };
  }

  /**
   * 记录击杀
   */
  recordKill(killerId, victimId, assistIds = []) {
    const killer = this.participants.get(killerId);
    const victim = this.participants.get(victimId);
    
    if (!killer || !victim) return;

    killer.addKill();
    victim.addDeath();

    // 给击杀者所在公会加分
    this.addScore(killer.guildId, 10);

    // 处理助攻
    assistIds.forEach(assistId => {
      const assist = this.participants.get(assistId);
      if (assist && assist.guildId === killer.guildId) {
        assist.addAssist();
        this.addScore(assist.guildId, 5);
      }
    });

    // 记录击杀日志
    this.killLog.push({
      time: Date.now() - this.startTime,
      killerId,
      killerName: killer.playerName,
      victimId,
      victimName: victim.playerName,
      assistIds
    });
  }

  /**
   * 记录伤害
   */
  recordDamage(playerId, amount) {
    const participant = this.participants.get(playerId);
    if (participant) {
      participant.addDamage(amount);
    }
  }

  /**
   * 记录治疗
   */
  recordHealing(playerId, amount) {
    const participant = this.participants.get(playerId);
    if (participant) {
      participant.addHealing(amount);
    }
  }

  /**
   * 占领目标点
   */
  captureObjective(objectiveId, guildId, capturerId) {
    const objective = this.objectives.get(objectiveId);
    if (!objective || objective.isControlledBy(guildId)) return false;

    objective.controlledBy = guildId;
    objective.captureProgress = 100;

    // 给占领者加分
    const capturer = this.participants.get(capturerId);
    if (capturer) {
      capturer.captureObjective(objective.points);
    }

    // 给公会加分
    this.addScore(guildId, objective.points);

    // 记录占领日志
    this.objectiveLog.push({
      time: Date.now() - this.startTime,
      objectiveId,
      objectiveName: objective.name,
      guildId,
      guildName: guildId === this.guild1Id ? this.guild1Name : this.guild2Name,
      capturerId,
      points: objective.points
    });

    return true;
  }

  /**
   * 更新目标点占领进度
   */
  updateObjectiveCapture(objectiveId, guildId, delta) {
    const objective = this.objectives.get(objectiveId);
    if (!objective) return false;

    return objective.updateCapture(guildId, delta);
  }

  /**
   * 添加分数
   */
  addScore(guildId, points) {
    if (guildId === this.guild1Id) {
      this.guild1Score += points;
    } else if (guildId === this.guild2Id) {
      this.guild2Score += points;
    }
  }

  /**
   * 结束公会战
   */
  finish() {
    this.state = GuildWarState.FINISHED;
    this.endTime = Date.now();
    this.winnerId = this.guild1Score >= this.guild2Score ? this.guild1Id : this.guild2Id;
  }

  /**
   * 获取剩余时间
   */
  getRemainingTime() {
    if (this.state !== GuildWarState.IN_PROGRESS) return 0;
    return Math.max(0, this.endTime - Date.now());
  }

  /**
   * 是否超时
   */
  isTimeout() {
    return this.state === GuildWarState.IN_PROGRESS && Date.now() > this.endTime;
  }

  /**
   * 获取公会得分
   */
  getGuildScore(guildId) {
    return guildId === this.guild1Id ? this.guild1Score : this.guild2Score;
  }

  /**
   * 获取参与者列表
   */
  getParticipants(guildId = null) {
    const participants = Array.from(this.participants.values());
    if (guildId) {
      return participants.filter(p => p.guildId === guildId);
    }
    return participants;
  }

  /**
   * 获取MVP
   */
  getMVP(guildId = null) {
    const participants = this.getParticipants(guildId);
    if (participants.length === 0) return null;
    return participants.reduce((mvp, p) => p.score > mvp.score ? p : mvp);
  }

  /**
   * 获取战斗统计
   */
  getStatistics() {
    return {
      guild1: {
        id: this.guild1Id,
        name: this.guild1Name,
        score: this.guild1Score,
        participants: this.getParticipants(this.guild1Id).length,
        kills: this.getParticipants(this.guild1Id).reduce((sum, p) => sum + p.kills, 0),
        deaths: this.getParticipants(this.guild1Id).reduce((sum, p) => sum + p.deaths, 0),
        objectivesCaptured: this.getParticipants(this.guild1Id).reduce((sum, p) => sum + p.objectivesCaptured, 0)
      },
      guild2: {
        id: this.guild2Id,
        name: this.guild2Name,
        score: this.guild2Score,
        participants: this.getParticipants(this.guild2Id).length,
        kills: this.getParticipants(this.guild2Id).reduce((sum, p) => sum + p.kills, 0),
        deaths: this.getParticipants(this.guild2Id).reduce((sum, p) => sum + p.deaths, 0),
        objectivesCaptured: this.getParticipants(this.guild2Id).reduce((sum, p) => sum + p.objectivesCaptured, 0)
      },
      duration: this.endTime - this.startTime,
      winnerId: this.winnerId
    };
  }

  toJSON() {
    return {
      id: this.id,
      guild1Id: this.guild1Id,
      guild2Id: this.guild2Id,
      guild1Name: this.guild1Name,
      guild2Name: this.guild2Name,
      guild1Score: this.guild1Score,
      guild2Score: this.guild2Score,
      state: this.state,
      startTime: this.startTime,
      endTime: this.endTime,
      winnerId: this.winnerId,
      mapType: this.mapType,
      participants: Array.from(this.participants.values()).map(p => p.toJSON()),
      killLog: this.killLog,
      objectiveLog: this.objectiveLog
    };
  }
}

/**
 * 公会系统主类
 */
export class GuildSystem {
  constructor(config = {}) {
    this.config = {
      createCost: config.createCost || 1000,
      maxViceLeaders: config.maxViceLeaders || 2,
      maxElders: config.maxElders || 5,
      warSignupDuration: config.warSignupDuration || 24 * 60 * 60 * 1000, // 24小时报名时间
      warPreparationTime: config.warPreparationTime || 5 * 60 * 1000, // 5分钟准备时间
      minWarParticipants: config.minWarParticipants || 5, // 最少参战人数
      maxWarParticipants: config.maxWarParticipants || 50, // 最多参战人数
      ...config
    };

    this.currentPlayerId = null;
    this.currentGuild = null;
    this.guilds = new Map();
    // 公会战调度：可注入以支持测试/暂停；默认真实定时器边界
    this.scheduler = config.scheduler || setTimeoutFn;
    
    // 公会战相关
    this.currentWar = null;
    this.warHistory = [];
    this.warRankings = [];
    this.warSignups = new Map(); // guildId -> signup data
    this.scheduledWars = []; // 已安排的公会战
    
    this.listeners = new Map();
  }

  initialize(playerId) {
    this.currentPlayerId = playerId;
  }

  destroy() {
    this.currentGuild = null;
    this.guilds.clear();
    this.listeners.clear();
  }

  // ==================== 公会管理 ====================

  createGuild(name, leaderData) {
    if (this.currentGuild) {
      return { success: false, error: '你已经在一个公会中' };
    }

    const guild = new Guild({ name });
    guild.addMember({
      id: this.currentPlayerId,
      name: leaderData.name,
      level: leaderData.level,
      classType: leaderData.classType
    });

    this.guilds.set(guild.id, guild);
    this.currentGuild = guild;

    this.emit('guildCreated', { guild });
    return { success: true, guild };
  }

  disbandGuild() {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }
    if (this.currentGuild.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有会长可以解散公会' };
    }

    const guild = this.currentGuild;
    this.guilds.delete(guild.id);
    this.currentGuild = null;

    this.emit('guildDisbanded', { guild });
    return { success: true };
  }

  leaveGuild() {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }

    const result = this.currentGuild.removeMember(this.currentPlayerId);
    if (!result.success) return result;

    const guild = this.currentGuild;
    this.currentGuild = null;

    this.emit('memberLeft', { guild, member: result.member });
    return { success: true };
  }

  kickMember(memberId) {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }

    const currentMember = this.currentGuild.members.get(this.currentPlayerId);
    if (!currentMember || ![GuildRole.LEADER, GuildRole.VICE_LEADER].includes(currentMember.role)) {
      return { success: false, error: '权限不足' };
    }

    const target = this.currentGuild.members.get(memberId);
    if (target?.role === GuildRole.LEADER) {
      return { success: false, error: '不能踢出会长' };
    }

    const result = this.currentGuild.removeMember(memberId);
    if (result.success) {
      this.emit('memberKicked', { guild: this.currentGuild, member: result.member });
    }
    return result;
  }

  setMemberRole(memberId, role) {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }
    if (this.currentGuild.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有会长可以设置职位' };
    }

    const result = this.currentGuild.setMemberRole(memberId, role);
    if (result.success) {
      this.emit('roleChanged', { guild: this.currentGuild, member: result.member });
    }
    return result;
  }

  transferLeader(newLeaderId) {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }
    if (this.currentGuild.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有会长可以转让' };
    }

    const result = this.currentGuild.transferLeader(newLeaderId);
    if (result.success) {
      this.emit('leaderTransferred', { guild: this.currentGuild, newLeaderId });
    }
    return result;
  }

  setAnnouncement(text) {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }

    const member = this.currentGuild.members.get(this.currentPlayerId);
    if (!member || ![GuildRole.LEADER, GuildRole.VICE_LEADER].includes(member.role)) {
      return { success: false, error: '权限不足' };
    }

    this.currentGuild.announcement = text;
    this.emit('announcementChanged', { guild: this.currentGuild, text });
    return { success: true };
  }

  // ==================== 申请系统 ====================

  applyToGuild(guildId, message = '') {
    if (this.currentGuild) {
      return { success: false, error: '你已经在一个公会中' };
    }

    const guild = this.guilds.get(guildId);
    if (!guild) {
      return { success: false, error: '公会不存在' };
    }

    const application = new GuildApplication({
      playerId: this.currentPlayerId,
      playerName: '申请者',
      message
    });

    guild.applications.set(application.id, application);
    this.emit('applicationSent', { guild, application });
    return { success: true, application };
  }

  acceptApplication(applicationId) {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }

    const member = this.currentGuild.members.get(this.currentPlayerId);
    if (!member || ![GuildRole.LEADER, GuildRole.VICE_LEADER, GuildRole.ELDER].includes(member.role)) {
      return { success: false, error: '权限不足' };
    }

    const application = this.currentGuild.applications.get(applicationId);
    if (!application || !application.isPending()) {
      return { success: false, error: '申请不存在或已处理' };
    }

    const result = this.currentGuild.addMember({
      id: application.playerId,
      name: application.playerName,
      level: application.playerLevel
    });

    if (result.success) {
      application.status = ApplicationStatus.ACCEPTED;
      this.currentGuild.applications.delete(applicationId);
      this.emit('applicationAccepted', { guild: this.currentGuild, application, member: result.member });
    }
    return result;
  }

  rejectApplication(applicationId) {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }

    const application = this.currentGuild.applications.get(applicationId);
    if (!application) {
      return { success: false, error: '申请不存在' };
    }

    application.status = ApplicationStatus.REJECTED;
    this.currentGuild.applications.delete(applicationId);
    this.emit('applicationRejected', { guild: this.currentGuild, application });
    return { success: true };
  }

  getPendingApplications() {
    if (!this.currentGuild) return [];
    return Array.from(this.currentGuild.applications.values()).filter(a => a.isPending());
  }

  // ==================== 贡献系统 ====================

  donate(amount) {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }

    this.currentGuild.addContribution(this.currentPlayerId, amount);
    this.emit('donated', { guild: this.currentGuild, playerId: this.currentPlayerId, amount });
    return { success: true };
  }

  // ==================== 公会战 ====================

  /**
   * 报名公会战
   */
  signupForWar(mapType = 'CASTLE_SIEGE') {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }
    if (this.currentGuild.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有会长可以报名公会战' };
    }
    if (this.warSignups.has(this.currentGuild.id)) {
      return { success: false, error: '已经报名了' };
    }

    const onlineMembers = this.currentGuild.getOnlineMembers();
    if (onlineMembers.length < this.config.minWarParticipants) {
      return { success: false, error: `至少需要${this.config.minWarParticipants}名在线成员` };
    }

    const signup = {
      guildId: this.currentGuild.id,
      guildName: this.currentGuild.name,
      guildLevel: this.currentGuild.level,
      memberCount: this.currentGuild.members.size,
      onlineCount: onlineMembers.length,
      mapType,
      signupTime: Date.now(),
      expiresAt: Date.now() + this.config.warSignupDuration
    };

    this.warSignups.set(this.currentGuild.id, signup);
    this.emit('warSignup', { guild: this.currentGuild, signup });

    // 尝试自动匹配
    this.tryMatchWar();

    return { success: true, signup };
  }

  /**
   * 取消报名
   */
  cancelWarSignup() {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }
    if (this.currentGuild.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有会长可以取消报名' };
    }
    if (!this.warSignups.has(this.currentGuild.id)) {
      return { success: false, error: '没有报名记录' };
    }

    this.warSignups.delete(this.currentGuild.id);
    this.emit('warSignupCancelled', { guild: this.currentGuild });
    return { success: true };
  }

  /**
   * 尝试匹配公会战
   */
  tryMatchWar() {
    if (this.warSignups.size < 2) return;

    // 清理过期报名
    for (const [guildId, signup] of this.warSignups.entries()) {
      if (Date.now() > signup.expiresAt) {
        this.warSignups.delete(guildId);
      }
    }

    // 按等级和积分匹配
    const signups = Array.from(this.warSignups.values());
    for (let i = 0; i < signups.length - 1; i++) {
      for (let j = i + 1; j < signups.length; j++) {
        const signup1 = signups[i];
        const signup2 = signups[j];

        // 检查地图类型是否匹配
        if (signup1.mapType !== signup2.mapType) continue;

        // 检查等级差距（不超过5级）
        if (Math.abs(signup1.guildLevel - signup2.guildLevel) > 5) continue;

        // 匹配成功，创建公会战
        this.createScheduledWar(signup1.guildId, signup2.guildId, signup1.mapType);
        this.warSignups.delete(signup1.guildId);
        this.warSignups.delete(signup2.guildId);
        return;
      }
    }
  }

  /**
   * 创建预定的公会战
   */
  createScheduledWar(guild1Id, guild2Id, mapType) {
    const guild1 = this.guilds.get(guild1Id);
    const guild2 = this.guilds.get(guild2Id);

    if (!guild1 || !guild2) return null;

    const war = new GuildWar({
      guild1Id: guild1.id,
      guild2Id: guild2.id,
      guild1Name: guild1.name,
      guild2Name: guild2.name,
      mapType,
      state: GuildWarState.PREPARING
    });

    this.scheduledWars.push(war);
    this.emit('warMatched', { war, guild1, guild2 });

    // 准备时间后自动开始
    this.scheduler(() => {
      this.startScheduledWar(war.id);
    }, this.config.warPreparationTime);

    return war;
  }

  /**
   * 开始预定的公会战
   */
  startScheduledWar(warId) {
    const warIndex = this.scheduledWars.findIndex(w => w.id === warId);
    if (warIndex === -1) return { success: false, error: '公会战不存在' };

    const war = this.scheduledWars[warIndex];
    war.start();
    this.currentWar = war;
    this.scheduledWars.splice(warIndex, 1);

    this.emit('warStarted', { war });

    // 设置自动结束
    this.scheduler(() => {
      if (this.currentWar?.id === war.id) {
        this.finishGuildWar();
      }
    }, war.mapConfig.duration);

    return { success: true, war };
  }

  /**
   * 手动发起公会战（直接挑战）
   */
  challengeGuild(targetGuildId, mapType = 'CASTLE_SIEGE') {
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }
    if (this.currentGuild.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有会长可以发起挑战' };
    }
    if (this.currentWar) {
      return { success: false, error: '已有进行中的公会战' };
    }

    const targetGuild = this.guilds.get(targetGuildId);
    if (!targetGuild) {
      return { success: false, error: '目标公会不存在' };
    }

    const war = new GuildWar({
      guild1Id: this.currentGuild.id,
      guild2Id: targetGuild.id,
      guild1Name: this.currentGuild.name,
      guild2Name: targetGuild.name,
      mapType
    });

    war.start();
    this.currentWar = war;

    this.emit('warStarted', { war });
    return { success: true, war };
  }

  /**
   * 加入公会战
   */
  joinWar() {
    if (!this.currentWar) {
      return { success: false, error: '没有进行中的公会战' };
    }
    if (!this.currentGuild) {
      return { success: false, error: '你不在任何公会中' };
    }

    const guildId = this.currentGuild.id;
    if (guildId !== this.currentWar.guild1Id && guildId !== this.currentWar.guild2Id) {
      return { success: false, error: '你的公会未参与此公会战' };
    }

    const participants = this.currentWar.getParticipants(guildId);
    if (participants.length >= this.config.maxWarParticipants) {
      return { success: false, error: '参战人数已满' };
    }

    const member = this.currentGuild.members.get(this.currentPlayerId);
    const result = this.currentWar.addParticipant({
      playerId: this.currentPlayerId,
      playerName: member?.name || '玩家',
      guildId
    });

    if (result.success) {
      this.emit('warParticipantJoined', { war: this.currentWar, participant: result.participant });
    }

    return result;
  }

  /**
   * 记录公会战击杀
   */
  recordWarKill(victimId, assistIds = []) {
    if (!this.currentWar) return;
    this.currentWar.recordKill(this.currentPlayerId, victimId, assistIds);
    this.emit('warKill', { war: this.currentWar, killerId: this.currentPlayerId, victimId });
  }

  /**
   * 记录公会战伤害
   */
  recordWarDamage(amount) {
    if (!this.currentWar) return;
    this.currentWar.recordDamage(this.currentPlayerId, amount);
  }

  /**
   * 记录公会战治疗
   */
  recordWarHealing(amount) {
    if (!this.currentWar) return;
    this.currentWar.recordHealing(this.currentPlayerId, amount);
  }

  /**
   * 占领目标点
   */
  captureWarObjective(objectiveId) {
    if (!this.currentWar || !this.currentGuild) {
      return { success: false, error: '无法占领' };
    }

    const success = this.currentWar.captureObjective(
      objectiveId,
      this.currentGuild.id,
      this.currentPlayerId
    );

    if (success) {
      this.emit('warObjectiveCaptured', {
        war: this.currentWar,
        objectiveId,
        guildId: this.currentGuild.id
      });
    }

    return { success };
  }

  /**
   * 添加公会战分数
   */
  addWarScore(points) {
    if (!this.currentWar || !this.currentGuild) return;
    this.currentWar.addScore(this.currentGuild.id, points);
    this.emit('warScoreUpdated', { war: this.currentWar });
  }

  /**
   * 结束公会战
   */
  finishGuildWar() {
    if (!this.currentWar) {
      return { success: false, error: '没有进行中的公会战' };
    }

    this.currentWar.finish();
    const war = this.currentWar;

    // 更新公会战绩和奖励
    const winner = this.guilds.get(war.winnerId);
    const loserId = war.winnerId === war.guild1Id ? war.guild2Id : war.guild1Id;
    const loser = this.guilds.get(loserId);

    if (winner) {
      winner.warWins++;
      winner.warScore += GuildWarRewards.WINNER.warScore;
      winner.addExp(GuildWarRewards.WINNER.guildExp);
      winner.funds += GuildWarRewards.WINNER.guildFunds;
    }

    if (loser) {
      loser.warLosses++;
      loser.warScore = Math.max(0, loser.warScore + GuildWarRewards.LOSER.warScore);
      loser.addExp(GuildWarRewards.LOSER.guildExp);
      loser.funds += GuildWarRewards.LOSER.guildFunds;
    }

    // 发放参与者奖励
    this.distributeWarRewards(war);

    // 保存到历史记录
    this.warHistory.unshift(war.toJSON());
    if (this.warHistory.length > 100) {
      this.warHistory = this.warHistory.slice(0, 100);
    }

    // 更新排行榜
    this.updateWarRankings();

    this.currentWar = null;
    this.emit('warFinished', { war, winnerId: war.winnerId });

    return { success: true, war };
  }

  /**
   * 发放公会战奖励
   */
  distributeWarRewards(war) {
    const winnerRewards = GuildWarRewards.WINNER;
    const loserRewards = GuildWarRewards.LOSER;
    const participationRewards = GuildWarRewards.PARTICIPATION;

    war.getParticipants().forEach(participant => {
      const isWinner = participant.guildId === war.winnerId;
      const rewards = isWinner ? winnerRewards : loserRewards;

      // 这里应该调用玩家系统发放奖励
      // 暂时只记录奖励信息
      this.emit('warRewardDistributed', {
        playerId: participant.playerId,
        rewards: {
          exp: rewards.memberExp + participationRewards.memberExp,
          gold: rewards.memberGold + participationRewards.memberGold
        },
        isWinner
      });
    });
  }

  /**
   * 更新公会战排行榜
   */
  updateWarRankings() {
    this.warRankings = Array.from(this.guilds.values())
      .map(g => ({
        id: g.id,
        name: g.name,
        level: g.level,
        score: g.warScore,
        wins: g.warWins,
        losses: g.warLosses,
        winRate: g.warWins + g.warLosses > 0 ? (g.warWins / (g.warWins + g.warLosses) * 100).toFixed(1) : 0
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
  }

  /**
   * 获取公会战排行榜
   */
  getWarRankings(limit = 10) {
    return this.warRankings.slice(0, limit);
  }

  /**
   * 获取当前公会战
   */
  getCurrentWar() {
    return this.currentWar;
  }

  /**
   * 获取公会战历史
   */
  getWarHistory(limit = 10) {
    return this.warHistory.slice(0, limit);
  }

  /**
   * 获取预定的公会战
   */
  getScheduledWars() {
    return this.scheduledWars;
  }

  /**
   * 获取报名列表
   */
  getWarSignups() {
    return Array.from(this.warSignups.values());
  }

  /**
   * 获取公会战统计
   */
  getWarStatistics(warId) {
    if (this.currentWar?.id === warId) {
      return this.currentWar.getStatistics();
    }

    const historyWar = this.warHistory.find(w => w.id === warId);
    if (historyWar) {
      // 从历史记录重建统计
      return {
        guild1: {
          id: historyWar.guild1Id,
          name: historyWar.guild1Name,
          score: historyWar.guild1Score
        },
        guild2: {
          id: historyWar.guild2Id,
          name: historyWar.guild2Name,
          score: historyWar.guild2Score
        },
        winnerId: historyWar.winnerId
      };
    }

    return null;
  }

  // ==================== 搜索和查询 ====================

  searchGuilds(keyword) {
    return Array.from(this.guilds.values())
      .filter(g => g.name.toLowerCase().includes(keyword.toLowerCase()))
      .map(g => ({
        id: g.id,
        name: g.name,
        level: g.level,
        memberCount: g.members.size,
        maxMembers: g.maxMembers
      }));
  }

  getGuildInfo(guildId) {
    return this.guilds.get(guildId);
  }

  getCurrentGuild() {
    return this.currentGuild;
  }

  isInGuild() {
    return this.currentGuild !== null;
  }

  isLeader() {
    return this.currentGuild?.leaderId === this.currentPlayerId;
  }

  getMyRole() {
    if (!this.currentGuild) return null;
    return this.currentGuild.members.get(this.currentPlayerId)?.role;
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
        try { cb(data); } catch (e) { console.error('Guild event error:', e); }
      });
    }
  }

  // ==================== 模拟数据 ====================

  addMockGuild(guildData) {
    const guild = new Guild(guildData);
    this.guilds.set(guild.id, guild);
    return guild;
  }
}

export default GuildSystem;

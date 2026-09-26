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
 * TeamSystem.js
 * 组队系统 - 管理队伍创建、加入、离开和队伍功能
 */

/**
 * 队伍状态枚举
 */
export const TeamState = {
  IDLE: 'idle',
  IN_DUNGEON: 'in_dungeon',
  IN_COMBAT: 'in_combat',
  MATCHING: 'matching'
};

/**
 * 队伍成员角色
 */
export const TeamRole = {
  LEADER: 'leader',
  MEMBER: 'member',
  ASSISTANT: 'assistant'
};

/**
 * 队伍邀请状态
 */
export const InviteStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
};

/**
 * 经验分配模式
 */
export const ExpShareMode = {
  EQUAL: 'equal',
  BY_DAMAGE: 'by_damage',
  BY_LEVEL: 'by_level'
};

/**
 * 掉落分配模式
 */
export const LootMode = {
  FREE_FOR_ALL: 'free_for_all',
  ROUND_ROBIN: 'round_robin',
  LEADER_ASSIGN: 'leader_assign',
  NEED_GREED: 'need_greed'
};

/**
 * 队伍成员类
 */
export class TeamMember {
  constructor(data = {}) {
    this.id = data.id || '';
    this.name = data.name || '';
    this.level = data.level || 1;
    this.classType = data.classType || 'warrior';
    this.role = data.role || TeamRole.MEMBER;
    this.hp = data.hp || 100;
    this.maxHp = data.maxHp || 100;
    this.mp = data.mp || 50;
    this.maxMp = data.maxMp || 50;
    this.position = data.position || { x: 0, y: 0 };
    this.mapId = data.mapId || 'main';
    this.isOnline = data.isOnline !== false;
    this.joinedAt = data.joinedAt || Date.now();
  }

  isLeader() {
    return this.role === TeamRole.LEADER;
  }

  isAssistant() {
    return this.role === TeamRole.ASSISTANT;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      level: this.level,
      classType: this.classType,
      role: this.role,
      hp: this.hp,
      maxHp: this.maxHp,
      mp: this.mp,
      maxMp: this.maxMp,
      position: this.position,
      mapId: this.mapId,
      isOnline: this.isOnline,
      joinedAt: this.joinedAt
    };
  }
}

/**
 * 队伍邀请类
 */
export class TeamInvite {
  constructor(data = {}) {
    this.id = data.id || `invite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.teamId = data.teamId || '';
    this.teamName = data.teamName || '';
    this.fromId = data.fromId || '';
    this.fromName = data.fromName || '';
    this.toId = data.toId || '';
    this.toName = data.toName || '';
    this.status = data.status || InviteStatus.PENDING;
    this.createdAt = data.createdAt || Date.now();
    this.expiresAt = data.expiresAt || Date.now() + 60000; // 1分钟过期
  }

  isExpired() {
    return Date.now() > this.expiresAt;
  }

  isPending() {
    return this.status === InviteStatus.PENDING && !this.isExpired();
  }
}

/**
 * 队伍类
 */
export class Team {
  constructor(data = {}) {
    this.id = data.id || `team_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.name = data.name || '未命名队伍';
    this.members = new Map();
    this.maxMembers = data.maxMembers || 5;
    this.state = data.state || TeamState.IDLE;
    this.leaderId = data.leaderId || '';
    this.expShareMode = data.expShareMode || ExpShareMode.EQUAL;
    this.lootMode = data.lootMode || LootMode.ROUND_ROBIN;
    this.lootRoundIndex = 0;
    this.isPublic = data.isPublic || false;
    this.minLevel = data.minLevel || 1;
    this.maxLevel = data.maxLevel || 100;
    this.targetActivity = data.targetActivity || '';
    this.createdAt = data.createdAt || Date.now();

    // 初始化成员
    if (data.members) {
      data.members.forEach(m => {
        const member = new TeamMember(m);
        this.members.set(member.id, member);
      });
    }
  }

  /**
   * 添加成员
   */
  addMember(memberData) {
    if (this.isFull()) {
      return { success: false, error: '队伍已满' };
    }

    if (this.members.has(memberData.id)) {
      return { success: false, error: '玩家已在队伍中' };
    }

    const member = new TeamMember({
      ...memberData,
      role: this.members.size === 0 ? TeamRole.LEADER : TeamRole.MEMBER
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
    const member = this.members.get(memberId);
    if (!member) {
      return { success: false, error: '成员不存在' };
    }

    this.members.delete(memberId);

    // 如果是队长离开，转移队长
    if (memberId === this.leaderId && this.members.size > 0) {
      const newLeader = this.members.values().next().value;
      newLeader.role = TeamRole.LEADER;
      this.leaderId = newLeader.id;
    }

    return { success: true, member, newLeaderId: this.leaderId };
  }

  /**
   * 获取成员
   */
  getMember(memberId) {
    return this.members.get(memberId);
  }

  /**
   * 获取所有成员
   */
  getAllMembers() {
    return Array.from(this.members.values());
  }

  /**
   * 获取队长
   */
  getLeader() {
    return this.members.get(this.leaderId);
  }

  /**
   * 转移队长
   */
  transferLeader(newLeaderId) {
    const newLeader = this.members.get(newLeaderId);
    if (!newLeader) {
      return { success: false, error: '目标成员不存在' };
    }

    const oldLeader = this.members.get(this.leaderId);
    if (oldLeader) {
      oldLeader.role = TeamRole.MEMBER;
    }

    newLeader.role = TeamRole.LEADER;
    this.leaderId = newLeaderId;

    return { success: true, oldLeaderId: oldLeader?.id, newLeaderId };
  }

  /**
   * 设置副队长
   */
  setAssistant(memberId, isAssistant) {
    const member = this.members.get(memberId);
    if (!member) {
      return { success: false, error: '成员不存在' };
    }

    if (member.role === TeamRole.LEADER) {
      return { success: false, error: '队长不能设为副队长' };
    }

    member.role = isAssistant ? TeamRole.ASSISTANT : TeamRole.MEMBER;
    return { success: true };
  }

  /**
   * 检查是否已满
   */
  isFull() {
    return this.members.size >= this.maxMembers;
  }

  /**
   * 检查是否为空
   */
  isEmpty() {
    return this.members.size === 0;
  }

  /**
   * 获取成员数量
   */
  getMemberCount() {
    return this.members.size;
  }

  /**
   * 更新成员状态
   */
  updateMember(memberId, data) {
    const member = this.members.get(memberId);
    if (!member) return false;

    if (data.hp !== undefined) member.hp = data.hp;
    if (data.maxHp !== undefined) member.maxHp = data.maxHp;
    if (data.mp !== undefined) member.mp = data.mp;
    if (data.maxMp !== undefined) member.maxMp = data.maxMp;
    if (data.position !== undefined) member.position = data.position;
    if (data.mapId !== undefined) member.mapId = data.mapId;
    if (data.isOnline !== undefined) member.isOnline = data.isOnline;
    if (data.level !== undefined) member.level = data.level;

    return true;
  }

  /**
   * 获取下一个掉落分配者
   */
  getNextLootReceiver() {
    const members = this.getAllMembers().filter(m => m.isOnline);
    if (members.length === 0) return null;

    this.lootRoundIndex = (this.lootRoundIndex + 1) % members.length;
    return members[this.lootRoundIndex];
  }

  /**
   * 计算经验分配
   */
  calculateExpShare(totalExp) {
    const members = this.getAllMembers().filter(m => m.isOnline);
    if (members.length === 0) return [];

    switch (this.expShareMode) {
      case ExpShareMode.EQUAL:
        const equalShare = Math.floor(totalExp / members.length);
        return members.map(m => ({ memberId: m.id, exp: equalShare }));

      case ExpShareMode.BY_LEVEL:
        const totalLevel = members.reduce((sum, m) => sum + m.level, 0);
        return members.map(m => ({
          memberId: m.id,
          exp: Math.floor(totalExp * (m.level / totalLevel))
        }));

      default:
        return members.map(m => ({ memberId: m.id, exp: Math.floor(totalExp / members.length) }));
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      members: this.getAllMembers().map(m => m.toJSON()),
      maxMembers: this.maxMembers,
      state: this.state,
      leaderId: this.leaderId,
      expShareMode: this.expShareMode,
      lootMode: this.lootMode,
      isPublic: this.isPublic,
      minLevel: this.minLevel,
      maxLevel: this.maxLevel,
      targetActivity: this.targetActivity,
      createdAt: this.createdAt
    };
  }
}


/**
 * 组队系统主类
 */
export class TeamSystem {
  constructor(config = {}) {
    this.currentPlayerId = null;
    this.currentTeam = null;
    this.invites = new Map();
    this.publicTeams = new Map();
    
    this.config = {
      maxTeamSize: config.maxTeamSize || 5,
      inviteTimeout: config.inviteTimeout || 60000,
      cleanupInterval: config.cleanupInterval || 30000,
      ...config
    };

    this.listeners = new Map();
    this.cleanupTimer = null;
    // 清理定时器（经边界注入，可测可停）
    this.setIntervalFn = config.setIntervalFn || setIntervalFn;
    this.clearIntervalFn = config.clearIntervalFn || clearIntervalFn;
  }

  /**
   * 初始化系统
   */
  initialize(playerId) {
    this.currentPlayerId = playerId;
    this.startCleanup();
  }

  /**
   * 销毁系统
   */
  destroy() {
    this.stopCleanup();
    this.currentTeam = null;
    this.invites.clear();
    this.publicTeams.clear();
    this.listeners.clear();
  }

  /**
   * 开始清理定时器
   */
  startCleanup() {
    this.stopCleanup();
    this.cleanupTimer = this.setIntervalFn(() => {
      this.cleanupExpiredInvites();
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
   * 清理过期邀请
   */
  cleanupExpiredInvites() {
    for (const [id, invite] of this.invites) {
      if (invite.isExpired()) {
        invite.status = InviteStatus.EXPIRED;
        this.invites.delete(id);
        this.emit('inviteExpired', { invite });
      }
    }
  }

  /**
   * 创建队伍
   */
  createTeam(options = {}) {
    if (this.currentTeam) {
      return { success: false, error: '你已经在一个队伍中' };
    }

    const team = new Team({
      name: options.name || `${options.leaderName || '玩家'}的队伍`,
      maxMembers: options.maxMembers || this.config.maxTeamSize,
      isPublic: options.isPublic || false,
      minLevel: options.minLevel,
      maxLevel: options.maxLevel,
      targetActivity: options.targetActivity
    });

    // 添加创建者为队长
    team.addMember({
      id: this.currentPlayerId,
      name: options.leaderName || '队长',
      level: options.leaderLevel || 1,
      classType: options.leaderClass || 'warrior'
    });

    this.currentTeam = team;

    if (team.isPublic) {
      this.publicTeams.set(team.id, team);
    }

    this.emit('teamCreated', { team });
    return { success: true, team };
  }

  /**
   * 解散队伍
   */
  disbandTeam() {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    if (this.currentTeam.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有队长可以解散队伍' };
    }

    const team = this.currentTeam;
    this.publicTeams.delete(team.id);
    this.currentTeam = null;

    this.emit('teamDisbanded', { team });
    return { success: true, team };
  }

  /**
   * 离开队伍
   */
  leaveTeam() {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    const result = this.currentTeam.removeMember(this.currentPlayerId);
    if (!result.success) {
      return result;
    }

    const team = this.currentTeam;
    
    // 如果队伍空了，解散
    if (team.isEmpty()) {
      this.publicTeams.delete(team.id);
      this.currentTeam = null;
      this.emit('teamDisbanded', { team });
    } else {
      this.emit('memberLeft', { team, member: result.member, newLeaderId: result.newLeaderId });
    }

    this.currentTeam = null;
    return { success: true, team };
  }

  /**
   * 踢出成员
   */
  kickMember(memberId) {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    const leader = this.currentTeam.getLeader();
    const currentMember = this.currentTeam.getMember(this.currentPlayerId);
    
    // 只有队长或副队长可以踢人
    if (!currentMember || (currentMember.role !== TeamRole.LEADER && currentMember.role !== TeamRole.ASSISTANT)) {
      return { success: false, error: '你没有权限踢出成员' };
    }

    // 不能踢队长
    if (memberId === this.currentTeam.leaderId) {
      return { success: false, error: '不能踢出队长' };
    }

    // 副队长不能踢副队长
    const targetMember = this.currentTeam.getMember(memberId);
    if (currentMember.role === TeamRole.ASSISTANT && targetMember?.role === TeamRole.ASSISTANT) {
      return { success: false, error: '副队长不能踢出其他副队长' };
    }

    const result = this.currentTeam.removeMember(memberId);
    if (result.success) {
      this.emit('memberKicked', { team: this.currentTeam, member: result.member, kickedBy: this.currentPlayerId });
    }

    return result;
  }

  /**
   * 转移队长
   */
  transferLeadership(newLeaderId) {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    if (this.currentTeam.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有队长可以转移队长职位' };
    }

    const result = this.currentTeam.transferLeader(newLeaderId);
    if (result.success) {
      this.emit('leaderChanged', { team: this.currentTeam, oldLeaderId: result.oldLeaderId, newLeaderId: result.newLeaderId });
    }

    return result;
  }

  /**
   * 设置副队长
   */
  setAssistant(memberId, isAssistant = true) {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    if (this.currentTeam.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有队长可以设置副队长' };
    }

    const result = this.currentTeam.setAssistant(memberId, isAssistant);
    if (result.success) {
      this.emit('assistantChanged', { team: this.currentTeam, memberId, isAssistant });
    }

    return result;
  }

  /**
   * 发送邀请
   */
  sendInvite(targetId, targetName) {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    if (this.currentTeam.isFull()) {
      return { success: false, error: '队伍已满' };
    }

    // 检查是否已经邀请过
    for (const invite of this.invites.values()) {
      if (invite.toId === targetId && invite.teamId === this.currentTeam.id && invite.isPending()) {
        return { success: false, error: '已经向该玩家发送过邀请' };
      }
    }

    const currentMember = this.currentTeam.getMember(this.currentPlayerId);
    const invite = new TeamInvite({
      teamId: this.currentTeam.id,
      teamName: this.currentTeam.name,
      fromId: this.currentPlayerId,
      fromName: currentMember?.name || '未知',
      toId: targetId,
      toName: targetName,
      expiresAt: Date.now() + this.config.inviteTimeout
    });

    this.invites.set(invite.id, invite);
    this.emit('inviteSent', { invite });

    return { success: true, invite };
  }

  /**
   * 接受邀请
   */
  acceptInvite(inviteId, playerData = {}) {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      return { success: false, error: '邀请不存在' };
    }

    if (invite.isExpired()) {
      invite.status = InviteStatus.EXPIRED;
      this.invites.delete(inviteId);
      return { success: false, error: '邀请已过期' };
    }

    if (invite.toId !== this.currentPlayerId) {
      return { success: false, error: '这不是发给你的邀请' };
    }

    if (this.currentTeam) {
      return { success: false, error: '你已经在一个队伍中' };
    }

    // 查找队伍
    let team = this.publicTeams.get(invite.teamId);
    if (!team) {
      // 可能是私有队伍，需要通过其他方式获取
      return { success: false, error: '队伍不存在或已解散' };
    }

    if (team.isFull()) {
      return { success: false, error: '队伍已满' };
    }

    // 加入队伍
    const result = team.addMember({
      id: this.currentPlayerId,
      name: playerData.name || invite.toName,
      level: playerData.level || 1,
      classType: playerData.classType || 'warrior'
    });

    if (!result.success) {
      return result;
    }

    invite.status = InviteStatus.ACCEPTED;
    this.invites.delete(inviteId);
    this.currentTeam = team;

    this.emit('inviteAccepted', { invite, team, member: result.member });
    this.emit('memberJoined', { team, member: result.member });

    return { success: true, team, member: result.member };
  }

  /**
   * 拒绝邀请
   */
  rejectInvite(inviteId) {
    const invite = this.invites.get(inviteId);
    if (!invite) {
      return { success: false, error: '邀请不存在' };
    }

    if (invite.toId !== this.currentPlayerId) {
      return { success: false, error: '这不是发给你的邀请' };
    }

    invite.status = InviteStatus.REJECTED;
    this.invites.delete(inviteId);

    this.emit('inviteRejected', { invite });
    return { success: true, invite };
  }

  /**
   * 获取收到的邀请
   */
  getReceivedInvites() {
    const invites = [];
    for (const invite of this.invites.values()) {
      if (invite.toId === this.currentPlayerId && invite.isPending()) {
        invites.push(invite);
      }
    }
    return invites;
  }

  /**
   * 获取发出的邀请
   */
  getSentInvites() {
    const invites = [];
    for (const invite of this.invites.values()) {
      if (invite.fromId === this.currentPlayerId && invite.isPending()) {
        invites.push(invite);
      }
    }
    return invites;
  }

  /**
   * 申请加入队伍
   */
  applyToTeam(teamId, playerData = {}) {
    if (this.currentTeam) {
      return { success: false, error: '你已经在一个队伍中' };
    }

    const team = this.publicTeams.get(teamId);
    if (!team) {
      return { success: false, error: '队伍不存在' };
    }

    if (!team.isPublic) {
      return { success: false, error: '该队伍不接受申请' };
    }

    if (team.isFull()) {
      return { success: false, error: '队伍已满' };
    }

    // 检查等级限制
    const playerLevel = playerData.level || 1;
    if (playerLevel < team.minLevel || playerLevel > team.maxLevel) {
      return { success: false, error: `等级不符合要求 (${team.minLevel}-${team.maxLevel})` };
    }

    // 创建申请（作为邀请的反向）
    const application = new TeamInvite({
      teamId: team.id,
      teamName: team.name,
      fromId: this.currentPlayerId,
      fromName: playerData.name || '申请者',
      toId: team.leaderId,
      toName: team.getLeader()?.name || '队长',
      expiresAt: Date.now() + this.config.inviteTimeout
    });

    this.invites.set(application.id, application);
    this.emit('applicationSent', { application, team });

    return { success: true, application };
  }

  /**
   * 搜索公开队伍
   */
  searchPublicTeams(filters = {}) {
    const results = [];
    
    for (const team of this.publicTeams.values()) {
      if (!team.isPublic) continue;
      if (team.isFull()) continue;

      // 等级过滤
      if (filters.level) {
        if (filters.level < team.minLevel || filters.level > team.maxLevel) {
          continue;
        }
      }

      // 活动过滤
      if (filters.activity && team.targetActivity !== filters.activity) {
        continue;
      }

      // 名称搜索
      if (filters.name && !team.name.toLowerCase().includes(filters.name.toLowerCase())) {
        continue;
      }

      results.push(team);
    }

    return results;
  }

  /**
   * 设置队伍设置
   */
  setTeamSettings(settings) {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    if (this.currentTeam.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有队长可以修改队伍设置' };
    }

    if (settings.name !== undefined) this.currentTeam.name = settings.name;
    if (settings.isPublic !== undefined) {
      this.currentTeam.isPublic = settings.isPublic;
      if (settings.isPublic) {
        this.publicTeams.set(this.currentTeam.id, this.currentTeam);
      } else {
        this.publicTeams.delete(this.currentTeam.id);
      }
    }
    if (settings.minLevel !== undefined) this.currentTeam.minLevel = settings.minLevel;
    if (settings.maxLevel !== undefined) this.currentTeam.maxLevel = settings.maxLevel;
    if (settings.targetActivity !== undefined) this.currentTeam.targetActivity = settings.targetActivity;
    if (settings.expShareMode !== undefined) this.currentTeam.expShareMode = settings.expShareMode;
    if (settings.lootMode !== undefined) this.currentTeam.lootMode = settings.lootMode;

    this.emit('teamSettingsChanged', { team: this.currentTeam, settings });
    return { success: true, team: this.currentTeam };
  }

  /**
   * 更新成员状态
   */
  updateMemberStatus(memberId, data) {
    if (!this.currentTeam) return false;
    
    const updated = this.currentTeam.updateMember(memberId, data);
    if (updated) {
      this.emit('memberUpdated', { team: this.currentTeam, memberId, data });
    }
    return updated;
  }

  /**
   * 获取当前队伍
   */
  getCurrentTeam() {
    return this.currentTeam;
  }

  /**
   * 检查是否在队伍中
   */
  isInTeam() {
    return this.currentTeam !== null;
  }

  /**
   * 检查是否是队长
   */
  isLeader() {
    return this.currentTeam && this.currentTeam.leaderId === this.currentPlayerId;
  }

  /**
   * 获取队伍成员
   */
  getTeamMembers() {
    return this.currentTeam ? this.currentTeam.getAllMembers() : [];
  }

  /**
   * 发送队伍消息
   */
  sendTeamMessage(message) {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    const member = this.currentTeam.getMember(this.currentPlayerId);
    const chatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      teamId: this.currentTeam.id,
      senderId: this.currentPlayerId,
      senderName: member?.name || '未知',
      content: message,
      timestamp: Date.now()
    };

    this.emit('teamMessage', { team: this.currentTeam, message: chatMessage });
    return { success: true, message: chatMessage };
  }

  /**
   * 传送到队长位置
   */
  teleportToLeader() {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    const leader = this.currentTeam.getLeader();
    if (!leader) {
      return { success: false, error: '队长不存在' };
    }

    if (leader.id === this.currentPlayerId) {
      return { success: false, error: '你就是队长' };
    }

    this.emit('teleportRequest', { 
      team: this.currentTeam, 
      targetId: leader.id,
      targetPosition: leader.position,
      targetMapId: leader.mapId
    });

    return { success: true, position: leader.position, mapId: leader.mapId };
  }

  /**
   * 召集队员
   */
  summonTeamMembers() {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    if (this.currentTeam.leaderId !== this.currentPlayerId) {
      return { success: false, error: '只有队长可以召集队员' };
    }

    const leader = this.currentTeam.getLeader();
    this.emit('summonRequest', {
      team: this.currentTeam,
      position: leader.position,
      mapId: leader.mapId
    });

    return { success: true };
  }

  /**
   * 分配掉落物品
   */
  distributeLoot(lootItems) {
    if (!this.currentTeam) {
      return { success: false, error: '你不在任何队伍中' };
    }

    const distributions = [];
    const members = this.currentTeam.getAllMembers().filter(m => m.isOnline);

    switch (this.currentTeam.lootMode) {
      case LootMode.FREE_FOR_ALL:
        // 自由拾取，不做分配
        distributions.push({ mode: 'free', items: lootItems });
        break;

      case LootMode.ROUND_ROBIN:
        // 轮流分配
        lootItems.forEach(item => {
          const receiver = this.currentTeam.getNextLootReceiver();
          if (receiver) {
            distributions.push({ memberId: receiver.id, memberName: receiver.name, item });
          }
        });
        break;

      case LootMode.LEADER_ASSIGN:
        // 队长分配，返回待分配列表
        distributions.push({ mode: 'leader_assign', items: lootItems, leaderId: this.currentTeam.leaderId });
        break;

      case LootMode.NEED_GREED:
        // Need/Greed 投票，返回待投票列表
        lootItems.forEach(item => {
          distributions.push({ 
            mode: 'need_greed', 
            item, 
            votes: members.map(m => ({ memberId: m.id, vote: null }))
          });
        });
        break;
    }

    this.emit('lootDistributed', { team: this.currentTeam, distributions });
    return { success: true, distributions };
  }

  /**
   * 分配经验
   */
  distributeExp(totalExp) {
    if (!this.currentTeam) {
      return { memberId: this.currentPlayerId, exp: totalExp };
    }

    const shares = this.currentTeam.calculateExpShare(totalExp);
    this.emit('expDistributed', { team: this.currentTeam, shares, totalExp });
    return shares;
  }

  // ==================== 事件系统 ====================

  /**
   * 注册事件监听器
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  /**
   * 移除事件监听器
   */
  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`TeamSystem event error (${event}):`, error);
        }
      });
    }
  }

  // ==================== 网络同步接口 ====================

  /**
   * 处理服务器同步数据
   */
  handleServerSync(data) {
    switch (data.type) {
      case 'team_update':
        if (this.currentTeam && this.currentTeam.id === data.teamId) {
          // 更新队伍数据
          if (data.members) {
            data.members.forEach(m => {
              this.currentTeam.updateMember(m.id, m);
            });
          }
          if (data.state) this.currentTeam.state = data.state;
        }
        break;

      case 'member_joined':
        if (this.currentTeam && this.currentTeam.id === data.teamId) {
          this.currentTeam.addMember(data.member);
          this.emit('memberJoined', { team: this.currentTeam, member: data.member });
        }
        break;

      case 'member_left':
        if (this.currentTeam && this.currentTeam.id === data.teamId) {
          const result = this.currentTeam.removeMember(data.memberId);
          if (result.success) {
            this.emit('memberLeft', { team: this.currentTeam, member: result.member });
          }
        }
        break;

      case 'team_disbanded':
        if (this.currentTeam && this.currentTeam.id === data.teamId) {
          const team = this.currentTeam;
          this.currentTeam = null;
          this.emit('teamDisbanded', { team });
        }
        break;

      case 'invite_received':
        const invite = new TeamInvite(data.invite);
        this.invites.set(invite.id, invite);
        this.emit('inviteReceived', { invite });
        break;

      case 'leader_changed':
        if (this.currentTeam && this.currentTeam.id === data.teamId) {
          this.currentTeam.transferLeader(data.newLeaderId);
          this.emit('leaderChanged', { 
            team: this.currentTeam, 
            oldLeaderId: data.oldLeaderId, 
            newLeaderId: data.newLeaderId 
          });
        }
        break;
    }
  }

  /**
   * 获取需要同步到服务器的数据
   */
  getNetworkSyncData() {
    if (!this.currentTeam) return null;

    const member = this.currentTeam.getMember(this.currentPlayerId);
    return {
      teamId: this.currentTeam.id,
      memberId: this.currentPlayerId,
      position: member?.position,
      hp: member?.hp,
      maxHp: member?.maxHp,
      mp: member?.mp,
      maxMp: member?.maxMp,
      mapId: member?.mapId
    };
  }
}

// 导出默认实例
export default TeamSystem;
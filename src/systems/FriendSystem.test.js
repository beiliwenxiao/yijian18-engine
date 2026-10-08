/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * FriendSystem 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  FriendSystem, 
  Friend, 
  FriendRequest, 
  FriendStatus, 
  FriendRequestStatus, 
  FriendGroupType 
} from './FriendSystem.js';

describe('FriendSystem', () => {
  let friendSystem;

  beforeEach(() => {
    friendSystem = new FriendSystem();
    friendSystem.setCurrentPlayer('player1');
  });

  describe('Friend类', () => {
    it('应该正确创建好友对象', () => {
      const friend = new Friend({
        id: 'friend1',
        name: '测试好友',
        level: 10,
        class: 'strategist'
      });

      expect(friend.id).toBe('friend1');
      expect(friend.name).toBe('测试好友');
      expect(friend.level).toBe(10);
      expect(friend.class).toBe('strategist');
      expect(friend.status).toBe(FriendStatus.OFFLINE);
    });

    it('应该正确判断在线状态', () => {
      const friend = new Friend({ id: 'f1', status: FriendStatus.ONLINE });
      expect(friend.isOnline()).toBe(true);

      friend.status = FriendStatus.OFFLINE;
      expect(friend.isOnline()).toBe(false);
    });

    it('应该返回正确的状态文本', () => {
      const friend = new Friend({ id: 'f1' });
      
      friend.status = FriendStatus.ONLINE;
      expect(friend.getStatusText()).toBe('在线');
      
      friend.status = FriendStatus.IN_DUNGEON;
      expect(friend.getStatusText()).toBe('副本中');
    });

    it('应该正确序列化', () => {
      const friend = new Friend({
        id: 'f1',
        name: '好友',
        level: 5
      });

      const json = friend.toJSON();
      expect(json.id).toBe('f1');
      expect(json.name).toBe('好友');
      expect(json.level).toBe(5);
    });
  });

  describe('FriendRequest类', () => {
    it('应该正确创建好友请求', () => {
      const request = new FriendRequest({
        fromId: 'player1',
        fromName: '玩家1',
        toId: 'player2',
        message: '加个好友'
      });

      expect(request.fromId).toBe('player1');
      expect(request.toId).toBe('player2');
      expect(request.message).toBe('加个好友');
      expect(request.status).toBe(FriendRequestStatus.PENDING);
    });

    it('应该正确判断过期状态', () => {
      const request = new FriendRequest({
        fromId: 'p1',
        toId: 'p2',
        expiresAt: Date.now() - 1000
      });

      expect(request.isExpired()).toBe(true);
    });

    it('应该正确判断待处理状态', () => {
      const request = new FriendRequest({
        fromId: 'p1',
        toId: 'p2'
      });

      expect(request.isPending()).toBe(true);

      request.status = FriendRequestStatus.ACCEPTED;
      expect(request.isPending()).toBe(false);
    });
  });

  describe('好友管理', () => {
    it('应该能添加好友', () => {
      const result = friendSystem.addFriend({
        id: 'friend1',
        name: '好友1',
        level: 10
      });

      expect(result).toBe(true);
      expect(friendSystem.getFriend('friend1')).toBeDefined();
      expect(friendSystem.getAllFriends().length).toBe(1);
    });

    it('不应该重复添加好友', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      const result = friendSystem.addFriend({ id: 'f1', name: '好友1' });

      expect(result).toBe(false);
      expect(friendSystem.getAllFriends().length).toBe(1);
    });

    it('应该能删除好友', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      const result = friendSystem.removeFriend('f1');

      expect(result).toBe(true);
      expect(friendSystem.getFriend('f1')).toBeUndefined();
    });

    it('应该能获取在线好友', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1', status: FriendStatus.ONLINE });
      friendSystem.addFriend({ id: 'f2', name: '好友2', status: FriendStatus.OFFLINE });
      friendSystem.addFriend({ id: 'f3', name: '好友3', status: FriendStatus.IN_GAME });

      const onlineFriends = friendSystem.getOnlineFriends();
      expect(onlineFriends.length).toBe(2);
    });

    it('应该限制好友数量', () => {
      friendSystem.maxFriends = 2;
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      friendSystem.addFriend({ id: 'f2', name: '好友2' });
      const result = friendSystem.addFriend({ id: 'f3', name: '好友3' });

      expect(result).toBe(false);
      expect(friendSystem.getAllFriends().length).toBe(2);
    });
  });

  describe('好友分组', () => {
    it('应该能移动好友到分组', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      const result = friendSystem.moveFriendToGroup('f1', FriendGroupType.CLOSE_FRIENDS);

      expect(result).toBe(true);
      const friend = friendSystem.getFriend('f1');
      expect(friend.group).toBe(FriendGroupType.CLOSE_FRIENDS);
    });

    it('应该能获取分组好友', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1', group: FriendGroupType.CLOSE_FRIENDS });
      friendSystem.addFriend({ id: 'f2', name: '好友2', group: FriendGroupType.DEFAULT });

      const closeFriends = friendSystem.getFriendsByGroup(FriendGroupType.CLOSE_FRIENDS);
      expect(closeFriends.length).toBe(1);
      expect(closeFriends[0].id).toBe('f1');
    });
  });

  describe('好友备注和状态', () => {
    it('应该能设置好友备注', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      const result = friendSystem.setFriendNote('f1', '这是我的好朋友');

      expect(result).toBe(true);
      expect(friendSystem.getFriend('f1').note).toBe('这是我的好朋友');
    });

    it('应该能更新好友状态', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      const result = friendSystem.updateFriendStatus('f1', FriendStatus.IN_DUNGEON, '火焰副本');

      expect(result).toBe(true);
      const friend = friendSystem.getFriend('f1');
      expect(friend.status).toBe(FriendStatus.IN_DUNGEON);
      expect(friend.location).toBe('火焰副本');
    });

    it('应该能更新好友信息', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1', level: 10 });
      friendSystem.updateFriendInfo('f1', { level: 15, class: 'strategist' });

      const friend = friendSystem.getFriend('f1');
      expect(friend.level).toBe(15);
      expect(friend.class).toBe('strategist');
    });

    it('应该能增加亲密度', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      friendSystem.addIntimacy('f1', 100);

      expect(friendSystem.getFriend('f1').intimacy).toBe(100);
    });
  });

  describe('好友请求', () => {
    it('应该能发送好友请求', () => {
      const request = friendSystem.sendFriendRequest('player2', '玩家2', '加个好友吧');

      expect(request).not.toBeNull();
      expect(request.toId).toBe('player2');
      expect(request.message).toBe('加个好友吧');
    });

    it('不应该向已有好友发送请求', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      const request = friendSystem.sendFriendRequest('f1', '好友1');

      expect(request).toBeNull();
    });

    it('应该能接受好友请求', () => {
      const request = friendSystem.receiveRequest({
        id: 'req1',
        fromId: 'player2',
        fromName: '玩家2',
        toId: 'player1'
      });

      const result = friendSystem.acceptRequest('req1');
      expect(result).toBe(true);
      expect(friendSystem.isFriend('player2')).toBe(true);
    });

    it('应该能拒绝好友请求', () => {
      friendSystem.receiveRequest({
        id: 'req1',
        fromId: 'player2',
        fromName: '玩家2',
        toId: 'player1'
      });

      const result = friendSystem.rejectRequest('req1');
      expect(result).toBe(true);
      expect(friendSystem.isFriend('player2')).toBe(false);
    });

    it('应该能获取待处理请求', () => {
      friendSystem.receiveRequest({ id: 'req1', fromId: 'p2', toId: 'p1' });
      friendSystem.receiveRequest({ id: 'req2', fromId: 'p3', toId: 'p1' });

      const pending = friendSystem.getPendingRequests();
      expect(pending.length).toBe(2);
    });
  });

  describe('黑名单', () => {
    it('应该能添加到黑名单', () => {
      const result = friendSystem.blockPlayer('badPlayer');

      expect(result).toBe(true);
      expect(friendSystem.isBlocked('badPlayer')).toBe(true);
    });

    it('添加黑名单时应该删除好友关系', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      friendSystem.blockPlayer('f1');

      expect(friendSystem.isFriend('f1')).toBe(false);
      expect(friendSystem.isBlocked('f1')).toBe(true);
    });

    it('应该能从黑名单移除', () => {
      friendSystem.blockPlayer('badPlayer');
      const result = friendSystem.unblockPlayer('badPlayer');

      expect(result).toBe(true);
      expect(friendSystem.isBlocked('badPlayer')).toBe(false);
    });

    it('不应该添加黑名单中的玩家为好友', () => {
      friendSystem.blockPlayer('badPlayer');
      const result = friendSystem.addFriend({ id: 'badPlayer', name: '坏人' });

      expect(result).toBe(false);
    });
  });

  describe('搜索和排序', () => {
    beforeEach(() => {
      friendSystem.addFriend({ id: 'f1', name: '张三', level: 10, status: FriendStatus.ONLINE });
      friendSystem.addFriend({ id: 'f2', name: '李四', level: 20, status: FriendStatus.OFFLINE });
      friendSystem.addFriend({ id: 'f3', name: '王五', level: 15, status: FriendStatus.ONLINE });
    });

    it('应该能搜索好友', () => {
      const results = friendSystem.searchFriends('张');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('张三');
    });

    it('应该能按状态排序', () => {
      const sorted = friendSystem.getSortedFriends('status');
      expect(sorted[0].isOnline()).toBe(true);
      expect(sorted[sorted.length - 1].isOnline()).toBe(false);
    });

    it('应该能按等级排序', () => {
      const sorted = friendSystem.getSortedFriends('level');
      expect(sorted[0].level).toBe(20);
    });

    it('应该能按名字排序', () => {
      const sorted = friendSystem.getSortedFriends('name');
      const names = sorted.map(friend => friend.name);
      // localeCompare 顺序随 ICU 环境不同（拼音/部首/码点），断言满足同名比较器的稳定升序
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      expect(names).toHaveLength(3);
    });
  });

  describe('统计信息', () => {
    it('应该返回正确的统计信息', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1', status: FriendStatus.ONLINE });
      friendSystem.addFriend({ id: 'f2', name: '好友2', status: FriendStatus.OFFLINE });
      friendSystem.blockPlayer('bad1');
      friendSystem.receiveRequest({ id: 'req1', fromId: 'p2', toId: 'p1' });

      const stats = friendSystem.getStatistics();
      expect(stats.total).toBe(2);
      expect(stats.online).toBe(1);
      expect(stats.offline).toBe(1);
      expect(stats.blocked).toBe(1);
      expect(stats.pendingRequests).toBe(1);
    });
  });

  describe('事件系统', () => {
    it('应该触发好友添加事件', () => {
      const callback = vi.fn();
      friendSystem.on('friendAdded', callback);
      friendSystem.addFriend({ id: 'f1', name: '好友1' });

      expect(callback).toHaveBeenCalled();
    });

    it('应该触发好友删除事件', () => {
      const callback = vi.fn();
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      friendSystem.on('friendRemoved', callback);
      friendSystem.removeFriend('f1');

      expect(callback).toHaveBeenCalled();
    });

    it('应该能移除事件监听', () => {
      const callback = vi.fn();
      friendSystem.on('friendAdded', callback);
      friendSystem.off('friendAdded', callback);
      friendSystem.addFriend({ id: 'f1', name: '好友1' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('序列化', () => {
    it('应该能正确序列化和反序列化', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1', level: 10 });
      friendSystem.blockPlayer('bad1');

      const json = friendSystem.toJSON();
      
      const newSystem = new FriendSystem();
      newSystem.fromJSON(json);

      expect(newSystem.getFriend('f1').name).toBe('好友1');
      expect(newSystem.isBlocked('bad1')).toBe(true);
    });
  });

  describe('重置', () => {
    it('应该能重置系统', () => {
      friendSystem.addFriend({ id: 'f1', name: '好友1' });
      friendSystem.blockPlayer('bad1');
      friendSystem.reset();

      expect(friendSystem.getAllFriends().length).toBe(0);
      expect(friendSystem.getBlockedList().length).toBe(0);
    });
  });
});

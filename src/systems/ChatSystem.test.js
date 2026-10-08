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
 * ChatSystem.test.js
 * 聊天系统单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatSystem, ChatChannel, ChatMessageType, ChatMessage } from './ChatSystem.js';

describe('ChatChannel', () => {
  it('should have all channels defined', () => {
    expect(ChatChannel.WORLD).toBe('world');
    expect(ChatChannel.TEAM).toBe('team');
    expect(ChatChannel.PRIVATE).toBe('private');
    expect(ChatChannel.SYSTEM).toBe('system');
  });
});

describe('ChatMessage', () => {
  it('should create message with default values', () => {
    const msg = new ChatMessage();
    expect(msg.channel).toBe(ChatChannel.WORLD);
    expect(msg.type).toBe(ChatMessageType.TEXT);
  });

  it('should create message with custom values', () => {
    const msg = new ChatMessage({
      channel: ChatChannel.TEAM,
      senderName: 'Player1',
      content: 'Hello!'
    });
    expect(msg.channel).toBe(ChatChannel.TEAM);
    expect(msg.senderName).toBe('Player1');
    expect(msg.content).toBe('Hello!');
  });

  it('should format message correctly', () => {
    const msg = new ChatMessage({
      channel: ChatChannel.WORLD,
      senderName: 'Player1',
      content: 'Hello!'
    });
    const formatted = msg.format();
    expect(formatted).toContain('Player1');
    expect(formatted).toContain('Hello!');
    expect(formatted).toContain('世界');
  });

  it('should format private message correctly', () => {
    const msg = new ChatMessage({
      channel: ChatChannel.PRIVATE,
      senderName: 'Player1',
      targetName: 'Player2',
      content: 'Hi!'
    });
    const formatted = msg.format();
    expect(formatted).toContain('私聊');
    expect(formatted).toContain('->');
  });
});

describe('ChatSystem', () => {
  let system;

  beforeEach(() => {
    system = new ChatSystem();
  });

  it('should initialize with empty channels', () => {
    const messages = system.getMessages(ChatChannel.WORLD);
    expect(messages.length).toBe(0);
  });

  it('should send message successfully', () => {
    const result = system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'Hello!'
    });
    
    expect(result.success).toBe(true);
    expect(result.message.content).toBe('Hello!');
  });

  it('should add message to channel', () => {
    system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'Test'
    });
    
    const messages = system.getMessages(ChatChannel.WORLD);
    expect(messages.length).toBe(1);
  });

  it('should filter sensitive words', () => {
    system.filterWords = ['badword'];
    
    const result = system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'This is a badword test'
    });
    
    expect(result.message.content).toContain('*******');
  });

  it('should enforce rate limit', () => {
    system.rateLimitInterval = 1000;
    
    system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'First'
    });
    
    const result = system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'Second'
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('频繁');
  });

  it('should send system message', () => {
    system.sendSystemMessage('Welcome!');
    
    const messages = system.getMessages(ChatChannel.SYSTEM);
    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe(ChatMessageType.SYSTEM);
  });

  it('should block user', () => {
    system.blockUser('player2');
    expect(system.isBlocked('player2')).toBe(true);
    
    system.unblockUser('player2');
    expect(system.isBlocked('player2')).toBe(false);
  });

  it('should not receive messages from blocked users', () => {
    system.blockUser('player2');
    
    system.receiveMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player2',
      senderName: 'Player2',
      content: 'Hello'
    });
    
    const messages = system.getMessages(ChatChannel.WORLD);
    expect(messages.length).toBe(0);
  });

  it('should mute channel', () => {
    system.muteChannel(ChatChannel.WORLD);
    expect(system.isMuted(ChatChannel.WORLD)).toBe(true);
    
    const result = system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'Test'
    });
    
    expect(result.success).toBe(false);
  });

  it('should clear channel', () => {
    system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'Test'
    });
    
    system.clearChannel(ChatChannel.WORLD);
    
    const messages = system.getMessages(ChatChannel.WORLD);
    expect(messages.length).toBe(0);
  });

  it('should get all messages', () => {
    system.sendMessage({ channel: ChatChannel.WORLD, senderId: 'p1', senderName: 'P1', content: 'World' });
    system.sendSystemMessage('System');
    
    const all = system.getAllMessages();
    expect(all.length).toBe(2);
  });

  it('should emit events', () => {
    const onSent = vi.fn();
    const onReceived = vi.fn();
    
    system.on('messageSent', onSent);
    system.on('messageReceived', onReceived);
    
    system.sendMessage({
      channel: ChatChannel.WORLD,
      senderId: 'player1',
      senderName: 'Player1',
      content: 'Test'
    });
    
    expect(onSent).toHaveBeenCalled();
    expect(onReceived).toHaveBeenCalled();
  });

  it('should get stats', () => {
    system.sendMessage({ channel: ChatChannel.WORLD, senderId: 'p1', senderName: 'P1', content: 'Test' });
    system.blockUser('blocked');
    
    const stats = system.getStats();
    expect(stats.totalMessages).toBe(1);
    expect(stats.blockedUsers).toBe(1);
  });

  it('should reset system', () => {
    system.sendMessage({ channel: ChatChannel.WORLD, senderId: 'p1', senderName: 'P1', content: 'Test' });
    system.blockUser('blocked');
    
    system.reset();
    
    expect(system.getMessages(ChatChannel.WORLD).length).toBe(0);
    expect(system.blockedUsers.size).toBe(0);
  });
});

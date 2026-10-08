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
 * WebSocketClient.test.js
 * WebSocket客户端单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketClient, ConnectionState, MessageType } from './WebSocketClient.js';

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    
    setTimeout(() => {
      this.readyState = 1;
      this.onopen && this.onopen();
    }, 10);
  }
  
  send(data) {
    if (this.readyState !== 1) throw new Error('Not connected');
  }
  
  close() {
    this.readyState = 3;
    this.onclose && this.onclose({ code: 1000, reason: 'Normal closure' });
  }
}

// 替换全局WebSocket
global.WebSocket = MockWebSocket;

describe('ConnectionState', () => {
  it('should have all states defined', () => {
    expect(ConnectionState.DISCONNECTED).toBe('disconnected');
    expect(ConnectionState.CONNECTING).toBe('connecting');
    expect(ConnectionState.CONNECTED).toBe('connected');
    expect(ConnectionState.RECONNECTING).toBe('reconnecting');
  });
});

describe('MessageType', () => {
  it('should have all message types defined', () => {
    expect(MessageType.PING).toBe('ping');
    expect(MessageType.PONG).toBe('pong');
    expect(MessageType.PLAYER_MOVE).toBe('player_move');
    expect(MessageType.CHAT_MESSAGE).toBe('chat_message');
  });
});

describe('WebSocketClient', () => {
  let client;

  beforeEach(() => {
    client = new WebSocketClient({
      url: 'ws://localhost:8080',
      autoReconnect: false
    });
  });

  it('should create client with default config', () => {
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
    expect(client.autoReconnect).toBe(false);
  });

  it('should connect successfully', async () => {
    const onConnected = vi.fn();
    client.on('connected', onConnected);
    
    await client.connect();
    
    expect(client.state).toBe(ConnectionState.CONNECTED);
    expect(onConnected).toHaveBeenCalled();
  });

  it('should disconnect', async () => {
    await client.connect();
    
    const onDisconnected = vi.fn();
    client.on('disconnected', onDisconnected);
    
    client.disconnect();
    
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
    expect(onDisconnected).toHaveBeenCalled();
  });

  it('should check connection state', async () => {
    expect(client.isConnected()).toBe(false);
    
    await client.connect();
    
    expect(client.isConnected()).toBe(true);
  });

  it('should queue messages when disconnected', () => {
    client.send(MessageType.CHAT_MESSAGE, { text: 'Hello' });
    
    expect(client.messageQueue.length).toBe(1);
  });

  it('should register message handlers', () => {
    const handler = vi.fn();
    client.onMessage(MessageType.CHAT_MESSAGE, handler);
    
    expect(client.messageHandlers.has(MessageType.CHAT_MESSAGE)).toBe(true);
  });

  it('should remove message handlers', () => {
    const handler = vi.fn();
    client.onMessage(MessageType.CHAT_MESSAGE, handler);
    client.offMessage(MessageType.CHAT_MESSAGE, handler);
    
    expect(client.messageHandlers.get(MessageType.CHAT_MESSAGE).length).toBe(0);
  });

  it('should calculate average latency', () => {
    client.latencyHistory = [100, 120, 80, 100];
    
    expect(client.getAverageLatency()).toBe(100);
  });

  it('should get stats', async () => {
    await client.connect();
    
    const stats = client.getStats();
    
    expect(stats.state).toBe(ConnectionState.CONNECTED);
    expect(stats.queuedMessages).toBe(0);
  });

  it('should emit events', () => {
    const callback = vi.fn();
    client.on('test', callback);
    
    client.emit('test', { data: 'test' });
    
    expect(callback).toHaveBeenCalledWith({ data: 'test' });
  });

  it('should remove event listeners', () => {
    const callback = vi.fn();
    client.on('test', callback);
    client.off('test', callback);
    
    client.emit('test', {});
    
    expect(callback).not.toHaveBeenCalled();
  });
});

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

import { Logger } from '../core/Logger.js';

/**
 * 模拟WebSocket客户端
 * 用于前端开发，模拟与服务器的通信
 */
export class MockWebSocket {
    constructor(config = {}) {
        this.config = {
            useMockData: true,
            mockDelay: 100, // 模拟网络延迟（毫秒）
            serverUrl: 'ws://localhost:8080',
            ...config
        };

        this.isConnected = false;
        this.messageQueue = [];
        this.messageHandlers = new Map();
        this.nextMessageId = 1;
        
        // 用于存储待处理的回调
        this.pendingCallbacks = new Map();
    }

    /**
     * 连接到服务器（模拟）
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (!this.config.useMockData) {
                // 真实WebSocket连接（未实现）
                reject(new Error('Real WebSocket connection not implemented yet'));
                return;
            }

            // 模拟连接延迟
            setTimeout(() => {
                this.isConnected = true;
                Logger.log('MockWebSocket: Connected (simulated)');
                resolve();
            }, this.config.mockDelay);
        });
    }

    /**
     * 断开连接
     */
    disconnect() {
        this.isConnected = false;
        this.messageQueue = [];
        this.pendingCallbacks.clear();
        Logger.log('MockWebSocket: Disconnected');
    }

    /**
     * 发送消息
     */
    send(type, data) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Not connected'));
                return;
            }

            const message = this.createMessage(type, data);
            
            if (this.config.useMockData) {
                // 模拟发送和响应
                this.simulateSend(message, resolve, reject);
            } else {
                // 真实WebSocket发送（未实现）
                reject(new Error('Real WebSocket send not implemented yet'));
            }
        });
    }

    /**
     * 模拟发送消息
     */
    simulateSend(message, resolve, reject) {
        Logger.log('MockWebSocket: Sending message', message);

        // 模拟网络延迟
        setTimeout(() => {
            try {
                // 根据消息类型生成模拟响应
                const response = this.generateMockResponse(message);
                
                // 触发消息处理器
                this.handleMessage(response);
                
                resolve(response);
            } catch (error) {
                console.error('MockWebSocket: Error generating response', error);
                reject(error);
            }
        }, this.config.mockDelay);
    }

    /**
     * 创建消息对象
     */
    createMessage(type, data) {
        return {
            id: this.nextMessageId++,
            type: type,
            data: data,
            timestamp: Date.now()
        };
    }

    /**
     * 生成模拟响应
     */
    generateMockResponse(message) {
        const response = {
            id: message.id,
            type: `${message.type}_response`,
            data: null,
            timestamp: Date.now(),
            success: true
        };

        switch (message.type) {
            case 'login':
                response.data = {
                    success: true,
                    sessionId: `session_${Date.now()}`,
                    message: 'Login successful'
                };
                break;

            case 'create_character':
                response.data = {
                    success: true,
                    character: message.data.character,
                    message: 'Character created successfully'
                };
                break;

            case 'select_character':
                response.data = {
                    success: true,
                    character: message.data.character,
                    message: 'Character selected'
                };
                break;

            case 'move':
                response.data = {
                    success: true,
                    position: message.data.position,
                    timestamp: Date.now()
                };
                break;

            case 'attack':
                response.data = {
                    success: true,
                    attackerId: message.data.attackerId,
                    targetId: message.data.targetId,
                    damage: this.calculateMockDamage(message.data),
                    timestamp: Date.now()
                };
                break;

            case 'use_skill':
                response.data = {
                    success: true,
                    casterId: message.data.casterId,
                    skillId: message.data.skillId,
                    targetId: message.data.targetId,
                    effects: this.calculateMockSkillEffects(message.data),
                    timestamp: Date.now()
                };
                break;

            case 'damage':
                response.data = {
                    success: true,
                    targetId: message.data.targetId,
                    damage: message.data.damage,
                    currentHp: message.data.currentHp,
                    timestamp: Date.now()
                };
                break;

            case 'death':
                response.data = {
                    success: true,
                    entityId: message.data.entityId,
                    killerId: message.data.killerId,
                    expReward: message.data.expReward || 0,
                    timestamp: Date.now()
                };
                break;

            case 'respawn':
                response.data = {
                    success: true,
                    characterId: message.data.characterId,
                    position: message.data.position,
                    timestamp: Date.now()
                };
                break;

            default:
                response.data = {
                    success: true,
                    message: 'Message received',
                    echo: message.data
                };
        }

        return response;
    }

    /**
     * 计算模拟伤害
     */
    calculateMockDamage(data) {
        const baseAttack = data.attack || 10;
        const defense = data.defense || 5;
        const randomFactor = 0.8 + Math.random() * 0.4; // 0.8 - 1.2
        
        const damage = Math.max(1, Math.floor((baseAttack - defense * 0.5) * randomFactor));
        return damage;
    }

    /**
     * 计算模拟技能效果
     */
    calculateMockSkillEffects(data) {
        const effects = [];
        
        if (data.damage) {
            effects.push({
                type: 'damage',
                value: data.damage
            });
        }

        if (data.heal) {
            effects.push({
                type: 'heal',
                value: data.heal
            });
        }

        // 可以添加更多效果类型
        
        return effects;
    }

    /**
     * 注册消息处理器
     */
    on(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
    }

    /**
     * 移除消息处理器
     */
    off(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            return;
        }

        const handlers = this.messageHandlers.get(messageType);
        const index = handlers.indexOf(handler);
        if (index > -1) {
            handlers.splice(index, 1);
        }
    }

    /**
     * 处理接收到的消息
     */
    handleMessage(message) {
        Logger.log('MockWebSocket: Received message', message);

        // 触发对应类型的处理器
        if (this.messageHandlers.has(message.type)) {
            const handlers = this.messageHandlers.get(message.type);
            handlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error('MockWebSocket: Error in message handler', error);
                }
            });
        }

        // 触发通用处理器
        if (this.messageHandlers.has('*')) {
            const handlers = this.messageHandlers.get('*');
            handlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error('MockWebSocket: Error in wildcard handler', error);
                }
            });
        }
    }

    /**
     * 模拟服务器推送消息
     */
    simulateServerPush(type, data) {
        if (!this.isConnected) {
            console.warn('MockWebSocket: Cannot push message, not connected');
            return;
        }

        const message = this.createMessage(type, data);
        
        // 模拟延迟
        setTimeout(() => {
            this.handleMessage(message);
        }, this.config.mockDelay);
    }

    /**
     * 获取连接状态
     */
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            useMockData: this.config.useMockData,
            serverUrl: this.config.serverUrl
        };
    }
}

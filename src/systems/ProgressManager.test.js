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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressManager } from './ProgressManager.js';

describe('ProgressManager', () => {
    let progressManager;
    let mockLocalStorage;

    beforeEach(() => {
        // 模拟localStorage
        mockLocalStorage = {
            data: {},
            getItem(key) {
                return this.data[key] || null;
            },
            setItem(key, value) {
                this.data[key] = value;
            },
            removeItem(key) {
                delete this.data[key];
            },
            clear() {
                this.data = {};
            }
        };

        global.localStorage = mockLocalStorage;
        progressManager = new ProgressManager();
    });

    afterEach(() => {
        mockLocalStorage.clear();
    });

    describe('构造函数', () => {
        it('应该正确初始化', () => {
            expect(progressManager.storageKey).toBe('prologue_progress');
            expect(progressManager.version).toBe('1.0');
            expect(progressManager.checkpoints).toBeInstanceOf(Map);
            expect(progressManager.checkpoints.size).toBe(0);
        });
    });

    describe('saveProgress', () => {
        it('应该成功保存进度', () => {
            const progressData = {
                characterName: '测试角色',
                currentAct: 1,
                player: { level: 5 }
            };

            const result = progressManager.saveProgress(progressData);

            expect(result.success).toBe(true);
            expect(mockLocalStorage.data['prologue_progress']).toBeDefined();
        });

        it('保存的数据应该包含时间戳和版本', () => {
            const progressData = { characterName: '测试角色' };
            progressManager.saveProgress(progressData);

            const savedData = JSON.parse(mockLocalStorage.data['prologue_progress']);
            expect(savedData.timestamp).toBeDefined();
            expect(savedData.version).toBe('1.0');
            expect(savedData.characterName).toBe('测试角色');
        });

        it('保存失败时应该返回错误', () => {
            // 模拟localStorage错误
            mockLocalStorage.setItem = () => {
                throw new Error('Storage full');
            };

            const result = progressManager.saveProgress({ test: 'data' });

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe('loadProgress', () => {
        it('应该成功加载进度', () => {
            const progressData = {
                characterName: '测试角色',
                currentAct: 2
            };
            progressManager.saveProgress(progressData);

            const loaded = progressManager.loadProgress();

            expect(loaded).toBeDefined();
            expect(loaded.characterName).toBe('测试角色');
            expect(loaded.currentAct).toBe(2);
        });

        it('没有保存进度时应该返回null', () => {
            const loaded = progressManager.loadProgress();
            expect(loaded).toBeNull();
        });

        it('加载失败时应该返回null', () => {
            mockLocalStorage.data['prologue_progress'] = 'invalid json';
            const loaded = progressManager.loadProgress();
            expect(loaded).toBeNull();
        });
    });

    describe('检查点管理', () => {
        it('应该能创建检查点', () => {
            const checkpointData = { player: { level: 3 } };
            progressManager.createCheckpoint('checkpoint1', checkpointData);

            expect(progressManager.checkpoints.size).toBe(1);
            expect(progressManager.checkpoints.has('checkpoint1')).toBe(true);
        });

        it('检查点应该包含时间戳', () => {
            progressManager.createCheckpoint('checkpoint1', { test: 'data' });
            const checkpoint = progressManager.checkpoints.get('checkpoint1');

            expect(checkpoint.timestamp).toBeDefined();
            expect(checkpoint.id).toBe('checkpoint1');
        });

        it('应该能加载检查点', () => {
            const checkpointData = { player: { level: 5 } };
            progressManager.createCheckpoint('checkpoint1', checkpointData);

            const loaded = progressManager.loadCheckpoint('checkpoint1');

            expect(loaded).toBeDefined();
            expect(loaded.data.player.level).toBe(5);
        });

        it('加载不存在的检查点应该返回null', () => {
            const loaded = progressManager.loadCheckpoint('nonexistent');
            expect(loaded).toBeNull();
        });

        it('应该能删除检查点', () => {
            progressManager.createCheckpoint('checkpoint1', { test: 'data' });
            const result = progressManager.deleteCheckpoint('checkpoint1');

            expect(result).toBe(true);
            expect(progressManager.checkpoints.size).toBe(0);
        });

        it('删除不存在的检查点应该返回false', () => {
            const result = progressManager.deleteCheckpoint('nonexistent');
            expect(result).toBe(false);
        });

        it('应该能获取所有检查点ID', () => {
            progressManager.createCheckpoint('checkpoint1', {});
            progressManager.createCheckpoint('checkpoint2', {});
            progressManager.createCheckpoint('checkpoint3', {});

            const ids = progressManager.getAllCheckpoints();

            expect(ids).toHaveLength(3);
            expect(ids).toContain('checkpoint1');
            expect(ids).toContain('checkpoint2');
            expect(ids).toContain('checkpoint3');
        });

        it('应该能清除所有检查点', () => {
            progressManager.createCheckpoint('checkpoint1', {});
            progressManager.createCheckpoint('checkpoint2', {});

            progressManager.clearAllCheckpoints();

            expect(progressManager.checkpoints.size).toBe(0);
        });
    });

    describe('prepareInheritData', () => {
        it('应该正确准备继承数据', () => {
            const mockPlayer = {
                name: '测试角色',
                level: 10,
                experience: 5000,
                class: 'warrior',
                attributes: { strength: 20, agility: 15 },
                skills: ['skill1', 'skill2'],
                equipment: [{ id: 'sword', name: '铁剑' }],
                inventory: [{ id: 'potion', name: '药水' }],
                currency: 1000,
                allies: ['ally1', 'ally2'],
                completedQuests: ['quest1', 'quest2']
            };

            const inheritData = progressManager.prepareInheritData(mockPlayer);

            expect(inheritData.characterName).toBe('测试角色');
            expect(inheritData.level).toBe(10);
            expect(inheritData.experience).toBe(5000);
            expect(inheritData.class).toBe('warrior');
            expect(inheritData.attributes.strength).toBe(20);
            expect(inheritData.skills).toHaveLength(2);
            expect(inheritData.equipment).toHaveLength(1);
            expect(inheritData.inventory).toHaveLength(1);
            expect(inheritData.currency).toBe(1000);
            expect(inheritData.allies).toHaveLength(2);
            expect(inheritData.completedQuests).toHaveLength(2);
            expect(inheritData.inheritedAt).toBeDefined();
        });

        it('应该处理空玩家数据', () => {
            const mockPlayer = {};
            const inheritData = progressManager.prepareInheritData(mockPlayer);

            expect(inheritData.characterName).toBe('');
            expect(inheritData.level).toBe(1);
            expect(inheritData.experience).toBe(0);
            expect(inheritData.skills).toHaveLength(0);
        });

        it('应该深拷贝数据避免引用问题', () => {
            const mockPlayer = {
                name: '测试',
                attributes: { strength: 10 }
            };

            const inheritData = progressManager.prepareInheritData(mockPlayer);
            inheritData.attributes.strength = 20;

            expect(mockPlayer.attributes.strength).toBe(10);
        });
    });

    describe('clearProgress', () => {
        it('应该清除保存的进度', () => {
            progressManager.saveProgress({ test: 'data' });
            const result = progressManager.clearProgress();

            expect(result).toBe(true);
            expect(mockLocalStorage.data['prologue_progress']).toBeUndefined();
        });

        it('应该清除所有检查点', () => {
            progressManager.createCheckpoint('checkpoint1', {});
            progressManager.clearProgress();

            expect(progressManager.checkpoints.size).toBe(0);
        });
    });

    describe('hasProgress', () => {
        it('有进度时应该返回true', () => {
            progressManager.saveProgress({ test: 'data' });
            expect(progressManager.hasProgress()).toBe(true);
        });

        it('没有进度时应该返回false', () => {
            expect(progressManager.hasProgress()).toBe(false);
        });
    });

    describe('getProgressInfo', () => {
        it('应该返回进度信息', () => {
            const progressData = {
                characterName: '测试角色',
                currentAct: 3,
                player: { level: 8 }
            };
            progressManager.saveProgress(progressData);

            const info = progressManager.getProgressInfo();

            expect(info).toBeDefined();
            expect(info.characterName).toBe('测试角色');
            expect(info.currentAct).toBe(3);
            expect(info.level).toBe(8);
            expect(info.timestamp).toBeDefined();
            expect(info.version).toBe('1.0');
        });

        it('没有进度时应该返回null', () => {
            const info = progressManager.getProgressInfo();
            expect(info).toBeNull();
        });
    });

    describe('导出和导入', () => {
        it('应该能导出进度', () => {
            const progressData = { characterName: '测试角色' };
            progressManager.saveProgress(progressData);

            const exported = progressManager.exportProgress();

            expect(exported).toBeDefined();
            expect(typeof exported).toBe('string');
            
            const parsed = JSON.parse(exported);
            expect(parsed.characterName).toBe('测试角色');
        });

        it('没有进度时导出应该返回null', () => {
            const exported = progressManager.exportProgress();
            expect(exported).toBeNull();
        });

        it('应该能导入进度', () => {
            const progressData = { characterName: '导入角色', currentAct: 4 };
            const jsonData = JSON.stringify(progressData);

            const result = progressManager.importProgress(jsonData);

            expect(result).toBe(true);
            
            const loaded = progressManager.loadProgress();
            expect(loaded.characterName).toBe('导入角色');
            expect(loaded.currentAct).toBe(4);
        });

        it('导入无效JSON应该返回false', () => {
            const result = progressManager.importProgress('invalid json');
            expect(result).toBe(false);
        });
    });
});

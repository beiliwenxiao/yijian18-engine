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
 * 进度管理器
 * 负责序章进度的保存、加载和继承
 */
export class ProgressManager {
    /**
     * 构造函数
     */
    constructor() {
        this.storageKey = 'prologue_progress';
        this.checkpoints = new Map();
        this.version = '1.0';
        
        Logger.log('ProgressManager: Initialized');
    }

    /**
     * 保存游戏进度到本地存储
     * @param {Object} progressData - 进度数据
     * @returns {Object} 保存结果 { success: boolean, error?: Error }
     */
    saveProgress(progressData) {
        try {
            const saveData = {
                ...progressData,
                timestamp: Date.now(),
                version: this.version
            };
            
            const jsonData = JSON.stringify(saveData);
            localStorage.setItem(this.storageKey, jsonData);
            
            Logger.log('ProgressManager: Progress saved successfully');
            return { success: true };
        } catch (error) {
            console.error('ProgressManager: Failed to save progress', error);
            return { success: false, error };
        }
    }

    /**
     * 从本地存储加载游戏进度
     * @returns {Object|null} 进度数据或null（如果不存在）
     */
    loadProgress() {
        try {
            const data = localStorage.getItem(this.storageKey);
            
            if (!data) {
                Logger.log('ProgressManager: No saved progress found');
                return null;
            }
            
            const progressData = JSON.parse(data);
            
            // 版本检查
            if (progressData.version !== this.version) {
                console.warn(`ProgressManager: Version mismatch (saved: ${progressData.version}, current: ${this.version})`);
            }
            
            Logger.log('ProgressManager: Progress loaded successfully');
            return progressData;
        } catch (error) {
            console.error('ProgressManager: Failed to load progress', error);
            return null;
        }
    }

    /**
     * 创建检查点
     * @param {string} checkpointId - 检查点ID
     * @param {Object} data - 检查点数据
     */
    createCheckpoint(checkpointId, data) {
        try {
            // 深拷贝数据以避免引用问题
            const checkpointData = JSON.parse(JSON.stringify(data));
            
            this.checkpoints.set(checkpointId, {
                id: checkpointId,
                data: checkpointData,
                timestamp: Date.now()
            });
            
            Logger.log(`ProgressManager: Checkpoint created: ${checkpointId}`);
        } catch (error) {
            console.error(`ProgressManager: Failed to create checkpoint ${checkpointId}`, error);
        }
    }

    /**
     * 加载检查点
     * @param {string} checkpointId - 检查点ID
     * @returns {Object|null} 检查点数据或null
     */
    loadCheckpoint(checkpointId) {
        const checkpoint = this.checkpoints.get(checkpointId);
        
        if (checkpoint) {
            Logger.log(`ProgressManager: Checkpoint loaded: ${checkpointId}`);
            return checkpoint;
        }
        
        console.warn(`ProgressManager: Checkpoint not found: ${checkpointId}`);
        return null;
    }

    /**
     * 删除检查点
     * @param {string} checkpointId - 检查点ID
     * @returns {boolean} 是否成功删除
     */
    deleteCheckpoint(checkpointId) {
        if (this.checkpoints.has(checkpointId)) {
            this.checkpoints.delete(checkpointId);
            Logger.log(`ProgressManager: Checkpoint deleted: ${checkpointId}`);
            return true;
        }
        
        console.warn(`ProgressManager: Checkpoint not found: ${checkpointId}`);
        return false;
    }

    /**
     * 获取所有检查点ID
     * @returns {Array<string>} 检查点ID数组
     */
    getAllCheckpoints() {
        return Array.from(this.checkpoints.keys());
    }

    /**
     * 清除所有检查点
     */
    clearAllCheckpoints() {
        this.checkpoints.clear();
        Logger.log('ProgressManager: All checkpoints cleared');
    }

    /**
     * 准备继承到正式游戏的数据
     * @param {Object} player - 玩家对象
     * @returns {Object} 继承数据
     */
    prepareInheritData(player) {
        const inheritData = {
            // 基础信息
            characterName: player.name || '',
            level: player.level || 1,
            experience: player.experience || 0,
            class: player.class || '',
            
            // 属性
            attributes: player.attributes ? { ...player.attributes } : {},
            
            // 技能
            skills: player.skills ? [...player.skills] : [],
            
            // 装备
            equipment: player.equipment ? this._cloneEquipment(player.equipment) : [],
            
            // 背包
            inventory: player.inventory ? this._cloneInventory(player.inventory) : [],
            
            // 货币
            currency: player.currency || 0,
            
            // 盟友
            allies: player.allies ? [...player.allies] : [],
            
            // 完成的任务
            completedQuests: player.completedQuests ? [...player.completedQuests] : [],
            
            // 时间戳
            inheritedAt: Date.now()
        };
        
        Logger.log('ProgressManager: Inherit data prepared');
        return inheritData;
    }

    /**
     * 克隆装备数据
     * @private
     * @param {Array|Object} equipment - 装备数据
     * @returns {Array} 克隆的装备数组
     */
    _cloneEquipment(equipment) {
        try {
            if (Array.isArray(equipment)) {
                return JSON.parse(JSON.stringify(equipment));
            } else if (typeof equipment === 'object') {
                // 如果是对象格式（如 {weapon: {...}, armor: {...}}）
                return JSON.parse(JSON.stringify(equipment));
            }
            return [];
        } catch (error) {
            console.error('ProgressManager: Failed to clone equipment', error);
            return [];
        }
    }

    /**
     * 克隆背包数据
     * @private
     * @param {Array|Object} inventory - 背包数据
     * @returns {Array} 克隆的背包数组
     */
    _cloneInventory(inventory) {
        try {
            if (Array.isArray(inventory)) {
                return JSON.parse(JSON.stringify(inventory));
            } else if (inventory.items && Array.isArray(inventory.items)) {
                // 如果是InventorySystem对象
                return JSON.parse(JSON.stringify(inventory.items));
            }
            return [];
        } catch (error) {
            console.error('ProgressManager: Failed to clone inventory', error);
            return [];
        }
    }

    /**
     * 清除保存的进度
     * @returns {boolean} 是否成功清除
     */
    clearProgress() {
        try {
            localStorage.removeItem(this.storageKey);
            this.checkpoints.clear();
            Logger.log('ProgressManager: Progress cleared');
            return true;
        } catch (error) {
            console.error('ProgressManager: Failed to clear progress', error);
            return false;
        }
    }

    /**
     * 检查是否存在保存的进度
     * @returns {boolean} 是否存在进度
     */
    hasProgress() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data !== null;
        } catch (error) {
            console.error('ProgressManager: Failed to check progress', error);
            return false;
        }
    }

    /**
     * 获取进度信息（不加载完整数据）
     * @returns {Object|null} 进度信息或null
     */
    getProgressInfo() {
        try {
            const data = localStorage.getItem(this.storageKey);
            
            if (!data) {
                return null;
            }
            
            const progressData = JSON.parse(data);
            
            return {
                timestamp: progressData.timestamp,
                version: progressData.version,
                currentAct: progressData.currentAct,
                characterName: progressData.characterName,
                level: progressData.player?.level || 1
            };
        } catch (error) {
            console.error('ProgressManager: Failed to get progress info', error);
            return null;
        }
    }

    /**
     * 导出进度数据（用于备份）
     * @returns {string|null} JSON字符串或null
     */
    exportProgress() {
        try {
            const data = localStorage.getItem(this.storageKey);
            
            if (!data) {
                console.warn('ProgressManager: No progress to export');
                return null;
            }
            
            Logger.log('ProgressManager: Progress exported');
            return data;
        } catch (error) {
            console.error('ProgressManager: Failed to export progress', error);
            return null;
        }
    }

    /**
     * 导入进度数据（用于恢复备份）
     * @param {string} jsonData - JSON字符串
     * @returns {boolean} 是否成功导入
     */
    importProgress(jsonData) {
        try {
            // 验证JSON格式
            const progressData = JSON.parse(jsonData);
            
            // 保存到localStorage
            localStorage.setItem(this.storageKey, jsonData);
            
            Logger.log('ProgressManager: Progress imported successfully');
            return true;
        } catch (error) {
            console.error('ProgressManager: Failed to import progress', error);
            return false;
        }
    }
}

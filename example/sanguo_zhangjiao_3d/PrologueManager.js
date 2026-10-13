
import { Logger } from '../../src/core/Logger.js';
/**
 * 序章管理器
 * 负责管理张角黄巾起义序章的六幕流程、场景切换和进度管理
 * 
 * 职责:
 * - 初始化序章系统
 * - 管理六幕流程（第一幕到第六幕）
 * - 协调各个子系统（战斗、装备、对话等）
 * - 处理序章完成逻辑
 * - 管理进度保存和加载
 * 
 * 复用引擎功能:
 * - SceneManager: 场景管理和切换
 * - AudioManager: 音效和配乐管理
 * - InputManager: 输入处理
 * - AssetManager: 资源加载
 * - ErrorHandler: 错误处理
 */
export class PrologueManager {
    /**
     * 构造函数
     * @param {GameEngine} gameEngine - 游戏引擎实例
     */
    constructor(gameEngine) {
        if (!gameEngine) {
            throw new Error('PrologueManager: gameEngine is required');
        }
        
        this.gameEngine = gameEngine;
        
        // 引擎核心系统引用
        this.sceneManager = gameEngine.sceneManager;
        this.audioManager = gameEngine.audioManager;
        this.inputManager = gameEngine.inputManager;
        this.assetManager = gameEngine.assetManager;
        this.errorHandler = gameEngine.errorHandler;
        
        // 序章状态
        this.isInitialized = false;
        this.isActive = false;
        this.currentAct = 0; // 当前幕数 (0表示未开始, 1-6表示六幕)
        this.isCompleted = false;
        
        // 序章场景映射
        this.actScenes = new Map();
        
        // 场景音乐映射
        this.sceneMusic = {};
        
        // 玩家数据（序章期间的角色数据）
        this.playerData = null;
        
        // 序章配置
        this.config = {
            totalActs: 6,
            actNames: [
                '',
                '第一幕：绝望的开始',
                '第二幕：符水救灾',
                '第三幕：铜钱法器',
                '第四幕：职业选择',
                '第五幕：四场战斗',
                '第六幕：结局'
            ]
        };
        
        Logger.log('PrologueManager: Created');
    }

    /**
     * 初始化序章系统
     * 注册所有序章场景，加载必要资源
     */
    async init() {
        if (this.isInitialized) {
            console.warn('PrologueManager: Already initialized');
            return;
        }

        try {
            Logger.log('PrologueManager: Initializing...');
            
            // 初始化玩家数据
            this.initPlayerData();
            
            // 注册序章场景（占位符，实际场景将在后续任务中实现）
            this.registerScenes();
            
            // 加载序章资源（音乐、音效等）
            await this.loadAssets();
            
            this.isInitialized = true;
            Logger.log('PrologueManager: Initialization complete');
            
        } catch (error) {
            console.error('PrologueManager: Initialization failed', error);
            if (this.errorHandler) {
                this.errorHandler.handleError({
                    type: 'initialization',
                    message: `序章初始化失败: ${error.message}`,
                    context: 'PrologueManager.init',
                    error,
                    timestamp: Date.now()
                });
            }
            throw error;
        }
    }

    /**
     * 初始化玩家数据
     * 创建序章期间使用的角色数据结构
     */
    initPlayerData() {
        this.playerData = {
            // 基础信息
            name: '',
            level: 1,
            experience: 0,
            experienceToNextLevel: 100,
            
            // 职业信息
            class: null, // 'warrior', 'archer', 'mage'
            specialization: null,
            
            // 属性
            attributes: {
                health: 100,
                maxHealth: 100,
                attack: 10,
                defense: 5,
                speed: 100,
                strength: 5,
                agility: 5,
                constitution: 5,
                intelligence: 5,
                spirit: 5
            },
            
            // 装备
            equipment: {
                weapon: null,
                armor: null,
                accessory: null
            },
            
            // 背包
            inventory: [],
            maxInventorySize: 50,
            
            // 技能
            skills: [],
            skillPoints: 0,
            
            // 天赋
            talents: [],
            talentPoints: 0,
            
            // 货币
            currency: 0,
            
            // 状态
            isAlive: true,
            position: { x: 0, y: 0 },
            
            // 序章特有数据
            prologueData: {
                completedActs: [],
                playerChoices: new Map(),
                recruitedNPCs: [],
                battlesWon: 0,
                enemiesDefeated: 0,
                rescuedAllies: []
            }
        };
        
        Logger.log('PrologueManager: Player data initialized');
    }

    /**
     * 注册序章场景
     * 将六幕场景注册到场景管理器
     */
    registerScenes() {
        // 注意：实际场景类将在后续任务中实现
        // 这里先创建占位符映射
        
        // 第一幕到第六幕的场景名称
        const actSceneNames = [
            '',
            'PrologueAct1', // 第一幕：绝望的开始
            'PrologueAct2', // 第二幕：符水救灾
            'PrologueAct3', // 第三幕：铜钱法器
            'PrologueAct4', // 第四幕：职业选择
            'PrologueAct5', // 第五幕：四场战斗
            'PrologueAct6'  // 第六幕：结局
        ];
        
        // 保存场景名称映射
        for (let i = 1; i <= 6; i++) {
            this.actScenes.set(i, actSceneNames[i]);
        }
        
        Logger.log('PrologueManager: Scene mappings registered');
        
        // 实际场景注册将在实现具体场景类后进行
        // 例如: this.sceneManager.registerScene('PrologueAct1', new Act1Scene(this));
    }

    /**
     * 加载序章资源
     * 加载音乐、音效等资源
     */
    async loadAssets() {
        Logger.log('PrologueManager: Loading assets...');
        
        try {
            // 加载音频配置
            const audioConfig = await this.loadAudioConfig();
            
            // 注册音乐
            if (this.audioManager && audioConfig.music) {
                for (const [key, config] of Object.entries(audioConfig.music)) {
                    this.audioManager.addMusic(key, config.file, {
                        volume: config.volume
                    });
                    Logger.log(`PrologueManager: Registered music '${key}'`);
                }
            }
            
            // 注册音效
            if (this.audioManager && audioConfig.sfx) {
                for (const [key, config] of Object.entries(audioConfig.sfx)) {
                    this.audioManager.addSound(key, config.file, {
                        volume: config.volume,
                        loop: config.loop || false
                    });
                    Logger.log(`PrologueManager: Registered sound '${key}'`);
                }
            }
            
            // 保存场景音乐映射
            this.sceneMusic = audioConfig.sceneMusic || {};
            
            Logger.log('PrologueManager: Assets loaded successfully');
            
        } catch (error) {
            console.warn('PrologueManager: Failed to load audio assets', error);
            // 音频加载失败不应阻止游戏运行
            // AudioManager 会优雅地处理缺失的音频文件
        }
    }

    /**
     * 加载音频配置文件
     * @returns {Promise<Object>} 音频配置对象
     */
    async loadAudioConfig() {
        try {
            const response = await fetch('data/AudioConfig.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.warn('PrologueManager: Failed to load audio config', error);
            return { music: {}, sfx: {}, sceneMusic: {} };
        }
    }

    /**
     * 开始序章
     * 从第一幕开始
     * @param {string} characterName - 角色名称
     */
    start(characterName = '无名氏') {
        if (!this.isInitialized) {
            console.error('PrologueManager: Not initialized');
            return;
        }

        Logger.log(`PrologueManager: Starting prologue with character "${characterName}"`);
        
        // 设置角色名称
        this.playerData.name = characterName;
        
        // 标记序章为活动状态
        this.isActive = true;
        this.isCompleted = false;
        
        // 播放序章主题音乐
        if (this.audioManager && this.audioManager.hasMusic('prologue_theme')) {
            this.audioManager.playMusic('prologue_theme', true);
        }
        
        // 进入第一幕
        this.goToAct(1);
    }

    /**
     * 切换到指定幕
     * @param {number} actNumber - 幕数 (1-6)
     * @param {Object} data - 传递给场景的数据
     */
    goToAct(actNumber, data = null) {
        if (actNumber < 1 || actNumber > this.config.totalActs) {
            console.error(`PrologueManager: Invalid act number ${actNumber}`);
            return;
        }

        Logger.log(`PrologueManager: Going to ${this.config.actNames[actNumber]}`);
        
        // 更新当前幕数
        this.currentAct = actNumber;
        
        // 切换场景音乐
        this.switchSceneMusic(actNumber);
        
        // 获取场景名称
        const sceneName = this.actScenes.get(actNumber);
        if (!sceneName) {
            console.error(`PrologueManager: Scene for act ${actNumber} not found`);
            return;
        }
        
        // 准备传递给场景的数据
        const sceneData = {
            actNumber,
            actName: this.config.actNames[actNumber],
            playerData: this.playerData,
            prologueManager: this,
            ...data
        };
        
        // 切换场景
        if (this.sceneManager) {
            this.sceneManager.switchTo(sceneName, sceneData);
        }
    }

    /**
     * 切换场景音乐
     * @param {number} actNumber - 幕数
     */
    switchSceneMusic(actNumber) {
        if (!this.audioManager) return;
        
        const musicKey = this.sceneMusic[`act${actNumber}`];
        if (musicKey && this.audioManager.hasMusic(musicKey)) {
            // 淡出当前音乐，淡入新音乐
            this.audioManager.playMusic(musicKey, true);
            Logger.log(`PrologueManager: Switched to music '${musicKey}'`);
        }
    }

    /**
     * 完成当前幕，进入下一幕
     * @param {Object} actResult - 当前幕的结果数据
     */
    completeCurrentAct(actResult = null) {
        Logger.log(`PrologueManager: Completing act ${this.currentAct}`);
        
        // 记录完成的幕
        if (!this.playerData.prologueData.completedActs.includes(this.currentAct)) {
            this.playerData.prologueData.completedActs.push(this.currentAct);
        }
        
        // 保存进度
        this.saveProgress();
        
        // 如果是最后一幕，完成序章
        if (this.currentAct >= this.config.totalActs) {
            this.complete();
            return;
        }
        
        // 进入下一幕
        const nextAct = this.currentAct + 1;
        this.goToAct(nextAct, actResult);
    }

    /**
     * 完成序章
     * 处理序章完成逻辑，准备进度继承
     */
    complete() {
        Logger.log('PrologueManager: Prologue completed!');
        
        this.isCompleted = true;
        this.isActive = false;
        
        // 保存最终进度
        this.saveProgress();
        
        // 准备进度继承数据
        const inheritData = this.prepareInheritData();
        
        // 播放完成音效
        if (this.audioManager && this.audioManager.hasSound('prologue_complete')) {
            this.audioManager.playSound('prologue_complete');
        }
        
        // 停止序章音乐
        if (this.audioManager) {
            this.audioManager.stopMusic(true);
        }
        
        Logger.log('PrologueManager: Inherit data prepared', inheritData);
        
        // 触发完成回调（如果有）
        if (this.onComplete) {
            this.onComplete(inheritData);
        }
    }

    /**
     * 准备进度继承数据
     * 将序章数据转换为正式游戏可用的格式
     * @returns {Object} 继承数据
     */
    prepareInheritData() {
        return {
            characterName: this.playerData.name,
            level: this.playerData.level,
            experience: this.playerData.experience,
            class: this.playerData.class,
            attributes: { ...this.playerData.attributes },
            skills: [...this.playerData.skills],
            equipment: { ...this.playerData.equipment },
            inventory: [...this.playerData.inventory],
            currency: this.playerData.currency,
            allies: [...this.playerData.prologueData.recruitedNPCs],
            completedQuests: [...this.playerData.prologueData.completedActs],
            playerChoices: Object.fromEntries(this.playerData.prologueData.playerChoices),
            statistics: {
                battlesWon: this.playerData.prologueData.battlesWon,
                enemiesDefeated: this.playerData.prologueData.enemiesDefeated,
                rescuedAllies: this.playerData.prologueData.rescuedAllies
            }
        };
    }

    /**
     * 保存序章进度
     * 将当前进度保存到本地存储
     */
    saveProgress() {
        try {
            const progressData = {
                version: '1.0',
                timestamp: Date.now(),
                currentAct: this.currentAct,
                isCompleted: this.isCompleted,
                playerData: this.playerData
            };
            
            localStorage.setItem('prologue_progress', JSON.stringify(progressData));
            Logger.log('PrologueManager: Progress saved');
            
        } catch (error) {
            console.error('PrologueManager: Failed to save progress', error);
            if (this.errorHandler) {
                this.errorHandler.handleError({
                    type: 'storage',
                    message: `保存进度失败: ${error.message}`,
                    context: 'PrologueManager.saveProgress',
                    error,
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     * 加载序章进度
     * 从本地存储加载进度
     * @returns {boolean} 是否成功加载
     */
    loadProgress() {
        try {
            const savedData = localStorage.getItem('prologue_progress');
            if (!savedData) {
                Logger.log('PrologueManager: No saved progress found');
                return false;
            }
            
            const progressData = JSON.parse(savedData);
            
            // 验证版本
            if (progressData.version !== '1.0') {
                console.warn('PrologueManager: Incompatible save version');
                return false;
            }
            
            // 恢复数据
            this.currentAct = progressData.currentAct;
            this.isCompleted = progressData.isCompleted;
            this.playerData = progressData.playerData;
            
            Logger.log(`PrologueManager: Progress loaded (Act ${this.currentAct})`);
            return true;
            
        } catch (error) {
            console.error('PrologueManager: Failed to load progress', error);
            if (this.errorHandler) {
                this.errorHandler.handleError({
                    type: 'storage',
                    message: `加载进度失败: ${error.message}`,
                    context: 'PrologueManager.loadProgress',
                    error,
                    timestamp: Date.now()
                });
            }
            return false;
        }
    }

    /**
     * 清除保存的进度
     */
    clearProgress() {
        try {
            localStorage.removeItem('prologue_progress');
            Logger.log('PrologueManager: Progress cleared');
        } catch (error) {
            console.error('PrologueManager: Failed to clear progress', error);
        }
    }

    /**
     * 更新序章管理器
     * @param {number} deltaTime - 时间增量（秒）
     */
    update(deltaTime) {
        if (!this.isActive) {
            return;
        }
        
        // 序章管理器本身不需要每帧更新
        // 具体逻辑由各个场景处理
    }

    /**
     * 渲染序章管理器
     * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
     */
    render(ctx) {
        if (!this.isActive) {
            return;
        }
        
        // 序章管理器本身不需要渲染
        // 具体渲染由各个场景处理
    }

    /**
     * 获取当前幕数
     * @returns {number}
     */
    getCurrentAct() {
        return this.currentAct;
    }

    /**
     * 获取当前幕名称
     * @returns {string}
     */
    getCurrentActName() {
        return this.config.actNames[this.currentAct] || '';
    }

    /**
     * 获取玩家数据
     * @returns {Object}
     */
    getPlayerData() {
        return this.playerData;
    }

    /**
     * 检查序章是否完成
     * @returns {boolean}
     */
    isComplete() {
        return this.isCompleted;
    }

    /**
     * 检查序章是否活动
     * @returns {boolean}
     */
    isActivePrologue() {
        return this.isActive;
    }

    /**
     * 设置完成回调
     * @param {Function} callback - 完成时调用的回调函数
     */
    setOnComplete(callback) {
        this.onComplete = callback;
    }

    /**
     * 记录玩家选择
     * @param {string} choiceId - 选择ID
     * @param {string} choice - 选择内容
     */
    recordPlayerChoice(choiceId, choice) {
        this.playerData.prologueData.playerChoices.set(choiceId, choice);
        Logger.log(`PrologueManager: Recorded choice "${choiceId}": ${choice}`);
    }

    /**
     * 招募NPC
     * @param {string} npcId - NPC ID
     */
    recruitNPC(npcId) {
        if (!this.playerData.prologueData.recruitedNPCs.includes(npcId)) {
            this.playerData.prologueData.recruitedNPCs.push(npcId);
            Logger.log(`PrologueManager: Recruited NPC "${npcId}"`);
        }
    }

    /**
     * 记录战斗胜利
     */
    recordBattleWon() {
        this.playerData.prologueData.battlesWon++;
    }

    /**
     * 记录击败敌人
     * @param {number} count - 击败数量
     */
    recordEnemiesDefeated(count = 1) {
        this.playerData.prologueData.enemiesDefeated += count;
    }

    /**
     * 记录救援盟友
     * @param {string} allyId - 盟友ID
     */
    recordAllyRescued(allyId) {
        if (!this.playerData.prologueData.rescuedAllies.includes(allyId)) {
            this.playerData.prologueData.rescuedAllies.push(allyId);
            Logger.log(`PrologueManager: Rescued ally "${allyId}"`);
        }
    }

    /**
     * 销毁序章管理器
     * 清理资源和状态
     */
    destroy() {
        Logger.log('PrologueManager: Destroying...');
        
        // 停止音乐
        if (this.audioManager) {
            this.audioManager.stopMusic();
        }
        
        // 清理状态
        this.isActive = false;
        this.isInitialized = false;
        
        Logger.log('PrologueManager: Destroyed');
    }

    // ==================== 音效辅助方法 ====================

    /**
     * 播放音效
     * @param {string} soundKey - 音效键名
     * @param {Object} options - 播放选项
     */
    playSound(soundKey, options = {}) {
        if (this.audioManager && this.audioManager.hasSound(soundKey)) {
            this.audioManager.playSound(soundKey, options);
        }
    }

    /**
     * 播放音乐
     * @param {string} musicKey - 音乐键名
     * @param {boolean} fadeIn - 是否淡入
     */
    playMusic(musicKey, fadeIn = true) {
        if (this.audioManager && this.audioManager.hasMusic(musicKey)) {
            this.audioManager.playMusic(musicKey, fadeIn);
        }
    }

    /**
     * 停止音乐
     * @param {boolean} fadeOut - 是否淡出
     */
    stopMusic(fadeOut = true) {
        if (this.audioManager) {
            this.audioManager.stopMusic(fadeOut);
        }
    }

    /**
     * 播放战斗音乐
     */
    playBattleMusic() {
        this.playMusic('battle_theme', true);
    }

    /**
     * 播放史诗战斗音乐
     */
    playEpicBattleMusic() {
        this.playMusic('epic_battle_theme', true);
    }

    /**
     * 恢复场景音乐
     */
    resumeSceneMusic() {
        if (this.currentAct > 0) {
            this.switchSceneMusic(this.currentAct);
        }
    }

    /**
     * 设置音量
     * @param {string} type - 音量类型 ('master', 'sound', 'music')
     * @param {number} volume - 音量值 (0-1)
     */
    setVolume(type, volume) {
        if (!this.audioManager) return;
        
        switch (type) {
            case 'master':
                this.audioManager.setMasterVolume(volume);
                break;
            case 'sound':
                this.audioManager.setSoundVolume(volume);
                break;
            case 'music':
                this.audioManager.setMusicVolume(volume);
                break;
            default:
                console.warn(`PrologueManager: Unknown volume type '${type}'`);
        }
    }

    /**
     * 获取音量
     * @param {string} type - 音量类型 ('master', 'sound', 'music')
     * @returns {number} 音量值
     */
    getVolume(type) {
        if (!this.audioManager) return 0;
        
        switch (type) {
            case 'master':
                return this.audioManager.masterVolume;
            case 'sound':
                return this.audioManager.soundVolume;
            case 'music':
                return this.audioManager.musicVolume;
            default:
                return 0;
        }
    }

    /**
     * 切换静音状态
     */
    toggleMute() {
        if (this.audioManager) {
            this.audioManager.toggleMute();
        }
    }

    /**
     * 获取静音状态
     * @returns {boolean}
     */
    isMuted() {
        return this.audioManager ? this.audioManager.muted : false;
    }
}

import { Logger } from '../../../src/core/Logger.js';
import { Scene } from '../../../src/core/Scene.js';

/**
 * 序章场景基类
 * 所有序章场景都应继承此类
 * 提供序章特定的功能和生命周期管理
 */
export class PrologueScene extends Scene {
    /**
     * 构造函数
     * @param {number} actNumber - 幕数 (1-6)
     * @param {Object} sceneData - 场景数据配置
     */
    constructor(actNumber, sceneData = {}) {
        super(`Act${actNumber}Scene`);
        
        this.actNumber = actNumber;
        this.sceneData = sceneData;
        
        // 序章特定系统
        this.tutorialSystem = null;
        this.dialogueSystem = null;
        this.questSystem = null;
        
        // 场景状态
        this.isLoaded = false;
        this.isPaused = false;
        
        // 玩家引用
        this.player = null;
        
        // 场景实体
        this.entities = new Map();
        this.npcs = new Map();
        
        Logger.log(`PrologueScene: Created ${this.name} (Act ${actNumber})`);
    }

    /**
     * 场景进入时调用
     * @param {Object} data - 从上一个场景传递的数据
     */
    enter(data = null) {
        super.enter(data);
        
        // 保存玩家引用
        if (data && data.player) {
            this.player = data.player;
        }
        
        // 加载场景数据
        this.loadSceneData();
        
        // 初始化教程
        this.initializeTutorials();
        
        // 启动任务
        this.startQuests();
        
        Logger.log(`PrologueScene: Entered ${this.name}`);
    }

    /**
     * 更新场景逻辑
     * @param {number} deltaTime - 时间增量（秒）
     */
    update(deltaTime) {
        if (!this.isActive || this.isPaused) {
            return;
        }
        
        // 更新教程系统
        if (this.tutorialSystem) {
            this.tutorialSystem.update(deltaTime, {});
        }
        
        // 更新对话系统
        if (this.dialogueSystem) {
            this.dialogueSystem.update(deltaTime);
        }
        
        // 更新任务系统
        if (this.questSystem) {
            this.questSystem.update(deltaTime);
        }
        
        // 更新场景实体
        for (const [id, entity] of this.entities) {
            if (entity.update) {
                entity.update(deltaTime);
            }
        }
        
        // 检查场景完成条件
        this.checkCompletion();
    }

    /**
     * 渲染场景
     * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
     */
    render(ctx) {
        if (!this.isActive) {
            return;
        }
        
        // 渲染场景背景
        this.renderBackground(ctx);
        
        // 渲染场景实体
        for (const [id, entity] of this.entities) {
            if (entity.render) {
                entity.render(ctx);
            }
        }
        
        // 渲染NPC
        for (const [id, npc] of this.npcs) {
            if (npc.render) {
                npc.render(ctx);
            }
        }
        
        // 渲染教程系统
        if (this.tutorialSystem) {
            this.tutorialSystem.render(ctx);
        }
        
        // 渲染对话系统
        if (this.dialogueSystem) {
            this.dialogueSystem.render(ctx);
        }
        
        // 渲染任务系统
        if (this.questSystem) {
            this.questSystem.render(ctx);
        }
    }

    /**
     * 场景退出时调用
     */
    exit() {
        Logger.log(`PrologueScene: Exiting ${this.name}`);
        
        // 清理教程系统
        if (this.tutorialSystem && typeof this.tutorialSystem.cleanup === 'function') {
            this.tutorialSystem.cleanup();
        }
        
        // 清理对话系统
        if (this.dialogueSystem) {
            // DialogueSystem 使用 reset() 而不是 cleanup()
            if (typeof this.dialogueSystem.reset === 'function') {
                this.dialogueSystem.reset();
            }
        }
        
        // 清理任务系统
        if (this.questSystem) {
            // QuestSystem 可能没有 cleanup 方法，安全检查
            if (typeof this.questSystem.cleanup === 'function') {
                this.questSystem.cleanup();
            }
        }
        
        // 清理场景实体
        // 兼容 Map 和 Array 两种类型
        if (this.entities) {
            if (typeof this.entities.clear === 'function') {
                // Map 类型
                this.entities.clear();
            } else if (Array.isArray(this.entities)) {
                // Array 类型
                this.entities.length = 0;
            }
        }
        
        // 清理 NPC
        if (this.npcs) {
            if (typeof this.npcs.clear === 'function') {
                // Map 类型
                this.npcs.clear();
            } else if (Array.isArray(this.npcs)) {
                // Array 类型
                this.npcs.length = 0;
            }
        }
        
        super.exit();
    }

    /**
     * 加载场景数据
     * 子类应重写此方法以加载特定场景数据
     */
    loadSceneData() {
        Logger.log(`PrologueScene: Loading scene data for ${this.name}`);
        
        // 从sceneData加载配置
        if (this.sceneData) {
            // 加载教程数据
            if (this.sceneData.tutorials) {
                this.loadTutorials(this.sceneData.tutorials);
            }
            
            // 加载对话数据
            if (this.sceneData.dialogues) {
                this.loadDialogues(this.sceneData.dialogues);
            }
            
            // 加载任务数据
            if (this.sceneData.quests) {
                this.loadQuests(this.sceneData.quests);
            }
            
            // 加载NPC数据
            if (this.sceneData.npcs) {
                this.loadNPCs(this.sceneData.npcs);
            }
        }
        
        this.isLoaded = true;
    }

    /**
     * 初始化教程系统
     * 子类可重写此方法以自定义教程初始化
     */
    initializeTutorials() {
        Logger.log(`PrologueScene: Initializing tutorials for ${this.name}`);
        // 子类实现
    }

    /**
     * 启动任务
     * 子类可重写此方法以自定义任务启动
     */
    startQuests() {
        Logger.log(`PrologueScene: Starting quests for ${this.name}`);
        // 子类实现
    }

    /**
     * 检查场景完成条件
     * 子类应重写此方法以实现特定的完成逻辑
     */
    checkCompletion() {
        // 子类实现
    }

    /**
     * 前往下一个场景
     * @param {Object} data - 传递给下一个场景的数据
     */
    goToNextScene(data = {}) {
        Logger.log(`PrologueScene: Going to next scene from ${this.name}`);
        
        // 准备传递的数据
        const sceneData = {
            player: this.player,
            previousAct: this.actNumber,
            ...data
        };
        
        // 通知场景管理器切换场景
        if (this.sceneManager) {
            const nextActNumber = this.actNumber + 1;
            if (nextActNumber <= 6) {
                this.sceneManager.switchTo(`Act${nextActNumber}Scene`, sceneData);
            } else {
                // 序章完成
                Logger.log('PrologueScene: Prologue completed!');
                this.onPrologueComplete();
            }
        }
    }

    /**
     * 序章完成回调
     * 子类可重写此方法以处理序章完成逻辑
     */
    onPrologueComplete() {
        Logger.log('PrologueScene: Prologue complete callback');
        // 子类实现
    }

    /**
     * 渲染场景背景
     * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
     */
    renderBackground(ctx) {
        // 默认渲染简单背景
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    /**
     * 加载教程数据
     * @param {Array} tutorials - 教程数据数组
     */
    loadTutorials(tutorials) {
        Logger.log(`PrologueScene: Loading ${tutorials.length} tutorials`);
        // 子类可以重写以实现具体加载逻辑
    }

    /**
     * 加载对话数据
     * @param {Object} dialogues - 对话数据对象
     */
    loadDialogues(dialogues) {
        Logger.log(`PrologueScene: Loading dialogues`);
        // 子类可以重写以实现具体加载逻辑
    }

    /**
     * 加载任务数据
     * @param {Array} quests - 任务数据数组
     */
    loadQuests(quests) {
        Logger.log(`PrologueScene: Loading ${quests.length} quests`);
        // 子类可以重写以实现具体加载逻辑
    }

    /**
     * 加载NPC数据
     * @param {Array} npcs - NPC数据数组
     */
    loadNPCs(npcs) {
        Logger.log(`PrologueScene: Loading ${npcs.length} NPCs`);
        // 子类可以重写以实现具体加载逻辑
    }

    /**
     * 暂停场景
     */
    pause() {
        this.isPaused = true;
        Logger.log(`PrologueScene: Paused ${this.name}`);
    }

    /**
     * 恢复场景
     */
    resume() {
        this.isPaused = false;
        Logger.log(`PrologueScene: Resumed ${this.name}`);
    }

    /**
     * 添加实体到场景
     * @param {string} id - 实体ID
     * @param {Object} entity - 实体对象
     */
    addEntity(id, entity) {
        this.entities.set(id, entity);
        Logger.log(`PrologueScene: Added entity ${id}`);
    }

    /**
     * 从场景移除实体
     * @param {string} id - 实体ID
     */
    removeEntity(id) {
        if (this.entities.has(id)) {
            this.entities.delete(id);
            Logger.log(`PrologueScene: Removed entity ${id}`);
        }
    }

    /**
     * 获取实体
     * @param {string} id - 实体ID
     * @returns {Object|null} 实体对象或null
     */
    getEntity(id) {
        return this.entities.get(id) || null;
    }

    /**
     * 添加NPC到场景
     * @param {string} id - NPC ID
     * @param {Object} npc - NPC对象
     */
    addNPC(id, npc) {
        this.npcs.set(id, npc);
        Logger.log(`PrologueScene: Added NPC ${id}`);
    }

    /**
     * 从场景移除NPC
     * @param {string} id - NPC ID
     */
    removeNPC(id) {
        if (this.npcs.has(id)) {
            this.npcs.delete(id);
            Logger.log(`PrologueScene: Removed NPC ${id}`);
        }
    }

    /**
     * 获取NPC
     * @param {string} id - NPC ID
     * @returns {Object|null} NPC对象或null
     */
    getNPC(id) {
        return this.npcs.get(id) || null;
    }

    /**
     * 设置场景管理器引用
     * @param {SceneManager} sceneManager - 场景管理器
     */
    setSceneManager(sceneManager) {
        this.sceneManager = sceneManager;
    }
}

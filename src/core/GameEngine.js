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

import { AssetManager } from './AssetManager.js';
import { InputManager } from './InputManager.js';
import { SceneManager } from './SceneManager.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { ErrorHandler } from './ErrorHandler.js';
import { logger, LogLevel } from './Logger.js';
import { DebugTools } from './DebugTools.js';
import { LoginScene } from '../scenes/LoginScene.js';
import { CharacterScene } from '../scenes/CharacterScene.js';
import { GameScene } from '../scenes/GameScene.js';
import { parseBackendConfig } from '../rendering/backends/BackendConfig.js';
import { pickBackend } from '../rendering/backends/pickBackend.js';

/**
 * 游戏引擎核心类
 * 负责初始化、游戏循环和模块协调
 */
export class GameEngine {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.canvasContext = canvas?.getContext?.('2d') || null;
        this.options = options;
        this.ctx = null;
        this.backend = null;
        this.backendConfig = parseBackendConfig(options.backendConfig);
        Object.defineProperty(this, 'requestedBackendMode', {
            value: this.backendConfig.mode,
            enumerable: true,
            writable: false,
            configurable: false
        });
        this.isRunning = false;
        this.lastFrameTime = 0;
        this.targetFPS = 60;
        this.frameInterval = 1000 / this.targetFPS;
        
        // 游戏尺寸
        this.gameWidth = 1280;
        this.gameHeight = 720;
        
        // 子系统（将在后续任务中实现）
        this.sceneManager = null;
        this.assetManager = null;
        this.inputManager = null;
        this.networkManager = null;
        this.errorHandler = null;
        this.debugTools = null;
        this.logger = logger.createChild('GameEngine');
    }

    /** 实际已初始化的渲染后端；auto/3d 降级后以此为准。 */
    get actualBackendMode() {
        return this.backend?.mode || null;
    }

    /**
     * 初始化游戏引擎
     */
    async init() {
        try {
            this.logger.info('Initializing...');
            
            // 初始化错误处理器
            this.errorHandler = new ErrorHandler();
            this.errorHandler.setErrorCallback((error) => {
                this.logger.error('Game Error:', error);
            });
            
            // 初始化Canvas 与 后端
            await this.initBackend();
            
            // 设置窗口大小调整监听
            window.addEventListener('resize', () => this.handleResize());
            
            // 初始化子系统（占位符，将在后续任务中实现）
            await this.initSystems();
            
            // 初始化调试工具
            this.debugTools = new DebugTools(this);
            window.debugTools = this.debugTools;
            
            this.logger.info('Initialization complete');
        } catch (error) {
            this.logger.error('Initialization failed', error);
            if (this.errorHandler) {
                this.errorHandler.handleError({
                    type: 'initialization',
                    message: `游戏初始化失败: ${error.message}`,
                    error,
                    timestamp: Date.now()
                });
            }
            throw error;
        }
    }

    /**
     * 初始化 Canvas 与渲染后端
     */
    async initBackend() {
        if (!this.canvas) throw new Error('GameEngine: canvas missing');
        this.backend = await pickBackend(this.backendConfig);
        await this.backend.init(this.canvas, {
            ...this.backendConfig,
            gameWidth: this.gameWidth,
            gameHeight: this.gameHeight
        });
        // 过渡期：保留 this.ctx 供旧代码使用
        this.ctx = this.backend.getHUDContext?.() ?? null;
        // 适应初始窗口尺寸
        this.handleResize();
        this.logger.info(
            `Backend: ${this.actualBackendMode === '3d' ? 'Three' : 'Canvas2D'} initialized `
            + `(requested=${this.requestedBackendMode}, host=${this.backendConfig.host})`
        );
    }

    /**
     * 初始化Canvas和渲染上下文（已被 initBackend 取代；保留以防旧引用）
     * @deprecated
     */
    initCanvas() {
        // no-op; 由 initBackend 完成
        this.logger.warn('GameEngine.initCanvas is deprecated, use initBackend');
    }

    /**
     * 处理窗口大小变化
     */
    handleResize() {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        if (this.backend && typeof this.backend.resize === 'function') {
            this.backend.resize(windowWidth, windowHeight);
            // 过渡期同步 this.ctx 引用
            this.ctx = this.backend.getHUDContext?.() ?? this.ctx;
            return;
        }
        console.warn('GameEngine.handleResize: backend not ready');
    }

    /**
     * 初始化子系统
     */
    async initSystems() {
        // 初始化资源管理器
        this.assetManager = new AssetManager({
            assetBasePath: this.options?.assetBasePath || ''
        });
        console.log('GameEngine: AssetManager initialized');
        
        // 初始化输入管理器
        this.inputManager = new InputManager(this.canvas);
        if (this.backend && typeof this.inputManager.setBackend === 'function') {
            this.inputManager.setBackend(this.backend);
        }
        console.log('GameEngine: InputManager initialized');
        
        // 初始化场景管理器
        this.sceneManager = new SceneManager();
        console.log('GameEngine: SceneManager initialized');
        
        // 注册场景
        this.sceneManager.registerScene('Login', new LoginScene(this));
        this.sceneManager.registerScene('Character', new CharacterScene(this));
        this.sceneManager.registerScene('Game', new GameScene(this));
        
        // 初始化网络管理器（暂时跳过，因为需要真实服务器或完整的 Mock 实现）
        // this.networkManager = new NetworkManager({
        //     useMockData: true,
        //     mockDelay: 100,
        //     debugMode: true
        // });
        // await this.networkManager.connect();
        console.log('GameEngine: NetworkManager skipped (no server available)');
        
        // 加载初始资源（如果有）
        // 当前没有资源需要加载，后续任务会添加
        if (this.assetManager.loadQueue.length > 0) {
            await this.assetManager.loadAll();
        }
        
        // 切换到初始场景（登录场景）
        this.sceneManager.switchTo('Login');
        console.log('GameEngine: Switched to initial scene (Login)');
        
        console.log('GameEngine: Systems initialized');
    }

    /**
     * 启动游戏循环
     */
    start() {
        if (this.isRunning) {
            console.warn('GameEngine: Already running');
            return;
        }

        this.isRunning = true;
        this.lastFrameTime = performance.now();
        console.log('GameEngine: Starting game loop');
        
        // 启动游戏循环
        this.gameLoop(this.lastFrameTime);
    }

    /**
     * 停止游戏循环
     */
    stop() {
        this.isRunning = false;
        console.log('GameEngine: Game loop stopped');
    }

    /**
     * 游戏循环
     */
    gameLoop(currentTime) {
        if (!this.isRunning) {
            return;
        }

        // 计算时间差（先计算，再决定是否调度）
        const deltaTime = currentTime - this.lastFrameTime;

        // 限制帧率到60 FPS：未到帧间隔时只调度下一帧，不执行逻辑
        if (deltaTime < this.frameInterval) {
            requestAnimationFrame((time) => this.gameLoop(time));
            return;
        }

        // 更新最后帧时间
        this.lastFrameTime = currentTime - (deltaTime % this.frameInterval);

        // 保护性 deltaTime 上限：页面切换后台、长任务或性能问题时
        // 单帧最大允许 100ms（正常 16.67ms 的 6 倍），超出部分分摊到后续帧
        const maxDeltaMs = 100;
        const clampedDeltaMs = Math.min(deltaTime, maxDeltaMs);

        // 转换为秒
        const dt = clampedDeltaMs / 1000;

        // 更新游戏状态
        this.update(dt);

        // 渲染游戏画面
        this.render();

        // 帧结束后调度下一帧，确保本帧逻辑完整执行
        requestAnimationFrame((time) => this.gameLoop(time));
    }

    /**
     * 更新游戏状态
     */
    update(deltaTime) {
        try {
            // 手柄轮询必须在帧首：Gamepad API 是轮询式的，
            // 若放到帧末（inputManager.update 处）本帧读到的会是上一帧状态
            if (this.inputManager && this.inputManager.pollGamepads) {
                this.inputManager.pollGamepads();
            }

            // 处理场景输入
            if (this.sceneManager && this.inputManager) {
                this.sceneManager.handleInput(this.inputManager);
            }
            
            // 更新场景管理器
            if (this.sceneManager) {
                this.sceneManager.update(deltaTime);
            }
            
            // 更新调试工具
            if (this.debugTools) {
                this.debugTools.update(deltaTime);
            }
            
            // 更新输入管理器（清除本帧状态）
            if (this.inputManager) {
                this.inputManager.update();
            }
        } catch (error) {
            this.logger.error('Update error', error);
            if (this.errorHandler) {
                this.errorHandler.handleError({
                    type: 'update',
                    message: `游戏更新错误: ${error.message}`,
                    context: 'game loop update',
                    error,
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     * 渲染游戏画面
     */
    render() {
        try {
            if (!this.backend) return;
            this.backend.beginFrame();

            // 渲染场景
            if (this.sceneManager) {
                // 首选新签名 render(backend)；老场景仍接收 ctx 的，Scene 基类会处理
                this.sceneManager.render(this.backend);
            }
            
            // 渲染调试信息（在最上层）
            if (this.debugTools && this.debugTools.isEnabled()) {
                const hudCtx = this.backend.getHUDContext?.() ?? this.ctx;
                const currentScene = this.sceneManager?.currentScene;
                if (currentScene && currentScene.camera && currentScene.entities && hudCtx) {
                    this.debugTools.render(hudCtx, currentScene.camera, currentScene.entities);
                }
            }

            this.backend.endFrame();
        } catch (error) {
            this.logger.error('Render error', error);
            if (this.errorHandler) {
                this.errorHandler.handleError({
                    type: 'render',
                    message: `游戏渲染错误: ${error.message}`,
                    context: 'game loop render',
                    error,
                    timestamp: Date.now()
                });
            }
        }
    }
}

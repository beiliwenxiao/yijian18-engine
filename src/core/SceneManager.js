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

import { Logger } from './Logger.js';

/**
 * 场景管理器
 * 负责场景注册、切换和生命周期管理
 */
export class SceneManager {
    constructor() {
        this.scenes = new Map();
        this.currentScene = null;
        this.nextScene = null;
        this.transitionData = null;
        
        // 转场效果配置
        this.isTransitioning = false;
        this.transitionDuration = 0.5; // 秒
        this.transitionProgress = 0;
        this.transitionPhase = 'fadeOut'; // 'fadeOut', 'showText', 'fadeIn'
        
        // 文字过渡配置
        this.transitionText = { main: '', sub: '' };
        this.textDisplayDuration = 3.0; // 文字显示时长（秒）
        this.transitionTimer = 0;
        this.transitionAlpha = 0;
        this.transitionCallback = null; // 过渡完成后的回调
        
        // 渲染尺寸（需要外部设置）
        this.renderWidth = 800;
        this.renderHeight = 600;
    }

    /**
     * 注册场景
     * @param {string} name - 场景名称
     * @param {Scene} scene - 场景实例
     */
    registerScene(name, scene) {
        if (this.scenes.has(name)) {
            console.warn(`SceneManager: Scene "${name}" already registered`);
            return;
        }
        
        this.scenes.set(name, scene);
        Logger.log(`SceneManager: Registered scene "${name}"`);
    }

    /**
     * 切换到指定场景
     * @param {string} name - 场景名称
     * @param {Object} data - 传递给新场景的数据
     */
    switchTo(name, data = null) {
        if (!this.scenes.has(name)) {
            console.error(`SceneManager: Scene "${name}" not found`);
            return;
        }

        if (this.isTransitioning) {
            console.warn('SceneManager: Already transitioning');
            return;
        }

        const nextScene = this.scenes.get(name);
        
        // 如果没有当前场景，直接进入新场景
        if (!this.currentScene) {
            this.currentScene = nextScene;
            this.currentScene.enter(data);
            Logger.log(`SceneManager: Entered scene "${name}"`);
            return;
        }

        // 如果切换到相同场景，重新进入（允许传递新数据）
        if (this.currentScene === nextScene) {
            Logger.log(`SceneManager: Re-entering scene "${name}" with new data`);
            this.currentScene.exit();
            this.currentScene.enter(data);
            return;
        }

        // 开始转场
        this.nextScene = nextScene;
        this.transitionData = data;
        this.isTransitioning = true;
        this.transitionProgress = 0;
        this.transitionPhase = 'fadeOut';
        
        Logger.log(`SceneManager: Transitioning from "${this.currentScene.name}" to "${name}"`);
        Logger.log(`SceneManager: Transition data stored:`, this.transitionData);
    }

    /**
     * 开始带文字的场景过渡（淡出 → 显示文字 → 切换场景）
     * @param {Object} options - 过渡选项
     * @param {string} [options.mainText='场景切换中...'] - 主文字
     * @param {string} [options.subText=''] - 副文字
     * @param {number} [options.fadeDuration=2.0] - 淡出时长（秒）
     * @param {number} [options.textDuration=3.0] - 文字显示时长（秒）
     * @param {Function} [options.onComplete] - 过渡完成回调
     */
    startTextTransition(options = {}) {
        this.isTransitioning = true;
        this.transitionPhase = 'fadeOut';
        this.transitionTimer = 0;
        this.transitionAlpha = 0;
        this.transitionDuration = options.fadeDuration ?? 2.0;
        this.textDisplayDuration = options.textDuration ?? 3.0;
        this.transitionText = {
            main: options.mainText ?? '场景切换中...',
            sub: options.subText ?? ''
        };
        this.transitionCallback = options.onComplete || null;
    }

    /**
     * 设置渲染尺寸（用于文字居中）
     * @param {number} width
     * @param {number} height
     */
    setRenderSize(width, height) {
        this.renderWidth = width;
        this.renderHeight = height;
    }

    /**
     * 更新场景管理器
     * @param {number} deltaTime - 时间增量（秒）
     */
    update(deltaTime) {
        // 处理转场效果
        if (this.isTransitioning) {
            this.updateTransition(deltaTime);
            return;
        }

        // 更新当前场景
        if (this.currentScene && this.currentScene.isActive) {
            this.currentScene.update(deltaTime);
        } else if (this.currentScene && !this.currentScene.isActive) {
            console.warn('SceneManager: 场景存在但未激活！', this.currentScene.name);
        }
    }

    /**
     * 更新转场效果
     * @param {number} deltaTime - 时间增量（秒）
     */
    updateTransition(deltaTime) {
        this.transitionTimer += deltaTime;
        this.transitionProgress += deltaTime / this.transitionDuration;

        if (this.transitionPhase === 'fadeOut') {
            this.transitionAlpha = Math.min(1, this.transitionProgress);
            
            if (this.transitionProgress >= 1) {
                this.transitionProgress = 1;
                
                // 如果有文字要显示，进入文字阶段
                if (this.transitionText.main) {
                    this.transitionPhase = 'showText';
                    this.transitionTimer = 0;
                    this.transitionProgress = 0;
                } else {
                    // 没有文字，直接切换场景
                    this._performSceneSwitch();
                    this.transitionPhase = 'fadeIn';
                    this.transitionProgress = 0;
                }
            }
        } else if (this.transitionPhase === 'showText') {
            if (this.transitionTimer >= this.textDisplayDuration) {
                // 文字显示完毕，执行回调或切换场景
                if (this.transitionCallback) {
                    this.transitionCallback();
                    this.isTransitioning = false;
                    this.transitionCallback = null;
                    this.transitionText = { main: '', sub: '' };
                } else {
                    this._performSceneSwitch();
                    this.transitionPhase = 'fadeIn';
                    this.transitionProgress = 0;
                }
            }
        } else if (this.transitionPhase === 'fadeIn') {
            this.transitionAlpha = Math.max(0, 1 - this.transitionProgress);
            
            if (this.transitionProgress >= 1) {
                // 淡入完成，结束转场
                this.isTransitioning = false;
                this.nextScene = null;
                this.transitionData = null;
                this.transitionProgress = 0;
                this.transitionAlpha = 0;
                this.transitionText = { main: '', sub: '' };
            }
        }
    }

    /**
     * 执行场景切换（内部方法）
     * @private
     */
    _performSceneSwitch() {
        if (this.nextScene) {
            if (this.currentScene) {
                this.currentScene.exit();
            }
            this.currentScene = this.nextScene;
            this.currentScene.enter(this.transitionData);
        }
    }

    /**
     * 渲染场景
     * 兼容两种入参：IRenderBackend（新）或 CanvasRenderingContext2D（旧）
     */
    render(ctxOrBackend) {
        // 渲染当前场景（兼容分派）
        if (this.currentScene) {
            this._dispatchSceneRender(this.currentScene, ctxOrBackend);
        }

        // 渲染转场效果（只在 HUD 2D 上叠加即可）
        if (this.isTransitioning) {
            const ctx = this._resolveCtx(ctxOrBackend);
            if (ctx) this.renderTransition(ctx);
        }
    }

    /**
     * 兼容分派：
     *   - 入参是 Backend：若场景重写了 renderCommon，调之；否则取 HUD ctx 走老 render(ctx)
     *   - 入参是 ctx：直接调 render(ctx)
     * @private
     */
    _dispatchSceneRender(scene, ctxOrBackend) {
        if (this._isBackend(ctxOrBackend)) {
            const backend = ctxOrBackend;
            // 约定：若场景实现了 renderCommon（区别于 Scene 基类默认）即走双后端路径
            const hasCommon =
                typeof scene.renderCommon === 'function' &&
                scene.__dualBackendAware === true;
            if (hasCommon) {
                scene.renderCommon(backend);
                return;
            }
            // 老场景：传 HUD 2D ctx，保持现有行为
            const ctx = backend.getHUDContext?.();
            if (ctx && typeof scene.render === 'function') {
                scene.render(ctx);
            }
        } else {
            // 老路径：直接 ctx
            if (typeof scene.render === 'function') {
                scene.render(ctxOrBackend);
            }
        }
    }

    _isBackend(x) {
        return !!x && typeof x === 'object' &&
               typeof x.mode === 'string' &&
               typeof x.getHUDContext === 'function';
    }

    _resolveCtx(ctxOrBackend) {
        if (!ctxOrBackend) return null;
        if (typeof ctxOrBackend.getHUDContext === 'function') {
            return ctxOrBackend.getHUDContext();
        }
        return ctxOrBackend;
    }

    /**
     * 渲染转场效果（淡入淡出 + 文字）
     * @param {CanvasRenderingContext2D} ctx - Canvas渲染上下文
     */
    renderTransition(ctx) {
        ctx.save();
        
        ctx.fillStyle = `rgba(0, 0, 0, ${this.transitionAlpha})`;
        ctx.fillRect(0, 0, this.renderWidth, this.renderHeight);
        
        // 文字阶段渲染
        if (this.transitionPhase === 'showText' && this.transitionText.main) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(this.transitionText.main, this.renderWidth / 2, this.renderHeight / 2 - 30);
            
            if (this.transitionText.sub) {
                ctx.font = '24px Arial';
                ctx.fillText(this.transitionText.sub, this.renderWidth / 2, this.renderHeight / 2 + 30);
            }
        }
        
        ctx.restore();
    }

    /**
     * 处理输入
     * @param {InputManager} inputManager - 输入管理器
     */
    handleInput(inputManager) {
        // 转场期间不处理输入
        if (this.isTransitioning) {
            return;
        }

        // 传递输入到当前场景
        if (this.currentScene && this.currentScene.isActive) {
            this.currentScene.handleInput(inputManager);
        }
    }

    /**
     * 获取当前场景
     * @returns {Scene|null}
     */
    getCurrentScene() {
        return this.currentScene;
    }

    /**
     * 检查是否正在转场
     * @returns {boolean}
     */
    isInTransition() {
        return this.isTransitioning;
    }
}

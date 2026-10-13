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
 * 场景基类
 * 所有游戏场景都应继承此类
 *
 * 渲染接口兼容双模式：
 *   - 新：render(backend)  — 由 GameEngine 注入 IRenderBackend
 *   - 旧：render(ctx)      — 直接传 CanvasRenderingContext2D
 * Scene.render 会根据入参自动识别，并调用 render2D(ctx) / renderCommon(backend)。
 */
export class Scene {
    constructor(name) {
        this.name = name;
        this.isActive = false;
    }

    /**
     * 场景进入时调用
     * @param {Object} data - 从上一个场景传递的数据
     */
    enter(data = null) {
        this.isActive = true;
        Logger.log(`Scene: Entering ${this.name}`);
    }

    /**
     * 更新场景逻辑
     * @param {number} deltaTime - 时间增量（秒）
     */
    update(deltaTime) {
        // 子类实现
    }

    /**
     * 渲染场景（兼容入口）
     * 子类可选择：
     *   - 重载 render(ctxOrBackend) 自己处理
     *   - 重载 render2D(ctx) 只关心 2D 绘制
     *   - 重载 renderCommon(backend) 使用双后端抽象
     * @param {CanvasRenderingContext2D|import('../rendering/backends/IRenderBackend.js').IRenderBackend} ctxOrBackend
     */
    render(ctxOrBackend) {
        if (!ctxOrBackend) return;
        if (this._isBackend(ctxOrBackend)) {
            this._renderWithBackend(ctxOrBackend);
        } else {
            // 旧签名：直接是 CanvasRenderingContext2D
            this.render2D(ctxOrBackend);
        }
    }

    /**
     * 判断对象是否是 Backend 而非 2D context
     * 启发式：具有 mode 字段且 mode 为 '2d' 或 '3d'
     */
    _isBackend(obj) {
        return !!obj && typeof obj === 'object' && typeof obj.mode === 'string' &&
               typeof obj.getHUDContext === 'function';
    }

    /**
     * Backend 分派
     * @param {import('../rendering/backends/IRenderBackend.js').IRenderBackend} backend
     */
    _renderWithBackend(backend) {
        // 子类若重载了 renderCommon，优先走通用入口
        if (this.renderCommon !== Scene.prototype.renderCommon) {
            this.renderCommon(backend);
            return;
        }
        // 否则按 mode 分发
        if (backend.mode === '3d') {
            this.render3D(backend);
        } else {
            const ctx = backend.getHUDContext?.();
            if (ctx) this.render2D(ctx);
        }
    }

    /**
     * 2D 渲染入口（子类重载）
     * @param {CanvasRenderingContext2D} ctx
     */
    render2D(ctx) {
        // 子类实现
    }

    /**
     * 3D 渲染入口（子类重载）
     * @param {import('../rendering/backends/IRenderBackend.js').IRenderBackend} backend
     */
    render3D(backend) {
        // 子类实现；未实现时兜底用 HUD 2D 绘制
        const ctx = backend.getHUDContext?.();
        if (ctx) this.render2D(ctx);
    }

    /**
     * 通用渲染入口（双后端共用；子类重载）
     * @param {import('../rendering/backends/IRenderBackend.js').IRenderBackend} backend
     */
    renderCommon(backend) {
        // 子类实现；默认回退到 2D/3D 分发
        if (backend.mode === '3d') {
            this.render3D(backend);
        } else {
            const ctx = backend.getHUDContext?.();
            if (ctx) this.render2D(ctx);
        }
    }

    /**
     * 场景退出时调用
     */
    exit() {
        this.isActive = false;
        Logger.log(`Scene: Exiting ${this.name}`);
    }

    /**
     * 处理输入事件
     * @param {InputManager} inputManager - 输入管理器
     */
    handleInput(inputManager) {
        // 子类可选实现
    }
}

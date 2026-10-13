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
 * 错误处理器
 * 负责捕获、记录和显示游戏中的错误
 */
export class ErrorHandler {
    constructor() {
        // 错误队列
        this.errors = [];
        this.maxErrors = 50;
        
        // 错误回调
        this.onError = null;
        
        // 错误UI元素
        this.errorOverlay = null;
        this.errorContainer = null;
        
        // 是否显示错误UI
        this.showErrorUI = true;
        
        // 初始化全局错误处理
        this.initGlobalHandlers();
    }

    /**
     * 初始化全局错误处理器
     */
    initGlobalHandlers() {
        // 捕获未处理的错误
        window.addEventListener('error', (event) => {
            this.handleError({
                type: 'runtime',
                message: event.message,
                source: event.filename,
                line: event.lineno,
                column: event.colno,
                error: event.error,
                timestamp: Date.now()
            });
        });

        // 捕获未处理的Promise拒绝
        window.addEventListener('unhandledrejection', (event) => {
            this.handleError({
                type: 'promise',
                message: event.reason?.message || String(event.reason),
                error: event.reason,
                timestamp: Date.now()
            });
        });

        Logger.log('ErrorHandler: Global error handlers initialized');
    }

    /**
     * 处理错误
     * @param {object} errorInfo - 错误信息
     */
    handleError(errorInfo) {
        // 添加到错误队列
        this.errors.push(errorInfo);
        
        // 限制队列大小
        if (this.errors.length > this.maxErrors) {
            this.errors.shift();
        }

        // 记录到控制台
        console.error('ErrorHandler: Error occurred', errorInfo);

        // 调用错误回调
        if (this.onError) {
            try {
                this.onError(errorInfo);
            } catch (e) {
                console.error('ErrorHandler: Error in error callback', e);
            }
        }

        // 显示错误UI
        if (this.showErrorUI) {
            this.showError(errorInfo);
        }
    }

    /**
     * 包装函数以捕获错误
     * @param {Function} fn - 要包装的函数
     * @param {string} context - 上下文描述
     * @returns {Function} 包装后的函数
     */
    wrap(fn, context = 'unknown') {
        return (...args) => {
            try {
                const result = fn(...args);
                
                // 如果返回Promise，捕获异步错误
                if (result instanceof Promise) {
                    return result.catch(error => {
                        this.handleError({
                            type: 'async',
                            message: error.message || String(error),
                            context,
                            error,
                            timestamp: Date.now()
                        });
                        throw error;
                    });
                }
                
                return result;
            } catch (error) {
                this.handleError({
                    type: 'sync',
                    message: error.message || String(error),
                    context,
                    error,
                    timestamp: Date.now()
                });
                throw error;
            }
        };
    }

    /**
     * 包装异步函数
     * @param {Function} fn - 异步函数
     * @param {string} context - 上下文描述
     * @returns {Function} 包装后的函数
     */
    wrapAsync(fn, context = 'unknown') {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handleError({
                    type: 'async',
                    message: error.message || String(error),
                    context,
                    error,
                    timestamp: Date.now()
                });
                throw error;
            }
        };
    }

    /**
     * 创建错误UI
     */
    createErrorUI() {
        if (this.errorOverlay) {
            return;
        }

        // 创建遮罩层
        this.errorOverlay = document.createElement('div');
        this.errorOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Courier New', monospace;
        `;

        // 创建错误容器
        this.errorContainer = document.createElement('div');
        this.errorContainer.style.cssText = `
            background: #2a2a2a;
            color: #ff6b6b;
            padding: 30px;
            border-radius: 10px;
            max-width: 600px;
            max-height: 80%;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        this.errorOverlay.appendChild(this.errorContainer);
        document.body.appendChild(this.errorOverlay);

        Logger.log('ErrorHandler: Error UI created');
    }

    /**
     * 显示错误
     * @param {object} errorInfo - 错误信息
     */
    showError(errorInfo) {
        // 确保UI已创建
        if (!this.errorOverlay) {
            this.createErrorUI();
        }

        // 构建错误消息
        const errorHTML = `
            <div style="margin-bottom: 20px;">
                <h2 style="color: #ff6b6b; margin: 0 0 10px 0;">
                    ⚠️ 游戏错误
                </h2>
                <div style="background: #1a1a1a; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                    <p style="margin: 0 0 10px 0;"><strong>类型:</strong> ${errorInfo.type}</p>
                    <p style="margin: 0 0 10px 0;"><strong>消息:</strong> ${this.escapeHtml(errorInfo.message)}</p>
                    ${errorInfo.context ? `<p style="margin: 0 0 10px 0;"><strong>上下文:</strong> ${errorInfo.context}</p>` : ''}
                    ${errorInfo.source ? `<p style="margin: 0 0 10px 0;"><strong>文件:</strong> ${errorInfo.source}</p>` : ''}
                    ${errorInfo.line ? `<p style="margin: 0;"><strong>位置:</strong> 行 ${errorInfo.line}, 列 ${errorInfo.column}</p>` : ''}
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="window.errorHandler.hideError()" style="
                        background: #4a90e2;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                    ">继续游戏</button>
                    <button onclick="window.errorHandler.reloadGame()" style="
                        background: #e74c3c;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                    ">重新加载</button>
                    <button onclick="window.errorHandler.copyError()" style="
                        background: #95a5a6;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 5px;
                        cursor: pointer;
                        font-size: 14px;
                    ">复制错误</button>
                </div>
            </div>
        `;

        this.errorContainer.innerHTML = errorHTML;
        this.errorOverlay.style.display = 'flex';

        // 保存当前错误信息用于复制
        this.currentError = errorInfo;
    }

    /**
     * 隐藏错误UI
     */
    hideError() {
        if (this.errorOverlay) {
            this.errorOverlay.style.display = 'none';
        }
    }

    /**
     * 重新加载游戏
     */
    reloadGame() {
        window.location.reload();
    }

    /**
     * 复制错误信息
     */
    copyError() {
        if (!this.currentError) {
            return;
        }

        const errorText = `
错误类型: ${this.currentError.type}
错误消息: ${this.currentError.message}
${this.currentError.context ? `上下文: ${this.currentError.context}` : ''}
${this.currentError.source ? `文件: ${this.currentError.source}` : ''}
${this.currentError.line ? `位置: 行 ${this.currentError.line}, 列 ${this.currentError.column}` : ''}
时间戳: ${new Date(this.currentError.timestamp).toLocaleString()}
        `.trim();

        navigator.clipboard.writeText(errorText).then(() => {
            alert('错误信息已复制到剪贴板');
        }).catch(err => {
            console.error('Failed to copy error:', err);
        });
    }

    /**
     * 转义HTML特殊字符
     * @param {string} text - 要转义的文本
     * @returns {string} 转义后的文本
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 获取所有错误
     * @returns {Array} 错误列表
     */
    getErrors() {
        return [...this.errors];
    }

    /**
     * 清除所有错误
     */
    clearErrors() {
        this.errors = [];
        Logger.log('ErrorHandler: All errors cleared');
    }

    /**
     * 设置错误回调
     * @param {Function} callback - 错误回调函数
     */
    setErrorCallback(callback) {
        this.onError = callback;
    }

    /**
     * 启用/禁用错误UI
     * @param {boolean} enabled - 是否启用
     */
    setErrorUIEnabled(enabled) {
        this.showErrorUI = enabled;
    }

    /**
     * 销毁错误处理器
     */
    destroy() {
        if (this.errorOverlay) {
            this.errorOverlay.remove();
            this.errorOverlay = null;
            this.errorContainer = null;
        }
        this.errors = [];
        this.onError = null;
        Logger.log('ErrorHandler: Destroyed');
    }
}

// 创建全局实例
if (typeof window !== 'undefined') {
    window.errorHandler = new ErrorHandler();
}

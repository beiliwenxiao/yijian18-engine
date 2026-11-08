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

/**
 * 日志级别枚举
 */
export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

/**
 * 把外部传入的开关值归一化为布尔值；无法识别时返回 null（交给下一级来源）。
 */
function normalizeSwitch(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return !/^(?:0|false|off|no|none)$/i.test(value.trim());
    return null;
}

/**
 * 解析 IS_TEST 初始值，优先级：运行时全局 > 构建期配置 > 默认 true。
 * - 运行时：`window.__YJ18_IS_TEST__ = false`（或 globalThis，模块加载前设置）
 * - 构建期：打包器 define 注入 `__YJ18_IS_TEST__`，或 Vite 的 env（YJ18_IS_TEST / VITE_IS_TEST）
 */
function resolveInitialSwitch() {
    if (typeof globalThis !== 'undefined') {
        const override = normalizeSwitch(globalThis.__YJ18_IS_TEST__);
        if (override !== null) return override;
    }
    if (typeof __YJ18_IS_TEST__ !== 'undefined') {
        const buildFlag = normalizeSwitch(__YJ18_IS_TEST__);
        if (buildFlag !== null) return buildFlag;
    }
    try {
        const env = import.meta?.env;
        const envFlag = normalizeSwitch(env?.YJ18_IS_TEST ?? env?.VITE_IS_TEST);
        if (envFlag !== null) return envFlag;
    } catch (_error) {
        // 非 ESM 或受限宿主没有 import.meta.env，忽略
    }
    return true;
}

/**
 * 全局调试日志开关（唯一开关，模块级 live binding）
 * - true：输出调试日志（开发/调试用）
 * - false：调试日志零输出；日志调用代码可永久保留在代码中，不影响正式运行
 *
 * 三种切换方式效果等价：
 * 1. 控制台运行时：`Logger.IS_TEST = false` 或 `setTestMode(false)`
 * 2. 宿主页加载前：`window.__YJ18_IS_TEST__ = false`
 * 3. 打包期：define 注入 `__YJ18_IS_TEST__` / Vite env `YJ18_IS_TEST`
 *
 * 取舍：log/debug/info 属于调试信息，受开关控制；warn/error 代表真实异常
 * （崩溃、资源加载失败等），**始终输出**，不受开关影响。
 */
export let IS_TEST = resolveInitialSwitch();

/**
 * 切换调试日志开关（返回切换后的值）。
 * @param {boolean} enabled
 * @returns {boolean}
 */
export function setTestMode(enabled) {
    IS_TEST = enabled === true;
    return IS_TEST;
}

/**
 * 日志系统
 * 提供分级日志记录、过滤和导出功能
 */
export class Logger {
    /** 全局调试开关（运行时读写，与控制台 `Logger.IS_TEST = false` 等价） */
    static get IS_TEST() {
        return IS_TEST;
    }

    static set IS_TEST(value) {
        setTestMode(value);
    }

    /** 调试日志是否开启；热路径可先用它守卫，避免无谓的参数构造 */
    static get isTestEnabled() {
        return IS_TEST;
    }

    /** 以下静态调试方法受 IS_TEST 控制：true 时输出，false 时不输出，调用代码可永久保留 */
    static log(...args) {
        if (IS_TEST) console.log(...args);
    }

    static debug(...args) {
        if (IS_TEST) console.debug(...args);
    }

    static info(...args) {
        if (IS_TEST) console.info(...args);
    }

    /**
     * 延迟构造参数的调试日志：开关关闭时 buildArgs 完全不执行（零参数求值开销）。
     * @param {Function} buildArgs - 返回参数数组或单值的函数，仅在开关开启时调用
     */
    static logLazy(buildArgs) {
        if (IS_TEST) Logger._emit('log', buildArgs);
    }

    static debugLazy(buildArgs) {
        if (IS_TEST) Logger._emit('debug', buildArgs);
    }

    static infoLazy(buildArgs) {
        if (IS_TEST) Logger._emit('info', buildArgs);
    }

    /** 真实异常/告警：不受 IS_TEST 影响，始终输出 */
    static warn(...args) {
        console.warn(...args);
    }

    static error(...args) {
        console.error(...args);
    }

    static _emit(method, buildArgs) {
        const payload = typeof buildArgs === 'function' ? buildArgs() : buildArgs;
        if (payload === undefined || payload === null) return;
        if (Array.isArray(payload)) console[method](...payload);
        else console[method](payload);
    }

    constructor(options = {}) {
        // 当前日志级别
        this.level = options.level !== undefined ? options.level : LogLevel.INFO;
        
        // 日志历史
        this.logs = [];
        this.maxLogs = options.maxLogs || 1000;
        
        // 是否启用控制台输出
        this.consoleEnabled = options.consoleEnabled !== false;
        
        // 是否启用时间戳
        this.timestampEnabled = options.timestampEnabled !== false;
        
        // 日志过滤器（正则表达式或函数）
        this.filters = [];
        
        // 日志监听器
        this.listeners = [];
        
        // 日志级别名称
        this.levelNames = {
            [LogLevel.DEBUG]: 'DEBUG',
            [LogLevel.INFO]: 'INFO',
            [LogLevel.WARN]: 'WARN',
            [LogLevel.ERROR]: 'ERROR'
        };
        
        // 日志级别颜色（用于控制台）
        this.levelColors = {
            [LogLevel.DEBUG]: '#95a5a6',
            [LogLevel.INFO]: '#3498db',
            [LogLevel.WARN]: '#f39c12',
            [LogLevel.ERROR]: '#e74c3c'
        };
        
        Logger.log('Logger: Initialized with level', this.levelNames[this.level]);
    }

    /**
     * 记录调试日志
     * @param {string} message - 日志消息
     * @param {...any} args - 附加参数
     */
    debug(message, ...args) {
        this.log(LogLevel.DEBUG, message, ...args);
    }

    /**
     * 记录信息日志
     * @param {string} message - 日志消息
     * @param {...any} args - 附加参数
     */
    info(message, ...args) {
        this.log(LogLevel.INFO, message, ...args);
    }

    /**
     * 记录警告日志
     * @param {string} message - 日志消息
     * @param {...any} args - 附加参数
     */
    warn(message, ...args) {
        this.log(LogLevel.WARN, message, ...args);
    }

    /**
     * 记录错误日志
     * @param {string} message - 日志消息
     * @param {...any} args - 附加参数
     */
    error(message, ...args) {
        this.log(LogLevel.ERROR, message, ...args);
    }

    /**
     * 记录日志
     * @param {number} level - 日志级别
     * @param {string} message - 日志消息
     * @param {...any} args - 附加参数
     */
    log(level, message, ...args) {
        // 检查日志级别
        if (level < this.level) {
            return;
        }

        // 创建日志条目
        const entry = {
            level,
            levelName: this.levelNames[level],
            message,
            args,
            timestamp: Date.now(),
            date: new Date()
        };

        // 应用过滤器
        if (!this.shouldLog(entry)) {
            return;
        }

        // 添加到历史
        this.logs.push(entry);
        
        // 限制历史大小
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // 输出到控制台
        if (this.consoleEnabled) {
            this.logToConsole(entry);
        }

        // 通知监听器
        this.notifyListeners(entry);
    }

    /**
     * 检查是否应该记录日志
     * @param {object} entry - 日志条目
     * @returns {boolean}
     */
    shouldLog(entry) {
        // 如果没有过滤器，记录所有日志
        if (this.filters.length === 0) {
            return true;
        }

        // 应用所有过滤器
        for (const filter of this.filters) {
            if (typeof filter === 'function') {
                if (!filter(entry)) {
                    return false;
                }
            } else if (filter instanceof RegExp) {
                if (!filter.test(entry.message)) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * 输出到控制台
     * @param {object} entry - 日志条目
     */
    logToConsole(entry) {
        const timestamp = this.timestampEnabled 
            ? `[${entry.date.toLocaleTimeString()}] ` 
            : '';
        
        const levelName = `[${entry.levelName}]`;
        const message = `${timestamp}${levelName} ${entry.message}`;

        // 根据级别选择控制台方法
        switch (entry.level) {
            case LogLevel.DEBUG:
                console.debug(
                    `%c${message}`,
                    `color: ${this.levelColors[entry.level]}`,
                    ...entry.args
                );
                break;
            case LogLevel.INFO:
                console.info(
                    `%c${message}`,
                    `color: ${this.levelColors[entry.level]}`,
                    ...entry.args
                );
                break;
            case LogLevel.WARN:
                console.warn(
                    `%c${message}`,
                    `color: ${this.levelColors[entry.level]}`,
                    ...entry.args
                );
                break;
            case LogLevel.ERROR:
                console.error(
                    `%c${message}`,
                    `color: ${this.levelColors[entry.level]}`,
                    ...entry.args
                );
                break;
        }
    }

    /**
     * 通知监听器
     * @param {object} entry - 日志条目
     */
    notifyListeners(entry) {
        for (const listener of this.listeners) {
            try {
                listener(entry);
            } catch (error) {
                console.error('Logger: Error in listener', error);
            }
        }
    }

    /**
     * 添加日志监听器
     * @param {Function} listener - 监听器函数
     */
    addListener(listener) {
        this.listeners.push(listener);
    }

    /**
     * 移除日志监听器
     * @param {Function} listener - 监听器函数
     */
    removeListener(listener) {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * 添加过滤器
     * @param {RegExp|Function} filter - 过滤器
     */
    addFilter(filter) {
        this.filters.push(filter);
    }

    /**
     * 移除过滤器
     * @param {RegExp|Function} filter - 过滤器
     */
    removeFilter(filter) {
        const index = this.filters.indexOf(filter);
        if (index !== -1) {
            this.filters.splice(index, 1);
        }
    }

    /**
     * 清除所有过滤器
     */
    clearFilters() {
        this.filters = [];
    }

    /**
     * 设置日志级别
     * @param {number} level - 日志级别
     */
    setLevel(level) {
        this.level = level;
        Logger.log('Logger: Level set to', this.levelNames[level]);
    }

    /**
     * 启用/禁用控制台输出
     * @param {boolean} enabled - 是否启用
     */
    setConsoleEnabled(enabled) {
        this.consoleEnabled = enabled;
    }

    /**
     * 启用/禁用时间戳
     * @param {boolean} enabled - 是否启用
     */
    setTimestampEnabled(enabled) {
        this.timestampEnabled = enabled;
    }

    /**
     * 获取所有日志
     * @param {number} level - 可选的日志级别过滤
     * @returns {Array} 日志列表
     */
    getLogs(level = null) {
        if (level === null) {
            return [...this.logs];
        }
        return this.logs.filter(entry => entry.level === level);
    }

    /**
     * 获取最近的日志
     * @param {number} count - 日志数量
     * @returns {Array} 日志列表
     */
    getRecentLogs(count = 10) {
        return this.logs.slice(-count);
    }

    /**
     * 清除所有日志
     */
    clearLogs() {
        this.logs = [];
        Logger.log('Logger: All logs cleared');
    }

    /**
     * 导出日志为文本
     * @param {object} options - 导出选项
     * @returns {string} 日志文本
     */
    exportToText(options = {}) {
        const {
            level = null,
            startTime = null,
            endTime = null,
            includeTimestamp = true,
            includeLevel = true
        } = options;

        let logs = this.logs;

        // 按级别过滤
        if (level !== null) {
            logs = logs.filter(entry => entry.level === level);
        }

        // 按时间过滤
        if (startTime !== null) {
            logs = logs.filter(entry => entry.timestamp >= startTime);
        }
        if (endTime !== null) {
            logs = logs.filter(entry => entry.timestamp <= endTime);
        }

        // 格式化日志
        const lines = logs.map(entry => {
            let line = '';
            
            if (includeTimestamp) {
                line += `[${entry.date.toLocaleString()}] `;
            }
            
            if (includeLevel) {
                line += `[${entry.levelName}] `;
            }
            
            line += entry.message;
            
            if (entry.args.length > 0) {
                line += ' ' + entry.args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' ');
            }
            
            return line;
        });

        return lines.join('\n');
    }

    /**
     * 导出日志为JSON
     * @param {object} options - 导出选项
     * @returns {string} JSON字符串
     */
    exportToJSON(options = {}) {
        const {
            level = null,
            startTime = null,
            endTime = null
        } = options;

        let logs = this.logs;

        // 按级别过滤
        if (level !== null) {
            logs = logs.filter(entry => entry.level === level);
        }

        // 按时间过滤
        if (startTime !== null) {
            logs = logs.filter(entry => entry.timestamp >= startTime);
        }
        if (endTime !== null) {
            logs = logs.filter(entry => entry.timestamp <= endTime);
        }

        return JSON.stringify(logs, null, 2);
    }

    /**
     * 下载日志文件
     * @param {string} format - 格式 ('text' 或 'json')
     * @param {object} options - 导出选项
     */
    downloadLogs(format = 'text', options = {}) {
        let content;
        let filename;
        let mimeType;

        if (format === 'json') {
            content = this.exportToJSON(options);
            filename = `game-logs-${Date.now()}.json`;
            mimeType = 'application/json';
        } else {
            content = this.exportToText(options);
            filename = `game-logs-${Date.now()}.txt`;
            mimeType = 'text/plain';
        }

        // 创建下载链接
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        Logger.log(`Logger: Logs downloaded as ${filename}`);
    }

    /**
     * 创建子日志器
     * @param {string} prefix - 日志前缀
     * @returns {object} 子日志器
     */
    createChild(prefix) {
        return {
            debug: (message, ...args) => this.debug(`[${prefix}] ${message}`, ...args),
            info: (message, ...args) => this.info(`[${prefix}] ${message}`, ...args),
            warn: (message, ...args) => this.warn(`[${prefix}] ${message}`, ...args),
            error: (message, ...args) => this.error(`[${prefix}] ${message}`, ...args)
        };
    }
}

// 创建全局日志实例
export const logger = new Logger({
    level: LogLevel.INFO,
    consoleEnabled: true,
    timestampEnabled: true
});

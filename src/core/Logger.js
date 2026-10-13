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
 * 全局调试日志开关
 * - true：输出日志（开发/调试用）
 * - false：静默；日志调用代码可永久保留在代码中，不影响正式运行
 * 通过 Logger.log() 等静态方法使用，也可在运行时修改 Logger.IS_TEST 切换
 */
export const IS_TEST = true;

/**
 * 日志系统
 * 提供分级日志记录、过滤和导出功能
 */
export class Logger {
    /** 全局调试开关（运行时可改，如控制台执行 Logger.IS_TEST = false） */
    static IS_TEST = IS_TEST;

    /** 以下静态日志方法受 IS_TEST 控制：true 时输出，false 时不输出，调用代码可永久保留 */
    static log(...args) {
        if (Logger.IS_TEST) console.log(...args);
    }

    static debug(...args) {
        if (Logger.IS_TEST) console.debug(...args);
    }

    static info(...args) {
        if (Logger.IS_TEST) console.info(...args);
    }

    static warn(...args) {
        if (Logger.IS_TEST) console.warn(...args);
    }

    static error(...args) {
        if (Logger.IS_TEST) console.error(...args);
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
        
        console.log('Logger: Initialized with level', this.levelNames[this.level]);
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
        console.log('Logger: Level set to', this.levelNames[level]);
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
        console.log('Logger: All logs cleared');
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

        console.log(`Logger: Logs downloaded as ${filename}`);
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

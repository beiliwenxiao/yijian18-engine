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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger, LogLevel } from './Logger.js';

describe('Logger', () => {
    let logger;

    beforeEach(() => {
        logger = new Logger({
            level: LogLevel.DEBUG,
            consoleEnabled: false, // 禁用控制台输出以便测试
            timestampEnabled: false
        });
    });

    it('应该正确初始化', () => {
        expect(logger).toBeDefined();
        expect(logger.level).toBe(LogLevel.DEBUG);
        // 注意：logs可能包含初始化日志，所以我们只检查它是一个数组
        expect(Array.isArray(logger.logs)).toBe(true);
    });

    it('应该记录不同级别的日志', () => {
        // 清除可能存在的初始化日志
        logger.clearLogs();
        
        logger.debug('Debug message');
        logger.info('Info message');
        logger.warn('Warn message');
        logger.error('Error message');

        expect(logger.logs).toHaveLength(4);
        expect(logger.logs[0].levelName).toBe('DEBUG');
        expect(logger.logs[1].levelName).toBe('INFO');
        expect(logger.logs[2].levelName).toBe('WARN');
        expect(logger.logs[3].levelName).toBe('ERROR');
    });

    it('应该根据日志级别过滤', () => {
        logger.setLevel(LogLevel.WARN);

        logger.debug('Debug message');
        logger.info('Info message');
        logger.warn('Warn message');
        logger.error('Error message');

        expect(logger.logs).toHaveLength(2);
        expect(logger.logs[0].levelName).toBe('WARN');
        expect(logger.logs[1].levelName).toBe('ERROR');
    });

    it('应该限制日志历史大小', () => {
        logger.maxLogs = 3;

        for (let i = 0; i < 5; i++) {
            logger.info(`Message ${i}`);
        }

        expect(logger.logs).toHaveLength(3);
        expect(logger.logs[0].message).toBe('Message 2');
        expect(logger.logs[2].message).toBe('Message 4');
    });

    it('应该支持日志过滤器', () => {
        logger.addFilter(/important/);

        logger.info('This is important');
        logger.info('This is not');

        expect(logger.logs).toHaveLength(1);
        expect(logger.logs[0].message).toBe('This is important');
    });

    it('应该支持函数过滤器', () => {
        logger.addFilter((entry) => entry.message.includes('keep'));

        logger.info('keep this');
        logger.info('discard this');

        expect(logger.logs).toHaveLength(1);
        expect(logger.logs[0].message).toBe('keep this');
    });

    it('应该通知监听器', () => {
        const listener = vi.fn();
        logger.addListener(listener);

        logger.info('Test message');

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Test message',
                levelName: 'INFO'
            })
        );
    });

    it('应该移除监听器', () => {
        const listener = vi.fn();
        logger.addListener(listener);
        logger.removeListener(listener);

        logger.info('Test message');

        expect(listener).not.toHaveBeenCalled();
    });

    it('应该获取特定级别的日志', () => {
        logger.debug('Debug');
        logger.info('Info');
        logger.warn('Warn');
        logger.error('Error');

        const errorLogs = logger.getLogs(LogLevel.ERROR);
        expect(errorLogs).toHaveLength(1);
        expect(errorLogs[0].message).toBe('Error');
    });

    it('应该获取最近的日志', () => {
        for (let i = 0; i < 10; i++) {
            logger.info(`Message ${i}`);
        }

        const recent = logger.getRecentLogs(3);
        expect(recent).toHaveLength(3);
        expect(recent[0].message).toBe('Message 7');
        expect(recent[2].message).toBe('Message 9');
    });

    it('应该导出为文本', () => {
        logger.info('Test message 1');
        logger.warn('Test message 2');

        const text = logger.exportToText({ includeTimestamp: false });
        expect(text).toContain('[INFO] Test message 1');
        expect(text).toContain('[WARN] Test message 2');
    });

    it('应该导出为JSON', () => {
        logger.info('Test message');

        const json = logger.exportToJSON();
        const parsed = JSON.parse(json);

        expect(parsed).toHaveLength(1);
        expect(parsed[0].message).toBe('Test message');
        expect(parsed[0].levelName).toBe('INFO');
    });

    it('应该创建子日志器', () => {
        const child = logger.createChild('TestModule');

        child.info('Child message');

        expect(logger.logs).toHaveLength(1);
        expect(logger.logs[0].message).toBe('[TestModule] Child message');
    });

    it('应该清除日志', () => {
        logger.info('Test');
        expect(logger.logs).toHaveLength(1);

        logger.clearLogs();
        expect(logger.logs).toHaveLength(0);
    });

    it('应该清除过滤器', () => {
        logger.addFilter(/test/);
        logger.clearFilters();

        logger.info('test message');
        logger.info('other message');

        expect(logger.logs).toHaveLength(2);
    });
});

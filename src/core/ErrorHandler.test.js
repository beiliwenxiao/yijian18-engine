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
import { ErrorHandler } from './ErrorHandler.js';

describe('ErrorHandler', () => {
    let errorHandler;

    beforeEach(() => {
        errorHandler = new ErrorHandler();
        errorHandler.showErrorUI = false; // 禁用UI以便测试
    });

    it('应该正确初始化', () => {
        expect(errorHandler).toBeDefined();
        expect(errorHandler.errors).toEqual([]);
        expect(errorHandler.maxErrors).toBe(50);
    });

    it('应该记录错误', () => {
        const errorInfo = {
            type: 'test',
            message: 'Test error',
            timestamp: Date.now()
        };

        errorHandler.handleError(errorInfo);

        expect(errorHandler.errors).toHaveLength(1);
        expect(errorHandler.errors[0]).toEqual(errorInfo);
    });

    it('应该限制错误队列大小', () => {
        errorHandler.maxErrors = 3;

        for (let i = 0; i < 5; i++) {
            errorHandler.handleError({
                type: 'test',
                message: `Error ${i}`,
                timestamp: Date.now()
            });
        }

        expect(errorHandler.errors).toHaveLength(3);
        expect(errorHandler.errors[0].message).toBe('Error 2');
        expect(errorHandler.errors[2].message).toBe('Error 4');
    });

    it('应该调用错误回调', () => {
        const callback = vi.fn();
        errorHandler.setErrorCallback(callback);

        const errorInfo = {
            type: 'test',
            message: 'Test error',
            timestamp: Date.now()
        };

        errorHandler.handleError(errorInfo);

        expect(callback).toHaveBeenCalledWith(errorInfo);
    });

    it('应该包装同步函数', () => {
        const fn = vi.fn(() => {
            throw new Error('Test error');
        });

        const wrapped = errorHandler.wrap(fn, 'testContext');

        expect(() => wrapped()).toThrow('Test error');
        expect(errorHandler.errors).toHaveLength(1);
        expect(errorHandler.errors[0].context).toBe('testContext');
    });

    it('应该包装异步函数', async () => {
        const fn = vi.fn(async () => {
            throw new Error('Async error');
        });

        const wrapped = errorHandler.wrapAsync(fn, 'asyncContext');

        await expect(wrapped()).rejects.toThrow('Async error');
        expect(errorHandler.errors).toHaveLength(1);
        expect(errorHandler.errors[0].context).toBe('asyncContext');
    });

    it('应该清除错误', () => {
        errorHandler.handleError({
            type: 'test',
            message: 'Test error',
            timestamp: Date.now()
        });

        expect(errorHandler.errors).toHaveLength(1);

        errorHandler.clearErrors();

        expect(errorHandler.errors).toHaveLength(0);
    });

    it('应该获取错误列表', () => {
        const errors = [
            { type: 'test1', message: 'Error 1', timestamp: Date.now() },
            { type: 'test2', message: 'Error 2', timestamp: Date.now() }
        ];

        errors.forEach(err => errorHandler.handleError(err));

        const retrieved = errorHandler.getErrors();
        expect(retrieved).toHaveLength(2);
        expect(retrieved[0].message).toBe('Error 1');
        expect(retrieved[1].message).toBe('Error 2');
    });
});

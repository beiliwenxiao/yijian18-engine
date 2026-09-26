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

import { GameEngine } from './core/GameEngine.js';
import {
  resolveGameCanvas,
  exposeGameEngine,
  updateLoadingProgress,
  hideLoadingScreen,
  showError,
  checkBrowserCompatibility,
  onDomReady
} from './core/PlatformBootstrap.js';

/**
 * 游戏入口点
 * 初始化游戏引擎并启动游戏（DOM/全局访问全部经 platformInfra 引导层）
 */
async function main() {
    try {
        // 获取Canvas元素
        const canvas = resolveGameCanvas('game-canvas');
        if (!canvas) {
            throw new Error('Canvas element not found');
        }

        // 创建游戏引擎实例
        const gameEngine = new GameEngine(canvas);

        // 将游戏引擎设为全局可访问（供场景使用）
        exposeGameEngine(gameEngine);

        // 初始化游戏引擎
        console.log('Initializing game engine...');

        // 更新加载进度
        updateLoadingProgress(0, 'Initializing game engine...');

        await gameEngine.init();

        // 完成加载
        updateLoadingProgress(1, 'Loading complete!');

        // 启动游戏
        console.log('Starting game...');
        gameEngine.start();

        // 隐藏加载屏幕
        hideLoadingScreen();

    } catch (error) {
        console.error('Failed to initialize game:', error);
        showError('Failed to initialize game. Please refresh the page.');
    }
}

// 等待DOM加载完成后启动游戏
onDomReady(() => {
    if (checkBrowserCompatibility()) {
        main();
    }
});

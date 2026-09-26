/**
 * 微信小游戏适配层入口
 *
 * 在引擎代码加载之前执行，把小游戏 API 伪装成浏览器全局对象，
 * 让引擎源码（原本面向浏览器）无修改即可在小游戏环境运行。
 *
 * 引入顺序很重要：先 shim 再 import 引擎。
 */

import { shimCanvas, mainCanvas, getMainContext } from './canvas.js';
import { shimImage } from './image.js';
import { shimAudio } from './audio.js';
import { shimStorage } from './storage.js';
import { shimFetch } from './fetch.js';
import { shimEvent } from './event.js';
import { shimPerformance } from './performance.js';
import { shimMisc } from './misc.js';

// 小游戏全局是 GameGlobal（等价浏览器的 window）
const _global = typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : {});

// 注入 shim
shimCanvas(_global);
shimImage(_global);
shimAudio(_global);
shimStorage(_global);
shimFetch(_global);
shimEvent(_global, mainCanvas);
shimPerformance(_global);
shimMisc(_global);

// 导出主画布与其 2D 上下文供 game.js 使用
export { mainCanvas, getMainContext };
export { _global as global };

console.log('[WeApp Adapter] 适配层注入完成');

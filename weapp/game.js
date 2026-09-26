/**
 * 微信小游戏入口
 *
 * 等价于 demo 的 index.html <script type="module"> 部分。
 * 必须先 import adapter 完成全局 shim 注入，再加载引擎代码。
 *
 * 构建流程：
 *   1. Vite 把引擎 + demo 打成单 bundle → weapp/src/bundle.js
 *   2. 静态资源（JSON/图片/音频）复制到 weapp/assets/
 *   3. 微信开发者工具打开 weapp/ 目录即可预览
 *
 * 当前文件为手写入口骨架，引擎 bundle 的实际导出在构建脚本中配置。
 */

// ① 适配层注入（必须最先执行）
import { mainCanvas, getMainContext } from './adapter/index.js';

// ② 引擎打包后的 bundle（Vite 构建产物）
// 构建脚本会生成此文件，包含 SceneManager + 所有场景 + 引擎核心
// import { bootstrap } from './src/bundle.js';

// ③ 获取系统信息
const sys = wx.getSystemInfoSync();
const screenWidth = sys.windowWidth;
const screenHeight = sys.windowHeight;
const dpr = sys.pixelRatio || 1;

// ④ 设置主画布尺寸（横屏游戏）
mainCanvas.width = screenWidth * dpr;
mainCanvas.height = screenHeight * dpr;

const ctx = getMainContext();
ctx.scale(dpr, dpr);

console.log(`[WeApp] 画布: ${mainCanvas.width}x${mainCanvas.height} (DPR=${dpr})`);

// ⑤ 临时占位：显示等待画面（引擎 bundle 构建完成后替换为实际启动逻辑）
function drawPlaceholder() {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, screenWidth, screenHeight);
  ctx.fillStyle = '#4CAF50';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YiJian18-Engine', screenWidth / 2, screenHeight / 2 - 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = '16px sans-serif';
  ctx.fillText('微信小游戏适配中...', screenWidth / 2, screenHeight / 2 + 20);
  ctx.fillStyle = '#888888';
  ctx.font = '12px sans-serif';
  ctx.fillText('请先运行构建脚本生成 bundle', screenWidth / 2, screenHeight / 2 + 60);
}

drawPlaceholder();

/**
 * 实际启动函数（构建完成后取消注释）
 *
 * import { bootstrap } from './src/bundle.js';
 *
 * bootstrap({
 *   canvas: mainCanvas,
 *   ctx,
 *   screenWidth,
 *   screenHeight,
 *   dpr
 * });
 */

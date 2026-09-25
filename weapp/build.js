/**
 * 微信小游戏构建脚本
 *
 * 用法：node weapp/build.js
 *
 * 做三件事：
 *   1. 用 Vite 把引擎 + demo 打成单 bundle → weapp/src/bundle.js
 *   2. 复制静态资源（场景JSON、图片、音频、配置）→ weapp/assets/
 *   3. 输出提示信息
 *
 * 前置要求：
 *   - npm install（根目录的 vite 和 vitest）
 *   - 确保 example/sanguo_zhangjiao/ 下的资源完整
 */

import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WEAPP = __dirname;
const DEMO = resolve(ROOT, 'example/sanguo_zhangjiao');

console.log('═══════════════════════════════════════');
console.log(' YiJian18-Engine 微信小游戏构建');
console.log('═══════════════════════════════════════');

// ─── Step 1: Vite 构建 bundle ───────────────────────────────

const viteConfig = resolve(WEAPP, 'vite.config.weapp.js');
if (!existsSync(viteConfig)) {
  // 自动生成 vite 配置
  writeFileSync(viteConfig, `
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'src'),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'entry.js'),
      formats: ['es'],
      fileName: () => 'bundle.js'
    },
    rollupOptions: {
      // 不外部化任何依赖，全部打进 bundle
      external: []
    },
    minify: 'terser',
    target: 'es2020'
  },
  resolve: {
    alias: {
      '@engine': resolve(__dirname, '../src'),
      '@demo': resolve(__dirname, '../example/sanguo_zhangjiao')
    }
  }
});
`);
  console.log('✔ 已生成 vite.config.weapp.js');
}

// 生成构建入口文件（把引擎 + 场景导出为 bootstrap 函数）
const entryFile = resolve(WEAPP, 'entry.js');
if (!existsSync(entryFile)) {
  writeFileSync(entryFile, `
/**
 * 小游戏构建入口（由 build.js 自动生成）
 * 导出 bootstrap 供 game.js 调用
 */
import { SceneManager } from '@engine/core/SceneManager.js';
import { InputManager } from '@engine/core/InputManager.js';
import { DataDrivenPrologueScene } from '@demo/scenes/DataDrivenPrologueScene.js';

export function bootstrap({ canvas, ctx, screenWidth, screenHeight, dpr }) {
  // 场景管理器
  const sceneManager = new SceneManager();

  // 注册唯一的数据驱动大地图场景
  sceneManager.registerScene('DataDrivenPrologueScene', DataDrivenPrologueScene);

  // 切换到序章
  sceneManager.switchTo('DataDrivenPrologueScene');

  // 游戏主循环
  let lastTime = performance.now();
  function gameLoop() {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // 手柄轮询
    const scene = sceneManager.getCurrentScene();
    if (scene && scene.inputManager && scene.inputManager.pollGamepads) {
      scene.inputManager.pollGamepads();
    }

    // 更新
    sceneManager.update(dt);

    // 渲染
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, screenWidth, screenHeight);
    sceneManager.render(ctx);

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
  console.log('[WeApp] 游戏启动成功');
}
`);
  console.log('✔ 已生成 entry.js');
}

console.log('\\n⏳ 正在构建 bundle（Vite）...');
try {
  execSync(\`npx vite build --config "\${viteConfig}"\`, { cwd: ROOT, stdio: 'inherit' });
  console.log('✔ Bundle 构建完成 → weapp/src/bundle.js');
} catch (e) {
  console.error('✘ Bundle 构建失败:', e.message);
  console.log('\\n可手动运行: npx vite build --config weapp/vite.config.weapp.js');
}

// ─── Step 2: 复制资源 ────────────────────────────────────────

const assetsDir = resolve(WEAPP, 'assets');
mkdirSync(assetsDir, { recursive: true });

const resourceDirs = [
  { src: resolve(DEMO, 'assets'), dest: resolve(assetsDir, 'assets') },
  { src: resolve(DEMO, 'config'), dest: resolve(assetsDir, 'config') },
  { src: resolve(DEMO, 'data'), dest: resolve(assetsDir, 'data') }
];

for (const { src, dest } of resourceDirs) {
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true, force: true });
    console.log(\`✔ 复制: \${src.replace(ROOT, '')} → \${dest.replace(ROOT, '')}\`);
  } else {
    console.warn(\`⚠ 源目录不存在: \${src.replace(ROOT, '')}\`);
  }
}

// 复制 game.project.json + project/ shards 分片
const gpj = resolve(DEMO, 'game.project.json');
if (existsSync(gpj)) {
  cpSync(gpj, resolve(assetsDir, 'game.project.json'));
  console.log('✔ 复制: game.project.json');
}
const shardsDir = resolve(DEMO, 'project');
if (existsSync(shardsDir)) {
  cpSync(shardsDir, resolve(assetsDir, 'project'), { recursive: true, force: true });
  console.log('✔ 复制: project/ (shards)');
}

// ─── Step 3: 完成 ────────────────────────────────────────────

console.log('\\n═══════════════════════════════════════');
console.log(' ✅ 构建完成！');
console.log('');
console.log(' 用微信开发者工具打开 weapp/ 目录：');
console.log(\`   \${WEAPP}\`);
console.log('');
console.log(' 如果是首次使用：');
console.log('   1. 取消注释 game.js 中的 bootstrap import');
console.log('   2. 在 project.config.json 填入你的 appid');
console.log('   3. 微信开发者工具 → 导入项目 → 选择 weapp/ 目录');
console.log('═══════════════════════════════════════');

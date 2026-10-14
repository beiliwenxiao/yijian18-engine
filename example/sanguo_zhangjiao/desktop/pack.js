// 使用 @electron/packager 把游戏打包成可直接运行的 Windows 程序（含 .exe）
// 不需要代码签名工具（winCodeSign），规避 Windows 符号链接权限问题。
const path = require('path');
const fs = require('fs');

async function main() {
  const { packager } = require('@electron/packager');

  const projectDir = __dirname;
  const outDir = path.join(projectDir, 'release');

  // 确保 game/ 已准备好
  if (!fs.existsSync(path.join(projectDir, 'game', 'index.html'))) {
    console.error('[pack] 缺少 game/index.html，请先运行 npm run prepare:web');
    process.exit(1);
  }

  console.log('[pack] 开始打包...');

  // 先彻底清理旧的输出目录，避免 overwrite 残留导致 ignore 不生效
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const appPaths = await packager({
    dir: projectDir,
    out: outDir,
    platform: 'win32',
    arch: 'x64',
    appCopyright: 'h5game',
    name: 'ZhangjiaoUprising',
    overwrite: true,
    // 默认开启 asar：把 main.js / game/（含图片资源）打进单个 app.asar 归档，
    // 用户在安装目录看不到可直接打开的 png，提高随手拷贝资源的门槛。
    // 注意：这只是第一道门槛，asar 可被工具解包，并非真正加密。
    asar: true,
    // 关闭自动 prune，用函数式 ignore 完全排除 node_modules 等开发文件。
    // 运行时仅依赖 main.js（Node 内置模块）与 game/ 静态资源。
    prune: false,
    ignore: (p) => {
      // p 形如 "/node_modules/xxx"、"/game/index.html"，根目录为 ""
      if (p === '') return false;
      return (
        p === '/node_modules' || p.startsWith('/node_modules/') ||
        p === '/release' || p.startsWith('/release/') ||
        p === '/pack.js' ||
        p === '/copy-web.js' ||
        p === '/vite.config.js' ||
        p === '/.git' || p.startsWith('/.git/') ||
        p === '/package-lock.json'
      );
    }
  });

  console.log('[pack] 打包完成，输出目录：');
  appPaths.forEach((p) => console.log('  - ' + p));
  console.log('[pack] 可执行文件：' + path.join(appPaths[0], 'ZhangjiaoUprising.exe'));
}

main().catch((err) => {
  console.error('[pack] 打包失败:', err);
  process.exit(1);
});

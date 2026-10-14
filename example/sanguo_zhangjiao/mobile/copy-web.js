// 将 Vite 构建产物拷贝到 Capacitor 的 webDir（www/）
const fs = require('fs');
const path = require('path');

// 仓库根 dist/sanguo_zhangjiao（vite.config.js 的输出目录）
const src = path.resolve(__dirname, '../../../dist/sanguo_zhangjiao');
const dest = path.resolve(__dirname, 'www');

if (!fs.existsSync(src)) {
  console.error(`[copy-web] 找不到构建产物: ${src}\n请先运行 npm run build:web`);
  process.exit(1);
}

// 清空旧的 www 目录
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

console.log(`[copy-web] 已拷贝 ${src} -> ${dest}`);

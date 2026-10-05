// 将 HudIconPainter 的全部内置图标渲染为 PNG 图片资产。
// 用本机 Edge/Chrome 无头渲染（与游戏内 Canvas 绘制完全同源），输出 128×128 透明底 PNG：
//   example/sanguo_zhangjiao/assets/images/ui/icons/<name>.png
// 可重复执行：node scripts/render-hud-icons.mjs（需 dev server 运行在 :3000）
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const OUT_DIR = 'example/sanguo_zhangjiao/assets/images/ui/icons';
const SIZE = 128;          // 输出边长（px）
const ICON_BOX = 112;      // 图标绘制盒边长（四周留 8px 内边距）
const DEV_SERVER = 'http://localhost:3000';

// 候选浏览器：Edge → Chrome（x86 / x64 常见安装路径）
const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
const executablePath = CANDIDATES.find(p => existsSync(p));
if (!executablePath) {
  console.error('未找到 Edge/Chrome，请安装或在 CANDIDATES 中补充路径。');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files']
});
try {
  const page = await browser.newPage();
  // 直接访问 dev server，保证 /src/ui/HudIconPainter.js 同源可 import
  await page.goto(DEV_SERVER + '/', { waitUntil: 'load', timeout: 60000 });

  const icons = await page.evaluate(async ({ SIZE, ICON_BOX }) => {
    const { HudIconPainter } = await import('/src/ui/HudIconPainter.js');
    const names = HudIconPainter.names();
    if (!names.length) throw new Error('HudIconPainter 未暴露任何图标');
    return names.map(name => {
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      // 透明底绘制（brighten 0 = 常态色）
      HudIconPainter.draw(ctx, name, SIZE / 2, SIZE / 2, ICON_BOX, { brighten: 0 });
      return { name, dataUrl: canvas.toDataURL('image/png') };
    });
  }, { SIZE, ICON_BOX });

  mkdirSync(OUT_DIR, { recursive: true });
  for (const { name, dataUrl } of icons) {
    const file = `${OUT_DIR}/${name}.png`;
    writeFileSync(file, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log(`written: ${file}`);
  }
  console.log(`done: ${icons.length} icons -> ${OUT_DIR}`);
} finally {
  await browser.close();
}

// 验证浏览器中运行的 activateStep 是否包含追认逻辑
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const executablePath = CANDIDATES.find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,800']
});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3457/example/sanguo_zhangjiao_3d/index.html', { waitUntil: 'load', timeout: 60000 });
  await sleep(2500);
  const src = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      hasHost: !!h,
      activateStepSrc: h ? h.activateStep.toString().slice(0, 900) : null,
      commitFactSrc: h ? h.commitFact.toString().slice(0, 400) : null
    };
  });
  console.log(JSON.stringify(src, null, 1));
} finally { await browser.close(); }

// 启动快速探针：确认工程数据装载 + 对话推进可用
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const URL = 'http://127.0.0.1:3457/example/sanguo_zhangjiao_3d/index.html';
const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
const executablePath = CANDIDATES.find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,800']
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);
  const probe = () => page.evaluate(() => {
    const txt = id => (document.getElementById(id)?.textContent || '').trim();
    const steps = [...document.querySelectorAll('#quest-steps li')].map(li => li.className + ':' + li.textContent.trim());
    return { pos: txt('position'), phase: txt('phase'), enemies: txt('enemies'), questTitle: txt('quest-title'), steps, loading: document.getElementById('loading-screen')?.style.display !== 'none' };
  });
  let p = await probe();
  if (p.loading) {
    const body = await page.evaluate(() => document.getElementById('loading-screen')?.textContent || '');
    if (body.includes('3D 模式不可用') || body.includes('软件渲染')) {
      await page.evaluate(() => window.forceInit && window.forceInit());
      await sleep(3500);
    }
  }
  for (let i = 0; i < 25; i++) { p = await probe(); if (!p.loading && p.questTitle && p.steps.join().includes('quest-')) break; await sleep(1000); }
  console.log('[boot] ' + JSON.stringify(p, null, 1));
  for (let i = 0; i < 6; i++) { await page.keyboard.press(' '); await sleep(700); }
  await sleep(1500);
  p = await probe();
  console.log('[after-space] ' + JSON.stringify(p, null, 1));
  await page.keyboard.down('w'); await sleep(600); await page.keyboard.up('w');
  await sleep(800);
  await page.keyboard.press('e'); await sleep(2500);
  p = await probe();
  console.log('[after-campfire] ' + JSON.stringify(p, null, 1));
  console.log('ERRORS=' + JSON.stringify(errors));
} finally { await browser.close(); }

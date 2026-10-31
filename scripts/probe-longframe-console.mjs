/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-01
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 ************************************************************/

/**
 * probe-longframe-console.mjs —— 抓取游戏自打的长帧日志（有头 Chrome）。
 * 监听 [DDScene][FrameProfile][长帧] console 输出，收集队列绘制类型分解
 * 与实体 Top3（GPU 条件下的真实归因）。
 * 前置：dev server 3000 端口。
 *
 * 用法：node scripts/probe-longframe-console.mjs [windowMs=20000] [scene=S01]
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const windowMs = Number(process.argv[2]) || 20000;
const targetSceneId = process.argv[3] || 'S01';

const browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const longFrames = [];
page.on('console', message => {
  const text = message.text();
  if (text.includes('[FrameProfile][长帧]')) longFrames.push(text);
});
await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });

for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => Boolean(window.__ddScene))) break;
  if (i >= 2) {
    await page.evaluate(() => {
      for (const label of ['下一步', '开始新游戏', '开始游戏', '确认', '确定', '继续']) {
        const m = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled && b.textContent.trim() === label);
        if (m.length > 0) { m[m.length - 1].click(); return; }
      }
    });
  }
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 400);
});
await page.waitForTimeout(800);
const currentScene = await page.evaluate(() => window.__ddScene?.currentSceneId || window.__ddScene?.name);
if (currentScene !== targetSceneId) {
  await page.evaluate(async sceneId => {
    await window.__ddScene.teleportToChunk({ scene: sceneId, spawnRef: 'player', operationId: 'lf:enter' });
  }, targetSceneId);
  await page.waitForTimeout(3000);
}
await page.evaluate(() => {
  const scene = window.__ddScene;
  scene.debugMode = true;
  scene._framePerformanceProfile = undefined;
});
await page.waitForTimeout(windowMs);

console.log(`captured ${longFrames.length} long-frame logs`);
// 只输出后半段（跳过加载期尖刺），去重相邻相同行
for (const line of longFrames.slice(Math.floor(longFrames.length / 3))) {
  console.log(line);
}
await browser.close();

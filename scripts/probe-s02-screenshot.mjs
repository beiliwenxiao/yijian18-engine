/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-28
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * probe-s02-screenshot.mjs —— S02 新场景截图（供人工目检）。
 * 前置：dev server 3000 端口。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
await page.evaluate(async () => { await window.__ddScene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'shot:enter' }); });
await page.waitForTimeout(3000);
// 若处于读档恢复的附身态，先释放回主角再截图
await page.evaluate(() => {
  const scene = window.__ddScene;
  try { if (scene.playerEntity?.id === 'zhangjiao-possessed') scene.s02ArmyRescueCoordinator?.releaseCommander?.(); } catch (e) {}
});
await page.waitForTimeout(2000);
await page.screenshot({ path: 'Temp/s02-scene-overview.png' });
// 玩家挪到村中心再截一张（相机跟随）
await page.evaluate(() => {
  const scene = window.__ddScene;
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  if (t) { t.position.x = 640 + (offset.x || 0); t.position.y = 380 + (offset.y || 0); }
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'Temp/s02-scene-zoomout.png' });
console.log('screenshots saved: Temp/s02-scene-overview.png, Temp/s02-scene-zoomout.png');
await browser.close();

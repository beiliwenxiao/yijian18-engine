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
 * probe-s02-idcheck.mjs —— 开局玩家实体 id 快照（S01 阶段 + S02 进入后）。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
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
const s01 = await page.evaluate(() => {
  const scene = window.__ddScene;
  return {
    playerEntityId: scene.playerEntity?.id || null,
    playerName: scene.playerEntity?.name || null,
    selected: window.__ddScene?.constructor?.name || null,
    storeId: (window.__store_probe = null, null)
  };
});
console.log('S01:', JSON.stringify(s01));
const s02 = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const r = await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'idchk:enter' });
  await new Promise(res => setTimeout(res, 2500));
  const players = (scene.entityStore?.all || []).filter(e => e?.getComponent?.('stats') && (e.id === scene.playerEntity?.id || String(e.name || '').includes('张') || String(e.id || '').includes('zhangjiao')));
  return {
    teleportOk: r?.ok,
    playerEntityId: scene.playerEntity?.id || null,
    playerLike: players.map(e => ({ id: e.id, name: e.name, hp: e.getComponent('stats')?.hp }))
  };
});
console.log('S02:', JSON.stringify(s02));
await browser.close();

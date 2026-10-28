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
 * probe-s02-debug4.mjs —— farewell 链卡点定位：真实跑链 + 全量 console 捕获 + 手动步进。
 * 前置：dev server 3000 端口。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleLines = [];
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning' || t.includes('Trigger') || t.includes('placement') || t.includes('despawn')) {
    consoleLines.push(`[${m.type()}] ${t.slice(0, 400)}`);
  }
});
page.on('pageerror', e => consoleLines.push(`[pageerror] ${String(e).slice(0, 300)}`));
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
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 500);
});
await page.waitForTimeout(800);
await page.evaluate(async () => { await window.__ddScene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd4:enter' }); });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const count = prefix => (scene.entityStore?.all || []).filter(e => e?.placementId === prefix).length;
  const res = {};
  // 快进事实链（带 teleport，场景守卫满足）
  const commit = async (definitionId, opId) => {
    const r = await scene.sceneRuntime?.commandGateway?.execute({
      intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: opId, payload: { definitionId }
    });
    return { ok: r?.ok, code: r?.code };
  };
  res.commitFainted = await commit('story.s02.beg.fainted', 'd4:f');
  await sleep(300);
  scene.gameLoader?.triggerSystem?.fire?.('dialogueChoice', { id: 'dialogue.s02.prologue', choiceId: 'save' });
  await sleep(500);
  res.commitRescue = await commit('story.s02.rescue.done', 'd4:r');
  await sleep(300);
  res.commitPorridge = await commit('story.s02.porridge.laid', 'd4:p');
  await sleep(300);
  // 手动步进：spawn batch1 → despawn batch1 → spawn batch2
  const placements = scene.context?.services?.placements;
  res.apiNames = placements ? Object.keys(placements).filter(k => /spawn|despawn/i.test(k)) : null;
  res.spawn1 = placements?.spawnGroup?.('S02-porridge-batch-1') ?? 'no-spawnGroup';
  await sleep(1200);
  res.batch1AfterSpawn = ['S02-porridge-queue-1','S02-porridge-queue-2','S02-porridge-queue-3','S02-porridge-queue-4','S02-porridge-queue-5'].map(count);
  res.despawn1 = placements?.despawn?.({ group: 'S02-porridge-batch-1' }) ?? 'no-despawn';
  await sleep(1200);
  res.batch1AfterDespawn = ['S02-porridge-queue-1','S02-porridge-queue-2','S02-porridge-queue-3','S02-porridge-queue-4','S02-porridge-queue-5'].map(count);
  res.spawn2 = placements?.spawnGroup?.('S02-porridge-batch-2') ?? '-';
  await sleep(1200);
  res.batch2AfterSpawn = ['S02-porridge-queue-6','S02-porridge-queue-7','S02-porridge-queue-8','S02-porridge-queue-9','S02-porridge-queue-10'].map(count);
  return res;
});
console.log('RESULT:', JSON.stringify(out, null, 2));
console.log('CONSOLE LINES:', consoleLines.length);
consoleLines.slice(0, 30).forEach(l => console.log(l));
await browser.close();

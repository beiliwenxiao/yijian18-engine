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
 * probe-s02-debug5.mjs —— 复刻主探针 C→D 段，抓 farewell 链逐步日志与账本。
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
  if (t.includes('Trigger') || t.includes('spawn') || t.includes('despawn') || m.type() === 'error') {
    consoleLines.push(`${new Date().toISOString().slice(11, 23)} [${m.type()}] ${t.slice(0, 260)}`);
  }
});
page.on('pageerror', e => consoleLines.push(`${new Date().toISOString().slice(11, 23)} [pageerror] ${String(e).slice(0, 300)}`));
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
await page.evaluate(async () => { await window.__ddScene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd5:enter' }); });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const count = id => (scene.entityStore?.all || []).filter(e => e?.placementId === id).length;
  const res = { timeline: [] };
  const snap = label => res.timeline.push({
    t: Date.now() % 1000000, label,
    b1: ['S02-porridge-queue-1','S02-porridge-queue-2','S02-porridge-queue-3','S02-porridge-queue-4','S02-porridge-queue-5'].map(count),
    b2: ['S02-porridge-queue-6','S02-porridge-queue-7','S02-porridge-queue-8','S02-porridge-queue-9','S02-porridge-queue-10'].map(count),
    porridge: scene.gameLoader?.blackboard?.get?.('storyState')?.s02PorridgeLaid ?? null
  });
  // B/C 段（与主探针一致）
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd5:f', payload: { definitionId: 'story.s02.beg.fainted' } });
  await sleep(2500);
  scene.gameLoader?.triggerSystem?.fire?.('dialogueChoice', { id: 'dialogue.s02.prologue', choiceId: 'save' });
  await sleep(1500);
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  t.position.x = 620 + (offset.x || 0);
  t.position.y = 350 + (offset.y || 0);
  await sleep(2500);
  snap('after-goal');
  await sleep(4000);
  snap('after-awaken-4s');
  // 观测 60 秒，每 5 秒快照
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    snap('obs+' + ((i + 1) * 5) + 's');
  }
  // farewell 链账本
  const ts = scene.gameLoader?.triggerSystem;
  res.ledgerFarewell = ts?.ledger?.get?.('trg_s02_farewell') ?? ts?.ledger?.snapshot?.()?.trg_s02_farewell ?? 'no-ledger-api';
  try { res.ledgerDump = ts?.ledger?.snapshot ? Object.fromEntries(Object.entries(ts.ledger.snapshot()).filter(([k]) => k.includes('s02'))) : null; } catch (e) { res.ledgerDump = 'err ' + e.message; }
  return res;
});
console.log('TIMELINE:', JSON.stringify(out.timeline, null, 1));
console.log('LEDGER:', JSON.stringify(out.ledgerFarewell), JSON.stringify(out.ledgerDump));
console.log('CONSOLE LINES:', consoleLines.length);
consoleLines.forEach(l => console.log(l));
await browser.close();

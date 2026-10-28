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
 * probe-s02-debug6.mjs —— farewell 链逐步动作追踪（_executeAction 猴补丁）。
 * 前置：dev server 3000 端口。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const chainLogs = [];
page.on('console', m => {
  const t = m.text();
  if (t.includes('[CHAIN]')) chainLogs.push(`${new Date().toISOString().slice(11, 23)} ${t.slice(0, 300)}`);
});
page.on('pageerror', e => chainLogs.push(`${new Date().toISOString().slice(11, 23)} [pageerror] ${String(e).slice(0, 300)}`));
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
  const patch = () => {
    const ts = window.__ddScene?.gameLoader?.triggerSystem;
    if (!ts || ts.__chainPatched) return;
    ts.__chainPatched = true;
    const orig = ts._executeAction.bind(ts);
    ts._executeAction = async (trigger, action, index, request) => {
      const t0 = Date.now();
      console.log(`[CHAIN] ${trigger?.id} step${index} ${action?.action} ${JSON.stringify(action?.params || {}).slice(0, 140)}`);
      try {
        const r = await orig(trigger, action, index, request);
        console.log(`[CHAIN] ${trigger?.id} step${index} ${action?.action} -> ok=${r?.ok} code=${r?.code || '-'} (${Date.now() - t0}ms)`);
        return r;
      } catch (e) {
        console.log(`[CHAIN] ${trigger?.id} step${index} ${action?.action} -> THROW ${e?.code || e?.message} (${Date.now() - t0}ms)`);
        throw e;
      }
    };
  };
  window.__pt = setInterval(patch, 200);
});
await page.waitForTimeout(800);
await page.evaluate(async () => { await window.__ddScene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd6:enter' }); });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const count = id => (scene.entityStore?.all || []).filter(e => e?.placementId === id).length;
  const res = { b1: [], b2: [], queue: 0 };
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd6:f', payload: { definitionId: 'story.s02.beg.fainted' } });
  await sleep(2500);
  scene.gameLoader?.triggerSystem?.fire?.('dialogueChoice', { id: 'dialogue.s02.prologue', choiceId: 'save' });
  await sleep(1500);
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  t.position.x = 620 + (offset.x || 0);
  t.position.y = 350 + (offset.y || 0);
  await sleep(2500);
  // 追踪 75 秒
  for (let i = 0; i < 15; i++) {
    await sleep(5000);
    res.b1.push(['S02-porridge-queue-1','S02-porridge-queue-2','S02-porridge-queue-3','S02-porridge-queue-4','S02-porridge-queue-5'].map(count).join(''));
    res.b2.push(['S02-porridge-queue-6','S02-porridge-queue-7','S02-porridge-queue-8','S02-porridge-queue-9','S02-porridge-queue-10'].map(count).join(''));
    res.queue = count('S02-recruit-queue-1');
  }
  res.porridge = scene.gameLoader?.blackboard?.get?.('storyState')?.s02PorridgeLaid ?? null;
  return res;
});
console.log('B1 轨迹(每5s):', out.b1.join(' '));
console.log('B2 轨迹(每5s):', out.b2.join(' '));
console.log('queue:', out.queue, 'porridge:', out.porridge);
console.log('CHAIN LOGS:', chainLogs.length);
chainLogs.filter(l => l.includes('farewell') || l.includes('pageerror') || l.includes('THROW')).slice(0, 40).forEach(l => console.log(l));
await browser.close();

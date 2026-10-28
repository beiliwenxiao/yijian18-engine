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
 * probe-s02-debug7.mjs —— 隔离测试 farewell 施粥链：直接 fire dialogueEnd 事件，
 * 无军队/救援竞态；补丁记录每步动作结果。
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
  if (t.includes('[CHAIN]') || t.includes('[ScenePlacementRuntime] spawn') || m.type() === 'error') {
    chainLogs.push(`${new Date().toISOString().slice(11, 23)} ${t.slice(0, 400)}`);
  }
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
      if (trigger?.id !== 'trg_s02_farewell') return orig(trigger, action, index, request);
      const t0 = Date.now();
      console.log(`[CHAIN] farewell step${index} ${action?.action} ${JSON.stringify(action?.params || {}).slice(0, 120)}`);
      const r = await orig(trigger, action, index, request);
      console.log(`[CHAIN] farewell step${index} ${action?.action} -> ok=${r?.ok} code=${r?.code || '-'} counts=${JSON.stringify(r?.counts || null)} removed=${r?.removed ?? '-'} (${Date.now() - t0}ms)`);
      return r;
    };
  };
  window.__pt = setInterval(patch, 200);
});
await page.waitForTimeout(800);
await page.evaluate(async () => { await window.__ddScene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd7:enter' }); });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const count = id => (scene.entityStore?.all || []).filter(e => e?.placementId === id).length;
  const res = { b: [] };
  scene.gameLoader?.triggerSystem?.fire?.('dialogueEnd', { id: 'dialogue.s02.awakening' });
  for (let i = 0; i < 16; i++) {
    await sleep(5000);
    const all = [];
    for (let k = 1; k <= 25; k++) all.push(count(`S02-porridge-queue-${k}`));
    all.push(count('S02-recruit-queue-1') + count('S02-recruit-queue-2') + count('S02-recruit-queue-3') + count('S02-recruit-queue-4'));
    res.b.push(all.join(''));
  }
  res.porridge = scene.gameLoader?.blackboard?.get?.('storyState')?.s02PorridgeLaid ?? null;
  return res;
});
console.log('批次轨迹(每5s, q1..q25+队列):');
out.b.forEach((l, i) => console.log(`  +${(i + 1) * 5}s: ${l}`));
console.log('porridge:', out.porridge);
console.log('CHAIN LOGS:', chainLogs.length);
chainLogs.forEach(l => console.log(l));
await browser.close();

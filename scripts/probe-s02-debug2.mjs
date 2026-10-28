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
 * probe-s02-debug2.mjs —— 抓 possessCommander 调用栈 + 玩家实体 id 轨迹。
 * 前置：dev server 3000 端口。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
page.on('console', m => { const t = m.text(); if (t.includes('[POSSESS]') || t.includes('[CAMP]')) console.log('[console]', t.slice(0, 3000)); });
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
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 400);
  // 猴补丁抓调用栈
  const patch = () => {
    const c = window.__ddScene?.s02ArmyRescueCoordinator;
    if (!c || c.__patched) return;
    c.__patched = true;
    const orig = c.possessCommander.bind(c);
    c.possessCommander = (...args) => {
      console.log('[POSSESS] called, stack:\n' + String(new Error().stack).split('\n').slice(1, 16).join('\n'));
      return orig(...args);
    };
    const origCamp = c.campArmy.bind(c);
    c.campArmy = (...args) => {
      console.log('[CAMP] campArmy called, stack:\n' + String(new Error().stack).split('\n').slice(1, 16).join('\n'));
      return origCamp(...args);
    };
  };
  window.__patchTimer = setInterval(patch, 200);
});
await page.waitForTimeout(800);
await page.evaluate(async () => { await window.__ddScene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'dbg2:enter' }); });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const res = { playerIds: [] };
  const snap = label => res.playerIds.push({ label, id: scene.playerEntity?.id, campLaid: scene.gameLoader?.blackboard?.get?.('storyState')?.s02CampLaid ?? null });
  snap('after-enter');
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd2:fainted', payload: { definitionId: 'story.s02.beg.fainted' } });
  await sleep(2500);
  snap('after-fainted');
  scene.gameLoader?.triggerSystem?.fire?.('dialogueChoice', { id: 'dialogue.s02.prologue', choiceId: 'save' });
  await sleep(2000);
  snap('after-save');
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  t.position.x = 620 + (offset.x || 0);
  t.position.y = 350 + (offset.y || 0);
  await sleep(2500);
  scene.gameLoader?.triggerSystem?.fire?.('enterRegion', { regionId: 'S02-camp-rescue' });
  await sleep(4000);
  snap('after-awakening');
  await sleep(13000);
  snap('porridge-mid');
  // 玩家进招募区 + executeInteractBinding（修正后的招募方式）
  t.position.x = 850 + (offset.x || 0);
  t.position.y = 370 + (offset.y || 0);
  await sleep(600);
  res.exec1 = await scene._sceneTriggerBindings?.executeInteractBinding?.('S02-binding-recruit') ?? 'NO-API';
  await sleep(1200);
  snap('after-tick1');
  for (let i = 0; i < 4; i++) {
    await scene._sceneTriggerBindings?.executeInteractBinding?.('S02-binding-recruit');
    await sleep(800);
  }
  snap('after-tick5');
  await sleep(9000);
  snap('after-camp-window');
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

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
 * probe-s02-debug.mjs —— S02 招募/possess 时序诊断。
 * 前置：dev server 3000 端口。
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
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 400);
});
await page.waitForTimeout(800);
await page.evaluate(async () => { await window.__ddScene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'dbg:enter' }); });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const res = {};
  // 1. 昏迷 → 救 → 抵营（快速复刻主探针 B/C）
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'dbg:fainted', payload: { definitionId: 'story.s02.beg.fainted' } });
  await sleep(2500);
  scene.gameLoader?.triggerSystem?.fire?.('dialogueChoice', { id: 'dialogue.s02.prologue', choiceId: 'save' });
  await sleep(2000);
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  t.position.x = 620 + (offset.x || 0);
  t.position.y = 350 + (offset.y || 0);
  await sleep(2500);
  scene.gameLoader?.triggerSystem?.fire?.('enterRegion', { regionId: 'S02-camp-rescue' });
  await sleep(5000);
  res.storyAfterC = scene.gameLoader?.blackboard?.get?.('storyState');
  // 2. 绑定清单
  const bindings = scene._sceneTriggerBindings?.bindings || [];
  res.bindings = bindings.map(b => ({ id: b?.id, triggerId: b?.triggerId, event: b?.event, active: scene._sceneTriggerBindings?._isBindingActive?.(b) }));
  // 3. 招募交互一次（详查返回值）
  res.executeResult = await scene._sceneTriggerBindings?.executeInteractBinding?.('S02-binding-recruit') ?? 'NO-API';
  await sleep(1200);
  res.storyAfterTick1 = scene.gameLoader?.blackboard?.get?.('storyState');
  // 4. triggerSystem fired 记录
  const ts = scene.gameLoader?.triggerSystem;
  res.firedS02 = (ts?._firedOnce ? [...ts._firedOnce] : []).filter(id => id.includes('s02'));
  res.recruitTrigger = ts?.getById?.('trg_s02_recruit') ? { id: 'exists' } : null;
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

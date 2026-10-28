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
 * probe-s02-debug8.mjs —— 裸进 S02 玩家身份逐秒快照（定位提前附身时机）。
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
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 500);
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const patch = () => {
    const gw = window.__ddScene?.sceneRuntime?.commandGateway;
    if (!gw || gw.__possessPatched) return;
    gw.__possessPatched = true;
    const orig = gw.execute.bind(gw);
    gw.execute = cmd => {
      const op = cmd?.payload?.operation;
      if (op === 'army.possess' || op === 'army.camp') {
        console.log(`[GW-STACK] ${op}\n` + String(new Error().stack).split('\n').slice(1, 14).join('\n'));
      }
      return orig(cmd);
    };
  };
  window.__pt = setInterval(patch, 150);
});
page.on('console', m => { const t = m.text(); if (t.includes('[GW-STACK]') || t.includes('[PROBE-POSSESS]')) console.log(t.slice(0, 1800)); });
const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const res = { snaps: [] };
  const snap = label => res.snaps.push({
    label,
    id: scene.playerEntity?.id,
    name: scene.playerEntity?.name,
    maxHp: scene.playerEntity?.getComponent?.('stats')?.maxHp,
    campLaid: scene.gameLoader?.blackboard?.get?.('storyState')?.s02CampLaid ?? null
  });
  snap('S01-pre');
  await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd8:enter' });
  for (let i = 1; i <= 8; i++) {
    await sleep(1000);
    snap('S02+' + i + 's');
  }
  const coord = scene.s02ArmyRescueCoordinator;
  res.zhangjiaoEntityExists = !!coord?._zhangjiaoEntity;
  res.firedS02 = (scene.gameLoader?.triggerSystem?._firedOnce ? [...scene.gameLoader.triggerSystem._firedOnce] : []).filter(id => id.includes('s02'));
  const ts = scene.gameLoader?.triggerSystem;
  const expr = ts?.expr;
  res.exprProbe = {
    hasBlackboard: !!expr?.ctx?.blackboard,
    blackboardSame: expr?.ctx?.blackboard === scene.gameLoader?.blackboard,
    getVar: expr?._getVar?.('story.s02CampLaid'),
    evalAnd: expr?.eval?.({ op: 'and', args: [{ name: 'story.s02CampLaid', op: 'var' }, { name: 'story.s02OvernightDone', op: 'var' }] }),
    storyKeys: Object.keys(scene.gameLoader?.blackboard?.get?.('storyState') || {}).filter(k => k.startsWith('s02')),
    rawGet: scene.gameLoader?.blackboard?.get?.('story.s02CampLaid')
  };
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-10-30
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

/**
 * probe-s02-debug10.mjs —— 复刻 mission-chain 的 interval 环境，抓提前附身完整调用栈。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { const t = m.text(); if (t.includes('[PROBE-POSSESS]')) console.log('===== ' + t.slice(0, 2600)); });
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
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 500);
});
await page.waitForTimeout(800);
const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const res = { timeline: [] };
  const snap = label => res.timeline.push({ label, id: scene.playerEntity?.id });
  await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd10:enter' });
  for (let i = 1; i <= 8; i++) {
    await sleep(400);
    snap('S02+' + (i * 400) + 'ms');
  }
  res.firedS02 = (scene.gameLoader?.triggerSystem?._firedOnce ? [...scene.gameLoader.triggerSystem._firedOnce] : []).filter(id => id.includes('s02'));
  res.story = Object.fromEntries(Object.entries(scene.gameLoader?.blackboard?.get?.('storyState') || {}).filter(([k]) => k.startsWith('s02')));
  // 附身已发生：深挖求值环境
  const ts = scene.gameLoader?.triggerSystem;
  const expr = ts?.expr;
  res.deepProbe = {
    exprCtxBoardSameAsGameLoader: expr?.ctx?.blackboard === scene.gameLoader?.blackboard,
    exprCtxBoardType: expr?.ctx?.blackboard?.constructor?.name || String(expr?.ctx?.blackboard),
    gameLoaderBoardVarsCampLaid: scene.gameLoader?.blackboard?._vars?.['story.s02CampLaid'],
    exprBoardGetStoryState: expr?.ctx?.blackboard?.get?.('storyState'),
    exprEvalCampLaid: expr?.eval?.({ op: 'var', name: 'story.s02CampLaid' }),
    exprEvalRaidFight: expr?.eval?.({ op: 'var', name: 'story.s02RaidFight' }),
    exprEvalFullAnd: expr?.eval?.({
      op: 'and',
      args: [
        { op: 'var', name: 'story.s02CampLaid' },
        { op: 'var', name: 'story.s02OvernightDone' },
        { op: 'var', name: 'story.s02RaidFight' },
        { op: 'not', arg: { op: 'var', name: 'story.s02RaidRepeled' } }
      ]
    }),
    exprCtxKeys: Object.keys(expr?.ctx || {})
  };
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();

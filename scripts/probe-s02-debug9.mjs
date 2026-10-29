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
 * probe-s02-debug9.mjs —— 进村即附身根因定位：
 * ①boot 后（S01 阶段）dump storyState 全量 s02 事实；
 * ②页内直接求值 possession_restore 四条件表达式；
 * ③teleport 进 S02 前后逐 500ms 快照玩家身份（抓附身时刻）。
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
const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const res = {};
  const story = scene.gameLoader?.blackboard?.get?.('storyState') || {};
  res.s01Phase = {
    currentSceneId: story.currentSceneId,
    s02Facts: Object.fromEntries(Object.entries(story).filter(([k]) => k.startsWith('s02'))),
    rawGetCampLaid: scene.gameLoader?.blackboard?.get?.('story.s02CampLaid')
  };
  const expr = scene.gameLoader?.triggerSystem?.expr;
  res.exprProbe = {
    hasExpr: !!expr,
    evalCampLaid: expr?.eval?.({ op: 'var', name: 'story.s02CampLaid' }),
    evalOvernight: expr?.eval?.({ op: 'var', name: 'story.s02OvernightDone' }),
    evalRaidFight: expr?.eval?.({ op: 'var', name: 'story.s02RaidFight' }),
    evalNotRepeled: expr?.eval?.({ op: 'not', arg: { op: 'var', name: 'story.s02RaidRepeled' } }),
    evalFullAnd: expr?.eval?.({
      op: 'and',
      args: [
        { op: 'var', name: 'story.s02CampLaid' },
        { op: 'var', name: 'story.s02OvernightDone' },
        { op: 'var', name: 'story.s02RaidFight' },
        { op: 'not', arg: { op: 'var', name: 'story.s02RaidRepeled' } }
      ]
    })
  };
  // 进 S02 前后逐 500ms 快照身份
  res.idTimeline = [];
  const snap = label => res.idTimeline.push({ label, id: scene.playerEntity?.id, plotDowned: scene.playerEntity?.plotDowned ?? null });
  snap('pre-teleport');
  await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd9:enter' });
  for (let i = 1; i <= 10; i++) {
    await sleep(500);
    snap('S02+' + (i * 500) + 'ms');
  }
  const ts = scene.gameLoader?.triggerSystem;
  res.firedRestore = (ts?._firedOnce ? [...ts._firedOnce] : []).filter(id => id.includes('s02'));
  res.storyAfter = Object.fromEntries(Object.entries(scene.gameLoader?.blackboard?.get?.('storyState') || {}).filter(([k]) => k.startsWith('s02')));
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();

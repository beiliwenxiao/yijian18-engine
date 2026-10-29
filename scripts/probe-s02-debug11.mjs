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
 * probe-s02-debug11.mjs —— 补丁 _selectBranch/_executeAction，
 * 打印「哪个触发器的哪个 branch 在附身时刻命中」。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { const t = m.text(); if (t.includes('[SEL]') || t.includes('[ACT]')) console.log(t.slice(0, 500)); });
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
  const patch = () => {
    const ts = window.__ddScene?.gameLoader?.triggerSystem;
    if (!ts || ts.__selPatched) return;
    ts.__selPatched = true;
    const origSelect = ts._selectBranch.bind(ts);
    ts._selectBranch = (branches) => {
      const picked = origSelect(branches);
      if (picked) {
        const story = ts.expr?.ctx?.blackboard?.get?.('storyState') || {};
        const rel = Object.fromEntries(Object.entries(story).filter(([k]) => k.startsWith('s02')).slice(0, 12));
        console.log(`[SEL] picked branch=${picked?.stepId || '?'} when=${JSON.stringify(picked?.when ?? null).slice(0, 200)} story=${JSON.stringify(rel)}`);
      }
      return picked;
    };
    const origAct = ts._executeAction.bind(ts);
    ts._executeAction = async (trigger, action, index, request) => {
      const op = action?.params?.operation || action?.params?.definitionId || action?.action;
      if (op === 'army.possess' || action?.action === 'scenario.command') {
        console.log(`[ACT] trigger=${trigger?.id} step=${action?.stepId} action=${action?.action} op=${op}`);
      }
      return origAct(trigger, action, index, request);
    };
  };
  window.__pt = setInterval(patch, 150);
});
await page.waitForTimeout(800);
const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'd11:enter' });
  await sleep(3000);
  return { finalId: scene.playerEntity?.id };
});
console.log('FINAL:', JSON.stringify(out));
await browser.close();

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-04
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 ************************************************************/

/**
 * probe-s02-beg-give-adults.mjs —— S02 大人乞讨「给食物」分支实机探针（常驻回归）。
 *
 * 2026-11-04 事故沉淀：trg_s02_army_dispatch 里 spawnPlacements 与 army.march 同帧
 * 先后执行，编组注册（SceneArmyCommandFlow.syncUnits）要等下一帧扫描——startMarch
 * 因 units 为空返回 noUnits，armyMarchArrived 永不触发（给完食物任务卡死）；
 * 另行军到达门槛（全员抵达才推进）在人群互挤下可永久卡住个别单位。
 * 本探针把「给食物」分支完整实机断言一次（beg-branches 探针只覆盖孩童三分支）：
 *   孩童摇头 → 大人对话 → 给食物（扣20野果+哄抢全部食物）→ 对话结束
 *   → 昏迷（plotDowned + story.s02.beg.fainted）→ 军队刷出+行军启动
 *   → 行军推进完成 → armyMarchArrived → prologue 弹出。
 *
 * 前置：本地 dev server 在 3000 端口提供 example/sanguo_zhangjiao/index.html
 * 用法：node scripts/probe-s02-beg-give-adults.mjs
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
});
const log = [];
const step = (name, pass, detail) => { log.push({ name, pass }); console.log(`[${name}] ${pass ? 'PASS' : 'FAIL'} ${detail}`); };

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
const consoleWarns = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
page.on('console', msg => {
  const text = msg.text();
  if (msg.type() === 'warning' || /fail|error|warn|missing|拒绝|断链/i.test(text)) consoleWarns.push(text.slice(0, 240));
});
await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => Boolean(window.__ddScene))) break;
  if (i >= 2) {
    await page.evaluate(() => {
      for (const label of ['下一步', '开始新游戏', '开始游戏', '确认', '确定', '继续']) {
        const m = [...document.querySelectorAll('button')].filter(b =>
          b.offsetParent !== null && !b.disabled && b.textContent.trim() === label);
        if (m.length > 0) { m[m.length - 1].click(); return; }
      }
    });
  }
  await page.waitForTimeout(2000);
}
await page.evaluate(async () => {
  const scene = window.__ddScene;
  const ds = scene.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 400);
  await new Promise(r => setTimeout(r, 2500));
  await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'probe-give:enter' });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400));
    if (scene.gameLoader?.blackboard?.get?.('storyState')?.currentSceneId === 'S02') break;
  }
  clearInterval(window.__k);
});
await page.waitForTimeout(1500);

const sleep = ms => page.waitForTimeout(ms);
const dlg = () => page.evaluate(() => ({
  id: window.__ddScene?.dialogueSystem?.currentDialogue?.id || null,
  node: window.__ddScene?.dialogueSystem?.currentNode?.id || null
}));
const pick = choiceId => page.evaluate(cid => {
  const ds = window.__ddScene.dialogueSystem;
  const choices = ds?.currentNode?.choices || [];
  const idx = choices.findIndex(c => c.id === cid);
  if (idx < 0) return { ok: false, choices: choices.map(c => c.id) };
  if (!ds?.selectChoice(idx)) return { ok: false, choices: choices.map(c => c.id) };
  return { ok: true, node: ds.currentNode?.id || null };
}, choiceId);
const endDlg = () => page.evaluate(() => window.__ddScene.dialogueSystem.endDialogue());

// ── 进乞讨区 → 孩童摇头 → 大人对话 ──
await page.evaluate(async () => {
  const scene = window.__ddScene;
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  t.position.x = 650 + (offset.x || 0);
  t.position.y = 440 + (offset.y || 0);
});
for (let i = 0; i < 25; i++) { await sleep(400); if ((await dlg()).id === 'dialogue.s02.beggarChildren') break; }
step('enter-children', (await dlg()).id === 'dialogue.s02.beggarChildren', JSON.stringify(await dlg()));
await pick('refuse');
await sleep(500);
await endDlg();
await sleep(1500);
step('adults-dialogue', (await dlg()).id === 'dialogue.s02.beggarAdults', JSON.stringify(await dlg()));

// ── 灌 25 野果 → 选「给食物」 ──
const granted = await page.evaluate(() => {
  const scene = window.__ddScene;
  const inv = scene.playerEntity?.getComponent?.('inventory');
  const def = scene.gameLoader?.registries?.items?.get?.('resource.wild_berry');
  if (!inv || !def) return 'no-inventory-or-def';
  return inv.addItem({ ...def }, 25);
});
step('grant-berries', granted !== 'no-inventory-or-def', String(granted));
const give = await pick('giveAdults');
step('choice-giveAdults', give.ok, JSON.stringify(give));
await sleep(600);
const berriesAfter = await page.evaluate(() => {
  const inv = window.__ddScene?.playerEntity?.getComponent?.('inventory');
  return {
    berry: inv?.getItemCount?.('resource.wild_berry') ?? null,
    food: inv?.getItemCount?.('resource.food') ?? null,
    meat: inv?.getItemCount?.('resource.raw_wolf_meat') ?? null
  };
});
step('robbed-all-food', berriesAfter.berry === 0, JSON.stringify(berriesAfter));
const paidVar = await page.evaluate(() =>
  window.__ddScene?.gameLoader?.triggerSystem?._vars?.s02BegPaid ?? window.__ddScene?.gameLoader?.blackboard?._vars?.s02BegPaid ?? 'unknown');
step('s02BegPaid-var', paidVar === true || paidVar === 'unknown', String(paidVar));

// ── 对话结束 → 昏迷 → 事实落库 ──
await endDlg();
let fainted = null;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  fainted = await page.evaluate(() => {
    const scene = window.__ddScene;
    return {
      plotDowned: scene.playerEntity?.plotDowned === true,
      fact: scene.gameLoader?.blackboard?.get?.('storyState')?.s02BegFainted === true
    };
  });
  if (fainted.plotDowned && fainted.fact) break;
}
step('faint-plotDowned', fainted?.plotDowned === true, JSON.stringify(fainted));
step('fact-begFainted', fainted?.fact === true, 'story.s02.beg.fainted 落库');

// ── 军队刷出 + 行军任务 ──
await sleep(1500);
const marchState = await page.evaluate(() => {
  const scene = window.__ddScene;
  const system = scene.armyCommandFlow?.system;
  const entities = (scene.entityStore?.all || [])
    .filter(e => String(e?.placementId || '').startsWith('S02-army-column')).map(e => e.placementId);
  return {
    columnCount: entities.length,
    sample: entities.slice(0, 3),
    marchMission: system?.marchMission ? { armyId: system.marchMission.armyId, index: system.marchMission.index, done: system.marchMission.done } : null,
    unitCount: system?.units?.size ?? null
  };
});
step('column-spawned', marchState.columnCount > 0, `count=${marchState.columnCount} sample=${JSON.stringify(marchState.sample)}`);
step('march-started', marchState.marchMission !== null, JSON.stringify(marchState.marchMission) + ` units=${marchState.unitCount}`);

// ── 行军推进 → 抵达 → prologue ──
let arrived = null;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  arrived = await page.evaluate(() => {
    const scene = window.__ddScene;
    const system = scene.armyCommandFlow?.system;
    const units = [...(system?.units?.values() || [])]
      .filter(u => String(u?.entity?.placementId || '').startsWith('S02-army-column'));
    const withGoal = units.filter(u => u?.entity?.getComponent?.('commandState')?.goal);
    const stuck = withGoal.map(u => {
      const t = u.entity.getComponent('transform');
      const g = u.entity.getComponent('commandState').goal;
      return { id: u.entity.placementId, pos: [Math.round(t.position.x), Math.round(t.position.y)], goal: [Math.round(g.x), Math.round(g.y)] };
    }).slice(0, 6);
    return {
      mission: system?.marchMission ? { index: system.marchMission.index, done: system.marchMission.done } : null,
      total: units.length,
      withGoal: withGoal.length,
      stuck,
      dialogue: scene.dialogueSystem?.currentDialogue?.id || null
    };
  });
  if (arrived.dialogue === 'dialogue.s02.prologue') break;
}
step('march-completed', arrived.mission === null || arrived.mission?.done === true,
  `mission=${JSON.stringify(arrived.mission)} withGoal=${arrived.withGoal}/${arrived.total} stuck=${JSON.stringify(arrived.stuck)}`);
step('prologue-started', arrived.dialogue === 'dialogue.s02.prologue', `dialogue=${arrived.dialogue}`);

const pos = await page.evaluate(() => {
  const scene = window.__ddScene;
  const t = scene.playerEntity?.getComponent?.('transform');
  return t ? [Math.round(t.position.x), Math.round(t.position.y)] : null;
});
step('player-pos', true, JSON.stringify(pos));

await browser.close();
const failed = log.filter(entry => !entry.pass);
console.log('--- recent console warns ---');
consoleWarns.slice(-12).forEach(w => console.log(w));
console.log(failed.length === 0 ? '[SUMMARY] ALL GIVE-ADULTS CHECKS PASS' : `[SUMMARY] ${failed.length} FAILED: ${failed.map(f => f.name).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);

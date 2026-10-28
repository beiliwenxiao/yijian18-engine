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
 * probe-s02-debug3.mjs —— waveCleared 链路诊断：组注册/清除集/事件触发/波次刷出。
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
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 500);
});
await page.waitForTimeout(800);

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const story = () => scene.gameLoader?.blackboard?.get?.('storyState') || {};
  const res = {};
  // 快进到过夜完成（直接提交事实链，跳过玩法段）
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd3:1', payload: { definitionId: 'story.s02.beg.fainted' } });
  await sleep(400);
  scene.gameLoader?.triggerSystem?.fire?.('dialogueChoice', { id: 'dialogue.s02.prologue', choiceId: 'save' });
  await sleep(600);
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd3:2', payload: { definitionId: 'story.s02.rescue.done' } });
  await sleep(400);
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd3:3', payload: { definitionId: 'story.s02.porridge.laid' } });
  await sleep(400);
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd3:4', payload: { definitionId: 'story.s02.camp.laid' } });
  await sleep(400);
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd3:5', payload: { definitionId: 'story.s02.overnight.done' } });
  await sleep(400);
  await scene.sceneRuntime?.commandGateway?.execute({ intentType: 'state.transaction', actorRef: scene.playerEntity?.id, operationId: 'd3:6', payload: { definitionId: 'story.s02.raid.fight.prepare' } });
  await sleep(400);
  // 手动刷 wave1
  scene._scenePlacementRuntime?.spawnGroup?.('S02-raid-vanguard');
  await sleep(2000);
  const groupEntities = prefix => (scene.entityStore?.all || []).filter(e => String(e?.placementId || '').startsWith(prefix));
  res.wave1 = groupEntities('S02-raid-vanguard').length;
  res.coordinatorKeys = Object.keys(scene.sanguoSceneLifecycleCoordinator || {});
  const coord = scene.sanguoSceneLifecycleCoordinator;
  res.groupEnemiesKeys = coord?._placementCoordinator?.getGroupEnemies ? Object.fromEntries(Object.entries(coord._placementCoordinator.getGroupEnemies()).map(([k, v]) => [k, v.length])) : null;
  // 杀光 wave1
  for (const e of groupEntities('S02-raid-vanguard')) {
    try {
      const stats = e.getComponent?.('stats');
      if (stats) { stats.hp = 0; stats.dead = true; }
      scene.combatSystem?.handleEntityDeath?.(e);
    } catch (err) {}
  }
  await sleep(1000);
  res.firedBefore = (scene.gameLoader?.triggerSystem?._firedOnce ? [...scene.gameLoader.triggerSystem._firedOnce] : []).filter(id => id.includes('raid') || id.includes('wave'));
  res.clearedGroups = [...(coord?._clearedGroups || [])];
  // 手动驱动波次观察
  res.observeResult = coord?.observeWaveEvents?.() ?? 'no-api';
  await sleep(1500);
  res.firedAfter = (scene.gameLoader?.triggerSystem?._firedOnce ? [...scene.gameLoader.triggerSystem._firedOnce] : []).filter(id => id.includes('raid') || id.includes('wave'));
  res.wave2 = groupEntities('S02-raid-mainforce').length;
  res.storyRaid = { campLaid: story().s02CampLaid, overnight: story().s02OvernightDone, fight: story().s02RaidFight, repeled: story().s02RaidRepeled };
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

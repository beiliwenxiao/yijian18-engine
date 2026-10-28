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
 * probe-s02-mission-chain.mjs —— S02 M3.5 系列任务实机走链探针。
 *
 * 前置：本地 dev server 在 3000 端口提供 example/sanguo_zhangjiao/index.html
 * 链路：进村惨状 → 军队路过（seed 昏迷）→ 抉择救人 → 救援抵营 → 施粥五批
 *       → 招兵旗招募（区域内交互）→ 百人成军扎营 → 过夜 → 翌日围城 wave1
 *       → wave2+傅燮 → 击退释放
 *
 * 用法：node scripts/probe-s02-mission-chain.mjs
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
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
// 对话自动推进（dialogueEnd 正常派发→触发器链继续）
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 500);
});
await page.waitForTimeout(800);

const log = [];
const step = (name, detail) => { log.push({ name, detail }); console.log(`[${name}] ${detail}`); };

/* ============ 进入 S02 ============ */
step('teleport', await page.evaluate(async () => {
  const scene = window.__ddScene;
  const r = await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'probe:s02-enter' });
  return JSON.stringify({ ok: r?.ok, code: r?.code || r?.errors?.[0]?.code || null });
}));
await page.waitForTimeout(3000);

/* ============ A 进村惨状 ============ */
const phaseA = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const placements = scene.context?.services?.placements;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = { checks: [], protagonistId: scene.playerEntity?.id || null };
  const check = (name, pass, detail) => out.checks.push({ name, pass, detail });
  const live = id => placements?.inspectPlacement?.(id)?.live ?? null;
  // 对冲非确定性的提前附身（读档恢复重放）：回归链路测试前先释放回主角
  try {
    if (scene.playerEntity?.id === 'zhangjiao-possessed') scene.s02ArmyRescueCoordinator?.releaseCommander?.();
  } catch (e) {}
  await sleep(600);

  check('sceneId', scene.gameLoader?.blackboard?.get?.('storyState')?.currentSceneId === 'S02',
    String(scene.gameLoader?.blackboard?.get?.('storyState')?.currentSceneId));
  await sleep(1200);
  const villagerIds = ['S02-villager-calm-1','S02-villager-calm-2','S02-villager-calm-3','S02-villager-calm-4','S02-villager-calm-5','S02-villager-calm-6'];
  const villagerLive = villagerIds.map(id => live(id));
  check('villagers-6-spawned', villagerLive.every(v => v !== 0 && v !== null), JSON.stringify(villagerLive));
  const digEntities = (scene.entityStore?.all || []).filter(e => /S02-villager-dig-\d/.test(String(e?.placementId || '')));
  check('wandering-dig-villagers-removed', digEntities.length === 0, `dig 实体=${digEntities.length}`);
  const children = ['S02-beg-child-1','S02-beg-child-2','S02-beg-child-3'].map(live);
  check('beg-children-3', children.every(v => v !== 0 && v !== null), JSON.stringify(children));
  const terrains = scene._terrains || (scene.terrain ? [scene.terrain] : []);
  const depthImages = terrains.reduce((n, t) => n + (t?._depthSortedImages?.length || 0), 0);
  check('tree-ring-rendered', depthImages >= 30, `depthSorted=${depthImages}`);
  // 粮车 placement 已登记（begFainted 门控，B 阶段提交后生成）
  const carts = ['S02-grain-cart-1','S02-grain-cart-2'].map(id => live(id));
  check('grain-cart-placements-registered', carts.every(v => v !== null), JSON.stringify(carts));
  check('protagonist-not-possessed', scene.playerEntity?.id !== 'zhangjiao-possessed', String(scene.playerEntity?.id));
  return out;
});
for (const c of phaseA.checks) step('A:' + c.name, `${c.pass ? 'PASS' : 'FAIL'} ${c.detail}`);

/* ============ B 军队路过 + 抉择 ============ */
step('B:commit-fainted', await page.evaluate(async () => {
  const scene = window.__ddScene;
  const r = await scene.sceneRuntime?.commandGateway?.execute({
    intentType: 'state.transaction',
    actorRef: scene.playerEntity?.id,
    operationId: 'probe:beg-fainted',
    payload: { definitionId: 'story.s02.beg.fainted' }
  });
  return JSON.stringify({ ok: r?.ok, code: r?.code || null });
}));
await page.waitForTimeout(2500);
const armySpawn = await page.evaluate(() => {
  const scene = window.__ddScene;
  const army = (scene.entityStore?.all || []).filter(e => String(e?.placementId || '').startsWith('S02-army-column'));
  const carts = (scene.entityStore?.all || []).filter(e => String(e?.placementId || '').startsWith('S02-grain-cart'));
  return { believerEntities: army.length, isBeliever: army[0]?.name === '黄巾信众', grainCarts: carts.length };
});
step('B:believers-20+2carts', JSON.stringify(armySpawn));
await page.waitForTimeout(6000);
// 抉择：救他（对话可能已被自动结束，直接补发 dialogueChoice 事件）
step('B:choose-save', await page.evaluate(async () => {
  const scene = window.__ddScene;
  scene.gameLoader?.triggerSystem?.fire?.('dialogueChoice', { id: 'dialogue.s02.prologue', choiceId: 'save' });
  await new Promise(r => setTimeout(r, 1500));
  const story = scene.gameLoader?.blackboard?.get?.('storyState') || {};
  return JSON.stringify({ choice: story.s02ZhangjiaoChoice || null });
}));

/* ============ C 救援抵营 → 苏醒 → 施粥开启 ============ */
step('C:goto-goal', await page.evaluate(async () => {
  const scene = window.__ddScene;
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  if (!t) return 'no-transform';
  t.position.x = 620 + (offset.x || 0);
  t.position.y = 350 + (offset.y || 0);
  await new Promise(r => setTimeout(r, 2500));
  const story = scene.gameLoader?.blackboard?.get?.('storyState') || {};
  if (!story.s02Rescued) {
    scene.gameLoader?.triggerSystem?.fire?.('enterRegion', { regionId: 'S02-camp-rescue' });
    await new Promise(r => setTimeout(r, 1500));
  }
  return JSON.stringify({ rescued: !!scene.gameLoader?.blackboard?.get?.('storyState')?.s02Rescued });
}));
await page.waitForTimeout(4000); // 苏醒对话（自动）→ farewell 施粥链

/* ============ D 施粥五批 ============ */
const porridge = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const story = () => scene.gameLoader?.blackboard?.get?.('storyState') || {};
  const groupCount = prefix => (scene.entityStore?.all || []).filter(e => e?.placementId === prefix && e?.isDead !== true && e?.getComponent?.('stats')?.dead !== true && (e?.getComponent?.('stats')?.hp ?? 1) > 0).length;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = { checks: [] };
  const check = (name, pass, detail) => out.checks.push({ name, pass, detail });

  await sleep(2000);
  check('porridge-laid', story().s02PorridgeLaid === true, String(story().s02PorridgeLaid));
  // M3.6 受伤 debuff：severe 档（HP 上限 ×0.75、移速 ×0.85）
  const pStats = scene.playerEntity?.getComponent?.('stats');
  const woundBase = scene.playerEntity?._woundBaseStats;
  check('wound-severe-applied', story().s02Wounded === 'severe'
    && woundBase && pStats?.maxHp === Math.round(woundBase.maxHp * 0.75)
    && pStats?.speed === Math.round(woundBase.speed * 0.85),
  `tier=${story().s02Wounded} maxHp=${pStats?.maxHp}/base${woundBase?.maxHp} speed=${pStats?.speed}/base${woundBase?.speed}`);
  check('cauldron-spawned', groupCount('S02-porridge-cauldron') >= 1, String(groupCount('S02-porridge-cauldron')));
  const batchIds = n => {
    const base = (n - 1) * 5;
    return [1, 2, 3, 4, 5].map(k => `S02-porridge-queue-${base + k}`);
  };
  const byId = ids => ids.map(id => groupCount(id)).reduce((a, b) => a + b, 0);
  // 轮询等待（链路含对话延迟，固定 sleep 会错位）
  const poll = async (fn, timeoutMs, intervalMs = 1000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) { last = fn(); if (last) return true; await sleep(intervalMs); }
    return false;
  };
  const b1 = byId(batchIds(1));
  check('batch1-live-5', b1 === 5, String(b1));
  const batch1Gone = await poll(() => byId(batchIds(1)) === 0 && byId(batchIds(2)) === 5, 35000);
  check('batch1-gone-batch2-live', batch1Gone, `b1=${byId(batchIds(1))} b2=${byId(batchIds(2))}`);
  const batch4Live = await poll(() => byId(batchIds(4)) === 5, 45000);
  check('batch4-live', batch4Live, String(byId(batchIds(4))));
  const queueLive = await poll(() => groupCount('S02-recruit-queue-1') + groupCount('S02-recruit-queue-2') + groupCount('S02-recruit-queue-3') + groupCount('S02-recruit-queue-4') === 4, 45000);
  check('queue-spawned-4', queueLive, String(groupCount('S02-recruit-queue-1') + groupCount('S02-recruit-queue-2') + groupCount('S02-recruit-queue-3') + groupCount('S02-recruit-queue-4')));
  return out;
});
for (const c of porridge.checks) step('D:' + c.name, `${c.pass ? 'PASS' : 'FAIL'} ${c.detail}`);

/* ============ E 招募×5 → 百人成军 → 扎营 → 过夜 ============ */
const recruit = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const story = () => scene.gameLoader?.blackboard?.get?.('storyState') || {};
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = { checks: [], ticks: [] };
  const check = (name, pass, detail) => out.checks.push({ name, pass, detail });

  // 玩家走进招兵区（区域内交互才能命中绑定）；每轮钉回位置（批组村民碰撞挤推会顶出区域）
  const pinRecruitZone = async () => {
    t.position.x = 850 + (offset.x || 0);
    t.position.y = 370 + (offset.y || 0);
    await sleep(600);
  };
  await pinRecruitZone();
  for (let i = 0; i < 10 && story().s02RecruitDone !== true; i++) {
    await pinRecruitZone();
    const r = scene._sceneTriggerBindings?.executeInteractBinding?.('S02-binding-recruit');
    out.ticks.push({ i: i + 1, handled: r?.handled, accepted: r?.accepted, count: story().s02RecruitCount ?? 0 });
    await sleep(1200);
  }
  check('recruit-count-50', story().s02RecruitCount === 50, String(story().s02RecruitCount));
  check('recruit-done', story().s02RecruitDone === true, String(story().s02RecruitDone));
  await sleep(2000);
  const recruits = (scene.entityStore?.all || []).filter(e => String(e?.placementId || '').startsWith('S02-army-recruits'));
  check('recruit-soldiers-10', recruits.length === 10, String(recruits.length));
  // 扎营倒计时 4s + 装饰 + 过夜对话（自动）→ 翌日围城
  await sleep(11000);
  check('camp-laid', story().s02CampLaid === true, String(story().s02CampLaid));
  const campDecor = ['S02-camp-fire','S02-camp-hut-1'].map(id => {
    const r = scene.context?.services?.placements?.inspectPlacement?.(id);
    return r ? (r.live ? 1 : 0) : null;
  });
  check('camp-decor-spawned', campDecor.every(v => v === 1), JSON.stringify(campDecor));
  await sleep(3000);
  check('overnight-done', story().s02OvernightDone === true, String(story().s02OvernightDone));
  return out;
});
for (const c of recruit.checks) step('E:' + c.name, `${c.pass ? 'PASS' : 'FAIL'} ${c.detail} ticks=${JSON.stringify(recruit.ticks)}`);

/* ============ F 围剿战 ============ */
const raid = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const story = () => scene.gameLoader?.blackboard?.get?.('storyState') || {};
  const store = scene.entityStore;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const out = { checks: [] };
  const check = (name, pass, detail) => out.checks.push({ name, pass, detail });
  const groupEntities = id => (store?.all || []).filter(e => e?.placementId === id && e?.isDead !== true && e?.getComponent?.('stats')?.dead !== true && (e?.getComponent?.('stats')?.hp ?? 1) > 0);
  const killAll = ents => {
    for (const e of ents) {
      try {
        const stats = e.getComponent?.('stats');
        if (stats) { stats.hp = 0; stats.dead = true; }
        scene.combatSystem?.handleEntityDeath?.(e);
      } catch (err) {}
    }
  };

  await sleep(500);
  // wave1 刷出即接战（活战场）：峰值轮询取最大同时存活数，>=12 即全量刷出
  const wave1Ids = Array.from({ length: 12 }, (_, i) => `S02-raid-vanguard-${i + 1}`);
  let wave1Peak = 0;
  const w1PeakDeadline = Date.now() + 5000;
  while (Date.now() < w1PeakDeadline) {
    wave1Peak = Math.max(wave1Peak, wave1Ids.map(id => groupEntities(id)[0]).filter(Boolean).length);
    if (wave1Peak >= 12) break;
    await sleep(500);
  }
  check('wave1-12-spawned', wave1Peak >= 12, `peak=${wave1Peak}`);
  check('possess-zhangjiao', scene.playerEntity?.id === 'zhangjiao-possessed', String(scene.playerEntity?.id));
  check('protagonist-spectating', scene.playerDowned === true || (scene.entityStore?.all || []).some(e => e?.id === 'female-hero' && e?.plotDowned === true), `playerDowned=${scene.playerDowned}`);
  const w1 = wave1Ids.map(id => groupEntities(id)[0]).filter(Boolean);
  killAll(w1);
  // waveCleared → wave2（placement id 是 S02-raid-main-N，组名才是 mainforce）
  const wave2Ids = [...Array.from({ length: 12 }, (_, i) => `S02-raid-main-${i + 1}`), 'S02-raid-commander'];
  let w2 = [];
  const wave2Deadline = Date.now() + 15000;
  while (Date.now() < wave2Deadline) {
    w2 = wave2Ids.map(id => groupEntities(id)[0]).filter(Boolean);
    if (w2.length >= 13) break;
    await sleep(1000);
  }
  check('wave2-13-spawned', w2.length === 13, String(w2.length));
  check('wave2-fuxie-boss', w2.some(e => String(e?.name || '').includes('傅燮') || String(e?.templateId || '') === 'lu_commander'), JSON.stringify(w2.map(e => e?.name).slice(0, 14)));
  killAll(w2);
  const repeledDeadline = Date.now() + 10000;
  while (Date.now() < repeledDeadline && story().s02RaidRepeled !== true) await sleep(1000);
  check('raid-repeled', story().s02RaidRepeled === true, String(story().s02RaidRepeled));
  check('possession-released', scene.playerEntity?.id === 'female-hero', String(scene.playerEntity?.id));
  check('raid-clear', wave1Ids.concat(wave2Ids).every(id => groupEntities(id).length === 0), 'all raid entities cleared');
  // M3.6：围剿战全程带伤（debuff 窗口覆盖到 S09 治疗）
  check('wound-persists-after-raid', story().s02Wounded === 'severe' && !!scene.playerEntity?._woundBaseStats, String(story().s02Wounded));
  return out;
});
for (const c of raid.checks) step('F:' + c.name, `${c.pass ? 'PASS' : 'FAIL'} ${c.detail}`);

/* ============ 汇总 ============ */
const all = [...phaseA.checks, ...porridge.checks, ...recruit.checks, ...raid.checks];
const failed = all.filter(c => !c.pass);
step('protagonist-baseline', phaseA.protagonistId || 'unknown');
step('pageerrors', String(pageErrors.length) + (pageErrors.length ? ' -> ' + pageErrors.slice(0, 3).join(' | ') : ''));
step('SUMMARY', failed.length === 0 && pageErrors.length === 0
  ? `ALL ${all.length} CHECKS PASS`
  : `${failed.length}/${all.length} FAILED: ${failed.map(c => c.name).join(', ')}`);
await browser.close();
process.exit(failed.length === 0 && pageErrors.length === 0 ? 0 : 1);

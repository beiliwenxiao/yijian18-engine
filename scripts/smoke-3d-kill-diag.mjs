// 精确定位：战斗路径击杀后 checkWolfDeaths 是否卡死/抛错
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const executablePath = CANDIDATES.find(p => existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,800']
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto('http://127.0.0.1:3457/example/sanguo_zhangjiao_3d/index.html', { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);
  await page.evaluate(() => window.forceInit && window.forceInit());
  await sleep(4000);
  for (let i = 0; i < 25; i++) {
    const ok = await page.evaluate(() => !!window.__s01host?.projectData);
    if (ok) break; await sleep(1000);
  }
  for (let i = 0; i < 6; i++) { await page.keyboard.press(' '); await sleep(600); }
  await page.evaluate(() => {
    const h = window.__s01host;
    h.commitFact('story.s01.campfireLit');
    h.commitFact('story.s01.berriesGathered');
    h.commitFact('story.s01.berryEaten');
    h.commitFact('story.s01.axeFound');
    h.commitFact('story.s01.woodGathered');
    h.commitFact('story.s01.refuelCampfire');
    h.spawnPlacementsGroup('S01-first-wolf');
  });
  await sleep(2500);
  // 用战斗路径击杀（带击退，同真实挥击）
  const killResult = await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    const wt = wolf?.getComponent('transform');
    const pt = h.playerEntity.getComponent('transform');
    const dir = { x: Math.cos(1), y: Math.sin(1) };
    const r = h.combatSystem.applyDamage(wolf, 999, dir, '刺击100%');
    return {
      hp: wolf.getComponent('stats')?.hp,
      isDying: wolf.isDying,
      isDead: wolf.isDead,
      finalized: !!r,
      playerPos: { x: pt.position.x, y: pt.position.y },
      wolfPos: { x: wt.position.x, y: wt.position.y }
    };
  });
  console.log('[kill-via-combat] ' + JSON.stringify(killResult));
  await sleep(2500);
  const mid = await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    return {
      enemies: (h.enemyEntities || []).length,
      wolfHp: wolf ? wolf.getComponent('stats')?.hp : null,
      wolfDying: wolf ? wolf.isDying : null,
      wolfDead: wolf ? wolf.isDead : null,
      flags: [...h.storyFlags.keys()].filter(k => k.toLowerCase().includes('wolf')),
      carcass: (h.s01World?.spawnedPlacements || []).filter(r => (r.ref || '').includes('carcass')).length,
      loot: (h.pickupItems || []).map(i => i.id)
    };
  });
  console.log('[after-2.5s] ' + JSON.stringify(mid));
  // 手动调用并抓异常
  const manual = await page.evaluate(() => {
    const h = window.__s01host;
    try { h.checkWolfDeaths(); return 'ok'; } catch (e) { return 'THROW: ' + (e.stack || e.message).slice(0, 500); }
  });
  console.log('[manual] ' + manual);
  await sleep(1500);
  const fin = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      enemies: (h.enemyEntities || []).length,
      flags: [...h.storyFlags.keys()].filter(k => k.toLowerCase().includes('wolf')),
      carcass: (h.s01World?.spawnedPlacements || []).filter(r => (r.ref || '').includes('carcass')).length,
      loot: (h.pickupItems || []).map(i => i.id + '×' + (i.quantity || 1)),
      inv: h.playerEntity?.getComponent('inventory')?.getAllItems?.().map(({ slot }) => slot?.item?.id)
    };
  });
  console.log('[final] ' + JSON.stringify(fin, null, 1));
  console.log('[logs] ' + logs.filter(l => l.includes('狼') || l.includes('尸体') || l.includes('PAGEERROR') || l.includes('失败') || l.includes('loot') || l.includes('Loot')).slice(-12).join(' | '));
  await page.screenshot({ path: '.screenshots/diag-combat-kill.png' });
} finally { await browser.close(); }

// 死亡处理诊断：读取狼原始 hp，手动触发 checkWolfDeaths
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
  // 直接把狼打死（API 层面）
  const kill = await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    const st = wolf?.getComponent('stats');
    if (!st) return null;
    st.hp = 0;
    return { hp: st.hp, maxHp: st.maxHp, entitiesLen: h.enemyEntities.length };
  });
  console.log('[killed-via-api] ' + JSON.stringify(kill));
  await sleep(2000);
  const after = await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    const st = wolf?.getComponent('stats');
    return {
      entitiesLen: (h.enemyEntities || []).length,
      wolfHp: st ? st.hp : null,
      wolfAliveFlag: wolf ? wolf.isAlive : null,
      flagsWolf: [...h.storyFlags.keys()].filter(k => k.toLowerCase().includes('wolf')),
      carcass: (h.s01World?.spawnedPlacements || []).filter(r => (r.ref || '').includes('carcass')).length,
      inv: h.playerEntity?.getComponent('inventory')?.getAllItems?.().map(({ slot }) => slot?.item?.id)
    };
  });
  console.log('[after-2s] ' + JSON.stringify(after));
  // 手动调 checkWolfDeaths
  const manual = await page.evaluate(() => {
    const h = window.__s01host;
    try { h.checkWolfDeaths(); return 'ok'; } catch (e) { return 'ERR: ' + e.message; }
  });
  console.log('[manual-checkWolfDeaths] ' + manual);
  await sleep(1500);
  const after2 = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      entitiesLen: (h.enemyEntities || []).length,
      flagsWolf: [...h.storyFlags.keys()].filter(k => k.toLowerCase().includes('wolf')),
      carcass: (h.s01World?.spawnedPlacements || []).filter(r => (r.ref || '').includes('carcass')).length,
      inv: h.playerEntity?.getComponent('inventory')?.getAllItems?.().map(({ slot }) => slot?.item?.id),
      questIndex: h.quest?.index
    };
  });
  console.log('[after-manual] ' + JSON.stringify(after2));
  console.log('[logs] ' + logs.filter(l => l.includes('敌对') || l.includes('尸体') || l.includes('狼') || l.includes('PAGEERROR') || l.includes('失败')).slice(-12).join(' | '));
  await page.screenshot({ path: '.screenshots/diag-death.png' });
} finally { await browser.close(); }

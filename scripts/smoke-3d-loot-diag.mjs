// 掉落拾取验证：杀狼 → 尸体 → 狼皮/生狼肉 入包 + THREE 报错复查
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
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack ? e.stack.split('\n')[0] : e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto('http://127.0.0.1:3457/example/sanguo_zhangjiao_3d/index.html', { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => (window.__s01host?.quest?.index ?? -1) >= 0);
    if (ok) break;
    await page.evaluate(() => window.forceInit && window.forceInit()).catch(() => {});
    await sleep(1500);
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
  // 走到狼旁边（狼会主动贴身）→ API 击杀（同战斗路径 applyDamage）
  await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    const wt = wolf.getComponent('transform');
    const pt = h.playerEntity.getComponent('transform');
    pt.position.x = wt.position.x + 30;
    pt.position.y = wt.position.y + 10;
  });
  await sleep(500);
  await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    const dir = { x: 1, y: 0 };
    h.combatSystem.applyDamage(wolf, 999, dir, '刺击100%');
  });
  // 等待死亡结算 + 走过掉落物拾取
  await page.keyboard.down('w'); await sleep(300); await page.keyboard.up('w');
  await page.keyboard.down('s'); await sleep(400); await page.keyboard.up('s');
  await page.keyboard.down('a'); await sleep(300); await page.keyboard.up('a');
  await sleep(3500);
  const fin = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      enemies: (h.enemyEntities || []).length,
      carcass: (h.s01World?.spawnedPlacements || []).filter(r => (r.ref || '').includes('carcass')).map(r => ({ id: r.placementId, x: Math.round(r.x), y: Math.round(r.y), node: !!r.node })),
      lootGround: (h.pickupItems || []).map(i => i.id + '×' + (i.quantity || 1) + (i.picked ? '(已拾)' : '')),
      inv: h.playerEntity?.getComponent('inventory')?.getAllItems?.().map(({ slot }) => slot?.item?.id + '×' + (slot?.quantity || 1)),
      flags: [...h.storyFlags.keys()].filter(k => k.toLowerCase().includes('wolf')),
      questIndex: h.quest?.index
    };
  });
  console.log('[final] ' + JSON.stringify(fin, null, 1));
  console.log('[errors] ' + JSON.stringify(errors));
  await page.screenshot({ path: '.screenshots/diag-loot.png' });
} finally { await browser.close(); }

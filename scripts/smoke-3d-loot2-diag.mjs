// 走上掉落物验证自动拾取
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
  await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    const wt = wolf.getComponent('transform');
    const pt = h.playerEntity.getComponent('transform');
    pt.position.x = wt.position.x + 20;
    pt.position.y = wt.position.y;
    h.combatSystem.applyDamage(wolf, 999, { x: 1, y: 0 }, '刺击100%');
  });
  // 原地等待掉落，然后站上掉落物并按住拾取键（PickupSystem 为按键拾取语义）
  await sleep(2000);
  for (const [dx, dy] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) {
    await page.evaluate(([ddx, ddy]) => {
      const h = window.__s01host;
      const loot = (h.pickupItems || []).find(i => !i.picked);
      if (!loot) return;
      const t = h.playerEntity.getComponent('transform');
      t.position.x = loot.x + ddx;
      t.position.y = loot.y + ddy;
    }, [dx, dy]);
    await page.keyboard.down('e');
    await sleep(500);
    await page.keyboard.up('e');
    await sleep(400);
  }
  const fin = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      lootGround: (h.pickupItems || []).map(i => i.id + '×' + (i.quantity || 1) + (i.picked ? '(已拾)' : '(在地)')),
      inv: h.playerEntity?.getComponent('inventory')?.getAllItems?.().map(({ slot }) => slot?.item?.id + '×' + (slot?.quantity || 1)),
      questIndex: h.quest?.index
    };
  });
  console.log('[final] ' + JSON.stringify(fin, null, 1));
  await page.screenshot({ path: '.screenshots/diag-loot2.png' });
} finally { await browser.close(); }

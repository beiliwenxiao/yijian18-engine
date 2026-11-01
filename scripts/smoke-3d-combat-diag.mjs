// 战斗定向诊断：鼠标→世界映射标定 + 战斗状态 + 指针命中测试
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
  await page.goto('http://127.0.0.1:3457/example/sanguo_zhangjiao_3d/index.html', { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);
  await page.evaluate(() => window.forceInit && window.forceInit());
  await sleep(4000);
  for (let i = 0; i < 25; i++) {
    const ok = await page.evaluate(() => !!window.__s01host?.projectData);
    if (ok) break; await sleep(1000);
  }
  // 快进到狼：Space×6 → 移动教程 → 直接提交事实链（诊断只关心战斗段）
  for (let i = 0; i < 6; i++) { await page.keyboard.press(' '); await sleep(600); }
  await sleep(800);
  // 直接写剧情事实快速开门（诊断捷径，不验证采集链——那条已由冒烟覆盖）
  await page.evaluate(() => {
    const h = window.__s01host;
    h.commitFact('story.s01.campfireLit');
    h.counters.set('s01Survival.berryGatherCount', 1);
    h.commitFact('story.s01.berryGathered');
    h.commitFact('story.s01.berriesGathered');
    h.commitFact('story.s01.berryEaten');
    h.commitFact('story.s01.axeFound');
    h.commitFact('story.s01.woodGathered');
    h.commitFact('story.s01.refuelCampfire');
    h.spawnPlacementsGroup('S01-first-wolf');
  });
  await sleep(3000);

  // 标定鼠标→世界映射
  await page.mouse.move(400, 300);
  await sleep(300);
  const w1 = await page.evaluate(() => {
    const h = window.__s01host;
    return h.inputManager.getMouseWorldPosition(h.camera);
  });
  await page.mouse.move(900, 600);
  await sleep(300);
  const w2 = await page.evaluate(() => {
    const h = window.__s01host;
    return h.inputManager.getMouseWorldPosition(h.camera);
  });
  const scale = { x: (w2.x - w1.x) / 500, y: (w2.y - w1.y) / 300 };
  // 逆映射：screen = (world - w1)/scale + (400,300)
  const toScreen = (w) => ({
    x: Math.round((w.x - w1.x) / scale.x + 400),
    y: Math.round((w.y - w1.y) / scale.y + 300)
  });
  console.log('[mapping] w1=' + JSON.stringify(w1) + ' w2=' + JSON.stringify(w2) + ' scale=' + JSON.stringify(scale));

  const wolfInfo = await page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h.enemyEntities || [])[0];
    if (!wolf) return null;
    const t = wolf.getComponent('transform');
    const st = wolf.getComponent('stats');
    return {
      world: { x: t.position.x, y: t.position.y },
      hp: st?.hp, maxHp: st?.maxHp,
      inCombat: h.combatSystem?.isInCombat?.(),
      playerHp: h.playerEntity?.getComponent('stats')?.hp
    };
  });
  console.log('[wolf] ' + JSON.stringify(wolfInfo));
  if (!wolfInfo) { console.log('NO_WOLF'); process.exit(0); }
  const sp = toScreen(wolfInfo.world);
  console.log('[wolf-screen-2d] ' + JSON.stringify(sp));

  // 鼠标移到狼身上，验证指针命中判定
  await page.mouse.move(sp.x, sp.y);
  await sleep(400);
  const hit = await page.evaluate(() => {
    const h = window.__s01host;
    const im = h.inputManager;
    const mw = im.getMouseWorldPosition(h.camera);
    const t = h.playerEntity.getComponent('transform');
    const sprite = h.playerEntity.getComponent('sprite');
    const center = { x: t.position.x, y: t.position.y - (sprite?.height || 64) / 2 };
    const wolf = (h.enemyEntities || [])[0];
    const wt = wolf?.getComponent('transform');
    return {
      mouseWorld: mw,
      wolfWorld: wt ? { x: wt.position.x, y: wt.position.y } : null,
      playerCenter: center,
      combat: h.combatSystem?.isInCombat?.(),
      meleeExists: !!h.meleeAttackSystem,
      canAttackFn: typeof h.meleeAttackSystem?.canAttack
    };
  });
  console.log('[hit-check] ' + JSON.stringify(hit));

  // 按住左键打狼（反馈跟踪 + 快速轮询 + 卡住重按 + 贴身偏移）
  await page.mouse.down();
  let lastHp = 24, lastChange = Date.now();
  for (let i = 0; i < 90; i++) {
    await sleep(220);
    const info = await page.evaluate(() => {
      const h = window.__s01host;
      const wolf = (h.enemyEntities || [])[0];
      if (!wolf) return { dead: true, playerHp: h.playerEntity?.getComponent('stats')?.hp };
      const t = wolf.getComponent('transform');
      const pt = h.playerEntity?.getComponent('transform');
      return {
        dead: false,
        world: { x: t.position.x, y: t.position.y },
        hp: wolf.getComponent('stats')?.hp,
        px: pt?.position.x, py: pt?.position.y,
        combat: h.combatSystem?.isInCombat?.(),
        playerHp: h.playerEntity?.getComponent('stats')?.hp
      };
    });
    if (info.dead) { console.log('[combat] WOLF DEAD'); break; }
    // 目标点：狼身上；贴身时向远离玩家方向偏 42px（防指针命中玩家）
    let tx = info.world.x, ty = info.world.y;
    const dx = info.world.x - info.px, dy = info.world.y - info.py;
    if (Math.hypot(dx, dy) < 26) {
      const d = Math.hypot(dx, dy) || 1;
      tx += (dx / d) * 42; ty += (dy / d) * 42;
    }
    const mw = await page.evaluate(() => {
      const h = window.__s01host;
      return h.inputManager.getMouseWorldPosition(h.camera);
    });
    // 反馈修正：当前指针映射世界 → 狼世界 的误差直接加到屏幕坐标
    await page.mouse.move(sp.x + (tx - mw.x), sp.y + (ty - mw.y));
    if (info.hp !== lastHp) { lastHp = info.hp; lastChange = Date.now(); }
    if (i % 4 === 0) console.log(`[combat] r${i} wolfHp=${info.hp} inCombat=${info.combat} playerHp=${info.playerHp}`);
    if (Date.now() - lastChange > 5000) {
      await page.mouse.up();
      await sleep(150);
      await page.mouse.down();
      lastChange = Date.now();
    }
  }
  await page.mouse.up();
  await sleep(2500);
  const fin = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      questIndex: h.quest?.index,
      enemies: (h.enemyEntities || []).length,
      carcass: (h.s01World?.spawnedPlacements || []).filter(r => (r.ref || '').includes('carcass')).map(r => r.placementId),
      inv: h.playerEntity?.getComponent('inventory')?.getAllItems?.().map(({ slot }) => slot?.item?.id + '×' + (slot?.quantity || 1)),
      wolfFlags: [...h.storyFlags.keys()].filter(k => k.toLowerCase().includes('wolf')),
      allFlags: [...h.storyFlags.keys()]
    };
  });
  console.log('[final] ' + JSON.stringify(fin, null, 1));
  console.log('[logs] ' + logs.filter(l => l.includes('敌对') || l.includes('尸体') || l.includes('狼')).slice(-10).join(' | '));
  await page.screenshot({ path: '.screenshots/diag-combat.png' });
} finally { await browser.close(); }

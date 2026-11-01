// 定向诊断：走到野果丛，检查放置物注册/交互状态
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const URL = 'http://127.0.0.1:3457/example/sanguo_zhangjiao_3d/index.html';
const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
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
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);
  await page.evaluate(() => window.forceInit && window.forceInit());
  await sleep(4000);
  // 等待宿主就绪
  for (let i = 0; i < 25; i++) {
    const ok = await page.evaluate(() => !!window.__s01host?.projectData);
    if (ok) break;
    await sleep(1000);
  }
  // 对话推进 + 移动 + 点火
  for (let i = 0; i < 6; i++) { await page.keyboard.press(' '); await sleep(650); }
  await sleep(1200);
  await page.keyboard.down('s'); await sleep(240); await page.keyboard.up('s');
  await sleep(600);
  // 走向营火点火
  const walkTo = async (tx, ty) => {
    for (let i = 0; i < 60; i++) {
      const { x, y } = await page.evaluate(() => {
        const t = window.__s01host?.playerEntity?.getComponent('transform');
        return { x: Math.floor(t?.position.x ?? 0), y: Math.floor(t?.position.y ?? 0) };
      });
      const dx = tx - x, dy = ty - y;
      if (Math.abs(dx) <= 30 && Math.abs(dy) <= 30) return true;
      const keys = [];
      if (dy > 16) keys.push('s'); else if (dy < -16) keys.push('w');
      if (dx > 16) keys.push('d'); else if (dx < -16) keys.push('a');
      if (!keys.length) return true;
      for (const k of keys) await page.keyboard.down(k);
      await sleep(240);
      for (const k of keys) await page.keyboard.up(k);
      await sleep(120);
    }
    return false;
  };
  console.log('walk campfire:', await walkTo(438, 609));
  await page.keyboard.press('e');
  await sleep(2500);
  // 走向野果丛
  console.log('walk berry:', await walkTo(490, 677));
  await sleep(1000);
  const diag = await page.evaluate(() => {
    const h = window.__s01host;
    if (!h) return { err: 'no host' };
    const recs = (h.s01World?.spawnedPlacements || []).map(r => ({
      id: r.placementId, kind: r.kind, x: Math.round(r.x), y: Math.round(r.y),
      node: !!r.node, mesh: !!r.mesh, pickup: !!r.pickup, consumed: !!r.consumed, group: r.group
    }));
    const t = h.playerEntity?.getComponent('transform');
    const best = h.findNearestInteractable ? (() => {
      try { const b = h.findNearestInteractable(); return b ? { kind: b.kind, dist: Math.round(b.dist), id: b.record?.placementId || b.binding?.id } : null; } catch (e) { return 'ERR:' + e.message; }
    })() : 'no fn';
    return {
      pos: { x: Math.round(t?.position.x ?? 0), y: Math.round(t?.position.y ?? 0) },
      questIndex: h.quest?.index,
      stepTitles: (h.quest?.steps || []).slice(Math.max(0, h.quest.index - 1), h.quest.index + 2).map(s => s.title + ':' + s.type),
      storyFlags: [...h.storyFlags.entries()].filter(([k]) => k.includes('campfire') || k.includes('berry')).map(([k]) => k),
      spawnedCount: recs.length,
      spawned: recs.slice(0, 20),
      nearest: best,
      pendingMeshes: h.s01World?._pendingMeshes?.length ?? 'n/a',
      lastThree: !!h.s01World?._lastThree,
      tip: h.currentTip?.title || null
    };
  });
  console.log(JSON.stringify(diag, null, 1));
  await page.screenshot({ path: '.screenshots/diag-berry.png' });
  // 按 E 并观察
  await page.keyboard.press('e');
  await sleep(2000);
  const diag2 = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      questIndex: h.quest?.index,
      berryCounter: h.counters.get('s01Survival.berryGatherCount'),
      flags: [...h.storyFlags.entries()].filter(([k]) => k.includes('berry')).map(([k]) => k),
      inv: (() => {
        const inv = h.playerEntity?.getComponent('inventory');
        return inv?.getAllItems?.().map(({ slot }) => slot?.item?.id + '×' + (slot?.quantity || 1)) || null;
      })()
    };
  });
  console.log('after-E: ' + JSON.stringify(diag2));
  const diag3 = await page.evaluate(() => {
    const h = window.__s01host;
    return {
      questIndex: h.quest?.index,
      allSteps: (h.quest?.steps || []).map((s, i) => i + ':' + s.title + ':' + s.type).slice(0, 12),
      tutorialFlags: [...h.tutorialFlags.entries()],
      allFlags: [...h.storyFlags.entries()],
      counters: [...h.counters.entries()]
    };
  });
  console.log('deep: ' + JSON.stringify(diag3, null, 1));
  console.log('---- trigger logs ----');
  for (const l of logs.filter(x => x.includes('触发') || x.includes('任务步骤') || x.includes('命令执行失败'))) console.log(l);
  await page.screenshot({ path: '.screenshots/diag-berry-after-e.png' });
} finally { await browser.close(); }

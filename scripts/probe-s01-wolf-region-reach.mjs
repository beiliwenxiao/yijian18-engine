/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * probe-s01-wolf-region-reach.mjs —— 狼群领地在 S01 的可达性检测（BFS 版）。
 *
 * 目的：确认「狼群领地」（局部 x 11–251）是否从庇护所出口（局部 399,500）可达，
 * 以及是否存在绕过中间地形多边形的通路。
 * 方法：以 8px 网格做 BFS（可站立点为通行节点），输出最短路径与途经点。
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
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
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 16);
});
await page.waitForTimeout(600);

const lines = await page.evaluate(() => {
  const scene = window.__ddScene;
  const terrain = scene.terrain || scene._terrains?.[0] || null;
  const collision = scene._terrainCollision;
  const out = [];
  const W = 7680;
  const H = 3600;
  const blocked = (lx, ly) => collision.isPositionBlocked?.(terrain, lx + W, ly + H) === true;

  // BFS：局部坐标网格 0..520 x 0..720，步长 8
  const STEP = 8;
  const MAX_X = 520;
  const MAX_Y = 720;
  const key = (ix, iy) => iy * (MAX_X / STEP + 1) + ix;
  const toIx = lx => Math.round(lx / STEP);
  const toIy = ly => Math.round(ly / STEP);
  const toLocal = (ix, iy) => ({ x: ix * STEP, y: iy * STEP });

  const start = { x: toIx(399), y: toIy(500) };
  const goal = { x: toIx(131), y: toIy(609) };
  const seen = new Set();
  const prev = new Map();
  const queue = [start];
  seen.add(key(start.x, start.y));
  let found = false;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === goal.x && cur.y === goal.y) { found = true; break; }
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx > MAX_X / STEP || ny > MAX_Y / STEP) continue;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      const p = toLocal(nx, ny);
      if (blocked(p.x, p.y)) continue;
      seen.add(k);
      prev.set(k, key(cur.x, cur.y));
      queue.push({ x: nx, y: ny });
    }
  }
  out.push(`BFS 可达=${found}（起点 ${JSON.stringify(toLocal(start.x, start.y))} → 目标 ${JSON.stringify(toLocal(goal.x, goal.y))}）`);
  if (found) {
    const path = [];
    let k = key(goal.x, goal.y);
    const decode = kk => ({ x: kk % (MAX_X / STEP + 1), y: Math.floor(kk / (MAX_X / STEP + 1)) });
    while (k !== undefined) {
      path.unshift(toLocal(decode(k).x, decode(k).y));
      k = prev.get(k);
    }
    // 每 8 个点采样一个，打印路径折点
    const sample = path.filter((_, i) => i % 8 === 0).map(p => `(${p.x},${p.y})`);
    out.push(`路径点数=${path.length}`);
    out.push(`路径采样=${sample.join(' ')}`);
  }
  return out;
});
console.log(lines.join('\n'));
await browser.close();

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
 * probe-s01-river-geometry.mjs —— S01 河道跳跃落点几何诊断（现象②定案）。
 *
 * 输出：河道多边形、踏石 walkable 带、河岸跳石区的世界坐标范围，
 * 以及跳跃落点相对三者的位置关系（落在河道内？落在踏石带内？）。
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
await page.waitForTimeout(800);

const result = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const terrain = scene.terrain || scene._terrains?.[0] || null;
  const jumpSystem = scene.jumpSystem;
  const collision = scene._terrainCollision;
  const player = scene.playerEntity;
  const transform = player?.getComponent?.('transform');
  const out = {};

  const bbox = pts => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const shapes = (terrain?._collisionShapes || []).map(s => ({ id: s.id, box: bbox(s.points || []), n: (s.points || []).length }));
  const walkables = (terrain?._walkableShapes || []).map(s => ({ id: s.id, box: bbox(s.points || []), n: (s.points || []).length }));
  out.shapes = shapes;
  out.walkables = walkables;

  // 河岸跳石区（局部 480,340,120,100）+ 踏石带 obj_1791102721114
  const bank = { x: 480 + 60 + 7680, y: 340 + 50 + 3600 };
  const river = (terrain?._collisionShapes || []).find(s => /river/i.test(String(s?.id || '')));
  const stone = (terrain?._walkableShapes || []).find(s => /obj_1791102721114/.test(String(s?.id || '')));
  const riverBox = river ? bbox(river.points) : null;
  const stoneBox = stone ? bbox(stone.points) : null;
  out.bank = bank;
  out.riverBox = riverBox;
  out.stoneBox = stoneBox;

  // 从河岸向踏石带起跳，落点取踏石带近端
  const stoneNear = stoneBox ? { x: stoneBox.minX + 10, y: (stoneBox.minY + stoneBox.maxY) / 2 } : null;
  const dir = stoneNear ? { x: stoneNear.x - bank.x, y: stoneNear.y - bank.y } : { x: 1, y: 0 };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const unit = { x: dir.x / len, y: dir.y / len };
  transform.position.x = bank.x;
  transform.position.y = bank.y;

  const started = scene.jumpByDirection?.(unit.x, unit.y, 150, { duration: 1.0, peakHeight: 60 });
  out.started = started === true;
  const trail = [];
  for (let i = 0; i < 120; i++) {
    jumpSystem.update(1 / 60);
    const p = transform.position;
    const jumping = jumpSystem.isJumping(player);
    let corrected = null;
    if (!jumping) {
      const before = { x: p.x, y: p.y };
      collision?.resolveTerrains?.([terrain], [player]);
      if (Math.abs(before.x - p.x) > 0.01 || Math.abs(before.y - p.y) > 0.01) {
        corrected = {
          from: { x: Math.round(before.x * 100) / 100, y: Math.round(before.y * 100) / 100 },
          to: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 },
          back: Math.round(Math.hypot(before.x - p.x, before.y - p.y) * 100) / 100
        };
      }
    }
    trail.push({ f: i, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, jumping, corrected });
    if (!jumping && i > 3) break;
  }
  const last = trail[trail.length - 1];
  out.trail = trail.filter((t, i) => i % 10 === 0 || t.corrected);
  out.final = last;
  out.finalInStoneBox = stoneBox ? (last.x >= stoneBox.minX && last.x <= stoneBox.maxX && last.y >= stoneBox.minY && last.y <= stoneBox.maxY) : null;
  out.finalInRiverBox = riverBox ? (last.x >= riverBox.minX && last.x <= riverBox.maxX && last.y >= riverBox.minY && last.y <= riverBox.maxY) : null;
  out.finalBlocked = collision?.isPositionBlocked?.(terrain, last.x, last.y) === true;
  // 落点在踏石带内时，是否被修正？
  out.correctionHappened = trail.some(t => t.corrected);
  return out;
});
console.log(JSON.stringify(result, null, 2));
await browser.close();

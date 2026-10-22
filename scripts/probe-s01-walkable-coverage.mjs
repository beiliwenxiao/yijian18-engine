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
 * probe-s01-walkable-coverage.mjs —— 核实 S01 可落脚区对跳跃路径的覆盖（紧凑输出）。
 *
 * 修复②「沿跳跃路径回退到最后可落脚点」依赖可落脚区覆盖河岸与踏石。
 * 本探针输出一行一个采样点：局部坐标 / 是否可落脚 / 是否被阻挡。
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
  const walkables = terrain?._walkableShapes || [];
  const out = [];
  out.push(`walkableShapes=${walkables.map(s => s.id).join(',')}`);
  const pointInWalkable = (x, y) => {
    for (const s of walkables) if (collision._pointInShape?.(s, x, y)) return s.id;
    return '-';
  };
  for (let lx = 460; lx <= 900; lx += 40) {
    for (const ly of [300, 340, 380, 420]) {
      const x = lx + 7680;
      const y = ly + 3600;
      const w = pointInWalkable(x, y);
      const b = collision.isPositionBlocked?.(terrain, x, y) === true;
      out.push(`local(${lx},${ly}) walkable=${w} blocked=${b}`);
    }
  }
  return out;
});
console.log(lines.join('\n'));
await browser.close();

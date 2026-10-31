/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-01
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 ************************************************************/

/**
 * probe-frame-profile.mjs —— 帧性能基线采样。
 * 打开游戏（默认 S01），打开 debugMode 帧画像，采样 windowMs 毫秒，
 * 输出各阶段平均/最大耗时 + worldQueueDraw 按类型分解 + 规模计数。
 * 前置：dev server 3000 端口。
 *
 * 用法：node scripts/probe-frame-profile.mjs [windowMs=12000] [scene=S01]
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const windowMs = Number(process.argv[2]) || 12000;
const targetSceneId = process.argv[3] || 'S01';

const browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

// 等场景对象就绪并跳过开场按钮
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => Boolean(window.__ddScene))) break;
  if (i >= 2) {
    await page.evaluate(() => {
      for (const label of ['下一步', '开始新游戏', '开始游戏', '确认', '确定', '继续']) {
        const m = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled && b.textContent.trim() === label);
        if (m.length > 0) { m[m.length - 1].click(); return; }
      }
    });
  }
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(1500);

// 关对话、确保在目标场景、打开 debugMode 帧画像
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 400);
});
await page.waitForTimeout(800);
const currentScene = await page.evaluate(() => window.__ddScene?.currentSceneId || window.__ddScene?.name);
if (currentScene !== targetSceneId) {
  await page.evaluate(async sceneId => {
    await window.__ddScene.teleportToChunk({ scene: sceneId, spawnRef: 'player', operationId: 'profile:enter' });
  }, targetSceneId);
  await page.waitForTimeout(3000);
}
await page.evaluate(() => {
  const scene = window.__ddScene;
  scene.debugMode = true;
  scene._framePerformanceProfile = undefined; // 重建画像窗口
});
await page.waitForTimeout(windowMs);

const report = await page.evaluate(() => {
  const scene = window.__ddScene;
  const profile = scene?._framePerformanceProfile;
  if (!profile || !profile.frameCount) return { error: 'no profile samples' };
  const n = Math.max(1, profile.frameCount);
  const avg = name => Number(((profile.sums[name] || 0) / n).toFixed(2));
  const max = name => Number((profile.maximums[name] || 0).toFixed(2));
  const names = Object.keys(profile.sums);
  const phases = {};
  for (const name of names) phases[name] = { avg: avg(name), max: max(name) };
  const terrains = (scene.context?.world?.terrains || []).filter(Boolean);
  return {
    frames: profile.frameCount,
    over16: profile.over16,
    over33: profile.over33,
    phases,
    scale: {
      entities: avg('visibleEntityCount'),
      queue: avg('worldQueueLength'),
      depthParticles: avg('worldDepthParticleCount'),
      activeParticles: avg('activeParticles')
    },
    terrain: {
      count: terrains.length,
      editorShapes: terrains.map(t => (t._editorShapes || []).length),
      walkableShapes: terrains.map(t => (t._walkableShapes || []).length),
      collisionShapes: terrains.map(t => (t._collisionShapes || []).length),
      hasEllipse: terrains.map(t => t._hasTerrainEllipse),
      hasCombinedCache: terrains.map(t => Boolean(t._combinedGroundCache)),
      waterPatches: terrains.map(t => (t.waterPatches || []).length),
      decoCount: terrains.map(t => (t.decorations || []).length)
    },
    canvas: {
      logicalW: scene.logicalWidth,
      logicalH: scene.logicalHeight,
      pixelW: document.querySelector('canvas')?.width,
      pixelH: document.querySelector('canvas')?.height
    }
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();

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
 * probe-entity-draw-micro.mjs —— 实体绘制微基线（有头 Chrome，GPU 加速）。
 * 在页面内对每个可见实体做 renderEntity 微基准（offscreen canvas，N 次迭代），
 * 输出单实体耗时排行与精灵信息，定位 worldQueueDraw 的实体级元凶。
 * 前置：dev server 3000 端口。
 *
 * 用法：node scripts/probe-entity-draw-micro.mjs [scene=S01] [iters=50]
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const targetSceneId = process.argv[3] || process.argv[2] || 'S01';
const iters = Number(process.argv[3]) || Number(process.argv[2]) || 50;

const browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

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
await page.evaluate(() => {
  const ds = window.__ddScene?.dialogueSystem;
  window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 400);
});
await page.waitForTimeout(800);
const currentScene = await page.evaluate(() => window.__ddScene?.currentSceneId || window.__ddScene?.name);
if (currentScene !== targetSceneId) {
  await page.evaluate(async sceneId => {
    await window.__ddScene.teleportToChunk({ scene: sceneId, spawnRef: 'player', operationId: 'micro:enter' });
  }, targetSceneId);
  await page.waitForTimeout(3000);
}
await page.waitForTimeout(2000);

const report = await page.evaluate(({ iters }) => {
  const scene = window.__ddScene;
  const context = scene.context || {};
  const entities = (context.entities?.all || []).filter(e => {
    const pos = e.getComponent?.('transform')?.position;
    return pos && e.getComponent?.('sprite');
  });
  const renderer = scene._ensureEntityRenderer();
  const off = document.createElement('canvas');
  off.width = 1280; off.height = 720;
  const ctx = off.getContext('2d');
  const results = [];
  for (const entity of entities) {
    const sprite = entity.getComponent('sprite');
    const skeleton = entity.getComponent?.('skeleton');
    // 预热 3 次
    for (let i = 0; i < 3; i++) renderer.render(ctx, entity);
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) renderer.render(ctx, entity);
    const cost = (performance.now() - t0) / iters;
    const asset = skeleton?.skeletonAsset;
    results.push({
      name: entity.name || entity.id,
      type: entity.type,
      costMs: Number(cost.toFixed(3)),
      spriteW: sprite.width, spriteH: sprite.height, scale: sprite.scale,
      isSkeleton: !!sprite.isSkeleton,
      slots: asset?.slots?.length || 0,
      sheet: sprite.spriteSheet || null,
      layers: (sprite.appearanceLayers || []).length
    });
  }
  results.sort((a, b) => b.costMs - a.costMs);
  // 渲染整帧画布一次的对照（含背景+全部实体）
  const t1 = performance.now();
  for (let i = 0; i < 10; i++) scene.renderBackground(ctx);
  const bgCost = (performance.now() - t1) / 10;
  return { entities: results, renderBackgroundMs: Number(bgCost.toFixed(2)) };
}, { iters });

console.log(JSON.stringify(report, null, 2));
await browser.close();

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
 * probe-climb-animation.mjs —— 攀爬动画链路实机探针（定位「攀爬没用 climb_back」）。
 *
 * 验证目标：
 *   ① 玩家骨骼形式与骨架组件（skeletonId / frameMode / 剪辑表里有无 climb_back）
 *   ② 强制进入受控攀爬（locomotionSystem.climbSystem.startControlledClimb）后：
 *      entity._climbing 是否为 true
 *   ③ 攀爬期间骨架组件 currentClip 是否为 climb_back
 *   ④ 若 currentClip 不是 climb_back，输出 mapperHold 线索（当前剪辑/剪辑循环性/时长）
 *
 * 用法：node scripts/probe-climb-animation.mjs
 * 前置：本地 dev server 在 3000 端口提供 example/sanguo_zhangjiao/index.html
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const log = (step, detail) => console.log(`[PROBE] ${step}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('console', msg => {
  const text = msg.text();
  if (text.includes('Climb') || text.includes('climb')) console.log('[console]', text.slice(0, 200));
});

await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

// ---- 等场景 ready ----
let ready = false;
for (let i = 0; i < 60; i++) {
  ready = await page.evaluate(() => Boolean(window.__ddScene));
  if (ready) break;
  if (i >= 2) {
    await page.evaluate(() => {
      const labels = ['下一步', '开始新游戏', '开始游戏', '确认', '确定', '继续'];
      for (const label of labels) {
        const matches = [...document.querySelectorAll('button')].filter(b =>
          b.offsetParent !== null && !b.disabled && b.textContent.trim() === label);
        if (matches.length > 0) { matches[matches.length - 1].click(); return; }
      }
    });
  }
  await page.waitForTimeout(2000);
}
if (!ready) { log('scene-ready', false); await browser.close(); process.exit(1); }
log('scene-ready', true);

// 关开场对话（防对话锁拦输入消费）
await page.evaluate(() => {
  const scene = window.__ddScene;
  window.__probeDialogueKiller = setInterval(() => {
    try {
      const ds = scene.dialogueSystem;
      if (ds?.isDialogueActive?.()) ds.endDialogue();
    } catch (e) { /* ignore */ }
  }, 16);
});
await page.waitForTimeout(600);

/* ------------------------------------------------------------------ */
/* ① 玩家骨骼形式与剪辑表                                              */
/* ------------------------------------------------------------------ */
const skeletonInfo = await page.evaluate(() => {
  const s = window.__ddScene;
  const player = s.playerEntity;
  if (!player) return { error: 'no playerEntity' };
  const sk = player.getComponent('skeleton');
  const asset = sk?.skeletonAsset;
  return {
    hasSkeletonComponent: !!sk,
    assetId: asset?.id || asset?.skeletonId || null,
    frameMode: asset?.meta?.frameMode === true,
    clipCount: asset?.clips ? asset.clips.size : null,
    hasClimbBack: asset?.clips ? asset.clips.has('climb_back') : null,
    climbBackMeta: (() => {
      if (!asset?.clips || !asset.clips.has('climb_back')) return null;
      const c = asset.clips.get('climb_back');
      return { loop: c.loop, durationMs: c.durationMs };
    })(),
    defaultClip: asset?.defaultClip || null,
    stateHookName: sk?.stateHook ? 'attached' : null
  };
});
log('①-player-skeleton', skeletonInfo);

/* ------------------------------------------------------------------ */
/* ②③ 强制进入受控攀爬，读 _climbing 与 currentClip                    */
/* ------------------------------------------------------------------ */
const climbStart = await page.evaluate(() => {
  const s = window.__ddScene;
  const player = s.playerEntity;
  const climb = s.locomotionSystem?.climbSystem;
  if (!player || !climb) return { error: 'climbSystem or player missing' };
  const t = player.getComponent('transform');
  const x = t.position.x, y = t.position.y;
  // 在玩家脚下开一段受控攀爬（bounds 覆盖当前位置，出口在上方 120px）
  const ok = climb.startControlledClimb(player,
    { minX: x - 40, minY: y - 40, maxX: x + 40, maxY: y + 160 },
    { exitPosition: { x, y: y - 120 }, exitRadius: 30, speed: 60, elevation: 20 });
  return { ok, pos: { x, y }, climbing: player._climbing === true };
});
log('②-start-controlled-climb', climbStart);
await page.waitForTimeout(600);

const duringClimb = await page.evaluate(() => {
  const s = window.__ddScene;
  const player = s.playerEntity;
  const sk = player?.getComponent('skeleton');
  const sprite = player?.getComponent('sprite');
  return {
    _climbing: player?._climbing === true,
    isClimbing: s.locomotionSystem?.climbSystem?.isClimbing?.(player) === true,
    mode: s.locomotionSystem?.climbSystem?.isControlledClimb?.(player) === true ? 'controlled' : 'traverse',
    currentClip: sk?.currentClip || null,
    clipTime: sk?.clipTime ?? null,
    spriteDirection: sprite?.direction || null,
    isWalking: sprite?.isWalking === true
  };
});
log('③-during-climb', duringClimb);

// 再等 600ms 看剪辑是否稳定（防止切换瞬态）
await page.waitForTimeout(600);
const duringClimb2 = await page.evaluate(() => {
  const s = window.__ddScene;
  const sk = s.playerEntity?.getComponent('skeleton');
  return { currentClip: sk?.currentClip || null, clipTime: sk?.clipTime ?? null };
});
log('③-during-climb-steady', duringClimb2);

/* ------------------------------------------------------------------ */
/* ④ 结束攀爬，确认回归                                                 */
/* ------------------------------------------------------------------ */
const climbEnd = await page.evaluate(() => {
  const s = window.__ddScene;
  const player = s.playerEntity;
  const climb = s.locomotionSystem?.climbSystem;
  // 传 inputAxis=null + 无出口推进：直接用内部 detach（若无公开方法，置标志自恢复）
  const state = climb?._active?.get(player);
  if (state) climb._active.delete(player);   // 探针强制清理（不走事件链，仅供观察动画回归）
  player._climbing = false;
  return { cleaned: true };
});
log('④-force-detach', climbEnd);
await page.waitForTimeout(400);
const afterClimb = await page.evaluate(() => {
  const s = window.__ddScene;
  const sk = s.playerEntity?.getComponent('skeleton');
  return { currentClip: sk?.currentClip || null };
});
log('④-after-detach-clip', afterClimb);

// ---- 汇总 ----
const pass = climbStart.ok && duringClimb._climbing && duringClimb2.currentClip === 'climb_back';
log('VERDICT', pass
  ? 'PASS —— 攀爬态正确播放 climb_back'
  : `FAIL —— climbing=${duringClimb._climbing} steadyClip=${duringClimb2.currentClip}（期望 climb_back）。若 _climbing=true 但剪辑不对 → mapper 分支或 mapperHold 问题；若 _climbing=false → 标志设置链路问题`);

await browser.close();

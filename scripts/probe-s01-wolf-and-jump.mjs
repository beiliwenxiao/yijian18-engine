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
 * probe-s01-wolf-and-jump.mjs —— S01 两处玩法缺陷的运行时证据采集（v5 收口）。
 *
 * 现象①：庇护所内过夜后出门，狼群（S01-wolf-pack）与狼王（S01-wolf-king）均未出现。
 * 现象②：玩家跳跃越过河道时被弹回起跳点（视觉上已越过不可落脚的河道区域）。
 *
 * v5 修正：
 *  - 现象① 补齐教学狼前置事实（campfireLit / campfireRefuelCount）后走真实事务链；
 *  - 现象② 记录 jumpByDirection 的真实拒绝原因与落地后地形修正量。
 *
 * 用法：node scripts/probe-s01-wolf-and-jump.mjs
 * 前置：本地 dev server 在 3000 端口提供 example/sanguo_zhangjiao/index.html
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const log = (step, detail) => console.log(`[PROBE] ${step}${detail ? ' :: ' + detail : ''}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

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

// 关掉可能残留的开场对话（否则事务被对话锁拦、跳跃被 dialogueSystem 拒绝）。
// 开场对话会被剧情每帧重新拉起，故装一个持续清理器。
await page.evaluate(() => {
  const scene = window.__ddScene;
  window.__probeDialogueKiller = setInterval(() => {
    try {
      const ds = scene.dialogueSystem;
      if (ds?.isDialogueActive?.()) ds.endDialogue();
    } catch (e) { /* ignore */ }
  }, 16);
});
await page.waitForTimeout(800);

/* ------------------------------------------------------------------ */
/* 现象①：狼群 / 狼王生成链路                                          */
/* ------------------------------------------------------------------ */
const wolf = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const loader = scene.gameLoader;
  const triggerSystem = loader?.triggerSystem;
  const bindingsSystem = scene._sceneTriggerBindings;
  const out = { steps: [] };
  const step = (name, detail) => out.steps.push({ name, detail });

  const wolfBinding = (bindingsSystem?.bindings || []).find(b => /wolf-region/i.test(String(b?.id || '')));
  step('binding', JSON.stringify({
    id: wolfBinding?.id, triggerId: wolfBinding?.triggerId, event: wolfBinding?.event,
    activeWhen: wolfBinding?.activeWhen,
    box: wolfBinding && { x: wolfBinding.x, y: wolfBinding.y, w: wolfBinding.width, h: wolfBinding.height }
  }));

  // 直接写前置事实（模拟玩家已添柴点篝火、已见教学狼），再走真实事务链。
  // 权威写入走 blackboard.set('storyState', {...})（SDD 镜像每帧从文档恢复，
  // 故必须整体替换顶层 storyState，不能只改嵌套字段）。
  const bb = loader?.blackboard;
  const setFacts = patch => {
    try {
      const story = { ...(bb?.get?.('storyState') || {}) };
      story.s01Survival = { ...(story.s01Survival || {}), ...patch };
      bb?.set?.('storyState', story);
      return true;
    } catch (e) { return 'ERR ' + String(e).slice(0, 120); }
  };
  step('seed-pre', String(setFacts({ campfireLit: true, campfireRefuelCount: 1 })));
  step('storyState-now', JSON.stringify(bb?.get?.('storyState')?.s01Survival || {}));

  const commit = async (definitionId, opId, payload = {}) => {
    try {
      const res = await scene.sceneRuntime?.commandGateway?.execute({
        intentType: 'state.transaction',
        actorRef: scene.playerEntity?.id,
        operationId: opId,
        payload: { definitionId, ...payload }
      });
      return res?.ok === true ? 'ok' : (res?.code || 'rejected');
    } catch (e) { return 'ERR ' + String(e).slice(0, 120); }
  };
  step('commit-spotted', await commit('story.s01.firstWolfSpotted', 'probe:firstWolfSpotted', { firstWolfCount: 1 }));
  step('commit-killed', await commit('story.s01.firstWolfKilled', 'probe:firstWolfKilled'));
  await new Promise(r => setTimeout(r, 500));
  const survival = loader?.blackboard?._vars?.storyState?.s01Survival || {};
  step('facts', JSON.stringify({ spotted: survival.firstWolfSpotted, killed: survival.firstWolfKilled }));

  // 走进狼群领地中心
  const zone = { x: wolfBinding.x + wolfBinding.width / 2, y: wolfBinding.y + wolfBinding.height / 2 };
  const transform = scene.playerEntity?.getComponent?.('transform');
  transform.position.x = zone.x;
  transform.position.y = zone.y;
  step('teleported', JSON.stringify(zone));
  await new Promise(r => setTimeout(r, 1500));

  step('binding-active', String(bindingsSystem?._isBindingActive?.(wolfBinding)));
  step('inside', String(bindingsSystem?._inside?.get(wolfBinding.id)));
  step('firedOnce-wolfish', JSON.stringify((triggerSystem?._firedOnce ? [...triggerSystem._firedOnce] : []).filter(id => /wolf/i.test(id))));

  const placements = scene.context?.services?.placements;
  const inspect = id => {
    const r = placements?.inspectPlacement?.(id) || null;
    return r ? { spawned: r.spawned, live: r.live } : null;
  };
  step('placements', JSON.stringify({ pack1: inspect('S01-wolf-pack-1'), king: inspect('S01-wolf-king') }));
  const pack = (scene.entityStore?.all || []).filter(e => /wolf/i.test(JSON.stringify(e?.tags || [])));
  step('wolf-entities', JSON.stringify(pack.map(e => ({ id: e.id, hp: e.getComponent?.('stats')?.hp }))));

  for (const e of pack) {
    try { scene.combatSystem?.killEntity?.(e, { source: 'probe' }); } catch (err) { /* ignore */ }
  }
  await new Promise(r => setTimeout(r, 2000));
  step('firedOnce-after-clear', JSON.stringify((triggerSystem?._firedOnce ? [...triggerSystem._firedOnce] : []).filter(id => /wolf/i.test(id))));
  step('king-placement', JSON.stringify(inspect('S01-wolf-king')));
  step('wolf-entities-after', JSON.stringify((scene.entityStore?.all || [])
    .filter(e => /wolf/i.test(JSON.stringify(e?.tags || [])))
    .map(e => ({ id: e.id, hp: e.getComponent?.('stats')?.hp }))));
  return out;
});
console.log('\n===== 现象① 狼群 / 狼王 =====');
console.log(JSON.stringify(wolf, null, 2));

/* ------------------------------------------------------------------ */
/* 现象②：跳跃过河（真实 jumpByDirection + 真实帧管线顺序）              */
/* ------------------------------------------------------------------ */
const jump = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const jumpSystem = scene.jumpSystem;
  const collision = scene._terrainCollision;
  const terrain = scene.terrain || scene._terrains?.[0] || null;
  const player = scene.playerEntity;
  const transform = player?.getComponent?.('transform');
  const out = { steps: [] };
  const step = (name, detail) => out.steps.push({ name, detail });

  const shapes = terrain?._collisionShapes || [];
  const river = shapes.find(s => /river/i.test(String(s?.id || '')));
  const bbox = pts => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  if (!jumpSystem || !transform || !river) { step('env', 'missing'); return out; }
  const riverBox = bbox(river.points);

  const bank = { x: 480 + 60 + 7680, y: 340 + 50 + 3600 };
  const target = { x: (riverBox.minX + riverBox.maxX) / 2, y: (riverBox.minY + riverBox.maxY) / 2 };
  const dir = { x: target.x - bank.x, y: target.y - bank.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const unit = { x: dir.x / len, y: dir.y / len };
  transform.position.x = bank.x;
  transform.position.y = bank.y;
  step('start', JSON.stringify({ bank, target, unit }));
  step('guards', JSON.stringify({
    dialogue: scene.dialogueSystem?.isDialogueActive?.() === true,
    transitioning: scene.isTransitioning === true,
    backpack: scene.backpackPanel?.visible === true,
    meditation: scene.meditationSystem?.isActive?.() === true,
    busy: scene.locomotionSystem?.isBusy?.(player) === true,
    climbTarget: scene.resolveClimbTarget?.({ entity: player, direction: unit })?.id || null
  }));

  // 真实起跳：scene.jumpByDirection（与 AirAim 按下回调同一入口）
  const started = scene.jumpByDirection?.(unit.x, unit.y, 150, { duration: 1.0, peakHeight: 60 });
  step('jumpByDirection', String(started));
  if (!started) {
    // 退化路径：直接用 JumpSystem 起跳（同 AirAim 回调最终调用）
    jumpSystem.startJump(player, unit, { distance: 150, duration: 1.0, peakHeight: 60 });
    step('fallback-startJump', 'true');
  }

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
          jumpBack: Math.round(Math.hypot(before.x - p.x, before.y - p.y) * 100) / 100
        };
      }
    }
    trail.push({
      f: i, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100,
      elev: Math.round((p.elevation || 0) * 100) / 100, jumping, corrected
    });
    if (!jumping && i > 3) break;
  }
  const end = { x: transform.position.x, y: transform.position.y };
  step('jump-end', JSON.stringify({
    end,
    deltaFromStart: { x: Math.round((end.x - bank.x) * 100) / 100, y: Math.round((end.y - bank.y) * 100) / 100 }
  }));
  step('corrections', JSON.stringify(trail.filter(t => t.corrected).map(t => `f${t.f} ${JSON.stringify(t.corrected)}`)));
  step('trail', JSON.stringify(trail.filter((t, i) => i % 10 === 0)
    .map(t => `f${t.f} x=${t.x} y=${t.y} e=${t.elev}${t.corrected ? ' CORRECTED' : ''}`)));
  return out;
});
console.log('\n===== 现象② 跳跃越河 =====');
console.log(JSON.stringify(jump, null, 2));

await browser.close();

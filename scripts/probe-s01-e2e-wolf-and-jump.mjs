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
 * probe-s01-e2e-wolf-and-jump.mjs —— S01 两处缺陷修复的端到端验证。
 *
 * 现象①：庇护所过夜后出门 → 踏入狼群领地 → 狼群生成 → 清群 → 狼王生成
 * 现象②：跳跃越过河道 → 落点不被弹回出发点
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

const out = await page.evaluate(async () => {
  const scene = window.__ddScene;
  const loader = scene.gameLoader;
  const triggerSystem = loader?.triggerSystem;
  const res = { wolf: [], jump: [] };
  const w = (name, detail) => res.wolf.push({ name, detail });
  const j = (name, detail) => res.jump.push({ name, detail });

  const commit = async (definitionId, opId, payload = {}) => {
    try {
      const r = await scene.sceneRuntime?.commandGateway?.execute({
        intentType: 'state.transaction',
        actorRef: scene.playerEntity?.id,
        operationId: opId,
        payload: { definitionId, ...payload }
      });
      return r?.ok === true ? 'ok' : (r?.code || 'rejected');
    } catch (e) { return 'ERR ' + String(e).slice(0, 120); }
  };
  const setFacts = patch => {
    const bb = loader?.blackboard;
    const story = { ...(bb?.get?.('storyState') || {}) };
    story.s01Survival = { ...(story.s01Survival || {}), ...patch };
    bb?.set?.('storyState', story);
  };

  /* ---------------- 现象① ---------------- */
  // 模拟：过夜完成 + 教学狼已杀（狼群领地的 activeWhen 前置）
  setFacts({ campfireLit: true, campfireRefuelCount: 1, overnightCompleted: true });
  w('commit-spotted', await commit('story.s01.firstWolfSpotted', 'e2e:spotted', { firstWolfCount: 1 }));
  w('commit-killed', await commit('story.s01.firstWolfKilled', 'e2e:killed'));
  await new Promise(r => setTimeout(r, 400));
  w('facts', JSON.stringify(loader?.blackboard?.get?.('storyState')?.s01Survival || {}));

  // 玩家出门位置（庇护所返回出生点）→ 踏入狼群领地
  const transform = scene.playerEntity?.getComponent?.('transform');
  const bindingsSystem = scene._sceneTriggerBindings;
  const wolfBinding = (bindingsSystem?.bindings || []).find(b => /wolf-region/i.test(String(b?.id || '')));
  const zone = { x: wolfBinding.x + wolfBinding.width / 2, y: wolfBinding.y + wolfBinding.height / 2 };
  transform.position.x = zone.x;
  transform.position.y = zone.y;
  await new Promise(r => setTimeout(r, 1500));
  w('binding-active', String(bindingsSystem?._isBindingActive?.(wolfBinding)));
  w('firedOnce', JSON.stringify((triggerSystem?._firedOnce ? [...triggerSystem._firedOnce] : []).filter(id => /wolf/i.test(id))));

  const placements = scene.context?.services?.placements;
  const inspect = id => {
    const r = placements?.inspectPlacement?.(id) || null;
    return r ? { spawned: r.spawned, live: r.live } : null;
  };
  w('pack-placements', JSON.stringify({
    p1: inspect('S01-wolf-pack-1'), p3: inspect('S01-wolf-pack-3')
  }));
  const pack = (scene.entityStore?.all || []).filter(e => /wolf/i.test(JSON.stringify(e?.tags || [])));
  w('pack-entities', JSON.stringify(pack.map(e => ({ id: e.id, hp: e.getComponent?.('stats')?.hp }))));

  // 清群：用真实伤害路径杀死
  for (const e of pack) {
    try {
      const combat = e.getComponent?.('combat');
      const stats = e.getComponent?.('stats');
      if (stats) { stats.hp = 0; stats.dead = true; }
      scene.combatSystem?.handleEntityDeath?.(e);
    } catch (err) { /* ignore */ }
  }
  await new Promise(r => setTimeout(r, 1500));
  w('after-clear-firedOnce', JSON.stringify((triggerSystem?._firedOnce ? [...triggerSystem._firedOnce] : []).filter(id => /wolf/i.test(id))));
  w('king-placement', JSON.stringify(inspect('S01-wolf-king')));
  w('survival-after', JSON.stringify(loader?.blackboard?.get?.('storyState')?.s01Survival || {}));

  /* ---------------- 现象② ---------------- */
  const jumpSystem = scene.jumpSystem;
  const collision = scene._terrainCollision;
  const terrain = scene.terrain || scene._terrains?.[0] || null;
  const bank = { x: 480 + 60 + 7680, y: 340 + 50 + 3600 };
  const stoneNear = { x: 8268 + 10, y: (3864 + 3955) / 2 };
  const dir = { x: stoneNear.x - bank.x, y: stoneNear.y - bank.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const unit = { x: dir.x / len, y: dir.y / len };
  transform.position.x = bank.x;
  transform.position.y = bank.y;
  const started = scene.jumpByDirection?.(unit.x, unit.y, 150, { duration: 1.0, peakHeight: 60 });
  j('jumpByDirection', String(started));
  let correction = null;
  const start = { x: transform.position.x, y: transform.position.y };
  for (let i = 0; i < 120; i++) {
    jumpSystem.update(1 / 60);
    const p = transform.position;
    if (!jumpSystem.isJumping(player0 = scene.playerEntity)) {
      const before = { x: p.x, y: p.y };
      collision?.resolveTerrains?.([terrain], [scene.playerEntity]);
      if (Math.abs(before.x - p.x) > 0.01 || Math.abs(before.y - p.y) > 0.01) {
        correction = {
          from: { x: Math.round(before.x * 100) / 100, y: Math.round(before.y * 100) / 100 },
          to: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 },
          back: Math.round(Math.hypot(before.x - p.x, before.y - p.y) * 100) / 100
        };
      }
      break;
    }
  }
  const end = { x: transform.position.x, y: transform.position.y };
  j('correction', JSON.stringify(correction));
  j('travel', JSON.stringify({
    from: { x: Math.round(start.x * 100) / 100, y: Math.round(start.y * 100) / 100 },
    to: { x: Math.round(end.x * 100) / 100, y: Math.round(end.y * 100) / 100 },
    dist: Math.round(Math.hypot(end.x - start.x, end.y - start.y) * 100) / 100
  }));
  j('blocked-at-end', String(collision?.isPositionBlocked?.(terrain, end.x, end.y) === true));
  j('back-to-start', String(Math.hypot(end.x - start.x, end.y - start.y) < 1));
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

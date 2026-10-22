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
 * probe-s01-quest-wolf-steps.mjs —— 验证狼群战任务步骤接入后的编译与推进。
 *
 * 检查：
 * 1. quests.json 编译出的 task.s01.survival 任务图含 defeatWolfPack / defeatWolfKing 两个 objective；
 * 2. 两个步骤的 objective target 事实（story.s01.wolfPackCleared / wolfKingDefeated）
 *    存在于事实目录（commands[] 派生）；
 * 3. mapTargets 指向的 S01-zone-wolf-region 在场景对象中可解析（引导不悬空）；
 * 4. 提交 wolfPackCleared 事实后该步骤能变为 succeeded（事实驱动推进）。
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
  const res = { steps: [] };
  const step = (name, detail) => res.steps.push({ name, detail });

  // 1) 任务图投影
  const projection = loader?.taskGraph?.getProjection?.(scene.playerEntity?.id) || [];
  const survival = projection.find(t => t?.definitionId === 'task.s01.survival' || t?.id === 'task.s01.survival');
  const nodes = survival?.nodes || [];
  step('projection-found', `${projection.length} 个任务；survival 节点数=${nodes.length}`);
  const ids = nodes.filter(n => n.type === 'objective').map(n => n.id);
  step('objective-ids', JSON.stringify(ids));
  const pack = nodes.find(n => n.id === 'defeatWolfPack');
  const king = nodes.find(n => n.id === 'defeatWolfKing');
  step('pack-node', JSON.stringify(pack && {
    status: pack.status, target: pack.target, mapTargets: pack.mapTargets,
    matcher: pack.eventMatcher
  }));
  step('king-node', JSON.stringify(king && { status: king.status, target: king.target }));

  // 2) 事实目录
  const facts = loader?.questFacts?.list?.() || loader?.factCatalog?.list?.() || null;
  const hasFact = id => {
    if (Array.isArray(facts)) return facts.some(f => f.id === id);
    if (facts && typeof facts.has === 'function') return facts.has(id);
    return 'unknown';
  };
  step('fact-wolfPackCleared', String(hasFact('story.s01.wolfPackCleared')));
  step('fact-wolfKingDefeated', String(hasFact('story.s01.wolfKingDefeated')));

  // 3) mapTarget 目标可解析
  const worldQuery = scene.context?.services?.worldQuery;
  const objects = scene.context?.services?.triggerBindings?.sceneObjects || [];
  const found = objects.filter(o => o?.id === 'S01-zone-wolf-region');
  step('zone-object', `sceneObjects 中命中 ${found.length} 个；worldQuery=${worldQuery ? '有' : '无'}`);
  const projected = worldQuery?.findProjectedObject?.('S01', 'S01-zone-wolf-region') || null;
  step('zone-projected', JSON.stringify(projected && {
    id: projected.id, x: projected.x, y: projected.y, w: projected.width, h: projected.height
  }));

  // 4) 提交事实看步骤推进
  try {
    const commit = await scene.sceneRuntime?.commandGateway?.execute({
      intentType: 'state.transaction',
      actorRef: scene.playerEntity?.id,
      operationId: 'probe:wolfPackCleared',
      payload: { definitionId: 'story.s01.wolfPackCleared' }
    });
    step('commit-wolfPackCleared', commit?.ok === true ? 'ok' : (commit?.code || 'rejected'));
  } catch (e) { step('commit-wolfPackCleared', 'ERR ' + String(e).slice(0, 120)); }
  await new Promise(r => setTimeout(r, 600));
  const proj2 = loader?.taskGraph?.getProjection?.(scene.playerEntity?.id) || [];
  const survival2 = proj2.find(t => t?.definitionId === 'task.s01.survival');
  const pack2 = (survival2?.nodes || []).find(n => n.id === 'defeatWolfPack');
  step('pack-status-after-commit', String(pack2?.status));
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

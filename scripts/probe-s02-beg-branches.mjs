/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-11-03
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * probe-s02-beg-branches.mjs —— S02 荒村乞讨链「选项分支」实机探针（常驻回归）。
 *
 * 2026-11-03 事故沉淀：dialogueChoice 触发器未按 choiceId 过滤导致摇头误扣野果、
 * 追问对话无启动入口导致任务断链。本探针把乞讨链三条分支各实机断言一次
 * （主链 probe-s02-mission-chain.mjs 只走摇头路径，不重复覆盖）：
 *   分支 A：孩童摇头 → 专属回复 + 不扣物 + 不引更多孩子 → 直达大人乞讨 → 大人摇头（袋有粮不扣）→ 围攻
 *   分支 B：给果子（扣2、引来追问）→ 追问「实在没有了」（不扣5）→ 孩子散去 → 大人乞讨
 *   分支 C：给果子（扣2）→ 追问「再给」（扣5）→ 孩子散去 → 大人乞讨
 *
 * 前置：本地 dev server 在 3000 端口提供 example/sanguo_zhangjiao/index.html
 * 用法：node scripts/probe-s02-beg-branches.mjs
 */
import { createRequire } from 'module';

const require = createRequire('C:/Users/alex/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
});
const log = [];
const step = (name, pass, detail) => { log.push({ name, pass }); console.log(`[${name}] ${pass ? 'PASS' : 'FAIL'} ${detail}`); };

async function newSession() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  await page.goto('http://localhost:3000/example/sanguo_zhangjiao/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
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
  // 自动推进仅清开场/S01 对话；等 S01 开场触发器链处理完再传送（避免与 S02 sceneEnter 事务竞争），
  // 并轮询 currentSceneId=S02 落库（乞讨事实前置条件依赖它）。进乞讨区前必须停掉自动推进，
  // 否则孩童对话被自动跳过、走错分支。
  await page.evaluate(async () => {
    const scene = window.__ddScene;
    const ds = scene.dialogueSystem;
    window.__k = setInterval(() => { try { if (ds?.isDialogueActive?.()) ds.endDialogue(); } catch (e) {} }, 400);
    await new Promise(r => setTimeout(r, 2500));
    await scene.teleportToChunk({ scene: 'S02', spawnRef: 'player', operationId: 'probe-beg:enter' });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 400));
      if (scene.gameLoader?.blackboard?.get?.('storyState')?.currentSceneId === 'S02') break;
    }
    clearInterval(window.__k);
  });
  await page.waitForTimeout(1500);
  return { page, pageErrors };
}

const enterBegZone = page => page.evaluate(async () => {
  const scene = window.__ddScene;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const offset = scene._worldLoadResult?.worldIndex?.getOffset?.('S02') || { x: 0, y: 0 };
  const t = scene.playerEntity?.getComponent?.('transform');
  t.position.x = 650 + (offset.x || 0);
  t.position.y = 440 + (offset.y || 0);
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    if (scene.dialogueSystem?.isDialogueActive?.()) {
      return { id: scene.dialogueSystem.currentDialogue?.id, node: scene.dialogueSystem.currentNode?.id };
    }
  }
  return { id: null, node: null };
});
const grantBerries = (page, n) => page.evaluate(count => {
  const scene = window.__ddScene;
  const inv = scene.playerEntity?.getComponent?.('inventory');
  const def = scene.gameLoader?.registries?.items?.get?.('resource.wild_berry');
  if (!inv || !def) return 'no-inventory-or-def';
  return inv.addItem({ ...def }, count);
}, n);
const berryCount = page => page.evaluate(() => {
  const inv = window.__ddScene?.playerEntity?.getComponent?.('inventory');
  return inv?.getItemCount?.('resource.wild_berry') ?? null;
});
const currentDialogue = page => page.evaluate(() => ({
  id: window.__ddScene?.dialogueSystem?.currentDialogue?.id || null,
  node: window.__ddScene?.dialogueSystem?.currentNode?.id || null
}));
const storyState = page => page.evaluate(() => {
  const s = window.__ddScene?.gameLoader?.blackboard?.get?.('storyState') || {};
  return { children: s.s02BegChildren ?? null, adults: s.s02BegAdults ?? null };
});
const moreChildren = page => page.evaluate(() =>
  (window.__ddScene?.entityStore?.all || [])
    .filter(e => String(e?.placementId || '').startsWith('S02-beg-child-')).length);
const selectChoice = (page, index) => page.evaluate(idx => {
  const ds = window.__ddScene.dialogueSystem;
  const choices = ds?.currentNode?.choices || [];
  const chosen = choices[idx];
  if (!ds?.selectChoice(idx)) return { ok: false, choices: choices.map(c => c.id) };
  return { ok: true, choiceId: chosen?.id || null, node: ds.currentNode?.id || null };
}, index);
const endDialogue = page => page.evaluate(() => window.__ddScene.dialogueSystem.endDialogue());
const closeSession = async (page, pageErrors) => {
  step('pageerrors', pageErrors.length === 0, String(pageErrors.length));
  await page.close();
};

/* ============ 分支 A：全程摇头（孩童摇头 → 大人摇头都不扣物） ============ */
{
  const { page, pageErrors } = await newSession();
  step('A:enter-children', (await enterBegZone(page)).id === 'dialogue.s02.beggarChildren', '孩童乞讨对话弹出');
  step('A:choice-refuse', (await selectChoice(page, 1)).choiceId === 'refuse', '摇头，什么也没给');
  await page.waitForTimeout(500);
  const reply = await currentDialogue(page);
  step('A:refused-reply', reply.id === 'dialogue.s02.beggarChildren' && reply.node === 'refused', JSON.stringify(reply));
  step('A:berries-untouched', (await berryCount(page)) === 0, '摇头不扣野果');
  step('A:no-more-children', (await moreChildren(page)) === 3, '摇头不引来更多孩子');
  await endDialogue(page);
  await page.waitForTimeout(1500);
  const adults = await currentDialogue(page);
  step('A:adults-direct', adults.id === 'dialogue.s02.beggarAdults', '收尾路由直达大人乞讨');
  step('A:story-facts', JSON.stringify(await storyState(page)));
  // 大人阶段：灌 25 野果后摇头，验证不扣
  await grantBerries(page, 25);
  step('A:choice-adults-refuse', (await selectChoice(page, 1)).choiceId === 'refuseAdults', '摇头不给');
  await page.waitForTimeout(500);
  const anger = await currentDialogue(page);
  step('A:anger-node', anger.id === 'dialogue.s02.beggarAdults' && anger.node === 'anger', JSON.stringify(anger));
  step('A:berries-after-adults-refuse', (await berryCount(page)) === 25, '大人摇头不扣野果');
  await endDialogue(page);
  await page.waitForTimeout(1500);
  const confront = await currentDialogue(page);
  step('A:confront-started', confront.id === 'dialogue.s02.beggarConfront', '围攻对话弹出');
  await closeSession(page, pageErrors);
}

/* ============ 分支 B：给果子 → 追问不给（扣2、不扣5） ============ */
{
  const { page, pageErrors } = await newSession();
  await grantBerries(page, 8);
  step('B:enter-children', (await enterBegZone(page)).id === 'dialogue.s02.beggarChildren', '孩童乞讨对话弹出');
  step('B:choice-give', (await selectChoice(page, 0)).choiceId === 'give', '把果子分给这孩子');
  await page.waitForTimeout(500);
  const reply = await currentDialogue(page);
  step('B:more-reply', reply.id === 'dialogue.s02.beggarChildren' && reply.node === 'more', JSON.stringify(reply));
  step('B:berries-after-give', (await berryCount(page)) === 6, '给果子扣2野果');
  // 追问孩子（S02-beg-child-2/3）为场景预置、加载即在場；give 分支补刷幂等不重复生成
  step('B:more-children-no-dup', (await moreChildren(page)) === 3, '追问孩子不重复生成');
  await endDialogue(page);
  await page.waitForTimeout(1500);
  const round2 = await currentDialogue(page);
  step('B:round2-started', round2.id === 'dialogue.s02.beggarChildrenMore', '追问对话启动（断链接通）');
  step('B:choice2-refuse5', (await selectChoice(page, 1)).choiceId === 'refuse5', '实在没有了');
  await page.waitForTimeout(500);
  step('B:berries-after-refuse5', (await berryCount(page)) === 6, '追问不给不扣5野果');
  await endDialogue(page);
  await page.waitForTimeout(1500);
  const adults = await currentDialogue(page);
  step('B:adults-after-scatter', adults.id === 'dialogue.s02.beggarAdults', '孩子散去 → 大人乞讨');
  step('B:story-facts', JSON.stringify(await storyState(page)));
  await closeSession(page, pageErrors);
}

/* ============ 分支 C：给果子 → 再给（扣2 + 扣5） ============ */
{
  const { page, pageErrors } = await newSession();
  await grantBerries(page, 8);
  step('C:enter-children', (await enterBegZone(page)).id === 'dialogue.s02.beggarChildren', '孩童乞讨对话弹出');
  step('C:choice-give', (await selectChoice(page, 0)).choiceId === 'give', '把果子分给这孩子');
  await page.waitForTimeout(500);
  await endDialogue(page);
  await page.waitForTimeout(1500);
  const round2 = await currentDialogue(page);
  step('C:round2-started', round2.id === 'dialogue.s02.beggarChildrenMore', '追问对话启动');
  step('C:choice2-give5', (await selectChoice(page, 0)).choiceId === 'give5', '再给（5颗野果）');
  await page.waitForTimeout(500);
  step('C:berries-after-give5', (await berryCount(page)) === 1, '追问再给扣5野果（8-2-5）');
  await endDialogue(page);
  await page.waitForTimeout(1500);
  const adults = await currentDialogue(page);
  step('C:adults-after-scatter', adults.id === 'dialogue.s02.beggarAdults', '孩子散去 → 大人乞讨');
  step('C:story-facts', JSON.stringify(await storyState(page)));
  await closeSession(page, pageErrors);
}

await browser.close();
const failed = log.filter(entry => !entry.pass);
console.log(failed.length === 0 ? '[SUMMARY] ALL BEG-BRANCH CHECKS PASS' : `[SUMMARY] ${failed.length} FAILED: ${failed.map(f => f.name).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);

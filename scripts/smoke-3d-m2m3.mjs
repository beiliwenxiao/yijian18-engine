// M2/M3 实机冒烟：3D 数据驱动宿主（Scene3DHostScene）战斗/掉落/加工/建造链路
// 运行前提：dev server 运行在 :3457。node scripts/smoke-3d-m2m3.mjs
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const URL = 'http://127.0.0.1:3457/example/sanguo_zhangjiao_3d/index.html';
const SHOT_DIR = '.screenshots';
mkdirSync(SHOT_DIR, { recursive: true });

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
const executablePath = CANDIDATES.find(p => existsSync(p));
if (!executablePath) { console.error('NO_BROWSER'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,800']
});

const errors = [];
const logs = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => errors.push('pageerror: ' + (e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message)));
  page.on('console', m => {
    const text = m.text();
    if (m.type() === 'error') errors.push('console.error: ' + text);
    else logs.push(text);
  });
  page.on('response', r => { if (r.status() >= 400) errors.push(`http${r.status()}: ${r.url()}`); });

  // ---------- 探针 ----------
  const probe = () => page.evaluate(() => {
    const txt = id => (document.getElementById(id)?.textContent || '').trim();
    const steps = [...document.querySelectorAll('#quest-steps li')].map(li => ({
      t: li.textContent.trim(),
      c: li.className
    }));
    // 权威任务态：DOM 面板有签名去重缓存（状态变化不重绘），直接读场景任务机与事实旗标
    const h = window.__s01host;
    const qi = h?.quest?.index ?? -1;
    const qsteps = h?.quest?.steps || [];
    const flags = {};
    if (h) for (const [k, v] of h.storyFlags.entries()) {
      if (k.startsWith('story.s01.')) flags[k.slice('story.s01.'.length)] = v;
    }
    return {
      pos: txt('position'),
      hp: txt('hp'),
      phase: txt('phase'),
      enemies: txt('enemies'),
      questTitle: txt('quest-title'),
      steps,
      questIndex: qi,
      questDone: !!h?.quest?.completed,
      questStepTitles: qsteps.map(s => s.title),
      flags
    };
  });

  const shot = async name => {
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
    console.log(`[shot] ${name}`);
  };
  const log = (tag, p) => console.log(`[${tag}] pos=${p.pos} hp=${p.hp} enemies=${p.enemies} quest[${p.questIndex}]=${p.questStepTitles[p.questIndex] || '(完)'}`);
  // 事实旗标为权威（单调置位，不受面板缓存/索引波动影响）
  const STEP_FACT = {
    '点燃火堆': 'campfireLit',
    '采集荒野酸果': 'berriesGathered',
    '吃下酸果': 'berryEaten',
    '找到破旧斧头': 'axeFound',
    '采集木材': 'woodGathered',
    '给火堆添柴': 'refuelCampfire',
    '杀死饿狼': 'firstWolfKilled',
    '找到剥皮刀': 'skinningKnifeFound',
    '剥下狼皮': 'wolfSkinned',
    '烤制狼肉': 'meatCooked',
    '制作狼皮背心': 'wolfGearCrafted',
    '搭建庇护所': 'shelterCompleted',
    '在庇护所过夜': 'overnight'
  };
  const stepDone = (p, title) => {
    const f = STEP_FACT[title];
    if (f) return !!p.flags[f];
    const i = p.questStepTitles.indexOf(title);
    return i >= 0 && (p.questDone || i < p.questIndex);
  };
  const stepActive = (p, title) => !p.questDone && p.questStepTitles[p.questIndex] === title;

  // 键盘
  const tap = async (key, times = 1, gap = 600) => {
    for (let i = 0; i < times; i++) { await page.keyboard.press(key); await sleep(gap); }
  };
  const hold = async (key, ms) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); };
  const holdKeys = async (keys, ms) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of keys) await page.keyboard.up(k);
  };

  // 位置解析 + 走向目标（自动标定 W/S 的 y 方向）
  let yAxis = null;
  const parsePos = p => { const [x, y] = p.pos.split(',').map(v => parseInt(v, 10)); return { x, y }; };
  const walkTo = async (tx, ty, label, timeoutMs = 26000) => {
    const t0 = Date.now();
    let last = parsePos(await probe());
    if (yAxis === null) {
      await hold('s', 260); await sleep(300);
      const now = parsePos(await probe());
      yAxis = now.y < last.y ? 's-up' : 's-down';
      last = now;
      console.log(`[calibrate] S 键 y 方向: ${yAxis}`);
    }
    const keyFor = (dx, dy) => {
      const keys = [];
      const plusY = yAxis === 's-down' ? 's' : 'w';
      const minusY = yAxis === 's-down' ? 'w' : 's';
      if (dy > 16) keys.push(plusY); else if (dy < -16) keys.push(minusY);
      if (dx > 16) keys.push('d'); else if (dx < -16) keys.push('a');
      return keys;
    };
    while (Date.now() - t0 < timeoutMs) {
      const cur = parsePos(await probe());
      const dx = tx - cur.x, dy = ty - cur.y;
      if (Math.abs(dx) <= 32 && Math.abs(dy) <= 32) { console.log(`[walk] ${label} 到位 (${cur.x},${cur.y})`); return true; }
      const keys = keyFor(dx, dy);
      if (!keys.length) { console.log(`[walk] ${label} 已在容差内 (${cur.x},${cur.y})`); return true; }
      await holdKeys(keys, 260);
      await sleep(140);
    }
    console.log(`[walk] ${label} 超时，当前 ${JSON.stringify(parsePos(await probe()))}`);
    return false;
  };

  // ---------- 启动 ----------
  console.log('[nav] 打开页面…');
  let p = null;
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await sleep(3000);
  // 等待宿主就绪（quest.index ≥ 0 = 工程数据装载完成）；软件渲染提示则 forceInit（最多重试 3 次）
  let booted = false;
  for (let attempt = 0; attempt < 3 && !booted; attempt++) {
    for (let i = 0; i < 12; i++) {
      booted = await page.evaluate(() => (window.__s01host?.quest?.index ?? -1) >= 0);
      if (booted) break;
      const loadingVisible = await page.evaluate(() => {
        const el = document.getElementById('loading-screen');
        return el && el.style.display !== 'none';
      });
      if (loadingVisible) {
        const body = await page.evaluate(() => document.getElementById('loading-screen')?.textContent || '');
        if (body.includes('3D 模式不可用') || body.includes('软件渲染')) {
          console.log('[webgl] 软件渲染提示，forceInit()');
          await page.evaluate(() => window.forceInit && window.forceInit());
        }
      }
      await sleep(1000);
    }
    if (!booted) {
      console.log(`[boot] 第 ${attempt + 1} 次未就绪，重新 forceInit`);
      await page.evaluate(() => window.forceInit && window.forceInit());
      await sleep(5000);
    }
  }
  p = await probe();
  console.log('[ready] pos=' + p.pos + ' questIndex=' + p.questIndex);
  await shot('m3-01-boot');

  // ---------- 开场对话 Space×6 ----------
  await tap(' ', 6, 700);
  await sleep(1500);
  p = await probe(); log('after-dialogue', p);
  await shot('m3-02-after-dialogue');

  // ---------- W 移动教程 + 点燃营火（走到营火绑定点半径内再按 E） ----------
  await walkTo(438, 609, '营火(点燃)', 15000);
  await sleep(800);
  await tap('e', 3, 800);
  await sleep(1800);
  p = await probe(); log('after-campfire', p);
  await shot('m3-03-campfire-lit');
  const campfireOK = stepDone(p, '点燃火堆');
  console.log(`[check1] 点燃火堆done=${campfireOK}`);

  // ---------- 1. 采集野果（487,677） ----------
  await walkTo(487, 677, '野果丛');
  await sleep(800);
  await shot('m3-04-berry-prompt');
  for (let i = 0; i < 3; i++) {
    await tap('e', 1, 500);
    await sleep(1500);
    p = await probe();
    if (stepDone(p, '采集荒野酸果')) break;
  }
  log('after-berry-gather', p);
  await shot('m3-05-berry-gathered');
  const gatherOK = stepDone(p, '采集荒野酸果') && stepActive(p, '吃下酸果');
  console.log(`[check2] 采集荒野酸果done && 吃下酸果active = ${gatherOK}`);

  // 背包：B 打开验证，点击首个物品槽（945,455）使用酸果
  await tap('b', 1, 1200);
  await shot('m3-06-inventory-berries');
  await page.mouse.click(945, 455);
  await sleep(1200);
  p = await probe();
  let eatOK = stepDone(p, '吃下酸果');
  if (!eatOK) {
    await page.mouse.click(1000, 455); // 第二格
    await sleep(1200);
    p = await probe();
    eatOK = stepDone(p, '吃下酸果');
  }
  await shot('m3-07-after-item-click');
  console.log(`[check3] 吃下酸果done(点击使用) = ${eatOK}`);
  await tap('b', 1, 900); // 关闭背包

  // ---------- 2. 拾取破旧斧头（525,703） ----------
  await walkTo(525, 703, '破旧斧头');
  await sleep(800);
  await shot('m3-08-axe-prompt');
  await tap('e', 2, 700);
  await sleep(1500);
  p = await probe(); log('after-axe', p);
  await shot('m3-09-axe-picked');
  const axeOK = stepDone(p, '找到破旧斧头');
  console.log(`[check4] 找到破旧斧头done = ${axeOK}（采集木材步在砍柴教程后激活，终局态再复核）`);
  await tap('b', 1, 1200);
  await shot('m3-10-inventory-axe');
  await tap('b', 1, 900);

  // ---------- 3. 采集枯木（245,348 西北） ----------
  await walkTo(245, 348, '枯木', 34000);
  await sleep(800);
  await shot('m3-11-wood-prompt');
  await tap('e', 2, 800);
  await sleep(1600);
  p = await probe(); log('after-wood', p);
  await shot('m3-12-wood-gathered');
  const woodOK = stepDone(p, '采集木材') && stepActive(p, '给火堆添柴');
  console.log(`[check5] 采集木材done && 给火堆添柴active = ${woodOK}`);

  // ---------- 4. 回营火添柴（绑定半径 54，目标=火堆本体 461,588，须贴紧） ----------
  await walkTo(461, 588, '营火', 34000);
  await sleep(800);
  await shot('m3-13-refuel-prompt');
  await tap('e', 3, 900);
  await sleep(2200);
  p = await probe(); log('after-refuel', p);
  await shot('m3-14-refueled-wolf-spawn');
  const refuelOK = stepDone(p, '给火堆添柴') && stepActive(p, '杀死饿狼');
  const wolfSpawned = parseInt(p.enemies, 10) >= 1;
  console.log(`[check6] 给火堆添柴done && 杀死饿狼active = ${refuelOK}; 敌人数=${p.enemies} wolfSpawned=${wolfSpawned}`);

  // ---------- 5. 战斗：狼主动接近攻击（玩家掉血=战斗中徽章） ----------
  // PC 攻击语义（2026-10-31 裁定）：指针命中可攻击目标时按住左键才出招，点空地不挥击。
  // 命中判定用引擎 2D 相机映射（与 3D 投影不一致），故用反馈跟踪：读当前指针映射世界，
  // 与狼实际世界求误差，直接修正屏幕坐标（scale=1）。
  const mouseWorldNow = () => page.evaluate(() => {
    const h = window.__s01host;
    return h.inputManager.getMouseWorldPosition(h.camera);
  });
  const wolfWorld = () => page.evaluate(() => {
    const h = window.__s01host;
    const wolf = (h?.enemyEntities || [])[0];
    if (!wolf) return null;
    const t = wolf.getComponent('transform');
    const st = wolf.getComponent('stats');
    const pt = h.playerEntity?.getComponent('transform');
    return {
      x: t.position.x, y: t.position.y,
      hp: st?.hp ?? 0, maxHp: st?.maxHp ?? 1,
      px: pt?.position.x ?? 0, py: pt?.position.y ?? 0
    };
  });

  for (let i = 0; i < 8; i++) { await sleep(1200); p = await probe(); if (parseInt(p.enemies, 10) > 0) break; }
  p = await probe(); log('wolf-approaching', p);
  await shot('m3-15-wolf-near');

  // 先按任务口径试 Space（仅作记录——现网 PC 攻击为指针按住，空格无攻击接线）
  await tap(' ', 3, 700);
  await sleep(800);

  // 反馈跟踪 + 按住左键
  let killed = false;
  let wolf = await wolfWorld();
  if (wolf) {
    // 粗定位：从玩家世界位置出发（玩家约在 2D 映射中心 640,400 附近）
    let cur = { x: 640 + (wolf.x - wolf.px), y: 400 + (wolf.y - wolf.py) };
    await page.mouse.move(cur.x, cur.y);
    await sleep(300);
    await page.mouse.down();
    let lastHpChange = Date.now();
    let prevHp = wolf.hp;
    for (let i = 0; i < 90; i++) {
      await sleep(260);
      wolf = await wolfWorld();
      if (!wolf || wolf.hp <= 0) { killed = true; break; }
      if (wolf.hp !== prevHp) { prevHp = wolf.hp; lastHpChange = Date.now(); }
      // 目标点：狼身上；若与玩家重叠则向远离玩家方向偏 42px（狼贴身攻击时指针会命中玩家）
      let tx = wolf.x, ty = wolf.y;
      const dx = wolf.x - wolf.px, dy = wolf.y - wolf.py;
      const d = Math.hypot(dx, dy);
      if (d < 26) {
        const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0;
        tx = wolf.x + ux * 42; ty = wolf.y + uy * 42;
      }
      const mw = await mouseWorldNow();
      cur = { x: cur.x + (tx - mw.x), y: cur.y + (ty - mw.y) };
      await page.mouse.move(cur.x, cur.y);
      p = await probe();
      if (stepDone(p, '杀死饿狼')) { killed = true; break; }
      // 卡住（8s 无伤害）→ 抬起重按（重置目标选择）
      if (Date.now() - lastHpChange > 8000) {
        await page.mouse.up();
        await sleep(180);
        await page.mouse.move(cur.x, cur.y);
        await page.mouse.down();
        lastHpChange = Date.now();
      }
      if (i % 8 === 0) console.log(`[combat] r${i} wolfHp=${wolf.hp}/${wolf.maxHp}`);
    }
    await page.mouse.up().catch(() => {});
  }
  p = await probe();
  killed = killed || stepDone(p, '杀死饿狼');
  console.log(`[combat] 按住左键跟踪后 enemies=${p.enemies} 杀死饿狼done=${killed}`);
  // 死亡结算（尸体/掉落/事实）下一两帧内完成，给足等待
  for (let i = 0; i < 10 && !killed; i++) {
    await sleep(800);
    p = await probe();
    killed = stepDone(p, '杀死饿狼');
  }
  if (!killed) {
    // 兜底：技能 1/2（火系远程）
    for (let i = 0; i < 6 && !killed; i++) {
      await tap('1', 1, 500); await sleep(2800);
      p = await probe(); killed = stepDone(p, '杀死饿狼');
      if (killed) break;
      await tap('2', 1, 500); await sleep(2800);
      p = await probe(); killed = stepDone(p, '杀死饿狼');
    }
  }
  p = await probe(); log('after-kill', p);
  await shot('m3-17-carcass-loot');
  // 杀死饿狼后任务链进入剥皮段（找到剥皮刀为下一步目标，穿过枯树林在链尾）
  const killOK = stepDone(p, '杀死饿狼');
  const nextObj = p.questStepTitles[p.questIndex] || '(完)';
  console.log(`[check7] 杀死饿狼done = ${killOK}; 当前步 = ${nextObj}`);
  // 掉落拾取验证：开背包看狼皮/生狼肉
  await tap('b', 1, 1200);
  await shot('m3-18-inventory-loot');
  await tap('b', 1, 900);

  // ---------- 6. N 键狼群（宿主可能未接线 → 如实报告） ----------
  await tap('n', 2, 1200);
  await sleep(2500);
  p = await probe(); log('after-N', p);
  await shot('m3-19-after-N');
  if (parseInt(p.enemies, 10) < 2) {
    console.log('[wolfpack] N 键未见狼群，尝试向狼群领地行走');
    await walkTo(300, 260, '狼群领地', 18000);
    await sleep(3000);
    p = await probe(); log('after-region', p);
    await shot('m3-20-wolfpack');
  }
  const packCount = parseInt(p.enemies, 10);
  console.log(`[check8] 狼群数量=${packCount}（3 狼 + 狼王期望 ≥4）`);

  // ---------- 汇总 ----------
  const summary = {
    campfireLit: campfireOK,
    berryGather: gatherOK,
    berryEat: eatOK,
    axePickup: axeOK,
    woodGather: woodOK,
    refuelWolfSpawn: refuelOK && wolfSpawned,
    wolfKilled: killOK,
    wolfPackCount: packCount,
    errors: errors.slice(0, 20)
  };
  console.log('====SUMMARY====');
  console.log(JSON.stringify(summary, null, 2));
  const trigLogs = logs.filter(l => l.includes('触发 ') || l.includes('生成敌对') || l.includes('Scene3DHostScene') || l.includes('S01WorldBuilder'));
  writeFileSync(`${SHOT_DIR}/m3-console-triggers.log`, trigLogs.slice(-300).join('\n'), 'utf8');
  writeFileSync(`${SHOT_DIR}/m3-console-errors.log`, errors.join('\n'), 'utf8');
} catch (e) {
  console.error('SMOKE_CRASH', e);
  errors.push('crash: ' + e.message);
  console.log('====SUMMARY====');
  console.log(JSON.stringify({ errors }, null, 2));
} finally {
  await browser.close();
}

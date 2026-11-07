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
 * probe-soul-revive-gamepad.mjs —— 灵魂复活弹窗手柄焦点/摇杆切换实机探针。
 *
 * 验证目标（bug 23.3）：
 *   ① 焦点默认落在「复活」：直接调用 scene.playerSoulRespawn.onAwaitConfirmation
 *      （灵魂复活的真实打开入口），读 view.selectedId
 *   ② 打开瞬间摇杆偏置不抢焦点、不误切换（灵魂状态可移动，玩家常推着摇杆等待）
 *   ③ 松手后再推右 → 焦点切到「取消」；再推左 → 切回「复活」
 *
 * 虚拟手柄在页面脚本运行前注入（addInitScript 覆盖 navigator.getGamepads）。
 * 用法：node scripts/probe-soul-revive-gamepad.mjs
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

await page.addInitScript(() => {
  const BUTTON_COUNT = 17;
  const state = {
    buttons: Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    connected: false
  };
  const pad = {
    index: 0,
    id: 'Probe Virtual Gamepad (Xbox 360)',
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null,
    buttons: state.buttons,
    axes: state.axes
  };
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => (state.connected ? [pad, null, null, null] : [null, null, null, null])
  });
  window.__vpad = {
    press(idx) { state.buttons[idx] = { pressed: true, value: 1 }; },
    release(idx) { state.buttons[idx] = { pressed: false, value: 0 }; },
    setStick(x, y) { state.axes[0] = x; state.axes[1] = y; },
    plug() { state.connected = true; }
  };
  window.__vpad.plug();
});

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

// 关开场对话（对话会拦输入消费）
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

/* ① 摇杆先偏置（模拟玩家推着摇杆等倒计时），再走真实入口打开弹窗 */
await page.evaluate(() => window.__vpad.setStick(-0.9, 0));
await page.waitForTimeout(200);

const opened = await page.evaluate(() => {
  const s = window.__ddScene;
  const view = s.irreversibleChoiceView;
  const soul = s.playerSoulRespawn;
  const hasEntry = typeof soul?.onAwaitConfirmation === 'function';
  if (hasEntry) soul.onAwaitConfirmation({ respawnPosition: { label: '已点燃的火堆旁' } });
  return {
    hasView: Boolean(view),
    hasSoulEntry: hasEntry,
    visible: view?.visible === true,
    variant: view?.snapshot?.presentation?.variant ?? null,
    focus: view?.selectedId ?? null,
    choices: (view?.snapshot?.choices || []).map(choice => choice.id)
  };
});
log('①-open-with-stick-held', opened);
await page.waitForTimeout(500);
const afterHeld = await page.evaluate(() => window.__ddScene.irreversibleChoiceView?.selectedId ?? null);
log('②-held-stick-keeps-focus', { focus: afterHeld });

/* ③ 松手 → 推右 → 应切到「取消」 */
await page.evaluate(() => window.__vpad.setStick(0, 0));
await page.waitForTimeout(180);
await page.evaluate(() => window.__vpad.setStick(0.9, 0));
await page.waitForTimeout(400);
const afterRight = await page.evaluate(() => window.__ddScene.irreversibleChoiceView?.selectedId ?? null);
log('③-push-right-switch', { focus: afterRight });

/* ④ 推左 → 应切回「复活」 */
await page.evaluate(() => window.__vpad.setStick(-0.9, 0));
await page.waitForTimeout(400);
const afterLeft = await page.evaluate(() => window.__ddScene.irreversibleChoiceView?.selectedId ?? null);
log('④-push-left-switch', { focus: afterLeft });
await page.evaluate(() => window.__vpad.setStick(0, 0));

const pass = opened.hasView && opened.visible && opened.variant === 'compact'
  && opened.focus === 'revive'
  && afterHeld === 'revive'
  && afterRight === 'cancel'
  && afterLeft === 'revive';
log('VERDICT', pass
  ? 'PASS —— 灵魂复活弹窗默认焦点在「复活」，打开时摇杆偏置不误切换，松手后左右推可切换'
  : 'FAIL —— 见上方分步数据');

await browser.close();
process.exit(pass ? 0 : 1);

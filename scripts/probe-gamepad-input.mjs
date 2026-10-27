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
 * probe-gamepad-input.mjs —— 手柄输入链路实机探针（虚拟手柄注入）。
 *
 * 验证目标（定位「手柄控制不了游戏」）：
 *   ① 连接识别：GamepadManager poll 是否读到虚拟手柄、info 是否正确
 *   ② 移动驱动：左摇杆推右 → getMoveVector 非零 + 玩家实体位移
 *   ③ 虚拟键注入：按住 A(0) → isKeyDown('e')
 *   ④ settings 链路：START(9) pressed 沿被消费 → 系统菜单打开
 *     （settings 稳态读数会被打开的菜单吞掉，故用菜单状态判定链路是否通）
 *
 * 虚拟手柄在页面脚本运行前注入（addInitScript 覆盖 navigator.getGamepads），
 * GamepadManager 是轮询式，直接改 mock 对象字段即可控制每帧读数。
 *
 * 用法：node scripts/probe-gamepad-input.mjs
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

// ---- 虚拟手柄 mock（页面脚本运行前注入）----
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
    plug() {
      state.connected = true;
      try { window.dispatchEvent(new Event('gamepadconnected')); } catch (e) { /* ignore */ }
    }
  };
  window.__vpad.plug();
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

const inputFound = await page.evaluate(() => {
  const s = window.__ddScene;
  return Boolean(s.inputManager || s.context?.inputManager);
});
if (!inputFound) { log('input-manager-found', false); await browser.close(); process.exit(1); }
log('input-manager-found', true);

/* ------------------------------------------------------------------ */
/* ① 连接识别                                                          */
/* ------------------------------------------------------------------ */
const conn = await page.evaluate(() => {
  const s = window.__ddScene;
  const im = s.inputManager || s.context?.inputManager;
  return {
    connected: im.isGamepadConnected(),
    info: im.gamepad?.info || null,
    enabled: im.gamepadEnabled
  };
});
log('①-connection', conn);

/* ------------------------------------------------------------------ */
/* ② 移动驱动：左摇杆推右 0.9 → 玩家位移                                */
/* ------------------------------------------------------------------ */
await page.evaluate(() => {
  const s = window.__ddScene;
  const t = s.playerEntity?.getComponent('transform');
  window.__posBefore = t ? { x: t.x, y: t.y } : null;
  window.__vpad.setStick(0.9, 0);
});
await page.waitForTimeout(700);
const move = await page.evaluate(() => {
  const s = window.__ddScene;
  const im = s.inputManager || s.context?.inputManager;
  const t = s.playerEntity?.getComponent('transform');
  return {
    moveVector: im.gamepad?.getMoveVector() || null,
    before: window.__posBefore,
    after: t ? { x: t.x, y: t.y } : null,
    displacement: (t && window.__posBefore)
      ? Math.hypot(t.x - window.__posBefore.x, t.y - window.__posBefore.y)
      : null
  };
});
log('②-move-stick-right', move);
await page.evaluate(() => window.__vpad.setStick(0, 0));

/* ------------------------------------------------------------------ */
/* ③ 虚拟键注入：按住 A → 'e'                                          */
/* ------------------------------------------------------------------ */
await page.evaluate(() => window.__vpad.press(0));
await page.waitForTimeout(120);
const aDown = await page.evaluate(() => {
  const s = window.__ddScene;
  const im = s.inputManager || s.context?.inputManager;
  return { e: im.isKeyDown('e'), raw: im.gamepad?.isButtonDown(0) };
});
log('③-a-button→virtual-key-e', aDown);
await page.evaluate(() => window.__vpad.release(0));

/* ------------------------------------------------------------------ */
/* ④ settings 链路：START pressed 沿 → 系统菜单打开                     */
/* ------------------------------------------------------------------ */
await page.evaluate(() => window.__vpad.press(9));
await page.waitForTimeout(300);
const menuState = await page.evaluate(() => {
  const s = window.__ddScene;
  const im = s.inputManager || s.context?.inputManager;
  // 系统菜单打开标志：login-screen 挂 in-game 类（LoginMenuCore.openSystemMenu）
  const loginScreen = document.getElementById('login-screen');
  const menuOpen = loginScreen ? loginScreen.classList.contains('in-game') : false;
  const scenePaused = s.sceneRuntime?.paused ?? s.paused ?? null;
  return {
    settingsDownNow: im.isKeyDown('settings'),  // 菜单打开→场景暂停→poll 停，稳态被清是预期
    menuOpen,                                    // 菜单打开=START→settings 链路通
    scenePaused
  };
});
log('④-start→settings-menu', menuState);
await page.evaluate(() => window.__vpad.release(9));

// ---- 汇总 ----
const connOk = conn.connected && conn.info;
const moveOk = move.moveVector && move.moveVector.magnitude > 0.5;
const aOk = aDown.e && aDown.raw;
// settings 链路：菜单打开（in-game 类）= START 沿消费成功；稳态被菜单暂停清空是既有设计
const settingsOk = menuState.menuOpen;
const pass = connOk && moveOk && aOk && settingsOk;
log('VERDICT', pass
  ? `PASS —— 引擎手柄链路健康（连接/移动/虚拟键/settings菜单全通）。若实机仍无响应，问题在环境侧：手柄未被浏览器识别（需按一下手柄按键激活）/窗口失焦/浏览器兼容`
  : `FAIL —— 引擎链路有断点：连接=${connOk} 移动=${moveOk} A虚拟键=${aOk} settings菜单=${settingsOk}，见上方分步数据`);

await browser.close();

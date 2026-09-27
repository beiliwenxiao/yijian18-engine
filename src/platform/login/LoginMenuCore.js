// 登录菜单核心：新档档案/项目配置与登录布局/系统菜单/登录手柄导航/启动菜单。抽取自 example/sanguo_zhangjiao/index.html，跨模块状态经 shell 宿主读写。
import { PlatformProfile } from '../../core/PlatformProfile.js';
import { GamepadManager } from '../../core/input/GamepadManager.js';
import { PadButton, SETTINGS_ACTION } from '../../core/input/Xbox360Profile.js';

export function createLoginMenuCore(shell) {
const loginScreen = document.getElementById('login-screen');
const loginPanel = document.getElementById('login-panel');
const loginTitle = document.getElementById('login-title');
const loginSubtitle = document.getElementById('login-subtitle');
const loginDescription = document.getElementById('login-description');
const loginMessage = document.getElementById('login-message');

let newGameProfileOpener = null;
const NEW_GAME_DEFAULT_NICKNAME = '柔弱女子';

const newGameProfileModal = document.getElementById('new-game-profile-modal');
const newGameProfileConfirm = document.getElementById('new-game-profile-confirm');
const newGameProfileCancel = document.getElementById('new-game-profile-cancel');
const newGameProfileClose = document.getElementById('new-game-profile-close');
const newGameNickname = document.getElementById('new-game-nickname');
const newGameGenderFemale = document.getElementById('new-game-gender-female');
const newGameGenderMale = document.getElementById('new-game-gender-male');
const newGameGenderNote = document.getElementById('new-game-gender-note');

function applyNewGameProfile() {
    const nickname = newGameNickname.value.trim().slice(0, 16) || NEW_GAME_DEFAULT_NICKNAME;
    newGameNickname.value = nickname;
    shell.SelectedCharacterStore.set({ ...shell.SelectedCharacterStore.get(), name: nickname, gender: 'female' });
    return nickname;
}

newGameGenderFemale.addEventListener('change', () => {
    if (!newGameGenderFemale.checked) return;
    newGameGenderNote.textContent = '';
});
newGameGenderMale.addEventListener('change', () => {
    if (!newGameGenderMale.checked) return;
    newGameGenderFemale.checked = true;
    newGameGenderNote.textContent = '当前没有男角色的图片，只能选择女角色。';
});

function isNewGameProfileOpen() {
    return !newGameProfileModal.classList.contains('hidden');
}

function openNewGameProfile() {
    if (!newGameNickname.value.trim()) newGameNickname.value = NEW_GAME_DEFAULT_NICKNAME;
    newGameGenderFemale.checked = true;
    newGameGenderNote.textContent = '';
    newGameProfileOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    newGameProfileModal.classList.remove('hidden');
    newGameProfileModal.setAttribute('aria-hidden', 'false');
    menuPadIndex = 0;
    requestAnimationFrame(() => newGameNickname.focus());
}

function closeNewGameProfile({ restoreFocus = true } = {}) {
    const opener = newGameProfileOpener;
    newGameProfileModal.classList.add('hidden');
    newGameProfileModal.setAttribute('aria-hidden', 'true');
    newGameProfileOpener = null;
    menuPadIndex = 0;
    // 焦点不得留在 aria-hidden 弹窗内（无障碍警告）：关闭后统一移回可见的安全位置
    if (newGameProfileModal.contains(document.activeElement)) {
        refocusAfterModalClose(opener, restoreFocus);
        return;
    }
    if (restoreFocus && opener?.isConnected && !loginScreen.classList.contains('hidden')) opener.focus();
}

/** 弹窗关闭兜底：优先还原触发者（可见时），否则落到当前场景第一个可见的菜单动作按钮。 */
function refocusAfterModalClose(opener, restoreFocus) {
    if (restoreFocus && opener?.isConnected && !loginScreen.classList.contains('hidden')
      && opener.offsetParent !== null) {
        opener.focus();
        return;
    }
    focusFirstMenuAction();
}

/** 把焦点落到当前可见的第一个菜单动作按钮（按场景分列后登录/游戏内各不相同）。 */
function focusFirstMenuAction() {
    const fallback = Array.from(loginScreen.querySelectorAll('.login-action'))
        .find(button => button.offsetParent !== null && !button.disabled);
    (fallback || document.getElementById('login-start'))?.focus();
}

async function confirmNewGameProfile() {
    applyNewGameProfile();
    closeNewGameProfile({ restoreFocus: false });
    setLoginMessage('请选择手动存档栏位。');
    await shell.renderSaveSlots('new');
}

async function loadProjectConfig() {
    if (shell.projectConfig) return shell.projectConfig;
    try {
        const response = await fetch('game.project.json');
        if (response.ok) shell.projectConfig = await response.json();
    } catch (error) {
        console.warn('读取项目配置失败，使用登录页默认值', error);
    }
    return shell.projectConfig || {};
}

function applyLoginConfig(config = {}) {
    if (config.title) loginTitle.textContent = config.title;
    if (config.subtitle) loginSubtitle.textContent = config.subtitle;
    if (config.description) loginDescription.textContent = config.description;
    const showDescription = config.showDescription ?? config.showText ?? true;
    loginScreen.classList.toggle('text-hidden', showDescription === false);
    if (config.backgroundColor) loginScreen.style.backgroundColor = config.backgroundColor;
    if (config.backgroundImage) {
        const safeUrl = String(config.backgroundImage).replace(/["'()]/g, '');
        loginScreen.style.backgroundImage = `url("${safeUrl}")`;
    } else {
        loginScreen.style.backgroundImage = 'none';
    }
    if (config.textColor) {
        loginPanel.style.color = config.textColor;
        loginDescription.style.color = config.textColor;
    }
    if (config.titleColor) loginTitle.style.color = config.titleColor;
    loginPanel.style.removeProperty('background');
    if (config.panelColor) loginPanel.style.setProperty('--login-panel-color', config.panelColor);
    else loginPanel.style.removeProperty('--login-panel-color');
    if (config.buttonColor) {
        document.querySelectorAll('.login-action').forEach(button => { button.style.background = config.buttonColor; });
    }
}

// 登录页独立布局：PC 与 Android 分别由 UI 编辑器保存，
// 不与游戏内 PC/Android HUD 布局混用。
const LOGIN_LAYOUT_FILES = Object.freeze({
    desktop: 'LoginLayout.desktop.json',
    mobile: 'LoginLayout.mobile.json'
});
const LEGACY_LOGIN_LAYOUT_FILE = 'LoginLayout.json';
const loginLayouts = new Map();
const LOGIN_LAYOUT_IDS = ['login-panel', 'login-title', 'login-subtitle', 'login-description', 'login-actions'];

function getLoginLayoutPlatform() {
    return PlatformProfile.isMobile ? 'mobile' : 'desktop';
}

async function loadLoginLayout(platform) {
    const cached = loginLayouts.get(platform);
    if (cached) return cached;
    const fileNames = [LOGIN_LAYOUT_FILES[platform], LEGACY_LOGIN_LAYOUT_FILE];
    for (const fileName of fileNames) {
        try {
            const response = await fetch(`config/${fileName}`);
            if (!response.ok) continue;
            const loaded = await response.json();
            if (!Array.isArray(loaded?.components)) continue;
            loginLayouts.set(platform, loaded);
            return loaded;
        } catch (_error) {
            // 文件不存在或读取失败时继续尝试兼容布局；最终回退到 CSS 默认布局。
        }
    }
    return null;
}

function clearLoginLayout() {
    for (const id of LOGIN_LAYOUT_IDS) {
        const element = document.getElementById(id);
        if (!element) continue;
        for (const property of ['position', 'left', 'top', 'width', 'height', 'margin', 'display', 'justify-items']) {
            element.style.removeProperty(property);
        }
    }
    loginPanel.querySelectorAll('.login-action').forEach(button => {
        button.style.removeProperty('width');
        button.style.removeProperty('height');
        button.style.removeProperty('padding');
    });
}

function getLoginLayoutRect(component, layout, width, height) {
    const canvasWidth = Number(layout.canvas?.width) || width;
    const canvasHeight = Number(layout.canvas?.height) || height;
    const xPct = Number.isFinite(component.xPct) ? component.xPct : (Number(component.x) || 0) / canvasWidth;
    const yPct = Number.isFinite(component.yPct) ? component.yPct : (Number(component.y) || 0) / canvasHeight;
    const wPct = Number.isFinite(component.wPct) ? component.wPct : (Number(component.width) || 0) / canvasWidth;
    const hPct = Number.isFinite(component.hPct) ? component.hPct : (Number(component.height) || 0) / canvasHeight;
    return {
        x: Math.round(xPct * width),
        y: Math.round(yPct * height),
        width: Math.round(wPct * width),
        height: Math.round(hPct * height)
    };
}

/** 应用 UI 编辑器保存的对应平台登录页布局；独立存档弹窗不参与登录页布局。 */
async function applyLoginLayout() {
    if (loginScreen.classList.contains('in-game')) {
        clearLoginLayout();
        return false;
    }
    const loginLayout = await loadLoginLayout(getLoginLayoutPlatform());
    if (!loginLayout) return false; // 文件不存在时沿用 CSS 回退布局

    const componentMap = new Map(loginLayout.components.map(component => [component.id, component]));
    const panelComponent = componentMap.get('login-panel');
    if (!panelComponent) return false;
    const width = loginScreen.clientWidth || window.innerWidth;
    const height = loginScreen.clientHeight || window.innerHeight;
    const panelRect = getLoginLayoutRect(panelComponent, loginLayout, width, height);
    loginPanel.style.position = 'absolute';
    loginPanel.style.left = `${panelRect.x}px`;
    loginPanel.style.top = `${panelRect.y}px`;
    loginPanel.style.width = `${panelRect.width}px`;
    loginPanel.style.height = `${panelRect.height}px`;

    for (const id of LOGIN_LAYOUT_IDS.slice(1)) {
        const component = componentMap.get(id);
        const element = document.getElementById(id);
        if (!component || !element) continue;
        const rect = getLoginLayoutRect(component, loginLayout, width, height);
        element.style.position = 'absolute';
        element.style.left = `${rect.x - panelRect.x}px`;
        element.style.top = `${rect.y - panelRect.y}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.margin = '0';
        if (id === 'login-actions') {
            element.style.display = 'grid';
            element.style.justifyItems = 'center';
            // 游戏内打开系统菜单时立即显示，首次加载时保持 opacity: 0 等待 bootGameMenu
            if (loginScreen.classList.contains('in-game')) {
                element.style.opacity = '1';
            }
            element.querySelectorAll('.login-action').forEach(button => {
                button.style.width = '100%';
                button.style.height = '100%';
                button.style.padding = '0';
            });
        }
    }
    return true;
}

// 系统菜单打开/关闭时，自动在响应式布局与编辑器登录布局之间切换。
const refreshLoginLayout = () => { void applyLoginLayout(); };
new MutationObserver(refreshLoginLayout)
    .observe(loginPanel, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(refreshLoginLayout)
    .observe(loginScreen, { attributes: true, attributeFilter: ['class'] });

function setLoginMessage(message = '') {
    loginMessage.textContent = message;
    if (!shell.savePickerModal.classList.contains('hidden')) shell.savePickerMessage.textContent = message;
}

async function openSystemMenu() {
    shell.closeSavePicker({ restoreFocus: false });
    // 用户裁定：开启/关闭系统菜单与存档列表不再触发自动存档（节奏=每 5 分钟定时 + 每次场景切换）
    if (shell.gameStarted) {
        shell.scene?.pause?.();
        loginScreen.classList.add('in-game');
    } else {
        loginScreen.classList.remove('in-game');
    }
    await shell.refreshContinueGameAction();
    setLoginMessage('');
    // 预武装：打开菜单时摇杆可能仍偏转（如跑动中按 Start），
    // 不要求先归中即可立即导航（仍按方向变化离散步进）。
    menuPadArmed = true;
    menuPadForceArmed = true;
    menuPadOpenedAt = performance.now();
    menuPadDirection = 0;
    menuPadIndex = 0;
    loginScreen.classList.remove('hidden');
    // 游戏内「开始游戏/继续游戏」已按场景隐藏，焦点落到第一个可见可用选项
    focusFirstMenuAction();
    resumeLoginGamepadPolling();
}

function closeSystemMenu() {
    if (!shell.gameStarted) return;
    pauseLoginGamepadPolling();
    shell.closeSavePicker({ restoreFocus: false });
    loginScreen.classList.add('hidden');
    loginScreen.classList.remove('in-game');
    shell.scene?.resume?.();
    shell.lastTime = performance.now();
}

async function exitGame() {
    await shell.autoSaveCurrentGame({ reason: 'exit' });
    const app = globalThis.Capacitor?.Plugins?.App;
    if (app?.exitApp) {
        app.exitApp();
        return;
    }
    window.close();
    setLoginMessage('浏览器不允许网页主动关闭，请关闭当前标签页。');
}

document.getElementById('login-start').addEventListener('click', () => {
    setLoginMessage('请设置昵称与性别。');
    openNewGameProfile();
});

document.getElementById('login-return-game').addEventListener('click', closeSystemMenu);

newGameProfileConfirm.addEventListener('click', confirmNewGameProfile);
newGameProfileCancel.addEventListener('click', () => closeNewGameProfile());
newGameProfileClose.addEventListener('click', () => closeNewGameProfile());
newGameProfileModal.addEventListener('click', event => {
    if (event.target === newGameProfileModal) closeNewGameProfile();
});
newGameNickname.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        confirmNewGameProfile();
    }
});

document.getElementById('login-exit').addEventListener('click', exitGame);
document.getElementById('login-close').addEventListener('click', closeSystemMenu);
window.addEventListener('keydown', event => {
    if (loginScreen.classList.contains('hidden')) return;
    if (shell.isOverwriteConfirmationOpen()) {
        if (event.key === 'Escape') {
            event.preventDefault();
            shell.settleOverwriteConfirmation(false);
        } else if (event.key === 'Tab') {
            event.preventDefault();
            const buttons = [shell.overwriteConfirmAccept, shell.overwriteConfirmCancel];
            const currentIndex = buttons.indexOf(document.activeElement);
            const step = event.shiftKey ? -1 : 1;
            const nextIndex = (currentIndex + step + buttons.length) % buttons.length;
            buttons[nextIndex].focus();
        }
        return;
    }
    if (event.key !== 'Escape') return;
    if (isNewGameProfileOpen()) {
        event.preventDefault();
        closeNewGameProfile();
        return;
    }
    if (shell.isSavePickerOpen()) {
        event.preventDefault();
        shell.closeSavePicker();
        return;
    }
    if (loginScreen.classList.contains('in-game')) {
        event.preventDefault();
        closeSystemMenu();
    }
});

// 登录层不依赖活动场景，但复用正式 GamepadManager、Xbox360Profile 与项目绑定配置。
let menuPadArmed = false;
let menuPadForceArmed = false; // 程序预武装：打开菜单时的摇杆偏转/Start 残留不撤销武装
let menuPadOpenedAt = 0;       // 打开时刻：窗口期内忽略 cancel 边沿，防 Start 按住误关菜单
let menuPadDirection = 0;
let menuPadIndex = 0;
let loginGamepadManager = null;
let loginGamepadRafId = null;
let loginGamepadGeneration = 0;
let loginGamepadPollingRequested = false;
let loginGamepadInitPromise = null;
let loginGamepadActionButtons = { confirm: [], cancel: [], settings: [] };

function refreshLoginGamepadActionButtons() {
    const bindings = loginGamepadManager?.getBindings?.() || {};
    const findButtons = action => Object.entries(bindings)
        .filter(([, boundAction]) => boundAction === action)
        .map(([index]) => Number(index))
        .filter(Number.isInteger);
    loginGamepadActionButtons = {
        confirm: findButtons('e'),
        cancel: findButtons('escape'),
        settings: findButtons(SETTINGS_ACTION)
    };
}

function resetLoginGamepadNavigation() {
    menuPadArmed = false;
    menuPadForceArmed = false;
    menuPadDirection = 0;
}

function isAnyMenuButtonDown(indices) {
    return indices.some(index => loginGamepadManager?.isButtonDown(index));
}

function isAnyMenuButtonPressed(indices) {
    return indices.some(index => loginGamepadManager?.isButtonPressed(index));
}

function scheduleLoginGamepadPoll() {
    if (!loginGamepadPollingRequested || !loginGamepadManager || loginGamepadRafId !== null) return;
    const generation = loginGamepadGeneration;
    loginGamepadRafId = requestAnimationFrame(() => pollLoginGamepad(generation));
}

function pollLoginGamepad(generation) {
    loginGamepadRafId = null;
    if (generation !== loginGamepadGeneration || !loginGamepadPollingRequested || !loginGamepadManager) return;

    const connected = loginGamepadManager.poll();
    if (!loginScreen.classList.contains('hidden') && connected) {
        const move = loginGamepadManager.getMoveVector();
        const direction = move.y < 0 ? -1 : (move.y > 0 ? 1 : 0);
        const confirmDown = isAnyMenuButtonDown(loginGamepadActionButtons.confirm);
        const cancelDown = loginGamepadManager.isButtonDown(PadButton.B)
            || isAnyMenuButtonDown(loginGamepadActionButtons.cancel)
            || isAnyMenuButtonDown(loginGamepadActionButtons.settings);
        const isConfirmingOverwrite = shell.isOverwriteConfirmationOpen();
        const isEditingProfile = !isConfirmingOverwrite && isNewGameProfileOpen();
        const isPickingSave = !isConfirmingOverwrite && shell.saveSlotsElement.classList.contains('visible');
        const active = isConfirmingOverwrite
            ? [shell.overwriteConfirmAccept, shell.overwriteConfirmCancel]
            : isPickingSave
                ? [shell.saveSlotConfirm]
                : isEditingProfile
                    ? [newGameProfileConfirm, newGameProfileCancel]
                    : Array.from(loginScreen.querySelectorAll('.login-action'))
                        .filter(button => button.offsetParent !== null && !button.disabled);

        if (!menuPadArmed) {
            // 程序预武装（menuPadForceArmed）保持到输入全中性：跑动中按 Start 打开菜单时
            // 摇杆仍偏转/Start 仍按住，若按"归中+无按键"重新武装会导致菜单导航长期失效。
            if (menuPadForceArmed) {
                menuPadArmed = true;
                if (!confirmDown && !cancelDown && direction === 0) menuPadForceArmed = false;
            } else {
                menuPadArmed = !confirmDown && !cancelDown && direction === 0;
            }
        } else {
            if (active.length > 0) menuPadIndex = Math.min(menuPadIndex, active.length - 1);
            else menuPadIndex = 0;

            if (isPickingSave && direction && direction !== menuPadDirection) {
                const options = shell.getSavePickerEntries().filter(entry => !entry.disabled);
                if (options.length > 0) {
                    const currentIndex = options.findIndex(entry => entry.value === shell.getSelectedSaveValue());
                    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
                    const nextIndex = (baseIndex + direction + options.length) % options.length;
                    const nextEntry = options[nextIndex];
                    if (nextEntry) {
                        shell.selectSaveEntry(nextEntry.value, { focus: true });
                    }
                }
            } else if (!isPickingSave && direction && direction !== menuPadDirection && active.length) {
                menuPadIndex = (menuPadIndex + direction + active.length) % active.length;
                active[menuPadIndex].focus();
            }

            if (isAnyMenuButtonPressed(loginGamepadActionButtons.confirm)) {
                if (isConfirmingOverwrite) active[menuPadIndex]?.click();
                else if (isPickingSave) shell.handleSavePickerConfirm();
                else active[menuPadIndex]?.click();
            }

            const cancelPressed = (performance.now() - menuPadOpenedAt > 300)
              && (loginGamepadManager.isButtonPressed(PadButton.B)
                || isAnyMenuButtonPressed(loginGamepadActionButtons.cancel)
                || isAnyMenuButtonPressed(loginGamepadActionButtons.settings));
            if (cancelPressed) {
                if (isConfirmingOverwrite) shell.settleOverwriteConfirmation(false);
                else if (isPickingSave) shell.closeSavePicker();
                else if (isEditingProfile) closeNewGameProfile();
                else if (loginScreen.classList.contains('in-game')) closeSystemMenu();
            }
        }
        menuPadDirection = direction;
    } else {
        resetLoginGamepadNavigation();
    }
    scheduleLoginGamepadPoll();
}

async function initializeLoginGamepad() {
    if (loginGamepadManager) return loginGamepadManager;
    if (loginGamepadInitPromise) return loginGamepadInitPromise;
    const generation = loginGamepadGeneration;
    const manager = new GamepadManager();
    const pending = (async () => {
        try {
            const response = await fetch('./config/gamepad.json');
            if (response.ok) manager.applyConfig(await response.json());
            else console.warn('登录页手柄配置加载失败', { status: response.status });
        } catch (error) {
            console.warn('登录页手柄配置加载失败，沿用框架默认绑定', error);
        }
        if (generation !== loginGamepadGeneration) {
            manager.destroy();
            return null;
        }
        loginGamepadManager = manager;
        refreshLoginGamepadActionButtons();
        scheduleLoginGamepadPoll();
        return manager;
    })();
    loginGamepadInitPromise = pending;
    try {
        return await pending;
    } finally {
        if (loginGamepadInitPromise === pending) loginGamepadInitPromise = null;
    }
}

function resumeLoginGamepadPolling() {
    loginGamepadPollingRequested = true;
    if (!loginGamepadManager) void initializeLoginGamepad();
    else scheduleLoginGamepadPoll();
}

function pauseLoginGamepadPolling() {
    loginGamepadPollingRequested = false;
    if (loginGamepadRafId !== null) cancelAnimationFrame(loginGamepadRafId);
    loginGamepadRafId = null;
    resetLoginGamepadNavigation();
}

function destroyLoginGamepad() {
    loginGamepadGeneration += 1;
    pauseLoginGamepadPolling();
    loginGamepadManager?.destroy();
    loginGamepadManager = null;
    loginGamepadActionButtons = { confirm: [], cancel: [], settings: [] };
}

void initializeLoginGamepad();
globalThis.__openSystemMenu = openSystemMenu;
window.addEventListener('pagehide', () => {
    destroyLoginGamepad();
    void shell.autoSaveCurrentGame({ reason: 'pagehide' });
});
window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    if (!loginScreen.classList.contains('hidden')) resumeLoginGamepadPolling();
    else void initializeLoginGamepad();
});

async function bootGameMenu() {
    const project = await loadProjectConfig();
    applyLoginConfig(project.system?.login || {});
    await applyLoginLayout();
    const rawCommand = sessionStorage.getItem('yijian18:boot-command');
    if (rawCommand) {
        sessionStorage.removeItem('yijian18:boot-command');
        try {
            const command = JSON.parse(rawCommand);
            if (command.mode === 'new' && command.profile) {
                shell.SelectedCharacterStore.set(command.profile);
            }
            const selection = command.selection || { kind: 'manual', index: command.slotIndex || 1 };
            shell.startGameFromSelection(command.mode, selection);
            return;
        } catch (_error) { /* 回到登录界面 */ }
    }
    shell.loadingScreen.style.display = 'none';
    openSystemMenu();

    // 页面加载完成后显示 login-actions
    requestAnimationFrame(() => {
        const loginActions = document.querySelector('.login-actions');
        if (loginActions) {
            loginActions.style.display = 'grid';
            requestAnimationFrame(() => {
                loginActions.style.opacity = '1';
            });
        }
    });
}

    function armMenuPadNavigation() {
        menuPadArmed = true;
        menuPadDirection = 0;
        menuPadIndex = 0;
    }

    function resetMenuPadIndex() {
        menuPadIndex = 0;
    }

    return {
        loginScreen,
        loginMessage,
        setLoginMessage,
        loadProjectConfig,
        applyLoginLayout,
        openSystemMenu,
        armMenuPadNavigation,
        resetMenuPadIndex,
        pauseLoginGamepadPolling,
        bootGameMenu
    };
}

// 触控核心：屏幕触控按钮接线/新手引导 DOM 状态/UI 布局应用/竖屏横排与指针变换。抽取自 example/sanguo_zhangjiao/index.html，跨模块状态经 shell 宿主读写。
import { setupVirtualJoystick } from './VirtualJoystickCore.js';
import { createSkillAimTouchCore, AIM_SKILLS, ATTACK_AIM_INDEX, THROW_AIM_INDEX, FLIGHT_AIM_INDEX } from './SkillAimTouchCore.js';

export function createTouchControlsCore(shell) {
// ============ 屏幕触控按钮接线 ============

const onboardingDomStates = new Map();

function applyOnboardingDomState(componentId, element) {
    if (!element) return;
    const state = onboardingDomStates.get(componentId) || {};
    const visible = state.visible !== false;
    const enabled = state.enabled !== false;
    element.classList.toggle('onboarding-hidden', !visible);
    element.classList.toggle('onboarding-disabled', visible && !enabled);
    element.classList.toggle('onboarding-highlight', visible && state.highlighted === true);
    element.dataset.onboardingEnabled = enabled ? 'true' : 'false';
    if (!visible) element.setAttribute('aria-hidden', 'true');
    else element.removeAttribute('aria-hidden');
    element.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function isOnboardingDomEnabled(element) {
    return element?.dataset?.onboardingEnabled !== 'false';
}

// Android Web 接收与 Canvas/微信相同的 componentId 投影；微信小游戏没有 DOM，自动跳过该 adapter。
window.addEventListener('yijian18:onboarding-ui', event => {
    const states = event?.detail?.states || {};
    onboardingDomStates.clear();
    for (const [componentId, state] of Object.entries(states)) onboardingDomStates.set(componentId, state || {});
    for (const [componentId] of onboardingDomStates) {
        applyOnboardingDomState(componentId, document.getElementById(componentId === 'joystick' ? 'joystick-zone' : componentId));
    }
});

function setupTouchControls() {
    const touchControls = document.getElementById('touch-controls');
    if (!touchControls) return;

    // 触屏设备才显示（也可在桌面用鼠标按下测试）
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (isTouch) {
        touchControls.classList.add('active');
    }

    // ===== 左下角虚拟摇杆 =====
    // 手指按住时显示一个 90° 扇形圆周 + 圆周上的方向小箭头，
    // 通过派发方向键事件复用 InputManager / MovementSystem。
    const dirKey = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

    function pressKey(key) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    function releaseKey(key) {
        window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    }

    setupVirtualJoystick(pressKey, releaseKey, dirKey);

    // 功能按钮（技能 / 攻击 / 轻功 / 投掷 / 药品 / 背包 / 装备）
    function triggerAction(btn) {
        if (!isOnboardingDomEnabled(btn)) return;
        const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;
        if (!currentScene) return;
        if (btn.dataset.skill !== undefined) {
            const idx = parseInt(btn.dataset.skill, 10);
            // 复用框架场景的按索引释放技能（按角色朝向）
            if (currentScene.useSkillByIndex) currentScene.useSkillByIndex(idx);
        } else if (btn.dataset.potion !== undefined) {
            // 可使用物品：生命/魔法药水
            if (currentScene.usePotionFromHotbar) currentScene.usePotionFromHotbar(btn.dataset.potion);
        } else if (btn.dataset.act === 'attack') {
            // 攻击按钮现在走瞄准流程,此处不再触发
        } else if (btn.dataset.act === 'block') {
            // 格挡按钮
            if (currentScene.activateBlock) currentScene.activateBlock();
        } else if (btn.dataset.act === 'interact') {
            // 交互按钮直接进入统一 InputActionRouter；不再夹带旧 N 场景推进。
            enqueueSceneInteract();
        } else if (btn.dataset.act === 'axe') {
            // 斧头/采集按钮是统一交互按钮的兼容 UI 别名。
            enqueueSceneInteract();
        } else if (btn.dataset.act === 'flight') {
            // 轻功现在走瞄准流程,此处不再触发
        } else if (btn.dataset.act === 'jump') {
            // 触屏跳跃改为蓄力：按住设置保持标志（帧轮询驱动蓄力），松手时释放起跳。
            if (currentScene.setJumpHeld) currentScene.setJumpHeld(true);
        } else if (btn.dataset.act === 'throw') {
            // 投掷现在走瞄准流程,此处不再触发
        } else if (btn.dataset.action === 'bag') {
            if (currentScene.inventoryPanel) currentScene.inventoryPanel.toggle();
        } else if (btn.dataset.action === 'army') {
            // 军队按钮：开关军队操作条（编组/姿态命令 HUD）
            currentScene.toggleArmyCommandHud?.();
        } else if (btn.dataset.action === 'settings') {
            currentScene.openSystemMenu?.();
        } else if (btn.dataset.action === 'char') {
            // 装备栏 = PlayerInfoPanel
            if (currentScene.playerInfoPanel) currentScene.playerInfoPanel.toggle();
        }
    }

    // 移动端交互优先直接入队；旧场景没有公开入口时才回退合成 E。
    function enqueueSceneInteract() {
        const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;
        if (currentScene?.enqueueInteract) currentScene.enqueueInteract('touch');
        else tapKey('e');
    }

    // 兼容旧控件的点按型虚拟按键。
    const keyMap = { e: 'e' };
    function tapKey(key) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        // 稍后释放，确保 isKeyDown 在至少一帧内为 true
        setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
        }, 160);
    }

    // 圆形动作按钮 + 底部快捷栏按钮，统一绑定
    // 用 lastTouchTime 防止触摸后浏览器合成的 mouse 事件造成"双触发"
    let lastTouchTime = 0;

    // 技能瞄准核心：状态/渲染/窗口级拖拽监听内聚在本工厂，按钮接线经 skillAimApi 调用。
    const skillAimApi = createSkillAimTouchCore(shell);

    document.querySelectorAll('.action-btn, .hotbar-btn').forEach(btn => {
        const isAimSkill = btn.dataset.skill !== undefined && AIM_SKILLS.has(parseInt(btn.dataset.skill, 10));
        const isAttackBtn = btn.dataset.act === 'attack';
        const isThrowBtn = btn.dataset.act === 'throw';
        const isFlightBtn = btn.dataset.act === 'flight';
        const isAimBtn = isAimSkill || isAttackBtn || isThrowBtn || isFlightBtn;

        const doPress = (clientX, clientY, touchId) => {
            if (!isOnboardingDomEnabled(btn)) return;
            btn.classList.add('pressed');
            // 教学高亮一次性熄灭：高亮按钮首次点击时回调（与 PC Canvas 按钮一致），
            // 经 OnboardingUiProjection 记入 storyState.onboardingDismissed，跨会话不再点亮。
            if (btn.classList.contains('onboarding-highlight')) {
                const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;
                currentScene?.notifyOnboardingControlActivated?.(btn.id);
            }
            if (isAimSkill) {
                // 进入技能瞄准模式
                skillAimApi.startSkillAim(btn, parseInt(btn.dataset.skill, 10), clientX, clientY, touchId);
            } else if (isAttackBtn) {
                // 攻击按钮始终进入瞄准模式
                skillAimApi.startSkillAim(btn, ATTACK_AIM_INDEX, clientX, clientY, touchId);
            } else if (isThrowBtn) {
                // 投掷按钮进入瞄准模式
                skillAimApi.startSkillAim(btn, THROW_AIM_INDEX, clientX, clientY, touchId);
            } else if (isFlightBtn) {
                // 轻功按钮进入瞄准模式
                skillAimApi.startSkillAim(btn, FLIGHT_AIM_INDEX, clientX, clientY, touchId);
            } else if (btn.dataset.act === 'interact') {
                // 交互按钮直接进入统一 InputActionRouter。
                enqueueSceneInteract();
            } else if (btn.dataset.act === 'axe') {
                // 斧头/采集按钮是统一交互按钮的兼容 UI 别名。
                enqueueSceneInteract();
            } else if (btn.dataset.act === 'block') {
                // 格挡按钮：直接激活
                const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;
                if (currentScene && currentScene.activateBlock) currentScene.activateBlock();
            } else if (btn.dataset.key !== undefined) {
                tapKey(keyMap[btn.dataset.key] || btn.dataset.key);
            } else {
                triggerAction(btn);
            }
        };
        const onTouch = (e) => {
            e.preventDefault();
            e.stopPropagation();
            lastTouchTime = Date.now();
            const t = e.changedTouches[0];
            doPress(t.clientX, t.clientY, t.identifier);
        };
        const onMouse = (e) => {
            if (Date.now() - lastTouchTime < 600) return;
            e.preventDefault();
            e.stopPropagation();
            doPress(e.clientX, e.clientY, -1);
        };
        const release = (e) => {
            e.preventDefault();
            if (isAimBtn && skillAimApi.isSkillAimActive()) {
                // 瞄准按钮释放由全局 touchend/mouseup 处理
                return;
            }
            btn.classList.remove('pressed');
            // 触屏跳跃按钮：松手清除保持标志，帧轮询随即按蓄力时间起跳。
            if (btn.dataset.act === 'jump') {
                const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;
                if (currentScene && currentScene.setJumpHeld) currentScene.setJumpHeld(false);
            }
        };
        btn.addEventListener('touchstart', onTouch, { passive: false });
        btn.addEventListener('touchend', release, { passive: false });
        btn.addEventListener('touchcancel', release, { passive: false });
        btn.addEventListener('mousedown', onMouse);
        btn.addEventListener('mouseup', release);
    });
}
setupTouchControls();

// ===== 应用 UI 编辑器保存的布局到触屏 DOM 按钮（百分比 → 相对 touch-controls 定位）=====
// 编辑器用统一的"满画布坐标系"，而按钮原本嵌套在 #action-buttons / #bottom-hotbar 内，
// 为让百分比直接生效，把可编辑按钮重挂到 #touch-controls 并用百分比定位。
async function applyUILayoutToDom() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return; // 仅移动端应用
    let layout;
    try {
        const res = await fetch('config/UILayout.mobile.json');
        if (!res.ok) return;
        layout = await res.json();
    } catch (e) { return; }
    if (!layout || !Array.isArray(layout.components)) return;

    const touchControls = document.getElementById('touch-controls');
    if (!touchControls) return;

    // 可编辑的 DOM 按钮 id（与编辑器组件 id 对应）
    const domIds = {
        'joystick': 'joystick-zone',
        'act-attack': 'act-attack',
        'act-block': 'act-block',
        'act-skill3': 'act-skill3',
        'act-skill4': 'act-skill4',
        'act-skill5': 'act-skill5',
        'act-flight': 'act-flight',
        'act-jump': 'act-jump',
        'act-interact': 'act-interact',
        'act-throw': 'act-throw',
        'act-axe': 'act-axe',
        'hb-hp': 'hb-hp',
        'hb-mp': 'hb-mp',
        'hb-bag': 'hb-bag',
        'hb-army': 'hb-army',
        'hb-settings': 'hb-settings',
        'hb-skill6': 'hb-skill6',
        'hb-skill7': 'hb-skill7'
    };

    const componentsById = new Map(layout.components
        .filter(comp => comp && typeof comp.id === 'string')
        .map(comp => [comp.id, comp]));
    for (const [componentId, elId] of Object.entries(domIds)) {
        const el = document.getElementById(elId);
        if (!el) continue;
        const comp = componentsById.get(componentId);
        // UILayout.mobile.json 是 Android 触屏按钮的精确清单：
        // 缺失表示该按钮已在 UI 编辑器删除，不能回退显示 HTML 默认按钮。
        if (!comp || comp.xPct === undefined) {
            el.style.display = 'none';
            el.setAttribute('aria-hidden', 'true');
            continue;
        }
        el.style.display = '';
        el.removeAttribute('aria-hidden');
        // 重挂到 touch-controls，使百分比相对全屏容器
        if (el.parentElement !== touchControls) {
            touchControls.appendChild(el);
        }
        // 获取容器实际尺寸，计算像素值（确保按钮尺寸与UI编辑器一致）
        const containerW = touchControls.clientWidth || window.innerWidth;
        const containerH = touchControls.clientHeight || window.innerHeight;
        const px = Math.round(comp.xPct * containerW);
        const py = Math.round(comp.yPct * containerH);
        const pw = Math.round(comp.wPct * containerW);
        const ph = Math.round(comp.hPct * containerH);
        // 对于圆形按钮，取宽高中较小值保持正方形
        const isCircle = (comp.kind === 'button');
        const size = isCircle ? Math.min(pw, ph) : 0;
        el.style.position = 'absolute';
        el.style.left = px + 'px';
        el.style.top = py + 'px';
        el.style.width = (isCircle ? size : pw) + 'px';
        el.style.height = (isCircle ? size : ph) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.maxWidth = 'none';
        applyOnboardingDomState(componentId, el);
    }
}
applyUILayoutToDom();

// ===== 竖屏时直接以横屏方式显示（不锁定方向，仅 CSS 旋转页面） =====
// 当处于竖屏时给 body 加 .force-landscape，#game-container 被旋转 90° 填满屏幕。
// 同时为 InputManager 安装坐标变换钩子，修正旋转后的触摸/点击坐标。
function applyForceLandscape() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const portrait = window.innerHeight > window.innerWidth;
    const rotate = isTouch && portrait;
    const wasRotate = document.body.classList.contains('force-landscape');
    document.body.classList.toggle('force-landscape', rotate);
    // 旋转后容器尺寸变化，需等 CSS 生效后再重算 canvas 尺寸
    if (rotate !== wasRotate) {
        // 类名切换后延迟一帧让布局生效
        requestAnimationFrame(() => { shell.resizeCanvas(); });
    } else {
        shell.resizeCanvas();
    }
    return rotate;
}

// 坐标变换：把页面坐标映射回 canvas 像素坐标（考虑旋转 + 缩放）
function makePointerTransform() {
    return (clientX, clientY) => {
        const rotate = document.body.classList.contains('force-landscape');
        const rect = shell.canvas.getBoundingClientRect();
        // 获取当前场景的逻辑尺寸（camera 尺寸），确保与渲染坐标系一致
        const cs = shell.sceneManager ? shell.sceneManager.getCurrentScene() : null;
        const logicW = (cs && cs.logicalWidth) || shell.canvas.logicalWidth || shell.logicalResolution.width;
        const logicH = (cs && cs.logicalHeight) || shell.canvas.logicalHeight || shell.logicalResolution.height;
        if (!rotate) {
            // 未旋转：归一化到逻辑坐标
            const x = (clientX - rect.left) / rect.width * logicW;
            const y = (clientY - rect.top) / rect.height * logicH;
            return { x, y };
        }
        // 旋转 90°（顺时针）：rect 是旋转后的外接矩形（屏幕坐标）
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        // 顺时针 90°：canvasX 沿屏幕竖直方向，canvasY 沿屏幕水平反方向
        const cx = py / rect.height * logicW;
        const cy = (rect.width - px) / rect.width * logicH;
        return { x: cx, y: cy };
    };
}

function setupOrientation() {
    const rotate = applyForceLandscape();
    // 安装坐标变换钩子到当前场景的 InputManager
    const transform = makePointerTransform();
    const installer = () => {
        const cs = shell.sceneManager ? shell.sceneManager.getCurrentScene() : null;
        if (cs && cs.inputManager && cs.inputManager.setPointerTransform) {
            cs.inputManager.setPointerTransform(transform);
        }
    };
    installer();
    // 场景可能稍后才创建 InputManager，做几次补装
    setTimeout(installer, 500);
    setTimeout(installer, 1500);
    // 暴露给摇杆使用
    window.__pointerTransform = transform;
}
setupOrientation();
window.addEventListener('resize', () => { applyForceLandscape(); applyUILayoutToDom(); void shell.applyLoginLayout(); });
window.addEventListener('orientationchange', () => { setTimeout(setupOrientation, 100); });
    return {};
}

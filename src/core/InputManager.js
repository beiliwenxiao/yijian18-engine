/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

import { GamepadManager } from './input/GamepadManager.js';
import { InputHints } from './input/InputHints.js';

/**
 * 输入管理器
 * 统一处理键盘、鼠标、手柄输入
 */
export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        
        // 键盘状态缓存
        this.keys = new Map();
        this.keysPressed = new Map(); // 本帧按下的键
        this.keysReleased = new Map(); // 本帧释放的键
        
        // 手柄状态（独立存放，查询时与键盘取或；不写进 keys 以免干扰键盘的按下/释放判定）
        this.gamepad = new GamepadManager();
        this._padDown = new Set();
        this._padPressed = new Set();
        this._padReleased = new Set();
        this._padMouseButtons = new Set();   // 手柄注入的虚拟鼠标按键
        this._padCursorActive = false;       // 本帧准星是否由右摇杆控制
        this._padPolledThisFrame = false;    // 帧守卫：本帧是否已轮询手柄
        
        // 手柄虚拟准星：以画面中心（≈玩家所在处，相机跟随）为原点，右摇杆偏移出瞄准点
        this.gamepadCursorRadius = 150;
        this.gamepadEnabled = true;
        
        // 鼠标状态
        this.mouse = {
            x: 0,
            y: 0,
            worldX: 0,
            worldY: 0,
            isDown: false,
            button: -1,
            buttons: new Set(),  // 当前按住的所有按键（支持同时按住左右键）
            clicked: false,
            clickedButton: -1,    // 本次按下沿的按钮；mouseup 先于游戏帧时仍可正确识别右键
            handled: false,  // 标记点击事件是否已被处理（用于 UI 点击阻止）
            isTouch: false   // 最近一次指针按下是否来自触屏（供 InputActionRouter 标记设备）
        };
        
        // 键位映射
        this.keyMap = {
            // 移动键
            'w': 'up',
            'W': 'up',
            'ArrowUp': 'up',
            's': 'down',
            'S': 'down',
            'ArrowDown': 'down',
            'a': 'left',
            'A': 'left',
            'ArrowLeft': 'left',
            'd': 'right',
            'D': 'right',
            'ArrowRight': 'right',
            
            // 技能键
            '1': 'skill1',
            '2': 'skill2',
            '3': 'skill3',
            '4': 'skill4',
            '5': 'skill5',
            '6': 'skill6',
            '7': 'skill7',
            
            // 其他功能键
            ' ': 'space',
            'Escape': 'escape',
            'Enter': 'enter',
            'Shift': 'shift',
            'Control': 'ctrl',
            'Tab': 'tab',
            // 注意：m, h, r 等字母键不需要映射，直接使用原始键名
        };
        
        // 相机偏移（用于坐标转换）
        this.cameraX = 0;
        this.cameraY = 0;
        
        // 快捷键注册表
        // Map<key, Array<{ id, callback, cooldown, lastTriggerTime }>>
        this.hotkeys = new Map();
        
        // 指针坐标变换钩子（用于页面被 CSS 旋转/缩放时修正触摸与鼠标坐标）
        // 形如 (clientX, clientY) => ({ x, y })，返回 Canvas 像素坐标；返回 null 则走默认 rect 计算
        this.pointerTransform = null;
        
        // 初始化事件监听
        this.initEventListeners();
    }

    /**
     * 设置指针坐标变换钩子
     * @param {Function|null} fn - (clientX, clientY) => ({x, y}) | null
     */
    setPointerTransform(fn) {
        this.pointerTransform = (typeof fn === 'function') ? fn : null;
    }

    /**
     * 初始化事件监听器
     */
    initEventListeners() {
        // 保存稳定监听引用，确保 destroy() 能精确解除，场景重入不会累积输入处理器。
        this._eventHandlers = {
            keydown: (e) => this.handleKeyDown(e),
            keyup: (e) => this.handleKeyUp(e),
            mousedown: (e) => this.handleMouseDown(e),
            mouseup: (e) => this.handleMouseUp(e),
            mousemove: (e) => this.handleMouseMove(e),
            contextmenu: (e) => e.preventDefault(),
            touchstart: (e) => this.handleTouchStart(e),
            touchend: (e) => this.handleTouchEnd(e),
            touchmove: (e) => this.handleTouchMove(e)
        };

        window.addEventListener('keydown', this._eventHandlers.keydown);
        window.addEventListener('keyup', this._eventHandlers.keyup);
        
        console.log('InputManager: 键盘事件监听器已绑定到 window');
        
        this.canvas.addEventListener('mousedown', this._eventHandlers.mousedown);
        this.canvas.addEventListener('mouseup', this._eventHandlers.mouseup);
        this.canvas.addEventListener('mousemove', this._eventHandlers.mousemove);
        this.canvas.addEventListener('contextmenu', this._eventHandlers.contextmenu);
        // 世界触摸必须拦截浏览器滚动、缩放与合成鼠标事件；处理器会调用 preventDefault()，因此不能注册为 passive。
        this.canvas.addEventListener('touchstart', this._eventHandlers.touchstart, { passive: false });
        this.canvas.addEventListener('touchend', this._eventHandlers.touchend, { passive: false });
        this.canvas.addEventListener('touchmove', this._eventHandlers.touchmove, { passive: false });
        
        console.log('InputManager: Event listeners initialized');
    }

    /**
     * 将物理字母键归一化为稳定小写虚拟键。
     * KeyboardEvent.key 会受 Caps Lock、Shift、键盘布局和输入法组合状态影响；
     * 游戏操作优先使用 code，修饰键语义仍由独立状态表达。
     */
    _normalizeKeyboardKey(event) {
        const key = event?.key || '';
        const code = event?.code || '';
        const physicalLetter = /^Key[A-Z]$/.test(code)
            ? code.slice(3).toLowerCase()
            : null;
        const canonicalKey = physicalLetter
            || (/^[A-Za-z]$/.test(key) ? key.toLowerCase() : key);
        return this.keyMap[canonicalKey] || canonicalKey;
    }

    /**
     * 处理键盘按下事件
     */
    handleKeyDown(event) {
        const key = event.key;
        const isDebugPanelKey = key === '`' || event.code === 'Backquote';
        // 反引号单独归一化；字母键统一使用物理 code，避免 Caps Lock/输入法改变操作键。
        const mappedKey = isDebugPanelKey ? '`' : this._normalizeKeyboardKey(event);
        const wasDown = this.keys.get(mappedKey) === true;
        
        // 如果键已经按下，不重复触发
        if (!wasDown) {
            this.keysPressed.set(mappedKey, true);
        }
        
        this.keys.set(mappedKey, true);

        // 键盘输入 → 切回 PC 方案
        InputHints.notifyMouseOrKeyboard();

        // 调试面板快捷键诊断：确认浏览器事件是否到达 InputManager，以及是否写入本帧按下状态
        if (isDebugPanelKey) {
            console.log('[InputManager][DebugPanel] 收到反引号 keydown', {
                key,
                code: event.code,
                repeat: event.repeat,
                mappedKey,
                wasDown,
                pressedThisFrame: this.keysPressed.get(mappedKey) === true,
                activeElement: document.activeElement?.tagName || null
            });
        }
        
        // 阻止游戏快捷键的浏览器默认行为。
        // F1 不再被游戏占用，完整交回系统/浏览器帮助。
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(key) || isDebugPanelKey) {
            event.preventDefault();
            if (isDebugPanelKey) {
                console.log('[InputManager][DebugPanel] 已阻止反引号键默认行为', {
                    defaultPrevented: event.defaultPrevented
                });
            }
        }
    }

    /**
     * 处理键盘释放事件
     */
    handleKeyUp(event) {
        const key = event.key;
        const isDebugPanelKey = key === '`' || key === '~' || event.code === 'Backquote';
        const mappedKey = isDebugPanelKey ? '`' : this._normalizeKeyboardKey(event);
        
        this.keys.set(mappedKey, false);
        this.keysReleased.set(mappedKey, true);
    }

    /**
     * 处理鼠标按下事件
     */
    handleMouseDown(event) {
        this.updateMousePosition(event);
        this.mouse.isTouch = false;
        this.mouse.isDown = true;
        this.mouse.button = event.button;
        this.mouse.clickedButton = event.button;
        this.mouse.buttons.add(event.button);
        this.mouse.clicked = true;
        this.mouse.ctrlKey = event.ctrlKey;
        // 鼠标点击 → 切回 PC 方案（手柄插着但玩家改用鼠标了）
        InputHints.notifyMouseOrKeyboard();
    }

    /**
     * 处理鼠标释放事件
     */
    handleMouseUp(event) {
        this.updateMousePosition(event);
        this.mouse.buttons.delete(event.button);
        this.mouse.isDown = this.mouse.buttons.size > 0;
        // button 仍指向剩余按住的按键（若有），否则置为 -1
        this.mouse.button = this.mouse.buttons.size > 0
            ? Array.from(this.mouse.buttons)[this.mouse.buttons.size - 1]
            : -1;
    }

    /**
     * 处理鼠标移动事件
     */
    handleMouseMove(event) {
        this.updateMousePosition(event);
    }

    /**
     * 更新鼠标位置
     */
    updateMousePosition(event) {
        if (this.pointerTransform) {
            const p = this.pointerTransform(event.clientX, event.clientY);
            if (p) {
                this.mouse.x = p.x;
                this.mouse.y = p.y;
                this.mouse.worldX = this.mouse.x + this.cameraX;
                this.mouse.worldY = this.mouse.y + this.cameraY;
                return;
            }
        }
        const rect = this.canvas.getBoundingClientRect();
        
        // CSS 像素始终映射到项目逻辑坐标；DPR backing 只提升清晰度，不参与输入语义。
        const logicalWidth = Number(this.canvas.logicalWidth) || this.canvas.width;
        const logicalHeight = Number(this.canvas.logicalHeight) || this.canvas.height;
        this.mouse.x = (event.clientX - rect.left) / rect.width * logicalWidth;
        this.mouse.y = (event.clientY - rect.top) / rect.height * logicalHeight;
        
        // 转换为游戏世界坐标
        this.mouse.worldX = this.mouse.x + this.cameraX;
        this.mouse.worldY = this.mouse.y + this.cameraY;
    }

    /**
     * 处理触摸开始事件
     */
    handleTouchStart(event) {
        event.preventDefault();
        if (event.touches.length > 0) {
            const touch = event.touches[0];
            this.updateTouchPosition(touch);
            this.mouse.isTouch = true;
            this.mouse.isDown = true;
            this.mouse.clicked = true;
            // 触摸等价于左键按下，记入 buttons，保证 isMouseButtonDown(0) 生效
            this.mouse.button = 0;
            this.mouse.buttons.add(0);
        }
    }

    /**
     * 处理触摸结束事件
     */
    handleTouchEnd(event) {
        event.preventDefault();
        this.mouse.isDown = false;
        // 释放左键
        this.mouse.buttons.delete(0);
        this.mouse.button = -1;
    }

    /**
     * 处理触摸移动事件
     */
    handleTouchMove(event) {
        event.preventDefault();
        if (event.touches.length > 0) {
            const touch = event.touches[0];
            this.updateTouchPosition(touch);
        }
    }

    /**
     * 更新触摸位置
     */
    updateTouchPosition(touch) {
        if (this.pointerTransform) {
            const p = this.pointerTransform(touch.clientX, touch.clientY);
            if (p) {
                this.mouse.x = p.x;
                this.mouse.y = p.y;
                this.mouse.worldX = this.mouse.x + this.cameraX;
                this.mouse.worldY = this.mouse.y + this.cameraY;
                return;
            }
        }
        const rect = this.canvas.getBoundingClientRect();
        
        const logicalWidth = Number(this.canvas.logicalWidth) || this.canvas.width;
        const logicalHeight = Number(this.canvas.logicalHeight) || this.canvas.height;
        const scaleX = logicalWidth / rect.width;
        const scaleY = logicalHeight / rect.height;
        
        this.mouse.x = (touch.clientX - rect.left) * scaleX;
        this.mouse.y = (touch.clientY - rect.top) * scaleY;
        
        this.mouse.worldX = this.mouse.x + this.cameraX;
        this.mouse.worldY = this.mouse.y + this.cameraY;
    }

    /**
     * 检查键是否按下（键盘或手柄）
     * @param {string} key - 键名
     * @returns {boolean}
     */
    isKeyDown(key) {
        return this.keys.get(key) === true || this._padDown.has(key);
    }

    /**
     * 检查纯键盘按键是否在本帧按下，不合并手柄虚拟键。
     * 模态 UI 需要区分键盘确认键与物理手柄按钮时使用。
     * @param {string} key - 归一化后的键名
     * @returns {boolean}
     */
    isKeyboardKeyPressed(key) {
        return this.keysPressed.get(key) === true;
    }

    /**
     * 检查键是否在本帧按下（键盘或手柄）
     * @param {string} key - 键名
     * @returns {boolean}
     */
    isKeyPressed(key) {
        return this.isKeyboardKeyPressed(key) || this._padPressed.has(key);
    }

    /**
     * 检查是否有任意键在本帧按下
     * @returns {boolean}
     */
    isAnyKeyPressed() {
        return this.keysPressed.size > 0 || this._padPressed.size > 0;
    }

    /**
     * 检查键是否在本帧释放（键盘或手柄）
     * @param {string} key - 键名
     * @returns {boolean}
     */
    isKeyReleased(key) {
        return this.keysReleased.get(key) === true || this._padReleased.has(key);
    }

    /**
     * 获取本帧按下的所有键（含手柄）
     * @returns {Array<string>}
     */
    getKeysPressed() {
        const keys = new Set(this.keysPressed.keys());
        for (const k of this._padPressed) keys.add(k);
        return Array.from(keys);
    }

    // ─── 手柄 ───────────────────────────────────────────

    /**
     * 帧首轮询手柄并注入虚拟键 / 虚拟准星。
     * 必须在任何 isKeyDown/isKeyPressed 读取之前调用（GameEngine.update 开头），
     * 否则本帧读到的是上一帧的手柄状态。
     * @returns {boolean} 本帧是否有可用手柄
     */
    pollGamepads() {
        if (!this.gamepadEnabled || !this.gamepad) return false;
        // 帧守卫：一帧只真正轮询一次。GameEngine 路径与场景 update 可能都会调，
        // 重复 poll 会用刚写入的状态做对比，导致本帧 pressed/released 被清空。
        // 守卫在帧末 update() 重置。
        if (this._padPolledThisFrame) return this.isGamepadConnected();
        this._padPolledThisFrame = true;

        const active = this.gamepad.poll();
        this._padDown.clear();
        this._padPressed.clear();
        this._padReleased.clear();
        this._padMouseButtons.clear();
        this._padCursorActive = false;
        if (!active) return false;

        const vk = this.gamepad.getVirtualKeys();
        for (const k of vk.down) this._padDown.add(k);
        for (const k of vk.pressed) this._padPressed.add(k);
        for (const k of vk.released) this._padReleased.add(k);

        // 手柄有按钮活动 → 切到手柄方案
        if (this.gamepad.buttonsPressed.size > 0 || this.gamepad.leftStick.magnitude > 0.3) {
          InputHints.notifyGamepad();
        }

        this._updateGamepadCursor();
        return true;
    }

    /**
     * 右摇杆驱动虚拟准星位置（供瞄准预览使用，不直接触发攻击）。
     * 准星原点取画面中心：相机跟随玩家，中心即玩家位置，无需知道玩家实体。
     * 攻击/技能/轻功/投掷的释放由 GamepadCombatController 意图驱动，不再注入虚拟鼠标。
     * @private
     */
    _updateGamepadCursor() {
        const aim = this.gamepad.getAimVector();
        if (aim.magnitude > 0) {
            const logicalWidth = Number(this.canvas?.logicalWidth) || Number(this.canvas?.width) || 0;
            const logicalHeight = Number(this.canvas?.logicalHeight) || Number(this.canvas?.height) || 0;
            const cx = logicalWidth / 2;
            const cy = logicalHeight / 2;
            this.mouse.x = cx + aim.x * this.gamepadCursorRadius;
            this.mouse.y = cy + aim.y * this.gamepadCursorRadius;
            this.mouse.worldX = this.mouse.x + this.cameraX;
            this.mouse.worldY = this.mouse.y + this.cameraY;
            this._padCursorActive = true;
        }
        // 手柄战斗操作不再注入虚拟鼠标按键，全部由 GamepadCombatController 产出意图
    }

    /** 是否有手柄连接 */
    isGamepadConnected() {
        return !!this.gamepad && this.gamepad.isConnected();
    }

    /** 手柄信息（无手柄返回 null） */
    getGamepadInfo() {
        return this.gamepad ? this.gamepad.info : null;
    }

    /** 本帧准星是否由手柄右摇杆控制（供 UI 画准星） */
    isGamepadCursorActive() {
        return this._padCursorActive;
    }

    /** 启用/禁用手柄输入 */
    setGamepadEnabled(enabled) {
        this.gamepadEnabled = !!enabled;
        if (!this.gamepadEnabled) {
            this._padDown.clear();
            this._padPressed.clear();
            this._padReleased.clear();
            this._padMouseButtons.clear();
            this._padCursorActive = false;
        }
    }

    /**
     * 移动输入向量。手柄左摇杆可给出模拟量（轻推慢走），键盘/十字键为 ±1。
     * MovementSystem 优先用它，取不到再退回逐键判断。
     * @returns {{x:number, y:number, magnitude:number}}
     */
    getMoveAxis() {
        // 手柄优先：摇杆有输入时用模拟量
        if (this.gamepad && this.gamepad.isConnected()) {
            const mv = this.gamepad.getMoveVector();
            if (mv.magnitude > 0) return mv;
        }

        let x = 0, y = 0;
        if (this.keys.get('left') === true) x -= 1;
        if (this.keys.get('right') === true) x += 1;
        if (this.keys.get('up') === true) y -= 1;
        if (this.keys.get('down') === true) y += 1;
        if (x === 0 && y === 0) return { x: 0, y: 0, magnitude: 0 };

        const mag = Math.hypot(x, y);
        return { x: x / mag, y: y / mag, magnitude: 1 };
    }

    /**
     * 手柄震动（不支持的平台静默忽略）
     * @param {number} [duration=200]
     * @param {number} [strong=0.6]
     * @param {number} [weak=0.3]
     */
    vibrate(duration, strong, weak) {
        if (this.gamepad) return this.gamepad.vibrate(duration, strong, weak);
        return Promise.resolve(false);
    }

    /**
     * 获取鼠标屏幕坐标
     * @returns {{x: number, y: number}}
     */
    getMousePosition() {
        return { x: this.mouse.x, y: this.mouse.y };
    }

    /**
     * 获取鼠标世界坐标
     * 优先使用 backend.picker.pickGround（3D 真实反投影），否则回退到 cameraX/Y 偏移
     * @returns {{x: number, y: number}}
     */
    getMouseWorldPosition() {
        // 只在 3D 模式下使用 picker（3D 需要光线投射做屏幕→地面的反投影）
        // 2D 模式下直接使用 InputManager 通过 setCameraPosition 维护的 worldX/worldY，
        // 避免 backend 内部相机与游戏实际相机不同步导致坐标错误
        if (this._backend && this._backend.mode === '3d' && this._backend.picker && typeof this._backend.picker.pickGround === 'function') {
            const ground = this._backend.picker.pickGround(this.mouse.x, this.mouse.y);
            if (ground) {
                return { x: ground.x, y: ground.z };
            }
        }
        return { x: this.mouse.worldX, y: this.mouse.worldY };
    }

    /**
     * 设置当前渲染后端（由 GameEngine 注入，用于 picker 坐标转换）
     * @param {import('../rendering/backends/IRenderBackend.js').IRenderBackend} backend
     */
    setBackend(backend) {
        this._backend = backend;
    }

    /**
     * 检查鼠标是否点击
     * @returns {boolean}
     */
    isMouseClicked() {
        return this.mouse.clicked;
    }

    /**
     * 检查是否是Ctrl+鼠标左键点击
     * @returns {boolean}
     */
    isCtrlClick() {
        return this.mouse.clicked && this.mouse.ctrlKey && this.getMouseButton() === 0;
    }

    /**
     * 检查鼠标是否按下
     * @returns {boolean}
     */
    isMouseDown() {
        return this.mouse.isDown || this._padMouseButtons.size > 0;
    }

    /**
     * 检查指定鼠标按键是否按住
     * @param {number} button - 0=左键, 1=中键, 2=右键
     * @returns {boolean}
     */
    isMouseButtonDown(button) {
        return this.mouse.buttons.has(button) || this._padMouseButtons.has(button);
    }

    /**
     * 获取鼠标按钮
     * @returns {number} 0=左键, 1=中键, 2=右键
     */
    getMouseButton() {
        // 点击沿在 mouseup 后仍保留它最初的按钮，避免右键被下一帧误判为左键。
        return this.mouse.clicked ? this.mouse.clickedButton : this.mouse.button;
    }

    /**
     * 标记鼠标点击已被处理
     * 用于 UI 点击阻止功能，当 UI 处理了点击事件后调用此方法
     * 防止点击事件传播到游戏世界层（如移动系统）
     */
    markMouseClickHandled() {
        this.mouse.handled = true;
        this.mouse.clicked = false;  // 清除点击状态
    }

    /**
     * 检查鼠标点击是否已被处理
     * @returns {boolean} 如果点击已被 UI 处理则返回 true
     */
    isMouseClickHandled() {
        return this.mouse.handled;
    }

    /**
     * 设置相机位置（用于坐标转换）
     * @param {number} x - 相机X坐标
     * @param {number} y - 相机Y坐标
     */
    setCameraPosition(x, y) {
        this.cameraX = x;
        this.cameraY = y;
    }

    /**
     * 屏幕坐标转世界坐标
     * @param {number} screenX - 屏幕X坐标
     * @param {number} screenY - 屏幕Y坐标
     * @returns {{x: number, y: number}}
     */
    screenToWorld(screenX, screenY) {
        return {
            x: screenX + this.cameraX,
            y: screenY + this.cameraY
        };
    }

    /**
     * 世界坐标转屏幕坐标
     * @param {number} worldX - 世界X坐标
     * @param {number} worldY - 世界Y坐标
     * @returns {{x: number, y: number}}
     */
    worldToScreen(worldX, worldY) {
        return {
            x: worldX - this.cameraX,
            y: worldY - this.cameraY
        };
    }

    /**
     * 注册快捷键
     * @param {string} id - 快捷键唯一标识
     * @param {string|string[]} keys - 键名或键名数组（任一触发）
     * @param {Function} callback - 触发回调
     * @param {Object} options - 配置选项
     * @param {number} options.cooldown - 冷却时间（毫秒），默认300
     * @param {boolean} options.onPress - 是否在按下瞬间触发（默认true），false则在持续按住时触发
     */
    registerHotkey(id, keys, callback, options = {}) {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const cooldown = options.cooldown ?? 300;
        const onPress = options.onPress ?? true;
        // 修饰键要求：只有键盘上对应修饰键处于按下状态时热键才生效。
        // 用于把已被系统/浏览器占用的单键（如 F1）改成组合键。
        const modifiers = {
            ctrl: options.ctrl === true,
            shift: options.shift === true,
            alt: options.alt === true
        };
        
        const hotkeyData = { id, callback, cooldown, lastTriggerTime: 0, onPress, modifiers };
        
        for (const key of keyArray) {
            const mappedKey = this.keyMap[key] || key;
            if (!this.hotkeys.has(mappedKey)) {
                this.hotkeys.set(mappedKey, []);
            }
            this.hotkeys.get(mappedKey).push(hotkeyData);
        }
    }

    /**
     * 注销快捷键
     * @param {string} id - 快捷键唯一标识
     */
    /**
     * 校验热键要求的修饰键是否满足。
     * 只看键盘状态，避免手柄映射出的同名虚拟键（如轻功用的 ctrl）造成误触发。
     * @param {{ctrl:boolean, shift:boolean, alt:boolean}} [modifiers]
     * @returns {boolean}
     */
    _modifiersSatisfied(modifiers) {
        if (!modifiers) return true;
        if (modifiers.ctrl && this.keys.get('ctrl') !== true) return false;
        if (modifiers.shift && this.keys.get('shift') !== true) return false;
        if (modifiers.alt && this.keys.get('Alt') !== true) return false;
        return true;
    }

    unregisterHotkey(id) {
        for (const [key, handlers] of this.hotkeys) {
            const filtered = handlers.filter(h => h.id !== id);
            if (filtered.length === 0) {
                this.hotkeys.delete(key);
            } else {
                this.hotkeys.set(key, filtered);
            }
        }
    }

    /**
     * 清除所有快捷键
     */
    clearHotkeys() {
        this.hotkeys.clear();
    }

    /**
     * 处理快捷键（每帧调用）
     * @private
     */
    processHotkeys() {
        const now = Date.now();
        
        for (const [key, handlers] of this.hotkeys) {
            for (const handler of handlers) {
                const shouldTrigger = handler.onPress 
                    ? this.isKeyPressed(key)
                    : this.isKeyDown(key);
                
                if (shouldTrigger && !this._modifiersSatisfied(handler.modifiers)) continue;
                
                if (shouldTrigger && (now - handler.lastTriggerTime >= handler.cooldown)) {
                    handler.lastTriggerTime = now;
                    handler.callback(key);
                }
            }
        }
    }

    /**
     * 更新输入状态（每帧调用）
     */
    update() {
        // 处理注册的快捷键
        this.processHotkeys();
        
        // 清除本帧的按键状态
        this.keysPressed.clear();
        this.keysReleased.clear();
        
        // 清除鼠标点击状态
        this.mouse.clicked = false;
        this.mouse.clickedButton = -1;
        this.mouse.handled = false;  // 重置处理标记
        
        // 重置手柄帧守卫：下一帧允许再次真正轮询
        this._padPolledThisFrame = false;
    }

    /**
     * 清除所有输入状态
     */
    clear() {
        this.keys.clear();
        this.keysPressed.clear();
        this.keysReleased.clear();
        this.mouse.clicked = false;
        this.mouse.clickedButton = -1;
        this.mouse.isDown = false;
        this.mouse.button = -1;
        this.mouse.buttons.clear();
        this._padDown.clear();
        this._padPressed.clear();
        this._padReleased.clear();
        this._padMouseButtons.clear();
        this._padCursorActive = false;
    }

    /**
     * 销毁输入管理器
     */
    destroy() {
        const handlers = this._eventHandlers;
        if (handlers) {
            window.removeEventListener('keydown', handlers.keydown);
            window.removeEventListener('keyup', handlers.keyup);
            this.canvas.removeEventListener('mousedown', handlers.mousedown);
            this.canvas.removeEventListener('mouseup', handlers.mouseup);
            this.canvas.removeEventListener('mousemove', handlers.mousemove);
            this.canvas.removeEventListener('contextmenu', handlers.contextmenu);
            this.canvas.removeEventListener('touchstart', handlers.touchstart);
            this.canvas.removeEventListener('touchend', handlers.touchend);
            this.canvas.removeEventListener('touchmove', handlers.touchmove);
            this._eventHandlers = null;
        }
        
        this.gamepad?.destroy?.();
        this.clear();
        this.clearHotkeys();
        console.log('InputManager: Destroyed');
    }
}

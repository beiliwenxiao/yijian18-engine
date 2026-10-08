/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://gitee.com/coderaaa/yijian18-engine`
 ************************************************************/

// 左下角虚拟摇杆：触屏方向热区 → 方向键事件 + Canvas 扇形指示。抽取自 example/sanguo_zhangjiao/index.html。
/**
 * 左下角虚拟摇杆
 * - 透明圆形热区，手指按下处作为摇杆中心
 * - 显示手指方向的 90° 扇形圆周，并在圆周上绘制方向小箭头
 * - 将方向换算为 上/下/左/右 组合键，派发键盘事件复用移动系统
 */
export function setupVirtualJoystick(pressKey, releaseKey, dirKey) {
    const zone = document.getElementById('joystick-zone');
    const cvs = document.getElementById('joystick-overlay');
    const gameCanvas = document.getElementById('gameCanvas');
    if (!zone || !cvs || !gameCanvas) return;
    const jctx = cvs.getContext('2d');

    const RADIUS = 70;          // 摇杆圆周半径（canvas 像素）
    const DEAD_ZONE = 18;       // 死区

    let active = false;
    let centerX = 0, centerY = 0;   // 摇杆中心（canvas 像素坐标）
    let curX = 0, curY = 0;
    let activeDirs = { up: false, down: false, left: false, right: false };

    function resize() {
        // 覆盖层与主 canvas 同像素尺寸，绘制坐标 = canvas 像素坐标
        cvs.width = gameCanvas.width;
        cvs.height = gameCanvas.height;
        if (active) render();
    }
    resize();
    window.addEventListener('resize', () => setTimeout(resize, 50));
    window.addEventListener('orientationchange', () => setTimeout(resize, 150));

    // 复用全局指针变换（已处理旋转/缩放），回退到简单 rect 映射
    function clientToCanvas(clientX, clientY) {
        if (typeof window.__pointerTransform === 'function') {
            return window.__pointerTransform(clientX, clientY);
        }
        const rect = gameCanvas.getBoundingClientRect();
        const sx = gameCanvas.width / rect.width;
        const sy = gameCanvas.height / rect.height;
        return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    }

    // 根据角度计算 8 向（换算为方向键组合）
    function updateDirection(dx, dy) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        const next = { up: false, down: false, left: false, right: false };
        if (dist >= DEAD_ZONE) {
            let ang = Math.atan2(dy, dx) * 180 / Math.PI; // y 向下为正
            if (ang < 0) ang += 360;
            if (ang >= 22.5 && ang < 67.5)      { next.down = true; next.right = true; }
            else if (ang >= 67.5 && ang < 112.5)  { next.down = true; }
            else if (ang >= 112.5 && ang < 157.5) { next.down = true; next.left = true; }
            else if (ang >= 157.5 && ang < 202.5) { next.left = true; }
            else if (ang >= 202.5 && ang < 247.5) { next.up = true; next.left = true; }
            else if (ang >= 247.5 && ang < 292.5) { next.up = true; }
            else if (ang >= 292.5 && ang < 337.5) { next.up = true; next.right = true; }
            else                                   { next.right = true; }
        }
        for (const d of ['up', 'down', 'left', 'right']) {
            if (next[d] && !activeDirs[d]) pressKey(dirKey[d]);
            else if (!next[d] && activeDirs[d]) releaseKey(dirKey[d]);
        }
        activeDirs = next;
    }

    function releaseAll() {
        for (const d of ['up', 'down', 'left', 'right']) {
            if (activeDirs[d]) releaseKey(dirKey[d]);
        }
        activeDirs = { up: false, down: false, left: false, right: false };
    }

    function render() {
        jctx.clearRect(0, 0, cvs.width, cvs.height);
        if (!active) return;

        const dx = curX - centerX;
        const dy = curY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 基础圆（淡）
        jctx.beginPath();
        jctx.arc(centerX, centerY, RADIUS, 0, Math.PI * 2);
        jctx.strokeStyle = 'rgba(255,255,255,0.25)';
        jctx.lineWidth = 2;
        jctx.stroke();

        if (dist >= DEAD_ZONE) {
            const ang = Math.atan2(dy, dx);
            const half = Math.PI / 4; // 90° 扇形 => 半角 45°

            // 高亮 90° 扇形圆周弧
            jctx.beginPath();
            jctx.arc(centerX, centerY, RADIUS, ang - half, ang + half);
            jctx.strokeStyle = 'rgba(139,195,74,0.95)';
            jctx.lineWidth = 5;
            jctx.lineCap = 'round';
            jctx.stroke();

            // 圆周上的方向小箭头（位于弧中点 = 手指方向）
            const ax = centerX + Math.cos(ang) * RADIUS;
            const ay = centerY + Math.sin(ang) * RADIUS;
            const size = 12;
            jctx.save();
            jctx.translate(ax, ay);
            jctx.rotate(ang);
            jctx.beginPath();
            jctx.moveTo(size, 0);
            jctx.lineTo(-size * 0.6, -size * 0.7);
            jctx.lineTo(-size * 0.6, size * 0.7);
            jctx.closePath();
            jctx.fillStyle = '#8BC34A';
            jctx.fill();
            jctx.restore();
        }

        // 摇杆中心点
        jctx.beginPath();
        jctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
        jctx.fillStyle = 'rgba(255,255,255,0.6)';
        jctx.fill();
    }

    function start(clientX, clientY) {
        const p = clientToCanvas(clientX, clientY);
        centerX = p.x; centerY = p.y;
        curX = p.x; curY = p.y;
        active = true;
        render();
    }
    function move(clientX, clientY) {
        if (!active) return;
        const p = clientToCanvas(clientX, clientY);
        curX = p.x; curY = p.y;
        updateDirection(curX - centerX, curY - centerY);
        render();
    }
    function end() {
        active = false;
        releaseAll();
        render();
    }

    // 触摸事件
    zone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        start(t.clientX, t.clientY);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        move(t.clientX, t.clientY);
    }, { passive: false });
    zone.addEventListener('touchend', (e) => { e.preventDefault(); end(); }, { passive: false });
    zone.addEventListener('touchcancel', (e) => { e.preventDefault(); end(); }, { passive: false });

    // 鼠标兼容（桌面测试）
    zone.addEventListener('mousedown', (e) => { start(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => { if (active) move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (active) end(); });
}

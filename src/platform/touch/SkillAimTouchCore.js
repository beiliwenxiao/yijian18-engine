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

// 触屏技能瞄准核心：技能/攻击/投掷/轻功按住拖动瞄准。抽取自 example/sanguo_zhangjiao/index.html，跨模块状态经 shell 宿主读写。
// 需要瞄准的技能索引集合（技能3/4/5 = 索引 0/1/2）
export const AIM_SKILLS = new Set([0, 1, 2]);
// 攻击按钮也走瞄准流程,用 -1 标识
export const ATTACK_AIM_INDEX = -1;
// 投掷和轻功也走瞄准流程
export const THROW_AIM_INDEX = -2;
export const FLIGHT_AIM_INDEX = -3;

export function createSkillAimTouchCore(shell) {
    // ===== 技能瞄准系统（技能3/4/5：按住拖动选方向，松手释放） =====
    const skillAim = {
        active: false,      // 是否正在瞄准
        skillIndex: -1,     // 技能索引
        btn: null,          // 按下的按钮元素
        touchId: -1,        // 触摸点 identifier（区分多指）
        startX: 0,          // 按下时手指屏幕坐标
        startY: 0,
        curX: 0,            // 当前手指屏幕坐标
        curY: 0,
        radius: 100,        // 瞄准圆半径（像素，屏幕坐标）—— 拖拽此距离 = 最大射程
        anchorWorldPos: null, // 按下瞄准时的玩家世界坐标（锚点）
    };
    // 瞄准圆渲染(画在 joystick overlay canvas 上)
    const aimCvs = document.getElementById('joystick-overlay');
    const aimCtx = aimCvs ? aimCvs.getContext('2d') : null;

    function renderSkillAim() {
        // 瞄准圆绘制在 joystick overlay(已有 requestAnimationFrame loop)
        // 由摇杆 loop 调用此函数
    }
    // 把渲染钩入摇杆的 render loop：在 setupVirtualJoystick 的 loop 里
    // 无法直接改动闭包，所以我另起一个 raf loop 专门画瞄准圈
    function skillAimLoop() {
        if (aimCtx && skillAim.active) {
            const sx = skillAim.startX;
            const sy = skillAim.startY;
            const cx = skillAim.curX;
            const cy = skillAim.curY;
            const dx = cx - sx;
            const dy = cy - sy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // 在按钮中心画圆圈(屏幕坐标 → 需要用 getBoundingClientRect)
            // 简化:直接在 overlay canvas 上用 canvas 像素坐标画
            // 但 overlay canvas 是游戏画面像素坐标...
            // 为了简便，在按钮上方叠一个临时的 DOM 圆圈
        }
        requestAnimationFrame(skillAimLoop);
    }
    // 不用 canvas 画,用 CSS 圆圈更简洁可靠（避开坐标换算）
    // 创建一个临时的瞄准指示 DOM 元素
    const aimIndicator = document.createElement('div');
    aimIndicator.id = 'skill-aim-indicator';
    aimIndicator.style.cssText = 'position:fixed;pointer-events:none;display:none;z-index:99999;';
    aimIndicator.innerHTML = '<div class="aim-ring"></div><div class="aim-arrow"></div>';
    document.body.appendChild(aimIndicator);

    // 对应 CSS（内联添加）
    const aimStyle = document.createElement('style');
    aimStyle.textContent = `
                #skill-aim-indicator {
                    width: 120px; height: 120px;
                    transform: translate(-50%, -50%);
                }
                #skill-aim-indicator .aim-ring {
                    position: absolute; inset: 0;
                    border: 3px solid rgba(139,195,74,0.85);
                    border-radius: 50%;
                }
                #skill-aim-indicator .aim-arrow {
                    position: absolute;
                    left: 50%; top: 50%;
                    width: 14px; height: 14px;
                    margin: -7px 0 0 -7px;
                    background: #8BC34A;
                    clip-path: polygon(100% 50%, 0 0, 0 100%);
                    transform-origin: center center;
                    transform: rotate(0deg) translateX(100px);
                    display: none;
                }
            `;
    document.head.appendChild(aimStyle);

    function startSkillAim(btn, skillIdx, clientX, clientY, touchId) {
        skillAim.active = true;
        skillAim.skillIndex = skillIdx;
        skillAim.btn = btn;
        skillAim.touchId = touchId !== undefined ? touchId : -1;
        skillAim.startX = clientX;
        skillAim.startY = clientY;
        skillAim.curX = clientX;
        skillAim.curY = clientY;
        // 记录瞄准开始时玩家世界坐标作为锚点
        const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;
        skillAim.anchorWorldPos = null;
        if (currentScene && currentScene.playerEntity) {
            const t = currentScene.playerEntity.getComponent('transform');
            if (t) skillAim.anchorWorldPos = { x: t.position.x, y: t.position.y };
        }
        // 显示瞄准圈在按钮中心
        aimIndicator.style.display = 'block';
        aimIndicator.style.left = clientX + 'px';
        aimIndicator.style.top = clientY + 'px';
        aimIndicator.querySelector('.aim-arrow').style.display = 'none';
        // 瞄准时让其他按钮不遮挡摇杆圈
        const actionBtns = document.getElementById('action-buttons');
        if (actionBtns) actionBtns.style.zIndex = '1';
        // 让被按的按钮自身半透明,不遮挡瞄准圈
        btn.style.opacity = '0.25';
        // 初始时落点在玩家自身(distRatio=0)
        if (currentScene && currentScene.setSkillAimPreview) {
            currentScene.setSkillAimPreview(skillIdx, 1, 0, 0, skillAim.anchorWorldPos);
        }
    }

    function moveSkillAim(clientX, clientY) {
        if (!skillAim.active) return;
        skillAim.curX = clientX;
        skillAim.curY = clientY;
        const dx = clientX - skillAim.startX;
        const dy = clientY - skillAim.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const arrow = aimIndicator.querySelector('.aim-arrow');
        // 拖拽距离占瞄准圈半径的比例 → 映射到 0~1(=最大射程)
        const distRatio = dist / skillAim.radius;

        const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;

        // 始终按实际拖拽距离和方向更新（无死区，手指在中心附近也正常映射）
        if (dist > 2) {
            const ang = Math.atan2(dy, dx) * 180 / Math.PI;
            arrow.style.display = 'block';
            arrow.style.transform = `rotate(${ang}deg) translateX(80px)`;
            // 范围内绿色,范围外红色
            const inRange = distRatio <= 1.0;
            arrow.style.background = inRange ? '#8BC34A' : '#ff4444';
            aimIndicator.querySelector('.aim-ring').style.borderColor =
                inRange ? 'rgba(139,195,74,0.85)' : 'rgba(255,68,68,0.85)';
            // 更新游戏世界中的技能落点预览
            if (currentScene && currentScene.setSkillAimPreview) {
                currentScene.setSkillAimPreview(skillAim.skillIndex, dx, dy, distRatio, skillAim.anchorWorldPos);
            }
            // 攻击按钮：拖动时让扇形方向跟随手指（不攻击，仅更新方向指示）
            if (skillAim.skillIndex === ATTACK_AIM_INDEX && currentScene && currentScene.meleeAttackSystem) {
                const ang = Math.atan2(dy, dx);
                currentScene.meleeAttackSystem.sectorDirection = ang;
                currentScene.meleeAttackSystem.sectorDirectionLocked = true;
            }
        } else {
            arrow.style.display = 'none';
            // 距离极小:保持在玩家正前方极近处（使用上次方向或默认朝向）
            if (currentScene && currentScene.setSkillAimPreview) {
                currentScene.setSkillAimPreview(skillAim.skillIndex, dx || 1, dy || 0, distRatio, skillAim.anchorWorldPos);
            }
        }
    }

    function endSkillAim() {
        if (!skillAim.active) return;
        const dx = skillAim.curX - skillAim.startX;
        const dy = skillAim.curY - skillAim.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const distRatio = dist / skillAim.radius;

        const currentScene = shell.sceneManager ? shell.sceneManager.getCurrentScene() : shell.scene;
        if (currentScene) {
            if (dist > 10 && distRatio <= 1.0) {
                // 在范围内且有方向拖拽 → 释放
                if (skillAim.skillIndex === ATTACK_AIM_INDEX) {
                    // 攻击按钮：从当前玩家位置到预览圈位置计算实际发射方向
                    if (currentScene.attackByDirection) {
                        // 如果有预览圈（远程），用预览圈世界坐标计算方向
                        if (currentScene.skillAimPreview && currentScene.playerEntity) {
                            const t = currentScene.playerEntity.getComponent('transform');
                            if (t) {
                                const realDx = currentScene.skillAimPreview.targetX - t.position.x;
                                const realDy = currentScene.skillAimPreview.targetY - t.position.y;
                                currentScene.attackByDirection(realDx, realDy, distRatio);
                            } else {
                                currentScene.attackByDirection(dx, dy, distRatio);
                            }
                        } else {
                            currentScene.attackByDirection(dx, dy, distRatio);
                        }
                    }
                } else if (skillAim.skillIndex === THROW_AIM_INDEX) {
                    // 投掷按钮：按方向投掷
                    if (currentScene.throwByDirection) {
                        currentScene.throwByDirection(dx, dy, distRatio);
                    } else if (currentScene.throwByFacing) {
                        currentScene.throwByFacing();
                    }
                } else if (skillAim.skillIndex === FLIGHT_AIM_INDEX) {
                    // 轻功按钮：按方向轻功
                    if (currentScene.flightByDirection) {
                        currentScene.flightByDirection(dx, dy, distRatio);
                    } else if (currentScene.flightByFacing) {
                        currentScene.flightByFacing();
                    }
                } else {
                    // 技能按钮：使用预览圈世界坐标作为技能目标
                    if (currentScene.useSkillByDirection) {
                        let targetWorldPos = null;
                        if (currentScene.skillAimPreview) {
                            targetWorldPos = {
                                x: currentScene._lastAimWorldX || currentScene.skillAimPreview.targetX,
                                y: currentScene._lastAimWorldY || currentScene.skillAimPreview.targetY
                            };
                        }
                        currentScene.useSkillByDirection(skillAim.skillIndex, dx, dy, distRatio, targetWorldPos);
                    }
                }
            } else if (dist <= 10) {
                // 没拖或拖动极小 → 按默认朝向释放
                if (skillAim.skillIndex === ATTACK_AIM_INDEX) {
                    if (currentScene.attackByFacing) currentScene.attackByFacing();
                } else if (skillAim.skillIndex === THROW_AIM_INDEX) {
                    if (currentScene.throwByFacing) currentScene.throwByFacing();
                } else if (skillAim.skillIndex === FLIGHT_AIM_INDEX) {
                    if (currentScene.flightByFacing) currentScene.flightByFacing();
                } else {
                    if (currentScene.useSkillByIndex) {
                        currentScene.useSkillByIndex(skillAim.skillIndex);
                    }
                }
            }
            // 超出范围(distRatio > 1.0 && dist > 10) → 不释放(取消)

            // 清除游戏世界中的落点预览
            if (currentScene.clearSkillAimPreview) {
                currentScene.clearSkillAimPreview();
            }
        }

        // 隐藏
        skillAim.active = false;
        aimIndicator.style.display = 'none';
        if (skillAim.btn) {
            skillAim.btn.classList.remove('pressed');
            skillAim.btn.style.opacity = '';
        }
        // 恢复按钮组层级
        const actionBtns = document.getElementById('action-buttons');
        if (actionBtns) actionBtns.style.zIndex = '';
    }

    // 全局 touch/mouse move 用于技能瞄准拖拽
    window.addEventListener('touchmove', (e) => {
        if (!skillAim.active) return;
        // 用 touch identifier 找到瞄准手指
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === skillAim.touchId) {
                moveSkillAim(e.touches[i].clientX, e.touches[i].clientY);
                return;
            }
        }
    }, { passive: true });
    window.addEventListener('mousemove', (e) => {
        if (skillAim.active) moveSkillAim(e.clientX, e.clientY);
    });
    window.addEventListener('touchend', (e) => {
        if (!skillAim.active) return;
        // 只有瞄准手指抬起才结束
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === skillAim.touchId) {
                endSkillAim();
                return;
            }
        }
    });
    window.addEventListener('touchcancel', (e) => {
        if (!skillAim.active) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === skillAim.touchId) {
                endSkillAim();
                return;
            }
        }
    });
    window.addEventListener('mouseup', (e) => { if (skillAim.active) endSkillAim(); });

    return {
        startSkillAim,
        isSkillAimActive: () => skillAim.active
    };
}

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 *
 * @project   YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-07-26
 * @blog      https://blog.csdn.net/beiliwenxiao
 * @repo      https://github.com/beiliwenxiao/yijian18-engine
 *            https://gitee.com/coderaaa/yijian18-engine
 ************************************************************/

/**
 * ItemGainedPopup.js
 * 拾取 / 获得「食物·装备」时弹出的小窗口：
 *   - 左侧物品图标（复用 ItemIconRenderer）
 *   - 物品名（按稀有度着色）+ 描述
 *   - 装备类：与当前对应槽位装备的属性对比
 *       · 属性增加 → 箭头向上 ▲ + 红色 + 「+N」
 *       · 属性减少 → 箭头向下 ▼ + 绿色 + 「-N」
 *   - 工具/普通物品：放入背包 + 丢弃
 *   - 装备/可使用物品：立即装备/立即使用 + 放入背包 + 丢弃
 *
 * 用法（BaseGameScene）：
 *   popup.show({ item, comparison, actions });
 *   actions: [{ label, color, onClick }]
 */

import { UIElement } from './UIElement.js';
import { ItemIconRenderer } from './ItemIconRenderer.js';
import { InputHints } from '../core/input/InputHints.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

// 用户约定：涨红跌绿
const COLOR_UP = '#ff4d4d';   // 属性增加：红
const COLOR_DOWN = '#3cc46a'; // 属性减少：绿
const RARITY_COLORS = ['#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000'];

// 紧凑布局常量（保证高度最矮）
const PAD = 8;        // 内边距
const ICON_SIZE = 48; // 图标框边长
const ROW_H = 18;     // 属性对比行高
const BTN_H = 44;     // 按钮高度（为自动入包倒计时保留第二行）
const AUTO_STORE_SECONDS = 5;
const LEFT_STICK_NAV_THRESHOLD = 0.5;

export class ItemGainedPopup extends UIElement {
  constructor(options = {}) {
    super({
      x: options.x || 0,
      y: options.y || 0,
      width: options.width || 320,
      height: options.height || 240,
      visible: false,
      zIndex: options.zIndex || 260
    });

    this.item = null;
    this.comparison = [];
    this.primaryLabel = '装备';
    this.onPrimary = null;
    this.onStore = null;
    this.showStore = false;
    this.actions = [];
    this._selectedActionId = null;
    this._defaultActionId = null;
    this._buttons = []; // [{x,y,w,h,action}]
    this._autoStoreAction = null;
    this._autoStoreRemaining = 0;
    this._actionPending = false;
    this._leftStickNavArmed = false;
    this._leftStickDirection = 0;
    // 底部锚点：设置后 show() 会把弹窗底边对齐到 anchorBottom 上方（紧贴底部控制栏）
    this.anchorBottom = options.anchorBottom || null;
    this.anchorGap = options.anchorGap != null ? options.anchorGap : 8;
  }

  /**
   * 显示弹窗。
   * `actions` 是正式 API；旧 primary/store 字段仅作兼容转换。
   * @param {Object} cfg - { item, comparison, actions }
   */
  show(cfg = {}) {
    this._resetAutoStore();
    this._resetLeftStickNavigation();
    this._buttons = [];
    this.item = cfg.item || null;
    this.comparison = Array.isArray(cfg.comparison) ? cfg.comparison : [];
    this.primaryLabel = cfg.primaryLabel || '装备';
    this.onPrimary = cfg.onPrimary || null;
    this.onStore = cfg.onStore || null;
    this.showStore = cfg.showStore === true && this.onStore !== null;
    const legacyActions = [];
    if (this.onPrimary) legacyActions.push({ id: 'primary', label: this.primaryLabel, color: '#3a7d3a', onClick: this.onPrimary });
    if (this.showStore) legacyActions.push({
      id: 'store', label: '放入背包', color: '#4a4a55', onClick: this.onStore,
      autoTriggerSeconds: AUTO_STORE_SECONDS
    });
    this.actions = (Array.isArray(cfg.actions) ? cfg.actions : legacyActions)
      .filter(action => action && typeof action.label === 'string' && typeof action.onClick === 'function')
      .slice(0, 3);
    const requestedActionId = String(cfg.defaultActionId || '').trim();
    const defaultAction = this.actions.find(action => action.id === requestedActionId)
      || (this.item?.type === 'consumable' && this.item?.usable
        ? this.actions.find(action => action.id === 'primary')
        : null)
      || this.actions.find(action => action.id === 'store')
      || this.actions.find(action => action.id === 'primary')
      || this.actions[0]
      || null;
    this._defaultActionId = defaultAction?.id || null;
    // 只有手柄需要打开弹窗时预选动作；PC/触屏通过鼠标或触摸直接点击，避免弹窗抢占焦点。
    this._selectedActionId = InputHints.scheme === 'gamepad'
      ? this._defaultActionId
      : null;
    this._autoStoreAction = this.actions.find(action => action.id === 'store'
      && Number(action.autoTriggerSeconds) > 0) || null;
    this._autoStoreRemaining = this._autoStoreAction
      ? Math.max(0, Number(this._autoStoreAction.autoTriggerSeconds) || AUTO_STORE_SECONDS)
      : 0;
    this.remaining = cfg.remaining || 0; // 队列中还剩待处理的件数
    // 高度随对比行数自适应（紧凑布局，尽量矮）
    const rows = this.comparison.length;
    let h = PAD + ICON_SIZE + 8;             // 顶部内边距 + 图标区 + 间距
    if (rows > 0) h += rows * ROW_H + 4;     // 属性对比行
    h += BTN_H + PAD;                        // 按钮 + 底部内边距
    this.height = h;
    // 底部锚定：让弹窗底边紧贴 anchorBottom 上方
    if (this.anchorBottom != null) {
      this.y = this.anchorBottom - this.height - this.anchorGap;
    }
    this.visible = true;
  }

  hide() {
    this.visible = false;
    this.item = null;
    this.comparison = [];
    this.showStore = false;
    this.actions = [];
    this._selectedActionId = null;
    this._defaultActionId = null;
    this._buttons = [];
    this._resetAutoStore();
    this._resetLeftStickNavigation();
  }

  update(deltaTime) {
    if (!this.visible || !this._autoStoreAction || this._actionPending) return;
    this._autoStoreRemaining = Math.max(0, this._autoStoreRemaining - Math.max(0, Number(deltaTime) || 0));
    if (this._autoStoreRemaining <= 0) this._activateAction(this._autoStoreAction);
  }

  _resetAutoStore() {
    this._autoStoreAction = null;
    this._autoStoreRemaining = 0;
    this._actionPending = false;
  }

  _resetLeftStickNavigation() {
    this._leftStickNavArmed = false;
    this._leftStickDirection = 0;
  }

  _actionLabel(action) {
    if (action !== this._autoStoreAction || this._autoStoreRemaining <= 0) return action.label;
    const seconds = Math.max(1, Math.ceil(this._autoStoreRemaining));
    return `${action.label}\n${seconds}秒后自动放入背包`;
  }

  /** 按当前动作顺序循环移动焦点，不依赖 render 后才生成的按钮命中区。 */
  moveSelection(delta) {
    if (!this.visible || this._actionPending || this.actions.length === 0) return false;
    const direction = Math.sign(Number(delta) || 0);
    if (direction === 0) return false;
    const current = this.actions.findIndex(action => action.id === this._selectedActionId);
    const start = current >= 0 ? current : 0;
    const next = (start + direction + this.actions.length) % this.actions.length;
    this._selectedActionId = this.actions[next]?.id || null;
    return true;
  }

  /** 执行当前焦点动作。 */
  activateSelected() {
    const selected = this.actions.find(action => action.id === this._selectedActionId)
      || this.actions[0]
      || null;
    return this._activateAction(selected);
  }

  /**
   * 设备无关弹窗输入入口。鼠标只在命中弹窗时消费；触屏与手柄保持模态操作，
   * 避免触摸或手柄输入穿透到世界。
   */
  handleInput({ inputManager = null, gamepad = null } = {}) {
    if (!this.visible) return false;

    let pointerConsumed = false;
    if (inputManager?.isMouseClicked?.() && !inputManager.isMouseClickHandled?.()) {
      const point = inputManager.getMousePosition?.() || { x: 0, y: 0 };
      const button = inputManager.getMouseButton?.() === 2 ? 'right' : 'left';
      const isTouchInput = inputManager?.mouse?.isTouch === true;
      pointerConsumed = this.handleMouseClick(point.x, point.y, button) === true;
      if (pointerConsumed || isTouchInput) {
        // 触屏保持原有模态；鼠标仅在命中弹窗时阻止传播到世界。
        inputManager.markMouseClickHandled?.();
        pointerConsumed = true;
      }
      // 鼠标事件不能因提示方案残留为 gamepad 而被弹窗整帧接管。
      if (!isTouchInput) return pointerConsumed;
    }

    if (InputHints.scheme !== 'gamepad') return pointerConsumed;
    if (!this._selectedActionId) this._selectedActionId = this._defaultActionId;

    const padPressed = button => gamepad?.isButtonPressed?.(button) === true;

    // 使用 GamepadManager 已经过径向死区的纯左摇杆快照，避免 getMoveVector() 回退 D-pad。
    const stickX = Number(gamepad?.leftStick?.x) || 0;
    const stickDirection = stickX <= -LEFT_STICK_NAV_THRESHOLD
      ? -1
      : (stickX >= LEFT_STICK_NAV_THRESHOLD ? 1 : 0);
    let stickStep = 0;
    if (!this._leftStickNavArmed) {
      // 弹窗打开后必须先归中，不能继承玩家仍推住的世界移动方向。
      if (stickDirection === 0) this._leftStickNavArmed = true;
    } else if (stickDirection !== 0 && stickDirection !== this._leftStickDirection) {
      stickStep = stickDirection;
    }
    this._leftStickDirection = stickDirection;

    if (stickStep !== 0) this.moveSelection(stickStep);
    if (padPressed(PadButton.A)) this.activateSelected();
    return true;
  }

  _activateAction(action) {
    if (!this.visible || this._actionPending || typeof action?.onClick !== 'function') return false;
    this._actionPending = true;
    this._autoStoreAction = null;
    this._autoStoreRemaining = 0;
    try {
      const result = action.onClick();
      if (result && typeof result.catch === 'function') {
        result.catch(error => console.warn('ItemGainedPopup: action failed', error));
      }
      return true;
    } catch (error) {
      this._actionPending = false;
      console.warn('ItemGainedPopup: action failed', error);
      return false;
    }
  }

  /** 稀有度颜色 */
  _rarityColor() {
    const r = (this.item && this.item.rarity) || 0;
    return RARITY_COLORS[Math.max(0, Math.min(RARITY_COLORS.length - 1, r))];
  }

  render(ctx) {
    if (!this.visible || !this.item) return;
    const { x, y, width } = this;
    const rarityColor = this._rarityColor();

    ctx.save();

    // 面板背景 + 稀有度边框
    ctx.fillStyle = 'rgba(20, 22, 28, 0.96)';
    this._roundRect(ctx, x, y, width, this.height, 8);
    ctx.fill();
    ctx.strokeStyle = rarityColor;
    ctx.lineWidth = 2;
    this._roundRect(ctx, x, y, width, this.height, 8);
    ctx.stroke();

    // 图标框
    const iconX = x + 12;
    const iconY = y + PAD;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    this._roundRect(ctx, iconX, iconY, ICON_SIZE, ICON_SIZE, 5);
    ctx.fill();
    ctx.strokeStyle = rarityColor;
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, iconX, iconY, ICON_SIZE, ICON_SIZE, 5);
    ctx.stroke();
    // 图标只消费稳定图片或已登记的现有图标绘制；缺图不再用名称首字伪装资源。
    ItemIconRenderer.drawIcon(
      ctx,
      this.item,
      iconX + ICON_SIZE / 2,
      iconY + ICON_SIZE / 2,
      ICON_SIZE - 10
    );

    // 名称 + 描述（图标右侧，单行描述）
    const textX = iconX + ICON_SIZE + 12;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = rarityColor;
    ctx.font = 'bold 15px "Microsoft YaHei", Arial';
    ctx.fillText(this.item.name || '未知物品', textX, iconY + 2);
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '12px "Microsoft YaHei", Arial';
    this._wrapText(ctx, this.item.description || '', textX, iconY + 24, width - (textX - x) - 12, 14, 2);

    // 队列剩余提示（右上角）
    if (this.remaining > 0) {
      ctx.fillStyle = '#ffd24d';
      ctx.font = '11px "Microsoft YaHei", Arial';
      ctx.textAlign = 'right';
      ctx.fillText(`还有 ${this.remaining} 件`, x + width - 10, y + 6);
      ctx.textAlign = 'left';
    }

    // 属性对比（无标题，紧凑列出）
    let cursorY = iconY + ICON_SIZE + 8;
    if (this.comparison.length > 0) {
      ctx.font = '12px "Microsoft YaHei", Arial';
      for (const c of this.comparison) {
        const up = c.diff > 0;
        ctx.fillStyle = '#bbbbbb';
        ctx.fillText(c.name, x + 16, cursorY);
        ctx.fillStyle = up ? COLOR_UP : COLOR_DOWN;
        const arrow = up ? '▲' : '▼';
        const num = (up ? '+' : '-') + Math.abs(c.diff);
        ctx.fillText(`${arrow} ${num}`, x + 120, cursorY);
        cursorY += ROW_H;
      }
      cursorY += 4;
    }

    // 可按物品类型配置 2 或 3 个动作；按钮均分一行，避免把已提交库存再次入包。
    this._buttons = [];
    const actions = this.actions;
    const btnY = y + this.height - BTN_H - PAD;
    const gap = 6;
    const btnX = x + 12;
    const btnW = (width - 24 - gap * Math.max(0, actions.length - 1)) / Math.max(1, actions.length);
    actions.forEach((action, index) => {
      this._drawButton(ctx, btnX + index * (btnW + gap), btnY, btnW, BTN_H,
        this._actionLabel(action), action.color || '#4a4a55', action);
    });

    ctx.restore();
  }

  /** @private 画按钮并登记命中区 */
  _drawButton(ctx, bx, by, bw, bh, label, bg, action) {
    const selected = InputHints.scheme === 'gamepad'
      && action?.id === this._selectedActionId;
    ctx.save();
    if (selected) {
      ctx.shadowColor = 'rgba(255, 210, 77, 0.75)';
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = bg;
    this._roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected ? '#ffd24d' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = selected ? 3 : 1;
    this._roundRect(ctx, bx, by, bw, bh, 6);
    ctx.stroke();
    if (selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      this._roundRect(ctx, bx + 3, by + 3, bw - 6, bh - 6, 4);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = String(label || '').split('\n');
    if (lines.length > 1) {
      ctx.font = 'bold 12px "Microsoft YaHei", Arial';
      ctx.fillText(lines[0], bx + bw / 2, by + bh / 2 - 8);
      ctx.font = '9px "Microsoft YaHei", Arial';
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(lines[1], bx + bw / 2, by + bh / 2 + 9);
    } else {
      ctx.font = 'bold 14px "Microsoft YaHei", Arial';
      ctx.fillText(lines[0], bx + bw / 2, by + bh / 2);
    }
    ctx.restore();
    this._buttons.push({ x: bx, y: by, w: bw, h: bh, action });
  }

  handleMouseClick(x, y, button = 'left') {
    if (!this.visible) return false;
    if (button === 'left') {
      for (const b of this._buttons) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          this._selectedActionId = b.action?.id || this._selectedActionId;
          this._activateAction(b.action);
          return true;
        }
      }
    }
    // 弹窗范围内的任意鼠标键都由 UI 拦截，框外则继续交给世界输入。
    return this.isPointInside(x, y);
  }

  /** @private 圆角矩形路径 */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** @private 简单文本换行（最多 maxLines 行，超出省略号） */
  _wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    if (!text) return;
    const chars = String(text).split('');
    let line = '';
    let lines = 0;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth) {
        lines++;
        if (lines >= maxLines) {
          ctx.fillText(line.slice(0, -1) + '…', x, y);
          return;
        }
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = chars[i];
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }
}

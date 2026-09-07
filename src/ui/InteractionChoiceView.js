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

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

const LEFT_STICK_NAV_THRESHOLD = 0.5;
const PANEL_PADDING = 12;
const BUTTON_GAP = 8;
const BUTTON_HEIGHT = 44;

/**
 * 通用空间交互选择窗。只持有显示动作与回调，不读取或修改业务状态。
 */
export class InteractionChoiceView extends UIElement {
  constructor(options = {}) {
    super({
      x: options.x || 0,
      y: options.y || 0,
      width: options.width || 420,
      height: options.height || 126,
      visible: false,
      zIndex: options.zIndex || 270
    });
    this.anchorBottom = options.anchorBottom ?? null;
    this.anchorGap = options.anchorGap ?? 8;
    this.title = '';
    this.description = '';
    this.actions = [];
    this.selectedActionId = null;
    this.defaultActionId = null;
    this.allowCancel = true;
    this.busy = false;
    this.onCancel = null;
    this._leftStickNavArmed = false;
    this._leftStickDirection = 0;
  }

  /** 显示一组互斥交互动作；动作 id 必须唯一且稳定。 */
  open(config = {}) {
    const ids = new Set();
    const actions = (Array.isArray(config.actions) ? config.actions : []).map(action => {
      const id = String(action?.id || '').trim();
      const label = String(action?.label || '').trim();
      if (!id || !label || typeof action?.onClick !== 'function') {
        throw new TypeError('InteractionChoiceView action requires id, label and onClick');
      }
      if (ids.has(id)) throw new TypeError(`InteractionChoiceView action id duplicated: ${id}`);
      ids.add(id);
      return Object.freeze({ id, label, color: action.color || '#4a4a55', onClick: action.onClick });
    });
    if (actions.length === 0) {
      this.close();
      return false;
    }

    const requestedDefaultId = String(config.defaultActionId || '').trim();
    const defaultAction = actions.find(action => action.id === requestedDefaultId) || actions[0];
    this.title = String(config.title || '选择交互');
    this.description = String(config.description || '请选择要进行的操作');
    this.actions = actions;
    this.defaultActionId = defaultAction.id;
    this.selectedActionId = defaultAction.id;
    this.allowCancel = config.allowCancel !== false;
    this.onCancel = typeof config.onCancel === 'function' ? config.onCancel : null;
    this.busy = false;
    this._resetLeftStickNavigation();
    this.visible = true;
    return true;
  }

  close() {
    this.visible = false;
    this.title = '';
    this.description = '';
    this.actions = [];
    this.selectedActionId = null;
    this.defaultActionId = null;
    this.busy = false;
    this.onCancel = null;
    this._resetLeftStickNavigation();
  }

  setBusy(value) {
    this.busy = value === true;
  }

  _resetLeftStickNavigation() {
    this._leftStickNavArmed = false;
    this._leftStickDirection = 0;
  }

  _applyViewport(viewWidth, viewHeight) {
    const safeWidth = Math.max(240, Number(viewWidth) || 1280);
    const safeHeight = Math.max(160, Number(viewHeight) || 720);
    this.width = Math.min(560, Math.max(320, 180 + this.actions.length * 110), safeWidth - 24);
    this.height = this.description ? 126 : 104;
    this.x = Math.round((safeWidth - this.width) / 2);
    const anchorBottom = this.anchorBottom == null ? safeHeight - 100 : this.anchorBottom;
    this.y = Math.max(8, Math.round(anchorBottom - this.height - this.anchorGap));
  }

  _buttonLayout() {
    const count = Math.max(1, this.actions.length);
    const availableWidth = this.width - PANEL_PADDING * 2 - BUTTON_GAP * Math.max(0, count - 1);
    const buttonWidth = availableWidth / count;
    const buttonY = this.y + this.height - BUTTON_HEIGHT - PANEL_PADDING;
    return this.actions.map((action, index) => ({
      action,
      x: this.x + PANEL_PADDING + index * (buttonWidth + BUTTON_GAP),
      y: buttonY,
      width: buttonWidth,
      height: BUTTON_HEIGHT
    }));
  }

  moveSelection(delta) {
    if (!this.visible || this.busy || this.actions.length === 0) return false;
    const direction = Math.sign(Number(delta) || 0);
    if (!direction) return false;
    const current = Math.max(0, this.actions.findIndex(action => action.id === this.selectedActionId));
    const next = (current + direction + this.actions.length) % this.actions.length;
    this.selectedActionId = this.actions[next].id;
    return true;
  }

  activateSelected() {
    const action = this.actions.find(candidate => candidate.id === this.selectedActionId)
      || this.actions.find(candidate => candidate.id === this.defaultActionId)
      || this.actions[0]
      || null;
    return this._activateAction(action);
  }

  handleInput({ inputManager = null, gamepad = null, viewWidth = 1280, viewHeight = 720 } = {}) {
    if (!this.visible) return false;
    this._applyViewport(viewWidth, viewHeight);
    if (this.busy || !inputManager) return true;

    const left = inputManager.isKeyPressed?.('arrowleft') || inputManager.isKeyPressed?.('a');
    const right = inputManager.isKeyPressed?.('arrowright') || inputManager.isKeyPressed?.('d');
    if (left) this.moveSelection(-1);
    if (right) this.moveSelection(1);

    const stickX = Number(gamepad?.leftStick?.x) || 0;
    const stickDirection = stickX <= -LEFT_STICK_NAV_THRESHOLD
      ? -1
      : (stickX >= LEFT_STICK_NAV_THRESHOLD ? 1 : 0);
    if (!this._leftStickNavArmed) {
      if (stickDirection === 0) this._leftStickNavArmed = true;
    } else if (stickDirection !== 0 && stickDirection !== this._leftStickDirection) {
      this.moveSelection(stickDirection);
    }
    this._leftStickDirection = stickDirection;

    if (inputManager.isMouseClicked?.() && !inputManager.isMouseClickHandled?.()) {
      const point = inputManager.getMousePosition?.() || { x: -1, y: -1 };
      const button = inputManager.getMouseButton?.() === 2 ? 'right' : 'left';
      this.handleMouseClick(point.x, point.y, button);
      inputManager.markMouseClickHandled?.();
    }

    const confirmed = inputManager.isKeyPressed?.('e')
      || inputManager.isKeyPressed?.('enter')
      || gamepad?.isButtonPressed?.(PadButton.A) === true
      || gamepad?.isButtonPressed?.(PadButton.X) === true;
    if (confirmed) this.activateSelected();

    const cancelled = inputManager.isKeyPressed?.('escape')
      || gamepad?.isButtonPressed?.(PadButton.B) === true;
    if (cancelled && this.allowCancel) this._cancel();
    return true;
  }

  handleMouseClick(x, y, button = 'left') {
    if (!this.visible) return false;
    if (!this.busy && button === 'left') {
      const target = this._buttonLayout().find(box => (
        x >= box.x && x <= box.x + box.width
        && y >= box.y && y <= box.y + box.height
      ));
      if (target) {
        this.selectedActionId = target.action.id;
        this._activateAction(target.action);
      }
    }
    return true;
  }

  _activateAction(action) {
    if (!this.visible || this.busy || typeof action?.onClick !== 'function') return false;
    this.busy = true;
    try {
      const result = action.onClick();
      if (result && typeof result.catch === 'function') {
        result.catch(error => {
          this.busy = false;
          console.error('InteractionChoiceView: action failed', error);
        });
      }
      return true;
    } catch (error) {
      this.busy = false;
      console.error('InteractionChoiceView: action failed', error);
      return false;
    }
  }

  _cancel() {
    const callback = this.onCancel;
    this.close();
    callback?.();
  }

  render(ctx) {
    if (!this.visible || !ctx) return;
    this._applyViewport(ctx.canvas?.width, ctx.canvas?.height);
    const buttons = this._buttonLayout();
    ctx.save();
    ctx.fillStyle = 'rgba(20, 22, 28, 0.96)';
    ctx.strokeStyle = '#d6b85f';
    ctx.lineWidth = 2;
    this._roundRect(ctx, this.x, this.y, this.width, this.height, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f2d17a';
    ctx.font = 'bold 16px "Microsoft YaHei", Arial';
    ctx.fillText(this.title, this.x + this.width / 2, this.y + 10);
    if (this.description) {
      ctx.fillStyle = '#c9c9c9';
      ctx.font = '12px "Microsoft YaHei", Arial';
      ctx.fillText(this.description, this.x + this.width / 2, this.y + 34);
    }

    for (const box of buttons) this._drawButton(ctx, box);
    if (this.busy) {
      ctx.fillStyle = '#f0cf77';
      ctx.font = '11px "Microsoft YaHei", Arial';
      ctx.fillText('正在执行……', this.x + this.width / 2, this.y + this.height - 14);
    }
    ctx.restore();
  }

  _drawButton(ctx, box) {
    const selected = box.action.id === this.selectedActionId;
    ctx.save();
    if (selected) {
      ctx.shadowColor = 'rgba(255, 210, 77, 0.75)';
      ctx.shadowBlur = 8;
    }
    ctx.fillStyle = box.action.color;
    this._roundRect(ctx, box.x, box.y, box.width, box.height, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected ? '#ffd24d' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = selected ? 3 : 1;
    this._roundRect(ctx, box.x, box.y, box.width, box.height, 6);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px "Microsoft YaHei", Arial';
    ctx.fillText(box.action.label, box.x + box.width / 2, box.y + box.height / 2 - 4);
    if (selected) {
      ctx.fillStyle = '#fff2b0';
      ctx.font = '9px "Microsoft YaHei", Arial';
      ctx.fillText(InputHints.phrase('confirm'), box.x + box.width / 2, box.y + box.height - 8);
    }
    ctx.restore();
  }

  _roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
}

export default InteractionChoiceView;

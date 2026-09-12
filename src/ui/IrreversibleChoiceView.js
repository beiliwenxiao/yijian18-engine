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

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));

/** 只消费不可变显示快照并发出命令；领域层拥有不可逆选择。 */
export class IrreversibleChoiceView extends UIElement {
  constructor(options = {}) {
    super({
      x: 0, y: 0,
      width: options.width || 600,
      height: options.height || 320,
      visible: false,
      zIndex: options.zIndex || 125
    });
    this.onCommand = options.onCommand || (() => {});
    this.snapshot = null;
    this.selectedId = null;
    this.busy = false;
  }

  open(snapshot = {}) {
    this.snapshot = clone(snapshot);
    const choices = this.snapshot?.choices || [];
    this.selectedId = choices.some(choice => choice.id === snapshot.selectedId)
      ? snapshot.selectedId
      : choices[0]?.id || null;
    this.busy = false;
    this.visible = choices.length > 0;
  }

  close() {
    this.visible = false;
    this.snapshot = null;
    this.selectedId = null;
    this.busy = false;
  }

  setBusy(value) { this.busy = value === true; }

  get isCompact() {
    return this.snapshot?.presentation?.variant === 'compact';
  }

  get allowsWorldMovement() {
    return this.visible && this.snapshot?.presentation?.allowMovement === true;
  }

  _layout(viewWidth, viewHeight) {
    const choices = this.snapshot?.choices || [];
    const compact = this.isCompact;
    const width = Math.min(compact ? 360 : this.width, viewWidth - (compact ? 24 : 32));
    const height = compact ? 164 : this.height;
    const x = (viewWidth - width) / 2;
    const y = (viewHeight - height) / 2;
    const inset = compact ? 14 : 24;
    const gap = compact ? 10 : 16;
    const cardWidth = (width - inset * 2 - gap * Math.max(0, choices.length - 1)) / Math.max(1, choices.length);
    const cards = choices.map((choice, index) => ({
      id: choice.id,
      x: x + inset + index * (cardWidth + gap),
      y: y + (compact ? 90 : 110),
      width: cardWidth,
      height: compact ? 42 : 132
    }));
    return { x, y, width, height, cards, compact };
  }

  handleInput({ inputManager, gamepad, viewWidth, viewHeight } = {}) {
    if (!this.visible) return false;
    if (this.busy || !inputManager) return true;
    const choices = this.snapshot?.choices || [];
    const compact = this.isCompact;
    const index = Math.max(0, choices.findIndex(choice => choice.id === this.selectedId));
    if (!compact) {
      const left = inputManager.isKeyPressed?.('arrowleft') || inputManager.isKeyPressed?.('a');
      const right = inputManager.isKeyPressed?.('arrowright') || inputManager.isKeyPressed?.('d');
      if (left && choices.length) this.selectedId = choices[(index - 1 + choices.length) % choices.length].id;
      if (right && choices.length) this.selectedId = choices[(index + 1) % choices.length].id;
    }

    const clicked = inputManager.isMouseClicked?.() === true
      && !inputManager.isMouseClickHandled?.()
      && (!compact || inputManager.getMouseButton?.() === 0);
    if (clicked) {
      const mouse = inputManager.getMousePosition?.() || { x: -1, y: -1 };
      const card = this._layout(viewWidth, viewHeight).cards.find(box => (
        mouse.x >= box.x && mouse.x <= box.x + box.width
        && mouse.y >= box.y && mouse.y <= box.y + box.height
      ));
      // 紧凑复活确认只拦截左键，保留右键移动；所有其他世界动作仍由 modal 路由消费。
      inputManager.markMouseClickHandled?.();
      if (card) {
        const choice = choices.find(item => item.id === card.id);
        const alreadySelected = this.selectedId === card.id;
        this.selectedId = card.id;
        if (choice?.immediate === true || alreadySelected) this._confirm();
      }
    }

    const confirmed = inputManager.isKeyPressed?.('e')
      || inputManager.isKeyPressed?.('enter')
      || gamepad?.isButtonPressed?.(PadButton.A) === true
      || gamepad?.isButtonPressed?.(PadButton.X) === true;
    if (confirmed) this._confirm();
    const cancelled = inputManager.isKeyPressed?.('escape')
      || gamepad?.isButtonPressed?.(PadButton.B) === true;
    if (cancelled && this.snapshot?.allowCancel === true) this.onCommand({ type: 'cancel' });
    return true;
  }

  _confirm() {
    if (this.busy || !this.selectedId) return;
    this.onCommand({ type: 'selectChoice', choiceId: this.selectedId });
  }

  render(ctx, viewWidth = ctx?.canvas?.width || 1280, viewHeight = ctx?.canvas?.height || 720) {
    if (!this.visible || !ctx || !this.snapshot) return;
    const layout = this._layout(viewWidth, viewHeight);
    ctx.save();
    if (!layout.compact) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, viewWidth, viewHeight);
    }
    ctx.fillStyle = 'rgba(22,24,28,0.98)';
    ctx.strokeStyle = '#d6b85f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(layout.x, layout.y, layout.width, layout.height, layout.compact ? 8 : 10);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f2d17a';
    ctx.font = layout.compact ? 'bold 18px Arial' : 'bold 22px Arial';
    ctx.fillText(this.snapshot.title || '不可逆选择', layout.x + layout.width / 2, layout.y + (layout.compact ? 13 : 18));
    ctx.fillStyle = '#e5e0d5';
    ctx.font = layout.compact ? '12px Arial' : '14px Arial';
    ctx.fillText(this.snapshot.description || '选择确认后不可更改。', layout.x + layout.width / 2, layout.y + (layout.compact ? 42 : 56));
    ctx.fillStyle = '#efb45c';
    ctx.font = layout.compact ? '11px Arial' : '12px Arial';
    ctx.fillText(this.snapshot.warning || '选择不可逆，请确认后果', layout.x + layout.width / 2, layout.y + (layout.compact ? 63 : 82));
    layout.cards.forEach((box, index) => this._renderChoice(ctx, box, this.snapshot.choices[index], layout.compact));
    ctx.fillStyle = this.busy ? '#f0cf77' : '#c9c9c9';
    ctx.font = layout.compact ? '11px Arial' : '13px Arial';
    const hint = this.busy
      ? '正在提交选择……'
      : `${InputHints.phrase('confirm')}确认${this.snapshot.allowCancel ? `，${InputHints.phrase('modalCancel')}取消` : ''}`;
    ctx.fillText(hint, layout.x + layout.width / 2, layout.y + layout.height - (layout.compact ? 18 : 38));
    ctx.restore();
  }

  _renderChoice(ctx, box, choice = {}, compact = false) {
    const selected = this.selectedId === choice.id;
    ctx.fillStyle = selected ? 'rgba(214,184,95,0.2)' : 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = selected ? '#f2d17a' : '#676767';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.width, box.height, compact ? 6 : 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = selected ? '#f2d17a' : '#e0e0e0';
    ctx.font = compact ? 'bold 15px Arial' : 'bold 17px Arial';
    ctx.fillText(choice.label || choice.id || '未命名选项', box.x + box.width / 2, box.y + (compact ? 12 : 14));
    if (compact) return;
    ctx.fillStyle = '#d0d0d0';
    ctx.font = '12px Arial';
    (choice.consequences || []).slice(0, 4).forEach((line, index) => {
      ctx.fillText(String(line), box.x + box.width / 2, box.y + 48 + index * 18);
    });
  }
}

export default IrreversibleChoiceView;

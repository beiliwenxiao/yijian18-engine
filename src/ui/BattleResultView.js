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

/************************************************************
 * YiJian18-Engine - read-only battle result modal
 ************************************************************/

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));

export class BattleResultView extends UIElement {
  constructor(options = {}) {
    super({ width: options.width || 520, height: options.height || 330, visible: false, zIndex: 130 });
    this.snapshot = null;
    this.onCommand = options.onCommand || (() => {});
  }

  open(snapshot) {
    this.snapshot = clone(snapshot);
    this.visible = true;
  }

  close() {
    this.snapshot = null;
    this.visible = false;
  }

  _layout(viewWidth, viewHeight) {
    const width = Math.min(this.width, viewWidth - 32);
    const height = Math.min(this.height, viewHeight - 32);
    return {
      x: (viewWidth - width) / 2,
      y: (viewHeight - height) / 2,
      width,
      height,
      button: { x: (viewWidth - 180) / 2, y: (viewHeight + height) / 2 - 58, width: 180, height: 38 }
    };
  }

  handleInput({ inputManager, gamepad, viewWidth, viewHeight } = {}) {
    if (!this.visible) return false;
    if (!inputManager) return true;
    const confirmed = inputManager.isKeyPressed?.('e')
      || inputManager.isKeyPressed?.('enter')
      || gamepad?.isButtonPressed?.(PadButton.A) === true
      || gamepad?.isButtonPressed?.(PadButton.X) === true;
    const clicked = inputManager.isMouseClicked?.() === true && !inputManager.isMouseClickHandled?.();
    let buttonClicked = false;
    if (clicked) {
      const mouse = inputManager.getMousePosition?.() || { x: -1, y: -1 };
      const button = this._layout(viewWidth, viewHeight).button;
      buttonClicked = mouse.x >= button.x && mouse.x <= button.x + button.width
        && mouse.y >= button.y && mouse.y <= button.y + button.height;
      inputManager.markMouseClickHandled?.();
    }
    if (confirmed || buttonClicked) this.onCommand({ type: 'close' });
    return true;
  }

  render(ctx, viewWidth = ctx?.canvas?.width || 1280, viewHeight = ctx?.canvas?.height || 720) {
    if (!this.visible || !this.snapshot || !ctx) return;
    const layout = this._layout(viewWidth, viewHeight);
    const result = this.snapshot.result || {};
    const changes = this.snapshot.worldChanges || {};
    const transfer = result.resourceTransfer?.resources || {};
    const resourceText = Object.entries(transfer).filter(([, amount]) => amount > 0)
      .map(([name, amount]) => `${name} +${amount}`).join('，') || '无资源转移';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = 'rgba(24,25,29,0.98)';
    ctx.strokeStyle = '#d6b85f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(layout.x, layout.y, layout.width, layout.height, 10);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f2d17a';
    ctx.font = 'bold 23px Arial';
    ctx.fillText(this.snapshot.title || '战役结算', layout.x + layout.width / 2, layout.y + 20);
    ctx.fillStyle = '#f0f0f0';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`胜方：${this.snapshot.winnerName || result.winnerFactionId}`, layout.x + layout.width / 2, layout.y + 62);
    ctx.font = '14px Arial';
    const lines = [
      `参战方式：${this.snapshot.mode === 'intervene' ? '介入' : '观战'}`,
      `资源转移：${resourceText}`,
      `城市损毁增加：${Math.round((Number(result.cityDamage) || 0) * 100)}%`,
      `时间推进：${changes.month ? `${changes.month}月` : '未变化'}`,
      this.snapshot.message || '战果已冻结，城市与战争状态已写入检查点。'
    ];
    lines.forEach((line, index) => {
      ctx.fillStyle = index === lines.length - 1 ? '#d8c994' : '#d8d8d8';
      ctx.fillText(line, layout.x + layout.width / 2, layout.y + 98 + index * 27);
    });

    ctx.fillStyle = '#7c6835';
    ctx.beginPath();
    ctx.roundRect(layout.button.x, layout.button.y, layout.button.width, layout.button.height, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`${InputHints.phrase('confirm')}继续`, layout.button.x + layout.button.width / 2, layout.button.y + 10);
    ctx.restore();
  }
}

export default BattleResultView;

/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * 
 * @project   YiJian18-Engine - 跨平台2D/3D ARPG游戏引擎
 * @author    刘枭 (beiliwenxiao)
 * @email     beiliwenxiao@qq.com
 * @date      2026-01-14
 * @blog      `https://blog.csdn.net/beiliwenxiao`
 * @repo      `https://github.com/beiliwenxiao/yijian18-engine`
 *            `https://github.com/coderaaa/yijian18-engine`
 ************************************************************/

/************************************************************
 * YiJian18-Engine - read-only battle result modal
 ************************************************************/

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';
import { PadButton } from '../core/input/Xbox360Profile.js';

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));

export const BATTLE_IDENTITY_LABELS = Object.freeze({
  takeover: '接管',
  support: '随军',
  observe: '观战'
});

export function resolveBattleIdentityLabel(identity) {
  return BATTLE_IDENTITY_LABELS[identity] || String(identity || '观战');
}

function formatLedger(label, ledger) {
  if (!ledger || typeof ledger !== 'object') return `${label}：无记录`;
  const parts = Object.entries(ledger)
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) !== 0)
    .map(([key, value]) => `${key} ${value}`);
  return `${label}：${parts.length ? parts.join(' · ') : '无损失'}`;
}

/** 战果文本行（纯函数，便于单测）。 */
export function buildBattleResultLines(snapshot = {}) {
  const result = snapshot.result || {};
  const changes = snapshot.worldChanges || {};
  const transfer = result.resourceTransfer?.resources || {};
  const resourceText = Object.entries(transfer).filter(([, amount]) => amount > 0)
    .map(([name, amount]) => `${name} +${amount}`).join('，') || '无资源转移';
  const lines = [
    `参战方式：${snapshot.mode === 'intervene' ? '介入' : '观战'}`,
    `接管身份：${resolveBattleIdentityLabel(snapshot.identity)}${snapshot.identity === 'support' ? '（随军，不可发将令）' : ''}`,
    `资源转移：${resourceText}`,
    `城市损毁增加：${Math.round((Number(result.cityDamage) || 0) * 100)}%`
  ];
  if (snapshot.ledgers) {
    lines.push(formatLedger('战败账', snapshot.ledgers.defeat));
    lines.push(formatLedger('逃亡账', snapshot.ledgers.fled));
  }
  const scattered = Number(snapshot.scattered?.count ?? snapshot.scattered ?? 0);
  if (scattered > 0) lines.push(`散兵可收拢：${scattered}`);
  const caches = Array.isArray(snapshot.supplyCaches) ? snapshot.supplyCaches : [];
  if (caches.length) lines.push(`可追回辎重：${caches.length} 处`);
  lines.push(`时间推进：${changes.month ? `${changes.month}月` : '未变化'}`);
  lines.push(snapshot.message || '战果已冻结，城市与战争状态已写入检查点。');
  return lines;
}

/** 可用操作（纯函数）：追回辎重 / 收拢散兵 / 接管身份切换。 */
export function buildBattleResultActions(snapshot = {}) {
  const actions = [];
  const caches = Array.isArray(snapshot.supplyCaches) ? snapshot.supplyCaches : [];
  if (caches.length) {
    const cacheId = caches[0]?.cacheId ?? caches[0]?.id ?? null;
    actions.push({ type: 'recover', cacheId, label: '追回辎重' });
  }
  if (Number(snapshot.scattered?.count ?? snapshot.scattered ?? 0) > 0) {
    actions.push({ type: 'regroup', label: '收拢散兵' });
  }
  const options = Array.isArray(snapshot.identityOptions) ? snapshot.identityOptions : [];
  for (const option of options) {
    const identity = typeof option === 'string' ? option : option?.identity;
    if (!identity || identity === snapshot.identity) continue;
    actions.push({
      type: 'entry',
      identity,
      label: typeof option === 'object' && option.label ? option.label : `以${resolveBattleIdentityLabel(identity)}入场`
    });
  }
  return actions;
}

export class BattleResultView extends UIElement {
  constructor(options = {}) {
    super({ width: options.width || 520, height: options.height || 330, visible: false, zIndex: 130 });
    this.baseHeight = options.height || 330;
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

  _actions() {
    return buildBattleResultActions(this.snapshot || {});
  }

  _layout(viewWidth, viewHeight) {
    const lines = buildBattleResultLines(this.snapshot || {});
    const actions = this._actions();
    const width = Math.min(this.width, viewWidth - 32);
    const actionRows = actions.length ? Math.ceil(actions.length / 3) : 0;
    const contentHeight = 190 + lines.length * 24 + actionRows * 46;
    const height = Math.min(Math.max(this.baseHeight, contentHeight), viewHeight - 32);
    const buttons = [];
    const buttonWidth = 150;
    const buttonHeight = 36;
    const gap = 10;
    const perRow = 3;
    const startY = (viewHeight + height) / 2 - 62 - actionRows * (buttonHeight + 8);
    actions.forEach((action, index) => {
      const row = Math.floor(index / perRow);
      const col = index % perRow;
      const rowCount = Math.min(perRow, actions.length - row * perRow);
      const rowWidth = rowCount * buttonWidth + (rowCount - 1) * gap;
      buttons.push({
        ...action,
        x: (viewWidth - rowWidth) / 2 + col * (buttonWidth + gap),
        y: startY + row * (buttonHeight + 8),
        width: buttonWidth,
        height: buttonHeight
      });
    });
    return {
      x: (viewWidth - width) / 2,
      y: (viewHeight - height) / 2,
      width,
      height,
      lines,
      buttons,
      closeButton: {
        x: (viewWidth - 180) / 2,
        y: (viewHeight + height) / 2 - 58,
        width: 180,
        height: 38
      }
    };
  }

  handleInput({ inputManager, gamepad, viewWidth, viewHeight } = {}) {
    if (!this.visible) return false;
    if (!inputManager) return true;
    const layout = this._layout(viewWidth, viewHeight);
    const confirmed = inputManager.isKeyPressed?.('e')
      || inputManager.isKeyPressed?.('enter')
      || gamepad?.isButtonPressed?.(PadButton.A) === true
      || gamepad?.isButtonPressed?.(PadButton.X) === true;
    const clicked = inputManager.isMouseClicked?.() === true && !inputManager.isMouseClickHandled?.();
    let closeClicked = false;
    let actionClicked = null;
    if (clicked) {
      const mouse = inputManager.getMousePosition?.() || { x: -1, y: -1 };
      const inRect = rect => rect
        && mouse.x >= rect.x && mouse.x <= rect.x + rect.width
        && mouse.y >= rect.y && mouse.y <= rect.y + rect.height;
      closeClicked = inRect(layout.closeButton);
      actionClicked = layout.buttons.find(inRect) || null;
      inputManager.markMouseClickHandled?.();
    }
    if (actionClicked) {
      const { x, y, width, height, ...command } = actionClicked;
      this.onCommand(command);
      return true;
    }
    if (confirmed || closeClicked) this.onCommand({ type: 'close' });
    return true;
  }

  render(ctx, viewWidth = ctx?.canvas?.width || 1280, viewHeight = ctx?.canvas?.height || 720) {
    if (!this.visible || !this.snapshot || !ctx) return;
    const layout = this._layout(viewWidth, viewHeight);
    const lines = layout.lines;
    const result = this.snapshot.result || {};
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
    lines.forEach((line, index) => {
      ctx.fillStyle = index === lines.length - 1 ? '#d8c994' : '#d8d8d8';
      ctx.fillText(line, layout.x + layout.width / 2, layout.y + 94 + index * 24);
    });

    for (const button of layout.buttons) {
      ctx.fillStyle = '#7c6835';
      ctx.beginPath();
      ctx.roundRect(button.x, button.y, button.width, button.height, 6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px Arial';
      ctx.fillText(button.label, button.x + button.width / 2, button.y + 10);
    }

    ctx.fillStyle = '#7c6835';
    ctx.beginPath();
    ctx.roundRect(layout.closeButton.x, layout.closeButton.y, layout.closeButton.width, layout.closeButton.height, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`${InputHints.phrase('confirm')}继续`, layout.closeButton.x + layout.closeButton.width / 2, layout.closeButton.y + 10);
    ctx.restore();
  }
}

export default BattleResultView;

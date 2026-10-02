/************************************************************
 * YiJian18-Engine - read-only ending presentation view
 ************************************************************/

import { UIElement } from './UIElement.js';
import { InputHints } from '../core/input/InputHints.js';

const DEFAULT_TITLE_DURATION = 2600;
const DEFAULT_SHOT_DURATION = 5000;
const ACTIONS = Object.freeze([
  Object.freeze({ type: 'returnTitle', label: '返回标题' }),
  Object.freeze({ type: 'loadPreEndingSave', label: '读取结局前存档' }),
  Object.freeze({ type: 'viewUnlockedEndings', label: '查看已解锁结局' })
]);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

/**
 * 通用只读终局演出。只消费冻结结果和表现元数据，并向宿主发出命令。
 */
export class EndingPresentationView extends UIElement {
  constructor(options = {}) {
    super({
      x: 0,
      y: 0,
      width: options.width || 1280,
      height: options.height || 720,
      visible: false,
      zIndex: options.zIndex || 200
    });
    this.resolveImage = options.resolveImage || (() => null);
    this.onMusicChange = options.onMusicChange || (() => {});
    this.onCommand = options.onCommand || (() => {});
    this.autoAdvance = options.autoAdvance !== false;
    this.snapshot = null;
    this.ending = null;
    this.reviewLines = [];
    this.phase = 'closed';
    this.shotIndex = -1;
    this.elapsed = 0;
    this.selectedAction = 0;
    this.busy = false;
    this.currentMusicId = null;
    this.imageCache = new Map();
    this.notice = null;
    this.noticeDeadline = 0;
    this.preSaveCheckpointId = null;
  }

  /**
   * @param {Object|{snapshot:Object, ending:Object, reviewLines:Array}} input
   * @param {Object} [endingMetadata]
   * @param {Array<string|Object>} [reviewLines]
   */
  open(input = {}, endingMetadata, reviewLines) {
    const payload = endingMetadata === undefined && input?.snapshot
      ? input
      : { snapshot: input, ending: endingMetadata, reviewLines };
    const snapshot = payload.snapshot || {};
    const suppliedMetadata = payload.ending || payload.metadata || {};
    const ending = Array.isArray(suppliedMetadata.endings)
      ? suppliedMetadata.endings.find(item => item.id === snapshot.endingId) || {}
      : suppliedMetadata;

    this.snapshot = deepFreeze(clone(snapshot));
    this.ending = deepFreeze(clone(ending));
    this.reviewLines = deepFreeze(clone(Array.isArray(payload.reviewLines) ? payload.reviewLines : []));
    this.phase = 'title';
    this.shotIndex = -1;
    this.elapsed = 0;
    this.selectedAction = 0;
    this.busy = false;
    this.notice = null;
    this.noticeDeadline = 0;
    this.preSaveCheckpointId = payload.preSaveCheckpointId || null;
    this.imageCache.clear();
    this.visible = true;
    this._changeMusic(this.ending.musicId || null);
  }

  close() {
    this.visible = false;
    this.snapshot = null;
    this.ending = null;
    this.reviewLines = [];
    this.phase = 'closed';
    this.shotIndex = -1;
    this.elapsed = 0;
    this.selectedAction = 0;
    this.busy = false;
    this.notice = null;
    this.noticeDeadline = 0;
    this.preSaveCheckpointId = null;
    this.imageCache.clear();
    this._changeMusic(null, true);
  }

  setBusy(value) {
    this.busy = value === true;
  }

  /**
   * 在结局视图自身之上显示反馈（错误/图鉴等）。
   * 场景层提示（_showScreenTip）会被本视图的全屏绘制盖住，必须画进视图内才可见。
   */
  showNotice(text, { durationMs = 3200 } = {}) {
    this.notice = String(text || '');
    this.noticeDeadline = typeof performance !== 'undefined'
      ? performance.now() + durationMs
      : Date.now() + durationMs;
  }

  _currentNotice() {
    if (!this.notice) return null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now > this.noticeDeadline) {
      this.notice = null;
      return null;
    }
    return this.notice;
  }

  update(deltaTime) {
    if (!this.visible || this.busy || !this.autoAdvance || this.phase === 'review') return;
    const delta = Number(deltaTime);
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.elapsed += delta;
    let guard = 0;
    while (this.elapsed >= this._currentDuration() && this.phase !== 'review' && guard < 32) {
      this.elapsed -= this._currentDuration();
      this._advance();
      guard += 1;
    }
  }

  /**
   * 输入必须提供动作级查询（isActionPressed/wasActionPressed 或 actions），
   * 因而组件不依赖键盘、触屏或手柄的物理按键。
   */
  handleInput(context = {}) {
    if (!this.visible) return false;
    const inputManager = context.inputManager;
    const viewWidth = context.viewWidth || this.width;
    const viewHeight = context.viewHeight || this.height;

    if (!this.busy) {
      if (this._actionPressed(context, 'modalCancel')) {
        this._emitCommand('close');
      } else if (this.phase !== 'review' && (
        this._actionPressed(context, 'skip')
        || this._actionPressed(context, 'dialogueContinue')
      )) {
        this._showReview();
      } else {
        this._handleNavigation(context);
        if (this._actionPressed(context, 'confirm')) this._confirm();
        this._handlePointer(inputManager, viewWidth, viewHeight);
      }
    } else {
      this._consumePointer(inputManager);
    }
    return true;
  }

  render(ctx, viewWidth = ctx?.canvas?.width || this.width, viewHeight = ctx?.canvas?.height || this.height) {
    if (!this.visible || !ctx || !this.ending) return;
    const width = Math.max(1, Number(viewWidth) || this.width);
    const height = Math.max(1, Number(viewHeight) || this.height);
    const layout = this._layout(width, height);

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = '#08090b';
    ctx.fillRect(0, 0, width, height);
    this._renderArtwork(ctx, width, height);
    this._renderShade(ctx, width, height);

    if (this.phase === 'title') this._renderTitle(ctx, layout);
    else if (this.phase === 'shot') this._renderShot(ctx, layout);
    else if (this.phase === 'review') this._renderReview(ctx, layout);

    this._renderHints(ctx, layout);
    this._renderNotice(ctx, layout);
    ctx.restore();
  }

  /** 命令反馈/结局图鉴：画在本视图内，保证不被自身全屏绘制盖住。 */
  _renderNotice(ctx, layout) {
    const text = this._currentNotice();
    if (!text) return;
    const fontSize = Math.max(13, Math.min(18, layout.viewWidth * 0.016));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = fontSize * 1.5;
    const characters = Array.from(text);
    const lines = [];
    let current = '';
    characters.forEach(character => {
      const candidate = current + character;
      if (current && ctx.measureText(candidate).width > layout.contentWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    });
    if (current || lines.length === 0) lines.push(current);
    const boxHeight = lines.length * lineHeight + 20;
    const boxY = layout.viewHeight * 0.32 - boxHeight / 2;
    ctx.fillStyle = 'rgba(12,14,17,0.92)';
    ctx.strokeStyle = 'rgba(241,213,138,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(layout.contentX, boxY, layout.contentWidth, boxHeight, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f5f1e7';
    lines.forEach((line, index) => {
      ctx.fillText(line, layout.viewWidth / 2, boxY + 10 + lineHeight * (index + 0.5));
    });
  }

  _advance() {
    const shots = this.ending?.shots || [];
    if (this.phase === 'title') {
      if (shots.length === 0) this._showReview();
      else this._showShot(0);
      return;
    }
    if (this.phase === 'shot') {
      if (this.shotIndex + 1 < shots.length) this._showShot(this.shotIndex + 1);
      else this._showReview();
    }
  }

  _showShot(index) {
    this.phase = 'shot';
    this.shotIndex = index;
    this.elapsed = 0;
    const shot = this.ending?.shots?.[index];
    this._changeMusic(shot?.musicId || this.ending?.musicId || null);
  }

  _showReview() {
    this.phase = 'review';
    this.shotIndex = -1;
    this.elapsed = 0;
    this.selectedAction = 0;
    this._changeMusic(this.ending?.reviewMusicId || this.ending?.musicId || null);
  }

  _currentDuration() {
    if (this.phase === 'title') {
      return Math.max(1, Number(this.ending?.titleDurationMs) || DEFAULT_TITLE_DURATION);
    }
    const shot = this.ending?.shots?.[this.shotIndex];
    return Math.max(1, Number(shot?.durationMs) || DEFAULT_SHOT_DURATION);
  }

  _confirm() {
    if (this.phase === 'review') {
      this._emitCommand(ACTIONS[this.selectedAction].type);
    } else {
      this._advance();
    }
  }

  _emitCommand(type) {
    this.onCommand({
      type,
      endingId: this.snapshot?.endingId || this.ending?.id || null,
      endingSnapshotId: this.snapshot?.endingSnapshotId || null
    });
  }

  _changeMusic(musicId, force = false) {
    const nextId = musicId || null;
    if (!force && nextId === this.currentMusicId) return;
    this.currentMusicId = nextId;
    this.onMusicChange(nextId);
  }

  _actionPressed(context, action) {
    const sources = [context, context.inputManager].filter(Boolean);
    for (const source of sources) {
      for (const method of ['isActionPressed', 'wasActionPressed']) {
        if (typeof source[method] === 'function' && source[method](action) === true) return true;
      }
      const actions = source.actions;
      if (actions instanceof Set && actions.has(action)) return true;
      if (Array.isArray(actions) && actions.includes(action)) return true;
      if (actions && actions[action] === true) return true;
    }
    return false;
  }

  _handleNavigation(context) {
    if (this.phase !== 'review') return;
    const previous = this._actionPressed(context, 'left') || this._actionPressed(context, 'previous');
    const next = this._actionPressed(context, 'right') || this._actionPressed(context, 'next');
    if (previous) this.selectedAction = (this.selectedAction - 1 + ACTIONS.length) % ACTIONS.length;
    if (next) this.selectedAction = (this.selectedAction + 1) % ACTIONS.length;
  }

  _handlePointer(inputManager, viewWidth, viewHeight) {
    if (!inputManager?.isMouseClicked?.() || inputManager.isMouseClickHandled?.()) return;
    const point = inputManager.getMousePosition?.() || { x: -1, y: -1 };
    inputManager.markMouseClickHandled?.();
    if (this.phase !== 'review') {
      this._advance();
      return;
    }
    const buttonIndex = this._layout(viewWidth, viewHeight).buttons.findIndex(button => (
      point.x >= button.x && point.x <= button.x + button.width
      && point.y >= button.y && point.y <= button.y + button.height
    ));
    if (buttonIndex >= 0) {
      this.selectedAction = buttonIndex;
      this._confirm();
    }
  }

  _consumePointer(inputManager) {
    if (inputManager?.isMouseClicked?.() && !inputManager.isMouseClickHandled?.()) {
      inputManager.markMouseClickHandled?.();
    }
  }

  _layout(viewWidth, viewHeight) {
    const margin = Math.max(16, Math.min(viewWidth, viewHeight) * 0.04);
    const contentWidth = Math.min(960, viewWidth - margin * 2);
    const contentX = (viewWidth - contentWidth) / 2;
    const gap = Math.max(8, Math.min(18, contentWidth * 0.018));
    const buttonWidth = (contentWidth - gap * 2) / 3;
    const buttonHeight = Math.max(38, Math.min(54, viewHeight * 0.075));
    const buttonY = viewHeight - margin - buttonHeight - 30;
    const buttons = ACTIONS.map((action, index) => ({
      ...action,
      x: contentX + index * (buttonWidth + gap),
      y: buttonY,
      width: buttonWidth,
      height: buttonHeight
    }));
    return { viewWidth, viewHeight, margin, contentX, contentWidth, buttonY, buttons };
  }

  _renderArtwork(ctx, width, height) {
    const shot = this.phase === 'shot' ? this.ending?.shots?.[this.shotIndex] : null;
    const candidates = [
      shot?.imageId,
      shot?.keyArtImageId,
      shot?.cameraImageId,
      shot?.cameraId,
      this.ending?.keyArtImageId
    ].filter((imageId, index, values) => imageId && values.indexOf(imageId) === index);
    let image = null;
    let size = null;
    for (const imageId of candidates) {
      const candidate = this._resolveImage(imageId);
      const candidateSize = this._imageSize(candidate);
      if (candidate && candidateSize) {
        image = candidate;
        size = candidateSize;
        break;
      }
    }
    if (!image || !size) return;
    const scale = Math.max(width / size.width, height / size.height);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (size.width - sourceWidth) / 2;
    const sourceY = (size.height - sourceHeight) / 2;
    try {
      ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    } catch (_) {
      // 图片尚未可绘制时保留纯标题/字幕，不绘制程序占位图。
    }
  }

  _resolveImage(imageId) {
    if (this.imageCache.has(imageId)) return this.imageCache.get(imageId);
    let image = null;
    try {
      image = this.resolveImage(imageId) || null;
    } catch (_) {
      image = null;
    }
    if (image) this.imageCache.set(imageId, image);
    return image;
  }

  _imageSize(image) {
    if (!image) return null;
    if ('complete' in image && image.complete === false) return null;
    const width = Number(image.naturalWidth || image.videoWidth || image.width);
    const height = Number(image.naturalHeight || image.videoHeight || image.height);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  _renderShade(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0,0,0,0.34)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.18)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.86)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  _renderTitle(ctx, layout) {
    const title = this.ending.title || this.ending.id || '终局';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f1d58a';
    ctx.font = `bold ${Math.max(26, Math.min(48, layout.viewWidth * 0.038))}px serif`;
    this._drawWrappedText(ctx, title, layout.viewWidth / 2, layout.viewHeight * 0.48, layout.contentWidth, 1.3);
  }

  _renderShot(ctx, layout) {
    const shot = this.ending.shots?.[this.shotIndex] || {};
    if (shot.title) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#f1d58a';
      ctx.font = `bold ${Math.max(18, Math.min(30, layout.viewWidth * 0.025))}px serif`;
      ctx.fillText(String(shot.title), layout.viewWidth / 2, layout.margin);
    }
    const subtitle = shot.subtitle || '';
    const fontSize = Math.max(16, Math.min(25, layout.viewWidth * 0.021));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#f5f1e7';
    ctx.font = `${fontSize}px sans-serif`;
    this._drawWrappedText(
      ctx,
      subtitle,
      layout.viewWidth / 2,
      layout.viewHeight - layout.margin - 78,
      layout.contentWidth,
      1.55,
      'bottom'
    );
    this._renderProgress(ctx, layout);
  }

  _renderProgress(ctx, layout) {
    const count = this.ending.shots?.length || 0;
    if (!count) return;
    const gap = 15;
    const startX = layout.viewWidth / 2 - ((count - 1) * gap) / 2;
    ctx.lineWidth = 1;
    for (let index = 0; index < count; index += 1) {
      ctx.beginPath();
      ctx.arc(startX + index * gap, layout.viewHeight - layout.margin - 28, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = index === this.shotIndex ? '#f1d58a' : 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
  }

  _renderReview(ctx, layout) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f1d58a';
    ctx.font = `bold ${Math.max(22, Math.min(36, layout.viewWidth * 0.03))}px serif`;
    ctx.fillText('选择回顾', layout.viewWidth / 2, layout.margin);
    ctx.fillStyle = '#f5f1e7';
    ctx.font = `bold ${Math.max(15, Math.min(22, layout.viewWidth * 0.018))}px sans-serif`;
    ctx.fillText(this.ending.title || this.ending.id || '终局', layout.viewWidth / 2, layout.margin + 48);

    const fontSize = Math.max(13, Math.min(18, layout.viewWidth * 0.014));
    const lineHeight = fontSize * 1.55;
    const availableHeight = Math.max(0, layout.buttonY - (layout.margin + 96) - 16);
    const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    const lines = this.reviewLines.slice(0, maxLines);
    ctx.fillStyle = '#e7e2d5';
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    lines.forEach((line, index) => {
      const text = this._reviewText(line);
      ctx.fillText(`• ${text}`, layout.contentX, layout.margin + 96 + index * lineHeight);
    });
    if (this.reviewLines.length > lines.length && lines.length) {
      ctx.fillText('…', layout.contentX, layout.margin + 96 + (lines.length - 1) * lineHeight);
    }
    layout.buttons.forEach((button, index) => this._renderActionButton(ctx, button, index));
  }

  _reviewText(line) {
    if (typeof line === 'string' || typeof line === 'number') return String(line);
    if (!line || typeof line !== 'object') return '';
    if (line.text != null) return String(line.text);
    if (line.label != null && line.value != null) return `${line.label}：${line.value}`;
    return String(line.label || line.value || '');
  }

  _renderActionButton(ctx, button, index) {
    const selected = index === this.selectedAction;
    ctx.fillStyle = selected ? 'rgba(177,139,60,0.82)' : 'rgba(22,24,28,0.86)';
    ctx.strokeStyle = selected ? '#f1d58a' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(button.x, button.y, button.width, button.height, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(11, Math.min(15, button.width * 0.055))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2);
  }

  _renderHints(ctx, layout) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `${Math.max(11, Math.min(14, layout.viewWidth * 0.012))}px sans-serif`;
    // 页面失焦时键盘/手柄事件不会到达页面（RAF 也被节流）——必须明确告知，否则表现为「全部按钮失效」。
    const windowBlurred = typeof document !== 'undefined'
      && typeof document.hasFocus === 'function'
      && document.hasFocus() === false;
    if (windowBlurred) {
      ctx.fillStyle = '#f1d58a';
      ctx.fillText('窗口已失焦——键盘与手柄输入无效，请点击游戏画面后再操作。', layout.viewWidth / 2, layout.viewHeight - 7);
      return;
    }
    ctx.fillStyle = this.busy ? '#f1d58a' : 'rgba(255,255,255,0.78)';
    let text = '正在处理……';
    if (!this.busy) {
      const cancel = `${InputHints.phrase('modalCancel')}关闭`;
      if (this.phase === 'review') {
        text = `${InputHints.phrase('confirm')}确认 · ${cancel}`;
      } else {
        const skipAction = this._hasHintAction('skip') ? 'skip' : 'dialogueContinue';
        text = `${InputHints.phrase('confirm')}继续 · ${InputHints.phrase(skipAction)}跳过演出 · ${cancel}`;
      }
    }
    ctx.fillText(text, layout.viewWidth / 2, layout.viewHeight - 7);
  }

  _hasHintAction(action) {
    const actions = typeof InputHints.getActions === 'function' ? InputHints.getActions() : {};
    return Object.prototype.hasOwnProperty.call(actions, action);
  }

  _drawWrappedText(ctx, text, x, y, maxWidth, lineScale = 1.4, anchor = 'middle') {
    const characters = Array.from(String(text || ''));
    const lines = [];
    let current = '';
    characters.forEach(character => {
      const candidate = current + character;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    });
    if (current || lines.length === 0) lines.push(current);
    const fontSize = Number.parseFloat(ctx.font) || 16;
    const lineHeight = fontSize * lineScale;
    const startY = anchor === 'bottom' ? y - (lines.length - 1) * lineHeight : y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => ctx.fillText(line, x, startY + index * lineHeight));
  }
}

export default EndingPresentationView;

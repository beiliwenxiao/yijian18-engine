import { InputHints } from '../core/input/InputHints.js';

const VIDEO_EXT_RE = /\.(mp4|webm|ogv|ogg|mov|m4v)(\?.*)?$/i;
const DEFAULT_FADE_MS = 300;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * 全景 / 过场播放层（全屏覆盖，独立于场景实体）。
 *
 * 设计要点：
 * - 屏幕空间覆盖层：不参与 Y-sort / 碰撞 / 地形 / 存档，关闭即淡出回原场景；
 * - 图片与视频共用一条绘制链（视频用 HTMLVideoElement + drawImage，不插入 DOM）；
 * - 由触发器动作 `panorama.command` 驱动，`show()` 返回的 Promise 在播放结束/跳过时结算，
 *   任务步骤与触发器可据此串行等待。
 */
export class PanoramaOverlay {
  constructor({
    width = 1280,
    height = 720,
    assetManager = null,
    fadeMs = DEFAULT_FADE_MS,
    loadAsset = null
  } = {}) {
    this.width = width;
    this.height = height;
    this.assetManager = assetManager;
    this.defaultFadeMs = positiveNumber(fadeMs, DEFAULT_FADE_MS);
    this.loadAsset = typeof loadAsset === 'function' ? loadAsset : null;

    this.state = 'idle';
    this.alpha = 0;
    this.config = null;
    this.media = null;
    this.mediaKind = 'image';
    this.elapsed = 0;
    this.panOffset = 0.5;
    this._overflowX = 0;
    this._fadeMs = this.defaultFadeMs;
    this._token = 0;
    this._resolve = null;
    this._promise = null;
    this._closeReason = 'closed';
    this._video = null;
    this._videoEndedHandler = null;
    this._dragging = false;
    this._dragMoved = 0;
    this._lastPointerX = 0;
  }

  get visible() {
    return this.state !== 'idle';
  }

  /** 播放全景/过场；返回 Promise，在结束、跳过或加载失败时结算。 */
  show(config = {}) {
    // 覆盖式重入：旧演出立即结算为 replaced，避免任务步骤悬空等待。
    this._settle('replaced');

    const cfg = this._normalizeConfig(config);
    this._promise = new Promise(resolve => { this._resolve = resolve; });
    if (!cfg.assetId && !cfg.path && !cfg.image && !cfg.video) {
      this._resolve?.({ ok: false, reason: 'noAsset' });
      this._reset();
      return this._promise;
    }

    this.config = cfg;
    this.mediaKind = cfg.kind;
    this._fadeMs = cfg.fadeMs;
    this.state = 'loading';
    this.alpha = 0;
    this.elapsed = 0;
    this.panOffset = 0.5;
    this._dragMoved = 0;
    this._dragging = false;
    const token = ++this._token;
    this._loadMedia(cfg, token);
    return this._promise;
  }

  /** 关闭当前播放（默认淡出）；immediate=true 时立即结算。 */
  hide(reason = 'closed', { immediate = false } = {}) {
    if (!this.visible) return;
    if (immediate) {
      this._settle(reason);
      return;
    }
    this._startClose(reason);
  }

  update(deltaMs) {
    if (!this.visible) return;
    const dt = Math.max(0, Number(deltaMs) || 0);
    if (this.state === 'loading' || this.state === 'playing') {
      this.alpha = Math.min(1, this.alpha + dt / this._fadeMs);
      if (this.state === 'playing') {
        this.elapsed += dt;
        const durationMs = this.config?.durationMs || 0;
        if (durationMs > 0 && this.elapsed >= durationMs) this._startClose('timeout');
        if (this.config?.autoPan) this._panByPixels(this.config.autoPan * dt / 1000);
        const video = this._video;
        if (this.mediaKind === 'video' && video?.ended && this.config?.loop !== true) {
          this._startClose('ended');
        }
      }
      return;
    }
    if (this.state === 'closing') {
      this.alpha -= dt / this._fadeMs;
      if (this.alpha <= 0) this._settle(this._closeReason);
    }
  }

  /** 返回 true 表示输入已被覆盖层消费（阻断下层 HUD / 场景交互）。 */
  handleInput(context = {}) {
    if (!this.visible) return false;
    const inputManager = context.inputManager;

    // 拖动查看：仅图片启用；按位移累计，避免拖动被误判为“点击跳过”。
    if (this.config?.pan !== false && this.mediaKind === 'image' && inputManager) {
      const point = inputManager.getMousePosition?.() || null;
      const down = inputManager.isMouseDown?.() === true;
      if (point && down) {
        if (!this._dragging) {
          this._dragging = true;
          this._dragMoved = 0;
          this._lastPointerX = point.x;
        } else {
          const deltaX = point.x - this._lastPointerX;
          this._lastPointerX = point.x;
          this._dragMoved += Math.abs(deltaX);
          this._panByPixels(deltaX);
        }
      } else if (!down) {
        this._dragging = false;
      }
    }

    if (this.config?.skippable !== false) {
      const skip = this._actionPressed(context, 'skip')
        || this._actionPressed(context, 'confirm')
        || this._actionPressed(context, 'dialogueContinue')
        || this._actionPressed(context, 'modalCancel');
      if (skip) this._startClose('skipped');
    }

    if (inputManager?.isMouseClicked?.() && !inputManager.isMouseClickHandled?.()) {
      inputManager.markMouseClickHandled?.();
      if (this.config?.skippable !== false && this._dragMoved < 8) this._startClose('skipped');
    }
    return true;
  }

  render(ctx, viewWidth = this.width, viewHeight = this.height) {
    if (!this.visible || !ctx) return;
    const width = Math.max(1, Number(viewWidth) || this.width);
    const height = Math.max(1, Number(viewHeight) || this.height);

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    if (this.state === 'loading') {
      ctx.globalAlpha = this.alpha * 0.8;
      ctx.fillStyle = 'rgba(235,235,235,0.85)';
      ctx.font = `${Math.max(14, Math.round(height * 0.026))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('加载中…', width / 2, height / 2);
    } else {
      this._renderMedia(ctx, width, height);
      this._renderVignette(ctx, width, height);
    }

    this._renderHints(ctx, width, height);
    ctx.restore();
  }

  dispose() {
    this._settle('disposed');
  }

  _normalizeConfig(config) {
    const assetId = typeof config.assetId === 'string' && config.assetId.trim()
      ? config.assetId.trim()
      : null;
    const path = typeof config.path === 'string' && config.path.trim() ? config.path.trim() : null;
    let kind = config.kind || 'auto';
    if (kind === 'auto') {
      const manifestMode = assetId
        ? this.assetManager?.getManifestEntry?.(assetId)?.runtime2D?.mode
        : null;
      if (manifestMode === 'video') kind = 'video';
      else if (config.video) kind = 'video';
      else if (config.image) kind = 'image';
      else if (path && VIDEO_EXT_RE.test(path)) kind = 'video';
      else if (assetId && VIDEO_EXT_RE.test(assetId)) kind = 'video';
      else kind = 'image';
    }
    return {
      assetId,
      path,
      kind: kind === 'video' ? 'video' : 'image',
      image: config.image || null,
      video: config.video || null,
      durationMs: Math.max(0, Number(config.durationMs) || 0),
      loop: config.loop === true,
      skippable: config.skippable !== false,
      pan: config.pan !== false,
      autoPan: Number(config.autoPan) || 0,
      muted: config.muted !== false,
      volume: clamp(Number.isFinite(Number(config.volume)) ? Number(config.volume) : 1, 0, 1),
      fadeMs: positiveNumber(config.fadeMs, this.defaultFadeMs)
    };
  }

  async _loadMedia(cfg, token) {
    let media = cfg.video || cfg.image || null;
    try {
      if (!media && this.assetManager) {
        if (cfg.path) {
          const url = typeof this.assetManager.resolveAssetPath === 'function'
            ? this.assetManager.resolveAssetPath(cfg.path)
            : cfg.path;
          media = cfg.kind === 'video'
            ? await this.assetManager.loadVideo(cfg.path, url)
            : await this.assetManager.loadImage(cfg.path, url);
        } else {
          media = await this.assetManager.loadAsset(cfg.assetId);
        }
      } else if (!media && this.loadAsset) {
        media = await this.loadAsset(cfg);
      }
    } catch (error) {
      console.warn('PanoramaOverlay: 全景资源加载失败', error?.message || error);
      media = null;
    }
    if (token !== this._token) return;
    if (!media) {
      this._settle('loadFailed');
      return;
    }

    this.media = media;
    if (cfg.kind === 'video') this._prepareVideo(media, cfg);
    this.state = 'playing';
    this.elapsed = 0;
  }

  _prepareVideo(video, cfg) {
    this._video = video;
    try {
      video.loop = cfg.loop;
      video.muted = cfg.muted;
      video.volume = cfg.volume;
      video.currentTime = 0;
    } catch { /* 部分容器不支持 seek，忽略 */ }
    if (this._videoEndedHandler) {
      video.removeEventListener?.('ended', this._videoEndedHandler);
    }
    this._videoEndedHandler = () => {
      if (this.state === 'playing' && this.config?.loop !== true) this._startClose('ended');
    };
    video.addEventListener?.('ended', this._videoEndedHandler);
    const playPromise = video.play?.();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        // 浏览器自动播放策略：先降级静音重试一次，仍失败则结束演出。
        if (!video.muted) {
          video.muted = true;
          video.play?.().catch(() => this._settle('loadFailed'));
        } else {
          this._settle('loadFailed');
        }
      });
    }
  }

  _renderMedia(ctx, width, height) {
    const media = this.media;
    if (!media) return;
    const sourceWidth = media.videoWidth || media.naturalWidth || media.width || 0;
    const sourceHeight = media.videoHeight || media.naturalHeight || media.height || 0;
    if (!sourceWidth || !sourceHeight) return;
    // 视频首帧尚未解码时跳过绘制，保持黑底，避免 drawImage 抛错。
    if (this.mediaKind === 'video' && media.readyState !== undefined && media.readyState < 2) return;

    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const overflowX = Math.max(0, drawWidth - width);
    this._overflowX = overflowX;
    const shift = (0.5 - this.panOffset) * overflowX;
    const x = (width - drawWidth) / 2 + shift;
    const y = (height - drawHeight) / 2;
    try {
      ctx.drawImage(media, x, y, drawWidth, drawHeight);
    } catch (error) {
      console.warn('PanoramaOverlay: 全景绘制失败', error?.message || error);
    }
  }

  _renderVignette(ctx, width, height) {
    const inner = Math.min(width, height) * 0.35;
    const outer = Math.max(width, height) * 0.78;
    if (outer <= inner) return;
    const gradient = ctx.createRadialGradient(width / 2, height / 2, inner, width / 2, height / 2, outer);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  _renderHints(ctx, width, height) {
    if (this.config?.skippable === false && this.config?.pan === false) return;
    const pieces = [];
    if (this.config?.pan !== false && this.mediaKind === 'image') pieces.push('拖动查看');
    if (this.config?.skippable !== false) {
      const actions = typeof InputHints.getActions === 'function' ? InputHints.getActions() : {};
      const skipAction = actions?.skip ? 'skip' : 'dialogueContinue';
      pieces.push(`${InputHints.phrase(skipAction)}跳过`);
    }
    if (pieces.length === 0) return;
    const fontSize = Math.max(12, Math.round(height * 0.021));
    ctx.globalAlpha = this.alpha * 0.78;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(pieces.join(' · '), width - fontSize * 0.9 + 1, height - fontSize * 0.9 + 1);
    ctx.fillStyle = 'rgba(240,240,240,0.92)';
    ctx.fillText(pieces.join(' · '), width - fontSize * 0.9, height - fontSize * 0.9);
  }

  _panByPixels(deltaPx) {
    const overflow = this._overflowX;
    if (!overflow || !Number.isFinite(deltaPx) || deltaPx === 0) return;
    this.panOffset = clamp(this.panOffset - deltaPx / overflow, 0, 1);
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

  _startClose(reason) {
    if (this.state === 'closing' || this.state === 'idle') return;
    this._closeReason = reason;
    this.state = 'closing';
  }

  _settle(reason) {
    const resolve = this._resolve;
    this._resolve = null;
    const ok = reason !== 'loadFailed' && reason !== 'noAsset';
    this._reset();
    resolve?.({ ok, reason });
  }

  _reset() {
    this._token += 1;
    if (this._video && this._videoEndedHandler) {
      this._video.removeEventListener?.('ended', this._videoEndedHandler);
    }
    if (this._video) {
      try { this._video.pause(); } catch { /* ignore */ }
    }
    this._video = null;
    this._videoEndedHandler = null;
    this.media = null;
    this.config = null;
    this.state = 'idle';
    this.alpha = 0;
    this.elapsed = 0;
    this.panOffset = 0.5;
    this._overflowX = 0;
    this._dragging = false;
    this._dragMoved = 0;
    this._closeReason = 'closed';
  }
}

export default PanoramaOverlay;

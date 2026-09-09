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

const COMPLETION_DURATION_SECONDS = 0.65;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function getDrawableSize(image, fallbackWidth, fallbackHeight) {
  const width = Number(image?.naturalWidth || image?.width) || fallbackWidth;
  const height = Number(image?.naturalHeight || image?.height) || fallbackHeight;
  return { width, height };
}

/**
 * 短时世界动作的纯表现层。
 * 只消费已开始/推进/完成/中断事件和稳定资源 ID，不拥有动作计时、库存或领域状态。
 */
export class WorldActionPresentation {
  constructor({ assetManager = null, completionDuration = COMPLETION_DURATION_SECONDS } = {}) {
    this.assetManager = assetManager;
    this.completionDuration = Math.max(0.1, Number(completionDuration) || COMPLETION_DURATION_SECONDS);
    this.active = null;
    this.completion = null;
    this._requestedAssets = new Set();
  }

  handleEvent(event, data = {}, owner = 'worldAction') {
    const normalizedOwner = String(owner || 'worldAction');
    if (event === 'started') {
      const anchorEntity = data.anchorEntity || null;
      if (!anchorEntity || !data.inputImageId) return false;
      this.active = {
        owner: normalizedOwner,
        anchorEntity,
        progress: 0,
        inputImageId: data.inputImageId,
        outputImageId: data.outputImageId || null,
        kind: data.kind || 'crafting',
        inputSize: { ...data.inputSize },
        outputSize: { ...data.outputSize }
      };
      this.completion = null;
      this._requestImage(this.active.inputImageId);
      this._requestImage(this.active.outputImageId);
      return true;
    }
    if (event === 'progress') {
      if (this.active?.owner !== normalizedOwner) return false;
      this.active.progress = clamp01(data.progress);
      return true;
    }
    if (event === 'completed') {
      if (this.active?.owner !== normalizedOwner) return false;
      const completed = this.active;
      this.active = null;
      if (!completed.outputImageId) return true;
      this.completion = { ...completed, elapsed: 0 };
      this._requestImage(completed.outputImageId);
      return true;
    }
    if (event === 'interrupted' && this.active?.owner === normalizedOwner) {
      this.active = null;
      return true;
    }
    return false;
  }

  update(deltaTime) {
    if (!this.completion) return false;
    this.completion.elapsed += Math.max(0, Number(deltaTime) || 0);
    if (this.completion.elapsed < this.completionDuration) return true;
    this.completion = null;
    return true;
  }

  render(ctx) {
    const activeRendered = this.active ? this._renderActive(ctx, this.active) : false;
    const completionRendered = this.completion ? this._renderCompletion(ctx, this.completion) : false;
    return activeRendered || completionRendered;
  }

  _renderActive(ctx, action) {
    const position = action.anchorEntity?.getComponent?.('transform')?.position;
    if (!position) return false;
    const sprite = action.anchorEntity?.getComponent?.('sprite') || {};
    const rackHeight = Math.max(32, Number(sprite.height) || 64);
    const progress = clamp01(action.progress);
    const oscillation = Math.sin(progress * Math.PI * 8);
    const y = position.y - rackHeight - 8 - oscillation * (action.kind === 'cooking' ? 4 : 2);
    const rotation = action.kind === 'cooking' ? oscillation * 0.1 : oscillation * 0.035;
    const scale = action.kind === 'tanning' ? 0.94 + Math.abs(oscillation) * 0.1 : 1;
    return this._drawAsset(ctx, action.inputImageId, position.x, y, action.inputSize, {
      alpha: 0.9,
      rotation,
      scale,
      bottomCenter: true
    });
  }

  _renderCompletion(ctx, action) {
    const position = action.anchorEntity?.getComponent?.('transform')?.position;
    if (!position) return false;
    const sprite = action.anchorEntity?.getComponent?.('sprite') || {};
    const rackHeight = Math.max(32, Number(sprite.height) || 64);
    const phase = clamp01(action.elapsed / this.completionDuration);
    const rise = phase * 24;
    const scale = 0.82 + Math.sin(Math.min(1, phase * 2) * Math.PI / 2) * 0.34;
    return this._drawAsset(ctx, action.outputImageId, position.x, position.y - rackHeight - 14 - rise, action.outputSize, {
      alpha: 1 - phase * 0.35,
      scale,
      bottomCenter: false
    });
  }

  _drawAsset(ctx, stableId, x, y, requestedSize = {}, { alpha = 1, rotation = 0, scale = 1, bottomCenter = false } = {}) {
    const image = this._getImage(stableId);
    if (!image) return false;
    const size = getDrawableSize(image, Number(requestedSize.width) || 40, Number(requestedSize.height) || 40);
    const width = Math.max(1, Number(requestedSize.width) || size.width) * scale;
    const height = Math.max(1, Number(requestedSize.height) || size.height) * scale;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.drawImage(image, -width / 2, bottomCenter ? -height : -height / 2, width, height);
    ctx.restore();
    return true;
  }

  _getImage(stableId) {
    if (!stableId || !this.assetManager) return null;
    const resolved = this.assetManager.resolveManifestAsset?.(stableId, '2d') || null;
    const key = resolved?.key || stableId;
    const image = this.assetManager.getAsset?.(key) || null;
    if (!image || image.complete === false) return null;
    return image;
  }

  _requestImage(stableId) {
    if (!stableId || this._requestedAssets.has(stableId) || !this.assetManager?.loadImage) return;
    this._requestedAssets.add(stableId);
    const resolved = this.assetManager.resolveManifestAsset?.(stableId, '2d') || null;
    const key = resolved?.key || stableId;
    const url = resolved?.url || null;
    if (!url || this.assetManager.getAsset?.(key)) return;
    Promise.resolve(this.assetManager.loadImage(key, url)).catch(() => {
      this._requestedAssets.delete(stableId);
    });
  }

  dispose() {
    this.active = null;
    this.completion = null;
    this._requestedAssets.clear();
  }
}

export default WorldActionPresentation;

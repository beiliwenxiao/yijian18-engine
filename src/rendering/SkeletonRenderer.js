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

/**
 * SkeletonRenderer.js - 骨骼动画 Canvas 2D 渲染器
 *
 * 由 EntityRenderer2D._renderSprite 在 sprite.isSkeleton 时委托调用：
 *   - 根骨骼原点对齐底部中心锚点（与普通精灵一致，x=中心，y=脚底）
 *   - 设计尺寸 meta.height 映射到实体 height（等比缩放）
 *   - 槽位按 z 升序绘制；附件类型：image（整图）/ slice（图集源矩形）/
 *     sequence（序列帧当前帧，帧游标由 SkeletonComponent 推进）
 *   - flipX 通过整体 x 镜像实现；透明度遵循调用方 ctx.globalAlpha
 */

import { SKELETON_ATTACHMENT_TYPES } from '../animation/SkeletonAsset.js';

const DEG2RAD = Math.PI / 180;

export class SkeletonRenderer {
  /**
   * @param {Object} [options]
   * @param {(atlasId: string, sliceKey: string) => {image: HTMLImageElement, sx:number, sy:number, sw:number, sh:number}|null} [options.resolveAtlasSlice]
   *        可选：slot attachment slice 走共享图集注册表解析（未注入则用 attachment 内联源矩形）
   */
  constructor(options = {}) {
    this.resolveAtlasSlice = typeof options.resolveAtlasSlice === 'function'
      ? options.resolveAtlasSlice
      : null;
  }

  /**
   * 渲染骨骼实体。
   * @returns {boolean} 是否接管了渲染（资产未加载返回 false，调用方可走兜底）
   */
  render(ctx, { assetManager = null, skeletonComponent = null, sprite = null, x = 0, y = 0, width = 32, height = 32 }) {
    if (!ctx || !skeletonComponent || !skeletonComponent.skeletonId) return false;
    const asset = skeletonComponent.skeletonAsset
      || assetManager?.getSkeletonAsset?.(skeletonComponent.skeletonId)
      || null;
    if (!asset) return false; // JSON 尚在加载：交由调用方兜底
    if (skeletonComponent.skeletonAsset !== asset) skeletonComponent.setSkeletonAsset(asset);

    const worldPose = skeletonComponent.getWorldPose();
    if (!worldPose) return false;

    // 设计尺寸 → 实体尺寸：等比，以高度为基准（骨骼根原点=脚底中心）
    const designHeight = asset.meta?.height > 0 ? asset.meta.height : 0;
    const scale = designHeight > 0 ? height / designHeight : 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sprite?.flipX ? -scale : scale, scale);

    let drewAny = false;
    for (const slot of asset.slots) {
      const attachment = slot.attachment;
      // visible === false：运行时按状态切换显示的部件（如头部三态），渲染跳过
      if (!attachment || attachment.type === 'empty' || attachment.visible === false) continue;
      const boneWorld = worldPose.get(slot.bone);
      if (!boneWorld) continue;

      const source = this._resolveAttachmentSource(attachment, assetManager, skeletonComponent, slot);
      if (!source) continue;

      ctx.save();
      ctx.translate(boneWorld.x, boneWorld.y);
      ctx.rotate(boneWorld.rad);
      ctx.scale(boneWorld.sx, boneWorld.sy);
      ctx.translate(attachment.x, attachment.y);
      ctx.rotate((attachment.rot || 0) * DEG2RAD);
      if (attachment.flipX) ctx.scale(-1, 1);   // 附件水平镜像（背面长矛等视角切换）

      const drawW = attachment.width > 0 ? attachment.width : source.sw;
      const drawH = attachment.height > 0 ? attachment.height : source.sh;
      if (source.image && source.sw > 0 && source.sh > 0 && drawW > 0 && drawH > 0) {
        // 附件盒以骨骼点为中心（脚底类附件可用 attachment.y 下移）
        ctx.drawImage(source.image, source.sx, source.sy, source.sw, source.sh,
          -drawW / 2, -drawH / 2, drawW, drawH);
        drewAny = true;
      }
      ctx.restore();
    }
    ctx.restore();
    return drewAny || asset.slots.length > 0;
  }

  /** 解析附件的绘制源：统一返回 { image, sx, sy, sw, sh } 或 null。 */
  _resolveAttachmentSource(attachment, assetManager, skeletonComponent, slot) {
    if (!attachment || !SKELETON_ATTACHMENT_TYPES.includes(attachment.type)) return null;
    if (attachment.type === 'image') {
      const image = assetManager?.getImage?.(attachment.assetId) || null;
      return image
        ? { image, sx: 0, sy: 0, sw: image.naturalWidth || image.width, sh: image.naturalHeight || image.height }
        : null;
    }
    if (attachment.type === 'slice') {
      // 优先内联源矩形（编辑器从图集切片写入）；可选注入共享图集注册表解析
      if (attachment.sw > 0 && attachment.sh > 0) {
        const image = assetManager?.getImage?.(attachment.assetId) || null;
        return image ? { image, sx: attachment.sx, sy: attachment.sy, sw: attachment.sw, sh: attachment.sh } : null;
      }
      const resolved = this.resolveAtlasSlice?.(attachment.assetId, attachment.sliceKey);
      return resolved || null;
    }
    if (attachment.type === 'sequence') {
      const frames = Array.isArray(attachment.frames) ? attachment.frames : [];
      if (frames.length === 0) return null;
      const frame = frames[skeletonComponent.getSlotFrame(slot.id) % frames.length];
      const image = assetManager?.getImage?.(attachment.assetId || attachment.spriteSheet) || null;
      if (!image || !frame || !(frame.sw > 0) || !(frame.sh > 0)) return null;
      return { image, sx: frame.sx, sy: frame.sy, sw: frame.sw, sh: frame.sh };
    }
    return null;
  }
}

export default SkeletonRenderer;

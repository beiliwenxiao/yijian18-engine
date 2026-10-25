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
 *   - slot.follow='noScale'（默认）时挂图不跟随骨骼缩放；'bone' 时完全跟随
 *   - flipX 通过整体 x 镜像实现；透明度遵循调用方 ctx.globalAlpha
 */

import { SKELETON_ATTACHMENT_TYPES, resolveAttachmentOffset } from '../animation/SkeletonAsset.js';
import { resolveAttachmentFormKey } from '../animation/SkeletonDirection.js';
import { applyTransformConstraints } from '../animation/SkeletonConstraint.js';

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
    // 骨骼资产（整帧/部件）都是像素画：关闭插值，缩放到实体尺寸时保持硬边像素，
    // 否则缩放后会被双线性平滑糊成一片（与 EntityRenderer2D 的精灵绘制一致）。
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    ctx.scale(sprite?.flipX ? -scale : scale, scale);

    let drewAny = false;
    // 第一遍：计算所有槽位的锚点（世界坐标 + 朝向）与绘制素材
    // 两遍是为了支持 transform 约束（挂件跟随挂件）：跟随者要先拿到目标的锚点。
    const anchors = [];
    for (const slot of asset.slots) {
      // 附件 = 共享资产 attachment + 实体本地覆盖（头部三态可见性、武器上手/背挂、
      // 背挂换边、方向帧表）。共享资产全局唯一且只读——运行时状态一律走覆盖层，
      // 否则同骨架的多个实体会互相改写对方的可见性/翻转。
      const attachment = skeletonComponent.resolveSlotAttachment?.(slot) || slot.attachment;
      // visible === false：运行时按状态切换显示的部件（如头部三态），渲染跳过
      if (!attachment || attachment.type === 'empty' || attachment.visible === false) continue;
      const boneWorld = worldPose.get(slot.bone);
      if (!boneWorld) continue;

      // 方向性附件偏移（背挂武器等按朝向摆位）：side/up/斜向覆盖缺省时逐字段回退顶层值。
      // offset.assetId/width/height：按方向整体换部件图（形态：正面/侧面/背面/斜前/斜后），
      // 换图时绘制盒以 offset 声明为准，未声明沿用顶层附件盒。
      // 附件形态键：left 走独立 sideL（配了左侧美术的资产可完全免镜像）；
      // 未配 sideL 的老资产逐字段回退到 side（行为不变）。
      const formKey = resolveAttachmentFormKey(sprite?.direction);
      let directionOverride = resolveAttachmentOffset(attachment, formKey);
      if (!directionOverride && formKey === 'sideL') directionOverride = resolveAttachmentOffset(attachment, 'side');
      const hasFormOverride = !!directionOverride
        && (!!directionOverride.assetId || directionOverride.width > 0 || directionOverride.height > 0
          || directionOverride.sw > 0);
      const effectiveAttachment = hasFormOverride
        ? {
          ...attachment,
          ...(directionOverride.assetId ? { assetId: directionOverride.assetId } : {}),
          ...(directionOverride.width > 0 ? { width: directionOverride.width } : {}),
          ...(directionOverride.height > 0 ? { height: directionOverride.height } : {}),
          // 图集切片形态：directionOffsets 可按形态换源矩形（同一张图集里存 正/侧/背 三套部件）
          ...(directionOverride.sw > 0 ? {
            sx: directionOverride.sx || 0, sy: directionOverride.sy || 0,
            sw: directionOverride.sw, sh: directionOverride.sh
          } : {})
        }
        : attachment;

      const source = this._resolveAttachmentSource(effectiveAttachment, assetManager, skeletonComponent, slot);
      if (!source) continue;

      const anchor = this._attachmentAnchor(boneWorld, effectiveAttachment, directionOverride, slot.follow);
      anchors.push({
        slot,
        attachment: effectiveAttachment,
        directionOverride,
        source,
        boneWorld,
        x: anchor.x,
        y: anchor.y,
        angle: anchor.angle
      });
    }

    // transform 约束：挂件跟随挂件（位置 + 可选朝向）
    applyTransformConstraints(anchors, asset.constraints);

    // 第二遍：绘制
    for (const entry of anchors) {
      const { attachment, source, boneWorld } = entry;
      const drawW = attachment.width > 0 ? attachment.width : source.sw;
      const drawH = attachment.height > 0 ? attachment.height : source.sh;
      if (!(source.image && source.sw > 0 && source.sh > 0 && drawW > 0 && drawH > 0)) continue;
      ctx.save();
      // 锚点已含挂点偏移与朝向偏移（见 _attachmentAnchor），此处不再重复施加
      ctx.translate(entry.x, entry.y);
      ctx.rotate(entry.angle);
      // 跟随模式 noScale（默认）：挂图只跟随骨骼的位置与旋转，不跟随缩放——
      // 拖骨骼缩放只改变肢体骨架尺寸，绑定图片保持原大小不变形（Unity 骨骼=变形、贴图独立）。
      // follow='bone' 时挂图完全跟随骨骼变换（用于 squash & stretch 压扁拉伸）。
      if (entry.slot.follow === 'bone') ctx.scale(boneWorld.sx, boneWorld.sy);
      if ((entry.directionOverride?.flipX ?? attachment.flipX) === true) ctx.scale(-1, 1);   // 附件水平镜像（背面长矛等视角切换）

      // 附件盒以锚点为中心（脚底类附件可用 attachment.y 下移）
      ctx.drawImage(source.image, source.sx, source.sy, source.sw, source.sh,
        -drawW / 2, -drawH / 2, drawW, drawH);
      drewAny = true;
      ctx.restore();
    }
    ctx.restore();
    return drewAny || asset.slots.length > 0;
  }

  /**
   * 附件锚点（世界坐标 + 朝向）。
   * @param {Object} boneWorld - 骨骼世界变换
   * @param {Object} attachment - 有效附件
   * @param {Object|null} directionOverride - 方向形态覆盖
   * @param {string} [follow] - 挂件跟随模式（noScale 时挂点偏移不被骨骼缩放放大）
   * @returns {{x:number, y:number, angle:number}}
   */
  _attachmentAnchor(boneWorld, attachment, directionOverride, follow) {
    const cos = Math.cos(boneWorld.rad);
    const sin = Math.sin(boneWorld.rad);
    const scale = follow === 'bone' ? { sx: boneWorld.sx || 1, sy: boneWorld.sy || 1 } : { sx: 1, sy: 1 };
    const lx = (directionOverride?.x ?? attachment.x ?? 0) * scale.sx;
    const ly = (directionOverride?.y ?? attachment.y ?? 0) * scale.sy;
    return {
      x: boneWorld.x + lx * cos - ly * sin,
      y: boneWorld.y + lx * sin + ly * cos,
      angle: boneWorld.rad + ((directionOverride?.rot ?? attachment.rot) || 0) * DEG2RAD
    };
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

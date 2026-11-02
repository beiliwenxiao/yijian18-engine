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
    // 每帧复用缓冲：锚点收集数组（两遍绘制间消费即弃，容量只增不减）
    this._anchorsBuffer = [];
    // 附件绘制源缓存：WeakMap<attachment, {image,sx,sy,sw,sh}|null>——
    // 附件对象随共享资产常驻，源图解析（getImage/图集切片）每帧逐槽查表是纯重复劳动。
    this._sourceCache = new WeakMap();
    // 序列帧附件的「帧索引→源」数组缓存（帧游标每帧推进，矩形随帧查表）。
    this._sequenceSourceCache = new WeakMap();
    // 形态合并附件缓存：WeakMap<attachment, Map<formKey, mergedObject>>——
    // directionOffsets 是共享资产只读数据，按 (attachment, formKey) 合并结果恒定可缓存。
    this._formCache = new WeakMap();
  }

  /** 资源热重载后清空源解析缓存（附件→图片映射可能已变化）。 */
  clearCaches() {
    this._sourceCache = new WeakMap();
    this._sequenceSourceCache = new WeakMap();
    this._formCache = new WeakMap();
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
    // 缓冲与合并结果全部复用（见构造函数），渲染热路径零分配。
    const anchors = this._anchorsBuffer;
    let anchorCount = 0;
    const sourceCache = this._sourceCache;
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
      // 附件形态键：left 走独立 sideL（配了左侧美术的资产可完全免镜像）；
      // 未配 sideL 的老资产逐字段回退到 side（行为不变）。
      const formKey = resolveAttachmentFormKey(sprite?.direction);
      // 转身过渡（分层转身 + 交叉淡化）：形态变化后按各槽位 turnDelayMs/turnFadeMs
      // 计算局部进度——延迟期内画旧形态，交叉期双形态叠画（旧淡出新淡入），其余画新形态。
      // 常态（无过渡/槽位未配置）turnPhase='to' = 原路径，零额外开销。
      skeletonComponent.syncDirectionTransition?.(formKey);
      const transition = skeletonComponent.getDirectionTransition?.() || null;
      const turnDelay = slot.turnDelayMs || 0;
      const turnFade = slot.turnFadeMs || 0;
      let turnPhase = 'to';
      let turnT = 1;
      if (transition && (turnDelay > 0 || turnFade > 0)) {
        const local = (transition.nowMs - transition.startedAtMs) - turnDelay;
        if (local < 0) {
          turnPhase = 'from';
        } else if (local < turnFade) {
          turnPhase = 'cross';
          turnT = turnFade > 0 ? local / turnFade : 1;
        }
      }

      const toForm = this._mergedFormAttachment(attachment, formKey);
      let effectiveAttachment = toForm.effective;
      let directionOverride = toForm.override;
      let entryAlpha = 1;

      if (turnPhase === 'from') {
        // 延迟期：本槽位仍画旧形态
        const fromForm = this._mergedFormAttachment(attachment, transition.fromForm);
        effectiveAttachment = fromForm.effective;
        directionOverride = fromForm.override;
      } else if (turnPhase === 'cross') {
        // 交叉期：旧形态淡出（先收 entry），新形态淡出随主 entry（turnT）
        const fromForm = this._mergedFormAttachment(attachment, transition.fromForm);
        const fromSource = this._resolveAttachmentSource(fromForm.effective, assetManager, skeletonComponent, slot, sourceCache);
        if (fromSource) {
          const fromAnchor = this._attachmentAnchor(boneWorld, fromForm.effective, fromForm.override, slot.follow);
          anchorCount = this._pushAnchor(anchors, anchorCount, slot, fromForm.effective, fromForm.override, fromSource, boneWorld, fromAnchor, 1 - turnT);
        }
        entryAlpha = turnT;
      }

      const source = this._resolveAttachmentSource(effectiveAttachment, assetManager, skeletonComponent, slot, sourceCache);
      if (!source) continue;

      const anchor = this._attachmentAnchor(boneWorld, effectiveAttachment, directionOverride, slot.follow);
      anchorCount = this._pushAnchor(anchors, anchorCount, slot, effectiveAttachment, directionOverride, source, boneWorld, anchor, entryAlpha);
    }

    // transform 约束：挂件跟随挂件（位置 + 可选朝向）
    anchors.length = anchorCount;
    applyTransformConstraints(anchors, asset.constraints);

    // 第二遍：绘制
    for (const entry of anchors) {
      if (entry.alpha <= 0) continue; // 交叉期已完全透明的形态不画（省一次 drawImage）
      const { attachment, source, boneWorld } = entry;
      const drawW = attachment.width > 0 ? attachment.width : source.sw;
      const drawH = attachment.height > 0 ? attachment.height : source.sh;
      if (!(source.image && source.sw > 0 && source.sh > 0 && drawW > 0 && drawH > 0)) continue;
      ctx.save();
      // 锚点已含挂点偏移与朝向偏移（见 _attachmentAnchor），此处不再重复施加
      ctx.translate(entry.x, entry.y);
      ctx.rotate(entry.angle);
      // 转身交叉淡化：旧形态淡出 / 新形态淡入（调用方 globalAlpha 之上叠加）
      if (entry.alpha < 1) ctx.globalAlpha = ctx.globalAlpha * entry.alpha;
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

  /**
   * 形态合并（含 sideL→side 逐字段回退；结果按 (attachment, formKey) 缓存）。
   * directionOffsets 是共享资产只读数据——合并结果恒定可缓存（热路径零分配）。
   * @param {Object} attachment - 实体合并后的槽位附件
   * @param {string} formKey - 方向形态键（down/side/sideL/up/SE/SW/NE/NW）
   * @returns {{effective: Object, override: Object|null}} effective=无覆盖时即原附件对象
   */
  _mergedFormAttachment(attachment, formKey) {
    let override = resolveAttachmentOffset(attachment, formKey);
    if (!override && formKey === 'sideL') override = resolveAttachmentOffset(attachment, 'side');
    if (!(override
      && (!!override.assetId || override.width > 0 || override.height > 0 || override.sw > 0))) {
      return { effective: attachment, override: override || null };
    }
    const formCache = this._formCache;
    let mergedByForm = formCache.get(attachment);
    if (!mergedByForm) {
      mergedByForm = new Map();
      formCache.set(attachment, mergedByForm);
    }
    let effective = mergedByForm.get(formKey);
    if (!effective) {
      effective = {
        ...attachment,
        ...(override.assetId ? { assetId: override.assetId } : {}),
        ...(override.width > 0 ? { width: override.width } : {}),
        ...(override.height > 0 ? { height: override.height } : {}),
        // 图集切片形态：directionOffsets 可按形态换源矩形（同一张图集里存 正/侧/背 三套部件）
        ...(override.sw > 0 ? {
          sx: override.sx || 0, sy: override.sy || 0,
          sw: override.sw, sh: override.sh
        } : {})
      };
      mergedByForm.set(formKey, effective);
    }
    return { effective, override };
  }

  /**
   * 收集一个绘制 entry（复用缓冲槽位，零分配）。
   * @param {Array} anchors - entry 缓冲
   * @param {number} anchorCount - 当前已用数量
   * @param {number} alpha - 绘制透明度（转身交叉淡化；常态 1）
   * @returns {number} 新的已用数量
   */
  _pushAnchor(anchors, anchorCount, slot, attachment, directionOverride, source, boneWorld, anchor, alpha) {
    let entry = anchors[anchorCount];
    if (!entry) {
      entry = { slot: null, attachment: null, directionOverride: null, source: null, boneWorld: null, x: 0, y: 0, angle: 0, alpha: 1 };
      anchors.push(entry);
    }
    entry.slot = slot;
    entry.attachment = attachment;
    entry.directionOverride = directionOverride;
    entry.source = source;
    entry.boneWorld = boneWorld;
    entry.x = anchor.x;
    entry.y = anchor.y;
    entry.angle = anchor.angle;
    entry.alpha = alpha;
    return anchorCount + 1;
  }

  /**
   * 解析附件的绘制源：统一返回 { image, sx, sy, sw, sh } 或 null。
   * image/slice：结果按附件对象缓存（WeakMap）——附件与源图映射随共享资产常驻，
   * 每帧逐槽重查 getImage/图集切片是纯重复劳动；热重载走 clearCaches。
   * sequence：帧游标每帧推进，按附件缓存「帧索引→源」数组后查表（O(1) 零分配）。
   */
  _resolveAttachmentSource(attachment, assetManager, skeletonComponent, slot, sourceCache = this._sourceCache) {
    if (!attachment || !SKELETON_ATTACHMENT_TYPES.includes(attachment.type)) return null;
    if (attachment.type === 'sequence') {
      const frames = Array.isArray(attachment.frames) ? attachment.frames : [];
      if (frames.length === 0) return null;
      const seqCache = this._sequenceSourceCache;
      if (!seqCache.has(attachment)) {
        const image = assetManager?.getImage?.(attachment.assetId || attachment.spriteSheet) || null;
        // 图片未就绪不缓存（按需补载后下一帧自然命中），只本帧走 null
        if (!image) return null;
        seqCache.set(attachment, frames.map(frame => (frame && frame.sw > 0 && frame.sh > 0)
          ? { image, sx: frame.sx, sy: frame.sy, sw: frame.sw, sh: frame.sh }
          : null));
      }
      const sources = seqCache.get(attachment);
      if (!sources) return null;
      return sources[skeletonComponent.getSlotFrame(slot.id) % sources.length] || null;
    }
    if (sourceCache.has(attachment)) return sourceCache.get(attachment) || null;
    let source = null;
    if (attachment.type === 'image') {
      const image = assetManager?.getImage?.(attachment.assetId) || null;
      // 图片未就绪不缓存（按需补载后下一帧自然命中）
      source = image
        ? { image, sx: 0, sy: 0, sw: image.naturalWidth || image.width, sh: image.naturalHeight || image.height }
        : null;
      if (!image) return null;
    } else if (attachment.type === 'slice') {
      // 优先内联源矩形（编辑器从图集切片写入）；可选注入共享图集注册表解析
      if (attachment.sw > 0 && attachment.sh > 0) {
        const image = assetManager?.getImage?.(attachment.assetId) || null;
        if (!image) return null;
        source = { image, sx: attachment.sx, sy: attachment.sy, sw: attachment.sw, sh: attachment.sh };
      } else {
        source = this.resolveAtlasSlice?.(attachment.assetId, attachment.sliceKey) || null;
      }
    }
    sourceCache.set(attachment, source);
    return source;
  }
}

export default SkeletonRenderer;

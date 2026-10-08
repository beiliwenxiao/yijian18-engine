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

import { ItemSpriteRenderer } from './ItemSpriteRenderer.js';
import { SkeletonRenderer } from './SkeletonRenderer.js';

/**
 * 可复用的 Canvas 2D 实体渲染器。
 *
 * 坐标由调用方处理相机变换；实体位置使用底部中心锚点。资源和 NPC 样式
 * 均通过构造函数注入，避免耦合具体游戏或 Demo。
 */
export class EntityRenderer2D {
  /**
   * @param {object} assetManager 提供 getAsset(key) 的资源管理器
   * @param {(styleKey: string) => Function | null} getRenderStyle 返回代码绘制样式的函数
   */
  constructor(assetManager, getRenderStyle = () => null, options = {}) {
    this.assetManager = assetManager;
    this.getRenderStyle = typeof getRenderStyle === 'function' ? getRenderStyle : () => null;
    this.getRenderOffset = options.getRenderOffset || (() => ({ x: 0, y: 0 }));
    // 玩家战斗状态回调：玩家头顶血条仅战斗状态显示（非战斗隐藏），敌对 NPC 不受影响
    this.isPlayerInCombat = typeof options.isPlayerInCombat === 'function' ? options.isPlayerInCombat : () => false;
    this.skeletonRenderer = options.skeletonRenderer || new SkeletonRenderer(options.skeletonRendererOptions || {});
    this._readyImageCache = new Map();
    this._renderStyleCache = new Map();
    this._nameMeasureCache = new WeakMap();
    this._promptMeasureCache = new WeakMap();
  }

  /**
   * 渲染实体及其世界空间标签。
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} entity ECS 实体
   */
  render(ctx, entity) {
    const transform = entity?.getComponent?.('transform');
    if (!transform?.position) return;

    const sprite = entity.getComponent?.('sprite');
    const stats = entity.getComponent?.('stats');
    const npc = entity.getComponent?.('npc');
    const position = transform.position;
    const offset = this.getRenderOffset(entity) || { x: 0, y: 0 };
    const x = position.x + (Number(offset.x) || 0);
    const elevation = position.elevation || 0;
    const y = position.y - elevation + (Number(offset.y) || 0);
    const width = sprite?.width || 32;
    const height = sprite?.height || 32;
    const isCorpse = entity.isCorpse === true;

    const corpsePresentation = isCorpse && entity.corpseDefinition?.presentation
      ? entity.corpseDefinition.presentation
      : null;
    const corpseOffsetX = Number(corpsePresentation?.offsetX) || 0;
    const corpseOffsetY = Number(corpsePresentation?.offsetY) || 0;
    const renderX = x + corpseOffsetX;
    const renderY = y + corpseOffsetY;

    if (!sprite || sprite.visible !== false) {
      ctx.save();
      if (isCorpse && entity.corpseHarvested === true) {
        // 剥皮完成的尸体化为骷髅：骨架本身按侧躺姿态绘制，跳过兽尸贴图与侧倒旋转
        const corpseAlpha = Number(corpsePresentation?.alpha);
        ctx.globalAlpha *= Number.isFinite(corpseAlpha)
          ? Math.max(0, Math.min(1, corpseAlpha))
          : 0.86;
        if (sprite?.alpha !== undefined) ctx.globalAlpha *= sprite.alpha;
        this._renderHarvestedSkeleton(ctx, renderX, renderY, width, height);
        ctx.restore();
      } else {
        if (isCorpse) {
          const rotationDegrees = Number.isFinite(Number(corpsePresentation?.rotationDegrees))
            ? Number(corpsePresentation.rotationDegrees)
            : 90;
          if (rotationDegrees !== 0) {
            const centerY = renderY - height / 2;
            ctx.translate(renderX, centerY);
            ctx.rotate(rotationDegrees * Math.PI / 180);
            ctx.translate(-renderX, -centerY);
          }
          const corpseAlpha = Number(corpsePresentation?.alpha);
          ctx.globalAlpha *= Number.isFinite(corpseAlpha)
            ? Math.max(0, Math.min(1, corpseAlpha))
            : 0.86;
        }
        if (sprite?.alpha !== undefined) ctx.globalAlpha *= sprite.alpha;
        // 灵魂状态（死亡待复活）：半透明渲染
        if (entity.isSoulState === true) ctx.globalAlpha *= 0.45;
        this._renderSprite(ctx, entity, sprite, npc, renderX, renderY, width, height);
        this._renderAppearanceLayers(ctx, sprite, renderX, renderY);
        ctx.restore();
      }
    }

    this._renderResourceAmount(ctx, entity.getComponent?.('resourceNode'), x, y, height);
    if (!isCorpse) {
      this._renderName(ctx, entity, npc, x, y, height);
      this._renderInteractionPrompt(ctx, npc, x, y);
      // 玩家头顶血条仅战斗状态显示（非战斗隐藏）；敌对/其他实体维持原有显示规则
      const skipPlayerBar = entity.type === 'player'
        && this.isPlayerInCombat(entity) !== true;
      if (!skipPlayerBar) {
        this._renderHealthBar(ctx, stats, npc, x, y, height);
      }
    }
  }

  /** 兼容以 renderEntity 命名的场景渲染管线。 */
  renderEntity(ctx, entity) {
    this.render(ctx, entity);
  }

  /**
   * 剥皮完成后的骷髅表现：侧躺兽骨架（头骨+脊柱+肋骨+四肢），程序化绘制
   * 而非贴图资源，骨架贴地（脚底为 renderY），朝向固定水平。
   */
  _renderHarvestedSkeleton(ctx, x, y, width, height) {
    const bone = '#e8e2d0';
    const boneShade = '#b8b09a';
    const socket = '#3a372e';
    const bodyWidth = Math.max(24, width * 0.8);
    const bodyHeight = Math.max(10, height * 0.34);
    const centerY = y - bodyHeight / 2 - 2;
    const headR = Math.max(5, bodyHeight * 0.42);
    const headX = x - bodyWidth / 2 + headR;
    const spineEndX = x + bodyWidth / 2;

    ctx.save();
    ctx.lineWidth = Math.max(1.5, bodyHeight * 0.14);
    ctx.lineCap = 'round';

    // 四肢骨（先画，被脊柱压住）
    ctx.strokeStyle = boneShade;
    const legDx = bodyWidth * 0.16;
    const legSpread = bodyHeight * 0.5;
    for (const sign of [-1, 1]) {
      const hipX = x + sign * bodyWidth * 0.18;
      ctx.beginPath();
      ctx.moveTo(hipX, centerY);
      ctx.lineTo(hipX + legDx * sign, centerY + legSpread);
      ctx.moveTo(hipX, centerY);
      ctx.lineTo(hipX - legDx * sign * 0.5, centerY + legSpread * 0.9);
      ctx.stroke();
    }

    // 脊柱
    ctx.strokeStyle = bone;
    ctx.beginPath();
    ctx.moveTo(headX + headR * 0.6, centerY);
    ctx.lineTo(spineEndX, centerY);
    ctx.stroke();

    // 肋骨（脊柱前段几条向下短弧）
    ctx.lineWidth = Math.max(1, bodyHeight * 0.1);
    const ribCount = 4;
    const ribStartX = headX + headR * 1.4;
    const ribSpan = bodyWidth * 0.38;
    for (let index = 0; index < ribCount; index += 1) {
      const ribX = ribStartX + (ribSpan / ribCount) * index;
      ctx.beginPath();
      ctx.moveTo(ribX, centerY);
      ctx.quadraticCurveTo(ribX + 2, centerY + bodyHeight * 0.34, ribX - bodyWidth * 0.05, centerY + bodyHeight * 0.4);
      ctx.stroke();
    }

    // 头骨 + 眼窝 + 吻部
    ctx.fillStyle = bone;
    ctx.beginPath();
    ctx.ellipse(headX, centerY, headR * 1.15, headR, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bone;
    ctx.lineWidth = Math.max(1, bodyHeight * 0.1);
    ctx.beginPath();
    ctx.moveTo(headX - headR * 1.1, centerY - headR * 0.15);
    ctx.lineTo(headX - headR * 1.9, centerY + headR * 0.25);
    ctx.stroke();
    ctx.fillStyle = socket;
    ctx.beginPath();
    ctx.arc(headX - headR * 0.15, centerY - headR * 0.28, Math.max(1.2, headR * 0.24), 0, Math.PI * 2);
    ctx.fill();

    // 尾椎
    ctx.strokeStyle = boneShade;
    ctx.lineWidth = Math.max(1, bodyHeight * 0.09);
    ctx.beginPath();
    ctx.moveTo(spineEndX, centerY);
    ctx.lineTo(spineEndX + bodyWidth * 0.07, centerY - bodyHeight * 0.18);
    ctx.stroke();

    ctx.restore();
  }

  _renderSprite(ctx, entity, sprite, npc, x, y, width, height) {
    // 骨骼实体：委托 SkeletonRenderer（资产未加载时走样式/色块兜底，
    // 不进入下方图片分支——spriteSheet 是骨骼稳定 ID，查图会告警刷屏）
    if (sprite?.isSkeleton) {
      const handled = this.skeletonRenderer.render(ctx, {
        assetManager: this.assetManager,
        skeletonComponent: entity.getComponent?.('skeleton') || null,
        sprite, x, y, width, height
      });
      if (handled) return;
      this._renderFallbackBody(ctx, entity, npc, sprite, x, y, width, height);
      return;
    }

    let rendered = false;
    const image = sprite?.spriteSheet ? this._getReadyImage(sprite.spriteSheet) : null;

    if (sprite?.isStatic && image) {
      ctx.drawImage(image, x - width / 2, y - height, width, height);
      rendered = true;
    }

    if (!rendered && sprite?.useAnimatedSprite && image) {
      const columns = Math.max(1, sprite.spriteColumns || 4);
      const rows = Math.max(1, sprite.spriteRows || 9);
      const frame = sprite.getAnimatedFrame?.() || sprite.getCurrentFrame?.() || { row: 0, col: 0 };
      const cellWidth = this._imageWidth(image) / columns;
      const cellHeight = this._imageHeight(image) / rows;
      const row = Math.max(0, Math.min(rows - 1, frame.row || 0));
      const col = Math.max(0, Math.min(columns - 1, frame.col || 0));
      ctx.drawImage(image, col * cellWidth, row * cellHeight, cellWidth, cellHeight,
        x - width / 2, y - height, width, height);
      rendered = true;
    }

    if (!rendered && sprite?.useDirectionalSprite && image) {
      const frameIndex = Number(sprite.getCurrentFrame?.()) || 0;
      const cellWidth = this._imageWidth(image) / 3;
      const cellHeight = this._imageHeight(image) / 3;
      const row = Math.floor(frameIndex / 3);
      const col = frameIndex % 3;
      ctx.drawImage(image, col * cellWidth, row * cellHeight, cellWidth, cellHeight,
        x - width / 2, y - height, width, height);
      rendered = true;
    }

    if (!rendered && this._hasSequenceAnimation(sprite) && image) {
      const frameWidth = width;
      const frameHeight = height;
      const columns = Math.max(1, Math.floor(this._imageWidth(image) / frameWidth));
      const frameIndex = Number(sprite.getCurrentFrame?.()) || 0;
      const scale = sprite.scale || 1;
      const destWidth = frameWidth * scale;
      const destHeight = frameHeight * scale;
      ctx.drawImage(image, (frameIndex % columns) * frameWidth,
        Math.floor(frameIndex / columns) * frameHeight, frameWidth, frameHeight,
        x - destWidth / 2, y - destHeight, destWidth, destHeight);
      rendered = true;
    }

    if (!rendered) {
      this._renderFallbackBody(ctx, entity, npc, sprite, x, y, width, height);
    }
  }

  /** 兜底绘制：代码渲染样式 → 掉落物 → 色块。 */
  _renderFallbackBody(ctx, entity, npc, sprite, x, y, width, height) {
    const styleKey = npc?.renderStyle || entity.renderStyle;
    const drawStyle = styleKey ? this._getRenderStyle(styleKey) : null;
    if (typeof drawStyle === 'function') {
      drawStyle(ctx, x, y, sprite?.scale || 1);
      return;
    }
    if (entity.type === 'loot') {
      this._renderLootFallback(ctx, entity, x, y);
      return;
    }
    if (sprite) {
      ctx.fillStyle = sprite.color || '#00ff00';
      ctx.fillRect(x - width / 2, y - height, width, height);
      ctx.strokeStyle = entity.type === 'player' ? '#4CAF50' : '#ff4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - width / 2, y - height, width, height);
    }
  }

  _renderAppearanceLayers(ctx, sprite, x, y) {
    const layers = sprite?.appearanceLayers;
    if (!Array.isArray(layers) || layers.length === 0) return;

    for (const layer of layers) {
      if (!layer?.visible || !layer.assetId) continue;
      const image = this._getReadyImage(layer.assetId);
      if (!image) continue;
      const width = layer.width || sprite.width || 32;
      const height = layer.height || sprite.height || 32;
      ctx.save();
      ctx.globalAlpha *= layer.alpha ?? 1;
      ctx.drawImage(
        image,
        x - width / 2 + (layer.offsetX || 0),
        y - height + (layer.offsetY || 0),
        width,
        height
      );
      ctx.restore();
    }
  }

  _getReadyImage(key) {
    const cached = this._readyImageCache.get(key);
    if (cached) return cached;
    const image = this.assetManager?.getAsset?.(key);
    if (!image) return null;
    const isCanvas = typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement;
    if (!isCanvas && (!image.complete || this._imageWidth(image) <= 0)) return null;
    this._readyImageCache.set(key, image);
    return image;
  }

  _getRenderStyle(key) {
    const cached = this._renderStyleCache.get(key);
    if (cached) return cached;
    const style = this.getRenderStyle(key);
    // 未注册样式不缓存，允许内容库稍后完成注册。
    if (typeof style === 'function') this._renderStyleCache.set(key, style);
    return style;
  }

  /** 资源热重载或内容库重装后由宿主显式清理缓存。 */
  clearCaches() {
    this._readyImageCache.clear();
    this._renderStyleCache.clear();
    this._nameMeasureCache = new WeakMap();
    this._promptMeasureCache = new WeakMap();
  }

  _imageWidth(image) {
    return image.naturalWidth || image.width || 0;
  }

  _imageHeight(image) {
    return image.naturalHeight || image.height || 0;
  }

  _hasSequenceAnimation(sprite) {
    return Boolean(sprite?.spriteSheet && !sprite.isStatic && !sprite.useAnimatedSprite
      && !sprite.useDirectionalSprite && (sprite.animations?.size > 0 || sprite.animations?.length > 0));
  }

  _renderLootFallback(ctx, entity, x, y) {
    const item = entity.itemData || {};
    const itemId = item.id || item.type || entity.itemId || entity.id;
    // 内容定义的稳定 imageId/assetId 优先于硬编码手绘画法。
    const stableId = item.imageId || item.assetId || item.sprite?.imageId || item.sprite?.assetId;
    if (stableId) {
      const key = this.assetManager?.resolveManifestAsset?.(stableId, '2d')?.key || stableId;
      const image = this._getReadyImage(key);
      if (image) {
        const width = item.sprite?.width || item.width || 32;
        const height = item.sprite?.height || item.height
          || Math.round(width * this._imageHeight(image) / this._imageWidth(image));
        ctx.drawImage(image, x - width / 2, y - height, width, height);
        return;
      }
    }
    if (itemId && ItemSpriteRenderer.draw(ctx, itemId, x, y)) return;

    ctx.fillStyle = '#ffaa00';
    ctx.beginPath();
    ctx.arc(x, y - 5, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  _renderResourceAmount(ctx, node, x, y, height) {
    if (!node || !Number.isFinite(node.maxRemaining) || node.maxRemaining < 0) return;
    const remaining = Math.max(0, Math.floor(Number(node.remaining) || 0));
    const maximum = Math.max(0, Math.floor(Number(node.maxRemaining) || 0));
    const label = `${remaining}/${maximum}`;
    const textY = y - height - 28;
    ctx.save();
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const width = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    ctx.fillRect(x - width / 2, textY - 15, width, 17);
    ctx.fillStyle = remaining > 0 ? '#d8f3b2' : '#f1a4a4';
    ctx.fillText(label, x, textY - 2);
    ctx.restore();
  }

  _renderName(ctx, entity, npc, x, y, height) {
    const name = entity.getComponent?.('name');
    if (!name?.visible || !name.name) return;

    const nameY = y - height + (name.offsetY || -10);
    ctx.save();
    const font = `bold ${name.fontSize || 14}px Arial`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const padding = 4;
    let measured = this._nameMeasureCache.get(name);
    if (!measured || measured.text !== name.name || measured.font !== font) {
      measured = { text: name.name, font, width: ctx.measureText(name.name).width };
      this._nameMeasureCache.set(name, measured);
    }
    const textWidth = measured.width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x - textWidth / 2 - padding, nameY - 16, textWidth + padding * 2, 18);
    ctx.fillStyle = name.color || '#ffffff';
    ctx.fillText(name.name, x, nameY);

    if (npc?.title) {
      ctx.font = '11px Arial';
      ctx.fillStyle = '#FFD700';
      ctx.fillText(npc.title, x, nameY - 18);
    }
    ctx.restore();
  }

  _renderInteractionPrompt(ctx, npc, x, y) {
    const canInteract = typeof npc?.hasInteraction !== 'function' || npc.hasInteraction();
    if (!npc?.inRange || npc.interactionTrigger !== 'interact' || !canInteract || !npc.interactionPrompt) return;

    ctx.save();
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    let measured = this._promptMeasureCache.get(npc);
    if (!measured || measured.text !== npc.interactionPrompt) {
      measured = { text: npc.interactionPrompt, width: ctx.measureText(npc.interactionPrompt).width + 8 };
      this._promptMeasureCache.set(npc, measured);
    }
    const width = measured.width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - width / 2, y + 4, width, 18);
    ctx.fillStyle = '#ffff88';
    ctx.fillText(npc.interactionPrompt, x, y + 17);
    ctx.restore();
  }

  _renderHealthBar(ctx, stats, npc, x, y, height) {
    // 与场景原逻辑保持一致：明确非敌对的 NPC 不显示血条。
    if (!stats || stats.maxHp <= 0 || (npc && npc.faction !== 'hostile')) return;

    const barWidth = 40;
    const barHeight = 4;
    const barX = x - barWidth / 2;
    const barY = y - height - 8;
    const hpRatio = Math.max(0, Math.min(1, stats.hp / stats.maxHp));

    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = hpRatio > 0.5 ? '#00ff00' : hpRatio > 0.2 ? '#ffaa00' : '#ff0000';
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }
}

export default EntityRenderer2D;

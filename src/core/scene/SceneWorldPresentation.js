/************************************************************
 * Copyright (c) 2026 Liu Xiao (beiliwenxiao)
 * @project YiJian18-Engine - 跨平台2D/3D ECS游戏引擎
 ************************************************************/

import { ItemSpriteRenderer } from '../../rendering/ItemSpriteRenderer.js';
import { EntityRenderer2D } from '../../rendering/EntityRenderer2D.js';

/** 通用世界背景、掉落物和战斗空间表现。 */
export class SceneWorldPresentation {
  constructor(scene, options = {}) {
    if (!scene) throw new TypeError('SceneWorldPresentation requires scene');
    this.scene = scene;
    this.itemRenderer = options.itemRenderer || ItemSpriteRenderer;
    this.getAssetManager = options.getAssetManager || (() => this.scene.assetManager || null);
    this.getRenderOffset = options.getRenderOffset || (() => ({ x: 0, y: 0 }));
  }

  renderBackground(ctx) {
    const scene = this.scene;
    const context = scene.context || null;
    const terrains = Array.isArray(context?.world?.terrains)
      ? context.world.terrains.filter(Boolean)
      : [];
    const terrain = context?.world?.terrain || scene.terrain || null;
    const camera = context?.camera?.instance || scene.camera || null;

    if (terrains.length > 0) {
      const bounds = camera?.getViewBounds?.();
      const activeTerrain = terrain || terrains[0];
      ctx.fillStyle = activeTerrain?.sceneBackgroundColor || '#1f1a14';
      if (bounds) {
        ctx.fillRect(
          bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      } else {
        ctx.fillRect(0, 0, scene.logicalWidth, scene.logicalHeight);
      }
      for (const currentTerrain of terrains) currentTerrain.renderGround?.(ctx);
      return;
    }
    if (terrain) {
      const bounds = camera?.getViewBounds?.();
      ctx.fillStyle = terrain.sceneBackgroundColor || '#1f1a14';
      if (bounds) {
        ctx.fillRect(
          bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      } else {
        ctx.fillRect(0, 0, scene.logicalWidth, scene.logicalHeight);
      }
      terrain.renderGround?.(ctx);
      return;
    }
    if (scene.isometricRenderer) {
      scene.isometricRenderer.drawInfiniteGrid(camera?.getViewBounds?.());
      if (scene.mapData) scene.isometricRenderer.drawMap();
      return;
    }
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, scene.logicalWidth, scene.logicalHeight);
  }

  renderPickupItems(ctx) {
    this._renderPickupList(ctx, this.scene.pickupItems);
    this._renderPickupList(ctx, this.scene.equipmentItems);
  }

  _renderPickupList(ctx, items) {
    // 名称标签距离门控：玩家靠近才显示掉落物名字，远处隐藏（与实体标签同一默认距离）
    const playerPosition = this.scene.playerEntity?.getComponent?.('transform')?.position || null;
    const showDistance = EntityRenderer2D.LABEL_SHOW_DISTANCE;
    for (const item of items) {
      if (item.picked) continue;
      const offset = this.getRenderOffset(item) || { x: 0, y: 0 };
      const x = item.x + (Number(offset.x) || 0);
      const y = item.y + (Number(offset.y) || 0);
      // 优先使用内容定义的稳定 imageId/assetId；其次手绘画法；最后通用兜底圆点。
      if (!this._drawPickupImage(ctx, item, x, y)
        && !this.itemRenderer.draw(ctx, item.id, x, y)) {
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(x, y - 5, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!playerPosition
        || (x - playerPosition.x) ** 2 + (y - playerPosition.y) ** 2 > showDistance * showDistance) {
        continue;
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(item.name, x, y - 20);
    }
  }

  /**
   * 用稳定 imageId/assetId 绘制地面物品；资源未就绪时返回 false 交给后续兜底。
   * 坐标语义与手绘画法一致：(x, y) 是落地点，图片按底部中心对齐。
   */
  _drawPickupImage(ctx, item, x, y) {
    const sprite = item.sprite || {};
    const stableId = item.imageId || item.assetId || sprite.imageId || sprite.assetId;
    if (!stableId) return false;
    const manager = this.getAssetManager();
    if (!manager) return false;
    const key = manager.resolveManifestAsset?.(stableId, '2d')?.key || stableId;
    const image = manager.getAsset?.(key);
    if (!image) return false;
    const naturalWidth = image.naturalWidth || image.width || 0;
    const naturalHeight = image.naturalHeight || image.height || 0;
    if (naturalWidth <= 0 || naturalHeight <= 0) return false;
    if (image.complete === false) return false;

    const width = sprite.width || item.width || 32;
    const height = sprite.height || item.height || Math.round(width * naturalHeight / naturalWidth);
    ctx.save();
    if (sprite.alpha !== undefined) ctx.globalAlpha = sprite.alpha;
    ctx.drawImage(image, x - width / 2, y - height, width, height);
    ctx.restore();
    return true;
  }

  renderFlightShadow(ctx) {
    const scene = this.scene;
    if (!scene.flightSystem?.isFlying || !scene.playerEntity) return;
    const position = scene.playerEntity.getComponent('transform')?.position;
    const elevation = position?.elevation || 0;
    if (!position || elevation <= 2) return;
    const ratio = Math.min(1, elevation / 120);
    const scale = 1 - ratio * 0.4;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(position.x, position.y, 20 * scale, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.3 * (1 - ratio * 0.5)})`;
    ctx.fill();
    ctx.restore();
  }

  renderBlockShield(ctx) {
    const scene = this.scene;
    if (!scene.combatSystem?.isBlocking() || !scene.playerEntity) return;
    const transform = scene.playerEntity.getComponent('transform');
    if (!transform) return;
    const height = scene.playerEntity.getComponent('sprite')?.height || 64;
    const cx = transform.position.x;
    const cy = transform.position.y - height / 2;
    const now = performance.now();
    const activeBlock = scene.combatSystem._activeBlock;
    const progress = Math.min(1, (now - activeBlock.startTime) / activeBlock.duration);
    const alpha = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) * 0.6 : 0.6;
    const radius = 36 * (1 + Math.sin(now / 120) * 0.05);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(100, 200, 255, ${alpha * 0.8})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(100, 200, 255, ${alpha * 0.15})`);
    gradient.addColorStop(0.6, `rgba(60, 160, 240, ${alpha * 0.3})`);
    gradient.addColorStop(1, `rgba(30, 120, 220, ${alpha * 0.5})`);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(180, 230, 255, ${alpha})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    const innerRadius = radius * 0.55;
    for (let index = 0; index < 6; index++) {
      const angle = Math.PI * 2 / 6 * index - Math.PI / 2;
      const x = cx + Math.cos(angle) * innerRadius;
      const y = cy + Math.sin(angle) * innerRadius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(150, 220, 255, ${alpha * 0.6})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

export default SceneWorldPresentation;

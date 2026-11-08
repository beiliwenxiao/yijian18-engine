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

  /**
   * 格挡半圆遮罩：跟随角色朝向，只覆盖正面半圆。
   * 圆心/半径/半角/朝向全部取自 combatSystem.getBlockGeometry()——与格挡判定同一数据源，
   * 且与近战扇形一致：以玩家碰撞中心为锚点、按 1:0.5 压扁贴合地面的 2.5D 投影。
   */
  renderBlockShield(ctx) {
    const scene = this.scene;
    const combatSystem = scene.combatSystem;
    const geometry = combatSystem?.getBlockGeometry?.();
    if (!geometry?.active) return;

    // 时钟必须与格挡状态同源（simulationClock，暂停时不走表）：
    // 旧实现用 performance.now() 对 startTime 求进度，场景暂停累计超过 300ms 后
    // 进度会被算成 1 → 透明度归零，遮罩看起来「完全没画出来」。
    const now = Number(combatSystem.now()) || 0;
    const activeBlock = combatSystem._activeBlock || {};
    const duration = Number(activeBlock.duration) || 0;
    const elapsed = Math.max(0, now - (Number(activeBlock.startTime) || 0));
    const progress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
    const fade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1; // 末段 30% 淡出
    const pulse = 1 + Math.sin(now / 120) * 0.05;
    const radius = Math.max(1, geometry.radius * pulse);
    const dirAngle = Math.atan2(geometry.dirY, geometry.dirX);
    const start = dirAngle - geometry.halfAngle;
    const end = dirAngle + geometry.halfAngle;
    const alpha = Math.max(0, Math.min(1, fade)) * 0.6;
    const solid = (value) => Math.max(0, Math.min(1, value)).toFixed(3);

    ctx.save();
    ctx.setLineDash([]);
    ctx.translate(geometry.x, geometry.y);
    ctx.scale(1, 0.5);

    // 正面半圆填充遮罩
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(100, 200, 255, ${solid(alpha * 0.18)})`);
    gradient.addColorStop(0.65, `rgba(60, 160, 240, ${solid(alpha * 0.34)})`);
    gradient.addColorStop(1, `rgba(30, 120, 220, ${solid(alpha * 0.55)})`);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 半圆轮廓（弧 + 直径弦）
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.strokeStyle = `rgba(180, 230, 255, ${solid(alpha * 1.15)})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 内层弧：强化「护盾面」层次
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.62, start, end);
    ctx.strokeStyle = `rgba(150, 220, 255, ${solid(alpha * 0.7)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }
}

export default SceneWorldPresentation;

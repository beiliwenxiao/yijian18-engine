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

import { UIElement } from './UIElement.js';

/**
 * 小地图组件（9宫格）
 * 
 * 以真实地图为基础，缩小到指定比例（默认10%）显示。
 * 支持多 terrain chunk（9宫格大地图），将所有已加载的 terrain
 * 渲染到一张离屏 canvas 上生成缩略图，标注玩家和敌人位置。
 * 
 * 使用方式：
 *   minimap.setTerrains(terrainArray)  — 绑定所有 terrain 实例
 *   minimap.setPlayerPosition(pos)     — 每帧更新玩家位置
 *   minimap.setViewBounds(bounds)      — 每帧更新相机视野
 */
export class Minimap extends UIElement {
  /**
   * @param {Object} options
   * @param {number} [options.scale=0.1] - 地图缩放比例（0.1 = 10%）
   * @param {string} [options.backgroundColor] - 背景色
   * @param {string} [options.borderColor] - 边框色
   * @param {string} [options.playerColor] - 玩家标记色
   * @param {string} [options.enemyColor] - 敌人标记色
   * @param {string} [options.npcColor] - NPC 标记色
   * @param {number} [options.markerSize=4] - 标记半径
   * @param {number} [options.borderWidth=2] - 边框宽度
   */
  constructor(options = {}) {
    super(options);

    this.mapScale = options.scale || 0.1;
    this.backgroundColor = options.backgroundColor || 'rgba(20, 15, 10, 0.85)';
    this.borderColor = options.borderColor || '#8B7355';
    this.playerColor = options.playerColor || '#00ff00';
    this.enemyColor = options.enemyColor || '#ff3333';
    this.npcColor = options.npcColor || '#ffdd00';
    this.markerSize = options.markerSize || 4;
    this.borderWidth = options.borderWidth || 2;
    this.padding = 4;

    // 缩放级别：0=最大（本屏+10%），1=中间，2=最小（全部9宫格）
    this._zoomLevel = 1; // 默认中间
    this._maxZoomLevel = 2;

    // 地形实例列表
    this._terrains = [];
    // 项目世界索引是边界和 chunk 尺寸的唯一来源。
    this._worldIndex = options.worldIndex || null;
    this._regionRef = options.regionRef ?? null;
    // 九宫格缩略图缓存保存完整已加载范围；缩放/跟随只改变裁剪窗口。
    this._mapCache = null;
    this._fullWorldMinX = 0;
    this._fullWorldMinY = 0;
    this._fullWorldMaxX = 0;
    this._fullWorldMaxY = 0;
    this._cacheScale = 1;
    this._sourceX = 0;
    this._sourceY = 0;
    this._sourceW = 0;
    this._sourceH = 0;
    // 缓存脏标记版本号
    this._cacheVersion = 0;
    // 上次成功构建时的版本
    this._builtVersion = -1;
    // 缓存重建间隔（避免每帧都尝试重建），单位：秒
    this._rebuildCooldown = 0;
    this._rebuildInterval = 0.5; // 0.5秒

    // 世界坐标范围（所有 terrain 的包围盒）
    this._worldMinX = 0;
    this._worldMinY = 0;
    this._worldMaxX = 0;
    this._worldMaxY = 0;
    // 缩略图实际绘制尺寸
    this._drawW = 0;
    this._drawH = 0;

    // 玩家、敌人、NPC 与任务位置（世界坐标）
    this.playerPosition = null;
    this.enemyPositions = [];
    this.npcPositions = [];
    this.taskMarkers = [];
    this.taskMarkerColor = options.taskMarkerColor || '#ffd54f';
    // 相机视野范围
    this.viewBounds = null;
    this._renderTransform = {
      offsetX: 0, offsetY: 0, scaleX: 0, scaleY: 0,
      clipLeft: 0, clipTop: 0, clipRight: 0, clipBottom: 0
    };
    this.layoutManaged = options.layoutManaged === true;
  }

  /**
   * 声明外框尺寸是否由 UILayoutLoader 管理。
   * 地图缓存和缩放只更新内容裁剪，不得覆盖编辑器保存的外框。
   */
  setLayoutManaged(enabled) {
    const next = enabled === true;
    if (this.layoutManaged === next) return;
    this.layoutManaged = next;
    this._frameSizeSet = next;
    if (next) this._anchorRight = undefined;
  }

  /**
   * 绑定 terrain 实例列表（支持9宫格多 chunk）
   * @param {Array<Scene1Terrain>} terrains
   */
  setTerrains(terrains) {
    this._terrains = terrains || [];
    this._frameSizeSet = false;
    this._invalidateCache();
  }

  /** 注入 ProjectWorldIndex；小地图不直接读取 region 配置。 */
  setWorldIndex(worldIndex, regionRef = null) {
    this._worldIndex = worldIndex || null;
    this._regionRef = regionRef ?? worldIndex?.getEntry?.()?.regionId ?? null;
    this._frameSizeSet = false;
    this._invalidateCache();
  }

  /**
   * 绑定单个 terrain（兼容接口）
   * @param {Scene1Terrain} terrain
   */
  setTerrain(terrain) {
    if (terrain) {
      this._terrains = [terrain];
    } else {
      this._terrains = [];
    }
    this._frameSizeSet = false;
    this._invalidateCache();
  }

  /** 标记缓存需要重建 */
  _invalidateCache() {
    this._cacheVersion++;
  }

  /** 释放缩略图缓存（场景离开时调用） */
  dispose() {
    this._releaseMapCache();
    this._terrains = [];
    this._builtVersion = -1;
  }

  setPlayerPosition(position) { this.playerPosition = position; }
  setEnemyPositions(positions) { this.enemyPositions = positions || []; }
  setNPCPositions(positions) { this.npcPositions = positions || []; }
  /** 只读接收任务投影 marker；不修改任务、场景对象或调用方数组。 */
  setTaskMarkers(markers) {
    this.taskMarkers = Array.isArray(markers)
      ? markers.map(marker => ({ ...marker }))
      : [];
  }
  setViewBounds(bounds) { this.viewBounds = bounds; }

  /** 放大小地图（显示更小范围，更多细节） */
  zoomIn() {
    if (this._zoomLevel > 0) {
      this._zoomLevel--;
      this._updateViewport();
    }
  }

  /** 缩小小地图（显示更大范围） */
  zoomOut() {
    if (this._zoomLevel < this._maxZoomLevel) {
      this._zoomLevel++;
      this._updateViewport();
    }
  }

  /** 九宫格加载完成后主动生成一次完整缩略图背景缓存。 */
  prepareBackgroundCache() {
    this._rebuildCooldown = 0;
    this._tryBuildCache(0);
    this._updateViewport();
    return !!this._mapCache;
  }

  /**
   * 构建完整九宫格缩略图。玩家移动和缩放只改变源矩形，不重画 terrain。
   * @param {number} deltaTime - 帧间隔 ms
   */
  _tryBuildCache(deltaTime) {
    if (this._builtVersion === this._cacheVersion && this._mapCache) return;
    if (this._rebuildCooldown > 0) {
      this._rebuildCooldown -= deltaTime;
      return;
    }
    if (this._terrains.length === 0) return;

    const region = this._worldIndex?.getRegion?.(this._regionRef);
    if (!region) return;
    const getTerrainExtent = terrain => ({
      width: Number(terrain?.basinWidth ?? terrain?.worldWidth) || region.chunkWidth,
      height: Number(terrain?.basinHeight ?? terrain?.worldHeight) || region.chunkHeight
    });
    let fullMinX = Infinity, fullMinY = Infinity, fullMaxX = -Infinity, fullMaxY = -Infinity;
    for (const terrain of this._terrains) {
      const ox = terrain.worldOffset?.x || 0;
      const oy = terrain.worldOffset?.y || 0;
      const { width, height } = getTerrainExtent(terrain);
      fullMinX = Math.min(fullMinX, ox);
      fullMinY = Math.min(fullMinY, oy);
      fullMaxX = Math.max(fullMaxX, ox + width);
      fullMaxY = Math.max(fullMaxY, oy + height);
    }
    const fullW = fullMaxX - fullMinX;
    const fullH = fullMaxY - fullMinY;
    if (fullW <= 0 || fullH <= 0) return;

    if (!this._frameSizeSet) {
      if (!this.layoutManaged) {
        const maxDim = Math.max(this.width, this.height);
        const fullAspect = fullW / fullH;
        if (fullAspect >= 1) {
          this.width = maxDim;
          this.height = Math.round(maxDim / fullAspect);
        } else {
          this.height = maxDim;
          this.width = Math.round(maxDim * fullAspect);
        }
        if (this._anchorRight !== undefined) this.x = this._anchorRight - this.width;
      }
      this._frameSizeSet = true;
    }

    const innerW = Math.max(1, this.width - this.padding * 2);
    const innerH = Math.max(1, this.height - this.padding * 2);
    let cacheScale = Math.max(
      this.mapScale,
      innerW / Math.max(1, fullW),
      innerH / Math.max(1, fullH)
    );
    const maxCacheDimension = 2048;
    cacheScale = Math.min(
      cacheScale,
      maxCacheDimension / fullW,
      maxCacheDimension / fullH
    );
    const cacheW = Math.max(1, Math.ceil(fullW * cacheScale));
    const cacheH = Math.max(1, Math.ceil(fullH * cacheScale));
    const canvas = document.createElement('canvas');
    canvas.width = cacheW;
    canvas.height = cacheH;
    const ctx = canvas.getContext('2d');
    ctx.scale(cacheScale, cacheScale);
    ctx.translate(-fullMinX, -fullMinY);

    for (const terrain of this._terrains) {
      const ox = terrain.worldOffset?.x || 0;
      const oy = terrain.worldOffset?.y || 0;
      const { width, height } = getTerrainExtent(terrain);
      ctx.fillStyle = terrain.sceneBackgroundColor || '#1f1a14';
      ctx.fillRect(ox, oy, width, height);
      if (terrain._combinedGroundCache) {
        ctx.drawImage(
          terrain._combinedGroundCache,
          terrain._combinedGroundCacheX,
          terrain._combinedGroundCacheY
        );
      } else {
        terrain._renderWaterPatches?.(ctx);
        if (terrain._bgImageCache) {
          ctx.drawImage(terrain._bgImageCache, terrain._bgImageCacheX, terrain._bgImageCacheY);
        }
      }
      if (terrain._belowDecoCache) {
        ctx.drawImage(terrain._belowDecoCache, terrain._belowDecoCacheX, terrain._belowDecoCacheY);
      }
      if (terrain._groundDecoCache) {
        ctx.drawImage(terrain._groundDecoCache, terrain._groundDecoCacheX, terrain._groundDecoCacheY);
      }
    }

    this._releaseMapCache();
    this._mapCache = canvas;
    this._fullWorldMinX = fullMinX;
    this._fullWorldMinY = fullMinY;
    this._fullWorldMaxX = fullMaxX;
    this._fullWorldMaxY = fullMaxY;
    this._cacheScale = cacheScale;
    this._builtVersion = this._cacheVersion;
    this._rebuildCooldown = this._rebuildInterval;
  }

  _releaseMapCache() {
    if (!this._mapCache) return;
    try {
      this._mapCache.width = 0;
      this._mapCache.height = 0;
    } catch (error) { /* best-effort Canvas release */ }
    this._mapCache = null;
  }

  _updateViewport() {
    if (!this._mapCache) return;
    const region = this._worldIndex?.getRegion?.(this._regionRef);
    if (!region) return;
    const chunkW = region.chunkWidth;
    const chunkH = region.chunkHeight;
    let minX, minY, maxX, maxY;
    if (this._zoomLevel === 0 && this.viewBounds) {
      const vw = this.viewBounds.right - this.viewBounds.left;
      const vh = this.viewBounds.bottom - this.viewBounds.top;
      minX = this.viewBounds.left - vw * 0.1;
      minY = this.viewBounds.top - vh * 0.1;
      maxX = this.viewBounds.right + vw * 0.1;
      maxY = this.viewBounds.bottom + vh * 0.1;
    } else if (this._zoomLevel === 1 && this.playerPosition) {
      minX = this.playerPosition.x - chunkW * 1.5;
      minY = this.playerPosition.y - chunkH * 1.5;
      maxX = this.playerPosition.x + chunkW * 1.5;
      maxY = this.playerPosition.y + chunkH * 1.5;
    } else {
      minX = this._fullWorldMinX;
      minY = this._fullWorldMinY;
      maxX = this._fullWorldMaxX;
      maxY = this._fullWorldMaxY;
    }
    minX = Math.max(minX, this._fullWorldMinX);
    minY = Math.max(minY, this._fullWorldMinY);
    maxX = Math.min(maxX, this._fullWorldMaxX);
    maxY = Math.min(maxY, this._fullWorldMaxY);
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    if (worldW <= 0 || worldH <= 0) return;

    this._worldMinX = minX;
    this._worldMinY = minY;
    this._worldMaxX = maxX;
    this._worldMaxY = maxY;
    const innerW = Math.max(1, this.width - this.padding * 2);
    const innerH = Math.max(1, this.height - this.padding * 2);
    const displayScale = Math.min(innerW / worldW, innerH / worldH);
    this._drawW = Math.max(1, Math.floor(worldW * displayScale));
    this._drawH = Math.max(1, Math.floor(worldH * displayScale));
    this._sourceX = Math.max(0, (minX - this._fullWorldMinX) * this._cacheScale);
    this._sourceY = Math.max(0, (minY - this._fullWorldMinY) * this._cacheScale);
    this._sourceW = Math.min(this._mapCache.width - this._sourceX, worldW * this._cacheScale);
    this._sourceH = Math.min(this._mapCache.height - this._sourceY, worldH * this._cacheScale);
  }

  /**
   * 世界坐标 → 小地图屏幕坐标
   * @param {Object} worldPos - {x, y}
   * @returns {Object|null}
   */
  _worldToMinimap(worldPos) {
    if (!this._mapCache || this._drawW === 0) return null;
    const transform = this._renderTransform;
    return {
      x: transform.offsetX + (worldPos.x - this._worldMinX) * transform.scaleX,
      y: transform.offsetY + (worldPos.y - this._worldMinY) * transform.scaleY
    };
  }

  _isMarkerVisible(x, y) {
    const transform = this._renderTransform;
    const margin = this.markerSize;
    return x + margin >= transform.clipLeft && x - margin <= transform.clipRight
      && y + margin >= transform.clipTop && y - margin <= transform.clipBottom;
  }

  /** 更新动态标记和裁剪窗口；背景缓存只能由区域激活时显式建立。 */
  update() {
    this._updateViewport();
  }

  /**
   * 渲染小地图
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.visible) return;

    ctx.save();
    if (this.alpha < 1) ctx.globalAlpha = this.alpha;

    // 背景
    ctx.fillStyle = this.backgroundColor;
    this._roundRect(ctx, this.x, this.y, this.width, this.height, 4);
    ctx.fill();

    // 边框
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = this.borderWidth;
    this._roundRect(ctx, this.x, this.y, this.width, this.height, 4);
    ctx.stroke();

    if (this._mapCache) {
      const innerW = this.width - this.padding * 2;
      const innerH = this.height - this.padding * 2;
      const offsetX = this.x + this.padding + (innerW - this._drawW) / 2;
      const offsetY = this.y + this.padding + (innerH - this._drawH) / 2;
      const transform = this._renderTransform;
      transform.offsetX = offsetX;
      transform.offsetY = offsetY;
      transform.scaleX = this._drawW / Math.max(1, this._worldMaxX - this._worldMinX);
      transform.scaleY = this._drawH / Math.max(1, this._worldMaxY - this._worldMinY);
      transform.clipLeft = this.x + this.padding;
      transform.clipTop = this.y + this.padding;
      transform.clipRight = transform.clipLeft + innerW;
      transform.clipBottom = transform.clipTop + innerH;

      // 裁剪
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.x + this.padding, this.y + this.padding, innerW, innerH);
      ctx.clip();

      if (this._sourceW > 0 && this._sourceH > 0) {
        ctx.drawImage(
          this._mapCache,
          this._sourceX, this._sourceY, this._sourceW, this._sourceH,
          offsetX, offsetY, this._drawW, this._drawH
        );
      }

      // 视野框
      this._renderViewBounds(ctx);
      // 敌人
      this._renderEnemyMarkers(ctx);
      // NPC
      this._renderNPCMarkers(ctx);
      // 当前玩家追踪的任务目标
      this._renderTaskMarkers(ctx);
      // 玩家（最上层）
      this._renderPlayerMarker(ctx);

      ctx.restore();
    } else {
      // 加载中提示
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('地图加载中...', this.x + this.width / 2, this.y + this.height / 2);
    }

    // 左下角 +/- 缩放按钮
    // (已移除，改为点击小地图切换缩放)

    ctx.restore();
  }

  // ─── 内部渲染方法 ───────────────────────────────────────

  _renderViewBounds(ctx) {
    if (!this.viewBounds) return;
    const transform = this._renderTransform;
    const left = transform.offsetX + (this.viewBounds.left - this._worldMinX) * transform.scaleX;
    const top = transform.offsetY + (this.viewBounds.top - this._worldMinY) * transform.scaleY;
    const right = transform.offsetX + (this.viewBounds.right - this._worldMinX) * transform.scaleX;
    const bottom = transform.offsetY + (this.viewBounds.bottom - this._worldMinY) * transform.scaleY;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, right - left, bottom - top);
  }

  _renderPlayerMarker(ctx) {
    if (!this.playerPosition) return;
    const transform = this._renderTransform;
    const x = transform.offsetX + (this.playerPosition.x - this._worldMinX) * transform.scaleX;
    const y = transform.offsetY + (this.playerPosition.y - this._worldMinY) * transform.scaleY;
    if (!this._isMarkerVisible(x, y)) return;
    ctx.fillStyle = this.playerColor;
    ctx.beginPath();
    ctx.arc(x, y, this.markerSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, this.markerSize, 0, Math.PI * 2);
    ctx.stroke();
  }

  _renderEnemyMarkers(ctx) {
    ctx.fillStyle = this.enemyColor;
    const transform = this._renderTransform;
    for (let index = 0; index < this.enemyPositions.length; index++) {
      const pos = this.enemyPositions[index];
      const x = transform.offsetX + (pos.x - this._worldMinX) * transform.scaleX;
      const y = transform.offsetY + (pos.y - this._worldMinY) * transform.scaleY;
      if (!this._isMarkerVisible(x, y)) continue;
      ctx.beginPath();
      ctx.arc(x, y, this.markerSize - 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _renderNPCMarkers(ctx) {
    ctx.fillStyle = this.npcColor;
    const transform = this._renderTransform;
    for (let index = 0; index < this.npcPositions.length; index++) {
      const pos = this.npcPositions[index];
      const x = transform.offsetX + (pos.x - this._worldMinX) * transform.scaleX;
      const y = transform.offsetY + (pos.y - this._worldMinY) * transform.scaleY;
      if (!this._isMarkerVisible(x, y)) continue;
      ctx.beginPath();
      ctx.arc(x, y, this.markerSize - 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _renderTaskMarkers(ctx) {
    const radius = Math.max(5, this.markerSize + 2);
    for (let index = 0; index < this.taskMarkers.length; index++) {
      const point = this._worldToMinimap(this.taskMarkers[index]);
      if (!point || !this._isMarkerVisible(point.x, point.y)) continue;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = this.taskMarkerColor;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 213, 79, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _roundRect(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  containsPoint(x, y) {
    return x >= this.x && x <= this.x + this.width &&
           y >= this.y && y <= this.y + this.height;
  }

  /**
   * 处理点击事件：点击小地图任意位置，依次切换 3 种缩放级别
   * @param {number} x - 屏幕坐标
   * @param {number} y - 屏幕坐标
   * @returns {boolean} 是否消费了点击
   */
  handleClick(x, y) {
    if (!this.visible || !this.containsPoint(x, y)) return false;
    // 循环切换：0 → 1 → 2 → 0
    this._zoomLevel = (this._zoomLevel + 1) % (this._maxZoomLevel + 1);
    this._updateViewport();
    return true;
  }

}

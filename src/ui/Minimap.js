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
    // 视图形态：固定显示整个 region（比例恒定），旧的窗口裁剪三档缩放已废弃。

    // 点击定位观察：点击小地图把视野框与相机移动到对应世界位置（玩家移动后释放）
    this.onSeekWorldPosition = typeof options.onSeekWorldPosition === 'function'
      ? options.onSeekWorldPosition
      : null;
    this.seekActive = false;
    this.seekPosition = null;
    // 按住拖动定位进行中（松开后仍保持 seekActive 观察态）
    this.seekDragging = false;
    // 定位开始时的玩家位置锚点（SceneHudUpdater 用来判断玩家是否已移动）
    this.seekPlayerAnchor = null;

    // 右上角「M」按钮：点击等同按 M 打开大地图（不触发小地图点击定位）
    this.onOpenWorldMap = typeof options.onOpenWorldMap === 'function'
      ? options.onOpenWorldMap
      : null;
    this.mapButtonSize = options.mapButtonSize || 16;

    // 地形实例列表
    this._terrains = [];
    // 项目世界索引是边界和 chunk 尺寸的唯一来源。
    this._worldIndex = options.worldIndex || null;
    this._regionRef = options.regionRef ?? null;
    // 大地图整图底图（setWorldMapBackground 注入）：九宫格未加载区域/空格子的模糊底色来源
    this._worldMapBackground = null;
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
  }

  /**
   * 绑定 terrain 实例列表（支持9宫格多 chunk）
   * @param {Array<Scene1Terrain>} terrains
   */
  setTerrains(terrains) {
    this._terrains = terrains || [];
    this._invalidateCache();
  }

  /** 注入 ProjectWorldIndex；小地图不直接读取 region 配置。 */
  setWorldIndex(worldIndex, regionRef = null) {
    this._worldIndex = worldIndex || null;
    this._regionRef = regionRef ?? worldIndex?.getEntry?.()?.regionId ?? null;
    this._invalidateCache();
  }

  /**
   * 注入大地图整图底图（src 须为可直接访问的 URL，宿主负责 AssetManager 解析）。
   * 仅支持整图文件模式（与游戏内 M 键大地图同源）；切图目录传 null（维持旧行为）。
   * 底图加载完成后自动触发缩略图缓存重建。
   */
  setWorldMapBackground(background = null) {
    const src = typeof background?.src === 'string' && background.src ? background.src : null;
    if (!src) {
      this._worldMapBackground = null;
      return;
    }
    this._worldMapBackground = { src, _img: null, _loaded: false, _loading: false };
    this._loadWorldMapBackground();
  }

  _loadWorldMapBackground() {
    const bg = this._worldMapBackground;
    if (!bg?.src || bg._loading || typeof Image === 'undefined') return;
    bg._loading = true;
    const img = new Image();
    img.onload = () => {
      bg._img = img;
      bg._loaded = true;
      bg._loading = false;
      this._invalidateCache();
    };
    img.onerror = () => {
      bg._loading = false;
      bg._loadFailed = true;
      console.warn('[WorldMapBase] 小地图底图加载失败', { src: bg.src });
    };
    img.src = bg.src;
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

  /** 结束点击定位观察：小地图窗口回到跟随锚点（由玩家移动等条件触发）。 */
  clearSeek() {
    if (!this.seekActive) return;
    this.seekActive = false;
    this.seekPosition = null;
    this.seekPlayerAnchor = null;
    this._updateViewport();
  }

  /**
   * 开始按住拖动定位（含单击定位）：视野框与相机定位到指针世界位置，
   * 之后按住移动可连续拖动视野，松开后进入观察态（玩家移动后释放回跟随）。
   * @param {number} x - 屏幕坐标
   * @param {number} y - 屏幕坐标
   */
  beginSeekDrag(x, y) {
    const target = this._screenToWorldClamped(x, y);
    if (!target) return;
    this.seekDragging = true;
    this.seekPosition = target;
    this.seekActive = true;
    this.seekPlayerAnchor = this.playerPosition ? { ...this.playerPosition } : null;
    this._updateViewport();
    this.onSeekWorldPosition?.({ ...target });
  }

  /** 按住拖动中：相机与视野框跟随指针连续移动。 */
  moveSeekDrag(x, y) {
    if (!this.seekDragging) return;
    const target = this._screenToWorldClamped(x, y);
    if (!target) return;
    this.seekPosition = target;
    this._updateViewport();
    this.onSeekWorldPosition?.({ ...target });
  }

  /** 结束拖动：保留定位观察态，由 SceneHudUpdater 的玩家移动检测释放回跟随。 */
  endSeekDrag() {
    this.seekDragging = false;
  }

  /** 指针屏幕坐标 → 限界世界坐标；地图未就绪返回 null。 */
  _screenToWorldClamped(x, y) {
    const transform = this._renderTransform;
    if (!this._mapCache || !(transform.scaleX > 0) || !(transform.scaleY > 0)) return null;
    // 指针限制在地图显示窗口内（padding 区域按最近边缘处理）
    const px = Math.min(Math.max(x, transform.clipLeft), transform.clipRight);
    const py = Math.min(Math.max(y, transform.clipTop), transform.clipBottom);
    const worldX = this._worldMinX + (px - transform.offsetX) / transform.scaleX;
    const worldY = this._worldMinY + (py - transform.offsetY) / transform.scaleY;
    return {
      x: Math.min(Math.max(worldX, this._worldMinX), this._worldMaxX),
      y: Math.min(Math.max(worldY, this._worldMinY), this._worldMaxY)
    };
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
    // terrain 静态缓存未就绪时禁止烘焙首帧缩略图：此时 _combinedGroundCache/_bgImageCache
    // 还是空的，会把空白或旧底图写进缓存并标记为已构建。保持脏标记，交给下一次 update() 重试。
    for (const terrain of this._terrains) {
      if (terrain && terrain._staticCachePrepared === false) return;
    }

    const region = this._worldIndex?.getRegion?.(this._regionRef);
    if (!region) return;
    const getTerrainExtent = terrain => ({
      width: Number(terrain?.basinWidth ?? terrain?.worldWidth) || region.chunkWidth,
      height: Number(terrain?.basinHeight ?? terrain?.worldHeight) || region.chunkHeight
    });
    // 缓存固定覆盖整个 region：外框尺寸与内容比例恒定（不随已加载 chunk 数量/视野缩放），
    // 加载新 chunk 只是在固定比例的图上补细节。
    const bounds = region.bounds;
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return;
    const fullMinX = bounds.left;
    const fullMinY = bounds.top;
    const fullMaxX = bounds.right;
    const fullMaxY = bounds.bottom;
    const fullW = bounds.width;
    const fullH = bounds.height;

    const innerW = Math.max(1, this.width - this.padding * 2);
    const innerH = Math.max(1, this.height - this.padding * 2);
    const fitScale = Math.min(innerW / fullW, innerH / fullH);
    // 2 倍超采样提升清晰度（缓存画布仍是小地图级尺寸，内存可忽略）
    let cacheScale = fitScale * 2;
    const maxCacheDimension = 2048;
    cacheScale = Math.min(
      Math.max(cacheScale, Number.EPSILON),
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

    // 大地图整图底图铺底：未加载 chunk / 无场景格子也有对应区块的模糊底色；
    // 已加载 chunk 的场景内容（下方循环）会盖在它上面。
    const worldBg = this._worldMapBackground;
    if (worldBg?._loaded && worldBg._img) {
      try {
        ctx.drawImage(
          worldBg._img,
          0, 0,
          worldBg._img.naturalWidth || worldBg._img.width,
          worldBg._img.naturalHeight || worldBg._img.height,
          bounds.left, bounds.top, bounds.width, bounds.height
        );
      } catch (_error) { /* 底图异常静默，保持旧观感 */ }
    }

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
    if (!region?.bounds) return;
    const bounds = region.bounds;
    const chunkW = region.chunkWidth;
    // 固定比例窗口：宽度锚定 1.5 个 chunk，高度按外框长宽比自动填满。
    // 窗口以观察锚点（定位观察位置或玩家）为中心连续跟随，贴近 region 边界时贴边（尺寸不变）。
    const innerW = Math.max(1, this.width - this.padding * 2);
    const innerH = Math.max(1, this.height - this.padding * 2);
    const spanW = chunkW * 1.5;
    const displayScale = innerW / spanW;
    const spanH = innerH / displayScale;
    const anchor = this.seekActive ? this.seekPosition : this.playerPosition;
    let minX = bounds.left;
    let minY = bounds.top;
    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      minX = anchor.x - spanW / 2;
      minY = anchor.y - spanH / 2;
      minX = Math.min(Math.max(minX, bounds.left), Math.max(bounds.left, bounds.right - spanW));
      minY = Math.min(Math.max(minY, bounds.top), Math.max(bounds.top, bounds.bottom - spanH));
    }
    const maxX = minX + spanW;
    const maxY = minY + spanH;
    const worldW = spanW;
    const worldH = spanH;
    if (worldW <= 0 || worldH <= 0) return;

    this._worldMinX = minX;
    this._worldMinY = minY;
    this._worldMaxX = maxX;
    this._worldMaxY = maxY;
    const displayScaleClamped = Math.min(innerW / worldW, innerH / worldH);
    this._drawW = Math.max(1, Math.floor(worldW * displayScaleClamped));
    this._drawH = Math.max(1, Math.floor(worldH * displayScaleClamped));
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

  /**
   * 更新缩略图与裁剪窗口。
   * 缓存被失效（terrain 集合/世界索引变化）后必须收敛到一次重建，否则区域激活时
   * 建立的旧位图会一直留在屏幕上；缓存干净时 _tryBuildCache 立即返回，不产生重绘开销。
   * @param {number} [deltaTime=0] - 帧间隔 ms
   */
  update(deltaTime = 0) {
    if (this._builtVersion !== this._cacheVersion || !this._mapCache) {
      this._tryBuildCache(deltaTime);
    }
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
    // (已移除；点击小地图改为定位观察)

    // 右上角「M」按钮：打开大地图（点击热区见 handleClick）
    this._renderMapButton(ctx);

    ctx.restore();
  }

  /** 绘制右上角「M」按钮。 */
  _renderMapButton(ctx) {
    const button = this._mapButtonRect();
    ctx.save();
    ctx.fillStyle = 'rgba(20, 15, 10, 0.85)';
    this._roundRect(ctx, button.x, button.y, button.w, button.h, 3);
    ctx.fill();
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    this._roundRect(ctx, button.x, button.y, button.w, button.h, 3);
    ctx.stroke();
    ctx.fillStyle = '#f0d9a8';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', button.x + button.w / 2, button.y + button.h / 2 + 0.5);
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
    // 定位观察中用金色框（与编辑器大地图小地图一致），平时白色
    ctx.strokeStyle = this.seekActive ? 'rgba(246, 231, 168, 0.95)' : 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = this.seekActive ? 2 : 1;
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
    ctx.fillStyle = this.taskMarkerColor;
    for (let index = 0; index < this.taskMarkers.length; index++) {
      const point = this._worldToMinimap(this.taskMarkers[index]);
      if (!point || !this._isMarkerVisible(point.x, point.y)) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, this.markerSize, 0, Math.PI * 2);
      ctx.fill();
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
   * 右上角「M」按钮热区（屏幕坐标）。
   * @returns {{x: number, y: number, w: number, h: number}}
   */
  _mapButtonRect() {
    const size = this.mapButtonSize;
    return {
      x: this.x + this.width - this.padding - size,
      y: this.y + this.padding,
      w: size,
      h: size
    };
  }

  /**
   * 指针是否落在右上角「M」按钮热区内（屏幕坐标）。
   * 拖动定位入口（SceneWorldInteraction.handleMinimapDrag）据此让路，
   * 避免点按钮被当成小地图拖动而吞掉开关动作。
   */
  isMapButtonHit(x, y) {
    if (!this.visible) return false;
    const button = this._mapButtonRect();
    return x >= button.x && x <= button.x + button.w
      && y >= button.y && y <= button.y + button.h;
  }

  /**
   * 处理点击事件：点击小地图把视野框与相机定位到对应世界位置
   *（兼容入口；按住拖动请走 beginSeekDrag/moveSeekDrag/endSeekDrag）。
   * 右上角「M」按钮点击改为打开大地图。
   * @param {number} x - 屏幕坐标
   * @param {number} y - 屏幕坐标
   * @returns {boolean} 是否消费了点击
   */
  handleClick(x, y) {
    if (!this.visible || !this.containsPoint(x, y)) return false;
    // 右上角「M」按钮优先：打开大地图，不进入点击定位
    if (this.isMapButtonHit(x, y)) {
      this.onOpenWorldMap?.();
      return true;
    }
    // 地图未就绪：吞掉点击，避免穿透到世界移动
    if (!this._mapCache) return true;
    this.beginSeekDrag(x, y);
    return true;
  }

}

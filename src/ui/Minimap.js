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

/** 扩展态世界标记：逻辑节点字形（与 M 键大地图 NODE_KIND_GLYPHS 同源语义）。 */
const WORLD_MAP_NODE_GLYPHS = Object.freeze({
  city: '城', pass: '关', bridge: '桥', ferry: '渡', junction: '岔', camp: '营'
});
/** 扩展态世界标记：阵营色。 */
const WORLD_MAP_FACTION_COLORS = Object.freeze({
  yellow_turban: '#d9a521',
  han_government: '#4a6f9a'
});
const worldMapFactionColor = factionId => WORLD_MAP_FACTION_COLORS[factionId] || '#e8d5ab';
/** 扩展态通行边线状态色（与 M 键大地图 ROUTE_EDGE_LINE_COLORS 同源语义）。 */
const WORLD_MAP_EDGE_COLORS = Object.freeze({
  passable: 'rgba(120, 220, 130, 0.55)',
  hostile: 'rgba(226, 96, 80, 0.8)',
  closed: 'rgba(235, 170, 70, 0.8)',
  terrain: 'rgba(150, 145, 135, 0.6)',
  invalid: 'rgba(200, 90, 200, 0.8)'
});

/**
 * 小地图组件（9宫格）
 *
 * 固定比例窗口（宽度锚定 1.5 格）：底图铺大地图整图，已加载 chunk 叠加场景细节；
 * 单击切换扩展中间态（右上角 3/5 屏宽、4×4 格视野），扩展态按大地图的内容显示
 * 逻辑节点（城/关/桥/渡/岔/营）与军团旗。定位观察拖拽已取消——小地图纯展示。
 *
 * 使用方式：
 *   minimap.setTerrains(terrainArray)  — 绑定所有 terrain 实例
 *   minimap.setPlayerPosition(pos)     — 每帧更新玩家位置
 *   minimap.setViewBounds(bounds)      — 每帧更新相机视野
 *   minimap.setWorldMapProviders({...}) — 扩展态世界标记数据源（惰性）
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
    // 视图形态：固定比例窗口（宽度锚定 1.5 格），左下角箭头按钮切换扩展中间态
    //（右上角 2/5 屏宽、3×5 格视野）。框内其余点击只吞不响应（纯展示）。
    this.expanded = false;
    this.toggleButtonSize = options.toggleButtonSize || 20;
    this._normalRect = null;
    this._logicalWidth = options.logicalWidth || null;

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
    // 扩展态世界标记数据源（惰性，与 M 键大地图同源）：逻辑节点 / 军团状态 / 通行边线 / 场景锚点
    this._worldMapProviders = { getLogicNodes: null, getArmyStates: null, getRouteEdges: null, getSceneAnchors: null, getCurrentSceneId: null };
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
   * 注入扩展态世界标记数据源（惰性，与 M 键大地图同源同形状）：
   * - getLogicNodes: () => worldRouteLayer.nodes.values()（position/kind/ownerFactionId/name）
   * - getArmyStates: () => armyOrderSystem.listUnits()（x/y/factionId/name/id/route）
   * - getRouteEdges: () => 路线预览的边线列表（fromPosition/toPosition/status，通行状态由配置线条表达）
   * - getSceneAnchors: () => region.cells（loadable 场景锚点：sceneId/offset/worldWidth/worldHeight）
   * - getCurrentSceneId: () => 当前所在场景 id（锚点高亮用）
   */
  setWorldMapProviders(providers = {}) {
    const next = providers || {};
    const fn = value => (typeof value === 'function' ? value : null);
    this._worldMapProviders = {
      getLogicNodes: fn(next.getLogicNodes),
      getArmyStates: fn(next.getArmyStates),
      getRouteEdges: fn(next.getRouteEdges),
      getSceneAnchors: fn(next.getSceneAnchors),
      getCurrentSceneId: fn(next.getCurrentSceneId)
    };
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

  /** 逻辑分辨率宽度（扩展态尺寸计算用；宿主创建与 resize 时更新）。 */
  setLogicalWidth(width) {
    this._logicalWidth = Number(width) || this._logicalWidth;
  }

  /**
   * 单击切换扩展中间态：
   * - 扩展：外框占右上角 2/5 屏宽（不挡玩家操作区），视野 3×5 格（宽 3 格 × 高 5 格，
   *   高按 chunk 纵横比推算）；内容按大地图的显示内容来（逻辑节点/军团旗）；
   * - 缩回：恢复原来的小框（宽度锚定 1.5 格）。
   * 切换时结束定位观察，回到跟随锚点；缓存按整 region 构建，切换零重建成本。
   */
  toggleExpanded() {
    this.expanded = !this.expanded;
    if (this.expanded) {
      if (!this._normalRect) {
        this._normalRect = { x: this.x, y: this.y, width: this.width, height: this.height };
      }
      const logicalWidth = this._logicalWidth || 1280;
      const margin = 10;
      const width = Math.max(200, Math.round(logicalWidth * 2 / 5) - margin);
      // 高度按 3×5 格的 chunk 纵横比推算（chunkH×5 / chunkW×3）
      const region = this._worldIndex?.getRegion?.(this._regionRef);
      const chunkAspect = region ? region.chunkHeight / region.chunkWidth : 720 / 1280;
      this.width = width;
      this.height = Math.max(160, Math.round(width * (chunkAspect * 5 / 3)));
      this.x = logicalWidth - width - margin;
      this.y = margin;
    } else if (this._normalRect) {
      this.x = this._normalRect.x;
      this.y = this._normalRect.y;
      this.width = this._normalRect.width;
      this.height = this._normalRect.height;
    }
    // 定位观察状态作废：回到跟随锚点
    this.seekActive = false;
    this.seekPosition = null;
    this.seekPlayerAnchor = null;
    this.seekDragging = false;
    this._updateViewport();
  }

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
    const chunkH = region.chunkHeight;
    // 固定比例窗口：
    // - 常态：宽度锚定 1.5 个 chunk，高度按外框长宽比自动填满；
    // - 扩展态（双击）：4×4 格视野，外框占右上角 3/5 屏宽。
    // 窗口以观察锚点（定位观察位置或玩家）为中心连续跟随，贴近 region 边界时贴边（尺寸不变）。
    const innerW = Math.max(1, this.width - this.padding * 2);
    const innerH = Math.max(1, this.height - this.padding * 2);
    const spanW = this.expanded ? chunkW * 3 : chunkW * 1.5;
    const displayScale = innerW / spanW;
    const spanH = this.expanded ? chunkH * 5 : innerH / displayScale;
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

      // 扩展态：按大地图的内容显示世界标记（逻辑节点 城/关/桥/渡/岔/营 + 军团旗）
      if (this.expanded) this._renderWorldMapEntities(ctx);

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
    // 左下角扩展/缩回按钮（箭头方向随状态）
    this._renderToggleButton(ctx);

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

  /**
   * 扩展态世界标记（= 被框住的大地图）：通行边线（配置线条）→
   * 逻辑节点（城/关/桥/渡/岔/营，阵营色描边+字形）→ 军团旗。
   * 数据由 setWorldMapProviders 惰性注入（与 M 键大地图同源同形状）；
   * 绘制尺寸用固定屏幕像素（不随小地图比例缩放），保证可读可点。
   */
  _renderWorldMapEntities(ctx) {
    const providers = this._worldMapProviders || {};
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 通行边线：编辑器配置的路线（虚线，状态色与 M 键大地图一致）
    const edges = providers.getRouteEdges?.() || [];
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    for (const edge of edges) {
      const from = edge?.fromPosition;
      const to = edge?.toPosition;
      if (!from || !to) continue;
      const a = this._worldToMinimap(from);
      const b = this._worldToMinimap(to);
      if (!a || !b) continue;
      if (!this._isMarkerVisible(a.x, a.y) && !this._isMarkerVisible(b.x, b.y)) continue;
      ctx.strokeStyle = WORLD_MAP_EDGE_COLORS[edge.status] || 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 场景锚点：小圆点 + sceneId 标签（当前场景金色高亮，与 M 键大地图一致）
    const anchors = providers.getSceneAnchors?.() || [];
    const currentSceneId = providers.getCurrentSceneId?.() || null;
    ctx.font = '11px system-ui, sans-serif';
    for (const anchor of anchors) {
      const center = this._worldToMinimap({
        x: anchor.offset.x + anchor.worldWidth / 2,
        y: anchor.offset.y + anchor.worldHeight / 2
      });
      if (!center || !this._isMarkerVisible(center.x, center.y)) continue;
      const isCurrent = anchor.sceneId === currentSceneId;
      ctx.fillStyle = isCurrent ? '#ffe9b0' : 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(anchor.sceneId, center.x, center.y + 16);
    }

    // 逻辑节点：深底方块 + 阵营色描边 + 字形（坐标在 node.position，阵营在 ownerFactionId）
    const nodes = providers.getLogicNodes?.() || [];
    ctx.font = '9px system-ui, "Microsoft YaHei", sans-serif';
    for (const node of nodes) {
      const pos = this._worldToMinimap({
        x: node.position?.x ?? node.x,
        y: node.position?.y ?? node.y
      });
      if (!pos || !this._isMarkerVisible(pos.x, pos.y)) continue;
      const color = worldMapFactionColor(node.ownerFactionId || node.factionId);
      ctx.fillStyle = 'rgba(20, 16, 12, 0.85)';
      ctx.fillRect(pos.x - 6, pos.y - 6, 12, 12);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(pos.x - 6, pos.y - 6, 12, 12);
      ctx.fillStyle = color;
      ctx.fillText(WORLD_MAP_NODE_GLYPHS[node.kind] || '·', pos.x, pos.y + 0.5);
    }

    // 军团旗与行军路线：虚线路线 + 终点圈 + 旗杆三角旗（阵营色），与 M 键大地图一致
    const armies = providers.getArmyStates?.() || [];
    ctx.lineWidth = 1.5;
    for (const army of armies) {
      const pos = this._worldToMinimap(army);
      const routeVisible = pos && this._isMarkerVisible(pos.x, pos.y);
      // 行军路线：虚线折线 + 终点圈（点为世界坐标）
      const route = army.route;
      const routePoints = Array.isArray(route?.points) ? route.points : [];
      if (routePoints.length > 1) {
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = pos && this._selected === army
          ? '#ffe9b0'
          : 'rgba(240, 217, 168, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let first = true;
        let lastScreen = null;
        for (const point of routePoints) {
          const p = this._worldToMinimap(point);
          if (!p) continue;
          if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
          lastScreen = p;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (lastScreen) {
          ctx.strokeStyle = '#ffe9b0';
          ctx.beginPath();
          ctx.arc(lastScreen.x, lastScreen.y, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (!routeVisible) continue;
      const color = worldMapFactionColor(army.factionId);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y + 2);
      ctx.lineTo(pos.x, pos.y - 12);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y - 12);
      ctx.lineTo(pos.x + 9, pos.y - 9);
      ctx.lineTo(pos.x, pos.y - 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

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
   * 处理点击事件（兼容入口）：右上角「M」按钮打开大地图；
   * 左下角箭头按钮切换扩展中间态；框内其余区域只吞不响应（小地图纯展示）。
   * @param {number} x - 屏幕坐标
   * @param {number} y - 屏幕坐标
   * @returns {boolean} 是否消费了点击
   */
  handleClick(x, y) {
    if (!this.visible || !this.containsPoint(x, y)) return false;
    // 右上角「M」按钮优先：打开大地图
    if (this.isMapButtonHit(x, y)) {
      this.onOpenWorldMap?.();
      return true;
    }
    // 左下角箭头按钮：切换扩展中间态
    if (this.isToggleHit(x, y)) {
      this.toggleExpanded();
      return true;
    }
    // 框内其余区域：吞掉点击（避免穿透到世界移动），不响应
    return true;
  }

  /** 按下候选（按下沿调用）：仅作「按住中持续吞输入」的标记，不触发任何行为。 */
  beginPressCandidate(x, y) {
    this._press = { x, y };
  }

  /**
   * 左下角扩展/缩回按钮热区（屏幕坐标）。
   * @returns {{x: number, y: number, w: number, h: number}}
   */
  _toggleButtonRect() {
    const size = this.toggleButtonSize;
    return {
      x: this.x + this.padding,
      y: this.y + this.height - this.padding - size,
      w: size,
      h: size
    };
  }

  /** 指针是否落在左下角扩展/缩回按钮热区内（屏幕坐标）。 */
  isToggleHit(x, y) {
    if (!this.visible) return false;
    const button = this._toggleButtonRect();
    return x >= button.x && x <= button.x + button.w
      && y >= button.y && y <= button.y + button.h;
  }

  /** 绘制左下角扩展/缩回按钮：箭头方向随状态（常态 ↘ 扩展 / 中地图 ↖ 缩回）。 */
  _renderToggleButton(ctx) {
    const button = this._toggleButtonRect();
    ctx.save();
    ctx.fillStyle = 'rgba(20, 15, 10, 0.85)';
    this._roundRect(ctx, button.x, button.y, button.w, button.h, 3);
    ctx.fill();
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    this._roundRect(ctx, button.x, button.y, button.w, button.h, 3);
    ctx.stroke();
    ctx.fillStyle = '#f0d9a8';
    ctx.font = `bold ${Math.round(button.h * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 小地图 → 箭头朝左下（框向左下扩展成中地图）；中地图 → 箭头朝右上（缩回右上小框）
    ctx.fillText(this.expanded ? '↗' : '↙', button.x + button.w / 2, button.y + button.h / 2 + 0.5);
    ctx.restore();
  }

}

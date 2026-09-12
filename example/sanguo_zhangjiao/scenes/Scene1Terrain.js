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

import { ShapeRenderer } from '../../../src/rendering/ShapeRenderer.js';
import { SceneObjectProjector } from '../../../src/core/scene/SceneObjectProjector.js';
import { AtlasRegistry } from '../../../src/core/scene/AtlasRegistry.js';

/**
 * Scene1Terrain - 第一幕盆地地形系统
 * 
 * 提供：
 * - 草地底层平铺（盆地内）
 * - 水池、溪水
 * - 高地/悬崖图层（围成盆地，南侧留入口）
 * - 树木、灌木、石头等装饰物（参与 Y 排序）
 * - 悬崖/水池的不可通行区域碰撞检测
 * 
 * 资源：
 * - assets/images/scene1/terrain_grass_water.png  256x256 (4x4 个 64px 小块)
 * - assets/images/scene1/cliff_grass.png          384x288 LPC 悬崖图集
 * - assets/images/scene1/tree_willow.png          128x128
 * - assets/images/scene1/tree_oak.png             128x128
 * - assets/images/scene1/tree_pine.png            128x128
 * - assets/images/scene1/tree_dead.png            128x97
 * - assets/images/scene1/bush_1.png               64x64
 * - assets/images/scene1/bush_2.png               64x64
 * - assets/images/scene1/grass_tuft.png           64x64
 */

export class Scene1Terrain {
  /**
   * @param {Object} config
   * @param {number} config.centerX - 盆地中心 X（与火堆同 X，350）
   * @param {number} config.centerY - 盆地中心 Y（与火堆同 Y，250）
   * @param {number} config.width   - 盆地宽度（约一屏，1280）
   * @param {number} config.height  - 盆地高度（约一屏，720）
   * @param {{x:number,y:number}} [config.worldOffset] - chunk 在世界中的偏移量
   */
  constructor(config = {}) {
    const sceneData = config.sceneData;
    const editorSceneId = config.editorSceneId || sceneData?.id;
    if (!editorSceneId || !sceneData || !Array.isArray(sceneData.layers)) {
      throw new TypeError('Scene1Terrain requires canonical editorSceneId and sceneData.layers');
    }

    // 世界偏移量（大地图 chunk 原点）
    this.worldOffset = config.worldOffset || { x: 0, y: 0 };
    this._sceneObjectProjector = config.projector || new SceneObjectProjector();
    this.resolveImageAsset = typeof config.resolveImageAsset === 'function'
      ? config.resolveImageAsset
      : () => null;
    this.getLoadedImage = typeof config.getLoadedImage === 'function'
      ? config.getLoadedImage
      : () => null;
    this._sharedAtlases = Array.isArray(config.sharedAtlases) ? config.sharedAtlases : [];
    this._atlasRegistry = new AtlasRegistry(this._sharedAtlases, sceneData.atlases || []);
    this._cacheLifecycleToken = 0;
    this._staticCacheRevision = 0;
    this._staticCachePrepared = false;
    this._released = false;
    this._belowDecoCache = null;
    this._belowDecoCacheX = 0;
    this._belowDecoCacheY = 0;

    // 盆地中心 = 火堆位置
    this.centerX = config.centerX ?? 350;
    this.centerY = config.centerY ?? 250;

    // 盆地（草地区域）尺寸：约一屏
    this.basinWidth = config.width ?? 1280;
    this.basinHeight = config.height ?? 720;

    // 盆地世界坐标边界（草地内圈，用于渲染草地铺面的范围）
    this.basinLeft   = this.centerX - this.basinWidth  / 2;
    this.basinRight  = this.centerX + this.basinWidth  / 2;
    this.basinTop    = this.centerY - this.basinHeight / 2;
    this.basinBottom = this.centerY + this.basinHeight / 2;

    // === 椭圆盆地（2.5D 视角压扁）===
    this.basinRadius = config.radius ?? 640;          // 基础半径（X 方向）
    this.basinAspectY = config.aspectY ?? 0.65;       // Y 压缩比
    this.basinRadiusX = this.basinRadius;
    this.basinRadiusY = this.basinRadius * this.basinAspectY;
    // 入口角度区间：南向（+Y 方向）±9° 留缺口（窄入口）
    this.entranceAngleHalfWidth = Math.PI * 9 / 180;
    // 内圈（玩家可走范围比树圈略小）
    this.basinInnerScale = 0.94;
    this.basinInnerRadiusX = this.basinRadiusX * this.basinInnerScale;
    this.basinInnerRadiusY = this.basinRadiusY * this.basinInnerScale;

    // 兼容字段
    this.basinInnerRadius = this.basinInnerRadiusX;
    this.cliffThickness = 0;
    this.entranceWidth = 0;
    this.entranceCenterX = this.centerX;

    // === 资源与共享图集投影 ===
    this.images = {
      mountain: null,
      terrain: null
    };
    this.loaded = {
      mountain: false,
      terrain: false
    };
    this.terrainTile = 64;

    // 水/沙为独立备用图块；mountain_landscape 的 9 个切片只从共享 registry 派生。
    this.tileWater = { sx: 0, sy: 0, sw: 32, sh: 32 };
    this.tileSand = { sx: 0, sy: 64, sw: 32, sh: 32 };

    const sharedMountainAtlas = this._atlasRegistry.getAtlas('mountain_landscape');
    if (!sharedMountainAtlas?.slices) {
      throw new TypeError('Scene1Terrain requires shared atlas: mountain_landscape');
    }
    const sharedGrassTile = sharedMountainAtlas.slices.grassTile;
    if (!sharedGrassTile) {
      throw new TypeError('Scene1Terrain requires shared slice: mountain_landscape/grassTile');
    }
    this.decoSprites = Object.fromEntries(
      Object.entries(sharedMountainAtlas.slices).map(([sliceKey, slice]) => [
        sliceKey,
        { scale: 1.0, ...slice }
      ])
    );
    this.grassTile = {
      sx: sharedGrassTile.sx,
      sy: sharedGrassTile.sy,
      sw: sharedGrassTile.sw,
      sh: sharedGrassTile.sh
    };

    const mountainAssetId = sharedMountainAtlas.assetId || sharedMountainAtlas.id;
    const mountainImage = this.getLoadedImage(mountainAssetId);
    if (mountainImage) {
      this.images.mountain = mountainImage;
      this.loaded.mountain = true;
    }
    // 树木分类
    this.outerTreeKeys = ['tree1', 'tree2', 'tree3'];   // 外围森林（含 tree1）
    this.innerTreeKeys = ['tree2', 'tree3'];            // 盆地内（不含 tree1）
    // 灌木丛（盆地内随机分布）
    this.bushKeys = ['bush2', 'bush3', 'bush4'];
    // 草地装饰（用在树圈内外缘）
    this.grassKeys = ['grass1'];

    // OGAtilesetsremixed.png 960x960，32px 网格 30x30
    // 用作悬崖图集（这个是顶视角悬崖/岩石的混合素材）
    // 颜色 [75,105,47] = 深绿草地，[224,174,84] = 沙土路
    // 我们直接用 9-slice 拼装，但实际素材风格不一定整齐，按经验取
    this.cliffTile = 32;
    // 悬崖的"石头墙体"片段 —— 用 OGA 内深棕岩石纹（如果存在）；
    // 否则退化为色块。这里先用一个保守方案：
    //   topMid/midMid/bottomMid 等都用同一个深棕岩石格
    //   左右上下角用对应方向的格子
    // 由于不能保证 OGA 准确布局，最终用程序绘制岩石纹路（fallback 升级版）
    this.cliffSlice = {
      topLeft:     { sx: 0,       sy: 0,         sw: 32, sh: 32 },
      topMid:      { sx: 32,      sy: 0,         sw: 32, sh: 32 },
      topRight:    { sx: 32 * 2,  sy: 0,         sw: 32, sh: 32 },
      midLeft:     { sx: 0,       sy: 32,        sw: 32, sh: 32 },
      midMid:      { sx: 32,      sy: 32,        sw: 32, sh: 32 },
      midRight:    { sx: 32 * 2,  sy: 32,        sw: 32, sh: 32 },
      bottomLeft:  { sx: 0,       sy: 32 * 2,    sw: 32, sh: 32 },
      bottomMid:   { sx: 32,      sy: 32 * 2,    sw: 32, sh: 32 },
      bottomRight: { sx: 32 * 2,  sy: 32 * 2,    sw: 32, sh: 32 }
    };

    // === 装饰物列表（每项一个对象，参与 Y-sort） ===
    this.decorations = [];
    // 水体（水池/溪水），用于碰撞与底层渲染
    this.waterPatches = [];

    // 离屏 canvas（草地铺面缓存，避免每帧重绘）
    this._grassCanvas = null;
    // 离屏 canvas（悬崖+装饰组成的高地遮罩，仅缓存悬崖底纹本身）
    this._cliffCanvas = null;

    // 地形椭圆数据（数据驱动草地渲染，来自编辑器椭圆对象或 terrain 默认）
    // { cx, cy, rx, ry, fillMode, fill, opacity, edgeFade, imageMode, sliceMode, imageSrc, _img, _slice }
    this._terrainEllipse = null;

    // 编辑器中标记 collide 的 shape（多边形/矩形/椭圆碰撞区）
    this._collisionShapes = [];

    // 编辑器中的可渲染 shape（多边形/矩形/圆等，非地形椭圆），用 ShapeRenderer 绘制
    this._editorShapes = [];
    this._shapeImages = new Map();  // shape 图片填充的图片缓存（key=imageSrc）
    // 普通 image 固定在地面层；显式 depthSort 的 image 与实体共用 Y-sort 队列。
    this._editorBackgroundImages = [];
    this._depthSortedImages = [];

    this._buildWaterPatches();
    this._buildDecorations();
    // Terrain 只消费世界会话已经加载并验证的 canonical 数据，不自行读取文件或缓存。
    this._editorSceneId = editorSceneId;
    console.log('[Scene1Terrain][Collision] 开始应用 canonical 场景数据', {
      sceneId: editorSceneId,
      worldOffset: { ...this.worldOffset },
      initialCollisionShapes: this._collisionShapes.length,
      source: 'world-load-session'
    });
    this._applySceneData(sceneData);
    console.log('[Scene1Terrain][Collision] 已应用 canonical 场景数据', {
      sceneId: editorSceneId,
      layerCount: sceneData.layers.length,
      collisionShapeCount: this._collisionShapes.length,
      worldOffset: { ...this.worldOffset },
      collisionShapes: this._collisionShapes.map(shape => ({
        id: shape.id || null,
        shapeType: shape.shapeType,
        points: shape.points?.length || 0,
        x: shape.x,
        y: shape.y
      }))
    });
  }

  /**
   * 应用世界会话已加载并验证的 canonical 场景数据。
   * @param {Object} scene - canonical 场景对象
   * @private
   */
  _applySceneData(scene) {
    if (!scene) return;

    // 读取场景背景色
    if (scene.backgroundColor) {
      this.sceneBackgroundColor = scene.backgroundColor;
    }

    // 保存场景原始数据引用（供外部系统如小地图使用）
    this._sceneDataRaw = scene;

    // 打印 canonical 碰撞 shape 原始局部坐标，诊断是否在投影前被错误提前偏移。
    if (Array.isArray(scene.layers)) {
      for (const layer of scene.layers) {
        if (!layer || !Array.isArray(layer.objects)) continue;
        for (const obj of layer.objects) {
          if (obj && obj.type === 'shape' && obj.collide && obj.points) {
            console.log('[Scene1Terrain] _applySceneData 收到碰撞 shape 原始坐标', {
              sceneId: this._editorSceneId,
              shapeId: obj.id,
              worldOffset: { ...this.worldOffset },
              firstPoint: obj.points[0],
              alreadyApplied: !!this._worldOffsetApplied
            });
            break; // 只打印第一个就够了
          }
        }
      }
    }

    // 共享 atlas 是切片坐标与碰撞属性的唯一事实源；场景正文不得覆盖它。

    // 2. 从图层中收集装饰物
    const decorations = [];

    // layer_deco 中的对象：
    //   - type:'deco'：新版统一装饰物 {decoKey, x, y, width, height}（左上角锚点）
    //   - type:'slice' + decoKey：切片型装饰物 {decoKey, x, y, width, height}（左上角锚点）
    // 统计编辑器中定义的装饰物总数（含隐藏图层），用于区分
    // “编辑器有装饰数据但被隐藏” 与 “根本没有编辑器装饰数据”
    let totalDecoDefined = 0;
    if (Array.isArray(scene.layers)) {
      for (const layer of scene.layers) {
        if (!layer || !Array.isArray(layer.objects)) continue;
        const layerHidden = layer.visible === false;
        for (const obj of layer.objects) {
          if (!obj) continue;
          
          let key = null;
          if (obj.type === 'deco') {
            key = obj.decoKey || obj.name;
          } else if (obj.type === 'slice') {
            key = obj.decoKey || obj.sliceKey;
          } else {
            continue;
          }
          
          if (!key || !this.decoSprites[key]) continue;
          totalDecoDefined++;
          // 图层隐藏时（编辑器中设为不可见）不加入渲染列表
          if (layerHidden) continue;
          const sprite = this.decoSprites[key];
          const w = obj.width || sprite.sw;
          const h = obj.height || sprite.sh;
          const anchor = this._sceneObjectProjector.project({
            x: obj.x + w / 2,
            y: obj.y + h
          }, this.worldOffset);
          decorations.push({
            x: Math.round(anchor.x),
            y: Math.round(anchor.y),
            key,
            w, h,
            scale: w / sprite.sw
          });
        }
      }
    }

    // 场景来自编辑器（有 layers 数据）时，一律以编辑器装饰数据为准：
    //   - 有装饰（含全部隐藏）→ 用编辑器数据
    //   - 装饰层为空 → 清空程序化默认树木（编辑器没放就是没有，不该出现森林）
    // 只有「完全没有编辑器 layers 数据」的场景才保留程序化生成的默认装饰物。
    if (Array.isArray(scene.layers) && scene.layers.length > 0) {
      this.decorations = decorations;
      this._treeColliders = null; // 重置碰撞缓存，下次按新装饰物重建
      // 标记：使用编辑器保存的顺序（深度），不再 Y-sort
      this._useEditorOrder = true;
      console.log('Scene1Terrain: 已应用编辑器场景数据，装饰物数量 =', decorations.length, '（定义总数 =', totalDecoDefined, '）');
    }
    
    // 3. 读取图层中的图片对象：普通 image/fill 留在地面层，显式 depthSort 的 image 进入实体 Y-sort。
    // 同时读取 type:'ellipse' 对象更新盆地椭圆参数
    this._editorBackgroundImages = [];
    this._depthSortedImages = [];
    this._bgImageCache = null;
    this._collisionShapes = [];
    this._walkableShapes = [];  // walkable 可落脚区域：内部即使有碰撞区也不阻塞
    this._editorShapes = [];
    this._atlasRegistry.setSources(this._sharedAtlases, scene.atlases || []);
    let foundEllipse = false;
    if (Array.isArray(scene.layers)) {
      for (const layer of scene.layers) {
        if (!layer || !Array.isArray(layer.objects)) continue;
        const layerHidden = layer.visible === false;
        for (const obj of layer.objects) {
          if (!obj) continue;
          const projectedObj = this._sceneObjectProjector.project(obj, this.worldOffset);
          // walkable 优先于 collide；所有业务碰撞与表现共用同一投影入口。
          if (obj.type === 'shape' && obj.walkable) {
            this._walkableShapes.push(projectedObj);
          } else if (obj.type === 'shape' && obj.collide) {
            this._collisionShapes.push(projectedObj);
          }
          // 图层隐藏时跳过视觉渲染相关的收集
          // 碰撞/可落脚 shape 也不重复放入 _editorShapes（避免 worldOffset 双重偏移）
          if (layerHidden || (obj.type === 'shape' && (obj.collide || obj.walkable))) continue;
          const _isEllipse = obj.type === 'ellipse' ||
                             (obj.type === 'shape' && obj.shapeType === 'ellipse');
          // 第一个椭圆作为地形椭圆；其余 shape（多边形/矩形/圆/额外椭圆）作为可渲染 shape
          if (_isEllipse && !foundEllipse) {
            // 从椭圆对象更新盆地参数
            foundEllipse = true;
            const cx = obj.x + obj.width / 2;
            const cy = obj.y + obj.height / 2;
            const rx = obj.width / 2;
            const ry = obj.height / 2;
            this.centerX = cx;
            this.centerY = cy + 32; // 编辑器中 centerY 偏移了 -32
            this.basinRadiusX = rx - 20;
            this.basinRadiusY = ry - 20;
            this.basinRadius = this.basinRadiusX;
            this.basinAspectY = this.basinRadiusY / this.basinRadiusX;
            this.basinInnerRadiusX = this.basinRadiusX * this.basinInnerScale;
            this.basinInnerRadiusY = this.basinRadiusY * this.basinInnerScale;
            this.basinInnerRadius = this.basinInnerRadiusX;
            // 构建数据驱动的地形椭圆（填充图片/切片/纯色 + 边缘淡化）
            this._terrainEllipse = this._buildTerrainEllipseFromObject(obj, cx, cy, rx, ry);
            this._grassCanvas = null;          // 重建草地缓存
            this._combinedGroundCache = null;  // 重建合并缓存
            console.log('Scene1Terrain: 应用编辑器椭圆', { cx, cy, rx, ry, fillMode: this._terrainEllipse.fillMode });
          } else if (obj.type === 'shape') {
            // 其它 shape 使用与碰撞相同的世界投影结果。
            this._editorShapes.push(projectedObj);
          } else if (obj.type === 'image' && obj.imageId) {
            // 运行时图片只认 Manifest 的稳定 ID；场景本地 src 仅为未迁移编辑器数据的兼容后备。
            const sceneAsset = scene.imageAssets && scene.imageAssets[obj.imageId];
            const manifestAsset = this.resolveImageAsset(obj.imageId);
            const manifestSrc = manifestAsset?.url || null;
            let src = manifestSrc || sceneAsset?.src || null;
            if (src) {
              // 仅旧场景后备路径需从编辑器相对地址归一化，Manifest URL 已可直接加载。
              if (!manifestSrc && sceneAsset?.src) {
                const assetsIdx = src.indexOf('assets/');
                if (assetsIdx !== -1) src = src.substring(assetsIdx);
              }
              const imageEntry = {
                id: obj.id || null,
                imageId: obj.imageId,
                src,
                x: projectedObj.x,
                y: projectedObj.y,
                width: obj.width,
                height: obj.height,
                rotation: Number.isFinite(obj.rotation) ? obj.rotation : 0,
                opacity: obj.opacity,
                layerId: layer.id,
                sortY: Number.isFinite(projectedObj.sortY)
                  ? projectedObj.sortY
                  : projectedObj.y + projectedObj.height,
                _img: null,
                _loaded: false
              };
              if (obj.depthSort === true || obj.ySort === true) {
                this._depthSortedImages.push(imageEntry);
              } else {
                this._editorBackgroundImages.push(imageEntry);
              }
            }
          } else if (obj.type === 'fill' && obj.fillMode === 'image' && obj.imageSrc) {
            this._editorBackgroundImages.push({
              src: obj.imageSrc,
              x: projectedObj.x || 0,
              y: projectedObj.y || 0,
              width: obj.width || this.basinWidth,
              height: obj.height || this.basinHeight,
              imageMode: obj.imageMode || 'stretch',
              opacity: obj.opacity,
              layerId: layer.id,
              _img: null,
              _loaded: false
            });
          }
        }
      }
      // 同一加载链处理地面图片与深度图片；优先复用九宫格 prepare 已加载的 AssetManager 图片。
      for (const sceneImage of [...this._editorBackgroundImages, ...this._depthSortedImages]) {
        const loadedImage = sceneImage.imageId ? this.getLoadedImage(sceneImage.imageId) : null;
        if (loadedImage) {
          sceneImage._img = loadedImage;
          sceneImage._loaded = true;
          continue;
        }
        if (sceneImage.imageId) {
          console.warn(`Scene1Terrain: 九宫格 prepare 后仍缺少稳定图片 ${sceneImage.imageId}`);
          continue;
        }
        const img = new Image();
        const lifecycleToken = this._cacheLifecycleToken;
        img.onload = () => {
          if (this._released || lifecycleToken !== this._cacheLifecycleToken) return;
          sceneImage._img = img;
          sceneImage._loaded = true;
        };
        img.src = sceneImage.src;
      }

      // 预加载需要图片填充的可视 shape；walkable 与碰撞逻辑共享投影，不能再作坐标换算。
      for (const shapes of [this._editorShapes, this._walkableShapes]) {
        for (const sh of shapes) {
          if (sh.fillMode !== 'image' || !sh.imageSrc || this._shapeImages.has(sh.imageSrc)) continue;
          let src = sh.imageSrc;
          const idx = src.indexOf('assets/');
          if (idx !== -1) src = src.substring(idx);
          const img = new Image();
          img.onload = () => { this._combinedGroundCache = null; };
          img.src = src;
          this._shapeImages.set(sh.imageSrc, img);
        }
      }

      // 编辑器数据中若不存在地形椭圆，则不渲染草地/森林环带
      // （用户在场景编辑器里删除了椭圆）
      this._hasTerrainEllipse = foundEllipse;
      if (!foundEllipse) this._terrainEllipse = null;
      // 椭圆增删会改变地面外观，清除合并缓存强制重建
      this._combinedGroundCache = null;
      this._grassCanvas = null;
    }

    // === 应用 worldOffset：把所有解析出的坐标从场景局部坐标转为世界坐标 ===
    const ox = this.worldOffset.x;
    const oy = this.worldOffset.y;
    if ((ox !== 0 || oy !== 0) && !this._worldOffsetApplied) {
      this._worldOffsetApplied = true;
      // 盆地中心
      this.centerX += ox;
      this.centerY += oy;
      this.basinLeft += ox;
      this.basinRight += ox;
      this.basinTop += oy;
      this.basinBottom += oy;
      this.entranceCenterX = this.centerX;

      // 只有没有场景图层时，程序化默认装饰才在此转换；场景对象已由 projector 投影。
      if (!Array.isArray(scene.layers) || scene.layers.length === 0) {
        for (const d of this.decorations) {
          d.x += ox;
          d.y += oy;
        }
      }
      this._treeColliders = null;

      // 水池属于 terrain 参数派生数据，随 terrain 原点转换。
      for (const p of this.waterPatches) {
        p.x += ox;
        p.y += oy;
      }

      // image、碰撞、walkable 与普通 shape 均已由 SceneObjectProjector 恰好投影一次。

      // 地形椭圆
      if (this._terrainEllipse) {
        this._terrainEllipse.cx += ox;
        this._terrainEllipse.cy += oy;
      }

      this._combinedGroundCache = null;
      this._grassCanvas = null;
    }
  }

  /**
   * 从编辑器椭圆对象构建地形椭圆渲染数据
   * @private
   */
  _buildTerrainEllipseFromObject(obj, cx, cy, rx, ry) {
    const fillMode = obj.fillMode || 'color';

    // 解析切片坐标（slice 模式）
    let sliceRect = null;
    if (fillMode === 'slice') {
      if (obj.decoKey) {
        const atlas = this._atlasRegistry.findAtlasBySliceKey(obj.decoKey);
        const slice = atlas?.slices?.[obj.decoKey];
        if (slice) {
          sliceRect = {
            atlasId: atlas.id,
            sx: slice.sx,
            sy: slice.sy,
            sw: slice.sw,
            sh: slice.sh
          };
        }
      } else if (obj.atlasId && obj.sliceKey) {
        const slice = this._atlasRegistry.getSlice(obj.atlasId, obj.sliceKey);
        if (slice) {
          sliceRect = {
            atlasId: obj.atlasId,
            sx: slice.sx,
            sy: slice.sy,
            sw: slice.sw,
            sh: slice.sh
          };
        }
      }
    }

    // 加载图片（image 模式）
    let imgEl = null;
    let imgSrc = null;
    if (fillMode === 'image' && obj.imageSrc) {
      imgSrc = obj.imageSrc;
      const idx = imgSrc.indexOf('assets/');
      if (idx !== -1) imgSrc = imgSrc.substring(idx);
      imgEl = new Image();
      imgEl.src = imgSrc;
    }

    return {
      cx, cy, rx, ry,
      fillMode,
      fill: obj.fill || obj.fillColor || '#3a5a2a',
      opacity: obj.opacity !== undefined ? obj.opacity : 1,
      edgeFade: Math.max(0, Math.min(1, obj.edgeFade || 0)),
      imageMode: obj.imageMode || 'cover',
      sliceMode: obj.sliceMode || 'tile',
      imageSrc: imgSrc,
      _img: imgEl,
      _slice: sliceRect
    };
  }

  /**
   * 确保存在地形椭圆渲染数据。
   * 若场景未提供椭圆对象（旧数据/未编辑），用 terrain 配置生成默认椭圆
   * （草地切片平铺 + 边缘淡化，替代旧的写死森林环带）。
   * @private
   */
  _ensureTerrainEllipseData() {
    if (this._terrainEllipse) return;
    if (this._hasTerrainEllipse === false) return; // 用户删除了椭圆
    // 用当前盆地参数 + 草地切片构建默认椭圆
    this._terrainEllipse = {
      cx: this.centerX,
      cy: this.centerY - 32,
      rx: this.basinRadiusX + 20,
      ry: this.basinRadiusY + 20,
      fillMode: 'slice',
      fill: '#3a5a2a',
      opacity: 1,
      edgeFade: 0.28,           // 边缘淡化，模拟原森林环带过渡
      imageMode: 'cover',
      sliceMode: 'tile',
      imageSrc: null,
      _img: null,
      _slice: {
        atlasId: 'mountain_landscape',
        sx: this.grassTile.sx,
        sy: this.grassTile.sy,
        sw: this.grassTile.sw,
        sh: this.grassTile.sh
      }
    };
  }

  /**
   * 构建装饰物清单（随机分布）
   * 在盆地内部稀疏放置树/灌木，在高地（悬崖外圈）密集放置树木
   * 每个装饰物：{ x, y, key, scale }
   *   - x,y 是底部锚点（脚下中心点，用于 Y-sort）
   *   - key 指向 decoSprites 里的切片（如 'tree1', 'bush2'）
   *   - scale 整体缩放
   * @private
   */
  _buildDecorations() {
    const cx = this.centerX;
    const cy = this.centerY;
    const w  = this.basinWidth;
    const h  = this.basinHeight;
    const fireRadius = 90; // 火堆周围保留空地

    // 简单确定性伪随机（场景每次表现一致）
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];

    // 外围树木选择：tree1 概率 25%，其余在 tree2/tree3 平分
    const pickOuterTree = () => {
      const r = rand();
      if (r < 0.25) return 'tree1';
      return r < 0.625 ? 'tree2' : 'tree3';
    };

    // 椭圆参数化：根据角度返回椭圆上点的 (x, y)，并按 radiusJitter 抖动半径
    // factor: 半径缩放因子（1.0 = 树圈本身，<1.0 = 内缘，>1.0 = 外缘）
    // radiusJitter: 半径抖动幅度（像素）
    const ellipsePoint = (angle, factor, radiusJitter) => {
      const jitter = (rand() - 0.5) * radiusJitter * 2;
      const rx = this.basinRadiusX * factor + jitter;
      const ry = this.basinRadiusY * factor + jitter * this.basinAspectY;
      return {
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry
      };
    };

    // ---- 1. 主树圈：3 排密集分布的树围满椭圆边缘（南向留入口）----
    const ringConfigs = [
      { count: 64, factor: 1.02, jitter: 18 },  // 中圈：紧贴椭圆轮廓
      { count: 56, factor: 0.94, jitter: 14 },  // 内圈：往里一点
      { count: 56, factor: 1.10, jitter: 16 },  // 外圈：往外一点
    ];
    for (const cfg of ringConfigs) {
      for (let i = 0; i < cfg.count; i++) {
        const baseAngle = (i / cfg.count) * Math.PI * 2 - Math.PI / 2
                        + (rand() - 0.5) * Math.PI * 6 / 180;
        const angDistFromSouth = Math.abs(this._normalizeAngle(baseAngle - Math.PI / 2));
        if (angDistFromSouth < this.entranceAngleHalfWidth) continue;
        const pt = ellipsePoint(baseAngle, cfg.factor, cfg.jitter);
        this.decorations.push({
          x: Math.round(pt.x),
          y: Math.round(pt.y),
          key: pickOuterTree(),
          scale: 1.0
        });
      }
    }

    // ---- 1b. 草地下方空地补充树（椭圆下半圆外侧）----
    // 草地视觉上移 32 后，下边缘外露出空地，铺一排树盖住
    const bottomFillCount = 36;
    for (let i = 0; i < bottomFillCount; i++) {
      // 角度集中在下半圆（0..π），即东 → 南 → 西
      const baseAngle = (i / bottomFillCount) * Math.PI;
      const angDistFromSouth = Math.abs(this._normalizeAngle(baseAngle - Math.PI / 2));
      if (angDistFromSouth < this.entranceAngleHalfWidth) continue;
      const angle = baseAngle + (rand() - 0.5) * Math.PI * 4 / 180;
      // factor 1.14~1.24：在树圈外侧再延伸一段
      const factor = 1.14 + rand() * 0.10;
      const pt = ellipsePoint(angle, factor, 12);
      this.decorations.push({
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        key: pickOuterTree(),
        scale: 1.0
      });
    }

    // ---- 1c. 入口处草丛和灌木遮挡（视觉遮挡，不参与碰撞）----
    // 在南向入口扇形内放草丛/灌木，覆盖入口缺口的草地下边缘弧线
    // 这些都是 collide:false，不会挡住玩家进出
    // belowEntities=true: 渲染在所有实体下层，不会遮挡玩家
    const entranceDecoCount = 18;
    for (let i = 0; i < entranceDecoCount; i++) {
      const t01 = i / entranceDecoCount;
      const angle = Math.PI / 2 + (t01 - 0.5) * 2 * this.entranceAngleHalfWidth
                  + (rand() - 0.5) * Math.PI * 2 / 180;
      const factor = 1.0 + rand() * 0.18;
      const pt = ellipsePoint(angle, factor, 8);
      const r = rand();
      let key;
      if (r < 0.5)       key = 'grass1';
      else if (r < 0.75) key = 'bush2';
      else if (r < 0.9)  key = 'bush3';
      else               key = 'bush4';
      this.decorations.push({
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        key,
        scale: 1.0,
        belowEntities: true
      });
    }

    // ---- 4. 树圈附近少量草地（grass1）----
    const innerGrassCount = 10;
    for (let i = 0; i < innerGrassCount; i++) {
      const angle = rand() * Math.PI * 2;
      const factor = 0.84 + rand() * 0.08;
      const pt = ellipsePoint(angle, factor, 8);
      this.decorations.push({
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        key: 'grass1',
        scale: 1.0
      });
    }

    // ---- 4b. 树圈内缘点缀草丛 + 灌木 ----
    const edgeDecoCount = 10;
    for (let i = 0; i < edgeDecoCount; i++) {
      const baseAngle = (i / edgeDecoCount) * Math.PI * 2;
      const angDistFromSouth = Math.abs(this._normalizeAngle(baseAngle - Math.PI / 2));
      if (angDistFromSouth < this.entranceAngleHalfWidth - Math.PI * 2 / 180) continue;
      const angle = baseAngle + (rand() - 0.5) * Math.PI * 8 / 180;
      const factor = 0.86 + rand() * 0.16;
      const pt = ellipsePoint(angle, factor, 4);
      const r = rand();
      let key;
      if (r < 0.45)      key = 'grass1';
      else if (r < 0.7)  key = 'bush2';
      else if (r < 0.85) key = 'bush3';
      else               key = 'bush4';
      this.decorations.push({
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        key,
        scale: 1.0
      });
    }

    // ---- 4c. 椭圆上下边缘遮挡带：完整一整圈密集 grass1 ----
    // 底部锚点在椭圆外侧 1.04~1.10，96px 高的草丛向上延伸正好覆盖椭圆边缘
    // 上半圆和下半圆都覆盖，形成完整的森林底部带
    const edgeShieldCount = 56;
    for (let i = 0; i < edgeShieldCount; i++) {
      const baseAngle = (i / edgeShieldCount) * Math.PI * 2 - Math.PI / 2;
      const angDistFromSouth = Math.abs(this._normalizeAngle(baseAngle - Math.PI / 2));
      if (angDistFromSouth < this.entranceAngleHalfWidth + Math.PI * 2 / 180) continue;
      const angle = baseAngle + (rand() - 0.5) * Math.PI * 4 / 180;
      const factor = 1.02 + rand() * 0.08;
      const pt = ellipsePoint(angle, factor, 5);
      this.decorations.push({
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        key: 'grass1',
        scale: 1.0
      });
    }

    // ---- 5. 盆地内部：随机分布的树木（只用 tree2/tree3，3-5 棵）----
    const innerTrees = 3 + Math.floor(rand() * 3); // 3..5
    const innerTreePositions = [];
    for (let i = 0; i < innerTrees; i++) {
      let x, y, tries = 0, ok = false;
      do {
        // 椭圆内均匀采样
        const ang = rand() * Math.PI * 2;
        const u = Math.sqrt(rand());      // 抗中心聚集
        x = cx + Math.cos(ang) * u * (this.basinInnerRadiusX - 60);
        y = cy + Math.sin(ang) * u * (this.basinInnerRadiusY - 40);
        tries++;
        ok = !(
          Math.hypot(x - cx, y - cy) < fireRadius + 30 ||
          this._inEntranceCorridor(x, y) ||
          this._inAnyWaterPatch(x, y, 24) ||
          innerTreePositions.some(t => Math.hypot(x - t.x, y - t.y) < 56)
        );
      } while (!ok && tries < 16);
      if (!ok) continue;
      innerTreePositions.push({ x, y });
      this.decorations.push({
        x: Math.round(x),
        y: Math.round(y),
        key: pick(this.innerTreeKeys),
        scale: 1.0
      });
    }

    // ---- 6. 盆地内部：随机分布的灌木丛（小图块，不挡路）----
    const innerBushes = 26;
    for (let i = 0; i < innerBushes; i++) {
      let x, y, tries = 0;
      do {
        const ang = rand() * Math.PI * 2;
        const u = Math.sqrt(rand());
        x = cx + Math.cos(ang) * u * (this.basinInnerRadiusX - 30);
        y = cy + Math.sin(ang) * u * (this.basinInnerRadiusY - 20);
        tries++;
      } while (
        (Math.hypot(x - cx, y - cy) < fireRadius ||
         this._inEntranceCorridor(x, y) ||
         this._inAnyWaterPatch(x, y, 8))
        && tries < 8
      );
      this.decorations.push({
        x: Math.round(x),
        y: Math.round(y),
        key: pick(this.bushKeys),
        scale: 1.0
      });
    }
  }

  /**
   * 把任意角度规范化到 [-π, π]
   * @private
   */
  _normalizeAngle(a) {
    while (a >  Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /**
   * 判断点是否在入口通道（基于椭圆距离 + 南向角度扇形）
   * @private
   */
  _inEntranceCorridor(x, y) {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    // 椭圆归一化距离
    const ed = Math.hypot(dx / this.basinRadiusX, dy / this.basinRadiusY);
    if (ed < 0.7) return false;
    if (ed > 1.25) return false;
    const ang = Math.atan2(dy, dx);
    const angDistFromSouth = Math.abs(this._normalizeAngle(ang - Math.PI / 2));
    return angDistFromSouth < this.entranceAngleHalfWidth + Math.PI * 4 / 180;
  }

  /**
   * 判断点是否在任意水池内（含外扩 margin）
   * @private
   */
  _inAnyWaterPatch(x, y, margin = 0) {
    for (const p of this.waterPatches) {
      const rx = p.rx + margin;
      const ry = p.ry + margin;
      const dx = (x - p.x) / rx;
      const dy = (y - p.y) / ry;
      if (dx * dx + dy * dy < 1) return true;
    }
    return false;
  }

  /**
   * 构建水体（圆形/椭圆形水池）
   * 当前已禁用 —— 不再生成湖泊
   * @private
   */
  _buildWaterPatches() {
    // 不生成任何水体
  }

  /**
   * 仅检查编辑器定义的可碰撞 shape；旧椭圆盆地只负责视觉与装饰布局，不再阻挡移动。
   * @param {number} x
   * @param {number} y
   * @returns {boolean} true 表示阻塞，不能走
   */
  isBlocked(x, y) {
    // 可落脚区域优先：如果点在任意 walkable shape 内，直接放行（无论脚下是否有碰撞区）
    if (this._walkableShapes && this._walkableShapes.length) {
      for (const s of this._walkableShapes) {
        if (this._pointInCollisionShape(s, x, y)) return false;
      }
    }

    // 编辑器 collide shape（多边形/矩形/椭圆碰撞区）：命中即阻塞
    if (this._collisionShapes && this._collisionShapes.length) {
      for (const s of this._collisionShapes) {
        if (this._pointInCollisionShape(s, x, y)) return true;
      }
    }
    return false;
  }

  /**
   * 判断点是否落在 collide shape 内（按 shapeType）
   * @private
   */
  _pointInCollisionShape(s, x, y) {
    if ((s.shapeType === 'polygon' || s.shapeType === 'path') && Array.isArray(s.points)) {
      return this._pointInPolygon(s.points, x, y);
    }
    const bx = s.x || 0, by = s.y || 0, bw = s.width || 0, bh = s.height || 0;
    const cx = bx + bw / 2, cy = by + bh / 2;
    if (s.shapeType === 'circle') {
      return Math.hypot(x - cx, y - cy) <= Math.min(bw, bh) / 2;
    }
    if (s.shapeType === 'ellipse') {
      const nx = (x - cx) / (bw / 2 || 1), ny = (y - cy) / (bh / 2 || 1);
      return nx * nx + ny * ny <= 1;
    }
    // rect（默认）
    return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
  }

  /**
   * 射线法判断点在多边形内
   * @private
   */
  _pointInPolygon(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /**
   * 获取所有树木的碰撞圆（仅盆地内的，外圈树不参与碰撞因为本来就在悬崖外）
   * @returns {Array<{x:number, y:number, r:number}>}
   */
  getTreeColliders() {
    if (!this._treeColliders) {
      this._treeColliders = [];
      for (const deco of this.decorations) {
        const sprite = this.decoSprites[deco.key];
        if (!sprite || !sprite.collide) continue;
        this._treeColliders.push({
          x: deco.x,
          y: deco.y - 4, // 树根中心略上一点
          r: sprite.colliderRadius || 16
        });
      }
    }
    return this._treeColliders;
  }

  /**
   * 收集装饰物到渲染队列（参与 Y-sort）
   * 标记 belowEntities 的装饰物不参与排序，由 renderBelowDecorations 单独绘制
   * @param {Array} renderQueue - 渲染队列，每项 { type, y, render }
   * @param {CanvasRenderingContext2D} ctx
   * @param {{left:number,top:number,right:number,bottom:number}} [viewBounds] 可选相机世界视野
   */
  get staticCacheRevision() {
    return this._staticCacheRevision;
  }

  _waitForImage(image, signal = null) {
    if (!image || typeof image.addEventListener !== 'function') return Promise.resolve();
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    if (image.complete && image.naturalWidth === 0) {
      return Promise.reject(new Error('Scene1Terrain: 静态缓存图片加载失败'));
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        signal?.removeEventListener?.('abort', onAbort);
      };
      const onLoad = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Scene1Terrain: 静态缓存图片加载失败')); };
      const onAbort = () => { cleanup(); reject(new Error('Scene1Terrain: 静态缓存准备已取消')); };
      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  /** 九宫格加载阶段调用：等待静态图片并一次生成地面、图片和装饰缓存。 */
  async prepareStaticCaches({ signal = null } = {}) {
    if (this._staticCachePrepared && !this._released) return this._staticCacheRevision;
    const lifecycleToken = this._cacheLifecycleToken;
    this._released = false;
    const sceneImages = [
      ...(this._editorBackgroundImages || []),
      ...(this._depthSortedImages || [])
    ];
    const imageSet = new Set([
      ...sceneImages.map(entry => entry?._img),
      this._terrainEllipse?._img,
      ...Object.values(this.images || {})
    ].filter(Boolean));
    await Promise.all([...imageSet].map(image => this._waitForImage(image, signal)));
    if (signal?.aborted || lifecycleToken !== this._cacheLifecycleToken || this._released) {
      throw new Error('Scene1Terrain: 静态缓存准备已取消');
    }
    for (const entry of sceneImages) {
      if (entry?._img) entry._loaded = true;
    }
    this._buildBackgroundImageCache();
    this._buildGroundDecoCache();
    this._buildBelowDecoCache();
    if (this._hasTerrainEllipse !== false) this._buildCombinedGroundCache();
    this._staticCachePrepared = true;
    this._staticCacheRevision++;
    return this._staticCacheRevision;
  }

  _releaseCanvas(canvas) {
    if (!canvas) return;
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch (error) { /* best-effort Canvas release */ }
  }

  /** 释放仅属于表现层的 Canvas；不写入 chunk 状态或存档。 */
  releaseStaticCaches() {
    if (this._released) return;
    this._released = true;
    this._cacheLifecycleToken++;
    this._staticCachePrepared = false;
    this._terrainCacheBuildScheduled = false;
    this._terrainCacheBuildCombined = false;
    this._bgImageCachePendingSignature = null;
    const canvases = [
      this._combinedGroundCache,
      this._groundDecoCache,
      this._belowDecoCache,
      this._bgImageCache,
      this._grassCanvas,
      this._cliffCanvas
    ];
    for (const canvas of new Set(canvases.filter(Boolean))) this._releaseCanvas(canvas);
    this._combinedGroundCache = null;
    this._groundDecoCache = null;
    this._belowDecoCache = null;
    this._bgImageCache = null;
    this._grassCanvas = null;
    this._cliffCanvas = null;
    this._bgImageCacheSignature = null;
    this._decorationQueueEntries = [];
    this._decorationQueueGroundCache = null;
    this._staticCacheRevision++;
  }

  collectDecorations(renderQueue, ctx, viewBounds = null) {
    // 装饰物、图集切片、深度图片和 ground cache 都是静态数据。仅在引用变化或 Canvas
    // 上下文变化时重建队列项，正常帧只追加已缓存对象，避免创建闭包和包装对象。
    if (this._decorationQueueContext !== ctx ||
        this._decorationQueueSource !== this.decorations ||
        this._decorationQueueImageSource !== this._depthSortedImages ||
        this._decorationQueueGroundCache !== this._groundDecoCache) {
      this._decorationQueueContext = ctx;
      this._decorationQueueSource = this.decorations;
      this._decorationQueueImageSource = this._depthSortedImages;
      this._decorationQueueGroundCache = this._groundDecoCache;
      this._decorationQueueEntries = [];

      if (this._groundDecoCache) {
        this._decorationQueueEntries.push({
          type: 'scene1_deco',
          y: -10000,
          sortPriority: 0,
          render: () => {
            ctx.drawImage(this._groundDecoCache, this._groundDecoCacheX, this._groundDecoCacheY);
          }
        });
      }

      for (const deco of this.decorations) {
        if (deco.belowEntities) continue;
        const sprite = this.decoSprites[deco.key];
        if (!sprite || !sprite.collide) continue;
        const size = this._decoRenderSize(deco, sprite);
        this._decorationQueueEntries.push({
          type: 'scene1_deco',
          y: deco.y,
          sortPriority: 0,
          left: deco.x - size.w / 2,
          right: deco.x + size.w / 2,
          top: deco.y - size.h,
          bottom: deco.y,
          render: () => this._renderDecoration(ctx, deco)
        });
      }

      for (const image of this._depthSortedImages || []) {
        const rotated = image.rotation !== 0;
        const centerX = image.x + image.width / 2;
        const centerY = image.y + image.height / 2;
        const radius = rotated ? Math.hypot(image.width, image.height) / 2 : 0;
        this._decorationQueueEntries.push({
          type: 'scene_image',
          y: image.sortY,
          sortPriority: 0,
          left: rotated ? centerX - radius : image.x,
          right: rotated ? centerX + radius : image.x + image.width,
          top: rotated ? centerY - radius : image.y,
          bottom: rotated ? centerY + radius : image.y + image.height,
          render: () => this._renderDepthSortedImage(ctx, image)
        });
      }
    }

    const entries = this._decorationQueueEntries;
    const padding = 32;
    for (let i = 0, len = entries.length; i < len; i++) {
      const entry = entries[i];
      // ground cache 没有 bounds，始终保留为一次 drawImage；其余静态对象在入队前裁剪。
      if (viewBounds && entry.left !== undefined &&
          (entry.right + padding < viewBounds.left || entry.left - padding > viewBounds.right ||
           entry.bottom + padding < viewBounds.top || entry.top - padding > viewBounds.bottom)) {
        continue;
      }
      renderQueue.push(entry);
    }
  }
  
  /**
   * 绘制一个与实体共用脚底排序基线的场景图片。
   * 图片坐标仍是左上角；rotation 围绕图片中心，不改变 sortY。
   * @private
   */
  _renderDepthSortedImage(ctx, image) {
    if (!image?._loaded || !image._img) return;
    ctx.save();
    if (image.opacity !== undefined) ctx.globalAlpha *= image.opacity;
    if (image.rotation) {
      const centerX = image.x + image.width / 2;
      const centerY = image.y + image.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate(image.rotation * Math.PI / 180);
      ctx.drawImage(image._img, -image.width / 2, -image.height / 2, image.width, image.height);
    } else {
      ctx.drawImage(image._img, image.x, image.y, image.width, image.height);
    }
    ctx.restore();
  }

  /**
   * 构建草地装饰物离屏缓存（非碰撞装饰物：草、灌木）
   * 只在图片加载完成且缓存不存在时构建一次
   * @private
   */
  _buildDecorationLayerCache(predicate) {
    if (!this.loaded.mountain || !this.images.mountain) return null;
    const entries = this.decorations.filter(deco => predicate(deco, this.decoSprites[deco.key]));
    if (entries.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const deco of entries) {
      const sprite = this.decoSprites[deco.key];
      const { w, h } = this._decoRenderSize(deco, sprite);
      const dx = deco.x - w / 2;
      const dy = deco.y - h;
      minX = Math.min(minX, dx);
      minY = Math.min(minY, dy);
      maxX = Math.max(maxX, dx + w);
      maxY = Math.max(maxY, dy + h);
    }

    const cacheW = Math.ceil(maxX - minX) + 4;
    const cacheH = Math.ceil(maxY - minY) + 4;
    if (cacheW > 4096 || cacheH > 4096) return null;

    const canvas = document.createElement('canvas');
    canvas.width = cacheW;
    canvas.height = cacheH;
    const gctx = canvas.getContext('2d');
    const offsetX = minX - 2;
    const offsetY = minY - 2;
    for (const deco of entries) {
      const sprite = this.decoSprites[deco.key];
      const { w, h } = this._decoRenderSize(deco, sprite);
      gctx.drawImage(
        this.images.mountain,
        sprite.sx, sprite.sy, sprite.sw, sprite.sh,
        deco.x - w / 2 - offsetX,
        deco.y - h - offsetY,
        w, h
      );
    }
    return { canvas, x: offsetX, y: offsetY };
  }

  /** 构建非碰撞地面装饰缓存。 */
  _buildGroundDecoCache() {
    if (this._groundDecoCache) return;
    const cache = this._buildDecorationLayerCache((deco, sprite) =>
      !deco.belowEntities && sprite && !sprite.collide
    );
    if (!cache) return;
    this._groundDecoCache = cache.canvas;
    this._groundDecoCacheX = cache.x;
    this._groundDecoCacheY = cache.y;
  }

  /** 构建固定在所有实体下方的装饰缓存。 */
  _buildBelowDecoCache() {
    if (this._belowDecoCache) return;
    const cache = this._buildDecorationLayerCache((deco, sprite) =>
      deco.belowEntities === true && !!sprite
    );
    if (!cache) return;
    this._belowDecoCache = cache.canvas;
    this._belowDecoCacheX = cache.x;
    this._belowDecoCacheY = cache.y;
  }

  /**
   * 渲染所有标记为 belowEntities 的装饰物（在所有实体之下）
   * @param {CanvasRenderingContext2D} ctx 已应用相机变换
   */
  renderBelowDecorations(ctx) {
    if (this._belowDecoCache) {
      ctx.drawImage(this._belowDecoCache, this._belowDecoCacheX, this._belowDecoCacheY);
      return;
    }
    for (const deco of this.decorations) {
      if (!deco.belowEntities) continue;
      this._renderDecoration(ctx, deco);
    }
  }

  /**
   * 渲染单个装饰物（从共享 mountain_landscape 图集切片绘制）
   * @private
   */
  _renderDecoration(ctx, deco) {
    if (!this.loaded.mountain) return;
    const sprite = this.decoSprites[deco.key];
    if (!sprite) return;
    const { w, h } = this._decoRenderSize(deco, sprite);
    // 锚点：底部中央
    const dx = deco.x - w / 2;
    const dy = deco.y - h;
    ctx.drawImage(
      this.images.mountain,
      sprite.sx, sprite.sy, sprite.sw, sprite.sh,
      dx, dy, w, h
    );
  }

  /**
   * 计算装饰物渲染尺寸：
   *   - 编辑器摆放的装饰物有独立 w/h（宽高各自照搬，与编辑器一致，允许非等比）
   *   - 程序化生成的装饰物无 w/h，回退到 scale × 切片原始尺寸 × sprite.scale
   * @private
   */
  _decoRenderSize(deco, sprite) {
    if (deco.w != null && deco.h != null) {
      return { w: deco.w, h: deco.h };
    }
    const totalScale = (deco.scale ?? 1) * (sprite.scale ?? 1);
    return { w: sprite.sw * totalScale, h: sprite.sh * totalScale };
  }

  /**
   * 渲染地形底层（椭圆草地 + 外圈森林深绿环带）
   * 注：草地视觉中心 Y 上移 32 像素（视觉调整，不影响碰撞和实体位置）
   * @param {CanvasRenderingContext2D} ctx 已应用相机变换
   */
  renderGround(ctx) {
    // 编辑器中删除了地形椭圆：不渲染草地底层，只保留水池、背景图片和 shape
    if (this._hasTerrainEllipse === false) {
      // 流式九宫格在发布 projection 前已生成静态缓存；这里只保留非流式兼容调度。
      if (!this._staticCachePrepared) this._scheduleTerrainCacheBuild({ combined: false });
      this._renderWaterPatches(ctx);
      this._renderEditorBackgroundImages(ctx);
      this._renderEditorShapes(ctx);   // shape 在背景图片之上，可遮挡底层图片
      return;
    }

    // 使用合并的地面缓存（椭圆草地 + 背景图，一张图搞定）
    // shape（多边形/椭圆等）每帧单独画在缓存之上，可遮挡底层图片
    if (this._combinedGroundCache) {
      ctx.drawImage(this._combinedGroundCache, this._combinedGroundCacheX, this._combinedGroundCacheY);
      this._renderEditorShapes(ctx);
      return;
    }

    // 确保有地形椭圆数据（无编辑器椭圆时用 terrain 默认生成）
    this._ensureTerrainEllipseData();

    // 缓存尚未准备好时直接绘制；仅非流式兼容路径允许延后构建。
    this._renderTerrainEllipse(ctx);
    if (!this._staticCachePrepared) this._scheduleTerrainCacheBuild();
    this._renderWaterPatches(ctx);
    // 渲染编辑器中保存的背景图片（使用离屏缓存）
    this._renderEditorBackgroundImages(ctx);
    // shape 在背景图片之上渲染，可遮挡底层图片
    this._renderEditorShapes(ctx);
  }

  /** 将一次性离屏缓存构建移出渲染帧，未完成前继续使用直接绘制回退。 @private */
  _scheduleTerrainCacheBuild({ combined = true } = {}) {
    // 无地形椭圆的场景只需草地装饰缓存，不能因为延迟任务反向生成默认椭圆。
    this._terrainCacheBuildCombined = this._terrainCacheBuildCombined === true || combined === true;
    if (this._terrainCacheBuildScheduled) return;
    this._terrainCacheBuildScheduled = true;
    const lifecycleToken = this._cacheLifecycleToken;
    const build = () => {
      if (this._released || lifecycleToken !== this._cacheLifecycleToken) return;
      const buildCombined = this._terrainCacheBuildCombined === true;
      this._terrainCacheBuildScheduled = false;
      this._terrainCacheBuildCombined = false;
      this._buildGroundDecoCache();
      if (buildCombined) this._buildCombinedGroundCache();
    };
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(build, { timeout: 500 });
    } else {
      globalThis.setTimeout(build, 0);
    }
  }

  /**
   * 渲染编辑器中具有表现的 shape，并复用已投影的可落脚区域。
   * @param {CanvasRenderingContext2D} ctx
   */
  _renderEditorShapes(ctx) {
    const editorShapes = this._editorShapes || [];
    const walkableShapes = this._walkableShapes || [];
    if (editorShapes.length === 0 && walkableShapes.length === 0) return;
    const resolver = this._editorShapeResolver();
    for (const shape of editorShapes) {
      ShapeRenderer.render(ctx, shape, resolver);
    }
    for (const shape of walkableShapes) {
      ShapeRenderer.render(ctx, shape, resolver);
    }
  }

  /**
   * 调试显示编辑器碰撞与可落脚区域。只渲染临时副本，不修改场景 shape 数据。
   * 碰撞使用橙红色；walkable 使用青绿色，便于确认优先放行区域。
   * @param {CanvasRenderingContext2D} ctx 已应用世界坐标相机变换
   * @param {number} opacity 调试层透明度
   */
  renderCollisionShapesDebug(ctx, opacity = 0.7) {
    const collisionShapes = this._collisionShapes || [];
    const walkableShapes = this._walkableShapes || [];
    if (collisionShapes.length === 0 && walkableShapes.length === 0) return;
    const resolver = this._editorShapeResolver();
    const renderDebugShapes = (shapes, fill, stroke) => {
      for (const shape of shapes) {
        const debugShape = {
          ...shape,
          fillMode: 'color',
          fill,
          opacity,
          edgeFade: 0,
          stroke,
          strokeWidth: Math.max(2, Number(shape.strokeWidth) || 0)
        };
        ShapeRenderer.render(ctx, debugShape, resolver);
      }
    };
    renderDebugShapes(collisionShapes, '#ff9800', '#ff3b30');
    renderDebugShapes(walkableShapes, '#00bfa5', '#00e5ff');
  }

  /**
   * 为 shape 渲染提供资源解析（图片=预加载缓存；切片=图集 + 坐标）
   * @private
   */
  _editorShapeResolver() {
    if (!this._editorShapeResolverObj) {
      this._editorShapeResolverObj = {
        getImage: (key) => this._shapeImages.get(key) || null,
        getSliceSource: (shape) => this._resolveShapeSlice(shape)
      };
    }
    return this._editorShapeResolverObj;
  }

  _getAtlasImage(atlasId = 'mountain_landscape') {
    const atlas = this._atlasRegistry.getAtlas(atlasId);
    const assetId = atlas?.assetId || atlas?.id || atlasId;
    return this.getLoadedImage(assetId)
      || (atlasId === 'mountain_landscape' ? this.images.mountain : null);
  }

  /**
   * 解析 shape 的切片图源（decoKey → mountain_landscape；atlasId+sliceKey → 共享 registry）
   * @private
   */
  _resolveShapeSlice(shape) {
    let atlasId = 'mountain_landscape';
    let rect = null;
    if (shape.decoKey && this.decoSprites[shape.decoKey]) {
      const s = this.decoSprites[shape.decoKey];
      rect = { sx: s.sx, sy: s.sy, sw: s.sw, sh: s.sh };
    } else if (shape.atlasId && shape.sliceKey) {
      atlasId = shape.atlasId;
      const sl = this._atlasRegistry.getSlice(shape.atlasId, shape.sliceKey);
      if (sl) rect = { sx: sl.sx, sy: sl.sy, sw: sl.sw, sh: sl.sh };
    }
    const img = this._getAtlasImage(atlasId);
    if (!rect || !img) return null;
    return { img, sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh };
  }

  /**
   * 数据驱动渲染地形椭圆
   * 按 _terrainEllipse.fillMode（color/image/slice）填充，并应用 edgeFade 边缘淡化
   * @param {CanvasRenderingContext2D} ctx
   */
  _renderTerrainEllipse(ctx) {
    const e = this._terrainEllipse;
    if (!e) return;
    // 转成统一 shape，交给 ShapeRenderer（与编辑器同一套渲染逻辑）
    const shape = {
      shapeType: 'ellipse',
      x: e.cx - e.rx, y: e.cy - e.ry, width: e.rx * 2, height: e.ry * 2,
      fillMode: e.fillMode,
      fill: e.fill,
      opacity: e.opacity,
      edgeFade: e.edgeFade,
      imageMode: e.imageMode,
      sliceMode: e.sliceMode,
      imageSrc: e.imageSrc
    };
    ShapeRenderer.render(ctx, shape, this._terrainShapeResolver(e));
  }

  /**
   * 为地形椭圆提供 ShapeRenderer 资源解析（图片=已加载的 _img；切片=mountain 图集 + _slice）
   * @private
   */
  _terrainShapeResolver(e) {
    return {
      getImage: () => (e._img && e._img.complete && e._img.naturalWidth) ? e._img : null,
      getSliceSource: () => {
        if (!e._slice) return null;
        const img = this._getAtlasImage(e._slice.atlasId || 'mountain_landscape');
        return img
          ? { img, sx: e._slice.sx, sy: e._slice.sy, sw: e._slice.sw, sh: e._slice.sh }
          : null;
      }
    };
  }
  
  /**
   * 构建合并地面缓存：草地铺面 + 森林环带 + 背景图片 + 水池
   * 所有不会变化的底层内容合并到一张离屏 Canvas，每帧只需一次 drawImage
   * @private
   */
  _buildCombinedGroundCache() {
    if (this._combinedGroundCache) return;
    this._ensureTerrainEllipseData();
    const e = this._terrainEllipse;
    if (!e) return;
    // 切片模式需图集就绪；图片模式需图片就绪
    if (e.fillMode === 'slice' && !this._getAtlasImage(e._slice?.atlasId || 'mountain_landscape')) return;
    if (e.fillMode === 'image' && (!e._img || !e._img.complete || !e._img.naturalWidth)) return;
    // 等背景图片加载完再合并
    if (this._editorBackgroundImages && this._editorBackgroundImages.length > 0) {
      if (!this._editorBackgroundImages.every(bg => bg._loaded)) return;
    }

    // 缓存范围基于椭圆包围盒外扩
    const rx = e.rx + 120;
    const ry = e.ry + 120;
    const cx = e.cx;
    const cy = e.cy;

    const cacheW = Math.ceil(rx * 2 + 40);
    const cacheH = Math.ceil(ry * 2 + 40);
    if (cacheW > 4096 || cacheH > 4096) return;

    const offsetX = cx - cacheW / 2;
    const offsetY = cy - cacheH / 2;

    const canvas = document.createElement('canvas');
    canvas.width = cacheW;
    canvas.height = cacheH;
    const gctx = canvas.getContext('2d');

    // 偏移到缓存坐标系
    gctx.translate(-offsetX, -offsetY);

    // 画地形椭圆（数据驱动）
    this._renderTerrainEllipse(gctx);
    // 画水池
    this._renderWaterPatches(gctx);
    // 画背景图片
    if (this._editorBackgroundImages) {
      for (const bgImg of this._editorBackgroundImages) {
        if (!bgImg._loaded || !bgImg._img) continue;
        gctx.save();
        if (bgImg.opacity !== undefined) gctx.globalAlpha = bgImg.opacity;
        gctx.drawImage(bgImg._img, bgImg.x, bgImg.y, bgImg.width, bgImg.height);
        gctx.restore();
      }
    }

    this._combinedGroundCache = canvas;
    this._combinedGroundCacheX = offsetX;
    this._combinedGroundCacheY = offsetY;
    console.log(`Scene1Terrain: 合并地面缓存已构建 (${cacheW}x${cacheH})`);
  }
  
  /** 九宫格准备阶段一次合并普通背景图片；渲染帧只消费缓存。 */
  _buildBackgroundImageCache() {
    if (this._bgImageCache || !Array.isArray(this._editorBackgroundImages) ||
        this._editorBackgroundImages.length === 0 ||
        !this._editorBackgroundImages.every(bg => bg._loaded && bg._img)) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const bg of this._editorBackgroundImages) {
      minX = Math.min(minX, bg.x);
      minY = Math.min(minY, bg.y);
      maxX = Math.max(maxX, bg.x + bg.width);
      maxY = Math.max(maxY, bg.y + bg.height);
    }
    const cacheW = Math.ceil(maxX - minX) + 2;
    const cacheH = Math.ceil(maxY - minY) + 2;
    if (cacheW > 4096 || cacheH > 4096) return;

    const canvas = document.createElement('canvas');
    canvas.width = cacheW;
    canvas.height = cacheH;
    const gctx = canvas.getContext('2d');
    const offsetX = minX - 1;
    const offsetY = minY - 1;
    for (const bgImg of this._editorBackgroundImages) {
      gctx.save();
      if (bgImg.opacity !== undefined) gctx.globalAlpha = bgImg.opacity;
      gctx.drawImage(
        bgImg._img,
        bgImg.x - offsetX,
        bgImg.y - offsetY,
        bgImg.width,
        bgImg.height
      );
      gctx.restore();
    }
    this._bgImageCache = canvas;
    this._bgImageCacheX = offsetX;
    this._bgImageCacheY = offsetY;
    this._bgImageCacheSignature = this._editorBackgroundImages
      .map(bg => `${bg.imageId || bg.src}|${bg.width}x${bg.height}|${bg.opacity ?? 1}`)
      .join(';');
  }

  /**
   * 渲染编辑器中的背景图片（带离屏缓存）
   * @private
   */
  _renderEditorBackgroundImages(ctx) {
    if (!this._editorBackgroundImages || this._editorBackgroundImages.length === 0) return;
    if (this._bgImageCache) {
      ctx.drawImage(this._bgImageCache, this._bgImageCacheX, this._bgImageCacheY);
      return;
    }

    // 非流式兼容路径：缓存尚未准备时只直接绘制，不在 RAF 内创建 Canvas。
    for (const bgImg of this._editorBackgroundImages) {
      if (!bgImg._loaded || !bgImg._img) continue;
      ctx.save();
      if (bgImg.opacity !== undefined) ctx.globalAlpha = bgImg.opacity;
      ctx.drawImage(bgImg._img, bgImg.x, bgImg.y, bgImg.width, bgImg.height);
      ctx.restore();
    }
  }

  /**
   * 渲染水池
   * @private
   */
  _renderWaterPatches(ctx) {
    ctx.save();
    for (const p of this.waterPatches) {
      // 水底深色阴影
      ctx.fillStyle = 'rgba(20, 60, 90, 0.85)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // 水面高光（如果有水图块就用图块平铺）
      if (this.loaded.terrain) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx - 4, p.ry - 3, 0, 0, Math.PI * 2);
        ctx.clip();
        const t = this.tileWater;
        const tw = 32, th = 32;
        const x0 = Math.floor((p.x - p.rx) / tw) * tw;
        const y0 = Math.floor((p.y - p.ry) / th) * th;
        for (let yy = y0; yy < p.y + p.ry; yy += th) {
          for (let xx = x0; xx < p.x + p.rx; xx += tw) {
            ctx.drawImage(
              this.images.terrain,
              t.sx, t.sy, t.sw, t.sh,
              xx, yy, tw, th
            );
          }
        }
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(70, 130, 180, 0.85)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx - 4, p.ry - 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // 水面高光描边
      ctx.strokeStyle = 'rgba(180, 220, 240, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 已废弃：之前的矩形悬崖渲染
   * 现在用圆形树圈代替，本方法保留空实现以保持调用兼容
   * @param {CanvasRenderingContext2D} ctx 已应用相机变换
   */
  renderCliffs(ctx) {
    // 不再绘制矩形悬崖
  }
}


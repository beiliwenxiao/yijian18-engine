/**
 * S01WorldBuilder3D - 数据驱动的 S01 3D 世界构建器（M0）
 *
 * 从 2D 场景 JSON（assets/scenes/S01.json）直接构建 3D 世界：
 * - layer_bg / layer_deco 的 image 对象 → 贴图地面平面（2D 矩形 → XZ 平面）
 * - 填色 shape（河道等多边形，opacity>0）→ 颜色平面
 * - S01-spawns 放置物（未门控的 node/prop）→ billboard 面片（美术走 library→manifest 链）
 * - 2D 坐标 (x, y) → THREE 世界 (x, 0, y)，与实体/相机映射一致
 *
 * 对外暴露 ensure/update 接口，挂到 BaseGameScene 的 s01Ground3D 钩子上，
 * 由 _ensure3DSceneObjects 每帧驱动（ensure 只建一次，update 做 billboard 朝向）。
 */

export class S01WorldBuilder3D {
  constructor(projectData) {
    this.pd = projectData;
    this._created = false;
    this._propMeshes = [];
    this._buildError = null;

    // 运行时放置物注册（spawnGroup 产出，宿主消费）
    this.spawnedPlacements = [];   // [{placementId, ref, kind, x, y, mesh, node?, pickup?}]
    this._spawnedIds = new Set();  // 幂等
    // 首帧渲染前触发的放置物（_lastThree 尚未就绪）：先记账，ensure 后补建网格，
    // 否则 new THREE.Texture() 直接抛错打断整条触发器链（spawn-initial-placements 实测）
    this._pendingMeshes = [];
    this._campfireLitRequested = false;
  }

  /**
   * 按组生成放置物（2D spawnPlacements 命令的 3D 承载）
   */
  spawnGroup(group) {
    const created = [];
    for (const obj of this.pd.placementObjects()) {
      if (obj.group !== group) continue;
      const rec = this.spawnPlacement(obj);
      if (rec) created.push(rec);
    }
    return created;
  }

  /**
   * 生成单个放置物（幂等；enemy 返回无 mesh 记录，由宿主生成战斗实体）
   * - kind item：billboard；ref 带库定义 → 完整定义（可拾取入包）
   * - kind resourceNode：billboard + 采集节点数据（itemId/资源类型/工具需求/产量区间）
   * - kind enemy：仅记录（宿主 spawnWolfEntity）
   */
  spawnPlacement(obj) {
    if (!obj || this._spawnedIds.has(obj.id)) return null;
    this._spawnedIds.add(obj.id);

    const def = this.pd.definition(obj.ref);
    const art = this.pd.definitionArt(obj.ref);
    const record = {
      placementId: obj.id,
      ref: obj.ref,
      kind: obj.kind,
      group: obj.group || null,
      name: def?.name || obj.ref,
      x: obj.x, y: obj.y,
      mesh: null
    };

    // 火堆：2D 原图两态 billboard + 点光源
    if (obj.ref === 'story.s01.campfire') {
      if (this._lastThree && this._group) {
        this._addCampfire(this._lastThree, this._group, obj.x, obj.y);
      } else {
        this._pendingMeshes.push({ record, campfire: true });
      }
      this.spawnedPlacements.push(record);
      return record;
    }

    if (obj.kind !== 'enemy' && art) {
      const THREE = this._lastThree;
      if (THREE && this._group) {
        const tex = new THREE.Texture();
        if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(art.width, art.height),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, depthWrite: false })
        );
        mesh.position.set(obj.x, art.height / 2 + 2, obj.y);
        mesh.renderOrder = 2;
        this._group.add(mesh);
        this._propMeshes.push(mesh);
        record.mesh = mesh;
        this._loadTexture(tex, art.src);
      } else {
        this._pendingMeshes.push({ record, art, x: obj.x });
      }
    }

    // 采集节点：node 定义数据齐全（itemId/资源类型/工具需求/产量区间）
    if (obj.kind === 'resourceNode' && def) {
      record.node = {
        itemId: def.itemId,
        resourceType: def.resourceType,
        interactionRadius: def.interactionRadius || 72,
        requiredToolType: def.requiredToolType || null,
        gatherYieldRange: def.gatherYieldRange || { min: def.yieldPerGather || 1, max: def.yieldPerGather || 1 },
        gatherDuration: def.gatherDuration || 1.5,
        promptName: def.name
      };
    }

    // 可拾取物件：E 拾取 → 库定义完整入包
    if (obj.kind === 'item' && def && !def.worldProp) {
      record.pickup = { itemDef: def };
    }

    this.spawnedPlacements.push(record);
    return record;
  }

  ensure(backend) {
    if (!backend || !backend.scene) return;
    const { THREE } = this._getThree(backend);
    if (!THREE) return;
    if (this._created || this._buildError) return;
    this._created = true;

    try {
      this._build(backend, THREE);
      this._flushPendingMeshes();
    } catch (err) {
      this._buildError = err;
      console.error('S01WorldBuilder3D: 世界构建失败', err);
    }
  }

  /** 补建首帧前记账的放置物网格（含火堆），并兑现迟到的点燃请求 */
  _flushPendingMeshes() {
    const THREE = this._lastThree;
    if (!THREE || !this._group) return;
    const pending = this._pendingMeshes.splice(0);
    for (const item of pending) {
      if (item.campfire) {
        this._addCampfire(THREE, this._group, item.record.x, item.record.y);
        if (this._campfireLitRequested) this.setCampfireLit(true);
        continue;
      }
      const tex = new THREE.Texture();
      if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(item.art.width, item.art.height),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, depthWrite: false })
      );
      mesh.position.set(item.x, item.art.height / 2 + 2, item.record.y);
      mesh.renderOrder = 2;
      this._group.add(mesh);
      this._propMeshes.push(mesh);
      item.record.mesh = mesh;
      this._loadTexture(tex, item.art.src);
    }
  }

  update(backend) {
    if (this._propMeshes.length > 0) {
      const cam = backend.camera?.native;
      if (cam) {
        for (const mesh of this._propMeshes) {
          const dx = cam.position.x - mesh.position.x;
          const dz = cam.position.z - mesh.position.z;
          mesh.rotation.y = Math.atan2(dx, dz);
        }
      }
    }

    // 火光闪烁（点燃后）
    if (this._campfire?.lit && this._campfire.light) {
      const t = Date.now() * 0.004;
      this._campfire.light.intensity = 1.8 + Math.sin(t * 3) * 0.4;
    }
  }

  _build(backend, THREE) {
    const pd = this.pd;

    // 场景背景色
    try {
      const bg = new THREE.Color(pd.backgroundColor);
      backend.scene.background = bg;
    } catch (_) { /* noop */ }

    // 隐藏引擎默认地面与网格
    this._hideDefaultGround(backend);

    const group = backend.floorGroups?.get('ground') || backend.scene;
    this._lastThree = THREE;
    this._group = group;

    // 1) 背景与装饰 image 对象 → 地面/立面（renderOrder 固定，保证叠放次序确定）
    for (const layer of pd.allLayers) {
      if (layer.id === 'S01-logic') continue;
      for (const obj of (layer.objects || [])) {
        if (obj.type === 'image' && (obj.imageId || obj.imageSrc)) {
          const src = pd.sceneImageSrc(obj.imageId || obj.imageSrc);
          let order = null;
          if (obj.semanticRole === 'sceneBackground') order = -30;
          else if (obj.semanticRole === 'sceneImage') order = -28;
          else if (layer.id === 'layer_deco') order = -26;
          if (order !== null) {
            this._addGroundPlane(backend, THREE, group, {
              src, x: obj.x, y: obj.y, width: obj.width, height: obj.height,
              lift: obj.semanticRole === 'sceneBackground' ? 0.5 : 1.0,
              renderOrder: order
            });
          }
        } else if (obj.type === 'ellipse' && obj.fillMode === 'image' && obj.imageSrc) {
          // 地形椭圆底图：平铺
          this._addGroundPlane(backend, THREE, group, {
            src: pd.sceneImageSrc(obj.imageSrc),
            x: obj.x, y: obj.y, width: obj.width, height: obj.height,
            lift: 0, renderOrder: -40, tile: { repeatX: 8, repeatY: 5 }
          });
        }
      }
    }

    // 2) 填色 shape（河道等多边形，opacity>0）→ 颜色平面
    for (const layer of pd.allLayers) {
      for (const obj of (layer.objects || [])) {
        if (obj.type === 'shape' && obj.shapeType === 'polygon' &&
            Array.isArray(obj.points) && obj.points.length >= 3 &&
            obj.fill && (obj.opacity ?? 1) > 0.01) {
          this._addShapePlane(backend, THREE, group, obj);
        }
      }
    }

    // 3) 常驻放置物（未门控；enemy 由宿主生成实体，player 为出生点）
    for (const obj of pd.placementObjects()) {
      if (obj.spawnWhen) continue;          // 门控放置物由 commitFact 重评估生成
      if (obj.ref === 'player') continue;   // 玩家出生点
      if ((obj.ref || '').startsWith('enemy.')) continue;
      this.spawnPlacement(obj);
    }

    // 4) 非背景层的独立图片对象（如庇护所预备木柴）→ billboard
    for (const layer of pd.allLayers) {
      if (layer.id === 'layer_bg') continue;
      for (const obj of (layer.objects || [])) {
        if (obj.type === 'image' && obj.imageId && obj.id !== 'S01-bg-environment' &&
            !obj.id.startsWith('obj_1791')) {
          const src = pd.sceneImageSrc(obj.imageId);
          this._addBillboard(backend, THREE, group, {
            src, x: obj.x + (obj.width || 64) / 2, y: obj.y + (obj.sortYOffset || 0) + (obj.height || 56) / 2,
            width: obj.width || 64, height: obj.height || 56
          });
        }
      }
    }
  }

  /**
   * 火堆（2D 原图两态 + 点光源）：未燃 prop-campfire-unlit / 燃烧 prop-campfire-lit
   */
  _addCampfire(THREE, group, x, y) {
    const w = 96, h = 64;   // 2D 原图 144×96，按 2/3 比例贴地呈现
    const tex = new THREE.Texture();
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.position.set(x, h / 2 + 2, y);
    mesh.renderOrder = 2;
    group.add(mesh);
    this._propMeshes.push(mesh);

    // 点光源（未燃时灭）
    const light = new THREE.PointLight(0xff8833, 0, 320);
    light.position.set(x, 40, y);
    group.add(light);
    this._campfire = { mesh, tex, light, lit: false };

    this._loadTexture(tex, this.pd.sceneImageSrc('s01.prop.campfireUnlit') ||
      '../sanguo_zhangjiao/assets/images/s01/prop-campfire-unlit.png');
  }

  /**
   * 火堆点燃：切 2D 燃烧原图 + 点亮光源（每帧 flicker 由 update 驱动）
   */
  setCampfireLit(lit) {
    if (lit) this._campfireLitRequested = true;   // 网格未建时先记账，flush 后兑现
    if (!this._campfire || this._campfire.lit === lit) return;
    this._campfire.lit = lit;
    const litSrc = this.pd.sceneImageSrc('s01.prop.campfireLit') ||
      '../sanguo_zhangjiao/assets/images/s01/prop-campfire-lit.png';
    this._loadTexture(this._campfire.tex, litSrc);
  }

  /** 贴图地面平面（2D 矩形 → XZ） */
  _addGroundPlane(backend, THREE, group, { src, x, y, width, height, lift = 0, tile = null, renderOrder = -10 }) {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;
    if (tile) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(tile.repeatX, tile.repeatY);
    }

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x + width / 2, lift, y + height / 2);
    mesh.renderOrder = renderOrder;
    group.add(mesh);
    this._loadTexture(tex, src);
  }

  /** 填色多边形平面（shape.points 为场景绝对坐标） */
  _addShapePlane(backend, THREE, group, obj) {
    const shape = new THREE.Shape();
    obj.points.forEach(([px, py], i) => {
      if (i === 0) shape.moveTo(px, -py);
      else shape.lineTo(px, -py);
    });
    shape.closePath();
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);   // (x, y) → (x, 0, y)

    const color = new THREE.Color(obj.fill);
    const opacity = Math.min(1, obj.opacity ?? 1);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      color, transparent: opacity < 1, opacity,
      depthWrite: false
    }));
    mesh.position.y = 0.25;
    mesh.renderOrder = -8;
    group.add(mesh);
  }

  /** 资源节点/物件 billboard（底部中心锚点，每帧面向相机） */
  _addBillboard(backend, THREE, group, { src, x, y, width, height }) {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.05,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    mesh.position.set(x, height / 2 + 2, y);
    mesh.renderOrder = 2;
    group.add(mesh);
    this._propMeshes.push(mesh);
    this._loadTexture(tex, src);
  }

  _loadTexture(tex, src) {
    if (!src) {
      console.warn('S01WorldBuilder3D: 贴图路径无法解析，跳过加载');
      return;
    }
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
    };
    img.onerror = () => {
      console.warn('S01WorldBuilder3D: 贴图加载失败', src);
    };
    img.src = src;
  }

  _hideDefaultGround(backend) {
    try {
      if (backend._defaultGround) backend._defaultGround.visible = false;
      const groundGroup = backend.floorGroups?.get('ground');
      if (groundGroup) {
        for (const child of groundGroup.children) {
          if (child.isGridHelper || child.geometry?.type === 'GridHelper') {
            child.visible = false;
          }
        }
      }
    } catch (_) { /* noop */ }
  }

  _getThree(backend) {
    if (backend && backend.THREE) return { THREE: backend.THREE };
    return { THREE: null };
  }
}

export default S01WorldBuilder3D;

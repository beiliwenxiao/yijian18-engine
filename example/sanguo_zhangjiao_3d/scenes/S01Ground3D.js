/**
 * S01Ground3D - S01「寒风荒野求生」3D 地面与场景道具
 *
 * 把 2D 版 S01 的地图美术（assets/scenes/S01.json 的背景层）铺进 3D 世界：
 * - 2D 坐标 (x, y) → THREE 世界 (x, 0, y)，与实体/火堆的坐标映射一致
 * - 背景大图 3 张 + huangdi2 底图平铺（来自 example/sanguo_zhangjiao/assets/）
 * - 2D 场景资源节点（野果丛/枯木/苹果林/逃生藤蔓）以 billboard 面片呈现
 *   （与 2D manifest 的 runtime3D: billboard 声明一致）
 *
 * 2D 布局参照（assets/scenes/S01.json）：
 * - 干旱荒原地貌 (0, -1.28, 1280×720)
 * - s01_right.png (448.06, -220.8, 1542×829)
 * - s01_bg_r3_c2.png (0.29, 719, 1280×720)
 * - 地形椭圆 huangdi2 平铺 (-416.7, -313.6, 2075×1223)
 */

// 2D 游戏美术根目录（相对 3D demo 页面）
const ART_BASE = '../sanguo_zhangjiao/assets/images/';

// 2D S01.json 背景层大图（按 2D 摆放矩形）
const GROUND_LAYERS = [
  {
    id: 's01-ground-base',
    src: ART_BASE + 'huangdi2.png',
    x: -416.72, y: -313.61, width: 2075, height: 1223,
    tile: { repeatX: 8, repeatY: 5 },
    lift: 0
  },
  {
    id: 's01-ground-wilderness',
    src: ART_BASE + 's01/drought-wilderness-ground.png',
    x: 0, y: -1.28, width: 1280, height: 720,
    lift: 0.5
  },
  {
    id: 's01-ground-right',
    src: ART_BASE + 's01/s01_right.png',
    x: 448.06, y: -220.84, width: 1542, height: 829,
    lift: 0.9
  },
  {
    id: 's01-ground-r3c2',
    src: ART_BASE + 's01/s01_bg_r3_c2.png',
    x: 0.29, y: 719.04, width: 1280, height: 720,
    lift: 1.3
  }
];

// 2D S01.json 场景资源节点（billboard 面片，bounds 取自 assets.json manifest）
const GROUND_PROPS = [
  { id: 's01-prop-berry-bush', src: ART_BASE + 's01/wild-berry-node.png', x: 487, y: 677, width: 68, height: 58 },
  { id: 's01-prop-wood-1', src: ART_BASE + 's01/dry-wood-node.png', x: 116.6, y: 394.3, width: 64, height: 56 },
  { id: 's01-prop-wood-2', src: ART_BASE + 's01/dry-wood-node.png', x: 245.6, y: 348.2, width: 64, height: 56 },
  { id: 's01-prop-wood-3', src: ART_BASE + 's01/dry-wood-node.png', x: 639.8, y: 636.4, width: 64, height: 56 },
  { id: 's01-prop-apple-thicket', src: ART_BASE + 's01/apple-thicket.png', x: 195.9, y: 359.3, width: 80, height: 68 },
  { id: 's01-prop-cliff-vine', src: ART_BASE + 's01/cliff-vine.png', x: 1280, y: 340, width: 92, height: 170 }
];

export class S01Ground3D {
  constructor() {
    this._created = false;
    this._propMeshes = [];
    this._pendingLoads = 0;
  }

  /**
   * 确保 3D 地面与道具已创建（每帧调用，内部只创建一次）
   */
  ensure(backend) {
    if (!backend || !backend.scene) return;
    const { THREE } = this._getThree(backend);
    if (!THREE) return;

    if (!this._created) {
      this._created = true;
      this._create(backend, THREE);
    }
  }

  /**
   * 每帧更新：道具 billboard 面向相机
   */
  update(backend) {
    if (this._propMeshes.length === 0) return;
    const cam = backend.camera?.native;
    if (!cam) return;
    for (const mesh of this._propMeshes) {
      const dx = cam.position.x - mesh.position.x;
      const dz = cam.position.z - mesh.position.z;
      mesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  _create(backend, THREE) {
    // 场景背景色对齐 2D S01 backgroundColor #4b4337
    try {
      backend.scene.background = new THREE.Color(0x4b4337);
    } catch (_) { /* noop */ }

    // 隐藏引擎默认的绿色地面与网格线
    this._hideDefaultGround(backend);

    // 背景大图 → 地面平面
    const groundGroup = backend.floorGroups?.get('ground') || backend.scene;
    for (const layer of GROUND_LAYERS) {
      this._createGroundLayer(backend, THREE, groundGroup, layer);
    }

    // 场景资源节点 → billboard 面片
    for (const prop of GROUND_PROPS) {
      this._createProp(backend, THREE, groundGroup, prop);
    }
  }

  _createGroundLayer(backend, THREE, group, layer) {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;

    if (layer.tile) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(layer.tile.repeatX, layer.tile.repeatY);
    }

    const geom = new THREE.PlaneGeometry(layer.width, layer.height);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true
    });
    const mesh = new THREE.Mesh(geom, mat);
    // 2D 矩形 → 世界平面：2D (x, y) → (x, 0, y)，图片顶部朝 -Z
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(layer.x + layer.width / 2, layer.lift, layer.y + layer.height / 2);
    mesh.renderOrder = -10;
    group.add(mesh);

    // 异步加载贴图
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
    };
    img.onerror = () => {
      console.warn('S01Ground3D: 背景图加载失败', layer.src);
    };
    img.src = layer.src;
  }

  _createProp(backend, THREE, group, prop) {
    const tex = new THREE.Texture();
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    if ('SRGBColorSpace' in THREE) tex.colorSpace = THREE.SRGBColorSpace;

    const geom = new THREE.PlaneGeometry(prop.width, prop.height);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    // 锚点底部中心（与 2D pivot y=1 一致）
    mesh.position.set(prop.x, prop.height / 2 + 2, prop.y);
    mesh.renderOrder = 2;
    group.add(mesh);
    this._propMeshes.push(mesh);

    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
    };
    img.onerror = () => {
      console.warn('S01Ground3D: 道具图加载失败', prop.src);
    };
    img.src = prop.src;
  }

  _hideDefaultGround(backend) {
    try {
      if (backend._defaultGround) {
        backend._defaultGround.visible = false;
      }
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
    if (backend && backend.THREE) {
      return { THREE: backend.THREE };
    }
    return { THREE: null };
  }
}

export default S01Ground3D;

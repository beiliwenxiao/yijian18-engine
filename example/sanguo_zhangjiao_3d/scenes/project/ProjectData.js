/**
 * ProjectData - 2D 工程数据装载器（3D 数据驱动宿主 M0）
 *
 * 直接读取 2D 游戏的同源数据，不在 3D 侧复刻任何内容定义：
 * - game.project.json          工程主档（场景注册、storyState、初始状态）
 * - assets/scenes/S01.json     S01 场景地形（背景层/形状层/出生与放置/交互绑定）
 * - project/dialogues.json     对话库
 * - project/quests.json        任务库
 * - project/library.json       内容库（items/resourceNodes/enemies/...）
 * - assets/manifests/assets.json  美术资产清单（imageId → 文件路径 + 尺寸）
 */

const BASE = '../sanguo_zhangjiao/';

export class ProjectData {
  constructor({ project, sceneJson, dialogues, quests, tutorials, triggers, library, manifest }) {
    this.project = project;
    this.sceneJson = sceneJson;
    this.dialogues = dialogues;
    this.quests = quests;
    this.tutorials = tutorials;
    // 注意：triggers 必须存 _triggers——若存 this.triggers 会遮蔽同名方法，
    // 导致 pd.triggers('trg_s01') 报 "is not a function"，整条工程数据链失效
    this._triggers = triggers;
    this.library = library;
    this.manifest = manifest;

    // imageId → 清单条目 索引
    this._assetIndex = new Map();
    for (const asset of (manifest?.assets || [])) {
      this._assetIndex.set(asset.imageId || asset.assetId, asset);
    }

    // 内容库定义索引（跨分区按 id 查找）
    this._defIndex = new Map();
    for (const section of ['items', 'resourceNodes', 'enemies', 'npcs', 'buildings']) {
      for (const def of (library?.[section] || [])) {
        if (def?.id && !this._defIndex.has(def.id)) {
          this._defIndex.set(def.id, def);
        }
      }
    }
  }

  static async load() {
    const [project, sceneJson, dialogues, quests, tutorials, triggers, library, manifest] = await Promise.all([
      fetch(BASE + 'game.project.json').then(r => r.json()),
      fetch(BASE + 'assets/scenes/S01.json').then(r => r.json()),
      fetch(BASE + 'project/dialogues.json').then(r => r.json()),
      fetch(BASE + 'project/quests.json').then(r => r.json()),
      fetch(BASE + 'project/tutorials.json').then(r => r.json()),
      fetch(BASE + 'project/triggers.json').then(r => r.json()),
      fetch(BASE + 'project/library.json').then(r => r.json()),
      fetch(BASE + 'assets/manifests/assets.json').then(r => r.json())
    ]);
    return new ProjectData({ project, sceneJson, dialogues, quests, tutorials, triggers, library, manifest });
  }

  /** S01 触发器（id 前缀过滤，含全量 do 命令链） */
  triggers(scenePrefix = 'trg_s01') {
    return (this._triggers || []).filter(t => (t.id || '').startsWith(scenePrefix));
  }

  /** 教程定义 */
  tutorial(tutorialId) {
    return (this.tutorials || []).find(t => t.id === tutorialId) || null;
  }

  /** 任务全步骤（含 type/target/action —— 目标步按事实推进，动作步随激活执行） */
  questFullSteps(questId) {
    const q = this.quest(questId);
    return (q?.steps || []).map(s => ({
      title: s.title,
      type: s.type,
      target: s.target || null,
      objectiveType: s.objectiveType || null,
      action: s.action || null,
      params: s.params || null,
      dialogueId: s.dialogueId || null,
      tutorialId: s.tutorialId || null,
      operation: s.operation || null
    }));
  }

  /** 场景背景色（S01.json backgroundColor） */
  get backgroundColor() {
    return this.sceneJson?.backgroundColor || '#4b4337';
  }

  /** 场景各层对象（拍平：layer_bg / layer_routes / S01-spawns / layer_deco / S01-logic） */
  layerObjects(layerId) {
    const layer = (this.sceneJson?.layers || []).find(l => l.id === layerId);
    return layer?.objects || [];
  }

  /**
   * 全层 ref 放置物（2D SceneAssetCollector/PlacementRuntime 同口径：不分层收集 type==='ref'）。
   * 注意不能只扫 S01-spawns——S01.json 的野果丛/枯木等资源节点实际挂在 layer_deco，
   * 只扫 spawns 层会导致采集链永远无物可采（实测）。
   */
  placementObjects() {
    const out = [];
    const seen = new Set();
    for (const layer of this.allLayers) {
      for (const obj of (layer?.objects || [])) {
        if (obj?.type === 'ref' && obj.id && !seen.has(obj.id)) {
          seen.add(obj.id);
          out.push(obj);
        }
      }
    }
    return out;
  }

  get allLayers() {
    return this.sceneJson?.layers || [];
  }

  /** 按 id 查场景对象（含各层） */
  sceneObject(objectId) {
    for (const layer of this.allLayers) {
      const hit = (layer.objects || []).find(o => o.id === objectId);
      if (hit) return hit;
    }
    return null;
  }

  /** 出生点坐标（spawns 层 type=spawn / ref 物件） */
  spawnPoint(objectId) {
    const obj = this.sceneObject(objectId);
    if (!obj) return null;
    return { x: obj.x, y: obj.y };
  }

  /** 交互绑定（S01-logic 层 trigger 对象） */
  get interactBindings() {
    return this.layerObjects('S01-logic').filter(o => o.type === 'trigger' && o.event === 'interact');
  }

  /** 绑定目标的世界坐标（targetMode=id → 按 id 找场景对象） */
  bindingTargetPosition(binding) {
    if (binding.targetMode !== 'id') return null;
    const target = this.sceneObject(binding.target);
    return target ? { x: target.x, y: target.y } : null;
  }

  /** 内容库定义（跨 items/resourceNodes/enemies 查找） */
  definition(defId) {
    return this._defIndex.get(defId) || null;
  }

  /** 定义 → 美术信息 { src, width, height }（library imageId → manifest runtime2D） */
  definitionArt(defId) {
    const def = this.definition(defId);
    const imageId = def?.imageId || def?.assetId;
    if (!imageId) return null;
    const asset = this._assetIndex.get(imageId);
    const path = asset?.runtime2D?.path || asset?.sourceFile;
    if (!path) return null;
    return {
      src: this._normalizePath(path),
      width: asset?.bounds?.width || def?.sprite?.width || 64,
      height: asset?.bounds?.height || def?.sprite?.height || 64
    };
  }

  /** imageId/imageSrc → 可加载 URL：先查场景 imageAssets 表，再回退美术清单 */
  sceneImageSrc(imageIdOrSrc) {
    const table = this.sceneJson?.imageAssets || {};
    const entry = table[imageIdOrSrc];
    let norm = this._normalizePath(entry?.src || imageIdOrSrc);
    if (!norm) {
      // 回退：内容库资产清单（manifest）按 imageId 查
      const asset = this._assetIndex.get(imageIdOrSrc);
      const path = asset?.runtime2D?.path || asset?.sourceFile;
      if (path) norm = this._normalizePath(path);
    }
    return norm;
  }

  /** 归一化资产路径 → 相对 3D demo 页面可 fetch 的地址 */
  _normalizePath(path) {
    if (!path) return null;
    // 形如 "assets/images/..." 或 "../example/sanguo_zhangjiao/assets/..."，统一取 assets/ 段
    const idx = path.lastIndexOf('assets/');
    if (idx === -1) return null;
    return BASE + path.slice(idx);
  }

  dialogue(dialogueId) {
    return (this.dialogues || []).find(d => d.id === dialogueId) || null;
  }

  quest(questId) {
    return (this.quests || []).find(q => q.id === questId) || null;
  }

  /** 任务 HUD 步骤（只取 objective 步，与 2D 任务追踪口径一致） */
  questObjectiveSteps(questId) {
    const q = this.quest(questId);
    if (!q) return [];
    return (q.steps || []).filter(s => s.type === 'objective').map(s => s.title);
  }
}

export default ProjectData;

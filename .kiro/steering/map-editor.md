---
inclusion: fileMatch
fileMatchPattern: 'editor/**'
---

# 地图编辑器开发指南

## 概述

地图编辑器位于 `editor/` 目录下。编辑器核心已模块化拆分；通用默认值位于 `editor/config/`，游戏级资源定义保留在当前游戏目录。共享 atlas 由 `editor/config/atlases.json` 的 `$ref` 定位，禁止在编辑器配置、场景正文和运行时代码中再复制切片坐标。

## 模块架构

### 文件结构

```
editor/
├── index.html                    ← 编辑器入口页面（游戏列表 + 场景/UI 编辑器切换）
├── styles/
│   └── scene-editor.css          ← 场景编辑器所有样式（独立 CSS 文件）
├── config/
│   ├── editor-defaults.json      ← 编辑器核心默认值
│   ├── scene-presets.json        ← 预设场景配置
│   ├── scene-templates.json      ← 场景模板（多套可复用的新建场景初始数据）
│   ├── deco-sprites.json         ← 非共享 legacy 装饰物精灵配置
│   ├── atlases.json              ← 当前游戏共享图集配置的 $ref 索引
│   └── builtin-games.json        ← 内置游戏列表
├── SceneEditor.js                ← 主入口：构造函数 + 事件绑定 + 组合模块 + 兼容 API
├── SceneEditorUI.js              ← UI 面板初始化、属性面板更新、缩放、拖拽分隔条
├── SceneEditorCanvas.js          ← Canvas 渲染（场景、网格、对象、地形、选中框）
├── SceneEditorInteraction.js     ← 鼠标/键盘事件处理、右键菜单、对象拾取、缩放手柄
├── SceneEditorLayers.js          ← 图层管理（增删排序、批量操作、规范化、装饰物合并）
├── SceneEditorAssets.js          ← 资源管理（图集、切片、拖放、图片加载）
├── SceneEditorHistory.js         ← 撤销/重做、保存/导出/导入
├── EditorDataManager.js          ← 游戏/场景数据管理（localStorage 读写）
├── SceneDataLoader.js            ← 从预设加载场景，提供图集/切片数据
├── SceneDataExporter.js          ← 把代码定义的场景转换成可编辑的 JSON 数据
├── ImageSlicer.js                ← 图片切片工具
└── UIEditor.js                   ← UI 编辑器
```

### 模块职责与通信

| 模块 | 职责 | 大约行数 |
|------|------|---------|
| `SceneEditor.js` | 主入口，构造函数，事件绑定，组合所有子模块，提供兼容旧 API | ~280 |
| `SceneEditorUI.js` | UI 面板 HTML 生成、属性面板、工具模式切换、缩放控制、拖拽分隔条 | ~400 |
| `SceneEditorCanvas.js` | 所有 Canvas 渲染：场景背景、网格、各类对象、地形效果、选中框 | ~360 |
| `SceneEditorInteraction.js` | 鼠标/键盘事件、右键菜单、对象拾取、缩放手柄检测、装饰物/对象层次调整 | ~310 |
| `SceneEditorLayers.js` | 图层增删排序、移动对象到图层、批量深度/偏移/去重、图层规范化、装饰物合并 | ~320 |
| `SceneEditorAssets.js` | 图集/切片管理、拖放到场景、精灵列表、图集图片加载、切片预览 | ~310 |
| `SceneEditorHistory.js` | 撤销/重做栈、保存触发回调、JSON 导出/导入 | ~120 |
| `styles/scene-editor.css` | 编辑器所有样式（从 JS 动态注入改为外部 CSS link） | ~100 |

**通信方式**：各子模块构造时接收 `editor`（主 SceneEditor 实例）引用，通过它访问共享状态：
- `editor.sceneData` — 场景数据
- `editor.selectedObjects` — 选中对象数组
- `editor.activeLayerIndex` — 当前激活图层索引
- `editor.viewport` — 视口状态（scale, offsetX, offsetY）
- `editor.interaction` — 交互状态（mode, isDragging 等）
- `editor.loadedImages` — 已加载的图片缓存 Map
- `editor.options` — 编辑器配置项

**子模块互相调用**通过 editor 实例上的引用：
- `editor.ui` — SceneEditorUI 实例
- `editor.canvas` — SceneEditorCanvas 实例
- `editor.interactionModule` — SceneEditorInteraction 实例
- `editor.layers` — SceneEditorLayers 实例
- `editor.assets` — SceneEditorAssets 实例
- `editor.history` — SceneEditorHistory 实例

### UI 布局

编辑器主界面为三栏布局（左中右）：
- **左侧边栏**：资源库（精灵/图集标签页）+ 选中切片属性
- **中间画布**：Canvas 场景绘制区 + 缩放控件
- **右侧边栏**：图层管理 + 选中对象属性 + 场景信息

三栏之间有可拖拽的分隔条（`.editor-resizer`），用户可以左右拖动调整各面板宽度（范围 120px~500px）。

## JSON 配置文件结构

### `editor/config/editor-defaults.json`
编辑器核心默认值：
- `editor` — 编辑器画布尺寸、网格、显示开关
- `scene` — 新场景默认名称、宽高、背景色、默认图层定义
- `viewport` — 视口初始缩放/偏移
- `history` — 撤销/重做栈最大深度

### `editor/config/scene-presets.json`
所有预设场景配置：
- `assetBase` — 资源根路径
- `scenes` — 按场景 ID 索引的预设数据（name, width, height, backgroundColor, centerX, centerY, basinRadius, basinAspectY, terrain 等）
- `sceneNames` — 场景代码名 → 显示名称 的映射
- `presetScenesList` — 预设场景列表（id, name, type）

### `editor/config/scene-templates.json`
场景模板配置（**多套**可复用的新建场景初始数据）：
- `defaultTemplateId` — 新建场景时默认选中的模板 id
- `templates[]` — 模板数组，每个模板：
  - `id` / `name` / `description` / `category` / `thumbnail`
  - `scene` — 模板的场景初始数据，**与真实场景 JSON 同构**（`width, height, backgroundColor, type, terrain, layers[], decoSprites, atlases` 等）。这是核心设计：新建时只需深拷贝 `scene` + 换 id/name，无需转换；编辑模板时直接把这份 `scene` 丢给场景编辑器打开。

与 `scene-presets.json` 的区别：presets 是三国 demo 里**已有的具体场景实例**；templates 是**通用可复用的初始骨架**（户外/室内/战场/空白等）。与 `editor-defaults.json.scene` 的区别：后者是"无模板时的最小空场景兜底"。

### `editor/config/deco-sprites.json`
非共享 legacy 装饰物精灵配置：
- `mountain_landscape` 已登记切片不得出现在这里，避免与游戏级 atlas 形成竞争坐标源
- `outdoor` / `indoor` 只保留尚未迁移为稳定 atlas 引用的旧装饰定义

### `editor/config/atlases.json`
当前游戏共享图集索引：
- 本文件只保存 `$ref`，指向当前游戏的 `config/atlases.json`
- 游戏级文件是 atlas 元数据与全部 slice 裁剪区域的单一事实源
- 每个 atlas 使用稳定 `assetId === imageId`，图片路径由 Manifest 映射；每个场景只保存 `atlasId/sliceKey`
- `SceneEditor`、`WorldMapEditor` 和运行时统一通过 `AtlasRegistry` 解析；场景内 `atlases` 仅作旧数据只读 fallback，不能覆盖同 ID 的共享定义
- 运行时硬依赖的 atlas/slice 必须登记在 `game.project.json -> extensions.atlases.requiredReferences[]`（`atlasId + sliceKeys[]`）；`/api/asset-transaction` 在磁盘 commit point 前验证这组项目级引用，禁止只靠运行时 JS 抛错而让编辑器先删除依赖
- 共享 catalog 保存必须对发送候选做独立快照；请求期间继续产生的编辑保留为 dirty 草稿并提示再次保存，只有草稿仍等于已发送候选时才允许清空，切换项目后的迟到成功也不得刷新当前项目缓存
- `WorldMapEditor` 必须在渲染缩略图前等待共享 catalog 与图片加载，并给 fake editor 注入同一组 `getAtlasDefinition/getAtlasSlice`；直接读取 `config.atlases` 会因 `$ref` 得到空列表，是缩略图退化为色块的根因

### `editor/config/builtin-games.json`
内置游戏列表：
- `games[]` — 包含 id, name, description, thumbnail, path, scenes

## 模块加载流程

1. 编辑器启动时，各模块异步加载对应 JSON 配置
2. atlas 索引若含 `$ref`，必须先解析目标游戏配置再公开 catalog；加载失败只能回退到静态导入的同一游戏级 JSON，禁止回退到代码内切片坐标
3. 配置加载后按规范化 `projectPath` 缓存在 `SceneDataLoader` 的 catalog/loadPromise Map 中；无参读取只投影当前活动项目。项目切换入口必须在首个 `await` 前同步调用 activation，使未加载项目的 legacy 投影立即清空并推进 `SceneEditor` epoch；显式项目 cache miss 禁止回退其他项目，图片异步请求也必须使用发起时捕获的 projectPath。
4. 切换项目的消费者必须同时失效自身图片和 registry 投影；保存迟到成功先更新请求所属项目分区，只有 activation epoch 仍匹配时才刷新当前 UI。

### 初始化顺序
```javascript
// index.html 中的初始化流程：
import { SceneEditor, loadEditorDefaults } from './SceneEditor.js';
import { EditorDataManager, loadBuiltinGamesConfig, loadScenePresetsConfig, loadSceneTemplatesConfig } from './EditorDataManager.js';

// 1. 并行加载所有配置
await Promise.all([
  loadEditorDefaults(),
  loadBuiltinGamesConfig(),
  loadScenePresetsConfig(),
  loadSceneTemplatesConfig()
]);

// 2. 初始化数据管理器
await dataManager.init();

// 3. 创建 SceneEditor 实例时自动组装所有子模块
const sceneEditor = new SceneEditor(containerElement);
```

### SceneEditor 构造内部流程
1. 初始化共享状态（sceneData, viewport, interaction 等）
2. 创建子模块实例：layers → history → ui → canvas → interactionModule → assets
3. `ui.initUI()` — 生成 HTML、加载 CSS、初始化画布、初始化分隔条
4. `_bindEvents()` — 绑定工具栏按钮、Canvas 交互、键盘快捷键、资源拖放

## 模块详细说明

| 文件 | 读取的 JSON 配置 | 关键方法 |
|------|-----------------|---------|
| `SceneEditor.js` | `editor-defaults.json` | `render()`, `loadScene()`, `save()`, `exportJSON()`, `importJSON()` |
| `SceneEditorUI.js` | 无（通过主入口间接获取） | `initUI()`, `fitToContainer()`, `setMode()`, `zoom()`, `updateObjectProperties()`, `showToast()` |
| `SceneEditorCanvas.js` | 无 | `render()`, `_renderObject()`, `_renderFillObject()`, `_renderTerrainBackground()`, `_renderSelection()` |
| `SceneEditorInteraction.js` | 无 | `handleMouseDown()`, `handleMouseMove()`, `handleMouseUp()`, `handleContextMenu()`, `getObjectAt()` |
| `SceneEditorLayers.js` | 无 | `addLayer()`, `deleteLayer()`, `moveLayerUp()`, `batchSetDepth()`, `normalizeLayers()`, `mergeDecorationsToLayer()` |
| `SceneEditorAssets.js` | 无 | `setupAssetDragDrop()`, `addImageAsset()`, `updateAssetLibrary()`, `loadAtlasImages()` |
| `SceneEditorHistory.js` | 无 | `saveHistory()`, `undo()`, `redo()`, `save()`, `exportJSON()`, `importJSON()` |
| `EditorDataManager.js` | `builtin-games.json`, `scene-presets.json`, `scene-templates.json` | `init()`, `getBuiltinGames()`, `getGameScenes()`, `setCurrentScene()`, `createScene()`, `getSceneTemplates()`, `upsertSceneTemplate()` |
| `SceneDataLoader.js` | `scene-presets.json`、`deco-sprites.json`、`atlases.json` → 游戏级 `$ref` | `loadScene()`, `loadGlobalAtlasesConfig()` |
| `SceneDataExporter.js` | `scene-presets.json`；atlas 由调用方注入 | `exportPrologueScene()` |

## 修改默认值的方式

**不要直接修改 JS 代码中的硬编码值**，而是修改 `editor/config/` 下对应的 JSON 文件。例如：

- 想修改默认背景色：编辑 `editor-defaults.json` 的 `scene.backgroundColor`
- 想添加新场景预设：在 `scene-presets.json` 的 `scenes` 中增加条目
- 想添加新场景模板：在 `scene-templates.json` 的 `templates` 中增加条目（或在编辑器里点「📐 场景模板 → + 新建模板」可视化编辑并自动写回）
- 想修改未迁移的 legacy 装饰坐标：编辑 `deco-sprites.json`；已属于 atlas 的 key 禁止放入该文件
- 想添加或修改共享图集：编辑当前游戏 `config/atlases.json`，同步 Manifest 稳定 ID；不要把定义追加到场景 JSON 或 `editor/config/atlases.json`

## 扩展新功能的方式

1. **新增渲染功能**：在 `SceneEditorCanvas.js` 中添加方法
2. **新增交互功能**：在 `SceneEditorInteraction.js` 中添加处理器
3. **新增图层操作**：在 `SceneEditorLayers.js` 中添加方法
4. **新增资源类型**：在 `SceneEditorAssets.js` 中扩展拖放和列表
5. **新增 UI 面板**：在 `SceneEditorUI.js` 中添加 HTML 和初始化逻辑
6. **如果需要全新的独立功能域**：创建新的 `SceneEditorXxx.js` 模块，在 `SceneEditor.js` 中实例化并挂载到 `this.xxx`

## 装饰物统一管理（type:'deco'）

### 数据统一
- 旧格式 `sceneData.decorations[]`（`{x, y, key, scale}`，底部中心锚点）已废弃
- atlas 装饰物统一为 `type:'slice'`，格式 `{type:'slice', atlasId, sliceKey, x, y, width, height, scale, name}`；锚点是**左上角**
- 尚未迁移到 atlas 的 legacy 装饰才使用 `type:'deco' + decoKey`
- 显式迁移旧 `decorations` 时，`SceneEditorLayers.mergeDecorationsToLayer()` 先通过共享 `AtlasRegistry` 按 key 查切片；命中后生成稳定 `atlasId/sliceKey`，不得把裁剪矩形复制进对象

### 锚点转换（编辑器 → 游戏）
- 编辑器存储：左上角锚点 `(x, y, width, height)`
- 游戏使用：底部中心锚点 `(x + width/2, y + height)`
- `Scene1Terrain._applySceneData()` 中自动转换

### 类型匹配
- 凡是涉及 `obj.type` 判断的位置（点击检测、缩放手柄、选中框、属性面板宽高显示），都需要包含 `|| obj.type === 'deco'`
- 批量操作（深度/去重）筛选时同时检查 `obj.decoKey`、`obj.sliceKey`、`obj.name` 三个字段，任一匹配即命中

### 游戏侧渲染策略（混合策略）
- **非碰撞装饰物**（`sprite.collide === false`，如 grass1、bush2/3/4）：预渲染到离屏缓存 `_groundDecoCache`，作为整体一次绘制，始终在最底层
- **碰撞装饰物**（`sprite.collide === true`，如 tree1/2/3）：参与 Y-sort，互相之间和与实体之间正确遮挡
- **场景图片**：普通 `type:'image'` 继续进入 `_bgImageCache` 地面层；需要与角色互相遮挡的建筑、棚屋、车辆或旗帜必须设置 `depthSort:true`，并可用 `sortY` 指定世界脚底基线（省略时为 `y + height`）。编辑器图片属性面板提供“实体遮挡/排序基线Y”，画布以青色虚线显示基线，运行时由 `Scene1Terrain.collectDecorations()` 加入同一队列。
- 所有 `type:'image'` 对象必须填写 `name` 与 `semanticRole`，并用 `visualDescription` 说明它代表的地貌、建筑、物件或构图用途；有完整/受损/燃烧等表现差异时再填写 `state`。编辑器画布按“对象 name → imageAssets 资源 name → imageId”的优先级显示黄色标签，属性面板可直接编辑上述语义字段。`shape` 与 `effectZone` 同样填写 `semanticRole/visualDescription`，从而让透明碰撞区、通路和粒子区不再成为无法辨认的色块。
- 场景级背景使用独立稳定 ID，标准尺寸为 `1280×720`。Manifest 的背景条目除基础字段外还应提供 `displayName` 和结构化 `replacementBrief`（`sceneIds/subject/mustShow/mustPreserve/camera/palette/textPolicy/replacesPlaceholderId`）；正式背景禁止烘焙操作文字，地貌和建筑名称由编辑器标签与 brief 表达。
- 图片 `rotation` 的场景数据单位统一为**度**，编辑器与 Canvas 运行时均在绘制时转换为弧度；禁止一端按度、一端直接传给 `ctx.rotate()`。拖动、对齐、方向键、属性面板直接修改 Y、图层批量偏移或带偏移粘贴带显式 `sortY` 的图片时，基线必须同步相同 Y 位移；只调整 width/height 时显式 `sortY` 保持用户指定的世界脚底线，不随外框拉伸。
- `sortY` 属于 Y 坐标，跨 chunk 时与对象 `y/points` 一起且只应用一次 worldOffset；图片碰撞仍由独立 shape 持有，禁止从透明像素或图片 bounds 推导业务碰撞。

## 图片资源管理

### 内容库 ref 所见即所得
- `type:'ref'` 的 NPC、敌人、资源节点、道具、装备、载具和建筑由 `SceneEditorAssets` 统一按 `kind/ref → project.library definition → placement.overrides → imageId/assetId → Manifest runtime2D.path` 解析；Canvas 禁止在渲染帧内发起 fetch，也不得在 Demo 另建图片解析器。
- 场景 JSON 仍只保存 `kind/ref/overrides`，不得把定义或 Manifest 表现字段复制进 placement。画布尺寸优先使用合并定义的 `sprite.width/height`，随后为定义宽高、Manifest bounds、图片自然尺寸；pivot 优先使用合并定义，再使用 Manifest，世界物件默认脚底中心 `{x:0.5,y:1}`。
- 图片主体、选中框、点击和框选必须消费同一视觉 bounds；触发区、碰撞 shape、`buffZone`、`effectZone` 等逻辑范围继续显示辅助几何，不能用图片替代其真实编辑范围。

### 添加图片流程
1. 用户先将图片文件放到项目 `example/sanguo_zhangjiao/assets/images/` 目录下（支持子文件夹）
2. 在编辑器点“添加图片”，填写 `assets/images/` 下的相对路径，并确认一个稳定 `imageId`；ID 只能包含字母、数字、点、下划线和短横线且以字母开头，禁止再用时间戳自动生成新 ID
3. 编辑器用相对路径直接加载图片，场景数据 `imageAssets[imageId]` 中保存路径和名称
4. 图片对象属性中的“图片ID”下拉用于切换到另一个已登记资源；“替换文件”只修改当前 ID 对应路径，必须保留 imageId 和全部场景引用
5. 保存图片资源时先用 `/api/save-file` 写回 `editor/config/images.json`，再 `await SceneEditorHistory.save()` 提交当前场景或模板；任一后续提交失败必须显示“配置已保存、场景未保存”的部分成功警告。全局配置由场景加载时读取，禁止遍历并改写所有场景的 localStorage 副本。
6. **不使用 base64/dataURL** — 避免 JSON 膨胀和 localStorage 配额溢出

图片切割后的 slice 不分配独立 imageId；slice 继续使用稳定源图集 ID、`sliceKey` 和裁剪数据。

### 资产审计

- 图形资源栏的“🔎 资产审计”会递归扫描当前游戏 `assets/images/`、`assets/audio/`，读取 `assets/manifests/assets.json`、`data/AudioConfig.json` 和磁盘 canonical 场景 JSON。
- 发布场景审计范围只接受 `SXX.json` 与 `SXX-CNN.json`；旧 `s0-*`、模板和其他非 canonical JSON 不得混入发布引用统计。
- 图片审计包括：重复稳定 ID、Manifest 缺失文件、未登记图片、场景 imageId/atlasId 缺失引用、无效 slice、placeholder 和 3D fallback。
- `replacesPlaceholderId` 是 Manifest 内部稳定 ID 引用；即使场景已改用成品背景，被替换的灰盒资源仍必须在同一 Manifest 登记并保留有效文件映射，否则 GameLoader 会在写入运行状态前以 `invalidReference` 拒绝整个项目。灰盒文件若作为可替换生成资源保留，可使用 `ai-generated`，不要为绕过校验只删除替换谱系字段。
- 音频审计包括：music/sfx cue 文件断链；没有任何真实 cue 时明确报告 Release Candidate 音频覆盖阻断。不存在的音频不得注册虚假 cue 或用空文件占位。
- 当前项目的资源统一按原创或已获授权处理；审计不检查授权、版权、作者或来源，也不以相关元数据阻断开发。
- 审计只生成报告，不自动登记图片或修改资源状态。
- 磁盘场景 JSON 是引用审计的事实源，localStorage 不替代磁盘文件。

### imageAssets 无损保存
- `SceneEditorHistory.save()/exportJSON()` 不得自动删除未引用 `imageAssets`；未引用资源只作为资产审计提示。
- 保存、导入、导出不执行全局坐标舍入，不改变高精度数值、字段存在性、数组顺序或 unknown-but-allowed 数据。
- 普通 canonical load/import 不执行旧 shape/decorations 迁移，也不把全局 atlas/images 合并写入场景文档；迁移必须是用户显式发起的独立操作。
- 场景仍可从全局资源库提供只读选择项，但选择项不得因此成为场景 JSON 的隐式字段。

### 游戏侧加载图片
- `Scene1Terrain._applySceneData()` 第3步读取 `type:'image'` 对象
- 从 `scene.imageAssets[obj.imageId].src` 获取路径
- **路径修正**：编辑器路径（如 `../example/sanguo_zhangjiao/assets/images/x.png`）→ 游戏路径（`assets/images/x.png`），通过截取 `assets/` 之后的部分实现

## 场景模板机制（多套可复用模板）

### 概念分层（三者各司其职，勿混淆）
```
editor-defaults.json.scene   →  无模板时的最小空场景兜底（保留）
scene-templates.json         →  多套可命名、可复用的完整初始模板（新建时套用）
游戏 canonical *.json        →  由模板生成的具体场景实例（磁盘唯一事实源）
localStorage                 →  仅作提交后的编辑器缓存，不参与合并生成场景事实
```
- `scene-presets.json`：三国 demo 里**已有的具体场景**（scene_Prologue 等），是实例配置，不是通用模板。

### 核心设计：模板 scene 与真实场景 JSON 同构
每个模板的 `scene` 字段结构 = 一份完整场景 JSON 的子集。带来两个好处：
1. **新建**只需深拷贝 `template.scene` + 分配新 id/name，无转换逻辑
2. **编辑**模板时直接把 `template.scene` 丢给场景编辑器打开，复用全部图层/椭圆/装饰/对象能力

### 新建流程（应用模板）
1. `scene-workflow.html` 收集稳定场景 ID 和名称，模板选择来自 `scene-templates.json` 的 `defaultTemplateId` 或显式选择。
2. 调用 `EditorDataManager.createSceneDraft({ id, name, templateId })` 只生成未持久化候选；不得调用 `createScene()/updateScene()` 先写 localStorage。
3. 候选只通过 `EditorSceneCommandService.create(projectPath, { scene })` 提交；必须确认 `ok:true && committed:true` 后，才调用 `initScenesFromFile()` 从磁盘 `_scene_order.json` 重建列表缓存、更新 URL 并打开新场景。磁盘已提交但 UI 刷新失败时只能提示“已提交但刷新失败”，不得回滚或伪报创建失败。

### 模板编辑入口（复用场景编辑器，零新增编辑器 UI）
入口有两个（管理弹窗已废弃删除）：
1. **筛选下拉选「场景模板」**（`#scene-filter-type` 的 `value="template"`）→ `renderSceneList()` 检测到该值时**只渲染模板项**（`_buildTemplateSectionHtml()`），每项含「编辑/×删除」+ 顶部「＋」新建
2. **场景侧栏底部「+ 新建场景模板」按钮**（`#new-template-btn`）→ `createNewTemplate()`（任意视图下都能快速新建）

- 点模板项/「编辑」→ `editSceneTemplate(id)`：进入**模板编辑态**（设 `this._editingTemplateId`，`currentSceneId=null`），用模板 `scene` 调 `sceneEditor.loadScene()`
- **保存分支**：`saveScene(data)` 检测到 `_editingTemplateId` 时 → `dataManager.upsertSceneTemplate(id, data)` 更新内存配置 → `_saveTemplatesToFile()` 通过 `/api/save-file` 写回 `editor/config/scene-templates.json`；**不**写游戏场景/触发器
- 编辑普通场景时 `editScene()` 会 `this._editingTemplateId = null` 退出模板态，两条保存路径互不干扰

### 关键坑 1：模板编辑态改名不保存
编辑器改场景名走 `onSceneMetaChange({name})` → `_handleSceneMetaChange(meta)`，但该方法开头有 `if (!this.currentGameId || !this.currentSceneId) return;`。模板态下 `currentSceneId=null` 会直接 return，名称改动丢失。
**修复**：`_handleSceneMetaChange` 开头加模板态分支 → `dataManager.updateSceneTemplateMeta(id, {name})`（**只**改元信息、不动 scene）+ `_saveTemplatesToFile()`。
配套：`upsertSceneTemplate(id, sceneData, meta)` 加防御——**仅当 `sceneData` 非空时才覆盖 `tpl.scene`**，否则"只改名"会把整个 scene 清空。

### 关键坑 2：模板项复用 `scene-item` class 导致双绑定/拖拽污染
模板项若带 `scene-item` class，会被普通场景的点击处理器和拖拽排序处理器一并选中：① 双重绑定点击（模板点击 + 场景点击，后者拿到 undefined sceneId）；② 能被拖进场景排序，`_scene_order` 里被塞入 `undefined`。
**修复**：模板项用 `scene-item template-item` 双 class，场景侧所有处理器的选择器改为 `.scene-item:not(.template-item)`；模板项点击单独由 `_bindTemplateItems()` 绑定（`data-tpl-action`）。

### 关键坑 3：模板资源库缺少新加的图片
`loadScene` 内部只 `_mergeGlobalImages()`（全局 `images.json`），但**新加的图片常只存在于某个场景自己的 `imageAssets`（localStorage），未写进全局库**。模板 `scene` 没有 per-scene imageAssets，于是缺图。
**修复**：`editSceneTemplate` 打开模板时只把模板原始 canonical 数据交给场景编辑器；全局图片作为只读资源选择项提供，不合并写入 `scene.imageAssets`。保存不得自动裁剪或扩充 imageAssets，确保无语义 round-trip 深相等。

### EditorDataManager 模板相关方法
| 方法 | 作用 |
|------|------|
| `getSceneTemplates()` | 返回 `{ defaultTemplateId, templates }` |
| `getSceneTemplate(id)` | 按 id 取单个模板 |
| `getSceneTemplatesConfig()` | 取完整配置对象（用于构造文件提交快照） |
| `replaceSceneTemplatesConfig(config)` | 用独立深拷贝替换内存配置；模板文件提交失败时恢复提交前快照 |
| `createSceneDraft({id,name,templateId,...})` | 按模板生成未持久化场景候选，正式创建仍交给 canonical command service |
| `upsertSceneTemplate(id, sceneData, meta)` | 更新/新增模板的 scene（剥离 id/时间戳等实例字段；`sceneData` 为空时只更新 meta 不动 scene） |
| `updateSceneTemplateMeta(id, meta)` | 只改模板 name/description/category，不动 scene（用于编辑器内改模板名） |
| `createSceneTemplate({name, baseTemplateId})` | 克隆基模板新建模板 |
| `deleteSceneTemplate(id)` | 删除模板（default 被删时回退首个） |

### index.html 侧模板相关方法
| 方法 | 作用 |
|------|------|
| `populateSceneTemplates()` / `onSceneTemplateChange()` | 新建弹窗模板下拉填充/切换回填宽高背景色 |
| `_buildTemplateSectionHtml()` / `_bindTemplateItems(list)` | 「场景模板」筛选视图的列表 HTML 与事件绑定 |
| `editSceneTemplate(id)` | 进入模板编辑态并加载到场景编辑器 |
| `createNewTemplate()` / `deleteTemplate(id)` | 新建/删除模板 |
| `_saveTemplatesToFile()` | 写回 `editor/config/scene-templates.json` |

### 数据一致性
模板的唯一真实数据源是 `editor/config/scene-templates.json`。任何模板增删改都必须按“捕获完整配置快照 → 修改内存草稿 → `await /api/save-file` → 严格核验 HTTP 与 `ok`”执行；提交失败使用 `replaceSceneTemplatesConfig()` 恢复快照和模板编辑态，禁止把未提交草稿留在模块级 `_sceneTemplatesConfig`。新增内置模板可直接编辑此 JSON，编辑器启动时由 `loadSceneTemplatesConfig()` 加载。

## 场景列表共享约定

场景编辑器、场景内触发器属性和独立事件编辑器必须共用 `EditorDataManager.getGameScenes(currentGameId)` 作为运行时场景列表的唯一来源。

- `index.html` 通过 `getSceneList` 回调注入当前游戏的场景列表；回调必须在调用时读取 `currentGameId`，不得捕获初始化时的游戏 id。
- `SceneEditorUI._getSceneOptions()` 和 `TriggerEditor._updateSceneFilter()` 只能调用该回调，禁止直接读取固定 localStorage key，也禁止从已存在触发器的 `sceneId` 反推完整列表。
- `EditorDataManager.initScenesFromFile()` 必须按磁盘 `_scene_order.json` 的顺序和描述整体重建列表缓存；磁盘已删除的旧 ID 必须从 localStorage 移除，不得把旧缓存合并回权威列表。
- 左侧列表显示名唯一读取 `_scene_order.json -> scenes[sceneId].name`，并应与对应场景 JSON 顶层 `name` 保持一致；不得在 `renderSceneList()` 临时读取场景正文补名。`SceneEditor` 必须保留宿主注入的 `onSceneMetaChange`，名称变更通过 `EditorSceneCommandService.update({ scene, orderEntry:{name} })` 在同一 canonical 事务中同步正文与列表条目，严格提交成功后再从磁盘重建列表缓存；提交期间禁止并发 whole-scene 保存。
- `renderSceneList()` 直接保持 `getGameScenes()` 的磁盘顺序，禁止再读取 `yijian18-engine_scene_order_*` 等独立排序键；筛选视图拖拽时只重排可见 ID，并把它们合并回完整 order，不能删除隐藏场景。
- 场景正文与相邻预览只接受磁盘、当前 canonical committed snapshot 或已登记 preset 中带完整 `layers` 的文档，列表 localStorage 元数据不得冒充场景正文。异步切换使用 generation latest-wins，较旧请求不得覆盖新场景、邻居投影、当前 sceneId 或模板编辑态。
- `scene-workflow.html` 初始进入时，先保留仍在 canonical 场景目录内的 URL `sceneId`；无效、缺失或加载失败时，必须按磁盘 `_scene_order.json` 的顺序继续尝试，首个 `loadSceneEditor() === true` 的场景立即成为当前场景、写回 URL 并由既有 `SceneEditor.loadScene()` 渲染到工作区。`null` 只表示 generation 已被较新请求取代，不得清空或回退覆盖该较新选择。
- 触发器中引用已删除场景时可单独标记为“旧引用”，但不得为显示旧引用而把该 ID 重新写入场景列表。

## 世界地图网格与规划单元

- 《三国张角传》的 A–D Region 都使用同一全局 20×20 `(row,col)` 坐标；唯一配置事实源是 `game.project.json -> worldMap.regions[].grid`。场景 JSON 只保存 chunk 局部坐标，运行时按 `worldOffset = { x: col * chunkWidth, y: row * chunkHeight }` 派生且只应用一次。
- 普通字符串单元表示可加载场景；`{ sceneId, reserved: true }` 只表示尚未完成场景的规划位置。reserved 单元必须在世界地图编辑器中可见，但不得进入加载、九宫格流式、传送、调试跳转或存档恢复目标。
- 所有调用方通过 `src/core/WorldMapCell.js` 解析单元，禁止直接把 `grid[row][col]` 当 sceneId。编辑器需要展示规划位置时显式使用 `includeReserved:true`。
- 大地图网格和场景缩略图都必须磁盘优先：网格读取当前游戏 `game.project.json`，缩略图读取同项目 `assets/scenes/<sceneId>.json`。localStorage 只允许作为编辑器缩略图/编辑会话缓存，缓存缺少完整 `layers/imageAssets` 时不得覆盖磁盘数据；《三国张角传》正式运行时不读取该缓存，磁盘读取或解析失败直接拒绝。切换游戏时必须同时更新 `gameId/projectPath`，不能复用旧实例路径。20×20 稀疏网格渲染后应自动定位当前 Region 的有效单元包围盒。
- `WorldMapEditor` 的完整网格构建只用于首次加载或项目整体切换；单格 terrain/anchor 修改必须先用候选 Region 构建并校验 `ProjectWorldIndex`，再只替换编辑格与旧/新 footprint 并集中的 DOM/canvas，禁止重新写整个网格 `innerHTML`、重绑全部单元或自动重定位滚动位置。右侧小地图底图与视口选框分层：单格修改只重画对应小地图单元；主滚动容器的 scroll/resize 只更新选框。选框坐标和点击/拖拽反向定位统一按主网格、滚动容器与小地图 canvas 的实时矩形换算并钳制，不能按固定像素猜测；重载时必须释放旧 scroll、resize、pointer 与 ResizeObserver 监听。
- 场景实现完成后，先确保磁盘场景文件与 `game.project.json.scenes[]` 元数据可加载，再把 reserved 对象替换为同 ID 字符串；不得用空场景文件冒充内容完成。

## 游戏级表现规格

- `game.project.json.presentation.$ref` 指向当前游戏唯一的 presentation profile；《三国张角传》使用 `config/presentation.json`。禁止把目标逻辑分辨率、像素比例、网格、角色视觉/占地尺寸、方向数和移动端最小字号再复制到 `editor-defaults.json` 或场景类常量。
- 运行时 Camera 和 IsometricRenderer 使用运行时逻辑视口与 profile 的 world 参数；CSS 只负责物理显示适配。编辑器经 `SceneEditor.setPresentationProfile()` 仍以 profile 的 `logicalResolution` 作为新场景 fallback，不重写已存在场景尺寸。浏览器主 Canvas 必须通过 `CanvasDisplayScaler` 将逻辑视口与物理 backing 分离：世界、相机、UI 和输入使用逻辑坐标，backing 按 CSS 尺寸与 DPR 提升。禁止把 `canvas.width/height` 当作逻辑尺寸，也禁止为提高清晰度修改 chunk/场景坐标。鼠标与触摸必须从 CSS rect 映射到 `canvas.logicalWidth/logicalHeight`。
- 《三国张角传》正式主表现的 `logicalResolution.scaleMode` 固定为 `window`：逻辑视口跟随窗口 CSS 像素，1 世界单位 = 1 CSS 像素，不做等比或非等比缩放，可见世界范围随窗口变大。`logicalResolution.width/height` 仅作为编辑器新场景 fallback 与无 scaler 时的兜底，不再是运行时视口尺寸。宿主 `resizeCanvas()` 必须把 `resize()` 返回的 `logicalWidth/logicalHeight` 传给 `SceneManager.setRenderSize()` 和 `scene.onResize()`；场景 `onResize()` 不得忽略入参改用固定分辨率，`_initCanvas` 也不得把 scaler 已设置的 `canvas.logicalWidth/logicalHeight` 重置回参考分辨率。因视口可大于单个 chunk，场景背景不保证铺满画面，超出部分显示场景背景色。
- 运行时九宫格加载必须在发布 terrain projection 前，把普通 `type:'image'` 背景、非碰撞装饰和 `belowEntities` 装饰预生成到离屏缓存；RAF 只允许消费缓存，不得同步创建或重建大 Canvas。单张场景级背景也在此阶段栅格化一次，背景源图标准尺寸仍固定为 chunk 尺寸 `1280×720`，不要求制作 `2560×1440` 或 2×/4× 资源；DPR backing 只改善显示采样。`depthSort:true` 图片与碰撞装饰必须继续参与实体 Y-sort，不能为了合并缓存破坏遮挡语义。
- `type:'spawn', ref:'player'` 的坐标语义固定为玩家脚底中心。编辑器必须按 `actors.player.visual` 向锚点上方绘制视觉框，并按 `actors.player.footprint` 在脚底绘制占地椭圆；固定 16px 图标只表示可选择的逻辑锚点，不能代表玩家实际尺寸。运行时 worldOffset 只改变世界坐标，相机会把玩家投影到屏幕视口，因此不得用运行时屏幕像素位置反推或改写编辑器局部出生坐标。
- 场景构图样板用 `presentationProfile`、`composition`、`assetBudget` 和 `productionState` 标明规格、动线、预算与阶段。尚未进入主流程的样板必须设置 `previewOnly:true`，可登记在 `_scene_order.json.scenes`，但不得加入 `order` 自动推进数组。

## 触发器与场景对象的所见即所得关联

- 空间行为使用统一模型：`game.project.json.triggers[]` 只保存条件/动作/once/cooldown；场景 `type:'trigger'` binding 保存位置、范围、提示、`triggerId`、`targetMode` 和 `target`。项目行为不重复保存场景目标，两者也不是两套触发器。
- `targetMode` 必须显式选择 `id/group/tag/name/type/ref`，`target` 保存对应场景对象真实字段值。`auto` 仅用于读取未迁移旧数据；新建 binding 默认 `targetMode:'id'`，编辑器会提示迁移。
- 目标候选必须从当前场景全部图层对象的真实字段生成并去重；不存在的当前值必须保留并标记“当前场景未找到”，禁止静默删除或替换关联。运行时无匹配目标时拒绝执行该 binding。
- 场景画布必须同时显示 trigger 标记、触发范围和指向所有匹配目标对象的虚线箭头。空间 trigger 与目标重叠时，连线从触发框边缘绘制，不能因中心重合而不可见。
- 关联操作复用现有功能：选中 trigger 后点属性面板 🎯 再点目标，或按住 Shift 从 trigger 拖到目标；右键可断开。🎯、Shift 拖线、候选列表、画布连线、右键反向断开和运行时解析必须共用 `SceneObjectSelector` 规则。
- 项目行为通过 `triggerId` 精确绑定，动作需要目标时从事件第三参数的 `targetSelector/targetObject/targetObjects/targetIds` 读取；不得再用隐藏的 `when.params.target` 与场景 binding 重复绑定。
- 编辑器打开场景时磁盘 JSON 是唯一真实源，始终优先于 localStorage；localStorage 只作编辑器会话缓存，缓存缺少完整 `layers/imageAssets` 时必须回到磁盘结果，不得清空 trigger binding。《三国张角传》正式运行不读取该缓存。

## 场景战役流程参数

- 场景信息面板直接编辑 `gameplay.battleId` 与 `gameplay.battleFlow`：地点、不可用/冲突/进行中/介入提示、战果标题与说明、结算提示、Story 完成键/胜方键、checkpoint，以及对象型 `worldChanges`。
- 当前游戏磁盘 `assets/scenes/<sceneId>.json` 是这些参数的唯一事实源；`config/battles/*.json` 只保存领域战役定义，不得复制 `sceneFlow`。localStorage 只作编辑器草稿/缓存，正式运行通过同一个 `WorldMapLoadSession` generation snapshot 按需读取磁盘，失败直接拒绝。
- 编辑器通过 `SceneBattleFlowRegistry` 对完整候选数据做校验，通过后才一次提交并进入 undo/redo；非法 JSON、数组/null 型 `worldChanges`、缺字段或未登记 battleId 都不得写入当前场景。
- `battleFlow` 不重复保存 sceneId/battleId；它们分别来自场景 `id` 与 `gameplay.battleId`。编辑时必须保留 `{interact}` 等 InputHints token 原文，禁止替换为单平台硬编码按键。
- 更新 battle flow 时只合并 `gameplay.battleId/battleFlow`，不得整体覆盖 `gameplay`，否则会删除 S11/S12 rescue/vehicles 和 S13 settlement/choices 等同级配置。

## 场景保存机制

### 提交边界
- canonical 项目与场景只通过 Vite dev server `POST /api/canonical-transaction` 提交；普通 `/api/save-file` 明确拒绝 `game.project.json` 与 `assets/scenes/*.json`。
- `scene-workflow.html` 的普通场景 whole-scene 保存必须让 `SceneEditor` 的 `options.onSceneChange` 落到实例回调，并调用 `EditorSceneCommandService.save(projectPath, { sceneId, sourceUri, scene })`；场景编辑器直接修改自己的 `sceneData`，因此不得只调用未 patch 该数据的 `CanonicalEditorSession.save()`，也不得改走 `EditorDataManager.updateScene()` 形成 localStorage-only 正式分支。
- `SceneEditorHistory.save()` 只有在持久化处理器明确返回 `ok:true` 且 `committed:true` 后才能显示保存成功；未配置处理器、返回 `undefined`、校验拒绝或磁盘失败都必须显示失败，并优先带上首个 validation `path/message`。磁盘已提交但 cache/notifier 失败只能显示降级警告。
- 场景模板 `editor/config/scene-templates.json` 与图片目录 `editor/config/images.json` 继续使用 `/api/save-file`，但必须检查 HTTP 与响应 `ok`，并 `await` 当前场景/模板保存；配置成功而场景失败属于部分提交，只能警告。`editor/config/atlases.json` 只是只读 `$ref` 索引，场景会话不得通过 `saveAtlases()` 覆盖它；共享定义只在当前游戏 `config/atlases.json` 维护。不得把全局 atlas/images 遍历写入所有场景 localStorage。
- `game.project.json -> library` 必须从页面共享 `CanonicalDocumentModel` candidate 读取，并由共享 `CanonicalEditorSession.patch('library', ...) → save()` 提交；禁止另读整份工程后用旧副本整文件替换，否则会覆盖同页 Trigger/Tutorial 等未提交或刚提交字段。
- `SystemEditor` 必须由正式宿主注入同一项目的 `CanonicalEditorSession`，只允许 `patch('system', structuredClone(data)) → await save()`；禁止保留无 session 的 localStorage/整文件读取替换 fallback。所有保存按钮和页面初始化都必须等待 Promise，独立 HTML 的异步 IIFE 还必须在最外层 `.catch(...)` 显示初始化失败，禁止只在 IIFE 内 `await` 后丢弃其返回 Promise；严格双判定后才显示成功；`CanonicalEditorSession` 也只能在 `ok:true && committed:true` 时清除 dirty roots。
- `TriggerEditor`、`LibraryEditor`、`DialogueGraphEditor` 和 `WorldMapEditor` 同样只能读取共享 session candidate，并分别 patch 自己拥有的 `triggers/tutorials/dialogues`、`library`、`dialogues`、`worldMap` 根字段；缺少 session 必须明确拒绝初始化，禁止回退为 GET 旧工程副本后整文件 replace。保存方法要返回结构化结果，按钮等待 Promise，`degraded` 使用 warning 而不是失败样式。
- 共享 `CanonicalEditorSession` 只消除单个 `EditorPageContext` 内的陈旧整文件覆盖；当前 transaction 协议未提供 `expectedRevision`/`expectedHash`，独立页面或浏览器标签并发编辑同一项目仍无乐观并发冲突拒绝。若扩展该能力，必须由服务端在 commit point 前校验基线并返回明确 conflict，禁止用局部 UI 时间戳或最后写入覆盖伪装解决。
- `SceneDataLoader.loadScene()` 对未登记 preset 返回 `null`；canonical SXX 直接使用磁盘文档，禁止把 `createEmptyScene()` 的 legacy 默认字段合入。项目/场景编辑器的成功判定统一为严格 `ok === true && committed === true`，`degraded:true` 单独显示磁盘已提交但后置同步降级。
- 参与跨定义引用闭包的 `$ref` registry entry（如 `battles/rescues/extensions.endings`）必须同时保留被引用文档已有的稳定 `id`；编辑器不得按数组下标、时间戳或随机值生成身份，也不得因当前只编辑 `system` 字段而跳过完整项目校验。保存错误提示必须包含首个 validation `path`，以便定位阻断项。
- transaction endpoint 只接受当前项目 closure 内 JSON 路径；在仓库独占锁内以 temp、备份和恢复 journal 提交 change set。磁盘 commit point 之前失败恢复原文件并保持 localStorage 不变，commit point 之后的缓存失败不得回滚磁盘。
- `GET /api/read-file?path=xxx` — 读取文件内容
- `POST /api/save-file` — 仅写入非 canonical 编辑器配置或资源文件
- `GET /api/list-files?path=xxx` — 列出目录内容

### 已加载场景对象坐标热同步
- 编辑器只能在 canonical 磁盘 commit point 成功后发布保存通知。开发服务器监听当前项目 `assets/scenes/*.json` 的磁盘变化，并通过当前 Demo 的 Vite WebSocket 发送 custom HMR 事件 `yijian18:canonical-scene-commit`；正式游戏只接受同时携带匹配 `gameId/projectPath/sceneId/revision` 的该事件，不再监听 `storage` 或 `yijian18-engine_editor_scene_commit` fallback。该通道只在 Vite `serve` 环境启用，不进入生产业务状态。监听 `add` 前必须用已有 canonical 文件的 `mtimeMs:size` 填充 revision baseline，避免 `watcher.add()` 启动扫描把全部旧文件误报为新提交；revision 只能在 WebSocket 发送成功后记入，发送失败必须允许同 revision 重试。
- 运行时按 core `WorldStreamingManager.getLoadedChunks()` 中的**物理 sceneId**判断是否热同步，不能用业务 `currentSceneId` 提前排除相邻 chunk 或 `SXX-CNN`。真正未加载的场景只调用 `WorldMapLoadSession.forgetScene()`，不得创建实体。
- 热同步输入必须是刚从磁盘读取的原始局部 `sceneData`。`WorldMapLoadSession`、`LoadedChunk.prepareSceneData()` 和 detached terrain 都使用同一 chunk origin 重新投影；禁止把已经投影的 decorations 或 world x/y 再喂给 terrain，`worldOffset` 仍只由 `SceneObjectProjector` 应用一次。
- canonical 场景对象唯一结构是 `layers[].objects[]`；世界对象、placement、effectZone 与资源预载都只扫描该结构。顶层 `objects/placements/effectZones`、`sceneData.objects.*` 和无 `layers` 的旧数据必须直接拒绝，不得兼容合并。
- `image/deco/slice/shape` 在 `Scene1Terrain` 构造时会被复制到 `_editorBackgroundImages/_depthSortedImages/_collisionShapes/_walkableShapes/_editorShapes/decorations`，随后进入静态 Canvas；只替换 LoadedChunk projection 或 ref placement 不会改变当前画面与碰撞。`SceneStreamingRuntime.prepareLoadedSceneData()` 必须先加载新 sceneData 所需资产，创建 detached terrain 并完成 `prepareStaticCaches({signal})`，再由调用方一次提交 chunk projection 与 `terrainsByChunk`；外层 session、projection、terrain、placement 与坐标检查全部成功后先 finalize placement，再把旧 terrain 释放作为 best-effort 提交后清理。placement finalize 前失败时恢复旧 chunk/旧 terrain；新 terrain 身份会让 `SceneTerrainCollision` 的 WeakMap 空间索引自然重建；若选择原地修改既有 terrain 碰撞数组，则必须显式调用 `invalidate(terrain)`。
- 异步资产与 terrain prepare 期间不得先把新数据暴露到 session。连续保存继续使用 sceneId 级 AbortController/generation latest-wins，并在 commit 前复核 manager、LoadedChunk、terrain 引用和 generation；过期请求只能释放自己的 detached 资源，不得提交或回滚较新的版本。运行时提交成功后，session 替换、placement rebuild 与 finalize 必须在同一同步提交段完成。
- `WorldMapLoadSession.replaceSceneData()` 必须同时失效 repository 已读 record、session Promise 与同 sceneId 在途读取 generation；否则画面短暂更新后，chunk 卸载回载会再次取得旧坐标。placement 是否变化统一比较 `getPlacementSignature()`（使用 `_localX/_localY`）；坐标、ref、overrides 或 spawnWhen 改变只重建对应稳定 ID，删除则通过 `retiredPlacementIds` 清理旧实体。任一步失败恢复旧 session/projection/terrain/spawn ledger，并明确报告 rollback failure。
- `PlacementSpawner.spawnMatching()` 必须为每个 `matchedPlacements` 项产生且只产生一个结构化 outcome：成功生成是 `spawned`；幂等账本命中、条件不成立和合法非 ref placement 分别是 `alreadySpawned`、`conditionFalse`、`nonRef` skip；未知 ref kind 和生成异常分别是 `unsupportedKind`、`failed` error。合法 `type:'spawn'` 由出生点管线处理，必须返回 `nonRef`，不得在 ref registry 校验阶段误报。`matchedPlacements` 只表示 selector 命中，`counts.total` 只统计实际生成量；`matched=1,total=0,errors=0` 不能证明生成失败或成功，必须读取逐 placement `outcomes/skipped`。
- `spawnedPlacementIds` 只证明某稳定 placement ID 曾提交到生成账本，不证明当前 live 对象仍存在、类型正确或坐标新鲜。运行时必须用 `ScenePlacementRuntime.findLivePlacementValue()/inspectPlacement()` 按 `placementId` 覆盖 `all/pickups/equipmentItems` 查找并验证；普通 item 的业务 `id` 与 `placementId` 保持分离，不得为了查找方便把两者改成同一个 ID。补偿链路遇到 `alreadySpawned` 但 live 缺失时不能盲目 `forget + spawn`，因为缺失也可能表示已拾取或已死亡的 terminal 事实。
- 坐标热同步只重建签名发生变化的 active `type:'ref'`。验证顺序固定为磁盘原始局部 `x/y === projection._localX/_localY`，再验证 live 世界坐标约等于 `local + loadedChunk.origin`；禁止把运行时 world 坐标直接与编辑器 local 坐标比较，也禁止在补偿代码中直接改 `x/y`。每个 ref 草稿都必须核对 outcome、实体注册和最终世界坐标；应生成却无 live 对象、outcome 不匹配或坐标不等于新 projection 时整批回滚，不能只检查 matched/counts/errors。
- placement 重建必须遵守 `validate → prepare draft → commit → emit → checkpoint`。需要纳入编辑器热同步外层事务时调用 `rebuild(..., { deferFinalize:true })`：成功后保留旧对象并返回幂等 `rollback/finalize`，只有外层 session、terrain 和 projection 后置检查全部成功才 finalize；外层失败按 placement → terrain → session 逆序回滚。prepare/commit 任一步失败都要恢复 pending state、AI 注册和 `spawnedPlacementIds` ledger，且当前失败步骤也必须进入回滚，禁止先销毁旧对象再执行仍可能失败的检查。
- placement 动态状态必须携带 `getPlacementSignature()`；`addPendingPlacementState()` 为当前写入自动补签名。缺少 `placementSignature` 的旧动态状态必须以 `missingPlacementSignature` 拒绝，禁止自动绑定当前定义。只有签名已存在且变化仅限局部坐标时，removed tombstone 才可续签并阻止对象复活；旧动态世界坐标不得覆盖新 canonical 坐标。ref、overrides 或 spawnWhen 等语义变化不能沿用旧 terminal state。live corpse 在 rebuild 前必须通过 `SceneCorpseRuntime.capture()` 注入临时 terminal 状态，使新草稿恢复为尸体而不是活敌。
- 热同步诊断必须保留逐项 `outcomes/skipped`，并区分 `placement-projection-verified/invalid`、`placement-rebuild-*` 与 `placement-rollback`；排查时先确认 local、chunk origin、world projection 和 outcome，再判断存档污染。只看到 `matched=1,total=0,errors=0` 时不得清空全局生成账本或硬编码对象坐标。
- `Minimap.setTerrains()` 只会失效 cache version，不会主动生成背景；同 Region 的 `_minimapBackgroundActivation` 门禁还会跳过普通激活入口。terrain 热替换提交后必须显式调用一次 `prepareBackgroundCache()`，回滚后也必须基于恢复的旧 terrain 再建一次；普通 HUD update、缩放和 streaming refresh 仍禁止隐式重画静态小地图。

## 性能优化（游戏侧 Scene1Terrain）

### 离屏缓存策略
| 缓存 | 内容 | 构建时机 |
|------|------|---------|
| `_grassCanvas` | 椭圆草地铺面纹理 | 首次渲染且图集加载完成后 |
| `_groundDecoCache` | 所有非碰撞装饰物（草/灌木） | 九宫格 Terrain 准备阶段，图集就绪后 |
| `_belowDecoCache` | 所有固定在实体下方的装饰物 | 九宫格 Terrain 准备阶段，图集就绪后 |
| `_bgImageCache` | 编辑器普通背景图片合并 | 九宫格 Terrain 准备阶段，所有背景图就绪后 |
| `_combinedGroundCache` | 地形椭圆+水池+背景图 | 九宫格 Terrain 准备阶段，所有资源就绪后 |

### 合并地面缓存（`_buildCombinedGroundCache`）
- 将森林环带、草地铺面、水池、背景图片全部渲染到一张离屏 Canvas
- 构建成功后 `renderGround()` 每帧只需 1 次 `drawImage`（之前需要 4-5 次大面积绘制）
- 限制缓存 Canvas 尺寸不超过 4096×4096

### collectDecorations 优化
- 非碰撞装饰物：从缓存图一次性绘制（1 次 draw call 替代 200+ 次）
- 碰撞装饰物（树）：逐个参与 Y-sort renderQueue（数量少，通常几十棵）

## 地形椭圆（可编辑对象 type:'ellipse'）

### 概述
序章等户外场景的“盆地草地椭圆”以前是编辑器里由 `_renderTerrainBackground()` 自动画的固定背景，不可交互。现已改为**可编辑对象** `type:'ellipse'`，存放在 `layer_fill`（背景填充层）中，可添加、删除、移动、缩放、改颜色。

### 编辑器侧改动位置
- **SceneEditorUI.js**：工具栏新增“⬭”按钮；`updateObjectProperties()` 支持 ellipse 宽高；新增 `_buildEllipseProperties()`（名称/填充色/透明度/边框色/边框宽）
- **SceneEditor.js**：`editor-add-ellipse` 按钮事件；`_ensureTerrainEllipse()` 在 `loadScene()` 时把旧 terrain 椭圆转换为 ellipse 对象（仅当 layer_fill 无 ellipse 时执行，避免重复）
- **SceneEditorCanvas.js**：`_renderEllipseObject()` 渲染椭圆；`_renderTerrainBackground()` 对非 indoor 场景不再自动画椭圆（交给对象渲染）；`_renderTerrainMask()` 优先从 layer_fill 的 ellipse 对象读参数；选中框/`_renderObject` 支持 ellipse
- **SceneEditorInteraction.js**：`getObjectAt()` 用椭圆方程 `(dx/rx)²+(dy/ry)²<=1` 做命中检测；`getResizeHandleAt()` 支持 ellipse

### 关键坑：图层锁定导致选不中
`getObjectAt()` 会跳过 `locked` 或不可见图层：`if (!layer || layer.locked || !layer.visible) continue;`。
旧场景数据里 `layer_fill` 常是 `locked:true`（以前椭圆是纯背景不需交互）。椭圆变可编辑后必须解锁——`_ensureTerrainEllipse()` 添加椭圆时会自动 `fillLayer.locked = false`。

### 坐标换算（编辑器 ↔ 游戏）
- 编辑器椭圆用**左上角锚点** `(x, y, width, height)`；中心 = `(x+width/2, y+height/2)`，半径 = `width/2, height/2`
- 游戏侧 `Scene1Terrain` 的 `centerY` 比编辑器椭圆中心**多 32 像素**（编辑器里草地视觉中心上移了 32：`centerY = data.centerY - 32`）。互转时注意 ±32。
- 椭圆半径转盆地半径时有 20px 余量：编辑器 `radiusX = basinRadius + 20`，游戏侧反推 `basinRadiusX = rx - 20`。

## 图层可见性/锁定对游戏的影响

游戏侧 `Scene1Terrain._applySceneData()` 遍历图层时**必须检查 `layer.visible === false` 跳过隐藏图层**，使编辑器隐藏的图层在游戏中也不渲染（装饰物、椭圆、背景图片三类收集都要判断）。

### 装饰物空数据的坑
不能用 `if (decorations.length > 0)` 判断是否覆盖装饰物（隐藏装饰层会导致回退到程序化默认树木）。应统计**编辑器中定义的装饰物总数** `totalDecoDefined`（含隐藏图层），只要 `>0` 就以编辑器数据为准，这样隐藏装饰层后能真正清空，而“无编辑器数据”时仍保留程序化默认。

### 椭圆删除后游戏跟随变化
游戏侧用 `this._hasTerrainEllipse` 标记场景数据中是否存在椭圆：
- `_applySceneData()` 遍历时用 `foundEllipse` 记录，并清除 `_combinedGroundCache`/`_grassCanvas` 强制重建
- `renderGround()` 中 `_hasTerrainEllipse === false` 时跳过草地和森林环带，只保留水池和背景图片
- 注意用 `=== false` 判断：未定义（无编辑器 layers 数据）时视为正常渲染，不影响未编辑过的场景

## 地形椭圆的填充与特效（编辑器 + 游戏侧数据驱动）

### 编辑器侧
- 椭圆可从左侧资源库「地形椭圆」项拖入（`SceneEditorAssets.js` 的 drop 处理 `id==='ellipse'`，放入 layer_fill 并解锁）
- 椭圆填充模式 `fillMode`：`color`（纯色 fill）/ `image`（imageSrc + imageMode）/ `slice`（atlasId+sliceKey 或 decoKey + sliceMode）
- 切片填充：在左侧资源库选中切片（`editor.selectedSlice`）后点属性面板「用选中切片填充」按钮
- 边缘淡化 `edgeFade`（0~1）：`SceneEditorCanvas._renderEllipseObject()` 用 `destination-out` 椭圆径向渐变从内向外擦除
- 渲染辅助：`_drawImageInBox`（stretch/cover/contain/tile）、`_drawSliceInBox`（tile/stretch）、`_getEllipseSliceSource`

### 游戏侧（Scene1Terrain）——已删除写死的 mountain 草地/森林环带渲染
- **已删除**：`_renderForestRing()`（写死森林环带）、`_renderGrassFill()`（写死 mountain 贴图草地）及 `_grassCanvas`
- **改为数据驱动**：`_terrainEllipse` 保存椭圆填充数据，`_renderTerrainEllipse(ctx)` 按 fillMode + edgeFade 渲染（移植自编辑器逻辑，带 `_drawImageInBox`/`_drawSliceTiled`）
- `_buildTerrainEllipseFromObject(obj, cx, cy, rx, ry)`：从编辑器椭圆对象解析填充数据；image 模式保留图片引用，slice 模式统一通过注入的 `AtlasRegistry` 解析 `atlasId/sliceKey`（legacy `decoKey` 也只按 key 查询 registry），图集图片从 AssetManager 的稳定 `assetId` 缓存取得
- `_ensureTerrainEllipseData()`：**无编辑器椭圆时的兜底**，用 terrain 配置（basinRadius + grassTile 切片）生成默认椭圆（slice 平铺 + edgeFade=0.28 模拟原森林环带过渡）。这不是写死渲染，而是数据驱动的默认值
- `renderGround()`：`_hasTerrainEllipse===false` 不画草地；否则用合并缓存或 `_renderTerrainEllipse` + 水池 + 背景图
- `_buildCombinedGroundCache()`：合并 `_renderTerrainEllipse` + 水池 + 背景图（切片模式等 mountain 就绪，图片模式等图片 complete）

### 关键点
- 椭圆中心 `cy` = 编辑器椭圆中心 = 游戏 `centerY - 32`；渲染半径直接用椭圆 `width/2, height/2`（不减 20 余量，20 余量只用于碰撞/装饰的 basinRadiusX/Y）
- 森林环带的边缘过渡效果现由椭圆 `edgeFade` 替代
- 改椭圆填充/特效后清 `_combinedGroundCache = null` 强制重建

## Trigger-only 事件链职责

- 当前流程唯一事实是 `Trigger.when(type + params) → 顶层 if 准入 → 串行 do[]/step.if/branch.when → application event → 下游 Trigger`。不得再创建或恢复 SceneEvent、宏观阶段、`stage/next` 或其他第二份流程顺序。
- `Trigger.name/id` 是规则名称和规则稳定 ID，不是输入事件名称或事件 ID。开始事件名称从 `triggerCatalog.events[].label` 派生，开始事件身份从该事件的 `identityFields` 对应 `when.params` 字段派生，不复制保存显示名称或通用 eventId。
- `when.params` 是运行时事件 payload 的浅层过滤子集，字段省略表示通配；事件 `paramsSchema` 只校验已填写过滤字段的类型和范围，不得把 payload 本体必有的身份字段设为 Trigger 监听必填。编辑器对未填写 `identityFields` 显示“未设置/按类型监听”，不能擅自补值。
- Trigger 成功条件固定为：顶层 `if` 准入后，`do[]` 中所有实际执行步骤成功；`step.if` 不满足的步骤跳过，`branch.when` 只选择执行分支。成功后 TriggerSystem 自动发布 `triggerSucceeded { triggerId }`。
- 业务后继只能从确实发布 application event 的 action/operation `emits` metadata 推导；下游 Trigger 仍以相同 `when.type/when.params` 监听。编辑器只显示这条真实链，并对未连接或多重匹配明确提示，不把派生目标回写为 `next`。
- Tutorial 只管理自身定义和 `steps[]`；需要进入业务链时通过已有 Trigger/action 契约接线，不持有另一份跨 Trigger 顺序。

## 当前场景事件视图筛选

- `SceneEditorEventFilter` 是 `TriggerProjectIndex` 生成的纯编辑器只读投影：横向事件条按项目 `triggers[]` 定义顺序展示当前场景实际绑定的 Trigger，再按 Trigger 展示空间 binding，并按 Tutorial priority／定义顺序展示当前场景 Tutorial。成员关系只由 binding 的 `triggerId`、Trigger/Tutorial 的显式场景归属和 canonical 场景文档反向建立，不复制子 ID。筛选支持“全部 / Trigger / binding”；“显示全部”及每个 binding 旁的复选框只控制当前编辑器会话显隐，默认全选，切换场景时恢复“全部 + 全选 + 不包含关联对象”，禁止进入 sceneData、history、保存、导出或 canonical transaction。
- TriggerEditor 的“场景关联”不是只检查 `when.params.sceneId`：必须取 canonical 场景 `type:'trigger'` binding 形成的 `sceneId -> triggerId` 反向索引、运行条件 `when.params.sceneId` 与显式编辑器归属 `editorScope.sceneIds` 的并集。反向索引读取 committed canonical 场景快照，并允许当前未保存场景覆盖同 ID 投影；禁止按 `trg_s01_*` 等 ID 前缀、action 参数或无 provenance 的 localStorage 猜测归属。`editorScope.sceneIds` 只服务编辑器组织，不改变 TriggerSystem 运行匹配；事件视图只为场景内实际存在的空间 binding 提供显隐与对象投影，因此其 binding 数量可以小于 TriggerEditor 的场景关联总数。
- `TriggerEditor` 由 `EditorInteraction` 注入当前项目的同一个 `CanonicalEditorSession`，使用剧情线总览／Trigger／Tutorial 三个标签页，并通过一次 `patchMany(triggers,tutorials,dialogues)` 和一次 `save()` 提交同一 candidate；正式编辑器宿主不得把无 session 的整文件替换 fallback 当作 canonical 正常保存路径。Trigger 左侧列表拖动完整定义调整 `triggers[]` tie-break，同 coordination 组同优先级候选按该定义顺序稳定仲裁；Tutorial 左侧按定义顺序管理，只能在详情内拖动完整 `steps[]`。筛选状态下隐藏项保持原相对顺序，任何拖动都不能按表单下标重建对象，否则会让 action／step 稳定 ID、policy、operationId 或 unknown-but-allowed 字段串位；调整后仍需通过“保存到工程”提交 canonical JSON。
- TriggerEditor 的 `do[]` 同样使用拖拽手柄排序；拖动开始前必须先提交当前表单，再搬运完整 action 对象并重渲染，禁止仅移动 DOM 或按新下标把可见字段合并回旧 action。触发器可选 `name` 是编辑器可读名称，左侧优先显示名称并始终保留完整稳定 ID；空名称不写入 canonical 数据。
- `ContentValidator` 校验对象字段时默认允许 unknown，只有 schema 显式设置 `allowUnknown:false` 才拒绝；编辑器仍必须在 round-trip 中主动保留这些字段。因此所有结构化表单回写都必须以原 definition／action／Tutorial step／`params` 完整对象为基底，只覆盖控件实际拥有的字段。保存表单和拖动排序都不得按可见字段重建对象，否则会静默删除扩展字段或让稳定身份串位。
- `spawnPlacements` 控件只管理 selector 的 `placementId/placementIds/group/tag/tags` 五类互斥选择字段：未改变 mode/target 时原样返回完整 `params`；实际切换时只清除并重写这五类字段。必须保留既有 `sceneId`、`kinds`、其他 unknown 字段以及嵌套／扁平 selector 形态，禁止从 `<option>` 元数据隐式改写 `sceneId`；只有创建全新的空 selector 时才可补默认 `kinds:['item']`。
- 场景画布事件筛选条的样式归 `editor/styles/scene-editor.css`；独立事件编辑器的三标签、顺序编号、动作／Tutorial step 拖动和分隔条样式归 `TriggerEditor._injectStyles()` 创建的 `#trg-styles`。新增样式应放回对应所有者，避免在两处复制同一选择器或误以为全部事件编辑器样式都在外部 CSS。
- Trigger 动作目录固定为两级：`action` 表示已注册处理器类型，`params.operation` 表示该处理器内的稳定子命令；游戏专属 operation 只登记在项目 `triggerCatalog.actions[].operations[]`，每项同时提供独立中文 `label`、结构化 `paramsSchema` 与 `resultSemantics`，确实发布后继 application event 的 operation 还必须登记只读 `emits` metadata。不得把固定历史 operation 硬编码进引擎目录。operation 的 `paramsSchema` 命中后会整体替换 action descriptor 的参数 Schema，不会自动合并基础 properties；使用 `additionalProperties:false` 时必须重复登记该 operation 实际允许的全部字段。operation 选项的 `id` 与 `value` 使用同一稳定英文 token，`label` 只用于 UI 展示，保存时只能把稳定值写入 `params.operation`。每个 `do[]` 步骤必须有触发器内唯一且不随拖动改变的 `stepId`；运行时始终严格串行等待并在首个失败处短路，action 顶层 `await` 已废弃。教程离槽等待仅允许 `tutorial.command/show` 使用 `params.await:true`，对应 operation Schema 必须登记 boolean `await`；其他 operation 不得显示或保存该字段。未显式提供 action `operationId` 时，幂等身份由请求 operationId、Trigger ID 与稳定 `stepId` 组合，禁止退回数组下标。
- 场景 trigger binding 的 `activeWhen` 在右侧属性栏以 JSON 对象编辑：空值删除字段，数组、`null` 或非法 JSON 必须保持原对象不变并恢复输入；合法修改先进入 history，再重建事件视图。该入口只编辑既有 `SceneTriggerBindingSystem` 条件，不创建第二套阶段状态。
- TriggerEditor 左侧列表中的触发器 ID 与 when 文本必须完整换行显示，不使用省略号截断；空间触发器还必须从同一 canonical binding 反向索引投影事件视图的 `binding.name`，当前场景有多个同 triggerId 名称时全部显示，未选择场景时以 `sceneId · name` 区分。列表与详情之间的竖向分隔条支持指针左右拖动、键盘左右键微调和双击恢复默认宽度，并把宽度保存到本机 UI 偏好；宽度调整只影响编辑器布局，不进入项目 canonical 数据。
- 右侧“选中对象”属性栏的“是否显示”不是事件条临时筛选，而是 canonical binding 字段 `enabled`（缺省视为 `true`）。`enabled:false` 必须从编辑器画布投影中移除，并在场景加载投影、`SceneTriggerBindingSystem.setBindings()` 和活动判断中统一拒绝，使该空间事件不显示提示、不进入调试热点且不执行；事件条仍保留事件名称作为重新选中和启用入口，其临时显隐框置灰，且不得改写 `enabled`。
- 场景空间 binding 只保存并只读展示所选 Trigger 的稳定 `triggerId`；重新选择 Trigger 时更新该字段。不得再生成 `sceneEventId`、`flowGroupId` 或其他流程外键，编辑器投影和 `SceneTriggerBindingSystem` 的提示、候选、最终触发统一按 `triggerId` 精确解析。
- Trigger／binding 过滤只显示所选层级包含的空间 binding；启用“显示关联对象”后，复用 `SceneObjectSelector` 解析 binding 的 `targetMode/target` 及 action 显式声明的 selector、targetId/objectId、group、ref/npcRef/enemyRef、entity/actor/vehicle ID。只有显式 group selector 才扩展整组，不得因对象自身带 group 自动扩大。
- 关联解析使用有界 Set 闭包并防循环；编辑器找不到的稳定目标显示为“运行时动态目标”，不得伪造场景对象。属性面板的目标候选始终读取 canonical 全对象，不受视图筛选影响。
- Canvas 渲染、触发器连线、命中测试、全选、框选、拖动、缩放、关联拾取必须消费同一可见对象投影；筛选切换要取消旧拖动/缩放/连线状态并清除隐藏 selection。图层计数显示“可见数/总数”，过滤态禁止会重排隐藏对象的批量深度操作，其他批量操作只处理当前可见候选。
- 事件条必须限制在 `.editor-canvas-area` 宽度内，使用 `minmax(0,1fr)`、`min-width:0` 和内部横向滚动；事件数量增加时不得撑宽编辑器。事件条下方提供独立拖动轨道，滑块只同步事件列表的 `scrollLeft`，不修改场景数据、Canvas 尺寸或编辑器布局宽度。
- 事件视图重建 chips 时必须先保存并恢复横向 `scrollLeft`；切换阶段、单事件或“显示关联对象”不得把拖动滑块重置到起点。该位置仍是编辑器会话内存状态，只有加载另一场景时重置，不进入 sceneData/history/save。
- 单事件视图必须保留当前场景原有背景、背景填充和装饰图层对象，以提供地貌与构图上下文；视觉层按稳定 layer id（如 `layer_bg/layer_fill/layer_deco`）及背景/装饰语义名称识别，并继续尊重图层自身 `visible` 状态。其他 placement/gameplay/logic 对象仍只在事件明确关联且启用“显示关联对象”时加入投影。

# 大地图（M 键）任务清单

> 关联规格：`.trae/specs/world-map-overlay/spec.md`
> 执行顺序即依赖顺序；每项以「验证」为准入。

## [x] T1 新增 `src/ui/WorldMapPanel.js`
- 全屏遮罩面板：视口裁剪、静态地形离屏缓存、拖拽平移、边界夹紧、玩家居中。
- 数据全部走 `setDataProviders` 惰性拉取（worldIndex / regionId / player / sceneId / cityStates / project）。
- 城池解析：`^city\.s(\d{2})_` → `S$1` → `findScene` 中心；名称/阵营色。
- 渲染：地形块、网格、场景名、城池旗标、玩家呼吸环、标题/图例/「×」「回」按钮、空数据占位。
- **验证**：`node --check src/ui/WorldMapPanel.js`；无 `getWorldIndex` 时 `open()` 不抛错。
- 补充：静态缓存按视口子矩形 drawImage（地图大于视口时不整张 blit，遵循离屏缓存禁忌）。

## [x] T2 导出面板
- `src/ui/index.js` 增加 `export { WorldMapPanel } from './WorldMapPanel.js';`
- **验证**：`node --check src/ui/index.js`。

## [x] T3 小地图入口按钮
- `src/ui/Minimap.js`：`onOpenWorldMap` 选项、`_mapButtonRect()`、`isMapButtonHit()`、`handleClick` 热区短路、`render` 末尾绘制 16×16「M」按钮。
- `src/core/scene/SceneWorldInteraction.js`：`handleMinimapDrag` 起始沿先判按钮热区——点「M」走 `handleClick` 打开大地图、不进入 `beginSeekDrag`，同时 `markMouseClickHandled()` 防攻击系统误触。
- **验证**：`node --check src/ui/Minimap.js`、`node --check src/core/scene/SceneWorldInteraction.js`。

## [x] T4 场景面板挂载 + 数据注入
- `src/core/scene/ScenePanelLayout.js`：解构 `WorldMapPanel`、创建 `scene.worldMapPanel`、`setDataProviders(...)`、minimap 传 `onOpenWorldMap`、`_applyScreenHudLayout` 同步尺寸并 `refreshLayout()`。
- **验证**：`node --check`；场景启动后 `scene.worldMapPanel` 存在且 `visible === false`。

## [x] T5 游戏侧依赖注入
- `example/sanguo_zhangjiao/scenes/BaseGameSceneBehaviors.js`：import `WorldMapPanel` 并加入 `_ensurePanelLayout()` 依赖对象。
- **验证**：`node --check`；HUD 组合后面板实例非空。

## [x] T6 M 热键
- `src/core/scene/SceneInputBindings.js`：构造参数 `toggleWorldMap` + `registerHotkey('toggle_world_map', ['m','M'], ...)`。
- `example/sanguo_zhangjiao/scenes/BaseGameSceneSetup.js`：传 `toggleWorldMap`，新增 `toggleWorldMap()`，`toggleSettings` 在面板可见时先关地图。
- **验证**：`node --check` 两个文件；M 连按两次开→关；ESC 在地图打开时只关地图。

## [x] T7 模态输入 + 顶层渲染
- `example/sanguo_zhangjiao/systems/SanguoSceneLifecycleCoordinator.js`：`handleModalInput` 在结局分支后插入地图分支；`renderPostPipeline` 在 `endingPresentationView` 之后、全景过场之前 `render(ctx)`。
- **验证**：`node --check`；打开时 WASD/左键点地无移动，关闭后恢复；地图绘制在 HUD/结算层之上。

## [x] T8 单元测试
- 新增 `src/ui/WorldMapPanel.test.js`：城池映射、world→map 比例、scroll 夹紧、toggle 生命周期、无数据安全、模态吞输入。
- **验证**：`npx vitest run src/ui/WorldMapPanel.test.js` 5/5；`npx vitest run src/ui` 9 文件 111 例全绿。

## [x] T9 回归与验收
- `node --check` 全部改动文件通过；`npx vitest run src/ui` 111 例全绿。
- 代码级验收：M 开关 / 小地图按钮热区（含拖动入口让路）/ 玩家与 8 城池位置计算 / 拖拽夹紧 / 打开时输入冻结 / 背包共存（模态阻塞世界路由）。
- **待实机确认**：R1–R6 逐项操作（需用户在有画面环境验证观感与手感）。

---

## 验收清单（DoD）

- [x] M 键与小地图右上角「M」按钮都能开关大地图
- [x] 玩家标记位置正确，当前场景高亮
- [x] 8 座城池按所属场景锚点绘制（S03/S04/S05/S07/S09/S10/S11/S12）
- [x] 地图大于视口时可拖动，四边夹紧，无空白
- [x] 打开期间世界输入被吞掉，关闭后恢复
- [x] ESC 优先级：地图打开时先关地图
- [x] 无 worldIndex / 无 cityStates 时安全降级为占位
- [x] 单元测试与 `node --check` 全绿

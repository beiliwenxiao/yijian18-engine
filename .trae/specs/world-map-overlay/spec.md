# 大地图（M 键）设计规格

> 状态：待评审 · 2026-11-08
> 需求：按 M 打开大地图；地图类似场景编辑器的大地图，但显示玩家位置与各城池位置；
> M 入口同时放在右上小地图的右上角；一屏放不下时可拖动查看。

---

## 1. 需求与验收

| # | 需求 | 验收标准 |
|---|------|----------|
| R1 | M 键开关大地图 | 按 M 打开；再按 M / ESC / 右上「×」关闭；关闭后世界输入恢复 |
| R2 | 小地图右上角入口 | 小地图右上角出现 16×16 的「M」按钮，点击等同按 M（不触发小地图点击定位） |
| R3 | 显示玩家位置 | 玩家标记绘制在当前世界坐标处，与所在场景锚点吻合 |
| R4 | 显示城池 | 8 座城池按所属场景锚点定位，显示名称与阵营色 |
| R5 | 拖动查看 | 地图尺寸大于视口时可按住左键拖动平移，边界夹紧，不出现空白漂移 |
| R6 | 与现有 UI 共存 | 打开期间角色不移动、不攻击、不触发场景交互；小地图/背包等其他面板行为不变 |

---

## 2. 数据来源（勘察结论）

| 数据 | 来源 | 关键字段 |
|------|------|----------|
| 世界网格（20×20，1280×720/格） | `ProjectWorldIndex`（由 `game.project.json.worldMap.regions[]` 派生，运行时 `scene._worldIndex` / `scene._worldLoadResult.worldIndex`） | `region.rows/cols/chunkWidth/chunkHeight/bounds/coverage` |
| 每格地形 | `region.coverage[row][col]`（`ProjectWorldIndex.build` 派生） | `terrain` ∈ `mountain` / `yellowRiver` / `forest` / `plain`（`src/core/WorldMapCell.js`） |
| 场景锚点 / 大场景覆盖 | 同上 coverage | `sceneId`、`isAnchor`、`sceneOffset`、`worldWidth/worldHeight`、`footprint` |
| 城池位置 | `blackboard.get('cityStates')`（初值来自 `game.project.json.variables.cityStates`） | `id` 形如 `city.s09_guangzong_camp`、`name`、`factionId` |
| 玩家坐标 | `scene.playerEntity.getComponent('transform').position` | 世界坐标，与 chunk `origin` 同空间（`WorldStreamingManager` origin = `anchor.offset`） |
| 当前场景 | `scene.currentSceneId`（去掉 `-C\d{2}` chunk 后缀） | 用于高亮当前场景与判断所属城池 |
| 项目 / 区域 | `scene.gameLoader.project`、`scene._worldRegion` / `scene.context.world.region` | 取当前 region id |

**城池 → 世界坐标**：`city.sNN_*` 前缀解析出场景 `SNN` → `worldIndex.findScene('SNN')`；
中心点 = `anchor.offset + (anchor.worldWidth/2, anchor.worldHeight/2)`。
场景不在世界网格中时跳过该城池（不报错）。
全部 8 座城池对应 S03/S04/S05/S07/S09/S10/S11/S12，均已在 mainland grid 中定位。

**玩家 → 大地图坐标**：玩家坐标已是全局世界坐标，直接按比例换算，不需要再加场景偏移。

---

## 3. 坐标换算

```
MAP_SCALE       = 96 / 1280 = 0.075      // 每格 96×54 px（与编辑器大地图同量级）
mapW = cols * MAP_SCALE * chunkWidth     // 20 格 → 1920 px
mapH = rows * MAP_SCALE * chunkHeight    // 20 格 → 1080 px

worldToMap(x, y)   = { x: x * MAP_SCALE, y: y * MAP_SCALE }
mapToScreen(x, y)  = { x: viewport.left + x - scrollX, y: viewport.top + y - scrollY }
```

- `scrollX ∈ [0, max(0, mapW - viewport.width)]`，`scrollY` 同理；内容小于视口时居中。
- 打开时 `scroll` 使玩家居中（并立即夹紧）。
- 1920×1080 > 1280×720 逻辑视口 → 必然可拖动，符合 R5。

---

## 4. 交互与输入共存（结论）

| 项 | 结论 |
|----|------|
| 快捷键 | `SceneInputBindings` 新增 `toggle_world_map` → `['m','M']`；与 B/C/V/F/R/P/ESC 同级，冷却 300ms |
| 小地图入口 | `Minimap` 内建 16×16 热区（右上角，内缩 4px），`handleClick` 优先判定该热区；命中则回调 `onOpenWorldMap` 并 return（不进入 `beginSeekDrag`）；`_mapCache` 未就绪时也可点 |
| 关闭 | M 再按；ESC（拦截 `toggleSettings`：地图可见时先关地图）；面板右上「×」 |
| 世界输入 | `SanguoSceneLifecycleCoordinator.handleModalInput` 第 2 位（结局播放之后）判断 `worldMapPanel.visible` → 调 `handleInput` 并返回 true；`SceneInputFlow` 据此置 `_modalConsumed`，跳过世界路由（移动/攻击/交互/点击寻路） |
| 对话 | `toggleWorldMap()` 中 `dialogueSystem.isActive?.()` 或 `isPlayerActionLocked?.()` 时拒绝打开 |
| 鼠标拖拽 | 面板 `handleInput({inputManager})` 内用 `isMouseButtonDown(0)` + `getMousePosition()` 维护 `_drag`；位移 > 4px 视为拖动；拖动时 `scroll -= delta` 并夹紧 |
| 城池点击 | 仅悬停高亮 + 名称提示，不做传送（避免与任务 travel 冲突） |
| 手柄/触屏 | 首版不新增映射（M 为 PC 键；小地图按钮支持指针/触屏点击） |

---

## 5. 取舍结论（先结论后动手）

1. **缩放：首版不做**。原因：`InputManager` 没有 wheel 通道（`InputEventType.WHEEL` 未接线），新增会改公共输入层；且缩放要处理标签避让与命中测试重算。固定 96×54/格已满足「拖动查看」诉求，后续可加「+ / −」按钮扩展，不改架构。
2. **拖动惯性：不做**。地图查看需要精确停位，惯性只会放大边界抖动。
3. **打开时暂停世界输入：做**（模态吞输入）。**不暂停世界模拟**（与背包/任务面板一致，避免破坏计时/战斗节奏）。
4. **不新增独立 UI 布局配置**：面板全屏固定，尺寸随 `scene.logicalWidth/Height` 与 `onResize` 同步，不进入 `UILayout.desktop.json`。
5. **静态地形离屏缓存**：地形块一次性画到离屏 canvas，每帧只 `drawImage` + 画动态标记（城池/玩家/按钮），避免 400 格逐帧重绘。

---

## 6. 实现落点（逐文件、可直接执行）

### 6.1 新增 `src/ui/WorldMapPanel.js`

`export class WorldMapPanel extends UIElement`，全屏遮罩式面板。公开 API：

| API | 说明 |
|-----|------|
| `constructor(options)` | `x/y/width/height/visible:false`；常量 `CELL_W=96`、`CELL_H=54`、`PAD=24` |
| `setDataProviders({ getWorldIndex, getRegionId, getPlayer, getSceneId, getCityStates, getProject })` | 数据全部惰性拉取，不缓存引用 |
| `open()` / `close()` / `toggle()` | `open()` 重建静态缓存、刷新城池、`_centerOnPlayer()`、`refreshLayout()` |
| `refreshLayout()` | 依据 `width/height` 计算视口矩形并夹紧 scroll |
| `handleInput({ inputManager })` | 可见时返回 true（模态）；处理拖拽、按钮点击、关闭 |
| `handleMouseClick(x, y)` | 供 UIClickHandler 路径兜底；可见即消费点击 |
| `render(ctx)` | 遮罩 → 面板 → 静态地图片 → 城池/场景标签 → 玩家 → 按钮/图例 |
| `_refreshCities()` | `cityStates` → 世界坐标；`^city\.s(\d{2})_` → `S$1` |
| `_centerOnPlayer()` | 玩家居中 |
| `_clampScroll()` / `worldToMap()` / `mapToScreen()` | 换算与夹紧 |

颜色：`mountain #6f6b63`、`forest #3f6b3a`、`yellowRiver #3f6f9a`、`plain #8a7a4e`、
有场景无地形 `#57503f`、空格 `#1c1a17`；网格线 `rgba(0,0,0,.28)`；
城池阵营色 `yellow_turban #d9a521` / `han_government #4a6f9a` / 其他 `#cfcfcf`；
玩家 `#59d96b` + 白描边 + 2.4s 呼吸环。

按钮：右上「×」（关闭）、「回」（回到玩家）。无数据时绘制「暂无可显示的世界地图」。

### 6.2 `src/ui/index.js`
`export { WorldMapPanel } from './WorldMapPanel.js';`

### 6.3 `src/ui/Minimap.js`
- 构造：`this.onOpenWorldMap = typeof options.onOpenWorldMap === 'function' ? options.onOpenWorldMap : null;`、`this.mapButtonSize = 16`。
- 新增 `_mapButtonRect()` → `{ x: this.x + this.width - 20, y: this.y + 4, w: 16, h: 16 }`。
- `handleClick(x, y)`：在 `!this.visible` 之后、`_mapCache` 判断之前插入热区判断 → `onOpenWorldMap?.()` + `return true`。
- `render(ctx)`：在裁剪块 `ctx.restore()` 之后、方法末尾 `ctx.restore()` 之前绘制按钮（圆角底 + 边框 + `M` 字）。

### 6.4 `src/core/scene/ScenePanelLayout.js`
- `composeHud` 依赖解构增加 `WorldMapPanel`。
- 在创建 `scene.minimap` 之前创建面板：
  ```js
  scene.worldMapPanel = new WorldMapPanel({
    x: 0, y: 0, width: scene.logicalWidth, height: scene.logicalHeight, visible: false
  });
  scene.worldMapPanel.setDataProviders({
    getWorldIndex: () => scene._worldIndex || scene.context?.world?.worldIndex || null,
    getRegionId: () => scene._worldRegion?.id || scene.context?.world?.region?.id || null,
    getPlayer: () => scene.playerEntity?.getComponent?.('transform')?.position || null,
    getSceneId: () => scene.currentSceneId || null,
    getCityStates: () => scene.gameLoader?.blackboard?.get?.('cityStates') || [],
    getProject: () => scene.gameLoader?.project || null
  });
  ```
- 小地图选项加 `onOpenWorldMap: () => scene.worldMapPanel?.open()`。
- `onResize(width, height)` 加 `scene.worldMapPanel?.setSize(width, height); scene.worldMapPanel?.refreshLayout();`

### 6.5 `example/sanguo_zhangjiao/scenes/BaseGameSceneBehaviors.js`
- import `WorldMapPanel`；`_ensurePanelLayout()` 依赖对象加 `WorldMapPanel`。

### 6.6 `src/core/scene/SceneInputBindings.js`
- 构造参数加 `toggleWorldMap`；赋值 `this.toggleWorldMap`。
- `register()` 加：
  ```js
  this.inputManager.registerHotkey('toggle_world_map', ['m', 'M'], () => this.toggleWorldMap?.(), { cooldown: 250 });
  ```

### 6.7 `example/sanguo_zhangjiao/scenes/BaseGameSceneSetup.js`
- `new SceneInputBindings({...})` 加 `toggleWorldMap: () => this.toggleWorldMap()`。
- 新增方法：
  ```js
  toggleWorldMap() {
    const panel = this.worldMapPanel;
    if (!panel) return;
    if (panel.visible) { panel.close(); return; }
    if (this.dialogueSystem?.isActive?.() || this.isPlayerActionLocked?.()) return;
    panel.open();
  }
  ```
- `toggleSettings: () => this.openSystemMenu()` 改为：
  ```js
  toggleSettings: () => (this.worldMapPanel?.visible ? this.worldMapPanel.close() : this.openSystemMenu())
  ```

### 6.8 `example/sanguo_zhangjiao/systems/SanguoSceneLifecycleCoordinator.js`
- `handleModalInput`：在 `endingPresentationView` 分支之后插入
  ```js
  if (this.worldMapPanel?.visible) {
    return this.worldMapPanel.handleInput({ inputManager, gamepad, viewWidth: this.logicalWidth, viewHeight: this.logicalHeight });
  }
  ```
- `renderPostPipeline(ctx)` 末尾加 `this.worldMapPanel?.render(ctx);`（最顶层，压过调试层）。

### 6.9 新增 `src/ui/WorldMapPanel.test.js`（vitest）
覆盖纯逻辑：城池 id→场景映射、世界→地图比例、scroll 夹紧、`toggle/open/close`、无数据不崩溃。

---

## 7. 回归与风险

| 风险 | 处置 |
|------|------|
| 小地图点击定位被按钮误伤 | 热区仅 16×16 且在 `beginSeekDrag` 之前短路；其余区域行为不变 |
| 打开地图期间误触世界 | `handleModalInput` 返回 true → `_modalConsumed`，世界路由整帧跳过 |
| 结局/战斗界面与地图叠加 | 地图分支放在 `endingPresentationView` 之后；打开前已拦截 `isPlayerActionLocked()` |
| 多 chunk 场景（`S01-C01`） | `getSceneId()` 去 `-C\d{2}` 后缀再定位锚点；玩家坐标本身是全局坐标，无需换算 |
| `worldIndex` 尚未就绪时按 M | 面板显示占位文案，不抛错；`_refreshCities` 空数组安全 |
| 静态缓存过期 | 仅 `open()` / `refreshLayout()` / region 变化时重建，查看期间世界静止，无需逐帧重建 |

存档：本功能纯查看，不写 storyState / cityStates，无存档迁移。

---

## 8. 验证

1. `node --check` 覆盖全部改动/新增 JS。
2. `npx vitest run src/ui/WorldMapPanel.test.js`。
3. `npx vitest run src/ui`（若存在其他 UI 用例）。
4. 实机：
   - M 开/关、ESC 关、小地图「M」按钮开；
   - 玩家标记位于当前场景，8 城池落在 S03/S04/S05/S07/S09/S10/S11/S12；
   - 拖动到四边夹紧，不露空白；「回」按钮回玩家；
   - 打开时 WASD/点击地面无移动，关闭后恢复；
   - 背包打开状态下按 M 的表现（地图与背包不互相吞键）。

---

## 9. 明确不做（本轮）

- 滚轮/双指缩放、拖动惯性；
- 城池点击传送、任务目标连线；
- 手柄 M 映射与触屏独立大地图按钮；
- 大地图内的小地图/战争态势叠加。

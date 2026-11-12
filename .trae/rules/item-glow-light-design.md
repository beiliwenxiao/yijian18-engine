# 点光源物品与物品发光属性设计（Item Glow / Point Light Items）

> 状态：已实施 · 2026-10-28
> 需求：①新增点光源类型的物品——蜡烛、火把、火堆、熄灭的火堆、萤火虫；②物品定义增加发光属性（glow）。

## 1. 现状结论（勘察实证）

1. 阴影系统已有完整点光源管线：`ShadowRenderer.resolveLighting` 接收
   `pointLights[{x,y,radius,strength}]`，`SceneRenderPipeline._assembleShadowLighting`
   每帧合并 `scene.lighting.pointLights` + 已点燃剧情营火（campfire 服务专用注入）——
   半径内实体影子自动背光并拉长影。
2. 物品生成链：placement(kind:'item') → `worldProp:true` 走 `EntityFactory.createProp`
   静物实体（支持 renderStyle 代码绘制兜底）；否则走地面拾取物（`{...data}` 展开入
   pickup，定义字段天然透传）。
3. 现有 `story.s01.campfire` 是专用剧情火堆（燃料/点燃玩法 + campfirePresentation），
   不适合作为通用点光源物品的载体——本次沉淀**通用 glow 属性**，与营火服务并存不互扰。
4. 光晕绘制先例：`GroundMarkerRenderer`（'lighter' 合成 + 径向渐变 + 呼吸脉冲）。

## 2. 数据模型：物品定义 glow 块

library.json 物品定义（items[]）新增可选 `glow` 块，**radius > 0 才发光**：

```jsonc
"glow": {
  "color": "#ff9a3e",    // 光色（#rgb/#rrggbb，缺省 #ffb057 暖橙）
  "radius": 160,         // 光照半径 px——光晕可视半径 + 阴影点光源半径
  "intensity": 0.6,      // 峰值强度 0..1（缺省 0.55）
  "flicker": "fire",     // "fire"=火光高频抖动 | "breathe"=缓慢呼吸(≈2.6s) | 缺省=稳定
  "yOffset": 0           // 光心相对落点垂直偏移 px（负=上移；烛火/萤火虫用）
}
```

- 场景级微调：placement `overrides.glow.*` 经 mergeOverrides 合成（与 overrides.ai 同款）。
- 通用性：**任何物品**（worldProp 静物或地面拾取物）声明 glow 都发光——点光源是一种
  属性而非新物品类型；物品 `type: "light"`（点光源）仅作内容库分类标签。

## 3. 渲染链路（框架级，全部零分配/复用缓冲惯例）

```
每帧 renderWorldObjects（世界层）：
  _assembleShadowLighting
    ├─ scene.lighting.pointLights（场景配置）
    ├─ campfire 服务（剧情营火，不变）
    └─ ★ _collectGlowSources：实体 glowProfile + 拾取物 glow → 注入 pointLights
       （radius 内实体影子背光拉长影——烛光/火把照影免费获得）
  renderEntityShadows（不变）

  ↓ 之后是屏幕层（screenLayers）

  renderAtmosphere（时间蒙版：夜色/黄昏黑幕 + 玩家/营火透光洞）
  ★ renderGlowHalos（物品光晕，'lighter' 叠加在蒙版之上）
     —— 顺序关键：光必须画在夜色蒙版之后，夜里才"打得穿"黑幕、照亮地面；
        与营火 halo 同层处理（SceneCampfireService.renderAtmosphere 末尾）
```

- **LightGlowRenderer**（新，框架级纯静态）：`draw(ctx, {x, y, radius, color, intensity,
  flicker, time})`；flicker 因子内聚（fire=双正弦高频抖动、breathe=慢正弦呼吸）；
  颜色支持 #rgb/#rrggbb/'r,g,b'，内部归一化。
- **PlacementSpawner**：`data.glow` → `entity.glowProfile`（与 shadowProfile 同点位注入）；
  拾取物路径 `{...data}` 展开天然携带。
- 视口剔除：光晕与点光源收集按 `viewBounds + radius` 裁剪；光源总数上限 32（防滥用）。
- 熄灭的火堆：微弱余烬 glow（radius 46 / intensity 0.14）表达"刚熄灭"，策划可清零关闭。

> **2026-11-12 修正（不发光问题）**：光晕原先画在世界层（Y-sort 之前），会被
> `TimeSystem` 的夜色蒙版（night 0.65 / dusk·dawn 0.25）盖住 → 暗场景里"点了灯不亮"。
> 现改为屏幕层 `renderGlowHalos`（紧跟 `renderAtmosphere`，自带 `-viewBounds` 平移），
> 光晕叠加在蒙版之上；点光源阴影注入仍在世界层，两处共用同一份 `_glowSources` 缓冲。

## 4. 五个物品定义（worldProp 场景静物，代码绘制样式兜底）

| id | 名称 | renderStyle | glow 要点 |
|----|------|-------------|-----------|
| `prop.candle` | 蜡烛 | `candle`（蜡柱+火苗） | 暖黄 #ffca7a / r 110 / fire / yOffset -26 |
| `prop.torch` | 火把 | `torch`（木柄+火头） | 橙 #ff9a3e / r 150 / fire / yOffset -34 |
| `prop.campfire` | 火堆 | `campfire_lit`（石圈+柴堆+火舌） | 橙红 #ff8c2e / r 240 / fire |
| `prop.campfire.unlit` | 熄灭的火堆 | `campfire_unlit`（石圈+柴堆+余烬） | 暗红 #c8452a / r 46 / 0.14 稳定 |
| `prop.firefly` | 萤火虫 | `firefly`（悬停光点群） | 荧绿 #a8ff9e / r 90 / breathe / yOffset -18 |

- 全部 `worldProp: true`（场景静物不可拾取）+ `type: "light"`（点光源分类）。
- **无专属贴图**：imageId 留空，renderStyle 代码绘制（狼牙复用贴图同款过渡策略）；
  后续出专属贴图时补 imageId + manifest 条目，renderStyle 自动让位（有图优先）。
- 火堆/熄灭的火堆可用 `imageId: "s01.prop.campfireBase"` 换真图（二选一，默认代码画）。

## 5. 编辑器与调参（策划使用说明）

### 5.1 三种配置入口

| 想改什么 | 在哪改 | 写法 |
|---|---|---|
| 某个物品的默认光效（所有场景通用） | 编辑器「内容库」→ 物品 → 选 candle/torch/campfire/… → 专属属性(JSON) | 改 `glow` 块 |
| 只改本场景里这一根的亮度/半径/颜色 | 场景编辑器选中该物品 placement → 专属属性(JSON) 覆盖 | `overrides.glow.{radius,intensity,color,...}` |
| 让某个已有物品开始发光 | 同上两处任选其一，加 `glow.radius > 0` | 无 glow 或 radius=0 即不发光 |

物品类型标签 `light`（点光源）仅用于内容库分类筛选，不参与渲染判定——**任何物品**
带 `glow.radius > 0` 都发光（包括地面掉落物：`glow` 会随定义展开到拾取物上，
被捡起后自动不再发光）。

### 5.2 可调参数

| 参数 | 范围/默认 | 调它会发生什么 |
|---|---|---|
| `radius` | px，默认无（>0 才发光） | 光晕可视范围 + 阴影点光源半径（半径内实体影子会背光拉长）。火堆 240 / 火把 150 / 蜡烛 110 / 萤火虫 90 / 熄灭火堆 46 |
| `intensity` | 0.05–1，默认 0.55 | 光晕亮度；0.5 左右柔和，>0.75 会明显过曝 |
| `color` | `#rgb`/`#rrggbb`/`"r,g,b"` | 光色；暖橙 `#ff9a3e`、烛黄 `#ffca7a`、荧绿 `#a8ff9e` |
| `flicker` | `"fire"`/`"breathe"`/缺省 | 火光高频抖动 / 萤火虫式慢呼吸（≈2.6s）/ 稳定光 |
| `yOffset` | px，负=上移 | 光心贴合火苗高度（蜡烛 -26、火把 -36、萤火虫 -18），影响光斑与影子的中心位 |

### 5.3 场景里怎么放

1. 左侧「内容库」搜「火把/蜡烛」，拖进场景（生成 `kind: "item"` 的 ref placement）。
2. 物品是 `worldProp` 静物（不可拾取、不挡路除非另配碰撞），`S01-initial` 等 group
   由 `trg_s01_spawn_initial` 的 `spawnPlacements` 在进场景时生成。
3. 想在同一根上微调（比如篝火旁的火把更亮）：选中它 → 专属属性(JSON) 填
   `"overrides": { "glow": { "radius": 190, "intensity": 0.7 } }`。
4. **编辑器画布不渲染光晕/夜色蒙版**（编辑器是独立的预览画布，不走 `SceneRenderPipeline`），
   要确认实际效果请进游戏看。

### 5.4 已放入 S01 的示例（2026-11-12）

`S01-spawns` 层、group `S01-initial`：营火两侧火把 ×2、庇护所门口蜡烛 ×2、
河岸萤火虫 ×2 —— 进游戏即见；策划可按上面表格直接调数值或删改。

## 6. 实施落点（已完成）

1. `src/rendering/LightGlowRenderer.js`（新）：光晕绘制 + flicker 因子 + glow 归一化。
2. `src/core/scene/PlacementSpawner.js`：glowProfile 注入。
3. `src/core/scene/SceneRenderPipeline.js`：_collectGlowSources（实体+拾取物→点光源）
   + _renderGlowHalos（光晕 pass，阴影后/Y-sort 前）。
4. `src/rendering/NpcRenderStyles.js`：5 个 renderStyle 代码绘制。
5. `example/.../library.json`：5 个物品定义。
6. 编辑器两处 ITEM_TYPE_LABELS 加 light 标签。
7. 单测：LightGlowRenderer（归一化/闪烁/绘制无异常）+ PlacementSpawner glowProfile 注入。

## 7. 边界与后续可选

- 发光≠照亮场景像素（无全局光照/夜色系统）；当前语义=光晕表现 + 阴影方向响应。
  夜色/昼夜调光后续接 scene.lighting.strength 时段曲线（独立迭代）。
- 营火服务（燃料/点燃玩法）不受影响；未来可让 `prop.campfire` 与营火服务对接。
- 掉落战利品（loot 实体）暂不消费 glow（掉落链独立），需要时在 ItemRuntimeFactory
  投影里透传即可。

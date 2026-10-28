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
每帧 renderWorldObjects：
  _assembleShadowLighting
    ├─ scene.lighting.pointLights（场景配置）
    ├─ campfire 服务（剧情营火，不变）
    └─ ★ _collectGlowSources：实体 glowProfile + 拾取物 glow → 注入 pointLights
       （radius 内实体影子背光拉长影——烛光/火把照影免费获得）
  renderEntityShadows（不变）
  ★ _renderGlowHalos：LightGlowRenderer 逐源画光晕
    （'lighter' 合成径向渐变 + fire/breathe 闪烁；画在 Y-sort 队列之前=贴地层）
```

- **LightGlowRenderer**（新，框架级纯静态）：`draw(ctx, {x, y, radius, color, intensity,
  flicker, time})`；flicker 因子内聚（fire=双正弦高频抖动、breathe=慢正弦呼吸）；
  颜色支持 #rgb/#rrggbb/'r,g,b'，内部归一化。
- **PlacementSpawner**：`data.glow` → `entity.glowProfile`（与 shadowProfile 同点位注入）；
  拾取物路径 `{...data}` 展开天然携带。
- 视口剔除：光晕与点光源收集按 `viewBounds + radius` 裁剪；光源总数上限 32（防滥用）。
- 熄灭的火堆：微弱余烬 glow（radius 46 / intensity 0.14）表达"刚熄灭"，策划可清零关闭。

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

## 5. 编辑器

- 物品类型标签：`ITEM_TYPE_LABELS` 加 `light: '点光源'`（SceneEditorAssets / LibraryEditor）。
- glow 属于"专属属性(JSON)"编辑器现有 JSON 域，不另做表单；后续可加可视化调参。

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

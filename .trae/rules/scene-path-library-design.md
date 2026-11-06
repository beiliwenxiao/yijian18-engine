# 场景剧情路径库设计（Scene Path Library）

> 状态：已实施 · 2026-11-06
> 需求：张角黄巾军进场路线从右往左，路线要能在场景编辑器里可视化编辑、可控制；
> 一步到位做**场景级命名路径库**——任务/事件路线（军团行军、NPC 剧情走位等）统一引用。

## 1. 数据模型（场景 JSON 顶层 `paths`）

```jsonc
"paths": [
  {
    "id": "path.s02.column.entry",      // 场景内唯一；触发器/任务按 routeId 引用
    "name": "黄巾军入场·右进左落",        // 编辑器列表显示名
    "points": [[1080,560],[900,480],[620,398],[430,400],[220,420]],
                                        // 场景局部绝对坐标；点序=行进序（从右往左就是点从右往左排）
    "color": "#b48cff"                  // 可选：画布/调示颜色，缺省紫
  }
]
```

- 与 placement 巡逻路线（相对锚点）不同，剧情路径是**场景级绝对坐标**——它不属于任何
  放置物，属于场景本身（空间归场景，与 buffZone 同层）。
- 数据链零成本：编辑器 `loadScene` 无损透传未知顶层字段、`service.save` 整文档提交、
  SCENE_SCHEMA 只拦 legacy roots 不拒新增字段。

## 2. 运行时

| 落点 | 语义 |
|------|------|
| `src/core/scene/ScenePathLibrary.js`（新） | `collectPaths(terrains)`：照 `collectBuffZones` 先例——遍历 `terrain._sceneDataRaw.paths`，按 `worldOffset` 投影世界坐标；同 id 跨 chunk 以先载入为准 |
| `SceneTerrainBinding.collectScenePaths()` | 缓存 `scene._scenePaths`（数组）+ `scene._scenePathMap`（id→path）；`_scenePathsCollected` 守卫随 chunk 集齐置位（照 `_buffZonesCollected`） |
| `S02ArmyRescueFlow.marchArmy({armyId, routeId?, waypoints?})` | **waypoints 显式优先**（一次性剧情覆盖）；否则 `routeId` → `_scenePathMap` 查路径转 waypoints；未收集时 lazy collect 一次（spawn 同帧调用确定性）；查不到返回 `{ok:false, code:'unknownRoute'}` |

到达语义不变：`armyMarchArrived` 照旧 fire，任务链零改动。`ArmyCommandSystem.startMarch`
不感知路径库（只吃世界坐标 waypoints）——分层干净。

## 3. 编辑器（复用巡逻路线三件套机制）

| 落点 | 语义 |
|------|------|
| UI（SceneEditorUI） | 场景信息区新增「剧情路径」`<details>` 面板（照战役流程参数先例）：路径列表（名称/点数）+ 新建/删除 + 每条「编辑路线」开关（`_editingScenePathId`）；选中显示 id（触发器 routeId 抄这里） |
| Canvas（SceneEditorCanvas） | 每帧画全部路径：虚线折线 + 终点方向箭头 + 名称标注；选中加粗；编辑态画顶点手柄（圆形，同巡逻） |
| Interaction（SceneEditorInteraction） | 编辑态 mousedown 顶点手柄优先 → draggingVertex（伪对象 `{__scenePath:true, points}`，getPolygonWorldPoints/setPolygonWorldPoints 走绝对坐标分支，无锚点偏移）；contextmenu 顶点删除/边插入（≥2 点）；非编辑态点空白处兜底命中折线选中 |
| 历史（SceneEditorHistory） | 新建/删除/拖点结束/插删点走既有 push 快照惯例 |

编辑器所见=运行时所得：画布折线即行进序（终点箭头标方向），无第二套换算。

## 4. 内容接线（S02）

1. S02.json 顶层 `paths` 新增 `path.s02.column.entry`（右→左五点，终点=原触发器终点
   220,420 村中落位）；placement `S02-army-column` 锚点移到路径起点（右侧入场）。
2. triggers.json / quests.json 的 `army.march`：删硬编码 waypoints，改 `"routeId": "path.s02.column.entry"`。

## 5. 泛化与后续

- 第二消费方出现时（NPC 剧情走位/护送/镜头轨道）：引擎已有 `MovementComponent.setPath`
  原语，加一条 `scenario.command`（如 `unit.walkPath {target, routeId}`）消费
  `_scenePathMap` 即可——路径库本体无需再改。
- 路线方向语义：点序即方向，编辑器拖点实时所见；「从右往左」= 数据表达，无专门开关。

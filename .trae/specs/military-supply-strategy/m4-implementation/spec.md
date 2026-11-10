# M4 实施规格 v2 · 大地图指挥（逻辑路径层 / 通行投影 / 四选遭遇）

> 状态：**v2 定稿稿，2026-11-10**；v1（扩 PathfindingSystem + 场景锚点格 + 遭遇自动结算）已被取代。
> 上游：[04-worldmap-command.md](../04-worldmap-command.md) · [tasks.md](../tasks.md) · [decisions.md](../decisions.md)
> 前置已落地：M1 `2181ce9a`、M2 `c0bfd1b`、M3 3A `8cce967` / 3B `0d81ad5` / 3D `dde1105`（已推 gitee）。
> 施工约束：**M1/M2 文件不动**；M3 文件只做**增量式**改动（见 §11），不回退任何已提交语义。

---

## 0. v1 → v2 修订说明

| v1 | v2 | 理由 |
|---|---|---|
| 扩 `PathfindingSystem` 跑 20×20 世界格 | **独立逻辑路径层**（节点/边图），`PathfindingSystem` 零改动 | 世界寻路与地图表现解耦 |
| 桥/渡口 = 场景锚点格 | 桥/渡口 = 逻辑节点 + `crossingNodeId` 边 | 可占领、可封锁、可编辑 |
| 地形网格决定通行 | 地形只做表现底图；通行**只**由图边判定 | 单一判定源 |
| 遭遇自动结算 / 在场即介入 | 撞见弹**四选确认**：埋伏 / 绕道 / 战斗 / 撤退 | 玩家决策权 |
| 通行色单独一套计算 | 通行色是 `WorldRouteLayer` 的**派生投影**，无独立判定/缓存 | 防两份判断漂移 |
| 关隘数据源仅 `army.form` | 关隘 = 独立 kind，逻辑层定义 + `armyStates` 运行态 + 关税 | 可编辑、可结算 |
| 逻辑对象/表现对象混在一起 | L0–L3 四层 + 编辑器视图切换 | 解决 z-order/命中/拖拽互抢 |

---

## 1. 范围与边界

| 交付段 | 内容 | 验收 |
|---|---|---|
| **4A 逻辑层 + 地图层** | `WorldRouteLayer`（数据 + 通行判定 + 派生投影 + 图最短路）、`WorldMarchExecutor`、`armyStates.route`、四类标记、指令环、`world.teleport`、`syncArmies` 位置权威修正、重入补算 | 下令后旗子沿节点图走到目标；切场景回来仍在走；行军途中位置不被实体拉回 |
| **4B 逻辑编辑器 + 通行色/路径** | `editor/WorldLogicEditor.js`、三视图切换、桥/渡口/关隘**改已有**、通行条件面板、通行色叠加（派生自逻辑层）、路径虚线、不可达错误码 | 编辑器改桥/渡口/关隘并保存；重开一致；敌占关隘下令被拒且有原因 |
| **4C 遭遇四选 + 公式 + 关税** | `EncounterResolver`、四选确认框、`PassTariffSystem`、城池/关隘战果走 `CityWarSystem`、`pass.captured`、城池卡攻击别名 | 撞敌弹四选，四项后果与 §6.3 表一致；关隘计税、日结入城 |

**不做**：接管军团 / 警戒圈视野扇 / 痕迹 T2·T3 / 城池目标罗盘 / 自由镜头与地图绘制 / 载具自驾寻路 / 战场介入与将令 UI（M6）/ 配给所与城池卡本体（M2 后置、M7）/ 手柄与触屏快捷层（D8）。

---

## 2. 现状勘察结论（决定复用面）

| 事实 | 影响 |
|---|---|
| `ArmyOrderSystem.tick` 已有 500ms 战略刻、`executors` 注入、`encounterDetector(state, order)` 钩子、`unit.encounterResolved`、`serialize/restore`（schemaVersion 1） | M4 不建第二套刻；只注入执行器与 planner，加 `route` 字段 |
| `SceneArmyOrderFlow.syncArmies` 每帧用实体质心**无条件**写 `state.position`（`samples===0` 时写 `{0,0}`） | 与执行器抢写 → 行军被拉回；§4.4 修正 |
| `PathfindingSystem` 是二值 `isBlocked` + 均匀代价 A* | 世界层不走它；零改动 |
| `WORLD_MAP_TERRAINS = mountain/yellowRiver/forest/plain`，`ProjectWorldIndex` 只校验 grid/footprint | 保持纯表现；不加 `bridge` 地形 |
| `cityStates[]`（`CITY_SCHEMA`）字段：`buildingLevel/resources/damageRatio/buildingDamage/morale/damagePausedUntilDay`，**无守军/防御字段** | 城防只能由既有字段派生（§7.2） |
| `heroes[].stats.command` 已在用（统率）；`stats.might` 无数据 | 公式先只吃 `command`，`might` 预留 |
| `formations[].modifiers {attack,defense}` + `strategy` 已有；`unitTypes[].stats` + `dealMultiplier` 已有 | 公式全用既有字段 |
| `WorldMapPanel` 6 个 provider、拖动阈值 4px、城池旗由 `city.sNN_*` → 场景 `SNN` 锚点中心**隐式**推导 | 逻辑层接管位置后改为 `ref.id` 显式绑定，旧推导仅兜底 |
| `editor/world-map-editor.html` + `WorldMapEditor` 通过 `CanonicalEditorSession` 提交 `project.worldMap` | 逻辑编辑器挂同一宿主、同一写盘链路 |

---

## 3. 单一模块：`WorldRouteLayer`（逻辑层 + 通行色投影）

### 3.1 职责边界（一个模块两个出口）

```
src/core/world/WorldRouteLayer.js
├─ 数据侧（唯一权威）
│   ├─ nodes / edges / conditions / 城池关隘引用
│   ├─ evaluatePassability()  ← 全工程唯一的通行判定函数
│   ├─ shortestPath() / findNearestNode() / resolveTarget()
│   └─ snapshot（带 revision，动态因素只在这里算一次）
└─ 视图侧（只读派生，无判定）
    ├─ buildCellOverlay(region)   ← 通行色格（由 snapshot 反推，不查条件）
    └─ buildEdgeLines()           ← 边线/虚线段（同样只读 snapshot）
```

硬约束（写进代码注释与测试）：

1. **判定只有一处**：`evaluateEdgePassability(edge, snapshotContext)` 是唯一实现；`buildCellOverlay` / `buildEdgeLines` / UI / 编辑器一律只读 `snapshot`，不得重算阵营、关隘、封路。
2. **没有第二份缓存**：外部只通过 `layer.getSnapshot()` 拿不可变快照；快照以 `revision` 标识。UI 侧缓存键 = `revision`，`revision` 不变就不重建。
3. **动态因素单点刷新**：敌占、关隘易主、道路被烧、剧情封路 → 调 `layer.invalidate(reason)` → 重算一次快照并 `revision++` → 面板/编辑器按新 `revision` 重建投影。三者不会各算一遍。
4. 模块不含 canvas/DOM/entity/Blackboard 依赖，可直接单测（纯数据 + 纯函数）。

### 3.2 数据模型（`game.project.json.worldLogic`）

```jsonc
"worldLogic": {
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "node.s03_yingchuan",
      "kind": "city",                         // city | pass | bridge | ferry | junction | camp
      "name": "颍川",
      "position": { "x": 1920, "y": 720 },    // 世界坐标（逻辑唯一权威）
      "cell": { "row": 2, "col": 3 },         // 可选：编辑器吸附，运行时不读
      "ref": { "type": "cityState", "id": "city.s03_yingchuan" }, // 可选：绑运行态/表现
      "ownerFactionId": "han_government",     // 初始归属；运行态以 armyStates 为准
      "level": 2,                             // 城池/关隘规模（防御权重）
      "tollRate": 0,                          // 仅 pass：关税税率
      "tags": ["fortified"]
    },
    { "id": "node.s03_bridge", "kind": "bridge", "name": "颍水桥", "position": { "x": 1600, "y": 900 }, "level": 1 },
    { "id": "node.s03_ferry",  "kind": "ferry",  "name": "渡口",   "position": { "x": 1600, "y": 1100 }, "level": 1 }
  ],
  "edges": [
    {
      "id": "edge.s03_yingchuan__bridge",
      "from": "node.s03_yingchuan",
      "to": "node.s03_bridge",
      "mode": "road",                // road | bridge | ferry | mountainPath | waterway
      "cost": 1.0,                   // 权重（越大越慢）
      "bidirectional": true,
      "conditions": {
        "factionIds": null,          // null=全通；数组=仅这些阵营
        "crossingNodeId": null,      // 过河/过关：必须控制该节点
        "blockedUntilDay": null,     // 剧情封路（游戏日）
        "terrainBlocked": false      // 永久地形阻隔（灰·无路；不做任何绕行）
      }
    }
  ],
  "combat": { "…": "§7 公式参数" },
  "tariff": { "defaultRate": 0.03, "sweepToCity": true }
}
```

- 存放：`game.project.json` 顶层（与 `worldMap`/`armyOrders` 同级），运行期由 `gameLoader.project.worldLogic` 一次加载；编辑器通过 `CanonicalEditorSession` 提交同一字段。节点规模（预估 <60）不值得拆文件，故不做 `$ref`。
- 与 `WORLD_MAP_TERRAINS`：**无数据依赖**。地形只在编辑器底图与 `ProjectWorldIndex` 校验中使用；`mode` 是路径属性，不是地形枚举。

### 3.3 判定语义（唯一实现）

输入：`{ day, ownership: Map<nodeId, factionId>, moverFactionId }`。

```
evaluateEdgePassability(edge, ctx):
  1. terrainBlocked === true            → { status:'terrain', passable:false }   // 灰
  2. blockedUntilDay > day              → { status:'closed',  passable:false }   // 橙
  3. factionIds 非空且不含 moverFaction   → { status:'hostile', passable:false }   // 红
  4. crossingNodeId:
       该节点不存在 / kind 不是 bridge|ferry|pass → { status:'invalid', passable:false }
       归属为空（中立）                          → 放行（收税，见 §8）
       归属 === moverFaction                    → 放行
       否则（敌方控制）                          → { status:'hostile', reason:'crossingHeldByEnemy' }
  5. from/to 端点任一为 pass 且被敌方控制       → { status:'hostile', reason:'passBlocked' }
  6. 其余                                      → { status:'passable', passable:true }
```

优先级：`terrain > closed > hostile > passable`（一格被多条边覆盖时取最高严重度，用于着色）。

`snapshot` 结构（冻结、不可变）：

```js
{
  revision: 7,
  day: 12,
  edges: { [edgeId]: { passable, status, reasons: [] } },
  nodes: { [nodeId]: { status, ownerFactionId, kind } },
  adjacency: Map<nodeId, Array<{ edgeId, to, weight }>>   // 仅 passable 边
}
```

### 3.4 派生投影（视图侧，只读）

**格覆盖 `buildCellOverlay(region)`**

- 节点 → 格：`node.cell` 缺省时由 `position` 反推 `{row: floor(y/chunkHeight), col: floor(x/chunkWidth)}`。
- 边 → 格：两端节点格做 Bresenham 栅格化，路径上每格取该边状态。
- 多条边覆盖同格：按 `terrain > closed > hostile > passable` 取最高。
- 无任何边经过的格：`noRoute`。
- 输出纯数据数组 `[{row, col, status, reasons, edgeIds}]`，带 `revision`；**不返回颜色**，颜色映射在 UI 常量里（表现层自由换皮，不影响判定）。

**边线 `buildEdgeLines()`**：`[{edgeId, from, to, status, revision}]`，虚线样式由 UI 决定。

**四种状态与图例（区分「地形挡」与「敌情挡」）**

| status | 颜色 | 含义 | 玩家可做的 |
|---|---|---|---|
| `passable` | 绿 | 有边且当前可走 | 直接下令 |
| `hostile` | 红斜纹 | **敌情挡**：阵营禁行 / 关隘他控 / 关隘封锁 | 绕道，或先打下来 |
| `closed` | 橙斜纹 | 剧情封闭（`blockedUntilDay`） | 等到解封日 |
| `terrain` | 深灰实心 | **地形挡**：永久阻隔（`terrainBlocked`） | 不可通行 |
| `noRoute` | 浅灰点纹 | 没有任何边经过（无道路/断图） | 需要编辑器补边 |

> 「灰」只代表地形/无路，**不用于敌情**；敌情一律红。这样一眼能分清「这里根本没过河的路」和「桥被敌人占了」。

### 3.5 按格显示 vs 按边寻路的口径关系

| 问题 | 口径 |
|---|---|
| 寻路按什么 | **按边**：Dijkstra 走 `snapshot.adjacency`（只含 passable 边），权重 = `edge.cost` |
| 显示按什么 | **按格**：`buildCellOverlay` 把边栅格化成格（Bresenham），节点格单独标 kind |
| 两者会不会不一致 | 不会：格状态**完全由边状态反推**，同一个 `revision`。一格红 ⇔ 覆盖它的可走边全被敌情挡 |
| 不可达区域怎么标 | 无边经过 = `noRoute` 浅灰；有边但全不可走 = 该边状态色（红/橙/深灰） |
| 绕道判定依据 | 图算法（避开该 `edgeId` 后是否仍有通路），与格的着色同源 |
| 性能 | 快照只在 `invalidate` 时算；格覆盖只在 `revision` 变化时重建；不在每帧 |

---

## 4. 逻辑 / 表现分层（结构问题正面回答）

### 4.1 问题本质

同一位置既有逻辑对象（城池/关隘节点）又有表现对象（旗子/实体），若二者都是"可点可拖的图元"，z-order、命中、拖拽必然互抢；数据层同病：`syncArmies`（表现→数据）与执行器（逻辑→数据）同时写 `armyStates.position`。

### 4.2 四层

| 层 | 内容 | 可交互 | 持久化 |
|---|---|---|---|
| **L0 逻辑数据** | `worldLogic` 纯记录；节点/边/条件/归属 | 否 | 是（project） |
| **L1 派生快照** | `WorldRouteLayer.getSnapshot()`（通行判定结果，唯一） | 否 | 否（可重建） |
| **L2 投影/绘制** | `buildCellOverlay`/`buildEdgeLines` → 面板与编辑器画布 | 否 | 否 |
| **L3 交互** | 编辑器按视图模式激活一套命中表；运行面板固定优先级「标记 > 城池/关隘 > 底图」 | 是 | 否 |

规则：

1. **单向**：逻辑 → 快照 → 绘制。绘制层永不改逻辑坐标；拖拽只在 L3 写 `node.position`。
2. **ID 绑定**：表现/运行态对象带 `logicNodeId`（`ref`），不靠坐标对齐。移动节点不需改渲染数据。
3. **z-order 只影响观感**：逻辑层固定画在底（边 < 节点），不参与实体 y-sort；命中按层优先级，不靠遮挡关系。
4. **坐标系分离**：逻辑用世界坐标（+ 可选 `cell`）；像素换算只在面板/编辑器内做。

### 4.3 编辑器三视图

| 视图 | 逻辑层 | 表现层（场景锚点/地形） | 可交互 |
|---|---|---|---|
| 表现视图 | 只画（半透明） | 完整 | 仅表现 |
| 逻辑视图 | 完整（网格压暗） | 只画（不可点） | 仅逻辑 |
| 叠加只读 | 完整 | 完整 | 仅表现 |

避免"拖旗子顺手拖走城池节点"这类事故。

### 4.4 对 `syncArmies` 覆盖 position 的影响（必修）

**根因**：两处写同一字段，无权威声明。

| 单位状态 | position 权威 | 行为 |
|---|---|---|
| 有 `order.state==='executing'` 且 `route` 有效 | **逻辑层（执行器）** | `syncArmies` 跳过 position，只更新 `roster`（存活/阵亡 id） |
| 无指令 / `completed` / IDLE | **表现层（实体质心）** | 保持现状（玩家手动挪动以实体为准） |
| 场景内无实体 | 逻辑层 | 现状已如此 |

附加修正：`samples === 0` 时不再写 `{0,0}`（保留原值）。
不做：4A 不新增"把 state.position 推回实体"的反向写入（`ArmyCommandSystem.startMarch` 已在驱动实体），避免出现第三个写入者。

---

## 5. 世界地图逻辑编辑器

### 5.1 宿主与文件

- 宿主：`editor/world-map-editor.html` 内的 `WorldMapEditor`，新增三视图切换与工具栏；**不新开页面**（同一 project、同一 `CanonicalEditorSession`、同一世界坐标）。
- 新增 `editor/WorldLogicEditor.js`：逻辑视图的 DOM/画布/交互控制器（只管编辑，不含通行判定）。
- 共用模型：`src/core/world/WorldRouteLayer.js`（运行时与编辑器同一份 schema、校验与判定）。
- 保存：只把 `worldLogic` 写回 `game.project.json`（走 `CanonicalEditorSession`），不新开写盘路径。

**来源标记（2026-11-10 预留裁定）**：`nodes[]` / `edges[]` 允许可选 `source: 'auto' | 'manual'`（缺省视为 `manual`）与可选 `autoRevision`。数据层**不因来源影响任何通行判定**，仅用于未来「自动抽取重抽时只覆盖 auto 层、保留 manual 修正」。`WorldRouteLayer.load` 必须原样保留节点/边上的扩展字段（含 `source`），禁止在规范化时丢弃。

**4B 范围边界（2026-11-10 裁定）**：
- 本轮做：三视图外壳、编辑器侧通行投影（只读快照）、单条路线虚线、不可达提示，以及**改已有**（拖节点/改权重/改条件/改归属/改桥渡关隘属性）。
- 暂缓：凭空新建节点/边、连边、级联删除等「从零画图」完整流程——等「全手工编 vs 地图自动抽取 + 编辑器修正」拍板后再落；若选自动抽取，编辑器重心转为校验/校正，并需区分 auto/manual 两层（重抽只覆盖 auto）。

### 5.2 编辑操作

> 4B 先实现「改已有」行；「加节点/连线/删除」列在暂缓区，等来源方案拍板。

| 操作 | 交互 | 写回 |
|---|---|---|
| 加节点 | 工具栏选 kind → 点画布（吸附 `cell` 或自由） | `nodes[]` |
| 移节点 | 拖拽 | `nodes[].position`（+`cell`） |
| 连线 | 从节点拖到另一节点 → 选 `mode` | `edges[]` |
| 改权重 | 选中边 → 数字 `cost` | `edges[].cost` |
| 通行条件 | 阵营白名单 / `crossingNodeId` / `blockedUntilDay` / `terrainBlocked` | `edges[].conditions` |
| 桥/渡口 | 建 `bridge`/`ferry` 节点 → 连边并设 `crossingNodeId` | 节点 + 边 |
| 关隘 | 建 `pass` 节点 → `ownerFactionId`/`level`/`tollRate` | `nodes[]` |
| 删除 | 删节点级联删边并提示影响条数 | 三处同步 |
| 校验 | 孤立节点 / 重复 id / 断边 / `crossingNodeId` 指向非桥渡 / `cost<=0` | 只读报告，拒绝保存并高亮 |

**4B 实现口径（2026-11-10）**

- 已实现行：移节点（拖拽/数值输入，清掉过期 `cell` 吸附）、改权重（写 `cost` 并删 `weight` 别名）、通行条件（统一收敛到 `edges[].conditions`，删除边顶层同义字段）、桥/渡口/关隘属性（`ownerFactionId` / `level` / `tollRate` / `crossingNodeId` / `mode`）、校验（`validateWorldLogic`：错误拒绝保存，警告放行）。
- 暂缓行：加节点、连线、删除级联——校验面板与工具栏不提供入口。
- **口径统一**：`WorldRouteLayer.resolveEdgeCost` / `resolveEdgeConditions` 兼容 4A 初版内容别名（`weight`、边顶层 `crossingNodeId`），判定/最短路/校验/编辑器共用同一函数；编辑器写入一律用规范键（`cost` + `conditions.*`），避免双源漂移。
- 视图：三视图外壳由 `WorldLogicEditor` 提供（表现视图隐藏投影 / 逻辑视图压暗网格并接管指针 / 叠加只读显示但不接管）；通行色与边线只读 `buildCellOverlay` / `buildEdgeLines`。

---

## 6. 遭遇：逻辑判定 + 四选确认

### 6.1 触发与暂停

```
每战略刻：
  行军中单位沿 route 推进
  ├─ 逻辑判定（EncounterResolver.detect）：同边/同节点/engageRadius 内存在敌对单位或敌对城/隘
  ├─ 且不在 retreat 冷却
  ├─ order 进入 pending（executing 但本刻不推进）
  ├─ 玩家可见（地图面板打开 或 在该场景）→ 弹四选确认
  └─ 不可见 → 按 worldLogic.combat.autoPolicy（缺省 'fight'）抽象结算
```

- 弹窗超时 `decisionTimeoutMs`（缺省 8000）= **撤退**；同一刻只弹一个，其余遭遇排队且暂停推进。
- 幂等：确认后写 `order.encounterResolvedAt`（3B 字段）。

### 6.2 消耗口径

「消耗 1 个战略刻」= 该单位本刻**不推进**（`decisionHoldTicks`，缺省 1），不是新资源、不扣全局刻数。

### 6.3 四选后果表

| 选项 | 结算 | 战略刻 | 路径 | 士气/位置代价 | 可用条件 |
|---|---|---|---|---|---|
| **埋伏** | 公式结算，攻方 +`combat.ambushBonus`（缺省 0.25） | 耗 1 刻 | 不变 | 胜：无；败：按败方退 | 仅当敌方未警戒（`order.type` 非 attack 且无目标指向我方）且 `edge.mode` ∈ road/bridge/mountainPath |
| **绕道** | 不战 | 不耗 | **改**：避开该 `edgeId` 重算；无替代路则置灰「无路可绕」 | 无 | 图算法有替代路径 |
| **战斗** | 玩家在该场景 → 实体展开实时战；否则公式 | 耗 1 刻 | 胜：原路继续；败：退上一节点 | 败方 `defeatLossRatio` 损兵 | 总是可用 |
| **撤退** | 不战 | 耗 1 刻 | 清 route，改令回上一节点（无则最近己方节点） | 士气 `-retreat.moraleCost`（缺省 10）；位置回退；`retreat.cooldownTicks`（缺省 4）内该边免遭遇 | 总是可用 |

- 撤退冷却防「原地反复撞同一敌人」刷屏。
- 事件 `unit.encounterResolved` payload 增 `choice`（ambush/detour/fight/retreat）与 `reason`。

---

## 7. 公式结算

### 7.1 结构

```
攻方 = 兵力攻击 × (1 + 统率/heroScale) × 阵法攻 × 士气系数 × (1+埋伏) × 堆叠
守方 = 兵力防御 × (1 + 统率/heroScale) × 阵法防 × 士气系数 × (1+城防) × 地势 × 堆叠
比分 = 攻方/守方 × rng(0.9~1.1)   // 攻方视角
```

### 7.2 权重来源（全部既有字段）

| 因子 | 来源 | 回退 |
|---|---|---|
| 兵力 | `armyStates.roster`（存活 `unitIds` 数）；`deployment.roster` 为 `{unitTypeId:count}` 时优先 | 缺 → 按 1 单位并标 `degraded` |
| 兵种攻防 | `library.unitTypes[].stats.attack/defense` | 10/10 |
| 兵种克制 | `unitTypes[].dealMultiplier[敌兵种]` 按数量加权 | 1.0 |
| 主将统率 | `heroes[].stats.command`（`armyStates.commanderHeroId`） | 50（中性） |
| 主将武力 | `heroes[].stats.might`（**当前无数据，预留**） | 0 |
| 阵法 | `formations[].modifiers.attack/defense`（`armyStates.formationId`） | 1.0 |
| 阵法互克 | `worldLogic.combat.strategyMatrix[atkStrategy][defStrategy]` | 1.0 |
| 士气 | `armyStates.morale` → `0.8 + 0.4×(morale/100)`；< `routMorale` 直接溃败 | 80 |
| 城池防御 | `cityStates[].buildingLevel × cityDefensePerLevel × (1-damageRatio) × (1-平均buildingDamage)` | 0 |
| 关隘防御 | `node.level × passDefensePerLevel` + 驻军编制 | 0.15 |
| 地势 | `edge.mode`：bridge/ferry 攻方 −15%；mountainPath 守方 +15%；`fortified` +10% | 1.0 |
| 多军团堆叠 | 同点己方参战数：`1 + stackBonus×(n-1)`，超 `stackLimit` 后每员 ×`stackPenalty` | 1.0 |
| 攻守身份 | 攻 `attackerModifier`；守（城内/隘内）`defenderInFort`；野守 `defenderField` | 1.0 |

差异化示例：颍川（`buildingLevel 2`、`damageRatio 0`）vs 广宗营地（`1` / `0.45`）→ 城防差约 3 倍；张角（`command 88`）vs 校尉（`45`）→ 统率项差约 15%；1 支 vs 3 支同攻 → 堆叠加成但受 `stackLimit` 惩罚。

### 7.3 结果

| 输出 | 规则 |
|---|---|
| `winner` | 比分 ≥1 攻胜 |
| `casualties` | 败方 `defeatLossRatio`(0.3)；胜方 `victorLossRatio`(0.12)，按比分劣势放大 |
| `retreatTo` | 败方回 route 上一节点；无则最近己方节点 |
| `spoils` | 攻胜 → 城资源 `spoilsRatio`(0.15) 转胜方城；关隘胜 → 累计关税 |
| `rout` | 士气 < `routMorale` → 溃败（损兵 ×1.5，士气落 `routMoraleFloor`） |

### 7.4 落点

- 野战：`EncounterResolver` 结果 → `SceneArmyOrderFlow` 写 `armyStates` + 发事件。
- 城池/关隘：转 `BattleResult` 形状 → `CityWarSystem.prepareDraft`（资源转移、`warState.battles`、`storyState.battleStats`、幂等账本免费复用）；`applyBattleResult` 的 checkpoint/回滚照旧。

---

## 8. 关隘（缩小版城池）与关税

### 8.1 数据表达：独立 kind，不塞 `cityStates`

| 数据 | 落点 |
|---|---|
| 逻辑身份 | `worldLogic.nodes[].kind = 'pass'` + `level` / `tollRate` / `ownerFactionId` |
| 运行态 | `armyStates[passId].kind = 'pass'`（3B 枚举已有），驻军用 `deployment.roster`，累计税 `supply.toll` |
| 归属 | `armyStates.factionId`（运行态权威）；`nodes[].ownerFactionId` 只作初始值 |

不写 `cityStates[]`：`CITY_SCHEMA` 的内政字段与 `CityWarSystem._validateInput` 的城资源约束对关隘全是负担，硬塞会污染城池账本。

### 8.2 常规收益收敛

关隘**没有**税收/建造/招募/生产/建筑损毁；只有：驻军防御 + 关税 + 封锁。城池卡不对关隘显示；关隘出「关隘卡」（归属/驻军/税率/累计税）——4C 薄接线。

### 8.3 关税结算：`PassTariffSystem`

```
单位进入 pass 节点
  → PassTariffSystem.collect({ pass, mover, cargoValue })
      同阵营 → 免税；中立/付费通行 → cargoValue × tollRate；敌对 → 规划阶段已不可达
  → armyStates[passId].supply.toll += 税额（当日累计）
AdvanceDayPipeline 日结
  → toll → 关隘归属方最近城池 resources（唯一写点，防双算）
```

- 不塞 `ConvoySystem`：军团也会过关，塞押运会让军团关税走不到。
- 不在 `CityWarSystem` 结算：关税是「经过即计」的持续收益，不是战果。

---

## 9. 数据落点 / schema

| 数据 | 落点 | 新旧 |
|---|---|---|
| 逻辑图 | `game.project.json.worldLogic` | 新 |
| 格覆盖/边线 | 运行时派生（无持久化） | 新 |
| 行军路线 | `blackboard.armyStates[id].route = { nodeIds, edgeIds, points, index, totalDistance, travelled, status, blockedReason }` | 增量 |
| 痕迹 | `armyStates[id].trace[]`（`trace.enabled:false` 不写） | 预留 |
| 遭遇暂停 | `armyStates[id].order.pendingEncounter` / `encounterResolvedAt` | 增量（后者已有） |
| 关税 | `armyStates[passId].supply.toll` | 增量 |
| 快照 | `gameplay.armyStrategic` 带 `route`（旧档缺省容错，provider 仍 `required:false`） | 增量 |

Schema 改动：`GAME_PROJECT_SCHEMA` 增 `worldLogic`；`ARMY_STATE_SCHEMA` 增 `route`/`trace`/`stance`（后者已有）；新增 `WORLD_LOGIC_SCHEMA`（nodes/edges/conditions/combat/tariff）。`schemaVersion` 仍 1。

---

## 10. 命令 / 事件

| operation | 状态 | 语义 |
|---|---|---|
| `unit.order` / `unit.order.cancel` / `unit.setFormation` / `army.deploy.*` / `battle.deploy.lock` / `unit.battleOrder` | 已有 | 不改语义 |
| **`world.route.preview`** | 新增 | 只读预览：`{unitId, target}` → `{ok, nodeIds, points, totalDistance}` 或 `{ok:false, code}` |
| **`world.teleport`** | 新增 | 调试/剧情直移：清 route，写 position，同步在场实体 |
| **`world.route.invalidate`** | 新增 | 动态因素变更后刷新快照（占领/封路/烧桥）；`{reason}` |
| **`world.encounter.decide`** | 新增 | 四选回执：`{unitId, choice, encounterId}` |

事件：`unit.orderIssued` / `unit.orderCompleted` / `unit.orderFailed` / `unit.encounterResolved`（含 `choice`）/ `unit.routeBlocked` / `pass.captured` / `deployment.committed`（04 §6 要求，3B 缺）。

---

## 11. 与 M1 / M2 / M3 的接线（增量，不回退）

| 文件 | 归属 | 增量 |
|---|---|---|
| `src/systems/ArmyOrderSystem.js` | M3 3B | `issueOrder` 可选 `routePlanner` 写 `state.route`；`cancelOrder` 清 route；`serialize/restore` 带 route（缺省容忍）；`_strategicStep` 支持 `pendingEncounter` 暂停；补发 `deployment.committed` |
| `src/core/scene/SceneArmyOrderFlow.js` | M3 3D | `syncArmies` 位置权威修正；无实体 march 改走 `WorldMarchExecutor`；注入 `encounterDetector`；`_restoreFromBlackboard` 后补算刻 |
| `src/core/scene/SceneGameplaySystemAssembler.js` | 装配 | 构造 `WorldRouteLayer`/`WorldMarchExecutor`/`EncounterResolver`/`PassTariffSystem`，注册新命令 |
| `src/core/scene/ScenePanelLayout.js` | 装配 | 注入 `getArmyStates`/`getWorldLogic`/`getRoutePreview` |
| `src/ui/WorldMapPanel.js` | UI | 节点/边/旗子投影、通行色层、指令环、路径虚线、点选 |
| `src/data/schema/CanonicalSchemas.js` | Schema | §9 |
| `example/.../game.project.json` | 内容 | `worldLogic` 初版（现有城池 + 桥/渡口/关隘样例） |
| `example/.../systems/SanguoGameLoaderCoordinator.js` | 内容装配 | 注入 `worldLogic`/`gameDay`/`slowestUnitSpeed` |
| `example/.../systems/SanguoDomainCommandFacade.js` | 剧情兼容 | `army.march/camp` 标 deprecated（不删） |

**零改动**：`PathfindingSystem`、`WorldMapCell`、`ProjectWorldIndex`、`CityWarSystem`、`ArmyCommandSystem`、`ConvoySystem`、`SupplySystem`、`CombatSystem`、M1/M2 全部文件。

---

## 12. 分批

| 批次 | 交付 | 验收 |
|---|---|---|
| **4A** | `WorldRouteLayer`（数据/判定/快照/最短路/**格覆盖与边线派生**，含单测）、`WorldMarchExecutor`、`armyStates.route`、标记 + 指令环 + `world.teleport`、`syncArmies` 修正、重入补算、schema/内容初版 | 下令后沿节点图行军；切场景连续；位置不被拉回；无 `worldLogic` 直线兜底；格覆盖由快照派生（同一 `revision`） |
| **4B** | `editor/WorldLogicEditor.js` + 三视图；通行色叠加与路径虚线接线；桥/渡口/关隘改已有；不可达错误码 + `world.route.preview` | 编辑器改已有保存重开一致；敌占关隘不可达并给原因；绕道可走；图例四色正确 |
| **4C** | `EncounterResolver` + 四选确认 + `PassTariffSystem` + 战果入档 + `pass.captured` + 城池卡别名 | 四选后果与 §6.3 一致；关隘计税日结一次；在场战斗展开 |

---

## 13. 测试

| 文件 | 覆盖 |
|---|---|
| `WorldRouteLayer.test.js` | 判定六条优先级、阵营/关隘/封路/地形；快照 `revision` 与 `invalidate`；最短路/绕行/无路；格覆盖由边反推（红/橙/灰/绿四色一致）；`noRoute` 与 `terrain` 区分 |
| `WorldMarchExecutor.test.js` | 逐段推进、`mode` 速度、抵达/失败、`travelled/totalDistance`、进入节点回调 |
| `SceneArmyOrderFlow` 增量 | 行军途中 `syncArmies` 不覆盖 position；`samples===0` 不写 0,0；四选暂停一刻；重入补算 |
| `EncounterResolver.test.js` | 公式各项与权重来源、溃败、损失比、`rng` 可复现、四选各自修正 |
| `PassTariffSystem.test.js` | 同阵营免税、中立计税、`toll` 累计、日结单次入城 |
| `M4Content.test.js` | `worldLogic` 结构合法（id 唯一/端点存在/`crossingNodeId` 合法/cost>0）；`combat` 必填键齐；旧档无 route 通过校验 |
| `editor/WorldLogicEditor.test.js` | 三视图命中互斥、增删级联、校验报告、保存只提交 `worldLogic` |
| `WorldCommandRing.test.js` | 五指令布局、目标高亮、部署页签 |

回归：场景核心 + 存档链；存量失败 6 文件不新增。

---

## 14. 风险

| 风险 | 处置 |
|---|---|
| M3 文件增量破坏 3B/3D 语义 | 只加可选注入与字段；不改 `tick` 间隔、指令表、部署锁语义；3B/3D 用例必须全绿 |
| 修 `syncArmies` 影响手动挪军团 | 仅「有 executing 指令」时跳过；无指令仍以实体为准 |
| 逻辑图与地图漂移 | 编辑器三视图 + 校验（孤立/断边）；城池旗改 `ref.id` 绑定，`city.sNN_*` 推导降为兜底 |
| 通行色与寻路不一致 | 结构上禁止：格覆盖只读快照，唯一判定函数；单测断言同 `revision` 下红格 ⇔ 无边可走 |
| 弹窗刷屏 | 冷却 + 单弹 + 超时撤退 |
| 关税双算 | `toll` 只累加，日结单点入城 |
| 旧档 | `route` 缺省 null 走直线；`schemaVersion` 不变；provider `required:false` |
| 图最短路性能 | 节点数十量级，下令/绕道时算一次，不逐帧 |

---

## 15. 决策定稿（D1–D10 + N1–N8）

| # | 议题 | 取值 | 一句理由 |
|---|---|---|---|
| D1 | 战略刻宿主 | 场景内每帧 + 重入补算（≤20 刻） | 不建常驻循环，切场景不静止 |
| D2 | 世界寻路 | 独立 `worldLogic` 图 + Dijkstra；`PathfindingSystem` 零改动 | 寻路与地图表现解耦 |
| D3 | 桥/渡口 | `bridge`/`ferry` 节点 + `crossingNodeId` 边 | 可占领可封锁，不扩地形枚举 |
| D4 | 遭遇 | 逻辑判定 + 四选（埋伏/绕道/战斗/撤退） | 给玩家决策权，不自动送兵 |
| D5 | 结算数值 | `worldLogic.combat` 全量可配 | 策划可调，不改代码 |
| D6 | 公式差异化 | 城池/攻守/主将/军团数全入公式，来源见 §7.2 | 同军打不同目标结果不同 |
| D7 | 关隘 | 独立 kind `pass`，仅关税收益，`PassTariffSystem` 计税 | 不污染城池内政账本 |
| D8 | 输入 | PC 点选 + 指令环 + 右键快捷 | 与 army-command-design §11.1 一致 |
| D9 | 痕迹 T1 | 不进 M4，`trace.enabled:false` | 自动化体系下无操作空间 |
| D10 | 通行色 | 运行时算一次 + 按 `revision` 缓存，派生自逻辑层 | 避免与编辑器烘焙双份判定 |
| N1 | `worldLogic` 位置 | `game.project.json` 内联 | 节点少，复用既有 session 写盘 |
| N2 | 桥/渡口表达 | 节点 + `crossingNodeId` 边 | 支持占领/封锁 |
| N3 | 弹窗触发 | 玩家可见才弹，否则 `autoPolicy` | 不打断离场军团自动化 |
| N4 | 超时默认 | 撤退 | 最保守，不自动损兵 |
| N5 | 关隘运行态 | `armyStates.kind='pass'` | 枚举已有，不建并行账本 |
| N6 | 关税系统 | `PassTariffSystem` 经过即计 + 日结入城 | 军团与押运都能收到税 |
| N7 | 武力权重 | `stats.might` 预留，先只用 `command` | 现有数据只有 command |
| N8 | 「消耗战略刻」 | 停 1 刻不推进，不新增资源 | 不引入行动点经济 |

### 15.1 结构性选择（单独标出，供知晓；改动会返工）

| # | 选择 | 落点 | 若推翻的代价 |
|---|---|---|---|
| S1 | **逻辑层宿主 = 场景装配器持有的 `WorldRouteLayer` 实例**（非独立常驻服务） | `SceneGameplaySystemAssembler` 构造，挂 `scene.worldRouteLayer`；编辑器经 `CanonicalEditorSession` 复用同一模块 | 改独立世界服务需重做装配、命令桥、存档/补算链路 |
| S2 | **编辑器形态 = 内嵌 `editor/world-map-editor.html` 三视图**（不新开独立页面） | `WorldMapEditor` 加视图切换与工具栏；同一 project、同一 session、同一世界坐标 | 独立页面需新增 project 加载/写盘/预览通道 |
| S3 | **数据位置 = `game.project.json` 内联 `worldLogic`**（N1） | 与 `worldMap`/`armies` 同级 | 拆独立文件需改 GameLoader 装载与编辑器保存目标 |
| S4 | **通行判定唯一出口 = `evaluateEdgePassability` + `getSnapshot`** | UI/编辑器只读 `buildPreview`，色值映射留在表现层 | 出现第二份判定即失去单一事实源，属返工级 |

### 15.2 可推翻清单（只改配置/数值，无结构性返工）

- `worldLogic.combat.*` 全部数值（含 `winThreshold`/`lossRatio`/`stackBonus`/`stackLimit`）；
- `worldLogic.tariff.rate`（当前 0.05）与日结目标；
- `trace.enabled`（当前 false，D9 留口）；
- N7 武力权重：当前只用 `command`，`stats.might` 有数据后改一行；
- 行军基础速度 `worldMarchSpeed`（当前 260）与各 `mode` 倍率；
- 遭遇超时默认（当前撤退）与冷却刻数。

---

## 16. 进度锚点（2026-11-10 · 4A 完成）

- 已提交：M1 `2181ce9a`、M2 `c0bfd1b`、3A `8cce967`、3B `0d81ad5`、3D `dde1105`（均已推 gitee）。
- 工作区：仅 `M vitest.config.js`（并行会话，禁提交/推送/改测试环境声明）。
- **M4 进度：方案 v2 定稿（本文件）；4A 已完成（未提交），4B 未开始。**
- 4A 落点：`src/core/world/WorldRouteLayer.js`（+19 测试）、`WorldMarchExecutor.js`（+6）、`src/ui/WorldCommandRing.js`（+4）、`SceneArmyOrderFlow.test.js`（6）；增量 `ArmyOrderSystem`（22）、`SceneArmyOrderFlow`、`WorldMapPanel`（5）、`ScenePanelLayout`、装配器、`CanonicalSchemas`、`game.project.json`、`SanguoGameLoaderCoordinator`。
- 4A 测试：world+army+UI+schema 66/66；runtime/repository/replay/ProjectWorldIndex 59/59；存量 6 文件失败基线未动。
- 已有接线点（勿重复造）：`ArmyOrderSystem.tick` 500ms、`encounterDetector` 钩子、`unit.encounterResolved`、`gameplay.armyStrategic` 可选 provider、`blackboard.armyStates`、`WorldMapPanel.setDataProviders`、`ProjectWorldIndex.getCell/getGlobalCells`、`CityWarSystem.prepareDraft`、`CanonicalEditorSession`（编辑器统一写盘）。

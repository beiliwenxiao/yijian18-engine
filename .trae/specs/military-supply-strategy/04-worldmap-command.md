# 模块 4（v2 修订）：大地图——武装单位地图层与自动行军

> 状态：设计稿 v2.1（2026-11-09 两层级修订 + **部署入口两处口径同步**，**取代 v1 的接管军团/警戒可视化/痕迹玩法/遭遇三选设计**，详见[模块 3 v2](03-army-squads.md) §0/§10）
> 归属：[军需—配给—押运—军团体系总纲](spec.md) 模块 4
> v1 保留：ArmyState 战略实体、StrategicAdvanceSystem 战略刻、地形代价通路 A*、遭遇检测、痕迹 T1 纯表现
> v2 砍掉：接管军团（army.takeover）、警戒圈/视野扇可视化、痕迹 T2/T3 与消灭踪迹、城池 objective 罗盘、遭遇三选弹窗（改"在场即介入"）
> **v2.1 部署入口（第六次拍板）**：本模块只承担**入口 ①（大地图设默认部署值）**；**入口 ②（战场内 `PRE_BATTLE` 接战前临时调整 + 「设为默认值」勾选）** 在[模块 6](06-battle-plan-intervene.md) §3.7（1）。两处共用 `armyStates[].deployment`，接战即 `DEPLOYED` 锁死。

---

## 1. v1 → v2 修订说明

| v1 设计 | v2 处置 | 理由 |
|---|---|---|
| 接管军团（跨场景换绑主角、`strategicPending`） | **砍**——玩家永远 ARPG 主角，军团自动作战 | 两层级裁定 |
| 警戒圈（圆）+ 视野扇可视化 | **砍**——遭遇判定保留为纯数值（`aggroRadius` 思想搬进遭遇规则），地图上不画圈扇 | 用户不需要可视化指挥 |
| 痕迹 T2（影响发现率）/ T3（敌军追踪）/ 消灭踪迹命令 | **砍**——痕迹仅留 T1 纯表现（走过的路颜色渐淡线，装饰） | 自动化体系下隐蔽玩法无操作空间 |
| 城池 `objective` 罗盘（目标方向八向） | **砍**——`city.setObjective` 降为内部状态，由城池卡「攻击/输送」写入（模块 7） | 玩家只见两个按钮，不见"意图"概念 |
| 遭遇三选弹窗（介入/观战/自动） | **砍**——**在场即介入**：玩家在遭遇场景则实体展开实时战，不在则自动抽象结算 | 03 §4.3，零 UI |
| 军团卡（ArmyStrategicPanel + 接管按钮） | **砍**——被点选单位后的「指令环」（03 §8：五条战略指令 + 「战前部署」页签 + 目标选择）取代 | 一套 UI |

---

## 2. 与现有系统的关系（复用判断）

| 现有系统 | v2 关系 |
|---|---|
| `WorldMapPanel`（只读展示 Region 网格/城池旗/玩家，拖动查看） | **复用 + 扩展**：加武装单位标记、点选指令环、通路虚线、预烘焙通行色底图；仍无自由镜头编辑 |
| `ProjectWorldIndex`（world 20×20、chunk 1280×720、`getOffset`） | **原样复用**——单位 position 的世界坐标锚 |
| `SanguoWorldRuntimeCoordinator`（场景流式加载） | **原样复用**——玩家走进某场景时，该场景内武装单位实体展开（黑板上 roster → 场景实体） |
| `PathfindingSystem.findPath` + `costAt` 可选钩子 | **复用 + 加钩子**：通路计算喂地形代价表；缺省 `costAt` 返回 1，零回归 |
| `CityWarSystem.prepareDraft` | **原样复用**——自动攻城战果入档 |
| `CityPanel` 城池卡（模块 7） | **层级一主入口**：攻击/输送 = `unit.order` 的别名 |
| S02 `army.march/camp` 剧情命令 | **层级一原型**（03 §2），泛化后统一走 `unit.order` |

---

## 3. 核心设计

### 3.1 武装单位地图态

- 数据即 [模块 3 §3.1](03-army-squads.md) 的 `blackboard.armyStates[]`（`kind: army|city|pass|camp`，含 `order`/`formationId`/`roster`），本模块不重复定义。
- 地图标记四种：军团三角旗（朝向=行军方向）/ 城池旗（阵营色，既有）/ 关隘图标 / 营地帐篷图标；随行小队不画标记（它在玩家场景里）。

### 3.2 地形代价与通路（`game.project.json.worldTravel`）

```jsonc
"worldTravel": {
  "terrainCost": { "plain": 1, "forest": 1.8, "hills": 1.5, "mountain": -1, "yellowRiver": -1, "bridge": 1 },
  "costAt": "terrain"                    // 钩子模式：terrain=查表；扩展 sea/天气后续再加
}
```

- `-1` = 不可通行（山、河——过河仅经 `bridge`/渡口格）。
- **通路显示取舍（v2 收敛）**：
  - 全图预烘焙通行色（可通行=淡绿 / 不可通行=红斜纹）——只算一次，零每帧成本；
  - 玩家为某单位选定目标后，画**单条路径虚线**（A* 结果）——玩家看得见"它会怎么走"；
  - 不做：多军团路径同屏、逐帧重算、拖拽实时改路径。
- **关卡封锁**：`kind:'pass'` 处于 defend 时，其所在格 cost 视为不可通行（敌方绕路/强攻两选）；被我方占领后恢复。

### 3.3 自动行军循环（`StrategicAdvanceSystem`，v1 保留核心）

```
每战略刻（默认 500ms，可配）：
  1. 有 order 的单位沿通路推进 position（速度 = 最慢兵种速 × 地形系数）
  2. 遭遇检测：与敌对单位/敌城警戒半径交叠 → 转 §3.4
  3. 补给扣减（food，每日一格判定；断粮士气 −10/日）
  4. 到达判定：attack 目标=敌城/敌单位 → 触发其战斗；move 目标=格点 → 转驻守
  5. fire unit.arrived / unit.encounterResolved / unit.orderFailed
```

- **场景卸载不影响行军**：行军是黑板数据推进，单位进入玩家所在场景才展开实体（roster → 实体），离开场景收回 roster。
- 补给/士气数值与模块 7 日结（`AdvanceDayPipeline` ④军团补给消耗）共用一份，不双算。

### 3.4 遭遇自动处理（v2：不弹窗）

```
遭遇发生（行军撞上敌对单位或敌城）
  ├─ 玩家不在该场景 → 纯抽象结算：evaluateOutcome（roster + 兵种克制/阵法/地势修正）
  │    → 战果入档（伤亡/缴获）→ fire unit.encounterResolved
  └─ 玩家在该场景 → 实体展开实时战（BattleSystem 自动 INTERVENE，玩家在场即接管）
       → 随行小队五档生效（03 §4）→ 战斗结束走同一战果链
```

- 城池攻防走 `CityWarSystem` 既有结算 + `battlePlan` 缺省值（撤退条件等由 `config/battles/*.json` 既有字段承担，不再有玩家计划面板——模块 6 v2）。

### 3.5 指令下发（UI 流）

```
大地图点武装单位 → 指令环（五条战略指令：进攻/防守/运输/移动/扎营）
  ├─ 进攻 → 目标选择器（敌城/敌单位/敌关卡）→ 确认弹窗（防误触，03 §11-7）
  ├─ 移动 → 点地图格 → 画单条路径虚线 → 确认
  ├─ 运输 → 目的地选择 + 资源勾选 → 生成押运队（模块 2）
  ├─ 扎营 → 原地扎营（campBuff）
  └─ 战前部署页签（**入口 ①：非战斗状态设默认值**）
       → 兵种构成摘要 + 阵法列表（6 种，显示数值修正 / 适用场景标签 / 地形偏好，无强弱标签）+ 主将/副将位置
       → 「保存为默认部署」（`army.deploy.commit`）→ 写 armyStates[].deployment（随军团存档）
       └─ 接战前还有一次机会：进战场后 `PRE_BATTLE` 页签可临时调整 + 勾选「设为默认值」（入口 ②，见 06 §3.7）
          **接战（battle.deploy.lock）即冻结**，此后再改一律 `DEPLOYMENT_LOCKED`（部署 vs 将令划分见 05 §6.3 / 06 §3.6）
```

### 3.6 痕迹 T1（纯表现，v2 唯一保留档）

- 移动过的格子留颜色渐淡的线（按日衰减消失）；无任何玩法影响；无「消灭踪迹」命令。

---

## 4. 状态机

引用 [模块 3 §5.1](03-army-squads.md)（武装单位 IDLE/EXECUTING/DEFENDING/CAMPED），本模块只补地图态两条：

```
地图态：MARKED（地图标记可见）⇄ DEPLOYED（实体已展开到玩家场景）
  行军单位只 MARKED；玩家进入其所在场景 → 展开 DEPLOYED → 离开收回 MARKED
```

---

## 5. 数据落点

| 数据 | 落点 |
|---|---|
| 地形代价 | `game.project.json.worldTravel.terrainCost`（新） |
| 单位状态 | `blackboard.armyStates[]`（模块 3 §3.1，含 position/trace 点） |
| **默认部署（入口 ①）** | `blackboard.armyStates[].deployment { committed, committedAt, roster, formationId, rows, commanderSlot, deputySlots }`（随军团存档；入口 ② 的临时值走 `battle.deploymentOverride`，不进存档） |
| checkpoint | `gameplay.armyStrategic`（capture/restore，含行军进度） |
| **砍** | `strategicPending`（接管交接）、`cityStates[].objective.direction`（罗盘）、`traceBonus` |

---

## 6. 命令 / 事件 / 触发器

| operation | payload | 语义 |
|---|---|---|
| `unit.order` | `{ unitId, order, target }` | 五条动作指令（模块 3 §7.1） |
| `unit.setFormation` | `{ unitId, formationId }` | 布阵（模块 3 §7.1） |
| `army.deploy.preview` / `army.deploy.commit` | `{ armyId, roster?, formationId?, rows?, commanderSlot?, deputySlots? }` | **战前部署入口 ①**（大地图设默认值）：仅非战斗状态受理，`commit` 写 `armyStates[].deployment`；战中 → `DEPLOYMENT_LOCKED`。入口 ②（战场 `PRE_BATTLE` 临时 + 勾选回写）见 06 §15 `army.deploy.temp` |
| `unit.order.cancel` | `{ unitId }` | 撤指令回 IDLE |
| `world.teleport` | `{ unitId, sceneId, x, y }` | 调试/剧情专用直移 |

**砍**：`army.takeover(.release)` / `world.trace.clear` / `city.setObjective`（玩家入口）。

事件：`unit.orderIssued` / `unit.arrived` / `unit.encounterResolved` / `unit.orderFailed` / `pass.captured`（关卡易主） / `deployment.committed`（入口 ① 保存默认）/ `deployment.tempApplied`（入口 ② 临时）/ `deployment.locked`（接战冻结）。
**砍**：`army.tookOver` / `traceSeen` / `objectiveSet`。

任务接法：攻下某城 = `commit.fact('unit.encounterResolved')` 过滤 kind=city；首通某关 = `pass.captured`；全部 `custom.event` 起步。

---

## 7. UI 入口

| 界面 | 载体 | 内容 |
|---|---|---|
| 大地图主视图 | `WorldMapPanel` 扩展 | 四类单位标记 + 点选指令环 + 通行色底图 + 单条路径虚线 + 痕迹 T1 |
| 战前部署页签（**入口 ①**） | 指令环内页签（模块 3 §8） | 兵种构成摘要 + 阵法 6 选（数值修正 / 适用场景标签 / 地形偏好，无"强于/弱于"）+ 主将/副将位置 → 保存为默认（`army.deploy.commit`）；**非战斗状态可编辑** |
| ~~战场内部署页（入口 ②）~~ | 不在本模块 | 由[模块 6](06-battle-plan-intervene.md) §3.7（1）承载：`PRE_BATTLE` 临时调整 + 「设为默认值」勾选 → 接战 `DEPLOYED` 锁死 |
| ~~战场介入按钮（接管 / 支援）~~ | 不在本模块 | 由[模块 6](06-battle-plan-intervene.md) §3.1 承载：按钮文案 = **「接管——亲自操作将领和他的亲卫」/「支援」**，默认「旁观」；点击下发 `unit.joinBattle` |
| 目标选择器 | 地图点选复用 | 敌城/敌单位/敌关卡/地图格，确认后下发 |
| 城池卡 | `CityPanel`（模块 7） | 攻击/输送别名入口 |
| **砍** | ArmyStrategicPanel / 警戒圈扇 / 城池罗盘 / 接管按钮 / 军团卡 | — |

三端：PC 左键点选 + 右键快捷（点敌=进攻、点地=移动）；手柄 A 菜单；触屏点选（沿用 army-command-design §11.1 裁定，无快捷图标层）。

---

## 8. 分级交付（v2）

| 级别 | 内容 | 验收 |
|---|---|---|
| **4A 地图层** | `ArmyState` 地图态 + 四类标记 + 战略刻行军（直线路径）+ checkpoint | 点单位下令 → 地图上旗子自动走到目标；场景卸载不中断 |
| **4B 通路 + 关卡** | 地形代价表 + A* `costAt` + 预烘焙通行色 + 单条路径虚线 + pass 封锁 | 绕山走桥；敌关卡封路需先打；不可达目标下发被拒并有提示 |
| **4C 遭遇 + 在场展开** | 遭遇检测 + 抽象结算 + 玩家在场实体展开 + 城池卡接线 | 行军撞敌自动出结果；玩家恰好在该场景则实时打；点城池卡攻击真的出兵 |

---

## 9. 零回归与风险

| 风险 | 处置 |
|---|---|
| `PathfindingSystem` 加 `costAt` 影响场景内寻路 | 缺省返回 1 = 原最短路行为不变；仅 worldTravel 配置才生效 |
| 战略刻与日结双扣补给 | 补给只在 `AdvanceDayPipeline` 日结算，战略刻只读不扣 |
| 行军单位穿越玩家场景引发实体抖动 | 展开/收回带迟滞（进出场景缓冲 1 格），roster↔实体转换幂等 |
| 通行色预烘焙在编辑器改地形后失效 | 编辑器保存 world 配置时重算一次（构建期，非运行时） |
| v1 遗留触发器引用 `army.tookOver` | 交付时全项目 grep 清理，`SanguoDomainCommandFacade` 保留 `army.march/camp` 兼容（剧情用）并标 deprecated |

---

## 10. 开放问题（v2，默认值已选）

| # | 问题 | 默认 | 若选另一种的差异 |
|---|---|---|---|
| 1 | 战略刻间隔 | **500ms** | 更密：行军更顺滑但 CPU 上升；更疏：旗子跳动明显 |
| 2 | 行军速度 | **最慢兵种速 × 地形系数** | 统一速度：简单但骑步兵同速失真 |
| 3 | 山/河通行 | **不可通行，仅桥/渡口** | 加渡船：多一条玩法线 |
| 4 | 关卡封锁代价 | **cost=∞（必须强攻或绕路）** | 高 cost（可绕但极慢）：给"绕远路"战术空间 |
| 5 | 抽象遭遇结算公式 | **兵力对比 × 兵种克制 × 阵法 × 地势，士气影响溃败阈值** | 纯兵力对比：克制/阵法失去意义 |
| 6 | 遭遇败方残部 | **败方撤回出发地（损兵 30%），不是全灭** | 全灭：太惩罚；原地溃散成流民：多一条支线 |
| 7 | 多单位同时行军冲突（同格对撞） | **先触发遭遇结算，胜者通过** | 错峰调度：AI 复杂度高 |
| 8 | 痕迹 T1 是否值得保留 | **保留（纯装饰，成本极低）** | 砍：地图更干净 |
| 9 | 玩家能否给"行军途中"单位改指令 | **能（新指令立即重算路径）** | 不能：误下指令必须等到达 |
| 10 | 通行色是否显示敌占区 | **显示（阵营色底图）** | 不显示：战略迷雾感；显示：信息更清晰 |

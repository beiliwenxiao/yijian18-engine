# M4 执行清单 v2（逻辑路径层 / 通行投影 / 四选遭遇）

> 依据：[spec.md](spec.md) v2 · 上游 [04-worldmap-command.md](../04-worldmap-command.md)
> 施工约束：M1/M2 文件不动；M3 文件只做增量（spec §11）；不碰 `vitest.config.js`。
> 每批自带测试；遇到需要拍板的空缺停下问。

## A. 决策（已定稿，见 spec §15）

- [x] D1 战略刻 = 场景内每帧 + 重入补算（≤20 刻）
- [x] D2 世界寻路 = 独立 `worldLogic` 图 + Dijkstra（`PathfindingSystem` 零改动）
- [x] D3 桥/渡口 = `bridge`/`ferry` 节点 + `crossingNodeId` 边
- [x] D4 遭遇 = 逻辑判定 + 四选（埋伏/绕道/战斗/撤退）
- [x] D5 结算数值 = `worldLogic.combat` 全量可配
- [x] D6 公式差异化 = 城池/攻守/主将/军团数（来源见 spec §7.2）
- [x] D7 关隘 = 独立 kind `pass` + `PassTariffSystem` 关税
- [x] D8 输入 = PC 点选 + 指令环 + 右键快捷
- [x] D9 痕迹 T1 不进 M4（`trace.enabled:false`）
- [x] D10 通行色 = 逻辑层派生 + 按 `revision` 缓存
- [x] N1 `worldLogic` 内联 `game.project.json`
- [x] N2 桥/渡口 = 节点 + `crossingNodeId`
- [x] N3 弹窗 = 玩家可见才弹，否则 `autoPolicy`
- [x] N4 超时默认 = 撤退
- [x] N5 关隘运行态 = `armyStates.kind='pass'`
- [x] N6 关税 = `PassTariffSystem` 经过即计 + 日结入城
- [x] N7 武力 = `stats.might` 预留，先只用 `command`
- [x] N8 「消耗战略刻」= 停 1 刻，不新增资源

## B. 4A 逻辑层 + 地图层（第 1 批）

- [x] `src/core/world/WorldRouteLayer.js`：加载/校验；`evaluateEdgePassability`（唯一判定）；`getSnapshot()` + `invalidate()` + `revision`；`shortestPath`（含 `avoidEdgeIds`）；`findNearestNode`；`resolveTarget`；`buildCellOverlay`（格覆盖，只读快照）；`buildEdgeLines`；`buildPreview`（格覆盖+边线唯一派生出口，按 `revision`+region 缓存）
- [x] `WorldRouteLayer.test.js`：判定六条优先级 / 快照 revision / 绕行 / 无路 / 格覆盖四色与 `noRoute`·`terrain` 区分（19 例）
- [x] `src/core/world/WorldMarchExecutor.js`：沿 route 推进、`mode` 速度、抵达/失败、进入节点回调
- [x] `WorldMarchExecutor.test.js`（6 例）
- [x] `ArmyOrderSystem`（增量）：`issueOrder` 接 `routePlanner` 写 `state.route`；`cancelOrder` 清 route；`serialize/restore` 带 route；`_strategicStep` 支持 `pendingEncounter` 暂停；补发 `deployment.committed`（22 例，含新增 8 例）
- [x] `SceneArmyOrderFlow`（增量）：`syncArmies` 位置权威修正（executing 跳过、`samples===0` 不写 0,0）；无实体 march 走 `WorldMarchExecutor`；`_restoreFromBlackboard` 后补算刻
- [x] `SceneArmyOrderFlow` 增量测试：行军途中位置不被覆盖、重入补算（6 例）
- [x] `WorldCommandRing.js` + 测试：五指令 + 部署页签 + 目标高亮（4 例）
- [x] `WorldMapPanel`：四类标记 + 点选（4px 阈值）+ 指令环 + 路径虚线 + 通行四色图例；provider 增 `getArmyStates`/`getWorldLogic`/`getRoutePreview`/`getOrderDefinitions`（5 例）
- [x] `ScenePanelLayout`：注入四项 provider + `setHandlers`（`onCommand → unit.order` 权威命令）
- [x] 装配器：构造 `WorldRouteLayer`/`WorldMarchExecutor`；`routePlanner`（起点吸附→终点吸附→Dijkstra）；注册 `world.teleport`、`world.route.preview`、`world.route.invalidate`；dispose 清理
- [x] `CanonicalSchemas`：`GAME_PROJECT_SCHEMA.worldLogic`、`ARMY_STATE_SCHEMA.route/trace`、`WORLD_LOGIC_SCHEMA`
- [x] `game.project.json`：`worldLogic` 初版（6 城池节点 + 桥/渡口/关隘/岔路 + 11 条边 + `combat`/`tariff`/`trace`）
- [x] `SanguoGameLoaderCoordinator`：注入 `worldLogic`/`factionId`/`worldMarchSpeed`（`getDay` 既有）
- [x] 验收：下令 → 旗子沿图行军；切场景连续；无图时直线兜底；3B/3D 用例全绿

## C. 4B 逻辑编辑器 + 通行投影接线（第 2 批）

> 2026-11-10 边界裁定：来源方案（全手工 vs 自动抽取+修正）未定前，**只做「改已有」**；
> 新建/连线/级联删除暂缓。数据结构预留 `nodes[].source` / `edges[].source`（auto|manual）。

- [x] 数据层预留：`WorldRouteLayer.load` 按引用原样保留节点/边扩展字段（含 `source`/`autoRevision`），不参与通行判定；补 `resolveEdgeCost`/`resolveEdgeConditions` 口径函数（兼容 4A 内容别名 `weight`、边顶层 `crossingNodeId`），判定/最短路/校验/编辑器共用
- [x] `editor/WorldLogicEditor.js`：三视图外壳切换；改已有（拖节点/改权重/条件/归属/桥渡关隘属性）；校验面板
- [x] `WorldMapEditor` 接三视图与工具栏（插槽加在 `_buildHTML`，`world-map-editor.html` 无需改动）
- [x] 通行色叠加：`WorldRouteLayer.buildPreview` → 编辑器着色（缓存键 `revision`，无独立判定）
- [x] 路径虚线：`buildEdgeLines` + 选定目标后的单条路线（只读求路）
- [x] 不可达错误码：`noPath` / `unknownNode` / `passBlocked` / `blockedByDay` / `terrainBlocked`（+`hostileBlocked`）；预览拒绝并提示
- [x] `editor/WorldLogicEditor.test.js`：视图命中互斥、改已有写回、保存只提交 `worldLogic`（9 例）
- [x] `M4Content.test.js`：结构校验 + `combat` 必填键 + 旧档容错（4 例）
- [x] 验收：编辑器冒烟（10 节点渲染 / 三视图切换 / 逻辑视图压暗 / 无 pageerror）；改已有保存一致由单测覆盖；敌占关隘不可达提示与四色图例由单测覆盖
- [ ] 暂缓（等拍板）：加节点/连线/删除级联/自动抽取分层（auto 覆盖、manual 保留）

### C.1 别名 bug 复盘（4A 遗留，4B 修复）

> 2026-11-10 记录。`weight` / 边顶层 `crossingNodeId` 在 4A 的判定链路里**未被读取**。

| 项 | 内容 |
|---|---|
| 现象 | ①所有边权重被当作 1，最短路按「边数」而非「路程」选路；②桥/渡口/关隘的归属校验完全未生效——敌占关隘仍可通行、关隘封锁无效、`crossingNodeId` 指向的过河点被忽略。 |
| 根因 | 4A 的 `evaluateEdgePassability` 只读 `edge.conditions.crossingNodeId`，`shortestPath` 只读 `edge.cost`；而实际内容数据用别名 `weight` 与边顶层 `crossingNodeId`（4A 写内容时按旧稿字段落盘）。判定与内容 schema 两处口径不一致，且当时无内容级回归用例。 |
| 受影响内容 | `example/sanguo_zhangjiao/game.project.json` → `worldLogic.edges`：**11 条边全部用 `weight`**；`edge.bridge_s10`、`edge.pass_s03`、`edge.ferry_s07` 用边顶层 `crossingNodeId`。其余内容（M1/M2/M3 内容库）无引用。 |
| 修复 | 4B 引入唯一口径函数 `WorldRouteLayer.resolveEdgeCost`（`cost ?? weight ?? 1`）与 `resolveEdgeConditions`（`conditions ?? { ...边顶层 crossingNodeId }`），判定 / 最短路 / 校验 / 编辑器 / 预览全部改走这两个函数；`load` 原样保留扩展字段。 |
| 回归 | `WorldRouteLayer.test.js`（别名权重、顶层 crossingNodeId、敌占关隘不可达）、`M4Content.test.js`（内容结构校验）覆盖；4B 测试 43/43。 |

## D. 4C 遭遇四选 + 公式 + 关税（第 3 批）

- [x] `src/systems/world/EncounterResolver.js`：`detect` + `resolve`（公式 §7）；`rng` 注入；四选修正
- [x] 四选确认 UI（弹窗组件）：埋伏/绕道/战斗/撤退 + 置灰条件 + 超时撤退
- [x] `SceneArmyOrderFlow`：`pendingEncounter` 暂停/恢复、幂等、冷却
- [x] `PassTariffSystem.js`：进入节点计税、`supply.toll` 累计；日结入城
- [x] `CityWarSystem.prepareDraft` 调用点（城池/关隘战果）；`pass.captured`
- [x] 城池卡「攻击」别名 → `unit.order{attack, target:{cityId}}`
- [x] 测试：`EncounterResolver.test.js`、`PassTariffSystem.test.js`、场景集成脚本
- [x] 验收：撞敌弹四选且后果正确；关隘关税日结一次

### D.1 4C 可核对条目

#### A. 四选后果

| 选项 | 结算套 | 战略刻 | 路径 | 代价 / 修正 |
|---|---|---|---|---|
| 埋伏 `ambush` | §7 公式，攻方 ×`(1+ambushBonus)`；仅 `kind==='field'` 且敌方未锁定己方时可用 | 消耗 1 刻（本刻不再推进） | 不改路径 | 无额外代价；失败按野战溃败 |
| 战斗 `fight` | §7 公式（无埋伏加成） | 消耗 1 刻 | 不改路径 | 城池/关隘胜 → `pass.captured` + BattleResult；败 → 回退上一节点 |
| 绕道 `detour` | 不结算 | 不消耗 | `shortestPath(current→target, avoidEdgeIds:[遭遇边])`；无替代路 → 回退原路 | 无士气代价、无冷却 |
| 撤退 `retreat` | 不结算 | 消耗 1 刻 | 清 `route`，回退上一节点（`index-1`） | 士气 -`retreat.moraleCost`（默认 10）；该边/节点 4 刻冷却 |

#### B. 弹窗时机

- 探测器只判定：写 `order.pendingEncounter` 并让本刻 `continue`；**探测阶段不结算战果、不扣士气、不改路径**。
- 玩家可见（地图面板打开或同场景）→ `WorldMapPanel` 画四选确认框等点击。
- 不可见 → 按 `autoPolicy` 自动结算，`reason:'autoPolicy'`。
- 8000ms 未选择 → 自动撤退，`reason:'timeout'`。
- 重复确认 → `staleEncounter` 幂等返回，不二次结算。

#### C. 关税日结口径

- 经过关隘节点即计 `tax = floor(cargoValue × tollRate)`（同阵营免税），只累计 `supply.toll`，**不直接写城池资源**。
- 跨日 `settle(day)` 产 `transfers[]` 并清零 `supply.toll`；同 day 幂等（`alreadySettled`）。
- 场景层 `SceneArmyOrderFlow._applyTariffTransfers` 是唯一写 `blackboard.cityStates[].resources` 的点；
  与城池常规税收分开结算、分开事件（`pass.tariffCollected` / `pass.tariffSettled`）。
- 目的地无城池 → `pending` 保留，次日再结。

### D.2 M3 契约用例更新（4C 行为变更，已获批准 · 2026-11-11）

- 变更性质：**不是修 bug，是 4C 四选确认带来的有意行为变更**——遭遇命中不再"检测即结算"，
  而是先置 `order.pendingEncounter` 并发 `unit.encounterPending`，玩家四选确认后由
  `SceneArmyOrderFlow.decideEncounter → _applyEncounterOutcome` 发 `unit.encounterResolved`。
- 用例改动（仅这一条，未动其他断言）：`src/systems/ArmyOrderSystem.test.js` 原
  「遭遇：encounterDetector 命中只发一次 unit.encounterResolved」改为
  「命中只发一次 `unit.encounterPending`，结算事件由确认层发」：断言 pending 计数 = 1、
  `order.pendingEncounter` 保留命中内容、本层 `unit.encounterResolved` = 0。
- 「结算后 resolved 恰好一次」由 `SceneArmyOrderFlow.encounter.test.js` 的
  「decideEncounter 幂等」用例覆盖（断言 `encounterResolvedAt` 与事件各一次）。
- 波及面排查：全仓无其他生产代码监听 `unit.encounterResolved`（仅 SceneArmyOrderFlow 发、
  上述两处测试断言），故无其他测试/编排需要跟着改；外部编排若监听该事件，时序由
  「命中即刻」变为「玩家确认结算后」。
- 结果：`ArmyOrderSystem.test.js` 22/22 通过。

### D.3 4D 差异面板完成记录（2026-11-11，未提交）

本轮范围 = Q1 选 C：只做「4C 收口 + 差异面板」，地图抽取器排下一批。

- 新增文件（2 个，1 个实现 + 1 个测试）：
  - `src/core/world/WorldLogicDiff.js`：三类差异（autoOnly / manualOnly / changed）+ 四种动作
    （采纳自动 / 保留人工 / 忽略 / 去场景改）+ 单类全部采纳；节点按 id、边按端点匹配
    （双向边 from/to 方向归一），`name` 只展示不判定。
  - `src/core/world/WorldLogicDiff.test.js`（12 例）：三类计数 / changed 只列变化字段 /
    并排值 / 边端点匹配 / 忽略与保留隐藏 / 采纳 autoOnly 节点与边（缺端点拒绝）/
    采纳 changed / 采纳 manualOnly 级联删边 / 单类全部采纳 / 原对象不被修改。
- 增量文件（3 个）：
  - `editor/WorldLogicEditor.js`：`setAutoLayer/rebuildAutoLayer/getDiff/toggleDiff/adoptDiffEntry/
    keepManualDiff/ignoreDiff/adoptAllDiff/jumpToScene`；`_touch()` 后重算差异并重绘；
    工具栏「差异面板（N）」；存档仍只取人工层（`getLogic` 永不并入 autoLayer）。
  - `editor/WorldLogicEditor.test.js`（+9 → 18 例）：三类展示与并排值 / 采纳写入并触发 onChange /
    边缺端点拒绝 / 单类全部采纳 / manualOnly 级联删边 / 保留忽略不改数据 /
    重抽摘要（新增 · 消失 · 人工层不变 · revision 4）/ 去场景 / 保存只写人工层。
  - `editor/WorldMapEditor.js`：`.wme-logic-diff` 挂点 + `_provideAutoLayer()`（抽取器注入点，
    暂为 `this._autoLayer || null`）+ `_resolveNodeScene()` + `_openSceneEditor()`
    （`scene-workflow.html?gameId=&sceneId=`）。
- 行为口径（按分层语义定稿）：
  - 自动层不参与运行时判定，不可手改；人工层是唯一事实源；未确认自动结果一律不生效。
  - 「全部采纳」只处理单类；重抽只重建自动层、不动人工层，界面显示本次新增/消失/变化。
  - 忽略/保留为 session 级，重抽或重开清空；存档只写人工层。
  - `autoLayerProvider` 未注入时「重抽自动层」置灰并提示「抽取器下一批接入」。
- 回归：`editor/WorldLogicEditor.test.js src/core/world` → **5 文件 / 66 例全绿**；
  其中 4D 新增用例 12 + 9 = 21。
- 抽取器（auto 层生成）未开工，按 Q2 约束执行：地形推断 + 推断边一律进「待确认」，
  若地图缺少「道路/关隘标记」落点则停下上报，不硬凑。

### D.4 4C 修复的三个缺陷与影响面（静默失效可追溯）

| # | 缺陷 | 修复 | 影响面（谁会静默失效） |
|---|------|------|------------------------|
| 1 | `num(null)` 口径：空值未走 fallback，被 `Number(null)=0` 吃掉 | `EncounterResolver` / `PassTariffSystem` 的 `num()` 显式判 `null/undefined/''` 再回落 | **遭遇侧**：未配 `combat` 的工程——`engageRadius` 120→0（`max(1,0)=1px`，野遭遇几乎永不触发）、`decisionTimeoutMs` 8000→0（确认框 1s 就超时自动撤退）、`decisionHoldTicks` 1→0、`retreat.moraleCost` 10→0（撤退零士气代价）、`retreat.cooldownTicks` 4→0（冷却降为 1 刻）。**关税侧**：未配 `tariff.defaultRate`→0（过关**完全免税**）、未传 `cargoValue`→0（税额恒为 0）。本项目 4C 已把 `worldLogic.combat/tariff` 配全（game.project.json:789/838）故不受影响，但**旧工程、旧存档恢复路径、placement overrides 传 null 的场景**都会静默退化 |
| 2 | `PassTariffSystem.settle` 在遍历关隘时重复读取 pass 列表 | 循环前一次性取快照 | 一致性/性能：日结中途列表变化会导致同一关隘读两遍不同状态；关隘多时为 O(n²) 读取。无语义变更，但日结结果可能与快照口径不一致（用例「pass 列表只读取一次」覆盖） |
| 3 | `SceneArmyOrderFlow` 遭遇集成引用未定义的 `_armyEntities` | 补齐缓存字段（按阵营收集本刻军队实体） | 真实流程下遭遇探测抛错/恒空 → **4C 四选在实机不可达**（单测因注入 mock 未暴露）。属本批新代码自身缺陷，已随 4C 修复 |

### D.5 4E 地图抽取器：勘察结论（按 Q2 约束停下上报，2026-11-11）

- 范围：Q2 规则（城市取 cityStates 场景格中心 / 山地→关隘 / 河流→渡口 / POI 格网最短路 + MST 出边；
  推断边一律「待确认」；数据不足则停下上报）。
- 实证（当前工程 + 代码）：
  1. `src/core/WorldMapCell.js` 的 cell 只有 `terrain / sceneId / reserved`，**没有道路、关隘、渡口标记**；
     `road/pass/ferry/bridge` 只出现在人工层 `worldLogic`（10 节点 / 11 边）。
  2. 按地形硬推会误判：mainland 18 个锚定场景中 mountain 仅 `s_5_9`、yellowRiver 仅 `s_5_10`、
     forest 仅 `s_5_8`——硬推会把 S5-9 旅行场景变成关隘、S5-10 变成渡口，与剧情语义不符。
  3. 人工层坐标不对齐格中心（如 `pass.yique` y=7920 恰为格边界），说明人工图是自由摆放，
     **不能由格网反推**；`cityStates` 8 条与地图锚定场景也不能一一对应（部分城池无 mainland 锚点）。
  4. 边：没有「道路」落点，格网最短路只能穿任意地形，推出来与人工层 11 条边
     （含 `bridge/pass/ferry` 过河语义）无法对上，玩法上站不住。
- 结论：**不硬凑，抽取器推断逻辑暂不落地**，先补地图数据层。
- 待拍板的最小数据补充（建议）：
  - grid cell 可选 `road: true`（道路格）、`poi: 'pass' | 'ferry'`（关隘/渡口落点）。
  - 可选 `roadEdges: [[row,col],[row,col],…]` 显式道路连接（优先于邻接推断）。
  - 编辑器场景格属性加「道路格」勾选 + 「POI 类型」下拉（照 terrain 下拉同款交互），导出仍写 `worldMap.grid`。
  - 抽取器读取顺序：`cityStates` → city 节点（场景格中心）→ `cell.poi` → pass/ferry 节点 →
    `road/roadEdges` → 边；无道路标记则不出边。全部 `source:'auto'`，进差异面板「新增待确认」。
  - 验收口径：与人工层 10 节点/11 边对照，节点差 ≤ 2、边端点匹配 ≥ 80%、无凭空多出的关隘/渡口。

### D.6 基线校正执行记录（2026-11-11，提交 `b1f19dc8`）

- 已提交（非行为变更）：①`src/dev/javascript-audit-exceptions.json` 中 `src/systems/TriggerSystem.js`
  例外重批（1583→1651 行、contentHash 更新、date 2026-11-11）；②GOLDEN 快照刷新
  （`test/fixtures/gameEditorDataDrivenArchitecturePreservation.golden.json`）。
- GOLDEN 差异清单（逐条核对，仅两类已提交现实，无其他差异）：
  - `identity.sceneOrder` 新增 `s_5_8 / s_5_9 / s_5_10 / s_5_11`；
  - `scenarioTriggerIds` 新增上述 4 场景各 2 条 `travel_west/east`（共 8）；
  - S02 触发器改名（任务系统命名）4 旧名 → 5 新名：
    `trg_s02_zhangjiao_summons` → `trg_task.s02.summons_event_acceptSummonsInteract`、
    `trg_s02_travel_s09` → `...summons_event_travelToS09`、
    `trg_s02_village_beg` → `trg_task.s02.verdict_event_begChildrenEnter`、
    `trg_s02_scavenger_chief_encounter` → `...summons_event_scavengerEncounter`，
    另新增 `...summons_event_recruitInteract`。
- 验证：`test/...Preservation.property.test.js` **4/4 通过**（刷新前 1 失败，失败项仅上述差异）。
- **未解决（需拍板）**：审计例外清单实际有 28 条失效（不止 2 条）——TriggerSystem 已批，
  剩余 26 条历史失效 + `editor/WorldMapEditor.js`（本批 4B/4D 改动叠加）。
  `test/...BugCondition.property.test.js` 仍因这些例外失败（119 条 violations）。
  WorldMapEditor 条目**未**写入本次提交（其 hash 指向未提交的 M4 源码，提交会造成中间态不一致），
  建议 M4 源码提交后统一重批，或按当前 HEAD 内容一次性生成整表 lines/hash。

### D.7 第 2 步：地图格数据层执行记录（2026-11-11，提交 `9c40e7bf`）

**口径裁定（推导，无需再拍板）**

1. `cell.road: true` / `cell.poi: 'pass' | 'ferry'` 是**显式声明**，缺省即无道路、无落点——
   读取函数对 `null` / 字符串格 / 缺字段一律返回缺省，旧地图与旧存档加载路径零改动。
2. `region.roadEdges` 用**格对** `[[row, col], [row, col]]` 表达跨格连接：连接是格与格之间的关系，
   放 region 级才不会让同一段路在两端各写一半；cell 只声明本格属性（地形/场景/道路/落点）。
3. POI 只收 `pass`（关隘）/ `ferry`（渡口）。`bridge` 不单列为 POI——桥要么与城市同格，
   要么由 `road` 格 + 两端边表达；`junction` 是人工层独有的汇合点语义，不进 POI 枚举。
4. 编辑器只做地形格属性的两条控件（道路格勾选 / POI 下拉），`sceneGrid` 不承载道路语义
   （写回时剥离 `road/poi`）；改地形不清除既有 `road/poi`。

**内容同步（示例项目 mainland region）**

- `roadEdges` 10 条（人工层 11 条边换算）：`(6,12)-(6,13)`、`(6,12)-(11,12)`、`(11,12)-(15,12)`、
  `(6,13)-(11,13)`、`(11,13)-(11,12)`、`(11,13)-(15,13)`、`(15,12)-(15,13)`、`(15,13)-(16,13)`、
  `(16,13)-(17,14)`、`(17,14)-(17,15)`。
- 道路格 9 个：`(6,12) (6,13) (11,12) (11,13) (15,12) (15,13) (16,13) (17,14) (17,15)`；
  POI 2 个：`(11,12)=pass`（pass.yique）、`(17,14)=ferry`（ferry.changshe）。

**已知差距（留给第 3 步验收对照，不算数据缺陷）**

| 人工层 | 地图格表现 | 抽取器可读性 |
|--------|-----------|--------------|
| `bridge.yingchuan` | 与 `city.s10` 同格 `(6,13)` | 无法产出独立节点；`edge.s09_bridge` 会退化为 `s09→s10`，`edge.bridge_s10` 退化为同格无边 |
| `junction.crossroads` | 格 `(11,13)` 只有 `road`，无 POI 类型 | 无法产出节点；与该格相关的 3 条边端点无处落名 |
| `pass.yique` / `ferry.changshe` | POI 可读 | 节点 id 按格派生（`poi.pass@11,12` 形式），与人工 `pass.yique` 命名不同→算端点匹配不算节点同名 |

**验证**

- 新增 `src/core/WorldMapCell.test.js` **7 例**（POI 枚举/缺省读取/道路判定/roadEdges 归一化与去重/旧格兼容）。
- 新增 `editor/WorldMapEditor.test.js` **6 例**（道路勾选写回与清理、POI 写回与清理、改地形保留、
  sceneGrid 剥离、非法 POI 不写入、控件还原）。
- 回归：GOLDEN `4/4`、`ProjectWorldIndex` `9/9`、`WorldMapPanel` `9/9` 全绿。

### D.8 第 3 步：抽取器执行记录（2026-11-11，提交 `49564445`）

**读取顺序（照用户定稿，一步不跳）**

```
cityStates → city 节点 → cell.poi → 关隘/渡口 → road/roadEdges → 边
```

- 城市只认 `variables.cityStates`：`city.s09_xxx` 取场景 token → 找 `cell.sceneId === 'S09'` 的格 →
  节点 id `city.s09`（与人工层同构）、位置取格中心、`ref.id` 指回 cityState。
- 关隘/渡口只认 `cell.poi`：节点 id `<poi>.<regionId>.r<row>c<col>`、位置取格**上边中点**。
- 边只认 `roadEdges`：**无道路声明不出边**；端点所在格必须有城市/关隘/渡口/岔路可落名，否则记
  `roadEdgeEndpointUnresolved` 且不出边。

**推导结论（已定原则推导，写在这里备案）**

1. **岔路节点是结构推导**：`roadEdges` 度数 ≥3 且该格既无城市也无 POI 时补 `junction` 节点，
   落点取格**左上角**（道路分岔在格线上，与人工层 `junction.crossroads` 的 (16640,7920) 一致）。
   不按地形猜、不按名称猜；`deriveJunctions:false` 可关闭用于对照。
   若不推导：自动层少 1 节点但端点匹配掉到 77.3%（<80%）——两者都写进报告，不隐藏。
2. 城市/关隘/渡口落点不是"随手取中心"：城市=格中心、关隘渡口=格上边中点，是对齐人工层既有数据的
   位置约定（否则差异面板会把同一节点报成"新增+缺失"两条）。
3. 边 `mode`：端点含渡口 → `ferry`，含桥 → `bridge`，其余 `road`；跨界边在 `conditions.crossingNodeId`
   写关节点 id（无向边两端都写，与人工层单侧写法不同，属待确认差异）。`cost` 取两端节点欧氏距离取整。
4. 格坐标是 **region 局部坐标**：索引键带 region 前缀，`roadEdges` 只在所属 region 内解析端点，
   多 region（mainland 20×20 + s01-shelter 1×1）互不串号。
5. `revision`：编辑器每次载入工程重抽并 +1，供差异面板缓存失效用。

**与人工层对照（示例项目：人工 10 节点 / 11 边）**

| 指标 | 结果 | 判定 |
|------|------|------|
| 节点 | 自动 11（8 城 + 关隘 + 渡口 + 岔路）；多出 `city.s11`/`city.s12`（人工未建） | 差 2 ≤ 2 ✅ |
| 人工独有节点 | `bridge.yingchuan`（与 `city.s10` 同格，无法独立成节点） | 1 |
| 边端点匹配 | 20/22 = **90.9%**（人工 11 边逐端点比对） | ≥80% ✅ |
| 整边覆盖 | 9/11 = **81.8%** | ≥80% ✅ |
| 凭空多出的关隘/渡口 | 0（自动 1 pass + 1 ferry，位置与人工层 1px 内一致） | ✅ |
| gaps | 空（无解析失败的 roadEdges） | ✅ |

- `edge.s09_bridge`(s09→bridge) 与 `edge.bridge_s10`(bridge→s10) 在自动层合并为 `s09→s10` 一条，
  这是上表「人工独有 bridge」的直接后果，不是丢边。
- 全部节点/边 `source:'auto'`，运行时（`WorldRouteLayer`/`ArmyOrderSystem`）只读人工层，自动层不参与判定。

**验证**：`WorldMapExtractor.test.js` **12 例**（8 例合成数据 + 4 例实数据验收）；editor + world core 回归 91 例全绿。

## E. 收尾

- [ ] 全量回归，存量失败 6 文件不新增
- [ ] 单独提交，只含本批文件（不带 `vitest.config.js`）
- [ ] 回报 D/N 最终取值 + 理由 + 推翻代价

## 进度锚点（2026-11-11 · 抽取器完成，提交 `49564445`）

- 已提交：M1 `2181ce9a`、M2 `c0bfd1b`、3A `8cce967`、3B `0d81ad5`、3D `dde1105`（已推 gitee）；
  M4 运行时 4A+4C `cf7fa9ef`、M4 编辑器 4B+4D `4a00f639`、M1 锚点 docs `11f8692e`、
  M4 文档 `7de3b96e`、基线校正 `b1f19dc8`、地图格数据层 `9c40e7bf`、抽取器 `49564445`。
- 工作区 `M vitest.config.js` 与 `M editor/EditorShared.js`、`M editor/SceneEditorEventFilter.js`、
  若干 `.trae/specs` 文档为并行会话改动，禁提交。
- **M4 当前进度 = 4A+4B+4C+4D+4E（数据层+抽取器）已提交；下一步 = 第 4 步例外清单整表重批。**
- 第 4 步执行口径：工作区干净时用当时 HEAD 内容一次性重批 `src/dev/javascript-audit-exceptions.json`
  的 `lines/contentHash`，提交说明写「基线校正，非行为变更」；`editor/WorldMapEditor.js` 单列一条
  （现约 1985 行）并给拆分建议；重批后 `BugCondition` 应转绿，不绿就列剩余 violations，不算通过。
- 4C 新增文件：`src/systems/world/EncounterResolver.js`（+test 21）、
  `src/systems/world/PassTariffSystem.js`（+test 10）、
  `src/core/scene/SceneArmyOrderFlow.encounter.test.js`（12）。
- 4C 增量文件：`SceneArmyOrderFlow`（遭遇暂停/结算/关税日结/`_armyEntities` 修复）、
  `SceneGameplaySystemAssembler`（Resolver/Tariff/applyBattleResult/`world.encounter.decide`/`onEnterNode`）、
  `WorldMapPanel`（四选模态，+4 → 9）、`ScenePanelLayout`（pendingEncounter provider / 城池攻击别名）、
  `WorldRouteLayer`（`target.cityId`）、`WorldMarchExecutor`（`onEnterNode`）、
  `CanonicalSchemas`（`encounterCooldown`）、`M4Content.test.js`（+2 → 6）、
  `game.project.json`（`worldLogic.combat` §7 全量键 / `tariff` / `pass.yique` 税率）。
- 4C 修复缺陷：`PassTariffSystem.num(null)` 被当 0 导致缺省税率不生效、`settle` 重复读列表、
  `EncounterResolver.num` 同口径、`SceneArmyOrderFlow._armyEntities` 引用未定义的 `sceneEntities`。
- 回归：`src/systems/world src/core/scene src/ui src/core/world` → **30 文件 / 321 例全绿**；
  4C 新增用例合计 21+10+12+4+2 = 49。
- M3 契约已更新（用户批准，非修 bug）：`ArmyOrderSystem.test.js` 改断言 pending 一次 + 本层 resolved 0，
  **22/22 通过**（见 §D.2）。
- 4D 已完成：`WorldLogicDiff`（三类差异 + 四种动作 + 单类全部采纳，test 12）与
  `WorldLogicEditor` 差异面板（auto 层注入式，test +9）；存档只写人工层（见 §D.3）。
- 4D 回归：`editor/WorldLogicEditor.test.js src/core/world` → 5 文件 / 66 例全绿；
  `editor/` 目录 → 28 文件 / 237 例全绿。
- 存量基线（与本批无关）：`test/gameEditorDataDrivenArchitectureBugCondition.property.test.js`
  （审计例外表未重批）→ 第 4 步整表重批后应转绿。

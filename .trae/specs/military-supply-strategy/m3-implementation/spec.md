# M3 实施规格 · 计划稿（随行小队 + 武装单位/指令 + 存档与倒地掉落）

> 状态：**计划稿，待确认；未写代码** · 2026-11-10
> 上游：[tasks.md](../tasks.md) M3 行（模块 3）· [03-army-squads.md](../03-army-squads.md) v2.3 · [decisions.md](../decisions.md) P1/P1b/P1e/P8/P12/P23
> 前置：M1（生产/建造）、M2（配给/押运，`c0bfd1b`）已落地。M1 `ProductionSystem` 快照接通 checkpoint 的遗留**不在本里程碑**。

## 1. M3 对应文档与边界

**M3 = 模块 3（[03-army-squads.md]）**，按 master `tasks.md` 的 M3 行覆盖 3A/3B/3C/3D 四项交付。

本计划**建议的里程碑切口**：3A + 3B + 3D（存档/掉落），**3C（关卡/军营）顺延**，押运队载具物理生成以「薄适配」并入 3A 验收。理由见 §10 D1。

| 范围项 | M3 包含 | 不包含（归属） |
|---|---|---|
| 护卫 AI | 3A 随行小队 escort：跟随网格、警戒索敌、护主、五档（escort/assault/hold/**charge**/retreat）、士气、阵亡补位（默认 8s 从兵源池跑回） | 大地图行军/通路寻路（M4）；伏击掷骰与损失表（M2 已实现）；伏击战斗演出（M6）；载具驾驶 AI（现有 VehicleSystem） |
| 载具物理生成 | `convoy.assemble` 时按 `vehicles` 定义/marker 生成载具实体、绑定货舱、登记护卫实体（`SquadMemberComponent` + 随行小队） | 载具自驾寻路/避障（M4）；载具战斗与席位切换（M6）；编辑器载具表单（后置） |
| 3A 随行小队 | 容量计算、五档、10×10 HUD 网格 + 1-5 键、士气账、阵亡补位、受击/阵亡事件 | 军团编组选择条（既有 `ArmyCommandHUD`，不改）；招募入口（M7） |
| 3B 武装单位 | `armyStates` 四 kind（army/city/pass/camp）、五指令表、500ms 战略刻、自动执行（委托既有 CityWar/ArmyCommand）、战前部署 commit/temp + 锁、将令 | 大地图通路与城池围攻流程本身（M4/M6）；支援身份与战报（M6）；3C 关卡封锁/军营驻扎 |
| 3C 关卡/军营 | **不做，顺延** | 关卡封锁（M4 §4B）、军营驻扎/招募三路径/兵力日结（M7） |
| 3D 存档/掉落 | `armyStates`/`companionSquad` 入档与 checkpoint 还原；玩家倒地掉 1~3 件 + 复原 + 夺回 + NPC 拾取 | S02 剧情命令迁移（与 3C 一起顺延）；战败俘虏/斩首（M6）；墓园「寻回失物」（M7） |

**为什么 3C 顺延**：关卡封锁与军营驻扎强依赖 M4 的路口/通路与 M7 的招募日结，且 master M3 的验收行本就不含 3C；提前做会造出无场景可验的空壳。

## 2. 现状勘察（复用 vs 新建）

**已存在，直接复用**
- `ArmyCommandSystem`：`STANCE_PROFILES`（escort/assault/hold/advance/retreat/rescue/flee）、阵型偏移、命令倒计时、`applyStance/orderMove`；`SceneArmyCommandFlow.syncUnits` 扫描 `SquadMemberComponent` 注册编组。
- `SquadMemberComponent{armyId,squadId,formationIndex}`、`CommandStateComponent{stance,post,goal,carryState}`。
- `PlacementSpawner._expandArmyPlacement`（army → soldier 展开、`formationIndex` 注入）。
- `SceneVehicleRuntime`（vehicles 定义 + marker 生成，`gameplay.vehicles`）。
- `BattleSystem`：`BattleState{idle,awaitingMode,active,resolved}`、`BattleMode{observe,intervene}`（**无部署阶段字段**）。
- `library.json.ranks` 21 档（0~100，M0 落地）、`heroes` 14 个均含 `stats.command`/`rankId`（M0）。
- `ArmyCommandHUD`、`InventoryTransactionService`、`CombatSystem.generateLoot/onLootDrop`。

**不存在，需要新建**
- `CompanionService`/`CompanionGridHud`/`companionSquad` 状态、`armyStates`、`armyOrders`/`companionRule` 配置、部署/将令、玩家倒地掉落、NPC 拾取 AI。
- 缺口：`CommandStateComponent.ARMY_STANCES` 只有 6 值且**不含 escort/charge**（`SQUAD_PRESET_OPTIONS` 里却有 escort）——新组件按 escort 构造会静默落回 hold，3A 必须修。

## 3. 数据模型（单一事实源）

| 事实 | 落点 | 说明 |
|---|---|---|
| 随行小队 | `storyState.companionSquad`（新键） | `{unitIds, stance, morale, moraleLedger{lastBattleId,lastVictoryDay,lastRestDay,lastDailyDay}, armyPool{troops,cap,replenishFrom}, playerRank}`，走现有 storyState 入档 |
| 玩家官职 | `storyState.playerRank`（新） | 初始 `null` → 白身 `rank.wusheng`；容量 `floor((stats.command + rank.value)/2)`（P1 C1） |
| 武装单位状态 | `blackboard.armyStates`（新） | 字段对齐 03 §3.1：`id/kind/factionId/sceneId/position/roster{unitIds,dead}/commanderHeroId/formationId/deployment{roster,formationId,commanderSlot,deputySlots,lockedBattleId}/order{type,target,issuedDay,state,progress}/morale/supply` |
| 指令表/随行规则 | `game.project.json` | `armyOrders{tickMs:500,tacticalRetreatMorale:3,orders[5]}`、`companionRule{initialRankId:null,reinforceDelaySec:8,chargeDurationSec:4,grid:{cols:10,rows:10},capacity:{commandWeight:.5,rankWeight:.5},morale{...}}` |
| 运行时快照契约 | `CanonicalSchemas` | 新增 `ARMY_STATE_SCHEMA`、`COMPANION_SQUAD_SCHEMA`（只用于快照/读档校验，不进 library registry）；`GAME_PROJECT_SCHEMA` 加 `armyOrders`、`companionRule`（OBJECT） |
| 注册键 | 无新增 | `armies`/`ranks`/`vehicles` 均已在；编制与官职沿用 library |

> **文档偏差记录**：03 §3.1 把 `ranks` 写在 `game.project.json`，但 M0 已落地在 `library.json.ranks` 且 `RANK_SCHEMA` 挂在 library 上。本计划沿用 **library.***（不迁移、不双读），03 文档该处视为过期表述。

## 4. 新增与改动文件

**新增**

| 文件 | 职责 |
|---|---|
| `src/systems/CompanionSquadSystem.js` | 容量/五档/士气账/补位窗口/charge 4s→assault/快照；无场景依赖，只吃注入适配器 |
| `src/systems/ArmyOrderSystem.js` | `armyStates`、五指令表、500ms 战略刻、自动执行委托、部署 commit/temp + 锁、将令身份门控、快照 |
| `src/systems/DownedDropService.js` | 玩家倒地掉 1~3 件（`rng` 可注入）、已穿戴 excl、`cause:'story'` 豁免、`ownerId` + 2 天时限、夺回入包 |
| `src/systems/ai/LootPickupBehavior.js` | NPC 拾取地面掉落（独立 behavior，不改进 `AISystem` 主循环） |
| `src/core/scene/SceneCompanionSquadFlow.js` | 随行实体登记/补位生成/受击阵亡回报/HUD 与 1-5 键/escort 跟随 |
| `src/core/scene/SceneArmyOrderFlow.js` | `armyStates` 同步、战略刻驱动、遭遇/抵达委托、部署与将令命令桥 |
| `src/ui/CompanionGridHud.js` | 10×10 网格 + 五档行 + 在役/阵亡/受伤状态（纯布局计算 + Canvas 绘制） |
| 测试 ×5 + `src/core/M3Content.test.js` | 见 §8 |

**改动**

| 文件 | 改动 |
|---|---|
| `src/ecs/components/CommandStateComponent.js` | `ARMY_STANCES` 补 `escort`/`charge`（修复静默回落 hold） |
| `src/systems/ArmyCommandSystem.js` | 新增 `charge` 档参数（移动拉满、不自动脱战，脱战由随行系统 4s 改写）；导出阵型偏移算法供 10×10 复用；`SQUAD_PRESET_OPTIONS` 保持不变 |
| `src/core/scene/SceneGameplaySystemAssembler.js` | 注册 `gameplay.companion`(509)、`gameplay.armyOrder`(510) + 命令 + fields/dispose；`gameplay.armyStrategic` 快照 provider 为**可选** |
| `example/sanguo_zhangjiao/systems/SanguoGameLoaderCoordinator.js` | 注入 rank/hero/morale/army/battlePhase/vehicle/entityFactory 适配器（照 M2 写法） |
| `example/sanguo_zhangjiao/game.project.json` | `armyOrders`、`companionRule` |
| `src/data/schema/CanonicalSchemas.js` | 两个状态 schema + `GAME_PROJECT_SCHEMA` 两块 |
| `src/systems/ConvoySystem.js` / `src/core/scene/SceneVehicleRuntime.js` | `convoy.assemble` 增**可选** `vehicleDefinitionId/position`，生成载具与护卫并回写；载具落点必须过 §6.1 校验，非法/找不到可站立点返回 `vehicleSpawnBlocked`；缺省行为逐字不变（M2 测试回归） |
| `src/systems/CombatSystem.js` | 仅一处钩子：玩家 HP 归零/倒地入口调用 `downedDropService.dropAll({cause:'combat'})`（若已有倒地流程则接在现有节点） |

## 5. 命令 / 事件 / 触发器

**命令**（全部经 `SceneGameplaySystemAssembler` 注册，`operationId` 幂等）

| 命令 | 语义 |
|---|---|
| `companion.assign` / `companion.stance` / `companion.dismiss` | 编入/切档/解散（5 档；士气 <10 时锁 hold 并拒 charge） |
| `unit.order` / `unit.order.cancel` / `unit.setFormation` | 五指令：`attack`（整队行军 + 委托 CityWar）、`defend`（驻守）、`move`、`transport`（→ M2 `convoy.load`+`dispatch`）、`camp`（→ 既有 construction camp） |
| `army.deploy.commit` / `army.deploy.temp` / `battle.deploy.lock` | 战前部署；锁后 deploy.commit 返回 `DEPLOYMENT_LOCKED` |
| `unit.battleOrder` | 将令：仅 `takeover` 身份可下（`_resolveBattleIdentity` 单点解析，M6 support 扩展点见 §10 D4），只写战斗指令、**不写** `unit.order` |
| `army.form` / `army.disband` | 军团组装/解散（`armyStates` 生命周期） |
| `inventory.dropAll` | 倒地掉落（`cause:'combat'` 掉 1~3 件；`'story'` 豁免） |

**事件**：`companion.stanceChanged`、`companion.memberDowned`、`companion.reinforced`、`unit.orderIssued/Completed/Failed`、`army.deployLocked`、`army.battleOrderIssued`、`player.downedDropped`、`npc.lootPicked`、`player.lootRecovered`。全部走 `publishApplicationEvent`，直通 `triggerSystem.fireCoordinated` + `consumeTaskEvent`（M1 已验证无白名单，**不改 TriggerSystem**）。

**任务目标**：**不新增**（03 §7.3：首版走 `custom.event`）；M2 的 `supply.*` 目标不受影响。

## 6. 与 M1 / M2 的接线点

- **M1**：不改任何 M1 文件；`camp` 指令复用既有建造命令。军营（3C）不做，故不与 M1 工位/仓储耦合。M1 的 ProductionSystem 快照遗留**不处理**。
- **M2**：
  - `unit.order{type:'transport'}` → `ArmyOrderSystem` 的 `transport` 适配器内调 `convoy.load` + `convoy.dispatch`，不改 `ConvoySystem` 状态机。
  - 押运队护卫 = `companion.assign({unitIds, sourceArmy:'convoy:<convoyId>'})` 的同一批士兵，共用 `SquadMemberComponent`/`CommandStateComponent`。
  - 载具 = `SceneVehicleRuntime` 既有 vehicles/marker 管线；`convoy.assemble` 新增可选参数后生成实体并回写 `vehicleEntityId/cargoId`，缺省调用零变化。
  - 库存事实源不新增第二份：城池库存仍归 M2 `cityStates`，兵源只存 `companionSquad.armyPool.troops`。

### 6.1 载具生成落点校验（D3 补充，2026-11-10）

`convoy.assemble` 生成载具时**不能只信 marker 落点**，必须复用现有地形可站立/碰撞检测：

1. 候选点最多 3 个：`position`（调用方指定）> marker 落点 > 玩家/护卫集合点。
2. 对每个候选点调用场景侧注入的 `resolveSpawnPosition(candidate, radius)`（薄适配层，内部复用
   `SceneTerrainBinding.checkTerrainCollision` / walkable shape 判定；与跳跃落点修复同源，
   避免第二套地形判定）。
3. 判定语义：候选点不在阻挡 shape 内且（落在 walkable shape 内或不在任何阻挡内）即可用；
   非法则在半径 48px 内环形采样 8 方向 × 2 圈，取最近可站立点；仍找不到就**失败返回**
   `{ok:false, code:'vehicleSpawnBlocked'}`，不创建载具实体、不推进订单、不消耗 operationId 结果。
4. 成功时把最终落点写入载具实体 `position` 与 convoy 快照的 `spawnPosition`，供读档/寻路使用。

> 该适配器由 `SanguoGameLoaderCoordinator` 注入（场景未接地形时回退为「原样返回候选点」，
> 保证纯逻辑测试与无地形场景零回归）。

## 7. 分批实施（三批，每批自带测试）

1. **3A**：`CommandStateComponent` 扩展 → `CompanionSquadSystem` → `SceneCompanionSquadFlow` + `CompanionGridHud` → 押运队薄适配（`convoy.assemble` 生成载具 + 护卫登记 + §6.1 落点校验）。验收：五档即时生效、容量公式、士气、补位、HUD、押运队端到端装配、非法落点有明确失败返回。
2. **3B**：`ArmyOrderSystem` + `SceneArmyOrderFlow` + 五指令 + 500ms 战略刻 + 部署锁 + 将令 + 事件。验收：场景内下令自动执行、锁后拒绝改部署、`takeover` 可将令且不改 `order`。
3. **3D**：存档（可选 provider）+ `DownedDropService` + `LootPickupBehavior` + 夺回。验收：读档还原、倒地掉 1~3 件、NPC 拾取、击杀夺回。

每批结束跑本批测试 + M1/M2 相关回归；三批合并后跑全量并与基线（存量 7 文件 12 例失败）对比，全绿后一次提交 M3。

## 8. 测试计划

| 测试 | 覆盖 |
|---|---|
| `CompanionSquadSystem.test.js` | 容量边界（0/0→0、20/0→10、50/40→45、100/100→100）；初始 10 人；超容拒绝；士气初值（从军镜像/征召 60）；阵亡 -2/人·封顶 -10·同 battleId 幂等；胜 +5；休整 +3·同日幂等；3 日未休整 -3/日；下限 5 锁 hold 拒 charge；<10 锁档；补位扣兵源 + 8s + 无兵源不补；charge 4s→assault；快照往返 |
| `ArmyOrderSystem.test.js` | 五指令映射（含 transport→convoy 适配器）；同单位单指令；500ms 刻 + 遭遇/抵达事件；取消；`deploy.commit` 非战斗可改 / 锁后 `DEPLOYMENT_LOCKED`；`deploy.temp` setAsDefault 回写；阵法校验；`battleOrder` 仅 takeover、不写 order；快照 |
| `DownedDropService.test.js` | 1~3 件（固定 rng）；已穿戴不掉；`story` 豁免；`ownerId` + 2 天过期；夺回扣减 + 入包；背包不足部分入包 |
| `LootPickupBehavior.test.js` | 索敌最近掉落、拾取上限、`_carriedLoot` 记录、被击杀时掉落返还 |
| `CompanionGridHud.test.js` | 10×10 槽位映射（纯布局函数，不依赖 jsdom）、在役/阵亡/受伤态、五档行、超容不渲染 |
| `M3Content.test.js` | `armyOrders` 五条 + `tacticalRetreatMorale=3` + `tickMs=500`；`companionRule` 初值；`ranks` 21 档且 `heroes.rankId` 可解析；`armyStates`/`companionSquad` schema 校验样例 |
| 场景集成（脚本/测试） | 随行五档生效与护主；`convoy.assemble` 生成载具+护卫→load→dispatch→unload；读档还原后再下令；S02 既有剧情链只跑回归不改动 |

## 9. 已知风险

1. **载具 × 地形**：`SceneVehicleRuntime` 只按 marker 落点生成，不参与寻路；M3 增加 §6.1 落点校验（非法即就近可站立点，仍失败则 `vehicleSpawnBlocked`），但**不做载具自驾**，桥面宽度/行驶卡地形风险留 M4。
2. **友军 AI 与战斗系统边界**：复用 `ArmyCommandSystem` 姿态机（S02 已验证士兵行为），不新写友军 AI；但需要确认友军索敌不会与敌方 AI 形成互相追击死循环（实现时用现有阵营判定 + 距离阈值，集成测试覆盖）。
3. **将令依赖 M6 身份**：`BattleSystem` 只有 `observe/intervene`，`support` 不存在。M3 按 `BattleMode` 推断 `takeover`，不提前实现 M6。
4. **部署锁没有宿主字段**：`BattleSystem` 无部署阶段状态，M3 的锁记录在 `ArmyOrderSystem`（keyed by battleId），M5/M6 再接战斗流程。
5. **存档 provider**：M2 已证旧档缺新 provider 会被 required 校验拒绝，`gameplay.armyStrategic` 必须可选（缺省空态）。
6. **性能**：100 实体 + 8s 补位跑入 + 500ms 战略刻；沿用 S13 100 实体基线，战略刻不复用帧循环。
7. **士气幂等**：`lastBattleId` + 日序双键，读档重放不重复结算。
8. **键位冲突**：随行 HUD 1-5 键与现有快捷栏/军团 HUD 需对齐（实现前先核对 `InputManager` 绑定）。
9. **M2 签名扩展**：`convoy.assemble` 新增可选参数必须保持缺省行为，回归 M2 全部 24 例。

## 10. 待拍板（请确认后我再写代码）

**D1 · M3 里程碑边界（最关键）**
- A（**建议**）：3A + 3B + 3D（存档/倒地掉落），3C 关卡/军营顺延 M4/M7 配对，押运队薄适配并入 3A。范围可验证、不造空壳。
- B：只做 3A（随行小队 + 押运队载具/护卫适配），3B/3D 拆成 M3B/M3C。里程碑最小、最快可玩。
- C：3A~3D 全量（含 3C 关卡/军营）。最完整，但 3C 在 M4/M7 之前无法实机验收。

**D2 · 官职/统率事实源**
- A（**建议**）：沿用 `library.json.ranks`（M0 已落地，单一事实源），03 §3.1 的 `game.project.json.ranks` 记为过期表述。
- B：迁移到 `game.project.json.ranks`（要动 M0 数据、schema 与测试，产生迁移成本）。
- C：双读兼容（不推荐，双源漂移）。

**D3 · 载具物理生成的归属**
- A（**建议**）：M3 内做薄适配——`convoy.assemble` 生成载具实体 + 货舱绑定 + 护卫登记，载具位置取 marker/指定点，仍不做自驾寻路。
- B：单列 M2.5 先补物理适配，M3 只做随行/武装单位。
- C：并入 M4 大地图一起做（押运队在 M3/M4 之间仍无实体，验收缺口）。

**D4 · 将令身份门控（M6 未落地）**
- A（**建议**）：按现有 `BattleMode` 推断——`intervene` = takeover（可将令），`observe` = 不可；`support` 留 M6 扩展。
- B：M3 先一律放行，M6 再补门控（会把 M6 的规则混进 M3）。
- C：将令整体延后到 M6（3B 缩水，master 验收「将令仅接管身份可下」不达成）。

> **已确认：D4 = A。实施时必须在 `ArmyOrderSystem.issueBattleOrder` 的身份解析处留显式 TODO（不可散落在命令层）。**
>
> - **判定点**：`ArmyOrderSystem._resolveBattleIdentity()`（唯一入口，命令层只透传 `battleId`）。
> - **当前行为（M3）**：`BattleMode.INTERVENE → 'takeover'`（可将令）；`BattleMode.OBSERVE → 'observe'`（拒 `commandNotAllowed`）；无 battle / 无 mode → `'unknown'`（拒）。仅做映射，不读 `BattleSystem` 内部字段以外的数据。
> - **M6 预期行为**：新增 `BattleMode.SUPPORT`（或 `BattleIdentity.support`）后，在同一函数内加 `support → 'support'` 分支，并把 `ARMY_BATTLE_ORDERS` 的允许集合从 `['takeover']` 改为 `['takeover','support']`（`support` 仅允许**折半执行**的将令，具体折半系数由 M6 的 `battleOrders.supportScale` 提供；M3 不预留该字段、不写死系数）。
> - **TODO 文本**：`// TODO(M6): 新增 support 身份时，在此加 support → 'support' 映射，并在 ARMY_BATTLE_ORDERS.support 允许集合内放宽（折半系数由 M6 配置提供）`。

## 12. 3D 可执行细化（2026-11-10，取代 §7 第 3 项的粗粒度描述）

> 3A（`8cce967`）/ 3B（`0d81ad5`）已交付；本节只写 3D 的精确落点、签名、验证与待拍板项。

### 12.1.1 新增文件

| 文件 | 公开 API | 职责 |
|---|---|---|
| `src/systems/DownedDropService.js` | `constructor({ inventoryTransactions, getInventory, getEquipment, createGroundDrop, removeGroundDrop, publishEvent, getDay, rng, config })`；`dropAll({ player, cause, position })`；`recover({ player, entries })`；`expire({ day, drops })` | 倒地抽取 1~3 件、从背包移除、生成带归属/时限的地面掉落；夺回部分入包；到期清理 |
| `src/systems/ai/LootPickupBehavior.js` | `constructor({ radius, maxCarried, now, publishEvent, isHostile })`；`update({ npcs, groundItems, removeGroundItem })`；`carriedLootOf(npc)` | 敌对 NPC 靠近玩家掉落→拾取→挂 `_carriedLoot` + 写回 `lootTable`（击杀经既有 `generateLoot` 返还） |
| `src/systems/DownedDropService.test.js` | — | 见 §8 3D 行 |
| `src/systems/ai/LootPickupBehavior.test.js` | — | 见 §8 3D 行 |
| `src/core/M3DownedDropIntegration.test.js` | — | 钩子→掉落→拾取→击杀返还 的端到端纯逻辑链（假场景，不依赖 jsdom） |

### 12.1.2 改动文件

| 文件 | 精确改动 |
|---|---|
| `src/systems/CombatSystem.js` | 新增 `setDownedDropCallback(cb)`；`handlePlayerDeath()` 内 `player.isDead = true` 之后、`onPlayerDeathCallback` 之前调用一次 `this.onDownedDrop?.({ player, deathEvent })`（`checkDeath` 的 `!isDying && !isDead` 保证每次倒地只进一次） |
| `src/core/scene/SceneGameplaySystemAssembler.js` | ①构造 `DownedDropService`（config 来自 `config.downedDrop`，`createGroundDrop` 复用 `itemRuntimeFactory.createGroundDropProjection` + `entityStore.add/addEquipmentItem`）；②`combatSystem.setDownedDropCallback` 接线（`cause`：`player.plotCause==='story' || deathEvent?.cause==='story'` → `'story'`，否则 `'combat'`）；③注册命令 `inventory.dropAll`；④注册 `gameplay.downedDrop`(511)/`gameplay.lootPickup`(512)：帧驱动到期清理 + NPC 拾取；⑤`armyOrderSystem` 存在时注册**可选** `gameplay.armyStrategic` 快照 provider（`required:false`，见 11.1.5） |
| `example/sanguo_zhangjiao/game.project.json` | 新增 `downedDrop: { minItems:1, maxItems:3, lossRatio:0, includeCurrency:false, plotExempt:true, ownerExpiryDays:2, npcPickupRadius:90 }` |
| `src/data/schema/CanonicalSchemas.js` | `GAME_PROJECT_SCHEMA` 增 `downedDrop`（OBJECT） |
| `src/core/M3Content.test.js` | 3D 内容校验：`downedDrop` 数值区间 + `lossRatio===0` |

### 12.1.3 掉落语义（与 P8 对齐）

1. 候选 = `InventoryComponent.slots` 非空条目，**排除**：`EquipmentComponent` 各槽位已穿戴的同一实例/定义、`currency.*`（`includeCurrency:false`）、任务/剧情标记物品（`item.questItem===true`）。
2. 抽取 = `count = clamp(minItems, maxItems, 候选数)`；**装备优先**（`weapon/armor/helmet/boots/gloves/accessory/equipment`），不足用材料补；`rng` 注入（测试固定序列），同一次倒地不重复抽同一槽位。
3. 损耗 = `lossRatio` 默认 0（P8 定稿：零损耗）；`>0` 时按数量比例向下取整，不足 1 视为整件不移除。
4. 移除 = `inventoryTransactions.commit({ type:'remove'|'batchRemove', inventory, entries })`；失败（`operationId` 重复/背包漂移）整次回滚，不产生掉落。
5. 地面投影 = 每件一个实体，`entityId='downed-drop-{playerId}-{day}-{seq}'`；位置 = 倒地位置 + 半径 12px 环形散布；`entity.ownerId=player.id`、`entity.downedDrop=true`、`entity.droppedAtDay=day`、`entity.expiresAtDay=day+ownerExpiryDays`。
6. 事件 = `player.downedDropped { playerId, cause, items:[{definitionId,quantity,entityId}] }`；`story` 豁免直接 `{ok:true, exempt:true}` 不发事件。
7. 到期 = 帧驱动（`getDay()` 变化时才扫描），`day > expiresAtDay` 的实体 `removeGroundDrop`；不依赖新系统。

### 12.1.4 NPC 拾取与击杀返还

- 目标筛选：`entity.downedDrop===true` 且 `entity.ownerId!==npc.id`；`isHostile(npc)`（`FactionRules` 敌对判定）；距离 ≤ `npcPickupRadius`；`entity.picked!==true`。
- 拾取：移出 `entityStore.equipmentItems`，条目并入 `npc._carriedLoot`（同 `definitionId` 合数量），并 upsert 到 `npc.lootTable`（`{ itemId, chance:1, minQuantity:qty, maxQuantity:qty }`）——击杀时由既有 `CombatSystem.generateLoot` 原样掉落，无需改 `generateLoot`。
- 上限：`maxCarried`（默认 6 条），达到后不再拾取。
- 事件：`npc.lootPicked { npcId, items }`。
- `player.lootRecovered`：仅当玩家通过 `item.pickup` 拾回 `downedDrop` 实体时发；由 `LootPickupBehavior` 不负责，装配器在 `inventory.dropAll` 的对称回调 `recover` 中发（显式命令触发），不监听底层 pickup 事件。

### 12.1.5 `gameplay.armyStrategic` 可选 provider

- 注册点：`SceneGameplaySystemAssembler`（`armyOrderSystem` 存在时），`scene.sceneRuntime?.registerSnapshotProvider?.('gameplay.armyStrategic', { snapshot, validate, restore, required:false })`。
- `snapshot()` = `{ schemaVersion:1, armyStates: armyOrderSystem.serialize(), companionSquad: companionSquadSystem?.serialize?.() ?? null }`。
- `validate()` = 空/旧档返回 `{ok:true}`；`restore()` = **仅当** `blackboard.get('armyStates')` 为空时写回（避免与 3B 的黑板路径双写打架，见待拍板 D2）。
- 未注册（无 `sceneRuntime` 或无 `armyOrderSystem`）时零副作用。

### 12.1.6 验证

- 单测：`DownedDropService.test.js`（1~3 件固定 rng / 装备优先 / 已穿戴不掉 / `story` 豁免 / `ownerId`+2 天 / `recover` 部分入包 / 移除失败回滚）；`LootPickupBehavior.test.js`（最近目标 / 半径 / 敌对过滤 / 上限 / `_carriedLoot` 合并 / `lootTable` upsert / 击杀 `generateLoot` 返还）。
- 集成：`M3DownedDropIntegration.test.js`（CombatSystem 假实体 → 掉落 → NPC 拾取 → 击杀返还）。
- 回归：`CombatSystem` 相关既有测试 + 3A/3B 全量（98 例）；不改 `vitest.config.js` 与测试环境声明。
- 实机验收（脚本，不新增运行时依赖）：S01 场景内让玩家被狼击杀 → 地面出现 1~3 件、NPC 拾取、击杀 NPC 返还；S02 剧情昏倒不掉落；读档后 `armyStates` 仍在、可继续下令。

### 12.1.7 待拍板（3D 开工前需确认）

| # | 问题 | 建议 | 备选 |
|---|---|---|---|
| D5 | 掉落触发点：`CombatSystem.handlePlayerDeath`（唯一战斗死亡入口） vs `PlayerDefeatService._resolveNormalDeath`（该文件注释写明"死亡不掉落，已按产品决策移除"） | **A：CombatSystem 钩子**，`PlayerDefeatService` 不动；`story` 由 `plotCause/deathEvent.cause` 豁免 | B：改 `PlayerDefeatService`（要推翻其既有注释与 `drop:null` 断言，影响面更大） |
| D6 | `gameplay.armyStrategic` 与 3B `blackboard.armyStates` 的关系 | **A：可选补偿**——provider 只在黑板为空时 restore，平时以黑板为准（零双写） | B：provider 为唯一事实源，删除黑板路径（推翻 3B 已验证行为）；C：不注册 provider（记录为文档偏差） |
| D7 | NPC 拾取范围 | **A：只拾玩家倒地掉落（`downedDrop`）**，不动既有怪物战利品 | B：任何地面掉落都拾（会改变现有拾取体验与测试） |
| D8 | 2 天时限的推进口径 | **A：`storyState.currentDay` 日界变化时清理**（与 M2 休整/日结同源） | B：实时毫秒计时（与"游戏日"语义不符） |

> 若 D5～D8 全部取建议值，按本规格直接实施；任一改选需回写本节后再动代码。

## 11. 明确不做

- 3C 关卡封锁/军营驻扎/招募三路径/兵力日结（顺延）。
- S02 剧情命令迁移（保留 legacy，行为零回归；与 3C 同批）。
- 大地图通路、城池围攻流程、伏击战斗演出、战败俘虏/斩首、墓园寻回、编辑器表单、任务目标类型新增。
- `vitest.config.js` 与测试环境声明（并行优化中，不碰）。
- M1 `ProductionSystem` 快照接 checkpoint（单独排期）。

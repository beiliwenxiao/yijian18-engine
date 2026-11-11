# S02 任务链基于新军团体系的改造方案

> 状态：设计稿（只读分析产物，未改动任何代码/数据）· 2026-11-09
> 归属：[军需—配给—押运—军团体系总纲](spec.md)
> 对象：`task.s02.summons`（现 22 步）+ `triggers.json` 已收编的 8 个剧情触发器
> 前置阅读：03 军团与小队 / 04 大地图 / 02 配给与押运 / 09 粮草后勤 / 08 教程
> **v2 修订（2026-11-09 用户裁定）**：征兵 5 次→1 次；举事后村落转军营（六类标准建筑）；
> 粮草充足不构成压力（删后勤危机段）；确认两种介入语义（影响 `army.possess` 结论）。
> **v3 修订（2026-11-09 用户裁定）**：主将阵亡不判负（士兵继续战斗）；主动退出不判负，改为主将
> 撤离、退回最近的己方军营、军团士气下降、剩余部队继续作战——「不可退出，退出即军团战败」作废。
> **v4 修订（2026-11-11 用户裁定）**：退出后撤往目标补边界——**战场即军营时退最近的另一座
> 己方军营或城镇**（细则见 06 §5.6）；「支援」形态 S02 不启用、适用范围 S03+（§6.1 定稿）。

---

## 0. 结论摘要（四句话）

1. **S02 不该"重写成军团关"，而该"把现有的剧情专用军团命令换成体系命令"**——03 §2 已明写
   「S02 剧情命令（`army.march`/`army.camp`）就是层级一的原型」，03 §9-3D 也点名
   「S02 命令迁移到 `unit.order`，**剧情链行为不变**」。所以 22 步的主体结构保留，替换的是
   命令入口与数据来源。
2. **征兵一次成军，举事把村落转成军营**——黄巾教徒（布道招众的产物）经一次征兵转化为黄巾军；
   举事是独立的剧情节点，触发村落→军营的分组切换与六类标准建筑落成，不再用"5 次交互 +10"的
   渐进计数来表达募兵。
3. **粮草在 S02 不构成压力，不做后勤任务段**——粮耗按游戏内每日结算且极慢，S02 的粮草充足；
   只有"粮仓被烧"这类事件才可能造成影响（可留作可选支线，不进主线）。军队被打散也是玩家可
   接受的失败结局，因此**不挂 `noDesertion` 白名单**、不做"断粮二选一"。
4. **`army.possess` 不是"体系无等价"，而是"远程接管的剧情化入口"**——玩家操作张角等价于在
   大地图按下「接管」，本体原地待命、以主将身份进入战场。**主将阵亡不判负**（士兵继续作战）；
   **主动退出也不判负**：主将撤离并退回最近的己方军营，军团士气下降，剩余部队继续作战。
   迁移时保留 operation 名（`army.possess` 为兼容旧触发器与旧剧本的数据键，不改名），内部转发到新的接管命令 `unit.joinBattle{identity:'takeover', mode:'remote'}`。

### 前置校准：能力落地状态（决定"能直接用"还是"预留"）

| 能力 | 代码现状 | 本方案里怎么标 |
|---|---|---|
| `ArmyCommandSystem`（编组/姿态/阵型/建造/搬运） | **已有**（`ARMY_CONSTRUCTION_DEFS` 4 项，`ArmyCommandSystem.js:103-108`） | 现阶段可用的全部底座 |
| `army.march` / `army.camp` / `army.possess(.release)` / `army.rescue.*` | **已有**（SanguoDomainCommandFacade + S02ArmyRescueFlow） | 现阶段主链就用它；新体系落地后转 `unit.order` |
| `waveCleared` / `armyCampLaid` / `playerSpecialFaint` | **已有**（SanguoPlacementCoordinator / S02ArmyRescueFlow） | 保留 |
| `construction.definitions` + `construction.sites` | **已有**（`game.project.json:302`，玩家可建造物：小庇护所/营地火堆/拒马…） | 军营建筑的落点 |
| `BuildingComponent` + `BuildingType`（wall/gate/tower/barracks/generic） + `EntityFactory.createBuilding` | **已有**（`src/ecs/components/BuildingComponent.js:27`） | 栅栏/大门/兵营的实体级表达 |
| `spawnPlacements` / `despawnPlacements`（group 选择器） | **已有** | 举事时村落↔军营切换的执行手段 |
| `unit.order` / `armyStates` / `StrategicAdvanceSystem` | **未实现**（M3/M4） | 目标态命令 |
| `army.recruit` + 招募三路径 | **未实现**（M7 7B） | 目标态命令 |
| `supply.*` / `convoy.*` | **未实现**（M2） | **S02 主线不再依赖**（见 §7） |
| `FoodLedgerSystem` / `army.forage` / `army.regroup` | **未实现**（M9） | 目标态命令（S02 只做背景，不做任务段） |

> 每条处置都标 **[现]** = 现在就能落、**[M3/M7/M9]** = 等对应模块。**任何一步都不允许
> 依赖未实现能力而卡住主线**——这是本方案的分期红线。

---

## 1. 现有 22 步逐条处置

| # | 步骤 id | 现行为 | 处置 | 理由 |
|---|---|---|---|---|
| 1 | `spawnInitial` | `sceneEnter` → 3×`spawnPlacements` + showTip 荒村惨状 | **保留 + 扩组** | 初始仍是破旧村落；为举事后的切换预置 `S02-village-*` 分组 |
| 2 | `porridge` | 施粥目标（`story.s02.porridge.laid`） | **保留** | 主角前置剧情，与军团无关 |
| 3 | `acceptSummonsInteract` | `interact` + `if story.s02Rescued` → 张角召见对话 | **保留** | 对话入口；binding 契约不动 |
| 4 | `acceptSummons` | `dialogueEnd` → 提交 `story.s02.summons.accept` | **保留** | 任务接取事实 |
| 5 | `recruitInteract` | `interact`（cd 0.5，once false）+ 3 个 branch：+10 计数 / 满 50 入列+刷兵+扎营 / 进度 tip | **改写为一次成军（[M7] 用 `army.recruit`）** | 用户裁定：**1 次交互即完成征兵**。原三分支的"渐进计数/满额入列/刷兵"合并为一次 `army.recruit {fromCampId, count: 全部教徒}`；S02 无城池 → 走野外营地路径（寨仓扣粮/钱） |
| 6 | `recruit` | `commit.fact story.s02.recruit.done` | **改写目标源** | 目标语义 = "征兵一次成军"；[现] 交互一次直接提交 `recruit.done`；[M7] 改 `custom.event:army.recruited` |
| 7 | `after.recruit.1` | `action`「新兵入列」 | **删除** | `army.recruit` 提交出口自带 `batchExchange` + `SquadMemberComponent` 注入；[现] 由 branch 的 `spawnPlacements` 承担 |
| 8 | `after.recruit.2` | 对话「张角检阅新募信众」 | **保留** | 纯演出；此处是**举事**的情绪铺垫 |
| — | ★ **新增 `uprising`** | — | **新增（举事）** | 用户裁定：张角举事发生在任务过程中。提交 `story.s02.uprising`，触发村落→军营切换 + 六类建筑落成 + 张角换装/旗号（见 §5） |
| 9 | `campComplete` | `armyCampLaid` → 6 个平铺 action（camp.laid 事实 / 装饰 / overnight.done / raid.fight.prepare / 刷 vanguard / `army.possess`） | **拆分改写** | 见 §1.1：装饰改为军营建筑落成（举事已建），刷兵/possess 见 §5/§6 |
| 10 | `camp` | 目标 `story.s02.camp.laid` | **改写（[M3] `unit.order{camp}`）** | 03 §9-3D 点名的迁移项；目标改 `unit.orderCompleted(order:'camp')` / `camp.laid` |
| 11 | `after.camp.1` | `action`「扎营完成」 | **删除** | 与 9 的 camp.laid 事实重复 |
| 12 | `after.camp.2` | 对话「当夜安营休整」 | **保留** | 演出；此处可插一句粮草充足的自解释（不设任务步骤） |
| 13 | `after.camp.3` | `tutorial` `s02.command.stance` | **删除** | 编组选择条/姿态面板在 03 §8 被砍；M8 教程冻结（P11） |
| 14 | `repelRaid` | 目标 `story.s02.raid.repeled` | **改写目标源** | [现] 保留 fact（`raidVictory` 提交）；[M4] 改 `unit.encounterResolved`（kind=army 胜利） |
| 15 | `after.repelRaid.1` | 对话「围剿击退」 | **保留** | 演出 |
| 16 | `after.repelRaid.2` | `tutorial` `s02.command.stance` | **删除** | 同 13 |
| 17 | `raidWave2` | `waveCleared{S02-raid-vanguard}` → branch：第二次预警 + 刷主力+傅燮 | **改写（[M4] 增援遭遇）** | 体系里第二波 = 敌方 `unit.order{attack}` 的增援/遭遇链；[现] 保留 `waveCleared` |
| 18 | `raidVictory` | `waveCleared{S02-raid-mainforce}` → branch：提交 repeled/fight.clear + `army.possess.release` | **保留事实、改写命令** | 事实链不动；`possess.release` 语义更新为"**主将撤出**"（不是结束战斗，战斗终结由 `waveCleared` 判定，见 §6） |
| 19 | `raidDefeat` | `playerSpecialFaint` → branch：兵败溃退（回血/重置波次/重刷） | **保留（[M9] 可接 `army.regroup`）** | 用户裁定：军队被打散是**玩家可接受的失败结局**，不挂 `noDesertion`；兵败分支照常可继续 |
| 20 | `scavengerEncounter` | `enter` + `if not encountered` → 头目对话 | **保留** | 探索支线，与军团无关 |
| 21 | `scavengerEncounterEnd` | `dialogueEnd` → 提交事实 | **保留** | 同上 |
| 22 | `travelToS09` | `interact` → 提交 `story.s02.travel` | **保留（[M4] 可加 `unit.order{move}`）** | 场景切换不是大地图行军 |

**汇总**：保留 11 步、改写 6 步（5/6/9/10/14/17/18）、删除 4 步（7/11/13/16）、**新增 1 步（`uprising`）**。
原方案的"粮草清点 + 后勤危机二选一"三步**整体删除**（理由见 §7）。

### 1.1 `campComplete` 六项逐项处置（v2 修订）

| 现 action | 处置 | 说明 |
|---|---|---|
| `state.transaction story.s02.camp.laid` | **保留** | 军营落成的唯一事实；新体系 `camp.laid` 沿用同名（03 §7.2 明示「沿用 `armyCampLaid`」） |
| `spawnPlacements S02-camp-decor` | **前移到 `uprising`** | 建筑与栅栏/大门由举事一次性落成（§5）；扎营只做营帐/篝火等动态件 |
| `state.transaction story.s02.overnight.done` | **保留** | 剧情时间线事实 |
| `state.transaction story.s02.raid.fight.prepare` | **保留** | 围剿阶段门控 |
| `spawnPlacements S02-raid-vanguard` | **转体系（[M4]）** | 敌军进场改由 `unit.order{attack}` / 遭遇展开驱动；[现] 保留 |
| `scenario.command army.possess` | **保留（语义更新）** | = 远程接管的剧情化入口（§6），不是"体系无等价" |

---

## 2. 改造后的步骤序列（目标态）

> 22 步 → **19 步**（删 4 + 新增 1，无粮草段）。四段；★ = 相对现状新增。

**第一段 · 荒村（1–4 不变）**
1. `spawnInitial` 进场装配（破旧村落，`S02-village-*` 生效）
2. `porridge` 施粥
3. `acceptSummonsInteract` 召见对话
4. `acceptSummons` 接受召见

**第二段 · 传道与举事（5–8）**
5. `recruitInteract` 招众旗：**一次交互**完成征兵（黄巾教徒 → 黄巾军）
6. `recruit` 目标：征兵完成（`story.s02.recruit.done` / `army.recruited`）
7. `after.recruit.2` 张角检阅（演出，举事前的动员）
8. ★ `uprising` **张角举事**：提交 `story.s02.uprising` → 村落转军营（六类建筑落成，§5）

**第三段 · 扎营与围剿（9–15）**
9. `camp` 目标：`unit.order{camp}` → `camp.laid`
10. `campComplete` 扎营落成（事实 + 夜晚 + 围剿门控 + 远程接管入口 `army.possess`）
11. `after.camp.2` 当夜安营对话（内嵌一句"粮草充足"的自解释，不设步骤）
12. `repelRaid` 官兵围剿（远程接管展开为真实战斗；主将阵亡或撤离都不直接判负）
13. `raidWave2` 第二波增援
14. `raidVictory` 围剿胜利
15. `raidDefeat` 兵败（可接受结局分支，重整再战）

**第四段 · 北上（16–19）**
16. `after.repelRaid.1` 围剿击退对话
17. `scavengerEncounter` 拾荒者遭遇
18. `scavengerEncounterEnd` 收口
19. `travelToS09` 北上

> 取舍：粮草段删除后，围剿前的戏剧张力改由"举事后官兵必来"承担，不再借后勤危机。

---

## 3. 军团能力嵌入位置（v2 修订）

| 能力 | 嵌在哪几步 | 体系落点 | 现阶段替代 |
|---|---|---|---|
| **编组** | 5/6（征兵入列） | `armyStates` roster + `SquadMemberComponent` | `spawnPlacements S02-army-recruits`（保留） |
| **招募** | 5/6（**一次成军**） | `army.recruit {fromCampId, unitType, count}`（野外营地路径） | 单次 branch + 计数事务（保留，标 legacy） |
| **扎营** | 9/10 | `unit.order{order:'camp'}` → `camp.laid` → CAMPED（campBuff） | `army.camp{x,y}`（保留） |
| **军令** | 12（防守）/ 13（增援） | `unit.order{order:'defend'|'attack'}` | `applyStance('hold')` + 刷兵触发器（保留） |
| **粮草** | 11（仅一句提示）/ 可选"粮仓被烧" | `FoodLedgerSystem` 日结（慢耗、充足） | **不设任务步骤**；`supply.*` 不进 S02 主线 |
| **押运 / 被抢 / 断粮** | — | `convoy.*` / `army.forage` | **S02 不启用**（粮草充足，无压力） |

---

## 4. 可直接复用的命令（替代手写堆逻辑）

| 现有手写实现 | 换成 | 阶段 | 备注 |
|---|---|---|---|
| `army.camp {x,y}` 剧情命令 | `unit.order {order:'camp'}` | M3 3B | 03 §9-3D 点名迁移；内部可先双注册 |
| `army.march routeId` | `unit.order {order:'move'}` | M4 | S02 暂不涉及（traveToS09 是切场景） |
| `recruitInteract` 的 3 个 branch | `army.recruit` + `army.recruited` 事件 | M7 7B | 计数/入列/刷兵一次完成 |
| `spawnPlacements S02-army-recruits` | `army.recruit` 提交出口（batchExchange + 实体展开） | M7 | 现阶段保留 |
| 手写"兵败回满血 + 波次重置" | `army.regroup`（可选；S02 允许失败） | M9 | 现手写不动 |
| 敌军波次 `spawnPlacements` | 敌军 `unit.order{attack}` / 遭遇展开 | M4/M6 | 现阶段保留 `waveCleared` |
| `army.possess` / `.release` | 转发到远程接管命令（`unit.joinBattle{identity:'takeover', mode:'remote'}` / `leaveBattle`，M4 提案） | M4 | **保留 operation 名**（兼容旧触发器/旧剧本）；`release` = 主将撤出（§6） |
| 无 | `army.recruit` 的**野外营地路径** | M7 必须补 | S02 无城池，城内路径不可用 |

---

## 5. 举事与军营建筑：场景/建筑状态切换（v2 新增）

### 5.1 六个标准建筑怎么表达

| 建筑 | 表达载体 | 既有/新增 | 语义 |
|---|---|---|---|
| **铁匠铺** | `construction.definitions` 新增 `construction.s02.smithy`（`imageId` + `warEffects`），落成后挂交互服务 | **新增定义** | 功能挂点：修理/打造（服务层后续接） |
| **征召处** | 新增 `construction.s02.recruitPost` | **新增定义** | 功能挂点：`army.recruit` 的交互入口（替代原招募旗） |
| **粮仓** | 新增 `construction.s02.granary` | **新增定义** | 功能挂点：军营粮草容器（09 明确「军营容器与粮草库存挂在这里」） |
| **兵营（出兵点）** | `BuildingComponent.buildingType = 'barracks'`（**枚举已有**）+ `placement kind:'army'`（**机制已有**，如 `army.s02.guard`） | **既有枚举 + 既有 placement** | 出兵/补员；`spawnPlacements` 直接产出 |
| **栅栏** | `BuildingType.WALL` 多段（实体级，可摧毁）或 `ARMY_CONSTRUCTION_DEFS` 增 `palisade` | **枚举既有 / 工程物新增** | 碰撞 + 可被攻破；纯表现段可用地贴 |
| **大门** | `BuildingType.GATE` | **既有枚举** | 碰撞 + 开合（进出营地） |

分层原则：
- **功能挂点**（铁匠铺/征召处/粮仓）走 `construction.definitions` + `construction.sites`，因为它们需要库存与交互，和 `construction.campfire` 同构。
- **防御实体**（栅栏/大门/兵营）走 `BuildingComponent`/`placement kind:'army'`，因为它们需要血量、占地、可摧毁、可出兵。
- **纯表现**（营地地贴、旗号、烟尘、篝火光晕）不建实体：用场景地贴层 + `LightGlowRenderer`（已有 glow 体系）承载。
- `ARMY_CONSTRUCTION_DEFS` 的 `camp` 保持"战役级扎营工程物"语义，**不承担**军营建筑群（避免一个定义膨胀成建筑系统）。

### 5.2 举事如何触发切换（三级方案，推荐 A）

**A. 同场景分组切换（推荐）**
```
步骤 uprising 的 do：
  1 state.transaction story.s02.uprising
  2 despawnPlacements { selector: { group: 'S02-village' } }     // 撤旧村落 NPC/地物
  3 spawnPlacements   { selector: { group: 'S02-camp-buildings' } } // 六类建筑 + 栅栏 + 大门
  4 spawnPlacements   { selector: { group: 'S02-army-recruits' } }  // 黄巾军出兵
  5 showTip / 镜头演出（举事旗号、烟尘）
```
- 优点：不切场景 → 任务进度、掉落物、敌人状态都不丢；存档只多一条事实。
- 代价：地形（terrain）不变；若需要地面从土路变营地，叠 B。

**B. 视觉层叠加（可选）**
- 营地地贴/帐篷/栅栏阴影作为第二套 `terrain` preset，或直接用高 z 的 placement 表现层覆盖。
- 若坚持换地形：新增 `scenario.command scene.terrain.swap { presetId }`（当前**无此能力**，需评估）。

**C. 换场景（不推荐）**
- `S02 → S02-camp` 最干净，但会重置场景状态、打断镜头、增加一次加载；序章不值得。

### 5.3 新增数据契约

| 类型 | 名字 | 用途 |
|---|---|---|
| 事实 | `story.s02.uprising` | 举事唯一标记（存档、建筑分组门控、后续对话分支） |
| placement group | `S02-village` / `S02-camp-buildings` / `S02-army-recruits` | 两态切换与出兵 |
| construction id | `construction.s02.smithy` / `.recruitPost` / `.granary` | 三个功能建筑 |
| building/placement id | `S02-building-barracks`（barracks）、`S02-wall-*`、`S02-gate` | 防御实体 |
| 事件 | 复用 `armyCampLaid`（扎营）/ `waveCleared`（围剿） | 不新增事件名 |

---

## 6. 两种介入语义与 `army.possess` 处置（v3 修订）

### 6.1 两种介入（用户裁定）

| 类型 | 触发 | 玩家本体 | 战斗形态 | 退出 |
|---|---|---|---|---|
| **现场接管** | 玩家本体已在该战场位置 | 就在战场，直接 ARPG 加入 | 军团的**动画预演战斗**展开为**真实战斗**（实体化） | 可自由离开（未接管状态） |
| **远程接管** | 大地图按「接管——亲自操作将领和他的亲卫」 | **原地待命**（不跟随、不介入） | 玩家以**主将身份**进入战场操作（亲卫随行） | **主将撤离**：退回最近的己方军营（**战场即该军营时退最近的他营/城镇**），军团士气下降，剩余部队继续作战 |

主线约束：远程接管可随时退出，但退出不是"打赢了"也不是"打输了"——**战斗仍归军团自动结算**。

**「支援」形态在 S02 不启用（定稿）**：06 §3.5 的"撤离后带亲卫队到场算支援、不算接管"**不适用于
S02**——本章 §6.3 已定"现场介入在 S02 不出现"，序章也没有"主角带亲卫队增援某场军团战"的编排；
撤离后玩家本体回到大地图，本场战斗由预演打完（§6.2）。支援（`identity:'support'`）的适用范围为
**S03+ 的野战 / 关隘关卡**。S02 未来若确要加入，须另立专门章节写清入场判定、亲卫编制与每场限一次，
**本章不预留模糊表述**。

### 6.2 主将阵亡与撤出的判定（v3 核心）

| 情形 | 判定 | 后续 |
|---|---|---|
| **主将阵亡** | **不判负** | 士兵继续战斗，军团按自动结算推进；玩家回到"观战/大地图"态（若实现接管副将，则另立规则） |
| **主将主动撤离** | **不判负** | 主将退回**最近的己方军营**（S02 = 刚立的军营）；**若战斗地点就在那座军营（围剿即营地战），改退最近的另一座己方军营或城镇**（目标点选取见 06 §5.6）；军团**士气下降**（具体值待 03 士气表定），剩余部队继续作战 |
| **军团被全歼** | 判负 | `raidDefeat` → `playerSpecialFaint` 分支（S02 可接受结局） |
| **敌军被击溃** | 判胜 | `waveCleared` → `raidVictory` |

关键：**"主将不在场"与"军团战败"彻底解耦**——主将只是军团的一个高价值单位，不是胜负条件。

### 6.3 S02 的映射

**玩家操作张角 = 任务替玩家按了「接管」**——属于远程接管的剧情化入口：

- `campComplete` 的 `scenario.command army.possess` = 进入远程接管（不是"换主控的临时演出"）。
- 主角（玩家本体）此时留在营地/昏迷位置待命，不参与战斗。
- **`army.possess.release` = 主将撤出，不结束战斗**：调用后张角退回军营（**战场即该军营时
  退最近的另一座己方军营或城镇**，见 06 §5.6）、军团士气下降、剩余部队继续打；任务链不因
  release 而推进或失败。
- **战斗终结出口只有两个**：`raidVictory`（`waveCleared{S02-raid-mainforce}`）与
  `raidDefeat`（全军覆没 / `playerSpecialFaint`）。战斗终结时才由这两个出口收口，
  它们在内部可以顺带调用 release（主将退场），但 release 本身不等于结算。
- 主将阵亡：`possess` 会话结束（视同撤离的"非主动"版本），军团继续作战；S02 不因此切到
  失败分支，仍以 `waveCleared` / 全军覆没判定。
- 迁移建议：M4 若实现 `unit.joinBattle({ armyId, mode:'remote'|'onsite' })`，
  `army.possess` 转发 `joinBattle{mode:'remote'}`，`army.possess.release` 转发
  `leaveBattle({ reason:'commanderLeft' })`（士气惩罚 + 回最近军营），战斗终结仍走
  `unit.encounterResolved`；operation 名与事件名全部保留。
- 现场介入（玩家本体在战场）在 S02 不出现——序章没有"主角随机路过军团战"的场景；
  该形态留给 S03+ 的野战关卡。

---

## 7. 粮草：为什么在 S02 不做任务段（v2 修订）

用户口径：**粮草充足、消耗极慢（按游戏内每天）、除非被火烧否则无影响；军队被打散也可接受。**

据此撤销原方案的三处设计：

| 原设计 | 处置 | 新口径 |
|---|---|---|
| 新增步骤「清点粮草」(`supply.open/requisition`) | **删除** | 粮仓在举事后即满仓，不设领粮任务 |
| 新增「后勤危机二选一」(押运/抢掠) | **删除** | 不制造压力；押运/被抢/断粮属 S03+ 的野战后勤 |
| `noDesertion` 白名单（防剧情军队被打散） | **撤销** | 允许打散；`raidDefeat` 失败分支是**合法结局**，不强行保建制 |

保留的最小表达（**不作为任务步骤**）：
1. `after.camp.2` 对话里一句旁白：「营中粮草尚足，可支半月。」
2. 可选支线（不进主线）：`粮仓被烧` → `story.s02.granaryBurned` 事实 → 影响围剿士气/对话；
   这对应"除非被火烧"的唯一例外，可在 M2 落地后作为一次性事件加入。
3. `FoodLedgerSystem` 的日结在 S02 只是**背景消耗**，不产生 UI 压力（不弹告急）。

---

## 8. 教程与引导的影响

**结论：S02 不承担"教会玩家用军团"的职责。**

- 依据：M8 教程整体冻结（tasks.md + P11「规则改为 UI 自解释」），且编组选择条/姿态面板
  在 03 §8 被砍——现有 2 个 `s02.command.stance` 教程步骤（13/16）教的是已删除的 UI，必须删。
- 替代：在关键步骤挂一次性 `showTip`——
  - 步骤 5 征兵：「招众旗：一次征召，教徒尽数编入黄巾军。」（一次成军的自解释）
  - 步骤 8 举事：「张角举旗，荒村立营。」（军营状态切换的旁白）
  - 步骤 9 扎营：「扎营后全军就地驻守，粮仓可领补给。」
  - 步骤 12 围剿：「接管：亲自操作张角；主将阵亡或撤离都不算军败，部队会继续打。」（远程接管规则的一次性提示）
- **若 M8 解冻**：S02 是级 3/级 4 的自然教学场，插入点与 `tutorialId` 候选：
  | 教程 id | 插在哪 | 判定事实 |
  |---|---|---|
  | `tut.companion.summon` | 步骤 5 后（首次征兵） | `army.recruited` |
  | `tut.terrain.camp`（硬门槛） | 步骤 9（首次 `unit.order{camp}`） | `camp.laid` |
  | `tut.battle.join`（远程接管） | 步骤 12（首次 possess） | `battle.joined{remote}` |

---

## 9. 风险与回退点

### 9.1 必须保留的契约（改名即破档）

| 类别 | 具体名字 | 破裂后果 | 处置 |
|---|---|---|---|
| **scenario operation** | `army.camp`、`army.possess`、`army.possess.release`、`army.march`、`army.rescue.begin/awaken/faint` | S02 救援段与围剿整链失效 | `SanguoDomainCommandFacade` **双注册**：旧名转发到新命令 |
| **剧情事件** | `armyCampLaid`、`waveCleared`、`playerSpecialFaint`、`armyMarchArrived`、`enterRegion` | 触发器不响应、围剿不推进 | 03 §7.2 已定「`camp.laid` 沿用 `armyCampLaid`」；其余保持原名 |
| **事实/黑板键** | `story.s02RecruitCount`、`story.s02RecruitDone`、`story.s02.camp.laid`、`story.s02.raid.repeled/fight.prepare/fight.clear`、`story.s02SummonsAccepted/Rescued` | 老存档进度判空、分支走错 | 继续写旧键；`recruitCount` 在"一次成军"后可一次性写满（保持键存在） |
| **任务节点 id** | `recruit`、`camp`、`repelRaid` 等 | 存档 `nodeStates` 失配，玩家回退 | **节点 id 一律不改**，只改 `eventMatcher`/`target` |
| **触发器 id** | `trg_task.s02.summons_event_*`（8 个） | per-trigger fingerprint 变化 → `once` 重置 | 改步骤 id 前先评估；必须改时加 `schemaVersion` 迁移 |
| **binding** | `S02-binding-recruit` 等 5 个 | 编辑器门控断链 | binding id 不动，只重指 triggerId |
| **tutorialId** | `s02.command.stance` | 存档残留未完成项阻塞 | 删除步骤时配套清理存档项 |
| **新建筑契约** | `construction.s02.*`、`S02-camp-buildings` 分组 | 举事切换失效 | 新增而非替换；不覆盖 `construction.campfire` 等既有 id |

### 9.2 回退点（每阶段可独立回滚）

| 阶段 | 改动 | 回退开关 |
|---|---|---|
| P1（现在可做） | 征兵 3 branch → 1 次；删 4 步；补 showTip | 纯数据，`git revert` |
| P2（现在可做） | 新增 `uprising` 步骤 + 村落/军营分组切换 + 三新 construction 定义 | 步骤挂 `if story.s02.uprising`；分组缺失时自动跳过（spawn 空选择器无害），旧村落地物保留 |
| P3（M3 后） | `army.camp` → `unit.order{camp}` | Facade 双注册 + `armyOrders.legacy` |
| P4（M7 后） | 招募 → `army.recruit`（野外营地路径） | 保留 `recruitLegacy` 数据开关 |
| P5（M4/M6 后） | 围剿遭遇驱动 + `possess` → `joinBattle{remote}` | 旧 operation 转发壳 |

### 9.3 四个最容易踩的坑

1. **S02 无城池**（P2：无城不算势力）→ `army.recruit` 城内路径不可用，必须走**野外营地路径**
   （寨仓扣粮），或给剧情军团加 `recruitExempt` 白名单。不定这条，M7 一落地招募迁移就卡死。
2. **`army.possess` 是远程接管、不是临时换主控**：`release` = **主将撤出，不结束战斗**
   （撤出后主将退回最近的己方军营、军团士气下降、剩余部队继续打）；战斗终结出口只有
   `raidVictory` / `raidDefeat` 两个，主将阵亡不判负。不要沿用旧的"对话结束就 release"写法。
3. **举事切换不要换场景**：换场景会丢掉落物、重置敌人、多一次黑屏；优先 `despawnPlacements` +
   `spawnPlacements` 的分组切换。
4. **建筑别塞进 `ARMY_CONSTRUCTION_DEFS`**：那是战役级工程物（鹿角/坑/筑城/扎营），
   军营建筑群应走 `construction.definitions` + `BuildingComponent`，混用会让"扎营"一个定义
   膨胀成建筑系统。

---

## 10. 分期落地建议（v2 修订）

| 期 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| **S0** | 征兵 3 branch → 1 次；删 4 步（7/11/13/16）；补 §8 的 4 条 showTip | 无 | 任务链可通关；征兵一次完成；编辑器流程条不缺条目 |
| **S1** | 新增 `uprising` 步骤 + 三新 construction 定义 + 村落/军营分组切换 + 栅栏/大门/兵营 placement | 无（现有 spawn/despawn + BuildingComponent） | 举事后村落消失、六类建筑出现、出兵点可用 |
| **S2** | `camp` 目标改 `unit.orderCompleted`；`campComplete` 装饰前移 | M3 3B | 扎营→夜晚→围剿时序不变 |
| **S3** | 招募迁 `army.recruit`（野外营地路径） | M7 7B | 征兵成本正确、无连点双计 |
| **S4** | 围剿改遭遇驱动；`possess` → `joinBattle{remote}` 兼容壳 | M4/M6 | 波次增援、兵败重整、主将阵亡/撤离均不判负（撤离退最近军营+士气下降） |
| **不做** | 粮草/押运/断粮任务段 | — | 仅保留"粮仓被烧"可选事件（M2 后评估） |

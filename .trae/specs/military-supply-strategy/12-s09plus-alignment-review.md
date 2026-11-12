# S09+ 任务链 × 军需/载具军团体系 · 对齐审查（冲突清单 + 搭配方案）

> 状态：审查稿 v1 · 2026-11-12 · **只读审查，本文档之外不改任何数据/代码**
> 范围：`task.s09.joinYellowTurban`、`task.s10.guangchengCamp`、`task.s11.guangzongRescue`、
> `task.s12.xiaquyangRescue`、`task.s13.jingshanBattle`、`task.s14.finalCommit`
> 口径来源：[s02-任务方案.md](s02-任务方案.md)（v3）、[decisions.md](decisions.md)（P1~P26）、
> [10](10-s02-quest-rework.md) / [06](06-battle-plan-intervene.md) / [03](03-army-squads.md) /
> [05](05-formation-terrain.md) / [07](07-town-administration.md) / [09](09-food-logistics-economy.md) /
> [02](02-supply-escort.md)，以及 M1~M9 + wiring 的已交付记录
>
> **判断前提（用户补充）**：引擎侧同屏上限 **2000 人**。所以"S09 之后会战人数会被引擎卡住"不成立；
> 下文所有"规模过大"只在**设计层（节奏/可读性/AI 成本/操作半径）**成立，**不把性能当理由缩兵**。
> S02 的"同屏 100"是刻意设计值，不是天花板。

---

## 0. 结论速览

1. **最重要的一条不是某一步冲突，而是"出口"缺失**：整套军团—内政—招募—押运—粮草都要求
   **玩家拥有城池/军营**（P2/P6），而 S09~S14 没有任何一处让玩家拿到己方城池或己方军营，
   于是层级一在 S09 之后**整层不可达**（军团按钮恒置灰），任务链实际上只跑得动 ARPG 层。
2. **S02 的"加入 / 不加入"分叉没有下游**：S09 只有"回应张角入伍之邀"一条路，
   且 S03~S08 的战斗入口硬门控 `joinedYellowTurban && classSelectionCommitted`。
   分叉落到 S09 就断线（不加入线无任何任务、无亲卫随行数据）。
3. **"观战 / 介入"二选一与体系 P7 正面冲突**：文档已定"三种入场身份、无模式选择 UI、
   `selectMode` 自动判定"，但 S11/S12/S13 仍用 `modeView` 强选，且**结局读 `battleModeStats`**。
   更严重的是：S11/S12 的救援只允许 `intervene`，**观战分支会让必需任务目标无法达成（软锁）**。
4. **S13 决战数据是坏的**：`battle.s13.jingshan` 把"孙夏"写成黄巾残部主将（`hero.sun_xia`，
   `factionId: yellow_turban`），而任务目标是"讨斩敌将孙夏"、场景把孙夏放在敌组 `S13-sun-xia`；
   观战还会把该组整组 despawn 掉 → "斩将"目标与"观战"互相排斥。
5. **营地有三套**：S02 的 `army.camp`（军团扎营 + 军营库存 + 攻防加成）、S10 的
   `camp.inspect/camp.relocate`（纯剧情 site 评估）、S14 的马车（载具货舱）。
   三者互不认识，粮草/军营/押运链在 S09~S14 是断的。
6. **粮草至少四条链**：battle 配置自带 `resources.food`、S11 战马 `refeedHorse`、
   S12/S13 介入扣**玩家背包** `resource.food/herb`、以及 wiring 定稿"粮草权威 = `FoodLedgerSystem`"。
7. **阵中友军没有体系位置**：S11 的"6 名卫兵"、S12 的"波才 / 张梁援军"都是 placement +
   `conditionalAllies.storyPath`，既不是 03 的随行小队/军团，也不是 06 的 support（support 只带自己的亲卫）。
8. **数值口径没对齐**：S02 文档的亲卫上限 `10 + floor(command/10) + rankBonus`（自称示例值）
   与定稿 P1d `⌊(统率 + 官职)/2⌋` 不是同一个公式；声望/阵营键还有三套写法。
9. **玩家身份绑定错了**：`companionRule.heroId = hero.zhangjiao`，但 S02 v3 之后主角是"年轻人"，
   张角在 S10 病逝——亲卫上限/士气/统兵池挂在一个已死 NPC 上。
10. **好消息**：S10 的建造战争效果已委托 `WarEffectAggregator`（M5），S09 的大营/营地城市、
    S11/S12 的护城/守门数据结构与 07 城池、05 地势口径并不打架；**改造量集中在"入口/身份/账本"三处，
    不需要推翻已完成的 M1~M9**。

---

## 1. 实测现状（只列与本次判断相关的事实）

### 1.1 任务链实际播放顺序

```
S01 → S02 → S09（广宗大营·入黄巾 + 三军旗定职业）→ S03~S08（颍川/长社/宛城/西华）
    → S10（广城扎营·张角病逝）→ S11（广宗救张梁）→ S12（下曲阳救张宝）
    → S13（精山决战）→ S14（结局营地）
```

- 依据：`task.s09` 末步 `triggerSucceeded{trg_s09_travel_s03}`；S03~S08 任务 `accept` 均为
  `sceneEnter`。**S03~S08 在播放序上也在 S09 之后**，但不在本次逐条范围；它们与 S11~S13
  共享同一套"战役模式/救援/编制"冲突（§2.B），方案可整批套用。

### 1.2 任务数据（`project/quests.json`）

| 任务 | 行 | 场景 | 关键步骤（数据原样） | 依赖事实 / 触发器 | 奖励 |
|---|---|---|---|---|---|
| `task.s09.joinYellowTurban` | [2366](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L2366) | S09 | `intro.spawn`（组 `S09-initial`）→ 开场对话 → 目标 `commit.fact story.s09.enlist` → 目标 `custom.event classSelected` → `state.transaction reward.s09.classGift` → 目标 `trg_s09_travel_s03` | `story.s09.enlist`、`classSelected` | 粮 3 / 药 2 |
| `task.s10.guangchengCamp` | [3138](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3138) | S10 | 开场 → 目标 `trg_s10_acknowledge_temporary_camp` → `trg_s10_zhangjiao_death` → 建造营火/拒马/壁垒/箭楼 4 目标 → `trg_s10_complete_relocation` → `trg_s10_exit_s11` | 全为 triggerSucceeded | 木 4 / 药 2 |
| `task.s11.guangzongRescue` | [3286](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3286) | S11 | 3×`spawnPlacements` → 目标"选定参战方式" → 目标"启动张梁限时救援"（[3370](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3370)） → 烽火 → 集结卫兵 → 三波刺客 → 西门突围 → 上马 → 转进 S12 | `trg_s11_*` 8 条 | 铁 3 / 药 2 |
| `task.s12.xiaquyangRescue` | [3491](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3491) | S12 | 5×`spawnPlacements` → 选定参战方式 → 启动张宝救援（[3597](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3597)） → 密道 → 云梯 → 焚梯 → 护送撤离 → 赴终战 | `trg_s12_*` 7 条 | 铁 2 / 药 3 |
| `task.s13.jingshanBattle` | [3682](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3682) | S13 | 2×`spawnPlacements` → 选定决战参战方式 → 目标"讨斩敌将孙夏"（`waveCleared{S13-sun-xia}`，[3755](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3755)） → 前往结局营地 | `trg_s13_*` 3 条 | 药 3 / 粮 3 |
| `task.s14.finalCommit` | [3801](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3801) | S14 | 开场 → 清点辎重（马车货舱）→ 处置马车 → 处置投石机 → 驾驭投石机 → 了结此局（ending.command） | `trg_s14_*` 6 条 | 无 |

### 1.3 场景实体规模（`assets/scenes/*.json`，按 group 统计 ref 放置物）

| 场景 | 敌方/我方放置物（组） | 合计实体 | 备注 |
|---|---|---|---|
| S09 | `S09-initial` 6（3 NPC + 2 enemy + 1 资源点） | 6 | 敌：`enemy.s09_granary_guard`（faction=yellow_turban）、`enemy.s09_refugee_scout` |
| S10 | `S10-construction-supplies` 4（item） | 4 | 无战斗实体 |
| S11 | 黄巾 50 / 官军 51 / 卫兵 6 / 刺客 3+3+3 / 张梁 1 | 117 | 一次入场，无池、无补员 |
| S12 | 黄巾 12 / 官军 19 / 波才 1 / 张梁援军 4 / 张宝 1 / 铁矿 1 | 38 | 守门 60s + 密道 |
| S13 | 黄巾 3 / 官军 3 / 孙夏组 3（孙夏 + 2 护卫） | 9 | "决战"只有 9 人 |
| S14 | 投石机靶 1（+ 马车/投石机为 vehicle） | 1 | — |

### 1.4 战役/救援配置

| 文件 | 事实 | 冲突相关点 |
|---|---|---|
| [S11.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/battles/S11.json) | `modeView` 观战/介入强选；`attackerArmy` 黄巾（张梁）vs 官军，`formationIds`+`commanderHeroId` | 无 `roster`；模式 UI |
| [S11 rescue](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/rescues/S11.json#L7) | `allowedModes: ["intervene"]`、`requiredGuardCount: 6`、3 波刺客、`successEffects.s12DefenseBoost` | 观战→救援不可启动；跨场景直写 buff |
| [S12.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/battles/S12.json) | `preBattleRules.friendlyMoraleZero` 读 `city.s12_xiaquyang.morale` | 用城池民心当军团士气 |
| [S12 rescue](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/rescues/S12.json#L25) | `costs: resource.food 20 / herb 10`（玩家背包） | 与 FoodLedger 双账 |
| [S13.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/battles/S13.json#L11) | `attackerArmy.commanderHeroId = hero.sun_xia`（黄巾）；介入消耗 粮12/药6/木10；`affectedCityId = city.s09_guangzong_camp` | 孙夏身份错；资源口径错 |

### 1.5 体系已落地能力（可直接用）

- `ArmyOrderSystem` + `unit.order`（五战略指令）、`armyStates`、`StrategicAdvanceSystem`（M3/M4）
- `FoodLedgerSystem`（日耗/四档断粮/逃散/抢掠/散兵池）、`CityAdministrationService`（产出/民心/招募/输送/易主）、
  `BattleSettlement`/`BattleEntry`/`PricingService`/`Reputation`、`WarEffectAggregator`、`SupplyStatusBar`、
  `BattleResultView`、`CampStockContainerAdapter`（wiring 全批）
- 注册表就绪：`armies` 2 条、`formations` 14、`heroes` 14、`unitTypes` 7、`ranks` 21、`vehicles` 4
- `army.camp` 已实现（`S02ArmyRescueFlow.campArmy` → `armyCampLaid`）+ 军营库存 `camp.register/openCampSupply`

---

## 2. 冲突清单（逐条：文档条款 × 数据位置 × 冲突 × 为什么）

### A. 主线与架构口径

| # | 文档条款 | 任务/数据 | 冲突 | 为什么 |
|---|---|---|---|---|
| **A1** | [s02 任务方案 §2/§4](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/s02-任务方案.md)：分叉"加入 / 暂时还不行"，且**⑨ 之后主控交回年轻人** | [task.s09](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L2366) 只有"回应张角入伍之邀"；`S09ClassSelectionFlow` 在定职时写 `joinedYellowTurban: true`（[127/132](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S09ClassSelectionFlow.js#L127)）；`S03S08SceneFlow` 门控 `joinedYellowTurban && classSelectionCommitted`（[34](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S03S08SceneFlow.js#L34)） | "不加入"分支在 S09 无路可走，S03~S08 直接卡死 | 分叉只写了 S02 当场后果，没有写成"后续任务门控"；S09 是唯一的入伙关口 |
| **A2** | s02 §4.2："S09 之后 → 加入=黄巾任务线 / 不加入=**独立任务线（游侠/自建势力）**" | 任务库 16 条全是黄巾主线（S10 送张角、S11 救张梁、S12 救张宝、S13 助战） | 承诺了不存在的独立线 | 文档只写"影响"，没有对应的任务/触发器条目 |
| **A3** | P2（势力 ≥1 城）+ P6（军团按钮，无城置灰）+ 03/07/02（指令/内政/押运都挂武装单位） | `worldLogic` 城市全部 `ownerFactionId: yellow_turban / han_government`（[game.project.json:689-1130](file:///d:/yijian18-engine/example/sanguo_zhangjiao/game.project.json#L689)）；S09~S14 无 `city.setFaction`/`city.capture`/`city.owned` | **玩家全程不是"势力"** → 军团按钮/大地图指令/内政/招募/押运在 S09+ 整层不可达 | 体系把"拥有城池"设为一切战略玩法的前提，但主线没有发城节点 |
| **A4** | s02 §2：⑨ 之后主控 = 年轻人，S09+ 主角是年轻人；张角 S10 病逝 | `companionRule.heroId = hero.zhangjiao`（[game.project.json:655-657](file:///d:/yijian18-engine/example/sanguo_zhangjiao/game.project.json#L655)） | 亲卫上限/士气/统兵池绑定张角；张角死后数据主体不存在 | 亲卫体系按"玩家=主将"设计（P1/P1e），数据仍按 S02 张角主控期写死 |
| **A5** | s02 §4.0.1："S03+ 战役**可请求张角援军**（每战 1 次）" | P7 三身份只有 takeover / support / observe；support = **只带自己的亲卫、须本人抵达**；S09+ 任务无任何"请求援军"目标/命令 | 承诺的能力在体系里没有对应物 | "友军派兵"不是 support（support 是玩家亲自过去），也不是 takeover（接管别人军团） |
| **A6** | s02 §4.0.2/§9 ⑲：原拟写 `run.difficulty`（easy/hard）"供后续任务与结算引用" | S09~S14 任务、`config/battles/*`、`config/endings.json` 均不读 `run.difficulty` | ~~难度分支在 S02 之后完全空转~~ | **已消解（2026-11-12）**：取消难度概念，不再写 `run.difficulty`；分叉只认 `alignment` |
| **A7** | P20：声望 = `state.player.reputation`（`byFaction`+`byCity`，唯一写入口 `reputation.adjust`）；民心只挂城池；士气两层 | s02 §4.2 写 `faction.reputation.yellow_turban/han`、`faction.player.alignment`；数据里汉方是 `han_government`（enemies/battles/cities），英雄是 `han`（heroes），玩家入伙用 `storyState.joinedYellowTurban` | 同一概念三套键 + 两套模型（文档声望表 vs P20 repution 服务） | 文档成稿早于 P20 定稿，且没有做键名归一 |
| **A8** | 09/02/07：粮草、押运、内政是"资源—军事闭环" | S09~S14 无一条任务步骤涉及 supply/convoy/工坊/铁匠/箭矢/耐久/招募/散兵招回 | 新经济层在主线里**没有任何落点**（只有 S02 一次成军 + S10 四件战防建筑） | 体系设计面向"有城有营的沙盘"，主线是线性剧情，缺"经济压力"剧情节点 |

### B. 战斗 / 介入 / 编制

| # | 文档条款 | 任务/数据 | 冲突 | 为什么 |
|---|---|---|---|---|
| **B1** | P7 + [06 §3.3](file:///d:/yijian18-engine/.trae/specs/military-supply-strategy/06-battle-plan-intervene.md#L87)：**三种入场身份**（takeover/support/observe）、`selectMode` 引擎自动判定、**不弹模式选择 UI**（v1 `BattleModeView` 强选已作废） | S11/S12/S13 都有 `modeView`（观战/介入）强选；任务目标"选定参战方式"；`endings.json` `requiredPaths` 含 `battleModeStats.*`（[5](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/endings.json#L5)） | 数据面还在跑被文档明确砍掉的"模式三选" | 体系改了介入模型，但战役配置/任务/结局三层都没迁移 |
| **B2** | P19（主将阵亡不判负、胜负只由 `evaluateOutcome`）+ 06 三身份 | S11 救援 `allowedModes:["intervene"]`（[rescue S11:7](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/rescues/S11.json#L7)），`_validateStart` 非 intervene 直接拒（[S11S12Coordinator:372](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S11S12Coordinator.js#L372)）；任务仍要求"启动救援/烽火/集结/三波/西门" | **观战 = 必需目标永远达不成（软锁）**；S12 的守门/密道/撤离同理 | 任务是按"介入唯一路径"写的；观战只是战果分支，没有任务分支 |
| **B3** | 06：观战 = 不下场、无实体介入，战果照常 | S13 观战 → `_retirePersonalDuelGroup` 把 `S13-sun-xia` 整组 despawn（[S03S14BattleCoordinator:37/400](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S03S14BattleCoordinator.js#L400)）；任务唯一推进目标是 `waveCleared{S13-sun-xia}` | 观战 → 组被移除 → "讨斩孙夏"极可能永不触发 | 任务把"斩将"写成"清空一个 placement 组"，而观战语义是"这组人不和玩家交手" |
| **B4** | P19 + 斩将即溃散（s02 §5.7.3 口径）；05 主将一律下场（P22） | `battle.s13.jingshan` `attackerArmy`（黄巾残部）`commanderHeroId: hero.sun_xia`、`factionId: yellow_turban`（[S13.json:11](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/battles/S13.json#L11)）；`hero.sun_xia` 也是 `yellow_turban` + `unit.archer`；而 enemy `enemy.s13_sun_xia` 无 faction、场景归 `S13-sun-xia` 敌组 | **孙夏同时是"我军主将"和"要斩的敌将"** | 战役配置与任务/场景/敌库三处口径不一致（占位 hero 遗留） |
| **B5** | 03 §3.1/§3.2 + P22/P23：军团有 `roster`（兵种构成）、`formationId`、`commanderSlot`；战斗接战前部署、接战锁死 | S11/S12/S13 battle 只有 `formationIds` + `commanderHeroId`（无 roster/兵种/位置）；实体全靠 scene placement 一个个 ref 刷；S02 围剿的"1000 池 / 同屏 100 / 击破 500 登场 / 斩将溃散"只写在 s02 方案 §5.7，未进 03/06 通用模块 | 战前部署三件套在 S11~S13 无数据可部署；兵力池/补员是 S02 私有，其他战役要复刻 | 体系抽象停在"军团=数据"，战役侧仍是"场景摆人" |
| **B6** | P20：民心只依附城池（配合度），士气是军团层 `ArmyState.morale`（两层） | `battles/S12.json` `preBattleRules.friendlyMoraleZero` 读 `city.s12_xiaquyang.morale`，士气 0 直接判负 + `skipRealtimeBattle` | 民心/士气混用 | 先有战役配置、后有 P20 三分账，未回改 |
| **B7** | 03 随行小队（五档）+ s02 §2.2「抢救伤员」姿态（搬运玩法） | S11/S12 的救援是独立系统：`rescue.command` + `config/rescues/*`（stages/waves/`requiredGuardCount`/`successEffects`） | 两套"救援"并存：军团姿态抢救伤员 vs 剧情限时救援 | 救援是早期战役框架，未纳入 03 的战术层 |
| **B8** | 06：support 只能"自己的亲卫"，无"收编友军"能力；P15 只有"散兵招回" | S11 要求"集结 **6 名卫兵**"（`requiredGuardCount: 6`，`S11-rescue-guards`） | 体系没有"临时收编战场友军"的正式能力 | 卫兵是 placement 组 + aiType support，不入任何编制 |
| **B9** | 09/P1e：亲卫阵亡 → 统兵池扣 1、8s 援军跑入、无兵源不补、战后满编重建 | S11/S12/S13 战损没有任何补位/重建链路（battle config 也不带统兵池） | 战役里我方阵亡 = 场景实体消失，账上无变化 | 补位链只接在 S02 围剿方案里 |

### C. 营地 / 建造 / 军营

| # | 文档条款 | 任务/数据 | 冲突 | 为什么 |
|---|---|---|---|---|
| **C1** | 军团"扎营"= `army.camp`（`armyCampLaid`、军营库存、防御/攻击加成，s02 §2.2 + wiring 批次 5） | S10 的"临时扎营 / 完成迁移"= `scenario.command camp.inspect / camp.relocate`，只写 `storyState.s10TemporaryCamp / s10CampRelocation`（[S10StoryFlow:89-155](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S10StoryFlow.js#L89)）；不产生 ArmyState、不注册 `logistics.camps` | **"确认临时扎营选址/完成营地迁移"与军团的"扎营"是两个东西**，任务名撞车、数据零交集 | S10 写于军团体系之前；军团扎营后落地没有回填 S10 |
| **C2** | P18：工坊/铁匠是**可建造建筑**，`construction.definitions[].stations[]` 声明工位；建造入口统一走「军团」按钮下的建造面板 | S10 四件（campfire/barricade/simple_wall/arrow_tower）走 `construction.command` + 项目私有 `operation: construction.start.s10` + `siteKey`（`S10_STRUCTURE_BY_SITE`）；且四件里没有工坊/铁匠/粮仓/兵营 | 两套建造入口/两套代价；主线建的东西≠军团体系的生产建筑 | S10 是"关卡式建造"，M1 是"生产链建筑"，没有统一入口 |
| **C3** | wiring 批次 5：军营 = `logistics.camps`（易失容器 + `campStorage` 容量 + 粮草条） | `game.project.json` 无 `camps` 种子；只有 S02 运行时 `registerCamp('camp.s02.field')`（[S02ArmyRescueFlow:329-373](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js#L329)）；S09/S10 的营地在 `cityStates`（city.s09_guangzong_camp / city.s10_guangcheng_camp） | S09~S14 没有任何"军营" → 粮草条军营段恒空、无存粮/断粮/押运落点 | 军营只在 S02 建过，主线换场即丢 |
| **C4** | s02 §5.1 / 10 §5.1：举事落成"铁匠铺/军械工坊/征召处/粮仓/兵营" | 当前 S02 数据确有 `S02-camp-buildings`（[quests:1934](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L1934)）；S09 起再没有这些建筑的**功能**（无工位/无产出/无招募） | 玩家在 S02 建的工坊/铁匠，进入 S09 后等于不存在 | 建筑只做了表现与战争效果，没有跨场景的生产归属（07 产出以 city.buildings 为准，S02 营地不是城） |

### D. 经济 / 后勤 / 粮草

| # | 文档条款 | 任务/数据 | 冲突 | 为什么 |
|---|---|---|---|---|
| **D1** | wiring D1：**粮草权威 = `FoodLedgerSystem`**（军团 `supply.food`，日结/断粮/逃散） | battle 配置自带 `resources.food`（S11 48/70、S12 76/32、S13 12/40）；S11 战马有 `vehicle.logistics.starved / refeedHorse`（[S11S14SceneFlow:240-259](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S11S14SceneFlow.js#L240)）；S12/S13 介入扣玩家背包 `resource.food/herb` | **同一份粮至少有 4 条账**：battle 资源 / 战马饲料 / 玩家背包 / FoodLedger | 战役框架自带资源块，wiring 后又加权威账，没有做"谁减谁"的仲裁 |
| **D2** | 09：日结粮耗、四档断粮、逃散地板 30%、`army.forage` 抢掠 | S13"介入消耗粮 12/药 6/木 10"是"买战果"，不触发任何断粮/士气/后勤状态；观战"保留物资"因此只是数值选择 | 用物资换战果的机制与后勤系统零咬合 | S13 写于 M9 之前 |
| **D3** | P16（箭矢消耗）/ P17（装备耐久）/ P18（工坊铁匠） | S09~S14 任务无一次修理/锻造/补给/箭矢；武器 `weapon.s11/12/13` 只作为奖励/掉落 | 新经济的三个回收口在主线不闭环 → 铜钱/材料无处消耗 | 主线没有"军需官/铁匠/粮草"剧情节点 |
| **D4** | P15（散兵池 30 日可招回）+ P1e（统兵池补位） | S11~S14 战损后无招募、无 regroup、无补位；S10 奖励只有木/药 | 战损不可恢复，后续战役只能"重置场景" | 战役按"一次性关卡"写，军团按"持续编制"写 |

### E. 载具 / 押运

| # | 文档条款 | 任务/数据 | 冲突 | 为什么 |
|---|---|---|---|---|
| **E1** | 02：载具指令（跟随/冲锋/原地防御/逃跑）+ P10 押运损失表（胜 0 / 逃 30% / 败 50% / 载具毁 100%） | S14 载具只走 `vehicle.command`：`openCargo / resolveDivergence(cart→transferBatch、catapult→assembleCatapult) / operateWeapon / leaveSeat` | "处置马车"没有"被抢/损失率/追回"口径，也没有载具指令 | S14 是三选一的剧情处置，02 是押运链路；两套语义没对接 |
| **E2** | 02/09：物资入库边界（在途走 02 表、入库走 06 表）；粮草权威 FoodLedger | S14 马车 `cargo` 是独立的第二份食物库存（`_readS13S14State` 把 cargo food + 背包 food 相加，[S11S14SceneFlow:1032-1038](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S11S14SceneFlow.js#L1032)） | 结局清点"辎重"不进任何军需账 | 结局输入是独立读取器，绕过了 ledger |
| **E3** | P4：载具不算兵种，但有独立攻城 ×2（投石车等） | `vehicle.s14.catapult` 由 `operateWeapon` 操作，`vehicle.s12.siegeLadder` 可被焚毁 | 攻城×2 与地势/建筑战争效果（05/`WarEffectAggregator`）没有接线 | 载具系统与 05 的攻城修正各写一半 |

### F. 阵营 / 亲卫 / 数值口径

| # | 文档条款 | 任务/数据 | 冲突 | 为什么 |
|---|---|---|---|---|
| **F1** | P1d：亲卫上限 = `⌊(统率 + 官职)/2⌋`，**无基础项**，满值 100；P1e 统兵 = ×100 | s02 §4.3：`guardCap = 10 + floor(command / 10) + rankBonus`（自注"示例值，需拍板"） | 两套公式，开局一个是 10、一个可能是 20+ | s02 写于 P1d 定稿前，且没回改 |
| **F2** | P1/P1d：上限 100（HUD 10×10） | s02 §4.0.1/§4.3："最多 80" | 上限数值冲突 | 同上 |
| **F3** | P20 + P2：势力/声望/阵营应有唯一键 | 四套：`storyState.joinedYellowTurban`（S09 定职写）、`heroes[].factionId`（`han`）、`enemies[].faction`（`han_government`）、`battles.participantFactionIds`（`han_government`） | 阵营判定散落，任何体系服务读到的"汉方"都可能对不上 | 历史数据命名不统一，没有别名表 |
| **F4** | 07：城池资源/民心/产出；P20 声望分记 | s02 给"战后补给 粮20/铁10/伤药3 + 声望 ±"；S09 只给粮 3/药 2；S10 给木 4/药 2 | 补给与声望数值没有落点（进背包？进城池？进声望账？） | 文档只写"给"，没写"记到哪本账" |
| **F5** | P1c：21 级官职阶梯已就绪（`ranks` 21 条） | S09~S14 无任何升官/升统率事件；`companionRule.initialRankId = rank.wusheng` 之后无变化 | 官职/统率成长链断裂 → 亲卫上限永远 10 | 剧情没有把胜利折算成功勋 |
| **F6** | s02 §4.0.1：不加入线"亲卫随行 S09"（⑦ 已定"能带走"） | S09 场景 `S09-initial` 只有 3 NPC + 2 敌 + 1 资源点；无亲卫/军队组；`S09` 也无 `army.player.escort` 定义（`armies` 仅 `army.s02.column` / `army.s02.recruits`） | "亲卫随行"没有数据承载 | 分叉落地时没写 S09 的刷兵组/军团定义 |

### G. 数据层硬伤（不改体系也应先修）

| # | 位置 | 问题 |
|---|---|---|
| **G1** | [battles/S13.json:11](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/battles/S13.json#L11) | 黄巾残部主将 = 孙夏（应为敌将；黄巾主将应张梁/张宝/玩家） |
| **G2** | [battles/S13.json:20](file:///d:/yijian18-engine/example/sanguo_zhangjiao/config/battles/S13.json#L20) | `affectedCityId` / `resourceSourceCityId` / `resourceDestinationCityId` 全是 `city.s09_guangzong_camp`（精山战记到广宗营地，且同城转移无意义） |
| **G3** | `library.json.heroes` | 14 条 hero **全部** `tags: ["m0.placeholder"]`，`unitId/classId` 与人物不符（`hero.sun_xia` = `unit.archer`）；P22 要按"猛将/智将"分 `commanderSlot`，无数据支撑 |
| **G4** | `library.json` `enemy.s09_granary_guard` | `faction: yellow_turban`，但 S09RefugeeFlow 的"未授权收割"把它当拦截者；玩家已入黄巾 → 同阵营可能拒战（需实测） |
| **G5** | S11/S12/S13 场景 | 我方/敌方都是逐个 ref 放置物（50/51、12/19…），无组级编制/伤亡入账；`waveCleared` 只认"组清空" |
| **G6** | `config/rescues/S11.json` `successEffects` + `S12.json` `conditionalAllies` | 跨场景直写 `s12DefenseBoost{morale/gateHp/friendlyReinforcements}`、按 `storyPath` 给友军 → 绕过 `armyStates`/`cityStates`（违反 spec.md §3 单一事实源） |
| **G7** | `config/endings.json` | `battleModeStats.allOptionalBattlesObserved / interventionCount` 是结局硬输入；一旦按 P7 取消模式 UI，结局输入悬空（旧档同时失配） |

---

## 3. 搭配度评估（逐任务）

> 记号：✅ 顺；⚠️ 需要小改；❌ 不搭（需方案 §4）

| 任务 | ✅ 可直接复用的体系能力 | ⚠️/❌ 不搭的地方 | 结论 |
|---|---|---|---|
| **S09** | `class.confirm` 与 `classes` 注册表；`cityStates.city.s09_guangzong_camp`；`SupplyStatusBar`/城市摘要已接（`S09RefugeeFlow`）；`armies` 可新增玩家军团 | ❌ 分叉无路（A1/A2）；❌ 亲卫/军队无数据（F6）；❌ 玩家不是势力（A3）；⚠️ 偷粮卫兵同阵营（G4） | **不搭**：S09 是"入伙单行道"，需要分叉 + 亲卫落点 |
| **S10** | ✅ 建造已委托 `WarEffectAggregator`（M5）；✅ 城防/建筑表现齐；✅ 张角病逝是干净的一次性史实 | ❌ 两套扎营（C1）；❌ 建造入口与 P18 分叉（C2）；❌ 军营未注册（C3）；⚠️ 无粮草/招募 | **半搭**：需要把"迁营"升级成真正的 `army.camp` + 军营注册 |
| **S11** | ✅ 救援四阶段与 06 的"介入改善战果"叙事契合；✅ 卫兵/刺客波次可转编制；✅ 50v51 体量在 2000 上限内可放大 | ❌ 模式强选 + 救援仅 intervene → 观战软锁（B1/B2）；❌ 卫兵无收编能力（B8）；⚠️ 编制/兵力池缺失（B5）；⚠️ 跨场景 buff 直写（G6） | **不搭（高优先）**：任务在观战分支不可完成 |
| **S12** | ✅ 守门 60s + 密道 + 云梯/焚梯 = 好玩的阶段目标；✅ 城池士气/城防已有数据 | ❌ 民心当士气（B6）；❌ 救援费扣背包（D1）；❌ 友军靠 storyPath 的 placement（G6/B5）；⚙️ `friendlyMoraleZero` 直判负与 P19 冲突 | **半搭**：机制可用，账本要换 |
| **S13** | ✅ 决战适合作为"军团级会战"首次上规模（2000 上限内）；✅ `enemy.s13_sun_xia` 已是 boss（telegraph 路径型）；✅ 05 阵法/地势已就绪 | ❌ 孙夏主将身份错（B4/G1）；❌ 观战 despawn 斩将组（B3）；❌ 9 人"决战"与剧情体量不符（设计层）；❌ 资源换战果与后勤无关（D2）；⚠️ 城市 id 错（G2） | **不搭（最高优先）**：数据本身自相矛盾 |
| **S14** | ✅ `CargoTransferView` 已存在（wiring 批次 5 扩了军营仓）；✅ 投石机/马车 = 现成载具实体；✅ 结局结算链稳定 | ❌ 载具/押运两套（E1/E2）；❌ 辎重不进 ledger（E2）；⚠️ 攻城×2 未接（E3）；⚠️ 结局输入与模式 UI 耦合（G7） | **半搭**：机制能跑，口径要统一 |

**一句话总评**：S09~S14 是"剧情驱动的线性关卡"，新体系是"有城有营的沙盘闭环"。
冲突的根不是数值，而是**三处没接上：入口（谁拥有什么）、身份（谁在指挥）、账本（资源记在哪）**。

---

## 4. 修改方案

> 每条给：改哪些任务步骤、用哪些军团能力、需要补什么数据/触发器/命令、量级、对已完成模块的影响。
> **量级**：小 = 数据 + 1 处接线；中 = 任务分支/新命令接线；大 = 跨模块契约。

### 4.1 S09（`task.s09.joinYellowTurban`）— 量级：中

**a. 补分叉（解决 A1/A2/F6）**

| 项 | 改法 |
|---|---|
| 新步骤 | 在 `intro.opening` 之后插入 `branch`：`when: story.s02.allegiance.joined` → 现有 `enlist`/`chooseClass` 链；`when: story.s02.allegiance.independent` → 新增对话 `dialogue.s09.independentArrival` + 目标"以游侠身份报备定职" |
| 目标 | `enlist` 目标加 `if`：仅加入线需要 `commit.fact story.s09.enlist`；不加入线改 `commit.fact story.s02.allegiance.independent`（已存在，直接复用） |
| 门控 | `S03S08SceneFlow:34` 的 `joinedYellowTurban` 改为 `classSelectionCommitted && (joinedYellowTurban \|\| alignment === 'independent')`（只改一处判断） |
| 亲卫 | 新增 `armies` 条目 `army.player.escort`（qian/hou，units 用 `enemy.s03_yellow_turban_soldier` 或 `unit.shield/spear`），S09 新增 placement 组 `S09-player-escort`（`spawnWhen: story.s02.allegiance.independent`）；黄巾线新增 `S09-yellow-column`（张角军，不随行） |
| 阵营键 | 统一写 `state.player.alignment`（`yellow_turban` / `independent`），`joinedYellowTurban` 保留为兼容别名（[A7] 归一的一部分） |

**b. 顺手修**：`enemy.s09_granary_guard` 改 `faction: han_government`（或新增中立 `faction: county_militia`），否则同阵营拒战（G4）。

**c. 影响**：`S09ClassSelectionFlow`（读 alignment）、`S03S08SceneFlow`（门控条件）、`armies` 数据；不影响 M1~M9 代码。

### 4.2 S10（`task.s10.guangchengCamp`）— 量级：小~中

| 项 | 改法 |
|---|---|
| 迁营 | `trg_s10_complete_relocation` 的 `do` 追加两条：`scenario.command army.camp {x,y = site.s10.creekConstruction}` → 等 `armyCampLaid` → `camp.register {campId:'camp.s10.creek', level:2}`（复用 S02ArmyRescueFlow 的两个现成入口） |
| 军营 | `game.project.json.logistics.camps` 或场景装配时种子 `camp.s10.creek`（容量 `campStorage` 默认 500/级）；粮草条军营段从此有数据 |
| 建造 | 4 件 `construction.command` 保留（表现/战争效果已对），但 `definitionId` 迁到 `construction.definitions[].stations` 口径，并把建造入口文案指向「军团 → 建造」（P18）；代价表按 `stations` 材料扣，不再走项目私有 `siteKey` 白名单（二选一，推荐前者） |
| 粮草 | 新增事实 `story.s10.supply.days=3`（只做提示用），让 09 的断粮状态机在 S10 首次可见（不判负） |
| 影响 | `S10StoryFlow.completeS10CampRelocation` 末尾加一次 `army.camp` 调用；`S10ConstructionFlow` 的 site 映射保留；**零回归**靠"不配 `army.camp` 参数时行为不变" |

### 4.3 S11（`task.s11.guangzongRescue`）— 量级：大

| 项 | 改法 |
|---|---|
| 模式 → 身份 | 删 `modeView`；`trg_s11_choose_battle_mode` 改发 `unit.joinBattle {identity:'takeover'\|'observe'}`（support 需本人到场，且 S11 是"守方"，不提供）；任务目标改名"选定参战身份"，匹配 `custom.event battle.identitySelected` |
| 观战分支 | 新增 `branch`：`observe` → 目标 `facts story.s11.observed` + 明确提示"战果将由 AI 结算"；把 `zhangLiangRescue / beacon / rally / waves / westGate` 五步标 `optional: true`（或整组放进 `if observe==false` 的分支）——**这是修软锁的最小改动** |
| 结局兼容 | `battleModeStats` 保留为**派生值**（takeover→`intervene`、observe→`observe`），`endings.json` 不改（G7） |
| 卫兵 | "集结 6 名卫兵"改走"收拢残兵"：`army.recoverRemnants`（06 已定义）或 `SquadMember` 注入把 `S11-rescue-guards` 收进 `army.s11.yellow_turban`；`requiredGuardCount` 不变（可读性阈值） |
| 编制 | 新 `armies`：`army.s11.yellow_turban`（roster 30 枪/20 盾）、`army.s11.han`（roster 30 枪/21 弓）；场景 placement 保留为"展开实体"，battle config 补 `roster`/`deployment`（P22/P23） |
| 跨场景 buff | `successEffects.s12DefenseBoost` 改写 `armyStates['army.s12.yellow_turban'].morale += 15` + `cityStates['city.s12_xiaquyang'].damageRatio -= 0.05`（走 `state.transaction` 或服务命令，不双写） |
| 规模 | 用 §4.7 的 `battle.scale`：`{total:116, onScreenCap:116, reinforce:'none'}`（保持现状语义，不缩兵） |
| 影响 | `S11S12Coordinator`（identity 判定、`_validateStart`）、`S03S14BattleCoordinator`（战果卡 identity）、`endings` 派生；**M6 的 joinBattle 已实现，属接线不改架构** |

### 4.4 S12（`task.s12.xiaquyangRescue`）— 量级：中

| 项 | 改法 |
|---|---|
| 身份 | 同 S11（观战分支 + optional 组：守门/密道/撤离） |
| 士气判据 | `preBattleRules.friendlyMoraleZero` 改读 `armyStates['army.s12.yellow_turban'].morale`；民心仅作为输入项（±5%，P20） |
| 救援费 | `costs` 从"玩家背包 `resource.food/herb`"改为"军团粮草 `FoodLedger.withdraw('army.s12.yellow_turban', {food:20, herb:10})`"；背包不足不再拦截，粮草不足才拦截 |
| 友军 | `conditionalAllies` 改为友军武装单位：`army.s12.bocai` / `army.s12.zhangLiang`（`kind:'army'`, `factionId: yellow_turban`），`storyPath` 只做门控，不再直接刷 placement |
| 守门 | 保留 60s 阶段；`gateEntityId` 走 `BuildingComponent`（已有），与 05 建筑战争效果接线 |
| 影响 | `S11S12Coordinator.resolveS12PreBattleMorale`（读 morale 来源）、`SceneGameplaySystemAssembler`（FoodLedger 命令已有）、`armyStates` 数据；不影响已完成模块 |

### 4.5 S13（`task.s13.jingshanBattle`）— 量级：大

| 项 | 改法 |
|---|---|
| 修数据（先做） | `battles/S13.json`：`attackerArmy.commanderHeroId` 改 `hero.zhang_liang`（或 `hero.zhang_bao`，按剧情存活）；`hero.sun_xia` 改 `factionId: han_government`、`unitId: unit.heavy`；`affectedCityId` 改 `city.s12_xiaquyang` 或新增 `city.s13_jingshan` |
| 斩将判定 | 任务目标由 `waveCleared{S13-sun-xia}` 改 `custom.event boss.defeated {bossId:'enemy.s13_sun_xia'}`（或在 `handleDeath` 里发 `boss.defeated`）；观战分支写 `story.s13.sunxiaEscaped` 并给出替代目标（"随残部撤离"），**不再依赖被 despawn 的组** |
| 规模 | 用 `battle.scale`：建议 `{total:600, onScreenCap:100, reinforce:'pool', bossAt:0.6}`（设计理由：终局会战需要压迫感与波次感；同屏 100 是可读性选择，不是性能） |
| 资源 | "介入消耗 粮12/药6/木10"改为 `FoodLedger` + 城池库存扣减（走 `city.transfer`/`army.supply.withdraw`），观战则不扣；不再扣玩家背包 |
| 亲卫/编制 | 黄巾残部补 `roster`；若走"玩家接管"则玩家亲卫按 P1d 上限展开（附 A4 修正） |
| 影响 | `S03S14BattleCoordinator._retirePersonalDuelGroup`（观战不再 despawn 或改为"存活离场"）、`S11S14SceneFlow._prepareS13Settlement`（资源扣减改服务）、`endings`（新增 `identityStats` 派生）；不改 05/06 架构 |

### 4.6 S14（`task.s14.finalCommit`）— 量级：小~中

| 项 | 改法 |
|---|---|
| 辎重账 | 马车 `cargo` 的 `food/herb` 在"清点"时转入 `FoodLedger`（`camp.s10.creek` 或玩家军团），`_readS13S14State` 改为读 ledger 快照（保留旧档兼容：cargo 为空时读原值） |
| 处置三选 | 接入 02 表：带走 → `convoy.assemble`（押运，损失表生效）；丢弃 → 按"败 50%"折算损失；拆解投石机 → 产出材料进背包 |
| 载具指令 | 投石机 `assembleCatapult` 后挂 02 载具指令（跟随/原地防御），攻城×2 走 05 建筑/城池伤害修正 |
| 结局输入 | `_projectEndingInput` 增读 `identityStats`（兼容 `battleModeStats`） |
| 影响 | `S11S14SceneFlow`（结算分支）、`endings.json`（新增可选输入，旧档走默认）；不动驾驶/操作链 |

### 4.7 通用能力（跨任务，建议先做）

| # | 能力 | 内容 | 量级 | 影响 |
|---|---|---|---|---|
| P0-1 | **势力/阵营归一** | `state.player.alignment` + `state.player.reputation`（P20）+ 汉方 id 统一 `han_government`（heroes 加别名表）；s02 §4.2 改为 `reputation.adjust` | 中 | 只改数据键 + 只读适配，不动服务 |
| P0-2 | **玩家根据地** | 二选一：①S09 `city.s09_guangzong_camp` 用 `city.setFaction('player')` 成为第一块根据地（P2 成立，军团按钮解锁）；②明确"层级一在 S09~S14 不开放"，军团按钮文案改为"尚无据点"。**推荐 ①**（否则整套层级一在主线上永远不可见） | 中（①） | `cityStates` 数据 + 剧情写值；不影响 P2 判定代码 |
| P0-3 | **主角绑定修正** | `companionRule.heroId` 改 `player`（或新增 `hero.player`，带 `stats.command`）；张角仅 S02 期临时主控 | 小 | 配置 + 1 处读取；亲卫数据归属修正 |
| P0-4 | **`battle.scale` 通用化** | 03/06 增 `battle.scale { total, onScreenCap, reinforce:'none'\|'wave'\|'pool', bossAt }`；S02 围剿 1000/100/击破 500 用它表达，S11/S12/S13 同样可用 | 中 | 新增可选字段，缺省 = 现状（零回归） |
| P0-5 | **身份→战果派生** | `identityStats { takeover, support, observe }`；`battleModeStats` 由身份派生写回 | 小 | 结局输入兼容，旧档不炸 |
| P1-1 | **军营链贯穿 S09+** | S10 迁营注册 camp；S11/S12 的城/营互为补给点；粮草条军营段有数 | 中 | `logistics.camps` 数据 + 2 处调用 |
| P1-2 | **战损出口** | S11 后加"征召处招募"（`city.recruit` 或 camp 路径）+ `army.regroup` 散兵招回；补 P1e 统兵池 | 中 | 新任务步骤（可选目标），不动主线必达 |
| P1-3 | **官勋成长** | S11 救张梁 → 官职 `rank.xiaowei`；S12 救张宝 → `rank.junhou`；写 `state.transaction`，亲卫上限随之增长 | 小 | 2 条事实 + 1 个写值命令 |
| P2-1 | **教程/自解释** | P11 教程冻结，不新增；用 `SupplyStatusBar` + 建造面板文案自解释（扎营 +50%、断粮档位） | 小 | UI 文案 |
| P2-2 | **生产/铁匠进主线** | S10 建"铁匠铺/工坊"两件（P18），S11 起可修装备/造箭（P16/P17 回收口） | 中 | 建筑定义 + 1 个交互入口 |

---

## 5. 分期与验收

| 批 | 内容 | 验收 |
|---|---|---|
| **P0（阻塞，先做）** | A1/A2 分叉 + A3 根据地 + A4 主角绑定 + B1/B2 身份迁移与观战分支 + G1/G2 数据修复 | S09 两分支都能进 S03；S11/S12 观战不再软锁；S13 观战能收束；结局输入不变 |
| **P1（适配）** | C1/C3 营地贯通 + B5 编制/`battle.scale` + B6 士气来源 + D1 粮草单一账 + E1/E2 辎重账 | 粮草条在 S10~S14 有数据；S11/S12 介入费从粮草扣；S14 清点进 ledger |
| **P2（内容增强）** | B8 收编卫兵 + P1-2 招募/补员 + P1-3 官勋 + P2-2 铁匠工坊 | 战损可恢复；亲卫上限随官职成长；装备可修 |

**零回归承诺**：以上全部以"新增可选字段/新增任务分支"落地；不配新字段时行为与现状一致
（`battle.scale` 缺省、`army.camp` 未调用、`logistics.camps` 空）。

---

## 6. 待拍板（3 条）

| # | 问题 | 建议 |
|---|---|---|
| ① | 玩家在 S09~S14 到底有没有"自己的城/营"？ | **有**：S09 广宗粥棚营地转玩家（或 S10 溪畔新营），否则层级一整层不可见 |
| ② | "不加入"分支是否真要写独立任务线？ | **短期不写独立线**：不加入 = 同一主线、不同编制（亲卫随行），差异只在体验与少量奖励；独立线留 S15+ |
| ③ | S13 决战规模 | **600 池 / 同屏 100 / 击破 60% 孙夏登场 / 斩将溃散**；同屏 100 是节奏选择（引擎 2000 不是约束） |

---

## 7. 附：证据索引

- 任务数据：`project/quests.json`（s09 [2366](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L2366)、s10 [3138](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3138)、s11 [3286](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3286)、s12 [3491](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3491)、s13 [3682](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3682)、s14 [3801](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/quests.json#L3801)）
- 触发器：`project/triggers.json`（`trg_s09_*` ~ `trg_s14_*` 共 41 条）
- 战役：`config/battles/S11.json` / `S12.json` / `S13.json`；救援：`config/rescues/S11.json` / `S12.json`
- 场景：`assets/scenes/S09.json` ~ `S14.json`（按 group 统计见 §1.3）
- 世界/城市/规则：`game.project.json`（`logistics` 607、`companionRule` 655、`worldLogic` 689、`cityStates` 975+）
- 代码：`systems/S09ClassSelectionFlow.js`、`S03S08SceneFlow.js`、`S10StoryFlow.js`、`S10ConstructionFlow.js`、`S11S12Coordinator.js`、`S03S14BattleCoordinator.js`、`S11S14SceneFlow.js`、`S02ArmyRescueFlow.js`
- 设计：`.trae/specs/military-supply-strategy/` 下 `s02-任务方案.md`、`decisions.md`、`03/05/06/07/09/10` 各文档

# S02 剧情改造 + S02-S14 任务补全计划

## Context

上一轮盘点确认：S09 的「饥民争斗」事件叙事上应发生在 S02（玩家被救后、被征召前），且任务定义只覆盖到 S02，S03-S14 共 11 个场景零任务零对话。用户指令：

1. S09 饥民事件整体迁移到 S02；玩家被救、苏醒对话后黄巾军人员离开，玩家接着处理饥民事件
2. S02 补全任务定义
3. 继续为 S03-S14 补全任务（本轮按「薄任务串接」深度：每场景 1 条 quest 定义挂接现有功能触发器节点，不新增对话文案）

**S02 新流程**：山道抉择（杀/救）→ 担架救援 → 苏醒对话 → **黄巾军一行离开（新增演出）** → **饥民事件（自 S09 迁入）** → 处理完毕后来使召见 → 传送 S09（入伍/职业/粮仓留在 S09 不动）。

**已勘察的关键事实**：
- 饥民事件链 = 对话 `dialogue.s09.refugeeConflict`（12 节点）+ 3 触发器（prepare/start/choice）+ 4 个 state.transaction 事实（prepare/start/donate/branch，含 delayedConsequences 硬line 35%逃亡与 silence 粮尽）+ 8 个 S09 场景放置 + 1 个 interact 绑定 + `S09RefugeeFlow.js`
- `cityStates[0]`（广宗粥棚营地）是 game.project.json **全局预置变量**（damageRatio 0.45、granary 0.6 天然满足 prepare 条件）——迁移后城市条件/捐粮写城市数据**零改动可保留**
- `story.s09.day.advance` / `story.s09.delayed.resolve` 无场景门——零改动
- 对话 id `dialogue.s09.refugeeConflict` 被 S09RefugeeFlow.js:26、SanguoSceneStateFlow.js:496、triggers、endings.json:17 引用——**id 保留不改**（避免动存档兼容链）
- blackboard 键 `s09RefugeeConflict` 同理保留（spawnWhen、endings.json 读它）
- QuestRuntime：objective 支持 `commit.fact`（监听 state.transaction）与 `custom.event`（自由 matcher）；`triggerSucceeded` 事件 payload 含 `triggerId`（TriggerSystem.js:1091）——S03-S14 的 quest objective 用 `custom.event` 挂 `triggerSucceeded`；accept 支持 `{type:'event',event:'sceneEnter',params:{sceneId}}`
- 场景内让单位离场：无现成触发器动作，需新增 `despawnPlacements`（项目级动作：triggerCatalog.actions 登记 + SceneTriggerActionProvider 实现 + triggerCatalog.json），内部调 `ScenePlacementRuntime.tombstonePlacement`（:238）

## 阶段 A：S09 饥民事件迁移 S02

**A1. `project/commands.json`**（4 事实，场景门与 checkpoint 场景字段 'S09'→'S02'）：
- `story.s09.refugee.prepare`（:1371 sceneId equals）→ 'S02'
- `story.s09.refugee.start`（:1421）→ 'S02'
- `story.s09.refugee.donate`（:1461 sceneId；:1447 checkpoint.sceneId）→ 'S02'
- `story.s09.refugee.branch`（variants 内 5 处 checkpoint.sceneId :1552/:1558/:1638/:1731 等）→ 'S02'
- definitionId/checkpointId **名字全部保留**（含 S09 前缀，存档兼容）

**A2. `project/triggers.json`**：
- 删除 `trg_s09_prepare_refugee_conflict`、`trg_s09_start_refugee_conflict`、`trg_s09_refugee_choice`
- 新增 `trg_s02_prepare_refugee_conflict`（when `sceneEnter{sceneId:'S02'}` → prepare 事务，once:false）
- 新增 `trg_s02_start_refugee_conflict`（when interact + cooldown:1 → start 事务 → dialogue.command start `dialogue.s09.refugeeConflict`）
- 新增 `trg_s02_refugee_choice`（when `dialogueChoice{id:'dialogue.s09.refugeeConflict'}` → branch 事务）

**A3. `assets/scenes/S02.json`**：
- 在 layer_placement 新增饥民营地 placements（自 S09.json :709-852 迁移，8 个）：placement id 改 `S02-refugee-*`，group 改 `S02-refugee-conflict`（scout 组 `S02-refugee-scout`），坐标改到 S02 废弃营地外围（约 x 640-900 / y 300-460 一带，避开物资堆与救援区），spawnWhen `s09RefugeeConflict.status exists` 不变，story-bread 物品同步迁
- layer_logic 新增绑定 `S02-binding-refugee-conflict`（triggerId=trg_s02_start_refugee_conflict、target=S02-refugee-one-armed、radius:96、prompt「{interact}与断臂饥民交谈」）

**A4. `assets/scenes/S09.json`**：删除 8 个 refugee placements、`S09-binding-refugee-conflict`、scout 组 placement、`S09-zone-refugees` 视觉区

**A5. `systems/S09RefugeeFlow.js` 参数化**：
- `REFUGEE_SCENE_ID = 'S02'`（饥民事件场景门；spawn group :58/:89 改 'S02-refugee-conflict'）
- `CITY_SCENE_ID = 'S09'`（updateCitySummary :224、prepareUnauthorizedHarvestSettlement :268 场景门保持 S09——擅自采集/城市摘要是 S09 粮仓玩法，不迁）
- SanguoSceneStateFlow.js、endings.json、game.project.json variables **不动**（键名/对话 id 未变）

## 阶段 B：黄巾军离开演出

**B1. 新增触发器动作 `despawnPlacements`**：
- `src/systems/TriggerCatalog.js`（或项目 triggerCatalog.json 的 actions 段）登记：`{action:'despawnPlacements', paramsSchema:{selector:{group}}}`
- `src/core/scene/SceneTriggerActionProvider.js`（:51-80 动作表）实现：按 selector 解析组内 placements → 逐个 `context.services.placements.tombstonePlacement(placementId, 'removed')` → 发布完成
- 参照 `spawnPlacements` 的现有实现结构

**B2. `project/triggers.json`**：
- 新增 `trg_s02_farewell`：when `dialogueEnd{id:'dialogue.s02.awakening'}` → do[`despawnPlacements{selector:{group:'S02-army'}}` + `showTip`「黄巾军一行朝粥棚方向离开了。废营外隐约传来争执声……」]
- 改造 `trg_s02_awakening_done`：移除 `task.command task.s02.summons`（召见任务时序后移），保留/改为 showTip 引导饥民事件 + `task.command task.s02.refugeeRelief start tracking:true`

## 阶段 C：S02 任务补全（`project/quests.json`）

- 新增 `task.s02.refugeeRelief`「饥民救济」（scenes:['S02']）：
  - objective1 `commit.fact` → `story.s09.refugee.start`「与断臂饥民交谈」
  - objective2 `commit.fact` → `story.s09.refugee.branch`「决断饥民去留」
- `task.s02.summons` 废营召见：accept 改 `{mode:'auto', when:{type:'questCompleted', questId:'task.s02.refugeeRelief'}}`（编译出 task.completed→task.start 触发器，替代原 awakening_done 手动 start）
- `task.s02.rescue` 不动

## 阶段 D：S09 任务补全（补上链条缺口）

新增 `task.s09.joinYellowTurban`「加入黄巾」（scenes:['S09']，accept auto sceneEnter S09）：
- objective1 `commit.fact` → `story.s09.enlist`「回应张角入伍之邀」
- objective2 `custom.event` → `{type:'classSelected'}`「选定职业方向」

## 阶段 E：S03-S14 任务补全（11 条，薄任务串接）

每条 quest：`accept:{mode:'auto', when:{type:'event',event:'sceneEnter',params:{sceneId:'S0X'}}}`，objective 用 `custom.event` 挂 `triggerSucceeded{triggerId}`（现有触发器成功即事实），全部 `scenes:['S0X']`：

| quest | 标题 | objectives（triggerSucceeded） |
|---|---|---|
| task.s03.yingchuanBattle | 颍川首战 | trg_s03_choose_battle_mode「选择参战方式」→ trg_s03_exit_s04「前往长社」 |
| task.s04.changsheDefense | 长社驰援 | trg_s04_start_bocai_rescue「启动波才救援」→ trg_s04_choose_yuzhou_route「确认豫州路线」 |
| task.s05.wanchengOutskirts | 宛城外围 | trg_s05_claim_pickaxe「领取矿镐」→ trg_s05_start_zhang_mancheng_rescue「张曼成救援」→ trg_s05_exit_s06「转进宛城」 |
| task.s06.wanchengSiege | 宛城围攻 | trg_s06_defense_choice「确定防御策略」→ trg_s06_complete_recall「响应信使召回」 |
| task.s07.xihuaDelay | 西华迟滞 | trg_s07_choose_battle_mode「组织迟滞作战」→ trg_s07_exit_s08「收兵下曲阳方向」 |
| task.s08.xihuaRetreat | 西华余部 | trg_s08_retreat_choice「乘撤运车撤离」→ trg_s08_complete_recall「完成召回」 |
| task.s10.guangchengCamp | 广城扎营 | trg_s10_acknowledge_temporary_camp「确认临时扎营」→ trg_s10_complete_relocation「完成迁营」→ trg_s10_exit_s11「出发广宗」 |
| task.s11.guangzongRescue | 广宗救援 | trg_s11_start_zhang_liang_rescue「启动张梁救援」→ trg_s11_west_gate_breakout（enter 类，改用其 triggerSucceeded）「西门突围」→ trg_s11_exit_s12「转进下曲阳」 |
| task.s12.xiaquyangRescue | 下曲阳突围 | trg_s12_start_zhang_bao_rescue「启动张宝救援」→ trg_s12_zhang_bao_evacuation「护送撤离」→ trg_s12_exit_final_route「奔赴最终决战」 |
| task.s13.jingshanBattle | 驹山决战 | trg_s13_choose_final_battle_mode「选定决战方式」→ trg_s13_exit_s14「前往结局营地」 |
| task.s14.finalCommit | 最后的选择 | trg_s14_open_cargo_transfer「清点辎重」→ trg_s14_commit_ending「了结此局」 |

（S09 由阶段 D 覆盖；S04 的 bocai_evacuation/enter 类触发器同样以 triggerSucceeded 为准——TriggerSystem 对任何成功执行的触发器都发布该事件）

## 阶段 F：验证

1. **单测**：`npx vitest run` 全量基线（s01FirstWolfPack/s01OvernightSleep/taskGraphWoodProgress/saveSystemRegression/QuestRuntime 相关）
2. **新增测试**：S02 饥民迁移的事实门测试（prepare/start/donate 在 currentSceneId='S02' 时通过、'S09' 时拒绝——参照既有 commands 校验测试模式）
3. **主线静态扫描**：`node scripts/scan-mainline-chain.mjs`（travel 目标/对话引用/任务图出边全量校验，须全绿）
4. **资产审计**：`node scripts/audit-assets.mjs`（若动了 assets.json）
5. **实机探针**（playwright headless）：新档走 S01→S02：救援→苏醒→确认士兵消失 + 饥民放置刷出（S02-refugee-*）→ interact 断臂饥民开对话 → 捐粮分支提交 → summons 任务自动开始 → 传送 S09 正常；S09 侧粮仓/哨兵/入伍不受影响

## 关键文件清单

| 文件 | 动作 |
|---|---|
| project/commands.json | 4 事实场景门+checkpoint 场景改 S02 |
| project/triggers.json | 删 3 个 s09 触发器，增 trg_s02_prepare/start/choice/farewell，改 awakening_done |
| project/quests.json | 增 task.s02.refugeeRelief + S03-S14 共 12 条，改 task.s02.summons accept |
| assets/scenes/S02.json | 增饥民 8 placements + 绑定 |
| assets/scenes/S09.json | 删饥民相关放置与绑定 |
| systems/S09RefugeeFlow.js | 场景门参数化（S02 饥民 / S09 城市） |
| src/systems/TriggerCatalog.js + triggerCatalog.json + SceneTriggerActionProvider.js | 新增 despawnPlacements 动作 |
| test/ | 新增迁移事实门测试 |

**风险与对策**：
- 旧档兼容：所有 definitionId/checkpointId/blackboard 键/对话 id 保留原名，仅场景门变化；旧档若饥民事件已完成（status 有值），进 S02 时放置照常刷出（已处理场景呈现）
- triggerSucceeded 追认问题（quest active 前发生的事件不计数）：accept 用 auto+sceneEnter，objective 在玩家动作前已 active；旧档玩家（已过 S03+）新任务会挂在 HUD 未完成——demo 开发期可重开档，接受
- despawnPlacements 是新动作：实现必须走 tombstonePlacement（进存档 tombstone 链），防止切场景后士兵复活

# S02 M3 规格说明书：扎营 + 官兵围剿战 + 操控张角（possession）

> 状态：待评审 · 2026-10-27
> 上游：设计稿 `.trae/rules/s02-rescue-campaign-design.md` 第四幕（已批准）
> 前置：M1 乞讨链（f51b3d0 已提交）、M2 军队路过+救援（工作树未提交，M3 不动它）

---

## 1. 目标

救援抵达营地、苏醒对话、farewell 之后：

1. **控制军队扎营**：军团特殊命令「扎营」首个剧情落地——全军移动到营地坐标、切原地防守、建造倒计时、完成生成篝火/帐篷装饰、提交 `story.s02.camp.laid`。
2. **官兵围剿**（卢植部先锋突袭，决策点①B：卢植压阵不出场、部将傅燮出战）：敌军分两波进场（前锋→主力+傅燮）。
3. **玩家操控张角**迎战（possession 切换，引擎级新能力）：主角退随军观战，军团指挥 M5 全套可用。
4. 胜利（waveCleared）→ 旁白 + `story.s02.raid.repeled` → possession 释放回主角（M4 行军段再切回张角）。
5. **打输分支**：张角 HP 归零拦截死亡弹窗 → 兵败溃退（回营地重整、波次重置可再战）。

## 2. 勘察结论（实施依据，已实证）

### 2.1 扎营原语现成
- `ARMY_CONSTRUCTION_DEFS` 已有 `{ key: 'camp', label: '扎营', buildTime: 4, footprint: 40 }`（ArmyCommandSystem.js:105）。
- `startConstruction(commandKey, worldPos, units)`：士兵环绕建造点 → moving（任一士兵到位）→ building（倒计时 4s）→ 完成回调 `onConstructionComplete(commandKey, pos, def)` 并压入 `constructions`（阻挡源）。
- 缺口：scenario 命令接线 + 完成回调生成装饰物 + 事实提交。**零引擎改动**。

### 2.2 官军内容有先例
- `enemy.s03_han_soldier`（颍川官军守军，factionId han_government，攻 9/防 4/血 72/速 58，imageId s03.unit.hanSoldier）+ 官军斥候（government_scout）——围剿兵直接复用数值模板，新建 S02 专属 id。
- BOSS 结构参考狼王 `enemy.s01_wolf_king`（isBoss + skills[] + telegraph.windupMs + lootTable）。
- **敌军不用 army kind**：army placement 会注入 SquadMemberComponent 被玩家招募指挥。围剿敌军用普通 soldier placement 组（S02-raid-wave1/wave2 组名）。

### 2.3 waveCleared 机制现成
- SanguoPlacementCoordinator.js:55：敌组全灭 → `triggerSystem.fire('waveCleared', { group })`；触发器 when.type=waveCleared + params.group。M1 的 trg_s02_village_cleared 同款。

### 2.4 possession 绑定面（核心新能力，全部实证）
| 绑定点 | 位置 | 作用 |
|--------|------|------|
| `scene.playerEntity` | SceneCombatActions 15 处攻击/技能引用全读它 | 攻击/技能来源实体 |
| `MovementSystem.setPlayerEntity(e)` | MovementSystem.js:102 | 输入目标 + **相机跟随**（camera.setTarget）二合一 |
| `CombatSystem.setPlayerEntity(e)` | CombatSystem.js:226 | checkNearbyEnemies 战斗态/伤害/拔刀标志 |
| `panelLayout.bindPlayer(e)` / `playerStatusHUD.setPlayer(e)` | ScenePlayerLifecycle._bindPlayer | HUD（血条等） |
| `context.player.entity` | ScenePlayerLifecycle | 稳定主角引用（存档/生命周期用） |
| `moveIntentRouter` | SceneGameplaySystemAssembler.js:760 | 驾驶席先例（不用，见设计决策） |

- 张角实体：`scene.entityFactory.createPlayer(...)` 可造第二个「玩家形」实体（stats/combat/inventory/equipment/movement/sprite/collision 全套）——DemoPlayerFactory 同款调用。**设计决策：交换 player 角色引用到张角玩家形实体**，不做 moveIntentRouter 路由 hack（那只解决移动，攻击/技能/HUD 仍逐处错）。

### 2.5 存档安全（唯一未决勘点）
玩家坐标存档路径 `.game.player.transform.x/y` 的 capture 点尚未定位（grep 两轮未命中）。**实施第一步**：定位 capture 点，确认读的是 `scene.playerEntity` 还是 `context.player.entity`：
- 若读 `scene.playerEntity` → capture 处改读 `context.player.entity`（possession 不污染存档）；
- 兜底：possession 期间该 capture 走主角（挂 `scene._possessionActive` 标记分流）。

## 3. 实施方案

### 3.1 M3-1 敌军内容（纯数据）
**library.json** enemies 新增：
- `enemy.s02_lu_vanguard` 官军前锋（数值复用 s03_han_soldier，level 2）
- `enemy.s02_lu_mainforce` 官军精锐（level 3，攻 11/防 5/血 90）
- `enemy.s02_lu_commander` 傅燮（BOSS：isBoss、level 5、血 160/攻 12/防 5、skills[横扫：近战圆范围]、telegraph.windupMs 900、lootTable[上好军械]，attackRange 90）

**S02.json** placements 新增：
- 装饰物：篝火/帐篷（kind 与现有装饰 placement 一致，spawnWhen storyState.s02.camp.laid gte 1——由扎营完成激活；另需触发器显式 _ensureSpawnedPlacement 支持运行中即时登场，参照狼王双保险模式）
- 围剿波：`S02-raid-vanguard` 组 6 兵（西/北缘）、`S02-raid-mainforce` 组 8 兵+傅燮（多点位）——**不在 placement 上配 spawnWhen**，由触发器 spawnPlacements 分时驱动（波次时序归触发器数据）

### 3.2 M3-2 army.camp 命令 + 扎营触发器链
**SanguoDomainCommandFacade**：路由 `army.camp {x, y}` → `s02ArmyRescueCoordinator.campArmy(params)`。

**S02ArmyRescueFlow（协调器）新增 `campArmy({x, y})`**：
1. 全军切 `hold` 姿态（扎营=原地防守语义）；
2. `system.startConstruction('camp', worldPos)`（局部→世界投影同 rescue goal 惯例）；
3. `system.onConstructionComplete` 回调：篝火/帐篷装饰物生成（_ensureSpawnedPlacement 双保险）+ `state.transaction` 提交 `story.s02.camp.laid` + showTip「营地扎立完成」。

**triggers.json**：
- 改造 `trg_s02_farewell`：do 增 `army.camp {x, y}`（营地坐标=救援目标点附近，620,398 军队抵达点内侧）；
- 新增 `trg_s02_camp_laid`（when state.transaction story.s02.camp.laid）→ 旁白（卢植部探马来袭预警）→ do `spawnPlacements {group:'S02-raid-vanguard'}` + 教程 s02.command.stance + `army.possess`。

### 3.3 M3-3 possession 引擎能力
**新 scenario 命令**：`army.possess` / `army.possess.release` → 协调器 `possessCommander()` / `releaseCommander()`。

**possessCommander()**（首次调用惰性创建张角实体）：
1. 张角实体 = `entityFactory.createPlayer`（id 'zhangjiao-possessed'，贴图 s09.character.zhangjiao，HP 120/攻 10/防 4/速 100，equipment 桃木杖 attack+2——攻击链需要 mainhand）；
2. 保存原绑定 `{playerEntity, movementPlayer, combatPlayer}`；交换：
   - `scene.playerEntity = zhangjiao`
   - `movementSystem.setPlayerEntity(zhangjiao)`（输入+相机）
   - `combatSystem.setPlayerEntity(zhangjiao)`
   - `playerStatusHUD.setPlayer(zhangjiao)`（血条切张角；背包/物品栏不动）
3. 主角观战：`scene.playerDowned = true`（操作禁用）+ 保持站立 idle（**不置 plotDowned**——那会触发担架渲染/碰撞跳过语义）；
4. 张角入场：位置=主角附近+闪光粒子提示「你已化身为大贤良师张角，指挥全军迎敌」。

**releaseCommander()**：逆序还原全部绑定 + 张角实体保留（隐藏/驻留营地）+ 主角 `playerDowned=false`。

**存档安全**：按 §2.5 勘点结论接线；`story.s02.possession.active` 事实入档——sceneEnter 触发器检查 `camp.laid && !raid.repeled` → 重新 possess（读档恢复）。

### 3.4 M3-4 围剿波次战
- `trg_s02_raid_wave1`：camp_laid 链内刷前锋 6 兵 + showTip「官兵前锋突袭营地！」；
- `trg_s02_raid_wave2`（waveCleared group S02-raid-vanguard）：刷主力 8 兵+傅燮 + showTip「敌将傅燮亲自压阵！」；
- `trg_s02_raid_repeled`（waveCleared group S02-raid-mainforce）：胜利旁白 → `story.s02.raid.repeled` → `army.possess.release` → task.s02.summons 推进；
- **commands.json** 事务：`story.s02.camp.laid` / `story.s02.raid.repeled` / `story.s02.raid.failed` / `story.s02.possession.active`（when exists 幂等）；
- **task.s02.summons 改造**（决策点⑦）：步骤=扎营 → 击退围剿 →（M4: 抵达 S09）。

### 3.5 M3-5 打输分支
张角 HP 归零：复用 M1 `playerSpecialFaint` 拦截模式（IrreversibleChoiceView 仅限 S02 剧情战斗上下文）→ **兵败溃退**（建议默认，用户可改）：
1. 旁白「兵败如山倒，张角当机立断鸣金收兵」；
2. 敌组 despawn + possession release + 张角/全军回满血 + 传送回营地中心；
3. `story.s02.raid.failed` 事实 + clearedGroups 移除两波组名（波次重置）；
4. showTip「整军再战」——camp.laid 后可重新触发 wave1（触发器门控改 raid.repeled not exists）。

### 3.6 M3-6 验证
- JSON 合法性校验（library/triggers/commands/S02.json）；
- 新增单测：possession 交换/还原（绑定点逐一断言）、campArmy 命令（constructionJob 启动+完成回调）、兵败拦截（不弹复活窗+波次重置）；
- 回归七套件：armyCommandSystem / questRuntimeCompilation / RealCanonicalColdRestartReplay / saveSystemRegression / PlacementSpawner.army / triggerTakeReward / armyDefaultStance；
- 实机冒烟：扎营倒计时/装饰/事实 → possession 切换手感 → 两波围剿 → 胜利释放；兵败重置链；性能观察（50 黄巾+14 官兵同屏）。

## 4. 决策点（已按设计稿/合理默认裁定，可改）

| # | 决策 | 取值 |
|---|------|------|
| ① | 敌将 | B 方案：傅燮出战、卢植仅旁白出镜（设计稿建议） |
| ② | possession 实现 | 交换 player 角色引用到张角玩家形实体（非 router hack） |
| ③ | 打输后果 | 兵败溃退回营地重整、波次重置可再战（设计稿未定，建议默认） |
| ④ | 胜利后 possession | M3 释放回主角（summons 对话），M4 行军段再切张角 |
| ⑤ | 敌军载体 | 普通 soldier placement 组（不用 army kind——避免被玩家招募） |

## 5. 涉及文件

| 文件 | 改动 |
|------|------|
| example/sanguo_zhangjiao/project/library.json | 官兵 soldier×2 + 傅燮 BOSS |
| example/sanguo_zhangjiao/assets/scenes/S02.json | 装饰物 + 两波围剿 placement |
| example/sanguo_zhangjiao/project/triggers.json | farewell 改造 + camp/raid 五触发器 + 恢复 possess |
| example/sanguo_zhangjiao/project/commands.json | 四事务 + task.s02.summons 步骤改造 |
| example/sanguo_zhangjiao/systems/S02ArmyRescueFlow.js | campArmy/possess/release/兵败拦截 |
| example/sanguo_zhangjiao/systems/SanguoDomainCommandFacade.js | army.camp / army.possess 路由 |
| 玩家存档 capture 点（勘定后） | possession 存档保护 |
| test/（新增） | possession + camp + 兵败单测 |

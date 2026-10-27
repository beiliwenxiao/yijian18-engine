# S02 M3 任务清单

> 规格：`spec.md` · 顺序执行，每步直接编辑文件落地

## M3-0 存档 capture 点勘定（阻塞项，先做）
- [x] 定位 `.game.player.transform` capture 代码（BaseGameSceneSetup.captureSaveState 读 this.playerEntity）
- [x] 确认读取引用并接线 possession 保护（改读 context.player.entity 稳定主角引用，附身不污染存档）

## M3-1 敌军内容（纯数据）
- [x] library.json：`enemy.s02_lu_vanguard` / `enemy.s02_lu_mainforce` / `enemy.s02_lu_commander` 傅燮 BOSS（isBoss/skills/telegraph 900/lootTable/attackRange 90）
- [x] S02.json：营地装饰 placement（篝火/军帐×2，spawnWhen camp.laid）+ `S02-raid-vanguard` 6 兵 + `S02-raid-mainforce` 8 兵+傅燮（spawnMode story，触发器驱动）

## M3-2 army.camp 命令 + 扎营链
- [x] S02ArmyRescueFlow.campArmy({x,y})：全军切 hold+驻点=营地中心 + startConstruction('camp') + onConstructionComplete（fire armyCampLaid + showTip）
- [x] SanguoDomainCommandFacade：`army.camp` 路由
- [x] triggers.json：trg_s02_farewell do 增 army.camp(590,368)；新增 trg_s02_camp_laid（事实+装饰+预警对话+战斗武装+刷 wave1+附身+教程 show）
- [x] commands.json：story.s02.camp.laid 事务（幂等）+ tutorials.json 新增 s02.command.stance

## M3-3 possession 引擎能力
- [x] S02ArmyRescueFlow.possessCommander/releaseCommander（惰性创建张角玩家形实体（实体级缓存复用）；layout.bindPlayer 总绑定交换 + melee 补绑；主角 plotDowned 观战（AI 免疫+碰撞跳过）；还原逆序）
- [x] SanguoDomainCommandFacade：`army.possess` / `army.possess.release` 路由
- [x] commands.json/triggers.json：trg_s02_possession_restore（sceneEnter + camp.laid && !raid.repeled → 重新 possess）

## M3-4 围剿波次战
- [x] triggers.json：trg_s02_raid_wave2（waveCleared vanguard → 刷主力+傅燮）、trg_s02_raid_repeled（waveCleared mainforce → 胜利旁白+事务+fight.clear+release+教程 complete）
- [x] commands.json：raid.wave2/raid.repeled 事务 + task.s02.summons 改造（扎营→击退围剿；旧 travel 传送链拆除）+ 三段旁白对话

## M3-5 打输分支
- [x] story.s02.raid.fight.prepare/clear 特殊昏迷武装（pendingDefeatResolution=specialFaint，兵败不弹复活窗）
- [x] trg_s02_raid_defeat（playerSpecialFaint → 兵败旁白 + army.raid.defeat + fight.clear + 8s 后两波倾巢重刷）
- [x] S02ArmyRescueFlow.handleRaidDefeat：两波敌组 tombstone（refreshAt 7s 到期释放）+ 全军/张角回满血 + 收拢营地中心
- [x] S01S02SceneFlow.resolveRespawnPosition：S02 camp.laid 时复活点=营地中军(590,368)

## M3-6 验证
- [x] JSON 七件合法性（library/triggers/commands/dialogues/quests/tutorials/S02）
- [x] 引用完整性校验（placement ref→定义库 / 触发器→对话·事务·教程 / lootTable→items）ALL REFS OK
- [x] 新增单测 test/s02ArmyPossession.test.js 11/11（campArmy×4 / possession×5 / 兵败×2）
- [x] 回归：armyCommandSystem 38 + saveSystemRegression 37 + PlacementSpawner.army + triggerTakeReward + armyDefaultStance（vitest 156/156）；questRuntimeCompilation 主目录全过（s02 契约更新为三步链）；RealCanonicalColdRestartReplay 10/10
- [x] escort 锚点核验：SceneArmyCommandFlow setCommanderProvider 动态读 scene.playerEntity——附身后军团自动跟随张角，零改动
- [ ] 实机冒烟（用户实机走链：扎营倒计时→附身→两波→胜利；兵败重置链；性能观察）

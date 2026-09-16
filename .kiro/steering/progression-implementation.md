---
inclusion: fileMatch
fileMatchPattern: "{src/{systems,core,ui}/**/*.js,editor/TaskGraphEditor.js}"
---

# 成长与引擎基础设施实施现状

记录 S1–S10 已落地的模块与必须遵循的约定。决策依据见 #[[file:progression-decisions.md]]，通用规则见 #[[file:progression-system.md]]。

## 已完成阶段

| 阶段 | 内容 | 位置 |
|---|---|---|
| S1 | 统一效果结算 | `src/systems/effects/` |
| S2 | 技能定义与执行分离 | `src/systems/ability/` |
| S3 | 统一成长图内核 | `src/systems/progression/` |
| S4 | 旧系统转发到内核 | `SkillTreeSystem` / `TalentSystem` |
| S5 | 暗黑式分支与技能形态 | `SkillDefinition.variants` + Demo 配置 |
| S6 | 45 节点天赋盘 | `example/sanguo_zhangjiao/config/` |
| S7 | 项目配置选主 | `ProgressionProfile` + `GameLoader` |
| S8 | 统一成长 UI | `src/ui/progression/` |
| S9 | 输入路由与原子检查点 | `src/core/input/`、`src/core/snapshot/` |
| S10 | 内容校验与场景通用能力 | `src/core/validation/`、`src/core/scene/` |

## 效果系统（S1）

全部成长、装备、状态、职业效果统一经 `EffectResolver` 结算，禁止各系统自行解释效果字段。

结算顺序固定：

```text
base + Σadd → ×(1 + ΣaddPercent) → ×Πmultiply → override → clampMin/clampMax
```

要点：

- 效果按 `entityId` 分来源存储，多角色天然隔离。
- `EffectSource.fromLegacy` 映射旧字段；未登记字段进入 `unmappedLegacy`，可用 `getRawLegacy()` 排查，不静默丢失。
- 未注入 `conditionEvaluator` 时，带条件效果默认不生效，避免误加成。
- 存在条件效果的实体不缓存结算结果；来源变化调用 `invalidate`。
- `explain()` 返回基线、最终值与每个来源贡献，是验证职业固定数值的唯一手段。
- `manaRegenBonus` 目标为 `manaRegen`，与现有 stats 字段一致，不要改成 `mpRegen`。

## 技能系统（S2、S5）

职责边界，不得混淆：

```text
SkillRegistry     技能是什么（只读定义）
成长系统           角色是否学会（产出 skill.unlock 效果）
EffectResolver    参数如何被强化（skill.modify 效果）
AbilitySystem     能否释放（解锁、冷却、消耗、距离、目标、施法）
CombatSystem      表现与伤害结算（作为执行器被调用）
```

约定：

- `CombatSystem.executeSkill(context)` 是执行器入口，不重复检查冷却与消耗。
- 效果目标命名：`skill.<skillId>.<param>`、`skill.<skillId>.cost.<res>`。
- 技能形态由 `rule.override` 效果指定 `skill.<skillId>.variant`。
- 形态先替换基线，强化再叠加。例如旋风斩基线 20，两级 +10% 得 24，而非先算基础 30 再换形态。
- `AbilitySystem.use()` 在执行器返回 `false` 或抛错时回滚消耗、冷却与施法状态。
- 时间源通过 `config.now` 注入，测试使用固定时钟。
- `requireUnlock: false` 用于尚未接入成长系统的场景。
- 场景快捷栏执行 canonical 技能时必须先走 `AbilitySystem`；只有 SkillRegistry 中不存在的 legacy 技能才回退旧 `CombatSystem.tryUseSkillAtPosition()`。`AbilitySystem` 已拥有消耗和冷却，执行器不得重复扣除。
- `SceneFramePipeline` 必须每帧调用 `AbilitySystem.update(deltaTime, entities)`，否则带 `castTime` 的技能会永久停留在施法状态。
- 位移能力仍遵循同一职责边界：`AbilitySystem` 唯一拥有高级位移的成长解锁、体力消耗、冷却、施法与失败回滚；`LocomotionSystem` 只把已批准命令委托给 `JumpSystem`、`FlightSystem`、`ClimbSystem` 执行，不重复扣费或判断成长节点。
- S01 普通跳是所有职业的 baseline，不需要成长解锁；职业 jump 节点只强化基础跳并作为用力跳、轻功、攀爬等高级位移前置。手柄 Y 必须通过 `SceneInputFlow` 的 canonical `jump` 动作进入同一执行链。
- 临时高度层由 `LayerComponent.acquireLayer/releaseLayer` 的 token 租约管理；Flight/Climb 只能释放自己持有的 token，禁止 `popLayer` 误删其他位移系统的层。

## 职业、库存与采集接线

- `ClassSystem` 的职业效果来源固定为 `class:<characterId>`；`selectClass`、`restoreClass`、`clearClass` 和 `syncClassSource` 必须维护同一稳定来源，禁止使用会随实体重建变化的临时 ID。
- `InventoryTransactionService.configureEffects({ effectResolver, getEntityId, baseResourceCapacity })` 是资源容量效果的统一入口；material/resource 的容量预检消费 `resourceCapacity`，不得在 Demo 另写职业容量分支。
- plain world item 拾取时，`ItemLifecycleService` 必须从 world item 与 `ItemProjectionComponent` 统一解析 `instanceId`，并只把定义字段、稳定 `imageId/assetId`、sprite 和 `durability/binding/charges/container` 可变状态写入库存；位置、placement 等世界字段不得进入库存。工具获得提示只能在库存、世界对象、checkpoint 和 state revision 全部提交后的 finalize 阶段显示，失败或命令排队阶段不得提前提示。
- `PickupSystem.onResult` 只负责失败反馈：`inventoryFull/resourceCapacityFull/insufficientCapacity` 必须显示明确的容量原因；成功提示仍由 `ItemLifecycleService` finalize 后的 `SceneItemGainedFlow` 发布，禁止在输入或 scheduled 阶段重复提示。范围拾取一次交互必须继续为范围内全部合法候选创建各自原子 `item.pickup` 命令；候选按玩家距离升序、稳定 groundId/实体 ID、原始序号排序，并以失败隔离的串行批次执行，保证结算与反馈顺序不受 placement/生成插入顺序、异步完成时机或物品类型影响。
- 普通拾取、主动丢弃、战利品、DeathDrop 与剧情发现统一经 `CommandGateway → LocalAuthorityAdapter → PostCommitNotificationBus` 发布 `item.picked`、`item.dropped`、`item.deathDropCreated` 或 `worldItem.revealed`；Trigger、教程、通知、音效、跳跃和星光都是 committed application event 的辅助消费者，失败不得回滚已经成立的业务事实，也不得以 `TriggerSystem.fire()/fireById()` 的 accepted 结果冒充提交成功。
- `ScenePlacementRuntime.spawn()` 的 `ok:true` 只表示调用完成；剧情发现必须同时确认 `errors.length===0`、`counts.total>0` 且目标位于本次 `entities`，再发布 reveal。`matchedPlacements` 只表示选择器命中，不能证明对象真实生成。restore/rebuild 只恢复表现，不发布新发现事件。
- 剧情事务已提交但 placement/reveal 暂时失败时，只允许在当前运行会话维护有界职责的 pending reveal/continuation 补偿，并使用稳定 operationId 退避重试；业务 Trigger 必须按已经成立的领域事实返回成功，不能因辅助 placement 或教程暂不可用而留下“状态已提交但入口因 activeWhen 关闭”的死路。补偿成功后再恢复被延后的教程/熟练度等辅助 continuation。pending reveal 不进入存档，冷启动或 restore 只按已提交 StoryState 静默重建对象，禁止把恢复对象重新播成“新发现”。
- 掉落跳跃只能通过 `SceneWorldItemEventPresenter.getRenderOffset()` 修改绘制偏移，禁止修改 plain item 的 `x/y` 或 ECS Transform，否则会污染拾取距离、点击、Y-sort 和存档。一次性星光复用 `ParticleSystem.emitBurst()` 的 `shape:'star'`，不创建持续 effectZone；同批多物品按 eventId 去重并错峰表现。
- `TutorialSystem.notify()` 只允许当前已显示教程消费 committed 信号，禁止事件在后台提前完成未来教程。教程只负责说明和完成反馈，不拥有剧情、库存、placement 或 StoryState。教程定义默认完成后按顺序推进；需要等待空间发现或领域提交的关卡必须声明 `autoAdvance:false`，并仅在后续领域事实与所需 placement 均成功成立后显式调用 `SceneTutorialFlow.showNext()`。
- `movementRule.mode:'anyMovement'` 表示当前教程显示后的一次真实 Transform 位移即完成；`SceneTutorialFlow` 用相邻帧坐标做基线，`epsilon` 仅用于过滤浮点抖动。按键被碰撞拦住、未产生坐标变化时不得完成；该模式不累计 `threshold`。
- 屏幕教程与普通事件必须串行：`SceneHintPresenter` 中 `owner:'tutorial'` 优先显示，普通 screen 提示进入有界 FIFO 队列；教程完成后再继续队列。普通队列项默认只允许等待 6 秒，超时直接作为陈旧表现淘汰，调用方可用 `queueTtlMs:null` 显式保留；队列超时、同 owner 替换、被教程抢占、容量淘汰或 scene dispose 都不得调用 `onHidden`。普通 screen 可声明 `onHidden`，只在其真正显示后通过自动或显式关闭时安全回调。叙事动机与操作教学必须用该回调串行，且只有领域状态与必要 placement 均成功成立后才可展示教学；回调属于表现层，不拥有或回滚已提交业务事实。
- S01 砍柴教程只在 `berriesGathered` 已提交、`S01-wood` placement 成功且篝火燃料倒计时已开始后显示；先以普通 screen 说明“燃料只够 100 秒，需要砍柴添火”，screen 真正关闭后才显示操作教学。`woodGathered` 必须在本次采集结算完成且玩家背包实际拥有至少 3 份 `resource.wood` 后提交，提交成功才提示通过 `{interact}` 返回火堆添柴，容量不足导致只接收 1–2 份时不得提前推进。S01 的工具拾取、野果/木材/狼皮采集、添柴、首狼出现和敌人死亡统一走“已提交领域事实 → application event → `fireCoordinated()` → `game.project.json` 可见 Trigger → `s01Survival` 稳定 action”；阈值未满足必须返回成功 no-op，禁止触发 Bridge 重试。首只野狼不得由采集进度或帧循环直接触发：第三次 `story.s01.refuelCampfire` committed event 才提交 `firstWolfSpotted`，故障存档只能由显式 `s01.firstWolfRecoveryRequested` 事件补交且不得再次扣木材；`update()` 只按已提交事实恢复 placement/AI。开场以 `TimeSystem` 的 `lateNight` 与合法天气 `heavyFog` 表现深夜；S01 coordinator 通过有所有权的 `setPaused(true)` 阻止自动推进，显式 `setTimePeriod()` 仍可改期，离开 S01 时只释放自己拥有的暂停。第三次成功添柴后保持当前时间和天气，从火堆外围生成单只教学狼；生成后必须激活 aggressive AI、锁定玩家并主动靠近攻击。教学狼通过首狼 placement 的完整 `stats` override 独立控制为约 3–4 次基础攻击可击杀。只有通用尸体及其 `resourceNode` 已在实际死亡位置成立，才允许发布 `enemy.killed` 并由可见 Trigger 提交 `firstWolfKilled`，随后提示通过 `{harvest}` 剥皮；尸体一次产出两份狼皮，工具有效性仍由 GatheringSystem 和 `story.s01.wolfSkinned` 双重校验。后续顺序固定为“剥皮 → 烤制狼肉 → 原子消耗两份狼皮制作狼皮背心和狼皮护腕 → 搭建庇护所 → 过夜 → 狼群追杀 → 跳石过河 → 攀藤逃往 S02”，不再制作小背包。过夜事务将 `pursuit` 原子初始化为 active、3 只可生成狼；追逐生成复用 `ScenePlacementRuntime`，每只活狼必须经 `AISystem` 设为 aggressive 并锁定玩家。杀 1 只追逐狼增加 2 只可生成狼，最多 20 只，但击杀数量不得成为过河或攀藤前置；进入/读档及帧内有界补偿必须恢复缺失 placement 与 AI，辅助失败不回滚已提交 pursuit 事实。S01 完成事务关闭 pursuit，并复用 `ClimbSystem` 与 canonical 场景旅行链进入 S02。只有 `overnightCompleted` 才允许把 S01 切换为 `morning` 与 `clear`。
- 普通死亡由 `PlayerDeathCountdown` 管理固定 5 秒等待和显式复活确认；倒计时结束后若共享 `IrreversibleChoiceView` 尚未就绪，必须保持死亡与世界操作锁定并逐帧重试展示，不得自动提交死亡事务。玩家确认后才通过既有权威命令原子结算资源损失、单一 DeathDrop 与 checkpoint；非延期结果才立即调用 `CombatSystem.revivePlayer()`，标记 `deferRespawn` 的结果必须保持待复活状态，不得提前写回生命、法力或位置。特殊昏迷仍走独立安全点流程。
- `PlayerSoulRespawn` 拥有普通死亡延期复活的业务倒计时：玩家进入 `isSoulState` 后只允许移动，进入火堆 `approachRadius` 才开始本次死亡独立的等待；《三国张角传》当前配置为 150px 范围内连续等待 20 秒，不是所有火堆共享相位的全局复活波次。完成后才调用延期复活提交并在火堆旁恢复；无火堆场景按既有 fallback 在死亡位置计时并回出生点。`PlayerDeathCountdown` 与 `PlayerSoulRespawn` 都必须注册到 `GameSceneRuntime` 的 `FramePhase.AFTER_SCENE`；分阶段正式帧管线不会执行仅挂在 legacy `sceneRuntime.onUpdate()` 的回调。
- 灵魂状态必须立即退出真实 `CombatSystem`，`updateCombatState()` 检测 `player.isSoulState` 后退出并直接返回，禁止因附近敌人重新进入战斗。`PlayerSoulRespawn` 通过 `onCountdown(seconds,{durationSeconds,approachRadius,remainingSeconds})` 只投影表现数据；`SceneCampfireService` 复用现有世界 Y-sort render item 绘制范围圈、虚线边界、进度弧和倒计时，不创建第二计时器、第二 Canvas 层或业务状态；范围圈、边界和进度弧统一用 `radiusY = radius * 0.6` 的 2.5D 椭圆投影，业务 `approachRadius` 与距离判定仍保持圆形世界范围。屏幕战斗徽章以 `player.isSoulState` 为优先事实，显示“灵魂状态”且不得读取或显示战斗退出倒计时。
- `SceneCorpseRuntime` 在敌人首次致死时、击杀剧情事件发布前，将原敌人实例在实际死亡位置转换为非战斗尸体：必须注销 AI、移出 `SceneEntityStore.enemies`，但保留在 `all` 和稳定 ID 索引中；尸体不得被 `EntityLifecycleSystem` 当作普通死亡实体删除，也不得继续显示名字、血条或参与攻击/碰撞。所有敌人默认保留尸体，原掉落仍在同一位置走 ItemLifecycle；具体怪物可通过定义中的 `corpse.resourceNodeRef` 复用 ResourceNode/GatheringSystem 提供剥皮等采集。尸体 placement 状态保存 `kind:'corpse'`、实际位置和资源节点状态，恢复时先重建敌人草稿再转换尸体；禁止用固定出生点尸体 placement 模拟追击怪物死亡。尸体 2D 表现可由内容定义的 `corpse.presentation` 配置 `rotationDegrees/offsetX/offsetY/alpha/sortYOffset`：素材本身已经横卧时使用 `rotationDegrees:0`，`sortYOffset` 只调整 Y-sort 深度基线，不修改业务 Transform、采集位置或存档坐标。
- `ResourceNodeComponent` 的刷新必须显式声明 `refreshMode:'none'|'timed'`；Canonical ResourceNode Schema 同时仍要求非负整数 `refreshDays`，不刷新节点固定写 `refreshDays:0`，实时刷新节点也必须保留该兼容字段。`refreshMode` 才是运行时刷新语义权威，旧 `refreshDays` 绝不隐式转为实时刷新。实时刷新仅在耗尽节点的既有实体帧遍历中累计 `refreshElapsedSeconds`，到期恢复数量并将运行态写入 `ScenePlacementRuntime`，禁止为每个节点创建计时器或第二次实体遍历。资源数量 `remaining/maxRemaining` 是只读世界表现，编辑器只写静态定义或 placement override，不写耗尽/计时运行态。
- `SceneCampfireService` 的燃料为可存档运行态：全屏黑暗只读取 `TimeSystem.darknessOpacity`；该服务仅在同一 atmosphere 层合成时间色调/黑暗并挖出玩家与点燃火堆的透光区，天气只绘制粒子与雾团，不叠加全屏透明度。燃料倒计时只能在既有 `update(deltaTime)` 内推进，耗尽时调用既有 extinguish。添柴必须先完成库存扣除与 `campfireRefuelCount` 增量的同一 canonical 事务，再调用已预检的 `addFuelUnits()`；第三次成功添柴后直接提交独立的 `firstWolfSpotted` 事实并生成外围教学狼，不得提交天气等待事实或改变当前天气。首狼生成失败不回滚已经成立的添柴事实，只进入有界 placement continuation；已有 `campfireRefuelCount>=3` 且首狼未出现的故障存档必须允许从添柴入口补偿，且不得再次扣木材。`wolfWeatherCountdownStarted/wolfWeatherCleared` 仅作为旧快照兼容字段保留，不再驱动流程。燃料容量热重配只允许按新上限截顶既有 `remainingSeconds`，不得因 `maxUnits` 改变重置或复制燃料。燃料文本即使火焰图片未加载也必须照常绘制。火堆燃尽或主动熄灭后必须停止火焰发射器，但为已点燃过的火堆保留独立低频闪烁余烬粒子；余烬只属表现层。燃料启用时，未点燃状态只有 `getFuelSnapshot().units > 0` 才允许 `ignite()`，重燃后自动恢复燃料倒计时；S01 熄灭时同一交互先添柴，再次交互重燃，不得重复扣除木材。
- `LocalAuthorityAdapter` 构造 revision prepare 拒绝结果时，只能写入实际存在的 `stateId/current/expected`；`stateRevisionBusy` 没有 `expected`，禁止把 `undefined` 放入 `CommandResult.error`，否则普通并发拒绝会被错误升级为 CommandResult JSON 契约失败。
- S01 `story.s01.findAxe` 只提交 `axeDropped:true`；`story.s01.axeFound` 与 `story.s01.skinningKnifeFound` 分别只由破旧斧头、旧剥皮刀的 committed `item.picked` 派生。两者都成立后才能提交聚合事实 `initialToolsPicked:true`、完成 `s01.pickup` 并生成野果；`berriesGathered` 必须以该聚合事实为前置，木材与砍柴教学只能在 `berriesGathered:true` 后出现。不得把“落地/发现”“单件拾取”和“双工具均已拾取”合并为同一字段。
- `GatheringSystem` 区分 `owner` 与 `actor`：库存、工具和职业效果属于 owner，距离、移动中断和实际采集主体属于 actor。玩家本人采集时两者相同，傀儡采集时不得把产物写入傀儡。采集时长固定为 `max(0.1, effectDuration / toolGatherSpeed / (owner.StatsComponent.speed / 100))`；工具缺失或非法速度回退 `1`，角色速度缺失或非法回退 `100`。
- 工具维修只能通过权威 `item.repair` 命令，以 `(itemId, instanceId)` 精确定位独立实例，禁止按定义 ID 批量或模糊修复。服务必须先预检耐久和全部材料，再原子扣料、恢复耐久、创建 checkpoint、提交 state revision，全部成功后才能发布 `item.repair.committed` / `item.repaired`；任一步失败必须还原材料与耐久且不得显示成功提示。`gatherSpeed`、修复材料和功能说明属于只读定义，只有 `durability` 属于工具实例运行状态。
- `GatheringSystem` 只发出采集业务事件；`GatheringProgressPresenter` 是只读世界空间表现，started/progress 按实际 actor 的 Transform/Sprite 在头顶绘制，completed/interrupted 必须清理。其他短时世界动作可复用同一 Presenter，但必须传独立 `owner`，进度只清理自己的通道，业务计时与事务仍由动作协调器拥有；禁止用全局文字提示逐帧显示百分比，也禁止 Presenter 持有库存、节点或采集业务状态。
- 场景策略通过 `GatheringSystem.setSettlementPolicy()` 参与 `prepare → inventory/node/tool commit → policy commit`；策略前置失败必须零修改，策略提交失败必须回滚库存、节点、工具和策略状态并释放内部 operationId。
- 采集成功 operationId 由 `GatheringSystem` 持久化为有界幂等记录；重放不得再次增加库存、扣节点/工具、触发风险或应用场景政策。
- `GatheringPuppetSystem` 只管理 charge、傀儡生命周期和反噬，产物仍委托 `GatheringSystem`；恢复 active session 时不再次扣 charge，跨 Region 暂存/恢复必须同时保存 `gatheringState` 与 `puppetState`。
- `ProficiencySystem` 是采集/营建熟练度的通用状态权威，稳定 API 为 `gainExperience({ characterId, type, amount, operationId })`、`getState(characterId, type?)`、`serialize()`、`validateSerialized()`、`deserialize()`。熟练度不消费成长点；配置阈值必须从 0 开始严格递增，`maxLevel` 等于阈值数量。
- 熟练度写入必须先完整校验，再提交角色状态和有界 operationId 记录，最后发出 `experienceGained/levelUp`；同 operationId 同载荷返回 `idempotent: true`，不同载荷返回 `operationConflict`。`deserialize()` 失败不得改动既有角色状态或幂等记录。

## 成长图内核（S3、S4）

四类成长共用一套内核：

```text
classSkill     技能树        pointPool: skill
classTalent    职业天赋树    pointPool: talent
unitTalent     兵种天赋树    pointPool: unit
passiveBoard   天赋盘        pointPool: passive，requireConnected: true
```

强制约定：

- `NodeDefinition` 禁止包含 `currentRank`、`isLearned`、`isUnlocked`；角色状态只存 `ProgressionState`。
- `ProgressionGraphSystem` 构造器必须同时初始化 `states`、`ledgers`、`pointGrantOperations` 三份运行态容器；`setProfile/getLedger/deserializeCharacter` 均依赖 `ledgers`。Demo 不得直接探测这些可缺失内部字段，角色成长存在性应通过稳定公开 API 判断。
- 分配流程：`previewAllocate` 只读校验 → 扣点 → 写等级 → 同步效果；任一步失败不产生半成品状态。
- `deallocateNode` 先在 `clone()` 草稿上撤销，用 `checkNoOrphans` 检查后才提交，防止后续节点悬空。
- 天赋盘新节点必须与起点或已分配节点相邻；起点视为天然可达，不需先花点。
- `getSpentPoints` 统计**节点等级数**，不是消耗点数。`gates.spentInGraph` 同样基于等级数。重要节点消耗 2 点但只算 1 级。
- 存档按 `graphId` 分命名空间；禁用某图不删除其状态。
- 版本不一致时 `deserializeCharacter` 返回 `versionMismatch` 且不改运行状态。

旧系统已转发到内核：

- `SkillTreeSystem.learnSkill` / `TalentSystem.learnTalent` 内部调用 `LegacyProgressionAdapter`。
- 节点上的 `currentLevel` / `isLearned` 降级为**当前查询角色的只读投影**，由 `projectCharacterState` 刷新，仅供尚未迁移的 `SkillTreePanel` / `TalentPanel` 使用。真实状态在 `ProgressionState`。
- `SkillTree`、`SkillTreeNode`、`TalentTree`、`TalentNode` 四个类未改动，其单元测试仍有效。
- 硬编码节点可用 `LegacyTreeConverter` 导出为图配置 JSON。

## 项目配置（S7）

`game.project.json` 的 `progression` 段驱动 `ProgressionProfile`：

- 四个预设：`classicRpg`、`arpg`（默认）、`poeLike`、`roguelite`。
- 主结构必须在 `enabled` 内，否则回退到 `enabled` 首项。
- 未启用的图分配时返回 `AllocationReject.GRAPH_DISABLED`，但**不删除存档状态**。
- `pointPools` 配置为共享池名时生成 `PointLedger` 别名；`canAfford` 会合并同物理池消耗，避免超支。
- 未设置 Profile 时全部图可用，保持向后兼容。

## 统一成长 UI（S8）

- `ProgressionViewModel` 是 UI 与成长系统之间的唯一通道；UI 不得直接改状态或点数。
- 页签顺序来自 `profile.getTabOrder()`，主结构在首位并标 `★`。
- 天赋盘必须经 `GraphViewport.cull()` 裁剪；裁剪结果按视口状态缓存，状态未变返回同一引用。
- 连线只要一端可见就绘制，否则视口边界会断线。
- 移动端 `requireConfirm`，首次点击只选中并提示，防止误耗点数。
- 面板内任何点击都被消费，避免穿透到游戏世界。
- 新面板不替换旧 `SkillTreePanel` / `TalentPanel`；两者通过节点投影并存。
- `CityStateSummaryPanel` 只接收调用方生成的不可变快照并绘制，禁止持有 Blackboard 或直接修改 City/Story/Reputation；具体游戏负责决定显示场景和把领域状态投影为摘要。
- 成长节点详情通过 `EffectResolver.explain()` 展示已提交数值效果的稳定 `sourceId`，UI 不自行推导或重复结算效果。

## 输入路由（S9）

`InputManager` 继续采集设备状态，`InputActionRouter` 负责分发。优先级固化为数据：

```text
模态UI → 面板UI → 瞄准 → Ctrl轻功 → Shift投掷 → 拾取 → 技能 → 攻击 → 右键移动
```

这取代了「靠调用顺序保证拾取先于攻击」的旧做法，顺序不再依赖代码行位置。

按键与修饰键约束内置在 `HANDLER_CONSTRAINTS`，接线时无需手写 `canHandle`：

```text
FLIGHT   左键 + 需要 Ctrl
THROW    左键 + 需要 Shift + 禁止 Ctrl
PICKUP   左键 + 禁止 Ctrl/Shift
ATTACK   左键 + 禁止 Ctrl/Shift
MOVE     右键
```

要点：

- `buttons` 只作用于指针事件，键盘与虚拟按钮不受影响，因此 E 键仍能进入 PICKUP。
- `constraint: null` 取消内置约束，传对象可覆盖；用 `hasOwnProperty` 区分「显式 null」与「未传」。
- `InputEvent.consume()` 只能成功一次，重复调用返回 `false`。
- 指针事件被攻击之前的处理者消费时，自动调用 `markMouseClickHandled()`，桥接尚未迁移的 `MeleeAttackSystem`。攻击与移动消费时不标记。
- `enqueueInteract()` 让 E 键、移动端交互/采集按钮、触屏和手柄 A/X 产生完全相同的 canonical 交互事件；PC 无 Ctrl/Shift 的左键也必须进入同一拾取/采集后备链路。资源采集只在前序空间 Trigger、NPC 和世界拾取均未消费时由同一事件回退到 `harvestByFacing()`，不得绑定独立 F 键或由任一平台按钮直调采集系统。没有可交互的物品或资源时才允许左键继续进入攻击处理。
- `SceneInputFlow.onModalInput({ inputManager, gamepad })` 在弹窗和世界输入之前执行；职业确认等场景模态必须通过该入口统一消费键鼠、触屏和手柄输入，不能在场景 update 末尾再建第二条输入路径。
- 正式 Demo 的教程表现只允许走场景 `SceneHintPresenter`；宿主 `setupSceneCallbacks()` 不得再次注册 `TutorialSystem.onShow/onHide`，也不得保留带“上一步/下一步/完成”按钮的第二套 DOM 教程面板。保留的 DOM `tips-panel` 只是 SceneHintPresenter 的渲染出口，必须调用 `InputHints.formatHtml()`，禁止把 `{move}`、`{interact}` 等 token 原样显示。
- `describeLastFrame()` 输出每个事件的消费者，排查争抢不用加日志。
- `BaseGameScene.isPlayerActionLocked()` 只表示所有世界动作共同拒绝的硬锁：死亡、`isSoulState`、`PlayerDeathCountdown.pending`、`PlayerSoulRespawn.pending` 和活动采集会话；不得把 `CombatSystem.isInCombat()` 放入全局硬锁。战斗中的动作资格必须逐动作表达：基础攻击走 `canPerformBasicAttack()`，采集走 `canPerformPlayerAction('gather')` 单独拒绝战斗态，普通跳跃不因战斗状态被拒绝。这样键鼠、触屏和手柄继续共用同一准入，不为 RT 或 jump 增加设备特例。
- `item.use` 必须同时提供 UI 早期反馈与服务层权威准入：`BackpackPanel/InventoryPanel` 可通过 `canUseItem` 阻止无效点击，但 `ItemLifecycleService._prepareUse()` 必须在读取物品、创建回滚快照以及修改库存/Stats 之前再次调用注入的 `canUseItem(actor,command)`；灵魂或死亡状态返回 `itemUseBlocked`（或注入的稳定 code）且零修改。禁止只做 UI 限制，因为脚本和 `CommandGateway` 可以绕过面板。

## 原子检查点（S9）

`SnapshotManager` 参与者提供 `snapshot` / `validate` / `restore`。恢复严格分两段：

```text
1. migrate → validate 全部参与者   任一失败即放弃，运行状态零改动
2. capture 回滚快照 → 依次 restore  某个失败则回滚已写入的部分
```

要点：

- `capture()` 一次遍历全部参与者，避免不同系统状态错位。
- provider 的 `restore()` 可能在返回失败前已经部分写入；回滚集合必须包含“当前失败 provider”并按参与者逆序恢复，不能只回滚此前返回成功的 provider。
- 参与者错误自动加段落前缀，如 `data.progression.value`。
- 缺少迁移器时返回 `missingMigration`，不静默失败；有 32 次循环保护。
- 存档 JSON 损坏时返回 `invalidJson`，**原样保留存档**，不删不覆盖。
- `SaveGameService` 基于 `SnapshotManager + LocalStorageAdapter` 提供命名空间化存档；业务场景只注入 `capture/validate/restore`，不得绕过原子恢复直接逐段写状态。`inspect(index)` / `inspectAuto(index)` 只执行读取、迁移与校验，不调用 restore，供跨 Region 存档在正式恢复前准备目标运行时。
- Trigger 快照的跨会话内容身份只能使用归一化执行语义生成的 `definitionDigest`，不得使用 `GameLoader` 的会话装配 `definitionRevision` 代替；operation fingerprint 必须绑定稳定的单 Trigger 定义摘要。同定义跨会话 revision 变化允许恢复，定义摘要或 fingerprint 不匹配必须在 `GameLoader.validateSerialized()` / provider `validate` 阶段拒绝并保持零修改；旧 Trigger snapshot schema 不补写当前摘要、不静默迁移。
- 存档位固定分为 `autosave-1`、`autosave-2`、`autosave-3` 三个轮换自动位与最多 100 个 `slot-1` 至 `slot-100` 手动位。自动保存只能调用 `saveAuto()`：优先填充空自动位，三个均存在时覆盖 `createdAt` 最早的一位；手动保存只能调用 `save(index)`，两者不得互相覆盖。
- 张角 Demo 每 15 分钟、完成地图区块传送、以及内容触发器的 `autoSave` 动作都会请求自动保存。保存开始/成功/失败均通过 `NotificationSystem` 与菜单状态栏反馈；场景层只经 `BaseGameScene.requestAutoSave()` 请求，由宿主注入实际服务并用单一 in-flight Promise 防止并发选中同一自动位。
- 张角 Demo 在 Vite 开发服务器下还必须把成功快照镜像到 `example/sanguo_zhangjiao/saves/{autosave-1|autosave-2|autosave-3|slot-N}/snapshot.json`，并将画面缩略图以二进制 `thumbnail.jpg` 同目录保存；JSON 用 `meta.previewFile` 引用图片，不重复内嵌 base64。浏览器 localStorage 仍是运行时同步读档缓存，文件写入失败必须向用户明确提示。
- `ProgressManager` 未废弃，可继续作为旧路径；新代码用 `SnapshotManager` + `LocalStorageAdapter`。
- `BaseGameScene.restoreSaveState()` 只有在输入快照校验通过且回滚快照捕获成功后，才允许用 `SceneHintPresenter.clearForRestore()` 与 `SceneItemGainedFlow.cancel()` 无回调清空旧表现；禁止触发陈旧 `onHidden` 推进剧情。`TutorialSystem.loadProgress()` 只替换完成/信号/移动事实并静默清空旧活动步骤，全部领域和场景状态恢复成功后再用 `restorePresentation()` 重投影合法的 `currentTutorialId/currentStepIndex`；S01 缺少合法活动教程时只能按已提交 `StoryState` 派生当前目标，不得重放 Trigger。场景快照同时保存 `TimeSystem` 与 `WeatherSystem` 状态；读档的 inspect、目标 Region 准备和 restore 必须先等待 `_worldRuntimeReadyPromise`，只有 `configureWorldRuntimeFromLoad()` 已成功创建两套运行时后该 promise 才能 resolve；时间快照必须先经 `validateSerialized()` 校验，再写入运行态。S01 恢复合法状态时保留 `elapsed` 和天气，只重建自身暂停所有权并阻止下一帧默认深夜覆盖，无对应快照时才按剧情阶段投影 lateNight/heavyFog 或 morning/clear。
- 限时救援使用 `performance.now()` 一类会在页面重启后归零的单调时钟，active 快照不得只持久化绝对 `startedAt/deadline`。`RescueSystem.serialize()` 必须保存捕获时的 `remaining`，`deserialize()` 必须以新会话单调时钟重建 `startedAt/deadline`；这样读档继续消耗保存前已过去的时间，又不会因时钟纪元变化重置完整时限或立即误判超时。

## 内容校验（S10）

`ContentValidator` 在 `GameLoader` 修改运行状态之前拦截错误配置。

要点：

- 所有错误必须能定位字段路径；JSON 语法错误还要给出行列（`locateJsonError` 优先用 position 反算）。
- `CanonicalCandidatePipeline` 固定执行 `read → parse(source/line/column) → defaults clone → schema → reference → businessRule → canonicalize`；`ContentValidator` 用 `hasOwnProperty` 区分真正缺失与显式 `null/undefined`，只对真正缺失应用 schema default。schema/reference/business-rule 必须收集全部可独立错误并统一返回 `phase/source/category/path/line/column/fallback`；失败返回最近成功状态，空白模板固定 `canonical:false/saveable:false/hasProjectContent:false`。`canonicalize` 不修改输入，不重排数组，不删除字段或 unknown-but-allowed 数据。
- `loadCandidate` 保留兼容入口并实现「校验通过才替换」，失败时返回当前值，最近一次有效状态保持可运行。
- `canonicalize` 按 Schema 字段声明顺序重排，其余键名排序，保证 `stringify → parse → stringify` 文本一致。
- 内置成长 Schema：`effect`、`skill`、`progressionNode`、`progressionGraph`、`progressionConfig`。
- Canonical Schema 位于 `src/data/schema/`，统一使用 `schemaVersion`，当前覆盖 Unit、Hero、Formation、Army、ResourceNode、Inventory、City、BattleResult、Checkpoint 和 GameProject；数量字段必须是非负整数，损毁比例限制为 `[0,1]`。
- `library.items[].capabilities` 的 canonical 元素必须是 `{id}` 或 `{capabilityId}` 对象，不能因运行时 `normalizeCapabilities()` 兼容字符串而在项目 JSON 中写字符串；`ResourceNode.resourceType` 只允许 `wood/iron/food/herb/stone`，野果、肉类等具体语义通过稳定 `itemId/nodeId` 区分，不扩展基础资源枚举。
- `createContentValidator()` 的默认 `supportedVersion` 必须跟随 `CANONICAL_SCHEMA_VERSION`；否则 GameLoader 会把同一个校验器注入 LocalMock，并在 BattleResult v2 链路中错误拒绝 Army/Result v2。调用方仍可显式传入更低版本用于兼容性拒绝测试。
- `GameLoader` 先执行 GameProject、Asset Manifest、成长配置、触发器 ID 和内容库 ID 的完整预检，再替换 project/registries；JSON 文件按文本解析，以保留语法错误行列。失败抛出带 `errors` 的 `ContentValidationError`，旧运行对象不被配置错误替换。
- 战斗集成统一从 `project.integration.battle.resultSource` 选择单一来源；当前正式可用来源为 `localMock`，通过 `BattleClient` 暴露 `createBattle/intervene/reportBattleResult`，重复 requestId 使用 `IdempotencyStore` 返回首次响应，同 ID 不同载荷拒绝。
- Asset Manifest 位于游戏 `assets/manifests/assets.json`。按《三国张角传》已锁定资源决策，现有和后续资源视为项目原创或已获授权；当前校验只阻断稳定 `assetId/imageId`、文件引用、状态、尺寸、pivot、动画及 2D/3D 映射错误，不以授权/作者/来源字段阻断开发或发布。
- Manifest 进入运行时后必须注册到场景已有的 `AssetManager`，不得创建第二实例。稳定 API 为 `registerManifest(manifest)`、`getManifestEntry(assetIdOrImageId)`、`resolveManifestAsset(assetIdOrImageId, mode)`；Manifest 中已经以 `assets/` 开头的工程路径不得再次拼接 `assetBasePath`。`SceneGameLoaderBridge.onReady` 支持异步等待，资源注册/加载完成后才允许 `sceneEnter`；`EntityFactory` 与 `PlacementSpawner` 对 NPC、敌人和资源节点统一优先消费 `imageId/assetId`，原 `spriteSheet/renderStyle` 仅作兼容降级。`item.worldProp` 同样通过 `EntityFactory.createProp()` 消费稳定 `imageId/assetId` 并由 PlacementSpawner 预载，剧情摆件不得退回硬编码图片路径或可拾取物列表。场景 `type:'image'` 对象以局部 `imageAssets` 支持编辑器预览，运行时局部条目缺失时必须通过注入的 `AssetManager.resolveManifestAsset(imageId)` 回退同一稳定 ID；不得因编辑器局部资源表漏项而让磁盘对象和空间 trigger 存在、游戏画面却缺失。
- 启动加载页的资源计数只能订阅 `AssetManager.onLoadProgress()` 发布的真实活动批次快照，并直接显示 `completed/total`；进度条必须由该比值正向派生，禁止从模拟百分比反推数量、硬编码 Manifest 总量，或为了扩大分母而预载后续场景。宿主重建 AssetManager 前必须调用订阅返回的注销函数；`clear()` 只重置批次状态并发布空快照，不擅自删除宿主监听器。
- 玩家职业和装备轮廓复用 `SpriteComponent.appearanceLayers` 叠加在基础动画之上；每层只保存稳定 `assetId`、尺寸、脚底相对偏移和透明度，领域职业仍由 ClassSystem/StoryState 持有。确认失败不得提前切换叠层，读档和跨场景继承必须从 canonical 职业重新投影；禁止为职业外观另建第二套玩家实体或渲染器。
- `AssetManager.getAudioManager()` 返回该资源管理器唯一拥有的 `AudioManager`；宿主必须把同一实例注入场景、Trigger 和 DialogueBox，禁止各自创建音频管理器。音频文件不存在时不得注册虚假 cue 或空文件。`S09AudioDirector` 只消费已注册的 `s09.music.low`、`s09.ambient.*`、`s09.sfx.*`，不加载或拥有资源；进入/离开 S09 负责启动和停止循环音，职业、捐粮和分支反馈只能在对应 checkpoint 成功后调用。`CityStateSummaryPanel` 仍只接收领域快照；表现图标由快照携带稳定 imageId，并通过注入的只读图片解析函数绘制，面板不得读取 Blackboard。
- Schema 校验与 `GraphDefinition.validate()` 是双层拦截，职责不同：前者在配置进入系统前，后者在构造后。
- `GameLoader.assembleProgression` 三层校验：配置整体 → 技能列表 → 每张图；非法项不写入运行状态，错误累积到 `lastValidationErrors`。

## 场景通用能力（S10）

`SceneBattleFlowRegistry` 统一校验并索引场景战役流程参数。canonical 场景 JSON 的 `gameplay.battleId` 与 `gameplay.battleFlow` 是 locationName、提示文案、Story 状态键、checkpoint 和战果展示 `worldChanges` 的唯一事实源；`config/battles/*.json` 只保存 BattleSystem 领域定义，不得再复制 `sceneFlow`。Registry 从所属场景 `id` 和 `gameplay.battleId` 派生双索引，`battleFlow` 内不得重复保存 sceneId/battleId；`registerMany()` 必须先完整校验再一次替换索引，失败保留旧注册状态。`BaseGameScene` 只暴露 `configureSceneBattleFlows/getBattleFlowByScene/getBattleFlowById/getBattleFlows`，具体 Scene 只负责加载 canonical 场景数据、传参和调用，不得另建常量 Map 或私有 getter。

`SceneCityWarStateBridge` 是 Blackboard、CityWarSystem 与已加载资源节点之间的唯一通用投影桥。`commit()` 可按当前活动战役投影 mode、resolved/winner/checkpoint 与配置化月份下限；`restore()` 必须精确写回已捕获状态，禁止再次执行活动战役投影，否则 rollback 会把待回滚事实重新写入快照。写入或资源节点同步失败时必须恢复 Blackboard 与节点状态。

`SceneBattleRuntime` 只拥有单活动战役会话、`BattleSystem/CityWarSystem/BattlefieldRuntimeSystem`、效果过滤器、三类战役 UI、默认 CityWar 结算、成长奖励和原存档键恢复。合法空闲快照固定为 `state:'idle'`、`definition/mode/frozenResult:null` 且无 operation，可以没有 `battleId`；只有非空战役会话才必须同时命中已注册 definition 与 battle flow，未知 ID 仍严格拒绝。它每次更新或启停都通过注入的 `getEntities()` 读取当前实体，不捕获初始化时数组；初始化、重复初始化和退出必须恢复此前的 `CombatSystem` effect filter。外部只允许通过 `getSessionState/isBattlefieldActive/canUseRescue/freezeResult` 查询或提交战役事实，通过 `captureCityWarState/restoreCityWarState/applyBattleResult` 参与外层原子事务，并通过 `handleInputLayer/renderLayer` 访问 `result/mode/hud` 分层表现；不得把 Runtime 内部系统或 View 再平铺到 Scene。`getSessionState()` 必须返回克隆快照，`restore()` 直接调用也必须先捕获完整战役状态，任一步失败后恢复 Battle/Battlefield/CityWar 全部旧状态。战役帧更新注册到 `GameSceneRuntime` 的 `afterScene` 阶段，保证 Combat/AI/Collision 已完成且 Scene 不再手工驱动。S03–S14、固定人物、月份、救援、S13 特殊结算等历史规则只能由 Demo `S03S14BattleCoordinator` 通过 hooks 注入，core 禁止按 sceneId/battleId 分支；Scene 只显式调用 coordinator/runtime，不直接实例化战役系统或定义会话函数。

`SceneFlowCoordinator` 是 Demo 历史流程从 Scene 中拆出的通用显式承载器：Scene 构造器必须显式持有 coordinator，并经 `sceneCoordinator.method(...)` 调用；禁止重新引入 `install*(SceneClass)`、`Object.defineProperty(SceneClass.prototype, ...)` 或其他动态 instance/prototype mixin。flow 内嵌套方法调用保持在同一 coordinator，字段读写投影到真实 Scene，Scene/框架方法仍以真实 Scene 为 receiver。只有向 Dialogue 等外部 API 传递 Scene 身份时才使用 `$scene`；不得把代理上下文本身外传，也不得把 `$scene` 当成恢复隐式 mixin 的入口。固定人物、S01–S14 历史条件与事务继续留在 Demo coordinator，通用状态机和领域能力仍上移到 `src/`。

`src/core/scene/` 提供三个可增量采纳的模块：

**SceneSystemContainer**：系统注册、`order` 显式更新顺序、`destroy()` 覆盖全部系统并逆序执行。单个系统抛错不影响其余。

**SceneObjectProjector**：局部坐标一次偏移后派生碰撞、渲染、交互视图。四条硬约束：

1. 原始局部对象只读
2. 每个对象只算一次世界坐标
3. 各视图共享同一份世界坐标但各持独立副本
4. 重复投影结果一致，不累积偏移

`verifyNoSharedReferences(projection)` 可在回归测试中检测视图间是否又出现共享引用。这直接针对 `_applySceneData` 的双重偏移问题。

**GameSceneRuntime**：既支持完整帧的「输入分发 → 系统更新 → 场景 hook → `InputManager.update()` 清帧」，也支持 `beforeInput` / `priorityInput` / `systems` / `afterScene` 分阶段调度。迁移旧场景时由 `SceneFramePipeline` 在原调用位置触发阶段，转场提前返回不会意外清帧。`registerInputHandler`、`registerSnapshotProvider`、阶段 hook 与 `onUpdate` 的注销函数自动进入 disposer，`dispose()` 逆序执行。

`BaseGameScene` 已采用这些模块，场景本体只保留场景编排、游戏内容钩子与兼容转发入口：

- `SceneTerrainCollision`：集中处理水池、树木和编辑器碰撞形状；静态碰撞体按 terrain 建空间索引，异步场景数据替换或数量变化时自动失效。椭圆盆地只负责视觉与装饰布局，**不得**作为物理边界；walkable 优先于 collide，区块接缝不会被 terrain 自动推出。主路 walkable 与建筑 collide 不得重叠，除非该区域明确是桥、门或可穿越入口；否则优先规则会让建筑变成可穿越。
- `SceneTerrainBinding`：绑定由世界流式会话创建的 terrain，统一特效区域、Buff 区域、碰撞与小地图引用；它不创建 Terrain，也不读取场景文件或 localStorage。`Scene1Terrain` 必须由流式 prepare 注入有效 canonical `sceneData.layers`。`effectZoneRenderer` 的创建、替换和释放必须经 Binding 同步写入 `context.presentation.effectZoneRenderer`；旧 renderer 只能清理自身，禁止覆盖新生命周期投影。
- `SceneAimController` + `SceneAimPresentation` + `AimPreviewRenderer`：统一 PC/触屏/手柄的瞄准控制、状态与 5px 虚线预览；场景通过回调注入射程和确认动作。
- `SceneEquipmentFlow`：统一装备槽位映射、属性差值和装备/卸下事务；变更结果仍必须由 `BaseGameScene.onEquipmentChanged(messages, info)` 派发。
- `SceneItemGainedFlow`：管理所有已提交物品类型的 FIFO 弹窗、装备比较和使用动作，不得按 `equipment/consumable/tool/material/resource` 白名单丢弃剧情或后续扩展类型。普通拾取由 `ItemLifecycleService.finalize` 进入；采集含受伤半产量由 `GatheringSystem` committed 终态进入；canonical `batchAdd/batchExchange` 奖励通过 post-commit `item.gained` application event 进入；职业初始装备在职业检查点成功后进入。幂等重放、失败、回滚和命令排队阶段均不得弹窗。弹窗装备必须经过统一装备事件出口；正式 `store` action 必须带稳定 `id:'store'`，`ItemGainedPopup` 在按钮第二行显示“`N`秒后自动放入背包”，用帧 `deltaTime` 从 5 秒倒计时并在到期时调用与手动点击相同的 action，不得重复执行库存 add。点击其他动作、隐藏、切换队首或场景退出必须取消旧倒计时，弹窗更新不得受普通 HUD 节流影响。可用消耗品默认聚焦 `primary/立即使用`，其他物品默认聚焦 `store/放入背包`；键盘方向键/WASD 按下沿、手柄左摇杆水平轴越过导航阈值后循环切换，弹窗显示后左摇杆必须先归中再武装，且不得使用会回退 D-pad 的 `getMoveVector()`；键盘 E 或物理手柄 A 只调用一次当前 action。弹窗可见期间，触屏和手柄仍由 `SceneInputFlow` 作为模态输入消费，并由 `SceneFramePipeline` 阻止方向轴、瞄准和蓄力跳继续驱动玩家；鼠标仅在命中弹窗范围时消费，框外左键和右键继续既有世界输入链，不得因弹窗可见被整帧锁定，但 AI 与世界模拟保持更新。物品图标优先消费稳定 `imageId/assetId`；缺图必须补 Manifest 资产，弹窗不得用名称首字伪装图片。
- `SceneInventoryFlow`：统一卸装、物品使用和获得物品入口；所有卸装结果仍由 `onEquipmentChanged(messages, info)` 派发。`InventoryPanel` 可使用只读 projection 显示属性和装备，但库存格必须以已提交的实体 `InventoryComponent` 为准，避免异步旧 projection 遮蔽新入包物品；新角色的默认背包容量为 24 格（6×4），Demo 通过 `ScenePlayerLifecycle.minimumInventorySlots` 与 `InventoryComponent.ensureSlotCapacity()` 在玩家绑定时只扩不缩地兼容升级旧 6 格实体，内容层如需改容量必须显式配置同一槽位数量。
- `SceneInputFlow`：统一帧首手柄 poll、弹窗优先消费、战斗意图、InputActionRouter 与正常帧末 flush；转场提前返回只 release，不清输入。
- `SceneHudUpdater`：统一冷却、面板、对话框、手柄面板和小地图更新；RenderPipeline 只绘制，不在 render 内修改 UI 状态。
- `SceneLifecycleCoordinator`：为同步 Scene API 提供 `exitSync()`，Base 退出事务由协调器拥有；ResourceScope 先失效，随后按既有顺序释放输入、玩家、系统、UI 与实体。
- `SceneEntityStore`：唯一拥有 canonical `all/enemies/pickups/equipmentItems` 四个稳定数组、玩家引用和稳定实体 ID 索引；场景上的同名集合仅为稳定投影，按 ID 查询统一使用 `getById()`，新增、分类、批量删除和销毁必须经 store，并同步维护索引。`PickupSystem` 与 `EntityLifecycleSystem.collectDeadEntities()` 只返回 `removedEntities`，不得原地缩短这些数组；调用场景以一次 `removeMany()` 作为唯一删除提交点。旧 `EntityLifecycleSystem.removeDeadEntities()` 仅保留给未迁移调用方作为兼容 mutating wrapper。
- `WorldMapLoadSession` + `WorldReadyGate`：项目只加载一次；session 只预载启动/目标场景，邻近八格由唯一 `src/core/WorldStreamingManager.js` 的异步 `sceneResolver` 按需读取磁盘 JSON，《三国张角传》正式运行不读取 localStorage fallback；磁盘读取或解析失败直接拒绝。core manager 唯一拥有 Region 命名空间 `loaded/savedStates`、latest-wins、九宫格 prepare/commit/rollback 和 provider 快照；`src/systems/WorldStreamingManager.js` 仅无状态兼容转发。同步 `deserialize()` 必须完整 validate/prepare 后原子恢复当前 loaded chunk/provider，不卸载 runtime、不发 IO，成功后标记下一帧 refresh。terrain 与 placements 共享已加载的 chunk 数据，3 秒超时仍开放渲染。玩家启动意图必须在场景 `enter()` 前确定；通用 placements 投影只允许 `newGame` 首次消费当前 `sceneId` 的 canonical 玩家出生点。读档位置由 `restoreSaveState()`、继承位置由 `ScenePlayerLifecycle`、同区传送由 `ChunkNavigator`、跨区传送由 `RegionCoordinator` 各自持有，加载 placements 不得再次覆盖。
- `RegionCoordinator`：跨 Region 必须使用独立 shadow session 加载目标入口，并在 commit 前由 detached core `WorldStreamingManager` 完成目标九宫格 load/validate；目标 manager 准备失败时旧 Region、玩家位置、Story 和 runtime 零修改。提交开始后的任何失败恢复旧 session 与完整状态草稿，成功后才释放旧 session。卸载区按 `regionId` 保存完整 `worldStreamingState`；资源节点、placement、DeathDrop、S10 工事和按 scene namespace 分区的 Vehicle/Cargo 运行态只由流式 provider 保存，载具物流 operation ledger 只在全局场景快照保存一次，禁止旧 chunk 用过期 ledger 覆盖新事务，也禁止与 legacy `regionStates` 领域字段双写。读档先通过 `SaveGameService.inspect/inspectAuto` 取得目标 `currentSceneId` 并准备对应 Region，再进入同步原子 restore。
- `ScenePlacementRuntime` + `PlacementSpawner` + `ChunkNavigator` + `FadeOverlayTransition`：Runtime 是通用放置投影、生成幂等、pending 状态、出生点消费与恢复重建的唯一所有者，并以 `context.services.placements` 显式注册；Scene 只负责注入依赖和调用 `spawn/spawnGroup/spawnLoadedChunks/loadProjection/rebuild`。Spawner 仅承接定义合并与实体创建，Demo 分组/NPC/剧情索引副作用通过显式 coordinator 回调注入。`ScenePlacementRuntime` 必须等待世界 Promise 后再生成，按 physical chunk ID 稳定排序，且只能在 `newGame` 首次消费玩家出生点；removed tombstone 必须同时注销 AI、移出 `SceneEntityStore` 并销毁实体。恢复重建先保留旧对象并生成完整草稿，任一生成错误清理草稿并恢复 pending/spawned ledger，禁止先删旧对象后留下半成品。`spawnWhen` 的 Blackboard 路径解释通过 `getConditionRoot` 注入，返回 false 的对象不创建也不登记 spawned ID，条件异常记录为 `spawnConditionFailed`。`sceneEnter` 初始组只允许生成开场即可见的静态资源/道具/NPC；延迟敌人必须使用独立 group + `spawnWhen`，由可视化空间 trigger 在领域状态提交后调用 `spawnPlacements`，禁止把尚未进入剧情的主动 AI 混入初始组。
- `SceneGameLoaderBridge`：组装标准 GameLoader 依赖、物品奖励、对话事件、场景标记、上下文和 sceneEnter；`DialogueSystem.onEnd/onChoice` 都是可取消的多监听器，Bridge 分别发布 `dialogueEnd{id}` 与 `dialogueChoice{id,choiceId,index,nextNode}`，具体剧情动作由场景通过 `registerActions` 注入，Bridge 负责 generation 防止退出后旧加载继续装配。`TriggerSystem.registerAction()` 的 legacy handler 返回裸 `false` 或 `{ok:false}` 都必须归一化为失败；可失败动作优先返回 `{ok:false, code }` 以保留原因，失败不得错误关闭 `once:true` 触发器。
- 内容事件只允许从已成立事实发布：物品事件必须在库存/世界对象/checkpoint/state revision 全部提交成功后发布，到达事件必须以实际 Transform 进入目标范围为准，NPC `interact` 必须在对话或商店成功启动后发布；输入按下、命令入队、动作开始和 `fire()/fireById()` 返回 accepted 都不代表业务成功。需要等待结果时使用 `fireAndWait()` 或 `triggerSucceeded`/ledger；legacy action 裸 `false` 必须归一化为失败，失败不得写 once/cooldown 或继续后续 action。
- 同一 committed event 可能命中多个 Trigger 时使用 `fireCoordinated()`：`coordination.group` 内按 `priority` 降序、定义顺序稳定仲裁，`broadcast` 串行执行全部候选，`firstSuccess` 在首个成功后跳过低优先级候选；同一 `when.type + group` 的 policy 必须一致。未声明 coordination 的 Trigger 保持兼容广播，无匹配或全部暂不可执行视为成功空分派。`SceneApplicationEventBridge` 仅在 essential 内容消费者成功后记录 seen；内容消费者 `{ok:false}` 或抛错按 0.5/1/2 秒有界重试，表现和教程属于 best-effort，失败只记诊断且不得重播、回滚或重新拥有业务事实。场景生命周期不得再逐帧扫描 picked 标记或调用旧 `_checkItemPickupEvents()`；正式拾取事件只能由 `ItemLifecycleService` 完整提交后经 `PostCommitNotificationBus` 进入 Bridge。
- `TimeSystem`：除昼夜段外统一拥有从 1 开始的 `currentDay`，支持 `advanceDays()`、`serialize()`、`validateSerialized()` 与 `deserialize()`。`deserialize()` 必须遵循 validate → draft → commit，校验或派生 atmosphere 缓存失败时保留全部旧运行态，不得静默接受 truthy primitive、缺字段或越出当前周期的 `elapsed`。历史延迟后果描述保存在 StoryState（稳定 event id、dueDay、status），到期领域提交仍遵循草稿→提交→checkpoint，保存失败恢复草稿并保留 pending 供重试。
- `SceneTransitionFlow`：封装转场的淡入、提示和切换阶段，`isTransitioning` 与 `transitionPhase` 只读投影给子场景。
- `SceneCombatActions`：承接 PC、触屏和手柄的攻击、轻功、投掷、格挡、药水与自动攻击；不拥有系统或实体状态，也不再混入技能编排和世界拾取。基础攻击许可统一查询 `BaseGameScene.canPerformBasicAttack()`，默认只在 `CombatSystem.isInCombat()` 时开放；训练、教学或可破坏物场景可按当前流程覆盖。PC 每帧攻击由 `MeleeAttackSystem.init({ canAttack })` 消费同一许可，触屏/手柄方向攻击由 `SceneCombatActions` 消费，禁止只放开某一种输入。载具武器等场景级攻击分流统一使用可选 `handleBasicAttackIntent(intent)`：返回 true 时消费攻击并禁止乘员自身攻击，PC 原始左键仍通过 `canPerformBasicAttack()` 调用同一 hook。攻击教学只能在 `onAttackPerformed`（冷却、弹药等前置均通过且攻击实际启动）后完成，不能在原始按键按下时提前完成。
- `VehicleWeaponSystem` + `VehicleLogisticsSystem`：武器系统只消费 `VehicleSystem.routeIntent()` 后的 gunner intent，并校验席位、武器、目标、存活与射程；物流系统拥有弹药/人力扣除、`catapultShots`、目标 ID 指纹、operationId 幂等和 checkpoint。可回滚 executor 在 checkpoint 前提交目标业务状态，失败时与库存/物流一起逆序恢复，checkpoint 成功后才调用 finalize 播放投射物、伤害事件和死亡表现。同 operationId 更换 targetId 必须返回冲突。
- `MovementSystem` + `VehicleSystem`：`MovementSystem.setMoveIntentRouter()` 是驾驶席移动的统一消费者，axis 与右键寻路均先经 `VehicleSystem.routeIntent()` 决定作用于玩家或 vehicle，不允许 Demo 为键盘、触屏或手柄另建驾驶旁路。马匹按固定距离批次调用 `recordHorseTravel()`，批次残余进入 VehicleComponent 快照；operationId 由 vehicle 与已提交批次派生，缺粮只应用配置化停车且库存不小于 0。缺粮恢复必须调用 `VehicleLogisticsSystem.refeedHorse()` 原子扣粮、清除 `starved` 并 checkpoint，禁止只把 `MovementComponent.enabled` 改回 true；物流幂等表容量淘汰必须用当前写入的 mutation journal 回滚，只恢复该写入逐出的记录，不得用旧 Map 覆盖并发成功 operation。云梯火毁统一调用 `burnLadder()`，入口可用性只从 `destroyed/ladderEntryDisabled` 派生，不保存第二份布尔状态。
- `SceneTriggerBindingSystem`：`targetMode:'id'` 可通过注入的 `resolveDynamicTarget` 惰性解析 ECS 实体；命中中心、距离排序和 `_fire()` 目标必须共用同一动态投影，动态实体不存在时才回退磁盘场景对象。`setBindings()` 必须一次规范化 selector 并预计算静态目标/geometry；每帧动态 ID 只经 `SceneEntityStore.getById()` 做 O(1) 探测，未命中时直接复用静态空间快照，禁止重新扫描 `sceneObjects`。所有空间交互锚点统一由 `SceneSpatialGeometry` 解析：动态 ECS 实体及 `spawn/ref` 使用脚点/点锚，`image/region/shape` 使用矩形或多边形包围盒中心；提示、键盘/触屏、鼠标命中、距离排序和事件 `targetAnchor/targetGeometry` 必须复用同一次空间快照。视觉脚点与实际交互中心不一致时，binding 只使用数据驱动的 `anchorOffsetX/anchorOffsetY` 做小幅修正；禁止在 Demo 输入代码中硬编码对象特例。调试面板的“显示交互热点范围”只能在开关启用时读取 `getDebugHotspotSnapshot()`，绘制玩家半径、鼠标半径、锚点和激活状态；诊断代码不得调用 `_fire()`、执行 trigger 或修改 binding/领域状态。移动载具只保留一个状态化交互 binding，禁止为上车/下车配置两个同中心 binding，也禁止把运行时 Transform 写回场景 JSON。空间 `interact` 同一输入只允许执行当前有效提示 binding，否则执行距离最近的唯一候选；只要存在空间候选就消费输入，active、cooldown 或业务拒绝不得向重叠 binding 穿透。异步 `once:true` binding 不得在执行请求刚被接受时提前标记完成，只能以 `TriggerSystem.hasFiredOnce()` 的动作成功状态为准。空间 binding 可用 `activeWhen` 声明与 `spawnWhen` 相同的 `blackboardKey/path/exists/equals/gte/lte/in` 条件，并支持 `all/any/not` 与 `{tutorialId,completed}`；同一条件必须同时过滤提示、键鼠/触屏候选、approach/enter/leave 和最终 `_fire()`，未到阶段的 binding 不得显示误导提示或抢占 E/点击。
- `CombatSystem.applyDamage(..., { deferPresentationEffects:true })`：只先提交 HP 并返回幂等 `finalize/rollback`；监听器、飘字、受击与死亡副作用延迟到 finalize。该协议用于必须把伤害纳入外层 checkpoint 的事务，普通调用保持原同步表现。
- `SceneSkillActions`：统一技能可用性、特殊技能、按索引/方向释放、PC 瞄准控制与预览；`SceneAimController` 仍只负责几何和状态。
- `SceneWorldInteraction`：统一 UI 点击优先级、点击拾取、保留的 `handleTeleport` 入口与右键正式绿色落点反馈；拾取删除必须经过 `SceneEntityStore.removeMany()`。
- `SceneDialogueFlow`：统一继续对话、跳过打字机、选项节点保护和点击消费；`lastSpacePressed` 继续作为兼容字段保留。
- `ScenePanelLayout`：组合并绑定 HUD，加载 UIEditor/PanelEditor 布局、响应窗口缩放、同步面板悬停，并在背包打开时协调 Canvas 与 DOM 触屏控件层级。
- `PlayerInfoPanel` 的装备槽以玩家真实 `EquipmentComponent` 为实时事实源，projection 仅在真实组件不存在时作只读显示回退；稳定 `imageId/assetId` 图标优先，图片尚未就绪或资源解析失败时至少显示已有物品名/定义 ID 的简短回退，避免已提交装备呈现为空槽。
- `SceneWorldPresentation`：统一通用 terrain/等距背景、掉落物、飞行阴影与格挡护盾；子场景仍通过 `renderBackground`、`renderSpeechBubbles` 覆盖 Demo 内容表现，时间/天气 atmosphere 只从 `context.services.campfire.renderAtmosphere()` 进入正式屏幕管线，不保留旧的子场景雾层兼容钩子。
- `SceneFramePipeline`：通过显式 `{ scene, context }` 构造，帧首一次解析 `context.systems/presentation/entities/player/input/camera`，完整系统更新链只消费这些局部 Context 依赖，不再回退到 Scene 同名平铺字段。输入与 HUD 从 `context.services` 调度；保持系统更新顺序和转场提前返回语义，正常帧最后才清输入。相机必须在本帧移动、实体碰撞和地形位置修正完成后跟随最终玩家位置，禁止长期使用上一帧位置。Demo 自建主循环必须在每个 `requestAnimationFrame` 执行一次 update/render，不得用 `elapsed < frameInterval` 跳过 RAF 后再把累计 `deltaTime` 一次性交给移动系统；异步 `initGame` 必须用 in-flight Promise 阻止重复初始化，RAF 只能由单例调度器维持一条链，禁止每次初始化或多个入口直接 `requestAnimationFrame(gameLoop)`。页面切换或长任务产生的异常 `deltaTime` 应做保守上限钳制。存档封面禁止在每个 RAF 创建 Canvas 并同步调用 `toDataURL()`；只能在首帧存档等待或真实保存请求时按需采集，优先使用异步 `toBlob()`，转场期间复用上一张有效画面。即使只在首帧等待器触发，主 Canvas 的 `drawImage()` 缩放复制也不得在游戏 RAF 内执行，必须由单一 in-flight 的 `requestIdleCallback`（不可用时延后任务队列）调度，generation 变化的迟到结果不得写回新会话。
- `CollisionSystem`：小规模可碰撞实体继续按稳定实体索引执行双循环；超过阈值时必须基于本帧移动后的当前位置重建自有 broad-phase 网格，再按原索引顺序执行窄相与回调。禁止直接复用移动前且可能未置脏的 `PerformanceOptimizer.spatialGrid`。筛选实体/Transform 和候选对使用可复用缓冲；动态 terrain collider 增删必须显式使 `SceneTerrainCollision` 的静态索引失效。
- `SceneRenderPipeline`：通过显式 `{ scene, context }` 构造，camera/player/entities/systems/presentation/ui 等正式依赖只从 Context 读取，不再回退到 Scene 同名平铺字段；按 `worldLayers → screenLayers → modalLayers` 有序绘制，render 内禁止更新 UI 状态，Y-sort 缓冲继续复用。显式 `depthSort:true` 的场景图片和 effectZone 粒子进入实体队列，稳定同 Y 顺序为静态图片/装饰（0）→ worldDepth 粒子（1）→实体（2）；普通背景图片与战斗/技能顶层粒子保持原层级。`sortY` 是世界 Y 字段，任何 chunk 投影必须与 `y/points` 同时且只偏移一次。全屏时间 atmosphere 等低频柔化层应在低分辨率离屏 Canvas 每帧动态合成后放大，业务坐标和半径按同一比例投影；固定形状的径向 alpha mask 可按半径与 yScale 缓存，但配置变化和生命周期释放时必须清空。普通场景图片、非碰撞装饰和 `belowEntities` 装饰必须在九宫格 Terrain 准备阶段等待资源并预生成静态 Canvas，发布 projection 后 RAF 只消费缓存；`depthSort:true` 图片与碰撞装饰仍保留 Y-sort。FrameProfile 必须为默认 screen layer 保留稳定阶段名并继续保留 `renderScreenUi` 聚合值，使技能/战斗特效、飘字、教程、对话、战斗 UI、底栏、各按钮、HUD、小地图、战斗状态、转场和性能 HUD 可分别定位；回调内 `total` 只表示同步 CPU 工作，必须另行统计真实 RAF interval、有效 FPS、暂停/隐藏回调和 delta 钳制次数，顶层 `over16ms/over33ms` 不得再用 CPU work 冒充帧间隔。常规 FrameProfile 或性能 HUD 不得隐式安装 Canvas draw-call 方法代理，只有 `setDrawCallTracking(true)` 或显式采样传入 `captureDrawCalls:true` 才允许安装，关闭后下一帧必须恢复 Canvas 原方法。性能 HUD 的 DOM 只按指标刷新周期且值变化时写入，真实性能采样与 HUD 显隐相互独立；DebugPanel 的重型 DOM 信息同样必须节流，空闲摇杆等覆盖 Canvas 只能按输入/尺寸变化重绘，禁止另起永久 RAF 每帧清空全尺寸画布。Canvas2D 的 `window` 显示模式默认保持 backing 与 CSS 像素 1:1；活动场景的 RenderPipeline 已完整覆盖逻辑画面时，宿主帧准备只恢复 transform/smoothing，不得先填充整个物理 backing 再由场景重复全屏填充；只有无活动场景或场景明确不覆盖画面时才由宿主清屏。未经目标设备实测不得直接乘高 DPR，因为 DPR=2 会把栅格像素量放大 4 倍。全屏背景、半分辨率 atmosphere 和离屏缓存存在逐帧缩放时不得强制 `imageSmoothingQuality:'high'`，应由 `CanvasDisplayScaler` 配置并默认使用 `low`；高 DPR 或高质量重采样的浏览器延迟栅格化会表现为 RAF 回调后的 Long Task，无法从同步 `render` CPU 耗时中看出。
- `SceneCampfireService`：canonical 篝火配置中的 `frameCols × frameRows` 必须覆盖 `frameCount`，绑定图片的自然尺寸必须覆盖 `frameWidth × frameCols` 和 `frameHeight × frameRows`；切换 `imageId` 后先清除旧图，再按当前配置稳定 ID 重新绑定，禁止异步先后顺序保留错图。`particlePresets[].life` 沿用 `Particle` 的毫秒单位，发射 `rate` 和帧 `deltaTime` 使用秒；配置进入运行态前完整校验，失败不得留下半配置。全屏 atmosphere 只由 `TimeSystem.darknessOpacity/tintColor` 生成，各时间段配置及其插值是唯一事实源，不再按时段名称硬编码门禁，也不存在篝火雾透明度或天气全屏雾叠加。时间层须在同一张半分辨率 Canvas 合成后一次性用 `destination-out` 挖玩家/火堆透光洞，禁止先把时间黑幕提交到主 Canvas；`WeatherSystem` 随后只绘制天气粒子与移动雾团；所有有空间位置的天气表现必须按 `Camera.getViewBounds()` 的世界坐标窗口生成并在 atmosphere 层统一减去 `left/top` 投影；雾团的合法活动范围额外只由 `WorldStreamingManager.getActiveNineGridCoverage()` 投影到 `context.world.loadedCoverage` 的当前中心九宫格实际已提交 physical chunk 决定，coverage 不得从玩家、相机、完整 Region 或 retained fringe 推导。雾团只接受 Demo coordinator 以 required 模式预载并注入的稳定半透明 PNG drawable，任意雾天总数硬性最多 10；coverage 或图片缺失时清空/跳过雾，禁止回退为 Canvas 色块、ellipse 或径向渐变。雾天切换只调整不持久化的表现层 alpha：进入和退出均以每次随机 10–30 秒的 smoothstep 从当前值连续过渡；新增云团与 heavyFog→lightFog 的冗余云团分别在同一时长范围内局部渐显/渐隐，切换反向时从当前 alpha 重新过渡，禁止由 setWeather/debug override 直接清空雾团。coverage 不再包含云团所在 rect 时才立即停止绘制并释放该云。禁止读取玩家位置、把相机位移累加到粒子，或把 coverage、雾坐标和图片写入 StoryState/存档；无空间落点的全屏闪电照明保留屏幕空间。无火堆配置时该服务仍负责通用时间/天气 atmosphere，只跳过火堆 world render item。玩家与火堆的固定径向透光 mask 按类型、半径和 yScale 复用，离屏 atmosphere context 与 world queue 底/顶 render item 也必须跨帧复用；底层与火焰层使用同一世界 Y，固定 `sortPriority:0 → 1` 保证石圈/底座/木柴先画、火焰后画，禁止用 `top.y = y - 1` 让升序 Y-sort 反转层级。`configure()` 与 `dispose()` 必须清空 atmosphere canvas/context/mask，退出时清除 render context，禁止缓存最终动态画面。
- `BottomControlBar` + `Minimap`：底栏每帧只读取一次时钟和库存列表，同一扫描生成红/蓝药摘要；InputHints 快捷键只在输入方案变化时重新解析，固定位置的 CanvasGradient 按 ctx 和几何签名缓存。小地图静态缩略图只能在九宫格 Terrain 投影提交后的游戏/Region 激活阶段显式建立一次；`SceneHudUpdater` 的帧更新、`SceneTerrainBinding` 的引用同步、HUD 组合、窗口缩放、缩放切换和普通 streaming refresh 均不得生成或重建缓存。zoom 0/1 跟随玩家或相机时只更新同一缓存的裁剪窗口和坐标变换，不得重画 terrain 背景，但玩家、敌人和 NPC marker 仍按实时位置逐帧绘制。
- `SceneGameplaySystemAssembler`：集中创建、接线和释放 Combat/Movement/AI/Collision/Pickup/Meditation/Zone/Flight/Melee 及战斗渲染器；`GameLoader` 就绪后还统一创建 Class/Proficiency/Construction/Vehicle/VehicleLogistics/MannedStructure，并接入同一个 EffectResolver、库存容量和移动 intent 路由。正式所有权投影到 `context.systems/presentation`，Scene 同名字段只作迁移兼容；释放时只清除仍指向本装配器实例的 Context 槽位和路由，并清空物流 inventory owner 闭包；退出后迟到的未决物流 checkpoint 必须被拒绝以触发事务自身回滚，禁止伪装成功后写入已释放场景。Demo 只能注入配置、历史校验、checkpoint 与事件回调，不得再次直接 `new` 这些系统。
- `SceneGameplaySnapshotRuntime`：统一捕获 defeat/gathering/locomotion/puppet/proficiency/construction 字段，并按“基础领域状态→职业事实同步→角色派生状态”分阶段恢复。`restoreFoundations()` 与 `restoreActors()` 各自必须先捕获本阶段全部回滚快照；当前失败步骤和此前步骤都按逆序恢复，直接调用也不能留下半恢复状态。外层 `BaseGameScene.restoreSaveState()` 仍负责跨阶段及剧情/职业状态的整体原子回滚。
- `SceneDeathDropRuntime`：统一 DeathDrop 列表捕获、纯校验和替换恢复，并以 `context.services.deathDrops` 注册。恢复必须先创建全部未注册草稿，草稿完整后才一次替换选中范围；创建失败保持旧列表不变，提交失败恢复旧 `SceneEntityStore` 分类注册。流式 chunk 只能通过 `selectCurrent` 替换当前加载范围，禁止破坏其他已加载 namespace 的掉落。
- `SceneVehicleRuntime`：拥有 canonical 场景 `gameplay.vehicles` 的实体生成、按 `sceneNamespace` 捕获、纯预校验、Vehicle/Cargo/物流 ledger 原子恢复和逆序回滚；使用注入的 `getChunk/findMarker/VehicleSystem/EntityStore`，core 不识别 SXX、阵营或历史规则。具体游戏只传 team/tags 和退出钩子；流式 provider 保存分区载具状态，场景总快照仍只保存一次全局物流 ledger。恢复前 `ensure()` 新建的实体必须单独记录；任一组件或物流恢复失败时，除恢复已有载具的 Transform/Vehicle/Cargo/Movement/注册状态外，还必须注销、移出 store 并销毁本次新建实体。
- `SceneDiagnostics`：集中管理 DebugPanel、PerformanceOptimizer/Monitor、draw-call Canvas 代理、纹理内存估算、terrain 碰撞状态变更日志、碰撞 shape 调试绘制与首次碰撞诊断；以 `context.services.diagnostics` 显式注册。调试绘制继续受场景 `debugShowCollisionPolygons` 控制，原日志内容不得因迁移而删除；监控关闭时不保留代理，场景退出时恢复 Canvas 原方法。DebugPanel 是独立 fixed DOM 表现层：仅标题栏通过 Pointer Events 拖动、右下角 handle 调整尺寸，布局只在同一实例 hide/show 间保留，不进入 StoryState、存档或正式 UILayout；拖放 handle 才可 preventDefault/stopPropagation，不能拦截面板按钮、滚动或世界输入。SceneDiagnostics 在关闭调试或场景退出时必须调用强制 `dispose()`，即使游戏暂停也要释放 DOM、RAF、Pointer capture 和 window resize 监听。
- `EntityRenderer2D`、`ItemSpriteRenderer`、`ClickFeedbackRenderer`：承接实体、掉落物和点击反馈绘制；实体渲染器缓存已就绪资源、代码样式与稳定文本测量结果。

Demo 默认角色的选择配置、技能和系统/UI 绑定位于 `example/sanguo_zhangjiao/entities/DemoPlayerFactory.js`；底层实体创建仍必须复用框架 `EntityFactory.createPlayer()`，不要把 Demo 技能写入框架。

`BaseGameScene` 已直接继承框架 `Scene`；旧 `PrologueScene` 与 Act1–6 独立场景已删除。运行时只注册 `DataDrivenPrologueScene`，各幕通过 chunk ID 与 `teleportToChunk()` 推进。

新增场景功能应优先落在对应核心模块；仅与具体剧情、角色或资源强耦合的编排才保留在 Demo 场景中。

## 已知既有测试失败（与本次改造无关）

```text
CombatSystem/ElementSystem/MovementSystem/SkillTreeSystem.test.js   旧手写测试文件，缺 describe
AISystem                                                            测试 mock 缺 canAttack
DialogueSystem                                                      打字机时间敏感断言
FlightSystem.elevation ×2                                           层级与阶段断言
FriendSystem                                                        中文名排序
```

修改这些文件时可顺手修复，但不要与成长系统改造混在同一次提交。

## 战役模式与战果结算（P3 基础）

- `BattleSystem` 是单场战役模式和唯一战果的领域权威：`start()` 后只能通过带 `operationId` 的 `selectMode('observe'|'intervene')` 首次确认，确认后不可改选；`freezeResult()` 只接受当前 `battleId` 的 Canonical BattleResult，第二个不同 `resultId` 必须拒绝。
- 观战不停止 Combat/AI/Collision 表现。玩家对参战阵营的 damage/heal 必须经 `BattleSystem.filterEffectAmount()` 归零；救援入口仅在介入且战役 active 时开放。胜负同时满足时按战役定义的 `outcomePriority` 顺序冻结，不再依赖 `CombatSystem` 内硬编码 if 顺序。
- Canonical BattleResult schemaVersion 2 明确 `affectedCityId` 与 `resourceTransfer{fromCityId,toCityId,resources}`；`resourceTransfer.resources` 必须与 `capturedResources` 一致。LocalMock 的 createBattle 必须提供受影响城市和资源转移双方，禁止领域层猜测城市归属。
- `CityWarSystem` 固定按“资源转移 → 城市损毁 → 节点损毁 → WarState → Story 统计”准备完整草稿，再一次提交、发事件和创建 checkpoint。checkpoint 或提交失败必须恢复提交前全状态；`appliedBattleResultIds` 与 operationId 双重幂等，重放不得重复资源、损毁或统计。
- `BattleModeView` 只接收不可变显示快照并发出 `selectMode/cancel` 命令，不直接持有 BattleSystem、Blackboard 或修改战役状态；提示继续使用 InputHints，手柄 A/X 确认、B 取消。模态提交进入 busy 后仍必须持续返回已消费，禁止世界移动、攻击或交互穿透。
- pending/active 战役读档后必须先调用 `BattleSystem.rehydrate()`，用原 create requestId 重建无状态 transport 会话；该操作不得改写已恢复的 mode 或 frozenResult。
- `CombatSystem.setEffectAmountFilter()` 是观战及战役友军效果过滤的唯一接线点；伤害、治疗和 AOE 都必须复用 `applyDamage/applyHeal`，禁止在 Demo 另建绕过过滤器的结算路径。
- canonical 参战实体必须从内容定义一路保留 `factionId`；legacy `faction` 只作普通敌我兼容。`AISystem` 对带 `battleParticipant` 标签的单位按不同 `factionId` 选敌，介入玩家临时使用 `battleIntervenor` 标签，战役结束后恢复原阵营投影。
- `BattlefieldRuntimeSystem` 只编排现有 Combat/AI/Collision、统计士气和伤亡并把配置化 signals 交给 `BattleSystem.evaluateOutcome()`；它不拥有实体生命或另做伤害。即时结果与 LocalMock 必须生成同一 Canonical BattleResult v2，再交给 CityWarSystem。
- 战中 `BattleHudView` 和战后 `BattleResultView` 只消费不可变快照；结果面板关闭只改变 UI 可见性，不能撤销或再次应用战果。

## 后续阶段

S11 为 Demo 迁移验证：旧张角 Demo 通过新架构运行、逐个切换 `primary` 验证默认体验、100 实体性能检查。需要实际运行才有意义。

## BaseGameScene 深度重构执行方案

目标：`BaseGameScene` 最终只作为组合根，保留 constructor/enter/update/render/exit、暂停控制和少量 Demo 内容 hook；禁止继续把系统、UI、实体和世界状态平铺为无所有权的场景字段。

- 功能性实现必须上移到 `src/core/scene/` 等框架模块，并以显式服务注册到 `GameSceneContext.services`；Scene 只负责装配、传参和调用。禁止为通用能力使用 `install*(SceneClass)`、`Object.defineProperty(SceneClass.prototype, ...)` 等 prototype mixin。固定人物、S01–S14 历史条件和剧情事务可留在 Demo coordinator，但也必须由 Scene 显式调用，不得混入 Scene prototype。

### 目标结构

- `GameSceneContext`：显式分组 input/camera/runtime/systems/entities/ui/world/presentation。
- `SceneResourceScope`：统一管理 timer、listener、disposer 和异步 token；退出后禁止异步任务写回旧场景。
- `SceneLifecycleCoordinator`：固定 Canvas→terrain→input→runtime→systems→UI→player→bindings 初始化顺序，并按逆序释放。
- `SceneEntityStore`：唯一拥有 all/enemies/pickups/equipmentItems 列表和批量移除/销毁。
- `ScenePlayerLifecycle`：统一创建或继承玩家、系统/UI/相机绑定和生命周期保护。
- `SceneInputBindings` / `SceneInputFlow`：前者统一热键、手柄配置和连接生命周期；后者统一帧首采集、弹窗优先消费、战斗意图、路由和帧末清理。
- `SceneSkillActions` / `SceneWorldInteraction` / `SceneDialogueFlow`：分别拥有技能、世界点击/拾取/选敌、对话输入。
- `SceneHintPresenter`：统一屏幕提示、InputHints 格式化、DOM fallback 和可取消自动隐藏；持久 screen/tutorial 提示优先于 proximity hint。screen 可见期间 `showHint/hideHint` 只更新缓存，不得隐藏或覆盖 screen；screen 结束后若 proximity hint 仍有效再恢复，禁止两个通道共用宿主面板时互相误关。
- `SceneWorldPresentation`：统一背景、迷雾、气泡、拾取、飞行阴影和战斗表现。
- `SceneFramePipeline` / `SceneRenderPipeline`：只负责编排，改为接收显式 context/services，不再把 scene 当无约束属性仓库。

### 执行阶段

1. 删除无消费者的旧 GameLoader/等距地图/兼容转发入口。
2. 建立 Context、ResourceScope、EntityStore、PlayerLifecycle，并迁移 enter/exit 状态所有权。
3. 迁移热键、手柄、提示、技能、世界交互和对话输入。
4. 扩展 PanelLayout/TerrainBinding，抽离世界表现。
5. 将 Frame/Render Pipeline 改为显式依赖，迁移 DataDrivenPrologueScene 直接字段访问。
6. 删除迁移期 getter 和兼容字段，压缩 BaseGameScene 为薄组合根。

### 不可破坏的约束

- `DataDrivenPrologueScene._initEditorTerrain()` 必须保持空实现。
- 转场 show_text/switch_scene 提前返回时不得清输入；正常帧最后才清输入。
- 装备/卸下最终必须经过 `onEquipmentChanged(messages, info)`。
- 操作提示必须使用 `InputHints`，不得硬编码单平台按键。
- terrain worldOffset 只能应用一次，walkable 优先于 collide。
- 不删除调试日志、`handleTeleport`、`lastSpacePressed`；调试信息迁移时原样保留。
- Demo 角色、火堆、剧情和中文内容留在 example；框架模块不硬编码 Demo 内容。
- 每阶段运行 diagnostics，不自动构建、不运行测试、不修改 desktop、不创建测试页面。


## 火堆世界物件与表现定义

- 火堆必须是 `library.items` 中 `worldProp:true` 的物品定义；场景只用 `type:'ref' / kind:'item'` 放置该物品，并以 `semanticRole:'campfire'` 让具体 Demo 适配器绑定既有 `SceneCampfireService`。禁止再用 `type:'spawn', ref:'campfire'` 把它作为场景逻辑特例。
- 基础灰烬、木头、石圈、火焰的稳定 `imageId`、尺寸、pivot、偏移、火焰帧参数、余烬、燃料、碰撞和光照都归入物品的 `campfirePresentation`。`SceneCampfireService` 只消费这份已验证表现定义和已投影一次的世界坐标，不读取场景 `gameplay.campfire`，也不得硬编码木头或石圈几何。
- 火堆 worldProp 的实体可保留为交互/场景锚点，但 `sprite.visible:false`，避免它与服务绘制的分层表现重复渲染。进入场景时必须按 Manifest 稳定 ID 预载所有表现层；切换到没有火堆定义的场景必须释放服务配置，避免旧火堆残留。

## EventJournal 与任务图存档边界

事件与任务能力的首要目标是可靠存档、原子恢复和幂等重放，不是单纯增加任务 UI。职责固定分为三层：

```text
EventInstance        一次真实发生；由全局唯一 eventId 标识
EventExecutionGraph  同一事件下多个 Trigger、step 与 operation 的执行证据
TaskInstance         玩家长期任务的节点、并行、分支、奖励与追踪状态
```

身份规则：

- `eventDefinitionId` 是静态内容定义；`eventId = evt:<runId>:<sequence>` 是一次真实事件实例；两者不得混用。
- 每次新的空间交互产生新 `eventId`；已提交领域事件沿用 `PostCommitNotificationBus` 已分配的 `eventId`。
- 同一事件可命中多个 Trigger；步骤身份是 `eventId + triggerId + stepId`，领域 `operationId` 由该身份稳定派生。一个步骤含多个领域事务时再追加稳定 `operationKey`。
- 同 `eventId` 同 canonical 载荷只返回原执行结果；同 ID 不同载荷必须以 `eventPayloadConflict/eventExecutionConflict` 拒绝。`expectedStateRevision/requestId/clientSequence` 是并发或传输元数据，不进入业务 operation fingerprint。
- Trigger 只消费事件和编排步骤，不生成或拥有业务事件事实；UI、HUD、地图和调试面板均只读投影。

EventJournal 存档必须包含稳定 `runId`、下一事件序号、全部未结束事件、关键已结束事件，以及每个 `eventId + triggerId + stepId` 的 `operationId/payloadFingerprint/status/result/logicalTime`。运行中恢复不得默认为成功；应保存可续跑位置或明确转为 interrupted，禁止以新 ID 静默重放。事件、执行和 OperationLedger 必须在同一 AuthoritySnapshot 原子恢复边界内。

事件 envelope 与提交元数据必须分层：`EventJournal.payload` 原样保存完整业务 payload，`stateId/stateType/stateRevision/eventSequence/operationId` 只进入独立 `commitMetadata`，不得平铺覆盖业务同名字段。`PostCommitNotificationBus` 写 Journal 和分派给消费者时必须使用同一组 `eventDefinitionId/source/actorRef/sceneId/payload`；任何事件类型适配（如 `item.picked → itemPickup`）都要通过 `sourceEvent*` 保留原 envelope，并把完整原 payload 展开给 matcher/action，再追加兼容 alias。复用 inherited eventId 时，type、definition、source、actor、scene 和完整原 payload 必须稳定双向等值，任何字段缺失、追加或改写都返回 `eventPayloadConflict`。

产品存档使用 schema 4，并把 `EventJournal + OperationLedger + StateRevisionStore + Quest/TaskGraph` 放入唯一 AuthoritySnapshot；Quest 顶层不得再保存第二份 TaskGraph。存档捕获前必须读取 live 状态，拒绝任意 OperationLedger `in-flight`、EventJournal `running` 或 ScenarioExecutionLedger `running`，不得先投影为成功再检查。Quest/Task checkpoint 只能在 command、PostCommit 事件、EventJournal step 和 Scenario ledger 全部封账后的下一宏任务请求；忙碌或 Promise rejection 按固定 0/500/1000/2000ms 有界重试，耗尽后明确提示手动保存。开发文件镜像失败必须逐字恢复覆盖前的 localStorage 原始字符串，损坏 JSON 也不得删除或规范化。

跨 Region 的内存回滚草稿不是产品存档：`captureSaveState({includeAuthority:false})` / `restoreSaveState(...,{restoreAuthority:false})` 不捕获或恢复 Authority，也不恢复正在执行的 Trigger 技术账本；恢复入口单独保存旧 Region 实际 loaded sceneId，禁止使用可能已被目标提交污染的 currentSceneId。checkpoint 失败若需要补偿 state revision，只允许 `rollbackCommitted(prepared)` compare-and-restore 当前 stateId，禁止恢复整个 StateRevisionStore 快照或清除其他 reservation。

TaskGraph 不是 EventJournal 的替代品：任务定义只声明事件 matcher、节点和边；任务存档保存 `TaskInstance`、节点状态、完成证据 eventId、并行汇合和已选分支。任务推进、奖励与 Checkpoint 必须进入现有 `QuestTransactionService → CommandGateway → LocalAuthorityAdapter` 权威事务，禁止 `notificationBus` 监听器直接修改独立 TaskGraph 状态。任务节点可使用 `all/any/n-of-m` 并行汇合；分支按稳定优先级选择首个满足规则，选择结果只提交一次并进入存档。

`task.start/task.event/task.track` 是 TaskGraph 唯一写入命令，统一使用 `quest:<actorId>` state revision；`task.track` 必须校验 instance.actorId，禁止跨 actor 修改。TaskGraph 只嵌入 QuestTransactionService 的 `quests` Authority provider，不再注册第二个独立 snapshot provider。任务定义含非空 reward 时必须存在原子 `prepareReward/commit/rollback` 参与者，否则以 `rewardSettlementUnavailable` 拒绝，禁止“任务完成但奖励未发”。TaskGraph 定义运行时、CandidateRuleValidator 和 TaskGraphEditor 必须复用 `validateTaskGraphDefinitions()`，并通过标准 `task.command` 从数据驱动 Trigger 启动。

实施顺序固定：

1. 完成 EventJournal 的全局 eventId、执行状态、事件/operation 幂等边界和 AuthoritySnapshot 恢复。
2. 扩展现有 QuestTransactionService/QuestSystem 承载 TaskGraph 的 TaskInstance、节点、并行、分支、奖励和 Checkpoint；不得保留第二份独立任务权威。
3. TaskGraph Canonical Schema、ContentValidator 和 TaskGraphEditor 共用同一图校验器；保存只能通过共享 CanonicalEditorSession patch `taskGraphs` 后提交。校验覆盖重复 ID、入口/终点、引用、不可达节点、无界循环、并行参数、分支目标/组合冲突和事件 matcher。
4. 最后接正式任务 HUD、地图追踪和 EventJournal/TaskGraph 存档调试视图；三者只读同一任务投影，不保存第二份任务状态。

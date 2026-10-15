# 任务清单：quest-reorder-consistency

> 规格：`.kiro/specs/quest-reorder-consistency/spec.md`
> 约束：不跑测试；改动不提交（等用户游戏内验证）；每步完成后 Grep/Read 核实已写入。

## T1 S01S02SceneFlow 去硬编码（spec A1-A5）

- [x] A1 `onInitialToolsPickedCommitted`：删 `initialToolsPicked !== true` 守卫子句与 `complete('s01.pickup')`；保留场景守卫、startFuelCountdown、野果丛 `_ensureSpawnedPlacement`
- [x] A2 `campfireLit` 操作：删除 findAxe 提交+工具包生成分发；注释同步修正（新链序下由 dropInitialTools 负责）
- [x] A3 新增 `dropInitialTools()`（提交 findAxe → revealPending → `_revealInitialToolKit()` 退避 catch）+ 操作分发注册
- [x] A4 `onBerriesGatheredCommitted`：删木材 eager spawn（保留守卫+startFuelCountdown）；`_createWoodGatherContinuation` 保留（每帧恢复 L2134 仍引用）
- [x] A5 `_deriveRestoredTutorialId`：按新链序重排 5 行推导
- [x] 额外：每帧恢复窗两处旧链序条件修正（野果恢复 → campfireLit；木材恢复 → initialToolsPicked）
- [x] 验证：`node --check` 通过；grep 确认 dropInitialTools 分发/方法/数据引用闭合、flow 无 s01.pickup complete 残留

## T2 引擎事实提交重评估钩子（spec B1-B3）

- [x] B1 `CanonicalStateTransactionService.js`：构造器接 `afterCommitted`（函数校验，默认 null）；成功提交路径 return 前 try/catch 调用
- [x] B2 `DataDrivenPrologueScene.js`：服务配置加 `afterCommitted: () => this._schedulePlacementReassessment()`
- [x] B3 同文件新增 `_schedulePlacementReassessment()`（`_placementReassessmentQueued` 标志防抖 + `resourceScope.setTimeout(flush, 0)` + `placements.spawn()` catch 告警）；构造器初始化标志
- [x] 验证：`node --check` 两文件通过

## T3 数据对齐（spec C1-C11）

- [x] C1 quests.json `findTools` 补 mapTargets（S01-pickup-worn-axe + S01-pickup-skinning-knife）
- [x] C2 quests.json `after.findTools.1` 补 mapTargets（S01-node-berry-1）
- [x] C3 quests.json 新增 `after.eatBerry.3` action（operation: dropInitialTools，eatBerry 后、after.eatBerry.1 前）
- [x] C4 quests.json 新增 `after.eatBerry.4` tutorial（显示 s01.pickup，after.eatBerry.1 后）
- [x] C5 quests.json 新增 `after.findTools.3` tutorial（complete s01.pickup，findTools 后、after.eatBerry.2 前）
- [x] C6 triggers.json `trg_s01_light_campfire` 删 `show-tutorial-s01-pickup` do 步
- [x] C7 commands.json `story.s01.berryGathered` when 删 `initialToolsPicked === true` 子句
- [x] C8 commands.json `story.s01.berriesGathered` when 删 `initialToolsPicked === true` 子句
- [x] C9 commands.json `story.s01.findAxe` when：`campfireLit === true` → `berryEaten === true`
- [x] C10 S01.json 斧头/剥皮刀 spawnWhen → `s01Survival.berryEaten`（L952/L1023 核实）
- [x] C11 S01.json 木材×3 spawnWhen → `s01Survival.initialToolsPicked`（L966/L984/L1002 核实）
- [x] 验证：四 JSON `JSON.parse` 通过；交叉 grep 引用闭合

## T4 编辑器联动扩展（spec D1-D2）

- [x] D1 `QuestSceneConditionSync.js`：带 mapTargets 的非目标步骤纳入联动（统一「最近前序目标事实」规则）；updates 过滤条件不变（仍限 changedByReorder）
- [x] D2 `computeConditionSyncPlan` 返回 `orphans`（简单等值门 + 门控于本任务目标事实 + 未被任何步骤 mapTargets 引用）
- [x] 验证：`node --check` 通过

## T5 审查栏（spec D3-D4）

- [x] D3 `_conditionSyncHtml`：三组呈现（updates 一键应用 / 静态不一致逐条+全部应用 / orphans 断链提示仅提示）；展示门槛 = 三组任一非空
- [x] D4 `_applyConditionSync(selected)` 支持子集应用；`_applySingleSyncLink` 单条定位；绑定 `sync-apply` / `sync-apply-statics` / `sync-apply-one`（data-sync-scene + data-sync-placement）；`conditionSyncPlanSignature` 扩展覆盖三组（忽略状态随内容变化失效）
- [x] 验证：`node --check` 通过；grep 确认事件绑定与渲染分支齐全

## T6 总核验（不跑测试）

- [x] 全部改动 .js `node --check` 通过（S01S02SceneFlow / DataDrivenPrologueScene / CanonicalStateTransactionService / QuestSceneConditionSync / QuestWizardEditor）
- [x] 全部改动 .json `JSON.parse` 通过（quests / commands / triggers / S01）
- [x] 引用闭合终检：`dropInitialTools`（flow 方法 L928 ↔ 分发 L1867 ↔ quests after.eatBerry.3）、`s01.pickup`（quests after.eatBerry.4 显示 ↔ after.findTools.3 完成 ↔ flow 无 complete 残留 ↔ trg_s01_light_campfire 已移除）、`berryEaten`（commands findAxe when ↔ S01.json 斧/刀 spawnWhen ↔ flow 教程推导 L409）、`initialToolsPicked`（S01.json 木材 spawnWhen ↔ 恢复窗 L2129 ↔ 教程推导 L408）；恢复窗 axeDropped 补偿（L2084）因 findAxe 事务改门自然退化为吃果后触发
- [x] 汇报改动摘要，等用户游戏内验证后再 commit

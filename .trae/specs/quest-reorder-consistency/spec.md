# 任务拖动联动一致性修复（方案 1 + 2）

> 用户已确认方案 1（数据补全 + 联动扩展）与方案 2（运行时去硬编码 + 事实提交重评估钩子）。
> 本规格在探索完成后把方案落成决策完备的变更清单，并纳入探索中发现的 3 个新链序软锁修复。

## 1. 背景与问题

用户在任务编辑器中把 S01 求生链拖成新顺序后（野果采集提前、找工具后移）：

- **现象1**：「开放野果采集」（after.findTools.1）拖到点火后，野果丛出生条件未联动；运行时操作 `afterInitialToolsPicked` 仍被 `initialToolsPicked !== true` 守卫拦截。
- **现象2**：第 10 步「找齐斧头和剥皮刀」的斧头/剥皮刀一开场（点火后）就显示。

### 根因链（探索结论）

1. `S01S02SceneFlow.campfireLit` 操作处理器在点火时**提交 `story.s01.findAxe`（写 axeDropped=true）并立刻 `_revealInitialToolKit()` 权威生成双工具**——权威通道越过任何 spawnWhen，只改 spawnWhen 拦不住（真正的现象2元凶）。每帧恢复逻辑（`campfireLit && axeDropped && !initialToolsPicked` 每 0.75s 重试）会持续补生成。
2. `onInitialToolsPickedCommitted`（操作 afterInitialToolsPicked，现由 lightCampfire 段在点火时编排）被 `initialToolsPicked !== true` 事实守卫拦截（现象1）。
3. **软锁A**：`story.s01.berryGathered` 与 `story.s01.berriesGathered` 事务 when 均要求 `initialToolsPicked === true`——新链序采集在拾工具之前，事务被拒 → gatherBerries 永不完成。
4. **软锁B**：`story.s01.findAxe` 的提交点在点火链内；把 when 改到 `berryEaten` 而不迁移提交点 = 点火时被拒且无人补交 → 工具永不落地。
5. **教程断裂**：s01.pickup 点火时显示（trg_s01_light_campfire L465-472）、工具拾取后完成（flow L900）——新链序下显示时无拾取物可练、完成点也不存在 → 教程空转卡死。
6. 编辑器联动缺口：`QuestSceneConditionSync.computeConditionSyncPlan` L121 只处理 `type === 'objective'` 的步骤，带 mapTargets 的非目标步骤不参与；审查栏 updates 只含本会话拖动过的步骤，静态不一致只能看不能一键应用。

## 2. 统一联动规则（1b 的核心决策）

任一带 mapTargets 的步骤（目标或非目标），**期望出生门控 = 数组中最近的前序目标提交的事实**：

- 目标步骤：对象须在目标开始时可交互 → 前一目标完成时生成（如 gatherWood 的木材 ← initialToolsPicked）。
- 非目标步骤：对象在其所属段驱动目标完成时生成（如 after.findTools.1 的野果丛 ← campfireLit）。

两式同构，同一遍历（跟踪 lastSeenObjective）即可计算。

## 3. 变更清单（决策完备）

### A. 运行时去硬编码（方案2a — S01S02SceneFlow.js）

| # | 位置 | 变更 |
|---|------|------|
| A1 | L897-911 `onInitialToolsPickedCommitted` | 守卫退化为场景守卫+幂等（去掉 `initialToolsPicked !== true`）；**删除** `complete('s01.pickup')`（生命周期移入任务数据）；保留 startFuelCountdown + 野果丛 eager spawn（2b 的带扣，幂等） |
| A2 | L1887-1910 `campfireLit` 操作 | **移除** L1901-1908（findAxe 提交 + 工具包生成分发）；保留事实提交+点燃表现；修正 L1888-1889 注释 |
| A3 | 新增 `dropInitialTools()` | 从 A2 提取：提交 `story.s01.findAxe` → `initialToolRevealPending = true` → `_revealInitialToolKit()`（退避 catch）；在 L1843-1851 操作分发处注册 `if (operation === 'dropInitialTools')` |
| A4 | L913-926 `onBerriesGatheredCommitted` | **移除木材 eager spawn**（`_createWoodGatherContinuation` + `_ensureSpawnedPlacement` + pendingReveal 登记）——新链序木材应等 initialToolsPicked，且权威通道会越过 spawnWhen 造成提前显示；保留场景/事实守卫 + startFuelCountdown；`_createWoodGatherContinuation`（L634-641）无他处引用则删除 |
| A5 | L404-412 `_deriveRestoredTutorialId` | 新链序重排：`!campfireLit→s01.move`；`campfireLit&&!berriesGathered→s01.gather`；`berriesGathered&&!berryEaten→tutorial-001`；`berryEaten&&!initialToolsPicked→s01.pickup`；`initialToolsPicked&&!woodGathered→s01.chopWood`（attack/durability 两行不动） |

不变项：每帧恢复 L2073-2087（`axeDropped` 只会在 berryEaten 后为 true，条件自然退化为正确时机）；`_revealInitialToolKit` L324-337 与 `_ensureSpawnedPlacement` 幂等语义不动。

### B. 引擎钩子（方案2b — 事实提交 → 放置点重评估）

| # | 文件 | 变更 |
|---|------|------|
| B1 | `src/systems/CanonicalStateTransactionService.js` | 构造器接收 `afterCommitted` 回调（`typeof === 'function'` 才存，默认 null）；在成功提交路径（L278 return 前）`try { this.afterCommitted?.(definition.id) } catch { /* 不阻塞提交 */ }` |
| B2 | `example/sanguo_zhangjiao/scenes/DataDrivenPrologueScene.js` L1401 | 服务配置加 `afterCommitted: () => this._schedulePlacementReassessment()` |
| B3 | 同文件 | 新增 `_schedulePlacementReassessment()`：`_placementReassessmentQueued` 标志防抖（`this.resourceScope?.setTimeout(flush, 0)`），flush 调 `this.context.services.placements?.spawn()` 并 catch 告警；构造器初始化标志为 false |

设计要点：
- `spawn()` 空选择器 = 全量幂等评估（spawnMatching 已生成 → alreadySpawned no-op；story 组仍查账本；condition 组查 spawnWhen）——**只补生成，不做条件翻假的自动 despawn**（despawn 维持显式触发器权威，符合方案A互斥链）。
- 防抖到下一 tick：避免在事务提交的同步窗口内重入（spawn 可能再写状态）。
- 幂等重放触发回调无害（重评估本身幂等）。
- 效果：野果丛（campfireLit）、双工具（berryEaten）、木材（initialToolsPicked）随各自事实提交即生成，消除「改了 spawnWhen 必须重载场景」的隐性依赖。

### C. 数据对齐（quests.json / commands.json / triggers.json / S01.json）

| # | 文件 | 变更 |
|---|------|------|
| C1 | quests.json L90-95 `findTools` | 补 `mapTargets: [S01-pickup-worn-axe, S01-pickup-skinning-knife]`（联动期望门控 → berryEaten） |
| C2 | quests.json L38-46 `after.findTools.1` | 补 `mapTargets: [S01-node-berry-1]`（联动期望门控 → campfireLit，现值一致） |
| C3 | quests.json eatBerry 段 | 新增 action 步骤 `after.eatBerry.3`（`operation: dropInitialTools`，title 投放斧头与剥皮刀），置于 eatBerry 之后、after.eatBerry.1 之前 |
| C4 | quests.json eatBerry 段 | 新增 tutorial 步骤 `after.eatBerry.4`（显示 s01.pickup），置于 after.eatBerry.1 之后 |
| C5 | quests.json findTools 段 | 新增 tutorial 步骤 `after.findTools.3`（`operation: complete`, tutorialId s01.pickup），置于 findTools 之后、after.eatBerry.2 之前 |
| C6 | triggers.json L450-481 `trg_s01_light_campfire` | 移除 do 链第 3 步 `show-tutorial-s01-pickup`（L465-472） |
| C7 | commands.json L82-116 `story.s01.berryGathered` | when 移除 `initialToolsPicked === true` 子句（软锁A） |
| C8 | commands.json L268-301 `story.s01.berriesGathered` | when 移除 `initialToolsPicked === true` 子句（软锁A） |
| C9 | commands.json L120-146 `story.s01.findAxe` | when 的 `campfireLit === true` → `berryEaten === true`（软锁B 的门；提交点由 C3/A3 迁移到 berryEaten 后） |
| C10 | S01.json 斧头 L941-957 / 剥皮刀 L1012-1028 | spawnWhen `s01Survival.axeDropped` → `s01Survival.berryEaten` |
| C11 | S01.json 木材×3 L958-1011 | spawnWhen `s01Survival.berriesGathered` → `s01Survival.initialToolsPicked` |

s01.pickup 教程新生命周期：berryEaten 提交 → 段动作投放工具（同时 2b 重评估按 spawnWhen=berryEaten 生成）→ 显示拾取教程 → 拾取双工具 → initialToolsPicked → findTools 完成 → 完成拾取教程 + 显示砍柴教程。

### D. 编辑器联动扩展（方案1b/1c）

| # | 文件 | 变更 |
|---|------|------|
| D1 | `editor/QuestSceneConditionSync.js` L121 | `if (step?.type !== 'objective') continue;` → 带地图引用的**非目标步骤**也参与联动计算（统一「最近前序目标事实」规则，见 §2）；自动改写集合（updates）仍只含 `changedByReorder === true` 的步骤 |
| D2 | 同文件 `computeConditionSyncPlan` | 返回值新增 `orphans`: 放置点 spawnWhen 为简单等值门、门控路径命中本任务目标事实、却未被任何步骤 mapTargets 引用 → `{sceneId, placementId, factPath}`（断链：场景对象被任务事实门控但任务不可见） |
| D3 | `editor/QuestWizardEditor.js` `_conditionSyncHtml`（L643-683） | 审查栏分三组呈现：① updates（本会话拖动 → 一键应用，现行为保留）；② 静态不一致（status mismatch 但非本会话拖动 → **新增逐项「应用此条」按钮** + 应用全部）；③ orphans 断链提示（muted，仅提示无按钮）。目标步骤缺 mapTargets 的被动提示并入 ③ 区文案 |
| D4 | 同文件 `_applyConditionSync`（L685-710）/ 按钮绑定（L742-746） | 支持子集应用：逐项按钮传单条 update 给 `applyConditionSyncPlan`；应用后重算计划 |

## 4. 权衡与备选

- **dropInitialTools 新操作 vs 复用 afterInitialToolsPicked**：不复用——该操作名在新链序语义已变为「开放野果采集」（点火段），工具投放是独立时点（吃果段），混用会再造顺序语义分散（本次的病灶）。
- **2b 挂点选事务服务成功路径 vs 订阅 state.transaction 事件流**：后者需要摸清事件分发链（触发器系统多一层），前者是提交权威点、单文件小改、天然覆盖所有事实通道（含调试补交）。
- **spawnWhen 保留 vs 全量 story 账本化**：双工具/野果/木材是「条件模式」——spawnWhen 是持久门（存档一致性），段动作/2b 是即时性；不迁移到 story 账本（那是狼群式剧情性离场用的）。
- **不自动 despawn 条件翻假对象**：despawn 互斥链已定（tombstone→timed→持有→story/condition 现状语义），重评估只补生成，避免「条件翻转误杀已交互对象」的新类 bug。

## 5. 验证步骤（用户要求：不主动跑测试）

1. 四个 JSON 用 `node -e` 临时脚本（或 .cjs）`JSON.parse` 校验合法性。
2. 改动的 .js（S01S02SceneFlow.js、DataDrivenPrologueScene.js、CanonicalStateTransactionService.js、QuestSceneConditionSync.js、QuestWizardEditor.js）逐一 `node --check`。
3. 引用闭合 grep：`dropInitialTools`、`after.eatBerry.3/4`、`after.findTools.3`、`s01.pickup`、`berryEaten`、`initialToolsPicked` 在全项目交叉核对无悬空引用（特别是 triggers/commands/quests/flow 四处对账）。
4. 不运行测试套件（用户明令）；已知影响见 §6。

游戏内人工验收口径（改动不提交，等用户验证）：
- 开场点火后：只有野果丛出现，**无斧头/剥皮刀**，采集教程 s01.gather 显示。
- 采 1 颗野果 → 提示食用 → 吃下 → 斧头/剥皮刀落地 + s01.pickup 教程显示。
- 拾取双工具 → s01.pickup 完成 + 砍柴教程显示 + 木材出现。
- 编辑器：拖动任一带 mapTargets 步骤 → 审查栏联动；静态不一致（如未拖动步骤的旧门控）逐项可应用。

## 6. 风险与已知影响

- **测试断言**：此前修复的 69 用例中若有断言 `berryGathered/berriesGathered 需 initialToolsPicked` 或点火链提交 findAxe，会随本次语义修正而失败——属预期过时，待用户要求跑测试时同步更新断言（本次不跑不改）。
- **段编排依赖**：dropInitialTools 由 eatBerry 段驱动；段执行机制与 after.findTools.1 在点火段触发是同一机制（用户会话已验证其工作）。兜底：spawnWhen=berryEaten 使工具生成不依赖该操作；axeDropped 事实提交依赖段动作，为既有模式一致性。
- **性能**：每次事实提交触发一次全量放置评估（校验+匹配，S01 放置点量级小）；防抖合并提交风暴；仅在确实刷出新实体时打日志。
- **回滚**：变更互相独立可分文件回退；A2/C9 是一对（提交点+门），C3 是 A3 的数据引用，三者需同批落地。

## 7. 不做的事（scope 边界）

- 不重命名 `afterInitialToolsPicked` 操作名 / `after.findTools.1` 等既有步骤 ID（避免编辑器基线与引用抖动）。
- 不做交互门控、不动狼群 story 账本模式、不动 despawnPlacements 语义。
- 不改 eatBerry 既有拾取/进食交互机制。
- 不自动应用静态不一致到场景文件（仍由审查栏人工点击）。

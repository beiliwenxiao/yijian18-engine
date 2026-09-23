# 任务中心制架构设计文档（Quest-Centric Architecture）

> 交付物：本设计文档落盘为 `d:\yijian18-engine\.kiro\steering\quest-center-design.md`，作为 `progression-implementation.md` 的姊妹篇进入项目事实源。
> 实施不在本次范围内——按阶段①~④另行启动。

---

## 1. 背景与问题

### 1.1 用户诉求（原话）

> 对策划来说，应该是创建任务，对任务设置触发条件，过程，完成条件。后续任务。前置任务。等等。触发器、教程、对话，都应该只是任务的功能的一部分，而且可以方便的选择搭配。而不是像现在一样混乱。

### 1.2 现状问题清单（P1~P7）

| # | 问题 | 证据 |
|---|------|------|
| P1 | **事实表述六轨并行**：同一件事（如"采集到木材"）要在 StoryState 事实（`state.transaction` writes）、应用事件（`gathering.completed`）、教程完成、任务节点进度、触发器 when、对话选项 dispatcher 六处各自表述，无统一出口 | 木材任务死锁的根源 |
| P2 | **任务激活时不追认已成立事实**：任务图节点 active 前发生的事件永久丢失，读档后靠场景层 `reconcileTaskFacts` 补丁对账 | [BaseGameSceneSetup.js L400-433](file:///d:/yijian18-engine/example/sanguo_zhangjiao/scenes/BaseGameSceneSetup.js#L400-L433) —— 场景层在做系统层的事（抽象倒置） |
| P3 | **事件无目录契约**：eventMatcher 可用的事件类型与 payload 字段靠 triggerCatalog 隐式约定，策划无从得知 | TaskGraphEditor 的 eventType 下拉靠 identityFields 拼凑 |
| P4 | **教程完成事实多轨**：completedTutorials / signalProgress / onComplete 回调各说各话 | TutorialSystem.js |
| P5 | **幂等散落**：eventIds 去重、firedOnce、reconcile 固定 eventId、ledger 各处自洽 | TaskGraphSystem/TriggerSystem 各自实现 |
| P6 | **编辑器四段割裂**：一个任务要在 TaskGraphEditor（任务图）+ TriggerEditor/TriggerStorylinePanel（编排）+ TutorialEditorPanel（教程）+ DialogueGraphEditor（对话）四个页面间拼装 | editor/ 目录 |
| P7 | **定义-存档兼容粒度**：已解决（per-trigger fingerprint），但任务图定义变更仍无对等机制 | TriggerSystem.js L1148 |

### 1.3 hero SLG 借鉴结论（已分析确认）

- **目标类型注册目录** ⭐ 最值得引入：目标种类集中登记（事件 matcher、进度字段、展示名），任务节点只填"类型+目标ID+数量"。
- **四表分离**（task_base/accept/complete/award）→ 映射为单任务定义的四个区块（接取/流程/完成/奖励）。
- **NPC 挂任务 + get_task_id 任务链边** → 阶段④。
- 已拥有等价物：条件 DSL（when/writes）、两阶段提交、任务链边（next）、领奖幂等。
- 暂不做：周期重置（reset_period）、资源跳过（skipCost）。

---

## 2. 现状盘点（探索确认的真实接口）

### 2.1 运行时原语（全部保留复用，不重写）

| 系统 | 关键接口 | 位置 |
|------|---------|------|
| **TaskGraphSystem** | 定义 `{id,title,entryNodeId,reward,checkpoint,nodes[]}`；节点 objective 持 `eventMatcher{type,payload}` + `requiredCount` + `progressBy`；`consumeEvent` 幂等（eventIds）+ 影子事务提交；`getProjection` 供 HUD | [TaskGraphSystem.js L47-58, L277-320, L434-488](file:///d:/yijian18-engine/src/systems/TaskGraphSystem.js#L277-L320) |
| **TriggerSystem** | 定义 `{id,when,if,do[],once,cooldown,reentryPolicy}`；`_runSteps` 串行 await + 每步 if 守卫 + branch + 教程 await 轮询；do 经 `actionDescriptorRegistry` + 命令层 | [TriggerSystem.js L896-1006, L743-826](file:///d:/yijian18-engine/src/systems/TriggerSystem.js#L896-L1006) |
| **TutorialSystem** | `showTutorial`（槽忙入 pendingTutorials FIFO）、`notify(signal)` 按 signalRules 计数完成 | TutorialSystem.js L236, L259-263 |
| **DialogueSystem** | `startDialogue` 返回 bool；选项经 `setChoiceDispatcher` 派发器异步提交后 commit | DialogueSystem.js L116-149, L227-295 |
| **QuestTransactionService** | `QUEST_COMMANDS`（quest.command/accept/advance/abandon/turnIn/track…）；`_executeTaskGraph` 影子提交 + 发布 `task.started/advanced/completed` | [QuestTransactionService.js L35-46, L209-303](file:///d:/yijian18-engine/src/systems/QuestTransactionService.js#L209-L303) |
| **CanonicalStateTransactionService** | 按 definitionId 解释 `commands[].transaction{when,writes}`，写黑板/StoryState，发布 `state.transaction.committed` | [CanonicalStateTransactionService.js L47-290](file:///d:/yijian18-engine/src/systems/CanonicalStateTransactionService.js#L47-L290) |
| **事件总线** | service 返回 committedEvents → PostCommitNotificationBus 有序分派 → SceneApplicationEventBridge 按 eventId 去重 + 重试 → `onContentEvent` 转发任务系统 | SceneApplicationEventBridge.js L18-338；BaseGameSceneSetup.js L1010-1058 |

### 2.2 数据与注入点

- `game.project.json` 顶层键（行号）：quests **L2282（空数组，尚无内容）**、taskGraphs L2283（2 条）、dialogues L2133（10 条）、triggerCatalog L2586、triggers L3475（113 条）、tutorials L6053（17 条）、commands L7922（40 条 state.transaction）。
- **taskGraphs 注入点已存在**：GameSceneRuntime `config.taskDefinitions` 构造 TaskGraphSystem（[GameSceneRuntime.js L176-185](file:///d:/yijian18-engine/src/core/scene/GameSceneRuntime.js#L176-L185)）。
- **triggers 注入点已存在**：GameLoader → `triggerSystem.registerAll`（GameLoader.js L491）。
- StoryState = 黑板键 `variables.storyState`（game.project.json L662），`writes target:'story'` 写入（CanonicalStateTransactionService.js L122-125）。
- 编辑器：TaskGraphEditor.js（scene-workflow.html 的 task 标签，identityFields 下拉 L212-295）、TriggerStorylinePanel.js（动作编排 L326-380）、QuestEditor.js **已存在但需执行时确认现状**；保存统一 `fetch POST /api/save-file`。

### 2.3 关键结论

任务图事实的唯一入口是 `state.transaction` 应用事件 → bridge → `consumeTaskEvent`；教程/对话已事件驱动化；触发器是唯一编排层。**任务中心制 = 在这三者之上加一层"策划视角的编排单元 + 编译器"，运行时原语零重写。**

---

## 3. 目标架构

### 3.1 核心理念

```
策划视角：任务（Quest）= 唯一编排单元
├─ 元信息：id / title / 描述 / 分类
├─ 归属（scenes）：所属场景 sceneIds（跨场景任务可多选，留空=全局）
├─ 接取（accept）：前置任务 + 事实条件 + auto/manual + NPC 绑定
├─ 流程（steps）：有序步骤，五种可插类型自由搭配：
│   ├─ dialogue   播对话（await 可选）
│   ├─ tutorial   播教程（await 可选）
│   ├─ objective  目标（目标类型目录：类型+目标ID+数量+progressBy）
│   ├─ action     触发器动作（复用 triggerCatalog 动作目录）
│   └─ branch     条件分支
├─ 完成（completion）：目标全达成即完成（首版）
├─ 奖励（rewards）：状态事实 / 物品
└─ 关系：next[] 后续任务
```

**已裁定：运行时编译（方案 B），不做编译期展开（方案 A）。**
理由： quests[] 是定义的单一来源，编辑器直接编辑，无生成物冗余、无反编译问题；编译产物（taskGraph 定义 + 触发器定义）只在内存中喂给现有注入点（2.2 已确认两个注入点都在）；per-trigger fingerprint 存档兼容机制对编译产物自动生效。

### 3.2 Quest 定义 v2 Schema（game.project.json 新增 quests[] 条目结构）

```json
{
  "id": "quest.s01.survival",
  "title": "荒野求生",
  "description": "采集木材、点燃篝火、击杀野狼",
  "category": "main",
  "scenes": ["S01"],
  "giver": { "npcId": "S01-npc-elder", "dialogueId": "dlg_s01_elder_intro" },
  "accept": {
    "mode": "auto",
    "when": { "type": "fact", "fact": "story.s01.survivalIntroCommitted", "equals": true }
  },
  "steps": [
    { "id": "intro",  "type": "dialogue",  "dialogueId": "dlg_s01_intro", "await": true },
    { "id": "tutMove","type": "tutorial",  "tutorialId": "tut_s01_move", "await": true },
    { "id": "wood",   "type": "objective", "objectiveType": "gather.item",
      "target": "resource.wood", "requiredCount": 3, "progressBy": "accepted",
      "title": "采集木材" },
    { "id": "spawnWolf", "type": "action", "action": "commitStoryWhenReady",
      "params": { "definitionId": "story.s01.refuelCampfire", "firstWolfCount": 3 } },
    { "id": "wolf",   "type": "objective", "objectiveType": "kill.enemy",
      "target": "S01-first-wolf", "requiredCount": 1, "title": "击杀野狼" }
  ],
  "completion": { "mode": "allObjectives" },
  "rewards": [
    { "type": "state", "definitionId": "story.s01.survivalCompleted" }
  ],
  "next": ["quest.s02.summons"]
}
```

- `accept.when` 三种来源：`fact`（事实目录）/ `questCompleted`（前置任务）/ `event`（原始事件）。
- `objective.target` 的候选项由目标类型目录的 identityFields 驱动（复用 TaskGraphEditor 现有 `_selectionValues` 机制）。
- `action` 步骤复用 triggerCatalog 的 paramsSchema 结构化参数（含 number input + datalist 教训：新增参数必须同步登记 paramsSchema.properties）。

### 3.3 QuestRuntime 编译管线（新引擎模块 `src/systems/quest/QuestRuntime.js`）

**编译模型（务实版）：1 个 Quest → 1 个 taskGraph 定义 + N 个触发器。TaskGraphSystem / TriggerSystem 零改动。**

```
steps: [D1, T1, O1, A1, O2, T2, O3]
              │ 编译
              ▼
① accept 触发器:   when(accept.when 编译) → do[quest.accept]
                   （quest.accept 走 QuestTransactionService → taskGraph 实例 start）
② 段编排触发器:    objective O1 的 eventMatcher 同时作为：
                   - TaskGraph 节点的 eventMatcher（进度跟踪，现状机制）
                   - 段编排触发器的 when（O1 达成 → do[A1]）
③ 编排段:          非objective 步骤连续段 → 一条触发器的 do 链
                   （dialogue/tutorial 带 params.await:true —— 复用 TriggerSystem
                     _runSteps L970-977 的 _awaitTutorialHide 现有机制）
④ completion 触发器: when(task.completed + payload.questId) → do[奖励事务, quest.complete]
```

编译规则：

| Quest 步骤 | 编译产物 |
|-----------|---------|
| `objective` | taskGraph 的 objective 节点（eventMatcher 从目标类型目录模板生成） |
| 连续非 objective 段 | 一条编排触发器（前置 objective 的 eventMatcher 作 when，do 链带 await） |
| 首段（接取后立即执行的非 objective 步骤） | when = `task.started` + payload.questId |
| 末尾 completion | completion 触发器（task.completed 驱动） |
| `accept.when.fact` | state.transaction 事件匹配（fact 目录提供 definitionId） |
| `scenes`（全部编译产物） | 编译出的触发器统一继承 `editorScope.sceneIds = quest.scenes`（与现有触发器 editorScope、教程 scope.sceneIds 约定一致）；留空 = 全局（跨场景主线任务） |

**场景归属语义**：sceneIds 同时约束三处——① 编译触发器的 editorScope（只在归属场景注册生效）；② 编辑器按场景筛选/分组（复用 Trigger剧情线总览 的 scene 分组模式）；③ NPC 挂任务与任务列表只展示当前场景归属的任务。任务实例进度状态全局持久（存档不随场景丢弃），跨场景任务（多选 scenes）各场景均注册。

**确定性要求**：编译必须确定性（同定义同产物），使编译出的触发器定义 fingerprint 稳定，per-trigger fingerprint 存档兼容机制（TriggerSystem.js L1148 已实现）自动覆盖 quest 定义变更——改 quest 参数后读档，仅受影响触发器执行痕迹重置，其余历史保留。

### 3.4 事实目录（Fact Catalog）—— 解决 P1/P2/P3

新增 `src/systems/quest/FactCatalog.js`：

- **自动派生**：从 `commands[]` 的 state.transaction 定义（`writes target:'story'` 的 path）派生事实清单——`reconcileTaskFacts`（BaseGameSceneSetup.js L400-433）已有此推导逻辑，提升为共享目录构建器，场景层补丁归位系统层。
- **手工登记**：事件型事实（如 `gathering.completed(resource.wood)`）登记 `{id, label, source:'event', eventType, identityPayload}`。
- **统一消费方**：任务 accept 条件下拉、objective 目标候选、OnboardingUI 显示条件、教程 signalRules —— 全部从目录选取，策划在六处看到同一个事实名。

P2 的对账（reconcile）逻辑随之从场景层迁入 QuestRuntime（读档后按任务图收集 state.transaction matcher → StoryState 对账补喂），行为与现状等价。

### 3.5 目标类型注册目录（阶段①核心，新模块 `src/systems/quest/ObjectiveTypeRegistry.js`）

每种目标类型登记：`{type, label, eventMatcher 模板, identityFields, progressBy 默认值, 编辑器展示名}`。首批登记 S01 四类：

| type | eventMatcher 模板 | identityFields | progressBy |
|------|------------------|----------------|------------|
| `gather.item` | `{type:'gathering.completed', payload:{itemId}}` | itemId（库内物品候选） | accepted |
| `kill.enemy` | `{type:'state.transaction', payload:{definitionId}}` | definitionId（命令清单） | — |
| `commit.fact` | `{type:'state.transaction', payload:{definitionId}}` | definitionId | — |
| `custom.event` | `{type, payload}` 原样 | 自填 | 可选 |

事件目录（EventCatalog）同步建立：登记应用事件类型的 payload 契约与来源 service，替代 triggerCatalog 的隐式约定。

### 3.6 编辑器设计（scene-workflow.html「任务」标签升级）

- 现有 task 标签（TaskGraphEditor.js）升级为任务中心向导：五区块表单（元信息/接取/步骤/奖励/后续）+ 步骤列表（可拖排序）+ 「添加步骤」按类型下拉（dialogue/tutorial/objective/action/branch）。
- **归属场景**：元信息区块提供 scenes 多选（候选 = 项目场景清单），默认带当前编辑场景；任务列表支持按场景筛选/分组（复用 Trigger剧情线总览 的 scene 分组模式）。
- objective 步骤：类型从目标类型目录下拉，目标从 identityFields 候选下拉（复用 `_selectionValues`），数量为 number input。
- action 步骤：复用 TriggerEditor 结构化参数机制（paramsSchema + datalist）。
- **TriggerEditor / TriggerStorylinePanel 保留**：用于非任务编排（环境事件、篝火交互等），任务编排逐步收敛到任务向导。
- 执行前先读 `editor/QuestEditor.js` 确认现状（该文件已存在，探索未覆盖其内容）。

### 3.7 存档兼容

- 任务实例状态：TaskGraphSystem snapshot/restore 现状机制（L490-529）不变，questId → taskGraph definitionId 映射稳定即可。
- 编译触发器：进入 TriggerSystem 快照，fingerprint 绑定编译产物摘要；quest 定义变更 → 对应触发器重置执行痕迹（现状机制，无新增存档结构）。
- `quests[]` 为空或字段缺失时 QuestRuntime 直通（零行为变化），保证渐进迁移。

---

## 4. 四阶段实施路径（每阶段独立可交付）

| 阶段 | 内容 | 主要改动文件 | 验收 |
|------|------|-------------|------|
| ① 目标类型目录 | ObjectiveTypeRegistry + EventCatalog；TaskGraphEditor 下拉改目录驱动；S01 四个目标登记 | 新 `src/systems/quest/ObjectiveTypeRegistry.js`；`editor/TaskGraphEditor.js` | 单测 + 编辑器下拉展示目录条目 |
| ② Quest v2 + QuestRuntime | Schema、编译器（quest→taskGraph+triggers）、accept/completion 生成、FactCatalog、GameSceneRuntime 接线 | 新 `src/systems/quest/QuestRuntime.js`、`FactCatalog.js`；`src/core/scene/GameSceneRuntime.js` | 编译器单测（快照确定性、fingerprint）；空 quests[] 零回归 |
| ③ S01 试点迁移 | task.s01.survival + trg_s01_* → quest.s01.survival；reconcile 迁入 QuestRuntime | `example/sanguo_zhangjiao/game.project.json`；BaseGameSceneSetup.js | 现有 s01FirstWolfPack / taskGraphWoodProgress 等测试全绿；Canvas ARPG 手动验收（项目硬约束） |
| ④ 编辑器任务向导 + NPC 挂任务 | QuestEditor 升级五区块向导；giver 绑定 + manual 接取 | `editor/QuestEditor.js`、scene-workflow.html | 编辑器 E2E + 手动验收 |

---

## 5. 本次执行步骤（计划批准后）

1. 将本设计文档保存为 **`d:\yijian18-engine\.kiro\steering\quest-center-design.md`**（内容即第 1~4 章，与 .kiro/steering 既有文档风格对齐）。
2. 完成。实施按阶段①~④待用户指令后启动。

## 6. 验证方式

- 设计文档本身无代码改动，验证 = 文件落盘 + 内容与本章一致。
- 后续各阶段验证见第 4 章表格；跨阶段通用：现有测试基线（s01FirstWolfPack.test.js、taskGraphWoodProgress.test.js、TriggerSystem.test.js、PlacementSpawner.count.test.js）保持全绿。

## 7. 假设与裁定

- **运行时编译**而非编译期展开（3.1 已述理由）。
- **场景归属**（用户补充）：Quest 增加 `scenes` 字段，编译触发器继承 editorScope.sceneIds；留空 = 全局跨场景任务；任务实例进度全局持久（见 3.3 场景归属语义）。
- **非 objective 步骤不进 taskGraph**（藏进编排触发器 do 链）——HUD 仍只展示 objective（现状）；"步骤锚点节点"作为未来增强不做，避免 TaskGraphSystem 改动。
- **TriggerEditor 保留**，任务编排收敛但不强制迁移非任务触发器。
- 首版 completion 仅 `allObjectives`；branch 步骤编辑器首版降级为只读 JSON（复用 branch 条件编辑器教训）。
- `editor/QuestEditor.js` 现状待执行时确认，可能部分复用。

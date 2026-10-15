# Game Editor Data-Driven Architecture Fix Bugfix Design

## Overview

本设计修复运行时、canonical 配置和编辑器之间的所有权、事实源与提交边界不一致问题。现有 `ContentValidator`、`GameLoader.validateProjectCandidate()`、`SceneObjectProjector` 和 core `WorldStreamingManager` 提供了可复用基础；修复把校验、发布、命令执行、编辑提交和生命周期释放统一为普通模块化架构。

```text
磁盘 canonical 文件
  → parse → schema defaults/validation → reference validation → business-rule validation
  → immutable CanonicalSnapshot
  → DefinitionRepository / ProjectWorldIndex / Runtime Consumers
  → service-owned runtime state → ECS/UI projections

Schema-aware Editor
  → 完整候选 patch → 同一完整候选校验与 canonicalize
  → AtomicDiskTransaction（提交点）
  → committed in-memory snapshot → best-effort cache synchronization
  → success 或 committed-with-degradation 通知
```

基础架构保持 **ECS + JSON 数据驱动 + 普通模块化服务**。`CanonicalSnapshot` 是不可变定义事实源；`DefinitionRepository` 仅是从该快照构建的只读配置索引，不是业务模型或可写存储。运行时只保存最小可变状态，ECS 只保存高频世界投影。模块通过依赖注入连接，并明确采用 Command、Strategy、Factory、Facade、Adapter、Repository、Transaction Service、State Machine 与 Event Notification；本设计不是 DDD，不采用 CQRS，也不采用 Event Sourcing。

JSON 通过 capability composition 选择启动时登记的通用 Strategy；Factory 只负责从定义与最小运行态装配 ECS Component；Facade 提供兼容入口；Adapter 隔离 UI、Trigger、磁盘、缓存和 transport；Transaction Service 负责 `validate → prepare draft → commit → notify → checkpoint`；State Machine 明确定义 Quest、Trigger、编辑提交和 operation ledger 状态迁移；Event Notification 只在提交成功后发送 `CommittedEvent`/`ApplicationEvent`，用于通知和更新投影，不作为状态持久化来源，也不通过事件日志重建业务事实。

场景和世界中的任务、对话、教学、救援、战役、营建、载具、结局、传送与 checkpoint 编排全部收口到 `TriggerSystem`。`ScenarioDefinition` 只声明引用闭包与 scope；`TriggerGraph`/`ScenarioDefinitionIndex` 只从 `CanonicalSnapshot` 派生只读索引和编辑视图；`ActionDescriptor` 通过 `CommandAdapter` 产生标准命令。玩家、UI 和 Trigger 共用唯一命令执行链：

```text
Input/UI/Trigger ClientIntent
  → CommandGateway / AuthorityPort
  → LocalAuthorityAdapter（当前） | RemoteAuthorityAdapter（未来）
  → service-owned command handler
  → CommandResult + ordered CommittedEvent
  → ProjectionStore → ECS/UI
```

`LocalAuthorityAdapter` 是统一 command execution port，不是单机旁路，也不是任何 DDD/CQRS 模式的实现。它与未来远端适配器共享 command schema、definition revision、state revision、不变量、operationId 幂等、时钟、RNG、事件顺序和快照语义。调用方不得出现 `if (online)`。`ScenarioExecutionLedger` 只保存 Trigger 技术执行状态，不能成为 Story、Quest、Dialogue、Tutorial、Rescue、Battle、Construction、Vehicle 或 Ending 的业务事实。

`localStorage` 只保存带来源证明的最近成功磁盘刷新缓存，不决定 canonical ID 集合。`GameSceneRuntime` 与 `SceneSystemContainer` 是场景有状态能力的生命周期所有者；Assembler、Scene 字段和 Context 只提供构造计划或 borrowed projection。禁止 Singleton；需要全局唯一的能力由依赖注入根和生命周期容器创建、登记、借用与释放，不能依赖模块级全局实例或隐式静态注册表。

场景 class 只装配、转发 committed application event 和投影视图，不按场景类、`sceneId`、stage、内容 ID、硬编码计时器或回调推进游戏。ECS Component 不复制完整定义；service-owned runtime state、ECS 与定义通过稳定 `definitionId`、`instanceId`、`stateRevision` 和提交后通知连接。

当前交付仍是单机《三国张角传》，战役外部服务仍只有同契约 `LocalMockTransport`。本设计只提供 local-first/network-ready port，不新增 Go/server/slg 仓库，不接生产 WebSocket，不实现账号、房间、匹配、社交/组队、多人同步、预测回滚、断线会话恢复、数据库、云存档、部署或反作弊，也不声称支持在线玩家。

## Glossary

- **Bug_Condition (C)**：输入满足缺陷触发前提且当前实现 `F` 违反正确谓词的条件集合。
- **Property (P)**：修复实现 `F'` 对缺陷输入必须满足的结果谓词。
- **Preservation**：对 `¬C(X)` 输入保持既有可观察业务行为和已锁定架构边界。
- **Canonical Source**：磁盘上的 `game.project.json`、`_scene_order.json`、同 ID 场景 JSON 及项目引用配置。
- **CanonicalSnapshot**：完成 parse、schema、引用、业务规则校验和 canonicalize 的不可变配置快照，是本次提交内全部定义的事实源。
- **DefinitionRepository**：由一个 `CanonicalSnapshot` 构建的只读配置索引；按 kind/ID 查询，随快照整体 shadow replacement，禁止逐项写入和同 kind 同 ID 静默覆盖。
- **Service-owned Runtime State**：由明确服务拥有、仅含定义引用和最小可变字段的运行态；不持有 ECS Entity、DOM、Canvas 或表现对象。
- **Runtime Projection**：ECS 管理的世界运行投影，仅保存高频状态、定义引用和投影身份，可由已提交 service state 与快照重建。
- **ItemDefinition**：只读配置索引中的不可变物品定义，由稳定 ID、capabilities、Strategy 参数、引用和表现稳定 ID 构成。
- **ItemRuntimeState**：物品最小运行态总称；stack 保存 `definitionId + quantity`，instance 仅在耐久、绑定、charges 或容器内容存在时保存 `instanceId + minimal mutable state`。
- **Capability Composition**：JSON 通过 `stackable/consumable/equippable/throwable/container/questBound/fuel/cargo/tool/durable/placeable` 组合通用能力，而非新增内容子类。
- **ProjectWorldIndex**：只从已校验项目派生 Region、grid、边界、入口和 offset 的只读索引。
- **CanonicalSceneRepository**：磁盘优先读取场景列表和同 ID 文件，并管理受限缓存 fallback 与 provenance 的读取模块。
- **AtomicDiskTransaction**：在单一仓库锁和恢复日志下提交完整 canonical change set 的磁盘事务。
- **Schema-aware Editing**：由 schema 生成字段模型、按根路径 patch 完整候选并保留未编辑合法数据。
- **ScenarioDefinition / TriggerGraph / ScenarioDefinitionIndex**：前者只声明流程引用闭包；后两者是快照派生只读索引，不执行、不持久化。
- **ActionDescriptor**：启动时登记的通用动作契约，包含参数/结果 schema、副作用、operationId/checkpoint/reentry policy 与 adapter ID。
- **CommandAdapter**：把已校验 `ActionDescriptor` 参数转换为标准命令的薄适配器；只协调调用，不复制业务规则或事务。
- **ScenarioExecutionLedger**：Trigger 的技术状态机账本，记录 operationId、状态、timer、once/cooldown 和 definition revision。
- **QuestDefinition**：只读配置索引中的不可变任务定义，不包含玩家进度、计时或奖励结算状态。
- **QuestRuntimeState**：由 `QuestTransactionService` 拥有的最小任务运行态，包含 `questRuntimeId/definitionId/state/objectiveProgress/acceptedLogicalTime/remaining/repeat/rewardSettlementLedger/tracking/stateRevision`。
- **QuestResolver**：唯一纯任务推进算法；输入冻结定义、当前运行态、signal、logical time 与注入 RNG，返回新状态草稿和 ordered event draft。
- **ClientIntent / AuthoritativeCommand**：前者是非权威意图；后者是由 `CommandGateway` 补全并提交给 `AuthorityPort` 的标准命令。
- **CommandResult**：至少包含 `{ok,operationId,status,committed,code,stateId,stateRevision,eventFrom,eventTo,value,error}`。
- **CommittedEvent / ApplicationEvent**：提交成功后产生的有序通知，至少包含 `{eventId,stateId,stateType,stateRevision,operationId,logicalTime,type,payload}`；不得在提交前发送，不作为持久化事实源。
- **Projection**：由 authoritative snapshot、当前 service state、提交后通知和 `CommandResult` 更新的只读查询模型，不得反向覆盖 service state。
- **CommandGateway / AuthorityPort**：UI、Trigger、Scene 与服务的唯一命令执行边界；当前绑定 `LocalAuthorityAdapter`。
- **Definition / State / Event / Projection Revision**：`definitionRevision` 锁定配置；`stateRevision` 用于 expected revision；`eventSequence` 排序提交后通知；`projectionRevision` 表示消费位置，四者不得混用。
- **Logical / Monotonic / Wall Clock**：logical clock 排序业务提交；monotonic timer 计算 remaining；wall clock 只展示和诊断。
- **Authority RNG**：authority 注入的确定性随机源，以 `seed + stream/substream + counter` 保存并进入快照。
- **Operation Ledger**：authority 侧 operationId 幂等状态机，状态为 `claim/in-flight/committed/failed`。
- **Owned / Borrowed Dependency**：owned 由生命周期容器创建或接管并负责更新释放；borrowed 仅供引用，当前容器不得释放。

## Bug Details

### Bug Condition

设输入域为 `X`，当前实现为 `F`。对需求 1.1–1.12，令 `D_i(X)` 表示触发前提，`P_i(result,X)` 表示需求 2.i 的正确结果：

```text
C(X) = UNION(i = 1..12) { X | D_i(X) AND NOT P_i(F(X), X) }
¬C(X) = { X | X is in supported scope AND X NOT IN C }
```

```text
FUNCTION isBugCondition(input)
  SWITCH input.kind
    CASE SCENE_LIFECYCLE:
      RETURN canonicalSceneAssembled(input)
             AND dependencyReplacementOrDisposeOccurs(input)
             AND lifecycleTraceViolatesIdentityCountOrderOrIdempotence(input.actual)
    CASE CONFIG_RELOAD:
      RETURN configFieldChangedOrInvalid(input.candidate)
             AND reloadBypassesValidationConsumptionOrLastGoodRetention(input.actual)
    CASE PROJECT_WORLD:
      RETURN internallyConsistentWorldDiffersFromDemoDefaults(input.project)
             AND boundsEntryOffsetOrLocalCoordinatesAreIncorrect(input.actual)
    CASE SCENE_REFRESH:
      RETURN diskListOrSameIdFileChanged(input.disk)
             AND resultUsesStaleIdsOrUnqualifiedCache(input.actual)
    CASE EDITOR_MUTATION, CANDIDATE_SUBMIT:
      RETURN completeCandidateIsInvalidOrCommitPhaseFails(input)
             AND validationCommitMemoryCacheNotifyOrderIsWrong(input.actual)
    CASE WORLD_GRID_SAVE:
      RETURN gridContainsIdOutsideCanonicalClosure(input.candidate)
             AND candidateAcceptedOrAnyStateMutated(input.actual)
    CASE SCHEMA_EDIT, ROUND_TRIP:
      RETURN supportedFieldOrNestedFieldEdited(input)
             AND fullFieldValidationPreservationOrRuntimeConsumptionFails(input.actual)
    CASE CANONICAL_LOAD_FAILURE:
      RETURN sourceIsMissingUnreadableParseFailedOrSchemaFailed(input.source)
             AND lastGoodErrorClassificationOrSafeFallbackFails(input.actual)
    CASE JAVASCRIPT_AUDIT:
      RETURN trackedExecutableJavaScriptIsAudited(input.repository)
             AND scopeLineCountResponsibilityOrExceptionRuleIsWrong(input.actual)
    CASE CONTENT_EXTENSION:
      RETURN extensionIsExpressibleAndValidUnderExistingSchema(input.extension)
             AND (javascriptDiffOrRestartDeterminismRequirementFails(input.actual)
                  OR triggerIsNotSoleExecutionKernel(input.actual)
                  OR referenceContractsAreNotClosed(input.actual))
    CASE QUEST_RUNTIME:
      RETURN questDefinitionOrCommandIsProcessed(input)
             AND (definitionAndRuntimeStateAreMixed(input.actual)
                  OR duplicateDefinitionIdIsSilentlyOverwritten(input.actual)
                  OR questProgressBypassesSoleResolver(input.actual)
                  OR rewardStateRevisionOrCheckpointIsNotAtomic(input.actual))
    CASE COMMAND_EXECUTION:
      RETURN clientIntentOrTriggerSubmitsBusinessChange(input)
             AND (commandBypassesGatewayOrAuthority(input.actual)
                  OR requestAndOperationIdentityAreConflated(input.actual)
                  OR stateRevisionClockRngEventOrProjectionContractFails(input.actual)
                  OR retryCanDuplicateOrConflictCanMutate(input.actual))
    DEFAULT: RETURN false
  END SWITCH
END FUNCTION
```

```text
FUNCTION expectedBehavior(result, input)
  SWITCH input.kind
    CASE SCENE_LIFECYCLE:
      RETURN oneOwnerPerStatefulCapability(result)
             AND allConsumersReferenceInjectedIdentity(result)
             AND exactlyOnceOrderedUpdatesAndReverseDisposal(result)
             AND repeatedDisposeIsNoOp(result)
    CASE CONFIG_RELOAD:
      RETURN validCandidateIsFullyConsumed(result)
             OR invalidCandidateReturnsPathErrorsAndKeepsLastGood(result)
    CASE PROJECT_WORLD:
      RETURN derivedOnlyFromProject(result) AND localDataUnchanged(result)
             AND offsetAppliedExactlyOnce(result)
    CASE SCENE_REFRESH:
      RETURN diskDeterminesCurrentIdsAndContent(result)
             AND fallbackIsEligibleSameIdValidatedAndExplicit(result)
    CASE EDITOR_MUTATION, CANDIDATE_SUBMIT:
      RETURN followsValidateCanonicalizeDiskMemoryCacheNotify(result)
             AND obeysCommitPointRollbackAndPostCommitDegradation(result)
    CASE WORLD_GRID_SAVE:
      RETURN rejectsNonCanonicalIdsWithZeroMutation(result)
    CASE SCHEMA_EDIT, ROUND_TRIP:
      RETURN fullCandidateValidAndCanonicalEquivalent(result)
             AND stableIdsReferencesArraysUnknownLegalFieldsPreserved(result)
             AND committedDataIsConsumedAfterReload(result)
    CASE CANONICAL_LOAD_FAILURE:
      RETURN keepsLastGoodState(result) AND reportsSourceAndFailureCategory(result)
             AND exposesOnlyFailureOrNonCanonicalBlankTemplate(result)
    CASE JAVASCRIPT_AUDIT:
      RETURN scopeAndPhysicalLinesAreExact(result)
             AND eachNonExceptionUnitHasOneResponsibilityAndAtMost1000Lines(result)
             AND everyExceptionIsEvidenceBoundAndStillValid(result)
    CASE CONTENT_EXTENSION:
      RETURN executableJavaScriptDiffIsZero(result)
             AND diskRestartReplayIsDeterministic(result)
             AND scenarioIndexesDeriveFromCanonicalSnapshot(result)
             AND onlyTriggerSystemExecutesSchemaValidatedGenericCommands(result)
             AND failedChainsPreserveOnceCooldownAndServiceFacts(result)
    CASE QUEST_RUNTIME:
      RETURN immutableQuestDefinitionIsSeparateFromQuestRuntimeState(result)
             AND duplicateIdsAreRejectedBeforePublish(result)
             AND QuestResolverIsSolePureProgressionAlgorithm(result)
             AND questRewardLedgerStateRevisionAndCheckpointAreAtomic(result)
    CASE COMMAND_EXECUTION:
      RETURN allBusinessChangesUseCommandGatewayAndAuthorityPort(result)
             AND localAndRemoteAdaptersObeyTheSameContract(result)
             AND operationReplayConflictAndExpectedStateRevisionAreCorrect(result)
             AND clocksRngNotificationsProjectionsAndSnapshotsAreDeterministic(result)
    DEFAULT: RETURN true
  END SWITCH
END FUNCTION
```

### Examples

- 同一 `VehicleSystem` 被重复登记且 Assembler 又手工 `update()`：修复后 identity registry 拒绝第二个 owned 登记，每帧仅更新一次并逆序释放一次。
- optional non-null `followDistance:null`：返回根路径 `typeMismatch`，旧配置与运行实例不变。
- Region 改为 12×10、chunk 改为 960×540、入口改为非 reserved `S03`：边界和入口只来自项目，局部坐标不变，world offset 恰好应用一次。
- 磁盘把 `S05` 重命名为 `S05A` 而缓存仍有 `S05`：旧 ID 从索引和缓存删除，新 ID 从磁盘加载。
- 磁盘写入失败：正式内存和缓存不变，结果为 `diskCommitFailed`；磁盘已提交后缓存失败则返回 committed degradation，不回滚磁盘。
- 无语义编辑的 load→preview→export→import→save 经同一 schema canonicalize 后深相等。
- once trigger 的中间 action reject：链立即失败，不提交 once/cooldown；同 operationId 按幂等规则返回同一结果。
- 新增既有 capability 可表达的物品：只改变 canonical JSON/资源，完全重启后相同 snapshot、seed、clock、commands 得到相同 service state 和 committed notifications。
- 两个同 ID `QuestDefinition` 在快照发布前整体拒绝；空 `quests` 仍合法且不注入示例任务。
- 任务推进只由 `QuestResolver` 计算草稿，`QuestTransactionService` 原子提交 `QuestRuntimeState`、奖励 ledger、state revision、通知和 checkpoint。
- 同 operationId 以新 requestId 重试返回首次 committed result；同 operationId 改 payload 返回 conflict，service state、ledger、projection 均零修改。
- projection 收到重复 sequence 时幂等忽略，发现缺口则停止增量应用并请求 snapshot/缺失通知，不把客户端状态回写为事实。

## Expected Behavior

### Preservation Requirements

- 当前唯一 Demo 保持《三国张角传》、`schemaVersion:1`、`meta.version/meta.schema:3`、campaign 和 canonical `S01`–`S14`/`SXX-CNN`，旧 Act、`s0-*`、旧 campaign、旧职业与旧存档继续拒绝。
- A–D Region 当前 20×20 grid 内容不变；world layout 仍只来自 `game.project.json`，reserved 单元仍禁止加载、传送和恢复。
- Entity 是稳定 ID、Component 只持数据、System 持逻辑；普通模块化服务不取代 ECS 世界投影，也不形成第二运行世界。
- 物品/装备继续复用 `InventoryTransactionService`、`EffectResolver`、`LootResolver`、`EquipmentSystem.equipItem()/unequipItem()` 和 `BaseGameScene.onEquipmentChanged(messages,info)`；事件名称、`mainhand→weapon` 与回滚语义不变。
- 库存、战果、剧情、营建、载具、救援、结局和 checkpoint 继续遵循 `validate → prepare draft → commit → notify → checkpoint` 与 operationId 幂等/冲突规则。
- core `WorldStreamingManager` 仍是唯一流式状态权威，保持 generation/abort latest-wins、九宫格、完整预检、一次提交和严格逆序回滚。
- 磁盘同 ID 场景可读且校验成功时始终优先；缓存不成为审计或发布来源。
- Snapshot/SaveGame 两阶段恢复、自动/手动槽隔离、损坏 JSON 原样保留、旧版本拒绝及当前失败 provider 逆序回滚保持不变。
- 当前交付继续只用 `LocalMockTransport`；network-ready 不表示在线玩家或远端基础设施已交付。
- 当前 QuestPanel/Tracker 的接取、放弃、提交和追踪表现作为 golden 保留；UI、ECS 与 Trigger 只发命令并消费 projection。
- requestId 响应去重继续兼容 BattleClient/JSON-RPC，但不替代 operationId 业务幂等；legacy `NetworkManager` 不接入权威链。
- 键鼠、触屏和手柄继续只经 `SceneInputFlow/InputActionRouter`；requested/actual 后端只影响表现和诊断。
- S01–S14、四类成长、战役救援、营建载具、存读档和六结局优先级保持相同确定性结果与通知顺序。
- 编辑器保留 null/缺失/类型、数组顺序、未知合法字段、稳定 ID、InputHints 和引用。
- 60 FPS、100 活动 ECS 实体、同 Region 峰值内存 `<100MB`、2D/3D diff=0 和释放无残留仍是待实测目标，不宣称已通过。

**Scope:** `¬C(X)` 包括合法项目加载、既有命令、输入路由、流式切换、存读档、渲染投影、资源解析和未提交编辑的浏览行为。修复不得迁移旧内容、修改剧情数值、改变输入优先级、建立新 Demo 或把表现资源升级为业务事实源。

## Hypothesized Root Cause

1. 生命周期所有权未显式建模：Container、Runtime、Assembler 与 Scene 均保留 update/dispose 入口，owned/borrowed 不清且存在隐式全局唯一实例假设。
2. 校验、装配与发布不是同一事务：null/缺失/default 混淆，引用和业务规则分散，consumer coverage 不完整。
3. 世界派生逻辑分散并带 Demo fallback，缺少唯一不可变 `ProjectWorldIndex`。
4. 磁盘读取与缓存缺少 provenance、revision、validator fingerprint 和 eligibility。
5. 编辑器由 UI 拼接写入并先改 localStorage，缺少完整候选、提交点、journal 与提交后降级语义。
6. 编辑器表单、画布、Trigger/Dialogue/Quest 工具未共享 schema model、path patch、undo 和原子保存链。
7. 错误与 JavaScript 物理行/职责门禁不统一。
8. 物品定义、运行态与表现被多处复制；`PickupSystem` 和 UI 可绕过 `InventoryTransactionService`/`ItemLifecycleService`。
9. 场景专属 action 与不完整 Trigger 契约共同控制流程；once/cooldown 可能在整链成功前提交。
10. Quest 定义、运行态和推进算法混在可变对象中；存在重复 ID 覆盖、两套推进算法、直接 wall clock 与奖励部分提交。
11. 当前网络模块只有 request-level 能力，尚未形成统一 command execution port；requestId 与 operationId、definition/state/event/projection revision 混淆。
12. 全局唯一能力缺少 DI 与生命周期容器约束，易退化为 Singleton、模块级状态或重复 owner。

## Correctness Properties

Property 1: Bug Condition - Modular Canonical Architecture and Unified Commands Satisfy the Correct Predicate

_For any_ supported architecture operation where `isBugCondition(input)` is true, fixed implementation `F'` SHALL satisfy `expectedBehavior(result,input)`: ownership、validation、project derivation、disk priority、atomic edit commit、lossless editing、error classification、audit、immutable definition/minimal runtime separation、QuestResolver 唯一纯算法、QuestTransactionService 原子奖励结算、ItemRuntimeState 与库存/物品生命周期事务、统一 CommandGateway/AuthorityPort、operationId/state revision、clock/RNG、snapshot、ECS projection 和 post-commit Event Notification 均符合本设计；LocalAuthorityAdapter 与 loopback/fake RemoteAuthorityAdapter 共享 command/result/event contract，且已有 schema 可表达的内容扩展不产生可执行 JavaScript diff。

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12**

Property 2: Preservation - Non-Buggy Inputs Retain Existing Observable Behavior

_For any_ supported input where `isBugCondition(input)` is false, fixed implementation `F'` SHALL preserve the original observable business state、ordered committed notifications、accepted/rejected command result、stable IDs/references、input routing、snapshot semantics、streaming outcome and backend-independent result, including every preservation item above; QuestPanel/Tracker remains a read-only projection driven by equivalent intents, equipment/dialogue contracts remain unchanged, request-level JSON-RPC dedupe remains distinct from operationId idempotency, and the deliverable remains single-player with LocalMockTransport only.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12**

## Fix Implementation

### 1. Unique Ownership, Dependency Injection, and Lifecycle

**Primary files:** `SceneSystemContainer.js`, `GameSceneRuntime.js`, `SceneGameplaySystemAssembler.js`, `BaseGameScene.js`, `SceneFramePipeline.js`, `SceneLifecycleCoordinator.js`.

`Registration={name,instance,identity,ownership,sequence,order,updateHook,renderHook,disposeHook,frameToken,disposed}`。对象身份而非名称去重；同实例最多一个 owned 登记，alias 只读；同名替换只能显式 `replace()`；每帧按 `(order,sequence)` 恰好更新一次；释放时严格逆序且只释放 owned；重复 dispose 为 no-op。Assembler 只返回 registration plan，FramePipeline 只调用 Runtime 阶段入口。

依赖注入根和生命周期容器管理需要全局唯一的 `CommandGateway`、clock、RNG、repository、transaction service 与 projection store。禁止模块级可变实例、静态 service locator 和 Singleton；borrowed dependency 不由当前容器释放，迟到异步任务由 generation/disposed 门闩拒绝写回。
### 2. Canonical Schema, Validation, and Read-Only Definition Index

**Primary files:** `ContentValidator.js`, `ContentSchemas.js`, `CanonicalSchemas.js`, `PresentationProfileSchemas.js`, `GameLoader.js`, generic registries and runtime consumers.

`CanonicalCandidatePipeline` 固定为：

```text
read all sources → parse with source/line/column → clone and apply schema defaults
→ schema validation → cross-document reference validation → business-rule validation
→ canonicalize → build shadow indexes/consumers → atomically publish CanonicalSnapshot
```

只有字段缺失时应用 default；`null` 仅在 `nullable:true` 时合法。canonicalize 是纯函数并保留允许的 unknown 字段、字段存在性和数组顺序。`CandidateRuleValidator` 一次运行全部引用闭包与业务约束并返回根路径错误。`GameLoader` 在 shadow 中构建 config、Blackboard、Trigger、registries、Battle 和 progression draft，全部成功后一次交换；失败保持 `lastSuccessfulSnapshot`。

`DefinitionRepository.fromSnapshot(snapshot)` 只构建 `{kind → id → frozen definition}` 配置索引。重复 ID、未知 capability/Strategy、参数非法和引用缺失均在 publish 前拒绝。索引不提供 `register/remove/clear/save`，不持有事务、不保存运行态、不序列化完整定义进存档；旧兼容 `Registry` 只能作为只读 Facade 委托当前索引。

`ConfigConsumptionRegistry` 以 schema path 和 `definitionKind+capabilityId+strategyId` 登记 consumer。提交前要求可消费字段至少有一个通用 consumer；运行时不得用同义程序常量覆盖，也不得新增 scene/content/field 分支。

#### 2.1 Immutable Definitions, Minimal Runtime State, and ECS

| 模块 | 唯一职责 | 禁止事项 |
|---|---|---|
| Canonical JSON / `CanonicalSnapshot` | 定义、Strategy ID、参数、引用、稳定资源 ID | 运行中 Entity、UI 对象、可变业务状态 |
| `DefinitionRepository` | 当前快照的只读配置索引 | 可写存储、逐条热补丁、事务或运行态 |
| Transaction Service + service-owned state | 业务校验、draft、原子提交、state revision、提交后通知 | DOM/Canvas、scene/content 分支 |
| ECS projection | 位置、可见性、交互半径、数量、耐久等高频投影 | 定义源、完整定义副本、跨服务提交 |
| UI/presentation | 渲染只读 ViewModel，发 ClientIntent | 直接改 Stats、Inventory、Quest 或 StoryState |

运行中的命令固定读取开始时捕获的 definition revision；新命令才观察新快照。状态保存只包含 stable ID、最小字段和 state revision。

#### 2.2 Capability Composition and Strategy Registry

`ItemDefinition` 以 capabilities 组合：`stackable`、`consumable`、`equippable`、`throwable`、`container`、`questBound`、`fuel/cargo`、`tool`、`durable`、`placeable`。互斥、依赖、参数、槽位和引用由完整候选校验统一检查；策略只引用 `CapabilityStrategyRegistry` 启动时登记的通用实现。

禁止 `Item → ConsumableItem → Potion` 或按 named item 建类树。新增已有能力可表达的内容只能修改 canonical JSON 与已登记资源；只有新增真正通用能力语义时才修改框架，并同步 schema、Strategy、validator、consumer 和测试。

#### 2.3 ItemRuntimeState, Factory, and Projections

```text
ItemDefinition        = immutable indexed definition
ItemRuntimeState      = ItemStack | ItemInstanceState
ItemStack             = {definitionId,quantity}
ItemInstanceState     = {definitionId,instanceId,mutable:{durability?,binding?,charges?,container?}}
GroundDropProjection  = ECS {entityId,definitionId,instanceId?,quantity,transform,pickupState}
DeathDropProjection   = ECS {entityId,deathId,stacks:[ItemRuntimeState],transform}
```

仅有逐实例差异时分配稳定 `instanceId`。Inventory、Equipment、Cargo、GroundDrop、DeathDrop 与 Snapshot provider 只保存定义引用和最小运行态。`ItemRuntimeFactory` 是唯一正式 Factory，把 definition + runtime state 装配为 Component/表现；不提交库存、效果或装备。`LootResolver` 是注入 RNG 的纯 Strategy，输出 `{itemId,quantity}`。`PickupSystem` 只检测候选并发命令，不补 potion effect、不复制定义、不自建第二套 loot entity 规则。

#### 2.4 InventoryTransactionService and ItemLifecycleService

`pickup/use/drop/equip/unequip/transfer/death-drop` 统一进入 `ItemLifecycleService`；库存 add/remove/transfer/batch 始终复用 `InventoryTransactionService`。两者是显式 Transaction Service，协同 `EquipmentSystem`、`EffectResolver`、`LootResolver`、Stats、Cargo、World 与 checkpoint participant：

```text
validate command + definition/state revision + references + capabilities + authorization
→ claim operationId/fingerprint
→ prepare ItemRuntimeState/service/ECS/notification drafts
→ commit all participants atomically
→ assign next state revision
→ publish ordered CommittedEvent notifications
→ checkpoint according to policy
```

提交前失败零修改；提交或 checkpoint 失败按需求 3.4 的策略恢复当前失败参与者及此前参与者。同 operationId 同 fingerprint 返回首次结果，不同 fingerprint 冲突。UI 只发命令。

装备路径必须调用真实 `EquipmentSystem.equipItem()`/`unequipItem()`；保持槽位映射、背包满撤销、`BaseGameScene.onEquipmentChanged(messages,info)` 单一出口、`equipItem/unequipItem` 分离和 `mainhand→weapon`。只有完整提交后发送通知；表现文案失败不反向改变已提交状态。

#### 2.5 Other Runtime Modules

装备、技能、四类成长、资源节点、工事、载具/货舱、任务/救援、战役与结局统一采用“不可变定义 + service-owned minimal runtime state + Transaction Service/State Machine + ECS projection”。每个状态由唯一服务拥有，每个写操作经统一 command handler；Scene 只装配 Facade/Adapter 和投影。Snapshot 只保存 stable definition/instance/session ID、最小状态、state revision、clock/RNG 和必要 ledger。

### 3. Trigger-Centered Scenario Orchestration

**Primary files:** `TriggerSystem.js`、Dialogue/Tutorial/Quest/Rescue/Battle/Construction/Vehicle/Ending systems、Chunk/Region navigation、Snapshot modules、`DataDrivenPrologueScene.js` 与 canonical schemas。

`TriggerSystem` 是唯一触发匹配和 action-chain 执行内核；项目 behavior 与场景 spatial binding 通过稳定 `triggerId` 合并。`ScenarioDefinition` 只能包含 scope 与引用，`TriggerGraph`/`ScenarioDefinitionIndex` 只读。流程为：

```text
CanonicalSnapshot → read-only ScenarioDefinitionIndex/TriggerGraph
→ TriggerSystem State Machine → ActionDescriptor → CommandAdapter
→ CommandGateway/AuthorityPort → LocalAuthorityAdapter
→ Transaction Service command handler → CommandResult + CommittedEvent
→ ProjectionStore → ECS/UI
```

`ActionDescriptor={id,paramsSchema,resultSchema,sideEffect,requiresOperationId,checkpointPolicy,allowedReentryPolicies,adapterId}`。canonical action 禁止函数、模块路径、类名、eval 或 callback。`CommandAdapter.execute()` 只验证 schema、解析稳定引用、构造命令和归一化结果，不能调用服务私有写入口。通用命令覆盖 rescue、battle、construction、vehicle、quest、world teleport、checkpoint、ending、dialogue 和 tutorial；禁止 SXX/内容命名 handler。

Trigger 不用多个 `setVar/giveReward/autoSave` 拼接原子操作。需原子的操作必须由一个 Transaction Service 在单个 operationId 下提交；Trigger 只消费最终结果。

#### 3.1 Trigger State Machine and Event Notification

```text
TriggerExecution {
  triggerId,definitionRevision,operationId,
  status: idle|running|succeeded|failed,
  actionIndex,inputFingerprint,startedAt,finishedAt?,result?
}
TimerState {triggerId,definitionRevision,remaining,nextDue}
```

未知 action、schema 错误、`ok:false`、同步 throw 或 async reject 均立即停链并发送 `triggerFailed` application notification；所有 Promise 必须等待。once/cooldown 只在整链成功后一次提交。`reentryPolicy` 显式为 reject/queue/restart。timer 使用 monotonic clock，快照保存 remaining/nextDue。恢复先验证 schema、definition revision、action/binding/ref 和 operationId fingerprint，再整体替换 ledger/timer/once/cooldown。ledger 不覆盖任何业务服务状态。

#### 3.2 Dialogue, Tutorial, Teleport, and Thin Scenes

`DialogueSystem` 唯一拥有 session/current node/history/completed；选择只发 `dialogueChoice` 命令，成功后推进。保留 repeatable/idleText/商店优先级。Tutorial definition、步骤、signal rule、阈值、文案和 policy 全在 canonical；`TutorialSystem` 只持最小状态，不使用 JavaScript `when` 或 S01 工厂。

`world.teleport` 只经 `ChunkNavigator/RegionCoordinator`；`checkpoint.request` 只经 `SaveGameService/SnapshotManager`。`DataDrivenPrologueScene` 只装配、转发输入/通知、投影 UI/ECS 和协调生命周期，不持有流程 timer、内容分支、奖励写入或 teleport/checkpoint 回调。

### 4. QuestRuntimeState and QuestTransactionService

**Primary files:** `QuestSystem.js`（Facade/兼容入口）、`QuestResolver.js`、`src/systems/quest/` 的定义/运行态/命令模块、canonical quest schemas、Quest UI 与 `QuestEditor.js`。

```text
QuestDefinition {
  id,type,text,giver,turnIn,prerequisites,objectives,reward,
  time,repeatPolicy,triggerRefs,dialogueRefs
}
QuestRuntimeState {
  questRuntimeId,definitionId,state,objectiveProgress,
  acceptedLogicalTime,remaining,repeat,rewardSettlementLedger,
  tracking,stateRevision
}
```

定义 deep-freeze 后进入只读配置索引，不得包含 currentCount、acceptedTime、expiresAt、tracked 等运行字段。`QuestRuntimeState` 由 `QuestTransactionService` 唯一拥有；`remaining` 用于跨会话恢复，logical clock 用于业务顺序，wall clock 只用于展示。

`QuestResolver.resolve({definition,runtimeState,signal,logicalTime,elapsed,rng})` 是唯一纯推进算法，返回 `{nextRuntimeState,changed,completed,eventDrafts,rewardIntent?}`。它不修改输入，不读取平台时钟/随机数，不调用 UI、ECS、Trigger、库存、checkpoint 或存储。objective matching、optional/required、计数上限、空 objectives、expiration 和 repeat eligibility 只定义一份。

`QuestTransactionService` 的 command handler 覆盖 accept/advance/abandon/turnIn/track：校验 definition/state revision → claim operationId → 调用唯一 Resolver → 准备奖励/库存/经验/Story participants → 原子提交 QuestRuntimeState、reward ledger 与 participants → 分配 state revision → 发布 ordered committed notifications → checkpoint → finalize。任一提交前失败零修改；turnIn 不允许 UI 二次发奖。

`QuestSystem` 仅是 Facade，不能拥有第二份可变任务。QuestPanel/Tracker/NPC marker/HUD 只读 projection 并发 intent。`QuestEditor` 共享 `CanonicalDocumentModel`、SchemaFieldEditor、引用图、undo/validation 和 AtomicDiskTransaction，只读预览运行态，不保存运行快照。当前 Demo 空 `quests` 合法，不执行 `initDefaultQuests()`。

### 5. Unified Local-First Command Execution Port

**Primary files:** command schemas/ports、`CommandGateway`、`AuthorityPort`、`LocalAuthorityAdapter`、`ProjectionStore`、BattleClient/JSON-RPC/LocalMock/IdempotencyStore，以及未来接口级 Remote adapter。

```text
Input/UI/Trigger ClientIntent → CommandGateway
→ AuthorityPort.execute(AuthoritativeCommand)
→ LocalAuthorityAdapter | future RemoteAuthorityAdapter
→ service-owned command handler
→ CommandResult + ordered CommittedEvent
→ ProjectionStore → ECS/UI
```

`LocalAuthorityAdapter` 与未来 adapter 共享序列化边界、schema、fingerprint、operation ledger、revision、clock/RNG、handler contract 和结果校验；单机不得直接调用 handler 形成旁路。业务目录不依赖 transport，不出现 online 分支。

```text
ClientIntent {intentType,actorRef,operationId?,payload}
AuthoritativeCommand {commandType,operationId,actorId,sessionId?,clientSequence?,expectedStateRevision?,definitionRevision,payload}
CommandResult {ok,operationId,status,committed,code,stateId,stateRevision,eventFrom,eventTo,value,error}
CommittedEvent {eventId,stateId,stateType,stateRevision,operationId,logicalTime,type,payload}
Projection {projectionType,projectionId,definitionRevision,stateRevision,projectionRevision,lastEventSequence,value}
```

requestId 只标识 RPC attempt；operationId 跨 attempt 稳定。`definitionRevision` 锁定配置，`stateRevision` 每次成功提交严格递增，`expectedStateRevision` 冲突零修改；`eventSequence` 排序通知；`projectionRevision` 表示消费位置；`snapshotSchemaVersion` 只表示快照格式。

`IdempotencyStore` 分离 request response dedupe 与 operation ledger。首次 operationId 原子 claim；同 fingerprint 的 in-flight 等待同一结果，committed/failed 返回首次结果；不同 fingerprint 冲突。claim token、单 writer/state lock 或 compare-and-set 防竞态。长期 settlement 防重记录保存在对应 service state，不能因通用 cache 淘汰失效。

Authority 注入 logical、monotonic、wall 三种 clock 和 `{seed,streams,substreams,counter}` RNG。业务不得直接以 `Date.now/new Date/Math.random` 判定。RNG counter 只在提交成功后推进，失败恢复。`CommittedEvent` 只在 state commit 成功后 append 和发布；ProjectionStore 对重复 sequence 幂等，缺口停止并请求 snapshot/缺失通知。业务状态恢复以 `AuthoritySnapshot` 中 service states 为准，而不是以通知日志为准。

```text
AuthoritySnapshot {
  snapshotSchemaVersion,definitionRevision,stateRevisions,lastEventSequence,
  logicalClock,rngState,operationLedger,serviceStates,providerMetadata
}
```

恢复继续两阶段：先 migrate/validate 全部 provider、definition refs、state revisions、sequence、clock/RNG/ledger，再 capture rollback 并 restore；当前失败 provider 也进入严格逆序回滚。`NetworkManager` 的整块客户端 state sync 保持 legacy/experimental，不接入业务命令链。

### 6. Project-Driven World Parameters

`ProjectWorldIndex.build(project)` 在写状态前验证 Region rows/cols、grid 维度、chunk size、scene ID 唯一、reserved 语义和唯一非 reserved 入口。API 包含 `getRegion/getCell/getBounds/getEntry/getOffset/isLoadable`。WorldMapLoadSession、streaming、navigator、Minimap 和 editor 只消费该索引；移除 1280×720、20×20、S01 的运行时 fallback。场景 JSON 局部坐标只读，统一由 `SceneObjectProjector` 恰好应用一次 offset。

### 7. Disk-Canonical Scene Repository

`CanonicalSceneRepository` 注入 DiskSceneAdapter、SceneCacheAdapter、validator 和 mode。每次 refresh 重读 project metadata、`_scene_order.json` 和同 ID 文件；可读磁盘列表决定 ID 集合，不能与缓存取 union。有效文件刷新同 ID cache provenance；删除/重命名移除旧 cache。

`CacheEntry={sceneId,canonicalData,diskRevision,schemaVersion,validatorFingerprint,refreshedAt,eligible}`。仅 unreadable 或需求 3.6 允许的 parse failure 可使用最近一次同 ID、当前校验通过、eligible 的缓存，并显式标记 fallback；missing/schema/reference/business-rule failure 不回退。audit/publish 固定禁用 fallback。

### 8. Atomic Editor Transactions and Schema-Aware Editing

所有 create/update/rename/delete/import/save 统一发送 `EditorCommand`：

```text
clone committed snapshot and apply command
→ validate complete candidate → canonicalize affected documents
→ AtomicDiskAdapter.commit(changeSet)  # commit point
→ replace committed-memory snapshot → synchronize cache
→ notify success or committed-with-degradation
```

Adapter 在仓库级锁下用 temp、journal 和原子 replace/create/rename/delete；提交前故障恢复磁盘且内存/缓存不变。提交后内存异常从磁盘重建；缓存失败将 entry 标为 ineligible，返回 `committed=true,degraded=true,category=cacheSyncFailed`。rename/delete 必须在同一 change set 更新引用、列表、项目、文件和缓存。WorldMapEditor 对普通和 reserved grid 都拒绝 canonical closure 外 ID。

每个打开项目只有一个 `CanonicalDocumentModel={sourceUri,schemaId,originalCanonical,workingCopy,dirtyPaths,snapshotRevision}`。SchemaFieldEditor、场景画布、TriggerEditor、DialogueGraphEditor、QuestEditor 及其他编辑器共享 model、path patch、undo/redo、validation 和 `CanonicalDocumentService → AtomicDiskTransaction`。不得独立 fetch/save、普通 `/api/save-file`、写第二份 localStorage 文档或实例化第二 validator。

编辑器区分 null/缺失/空字符串/0/false，保留 unknown legal 字段、数组顺序、stable ID、引用和 `assetId=imageId`。round-trip 不注入 ID、时间戳、路径或旧对象。capability editor 只选择已登记 Strategy。完整候选校验覆盖 action/result schema、expression AST、scenario 引用闭包、selector、graph reachability、受保护状态路径、operationId/checkpoint policy、loadable scene、consumer coverage、内容命名 handler、Quest 运行字段/重复 ID、command contract，以及禁止部署/运行私有字段进入 canonical 内容。

### 9. Error Results, JavaScript Audit, and Zero-Diff Extension

`ContentOperationResult={ok,committed,degraded,phase,source,category,errors,fallback,value}`。category 至少包括 missing/unreadable/parseFailed/schemaFailed/referenceFailed/businessRuleFailed/diskCommitFailed/memoryPublishFailed/cacheSyncFailed/conflict；phase 至少包括 read/parse/default/schema/reference/businessRule/canonicalize/diskCommit/memoryPublish/cacheSync。错误 path 从候选根开始。加载失败保留 last good；空白模板必须 non-canonical、不可持久化且不含项目专属内容。

JavaScript audit 只纳入 tracked runtime/editor/development/release executable JS 与 HTML script，排除 data/test/fixture/vendor/generated/dist/desktop，按含空行注释的物理行计数。每单元只能承担 assembly、businessLogic、presentation、editorInteraction 之一；无例外 1–1000 行。门禁拒绝 SXX/content handler、sceneId 流程分支、timer/callback 流程、UI/Trigger 直接写状态、整块客户端状态提交、业务平台时钟/随机数和 Singleton/service-locator。例外必须有外部单文件契约证据、精确行数、职责、owner、日期和 hash，增行立即失效。

`ContentExtensionGate` 对既有 schema/capability/ActionDescriptor 可表达的 S01–S14 变更记录可执行 JavaScript hash；仅允许 canonical JSON/资源变化。完全销毁 editor/runtime、清缓存并从磁盘重启后，使用同 snapshot、seed、clock、commands 比较 service states、state revisions、ordered committed notifications 与 ECS/UI projections。代表性覆盖 S01→S02 教学/传送、S09 对话/捐粮、S11 救援波次、S14 载具/结局和通用 capability 的 drop→pickup→use/equip→save→restart→restore。

### 10. Requirement-to-Component Traceability

| Requirement | Design owner | Verification boundary |
|---|---|---|
| 2.1 | GameSceneRuntime + SceneSystemContainer + DI lifecycle container | identity/frame/dispose trace; no Singleton |
| 2.2 | CanonicalCandidatePipeline + DefinitionRepository + ConfigConsumptionRegistry | snapshot validation + observable consumer |
| 2.3 | ProjectWorldIndex + SceneObjectProjector | pure derivation + immutable local data |
| 2.4, 3.6 | CanonicalSceneRepository | disk/cache state machine + provenance |
| 2.5, 2.10 | EditorSceneCommandService + AtomicDiskAdapter | fault-injected commit boundary |
| 2.6 | ProjectWorldIndex + WorldMapEditor | canonical closure + zero-mutation reject |
| 2.7, 2.9, 3.11 | SchemaFieldEditor + CanonicalDocumentModel + QuestEditor | canonical equality + shared undo/validation/save |
| 2.8 | ContentOperationResult + blank-template policy | source/category/last-good snapshot |
| 2.11 | JavaScript audit | tracked scope/physical lines/responsibility |
| 2.12 | ContentExtensionGate + TriggerSystem + CommandAdapter + ItemLifecycleService | representative flows + zero JS diff + restart replay |
| 2.2, 2.7, 2.12 | QuestDefinition + QuestRuntimeState + QuestResolver + QuestTransactionService | definition/runtime split + sole resolver + atomic settlement |
| 3.3, 3.4 | CommandGateway/AuthorityPort + Transaction Services + ECS projectors | common UI/Trigger path + atomic post-commit notification |
| 3.7 | AuthoritySnapshot + providers + ProjectionStore | two-phase restore + revision/ref/clock/RNG/ledger validation |
| 3.4, 3.7 | operation ledger + request dedupe + Local/Remote adapters | requestId/operationId separation + adapter parity |
| 3.8, 3.9 | InputActionRouter + stable asset projections + backend adapters | command parity + backend-independent result |
| 3.10 | Existing services and Demo coordinators | frozen S01–S14/ending golden trace |
## Testing Strategy

### Validation Approach

先在原实现上用最小反例确认 Bug Condition，再对 Property 1 做 fix checking、对 Property 2 做 preservation checking。使用 Vitest、内存 Adapter、fake logical/monotonic/wall clocks、seeded authority RNG 和 fake transport；不创建 HTML 页面，不连接外部服务。仓库没有属性测试依赖时使用固定 seed generator 与 model-based command runner；若以后引入依赖必须固定精确版本。

### Exploratory Bug Condition Checking

1. 同实例重复 owned 登记并由 Assembler 再驱动，观察 update/dispose 次数与顺序。
2. optional non-null 字段传 null，观察是否被当缺失。
3. 生成非默认 world size/entry，定位 Demo fallback 泄漏。
4. 删除或重命名磁盘 ID，检查旧 cache 是否残留或决定 ID 集合。
5. 在 editor 各 phase 注入故障，检查 disk/memory/cache/notification 边界。
6. localStorage 私有 ID 写入普通/reserved grid，检查是否整份拒绝且零修改。
7. 含 unknown field、高精度数值、稳定 ID 的文档无编辑 round-trip。
8. 分别模拟 missing/unreadable/parse/schema failure，检查 source/category/last-good。
9. 对 tracked JavaScript 验证范围、物理行、职责和例外规则。
10. 修改已有 schema 可表达的内容，记录是否仍要求代码分支或重启漂移。
11. 重复 Definition ID，检查只读索引 publish 前拒绝。
12. Pickup/UI 故障注入，检查是否绕过 ItemLifecycleService/InventoryTransactionService。
13. Trigger 中间 action throw/reject，检查停链和 once/cooldown success-only commit。
14. 枚举内容命名 handler 与 scene/stage 分支，确认 Trigger 尚未成为唯一内核的反例。
15. Quest 定义/运行态混合、重复覆盖、两套推进算法和 turnIn 部分提交。
16. 新 requestId 重试同 operationId、同 operationId 不同 payload、并发 expected state revision。
17. projection 注入 duplicate/gap/out-of-order sequence，检查错误增量应用。
18. 冻结 clock/RNG 并重启，检查平台时间/随机数和快照字段导致的漂移。
19. 检查模块级全局实例、静态 service locator 或重复生命周期 owner，确认 Singleton 风险。

每个反例输出 seed、最小 command sequence、输入 snapshot 和 actual trace，并归属于唯一 phase；不得把 cacheSyncFailed 误判为 candidate invalid。

### Fix Checking

```text
FOR ALL input GENERATED FROM bugConditionDomains DO
  ASSUME isBugConditionAgainstOriginal(input)
  result := executeFixedImplementation(input)
  ASSERT expectedBehavior(result,input)
END FOR
```

| Test Area | Generator | Oracle |
|---|---|---|
| lifecycle/DI | owner/borrowed 图、order、alias、帧、dispose、全局能力 | identity + exactly-once + reverse release + no Singleton |
| config/definitions | missing/null/type/bounds、ID 冲突、capability/Strategy/ref | last-good + frozen read-only index + consumption proof |
| item runtime | definition、ItemRuntimeState、source/target、operationId、故障点 | transaction model + minimal state + committed notifications |
| quest runtime | QuestDefinition/QuestRuntimeState、signal、time/repeat/reward、revision | sole QuestResolver + QuestTransactionService model |
| trigger/scenario | event、graph、action chain、fault、once/cooldown/timer/reentry | State Machine + stop-on-failure + success-only commit |
| dialogue/tutorial | session/choice/signal/AST/ref graph | independent service state + command contract |
| command execution | intent、requestId/operationId、fingerprint、definition/state revision、并发 claim | first-result replay + conflict/zero mutation |
| notification/projection | sequence duplicate/gap、state revision、snapshot cut | post-commit only + projection refresh/rebuild equality |
| clock/RNG/snapshot | clock advance、stream consumption、provider failure | deterministic replay + two-phase reverse rollback |
| transport parity | LocalAuthority 与 loopback/fake RemoteAuthority | same result/notifications/projection |
| world/repository/editor | project/grid/disk/cache/command/phase fault | pure derivation + provenance + three-snapshot transaction model |
| schema editor | nested/array patch、unknown field、null/absence、refs | canonical equality + root path errors |
| audit/content extension | tracked files、responsibility、schema-valid JSON delta | exact physical lines + JS hash zero + restart parity |

固定 seed 与 CI 随机 seed 均运行；失败先删命令，再缩字段、集合和值，打印可重放 seed。

### Preservation Checking

```text
FOR ALL input WHERE NOT isBugCondition(input) DO
  baseline := observeOriginalImplementation(input)
  fixed := observeFixedImplementation(input)
  ASSERT normalizeDiagnostics(fixed) = normalizeDiagnostics(baseline)
END FOR
```

`normalizeDiagnostics` 只能移除新增 provenance、phase 和 audit metadata，不得忽略业务状态、通知顺序、ID、引用、接受/拒绝、committed 或 state revision。重点覆盖当前 Demo 身份与旧内容拒绝、A–D 布局、operationId 事务、streaming latest-wins/rollback、存档两阶段恢复、输入优先级、2D/3D 业务 diff、S01–S14/六结局、合法编辑器无损往返、QuestPanel/Tracker golden、装备事件出口和当前仅 LocalMockTransport。性能只生成测量记录，不伪造通过。

### Unit Tests

- SceneSystemContainer identity、order、owned/borrowed、逆序释放、重复 dispose；DI container 管理全局唯一能力且不存在模块级 Singleton。
- ContentValidator missing/null/default/nullable、纯 canonicalize、根路径错误、引用与业务规则校验。
- DefinitionRepository shadow build、deep-freeze、重复拒绝、整体 replacement、旧 revision 隔离和只读 API。
- capability schema/Strategy registry 的参数、依赖、互斥、引用与 consumer coverage。
- ItemRuntimeState 最小序列化，无完整 definition/表现对象；stable instance ID 和 round-trip。
- InventoryTransactionService 与 ItemLifecycleService 的各命令、各 phase 故障、operationId、state revision、通知顺序和 checkpoint。
- EquipmentSystem 真实 API、槽位映射、背包满撤销、统一 onEquipmentChanged 和事件 payload。
- ItemRuntimeFactory/LootResolver/PickupSystem 的唯一装配与纯命令转发。
- ProjectWorldIndex grid、entry、reserved、offset/bounds 与局部对象 deep-freeze。
- CanonicalSceneRepository disk priority、delete/rename、fallback eligibility 和 audit mode。
- AtomicDiskAdapter journal recovery；EditorSceneCommandService 提交前回滚与提交后 cache degradation。
- CanonicalDocumentModel 的统一 patch/undo/validation/sourceUri；unknown、null/缺失和引用 round-trip。
- TriggerSystem State Machine、operationId、throw/reject 停链、once/cooldown、reentry 与 timer restore。
- ActionDescriptor/CommandAdapter schema、side effect、checkpoint policy、unknown action 和受保护状态路径。
- Dialogue/Tutorial service-owned state、choice/signal command、repeatable/idleText 与 snapshot。
- QuestDefinition/QuestRuntimeState 严格分离、重复 ID 拒绝、空 quests；QuestResolver 唯一算法。
- QuestTransactionService accept/advance/abandon/turnIn/track 的幂等、冲突、revision、remaining、奖励 ledger、通知和 checkpoint 原子性。
- Quest UI 只发 intent；QuestEditor 共享 model/index/undo/validation/save 且运行态只读。
- ScenarioDefinitionIndex/TriggerGraph 闭包、reachability、loop、selector 和 non-reserved scene ref。
- Teleport/checkpoint Adapter 只调用已有 navigator/coordinator/save modules，失败保留旧状态。
- CommandGateway ClientIntent→AuthoritativeCommand；所有 UI/Trigger/Scene 路径只经 AuthorityPort。
- IdempotencyStore request dedupe 与 operation ledger 分离及 claim 状态机。
- definition/state/event/projection revision 分离；失败时 service state、ledger、notification、projection 零修改。
- ProjectionStore duplicate/gap/revision jump；snapshot + current service state + notification suffix 的投影等价。
- AuthoritySnapshot 含 revisions、sequence、clock、RNG、ledger、service states，provider 当前失败项逆序回滚。
- fake clocks/RNG；业务禁止平台 clock/random，失败不消耗 RNG counter。
- LocalAuthority 与 loopback/fake RemoteAuthority 的 CommandResult、CommittedEvent 和 projection parity。
- JavaScript audit 的范围、物理行、职责、内容 handler、online branch、clock/random 与 Singleton gate。

### Property-Based Tests

- 生成生命周期登记图，检查每帧与释放 trace、DI identity 和全局能力唯一性。
- 生成 definition、重复 ID、capability/Strategy/ref，检查候选拒绝或 frozen read-only replacement。
- 生成 ItemRuntimeState 与生命周期命令，和纯事务模型比较库存、装备、drop、通知、checkpoint、ledger。
- 生成 QuestDefinition/QuestRuntimeState、signals、time/repeat/reward/fault，与 QuestResolver/QuestTransactionService 模型比较。
- 生成 trigger graph/action/fault，检查停链、once/cooldown、operationId 和 reentry State Machine。
- 生成 dialogue/tutorial/scenario 图，检查 AST、引用闭包、owner state 与 snapshot round-trip。
- 生成 requestId/operationId/fingerprint/revisions/并发顺序，检查 claim、首次结果、conflict 和零修改。
- 同 command sequence 经 Local 与 fake Remote 执行，比较 result/notifications/projection。
- 生成 notification duplicate/gap/out-of-order 和 snapshot cut，检查 projection 等价与缺口策略。
- 生成 clock/RNG 消费和失败，检查快照重放确定性。
- 生成 schema 配置、世界项目、磁盘/cache 状态机和 editor patch，检查默认/拒绝/纯派生/事务/round-trip。
- 生成已有 capability 可表达的内容扩展，检查 JavaScript hash 零变化、重启一致和稳定 ID。

### Integration Tests

- 真实 GameLoader + DefinitionRepository + consumers 修改火堆、生成数量/间隔、月份、天气、救援波次/deadline/距离/InputHints，验证无 JavaScript 修改即可消费。
- 临时目录 Adapter 覆盖场景 update/delete/rename/cache fallback，审计/发布永不读缓存。
- Editor command service 覆盖 create/update/rename/delete/import/save，验证 disk→memory→cache→notification 和完全重启。
- 各配置域共享一个 CanonicalDocumentModel 完成顶层、嵌套、数组和 capability 编辑及无损 round-trip。
- QuestEditor 编辑 definition/objective/reward/prerequisite/refs，验证路径聚焦、引用图、共享 undo、原位原子提交和只读运行态。
- 从同一 QuestDefinition/AuthoritySnapshot 执行 accept→signals→complete→turnIn，注入奖励/checkpoint 故障，验证唯一 Resolver 和原子结算。
- UI 与 Trigger 分别提交语义相同命令，验证都经 CommandGateway/LocalAuthority 并产生相同 contract；Trigger ledger 不成为业务事实。
- LocalAuthority 与 loopback/fake RemoteAuthority 执行同命令序列，比较结果、event range、CommittedEvent、service snapshot 和 projection。
- S01→S02、S09、S11、S14 与通用 capability zero-JS-diff 验收：清缓存完全重启，验证重试、幂等、状态分离、两轮 save/load、2D/3D 一致和 hash 变化 0。
- 普通 GroundDrop、DeathDrop、拾取 UI、InventoryPanel/PlayerInfoPanel、Cargo transfer 均进入同一 item command chain。
- BattleClient/JSON-RPC/LocalMock 与 fake transport 覆盖 malformed、mismatch、timeout 和新 requestId 重试，operationId 只提交一次。
- 注入 notification duplicate/gap/out-of-order，验证去重、停止、snapshot refresh；多个 cut point 的 projection 相等。
- 两轮 AuthoritySnapshot restore/replay 核对 definition/state revisions、sequence、clock、RNG 和 operation ledger。
- 静态/运行门禁确认业务路径无平台时间/随机数、online branch、直接状态写入、legacy state sync 或 Singleton。
- 当前 A–D 与 S01–S14 执行入口、跨 chunk、reserved、缩略图、投影和六结局 golden 回归。
- 释放场景后比较 owner、listener、timer、resource 与 async token 基线；性能仅在实测达到门槛后标记通过。
# 战斗/战场控制器与结局控制器解耦设计

> 状态：已评审并进入实施（P0/P1、E0/E1） · 2026-11-08
> 范围：战斗会话与战场结算、S11–S14 结局编排；含面向联网的演进约束
> 非范围：P2/P3（视图/输入外移、快照 provider 化）、远端权威实现

## 1. 目标

1. 明确战斗/战场与结局两块逻辑当前的**实际承载位置**，而不是按文件名猜测职责。
2. 给出统一的输入/状态/表现/流程推进分层，以及可长期稳定的命令/事件接口。
3. 给出低风险的分步迁移路径，先落地收益最大的 P0/P1 与 E0/E1。
4. 给出联网演进约束：哪些是客户端本地权威、哪些缝隙已具备、现在只守低成本约束。

## 2. 现状与职责分布

### 2.1 战斗与战场

| 位置 | 实际职责 | 判断 |
|---|---|---|
| [SceneGameplaySystemAssembler.js](file:///d:/yijian18-engine/src/core/scene/SceneGameplaySystemAssembler.js#L152-L190) | 构造 `CombatSystem`，接击杀/掉落/尸体/死亡/技能/药水回调（L152-190、L511-512），注册 `gameplay.combat` 服务（L609） | 组合根 + 战斗事件接线，不是战役流程控制器 |
| [SceneInputFlow.js](file:///d:/yijian18-engine/src/core/input/SceneInputFlow.js#L72-L221) | 通用输入管线：handler 注册、`beforeFrame`、世界/移动阻断、flush | 与 battle 无关（无 battle 引用） |
| [SanguoSceneLifecycleCoordinator.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/SanguoSceneLifecycleCoordinator.js#L328-L381) | 模态输入优先级：结局 → 菜谱 → 货舱 → 战斗结算 → 不可逆选择 → 战斗模式 → 背包 → 职业确认；渲染层调用 L525-530 | 真正的跨系统输入/渲染仲裁点，当前硬编码顺序 |
| [BattleModeView.js](file:///d:/yijian18-engine/src/ui/BattleModeView.js#L24-L100) | `snapshot/selectedMode/busy` 本地视图态，`onCommand` 上抛 | 纯视图，边界正确 |
| [SceneBattleRuntime.js](file:///d:/yijian18-engine/src/core/scene/SceneBattleRuntime.js#L53-L533) | 会话流程 + 视图持有 + 输入层 + 渲染层 + 结算 + 存档恢复 | 混合职责主对象 |
| [BattleSystem.js](file:///d:/yijian18-engine/src/systems/BattleSystem.js#L43-L212) | 战役状态机、operationId 幂等、冻结战果、序列化 | 领域状态，结构清晰 |
| [BattlefieldRuntimeSystem.js](file:///d:/yijian18-engine/src/systems/BattlefieldRuntimeSystem.js#L182-L257) | 每帧从实体推导战场快照、士气公式、胜负信号、实时战果 | 客户端本地推导 |
| [CityWarSystem.js](file:///d:/yijian18-engine/src/systems/CityWarSystem.js#L27-L136) | 战果原子结算：资源→城损→资源点→warState→剧情统计，含回滚/检查点/幂等 | 可服务端复用的结算内核 |
| [S03S14BattleCoordinator.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S03S14BattleCoordinator.js#L62-L157) | Demo 装配：定义、Runtime、hooks、Demo 服务、兼容字段投影 | 内容层适配器 |
| [SceneBattleFlowRegistry.js](file:///d:/yijian18-engine/src/core/scene/SceneBattleFlowRegistry.js#L46-L79) | 从场景 `gameplay.battleFlow` 校验并双索引元数据 | 数据驱动约定良好 |
| [BattleClient.js](file:///d:/yijian18-engine/src/integration/BattleClient.js#L18-L52) → [LocalMockTransport.js](file:///d:/yijian18-engine/src/integration/LocalMockTransport.js#L98-L149) | JSON-RPC 战役服务；要求 seed，服务端式幂等 | 传输缝已存在，可替换为远端 |

关键依赖与跨模块直调：

- `SceneBattleRuntime` 直接持有并调用 `BattleSystem`、`CityWarSystem`、`BattlefieldRuntimeSystem` 和三个视图（L53-98）。
- 通过 hooks 反向注入 Demo 规则：`projectDefinition`、`beforeOpen`、`beforeSelect`、`resolveBeforeBattlefield`、`settleResult`、`afterDomainSettlement`、`afterSettlement`（[coordinator L159-208](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S03S14BattleCoordinator.js#L159-L208)）。
- `update` 内本地判定 `resolved` 后直接异步结算（[SceneBattleRuntime L312-329](file:///d:/yijian18-engine/src/core/scene/SceneBattleRuntime.js#L312-L329)），既推进流程又写领域状态。
- 结算链：`settleResult`（L374-399）→ `CityWarSystem.applyBattleResult` → 注入的 Blackboard `read/commit` + 检查点 → 成长奖励 → 结果视图。

散落状态：

| 状态 | 载体 |
|---|---|
| 会话 state/mode/frozenResult | `BattleSystem` 实例 |
| 实时战场快照/士气 | `BattlefieldRuntimeSystem.lastSnapshot` |
| 已应用战果 | `blackboard.appliedBattleResultIds` + `CityWarSystem._operations` 双账本 |
| 模式与统计 | `storyState.battleModes`、`storyState.battleStats`（hook 直写） |
| 场景战役元数据 | 场景 JSON `gameplay.battleFlow` + 项目 `battles.json` |
| 输入优先级/渲染顺序 | 生命周期协调器硬编码 |

### 2.2 结局

| 位置 | 实际职责 | 判断 |
|---|---|---|
| [EndingSystem.js](file:///d:/yijian18-engine/src/systems/EndingSystem.js#L241-L314) | 权威内核：互斥、读状态、投影/冻结输入、`resolve:${endingSnapshotId}` 幂等、原子提交、检查点、回滚、事件、快照与账本序列化（L316-322） | 结构良好，保持不动 |
| [S11S14SceneFlow.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S11S14SceneFlow.js) | 1800 行、覆盖 S11 骑马/救援、S12 城门/救援、S13 结算、S14 货舱/投石车/终局方略/结局演出/存档 | 巨型宿主，结局只是其中一段 |
| 结局切片 | 命令入口 L752-789、状态读写/输入投影 L1103-1159、终局方略 L1513-1578、解析与演出 L1580-1698 | 迁移对象 |
| [S13S14Coordinator.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S13S14Coordinator.js#L156-L298) | 快照归一化、资源分歧提交、旧 `commitEnding`（已废弃转发） | 保留 |
| [EndingPresentationView.js](file:///d:/yijian18-engine/src/ui/EndingPresentationView.js#L77-L301) | 演出视图：shot 索引、计时、音乐切换、指针交互、`onCommand` 上抛 | 纯表现层，保持 |
| [triggers.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/triggers.json#L2095-L2104) → [DataDrivenPrologueScene.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/scenes/DataDrivenPrologueScene.js#L1444-L1474) → [SanguoDomainCommandFacade.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/SanguoDomainCommandFacade.js#L78-L94) | `ending.command` 已走 DomainCommandService + AuthorityPort | 联网友好的既有链路 |

依赖：Blackboard（storyState/cityStates/warState）、背包/货舱、EndingSystem、TriggerSystem（`endingResolved`）、检查点、场景切换、UI/音乐、输入上下文。

散落状态：

- `storyState.endingId / endingSnapshotId / endingSnapshot / unlockedEndings`（写入 L1107-1114）。
- `storyState.endingInputs.*` 与 `s14FinalDoctrine`、`s14ResourceDivergence` 门禁（L1583-1590）。
- `EndingSystem` 账本 + 视图 shot/计时 + `preSaveCheckpointId`。
- 内存态 `_s13PendingSettlement`、`_cargoTransferPendingOperation`（重连即丢）。

## 3. 统一分层

```
数据/定义层：battles.json、场景 battleFlow、endings 配置、quests/triggers（静态、带版本）
领域/权威层：BattleSystem、CityWarSystem、EndingSystem、TriggerSystem（状态 + 账本 + 原子提交）
流程层：BattleFlowController、EndingFlowController（门禁、顺序推进，不碰视图/输入）
投影层：BattlefieldSnapshotProjector、EndingInputProjector（只读状态 → DTO）
表现层：BattleModeView/Hud/Result、EndingPresentationView（只持演出态，onCommand 上抛）
输入层：BattleInputRouter、EndingInputContext（只产出 intent/command）
适配层：SceneBattleFlowProvider、BattleTransportPort、Snapshot/Save Provider
```

规则：

1. 流程层不得直接写 Blackboard 领域字段；写操作必须经领域服务或命令。
2. 表现层不得持有领域状态；演出态可本地持有。
3. 事件只在提交后发；预测态不发领域事件。
4. 新模块的状态必须可序列化、带 `schemaVersion`。

## 4. 战斗模块边界与接口

| 模块 | 职责 | 边界 |
|---|---|---|
| `BattleSessionFacade` | 战斗会话唯一对外门面：open/selectMode/settle/close/capture/restore/输入层/渲染层 | 只做委托与命令编排，不实现规则 |
| `BattleFlowController`（P2 拆分） | 会话状态机、门禁、开战/停战、结算触发 | 不持视图、不处理输入、不直接写存档 |
| `BattleSettlementService`（P1 起命令化） | 冻结战果 → CityWarSystem → 成长奖励 → 检查点 | `settle:${resultId}` 幂等；只发提交后事件 |
| `BattlefieldProjector` | 从实体推导快照/士气/信号 | 纯读 |
| `BattleOverlayPresenter` | 视图生命周期与渲染 | 只消费 DTO |
| `BattleInputRouter` | 模式层/结果层输入 → intent | 由生命周期协调器注册优先级 |
| `BattleSessionStore` | 会话快照 provider | 唯一存档出口，键名不变 |

命令：

- `battle.open`、`battle.selectMode`、`battle.reportResult`、`battle.settle`、`battle.close`、`battle.leaveScene`
- 既有 `battle.open.sXX` 名称保持稳定（触发器契约）。

事件：

- `battle.opened`、`battle.modeSelected`、`battle.started`、`battle.resultFrozen`、`battle.settled`、`battle.resultPresented`、`battle.closed`

## 5. 结局模块边界与接口

| 模块 | 职责 | 边界 |
|---|---|---|
| `EndingFlowCoordinator` | 终局门禁 → `resolveEnding` → review 组装 → 打开演出；演出命令路由 | 不写账本（交给 EndingSystem） |
| `EndingInputProjector` | 状态 → EndingInput 纯投影 + `requiredPaths` 校验 | 纯函数，可单测/可服务端复用 |
| `EndingSystem` | 权威内核（不变） | 账本、快照、幂等、回滚 |
| `EndingPresentationView` | 演出表现 | 只持演出态 |

命令：`ending.resolve`、`ending.commit`、`ending.present`、`ending.close`、`ending.loadPreEnding`、`ending.returnTitle`

事件：`ending.inputFrozen`、`ending.resolved`、`ending.presented`、`ending.presentationClosed`

稳定契约：

- `ending.command` 的 `operation`、`endingId` 不变。
- `endingResolved` 事件名与 payload 不变（触发器已消费）。

## 6. 分步迁移与风险

### 6.1 战斗

| 阶段 | 改动 | 风险 |
|---|---|---|
| P0（本次） | 抽 `BattleSessionFacade`，现有调用统一走门面 | 低，无存档变化 |
| P1（本次） | `settleResult` 移出 `update`，改 `battle.settle` 命令触发；`settle:${resultId}` 幂等 | 中：结算恢复、重复结算 |
| P2（不做） | 视图与输入层移出 Runtime | 中：输入优先级回归 |
| P3（不做） | 快照 provider 化 + schemaVersion + 迁移读 | 中高：存档键 |
| P4（不做） | 远端传输、服务端签发战果 | 高 |

### 6.2 结局

| 阶段 | 改动 | 风险 |
|---|---|---|
| E0（本次） | 结局切片抽到独立 coordinator，宿主保留同名 delegate | 低；不改变调用点 |
| E1（本次） | `_projectEndingInput` 提为纯 projector + `requiredPaths` | 低；字段缺失会走 `inputProjectionFailed` |
| E2（不做） | `ending.*` 统一命令化 + stateId | 中：operationId 契约 |
| E3（不做） | 结局解析迁服务端 | 高：检查点语义 |

### 6.3 硬约束

1. 存档键名不变：战斗 `capture()` 及其字段、`s11s14*` 批（`s11s12CoordinatorState`、`s12GateState`、`endingSystemState`、`vehicleLogisticsState`、`vehicleStates`、`s13PendingSettlement` 等）。
2. 触发器/任务配置的 operation 名不变；`endingResolved` 事件名不变。
3. 不改实时战果的 `realtimeResult` 策略与士气公式（会改变历史结局分支）。
4. 不做 P2/P3 与远端权威。

## 7. 联网维度

### 7.1 客户端本地权威热点

| 位置 | 表现 | 联网后果 |
|---|---|---|
| `BattlefieldRuntimeSystem._buildSnapshot/_buildSignals/_createResult` | 本地实体推导士气/伤亡/胜负 | 两端不一致，可篡改 |
| `SceneBattleRuntime.update` | 本地判定 resolved 即结算 | 结算时机不可信（P1 后改为命令触发） |
| `SceneBattleRuntime.selectMode` | UI 直调，绕过命令端口 | 无法服务端锁模式 |
| `settleResult` → `CityWarSystem.applyBattleResult` | 直接 read/commit Blackboard | 无 revision / 权威校验 |
| `BattleSystem.now = Date.now`、`CombatSystem.now = performance.now` | 墙钟计时 | 不可重放 |
| `CombatSystem.combatRng` 默认可注入但非权威 | 伤害/暴击/掉落本地 | 不可复现 |
| Demo hooks 直写 `storyState` | 剧情事实可伪造 | 结局输入可伪造 |
| S11S14 内存意图 | 断线即丢 | 无法续局 |

### 7.2 已具备的缝

- 抽象端口与远端占位：[AuthorityPort.js](file:///d:/yijian18-engine/src/core/command/AuthorityPort.js#L13-L34)。
- 本地权威实现：operation ledger、串行提交、state revision、RNG 事务、提交后事件（[LocalAuthorityAdapter.js](file:///d:/yijian18-engine/src/core/command/LocalAuthorityAdapter.js#L74-L356)）。
- 运行时：逻辑/单调时钟、种子 RNG、事件日志、权威快照（[GameSceneRuntime.js](file:///d:/yijian18-engine/src/core/scene/GameSceneRuntime.js#L123-L226)）。
- 契约：canonical command/result + `expectedStateRevision`。
- 传输：`BattleClient` + `LocalMockTransport`（seed、requestId 幂等）。
- 触发器静态定义与运行时账本已分离（[TriggerSystem.js](file:///d:/yijian18-engine/src/systems/TriggerSystem.js#L1237-L1330)）。
- `ending.command`、`battle.command` 已走 DomainCommandService（[DataDrivenPrologueScene L1462-1474](file:///d:/yijian18-engine/example/sanguo_zhangjiao/scenes/DataDrivenPrologueScene.js#L1462-L1474)）。

### 7.3 演进方向

- 状态所有权：服务端拥有会话/模式锁/战果/城市与剧情事实/结局解析；客户端只拥有输入意图、移动与演出预测、HUD 投影。
- 可序列化：权威状态全部进快照 provider，`schemaVersion` + 迁移；派生字段读档后重算。
- 命令/事件：`{operationId, expectedStateRevision, payload}`；事件仅提交后发；演出事件不进服务端流。
- 回放 vs 同步：
  - 抽象战役（观战/无介入）→ 服务端状态同步 + 服务端签发战果；`LocalMockTransport` 形态可直接上云。
  - 实时战场（介入）→ 客户端预测 + 服务端校验/服务端模拟；不对 4000+ 行、墙钟耦合的 `CombatSystem` 做确定性 lockstep。

### 7.4 任务/触发器数据适网性

- 适合同步：`quests.json`、`triggers.json`、`battleFlow`、`endings` 为静态内容，带版本下发。
- 必须分离：`once/cooldown` 是定义，`firedOnce/nextDue/timers/ledger` 是运行时；`stepId/operationId` 是编排标识，不写回内容；运行事实不入 `params`。
- 客户端可预测谓词，但提交必须服务端判定；`triggerCatalog` 仅编辑器元数据。

### 7.5 分阶段约束

现在就守（低成本）：

1. 状态变更入口统一 `{operationId, expectedStateRevision}` + canonical result。
2. 控制器逻辑禁用 `Date.now/performance.now/Math.random`，改注入时钟/RNG。
3. 新模块“静态定义 / 运行时状态 / 派生投影”三分离，并提供快照 provider。
4. 视图只持演出态；事件只在提交后发。
5. 结算/结局保持 `resultId`、`endingSnapshotId` 幂等键不变。
6. 触发器 operation 名与 `endingResolved` 事件名稳定。

联网才做：

1. `RemoteAuthorityAdapter` 接 WebSocket/HTTP，服务端复用领域服务。
2. 服务端签发会话与战果，客户端改快照/增量投影。
3. 结局解析迁服务端，客户端按 `endingSnapshotId` 播放。
4. 内容版本/迁移、断线续局、分线。
5. 实时战斗反作弊或服务端模拟。

## 8. 与现有约定的一致性

- 任务/触发器：canonical descriptor → TriggerSystem（生成 operationId）→ DomainCommandService → 领域 handler；只在 `SanguoDomainCommandFacade` 扩路由。
- UI 视图层：视图只持展示态并 `onCommand` 上抛；控制器不得把领域状态塞进视图。
- 场景生命周期：沿用 `SceneFlowCoordinator` 投影与重名守卫（[S11S14SceneFlow L1774-1796](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S11S14SceneFlow.js#L1774-L1796)）；输入/渲染仲裁仍由 `SanguoSceneLifecycleCoordinator` 负责。
- 权威层：状态变更经 `GameSceneRuntime.registerCommandHandler` → `AuthorityPort.execute`；handler 声明 `stateId` 并用 `commitStateRevision`（[DomainCommandService L29-L79](file:///d:/yijian18-engine/src/systems/DomainCommandService.js#L29-L79)）。

## 9. 本次实施范围与不变式

实施：

- P0：`BattleSessionFacade`（新）承接 Demo 对 `SceneBattleRuntime` 的全部调用。
- P1：`update` 只检测并挂起待结算；`battle.settle` 命令经 authority → facade → `settleFrozenResult`；`settle:${resultId}` 幂等；存档恢复后自动补发结算命令。
- E0：`EndingFlowCoordinator`（新）承接结局切片；`S11S14SceneFlow` 保留同名 delegate。
- E1：`EndingInputProjector`（新）纯投影 + `requiredPaths`；宿主 `_projectEndingInput` 委托。

不变式：

1. 存档键名与结构不变。
2. `battle.open.sXX`、`ending.command` 的 operation 名不变。
3. `endingResolved` 事件名不变。
4. 实时战果策略/士气公式不变。
5. 不做 P2/P3、不接远端权威。

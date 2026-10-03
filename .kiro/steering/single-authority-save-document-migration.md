# 迁移方案论证：单一权威存档文档（SDD）

> 状态：已完成（v6，2026-10-03）；阶段 0/1/2/3（第一批+3b+第二批）已交付；阶段 4 已交付（接线收敛，见第六章）；终态达成：sdd.document 五节点为权威源，旧链路保留为兼容面
> 目标：回答「存档能否收敛为单一纯数据文档、任务系统能否退化为勾选器」，给出可行路径与代价。

---

## 零、架构硬规则（阶段 0 交付，全部功能必须遵守）

以下规则来自 2026-10 存档缺陷（rollbackUnavailable / meta 丢失 / 狼复活 / 诊断失明）的根因总结，
回归测试钉在 `test/saveSystemRegression.test.js`：

1. **采集函数必须纯**。capture/serialize 路径上禁止出现持久化类守卫（如「玩家必须在可加载格」）、
   业务副作用与状态修改。守卫属于**保存入口**（决定「要不要写档」），不属于「如何读状态」。
   同一采集函数服务保存与回滚两种语义时，回滚语义必须跳过守卫（`snapshotMeta.label === 'rollback'`）。
2. **跨层 meta 透传逐跳核对**。给采集链新增任何包装函数/中转对象时，meta 参数必须显式透传；
   禁止写 `() => delegate()` 这类丢参包装。测试钉：SnapshotManager.capture → provider.snapshot(meta)
   → setStateProvider 包装 → scene.captureSaveState 全链。
3. **id 匹配必须走统一工具**。count 模板派生 id（`base-N`，如 `S01-first-wolf-1`）的匹配禁止裸
   `Map.has(id)` / `find(p => p.id === id)`，必须走带派生回退的统一工具
   （场景层 `resolveChunkPlacement`、运行时 `_findPlacement`）。新代码出现 id 匹配时先找统一工具。
4. **回滚语义显式标记**。所有回滚用途的 capture 必须携带 `label: 'rollback'`；诊断错误
   （rollbackUnavailable 等）必须携带底层 errors 明细，禁止吞错后只留一句笼统文案。
5. **存档链新增行为时先看 `test/saveSystemRegression.test.js`**——修改
   SnapshotManager / SaveGameService / captureSceneSaveState / captureStreamedChunkState /
   SceneTriggerBindingSystem 前，先让该文件在你的改动上通过。
6. **SDD 接线（documentProjector / snapshotTransformer）只在 `src/core/snapshot/SddSaveWiring.js`**
   （阶段 4 交付）。产品（index.html）与回归测试共用同一工厂实例，禁止再复制闭包——
   同一语义两处实现必然分叉（阶段 4 前曾有 3 处复刻，属四缺陷同族病灶）。


## 一、现状事实

当前一份产品存档是**三层嵌套的采集树**（各层由不同宿主持有、各自实现 capture/validate/restore）：

```
SnapshotManager（SaveGameService.manager）
└─ data.game                       ← 唯一 provider「game」= scene.captureSaveState()
   ├─ player{id,name,transform,stats,inventory,equipment}   (BaseGameSceneSetup.js:546-580)
   ├─ tutorial / dialogue
   ├─ authority                    ← GameSceneRuntime 的 authoritySnapshotService
   │  ├─ stateRevisions / logicalClock / rngState / operationLedger / lastEventSequence
   │  └─ serviceStates             ← AuthoritySnapshotService（第三层）
   │     ├─ eventJournal           (GameSceneRuntime.js:210)
   │     ├─ quests                 (BaseGameSceneBehaviors.js:302)  ← {schemaVersion:2, taskGraph, actors}
   │     └─ campaignContent        (SanguoGameLoaderCoordinator.js:116) ← {blackboard, triggers}
   └─ scene                        ← 场景运行态
      └─ worldStreaming → chunks[] → providers.demoDynamic → {placementStates, resourceNodes, …}
```

关键事实：

1. **任务状态已经是纯数据**。'quests' 段 = `{schemaVersion, definitionRevision, taskGraph, actors}`（QuestTransactionService.js:580-589）。运行态只是 `_states` Map，勾选由命令（QUEST_COMMANDS）驱动，读档后 reconcileTaskFacts 补喂合成事件对账。**用户的「任务就是清单」模型在数据层面已经成立**——问题只在它被埋在第三层 serviceStates 里，且勾选的触发、对账、快照分别由三处代码各自实现。
2. **Blackboard 已经是单文档雏形**（Blackboard.js:24-104 扁平 _vars + serialize 浅拷贝），且 BaseGameSceneSetup.js:636-41 已有 `duplicateAuthorityState` 校验强制剧情状态只存 authority 段——收敛方向在既有架构里已有先例。
3. **恢复顺序存在三处各自的约定**：SnapshotManager 按 provider 插入序（SnapshotManager.js:257，失败逆序回滚）；AuthoritySnapshotService 有固定 participants 序（stateRevisions→clock→rng→ledger→events→serviceStates，AuthoritySnapshotService.js:128-135）；场景层 _applyValidatedSaveState 又有 player→authority→content→dialogue→scene 序（BaseGameSceneSetup.js:795-841）。**同一份文档被三套顺序规则切开**。

## 二、病根：读写权分散（拉模式）

每个系统自己实现 serialize/restore/validate/回滚，SnapshotManager 只做聚合与原子性。过去一周的四个缺陷全部是这个模式的必然产物：

| 缺陷 | 病根 |
|---|---|
| rollbackUnavailable | 采集函数混入持久化守卫（captureSceneSaveState 同时服务保存与回滚两种语义） |
| meta 丢失 | 跨层透传经过 6 层包装函数，任一跳丢参数即静默失效（setStateProvider 那拍） |
| 狼复活 | id 匹配规则在每个环节各写一遍（placementById.has 没抄派生回退） |
| 结局检查点 | 同一语义的 id（preEnding checkpoint）被硬编码在一处调用点 |

规律：**每当「写数据的权利」分散，语义就必然分叉**。拉模式下每个新系统都要重写一遍采集/恢复/校验/回滚四件套，每份实现都是新的耦合面——这不是哪个系统写得差，是模式本身在产生 bug。

## 三、目标架构：单一权威存档文档（SDD）

### 3.1 模型

存档 = **一份带版本化 schema 的纯数据文档**，形如：

```jsonc
{
  "schemaVersion": 3,
  "campaign": { "id": "sanguo-zhangjiao-s01-s14", "revision": 7 },
  "player":   { "identity": {}, "transform": {}, "stats": {}, "inventory": {}, "equipment": {} },
  "world":    { "currentCell": {"col":6,"row":5}, "chunks": { "S01": {…}, "S02": {…} } },
  "quests":   { "definitionsRevision": 7,
                "tasks": { "task.s01.survival": { "status": "completed", "objectives": { "gather.wood": {"done":3,"need":3} } }, … },
                "actors": { … } },
  "narrative":{ "blackboard": {…}, "triggers": {…} },   // 现 campaignContent
  "clock":    { "logical": 0, "rng": {}, "ledger": {}, "eventSeq": 0 }
}
```

原则：

1. **文档只有数据，没有行为**。任何函数（守卫、签名、id 匹配）不得出现在采集路径上。
2. **读写收敛到文档节点**：系统不再 export serialize/restore，改为声明「我消费/产出文档的哪些节点」。文档由唯一的 SddStore 持有，系统经 `store.getNode('quests.tasks.<id>')` / `store.patchNode(...)` 读写，patch 全部走同一入口（天然可校验、可审计、可回滚）。
3. **任务系统退化为勾选器**：只订阅事实事件流（`fact.committed` —— 由权威事务/命令在提交后发布），reducer 是纯函数 `(taskNode, factEvent) => taskNode'`。它不再知道「狼是什么、木头怎么来」，只认「gather.wood +1」「enemy.dead:S01-first-wolf」这类事实。reconcileTaskFacts 变成「回放事实日志」而非现状的特判补喂。
4. **原子性由文档提交保证**：现在的 SnapshotManager.validate→restore→回滚机制整体保留，但操作对象从「N 个 provider 的散装 section」变为「一份文档的一次版本跃迁」。回滚 = 换回上一版文档引用（文档不可变/写时复制），不再需要逆序逐 provider 回滚——**本周的 rollbackUnavailable 问题在模型层面不存在**。
5. **系统重建 = 文档投影**：读档时不再「逐系统 restore」，而是「写完文档 → 各系统订阅的节点变更事件自然到达 → 系统按数据重建运行时视图」（placement 生成、尸体重建都是视图重建，视图重建失败不影响文档，只需重放）。

### 3.2 为什么可行（而非空中楼阁）

- **数据已经存在**：'quests' 段就是勾选树；campaignContent.blackboard 就是叙事状态文档；worldStreaming chunks 已是分节点结构。SDD 第一版 = 把现有三层的形状**拍平换壳**，不改字段语义。
- **收敛先例已立**：duplicateAuthorityState 校验已经在强制「叙事状态只存一处」；Blackboard 已是单容器。SDD 只是把同一纪律推广到 player/world/quests。
- **原子机制可平移**：SnapshotManager 的 validate/rollback 骨架、operationLedger/rng/clock 的恢复序，原样保留为 SDD 的 `clock` 与提交器内部实现。
- **兼容路径存在**：migrate 机制（SnapshotManager.migrate）已支持 v1→N 升级链，旧档一次迁移到 SDD。

### 3.3 迁移路线（四阶段，每阶段可独立验证、可回退）

**阶段 0：钉死现状（1-2 天）**
- 把本周四缺陷的回归场景写成永久测试（rollback 豁免、派生 tombstone 往返、拒存守卫不误伤、meta 逐跳透传）。
- 架构硬规则进 steering：采集函数禁止混业务守卫；跨层透传逐跳核对；派生 id 匹配必须走统一工具。
- 产出：净基线。后续任何改动先跑这组测试。

**阶段 1：立 SddStore 骨架（2-4 天）**
- 新增 `src/core/snapshot/SddStore.js`：不可变文档 + 版本号 + 节点级 patch + 订阅。schemaVersion=3 空壳 + JSON Schema 校验。
- SnapshotManager 增加一条旁路：捕获时**同时**产出 SDD 投影（从现有 data 结构纯函数映射，零业务逻辑），读档时先 migrate 到 v3 再走旧链路。**此阶段双写不双读**，产物仅用于校验投影等价性（等价性测试：随机操作序列下 v1 直读 ≡ v1→v3 迁移读）。
- 产出：文档形状被 100% 测试钉住。

**阶段 2：任务系统先行切换（3-5 天）**
- quests 段成为第一个原生 SDD 节点：QuestSystem 改为订阅 `fact.committed` 的勾选器，_states Map 变成 `quests.tasks` 节点的内存投影；勾选 reducer 纯函数化。
- reconcileTaskFacts 改写为事实日志回放。
- 读档：quests 节点写回 → 任务视图重建。旧 quests 快照 schema（v2）保留 migrate。
- 产出：**用户模型第一次在真实链路成立**——任务=文档节点，完成=打勾，与游戏功能零耦合。验证方式：任务全链 E2E（s01.survival→s02.rescue→s02.summons）+ 任意时点存读往返。

**阶段 3：全量节点迁移（按风险从低到高，1-2 周）**
顺序：campaignContent(blackboard/triggers) → player/tutorial/dialogue → scene/worldStreaming → clock/ledger。
每迁移一个节点：旧 serialize 改为「读旧档时 migrate」+「写新档时产出节点」；该节点业务代码改为节点订阅。worldStreaming 最重（placementStates/resourceNodes/deathDrops…），放最后，且期间旧 captureStreamedChunkState 只充当 migrate 源。
- 产出：SnapshotManager 退化为 SDD 的存储适配器（IndexedDB 读写 + migrate 链），三层嵌套消失。

**阶段 4：清理（2-3 天）**
- 删除各系统 serialize/restore 死代码；duplicateAuthorityState 类校验被 schema 取代；steering 文档更新。

### 3.4 代价与风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| 双写期等价性偏差 | 中——节点语义微妙（如 placementSignature 与 canonical 修订联动） | 等价性模糊测试（随机操作序列）；偏差即测试失败，不静默 |
| 任务事实化后粒度不足 | 中——现有目标有的依赖运行时查询（如「背包中」类） | 事实事件由权威事务提交点发布（已有 prepareConsumeEvent 钩子位），查询型目标改为提交时快照进事实 |
| 迁移中途崩溃的档 | 低——migrate 链单向，回退=旧代码读旧档（双写期一直保留旧链路） | 阶段 3 结束前任何 release 都保持双链路 |
| 工作量 | 全程约 2-4 周有效工时 | 阶段独立可交付，可穿插日常修 bug；阶段 2 完成即可获得最大痛点（任务）的收益 |

**明确不做的事**：不重写业务系统；不改 playtime 内的命令/事务协议（operationLedger 原样进 clock 节点）；不动编辑器写盘的 canonical 数据（那是另一份「文档」，未来可与 SDD 同构，但不在本期）。

## 四、结论

用户的「清单+打勾」「存档=数据集合」模型在本引擎的数据层面**已经基本成立**（quests 段就是勾选树，blackboard 就是叙事文档），未成立的只是「读写权收敛」——正是过去一周全部缺陷的共同病根。SDD 迁移不引入新范式，只是把已经存在的收敛纪律（duplicateAuthorityState、Blackboard 单容器、migrate 链）推广到全档，并以任务系统为第一个受益者。建议按阶段 0→2 启动，阶段 2 交付后复盘再决定阶段 3 的节奏。

---

## 五、阶段 3 第二批论证：player/ui/world 节点（2026-10-03）

### 5.1 现状事实

1. **读写入口高度集中**：player/tutorial/dialogue 段的采集与恢复全部集中在两个函数——
   `captureSaveState`（BaseGameSceneSetup.js:502-589，statsFields 25 字段 + transform/stats/inventory/equipment/name 五组件）与
   `_applyValidatedSaveState`（:753-850，name→transform→equipment→stats→inventory 固定序）。
   scene 段同样集中：`captureSceneSaveState`/`applySceneSaveState`（SanguoSceneStateFlow.js:47-142/375-460，
   含 worldStreamingState、regionStates、campfire、containerInventories、firedPickups、clearedGroups、
   time/weather/gameplaySnapshots/battle/rescue/s11s14 等约 15 个子段）。
2. **transform 是每帧高频写**（MovementSystem.update→setPosition），stats 半高频（stamina 每帧回复 + 战斗/物品事件）。
   若照搬 quests/narrative 模式（每次写同步 patch 文档），每帧深冻结整棵 player 子树——**性能上不可接受**。
3. **worldStreaming 已自治**：WorldStreamingManager.deserialize（:830-981）本身就是 prepareRestore/commit/rollback
   两阶段事务，demoDynamic provider 已实现完整 prepareRestore/commitRestore/rollbackRestore。
   它不需要 SDD 再发明事务，只需要被文档**引用**。

### 5.2 对原方案的修正

原方案说「该节点业务代码改为节点订阅」——对 player/world **不成立，也不应该做**：

- **修正 1：文档镜像分两级**。
  - **运行期镜像节点**（可订阅）：仅限低频事件状态且有视图重建需求的 quests、narrative（已交付）。
  - **存档时文档节点**：player/ui/world——transform 每帧写、world 体积大且自带事务，
    只在 capture 时投影进文档、restore 时从文档读回（sdd 优先）。**不为它们建运行期镜像、不做逐帧同步**。
- **修正 2：sdd.document 已含这三个节点**。阶段 1 的 `projectSnapshotToSdd` 是全量映射
  （player/ui/world.scene 均在），即**每次存档的 sdd 已经是完整文档**。第二批的剩余工作
  只是读端：`snapshotTransformer` 的覆盖范围从 quests/narrative 扩展到 player/ui/world。
- **修正 3：终态定义收敛**。SDD 的价值 = 「存档是规范形状的纯数据集合」（用户最初模型），
  而非「所有状态实时住在文档里」。运行期系统继续用组件/Map；文档在存档时组装完整、
  在读档时作为权威源。这与用户模型完全一致，且避免了高频写陷阱。

### 5.3 实施步骤（轻量，合计约 1 天）

1. **snapshotTransformer 扩展**：sdd.document 存在时依次覆盖
   `data.game.player`（判空跳过——投影对缺段写 null）、`data.game.tutorial/dialogue`（ui 节点）、
   `data.game.scene`（world.scene 节点）；覆盖语义仍是同值替代（随机往返测试已钉等价性）。
2. **等价性测试扩展**：随机档生成器加强 player.ui（tutorial/dialogue 缺失组合）与 scene 段
   子段缺失组合的覆盖；断言扩展 transformer 后 roundtrip ≡ 原快照。
3. **回归**：现有 29 例 + 新增用例全绿；实机冒烟（读档后 player 位置/UI 状态/场景状态与存档一致）。

### 5.4 风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| sdd.player 缺段覆盖丢字段 | 低——投影对缺段写 null，transformer 判空跳过 | 测试覆盖缺段组合 |
| world.scene 大对象拷贝开销 | 低——结构化克隆存档时本来就要做一次 | 无额外动作 |
| 回滚快照也带 sdd 被重复覆盖 | 无害——回滚快照的 sdd 与其 data 同源（capture 时同生） | 同值替代幂等 |
| 每帧写陷阱回归 | —— | 硬规则追加：player/world 节点禁止运行期镜像（本节即规则） |

### 5.5 结论

第二批比原估轻得多：**读写入口集中 + sdd 已含全节点**，剩余工作是「读端覆盖扩展 + 缺段测试」，
约 1 天。完成即达成终态：**存档文件 = SDD 文档（权威源）+ 旧字段兼容别名**；阶段 4（清理旧链路）
可在此之后独立排期。

> **交付记录（2026-10-03）**：第二批已交付。snapshotTransformer 全节点覆盖
> （player / ui.tutorial / ui.dialogue / world.scene，缺段判空跳过）+ 等价性测试 3 例
> （saveSystemRegression 共 32 例全绿）；实机冒烟通过（autosave-1 读档：player 位置与存档点
> 容差内一致、narrative 镜像就位、无 pageerror）。至此 sdd.document 五节点（quests/narrative/
> player/ui/world）在读端均为权威源。

---

## 六、阶段 4 交付记录（2026-10-03）：接线收敛

### 6.1 勘察结论：修正后架构下没有 serialize/restore 死代码可删

原方案阶段 4「删除各系统 serialize/restore 死代码」是为全量节点迁移（业务代码改节点订阅）设计的；
第五章修正后终态收窄（运行期系统继续用组件/Map，文档只在存档时组装、读档时为权威源），
逐项勘察结果：

| 候选 | 结论 | 理由 |
|---|---|---|
| QuestTransactionService / GameLoader serialize-deserialize | **保留（活代码）** | 写端文档镜像的同步源（serialize 时 patch sdd 节点）+ 旧档兼容链路 |
| `duplicateAuthorityState` 校验（BaseGameSceneSetup） | **保留** | 读端守卫：拒绝旧格式在 AuthoritySnapshot 外重复保存叙事状态；SddStore validator 尚未覆盖此语义 |
| SddProjection 三函数 | **保留（全在用）** | 产品投影 + 测试等价断言的基础设施 |
| SddStore subscribe/validate/toJSON/fromJSON | **保留** | 已文档化契约面（quests 节点订阅=任务视图重建入口），测试钉住 |

### 6.2 收敛动作：接线工厂化（消灭复制漂移面）

index.html 内联的 projector/transformer 闭包在测试中曾有 3 处复刻（3b describe、第二批 describe、
运行时优先语义测试）——正是「同一语义两处实现必然分叉」的缺陷同族病灶。收敛为：

- 新增 `src/core/snapshot/SddSaveWiring.js`：
  - `createRuntimeDocumentProjector(getScene)`——写端投影（快照投影 + quests/narrative 运行时节点覆盖）
  - `createSddSnapshotTransformer()`——读端变形（五节点覆盖 + 缺段判空跳过 + 旧档原样跳过）
- index.html 改为工厂调用（`createRuntimeDocumentProjector(() => scene)`），注释收敛为一段
- saveSystemRegression 六处复刻闭包全部替换为消费同一工厂（SDD_QUESTS/SDD_NARRATIVE 等
  测试固定值仍通过包装 baseProjector 注入）
- 硬规则第六条进本文件（见零章）

### 6.3 验证

- SDD 相关测试 49/49 全绿（saveSystemRegression 32 + SddStore 13 + SddProjection 4）
- 实机冒烟（pw-sdd-p3b.mjs）：autosave-1 读档 playerNearSaved=true、narrativeSceneId=S01、无 pageerror，
  与收敛前逐项一致（行为保持）

### 6.4 追加勘察（第二轮）：死文件与重复调用

- **删除 `src/core/snapshot/index.js`**：barrel 纯再导出，全仓零消费者
  （原生 ESM 无目录导入，浏览器直跑无 bundler 解析）。
- **campaignContent capture 双 serialize 兜底简化**（SanguoGameLoaderCoordinator）：
  serialize 已同步 patch 'narrative' 节点，`getNode('narrative') || gameLoader.serialize(...)`
  的右支是不可能分支的重复序列化 → 改为捕获首次返回值 `?? serialized` 兜底（同形状）。
- **复核有消费方、确认保留**：GameLoader.lastSuccessfulSnapshot（canonical pipeline/测试）、
  SaveGameService 槽位常量（产品接线）、questSystem.snapshot()/restore()（quests authority
  participant）、LocalStorageAdapter（非 IndexedDB 回退 + 旧档迁移）、SnapshotManager.migrate（restore 链）。
- **仍属「契约面」生产暂无调用（保留）**：SddStore subscribe/validate/toJSON/fromJSON、
  SddProjection 的 projectSddToSnapshot/sddSemanticEquals（等价断言 + 未来 migrate 链读取端）。

验证：saveSystemRegression 32/32 + RealCanonicalColdRestartReplay 5/5（单独跑全绿，含此前
并发波动的 P5.2）。

### 6.5 阶段 3 尾巴收口：eventJournal/clock 读端权威（2026-10-03）

原阶段 3 排序「clock/ledger 放最后」的残留：sdd.document 的 `eventJournal` 与 `clock` 节点
一直只投影不消费（读端覆盖了 quests/narrative/player/ui/world 五节点）。收口动作：

- `createSddSnapshotTransformer` 扩展：`serviceStates.eventJournal` 覆盖 +
  authority 时钟字段逐字段覆盖（snapshotSchemaVersion / definitionRevision / stateRevisions /
  lastEventSequence / logicalClock / rngState / operationLedger，逐字段判空跳过——投影对缺段写 null）。
- saveSystemRegression 新增 3 例（clock/eventJournal 全字段恢复 / clock 逐字段 null 跳过 /
  eventJournal 缺段跳过），现 35 例。

**至此 sdd.document 全部投影节点（quests/narrative/player/ui/world/eventJournal/clock）在读端
均为权威源，「双写不双读」的例外清零**。语义安全性：clock 覆盖是同值替代（投影与采集同源同值，
sddSemanticEquals 往返测试钉住），AuthoritySnapshotService 固定恢复序不受影响——RealCanonical
ColdRestartReplay 全绿证实。

验证：saveSystemRegression 35/35 + RealCanonicalColdRestartReplay 5/5 + 实机冒烟与收口前一致。

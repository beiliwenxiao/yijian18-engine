# M1 生产与锻造 · 实施级设计

> 状态：实施级设计（未动代码）· 2026-11-09
> 归属：[阶段总表](tasks.md) M1 行 · 模块文档 [01-production-forging.md](01-production-forging.md) · 决策依据 [decisions.md](decisions.md)（P5 铜钱物品化、P9 工坊/铁匠为可建造建筑）
> 定位：把「工位 × 配方 × 作业」从 S01 场景硬编码里抽成数据驱动链路。**不新增战斗/大地图概念**，分 1A~1C 三段，每段可独立验收；1A 完成后 S01 旧配方行为零变化。

---

## 1. 现状实证（勘察结论 15 条）

| # | 事实 | 证据 | 对 M1 的影响 |
|---|---|---|---|
| 1 | **没有 ProductionSystem** | `src/systems/` 全量清单无 `ProductionSystem.js`；`src/systems/index.js` 无该导出 | 全新写（照 ConstructionSystem 骨架） |
| 2 | 配方硬编码在场景层 | `S01S02SceneFlow.js:29-90`（`RECIPE_ACTIONS` 6 条，按 `workstationId` 三元判断）、`:1510-1589`（`_createRecipeSnapshot` 里 `workstationId === 's01.cookingRack'` 分支） | 加配方必须改代码 → 1A 抽成 `recipes` 表 |
| 3 | 制作会话也在场景层 | `S01S02SceneFlow.js:1696-1725`（`_startRecipeAction`，`operationId = s01:recipe:*`）、`:1740-1808`（进度结算，按 `recipeId` 选 `story.*`/`craft.*`） | 会话状态机抽成系统，进度仍由场景 tick 驱动 |
| 4 | 配方 UI 是纯展示层 | `src/ui/RecipeSelectionView.js:23-235`：只发 input 命令 `selectRecipe`（`{type, workstationId, recipeId}`），由场景消费（`S01S02SceneFlow.js:1859-1861`） | **UI 零改**，只换数据源 |
| 5 | ConstructionSystem 是可照抄的骨架 | `src/systems/ConstructionSystem.js`：`registerDefinitions:41`、`start:181`、`update:283`、`cancel:295`、`captureRuntime:311`、`restoreRuntime:319`、`synchronizeStructure:67`、`prepareRepairDraft:83`、`_remember:636`（operationId 幂等） | ProductionSystem 与其同构：定义表 + pending + 预扣 + 回滚 |
| 6 | 建造定义字段已齐 | `game.project.json:302-415`（`construction.definitions`：costs/duration/requiredProficiency/requiredToolType/maxDurability/manned/warEffects）、`:418+`（`sites`） | 只需新增 `stations[]`，其余字段复用 |
| 7 | 建造已进场景快照 | `SceneGameplaySystemAssembler.js:805` 注册 `gameplay.construction`（order 502 / OWNED）、`:741-752` 配置装配 | M1 同款注册 `gameplay.production`（order 503） |
| 8 | InventoryTransactionService 是唯一库存写入口 | `src/systems/InventoryTransactionService.js`：`commit:205-223`（operationId 幂等）、`forgetOperation:201`（回滚释放）、`_commitBatchExchange:329`、`previewBatchRemove:124 一带` | 预扣/退料/提交全走它，生产系统不直改 `InventoryComponent` |
| 9 | `state.transaction` 执行链已验证 | `src/systems/CanonicalStateTransactionService.js:151-229`：读 `commands.json` 的 `transaction.inventory`，执行 batchExchange，写 `storyState/cityStates/blackboard` | 产物提交走 `craft.<recipeId>`，天然入档 |
| 10 | 已有 craft 命令范式 | `commands.json:684-705`（`craft.s01.wolfHideVest`：`state.transaction` + `batchExchange`，`removeEntries` 材料 / `addEntries` 成品） | 新配方命令逐条照抄 |
| 11 | ToolRepairService 只认工具 | `src/systems/ToolRepairService.js:38-125`，`:70` 对非 `toolType` 直接拒绝；接线 `SceneGameplaySystemAssembler.js:501`（`registerCommandHandler('item.repair', toolRepairService)`） | 装备修复必须新服务，**且要在同一 handler 上按 payload 分流** |
| 12 | 熟练度系统可直接复用 | `src/systems/progression/ProficiencySystem.js:21-105`：`gainExperience({characterId, type, amount, operationId})` | 配方 `experience` 写 `craft` 技能，无需新系统 |
| 13 | 任务目标可扩展 | `src/systems/quest/ObjectiveTypeRegistry.js`（`gather.item` 等已注册） | 新增 `craft.item` |
| 14 | **无生产/建造专用单测** | 全仓 glob `*Construction*` 仅命中 3 个源码文件（含 `Temp/baseline-wt` 副本），无 `.test.js` | M1 必须自带骨架级单测，否则改动无护栏 |
| 15 | 铜钱无权威载体 | `library.json` 的 `shops: []` 为空；背包/属性无金币字段 | 按 P5 定稿用**物品** `currency.copper`；M1 只做物品与配方工钱，不建货币系统 |

> 另：`recipes` 这个 library section 的 Registry kind 由 [M0 Step 1](m0-foundation.md) 注册，M1 直接消费，不重复改注册表。

---

## 2. 分步改动顺序（Step 1~8）

原则：**先数据 → 后骨架 → 再表现 → 最后改旧链**。每步自成闭环，可单独跑测试验收。

### Step 1 · 配方数据化（1A）

| 文件 | 改动 |
|---|---|
| `src/data/schema/CanonicalSchemas.js` | 新增 `RECIPE_SCHEMA`：`id/name/station/inputs[]/outputs[]/duration/experience/requiredProficiency/wage/kind/quality/failure`，除 `id/station/inputs/outputs` 外全部 `required:false` |
| `example/.../project/library.json` | `recipes: []` 填 2 条起步配方（`recipe.wood_arrow`、`recipe.wooden_shield`），字段照 [01 §5.1](01-production-forging.md) |
| 编辑器 | 内容库「配方」类别（**可延后到 1B**，不阻塞运行时） |

- 验证：schema 单测（必填缺失报错 / 可选缺省通过）；加载后 `registries.recipes.size === 2`。

### Step 2 · 建筑 `stations[]`（1A）

| 文件 | 改动 |
|---|---|
| `game.project.json` | `construction.definitions` 新增 `construction.workshop`（`stations: [{ id:'station.workshop.carpenter', name:'木作台', workerSlots:1, recipes:['recipe.wood_arrow','recipe.wooden_shield'] }]`）；铁匠定义留到 1B |
| `ConstructionSystem._normalizeDefinition:604` | 透传 `stations`（只保字段 + 校验 station.id 在定义内唯一，不改其余逻辑） |

- 验证：建造一座工坊 → 建筑实体可读到 `stations`；现有 6 个建筑定义加载结果逐字节不变。

### Step 3 · ProductionSystem 骨架（1A）

**新文件** `src/systems/ProductionSystem.js`，与 ConstructionSystem 同构：

```js
// 校验链顺序固定：工位可用 → 配方存在且属于该工位 → 熟练度 → 材料 → 预扣 → 锁工位
start({ characterId, inventory, stationId, recipeId, operationId })
update(dt)                       // 到点发 production.ready，不写产物
commitOutput(jobId, transactionResult)   // 仅在 craft.<recipeId> 成功后调用，释放工位
cancel(jobId, reason)            // 退料 + 释放工位
retryRefund(jobId)               // 退料失败重试（照抄 ConstructionSystem:303）
captureRuntime() / restoreRuntime(snapshot)
getStationRecipes(stationId)     // 供 UI 快照
```

- **硬约束 1**：产物只由 `craft.<recipeId>`（`state.transaction`）写入，本系统**不做 add**。
- **硬约束 2**：操作幂等走 `operationId = production:<stationId>:<recipeId>:<seq>` + `_remember`。
- **硬约束 3**：`start` 内材料预扣用 `inventoryTransactions.commit({ type:'batchRemove', operationId })`；失败不回滚已扣（因为原子）——成功才建 pending。

- 验证（单测）：预扣成功 / 材料不足拒绝且库存不变 / 取消原样退料 / 同 operationId 重复 start 返回同一结果 / 工位已被占用拒绝。

### Step 4 · 场景接线（1A）

| 文件 | 改动 |
|---|---|
| `SceneGameplaySystemAssembler.js` | 构造 ProductionSystem（配置项对齐 `constructionConfig` 同款注入：inventoryTransactions / proficiencySystem / createCheckpoint / onEvent），注册 `gameplay.production`（order 503），并在 `:849` 的映射表加 `production: 'productionSystem'` |
| `ScenarioCommandService` | 新增 `production.open / production.start / production.cancel / production.collect`（场景协调层入口） |
| `RecipeSelectionView` 数据源 | 场景侧 `_createRecipeSnapshot` 改为 `productionSystem.getStationRecipes(stationId)` 生成，**组件本身不改** |

- 验证：靠近工坊 → 面板列出 2 条配方 → 开工 → 进度条 → 完成 → 背包 +10 箭；材料不足时置灰并给原因。

### Step 5 · S01 legacy 适配（1A 收尾，零回归的关键）

| 改动 | 说明 |
|---|---|
| `RECIPE_ACTIONS`（`S01S02SceneFlow.js:29-90`） | **原样保留**为 legacy provider，一行不删 |
| `openRecipeSelection` | 加一层分派：`workstationId` 命中 legacy 表 → 走旧路径（原逻辑不动）；否则 → 走 ProductionSystem |
| 旧 `_startRecipeAction` | 仅当命中 legacy 时可达，新工位永不走它 |

- 目的：主线的烤肉/制皮/狼皮兑换**行为与耗时完全一致**，新系统只在工坊生效。
- 验证：S01 全流程回归（烤肉、制皮、兑换狼皮背心/护腕）事件序列、耗时、产物数量与基线一致。

### Step 6 · 装备修复（1B）

| 文件 | 改动 |
|---|---|
| **新** `src/systems/EquipmentRepairService.js` | `quote({ itemInstance, stationId })` → `材料 = ceil(缺口比 × 配方材料)` + `铜钱 = 缺口比 × 基准价`；`repair()` 走 `batchRemove` + checkpoint；仅 `station.kind === 'repair'` 可用 |
| `SceneGameplaySystemAssembler.js:501` | `item.repair` handler 改为分流器：`payload.kind === 'equipment'` → 新服务；否则 → 旧 `ToolRepairService`（**其内部零改动**） |
| `game.project.json` | 新增 `construction.forge`（`stations: [{ id:'station.forge.anvil', kind:'forge' }, { id:'station.forge.repair', kind:'repair' }]`） |

- 验证：武器耐久 30% → 铁匠报价 → 扣材料与铜钱 → 修满；非铁匠处点修复返回 `stationUnavailable`；工具修复行为与基线一致。

### Step 7 · 锻造（1C）

| 改动 | 说明 |
|---|---|
| `ProductionSystem` 的 `kind:'forge'` 分支 | `quality.mode:'roll'` → 权重偏移掷骰；`failure.mode` 三档（`none` / `partial_refund` / `destroy_materials`） |
| RNG | 必须注入（`rng` 构造参数），种子入快照；**禁止 `Math.random()`**，否则不可回放 |
| 产物实例 | 走 `craft.<recipeId>` 提交，品质倍率在 `items[]` 模板的 `stats` 上乘算 |

- 验证：造 3 次至少 1 成 1 败；失败返 50% 材料且铜钱不退；同种子重放结果一致。

### Step 8 · 任务与触发器（跨 1A~1C）

| 类型 | 落点 |
|---|---|
| 任务目标 | `ObjectiveTypeRegistry` 新增 `craft.item`（`{ target, requiredCount }`，由 `production.completed` 驱动） |
| 触发器 when | `production.completed` / `production.failed` / `item.repaired`（后者已由 ToolRepairService 发同名事件，装备修复沿用） |
| 一次性事实 | `craft.first.<recipeId>` 走 `state.transaction` 写 `storyState` |

- 1A 若不想动内核：先用 `custom.event` 目标（事件名亦为 `craft.item`）过渡，1B 再落成正式 Objective 类型。

---

## 3. 数据落点

| 数据 | 落点 | 说明 |
|---|---|---|
| 配方 | `library.json.recipes[]` | Registry kind 由 M0 注册；纯数据，加配方零代码 |
| 工位声明 | `game.project.json.construction.definitions[].stations[]` | 建筑建好即工位可用；损毁则不可用（读 `BuildingComponent` 耐久） |
| 建筑与耐久 | `construction.definitions` + `BuildingComponent` + `synchronizeStructure:67` | 已有，不动 |
| 装备耐久 | `library.json.items[].durability { max, perUse, brokenMultiplier }` | 新增可选字段；无该字段 = 永不磨损（零回归） |
| 铜钱 | `library.json.items[]` 新增 `currency.copper`（`type:'currency'`，`maxStack:9999`） | P5 定稿为物品；不进装备槽 |
| 作业队列 | `ProductionSystem.pending` → `captureRuntime()` ⇒ `gameplay.production` 场景快照 | 与 `gameplay.construction`（`:805`）同款；切场景回来进度保留 |
| 熟练度 | `ProficiencySystem`（skill = `craft`） | 配方 `experience` 直接写 |
| 一次性事实 | `commands.json` 的 `craft.*` / `craft.first.*` | 走 `state.transaction` + `blackboard/storyState` |

**迁移方式**：全部为**纯追加**——新 section 空数组占位、新字段 `required:false`、新命令追加在 `commands.json` 尾部；既有 17 个 library section 与 6 个建筑定义零改动。回滚 = 删除新增数据 + revert 装配点（不产生运行时残留，因为无存档迁移）。

---

## 4. 任务与触发器接法

### 4.1 命令

| operation | payload | 语义 |
|---|---|---|
| `production.open` | `{ stationId }` | 打开工位配方面板（只读快照） |
| `production.start` | `{ stationId, recipeId }` | 开工：校验 + 预扣材料 + 锁工位 |
| `production.cancel` | `{ jobId }` | 取消并退料 |
| `production.collect` | `{ jobId }` | 领取产物（提交 `craft.<recipeId>`） |
| `item.repair` | `{ itemInstanceId, stationId, kind:'equipment' }` | 装备修复（与工具修复共用一个命令，按 `kind` 分流） |
| `craft.<recipeId>` | — | **真正的库存提交**（`state.transaction` + `batchExchange`），协调层不写库存 |

### 4.2 触发器

| when | payload | 用途 |
|---|---|---|
| `production.completed` | `{ stationId, recipeId, outputs }` | 首次生产、解锁下一配方、任务推进 |
| `production.failed` | `{ recipeId, reason }` | 提示/挫败反馈 |
| `item.repaired` | `{ itemId, definitionId }` | 修复完成（已有事件，装备修复沿用） |
| `construction.constructionCompleted` | `{ siteId, definitionId }` | 工坊/铁匠建成（已有范式） |

---

## 5. 零回归论证

| 风险 | 为什么不会发生 |
|---|---|
| 抽配方导致 S01 主线卡死 | Step 5 的 legacy provider：旧 `RECIPE_ACTIONS` 一行不删，命中旧工位走旧路径；回归用现有 S01 用例逐条比对 |
| 装备修复污染工具修复语义 | `ToolRepairService` 内部零改动；只在 handler 外层加按 `kind` 分流 |
| 材料预扣与存档不一致 | pending 进 `gameplay.production` 快照；`commit` 失败 `retryRefund` 退料（照抄 ConstructionSystem 回滚事务） |
| 品质随机不可复现 | RNG 注入 + 种子入快照，禁止 `Math.random()` |
| 铜钱物品破坏背包 | `type:'currency'` 单独归类，不进装备槽；`maxStack` 大；无该物品时所有工钱按 0 处理 |
| 新增建筑定义影响旧建造 | 只追加定义，`_normalizeDefinition` 仅多透传一个可选字段 |
| 新 section 被报「未消费配置」 | M0 Step 6 已登记 `library.recipes[*].**` |
| 性能 | 生产 update 用低频 tick（0.25s）；不进战斗热路径 |

**判定标准**：M1 前后跑同一批场景冒烟，**实体数、S01 产出物数量与耗时、存档字节**三项一致（新工坊场景除外）。

---

## 6. 验收标准

### 6.1 自动化

| 测试 | 预期 |
|---|---|
| `RECIPE_SCHEMA` 单测 | 必填缺失报错；可选字段缺省通过；`station` 为空的配方拒绝 |
| ProductionSystem 单测（新） | 预扣/退料/幂等/工位占用/材料不足/熟练度不足 六例全绿 |
| EquipmentRepairService 单测（新，1B） | 报价公式、缺口 0 拒绝、材料不足拒绝、非 repair 工位拒绝 |
| 锻造掷骰单测（新，1C） | 同种子同结果；权重分布 ±5%；失败档三档返还正确 |
| `craft.item` 目标单测 | `production.completed` 驱动计数 + 达标 |
| 既有全量回归 | 场景核心 + 存档 + EntityFactory + PlacementSpawner 全绿（基线 112 项不退） |

### 6.2 加载实例验证

```
加载 example/sanguo_zhangjiao
  → registries.recipes.size === 2
  → S01 全部旧配方路径命中 legacy provider（日志标注 legacy）
  → 建造 construction.workshop 完成 → 工位 station.workshop.carpenter 可用
  → 靠近工位 → production.open 快照含 2 条配方、材料数量与禁用原因
```

### 6.3 手动冒烟

建造工坊 → 造木箭 ×10 → 中途取消（材料退回）→ 再造一次（背包 +10）→ 切场景再回（进度保留）→ S01 烤肉仍正常。

---

## 7. 拍板结论（3 条已定稿 + 7 条按推荐值定稿）

### 7.1 已拍板（2026-11-09 用户裁定，落 decisions.md P16~P18）

| # | 问题 | 定稿值 | 替代方案差异 | 改动成本 |
|---|---|---|---|---|
| **P16 / Q1** | 箭矢是否作为消耗品？ | **是**。远程每次攻击按 `ammoPerShot`（默认 1）扣 `wooden_arrow`；弹药见底该兵**不参与远程攻击**（转待命/近战保底），补给走模块 2 配给单（弓箭兵每人配箭）。**只在物品声明 `ammo` 数据时生效** → 未声明弹药的老兵种零变化 | 不消耗：`wooden_arrow` 退化成纯卖钱物品，"伐木做箭"失去玩法意义，工坊只剩木盾/猎弓两条配方 | **中**——`CombatSystem` 远程出手处加一次扣减 + 弹药计数落到组件（复用 `EquipmentComponent` 或新增 `ammo` 字段）+ 配给单加一行；**零回归靠"无 ammo 数据不扣"** |
| **P17 / Q2** | 装备是否引入耐久消耗？ | **是**。装备定义可选 `durability { max, perUse, perHit, brokenMultiplier }`；命中扣 `perUse`（默认 1）、受击扣 `perHit`（默认 1）；耐久 0 → 属性 ×`brokenMultiplier`（默认 0.5），**不销毁**；修复走 Step 6 的 `EquipmentRepairService`（铁匠工位 + 按缺口计费） | 不引入：1B 的装备修复没有触发源，`item.repair` 只服务工具，铁匠玩法形同摆设 | **中**——`EquipmentSystem.update`（现为空实现）落地 + 战斗结算两处扣减 + `getBonusStats` 一处乘算；**只在装备声明 `durability` 时生效** → 老装备零变化 |
| **P18 / Q3** | 工坊/铁匠是「可建造建筑」还是「场景固定设施」？ | **可建造建筑**。保留 Step 2 的 `construction.definitions[].stations[]` + 完整建造链（材料/工具/熟练度/耐久/维修） | 主城固定设施：省掉建造链与材料消耗，但策划不能自由摆放，且与"通用建造系统"分叉出第二套设施模型 | **零额外**——就是本文件原设计（Step 2 已按可建造写）；改判 B 才需要把 `stations[]` 改成场景 placement 绑定、删建造链 |

> **三条都取 A，M1 全部设计（Step 1~8）按原样成立，无需返工。**

**M1 ↔ 模块 9 的联动（已生效，双向引用，改一处必须改另一处）**

| 联动项 | 结论 | 落点 |
|---|---|---|
| 粮耗下调 | 因 **P16（箭矢）+ P17（耐久）双开**，粮草已不是唯一强制消耗口 → [09 文档](09-food-logistics-economy.md) §3.1 的 `personDayFactor` **按 ×0.8 执行：步 0.8 / 弓 0.8 / 骑 2.4**，`storageSpoilPerDay` **0.005 → 0.003** | 改这里必须同步 09 §3.1 / §3.2 / §5.6；反之亦然 |
| 箭矢归属 | 箭矢是**配给物资**（模块 2 押运 + 军营库存），与粮草共用押运损失表与容器，不另立"弹药仓" | 09 §5.7 互斥不双扣规则同样适用于箭矢 |
| 修复与产出冲突 | 铁匠既修装备也造装备，同一工位排队；**修复优先**（修复是时间敏感需求） | Step 6 / Step 7 共用 `ProductionSystem` 队列 |

### 7.2 已按推荐值定稿（7 条）

| 项 | 定稿 | 替代差异 | 改动成本 |
|---|---|---|---|
| 锻造失败档 | 默认 `partial_refund`（返 50% 材料，铜钱不退） | 零失败 → 量产无风险；材料全损 → 高风险配方 | 配方字段 `failure.mode`，纯数据 |
| 词条系统 | **M1 不做**（1C 只做品质倍率） | 加词条需 `affixes[]` 表 + 汇总层叠加 | 约 +1 张数据表 + `getBonusStats` 一处改写 |
| 铜钱载体 | 物品 `currency.copper`（P5 已拍板） | 全局货币状态 → 需新增存档白名单与 UI 绑定 | 改成状态要动存档 schema 与背包 UI |
| 工人 | 复用 `manned`；1A~1C 允许玩家本人驻留，工人系统后置 | 1A 就上工人 → 依赖模块 2/3 | 现状 `BuildingComponent.manned` 已存在，零成本 |
| 建筑等级 | **不区分 Lv1/Lv2**（只用角色 `craft` 熟练度做单门槛） | 加等级 → 双门槛，玩家要同时升熟练度与建筑 | 加字段 + 解锁校验一处 |
| 城池战损对生产的影响 | 读 `cityDamageRatio`，**默认系数 1.0**（可配开启） | 直接停产 → 打击感强但挫败 | 配置项，一处乘算 |
| 配方熟练度门槛 | `craft` level 0 解锁基础配方，1 解锁铁器，2 解锁稀有 | 门槛过高会卡住 1A 验收 | 纯数据 |

---

## 8. 工作量与风险

| 项 | 判断 |
|---|---|
| 最大工作量 | Step 3（ProductionSystem 骨架）+ Step 5（legacy 适配）——前者要照抄一套带事务回滚的骨架，后者要保证主线零回归 |
| 最大风险 | S01 legacy 分派写错导致主线配方失效 → 用"命中即走旧路径"的白名单式分派（只放行新工位），而不是黑名单 |
| 次大风险 | `item.repair` 分流改错导致工具无法修 → 单测覆盖三条路径（工具 / 装备 / 未知 kind） |
| 明确不做的 | 词条系统、货币经济系统、工人调度、建筑等级、生产队列并行（都留给后续迭代或有依赖的模块） |
| 与 M0 的边界 | M0 只注册 `recipes` kind + `RECIPE_SCHEMA`（若已做则 M1 不重复）；M1 只消费 |

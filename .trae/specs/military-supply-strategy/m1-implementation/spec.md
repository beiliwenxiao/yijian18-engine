# M1 生产与锻造 · 实施级规格（Spec Mode）

> 状态：待批准（批准后按 [tasks.md](tasks.md) 执行）
> 上游：[m1-foundation.md](../m1-foundation.md)（Step 1~8 设计）· [tasks.md](../tasks.md) M1 行（验收）
> 归属：[军需—配给—押运—军团体系总纲](../spec.md)
> 范围：`d:\yijian18-engine` 仓库内 M1 代码与内容数据改动。**不新增战斗/大地图概念**。

---

## 1. 目标与范围

把「工位 × 配方 × 作业」从 S01 场景硬编码抽成数据驱动链路，并按 P16/P17/P18 落地箭矢消耗、装备耐久、可建造工坊/铁匠。

| 段 | 交付 | 段落验收 |
|---|---|---|
| 1A | `RECIPE_SCHEMA` 数据写入 + 建筑 `stations[]` + `ProductionSystem` 骨架 + 场景接线 + S01 legacy 白名单分派 | S01 旧配方行为零变化；新工位可 `start → ready → collect` |
| 1B | `EquipmentRepairService` + `currency.copper` 物品 + P17 耐久扣减 | 耐久归零降属性且可修复；工具修复零变化 |
| 1C | 锻造品质掷骰 / 失败三档 + P16 箭矢消耗 | 同种子可复现；无弹不打远程 |
| 跨段 | `craft.item` 任务目标 + `production.*` 事件 | 事件驱动任务进度 +1 |

**非目标（明确不做）**：词条系统、货币经济系统、工人调度、建筑等级、生产队列并行、配方编辑器 UI（M1 不排，运行时先行）、S01 主线新增工坊剧情编排。

---

## 2. 已核实现状锚点（本轮勘察）

| # | 落点 | 事实 |
|---|---|---|
| 1 | [CanonicalSchemas.js](file:///d:/yijian18-engine/src/data/schema/CanonicalSchemas.js#L151-L170) | `RECIPE_SCHEMA` 已存在（M0），字段与上游一致，**M1 不改 schema** |
| 2 | [Registry.js](file:///d:/yijian18-engine/src/core/Registry.js#L54) | `recipes` 已在 `STANDARD_REGISTRY_KINDS` |
| 3 | [library.json](file:///d:/yijian18-engine/example/sanguo_zhangjiao/project/library.json#L3970) | `recipes: []` 占位；`wooden_arrow` 在 :1363（`subType: "ammo"`） |
| 4 | [ConstructionSystem.js](file:///d:/yijian18-engine/src/systems/ConstructionSystem.js#L604-L634) | `_normalizeDefinition` 白名单重建字段，**未透传 `stations`** |
| 5 | [ConstructionSystem.js](file:///d:/yijian18-engine/src/systems/ConstructionSystem.js#L181-L328) | `start/update/cancel/retryRefund/captureRuntime/restoreRuntime/_remember` 可直接同构复用 |
| 6 | [InventoryTransactionService.js](file:///d:/yijian18-engine/src/systems/InventoryTransactionService.js#L205-L327) | `commit` 幂等 + `previewRemove` + `batchRemove/batchAdd` 原子回滚 |
| 7 | [CanonicalStateTransactionService.js](file:///d:/yijian18-engine/src/systems/CanonicalStateTransactionService.js#L210-L229) | **`batchAdd` + `addEntries` 可用**（add-only 提交合法） |
| 8 | [ToolRepairService.js](file:///d:/yijian18-engine/src/systems/ToolRepairService.js#L49-L125) | 只认 `toolType`；`item.repair` 单一 handler 注册在 [SceneGameplaySystemAssembler.js](file:///d:/yijian18-engine/src/core/scene/SceneGameplaySystemAssembler.js#L489-L501) |
| 9 | [EquipmentComponent.js](file:///d:/yijian18-engine/src/ecs/components/EquipmentComponent.js#L236-L238) | `getBonusStats()` 直接回 `bonusStats`，无耐久折损 |
| 10 | [EquipmentSystem.js](file:///d:/yijian18-engine/src/systems/EquipmentSystem.js#L57-L60) | `updateEquipmentEffects` 空实现（P17 落点） |
| 11 | [S01S02SceneFlow.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/S01S02SceneFlow.js#L29-L66) | `RECIPE_ACTIONS` 6 条（烤肉/制皮），`_createRecipeSnapshot:1510`、`_startRecipeAction:1696`、`handleRecipeCommand:1852`、`handleAction:1881` |
| 12 | [SanguoGameLoaderCoordinator.js](file:///d:/yijian18-engine/example/sanguo_zhangjiao/systems/SanguoGameLoaderCoordinator.js#L244-L300) | `config.construction` 由 `gameLoader.project.construction` 投影，`config.production` 同款新增点 |
| 13 | [SceneGameplaySystemAssembler.js](file:///d:/yijian18-engine/src/core/scene/SceneGameplaySystemAssembler.js#L741-L857) | construction 装配 + `gameplay.construction` order 502 + `fields` 映射表 |
| 14 | [ObjectiveTypeRegistry.js](file:///d:/yijian18-engine/src/systems/quest/ObjectiveTypeRegistry.js#L45-L56) | `DEFAULT_OBJECTIVE_TYPES` 内置 4 类，`progressBy` 已有先例 |
| 15 | [CombatSystem.js](file:///d:/yijian18-engine/src/systems/CombatSystem.js#L969-L1088) | `performAttack` 单一结算入口（预警 → 格挡 → `combat.attack` → 伤害）；远程/弹药尚无消费点 |

---

## 3. 关键决策（实现即按此落地）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **不改 `RECIPE_SCHEMA`**，只填数据；`experience`/`requiredProficiency` 形如 `{ craft: n }`；`wage` 形如 `{ copper: n }` | M0 已建 schema，M1 只消费（上游 §3 明确） |
| D2 | **工钱按"输入"预扣**：`start` 时若 `wage.copper > 0`，与 `inputs` 合并为一次 `batchRemove`（材料+铜钱），产出命令**只 add** | 避免产出命令同时扣款导致预扣双记账；`batchAdd` 已验证可用 |
| D3 | `stations[]` 透传并在 `_normalizeDefinition` 内校验：`id` 定义内唯一、`recipes` 为字符串数组、`workerSlots` ≥1、`kind ∈ {craft,forge,repair}`（缺省 craft） | 只多一个可选字段，旧 6 个定义逐字节不变 |
| D4 | `ProductionSystem` 与 `ConstructionSystem` **同构**（同样的事务/幂等/回滚/快照语汇） | 降低认知成本、复用已验证路径 |
| D5 | 站台可用性**依赖注入**：`resolveStation(stationId) → { ok, definitionId, entityId, durability }`；缺省返回 `stationUnavailable`；场景侧扫 `BuildingComponent` + `construction.definitions` | 引擎不感知 ECS 建筑；建筑损毁即不可用（读耐久） |
| D6 | 产物提交命令命名 **`craft.production.<recipeId>`**（`state.transaction` + `batchAdd`），由场景在 `productionReady` 时 `_submit`，成功后调 `productionSystem.commitOutput(jobId, result)` | 与上游 §4.1 一致；`craft.<recipeId>` 命名冲突风险由 `production.` 段隔开 |
| D7 | S01 legacy 分派用**白名单**：`LEGACY_WORKSTATIONS = new Set(Object.values(RECIPE_ACTIONS).map(a => a.workstationId))`；命中 → 旧路径（一行不改）；未命中 → production | 上游 §8「最大风险」的指定解法；新工位永不走旧链 |
| D8 | 装备耐久：物品定义可选 `durability { max, perUse, perHit, brokenMultiplier }`；实例字段 `durability` / `durabilityMax`；`EquipmentComponent.getBonusStats()` 在 `durability <= 0` 时把加成 ×`brokenMultiplier`（默认 0.5）；`EquipmentSystem.consumeDurability(entity, kind, amount)` 负责扣减并在**跨 0 边界**时重算属性 | 只在声明 `durability` 时生效 → 老装备零变化；修复只需回填 `durability` 再重算 |
| D9 | 箭矢：武器物品可选 `ammo { itemId, perShot }`（缺省 itemId `wooden_arrow`、perShot 1）；`CombatSystem` 远程结算**前**调用 `AmmoService.consume(attacker)`：玩家从 inventory `batchRemove`，NPC 从 `entity.ammoCount` 递减；返回 false → **本次远程攻击不结算**（不进入伤害），并推进冷却防止卡死 | 上游 P16「只在声明 `ammo` 时生效」；无配置老兵种零变化 |
| D10 | `production.completed` payload 固定含 `{ stationId, recipeId, outputs:[{itemId,quantity}], itemId, quantity }`（`itemId/quantity` = 首个产物，供任务目标） | 目标类型只需单产物身份，避免数组匹配器 |
| D11 | M1 **不新增配方编辑器 UI**、**不新增 S01 工坊剧情触发器**；`production.open` 以场景 operation `openProductionStation`（`params.stationId`）暴露，内容侧接一个 trigger 即可启用 | 避免改主线剧情；验收走单测 + 加载实例 + 建造链 |
| D12 | 所有新测试用 **vitest**，与 `M0Foundation.test.js` 同风格；RNG 必须注入，禁止 `Math.random()` | 上游 §6.1；可回放 |

---

## 4. 精确改动清单

### Step 1 · 配方数据（1A）
- `example/sanguo_zhangjiao/project/library.json`
  - `recipes` 填 2 条：
    - `recipe.wood_arrow`：`station: "station.workshop.carpenter"`，`inputs: [{itemId:"resource.wood",quantity:1}]`，`outputs: [{itemId:"wooden_arrow",quantity:10}]`，`duration: 6`，`experience:{craft:3}`，`requiredProficiency:{craft:0}`，`wage:{copper:2}`，`kind:"craft"`
    - `recipe.wooden_shield`：`station: "station.workshop.carpenter"`，`inputs:[{itemId:"resource.wood",quantity:4}]`，`outputs:[{itemId:"equipment.workshop.wooden_shield",quantity:1}]`，`duration: 12`，`experience:{craft:5}`，`requiredProficiency:{craft:1}`，`wage:{copper:5}`，`kind:"craft"`
  - `items` 追加 `equipment.workshop.wooden_shield`（type equipment / subType armor / maxStack 1 / stats `{defense:6}` / `durability:{max:120,perUse:0,perHit:1,brokenMultiplier:0.5}`）
  - `items` 追加 `currency.copper`（type currency / maxStack 9999 / subType copper / 无装备槽）
- `src/core/M0Foundation.test.js`：`expect(library.recipes).toEqual([])` → 改为断言 `recipes` 为数组且长度 ≥2（M0 空库语义由 M1 接续）

### Step 2 · 建筑 `stations[]`（1A）
- `example/sanguo_zhangjiao/game.project.json` `construction.definitions` 追加：
  - `construction.workshop`：costs wood 12 + iron 4，duration 40，experience 20，requiredProficiency 0，`stations: [{id:"station.workshop.carpenter",name:"木作台",workerSlots:1,kind:"craft",recipes:["recipe.wood_arrow","recipe.wooden_shield"]}]`
  - `construction.forge`：costs wood 8 + iron 12，duration 60，experience 30，requiredProficiency 1，`stations: [{id:"station.forge.anvil",name:"铁砧",workerSlots:1,kind:"forge",recipes:[]}, {id:"station.forge.repair",name:"修复台",workerSlots:1,kind:"repair",recipes:[]}]`
- `src/systems/ConstructionSystem.js` `_normalizeDefinition`：新增 `stations` 规范化 + 校验（D3），无 `stations` 时返回 `null`，其余字段不变

### Step 3 · `ProductionSystem`（1A）
新文件 `src/systems/ProductionSystem.js`：

```js
constructor({ inventoryTransactions, proficiencySystem, itemResolver,
  resolveStation, createCheckpoint, createEventId, onEvent, rng, maxOperations })
registerRecipes(recipes)            // 校验 id/station/inputs/outputs；重复 id 报错
getStationRecipes(stationId)        // → { recipes: [...] }（只读快照，供 UI）
previewStart({ characterId, inventory, stationId, recipeId, context })
start({ characterId, inventory, stationId, recipeId, operationId, context })
update(dt)                          // 到点 status='ready'，发 productionReady（不写产物）
commitOutput(jobId, transactionResult)  // 释放工位；发 production.completed
cancel(jobId, reason)               // 退料 + 释放工位；发 production.cancelled
retryRefund(jobId)
captureRuntime() / restoreRuntime(snapshot) / serialize() / deserialize()
```

**固定校验链**：工位可用（`resolveStation`）→ 配方存在且 `recipe.station === stationId` → 熟练度 → 材料+工钱预检 → `batchRemove` 预扣 → 锁工位。

**硬约束**：默认不 `add`（只有 `batchAdd` 由 `craft.production.*` 完成）；`operationId = production:<stationId>:<recipeId>:<seq>` + `_remember`；预扣失败不建 pending。

**1C 锻造分支**（Step 7）：`recipe.kind === 'forge'` 时 `quality.mode === 'roll'` 用注入 `rng` 掷品质倍率；`failure.mode ∈ {none, partial_refund, destroy_materials}`，`partial_refund` 返 50% 材料（铜钱不退）；种子与掷骰结果写入 pending 并进快照。

### Step 4 · 场景接线（1A）
- `src/core/scene/SceneGameplaySystemAssembler.js`
  - import `ProductionSystem`；构造参数对齐 construction（`inventoryTransactions / proficiencySystem / itemResolver / createCheckpoint / createEventId / onEvent / rng`），`registerRecipes(config.production.recipes)`
  - 注册 `{ name:'gameplay.production', instance: productionSystem, options:{ order: 506, updateHook: dt => productionSystem.update(dt), disposeHook: ..., ownership:'OWNED' } }`
  - `fields` 表加 `production: 'productionSystem'`；`sharedSystems`/`facade` 同步
- `example/sanguo_zhangjiao/systems/SanguoGameLoaderCoordinator.js`（:297 附近）
  - 新增 `production: { recipes: gameLoader.registries.recipes.all(), resolveStation: <扫 BuildingComponent 的建筑表>, createCheckpoint, createEventId, onEvent }`
- `example/sanguo_zhangjiao/systems/S01S02SceneFlow.js`
  - `_createRecipeSnapshot`：`LEGACY_WORKSTATIONS.has(workstationId)` → 原逻辑；否则 → `scene.productionSystem.getStationRecipes(workstationId)` 映射为 UI 快照（`enabled`/`disabledReason`/`materials`）
  - `openRecipeSelection`：不变（快照分派已在内部）
  - `handleRecipeCommand`：命中 legacy → 原 `_startRecipeAction`；否则 → `_startProductionAction`
  - 新增 `_startProductionAction` + `_updateProductionActionProgress`（进度表现复用 `RECIPE_ACTION_PROGRESS_OWNER` / `worldAction`）+ `_collectProduction`（`_submit('craft.production.<recipeId>')` → `commitOutput`）
  - `handleAction` 新增 `operation === 'openProductionStation'`（`params.stationId`）
- 公式：`production.onEvent('productionReady')` → 场景侧 `_collectProduction`

### Step 5 · S01 legacy 适配（1A 收尾）
- `RECIPE_ACTIONS` **一行不删**；新增常量 `LEGACY_WORKSTATIONS`
- `_startRecipeAction` / `_commitRecipeAction` / `_validateRecipeAction` 仅 legacy 可达
- 回归比对：烤肉/制皮/狼皮兑换的事件序列、耗时、产物数量与基线一致

### Step 6 · 装备修复（1B）
- 新文件 `src/systems/EquipmentRepairService.js`
  - `quote({ item, stationId })` → `{ materials: [...], copper, gapRatio }`；`repair({ characterId, inventory, itemInstanceId, stationId, operationId })`
  - 仅 `station.kind === 'repair'` 可用；缺口 0 → `repairNotNeeded`；材料/铜钱走 `batchRemove` + checkpoint 幂等
- `src/core/scene/SceneGameplaySystemAssembler.js:501`
  - `item.repair` 改为分流器：`payload.kind === 'equipment'` → `equipmentRepairService`；否则 → `toolRepairService`（其内部零改动）
- `src/systems/EquipmentSystem.js` + `EquipmentComponent.getBonusStats()`（D8）
- `src/systems/CombatSystem.js`：命中结算后 `perUse`、受击结算后 `perHit`（仅实例声明 `durability`）

### Step 7 · 锻造（1C）
- `ProductionSystem` 锻造分支 + 注入 `rng`（D12）
- 产物品质倍率在 `items[]` 模板 `stats` 上乘算，仍由 `craft.production.*` 提交

### Step 8 · 任务与触发器（跨段）
- `src/systems/quest/ObjectiveTypeRegistry.js`：新增 `craft.item`（`matcherType: 'production.completed'`，身份字段 `itemId`，`progressBy` 取现有合法值）
- 事件：`production.completed` / `production.failed` / `production.ready`（`item.repaired` 沿用 ToolRepairService）
- 一次性事实：`craft.first.<recipeId>` 走 `state.transaction`

---

## 5. 零回归论证

| 风险 | 防线 |
|---|---|
| S01 主线配方失效 | Step 5 白名单：命中旧工位才走旧路径；旧方法一行不改 |
| 工具修复被污染 | `ToolRepairService` 零改动；只在 handler 外层按 `payload.kind` 分流 |
| 老装备属性变化 | `durability` 未声明 → 不折损、不扣减 |
| 老兵种远程变化 | `ammo` 未声明 → 不扣弹、不拦截 |
| 旧建筑定义变化 | `stations` 缺省 `null`；其余字段规范化逐字不变 |
| 材料预扣与存档不一致 | pending 进 `gameplay.production` 快照；`commit` 失败 `retryRefund` |
| 品质随机不可复现 | 注入 `rng`，种子入快照，禁 `Math.random()` |
| 新 recipes 数据破坏 M0 用例 | 同步更新 M0 用例断言（Step 1） |

---

## 6. 验证方案

### 6.1 新增自动化测试
| 文件 | 覆盖 |
|---|---|
| `src/systems/ProductionSystem.test.js` | 预扣 / 材料不足 / 工钱不足 / 取消退料 / 幂等 / 工位占用 / 熟练度不足 / 站台不可用 / 快照往返 |
| `src/systems/ProductionSystem.forge.test.js` | 同种子同结果 / 失败三档返还 / 品质倍率 |
| `src/systems/EquipmentRepairService.test.js` | 报价公式 / 缺口 0 / 材料不足 / 非 repair 工位 / 修满后耐久回填 |
| `src/ecs/EquipmentDurability.test.js` | 耐久 0 → 加成 ×0.5；修复回满 → 恢复；未声明耐久零变化 |
| `src/systems/CombatAmmo.test.js` | 无 ammo 配置不扣；有 ammo 按 perShot 扣；无弹跳过远程；NPC 计数模式 |
| `src/core/M1Content.test.js` | `registries.recipes.size === 2`；`construction.workshop/forge.stations` 可读；`currency.copper` / `wooden_shield` 存在 |
| 更新 `src/core/M0Foundation.test.js` | recipes 空断言 → 非空 |

### 6.2 命令
```powershell
npx vitest run src/systems/ProductionSystem.test.js src/systems/ProductionSystem.forge.test.js src/systems/EquipmentRepairService.test.js src/ecs/EquipmentDurability.test.js src/systems/CombatAmmo.test.js src/core/M1Content.test.js src/core/M0Foundation.test.js
```

### 6.3 全量回归
```powershell
npx vitest run
```

### 6.4 手工冒烟（不改主线内容）
- 建造 `construction.workshop` → 站台 `station.workshop.carpenter` 可用 → `production.open` 快照 2 条配方 → 造木箭 ×10 → 中途取消（材料+铜钱退回）→ 再造（背包 +10）→ 切场景回来进度保留 → S01 烤肉仍正常 → 铁匠修复木盾耐久 30% → 修满

---

## 7. 提交边界

只纳入 M1 相关文件：`src/systems/ProductionSystem*`、`EquipmentRepairService*`、`ConstructionSystem.js`、`EquipmentSystem.js`、`EquipmentComponent.js`、`CombatSystem.js`、`SceneGameplaySystemAssembler.js`、`ObjectiveTypeRegistry.js`、`S01S02SceneFlow.js`、`SanguoGameLoaderCoordinator.js`、`game.project.json`、`library.json`、新增测试，以及 `M0Foundation.test.js`（Step 1 断言同步）。**不纳入**工作区其他进行中改动（`.tmp-*`、`scripts/tmp-*`、动画/裙装相关文件）。不擅自 commit。

---

## 8. 补丁记录 · 生产快照接线（2026-11-10）

T05 的"快照含 pending"此前只有 `serialize/deserialize` 实现，没有注册进场景快照链路（`createCheckpoint` 也是死字段）。本次补洞：

| 落点 | 改动 |
|---|---|
| `SceneGameplaySystemAssembler.js` | 新增导出 `createProductionSnapshotProvider(system, { resolveInventory })`；`configureSharedSystems` 末尾以 **`required:false`** 注册 `gameplay.production` |
| `ProductionSystem.js` | 开工 / 完成 / 取消退料三处状态变更后 `_requestCheckpoint(...)`（fire-and-forget，失败只告警不回滚已扣材料） |
| `S01S02SceneFlow.js` | `_adoptPendingProductionStation`：读档后把恢复的 pending 重新纳入本场景进度会话（否则工位永久 busy、成品无人领取） |

**读档边界（不重复扣料 / 不重复产出）**
1. `deserialize` 只重建 `pending`（工单进度、`reservedCosts/reservedItems` 凭证、`stationId` 占用）与 `operations` 账本，**不重放 `batchRemove`**——背包里的预扣结果已由存档携带。
2. 成品入库仍由场景 `craft.production.<recipeId>` 事务提交，成功后才 `commitOutput` 删 pending；同一工单第二次提交返回 `noPendingProduction`。
3. `operations` 随快照恢复，旧 `operationId` 重开会命中账本幂等（不二次扣料）。
4. 段缺失/不可用一律**降级跳过**（`required:false` + validate 容忍 + restore 告警跳过），旧档不被拒。

**已知窄窗口**：自动存档若恰好落在「场景事务已入库、`commitOutput` 尚未执行」之间，读档后该 ready 工单会被再领取一次。当前存档时机只由状态变更（开工/完成/退料）触发，正常路径不进入该窗口；如需彻底消除，应在 `InventoryTransactionService` 账本入档后由 `_collectProduction` 以幂等 `operationId` 重放（账本目前未入快照，另立条目）。


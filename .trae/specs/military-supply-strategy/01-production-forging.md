# 模块 1：生产与锻造（工坊 / 伐木制箭 / 铁匠修复 / 武器锻造）

> 状态：设计稿（三条已定稿 P16~P18，2026-11-09）· 2026-11-08
> 归属：[军需—配给—押运—军团体系总纲](spec.md) 模块 1
> 需求映射：工坊、伐木做弓箭、铁匠修复武器装备（第一轮）；武器与装备锻造（第四轮）

---

## 1. 结论先行

现有引擎已经具备**九成地基**：通用建造（材料/工具/熟练度/进度/维修/存档）、采集、配方选择 UI 与制作进度、工具耐久修复、装备品质枚举与属性汇总、原子库存事务。缺的是把它们**串成一条数据驱动的生产链**：

| 缺口 | 现状 | 本次设计 |
|------|------|----------|
| 配方未数据化 | 配方硬编码在 S01 场景流，仅 1 个工位 | 新增 `recipes` 数据表 + 工位（Station）模型 |
| 工坊/铁匠不是"建筑" | 只有 6 个营地防御建筑定义 | 建筑定义新增 `stations[]`，工坊/铁匠可建造 |
| 伐木制箭 | 有木材、有 `wooden_arrow` 物品，没有配方 | 工坊配方链：木材 → 箭矢/木盾 |
| 武器/装备修复 | 修复服务只认 `toolType` 工具，武器护甲会被拒 | 新增装备修复分支 + 铁匠工位门控 |
| 锻造品质/词条 | 强化系统有成功率/损毁，但基于 mock 数据、未接场景 | 锻造走配方 + 品质掷骰；词条作为 1C 可选层 |
| 生产熟练度 | `craftSkills: []` 空表 | 复用 ProficiencySystem 的 `craft` 技能 |

**推荐架构一句话**：`工位（Station） × 配方（Recipe） × 作业（Job）`，配方只描述"展示/校验/成本/时长/品质"，**真正的物品增减仍由 `commands.json` 的 `state.transaction` 提交**——这样天然满足"所有功能纳入任务与命令体系"。

---

## 2. 现有能力盘点（已有 / 部分 / 没有）

### 2.1 采集与资源

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 资源节点采集（砍树/采石/采矿） | **已有** | `src/systems/GatheringSystem.js:81-139`（开始）、`:208-282`（结算）、`:358-388`（工具耐久）；`src/data/schema/CanonicalSchemas.js:136-233` | 资源类型 wood/iron/food/herb/stone，节点存量、产量、时长、半径、工具要求齐全 |
| 资源物品定义 | **已有** | `example/.../project/library.json:4`（`resource.wood`） | 木材是普通物品，可入背包/可被抢 |
| 采集技能与熟练度 | **部分** | `ProficiencySystem`；`library.json` 的 `gatherSkills: []` 为空 | 冷却/加成配置未填 |

### 2.2 建造（含小庇护所）

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 通用建造系统 | **已有** | `src/systems/ConstructionSystem.js:41-280`（定义/校验/开工）、`:283-328`（进度与快照）、`:376-423`（完成） | 前置顺序固定：占位→熟练度→材料→工具→位置；失败不扣材料 |
| 建筑维修 | **已有** | `src/systems/ConstructionSystem.js:79-179` | 维修走 validate→draft→commit→checkpoint，失败回滚 |
| 建筑定义数据 | **已有** | `example/.../game.project.json:302-415`（`construction.definitions`）、`:418+`（`sites`） | 字段：costs/duration/requiredProficiency/requiredToolType/maxDurability/manned/warEffects |
| 建筑运行时组件 | **已有** | `src/ecs/components/BuildingComponent.js` | 耐久/损毁为运行时事实源，`ConstructionSystem.synchronizeStructure` 回写 |
| 建造入档 | **已有** | `src/core/scene/SceneGameplaySystemAssembler.js:507-511`、`:627`、`:651` | `gameplay.construction` 进场景快照 |
| 小庇护所（S01） | **已有** | 定义 `construction.s01.small_shelter`；`S01S02SceneFlow.startShelterConstruction`；触发器 `trg_s01_build_shelter` / `trg_s01_shelter_completed`（`triggers.json:477-523`） | 已是"任务步骤 → construction.command → 完成事件"的标准范式，可直接复用 |
| 可建造工坊/铁匠 | **没有** | — | 现有定义只有篝火/拒马/壁垒/箭楼/庇护所 |

### 2.3 配方制作（生产）

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 配方选择 UI | **已有** | `src/ui/RecipeSelectionView.js:23-235` | 列表/详情/材料行/禁用原因/制作按钮，输入命令 `selectRecipe` |
| 制作进度与打断 | **已有** | `S01S02SceneFlow.js:1696-1732`（开工）、`:1811-1840`（进度）、`:1681-1694`（中断） | 有进度条、工作台视觉、离场/受伤中断 |
| 配方数据 | **没有（硬编码）** | `S01S02SceneFlow.js:29-90`（`RECIPE_ACTIONS`）、`:1510-1590`（`_createRecipeSnapshot`） | 只支持 S01 烹饪架/晒皮架，加配方要改代码 |
| 产物入背包 | **已有** | `commands.json:684-705`（`craft.s01.wolfHideVest` 为 `state.transaction` + `batchExchange`）；`src/systems/InventoryTransactionService.js:51-253` | 原子增减、幂等 operationId、失败回滚 |
| 生产熟练度经验 | **部分** | 建造/采集有经验；制作链无 | 配方可声明 `experience` |

### 2.4 修复（铁匠）

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 工具耐久修复 | **已有** | `src/systems/ToolRepairService.js:38-125`；接线 `SceneGameplaySystemAssembler.js:486-511`；UI `InventoryPanel.js:1204-1205`、`:1311-1317`、`:1399`、`:1462-1463` | 修复到满耐久，消耗 `repairCosts` 材料，走 checkpoint 与状态版本；**但要求 `toolType`**（`:70`） |
| 装备（武器/护甲）修复 | **没有** | `ToolRepairService.js:70` 明确拒绝非工具 | 武器/护甲没有 `toolType`，点修复会 `itemNotRepairable` |
| 修复地点门控 | **没有** | 修复意图 `item.repair` 可在任何地方发起 | 没有"必须在铁匠处"的限制 |
| 装备耐久消耗 | **部分** | 少数物品有 `durability`（`library.json:899/941/983`）；`EquipmentSystem.update` 预留但空实现 | 武器攻击不扣耐久，装备不会坏 |

### 2.5 锻造（新材料 → 装备）

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 装备品质枚举 | **已有** | `src/data/EquipmentData.js:21-61` | 普通/不凡/稀有/史诗/传说 + 品质色 + 装备类型 |
| 装备属性汇总 | **已有** | `src/systems/EquipmentSystem.js:62-100`；`src/ecs/components/EquipmentComponent.js:193-194` | attack/defense/maxHp/maxMp/speed/elementAttack/elementDefense |
| 物品形态的装备 | **已有** | `library.json:1087-1118`（`weapon.wolf_fang`）、`:1120+`（`leather_armor`） | 走 `items[]`：`type: equipment` + `subType` + `stats` + `rarity` |
| 强化（成功/失败/损毁） | **部分** | `src/systems/EnhancementSystem.js:86-280`；`src/ui/EnhancementPanel.js` | 有材料加成、金币消耗、成功率、损毁；但依赖 `mockDataService`，仅测试页使用，**未接场景** |
| 词条（随机属性） | **没有** | — | 属性是模板静态值，无实例级词条 |
| 锻造配方/工位 | **没有** | — | — |

### 2.6 经济与货币

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 货币定义与商店 | **部分** | `src/ui/ShopPanel.js`（多币种图标/价格）；`ShopSystem.playerCurrencies` 有 capture/restore | `library.json` 的 `shops: []` 为空，**未接任何场景** |
| 玩家随身铜钱权威状态 | **没有** | — | 背包/属性里没有金币字段；修复/建造都不收钱 |
| 物品价值 | **部分** | `library.json` 物品有 `value`（EquipmentData 模板） | 只用于展示/折算，不参与交易 |

> 结论：**"花铜钱"这件事目前没有权威载体**。本设计建议把铜钱做成**背包里的货币物品**（见 §4.4），这样它天然可入档、可押运、可被抢、可被任务扣除。

---

## 3. 核心规则

### 3.1 生产链总览

```
采集（已有 GatheringSystem）
  ├─ 木材/铁矿/兽皮/草药 → 背包
  ↓
工坊（木作 / 制箭）
  ├─ 木材 → 箭矢 ×N、木盾、修复工具柄
  ↓
铁匠（修复 / 锻造）
  ├─ 修复：消耗材料 + 铜钱，恢复耐久（工具已有，装备新增）
  └─ 锻造：铁矿 + 木材 + 铜钱 → 装备（品质掷骰，词条可选）
  ↓
产出物 → 背包 / 主城仓库 → 配给与押运（模块 2）
```

### 3.2 三件套模型

| 概念 | 定义 | 载体 |
|---|---|---|
| **工位 Station** | 一个可交互的生产点（木作台/制箭台/铁匠炉/修理台） | 建筑定义的 `stations[]`，或场景 placement 显式绑定 |
| **配方 Recipe** | 工位上可执行的一条生产规则 | `library.json` 顶层 `recipes[]` |
| **作业 Job** | 玩家发起的一次生产运行（预扣材料 → 进度 → 提交） | 运行时 `ProductionSystem`（新增），入快照 |

**规则 1（唯一入口）**：作业只能从工位交互发起（`production.open` → 选择配方 → `production.start`），没有"远程凭空制作"。
**规则 2（原子性）**：作业开始时**预扣材料并锁定工位**；中断/失败/回滚必须原样退还。
**规则 3（提交走命令）**：作业完成时调用 `commands.json` 的 `craft.<recipeId>`（`state.transaction`）完成物品增减；`recipes` 表只做展示与前置校验，**不直接写库存**。
**规则 4（熟练度）**：配方可声明 `requiredProficiency: { skill: 'craft', level }`；经验写回 ProficiencySystem。
**规则 5（建筑前提）**：工坊/铁匠必须先建造完成（`BuildingComponent` 可用且耐久 > 0）才能使用工位；建筑损毁则工位不可用。
**规则 6（工人驻留）**：`manned: true` 的建筑需要至少 1 名工人驻留（复用现有 `manned` 语义），否则只能排队不能开工；工人来源在模块 2/3（配给/军团）接入，1A 阶段允许玩家本人驻留。

### 3.3 工坊：伐木做弓箭

| 配方（示例） | 输入 | 输出 | 时长 | 说明 |
|---|---|---|---|---|
| 木箭 ×10 | 木材 ×2 | `wooden_arrow` ×10 | 3s | 弓箭兵消耗品；**箭矢消耗已定稿（P16=是）** |
| 猎弓 | 木材 ×4 + 兽皮 ×1 | `weapon.hunting_bow` | 20s | 需要工坊 Lv1 |
| 木盾 | 木材 ×5 | `armor.wooden_shield` | 25s | 防御 +4 |
| 修复工具柄 | 木材 ×1 + 铜钱 ×5 | 目标工具恢复 20 耐久 | 5s | 与铁匠修复互补 |

### 3.4 铁匠：修复

**两条修复链，语义分开，互不覆盖**：

| 类型 | 服务 | 规则 |
|---|---|---|
| 工具（斧/镐/铲） | 现有 `ToolRepairService`（不动） | 一次修满，消耗 `repairCosts`，任意地点可用（后续可由任务/场景门控） |
| 武器 / 护甲 / 头盔 / 靴 / 手套 / 饰品 | 新增 `EquipmentRepairService` | 按耐久缺口计费：`材料 = ceil(缺口比例 × 配方材料)` + 铜钱；一次修满；**必须在铁匠工位**（命令带 `stationId`，系统校验工位存在且可用） |

- 装备耐久：新增 `durability` 到装备定义（可选），攻击/受击按 `perUse` 扣减；耐久为 0 时属性按 `brokenMultiplier`（默认 0.5）衰减，不直接消失。
- 修复失败：无失败率（修理是确定性服务）；只有"材料不足/工位不可用/耐久已满"三类拒绝。
- 修复与锻造分离：修复不改品质、不加词条；锻造才掷品质。

### 3.5 铁匠：锻造

**输入**：铁矿 + 木材（燃料/柄）+ 铜钱（工钱）；可选"助熔材料"提升成功率/品质权重。

**产出**：一件装备实例，带：
1. `rarity`（品质档：普通/不凡/稀有/史诗/传说）；
2. `stats` 基础属性（来自物品定义，按品质倍率放大）；
3. 可选 `affixes[]`（词条，1C 阶段）。

**品质模型（推荐最小版）**：

```
qualityRoll = clamp( base + materialBonus + proficiencyBonus + stationBonus , 0, 1 )
档位权重 = 配方 weights；qualityRoll 只做"权重偏移"，不直接决定档位
成功 = qualityRoll >= failThreshold（默认 0.15 则失败）
失败 → 返还 refundRatio（默认 0.5）材料，铜钱不退，装备不出
```

**失败与损耗（三档可配）**：

| 档位 | 行为 | 适用 |
|---|---|---|
| `none` | 不失败（普通装备/箭矢） | 量产消耗品 |
| `partial_refund` | 失败返还 50% 材料，铜钱不退 | 铁制武器/护甲（推荐默认） |
| `destroy_materials` | 材料全损（高风险高回报） | 稀有/传说配方，需策划显式开启 |

**词条系统（1C，可选）**：

- 新增 `affixes[]` 数据表：`{ id, name, tier[], stats, tags[] }`；
- 装备定义新增 `forge.affixPool`；
- 锻造时按品质决定词条数量：普通 0、不凡 1、稀有 2、史诗 3、传说 3+1 专属；
- 实例结构：`item.affixes = [{ affixId, tier }]`，属性汇总在 `EquipmentComponent.getBonusStats()` 时叠加（**只改汇总，不改模板**）。

### 3.6 与铜钱经济的关系

| 环节 | 收费方式 | 建议 |
|---|---|---|
| 建造 | 材料（现有）+ 可选铜钱工钱 | 1A 不收钱，1B 起收 |
| 生产 | 多数不收；锻造/修理收工钱 | 工钱 = 配方 `wage` |
| 修复 | 按耐久缺口收材料 + 铜钱 | 铜钱 = 缺口比例 × 基准价 |
| 锻造 | 材料 + 工钱，失败不退工钱 | 工钱是主要回收口 |
| 招募军团 | 铜钱（模块 3） | 与生产共用货币物品 |

**铜钱载体建议**：`currency.copper` 物品（`type: 'currency'`，`maxStack: 9999`），理由：
1. 天然入档（背包已入档）；
2. 可被押运、可被抢（模块 2 的"押运途中被抢"直接生效）；
3. 任务可用 `gather.item` 目标统计、`state.transaction` 扣除；
4. 不需要新造一套货币状态机。

> 备选：复用 `ShopSystem.playerCurrencies` 并提升为全局状态。代价是要新增存档白名单与 UI 绑定；不如货币物品直接。

---

## 4. 状态机

### 4.1 生产作业（ProductionJob）

```
IDLE
 └─(玩家在工位选择配方)→ VALIDATE
        ├─ 失败：材料不足/熟练度不足/工位占用/建筑损毁 → IDLE（提示原因）
        └─ 通过 → RESERVED（预扣材料 + 锁工位 + 记 operationId）
                    ↓
                 IN_PROGRESS（elapsed += dt；进度条 + 工作台表现）
                    ├─ 玩家离开半径/受伤/场景切换/建筑损毁 → INTERRUPTED（退材料→IDLE）
                    ├─ 玩家取消 → CANCELLED（退材料→IDLE）
                    └─ elapsed ≥ duration → COMMITTING
                                            ├─ state.transaction 成功 → COMMITTED（发物品/经验/事件）→ IDLE
                                            └─ 提交失败 → ROLLBACK（退材料）→ IDLE
```

**幂等**：`operationId = production:<stationId>:<recipeId>:<seq>`；同一 operationId 重复提交返回同一结果（沿用 ConstructionSystem 的 `_remember` 模式）。

### 4.2 锻造作业（ForgeJob，继承 Job）

```
RESERVED → FORGING → ROLL
                       ├─ 成功 → 生成实例（品质/词条）→ COMMITTED
                       └─ 失败 → FAILED（按 failure.mode 返还）→ IDLE
```

### 4.3 装备修复

```
INSPECT → QUOTE（算材料+铜钱）
   ├─ 拒绝：材料/铜钱不足、工位不可用、耐久已满
   └─ 通过 → PAY（锁定材料与铜钱）→ REPAIRING（可选时长）→ REPAIRED（耐久回满）
                                                    ├─ 取消 → REFUND
                                                    └─ checkpoint 失败 → ROLLBACK
```

### 4.4 工位可用性

```
未建造 → 建造中 → 可用 ⇄ 被占用（有人作业）
                    ├─ 建筑耐久 = 0 → 损毁（不可用，需修复）
                    └─ manned 且无工人 → 待工（可排队，不可开工）
```

---

## 5. 数据落点

### 5.1 配方表（`library.json` 顶层新键 `recipes`）

```jsonc
{
  "id": "recipe.wood_arrow",
  "name": "木箭 ×10",
  "description": "削木为杆，装羽为箭。",
  "station": "station.workshop.carpenter",   // 工位类型 id
  "inputs": [{ "itemId": "resource.wood", "quantity": 2 }],
  "outputs": [{ "itemId": "wooden_arrow", "quantity": 10 }],
  "duration": 3,
  "experience": 2,
  "requiredProficiency": { "skill": "craft", "level": 0 },
  "wage": { "itemId": "currency.copper", "quantity": 0 },
  "kind": "production",                       // production | forge | repair
  "quality": { "mode": "fixed", "level": 0 }, // fixed | roll
  "failure": { "mode": "none" }
}
```

锻造示例：

```jsonc
{
  "id": "recipe.iron_sword",
  "name": "铁剑",
  "station": "station.forge.anvil",
  "inputs": [
    { "itemId": "resource.iron", "quantity": 4 },
    { "itemId": "resource.wood", "quantity": 1 }
  ],
  "outputs": [{ "itemId": "weapon.iron_sword", "quantity": 1 }],
  "duration": 20,
  "experience": 10,
  "requiredProficiency": { "skill": "craft", "level": 1 },
  "wage": { "itemId": "currency.copper", "quantity": 30 },
  "kind": "forge",
  "quality": {
    "mode": "roll",
    "weights": { "common": 60, "uncommon": 30, "rare": 10 },
    "materialBonus": 0.05,
    "proficiencyBonusPerLevel": 0.03
  },
  "failure": { "mode": "partial_refund", "refundRatio": 0.5 }
}
```

### 5.2 建筑与工位（`game.project.json.construction.definitions[]` 扩展）

```jsonc
{
  "id": "construction.workshop",
  "name": "木作工坊",
  "costs": [{ "itemId": "resource.wood", "quantity": 20 }],
  "duration": 60,
  "requiredProficiency": 0,
  "requiredToolType": "axe",
  "manned": true,
  "maxDurability": 240,
  "imageId": "s02.construction.workshop",
  "stations": [
    { "id": "station.workshop.carpenter", "name": "木作台", "workerSlots": 1,
      "recipes": ["recipe.wood_arrow", "recipe.hunting_bow", "recipe.wooden_shield"] }
  ],
  "warEffects": { "friendlyDefenseMultiplier": 1.05 }
}
```

铁匠同理：`construction.forge` + `stations: [{ id: 'station.forge.anvil', recipes: [...] }, { id: 'station.forge.repair', ... }]`。

### 5.3 装备定义扩展（`library.json.items[]`）

```jsonc
{
  "id": "weapon.iron_sword",
  "type": "equipment",
  "subType": "weapon",
  "rarity": 2,
  "stats": { "attack": 12 },
  "durability": { "max": 60, "perUse": 0.02, "brokenMultiplier": 0.5 },
  "forge": { "affixPool": ["affix.attack", "affix.crit"], "qualityMultipliers": { "0": 1, "1": 1.15, "2": 1.3 } }
}
```

词条表（1C）：

```jsonc
"affixes": [
  { "id": "affix.attack", "name": "锋锐", "tier": [2, 4, 6], "stats": { "attack": 3 }, "tags": ["weapon"] }
]
```

### 5.4 运行时与存档

| 数据 | 落点 | 说明 |
|---|---|---|
| 进行中的作业队列 | 新增 `ProductionSystem`（`src/systems/ProductionSystem.js`） | 参考 `ConstructionSystem` 的 `pending/operations/captureRuntime/restoreRuntime` |
| 作业入场景快照 | `SceneGameplaySystemAssembler` 注册 `gameplay.production` | 与 `gameplay.construction`（`:507-511`、`:627`、`:651`）同款 |
| 建筑耐久/工位可用 | `BuildingComponent` + `ConstructionSystem.synchronizeStructure` | 已有 |
| 材料/产物/铜钱 | `InventoryComponent` + `InventoryTransactionService` | 已有 |
| 熟练度经验 | `ProficiencySystem`（skill=`craft`） | 已有 |
| 一次性事实（首件、解锁、交付） | `commands.json` 的 `story.*` / `craft.*` | 已有范式 |

### 5.5 编辑器

| 编辑器 | 改动 | 说明 |
|---|---|---|
| 内容库 `LibraryEditor` | 新增「配方」类别（`recipes`）；表单：工位/输入/输出/时长/熟练度/工钱/品质/失败 | `LibraryEditor.js:32-116` 已有 `buildings/craftSkills/gatherSkills` 分类可参照 |
| 项目配置 | 建筑定义新增「工作站」区块（工位 id/名称/配方列表/工位数） | 目前 `construction.definitions` 无编辑器表单，建议顺带补最小表单 |
| 场景编辑器 | placement 绑定工位（`stationId`）或由建筑实体自动提供 | 参考 S01 烹饪架：`placementId` + `workstationId` |
| 内容库「物品」 | 装备新增「耐久 / 锻造」子块 | 现有"专属属性(JSON)"域可先承接 |

---

## 6. 与任务 / 触发器 / 命令体系的接法

### 6.1 命令清单（新增，挂 `SanguoDomainCommandFacade` 的 `scenario.command` 命名空间）

| operation | payload | 语义 |
|---|---|---|
| `production.open` | `{ stationId }` | 打开工位配方面板（只读快照） |
| `production.start` | `{ stationId, recipeId }` | 开工（预扣材料/锁工位） |
| `production.cancel` | `{ jobId }` | 取消并退料 |
| `production.collect` | `{ jobId }` | 领取产物（若采用"先完成后领取"） |
| `repair.equipment` | `{ itemInstanceId, stationId }` | 装备修复报价/执行 |
| `forge.quote` | `{ recipeId, stationId }` | 锻造报价 |
| `forge.start` | `{ recipeId, stationId }` | 锻造开工 |

> 注意：这些是**场景协调层**入口；真正的库存提交仍是 `state.transaction` 命令（`craft.<recipeId>`）。协调层只负责校验工位/进度/表现。

### 6.2 现有命令的直接复用

- 产物提交：`commands.json` 新增 `craft.<recipeId>`（`commandType: "state.transaction"`，`inventory.type: "batchExchange"`），范式见 `commands.json:684-705`。
- 建造工坊/铁匠：沿用 `construction.command` + `construction.start.<scene>`（`SanguoDomainCommandFacade.js:73-75`）。
- 修复工具：沿用 `item.repair`（`SceneGameplaySystemAssembler.js:498`）。

### 6.3 触发器

| when.type | 参数 | 用途 |
|---|---|---|
| `construction.constructionCompleted` | `{ siteId, definitionId }` | 工坊/铁匠建成（范式：`triggers.json:516-523`） |
| `production.completed` | `{ stationId, recipeId, outputs }` | 首次生产完成、教学推进、解锁下一配方 |
| `production.failed` | `{ recipeId, reason }` | 提示/挫败反馈 |
| `item.repaired` | `{ itemId, definitionId }` | 修复完成（`ToolRepairService` 已发 `item.repaired`，装备修复沿用同名事件） |
| `state.transaction` | 事实 id | 首件制作事实（`story.*`），用于任务链 |

### 6.4 任务目标类型

| 目标 | 方案 |
|---|---|
| 采集材料 | 已有 `gather.item`（`ObjectiveTypeRegistry.js:37-99`） |
| 制作 N 件 | **新增 `craft.item`**：`{ objectiveType:'craft.item', target:'wooden_arrow', requiredCount:20 }`，由 `production.completed` 事件驱动 |
| 修复装备 | 新增 `repair.item` 或在 1A 用 `custom.event` 过渡 |
| 交付物资 | 复用 `commit.fact` + `state.transaction`（模块 2 领取/押运会用） |

> 若不想动内核：1A 可先用 `custom.event` 目标，事件名 `craft.item`；1B 再落成正式 Objective 类型，任务编辑器可读性更好。

### 6.5 反例（禁止）

- ❌ 在 `RecipeSelectionView` 里直接扣材料/加物品；
- ❌ 在场景 Flow 里写 `if (recipeId === 'xxx')` 分支（现有 S01 的写法在 1A 必须先抽成数据表）；
- ❌ 用 `Math.random()` 直接决定品质（必须走注入的 RNG，便于回放/存档复现）。

---

## 7. UI 入口

| 入口 | 形态 | 说明 |
|---|---|---|
| 工位交互 | 靠近工位出现交互提示（E/手柄 A/触屏点按） | 复用现有交互提示与 `RecipeSelectionView` |
| 生产面板 | `RecipeSelectionView` 升级：顶部分类页签「制箭 / 木作 / 锻造 / 修复」；左侧配方列表；右侧材料与产物预览；底部「开始制作」 | 现有组件已具备列表/材料/禁用原因，改造成本低 |
| 进度表现 | 复用 S01 的制作进度条 + 工作台动图 | `S01S02SceneFlow` 的 recipe progress 已有 |
| 铁匠修复 | 「修复」页：装备列表（耐久条）→ 选中 → 报价（材料+铜钱）→ 确认 | 新材料/铜钱不足时置灰并给原因 |
| 建筑 HUD | 选中工坊/铁匠时显示：耐久、工位数、当前作业、预计完成 | 可选，1B 起 |
| 背包 | 装备详情显示耐久与「前往铁匠修复」引导 | 现有 `InventoryPanel` 的修复按钮分流：工具→原地修，装备→引导到铁匠 |

**三端一致**：PC 左键点选 + E 交互；手柄 A 确认 / B 返回 / 十字键切页签；触屏点按 + 底部按钮。输入提示文案进 `InputHints`。

---

## 8. 本模块分级交付（供阶段划分引用）

| 级别 | 内容 | 最小可玩验收 | 依赖 |
|---|---|---|---|
| **1A 数据化底座** | `recipes` 表 + 生产系统 + 工坊建筑 + 2 条配方（木箭、木盾）；S01 旧配方改为读表（行为不变） | 建造工坊→靠近→选「木箭」→进度→背包 +10 箭；材料不足时禁用并给原因；中断退料 | 建造系统（已有） |
| **1B 铁匠** | 铁匠建筑 + 装备修复（新服务）+ 工位门控 + 铜钱物品 | 武器耐久掉到 30% → 铁匠处报价 → 扣材料与铜钱 → 修满；非铁匠处点修复被拒并给提示 | 1A、货币物品 |
| **1C 锻造** | 锻造配方 + 品质掷骰 + 失败返还 + 可选词条 | 造铁剑 3 次：至少 1 次成功、1 次失败返料；品质分布符合权重；失败不退铜钱 | 1B、RNG 注入 |
| **1D 工人与队列** | `manned` 工人驻留、多工位并行、排队、离线推进 | 无工人时排队；派 1 工人后开工；切场景再回来进度保留 | 模块 2/3（工人来源） |

---

## 9. 开放问题（需策划拍板）

> 前 3 条已于 2026-11-09 拍板定稿（落 [decisions.md](decisions.md) P16~P18，实施级设计见 [m1-foundation.md](m1-foundation.md) §7.1），第 4~10 条按推荐值待排期。

1. ~~**工坊/铁匠是"可建造建筑"还是"场景固定设施"？**~~ → **定稿：可建造建筑**（P18 = 是；即 decisions P9）。
2. ~~**箭矢是否作为消耗品？**~~ → **定稿：是**（P16；`ammoPerShot` 默认 1，仅物品声明 `ammo` 时生效）。
3. ~~**装备是否引入耐久消耗？**~~ → **定稿：是**（P17；耐久 0 属性 ×0.5 不销毁，铁匠可修）。
4. **锻造是否引入随机词条？** 1C 可选。若不要词条，只做品质倍率，工作量减半。
5. **锻造失败损耗档位？** 推荐默认 `partial_refund`（返 50% 材料、不退工钱）；是否需要"材料全损"的高风险配方？
6. **铜钱用"货币物品"还是"全局货币状态"？** 本设计推荐物品（可押运、可被抢），需确认是否接受"铜钱占背包格"。
7. **生产是否要工人？** `manned` 语义复用；若 1A 允许玩家本人充当工人，则工人系统可后置。
8. **生产是否受城池 damage 影响？** 建造已有 `cityDamageRatio` 先例；工坊是否在城池被打后降效/停产？
9. **配方熟练度门槛多高？** `craft` 技能等级 0/1/2 分别解锁哪些配方，需要一张策划表。
10. **工坊/铁匠是否区分等级（Lv1/Lv2）？** 若区分，配方解锁按建筑等级而非角色熟练度，二者取其一，避免双门槛。

---

## 10. 零回归与风险

| 风险 | 处置 |
|---|---|
| 改 S01 配方导致主线卡死 | 1A 先做"读表适配器"：`RECIPE_ACTIONS` 原样保留为 legacy provider，新 `ProductionSystem` 只在工坊启用；主线回归用例全跑 |
| `ToolRepairService` 语义被污染 | 不改其现有校验；装备修复独立服务，复用 `item.repair` 命令类型但按 `payload.kind` 分流 |
| 材料预扣与存档不一致 | 作业 `captureRuntime/restoreRuntime` 入快照；checkpoint 失败必须退料（照抄 ConstructionSystem 的回滚事务） |
| 品质随机不可复现 | 注入 RNG（参考 `EquipmentSystem` 的 `rng` 注入与 `EnhancedSystem` 的 `rng` 参数），种子入存档 |
| 货币物品破坏既有背包逻辑 | `type: 'currency'` 单独归类，不参与装备槽；`maxStack` 大；UI 货币栏单独读 |
| 与性能线冲突 | 本模块仅新增 System 与数据表，不改场景热路径；生产更新在 1A 用低频 tick（0.25s）即可 |

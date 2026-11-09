# 模块 7：城镇与内政（最小闭环 / 物资共享 / 招募成本 / 攻击与输送入口）

> 状态：设计稿 · 2026-11-08
> 归属：[军需—配给—押运—军团体系总纲](spec.md) 模块 7
> 需求映射：「城镇与内政（主城配给来源、兵源与税收、征召、百姓忠诚）」+「攻击/输送两个选项的入口」（第二、六轮）

---

## 1. 现状盘点（实证）

| 能力 | 状态 | 实证 |
|---|---|---|
| 城池数据 | **已有** | `CITY_SCHEMA`（`CanonicalSchemas.js:367-395`）：`id/name/factionId/buildingLevel/resources{INTEGER map}/damageRatio/buildingDamage/morale/damagePausedUntilDay` |
| 城池初始数据 | **已有** | `game.project.json` `variables.cityStates`（`:501-620`） |
| 战后城池结算 | **部分** | `CityWarSystem.prepareDraft(state, result, context)`（`:27`）：从战斗结果生成"城池草稿"（资源转移/伤亡/损毁），其余只有 serialize/deserialize |
| 日推进 | **已有** | `TimeSystem.advanceDays(days)`（`:106`）/ `getCurrentDay()`（`:95`） |
| 建筑 | **已有** | `ConstructionSystem` + `construction.definitions/sites`；`buildingDamage` 字段在 CITY_SCHEMA 中已存在 |
| 货币 | **半有** | `ShopSystem.playerCurrencies`（`:296`）——**未接场景**，无城池侧载体 |
| 招募 | **没有** | 无 `recruitCost` / 兵源池 / 人口字段 |
| 产出/税收 | **没有** | 无任何按日产出逻辑（grep `taxRate`/`production` 无命中） |
| 忠诚/民心 | **半有** | `CITY_SCHEMA.morale`（非负整数）已存在，但无任何写入方（除战后结算） |
| 城池 UI | **只读** | `WorldMapPanel` 城池旗（阵营色）+ 城池卡无（仅地图标记） |

**结论：数据骨架齐、驱动逻辑全无**。城池目前是"战利品容器 + 地图色块"。

---

## 2. 最小闭环：四选三（忠诚折进民心）

需求给了四个候选：**产出 / 税收 / 兵源 / 忠诚**。最小闭环只做必要的，判断标准是"缺了它闭环断不断"：

| 候选 | 要不要 | 理由 |
|---|---|---|
| **产出** | **要** | 它是资源闭环的源头（模块 1 生产、模块 2 配给的上游）。没有它，所有物资只能靠打怪掉落 |
| **税收** | **要（并入产出）** | 铜钱是招募的唯一硬成本（模块 3）。但**不单做一套税率系统**——税收就是产出表里的一行 `coin` |
| **兵源** | **要** | 兵源是"资源 → 军团"的转换阀门，缺了它招募无上限，军团无限扩充 |
| **忠诚** | **不做独立系统** | 复用已有 `morale`（民心）字段，做"产出/兵源的乘数"。不新增 `loyalty` 概念、不做忠诚事件链 |

**最小闭环一句话**：

```
建筑产出（资源 + 铜钱）→ 入城池共享池
        ↓（民心乘数）
     可招募名额（人口）
        ↓（消耗池内 铜钱 + 食物 + 名额）
      军团兵员（模块 3）
        ↓（战斗消耗 / 战败）
     民心下降 → 产出与兵源下降
```

**四步都在"日推进"里一次算完**，没有实时 tick，没有逐建筑模拟。

---

## 3. 数据模型

### 3.1 城池状态扩展（`cityStates[]`，**不加新 schema 字段**）

`CITY_SCHEMA.resources` 是 `INTEGER map`，**`coin` 直接作为一个资源键**，铜钱不需要新字段：

```jsonc
{
  "id": "city.s11_guangzong",
  "name": "广宗",
  "factionId": "yellow_turban",
  "buildingLevel": 2,
  "resources": { "food": 320, "herb": 64, "iron": 40, "wood": 90, "coin": 210 },
  "morale": 62,                                   // 民心：产出与兵源乘数
  "damageRatio": 0.1,
  "buildingDamage": { "granary": 0.3 },
  "damagePausedUntilDay": 0,
  "population": {                                  // 新增（CITY_SCHEMA 加可选块）
    "total": 4200,
    "recruitable": 60,                             // 当日可招募名额
    "recoverPerDay": 8                             // 每日恢复
  },
  "production": {                                  // 新增：当日产出快照（次日重算）
    "food": 18, "wood": 6, "iron": 3, "herb": 4, "coin": 9
  }
}
```

> `population` / `production` 是**可选块**，缺失时按 `buildingLevel` 与 `morale` 走默认公式 → 既有城池数据零改动。

### 3.2 产出公式（唯一实现处）

```
产出 = Σ(建筑 baseProduction × (1 - buildingDamage[建筑])) × 民心乘数 × 等级乘数
民心乘数 = clamp(0.5 + morale/100, 0.5, 1.5)
等级乘数 = 1 + (buildingLevel - 1) × 0.2
铜钱产出 = 人口基数 × 0.02 × 民心乘数
可招募名额 = floor(population.total / 100 × 民心乘数 / 10) + recoverPerDay
```

- 建筑产出查 `construction.definitions[].production`（新增可选块，与 `warEffects` 并列）。
- **不做的**：不做税率滑块、不做民心事件概率表、不做饥荒事件链/流民潮自动触发（粮仓见底只作为民心输入项，见 §3.3 第三行）。

### 3.3 民心变化来源（五个，含 M9 P13 拍板项）

| 来源 | 变化 |
|---|---|
| 战败 | −12（`CityWarSystem` 已算->这里只补民心项） |
| 城池被围 | 每日 −3（`damagePausedUntilDay > 0`） |
| **粮仓饥荒（M9 P13 定稿）** | 池内 `food` < 城内人口 3 日量时，按缺口线性给 **−1 ~ −4 / 日**（`logistics.famineMoralePenalty` + `famineThresholdDays`），并入日结 ②；发 `city.famine` |
| 打赢守城战 | +8 |
| 主动赈济（消耗 `food`） | +5（每日上限 1 次） |

> P13 只**读**城池粮仓给民心一个衰减项，不反向影响产出（避免"高税→民心降→产出降"再叠一层双负反馈）。

---

## 4. 日推进流水线（顺序不可交换）

```
TimeSystem.advanceDays(1) → 触发 AdvanceDayPipeline（新，纯顺序执行）
  ① 建筑产出结算        → cityStates.resources += production
  ② 民心结算            → 按 §3.3 五源计算（含 P13 粮仓饥荒项）
  ③ 兵源恢复            → population.recruitable = min(cap, recruitable + recoverPerDay)
  ④ 军团补给消耗        → 扣 food（模块 3 ArmyState.supply），不足则士气 −10（模块 4 §3.3）
  ⑤ 建造/押运进度推进    → 委托 ConstructionSystem / ConvoyService（模块 1/2）
  ⑥ 发事件              → `city.productionSettled` / `city.moraleChanged` / `city.recruitPoolUpdated`
```

- **纯函数式**：`AdvanceDayPipeline.settle(cityStates, {day})` 返回新状态 + 变更清单；写回走 `state.transaction`（`CanonicalStateTransactionService`），**不在系统内直接改黑板**。
- **幂等**：以 `settledDay` 标记，重复 advance 同一天不重复结算（防读档重放双计）。
- **只在"有城池的势力"上跑**：中立/无主城池跳过。

---

## 5. 与主城物资共享的打通（模块 2 的单一池）

**唯一事实源**：`cityStates[cityId].resources` 就是模块 2 说的"共享池"。不新增第二套库存。

| 场景 | 数据流 |
|---|---|
| 城池建筑产出 | 直接 `+=` 到 `cityStates.resources`（§4 ①） |
| 玩家在城内领取 | 走模块 2 的**领用单**（额度校验）→ `InventoryTransactionService.batchExchange` 从"城池容器"搬到玩家背包 |
| 押运队装货（输送） | 从 `cityStates.resources` 扣 → 写入 `CargoComponent`（模块 2） |
| 押运抵达目的地 | `CargoComponent` → 目的地 `cityStates.resources`（或寨仓） |
| 玩家个人背包 | **不入池**（模块 2 已裁定：寨仓 ≠ 背包） |

- 城池库存作为容器注册进 `SceneContainerInventoryRegistry`（模块 2 已定），容器 id = `city:<cityId>`，这样 `CargoTransferView`（已有转运 UI）可以直接复用"城池 ⇄ 马车"的界面，**不需要新 UI**。
- 铜钱同理：`city.resources.coin` 是城池金库；`ShopSystem.playerCurrencies` 若接入，**读同一个键**，不再维护两份。

---

## 6. 招募成本怎么打通

`army.recruit`（模块 3）的成本校验，按"在哪招"分三条路径，**共用同一个成本表和同一个提交出口**：

| 招募地点 | 兵源名额 | 铜钱 | 食物 | 提交出口 |
|---|---|---|---|---|
| **城内**（`cityId` 有效） | 扣 `city.population.recruitable` | 扣 `city.resources.coin` | 扣 `city.resources.food` | `state.transaction` + `batchExchange`（城池容器） |
| **野外营地**（有寨仓） | 扣 `camp.recruitable` | 扣寨仓 `coin` | 扣寨仓 `food` | 同上（寨仓容器） |
| **流浪招募**（无据点） | 不扣（上限 = 队伍空位） | 扣玩家背包 `coin` | 扣玩家背包 `food` | `batchExchange`（玩家背包容器） |

成本表（数据驱动，`game.project.json.recruitCost`）：

```jsonc
"recruitCost": {
  "perSoldier": { "coin": 8, "food": 2, "recruitable": 1 },
  "byUnitType": {                        // 兵种差异（覆盖 perSoldier）
    "light_cavalry": { "coin": 20, "food": 4 },
    "heavy_cavalry": { "coin": 32, "food": 6, "iron": 2 },
    "archer":        { "coin": 12, "food": 2, "wood": 1 }
  },
  "batchMax": 20,
  "requiresFormedArmy": false             // 是否必须已有军团编制
}
```

- **校验与扣减原子**：先全量校验（名额/资源/上限），再一次性 `batchExchange`，失败回滚 —— 复用模块 2 的幂等 `operationId`。
- **和模块 3 军团队列的关系**：招募产出的是"兵员数"（`ArmyState.roster`），不是实体。实体在进入场景时才展开——这样城内招 50 人不用刷 50 个实体。

### 6.1 `army.recruit` 的 `fromCampId` 来源规则（S02 无城池，必须有营地路径）

`army.recruit` 的 payload 增加**可选** `fromCampId`，用于明确"在哪座营地招"。解析顺序固定：

```
① 显式 fromCampId（触发器 / 任务给定，S02 即此路径）
      → 必须命中本场景已注册的营地，否则**报错拒绝**（不静默降级到流浪招募）
② 省略 fromCampId
      → 取军团当前所在场景中**距离最近**的己方营地（等距时取最新 `laidAt`）
③ 该场景无己方营地
      → 流浪招募（玩家背包扣 coin/food，名额上限 = 队伍空位）
```

**营地注册（`fromCampId` 的唯一权威来源）**

| 项 | 规则 |
|---|---|
| 注册时机 | `armyCampLaid`（扎营落成，沿用既有事件）由 `SanguoPlacementCoordinator` 写入 `blackboard.camps[campId]` |
| 注册字段 | `{ campId, sceneId, x, y, laidAt, storageContainerId, recruitable }`——`campId` 由任务/placement 指定（S02 = `S02-camp`），不随机生成 |
| 名额初值 | `recruitCost.campRecruitableBase`（默认 **20**） |
| 每日恢复 | `recruitCost.campRecruitablePerDay`（默认 **10**），与城池 `recoverPerDay` 同款每日结算 |
| 扣费容器 | 寨仓容器（`storageContainerId`，模块 2 的 `SceneContainerInventoryRegistry`），**不是玩家背包** |
| 场景约束 | 默认**必须同场景**（军团在哪个场景就在哪个场景招）；跨场景招募需军团先移动到该营地（模块 4 行军） |
| 营地消亡 | 营地被摧毁/废弃 → 从 `blackboard.camps` 移除；该 campId 的 `fromCampId` 请求随后一律拒绝（不自动回退） |

**S02 映射**：序章无城池 → `campComplete` 立营后注册 `campId: "S02-camp"`；招募触发器发
`army.recruit { fromCampId: "S02-camp", unitType: <默认步兵>, count: <全部教徒> }`（一次成军，见 [10 文档](10-s02-quest-rework.md) §1.1 #5）。**城内路径不需要出现在 S02 的任何配置里。**

---

## 7. 「攻击 / 输送」两个选项的入口形态

需求里只说两个动词。**收敛成两个按钮，不做第三套 UI**：

```
大地图点城池旗
  → 城池卡（新 CityPanel，从 WorldMapPanel 弹出）
      ├─ 摘要：势力 / 等级 / 资源 / 民心 / 驻军 / 可招募
      ├─ 【攻击】→ 目标选择器（敌城 / 敌军军团 / 地图点）→ 确认
      ├─ 【输送】→ 目的地选择器（友城 / 军团 / 寨仓）+ 资源勾选与数量 → 确认
      └─ 【招募】【赈济】等次要按钮收进"更多"折叠区
```

| 按钮 | 内部命令 | 落点 |
|---|---|---|
| **攻击** | `city.orderAttack { cityId, target }` | 若驻军已编成为武装单位 → `unit.order { order:'attack', target }`（模块 4 v2）；若无军团但有人口 → 先走 `army.form` 再下令（弹确认） |
| **输送** | `city.orderTransport { cityId, target, items }` | 生成押运队 `convoy.assemble`（模块 2）→ 分配 `ArmyState` 护卫或纯马车（低风险短途） |

- **与模块 4 `city.setObjective` 的关系**：`setObjective` 是**内部状态**，由这两个按钮写入，**不单独暴露给玩家**。避免玩家看到"设置意图"和"攻击/输送"两个说法。
- **三端一致**：PC 左键点按钮；手柄 A + 方向选目标；触屏点选。不设快捷图标层（沿用 army-command-design §11.1 裁定：安卓走面板点选）。
- **防御方向**：攻击时可选"从哪个方向进攻"（影响隘口/地势加成，模块 5）；行军路线由通路自动计算（模块 4 v2 §3.2），玩家不画路线。

---

## 8. 状态机

### 8.1 城池

```
NORMAL（正常）
  →(敌军进入警戒圈) UNDER_SIEGE（被围：断粮计日、民心 −3/日、禁输送出城）
  →(守城胜) NORMAL（民心 +8）
  →(守城败) OCCUPIED（易主：factionId 变、资源按战果转移、民心 −12、建筑 damageRatio 上升）
OCCUPIED →(反攻成功) NORMAL
```

### 8.2 内政日结

```
IDLE → SETTLING（①产出 ②民心 ③兵源 ④补给 ⑤进度）→ SETTLED（发事件）→ IDLE
任一步失败 → SETTLE_FAILED（不中断其他城池；记录 code，下日重试）
```

---

## 9. 命令 / 事件 / 触发器 / 目标

### 9.1 命令

| operation | payload | 语义 |
|---|---|---|
| `city.recruit` | `{ cityId, unitType, count }` | 招募（校验名额/成本/上限） |
| `city.settle` | `{ cityId }` | 手动触发一次日结（调试/剧情用，幂等） |
| `city.relief` | `{ cityId }` | 赈济（扣 food +5 民心，日限 1） |
| `city.orderAttack` | `{ cityId, target }` | 攻击（写 objective + 派军） |
| `city.orderTransport` | `{ cityId, target, items }` | 输送（生成押运队） |
| `city.transfer` | `{ fromCityId, toCityId, resources }` | 直接调拨（无押运，剧情用） |
| `city.setFaction` | `{ cityId, factionId }` | 易主（战役结算用） |

### 9.2 事件

`city.productionSettled` / `city.moraleChanged` / `city.recruitPoolUpdated` / `city.recruited` / `city.siegeStarted` / `city.siegeLifted` / `city.captured` / `city.transportDispatched`

### 9.3 任务目标

| 目标 | 方案 |
|---|---|
| 招募 N 名士兵 | `custom.event:city.recruited` + payload 累加（首版）；稳定后登记 `ObjectiveTypeRegistry`（`recruit.unit`） |
| 城池民心达到 X | `commit.fact`（日结后写 `storyState.cityMorale.<cityId>`）+ `condition` |
| 攻下某城 | `commit.fact('city.captured')` + payload 过滤 |
| 输送 N 资源到某城 | `custom.event:convoy.arrived`（模块 2） |

### 9.4 触发器典型

- `when: city.captured` → `state.transaction`（写战功）+ `spawnPlacements`（驻军）+ 对话。
- `when: city.moraleChanged + morale < 20` → `showTip`「民心离散，恐有民变」+ 可选 `spawnPlacements`（流民）。
- `when: advanceDay`（若已有该事件）→ `city.settle`（若未接日结自动链则在此补）。

---

## 10. UI 与编辑器

| 界面 | 载体 | 内容 |
|---|---|---|
| 城池卡 | 新 `CityPanel`（`WorldMapPanel` 内弹出层） | 摘要 + 攻击/输送 + 更多（招募/赈济） |
| 目标选择器 | 复用 `WorldMapPanel` 点选 | 敌城/军团/地图点，确认后下发 |
| 输送配置 | 复用 `CargoTransferView`（已有） | 城池容器 ⇄ 马车 |
| 城内面板 | 场景内 `CityAdminPanel`（P3，可选） | 与本模块同一数据，只是场景内入口 |

**编辑器**：
- 城池初始数据：`game.project.json.variables.cityStates`（已有，JSON 域）。
- 产出配置：`construction.definitions[].production`（新增可选块，建造定义面板加 5 个数字输入）。
- 招募成本：`game.project.json.recruitCost`（JSON 域）。
- 校验：`cityStates[].resources.coin` 缺失 → 警告（不影响存量数据）；`recruitCost.byUnitType` 引用不存在的兵种 → 错误。

---

## 11. 分级交付

| 级别 | 内容 | 验收 |
|---|---|---|
| **7A 日结流水线** | `AdvanceDayPipeline`（产出/民心/兵源/补给）+ `city.productionSettled` 等事件 | 推进 1 天，资源与民心按公式变化；重复推进不双计；无城池配置的势力零变化 |
| **7B 招募** | `recruitCost` + `city.recruit` 三条扣减路径 + **`army.recruit.fromCampId` 解析（§6.1）** + `city.recruited` | 城内/寨仓/流浪三路径各一次；`fromCampId` 缺失/无效/跨场景三种拒绝各一次；名额耗尽拒绝；资源不足回滚无副作用 |
| **7C 城池卡 + 攻击/输送** | `CityPanel` + `city.orderAttack` / `city.orderTransport` | 点城 → 两按钮 → 目标选择 → 实际派军/派队；三端可操作 |
| **7D 围城与易主** | 围城状态 + `city.captured` + `CityWarSystem.prepareDraft` 补民心项 | 守城/失城全链；资源按战果转移；民心变化正确 |

---

## 12. 零回归与风险

| 风险 | 处置 |
|---|---|
| 日结重复结算导致资源翻倍 | `settledDay` 幂等标记 + `state.transaction` 单次提交 |
| 直接改黑板绕过事务 | `AdvanceDayPipeline` 纯函数，只返回新状态，写回统一走事务服务 |
| `cityStates` 存量数据缺 `population`/`production` | 全部走默认公式，缺失即跳过自定义分支 |
| `coin` 作为资源键与既有资源 id 冲突 | 资源键约定为 `RESOURCE_IDS` 已收录（模块 2）；`coin` 需登记进该表 |
| 招募刷实体造成性能问题 | 招募只加 `roster` 数字，实体在进场景时展开（与模块 3 一致） |
| 输送与模块 2 押运重复实现 | `city.orderTransport` 只做"校验 + 组队 + 下单"，运输本体全归模块 2 |
| 多城池日结耗时 | 城池数量级 ≤ 20，纯算术；单次 < 1ms |

---

## 13. 开放问题（默认值已选）

| # | 问题 | 默认 | 若选另一种的差异 |
|---|---|---|---|
| 1 | 内政四项做几个 | **产出 + 税收(并入产出) + 兵源**，忠诚折进 `morale` | 四项全做：多一套忠诚系统，收益低 |
| 2 | 铜钱载体 | **`cityStates.resources.coin`**（复用 integer map） | 新增 `currency` 字段：CITY_SCHEMA 改动，且与 `ShopSystem` 双源 |
| 3 | 日结触发 | **`advanceDays` 驱动，顺序流水线** | 实时逐建筑模拟：成本高、无收益 |
| 4 | 民心乘数范围 | **[0.5, 1.5]**（`0.5 + morale/100`） | 更陡（[0.3,1.7]）：民心惩罚更痛；更平：民心无感 |
| 5 | 可招募名额上限 | **人口/100 × 民心系数 + 每日恢复** | 无限：军团无限膨胀；硬性上限：扩张受限太死 |
| 6 | 招募是否要"已建军" | **不要求**（可先招人再建军） | 要求：流程多一步，但防止"空编制占位" |
| 7 | 城内招募扣谁的钱 | **城池共享池** | 扣玩家个人钱：与"主城配给"主题冲突 |
| 8 | 输送是否必须护卫 | **可选**（短途纯马车、长途需军团） | 强制护卫：所有输送都要抽调军团，物流压力大 |
| 9 | 「攻击」是否需先建军 | **需要**，无军团时弹确认自动组建 | 直接派"人口"出征：绕过模块 3，编制概念被架空 |
| 10 | 防御方向是否暴露 | **仅在攻击时选"进攻方向"** | 单独做"布防方向"罗盘：布阵/通路已覆盖，重复 |
| 11 | 围城是否禁输送出城 | **禁止**（只能进城不能出） | 允许：围城无痛，失去"断粮"意义 |
| 12 | 易主时建筑损毁 | **`damageRatio += 0.15`** | 全毁：城池变废墟，重建成本过高 |
| 13 | 是否做场景内 `CityAdminPanel` | **P3 可选** | 首版只做大地图城池卡：少一个 UI，功能不减 |
| 14 | 赈济上限 | **每日 1 次，+5 民心** | 无限制：可用资源硬刷民心，失去经营感 |

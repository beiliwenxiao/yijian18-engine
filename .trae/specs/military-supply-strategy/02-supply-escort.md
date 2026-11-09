# 模块 2：物资配给与押运（主城共享 / 领取 / 押运 / 被抢）

> 状态：设计稿（默认值已按推荐方案填写，拍板项见 §9）· 2026-11-08
> 归属：[军需—配给—押运—军团体系总纲](spec.md) 模块 2
> 需求映射：主城才有物资供应；主城物资按人按等级共享；需要领取、押运才能进自己寨子、进自己口袋；押运途中可能被抢（第一轮）

---

## 1. 结论先行

城池库存、载具货舱、转运界面、容器仓库、原子库存事务、军团护卫姿态**都已存在**，但缺一条把它们串起来的"配给—押运"业务链：

| 缺口 | 现状 | 本次设计 |
|------|------|----------|
| 主城物资共享口径 | 城池只有 `resources` 数字，没有领用规则 | 新增 `SupplyService`：等级额度 + 共享池 |
| 领取流程 | 完全没有 | 领用单（Order）+ 额度/冷却/归属校验 |
| 主城库存 ↔ 物品 | 两套结构（数字资源 vs 背包物品） | 通过 `RESOURCE_IDS` 映射 + 原子事务 |
| 押运队 | 载具与护卫各自存在，没有"一队"概念 | `Convoy` 编排：载具 + 护卫小队 + 主将 |
| 被抢 | 没有劫掠队伍与货物损失结算 | 伏击区 + 遭遇战 + 损失比例表 |
| 进寨子 vs 进个人口袋 | 容器仓库与背包都有，语义未区分 | 容器=寨仓（安全），背包=随身（可被抢） |
| 全程走任务/命令 | 部分（转运与建造已是命令） | 全部新增 `supply.*` / `convoy.*` 命令 + 触发器 |

**一句话**：把城池 `resources` 当"主城共享粮仓"，按等级额度开出**领用单**；小额直接进背包，大额必须装车**押运**；押运队 = 载具货舱 + 护卫小队；路上按伏击点判定**被抢**，战果决定损失比例；到达后进**寨子仓库**或**个人背包**。

---

## 2. 现有能力盘点（已有 / 部分 / 没有）

### 2.1 城池库存与归属

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 城池状态 | **已有** | `src/data/schema/CanonicalSchemas.js:367-395`（`CITY_SCHEMA`） | 字段：`resources{food,herb,iron,wood}`、`morale`、`buildingLevel`、`damageRatio`、`buildingDamage`、`damagePausedUntilDay` |
| 城池初始数据 | **已有** | `example/.../game.project.json:501-620`（`variables.cityStates`） | 已有 8 座城的资源/民心/建筑等级/损毁 |
| 城池资源转移 | **已有** | `src/systems/CityWarSystem.js:37-66`；`BATTLE_RESOURCE_TRANSFER_SCHEMA`（`:397-416`） | 战后资源在城与城之间转移，含审计校验 |
| 城池摘要 UI | **已有** | `src/ui/CityStateSummaryPanel.js` | 只读快照面板，可扩展为配给所信息区 |
| 城池归属判定 | **部分** | `cityStates[].factionId` | 有归属，但没有"我的城池/盟友城池"查询 API |
| 军衔/等级 | **部分** | `characterLevel` 已用于进阶门槛（`AllocationRules.js:140-150`） | 没有独立"军阶"；额度可用角色等级起步 |

### 2.2 配给与领取

| 子能力 | 结论 | 说明 |
|---|---|---|
| 配给额度 | **没有** | 无 quota/rank/领用单概念 |
| 领取流程 | **没有** | 城池资源不能直接变成玩家物品（只能战后转移） |
| 资源↔物品映射 | **部分** | `S11S14SceneFlow.js` 的 `RESOURCE_IDS`（S13 介入消耗用）把 `food/wood/iron/herb` 映射到 `resource.*` 物品，可复用为领取换算 |

### 2.3 载具、货舱与转运

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 载具实体/席位 | **已有** | `src/ecs/components/VehicleComponent.js:13-23` | 战马/战车/弩；driver/gunner/passenger 席位 |
| 货舱 | **已有** | `src/ecs/components/CargoComponent.js:17-47` | 独立 inventory + `capacity` + 可用容量 |
| 货运原子事务 | **已有** | `src/systems/VehicleLogisticsSystem.js:35-132` | 单件/批量转运，容量校验、checkpoint、回滚、幂等 operationId |
| 载具行军耗粮 | **已有** | `VehicleLogisticsSystem.js:133-195` | 马匹按距离消耗食物、饥饿状态（载具军团后勤先例） |
| 转运 UI | **已有** | `src/ui/CargoTransferView.js`；接线 `S11S14SceneFlow.js:1081-1210`（S14 马车） | 玩家背包 ↔ 货舱双向转移，容量/失败提示齐全 |
| 载具场景生成 | **已有** | `src/core/scene/SceneVehicleRuntime.js:32-127` | `gameplay.vehicles` + marker 生成，capture 保存位置/货舱 |
| 载具指令 | **部分** | `S11S14SceneFlow.js:732-746` | 目前只有 interact/openCargo/operateWeapon/leaveSeat/destroy；**没有**跟随/冲锋/原地防御/逃跑 |
| 载具军团（一队多车） | **没有** | — | 无 convoy 概念、无编队 |

### 2.4 仓库与"进寨子"

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 场景容器库存注册 | **已有** | `src/core/scene/SceneContainerInventoryRegistry.js:19-90` | 稳定容器 id、快照、校验、恢复 |
| 寨子仓库先例 | **已有** | `S01S02SceneFlow.js:70-82`（小庇护所箱）、`:156-208`（开关/转移） | 容器 → `CargoTransferView` → `item.transfer` → checkpoint，可直接复用 |
| 寨子归属 | **没有** | — | 需要定义"我的寨子"（faction/玩家）与仓库 id 绑定 |

### 2.5 押运风险

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 劫掠 NPC | **没有** | — | 敌人只是战斗实体，不会"抢货" |
| 货物损失结算 | **没有** | — | 战败/逃跑没有按比例扣货的逻辑 |
| 掉落回收 | **已有** | 敌人 `lootTable` + `generateLoot` + 地面掉落链 | 可承接"被抢货物掉落" |
| 伏击/遭遇触发器 | **部分** | `TriggerSystem` 支持 `sceneEnter`/`zone`/`enemy.killed` 等 | 可编排，但没有押运队专用事件 |

### 2.6 任务 / 命令 / 存档

| 子能力 | 结论 | 关键位置 | 说明 |
|---|---|---|---|
| 事实与命令 | **已有** | `commands.json`（`state.transaction`）、`ScenarioCommandService` | 领取/押运可全部走命令 |
| 目标类型 | **部分** | `ObjectiveTypeRegistry.js:37-99` | 有 gather/kill/commit/custom，无"押运"目标 |
| 城池入档 | **已有** | checkpoint `cityStates` | `captureCheckpoint` 已包含 |
| 容器/载具入档 | **已有** | `SceneContainerInventoryRegistry.serialize`、`SceneVehicleRuntime.capture` | 押运队需新增自身状态入档 |
| 日期推进 | **已有** | `src/systems/TimeSystem.js:58-140`（`currentDay`/`advanceDays`） | 额度按日刷新可直接挂 |

---

## 3. 核心规则

### 3.1 主城物资的共享口径（默认：按等级额度 + 共享池）

```
城池共享池：city.resources（food/herb/iron/wood）
玩家额度  ：quota(rank) —— 每日可领上限，按角色等级（或军阶）查表
领取约束  ：本次领取量 ≤ min(剩余额度, 城池库存)
多人竞争  ：池子先到先得；库存不足时按剩余量发放（默认不欠额）
```

推荐额度表（`supply.quotas`，策划可改）：

| 等级段 rank | 每日额度（示例） | 说明 |
|---|---|---|
| 1～2 | 粮 6 / 木 4 / 铁 2 / 药 1 | 新兵 |
| 3～4 | 粮 10 / 木 6 / 铁 4 / 药 2 | 什长 |
| 5～6 | 粮 16 / 木 10 / 铁 8 / 药 3 | 队率 |
| 7+ | 粮 24 / 木 16 / 铁 12 / 药 5 | 军侯及以上 |

修正项：
- 城池 `buildingLevel` 每级 +10% 全额度（上限 +50%）；
- 城池 `damageRatio` / 低 `morale` 按比例削减（`morale < 30` 时 ×0.7）；
- 任务可临时覆盖（`supply.quotaOverride` 事实，例如"出征前补给加倍"）。

> **替代方案：按人头均分**（`quotaMode: 'per_capita'`）
> 池子 ÷ 城池人口/编制人数，人人相同。差异：更公平、无成长感；数据结构不变，只换额度计算函数。
> 推荐默认"按等级额度"，因为需求原文是"按人按等级"，且与现有 `characterLevel` 直接对接。

### 3.2 领取流程

```
① 到己方城池「配给所」交互 → supply.open（只读快照：城池库存/我的额度/今日已领/目的地）
② 选物资与数量 → supply.requisition
     ├─ 校验：城池归属、额度、库存、任务锁（剧情期间禁领）
     ├─ 原子扣减：city.resources -= N（写 checkpoint，operationId 幂等）
     └─ 生成领用单 SupplyOrder（含目的地：随身 / 押运）
③ 交付：
     ├─ 随身（小额，默认单次 ≤ 10 负重单位）→ 直接进玩家背包 → 订单 DELIVERED
     └─ 押运（超过阈值或玩家主动选）→ 装车 → 订单 IN_TRANSIT
④ 到达：押运队抵达目标寨子 → 卸货
     ├─ 进寨子仓库 → 容器入账（安全）
     └─ 进个人口袋 → 背包入账（随身风险）
```

**限制清单**：

| 限制 | 默认值 | 说明 |
|---|---|---|
| 城池归属 | 仅己方/盟友城池可领 | 敌方城池不可领（攻下后归属变更） |
| 每日额度 | 见 §3.1 | `TimeSystem.currentDay` 变化时重置 |
| 单次随身上限 | 10 负重单位 | 超过必须押运 |
| 领取冷却 | 同一城池 1 日 1 次结算 | 可按任务放宽 |
| 剧情锁 | `supply.locked` 事实 | 战斗/过场期间禁止领取 |
| 库存不足 | 按剩余发放并提示 | 不产生欠额（可配置） |

### 3.3 押运队伍与载具的关系

| 组成 | 载体 | 规则 |
|---|---|---|
| 载具 | `VehicleComponent` + `CargoComponent` | 货物**只能**进载具货舱；容量 80（现有配置），超载拒绝 |
| 护卫 | `SquadMemberComponent` + `CommandStateComponent` | 默认 `escort`（跟随载具）；遇敌自动切 `assault`/`hold` |
| 主将 | 玩家实体或 NPC 武将 | 玩家可"上车"接管驾驶（占 driver 席） |
| 随行人员 | `VehicleComponent.seats.passenger` | 载人/载货互不挤占（推荐：座位载人、货舱载货） |

- 速度：空载 `baseSpeed ×1.0`，满载 `×0.7`；护卫步行速度不拖慢载具则自动上车（乘客席满则跟随跑）。
- 载具指令（本模块只消费 3 条，模块 3/4 扩展）：`follow`（跟随主将/路线）、`hold`（原地防御，护卫结阵）、`flee`（逃跑，丢货比例见 §3.4）。`charge` 留给战场模块。
- 押运路线：场景内用 `paths` 路径点（`ScenePathLibrary`），大地图用模块 4 的通路；**2A 只做场景内小路**。

### 3.4 被抢的判定与损失比例

**判定**：押运队进入 `ambush` 区域（场景 placement / 路径节点）或按路线事件掷骰；有护卫时概率下调。

```
触发概率 = baseChance × (1 - escortMitigation × 护卫战力占比)
基础 0.35；护卫 >= 3 人时 ×0.6；白天/己方领地 ×0.5
```

**损失结算表（推荐默认）**：

| 战斗结果 | 货物损失 | 载具 | 备注 |
|---|---|---|---|
| 胜 | 0% | 保留 | 可缴获劫掠者战利品 |
| 逃（flee） | 30% | 保留 | `fleeLossRatio` |
| 败 | 50% | 30% 概率被毁 | `defeatLossRatio` |
| 载具被毁 | 100% | 销毁 | 货物转地面掉落，`recoverableRatio=0.25` |

- **不能凭空消失**：被抢走的货物 50% 折算为劫掠者掉落（`generateLoot`）或敌方城池资源，玩家可在限定时间内打回。
- 追回：`convoy.robbed` 事实生成追回任务（限时 2 日），完成后返还 `recoverableRatio` 部分。
- 保险（可选，默认关闭）：主城投保后损失返还 30%，保费按货值 10%。

### 3.5 "进寨子"与"进个人口袋"的区别

| 维度 | 个人背包（口袋） | 寨子仓库（寨仓） |
|---|---|---|
| 载体 | `InventoryComponent` | `SceneContainerInventoryRegistry` + checkpoint |
| 容量 | `maxSlots`（小） | 容器 `maxSlots`（大） |
| 风险 | 死亡掉落、被抢、被任务征收 | 安全；**城池被攻破**时才可能被掠夺 |
| 取用 | 随身，随处可用 | 必须回寨子/仓库点 |
| 与配给关系 | 小额直接入包；押运到达后可从货舱取 | 押运到达后 `convoy.deposit` 入库 |
| 归属 | 玩家私产 | 寨子（玩家/势力）公产，可供生产与军团取用 |

**规则**：默认押运到达后**先入寨仓**，玩家再按需取到背包（二次确认），避免"押运=直接进包"绕过风险。

### 3.6 账本与防刷

- 每次领取/装车/卸货/损失结算都带 `operationId`（`supply:<day>:<cityId>:<seq>`），重复提交返回同一结果。
- 城池库存扣减、载具/容器变更、订单状态三者在同一 checkpoint 内提交；任一失败全回滚。
- 关键节点写事实：`supply.requisitioned`、`convoy.dispatched`、`convoy.arrived`、`convoy.robbed`、`supply.delivered`，供任务与日志审计。

---

## 4. 状态机

### 4.1 领用单 SupplyOrder

```
DRAFT
 → APPROVED（校验通过，冻结额度，扣城池库存）
     ├─ 随身 → DELIVERED（进背包）
     └─ 押运 → LOADING（装车）
                 → IN_TRANSIT
                     ├─ 到达 → UNLOADING → DELIVERED（入仓/入包）
                     ├─ 被抢 → LOST（按比例结算）
                     └─ 取消 → CANCELLED（退库存/退额度）
```

### 4.2 押运队 Convoy

```
STAGING（集结：载具 + 护卫到位）
 → MARCHING（沿路线移动；可 follow/hold/flee）
     ├─ 抵达 → ARRIVED → UNLOADED
     ├─ 伏击 → AMBUSHED（进入战斗）
     │     ├─ 胜 → MARCHING
     │     ├─ 逃 → ESCAPED（扣 30% 货）→ MARCHING
     │     └─ 败 → LOST（扣 50%/载具毁 100%）
     └─ 主将阵亡/载具毁 → LOST
```

> **本表只管"在途"货物（入库边界）**：以上 0% / 30% / 50% / 100% 只作用于**还在车上 / 载具货舱里**的物资；一旦卸货入库（`army.supply` / 城池仓库 / 玩家背包），后续战败或逃亡的辎重损失只走 [模块 6](06-battle-plan-intervene.md) §5.5（战败 20~40%、逃亡 15~30%），**同一批物资不会同时受两张表**（2026-11-09 第五次拍板）。

### 4.3 伏击遭遇

```
ZONE_ENTER → ROLL（是否触发）
   ├─ 否 → 继续行军
   └─ 是 → 生成劫掠队 placement → BATTLE（模块 6 战斗链）
              → WIN / FLEE / LOSE → 损失结算 → 回写订单与货舱
```

---

## 5. 数据落点

### 5.1 项目配置 `game.project.json`

```jsonc
"supply": {
  "quotaMode": "rank",                 // rank | per_capita
  "quotaRefresh": "daily",             // daily | chapter
  "carryLimits": { "personalMaxWeight": 10 },
  "quotas": [
    { "rank": 1, "daily": { "food": 6, "wood": 4, "iron": 2, "herb": 1 } },
    { "rank": 3, "daily": { "food": 10, "wood": 6, "iron": 4, "herb": 2 } }
  ],
  "cityModifiers": { "buildingLevelBonus": 0.1, "lowMoraleThreshold": 30, "lowMoraleMultiplier": 0.7 },
  "ambush": { "baseChance": 0.35, "escortMitigation": 0.4, "fleeLossRatio": 0.3, "defeatLossRatio": 0.5, "vehicleDestroyChance": 0.3, "recoverableRatio": 0.25 }
}
```

### 5.2 内容库 `library.json` 新增 `convoys[]`

```jsonc
{
  "id": "convoy.light_cart",
  "name": "轻装粮车",
  "vehicleRef": "vehicle.s14.lastCart",     // 复用载具定义
  "escort": { "count": 2, "ref": "enemy.s02_yellow_turban_soldier" },
  "speed": { "base": 90, "loadedMultiplier": 0.7 },
  "cargoCapacity": 80
}
```

### 5.3 寨子/仓库绑定（场景数据）

```jsonc
"gameplay": {
  "stashes": [
    { "id": "stash.s01.shelter", "containerId": "s01-shelter-chest:inventory", "maxSlots": 12, "owner": "player" }
  ]
}
```

### 5.4 运行时与存档

| 数据 | 落点 | 说明 |
|---|---|---|
| 领用单/额度/当日已领 | 新增 `SupplyService`（`src/systems/SupplyService.js`） | `capture/restore` 进 checkpoint（`gameplay.supply`） |
| 押运队状态 | 新增 `ConvoyRuntime`（场景协调层） | 载具/护卫实体本身由 `SceneVehicleRuntime` 与实体管线入档 |
| 城池库存 | `blackboard.cityStates`（已有） | 领取扣减走 checkpoint |
| 货物 | `CargoComponent`（已有） | 装/卸用 `VehicleLogisticsSystem.transferBatch` |
| 寨仓 | `SceneContainerInventoryRegistry`（已有） | 入仓用 `item.transfer` |
| 事实 | `storyState` / `state.transaction` | `supply.*` / `convoy.*` 事实 |

---

## 6. 任务 / 触发器 / 命令接法

### 6.1 新增命令（`scenario.command` 命名空间）

| operation | payload | 语义 |
|---|---|---|
| `supply.open` | `{ cityId, stashId? }` | 打开配给所（只读快照） |
| `supply.requisition` | `{ cityId, items:{food,wood,...}, destination:'personal'|'convoy' }` | 开领用单并扣城库存 |
| `supply.cancel` | `{ orderId }` | 取消并退库存/额度 |
| `convoy.assemble` | `{ templateId, spawnRef }` | 生成载具 + 护卫队 |
| `convoy.load` | `{ convoyId, orderId }` | 装车（走 `VehicleLogisticsSystem.transferBatch`） |
| `convoy.dispatch` | `{ convoyId, routeId }` | 出发 |
| `convoy.order` | `{ convoyId, order:'follow'|'hold'|'flee' }` | 载具指令 |
| `convoy.unload` | `{ convoyId, target:'personal'|'stash', stashId? }` | 卸货 |
| `convoy.resolveAmbush` | `{ convoyId, result:'win'|'flee'|'lose' }` | 损失结算 |

> 实际库存变更仍走 `item.transfer` / `batchExchange`（已有）；`convoy.*` 只编排。

### 6.2 触发器

| when.type | 参数 | 用途 |
|---|---|---|
| `zone.enter` / `sceneEnter` | `zoneId` | 进入伏击区/抵达寨子 |
| `convoy.ambushed` | `{ convoyId, zoneId }` | 弹出遭遇战 |
| `convoy.arrived` | `{ convoyId, stashId }` | 提示卸货、推进任务 |
| `convoy.robbed` | `{ convoyId, loss }` | 生成追回任务、提示损失 |
| `state.transaction` | `supply.requisitioned` 等事实 | 任务链推进 |

### 6.3 任务目标

| 目标 | 方案 |
|---|---|
| 领取 N 物资 | 新增 `supply.requisition` 目标（按 itemId 统计） |
| 押运 N 次成功 | 新增 `supply.escort` 目标（监听 `convoy.arrived`，失败不计数） |
| 送达指定寨子 | `commit.fact`（`convoy.arrived` 触发事实） |
| 夺回被抢物资 | 复用 `kill.enemy` + `gather.item` 组合 |

> 1A 可先用 `custom.event` 目标过渡，1B 再落成正式类型。

---

## 7. UI 入口

| 入口 | 形态 | 复用 |
|---|---|---|
| 配给所 | `SupplyPanel`：城池库存 / 我的额度 / 今日已领 / 物资数量步进 / 目的地（随身·押运） | 参考 `CityStateSummaryPanel` 的只读快照思路 |
| 装车/卸货 | `CargoTransferView`（玩家背包 ↔ 货舱 / 寨仓） | 已有（S14 马车、S01 箱子） |
| 押运编成 | `ConvoyPanel`：载具、护卫数、载货清单、路线、出发/召回 | 新 |
| 押运状态 | HUD 状态条：在途/遇袭/到达；遭遇弹窗 | 参考现有任务/提示 HUD |
| 寨仓 | 容器交互 → `CargoTransferView` | 已有 |
| 编辑器 | 内容库「押运队模板」；项目配置「配给额度表」；场景「伏击区/小路/寨仓」placement | 新增最小表单 |

**三端**：PC 左键/E；手柄 A/B/十字键；触屏点按 + 底部按钮；文案进 `InputHints`。

---

## 8. 本模块分级交付

| 级别 | 内容 | 最小可玩验收 | 依赖 |
|---|---|---|---|
| **2A 配给闭环** | 配给所面板 + 额度 + 领取入包 + 寨仓容器 + 任务链 | 己方城池领 4 粮 → 背包 +4，城池 -4，额度 -4；次日刷新；非己方城池被拒 | 无（城池/背包/容器已有） |
| **2B 押运闭环** | 押运队模板 + 装车 + 跟随行军 + 到达卸货入寨仓 | 领取 20 木（超随身上限）→ 装车 → 护卫跟随 → 到寨子 → 卸入寨仓；中途切场景进度保留 | 2A、载具/转运已有 |
| **2C 被抢闭环** | 伏击区 + 遭遇战 + 损失结算 + 掉落回收 + 追回任务 | 押运途中触发伏击 → 战败 → 丢 50% 货并生成掉落 → 追回任务可完成 | 2B、模块 6 最小战斗链 |
| **2D 载具指挥** | `follow/hold/flee` 三指令 + 上车接管 | 下达 hold 原地结阵；flee 逃跑扣 30% 货；上车可驾驶 | 2B、模块 3 姿态复用 |

---

## 9. 开放问题（默认值已选，标出替代差异）

| # | 问题 | 默认（推荐） | 若选另一种的差异 |
|---|---|---|---|
| 1 | 共享口径按等级还是按人头 | **按等级额度 + 共享池** | 按人头均分：公平但无成长感，`quotaMode:'per_capita'` 只换计算函数 |
| 2 | 额度刷新周期 | **每日**（`TimeSystem.currentDay`） | 按章节：节奏更慢，需任务手动重置 |
| 3 | 城池等级是否提升额度 | **是，每级 +10%（上限 +50%）** | 不提升：城池建设价值降低 |
| 4 | 领取是否消耗贡献/声望 | **否（1A）** | 消耗：需新增贡献值系统，防刷更强 |
| 5 | 押运是否强制 | **超 10 负重强制押运** | 全可选：玩家可全塞背包，风险机制弱化 |
| 6 | 被抢损失比例 | **胜 0% / 逃 30% / 败 50% / 载具毁 100%**（**仅管在途货物**；入库后的战败/逃亡损失走模块 6 §5.5，以入库边界分界、不双扣） | 更硬核：败 80%；更宽容：败 30% |
| 7 | 被抢货物去向 | **50% 转劫掠者掉落，25% 可追回** | 全消失：挫败感强；全掉落：可反复刷 |
| 8 | 载具载人还是载货 | **座位载人、货舱载货，互不挤占** | 二选一：需改 `CargoComponent`/席位语义 |
| 9 | 寨子仓库是否会被攻破掠夺 | **是（沿用城池战利品机制）** | 永不掠夺：仓库绝对安全，风险失衡 |
| 10 | 多城池共享还是各城独立 | **各城独立池，主城为源** | 全势力共享：更简单但抹平地理差异 |
| 11 | 玩家能否上车押运 | **能（占 driver 席，接管驾驶）** | 不能：押运纯 AI，操作感弱 |
| 12 | 护卫来源 | **模块 3 的玩家小队/雇佣兵** | 系统白给：省事但削弱军团养成 |

---

## 10. 零回归与风险

| 风险 | 处置 |
|---|---|
| 城池资源被"领空" | 所有扣减走同一次 checkpoint；`operationId` 幂等；`supply.*` 事实可审计 |
| 载具/容器双写不一致 | 统一用 `VehicleLogisticsSystem.transferBatch` + `item.transfer`，不手写库存 |
| 押运队在场景切换后丢失 | `ConvoyRuntime.capture/restore` 入 checkpoint；载具实体走 `SceneVehicleRuntime.capture` |
| 被抢概率过于随机引发挫败 | 默认 0.35 且护卫可降；提供"保险"开关；首次押运强制无伏击（教学） |
| 存档膨胀 | 订单只保留最近 N 条 + 未完成订单；历史事实走 `storyState` |
| 与模块 3/4 的指令口径冲突 | 本模块只定义 `follow/hold/flee`，`charge` 与军团姿态统一在模块 3/4 定义，避免两套 |

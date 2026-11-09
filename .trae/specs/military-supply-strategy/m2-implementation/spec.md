# M2 配给与押运 · 实施级规格

> 状态：已定稿（2026-11-10，按用户指令「计划落文档后直接实现，不等审批」）
> 上游：[tasks.md](../tasks.md) M2 行（验收：额度拦截；被抢按比例损失可追回）· 模块文档 [02-supply-escort.md](../02-supply-escort.md)
> 决策依据：[decisions.md](../decisions.md) P10（超 10 负重强制押运；胜 0% / 逃 30% / 败 50% / 载具毁 100%）、P5（铜钱物品化）、P16（箭矢走配给链）
> 实现范式：[m1-implementation/spec.md](../m1-implementation/spec.md)、`src/systems/ProductionSystem.js`、`src/systems/CityWarSystem.js`

---

## 1. 范围

| 段 | 交付 | 验收 |
|---|---|---|
| **2A 配给闭环** | `SupplySystem`：按等级额度 + 城池共享池 + 领用单状态机 + 随身/押运目的地 + 按日刷新 + operationId 幂等 + capture/restore | 己方城领 4 粮 → 城池 −4、额度 −4、背包 +4；额度超限/库存不足/非己方城被拒；次日额度刷新；取消退库存与额度 |
| **2B 押运闭环** | `ConvoySystem`：模板装配（逻辑押运队绑定载具/货舱适配器）+ 装车 + 出发 + 到达 + 卸货（个人背包 / 寨仓）+ 快照 | 超 10 负重必须押运；领用单 APPROVED→LOADING→IN_TRANSIT→DELIVERED；切场景快照往返后订单与货物保留 |
| **2C 被抢结算** | `ConvoySystem.resolveAmbush`：胜 0% / 逃 30% / 败 50% / 载具毁 100%；损失 50% 转掉落、25% 可追回（2 日窗口）+ 事实事件 | 败 50% 精确扣货；掉落回调收到 50% 条目；`convoy.recover` 在窗口内返还 25%，过期拒绝 |
| **2D 载具指令（状态层）** | `follow` / `hold` / `flee` 三指令状态 + `flee` 立即按 30% 扣货；移动/寻路不实现 | 指令切换可读、flee 扣货正确；实际跟随移动留给 M3/M4 |
| **跨段** | 命令 `supply.*` / `convoy.*` 注册；任务目标 `supply.requisition` / `supply.escort`；事件 `supply.requisitioned` / `convoy.*` | 事件驱动目标进度 +1 |

### 明确不做（本里程碑）

1. **配给所 UI 与场景 placement 接线**：`SupplyPanel` 与「配给所」交互点属于内容接线，等 M2 引擎稳定后单列（避免改动 S01 主线场景数据）。
2. **押运队物理生成 / 护卫 AI 跟随 / 载具驾驶**：`ConvoySystem` 通过注入适配器绑定已存在的载具实体与货舱；生成与移动归 M3（随行小队）/M4（大地图）。
3. **伏击遭遇战**：M2 只交付「遭遇结算」命令与损失表；真实战斗链在 M6 调用 `convoy.resolveAmbush`。
4. **保险、按人头额度、章节刷新**：`quotaMode:'per_capita'` 仅保留枚举，不实现。
5. **编辑器表单**：配给额度 / 押运模板编辑器后置（数据可直接编）。

---

## 2. 关键设计（实现即按此落地）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 城库存唯一事实源仍是 `blackboard.cityStates[].resources`；`SupplySystem` 只接受注入的 `readCities()/commitCities(draft)` 适配器，不直连 Blackboard | 沿用 `CityWarSystem`/`SceneCityWarStateBridge` 的领域与投影分离；引擎不依赖场景 |
| D2 | 物品入包只走 `InventoryTransactionService.commit({ type:'batchAdd' | 'batchRemove', operationId })`，不手写 `InventoryComponent` | 单一事实源 + 幂等 + 原子回滚 |
| D3 | 城库存扣减与订单创建**同一次提交**：`commitCities` 成功后才落订单；失败返回 `cityCommitFailed` 不建单 | 防止「领空」 |
| D4 | 额度按 `rank` 查表：取 `quotas` 中 `rank <= 玩家等级` 的最大档；同一 `(characterId, cityId, day)` 累计用量，跨日重置 | 与 `characterLevel` 直接对接；等级由调用方传入，系统不感知成长系统 |
| D5 | 城池修正：`buildingLevel` 每级 `+buildingLevelBonus`（上限 `cap`）；`morale < lowMoraleThreshold` 时 ×`lowMoraleMultiplier`；结果向下取整 | 模块 02 §3.1 / D23 |
| D6 | 负重单位由 `supply.resourceWeights` 换算（food 1 / wood 2 / iron 3 / herb 1）；随身单次 > `personalMaxWeight` → `convoyRequired`（P10） | 需求「超 10 负重强制押运」 |
| D7 | 资源→物品映射走 `supply.resourceItems`（food→`resource.food` 等），物品定义由 `itemResolver` 解析后入包 | 复用 `RESOURCE_IDS` 先例 |
| D8 | 领用单状态机：`APPROVED → (personal) DELIVERED`；`APPROVED → LOADING → IN_TRANSIT → ARRIVED → DELIVERED`；`→ LOST / CANCELLED`；订单只保留最近 64 条 + 全部未完结单 | 模块 02 §4.1；防存档膨胀 |
| D9 | `ConvoySystem` 不直接生成实体：`assemble({ templateId, convoyId, vehicleEntityId, cargoInventory, escortIds })`，模板由注入 `resolveTemplate` 提供；无 `cargoInventory` 返回 `cargoUnavailable` | 载具生成归 M3/M4；M2 只做业务状态 |
| D10 | 装车从订单持有条目 `batchAdd` 到货舱库存；容量校验用 `previewAdd`，不足返回 `cargoFull`；订单 → LOADING | 货物在「订单→货舱」间只存一份，不复制 |
| D11 | 卸货：`target:'personal'` 入玩家背包；`target:'stash'` 入注入的 `resolveStash(stashId)` 容器库存；全量成功才删货舱与订单（原子） | 寨仓 vs 背包语义分离（模块 02 §3.5） |
| D12 | 损失按「剩余在途货物」计算：`flee=30%`、`lose=50%`、`vehicleDestroyed=100%`；取整 `Math.floor`；被移除条目 `lootDropRatio=0.5` 交 `onLootDrop`，`recoverableRatio=0.25` 记入 `recoverable`（按日窗口） | P10 + 模块 02 §3.4；「不能凭空消失」 |
| D13 | 伏击概率掷骰用注入 `rng`（禁止 `Math.random()`）；`firstConvoySafe` 开启时首单必不伏击 | 教学保护 + 可回放 |
| D14 | 所有写操作 `operationId` 幂等：`supply:<day>:<cityId>:<seq>` / `convoy:<convoyId>:<action>:<seq>`，重复提交返回同结果 | 模块 02 §3.6 |
| D15 | 快照分两段：`SupplySystem` → `gameplay.supply`；`ConvoySystem` → `gameplay.convoy`；与 `gameplay.production`（order 506）同款注册 | 切场景进度保留 |
| D16 | 命令统一注册在 `SceneGameplaySystemAssembler`：`supply.open / supply.requisition / supply.cancel / convoy.assemble / convoy.load / convoy.dispatch / convoy.order / convoy.unload / convoy.resolveAmbush / convoy.recover`；handler 只做参数取用与适配器注入 | 场景协调层入口；UI 与触发器共用同一条命令 |
| D17 | 任务目标 `supply.requisition` 监听 `supply.requisitioned`（payload 含 `items`），`supply.escort` 监听 `convoy.arrived`；不新增内核 | 模块 02 §6.3 |

---

## 3. 文件与数据改动

### 3.1 引擎（新增）

| 文件 | 内容 |
|---|---|
| `src/systems/SupplySystem.js` | 额度/共享池/领用单/随身交付/取消/快照；构造注入 `{ readCities, commitCities, inventoryTransactions, itemResolver, getDay, quotaConfig, carryLimits, resourceItems, resourceWeights, onEvent, createEventId, maxOrders }` |
| `src/systems/ConvoySystem.js` | 装配/装车/出发/到达/指令/卸货/伏击结算/追回/快照；构造注入 `{ inventoryTransactions, itemResolver, resolveTemplate, resolveStash, onLootDrop, onEvent, createEventId, rng, getDay, ambushConfig, maxConvoys }` |
| `src/systems/SupplySystem.test.js` | 见 §5 |
| `src/systems/ConvoySystem.test.js` | 见 §5 |
| `src/core/M2Content.test.js` | 见 §5 |

### 3.2 引擎（修改）

| 文件 | 改动 |
|---|---|
| `src/core/Registry.js` | `STANDARD_REGISTRY_KINDS` 追加 `convoys` |
| `src/data/schema/CanonicalSchemas.js` | 新增 `CONVOY_SCHEMA`（id/name/vehicleRef/escort{counter,ref}/speed{base,loadedMultiplier}/cargoCapacity）；`GAME_PROJECT_LIBRARY_SCHEMA` 加 `convoys` 数组；`GAME_PROJECT_SCHEMA` 加 `supply: { type: OBJECT }` |
| `src/core/scene/SceneGameplaySystemAssembler.js` | 构造 `SupplySystem` / `ConvoySystem`（config 缺省不启用）、注册 `gameplay.supply`（order 507）/ `gameplay.convoy`（order 508）、`fields` 映射、注册 §2 D16 命令 |
| `src/systems/quest/ObjectiveTypeRegistry.js` | 新增 `supply.requisition` / `supply.escort` 目标类型 |
| `src/systems/index.js`（若存在导出表） | 导出两个新系统（仅当该文件已维护同类导出时） |

### 3.3 内容

| 文件 | 改动 |
|---|---|
| `example/sanguo_zhangjiao/game.project.json` | 新增 `supply` 块（§1 配置；`playerFactionId: "yellow_turban"`、额度表 4 档、修正项、ambush 表、resourceWeights / resourceItems） |
| `example/sanguo_zhangjiao/project/library.json` | 新增 `convoys: [{ id:"convoy.light_cart", vehicleRef:"vehicle.s14.lastCart", escort:{count:2,ref:<现有黄巾兵id>}, speed:{base:90,loadedMultiplier:0.7}, cargoCapacity:80 }]` |
| `example/sanguo_zhangjiao/systems/SanguoGameLoaderCoordinator.js` | 投影 `config.supply` / `config.convoy`：`readCities`/`commitCities` 走 `gameLoader.blackboard`，`getDay` 走 `timeSystem`，`itemResolver` 走 items registry，`createCheckpoint` 走既有 `_checkpointConstructionRepair`，`resolveStash` 走 `context.services.containerInventories`，`resolveTemplate` 走 `registries.convoys` |

### 3.4 配置样例（写入 `game.project.json.supply`）

```jsonc
"supply": {
  "playerFactionId": "yellow_turban",
  "quotaMode": "rank",
  "quotaRefresh": "daily",
  "carryLimits": { "personalMaxWeight": 10 },
  "resourceItems": { "food": "resource.food", "wood": "resource.wood", "iron": "resource.iron", "herb": "resource.herb" },
  "resourceWeights": { "food": 1, "wood": 2, "iron": 3, "herb": 1 },
  "quotas": [
    { "rank": 1, "daily": { "food": 6, "wood": 4, "iron": 2, "herb": 1 } },
    { "rank": 3, "daily": { "food": 10, "wood": 6, "iron": 4, "herb": 2 } },
    { "rank": 5, "daily": { "food": 16, "wood": 10, "iron": 8, "herb": 3 } },
    { "rank": 7, "daily": { "food": 24, "wood": 16, "iron": 12, "herb": 5 } }
  ],
  "cityModifiers": { "buildingLevelBonus": 0.1, "buildingLevelBonusCap": 0.5, "lowMoraleThreshold": 30, "lowMoraleMultiplier": 0.7 },
  "ambush": {
    "baseChance": 0.35, "escortMitigation": 0.4, "escortThreshold": 3,
    "fleeLossRatio": 0.3, "defeatLossRatio": 0.5, "vehicleDestroyChance": 0.3,
    "recoverableRatio": 0.25, "lootDropRatio": 0.5, "recoveryWindowDays": 2
  },
  "firstConvoySafe": true
}
```

---

## 4. 命令 / 触发器 / 目标接法

### 4.1 命令（`sceneRuntime.registerCommandHandler`）

| operation | payload | 返回 |
|---|---|---|
| `supply.open` | `{ cityId, characterId, rank }` | 只读快照：城池库存、额度剩余、今日已领、目的地 |
| `supply.requisition` | `{ cityId, characterId, rank, items:{food,wood,iron,herb}, destination:'personal'|'convoy' }` | `{ ok, orderId, status, items, destination }`；`convoyRequired` 表示需改押运 |
| `supply.cancel` | `{ orderId }` | `{ ok, refunded }`（仅 APPROVED 可退） |
| `convoy.assemble` | `{ templateId, convoyId?, vehicleEntityId, cargoInventory, escortIds? }` | `{ ok, convoyId, status:'STAGING' }` |
| `convoy.load` | `{ convoyId, orderId }` | `{ ok, loaded:[{itemId,quantity}], status:'IN_TRANSIT' }` |
| `convoy.dispatch` | `{ convoyId }` | `{ ok, status:'MARCHING' }` |
| `convoy.order` | `{ convoyId, order:'follow'|'hold'|'flee' }` | `{ ok, order, loss }`（flee 立即扣 30%） |
| `convoy.unload` | `{ convoyId, target:'personal'|'stash', stashId? }` | `{ ok, delivered:[...], status:'DELIVERED' }` |
| `convoy.resolveAmbush` | `{ convoyId, result:'win'|'flee'|'lose', vehicleDestroyed? }` | `{ ok, lost:[...], lootDropped:[...], recoverable:[...] }` |
| `convoy.recover` | `{ convoyId }` | `{ ok, recovered:[...] }` / `recoveryExpired` |

### 4.2 事件（`onEvent` → 触发器 `when.type`）

| 事件 | payload |
|---|---|
| `supply.requisitioned` | `{ cityId, characterId, day, orderId, items }` |
| `supply.delivered` | `{ orderId, items, target }` |
| `convoy.assembled` | `{ convoyId, templateId }` |
| `convoy.loaded` | `{ convoyId, orderId, items }` |
| `convoy.dispatched` | `{ convoyId }` |
| `convoy.arrived` | `{ convoyId, stashId? }` |
| `convoy.orderChanged` | `{ convoyId, order }` |
| `convoy.ambushed` | `{ convoyId, result, lost, recoverable }` |
| `convoy.robbed` | `{ convoyId, lost, recoverable, expiresDay }` |
| `convoy.recovered` | `{ convoyId, items }` |

### 4.3 任务目标

| type | matcherType | identityFields | 说明 |
|---|---|---|---|
| `supply.requisition` | `supply.requisitioned` | `cityId` | 按 `quantity`（本次领取总量）累计；不限城池时留空 |
| `supply.escort` | `convoy.arrived` | `stashId` | 到达次数（失败不计数）；不限寨仓时留空 |

> 实施修正：原稿 `supply.requisition.identityFields = items` 不可用——TaskGraph 的
> `shallowMatch` 对 payload 身份字段做精确匹配，`items` 是数量对象，策划侧写不出可命中的等值
> 配置，会永不达成。改为 `cityId` + `progressBy: 'quantity'`（事件 payload 已带本次领取总量，
> 需求文档 §6.3 的「按条目累计」收敛为「按总量累计」）；`supply.escort` 的落点标识定为
> `stashId`（`convoy.arrived` 携带），便于按寨仓分别编排任务。

> 触发器是否可直接消费任意事件名，实施时以 `TriggerSystem.fire/_publishWhenEvent` 实测为准；若存在白名单，只在白名单登记两个事件名，不改匹配内核。

---

## 5. 测试

### 5.1 `src/systems/SupplySystem.test.js`

1. 额度内领取 → 城池扣减 + 背包 +N + 额度累计；
2. 同一天二次领取超额度 → `quotaExceeded`，城库存不变；
3. 库存不足 → 按剩余发放或拒绝（默认按剩余，返回 `partial`）；
4. 跨日刷新 → 额度归零；
5. 非己方城池 → `cityNotOwned`；
6. 随身超 10 负重 → `convoyRequired`，不扣库存；
7. 押运目的地 → 订单 APPROVED，城已扣、背包未加；
8. 取消 APPROVED 订单 → 城库存 + 额度双退；已装车取消 → `orderNotCancellable`；
9. operationId 幂等 → 重复提交同结果、不双扣；
10. capture/restore 往返 → 额度、订单一致。

### 5.2 `src/systems/ConvoySystem.test.js`

1. 装配 → STAGING，模板校验；
2. 装车 → 货舱 +N、订单 IN_TRANSIT、容量不足 `cargoFull`；
3. 卸货 personal / stash → 目标库存 +N、订单 DELIVERED、货舱清空；
4. `flee` → 30% 扣货且记 `convoy.robbed`；
5. `resolveAmbush` win 0% / flee 30% / lose 50%（floor 取整）；
6. 载具毁 → 100% 损失；
7. 掉落回调收到 `lootDropRatio` 条目；
8. `recover` 窗口内返还 `recoverableRatio`，跨窗口 `recoveryExpired`；
9. 快照往返 → 在途货物/订单/追回状态一致；
10. rng 注入 → 同种子同伏击结果。

### 5.3 `src/core/M2Content.test.js`

- 加载示例项目：`project.supply` 存在且额度表 ≥3 档；`registries.convoys.size >= 1`；模板 `vehicleRef` / `escort.ref` 均可解析；`resourceItems` 映射到已存在的 items。

### 5.4 命令

```powershell
npx vitest run src/systems/SupplySystem.test.js src/systems/ConvoySystem.test.js src/core/M2Content.test.js
```

全量回归：`npx vitest run`（不改 `vitest.config.js` 与测试环境声明）。

---

## 6. 零回归论证

| 风险 | 防线 |
|---|---|
| 新 `supply` 键破坏项目校验 | `GAME_PROJECT_SCHEMA` 显式登记 `supply: OBJECT`；无该键时系统不启用 |
| 新 `convoys` section 破坏 library 校验 | 追加 `CONVOY_SCHEMA` + library schema 字段；空数组合法 |
| 城库存被双扣 | 单次 `commitCities` + operationId 幂等；订单只在提交成功后创建 |
| 背包/货舱双写 | 全部走 `InventoryTransactionService`；不直接改组件 |
| 老场景行为变化 | 系统默认不启用（config 缺省）；不新增/修改任何场景 placement 与 S01 主线数据 |
| 存档膨胀 | 订单窗口 64 + 未完结单；快照 schemaVersion 固定 |
| `vitest.config.js` 冲突 | 不触碰该文件与测试环境声明 |

---

## 7. 已知依赖与后续（回报用户）

1. **M1 遗留待查**：`production.completed` → 触发器是否已登记；M2 实施前先 grep 确认，若有缺口单独记录，不混入 M2 提交。
2. `ConvoySystem` 的物理生成（载具实体 + 护卫）由 M3/M4 适配器补齐；M2 只验证业务链。
3. 伏击真实战斗在 M6 调用 `convoy.resolveAmbush`。
4. 配给所 UI / 场景 placement 接线单列，不改 S01。

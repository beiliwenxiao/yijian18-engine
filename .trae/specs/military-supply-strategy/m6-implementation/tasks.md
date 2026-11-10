# M6 执行清单（战斗执行：入场身份 / 两本账 / 声望）

> 依据：[06-battle-plan-intervene.md](../06-battle-plan-intervene.md) §3、§5、§11、§12 · 上游 master [tasks.md](../tasks.md)
> 施工约束：M1~M5 文件只做增量；不碰 `vitest.config.js`；每批自带测试；旧档兼容。

## A. 6C 三种入场身份（`BattleEntryService`）

- [x] 身份值 `takeover` / `support` / `observe`；旧值 `command` 兼容别名
- [x] `joinBattle`：接管（现场/远程）、支援（必须本人抵达、每场限 1 次）、旁观（默认）；
      产出 `plan`（possess / enterBattle / spawnSupportSquad / attachAura / deployment）由场景执行
- [x] `leaveBattle`：`commanderFled` / `commanderKilled` / `supportLeft` / `leftScene` / `battleEnded`
      五个 reason 分流；逃亡 → `settlementEvent:'fled'` + 声望 -6 + 不可再接管；阵亡 → 士气事件；
      支援离开不算逃亡
- [x] 边界确认：现场接管越界需确认（未确认位置夹回边界内）；`boundaryCheck` 返回 `confirmRequired`
- [x] 部署判据单点：`canAdjustDeployment({battleStatus})` **只看 `PRE_BATTLE`，不看身份**（v4.4 定稿）
- [x] `canIssueBattleOrder`：仅 `takeover`（support / observe 一律无将令）
- [x] 会话账 `serialize/restore`（checkpoint 可承载，旧档缺字段视为空）
- [x] 选择理由：服务返回**计划**而不是直接操作场景，避免领域层耦合场景实体生命周期；
      场景执行器按 `plan` 落地 possess / 展开 / 亲卫小队

## B. 6D 两本账（`BattleSettlementService`）

- [x] 战败与逃亡**两条独立阶梯**：战败 `-min(60, 10×n)`、逃亡 `-min(30, ladder[5/10/15])`
- [x] 同 `battleId` 同事件**只记一次**（`ledger.events[event].applied`），读档重放幂等
- [x] 减兵/丢辎重按 `battleId` 哈希种子取比例（读档结果一致）；兵力地板 `0.30` 触地板只丢辎重
- [x] 散兵池写入（`addScattered`，供 M9 `army.regroup` 消费）；辎重缓存（`addSupplyCache`，
      窗口 600s / 概率 0.6 / 比例 0.5 追回）
- [x] 连续战败衰减（`decayDays`）与胜利清零（`applyVictory` → `resetOnVictory`）
- [x] 主将阵亡一次性士气惩罚（`applyCommanderKilled`，单独幂等键）
- [x] 洗刷 hybrid（§12）：`story` / `auto` / `hybrid` 三模式；白名单 `storyHeroes` 走剧情 `force`，
      其余同军团胜利自动洗刷一次；每份污点只回补一次、回补不超过逃亡前值、连续逃亡 -1
- [x] `serialize/restore`

## C. 6G 声望 R3（`ReputationSystem`）

- [x] 五档态度：敬仰 / 友善 / 中立 / 冷淡 / 敌对（阈值 60 / 20 / -19 / -59 / -100）
- [x] 账本层级：城池 override > 势力 > 全局；`adjust` clamp [-100, 100]
- [x] 报价 `quote`：买价/修理/锻造 × 态度系数（最低 1）；卖价**方向相反**（高态度更贵）+ **×3 上限**；
      敌对 `refuseTrade` 拒绝购买/修理/锻造/招募，卖仍可回收
- [x] 招募系数（敬仰 1.5 / 友善 1.2 / 中立 1.0 / 冷淡 0.5 / 敌对 0）
- [x] `enabled:false` 全系数 1.0（零回归开关）
- [x] `serialize/restore`；旧档缺字段视为 0

## D. 主将入场与光环（`HeroAuraResolver` + `BattlefieldRuntimeSystem`）

- [x] 主将位置：部署 `commanderSlot` > 武将 `deploySlot` > `mid`
- [x] 光环：在场才生效（`aura.modifiers.attack/defense` 连乘）；离场/阵亡退化为 1.0
- [x] `BattlefieldRuntimeSystem.start({ commanders })`：可选入参，写入 `this.commanders` /
      `this.auras`，snapshot 的 faction 补 `commander` / `aura` 字段；**未传时零变化**
- [x] `serialize/deserialize` 带 `commanders` / `auras`；旧快照缺字段 → `{}`

## E. 接线现状与偏差

1. **偏差（6A/6B 未完成）**：`EncounterResolver`（大地图遭遇）与 `SceneBattleRuntime`（实时战）
   的既有结算链未改造；`BattleSettlementService` 以适配器注入方式就绪（`readArmy/writeArmy/
   readLedger/writeLedger/addScattered/addSupplyCache/adjustReputation`），尚未在
   `SceneGameplaySystemAssembler` 装配。下一步接线点：`SceneArmyOrderFlow._applyResult` 与
   `SceneBattleRuntime.settleResult` 之后补发 `defeat/fled` 事件。
2. **偏差（6B 战果卡）**：轻量战果卡 UI 未做，本轮只落领域结算与 `prepareDraft` 既有链路。
3. **偏差（主将实体化）**：`commanders` 只记录主将入场数据与槽位，**未生成可战斗的主将实体**；
   实体生成需接 EntityFactory 与 `deploySlot` 摆位，留 M6 后续批次。
4. **偏差（声望消费点）**：`quote` 接口就绪，城池商店/铁匠/招募面板尚未改为按声望报价。
5. **存档落点建议**：`battleLedger` / `reputation` / `scatteredPool` / `supplyCaches` 建议落
   `checkpoint.warState`（OBJECT，旧档天然缺字段视为空），避免给 `CHECKPOINT_SCHEMA` 加必填字段。
6. **support 身份不放开将令**：M3 注释曾预留「support 也可将令」，本轮按 06 §3.6 v4.4 定稿
   改为**仅 takeover 受理**；`ARMY_BATTLE_ORDERS` 保持 `['takeover']` 不变。

## F. 测试

- `BattleEntryService.test.js` 12 例
- `BattleSettlementService.test.js` 13 例
- `ReputationSystem.test.js` 11 例
- `HeroAuraResolver.test.js` 7 例（含 `BattlefieldRuntimeSystem` 主将入场集成 3 例）
- 既有回归：`src/systems` 997 例中 996 绿，1 例存量失败（`ItemRuntimeFactory` 依赖缺失，非本轮引入）；
  `BattlefieldRuntimeSystem.formation.test.js` 7/7、`ArmyOrderSystem.test.js` 22/22

## 进度锚点（2026-11-11 · M6 核心批次完成）

- 交付：三种入场身份 / 两本账 / 洗刷 hybrid / 声望 R3 / 主将入场与光环
- 测试：新增 43 例全绿；`src/systems` 996/997（1 例存量失败）
- 下一步：M6 接线批次（SceneGameplaySystemAssembler + SceneBattleRuntime 结算后置事件、
  战果卡、主将实体化、声望消费点），或按 master 表推进 M7
